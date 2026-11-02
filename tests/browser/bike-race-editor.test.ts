// Browser checks for the Bike Race level editor: My levels (new, rename, play, delete), building a track from the
// row of pieces, turning, flipping, dragging, deleting, undo and redo, touch gestures on the track, saving, the test
// ride and the sheets it shows, levels that come back after a reload, and that it all fits on phones held sideways.
// It plays the real page in Bun's headless browser as a phone, with real touch events for taps, drags and pinches.
// KEEP_SHOTS=1 keeps screenshots in .shots/.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { KEEP_SHOTS, openPage, startSite, wait, type Page } from '../support/browser';

setDefaultTimeout(60_000);
const site = startSite();
afterAll(() => site.stop());

const STORE = 'bikerace.levels.v1';
type Point = { x: number; y: number };
const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) <= e;
/** a is b, give or take 0.001 */
const expectNear = (a: number, b: number) =>
  expect(Math.abs(a - b), `expected ${a} to be within 0.001 of ${b}`).toBeLessThanOrEqual(1e-3);

/** Bike Race on a phone held sideways, with stored levels (an object, or the raw text) in place, at the home menu */
async function phone({ w = 844, h = 390, levels = null as object | string | null, query = '' } = {}): Promise<Page> {
  const page = await openPage(site, {
    width: w,
    height: h,
    mobile: true,
    path: `/${query}#bike-race`,
    storage: levels == null ? undefined : { [STORE]: typeof levels === 'string' ? levels : JSON.stringify(levels) },
  });
  await page.waitFor(
    () => !!window.BikeRace && !!window.BikeRaceEditor && !document.getElementById('br-home')!.hidden,
    [],
    { timeout: 5000 },
  );
  return page;
}

const stored = (page: Page): Promise<any> => page.eval((k) => JSON.parse(localStorage.getItem(k) || 'null'), STORE);

/** Run fn(d, arg) in the page, d being the editor's internals (BikeRaceEditor._debug()). fn goes as its source text. */
async function ed<R, A = null>(page: Page, fn: (d: any, arg: A) => R, arg?: A): Promise<R> {
  return (await page.view.evaluate(`(${fn.toString()})(BikeRaceEditor._debug(), ${JSON.stringify(arg ?? null)})`)) as R;
}

/** Focus an element and press a key in it */
async function pressIn(page: Page, selector: string, key: string): Promise<void> {
  await page.eval((sel) => (document.querySelector(sel) as HTMLElement).focus(), selector);
  await page.press(key);
}

const addTile = (page: Page, t: string) => page.click(`.br-ed-tile[data-t="${t}"]`);

// the camera glides after a piece is added: wait for it to settle before working out where things are on screen
const settle = (page: Page) => page.waitFor(() => !window.BikeRaceEditor!._debug().ed.camTo, [], { timeout: 3000 });

/** A world point on screen (CSS pixels) */
async function screenAt(page: Page, x: number, y: number): Promise<Point> {
  await settle(page);
  return ed(
    page,
    (d, [x, y]) => {
      const r = document.getElementById('br-canvas')!.getBoundingClientRect();
      return { x: r.left + d.ed.cam.sx(x), y: r.top + d.ed.cam.sy(y) };
    },
    [x, y],
  );
}

/** The middle of piece i's path, on screen */
async function pieceAt(page: Page, i: number): Promise<Point> {
  await settle(page);
  return ed(
    page,
    (d, i) => {
      const m = d.ed.geoms[i];
      const k = (m.pts.length >> 2) << 1;
      const r = document.getElementById('br-canvas')!.getBoundingClientRect();
      return { x: r.left + d.ed.cam.sx(m.pts[k]), y: r.top + d.ed.cam.sy(m.pts[k + 1]) };
    },
    i,
  );
}

// real touch input through the DevTools protocol: one or two fingers
const touch = (page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Point[]) =>
  page.touch(
    type,
    pts.map((p, id) => ({ x: p.x, y: p.y, id })),
  );
