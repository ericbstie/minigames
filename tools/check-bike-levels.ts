// Runs the computer rider through every Bike Race level on every bike and prints the times, or where it
// crashed. Exits with an error if any bike can't finish any level.
//
// Usage: bun tools/check-bike-levels.ts [levelId ...] [--bike=scout] [--robust] [--verbose]
//   --bike=ID   one bike only, with more detail per level
//   --robust    also ride each level in seven different styles (steadier, twitchier, slower...), so a level
//               that only just works for one exact riding line shows up. Takes about half a minute.
//   --verbose   with --bike, print the bike's position twice a second
//
// The starter bike's line shows a suggested par: its time plus 0.5 s, rounded up to the next 0.5 s.
// The pars in the level list are set this way, so a "*" means the track changed and the par needs updating.
// tests/bike-race-levels.test.ts checks that every run in --robust finishes.
import * as C from '../public/js/bike-race-core';
import { ride, STYLES as ALL_STYLES } from './bike-levels';

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const bikeArg = (args.find((a) => a.startsWith('--bike=')) || '').slice(7);
const verbose = args.includes('--verbose');
const robust = args.includes('--robust');
if (bikeArg && !C.BIKES.some((b) => b.id === bikeArg)) {
  console.error(`No bike called ${bikeArg}. Bikes: ${C.BIKES.map((b) => b.id).join(', ')}`);
  process.exit(2);
}
const bikes = bikeArg ? [C.bikeById(bikeArg)] : C.BIKES;
// riding styles for --robust: the default rider first, then variations of how hard it steers and how fast it goes
const STYLES = robust ? ALL_STYLES : [{}];

const failures: string[] = [];
const head = bikeArg ? '' : 'level     name             length   par  ' + bikes.map((b) => b.name.padStart(8)).join('');
if (head) console.log(head);
for (const w of C.WORLDS)
  for (const L of w.levels) {
    if (only.length && !only.includes(L.id)) continue;
    const cells: string[] = [];
    let parNote = '',
      length = 0;
    for (const b of bikes) {
      const log: string[] | null = verbose ? [] : null;
      const runs = STYLES.map((cfg, i) => ride(w, L, b.id, cfg, i === 0 ? log : null));
      const main = runs[0];
      length = main.level.finishX;
      runs.forEach((r, i) => {
        if (r.why) failures.push(`${L.id} ${b.id}${robust ? ' style ' + JSON.stringify(STYLES[i]) : ''}: ${r.why}`);
      });
      const bad = runs.filter((r) => r.why).length;
      if (b.id === C.BIKES[0].id && main.bike.finished) {
        const suggest = Math.ceil((main.bike.finishTime + 0.5) * 2) / 2;
        if (suggest !== L.par) parNote = `  * suggested par ${suggest}`;
      }
      if (bikeArg) {
        const t = main.bike.finished ? `finished ${main.bike.finishTime.toFixed(2)}s` : main.why;
        console.log(
          `${L.id.padEnd(9)} ${L.name.padEnd(16)} len=${length.toFixed(0).padStart(4)}m par=${String(L.par).padStart(5)}  ${t}  maxAir=${main.maxAir.toFixed(2)}s cps=${main.level.checkpoints.length}${robust ? `  styles ok ${STYLES.length - bad}/${STYLES.length}` : ''}${parNote}`,
        );
        if (log) console.log(log.join('\n'));
      } else {
        cells.push(((main.bike.finished ? main.bike.finishTime.toFixed(2) : 'CRASH') + (bad ? '!' : ' ')).padStart(8));
      }
    }
    if (!bikeArg)
      console.log(
        `${L.id.padEnd(9)} ${L.name.padEnd(16)} ${(length.toFixed(0) + 'm').padStart(6)} ${String(L.par).padStart(5)}  ${cells.join('')}${parNote}`,
      );
  }
if (failures.length) {
  console.log(`\n${failures.length} run${failures.length > 1 ? 's' : ''} did not finish:`);
  for (const f of failures) console.log('  ' + f);
} else
  console.log(
    `\nEvery run finished (${bikes.length} bike${bikes.length > 1 ? 's' : ''}${robust ? ', ' + STYLES.length + ' riding styles' : ''}).`,
  );
process.exitCode = failures.length ? 1 : 0;
