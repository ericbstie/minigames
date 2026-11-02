// Bike Race multiplayer client. It talks to the race server in server/serve.ts and server/race.ts, which
// `mise run app` and `mise run phone` start. Messages are JSON, over a WebSocket at /ws or, when the browser won't
// open one (an iPhone can refuse a WebSocket to a self-signed certificate), over an event stream from /net/events
// plus POSTs to /net/send. With neither the page has no race server (a plain static host), and the game offers
// computer riders. The messages are the Schemas in bike-race-protocol.ts: what the server sends is decoded with
// ServerMessage, and anything that doesn't fit is dropped.
//
// A connection that drops (a phone locking its screen, say) reconnects by itself and says hello with the key the
// server gave it, which gets the rider their place back if they return within 45 seconds. The key is kept in
// sessionStorage (SessionSaves), so a reload keeps it too.
//
// In Effect terms: Net.connect opens a scope and Net.close closes it. In that scope one fiber keeps the connection.
// Each transport is a resource of its connection's own scope (closing it closes the socket or the event stream),
// the 4 s open timeout is Effect.timeout, the tries after a drop follow a Schedule, and a heartbeat fiber pings and
// notices a dead connection. Net itself stays a plain object for the game: its listeners are called straight away,
// in order, with every server message and status change.
//
// ?net=ws or ?net=sse in the address uses only that transport (for testing).
import {
  Clock,
  Deferred,
  Effect,
  Exit,
  FiberHandle,
  FiberSet,
  Option,
  Schedule,
  Schema,
  Scope,
  type Types,
} from 'effect';
import * as Protocol from './bike-race-protocol';
import { type ClientMessageOut, StreamOpened } from './bike-race-protocol';
import { run, runSync, SessionSaves } from './page';

// ---------- messages (docs/bike-race.md lists them; bike-race-protocol.ts has them as Schemas) ----------
// bike-race.ts keeps what it is sent in plain arrays, so the types here are the protocol's without readonly.
// (Decoding makes fresh objects, so nothing anyone else holds is changed.)

/** idle (not wanted), connecting (or reconnecting, see Net.retrying), online, offline (no race server) */
export type NetStatus = 'idle' | 'connecting' | 'online' | 'offline';
/** A WebSocket, or an event stream with POSTs */
const TransportKind = Schema.Literals(['ws', 'sse']);
export type TransportKind = typeof TransportKind.Type;
export type RoomState = Protocol.RoomState;
/** A room in the open rooms list */
export type RoomSummary = Types.DeepMutable<Protocol.RoomSummary>;
export type RoomPlayer = Types.DeepMutable<Protocol.RoomPlayer>;
/** One rider's line in a race's results, fastest first */
export type RaceResult = Types.DeepMutable<Protocol.RaceResult>;
/** Whenever anything in a room changes, to everyone in it */
export type RoomMessage = Types.DeepMutable<Protocol.RoomMessage>;
/** A race starts: 3, 2, 1 and GO is `seconds` later */
export type CountdownMessage = Types.DeepMutable<Protocol.CountdownMessage>;
/** What the game sends (the protocol's forgiving fields may be left out) */
export type ClientMessage = ClientMessageOut;
/** What the race server sends (another racer's pose is the six numbers of the core's Pose) */
export type ServerMessage = Types.DeepMutable<Protocol.ServerMessage>;
/** One kind of server message, e.g. ServerMessageOf<'room'> */
export type ServerMessageOf<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;
/** Net's own message when its status changes */
export interface NetStatusEvent {
  t: 'status';
  status: NetStatus;
}
/** What Net.on listeners get: every server message, and status changes */
export type NetEvent = ServerMessage | NetStatusEvent;
export type NetListener = (msg: NetEvent) => void;

const KEY_STORE = 'bikerace.net.key';
const OPEN_TIMEOUT = 4000; // ms to wait for a transport to open
const PING_EVERY = 5000; // ms between pings; the server drops a connection that is silent for 30 s
const DEAD_AFTER = 15000; // ms without any message before the connection counts as dead
const RECONNECT_AFTER = 300; // ms after a drop before the first try to get the connection back
const RETRIES = 6; // tries to get a dropped connection back before giving up

