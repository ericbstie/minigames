// Ant Sort's rules (public/js/ant-sort-logic.ts) and its levels (public/js/ant-sort-levels.json): every level loads
// into a Sim with sane counts and can be won, and the moves, the ants' order, being stuck and winning work, and a
// position saved part way through a level comes back as it was.
import { describe, expect, test } from 'bun:test';
import {
  type Chunk,
  EMPTY,
  SLOTS,
  Sim,
  type SimLevel,
  type SimSave,
  simFromSave,
  simLevel,
  simSave,
} from '../public/js/ant-sort-logic';
import { LEVELS, loseFast, solve, startOf } from './ant-sort-solve';

/** A small level: a picture given as rows of colour digits ('.' for no block), and its three columns */
function tiny(rows: string[], columns: [c: number, n: number][][]): SimLevel {
  const grid = rows.flatMap((r) => [...r].map((ch) => (ch === '.' ? EMPTY : Number(ch))));
  const ncolors = Math.max(...grid.filter((v) => v !== EMPTY)) + 1;
  return {
    W: rows[0]!.length,
    H: rows.length,
    grid,
    ncolors,
    columns: columns.map((q) => q.map(([c, n]) => ({ c, n }))),
  };
}
/** The padded cell index of picture cell x, y */
const at = (sim: Sim, x: number, y: number) => (y + 1) * sim.PW + x + 1;
const neighbours = (sim: Sim, p: number) => [p - 1, p + 1, p - sim.PW, p + sim.PW];

describe('the levels', () => {
  test('there are 20, with different names', () => {
    expect(LEVELS).toHaveLength(20);
    expect(new Set(LEVELS.map((L) => L.name)).size).toBe(20);
  });

  for (const [i, L] of LEVELS.entries()) {
    test(`${i + 1} ${L.name} is well formed and loads into a Sim`, () => {
      expect(L.grid).toHaveLength(L.W * L.H);
      for (const hex of L.palette) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
      for (const v of L.grid) expect(v === EMPTY || (v >= 0 && v < L.palette.length)).toBe(true);
      expect(L.columns).toHaveLength(3);
      // the blocks in the columns ask for exactly the picture's blocks of each colour
      const inPicture = L.palette.map((_, c) => L.grid.filter((v) => v === c).length);
      const asked = L.palette.map(() => 0);
      for (const q of L.columns)
        for (const [c, n] of q) {
          expect(c >= 0 && c < L.palette.length && n > 0).toBe(true);
          asked[c]! += n;
        }
      expect(asked).toEqual(inPicture);

      const sim = startOf(i);
      expect([sim.W, sim.H, sim.PW, sim.PH, sim.ncolors]).toEqual([L.W, L.H, L.W + 2, L.H + 2, L.palette.length]);
      expect(sim.remaining).toBe(L.grid.filter((v) => v !== EMPTY).length);
      expect(sim.queueLeft()).toBe(L.columns.reduce((n, q) => n + q.length, 0));
      expect(sim.slots).toEqual(new Array(SLOTS).fill(null));
      expect(sim.colPtr).toEqual([0, 0, 0]);
      expect(sim.won() || sim.stuck()).toBe(false);
      for (let col = 0; col < 3; col++)
        expect(sim.front(col)).toEqual({ c: L.columns[col]![0]![0], n: L.columns[col]![0]![1] });
      // the ants can reach exactly the blocks that touch the outside, each in its own colour's list
      let reachable = 0;
      for (let p = 0; p < sim.cell.length; p++) {
        if (sim.cell[p] === EMPTY) continue;
        const touches = neighbours(sim, p).some((q) => sim.out[q]);
        expect(!!sim.reach[p]).toBe(touches);
        if (touches) reachable++;
      }
      for (let c = 0; c < sim.ncolors; c++) for (const p of sim.heaps[c]!) expect(sim.cell[p]).toBe(c);
      expect(sim.heaps.reduce((n, h) => n + h.length, 0)).toBe(reachable);
    });
  }

  test('every level can be won', () => {
    for (const [i, L] of LEVELS.entries()) {
      const taps = solve(startOf(i));
      expect(taps, L.name).not.toBeNull();
      // replay the taps: each one is allowed, and the last clears the picture
      const sim = startOf(i);
      for (const col of taps!) {
        expect(sim.canPop(col)).toBe(true);
        sim.pop(col);
        sim.settle();
        if (!sim.won()) expect(sim.stuck()).toBe(false);
      }
      expect(sim.won()).toBe(true);
      expect(sim.remaining).toBe(0);
    }
  });

  test('level 1 can be lost too: eight taps fill the slots with colours the ants cannot reach', () => {
    const taps = loseFast(startOf(0))!;
    expect(taps).toHaveLength(8);
    const sim = startOf(0);
    for (const col of taps) {
      sim.pop(col);
      sim.settle();
    }
    expect(sim.stuck()).toBe(true);
    expect(sim.freeSlot()).toBe(-1);
    expect(sim.slots.every((s) => s && s.n > 0 && sim.reachable(s.c) === 0)).toBe(true);
  });
});

