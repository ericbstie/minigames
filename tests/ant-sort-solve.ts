// A winning order of taps for an Ant Sort level, for the tests: which column's front block to tap each time the ants
// have fetched everything they can reach. Depth first, trying blocks the ants can fetch in full first.
import { type LevelData, Sim, simLevel } from '../public/js/ant-sort-logic';
import data from '../public/js/ant-sort-levels.json';

export const LEVELS = (data as { levels: LevelData[] }).levels;

/** The columns to tap in order (each tap waits for the ants to settle), or null if none is found within the budget */
export function solve(sim: Sim, budget = { nodes: 200_000 }): number[] | null {
  if (sim.won()) return [];
  if (sim.stuck() || --budget.nodes < 0) return null;
  const full = (col: number) => {
    const f = sim.front(col)!;
    const r = sim.reachable(f.c);
    return r >= f.n ? 2 : r > 0 ? 1 : 0;
  };
  const cols = sim.columns.map((_, i) => i).filter((i) => sim.canPop(i));
  cols.sort((a, b) => full(b) - full(a));
  for (const col of cols) {
    const next = sim.clone();
    next.pop(col);
    next.settle();
    const rest = solve(next, budget);
    if (rest) return [col, ...rest];
  }
  return null;
}

/** The shortest run of taps that fills every slot with blocks the ants can't reach (a lost level) */
export function loseFast(sim: Sim, depth = 8): number[] | null {
  for (let d = 1; d <= depth; d++) {
    const found = search(sim, d);
    if (found) return found;
  }
  return null;
}
function search(sim: Sim, d: number): number[] | null {
  if (sim.stuck()) return [];
  if (d === 0 || sim.won()) return null;
  for (let col = 0; col < sim.columns.length; col++) {
    if (!sim.canPop(col)) continue;
    const next = sim.clone();
    next.pop(col);
    next.settle();
    const rest = search(next, d - 1);
    if (rest) return [col, ...rest];
  }
  return null;
}

export const startOf = (i: number) => new Sim(simLevel(LEVELS[i]!));