/** The waits between tries to get a dropped connection back: 1, 2, 4, 8 and 8 s, so six tries in all */
export const reconnectSchedule = Schedule.min([Schedule.exponential('1 second'), Schedule.spaced('8 seconds')]).pipe(
  Schedule.upTo({ times: RETRIES - 1 }),
);

// The address can name the one transport to use. (There is no address outside a browser, as in the tests that
// import this for the schedule.)
const forced = Schema.decodeUnknownOption(TransportKind)(
  new URLSearchParams(globalThis.location?.search ?? '').get('net'),
);

// The race key, kept for the tab. A browser that won't keep it (blocked storage) only costs a reload's place back.
const loadKey = Effect.gen(function* () {
  return (yield* (yield* SessionSaves).get(KEY_STORE)) ?? '';
}).pipe(Effect.orElseSucceed(() => ''));
const saveKey = (key: string) =>
  Effect.gen(function* () {
    const saves = yield* SessionSaves;
    yield* key ? saves.set(KEY_STORE, key) : saves.remove(KEY_STORE);
  }).pipe(Effect.ignore);

const parseJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeServer = Schema.decodeUnknownOption(Protocol.ServerMessage);
const decodeOpened = Schema.decodeUnknownOption(StreamOpened);

// ---------- transports ----------

/** A transport that didn't open: refused, failed, or not open within 4 s */
class NoConnection extends Schema.TaggedError<NoConnection>()('NoConnection', { kind: TransportKind }) {}

/** A POST to /net/send that didn't get through (status null), or found its event stream closed (410) */
class PostFailed extends Schema.TaggedError<PostFailed>()('PostFailed', { status: Schema.NullOr(Schema.Number) }) {}

/**
 * One transport: a WebSocket, or an event stream with POSTs. Net._t is the one in use, or being opened. The transport
 * says when it opens and when it drops; its connection (below) waits for those.
 */
class Link {
  open = false; // it can send: the socket opened, or the event stream named itself
  over = false; // dropped, killed or closed: it never sends again
  readonly opened = Deferred.makeUnsafe<void, NoConnection>();
  readonly dropped = Deferred.makeUnsafe<void>();
  write: (msg: ClientMessageOut) => boolean = () => false;

  constructor(readonly kind: TransportKind) {}

  /** Sends a message, if it can */
  send(msg: ClientMessageOut): boolean {
    return !this.over && this.open && this.write(msg);
  }

  /** It can send now */
  opens(): void {
    if (this.over) return;
    this.open = true;
    Deferred.doneUnsafe(this.opened, Exit.void);
  }

  /** It failed or dropped (the tests call this to drop a connection) */
  kill(): void {
    if (this.over) return;
    this.over = true;
    Deferred.doneUnsafe(this.opened, Exit.fail(new NoConnection({ kind: this.kind })));
    Deferred.doneUnsafe(this.dropped, Exit.void);
  }
}

/** A WebSocket to /ws, open until the scope closes */
const webSocket = Effect.gen(function* () {
  const link = new Link('ws');
  const ws = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
        ws.onopen = () => link.opens();
        ws.onmessage = (ev) => heard(link, parseJson(ev.data));
        ws.onclose = () => link.kill();
        ws.onerror = () => {}; // onclose follows
        return ws;
      },
      catch: () => new NoConnection({ kind: 'ws' }),
    }),
    (ws) =>
      Effect.sync(() => {
        link.over = true;
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try {
          ws.close();
        } catch {}
      }),
  );
  link.write = (msg) => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  };
  return link;
});

/** Sends messages to the event stream sid names */
const post = (sid: string, batch: ReadonlyArray<ClientMessageOut>) =>
  Effect.tryPromise({
    // not aborted when the transport closes, so a leave sent just before Net.close still gets there
    try: () =>
      fetch('/net/send?sid=' + encodeURIComponent(sid), {
        method: 'POST',
        body: JSON.stringify(batch),
        headers: { 'Content-Type': 'text/plain' },
        cache: 'no-store',
      }),
    catch: () => new PostFailed({ status: null }),
  }).pipe(Effect.flatMap((r) => (r.status === 410 ? Effect.fail(new PostFailed({ status: 410 })) : Effect.void)));

