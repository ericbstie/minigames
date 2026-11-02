// Serve the Pick a Game site, and run the race server for live Bike Race races. One Bun process does both:
//
//   bun server/serve.ts           http on 127.0.0.1:8000 (mise run app). PORT and HOST change it.
//   bun server/serve.ts --https   https on every network address, port 8443 (mise run phone), so phones on the
//                                 same Wi-Fi can use tilt and race each other.
//
// The page is public/index.html; Bun bundles its TypeScript and CSS when it is served (and again whenever a file
// changes, on the http server). Phones only send tilt (motion) events to https pages. --https makes a self-signed
// certificate the first time (it needs the `openssl` command) and keeps it in .cert/. Phones warn that the
// connection is not private: that is expected for a self-signed certificate on your own network.
//
// Live races are JSON messages over a WebSocket at /ws. A browser can refuse a WebSocket to a self-signed
// certificate even after the page itself was allowed (iPhones are the worry), so the same messages also work over a
// server-sent event stream (GET /net/events) plus POSTs (POST /net/send?sid=...). docs/bike-race.md lists them.
import { createSocket } from 'node:dgram';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import index from '../public/index.html';
import { type Conn, Lobby, type Message, type Player, type RaceOptions } from './race';

const ROOT = join(import.meta.dir, '..');
const CERT_DIR = join(ROOT, '.cert');
const CERT = join(CERT_DIR, 'cert.pem');
const KEY = join(CERT_DIR, 'key.pem');

// Connections
const IDLE = 30; // seconds without a message before a race connection is dropped (the game pings every 5 s)
const KEEP_ALIVE = 10; // seconds between comments on a quiet event stream
const MAX_BODY = 64 * 1024;
const MAX_MESSAGE = 16 * 1024; // one race message
const MAX_BUFFER = 512 * 1024; // unsent bytes before a connection counts as stuck and is dropped
const MAX_PER_SECOND = 90; // race messages a connection may send each second (poses go 20 times a second)
const MAX_CONNECTIONS = 300;
const MAX_POSTED = 60; // messages in one POST

export interface ServerOptions extends Partial<RaceOptions> {
  port?: number;
  hostname?: string;
  tls?: { cert: string; key: string };
  development?: boolean; // rebuild the page when a file changes and reload it in the browser
}

const timestamp = () => new Date().toTimeString().slice(0, 8);
export const log = (text: string) => console.log(timestamp(), text);

// A race connection: a WebSocket, or an event stream with POSTs. Both carry the same JSON messages.
abstract class RaceConn implements Conn {
  player: Player | null = null;
  closed = false;
  lastIn = performance.now();
  private second = 0;
  private count = 0;

  allow(): boolean {
    const second = Math.floor(performance.now() / 1000);
    if (second !== this.second) {
      this.second = second;
      this.count = 0;
    }
    this.lastIn = performance.now();
    return ++this.count <= MAX_PER_SECOND;
  }

  abstract send(msg: Message): void;
  abstract close(code?: number): void;
}

class SocketConn extends RaceConn {
  constructor(private readonly ws: Bun.ServerWebSocket<SocketData>) {
    super();
  }

  override send(msg: Message): void {
    if (!this.closed) this.ws.send(JSON.stringify(msg));
  }

  override close(code = 1000): void {
    if (this.closed) return;
    this.closed = true;
    this.ws.close(code);
  }
}

const encoder = new TextEncoder();

class StreamConn extends RaceConn {
  readonly sid = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('base64url');
  controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  onClose: () => void = () => {};

  raw(text: string): void {
    const c = this.controller;
    if (this.closed || !c) return;
    if ((c.desiredSize ?? 0) < -MAX_BUFFER) {
      log('dropping a connection that stopped reading');
      return this.close();
    }
    c.enqueue(encoder.encode(text));
  }

  override send(msg: Message): void {
    this.raw(`data: ${JSON.stringify(msg)}\n\n`);
  }

