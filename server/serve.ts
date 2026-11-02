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
//
// In Effect terms: SiteServer is Bun.serve held open by a scope (closing it stops the server), RaceLobby
// (server/race.ts) holds the rooms, and Bun's callbacks run effects with the services the server was built with.
// main() reads PORT and HOST with Config, makes the certificate, and runs until Ctrl+C interrupts it.
import { createSocket } from 'node:dgram';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Cause,
  Clock,
  Config,
  Console,
  Context,
  Effect,
  Exit,
  Layer,
  Logger,
  Option,
  Predicate,
  Queue,
  Runtime,
  Schema,
  Stream,
} from 'effect';
import index from '../public/index.html';
import type { ServerMessage } from '../public/js/bike-race-protocol';
import { type Conn, type Player, RaceLobby, RaceSettings, type RaceTimes } from './race';

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

export interface ServerOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly tls?: { readonly cert: string; readonly key: string };
  readonly development?: boolean; // rebuild the page when a file changes and reload it in the browser
}

/** The running server */
export class SiteServer extends Context.Service<SiteServer, { readonly port: number }>()(
  'pick-a-game/server/SiteServer',
) {}

export class ListenError extends Schema.TaggedError<ListenError>()('ListenError', {
  hostname: Schema.String,
  port: Schema.Number,
  message: Schema.String,
}) {}

export class CertificateError extends Schema.TaggedError<CertificateError>()('CertificateError', {
  message: Schema.String,
}) {}

// Log lines are the time and the text: 14:02:11 Annie opened room BCDF on clover-2
const timestamp = (date: Date) => date.toTimeString().slice(0, 8);
const logLine = (options: Logger.Options<unknown>) => {
  const parts = Array.isArray(options.message) ? options.message : [options.message];
  return `${timestamp(options.date)} ${parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' ')}`;
};
/** The server's log: one line per message on the console */
export const ConsoleLog = Logger.layer([Logger.make((options) => console.log(logLine(options)))]);
/** A log that keeps its lines in an array (for the tests) */
export const ArrayLog = (lines: string[]) =>
  Logger.layer([Logger.make((options) => void lines.push(logLine(options)))]);

// ---------- connections ----------

// A race connection: a WebSocket, or an event stream with POSTs. Both carry the same JSON messages.
abstract class RaceConn implements Conn {
  player: Player | null = null;
  closed = false;
  lastIn = 0; // ms, by Effect's clock
  private second = 0;
  private count = 0;

  /** Notes a message in, and says whether the connection is still within its messages a second */
  readonly allow = Effect.map(Clock.currentTimeMillis, (ms) => {
    const second = Math.floor(ms / 1000);
    if (second !== this.second) {
      this.second = second;
      this.count = 0;
    }
    this.lastIn = ms;
    return ++this.count <= MAX_PER_SECOND;
  });

  readonly heard = Effect.map(Clock.currentTimeMillis, (ms) => void (this.lastIn = ms));

  abstract send(msg: ServerMessage): Effect.Effect<void>;
  abstract close(code?: number): Effect.Effect<void>;
}

interface SocketData {
  conn: SocketConn | null;
}

class SocketConn extends RaceConn {
  constructor(private readonly ws: Bun.ServerWebSocket<SocketData>) {
    super();
  }

  override send(msg: ServerMessage): Effect.Effect<void> {
    return Effect.sync(() => {
      if (!this.closed) this.ws.send(JSON.stringify(msg));
    });
  }

  override close(code = 1000): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.closed) return;
      this.closed = true;
      this.ws.close(code);
    });
  }
}

// An event stream: messages wait in the outbox until the browser reads them. A browser that stops reading while
// more than MAX_BUFFER bytes pile up is dropped.
class StreamConn extends RaceConn {
  readonly sid = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('base64url');
  waiting = 0; // bytes in the outbox
  onClose: Effect.Effect<void> = Effect.void;

  constructor(private readonly outbox: Queue.Queue<string, Cause.Done>) {
    super();
  }

