// The Bike Race race protocol: every message the game and the race server send each other, as Effect Schemas, in
// one place for both of them. docs/bike-race.md lists the messages.
//
// The server decodes what a game sends with the schemas under "What the game sends". They forgive what the race
// server always forgave: a missing or odd name, paint or bike becomes the default rather than refusing the message.
// A pose or a finish time that doesn't make sense is refused, and the server drops that message. The game decodes
// what the server sends with ServerMessage, and drops anything that doesn't fit.
import { Schema } from 'effect';
import { forgiving } from './schemas';

export const RACE_LIMIT = 300; // a race ends after this many seconds whatever happens
export const MAX_NAME = 16; // characters in a rider's name
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels, so codes don't spell words, and no I or O to mix up with 1 and 0
export const ROOM_CODE = new RegExp(`^[${CODE_LETTERS}]{4}$`);
export { CODE_LETTERS };

// ---------- forgiving fields (forgiving is in schemas.ts) ----------

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** No control characters, trimmed, at most 16 characters, and "Rider" if nothing is left */
export function cleanName(v: unknown): string {
  const name = Array.from((typeof v === 'string' ? v : '').replace(/[\x00-\x1f\x7f]/g, '').trim())
    .slice(0, MAX_NAME)
    .join('');
  return name || 'Rider';
}
const cleanInt = (v: unknown, lo: number, hi: number, fallback = 0) =>
  isNumber(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : fallback;
const cleanBike = (v: unknown) => (typeof v === 'string' && /^[a-z]{1,16}$/.test(v) ? v : 'scout');
/** A level id such as clover-2, or null */
export const cleanLevel = (v: unknown) => (typeof v === 'string' && /^[a-z]{1,16}-\d{1,2}$/.test(v) ? v : null);
const cleanCode = (v: unknown) =>
  String(v || '')
    .trim()
    .toUpperCase()
    .slice(0, 8);

const Name = forgiving(Schema.String, cleanName);
const LevelId = forgiving(Schema.NullOr(Schema.String), cleanLevel);
/** A number if one came, or undefined */
const MaybeNumber = forgiving(Schema.UndefinedOr(Schema.Finite), (v) => (isNumber(v) ? v : undefined));

// ---------- what the game sends ----------

/** A pose: [x, y, angle, wheel spin, lean, flags] (flags: 1 crashed, 2 finished); a few more numbers are let through */
export const Pose = Schema.Array(Schema.Finite).check(Schema.isMinLength(1), Schema.isMaxLength(8));

/** Asks for a pong; c comes back as it was sent, to time the round trip */
export const Ping = Schema.Struct({
  t: Schema.Literal('ping'),
  c: forgiving(Schema.Finite, (v) => (isNumber(v) ? v : 0)),
});
/** First, and again when the name, paint or bike changes. key gets a dropped rider their place back. */
export const Hello = Schema.Struct({
  t: Schema.Literal('hello'),
  name: Name,
  paint: forgiving(Schema.Int, (v) => cleanInt(v, 0, 999)),
  bike: forgiving(Schema.String, cleanBike),
  key: forgiving(Schema.String, (v) => (typeof v === 'string' ? v : '')),
});
export const List = Schema.Struct({ t: Schema.Literal('list') });
/** Opens a room; a missing or odd level is null, and the server asks for a track */
export const Create = Schema.Struct({ t: Schema.Literal('create'), level: LevelId });
/** Joins a room by its code, in any case */
export const Join = Schema.Struct({ t: Schema.Literal('join'), code: forgiving(Schema.String, cleanCode) });
export const Leave = Schema.Struct({ t: Schema.Literal('leave') });
/** The host changes the track (an odd level is ignored) */
export const Level = Schema.Struct({ t: Schema.Literal('level'), level: LevelId });
export const Start = Schema.Struct({ t: Schema.Literal('start') });
/** Our pose and race clock, 20 times a second */
export const State = Schema.Struct({ t: Schema.Literal('state'), p: Pose, c: MaybeNumber });
/** Crossed the line, after time seconds on this phone's own race clock */
export const Finish = Schema.Struct({
  t: Schema.Literal('finish'),
  time: Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThan(RACE_LIMIT + 60)),
});
/** Gave up the race (left it from the pause menu, or reloaded the page) but stays in the room */
export const Retire = Schema.Struct({ t: Schema.Literal('retire') });

