// Browser checks for Bike Race: the garage (bikes, paint, name, saving), opening it from the pause, crash and
// result sheets, the "new bike" badges, and that the garage and sheets fit on phones held sideways.
// It plays the real page in Bun's headless browser, as a phone with touch. KEEP_SHOTS=1 keeps screenshots of each
// phone size in .shots/.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { KEEP_SHOTS, openPage, startSite, wait, type Page } from '../support/browser';

setDefaultTimeout(60_000);
const site = startSite();
afterAll(() => site.stop());

// some saves to start from
const LEVELS = [
  ...['clover-1', 'clover-2', 'clover-3', 'clover-4', 'clover-5', 'clover-6'],
  ...['ember-1', 'ember-2', 'ember-3', 'ember-4'],
];
function stars(n: number): Record<string, number> {
  const s: Record<string, number> = {};
  for (const id of LEVELS) {
    if (n <= 0) break;
    s[id] = Math.min(3, n);
    n -= s[id];
  }
  return s;
}
const bestFor = (st: Record<string, number>) => Object.fromEntries(Object.keys(st).map((id) => [id, 30]));
const SAVE_0 = {};
const SAVE_18 = { stars: stars(18), best: bestFor(stars(18)), name: 'Eric' };
const SAVE_8 = {
  stars: { 'clover-2': 3, 'clover-3': 3, 'clover-4': 2 },
  best: { 'clover-2': 17, 'clover-3': 17, 'clover-4': 22 },
};

/** Bike Race on a phone held sideways, with a save in place, once the home menu is up */
async function phone({ w = 844, h = 390, save = null as object | null, query = '' } = {}): Promise<Page> {
  const page = await openPage(site, {
    width: w,
    height: h,
    mobile: true,
    path: `/${query}#bike-race`,
    storage: save ? { 'bikerace.v1': JSON.stringify(save) } : undefined,
  });
  // tilt needs the motion sensors (the browser may not take this from a page: then it does without, as before)
  await page.view.cdp('Browser.grantPermissions', { permissions: ['sensors'] }).catch(() => {});
  await page.waitFor(() => !!window.BikeRace && !document.getElementById('br-home')!.hidden);
  return page;
}

/** Focus an element and press a key in it */
async function pressIn(page: Page, selector: string, key: string): Promise<void> {
  await page.eval((sel) => (document.querySelector(sel) as HTMLElement).focus(), selector);
  await page.press(key);
}

/** Run fn(d, arg) in the page, d being Bike Race's debug view (BikeRace._debug()). fn goes as its source text. */
async function dbg<R, A = null>(page: Page, fn: (d: any, arg: A) => R, arg?: A): Promise<R> {
  return (await page.view.evaluate(`(${fn.toString()})(BikeRace._debug(), ${JSON.stringify(arg ?? null)})`)) as R;
}

const saved = (page: Page): Promise<any> => page.eval(() => JSON.parse(localStorage.getItem('bikerace.v1') || '{}'));
const hasNew = (page: Page) => page.eval(() => document.getElementById('br-go-garage')!.classList.contains('has-new'));
const newTags = (page: Page, nth: number) =>
  page.eval((i) => document.querySelectorAll('.br-gbike')[i]!.querySelectorAll('.br-new').length, nth);
/** Only taken with KEEP_SHOTS, as they were only taken with --keep before */
const shot = async (page: Page, name: string) => void (KEEP_SHOTS && (await page.screenshot(name)));