  raw(text: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.closed) return Effect.void;
      if (this.waiting > MAX_BUFFER)
        return Effect.log('dropping a connection that stopped reading').pipe(Effect.andThen(this.close()));
      this.waiting += text.length;
      return Effect.asVoid(Queue.offer(this.outbox, text));
    });
  }

  override send(msg: ServerMessage | { t: 'conn'; sid: string }): Effect.Effect<void> {
    return this.raw(`data: ${JSON.stringify(msg)}\n\n`);
  }

  override close(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.closed) return Effect.void;
      this.closed = true;
      return Queue.end(this.outbox).pipe(Effect.andThen(this.onClose));
    });
  }

  // Every KEEP_ALIVE seconds: a comment to keep the stream open, or the end of it after IDLE seconds of silence
  readonly tick = Effect.flatMap(Clock.currentTimeMillis, (ms) =>
    ms - this.lastIn > IDLE * 1000 ? this.close() : this.raw(': still here\n\n'),
  );

  /** What the browser reads */
  body(): Stream.Stream<Uint8Array> {
    return Stream.fromQueue(this.outbox).pipe(
      Stream.tap((text) => Effect.sync(() => (this.waiting -= text.length))),
      Stream.merge(
        Stream.tick(KEEP_ALIVE * 1000).pipe(
          Stream.drop(1),
          Stream.mapEffect(() => this.tick),
          Stream.drain,
        ),
        {
          haltStrategy: 'left',
        },
      ),
      Stream.encodeText,
      Stream.ensuring(this.close()), // the browser closed the stream
    );
  }
}

const sameOrigin = (req: Request): boolean => {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === (req.headers.get('host') ?? '').toLowerCase();
  } catch {
    return false;
  }
};

const parseJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
// A POST carries one message or a list of them
const parsePosted = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Union([Schema.Array(Schema.Unknown), Schema.Record(Schema.String, Schema.Unknown)])),
);

const text = (status: number, body = '', headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: body ? { 'Content-Type': 'text/plain; charset=utf-8', ...headers } : headers });

// ---------- the server ----------

const makeServer = (opts: ServerOptions) =>
  Effect.gen(function* () {
    const lobby = yield* RaceLobby;
    // Bun calls back outside any fiber; these run effects with the services the server was built with. A fiber runs
    // straight away as far as it can, so messages from one connection reach the lobby in the order they came.
    const context = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(context);
    const runPromise = Effect.runPromiseWith(context);
    const conns = new Set<RaceConn>();
    const streams = new Map<string, StreamConn>();

    // A message counts towards the connection's limit once it is at least an object
    const message = (conn: RaceConn, msg: unknown) =>
      Predicate.isObject(msg)
        ? Effect.flatMap(conn.allow, (ok) => (ok ? lobby.receive(conn, msg) : Effect.void))
        : Effect.void;

    const gone = (conn: RaceConn) =>
      Effect.suspend(() => {
        conns.delete(conn);
        return lobby.dropped(conn);
      });

    const openStream = (req: Request) =>
      Effect.gen(function* () {
        const conn = new StreamConn(yield* Queue.unbounded<string, Cause.Done>());
        yield* conn.heard;
        conn.onClose = Effect.suspend(() => {
          streams.delete(conn.sid);
          return gone(conn);
        });
        conns.add(conn);
        streams.set(conn.sid, conn);
        yield* conn.send({ t: 'conn', sid: conn.sid });
        const body = Stream.toReadableStreamWith(conn.body(), context, {
          strategy: new ByteLengthQueuingStrategy({ highWaterMark: 0 }),
          signal: req.signal,
        });
        return new Response(body, {
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
        });
      });

    const posted = (req: Request) =>
      Effect.gen(function* () {
        if (req.method !== 'POST') return text(405, '', { Allow: 'POST' });
        if (!sameOrigin(req)) return text(403);
        const sid = new URL(req.url).searchParams.get('sid') ?? '';
        const conn = streams.get(sid);
        if (!conn || conn.closed) return text(410, 'That stream is closed\n');
        const body = parsePosted(yield* Effect.promise(() => req.text()));
        if (Option.isNone(body)) return text(400);
        const msgs = Array.isArray(body.value) ? body.value : [body.value];
        yield* conn.heard;
        for (const m of msgs.slice(0, MAX_POSTED)) yield* message(conn, m);
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
      });

    const port = opts.port ?? 8000;
    const hostname = opts.hostname ?? '127.0.0.1';
    const server = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          Bun.serve({
            port,
            hostname,
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
                server.timeout(req, 0); // the stream stays open; IDLE decides when it has gone quiet for too long
                return runPromise(openStream(req));
              },

              '/net/send': (req) => runPromise(posted(req)),
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
                const conn = ws.data.conn;
                if (typeof data !== 'string' || !conn) return;
                const msg = parseJson(data);
                if (Option.isSome(msg)) runFork(message(conn, msg.value));
              },
              close(ws) {
                const conn = ws.data.conn;
                if (!conn) return;
                conn.closed = true;
                runFork(gone(conn));
              },
            },
          }),
        catch: (e) => new ListenError({ hostname, port, message: e instanceof Error ? e.message : String(e) }),
      }),
      (server) => Effect.promise(() => server.stop(true)),
    );
    return SiteServer.of({ port: server.port! });
  });

