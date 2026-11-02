// Castle Defender's endless world, as plain functions of a ground position (x, z): which biome is where, where
// the canyon wall runs, and the noise behind both. No three.js and no DOM here, so tests/castle-defender-world.test.ts
// can test it with bun test. North is -z, east is +x.
//
// Biomes: the sandy canyon around the castle, then three outer biomes that each own a wedge of compass
// directions and run on outward for ever: Frozen Pass to the north, Ashlands to the east, Mire to the south-east.
// The borders between them wander (noise) and blend over a few paces, so the ground changes gradually instead
// of in tiles.

/** A point on the ground: [x, z] */
export type Pt = [number, number];
/** A place on the ground */
export interface XZ {
  x: number;
  z: number;
}
/** A round claim of land: the king's land is the union of these */
export interface Claim extends XZ {
  r: number;
}
/** A point on a road, the road's direction there, and how far along the road it is */
export interface RoadPoint extends XZ {
  dx: number;
  dz: number;
  at: number;
}

export const BIOME = { canyon: 0, frozen: 1, mire: 2, ash: 3 } as const; // same order as the enemy palettes
export type Biome = (typeof BIOME)[keyof typeof BIOME];
export const BIOME_NAMES = ['Canyon', 'Frozen Pass', 'Mire', 'Ashlands'];
export const HOME: XZ = { x: 4, z: 0 }; // the middle of the walled base

const DEG = Math.PI / 180;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ------------------------------------------------------------------ noise ----
function hash2(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed + 1, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// smooth value noise in [-1, 1]
export function noise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz;
  const u = fx * fx * (3 - 2 * fx),
    v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed),
    b = hash2(ix + 1, iz, seed),
    c = hash2(ix, iz + 1, seed),
    d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export const fbm = (x: number, z: number, seed = 0) =>
  noise(x, z, seed) * 0.65 + noise(x * 2.03 + 17.1, z * 2.03 - 9.4, seed + 101) * 0.35;
// a whole number for each chunk or strip, to seed its random numbers
export const cellSeed = (i: number, j: number, salt = 0) => (hash2(i, j, salt + 7) * 4294967296) | 0;

// ----------------------------------------------------------------- biomes ----
// The borders between the outer biomes are rays out from home at these compass angles (0 east, -90 north),
// pushed sideways by up to WANDER paces of noise and blended over BLEND paces on either side.
interface Border {
  a: number;
  lo: Biome;
  hi: Biome;
  seed: number;
}
const BORDERS: Border[] = [
  { a: -42.5 * DEG, lo: BIOME.frozen, hi: BIOME.ash, seed: 11 },
  { a: 27.5 * DEG, lo: BIOME.ash, hi: BIOME.mire, seed: 12 },
  { a: 170 * DEG, lo: BIOME.mire, hi: BIOME.frozen, seed: 13 }, // behind the canyon wall, mostly out of sight
];
const WANDER = 16,
  BLEND = 7;
// the canyon reaches about CANYON_R paces from home, give or take CANYON_WOBBLE, and fades out over CANYON_FADE
export const CANYON_R = 66;
const CANYON_WOBBLE = 9,
  CANYON_FADE = 9;

// how far (x, z) is past border b, sideways in paces: negative on its `lo` side, positive on its `hi` side
function pastBorder(b: Border, x: number, z: number, r: number, th: number): number {
  const d = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, angleDiff(th, b.a)));
  return r * Math.sin(d) + WANDER * fbm(x / 70, z / 70, b.seed);
}

// Writes the weight of each biome at (x, z) into out[0..3] (they add up to 1) and returns out.
export function biomeWeights(x: number, z: number, out: Float32Array = new Float32Array(4)): Float32Array {
  const dx = x - HOME.x,
    dz = z - HOME.z,
    r = Math.hypot(dx, dz),
    th = Math.atan2(dz, dx);
  const t = BORDERS.map((b) => smoothstep(-BLEND, BLEND, pastBorder(b, x, z, r, th)));
  // each outer biome sits on the hi side of one border and the lo side of the next
  const fr = t[2] * (1 - t[0]),
    ash = t[0] * (1 - t[1]),
    mi = t[1] * (1 - t[2]);
  const sum = fr + ash + mi || 1;
  const rc = CANYON_R + CANYON_WOBBLE * fbm(x / 60, z / 60, 21);
  const outer = smoothstep(rc - CANYON_FADE, rc + CANYON_FADE, r);
  out[BIOME.canyon] = 1 - outer;
  out[BIOME.frozen] = (outer * fr) / sum;
  out[BIOME.mire] = (outer * mi) / sum;
  out[BIOME.ash] = (outer * ash) / sum;
  return out;
}
const tmpW = new Float32Array(4);
// the biome with the most weight at (x, z)
export function biomeAt(x: number, z: number): Biome {
  biomeWeights(x, z, tmpW);
  let best = 0;
  for (let i = 1; i < 4; i++) if (tmpW[i] > tmpW[best]) best = i;
  return best as Biome;
}

