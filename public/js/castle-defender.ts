// Castle Defender: ride the king around, collect the coins fallen enemies drop
// and spend them on pads to grow an army, towers, walls, cannons and weapons.
// The world has no edge: outposts on the border push it out, enemy camps the
// border reaches are cleared, and the enemy falls back further out, tougher.
//
// The game is a Game for the hub (`game` at the end): it opens in a scope while the player is on its screen, and
// what it sets up there (the input listeners, the frame loop, the game-over panel's delay, saving the game every few
// seconds) stops when they leave. The game being played is saved, so a reload carries on with it (see "saving").
// The rules, the world and the drawing are plain functions the frame loop calls.
import { Effect, FiberSet, Schema } from 'effect';
import * as THREE from 'three';
import {
  BIOME,
  BIOME_NAMES,
  HOME,
  biomeWeights,
  biomeAt,
  cliffEdge,
  cliffEdge2,
  cliffMinX,
  CLIFF,
  MESAS,
  fbm,
  cellSeed,
  smoothstep,
  CLAIM_HOME,
  CLAIM_OUTPOST,
  CAMP_REACHED,
  borderDist,
  clampToClaims,
  pointAlong,
  roadCrossing,
  nextCamp,
  campRoad,
  pushOutOfMesas,
  type Biome,
  type Claim as LandClaim,
  type Pt,
  type RoadPoint,
  type XZ,
} from './castle-defender-world';
import { GameHub, type Game as HubGame } from './hub';
import { animate, forget, listen, load, type PageServices, run, runSync, save } from './page';

// ---------------------------------------------------------------- tuning ----
const HX = 14,
  HZ = 12; // walled base: x in [-HX,HX], z in [-HZ,HZ]
type Side = 'N' | 'E' | 'S' | 'W';
// a gate in every side: the king walks through, enemies have to break it down
const GATES: { side: Side; lo: number; hi: number }[] = [
  { side: 'E', lo: -2, hi: 2 },
  { side: 'N', lo: -2, hi: 2 },
  { side: 'S', lo: 4, hi: 8 },
  { side: 'W', lo: -9, hi: -5 },
];
const KING_SPEED = 10.2;
const FOLLOWER_CAP = 60; // people in the troop, counting everyone merged into stronger ones
// Past SQUAD_MAX followers, new recruits join the weakest follower instead and
// make it stronger (damage x rank). Ranks show as a bigger body and a new tunic.
const SQUAD_MAX = 10;
const RANKS = [
  { min: 1, top: '#f5f2ec', s: 1 },
  { min: 2, top: '#3d7be0', s: 1.15 },
  { min: 4, top: '#3fae5a', s: 1.3 },
  { min: 7, top: '#8a4fd8', s: 1.45 },
];
const rankTier = (r: number) => {
  let i = 0;
  while (i + 1 < RANKS.length && r >= RANKS[i + 1].min) i++;
  return i;
};

// Weapons, in the order the forge unlocks them. dmg per hit, cd seconds.
type ShotKind = 'arrow' | 'arrow2' | 'bolt' | 'spear' | 'bullet';
type ProjKind = ShotKind | 'ball';
interface WeaponBase {
  name: string;
  dmg: number;
  cd: number;
  range: number;
}
// a sword hits whoever is in reach; the others shoot something that flies
interface MeleeWeapon extends WeaponBase {
  kind: 'melee';
  leash: number;
}
interface RangedWeapon extends WeaponBase {
  kind: ShotKind;
  speed: number;
  pierce?: number;
}
type Weapon = MeleeWeapon | RangedWeapon;
const WEAPONS: Weapon[] = [
  { name: 'Bows', dmg: 10, cd: 0.55, range: 10, kind: 'arrow', speed: 30 },
  { name: 'Upgraded bows', dmg: 16, cd: 0.45, range: 11, kind: 'arrow2', speed: 34 },
  { name: 'Crossbows', dmg: 34, cd: 0.5, range: 12, kind: 'bolt', speed: 40 },
  { name: 'Spears', dmg: 62, cd: 0.55, range: 9.5, kind: 'spear', speed: 26, pierce: 3 },
  { name: 'Iron swords', dmg: 125, cd: 0.325, range: 1.7, kind: 'melee', leash: 6.5 },
  { name: 'Guns', dmg: 210, cd: 0.375, range: 14, kind: 'bullet', speed: 75 },
  { name: 'Machine guns', dmg: 95, cd: 0.07, range: 15, kind: 'bullet', speed: 85 },
];
const FORGE_COSTS = [135, 360, 840, 1800, 3600, 7200];
// walls come with the archer towers: each tower builds and upgrades the stretch of wall nearest to it
const WALL_TIERS = [
  { name: 'Palisade', hp: 700 },
  { name: 'Reinforced logs', hp: 1700 },
  { name: 'Stone walls', hp: 4200 },
  { name: 'Fortified stone', hp: 10000 },
  { name: 'Iron walls', hp: 24000 },
];
const TOWER_SPOTS: Pt[] = [
  [14, -4.5],
  [14, 4.5],
  [14, -12],
  [14, 12],
  [-14, -12],
  [-14, 12],
];
const TOWER_UP_PADS: Pt[] = [
  [10.4, -4.5],
  [10.4, 4.5],
  [10.6, -9.4],
  [10.6, 9.4],
  [-10.6, -9.4],
  [-10.6, 9.4],
];
const TOWER_COSTS = [30, 45, 70, 110, 170, 260];
const TOWER_UP = [50, 150, 400, 1000]; // to levels 2..5
const TOWER_LV = [
  { h: 3.45, archers: 3 },
  { h: 4.06, archers: 3 },
  { h: 4.67, archers: 4 },
  { h: 5.3, archers: 4 },
  { h: 5.92, archers: 5 },
];
// Outposts: the same towers, without walls, on the border where an enemy road crosses it. Each one built pushes
// the border out. The first needs two cannons; each costs more than the last. A field cannon spot comes with it.
const OUTPOST_COST = 700,
  OUTPOST_GROW = 1.4,
  OUTPOST_UP = 2.5,
  FIELD_CANNON_COST = 500,
  FIELD_CANNON_GROW = 1.3;
const PAD_IN = 8,
  SITE_SIDE = 4.6; // outpost pads stand this far inside the border, beside the road
const BARRACKS: Pt = [-11, 1.5],
  RECRUIT_PAD: Pt = [-6.8, 5.0],
  FORGE: Pt = [0, 8],
  FORGE_PAD: Pt = [-5.0, 9.6];
const BARRACKS_STEPS = [0, 3, 6, 10]; // recruit purchases before each barracks level
const CANNON_SPOTS: Pt[] = [
    [24, -14],
    [25, 10],
    [0, -30],
  ],
  CANNON_PADS: Pt[] = [
    [19.8, -12.4],
    [20.8, 11.8],
    [0.4, -25.6],
  ];
const CANNON_COSTS = [250, 400, 650],
  CANNON_MAX = 5,
  CANNON_TOP = [0.82, 0.95, 1.42, 1.42, 1.42];
const GOLD_HUT: Pt = [-6, 31],
  GOLD_PAD: Pt = [-11.6, 33.4],
  GOLD_PLOT: Pt = [-5.5, 36.8],
  GOLD_COSTS = [1500, 3000, 6000];
const GOLD_BOYS = [
  { n: 1, speed: 7.5, cap: 40 },
  { n: 2, speed: 8.5, cap: 80 },
  { n: 3, speed: 9.5, cap: 150 },
];
const RECRUIT: [cost: number, people: number][] = [
  [6, 1],
  [14, 3],
  [28, 3],
  [45, 3],
  [70, 4],
  [100, 4],
  [140, 5],
  [190, 5],
  [250, 6],
];

const CASTLE = { x: -5.5, z: -4.5, r: 3.1 };
// three roads into the castle from the east, north-east and south-east
const P0: Pt[] = [
  [56, -2],
  [46, -6],
  [36, -3],
  [27, -7],
  [20, -1],
  [15.4, 0],
  [3, 0],
  [CASTLE.x, CASTLE.z],
];
const P1: Pt[] = [
  [30, -52],
  [31, -42],
  [26, -33],
  [18, -25],
  [10, -19.5],
  [3, -13.2],
  [-1, -9],
  [CASTLE.x, CASTLE.z],
];
const P2: Pt[] = [
  [46, 44],
  [38, 37],
  [30, 30],
  [21, 23],
  [12, 18],
  [7, 13.5],
  [6, 6],
  [3, 0],
  [CASTLE.x, CASTLE.z],
];
const PATHS = [P0, P1, P2];
// The enemy marches from camps past the border, one per front, each down its own road to the castle. The first
// three fronts are there from the start and open after `open` seconds; the north road opens with the first
// cannon and the south road with the first outpost. `own` is how many points at the start of a road are its own
// (the rest is a road it joins).
interface FrontDef {
  id: string;
  road: Pt[];
  open: number | 'cannon' | 'outpost';
  own?: number;
}
const FRONTS: FrontDef[] = [
  { id: 'E', road: P0, open: 0 },
  { id: 'NE', road: P1, open: 8 },
  { id: 'SE', road: P2, open: 20 },
  { id: 'N', road: [[4, -88], [8, -76], [14, -66], [18, -56], [22, -46], ...P1.slice(2)], own: 6, open: 'cannon' }, // round the NE camp
  { id: 'S', road: [[16, 92], [10, 78], [16, 64], [13, 52], [19, 38], ...P2.slice(3)], own: 6, open: 'outpost' },
];
// enemies get tougher and richer the further out their camp is; their biome sets their colours and pace
const campTier = (c: XZ) => Math.max(0, (Math.hypot(c.x - HOME.x, c.z - HOME.z) - 62) / 32);
const tierHp = (t: number) => 1 + 0.6 * t + 0.1 * t * t,
  tierValue = (t: number) => 1 + 0.45 * t + 0.05 * t * t;
const BIOME_SPEED = [1, 1.08, 0.95, 1.05];
// enemy sizes; `cost` is how much of a group's budget one of them uses
const UNIT = {
  knight: {
    hp: 1,
    dmg: 1,
    value: 1,
    speed: 2.4,
    r: 0.5,
    scale: 1.15,
    cost: 1,
    bar: 2.1,
    barW: 1.1,
    atk: 1.2,
    shadow: 1.25,
  },
  brute: {
    hp: 5.5,
    dmg: 3,
    value: 4,
    speed: 2.0,
    r: 0.95,
    scale: 1.4,
    cost: 4,
    bar: 3.6,
    barW: 1.6,
    atk: 1.5,
    shadow: 2.1,
  },
  giant: {
    hp: 16,
    dmg: 5,
    value: 13,
    speed: 1.4,
    r: 1.3,
    scale: 2.3,
    cost: 12,
    bar: 5.6,
    barW: 2.2,
    atk: 1.8,
    shadow: 2.5,
  },
};
const PAL = [
  {
    // canyon: the red army from the reference
    knight: {
      legs: '#3a363c',
      body: '#cf2530',
      belt: '#7a1c22',
      light: '#e2343c',
      visor: '#4d1014',
      plume: '#e3262f',
      blade: '#dfe3ea',
      hilt: '#5a5a62',
      shield: '#f2a12c',
      shieldDk: '#c97d16',
    },
    brute: {
      legs: '#3a2f30',
      body: '#a3222b',
      dark: '#5e1418',
      light: '#c73038',
      trim: '#e0b13a',
      horn: '#efe6d6',
      visor: '#2a0b0d',
      handle: '#6b4528',
      blade: '#c9ced8',
    },
    giants: [
      {
        legs: '#4a3d3d',
        body: '#f6dcdc',
        skin: '#f3c9c6',
        helm: '#959aa6',
        helm2: '#a4a9b4',
        nose: '#6c707a',
        handle: '#6b4528',
        head: '#7f8590',
      },
      {
        legs: '#4a3d3d',
        body: '#d42a31',
        skin: '#f0a39c',
        helm: '#959aa6',
        helm2: '#a4a9b4',
        nose: '#6c707a',
        handle: '#6b4528',
        head: '#7f8590',
      },
    ],
  },
  {
    // frozen pass
    knight: {
      legs: '#3b4655',
      body: '#3e6fb6',
      belt: '#26466f',
      light: '#e9f2fa',
      visor: '#1c2f4a',
      plume: '#7fd0ff',
      blade: '#cfefff',
      hilt: '#5d6f84',
      shield: '#9fd6f5',
      shieldDk: '#4f8fc0',
    },
    brute: {
      legs: '#2f3a48',
      body: '#e8f0f7',
      dark: '#3e6fb6',
      light: '#bfdcf0',
      trim: '#7fd0ff',
      horn: '#cfe8f7',
      visor: '#13253a',
      handle: '#5a4632',
      blade: '#a8e6ff',
    },
    giants: [
      {
        legs: '#3b4655',
        body: '#eef5fb',
        skin: '#cfe2ee',
        helm: '#7fa8cc',
        helm2: '#9cc2e0',
        nose: '#4e7092',
        handle: '#5a4632',
        head: '#a8e6ff',
      },
    ],
  },
  {
    // mire
    knight: {
      legs: '#3b3226',
      body: '#557a2c',
      belt: '#30461a',
      light: '#6f9a38',
      visor: '#1b2a0f',
      plume: '#b8d84a',
      blade: '#c4c9b8',
      hilt: '#5a4a32',
      shield: '#8a6a3a',
      shieldDk: '#5e4626',
    },
    brute: {
      legs: '#3b3226',
      body: '#4a6e2a',
      dark: '#2c4218',
      light: '#7aa040',
      trim: '#8a6a3a',
      horn: '#d8cfa6',
      visor: '#141f0b',
      handle: '#5a4a32',
      blade: '#9aa08e',
    },
    giants: [
      {
        legs: '#3b3226',
        body: '#5d8a34',
        skin: '#8db45a',
        helm: '#6b5a3a',
        helm2: '#7d6a46',
        nose: '#4a3e28',
        handle: '#5a4a32',
        head: '#6e6a5e',
      },
    ],
  },
  {
    // ashlands
    knight: {
      legs: '#1c1b1f',
      body: '#2b2930',
      belt: '#141317',
      light: '#3d3a44',
      visor: '#ff8a1e',
      plume: '#ff6a12',
      blade: '#ffb347',
      hilt: '#3a3036',
      shield: '#4a2416',
      shieldDk: '#ff6a12',
    },
    brute: {
      legs: '#1c1b1f',
      body: '#2b2930',
      dark: '#16151a',
      light: '#46424e',
      trim: '#ff7a1a',
      horn: '#2a2529',
      visor: '#ff9a2e',
      handle: '#2a2026',
      blade: '#ff8a2a',
    },
    giants: [
      {
        legs: '#1c1b1f',
        body: '#34313a',
        skin: '#5a4a4a',
        helm: '#24222a',
        helm2: '#2f2c35',
        nose: '#ff7a1a',
        handle: '#2a2026',
        head: '#3a3540',
      },
    ],
  },
];
type Palette = (typeof PAL)[number];

const C = {
  sand: '#ba8b5b',
  sandDark: '#b98d5f',
  path: '#dcb98f',
  cliffTop: '#f1c98f',
  cliffSide: '#6e4b35',
  cliffSide2: '#5d3e2b',
  grass: '#5aa874',
  grassDark: '#4f9a68',
  stake: '#4e2f20',
  stakeTip: '#b98b62',
  wood: '#6b452d',
  woodLight: '#9a6a43',
  red: '#cf2530',
  redLight: '#e2343c',
  skin: '#f2cba6',
  hair: '#2e2b2d',
  white: '#f5f2ec',
  gold: '#ffc83a',
  blue: '#2d5ccc',
};

