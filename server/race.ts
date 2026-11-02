// Bike Race rooms and races. Transport-free: a connection is anything with send() and close(), so the same rooms
// work over a WebSocket and over an event stream with POSTs (server/serve.ts sets both up).

export type Message = Record<string, unknown>;

export interface Conn {
  player: Player | null;
  send(msg: Message): void;
  close(code?: number): void;
}

export interface RaceOptions {
  countdown: number; // seconds of 3, 2, 1 before a race
  ending: number; // seconds the others get once the first rider finishes
  away: number; // seconds a dropped rider keeps their place (a phone drops the connection when its screen locks)
  share: string; // the address friends on the network can open, if the server has one
  log: (text: string) => void;
}

export const RACE_LIMIT = 300; // a race ends after this many seconds whatever happens
export const MAX_PLAYERS = 6; // riders in one room
export const MAX_ROOMS = 200;
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels, so codes don't spell words, and no I or O to mix up with 1 and 0

const now = () => performance.now() / 1000;

export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cleanName(v: unknown): string {
  const name = Array.from((typeof v === 'string' ? v : '').replace(/[\x00-\x1f\x7f]/g, '').trim())
    .slice(0, 16)
    .join('');
  return name || 'Rider';
}

const cleanInt = (v: unknown, lo: number, hi: number, fallback = 0) =>
  isNumber(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : fallback;

const cleanBike = (v: unknown) => (typeof v === 'string' && /^[a-z]{1,16}$/.test(v) ? v : 'scout');

const cleanLevel = (v: unknown) => (typeof v === 'string' && /^[a-z]{1,16}-\d{1,2}$/.test(v) ? v : null);

function randomCode(): string {
  let code = '';
  while (code.length < 4) {
    const b = crypto.getRandomValues(new Uint8Array(1))[0]!;
    if (b < 240) code += CODE_LETTERS[b % 20]; // 240 is a multiple of 20, so every letter is as likely
  }
  return code;
}

function randomKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Player {
  name = 'Rider';
  paint = 0;
  bike = 'scout';
  conn: Conn | null = null; // the live connection, null while dropped
  room: Room | null = null;
  wins = 0;
  awayTimer: Timer | null = null;

  constructor(
    readonly id: string,
    readonly key: string,
  ) {}

  send(msg: Message): void {
    this.conn?.send(msg);
  }

  public() {
    return {
      id: this.id,
      name: this.name,
      paint: this.paint,
      bike: this.bike,
      wins: this.wins,
      away: this.conn === null,
    };
  }
}

interface Racer {
  name: string;
  paint: number;
  bike: string;
  time: number | null;
  out: boolean;
}

interface Result {
  id: string;
  name: string;
  paint: number;
  bike: string;
  time: number | null;
}

export class Room {
  host: string;
  readonly players = new Map<string, Player>(); // in the order they joined
  state: 'lobby' | 'countdown' | 'race' = 'lobby';
  racers = new Map<string, Racer>(); // for the race on now
  endsAt: number | null = null; // when the race closes, once someone has finished
  last: Result[] | null = null; // results of the last race
  readonly created = now();
  private timers: Timer[] = [];

  constructor(
    readonly code: string,
    public level: string,
    host: Player,
  ) {
    this.host = host.id;
  }

  later(seconds: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, seconds * 1000));
  }

  cancelTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  broadcast(msg: Message): void {
    for (const p of this.players.values()) p.send(msg);
  }

  public(): Message {
    const racing = this.state !== 'lobby';
    return {
      t: 'room',
      code: this.code,
      host: this.host,
      level: this.level,
      state: this.state,
      players: [...this.players.values()].map((p) => p.public()),
      racers: racing ? [...this.racers.keys()] : [],
      ending: racing && this.endsAt !== null ? Math.max(0, Math.round(this.endsAt - now())) : null,
      last: this.last,
    };
  }
}

type Command = 'list' | 'create' | 'join' | 'leave' | 'level' | 'start' | 'state' | 'finish' | 'retire';
const COMMANDS = new Set<string>(['list', 'create', 'join', 'leave', 'level', 'start', 'state', 'finish', 'retire']);

export class Lobby {
  readonly players = new Map<string, Player>(); // resume key -> Player
  readonly rooms = new Map<string, Room>(); // code -> Room
  private nextId = 1;

  constructor(private readonly opts: RaceOptions) {}

  handle(conn: Conn, msg: Message): void {
    const t = msg.t;
    if (typeof t !== 'string') return;
    if (t === 'ping') conn.send({ t: 'pong', c: isNumber(msg.c) ? msg.c : 0 });
    else if (t === 'hello') this.hello(conn, msg);
    else if (COMMANDS.has(t)) {
      if (conn.player === null) conn.send({ t: 'error', msg: 'Say hello first.' });
      else this.commands[t as Command](conn.player, msg);
    }
  }

