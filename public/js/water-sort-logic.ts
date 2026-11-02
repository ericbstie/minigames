// Water Sort rules and solver. Shared by the level generator, the game and its tests.
// A state is an array of tubes; a tube is an array of colour indices, bottom first.
export type Tube = number[];
export type State = Tube[];
/** A pour: from tube a to tube b */
export type Move = [a: number, b: number];
/** A level: how many colours it uses, and its tubes at the start */
export interface Level {
  colors: number;
  tubes: State;
}

export const WS_CAP = 4;
const wsTop = (t: Tube) => t[t.length - 1];
export function wsCanPour(s: State, a: number, b: number): boolean {
  const A = s[a],
    B = s[b];
  if (a === b || !A.length || B.length >= WS_CAP) return false;
  return !B.length || wsTop(A) === wsTop(B);
}
// how many units of the top colour run move from a to b
export function wsPourCount(s: State, a: number, b: number): number {
  const A = s[a],
    c = wsTop(A);
  let n = 0;
  for (let i = A.length - 1; i >= 0 && A[i] === c; i--) n++;
  return Math.min(n, WS_CAP - s[b].length);
}
export function wsApply(s: State, a: number, b: number): State {
  const n = wsPourCount(s, a, b),
    c = wsTop(s[a]),
    out = s.map((t) => t.slice());
  for (let i = 0; i < n; i++) {
    out[a].pop();
    out[b].push(c);
  }
  return out;
}
export const wsUniform = (t: Tube) => t.every((c) => c === t[0]);
export const wsDone = (t: Tube) => t.length === 0 || (t.length === WS_CAP && wsUniform(t));
export const wsSolved = (s: State) => s.every(wsDone);
export const wsKey = (s: State) =>
  s
    .map((t) => t.join(','))
    .sort()
    .join('|');
// moves worth considering: never pour a finished tube, never pour a one-colour tube into an empty one
export function wsMoves(s: State): [a: number, b: number, score: number][] {
  const out: [number, number, number][] = [];
  for (let a = 0; a < s.length; a++) {
    const A = s[a];
    if (!A.length || wsDone(A)) continue;
    let emptyTried = false;
    for (let b = 0; b < s.length; b++) {
      if (!wsCanPour(s, a, b)) continue;
      const B = s[b];
      if (!B.length) {
        if (wsUniform(A) || emptyTried) continue;
        emptyTried = true;
      }
      const n = wsPourCount(s, a, b);
      let score = B.length ? 10 : 0;
      if (B.length + n === WS_CAP && wsUniform(B)) score += 20;
      if (n === A.length) score += 5; // empties the source
      if (n < runLength(A)) score -= 8; // splits a run
      out.push([a, b, score]);
    }
  }
  out.sort((x, y) => y[2] - x[2]);
  return out;
}
function runLength(A: Tube) {
  const c = wsTop(A);
  let n = 0;
  for (let i = A.length - 1; i >= 0 && A[i] === c; i--) n++;
  return n;
}
// depth-first search with a visited set; returns a list of [from, to] moves or null
export function wsSolve(start: State, maxNodes = 400000): Move[] | null {
  const seen = new Set<string>(),
    path: Move[] = [];
  let nodes = 0;
  const dfs = (s: State): boolean => {
    if (wsSolved(s)) return true;
    if (++nodes > maxNodes) return false;
    const k = wsKey(s);
    if (seen.has(k)) return false;
    seen.add(k);
    for (const [a, b] of wsMoves(s)) {
      path.push([a, b]);
      if (dfs(wsApply(s, a, b))) return true;
      path.pop();
      if (nodes > maxNodes) return false;
    }
    return false;
  };
  const ok = dfs(start);
  return ok ? path.slice() : null;
}