async function touchTap(page: Page, p: Point): Promise<void> {
  await touch(page, 'touchStart', [p]);
  await touch(page, 'touchEnd', []);
  await wait(30);
}
async function touchDrag(page: Page, a: Point, b: Point, steps = 12): Promise<void> {
  await touch(page, 'touchStart', [a]);
  for (let k = 1; k <= steps; k++) {
    await touch(page, 'touchMove', [{ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps }]);
  }
  await touch(page, 'touchEnd', []);
  await wait(30);
}
async function pinch(page: Page, c: Point, d0: number, d1: number, steps = 10): Promise<void> {
  const at = (d: number) => [
    { x: c.x - d / 2, y: c.y },
    { x: c.x + d / 2, y: c.y },
  ];
  await touch(page, 'touchStart', at(d0));
  for (let k = 1; k <= steps; k++) await touch(page, 'touchMove', at(d0 + ((d1 - d0) * k) / steps));
  await touch(page, 'touchEnd', []);
  await wait(30);
}

interface Piece {
  t: string;
  x: number;
  y: number;
  a: number;
  m: boolean;
}
interface EditorState {
  n: number;
  pieces: Piece[];
  finish: { x: number; y: number };
  sel: number;
  cur: { i: number; e: number } | null;
  mode: string;
  undo: number;
  redo: number;
  ppm: number;
  camX: number;
}
const state = (page: Page): Promise<EditorState> =>
  ed(page, (d) => ({
    n: d.ed.data.pieces.length,
    pieces: d.ed.data.pieces,
    finish: d.ed.data.finish,
    sel: d.ed.sel,
    cur: d.ed.cur,
    mode: d.ed.mode,
    undo: d.ed.undo.length,
    redo: d.ed.redo.length,
    ppm: d.ed.cam.ppm,
    camX: d.ed.cam.x,
  }));

const count = (page: Page, selector: string) => page.eval((sel) => document.querySelectorAll(sel).length, selector);
const names = (page: Page) =>
  page.eval(() => [...document.querySelectorAll<HTMLInputElement>('.br-ml-name')].map((e) => e.value));
/** Only taken with KEEP_SHOTS, as they were only taken with --keep before */
const shot = async (page: Page, name: string) => void (KEEP_SHOTS && (await page.screenshot(name)));

