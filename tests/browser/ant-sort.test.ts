// Browser checks for Ant Sort: the level picker, a level played to a win through the blocks on screen (the order
// comes from the solver in tests/ant-sort-solve.ts), the result sheets for a win and a loss, the in-game menu, and
// the way back to the main menu. It plays the real page in Bun's headless browser, on a phone-sized screen.
//
// That browser draws WebGL in software, at a few frames a second once a level is up, so after the first block the
// test runs the game faster through window.AntSort._speed. Each click waits until the ants have fetched all they can
// (the `quiet` state), so the game takes the same steps as the solver's Sim whatever the speed. Even so, winning
// level 1 takes the best part of a minute.
import { afterAll, expect, setDefaultTimeout, test } from 'bun:test';
import { LEVELS, loseFast, solve, startOf } from '../ant-sort-solve';
import { openPage, startSite, type Page } from '../support/browser';

setDefaultTimeout(120_000);
const site = startSite();
afterAll(() => site.stop());

const FAST = 100;
const PHONE = { width: 390, height: 844, mobile: true };

const debug = (page: Page) => page.eval(() => window.AntSort!._debug());

/** Ant Sort on a phone, on its level picker */
async function open(): Promise<Page> {
  const page = await openPage(site, { ...PHONE, path: '/#ant-sort' });
  await page.waitFor(() => !!window.AntSort && document.querySelectorAll('#cards .card').length === 20);
  return page;
}

/** Start a level from its card on the picker */
async function startLevel(page: Page, i: number): Promise<void> {
  await page.click('#cards .card', i);
  await page.waitFor((i) => window.AntSort!._debug().level === i && document.getElementById('levels')!.hidden, [i]);
}

/**
 * Wait in the page until the block last clicked has left its column (`moved` is how far along that column was
 * before the click; -1 when nothing was clicked), the ants have fetched everything they can reach, and the front
 * block of the next column (-1 for none) has moved up to the front row. Answers where to click it and how far along
 * its column is, or null when the click did not take. The page answers slowly while it draws, so the waiting happens
 * there.
 */
function settle(page: Page, clicked: number, moved: number, next: number) {
  return page.eval(
    (clicked, moved, next) =>
      new Promise<{ x: number; y: number; ptr: number } | null>((resolve, reject) => {
        const start = performance.now();
        const check = () => {
          const d = window.AntSort!._debug();
          const took = moved < 0 || d.colPtr[clicked]! > moved;
          const front = d.columns[next] ?? { x: 0, y: 0, ready: true };
          if (took && d.quiet && front.ready) resolve({ x: front.x, y: front.y, ptr: d.colPtr[next] ?? 0 });
          else if (!took && performance.now() - start > 3000) resolve(null);
          else if (performance.now() - start > 30_000) reject(new Error('the ants did not settle'));
          else setTimeout(check, 20);
        };
        check();
      }),
    clicked,
    moved,
    next,
  );
}

/**
 * Click the front block of each column in turn, as a player would, each time once the ants have fetched everything
 * they can reach. Clicks rather than taps: the headless browser takes over a second over each touch event. Each
 * click goes out together with the wait for its outcome, to save a round trip.
 */
async function play(page: Page, taps: number[]): Promise<void> {
  let at = (await settle(page, 0, -1, taps[0]!))!;
  for (const [k, col] of taps.entries()) {
    let next = null;
    for (let tries = 0; !next; tries++) {
      if (tries === 3) throw new Error(`column ${col} did not take the click`);
      [, next] = await Promise.all([page.view.click(at.x, at.y), settle(page, col, at.ptr, taps[k + 1] ?? -1)]);
    }
    at = next;
  }
}