// ------------------------------------------------------- geometry helpers ----
const T = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const Cy = (rt: number, rb: number, h: number, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
const S = (
  r: number,
  w = 12,
  h = 9,
  ...rest: [phiStart?: number, phiLength?: number, thetaStart?: number, thetaLength?: number]
) => new THREE.SphereGeometry(r, w, h, ...rest);
const Co = (r: number, h: number, s = 8) => new THREE.ConeGeometry(r, h, s);
type Geo = THREE.BufferGeometry;
type Hex = THREE.ColorRepresentation;
function vc(g: Geo, hex: Hex, m?: THREE.Matrix4): Geo {
  const src = g.index ? g.toNonIndexed() : g;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', src.attributes.position.clone());
  geo.setAttribute('normal', src.attributes.normal.clone());
  if (m) geo.applyMatrix4(m);
  const n = geo.attributes.position.count,
    c = new THREE.Color(hex),
    col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
function merge(parts: Geo[]): Geo {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3),
    nor = new Float32Array(n * 3),
    col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3);
    nor.set(p.attributes.normal.array, o * 3);
    col.set(p.attributes.color.array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}
type Ctx = CanvasRenderingContext2D;
function canvasTex(w: number, h: number, draw: (g: Ctx, w: number, h: number) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.canvas = cv;
  return t;
}
function mulberry(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// a triangular prism (gable roof): base `w` wide, `h` tall, `d` deep along z
function gable(w: number, h: number, d: number): Geo {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}
// a ring of `n` boxes around the y axis, each facing outward (battlements, stakes)
function ringOf(n: number, r: number, y: number, w: number, h: number, d: number, hex: Hex, phase = 0): Geo[] {
  const out: Geo[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    out.push(vc(B(w, h, d), hex, T(Math.sin(a) * r, y, Math.cos(a) * r, 0, a, 0)));
  }
  return out;
}
const flag = (x: number, y: number, z: number, hex: Hex, len = 1.6) => [
  vc(Cy(0.05, 0.05, len, 6), '#5a3826', T(x, y + len / 2, z)),
  vc(B(0.75, 0.45, 0.04), hex, T(x + 0.4, y + len - 0.28, z)),
  vc(S(0.08, 6, 5), '#f5b81c', T(x, y + len + 0.04, z)),
];

// ----------------------------------------------------------------- models ----
function followerGeo(hairHex = C.hair, topHex = C.white, pantsHex = '#7a5638') {
  return merge([
    vc(B(0.17, 0.28, 0.2), '#3a2a22', T(-0.12, 0.14, 0)),
    vc(B(0.17, 0.28, 0.2), '#3a2a22', T(0.12, 0.14, 0)),
    vc(Cy(0.25, 0.27, 0.2, 10), pantsHex, T(0, 0.36, 0)),
    vc(Cy(0.2, 0.25, 0.36, 10), topHex, T(0, 0.63, 0)),
    vc(Cy(0.075, 0.065, 0.34, 6), C.skin, T(-0.31, 0.62, 0.05, 0.2, 0, 0.32)),
    vc(Cy(0.075, 0.065, 0.34, 6), C.skin, T(0.31, 0.62, 0.05, 0.2, 0, -0.32)),
    vc(S(0.37, 14, 10), C.skin, T(0, 1.1, 0)),
    vc(S(0.39, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), hairHex, T(0, 1.15, -0.05)),
    vc(S(0.385, 12, 6, Math.PI * 0.6, Math.PI * 0.8, Math.PI * 0.3, Math.PI * 0.35), hairHex, T(0, 1.12, -0.03)),
    vc(B(0.065, 0.1, 0.04), '#1d1616', T(-0.13, 1.08, 0.345)),
    vc(B(0.065, 0.1, 0.04), '#1d1616', T(0.13, 1.08, 0.345)),
    vc(B(0.13, 0.03, 0.04), hairHex, T(-0.13, 1.18, 0.335, 0, 0, 0.18)),
    vc(B(0.13, 0.03, 0.04), hairHex, T(0.13, 1.18, 0.335, 0, 0, -0.18)),
  ]);
}
function goldBoyGeo(): Geo {
  return merge([
    followerGeo('#7a4a22', '#f5c33a', '#6b4a2a'),
    vc(S(0.41, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.36), '#e0a020', T(0, 1.18, 0)),
    vc(B(0.42, 0.05, 0.26), '#c98a14', T(0, 1.3, 0.36, -0.2, 0, 0)),
  ]);
}
function sackGeo(): Geo {
  return merge([
    vc(S(0.34, 10, 8), '#c9a46a', T(0, 0, 0, 0, 0, 0, 1, 1.1, 0.9)),
    vc(Cy(0.09, 0.15, 0.16, 8), '#8a6a3a', T(0, 0.38, 0)),
    vc(Cy(0.12, 0.12, 0.03, 10), '#ffc83a', T(0.12, 0.2, 0.26, 1.2, 0, 0)),
  ]);
}
function weaponGeo(tier: number): Geo {
  switch (tier) {
    case 0:
      return merge([
        vc(
          new THREE.TorusGeometry(0.4, 0.035, 5, 14, Math.PI),
          '#8a5a2b',
          T(0.36, 0.75, 0.22, 0, Math.PI / 2, Math.PI / 2),
        ),
        vc(B(0.012, 0.8, 0.012), '#f2efe6', T(0.36, 0.75, 0.22)),
      ]);
    case 1:
      return merge([
        vc(
          new THREE.TorusGeometry(0.44, 0.045, 5, 14, Math.PI),
          '#e7b43c',
          T(0.36, 0.75, 0.24, 0, Math.PI / 2, Math.PI / 2),
        ),
        vc(B(0.015, 0.88, 0.015), '#bfeaff', T(0.36, 0.75, 0.24)),
        vc(S(0.07, 8, 6), '#7fd7ff', T(0.36, 1.19, 0.24)),
        vc(S(0.07, 8, 6), '#7fd7ff', T(0.36, 0.31, 0.24)),
      ]);
    case 2:
      return merge([
        vc(B(0.08, 0.08, 0.62), '#7a4a26', T(0.3, 0.72, 0.3)),
        vc(B(0.62, 0.05, 0.07), '#4a4f58', T(0.3, 0.74, 0.55)),
        vc(B(0.03, 0.03, 0.4), '#d9dde3', T(0.3, 0.79, 0.4)),
      ]);
    case 3:
      return merge([
        vc(Cy(0.03, 0.03, 1.7, 5), '#8a5a2b', T(0.36, 0.95, 0.12, 0.15, 0, 0)),
        vc(Co(0.07, 0.26, 5), '#d9dde3', T(0.36, 1.83, 0.25, 0.15, 0, 0)),
      ]);
    case 4:
      return merge([
        vc(B(0.08, 0.8, 0.025), '#e3e7ee', T(0.38, 0.98, 0.3, 0.55, 0, 0)),
        vc(B(0.26, 0.05, 0.07), '#e1b23a', T(0.38, 0.65, 0.12, 0.55, 0, 0)),
        vc(B(0.05, 0.18, 0.05), '#6b3d1f', T(0.38, 0.56, 0.06, 0.55, 0, 0)),
      ]);
    case 5:
      return merge([
        vc(Cy(0.04, 0.04, 0.75, 6), '#2f3238', T(0.3, 0.75, 0.42, Math.PI / 2, 0, 0)),
        vc(B(0.09, 0.14, 0.32), '#7a4a26', T(0.3, 0.7, 0.06)),
      ]);
    default:
      return merge([
        vc(B(0.16, 0.18, 0.62), '#26292f', T(0.3, 0.72, 0.28)),
        vc(Cy(0.045, 0.045, 0.5, 6), '#3c4048', T(0.3, 0.76, 0.75, Math.PI / 2, 0, 0)),
        vc(Cy(0.13, 0.13, 0.08, 10), '#c2a23a', T(0.3, 0.6, 0.26, 0, 0, Math.PI / 2)),
      ]);
  }
}
function knightGeo(shield: boolean, k: Palette['knight']): Geo {
  const parts = [
    vc(B(0.19, 0.28, 0.21), k.legs, T(-0.13, 0.14, 0)),
    vc(B(0.19, 0.28, 0.21), k.legs, T(0.13, 0.14, 0)),
    vc(Cy(0.28, 0.3, 0.5, 8), k.body, T(0, 0.52, 0)),
    vc(Cy(0.3, 0.3, 0.06, 8), k.belt, T(0, 0.36, 0)),
    vc(S(0.13, 8, 6), k.light, T(-0.32, 0.7, 0)),
    vc(S(0.13, 8, 6), k.light, T(0.32, 0.7, 0)),
    vc(Cy(0.31, 0.34, 0.5, 10), k.light, T(0, 1.02, 0)),
    vc(S(0.31, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), k.light, T(0, 1.27, 0)),
    vc(B(0.36, 0.045, 0.05), k.visor, T(0, 1.05, 0.31)),
    vc(B(0.36, 0.045, 0.05), k.visor, T(0, 0.95, 0.31)),
    vc(B(0.045, 0.24, 0.05), k.visor, T(0, 1.0, 0.32)),
    vc(B(0.14, 0.12, 0.42), k.plume, T(0, 1.46, -0.02, -0.25, 0, 0)),
    vc(B(0.14, 0.12, 0.36), k.plume, T(0, 1.42, -0.36, 0.55, 0, 0)),
    vc(B(0.14, 0.12, 0.3), k.plume, T(0, 1.2, -0.52, 1.25, 0, 0)),
    vc(B(0.07, 0.05, 0.85), k.blade, T(0.36, 0.55, 0.46, 0.35, 0, 0)),
    vc(B(0.2, 0.05, 0.06), k.hilt, T(0.36, 0.62, 0.06, 0.35, 0, 0)),
  ];
  if (shield)
    parts.push(
      vc(Cy(0.3, 0.3, 0.06, 14), k.shield, T(-0.36, 0.62, 0.18, Math.PI / 2, 0, 0)),
      vc(Cy(0.12, 0.12, 0.08, 10), k.shieldDk, T(-0.36, 0.62, 0.21, Math.PI / 2, 0, 0)),
    );
  return merge(parts);
}
// the middle size: a horned brute with a two-handed axe
function bruteGeo(b: Palette['brute']): Geo {
  return merge([
    vc(B(0.26, 0.36, 0.28), b.legs, T(-0.19, 0.18, 0)),
    vc(B(0.26, 0.36, 0.28), b.legs, T(0.19, 0.18, 0)),
    vc(Cy(0.42, 0.44, 0.34, 10), b.dark, T(0, 0.52, 0)),
    vc(Cy(0.5, 0.42, 0.7, 10), b.body, T(0, 1.02, 0)),
    vc(Cy(0.47, 0.47, 0.09, 10), b.trim, T(0, 0.7, 0)),
    vc(S(0.24, 10, 7), b.light, T(-0.52, 1.28, 0)),
    vc(S(0.24, 10, 7), b.light, T(0.52, 1.28, 0)),
    vc(Cy(0.12, 0.11, 0.55, 7), b.light, T(-0.6, 0.98, 0.1, 0.3, 0, 0.25)),
    vc(Cy(0.12, 0.11, 0.55, 7), b.light, T(0.6, 1.0, 0.16, -0.5, 0, -0.25)),
    vc(S(0.13, 8, 6), b.light, T(-0.66, 0.72, 0.2)),
    vc(S(0.13, 8, 6), b.light, T(0.62, 0.9, 0.4)),
    vc(Cy(0.3, 0.33, 0.42, 10), b.light, T(0, 1.58, 0)),
    vc(S(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), b.light, T(0, 1.79, 0)),
    vc(B(0.36, 0.06, 0.06), b.visor, T(0, 1.6, 0.3)),
    vc(B(0.06, 0.2, 0.06), b.visor, T(0, 1.52, 0.31)),
    vc(Co(0.08, 0.42, 6), b.horn, T(-0.34, 1.92, 0, 0, 0, 0.9)),
    vc(Co(0.08, 0.42, 6), b.horn, T(0.34, 1.92, 0, 0, 0, -0.9)),
    vc(Cy(0.045, 0.045, 1.6, 6), b.handle, T(0.55, 1.0, 0.45, 0.5, 0, 0)),
    vc(B(0.07, 0.5, 0.42), b.blade, T(0.55, 1.62, 0.78, 0.5, 0, 0)),
  ]);
}
function giantGeo(g: Palette['giants'][number]): Geo {
  return merge([
    vc(B(0.26, 0.4, 0.3), g.legs, T(-0.2, 0.2, 0)),
    vc(B(0.26, 0.4, 0.3), g.legs, T(0.2, 0.2, 0)),
    vc(Cy(0.45, 0.5, 0.8, 10), g.body, T(0, 0.8, 0)),
    vc(S(0.47, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), g.body, T(0, 1.18, 0)),
    vc(Cy(0.16, 0.13, 0.75, 8), g.skin, T(-0.58, 0.95, 0.08, 0.2, 0, 0.35)),
    vc(Cy(0.16, 0.13, 0.75, 8), g.skin, T(0.58, 1.05, 0.1, -0.9, 0, -0.3)),
    vc(S(0.19, 8, 6), g.skin, T(-0.72, 0.62, 0.2)),
    vc(S(0.19, 8, 6), g.skin, T(0.68, 1.3, 0.48)),
    vc(Cy(0.3, 0.33, 0.42, 10), g.helm, T(0, 1.5, 0.05)),
    vc(S(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), g.helm2, T(0, 1.7, 0.05)),
    vc(B(0.06, 0.3, 0.06), g.nose, T(0, 1.46, 0.36)),
    vc(Cy(0.06, 0.06, 1.2, 6), g.handle, T(0.68, 1.55, 0.25, 0.9, 0, 0)),
    vc(B(0.46, 0.4, 0.4), g.head, T(0.68, 1.85, -0.25, 0.9, 0, 0)),
  ]);
}
function kingGeo(): Geo {
  return merge([
    // horse
    vc(new THREE.CapsuleGeometry(0.36, 0.75, 4, 10), '#efe3d6', T(0, 0.82, 0, Math.PI / 2, 0, 0)),
    vc(S(0.22, 8, 6), '#a0673c', T(0.18, 0.95, -0.2)),
    ...[
      [-0.2, 0.42],
      [0.2, 0.42],
      [-0.2, -0.42],
      [0.2, -0.42],
    ].map(([x, z]) => vc(Cy(0.09, 0.08, 0.6, 6), '#efe3d6', T(x, 0.3, z))),
    ...[
      [-0.2, 0.42],
      [0.2, 0.42],
      [-0.2, -0.42],
      [0.2, -0.42],
    ].map(([x, z]) => vc(Cy(0.1, 0.1, 0.1, 6), '#6b4a35', T(x, 0.05, z))),
    vc(B(0.26, 0.5, 0.3), '#efe3d6', T(0, 1.15, 0.6, 0.5, 0, 0)),
    vc(B(0.26, 0.28, 0.46), '#efe3d6', T(0, 1.32, 0.86, 0.25, 0, 0)),
    vc(B(0.08, 0.16, 0.06), '#e2cfbd', T(-0.09, 1.52, 0.7)),
    vc(B(0.08, 0.16, 0.06), '#e2cfbd', T(0.09, 1.52, 0.7)),
    vc(B(0.08, 0.36, 0.3), '#8b5a2b', T(0, 1.3, 0.56, 0.5, 0, 0)),
    vc(Cy(0.06, 0.02, 0.5, 5), '#8b5a2b', T(0, 0.75, -0.62, -0.6, 0, 0)),
    vc(B(0.66, 0.06, 0.62), '#2d5ccc', T(0, 1.18, -0.05)),
    // king
    vc(Cy(0.27, 0.3, 0.55, 10), C.blue, T(0, 1.5, 0)),
    vc(S(0.15, 8, 6), '#cfd3dc', T(-0.3, 1.66, 0)),
    vc(S(0.15, 8, 6), '#cfd3dc', T(0.3, 1.66, 0)),
    vc(Cy(0.075, 0.07, 0.36, 6), '#cfd3dc', T(-0.36, 1.48, 0.1, 0.3, 0, 0.3)),
    vc(Cy(0.075, 0.07, 0.36, 6), '#cfd3dc', T(0.36, 1.48, 0.1, 0.3, 0, -0.3)),
    vc(B(0.62, 0.62, 0.06), '#2449a8', T(0, 1.45, -0.3, 0.15, 0, 0)),
    vc(S(0.35, 14, 10), C.skin, T(0, 2.0, 0)),
    vc(S(0.3, 10, 7, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), '#6a3b20', T(0, 1.97, 0.07)),
    vc(B(0.06, 0.08, 0.04), '#1d1616', T(-0.12, 2.03, 0.33)),
    vc(B(0.06, 0.08, 0.04), '#1d1616', T(0.12, 2.03, 0.33)),
    vc(Cy(0.3, 0.27, 0.2, 10), '#f5b81c', T(0, 2.3, 0)),
    vc(Cy(0.27, 0.27, 0.04, 10), '#d9970f', T(0, 2.21, 0)),
    ...[0, 1, 2, 3, 4].map((i) =>
      vc(Co(0.07, 0.2, 5), '#f5b81c', T(Math.sin(i * 1.2566) * 0.28, 2.48, Math.cos(i * 1.2566) * 0.28)),
    ),
    vc(S(0.06, 6, 5), '#d8262e', T(0, 2.3, 0.3)),
  ]);
}

// Archer towers, levels 1..5: wooden lookout, tall lookout, stone-footed, stone, fortified.
// The archers stand at TOWER_LV[lv-1].h.
function towerGeo(lv: number): Geo {
  const p: Geo[] = [],
    wood = '#5a3b28',
    wood2 = '#6e4a32',
    plank = '#8a5a36',
    rail = '#7a4c2f';
  const stone = '#a39e95',
    stoneDk = '#858078',
    stoneLt = '#b4afa6';
  const rails = (y: number, r: number) => {
    for (const [x, z, a] of [
      [0, r, 0],
      [0, -r, 0],
      [r, 0, Math.PI / 2],
      [-r, 0, Math.PI / 2],
    ])
      p.push(vc(Cy(0.09, 0.09, 2 * r + 0.1, 6), rail, T(x, y, z, 0, a, Math.PI / 2)));
    for (const [x, z] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      p.push(vc(B(0.14, 0.62, 0.14), wood, T(x * r, y - 0.18, z * r)));
  };
  if (lv === 1) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      p.push(vc(Cy(0.17, 0.19, 3.3, 7), i % 2 ? wood : wood2, T(Math.cos(a) * 0.62, 1.65, Math.sin(a) * 0.62)));
    }
    for (const [x, z] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      p.push(vc(Cy(0.12, 0.13, 2.6, 6), wood, T(x * 0.95, 1.1, z * 0.95, -z * 0.32, 0, x * 0.32)));
    p.push(vc(B(1.7, 0.12, 0.12), wood2, T(0, 1.2, 0.7)), vc(B(0.12, 0.12, 1.7), wood2, T(0.7, 1.2, 0)));
    p.push(vc(B(2.2, 0.22, 2.2), plank, T(0, 3.35, 0)));
    for (const [x, z, r] of [
      [0, 1.05, 0],
      [0, -1.05, 0],
      [1.05, 0, Math.PI / 2],
      [-1.05, 0, Math.PI / 2],
    ])
      p.push(vc(Cy(0.1, 0.1, 2.3, 6), rail, T(x, 3.5, z, 0, r, Math.PI / 2)));
  } else if (lv === 2) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      p.push(vc(Cy(0.18, 0.2, 3.9, 7), i % 2 ? wood : wood2, T(Math.cos(a) * 0.72, 1.95, Math.sin(a) * 0.72)));
    }
    for (const [x, z] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      p.push(vc(Cy(0.13, 0.14, 3.2, 6), wood, T(x * 1.08, 1.4, z * 1.08, -z * 0.3, 0, x * 0.3)));
    for (const y of [1.3, 2.6])
      p.push(
        vc(B(1.9, 0.13, 0.13), wood2, T(0, y, 0.8)),
        vc(B(0.13, 0.13, 1.9), wood2, T(0.8, y, 0)),
        vc(B(1.9, 0.13, 0.13), wood2, T(0, y, -0.8)),
        vc(B(0.13, 0.13, 1.9), wood2, T(-0.8, y, 0)),
      );
    p.push(vc(B(2.5, 0.24, 2.5), plank, T(0, 3.95, 0)), vc(B(2.6, 0.08, 2.6), wood, T(0, 3.8, 0)));
    rails(4.3, 1.2);
    // ladder on the front
    p.push(vc(B(0.07, 3.8, 0.07), wood2, T(-0.25, 1.9, 0.95)), vc(B(0.07, 3.8, 0.07), wood2, T(0.25, 1.9, 0.95)));
    for (let i = 0; i < 7; i++) p.push(vc(B(0.5, 0.05, 0.06), wood2, T(0, 0.4 + i * 0.5, 0.95)));
    p.push(...flag(-1.2, 4.0, -1.2, '#2d5ccc', 1.6));
  } else if (lv === 3) {
    p.push(vc(Cy(1.3, 1.45, 2.3, 12), stone, T(0, 1.15, 0)));
    for (const y of [0.75, 1.55, 2.28]) p.push(vc(Cy(1.36, 1.36, 0.1, 12), stoneDk, T(0, y, 0)));
    p.push(vc(B(0.55, 0.85, 0.1), '#3b2a20', T(0, 0.45, 1.4)));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      p.push(vc(Cy(0.13, 0.15, 2.4, 6), i % 2 ? wood : wood2, T(Math.cos(a) * 0.95, 3.45, Math.sin(a) * 0.95)));
    }
    p.push(
      vc(B(2.0, 0.13, 0.13), wood2, T(0, 3.3, 0.92)),
      vc(B(0.13, 0.13, 2.0), wood2, T(0.92, 3.3, 0)),
      vc(B(2.0, 0.13, 0.13), wood2, T(0, 3.3, -0.92)),
      vc(B(0.13, 0.13, 2.0), wood2, T(-0.92, 3.3, 0)),
    );
    p.push(vc(B(2.7, 0.26, 2.7), plank, T(0, 4.55, 0)), vc(B(2.8, 0.1, 2.8), wood, T(0, 4.4, 0)));
    rails(4.92, 1.3);
    p.push(...flag(-1.3, 4.6, -1.3, '#2d5ccc', 2.0));
  } else if (lv === 4) {
    p.push(vc(Cy(1.2, 1.45, 5.0, 14), stone, T(0, 2.5, 0)));
    for (const y of [1.25, 2.55, 3.85]) {
      const r = 1.45 - 0.05 * y + 0.05;
      p.push(vc(Cy(r, r, 0.12, 14), stoneDk, T(0, y, 0)));
    }
    p.push(vc(B(0.6, 0.95, 0.1), '#3b2a20', T(0, 0.5, 1.42)));
    for (let i = 0; i < 3; i++) {
      const a = 0.3 + i * 1.2;
      p.push(vc(B(0.22, 0.5, 0.1), '#2b2420', T(Math.sin(a) * 1.3, 3.2, Math.cos(a) * 1.3, 0, a, 0)));
    }
    p.push(vc(Cy(1.6, 1.38, 0.4, 14), stoneLt, T(0, 5.1, 0)));
    p.push(...ringOf(8, 1.42, 5.55, 0.5, 0.5, 0.34, stoneLt));
    p.push(...flag(-0.95, 5.3, -0.95, '#d8262e', 2.2));
  } else {
    p.push(vc(B(3.0, 1.0, 3.0), stoneDk, T(0, 0.5, 0)), vc(B(3.12, 0.14, 3.12), '#e0b13a', T(0, 1.02, 0)));
    p.push(vc(Cy(1.28, 1.5, 4.6, 14), '#9a958e', T(0, 3.3, 0)));
    for (const y of [2.3, 3.9]) {
      const r = 1.5 - (y - 1.0) * 0.0478 + 0.05;
      p.push(vc(Cy(r, r, 0.13, 14), '#e0b13a', T(0, y, 0)));
    }
    p.push(vc(Cy(1.8, 1.45, 0.42, 14), stoneLt, T(0, 5.71, 0)));
    p.push(...ringOf(10, 1.62, 6.18, 0.46, 0.55, 0.36, stoneLt), ...ringOf(10, 1.62, 6.5, 0.48, 0.08, 0.38, '#e0b13a'));
    // hanging banner and braziers
    p.push(
      vc(B(0.95, 1.9, 0.06), '#2d5ccc', T(0, 3.75, 1.47)),
      vc(B(0.4, 0.4, 0.07), '#ffd34a', T(0, 4.0, 1.5, 0, 0, Math.PI / 4)),
      vc(Co(0.48, 0.4, 3), '#2d5ccc', T(0, 2.62, 1.47, Math.PI, 0, 0, 1, 1, 0.12)),
    );
    for (const s of [-1, 1])
      p.push(
        vc(Cy(0.2, 0.12, 0.28, 8), '#2f2a28', T(s * 1.25, 6.1, 1.0)),
        vc(Co(0.15, 0.36, 6), '#ffae2a', T(s * 1.25, 6.4, 1.0)),
      );
    p.push(...flag(-1.05, 5.9, -1.05, '#2d5ccc', 2.6));
  }
  return merge(p);
}
function castleGeo(): Geo {
  // a timber keep in the same materials as the barracks: stone ground floor, wooden upper floor, steep shingle roofs
  const stone = '#9b968d',
    stoneDk = '#7f7a72',
    wood = '#5b3d2b',
    beam = '#7a5234',
    roof = '#93624a',
    roofDk = '#7c503b',
    p: Geo[] = [];
  p.push(vc(B(5.0, 0.6, 5.0), '#8a8c8a', T(0, 0.3, 0)));
  p.push(vc(B(4.2, 2.0, 4.2), stone, T(0, 1.6, 0)));
  for (const y of [1.0, 2.0]) p.push(vc(B(4.25, 0.08, 4.25), stoneDk, T(0, y, 0)));
  p.push(vc(B(4.6, 0.2, 4.6), beam, T(0, 2.7, 0)));
  p.push(vc(B(4.4, 1.7, 4.4), wood, T(0, 3.65, 0)));
  for (const [x, z] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ])
    p.push(vc(B(0.22, 1.7, 0.22), beam, T(x * 2.18, 3.65, z * 2.18)));
  p.push(vc(B(4.5, 0.18, 4.5), beam, T(0, 4.55, 0)));
  p.push(vc(Co(3.65, 2.6, 4), roof, T(0, 5.95, 0, 0, Math.PI / 4, 0)));
  p.push(vc(B(1.2, 1.6, 0.14), '#33241b', T(0, 1.4, 2.12)), vc(B(1.5, 0.22, 0.2), beam, T(0, 2.3, 2.14)));
  for (const x of [-1.2, 1.2])
    p.push(vc(B(0.6, 0.55, 0.08), '#2b3640', T(x, 3.7, 2.22)), vc(B(0.08, 0.55, 0.1), beam, T(x, 3.7, 2.24)));
  for (const z of [-1.2, 1.2]) p.push(vc(B(0.08, 0.55, 0.6), '#2b3640', T(2.22, 3.7, z)));
  // corner turret
  p.push(vc(Cy(0.9, 1.0, 5.2, 10), stone, T(-2.0, 2.6, -2.0)), vc(Cy(1.05, 1.05, 0.22, 10), beam, T(-2.0, 5.25, -2.0)));
  p.push(vc(Co(1.3, 2.4, 10), roofDk, T(-2.0, 6.55, -2.0)));
  p.push(vc(B(0.18, 0.4, 0.06), '#33241b', T(-2.0, 3.9, -1.08)));
  p.push(
    vc(Cy(0.05, 0.05, 1.6, 6), '#5a3826', T(-2.0, 8.4, -2.0)),
    vc(B(0.9, 0.55, 0.05), '#d8262e', T(-1.55, 8.85, -2.0)),
    vc(S(0.09, 6, 5), '#f5b81c', T(-2.0, 9.22, -2.0)),
  );
  return merge(p);
}
function anvilIcon(g: Ctx): void {
  g.fillStyle = '#fff';
  g.strokeStyle = INK;
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(-50, -26);
  g.lineTo(30, -26);
  g.quadraticCurveTo(52, -24, 54, -10);
  g.lineTo(20, -6);
  g.lineTo(12, 8);
  g.lineTo(26, 30);
  g.lineTo(-30, 30);
  g.lineTo(-18, 8);
  g.lineTo(-26, -6);
  g.lineTo(-44, -10);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.roundRect(-36, 30, 72, 14, 4);
  g.fill();
  g.stroke();
}
// Cannons, levels 1..5: a static base and a turret (carriage and barrels) that turns
function cannonBaseGeo(lv: number): Geo {
  const p: Geo[] = [];
  if (lv === 1)
    p.push(vc(Cy(1.25, 1.4, 0.8, 10), '#8d8d94', T(0, 0.4, 0)), vc(Cy(1.3, 1.3, 0.14, 10), '#a3a3aa', T(0, 0.82, 0)));
  else if (lv === 2) {
    p.push(
      vc(Cy(1.45, 1.6, 0.9, 12), '#8d8d94', T(0, 0.45, 0)),
      vc(Cy(1.52, 1.52, 0.14, 12), '#a3a3aa', T(0, 0.92, 0)),
    );
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      p.push(
        vc(
          Cy(0.07, 0.09, 0.8, 5),
          C.stake,
          T(Math.sin(a) * 1.72, 0.35, Math.cos(a) * 1.72, Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25),
        ),
        vc(
          Co(0.07, 0.18, 5),
          C.stakeTip,
          T(Math.sin(a) * 1.82, 0.82, Math.cos(a) * 1.82, Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25),
        ),
      );
    }
  } else {
    const stone = lv >= 5 ? '#9a958e' : '#a39e95';
    p.push(
      vc(Cy(1.75, 1.9, 1.3, 8), stone, T(0, 0.65, 0, 0, Math.PI / 8, 0)),
      vc(Cy(1.85, 1.85, 0.16, 8), '#858078', T(0, 1.34, 0, 0, Math.PI / 8, 0)),
    );
    p.push(vc(Cy(1.92, 1.92, 0.1, 8), '#858078', T(0, 0.5, 0, 0, Math.PI / 8, 0)));
    p.push(...ringOf(8, 1.66, 1.62, 0.55, 0.45, 0.34, '#b4afa6'));
    if (lv >= 4)
      p.push(vc(B(0.7, 0.25, 0.5), '#858078', T(0, 0.12, 2.0)), vc(B(0.7, 0.25, 0.5), '#858078', T(0, 0.37, 1.75)));
    if (lv >= 5) {
      p.push(
        vc(Cy(1.96, 1.96, 0.12, 8), '#e0b13a', T(0, 1.0, 0, 0, Math.PI / 8, 0)),
        ...ringOf(8, 1.66, 1.88, 0.57, 0.08, 0.36, '#e0b13a'),
        ...flag(-1.4, 1.4, -1.4, '#2d5ccc', 2.4),
      );
    }
  }
  return merge(p);
}
function cannonTurretGeo(lv: number): Geo {
  const p = [
    vc(B(1.0, 0.45, 1.2), lv >= 3 ? '#5b3d2b' : '#6b452d', T(0, 0.28, 0)),
    vc(Cy(0.32, 0.32, 0.1, 10), '#3d2a1e', T(-0.55, 0.23, 0.2, 0, 0, Math.PI / 2)),
    vc(Cy(0.32, 0.32, 0.1, 10), '#3d2a1e', T(0.55, 0.23, 0.2, 0, 0, Math.PI / 2)),
  ];
  const barrel = (x: number, r: number, len: number, hex: Hex, ring: Hex) => {
    p.push(
      vc(Cy(r * 0.78, r, len, 12), hex, T(x, 0.63, 0.45 + (len - 1.5) * 0.3, Math.PI / 2, 0, 0)),
      vc(Cy(r * 0.9, r * 0.9, 0.12, 12), ring, T(x, 0.63, 0.45 + len * 0.5 + (len - 1.5) * 0.3, Math.PI / 2, 0, 0)),
      vc(S(r, 10, 8), hex, T(x, 0.63, -0.3)),
    );
    if (lv >= 3) p.push(vc(Cy(r * 1.02, r * 1.02, 0.1, 12), '#e0b13a', T(x, 0.63, 0.2, Math.PI / 2, 0, 0)));
  };
  if (lv === 1) barrel(0, 0.34, 1.5, '#2d2f36', '#4a4d55');
  else if (lv === 2) barrel(0, 0.36, 1.8, '#b07a2e', '#8a5a1e');
  else if (lv === 3) barrel(0, 0.38, 1.9, '#3a3d45', '#e0b13a');
  else if (lv === 4) {
    barrel(-0.3, 0.3, 1.9, '#3a3d45', '#e0b13a');
    barrel(0.3, 0.3, 1.9, '#3a3d45', '#e0b13a');
  } else {
    barrel(0, 0.46, 2.1, '#2a2c33', '#e0b13a');
    p.push(vc(Cy(0.5, 0.5, 0.12, 12), '#e0b13a', T(0, 0.63, 0.75, Math.PI / 2, 0, 0)));
  }
  return merge(p);
}
// Barracks, levels 1..4, grow with the troop
function barracksGeo(lv: number): Geo {
  const beam = '#7a5234',
    wood = '#5b3d2b',
    roofC = '#93624a',
    parts = [vc(B(4.0, 0.6, 3.4), '#8a8c8a', T(0, 0.3, 0))];
  if (lv <= 2) {
    parts.push(
      vc(B(3.6, 1.7, 3.0), wood, T(0, 1.45, 0)),
      vc(B(3.7, 0.16, 3.1), beam, T(0, 2.3, 0)),
      vc(gable(4.2, 2.0, 3.6), roofC, T(0, 2.35, 0, 0, Math.PI / 2, 0)),
      vc(B(0.9, 1.2, 0.08), '#33241b', T(0, 1.2, 1.52)),
      vc(B(0.6, 0.5, 0.08), '#2b3640', T(-1.15, 1.6, 1.52)),
      vc(B(0.6, 0.5, 0.08), '#2b3640', T(1.15, 1.6, 1.52)),
    );
    for (const [x, z] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      parts.push(vc(B(0.14, 1.7, 0.14), beam, T(x * 1.75, 1.45, z * 1.45)));
  } else {
    parts.push(
      vc(B(3.7, 1.5, 3.1), '#a39e95', T(0, 1.35, 0)),
      vc(B(3.75, 0.1, 3.15), '#858078', T(0, 1.0, 0)),
      vc(B(3.9, 0.18, 3.3), beam, T(0, 2.15, 0)),
      vc(B(3.8, 1.3, 3.2), wood, T(0, 2.85, 0)),
      vc(B(4.0, 0.18, 3.4), beam, T(0, 3.55, 0)),
      vc(gable(4.4, 2.2, 3.9), roofC, T(0, 3.6, 0, 0, Math.PI / 2, 0)),
      vc(B(1.0, 1.3, 0.08), '#33241b', T(0, 1.25, 1.57)),
      vc(B(1.3, 0.2, 0.16), beam, T(0, 2.0, 1.6)),
    );
    for (const x of [-1.2, 0, 1.2]) parts.push(vc(B(0.55, 0.55, 0.08), '#2b3640', T(x, 2.9, 1.62)));
    for (const [x, z] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      parts.push(vc(B(0.16, 1.3, 0.16), beam, T(x * 1.86, 2.85, z * 1.56)));
    parts.push(
      vc(B(0.7, 1.25, 0.05), '#2d5ccc', T(1.55, 2.55, 1.66)),
      vc(B(0.7, 1.25, 0.05), '#2d5ccc', T(-1.55, 2.55, 1.66)),
    );
  }
  if (lv >= 2) {
    // chimney, a lean-to with a weapon rack and barrels
    const top = lv >= 3 ? 5.2 : 4.0;
    parts.push(
      vc(B(0.55, top - 1.2, 0.55), '#8a8580', T(1.15, 1.2 + (top - 1.2) / 2, -0.95)),
      vc(B(0.68, 0.14, 0.68), '#6f6a65', T(1.15, top, -0.95)),
    );
    for (const z of [-1.1, 1.1]) parts.push(vc(Cy(0.07, 0.08, 1.6, 6), beam, T(2.75, 0.8, z)));
    parts.push(vc(B(1.1, 0.1, 2.7), roofC, T(2.4, 1.7, 0, 0, 0, -0.32)));
    parts.push(vc(B(0.1, 1.0, 1.9), beam, T(2.1, 0.75, 0)));
    for (let i = 0; i < 3; i++)
      parts.push(
        vc(
          new THREE.TorusGeometry(0.32, 0.03, 5, 12, Math.PI),
          '#8a5a2b',
          T(2.2, 0.8, -0.6 + i * 0.6, 0, Math.PI / 2, Math.PI / 2),
        ),
      );
    parts.push(
      vc(Cy(0.28, 0.32, 0.65, 10), '#7a4a26', T(-2.25, 0.32, 1.0)),
      vc(Cy(0.28, 0.32, 0.65, 10), '#7a4a26', T(-2.3, 0.32, 0.35)),
    );
  }
  if (lv >= 4) {
    // a round watch tower on the side, with a pointed roof and a flag
    parts.push(
      vc(Cy(0.95, 1.05, 4.6, 12), '#a39e95', T(2.5, 2.3, -0.6)),
      vc(Cy(1.12, 1.12, 0.22, 12), beam, T(2.5, 4.65, -0.6)),
    );
    parts.push(vc(Co(1.25, 1.9, 12), '#7c503b', T(2.5, 5.7, -0.6)), ...flag(2.5, 6.6, -0.6, '#2d5ccc', 1.4));
    parts.push(vc(B(0.2, 0.45, 0.06), '#33241b', T(2.5, 3.2, 0.42)));
  }
  return merge(parts);
}
// Forge, one level per weapon tier: an open-air anvil that grows into a gun factory
function forgeGeo(lv: number): Geo {
  const wallC = lv >= 5 ? '#a4553a' : '#a39e95',
    roofC = lv >= 5 ? '#6d7480' : '#7c503b',
    p: Geo[] = [];
  p.push(
    vc(Cy(0.95, 1.05, 1.5, 8), '#6b6b70', T(0, 0.75, 0)),
    vc(Cy(1.08, 1.0, 0.22, 8), '#4f4f55', T(0, 1.55, 0)),
    vc(B(0.42, 0.32, 0.06), '#ff8a2a', T(0, 0.8, 1.0)),
    vc(B(0.5, 0.45, 0.4), '#5b5d63', T(1.7, 0.22, 0.6)),
    vc(B(0.95, 0.24, 0.45), '#6e7179', T(1.7, 0.57, 0.6)),
    vc(Co(0.22, 0.4, 4), '#6e7179', T(2.26, 0.57, 0.6, 0, 0, -Math.PI / 2)),
    vc(B(0.8, 0.08, 0.7), '#8a5a36', T(1.7, 0.02, 0.6)),
    vc(B(2.3, 0.12, 2.0), '#8a5a36', T(0.2, 0.06, -1.9)),
    vc(B(2.1, 0.06, 1.8), '#a46c43', T(0.2, 0.14, -1.9)),
  );
  if (lv >= 1) {
    for (const [x, z, h] of [
      [-0.8, -1.0, 2.2],
      [1.2, -1.0, 2.2],
      [-0.8, -2.8, 2.7],
      [1.2, -2.8, 2.7],
    ])
      p.push(vc(Cy(0.09, 0.1, h, 6), '#5a3b28', T(x, h / 2, z)));
    if (lv < 4) p.push(vc(B(2.6, 0.12, 2.3), '#93624a', T(0.2, 2.45, -1.9, 0.22, 0, 0)));
    p.push(
      vc(Cy(0.32, 0.36, 0.75, 10), '#7a4a26', T(-1.45, 0.38, 0.5)),
      vc(Cy(0.37, 0.37, 0.06, 10), '#3a3a3e', T(-1.45, 0.2, 0.5)),
      vc(Cy(0.37, 0.37, 0.06, 10), '#3a3a3e', T(-1.45, 0.56, 0.5)),
    );
    p.push(vc(B(1.6, 0.08, 0.08), '#7a5234', T(0.2, 1.25, -2.75)));
    for (let i = 0; i < 3; i++)
      p.push(
        vc(
          new THREE.TorusGeometry(0.3, 0.03, 5, 12, Math.PI),
          '#8a5a2b',
          T(-0.3 + i * 0.5, 1.0, -2.72, 0, 0, Math.PI / 2),
        ),
      );
  }
  if (lv >= 2) {
    p.push(vc(B(3.0, 2.1, 0.35), wallC, T(0.2, 1.05, -3.05)));
    p.push(
      vc(B(0.9, 0.4, 0.5), '#6b452d', T(-1.5, 0.2, -0.6)),
      vc(B(0.78, 0.05, 0.38), '#4a8fc0', T(-1.5, 0.41, -0.6)),
    );
    for (const x of [-0.5, 0.9])
      p.push(
        vc(B(0.7, 0.07, 0.08), '#5b3d2b', T(x, 1.6, -2.84)),
        vc(B(0.08, 0.07, 0.5), '#5b3d2b', T(x, 1.6, -2.84, Math.PI / 2, 0, 0)),
      );
  }
  if (lv >= 3) {
    p.push(
      vc(B(0.9, 3.8, 0.9), lv >= 5 ? '#8f4a33' : '#8a8580', T(-1.2, 1.9, -2.7)),
      vc(B(1.05, 0.2, 1.05), '#6f6a65', T(-1.2, 3.85, -2.7)),
      vc(B(0.6, 0.05, 0.6), '#222', T(-1.2, 3.97, -2.7)),
    );
    for (let i = 0; i < 4; i++)
      p.push(
        vc(Cy(0.03, 0.03, 1.9, 5), '#8a5a2b', T(1.55 + i * 0.22, 0.95, -2.55, -0.12, 0, 0)),
        vc(Co(0.06, 0.22, 5), '#d9dde3', T(1.55 + i * 0.22, 1.98, -2.67, -0.12, 0, 0)),
      );
    p.push(
      vc(B(0.4, 0.35, 0.34), '#5b5d63', T(-0.4, 0.17, 1.35)),
      vc(B(0.75, 0.2, 0.38), '#6e7179', T(-0.4, 0.45, 1.35)),
    );
  }
  if (lv >= 4) {
    p.push(vc(B(0.35, 2.1, 2.2), wallC, T(-1.4, 1.05, -2.05)));
    p.push(vc(gable(3.4, 1.3, 2.6), roofC, T(0.25, 2.1, -2.0)));
    p.push(
      vc(Cy(0.45, 0.45, 0.15, 14), '#9a9a9e', T(2.35, 0.6, -0.9, 0, 0, Math.PI / 2)),
      vc(B(0.12, 0.6, 0.12), '#6b452d', T(2.25, 0.3, -0.9)),
      vc(B(0.12, 0.6, 0.12), '#6b452d', T(2.45, 0.3, -0.9)),
    );
  }
  if (lv >= 5) {
    for (const [x, y, z] of [
      [2.5, 0.3, -2.3],
      [2.5, 0.9, -2.3],
      [2.5, 0.3, -1.6],
      [-2.1, 0.3, -1.0],
    ])
      p.push(vc(B(0.6, 0.6, 0.6), '#a0703c', T(x, y, z)), vc(B(0.62, 0.06, 0.62), '#7a5230', T(x, y + 0.3, z)));
    for (let i = 0; i < 3; i++) p.push(vc(Cy(0.05, 0.05, 1.1, 6), '#2f3238', T(-0.4 + i * 0.4, 1.0, -2.82, 0.2, 0, 0)));
  }
  if (lv >= 6) {
    for (const [x, h] of [
      [-0.6, 5.2],
      [0.8, 4.4],
    ]) {
      p.push(vc(Cy(0.3, 0.38, h, 12), '#8f4a33', T(x, h / 2, -3.45)));
      for (const y of [h * 0.35, h * 0.7, h - 0.1]) p.push(vc(Cy(0.36, 0.36, 0.12, 12), '#3a3a3e', T(x, y, -3.45)));
    }
    p.push(vc(Cy(0.62, 0.62, 0.14, 14), '#c9a43a', T(-1.6, 1.3, -1.6, 0, 0, Math.PI / 2)));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      p.push(vc(B(0.14, 0.18, 0.18), '#c9a43a', T(-1.6, 1.3 + Math.sin(a) * 0.7, -1.6 + Math.cos(a) * 0.7, a, 0, 0)));
    }
    p.push(vc(Cy(0.18, 0.18, 0.18, 10), '#8a6a20', T(-1.62, 1.3, -1.6, 0, 0, Math.PI / 2)));
  }
  return merge(p);
}
function smithGeo(): Geo {
  return merge([
    vc(B(0.17, 0.28, 0.2), '#3a2a22', T(-0.12, 0.14, 0)),
    vc(B(0.17, 0.28, 0.2), '#3a2a22', T(0.12, 0.14, 0)),
    vc(Cy(0.27, 0.3, 0.6, 10), '#7a4a2e', T(0, 0.55, 0)),
    vc(Cy(0.075, 0.065, 0.34, 6), C.skin, T(-0.33, 0.62, 0.08, 0.5, 0, 0.3)),
    vc(Cy(0.075, 0.065, 0.34, 6), C.skin, T(0.33, 0.62, 0.08, 0.5, 0, -0.3)),
    vc(S(0.37, 14, 10), C.skin, T(0, 1.12, 0)),
    vc(S(0.4, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), '#c9c9cf', T(0, 1.14, -0.04)),
    vc(S(0.27, 10, 7, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), '#b9b9bf', T(0, 1.02, 0.08)),
    vc(B(0.06, 0.08, 0.04), '#1d1616', T(-0.13, 1.12, 0.35)),
    vc(B(0.06, 0.08, 0.04), '#1d1616', T(0.13, 1.12, 0.35)),
    vc(Cy(0.04, 0.04, 0.4, 5), '#6b3d1f', T(0.4, 0.75, 0.25, 0.6, 0, 0)),
    vc(B(0.2, 0.12, 0.12), '#4a4d55', T(0.4, 0.92, 0.38, 0.6, 0, 0)),
  ]);
}
// Gold boy hut, levels 1..3: thatched hut, plus a store shed, plus a vault
function goldHutGeo(lv: number): Geo {
  const p = [
    vc(Cy(1.75, 1.85, 0.2, 16), '#a07a4a', T(0, 0.1, 0)),
    vc(Cy(1.35, 1.45, 1.7, 16), '#c79a5b', T(0, 1.05, 0)),
    vc(Cy(1.4, 1.4, 0.12, 16), '#8a6a3a', T(0, 0.45, 0)),
    vc(Cy(1.4, 1.4, 0.12, 16), '#8a6a3a', T(0, 1.8, 0)),
    vc(Co(2.05, 1.7, 16), '#d9b35c', T(0, 2.75, 0)),
    vc(Co(0.6, 0.5, 10), '#c49a40', T(0, 3.65, 0)),
    vc(B(0.65, 1.1, 0.1), '#4a3020', T(0, 0.75, 1.38)),
    vc(B(0.45, 0.4, 0.1), '#2b3640', T(-0.85, 1.25, 1.1, 0, -0.65, 0)),
    vc(Cy(0.05, 0.05, 1.9, 6), '#5a3826', T(1.65, 0.95, 1.0)),
    vc(Cy(0.45, 0.45, 0.1, 18), '#ffc83a', T(1.65, 2.05, 1.06, Math.PI / 2, 0, 0)),
    vc(Cy(0.32, 0.32, 0.12, 18), '#e09a14', T(1.65, 2.05, 1.07, Math.PI / 2, 0, 0)),
  ];
  if (lv >= 2) {
    p.push(
      vc(B(1.6, 1.2, 1.4), '#8a5a36', T(2.4, 0.6, -1.0)),
      vc(B(1.85, 0.12, 1.65), '#93624a', T(2.4, 1.3, -1.0, 0.2, 0, 0)),
    );
    for (const [x, z] of [
      [1.1, 1.75],
      [1.55, 1.95],
      [0.7, 2.0],
    ])
      p.push(
        vc(S(0.28, 8, 6), '#c9a46a', T(x, 0.28, z, 0, 0, 0, 1, 1.1, 1)),
        vc(Cy(0.07, 0.11, 0.12, 6), '#8a6a3a', T(x, 0.6, z)),
      );
  }
  if (lv >= 3) {
    p.push(vc(B(1.8, 1.6, 1.8), '#a39e95', T(-0.6, 0.8, -2.6)), vc(B(1.9, 0.14, 1.9), '#e0b13a', T(-0.6, 1.62, -2.6)));
    p.push(
      vc(S(0.9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#f5c33a', T(-0.6, 1.66, -2.6)),
      vc(S(0.14, 8, 6), '#ffe27a', T(-0.6, 2.62, -2.6)),
    );
    p.push(
      vc(B(0.6, 0.95, 0.07), '#5a4a3a', T(-0.6, 0.55, -1.68)),
      vc(Cy(0.12, 0.12, 0.05, 10), '#e0b13a', T(-0.6, 0.6, -1.63, Math.PI / 2, 0, 0)),
    );
    p.push(...flag(-1.6, 1.7, -3.3, '#f5c33a', 1.8));
  }
  return merge(p);
}
// the gold boy drops what he collects on this fenced plot
function plotGeo(): Geo {
  const p = [vc(B(4.6, 0.1, 4.6), '#7a5536', T(0, 0.05, 0))];
  for (let i = 0; i < 6; i++) p.push(vc(B(4.2, 0.06, 0.28), '#664429', T(0, 0.12, -1.85 + i * 0.74)));
  for (let i = 0; i <= 4; i++) {
    const v = -2.3 + i * 1.15;
    p.push(
      vc(Cy(0.07, 0.08, 0.75, 6), '#6b452d', T(v, 0.37, -2.3)),
      vc(Cy(0.07, 0.08, 0.75, 6), '#6b452d', T(-2.3, 0.37, v)),
      vc(Cy(0.07, 0.08, 0.75, 6), '#6b452d', T(2.3, 0.37, v)),
    );
  }
  for (const y of [0.25, 0.55])
    p.push(
      vc(B(4.7, 0.07, 0.07), '#8a5a36', T(0, y, -2.3)),
      vc(B(0.07, 0.07, 4.7), '#8a5a36', T(-2.3, y, 0)),
      vc(B(0.07, 0.07, 4.7), '#8a5a36', T(2.3, y, 0)),
    );
  return merge(p);
}
function treeGeo(seed: number, wood = '#6b4630'): Geo {
  const R = mulberry(seed),
    p = [vc(Co(0.32, 4.2, 6), wood, T(0, 2.1, 0))];
  for (let i = 0; i < 4; i++) {
    const h = 1.6 + R() * 1.8,
      a = R() * Math.PI * 2,
      s = i % 2 ? 1 : -1;
    p.push(
      vc(
        Co(0.08, 1.1, 5),
        wood,
        T(Math.cos(a) * 0.3, h, Math.sin(a) * 0.3, Math.sin(a) * 0.9 * s, 0, Math.cos(a) * 0.9),
      ),
    );
  }
  return merge(p);
}
function barricadeGeo(): Geo {
  const p: Geo[] = [];
  for (let i = 0; i < 5; i++)
    p.push(
      vc(Cy(0.07, 0.09, 1.6, 5), '#5a3a28', T(i * 0.42 - 0.84, 0.55, 0, i % 2 ? 0.6 : -0.6, 0, 0)),
      vc(
        Co(0.08, 0.2, 5),
        '#b98b62',
        T(
          i * 0.42 - 0.84,
          0.55 + Math.cos(0.6) * 0.85,
          (i % 2 ? 1 : -1) * Math.sin(0.6) * 0.85,
          i % 2 ? 0.6 : -0.6,
          0,
          0,
        ),
      ),
    );
  p.push(vc(Cy(0.07, 0.07, 2.2, 5), '#5a3a28', T(0, 0.5, 0, 0, 0, Math.PI / 2)));
  return merge(p);
}
// decor for the outer roads
type DecorFn = (R: () => number) => Geo;
const DECOR = {
  pine(R) {
    const p = [vc(Cy(0.15, 0.2, 1.0, 6), '#5a3d2a', T(0, 0.5, 0))];
    [
      [1.3, 1.5, 1.4],
      [1.0, 1.25, 2.3],
      [0.7, 1.0, 3.05],
    ].forEach(([r, h, y]) => {
      p.push(
        vc(Co(r, h, 8), '#2f5d4a', T(0, y, 0, 0, R() * 3, 0)),
        vc(Co(r * 0.72, h * 0.42, 8), '#f4f8fb', T(0, y + h * 0.3, 0)),
      );
    });
    return merge(p);
  },
  iceRock(R) {
    return merge([
      vc(new THREE.DodecahedronGeometry(0.9, 0), '#bfe0f0', T(0, 0.5, 0, R(), R(), R(), 1, 0.8, 1)),
      vc(new THREE.DodecahedronGeometry(0.55, 0), '#e3f3fb', T(0.8, 0.3, 0.3, R(), R(), R())),
    ]);
  },
  drift() {
    return merge([
      vc(S(1.2, 12, 8), '#f2f7fa', T(0, 0, 0, 0, 0, 0, 1.3, 0.35, 1)),
      vc(S(0.7, 10, 6), '#ffffff', T(0.9, 0, 0.4, 0, 0, 0, 1, 0.4, 1)),
    ]);
  },
  swampTree(R) {
    const p = [vc(Co(0.38, 3.6, 7), '#4a3a2a', T(0, 1.8, 0))];
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + R();
      p.push(
        vc(
          S(0.8 + R() * 0.3, 9, 7),
          i % 2 ? '#4c6b2a' : '#5b7d33',
          T(Math.cos(a) * 0.7, 2.8 + R() * 0.6, Math.sin(a) * 0.7, 0, 0, 0, 1, 0.7, 1),
        ),
        vc(Cy(0.03, 0.03, 1.0, 4), '#6f8f3a', T(Math.cos(a) * 1.1, 2.2, Math.sin(a) * 1.1)),
      );
    }
    return merge(p);
  },
  reeds(R) {
    const p: Geo[] = [];
    for (let i = 0; i < 8; i++) {
      const x = (R() - 0.5) * 1.2,
        z = (R() - 0.5) * 1.2,
        h = 1.0 + R() * 0.6,
        tx = (R() - 0.5) * 0.3;
      p.push(
        vc(Cy(0.03, 0.04, h, 4), '#7a8a3a', T(x, h / 2, z, tx, 0, tx)),
        vc(Cy(0.07, 0.07, 0.3, 6), '#6b4a2a', T(x + tx * h * 0.5, h + 0.05, z)),
      );
    }
    return merge(p);
  },
  mushrooms(R) {
    const p: Geo[] = [];
    for (let i = 0; i < 4; i++) {
      const x = (R() - 0.5) * 1.4,
        z = (R() - 0.5) * 1.4,
        s = 0.6 + R() * 0.6;
      p.push(
        vc(Cy(0.08 * s, 0.1 * s, 0.4 * s, 6), '#efe6d6', T(x, 0.2 * s, z)),
        vc(S(0.3 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#d0643a', T(x, 0.38 * s, z)),
        vc(S(0.05 * s, 5, 4), '#ffffff', T(x + 0.12 * s, 0.6 * s, z + 0.08 * s)),
      );
    }
    return merge(p);
  },
  log(R) {
    return merge([
      vc(Cy(0.3, 0.3, 2.4, 9), '#5a4632', T(0, 0.3, 0, 0, R() * 3, Math.PI / 2)),
      vc(Cy(0.31, 0.31, 0.04, 9), '#a08060', T(1.2, 0.3, 0, 0, 0, Math.PI / 2)),
    ]);
  },
  obsidian(R) {
    const p: Geo[] = [];
    for (let i = 0; i < 4; i++) {
      const a = R() * 6.28,
        h = 1.0 + R() * 1.4;
      p.push(
        vc(
          Co(0.32 + R() * 0.15, h, 5),
          i % 2 ? '#221f27' : '#35303d',
          T(Math.cos(a) * 0.4, h / 2 - 0.1, Math.sin(a) * 0.4, (R() - 0.5) * 0.6, 0, (R() - 0.5) * 0.6),
        ),
      );
    }
    return merge(p);
  },
  charred(R) {
    return treeGeo(Math.floor(R() * 99) + 7, '#2a2422');
  },
  vent() {
    return merge([
      vc(Co(0.85, 0.9, 7), '#2a2628', T(0, 0.45, 0)),
      vc(Cy(0.26, 0.26, 0.06, 8), '#ff7a1a', T(0, 0.88, 0)),
    ]);
  },
} satisfies Record<string, DecorFn>;
type DecorKind = keyof typeof DECOR | 'tree' | 'rock' | 'barricade' | 'lava';
// wall pieces per tier; each piece spans `step` along the segment (local x)
const WALL_PIECES = [
  {
    step: 0.44,
    geo: () =>
      merge([vc(Cy(0.21, 0.23, 1.7, 7), C.stake, T(0, 0.85, 0)), vc(Co(0.21, 0.42, 7), C.stakeTip, T(0, 1.9, 0))]),
  },
  {
    step: 0.5,
    geo: () =>
      merge([
        vc(Cy(0.25, 0.27, 2.0, 8), '#6a4229', T(0, 1.0, 0)),
        vc(Co(0.25, 0.45, 8), '#c99a6a', T(0, 2.22, 0)),
        vc(B(0.5, 0.16, 0.16), '#8a5a36', T(0, 0.55, 0.25)),
        vc(B(0.5, 0.16, 0.16), '#8a5a36', T(0, 1.45, 0.25)),
        vc(B(0.5, 0.16, 0.16), '#8a5a36', T(0, 0.55, -0.25)),
        vc(B(0.5, 0.16, 0.16), '#8a5a36', T(0, 1.45, -0.25)),
      ]),
  },
  {
    step: 1.0,
    geo: () =>
      merge([
        vc(B(1.02, 1.8, 0.9), '#9a9aa2', T(0, 0.9, 0)),
        vc(B(0.46, 0.35, 0.92), '#a9a9b1', T(-0.25, 1.95, 0)),
        vc(B(1.03, 0.08, 0.92), '#85858d', T(0, 0.6, 0)),
        vc(B(1.03, 0.08, 0.92), '#85858d', T(0, 1.2, 0)),
      ]),
  },
  {
    step: 1.0,
    geo: () =>
      merge([
        vc(B(1.02, 2.4, 1.1), '#7d7f88', T(0, 1.2, 0)),
        vc(B(0.45, 0.45, 1.12), '#8e909a', T(-0.26, 2.6, 0)),
        vc(B(1.03, 0.1, 1.12), '#6b6d75', T(0, 0.8, 0)),
        vc(B(1.03, 0.1, 1.12), '#6b6d75', T(0, 1.6, 0)),
        vc(B(0.3, 1.6, 0.25), '#6e7079', T(0, 0.8, 0.62)),
      ]),
  },
  {
    step: 1.0,
    geo: () =>
      merge([
        vc(B(1.02, 2.6, 0.7), '#4f5868', T(0, 1.3, 0)),
        vc(B(1.03, 0.14, 0.74), '#2f3542', T(0, 0.5, 0)),
        vc(B(1.03, 0.14, 0.74), '#2f3542', T(0, 1.4, 0)),
        vc(B(1.03, 0.14, 0.74), '#2f3542', T(0, 2.3, 0)),
        vc(Co(0.12, 0.5, 4), '#c9ced8', T(-0.25, 2.85, 0)),
        vc(Co(0.12, 0.5, 4), '#c9ced8', T(0.25, 2.85, 0)),
      ]),
  },
];

// ------------------------------------------------------------- icon art ----
const INK = '#3b2a20';
type Icon = (g: Ctx) => void;
function iconPath(g: Ctx, draw: Icon, x: number, y: number, s: number): void {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  draw(g);
  g.restore();
}
const ICONS = {
  coin(g) {
    g.fillStyle = '#ffc83a';
    g.strokeStyle = '#b97a12';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(0, 0, 40, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#e09a14';
    g.beginPath();
    g.moveTo(-20, 14);
    g.lineTo(-22, -12);
    g.lineTo(-10, 0);
    g.lineTo(0, -18);
    g.lineTo(10, 0);
    g.lineTo(22, -12);
    g.lineTo(20, 14);
    g.closePath();
    g.fill();
  },
  bow(g) {
    g.strokeStyle = INK;
    g.lineWidth = 22;
    g.beginPath();
    g.arc(-10, 0, 46, -1.2, 1.2);
    g.stroke();
    g.beginPath();
    g.moveTo(-44, -40);
    g.lineTo(52, 0);
    g.stroke();
    g.strokeStyle = '#fff';
    g.lineWidth = 11;
    g.beginPath();
    g.arc(-10, 0, 46, -1.2, 1.2);
    g.stroke();
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(7, -43);
    g.lineTo(7, 43);
    g.stroke();
    g.beginPath();
    g.moveTo(-44, -40);
    g.lineTo(52, 0);
    g.stroke();
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(58, 2);
    g.lineTo(36, -14);
    g.lineTo(40, 8);
    g.closePath();
    g.fill();
  },
  person(g) {
    g.fillStyle = '#fff';
    g.strokeStyle = INK;
    g.lineWidth = 7;
    g.beginPath();
    g.arc(-8, -22, 22, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(-46, 46);
    g.quadraticCurveTo(-44, 4, -8, 4);
    g.quadraticCurveTo(28, 4, 30, 46);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(34, 30, 18, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(27, 23);
    g.lineTo(41, 37);
    g.moveTo(41, 23);
    g.lineTo(27, 37);
    g.stroke();
  },
  cannon(g) {
    g.fillStyle = '#fff';
    g.strokeStyle = INK;
    g.lineWidth = 7;
    g.save();
    g.rotate(-0.4);
    g.beginPath();
    g.roundRect(-44, -16, 84, 32, 12);
    g.fill();
    g.stroke();
    g.restore();
    g.beginPath();
    g.arc(-12, 26, 18, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(-12, 26, 5, 0, Math.PI * 2);
    g.fillStyle = INK;
    g.fill();
  },
  tower(g) {
    g.fillStyle = '#fff';
    g.strokeStyle = INK;
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(-24, 46);
    g.lineTo(-20, -14);
    g.lineTo(-32, -14);
    g.lineTo(-32, -46);
    g.lineTo(-19, -46);
    g.lineTo(-19, -34);
    g.lineTo(-6, -34);
    g.lineTo(-6, -46);
    g.lineTo(6, -46);
    g.lineTo(6, -34);
    g.lineTo(19, -34);
    g.lineTo(19, -46);
    g.lineTo(32, -46);
    g.lineTo(32, -14);
    g.lineTo(20, -14);
    g.lineTo(24, 46);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = INK;
    g.beginPath();
    g.roundRect(-6, 2, 12, 22, 6);
    g.fill();
  },
  goldboy(g) {
    g.fillStyle = '#fff';
    g.strokeStyle = INK;
    g.lineWidth = 7;
    g.beginPath();
    g.arc(-12, -22, 22, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(-50, 46);
    g.quadraticCurveTo(-48, 4, -12, 4);
    g.quadraticCurveTo(24, 4, 26, 46);
    g.closePath();
    g.fill();
    g.stroke();
    iconPath(g, ICONS.coin, 30, 26, 0.5);
  },
  // a tower with a flag on it: an outpost that moves the border
  outpost(g) {
    iconPath(g, ICONS.tower, -10, 14, 0.8);
    g.strokeStyle = INK;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(14, -24);
    g.lineTo(14, -62);
    g.stroke();
    g.fillStyle = '#3d7be0';
    g.beginPath();
    g.moveTo(14, -62);
    g.lineTo(52, -50);
    g.lineTo(14, -38);
    g.closePath();
    g.fill();
    g.stroke();
  },
  up(g) {
    g.fillStyle = '#7dff6a';
    g.strokeStyle = INK;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(0, -30);
    g.lineTo(26, 0);
    g.lineTo(10, 0);
    g.lineTo(10, 28);
    g.lineTo(-10, 28);
    g.lineTo(-10, 0);
    g.lineTo(-26, 0);
    g.closePath();
    g.fill();
    g.stroke();
  },
  weapon(g, tier) {
    g.fillStyle = '#fff';
    g.strokeStyle = INK;
    g.lineWidth = 7;
    if (tier <= 1) {
      ICONS.bow(g);
      if (tier === 1) {
        g.fillStyle = '#7fd7ff';
        for (const [x, y] of [
          [-30, -46],
          [-30, 46],
        ]) {
          g.beginPath();
          g.arc(x, y, 8, 0, 7);
          g.fill();
        }
      }
      return;
    }
    if (tier === 2) {
      g.save();
      g.rotate(-0.6);
      g.beginPath();
      g.roundRect(-10, -48, 20, 96, 6);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(-48, -20);
      g.quadraticCurveTo(0, -46, 48, -20);
      g.lineTo(48, -10);
      g.quadraticCurveTo(0, -36, -48, -10);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
      return;
    }
    if (tier === 3) {
      g.save();
      g.rotate(-0.75);
      g.beginPath();
      g.roundRect(-5, -30, 10, 82, 4);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(0, -60);
      g.lineTo(14, -28);
      g.lineTo(-14, -28);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
      return;
    }
    if (tier === 4) {
      g.save();
      g.rotate(-0.75);
      g.beginPath();
      g.moveTo(0, -60);
      g.lineTo(10, -46);
      g.lineTo(10, 18);
      g.lineTo(-10, 18);
      g.lineTo(-10, -46);
      g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.roundRect(-26, 18, 52, 10, 4);
      g.fill();
      g.stroke();
      g.beginPath();
      g.roundRect(-6, 28, 12, 26, 4);
      g.fill();
      g.stroke();
      g.restore();
      return;
    }
    if (tier === 5) {
      g.beginPath();
      g.moveTo(-50, -10);
      g.lineTo(50, -10);
      g.lineTo(50, 4);
      g.lineTo(-6, 4);
      g.lineTo(-14, 34);
      g.lineTo(-34, 34);
      g.lineTo(-26, 4);
      g.lineTo(-50, 4);
      g.closePath();
      g.fill();
      g.stroke();
      return;
    }
    g.beginPath();
    g.roundRect(-46, -16, 70, 26, 6);
    g.fill();
    g.stroke();
    g.beginPath();
    g.roundRect(24, -8, 30, 10, 3);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(-8, 22, 14, 0, 7);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(-40, 10);
    g.lineTo(-48, 36);
    g.lineTo(-32, 36);
    g.lineTo(-28, 10);
    g.fill();
    g.stroke();
  },
} satisfies Record<string, (g: Ctx, tier: number) => void>;

// =================================================================== game ====
type IMesh = THREE.InstancedMesh;
type LambertMesh = THREE.Mesh<Geo, THREE.MeshLambertMaterial>;
type BasicMesh = THREE.Mesh<Geo, THREE.MeshBasicMaterial>;
type UnitKind = keyof typeof UNIT;

interface King {
  x: number;
  z: number;
  yaw: number;
  cd: number;
  bob: number;
  aim?: number;
}
interface CastleState {
  x: number;
  z: number;
  r: number;
  hp: number;
  max: number;
  hitT: number;
  fall: number;
}
interface Follower {
  x: number;
  z: number;
  yaw: number;
  cd: number;
  slot: number;
  bob: number;
  atkT: number;
  rank: number;
  pop: number;
  aim?: number;
  moving?: boolean;
}
// a recruit running over to join a follower, who gets stronger
interface Joiner {
  x: number;
  z: number;
  yaw: number;
  bob: number;
  target: Follower;
}
interface Enemy {
  kind: UnitKind;
  theme: Biome;
  x: number;
  z: number;
  route: Pt[];
  wp: number;
  hp: number;
  max: number;
  speed: number;
  dmg: number;
  r: number;
  atk: number;
  yaw: number;
  bob: number;
  state: 'path' | 'wall' | 'castle';
  seg: Seg | null;
  lunge: number;
  value: number;
  hitFlash: number;
  side: number;
  scale: number;
  mkey: string;
}
// a stretch of wall, or a gate, on one side of the base
interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  side: Side;
  lo: number;
  hi: number;
  gate: boolean;
  hp: number;
  max: number;
  tier: number;
  alive: boolean;
  hitT: number;
  riseT: number;
  dusted: boolean;
  cx: number;
  cz: number;
  owner: number;
}
type GeoFn = (lv: number) => Geo;
interface Building {
  x: number;
  z: number;
  fn: GeoFn;
  lv: number;
  group: THREE.Group;
  body: LambertMesh;
  t: number;
  mode: 'build' | 'up';
  h: number;
  next?: number;
  onSwap?: (lv: number) => void;
  smith?: LambertMesh;
}
// an archer tower: on the wall (it builds the walls near it), or an outpost on the border
interface Tower {
  x: number;
  z: number;
  up: Pt;
  outer: boolean;
  idx: number;
  built: boolean;
  level: number;
  b: Building | null;
  cd: number[];
  aim?: number;
  site?: Site;
  pad?: Pad;
}
interface Cannon {
  x: number;
  z: number;
  side: Pt;
  cost0: number;
  built: boolean;
  level: number;
  b: Building | null;
  turret: LambertMesh | null;
  cd: number;
  yaw: number;
  field?: boolean;
}
interface GoldBoy {
  x: number;
  z: number;
  yaw: number;
  bob: number;
  load: number;
  state: 'idle' | 'seek' | 'return';
  target: Coin | null;
  retarget: number;
  moving: boolean;
}
interface Gold {
  built: boolean;
  lv: number;
  b: Building | null;
  plotB?: Building;
  boys: GoldBoy[];
  plot: { x: number; z: number; value: number; acc: number };
}
interface Coin {
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  v: number;
  spin: number;
  rest: boolean;
  age: number;
  gone: boolean;
  claimed: GoldBoy | null;
}
// a coin in the air: to the king, who gets `v` coins, or just for show to a spot (a pad, the plot, a sack)
type Flying = { x: number; y: number; z: number; t: number; v: number } & (
  { to: 'king' } | { to: 'pt' | 'pad'; tx: number; tz: number; ty?: number }
);
// an arrow, bolt, spear or bullet after its target
interface Shot {
  kind: ShotKind;
  x: number;
  y: number;
  z: number;
  target: Enemy;
  tx: number;
  tz: number;
  ty: number;
  speed: number;
  dmg: number;
  pierce: number;
  hit: Set<Enemy> | null;
  life: number;
  dir: number[] | null;
}
// a cannon ball on its arc to where the target was
interface Ball {
  kind: 'ball';
  x: number;
  y: number;
  z: number;
  sx: number;
  sz: number;
  sy: number;
  tx: number;
  tz: number;
  t: number;
  dur: number;
  dmg: number;
  splash: number;
  target: null;
  life: number;
  dir?: undefined;
}
type Projectile = Shot | Ball;
type Fx = { o: THREE.Sprite | BasicMesh; t: number; dur: number; s0: number } & (
  | { kind: 'spark' }
  | { kind: 'boom' }
  | { kind: 'ring' }
  | { kind: 'smoke' }
  | { kind: 'pillar'; h: number }
  | { kind: 'puff'; vx: number; vy: number; vz: number }
);
interface FloatText {
  o: THREE.Sprite;
  t: number;
  dur: number;
  rise: number;
  big: boolean;
}
interface Camp extends XZ {
  theme: Biome;
  group: THREE.Group;
  mesh: LambertMesh;
  state: 'hidden' | 'rise' | 'up' | 'fall' | 'ruin';
  t: number;
  smokeT: number;
  dusted?: boolean;
}
interface Front {
  id: string;
  road: Pt[];
  segs: Pt[][];
  adv: number;
  open: boolean;
  openAt: number;
  shared: boolean;
  timer: number;
  restAt: number;
  camp: Camp;
}
interface Spawn {
  f: Front;
  kind: UnitKind;
  t: number;
}
// a spot for an outpost, beside a front's road
interface Site extends XZ {
  rx: number;
  rz: number;
  dx: number;
  dz: number;
  side: number;
  at: number;
  road: Pt[];
}
// a claim of land as it shows: `shown` grows out to `r`
interface Claim extends LandClaim {
  shown: number;
}
interface Post extends XZ {
  t: number;
}
// a spot kept clear of trees and rocks
interface Clearing extends XZ {
  r: number;
}
type Obstacle = [x: number, z: number, r: number];
interface PadDef {
  id: string;
  x: number;
  z: number;
  icon?: Icon | null;
  iconFn?: () => Icon; // the icon as it is now, when it changes
  ghosts?: boolean;
  posFn?: () => Pt; // where the pad is now, when it moves
  visible: () => boolean;
  cost: () => number;
  lv?: () => number;
  buy: () => void;
}
interface Pad extends Omit<PadDef, 'cost'> {
  paid: number;
  showCost: boolean;
  visibleNow: boolean;
  key: string;
  price: () => number;
  cost: number;
  tex: THREE.CanvasTexture;
  mesh: BasicMesh;
  popT?: number;
  site?: Tower;
}
interface TerrainRoad {
  id: string;
  pts: Pt[];
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
interface Ellipse extends XZ {
  rx: number;
  ry: number;
  rot: number;
  a: number;
}
interface Features {
  patches: { x: number; z: number; r: number; col: string; clear: string }[];
  pools: Ellipse[];
  cracks: { pts: Pt[]; lw: number; a: number }[];
  ice: Ellipse[];
}
interface Chunk {
  cx: number;
  cz: number;
  cv: HTMLCanvasElement;
  g: Ctx;
  tex: THREE.CanvasTexture;
  mesh: THREE.Mesh<Geo, THREE.MeshLambertMaterial>;
  group: THREE.Group;
  decor: LambertMesh | null;
  lava: THREE.Mesh[];
  vents: Pt[];
  dirty: boolean;
}
interface Terrain {
  chunks: Map<string, Chunk>;
  strips: Map<number, LambertMesh>;
  feats: Map<string, Features>;
  roads: TerrainRoad[];
  spare: { cv: HTMLCanvasElement; tex: THREE.CanvasTexture }[];
  ventT: number;
  made: number;
  ms: number;
  plane: Geo;
  lavaGeo: THREE.CylinderGeometry[];
  fieldCv: HTMLCanvasElement[];
  fieldG: Ctx[];
  fieldImg: ImageData[];
  maskCv: HTMLCanvasElement;
  maskG: Ctx;
  homeDecor: LambertMesh[];
}
interface Gate extends XZ {
  group: THREE.Group;
  a: LambertMesh;
  b: LambertMesh;
  sgn: number;
  open: number;
}
interface BorderUniforms {
  [name: string]: THREE.IUniform;
  claims: { value: THREE.Vector4[] };
  count: { value: number };
}
// the scene objects that stay from game to game
interface World {
  vmat: THREE.MeshLambertMaterial;
  follower: IMesh;
  followerR: IMesh[];
  weapons: IMesh[];
  ghost: IMesh;
  coin: IMesh;
  boy: IMesh;
  sack: IMesh;
  shadow: IMesh;
  emesh: Record<string, IMesh>;
  ekeys: string[];
  proj: Record<ProjKind, IMesh>;
  barBg: IMesh;
  barFill: IMesh;
  chev: IMesh;
  sparkMat: THREE.SpriteMaterial;
  puffTex: THREE.CanvasTexture;
  fx: Fx[];
  ringGeo: THREE.RingGeometry;
  pillarTex: THREE.CanvasTexture;
  pillarGeo: Geo;
  king: THREE.Group;
  kingWeapon: THREE.Group;
  ring: BasicMesh;
  castle: LambertMesh;
  emblem: THREE.CanvasTexture;
  emblemMat: THREE.MeshLambertMaterial;
  lavaTex: THREE.CanvasTexture;
  lavaMat: THREE.MeshBasicMaterial;
  smithGeo: Geo;
  haloMat: THREE.MeshBasicMaterial;
  haloGeo: THREE.PlaneGeometry;
  halos: BasicMesh[];
  grass: LambertMesh;
  wallMeshes: IMesh[];
  gates: Gate[];
  textCache: Map<string, THREE.CanvasTexture>;
  terrain: Terrain;
  borderU: BorderUniforms;
  border: THREE.Mesh;
  posts: IMesh;
}
// the live game
interface Game {
  t: number;
  coins: number;
  over: boolean;
  paused: boolean;
  dispose: THREE.Object3D[];
  buildings: Building[];
  king: King;
  castle: CastleState;
  followers: Follower[];
  joiners: Joiner[];
  enemies: Enemy[];
  projectiles: Projectile[];
  coinsOnGround: Coin[];
  flying: Flying[];
  texts: FloatText[];
  tier: number;
  extraDmg: number;
  recruitIdx: number;
  barracksLv: number;
  forge: Building | null;
  wallsUp: boolean;
  wallsAnim: boolean;
  shake: number;
  towers: Tower[];
  cannons: Cannon[];
  gold: Gold;
  segs: Seg[];
  spawnT: number;
  spawnQueue: Spawn[];
  nextPath: number;
  kills: number;
  input: { x: number; z: number };
  padIn: Pad | null;
  spendAcc: number;
  spentFlash: number;
  gainFlash: number;
  stats: { maxEnemies: number };
  claims: Claim[];
  fronts: Front[];
  clear: Clearing[];
  outposts: number;
  fieldCannons: number;
  siteSeq: number;
  rand: () => number;
  reach: number;
  posts: Post[];
  toastQ: string[];
  toastT: number;
  // set up once the rest is there
  barracks: Building | null;
  pads: Pad[];
  ruins: Camp[];
  obs?: Obstacle[]; // what the king bumps into
  camDist: number; // the camera's distance from the king (resize)
  ringR?: number; // the ring round the troop
  free?: boolean; // the king may leave his land (the tests' teleport)
}
interface UI {
  root: HTMLElement;
  coins: HTMLElement;
  toast: HTMLElement | null;
  joy: HTMLElement;
  knob: HTMLElement;
  pause: HTMLElement;
  over: HTMLElement;
  overText: HTMLElement;
  lastCoins?: number;
}

let started = false; // the renderer and the world are made (the first time the game opens)
let renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sun: THREE.DirectionalLight,
  canvas: HTMLCanvasElement,
  ui = {} as UI;
const tmpM = new THREE.Matrix4(),
  tmpQ = new THREE.Quaternion(),
  tmpV = new THREE.Vector3(),
  tmpS = new THREE.Vector3(),
  tmpE = new THREE.Euler(),
  tmpC = new THREE.Color();
const CAM_DIR = new THREE.Vector3(
  Math.SQRT1_2 * Math.cos(0.87),
  Math.sin(0.87),
  Math.SQRT1_2 * Math.cos(0.87),
).normalize();
const SCR_R = { x: Math.SQRT1_2, z: -Math.SQRT1_2 },
  SCR_U = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
let G: Game; // live game state (none until the first game starts)
let world: World; // static/shared scene objects
// The pads' labels are drawn in Lilita One. It starts loading with the renderer, and the game waits for it when it
// opens (game.open), so the first game draws them in it.
let fontReady: Promise<unknown> = Promise.resolve();

function initRenderer() {
  canvas = document.getElementById('cd-canvas') as HTMLCanvasElement;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(C.sand);
  camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
  scene.add(new THREE.HemisphereLight(0xfff1de, 0xa8784c, 1.05));
  sun = new THREE.DirectionalLight(0xfff6ea, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 120 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  fontReady = document.fonts ? document.fonts.load('80px "Lilita One"') : Promise.resolve();
}

function smoothLine(g: Ctx, t: number[][]): void {
  g.beginPath();
  g.moveTo(t[0][0], t[0][1]);
  for (let i = 1; i < t.length - 1; i++) {
    const mx = (t[i][0] + t[i + 1][0]) / 2,
      my = (t[i][1] + t[i + 1][1]) / 2;
    g.quadraticCurveTo(t[i][0], t[i][1], mx, my);
  }
  g.lineTo(t[t.length - 1][0], t[t.length - 1][1]);
}

// ---------------------------------------------------------------- terrain ----
// The ground has no edge. It is made in square chunks around the king as he rides and thrown away again behind
// him. Every chunk is painted from the same functions of the ground position (castle-defender-world.ts), so
// chunks meet without seams and come back the same: biome colours that blend into each other, patches, mire
// pools, lava cracks, ice, the roads and the decor. The canyon wall is made the same way, in strips along z.
const CH = 32,
  CH_PX = 256,
  CH_K = CH_PX / CH,
  FIELD = 32,
  MARGIN = 16;
const NEAR = 84,
  FAR = 150; // chunks within NEAR paces of the king are made; past FAR they are thrown away
const STRIP = 48,
  STRIP_NEAR = 120,
  STRIP_FAR = 200,
  CLIFF_DEPTH = 220;
const HOME_DECOR_R = 50; // inside this the canyon keeps its hand-placed trees, rocks and barricades
const hexRGB = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// per biome, in BIOME order: ground, patch colours, roads, wall colours, decor (kind, share) and how much of it
type RGBA = [number, number, number, number];
interface LookDef {
  base: string;
  a: string;
  b: string;
  road: RGBA;
  road2: RGBA;
  dust: string;
  top: string;
  side: string;
  decor: [DecorKind, number][];
  decorN: number;
}
// and worked out from those: the ground as numbers, the wall colours, and the patch colours faded out
interface Look extends LookDef {
  rgb: number[];
  topC: THREE.Color;
  sideC: THREE.Color;
  a0: string;
  b0: string;
}
const LOOKS: Look[] = (
  [
    {
      base: '#ba8b5b',
      a: 'rgba(170,125,80,0.16)',
      b: 'rgba(225,190,140,0.14)',
      road: [222, 190, 148, 0.55],
      road2: [226, 196, 156, 0.85],
      dust: '#e6cba2',
      top: '#f1c98f',
      side: '#6e4b35',
      decor: [
        ['tree', 0.45],
        ['rock', 0.35],
        ['barricade', 0.2],
      ],
      decorN: 1.4,
    },
    {
      base: '#e9f0f5',
      a: 'rgba(160,190,218,0.32)',
      b: 'rgba(255,255,255,0.7)',
      road: [168, 186, 204, 1],
      road2: [190, 205, 219, 1],
      dust: '#ffffff',
      top: '#f4f8fb',
      side: '#7f93a6',
      decor: [
        ['pine', 0.5],
        ['iceRock', 0.3],
        ['drift', 0.2],
      ],
      decorN: 5.5,
    },
    {
      base: '#62743a',
      a: 'rgba(52,72,30,0.5)',
      b: 'rgba(132,156,72,0.4)',
      road: [107, 85, 55, 1],
      road2: [125, 100, 67, 1],
      dust: '#9ab05a',
      top: '#7c8e45',
      side: '#4f4632',
      decor: [
        ['swampTree', 0.35],
        ['reeds', 0.35],
        ['mushrooms', 0.15],
        ['log', 0.15],
      ],
      decorN: 6,
    },
    {
      base: '#3e393a',
      a: 'rgba(22,19,21,0.55)',
      b: 'rgba(96,88,84,0.4)',
      road: [112, 103, 98, 1],
      road2: [126, 117, 112, 1],
      dust: '#5a5050',
      top: '#4c4446',
      side: '#2a2527',
      decor: [
        ['obsidian', 0.42],
        ['charred', 0.22],
        ['lava', 0.18],
        ['vent', 0.18],
      ],
      decorN: 5,
    },
  ] satisfies LookDef[]
).map((L) => ({
  ...L,
  rgb: hexRGB(L.base),
  topC: new THREE.Color(L.top),
  sideC: new THREE.Color(L.side),
  a0: L.a.replace(/[\d.]+\)$/, '0)'),
  b0: L.b.replace(/[\d.]+\)$/, '0)'),
}));
const wTmp = new Float32Array(4);
// pick a biome at random in proportion to its weight at (x, z): where two biomes blend, both show up
function pickBiome(x: number, z: number, u: number): number {
  biomeWeights(x, z, wTmp);
  for (let i = 0; i < 4; i++) {
    if ((u -= wTmp[i]) <= 0) return i;
  }
  return 0;
}
const pickKind = (list: [DecorKind, number][], u: number): DecorKind => {
  const total = list.reduce((s, d) => s + d[1], 0);
  u *= total;
  for (const [k, w] of list) {
    if ((u -= w) <= 0) return k;
  }
  return list[0][0];
};
const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax,
    dz = bz - az,
    L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};
const pathDist = (x: number, z: number, path: readonly Pt[]) => {
  let d = 1e9;
  for (let i = 0; i < path.length - 1; i++)
    d = Math.min(d, segDist(x, z, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]));
  return d;
};

function initTerrain() {
  const cv = (w: number, h = w) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const fieldCv = [cv(FIELD), cv(FIELD), cv(FIELD)],
    fieldG = fieldCv.map((c) => c.getContext('2d', { willReadFrequently: true })!);
  const maskCv = cv(CH_PX + MARGIN * 2);
  const TR: Terrain = {
    chunks: new Map(),
    strips: new Map(),
    feats: new Map(),
    roads: [],
    spare: [],
    ventT: 0,
    made: 0,
    ms: 0,
    plane: new THREE.PlaneGeometry(CH, CH).rotateX(-Math.PI / 2),
    lavaGeo: [0, 1, 2].map((i) => new THREE.CylinderGeometry(1.1 + i * 0.25, 1.1, 0.05, 16)),
    fieldCv,
    fieldG,
    fieldImg: fieldG.map((g) => g.createImageData(FIELD, FIELD)),
    maskCv,
    maskG: maskCv.getContext('2d')!,
    homeDecor: [],
  };
  world.terrain = TR;
  // the hand-placed canyon around the castle, and the two mesas by the wall
  const deco = world.vmat,
    home = TR.homeDecor;
  const add = (geo: Geo, x: number, z: number, ry = 0, s = 1) => {
    const m = new THREE.Mesh(geo, deco);
    m.position.set(x, 0, z);
    m.rotation.y = ry;
    m.scale.setScalar(s);
    m.castShadow = true;
    scene.add(m);
    home.push(m);
  };
  const trees = [treeGeo(1), treeGeo(2), treeGeo(3)];
  [
    [30, 16],
    [18, -34],
    [42, -34],
    [16, 37],
    [-12, 24],
    [44, 20],
    [10, -30],
    [34, 44],
    [26, 42],
    [36, -12],
  ].forEach(([x, z], i) => add(trees[i % 3], x, z, i, 1 + (i % 3) * 0.12));
  const rock = vc(new THREE.DodecahedronGeometry(0.7, 0), '#9a9a9e');
  [
    [28, -20, 1],
    [29.5, -19, 0.6],
    [-12, 19, 0.8],
    [38, 4, 1.1],
    [12, 25, 0.7],
    [-15.5, -17, 0.9],
    [20, -38, 1.2],
  ].forEach(([x, z, s]) => add(rock, x, z, x, s));
  const bar = barricadeGeo();
  [
    [19, -18, 0.4],
    [30, 4, -0.5],
    [17, 17, 0.9],
    [-12, -18, -0.3],
    [33, -15, 1.2],
    [8, 28, 0.2],
    [-8, 24, 1.4],
  ].forEach(([x, z, r]) => add(bar, x, z, r));
  for (const pts of MESAS) addMesa(pts);
  // the roads drawn from the start: the three first roads and a few worn cross trails
  PATHS.slice(0, 3).forEach((p, i) => addRoad('road' + i, p));
  [
    [
      [-12, 30],
      [-4, 22],
      [6, 26],
      [20, 34],
      [34, 48],
    ],
    [
      [20, -46],
      [26, -30],
      [40, -20],
      [62, -18],
    ],
    [
      [22, 4],
      [30, 14],
      [34, 26],
      [46, 40],
    ],
    [
      [-14, -30],
      [-6, -22],
      [0, -30],
      [8, -36],
      [16, -50],
    ],
  ].forEach((p, i) => addRoad('trail' + i, p));
}
// a flat-topped block of canyon rock: a top and walls, every face wound to face outward, coloured by its biome
function addMesa(pts: Pt[], h = 4.2): void {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length,
    cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  biomeWeights(cx, cz, wTmp);
  const top = blendColor(wTmp, 'topC'),
    side = blendColor(wTmp, 'sideC'),
    pos: number[] = [],
    col: number[] = [];
  const idx = THREE.ShapeUtils.triangulateShape(
    pts.map(([x, z]) => new THREE.Vector2(x, z)),
    [],
  );
  for (const [i, j, k] of idx)
    facet(
      pos,
      col,
      [pts[i][0], h, pts[i][1]],
      [pts[j][0], h, pts[j][1]],
      [pts[k][0], h, pts[k][1]],
      [0, 1, 0],
      top,
      top,
      top,
    );
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i],
      [x1, z1] = pts[(i + 1) % pts.length],
      out = [(x0 + x1) / 2 - cx, 0, (z0 + z1) / 2 - cz];
    facet(pos, col, [x0, 0, z0], [x1, 0, z1], [x1, h, z1], out, side, side, side);
    facet(pos, col, [x0, 0, z0], [x1, h, z1], [x0, h, z0], out, side, side, side);
  }
  const mesh = solid(pos, col);
  scene.add(mesh);
}
function blendColor(w: Float32Array, key: 'topC' | 'sideC'): THREE.Color {
  const c = new THREE.Color(0, 0, 0);
  for (let i = 0; i < 4; i++)
    if (w[i] > 0.001) {
      c.r += LOOKS[i][key].r * w[i];
      c.g += LOOKS[i][key].g * w[i];
      c.b += LOOKS[i][key].b * w[i];
    }
  return c;
}
// one triangle, flipped if needed so it faces `want`
function facet(
  pos: number[],
  col: number[],
  a: number[],
  b: number[],
  c: number[],
  want: number[],
  ca: THREE.Color,
  cb: THREE.Color,
  cc: THREE.Color,
): void {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2],
    vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
    [b, c] = [c, b];
    [cb, cc] = [cc, cb];
  }
  pos.push(...a, ...b, ...c);
  col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
}
function solid(pos: number[], col: number[]): LambertMesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, world.vmat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ----- roads: polylines painted into every chunk they cross
function addRoad(id: string, pts: readonly (readonly number[])[]): TerrainRoad {
  const TR = world.terrain;
  removeRoad(id, false);
  const r: TerrainRoad = {
    id,
    pts: pts.map((p): Pt => [p[0], p[1]]),
    x0: Math.min(...pts.map((p) => p[0])),
    x1: Math.max(...pts.map((p) => p[0])),
    z0: Math.min(...pts.map((p) => p[1])),
    z1: Math.max(...pts.map((p) => p[1])),
  };
  TR.roads.push(r);
  dirtyArea(r.x0 - 6, r.z0 - 6, r.x1 + 6, r.z1 + 6);
  // hand-placed decor in the way goes
  for (const m of TR.homeDecor) if (m.visible && pathDist(m.position.x, m.position.z, r.pts) < 3.2) m.visible = false;
  return r;
}
function removeRoad(id: string, dirty = true): void {
  const TR = world.terrain,
    i = TR.roads.findIndex((r) => r.id === id);
  if (i < 0) return;
  const [r] = TR.roads.splice(i, 1);
  if (dirty) dirtyArea(r.x0 - 6, r.z0 - 6, r.x1 + 6, r.z1 + 6);
}
function roadsIn(x0: number, z0: number, x1: number, z1: number): TerrainRoad[] {
  return world.terrain.roads.filter((r) => r.x1 >= x0 && r.x0 <= x1 && r.z1 >= z0 && r.z0 <= z1);
}
function dirtyArea(x0: number, z0: number, x1: number, z1: number): void {
  for (const ch of world.terrain.chunks.values()) {
    const cx0 = ch.cx * CH,
      cz0 = ch.cz * CH;
    if (cx0 + CH >= x0 && cx0 <= x1 && cz0 + CH >= z0 && cz0 <= z1) ch.dirty = true;
  }
}

// ----- what lies on a chunk's ground: the same every time for the same chunk
function chunkFeatures(cx: number, cz: number): Features {
  const TR = world.terrain,
    key = cx + ',' + cz;
  let f = TR.feats.get(key);
  if (f) return f;
  if (TR.feats.size > 900) TR.feats.clear();
  const R = mulberry(cellSeed(cx, cz, 1)),
    x0 = cx * CH,
    z0 = cz * CH,
    w = new Float32Array(4);
  f = { patches: [], pools: [], cracks: [], ice: [] };
  for (let i = 0; i < 18; i++) {
    const x = x0 + R() * CH,
      z = z0 + R() * CH,
      r = i < 4 ? 4 + R() * 12 : 1 + R() * 3.2,
      u = R(),
      side = R();
    const L = LOOKS[pickBiome(x, z, u)];
    f.patches.push({ x, z, r, col: side < 0.5 ? L.a : L.b, clear: side < 0.5 ? L.a0 : L.b0 });
  }
  for (let i = 0; i < 10; i++) {
    const x = x0 + R() * CH,
      z = z0 + R() * CH,
      rx = 0.85 + R() * 1.9,
      ry = rx * (0.4 + R() * 0.3),
      rot = R() * 3;
    biomeWeights(x, z, w);
    if (w[BIOME.mire] > 0.6) f.pools.push({ x, z, rx, ry, rot, a: smoothstep(0.6, 0.9, w[BIOME.mire]) });
  }
  for (let i = 0; i < 16; i++) {
    const x = x0 + R() * CH,
      z = z0 + R() * CH,
      lw = 0.09 + R() * 0.16,
      pts: Pt[] = [[x, z]];
    for (let s = 0; s < 5; s++) {
      const [px, pz] = pts[pts.length - 1];
      pts.push([px + (R() - 0.5) * 2.8, pz + (R() - 0.5) * 2.8]);
    }
    biomeWeights(x, z, w);
    if (w[BIOME.ash] > 0.6) f.cracks.push({ pts, lw, a: smoothstep(0.6, 0.9, w[BIOME.ash]) });
  }
  for (let i = 0; i < 4; i++) {
    const x = x0 + R() * CH,
      z = z0 + R() * CH,
      rx = 1.2 + R() * 2.8,
      ry = rx * (0.35 + R() * 0.35),
      rot = R() * 3;
    biomeWeights(x, z, w);
    if (w[BIOME.frozen] > 0.6) f.ice.push({ x, z, rx, ry, rot, a: smoothstep(0.6, 0.9, w[BIOME.frozen]) });
  }
  TR.feats.set(key, f);
  return f;
}
function paintChunk(ch: Chunk): void {
  const TR = world.terrain,
    g = ch.g,
    x0 = ch.cx * CH,
    z0 = ch.cz * CH,
    w = wTmp;
  const roads = roadsIn(x0 - 4, z0 - 4, x0 + CH + 4, z0 + CH + 4);
  // colour fields, a sample per pace, smoothed up to the texture: ground, and the outer and inner road bands
  const [gi, ri, ri2] = TR.fieldImg.map((im) => im.data);
  for (let j = 0; j < FIELD; j++)
    for (let i = 0; i < FIELD; i++) {
      const x = x0 + ((i + 0.5) * CH) / FIELD,
        z = z0 + ((j + 0.5) * CH) / FIELD,
        o = (j * FIELD + i) * 4;
      biomeWeights(x, z, w);
      const n = 1 + 0.045 * fbm(x / 7, z / 7, 5);
      let r = 0,
        gg = 0,
        b = 0;
      for (let k = 0; k < 4; k++) {
        const c = LOOKS[k].rgb;
        r += c[0] * w[k];
        gg += c[1] * w[k];
        b += c[2] * w[k];
      }
      gi[o] = r * n;
      gi[o + 1] = gg * n;
      gi[o + 2] = b * n;
      gi[o + 3] = 255;
      if (!roads.length) continue;
      for (const [d, key] of [
        [ri, 'road'],
        [ri2, 'road2'],
      ] as const) {
        let rr = 0,
          rg = 0,
          rb = 0,
          ra = 0;
        for (let k = 0; k < 4; k++) {
          const c = LOOKS[k][key];
          rr += c[0] * w[k];
          rg += c[1] * w[k];
          rb += c[2] * w[k];
          ra += c[3] * w[k];
        }
        d[o] = rr;
        d[o + 1] = rg;
        d[o + 2] = rb;
        d[o + 3] = ra * 255;
      }
    }
  TR.fieldG[0].putImageData(TR.fieldImg[0], 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(TR.fieldCv[0], 0, 0, CH_PX, CH_PX);
  const px = (x: number) => (x - x0) * CH_K,
    pz = (z: number) => (z - z0) * CH_K;
  const near = (x: number, z: number, r: number) => x + r > x0 && x - r < x0 + CH && z + r > z0 && z - r < z0 + CH;
  // patches, pools, ice and cracks, including the ones from next door that reach over
  const feats: Features[] = [];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) feats.push(chunkFeatures(ch.cx + i, ch.cz + j));
  for (const f of feats)
    for (const p of f.patches) {
      if (!near(p.x, p.z, p.r)) continue;
      const gr = g.createRadialGradient(px(p.x), pz(p.z), 0, px(p.x), pz(p.z), p.r * CH_K);
      gr.addColorStop(0, p.col);
      gr.addColorStop(1, p.clear);
      g.fillStyle = gr;
      g.fillRect(px(p.x) - p.r * CH_K, pz(p.z) - p.r * CH_K, p.r * CH_K * 2, p.r * CH_K * 2);
    }
  for (const f of feats)
    for (const p of f.ice) {
      if (!near(p.x, p.z, p.rx + 0.5)) continue;
      g.globalAlpha = p.a;
      g.fillStyle = 'rgba(184,214,236,0.55)';
      g.beginPath();
      g.ellipse(px(p.x), pz(p.z), p.rx * CH_K, p.ry * CH_K, p.rot, 0, 7);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.ellipse(
        px(p.x) - p.rx * CH_K * 0.3,
        pz(p.z) - p.ry * CH_K * 0.3,
        p.rx * CH_K * 0.4,
        p.ry * CH_K * 0.22,
        p.rot,
        0,
        7,
      );
      g.fill();
    }
  for (const f of feats)
    for (const p of f.pools) {
      if (!near(p.x, p.z, p.rx + 1)) continue;
      g.globalAlpha = p.a;
      g.fillStyle = '#6f8a6a';
      g.beginPath();
      g.ellipse(px(p.x), pz(p.z), p.rx * CH_K + 5, p.ry * CH_K + 4, p.rot, 0, 7);
      g.fill();
      g.fillStyle = '#2f4a40';
      g.beginPath();
      g.ellipse(px(p.x), pz(p.z), p.rx * CH_K, p.ry * CH_K, p.rot, 0, 7);
      g.fill();
    }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#ff6a1a';
  g.shadowColor = '#ff8a2a';
  g.shadowBlur = 4;
  for (const f of feats)
    for (const c of f.cracks) {
      if (!near(c.pts[0][0], c.pts[0][1], 8)) continue;
      g.globalAlpha = c.a;
      g.lineWidth = c.lw * CH_K;
      g.beginPath();
      g.moveTo(px(c.pts[0][0]), pz(c.pts[0][1]));
      for (const [x, z] of c.pts) g.lineTo(px(x), pz(z));
      g.stroke();
    }
  g.shadowBlur = 0;
  g.globalAlpha = 1;
  // roads: draw the band in white on a mask (with a margin, so the soft edge carries on over the chunk border),
  // then fill it with the road colour of whatever biome it runs through
  if (roads.length) {
    TR.fieldG[1].putImageData(TR.fieldImg[1], 0, 0);
    TR.fieldG[2].putImageData(TR.fieldImg[2], 0, 0);
    const m = TR.maskG,
      S = CH_PX + MARGIN * 2;
    for (const [wd, bl, fc] of [
      [3.0, 0.35, TR.fieldCv[1]],
      [2.3, 0.12, TR.fieldCv[2]],
    ] as const) {
      m.globalCompositeOperation = 'source-over';
      m.clearRect(0, 0, S, S);
      m.filter = `blur(${(bl * CH_K) | 0}px)`;
      m.strokeStyle = '#fff';
      m.lineWidth = wd * CH_K;
      m.lineCap = 'round';
      m.lineJoin = 'round';
      for (const rd of roads) {
        smoothLine(
          m,
          rd.pts.map(([x, z]) => [px(x) + MARGIN, pz(z) + MARGIN]),
        );
        m.stroke();
      }
      m.filter = 'none';
      m.globalCompositeOperation = 'source-in';
      m.imageSmoothingEnabled = true;
      m.drawImage(fc, MARGIN, MARGIN, CH_PX, CH_PX); // (source-in clears the margin, which is not copied anyway)
      m.globalCompositeOperation = 'source-over';
      g.drawImage(TR.maskCv, MARGIN, MARGIN, CH_PX, CH_PX, 0, 0, CH_PX, CH_PX);
    }
  }
  // fine grain
  const R = mulberry(cellSeed(ch.cx, ch.cz, 3));
  for (let i = 0; i < 300; i++) {
    g.fillStyle = R() < 0.5 ? 'rgba(90,60,30,0.06)' : 'rgba(255,245,225,0.06)';
    g.fillRect(R() * CH_PX, R() * CH_PX, 3, 3);
  }
  ch.tex.needsUpdate = true;
}
// trees, rocks and the like, merged into one mesh per chunk; nothing on a road, a wall, the castle's
// hand-placed canyon, or a spot kept clear for building
const decorGeos = new Map<string, Geo>();
function decorGeo(kind: Exclude<DecorKind, 'lava'>, v: number): Geo {
  const key = kind + v;
  let g = decorGeos.get(key);
  if (!g) {
    const R = mulberry(1000 + v * 37 + kind.length * 11);
    g =
      kind === 'tree'
        ? treeGeo(1 + v)
        : kind === 'rock'
          ? vc(new THREE.DodecahedronGeometry(0.7, 0), '#9a9a9e', T(0, 0, 0, R(), R(), R()))
          : kind === 'barricade'
            ? barricadeGeo()
            : DECOR[kind](R);
    decorGeos.set(key, g);
  }
  return g;
}
function decorateChunk(ch: Chunk): void {
  const TR = world.terrain,
    x0 = ch.cx * CH,
    z0 = ch.cz * CH;
  for (const m of ch.lava) {
    ch.group.remove(m);
  }
  if (ch.decor) {
    ch.group.remove(ch.decor);
    ch.decor.geometry.dispose();
    ch.decor = null;
  }
  ch.lava = [];
  ch.vents = [];
  const roads = roadsIn(x0 - 4, z0 - 4, x0 + CH + 4, z0 + CH + 4),
    keep = G ? G.clear || [] : [];
  const R = mulberry(cellSeed(ch.cx, ch.cz, 2)),
    placed: Pt[] = [],
    parts: Geo[] = [];
  for (let i = 0; i < 9; i++) {
    const x = x0 + R() * CH,
      z = z0 + R() * CH,
      roll = R(),
      ry = R() * 6.28,
      s = 0.85 + R() * 0.4,
      v = (R() * 3) | 0,
      ub = R(),
      uk = R();
    const L = LOOKS[pickBiome(x, z, ub)];
    if (roll * 9 > L.decorN) continue;
    if (Math.hypot(x - HOME.x, z - HOME.z) < HOME_DECOR_R || x < cliffEdge(z) + 2.5) continue;
    if (
      roads.some((r) => pathDist(x, z, r.pts) < 3.4) ||
      keep.some((c) => Math.hypot(c.x - x, c.z - z) < c.r) ||
      placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < 2.6)
    )
      continue;
    const kind = pickKind(L.decor, uk);
    placed.push([x, z]);
    if (kind === 'lava') {
      const pool = new THREE.Mesh(TR.lavaGeo[v], world.lavaMat);
      pool.position.set(x, 0.04, z);
      ch.group.add(pool);
      ch.lava.push(pool);
      const rim = decorGeo('obsidian', 0).clone();
      rim.applyMatrix4(T(x + Math.cos(ry) * 1.3, 0, z + Math.sin(ry) * 1.3, 0, ry, 0, 0.5));
      parts.push(rim);
      continue;
    }
    if (kind === 'vent') ch.vents.push([x, z]);
    const geo = decorGeo(kind, v).clone();
    geo.applyMatrix4(T(x, 0, z, 0, ry, 0, s));
    parts.push(geo);
  }
  if (parts.length) {
    const g = merge(parts);
    parts.forEach((p) => p.dispose());
    ch.decor = new THREE.Mesh(g, world.vmat);
    ch.decor.castShadow = true;
    ch.group.add(ch.decor);
  }
}
function makeChunk(cx: number, cz: number): Chunk {
  const TR = world.terrain,
    t0 = performance.now();
  let cv: HTMLCanvasElement, tex: THREE.CanvasTexture;
  if (TR.spare.length) ({ cv, tex } = TR.spare.pop()!);
  else {
    cv = document.createElement('canvas');
    cv.width = cv.height = CH_PX;
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
  }
  const mesh = new THREE.Mesh(TR.plane, new THREE.MeshLambertMaterial({ map: tex }));
  mesh.position.set(cx * CH + CH / 2, 0, cz * CH + CH / 2);
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  scene.add(group);
  const ch: Chunk = {
    cx,
    cz,
    cv,
    g: cv.getContext('2d')!,
    tex,
    mesh,
    group,
    decor: null,
    lava: [],
    vents: [],
    dirty: false,
  };
  paintChunk(ch);
  decorateChunk(ch);
  TR.chunks.set(cx + ',' + cz, ch);
  TR.made++;
  TR.ms += performance.now() - t0;
  return ch;
}
function dropChunk(key: string, ch: Chunk): void {
  const TR = world.terrain;
  scene.remove(ch.group);
  ch.mesh.material.dispose();
  if (ch.decor) ch.decor.geometry.dispose();
  if (TR.spare.length < 12) TR.spare.push({ cv: ch.cv, tex: ch.tex });
  else ch.tex.dispose();
  TR.chunks.delete(key);
}
// Make the chunks and wall strips around (x, z) that are missing and repaint changed ones, nearest first. Each
// frame gets a few milliseconds of it; with `all` everything in sight is done at once (a new game, a teleport).
function updateTerrain(x: number, z: number, all = false): void {
  const TR = world.terrain,
    t0 = performance.now();
  const r = Math.ceil(NEAR / CH) + 1,
    ccx = Math.floor(x / CH),
    ccz = Math.floor(z / CH),
    want: [d: number, cx: number, cz: number, ch: Chunk | undefined][] = [];
  for (let j = -r; j <= r; j++)
    for (let i = -r; i <= r; i++) {
      const cx = ccx + i,
        cz = ccz + j,
        d = Math.hypot(cx * CH + CH / 2 - x, cz * CH + CH / 2 - z);
      if (d > NEAR + CH * 0.71) continue;
      const ch = TR.chunks.get(cx + ',' + cz);
      if (!ch || ch.dirty) want.push([d, cx, cz, ch]);
    }
  want.sort((a, b) => a[0] - b[0]);
  for (const [d, cx, cz, ch] of want) {
    if (!(all && d < 64) && performance.now() - t0 > 4) break;
    if (!ch) makeChunk(cx, cz);
    else {
      ch.dirty = false;
      paintChunk(ch);
      decorateChunk(ch);
    }
  }
  for (const [key, ch] of TR.chunks)
    if (Math.hypot(ch.cx * CH + CH / 2 - x, ch.cz * CH + CH / 2 - z) > FAR) dropChunk(key, ch);
  // canyon wall strips
  const s0 = Math.floor((z - STRIP_NEAR - 1) / STRIP),
    s1 = Math.floor((z + STRIP_NEAR - 1) / STRIP);
  for (let s = s0; s <= s1; s++) if (!TR.strips.has(s)) TR.strips.set(s, makeStrip(s));
  for (const [s, m] of TR.strips)
    if (Math.abs(s * STRIP + STRIP / 2 - z) > STRIP_FAR) {
      scene.remove(m);
      m.geometry.dispose();
      TR.strips.delete(s);
    }
}
// one stretch of the canyon wall: two steps, each a top and a face, coloured by the biome at its foot
function makeStrip(s: number): LambertMesh {
  const pos: number[] = [],
    col: number[] = [],
    n = STRIP / CLIFF.step,
    w = new Float32Array(4);
  const zs = Array.from({ length: n + 1 }, (_, i) => s * STRIP + 1 + i * CLIFF.step);
  for (const [edge, y0, y1] of [
    [cliffEdge, 0, CLIFF.h1],
    [cliffEdge2, CLIFF.h1, CLIFF.h1 + CLIFF.h2],
  ] as const) {
    const e = zs.map(edge),
      top: THREE.Color[] = [],
      side: THREE.Color[] = [];
    zs.forEach((z, i) => {
      biomeWeights(e[i] + 3, z, w);
      top.push(blendColor(w, 'topC'));
      side.push(blendColor(w, 'sideC'));
    });
    for (let i = 0; i < n; i++) {
      const za = zs[i],
        zb = zs[i + 1],
        ea = e[i],
        eb = e[i + 1];
      facet(
        pos,
        col,
        [ea, y1, za],
        [eb, y1, zb],
        [eb - CLIFF_DEPTH, y1, zb],
        [0, 1, 0],
        top[i],
        top[i + 1],
        top[i + 1],
      );
      facet(
        pos,
        col,
        [ea, y1, za],
        [eb - CLIFF_DEPTH, y1, zb],
        [ea - CLIFF_DEPTH, y1, za],
        [0, 1, 0],
        top[i],
        top[i + 1],
        top[i],
      );
      facet(pos, col, [ea, y0, za], [eb, y0, zb], [eb, y1, zb], [1, 0, 0], side[i], side[i + 1], side[i + 1]);
      facet(pos, col, [ea, y0, za], [eb, y1, zb], [ea, y1, za], [1, 0, 0], side[i], side[i + 1], side[i]);
    }
  }
  const m = solid(pos, col);
  scene.add(m);
  return m;
}

// ------------------------------------------------------------ instancing ----
function inst(geo: Geo, mat: THREE.Material | THREE.Material[], n: number, shadow = true): IMesh {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.frustumCulled = false;
  m.castShadow = shadow;
  m.userData.cap = n;
  scene.add(m);
  return m;
}
function buildWorld() {
  const vmat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const ghostMat = new THREE.MeshLambertMaterial({
    color: '#6fe05a',
    transparent: true,
    opacity: 0.55,
    emissive: '#2a8a20',
    depthWrite: false,
  });
  const coinTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#ffc83a';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#d99a16';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(64, 64, 52, 0, 7);
    g.stroke();
    iconPath(g, ICONS.coin, 64, 64, 0.95);
  });
  const coinMats = [
    new THREE.MeshLambertMaterial({ color: '#e7a61c' }),
    new THREE.MeshLambertMaterial({ map: coinTex }),
    new THREE.MeshLambertMaterial({ map: coinTex }),
  ];
  const W = {
    // (the rest of World is filled in below, in the order the scene gets it)
    vmat,
    follower: inst(followerGeo(), vmat, 180),
    followerR: RANKS.slice(1).map((r) => inst(followerGeo(C.hair, r.top), vmat, SQUAD_MAX)),
    weapons: [0, 1, 2, 3, 4, 5, 6].map((t) => inst(weaponGeo(t), vmat, 160)),
    ghost: inst(followerGeo(), ghostMat, 8, false),
    coin: inst(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 18), coinMats, 1900),
    boy: inst(goldBoyGeo(), vmat, 4),
    sack: inst(sackGeo(), vmat, 4),
  } as World;
  // enemies: one mesh per size, variant and road theme
  W.emesh = {};
  for (let t = 0; t < PAL.length; t++) {
    const P = PAL[t],
      big = t === 0;
    W.emesh['knight' + t] = inst(knightGeo(false, P.knight), vmat, big ? 420 : 200);
    W.emesh['knightS' + t] = inst(knightGeo(true, P.knight), vmat, big ? 260 : 120);
    W.emesh['brute' + t] = inst(bruteGeo(P.brute), vmat, big ? 180 : 110);
    W.emesh['giant' + t] = inst(giantGeo(P.giants[0]), vmat, 50);
    if (P.giants[1]) W.emesh['giantR' + t] = inst(giantGeo(P.giants[1]), vmat, 50);
  }
  W.ekeys = Object.keys(W.emesh);
  // blob shadows under units (cheap ground contact)
  const blobTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(70,40,20,0.45)');
    gr.addColorStop(1, 'rgba(70,40,20,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
  const sg = new THREE.PlaneGeometry(1, 1);
  sg.rotateX(-Math.PI / 2);
  W.shadow = inst(sg, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }), 1200, false);
  W.shadow.renderOrder = 1;
  // projectiles
  const glow = (hex: Hex) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.95 });
  const streak = new THREE.BoxGeometry(0.07, 0.07, 1.7);
  streak.translate(0, 0, -0.85);
  W.proj = {
    arrow: inst(streak, glow('#dff1ff'), 600, false),
    arrow2: inst(new THREE.BoxGeometry(0.1, 0.1, 2.0).translate(0, 0, -1.0), glow('#8fdcff'), 600, false),
    bolt: inst(new THREE.BoxGeometry(0.09, 0.09, 1.0).translate(0, 0, -0.5), glow('#e9eef6'), 600, false),
    spear: inst(
      merge([
        vc(Cy(0.04, 0.04, 1.8, 5), '#8a5a2b', T(0, 0, -0.9, Math.PI / 2, 0, 0)),
        vc(Co(0.08, 0.3, 5), '#e3e7ee', T(0, 0, 0.1, Math.PI / 2, 0, 0)),
      ]),
      vmat,
      300,
      false,
    ),
    bullet: inst(new THREE.BoxGeometry(0.06, 0.06, 1.4).translate(0, 0, -0.7), glow('#ffe36a'), 900, false),
    ball: inst(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshLambertMaterial({ color: '#25262b' }), 60),
  };
  // health bars (billboards)
  const bg = new THREE.PlaneGeometry(1, 1);
  W.barBg = inst(
    bg,
    new THREE.MeshBasicMaterial({ color: '#2a2526', depthTest: false, transparent: true }),
    700,
    false,
  );
  W.barFill = inst(
    bg,
    new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true }),
    700,
    false,
  );
  W.barBg.renderOrder = 10;
  W.barFill.renderOrder = 11;
  W.barFill.setColorAt(0, new THREE.Color());
  W.barFill.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  // chevron guide
  const ch = new THREE.Shape();
  ch.moveTo(-0.5, -0.15);
  ch.lineTo(0, 0.25);
  ch.lineTo(0.5, -0.15);
  ch.lineTo(0.5, -0.4);
  ch.lineTo(0, 0);
  ch.lineTo(-0.5, -0.4);
  ch.closePath();
  const chg = new THREE.ShapeGeometry(ch);
  chg.rotateX(-Math.PI / 2);
  W.chev = inst(
    chg,
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }),
    30,
    false,
  );
  W.chev.setColorAt(0, new THREE.Color());
  W.chev.renderOrder = 2;
  // sparks / explosions / smoke / upgrade rings and light pillars
  const sparkTex = canvasTex(64, 64, (g) => {
    g.translate(32, 32);
    for (let i = 0; i < 8; i++) {
      g.rotate(Math.PI / 4);
      g.fillStyle = i % 2 ? 'rgba(170,220,255,0.9)' : 'rgba(255,255,255,1)';
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(3, -4);
      g.lineTo(0, i % 2 ? -18 : -30);
      g.lineTo(-3, -4);
      g.fill();
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 14);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(120,190,255,0)');
    g.fillStyle = gr;
    g.fillRect(-14, -14, 28, 28);
  });
  const puffTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  });
  W.sparkMat = new THREE.SpriteMaterial({
    map: sparkTex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  W.puffTex = puffTex;
  W.fx = [];
  W.ringGeo = new THREE.RingGeometry(0.86, 1, 64);
  const pillarTex = canvasTex(8, 128, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 8, 128);
  });
  W.pillarTex = pillarTex;
  W.pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
  // king
  W.king = new THREE.Group();
  const kb = new THREE.Mesh(kingGeo(), vmat);
  kb.castShadow = true;
  W.king.add(kb);
  W.kingWeapon = new THREE.Group();
  W.king.add(W.kingWeapon);
  scene.add(W.king);
  W.ring = new THREE.Mesh(
    new THREE.RingGeometry(0.94, 1, 72),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
  );
  W.ring.rotation.x = -Math.PI / 2;
  W.ring.renderOrder = 3;
  scene.add(W.ring);
  // the castle and the ground patches under buildings (the worn sand halos in the screenshots)
  const addStatic = (geo: Geo, x: number, z: number, ry = 0, mat = vmat) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  W.castle = addStatic(castleGeo(), CASTLE.x, CASTLE.z, Math.PI / 4);
  W.emblem = canvasTex(256, 256, (g) => {
    g.fillStyle = '#6b452d';
    g.beginPath();
    g.moveTo(128, 30);
    g.lineTo(236, 226);
    g.lineTo(20, 226);
    g.closePath();
    g.fill();
    iconPath(
      g,
      (c) => {
        c.strokeStyle = '#2f80c9';
        c.lineWidth = 14;
        c.beginPath();
        c.arc(-10, 0, 46, -1.2, 1.2);
        c.stroke();
        c.strokeStyle = '#e0ecf4';
        c.lineWidth = 6;
        c.beginPath();
        c.moveTo(7, -43);
        c.lineTo(7, 43);
        c.stroke();
        c.lineWidth = 8;
        c.beginPath();
        c.moveTo(-50, 30);
        c.lineTo(52, -26);
        c.stroke();
        c.fillStyle = '#e0ecf4';
        c.beginPath();
        c.moveTo(60, -30);
        c.lineTo(36, -30);
        c.lineTo(48, -10);
        c.fill();
      },
      128,
      160,
      0.9,
    );
  });
  W.emblemMat = new THREE.MeshLambertMaterial({ map: W.emblem, transparent: true });
  const lavaTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#e8320c';
    g.fillRect(0, 0, 128, 128);
    const r = mulberry(5);
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 3 ? '#ffd21a' : '#ff8a12';
      g.beginPath();
      g.ellipse(r() * 128, r() * 128, 8 + r() * 20, 5 + r() * 12, r() * 3, 0, 7);
      g.fill();
    }
  });
  lavaTex.wrapS = lavaTex.wrapT = THREE.RepeatWrapping;
  W.lavaTex = lavaTex;
  W.lavaMat = new THREE.MeshBasicMaterial({ map: lavaTex });
  W.smithGeo = smithGeo();
  const halo = canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    gr.addColorStop(0, 'rgba(232,203,163,0.95)');
    gr.addColorStop(0.7, 'rgba(232,203,163,0.7)');
    gr.addColorStop(1, 'rgba(232,203,163,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  });
  W.haloMat = new THREE.MeshBasicMaterial({ map: halo, transparent: true, depthWrite: false });
  W.haloGeo = new THREE.PlaneGeometry(1, 1);
  W.halos = [
    [BARRACKS[0], BARRACKS[1], 8],
    [CASTLE.x, CASTLE.z, 9.5],
  ].map(([x, z, s]) => {
    const h = new THREE.Mesh(W.haloGeo, W.haloMat);
    h.scale.setScalar(s);
    h.rotation.x = -Math.PI / 2;
    h.position.set(x, 0.04, z);
    h.renderOrder = 1;
    scene.add(h);
    return h;
  });
  // grass inside the walls, grown when the first tower goes up
  const grassTex = canvasTex(1024, 1024, (g) => {
    g.fillStyle = C.grass;
    g.fillRect(0, 0, 1024, 1024);
    const r = mulberry(9);
    for (let i = 0; i < 90; i++) {
      const x = r() * 1024,
        y = r() * 1024,
        rr = 60 + r() * 160;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, r() < 0.5 ? 'rgba(74,146,100,0.22)' : 'rgba(110,186,132,0.18)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(40,100,60,0.06)' : 'rgba(150,220,170,0.05)';
      g.fillRect(r() * 1024, r() * 1024, 3, 3);
    }
  });
  const gs = new THREE.Shape();
  const gp: THREE.Vector2[] = [];
  for (let i = 0; i < 64; i++) {
    const t = i / 64;
    let x, z;
    if (t < 0.25) {
      x = -HX - 0.6 + (2 * HX + 1.2) * (t / 0.25);
      z = -HZ - 0.6;
    } else if (t < 0.5) {
      x = HX + 0.6;
      z = -HZ - 0.6 + (2 * HZ + 1.2) * ((t - 0.25) / 0.25);
    } else if (t < 0.75) {
      x = HX + 0.6 - (2 * HX + 1.2) * ((t - 0.5) / 0.25);
      z = HZ + 0.6;
    } else {
      x = -HX - 0.6;
      z = HZ + 0.6 - (2 * HZ + 1.2) * ((t - 0.75) / 0.25);
    }
    gp.push(new THREE.Vector2(x + Math.sin(i * 2.1) * 0.25, -(z + Math.cos(i * 1.7) * 0.25)));
  }
  gs.setFromPoints(gp);
  const ggeo = new THREE.ShapeGeometry(gs);
  ggeo.rotateX(-Math.PI / 2);
  const uv = ggeo.attributes.uv,
    pp = ggeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) / 32 + 0.5, pp.getZ(i) / 32 + 0.5);
  W.grass = new THREE.Mesh(ggeo, new THREE.MeshLambertMaterial({ map: grassTex }));
  W.grass.position.y = 0.03;
  W.grass.receiveShadow = true;
  W.grass.visible = false;
  scene.add(W.grass);
  // walls: one instanced mesh per tier piece
  W.wallMeshes = WALL_PIECES.map((p) => {
    const m = inst(p.geo(), vmat, 400);
    m.receiveShadow = true;
    return m;
  });
  // a gate in each side: frame plus two doors that swing inward for the king
  const gateGeo = merge([
    vc(B(0.3, 3.0, 0.3), '#5a3826', T(0, 1.5, 0)),
    vc(B(0.2, 0.3, 4.4), '#7a5234', T(0, 2.9, 2.0)),
    vc(B(0.3, 3.0, 0.3), '#5a3826', T(0, 1.5, 4.0)),
  ]);
  const doorGeo = merge([
    ...[0, 1, 2, 3].map((i) => vc(B(0.16, 2.1, 0.46), i % 2 ? '#b68457' : '#c4925f', T(0, 1.05, 0.25 + i * 0.47))),
    vc(B(0.2, 0.18, 1.9), '#7a5234', T(0, 0.6, 0.95)),
    vc(B(0.2, 0.18, 1.9), '#7a5234', T(0, 1.6, 0.95)),
  ]);
  W.gates = GATES.map((gt) => {
    const group = new THREE.Group(),
      ns = gt.side === 'N' || gt.side === 'S';
    group.position.set(ns ? gt.lo : gt.side === 'E' ? HX : -HX, 0, ns ? (gt.side === 'S' ? HZ : -HZ) : gt.lo);
    group.rotation.y = ns ? Math.PI / 2 : 0;
    const frame = new THREE.Mesh(gateGeo, vmat);
    frame.castShadow = true;
    group.add(frame);
    const a = new THREE.Mesh(doorGeo, vmat),
      b = new THREE.Mesh(doorGeo, vmat);
    a.position.z = 0.1;
    b.position.z = 3.9;
    b.scale.z = -1;
    a.castShadow = b.castShadow = true;
    group.add(a, b);
    group.visible = false;
    scene.add(group);
    const cx = ns ? (gt.lo + gt.hi) / 2 : group.position.x,
      cz = ns ? group.position.z : (gt.lo + gt.hi) / 2;
    return { group, a, b, sgn: gt.side === 'E' || gt.side === 'N' ? 1 : -1, x: cx, z: cz, open: 0 };
  });
  // damage number sprites
  W.textCache = new Map();
  world = W;
  initTerrain();
  initBorder();
}

