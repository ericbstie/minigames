// The Bike Race client's tries to get a dropped connection back (public/js/bike-race-net.ts) on Effect's TestClock:
// 1, 2, 4, 8 and 8 s apart, six tries in all, and then it gives up. tests/browser/bike-race-online.test.ts drops
// real connections.
import { expect, test } from 'bun:test';
import { Clock, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { reconnectSchedule } from '../public/js/bike-race-net';

test('six tries, 1, 2, 4, 8 and 8 s apart, then it gives up', () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const tries: number[] = [];
      const noServer = Effect.flatMap(Clock.currentTimeMillis, (ms) => {
        tries.push(ms);
        return Effect.fail('no server');
      });
      const fiber = yield* Effect.forkChild(Effect.flip(Effect.retry(noServer, reconnectSchedule)));
      yield* TestClock.adjust(22_999);
      expect(tries).toEqual([0, 1000, 3000, 7000, 15000]);
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(fiber)).toBe('no server');
      expect(tries).toEqual([0, 1000, 3000, 7000, 15000, 23000]);
    }).pipe(Effect.provide(TestClock.layer())),
  ));
