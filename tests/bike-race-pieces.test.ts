// Checks the level editor's track pieces (public/js/bike-race-pieces.ts) without a browser:
//   - each piece's shape and ends, and the edits the editor makes (add, rotate, flip, move, remove, load)
//   - that every bike gets round a full loop made of pieces, with the rider's head clear of the track,
//     and that each ramp clears a gap and lands
import { describe, expect, test } from 'bun:test';
import * as C from '../public/js/bike-race-core';
import type { Bike, BikeInput } from '../public/js/bike-race-core';
import * as P from '../public/js/bike-race-pieces';
import type { Cursor, End, LevelData, PieceTypeId } from '../public/js/bike-race-pieces';

const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) <= e;
const endAt = (data: LevelData, i: number, e: number) => P.geom(P.getPiece(data, i)).ends[e];
const cursorAt = (E: End): Cursor => ({ x: E.x, y: E.y, dx: E.ox, dy: E.oy });
/** The same value only computed once, the first time a test asks for it */
function once<T>(make: () => T): () => T {
  let made: { v: T } | null = null;
  return () => (made ??= { v: make() }).v;
}

// A level made the way the editor makes one: each piece added at the far end of the one before.
function chain(types: (PieceTypeId | 'gap')[], opts: { gap?: number } = {}) {
  const d = P.newLevel('check');
  let cur = cursorAt(endAt(d, 0, 1));
  for (const t of types) {
    // a gap, then carry on level (the editor's way: tap the open track beyond the gap, then add pieces there)
    if (t === 'gap') {
      cur = { x: cur.x + (opts.gap ?? 0), y: cur.y, dx: 1, dy: 0 };
      d.finish = { x: cur.x, y: cur.y, d: 1 };
      continue;
    }
    const i = P.append(d, t, cur);
    cur = cursorAt(endAt(d, i, 1));
  }
  return d;
}
// How close the rider's head comes to solid track, in metres (negative: it hits)
function headRoom(b: Bike) {
  const T = b.sim.level.terrain,
    [lx, ly, r] = b.s.head,
    [hx, hy] = b.toWorld(lx, ly);
  let best = Infinity;
  for (let i = 0; i < T.n; i++) {
    const g = T.group[i];
    if (g && b.disabledGroups.has(g)) continue;
    const ax = T.ax[i],
      ay = T.ay[i],
      ex = T.bx[i] - ax,
      ey = T.by[i] - ay;
    let t = ((hx - ax) * ex + (hy - ay) * ey) / (ex * ex + ey * ey);
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(hx - ax - ex * t, hy - ay - ey * t) - r);
  }
  return best;
}
const RIDERS: Record<string, (b: Bike) => BikeInput> = {
  bot: (b) => C.botInput(b),
  'gas only': () => ({ gas: 1, brake: 0, lean: 0 }),
};
interface Run {
  b: Bike;
  room: number; // the least head room while riding the watched stretch
  maxY: number;
  air: { t: number; d: number } | null; // the first jump: how long and how far
  why: string;
}
function ride(data: LevelData, bikeId: string, rider: string, watch?: [number, number]): Run {
  const level = P.buildCustomLevel(data),
    sim = new C.Sim(level),
    b = sim.addBike(bikeId);
  b.running = true;
  const out = { room: Infinity, maxY: -Infinity, air: null as Run['air'] };
  let t0: number | null = null,
    x0 = 0;
  for (let k = 0; k < 120 * 40 && !b.finished && !b.crashed; k++) {
    b.input = RIDERS[rider](b);
    sim.step();
    out.maxY = Math.max(out.maxY, b.c.y);
    // head room while riding the track (both wheels on it), not while tumbling off the top of a loop too slowly
    if (watch && b.c.x > watch[0] && b.c.x < watch[1] && b.wheels.every((W) => W.contact))
      out.room = Math.min(out.room, headRoom(b));
    if (!b.grounded && t0 == null && b.c.x > 30) {
      t0 = b.time;
      x0 = b.c.x;
    }
    if (b.grounded && t0 != null && !out.air) out.air = { t: b.time - t0, d: b.c.x - x0 };
  }
  const why = b.finished
    ? `finished in ${b.finishTime.toFixed(2)} s`
    : b.crashed
      ? `crashed (${b.crashKind}) at x=${b.c.x.toFixed(1)} y=${b.c.y.toFixed(1)}`
      : `stuck at x=${b.c.x.toFixed(1)} y=${b.c.y.toFixed(1)}`;
  return { ...out, b, why };
}

