// Bike Race rooms and races: the RaceLobby service. It knows nothing about networking. A connection is anything
// with send and close (server/serve.ts gives it WebSockets and event streams), and messages arrive as parsed JSON
// that the lobby decodes with the protocol's schemas (public/js/bike-race-protocol.ts).
//
// The rooms are plain data that one fiber at a time may touch (a one-permit semaphore). Countdowns, the closing
// clock, the race limit and a dropped rider's grace time are fibers that sleep: cancelling one interrupts it, and
// they all stop when the lobby's scope closes. Time comes from Effect's Clock, so tests can run whole races on a
// TestClock (tests/race-lobby.test.ts).
import { Cause, Clock, Context, Effect, Fiber, FiberSet, Layer, Option, Schema, Semaphore } from 'effect';
import { levelById } from '../public/js/bike-race-core';
import {
  CODE_LETTERS,
  ClientMessage,
  type Command,
  COMMANDS,
  Envelope,
  RACE_LIMIT,
  type RaceResult,
  type RoomMessage,
  type RoomPlayer,
  type RoomState,
  type ServerMessage,
} from '../public/js/bike-race-protocol';

export { RACE_LIMIT };
export const MAX_PLAYERS = 6; // riders in one room
export const MAX_ROOMS = 200;
export const MAX_RIDERS = 1000; // riders kept in all, connected or keeping their place

/** A connection to one game: a WebSocket, or an event stream with POSTs */
export interface Conn {
  /** The device it comes from (its address; see deviceOf in server/serve.ts) */
  readonly device: string;
  player: Player | null;
  send(msg: ServerMessage): Effect.Effect<void>;
  close(code?: number): Effect.Effect<void>;
}

export interface RaceTimes {
  readonly countdown: number; // seconds of 3, 2, 1 before a race
  readonly ending: number; // seconds the others get once the first rider finishes
  readonly away: number; // seconds a dropped rider keeps their place (a phone drops the connection when its screen locks)
}

export interface RaceLimits {
  /** Race connections, and riders kept, from one device. A phone needs one; it is there so one device can't take
   * every connection, or fill the memory by connecting and dropping out over and over. */
  readonly perDevice: number;
}

/** The race timings and limits, and the address friends on the network can open (if the server has one) */
export const RaceSettings = Context.Reference<RaceTimes & RaceLimits & { readonly share: string }>(
  'pick-a-game/server/RaceSettings',
  { defaultValue: () => ({ countdown: 3, ending: 30, away: 45, perDevice: 16, share: '' }) },
);

/** A track the games know (a level id the right shape for another version's track is no use to anyone) */
const isTrack = (level: string | null): level is string => level !== null && levelById(level) !== null;

const now = Effect.map(Clock.currentTimeMillis, (ms) => ms / 1000);

const randomByte = () => crypto.getRandomValues(new Uint8Array(1))[0]!;
const randomCode = Effect.sync(() => {
  let code = '';
  while (code.length < 4) {
    const b = randomByte();
    if (b < 240) code += CODE_LETTERS[b % 20]; // 240 is a multiple of 20, so every letter is as likely
  }
  return code;
});
const randomKey = Effect.sync(() =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join(''),
);

export class Player {
  name = 'Rider';
  paint = 0;
  bike = 'scout';
  conn: Conn | null = null; // the live connection, null while dropped
  room: Room | null = null;
  wins = 0;
  away: Fiber.Fiber<void> | null = null; // counting down the time a dropped rider keeps their place

  constructor(
    readonly id: string,
    readonly key: string,
    readonly device: string,
  ) {}

  send(msg: ServerMessage): Effect.Effect<void> {
    return this.conn ? this.conn.send(msg) : Effect.void;
  }

  public(): RoomPlayer {
    return { id: this.id, name: this.name, paint: this.paint, bike: this.bike, wins: this.wins, away: !this.conn };
  }
}

interface Racer {
  name: string;
  paint: number;
  bike: string;
  time: number | null;
  out: boolean;
}

export class Room {
  host: string;
  readonly players = new Map<string, Player>(); // in the order they joined
  state: RoomState = 'lobby';
  racers = new Map<string, Racer>(); // for the race on now
  endsAt: number | null = null; // when the race closes, once someone has finished
  last: RaceResult[] | null = null; // results of the last race
  readonly timers = new Set<Fiber.Fiber<void>>(); // the countdown, the closing clock and the race limit

  constructor(
    readonly code: string,
    public level: string,
    host: Player,
    readonly created: number,
  ) {
    this.host = host.id;
  }

  broadcast(msg: ServerMessage): Effect.Effect<void> {
    return Effect.forEach(this.players.values(), (p) => p.send(msg), { discard: true });
  }