/** An event stream from /net/events, with POSTs to /net/send, open until the scope closes */
const eventStream = Effect.gen(function* () {
  const link = new Link('sse');
  let sid = '',
    queue: ClientMessageOut[] = [],
    busy = false;
  const posting = yield* FiberSet.makeRuntime(); // the POST under way stops waiting when the transport closes
  // one POST at a time; messages that queue up meanwhile go together in the next one, and only the newest
  // position is worth sending
  const flush = () => {
    if (link.over || busy || !queue.length) return;
    const batch = queue;
    queue = [];
    busy = true;
    posting(
      Effect.match(post(sid, batch), {
        onFailure: () => {
          busy = false;
          link.kill();
        },
        onSuccess: () => {
          busy = false;
          flush();
        },
      }),
    );
  };
  link.write = (msg) => {
    const i = msg.t === 'state' ? queue.findIndex((q) => q.t === 'state') : -1;
    if (i >= 0) queue[i] = msg;
    else queue.push(msg);
    flush();
    return true;
  };
  yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const es = new EventSource('/net/events');
        es.onmessage = (ev) => {
          const m = parseJson(ev.data);
          // the stream's first message, { t: 'conn', sid }, names it for the POSTs
          const named = link.open ? Option.none() : Option.flatMap(m, decodeOpened);
          if (Option.isNone(named)) return heard(link, m);
          sid = named.value.sid;
          link.opens();
          flush();
        };
        es.onerror = () => link.kill(); // EventSource would retry on its own; Net does the retrying
        return es;
      },
      catch: () => new NoConnection({ kind: 'sse' }), // no EventSource in this browser, say
    }),
    (es) =>
      Effect.sync(() => {
        link.over = true;
        es.onmessage = es.onerror = null;
        es.close();
      }),
  );
  return link;
});

// ---------- the connection ----------

const listeners = new Set<NetListener>();
let lastIn = 0; // when the last message came (ms since 1970: Date.now, which is the page's Clock too)
// While Net is wanted (from connect to close): the scope its fibers run in, and the one fiber keeping the connection
let visit: { readonly scope: Scope.Closeable; readonly session: FiberHandle.FiberHandle<void> } | null = null;

const setStatus = (s: NetStatus) => {
  if (Net.status !== s) {
    Net.status = s;
    Net.emit({ t: 'status', status: s });
  }
};

// A message from the transport in use: parsed JSON, or none. Anything that isn't a server message is dropped.
function heard(link: Link, json: Option.Option<unknown>): void {
  const m = Option.flatMap(json, decodeServer);
  if (Net._t === link && Option.isSome(m)) receive(m.value as ServerMessage);
}

function receive(m: ServerMessage): void {
  lastIn = Date.now();
  if (m.t === 'pong') {
    Net.pingMs = Math.round(performance.now() - m.c);
    return;
  }
  if (m.t === 'welcome') {
    Net.id = m.id;
    Net.key = m.key;
    run(saveKey(m.key));
    Net.share = m.share;
  }
  if (m.t === 'replaced') {
    // another tab took this rider over
    Net.key = '';
    run(saveKey(''));
  }
  Net.emit(m);
}

// Every 5 s: a ping, or the end once nothing has come for 15 s (the connection is dead)
const heartbeat = (link: Link) =>
  Effect.gen(function* () {
    for (;;) {
      yield* Effect.sleep(PING_EVERY);
      if ((yield* Clock.currentTimeMillis) - lastIn > DEAD_AFTER) return;
      link.send({ t: 'ping', c: performance.now() });
    }
  });

