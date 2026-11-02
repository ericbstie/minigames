// Browser checks for the menu's cards: each says how far the player has got in its game, from what the games have
// saved (stars, a level or a game left in progress, the longest the castle has held), and says it again each time the
// player comes back to the menu. A save that makes no sense says nothing. KEEP_SHOTS=1 keeps screenshots in .shots/.
import { afterAll, expect, setDefaultTimeout, test } from 'bun:test';
import { simSave } from '../../public/js/ant-sort-logic';
import { LEVELS as BIKE_LEVELS } from '../../public/js/bike-race-core';
import { LEVELS as WS_LEVELS } from '../../public/js/water-sort-logic';
import { LEVELS as ANT_LEVELS, startOf } from '../ant-sort-solve';
import { openPage, startSite, type Page } from '../support/browser';

setDefaultTimeout(60_000);
const site = startSite();
afterAll(() => site.stop());

/** The notes on each card, by its game */
const notes = (page: Page): Promise<Record<string, string[]>> =>
  page.eval(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('.hub-card')].map((c) => [
        c.dataset.game!,
        [...c.querySelectorAll('.pg span')].map((s) => s.textContent ?? ''),
      ]),
    ),
  );
const none = { 'ant-sort': [], 'castle-defender': [], 'water-sort': [], 'bike-race': [] };

/** Back to the menu, the way the games' menu buttons go */
async function menu(page: Page): Promise<void> {
  await page.eval(() => window.GameHub.menu());
  expect(await page.until(() => !document.getElementById('hub')!.hidden)).toBe(true);
}

test('with nothing saved the cards have no notes, and no line for them', async () => {
  const page = await openPage(site);
  expect(await notes(page)).toEqual(none);
  expect(
    await page.eval(() => [...document.querySelectorAll('.hub-card .pg')].map((e) => getComputedStyle(e).display)),
  ).toEqual(['none', 'none', 'none', 'none']);
  expect(page.errors).toEqual([]);
  page.close();
});

test('the cards show the stars and what was left in progress, and change when the player comes back', async () => {
  const page = await openPage(site, {
    storage: {
      'antsort.stars.v1': JSON.stringify([ANT_LEVELS[0]!.name, ANT_LEVELS[1]!.name, ANT_LEVELS[2]!.name, 'no such']),
      'antsort.play.v1': JSON.stringify({ level: ANT_LEVELS[4]!.name, ...simSave(startOf(4)) }),
      'watersort.done.v1': JSON.stringify([1, 2, 3, 4, 99]),
      'watersort.play.v1': JSON.stringify({ level: 5, tubes: WS_LEVELS[4]!.tubes, undo: [], hints: 3, extra: false }),
      'castle.bestTime': '390',
      'bikerace.v1': JSON.stringify({ stars: { [BIKE_LEVELS[0]!.id]: 3, [BIKE_LEVELS[1]!.id]: 2 } }),
    },
  });
  expect(await notes(page)).toEqual({
    'ant-sort': ['3 of 20 stars', 'Level 5 in progress'],
    'castle-defender': ['Best 6:30'],
    'water-sort': ['4 of 20 stars', 'Level 5 in progress'],
    'bike-race': [`5 of ${BIKE_LEVELS.length * 3} stars`],
  });
  await page.screenshot('menu-progress.jpg');

  // a Castle Defender game, left for the menu, is a game in progress
  await page.click('.hub-card', 1);
  await page.waitFor(() => !!window.CastleDefender?._debug().G, [], { timeout: 20_000 });
  await menu(page);
  expect((await notes(page))['castle-defender']).toEqual([
    expect.stringMatching(/^Game in progress \(0:\d\d\)$/),
    'Best 6:30',
  ]);

  // Water Sort's level 5, left for the picker, is no longer in progress
  await page.click('.hub-card', 2);
  expect(await page.until(() => !document.getElementById('ws-play')!.hidden)).toBe(true);
  await page.click('#ws-back');
  expect(await page.until(() => !document.getElementById('ws-picker')!.hidden)).toBe(true);
  await menu(page);
  expect((await notes(page))['water-sort']).toEqual(['4 of 20 stars']);
  expect(page.errors).toEqual([]);
  page.close();
});

test('saves that make no sense leave the cards without notes', async () => {
  const page = await openPage(site, {
    storage: {
      'antsort.stars.v1': '{"stars": 3}',
      'antsort.play.v1': JSON.stringify({ level: ANT_LEVELS[4]!.name, board: '1', columns: [], slots: [] }),
      'watersort.done.v1': '[1,',
      'watersort.play.v1': JSON.stringify({ level: 5, tubes: [[1, 1, 1, 1, 1]], undo: [], hints: 3, extra: false }),
      'castle.bestTime': 'soon',
      'castle.world.v1': '{"t": 30}',
      'bikerace.v1': '{"stars": "lots"}',
    },
  });
  expect(await notes(page)).toEqual(none);
  expect(page.errors).toEqual([]);
  page.close();
});