// ------------------------------------------------------------------- pads ----
function makePadTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function drawPad(p: Pad): void {
  const cv = p.tex.image as HTMLCanvasElement,
    g = cv.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  const pad = 18,
    s = 256 - pad * 2,
    r = 30;
  g.save();
  g.beginPath();
  g.roundRect(pad, pad, s, s, r);
  g.clip();
  g.fillStyle = 'rgba(70,45,25,0.22)';
  g.fillRect(0, 0, 256, 256);
  const frac = p.cost > 0 ? Math.min(1, p.paid / p.cost) : 0;
  if (frac > 0) {
    g.fillStyle = '#22d81c';
    g.fillRect(pad, pad, s * frac, s);
  }
  g.restore();
  // dashed outline with solid corner brackets
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.setLineDash([22, 24]);
  g.lineDashOffset = 0;
  g.beginPath();
  g.roundRect(pad + 4, pad + 4, s - 8, s - 8, r - 4);
  g.stroke();
  g.setLineDash([]);
  const L = 46,
    a = pad + 4,
    b = 256 - pad - 4;
  g.beginPath();
  for (const [x, y, dx, dy] of [
    [a, a, 1, 1],
    [b, a, -1, 1],
    [a, b, 1, -1],
    [b, b, -1, -1],
  ]) {
    g.moveTo(x, y + dy * L);
    g.lineTo(x, y + dy * (r - 6));
    g.quadraticCurveTo(x, y, x + dx * (r - 6), y);
    g.lineTo(x + dx * L, y);
  }
  g.stroke();
  // icon
  const icon = p.iconFn ? p.iconFn() : p.icon;
  if (icon) iconPath(g, (c) => icon(c), 128, p.showCost ? 92 : 128, p.showCost ? 0.8 : 1.05);
  if (p.showCost) {
    const remaining = Math.max(0, Math.ceil(p.cost - p.paid));
    iconPath(g, ICONS.coin, 78, 186, 0.48);
    g.font = '64px "Lilita One", sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 12;
    g.strokeStyle = INK;
    g.strokeText(String(remaining), 106, 190);
    g.fillStyle = '#fff';
    g.fillText(String(remaining), 106, 190);
  }
  p.tex.needsUpdate = true;
}
function createPad(def: PadDef): Pad {
  const tex = makePadTexture();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 4.2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  const p: Pad = { paid: 0, showCost: true, visibleNow: false, key: '', ...def, price: def.cost, cost: 0, tex, mesh };
  p.mesh.rotation.x = -Math.PI / 2;
  p.mesh.position.set(p.x, 0.06, p.z);
  p.mesh.renderOrder = 2;
  p.mesh.visible = false;
  scene.add(p.mesh);
  return p;
}