// One transport, from opening it to its end. Fails with NoConnection if it doesn't open within 4 s; once open, it
// lasts until it drops or goes quiet, and then succeeds.
const connection = (kind: TransportKind) =>
  Effect.scoped(
    Effect.gen(function* () {
      const link = yield* kind === 'ws' ? webSocket : eventStream;
      Net._t = link;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (Net._t !== link) return;
          Net._t = null;
          Net.id = null;
        }),
      );
      yield* Deferred.await(link.opened).pipe(
        Effect.timeout(OPEN_TIMEOUT),
        Effect.catchTag('TimeoutError', () => Effect.fail(new NoConnection({ kind }))),
      );
      Net.mode = kind;
      Net.retrying = false;
      lastIn = yield* Clock.currentTimeMillis;
      setStatus('online');
      yield* Effect.raceFirst(Deferred.await(link.dropped), heartbeat(link));
    }),
  );

// Tries the transport that worked last, then the other one (unless the address picked one). Fails if neither
// opens; once one has opened, succeeds when it ends.
const attempt = Effect.suspend(() => {
  setStatus('connecting');
  const kind = Net.mode;
  if (Option.isSome(forced)) return connection(kind);
  return connection(kind).pipe(Effect.catchTag('NoConnection', () => connection(kind === 'ws' ? 'sse' : 'ws')));
});

// Keeps the connection for as long as Net wants it. A first try that fails means there is no race server: offline.
// After a drop it tries again 300 ms later, and then on the reconnect schedule, and is offline once those run out.
const keepConnected = (retrying: boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (location.protocol === 'file:' || !location.host) return setStatus('offline');
    for (;;) {
      const dropped = yield* Effect.match(retrying ? Effect.retry(attempt, reconnectSchedule) : attempt, {
        onFailure: () => false,
        onSuccess: () => true,
      });
      if (!dropped) {
        Net.retrying = false;
        return setStatus('offline');
      }
      Net.retrying = retrying = true;
      setStatus('connecting');
      yield* Effect.sleep(RECONNECT_AFTER);
    }
  });

// Starts keeping the connection, in Net's scope (opened the first time), in place of any fiber doing so already
const keep = (retrying: boolean) =>
  Effect.gen(function* () {
    if (!visit) {
      const scope = yield* Scope.make();
      visit = { scope, session: yield* Scope.provide(FiberHandle.make<void>(), scope) };
    }
    yield* FiberHandle.clear(visit.session);
    yield* FiberHandle.run(visit.session, keepConnected(retrying));
  });

export const Net = {
  status: 'idle' as NetStatus, // idle | connecting | online | offline
  id: null as string | null, // our rider id, from the server's welcome
  key: runSync(loadKey), // gets our place back after a dropped connection
  share: '', // the server's address on the network, when it listens there (for invite links)
  mode: Option.getOrElse(forced, (): TransportKind => 'ws'), // the transport to try first: the one that worked last
  retrying: false, // lost the connection and trying to get it back
  pingMs: 0,
  _t: null as Link | null, // the transport in use, or being opened
  on(fn: NetListener): () => boolean {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(msg: NetEvent): void {
    for (const fn of listeners) {
      try {
        fn(msg);
      } catch (e) {
        console.error(e);
      }
    }
  },
  get transport(): TransportKind | '' {
    return this._t && this._t.open ? this._t.kind : '';
  },
  // Start talking to the server (if not already). Gives up quickly when there is no server at all.
  connect(): void {
    // already connected, connecting, or waiting to try again
    if (visit && Option.isSome(FiberHandle.getUnsafe(visit.session))) return;
    this.retrying = false;
    run(keep(false));
  },
  close(): void {
    const v = visit;
    visit = null;
    this.retrying = false;
    // stops the fibers, which closes the transport
    if (v) run(Scope.close(v.scope, Exit.void));
    this._t = null;
    this.id = null;
    setStatus('idle');
  },
  // The page is showing again (phones stop pages in the background): check the connection straight away.
  wake(): void {
    if (!visit) return;
    const t = this._t;
    if (t && t.open) {
      // dead: the drop reconnects
      if (Date.now() - lastIn >= PING_EVERY + 2000) t.kill();
      return;
    }
    // waiting to try again, or offline: try now, from the first try
    if (!t) run(keep(this.retrying));
  },
  send(msg: ClientMessage): boolean {
    return !!(this._t && this._t.open && this.status === 'online' && this._t.send(msg));
  },
};
