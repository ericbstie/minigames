// The race rooms (server/race.ts) on Effect's TestClock: whole races with the real timings (a 3 s countdown, 30 s
// for the others after the first finish, the 300 s race limit, 45 s for a dropped rider) without waiting for any of
// it. Connections here are stand-ins that keep what they are sent; tests/race-server.test.ts covers the real ones.
import { describe, expect, test } from 'bun:test';
import { Effect, Layer, Logger } from 'effect';
import { TestClock } from 'effect/testing';
import type { ServerMessage, ServerMessageOf } from '../public/js/bike-race-protocol';
import { type Conn, type Player, RACE_LIMIT, RaceLobby } from '../server/race';

class TestConn implements Conn {
  player: Player | null = null;
  closed = false;
  readonly inbox: ServerMessage[] = [];

  send(msg: ServerMessage) {
    return Effect.sync(() => void this.inbox.push(msg));
  }

  close() {
    return Effect.sync(() => void (this.closed = true));
  }

  /** The messages of one type that came since the last look, oldest first */
  take<T extends ServerMessage['t']>(t: T): ServerMessageOf<T>[] {
    const out = this.inbox.filter((m): m is ServerMessageOf<T> => m.t === t);
    for (const m of out) this.inbox.splice(this.inbox.indexOf(m), 1);
    return out;
  }

  /** The newest room message */
  room() {
    return this.take('room').at(-1);
  }
}

// Runs a test with a fresh lobby on a TestClock, and no log
const run = (body: (lobby: RaceLobby['Service']) => Effect.Effect<void>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* body(yield* RaceLobby);
    }).pipe(Effect.provide(RaceLobby.layer), Effect.provide(Layer.mergeAll(TestClock.layer(), Logger.layer([])))),
  );

const seconds = (s: number) => TestClock.adjust(s * 1000);

// Two riders in a room: a is the host
const twoInARoom = Effect.fnUntraced(function* (lobby: RaceLobby['Service']) {
  const a = new TestConn(),
    b = new TestConn();
  yield* lobby.receive(a, { t: 'hello', name: 'Ann' });
  yield* lobby.receive(b, { t: 'hello', name: 'Bo' });
  yield* lobby.receive(a, { t: 'create', level: 'clover-1' });
  const code = a.room()!.code;
  yield* lobby.receive(b, { t: 'join', code });
  a.inbox.length = b.inbox.length = 0;
  return { a, b, code };
});

describe('races on the real clock', () => {
  test('GO comes 3 s after the countdown starts', () =>
    run((lobby) =>
      Effect.gen(function* () {
        const { a, b } = yield* twoInARoom(lobby);
        yield* lobby.receive(a, { t: 'start' });
        expect(b.take('countdown')[0]).toMatchObject({ seconds: 3, racers: [a.player!.id, b.player!.id] });
        expect(a.room()?.state).toBe('countdown');
        yield* seconds(2.9);
        expect(a.room()).toBeUndefined();
        yield* seconds(0.1);
        expect(a.room()?.state).toBe('race');
      }),
    ));

  test('the others get 30 s after the first finish, then the race ends', () =>
    run((lobby) =>
      Effect.gen(function* () {
        const { a, b } = yield* twoInARoom(lobby);
        yield* lobby.receive(a, { t: 'start' });
        yield* seconds(3);
        yield* lobby.receive(a, { t: 'finish', time: 40.1234 });
        expect(b.take('finished')).toEqual([{ t: 'finished', id: a.player!.id, time: 40.123 }]);
        expect(b.take('ending')).toEqual([{ t: 'ending', seconds: 30 }]);
        yield* seconds(10);
        // the next room message shows the closing clock counting down
        yield* lobby.receive(b, { t: 'hello', name: 'Bo' });
        expect(a.room()?.ending).toBe(20);
        yield* seconds(19.9);
        expect(a.take('results')).toEqual([]);
        yield* seconds(0.1);
        const [res] = a.take('results');
        expect(res!.results.map((r) => [r.name, r.time])).toEqual([
          ['Ann', 40.123],
          ['Bo', null],
        ]);
        expect(a.room()).toMatchObject({ state: 'lobby', racers: [], ending: null });
      }),
    ));

  test('nobody finishing: the race ends at the 300 s limit', () =>
    run((lobby) =>
      Effect.gen(function* () {
        const { a } = yield* twoInARoom(lobby);
        yield* lobby.receive(a, { t: 'start' });
        yield* seconds(3 + RACE_LIMIT - 1);
        expect(a.take('results')).toEqual([]);
        yield* seconds(1);
        expect(a.take('results')[0]!.results.every((r) => r.time === null)).toBe(true);
      }),
    ));

  test('when everyone finishes the race ends at once, and its timers are cancelled', () =>
    run((lobby) =>
      Effect.gen(function* () {
        const { a, b } = yield* twoInARoom(lobby);
        yield* lobby.receive(a, { t: 'start' });
        yield* seconds(3);
        yield* lobby.receive(b, { t: 'finish', time: 20 });
        yield* lobby.receive(a, { t: 'finish', time: 21 });
        expect(a.take('results')[0]!.results.map((r) => r.name)).toEqual(['Bo', 'Ann']);
        // a new race straight away: the old closing clock must not end it
        yield* lobby.receive(a, { t: 'start' });
        yield* seconds(3 + 30);
        expect(a.take('results')).toEqual([]);
        expect(a.room()?.state).toBe('race');
      }),
    ));

  test('everyone leaving during the countdown closes the room, and GO never comes', () =>
    run((lobby) =>
      Effect.gen(function* () {
        const { a, b } = yield* twoInARoom(lobby);
        yield* lobby.receive(a, { t: 'start' });
        yield* lobby.receive(a, { t: 'leave' });
        yield* lobby.receive(b, { t: 'leave' });
        expect(lobby.rooms.size).toBe(0);
        b.inbox.length = 0;
        yield* seconds(10);
        expect(b.inbox).toEqual([]);
      }),
    ));
});

