// Browser checks for Bike Race live races: two phones in Bun's headless browser race each other through the race
// server (server/serve.ts), over http and over https with the event stream fallback, and a page with no race server
// falls back to racing computer riders. The computer rider steers both bikes (?autopilot).
//
// About two minutes. KEEP_SHOTS=1 keeps screenshots in .shots/.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEEP_SHOTS, openPage, startSite, wait, type Page, type Site } from '../support/browser';

setDefaultTimeout(180_000);
const RACES = { ending: 10, away: 30 }; // seconds after the first finish, and that a dropped rider keeps their place
const site = startSite(RACES);
afterAll(() => site.stop());

// Stars unlock Hopper (10), so the two riders are on different bikes.
function stars(n: number): Record<string, number> {
  const s: Record<string, number> = {};
  for (const id of ['clover-1', 'clover-2', 'clover-3', 'clover-4', 'clover-5', 'clover-6']) {
    if (n <= 0) break;
    s[id] = Math.min(3, n);
    n -= s[id];
  }
  return s;
}
const ANN = { name: 'Ann', paint: 2 };
const BEA = {
  name: 'Bea',
  paint: 6,
  bike: 'hopper',
  stars: stars(12),
  best: { 'clover-1': 30, 'clover-2': 30, 'clover-3': 30, 'clover-4': 30 },
};

/** Bike Race on a phone held sideways, with a save in place, once its first screen is up */
async function phone(
  on: Site,
  { save = null as object | null, query = '?autopilot', hash = '#bike-race' } = {},
): Promise<Page> {
  const page = await openPage(on, {
    width: 844,
    height: 390,
    mobile: true,
    path: `/${query}${hash}`,
    storage: save ? { 'bikerace.v1': JSON.stringify(save) } : undefined,
    ignoreErrors: /WebSocket connection/,
  });
  // tilt needs the motion sensors (the browser may not take this from a page: then it does without, as before)
  await page.view.cdp('Browser.grantPermissions', { permissions: ['sensors'] }).catch(() => {});
  await page.waitFor(() => !!window.BikeRace && !!document.querySelector('#br-app .br-screen:not([hidden])'), [], {
    timeout: 8000,
  });
  return page;
}

