// Bike Race multiplayer client. It talks to the race server in tools/serve.py, which `mise run app` and
// `mise run phone` start. Messages are JSON, over a WebSocket at /ws or, when the browser won't open one (an iPhone
// can refuse a WebSocket to a self-signed certificate), over an event stream from /net/events plus POSTs to
// /net/send. With neither the page has no race server (a plain static host), and the game offers computer riders.
//
// A connection that drops (a phone locking its screen, say) reconnects by itself and says hello with the key the
// server gave it, which gets the rider their place back if they return within 45 seconds. The key is kept in
// sessionStorage, so a reload keeps it too.
//
// ?net=ws or ?net=sse in the address uses only that transport (for testing).
(() => {
'use strict';
const KEY_STORE = 'bikerace.net.key';
const OPEN_TIMEOUT = 4000;     // ms to wait for a transport to open
const PING_EVERY = 5000;       // ms between pings; the server drops a connection that is silent for 30 s
const DEAD_AFTER = 15000;      // ms without any message before the connection counts as dead
const RETRIES = 6;             // attempts to get a dropped connection back before giving up
const forced = (/[?&]net=(ws|sse)\b/.exec(location.search) || [])[1] || '';
const store = {
  get() { try { return sessionStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } },
  set(v) { try { if (v) sessionStorage.setItem(KEY_STORE, v); else sessionStorage.removeItem(KEY_STORE); } catch (e) {} },
};

// Each transport calls t.onopen() once it can send, t.onmessage(msg) for each message, and t.onclose(wasOpen) once,
// when it fails or drops. close() shuts it without calling onclose; kill() shuts it and calls onclose.
function wsTransport() {
  const t = { open: false, kind: 'ws' };
  let ws = null, over = false, timer = 0;
  const end = () => { if (over) return false; over = true; clearTimeout(timer); if (ws) { ws.onopen = ws.onmessage = ws.onclose = null; try { ws.close(); } catch (e) {} } return true; };
  t.close = () => { end(); };
  t.kill = () => { if (end()) t.onclose(t.open); };
  t.send = (m) => { if (!over && ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } return false; };
  setTimeout(() => {
    if (over) return;
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); } catch (e) { t.kill(); return; }
    timer = setTimeout(() => { if (!t.open) t.kill(); }, OPEN_TIMEOUT);
    ws.onopen = () => { clearTimeout(timer); t.open = true; t.onopen(); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } t.onmessage(m); };
    ws.onclose = () => t.kill();
    ws.onerror = () => {};
  }, 0);
  return t;
}
function sseTransport() {
  const t = { open: false, kind: 'sse' };
  let es = null, over = false, timer = 0, sid = '', queue = [], busy = false;
  const end = () => { if (over) return false; over = true; clearTimeout(timer); if (es) { es.onmessage = es.onerror = null; es.close(); } return true; };
  t.close = () => { end(); };
  t.kill = () => { if (end()) t.onclose(t.open); };
  // one POST at a time; messages that queue up meanwhile go together in the next one, and only the newest
  // position is worth sending
  const flush = () => {
    if (over || busy || !queue.length) return;
    const batch = queue; queue = []; busy = true;
    fetch('/net/send?sid=' + encodeURIComponent(sid), { method: 'POST', body: JSON.stringify(batch), headers: { 'Content-Type': 'text/plain' }, cache: 'no-store' })
      .then((r) => { busy = false; if (r.status === 410) t.kill(); else flush(); })
      .catch(() => { busy = false; t.kill(); });
  };
  t.send = (m) => {
    if (over || !t.open) return false;
    const i = m.t === 'state' ? queue.findIndex(q => q.t === 'state') : -1;
    if (i >= 0) queue[i] = m; else queue.push(m);
    flush();
    return true;
  };
  setTimeout(() => {
    if (over) return;
    if (typeof EventSource === 'undefined') { t.kill(); return; }
    try { es = new EventSource('/net/events'); } catch (e) { t.kill(); return; }
    timer = setTimeout(() => { if (!t.open) t.kill(); }, OPEN_TIMEOUT);
    es.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m && m.t === 'conn' && !t.open) { sid = String(m.sid); clearTimeout(timer); t.open = true; t.onopen(); flush(); return; }
      t.onmessage(m);
    };
    es.onerror = () => t.kill();      // EventSource would retry on its own; Net does the retrying
  }, 0);
  return t;
}

