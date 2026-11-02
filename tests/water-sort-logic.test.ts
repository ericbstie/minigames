// Water Sort's rules and solver (public/js/water-sort-logic.ts): pouring, finished tubes, the moves the solver tries,
// that the solver clears every built-in level with moves the rules allow, and which saved positions fit a level.
import { describe, expect, test } from 'bun:test';
import {
  LEVELS,
  type State,
  WS_CAP,
  wsApply,
  wsCanPour,
  wsDone,
  wsFits,
  wsKey,
  wsMoves,
  wsPourCount,
  wsSolve,
  wsSolved,
  wsUniform,
} from '../public/js/water-sort-logic';

describe('pouring', () => {
  const s: State = [[0, 1, 1], [2, 1], [], [0, 0, 0, 0], [3]];

  test('pours onto the same colour or into an empty tube, never into a full one or onto another colour', () => {
    expect(wsCanPour(s, 0, 1)).toBe(true); // 1 onto 1
    expect(wsCanPour(s, 0, 2)).toBe(true); // into the empty tube
    expect(wsCanPour(s, 0, 4)).toBe(false); // 1 onto 3
    expect(wsCanPour(s, 1, 3)).toBe(false); // into a full tube
    expect(wsCanPour(s, 2, 0)).toBe(false); // from an empty tube
    expect(wsCanPour(s, 0, 0)).toBe(false); // into itself
  });

  test('the whole run of the top colour moves, as far as there is room', () => {
    expect(wsPourCount(s, 0, 2)).toBe(2);
    expect(wsPourCount(s, 0, 1)).toBe(2);
    expect(
      wsPourCount(
        [
          [1, 1, 1],
          [0, 0, 1],
        ],
        0,
        1,
      ),
    ).toBe(1);
    expect(wsPourCount(s, 3, 2)).toBe(WS_CAP);
  });

  test('a pour makes a new state and leaves the old one alone', () => {
    const before = JSON.stringify(s);
    expect(wsApply(s, 0, 1)).toEqual([[0], [2, 1, 1, 1], [], [0, 0, 0, 0], [3]]);
    expect(
      wsApply(
        [
          [1, 1, 1],
          [0, 0, 1],
        ],
        0,
        1,
      ),
    ).toEqual([
      [1, 1],
      [0, 0, 1, 1],
    ]);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('finished tubes', () => {
  test('a tube is done when it is empty or full of one colour', () => {
    expect(wsDone([])).toBe(true);
    expect(wsDone([2, 2, 2, 2])).toBe(true);
    expect(wsDone([2, 2, 2])).toBe(false);
    expect(wsDone([2, 2, 1, 2])).toBe(false);
    expect(wsUniform([5, 5])).toBe(true);
    expect(wsUniform([5, 4])).toBe(false);
  });

  test('a state is solved when every tube is done', () => {
    expect(wsSolved([[0, 0, 0, 0], [], [1, 1, 1, 1]])).toBe(true);
    expect(wsSolved([[0, 0, 0, 0], [1], [1, 1, 1]])).toBe(false);
  });

  test('the key ignores the order of the tubes', () => {
    expect(wsKey([[0, 1], [], [2]])).toBe(wsKey([[2], [0, 1], []]));
    expect(wsKey([[0, 1], [], [2]])).not.toBe(wsKey([[1, 0], [], [2]]));
  });
});

describe('the solver', () => {
  test('never pours a finished tube, nor a one-colour tube into an empty one, and tries one empty tube only', () => {
    const s: State = [[1, 1, 1, 1], [2, 2, 2], [0, 2], [], []];
    const moves = wsMoves(s);
    for (const [a, b] of moves) expect(wsCanPour(s, a, b)).toBe(true);
    expect(moves.some(([a]) => a === 0)).toBe(false); // finished
    expect(moves.some(([a, b]) => a === 1 && s[b]!.length === 0)).toBe(false); // one colour into an empty tube
    expect(moves.filter(([a, b]) => a === 2 && s[b]!.length === 0)).toHaveLength(1);
    // best first: the pour that finishes the tube of 2s
    expect(moves[0]!.slice(0, 2)).toEqual([2, 1]);
    for (let i = 1; i < moves.length; i++) expect(moves[i - 1]![2]).toBeGreaterThanOrEqual(moves[i]![2]);
  });

  test('gives up on a state with no way forward', () => {
    expect(
      wsSolve([
        [0, 1, 0, 1],
        [1, 0, 1, 0],
      ]),
    ).toBeNull();
    expect(wsSolve([[0, 0, 0, 0], []])).toEqual([]);
  });

  test('stops at its node budget', () => {
    expect(wsSolve(LEVELS[19]!.tubes, 3)).toBeNull();
  });
});

describe('the levels', () => {
  test('there are 20, getting harder', () => {
    expect(LEVELS).toHaveLength(20);
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i]!.colors).toBeGreaterThanOrEqual(LEVELS[i - 1]!.colors);
  });

  for (const [i, L] of LEVELS.entries()) {
    test(`level ${i + 1} has each of its ${L.colors} colours ${WS_CAP} times, two empty tubes, and can be solved`, () => {
      expect(L.colors).toBeLessThanOrEqual(11); // the game has eleven colours
      expect(L.tubes).toHaveLength(L.colors + 2);
      expect(L.tubes.filter((t) => t.length === 0)).toHaveLength(2);
      expect(L.tubes.every((t) => t.length === 0 || t.length === WS_CAP)).toBe(true);
      const count = new Array<number>(L.colors).fill(0);
      for (const t of L.tubes) for (const c of t) count[c]!++;
      expect(count).toEqual(new Array(L.colors).fill(WS_CAP));
      expect(wsSolved(L.tubes)).toBe(false);

      const moves = wsSolve(L.tubes);
      expect(moves).not.toBeNull();
      let s = L.tubes;
      for (const [a, b] of moves!) {
        expect(wsCanPour(s, a, b)).toBe(true);
        s = wsApply(s, a, b);
      }
      expect(wsSolved(s)).toBe(true);
    });
  }

  test('the hint search (80000 nodes) finds a first move from the start of every level', () => {
    for (const L of LEVELS) expect(wsSolve(L.tubes, 80000)?.length).toBeGreaterThan(0);
  });
});

describe('a saved position', () => {
  const L = LEVELS[0]!; // [[2, 1, 1, 0], [2, 1, 0, 0], [2, 1, 2, 0], [], []]

  test('the start of every level fits it, with the spare tube out or not, and so does every step to the end', () => {
    for (const level of LEVELS) {
      expect(wsFits(level, level.tubes, false)).toBe(true);
      expect(wsFits(level, [...level.tubes, []], true)).toBe(true);
      let s = level.tubes;
      for (const [a, b] of wsSolve(level.tubes)!) {
        s = wsApply(s, a, b);
        expect(wsFits(level, s, false)).toBe(true);
      }
    }
  });

  test("a position that can't come from the level doesn't fit it", () => {
    const bad: [string, State, boolean][] = [
      ['a tube missing', L.tubes.slice(1), false],
      ['a tube too many', [...L.tubes, []], false],
      ['the spare tube said to be out but not there', L.tubes, true],
      ['a tube holding more than four', [[2, 1, 1, 0, 0], [2, 1, 0], [2, 1, 2, 0], [], []], false],
      ['a colour the level does not have', [[2, 1, 1, 3], [2, 1, 0, 0], [2, 1, 2, 0], [], []], false],
      ['one colour too many and another too few', [[2, 1, 1, 1], [2, 1, 0, 0], [2, 1, 2, 0], [], []], false],
      ['a colour missing', [[2, 1, 1], [2, 1, 0, 0], [2, 1, 2, 0], [], []], false],
      ['a colour that is no whole number', [[2, 1, 1, 0.5], [2, 1, 0, 0], [2, 1, 2, 0], [], []], false],
      ['a negative colour', [[2, 1, 1, -1], [2, 1, 0, 0], [2, 1, 2, 0], [], []], false],
    ];
    for (const [why, s, spare] of bad) expect(wsFits(L, s, spare), why).toBe(false);
  });
});