// The first two parts share one page: a new level, built up piece by piece, then worked on by touch.
describe('My levels and a new level', () => {
  let page: Page;
  beforeAll(async () => {
    page = await phone();
  });

  test('the home menu has a Level editor button', async () => {
    expect(await page.visible('br-go-editor')).toBe(true);
  });

  test('it opens My levels', async () => {
    await page.click('#br-go-editor');
    expect(await page.visible('br-mylevels')).toBe(true);
  });

  test('with nothing saved it says how to start', async () => {
    expect(await page.text('#br-ml-list')).toMatch(/No levels yet/);
  });

  test('New level opens the editor', async () => {
    await page.click('#br-ml-new');
    expect(await page.visible('br-editor')).toBe(true);
  });

  test('the new level is named and empty', async () => {
    expect(await page.text('#br-ed-name')).toBe('My level 1');
    expect(await page.text('#br-ed-count')).toBe('0 pieces');
  });

  test('undo and redo start switched off', async () => {
    expect(
      await page.eval(() => [
        (document.getElementById('br-ed-undo') as HTMLButtonElement).disabled,
        (document.getElementById('br-ed-redo') as HTMLButtonElement).disabled,
      ]),
    ).toEqual([true, true]);
  });

  test('one row of nine pieces', async () => {
    expect(await count(page, '.br-ed-tile')).toBe(9);
  });

  test('the new level is saved straight away', async () => {
    const s = await stored(page);
    expect(s?.levels.length).toBe(1);
    expect(s.levels[0].data.name).toBe('My level 1');
  });

  describe('Building', () => {
    let st: EditorState;
    test('tapping pieces in the row adds them one after another', async () => {
      for (const t of ['line3', 'ramp2', 'line2']) await addTile(page, t);
      st = await state(page);
      expect(st.n).toBe(3);
      expect(st.pieces.map((p) => p.t).join()).toBe('line3,ramp2,line2');
    });

    test('each piece carries on from the last and is picked once added', () => {
      expectNear(st.pieces[2]!.a, 30);
      expect(st.sel).toBe(3);
    });

    test('the finish moves along to the end of the track', async () => {
      const end = await ed(page, (d) => d.ed.geoms[3].ends[1]);
      expectNear(st.finish.x, end.x);
      expectNear(st.finish.y, end.y);
    });

    test('the piece count follows', async () => {
      expect(await page.text('#br-ed-count')).toBe('3 pieces');
    });

    test('every change is saved', async () => {
      expect((await stored(page)).levels[0].data.pieces.length).toBe(3);
    });

    // turn and flip the picked piece, then undo it all
    test('turn left turns the picked piece 15 degrees', async () => {
      await page.click('#br-ed-rotl');
      expectNear((await state(page)).pieces[2]!.a, 45);
    });

    test('turn right turns it back the other way', async () => {
      await page.click('#br-ed-rotr');
      await page.click('#br-ed-rotr');
      expectNear((await state(page)).pieces[2]!.a, 15);
    });

    test('flip upside down mirrors it', async () => {
      await page.click('#br-ed-flipv');
      expect((await state(page)).pieces[2]!.m).toBe(true);
    });

    test('undo takes the turns and the flip back', async () => {
      for (let k = 0; k < 4; k++) await page.click('#br-ed-undo');
      st = await state(page);
      expectNear(st.pieces[2]!.a, 30);
      expect(st.pieces[2]!.m).toBeFalsy();
      expect(st.redo).toBe(4);
    });

    test('redo puts a turn back', async () => {
      await page.click('#br-ed-redo');
      expectNear((await state(page)).pieces[2]!.a, 45);
    });

    // close a loop: a 3/4 loop then a quarter loop, and the track carries on out of it
    test('after a closed loop the next piece carries on out of the loop', async () => {
      await page.click('#br-ed-undo');
      await addTile(page, 'loop3');
      await addTile(page, 'loop1');
      await addTile(page, 'line3');
      st = await state(page);
      const loopIn = await ed(page, (d) => d.ed.geoms[4].ends[0]);
      const out0 = await ed(page, (d) => d.ed.geoms[6].ends[0]);
      // the whole track in view, for the picture and for the touches that follow: the camera has followed the track
      // to its end, which leaves the start pad they tap off the left of the screen (the old Playwright test only did
      // this with --keep, and its touches only landed on the track then)
      await ed(page, (d) => void d.fitView());
      await wait(300);
      await shot(page, 'bike-race-editor-built.jpg');
      expectNear(out0.x, loopIn.x);
      expectNear(out0.y, loopIn.y);
      expectNear(st.pieces[5]!.a, 30);
    });
  });

  describe('Touching the track', () => {
    afterAll(() => page?.close());
    let st: EditorState;
    let loose = 0;

    // Build: tap the start pad's back end, and the next piece goes off the back
    test('tapping an end in Build moves the arrow there', async () => {
      await touchTap(page, await screenAt(page, -3, 0));
      st = await state(page);
      expect(st.cur).toMatchObject({ i: 0, e: 0 });
    });

    test('and the next piece is added there', async () => {
      await addTile(page, 'line1');
      st = await state(page);
      expect(st.n).toBe(7);
      expectNear(st.pieces[6]!.x, -3);
      expectNear(st.pieces[6]!.a, 180);
    });

    // Build: tap open space above the first line, and the next piece starts there, on the grid
    test('tapping open space starts a piece there on the grid', async () => {
      await page.click('#br-ed-undo');
      await touchTap(page, await screenAt(page, 15.2, 6.1));
      await addTile(page, 'line1');
      st = await state(page);
      loose = st.n - 1;
      expectNear(st.pieces[loose]!.x, 15);
      expectNear(st.pieces[loose]!.y, 6);
      expectNear(st.pieces[loose]!.a, 0);
    });

    // Edit: pick a piece, then drag the loose one by its middle so its start lands near the end of the first line
    test('Edit mode is shown as on', async () => {
      await page.click('.br-ed-modes [data-mode="edit"]');
      expect((await state(page)).mode).toBe('edit');
      expect(await page.eval(() => document.getElementById('br-editor')!.dataset.mode)).toBe('edit');
    });

    test('tapping a piece in Edit picks it and turns on the buttons', async () => {
      await touchTap(page, await pieceAt(page, 1));
      st = await state(page);
      expect(st.sel).toBe(1);
      expect(await page.eval(() => (document.getElementById('br-ed-rotl') as HTMLButtonElement).disabled)).toBe(false);
    });

    test("the start pad can't be picked", async () => {
      await touchTap(page, await screenAt(page, 0, 0));
      expect((await state(page)).sel).toBe(-1);
    });

    test('dragging a piece in Edit moves it, and its end snaps onto the end it is dropped near', async () => {
      const lineEnd: Point = await ed(page, (d) => d.ed.geoms[1].ends[1]);
      const grab = await pieceAt(page, loose + 1);
      const mid: Point = await ed(
        page,
        (d, i) => {
          const m = d.ed.geoms[i];
          const k = (m.pts.length >> 2) << 1;
          return { x: m.pts[k], y: m.pts[k + 1] };
        },
        loose + 1,
      );
      // where the grabbed point ends up if the piece's start moves to just off the line's end (joined to the ramp:
      // a piece can still be snapped onto it)
      const drop = await screenAt(page, mid.x + (lineEnd.x + 0.3 - 15), mid.y + (lineEnd.y + 0.2 - 6));
      await touchDrag(page, grab, drop);
      st = await state(page);
      const moved: Point[] = await ed(
        page,
        (d, i) => d.ed.geoms[i].ends.map((E: Point) => ({ x: E.x, y: E.y })),
        loose + 1,
      );
      const snapped = moved.some((E) => near(E.x, lineEnd.x) && near(E.y, lineEnd.y));
      expect(snapped, JSON.stringify({ moved, lineEnd })).toBe(true);
    });

    test('the move can be undone and the piece stays picked', () => {
      expect(st.undo).toBeGreaterThan(0);
      expect(st.sel).toBe(loose + 1);
    });

    test('undo puts the dragged piece back', async () => {
      await page.click('#br-ed-undo');
      st = await state(page);
      expectNear(st.pieces[loose]!.x, 15);
      expectNear(st.pieces[loose]!.y, 6);
    });

    // a drag that starts off the track pans the view; pinch and the mouse wheel zoom
    test('dragging the sky pans the view', async () => {
      const cam0 = await state(page);
      await touchDrag(page, await screenAt(page, 30, 20), await screenAt(page, 25, 20));
      st = await state(page);
      expect(st.camX).toBeGreaterThan(cam0.camX + 2);
      expect(st.n).toBe(cam0.n);
    });

    let pinched = 0;
    test('pinching zooms out', async () => {
      await pinch(page, { x: 400, y: 180 }, 200, 100);
      pinched = (await state(page)).ppm;
      expect(pinched).toBeLessThan(st.ppm * 0.7);
    });

    test('the mouse wheel zooms in', async () => {
      await page.view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 180 });
      await page.view.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 180, deltaX: 0, deltaY: -300 });
      await wait(50);
      expect((await state(page)).ppm).toBeGreaterThan(pinched * 1.2);
    });

    // Delete
    let before = 0;
    test('tapping a piece in Delete removes it', async () => {
      await ed(page, (d) => void d.fitView());
      await page.click('.br-ed-modes [data-mode="delete"]');
      before = (await state(page)).n;
      await touchTap(page, await pieceAt(page, loose + 1));
      expect((await state(page)).n).toBe(before - 1);
    });

    test("the finish can't be deleted, and says so", async () => {
      await touchTap(page, await pieceAt(page, before)); // the finish pad
      expect((await state(page)).n).toBe(before - 1);
      expect(await page.text('#br-ed-hint')).toMatch(/can't be removed/);
    });

    test('no errors in the page', async () => {
      await page.click('.br-ed-modes [data-mode="build"]');
      expect(page.errors).toEqual([]);
    });
  });
});