  public(at: number): RoomMessage {
    const racing = this.state !== 'lobby';
    return {
      t: 'room',
      code: this.code,
      host: this.host,
      level: this.level,
      state: this.state,
      players: [...this.players.values()].map((p) => p.public()),
      racers: racing ? [...this.racers.keys()] : [],
      ending: racing && this.endsAt !== null ? Math.max(0, Math.round(this.endsAt - at)) : null,
      last: this.last,
    };
  }
}

const decodeEnvelope = Schema.decodeUnknownOption(Envelope);
const decodeMessage = Schema.decodeUnknownOption(ClientMessage);

export class RaceLobby extends Context.Service<
  RaceLobby,
  {
    /** A message from a connection: parsed JSON, not checked yet */
    readonly receive: (conn: Conn, msg: unknown) => Effect.Effect<void>;
    /** A connection closed */
    readonly dropped: (conn: Conn) => Effect.Effect<void>;
    /** The open rooms, by code (for the tests) */
    readonly rooms: ReadonlyMap<string, Room>;
  }
>()('pick-a-game/server/RaceLobby') {
  static readonly layer = Layer.effect(
    RaceLobby,
    Effect.gen(function* () {
      const settings = yield* RaceSettings;
      const players = new Map<string, Player>(); // resume key -> Player
      const rooms = new Map<string, Room>(); // code -> Room
      let nextId = 1;
      const lock = Semaphore.makeUnsafe(1);
      const timers = yield* FiberSet.make<void>(); // every timer, so they all stop with the lobby
      const locked = <A>(effect: Effect.Effect<A>) => lock.withPermit(effect);

      const roomMessage = (room: Room) => Effect.map(now, (at) => room.public(at));
      const broadcastRoom = (room: Room) => Effect.flatMap(roomMessage(room), (m) => room.broadcast(m));

      // ---------- timers ----------

      // Runs effect after a while, unless the room's timers are cancelled first
      const later = (room: Room, seconds: number, effect: Effect.Effect<void>) =>
        Effect.gen(function* () {
          room.timers.add(
            yield* FiberSet.run(timers, Effect.sleep(seconds * 1000).pipe(Effect.andThen(locked(effect)))),
          );
        });

      // Cancels the room's timers, except the one running this (a timer that ends the race cancels the others)
      const cancelTimers = (room: Room) =>
        Effect.withFiber((self) => {
          const others = [...room.timers].filter((f) => f !== self);
          room.timers.clear();
          return Fiber.interruptAll(others);
        });

      // ---------- rooms ----------

      const roomsMessage = (): ServerMessage => {
        const list = [...rooms.values()].sort((a, b) => b.created - a.created).slice(0, 30);
        return {
          t: 'rooms',
          rooms: list.map((r) => ({
            code: r.code,
            host: r.players.get(r.host)?.name ?? '',
            level: r.level,
            count: r.players.size,
            state: r.state,
          })),
        };
      };

      const newCode = Effect.gen(function* () {
        for (;;) {
          const code = yield* randomCode;
          if (!rooms.has(code)) return code;
        }
      });

      // The next rider to have joined takes over, preferring one who is connected.
      const passHost = Effect.fnUntraced(function* (room: Room) {
        const old = room.host;
        const list = [...room.players.values()];
        room.host = list.find((q) => q.conn && q.id !== old)?.id ?? list.find((q) => q.id !== old)?.id ?? old;
        if (room.host !== old)
          yield* Effect.log(`${room.players.get(room.host)!.name} is now host of room ${room.code}`);
      });

      const outstanding = (room: Room) => [...room.racers.values()].filter((r) => r.time === null && !r.out);

      const checkDone = (room: Room) =>
        room.state !== 'lobby' && outstanding(room).length === 0 ? endRace(room) : Effect.void;

      const leaveRoom = Effect.fnUntraced(function* (p: Player) {
        const room = p.room;
        if (!room) return;
        room.players.delete(p.id);
        p.room = null;
        const rec = room.racers.get(p.id);
        if (rec) rec.out = true;
        if (room.players.size === 0) {
          yield* cancelTimers(room);
          rooms.delete(room.code);
          yield* Effect.log(`room ${room.code} closed`);
          return;
        }
        if (room.host === p.id) yield* passHost(room);
        yield* broadcastRoom(room);
        yield* checkDone(room);
      });

      const create = Effect.fnUntraced(function* (p: Player, level: string | null) {
        if (!isTrack(level)) return yield* p.send({ t: 'error', msg: 'Pick a track first.' });
        if (rooms.size >= MAX_ROOMS)
          return yield* p.send({ t: 'error', msg: 'This race server is full. Try again in a minute.' });
        yield* leaveRoom(p);
        const room = new Room(yield* newCode, level, p, yield* now);
        rooms.set(room.code, room);
        room.players.set(p.id, p);
        p.room = room;
        yield* Effect.log(`${p.name} opened room ${room.code} on ${level}`);
        yield* broadcastRoom(room);
      });

      const join = Effect.fnUntraced(function* (p: Player, code: string) {
        const room = rooms.get(code);
        if (!room)
          return yield* p.send({ t: 'error', msg: `There is no room ${code || '----'}. Check the code?`, code });
        if (p.room === room) return yield* p.send(yield* roomMessage(room));
        if (room.players.size >= MAX_PLAYERS)
          return yield* p.send({ t: 'error', msg: `Room ${code} is full (${MAX_PLAYERS} riders).`, code });
        yield* leaveRoom(p);
        room.players.set(p.id, p);
        p.room = room;
        yield* Effect.log(`${p.name} joined room ${code} (${room.players.size} riders)`);
        yield* broadcastRoom(room);
      });

      // ---------- races ----------

      const start = Effect.fnUntraced(function* (p: Player) {
        const room = p.room;
        if (!room) return;
        if (room.host !== p.id) return yield* p.send({ t: 'error', msg: 'Only the host can start the race.' });
        if (room.state !== 'lobby') return;
        room.racers = new Map(
          [...room.players.values()]
            .filter((q) => q.conn)
            .map((q) => [q.id, { name: q.name, paint: q.paint, bike: q.bike, time: null, out: false }]),
        );
        room.state = 'countdown';
        room.endsAt = null;
        yield* room.broadcast({
          t: 'countdown',
          level: room.level,
          racers: [...room.racers.keys()],
          seconds: settings.countdown,
        });
        yield* broadcastRoom(room);
        yield* later(room, settings.countdown, go(room));
        const n = room.racers.size;
        yield* Effect.log(`race in room ${room.code} on ${room.level} with ${n} rider${n !== 1 ? 's' : ''}`);
      });

      const go = Effect.fnUntraced(function* (room: Room) {
        if (room.state !== 'countdown') return;
        room.state = 'race';
        yield* later(room, RACE_LIMIT, endRace(room));
        yield* broadcastRoom(room);
      });

      const finish = Effect.fnUntraced(function* (p: Player, time: number) {
        const room = p.room;
        if (!room || room.state !== 'race') return;
        const rec = room.racers.get(p.id);
        if (!rec || rec.time !== null || rec.out) return;
        rec.time = Math.round(time * 1000) / 1000;
        yield* room.broadcast({ t: 'finished', id: p.id, time: rec.time });
        if (room.endsAt === null && outstanding(room).length) {
          room.endsAt = (yield* now) + settings.ending;
          yield* later(room, settings.ending, endRace(room));
          yield* room.broadcast({ t: 'ending', seconds: settings.ending });
        }
        yield* checkDone(room);
      });

      const endRace: (room: Room) => Effect.Effect<void> = Effect.fnUntraced(function* (room: Room) {
        if (room.state === 'lobby' || rooms.get(room.code) !== room) return;
        yield* cancelTimers(room);
        const rows: RaceResult[] = [...room.racers].map(([id, rec]) => {
          const q = room.players.get(id);
          return {
            id,
            name: q?.name ?? rec.name,
            paint: q?.paint ?? rec.paint,
            bike: q?.bike ?? rec.bike,
            time: rec.time,
          };
        });
        // finishers first, fastest first; the order of the others stays as it was
        rows.sort((a, b) => (a.time === null ? 1 : 0) - (b.time === null ? 1 : 0) || (a.time ?? 0) - (b.time ?? 0));
        const winner = rows[0] && room.players.get(rows[0].id);
        if (rows.length > 1 && rows[0]!.time !== null && winner) winner.wins++;
        room.state = 'lobby';
        room.endsAt = null;
        room.racers = new Map();
        room.last = rows;
        if (room.players.get(room.host)?.conn === null) yield* passHost(room);
        yield* room.broadcast({ t: 'results', level: room.level, results: rows });
        yield* broadcastRoom(room);
        const line = rows.map((r) => (r.time !== null ? `${r.name} ${r.time.toFixed(2)}` : `${r.name} DNF`)).join(', ');
        yield* Effect.log(`room ${room.code} results: ${line}`);
      });

      // ---------- messages ----------

      // Riders kept for one device: connected, or keeping their place after dropping out
      const ridersFrom = (device: string) => {
        let n = 0;
        for (const p of players.values()) if (p.device === device) n++;
        return n;
      };

      // A connection says hello first, with the key it was given last time (if any). A rider who dropped out a moment
      // ago gets their place back; anyone else is a new rider with a new key.
      const hello = Effect.fnUntraced(function* (conn: Conn, msg: Extract<ClientMessage, { t: 'hello' }>) {
        const first = conn.player === null;
        let resumed = false;
        if (first) {
          let p = msg.key ? players.get(msg.key) : undefined;
          if (p) {
            resumed = true;
            if (p.away) {
              yield* Fiber.interrupt(p.away);
              p.away = null;
            }
            if (p.conn) {
              // the old connection hasn't noticed it is dead yet, or another tab
              const old = p.conn;
              p.conn = null;
              yield* old.send({ t: 'replaced' });
              old.player = null;
              yield* old.close();
            }
          } else {
            const full =
              players.size >= MAX_RIDERS
                ? 'This race server is full. Try again in a minute.'
                : ridersFrom(conn.device) >= settings.perDevice
                  ? 'Too many riders from this device. Try again in a minute.'
                  : null;
            if (full) {
              yield* conn.send({ t: 'error', msg: full });
              return yield* conn.close(1008);
            }
            p = new Player(`p${nextId++}`, yield* randomKey, conn.device);
            players.set(p.key, p);
          }
          p.conn = conn;
          conn.player = p;
        }
        const p = conn.player!;
        p.name = msg.name;
        p.paint = msg.paint;
        p.bike = msg.bike;
        if (first) {
          yield* conn.send({ t: 'welcome', id: p.id, key: p.key, resumed, share: settings.share });
          if (resumed && p.room) yield* Effect.log(`${p.name} is back in room ${p.room.code}`);
        }
        if (p.room) yield* broadcastRoom(p.room);
      });

      const command = Effect.fnUntraced(function* (p: Player, msg: Command) {
        const room = p.room;
        switch (msg.t) {
          case 'list':
            return yield* p.send(roomsMessage());
          case 'create':
            return yield* create(p, msg.level);
          case 'join':
            return yield* join(p, msg.code);
          case 'leave':
            yield* leaveRoom(p);
            return yield* p.send({ t: 'left' });
          case 'level':
            if (room && room.host === p.id && room.state === 'lobby' && isTrack(msg.level)) {
              room.level = msg.level;
              yield* broadcastRoom(room);
            }
            return;
          case 'start':
            return yield* start(p);
          case 'state': {
            if (!room || room.state === 'lobby' || !room.racers.has(p.id)) return;
            const out: ServerMessage =
              msg.c === undefined ? { t: 'state', id: p.id, p: msg.p } : { t: 'state', id: p.id, p: msg.p, c: msg.c };
            for (const q of room.players.values()) if (q !== p && room.racers.has(q.id)) yield* q.send(out);
            return;
          }
          case 'finish':
            return yield* finish(p, msg.time);
          case 'retire': {
            // a rider who gave up the race (left it from the pause menu, or reloaded the page) but stays in the room
            const rec = room?.racers.get(p.id);
            if (room && room.state !== 'lobby' && rec && rec.time === null) {
              rec.out = true;
              yield* broadcastRoom(room);
              yield* checkDone(room);
            }
            return;
          }
        }
      });

      const handle = Effect.fnUntraced(function* (conn: Conn, raw: unknown) {
        const t = Option.getOrUndefined(decodeEnvelope(raw))?.t;
        if (t === undefined) return;
        if (COMMANDS.has(t) && conn.player === null) return yield* conn.send({ t: 'error', msg: 'Say hello first.' });
        const msg = Option.getOrUndefined(decodeMessage(raw));
        if (!msg) return;
        if (msg.t === 'ping') return yield* conn.send({ t: 'pong', c: msg.c });
        if (msg.t === 'hello') return yield* hello(conn, msg);
        return yield* command(conn.player!, msg);
      });

      const expire = Effect.fnUntraced(function* (p: Player) {
        p.away = null;
        if (p.conn === null) {
          yield* leaveRoom(p);
          players.delete(p.key);
        }
      });

      const dropped = Effect.fnUntraced(function* (conn: Conn) {
        const p = conn.player;
        if (!p || p.conn !== conn) return;
        p.conn = null;
        const room = p.room;
        if (room) {
          yield* Effect.log(`${p.name} dropped out of room ${room.code}, keeping their place for ${settings.away} s`);
          // a host who drops out between races hands over straight away, so the others can still start one
          if (room.host === p.id && room.state === 'lobby') yield* passHost(room);
          yield* broadcastRoom(room);
        }
        p.away = yield* FiberSet.run(
          timers,
          Effect.sleep(settings.away * 1000).pipe(Effect.andThen(locked(expire(p)))),
        );
      });

      return RaceLobby.of({
        // one bad message shouldn't end anyone's race: a failure is logged and the lobby carries on
        receive: (conn, msg) =>
          locked(handle(conn, msg)).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Effect.logError(
                    `error handling ${JSON.stringify(String((msg as { t?: unknown })?.t).slice(0, 20))}: ${Cause.pretty(cause)}`,
                  ),
            ),
          ),
        dropped: (conn) => locked(dropped(conn)),
        rooms,
      });
    }),
  );
}
