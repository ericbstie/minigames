// Bike Race multiplayer client. It talks to the race server in server/serve.ts and server/race.ts, which
// `mise run app` and `mise run phone` start. Messages are JSON, over a WebSocket at /ws or, when the browser won't
// open one (an iPhone can refuse a WebSocket to a self-signed certificate), over an event stream from /net/events
// plus POSTs to /net/send. With neither the page has no race server (a plain static host), and the game offers
// computer riders.
//
// A connection that drops (a phone locking its screen, say) reconnects by itself and says hello with the key the
// server gave it, which gets the rider their place back if they return within 45 seconds. The key is kept in
// sessionStorage, so a reload keeps it too.
//
// ?net=ws or ?net=sse in the address uses only that transport (for testing).
import type { Pose } from './bike-race-core';

// ---------- messages (docs/bike-race.md lists them; server/race.ts handles them) ----------
/** idle (not wanted), connecting (or reconnecting, see Net.retrying), online, offline (no race server) */
export type NetStatus = 'idle' | 'connecting' | 'online' | 'offline';
/** A WebSocket, or an event stream with POSTs */
export type TransportKind = 'ws' | 'sse';
export type RoomState = 'lobby' | 'countdown' | 'race';
/** A room in the open rooms list */
export interface RoomSummary {
  code: string;
  host: string; // the host's name
  level: string;
  count: number;
  state: RoomState;
}
export interface RoomPlayer {
  id: string;
  name: string;
  paint: number;
  bike: string;
  wins: number;
  away: boolean; // dropped out, and keeping their place for a while
}
/** One rider's line in a race's results, fastest first */
export interface RaceResult {
  id: string;
  name: string;
  paint: number;
  bike: string;
  time: number | null; // null for DNF
}
/** Whenever anything in a room changes, to everyone in it */
export interface RoomMessage {
  t: 'room';
  code: string;
  host: string; // the host's id
  level: string;
  state: RoomState;
  players: RoomPlayer[]; // in the order they joined
  racers: string[]; // ids in the race on now
  ending: number | null; // seconds until the race closes, once someone has finished
  last: RaceResult[] | null; // the last race's results
}
/** A race starts: 3, 2, 1 and GO is `seconds` later */
export interface CountdownMessage {
  t: 'countdown';
  level: string;
  racers: string[];
  seconds: number;
}
/** What the game sends */
export type ClientMessage =
  | { t: 'hello'; name: string; paint: number; bike: string; key: string } // first, and when the profile changes
  | { t: 'list' }
  | { t: 'create'; level: string }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'level'; level: string } // host only
  | { t: 'start' } // host only
  | { t: 'state'; p: Pose; c: number } // our pose and race clock
  | { t: 'finish'; time: number }
  | { t: 'retire' } // gave up the race but stays in the room
  | { t: 'ping'; c: number };
/** What the race server sends. Net trusts it to send these shapes, and only checks that each one has a type in t. */
export type ServerMessage =
  | { t: 'welcome'; id: string; key: string; resumed: boolean; share: string }
  | { t: 'rooms'; rooms: RoomSummary[] }
  | RoomMessage
  | { t: 'left' }
  | { t: 'error'; msg: string; code?: string }
  | { t: 'replaced' } // another tab took this rider over
  | CountdownMessage
  | { t: 'state'; id: string; p: Pose; c?: number } // another racer's pose and race clock
  | { t: 'finished'; id: string; time: number }
  | { t: 'ending'; seconds: number }
  | { t: 'results'; level: string; results: RaceResult[] }
  | { t: 'pong'; c: number };
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
const RETRIES = 6; // attempts to get a dropped connection back before giving up
// the pattern only matches ws or sse
const forced = ((/[?&]net=(ws|sse)\b/.exec(location.search) || [])[1] || '') as TransportKind | '';
const store = {
  get(): string {
    try {
      return sessionStorage.getItem(KEY_STORE) || '';
    } catch {
      return '';
    }
  },
  set(v: string): void {
    try {
      if (v) sessionStorage.setItem(KEY_STORE, v);
      else sessionStorage.removeItem(KEY_STORE);
    } catch {}
  },
};
// a message is an object with its type in t
const isMessage = (m: unknown): m is { t: string; [field: string]: unknown } =>
  typeof m === 'object' && m !== null && 't' in m && typeof m.t === 'string';