  private readonly commands: Record<Command, (p: Player, msg: Message) => void> = {
    list: (p) => p.send(this.roomsMessage()),
    create: (p, msg) => this.create(p, msg),
    join: (p, msg) => this.join(p, msg),
    leave: (p) => {
      this.leaveRoom(p);
      p.send({ t: 'left' });
    },
    level: (p, msg) => {
      const room = p.room,
        level = cleanLevel(msg.level);
      if (room && room.host === p.id && room.state === 'lobby' && level) {
        room.level = level;
        room.broadcast(room.public());
      }
    },
    start: (p) => this.start(p),
    state: (p, msg) => this.state(p, msg),
    finish: (p, msg) => this.finish(p, msg),
    // a rider who gave up the race (left it from the pause menu, or reloaded the page) but stays in the room
    retire: (p) => {
      const room = p.room;
      const rec = room?.racers.get(p.id);
      if (room && room.state !== 'lobby' && rec && rec.time === null) {
        rec.out = true;
        room.broadcast(room.public());
        this.checkDone(room);
      }
    },
  };

  // A connection says hello first, with the key it was given last time (if any). A rider who dropped out a moment
  // ago gets their place back; anyone else is a new rider with a new key.
  private hello(conn: Conn, msg: Message): void {
    const first = conn.player === null;
    let resumed = false;
    if (first) {
      let p = typeof msg.key === 'string' ? this.players.get(msg.key) : undefined;
      if (p) {
        resumed = true;
        if (p.awayTimer) {
          clearTimeout(p.awayTimer);
          p.awayTimer = null;
        }
        if (p.conn) {
          // the old connection hasn't noticed it is dead yet, or another tab
          const old = p.conn;
          p.conn = null;
          old.send({ t: 'replaced' });
          old.player = null;
          old.close();
        }
      } else {
        p = new Player(`p${this.nextId++}`, randomKey());
        this.players.set(p.key, p);
      }
      p.conn = conn;
      conn.player = p;
    }
    const p = conn.player!;
    p.name = cleanName(msg.name);
    p.paint = cleanInt(msg.paint, 0, 999);
    p.bike = cleanBike(msg.bike);
    if (first) {
      conn.send({ t: 'welcome', id: p.id, key: p.key, resumed, share: this.opts.share });
      if (resumed && p.room) this.opts.log(`${p.name} is back in room ${p.room.code}`);
    }
    if (p.room) p.room.broadcast(p.room.public());
  }

  dropped(conn: Conn): void {
    const p = conn.player;
    if (!p || p.conn !== conn) return;
    p.conn = null;
    const room = p.room;
    if (room) {
      this.opts.log(`${p.name} dropped out of room ${room.code}, keeping their place for ${this.opts.away} s`);
      // a host who drops out between races hands over straight away, so the others can still start one
      if (room.host === p.id && room.state === 'lobby') this.passHost(room);
      room.broadcast(room.public());
    }
    p.awayTimer = setTimeout(() => this.expire(p), this.opts.away * 1000);
  }

  private expire(p: Player): void {
    p.awayTimer = null;
    if (p.conn === null) {
      this.leaveRoom(p);
      this.players.delete(p.key);
    }
  }

  private roomsMessage(): Message {
    const rooms = [...this.rooms.values()].sort((a, b) => b.created - a.created).slice(0, 30);
    return {
      t: 'rooms',
      rooms: rooms.map((r) => ({
        code: r.code,
        host: r.players.get(r.host)?.name ?? '',
        level: r.level,
        count: r.players.size,
        state: r.state,
      })),
    };
  }

  private newCode(): string {
    for (;;) {
      const code = randomCode();
      if (!this.rooms.has(code)) return code;
    }
  }

  private create(p: Player, msg: Message): void {
    const level = cleanLevel(msg.level);
    if (!level) return p.send({ t: 'error', msg: 'Pick a track first.' });
    if (this.rooms.size >= MAX_ROOMS)
      return p.send({ t: 'error', msg: 'This race server is full. Try again in a minute.' });
    this.leaveRoom(p);
    const room = new Room(this.newCode(), level, p);
    this.rooms.set(room.code, room);
    room.players.set(p.id, p);
    p.room = room;
    this.opts.log(`${p.name} opened room ${room.code} on ${level}`);
    room.broadcast(room.public());
  }

  private join(p: Player, msg: Message): void {
    const code = String(msg.code || '')
      .trim()
      .toUpperCase()
      .slice(0, 8);
    const room = this.rooms.get(code);
    if (!room) return p.send({ t: 'error', msg: `There is no room ${code || '----'}. Check the code?`, code });
    if (p.room === room) return p.send(room.public());
    if (room.players.size >= MAX_PLAYERS)
      return p.send({ t: 'error', msg: `Room ${code} is full (${MAX_PLAYERS} riders).`, code });
    this.leaveRoom(p);
    room.players.set(p.id, p);
    p.room = room;
    this.opts.log(`${p.name} joined room ${code} (${room.players.size} riders)`);
    room.broadcast(room.public());
  }