describe('Test ride', () => {
  let page: Page;
  beforeAll(async () => {
    page = await phone({ query: '?autopilot' });
  });
  afterAll(() => page?.close());

  test('Test starts a ride on the level', async () => {
    await page.click('#br-go-editor');
    await page.click('#br-ml-new');
    for (const t of ['line3', 'ramp1', 'line3']) await addTile(page, t);
    await page.click('#br-ed-test');
    await page.waitFor(() => !document.getElementById('br-hud')!.hidden, [], { timeout: 3000 });
    expect(await page.visible('br-hud')).toBe(true);
  });

  test('the result says it was a test ride', async () => {
    await page.waitFor(() => !document.getElementById('br-result')!.hidden, [], { timeout: 30_000 });
    expect(await page.text('#br-res-title')).toBe('Test ride done!');
  });

  test('no stars and no next level on a level of your own', async () => {
    expect(
      await page.eval(() => ({
        next: document.getElementById('br-res-next')!.hidden,
        stars: getComputedStyle(document.querySelector('#br-result .br-rstars')!).display,
      })),
    ).toEqual({ next: true, stars: 'none' });
  });

  test('the way back is labelled Edit', async () => {
    expect(await page.text('#br-res-levels')).toBe('Edit');
  });

  test("the time is saved as the level's best", async () => {
    const s = await stored(page);
    expect(s.levels[0].best?.t).toBeGreaterThan(0);
  });

  test('Edit goes back to the editor with the level as it was', async () => {
    await page.click('#br-res-levels');
    expect(await page.visible('br-editor')).toBe(true);
    expect((await state(page)).n).toBe(3);
  });

  // a crash
  test('the crash sheet goes back to Edit too', async () => {
    await page.click('#br-ed-test');
    await wait(600);
    await page.eval(() => {
      const d = window.BikeRace!._debug();
      d.S!.me.c.a = Math.PI;
      d.S!.me.c.y += 0.6;
    });
    await page.waitFor(() => !document.getElementById('br-crash')!.hidden, [], { timeout: 5000 });
    expect(await page.text('#br-crash-levels')).toBe('Edit');
  });

  test('and it does', async () => {
    await page.click('#br-crash-levels');
    expect(await page.visible('br-editor')).toBe(true);
  });

  // the pause sheet
  test('the pause sheet names the level and goes back to Edit', async () => {
    await page.click('#br-ed-test');
    await wait(300);
    await page.click('#br-pause');
    expect(await page.text('#br-pause-text')).toMatch(/My level 1/);
    expect(await page.text('#br-p-levels')).toBe('Edit');
  });

  test('Edit from the pause sheet goes back to the editor', async () => {
    await page.click('#br-p-levels');
    expect(await page.visible('br-editor')).toBe(true);
  });

  // changing the track drops the best time
  test('a changed track loses its old best time', async () => {
    await addTile(page, 'line1');
    await page.click('#br-ed-back');
    expect(await page.visible('br-mylevels')).toBe(true);
    expect(await page.text('.br-ml-meta')).not.toMatch(/Best/);
  });

  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
});