describe('dropping out', () => {
  test('a dropped rider keeps their place for 45 s', () =>
    run((lobby) =>
      Effect.gen(function* () {
        const { a, b } = yield* twoInARoom(lobby);
        const id = b.player!.id;
        yield* lobby.dropped(b);
        expect(a.room()?.players.find((p) => p.id === id)?.away).toBe(true);
        yield* seconds(44.9);
        expect(lobby.rooms.values().next().value?.players.has(id)).toBe(true);
        yield* seconds(0.1);
        expect(a.room()?.players.map((p) => p.name)).toEqual(['Ann']);
      }),
    ));

  test('coming back in time keeps them for good, and the old connection is replaced', () =>
    run((lobby) =>
      Effect.gen(function* () {
        const { a, b } = yield* twoInARoom(lobby);
        const { id, key } = b.player!;
        yield* lobby.dropped(b);
        yield* seconds(30);
        const back = new TestConn();
        yield* lobby.receive(back, { t: 'hello', name: 'Bo', key });
        expect(back.take('welcome')[0]).toMatchObject({ id, resumed: true });
        yield* seconds(60);
        expect(a.room()?.players.find((p) => p.id === id)?.away).toBe(false);
        const other = new TestConn();
        yield* lobby.receive(other, { t: 'hello', key });
        expect(back.take('replaced')).toHaveLength(1);
        expect(back.closed).toBe(true);
      }),
    ));

  test('a host who drops out between races hands over at once', () =>
    run((lobby) =>
      Effect.gen(function* () {
        const { a, b } = yield* twoInARoom(lobby);
        yield* lobby.dropped(a);
        expect(b.room()?.host).toBe(b.player!.id);
      }),
    ));
});

describe('messages', () => {
  test('nothing but ping and hello before a hello', () =>
    run((lobby) =>
      Effect.gen(function* () {
        const c = new TestConn();
        yield* lobby.receive(c, { t: 'list' });
        yield* lobby.receive(c, { t: 'state', p: 'nonsense' });
        yield* lobby.receive(c, { t: 'ping', c: 7 });
        yield* lobby.receive(c, { t: 'nonsense' });
        yield* lobby.receive(c, 'nonsense');
        expect(c.inbox).toEqual([
          { t: 'error', msg: 'Say hello first.' },
          { t: 'error', msg: 'Say hello first.' },
          { t: 'pong', c: 7 },
        ]);
      }),
    ));

  test('a hello is cleaned up rather than refused', () =>
    run((lobby) =>
      Effect.gen(function* () {
        const c = new TestConn();
        yield* lobby.receive(c, {
          t: 'hello',
          name: '  A\u0000very long name indeed  ',
          paint: 1e9,
          bike: 'Rocket!',
          key: 5,
        });
        yield* lobby.receive(c, { t: 'create', level: 'clover-3' });
        expect(c.room()?.players[0]).toMatchObject({ name: 'Avery long name ', paint: 999, bike: 'scout' });
        yield* lobby.receive(c, { t: 'create' });
        expect(c.take('error')).toEqual([{ t: 'error', msg: 'Pick a track first.' }]);
      }),
    ));

  test('a pose or finish that makes no sense is dropped', () =>
    run((lobby) =>
      Effect.gen(function* () {
        const { a, b } = yield* twoInARoom(lobby);
        yield* lobby.receive(a, { t: 'start' });
        yield* seconds(3);
        for (const p of [[], [1, 2, 3, 4, 5, 6, 7, 8, 9], [1, Infinity], 'x'])
          yield* lobby.receive(a, { t: 'state', p });
        expect(b.take('state')).toEqual([]);
        yield* lobby.receive(a, { t: 'state', p: [1, 2], c: 'later' });
        expect(b.take('state')).toEqual([{ t: 'state', id: a.player!.id, p: [1, 2] }]);
        for (const time of [0, -1, RACE_LIMIT + 60, 'fast']) yield* lobby.receive(a, { t: 'finish', time });
        expect(b.take('finished')).toEqual([]);
      }),
    ));
});