// Each transport calls t.onopen() once it can send, t.onmessage(msg) for each message, and t.onclose(wasOpen) once,
// when it fails or drops. close() shuts it without calling onclose; kill() shuts it and calls onclose.
interface Transport {
  open: boolean;
  kind: TransportKind;
  onopen: () => void;
  onmessage: (msg: unknown) => void; // parsed JSON, not checked yet
  onclose: (wasOpen: boolean) => void;
  close(): void;
  kill(): void;
  send(m: ClientMessage): boolean;
}
// Net sets the handlers before the transport starts (it starts on the next tick)
const unset = () => {};
function wsTransport(): Transport {
  let ws: WebSocket | null = null,
    over = false,
    timer = 0;
  const end = () => {
    if (over) return false;
    over = true;
    clearTimeout(timer);
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = null;
      try {
        ws.close();
      } catch {}
    }
    return true;
  };
  const t: Transport = {
    open: false,
    kind: 'ws',
    onopen: unset,
    onmessage: unset,
    onclose: unset,
    close: () => {
      end();
    },
    kill: () => {
      if (end()) t.onclose(t.open);
    },
    send: (m) => {
      if (!over && ws && ws.readyState === 1) {
        ws.send(JSON.stringify(m));
        return true;
      }
      return false;
    },
  };
  setTimeout(() => {
    if (over) return;
    try {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    } catch {
      t.kill();
      return;
    }
    timer = window.setTimeout(() => {
      if (!t.open) t.kill();
    }, OPEN_TIMEOUT);
    ws.onopen = () => {
      clearTimeout(timer);
      t.open = true;
      t.onopen();
    };
    ws.onmessage = (ev) => {
      let m: unknown;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      t.onmessage(m);
    };
    ws.onclose = () => t.kill();
    ws.onerror = () => {};
  }, 0);
  return t;
}
function sseTransport(): Transport {
  let es: EventSource | null = null,
    over = false,
    timer = 0,
    sid = '',
    queue: ClientMessage[] = [],
    busy = false;
  const end = () => {
    if (over) return false;
    over = true;
    clearTimeout(timer);
    if (es) {
      es.onmessage = es.onerror = null;
      es.close();
    }
    return true;
  };
  // one POST at a time; messages that queue up meanwhile go together in the next one, and only the newest
  // position is worth sending
  const flush = () => {
    if (over || busy || !queue.length) return;
    const batch = queue;
    queue = [];
    busy = true;
    fetch('/net/send?sid=' + encodeURIComponent(sid), {
      method: 'POST',
      body: JSON.stringify(batch),
      headers: { 'Content-Type': 'text/plain' },
      cache: 'no-store',
    })
      .then((r) => {
        busy = false;
        if (r.status === 410) t.kill();
        else flush();
      })
      .catch(() => {
        busy = false;
        t.kill();
      });
  };
  const t: Transport = {
    open: false,
    kind: 'sse',
    onopen: unset,
    onmessage: unset,
    onclose: unset,
    close: () => {
      end();
    },
    kill: () => {
      if (end()) t.onclose(t.open);
    },
    send: (m) => {
      if (over || !t.open) return false;
      const i = m.t === 'state' ? queue.findIndex((q) => q.t === 'state') : -1;
      if (i >= 0) queue[i] = m;
      else queue.push(m);
      flush();
      return true;
    },
  };
  setTimeout(() => {
    if (over) return;
    if (typeof EventSource === 'undefined') {
      t.kill();
      return;
    }
    try {
      es = new EventSource('/net/events');
    } catch {
      t.kill();
      return;
    }
    timer = window.setTimeout(() => {
      if (!t.open) t.kill();
    }, OPEN_TIMEOUT);
    es.onmessage = (ev) => {
      let m: unknown;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      // the stream's first message, { t: 'conn', sid }, names it for the POSTs
      if (isMessage(m) && m.t === 'conn' && !t.open) {
        sid = String(m.sid);
        clearTimeout(timer);
        t.open = true;
        t.onopen();
        flush();
        return;
      }
      t.onmessage(m);
    };
    es.onerror = () => t.kill(); // EventSource would retry on its own; Net does the retrying
  }, 0);
  return t;
}

