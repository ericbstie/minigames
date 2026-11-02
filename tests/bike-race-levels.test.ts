// Every Bike Race bike can finish every built-in level, ridden by the computer rider in each of its seven riding
// styles (tools/bike-levels.ts), so no level depends on one exact riding line. tools/check-bike-levels.ts prints
// the times as a table and suggests par times.
import { describe, expect, test } from 'bun:test';
import { BIKES, WORLDS } from '../public/js/bike-race-core';
import { ride, STYLES } from '../tools/bike-levels';

for (const w of WORLDS)
  describe(w.name, () => {
    for (const L of w.levels)
      for (const b of BIKES)
        test(`${L.id} ${L.name}: ${b.name} finishes in all ${STYLES.length} riding styles`, () => {
          const failed = STYLES.flatMap((cfg) => {
            const r = ride(w, L, b.id, cfg);
            return r.why ? [`style ${JSON.stringify(cfg)}: ${r.why}`] : [];
          });
          expect(failed).toEqual([]);
        });
  });