  override close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller?.close();
    } catch {
      // the browser already went
    }
    this.onClose();
  }
}

interface SocketData {
  conn: SocketConn | null;
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === (req.headers.get('host') ?? '').toLowerCase();
  } catch {
    return false;
  }
}

function decode(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isObject = (v: unknown): v is Message => typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (status: number, body = '', headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: body ? { 'Content-Type': 'text/plain; charset=utf-8', ...headers } : headers });

export function startServer(opts: ServerOptions = {}) {
  const say = opts.log ?? log;
  const lobby = new Lobby({
    countdown: opts.countdown ?? 3,
    ending: opts.ending ?? 30,
    away: opts.away ?? 45,
    share: opts.share ?? '',
    log: say,
  });
  const conns = new Set<RaceConn>();
  const streams = new Map<string, StreamConn>();

  const message = (conn: RaceConn, msg: unknown) => {
    if (!isObject(msg) || !conn.allow()) return;
    try {
      lobby.handle(conn, msg);
    } catch (e) {
      // log it and carry on: one bad message shouldn't end anyone's race
      say(`error handling ${JSON.stringify(String(msg.t).slice(0, 20))}: ${e}`);
    }
  };

  const gone = (conn: RaceConn) => {
    conns.delete(conn);
    lobby.dropped(conn);
  };

  const server = Bun.serve({
    port: opts.port ?? 8000,
    hostname: opts.hostname ?? '127.0.0.1',
    tls: opts.tls && { cert: Bun.file(opts.tls.cert), key: Bun.file(opts.tls.key) },
    development: opts.development ? { hmr: true, console: false } : false,
    maxRequestBodySize: MAX_BODY,

    routes: {
      '/': index,
      '/index.html': index,

      '/ws': (req, server) => {
        const upgrade = (req.headers.get('upgrade') ?? '').toLowerCase();
        if (req.method !== 'GET' || upgrade !== 'websocket') return text(400, 'Expected a WebSocket\n');
        if (!sameOrigin(req)) return text(403, 'Wrong origin\n');
        if (conns.size >= MAX_CONNECTIONS) return text(503, 'Too many riders\n');
        if (server.upgrade(req, { data: { conn: null } })) return undefined;
        return text(400, 'Expected a WebSocket\n');
      },

      '/net/events': (req, server) => {
        if (req.method !== 'GET') return text(405, '', { Allow: 'GET' });
        if (!sameOrigin(req)) return text(403, 'Wrong origin\n');
        if (conns.size >= MAX_CONNECTIONS) return text(503, 'Too many riders\n');
        server.timeout(req, 0); // the stream stays open; IDLE below decides when it has gone quiet for too long
        const conn = new StreamConn();
        let ticker: Timer | undefined;
        conn.onClose = () => {
          clearInterval(ticker);
          streams.delete(conn.sid);
          gone(conn);
        };
        const body = new ReadableStream<Uint8Array>(
          {
            start(controller) {
              conn.controller = controller;
              conns.add(conn);
              streams.set(conn.sid, conn);
              conn.send({ t: 'conn', sid: conn.sid });
              ticker = setInterval(() => {
                if (performance.now() - conn.lastIn > IDLE * 1000) conn.close();
                else conn.raw(': still here\n\n');
              }, KEEP_ALIVE * 1000);
            },
            cancel() {
              conn.controller = null; // the browser closed the stream
              conn.close();
            },
          },
          new ByteLengthQueuingStrategy({ highWaterMark: 0 }),
        );
        return new Response(body, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
        });
      },

      '/net/send': async (req) => {
        if (req.method !== 'POST') return text(405, '', { Allow: 'POST' });
        if (!sameOrigin(req)) return text(403);
        const sid = new URL(req.url).searchParams.get('sid') ?? '';
        const conn = streams.get(sid);
        if (!conn || conn.closed) return text(410, 'That stream is closed\n');
        let msgs = decode(await req.text());
        if (isObject(msgs)) msgs = [msgs];
        if (!Array.isArray(msgs)) return text(400);
        conn.lastIn = performance.now();
        for (const m of msgs.slice(0, MAX_POSTED)) message(conn, m);
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
      },
    },

    fetch: () => text(404, 'Not found\n'),

    websocket: {
      data: {} as SocketData,
      maxPayloadLength: MAX_MESSAGE,
      backpressureLimit: MAX_BUFFER,
      closeOnBackpressureLimit: true,
      idleTimeout: IDLE,
      sendPings: false, // a connection that says nothing for IDLE seconds is dropped, as the game pings every 5 s
      open(ws) {
        ws.data.conn = new SocketConn(ws);
        conns.add(ws.data.conn);
      },
      message(ws, data) {
        if (typeof data === 'string' && ws.data.conn) message(ws.data.conn, decode(data));
      },
      close(ws) {
        const conn = ws.data.conn;
        if (!conn) return;
        conn.closed = true;
        gone(conn);
      },
    },
  });
  return server;
}

