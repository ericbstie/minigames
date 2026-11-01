// Checks the race server in tools/serve.py without a browser: static files, rooms, a whole race, the event stream
// fallback, dropping out and coming back, and the host handing over. It starts its own server on port 8125 (BR_PORT
// changes it) with short countdown, ending and away times. About 10 seconds.
//
// Usage: node tools/test-race-server.js        (Node 22 or newer, for the built-in WebSocket)
const path = require('path');
const { spawn } = require('child_process');

const PORT = +(process.env.BR_PORT || 8125);
const BASE = `http://127.0.0.1:${PORT}`;
let failed = 0, passed = 0;
const ok = (cond, what, extra) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// A rider over a WebSocket. next(t) waits for the next message of type t (and keeps the others).
function wsRider() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  return rider((m) => ws.send(JSON.stringify(m)), (fn) => { ws.onmessage = (e) => fn(JSON.parse(e.data)); }, () => ws.close(), new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }));
}
// A rider over the event stream plus POSTs, the way the game falls back when a WebSocket won't open.
function sseRider() {
  let sid = '', fn = null, ctl = new AbortController();
  const opened = (async () => {
    const res = await fetch(`${BASE}/net/events`, { signal: ctl.signal });
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    return new Promise((resolve) => {
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i); buf = buf.slice(i + 2);
              const data = block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n');
              if (!data) continue;
              const m = JSON.parse(data);
              if (m.t === 'conn') { sid = m.sid; resolve(); } else if (fn) fn(m);
            }
          }
        } catch (e) { /* aborted */ }
      })();
    });
  })();
  const send = (m) => fetch(`${BASE}/net/send?sid=${sid}`, { method: 'POST', body: JSON.stringify([m]), headers: { 'Content-Type': 'text/plain' } });
  return rider(send, (f) => { fn = f; }, () => ctl.abort(), opened);
}
function rider(send, listen, close, opened) {
  const inbox = [], waiting = [];
  listen((m) => {
    const i = waiting.findIndex(w => w.t === m.t && (!w.when || w.when(m)));
    if (i >= 0) { const [w] = waiting.splice(i, 1); clearTimeout(w.timer); w.resolve(m); } else inbox.push(m);
  });
  return {
    opened, send, close, inbox,
    next(t, when, ms = 3000) {
      const i = inbox.findIndex(m => m.t === t && (!when || when(m)));
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve) => { const w = { t, when, resolve }; w.timer = setTimeout(() => { waiting.splice(waiting.indexOf(w), 1); resolve(null); }, ms); waiting.push(w); });
    },
    drain() { inbox.length = 0; },
  };
}