// The built-in levels, from the level generator
// prettier-ignore
export const LEVELS: Level[] = [
  { colors: 3, tubes: [[2, 1, 1, 0], [2, 1, 0, 0], [2, 1, 2, 0], [], []] },
  { colors: 4, tubes: [[3, 1, 2, 3], [0, 1, 2, 0], [1, 0, 3, 1], [0, 2, 3, 2], [], []] },
  { colors: 4, tubes: [[0, 2, 1, 0], [3, 1, 1, 2], [3, 1, 2, 0], [0, 2, 3, 3], [], []] },
  { colors: 5, tubes: [[3, 4, 0, 2], [2, 0, 1, 1], [3, 4, 4, 0], [3, 0, 1, 2], [1, 4, 3, 2], [], []] },
  { colors: 5, tubes: [[0, 1, 0, 3], [0, 4, 2, 1], [0, 1, 4, 3], [2, 3, 2, 4], [3, 1, 4, 2], [], []] },
  { colors: 6, tubes: [[4, 4, 1, 1], [3, 3, 2, 5], [5, 2, 0, 2], [1, 0, 0, 5], [5, 4, 0, 3], [3, 4, 2, 1], [], []] },
  { colors: 6, tubes: [[3, 0, 5, 1], [3, 4, 1, 2], [2, 4, 2, 3], [4, 5, 1, 2], [0, 4, 5, 3], [1, 0, 5, 0], [], []] },
  { colors: 7, tubes: [[5, 6, 3, 1], [5, 0, 6, 3], [4, 5, 1, 0], [2, 0, 5, 2], [6, 6, 2, 4], [3, 4, 3, 4], [1, 0, 2, 1], [], []] },
  { colors: 7, tubes: [[3, 3, 2, 6], [1, 2, 5, 1], [5, 3, 4, 6], [3, 2, 6, 5], [2, 0, 4, 0], [1, 6, 4, 4], [1, 0, 0, 5], [], []] },
  { colors: 8, tubes: [[6, 1, 4, 0], [6, 0, 1, 5], [4, 7, 5, 7], [6, 1, 3, 3], [5, 1, 7, 7], [2, 0, 4, 2], [5, 2, 3, 4], [3, 6, 2, 0], [], []] },
  { colors: 8, tubes: [[5, 3, 1, 0], [6, 3, 0, 4], [4, 3, 4, 5], [2, 5, 2, 1], [1, 7, 0, 2], [7, 6, 0, 4], [6, 6, 2, 5], [3, 7, 7, 1], [], []] },
  { colors: 9, tubes: [[3, 6, 1, 0], [0, 2, 1, 8], [1, 5, 4, 2], [7, 8, 3, 3], [0, 4, 7, 7], [6, 2, 3, 0], [5, 7, 2, 1], [6, 8, 8, 5], [6, 5, 4, 4], [], []] },
  { colors: 9, tubes: [[7, 3, 0, 3], [6, 1, 5, 4], [4, 8, 5, 7], [3, 1, 2, 8], [0, 2, 7, 5], [6, 4, 1, 3], [7, 8, 0, 4], [1, 0, 2, 6], [6, 2, 8, 5], [], []] },
  { colors: 10, tubes: [[2, 3, 1, 2], [9, 8, 1, 7], [2, 9, 3, 5], [1, 4, 0, 5], [0, 4, 7, 3], [8, 5, 7, 4], [6, 6, 0, 2], [8, 6, 5, 3], [1, 8, 4, 7], [9, 0, 9, 6], [], []] },
  { colors: 10, tubes: [[5, 1, 1, 8], [5, 7, 2, 9], [9, 4, 6, 9], [7, 1, 9, 1], [2, 8, 4, 6], [8, 5, 3, 0], [4, 3, 0, 2], [7, 0, 5, 6], [0, 8, 4, 3], [6, 3, 7, 2], [], []] },
  { colors: 10, tubes: [[4, 8, 0, 3], [2, 6, 8, 5], [9, 1, 1, 4], [2, 4, 4, 7], [1, 0, 5, 6], [8, 3, 8, 9], [0, 7, 6, 2], [2, 5, 3, 1], [7, 5, 0, 7], [9, 3, 6, 9], [], []] },
  { colors: 11, tubes: [[5, 7, 2, 6], [0, 3, 2, 6], [1, 8, 4, 2], [10, 3, 1, 4], [3, 6, 10, 10], [7, 3, 9, 8], [0, 1, 1, 6], [2, 0, 7, 10], [8, 5, 0, 9], [4, 7, 5, 8], [9, 4, 5, 9], [], []] },
  { colors: 11, tubes: [[10, 8, 1, 8], [1, 3, 9, 2], [5, 6, 6, 0], [5, 0, 4, 2], [7, 3, 5, 8], [9, 4, 2, 10], [5, 1, 9, 4], [6, 4, 9, 0], [8, 6, 2, 10], [3, 7, 7, 1], [3, 7, 10, 0], [], []] },
  { colors: 11, tubes: [[2, 9, 8, 1], [4, 0, 8, 1], [10, 1, 3, 8], [0, 9, 10, 9], [6, 10, 4, 7], [0, 0, 6, 7], [2, 1, 5, 9], [4, 3, 7, 4], [5, 3, 6, 7], [2, 6, 2, 5], [8, 10, 3, 5], [], []] },
  { colors: 11, tubes: [[2, 0, 5, 5], [6, 1, 4, 3], [9, 6, 3, 2], [8, 8, 9, 0], [5, 2, 8, 7], [3, 1, 6, 7], [0, 10, 9, 1], [4, 10, 2, 4], [6, 10, 4, 10], [9, 0, 3, 1], [8, 5, 7, 7], [], []] },
];