describe('Garage basics (no stars yet)', () => {
  let page: Page;
  beforeAll(async () => {
    page = await phone({ save: SAVE_0 });
  });
  afterAll(() => page?.close());

  test('the Garage button is switched on', async () => {
    expect(await page.eval(() => (document.getElementById('br-go-garage') as HTMLButtonElement).disabled)).toBe(false);
  });

  test('no "New bike" badge with no stars', async () => {
    expect(await hasNew(page)).toBe(false);
  });

  test('the garage opens', async () => {
    await page.click('#br-go-garage');
    expect(await page.visible('br-garage')).toBe(true);
  });

  let tiles: { cls: string; name: string }[] = [];
  test('five bikes in the strip', async () => {
    tiles = await page.eval(() =>
      [...document.querySelectorAll('.br-gbike')].map((e) => ({
        cls: e.className,
        name: e.querySelector('.nm')!.textContent ?? '',
      })),
    );
    expect(tiles.length).toBe(5);
  });

  test('Scout is ridden and the other four are locked', () => {
    expect(tiles[0]!.cls).toContain('riding');
    expect(tiles.slice(1).filter((t) => !t.cls.includes('locked'))).toEqual([]);
  });

  test('tapping a locked bike does not pick it', async () => {
    await page.click('.br-gbike', 4);
    expect((await saved(page)).bike).not.toBe('comet');
  });

  test('the locked bike shows how many more stars it needs', async () => {
    expect(await page.text('#br-g-status')).toMatch(/more stars/);
  });

  test('the showroom shows the tapped bike', async () => {
    expect(await page.text('#br-g-name')).toBe('Comet');
  });

  test('Back goes to the home menu', async () => {
    await page.click('#br-garage-back');
    expect(await page.visible('br-home')).toBe(true);
  });

  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
});

describe('Unlocking, picking and saving', () => {
  let page: Page;
  beforeAll(async () => {
    page = await phone({ save: SAVE_18 });
  });
  afterAll(() => page?.close());

  test('home shows "New bike" once Hopper is unlocked', async () => {
    expect(await hasNew(page)).toBe(true);
  });

  test("Hopper's tile says New", async () => {
    await page.click('#br-go-garage');
    expect(await newTags(page, 1)).toBe(1);
  });

  test('tapping Hopper rides it and clears New', async () => {
    await page.click('.br-gbike', 1);
    const sv = await saved(page);
    expect(sv.bike).toBe('hopper');
    expect(sv.seen).toContain('hopper');
  });

  test('the New tag goes away', async () => {
    expect(await newTags(page, 1)).toBe(0);
  });

  test('the rider behind the menus switches to Hopper', async () => {
    expect(await dbg(page, (d) => d.attract.me.look.bike)).toBe('hopper');
  });

  test('picking the fourth paint saves it', async () => {
    await page.click('.br-paint', 3);
    expect((await saved(page)).paint).toBe(3);
  });

  test('control characters are taken out of the name', async () => {
    await page.fill('#br-name', 'A\u0007B');
    await pressIn(page, '#br-name', 'Enter');
    expect((await saved(page)).name).toBe('AB');
  });

  test('the name is saved and cut to 16', async () => {
    await page.fill('#br-name', 'Zed the Quick Rider!!');
    await pressIn(page, '#br-name', 'Enter');
    expect((await saved(page)).name).toBe('Zed the Quick Ri');
  });

  test('the home badge is gone after looking at the new bike', async () => {
    await page.click('#br-garage-back');
    expect(await hasNew(page)).toBe(false);
  });

  test('after a reload Hopper is still ridden', async () => {
    await page.reload();
    await page.waitFor(() => !!window.BikeRace && !document.getElementById('br-home')!.hidden, [], { timeout: 30_000 });
    await page.click('#br-go-garage');
    expect(await page.text('.br-gbike.riding .nm')).toBe('Hopper');
  });

  test('after a reload the name is still there', async () => {
    expect(await page.eval(() => (document.getElementById('br-name') as HTMLInputElement).value)).toBe(
      'Zed the Quick Ri',
    );
  });

  test('after a reload the paint is still picked', async () => {
    expect(await page.eval(() => document.querySelectorAll('.br-paint')[3]!.classList.contains('sel'))).toBe(true);
  });

  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
});

describe('Saves that name a locked bike are put right', () => {
  test('locked bike back to Scout, paint wrapped, name cleaned', async () => {
    const page = await phone({ save: { bike: 'comet', paint: 99, name: 'A\u0001B' } });
    try {
      const sv = await dbg(page, (d) => d.save);
      expect({ bike: sv.bike, paint: sv.paint, name: sv.name }).toEqual({ bike: 'scout', paint: 99 % 10, name: 'AB' });
    } finally {
      page.close();
    }
  });
});