// -------------------------------------------------------------- buildings ----
// Every building is a group with one body mesh whose geometry is swapped per
// level. Building rises out of the ground; upgrading squashes the old model,
// swaps it and pops the new one up.
const geoCache = new Map<string, Geo>();
function geoFor(fn: GeoFn, lv: number): Geo {
  const key = fn.name + ':' + lv;
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = fn(lv)));
  return g;
}
const easeOutBack = (k: number) => {
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
function makeBuilding(x: number, z: number, yaw: number, fn: GeoFn, lv: number, halo = 0, h = 3): Building {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const body = new THREE.Mesh(geoFor(fn, lv), world.vmat);
  body.rotation.y = yaw;
  body.castShadow = true;
  body.receiveShadow = true;
  body.scale.set(1.15, 0.01, 1.15);
  group.add(body);
  if (halo) {
    const hm = new THREE.Mesh(world.haloGeo, world.haloMat);
    hm.rotation.x = -Math.PI / 2;
    hm.position.y = 0.04;
    hm.scale.setScalar(halo);
    hm.renderOrder = 1;
    group.add(hm);
  }
  scene.add(group);
  G.dispose.push(group);
  const b: Building = { x, z, fn, lv, group, body, t: 0, mode: 'build', h };
  G.buildings.push(b);
  return b;
}
function upgradeBuilding(b: Building, lv: number): void {
  b.next = lv;
  b.t = 0;
  b.mode = 'up';
  dust(b.x, b.z, 2.2, 10);
}
function animBuildings(dt: number): void {
  for (const b of G.buildings) {
    if (b.t >= 1) continue;
    const was = b.t,
      s = b.body.scale;
    b.t = Math.min(1, b.t + dt / (b.mode === 'build' ? 0.75 : 0.95));
    if (b.mode === 'build') {
      const e = easeOutBack(b.t);
      s.set(1 + (1 - b.t) * 0.15, Math.max(0.01, e), 1 + (1 - b.t) * 0.15);
      continue;
    }
    const SQ = 0.3;
    if (b.t < SQ) {
      const k = easeOut(b.t / SQ);
      s.set(1 + 0.14 * k, 1 - 0.4 * k, 1 + 0.14 * k);
      continue;
    }
    if (was < SQ) {
      b.body.geometry = geoFor(b.fn, b.next!);
      b.lv = b.next!;
      if (b.onSwap) b.onSwap(b.lv);
      celebrate(b.x, b.z, b.h, true);
    }
    const k = (b.t - SQ) / (1 - SQ),
      e = easeOutBack(k);
    s.set(1.14 - 0.14 * k, 0.6 + 0.4 * e, 1.14 - 0.14 * k);
  }
}

// -------------------------------------------------------------- new game ----
function newGame() {
  // clear dynamic objects from a previous run
  if (G) {
    for (const o of G.dispose) scene.remove(o);
    for (const p of G.pads) {
      scene.remove(p.mesh);
      p.tex.dispose();
    }
  }
  const W = world;
  const tower = ([x, z]: Pt, up: Pt, outer: boolean, idx: number): Tower => ({
    x,
    z,
    up,
    outer,
    idx,
    built: false,
    level: 0,
    b: null,
    cd: [],
    aim: undefined,
  });
  G = {
    t: 0,
    coins: 4,
    over: false,
    paused: false,
    dispose: [],
    buildings: [],
    king: { x: 4, z: 2, yaw: Math.PI * 0.75, cd: 0, bob: 0 },
    castle: { ...CASTLE, hp: 0, max: 0, hitT: 0, fall: 0 },
    followers: [],
    joiners: [],
    enemies: [],
    projectiles: [],
    coinsOnGround: [],
    flying: [],
    texts: [],
    tier: 0,
    extraDmg: 0,
    recruitIdx: 0,
    barracksLv: 1,
    forge: null,
    wallsUp: false,
    wallsAnim: false,
    shake: 0,
    towers: TOWER_SPOTS.map((s, i) => tower(s, TOWER_UP_PADS[i], false, i)),
    cannons: CANNON_SPOTS.map(([x, z], i) => ({
      x,
      z,
      side: CANNON_PADS[i],
      cost0: CANNON_COSTS[i],
      built: false,
      level: 0,
      b: null,
      turret: null,
      cd: 0,
      yaw: 2.4,
    })),
    gold: { built: false, lv: 0, b: null, boys: [], plot: { x: GOLD_PLOT[0], z: GOLD_PLOT[1], value: 0, acc: 0 } },
    segs: [],
    spawnT: 0.2,
    spawnQueue: [],
    nextPath: 0,
    kills: 0,
    input: { x: 0, z: 0 },
    padIn: null,
    spendAcc: 0,
    spentFlash: 0,
    gainFlash: 0,
    stats: { maxEnemies: 0 },
    // the open world: the land claimed, the enemy fronts, and spots kept clear of decor
    claims: [{ x: HOME.x, z: HOME.z, r: CLAIM_HOME, shown: CLAIM_HOME }],
    fronts: [],
    clear: [],
    outposts: 0,
    fieldCannons: 0,
    siteSeq: 0,
    rand: mulberry((Math.random() * 2147483647) | 0),
    reach: CLAIM_HOME,
    posts: [],
    toastQ: [],
    toastT: 0,
    // filled in below (and the camera distance by resize)
    barracks: null,
    pads: [],
    ruins: [],
    camDist: 0,
  };
  // the barracks stands from the start
  const bk = makeBuilding(BARRACKS[0], BARRACKS[1], Math.PI / 4, barracksGeo, 1, 0, 3.5);
  bk.t = 1;
  bk.body.scale.set(1, 1, 1);
  const em = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), W.emblemMat);
  em.position.set(0, 3.25, 1.82);
  em.rotation.x = -0.12;
  bk.body.add(em);
  bk.onSwap = (lv) => {
    em.position.set(0, lv >= 3 ? 4.4 : 3.25, lv >= 3 ? 1.95 : 1.82);
    bk.h = lv >= 3 ? 5 : 3.5;
  };
  G.barracks = bk;
  addPeople(2, false);
  buildSegments();
  G.pads = makePads();
  for (const w of W.wallMeshes) w.count = 0;
  W.grass.visible = false;
  for (const gt of W.gates) {
    gt.group.visible = false;
    gt.open = 0;
  }
  W.castle.scale.set(1, 1, 1);
  W.castle.position.y = 0;
  W.castle.rotation.z = 0;
  resetWorld();
  G.clear.push(
    { x: GOLD_HUT[0], z: GOLD_HUT[1], r: 4 },
    { x: GOLD_PLOT[0], z: GOLD_PLOT[1], r: 3.6 },
    { x: GOLD_PAD[0], z: GOLD_PAD[1], r: 3 },
  );
  initFronts();
  refreshPosts();
  world.borderU.count.value = 0;
  G.castle.max = G.castle.hp = castleMaxHp();
  refreshObstacles();
  setKingWeapon();
  updateHud(true);
}