  private leaveRoom(p: Player): void {
    const room = p.room;
    if (!room) return;
    room.players.delete(p.id);
    p.room = null;
    const rec = room.racers.get(p.id);
    if (rec) rec.out = true;
    if (room.players.size === 0) {
      room.cancelTimers();
      this.rooms.delete(room.code);
      this.opts.log(`room ${room.code} closed`);
      return;
    }
    if (room.host === p.id) this.passHost(room);
    room.broadcast(room.public());
    this.checkDone(room);
  }

  // The next rider to have joined takes over, preferring one who is connected.
  private passHost(room: Room): void {
    const old = room.host;
    const players = [...room.players.values()];
    room.host = players.find((q) => q.conn && q.id !== old)?.id ?? players.find((q) => q.id !== old)?.id ?? old;
    if (room.host !== old) this.opts.log(`${room.players.get(room.host)!.name} is now host of room ${room.code}`);
  }

  private start(p: Player): void {
    const room = p.room;
    if (!room) return;
    if (room.host !== p.id) return p.send({ t: 'error', msg: 'Only the host can start the race.' });
    if (room.state !== 'lobby') return;
    room.racers = new Map(
      [...room.players.values()]
        .filter((q) => q.conn)
        .map((q) => [q.id, { name: q.name, paint: q.paint, bike: q.bike, time: null, out: false }]),
    );
    room.state = 'countdown';
    room.endsAt = null;
    room.broadcast({
      t: 'countdown',
      level: room.level,
      racers: [...room.racers.keys()],
      seconds: this.opts.countdown,
    });
    room.broadcast(room.public());
    room.later(this.opts.countdown, () => this.go(room));
    const n = room.racers.size;
    this.opts.log(`race in room ${room.code} on ${room.level} with ${n} rider${n !== 1 ? 's' : ''}`);
  }

  private go(room: Room): void {
    if (room.state !== 'countdown') return;
    room.state = 'race';
    room.later(RACE_LIMIT, () => this.endRace(room));
    room.broadcast(room.public());
  }

  private state(p: Player, msg: Message): void {
    const room = p.room,
      pose = msg.p;
    if (!room || room.state === 'lobby' || !room.racers.has(p.id)) return;
    if (!Array.isArray(pose) || pose.length < 1 || pose.length > 8 || !pose.every(isNumber)) return;
    const out: Message = { t: 'state', id: p.id, p: pose };
    if (isNumber(msg.c)) out.c = msg.c;
    for (const q of room.players.values()) if (q !== p && room.racers.has(q.id)) q.send(out);
  }

  private finish(p: Player, msg: Message): void {
    const room = p.room,
      t = msg.time;
    if (!room || room.state !== 'race' || !isNumber(t) || !(t > 0 && t < RACE_LIMIT + 60)) return;
    const rec = room.racers.get(p.id);
    if (!rec || rec.time !== null || rec.out) return;
    rec.time = Math.round(t * 1000) / 1000;
    room.broadcast({ t: 'finished', id: p.id, time: rec.time });
    if (room.endsAt === null && this.outstanding(room).length) {
      room.endsAt = now() + this.opts.ending;
      room.later(this.opts.ending, () => this.endRace(room));
      room.broadcast({ t: 'ending', seconds: this.opts.ending });
    }
    this.checkDone(room);
  }

  private outstanding(room: Room): Racer[] {
    return [...room.racers.values()].filter((r) => r.time === null && !r.out);
  }

  private checkDone(room: Room): void {
    if (room.state !== 'lobby' && this.outstanding(room).length === 0) this.endRace(room);
  }

  private endRace(room: Room): void {
    if (room.state === 'lobby' || this.rooms.get(room.code) !== room) return;
    room.cancelTimers();
    const rows: Result[] = [...room.racers].map(([id, rec]) => {
      const q = room.players.get(id);
      return { id, name: q?.name ?? rec.name, paint: q?.paint ?? rec.paint, bike: q?.bike ?? rec.bike, time: rec.time };
    });
    // finishers first, fastest first; the order of the others stays as it was
    rows.sort((a, b) => (a.time === null ? 1 : 0) - (b.time === null ? 1 : 0) || (a.time ?? 0) - (b.time ?? 0));
    const winner = rows[0] && room.players.get(rows[0].id);
    if (rows.length > 1 && rows[0]!.time !== null && winner) winner.wins++;
    room.state = 'lobby';
    room.endsAt = null;
    room.racers = new Map();
    room.last = rows;
    if (room.players.get(room.host)?.conn === null) this.passHost(room);
    room.broadcast({ t: 'results', level: room.level, results: rows });
    room.broadcast(room.public());
    const line = rows.map((r) => (r.time !== null ? `${r.name} ${r.time.toFixed(2)}` : `${r.name} DNF`)).join(', ');
    this.opts.log(`room ${room.code} results: ${line}`);
  }
}