describe('Shapes', () => {
  for (const T of P.TYPES) {
    const g = () => P.geom({ t: T.id, x: 0, y: 0, a: 0, m: false });
    test(`${T.name} starts at its origin heading right`, () => {
      const [e0] = g().ends;
      expect(near(e0.x, 0) && near(e0.y, 0) && near(e0.ox, -1) && near(e0.oy, 0)).toBe(true);
    });
    if (T.len !== undefined)
      test(`${T.name} is ${T.len} m long`, () => {
        const e1 = g().ends[1];
        expect(near(e1.x, T.len) && near(e1.y, 0) && near(e1.ox, 1)).toBe(true);
      });
    else
      test(`${T.name} turns ${T.sweep} degrees on a ${T.r} m curve`, () => {
        const e1 = g().ends[1],
          a = (T.sweep * Math.PI) / 180;
        expect(
          near(e1.x, T.r * Math.sin(a)) &&
            near(e1.y, T.r * (1 - Math.cos(a))) &&
            near(Math.atan2(e1.oy, e1.ox), Math.atan2(Math.sin(a), Math.cos(a))),
        ).toBe(true);
      });
    // a mirrored copy curves the other way
    test(`${T.name} mirrored curves down`, () => {
      const m = P.geom({ t: T.id, x: 0, y: 0, a: 0, m: true });
      expect(near(m.ends[1].y, -g().ends[1].y)).toBe(true);
    });
  }
  test('all loop pieces share one radius', () => {
    expect(P.TYPES.filter((T) => T.loop).every((T) => T.r === P.LOOP_R)).toBe(true);
  });
  test('nine pieces in the row', () => {
    expect(P.TYPES.length).toBe(9);
  });
});