// ----------------------------------------------------------- canyon wall ----
// The canyon wall runs north to south along the west side and leans back further west the further it gets
// from the castle. It is sampled every 4 paces at z = 4k + 1. The first step is 3.2 tall; a second step of
// 2.4 stands behind it.
export const CLIFF = { h1: 3.2, h2: 2.4, step: 4 };
const recede = (z: number) => (Math.abs(z) > 24 ? (Math.abs(z) - 24) * 0.35 : 0);
export function cliffEdge(z: number): number {
  return -17.6 - 0.9 * Math.sin(z * 0.21) - 0.7 * Math.sin(z * 0.53) - recede(z) - (Math.abs(z % 16) < 4 ? 1.5 : 0);
}
export function cliffEdge2(z: number): number {
  return cliffEdge(z) - 9 - 2 * Math.sin(z * 0.4) + (Math.abs((z + 8) % 20) < 6 ? 2.5 : 0);
}
// the furthest west anything on the ground can stand at this z: just short of the wall's most eastern bulge
export const cliffMinX = (z: number) => -15.6 - recede(z);
// two flat-topped mesas near the wall, north-west and south-west of the castle
export const MESAS: Pt[][] = [
  [
    [-24, -42],
    [-10, -46],
    [-4, -56],
    [-16, -66],
    [-30, -58],
  ],
  [
    [-24, 44],
    [-10, 48],
    [-6, 60],
    [-20, 68],
    [-30, 58],
  ],
];

// ------------------------------------------------------------- territory ----
// The king's land is a union of round claims: one around home and one around each outpost built. The border is
// the edge of that union. Enemy camps stand out past it, one per front, at the start of the front's road.
export const CLAIM_HOME = 44,
  CLAIM_OUTPOST = 34;
export const CAMP_STEP = 20; // how far a camp falls back when the border reaches it, at least
export const CAMP_CLEAR = 14; // a new camp stands at least this far outside the border (and not much more, so
// the next outpost on its road reaches it)
export const CAMP_REACHED = 4; // a camp the border comes this close to (or covers) is cleared