async function main() {
  const server = spawn('python3', [path.join(__dirname, 'serve.py')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', BR_COUNTDOWN: '0.4', BR_ENDING: '1', BR_AWAY: '1' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  let out = '';
  server.stdout.on('data', d => { out += d; });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/'); break; } catch (e) { await wait(100); } }
    await run(() => out);
  } finally { server.kill(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

async function run(output) {
  console.log('Static files');
  let r = await fetch(BASE + '/');
  ok(r.status === 200 && /text\/html/.test(r.headers.get('content-type')) && /Bike Race/.test(await r.text()), '/ serves index.html');
  r = await fetch(BASE + '/js/bike-race.js');
  const etag = r.headers.get('etag');
  ok(r.status === 200 && /javascript/.test(r.headers.get('content-type')) && etag, 'scripts are served as JavaScript with an ETag');
  r = await fetch(BASE + '/js/bike-race.js', { headers: { 'If-None-Match': etag } });
  ok(r.status === 304, 'an unchanged file answers 304', r.status);
  r = await fetch(BASE + '/assets/fonts/lilita-one.woff2');
  ok(r.status === 200 && r.headers.get('content-type') === 'font/woff2', 'fonts have their type');
  for (const bad of ['/../tools/serve.py', '/%2e%2e/tools/serve.py', '/js/%2e%2e/%2e%2e/mise.toml', '/nope.js', '/.git/config'])
    ok((await fetch(BASE + bad)).status === 404, `${bad} is not found`);
  r = await fetch(BASE + '/', { method: 'HEAD' });
  ok(r.status === 200 && +r.headers.get('content-length') > 1000, 'HEAD works');
  ok((await fetch(BASE + '/', { method: 'POST', body: 'x' })).status === 405, 'POST to a page is refused');
  ok((await fetch(BASE + '/ws')).status === 400, 'a plain GET of /ws is refused');

  console.log('A room and a race over WebSockets');
  const a = wsRider(), b = wsRider();
  await Promise.all([a.opened, b.opened]);
  a.send({ t: 'hello', name: 'Ann\u0007ie', paint: 3, bike: 'comet' });
  const wa = await a.next('welcome');
  ok(wa && /^p\d+$/.test(wa.id) && wa.key && wa.resumed === false, 'hello gets an id and a key', wa);
  b.send({ t: 'hello', name: '', paint: 'x', bike: 'BAD bike' });
  const wb = await b.next('welcome');
  a.send({ t: 'create', level: 'clover-2' });
  let room = await a.next('room');
  ok(room && /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(room.code) && room.host === wa.id && room.level === 'clover-2' && room.state === 'lobby', 'create opens a room with a 4-letter code', room);
  ok(room.players[0].name === 'Annie' && room.players[0].bike === 'comet' && room.players[0].paint === 3, 'the name is cleaned and the bike and paint kept', room.players[0]);
  b.send({ t: 'list' });
  const list = await b.next('rooms');
  ok(list && list.rooms.some(x => x.code === room.code && x.host === 'Annie' && x.count === 1), 'list shows the open room', list);
  b.send({ t: 'join', code: 'zzzz' });
  ok(/no room ZZZZ/i.test((await b.next('error') || {}).msg), 'joining a code that does not exist says so');
  b.send({ t: 'join', code: room.code.toLowerCase() });
  room = await b.next('room', m => m.players.length === 2);
  ok(room && room.players[1].name === 'Rider' && room.players[1].bike === 'scout', 'the second rider joins (lower case code works), with a default name and bike', room && room.players[1]);
  await a.next('room', m => m.players.length === 2);
  b.send({ t: 'level', level: 'ember-1' });
  b.send({ t: 'start' });
  ok(/only the host/i.test((await b.next('error') || {}).msg), 'only the host can start');
  a.send({ t: 'level', level: 'frost-3' });
  ok((await b.next('room', m => m.level === 'frost-3')) !== null, 'the host changes the track');
  a.send({ t: 'start' });
  const [ca, cb] = await Promise.all([a.next('countdown'), b.next('countdown')]);
  ok(ca && cb && ca.level === 'frost-3' && ca.racers.length === 2 && ca.seconds > 0, 'start sends a countdown to everyone', ca);
  ok((await a.next('room', m => m.state === 'race')) !== null, 'the room goes from countdown to race');
  a.send({ t: 'state', p: [1, 2, 0.5, 3, 0, 0], c: 0.05 });
  const st = await b.next('state');
  ok(st && st.id === wa.id && st.p[0] === 1 && st.c === 0.05, 'positions are passed to the other riders', st);
  a.send({ t: 'state', p: [1, 'x'] });
  ok(await b.next('state', null, 300) === null, 'a bad position is dropped');
  a.send({ t: 'finish', time: 21.5 });
  const fin = await b.next('finished');
  ok(fin && fin.id === wa.id && fin.time === 21.5, 'a finish is announced', fin);
  const end = await b.next('ending');
  ok(end && end.seconds > 0, 'the first finish starts the closing clock', end);
  b.send({ t: 'finish', time: 23.25 });
  const res = await a.next('results');
  ok(res && res.results.map(x => x.name + ' ' + x.time).join(', ') === 'Annie 21.5, Rider 23.25', 'results come in finishing order', res);
  room = await a.next('room', m => m.state === 'lobby' && m.racers.length === 0 && m.players.some(p => p.wins > 0));
  ok(room && room.players.find(p => p.id === wa.id).wins === 1, 'the winner gets a win and the room is back in the lobby', room);

  console.log('A race that runs out of time, and the event stream');
  const c = sseRider();
  await c.opened;
  c.send({ t: 'hello', name: 'Cy', paint: 5, bike: 'bulldog' });
  const wc = await c.next('welcome');
  ok(wc && wc.id, 'a rider over the event stream says hello', wc);
  c.send({ t: 'join', code: room.code });
  room = await c.next('room', m => m.players.length === 3);
  ok(room !== null, 'and joins the room');
  a.send({ t: 'start' });
  ok((await c.next('countdown')) !== null, 'the event stream gets the countdown');
  await c.next('room', m => m.state === 'race');
  b.send({ t: 'state', p: [5, 1, 0, 0, 0, 0], c: 1 });
  ok((await c.next('state', m => m.id === wb.id)) !== null, 'and the other riders\' positions');
  c.send({ t: 'finish', time: 30 });
  ok((await a.next('finished', m => m.id === wc.id)) !== null, 'its finish reaches the others');
  b.send({ t: 'retire' });
  const res2 = await a.next('results', null, 3000);
  ok(res2 && res2.results[0].name === 'Cy' && res2.results.slice(1).every(x => x.time === null), 'the closing clock ends the race, the others did not finish', res2);
  const bad = await fetch(`${BASE}/net/send?sid=nope`, { method: 'POST', body: '[]' });
  ok(bad.status === 410, 'posting to a closed stream answers 410', bad.status);

  console.log('Dropping out and coming back');
  a.drain(); b.drain(); c.drain();
  a.close();
  room = await b.next('room', m => m.players.find(p => p.id === wa.id).away);
  ok(room && room.host === wa.id, 'a dropped host is shown as away and keeps the room', room);
  const a2 = wsRider();
  await a2.opened;
  a2.send({ t: 'hello', name: 'Annie', paint: 3, bike: 'comet', key: wa.key });
  const wa2 = await a2.next('welcome');
  ok(wa2 && wa2.resumed && wa2.id === wa.id, 'coming back with the key resumes the same rider', wa2);
  room = await a2.next('room');
  ok(room && room.players.length === 3 && !room.players.find(p => p.id === wa.id).away, 'and puts them back in the room', room);
  const a3 = wsRider();
  await a3.opened;
  a3.send({ t: 'hello', name: 'Annie', key: wa.key });
  ok((await a2.next('replaced')) !== null && (await a3.next('welcome')).id === wa.id, 'a second connection with the same key takes over');
  a3.close();
  await wait(1500);
  room = await b.next('room', m => !m.players.some(p => p.id === wa.id));
  ok(room && room.host === wb.id, 'after the away time the rider is gone and the host passes on', room);
  b.send({ t: 'leave' });
  ok((await b.next('left')) !== null, 'leave is confirmed');
  c.send({ t: 'leave' });
  await c.next('left');
  b.send({ t: 'list' });
  ok(!(await b.next('rooms')).rooms.some(x => x.code === room.code), 'an empty room closes');
  b.close(); c.close();
  ok(/opened room/.test(output()) && /results:/.test(output()), 'the server logs rooms and results');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