describe('the Sim', () => {
  // 0 0 0
  // 0 1 0    a ring of colour 0 around one block of colour 1
  // 0 0 0
  const ring = () => tiny(['000', '010', '000'], [[[1, 1]], [[0, 8]], [[1, 1]]]);

  test('a tap puts the front block of a column on the first free slot', () => {
    const sim = new Sim(ring());
    expect(sim.canPop(1)).toBe(true);
    expect(sim.pop(1)).toBe(0);
    expect(sim.slots[0]).toEqual({ c: 0, n: 8 });
    expect(sim.colPtr).toEqual([0, 1, 0]);
    expect(sim.front(1)).toBeNull();
    expect(sim.canPop(1)).toBe(false);
    expect(sim.pop(1)).toBe(-1);
    expect(sim.pop(0)).toBe(1);
    expect(sim.queueLeft()).toBe(1);
  });

  test('each tick sends one ant from each slot, for the reachable block nearest the bottom centre', () => {
    const sim = new Sim(ring());
    sim.pop(1);
    expect(sim.quiet()).toBe(false);
    const first = sim.tick();
    // the middle of the bottom row is closest to where the ants come in
    expect(first).toEqual([{ slot: 0, p: at(sim, 1, 2), c: 0, left: 7 }]);
    expect(sim.cell[at(sim, 1, 2)]).toBe(EMPTY);
    expect(sim.out[at(sim, 1, 2)]).toBe(1);
    expect(sim.remaining).toBe(8);
    // taking it opened the way to the centre block
    expect(sim.reachable(1)).toBe(1);
    // then the bottom corners, before anything higher up
    const next = [sim.tick()[0]!.p, sim.tick()[0]!.p].sort((a, b) => a - b);
    expect(next).toEqual([at(sim, 0, 2), at(sim, 2, 2)]);
  });

  test('a slot empties when its ants have fetched every block, and the level is won when the picture is gone', () => {
    const sim = new Sim(ring());
    sim.pop(1);
    expect(sim.settle()).toBe(8);
    expect(sim.slots[0]).toBeNull();
    expect(sim.won()).toBe(false);
    sim.pop(0);
    expect(sim.settle()).toBe(1);
    expect(sim.won()).toBe(true);
    expect(sim.stuck()).toBe(false);
    expect([...sim.cell].every((v) => v === EMPTY)).toBe(true);
  });

  test('several slots send their ants in the same tick', () => {
    const sim = new Sim(tiny(['0101'], [[[0, 2]], [[1, 2]], []]));
    sim.pop(0);
    sim.pop(1);
    const ev = sim.tick();
    expect(ev.map((e) => [e.slot, e.c])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(sim.remaining).toBe(2);
  });

  test('it is stuck when every slot holds a colour the ants cannot reach', () => {
    const centre: [number, number] = [1, 1];
    const sim = new Sim(tiny(['000', '010', '000'], [[centre, centre, centre], [centre], [centre, [0, 8]]]));
    for (const col of [0, 0, 0, 1, 2]) sim.pop(col);
    expect(sim.freeSlot()).toBe(-1);
    expect(sim.quiet()).toBe(true);
    expect(sim.stuck()).toBe(true);
    // the ring block (colour 0) waits in the last column with no slot to go to
    expect(sim.canPop(2)).toBe(false);
  });

  test('a clone moves on without changing the original', () => {
    const sim = new Sim(ring());
    const copy = sim.clone();
    copy.pop(1);
    copy.settle();
    expect(copy.remaining).toBe(1);
    expect(sim.remaining).toBe(9);
    expect(sim.colPtr).toEqual([0, 0, 0]);
    expect(sim.slots.every((s: Chunk | null) => s === null)).toBe(true);
    expect([...sim.cell].filter((v) => v !== EMPTY)).toHaveLength(9);
  });

  test('paths go around the picture, one step at a time, over cells without blocks', () => {
    const sim = new Sim(tiny(['000', '0.0', '000'], [[], [], []]));
    // the hole in the middle is walled in, so it is not outside
    expect(sim.out[at(sim, 1, 1)]).toBe(0);
    const from = at(sim, -1, 3); // bottom left corner of the tray margin
    const to = at(sim, 3, -1); // top right corner
    const path = sim.path(from, (c) => c === to);
    expect(path[0]).toBe(from);
    expect(path.at(-1)).toBe(to);
    expect(path).toHaveLength(1 + 8); // around the outside: four up, four across
    for (let k = 1; k < path.length; k++) {
      expect(neighbours(sim, path[k - 1]!)).toContain(path[k]!);
      expect(sim.out[path[k]!]).toBe(1);
    }
    // a goal it cannot reach leaves the path where it started
    expect(sim.path(from, (c) => c === at(sim, 1, 1))).toEqual([from]);
  });

  test('levels convert from their JSON form', () => {
    const L = LEVELS[0]!;
    const level = simLevel(L);
    expect(level.grid).toBeInstanceOf(Uint8Array);
    expect(Array.from(level.grid)).toEqual(L.grid);
    expect(level.ncolors).toBe(L.palette.length);
    expect(level.columns[0]![0]).toEqual({ c: L.columns[0]![0]![0], n: L.columns[0]![0]![1] });
  });
});

describe('a saved position', () => {
  // what decides a Sim's next steps, to compare: the heaps hold the same blocks in an order that depends on how they
  // got there, and whether a block already taken had been reachable no longer matters
  const position = (sim: Sim) => ({
    cell: [...sim.cell],
    out: [...sim.out],
    reach: [...sim.reach].map((r, i) => (sim.cell[i] === EMPTY ? 0 : r)),
    heaps: sim.heaps.map((h) => h.slice().sort((a, b) => a - b)),
    remaining: sim.remaining,
    slots: sim.slots,
    colPtr: sim.colPtr,
  });

  test('a level just started saves every block, no column moved on and empty slots', () => {
    const L = LEVELS[0]!;
    const saved = simSave(startOf(0));
    expect(saved.board).toBe(L.grid.map((v) => (v === EMPTY ? '0' : '1')).join(''));
    expect(saved.columns).toEqual([0, 0, 0]);
    expect(saved.slots).toEqual(new Array(SLOTS).fill(null));
    expect(position(simFromSave(simLevel(L), saved)!)).toEqual(position(startOf(0)));
  });

  test('every level comes back from a save after any tap as it was, and plays on to the same end', () => {
    for (const [i, L] of LEVELS.entries()) {
      const taps = solve(startOf(i))!;
      const sim = startOf(i);
      for (const [k, col] of taps.entries()) {
        sim.pop(col);
        // the ants part way through fetching what they can reach, as a reload might find them
        for (let n = 0; n < k % 4; n++) sim.tick();
        const back = simFromSave(simLevel(L), JSON.parse(JSON.stringify(simSave(sim))) as SimSave);
        expect(back, `${L.name}, tap ${k + 1}`).not.toBeNull();
        expect(position(back!)).toEqual(position(sim));
        // from there both take the same steps
        sim.settle();
        back!.settle();
        expect(position(back!)).toEqual(position(sim));
      }
      expect(sim.won()).toBe(true);
    }
  });

  test('a lost level comes back stuck', () => {
    const sim = startOf(0);
    for (const col of loseFast(startOf(0))!) {
      sim.pop(col);
      sim.settle();
    }
    const back = simFromSave(simLevel(LEVELS[0]!), simSave(sim))!;
    expect(back.stuck()).toBe(true);
  });

  test("a save that can't be a position of the level is refused", () => {
    // the ring again, with the second block of colour 1 left out of the columns, so they send ants for every block once
    const level = () => tiny(['000', '010', '000'], [[[1, 1]], [[0, 8]], []]);
    const fresh = simSave(new Sim(level()));
    const sent = new Sim(level());
    sent.pop(1); // the ring's colour goes to a slot, and the ants take three blocks of it
    for (let n = 0; n < 3; n++) sent.tick();
    const part = simSave(sent);
    expect(part).toEqual({ board: '111111000', columns: [0, 1, 0], slots: [{ c: 0, n: 5 }, null, null, null, null] });
    expect(simFromSave(level(), part)).not.toBeNull();
    const bad: [string, SimSave][] = [
      ['a board of the wrong size', { ...fresh, board: '11111111' }],
      ['a board with other characters', { ...fresh, board: '1111x1111' }],
      ['a column run past its end', { ...fresh, columns: [2, 0, 0] }],
      ['a column at a place that is no whole number', { ...fresh, columns: [0.5, 0, 0] }],
      ['too few columns', { ...fresh, columns: [0, 0] }],
      ['too few slots', { ...fresh, slots: [null, null, null, null] }],
      ['a colour the level does not have on a slot', { ...part, slots: [{ c: 2, n: 5 }, null, null, null, null] }],
      ['a slot with nothing left to fetch', { ...part, slots: [{ c: 0, n: 0 }, null, null, null, null] }],
      ['more ants owed than blocks left', { ...part, slots: [{ c: 0, n: 6 }, null, null, null, null] }],
      ['blocks gone that no slot fetched', { ...fresh, board: '111111000' }],
      ['a column moved on with nothing on the slots', { ...fresh, columns: [0, 1, 0] }],
    ];
    for (const [why, save] of bad) expect(simFromSave(level(), save), why).toBeNull();
    // a block where the picture has none
    const gap = () => tiny(['0.0'], [[[0, 2]], [], []]);
    expect(simFromSave(gap(), simSave(new Sim(gap())))).not.toBeNull();
    expect(simFromSave(gap(), { ...simSave(new Sim(gap())), board: '111' })).toBeNull();
  });
});