// how far (x, z) is outside the border: negative inside
export function borderDist(claims: readonly Claim[], x: number, z: number): number {
  let d = Infinity;
  for (const c of claims) {
    const v = Math.hypot(x - c.x, z - c.z) - c.r;
    if (v < d) d = v;
  }
  return d;
}
// (x, z) moved back inside the border, at least `margin` in, if it had strayed out
export function clampToClaims(claims: readonly Claim[], x: number, z: number, margin = 0): Pt {
  let best: Claim | null = null,
    bd = Infinity;
  for (const c of claims) {
    const v = Math.hypot(x - c.x, z - c.z) - c.r;
    if (v < bd) {
      bd = v;
      best = c;
    }
  }
  if (!best || bd <= -margin) return [x, z];
  const dx = x - best.x,
    dz = z - best.z,
    d = Math.hypot(dx, dz) || 1,
    r = Math.max(0, best.r - margin);
  return [best.x + (dx / d) * r, best.z + (dz / d) * r];
}
// the point `dist` paces along a road from its start, with the road's direction there
export function pointAlong(road: readonly Pt[], dist: number): RoadPoint | null {
  let left = Math.max(0, dist);
  for (let i = 0; i < road.length - 1; i++) {
    const [ax, az] = road[i],
      [bx, bz] = road[i + 1],
      L = Math.hypot(bx - ax, bz - az);
    if (left <= L || i === road.length - 2) {
      const t = L ? Math.min(1, left / L) : 0;
      return {
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        dx: (bx - ax) / (L || 1),
        dz: (bz - az) / (L || 1),
        at: dist,
      };
    }
    left -= L;
  }
  return null;
}
export const roadLength = (road: readonly Pt[]) => {
  let s = 0;
  for (let i = 0; i < road.length - 1; i++) s += Math.hypot(road[i + 1][0] - road[i][0], road[i + 1][1] - road[i][1]);
  return s;
};
// walking a road in from its camp, the first point at least `depth` inside the border
export function roadCrossing(road: readonly Pt[], claims: readonly Claim[], depth: number): RoadPoint | null {
  const total = roadLength(road);
  for (let s = 0; s <= total; s += 1) {
    const p = pointAlong(road, s)!;
    if (borderDist(claims, p.x, p.z) <= -depth) return p;
  }
  return null;
}
// Where a camp falls back to when the border reaches it: on outward from home in about the same direction, at
// least CAMP_STEP further and just CAMP_CLEAR past the border, clear of the canyon wall and the other camps.
// `rand` gives numbers in [0, 1).
export function nextCamp(from: XZ, claims: readonly Claim[], others: readonly XZ[], rand: () => number): XZ {
  let a = Math.atan2(from.z - HOME.z, from.x - HOME.x) + (rand() - 0.5) * 0.4,
    d = CAMP_STEP,
    x = from.x,
    z = from.z;
  for (let tries = 0; tries < 80; tries++) {
    x = from.x + Math.cos(a) * d;
    z = from.z + Math.sin(a) * d;
    if (x < cliffMinX(z) + 10) {
      a += Math.sin(a) < 0 ? 0.25 : -0.25;
      continue;
    } // turn east, away from the wall
    const near = others.find((o) => Math.hypot(o.x - x, o.z - z) < 26);
    if (near) {
      a += angleDiff(a, Math.atan2(near.z - from.z, near.x - from.x)) > 0 ? 0.2 : -0.2;
      continue;
    }
    if (borderDist(claims, x, z) < CAMP_CLEAR) {
      d += 3;
      continue;
    }
    break;
  }
  return { x, z };
}
// The rest of a road from `dist` paces along it, starting at that very point
export function roadFrom(road: readonly Pt[], dist: number): Pt[] {
  let left = Math.max(0, dist);
  for (let i = 0; i < road.length - 1; i++) {
    const [ax, az] = road[i],
      [bx, bz] = road[i + 1],
      L = Math.hypot(bx - ax, bz - az);
    if (left < L) {
      const t = left / L;
      return [[ax + (bx - ax) * t, az + (bz - az) * t], ...road.slice(i + 1).map((p): Pt => [p[0], p[1]])];
    }
    left -= L;
  }
  return road.slice(-2).map((p): Pt => [p[0], p[1]]);
}
// Where a new camp goes around an outpost: past the border off to one side (`side` 1 or -1) of the way out from home,
// CAMP_CLEAR outside the border, clear of the canyon wall, the mesas and the other camps. Null if there is no room.
export function campAround(post: XZ, side: number, claims: readonly Claim[], others: readonly XZ[]): XZ | null {
  const out = Math.atan2(post.z - HOME.z, post.x - HOME.x);
  for (const turn of [0.8, 1.1, 0.5, 1.4]) {
    const a = out + side * turn;
    for (let d = 24; d <= 80; d += 2) {
      const x = post.x + Math.cos(a) * d,
        z = post.z + Math.sin(a) * d;
      if (borderDist(claims, x, z) < CAMP_CLEAR) continue;
      if (x < cliffMinX(z) + 10 || pushOutOfMesas(x, z, 6)[0] !== x) continue;
      if (others.some((o) => Math.hypot(o.x - x, o.z - z) < 26)) continue;
      return { x, z };
    }
  }
  return null;
}
// a road from a new camp back to the old one, wandering a little
export function campRoad(from: XZ, to: XZ, rand: () => number): Pt[] {
  const dx = to.x - from.x,
    dz = to.z - from.z,
    L = Math.hypot(dx, dz) || 1,
    px = -dz / L,
    pz = dx / L,
    n = Math.max(2, Math.round(L / 9));
  const pts: Pt[] = [[from.x, from.z]];
  for (let i = 1; i < n; i++) {
    const t = i / n,
      w = (rand() - 0.5) * 8 * Math.sin(t * Math.PI);
    pts.push([from.x + dx * t + px * w, from.z + dz * t + pz * w]);
  }
  pts.push([to.x, to.z]);
  return pts;
}
// (x, z) pushed out of the mesas, keeping `pad` from their walls
export function pushOutOfMesas(x: number, z: number, pad: number): Pt {
  for (const m of MESAS) {
    let inside = false,
      best = Infinity,
      bx = 0,
      bz = 0;
    for (let i = 0, j = m.length - 1; i < m.length; j = i++) {
      const [ax, az] = m[j],
        [cx, cz] = m[i];
      if (cz > z !== az > z && x < ((ax - cx) * (z - cz)) / (az - cz) + cx) inside = !inside;
      const ex = cx - ax,
        ez = cz - az,
        L = ex * ex + ez * ez,
        t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L));
      const qx = ax + ex * t,
        qz = az + ez * t,
        d = Math.hypot(x - qx, z - qz);
      if (d < best) {
        best = d;
        bx = qx;
        bz = qz;
      }
    }
    if (!inside && best >= pad) continue;
    // out through the nearest wall, `pad` beyond it
    let nx = x - bx,
      nz = z - bz,
      nl = Math.hypot(nx, nz);
    if (nl < 1e-6) {
      const cx = m.reduce((s, p) => s + p[0], 0) / m.length,
        cz = m.reduce((s, p) => s + p[1], 0) / m.length;
      nx = bx - cx;
      nz = bz - cz;
      nl = Math.hypot(nx, nz) || 1;
    }
    const s = inside ? -1 : 1;
    x = bx + ((s * nx) / nl) * pad;
    z = bz + ((s * nz) / nl) * pad;
  }
  return [x, z];
}
