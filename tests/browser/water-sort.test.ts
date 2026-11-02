// Browser checks for Water Sort: the level picker, level 1 solved by clicking the tubes (the moves come from the
// game's own solver), the win sheet and the saved progress, Undo, Hint, the spare tube, Restart, the way back to
// the main menu, progress saved by earlier versions of the game, and the level in progress coming back after a
// reload. It plays the real page in Bun's headless browser.
import { afterAll, expect, setDefaultTimeout, test } from 'bun:test';
import { LEVELS, type State, wsApply, wsSolve } from '../../public/js/water-sort-logic';
import { openPage, startSite, type Page } from '../support/browser';

setDefaultTimeout(60_000);
const site = startSite();
afterAll(() => site.stop());

const debug = (page: Page) => page.eval(() => window.WaterSort!._debug());
const PLAY = 'watersort.play.v1';
/** The level in progress, as saved */
const savedPlay = (page: Page): Promise<unknown> =>
  page.eval((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), PLAY);

/** Water Sort on its level picker (or the level in progress), with whatever is saved in localStorage */
async function open(storage?: Record<string, string>): Promise<Page> {
  const page = await openPage(site, { width: 1000, height: 600, path: '/#water-sort', storage });
  await opened(page);
  return page;
}
/** Wait until the game is up, on the picker or a level */
const opened = (page: Page) =>
  page.waitFor(
    () =>
      !!window.WaterSort &&
      ((!document.getElementById('ws-picker')!.hidden &&
        document.querySelectorAll('#ws-grid .ws-cell').length === 20) ||
        !document.getElementById('ws-play')!.hidden),
  );

/** Start a level from its cell on the picker */
async function startLevel(page: Page, i: number): Promise<void> {
  await page.click('#ws-grid .ws-cell', i);
  await page.waitFor((i) => !document.getElementById('ws-play')!.hidden && window.WaterSort!._debug().level === i, [i]);
}

/** Click a tube, as a player would */
async function clickTube(page: Page, i: number): Promise<void> {
  const at = (await debug(page)).tubesAt[i]!;
  await page.view.click(at.x, at.y);
}

/** Pour from tube a into tube b by clicking one and then the other, once neither is still pouring */
async function pour(page: Page, a: number, b: number): Promise<void> {
  await page.waitFor(() => !window.WaterSort!._debug().busy);
  await clickTube(page, a);
  expect((await debug(page)).sel).toBe(a);
  await clickTube(page, b);
}

