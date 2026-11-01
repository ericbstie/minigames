// Castle Defender's endless world, as plain functions of a ground position (x, z): which biome is where, where
// the canyon wall runs, and the noise behind both. No three.js and no DOM here, so tools/check-castle-world.js
// can test it in Node. North is -z, east is +x.
//
// Biomes: the sandy canyon around the castle, then three outer biomes that each own a wedge of compass
// directions and run on outward for ever: Frozen Pass to the north, Ashlands to the east, Mire to the south-east.
// The borders between them wander (noise) and blend over a few paces, so the ground changes gradually instead
// of in tiles.

export const BIOME = { canyon: 0, frozen: 1, mire: 2, ash: 3 };   // same order as the enemy palettes
export const BIOME_NAMES = ['Canyon', 'Frozen Pass', 'Mire', 'Ashlands'];
export const HOME = { x: 4, z: 0 };                                 // the middle of the walled base

const DEG = Math.PI / 180;
export const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ------------------------------------------------------------------ noise ----
function hash2(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed + 1, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// smooth value noise in [-1, 1]
export function noise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export const fbm = (x, z, seed = 0) => noise(x, z, seed) * 0.65 + noise(x * 2.03 + 17.1, z * 2.03 - 9.4, seed + 101) * 0.35;
// a whole number for each chunk or strip, to seed its random numbers
export const cellSeed = (i, j, salt = 0) => (hash2(i, j, salt + 7) * 4294967296) | 0;

// ----------------------------------------------------------------- biomes ----
// The borders between the outer biomes are rays out from home at these compass angles (0 east, -90 north),
// pushed sideways by up to WANDER paces of noise and blended over BLEND paces on either side.
const BORDERS = [
  { a: -42.5 * DEG, lo: BIOME.frozen, hi: BIOME.ash, seed: 11 },
  { a: 27.5 * DEG, lo: BIOME.ash, hi: BIOME.mire, seed: 12 },
  { a: 170 * DEG, lo: BIOME.mire, hi: BIOME.frozen, seed: 13 },   // behind the canyon wall, mostly out of sight
];
const WANDER = 16, BLEND = 7;
// the canyon reaches about CANYON_R paces from home, give or take CANYON_WOBBLE, and fades out over CANYON_FADE
export const CANYON_R = 66;
const CANYON_WOBBLE = 9, CANYON_FADE = 9;

// how far (x, z) is past border b, sideways in paces: negative on its `lo` side, positive on its `hi` side
function pastBorder(b, x, z, r, th) {
  const d = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, angleDiff(th, b.a)));
  return r * Math.sin(d) + WANDER * fbm(x / 70, z / 70, b.seed);
}

// Writes the weight of each biome at (x, z) into out[0..3] (they add up to 1) and returns out.
export function biomeWeights(x, z, out = new Float32Array(4)) {
  const dx = x - HOME.x, dz = z - HOME.z, r = Math.hypot(dx, dz), th = Math.atan2(dz, dx);
  const t = BORDERS.map(b => smoothstep(-BLEND, BLEND, pastBorder(b, x, z, r, th)));
  // each outer biome sits on the hi side of one border and the lo side of the next
  const fr = t[2] * (1 - t[0]), ash = t[0] * (1 - t[1]), mi = t[1] * (1 - t[2]);
  const sum = fr + ash + mi || 1;
  const rc = CANYON_R + CANYON_WOBBLE * fbm(x / 60, z / 60, 21);
  const outer = smoothstep(rc - CANYON_FADE, rc + CANYON_FADE, r);
  out[BIOME.canyon] = 1 - outer;
  out[BIOME.frozen] = outer * fr / sum;
  out[BIOME.mire] = outer * mi / sum;
  out[BIOME.ash] = outer * ash / sum;
  return out;
}
const tmpW = new Float32Array(4);
// the biome with the most weight at (x, z)
export function biomeAt(x, z) {
  biomeWeights(x, z, tmpW);
  let best = 0;
  for (let i = 1; i < 4; i++) if (tmpW[i] > tmpW[best]) best = i;
  return best;
}

// ----------------------------------------------------------- canyon wall ----
// The canyon wall runs north to south along the west side and leans back further west the further it gets
// from the castle. It is sampled every 4 paces at z = 4k + 1. The first step is 3.2 tall; a second step of
// 2.4 stands behind it.
export const CLIFF = { h1: 3.2, h2: 2.4, step: 4 };
const recede = (z) => (Math.abs(z) > 24 ? (Math.abs(z) - 24) * 0.35 : 0);
export function cliffEdge(z) {
  return -17.6 - 0.9 * Math.sin(z * 0.21) - 0.7 * Math.sin(z * 0.53) - recede(z) - (Math.abs(z % 16) < 4 ? 1.5 : 0);
}
export function cliffEdge2(z) {
  return cliffEdge(z) - 9 - 2 * Math.sin(z * 0.4) + (Math.abs((z + 8) % 20) < 6 ? 2.5 : 0);
}
// the furthest west anything on the ground can stand at this z: just short of the wall's most eastern bulge
export const cliffMinX = (z) => -15.6 - recede(z);
// two flat-topped mesas near the wall, north-west and south-west of the castle
export const MESAS = [
  [[-24, -42], [-10, -46], [-4, -56], [-16, -66], [-30, -58]],
  [[-24, 44], [-10, 48], [-6, 60], [-20, 68], [-30, 58]],
];
