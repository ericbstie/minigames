// The parts of server/serve.ts around the race server: the https certificate that `mise run phone` keeps in .cert/,
// when the page is rebuilt as files change (Bun's development server), and the server as `mise run app` and
// `mise run dev` start it, asked for by minigames.ericbs.dev through Caddy. tests/race-server.test.ts has the rest.
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

// The server as mise starts it (bun server/serve.ts and its flags), on a free port, once it says it is running
const running: Bun.Subprocess[] = [];
afterAll(() => {
  for (const proc of running) proc.kill();
});
async function launch(flags: string[] = [], env: Record<string, string> = {}) {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port!;
  await probe.stop(true);
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'server', 'serve.ts'), ...flags], {
    env: { ...process.env, PORT: String(port), ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  running.push(proc);
  const reader = proc.stdout.getReader();
  let out = '';
  while (!out.includes('Ctrl+C')) {
    const { value, done } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return { proc, out, base: `http://127.0.0.1:${port}` };
}

// What Caddy sends on: the Host as the browser asked for it, and who asked
const caddy = { Host: 'minigames.ericbs.dev', 'X-Forwarded-For': '203.0.113.5', 'X-Forwarded-Proto': 'https' };
// Bun's WebSocket takes headers too, which the DOM's WebSocket type (the tsconfig has the DOM's types) doesn't know
const BunWebSocket = WebSocket as unknown as new (url: string, options: Bun.WebSocketOptions) => WebSocket;

describe('mise run app at minigames.ericbs.dev, behind Caddy', () => {
  let app: Awaited<ReturnType<typeof launch>>;

  test('starts, and says a proxy can serve it there', async () => {
    app = await launch();
    expect(app.out).toContain('https://minigames.ericbs.dev');
  }, 30_000);

  test('serves the page to minigames.ericbs.dev (not the development server, which refuses that name)', async () => {
    const res = await fetch(app.base + '/', { headers: caddy });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Pick a Game</title>');
  });

  test('its race server takes a WebSocket from the page there, which the browser opened over wss', async () => {
    const headers = { ...caddy, Origin: 'https://minigames.ericbs.dev' };
    const ws = new BunWebSocket(app.base.replace('http', 'ws') + '/ws', { headers });
    const welcome = await new Promise<{ t: string }>((resolve, reject) => {
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: 'Eric' }));
      ws.onmessage = (e) => resolve(JSON.parse(e.data as string));
      ws.onerror = reject;
    });
    expect(welcome.t).toBe('welcome');
    ws.close();
  });

  test("but not one for another site's name", async () => {
    const headers = {
      Host: 'evil.example',
      Origin: 'http://evil.example',
      Upgrade: 'websocket',
      Connection: 'Upgrade',
    };
    expect((await fetch(app.base + '/ws', { headers })).status).toBe(403);
  });
});

describe('mise run dev', () => {
  test('is the development server, which answers this computer and refuses minigames.ericbs.dev', async () => {
    const dev = await launch(['--dev']);
    expect(dev.out).toContain('rebuilt whenever a file changes');
    expect((await fetch(dev.base + '/')).status).toBe(200);
    expect((await fetch(dev.base + '/', { headers: caddy })).status).not.toBe(200);
  }, 30_000);
});

describe('ALLOWED_HOSTS', () => {
  test('that is not a list of names stops the server, saying why', async () => {
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'server', 'serve.ts')], {
      env: { ...process.env, PORT: '8000', ALLOWED_HOSTS: '*.ericbs.dev' },
      stdout: 'ignore',
      stderr: 'pipe',
    });
    running.push(proc);
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain('ALLOWED_HOSTS has to be host names');
  }, 30_000);
});