test('Water Sort: the picker, level 1 solved by clicking tubes, the win sheet, and back to the menu', async () => {
  const page = await open();

  // the level picker: twenty levels, none done yet
  expect(await page.visible('ws-picker')).toBe(true);
  expect(await page.visible('ws-play')).toBe(false);
  expect(await page.eval(() => [...document.querySelectorAll('#ws-grid .n')].map((e) => e.textContent))).toEqual(
    LEVELS.map((_, i) => String(i + 1)),
  );
  expect(await page.text('#ws-grid .ws-cell:nth-child(6) .d')).toBe('Medium');
  expect(await page.eval(() => document.querySelectorAll('#ws-grid .done').length)).toBe(0);

  await startLevel(page, 0);
  expect(await page.text('#ws-level')).toBe('Level 1');
  expect(await page.text('#ws-diff')).toBe('Easy');
  expect(await page.text('#ws-hints')).toBe('3');
  expect(await page.eval(() => (document.getElementById('ws-undo') as HTMLButtonElement).disabled)).toBe(true);
  expect((await debug(page)).tubes).toEqual(LEVELS[0]!.tubes);

  // the level is saved as it starts
  expect(await savedPlay(page)).toEqual({ level: 1, tubes: LEVELS[0]!.tubes, undo: [], hints: 3, extra: false });

  // pour the solver's moves, checking the tubes after each one
  const moves = wsSolve(LEVELS[0]!.tubes)!;
  expect(moves.length).toBeGreaterThan(0);
  let want: State = LEVELS[0]!.tubes;
  for (const [k, [a, b]] of moves.entries()) {
    await pour(page, a, b);
    want = wsApply(want, a, b);
    expect((await debug(page)).tubes).toEqual(want);
    if (k === 1) await page.screenshot('water-sort-pour.jpg');
  }

  // the last pour lands, and the win sheet comes up
  expect(await page.until(() => !document.getElementById('ws-win')!.hidden, [], 10_000)).toBe(true);
  expect((await debug(page)).won).toBe(true);
  expect(await page.text('#ws-win-pill')).toBe('Level 1');
  expect(await page.visible('ws-next')).toBe(true);
  expect(await page.eval(() => localStorage.getItem('watersort.done.v1'))).toBe('[1]');
  expect(await savedPlay(page)).toBeNull(); // a level won is no longer in progress
  await Bun.sleep(400);
  await page.screenshot('water-sort-win.jpg');

  // Next level goes on to level 2
  await page.click('#ws-next');
  expect(await page.until(() => window.WaterSort!._debug().level === 1)).toBe(true);
  expect(await page.visible('ws-win')).toBe(false);
  expect(await page.text('#ws-level')).toBe('Level 2');

  // the back button goes to the picker, where level 1 is marked done
  await page.click('#ws-back');
  expect(await page.until(() => !document.getElementById('ws-picker')!.hidden)).toBe(true);
  expect(await page.eval(() => document.querySelector('#ws-grid .ws-cell')!.className)).toBe('ws-cell done');
  expect(await page.eval(() => document.querySelector('#ws-grid .ws-cell')!.getAttribute('aria-label'))).toBe(
    'Level 1, Easy, complete',
  );

  // and the picker's back button goes to the main menu
  await page.click('#ws-pick-back');
  expect(await page.until(() => !document.getElementById('hub')!.hidden)).toBe(true);
  expect(await page.visible('ws-app')).toBe(false);
  expect(await page.eval(() => location.hash)).toBe('');
  expect(page.errors).toEqual([]);
  page.close();
});

test('Water Sort: selecting, Undo, Hint, the spare tube and Restart', async () => {
  const page = await open();
  await startLevel(page, 1);
  const start = LEVELS[1]!.tubes;

  // a click picks a tube up and a second click on it puts it down
  await clickTube(page, 0);
  expect((await debug(page)).sel).toBe(0);
  await clickTube(page, 0);
  expect((await debug(page)).sel).toBe(-1);
  // an empty tube can't be picked up
  await clickTube(page, start.length - 1);
  expect((await debug(page)).sel).toBe(-1);

  // pour into an empty tube, then take it back
  const empty = start.length - 1;
  await pour(page, 0, empty);
  expect((await debug(page)).tubes).toEqual(wsApply(start, 0, empty));
  expect(await page.eval(() => (document.getElementById('ws-undo') as HTMLButtonElement).disabled)).toBe(false);
  await page.click('#ws-undo');
  expect((await debug(page)).tubes).toEqual(start);
  expect(await page.eval(() => (document.getElementById('ws-undo') as HTMLButtonElement).disabled)).toBe(true);

  // a hint costs one of three and picks up the first tube of the solver's next move
  await page.click('#ws-hint');
  expect(await page.text('#ws-hints')).toBe('2');
  expect((await debug(page)).sel).toBe(wsSolve(start, 80000)![0]![0]);
  expect((await debug(page)).hints).toBe(2);

  // the + button unlocks a spare empty tube
  const add = (await debug(page)).addAt!;
  expect(add).not.toBeNull();
  await page.view.click(add.x, add.y);
  let state = await debug(page);
  expect(state.tubes).toEqual([...start, []]);
  expect(state.addAt).toBeNull();
  await page.screenshot('water-sort-spare.jpg');

  // Restart puts the level back as it began, spare tube gone, but keeps the hints used
  await page.click('#ws-restart');
  state = await debug(page);
  expect(state.tubes).toEqual(start);
  expect(state.addAt).not.toBeNull();
  expect(state.hints).toBe(2);
  expect(await page.text('#ws-hints')).toBe('2');
  expect(page.errors).toEqual([]);
  page.close();
});