describe('Edits', () => {
  // a medium ramp added at the finish, then a medium line after it
  function rampAndLine() {
    const d = P.newLevel('t');
    const i = P.append(d, 'ramp2', cursorAt(endAt(d, 0, 1)));
    const e = endAt(d, i, 1);
    const j = P.append(d, 'line2', cursorAt(e));
    return { d, i, e, j };
  }
  test('a new level is the start pad with the finish on its end', () => {
    const start = endAt(P.newLevel('t'), 0, 1);
    expect(near(start.x, 9) && near(start.y, 0)).toBe(true);
  });
  test('adding a piece at the finish moves the finish to the new end', () => {
    const d = P.newLevel('t');
    const i = P.append(d, 'ramp2', cursorAt(endAt(d, 0, 1)));
    const e = endAt(d, i, 1),
      F = P.geom(P.getPiece(d, P.finishIndex(d))).ends[0];
    expect(near(F.x, e.x) && near(F.y, e.y)).toBe(true);
  });
  test("a piece added after a ramp carries on at the ramp's angle", () => {
    const { d, j } = rampAndLine();
    expect(near(P.getPiece(d, j).a, 30)).toBe(true);
  });
  // rotate the line about the ramp's end
  test('rotating turns a piece about the end it hangs from', () => {
    const { d, e, j } = rampAndLine();
    P.rotate(d, j, 15);
    const j0 = endAt(d, j, 0);
    expect(near(j0.x, e.x) && near(j0.y, e.y) && near(P.getPiece(d, j).a, 45)).toBe(true);
  });
  test('the finish stays on the end of a piece that turns', () => {
    const { d, j } = rampAndLine();
    P.rotate(d, j, 15);
    const F2 = P.geom(P.getPiece(d, P.finishIndex(d))).ends[0],
      j1 = endAt(d, j, 1);
    expect(near(F2.x, j1.x) && near(F2.y, j1.y)).toBe(true);
  });
  // flipping the ramp left to right makes a slope down that levels out, still on the start pad's end
  function bigRamp() {
    const d2 = P.newLevel('t'),
      r = P.append(d2, 'ramp3', cursorAt(endAt(d2, 0, 1)));
    return { d2, r };
  }
  test('a ramp flipped left to right hangs from the same end and levels out lower down', () => {
    const { d2, r } = bigRamp();
    P.flip(d2, r, 'h');
    const g = P.geom(P.getPiece(d2, r)),
      lo = g.ends[0].y < g.ends[1].y ? g.ends[0] : g.ends[1],
      hi = lo === g.ends[0] ? g.ends[1] : g.ends[0];
    expect(near(hi.x, 9) && near(hi.y, 0) && lo.y < -2 && near(Math.abs(lo.oy), 0)).toBe(true);
  });
  test('flipping it back gives the ramp again', () => {
    const { d2, r } = bigRamp();
    P.flip(d2, r, 'h');
    P.flip(d2, r, 'h');
    const back = P.geom(P.getPiece(d2, r));
    expect(near(back.ends[0].x, 9) && near(back.ends[0].y, 0) && back.ends[1].y > 2).toBe(true);
  });
  test('a ramp flipped upside down drops away from the same end', () => {
    const { d2, r } = bigRamp();
    P.flip(d2, r, 'h');
    P.flip(d2, r, 'h');
    P.flip(d2, r, 'v');
    const v = P.geom(P.getPiece(d2, r));
    expect(near(v.ends[0].x, 9) && near(v.ends[0].y, 0) && v.ends[1].y < -2).toBe(true);
  });
  // the finish pad only turns round
  test('flipping the finish turns it round on the spot', () => {
    const { d2, r } = bigRamp();
    P.flip(d2, r, 'h');
    P.flip(d2, r, 'h');
    P.flip(d2, r, 'v');
    const before = { ...d2.finish };
    P.flip(d2, P.finishIndex(d2), 'h');
    expect(d2.finish.d === -before.d && near(d2.finish.x, before.x)).toBe(true);
  });
  test('the start pad stays put', () => {
    const { d2 } = bigRamp();
    expect(!P.rotate(d2, 0, 15) && !P.flip(d2, 0, 'h') && !P.remove(d2, 0)).toBe(true);
  });
  // moving snaps an end onto a free end nearby, or puts the piece on the grid
  function movable() {
    const d3 = P.newLevel('t'),
      k = P.append(d3, 'line2', { x: 30, y: 4, dx: 1, dy: 0 });
    d3.finish = { x: 60, y: 0, d: 1 };
    return { d3, k, from: P.getPiece(d3, k) };
  }
  test('a dragged piece snaps onto the end it is dropped near', () => {
    const { d3, k, from } = movable();
    const snapped = P.moveTo(d3, k, from, 9.3 - 30, 0.4 - 4, 1);
    expect(!!snapped && snapped.snapped && near(snapped.piece.x, 9) && near(snapped.piece.y, 0)).toBe(true);
  });
  test('a piece dropped in the open lands on the half metre grid', () => {
    const { d3, k, from } = movable();
    const loose = P.moveTo(d3, k, from, 3.27, 1.11, 1);
    expect(!!loose && !loose.snapped && near(loose.piece.x, 33.5) && near(loose.piece.y, 5)).toBe(true);
  });
  // removing the last piece puts the finish back where it hung from
  test('removing the last piece moves the finish back to the end before it', () => {
    const d4 = chain(['line3', 'loop1']),
      n = d4.pieces.length;
    P.remove(d4, n);
    const F4 = P.geom(P.getPiece(d4, P.finishIndex(d4))).ends[0],
      L4 = endAt(d4, n - 1, 1);
    expect(d4.pieces.length === n - 1 && near(F4.x, L4.x) && near(F4.y, L4.y)).toBe(true);
  });
  // where the track can carry on: a new level ends on the start pad; a closed loop's way out stays open
  test('a new level can be built on from either end of the start pad', () => {
    const o0 = P.openEnds(P.newLevel('t'));
    expect(o0.length === 2 && o0.some((E) => E.i === 0 && E.e === 0) && o0.some((E) => E.i === 0 && E.e === 1)).toBe(
      true,
    );
  });
  test('a closed loop leaves its way out open to build on', () => {
    const d5 = chain(['line2', 'loop3', 'loop1']),
      o5 = P.openEnds(d5),
      out = o5.find((E) => E.i === 3);
    expect(o5.length === 2 && !!out && out.e === 1 && near(out.x, 17) && near(out.ox, 1)).toBe(true);
  });
  // loading cleans up whatever is in storage
  test('saved levels are cleaned up when loaded', () => {
    const s = P.sanitize({
      name: 'x'.repeat(80) + '\u0007',
      pieces: [{ t: 'loop3', x: '3', y: 1e9, a: -15, m: 1 }, { t: 'start' }, { t: 'nope' }, null, 5],
      finish: { x: 'a' },
    });
    expect(
      s.name.length === P.NAME_MAX &&
        s.pieces.length === 1 &&
        s.pieces[0].y === 5000 &&
        s.pieces[0].a === 345 &&
        s.pieces[0].m === true &&
        near(s.finish.x, 9),
    ).toBe(true);
  });
  test(`at most ${P.MAX_PIECES} pieces`, () => {
    const s = P.sanitize({ pieces: Array.from({ length: 900 }, () => ({ t: 'line1', x: 0, y: 0, a: 0 })) });
    expect(s.pieces.length).toBe(P.MAX_PIECES);
  });
  test('the track key follows the track, not the name', () => {
    expect(
      P.trackKey(chain(['line1'])) !== P.trackKey(chain(['line2'])) &&
        P.trackKey(chain(['line1'])) === P.trackKey({ ...chain(['line1']), name: 'other' }),
    ).toBe(true);
  });
});