const SAVED = {
  v: 1,
  levels: [
    {
      id: 'aaa1',
      updated: 2,
      best: null,
      data: {
        v: 1,
        name: 'Hills',
        pieces: [{ t: 'ramp1', x: 9, y: 0, a: 0, m: false }],
        finish: { x: 17.9, y: 0.5, d: 1 },
      },
    },
    {
      id: 'bbb2',
      updated: 1,
      best: null,
      data: { v: 1, name: 'Flat', pieces: [{ t: 'line2', x: 9, y: 0, a: 0, m: false }], finish: { x: 17, y: 0, d: 1 } },
    },
  ],
};

describe('Saved levels', () => {
  let page: Page;
  beforeAll(async () => {
    page = await phone({ levels: SAVED, query: '?autopilot' });
  });
  afterAll(() => page?.close());

  test('My levels lists saved levels, latest first', async () => {
    await page.click('#br-go-editor');
    expect((await names(page)).join()).toBe('Hills,Flat');
  });

  // play from the list
  test('a level played from the list finishes and goes back to My levels', async () => {
    await page.click('.br-ml-card[data-id="bbb2"] [data-act="play"]');
    await page.waitFor(() => !document.getElementById('br-result')!.hidden, [], { timeout: 30_000 });
    expect(await page.text('#br-res-title')).toBe('Finished!');
    expect(await page.text('#br-res-levels')).toBe('My levels');
  });

  test('the list shows its best time', async () => {
    await page.click('#br-res-levels');
    expect(await page.visible('br-mylevels')).toBe(true);
    expect(await page.text('.br-ml-card[data-id="bbb2"] .br-ml-meta')).toMatch(/Best \d+\.\d\ds/);
  });

  // rename
  test('renaming in the list saves the new name', async () => {
    await page.fill('.br-ml-card[data-id="aaa1"] .br-ml-name', 'Big hills');
    await pressIn(page, '.br-ml-card[data-id="aaa1"] .br-ml-name', 'Enter');
    const s = await stored(page);
    expect(s.levels.find((L: { id: string }) => L.id === 'aaa1').data.name).toBe('Big hills');
  });

  // still there after a reload
  test('levels are still there after a reload', async () => {
    await page.reload();
    await page.waitFor(() => !!window.BikeRace && !document.getElementById('br-home')!.hidden, [], { timeout: 5000 });
    await page.click('#br-go-editor');
    const now = await names(page);
    expect(now).toContain('Big hills');
    expect(now).toContain('Flat');
  });

  // edit opens it
  test('Edit opens the saved level', async () => {
    await page.click('.br-ml-card[data-id="aaa1"] [data-act="edit"]');
    expect(await page.visible('br-editor')).toBe(true);
    expect(await page.text('#br-ed-name')).toBe('Big hills');
    expect((await state(page)).pieces[0]!.t).toBe('ramp1');
  });

  // delete asks once
  const del = '.br-ml-card[data-id="bbb2"] [data-act="del"]';
  test('Delete asks to be sure first', async () => {
    await page.click('#br-ed-back');
    await page.click(del);
    expect(await page.text(del)).toBe('Sure?');
    expect(await count(page, '.br-ml-card')).toBe(2);
  });

  test('a second tap deletes the level', async () => {
    await page.click(del);
    expect(await count(page, '.br-ml-card')).toBe(1);
    expect((await stored(page)).levels.length).toBe(1);
  });

  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
});