test('Water Sort: leaving just after a win, the win sheet is up on coming back', async () => {
  const page = await open();
  await startLevel(page, 0);
  for (const [a, b] of wsSolve(LEVELS[0]!.tubes)!) await pour(page, a, b);

  // go to the menu as soon as the last pour lands, before the sheet comes up
  const left = await page.waitFor(
    () => {
      if (!window.WaterSort!._debug().won) return null;
      const sheet = !document.getElementById('ws-win')!.hidden;
      window.GameHub.menu();
      return { sheet };
    },
    [],
    { timeout: 10_000, interval: 20 },
  );
  expect(left!.sheet).toBe(false);
  expect(await page.visible('hub')).toBe(true);

  await page.eval(() => window.GameHub.open('water-sort'));
  expect(await page.until(() => !document.getElementById('ws-app')!.hidden)).toBe(true);
  expect(await page.visible('ws-win')).toBe(true);
  expect(await page.text('#ws-win-pill')).toBe('Level 1');
  expect(await page.eval(() => localStorage.getItem('watersort.done.v1'))).toBe('[1]');
  expect(page.errors).toEqual([]);
  page.close();
});

test('Water Sort: progress saved before, and saves with odd entries or nothing that fits', async () => {
  const doneCells = (page: Page) =>
    page.eval(() =>
      [...document.querySelectorAll('#ws-grid .ws-cell')].flatMap((c, i) =>
        c.classList.contains('done') ? [i + 1] : [],
      ),
    );
  const saves: [saved: string, done: number[]][] = [
    ['[1,3]', [1, 3]], // as the game has always saved it
    ['[2,"7",null,{"n":4},5.5,6]', [2, 6]], // what isn't a number is dropped, and the rest kept
    ['{"done":[1]}', []], // not a list
    ['[1,', []], // not JSON
  ];
  for (const [saved, done] of saves) {
    const page = await open({ 'watersort.done.v1': saved });
    expect(await doneCells(page)).toEqual(done);
    expect(await page.eval(() => document.querySelector('#ws-grid .ws-cell')!.getAttribute('aria-label'))).toBe(
      done.includes(1) ? 'Level 1, Easy, complete' : 'Level 1, Easy',
    );
    // loading leaves the save as it was
    expect(await page.eval(() => localStorage.getItem('watersort.done.v1'))).toBe(saved);
    expect(page.errors).toEqual([]);
    page.close();
  }
});

