// The computer rider on Bike Race's built-in levels, shared by tools/check-bike-levels.ts (the table of times) and
// tests/bike-race-levels.test.ts (every bike finishes every level in every riding style).
import {
  type Bike,
  botInput,
  type BotConfig,
  buildLevel,
  type Level,
  type LevelDef,
  Sim,
  type World,
} from '../public/js/bike-race-core';

// Riding styles: the default rider first, then variations of how hard it steers and how fast it goes. A level that
// only just works for one exact riding line fails in one of the others.
export const STYLES: BotConfig[] = [
  {},
  { kp: 2.2 },
  { kp: 2.6 },
  { kd: 0.36 },
  { kd: 0.5 },
  { maxSpeed: 13.6, kp: 2.2 },
  { maxSpeed: 15.4, kp: 2.6 },
];

export interface Ride {
  level: Level;
  bike: Bike;
  maxAir: number; // the longest time in the air, in seconds
  why: string; // why the bike didn't finish ('' when it did)
}

/** Rides level def of world on bike bikeId with the computer rider set up as cfg, for at most 120 s. */
export function ride(world: World, def: LevelDef, bikeId: string, cfg: BotConfig, log?: string[] | null): Ride {
  const level = buildLevel(world, def),
    sim = new Sim(level),
    bike = sim.addBike(bikeId);
  bike.running = true;
  let maxAir = 0,
    steps = 0;
  while (!bike.finished && !bike.crashed && sim.t < 120) {
    bike.input = botInput(bike, cfg);
    sim.step();
    steps++;
    maxAir = Math.max(maxAir, bike.airborne);
    if (log && steps % 60 === 0)
      log.push(
        `t=${sim.t.toFixed(1)} x=${bike.c.x.toFixed(1)} y=${bike.c.y.toFixed(1)} a=${bike.c.a.toFixed(2)} v=${bike.speed.toFixed(1)}`,
      );
    bike.events.length = 0;
  }
  const piece = (level.marks.filter((m) => m[0] <= bike.c.x + 1).pop() || [0, 'start'])[1];
  const why = bike.finished
    ? ''
    : bike.crashed
      ? `crashed (${bike.crashKind}) at x=${bike.c.x.toFixed(0)} of ${level.finishX.toFixed(0)}, on "${piece}"`
      : `ran out of time at x=${bike.c.x.toFixed(0)}`;
  return { level, bike, maxAir, why };
}
