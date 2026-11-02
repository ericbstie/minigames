// Main menu routing: #ant-sort, #castle-defender, #water-sort, #bike-race (or #bike-race/CODE to join a room), or
// the menu. Each game registers itself with registerGame; the hub shows one game's screen and hides the others.
//
// A game runs in a scope while it is on screen: the hub opens a scope and runs the game's `open` effect in it when
// the player arrives, and closes it when they leave, which removes the game's listeners and stops its loops and
// timers (page.ts has the helpers that tie them to the scope).
//
// Each time the menu shows, its cards say how far the player has got in each game (the stars, a level or a game left
// in progress), from what the game has saved.
import { Effect, Exit, Scope } from 'effect';
import { type PageServices, run } from './page';

export type GameId = 'ant' | 'castle' | 'ws' | 'br';

export interface Game {
  /** The player opened the game. What it sets up in the scope lasts until they leave. */
  readonly open: Effect.Effect<void, never, Scope.Scope | PageServices>;
  /** The address changed while the game is open (#bike-race to #bike-race/CODE, say) */
  readonly reroute?: Effect.Effect<void, never, PageServices>;
  /** What the game's card on the menu says of the player's progress: a few short notes, none before they have any */
  readonly progress?: Effect.Effect<readonly string[], never, PageServices>;
}

// The element that holds each game's screen
const SCREENS: Record<GameId, string> = { ant: 'app', castle: 'cd-app', ws: 'ws-app', br: 'br-app' };
// Each game's address, which is also its card's data-game
const ADDRESSES: Record<GameId, string> = {
  ant: 'ant-sort',
  castle: 'castle-defender',
  ws: 'water-sort',
  br: 'bike-race',
};
const games: Partial<Record<GameId, Game>> = {};
// The game on screen and its scope
let current: { id: GameId; scope: Scope.Closeable } | null = null;

export function registerGame(id: GameId, game: Game): void {
  games[id] = game;
}

function wanted(): GameId | 'menu' {
  const h = location.hash.slice(1);
  if (h.startsWith('bike-race/')) return 'br';
  return (Object.keys(ADDRESSES) as GameId[]).find((id) => ADDRESSES[id] === h) ?? 'menu';
}

// The notes under each card, read again from the games' saves
const showProgress = Effect.suspend(() =>
  Effect.forEach(
    Object.keys(games) as GameId[],
    (id) =>
      Effect.gen(function* () {
        const box = document.querySelector(`.hub-card[data-game="${ADDRESSES[id]}"] .pg`),
          progress = games[id]?.progress;
        if (!box || !progress) return;
        const notes = yield* progress;
        box.replaceChildren(
          ...notes.map((text) => {
            const note = document.createElement('span');
            note.textContent = text;
            return note;
          }),
        );
      }),
    { discard: true },
  ),
);

/** Shows the screen the address asks for: closes the game being left, and opens the one arrived at */
export const route: Effect.Effect<void, never, PageServices> = Effect.gen(function* () {
  const game = wanted();
  document.getElementById('hub')!.hidden = game !== 'menu';
  const ids = Object.keys(SCREENS) as GameId[];
  for (const id of ids) document.getElementById(SCREENS[id])!.hidden = game !== id;
  if (current && current.id !== game) {
    const left = current;
    current = null;
    yield* Scope.close(left.scope, Exit.void);
  }
  if (game === 'menu') return yield* showProgress;
  const next = games[game];
  if (!next) return;
  if (current) return yield* next.reroute ?? Effect.void;
  const scope = yield* Scope.make();
  current = { id: game, scope };
  // the game opens in a fiber of its own scope, so leaving before it has finished opening stops that too
  yield* Effect.forkIn(Scope.provide(next.open, scope), scope);
});

export const GameHub = {
  route(): void {
    run(route);
  },
  open(name: string): void {
    if (location.hash.slice(1) === name) this.route();
    else location.hash = name;
  },
  menu(): void {
    if (location.hash) {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch {
        location.hash = '';
      }
    }
    this.route();
  },
};

// for the browser tests (tests/smoke.test.ts goes back to the menu through it)
window.GameHub = GameHub;