describe('Old and damaged saves still load', () => {
  const GHOST = 'bikerace.ghost.v1.clover-1';
  /** The ghost a solo run on clover-1 starts with, after putting one in storage */
  async function ghostFrom(page: Page, stored: string) {
    await page.eval((k, v) => localStorage.setItem(k, v), GHOST, stored);
    await dbg(page, (d) => void d.startSolo('clover-1'));
    return dbg(page, (d) =>
      d.S.ghost ? { time: d.S.ghost.time, bike: d.S.ghost.bike, frames: d.S.ghost.frames.length } : null,
    );
  }

  test('a save from the first version gets the settings it lacks, and its ghost rides Scout', async () => {
    // no name, paint, seen bikes, tilt, computer riders or last world; a ghost saved before ghosts had a bike
    const page = await phone({
      save: { best: { 'clover-1': 31.25 }, stars: { 'clover-1': 2 }, bike: 'scout', ghost: true, sound: false },
    });
    try {
      expect(await dbg(page, (d) => d.save)).toEqual({
        best: { 'clover-1': 31.25 },
        stars: { 'clover-1': 2 },
        bike: 'scout',
        paint: 0,
        name: '',
        seen: ['scout'],
        ghost: true,
        sound: false,
        tilt: true,
        cpu: 2,
        lastWorld: 'clover',
      });
      const f = await dbg(
        page,
        (d) =>
          d.C.encodeGhost([
            [0, 1, 0],
            [0.5, 1, 0.1],
          ]) as string,
      );
      expect(await ghostFrom(page, JSON.stringify({ time: 31.25, f }))).toEqual({
        time: 31.25,
        bike: 'scout',
        frames: 2,
      });
      expect(page.errors).toEqual([]);
    } finally {
      page.close();
    }
  });

  test('a save with every field the wrong shape takes the default for each, and a broken ghost is none', async () => {
    const page = await phone({
      save: {
        best: 'fast',
        stars: [3, 3],
        bike: 'rocket',
        paint: 'blue',
        name: 42,
        seen: 'all',
        ghost: 1,
        sound: 'yes',
        tilt: null,
        cpu: 'many',
        lastWorld: 7,
      },
    });
    try {
      // (settings are read as before: anything there is on or off by its truthiness)
      expect(await dbg(page, (d) => d.save)).toEqual({
        best: {},
        stars: {},
        bike: 'scout',
        paint: 0,
        name: '42',
        seen: ['scout'],
        ghost: true,
        sound: true,
        tilt: false,
        cpu: 2,
        lastWorld: 'clover',
      });
      for (const stored of ['{"time": 30, "f": ""}', '{"time": 30}', '[1, 2]', 'not json'])
        expect(await ghostFrom(page, stored)).toBeNull();
      expect(page.errors).toEqual([]);
    } finally {
      page.close();
    }
  });

  test('a save that is not JSON starts afresh', async () => {
    const page = await openPage(site, {
      width: 844,
      height: 390,
      mobile: true,
      path: '/#bike-race',
      storage: { 'bikerace.v1': '{"best": {' },
    });
    try {
      await page.waitFor(() => !!window.BikeRace && !document.getElementById('br-home')!.hidden);
      expect(await dbg(page, (d) => d.save)).toEqual({
        best: {},
        stars: {},
        bike: 'scout',
        paint: 0,
        name: '',
        seen: ['scout'],
        ghost: true,
        sound: true,
        tilt: true,
        cpu: 2,
        lastWorld: 'clover',
      });
      expect(page.errors).toEqual([]);
    } finally {
      page.close();
    }
  });
});

