// The site hosted at https://minigames.ericbs.dev: the server as `mise run app` runs it, behind a reverse proxy that
// handles https (tests/support/proxy.ts), with the test browser taking minigames.ericbs.dev to this computer. Two
// phones meet in a Bike Race room through the proxy: one over a secure WebSocket through a proxy that passes the
// Host on (as Caddy does), the other over the event stream through one that puts the server's own address there (as
// nginx does unless told not to). The page's Content-Security-Policy must let it all through.
//
// About fifteen seconds.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPage, startSite, type Page, type Site } from '../support/browser';
import { startProxy } from '../support/proxy';

setDefaultTimeout(60_000);
const HOST = 'minigames.ericbs.dev';

let dir = '';
let site: Site;
let caddy: Site;
let nginx: Site;
let a: Page;
let b: Page;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pick-a-game-proxy-'));
  const cert = join(dir, 'cert.pem');
  const key = join(dir, 'key.pem');
  const made = Bun.spawnSync(
    ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2'].concat([
      ...['-keyout', key, '-out', cert, '-subj', `/CN=${HOST}`],
    ]),
    { stdout: 'ignore', stderr: 'pipe' },
  );
  if (!made.success) throw new Error(`openssl could not make a certificate: ${made.stderr}`);
  site = startSite({ behindProxy: true });
  caddy = startProxy(site, { tls: { cert, key }, host: 'kept' });
  nginx = startProxy(site, { tls: { cert, key }, host: 'rewritten' });
});

afterAll(() => {
  a?.close();
  b?.close();
  caddy?.stop();
  nginx?.stop();
  site?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Bike Race on a phone held sideways, at minigames.ericbs.dev through a proxy, once its first screen is up */
async function phone(through: Site, path: string): Promise<Page> {
  const page = await openPage(through, { host: HOST, width: 844, height: 390, mobile: true, path });
  await page.waitFor(() => !!window.BikeRace && !!document.querySelector('#br-app .br-screen:not([hidden])'), [], {
    timeout: 10_000,
  });
  return page;
}

const online = (page: Page) =>
  page.until(
    () => {
      const d = window.BikeRace!._debug();
      return d.Net.status === 'online' && !!d.Net.id;
    },
    [],
    10_000,
  );
const inRoom = (page: Page, n: number) =>
  page.until(
    (n) =>
      !document.getElementById('br-mp-room')!.hidden && document.querySelectorAll('#br-room-players li').length === n,
    [n],
    10_000,
  );
const transport = (page: Page) => page.eval(() => window.BikeRace!._debug().Net.transport as string);

describe('hosted at minigames.ericbs.dev, behind a reverse proxy', () => {
  let code = '';

  test('the page loads over https on that name', async () => {
    a = await phone(caddy, '/?autopilot#bike-race');
    expect(await a.eval(() => location.origin)).toBe(`https://${HOST}:${caddy.port}`);
  });

  test('and finds the race server, over a secure WebSocket', async () => {
    await a.click('#br-go-mp');
    expect(await online(a)).toBe(true);
    expect(await transport(a)).toBe('ws');
  });

  test('a room opens, and its invite link is on the site', async () => {
    await a.click('#br-mp-create');
    expect(await inRoom(a, 1)).toBe(true);
    code = await a.text('#br-room-code');
    const link = await a.eval(() => window.BikeRace!._debug().inviteLink() as string);
    expect(link).toBe(`https://${HOST}:${caddy.port}/#bike-race/${code}`);
  });

  test('a phone on the event stream joins through the link, through a proxy that changes the Host', async () => {
    b = await phone(nginx, `/?autopilot&net=sse#bike-race/${code}`);
    expect(await inRoom(b, 2)).toBe(true);
    expect(await inRoom(a, 2)).toBe(true);
    expect(await transport(b)).toBe('sse');
  });

  test('nothing was blocked or went wrong in either page', () => {
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });
});
