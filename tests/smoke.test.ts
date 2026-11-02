// Every game opens from the menu without an error.
import { afterAll, expect, setDefaultTimeout, test } from 'bun:test';
import { openPage, startSite } from './support/browser';

setDefaultTimeout(30_000);
const site = startSite();
afterAll(() => site.stop());

test('the menu shows the four games', async () => {
  const page = await openPage(site);
  expect(
    await page.eval(() => [...document.querySelectorAll('.hub-card')].map((c) => (c as HTMLElement).dataset.game)),
  ).toEqual(['ant-sort', 'castle-defender', 'water-sort', 'bike-race']);
  expect(page.errors).toEqual([]);
  page.close();
});

for (const [n, game, screen] of [
  [0, 'ant-sort', 'app'],
  [1, 'castle-defender', 'cd-app'],
  [2, 'water-sort', 'ws-app'],
  [3, 'bike-race', 'br-app'],
] as const) {
  test(`${game} opens from its card and goes back to the menu`, async () => {
    const page = await openPage(site, {
      mobile: game === 'bike-race',
      width: game === 'bike-race' ? 844 : 1000,
      height: game === 'bike-race' ? 390 : 600,
    });
    await page.click('.hub-card', n);
    expect(
      await page.until((g, id) => location.hash === '#' + g && !document.getElementById(id)!.hidden, [game, screen]),
    ).toBe(true);
    expect(await page.visible(screen)).toBe(true);
    expect(await page.eval(() => document.getElementById('hub')!.hidden)).toBe(true);
    await Bun.sleep(500);
    await page.screenshot(`smoke-${game}.jpg`);
    await page.eval(() => window.GameHub.menu());
    expect(await page.visible('hub')).toBe(true);
    expect(await page.visible(screen)).toBe(false);
    expect(page.errors).toEqual([]);
    page.close();
  });
}