describe('Garage from the pause menu', () => {
  let page: Page;
  beforeAll(async () => {
    page = await phone({ save: SAVE_18, query: '?keyboard' });
  });
  afterAll(() => page?.close());

  let before: { x: number; t: number };
  test('the pause menu has a Garage button', async () => {
    await dbg(page, (d) => void d.startSolo('clover-1'));
    await page.keyDown('ArrowUp');
    await wait(1200);
    await page.keyUp('ArrowUp');
    await page.click('#br-pause');
    before = await dbg(page, (d) => ({ x: d.S.me.c.x, t: d.S.me.time, sess: (((window as any).__s = d.S), 1) }));
    expect(await page.visible('br-p-garage')).toBe(true);
  });

  test('it opens the garage', async () => {
    await page.click('#br-p-garage');
    expect(await page.visible('br-garage')).toBe(true);
  });

  let after: { same: boolean; x: number; t: number; paint: string; pause: boolean };
  test('with only a new paint, Back returns to the same paused run', async () => {
    await page.click('.br-paint', 5);
    await page.click('#br-garage-back');
    after = await dbg(page, (d) => ({
      same: d.S === (window as any).__s,
      x: d.S.me.c.x,
      t: d.S.me.time,
      paint: d.S.me.look.paint.id,
      pause: !document.getElementById('br-pausemenu')!.hidden,
    }));
    expect(after.same).toBe(true);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
    expect(after.pause).toBe(true);
  });

  test('and the bike wears the new paint', () => {
    expect(after.paint).toBe('pink');
  });

  test('with a new bike, Back restarts the level on it', async () => {
    await page.click('#br-p-garage');
    await page.click('.br-gbike', 1); // Hopper
    await page.click('#br-garage-back');
    const now = await dbg(page, (d) => ({
      same: d.S === (window as any).__s,
      bike: d.S.me.type.id,
      phase: d.S.phase,
      view: !document.getElementById('br-hud')!.hidden,
    }));
    expect(now).toEqual({ same: false, bike: 'hopper', phase: 'ready', view: true });
  });

  test('Esc pauses the run (keyboard test mode)', async () => {
    await page.keyDown('ArrowUp');
    await wait(600);
    await page.keyUp('ArrowUp');
    await page.press('Escape');
    expect(await page.visible('br-pausemenu')).toBe(true);
  });

  test('Esc leaves the garage, back to the pause menu', async () => {
    await page.click('#br-p-garage');
    await page.press('Escape');
    expect(await page.visible('br-pausemenu')).toBe(true);
    expect(await page.visible('br-garage')).toBe(false);
  });

  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
});

describe('Garage from the crash sheet', () => {
  let page: Page;
  beforeAll(async () => {
    page = await phone({ save: SAVE_18, query: '?autopilot' });
  });
  afterAll(() => page?.close());

  test('the crash sheet has a Garage button', async () => {
    await dbg(page, (d) => void d.startSolo('clover-1'));
    await wait(800);
    await dbg(page, (d) => {
      // upside down: the head hits the ground
      d.S.me.c.a = Math.PI;
      d.S.me.c.y += 0.6;
    });
    await page.waitFor(() => !document.getElementById('br-crash')!.hidden, [], { timeout: 5000 });
    expect(await page.visible('br-crash-garage')).toBe(true);
  });

  test('Back returns to the crash sheet', async () => {
    await page.click('#br-crash-garage');
    await page.click('#br-garage-back');
    expect(await page.visible('br-crash')).toBe(true);
  });
});

describe('Result sheet: next bike, then a new bike', () => {
  const finish = async (page: Page) => {
    await dbg(page, (d) => void d.startSolo('clover-1'));
    await page.waitFor(() => !document.getElementById('br-result')!.hidden, [], { timeout: 30_000 });
  };

  describe('with no stars yet', () => {
    let page: Page;
    beforeAll(async () => {
      page = await phone({ save: SAVE_0, query: '?autopilot' });
    });
    afterAll(() => page?.close());

    test('the result shows progress to the next bike', async () => {
      await finish(page);
      expect(await page.text('#br-res-unlock')).toMatch(/Next bike: Hopper/);
    });

    test('the ghost remembers which bike set it', async () => {
      const ghost = await page.eval(() => JSON.parse(localStorage.getItem('bikerace.ghost.v1.clover-1')!));
      expect(ghost?.bike).toBe('scout');
      expect(ghost.f.length).toBeGreaterThan(100);
    });
  });

  describe('three stars short of Hopper', () => {
    let page: Page;
    beforeAll(async () => {
      page = await phone({ save: SAVE_8, query: '?autopilot' });
    });
    afterAll(() => page?.close());

    test('three more stars unlock Hopper on the result sheet', async () => {
      await finish(page);
      expect(await page.text('#br-res-unlock')).toMatch(/New bike: Hopper/);
    });

    test('the Garage button stands out when a bike was unlocked', async () => {
      expect(await page.eval(() => document.getElementById('br-res-garage')!.classList.contains('sky'))).toBe(true);
    });

    test('the card opens the garage on Hopper with a Ride button', async () => {
      await page.click('#br-res-unlock');
      expect(await page.text('#br-g-name')).toBe('Hopper');
      expect(await page.text('#br-g-status')).toMatch(/Ride Hopper/);
    });

    test('Ride picks it', async () => {
      await page.click('.br-ride');
      expect((await saved(page)).bike).toBe('hopper');
    });

    test('Back returns to the result sheet', async () => {
      await page.click('#br-garage-back');
      expect(await page.visible('br-result')).toBe(true);
    });

    test('the next level starts on the new bike', async () => {
      await page.click('#br-res-next');
      expect(await dbg(page, (d) => d.S.levelId + ' ' + d.S.me.type.id)).toBe('clover-2 hopper');
    });

    test('no errors in the page', () => {
      expect(page.errors).toEqual([]);
    });
  });
});