/** Everything that needs a hello first */
export const Command = Schema.Union([List, Create, Join, Leave, Level, Start, State, Finish, Retire]);
export type Command = typeof Command.Type;
export const COMMANDS: ReadonlySet<string> = new Set(Command.members.map((m) => m.fields.t.literal));

export const ClientMessage = Schema.Union([Ping, Hello, ...Command.members]);
/** A message the game sends, as decoded */
export type ClientMessage = typeof ClientMessage.Type;
/** A message as the game writes it: the forgiving fields are optional */
export type ClientMessageOut = typeof ClientMessage.Encoded;

/** Just the type of a message, to tell a command from a stranger before decoding the rest */
export const Envelope = Schema.Struct({ t: Schema.String });

// ---------- what the server sends ----------

export const RoomState = Schema.Literals(['lobby', 'countdown', 'race']);
export type RoomState = typeof RoomState.Type;

/** A room in the open rooms list */
export const RoomSummary = Schema.Struct({
  code: Schema.String,
  host: Schema.String, // the host's name
  level: Schema.String,
  count: Schema.Number,
  state: RoomState,
});
export type RoomSummary = typeof RoomSummary.Type;

export const RoomPlayer = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  paint: Schema.Number,
  bike: Schema.String,
  wins: Schema.Number,
  away: Schema.Boolean, // dropped out, and keeping their place for a while
});
export type RoomPlayer = typeof RoomPlayer.Type;

/** One rider's line in a race's results, fastest first */
export const RaceResult = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  paint: Schema.Number,
  bike: Schema.String,
  time: Schema.NullOr(Schema.Number), // null for DNF
});
export type RaceResult = typeof RaceResult.Type;

export const Welcome = Schema.Struct({
  t: Schema.Literal('welcome'),
  id: Schema.String,
  key: Schema.String,
  resumed: Schema.Boolean,
  share: Schema.String, // the server's address on the Wi-Fi, when it listens there
});
export const Rooms = Schema.Struct({ t: Schema.Literal('rooms'), rooms: Schema.Array(RoomSummary) });
/** Whenever anything in a room changes, to everyone in it */
export const RoomMessage = Schema.Struct({
  t: Schema.Literal('room'),
  code: Schema.String,
  host: Schema.String, // the host's id
  level: Schema.String,
  state: RoomState,
  players: Schema.Array(RoomPlayer), // in the order they joined
  racers: Schema.Array(Schema.String), // ids in the race on now
  ending: Schema.NullOr(Schema.Number), // seconds until the race closes, once someone has finished
  last: Schema.NullOr(Schema.Array(RaceResult)), // the last race's results
});
export type RoomMessage = typeof RoomMessage.Type;
export const Left = Schema.Struct({ t: Schema.Literal('left') });
export const ErrorMessage = Schema.Struct({
  t: Schema.Literal('error'),
  msg: Schema.String,
  code: Schema.optionalKey(Schema.String),
});
/** Another tab took this rider over */
export const Replaced = Schema.Struct({ t: Schema.Literal('replaced') });
/** A race starts: 3, 2, 1 and GO is `seconds` later */
export const Countdown = Schema.Struct({
  t: Schema.Literal('countdown'),
  level: Schema.String,
  racers: Schema.Array(Schema.String),
  seconds: Schema.Number,
});
export type CountdownMessage = typeof Countdown.Type;
/** Another racer's pose and race clock */
export const RacerState = Schema.Struct({
  t: Schema.Literal('state'),
  id: Schema.String,
  p: Pose,
  c: Schema.optionalKey(Schema.Number),
});
export const Finished = Schema.Struct({ t: Schema.Literal('finished'), id: Schema.String, time: Schema.Number });
export const Ending = Schema.Struct({ t: Schema.Literal('ending'), seconds: Schema.Number });
export const Results = Schema.Struct({
  t: Schema.Literal('results'),
  level: Schema.String,
  results: Schema.Array(RaceResult),
});
export const Pong = Schema.Struct({ t: Schema.Literal('pong'), c: Schema.Number });

export const ServerMessage = Schema.Union([
  Welcome,
  Rooms,
  RoomMessage,
  Left,
  ErrorMessage,
  Replaced,
  Countdown,
  RacerState,
  Finished,
  Ending,
  Results,
  Pong,
]);
export type ServerMessage = typeof ServerMessage.Type;
/** One kind of server message, e.g. ServerMessageOf<'room'> */
export type ServerMessageOf<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

/** The event stream's first message, naming the stream for the POSTs that go with it */
export const StreamOpened = Schema.Struct({ t: Schema.Literal('conn'), sid: Schema.String });