/** Pick an option in a <select>, with the input and change events a person picking it would cause */
async function select(page: Page, selector: string, value: string): Promise<void> {
  await page.eval(
    (sel, v) => {
      const el = document.querySelector(sel) as HTMLSelectElement;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    selector,
    value,
  );
}

/** Run fn(d, arg) in the page, d being Bike Race's debug view (BikeRace._debug()). fn goes as its source text. */
async function dbg<R, A = null>(page: Page, fn: (d: any, arg: A) => R, arg?: A): Promise<R> {
  return (await page.view.evaluate(`(${fn.toString()})(BikeRace._debug(), ${JSON.stringify(arg ?? null)})`)) as R;
}

const until = <A extends unknown[], R>(page: Page, fn: (...args: A) => R, args: A | [] = [], ms = 10_000) =>
  page.until(fn, args, ms);
const online = (page: Page) =>
  until(page, () => {
    const d = window.BikeRace!._debug();
    return d.Net.status === 'online' && d.Net.id;
  });
const inRoom = (page: Page, n: number) =>
  until(
    page,
    (n) =>
      !document.getElementById('br-mp-room')!.hidden && document.querySelectorAll('#br-room-players li').length === n,
    [n],
  );
const racing = (page: Page) =>
  until(page, () => {
    const d = window.BikeRace!._debug();
    return d.S && d.S.mode === 'online' && d.S.phase === 'run';
  });
const results = (page: Page, ms = 60_000) =>
  until(page, () => !document.getElementById('br-raceresult')!.hidden, [], ms);
const standings = (page: Page) =>
  page.eval(() =>
    [...document.querySelectorAll('#br-rr-list li')].map((e) => ({
      name: e.querySelector('.nm')!.textContent ?? '',
      time: e.querySelector('.tm')!.textContent ?? '',
      me: e.classList.contains('me'),
    })),
  );
const players = (page: Page) =>
  page.eval(() => [...document.querySelectorAll('#br-room-players li')].map((e) => e.textContent ?? ''));
const enabled = (page: Page, selector: string) =>
  page.eval((sel) => !(document.querySelector(sel) as HTMLButtonElement).disabled, selector);
/** Only taken with KEEP_SHOTS, as they were only taken with --keep before */
const shot = async (page: Page, name: string) => void (KEEP_SHOTS && (await page.screenshot(name)));

// The first four parts share two phones, Ann's (a, the host) and Bea's (b).
let a: Page;
let b: Page;
let code = '';
let sa: Awaited<ReturnType<typeof standings>> = [];

describe('Two phones meet in a room', () => {
  beforeAll(async () => {
    a = await phone(site, { save: ANN });
  });

  test('the Multiplayer button is switched on', async () => {
    expect(await enabled(a, '#br-go-mp')).toBe(true);
  });

  test('the first phone finds the race server', async () => {
    await a.click('#br-go-mp');
    expect(await online(a)).toBe(true);
  });

  test('over a WebSocket', async () => {
    expect(await dbg(a, (d) => d.Net.transport)).toBe('ws');
  });

  test('it shows the lobby and the computer race', async () => {
    expect(await a.visible('br-mp-lobby')).toBe(true);
    expect(await a.visible('br-mp-cpu')).toBe(true);
  });

  test('Create room opens a room', async () => {
    await select(a, '#br-mp-level', 'clover-2');
    await a.click('#br-mp-create');
    expect(await inRoom(a, 1)).toBe(true);
  });

  test('with a 4-letter code', async () => {
    code = await a.text('#br-room-code');
    expect(code).toMatch(/^[A-Z]{4}$/);
  });

  test('and an invite link', async () => {
    expect(await a.text('#br-room-link')).toEndWith('#bike-race/' + code);
  });

  test('the host can start, and the computer race is out of the way', async () => {
    expect(await a.visible('br-room-start')).toBe(true);
    expect(await a.visible('br-mp-cpu')).toBe(false);
    await shot(a, 'bike-race-online-room-host.jpg');
  });

  test('the invite link puts the second phone in the room', async () => {
    b = await phone(site, { save: BEA, hash: '#bike-race/' + code.toLowerCase() });
    expect(await inRoom(b, 2)).toBe(true);
  });

  test('and tidies the address', async () => {
    expect(await until(b, () => location.hash === '#bike-race')).toBe(true);
  });

  test('the host sees the second rider arrive', async () => {
    expect(await inRoom(a, 2)).toBe(true);
  });

  test('with names, host and bikes', async () => {
    const riders = await players(a);
    expect(riders[0]).toMatch(/Ann.*host/);
    expect(riders[1]).toMatch(/Bea.*Hopper/);
  });

  test('the guest waits for the host', async () => {
    expect(await b.visible('br-room-start')).toBe(false);
    expect(await b.text('#br-room-note')).toMatch(/Waiting for Ann/);
  });

  test('the guest sees the track', async () => {
    const name = await a.eval(() => window.BikeRaceCore.levelById('clover-2').name);
    expect(await b.text('#br-room-level-text')).toBe('Clover Hills 2 · ' + name);
    await shot(b, 'bike-race-online-room-guest.jpg');
  });
});

describe('A live race', () => {
  test('Start race counts down and starts the race on both phones', async () => {
    await a.click('#br-room-start');
    expect(await racing(a)).toBe(true);
    expect(await racing(b)).toBe(true);
  });

  test('each phone has the other rider, with their name and bike', async () => {
    const tags = (d: any) => [...d.S.remote.values()].map((r: any) => r.look.name + ' ' + r.look.bike);
    expect((await dbg(a, tags)).join()).toBe('Bea hopper');
    expect((await dbg(b, tags)).join()).toBe('Ann scout');
  });

  let seen = { n: 0, x: 0, me: 0 };
  test("the other rider's positions stream in and their bike moves", async () => {
    await wait(2500);
    seen = await dbg(a, (d) => {
      const r = [...d.S.remote.values()][0];
      const p = d.remotePose(r, performance.now() / 1000);
      return { n: r.buf.length, x: p && p.x, me: d.S.me.c.x };
    });
    expect(seen.n).toBeGreaterThan(20);
    expect(seen.x).toBeGreaterThan(5);
  });

  test('the two bikes are near each other on the track', () => {
    expect(Math.abs(seen.x - seen.me)).toBeLessThan(25);
  });

  test('the HUD shows the place out of 2', async () => {
    expect(await a.text('#br-pos')).toMatch(/\/ 2$/);
    await shot(a, 'bike-race-online-race.jpg');
  });

  test('both phones get the results', async () => {
    expect(await results(a)).toBe(true);
    expect(await results(b)).toBe(true);
  });

  let sb: typeof sa = [];
  test('the same standings on both, with two times', async () => {
    sa = await standings(a);
    sb = await standings(b);
    expect(sa.length).toBe(2);
    expect(sa.map((r) => r.name + r.time)).toEqual(sb.map((r) => r.name + r.time));
    expect(sa.filter((r) => !/s$/.test(r.time))).toEqual([]);
  });

  test('each phone highlights its own row', () => {
    expect(sa.find((r) => r.me)?.name).toBe('Ann');
    expect(sb.find((r) => r.me)?.name).toBe('Bea');
  });

  test('the host can race again, the guest waits', async () => {
    expect(await a.visible('br-rr-again')).toBe(true);
    expect(await b.visible('br-rr-again')).toBe(false);
    expect(await b.visible('br-rr-wait')).toBe(true);
    await shot(b, 'bike-race-online-results.jpg');
  });
});

describe('Leaving a race, the last race, and racing again', () => {
  test('Back to room shows the room with the last race', async () => {
    await b.click('#br-rr-room');
    expect(await inRoom(b, 2)).toBe(true);
    expect(await b.visible('br-room-last')).toBe(true);
  });

  test('the winner has a win', async () => {
    const winner = sa[0]!.name;
    expect((await players(b)).join('|')).toMatch(new RegExp(`${winner}.*1 win`));
  });

  test('Race again starts a race for the host on the results sheet and the guest in the room', async () => {
    await a.click('#br-rr-again');
    expect(await racing(a)).toBe(true);
    expect(await racing(b)).toBe(true);
  });

  test('Leave race in the pause menu goes back to the room while the race goes on', async () => {
    await wait(800);
    await a.click('#br-pause');
    await a.click('#br-p-levels');
    expect(await inRoom(a, 2)).toBe(true);
    expect(await a.text('#br-room-note')).toMatch(/race is on/i);
  });

  test('the other rider still finishes and gets results', async () => {
    expect(await results(b)).toBe(true);
  });

  test('the one who left the race did not finish', async () => {
    const s2 = await standings(b);
    expect(s2.length).toBe(2);
    expect(s2[0]!.name).toBe('Bea');
    expect(s2[1]!.time).toBe('DNF');
  });

  test('the room shows that race too', async () => {
    expect(
      await until(
        a,
        () =>
          !document.getElementById('br-room-last')!.hidden &&
          /DNF/.test(document.getElementById('br-room-last-list')!.textContent ?? ''),
      ),
    ).toBe(true);
  });
});

describe('A dropped connection comes back', () => {
  afterAll(() => {
    a?.close();
    b?.close();
  });

  let idB = '';
  test('the phone reconnects by itself', async () => {
    await b.click('#br-rr-room');
    idB = await dbg(b, (d) => d.Net.id);
    await dbg(b, (d) => void d.Net._t.kill());
    expect(await online(b)).toBe(true);
  });

  test('as the same rider, still in the room', async () => {
    expect(await dbg(b, (d) => d.Net.id)).toBe(idB);
    expect(await inRoom(b, 2)).toBe(true);
  });

  test('a third race starts', async () => {
    await a.click('#br-room-start');
    expect(await racing(a)).toBe(true);
    expect(await racing(b)).toBe(true);
  });

  test('one phone loses its connection mid-race', async () => {
    await wait(1500);
    await dbg(b, (d) => void d.Net.close());
    expect(
      await until(
        a,
        () =>
          /away/.test(document.getElementById('br-room-players')!.textContent ?? '') ||
          [...window.BikeRace!._debug().S.remote.values()].length === 1,
      ),
    ).toBe(true);
  });

  test('it keeps riding and crosses the line offline', async () => {
    expect(await until(b, () => window.BikeRace!._debug().S.me.finished, [], 60_000)).toBe(true);
  });

  test('once it is back, its finish counts and both get results', async () => {
    await dbg(b, (d) => void d.Net.connect());
    expect(await results(a)).toBe(true);
    expect(await results(b)).toBe(true);
  });

  test('with two times', async () => {
    const s3 = await standings(a);
    expect(s3.length).toBe(2);
    expect(s3.filter((r) => !/s$/.test(r.time))).toEqual([]);
  });

  test('Leave room goes back to the lobby', async () => {
    await b.click('#br-rr-room');
    await a.click('#br-rr-room');
    await b.click('#br-room-leave');
    expect(await until(b, () => !document.getElementById('br-mp-lobby')!.hidden)).toBe(true);
  });

  test('and the host sees them go', async () => {
    expect(await inRoom(a, 1)).toBe(true);
  });

  test('the open room is listed in the lobby', async () => {
    await b.reload();
    await b.waitFor(() => !!window.BikeRace && !document.getElementById('br-home')!.hidden, [], { timeout: 30_000 });
    await b.click('#br-go-mp');
    await online(b);
    expect(
      await until(
        b,
        (c) => [...document.querySelectorAll('#br-mp-rooms li')].some((li) => li.textContent!.includes(c)),
        [code],
      ),
    ).toBe(true);
  });

  test('and Join from the list works', async () => {
    await b.click(`#br-mp-rooms button[data-code="${code}"]`);
    expect(await inRoom(b, 2)).toBe(true);
  });

  test('when the host leaves, the other rider becomes host', async () => {
    await a.click('#br-room-leave');
    expect(await until(b, () => !document.getElementById('br-room-start')!.hidden)).toBe(true);
  });

  test('no errors in either page', () => {
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });
});

describe('Over https, with one phone on the event stream', () => {
  let dir = '';
  let secure: Site;
  let c: Page;
  let e: Page;
  beforeAll(async () => {
    // a self-signed certificate, as server/serve.ts makes for --https (the test browser ignores certificate errors)
    dir = mkdtempSync(join(tmpdir(), 'bike-race-tls-'));
    const cert = join(dir, 'cert.pem');
    const key = join(dir, 'key.pem');
    const made = Bun.spawnSync(
      ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2'].concat([
        ...['-keyout', key, '-out', cert, '-subj', '/CN=localhost'],
      ]),
      { stdout: 'ignore', stderr: 'pipe' },
    );
    if (!made.success) throw new Error(`openssl could not make a certificate: ${made.stderr}`);
    secure = startSite({ ...RACES, tls: { cert, key } });
    c = await phone(secure, { save: ANN });
  });
  afterAll(() => {
    c?.close();
    e?.close();
    secure?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('a phone finds the race server over https', async () => {
    expect(await c.eval(() => location.protocol)).toBe('https:');
    await c.click('#br-go-mp');
    expect(await online(c)).toBe(true);
  });

  test('with a secure WebSocket', async () => {
    expect(await dbg(c, (d) => d.Net.transport)).toBe('ws');
  });

  test('a phone on the event stream joins through the link', async () => {
    await c.click('#br-mp-create');
    await inRoom(c, 1);
    const code2 = await c.text('#br-room-code');
    e = await phone(secure, { save: BEA, query: '?autopilot&net=sse', hash: '#bike-race/' + code2 });
    expect(await inRoom(e, 2)).toBe(true);
  });

  test('it really is on the event stream', async () => {
    expect(await dbg(e, (d) => d.Net.transport)).toBe('sse');
  });

  test('they race', async () => {
    await c.click('#br-room-start');
    expect(await racing(c)).toBe(true);
    expect(await racing(e)).toBe(true);
  });

  test('positions from the event stream phone arrive', async () => {
    await wait(2000);
    expect(await dbg(c, (d) => [...d.S.remote.values()][0].buf.length)).toBeGreaterThan(15);
  });

  test('and the event stream phone gets the others', async () => {
    expect(await dbg(e, (d) => [...d.S.remote.values()][0].buf.length)).toBeGreaterThan(15);
  });

  test('both get results', async () => {
    expect(await results(c)).toBe(true);
    expect(await results(e)).toBe(true);
  });

  test('with both times', async () => {
    expect((await standings(c)).length).toBe(2);
    expect((await standings(e)).filter((r) => !/s$/.test(r.time))).toEqual([]);
  });

  test('no errors in either page', () => {
    expect(c.errors).toEqual([]);
    expect(e.errors).toEqual([]);
  });
});

describe('No race server: race the computer', () => {
  // The site as a static host serves it: built with `bun build` (mise run build) and served as plain files, with no
  // /ws and no /net routes.
  let dir = '';
  let host: Site;
  let f: Page;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bike-race-static-'));
    const built = await Bun.build({
      entrypoints: [join(import.meta.dir, '..', '..', 'public', 'index.html')],
      outdir: dir,
    });
    if (!built.success) throw new AggregateError(built.logs, 'the site did not build');
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        const path = decodeURIComponent(new URL(req.url).pathname);
        const file = Bun.file(join(dir, path.endsWith('/') ? path + 'index.html' : path));
        return (await file.exists()) ? new Response(file) : new Response('Not found\n', { status: 404 });
      },
    });
    host = {
      port: server.port!,
      scheme: 'http',
      logs: [],
      url: (path = '/', name = '127.0.0.1') => `http://${name}:${server.port}${path}`,
      stop: () => void server.stop(true),
    };
    f = await phone(host, { save: ANN, hash: '#bike-race/BCDF' });
  });
  afterAll(() => {
    f?.close();
    host?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('a link to a room on a page with no race server says so', async () => {
    expect(await until(f, () => !document.getElementById('br-mp-offline')!.hidden)).toBe(true);
  });

  test('it names the room and offers the computer race', async () => {
    expect(await f.text('#br-mp-offline-why')).toMatch(/Room BCDF/);
    expect(await f.visible('br-mp-cpu')).toBe(true);
    await shot(f, 'bike-race-online-offline.jpg');
  });

  test('Race computer riders starts a race against three', async () => {
    await f.click('#br-cpu-count button[data-n="3"]');
    await f.click('#br-cpu-start');
    expect(
      await until(f, () => {
        const d = window.BikeRace!._debug();
        return d.S && d.S.mode === 'cpu' && d.S.cpus.length === 3;
      }),
    ).toBe(true);
  });

  test('and it ends with standings', async () => {
    expect(await results(f)).toBe(true);
  });

  test('four riders in the standings', async () => {
    expect((await standings(f)).length).toBe(4);
  });

  test('no errors in the page', () => {
    expect(f.errors).toEqual([]);
  });
});

describe('The multiplayer screens fit on phones', () => {
  for (const [w, h] of [
    [568, 320],
    [844, 390],
  ] as const) {
    test(`the room fits across at ${w}x${h}`, async () => {
      const g = await phone(site, { save: ANN });
      try {
        await g.view.cdp('Emulation.setDeviceMetricsOverride', {
          width: w,
          height: h,
          deviceScaleFactor: 1,
          mobile: true,
        });
        await g.click('#br-go-mp');
        await online(g);
        await g.click('#br-mp-create');
        await inRoom(g, 1);
        const fit = await g.eval(() => {
          const scr = document.getElementById('br-mp')!;
          const out: string[] = [];
          for (const el of scr.querySelectorAll<HTMLElement>('.br-panel, .b, input, select')) {
            if (el.offsetParent === null) continue;
            const r = el.getBoundingClientRect();
            if (r.left < -1 || r.right > innerWidth + 1) out.push(el.id || el.className);
          }
          return { out, wide: scr.scrollWidth - scr.clientWidth };
        });
        expect(fit.out).toEqual([]);
        expect(fit.wide).toBeLessThanOrEqual(1);
        await shot(g, `bike-race-online-room-${w}x${h}.jpg`);
      } finally {
        g.close();
      }
    });
  }
});
