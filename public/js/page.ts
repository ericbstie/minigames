// The page's Effect services and the helpers every game builds on. docs/development.md has the conventions.
//
//   Saves          localStorage, as Effect's KeyValueStore (memory only when the browser blocks storage)
//   SessionSaves   sessionStorage, the same way (Bike Race keeps its race server key there)
//   load / save    a saved value, checked with a Schema on the way in; a value that doesn't fit is the fallback
//   forget         removes a saved value
//   listen         an event listener that is removed when its scope closes
//   animate        a requestAnimationFrame loop that stops when its scope closes
//   run            runs an effect from plain code (an event handler or a frame) with the page's services
//
// The games keep their rules, physics and drawing as plain functions; effects (storage, timers, listeners, loops,
// the network) go through here. The hub (hub.ts) runs each game in a scope that closes when the player leaves it,
// so whatever a game set up in it (listeners, loops, timers) stops then.
import { Context, Effect, Layer, ManagedRuntime, Option, type Schema, type Scope } from 'effect';
import * as KeyValueStore from 'effect/persistence/KeyValueStore';

/** localStorage */
export const Saves = KeyValueStore.KeyValueStore;
export type Saves = KeyValueStore.KeyValueStore;

/** sessionStorage */
export class SessionSaves extends Context.Service<SessionSaves, KeyValueStore.KeyValueStore>()(
  'pick-a-game/SessionSaves',
) {}

// A browser can refuse storage altogether (blocked cookies); then the page keeps its saves in memory for the visit.
const storageLayer = (storage: () => Storage) =>
  Layer.unwrap(
    Effect.try(storage).pipe(
      Effect.match({
        onFailure: () => KeyValueStore.layerMemory,
        onSuccess: (s) => KeyValueStore.layerStorage(() => s),
      }),
    ),
  );

/** Every service the games use */
export type PageServices = Saves | SessionSaves;

export const PageLayer: Layer.Layer<PageServices> = Layer.merge(
  storageLayer(() => localStorage),
  Layer.effect(
    SessionSaves,
    Effect.provide(
      KeyValueStore.KeyValueStore,
      storageLayer(() => sessionStorage),
    ),
  ),
);

const runtime = ManagedRuntime.make(PageLayer);

/** Runs an effect with the page's services, from plain code. It runs straight away as far as it can. */
export const run = <A, E>(effect: Effect.Effect<A, E, PageServices>) => runtime.runFork(effect);

/** Runs an effect that needs nothing asynchronous and returns its result, from plain code */
export const runSync = <A, E>(effect: Effect.Effect<A, E, PageServices>) => runtime.runSync(effect);

// ---------- saved data ----------

type Plain<A> = Schema.Codec<A, unknown, never, never>;

/**
 * The value saved under key in localStorage, decoded with schema; fallback() when there is none, storage can't be
 * read, or what is there doesn't fit the schema.
 */
export const load = <A>(key: string, schema: Plain<A>, fallback: () => A): Effect.Effect<A, never, Saves> =>
  Effect.gen(function* () {
    const saved = yield* KeyValueStore.toSchemaStore(yield* Saves, schema).get(key);
    return Option.getOrElse(saved, fallback);
  }).pipe(Effect.orElseSucceed(fallback));

/** Saves a value under key in localStorage. A browser that won't save (full, or blocked) is no reason to stop. */
export const save = <A>(key: string, schema: Plain<A>, value: A): Effect.Effect<void, never, Saves> =>
  Effect.gen(function* () {
    yield* KeyValueStore.toSchemaStore(yield* Saves, schema).set(key, value);
  }).pipe(Effect.ignore);

/** Removes what is saved under key in localStorage (a game in progress that has ended, say) */
export const forget = (key: string): Effect.Effect<void, never, Saves> =>
  Effect.gen(function* () {
    yield* (yield* Saves).remove(key);
  }).pipe(Effect.ignore);

// ---------- events and frames ----------

/**
 * Listens to an event until the scope closes. The handler is plain code, or returns an effect, which runs with the
 * page's services.
 */
export const listen = <K extends string, Ev extends Event = K extends keyof WindowEventMap ? WindowEventMap[K] : Event>(
  target: EventTarget,
  type: K,
  handler: (event: Ev) => void | Effect.Effect<void, never, PageServices>,
  options?: AddEventListenerOptions,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const fn = (event: Event) => {
        const out = handler(event as Ev);
        if (Effect.isEffect(out)) run(out as Effect.Effect<void, never, PageServices>);
      };
      target.addEventListener(type, fn, options);
      return fn;
    }),
    (fn) => Effect.sync(() => target.removeEventListener(type, fn, options)),
  ).pipe(Effect.asVoid);

/** The next animation frame's time stamp */
export const nextFrame = Effect.callback<number>((resume) => {
  const id = requestAnimationFrame((t) => resume(Effect.succeed(t)));
  return Effect.sync(() => cancelAnimationFrame(id));
});

/**
 * Calls step on every animation frame until the scope closes. step gets the frame's time stamp (ms) and the seconds
 * since the last frame (at most 0.05). An error in one frame is reported like any uncaught error, and the next frame
 * comes anyway.
 */
export const animate = (step: (dt: number, now: number) => void): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    let last = performance.now();
    const frame = Effect.map(nextFrame, (now) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000 || 0));
      last = Math.max(last, now);
      try {
        step(dt, now);
      } catch (e) {
        reportError(e);
      }
    });
    yield* Effect.forkScoped(Effect.forever(frame));
  });
