// Checks the race server (server/serve.ts and server/race.ts) without a browser: the page, rooms, a whole race, the
// event stream fallback, dropping out and coming back, and the host handing over. It runs the server in-process on a
// free port with short countdown, ending and away times. The tests run in order and share the riders.
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { startSite } from './support/browser';

setDefaultTimeout(10_000);
type Msg = Record<string, any>;

const site = startSite({ countdown: 0.4, ending: 1, away: 1 });
const BASE = site.url('').replace(/\/$/, '');
afterAll(() => site.stop());

interface Rider {
  opened: Promise<unknown>;
  send(m: Msg): unknown;
  close(): void;
  /** The next message of type t (that passes `when`), or null after ms. Other messages are kept for later. */
  next(t: string, when?: ((m: Msg) => boolean) | null, ms?: number): Promise<Msg | null>;
  drain(): void;
}

function rider(
  send: (m: Msg) => unknown,
  listen: (fn: (m: Msg) => void) => void,
  close: () => void,
  opened: Promise<unknown>,
): Rider {
  const inbox: Msg[] = [];
  const waiting: { t: string; when?: ((m: Msg) => boolean) | null; resolve: (m: Msg | null) => void; timer?: Timer }[] =
    [];
  listen((m) => {
    const i = waiting.findIndex((w) => w.t === m.t && (!w.when || w.when(m)));
    if (i >= 0) {
      const [w] = waiting.splice(i, 1);
      clearTimeout(w!.timer);
      w!.resolve(m);
    } else inbox.push(m);
  });
  return {
    opened,
    send,
    close,
    next(t, when, ms = 3000) {
      const i = inbox.findIndex((m) => m.t === t && (!when || when(m)));
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]!);
      return new Promise((resolve) => {
        const w: (typeof waiting)[number] = { t, when, resolve };
        w.timer = setTimeout(() => {
          waiting.splice(waiting.indexOf(w), 1);
          resolve(null);
        }, ms);
        waiting.push(w);
      });
    },
    drain() {
      inbox.length = 0;
    },
  };
}

