// Checks Castle Defender's world functions (public/js/castle-defender-world.js) in Node, no browser needed:
// the biomes add up, sit where the game expects them and blend smoothly, and the canyon wall is where it was.
//
// Usage: node tools/check-castle-world.mjs
import * as W from '../public/js/castle-defender-world.js';

let failed = 0, passed = 0;
const ok = (cond, what, extra) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } };

console.log('Biomes');
const w = new Float32Array(4);
let worstSum = 0;
for (let i = 0; i < 4000; i++) {
  const x = (Math.random() - 0.3) * 1200, z = (Math.random() - 0.5) * 1200;
  W.biomeWeights(x, z, w);
  worstSum = Math.max(worstSum, Math.abs(w[0] + w[1] + w[2] + w[3] - 1), ...Array.from(w).map(v => (v < 0 ? 1 : 0)));
}
ok(worstSum < 1e-4, 'the four weights are never negative and always add up to 1', worstSum);
const where = { home: [4, 0], 'first east road': [56, -2], 'first north-east road': [30, -52], 'first south-east road': [46, 44] };
for (const [name, [x, z]] of Object.entries(where)) ok(W.biomeAt(x, z) === W.BIOME.canyon, `the canyon at the ${name}`, W.biomeAt(x, z));
for (const [name, b, pts] of [['Frozen Pass', W.BIOME.frozen, [[4, -88], [17, -70], [-20, -300], [60, -900]]], ['Ashlands', W.BIOME.ash, [[96, 6], [76, -2], [400, 0], [2000, -300]]], ['Mire', W.BIOME.mire, [[84, 66], [65, 55], [10, 200], [500, 700]]]])
  ok(pts.every(([x, z]) => W.biomeAt(x, z) === b), `${name} where its roads go, and on outward for ever`, pts.map(([x, z]) => W.biomeAt(x, z)));
// no tiles: walking anywhere in small steps the weights only ever change a little
let worstStep = 0;
for (let i = 0; i < 300; i++) {
  let x = (Math.random() - 0.3) * 600, z = (Math.random() - 0.5) * 600;
  const a = Math.random() * 6.28, prev = new Float32Array(4);
  W.biomeWeights(x, z, prev);
  for (let s = 0; s < 200; s++) {
    x += Math.cos(a) * 0.5; z += Math.sin(a) * 0.5;
    W.biomeWeights(x, z, w);
    for (let k = 0; k < 4; k++) worstStep = Math.max(worstStep, Math.abs(w[k] - prev[k]));
    prev.set(w);
  }
}
ok(worstStep < 0.12, 'biomes blend: half a pace never changes a weight by more than 0.12', worstStep);
// each outer biome is one connected wedge that keeps going: far out, every compass direction has a biome
// and moving round the compass passes them in order
const order = [];
for (let a = -170; a <= 170; a += 2) { const r = 600, b = W.biomeAt(4 + Math.cos(a * Math.PI / 180) * r, Math.sin(a * Math.PI / 180) * r); if (order[order.length - 1] !== b) order.push(b); }
ok(order.join() === [W.BIOME.frozen, W.BIOME.ash, W.BIOME.mire].join() || order.join() === [W.BIOME.mire, W.BIOME.frozen, W.BIOME.ash, W.BIOME.mire].join() || order.join() === [W.BIOME.frozen, W.BIOME.ash, W.BIOME.mire, W.BIOME.frozen].join(),
  'far out, going round from north-west: Frozen Pass, Ashlands, Mire', order.map(b => W.BIOME_NAMES[b]));

console.log('Canyon wall');
// the wall as it was before the world had no edge (sampled at z = 4k + 1 from -119)
const old = (z) => -17.6 - 0.9 * Math.sin(z * 0.21) - 0.7 * Math.sin(z * 0.53) - (Math.abs(z) > 24 ? (Math.abs(z) - 24) * 0.35 : 0) - (Math.abs(z % 16) < 4 ? 1.5 : 0);
let same = true;
for (let z = -119; z <= 119; z += 4) if (Math.abs(W.cliffEdge(z) - old(z)) > 1e-9) same = false;
ok(same, 'the wall near the castle is exactly where it was');
// the wall's foot is straight between samples
const foot = (z) => { const s = Math.floor((z - 1) / 4) * 4 + 1, t = (z - s) / 4; return W.cliffEdge(s) * (1 - t) + W.cliffEdge(s + 4) * t; };
let gap = 1e9, behind = true;
for (let z = -2000; z <= 2000; z += 0.5) { gap = Math.min(gap, W.cliffMinX(z) - foot(z)); if (W.cliffEdge2(z) >= W.cliffEdge(z)) behind = false; }
ok(gap > 0.3, 'the king\'s limit stays clear of the wall foot all along it', gap);
ok(behind, 'the second step stands behind the first');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