describe('Damaged storage', () => {
  const bad = {
    v: 1,
    levels: [
      { id: '../x', data: {} },
      null,
      5,
      {
        id: 'okay1',
        data: {
          name: '<img src=x onerror="window.pwned=1">',
          pieces: [{ t: 'nope' }, { t: 'line1', x: 'NaN', y: 1e99 }],
        },
      },
      { id: 'okay1', data: {} },
    ],
  };
  let page: Page;
  beforeAll(async () => {
    page = await phone({ levels: bad });
  });
  afterAll(() => page?.close());

  test('only well-formed levels are listed', async () => {
    await page.click('#br-go-editor');
    expect(await count(page, '.br-ml-card')).toBe(1);
  });

  test('a name is shown as text, never as page markup', async () => {
    expect(await page.eval(() => !document.querySelector('#br-ml-list img') && !(window as any).pwned)).toBe(true);
  });

  test('pieces are cleaned up when the level opens', async () => {
    await page.click('.br-ml-card [data-act="edit"]');
    const st = await state(page);
    const keep = page.errors.filter((e) => !/favicon/.test(e));
    page.errors.splice(0, page.errors.length, ...keep);
    expect(st.n).toBe(1);
    expect(st.pieces[0]!.y).toBe(5000);
    expect(st.pieces[0]!.x).toBe(0);
  });

  for (const raw of ['not json', '{"levels": 7}']) {
    test(`storage holding ${raw} shows an empty list`, async () => {
      await page.eval((k, v) => localStorage.setItem(k, v), STORE, raw);
      await page.eval(() => (window.BikeRace as any).editor.showView('mylevels'));
      expect(await page.text('#br-ml-list')).toMatch(/No levels yet/);
    });
  }

  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
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
        page = await phone({ w, h, levels: SAVED });
      });
      afterAll(() => page?.close());

      test(`the Level editor button fits on the home menu at ${w}x${h}`, async () => {
        const home = await page.eval(() => {
          const r = document.getElementById('br-go-editor')!.getBoundingClientRect();
          return { right: r.right - innerWidth, bottom: r.bottom - innerHeight, width: r.width };
        });
        expect(home.right).toBeLessThanOrEqual(1);
        expect(home.bottom).toBeLessThanOrEqual(1);
        expect(home.width).toBeGreaterThan(100);
      });

      let fit: { out: string[]; overlap: boolean; tileW: number; tileH: number; scrolls: boolean; small: number };
      test(`the editor's buttons fit at ${w}x${h}`, async () => {
        await page.click('#br-go-editor');
        await page.click('.br-ml-card[data-id="aaa1"] [data-act="edit"]');
        for (const t of ['line2', 'loop2']) await addTile(page, t);
        await wait(400);
        fit = await page.eval(() => {
          const R = (el: Element) => el.getBoundingClientRect();
          const out: string[] = [];
          const inside = (el: Element) => {
            const r = R(el);
            return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
          };
          const all = '#br-editor .br-ed-tl button, #br-ed-test, .br-ed-bar, .br-ed-modes button, .br-ed-acts button';
          for (const el of document.querySelectorAll(all)) if (!inside(el)) out.push(el.id || el.className);
          const back = R(document.getElementById('br-ed-redo')!);
          const test = R(document.getElementById('br-ed-test')!);
          const name = R(document.getElementById('br-ed-name')!);
          const tiles = [...document.querySelectorAll('.br-ed-tile')].map(R);
          const row = document.getElementById('br-ed-row')!;
          const buttons = '.br-ed-modes button, .br-ed-acts button, #br-editor .br-ed-tl button';
          const small = [...document.querySelectorAll(buttons)].map(R).filter((r) => r.height < 17 || r.width < 30);
          return {
            out,
            overlap: name.left < back.right - 1 || name.right > test.left + 1,
            tileW: Math.min(...tiles.map((r) => r.width)),
            tileH: Math.min(...tiles.map((r) => r.height)),
            scrolls: row.scrollWidth > row.clientWidth + 1,
            small: small.length,
          };
        });
        expect(fit.out).toEqual([]);
        expect(fit.overlap).toBe(false);
        expect(fit.small).toBe(0);
      });

      test(`the pieces are big enough to tap at ${w}x${h}`, () => {
        expect(fit.tileW).toBeGreaterThanOrEqual(44);
        expect(fit.tileH).toBeGreaterThanOrEqual(44);
      });

      // the last piece in the row can be reached (the row scrolls on small phones)
      test(`every piece in the row can be reached at ${w}x${h}`, async () => {
        const last = await page.eval(() => {
          const el = document.querySelector('.br-ed-tile[data-t="loop3"]')!;
          (el as Element & { scrollIntoViewIfNeeded(center?: boolean): void }).scrollIntoViewIfNeeded();
          const r = el.getBoundingClientRect();
          const row = document.getElementById('br-ed-row')!.getBoundingClientRect();
          return { right: r.right - row.right, left: r.left - row.left };
        });
        expect(last.right).toBeLessThanOrEqual(1);
        expect(last.left).toBeGreaterThanOrEqual(-1);
        await shot(page, `bike-race-editor-${w}x${h}.jpg`);
      });

      test(`the My levels cards fit at ${w}x${h}`, async () => {
        await page.click('#br-ed-back');
        const list = await page.eval(() => {
          const c = document.querySelector('.br-ml-card')!;
          const r = c.getBoundingClientRect();
          return { right: r.right - innerWidth, over: c.scrollWidth - c.clientWidth };
        });
        expect(list.right).toBeLessThanOrEqual(0);
        expect(list.over).toBeLessThanOrEqual(1);
        if (KEEP_SHOTS) {
          await wait(500);
          await shot(page, `bike-race-mylevels-${w}x${h}.jpg`);
        }
      });

      test('no errors in the page', () => {
        expect(page.errors).toEqual([]);
      });
    });
  }
});