// ------------------------------------------------------------------ walls ----
function buildSegments() {
  G.segs = makeSegments();
}
// the stretches of wall along the base rectangle, ~4 units each, split around the gates
function makeSegments(): Seg[] {
  const segs: Seg[] = [];
  const add = (side: Side, lo: number, hi: number, gate: boolean) => {
    const n = gate ? 1 : Math.max(1, Math.round((hi - lo) / 4));
    for (let i = 0; i < n; i++) {
      const a = lo + ((hi - lo) * i) / n,
        b = lo + ((hi - lo) * (i + 1)) / n;
      const ns = side === 'N' || side === 'S',
        fixed = side === 'E' ? HX : side === 'W' ? -HX : side === 'S' ? HZ : -HZ;
      const ends = ns ? { ax: a, az: fixed, bx: b, bz: fixed } : { ax: fixed, az: a, bx: fixed, bz: b };
      const s: Seg = {
        ...ends,
        side,
        lo: a,
        hi: b,
        gate,
        hp: 0,
        max: 0,
        tier: 0,
        alive: false,
        hitT: 0,
        riseT: 1,
        dusted: true,
        cx: (ends.ax + ends.bx) / 2,
        cz: (ends.az + ends.bz) / 2,
        owner: 0,
      };
      // each stretch belongs to the nearest wall tower
      let best = 0,
        bd = 1e9;
      TOWER_SPOTS.forEach(([x, z], i) => {
        const d = Math.hypot(x - s.cx, z - s.cz);
        if (d < bd - 0.01) {
          bd = d;
          best = i;
        }
      });
      s.owner = best;
      segs.push(s);
    }
  };
  for (const side of ['N', 'E', 'S', 'W'] as const) {
    const span = side === 'N' || side === 'S' ? HX : HZ,
      gate = GATES.find((g) => g.side === side)!;
    add(side, -span, gate.lo, false);
    add(side, gate.lo, gate.hi, true);
    add(side, gate.hi, span, false);
  }
  return segs;
}
function rebuildWalls(dt = 0) {
  const W = world,
    counts = [0, 0, 0, 0, 0];
  let moving = false;
  for (const s of G.segs) {
    if (s.riseT < 1) {
      s.riseT = Math.min(1, s.riseT + dt / 0.5);
      moving = true;
      if (!s.dusted && s.riseT > 0) {
        s.dusted = true;
        if (s.alive) dust(s.cx, s.cz, 1.6, 4);
      }
    }
    if (s.gate || !s.alive || !s.tier) continue;
    const piece = WALL_PIECES[s.tier - 1],
      mesh = W.wallMeshes[s.tier - 1],
      tier = s.tier;
    const rise = s.riseT <= 0 ? 0.001 : Math.max(0.001, easeOutBack(s.riseT));
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az),
      k = Math.max(1, Math.round(len / piece.step)),
      yaw = Math.atan2(-(s.bz - s.az), s.bx - s.ax);
    for (let i = 0; i < k && counts[tier - 1] < 400; i++) {
      const t = (i + 0.5) / k,
        x = s.ax + (s.bx - s.ax) * t,
        z = s.az + (s.bz - s.az) * t;
      tmpM.compose(
        tmpV.set(x, 0, z),
        tmpQ.setFromEuler(tmpE.set(0, yaw + (tier < 3 ? (((i * 7) % 5) - 2) * 0.03 : 0), 0)),
        tmpS.set(1, (tier < 3 ? 0.9 + ((i * 13 + Math.abs(s.ax) * 3) % 7) * 0.03 : 1) * rise, 1),
      );
      mesh.setMatrixAt(counts[tier - 1]++, tmpM);
    }
  }
  W.wallMeshes.forEach((m, i) => {
    m.count = counts[i];
    m.instanceMatrix.needsUpdate = true;
  });
  G.segs.forEach((s) => {
    if (!s.gate) return;
    const gt = W.gates[GATES.findIndex((g) => g.side === s.side)];
    gt.group.visible = s.alive;
    if (s.alive) gt.group.scale.set(1, s.riseT <= 0 ? 0.001 : Math.max(0.001, easeOutBack(s.riseT)), 1);
  });
  G.wallsAnim = moving;
}
function setTowerWalls(t: Tower): void {
  const max = WALL_TIERS[t.level - 1].hp;
  for (const s of G.segs)
    if (s.owner === t.idx) {
      s.tier = t.level;
      s.max = s.hp = max;
      s.alive = true;
      s.riseT = -Math.hypot(s.cx - t.x, s.cz - t.z) / 16 - 0.15;
      s.dusted = false;
    }
  G.wallsUp = true;
  world.grass.visible = true;
  const cs = G.castle;
  cs.max = castleMaxHp();
  cs.hp = cs.max;
  rebuildWalls();
}

// pads: what you can buy, in the order they appear
function makePads(): Pad[] {
  const pads: Pad[] = [];
  const built = (list: { built: boolean }[]) => list.filter((x) => x.built).length;
  pads.push(
    createPad({
      id: 'recruit',
      x: RECRUIT_PAD[0],
      z: RECRUIT_PAD[1],
      icon: null,
      ghosts: true,
      visible: () => people() < FOLLOWER_CAP,
      cost: () => recruitStep()[0],
      buy: () => recruit(),
    }),
  );
  for (const t of G.towers) {
    const prev = t.idx ? G.towers[t.idx - 1] : null;
    pads.push(
      createPad({
        id: 'tower' + t.idx,
        x: t.x,
        z: t.z,
        posFn: () => (t.built ? t.up : [t.x, t.z]),
        visible: () => t.level < 5 && (t.built || (prev ? prev.built : G.recruitIdx >= 1)),
        cost: () => (t.built ? TOWER_UP[t.level - 1] : TOWER_COSTS[t.idx]),
        iconFn: () =>
          t.built
            ? (c) => {
                ICONS.tower(c);
                iconPath(c, ICONS.up, 40, 30, 0.6);
              }
            : ICONS.bow,
        lv: () => t.level,
        buy: () => (t.built ? upgradeTower(t) : buildTower(t)),
      }),
    );
  }
  pads.push(
    createPad({
      id: 'forgebuild',
      x: FORGE[0],
      z: FORGE[1],
      icon: anvilIcon,
      visible: () => G.towers[0].built && !G.forge,
      cost: () => 40,
      buy: () => buildForge(),
    }),
  );
  pads.push(
    createPad({
      id: 'forge',
      x: FORGE_PAD[0],
      z: FORGE_PAD[1],
      icon: null,
      visible: () => !!G.forge,
      cost: () =>
        G.tier < FORGE_COSTS.length ? FORGE_COSTS[G.tier] : Math.round(9000 * Math.pow(1.6, G.extraDmg + 1)),
      iconFn: () => (c) => {
        ICONS.weapon(c, Math.min(G.tier + 1, 6));
        if (G.tier >= FORGE_COSTS.length) iconPath(c, ICONS.up, 42, 32, 0.6);
      },
      lv: () => G.tier * 100 + G.extraDmg,
      buy: () => upgradeWeapon(),
    }),
  );
  G.cannons.forEach((cn, i) =>
    pads.push(cannonPad(cn, () => built(G.towers.filter((t) => !t.outer)) >= 4 && (i === 0 || G.cannons[i - 1].built))),
  );
  const gd = G.gold;
  pads.push(
    createPad({
      id: 'gold',
      x: GOLD_HUT[0],
      z: GOLD_HUT[1],
      posFn: () => (gd.built ? GOLD_PAD : GOLD_HUT),
      visible: () => gd.lv < GOLD_COSTS.length && (gd.built || G.outposts > 0),
      cost: () => GOLD_COSTS[gd.lv],
      iconFn: () =>
        gd.built
          ? (c) => {
              ICONS.goldboy(c);
              iconPath(c, ICONS.up, 40, -30, 0.55);
            }
          : ICONS.goldboy,
      lv: () => gd.lv,
      buy: () => buildGold(),
    }),
  );
  for (const p of pads) {
    p.cost = p.price();
    p.key = '';
  }
  return pads;
}
// a cannon spot; `ready` says when it shows up for building
function cannonPad(cn: Cannon, ready: () => boolean): Pad {
  const i = G.cannons.indexOf(cn);
  return createPad({
    id: 'cannon' + i,
    x: cn.x,
    z: cn.z,
    icon: null,
    posFn: () => (cn.built ? cn.side : [cn.x, cn.z]),
    visible: () => cn.level < CANNON_MAX && (cn.built || ready()),
    cost: () => (cn.built ? Math.round(cn.cost0 * Math.pow(1.9, cn.level)) : cn.cost0),
    iconFn: () => (c) => {
      ICONS.cannon(c);
      if (cn.built) iconPath(c, ICONS.up, 40, -32, 0.55);
    },
    lv: () => cn.level,
    buy: () => buildCannon(i),
  });
}
function recruitStep(): [cost: number, people: number] {
  const i = G.recruitIdx;
  if (i < RECRUIT.length) return RECRUIT[i];
  return [Math.round(250 * Math.pow(1.25, i - RECRUIT.length + 1)), 6];
}

// --------------------------------------------------------------- entities ----
function addFollower(fromBarracks: boolean): void {
  const k = G.king,
    n = G.followers.length;
  const f: Follower = {
    x: fromBarracks ? RECRUIT_PAD[0] : k.x + (Math.random() - 0.5) * 2,
    z: fromBarracks ? RECRUIT_PAD[1] : k.z + (Math.random() - 0.5) * 2,
    yaw: 0,
    cd: Math.random(),
    slot: n,
    bob: Math.random() * 6,
    atkT: 0,
    rank: 1,
    pop: 0,
  };
  G.followers.push(f);
}
// everyone in the troop, including recruits still running over to join someone
const people = () => G.followers.reduce((s, f) => s + f.rank, 0) + G.joiners.length;
function addPeople(count: number, fromBarracks: boolean): void {
  for (let i = 0; i < count; i++) {
    if (G.followers.length < SQUAD_MAX) {
      addFollower(fromBarracks);
      continue;
    }
    // the weakest follower (counting who is already on the way to him) gets the newcomer
    let f: Follower | null = null,
      best = 1e9;
    for (const o of G.followers) {
      const r = o.rank + G.joiners.filter((j) => j.target === o).length;
      if (r < best) {
        best = r;
        f = o;
      }
    }
    if (fromBarracks)
      G.joiners.push({
        x: RECRUIT_PAD[0] + (Math.random() - 0.5),
        z: RECRUIT_PAD[1] + (Math.random() - 0.5),
        yaw: 0,
        bob: Math.random() * 6,
        target: f!,
      });
    else promote(f!);
  }
}
function promote(f: Follower): void {
  const before = rankTier(f.rank);
  f.rank++;
  f.pop = 1;
  burst(f.x, 1.2, f.z, rankTier(f.rank) > before ? 14 : 6, '#7dff6a');
  if (rankTier(f.rank) > before) shockwave(f.x, f.z, 2, '#7dff6a');
}
function recruit() {
  const [, n] = recruitStep();
  addPeople(n, true);
  G.recruitIdx++;
  const lv = BARRACKS_STEPS.filter((s) => G.recruitIdx >= s).length;
  if (lv > G.barracksLv) {
    G.barracksLv = lv;
    upgradeBuilding(G.barracks!, lv);
    refreshObstacles();
  } else celebrate(RECRUIT_PAD[0], RECRUIT_PAD[1], 1.2, false);
}
function castleMaxHp(): number {
  return 5000 * (1 + 0.12 * G.towers.reduce((s, t) => s + (t.outer ? 0 : t.level), 0));
}
function weapon(forTower: boolean) {
  let t = G.tier;
  if (forTower && t === 4) t = 3;
  const w = WEAPONS[t];
  return { ...w, dmg: w.dmg * Math.pow(1.25, G.extraDmg), tier: t };
}
function buildTower(t: Tower): void {
  t.built = true;
  t.level = 1;
  t.cd = [];
  t.b = makeBuilding(t.x, t.z, 0, towerGeo, 1, t.outer ? 5 : 0, TOWER_LV[0].h);
  celebrate(t.x, t.z, TOWER_LV[0].h, false);
  if (t.outer) buildOutpost(t);
  else setTowerWalls(t);
  refreshObstacles();
}

// --------------------------------------------------------------- frontier ----
// Each front is an enemy camp past the border and the road from it to the castle. Outposts are built where a
// front's road crosses the border; each claims a round of land around it. When the border reaches a camp, the
// camp is cleared (it falls into a ruin) and the enemy makes a new one further out, with a new stretch of road
// back to the old one, so its march gets longer, through land the king now holds.
function initFronts() {
  G.fronts = FRONTS.map((def): Front => {
    const startsOpen = typeof def.open === 'number';
    const camp = makeCamp(def.road[0][0], def.road[0][1], startsOpen);
    return {
      id: def.id,
      road: def.road,
      segs: def.own ? [def.road.slice(0, def.own)] : [],
      adv: 0,
      open: startsOpen,
      openAt: typeof def.open === 'number' ? def.open : Infinity,
      shared: startsOpen,
      timer: 3,
      restAt: 0,
      camp,
    };
  });
  refreshFrontier();
}
const frontOpen = (f: Front) => f.open && G.t >= f.openAt;
const placeName = (b: Biome) => (b === BIOME.canyon ? 'the canyon' : 'the ' + BIOME_NAMES[b]);
function openFront(id: string): void {
  const f = G.fronts.find((o) => o.id === id);
  if (!f || f.open) return;
  f.open = true;
  f.openAt = G.t + 4;
  f.timer = 2;
  f.segs.forEach((seg, i) => addRoad(`front-${f.id}-${i}`, seg));
  f.camp.group.visible = true;
  f.camp.state = 'rise';
  f.camp.t = 0;
  toast(`A new road has opened: ${BIOME_NAMES[f.camp.theme]}`);
  gust(f.segs[f.segs.length - 1], f.camp.theme);
  refreshFrontier();
}
function gust(road: Pt[], theme: Biome): void {
  const dust = LOOKS[theme].dust;
  for (let j = 0; j < road.length - 1; j++)
    for (let s = 0; s < 1; s += 0.34)
      puff(
        road[j][0] + (road[j + 1][0] - road[j][0]) * s,
        0.6,
        road[j][1] + (road[j + 1][1] - road[j][1]) * s,
        dust,
        2,
      );
}
// take in a round of land; camps it reaches fall back, and the outpost spots move out to the new border
function claim(x: number, z: number, r: number): void {
  G.claims.push({ x, z, r, shown: 0 });
  G.reach = Math.max(G.reach, ...G.claims.map((c) => Math.hypot(c.x - HOME.x, c.z - HOME.z) + c.r));
  for (const f of G.fronts)
    for (let n = 0; n < 4 && borderDist(G.claims, f.camp.x, f.camp.z) < CAMP_REACHED; n++) fallBack(f);
  refreshFrontier();
  refreshPosts();
  world.borderU.count.value = 0; // send the claims to the border again
}
function fallBack(f: Front): void {
  const old = f.camp;
  const p = nextCamp(
    old,
    G.claims,
    G.fronts.filter((o) => o !== f).map((o) => o.camp),
    G.rand,
  );
  const seg = campRoad(p, old, G.rand);
  f.road = [...seg.slice(0, -1), ...f.road];
  f.segs.push(seg);
  f.camp = makeCamp(p.x, p.z, f.open);
  if (!f.open) {
    scene.remove(old.group);
    unkeepClear(old.x, old.z);
    return;
  }
  addRoad(`front-${f.id}-${f.segs.length - 1}`, seg);
  clearCamp(old);
  f.restAt = G.t + 4;
  toast(`The enemy fell back to ${placeName(f.camp.theme)}`);
  gust(seg, f.camp.theme);
}
// ----- camps: tents in the colours of the enemy that lives there, a banner, stakes and a fire
const campGeos = new Map<string, Geo>();
function campGeo(theme: Biome, ruin: boolean): Geo {
  const key = theme + (ruin ? 'r' : '');
  let g = campGeos.get(key);
  if (g) return g;
  const K = PAL[theme].knight,
    p: Geo[] = [];
  if (!ruin) {
    p.push(
      vc(Co(1.9, 2.9, 6), K.body, T(0, 1.45, 0)),
      vc(Co(0.62, 0.5, 6), K.belt, T(0, 2.95, 0)),
      vc(B(0.9, 1.3, 0.1), K.visor, T(0, 0.65, 1.42, -0.33, 0, 0)),
    );
    p.push(vc(Co(1.0, 1.6, 6), K.light, T(2.4, 0.8, -1.3)), vc(Co(1.0, 1.6, 6), K.belt, T(-2.2, 0.8, -1.6)));
    p.push(
      vc(Cy(0.07, 0.07, 4.0, 6), '#4a3428', T(-1.7, 2.0, 1.6)),
      vc(B(1.1, 1.5, 0.06), K.body, T(-1.12, 3.1, 1.6)),
      vc(B(1.1, 0.22, 0.07), K.plume, T(-1.12, 2.4, 1.6)),
      vc(S(0.12, 6, 5), K.plume, T(-1.7, 4.05, 1.6)),
    );
    p.push(
      vc(Cy(0.1, 0.1, 1.1, 6), '#4a3428', T(1.9, 0.12, 1.9, 0, 0.6, Math.PI / 2)),
      vc(Cy(0.1, 0.1, 1.1, 6), '#4a3428', T(1.9, 0.12, 1.9, 0, -0.6, Math.PI / 2)),
      vc(Co(0.34, 0.75, 6), '#ff9a2a', T(1.9, 0.48, 1.9)),
      vc(Co(0.18, 0.45, 5), '#ffe36a', T(1.9, 0.4, 1.9)),
    );
  } else {
    p.push(
      vc(Co(2.0, 0.55, 6), '#3a2f2b', T(0, 0.27, 0)),
      vc(Co(1.1, 0.4, 6), K.body, T(0.4, 0.3, 0.3, 0.2, 0.5, 0.1)),
      vc(Co(0.9, 0.3, 6), '#2e2725', T(2.3, 0.15, -1.3)),
    );
    p.push(
      vc(Cy(0.07, 0.07, 3.6, 6), '#4a3428', T(-1.4, 0.15, 1.2, 0, 0.7, Math.PI / 2 - 0.08)),
      vc(B(1.0, 0.05, 1.3), K.body, T(-0.5, 0.06, 1.8, 0, 0.5, 0)),
    );
    p.push(
      vc(Cy(0.1, 0.1, 1.1, 6), '#2a2220', T(1.9, 0.1, 1.9, 0, 0.6, Math.PI / 2)),
      vc(Cy(0.1, 0.1, 1.1, 6), '#2a2220', T(1.9, 0.1, 1.9, 0, -0.6, Math.PI / 2)),
    );
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.2,
      r = 3.6,
      broken = ruin && i % 3 !== 0,
      lean = broken ? 1.2 : 0.3,
      h = broken ? 0.7 : 1.3;
    p.push(
      vc(
        Cy(0.08, 0.1, h, 5),
        C.stake,
        T(Math.sin(a) * r, (h / 2) * Math.cos(lean), Math.cos(a) * r, Math.cos(a) * lean, 0, -Math.sin(a) * lean),
      ),
    );
    if (!broken)
      p.push(
        vc(
          Co(0.09, 0.22, 5),
          C.stakeTip,
          T(Math.sin(a) * (r + 0.2), h + 0.08, Math.cos(a) * (r + 0.2), Math.cos(a) * lean, 0, -Math.sin(a) * lean),
        ),
      );
  }
  g = merge(p);
  campGeos.set(key, g);
  return g;
}
function makeCamp(x: number, z: number, shown: boolean): Camp {
  const theme = biomeAt(x, z),
    group = new THREE.Group(),
    mesh = new THREE.Mesh(campGeo(theme, false), world.vmat);
  mesh.castShadow = true;
  mesh.rotation.y = Math.atan2(HOME.x - x, HOME.z - z); // the tent door faces the castle
  group.add(mesh);
  group.position.set(x, 0, z);
  group.visible = shown;
  scene.add(group);
  G.dispose.push(group);
  const c: Camp = {
    x,
    z,
    theme,
    group,
    mesh,
    state: shown ? 'rise' : 'hidden',
    t: G.t > 0 ? 0 : 1,
    smokeT: Math.random(),
  };
  if (c.t >= 1) c.state = 'up';
  group.scale.setScalar(c.t >= 1 ? 1 : 0.01);
  keepClear(x, z, 5);
  return c;
}
function clearCamp(c: Camp): void {
  c.state = 'fall';
  c.t = 0;
  G.ruins.push(c);
  bigText('Camp cleared!', c.x, 5, c.z);
  puff(c.x, 1.2, c.z, '#d8d0c4', 16);
  dust(c.x, c.z, 2.6, 12);
  shockwave(c.x, c.z, 6, '#ffffff');
}
function updateCamps(dt: number): void {
  const k = G.king;
  for (const f of G.fronts) {
    const c = f.camp;
    animCamp(c, dt);
    // smoke from the camp fire
    if (
      c.state !== 'up' ||
      !c.group.visible ||
      (c.smokeT -= dt) > 0 ||
      world.fx.length >= 200 ||
      Math.hypot(c.x - k.x, c.z - k.z) > 60
    )
      continue;
    c.smokeT = 0.5;
    const a = c.mesh.rotation.y;
    smoke(
      c.x + 1.9 * Math.cos(a) + 1.9 * Math.sin(a),
      1.1,
      c.z - 1.9 * Math.sin(a) + 1.9 * Math.cos(a),
      '#8d8682',
      0.9,
    );
  }
  for (const c of G.ruins) animCamp(c, dt);
}
function animCamp(c: Camp, dt: number): void {
  if (c.state === 'rise') {
    c.t = Math.min(1, c.t + dt / 0.8);
    c.group.scale.set(1, Math.max(0.01, easeOutBack(c.t)), 1);
    if (c.t >= 1) c.state = 'up';
    if (c.t < 0.05 && !c.dusted) {
      c.dusted = true;
      dust(c.x, c.z, 2.4, 10);
    }
  } else if (c.state === 'fall') {
    c.t = Math.min(1, c.t + dt / 0.7);
    c.group.scale.set(1 + c.t * 0.15, Math.max(0.05, 1 - easeOut(c.t) * 0.9), 1 + c.t * 0.15);
    if (c.t >= 1) {
      c.state = 'ruin';
      c.mesh.geometry = campGeo(c.theme, true);
      c.group.scale.set(1, 1, 1);
    }
  }
}
// ----- outposts: a spot beside each open front's road, just inside the border
function refreshFrontier() {
  const want: Site[] = [];
  for (const f of G.fronts) {
    if (!f.open) continue;
    const s = findSite(f.road, 1);
    if (s && !want.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 10)) want.push(s);
  }
  for (const t of G.towers.filter((o) => o.outer && !o.built)) {
    const i = want.findIndex((o) => Math.hypot(o.x - t.x, o.z - t.z) < 3);
    if (i >= 0) want.splice(i, 1);
    else dropSite(t);
  }
  for (const s of want) addSite(s);
}
// a free spot SITE_SIDE beside a road, starting where it first gets PAD_IN inside the border and moving in
// until one is free; `side` 1 or -1 is the side to try first (0: whichever has more room)
function findSite(road: Pt[], side = 0, from: RoadPoint | null = null): Site | null {
  const c = from || roadCrossing(road, G.claims, PAD_IN);
  if (!c) return null;
  for (let k = 0; k < 10; k++) {
    const p = pointAlong(road, c.at + k * 2.5)!;
    const opts = side ? [side, -side] : [1, -1];
    for (const sd of opts) {
      const x = p.x - p.dz * sd * SITE_SIDE,
        z = p.z + p.dx * sd * SITE_SIDE;
      if (siteFree(x, z)) return { x, z, rx: p.x, rz: p.z, dx: p.dx, dz: p.dz, side: sd, at: p.at, road };
    }
  }
  return null;
}
function siteFree(x: number, z: number): boolean {
  if (borderDist(G.claims, x, z) > -3 || x < cliffMinX(z) + 2.5 || (Math.abs(x) < HX + 4 && Math.abs(z) < HZ + 4))
    return false;
  if (pushOutOfMesas(x, z, 3)[0] !== x) return false;
  if (
    world.terrain.roads.some((r) => pathDist(x, z, r.pts) < 3.6) ||
    G.fronts.some((f) => f.open && pathDist(x, z, f.road) < 3.6)
  )
    return false;
  if ((G.obs || []).some(([ox, oz, r]) => Math.hypot(ox - x, oz - z) < r + 3)) return false;
  // (spots not built on yet don't count: refreshFrontier is deciding where they go)
  if (
    G.towers.some((t) => (t.built || !t.outer) && Math.hypot(t.x - x, t.z - z) < 7) ||
    G.cannons.some((c) => Math.hypot(c.x - x, c.z - z) < 7)
  )
    return false;
  if (G.pads && G.pads.some((p) => !(p.site && !p.site.built) && Math.hypot(p.x - x, p.z - z) < 5.5)) return false;
  if (
    G.fronts.some((f) => Math.hypot(f.camp.x - x, f.camp.z - z) < 7) ||
    G.ruins.some((c) => Math.hypot(c.x - x, c.z - z) < 6)
  )
    return false;
  return Math.hypot(GOLD_HUT[0] - x, GOLD_HUT[1] - z) > 8 && Math.hypot(GOLD_PLOT[0] - x, GOLD_PLOT[1] - z) > 7;
}
const outpostCost = () => Math.round(OUTPOST_COST * Math.pow(OUTPOST_GROW, G.outposts));
function addSite(s: Site): void {
  // the upgrade pad goes on the castle side of the tower
  const hx = HOME.x - s.x,
    hz = HOME.z - s.z,
    hl = Math.hypot(hx, hz) || 1;
  const t: Tower = {
    x: s.x,
    z: s.z,
    up: [s.x + (hx / hl) * 4.4, s.z + (hz / hl) * 4.4],
    outer: true,
    idx: G.siteSeq++,
    site: s,
    built: false,
    level: 0,
    b: null,
    cd: [],
    aim: undefined,
  };
  G.towers.push(t);
  outpostPad(t);
  keepClear(t.x, t.z, 4);
}
// the pad of an outpost (or the spot for one): it builds the outpost, then upgrades it
function outpostPad(t: Tower): Pad {
  const pad = createPad({
    id: 'outpost' + t.idx,
    x: t.x,
    z: t.z,
    posFn: () => (t.built ? t.up : [t.x, t.z]),
    visible: () => t.level < 5 && (t.built || G.cannons.filter((c) => c.built).length >= 2),
    cost: () => (t.built ? Math.round(TOWER_UP[t.level - 1] * OUTPOST_UP) : outpostCost()),
    iconFn: () =>
      t.built
        ? (c) => {
            ICONS.tower(c);
            iconPath(c, ICONS.up, 40, 30, 0.6);
          }
        : ICONS.outpost,
    lv: () => t.level,
    buy: () => (t.built ? upgradeTower(t) : buildTower(t)),
  });
  pad.cost = pad.price();
  t.pad = pad;
  pad.site = t;
  G.pads.push(pad);
  return pad;
}
function dropSite(t: Tower): void {
  G.towers.splice(G.towers.indexOf(t), 1);
  const i = G.pads.indexOf(t.pad!);
  if (i >= 0) {
    G.pads.splice(i, 1);
    scene.remove(t.pad!.mesh);
    t.pad!.tex.dispose();
  }
  unkeepClear(t.x, t.z);
}
function buildOutpost(t: Tower): void {
  G.outposts++;
  claim(t.x, t.z, CLAIM_OUTPOST);
  bigText('The border moves out', t.x, 6, t.z);
  // a field cannon spot across the road
  const s = t.site!,
    x = s.rx + s.dz * s.side * 5.4,
    z = s.rz - s.dx * s.side * 5.4;
  if (siteFreeFor(x, z, t)) {
    const hx = HOME.x - x,
      hz = HOME.z - z,
      hl = Math.hypot(hx, hz) || 1;
    const cn: Cannon = {
      x,
      z,
      side: [x + (hx / hl) * 4.4, z + (hz / hl) * 4.4],
      cost0: Math.round(FIELD_CANNON_COST * Math.pow(FIELD_CANNON_GROW, G.fieldCannons++)),
      built: false,
      level: 0,
      b: null,
      turret: null,
      cd: 0,
      yaw: Math.atan2(-s.dx, -s.dz),
      field: true,
    };
    G.cannons.push(cn);
    const pad = cannonPad(cn, () => t.built);
    pad.cost = pad.price();
    G.pads.push(pad);
    keepClear(x, z, 4);
  }
  refreshFrontier(); // a spot the field cannon took moves along
  if (G.outposts === 1) {
    openFront('S');
    toast('The border moved out. Outposts on the border push it further.');
  }
}
// the field cannon may stand closer to its own outpost than spots usually may
function siteFreeFor(x: number, z: number, t: Tower): boolean {
  const saved = G.towers.indexOf(t);
  G.towers.splice(saved, 1);
  const ok = siteFree(x, z);
  G.towers.splice(saved, 0, t);
  return ok;
}
// spots kept clear of trees and rocks
function keepClear(x: number, z: number, r: number): void {
  G.clear.push({ x, z, r });
  dirtyArea(x - r, z - r, x + r, z + r);
  for (const m of world.terrain.homeDecor)
    if (Math.hypot(m.position.x - x, m.position.z - z) < r + 1) m.visible = false;
}
function unkeepClear(x: number, z: number): void {
  const i = G.clear.findIndex((c) => c.x === x && c.z === z);
  if (i >= 0) {
    const [c] = G.clear.splice(i, 1);
    dirtyArea(c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
  }
}
// a new game: only the first roads, every chunk redecorated, the hand-placed decor back
function resetWorld() {
  const TR = world.terrain;
  for (const r of TR.roads.slice()) if (r.id.startsWith('front-')) removeRoad(r.id);
  for (const ch of TR.chunks.values()) ch.dirty = true;
  for (const m of TR.homeDecor) m.visible = !TR.roads.some((r) => pathDist(m.position.x, m.position.z, r.pts) < 3.2);
  G.ruins = [];
}
function upgradeTower(t: Tower): void {
  t.level++;
  upgradeBuilding(t.b!, t.level);
  t.b!.h = TOWER_LV[t.level - 1].h;
  if (!t.outer) {
    setTowerWalls(t);
    bigText(WALL_TIERS[t.level - 1].name, t.up[0], 4, t.up[1]);
  }
}
function buildForge() {
  G.forge = makeForge(0);
  celebrate(FORGE[0], FORGE[1], 2.5, false);
  refreshObstacles();
}
// the forge at a weapon's level (0 before the first upgrade)
function makeForge(lv: number): Building {
  const b = makeBuilding(FORGE[0], FORGE[1], Math.PI / 4, forgeGeo, lv, 6.5, 2.5 + lv * 0.4);
  const lava = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 0.05, 8), world.lavaMat);
  lava.position.y = 1.69;
  b.body.add(lava);
  const smith = new THREE.Mesh(world.smithGeo, world.vmat);
  smith.position.set(1.25, 0, -0.5);
  smith.rotation.y = 0.6;
  smith.castShadow = true;
  b.body.add(smith);
  b.smith = smith;
  return b;
}
function upgradeWeapon() {
  if (G.tier < FORGE_COSTS.length) {
    G.tier++;
    upgradeBuilding(G.forge!, G.tier);
    G.forge!.h = 2.5 + G.tier * 0.4;
    bigText(WEAPONS[G.tier].name, FORGE[0], 5, FORGE[1]);
  } else {
    G.extraDmg++;
    celebrate(FORGE[0], FORGE[1], G.forge!.h, true);
    bigText(`${WEAPONS[G.tier].name} +${G.extraDmg}`, FORGE[0], 5, FORGE[1]);
  }
  for (const f of G.followers) burst(f.x, 1, f.z, 3, '#bfe8ff');
  shockwave(G.king.x, G.king.z, (G.ringR || 2) + 2, '#bfe8ff');
  setKingWeapon();
  refreshObstacles();
}
function setKingWeapon() {
  const W = world;
  W.kingWeapon.clear();
  const m = new THREE.Mesh(weaponGeo(G.tier), W.vmat);
  m.position.set(0.05, 1.0, 0.05);
  m.scale.setScalar(1.1);
  m.castShadow = true;
  W.kingWeapon.add(m);
}
function buildCannon(i: number): void {
  const c = G.cannons[i];
  if (!c.built) {
    c.built = true;
    c.level = 1;
    makeCannon(c);
    celebrate(c.x, c.z, 2.2, false);
    if (!c.field) openFront('N');
  } else {
    c.level++;
    upgradeBuilding(c.b!, c.level);
  }
  refreshObstacles();
}
// a cannon's building and turret, at its level
function makeCannon(c: Cannon): void {
  const b = makeBuilding(c.x, c.z, 0, cannonBaseGeo, c.level, 5.5, 2.2);
  const tur = new THREE.Mesh(geoFor(cannonTurretGeo, c.level), world.vmat);
  tur.position.y = CANNON_TOP[c.level - 1];
  tur.castShadow = true;
  tur.rotation.y = c.yaw;
  b.body.add(tur);
  c.b = b;
  c.turret = tur;
  b.onSwap = (lv) => {
    tur.geometry = geoFor(cannonTurretGeo, lv);
    tur.position.y = CANNON_TOP[lv - 1];
  };
}
function buildGold() {
  const gd = G.gold;
  if (!gd.built) {
    gd.built = true;
    gd.lv = 1;
    makeGoldHut();
    celebrate(GOLD_HUT[0], GOLD_HUT[1], 3.6, false);
  } else {
    gd.lv++;
    upgradeBuilding(gd.b!, gd.lv);
  }
  while (gd.boys.length < GOLD_BOYS[gd.lv - 1].n) addGoldBoy(GOLD_HUT[0] + 1.6, GOLD_HUT[1] + 2.2, 0);
  bigText(gd.lv === 1 ? 'Gold boy' : '+1 gold boy', GOLD_HUT[0], 5, GOLD_HUT[1]);
  refreshObstacles();
}
// the gold hut at its level, and the plot beside it
function makeGoldHut(): void {
  const gd = G.gold;
  gd.b = makeBuilding(GOLD_HUT[0], GOLD_HUT[1], Math.PI / 4, goldHutGeo, gd.lv, 7, 3.6);
  gd.plotB = makeBuilding(GOLD_PLOT[0], GOLD_PLOT[1], 0, plotGeo, 1, 0, 0.6);
}
// a gold boy, carrying `load` coins (back to the plot) or none (waiting by the hut)
function addGoldBoy(x: number, z: number, load: number): void {
  const gd = G.gold;
  gd.boys.push({
    x,
    z,
    yaw: 0.8,
    bob: Math.random() * 6,
    load,
    state: load > 0 ? 'return' : 'idle',
    target: null,
    retarget: 0.8 + gd.boys.length * 0.4,
    moving: false,
  });
}
// things the king bumps into
function refreshObstacles() {
  const rot = (bx: number, bz: number, yaw: number, lx: number, lz: number): Pt => [
    bx + lx * Math.cos(yaw) + lz * Math.sin(yaw),
    bz - lx * Math.sin(yaw) + lz * Math.cos(yaw),
  ];
  const o: Obstacle[] = [
    [CASTLE.x, CASTLE.z, CASTLE.r + 0.4],
    [BARRACKS[0], BARRACKS[1], G.barracksLv >= 3 ? 2.8 : 2.6],
  ];
  if (G.barracksLv >= 2) o.push([...rot(BARRACKS[0], BARRACKS[1], Math.PI / 4, 2.4, 0), 1.0]);
  if (G.barracksLv >= 4) o.push([...rot(BARRACKS[0], BARRACKS[1], Math.PI / 4, 2.5, -0.6), 1.2]);
  if (G.forge) {
    o.push([FORGE[0], FORGE[1], 1.3]);
    const r = [0, 0.9, 1.4, 1.6, 1.8, 1.9, 2.0][G.tier];
    if (r) o.push([...rot(FORGE[0], FORGE[1], Math.PI / 4, 0.3, -2.0), r]);
  }
  for (const c of G.cannons) if (c.built) o.push([c.x, c.z, [1.5, 1.8, 2.0, 2.0, 2.1][c.level - 1]]);
  for (const t of G.towers) if (t.built && t.outer) o.push([t.x, t.z, t.level >= 5 ? 2.0 : 1.5]);
  const gd = G.gold;
  if (gd.built) {
    o.push([GOLD_HUT[0], GOLD_HUT[1], 2.0]);
    if (gd.lv >= 2) o.push([...rot(GOLD_HUT[0], GOLD_HUT[1], Math.PI / 4, 2.4, -1.0), 1.1]);
    if (gd.lv >= 3) o.push([...rot(GOLD_HUT[0], GOLD_HUT[1], Math.PI / 4, -0.6, -2.6), 1.3]);
  }
  G.obs = o;
}

