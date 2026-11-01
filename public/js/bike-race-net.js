// Bike Race multiplayer client: one WebSocket to the race server that `mise run app` starts
// (server.py, path /ws). When the page is served by a plain static host there is no server,
// the connection fails, and the game offers races against computer riders instead.
(() => {
'use strict';
const listeners = new Set();
const Net = {
  status: 'idle',          // idle | connecting | online | offline
  id: null,
  ws: null,
  pingMs: 0,
  _retryTimer: 0,
  _pingTimer: 0,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(msg) { for (const fn of listeners) { try { fn(msg); } catch (e) { console.error(e); } } },
  setStatus(s) { if (this.status !== s) { this.status = s; this.emit({ t: 'status', status: s }); } },
  url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  },
  connect() {
    if (this.ws && (this.status === 'online' || this.status === 'connecting')) return;
    if (location.protocol === 'file:' || !location.host) { this.setStatus('offline'); return; }
    clearTimeout(this._retryTimer);
    this.setStatus('connecting');
    let ws;
    try { ws = new WebSocket(this.url()); } catch (e) { this.setStatus('offline'); return; }
    this.ws = ws;
    const giveUp = setTimeout(() => { if (ws.readyState !== 1) { try { ws.close(); } catch (e) {} } }, 4000);
    ws.onopen = () => {
      clearTimeout(giveUp);
      this.setStatus('online');
      clearInterval(this._pingTimer);
      this._pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 5000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'welcome') this.id = msg.id;
      if (msg.t === 'pong') { this.pingMs = Math.round(performance.now() - msg.c); return; }
      this.emit(msg);
    };
    ws.onclose = () => {
      clearTimeout(giveUp); clearInterval(this._pingTimer);
      if (this.ws === ws) { this.ws = null; this.id = null; this.setStatus('offline'); }
    };
    ws.onerror = () => {};
  },
  close() {
    clearInterval(this._pingTimer);
    if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(); } catch (e) {} }
    this.id = null; this.setStatus('idle');
  },
  send(msg) {
    if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(msg)); return true; }
    return false;
  },
};
window.BikeRaceNet = Net;
})();