describe('Every bike rides in the browser', () => {
  let page: Page;
  beforeAll(async () => {
    const worlds = ['clover', 'ember', 'frost', 'moon', 'magma'];
    const all = Object.fromEntries(worlds.flatMap((w) => [1, 2, 3, 4, 5, 6].map((i) => [`${w}-${i}`, 3])));
    page = await phone({ save: { stars: all }, query: '?autopilot' });
  });
  afterAll(() => page?.close());

  for (const bike of ['scout', 'hopper', 'twister', 'bulldog', 'comet']) {
    test(`${bike} finishes Slag Slide`, async () => {
      // fast-forward the run in the page with the same code the game uses
      const finished = await page.eval((b) => {
        const C = window.BikeRace!._debug().C;
        const L = C.levelById('magma-4')!;
        const sim = new C.Sim(C.buildLevel(C.worldOf(L.id)!, L));
        const me = sim.addBike(b);
        me.running = true;
        while (!me.finished && !me.crashed && sim.t < 90) {
          me.input = C.botInput(me);
          sim.step();
        }
        return me.finished;
      }, bike);
      expect(finished).toBe(true);
    });
  }
});

describe('Fits on phones held sideways', () => {
  for (const [w, h] of [
    [844, 390],
    [932, 430],
    [740, 360],
    [667, 375],
    [667, 320],
    [568, 320],
  ] as const) {
    describe(`${w}x${h}`, () => {
      let page: Page;
      beforeAll(async () => {
        page = await phone({ w, h, save: SAVE_18 });
      });
      afterAll(() => page?.close());

      test(`garage fits at ${w}x${h}`, async () => {
        await page.click('#br-go-garage');
        await page.click('.br-gbike', 3);
        await wait(200);
        const fit = await page.eval(() => {
          const scr = document.getElementById('br-garage')!;
          const out: string[] = [];
          const parts = '.br-g-head, .br-g-show, .br-g-strip > *, .br-g-side, .br-paint, #br-name, .br-g-status';
          for (const el of scr.querySelectorAll(parts)) {
            const r = el.getBoundingClientRect();
            if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) {
              out.push(el.className || el.id);
            }
          }
          const side = document.querySelector('.br-g-side')!;
          return {
            out,
            scroll: scr.scrollHeight - scr.clientHeight,
            side: side.scrollHeight - side.clientHeight,
            stage: document.getElementById('br-g-stage')!.clientHeight,
          };
        });
        expect(fit.out).toEqual([]);
        expect(fit.scroll).toBeLessThanOrEqual(1);
        expect(fit.side).toBeLessThanOrEqual(1);
        expect(fit.stage).toBeGreaterThanOrEqual(110);
        await shot(page, `bike-race-garage-${w}x${h}.jpg`);
      });

      test(`pause sheet fits at ${w}x${h}`, async () => {
        await page.click('#br-garage-back');
        await dbg(page, (d) => void d.startSolo('clover-1'));
        await page.click('#br-pause');
        const sheet = await page.eval(() => {
          const s = document.querySelector('#br-pausemenu .sheet')!;
          const r = s.getBoundingClientRect();
          return { over: s.scrollHeight - s.clientHeight, top: r.top, bottom: r.bottom - innerHeight };
        });
        expect(sheet.over).toBeLessThanOrEqual(1);
        expect(sheet.top).toBeGreaterThanOrEqual(0);
        expect(sheet.bottom).toBeLessThanOrEqual(0);
        if (KEEP_SHOTS) {
          await wait(500);
          await shot(page, `bike-race-pause-${w}x${h}.jpg`);
        }
      });

      test('no errors in the page', () => {
        expect(page.errors).toEqual([]);
      });
    });
  }
});