// A rider over a WebSocket.
function wsRider(): Rider {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws`);
  return rider(
    (m) => ws.send(JSON.stringify(m)),
    (fn) => (ws.onmessage = (e) => fn(JSON.parse(e.data as string))),
    () => ws.close(),
    new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    }),
  );
}

// A rider over the event stream plus POSTs, the way the game falls back when a WebSocket won't open.
function sseRider(): Rider {
  let sid = '';
  let fn: ((m: Msg) => void) | null = null;
  const ctl = new AbortController();
  const opened = (async () => {
    const res = await fetch(`${BASE}/net/events`, { signal: ctl.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    return new Promise<void>((resolve) => {
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const data = block
                .split('\n')
                .filter((l) => l.startsWith('data: '))
                .map((l) => l.slice(6))
                .join('\n');
              if (!data) continue;
              const m = JSON.parse(data);
              if (m.t === 'conn') {
                sid = m.sid;
                resolve();
              } else fn?.(m);
            }
          }
        } catch {
          // aborted
        }
      })();
    });
  })();
  const send = (m: Msg) =>
    fetch(`${BASE}/net/send?sid=${sid}`, {
      method: 'POST',
      body: JSON.stringify([m]),
      headers: { 'Content-Type': 'text/plain' },
    });
  return rider(
    send,
    (f) => (fn = f),
    () => ctl.abort(),
    opened,
  );
}

describe('the page', () => {
  let html = '';
  test('/ serves the page', async () => {
    const r = await fetch(BASE + '/');
    html = await r.text();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('Bike Race');
  });

  test('the bundled script is served as JavaScript with an ETag, and an unchanged one answers 304', async () => {
    const src = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
    expect(src).toBeTruthy();
    let r = await fetch(BASE + src);
    const etag = r.headers.get('etag');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('javascript');
    expect(etag).toBeTruthy();
    r = await fetch(BASE + src, { headers: { 'If-None-Match': etag! } });
    expect(r.status).toBe(304);
  });

  test('the stylesheet carries the fonts', async () => {
    const href = html.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
    const r = await fetch(BASE + href);
    expect(r.headers.get('content-type')).toContain('text/css');
    expect(await r.text()).toContain('font/woff2');
  });

  for (const bad of [
    '/../server/serve.ts',
    '/%2e%2e/server/serve.ts',
    '/js/%2e%2e/%2e%2e/mise.toml',
    '/js/main.ts',
    '/package.json',
    '/nope.js',
    '/.git/config',
  ])
    test(`${bad} is not found`, async () => {
      expect((await fetch(BASE + bad)).status).toBe(404);
    });

  test('HEAD works', async () => {
    const r = await fetch(BASE + '/', { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(+r.headers.get('content-length')!).toBeGreaterThan(1000);
  });

  test('a plain GET of /ws is refused', async () => {
    expect((await fetch(BASE + '/ws')).status).toBe(400);
  });

  test('a WebSocket from another site is refused', async () => {
    const r = await fetch(BASE + '/ws', {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade', Origin: 'http://evil.example' },
    });
    expect(r.status).toBe(403);
  });
});

// The riders and what they learn, shared by the tests below
const a = wsRider(),
  b = wsRider();
let wa: Msg, wb: Msg, wc: Msg, room: Msg;
let c: Rider;

describe('a room and a race over WebSockets', () => {
  test('hello gets an id and a key', async () => {
    await Promise.all([a.opened, b.opened]);
    a.send({ t: 'hello', name: 'Ann\u0007ie', paint: 3, bike: 'comet' });
    wa = (await a.next('welcome'))!;
    expect(wa.id).toMatch(/^p\d+$/);
    expect(wa.key).toBeTruthy();
    expect(wa.resumed).toBe(false);
    b.send({ t: 'hello', name: '', paint: 'x', bike: 'BAD bike' });
    wb = (await b.next('welcome'))!;
  });

  test('create opens a room with a 4-letter code', async () => {
    a.send({ t: 'create', level: 'clover-2' });
    room = (await a.next('room'))!;
    expect(room.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(room).toMatchObject({ host: wa.id, level: 'clover-2', state: 'lobby' });
  });

  test('the name is cleaned and the bike and paint kept', () => {
    expect(room.players[0]).toMatchObject({ name: 'Annie', bike: 'comet', paint: 3 });
  });

  test('list shows the open room', async () => {
    b.send({ t: 'list' });
    const list = await b.next('rooms');
    expect(list?.rooms.some((x: Msg) => x.code === room.code && x.host === 'Annie' && x.count === 1)).toBe(true);
  });

  test('joining a code that does not exist says so', async () => {
    b.send({ t: 'join', code: 'zzzz' });
    expect((await b.next('error'))?.msg).toMatch(/no room ZZZZ/i);
  });

  test('the second rider joins (lower case code works), with a default name and bike', async () => {
    b.send({ t: 'join', code: room.code.toLowerCase() });
    room = (await b.next('room', (m) => m.players.length === 2))!;
    expect(room.players[1]).toMatchObject({ name: 'Rider', bike: 'scout' });
    await a.next('room', (m) => m.players.length === 2);
  });

  test('only the host can start', async () => {
    b.send({ t: 'level', level: 'ember-1' });
    b.send({ t: 'start' });
    expect((await b.next('error'))?.msg).toMatch(/only the host/i);
  });

  test('the host changes the track', async () => {
    a.send({ t: 'level', level: 'frost-3' });
    expect(await b.next('room', (m) => m.level === 'frost-3')).not.toBeNull();
  });

  test('start sends a countdown to everyone', async () => {
    a.send({ t: 'start' });
    const [ca, cb] = await Promise.all([a.next('countdown'), b.next('countdown')]);
    expect(cb).not.toBeNull();
    expect(ca).toMatchObject({ level: 'frost-3', racers: [wa.id, wb.id] });
    expect(ca!.seconds).toBeGreaterThan(0);
  });

  test('the room goes from countdown to race', async () => {
    expect(await a.next('room', (m) => m.state === 'race')).not.toBeNull();
  });

  test('positions are passed to the other riders', async () => {
    a.send({ t: 'state', p: [1, 2, 0.5, 3, 0, 0], c: 0.05 });
    const st = await b.next('state');
    expect(st).toMatchObject({ id: wa.id, c: 0.05 });
    expect(st!.p[0]).toBe(1);
  });

  test('a bad position is dropped', async () => {
    a.send({ t: 'state', p: [1, 'x'] });
    expect(await b.next('state', null, 300)).toBeNull();
  });

  test('a finish is announced', async () => {
    a.send({ t: 'finish', time: 21.5 });
    expect(await b.next('finished')).toMatchObject({ id: wa.id, time: 21.5 });
  });

  test('the first finish starts the closing clock', async () => {
    const end = await b.next('ending');
    expect(end!.seconds).toBeGreaterThan(0);
  });

  test('results come in finishing order', async () => {
    b.send({ t: 'finish', time: 23.25 });
    const res = await a.next('results');
    expect(res!.results.map((x: Msg) => `${x.name} ${x.time}`).join(', ')).toBe('Annie 21.5, Rider 23.25');
  });

  test('the winner gets a win and the room is back in the lobby', async () => {
    room = (await a.next(
      'room',
      (m) => m.state === 'lobby' && m.racers.length === 0 && m.players.some((p: Msg) => p.wins > 0),
    ))!;
    expect(room.players.find((p: Msg) => p.id === wa.id).wins).toBe(1);
  });
});

describe('a race that runs out of time, and the event stream', () => {
  test('a rider over the event stream says hello', async () => {
    c = sseRider();
    await c.opened;
    c.send({ t: 'hello', name: 'Cy', paint: 5, bike: 'bulldog' });
    wc = (await c.next('welcome'))!;
    expect(wc.id).toBeTruthy();
  });

  test('and joins the room', async () => {
    c.send({ t: 'join', code: room.code });
    room = (await c.next('room', (m) => m.players.length === 3))!;
    expect(room).not.toBeNull();
  });

  test('the event stream gets the countdown', async () => {
    a.send({ t: 'start' });
    expect(await c.next('countdown')).not.toBeNull();
    await c.next('room', (m) => m.state === 'race');
  });

  test("and the other riders' positions", async () => {
    b.send({ t: 'state', p: [5, 1, 0, 0, 0, 0], c: 1 });
    expect(await c.next('state', (m) => m.id === wb.id)).not.toBeNull();
  });

  test('its finish reaches the others', async () => {
    c.send({ t: 'finish', time: 30 });
    expect(await a.next('finished', (m) => m.id === wc.id)).not.toBeNull();
  });

  test('the closing clock ends the race, the others did not finish', async () => {
    b.send({ t: 'retire' });
    const res = await a.next('results', null, 3000);
    expect(res!.results[0].name).toBe('Cy');
    expect(res!.results.slice(1).every((x: Msg) => x.time === null)).toBe(true);
  });

  test('posting to a closed stream answers 410', async () => {
    const bad = await fetch(`${BASE}/net/send?sid=nope`, { method: 'POST', body: '[]' });
    expect(bad.status).toBe(410);
  });
});

describe('dropping out and coming back', () => {
  test('a dropped host is shown as away, keeps their place, and hands host to someone still here', async () => {
    a.drain();
    b.drain();
    c.drain();
    a.close();
    room = (await b.next('room', (m) => m.players.find((p: Msg) => p.id === wa.id).away))!;
    expect(room.players.length).toBe(3);
    expect(room.host).not.toBe(wa.id);
    expect(room.players.find((p: Msg) => p.id === room.host && !p.away)).toBeTruthy();
  });

  let a2: Rider;
  test('coming back with the key resumes the same rider', async () => {
    a2 = wsRider();
    await a2.opened;
    a2.send({ t: 'hello', name: 'Annie', paint: 3, bike: 'comet', key: wa.key });
    expect(await a2.next('welcome')).toMatchObject({ resumed: true, id: wa.id });
  });

  test('and puts them back in the room', async () => {
    room = (await a2.next('room'))!;
    expect(room.players.length).toBe(3);
    expect(room.players.find((p: Msg) => p.id === wa.id).away).toBe(false);
  });

  test('a second connection with the same key takes over', async () => {
    const a3 = wsRider();
    await a3.opened;
    a3.send({ t: 'hello', name: 'Annie', key: wa.key });
    expect(await a2.next('replaced')).not.toBeNull();
    expect((await a3.next('welcome'))?.id).toBe(wa.id);
    a3.close();
  });

  test('after the away time the rider is gone and the host passes on', async () => {
    await Bun.sleep(1500);
    room = (await b.next('room', (m) => !m.players.some((p: Msg) => p.id === wa.id)))!;
    expect(room.host).toBe(wb.id);
  });

  test('leave is confirmed', async () => {
    b.send({ t: 'leave' });
    expect(await b.next('left')).not.toBeNull();
  });

  test('an empty room closes', async () => {
    c.send({ t: 'leave' });
    await c.next('left');
    b.send({ t: 'list' });
    expect((await b.next('rooms'))!.rooms.some((x: Msg) => x.code === room.code)).toBe(false);
    b.close();
    c.close();
  });

  test('the server logs rooms and results', () => {
    const out = site.logs.join('\n');
    expect(out).toMatch(/opened room/);
    expect(out).toMatch(/results:/);
  });
});