// ----------------------------------------------------------------- border ----
// The border is drawn on the ground by one big plane that follows the king: a dashed white line along the edge
// of the claimed land and a dusky veil over the land past it. Small blue flags stand along the line. A new claim
// grows out from its outpost (`shown` eases up to `r`).
const MAX_CLAIMS = 64,
  BORDER_SIZE = 320,
  POST_STEP = 9,
  POST_CAP = 600;
function initBorder() {
  const W = world;
  W.borderU = { claims: { value: Array.from({ length: MAX_CLAIMS }, () => new THREE.Vector4()) }, count: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: W.borderU,
    transparent: true,
    depthWrite: false,
    vertexShader:
      'varying vec2 vP; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform vec4 claims[${MAX_CLAIMS}]; uniform int count; varying vec2 vP;
      void main() {
        float d = 1e9; vec4 best = vec4(0.0);
        for (int i = 0; i < ${MAX_CLAIMS}; i++) { if (i >= count) break; float v = length(vP - claims[i].xy) - claims[i].z; if (v < d) { d = v; best = claims[i]; } }
        // dashes go round each claim's circle a whole number of times, so they meet up
        float n = max(6.0, floor(6.2832 * best.w / 2.6)), s = (atan(vP.y - best.y, vP.x - best.x) / 6.2832 + 0.5) * n;
        float fs = fwidth(s), dash = smoothstep(0.62 + fs, 0.62 - fs, fract(s)) * smoothstep(-fs, fs, fract(s));
        float fd = fwidth(d), line = (1.0 - smoothstep(0.2 - fd, 0.2 + fd, abs(d - 0.1))) * dash;
        float veil = smoothstep(0.3, 1.5, d) * 0.1 + smoothstep(0.0, 14.0, d) * 0.16;
        gl_FragColor = vec4(mix(vec3(0.17, 0.12, 0.22), vec3(1.0), line), max(veil, line * 0.92));
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(BORDER_SIZE, BORDER_SIZE), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.frustumCulled = false;
  scene.add(m);
  W.border = m;
  W.posts = inst(merge(flag(0, 0, 0, '#3d7be0', 1.4)), W.vmat, POST_CAP);
  W.posts.count = 0;
}
// flags every POST_STEP paces along the border, not on roads, the canyon wall or the mesas
function refreshPosts() {
  const P: Post[] = [],
    old = G.posts || [];
  for (const c of G.claims) {
    const n = Math.max(6, Math.round((2 * Math.PI * c.r) / POST_STEP));
    for (let i = 0; i < n && P.length < POST_CAP; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2,
        x = c.x + Math.cos(a) * c.r,
        z = c.z + Math.sin(a) * c.r;
      if (G.claims.some((o) => o !== c && Math.hypot(x - o.x, z - o.z) < o.r - 0.5)) continue;
      if (x < cliffMinX(z) + 1 || pushOutOfMesas(x, z, 1)[0] !== x) continue;
      if (
        world.terrain.roads.some((r) => pathDist(x, z, r.pts) < 2.6) ||
        G.fronts.some((f) => pathDist(x, z, f.road) < 2.6)
      )
        continue;
      const was = old.find((q) => Math.hypot(q.x - x, q.z - z) < 0.5);
      P.push({ x, z, t: was ? was.t : c.shown >= c.r - 0.1 ? 1 : -0.9 }); // new ones rise once the border gets there
    }
  }
  G.posts = P;
}
function updateBorder(dt: number): void {
  const W = world,
    k = G.king;
  let moving = false;
  for (const c of G.claims)
    if (c.shown !== c.r) {
      c.shown += (c.r - c.shown) * Math.min(1, dt * 2.4);
      if (Math.abs(c.r - c.shown) < 0.05) c.shown = c.r;
      moving = true;
    }
  if (moving || !W.borderU.count.value) {
    const list =
      G.claims.length <= MAX_CLAIMS
        ? G.claims
        : G.claims
            .slice()
            .sort((a, b) => Math.hypot(a.x - k.x, a.z - k.z) - a.r - (Math.hypot(b.x - k.x, b.z - k.z) - b.r))
            .slice(0, MAX_CLAIMS);
    list.forEach((c, i) => W.borderU.claims.value[i].set(c.x, c.z, c.shown, c.r));
    W.borderU.count.value = list.length;
  }
  W.border.position.set(Math.round(k.x), 0.03, Math.round(k.z));
  let n = 0;
  for (const p of G.posts) {
    if (p.t < 1) p.t = Math.min(1, p.t + dt / 0.6);
    const s = p.t <= 0 ? 0.001 : Math.max(0.001, easeOutBack(p.t));
    tmpM.compose(
      tmpV.set(p.x, 0, p.z),
      tmpQ.setFromEuler(tmpE.set(0, Math.sin(G.t * 2.2 + p.x * 0.3) * 0.18, 0)),
      tmpS.set(1, s, 1),
    );
    W.posts.setMatrixAt(n++, tmpM);
  }
  W.posts.count = n;
  W.posts.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- enemies ----
// Difficulty rises smoothly with time; there are no waves. Groups are bought
// from a budget that grows over time, and the mix shifts from many small
// knights toward fewer, bigger brutes and giants.
const level = () => G.t / 13;
function spawnEnemy(kind: UnitKind, f: Front): Enemy {
  const L = level(),
    u = UNIT[kind],
    camp = f.camp,
    theme = camp.theme,
    tier = campTier(camp),
    hpK = tierHp(tier),
    road = f.road;
  const e: Enemy = {
    kind,
    theme,
    x: road[0][0] + (Math.random() - 0.5) * 1.2,
    z: road[0][1] + (Math.random() - 0.5) * 1.2,
    route: road,
    wp: 1,
    hp: 0,
    max: 0,
    speed: 0,
    dmg: 0,
    r: u.r,
    atk: 0,
    yaw: 0,
    bob: Math.random() * 6,
    state: 'path',
    seg: null,
    lunge: 0,
    value: 1,
    hitFlash: 0,
    side: (Math.random() - 0.5) * (kind === 'knight' ? 1.4 : 0.8),
    scale: u.scale,
    mkey: '',
  };
  e.max = 22 * Math.pow(1.1, L) * hpK * u.hp;
  e.dmg = 8 * Math.pow(1.06, L) * u.dmg * (1 + (hpK - 1) * 0.5);
  e.value = Math.max(1, Math.round((2 + L / 2) * u.value * tierValue(tier)));
  e.speed = (kind === 'knight' ? 2.4 + Math.min(1.2, L * 0.03) : u.speed) * BIOME_SPEED[theme];
  const v =
    kind === 'knight'
      ? Math.random() < 0.35
        ? 'S'
        : ''
      : kind === 'giant' && PAL[theme].giants[1] && Math.random() < 0.5
        ? 'R'
        : '';
  e.mkey = kind + v + theme;
  e.hp = e.max;
  G.enemies.push(e);
  return e;
}
function queueGroup(f: Front, L: number): void {
  let budget = 5 + L * 0.7,
    t = 0,
    n = 0;
  const ws = Math.max(0.25, 1 - L * 0.03),
    wb = L < 3 ? 0 : Math.min(1.2, (L - 3) * 0.07),
    wg = L < 10 ? 0 : Math.min(0.8, (L - 10) * 0.04);
  while (budget >= 1 && n < 14) {
    const b = budget >= 4 ? wb : 0,
      g = budget >= 12 ? wg : 0,
      r = Math.random() * (ws + b + g);
    const kind = r < ws ? 'knight' : r < ws + b ? 'brute' : 'giant';
    budget -= UNIT[kind].cost;
    n++;
    G.spawnQueue.push({ f, kind, t });
    t += kind === 'knight' ? 0.35 : 0.8;
  }
}
// The three first fronts take turns on one timer; the fronts that open later each send groups on top of that.
// A camp that has just fallen back rests a few seconds while it goes up.
function updateSpawns(dt: number): void {
  const L = level();
  if (G.enemies.length < 300) {
    G.spawnT -= dt;
    if (G.spawnT <= 0) {
      const open = G.fronts.filter((f) => f.shared && frontOpen(f) && G.t >= f.restAt);
      if (open.length) queueGroup(open[G.nextPath++ % open.length], L);
      G.spawnT = Math.max(1.0, 3 * Math.pow(0.955, L));
    }
    for (const f of G.fronts) {
      if (f.shared || !frontOpen(f) || G.t < f.restAt) continue;
      f.timer -= dt;
      if (f.timer <= 0) {
        queueGroup(f, L);
        f.timer = Math.max(2.4, 5.5 * Math.pow(0.96, L));
      }
    }
  }
  for (let i = G.spawnQueue.length - 1; i >= 0; i--) {
    const q = G.spawnQueue[i];
    q.t -= dt;
    if (q.t <= 0) {
      spawnEnemy(q.kind, q.f);
      G.spawnQueue.splice(i, 1);
    }
  }
}

// spatial hash for enemies
const CELL = 3,
  grid = new Map<number, Enemy[]>();
const gkey = (cx: number, cz: number) => cx * 73856 + cz;
function rebuildGrid() {
  grid.clear();
  for (const e of G.enemies) {
    const k = gkey(Math.floor(e.x / CELL), Math.floor(e.z / CELL));
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(e);
  }
}
function nearestEnemy(x: number, z: number, range: number, exclude?: Set<Enemy>): Enemy | null {
  let best: Enemy | null = null,
    bd = range * range;
  const r = Math.ceil(range / CELL),
    cx = Math.floor(x / CELL),
    cz = Math.floor(z / CELL);
  for (let i = -r; i <= r; i++)
    for (let j = -r; j <= r; j++) {
      const a = grid.get(gkey(cx + i, cz + j));
      if (!a) continue;
      for (const e of a) {
        if (e.hp <= 0 || (exclude && exclude.has(e))) continue;
        const d = (e.x - x) ** 2 + (e.z - z) ** 2;
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
    }
  return best;
}
function enemiesNear(x: number, z: number, rad: number, out: Enemy[]): Enemy[] {
  out.length = 0;
  const r = Math.ceil((rad + 1.3) / CELL),
    cx = Math.floor(x / CELL),
    cz = Math.floor(z / CELL);
  for (let i = -r; i <= r; i++)
    for (let j = -r; j <= r; j++) {
      const a = grid.get(gkey(cx + i, cz + j));
      if (!a) continue;
      for (const e of a) if (e.hp > 0 && (e.x - x) ** 2 + (e.z - z) ** 2 < (rad + e.r) ** 2) out.push(e);
    }
  return out;
}
const inside = (x: number, z: number) => Math.abs(x) < HX && Math.abs(z) < HZ;
function segAt(x0: number, z0: number, x1: number, z1: number): Seg | null {
  // wall segment crossed when moving from outside (x0,z0) to inside (x1,z1)
  let t = 1,
    side = null as [Side, number] | null;
  const tryX = (bx: number, nm: Side) => {
    if ((x0 - bx) * (x1 - bx) <= 0 && x0 !== x1) {
      const tt = (bx - x0) / (x1 - x0);
      const zz = z0 + (z1 - z0) * tt;
      if (tt >= 0 && tt <= t && Math.abs(zz) <= HZ + 0.01) {
        t = tt;
        side = [nm, zz];
      }
    }
  };
  const tryZ = (bz: number, nm: Side) => {
    if ((z0 - bz) * (z1 - bz) <= 0 && z0 !== z1) {
      const tt = (bz - z0) / (z1 - z0);
      const xx = x0 + (x1 - x0) * tt;
      if (tt >= 0 && tt <= t && Math.abs(xx) <= HX + 0.01) {
        t = tt;
        side = [nm, xx];
      }
    }
  };
  tryX(HX, 'E');
  tryX(-HX, 'W');
  tryZ(HZ, 'S');
  tryZ(-HZ, 'N');
  if (!side) return null;
  const [nm, v] = side;
  for (const s of G.segs) if (s.side === nm && v >= s.lo - 0.01 && v <= s.hi + 0.01) return s;
  return null;
}
const near: Enemy[] = [];
// Enemies march along their path to the castle. Walls in the way get
// battered down first; the king, his archers and the gold boys are never targeted.
function updateEnemies(dt: number): void {
  const wallsUp = G.wallsUp,
    cs = G.castle;
  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    e.bob += dt * (e.kind === 'knight' ? 9 : 6);
    e.lunge = Math.max(0, e.lunge - dt * 3);
    e.hitFlash = Math.max(0, e.hitFlash - dt * 6);
    e.atk -= dt;
    if (e.state === 'wall') {
      if (!e.seg!.alive) {
        e.state = 'path';
        e.seg = null;
      } else {
        if (e.atk <= 0) {
          e.atk = UNIT[e.kind].atk;
          e.lunge = 1;
          hitWall(e.seg!, e.dmg);
        }
        continue;
      }
    }
    if (e.state === 'castle') {
      if (e.atk <= 0 && cs.hp > 0) {
        e.atk = UNIT[e.kind].atk;
        e.lunge = 1;
        hitCastle(e.dmg, e.x, e.z);
      }
      continue;
    }
    const path = e.route,
      last = e.wp >= path.length - 1;
    const p = path[Math.min(e.wp, path.length - 1)];
    // walk a little to one side of the trail so a column reads as a column, not a single file of clones
    const pp = path[Math.max(0, e.wp - 1)],
      sx = -(p[1] - pp[1]),
      sz = p[0] - pp[0],
      sl = Math.hypot(sx, sz) || 1;
    const tx = p[0] + (last ? 0 : (sx / sl) * e.side),
      tz = p[1] + (last ? 0 : (sz / sl) * e.side);
    const dx = tx - e.x,
      dz = tz - e.z,
      d = Math.hypot(dx, dz) || 1;
    if (last && Math.hypot(cs.x - e.x, cs.z - e.z) < cs.r + e.r + 0.2) {
      e.state = 'castle';
      e.yaw = Math.atan2(cs.x - e.x, cs.z - e.z);
      continue;
    }
    // a waypoint counts as reached once it is close or already behind (a crowd can keep anyone from touching it)
    if (!last) {
      const nx2 = path[e.wp + 1][0] - p[0],
        nz2 = path[e.wp + 1][1] - p[1];
      if (d < 1.3 || (e.x - p[0]) * nx2 + (e.z - p[1]) * nz2 > 0) {
        e.wp++;
        continue;
      }
    }
    e.yaw += angleDiff(Math.atan2(dx, dz), e.yaw) * Math.min(1, dt * 8);
    const step = Math.min(d, e.speed * dt);
    const nx = e.x + (dx / d) * step,
      nz = e.z + (dz / d) * step;
    if (wallsUp && !inside(e.x, e.z) && inside(nx, nz)) {
      const s = segAt(e.x, e.z, nx, nz);
      if (s && s.alive) {
        e.state = 'wall';
        e.seg = s;
        e.yaw = Math.atan2(dx, dz);
        continue;
      }
    }
    e.x = nx;
    e.z = nz;
  }
  // Spread enemies apart a little so they don't stack into one spot. The push
  // only ever goes sideways, never back against the way they walk, and is
  // capped, so a crowd can't hold itself up: in a jam they walk through each other.
  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    enemiesNear(e.x, e.z, e.r + 0.6, near);
    let px = 0,
      pz = 0,
      n = 0;
    for (const o of near) {
      if (o === e) continue;
      const dx = e.x - o.x,
        dz = e.z - o.z,
        d = Math.hypot(dx, dz) || 0.01,
        m = e.r + o.r;
      if (d < m) {
        const w = (m - d) * 0.5 * (o.r > e.r ? 1.4 : 0.8);
        px += (dx / d) * w;
        pz += (dz / d) * w;
        n++;
      }
    }
    if (!n || n > 8) continue;
    const fx = Math.sin(e.yaw),
      fz = Math.cos(e.yaw),
      back = px * fx + pz * fz;
    if (back < 0) {
      px -= back * fx;
      pz -= back * fz;
    }
    const pl = Math.hypot(px, pz),
      cap = 2.5 * dt;
    if (pl > cap) {
      px *= cap / pl;
      pz *= cap / pl;
    }
    const nx = e.x + px,
      nz = e.z + pz;
    // pushing must not shove an attacker through an intact wall
    if (G.wallsUp && !inside(e.x, e.z) && inside(nx, nz)) {
      const s = segAt(e.x, e.z, nx, nz);
      if (s && s.alive) continue;
    }
    e.x = nx;
    e.z = nz;
  }
}
function hitWall(s: Seg, dmg: number): void {
  s.hp -= dmg;
  s.hitT = 2.5;
  floatText(`-${Math.round(dmg)}`, s.cx + (Math.random() - 0.5), 2.6, s.cz + (Math.random() - 0.5), '#ffffff');
  if (s.hp <= 0) {
    s.alive = false;
    s.hp = 0;
    puff(s.cx, 1, s.cz, '#c8a27a', 14);
    rebuildWalls();
  }
}
function hitCastle(dmg: number, x: number, z: number): void {
  const cs = G.castle;
  cs.hp -= dmg;
  cs.hitT = 2.5;
  floatText(`-${Math.round(dmg)}`, cs.x + (x - cs.x) * 0.5, 4.2, cs.z + (z - cs.z) * 0.5, '#ffffff');
  if (cs.hp <= 0) {
    cs.hp = 0;
    gameOver();
  }
}
function damageEnemy(e: Enemy, dmg: number): void {
  if (e.hp <= 0) return;
  e.hp -= dmg;
  e.hitFlash = 1;
  if (e.hp <= 0) {
    G.kills++;
    puff(e.x, 0.8 * e.scale, e.z, '#ffffff', e.kind === 'knight' ? 6 : e.kind === 'brute' ? 10 : 16);
    dropCoins(e.x, e.z, e.value);
  }
}

// ------------------------------------------------------------------ coins ----
function dropCoins(x: number, z: number, value: number): void {
  const many = G.coinsOnGround.length > 350;
  const n = many ? Math.min(3, value) : Math.min(value, 12);
  const per = value / n;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2,
      s = 1 + Math.random() * 2.2;
    G.coinsOnGround.push({
      x,
      z,
      y: 0.6,
      vx: Math.cos(a) * s,
      vz: Math.sin(a) * s,
      vy: 5 + Math.random() * 2,
      v: per,
      spin: Math.random() * 6,
      rest: false,
      age: 0,
      gone: false,
      claimed: null,
    });
  }
}
function updateCoins(dt: number): void {
  const k = G.king;
  for (let i = G.coinsOnGround.length - 1; i >= 0; i--) {
    const c = G.coinsOnGround[i];
    c.age += dt;
    c.spin += dt * 4;
    if (!c.rest) {
      c.vy -= 22 * dt;
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      c.y += c.vy * dt;
      if (c.y <= 0.22) {
        c.y = 0.22;
        c.vy *= -0.35;
        c.vx *= 0.6;
        c.vz *= 0.6;
        if (Math.abs(c.vy) < 1.2) c.rest = true;
      }
    }
    const d2 = (c.x - k.x) ** 2 + (c.z - k.z) ** 2;
    const mag = 7.5 + (G.ringR || 2) * 0.3;
    if (c.age > 0.35 && d2 < mag * mag && !G.over) {
      G.flying.push({ x: c.x, y: c.y, z: c.z, t: 0, v: c.v, to: 'king' });
      c.gone = true;
      G.coinsOnGround.splice(i, 1);
    } else if (c.age > 90) {
      c.gone = true;
      G.coinsOnGround.splice(i, 1);
    }
  }
  for (let i = G.flying.length - 1; i >= 0; i--) {
    const f = G.flying[i];
    f.t += dt * 3.2;
    if (f.to === 'king') {
      const top = stackTop();
      f.x += (k.x - f.x) * Math.min(1, dt * 10);
      f.z += (k.z - f.z) * Math.min(1, dt * 10);
      f.y += (top - f.y) * Math.min(1, dt * 10) + Math.sin(f.t * Math.PI) * dt * 6;
      if (f.t >= 1) {
        G.coins += f.v;
        G.gainFlash = 0.5;
        G.flying.splice(i, 1);
      }
    } else {
      f.x += (f.tx - f.x) * Math.min(1, dt * 8);
      f.z += (f.tz - f.z) * Math.min(1, dt * 8);
      f.y += ((f.ty ?? 0.3) - f.y) * Math.min(1, dt * 8) + Math.sin(f.t * Math.PI) * dt * 5;
      if (f.t >= 1) G.flying.splice(i, 1);
    }
  }
}
const stackTop = () => 1.25 + Math.min(G.coins, 400) * 0.1;

// --------------------------------------------------------------- gold boy ----
// Gold boys run around outside the walls picking up coins and drop them on
// the plot next to their hut, where the king collects them.
const RX = HX + 2.2,
  RZ = HZ + 2.2;
function crossesBase(ax: number, az: number, bx: number, bz: number): boolean {
  const x0 = -RX + 0.5,
    x1 = RX - 0.5,
    z0 = -RZ + 0.5,
    z1 = RZ - 0.5,
    dx = bx - ax,
    dz = bz - az;
  let t0 = 0,
    t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dz, az - z0) && clip(dz, z1 - az) && t0 <= t1;
}
// walk around the walled base instead of through it
function steer(ax: number, az: number, bx: number, bz: number): Pt {
  if (!crossesBase(ax, az, bx, bz)) return [bx, bz];
  let best: Pt | null = null,
    bd = 1e9;
  for (const [cx, cz] of [
    [RX, RZ],
    [RX, -RZ],
    [-RX, RZ],
    [-RX, -RZ],
  ]) {
    if (Math.hypot(cx - ax, cz - az) < 0.8 || crossesBase(ax, az, cx, cz)) continue;
    const d = Math.hypot(cx - ax, cz - az) + Math.hypot(bx - cx, bz - cz) + (crossesBase(cx, cz, bx, bz) ? 40 : 0);
    if (d < bd) {
      bd = d;
      best = [cx, cz];
    }
  }
  return best || [bx, bz];
}
const inBase = (x: number, z: number) => Math.abs(x) < RX - 0.5 && Math.abs(z) < RZ - 0.5;
function findCoin(b: GoldBoy): Coin | null {
  let best: Coin | null = null,
    bd = 1e9;
  for (const c of G.coinsOnGround) {
    if (c.age < 0.35 || (c.claimed && c.claimed !== b) || inBase(c.x, c.z)) continue;
    const d = (c.x - b.x) ** 2 + (c.z - b.z) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}
function updateGold(dt: number): void {
  const gd = G.gold;
  if (!gd.built) return;
  const spec = GOLD_BOYS[gd.lv - 1],
    pl = gd.plot;
  for (const b of gd.boys) {
    b.bob += dt * 13;
    b.retarget -= dt;
    let tx = b.x,
      tz = b.z,
      speed = spec.speed;
    if (b.state === 'idle') {
      const a = G.t * 0.4 + gd.boys.indexOf(b) * 2;
      tx = GOLD_HUT[0] + 1.5 + Math.cos(a) * 1.2;
      tz = GOLD_HUT[1] + 3 + Math.sin(a) * 1.2;
      speed = 1.6;
      if (b.retarget <= 0) {
        b.retarget = 0.8;
        if (findCoin(b)) b.state = 'seek';
      }
    }
    if (b.state === 'seek') {
      if (!b.target || b.target.gone || b.retarget <= 0) {
        if (b.target && b.target.claimed === b) b.target.claimed = null;
        b.target = findCoin(b);
        b.retarget = 1.5;
        if (b.target) b.target.claimed = b;
      }
      if (b.target) {
        tx = b.target.x;
        tz = b.target.z;
      } else b.state = b.load > 0 ? 'return' : 'idle';
    }
    if (b.state === 'return') {
      tx = pl.x;
      tz = pl.z;
      if (Math.hypot(pl.x - b.x, pl.z - b.z) < 1.4) {
        pl.value += b.load;
        for (let i = 0; i < Math.min(6, Math.ceil(b.load / 5)); i++)
          G.flying.push({
            x: b.x,
            y: 1.2,
            z: b.z,
            t: -i * 0.06,
            v: 0,
            to: 'pt',
            tx: pl.x + (Math.random() - 0.5) * 1.6,
            tz: pl.z + (Math.random() - 0.5) * 1.6,
            ty: 0.4,
          });
        floatText(`+${Math.round(b.load)}`, pl.x, 1.8, pl.z, '#ffd84a');
        b.load = 0;
        b.state = 'seek';
        b.retarget = 0;
      }
    }
    const [sx, sz] = steer(b.x, b.z, tx, tz),
      dx = sx - b.x,
      dz = sz - b.z,
      d = Math.hypot(dx, dz);
    b.moving = d > 0.15;
    if (b.moving) {
      const st = Math.min(d, speed * dt);
      b.x += (dx / d) * st;
      b.z += (dz / d) * st;
      b.yaw += angleDiff(Math.atan2(dx, dz), b.yaw) * Math.min(1, dt * 10);
    }
    // scoop up every coin he runs over
    if (b.state === 'seek') {
      for (let i = G.coinsOnGround.length - 1; i >= 0; i--) {
        const c = G.coinsOnGround[i];
        if (c.age < 0.35 || (c.x - b.x) ** 2 + (c.z - b.z) ** 2 > 1.3) continue;
        b.load += c.v;
        c.gone = true;
        G.coinsOnGround.splice(i, 1);
        if (G.flying.length < 200)
          G.flying.push({ x: c.x, y: c.y, z: c.z, t: 0, v: 0, to: 'pt', tx: b.x, tz: b.z, ty: 1.0 });
      }
      if (b.load >= spec.cap) {
        b.state = 'return';
        if (b.target && b.target.claimed === b) b.target.claimed = null;
        b.target = null;
      }
    }
  }
  // the king empties the plot by standing on it
  const k = G.king;
  if (pl.value >= 1 && Math.abs(k.x - pl.x) < 2.4 && Math.abs(k.z - pl.z) < 2.4) {
    pl.acc += Math.max(30, pl.value * 2) * dt;
    const take = Math.min(Math.floor(pl.acc), Math.floor(pl.value));
    if (take > 0) {
      pl.acc -= take;
      pl.value -= take;
      G.flying.push({
        x: pl.x + (Math.random() - 0.5) * 1.5,
        y: 0.5,
        z: pl.z + (Math.random() - 0.5) * 1.5,
        t: 0,
        v: take,
        to: 'king',
      });
    }
  } else pl.acc = 0;
}

// --------------------------------------------------------------- shooting ----
function fire(sx: number, sy: number, sz: number, w: Weapon, target: Enemy): void {
  if (w.kind === 'melee') {
    damageEnemy(target, w.dmg);
    spark(target.x, 0.9 * target.scale, target.z);
    return;
  }
  G.projectiles.push({
    kind: w.kind,
    x: sx,
    y: sy,
    z: sz,
    target,
    tx: target.x,
    tz: target.z,
    ty: 0.8 * target.scale,
    speed: w.speed,
    dmg: w.dmg,
    pierce: w.pierce || 1,
    hit: null,
    life: 2,
    dir: null,
  });
}
function updateShooting(dt: number): void {
  const k = G.king,
    w = weapon(false),
    melee = w.kind === 'melee';
  // king
  k.cd -= dt;
  if (k.cd <= 0) {
    const e = nearestEnemy(k.x, k.z, melee ? w.range + 1.2 : w.range);
    if (e) {
      fire(k.x, 1.8, k.z, { ...w, dmg: w.dmg * 2 }, e);
      k.cd = w.cd;
      k.aim = Math.atan2(e.x - k.x, e.z - k.z);
    } else k.cd = 0.1;
  }
  // troop
  for (const f of G.followers) {
    f.cd -= dt;
    f.atkT = Math.max(0, f.atkT - dt);
    if (f.cd > 0) continue;
    const e = nearestEnemy(f.x, f.z, w.range);
    if (e) {
      fire(f.x, 0.9, f.z, f.rank > 1 ? { ...w, dmg: w.dmg * f.rank } : w, e);
      f.cd = w.cd * (0.9 + Math.random() * 0.2);
      f.aim = Math.atan2(e.x - f.x, e.z - f.z);
      f.atkT = 0.25;
    } else f.cd = 0.15;
  }
  // towers: higher levels have more archers, reach further and hit harder
  const tw = weapon(true);
  for (const t of G.towers) {
    if (!t.built) continue;
    const lv = TOWER_LV[t.level - 1],
      range = tw.range + 3 + (t.level - 1) * 0.8 + (t.outer ? 2 : 0),
      dmg = tw.dmg * (1 + 0.3 * (t.level - 1));
    while (t.cd.length < lv.archers) t.cd.push(Math.random());
    for (let i = 0; i < lv.archers; i++) {
      t.cd[i] -= dt;
      if (t.cd[i] > 0) continue;
      const e = nearestEnemy(t.x, t.z, range);
      if (e) {
        const o = TOWER_SLOTS[i];
        fire(t.x + o[0], lv.h + 0.85, t.z + o[1], { ...tw, dmg }, e);
        t.cd[i] = tw.cd * (0.9 + Math.random() * 0.2);
        t.aim = Math.atan2(e.x - t.x, e.z - t.z);
      } else t.cd[i] = 0.2;
    }
  }
  // cannons
  for (const c of G.cannons) {
    if (!c.built) continue;
    c.cd -= dt;
    const e = nearestEnemy(c.x, c.z, 18 + c.level);
    if (e) c.yaw += angleDiff(Math.atan2(e.x - c.x, e.z - c.z), c.yaw) * Math.min(1, dt * 6);
    if (c.cd <= 0 && e) {
      c.cd = 1.15;
      const dmg = 90 * Math.pow(1.6, c.level - 1),
        y = CANNON_TOP[c.level - 1] + 0.63;
      const shots = c.level === 4 ? [-0.3, 0.3] : [0];
      for (const ox of shots) {
        const sx = c.x + Math.sin(c.yaw) * 1.4 + Math.cos(c.yaw) * ox,
          sz = c.z + Math.cos(c.yaw) * 1.4 - Math.sin(c.yaw) * ox;
        G.projectiles.push({
          kind: 'ball',
          x: sx,
          y,
          z: sz,
          sx,
          sz,
          sy: y,
          tx: e.x + ox,
          tz: e.z,
          t: 0,
          dur: 0.9,
          dmg: (dmg / shots.length) * (shots.length > 1 ? 1.15 : 1),
          splash: 2.8 + 0.25 * (c.level - 1),
          target: null,
          life: 3,
        });
      }
      puff(c.x + Math.sin(c.yaw) * 1.8, y, c.z + Math.cos(c.yaw) * 1.8, '#ffffff', 4);
    }
  }
}
const TOWER_SLOTS: Pt[] = [
  [0, 0.45],
  [-0.45, -0.15],
  [0.45, -0.15],
  [-0.5, 0.55],
  [0.5, 0.55],
];
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const hitList: Enemy[] = [];
function updateProjectiles(dt: number): void {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    p.life -= dt;
    if (p.kind === 'ball') {
      p.t += dt / p.dur;
      const t = Math.min(1, p.t);
      p.x = p.sx + (p.tx - p.sx) * t;
      p.z = p.sz + (p.tz - p.sz) * t;
      p.y = p.sy * (1 - t) + 0.3 * t + Math.sin(t * Math.PI) * 5;
      if (p.t >= 1) {
        enemiesNear(p.tx, p.tz, p.splash, hitList);
        for (const e of hitList.slice()) damageEnemy(e, p.dmg);
        boom(p.tx, p.tz);
        G.projectiles.splice(i, 1);
      }
      continue;
    }
    if (p.kind === 'spear') {
      if (!p.dir) {
        const dx = p.tx - p.x,
          dz = p.tz - p.z,
          d = Math.hypot(dx, dz) || 1;
        p.dir = [dx / d, dz / d];
        p.hit = new Set();
      }
      const st = p.speed * dt;
      p.x += p.dir[0] * st;
      p.z += p.dir[1] * st;
      p.y += (0.8 - p.y) * Math.min(1, dt * 4);
      enemiesNear(p.x, p.z, 0.6, hitList);
      for (const e of hitList)
        if (!p.hit!.has(e) && p.hit!.size < p.pierce) {
          p.hit!.add(e);
          damageEnemy(e, p.dmg);
          spark(e.x, 0.9, e.z);
        }
      if (p.hit!.size >= p.pierce || p.life < 1.4) G.projectiles.splice(i, 1);
      continue;
    }
    const tgt = p.target;
    if (tgt && tgt.hp > 0) {
      p.tx = tgt.x;
      p.tz = tgt.z;
      p.ty = 0.8 * tgt.scale;
    }
    const dx = p.tx - p.x,
      dy = p.ty - p.y,
      dz = p.tz - p.z,
      d = Math.hypot(dx, dy, dz);
    const st = p.speed * dt;
    p.dir = [dx / (d || 1), dy / (d || 1), dz / (d || 1)];
    if (d <= st + 0.2) {
      if (tgt && tgt.hp > 0) {
        damageEnemy(tgt, p.dmg);
        spark(p.tx, p.ty, p.tz);
      }
      G.projectiles.splice(i, 1);
      continue;
    }
    p.x += p.dir[0] * st;
    p.y += p.dir[1] * st;
    p.z += p.dir[2] * st;
    if (p.life <= 0) G.projectiles.splice(i, 1);
  }
}

