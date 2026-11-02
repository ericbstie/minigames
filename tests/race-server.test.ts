// Checks the race server (server/serve.ts and server/race.ts) without a browser: the page, rooms, a whole race, the
// event stream fallback, dropping out and coming back, and the host handing over. It runs the server in-process on a
// free port with short countdown, ending and away times. The tests run in order and share the riders.
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { deviceOf, localHost } from '../server/serve';
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
function wsRider(base = BASE): Rider {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
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

  test('the page carries its Content-Security-Policy, and no script of its own', () => {
    const csp = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/)?.[1] ?? '';
    const rules = new Map(csp.split(';').map((r) => [r.trim().split(' ')[0], r.trim().split(' ').slice(1)]));
    expect(rules.get('default-src')).toEqual(["'self'"]);
    expect(rules.get('script-src')).toContain("'self'");
    expect(rules.get('script-src')!.filter((v) => /unsafe|\*|https?:|data:/.test(v))).toEqual([]);
    expect(rules.get('object-src')).toEqual(["'none'"]);
    expect(rules.get('base-uri')).toEqual(["'none'"]);
    expect(rules.get('connect-src')).toContain("'self'");
    // so nothing has to be let in by 'unsafe-inline': every script is a file of the site's own
    expect(html.match(/<script(?![^>]*\ssrc=)[^>]*>/g)).toBeNull();
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

  // DNS rebinding: a public name pointed at this computer, asked by a page on that name (so Origin and Host agree)
  const rebound = `evil.example:${site.port}`;
  const fromRebound = { Host: rebound, Origin: `http://${rebound}` };
  test('a WebSocket for a public host name is refused', async () => {
    const r = await fetch(BASE + '/ws', { headers: { ...fromRebound, Upgrade: 'websocket', Connection: 'Upgrade' } });
    expect(r.status).toBe(403);
  });

  test('so is an event stream, and a POST', async () => {
    expect((await fetch(BASE + '/net/events', { headers: fromRebound })).status).toBe(403);
    const r = await fetch(BASE + '/net/send?sid=x', { method: 'POST', body: '[]', headers: fromRebound });
    expect(r.status).toBe(403);
  });
});

describe('who may use the race server', () => {
  const asked = (host: string | null, listening = '0.0.0.0') =>
    localHost(new Request('http://127.0.0.1/ws', { headers: host === null ? {} : { Host: host } }), listening);

  test('addresses, localhost and local network names', () => {
    for (const host of [
      '127.0.0.1:8000',
      '192.168.1.20:8443',
      '[::1]:8000',
      '[fe80::1]',
      'localhost:8000',
      'p1.localhost:8000',
      'erics-mac.local:8443',
      'raspberrypi:8000',
      'box.lan',
      'nas.home.arpa',
      'games.internal',
    ])
      expect([host, asked(host)]).toEqual([host, true]);
  });

  test('not public names, which a DNS rebinding attack would use', () => {
    for (const host of ['evil.example:8000', 'localhost.evil.com', '127.0.0.1.nip.io', 'local.example.com', '', null])
      expect([host, asked(host)]).toEqual([host, false]);
  });

  test('unless the server was started on that name', () => {
    expect(asked('games.example.com:8000', 'games.example.com')).toBe(true);
    expect(asked('other.example.com:8000', 'games.example.com')).toBe(false);
  });

  test('a device is its IPv4 address, or the first 64 bits of its IPv6 one', () => {
    expect(deviceOf('192.168.1.20')).toBe('192.168.1.20');
    expect(deviceOf('::ffff:192.168.1.20')).toBe('192.168.1.20');
    expect(deviceOf('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(deviceOf('2001:0db8:0001:0002::5')).toBe('2001:db8:1:2::/64');
    expect(deviceOf('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(deviceOf('::1')).toBe('0:0:0:0::/64');
    expect(deviceOf('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
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

describe('limits for one device', () => {
  const tight = startSite({ perDevice: 2 });
  const TIGHT = tight.url('').replace(/\/$/, '');
  afterAll(() => tight.stop());
  const upgrade = { Upgrade: 'websocket', Connection: 'Upgrade' };
  let x: Rider, y: Rider;

  test('two connections from this computer open', async () => {
    x = wsRider(TIGHT);
    y = wsRider(TIGHT);
    await Promise.all([x.opened, y.opened]);
  });

  test('a third WebSocket or event stream is refused', async () => {
    expect((await fetch(TIGHT + '/ws', { headers: upgrade })).status).toBe(429);
    expect((await fetch(TIGHT + '/net/events')).status).toBe(429);
  });

  test('a connection that closes makes room for another', async () => {
    y.close();
    await Bun.sleep(200);
    y = wsRider(TIGHT);
    await y.opened;
  });

  test('anything but poses: 20 a second', async () => {
    x.send({ t: 'hello', name: 'Xu' });
    await x.next('welcome');
    await Bun.sleep(1100); // the hello counted too, in a second gone by now
    for (let i = 0; i < 50; i++) x.send({ t: 'list' });
    await Bun.sleep(500);
    let lists = 0;
    while (await x.next('rooms', null, 50)) lists++;
    // all 50 went within a second, or across the turn of one
    expect(lists).toBeGreaterThanOrEqual(20);
    expect(lists).toBeLessThanOrEqual(40);
  });

  test('frames that are not messages count too', async () => {
    // a turn of the second between the junk and the list would let the list through, so it gets three goes
    let answered = 0;
    for (let go = 0; go < 3; go++) {
      await Bun.sleep(1100);
      x.drain();
      for (let i = 0; i < 95; i++) x.send('not a message' as unknown as Msg);
      x.send({ t: 'list' });
      if (await x.next('rooms', null, 300)) answered++;
      else break;
    }
    expect(answered).toBeLessThan(3);
  });

  test('a POST that is not JSON answers 400', async () => {
    y.close();
    await Bun.sleep(200);
    const ctl = new AbortController();
    const res = await fetch(TIGHT + '/net/events', { signal: ctl.signal });
    const first = new TextDecoder().decode((await res.body!.getReader().read()).value);
    const sid = JSON.parse(first.slice(first.indexOf('{'), first.lastIndexOf('}') + 1)).sid;
    const r = await fetch(`${TIGHT}/net/send?sid=${sid}`, { method: 'POST', body: '{nope' });
    expect(r.status).toBe(400);
    ctl.abort();
    x.close();
  });
});