const listeners = new Set();
const Net = {
  status: 'idle',          // idle | connecting | online | offline
  id: null,                // our rider id, from the server's welcome
  key: store.get(),        // gets our place back after a dropped connection
  share: '',               // the server's address on the network, when it listens there (for invite links)
  mode: forced || 'ws',    // the transport to try first: the one that worked last
  retrying: false,         // lost the connection and trying to get it back
  pingMs: 0,
  _t: null, _want: false, _tries: 0, _retryTimer: 0, _pingTimer: 0, _lastIn: 0,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(msg) { for (const fn of listeners) { try { fn(msg); } catch (e) { console.error(e); } } },
  setStatus(s) { if (this.status !== s) { this.status = s; this.emit({ t: 'status', status: s }); } },
  get transport() { return this._t && this._t.open ? this._t.kind : ''; },
  // Start talking to the server (if not already). Gives up quickly when there is no server at all.
  connect() {
    this._want = true;
    if (this._t || this._retryTimer) return;
    this._tries = 0; this.retrying = false;
    this._attempt();
  },
  close() {
    this._want = false; this.retrying = false;
    clearTimeout(this._retryTimer); this._retryTimer = 0;
    clearInterval(this._pingTimer);
    const t = this._t; this._t = null; if (t) t.close();
    this.id = null;
    this.setStatus('idle');
  },
  // The page is showing again (phones stop pages in the background): check the connection straight away.
  wake() {
    if (!this._want) return;
    if (this._t && this._t.open && Date.now() - this._lastIn < PING_EVERY + 2000) return;
    if (this._t && this._t.open) { this._t.kill(); return; }      // dead: onclose reconnects
    if (!this._t) { clearTimeout(this._retryTimer); this._retryTimer = 0; this._tries = 0; this._attempt(); }
  },
  send(msg) { return !!(this._t && this._t.open && this.status === 'online' && this._t.send(msg)); },
  _attempt() {
    this._retryTimer = 0;
    if (location.protocol === 'file:' || !location.host) { this.setStatus('offline'); return; }
    this.setStatus('connecting');
    this._start(this.mode, !forced);
  },
  // tries one transport; if it won't open and switching is allowed, tries the other one before counting a failure
  _start(kind, canSwitch) {
    const t = kind === 'sse' ? sseTransport() : wsTransport();
    this._t = t;
    t.onopen = () => {
      if (this._t !== t) return;
      this.mode = kind; this._tries = 0; this.retrying = false; this._lastIn = Date.now();
      clearInterval(this._pingTimer);
      this._pingTimer = setInterval(() => this._tick(), PING_EVERY);
      this.setStatus('online');
    };
    t.onmessage = (m) => { if (this._t === t && m && typeof m.t === 'string') this._receive(m); };
    t.onclose = (wasOpen) => {
      if (this._t !== t) return;
      this._t = null; this.id = null; clearInterval(this._pingTimer);
      if (!this._want) { this.setStatus('idle'); return; }
      if (wasOpen) { this.retrying = true; this._tries = 0; this.setStatus('connecting'); this._retry(300); return; }
      if (canSwitch) { this._start(kind === 'ws' ? 'sse' : 'ws', false); return; }
      this._tries++;
      if (!this.retrying || this._tries >= RETRIES) { this.retrying = false; this.setStatus('offline'); return; }
      this._retry(Math.min(8000, 1000 * 2 ** (this._tries - 1)));
    };
  },
  _retry(ms) { clearTimeout(this._retryTimer); this._retryTimer = setTimeout(() => this._attempt(), ms); },
  _tick() {
    if (!this._t || !this._t.open) return;
    if (Date.now() - this._lastIn > DEAD_AFTER) { this._t.kill(); return; }
    this._t.send({ t: 'ping', c: performance.now() });
  },
  _receive(m) {
    this._lastIn = Date.now();
    if (m.t === 'pong') { if (typeof m.c === 'number') this.pingMs = Math.round(performance.now() - m.c); return; }
    if (m.t === 'welcome') { this.id = m.id; this.key = String(m.key || ''); store.set(this.key); this.share = typeof m.share === 'string' ? m.share : ''; }
    if (m.t === 'replaced') { this.key = ''; store.set(''); }      // another tab took this rider over
    this.emit(m);
  },
};
window.BikeRaceNet = Net;
})();