// ----------------------------------------------------------------- troops ----
function formation(i: number): Pt {
  const a = i * 2.39996 + 0.6,
    r = 0.8 * Math.sqrt(i + 1.3);
  return [Math.cos(a) * r, Math.sin(a) * r];
}
function updateTroop(dt: number): void {
  const k = G.king,
    w = weapon(false),
    melee = w.kind === 'melee';
  // the king
  let ix = G.input.x,
    iz = G.input.z;
  const len = Math.hypot(ix, iz);
  if (len > 1) {
    ix /= len;
    iz /= len;
  }
  const moving = len > 0.05;
  let nx = k.x + ix * KING_SPEED * dt,
    nz = k.z + iz * KING_SPEED * dt;
  // the king stays inside the border, off the canyon wall and off the mesas
  if (!G.free) {
    [nx, nz] = clampToClaims(G.claims, nx, nz, 1.2);
    nx = Math.max(cliffMinX(nz), nx);
    [nx, nz] = pushOutOfMesas(nx, nz, 0.8);
  }
  [nx, nz] = collideWalls(k.x, k.z, nx, nz);
  for (const [ox, oz, r] of G.obs!) {
    const dx = nx - ox,
      dz = nz - oz,
      d = Math.hypot(dx, dz);
    if (d < r) {
      nx = ox + (dx / (d || 1)) * r;
      nz = oz + (dz / (d || 1)) * r;
    }
  }
  k.x = nx;
  k.z = nz;
  if (moving) k.yaw += angleDiff(Math.atan2(ix, iz), k.yaw) * Math.min(1, dt * 12);
  k.bob += dt * (moving ? 14 : 3);
  // followers; bigger ranks stand further apart
  let spread = 1;
  for (const f of G.followers) spread = Math.max(spread, RANKS[rankTier(f.rank)].s);
  G.followers.forEach((f, i) => {
    f.bob += dt * 12;
    f.pop = Math.max(0, f.pop - dt * 2.5);
    const [fx, fz] = formation(i),
      ox = fx * spread,
      oz = fz * spread;
    let tx = k.x + ox,
      tz = k.z + oz;
    if (melee) {
      const e = nearestEnemy(f.x, f.z, 4);
      if (e && Math.hypot(e.x - k.x, e.z - k.z) < w.leash) {
        tx = e.x - Math.sin(Math.atan2(e.x - f.x, e.z - f.z)) * 0.9;
        tz = e.z - Math.cos(Math.atan2(e.x - f.x, e.z - f.z)) * 0.9;
      }
    }
    const dx = tx - f.x,
      dz = tz - f.z,
      d = Math.hypot(dx, dz);
    const sp = Math.min(d, (KING_SPEED + 2) * dt * (d > 3 ? 1.6 : 1));
    if (d > 0.05) {
      f.x += (dx / d) * sp;
      f.z += (dz / d) * sp;
    }
    const face = f.atkT > 0 && f.aim !== undefined ? f.aim : d > 0.2 ? Math.atan2(dx, dz) : k.yaw;
    f.yaw += angleDiff(face, f.yaw) * Math.min(1, dt * 10);
    f.moving = d > 0.2;
  });
  // recruits on their way to join someone
  for (let i = G.joiners.length - 1; i >= 0; i--) {
    const j = G.joiners[i],
      t = j.target;
    if (!G.followers.includes(t)) {
      G.joiners.splice(i, 1);
      continue;
    }
    const dx = t.x - j.x,
      dz = t.z - j.z,
      d = Math.hypot(dx, dz);
    j.bob += dt * 12;
    if (d < 0.5) {
      promote(t);
      G.joiners.splice(i, 1);
      continue;
    }
    const sp = Math.min(d, (KING_SPEED + 4) * dt);
    j.x += (dx / d) * sp;
    j.z += (dz / d) * sp;
    j.yaw = Math.atan2(dx, dz);
  }
  // ring scales with the troop
  const n = G.followers.length;
  G.ringR = (1.6 + 0.56 * Math.sqrt(n)) * spread;
}
function collideWalls(x0: number, z0: number, x1: number, z1: number): Pt {
  if (!G.wallsUp) return [x1, z1];
  const a = inside(x0, z0),
    b = inside(x1, z1);
  if (a === b) return [x1, z1];
  const s = a ? segAt(x1, z1, x0, z0) : segAt(x0, z0, x1, z1);
  if (!s || s.gate || !s.alive) return [x1, z1];
  // slide along the wall instead of passing through it
  if (s.side === 'E' || s.side === 'W') return [x0, z1];
  return [x1, z0];
}

// -------------------------------------------------------------------- pads ----
function updatePads(dt: number): void {
  const k = G.king;
  let onPad = null;
  for (const p of G.pads) {
    const vis = p.visible();
    if (vis !== p.visibleNow) {
      p.visibleNow = vis;
      p.mesh.visible = vis;
      if (vis) {
        p.cost = p.price();
        p.paid = 0;
        p.mesh.scale.setScalar(0.01);
        p.popT = 0;
      }
    }
    if (!vis) continue;
    if (p.posFn) {
      const [x, z] = p.posFn();
      if (x !== p.x || z !== p.z) {
        p.x = x;
        p.z = z;
        p.mesh.position.set(x, 0.06, z);
        p.popT = 0;
        p.mesh.scale.setScalar(0.01);
      }
    }
    if (p.popT !== undefined && p.popT < 1) {
      p.popT = Math.min(1, p.popT + dt * 4);
      const s = 1 + Math.sin(p.popT * Math.PI) * 0.25;
      p.mesh.scale.setScalar(Math.max(0.01, p.popT * s));
    }
    if (Math.abs(k.x - p.x) < 2.0 && Math.abs(k.z - p.z) < 2.0) onPad = p;
  }
  G.padIn = onPad;
  if (onPad && G.coins >= 1) {
    const p = onPad,
      need = p.cost - p.paid;
    const rate = Math.max(10, p.cost * 0.7);
    G.spendAcc += rate * dt;
    const give = Math.min(Math.floor(G.spendAcc), Math.floor(G.coins), Math.ceil(need));
    if (give > 0) {
      G.spendAcc -= give;
      G.coins -= give;
      p.paid += give;
      G.spentFlash = 0.3;
      for (let i = 0; i < Math.min(give, 3); i++)
        G.flying.push({
          x: k.x,
          y: stackTop(),
          z: k.z,
          t: 0,
          v: 0,
          to: 'pad',
          tx: p.x + (Math.random() - 0.5),
          tz: p.z + (Math.random() - 0.5),
        });
      if (p.paid >= p.cost) {
        const px = p.x,
          pz = p.z;
        p.buy();
        p.paid = 0;
        burst(px, 0.5, pz, 10, '#7dff6a');
        shockwave(px, pz, 3.2, '#7dff6a');
        // re-evaluate the next price for repeatable pads
        if (p.visible()) {
          p.cost = p.price();
          p.popT = 0;
        }
      }
    }
  } else G.spendAcc = 0;
  redrawPads();
}
// draw the pads whose price, payment or level has changed
function redrawPads(): void {
  for (const p of G.pads) {
    if (!p.visibleNow) continue;
    p.cost = p.price();
    const key = Math.ceil(p.cost - p.paid) + ':' + Math.floor((p.paid / p.cost) * 40) + ':' + (p.lv ? p.lv() : '');
    if (key !== p.key) {
      p.key = key;
      drawPad(p);
    }
  }
}
// guide: blue chevrons from the king toward the cheapest pad you can afford
function guideTarget() {
  let best = null;
  for (const p of G.pads) {
    if (!p.visibleNow) continue;
    const need = p.cost - p.paid;
    if (need <= G.coins && (!best || need < best.need)) best = { p, need };
  }
  return best ? best.p : null;
}

// -------------------------------------------------------------------- fx ----
function spark(x: number, y: number, z: number): void {
  if (world.fx.length > 140) return;
  const s = new THREE.Sprite(world.sparkMat);
  s.position.set(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4);
  s.scale.setScalar(0.1);
  scene.add(s);
  world.fx.push({ o: s, t: 0, dur: 0.22, kind: 'spark', s0: 0.9 + Math.random() * 0.6 });
}
function puff(x: number, y: number, z: number, hex: Hex, n: number): void {
  for (let i = 0; i < n; i++) {
    if (world.fx.length > 180) return;
    const m = new THREE.SpriteMaterial({ map: world.puffTex, color: hex, transparent: true, depthWrite: false });
    const s = new THREE.Sprite(m);
    s.position.set(x, y, z);
    scene.add(s);
    const a = Math.random() * Math.PI * 2,
      v = 1 + Math.random() * 2;
    world.fx.push({
      o: s,
      t: 0,
      dur: 0.5 + Math.random() * 0.3,
      kind: 'puff',
      vx: Math.cos(a) * v,
      vy: 1 + Math.random() * 2,
      vz: Math.sin(a) * v,
      s0: 0.5 + Math.random() * 0.5,
    });
  }
}
// a ring of dust rolling outward from a building's foot
function dust(x: number, z: number, r: number, n: number): void {
  for (let i = 0; i < n; i++) {
    if (world.fx.length > 230) return;
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
    const m = new THREE.SpriteMaterial({ map: world.puffTex, color: '#e6cba2', transparent: true, depthWrite: false });
    const s = new THREE.Sprite(m);
    s.position.set(x + Math.cos(a) * r, 0.5, z + Math.sin(a) * r);
    scene.add(s);
    world.fx.push({
      o: s,
      t: 0,
      dur: 0.7 + Math.random() * 0.3,
      kind: 'puff',
      vx: Math.cos(a) * 3,
      vy: 0.8,
      vz: Math.sin(a) * 3,
      s0: 1.1 + Math.random() * 0.6,
    });
  }
}
function burst(x: number, y: number, z: number, n: number, hex: Hex): void {
  for (let i = 0; i < n; i++) {
    if (world.fx.length > 230) return;
    const m = new THREE.SpriteMaterial({
      map: world.sparkMat.map,
      color: hex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const s = new THREE.Sprite(m);
    s.position.set(x, y, z);
    scene.add(s);
    const a = Math.random() * Math.PI * 2,
      v = 2 + Math.random() * 3;
    world.fx.push({
      o: s,
      t: 0,
      dur: 0.7,
      kind: 'puff',
      vx: Math.cos(a) * v,
      vy: 2 + Math.random() * 3,
      vz: Math.sin(a) * v,
      s0: 0.6,
    });
  }
}
function shockwave(x: number, z: number, r: number, hex: Hex): void {
  const m = new THREE.Mesh(
    world.ringGeo,
    new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.12, z);
  m.renderOrder = 4;
  m.scale.setScalar(0.1);
  scene.add(m);
  world.fx.push({ o: m, t: 0, dur: 0.6, kind: 'ring', s0: r });
}
function pillar(x: number, z: number, h: number): void {
  const m = new THREE.Mesh(
    world.pillarGeo,
    new THREE.MeshBasicMaterial({
      map: world.pillarTex,
      color: '#ffe48a',
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  m.position.set(x, 0, z);
  m.scale.set(1.8, h, 1.8);
  scene.add(m);
  world.fx.push({ o: m, t: 0, dur: 0.9, kind: 'pillar', s0: 1.8, h });
}
// what a purchase looks like: dust, a ring on the ground, a column of light, sparkles and a little shake
function celebrate(x: number, z: number, h: number, big: boolean): void {
  shockwave(x, z, big ? 7 : 5, '#ffffff');
  pillar(x, z, h + 4);
  burst(x, h, z, big ? 20 : 12, '#ffd84a');
  dust(x, z, 1.8, big ? 12 : 8);
  G.shake = Math.max(G.shake, big ? 0.32 : 0.2);
}
function boom(x: number, z: number): void {
  const m = new THREE.SpriteMaterial({
    map: world.puffTex,
    color: '#ffb02e',
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const s = new THREE.Sprite(m);
  s.position.set(x, 0.8, z);
  scene.add(s);
  world.fx.push({ o: s, t: 0, dur: 0.35, kind: 'boom', s0: 5 });
  puff(x, 0.6, z, '#8a7f74', 6);
}
function floatText(txt: string, x: number, y: number, z: number, color: string, big = false): void {
  if (G.texts.length > 40) return;
  const key = txt + color + big;
  let tex = world.textCache.get(key);
  if (!tex) {
    const w = big ? 640 : 256;
    tex = canvasTex(w, 128, (g) => {
      g.font = (big ? 72 : 84) + 'px "Lilita One", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = 16;
      g.strokeStyle = '#2a1d18';
      g.strokeText(txt, w / 2, 66);
      g.fillStyle = color;
      g.fillText(txt, w / 2, 66);
    });
    if (world.textCache.size > 200) world.textCache.clear();
    world.textCache.set(key, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.position.set(x, y, z);
  s.scale.set(big ? 6.4 : 2.2, big ? 1.28 : 1.1, 1);
  s.renderOrder = 20;
  scene.add(s);
  G.texts.push({ o: s, t: 0, dur: big ? 1.8 : 0.9, rise: big ? 0.9 : 1.6, big });
}
const bigText = (txt: string, x: number, y: number, z: number) => floatText(txt, x, y, z, '#ffffff', true);
function updateFx(dt: number): void {
  for (let i = world.fx.length - 1; i >= 0; i--) {
    const f = world.fx[i];
    f.t += dt;
    const k = f.t / f.dur;
    if (k >= 1) {
      scene.remove(f.o);
      if (f.o.material !== world.sparkMat) f.o.material.dispose();
      world.fx.splice(i, 1);
      continue;
    }
    if (f.kind === 'spark') f.o.scale.setScalar(f.s0 * Math.sin(k * Math.PI));
    else if (f.kind === 'boom') {
      f.o.scale.setScalar(f.s0 * (0.4 + k));
      f.o.material.opacity = 1 - k;
    } else if (f.kind === 'ring') {
      f.o.scale.setScalar(f.s0 * (0.12 + 0.88 * easeOut(k)));
      f.o.material.opacity = 0.9 * (1 - k);
    } else if (f.kind === 'pillar') {
      const w = f.s0 * (1 - 0.75 * k);
      f.o.scale.set(w, f.h * (0.5 + 0.7 * easeOut(Math.min(1, k * 2))), w);
      f.o.material.opacity = 0.7 * (1 - k);
    } else if (f.kind === 'smoke') {
      f.o.position.y += dt * 1.6;
      f.o.position.x += dt * 0.5;
      f.o.scale.setScalar(f.s0 * (0.6 + k * 1.6));
      f.o.material.opacity = 0.55 * Math.sin(k * Math.PI);
    } else {
      f.o.position.x += f.vx * dt;
      f.o.position.y += f.vy * dt;
      f.o.position.z += f.vz * dt;
      f.vy -= 4 * dt;
      f.o.scale.setScalar(f.s0 * (0.6 + k));
      f.o.material.opacity = 1 - k;
    }
  }
  for (let i = G.texts.length - 1; i >= 0; i--) {
    const t = G.texts[i];
    t.t += dt;
    t.o.position.y += dt * t.rise;
    if (t.big) {
      const k = Math.min(1, t.t / 0.25);
      t.o.scale.set(6.4 * easeOutBack(k), 1.28 * easeOutBack(k), 1);
    }
    t.o.material.opacity = Math.min(1, 2.5 * (1 - t.t / t.dur));
    if (t.t > t.dur) {
      scene.remove(t.o);
      t.o.material.dispose();
      G.texts.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------------ render ----
function setI(mesh: IMesh, i: number, x: number, y: number, z: number, yaw: number, s: number, roll = 0): void {
  tmpM.compose(tmpV.set(x, y, z), tmpQ.setFromEuler(tmpE.set(0, yaw, roll, 'YXZ')), tmpS.set(s, s, s));
  mesh.setMatrixAt(i, tmpM);
}
// coins heaped on the gold plot: a low cone that grows with the amount
const PILE: [x: number, z: number, r: number, j: number][] = Array.from({ length: 80 }, (_, i) => {
  const a = i * 2.39996,
    r = 0.2 * Math.sqrt(i + 0.5);
  return [Math.cos(a) * r, Math.sin(a) * r, r, (i * 0.37) % 1];
});
const ecount: Record<string, number> = {};
function syncScene(dt: number): void {
  const W = world,
    k = G.king;
  animBuildings(dt);
  if (G.wallsAnim) rebuildWalls(dt);
  updateTerrain(k.x, k.z);
  updateVents(dt);
  updateCamps(dt);
  updateBorder(dt);
  // king
  W.king.position.set(k.x, Math.abs(Math.sin(k.bob)) * 0.08, k.z);
  W.king.rotation.y = k.yaw;
  W.ring.position.set(k.x, 0.07, k.z);
  W.ring.scale.setScalar(G.ringR || 2);
  // followers + tower archers + weapons
  let n = 0,
    wn = 0,
    sh = 0;
  const wt = G.tier,
    wMesh = W.weapons[Math.min(wt, 6)],
    rn = [0, 0, 0];
  for (const m of W.weapons) m.count = 0;
  const putTroop = (
    x: number,
    y: number,
    z: number,
    yaw: number,
    bob: number,
    moving: boolean | undefined,
    rank = 1,
    pop = 0,
  ) => {
    const tier = rankTier(rank),
      s = RANKS[tier].s * (1 + 0.3 * Math.sin((1 - pop) * Math.PI) * (pop > 0 ? 1 : 0));
    const by = moving ? Math.abs(Math.sin(bob)) * 0.12 : 0,
      roll = moving ? Math.sin(bob) * 0.08 : 0;
    if (tier === 0) setI(W.follower, n++, x, y + by, z, yaw, s, roll);
    else setI(W.followerR[tier - 1], rn[tier - 1]++, x, y + by, z, yaw, s, roll);
    setI(wMesh, wn++, x, y + by, z, yaw, s, roll);
    setI(W.shadow, sh++, x, 0.05, z, 0, 1.1 * s);
  };
  for (const f of G.followers) putTroop(f.x, 0, f.z, f.yaw, f.bob, f.moving, f.rank, f.pop);
  for (const j of G.joiners) putTroop(j.x, 0, j.z, j.yaw, j.bob, true);
  W.followerR.forEach((m, i) => {
    m.count = rn[i];
    m.visible = rn[i] > 0;
    m.instanceMatrix.needsUpdate = true;
  });
  // archers stand on their tower once it has finished going up
  const tw = weapon(true),
    towerMesh = W.weapons[tw.tier],
    archers: [number, number, number, number][] = [];
  for (const t of G.towers) {
    if (!t.built || t.b!.t < 1) continue;
    const lv = TOWER_LV[t.b!.lv - 1];
    for (let i = 0; i < lv.archers; i++) {
      const o = TOWER_SLOTS[i];
      archers.push([t.x + o[0], lv.h, t.z + o[1], t.aim ?? Math.PI * 0.75]);
    }
  }
  for (const [x, y, z, yaw] of archers) {
    if (n >= 180 || wn >= 160) break;
    setI(W.follower, n++, x, y, z, yaw, 1);
    if (towerMesh === wMesh) setI(wMesh, wn++, x, y, z, yaw, 1);
  }
  W.follower.count = n;
  wMesh.count = wn;
  W.follower.instanceMatrix.needsUpdate = true;
  wMesh.instanceMatrix.needsUpdate = true;
  // tower archers keep spears while the troop uses swords: draw those separately
  if (towerMesh !== wMesh) {
    let m = 0;
    for (const [x, y, z, yaw] of archers) setI(towerMesh, m++, x, y, z, yaw, 1);
    towerMesh.count = m;
    towerMesh.instanceMatrix.needsUpdate = true;
  }
  // gold boys and their sacks
  let bn = 0;
  for (const b of G.gold.boys) {
    const by = b.moving ? Math.abs(Math.sin(b.bob)) * 0.14 : 0,
      roll = b.moving ? Math.sin(b.bob) * 0.08 : 0;
    setI(W.boy, bn, b.x, by, b.z, b.yaw, 1.05, roll);
    const fill = Math.min(1, b.load / GOLD_BOYS[G.gold.lv - 1].cap),
      ss = 0.55 + fill * 0.75;
    tmpM.compose(
      tmpV.set(
        b.x - Math.sin(b.yaw) * (0.36 + ss * 0.12),
        0.85 + by + ss * 0.12,
        b.z - Math.cos(b.yaw) * (0.36 + ss * 0.12),
      ),
      tmpQ.setFromEuler(tmpE.set(0, b.yaw, roll, 'YXZ')),
      tmpS.set(ss, ss, ss),
    );
    W.sack.setMatrixAt(bn, tmpM);
    setI(W.shadow, sh++, b.x, 0.05, b.z, 0, 1.1);
    bn++;
  }
  W.boy.count = W.sack.count = bn;
  W.boy.instanceMatrix.needsUpdate = W.sack.instanceMatrix.needsUpdate = true;
  // ghost recruits on the barracks pad
  const rp = G.pads.find((p) => p.id === 'recruit')!;
  let gn = 0;
  if (rp.visibleNow) {
    const cnt = recruitStep()[1];
    for (let i = 0; i < Math.min(cnt, 6); i++) {
      const o = [
        [0, 0],
        [-0.7, 0.5],
        [0.7, 0.5],
        [-0.7, -0.5],
        [0.7, -0.5],
        [0, 0.9],
      ][i];
      setI(W.ghost, gn++, rp.x + o[0], 0.05, rp.z + o[1], Math.PI * 0.75, 1);
    }
  }
  W.ghost.count = gn;
  W.ghost.instanceMatrix.needsUpdate = true;
  // enemies
  for (const key of W.ekeys) ecount[key] = 0;
  let bars = 0;
  const barQ = camera.quaternion;
  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    const m = W.emesh[e.mkey],
      i = ecount[e.mkey];
    if (i >= m.userData.cap) continue;
    ecount[e.mkey] = i + 1;
    const lx = Math.sin(e.yaw) * e.lunge * 0.35 * e.scale,
      lz = Math.cos(e.yaw) * e.lunge * 0.35 * e.scale;
    const by = Math.abs(Math.sin(e.bob)) * 0.1 * e.scale,
      roll = Math.sin(e.bob) * (e.kind === 'knight' ? 0.07 : 0.05);
    setI(m, i, e.x + lx, by, e.z + lz, e.yaw, e.scale, roll);
    const u = UNIT[e.kind];
    if (sh < 1200) setI(W.shadow, sh++, e.x, 0.05, e.z, 0, u.shadow);
    if (e.hp < e.max && bars < 690) bar(bars++, e.x, u.bar, e.z, u.barW, e.hp / e.max, '#e8242c', barQ);
  }
  for (const key of W.ekeys) {
    const m = W.emesh[key];
    m.count = ecount[key];
    m.visible = m.count > 0;
    m.instanceMatrix.needsUpdate = true;
  }
  // wall health
  for (const s of G.segs)
    if (s.alive && s.hitT > 0 && bars < 698) bar(bars++, s.cx, 3.2, s.cz, 1.6, s.hp / s.max, '#2fd04a', barQ);
  const cs = G.castle;
  if (cs.hp < cs.max && bars < 699) bar(bars++, cs.x, 7.6, cs.z, 3.6, cs.hp / cs.max, '#2fd04a', barQ);
  W.barBg.count = bars;
  W.barFill.count = bars;
  W.barBg.instanceMatrix.needsUpdate = true;
  W.barFill.instanceMatrix.needsUpdate = true;
  W.barFill.instanceColor!.needsUpdate = true;
  setI(W.shadow, sh++, k.x, 0.05, k.z, k.yaw, 1.9);
  W.shadow.count = sh;
  W.shadow.instanceMatrix.needsUpdate = true;
  // coins: ground, flying, the gold plot and the king's stack
  let c = 0;
  const coinAt = (x: number, y: number, z: number, rx: number, ry: number) => {
    tmpM.compose(tmpV.set(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, 0)), tmpS.set(1, 1, 1));
    W.coin.setMatrixAt(c++, tmpM);
  };
  for (const g of G.coinsOnGround) if (c < 1700) coinAt(g.x, g.y, g.z, g.rest ? 0 : g.spin, g.spin);
  for (const f of G.flying) if (c < 1780) coinAt(f.x, f.y, f.z, 0.3, f.t * 6);
  const pl = G.gold.plot;
  if (G.gold.built && pl.value >= 1) {
    const pn = Math.min(PILE.length, Math.ceil(pl.value / 4)),
      H = 0.1 + (0.9 * pn) / PILE.length;
    for (let i = 0; i < pn; i++) {
      const [ox, oz, r, j] = PILE[i];
      coinAt(pl.x + ox, 0.2 + Math.max(0, H * (1 - r / 1.9)) + j * 0.05, pl.z + oz, (j - 0.5) * 0.5, j * 6);
    }
  }
  const stackN = Math.min(Math.floor(G.coins), 400),
    bx = k.x - Math.sin(k.yaw) * 0.55,
    bz = k.z - Math.cos(k.yaw) * 0.55;
  for (let i = 0; i < stackN && c < 1890; i++) {
    const sway = Math.sin(k.bob * 0.5 + i * 0.02) * i * 0.0006;
    coinAt(bx + Math.sin(k.yaw) * sway, 1.3 + i * 0.1 + W.king.position.y, bz + Math.cos(k.yaw) * sway, 0, i * 0.3);
  }
  W.coin.count = c;
  W.coin.instanceMatrix.needsUpdate = true;
  // projectiles
  const cnt: Record<ProjKind, number> = { arrow: 0, arrow2: 0, bolt: 0, spear: 0, bullet: 0, ball: 0 };
  for (const p of G.projectiles) {
    const m = W.proj[p.kind];
    if (!m || cnt[p.kind] >= (m.userData.cap as number)) continue;
    let yaw = 0,
      pitch = 0;
    if (p.dir) {
      yaw = Math.atan2(p.dir[0], p.dir.length === 3 ? p.dir[2] : p.dir[1]);
      pitch = p.dir.length === 3 ? -Math.asin(Math.max(-1, Math.min(1, p.dir[1]))) : 0;
    }
    tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ.setFromEuler(tmpE.set(pitch, yaw, 0, 'YXZ')), tmpS.set(1, 1, 1));
    m.setMatrixAt(cnt[p.kind]++, tmpM);
  }
  for (const key of Object.keys(cnt) as ProjKind[]) {
    W.proj[key].count = cnt[key];
    W.proj[key].instanceMatrix.needsUpdate = true;
  }
  // cannons aim, the castle falls, gates open for the king
  for (const cn of G.cannons) if (cn.turret) cn.turret.rotation.y = cn.yaw;
  if (G.over) {
    cs.fall = Math.min(1, cs.fall + dt * 0.8);
    W.castle.scale.set(1 + cs.fall * 0.08, Math.max(0.05, 1 - cs.fall * 0.85), 1 + cs.fall * 0.08);
    W.castle.rotation.z = Math.sin(cs.fall * 9) * 0.03 * (1 - cs.fall);
  }
  for (const gt of W.gates) {
    const want = gt.group.visible && Math.hypot(k.x - gt.x, k.z - gt.z) < 3.8 ? 1 : 0;
    gt.open += (want - gt.open) * Math.min(1, dt * 6);
    gt.a.rotation.y = -gt.open * 1.4 * gt.sgn;
    gt.b.rotation.y = gt.open * 1.4 * gt.sgn;
  }
  // chevrons toward the next pad you can afford
  const gtg = guideTarget();
  let cv = 0;
  if (gtg && gtg !== G.padIn) {
    const dx = gtg.x - k.x,
      dz = gtg.z - k.z,
      d = Math.hypot(dx, dz),
      yaw = Math.atan2(dx, dz);
    const start = (G.ringR || 2) * 0.6,
      end = d - 1.7,
      step = 0.75,
      off = (G.t * 1.6) % step;
    for (let s = start + off; s < end && cv < 30; s += step) {
      tmpM.compose(
        tmpV.set(k.x + (dx / d) * s, 0.09, k.z + (dz / d) * s),
        tmpQ.setFromEuler(tmpE.set(0, yaw + Math.PI, 0)),
        tmpS.set(0.8, 1, 0.8),
      );
      W.chev.setMatrixAt(cv, tmpM);
      const fade = Math.min(1, (s - start) / 1.2) * Math.min(1, (end - s) / 1.2);
      W.chev.setColorAt(
        cv,
        tmpC
          .set('#1f9dff')
          .lerp(new THREE.Color('#5fe3ff'), fade)
          .multiplyScalar(0.55 + 0.45 * fade),
      );
      cv++;
    }
  }
  W.chev.count = cv;
  W.chev.instanceMatrix.needsUpdate = true;
  if (W.chev.instanceColor) W.chev.instanceColor.needsUpdate = true;
  W.lavaTex.offset.set(G.t * 0.05, G.t * 0.03);
  // camera and light follow the king; purchases give it a small shake
  const tx = k.x,
    tz = k.z;
  camera.position.set(tx + CAM_DIR.x * G.camDist, CAM_DIR.y * G.camDist, tz + CAM_DIR.z * G.camDist);
  camera.lookAt(tx, 0, tz);
  if (G.shake > 0) {
    const s = G.shake * G.shake * 1.6;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
    G.shake = Math.max(0, G.shake - dt * 1.1);
  }
  sun.position.set(tx - 14, 34, tz + 10);
  sun.target.position.set(tx, 0, tz);
}
// ash vents near the king smoke
function updateVents(dt: number): void {
  const TR = world.terrain,
    k = G.king;
  if ((TR.ventT -= dt) > 0 || world.fx.length >= 200) return;
  TR.ventT = 0.35;
  const near = [];
  for (const ch of TR.chunks.values())
    for (const v of ch.vents) if (Math.hypot(v[0] - k.x, v[1] - k.z) < 40) near.push(v);
  if (!near.length) return;
  const [x, z] = near[(Math.random() * near.length) | 0];
  smoke(x, 1.0, z, '#6a6262', 1.1);
}
function smoke(x: number, y: number, z: number, hex: Hex, s0: number): void {
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: world.puffTex, color: hex, transparent: true, depthWrite: false }),
  );
  sp.position.set(x, y, z);
  scene.add(sp);
  world.fx.push({ o: sp, t: 0, dur: 2.2, kind: 'smoke', s0 });
}
function bar(i: number, x: number, y: number, z: number, w: number, frac: number, hex: Hex, q: THREE.Quaternion): void {
  const W = world;
  tmpM.compose(tmpV.set(x, y, z), q, tmpS.set(w + 0.1, 0.2, 1));
  W.barBg.setMatrixAt(i, tmpM);
  const fw = Math.max(0.001, w * Math.max(0, frac));
  // shift the fill left inside the billboard plane
  const right = tmpV.set(1, 0, 0).applyQuaternion(q);
  tmpM.compose(
    new THREE.Vector3(x - (right.x * (w - fw)) / 2, y + 0.005, z - (right.z * (w - fw)) / 2),
    q,
    tmpS.set(fw, 0.12, 1),
  );
  W.barFill.setMatrixAt(i, tmpM);
  W.barFill.setColorAt(i, tmpC.set(hex));
}

// --------------------------------------------------------------------- HUD ----
function updateHud(force?: boolean): void {
  const c = Math.floor(G.coins);
  if (force || c !== ui.lastCoins) {
    ui.coins.textContent = String(c);
    ui.lastCoins = c;
  }
  ui.coins.classList.toggle('spend', G.spentFlash > 0);
  ui.coins.classList.toggle('gain', G.spentFlash <= 0 && G.gainFlash > 0);
}
// messages at the top of the screen, one after the other
function toast(msg: string): void {
  if (G.toastT > 0) {
    if (!G.toastQ.includes(msg)) G.toastQ.push(msg);
    return;
  }
  G.toastT = 2.6;
  const t = ui.toast;
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
}
function updateToasts(dt: number): void {
  if ((G.toastT -= dt) <= 0 && G.toastQ.length) toast(G.toastQ.shift()!);
}
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function gameOver(): void {
  if (G.over) return;
  G.over = true;
  const cs = G.castle;
  for (let i = 0; i < 4; i++)
    puff(cs.x + (Math.random() - 0.5) * 3, 2 + i, cs.z + (Math.random() - 0.5) * 3, '#d8d0c4', 8);
  // the clock goes on behind the panel: the time held is the time it fell
  const g = G,
    t = G.t;
  fork(
    Effect.gen(function* () {
      yield* forget(WORLD_KEY);
      const best = yield* load(BEST_TIME, BestTime, () => 0);
      if (t > best) yield* save(BEST_TIME, BestTime, Math.floor(t));
      ui.overText.textContent = overText(g, t, best);
      // the castle falls first, then the panel comes up (unless a new game has started by then)
      yield* Effect.sleep('1.4 seconds');
      if (G.over) ui.over.hidden = false;
    }),
  );
}
// The longest the castle has held, in whole seconds, saved as plain text such as 123. Anything else there (junk)
// counts as no best time.
const BEST_TIME = 'castle.bestTime';
const BestTime = Schema.Finite;
function overText(g: Game, t: number, best: number): string {
  const held =
    t > best
      ? `You held out for ${clock(t)}, your longest yet.`
      : `You held out for ${clock(t)}. Your longest is ${clock(best)}.`;
  return g.outposts
    ? `${held} Your border reached ${Math.round(g.reach)} paces out, with ${g.outposts} outpost${g.outposts > 1 ? 's' : ''}.`
    : held;
}

// ------------------------------------------------------------------ saving ----
// The game being played is saved in localStorage (castle.world.v1) every few seconds while it runs, when the player
// leaves it, and when the page is hidden or goes away, so that a reload, or a tab closed and opened again, finds it
// as it was: paused under the pause panel, as when the player comes back from the menu. When the castle falls the
// save goes with it, and Restart saves the new game over it.
//
// What is saved is what the game needs to carry on: the clock, the coins, the king, the troop, every building at its
// level, the walls, the land claimed, the fronts with their camps and roads, the ruins, the outposts and their field
// cannons, the enemies on the field and the ones about to set off, and the coins on the ground. What only shows
// starts again empty (arrows and cannon balls in the air, dust, floating numbers). Coins flying to the king are his,
// and coins paid into a spot for an outpost not built yet go back to him: the spots are worked out again from the
// border, in the same places, as new ones. A save the game can't carry on from (one edited by hand, or broken) is no
// game at all, and a new one starts.
const WORLD_KEY = 'castle.world.v1';
const Num = Schema.Finite,
  Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  UpTo = (max: number) => Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: max })),
  SavedPt = Schema.mutable(Schema.Tuple([Num, Num])),
  SavedRoad = Schema.mutable(Schema.Array(SavedPt)).check(Schema.isMinLength(2));
const FRONT_IDS = FRONTS.map((d) => d.id),
  UNIT_KINDS = Object.keys(UNIT) as UnitKind[],
  SEG_COUNT = makeSegments().length;
const SavedFront = Schema.Struct({
  id: Schema.Literals(FRONT_IDS),
  road: SavedRoad,
  segs: Schema.mutable(Schema.Array(SavedRoad)),
  open: Schema.Boolean,
  openAt: Schema.NullOr(Num), // null until a building opens it
  shared: Schema.Boolean,
  timer: Num,
  restAt: Num,
  camp: SavedPt,
});
const SavedEnemy = Schema.Struct({
  kind: Schema.Literals(UNIT_KINDS),
  look: Schema.Literals(['', 'S', 'R']), // a knight with a shield, a giant in its biome's second colours
  theme: UpTo(BIOME_NAMES.length - 1),
  x: Num,
  z: Num,
  route: Count, // which of the routes it walks, and how far along
  wp: Count,
  hp: Num,
  max: Num,
  speed: Num,
  dmg: Num,
  atk: Num,
  yaw: Num,
  value: Num,
  side: Num,
  state: Schema.Literals(['path', 'wall', 'castle']),
  wall: Schema.NullOr(Count), // the stretch of wall it is breaking down
});
const SavedWorld = Schema.Struct({
  t: Num,
  coins: Num,
  kills: Count,
  maxEnemies: Count,
  king: SavedPt,
  yaw: Num,
  castle: Num, // the castle's hit points
  troop: Schema.Array(Schema.Tuple([Num, Num, Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))])), // x, z, rank
  recruits: Count,
  barracks: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: BARRACKS_STEPS.length })),
  forge: Schema.NullOr(UpTo(FORGE_COSTS.length)), // the weapon's tier, or null before there is a forge
  extraDmg: Count,
  towers: Schema.Array(UpTo(TOWER_LV.length)), // each wall tower's level, 0 for none
  walls: Schema.Array(Schema.Tuple([Num, Schema.Boolean])), // each stretch of wall: its hit points, and if it stands
  cannons: Schema.Array(Schema.Tuple([UpTo(CANNON_MAX), Num])), // each cannon by the base: level (0 for none), aim
  gold: Schema.Struct({
    lv: UpTo(GOLD_COSTS.length),
    plot: Num,
    boys: Schema.Array(Schema.Tuple([Num, Num, Num])), // x, z, coins carried
  }),
  claims: Schema.Array(Schema.Tuple([Num, Num, Num])).check(Schema.isMinLength(1)), // x, z, r
  fronts: Schema.Array(SavedFront),
  ruins: Schema.Array(SavedPt),
  outposts: Schema.Array(
    Schema.Struct({
      idx: Count,
      at: SavedPt,
      up: SavedPt,
      level: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: TOWER_LV.length })),
    }),
  ),
  fieldCannons: Schema.Array(
    Schema.Struct({ at: SavedPt, side: SavedPt, cost0: Num, level: UpTo(CANNON_MAX), yaw: Num }),
  ),
  siteSeq: Count,
  paid: Schema.Record(Schema.String, Num), // coins paid into a pad so far, by its id
  spawnT: Num,
  nextPath: Count,
  queue: Schema.Array(Schema.Tuple([Schema.Literals(FRONT_IDS), Schema.Literals(UNIT_KINDS), Num])), // front, kind, wait
  routes: Schema.Array(SavedRoad),
  enemies: Schema.Array(SavedEnemy),
  ground: Schema.Array(Schema.Tuple([Num, Num, Num, Num])), // coins on the ground: x, z, value, age
}).check(
  Schema.makeFilter(
    (w) =>
      w.t >= 0 &&
      w.coins >= 0 &&
      w.castle > 0 &&
      w.troop.length <= SQUAD_MAX &&
      w.towers.length === TOWER_SPOTS.length &&
      w.walls.length === SEG_COUNT &&
      w.cannons.length === CANNON_SPOTS.length &&
      w.gold.boys.length === (w.gold.lv ? GOLD_BOYS[w.gold.lv - 1].n : 0) &&
      w.claims.every(([, , r]) => r > 0) &&
      w.fronts.length === FRONTS.length &&
      w.fronts.every((f, i) => f.id === FRONT_IDS[i]) &&
      new Set(w.outposts.map((o) => o.idx)).size === w.outposts.length &&
      w.outposts.every((o) => o.idx < w.siteSeq) &&
      w.enemies.every(
        (e) =>
          e.route < w.routes.length &&
          e.wp < w.routes[e.route].length &&
          e.max > 0 &&
          (e.state !== 'wall' || (e.wall !== null && e.wall < SEG_COUNT)) &&
          (e.look === '' ||
            (e.look === 'S' && e.kind === 'knight') ||
            (e.look === 'R' && e.kind === 'giant' && !!PAL[e.theme].giants[1])),
      ),
  ),
);
type SavedWorld = typeof SavedWorld.Type;

