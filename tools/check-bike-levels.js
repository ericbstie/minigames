// Runs the computer rider through every Bike Race level and prints its time, or where it crashed.
// Usage: node tools/check-bike-levels.js [levelId ...] [--bike=scout] [--verbose]
// Each finished line also shows a suggested par: the computer rider's time plus 0.5 s, rounded up to the next 0.5 s.
// The scout (starter bike) times are the ones to use for par.
const path = require('path');
const C = require(path.join(__dirname, '..', 'public', 'js', 'bike-race-core.js'));
const args = process.argv.slice(2);
const only = args.filter(a => !a.startsWith('--'));
const bikeId = (args.find(a => a.startsWith('--bike=')) || '--bike=scout').slice(7);
const verbose = args.includes('--verbose');
let fails = 0;
for (const w of C.WORLDS) for (const L of w.levels) {
  if (only.length && !only.includes(L.id)) continue;
  const level = C.buildLevel(w, L);
  const sim = new C.Sim(level);
  const bike = sim.addBike(bikeId);
  bike.running = true;
  let maxAir = 0, flips = 0, steps = 0, log = [];
  while (!bike.finished && !bike.crashed && sim.t < 120) {
    bike.input = C.botInput(bike);
    sim.step(); steps++;
    maxAir = Math.max(maxAir, bike.airborne);
    if (verbose && steps % 60 === 0) log.push(`t=${sim.t.toFixed(1)} x=${bike.c.x.toFixed(1)} y=${bike.c.y.toFixed(1)} a=${bike.c.a.toFixed(2)} v=${bike.speed.toFixed(1)}`);
    for (const e of bike.events) if (e.type === 'flip') flips += e.n;
    bike.events.length = 0;
  }
  const suggest = bike.finished ? Math.ceil((bike.finishTime + 0.5) * 2) / 2 : null;
  const status = bike.finished ? `finished ${bike.finishTime.toFixed(2)}s (suggested par ${suggest}${suggest === L.par ? '' : ' *'})` : bike.crashed ? `CRASHED (${bike.crashKind}) at x=${bike.c.x.toFixed(1)} of ${level.finishX.toFixed(0)}` : `TIMEOUT at x=${bike.c.x.toFixed(1)}`;
  if (!bike.finished) fails++;
  const piece = (level.marks.filter(m => m[0] <= bike.c.x + 1).pop() || [0, 'start'])[1];
  console.log(`${L.id.padEnd(9)} ${L.name.padEnd(16)} len=${level.finishX.toFixed(0).padStart(4)}m par=${String(L.par).padStart(5)}  ${status}  maxAir=${maxAir.toFixed(2)}s flips=${flips} cps=${level.checkpoints.length}${bike.finished ? '' : '  piece: ' + piece}`);
  if (verbose) console.log(log.join('\n'));
}
process.exitCode = fails ? 1 : 0;