test('Ant Sort: the picker, level 1 played to a win, the result sheet, and back to the menu', async () => {
  const page = await open();

  // the level picker: twenty boards with their names, no stars yet, and a way back to the main menu
  expect(await page.visible('levels')).toBe(true);
  expect(await page.eval(() => [...document.querySelectorAll('#cards .nm')].map((e) => e.textContent))).toEqual(
    LEVELS.map((L) => L.name),
  );
  expect(await page.text('#tallyN')).toBe('0 / 20');
  expect(await page.eval(() => document.querySelectorAll('#cards .star-on').length)).toBe(0);
  expect(await page.visible('toMenu')).toBe(true);
  expect(await page.visible('speed')).toBe(false);

  await startLevel(page, 0);
  expect(await page.visible('speed')).toBe(true);
  expect(await page.visible('info')).toBe(true);
  let state = await debug(page);
  expect(state.remaining).toBe(LEVELS[0]!.W * LEVELS[0]!.H);
  expect(state.colPtr).toEqual([0, 0, 0]);
  expect(state.slots).toEqual([null, null, null, null, null]);

  // the taps that win it, worked out on the same rules
  const taps = solve(startOf(0))!;
  expect(taps.length).toBeGreaterThan(0);

  // the first tap at the speed a player gets: the block goes to a slot and the ants come out for its colour
  const first = startOf(0).front(taps[0]!)!;
  const at = (await settle(page, 0, -1, taps[0]!))!;
  await page.view.click(at.x, at.y);
  expect(await page.until((c) => window.AntSort!._debug().colPtr[c] === 1, [taps[0]!])).toBe(true);
  state = await debug(page);
  expect(state.colPtr[taps[0]!]).toBe(1);
  expect(state.slots[0]?.c).toBe(first.c);
  expect(await page.until(() => window.AntSort!._debug().ants > 0, [], 10_000)).toBe(true);
  expect(await page.until(() => window.AntSort!._debug().remaining < 2116, [], 10_000)).toBe(true);
  await page.screenshot('ant-sort-play.jpg');

  // double speed, as a player can pick, then faster still for the rest
  await page.click('#speed');
  expect(await page.eval(() => document.getElementById('speed')!.getAttribute('aria-pressed'))).toBe('true');
  await page.eval((k) => window.AntSort!._speed(k), FAST);

  await play(page, taps.slice(1));

  // the ants carry off the last blocks, and the result sheet comes up
  expect(await page.until(() => !document.getElementById('result')!.hidden, [], 30_000)).toBe(true);
  state = await debug(page);
  expect(state.won).toBe(true);
  expect(state.over).toBe(true);
  expect(state.remaining).toBe(0);
  expect(await page.eval(() => document.getElementById('result')!.className)).toContain('win');
  expect(await page.text('#rTitle')).toBe('Level complete');
  expect(await page.text('#rText')).toBe('You earned a star. 1 of 20 collected.');
  expect(await page.text('#rMain')).toBe('Next level');
  expect(await page.eval(() => localStorage.getItem('antsort.stars.v1'))).toBe('["Rainbow"]');
  await Bun.sleep(600); // the sheet's entry animation
  await page.screenshot('ant-sort-win.jpg');

  // back to the levels: level 1 has its star
  await page.click('#rLevels');
  expect(await page.until(() => !document.getElementById('levels')!.hidden)).toBe(true);
  expect(await page.text('#tallyN')).toBe('1 / 20');
  expect(await page.eval(() => document.querySelector('#cards .card .cstar')!.getAttribute('class'))).toBe(
    'cstar star-on',
  );
  expect(await page.eval(() => document.querySelector('#cards .card')!.getAttribute('aria-label'))).toBe(
    'Level 1, Rainbow, star earned',
  );
  expect((await debug(page)).level).toBe(-1);

  // and the Menu button goes back to the main menu
  await page.click('#toMenu');
  expect(await page.until(() => !document.getElementById('hub')!.hidden)).toBe(true);
  expect(await page.visible('app')).toBe(false);
  expect(await page.eval(() => location.hash)).toBe('');
  expect(page.errors).toEqual([]);
  page.close();
});

test('Ant Sort: the in-game menu, a level lost by filling the slots, and Retry', async () => {
  const page = await open();
  await startLevel(page, 0);

  // the info button opens How to play, which pauses the level; Keep playing closes it
  await page.click('#info');
  expect(await page.visible('menu')).toBe(true);
  expect(await page.text('#menu h2')).toBe('How to play');
  await page.click('#mClose');
  expect(await page.visible('menu')).toBe(false);

  // eight taps that leave every slot holding a colour the ants cannot reach
  await page.eval((k) => window.AntSort!._speed(k), FAST);
  const taps = loseFast(startOf(0))!;
  await play(page, taps);
  expect(await page.until(() => !document.getElementById('result')!.hidden, [], 30_000)).toBe(true);
  const state = await debug(page);
  expect(state.over).toBe(true);
  expect(state.won).toBe(false);
  expect(state.slots.every((s) => s !== null)).toBe(true);
  expect(await page.eval(() => document.getElementById('result')!.className)).toContain('lose');
  expect(await page.text('#rTitle')).toBe('Out of space');
  expect(await page.text('#rMain')).toBe('Retry');
  await Bun.sleep(600);
  await page.screenshot('ant-sort-lose.jpg');

  // Retry starts the level again from the top
  await page.click('#rMain');
  expect(await page.until(() => document.getElementById('result')!.hidden)).toBe(true);
  expect(await page.until(() => window.AntSort!._debug().colPtr.every((p) => p === 0))).toBe(true);
  expect((await debug(page)).remaining).toBe(2116);
  expect((await debug(page)).over).toBe(false);

  // the menu's Levels button goes back to the picker, still without a star
  await page.click('#info');
  await page.click('#mLevels');
  expect(await page.until(() => !document.getElementById('levels')!.hidden)).toBe(true);
  expect(await page.text('#tallyN')).toBe('0 / 20');
  expect(await page.eval(() => localStorage.getItem('antsort.stars.v1'))).toBeNull();
  expect(page.errors).toEqual([]);
  page.close();
});