const listeners = new Set<NetListener>();
export const Net = {
  status: 'idle' as NetStatus, // idle | connecting | online | offline
  id: null as string | null, // our rider id, from the server's welcome
  key: store.get(), // gets our place back after a dropped connection
  share: '', // the server's address on the network, when it listens there (for invite links)
  mode: (forced || 'ws') as TransportKind, // the transport to try first: the one that worked last
  retrying: false, // lost the connection and trying to get it back
  pingMs: 0,
  _t: null as Transport | null,
  _want: false,
  _tries: 0,
  _retryTimer: 0,
  _pingTimer: 0,
  _lastIn: 0,
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
  setStatus(s: NetStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.emit({ t: 'status', status: s });
    }
  },
  get transport(): TransportKind | '' {
    return this._t && this._t.open ? this._t.kind : '';
  },
  // Start talking to the server (if not already). Gives up quickly when there is no server at all.
  connect(): void {
    this._want = true;
    if (this._t || this._retryTimer) return;
    this._tries = 0;
    this.retrying = false;
    this._attempt();
  },
  close(): void {
    this._want = false;
    this.retrying = false;
    clearTimeout(this._retryTimer);
    this._retryTimer = 0;
    clearInterval(this._pingTimer);
    const t = this._t;
    this._t = null;
    if (t) t.close();
    this.id = null;
    this.setStatus('idle');
  },
  // The page is showing again (phones stop pages in the background): check the connection straight away.
  wake(): void {
    if (!this._want) return;
    if (this._t && this._t.open && Date.now() - this._lastIn < PING_EVERY + 2000) return;
    if (this._t && this._t.open) {
      // dead: onclose reconnects
      this._t.kill();
      return;
    }
    if (!this._t) {
      clearTimeout(this._retryTimer);
      this._retryTimer = 0;
      this._tries = 0;
      this._attempt();
    }
  },
  send(msg: ClientMessage): boolean {
    return !!(this._t && this._t.open && this.status === 'online' && this._t.send(msg));
  },
  _attempt(): void {
    this._retryTimer = 0;
    if (location.protocol === 'file:' || !location.host) {
      this.setStatus('offline');
      return;
    }
    this.setStatus('connecting');
    this._start(this.mode, !forced);
  },
  // tries one transport; if it won't open and switching is allowed, tries the other one before counting a failure
  _start(kind: TransportKind, canSwitch: boolean): void {
    const t = kind === 'sse' ? sseTransport() : wsTransport();
    this._t = t;
    t.onopen = () => {
      if (this._t !== t) return;
      this.mode = kind;
      this._tries = 0;
      this.retrying = false;
      this._lastIn = Date.now();
      clearInterval(this._pingTimer);
      this._pingTimer = window.setInterval(() => this._tick(), PING_EVERY);
      this.setStatus('online');
    };
    // anything that isn't an object with a type in t is dropped; the rest is taken to be a ServerMessage
    t.onmessage = (m) => {
      if (this._t === t && isMessage(m)) this._receive(m as ServerMessage);
    };
    t.onclose = (wasOpen) => {
      if (this._t !== t) return;
      this._t = null;
      this.id = null;
      clearInterval(this._pingTimer);
      if (!this._want) {
        this.setStatus('idle');
        return;
      }
      if (wasOpen) {
        this.retrying = true;
        this._tries = 0;
        this.setStatus('connecting');
        this._retry(300);
        return;
      }
      if (canSwitch) {
        this._start(kind === 'ws' ? 'sse' : 'ws', false);
        return;
      }
      this._tries++;
      if (!this.retrying || this._tries >= RETRIES) {
        this.retrying = false;
        this.setStatus('offline');
        return;
      }
      this._retry(Math.min(8000, 1000 * 2 ** (this._tries - 1)));
    };
  },
  _retry(ms: number): void {
    clearTimeout(this._retryTimer);
    this._retryTimer = window.setTimeout(() => this._attempt(), ms);
  },
  _tick(): void {
    if (!this._t || !this._t.open) return;
    if (Date.now() - this._lastIn > DEAD_AFTER) {
      this._t.kill();
      return;
    }
    this._t.send({ t: 'ping', c: performance.now() });
  },
  _receive(m: ServerMessage): void {
    this._lastIn = Date.now();
    if (m.t === 'pong') {
      if (typeof m.c === 'number') this.pingMs = Math.round(performance.now() - m.c);
      return;
    }
    if (m.t === 'welcome') {
      this.id = m.id;
      this.key = String(m.key || '');
      store.set(this.key);
      this.share = typeof m.share === 'string' ? m.share : '';
    }
    if (m.t === 'replaced') {
      // another tab took this rider over
      this.key = '';
      store.set('');
    }
    this.emit(m);
  },
};