test('Water Sort: the level being played comes back after a reload, and goes when left for the picker', async () => {
  const page = await open();
  await startLevel(page, 1);
  const start = LEVELS[1]!.tubes;
  const empty = start.length - 1;

  // a pour, a hint and the spare tube, each saved as it happens
  await pour(page, 0, empty);
  const poured = wsApply(start, 0, empty);
  expect(await savedPlay(page)).toEqual({ level: 2, tubes: poured, undo: [start], hints: 3, extra: false });
  await page.waitFor(() => !window.WaterSort!._debug().busy);
  await page.click('#ws-hint');
  expect(await savedPlay(page)).toMatchObject({ hints: 2 });
  const add = (await debug(page)).addAt!;
  await page.view.click(add.x, add.y);
  expect(await savedPlay(page)).toEqual({
    level: 2,
    tubes: [...poured, []],
    undo: [[...start, []]],
    hints: 2,
    extra: true,
  });

  // the reload opens on the level, as it was
  await page.reload();
  await opened(page);
  expect(await page.visible('ws-play')).toBe(true);
  expect(await page.visible('ws-picker')).toBe(false);
  let state = await debug(page);
  expect(state.level).toBe(1);
  expect(state.tubes).toEqual([...poured, []]);
  expect(state.hints).toBe(2);
  expect(state.addAt).toBeNull();
  expect(state.won).toBe(false);
  expect(await page.text('#ws-level')).toBe('Level 2');
  expect(await page.text('#ws-hints')).toBe('2');
  await page.screenshot('water-sort-reloaded.jpg');

  // Undo takes the pour back, and that is saved too
  await page.click('#ws-undo');
  state = await debug(page);
  expect(state.tubes).toEqual([...start, []]);
  expect(await page.eval(() => (document.getElementById('ws-undo') as HTMLButtonElement).disabled)).toBe(true);
  expect(await savedPlay(page)).toEqual({ level: 2, tubes: [...start, []], undo: [], hints: 2, extra: true });

  // Restart starts the level again (hints kept), saved as such
  await page.click('#ws-restart');
  expect(await savedPlay(page)).toEqual({ level: 2, tubes: start, undo: [], hints: 2, extra: false });

  // back on the picker the level is no longer in progress, so a reload opens on the picker
  await page.click('#ws-back');
  expect(await page.until(() => !document.getElementById('ws-picker')!.hidden)).toBe(true);
  expect(await savedPlay(page)).toBeNull();
  await page.reload();
  await opened(page);
  expect(await page.visible('ws-picker')).toBe(true);
  expect(await page.visible('ws-play')).toBe(false);
  expect(page.errors).toEqual([]);
  page.close();
});

test('Water Sort: a saved level in progress that does not fit leaves the picker, and the rest of the save', async () => {
  const L = LEVELS[0]!; // [[2, 1, 1, 0], [2, 1, 0, 0], [2, 1, 2, 0], [], []]
  const good = { level: 1, tubes: wsApply(L.tubes, 0, 3), undo: [L.tubes], hints: 1, extra: false };
  const saves: [why: string, saved: string, resumes: boolean][] = [
    ['a level in progress', JSON.stringify(good), true],
    ['not JSON', JSON.stringify(good).slice(0, -1), false],
    ['no such level', JSON.stringify({ ...good, level: 21 }), false],
    [
      'a colour the level does not have',
      JSON.stringify({ ...good, tubes: [[2, 1, 1, 9], ...good.tubes.slice(1)] }),
      false,
    ],
    ['a tube missing', JSON.stringify({ ...good, tubes: good.tubes.slice(1) }), false],
    ['a position Undo goes back to that does not fit', JSON.stringify({ ...good, undo: [[[0]]] }), false],
    ['more hints than a level has', JSON.stringify({ ...good, hints: 4 }), false],
    ['the spare tube said to be out but not there', JSON.stringify({ ...good, extra: true }), false],
    ['solved already', JSON.stringify({ ...good, tubes: [[0, 0, 0, 0], [1, 1, 1, 1], [2, 2, 2, 2], [], []] }), false],
    ['a field missing', JSON.stringify({ level: 1, tubes: good.tubes }), false],
  ];
  for (const [why, saved, resumes] of saves) {
    const page = await open({ [PLAY]: saved, 'watersort.done.v1': '[1,3]' });
    expect(await page.visible('ws-play'), why).toBe(resumes);
    expect(await page.visible('ws-picker'), why).toBe(!resumes);
    if (resumes) expect(await debug(page)).toMatchObject({ level: 0, tubes: good.tubes, hints: 1 });
    // the levels done are there whatever the level in progress holds
    await page.eval(() => document.getElementById('ws-back')!.click());
    expect(
      await page.eval(() => [...document.querySelectorAll('#ws-grid .done .n')].map((e) => e.textContent)),
      why,
    ).toEqual(['1', '3']);
    expect(await page.eval(() => localStorage.getItem('watersort.done.v1'))).toBe('[1,3]');
    expect(page.errors).toEqual([]);
    page.close();
  }
});