/** The site and the race server, with the race timings and share address from RaceSettings */
export const serverLayer = (opts: ServerOptions = {}) =>
  Layer.effect(SiteServer, makeServer(opts)).pipe(Layer.provide(RaceLobby.layer));

/** The race timings and share address for serverLayer; any left out keep their defaults */
export const settingsLayer = (settings: Partial<RaceTimes & { share: string }>) =>
  Layer.effect(
    RaceSettings,
    Effect.map(RaceSettings, (defaults) => ({
      countdown: settings.countdown ?? defaults.countdown,
      ending: settings.ending ?? defaults.ending,
      away: settings.away ?? defaults.away,
      share: settings.share ?? defaults.share,
    })),
  );

// ---------- running it ----------

// The address other devices on the network can reach this computer at (no packets are sent).
const lanAddress = Effect.callback<string>((resume) => {
  const s = createSocket('udp4');
  const done = (address: string) => {
    s.close();
    resume(Effect.succeed(address));
  };
  s.on('error', () => done('127.0.0.1'));
  s.connect(1, '10.255.255.255', () => done(s.address().address));
});

const ensureCertificate = Effect.gen(function* () {
  if (existsSync(CERT) && existsSync(KEY)) return;
  if (!Bun.which('openssl'))
    return yield* new CertificateError({
      message: 'the openssl command is needed to make a certificate for https, and it was not found.',
    });
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
  if (!made.success) return yield* new CertificateError({ message: 'openssl could not make a certificate.' });
});

const fail = (message: string) =>
  Console.error(`serve: ${message}`).pipe(Effect.andThen(Effect.sync(() => void (process.exitCode = 1))));

const main = Effect.gen(function* () {
  const https = process.argv.includes('--https');
  const port = yield* Config.Port('PORT').pipe(Config.withDefault(https ? 8443 : 8000));
  const hostname = yield* Config.String('HOST').pipe(Config.withDefault(https ? '0.0.0.0' : '127.0.0.1'));
  const everywhere = ['0.0.0.0', '::', ''].includes(hostname);
  const scheme = https ? 'https' : 'http';
  const share = everywhere ? `${scheme}://${yield* lanAddress}:${port}` : '';
  if (https) yield* ensureCertificate;
  yield* Layer.build(
    serverLayer({
      port,
      hostname,
      tls: https ? { cert: CERT, key: KEY } : undefined,
      // the phone server bundles the page once, minified; the local one rebuilds it as files change
      development: !https,
    }).pipe(Layer.provide(settingsLayer({ share }))),
  );
  if (https) {
    yield* Console.log(
      `Pick a Game over https. On your phone (same Wi-Fi) open: ${share || `https://${hostname}:${port}`}/#bike-race`,
    );
    yield* Console.log('Friends on the same Wi-Fi open the same address to race you live.');
    yield* Console.log(
      'Phones warn about the certificate the first time; that is expected here. Ctrl+C stops the server.',
    );
  } else {
    const local =
      ['127.0.0.1', 'localhost'].includes(hostname) || everywhere
        ? `http://localhost:${port}`
        : `http://${hostname}:${port}`;
    yield* Console.log(`Pick a Game running at ${local}${share ? ` (on your network: ${share})` : ''}`);
    yield* Console.log('Live Bike Race rooms run here too. For phones, use mise run phone. Ctrl+C stops the server.');
  }
  return yield* Effect.never;
}).pipe(
  Effect.scoped,
  Effect.catchTags({
    ListenError: (e) => fail(`can't listen on ${e.hostname}:${e.port}. ${e.message} PORT picks another port.`),
    CertificateError: (e) => fail(e.message),
    ConfigError: () => fail('PORT has to be a port number, such as 8000.'),
  }),
  Effect.provide(ConsoleLog),
);

// Runs the server until Ctrl+C (or a stop signal), which closes its scope: the server stops and the rooms close.
const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  const stop = () => fiber.interruptUnsafe();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  fiber.addObserver((exit) => {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    teardown(Exit.isFailure(exit) && !Exit.hasInterrupts(exit) ? exit : Exit.void, (code) =>
      process.exit(process.exitCode || code),
    );
  });
});

if (import.meta.main) runMain(main, { disableErrorReporting: false });
