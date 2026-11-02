// Browser checks for Water Sort: the level picker, level 1 solved by clicking the tubes (the moves come from the
// game's own solver), the win sheet and the saved progress, Undo, Hint, the spare tube, Restart, the way back to
// the main menu, and progress saved by earlier versions of the game. It plays the real page in Bun's headless browser.
import { afterAll, expect, setDefaultTimeout, test } from 'bun:test';
import { LEVELS, type State, wsApply, wsSolve } from '../../public/js/water-sort-logic';
import { openPage, startSite, type Page } from '../support/browser';

setDefaultTimeout(60_000);
const site = startSite();
afterAll(() => site.stop());

const debug = (page: Page) => page.eval(() => window.WaterSort!._debug());

/** Water Sort on its level picker, with whatever is saved in localStorage */
async function open(storage?: Record<string, string>): Promise<Page> {
  const page = await openPage(site, { width: 1000, height: 600, path: '/#water-sort', storage });
  await page.waitFor(() => !!window.WaterSort && document.querySelectorAll('#ws-grid .ws-cell').length === 20);
  return page;
}

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