// The game as it is now, to save
function snapshot(): SavedWorld {
  const k = G.king,
    gd = G.gold;
  // the roads the enemies walk, each once (most walk their front's road as it was when they set off)
  const routes: Pt[][] = [],
    routeOf = new Map<Pt[], number>();
  const route = (r: Pt[]) => {
    let i = routeOf.get(r);
    if (i === undefined) {
      routeOf.set(r, (i = routes.length));
      routes.push(r);
    }
    return i;
  };
  const outer = G.towers.filter((t) => t.outer),
    spots = outer.filter((t) => !t.built);
  const toKing = G.flying.reduce((n, f) => n + (f.to === 'king' ? f.v : 0), 0),
    paidIntoSpots = spots.reduce((n, t) => n + (t.pad ? t.pad.paid : 0), 0);
  const ranks = (f: Follower) => f.rank + G.joiners.filter((j) => j.target === f).length;
  return {
    t: G.t,
    coins: G.coins + toKing + paidIntoSpots,
    kills: G.kills,
    maxEnemies: G.stats.maxEnemies,
    king: [k.x, k.z],
    yaw: k.yaw,
    castle: G.castle.hp,
    troop: G.followers.map((f) => [f.x, f.z, ranks(f)]),
    recruits: G.recruitIdx,
    barracks: G.barracksLv,
    forge: G.forge ? G.tier : null,
    extraDmg: G.extraDmg,
    towers: G.towers.filter((t) => !t.outer).map((t) => t.level),
    walls: G.segs.map((s) => [s.hp, s.alive]),
    cannons: G.cannons.filter((c) => !c.field).map((c) => [c.level, c.yaw]),
    gold: { lv: gd.lv, plot: gd.plot.value, boys: gd.boys.map((b) => [b.x, b.z, b.load]) },
    claims: G.claims.map((c) => [c.x, c.z, c.r]),
    fronts: G.fronts.map((f) => ({
      id: f.id,
      road: f.road,
      segs: f.segs,
      open: f.open,
      openAt: Number.isFinite(f.openAt) ? f.openAt : null,
      shared: f.shared,
      timer: f.timer,
      restAt: f.restAt,
      camp: [f.camp.x, f.camp.z],
    })),
    ruins: G.ruins.map((c) => [c.x, c.z]),
    outposts: outer.filter((t) => t.built).map((t) => ({ idx: t.idx, at: [t.x, t.z], up: t.up, level: t.level })),
    fieldCannons: G.cannons
      .filter((c) => c.field)
      .map((c) => ({ at: [c.x, c.z], side: c.side, cost0: c.cost0, level: c.level, yaw: c.yaw })),
    siteSeq: G.siteSeq,
    paid: Object.fromEntries(G.pads.filter((p) => p.paid > 0 && !spots.includes(p.site!)).map((p) => [p.id, p.paid])),
    spawnT: G.spawnT,
    nextPath: G.nextPath,
    queue: G.spawnQueue.map((q) => [q.f.id, q.kind, q.t]),
    enemies: G.enemies
      .filter((e) => e.hp > 0)
      .map((e) => ({
        kind: e.kind,
        look: e.mkey.slice(e.kind.length, -String(e.theme).length) as SavedWorld['enemies'][number]['look'],
        theme: e.theme,
        x: e.x,
        z: e.z,
        route: route(e.route),
        wp: e.wp,
        hp: e.hp,
        max: e.max,
        speed: e.speed,
        dmg: e.dmg,
        atk: e.atk,
        yaw: e.yaw,
        value: e.value,
        side: e.side,
        state: e.state,
        wall: e.seg ? G.segs.indexOf(e.seg) : null,
      })),
    routes,
    ground: G.coinsOnGround.map((c) => [c.x, c.z, c.v, c.age]),
  };
}

// A new game set up as a saved one was. The buildings go up straight away, as they stood, without the show that
// building them makes.
function restoreGame(w: SavedWorld): void {
  newGame();
  const W = world;
  // the spots for outposts on the first border go: they are worked out again at the end
  for (const t of G.towers.filter((o) => o.outer)) dropSite(t);
  G.t = w.t;
  G.coins = w.coins;
  G.kills = w.kills;
  G.stats.maxEnemies = w.maxEnemies;
  [G.king.x, G.king.z] = w.king;
  G.king.yaw = w.yaw;
  G.followers = w.troop.map(([x, z, rank], slot) => ({
    x,
    z,
    yaw: 0,
    cd: Math.random(),
    slot,
    bob: Math.random() * 6,
    atkT: 0,
    rank,
    pop: 0,
  }));
  G.joiners = [];
  // the barracks, the forge and the weapon
  G.recruitIdx = w.recruits;
  G.barracksLv = w.barracks;
  const bk = G.barracks!;
  bk.lv = w.barracks;
  bk.body.geometry = geoFor(bk.fn, bk.lv);
  G.extraDmg = w.extraDmg;
  if (w.forge !== null) {
    G.tier = w.forge;
    G.forge = makeForge(w.forge);
  }
  setKingWeapon();
  // the wall towers and their walls
  for (const [i, lv] of w.towers.entries()) {
    if (!lv) continue;
    const t = G.towers[i];
    t.built = true;
    t.level = lv;
    t.b = makeBuilding(t.x, t.z, 0, towerGeo, lv, 0, TOWER_LV[lv - 1].h);
    for (const s of G.segs)
      if (s.owner === i) {
        s.tier = lv;
        s.max = WALL_TIERS[lv - 1].hp;
      }
  }
  for (const [i, s] of G.segs.entries()) {
    const [hp, alive] = w.walls[i];
    s.alive = alive && s.tier > 0 && hp > 0;
    s.hp = s.alive ? Math.min(hp, s.max) : 0;
  }
  G.wallsUp = w.towers.some((lv) => lv > 0);
  W.grass.visible = G.wallsUp;
  rebuildWalls();
  // the cannons and the gold hut
  for (const [i, [lv, yaw]] of w.cannons.entries()) {
    const c = G.cannons[i];
    c.yaw = yaw;
    if (!lv) continue;
    c.built = true;
    c.level = lv;
    makeCannon(c);
  }
  const gd = G.gold;
  if (w.gold.lv) {
    gd.built = true;
    gd.lv = w.gold.lv;
    makeGoldHut();
    for (const [x, z, load] of w.gold.boys) addGoldBoy(x, z, load);
  }
  gd.plot.value = w.gold.plot;
  // the fronts, their camps and roads, and the camps already cleared
  for (const [i, sf] of w.fronts.entries()) {
    const f = G.fronts[i];
    scene.remove(f.camp.group);
    unkeepClear(f.camp.x, f.camp.z);
    f.road = sf.road;
    f.segs = sf.segs;
    f.open = sf.open;
    f.openAt = sf.openAt ?? Infinity;
    f.shared = sf.shared;
    f.timer = sf.timer;
    f.restAt = sf.restAt;
    f.camp = makeCamp(sf.camp[0], sf.camp[1], f.open);
    f.camp.state = f.open ? 'up' : 'hidden';
    f.camp.t = 1;
    f.camp.group.scale.set(1, 1, 1);
    if (f.open) f.segs.forEach((seg, j) => addRoad(`front-${f.id}-${j}`, seg));
  }
  for (const [x, z] of w.ruins) {
    const c = makeCamp(x, z, true);
    c.state = 'ruin';
    c.t = 1;
    c.mesh.geometry = campGeo(c.theme, true);
    c.group.scale.set(1, 1, 1);
    G.ruins.push(c);
  }
  // the land claimed, the outposts on its border and their field cannons
  G.claims = w.claims.map(([x, z, r]) => ({ x, z, r, shown: r }));
  G.reach = Math.max(...G.claims.map((c) => Math.hypot(c.x - HOME.x, c.z - HOME.z) + c.r));
  W.borderU.count.value = 0;
  for (const o of w.outposts) {
    const [x, z] = o.at;
    const t: Tower = { x, z, up: o.up, outer: true, idx: o.idx, built: true, level: o.level, b: null, cd: [] };
    t.b = makeBuilding(x, z, 0, towerGeo, o.level, 5, TOWER_LV[o.level - 1].h);
    G.towers.push(t);
    outpostPad(t);
    keepClear(x, z, 4);
  }
  G.outposts = w.outposts.length;
  for (const fc of w.fieldCannons) {
    const [x, z] = fc.at;
    const cn: Cannon = {
      x,
      z,
      side: fc.side,
      cost0: fc.cost0,
      built: fc.level > 0,
      level: fc.level,
      b: null,
      turret: null,
      cd: 0,
      yaw: fc.yaw,
      field: true,
    };
    if (cn.built) makeCannon(cn);
    G.cannons.push(cn);
    G.pads.push(cannonPad(cn, () => true)); // its outpost is built
    keepClear(x, z, 4);
  }
  G.fieldCannons = w.fieldCannons.length;
  G.siteSeq = w.siteSeq;
  refreshPosts();
  G.castle.max = castleMaxHp();
  G.castle.hp = Math.min(w.castle, G.castle.max);
  // the enemies, and the ones about to set off
  const routes = w.routes.map((r) => r.map((p): Pt => [p[0], p[1]]));
  G.enemies = w.enemies.map((e): Enemy => {
    const u = UNIT[e.kind],
      seg = e.state === 'wall' && e.wall !== null && G.segs[e.wall].alive ? G.segs[e.wall] : null;
    return {
      kind: e.kind,
      theme: e.theme as Biome,
      x: e.x,
      z: e.z,
      route: routes[e.route],
      wp: e.wp,
      hp: Math.min(e.hp, e.max),
      max: e.max,
      speed: e.speed,
      dmg: e.dmg,
      r: u.r,
      atk: e.atk,
      yaw: e.yaw,
      bob: Math.random() * 6,
      state: seg ? 'wall' : e.state === 'castle' ? 'castle' : 'path',
      seg,
      lunge: 0,
      value: e.value,
      hitFlash: 0,
      side: e.side,
      scale: u.scale,
      mkey: e.kind + e.look + e.theme,
    };
  });
  G.spawnT = w.spawnT;
  G.nextPath = w.nextPath;
  G.spawnQueue = w.queue.map(([id, kind, t]) => ({ f: G.fronts.find((f) => f.id === id)!, kind, t }));
  G.coinsOnGround = w.ground.map(([x, z, v, age]) => ({
    x,
    z,
    y: 0.22,
    vx: 0,
    vz: 0,
    vy: 0,
    v,
    spin: Math.random() * 6,
    rest: true,
    age,
    gone: false,
    claimed: null,
  }));
  // everything standing as it was, the spots for outposts on the border, and the pads with what was paid into them
  for (const b of G.buildings) {
    b.t = 1;
    b.mode = 'build';
    b.body.scale.set(1, 1, 1);
    if (b.onSwap) b.onSwap(b.lv);
  }
  refreshObstacles();
  refreshFrontier();
  for (const p of G.pads) {
    if (p.posFn) [p.x, p.z] = p.posFn();
    p.mesh.position.set(p.x, 0.06, p.z);
    p.visibleNow = p.mesh.visible = p.visible();
    p.mesh.scale.setScalar(1);
    p.popT = 1;
    p.cost = p.price();
    p.paid = p.visibleNow ? Math.max(0, Math.min(w.paid[p.id] ?? 0, p.cost - 1)) : 0;
    p.key = '';
  }
  redrawPads();
  updateHud(true);
}

/** Saves the game being played (not one that has ended) */
const saveWorld = Effect.suspend(() => {
  if (!G || G.over) return Effect.void;
  savedAt = G.t;
  return save(WORLD_KEY, SavedWorld, snapshot());
});
// the game time of the last save, so a game standing still (paused) isn't saved over and over
let savedAt = -1;

// -------------------------------------------------------------------- input ----
const keys = new Set<string>();
// before the first move the stick waits in the bottom-right corner, like a resting thumb
function idleJoystick(on: boolean): void {
  const joy = ui.joy;
  joy.classList.toggle('idle', on);
  joy.hidden = !on;
  joy.style.left = '';
  joy.style.top = '';
  ui.knob.style.transform = 'translate(-50%,-50%)';
}
// The stick (drag anywhere on the ground) and the keys, while the game is open. Leaving lets go of both: a key or
// a drag let go of behind the menu is never heard, and the king would ride off on his own when the player came back.
const input = Effect.gen(function* () {
  const joy = ui.joy,
    knob = ui.knob;
  let pid: number | null = null,
    ox = 0,
    oy = 0;
  const R = 56;
  yield* listen(canvas, 'pointerdown', (e) => {
    if (pid !== null || !G || G.over) return;
    pid = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    const r = ui.root.getBoundingClientRect();
    joy.style.left = ox - r.left + 'px';
    joy.style.top = oy - r.top + 'px';
    joy.hidden = false;
    knob.style.transform = 'translate(-50%,-50%)';
    canvas.setPointerCapture(pid);
    joy.classList.remove('idle');
  });
  yield* listen(canvas, 'pointermove', (e) => {
    if (e.pointerId !== pid) return;
    let dx = e.clientX - ox,
      dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx *= R / d;
      dy *= R / d;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const jx = dx / R,
      jy = -dy / R;
    G.input.x = jx * SCR_R.x + jy * SCR_U.x;
    G.input.z = jx * SCR_R.z + jy * SCR_U.z;
  });
  const letGo = () => {
    pid = null;
    joy.hidden = true;
    G.input.x = G.input.z = 0;
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId === pid) letGo();
  };
  yield* listen(canvas, 'pointerup', end);
  yield* listen(canvas, 'pointercancel', end);
  yield* listen(window, 'keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      keys.add(k);
      e.preventDefault();
      if (joy.classList.contains('idle')) idleJoystick(false);
    }
    if (k === 'escape') togglePause();
  });
  yield* listen(window, 'keyup', (e) => {
    keys.delete(e.key.toLowerCase());
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      keys.clear();
      if (pid !== null) letGo();
    }),
  );
});
let keysWereDown = false;
function keyInput(): void {
  if (G.over) return;
  if (!keys.size) {
    if (keysWereDown) {
      G.input.x = G.input.z = 0;
      keysWereDown = false;
    }
    return;
  }
  keysWereDown = true;
  const jx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const jy = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  G.input.x = jx * SCR_R.x + jy * SCR_U.x;
  G.input.z = jx * SCR_R.z + jy * SCR_U.z;
}
function togglePause(force?: boolean): void {
  if (!G || G.over) return;
  G.paused = force ?? !G.paused;
  ui.pause.hidden = !G.paused;
}

// --------------------------------------------------------------------- loop ----
function step(dt: number): void {
  if (G.over) {
    G.t += dt;
    updateFx(dt);
    return;
  }
  G.t += dt;
  const cs = G.castle;
  if (cs.hitT > 0) cs.hitT -= dt;
  else if (cs.hp < cs.max) cs.hp = Math.min(cs.max, cs.hp + cs.max * 0.01 * dt);
  keyInput();
  updateSpawns(dt);
  rebuildGrid();
  updateTroop(dt);
  updateEnemies(dt);
  rebuildGrid();
  updateShooting(dt);
  updateProjectiles(dt);
  // remove the dead
  G.enemies = G.enemies.filter((e) => e.hp > 0);
  updateCoins(dt);
  updateGold(dt);
  updatePads(dt);
  for (const s of G.segs) {
    if (s.hitT > 0) s.hitT -= dt;
    else if (s.alive && s.hp < s.max) s.hp = Math.min(s.max, s.hp + s.max * 0.006 * dt);
  }
  G.spentFlash = Math.max(0, G.spentFlash - dt);
  G.gainFlash = Math.max(0, G.gainFlash - dt);
  updateToasts(dt);
  G.stats.maxEnemies = Math.max(G.stats.maxEnemies, G.enemies.length);
  updateFx(dt);
}
// a frame on screen (page.ts's animate gives the seconds since the last one, at most 0.05)
function frame(dt: number): void {
  if (!G.paused) step(dt);
  syncScene(G.paused ? 0 : dt);
  updateHud();
  renderer.render(scene, camera);
}
function resize(): void {
  const r = ui.root.getBoundingClientRect(),
    w = Math.max(1, r.width),
    h = Math.max(1, r.height);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // landscape shows about 33 units of ground top to bottom, portrait about 25 across
  const span = w >= h ? 33 : Math.min(60, 25.5 / (w / h));
  if (G) G.camDist = span / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}

// ------------------------------------------------------------------ public ----
// The renderer and the world are made the first time the game opens and kept for the page, with the game in them:
// coming back finds it where it was left.
function setup(): void {
  ui = {
    root: document.getElementById('cd-app')!,
    coins: document.getElementById('cd-coins')!,
    toast: document.getElementById('cd-toast'),
    joy: document.getElementById('cd-joy')!,
    knob: document.querySelector<HTMLElement>('#cd-joy .cd-knob')!,
    pause: document.getElementById('cd-pausemenu')!,
    over: document.getElementById('cd-over')!,
    overText: document.getElementById('cd-over-text')!,
  };
  initRenderer();
  buildWorld();
  started = true;
}
// A new game, or the saved one carried on
function startGame(saved?: SavedWorld): void {
  if (saved) restoreGame(saved);
  else newGame();
  savedAt = saved ? G.t : -1;
  resize();
  updateTerrain(G.king.x, G.king.z, true);
  ui.over.hidden = true;
  ui.pause.hidden = !saved;
  idleJoystick(!saved);
  if (ui.toast) ui.toast.classList.remove('show');
}
// The player arrives: the first time, the game saved last time (paused under the pause panel, as one left for the
// menu is) or else a new one; after that the one they left is there, still paused under the pause panel. A save that
// can't be set up after all (a mistake in this code) is forgotten, and a new game starts.
const arrive = Effect.gen(function* () {
  if (!G) {
    const saved = yield* load<SavedWorld | null>(WORLD_KEY, SavedWorld, () => null);
    try {
      startGame(saved ?? undefined);
    } catch (e) {
      if (!saved) throw e;
      reportError(e);
      yield* forget(WORLD_KEY);
      startGame();
    }
  } else resize();
  if (!G.over) G.paused = !ui.pause.hidden;
});
// The player leaves (for the menu or another game): a game still going pauses under the pause panel. A fallen
// castle's panel comes up now, in case they left before its delay was over.
function leave(): void {
  if (!G) return;
  if (G.over) ui.over.hidden = false;
  else {
    G.paused = true;
    ui.pause.hidden = false;
  }
}
// The buttons on the screen and its panels
const buttons = Effect.gen(function* () {
  const click = (id: string, fn: () => void | PageEffect) => listen(document.getElementById(id)!, 'click', fn);
  yield* click('cd-pause-btn', () => togglePause(true));
  yield* click('cd-resume', () => togglePause(false));
  yield* click('cd-restart', () => {
    ui.pause.hidden = true;
    startGame();
    return saveWorld;
  });
  yield* click('cd-retry', () => {
    ui.over.hidden = true;
    startGame();
    return saveWorld;
  });
  for (const id of ['cd-menu1', 'cd-menu2']) yield* click(id, () => GameHub.menu());
});

type PageEffect = Effect.Effect<void, never, PageServices>;
const SAVE_EVERY = '5 seconds';
const onPage = (effect: PageEffect) => void run(effect);
// The effects the game's plain code starts (saving the best time, the game-over panel's delay) run in the open
// game's fibers, so leaving stops them. With the game closed (a test stepping it by hand) they run on the page.
let fork: (effect: PageEffect) => void = onPage;

export const game: HubGame = {
  open: Effect.gen(function* () {
    if (!started) yield* Effect.sync(setup);
    // a font that won't load leaves the labels in the fallback font, as before
    yield* Effect.tryPromise(() => fontReady).pipe(Effect.ignore);
    yield* Effect.acquireRelease(arrive, () => Effect.sync(leave));
    const runFork = yield* FiberSet.makeRuntime<PageServices>();
    fork = (effect) => void runFork(effect);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        fork = onPage;
      }),
    );
    yield* input;
    yield* buttons;
    yield* listen(window, 'resize', () => resize());
    // the game is saved every few seconds while it runs, when the page is hidden or goes, and when the player leaves
    const saveIfMoved = Effect.suspend(() => (G.t !== savedAt ? saveWorld : Effect.void));
    yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.sleep(SAVE_EVERY), saveIfMoved)));
    yield* listen(document, 'visibilitychange', () => (document.hidden ? saveIfMoved : Effect.void));
    yield* listen(window, 'pagehide', () => saveIfMoved);
    yield* Effect.addFinalizer(() => saveIfMoved);
    yield* animate(frame);
  }),
};
// for tests/browser/castle-defender.test.ts and tools/play-castle-defender.ts
function debug() {
  return {
    get G() {
      return G;
    },
    world,
    THREE,
    scene,
    camera,
    renderer,
    teleport(x: number, z: number) {
      G.free = true;
      G.king.x = x;
      G.king.z = z;
      updateTerrain(x, z, true);
    },
    // run the game for `sec` seconds of game time as fast as possible
    advance(sec: number, dt = 1 / 30) {
      for (let t = 0; t < sec && !G.over; t += dt) {
        step(dt);
        syncScene(dt);
      }
    },
    rich(n = 1e6) {
      G.coins = n;
    },
    // save the game now, as the game does every few seconds
    save() {
      runSync(saveWorld);
    },
    openFront,
    // buy what a pad sells without walking over to it
    buy(id: string) {
      const p = G.pads.find((q) => q.id === id);
      if (!p || !p.visible()) return false;
      p.buy();
      p.paid = 0;
      return true;
    },
    pads: () => G.pads.filter((p) => p.visible()).map((p) => ({ id: p.id, x: p.x, z: p.z, cost: p.price() })),
    sites: () =>
      G.towers
        .filter((t) => t.outer && !t.built)
        .map((t) => ({ id: 'outpost' + t.idx, x: t.x, z: t.z, border: borderDist(G.claims, t.x, t.z) })),
    fronts: () =>
      G.fronts.map((f) => ({
        id: f.id,
        open: f.open,
        x: f.camp.x,
        z: f.camp.z,
        theme: f.camp.theme,
        tier: campTier(f.camp),
        roadLen: f.road.length,
        segs: f.segs.length,
      })),
    claims: () => G.claims.map((c) => ({ x: c.x, z: c.z, r: c.r })),
    borderDist: (x: number, z: number) => borderDist(G.claims, x, z),
    terrain: () => ({
      chunks: world.terrain.chunks.size,
      strips: world.terrain.strips.size,
      made: world.terrain.made,
      ms: world.terrain.ms,
      roads: world.terrain.roads.map((r) => r.id),
    }),
    biomeAt,
  };
}
export type CastleDebug = ReturnType<typeof debug>;
window.CastleDefender = { _debug: debug };