// The address other devices on the network can reach this computer at (no packets are sent).
function lanAddress(): Promise<string> {
  return new Promise((resolve) => {
    const s = createSocket('udp4');
    const done = (address: string) => {
      s.close();
      resolve(address);
    };
    s.on('error', () => done('127.0.0.1'));
    s.connect(1, '10.255.255.255', () => done(s.address().address));
  });
}

async function ensureCertificate(): Promise<void> {
  if (existsSync(CERT) && existsSync(KEY)) return;
  if (!Bun.which('openssl')) {
    console.error('serve: the openssl command is needed to make a certificate for https, and it was not found.');
    process.exit(1);
  }
  mkdirSync(CERT_DIR, { recursive: true });
  const made = Bun.spawnSync(
    ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825'].concat([
      '-keyout',
      KEY,
      '-out',
      CERT,
      '-subj',
      '/CN=Pick a Game (local)',
    ]),
    { stdout: 'ignore', stderr: 'ignore' },
  );
  if (!made.success) {
    console.error('serve: openssl could not make a certificate.');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const https = process.argv.includes('--https');
  const port = Number(process.env.PORT || (https ? 8443 : 8000));
  const hostname = process.env.HOST || (https ? '0.0.0.0' : '127.0.0.1');
  const everywhere = ['0.0.0.0', '::', ''].includes(hostname);
  const scheme = https ? 'https' : 'http';
  const share = everywhere ? `${scheme}://${await lanAddress()}:${port}` : '';
  if (https) await ensureCertificate();
  try {
    startServer({
      port,
      hostname,
      share,
      tls: https ? { cert: CERT, key: KEY } : undefined,
      // the phone server bundles the page once, minified; the local one rebuilds it as files change
      development: !https,
    });
  } catch (e) {
    console.error(
      `serve: can't listen on ${hostname}:${port} (${(e as Error).message}). Is it already running? PORT picks another port.`,
    );
    process.exit(1);
  }
  if (https) {
    console.log(
      `Pick a Game over https. On your phone (same Wi-Fi) open: ${share || `https://${hostname}:${port}`}/#bike-race`,
    );
    console.log('Friends on the same Wi-Fi open the same address to race you live.');
    console.log('Phones warn about the certificate the first time; that is expected here. Ctrl+C stops the server.');
  } else {
    const local =
      ['127.0.0.1', 'localhost'].includes(hostname) || everywhere
        ? `http://localhost:${port}`
        : `http://${hostname}:${port}`;
    console.log(`Pick a Game running at ${local}${share ? ` (on your network: ${share})` : ''}`);
    console.log('Live Bike Race rooms run here too. For phones, use mise run phone. Ctrl+C stops the server.');
  }
}

if (import.meta.main) await main();
