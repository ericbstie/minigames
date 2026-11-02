// The parts of server/serve.ts around the race server: the https certificate that `mise run phone` keeps in .cert/,
// and when the page is rebuilt as files change (Bun's development server). tests/race-server.test.ts has the rest.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { certificateEnds, ensureCertificate, rebuildsPage } from '../server/serve';

const DAY = 86_400_000;
const dirs: string[] = [];
const freshDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pick-a-game-cert-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const ensure = (dir: string) => Effect.runPromise(ensureCertificate(dir));
const mode = (path: string) => statSync(path).mode & 0o777;
const daysLeft = (dir: string) => (certificateEnds(dir)! - Date.now()) / DAY;
// a certificate good for this many days, as an older version (or anyone) might have left it
const certificateFor = (dir: string, days: number) => {
  const made = Bun.spawnSync(
    ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', String(days)].concat([
      ...['-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-subj', '/CN=old'],
    ]),
    { stdout: 'ignore', stderr: 'ignore' },
  );
  expect(made.success).toBe(true);
};

describe('the https certificate', () => {
  test('is made the first time, good for 825 days, in a folder only its owner can read', async () => {
    const dir = join(freshDir(), '.cert');
    expect(await ensure(dir)).toBe('made');
    expect(daysLeft(dir)).toBeGreaterThan(824);
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, 'key.pem'))).toBe(0o600);
  });

  test('is kept while it is good for more than 30 days', async () => {
    const dir = freshDir();
    certificateFor(dir, 40);
    const before = readFileSync(join(dir, 'cert.pem'), 'utf8');
    expect(await ensure(dir)).toBe('kept');
    expect(readFileSync(join(dir, 'cert.pem'), 'utf8')).toBe(before);
  });

  test('is made again when it runs out within 30 days', async () => {
    const dir = freshDir();
    certificateFor(dir, 10);
    expect(daysLeft(dir)).toBeLessThan(11);
    expect(await ensure(dir)).toBe('renewed');
    expect(daysLeft(dir)).toBeGreaterThan(824);
  });

  test("is made again when it can't be read, or its key is missing", async () => {
    const broken = freshDir();
    certificateFor(broken, 400);
    writeFileSync(join(broken, 'cert.pem'), 'not a certificate');
    expect(certificateEnds(broken)).toBeNull();
    expect(await ensure(broken)).toBe('renewed');
    expect(daysLeft(broken)).toBeGreaterThan(824);

    const keyless = freshDir();
    certificateFor(keyless, 400);
    rmSync(join(keyless, 'key.pem'));
    expect(await ensure(keyless)).toBe('renewed');
    expect(mode(join(keyless, 'key.pem'))).toBe(0o600);
  });

  test('a folder an older version left open to everyone is closed', async () => {
    const dir = freshDir();
    certificateFor(dir, 400);
    Bun.spawnSync(['chmod', '755', dir]);
    expect(await ensure(dir)).toBe('kept');
    expect(mode(dir)).toBe(0o700);
  });
});

describe("Bun's development server", () => {
  test('rebuilds the page over http on this computer alone', () => {
    for (const host of ['127.0.0.1', 'localhost', 'LOCALHOST', '::1', '[::1]'])
      expect(rebuildsPage(false, host)).toBe(true);
  });

  test('not when the network can reach it, or over https', () => {
    for (const host of ['0.0.0.0', '::', '', '192.168.1.20', 'erics-mac.local'])
      expect(rebuildsPage(false, host)).toBe(false);
    expect(rebuildsPage(true, '127.0.0.1')).toBe(false);
  });
});
