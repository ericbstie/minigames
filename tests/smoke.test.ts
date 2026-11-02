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

test('the page runs no script that it did not bring (its Content-Security-Policy)', async () => {
  const page = await openPage(site, { ignoreErrors: /Content Security Policy/ });
  const blocked = await page.eval(async () => {
    const seen: string[] = [];
    document.addEventListener('securitypolicyviolation', (e) => seen.push(e.violatedDirective));
    // what a name that slipped past the escaping into innerHTML would try
    const box = document.createElement('div');
    box.innerHTML =
      '<img src="data:," onerror="window.__ran = 1"><iframe srcdoc="<script>parent.__ran = 2</script>"></iframe>';
    document.body.append(box);
    const s = document.createElement('script');
    s.textContent = 'window.__ran = 3';
    document.body.append(s);
    await new Promise((r) => setTimeout(r, 300));
    return { ran: (window as { __ran?: number }).__ran ?? null, seen };
  });
  expect(blocked.ran).toBeNull();
  expect(blocked.seen.some((d) => d.startsWith('script-src'))).toBe(true);
  page.close();
});

test('a blocked script counts as a page error in the browser tests', async () => {
  const page = await openPage(site);
  await page.eval(() => {
    const s = document.createElement('script');
    s.textContent = 'void 0';
    document.body.append(s);
  });
  expect(await page.until(() => true)).toBe(true);
  await Bun.sleep(200);
  expect(page.errors.some((e) => /Content Security Policy/.test(e))).toBe(true);
  page.close();
});