describe('Riding', () => {
  const BIKES = C.BIKES.map((b) => b.id);
  const LOOPS: [string, PieceTypeId[], [number, number]][] = [
    [
      'a full loop (3/4 + quarter) after a 32 m run-up',
      ['line3', 'line3', 'loop3', 'loop1', 'line3', 'line3'],
      [41 - 4, 41 + 4],
    ],
    ['a full loop straight off the start pad', ['loop3', 'loop1', 'line3', 'line3'], [9 - 4, 9 + 4]],
    ['a full loop from two half loops', ['line3', 'line3', 'loop2', 'loop2', 'line3', 'line3'], [41 - 4, 41 + 4]],
    [
      'two full loops back to back',
      ['line3', 'line3', 'loop3', 'loop1', 'loop3', 'loop1', 'line3', 'line3'],
      [41 - 4, 41 + 4],
    ],
  ];
  for (const [name, types, watch] of LOOPS)
    for (const bike of BIKES)
      for (const rider of Object.keys(RIDERS)) {
        const r = once(() => ride(chain(types), bike, rider, watch));
        test(`${name}: ${bike} (${rider}) goes over the top and finishes`, () => {
          expect(r().b.finished && r().maxY > 2 * P.LOOP_R - 1.2, r().why).toBe(true);
        });
        test(`${name}: ${bike} (${rider}) keeps its head clear of the track`, () => {
          expect(r().room, `${r().room.toFixed(2)} m clear`).toBeGreaterThan(0.8);
        });
      }

  // the pass-through is what makes a closed loop work: with every stretch solid, the way out blocks the way in
  test('a closed loop has stretches that take turns, switching inside the loop', () => {
    const level = P.buildCustomLevel(chain(['line3', 'line3', 'loop3', 'loop1', 'line3', 'line3']));
    expect(
      level.ghosts.segs.length > 0 && level.ghosts.bounds.every((v) => v > 41 && v < 41 + 2 * Math.PI * P.LOOP_R),
      `${level.ghosts.segs.length} stretches`,
    ).toBe(true);
  });
  test("without them the bike can't get through the loop", () => {
    const level = P.buildCustomLevel(chain(['line3', 'line3', 'loop3', 'loop1', 'line3', 'line3']));
    level.ghosts.segs = [];
    const sim = new C.Sim(level),
      b = sim.addBike('scout');
    b.running = true;
    for (let k = 0; k < 120 * 20 && !b.finished && !b.crashed; k++) {
      b.input = { gas: 1, brake: 0, lean: 0 };
      sim.step();
    }
    expect(b.finished).toBe(false);
  });
  test('a track that never comes back on itself has none', () => {
    const open = P.buildCustomLevel(chain(['line3', 'ramp2', 'line3', 'loop1']));
    expect(open.ghosts.segs.length).toBe(0);
  });

  // a finish turned round is crossed going left: back up into it from the start
  test('a finish facing left is crossed backing up', () => {
    const d = P.newLevel('t');
    d.finish = { x: -3, y: 0, d: -1 };
    const level = P.buildCustomLevel(d),
      sim = new C.Sim(level),
      b = sim.addBike('scout');
    b.running = true;
    for (let k = 0; k < 120 * 20 && !b.finished && !b.crashed; k++) {
      b.input = { gas: 0, brake: 1, lean: 0 };
      sim.step();
    }
    expect(
      b.finished && near(level.finishX, -6) && b.c.x < -6,
      b.finished ? b.finishTime.toFixed(2) + ' s' : 'not finished',
    ).toBe(true);
  });
  test('the finish knows its height and which way it faces', () => {
    const below = P.buildCustomLevel(chain(['line3', 'loop2', 'loop2', 'line3']));
    expect(below.finishY === 0 && below.finishDir === 1).toBe(true);
  });

  for (const t of ['ramp1', 'ramp2', 'ramp3'] as const) {
    const gap = { ramp1: 5, ramp2: 9, ramp3: 12 }[t];
    // the computer rider, which lines the bike up with the landing (a rider who never leans lands a big jump on the back wheel)
    for (const bike of BIKES)
      for (const rider of ['bot'])
        test(`${P.TYPE[t].name}: ${bike} (${rider}) clears a ${gap} m gap and finishes`, () => {
          const r = ride(chain(['line3', 'line3', t, 'gap', 'line3', 'line3'], { gap }), bike, rider);
          expect(
            r.b.finished && !!r.air && r.air.d > gap - 1,
            `${r.air ? r.air.d.toFixed(1) + ' m in the air' : 'no jump'} and ${r.why}`,
          ).toBe(true);
        });
  }
});
