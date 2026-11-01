// Checks Castle Defender's world functions (public/js/castle-defender-world.js) in Node, no browser needed:
// the biomes add up, sit where the game expects them and blend smoothly, the canyon wall is where it was, and the
// territory functions (the border, camps falling back, the roads between them) do what the game needs.
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

console.log('Territory');
const home = { x: W.HOME.x, z: W.HOME.z, r: W.CLAIM_HOME };
const claims = [home, { x: 40, z: 0, r: W.CLAIM_OUTPOST }];
ok(W.borderDist(claims, 4, 0) === -44 && Math.abs(W.borderDist(claims, 84, 0) - 10) < 1e-9 && Math.abs(W.borderDist(claims, 4, 54) - 10) < 1e-9, 'border distance: negative inside, the distance to the nearest claim outside');
let clampOk = true;
for (let i = 0; i < 3000; i++) {
  const x = (Math.random() - 0.3) * 300, z = (Math.random() - 0.5) * 300, [cx, cz] = W.clampToClaims(claims, x, z, 1.2), d = W.borderDist(claims, cx, cz);
  if (d > -1.2 + 1e-6) clampOk = false;
  if (W.borderDist(claims, x, z) <= -1.2 && (cx !== x || cz !== z)) clampOk = false;
}
ok(clampOk, 'clamping keeps a point at least the margin inside the border, and leaves points already inside alone');
const road = [[56, -2], [46, -6], [36, -3], [27, -7], [20, -1], [15.4, 0], [3, 0], [-5.5, -4.5]];
const len = W.roadLength(road), end = W.pointAlong(road, len);
ok(Math.hypot(end.x + 5.5, end.z + 4.5) < 1e-6 && W.pointAlong(road, 0).x === 56, 'walking a road from its start to its full length ends at its end', [end.x, end.z]);
const cross = W.roadCrossing(road, [home], 8);
ok(cross && Math.abs(W.borderDist([home], cross.x, cross.z) + 8) < 1.2, 'a road crosses the border where it first gets the asked depth inside', cross && W.borderDist([home], cross.x, cross.z));
// camps fall back further out each time, clear of the border, the wall and each other
const rand = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
let campOk = true, worstCamp = null;
for (const start of [{ x: 56, z: -2 }, { x: 30, z: -52 }, { x: 46, z: 44 }, { x: 4, z: -88 }, { x: 16, z: 92 }]) {
  let c = start;
  const cl = [home];
  for (let n = 0; n < 8; n++) {
    cl.push({ x: c.x + (W.HOME.x - c.x) * 0.25, z: c.z + (W.HOME.z - c.z) * 0.25, r: W.CLAIM_OUTPOST });   // an outpost that reaches the camp
    const next = W.nextCamp(c, cl, [], rand);
    const bad = Math.hypot(next.x - c.x, next.z - c.z) < W.CAMP_STEP - 1e-6 || W.borderDist(cl, next.x, next.z) < W.CAMP_CLEAR || next.x < W.cliffMinX(next.z) + 10
      || Math.hypot(next.x - W.HOME.x, next.z - W.HOME.z) <= Math.hypot(c.x - W.HOME.x, c.z - W.HOME.z);
    if (bad) { campOk = false; worstCamp = [c, next]; }
    c = next;
  }
}
ok(campOk, 'a camp falls back at least a step further out, clear of the border and the wall', worstCamp);
// the game's loop on each front: an outpost where the road crosses the border, 8 in and 4.6 to the side, clears the
// camp; the camp falls back and a new road joins it to the old one; the next outpost on that road clears it again
const FRONT_ROADS = [
  [[56, -2], [46, -6], [36, -3], [27, -7], [20, -1], [15.4, 0], [3, 0], [-5.5, -4.5]],
  [[30, -52], [31, -42], [26, -33], [18, -25], [10, -19.5], [3, -13.2], [-1, -9], [-5.5, -4.5]],
  [[46, 44], [38, 37], [30, 30], [21, 23], [12, 18], [7, 13.5], [6, 6], [3, 0], [-5.5, -4.5]],
];
let cleared = 0, tries = 0, missed = null;
for (const start of FRONT_ROADS) for (let run = 0; run < 5; run++) {
  let rd = start, camp = { x: rd[0][0], z: rd[0][1] };
  const cl = [{ ...home }];
  for (let n = 0; n < 8; n++) {
    const p = W.roadCrossing(rd, cl, 8);
    cl.push({ x: p.x - p.dz * 4.6, z: p.z + p.dx * 4.6, r: W.CLAIM_OUTPOST });
    tries++;
    if (W.borderDist(cl, camp.x, camp.z) < W.CAMP_REACHED) cleared++; else { missed = { n, camp, border: W.borderDist(cl, camp.x, camp.z) }; continue; }
    const next = W.nextCamp(camp, cl, [], rand);
    rd = [...W.campRoad(next, camp, rand).slice(0, -1), ...rd];
    camp = next;
  }
}
ok(cleared / tries > 0.9, 'nearly every outpost built on a front\'s road clears that front\'s camp', { cleared, tries, missed });
const cr = W.campRoad({ x: 100, z: 0 }, { x: 60, z: 4 }, rand);
ok(cr[0][0] === 100 && cr[cr.length - 1][0] === 60 && cr.length >= 4, 'the road from a new camp runs back to the old one', cr.length);
let mesaOk = true;
for (const m of W.MESAS) {
  const cx = m.reduce((s, p) => s + p[0], 0) / m.length, cz = m.reduce((s, p) => s + p[1], 0) / m.length;
  const [x, z] = W.pushOutOfMesas(cx, cz, 0.8), [x2, z2] = W.pushOutOfMesas(x, z, 0.8);
  if (Math.hypot(x - cx, z - cz) < 3 || Math.hypot(x2 - x, z2 - z) > 1e-9) mesaOk = false;
}
ok(mesaOk && W.pushOutOfMesas(4, 0, 0.8)[0] === 4, 'the king is pushed out of a mesa and stays out, and left alone away from them');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
