// Castle Defender: ride the king around, collect the coins fallen enemies drop
// and spend them on pads to grow an army, towers, walls, cannons and weapons.
// Building further from the castle opens new roads with tougher enemies.
import * as THREE from 'three';

// ---------------------------------------------------------------- tuning ----
const HX = 14, HZ = 12;                       // walled base: x in [-HX,HX], z in [-HZ,HZ]
// a gate in every side: the king walks through, enemies have to break it down
const GATES = [{ side: 'E', lo: -2, hi: 2 }, { side: 'N', lo: -2, hi: 2 }, { side: 'S', lo: 4, hi: 8 }, { side: 'W', lo: -9, hi: -5 }];
const KING_SPEED = 10.2, KING_R = 0.7;
const BOUNDS = { x0: -15.6, x1: 74, z0: -66, z1: 62 };
const FOLLOWER_CAP = 60;                       // people in the troop, counting everyone merged into stronger ones
// Past SQUAD_MAX followers, new recruits join the weakest follower instead and
// make it stronger (damage x rank). Ranks show as a bigger body and a new tunic.
const SQUAD_MAX = 10;
const RANKS = [{ min: 1, top: '#f5f2ec', s: 1 }, { min: 2, top: '#3d7be0', s: 1.15 }, { min: 4, top: '#3fae5a', s: 1.3 }, { min: 7, top: '#8a4fd8', s: 1.45 }];
const rankTier = (r) => { let i = 0; while (i + 1 < RANKS.length && r >= RANKS[i + 1].min) i++; return i; };

// Weapons, in the order the forge unlocks them. dmg per hit, cd seconds.
const WEAPONS = [
  { name: 'Bows',          dmg: 10,   cd: 0.55, range: 10,  kind: 'arrow',  speed: 30 },
  { name: 'Upgraded bows', dmg: 16,  cd: 0.45, range: 11,  kind: 'arrow2', speed: 34 },
  { name: 'Crossbows',     dmg: 34,  cd: 0.5, range: 12,  kind: 'bolt',   speed: 40 },
  { name: 'Spears',        dmg: 62,  cd: 0.55, range: 9.5, kind: 'spear',  speed: 26, pierce: 3 },
  { name: 'Iron swords',   dmg: 125, cd: 0.325, range: 1.7, kind: 'melee',  leash: 6.5 },
  { name: 'Guns',          dmg: 210, cd: 0.375, range: 14,  kind: 'bullet', speed: 75 },
  { name: 'Machine guns',  dmg: 95,  cd: 0.07, range: 15,  kind: 'bullet', speed: 85 },
];
const FORGE_COSTS = [135, 360, 840, 1800, 3600, 7200];
// walls come with the archer towers: each tower builds and upgrades the stretch of wall nearest to it
const WALL_TIERS = [
  { name: 'Palisade',        hp: 700 },
  { name: 'Reinforced logs', hp: 1700 },
  { name: 'Stone walls',     hp: 4200 },
  { name: 'Fortified stone', hp: 10000 },
  { name: 'Iron walls',      hp: 24000 },
];
const TOWER_SPOTS = [[14, -4.5], [14, 4.5], [14, -12], [14, 12], [-14, -12], [-14, 12]];
const TOWER_UP_PADS = [[10.4, -4.5], [10.4, 4.5], [10.6, -9.4], [10.6, 9.4], [-10.6, -9.4], [-10.6, 9.4]];
const TOWER_COSTS = [30, 45, 70, 110, 170, 260];
const TOWER_UP = [50, 150, 400, 1000];         // to levels 2..5
const TOWER_LV = [{ h: 3.45, archers: 3 }, { h: 4.06, archers: 3 }, { h: 4.67, archers: 4 }, { h: 5.3, archers: 4 }, { h: 5.92, archers: 5 }];
// outposts further out: same towers, no walls
const OUTER_SPOTS = [[37, -24], [46, 8], [23, 33]], OUTER_UP_PADS = [[33, -22.4], [42, 9], [19, 31.4]], OUTER_COSTS = [700, 1000, 1400];
const BARRACKS = [-11, 1.5], RECRUIT_PAD = [-6.8, 5.0], FORGE = [0, 8], FORGE_PAD = [-5.0, 9.6];
const BARRACKS_STEPS = [0, 3, 6, 10];          // recruit purchases before each barracks level
const CANNON_SPOTS = [[24, -14], [25, 10], [0, -30]], CANNON_PADS = [[19.8, -12.4], [20.8, 11.8], [0.4, -25.6]];
const CANNON_COSTS = [250, 400, 650], CANNON_MAX = 5, CANNON_TOP = [0.82, 0.95, 1.42, 1.42, 1.42];
const GOLD_HUT = [52, -26], GOLD_PAD = [46.4, -23.6], GOLD_PLOT = [52.5, -20.2], GOLD_COSTS = [1500, 3000, 6000];
const GOLD_BOYS = [{ n: 1, speed: 7.5, cap: 40 }, { n: 2, speed: 8.5, cap: 80 }, { n: 3, speed: 9.5, cap: 150 }];
const RECRUIT = [[6, 1], [14, 3], [28, 3], [45, 3], [70, 4], [100, 4], [140, 5], [190, 5], [250, 6]];

const CASTLE = { x: -5.5, z: -4.5, r: 3.1 };
// three roads into the castle from the east, north-east and south-east
const P0 = [[56, -2], [46, -6], [36, -3], [27, -7], [20, -1], [15.4, 0], [3, 0], [CASTLE.x, CASTLE.z]];
const P1 = [[30, -52], [31, -42], [26, -33], [18, -25], [10, -19.5], [3, -13.2], [-1, -9], [CASTLE.x, CASTLE.z]];
const P2 = [[46, 44], [38, 37], [30, 30], [21, 23], [12, 18], [7, 13.5], [6, 6], [3, 0], [CASTLE.x, CASTLE.z]];
// three outer roads join them; each opens the first time you build in its ring
const PATHS = [P0, P1, P2,
  [[4, -88], [8, -76], [16, -66], [24, -59], ...P1],
  [[84, 66], [74, 60], [64, 58], [54, 50], ...P2],
  [[96, 6], [86, -6], [76, -10], [66, -4], ...P0]];
const PATH_OPEN = [0, 8, 20];   // seconds after the start that each of the first three roads opens
const THEMES = [
  { name: 'Canyon', hp: 1, value: 1, speed: 1 },
  { name: 'Frozen Pass', ring: 1, path: 3, center: [17, -70], size: 48, hp: 1.7, value: 1.5, speed: 1.08 },
  { name: 'Mire', ring: 2, path: 4, center: [65, 55], size: 48, hp: 2.6, value: 2.1, speed: 0.95 },
  { name: 'Ashlands', ring: 3, path: 5, center: [76, -2], size: 48, hp: 3.8, value: 2.8, speed: 1.05 },
];
const PATH_THEME = [0, 0, 0, 1, 2, 3];
// enemy sizes; `cost` is how much of a group's budget one of them uses
const UNIT = {
  knight: { hp: 1, dmg: 1, value: 1, speed: 2.4, r: 0.5, scale: 1.15, cost: 1, bar: 2.1, barW: 1.1, atk: 1.2, shadow: 1.25 },
  brute: { hp: 5.5, dmg: 3, value: 4, speed: 2.0, r: 0.95, scale: 1.4, cost: 4, bar: 3.6, barW: 1.6, atk: 1.5, shadow: 2.1 },
  giant: { hp: 16, dmg: 5, value: 13, speed: 1.4, r: 1.3, scale: 2.3, cost: 12, bar: 5.6, barW: 2.2, atk: 1.8, shadow: 2.5 },
};
const PAL = [
  { // canyon: the red army from the reference
    knight: { legs: '#3a363c', body: '#cf2530', belt: '#7a1c22', light: '#e2343c', visor: '#4d1014', plume: '#e3262f', blade: '#dfe3ea', hilt: '#5a5a62', shield: '#f2a12c', shieldDk: '#c97d16' },
    brute: { legs: '#3a2f30', body: '#a3222b', dark: '#5e1418', light: '#c73038', trim: '#e0b13a', horn: '#efe6d6', visor: '#2a0b0d', handle: '#6b4528', blade: '#c9ced8' },
    giants: [
      { legs: '#4a3d3d', body: '#f6dcdc', skin: '#f3c9c6', helm: '#959aa6', helm2: '#a4a9b4', nose: '#6c707a', handle: '#6b4528', head: '#7f8590' },
      { legs: '#4a3d3d', body: '#d42a31', skin: '#f0a39c', helm: '#959aa6', helm2: '#a4a9b4', nose: '#6c707a', handle: '#6b4528', head: '#7f8590' }] },
  { // frozen pass
    knight: { legs: '#3b4655', body: '#3e6fb6', belt: '#26466f', light: '#e9f2fa', visor: '#1c2f4a', plume: '#7fd0ff', blade: '#cfefff', hilt: '#5d6f84', shield: '#9fd6f5', shieldDk: '#4f8fc0' },
    brute: { legs: '#2f3a48', body: '#e8f0f7', dark: '#3e6fb6', light: '#bfdcf0', trim: '#7fd0ff', horn: '#cfe8f7', visor: '#13253a', handle: '#5a4632', blade: '#a8e6ff' },
    giants: [{ legs: '#3b4655', body: '#eef5fb', skin: '#cfe2ee', helm: '#7fa8cc', helm2: '#9cc2e0', nose: '#4e7092', handle: '#5a4632', head: '#a8e6ff' }] },
  { // mire
    knight: { legs: '#3b3226', body: '#557a2c', belt: '#30461a', light: '#6f9a38', visor: '#1b2a0f', plume: '#b8d84a', blade: '#c4c9b8', hilt: '#5a4a32', shield: '#8a6a3a', shieldDk: '#5e4626' },
    brute: { legs: '#3b3226', body: '#4a6e2a', dark: '#2c4218', light: '#7aa040', trim: '#8a6a3a', horn: '#d8cfa6', visor: '#141f0b', handle: '#5a4a32', blade: '#9aa08e' },
    giants: [{ legs: '#3b3226', body: '#5d8a34', skin: '#8db45a', helm: '#6b5a3a', helm2: '#7d6a46', nose: '#4a3e28', handle: '#5a4a32', head: '#6e6a5e' }] },
  { // ashlands
    knight: { legs: '#1c1b1f', body: '#2b2930', belt: '#141317', light: '#3d3a44', visor: '#ff8a1e', plume: '#ff6a12', blade: '#ffb347', hilt: '#3a3036', shield: '#4a2416', shieldDk: '#ff6a12' },
    brute: { legs: '#1c1b1f', body: '#2b2930', dark: '#16151a', light: '#46424e', trim: '#ff7a1a', horn: '#2a2529', visor: '#ff9a2e', handle: '#2a2026', blade: '#ff8a2a' },
    giants: [{ legs: '#1c1b1f', body: '#34313a', skin: '#5a4a4a', helm: '#24222a', helm2: '#2f2c35', nose: '#ff7a1a', handle: '#2a2026', head: '#3a3540' }] },
];

const C = {
  sand: '#ba8b5b', sandDark: '#b98d5f', path: '#dcb98f', cliffTop: '#f1c98f', cliffSide: '#6e4b35', cliffSide2: '#5d3e2b',
  grass: '#5aa874', grassDark: '#4f9a68', stake: '#4e2f20', stakeTip: '#b98b62', wood: '#6b452d', woodLight: '#9a6a43',
  red: '#cf2530', redLight: '#e2343c', skin: '#f2cba6', hair: '#2e2b2d', white: '#f5f2ec', gold: '#ffc83a', blue: '#2d5ccc',
};

// ------------------------------------------------------- geometry helpers ----
const T = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cy = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
const S = (r, w = 12, h = 9, ...rest) => new THREE.SphereGeometry(r, w, h, ...rest);
const Co = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
function vc(g, hex, m) {
  const src = g.index ? g.toNonIndexed() : g;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', src.attributes.position.clone());
  geo.setAttribute('normal', src.attributes.normal.clone());
  if (m) geo.applyMatrix4(m);
  const n = geo.attributes.position.count, c = new THREE.Color(hex), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
function merge(parts) {
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); col.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}
function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.userData.canvas = cv;
  return t;
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// a triangular prism (gable roof): base `w` wide, `h` tall, `d` deep along z
function gable(w, h, d) {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); g.translate(0, 0, -d / 2);
  return g;
}
// a ring of `n` boxes around the y axis, each facing outward (battlements, stakes)
function ringOf(n, r, y, w, h, d, hex, phase = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = phase + i / n * Math.PI * 2; out.push(vc(B(w, h, d), hex, T(Math.sin(a) * r, y, Math.cos(a) * r, 0, a, 0))); }
  return out;
}
const flag = (x, y, z, hex, len = 1.6) => [vc(Cy(0.05, 0.05, len, 6), '#5a3826', T(x, y + len / 2, z)), vc(B(0.75, 0.45, 0.04), hex, T(x + 0.4, y + len - 0.28, z)), vc(S(0.08, 6, 5), '#f5b81c', T(x, y + len + 0.04, z))];

// ----------------------------------------------------------------- models ----
function followerGeo(hairHex = C.hair, topHex = C.white, pantsHex = '#7a5638') {
  return merge([
    vc(B(0.17, 0.28, 0.2), '#3a2a22', T(-0.12, 0.14, 0)), vc(B(0.17, 0.28, 0.2), '#3a2a22', T(0.12, 0.14, 0)),
    vc(Cy(0.25, 0.27, 0.2, 10), pantsHex, T(0, 0.36, 0)),
    vc(Cy(0.2, 0.25, 0.36, 10), topHex, T(0, 0.63, 0)),
    vc(Cy(0.075, 0.065, 0.34, 6), C.skin, T(-0.31, 0.62, 0.05, 0.2, 0, 0.32)),
    vc(Cy(0.075, 0.065, 0.34, 6), C.skin, T(0.31, 0.62, 0.05, 0.2, 0, -0.32)),
    vc(S(0.37, 14, 10), C.skin, T(0, 1.1, 0)),
    vc(S(0.39, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), hairHex, T(0, 1.15, -0.05)),
    vc(S(0.385, 12, 6, Math.PI * 0.6, Math.PI * 0.8, Math.PI * 0.3, Math.PI * 0.35), hairHex, T(0, 1.12, -0.03)),
    vc(B(0.065, 0.1, 0.04), '#1d1616', T(-0.13, 1.08, 0.345)), vc(B(0.065, 0.1, 0.04), '#1d1616', T(0.13, 1.08, 0.345)),
    vc(B(0.13, 0.03, 0.04), hairHex, T(-0.13, 1.18, 0.335, 0, 0, 0.18)), vc(B(0.13, 0.03, 0.04), hairHex, T(0.13, 1.18, 0.335, 0, 0, -0.18)),
  ]);
}
function goldBoyGeo() {
  return merge([followerGeo('#7a4a22', '#f5c33a', '#6b4a2a'),
    vc(S(0.41, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.36), '#e0a020', T(0, 1.18, 0)), vc(B(0.42, 0.05, 0.26), '#c98a14', T(0, 1.3, 0.36, -0.2, 0, 0))]);
}
function sackGeo() {
  return merge([vc(S(0.34, 10, 8), '#c9a46a', T(0, 0, 0, 0, 0, 0, 1, 1.1, 0.9)), vc(Cy(0.09, 0.15, 0.16, 8), '#8a6a3a', T(0, 0.38, 0)), vc(Cy(0.12, 0.12, 0.03, 10), '#ffc83a', T(0.12, 0.2, 0.26, 1.2, 0, 0))]);
}
function weaponGeo(tier) {
  switch (tier) {
    case 0: return merge([vc(new THREE.TorusGeometry(0.4, 0.035, 5, 14, Math.PI), '#8a5a2b', T(0.36, 0.75, 0.22, 0, Math.PI / 2, Math.PI / 2)), vc(B(0.012, 0.8, 0.012), '#f2efe6', T(0.36, 0.75, 0.22))]);
    case 1: return merge([vc(new THREE.TorusGeometry(0.44, 0.045, 5, 14, Math.PI), '#e7b43c', T(0.36, 0.75, 0.24, 0, Math.PI / 2, Math.PI / 2)), vc(B(0.015, 0.88, 0.015), '#bfeaff', T(0.36, 0.75, 0.24)), vc(S(0.07, 8, 6), '#7fd7ff', T(0.36, 1.19, 0.24)), vc(S(0.07, 8, 6), '#7fd7ff', T(0.36, 0.31, 0.24))]);
    case 2: return merge([vc(B(0.08, 0.08, 0.62), '#7a4a26', T(0.3, 0.72, 0.3)), vc(B(0.62, 0.05, 0.07), '#4a4f58', T(0.3, 0.74, 0.55)), vc(B(0.03, 0.03, 0.4), '#d9dde3', T(0.3, 0.79, 0.4))]);
    case 3: return merge([vc(Cy(0.03, 0.03, 1.7, 5), '#8a5a2b', T(0.36, 0.95, 0.12, 0.15, 0, 0)), vc(Co(0.07, 0.26, 5), '#d9dde3', T(0.36, 1.83, 0.25, 0.15, 0, 0))]);
    case 4: return merge([vc(B(0.08, 0.8, 0.025), '#e3e7ee', T(0.38, 0.98, 0.3, 0.55, 0, 0)), vc(B(0.26, 0.05, 0.07), '#e1b23a', T(0.38, 0.65, 0.12, 0.55, 0, 0)), vc(B(0.05, 0.18, 0.05), '#6b3d1f', T(0.38, 0.56, 0.06, 0.55, 0, 0))]);
    case 5: return merge([vc(Cy(0.04, 0.04, 0.75, 6), '#2f3238', T(0.3, 0.75, 0.42, Math.PI / 2, 0, 0)), vc(B(0.09, 0.14, 0.32), '#7a4a26', T(0.3, 0.7, 0.06))]);
    default: return merge([vc(B(0.16, 0.18, 0.62), '#26292f', T(0.3, 0.72, 0.28)), vc(Cy(0.045, 0.045, 0.5, 6), '#3c4048', T(0.3, 0.76, 0.75, Math.PI / 2, 0, 0)), vc(Cy(0.13, 0.13, 0.08, 10), '#c2a23a', T(0.3, 0.6, 0.26, 0, 0, Math.PI / 2))]);
  }
}
function knightGeo(shield, k) {
  const parts = [
    vc(B(0.19, 0.28, 0.21), k.legs, T(-0.13, 0.14, 0)), vc(B(0.19, 0.28, 0.21), k.legs, T(0.13, 0.14, 0)),
    vc(Cy(0.28, 0.3, 0.5, 8), k.body, T(0, 0.52, 0)),
    vc(Cy(0.3, 0.3, 0.06, 8), k.belt, T(0, 0.36, 0)),
    vc(S(0.13, 8, 6), k.light, T(-0.32, 0.7, 0)), vc(S(0.13, 8, 6), k.light, T(0.32, 0.7, 0)),
    vc(Cy(0.31, 0.34, 0.5, 10), k.light, T(0, 1.02, 0)),
    vc(S(0.31, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), k.light, T(0, 1.27, 0)),
    vc(B(0.36, 0.045, 0.05), k.visor, T(0, 1.05, 0.31)), vc(B(0.36, 0.045, 0.05), k.visor, T(0, 0.95, 0.31)), vc(B(0.045, 0.24, 0.05), k.visor, T(0, 1.0, 0.32)),
    vc(B(0.14, 0.12, 0.42), k.plume, T(0, 1.46, -0.02, -0.25, 0, 0)), vc(B(0.14, 0.12, 0.36), k.plume, T(0, 1.42, -0.36, 0.55, 0, 0)), vc(B(0.14, 0.12, 0.3), k.plume, T(0, 1.2, -0.52, 1.25, 0, 0)),
    vc(B(0.07, 0.05, 0.85), k.blade, T(0.36, 0.55, 0.46, 0.35, 0, 0)), vc(B(0.2, 0.05, 0.06), k.hilt, T(0.36, 0.62, 0.06, 0.35, 0, 0)),
  ];
  if (shield) parts.push(vc(Cy(0.3, 0.3, 0.06, 14), k.shield, T(-0.36, 0.62, 0.18, Math.PI / 2, 0, 0)), vc(Cy(0.12, 0.12, 0.08, 10), k.shieldDk, T(-0.36, 0.62, 0.21, Math.PI / 2, 0, 0)));
  return merge(parts);
}
// the middle size: a horned brute with a two-handed axe
function bruteGeo(b) {
  return merge([
    vc(B(0.26, 0.36, 0.28), b.legs, T(-0.19, 0.18, 0)), vc(B(0.26, 0.36, 0.28), b.legs, T(0.19, 0.18, 0)),
    vc(Cy(0.42, 0.44, 0.34, 10), b.dark, T(0, 0.52, 0)),
    vc(Cy(0.5, 0.42, 0.7, 10), b.body, T(0, 1.02, 0)),
    vc(Cy(0.47, 0.47, 0.09, 10), b.trim, T(0, 0.7, 0)),
    vc(S(0.24, 10, 7), b.light, T(-0.52, 1.28, 0)), vc(S(0.24, 10, 7), b.light, T(0.52, 1.28, 0)),
    vc(Cy(0.12, 0.11, 0.55, 7), b.light, T(-0.6, 0.98, 0.1, 0.3, 0, 0.25)), vc(Cy(0.12, 0.11, 0.55, 7), b.light, T(0.6, 1.0, 0.16, -0.5, 0, -0.25)),
    vc(S(0.13, 8, 6), b.light, T(-0.66, 0.72, 0.2)), vc(S(0.13, 8, 6), b.light, T(0.62, 0.9, 0.4)),
    vc(Cy(0.3, 0.33, 0.42, 10), b.light, T(0, 1.58, 0)),
    vc(S(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), b.light, T(0, 1.79, 0)),
    vc(B(0.36, 0.06, 0.06), b.visor, T(0, 1.6, 0.3)), vc(B(0.06, 0.2, 0.06), b.visor, T(0, 1.52, 0.31)),
    vc(Co(0.08, 0.42, 6), b.horn, T(-0.34, 1.92, 0, 0, 0, 0.9)), vc(Co(0.08, 0.42, 6), b.horn, T(0.34, 1.92, 0, 0, 0, -0.9)),
    vc(Cy(0.045, 0.045, 1.6, 6), b.handle, T(0.55, 1.0, 0.45, 0.5, 0, 0)),
    vc(B(0.07, 0.5, 0.42), b.blade, T(0.55, 1.62, 0.78, 0.5, 0, 0)),
  ]);
}
function giantGeo(g) {
  return merge([
    vc(B(0.26, 0.4, 0.3), g.legs, T(-0.2, 0.2, 0)), vc(B(0.26, 0.4, 0.3), g.legs, T(0.2, 0.2, 0)),
    vc(Cy(0.45, 0.5, 0.8, 10), g.body, T(0, 0.8, 0)),
    vc(S(0.47, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), g.body, T(0, 1.18, 0)),
    vc(Cy(0.16, 0.13, 0.75, 8), g.skin, T(-0.58, 0.95, 0.08, 0.2, 0, 0.35)), vc(Cy(0.16, 0.13, 0.75, 8), g.skin, T(0.58, 1.05, 0.1, -0.9, 0, -0.3)),
    vc(S(0.19, 8, 6), g.skin, T(-0.72, 0.62, 0.2)), vc(S(0.19, 8, 6), g.skin, T(0.68, 1.3, 0.48)),
    vc(Cy(0.3, 0.33, 0.42, 10), g.helm, T(0, 1.5, 0.05)), vc(S(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), g.helm2, T(0, 1.7, 0.05)),
    vc(B(0.06, 0.3, 0.06), g.nose, T(0, 1.46, 0.36)),
    vc(Cy(0.06, 0.06, 1.2, 6), g.handle, T(0.68, 1.55, 0.25, 0.9, 0, 0)), vc(B(0.46, 0.4, 0.4), g.head, T(0.68, 1.85, -0.25, 0.9, 0, 0)),
  ]);
}
function kingGeo() {
  return merge([
    // horse
    vc(new THREE.CapsuleGeometry(0.36, 0.75, 4, 10), '#efe3d6', T(0, 0.82, 0, Math.PI / 2, 0, 0)),
    vc(S(0.22, 8, 6), '#a0673c', T(0.18, 0.95, -0.2)),
    ...[[-0.2, 0.42], [0.2, 0.42], [-0.2, -0.42], [0.2, -0.42]].map(([x, z]) => vc(Cy(0.09, 0.08, 0.6, 6), '#efe3d6', T(x, 0.3, z))),
    ...[[-0.2, 0.42], [0.2, 0.42], [-0.2, -0.42], [0.2, -0.42]].map(([x, z]) => vc(Cy(0.1, 0.1, 0.1, 6), '#6b4a35', T(x, 0.05, z))),
    vc(B(0.26, 0.5, 0.3), '#efe3d6', T(0, 1.15, 0.6, 0.5, 0, 0)), vc(B(0.26, 0.28, 0.46), '#efe3d6', T(0, 1.32, 0.86, 0.25, 0, 0)),
    vc(B(0.08, 0.16, 0.06), '#e2cfbd', T(-0.09, 1.52, 0.7)), vc(B(0.08, 0.16, 0.06), '#e2cfbd', T(0.09, 1.52, 0.7)),
    vc(B(0.08, 0.36, 0.3), '#8b5a2b', T(0, 1.3, 0.56, 0.5, 0, 0)), vc(Cy(0.06, 0.02, 0.5, 5), '#8b5a2b', T(0, 0.75, -0.62, -0.6, 0, 0)),
    vc(B(0.66, 0.06, 0.62), '#2d5ccc', T(0, 1.18, -0.05)),
    // king
    vc(Cy(0.27, 0.3, 0.55, 10), C.blue, T(0, 1.5, 0)), vc(S(0.15, 8, 6), '#cfd3dc', T(-0.3, 1.66, 0)), vc(S(0.15, 8, 6), '#cfd3dc', T(0.3, 1.66, 0)),
    vc(Cy(0.075, 0.07, 0.36, 6), '#cfd3dc', T(-0.36, 1.48, 0.1, 0.3, 0, 0.3)), vc(Cy(0.075, 0.07, 0.36, 6), '#cfd3dc', T(0.36, 1.48, 0.1, 0.3, 0, -0.3)),
    vc(B(0.62, 0.62, 0.06), '#2449a8', T(0, 1.45, -0.3, 0.15, 0, 0)),
    vc(S(0.35, 14, 10), C.skin, T(0, 2.0, 0)),
    vc(S(0.3, 10, 7, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), '#6a3b20', T(0, 1.97, 0.07)),
    vc(B(0.06, 0.08, 0.04), '#1d1616', T(-0.12, 2.03, 0.33)), vc(B(0.06, 0.08, 0.04), '#1d1616', T(0.12, 2.03, 0.33)),
    vc(Cy(0.3, 0.27, 0.2, 10, 1, true), '#f5b81c', T(0, 2.3, 0)), vc(Cy(0.27, 0.27, 0.04, 10), '#d9970f', T(0, 2.21, 0)),
    ...[0, 1, 2, 3, 4].map(i => vc(Co(0.07, 0.2, 5), '#f5b81c', T(Math.sin(i * 1.2566) * 0.28, 2.48, Math.cos(i * 1.2566) * 0.28))),
    vc(S(0.06, 6, 5), '#d8262e', T(0, 2.3, 0.3)),
  ]);
}

// Archer towers, levels 1..5: wooden lookout, tall lookout, stone-footed, stone, fortified.
// The archers stand at TOWER_LV[lv-1].h.
function towerGeo(lv) {
  const p = [], wood = '#5a3b28', wood2 = '#6e4a32', plank = '#8a5a36', rail = '#7a4c2f';
  const stone = '#a39e95', stoneDk = '#858078', stoneLt = '#b4afa6';
  const rails = (y, r) => { for (const [x, z, a] of [[0, r, 0], [0, -r, 0], [r, 0, Math.PI / 2], [-r, 0, Math.PI / 2]]) p.push(vc(Cy(0.09, 0.09, 2 * r + 0.1, 6), rail, T(x, y, z, 0, a, Math.PI / 2))); for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) p.push(vc(B(0.14, 0.62, 0.14), wood, T(x * r, y - 0.18, z * r))); };
  if (lv === 1) {
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; p.push(vc(Cy(0.17, 0.19, 3.3, 7), i % 2 ? wood : wood2, T(Math.cos(a) * 0.62, 1.65, Math.sin(a) * 0.62))); }
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) p.push(vc(Cy(0.12, 0.13, 2.6, 6), wood, T(x * 0.95, 1.1, z * 0.95, -z * 0.32, 0, x * 0.32)));
    p.push(vc(B(1.7, 0.12, 0.12), wood2, T(0, 1.2, 0.7)), vc(B(0.12, 0.12, 1.7), wood2, T(0.7, 1.2, 0)));
    p.push(vc(B(2.2, 0.22, 2.2), plank, T(0, 3.35, 0)));
    for (const [x, z, r] of [[0, 1.05, 0], [0, -1.05, 0], [1.05, 0, Math.PI / 2], [-1.05, 0, Math.PI / 2]]) p.push(vc(Cy(0.1, 0.1, 2.3, 6), rail, T(x, 3.5, z, 0, r, Math.PI / 2)));
  } else if (lv === 2) {
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; p.push(vc(Cy(0.18, 0.2, 3.9, 7), i % 2 ? wood : wood2, T(Math.cos(a) * 0.72, 1.95, Math.sin(a) * 0.72))); }
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) p.push(vc(Cy(0.13, 0.14, 3.2, 6), wood, T(x * 1.08, 1.4, z * 1.08, -z * 0.3, 0, x * 0.3)));
    for (const y of [1.3, 2.6]) p.push(vc(B(1.9, 0.13, 0.13), wood2, T(0, y, 0.8)), vc(B(0.13, 0.13, 1.9), wood2, T(0.8, y, 0)), vc(B(1.9, 0.13, 0.13), wood2, T(0, y, -0.8)), vc(B(0.13, 0.13, 1.9), wood2, T(-0.8, y, 0)));
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
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + 0.2; p.push(vc(Cy(0.13, 0.15, 2.4, 6), i % 2 ? wood : wood2, T(Math.cos(a) * 0.95, 3.45, Math.sin(a) * 0.95))); }
    p.push(vc(B(2.0, 0.13, 0.13), wood2, T(0, 3.3, 0.92)), vc(B(0.13, 0.13, 2.0), wood2, T(0.92, 3.3, 0)), vc(B(2.0, 0.13, 0.13), wood2, T(0, 3.3, -0.92)), vc(B(0.13, 0.13, 2.0), wood2, T(-0.92, 3.3, 0)));
    p.push(vc(B(2.7, 0.26, 2.7), plank, T(0, 4.55, 0)), vc(B(2.8, 0.1, 2.8), wood, T(0, 4.4, 0)));
    rails(4.92, 1.3);
    p.push(...flag(-1.3, 4.6, -1.3, '#2d5ccc', 2.0));
  } else if (lv === 4) {
    p.push(vc(Cy(1.2, 1.45, 5.0, 14), stone, T(0, 2.5, 0)));
    for (const y of [1.25, 2.55, 3.85]) { const r = 1.45 - 0.05 * y + 0.05; p.push(vc(Cy(r, r, 0.12, 14), stoneDk, T(0, y, 0))); }
    p.push(vc(B(0.6, 0.95, 0.1), '#3b2a20', T(0, 0.5, 1.42)));
    for (let i = 0; i < 3; i++) { const a = 0.3 + i * 1.2; p.push(vc(B(0.22, 0.5, 0.1), '#2b2420', T(Math.sin(a) * 1.3, 3.2, Math.cos(a) * 1.3, 0, a, 0))); }
    p.push(vc(Cy(1.6, 1.38, 0.4, 14), stoneLt, T(0, 5.1, 0)));
    p.push(...ringOf(8, 1.42, 5.55, 0.5, 0.5, 0.34, stoneLt));
    p.push(...flag(-0.95, 5.3, -0.95, '#d8262e', 2.2));
  } else {
    p.push(vc(B(3.0, 1.0, 3.0), stoneDk, T(0, 0.5, 0)), vc(B(3.12, 0.14, 3.12), '#e0b13a', T(0, 1.02, 0)));
    p.push(vc(Cy(1.28, 1.5, 4.6, 14), '#9a958e', T(0, 3.3, 0)));
    for (const y of [2.3, 3.9]) { const r = 1.5 - (y - 1.0) * 0.0478 + 0.05; p.push(vc(Cy(r, r, 0.13, 14), '#e0b13a', T(0, y, 0))); }
    p.push(vc(Cy(1.8, 1.45, 0.42, 14), stoneLt, T(0, 5.71, 0)));
    p.push(...ringOf(10, 1.62, 6.18, 0.46, 0.55, 0.36, stoneLt), ...ringOf(10, 1.62, 6.5, 0.48, 0.08, 0.38, '#e0b13a'));
    // hanging banner and braziers
    p.push(vc(B(0.95, 1.9, 0.06), '#2d5ccc', T(0, 3.75, 1.47)), vc(B(0.4, 0.4, 0.07), '#ffd34a', T(0, 4.0, 1.5, 0, 0, Math.PI / 4)), vc(Co(0.48, 0.4, 3), '#2d5ccc', T(0, 2.62, 1.47, Math.PI, 0, 0, 1, 1, 0.12)));
    for (const s of [-1, 1]) p.push(vc(Cy(0.2, 0.12, 0.28, 8), '#2f2a28', T(s * 1.25, 6.1, 1.0)), vc(Co(0.15, 0.36, 6), '#ffae2a', T(s * 1.25, 6.4, 1.0)));
    p.push(...flag(-1.05, 5.9, -1.05, '#2d5ccc', 2.6));
  }
  return merge(p);
}
function castleGeo() {
  // a timber keep in the same materials as the barracks: stone ground floor, wooden upper floor, steep shingle roofs
  const stone = '#9b968d', stoneDk = '#7f7a72', wood = '#5b3d2b', beam = '#7a5234', roof = '#93624a', roofDk = '#7c503b', p = [];
  p.push(vc(B(5.0, 0.6, 5.0), '#8a8c8a', T(0, 0.3, 0)));
  p.push(vc(B(4.2, 2.0, 4.2), stone, T(0, 1.6, 0)));
  for (const y of [1.0, 2.0]) p.push(vc(B(4.25, 0.08, 4.25), stoneDk, T(0, y, 0)));
  p.push(vc(B(4.6, 0.2, 4.6), beam, T(0, 2.7, 0)));
  p.push(vc(B(4.4, 1.7, 4.4), wood, T(0, 3.65, 0)));
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) p.push(vc(B(0.22, 1.7, 0.22), beam, T(x * 2.18, 3.65, z * 2.18)));
  p.push(vc(B(4.5, 0.18, 4.5), beam, T(0, 4.55, 0)));
  p.push(vc(Co(3.65, 2.6, 4), roof, T(0, 5.95, 0, 0, Math.PI / 4, 0)));
  p.push(vc(B(1.2, 1.6, 0.14), '#33241b', T(0, 1.4, 2.12)), vc(B(1.5, 0.22, 0.2), beam, T(0, 2.3, 2.14)));
  for (const x of [-1.2, 1.2]) p.push(vc(B(0.6, 0.55, 0.08), '#2b3640', T(x, 3.7, 2.22)), vc(B(0.08, 0.55, 0.1), beam, T(x, 3.7, 2.24)));
  for (const z of [-1.2, 1.2]) p.push(vc(B(0.08, 0.55, 0.6), '#2b3640', T(2.22, 3.7, z)));
  // corner turret
  p.push(vc(Cy(0.9, 1.0, 5.2, 10), stone, T(-2.0, 2.6, -2.0)), vc(Cy(1.05, 1.05, 0.22, 10), beam, T(-2.0, 5.25, -2.0)));
  p.push(vc(Co(1.3, 2.4, 10), roofDk, T(-2.0, 6.55, -2.0)));
  p.push(vc(B(0.18, 0.4, 0.06), '#33241b', T(-2.0, 3.9, -1.08)));
  p.push(vc(Cy(0.05, 0.05, 1.6, 6), '#5a3826', T(-2.0, 8.4, -2.0)), vc(B(0.9, 0.55, 0.05), '#d8262e', T(-1.55, 8.85, -2.0)), vc(S(0.09, 6, 5), '#f5b81c', T(-2.0, 9.22, -2.0)));
  return merge(p);
}
function anvilIcon(g) {
  g.fillStyle = '#fff'; g.strokeStyle = INK; g.lineWidth = 7;
  g.beginPath(); g.moveTo(-50, -26); g.lineTo(30, -26); g.quadraticCurveTo(52, -24, 54, -10); g.lineTo(20, -6); g.lineTo(12, 8); g.lineTo(26, 30); g.lineTo(-30, 30); g.lineTo(-18, 8); g.lineTo(-26, -6); g.lineTo(-44, -10); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.roundRect(-36, 30, 72, 14, 4); g.fill(); g.stroke();
}
// Cannons, levels 1..5: a static base and a turret (carriage and barrels) that turns
function cannonBaseGeo(lv) {
  const p = [];
  if (lv === 1) p.push(vc(Cy(1.25, 1.4, 0.8, 10), '#8d8d94', T(0, 0.4, 0)), vc(Cy(1.3, 1.3, 0.14, 10), '#a3a3aa', T(0, 0.82, 0)));
  else if (lv === 2) {
    p.push(vc(Cy(1.45, 1.6, 0.9, 12), '#8d8d94', T(0, 0.45, 0)), vc(Cy(1.52, 1.52, 0.14, 12), '#a3a3aa', T(0, 0.92, 0)));
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; p.push(vc(Cy(0.07, 0.09, 0.8, 5), C.stake, T(Math.sin(a) * 1.72, 0.35, Math.cos(a) * 1.72, Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25)), vc(Co(0.07, 0.18, 5), C.stakeTip, T(Math.sin(a) * 1.82, 0.82, Math.cos(a) * 1.82, Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25))); }
  } else {
    const stone = lv >= 5 ? '#9a958e' : '#a39e95';
    p.push(vc(Cy(1.75, 1.9, 1.3, 8), stone, T(0, 0.65, 0, 0, Math.PI / 8, 0)), vc(Cy(1.85, 1.85, 0.16, 8), '#858078', T(0, 1.34, 0, 0, Math.PI / 8, 0)));
    p.push(vc(Cy(1.92, 1.92, 0.1, 8), '#858078', T(0, 0.5, 0, 0, Math.PI / 8, 0)));
    p.push(...ringOf(8, 1.66, 1.62, 0.55, 0.45, 0.34, '#b4afa6'));
    if (lv >= 4) p.push(vc(B(0.7, 0.25, 0.5), '#858078', T(0, 0.12, 2.0)), vc(B(0.7, 0.25, 0.5), '#858078', T(0, 0.37, 1.75)));
    if (lv >= 5) { p.push(vc(Cy(1.96, 1.96, 0.12, 8), '#e0b13a', T(0, 1.0, 0, 0, Math.PI / 8, 0)), ...ringOf(8, 1.66, 1.88, 0.57, 0.08, 0.36, '#e0b13a'), ...flag(-1.4, 1.4, -1.4, '#2d5ccc', 2.4)); }
  }
  return merge(p);
}
function cannonTurretGeo(lv) {
  const p = [vc(B(1.0, 0.45, 1.2), lv >= 3 ? '#5b3d2b' : '#6b452d', T(0, 0.28, 0)),
    vc(Cy(0.32, 0.32, 0.1, 10), '#3d2a1e', T(-0.55, 0.23, 0.2, 0, 0, Math.PI / 2)), vc(Cy(0.32, 0.32, 0.1, 10), '#3d2a1e', T(0.55, 0.23, 0.2, 0, 0, Math.PI / 2))];
  const barrel = (x, r, len, hex, ring) => {
    p.push(vc(Cy(r * 0.78, r, len, 12), hex, T(x, 0.63, 0.45 + (len - 1.5) * 0.3, Math.PI / 2, 0, 0)), vc(Cy(r * 0.9, r * 0.9, 0.12, 12), ring, T(x, 0.63, 0.45 + len * 0.5 + (len - 1.5) * 0.3, Math.PI / 2, 0, 0)), vc(S(r, 10, 8), hex, T(x, 0.63, -0.3)));
    if (lv >= 3) p.push(vc(Cy(r * 1.02, r * 1.02, 0.1, 12), '#e0b13a', T(x, 0.63, 0.2, Math.PI / 2, 0, 0)));
  };
  if (lv === 1) barrel(0, 0.34, 1.5, '#2d2f36', '#4a4d55');
  else if (lv === 2) barrel(0, 0.36, 1.8, '#b07a2e', '#8a5a1e');
  else if (lv === 3) barrel(0, 0.38, 1.9, '#3a3d45', '#e0b13a');
  else if (lv === 4) { barrel(-0.3, 0.3, 1.9, '#3a3d45', '#e0b13a'); barrel(0.3, 0.3, 1.9, '#3a3d45', '#e0b13a'); }
  else { barrel(0, 0.46, 2.1, '#2a2c33', '#e0b13a'); p.push(vc(Cy(0.5, 0.5, 0.12, 12), '#e0b13a', T(0, 0.63, 0.75, Math.PI / 2, 0, 0))); }
  return merge(p);
}
// Barracks, levels 1..4, grow with the troop
function barracksGeo(lv) {
  const beam = '#7a5234', wood = '#5b3d2b', roofC = '#93624a', parts = [vc(B(4.0, 0.6, 3.4), '#8a8c8a', T(0, 0.3, 0))];
  if (lv <= 2) {
    parts.push(
      vc(B(3.6, 1.7, 3.0), wood, T(0, 1.45, 0)), vc(B(3.7, 0.16, 3.1), beam, T(0, 2.3, 0)),
      vc(gable(4.2, 2.0, 3.6), roofC, T(0, 2.35, 0, 0, Math.PI / 2, 0)),
      vc(B(0.9, 1.2, 0.08), '#33241b', T(0, 1.2, 1.52)),
      vc(B(0.6, 0.5, 0.08), '#2b3640', T(-1.15, 1.6, 1.52)), vc(B(0.6, 0.5, 0.08), '#2b3640', T(1.15, 1.6, 1.52)));
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) parts.push(vc(B(0.14, 1.7, 0.14), beam, T(x * 1.75, 1.45, z * 1.45)));
  } else {
    parts.push(
      vc(B(3.7, 1.5, 3.1), '#a39e95', T(0, 1.35, 0)), vc(B(3.75, 0.1, 3.15), '#858078', T(0, 1.0, 0)),
      vc(B(3.9, 0.18, 3.3), beam, T(0, 2.15, 0)), vc(B(3.8, 1.3, 3.2), wood, T(0, 2.85, 0)), vc(B(4.0, 0.18, 3.4), beam, T(0, 3.55, 0)),
      vc(gable(4.4, 2.2, 3.9), roofC, T(0, 3.6, 0, 0, Math.PI / 2, 0)),
      vc(B(1.0, 1.3, 0.08), '#33241b', T(0, 1.25, 1.57)), vc(B(1.3, 0.2, 0.16), beam, T(0, 2.0, 1.6)));
    for (const x of [-1.2, 0, 1.2]) parts.push(vc(B(0.55, 0.55, 0.08), '#2b3640', T(x, 2.9, 1.62)));
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) parts.push(vc(B(0.16, 1.3, 0.16), beam, T(x * 1.86, 2.85, z * 1.56)));
    parts.push(vc(B(0.7, 1.25, 0.05), '#2d5ccc', T(1.55, 2.55, 1.66)), vc(B(0.7, 1.25, 0.05), '#2d5ccc', T(-1.55, 2.55, 1.66)));
  }
  if (lv >= 2) {
    // chimney, a lean-to with a weapon rack and barrels
    const top = lv >= 3 ? 5.2 : 4.0;
    parts.push(vc(B(0.55, top - 1.2, 0.55), '#8a8580', T(1.15, 1.2 + (top - 1.2) / 2, -0.95)), vc(B(0.68, 0.14, 0.68), '#6f6a65', T(1.15, top, -0.95)));
    for (const z of [-1.1, 1.1]) parts.push(vc(Cy(0.07, 0.08, 1.6, 6), beam, T(2.75, 0.8, z)));
    parts.push(vc(B(1.1, 0.1, 2.7), roofC, T(2.4, 1.7, 0, 0, 0, -0.32)));
    parts.push(vc(B(0.1, 1.0, 1.9), beam, T(2.1, 0.75, 0)));
    for (let i = 0; i < 3; i++) parts.push(vc(new THREE.TorusGeometry(0.32, 0.03, 5, 12, Math.PI), '#8a5a2b', T(2.2, 0.8, -0.6 + i * 0.6, 0, Math.PI / 2, Math.PI / 2)));
    parts.push(vc(Cy(0.28, 0.32, 0.65, 10), '#7a4a26', T(-2.25, 0.32, 1.0)), vc(Cy(0.28, 0.32, 0.65, 10), '#7a4a26', T(-2.3, 0.32, 0.35)));
  }
  if (lv >= 4) {
    // a round watch tower on the side, with a pointed roof and a flag
    parts.push(vc(Cy(0.95, 1.05, 4.6, 12), '#a39e95', T(2.5, 2.3, -0.6)), vc(Cy(1.12, 1.12, 0.22, 12), beam, T(2.5, 4.65, -0.6)));
    parts.push(vc(Co(1.25, 1.9, 12), '#7c503b', T(2.5, 5.7, -0.6)), ...flag(2.5, 6.6, -0.6, '#2d5ccc', 1.4));
    parts.push(vc(B(0.2, 0.45, 0.06), '#33241b', T(2.5, 3.2, 0.42)));
  }
  return merge(parts);
}
// Forge, one level per weapon tier: an open-air anvil that grows into a gun factory
function forgeGeo(lv) {
  const wallC = lv >= 5 ? '#a4553a' : '#a39e95', roofC = lv >= 5 ? '#6d7480' : '#7c503b', p = [];
  p.push(vc(Cy(0.95, 1.05, 1.5, 8), '#6b6b70', T(0, 0.75, 0)), vc(Cy(1.08, 1.0, 0.22, 8), '#4f4f55', T(0, 1.55, 0)),
    vc(B(0.42, 0.32, 0.06), '#ff8a2a', T(0, 0.8, 1.0)),
    vc(B(0.5, 0.45, 0.4), '#5b5d63', T(1.7, 0.22, 0.6)), vc(B(0.95, 0.24, 0.45), '#6e7179', T(1.7, 0.57, 0.6)), vc(Co(0.22, 0.4, 4), '#6e7179', T(2.26, 0.57, 0.6, 0, 0, -Math.PI / 2)),
    vc(B(0.8, 0.08, 0.7), '#8a5a36', T(1.7, 0.02, 0.6)),
    vc(B(2.3, 0.12, 2.0), '#8a5a36', T(0.2, 0.06, -1.9)), vc(B(2.1, 0.06, 1.8), '#a46c43', T(0.2, 0.14, -1.9)));
  if (lv >= 1) {
    for (const [x, z, h] of [[-0.8, -1.0, 2.2], [1.2, -1.0, 2.2], [-0.8, -2.8, 2.7], [1.2, -2.8, 2.7]]) p.push(vc(Cy(0.09, 0.1, h, 6), '#5a3b28', T(x, h / 2, z)));
    if (lv < 4) p.push(vc(B(2.6, 0.12, 2.3), '#93624a', T(0.2, 2.45, -1.9, 0.22, 0, 0)));
    p.push(vc(Cy(0.32, 0.36, 0.75, 10), '#7a4a26', T(-1.45, 0.38, 0.5)), vc(Cy(0.37, 0.37, 0.06, 10), '#3a3a3e', T(-1.45, 0.2, 0.5)), vc(Cy(0.37, 0.37, 0.06, 10), '#3a3a3e', T(-1.45, 0.56, 0.5)));
    p.push(vc(B(1.6, 0.08, 0.08), '#7a5234', T(0.2, 1.25, -2.75)));
    for (let i = 0; i < 3; i++) p.push(vc(new THREE.TorusGeometry(0.3, 0.03, 5, 12, Math.PI), '#8a5a2b', T(-0.3 + i * 0.5, 1.0, -2.72, 0, 0, Math.PI / 2)));
  }
  if (lv >= 2) {
    p.push(vc(B(3.0, 2.1, 0.35), wallC, T(0.2, 1.05, -3.05)));
    p.push(vc(B(0.9, 0.4, 0.5), '#6b452d', T(-1.5, 0.2, -0.6)), vc(B(0.78, 0.05, 0.38), '#4a8fc0', T(-1.5, 0.41, -0.6)));
    for (const x of [-0.5, 0.9]) p.push(vc(B(0.7, 0.07, 0.08), '#5b3d2b', T(x, 1.6, -2.84)), vc(B(0.08, 0.07, 0.5), '#5b3d2b', T(x, 1.6, -2.84, Math.PI / 2, 0, 0)));
  }
  if (lv >= 3) {
    p.push(vc(B(0.9, 3.8, 0.9), lv >= 5 ? '#8f4a33' : '#8a8580', T(-1.2, 1.9, -2.7)), vc(B(1.05, 0.2, 1.05), '#6f6a65', T(-1.2, 3.85, -2.7)), vc(B(0.6, 0.05, 0.6), '#222', T(-1.2, 3.97, -2.7)));
    for (let i = 0; i < 4; i++) p.push(vc(Cy(0.03, 0.03, 1.9, 5), '#8a5a2b', T(1.55 + i * 0.22, 0.95, -2.55, -0.12, 0, 0)), vc(Co(0.06, 0.22, 5), '#d9dde3', T(1.55 + i * 0.22, 1.98, -2.67, -0.12, 0, 0)));
    p.push(vc(B(0.4, 0.35, 0.34), '#5b5d63', T(-0.4, 0.17, 1.35)), vc(B(0.75, 0.2, 0.38), '#6e7179', T(-0.4, 0.45, 1.35)));
  }
  if (lv >= 4) {
    p.push(vc(B(0.35, 2.1, 2.2), wallC, T(-1.4, 1.05, -2.05)));
    p.push(vc(gable(3.4, 1.3, 2.6), roofC, T(0.25, 2.1, -2.0)));
    p.push(vc(Cy(0.45, 0.45, 0.15, 14), '#9a9a9e', T(2.35, 0.6, -0.9, 0, 0, Math.PI / 2)), vc(B(0.12, 0.6, 0.12), '#6b452d', T(2.25, 0.3, -0.9)), vc(B(0.12, 0.6, 0.12), '#6b452d', T(2.45, 0.3, -0.9)));
  }
  if (lv >= 5) {
    for (const [x, y, z] of [[2.5, 0.3, -2.3], [2.5, 0.9, -2.3], [2.5, 0.3, -1.6], [-2.1, 0.3, -1.0]]) p.push(vc(B(0.6, 0.6, 0.6), '#a0703c', T(x, y, z)), vc(B(0.62, 0.06, 0.62), '#7a5230', T(x, y + 0.3, z)));
    for (let i = 0; i < 3; i++) p.push(vc(Cy(0.05, 0.05, 1.1, 6), '#2f3238', T(-0.4 + i * 0.4, 1.0, -2.82, 0.2, 0, 0)));
  }
  if (lv >= 6) {
    for (const [x, h] of [[-0.6, 5.2], [0.8, 4.4]]) { p.push(vc(Cy(0.3, 0.38, h, 12), '#8f4a33', T(x, h / 2, -3.45))); for (const y of [h * 0.35, h * 0.7, h - 0.1]) p.push(vc(Cy(0.36, 0.36, 0.12, 12), '#3a3a3e', T(x, y, -3.45))); }
    p.push(vc(Cy(0.62, 0.62, 0.14, 14), '#c9a43a', T(-1.6, 1.3, -1.6, 0, 0, Math.PI / 2)));
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; p.push(vc(B(0.14, 0.18, 0.18), '#c9a43a', T(-1.6, 1.3 + Math.sin(a) * 0.7, -1.6 + Math.cos(a) * 0.7, a, 0, 0))); }
    p.push(vc(Cy(0.18, 0.18, 0.18, 10), '#8a6a20', T(-1.62, 1.3, -1.6, 0, 0, Math.PI / 2)));
  }
  return merge(p);
}
function smithGeo() {
  return merge([
    vc(B(0.17, 0.28, 0.2), '#3a2a22', T(-0.12, 0.14, 0)), vc(B(0.17, 0.28, 0.2), '#3a2a22', T(0.12, 0.14, 0)),
    vc(Cy(0.27, 0.3, 0.6, 10), '#7a4a2e', T(0, 0.55, 0)), vc(Cy(0.075, 0.065, 0.34, 6), C.skin, T(-0.33, 0.62, 0.08, 0.5, 0, 0.3)), vc(Cy(0.075, 0.065, 0.34, 6), C.skin, T(0.33, 0.62, 0.08, 0.5, 0, -0.3)),
    vc(S(0.37, 14, 10), C.skin, T(0, 1.12, 0)), vc(S(0.4, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), '#c9c9cf', T(0, 1.14, -0.04)),
    vc(S(0.27, 10, 7, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), '#b9b9bf', T(0, 1.02, 0.08)),
    vc(B(0.06, 0.08, 0.04), '#1d1616', T(-0.13, 1.12, 0.35)), vc(B(0.06, 0.08, 0.04), '#1d1616', T(0.13, 1.12, 0.35)),
    vc(Cy(0.04, 0.04, 0.4, 5), '#6b3d1f', T(0.4, 0.75, 0.25, 0.6, 0, 0)), vc(B(0.2, 0.12, 0.12), '#4a4d55', T(0.4, 0.92, 0.38, 0.6, 0, 0)),
  ]);
}
// Gold boy hut, levels 1..3: thatched hut, plus a store shed, plus a vault
function goldHutGeo(lv) {
  const p = [vc(Cy(1.75, 1.85, 0.2, 16), '#a07a4a', T(0, 0.1, 0)), vc(Cy(1.35, 1.45, 1.7, 16), '#c79a5b', T(0, 1.05, 0)),
    vc(Cy(1.4, 1.4, 0.12, 16), '#8a6a3a', T(0, 0.45, 0)), vc(Cy(1.4, 1.4, 0.12, 16), '#8a6a3a', T(0, 1.8, 0)),
    vc(Co(2.05, 1.7, 16), '#d9b35c', T(0, 2.75, 0)), vc(Co(0.6, 0.5, 10), '#c49a40', T(0, 3.65, 0)),
    vc(B(0.65, 1.1, 0.1), '#4a3020', T(0, 0.75, 1.38)), vc(B(0.45, 0.4, 0.1), '#2b3640', T(-0.85, 1.25, 1.1, 0, -0.65, 0)),
    vc(Cy(0.05, 0.05, 1.9, 6), '#5a3826', T(1.65, 0.95, 1.0)), vc(Cy(0.45, 0.45, 0.1, 18), '#ffc83a', T(1.65, 2.05, 1.06, Math.PI / 2, 0, 0)), vc(Cy(0.32, 0.32, 0.12, 18), '#e09a14', T(1.65, 2.05, 1.07, Math.PI / 2, 0, 0))];
  if (lv >= 2) {
    p.push(vc(B(1.6, 1.2, 1.4), '#8a5a36', T(2.4, 0.6, -1.0)), vc(B(1.85, 0.12, 1.65), '#93624a', T(2.4, 1.3, -1.0, 0.2, 0, 0)));
    for (const [x, z] of [[1.1, 1.75], [1.55, 1.95], [0.7, 2.0]]) p.push(vc(S(0.28, 8, 6), '#c9a46a', T(x, 0.28, z, 0, 0, 0, 1, 1.1, 1)), vc(Cy(0.07, 0.11, 0.12, 6), '#8a6a3a', T(x, 0.6, z)));
  }
  if (lv >= 3) {
    p.push(vc(B(1.8, 1.6, 1.8), '#a39e95', T(-0.6, 0.8, -2.6)), vc(B(1.9, 0.14, 1.9), '#e0b13a', T(-0.6, 1.62, -2.6)));
    p.push(vc(S(0.9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#f5c33a', T(-0.6, 1.66, -2.6)), vc(S(0.14, 8, 6), '#ffe27a', T(-0.6, 2.62, -2.6)));
    p.push(vc(B(0.6, 0.95, 0.07), '#5a4a3a', T(-0.6, 0.55, -1.68)), vc(Cy(0.12, 0.12, 0.05, 10), '#e0b13a', T(-0.6, 0.6, -1.63, Math.PI / 2, 0, 0)));
    p.push(...flag(-1.6, 1.7, -3.3, '#f5c33a', 1.8));
  }
  return merge(p);
}
// the gold boy drops what he collects on this fenced plot
function plotGeo() {
  const p = [vc(B(4.6, 0.1, 4.6), '#7a5536', T(0, 0.05, 0))];
  for (let i = 0; i < 6; i++) p.push(vc(B(4.2, 0.06, 0.28), '#664429', T(0, 0.12, -1.85 + i * 0.74)));
  for (let i = 0; i <= 4; i++) { const v = -2.3 + i * 1.15; p.push(vc(Cy(0.07, 0.08, 0.75, 6), '#6b452d', T(v, 0.37, -2.3)), vc(Cy(0.07, 0.08, 0.75, 6), '#6b452d', T(-2.3, 0.37, v)), vc(Cy(0.07, 0.08, 0.75, 6), '#6b452d', T(2.3, 0.37, v))); }
  for (const y of [0.25, 0.55]) p.push(vc(B(4.7, 0.07, 0.07), '#8a5a36', T(0, y, -2.3)), vc(B(0.07, 0.07, 4.7), '#8a5a36', T(-2.3, y, 0)), vc(B(0.07, 0.07, 4.7), '#8a5a36', T(2.3, y, 0)));
  return merge(p);
}
function treeGeo(seed, wood = '#6b4630') {
  const R = mulberry(seed), p = [vc(Co(0.32, 4.2, 6), wood, T(0, 2.1, 0))];
  for (let i = 0; i < 4; i++) {
    const h = 1.6 + R() * 1.8, a = R() * Math.PI * 2, s = i % 2 ? 1 : -1;
    p.push(vc(Co(0.08, 1.1, 5), wood, T(Math.cos(a) * 0.3, h, Math.sin(a) * 0.3, Math.sin(a) * 0.9 * s, 0, Math.cos(a) * 0.9)));
  }
  return merge(p);
}
function barricadeGeo() {
  const p = [];
  for (let i = 0; i < 5; i++) p.push(vc(Cy(0.07, 0.09, 1.6, 5), '#5a3a28', T(i * 0.42 - 0.84, 0.55, 0, (i % 2 ? 0.6 : -0.6), 0, 0)), vc(Co(0.08, 0.2, 5), '#b98b62', T(i * 0.42 - 0.84, 0.55 + Math.cos(0.6) * 0.85, (i % 2 ? 1 : -1) * Math.sin(0.6) * 0.85, (i % 2 ? 0.6 : -0.6), 0, 0)));
  p.push(vc(Cy(0.07, 0.07, 2.2, 5), '#5a3a28', T(0, 0.5, 0, 0, 0, Math.PI / 2)));
  return merge(p);
}
// decor for the outer roads
const DECOR = {
  pine(R) { const p = [vc(Cy(0.15, 0.2, 1.0, 6), '#5a3d2a', T(0, 0.5, 0))]; [[1.3, 1.5, 1.4], [1.0, 1.25, 2.3], [0.7, 1.0, 3.05]].forEach(([r, h, y]) => { p.push(vc(Co(r, h, 8), '#2f5d4a', T(0, y, 0, 0, R() * 3, 0)), vc(Co(r * 0.72, h * 0.42, 8), '#f4f8fb', T(0, y + h * 0.3, 0))); }); return merge(p); },
  iceRock(R) { return merge([vc(new THREE.DodecahedronGeometry(0.9, 0), '#bfe0f0', T(0, 0.5, 0, R(), R(), R(), 1, 0.8, 1)), vc(new THREE.DodecahedronGeometry(0.55, 0), '#e3f3fb', T(0.8, 0.3, 0.3, R(), R(), R()))]); },
  drift(R) { return merge([vc(S(1.2, 12, 8), '#f2f7fa', T(0, 0, 0, 0, 0, 0, 1.3, 0.35, 1)), vc(S(0.7, 10, 6), '#ffffff', T(0.9, 0, 0.4, 0, 0, 0, 1, 0.4, 1))]); },
  swampTree(R) { const p = [vc(Co(0.38, 3.6, 7), '#4a3a2a', T(0, 1.8, 0))]; for (let i = 0; i < 4; i++) { const a = i * 1.7 + R(); p.push(vc(S(0.8 + R() * 0.3, 9, 7), i % 2 ? '#4c6b2a' : '#5b7d33', T(Math.cos(a) * 0.7, 2.8 + R() * 0.6, Math.sin(a) * 0.7, 0, 0, 0, 1, 0.7, 1)), vc(Cy(0.03, 0.03, 1.0, 4), '#6f8f3a', T(Math.cos(a) * 1.1, 2.2, Math.sin(a) * 1.1))); } return merge(p); },
  reeds(R) { const p = []; for (let i = 0; i < 8; i++) { const x = (R() - 0.5) * 1.2, z = (R() - 0.5) * 1.2, h = 1.0 + R() * 0.6, tx = (R() - 0.5) * 0.3; p.push(vc(Cy(0.03, 0.04, h, 4), '#7a8a3a', T(x, h / 2, z, tx, 0, tx)), vc(Cy(0.07, 0.07, 0.3, 6), '#6b4a2a', T(x + tx * h * 0.5, h + 0.05, z))); } return merge(p); },
  mushrooms(R) { const p = []; for (let i = 0; i < 4; i++) { const x = (R() - 0.5) * 1.4, z = (R() - 0.5) * 1.4, s = 0.6 + R() * 0.6; p.push(vc(Cy(0.08 * s, 0.1 * s, 0.4 * s, 6), '#efe6d6', T(x, 0.2 * s, z)), vc(S(0.3 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#d0643a', T(x, 0.38 * s, z)), vc(S(0.05 * s, 5, 4), '#ffffff', T(x + 0.12 * s, 0.6 * s, z + 0.08 * s))); } return merge(p); },
  log(R) { return merge([vc(Cy(0.3, 0.3, 2.4, 9), '#5a4632', T(0, 0.3, 0, 0, R() * 3, Math.PI / 2)), vc(Cy(0.31, 0.31, 0.04, 9), '#a08060', T(1.2, 0.3, 0, 0, 0, Math.PI / 2))]); },
  obsidian(R) { const p = []; for (let i = 0; i < 4; i++) { const a = R() * 6.28, h = 1.0 + R() * 1.4; p.push(vc(Co(0.32 + R() * 0.15, h, 5), i % 2 ? '#221f27' : '#35303d', T(Math.cos(a) * 0.4, h / 2 - 0.1, Math.sin(a) * 0.4, (R() - 0.5) * 0.6, 0, (R() - 0.5) * 0.6))); } return merge(p); },
  charred(R) { return treeGeo(Math.floor(R() * 99) + 7, '#2a2422'); },
  vent() { return merge([vc(Co(0.85, 0.9, 7), '#2a2628', T(0, 0.45, 0)), vc(Cy(0.26, 0.26, 0.06, 8), '#ff7a1a', T(0, 0.88, 0))]); },
};
// wall pieces per tier; each piece spans `step` along the segment (local x)
const WALL_PIECES = [
  { step: 0.44, geo: () => merge([vc(Cy(0.21, 0.23, 1.7, 7), C.stake, T(0, 0.85, 0)), vc(Co(0.21, 0.42, 7), C.stakeTip, T(0, 1.9, 0))]) },
  { step: 0.5, geo: () => merge([vc(Cy(0.25, 0.27, 2.0, 8), '#6a4229', T(0, 1.0, 0)), vc(Co(0.25, 0.45, 8), '#c99a6a', T(0, 2.22, 0)), vc(B(0.5, 0.16, 0.16), '#8a5a36', T(0, 0.55, 0.25)), vc(B(0.5, 0.16, 0.16), '#8a5a36', T(0, 1.45, 0.25)), vc(B(0.5, 0.16, 0.16), '#8a5a36', T(0, 0.55, -0.25)), vc(B(0.5, 0.16, 0.16), '#8a5a36', T(0, 1.45, -0.25))]) },
  { step: 1.0, geo: () => merge([vc(B(1.02, 1.8, 0.9), '#9a9aa2', T(0, 0.9, 0)), vc(B(0.46, 0.35, 0.92), '#a9a9b1', T(-0.25, 1.95, 0)), vc(B(1.03, 0.08, 0.92), '#85858d', T(0, 0.6, 0)), vc(B(1.03, 0.08, 0.92), '#85858d', T(0, 1.2, 0))]) },
  { step: 1.0, geo: () => merge([vc(B(1.02, 2.4, 1.1), '#7d7f88', T(0, 1.2, 0)), vc(B(0.45, 0.45, 1.12), '#8e909a', T(-0.26, 2.6, 0)), vc(B(1.03, 0.1, 1.12), '#6b6d75', T(0, 0.8, 0)), vc(B(1.03, 0.1, 1.12), '#6b6d75', T(0, 1.6, 0)), vc(B(0.3, 1.6, 0.25), '#6e7079', T(0, 0.8, 0.62))]) },
  { step: 1.0, geo: () => merge([vc(B(1.02, 2.6, 0.7), '#4f5868', T(0, 1.3, 0)), vc(B(1.03, 0.14, 0.74), '#2f3542', T(0, 0.5, 0)), vc(B(1.03, 0.14, 0.74), '#2f3542', T(0, 1.4, 0)), vc(B(1.03, 0.14, 0.74), '#2f3542', T(0, 2.3, 0)), vc(Co(0.12, 0.5, 4), '#c9ced8', T(-0.25, 2.85, 0)), vc(Co(0.12, 0.5, 4), '#c9ced8', T(0.25, 2.85, 0))]) },
];

// ------------------------------------------------------------- icon art ----
const INK = '#3b2a20';
function iconPath(g, draw, x, y, s) { g.save(); g.translate(x, y); g.scale(s, s); g.lineJoin = 'round'; g.lineCap = 'round'; draw(g); g.restore(); }
const ICONS = {
  coin(g) { g.fillStyle = '#ffc83a'; g.strokeStyle = '#b97a12'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = '#e09a14'; g.beginPath(); g.moveTo(-20, 14); g.lineTo(-22, -12); g.lineTo(-10, 0); g.lineTo(0, -18); g.lineTo(10, 0); g.lineTo(22, -12); g.lineTo(20, 14); g.closePath(); g.fill(); },
  bow(g) { g.strokeStyle = INK; g.lineWidth = 22; g.beginPath(); g.arc(-10, 0, 46, -1.2, 1.2); g.stroke(); g.beginPath(); g.moveTo(-44, -40); g.lineTo(52, 0); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 11; g.beginPath(); g.arc(-10, 0, 46, -1.2, 1.2); g.stroke(); g.lineWidth = 6; g.beginPath(); g.moveTo(7, -43); g.lineTo(7, 43); g.stroke(); g.beginPath(); g.moveTo(-44, -40); g.lineTo(52, 0); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(58, 2); g.lineTo(36, -14); g.lineTo(40, 8); g.closePath(); g.fill(); },
  person(g) { g.fillStyle = '#fff'; g.strokeStyle = INK; g.lineWidth = 7; g.beginPath(); g.arc(-8, -22, 22, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-46, 46); g.quadraticCurveTo(-44, 4, -8, 4); g.quadraticCurveTo(28, 4, 30, 46); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.arc(34, 30, 18, 0, Math.PI * 2); g.fill(); g.stroke(); g.lineWidth = 6; g.beginPath(); g.moveTo(27, 23); g.lineTo(41, 37); g.moveTo(41, 23); g.lineTo(27, 37); g.stroke(); },
  cannon(g) { g.fillStyle = '#fff'; g.strokeStyle = INK; g.lineWidth = 7; g.save(); g.rotate(-0.4); g.beginPath(); g.roundRect(-44, -16, 84, 32, 12); g.fill(); g.stroke(); g.restore(); g.beginPath(); g.arc(-12, 26, 18, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.arc(-12, 26, 5, 0, Math.PI * 2); g.fillStyle = INK; g.fill(); },
  tower(g) { g.fillStyle = '#fff'; g.strokeStyle = INK; g.lineWidth = 7;
    g.beginPath(); g.moveTo(-24, 46); g.lineTo(-20, -14); g.lineTo(-32, -14); g.lineTo(-32, -46); g.lineTo(-19, -46); g.lineTo(-19, -34); g.lineTo(-6, -34); g.lineTo(-6, -46); g.lineTo(6, -46); g.lineTo(6, -34); g.lineTo(19, -34); g.lineTo(19, -46); g.lineTo(32, -46); g.lineTo(32, -14); g.lineTo(20, -14); g.lineTo(24, 46); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.roundRect(-6, 2, 12, 22, 6); g.fill(); },
  goldboy(g) { g.fillStyle = '#fff'; g.strokeStyle = INK; g.lineWidth = 7; g.beginPath(); g.arc(-12, -22, 22, 0, Math.PI * 2); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-50, 46); g.quadraticCurveTo(-48, 4, -12, 4); g.quadraticCurveTo(24, 4, 26, 46); g.closePath(); g.fill(); g.stroke();
    iconPath(g, ICONS.coin, 30, 26, 0.5); },
  up(g) { g.fillStyle = '#7dff6a'; g.strokeStyle = INK; g.lineWidth = 6; g.beginPath(); g.moveTo(0, -30); g.lineTo(26, 0); g.lineTo(10, 0); g.lineTo(10, 28); g.lineTo(-10, 28); g.lineTo(-10, 0); g.lineTo(-26, 0); g.closePath(); g.fill(); g.stroke(); },
  weapon(g, tier) {
    g.fillStyle = '#fff'; g.strokeStyle = INK; g.lineWidth = 7;
    if (tier <= 1) { ICONS.bow(g); if (tier === 1) { g.fillStyle = '#7fd7ff'; for (const [x, y] of [[-30, -46], [-30, 46]]) { g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); } } return; }
    if (tier === 2) { g.save(); g.rotate(-0.6); g.beginPath(); g.roundRect(-10, -48, 20, 96, 6); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-48, -20); g.quadraticCurveTo(0, -46, 48, -20); g.lineTo(48, -10); g.quadraticCurveTo(0, -36, -48, -10); g.closePath(); g.fill(); g.stroke(); g.restore(); return; }
    if (tier === 3) { g.save(); g.rotate(-0.75); g.beginPath(); g.roundRect(-5, -30, 10, 82, 4); g.fill(); g.stroke(); g.beginPath(); g.moveTo(0, -60); g.lineTo(14, -28); g.lineTo(-14, -28); g.closePath(); g.fill(); g.stroke(); g.restore(); return; }
    if (tier === 4) { g.save(); g.rotate(-0.75); g.beginPath(); g.moveTo(0, -60); g.lineTo(10, -46); g.lineTo(10, 18); g.lineTo(-10, 18); g.lineTo(-10, -46); g.closePath(); g.fill(); g.stroke(); g.beginPath(); g.roundRect(-26, 18, 52, 10, 4); g.fill(); g.stroke(); g.beginPath(); g.roundRect(-6, 28, 12, 26, 4); g.fill(); g.stroke(); g.restore(); return; }
    if (tier === 5) { g.beginPath(); g.moveTo(-50, -10); g.lineTo(50, -10); g.lineTo(50, 4); g.lineTo(-6, 4); g.lineTo(-14, 34); g.lineTo(-34, 34); g.lineTo(-26, 4); g.lineTo(-50, 4); g.closePath(); g.fill(); g.stroke(); return; }
    g.beginPath(); g.roundRect(-46, -16, 70, 26, 6); g.fill(); g.stroke(); g.beginPath(); g.roundRect(24, -8, 30, 10, 3); g.fill(); g.stroke(); g.beginPath(); g.arc(-8, 22, 14, 0, 7); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-40, 10); g.lineTo(-48, 36); g.lineTo(-32, 36); g.lineTo(-28, 10); g.fill(); g.stroke();
  },
};

// =================================================================== game ====
let started = false, running = false, raf = 0;
let renderer, scene, camera, sun, canvas, ui = {};
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpE = new THREE.Euler(), tmpC = new THREE.Color();
const CAM_DIR = new THREE.Vector3(Math.SQRT1_2 * Math.cos(0.87), Math.sin(0.87), Math.SQRT1_2 * Math.cos(0.87)).normalize();
const SCR_R = { x: Math.SQRT1_2, z: -Math.SQRT1_2 }, SCR_U = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
let G = null;           // live game state
let world = null;       // static/shared scene objects
let fontReady = Promise.resolve();

function initRenderer() {
  canvas = document.getElementById('cd-canvas');
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
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  fontReady = document.fonts ? document.fonts.load('80px "Lilita One"').catch(() => {}) : Promise.resolve();
}

// worn trail bands, as on the sand
function strokeTrail(g, pts, k) {
  for (const [w, col, bl] of [[3.0 * k, 'rgba(222,190,148,0.55)', 0.35 * k], [2.3 * k, 'rgba(226,196,156,0.85)', 0.12 * k]]) {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.filter = `blur(${bl | 0}px)`;
    smoothLine(g, pts); g.stroke();
  }
  g.filter = 'none';
}
function smoothLine(g, t) {
  g.beginPath(); g.moveTo(t[0][0], t[0][1]);
  for (let i = 1; i < t.length - 1; i++) { const mx = (t[i][0] + t[i + 1][0]) / 2, my = (t[i][1] + t[i + 1][1]) / 2; g.quadraticCurveTo(t[i][0], t[i][1], mx, my); }
  g.lineTo(t[t.length - 1][0], t[t.length - 1][1]);
}

// ---------------------------------------------------------------- terrain ----
function buildTerrain() {
  const W = 240, X0 = 20, PX = 2048, k = PX / W;
  const toPx = (x, z) => [(x - X0 + W / 2) * k, (z + W / 2) * k];
  const R = mulberry(11);
  const tex = canvasTex(PX, PX, (g) => {
    g.fillStyle = C.sand; g.fillRect(0, 0, PX, PX);
    // darker and lighter sand patches
    for (let i = 0; i < 170; i++) {
      const [x, y] = [R() * PX, R() * PX], r = 30 + R() * 120;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const c = R() < 0.5 ? 'rgba(170,125,80,0.16)' : 'rgba(225,190,140,0.14)';
      gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // the three first roads plus a few cross trails; the outer roads are drawn when they open
    const trails = PATHS.slice(0, 3).map(p => p.map(([x, z]) => toPx(x, z)));
    trails.push([[-12, 30], [-4, 22], [6, 26], [20, 34], [34, 48]].map(([x, z]) => toPx(x, z)));
    trails.push([[20, -46], [26, -30], [40, -20], [62, -18]].map(([x, z]) => toPx(x, z)));
    trails.push([[22, 4], [30, 14], [34, 26], [46, 40]].map(([x, z]) => toPx(x, z)));
    trails.push([[-14, -30], [-6, -22], [0, -30], [8, -36], [16, -50]].map(([x, z]) => toPx(x, z)));
    for (const t of trails) strokeTrail(g, t, k);
    // fine grain
    for (let i = 0; i < 11000; i++) { g.fillStyle = R() < 0.5 ? 'rgba(120,80,40,0.05)' : 'rgba(255,240,210,0.05)'; g.fillRect(R() * PX, R() * PX, 3, 3); }
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, W), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2; ground.position.x = X0; ground.receiveShadow = true;
  scene.add(ground);

  // canyon cliffs on the west, light tops and dark faces
  const cliffMat = [new THREE.MeshLambertMaterial({ color: C.cliffTop }), new THREE.MeshLambertMaterial({ color: C.cliffSide })];
  // a flat top plus vertical walls along every edge; every triangle is wound to face outward
  const addCliff = (pts, h, y0 = 0) => {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const tri = (out, a, b, c, want) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) [b, c] = [c, b];
      out.push(...a, ...b, ...c);
    };
    const top = [], side = [], y1 = y0 + h;
    const idx = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [i, j, k] of idx) tri(top, [pts[i][0], y1, pts[i][1]], [pts[j][0], y1, pts[j][1]], [pts[k][0], y1, pts[k][1]], [0, 1, 0]);
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
      const out = [(x0 + x1) / 2 - cx, 0, (z0 + z1) / 2 - cz];
      tri(side, [x0, y0, z0], [x1, y0, z1], [x1, y1, z1], out);
      tri(side, [x0, y0, z0], [x1, y1, z1], [x0, y1, z0], out);
    }
    for (const [arr, m] of [[top, cliffMat[0]], [side, cliffMat[1]]]) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
    }
  };
  const edge = [];
  for (let z = -119; z <= 119; z += 4) edge.push([-17.6 - 0.9 * Math.sin(z * 0.21) - 0.7 * Math.sin(z * 0.53) - (Math.abs(z) > 24 ? (Math.abs(z) - 24) * 0.35 : 0) - (Math.abs(z % 16) < 4 ? 1.5 : 0), z]);
  addCliff([[-110, -119], ...edge, [-110, 119]], 3.2);
  const edge2 = edge.map(([x, z]) => [x - 9 - 2 * Math.sin(z * 0.4) + (Math.abs((z + 8) % 20) < 6 ? 2.5 : 0), z]);
  addCliff([[-110, -119], ...edge2, [-110, 119]], 2.4, 3.2);
  // a few mesas in the north-west and south-west corners
  addCliff([[-24, -42], [-10, -46], [-4, -56], [-16, -66], [-30, -58]], 4.2);
  addCliff([[-24, 44], [-10, 48], [-6, 60], [-20, 68], [-30, 58]], 4.2);

  // dead trees, rocks and broken barricades
  const deco = new THREE.MeshLambertMaterial({ vertexColors: true });
  const add = (geo, x, z, ry = 0, s = 1) => { const m = new THREE.Mesh(geo, deco); m.position.set(x, 0, z); m.rotation.y = ry; m.scale.setScalar(s); m.castShadow = true; scene.add(m); };
  const trees = [treeGeo(1), treeGeo(2), treeGeo(3)];
  [[30, 16], [18, -34], [42, -34], [16, 37], [-12, 24], [44, 20], [10, -30], [34, 44], [26, 42], [36, -12]].forEach(([x, z], i) => add(trees[i % 3], x, z, i, 1 + (i % 3) * 0.12));
  const rock = vc(new THREE.DodecahedronGeometry(0.7, 0), '#9a9a9e');
  [[28, -20, 1], [29.5, -19, 0.6], [-12, 19, 0.8], [38, 4, 1.1], [12, 25, 0.7], [-15.5, -17, 0.9], [20, -38, 1.2]].forEach(([x, z, s]) => add(rock, x, z, x, s));
  const bar = barricadeGeo();
  [[19, -18, 0.4], [30, 4, -0.5], [17, 17, 0.9], [-12, -18, -0.3], [33, -15, 1.2], [8, 28, 0.2], [-8, 24, 1.4]].forEach(([x, z, r]) => add(bar, x, z, r));
}

// ------------------------------------------------------------ outer roads ----
// Each outer road has its own ground (snow, bog, ash), decor and enemies. All of
// it is hidden until the road opens.
const segDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz; const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0; return Math.hypot(px - ax - t * dx, pz - az - t * dz); };
const pathDist = (x, z, path) => { let d = 1e9; for (let i = 0; i < path.length - 1; i++) d = Math.min(d, segDist(x, z, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1])); return d; };
function buildThemes() {
  const W = world;
  W.themes = [null];
  const looks = [null,
    { base: '#e9f0f5', a: 'rgba(160,190,218,0.32)', b: 'rgba(255,255,255,0.7)', road: '#c6d3de', road2: '#d6e0e9', dust: '#ffffff',
      decor: [['pine', 0.5], ['iceRock', 0.3], ['drift', 0.2]] },
    { base: '#62743a', a: 'rgba(52,72,30,0.5)', b: 'rgba(132,156,72,0.4)', road: '#6b5537', road2: '#7d6443', dust: '#9ab05a',
      decor: [['swampTree', 0.35], ['reeds', 0.35], ['mushrooms', 0.15], ['log', 0.15]] },
    { base: '#3e393a', a: 'rgba(22,19,21,0.55)', b: 'rgba(96,88,84,0.4)', road: '#5e5653', road2: '#6c6460', dust: '#5a5050',
      decor: [['obsidian', 0.42], ['charred', 0.22], ['lava', 0.18], ['vent', 0.18]] }];
  const lavaMat = new THREE.MeshBasicMaterial({ map: W.lavaTex });
  for (let i = 1; i < THEMES.length; i++) {
    const th = THEMES[i], L = looks[i], S = th.size, PX = 1024, k = PX / S, [cx, cz] = th.center;
    const road = PATHS[th.path].slice(0, 5);  // the new part, up to where it joins an old road
    const toPx = (x, z) => [(x - cx + S / 2) * k, (z - cz + S / 2) * k];
    // the themed ground sits toward the far end of the road
    const sx = road[0][0] - road[4][0], sz = road[0][1] - road[4][1], sl = Math.hypot(sx, sz);
    const bx = cx + sx / sl * 4, bz = cz + sz / sl * 4;
    const R = mulberry(40 + i);
    const mask = document.createElement('canvas'); mask.width = mask.height = PX;
    const tex = canvasTex(PX, PX, (g) => {
      const rpx = road.map(([x, z]) => toPx(x, z));
      strokeTrail(g, rpx, k);
      // blob mask
      const m = mask.getContext('2d'), [mx, my] = toPx(bx, bz);
      for (let j = 0; j < 80; j++) {
        const a = R() * Math.PI * 2, d = R() * 0.24 * PX, x = mx + Math.cos(a) * d, y = my + Math.sin(a) * d, r = (0.12 + R() * 0.1) * PX;
        const gr = m.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        m.fillStyle = gr; m.fillRect(x - r, y - r, r * 2, r * 2);
      }
      m.globalCompositeOperation = 'source-in'; m.fillStyle = L.base; m.fillRect(0, 0, PX, PX);
      m.globalCompositeOperation = 'source-atop';
      for (let j = 0; j < 60; j++) { const x = R() * PX, y = R() * PX, r = 20 + R() * 70; const gr = m.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, R() < 0.5 ? L.a : L.b); gr.addColorStop(1, 'rgba(0,0,0,0)'); m.fillStyle = gr; m.fillRect(x - r, y - r, r * 2, r * 2); }
      if (i === 2) for (let j = 0; j < 26; j++) { const x = R() * PX, y = R() * PX, rx = 18 + R() * 40, ry = rx * (0.4 + R() * 0.3); m.fillStyle = '#6f8a6a'; m.beginPath(); m.ellipse(x, y, rx + 5, ry + 4, R(), 0, 7); m.fill(); m.fillStyle = '#2f4a40'; m.beginPath(); m.ellipse(x, y, rx, ry, R(), 0, 7); m.fill(); }
      if (i === 3) { m.lineCap = 'round'; for (let j = 0; j < 40; j++) { let x = R() * PX, y = R() * PX; m.strokeStyle = '#ff6a1a'; m.lineWidth = 2 + R() * 3; m.shadowColor = '#ff8a2a'; m.shadowBlur = 8; m.beginPath(); m.moveTo(x, y); for (let s = 0; s < 5; s++) { x += (R() - 0.5) * 60; y += (R() - 0.5) * 60; m.lineTo(x, y); } m.stroke(); } m.shadowBlur = 0; }
      for (let j = 0; j < 5000; j++) { m.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)'; m.fillRect(R() * PX, R() * PX, 3, 3); }
      // the road across the themed ground
      for (const [w, col] of [[2.8 * k, L.road], [2.0 * k, L.road2]]) { m.strokeStyle = col; m.lineWidth = w; m.lineCap = 'round'; m.lineJoin = 'round'; smoothLine(m, rpx); m.stroke(); }
      g.drawImage(mask, 0, 0);
    });
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
    overlay.rotation.x = -Math.PI / 2; overlay.position.set(cx, 0.035, cz); overlay.receiveShadow = true; overlay.visible = false;
    scene.add(overlay);
    // decor scattered over the themed ground, off the road
    const alpha = mask.getContext('2d').getImageData(0, 0, PX, PX).data;
    const onGround = (x, z) => { const [u, v] = toPx(x, z); if (u < 0 || v < 0 || u >= PX || v >= PX) return false; return alpha[((v | 0) * PX + (u | 0)) * 4 + 3] > 215; };
    const group = new THREE.Group(); group.visible = false; scene.add(group);
    const items = [], vents = [], geos = {};
    const total = L.decor.reduce((s, d) => s + d[1], 0);
    for (let n = 0, tries = 0; n < 30 && tries < 900; tries++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * S * 0.42, x = bx + Math.cos(a) * d, z = bz + Math.sin(a) * d;
      if (!onGround(x, z) || pathDist(x, z, road) < 3.4 || PATHS.slice(0, 3).some(p => pathDist(x, z, p) < 3.4)) continue;
      if (items.some(it => Math.hypot(it.position.x - x, it.position.z - z) < 2.6)) continue;
      let r = R() * total, kind = L.decor[0][0];
      for (const [nm, w] of L.decor) { if ((r -= w) <= 0) { kind = nm; break; } }
      let mesh;
      if (kind === 'lava') { mesh = new THREE.Group(); const pool = new THREE.Mesh(new THREE.CylinderGeometry(1.1 + R() * 0.5, 1.1, 0.05, 16), lavaMat); pool.position.y = 0.04; mesh.add(pool); const rim = new THREE.Mesh(geos.obsidian || (geos.obsidian = DECOR.obsidian(mulberry(9))), W.vmat); rim.position.set(1.2, 0, 0.3); rim.scale.setScalar(0.5); mesh.add(rim); }
      else { const key = kind + (n % 3); if (!geos[key]) geos[key] = DECOR[kind](mulberry(100 * i + n)); mesh = new THREE.Mesh(geos[key], W.vmat); mesh.castShadow = true; }
      mesh.position.set(x, 0, z); mesh.rotation.y = R() * 6.28;
      mesh.userData.s = 0.85 + R() * 0.4; mesh.userData.delay = 0.2 + Math.hypot(x - road[0][0], z - road[0][1]) * 0.02 + R() * 0.3;
      mesh.scale.setScalar(0.001);
      group.add(mesh); items.push(mesh); n++;
      if (kind === 'vent') vents.push([x, z]);
    }
    W.themes.push({ overlay, group, items, vents, revealT: -1, road, dust: L.dust, ventT: 0 });
  }
}
function resetThemes() {
  for (let i = 1; i < world.themes.length; i++) {
    const t = world.themes[i];
    t.revealT = -1; t.overlay.visible = false; t.overlay.material.opacity = 0; t.group.visible = false;
    for (const it of t.items) it.scale.setScalar(0.001);
  }
}

// ------------------------------------------------------------ instancing ----
function inst(geo, mat, n, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.userData.cap = n;
  scene.add(m);
  return m;
}
function buildWorld() {
  const vmat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const ghostMat = new THREE.MeshLambertMaterial({ color: '#6fe05a', transparent: true, opacity: 0.55, emissive: '#2a8a20', depthWrite: false });
  const coinTex = canvasTex(128, 128, (g) => { g.fillStyle = '#ffc83a'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#d99a16'; g.lineWidth = 10; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke(); iconPath(g, ICONS.coin, 64, 64, 0.95); });
  const coinMats = [new THREE.MeshLambertMaterial({ color: '#e7a61c' }), new THREE.MeshLambertMaterial({ map: coinTex }), new THREE.MeshLambertMaterial({ map: coinTex })];
  const W = {
    vmat,
    follower: inst(followerGeo(), vmat, 180),
    followerR: RANKS.slice(1).map(r => inst(followerGeo(C.hair, r.top), vmat, SQUAD_MAX)),
    weapons: [0, 1, 2, 3, 4, 5, 6].map(t => inst(weaponGeo(t), vmat, 160)),
    ghost: inst(followerGeo(), ghostMat, 8, false),
    coin: inst(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 18), coinMats, 1900),
    boy: inst(goldBoyGeo(), vmat, 4),
    sack: inst(sackGeo(), vmat, 4),
    shadow: null,
  };
  // enemies: one mesh per size, variant and road theme
  W.emesh = {};
  for (let t = 0; t < PAL.length; t++) {
    const P = PAL[t], big = t === 0;
    W.emesh['knight' + t] = inst(knightGeo(false, P.knight), vmat, big ? 420 : 200);
    W.emesh['knightS' + t] = inst(knightGeo(true, P.knight), vmat, big ? 260 : 120);
    W.emesh['brute' + t] = inst(bruteGeo(P.brute), vmat, big ? 180 : 110);
    W.emesh['giant' + t] = inst(giantGeo(P.giants[0]), vmat, 50);
    if (P.giants[1]) W.emesh['giantR' + t] = inst(giantGeo(P.giants[1]), vmat, 50);
  }
  W.ekeys = Object.keys(W.emesh);
  // blob shadows under units (cheap ground contact)
  const blobTex = canvasTex(64, 64, (g, w) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(70,40,20,0.45)'); gr.addColorStop(1, 'rgba(70,40,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  const sg = new THREE.PlaneGeometry(1, 1); sg.rotateX(-Math.PI / 2);
  W.shadow = inst(sg, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }), 1200, false);
  W.shadow.renderOrder = 1;
  // projectiles
  const glow = (hex) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.95 });
  const streak = new THREE.BoxGeometry(0.07, 0.07, 1.7); streak.translate(0, 0, -0.85);
  W.proj = {
    arrow: inst(streak, glow('#dff1ff'), 600, false),
    arrow2: inst(new THREE.BoxGeometry(0.1, 0.1, 2.0).translate(0, 0, -1.0), glow('#8fdcff'), 600, false),
    bolt: inst(new THREE.BoxGeometry(0.09, 0.09, 1.0).translate(0, 0, -0.5), glow('#e9eef6'), 600, false),
    spear: inst(merge([vc(Cy(0.04, 0.04, 1.8, 5), '#8a5a2b', T(0, 0, -0.9, Math.PI / 2, 0, 0)), vc(Co(0.08, 0.3, 5), '#e3e7ee', T(0, 0, 0.1, Math.PI / 2, 0, 0))]), vmat, 300, false),
    bullet: inst(new THREE.BoxGeometry(0.06, 0.06, 1.4).translate(0, 0, -0.7), glow('#ffe36a'), 900, false),
    ball: inst(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshLambertMaterial({ color: '#25262b' }), 60),
  };
  // health bars (billboards)
  const bg = new THREE.PlaneGeometry(1, 1);
  W.barBg = inst(bg, new THREE.MeshBasicMaterial({ color: '#2a2526', depthTest: false, transparent: true }), 700, false);
  W.barFill = inst(bg, new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true }), 700, false);
  W.barBg.renderOrder = 10; W.barFill.renderOrder = 11;
  W.barFill.setColorAt(0, new THREE.Color()); W.barFill.instanceColor.setUsage(THREE.DynamicDrawUsage);
  // chevron guide
  const ch = new THREE.Shape(); ch.moveTo(-0.5, -0.15); ch.lineTo(0, 0.25); ch.lineTo(0.5, -0.15); ch.lineTo(0.5, -0.4); ch.lineTo(0, 0); ch.lineTo(-0.5, -0.4); ch.closePath();
  const chg = new THREE.ShapeGeometry(ch); chg.rotateX(-Math.PI / 2);
  W.chev = inst(chg, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }), 30, false);
  W.chev.setColorAt(0, new THREE.Color()); W.chev.renderOrder = 2;
  // sparks / explosions / smoke / upgrade rings and light pillars
  const sparkTex = canvasTex(64, 64, (g) => { g.translate(32, 32); for (let i = 0; i < 8; i++) { g.rotate(Math.PI / 4); g.fillStyle = i % 2 ? 'rgba(170,220,255,0.9)' : 'rgba(255,255,255,1)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(3, -4); g.lineTo(0, i % 2 ? -18 : -30); g.lineTo(-3, -4); g.fill(); } const gr = g.createRadialGradient(0, 0, 0, 0, 0, 14); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(120,190,255,0)'); g.fillStyle = gr; g.fillRect(-14, -14, 28, 28); });
  const puffTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  W.sparkMat = new THREE.SpriteMaterial({ map: sparkTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  W.puffTex = puffTex;
  W.fx = [];
  W.ringGeo = new THREE.RingGeometry(0.86, 1, 64);
  const pillarTex = canvasTex(8, 128, (g) => { const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); g.fillStyle = gr; g.fillRect(0, 0, 8, 128); });
  W.pillarTex = pillarTex;
  W.pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
  // king
  W.king = new THREE.Group();
  const kb = new THREE.Mesh(kingGeo(), vmat); kb.castShadow = true; W.king.add(kb);
  W.kingWeapon = new THREE.Group(); W.king.add(W.kingWeapon);
  scene.add(W.king);
  W.ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 72), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }));
  W.ring.rotation.x = -Math.PI / 2; W.ring.renderOrder = 3; scene.add(W.ring);
  // the castle and the ground patches under buildings (the worn sand halos in the screenshots)
  const addStatic = (geo, x, z, ry = 0, mat = vmat) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, 0, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
  W.castle = addStatic(castleGeo(), CASTLE.x, CASTLE.z, Math.PI / 4);
  W.emblem = canvasTex(256, 256, (g) => { g.fillStyle = '#6b452d'; g.beginPath(); g.moveTo(128, 30); g.lineTo(236, 226); g.lineTo(20, 226); g.closePath(); g.fill(); iconPath(g, (c) => { c.strokeStyle = '#2f80c9'; c.lineWidth = 14; c.beginPath(); c.arc(-10, 0, 46, -1.2, 1.2); c.stroke(); c.strokeStyle = '#e0ecf4'; c.lineWidth = 6; c.beginPath(); c.moveTo(7, -43); c.lineTo(7, 43); c.stroke(); c.lineWidth = 8; c.beginPath(); c.moveTo(-50, 30); c.lineTo(52, -26); c.stroke(); c.fillStyle = '#e0ecf4'; c.beginPath(); c.moveTo(60, -30); c.lineTo(36, -30); c.lineTo(48, -10); c.fill(); }, 128, 160, 0.9); });
  W.emblemMat = new THREE.MeshLambertMaterial({ map: W.emblem, transparent: true });
  const lavaTex = canvasTex(128, 128, (g) => { g.fillStyle = '#e8320c'; g.fillRect(0, 0, 128, 128); const r = mulberry(5); for (let i = 0; i < 16; i++) { g.fillStyle = i % 3 ? '#ffd21a' : '#ff8a12'; g.beginPath(); g.ellipse(r() * 128, r() * 128, 8 + r() * 20, 5 + r() * 12, r() * 3, 0, 7); g.fill(); } });
  lavaTex.wrapS = lavaTex.wrapT = THREE.RepeatWrapping; W.lavaTex = lavaTex;
  W.lavaMat = new THREE.MeshBasicMaterial({ map: lavaTex });
  W.smithGeo = smithGeo();
  const halo = canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64); gr.addColorStop(0, 'rgba(232,203,163,0.95)'); gr.addColorStop(0.7, 'rgba(232,203,163,0.7)'); gr.addColorStop(1, 'rgba(232,203,163,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
  W.haloMat = new THREE.MeshBasicMaterial({ map: halo, transparent: true, depthWrite: false });
  W.haloGeo = new THREE.PlaneGeometry(1, 1);
  W.halos = [[BARRACKS[0], BARRACKS[1], 8], [CASTLE.x, CASTLE.z, 9.5]].map(([x, z, s]) => { const h = new THREE.Mesh(W.haloGeo, W.haloMat); h.scale.setScalar(s); h.rotation.x = -Math.PI / 2; h.position.set(x, 0.04, z); h.renderOrder = 1; scene.add(h); return h; });
  // grass inside the walls, grown when the first tower goes up
  const grassTex = canvasTex(1024, 1024, (g) => { g.fillStyle = C.grass; g.fillRect(0, 0, 1024, 1024); const r = mulberry(9); for (let i = 0; i < 90; i++) { const x = r() * 1024, y = r() * 1024, rr = 60 + r() * 160; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, r() < 0.5 ? 'rgba(74,146,100,0.22)' : 'rgba(110,186,132,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); } for (let i = 0; i < 6000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(40,100,60,0.06)' : 'rgba(150,220,170,0.05)'; g.fillRect(r() * 1024, r() * 1024, 3, 3); } });
  const gs = new THREE.Shape(); const gp = [];
  for (let i = 0; i < 64; i++) { const t = i / 64; let x, z; if (t < 0.25) { x = -HX - 0.6 + (2 * HX + 1.2) * (t / 0.25); z = -HZ - 0.6; } else if (t < 0.5) { x = HX + 0.6; z = -HZ - 0.6 + (2 * HZ + 1.2) * ((t - 0.25) / 0.25); } else if (t < 0.75) { x = HX + 0.6 - (2 * HX + 1.2) * ((t - 0.5) / 0.25); z = HZ + 0.6; } else { x = -HX - 0.6; z = HZ + 0.6 - (2 * HZ + 1.2) * ((t - 0.75) / 0.25); } gp.push(new THREE.Vector2(x + Math.sin(i * 2.1) * 0.25, -(z + Math.cos(i * 1.7) * 0.25))); }
  gs.setFromPoints(gp);
  const ggeo = new THREE.ShapeGeometry(gs); ggeo.rotateX(-Math.PI / 2);
  const uv = ggeo.attributes.uv, pp = ggeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) / 32 + 0.5, pp.getZ(i) / 32 + 0.5);
  W.grass = new THREE.Mesh(ggeo, new THREE.MeshLambertMaterial({ map: grassTex })); W.grass.position.y = 0.03; W.grass.receiveShadow = true; W.grass.visible = false; scene.add(W.grass);
  // walls: one instanced mesh per tier piece
  W.wallMeshes = WALL_PIECES.map(p => { const m = inst(p.geo(), vmat, 400); m.receiveShadow = true; return m; });
  // a gate in each side: frame plus two doors that swing inward for the king
  const gateGeo = merge([vc(B(0.3, 3.0, 0.3), '#5a3826', T(0, 1.5, 0)), vc(B(0.2, 0.3, 4.4), '#7a5234', T(0, 2.9, 2.0)), vc(B(0.3, 3.0, 0.3), '#5a3826', T(0, 1.5, 4.0))]);
  const doorGeo = merge([...[0, 1, 2, 3].map(i => vc(B(0.16, 2.1, 0.46), i % 2 ? '#b68457' : '#c4925f', T(0, 1.05, 0.25 + i * 0.47))), vc(B(0.2, 0.18, 1.9), '#7a5234', T(0, 0.6, 0.95)), vc(B(0.2, 0.18, 1.9), '#7a5234', T(0, 1.6, 0.95))]);
  W.gates = GATES.map((gt) => {
    const group = new THREE.Group(), ns = gt.side === 'N' || gt.side === 'S';
    group.position.set(ns ? gt.lo : (gt.side === 'E' ? HX : -HX), 0, ns ? (gt.side === 'S' ? HZ : -HZ) : gt.lo);
    group.rotation.y = ns ? Math.PI / 2 : 0;
    const frame = new THREE.Mesh(gateGeo, vmat); frame.castShadow = true; group.add(frame);
    const a = new THREE.Mesh(doorGeo, vmat), b = new THREE.Mesh(doorGeo, vmat);
    a.position.z = 0.1; b.position.z = 3.9; b.scale.z = -1; a.castShadow = b.castShadow = true; group.add(a, b);
    group.visible = false; scene.add(group);
    const cx = ns ? (gt.lo + gt.hi) / 2 : group.position.x, cz = ns ? group.position.z : (gt.lo + gt.hi) / 2;
    return { group, a, b, sgn: gt.side === 'E' || gt.side === 'N' ? 1 : -1, x: cx, z: cz, open: 0 };
  });
  // damage number sprites
  W.textCache = new Map();
  world = W;
  buildThemes();
}

// ------------------------------------------------------------------- pads ----
function makePadTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function drawPad(p) {
  const cv = p.tex.image, g = cv.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  const pad = 18, s = 256 - pad * 2, r = 30;
  g.save(); g.beginPath(); g.roundRect(pad, pad, s, s, r); g.clip();
  g.fillStyle = 'rgba(70,45,25,0.22)'; g.fillRect(0, 0, 256, 256);
  const frac = p.cost > 0 ? Math.min(1, p.paid / p.cost) : 0;
  if (frac > 0) { g.fillStyle = '#22d81c'; g.fillRect(pad, pad, s * frac, s); }
  g.restore();
  // dashed outline with solid corner brackets
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 9; g.lineCap = 'round';
  g.setLineDash([22, 24]); g.lineDashOffset = 0;
  g.beginPath(); g.roundRect(pad + 4, pad + 4, s - 8, s - 8, r - 4); g.stroke();
  g.setLineDash([]);
  const L = 46, a = pad + 4, b = 256 - pad - 4;
  g.beginPath();
  for (const [x, y, dx, dy] of [[a, a, 1, 1], [b, a, -1, 1], [a, b, 1, -1], [b, b, -1, -1]]) { g.moveTo(x, y + dy * L); g.lineTo(x, y + dy * (r - 6)); g.quadraticCurveTo(x, y, x + dx * (r - 6), y); g.lineTo(x + dx * L, y); }
  g.stroke();
  // icon
  const icon = p.iconFn ? p.iconFn() : p.icon;
  if (icon) iconPath(g, (c) => icon(c), 128, p.showCost ? 92 : 128, p.showCost ? 0.8 : 1.05);
  if (p.showCost) {
    const remaining = Math.max(0, Math.ceil(p.cost - p.paid));
    iconPath(g, ICONS.coin, 78, 186, 0.48);
    g.font = '64px "Lilita One", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 12; g.strokeStyle = INK; g.strokeText(String(remaining), 106, 190);
    g.fillStyle = '#fff'; g.fillText(String(remaining), 106, 190);
  }
  p.tex.needsUpdate = true;
}
function createPad(def) {
  const p = Object.assign({ paid: 0, showCost: true, visibleNow: false, mesh: null, key: '' }, def);
  p.price = def.cost; p.cost = 0;
  p.tex = makePadTexture();
  p.mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ map: p.tex, transparent: true, depthWrite: false }));
  p.mesh.rotation.x = -Math.PI / 2; p.mesh.position.set(p.x, 0.06, p.z); p.mesh.renderOrder = 2; p.mesh.visible = false;
  scene.add(p.mesh);
  return p;
}

// -------------------------------------------------------------- buildings ----
// Every building is a group with one body mesh whose geometry is swapped per
// level. Building rises out of the ground; upgrading squashes the old model,
// swaps it and pops the new one up.
const geoCache = new Map();
function geoFor(fn, lv) { const key = fn.name + ':' + lv; let g = geoCache.get(key); if (!g) geoCache.set(key, g = fn(lv)); return g; }
const easeOutBack = (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
const easeOut = (k) => 1 - (1 - k) * (1 - k);
function makeBuilding(x, z, yaw, fn, lv, halo = 0, h = 3) {
  const group = new THREE.Group(); group.position.set(x, 0, z);
  const body = new THREE.Mesh(geoFor(fn, lv), world.vmat); body.rotation.y = yaw; body.castShadow = true; body.receiveShadow = true;
  body.scale.set(1.15, 0.01, 1.15); group.add(body);
  if (halo) { const hm = new THREE.Mesh(world.haloGeo, world.haloMat); hm.rotation.x = -Math.PI / 2; hm.position.y = 0.04; hm.scale.setScalar(halo); hm.renderOrder = 1; group.add(hm); }
  scene.add(group); G.dispose.push(group);
  const b = { x, z, fn, lv, group, body, t: 0, mode: 'build', h };
  G.buildings.push(b);
  return b;
}
function upgradeBuilding(b, lv) { b.next = lv; b.t = 0; b.mode = 'up'; dust(b.x, b.z, 2.2, 10); }
function animBuildings(dt) {
  for (const b of G.buildings) {
    if (b.t >= 1) continue;
    const was = b.t, s = b.body.scale;
    b.t = Math.min(1, b.t + dt / (b.mode === 'build' ? 0.75 : 0.95));
    if (b.mode === 'build') { const e = easeOutBack(b.t); s.set(1 + (1 - b.t) * 0.15, Math.max(0.01, e), 1 + (1 - b.t) * 0.15); continue; }
    const SQ = 0.3;
    if (b.t < SQ) { const k = easeOut(b.t / SQ); s.set(1 + 0.14 * k, 1 - 0.4 * k, 1 + 0.14 * k); continue; }
    if (was < SQ) { b.body.geometry = geoFor(b.fn, b.next); b.lv = b.next; if (b.onSwap) b.onSwap(b.lv); celebrate(b.x, b.z, b.h, true); }
    const k = (b.t - SQ) / (1 - SQ), e = easeOutBack(k);
    s.set(1.14 - 0.14 * k, 0.6 + 0.4 * e, 1.14 - 0.14 * k);
  }
}

// -------------------------------------------------------------- new game ----
function newGame() {
  // clear dynamic objects from a previous run
  if (G) { for (const o of G.dispose) scene.remove(o); for (const p of G.pads) { scene.remove(p.mesh); p.tex.dispose(); } }
  const W = world;
  const tower = ([x, z], up, outer, idx) => ({ x, z, up, outer, idx, built: false, level: 0, b: null, cd: [], aim: undefined });
  G = {
    t: 0, coins: 4, over: false, paused: false, dispose: [], buildings: [],
    king: { x: 4, z: 2, yaw: Math.PI * 0.75, cd: 0, bob: 0 },
    castle: { ...CASTLE, hp: 0, max: 0, hitT: 0, fall: 0 },
    followers: [], joiners: [], enemies: [], projectiles: [], coinsOnGround: [], flying: [], texts: [],
    tier: 0, extraDmg: 0, recruitIdx: 0, barracksLv: 1, forge: null, ring: 0, wallsUp: false, wallsAnim: false, shake: 0,
    towers: [...TOWER_SPOTS.map((s, i) => tower(s, TOWER_UP_PADS[i], false, i)), ...OUTER_SPOTS.map((s, i) => tower(s, OUTER_UP_PADS[i], true, i))],
    cannons: CANNON_SPOTS.map(([x, z], i) => ({ x, z, side: CANNON_PADS[i], built: false, level: 0, b: null, turret: null, cd: 0, yaw: 2.4 })),
    gold: { built: false, lv: 0, b: null, boys: [], plot: { x: GOLD_PLOT[0], z: GOLD_PLOT[1], value: 0, acc: 0 } },
    trails: PATHS.map((_, i) => ({ openAt: i < 3 ? PATH_OPEN[i] : null, timer: 2 })),
    segs: [], spawnT: 0.2, spawnQueue: [], nextPath: 0, kills: 0,
    input: { x: 0, z: 0 }, padIn: null, spendAcc: 0, spentFlash: 0, gainFlash: 0,
    stats: { maxEnemies: 0 },
  };
  // the barracks stands from the start
  const bk = makeBuilding(BARRACKS[0], BARRACKS[1], Math.PI / 4, barracksGeo, 1, 0, 3.5);
  bk.t = 1; bk.body.scale.set(1, 1, 1);
  const em = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), W.emblemMat);
  em.position.set(0, 3.25, 1.82); em.rotation.x = -0.12; bk.body.add(em);
  bk.onSwap = (lv) => { em.position.set(0, lv >= 3 ? 4.4 : 3.25, lv >= 3 ? 1.95 : 1.82); bk.h = lv >= 3 ? 5 : 3.5; };
  G.barracks = bk;
  addPeople(2, false);
  buildSegments();
  G.pads = makePads();
  for (const w of W.wallMeshes) w.count = 0;
  W.grass.visible = false; for (const gt of W.gates) { gt.group.visible = false; gt.open = 0; }
  W.castle.scale.set(1, 1, 1); W.castle.position.y = 0; W.castle.rotation.z = 0;
  resetThemes();
  G.castle.max = G.castle.hp = castleMaxHp();
  refreshObstacles();
  setKingWeapon();
  updateHud(true);
}

// ------------------------------------------------------------------ walls ----
function buildSegments() {
  // walls along the base rectangle, ~4 units per segment, split around the gates
  const segs = [];
  const add = (side, lo, hi, gate) => {
    const n = gate ? 1 : Math.max(1, Math.round((hi - lo) / 4));
    for (let i = 0; i < n; i++) {
      const a = lo + (hi - lo) * i / n, b = lo + (hi - lo) * (i + 1) / n;
      const ns = side === 'N' || side === 'S', fixed = side === 'E' ? HX : side === 'W' ? -HX : side === 'S' ? HZ : -HZ;
      const s = ns ? { ax: a, az: fixed, bx: b, bz: fixed } : { ax: fixed, az: a, bx: fixed, bz: b };
      Object.assign(s, { side, lo: a, hi: b, gate, hp: 0, max: 0, tier: 0, alive: false, hitT: 0, riseT: 1, dusted: true });
      s.cx = (s.ax + s.bx) / 2; s.cz = (s.az + s.bz) / 2;
      // each stretch belongs to the nearest wall tower
      let best = 0, bd = 1e9;
      TOWER_SPOTS.forEach(([x, z], i) => { const d = Math.hypot(x - s.cx, z - s.cz); if (d < bd - 0.01) { bd = d; best = i; } });
      s.owner = best;
      segs.push(s);
    }
  };
  for (const side of ['N', 'E', 'S', 'W']) {
    const span = side === 'N' || side === 'S' ? HX : HZ, gate = GATES.find(g => g.side === side);
    add(side, -span, gate.lo, false); add(side, gate.lo, gate.hi, true); add(side, gate.hi, span, false);
  }
  G.segs = segs;
}
function rebuildWalls(dt = 0) {
  const W = world, counts = [0, 0, 0, 0, 0];
  let moving = false;
  for (const s of G.segs) {
    if (s.riseT < 1) {
      s.riseT = Math.min(1, s.riseT + dt / 0.5); moving = true;
      if (!s.dusted && s.riseT > 0) { s.dusted = true; if (s.alive) dust(s.cx, s.cz, 1.6, 4); }
    }
    if (s.gate || !s.alive || !s.tier) continue;
    const piece = WALL_PIECES[s.tier - 1], mesh = W.wallMeshes[s.tier - 1], tier = s.tier;
    const rise = s.riseT <= 0 ? 0.001 : Math.max(0.001, easeOutBack(s.riseT));
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az), k = Math.max(1, Math.round(len / piece.step)), yaw = Math.atan2(-(s.bz - s.az), s.bx - s.ax);
    for (let i = 0; i < k && counts[tier - 1] < 400; i++) {
      const t = (i + 0.5) / k, x = s.ax + (s.bx - s.ax) * t, z = s.az + (s.bz - s.az) * t;
      tmpM.compose(tmpV.set(x, 0, z), tmpQ.setFromEuler(tmpE.set(0, yaw + (tier < 3 ? (i * 7 % 5 - 2) * 0.03 : 0), 0)), tmpS.set(1, (tier < 3 ? 0.9 + ((i * 13 + Math.abs(s.ax) * 3) % 7) * 0.03 : 1) * rise, 1));
      mesh.setMatrixAt(counts[tier - 1]++, tmpM);
    }
  }
  W.wallMeshes.forEach((m, i) => { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; });
  G.segs.forEach(s => { if (!s.gate) return; const gt = W.gates[GATES.findIndex(g => g.side === s.side)]; gt.group.visible = s.alive; if (s.alive) gt.group.scale.set(1, s.riseT <= 0 ? 0.001 : Math.max(0.001, easeOutBack(s.riseT)), 1); });
  G.wallsAnim = moving;
}
function setTowerWalls(t) {
  const max = WALL_TIERS[t.level - 1].hp;
  for (const s of G.segs) if (s.owner === t.idx) { s.tier = t.level; s.max = s.hp = max; s.alive = true; s.riseT = -Math.hypot(s.cx - t.x, s.cz - t.z) / 16 - 0.15; s.dusted = false; }
  G.wallsUp = true; world.grass.visible = true;
  const cs = G.castle; cs.max = castleMaxHp(); cs.hp = cs.max;
  rebuildWalls();
}

// pads: what you can buy, in the order they appear
function makePads() {
  const pads = [];
  const built = (list) => list.filter(x => x.built).length;
  pads.push(createPad({ id: 'recruit', x: RECRUIT_PAD[0], z: RECRUIT_PAD[1], icon: null, ghosts: true,
    visible: () => people() < FOLLOWER_CAP,
    cost: () => recruitStep()[0], buy: () => recruit() }));
  for (const t of G.towers) {
    const list = G.towers.filter(o => o.outer === t.outer), prev = t.idx ? list[t.idx - 1] : null;
    pads.push(createPad({ id: (t.outer ? 'outer' : 'tower') + t.idx, x: t.x, z: t.z, posFn: () => t.built ? t.up : [t.x, t.z],
      visible: () => t.level < 5 && (t.built || (prev ? prev.built : (t.outer ? built(G.cannons) >= 2 : G.recruitIdx >= 1))),
      cost: () => t.built ? Math.round(TOWER_UP[t.level - 1] * (t.outer ? 2.5 : 1)) : (t.outer ? OUTER_COSTS[t.idx] : TOWER_COSTS[t.idx]),
      iconFn: () => t.built ? (c) => { ICONS.tower(c); iconPath(c, ICONS.up, 40, 30, 0.6); } : (t.outer ? ICONS.tower : ICONS.bow),
      lv: () => t.level, buy: () => t.built ? upgradeTower(t) : buildTower(t) }));
  }
  pads.push(createPad({ id: 'forgebuild', x: FORGE[0], z: FORGE[1], icon: anvilIcon,
    visible: () => G.towers[0].built && !G.forge,
    cost: () => 40, buy: () => buildForge() }));
  pads.push(createPad({ id: 'forge', x: FORGE_PAD[0], z: FORGE_PAD[1], icon: null,
    visible: () => !!G.forge,
    cost: () => G.tier < FORGE_COSTS.length ? FORGE_COSTS[G.tier] : Math.round(9000 * Math.pow(1.6, G.extraDmg + 1)),
    iconFn: () => (c) => { ICONS.weapon(c, Math.min(G.tier + 1, 6)); if (G.tier >= FORGE_COSTS.length) iconPath(c, ICONS.up, 42, 32, 0.6); },
    lv: () => G.tier * 100 + G.extraDmg, buy: () => upgradeWeapon() }));
  G.cannons.forEach((cn, i) => {
    pads.push(createPad({ id: 'cannon' + i, x: cn.x, z: cn.z, icon: null, posFn: () => cn.built ? cn.side : [cn.x, cn.z],
      visible: () => cn.level < CANNON_MAX && (cn.built || (built(G.towers.filter(t => !t.outer)) >= 4 && (i === 0 || G.cannons[i - 1].built))),
      cost: () => cn.built ? Math.round(CANNON_COSTS[i] * Math.pow(1.9, cn.level)) : CANNON_COSTS[i],
      iconFn: () => (c) => { ICONS.cannon(c); if (cn.built) iconPath(c, ICONS.up, 40, -32, 0.55); },
      lv: () => cn.level, buy: () => buildCannon(i) }));
  });
  const gd = G.gold;
  pads.push(createPad({ id: 'gold', x: GOLD_HUT[0], z: GOLD_HUT[1], posFn: () => gd.built ? GOLD_PAD : GOLD_HUT,
    visible: () => gd.lv < GOLD_COSTS.length && (gd.built || G.towers.some(t => t.outer && t.built)),
    cost: () => GOLD_COSTS[gd.lv],
    iconFn: () => gd.built ? (c) => { ICONS.goldboy(c); iconPath(c, ICONS.up, 40, -30, 0.55); } : ICONS.goldboy,
    lv: () => gd.lv, buy: () => buildGold() }));
  for (const p of pads) { p.cost = p.price(); p.key = ''; }
  return pads;
}
function recruitStep() {
  const i = G.recruitIdx;
  if (i < RECRUIT.length) return RECRUIT[i];
  return [Math.round(250 * Math.pow(1.25, i - RECRUIT.length + 1)), 6];
}

// --------------------------------------------------------------- entities ----
function addFollower(fromBarracks) {
  const k = G.king, n = G.followers.length;
  const f = { x: fromBarracks ? RECRUIT_PAD[0] : k.x + (Math.random() - 0.5) * 2, z: fromBarracks ? RECRUIT_PAD[1] : k.z + (Math.random() - 0.5) * 2, yaw: 0, cd: Math.random(), slot: n, bob: Math.random() * 6, atkT: 0, rank: 1, pop: 0 };
  G.followers.push(f);
}
// everyone in the troop, including recruits still running over to join someone
const people = () => G.followers.reduce((s, f) => s + f.rank, 0) + G.joiners.length;
function addPeople(count, fromBarracks) {
  for (let i = 0; i < count; i++) {
    if (G.followers.length < SQUAD_MAX) { addFollower(fromBarracks); continue; }
    // the weakest follower (counting who is already on the way to him) gets the newcomer
    let f = null, best = 1e9;
    for (const o of G.followers) { const r = o.rank + G.joiners.filter(j => j.target === o).length; if (r < best) { best = r; f = o; } }
    if (fromBarracks) G.joiners.push({ x: RECRUIT_PAD[0] + (Math.random() - 0.5), z: RECRUIT_PAD[1] + (Math.random() - 0.5), yaw: 0, bob: Math.random() * 6, target: f });
    else promote(f);
  }
}
function promote(f) {
  const before = rankTier(f.rank);
  f.rank++; f.pop = 1;
  burst(f.x, 1.2, f.z, rankTier(f.rank) > before ? 14 : 6, '#7dff6a');
  if (rankTier(f.rank) > before) shockwave(f.x, f.z, 2, '#7dff6a');
}
function recruit() {
  const [, n] = recruitStep();
  addPeople(n, true);
  G.recruitIdx++;
  const lv = BARRACKS_STEPS.filter(s => G.recruitIdx >= s).length;
  if (lv > G.barracksLv) { G.barracksLv = lv; upgradeBuilding(G.barracks, lv); refreshObstacles(); }
  else celebrate(RECRUIT_PAD[0], RECRUIT_PAD[1], 1.2, false);
}
function castleMaxHp() { return 5000 * (1 + 0.12 * G.towers.reduce((s, t) => s + (t.outer ? 0 : t.level), 0)); }
function weapon(forTower) {
  let t = G.tier; if (forTower && t === 4) t = 3;
  const w = WEAPONS[t];
  return { ...w, dmg: w.dmg * Math.pow(1.25, G.extraDmg), tier: t };
}
function reachRing(r) {
  for (let i = G.ring + 1; i <= r && i < THEMES.length; i++) revealTheme(i);
  G.ring = Math.max(G.ring, r);
}
function revealTheme(i) {
  const th = world.themes[i], info = THEMES[i];
  th.revealT = 0; th.overlay.visible = true; th.group.visible = true;
  G.trails[info.path].openAt = G.t + 4;
  toast(`A new road has opened: ${info.name}`);
  // a gust along the new road
  const road = th.road;
  for (let j = 0; j < road.length - 1; j++) for (let s = 0; s < 1; s += 0.34) puff(road[j][0] + (road[j + 1][0] - road[j][0]) * s, 0.6, road[j][1] + (road[j + 1][1] - road[j][1]) * s, th.dust, 2);
}
function buildTower(t) {
  t.built = true; t.level = 1; t.cd = [];
  t.b = makeBuilding(t.x, t.z, 0, towerGeo, 1, t.outer ? 5 : 0, TOWER_LV[0].h);
  celebrate(t.x, t.z, TOWER_LV[0].h, false);
  if (t.outer) reachRing(2); else setTowerWalls(t);
  refreshObstacles();
}
function upgradeTower(t) {
  t.level++;
  upgradeBuilding(t.b, t.level); t.b.h = TOWER_LV[t.level - 1].h;
  if (!t.outer) { setTowerWalls(t); bigText(WALL_TIERS[t.level - 1].name, t.up[0], 4, t.up[1]); }
}
function buildForge() {
  const b = makeBuilding(FORGE[0], FORGE[1], Math.PI / 4, forgeGeo, 0, 6.5, 2.5);
  const lava = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 0.05, 8), world.lavaMat); lava.position.y = 1.69; b.body.add(lava);
  const smith = new THREE.Mesh(world.smithGeo, world.vmat); smith.position.set(1.25, 0, -0.5); smith.rotation.y = 0.6; smith.castShadow = true; b.body.add(smith);
  b.smith = smith;
  G.forge = b;
  celebrate(FORGE[0], FORGE[1], 2.5, false);
  refreshObstacles();
}
function upgradeWeapon() {
  if (G.tier < FORGE_COSTS.length) { G.tier++; upgradeBuilding(G.forge, G.tier); G.forge.h = 2.5 + G.tier * 0.4; bigText(WEAPONS[G.tier].name, FORGE[0], 5, FORGE[1]); }
  else { G.extraDmg++; celebrate(FORGE[0], FORGE[1], G.forge.h, true); bigText(`${WEAPONS[G.tier].name} +${G.extraDmg}`, FORGE[0], 5, FORGE[1]); }
  for (const f of G.followers) burst(f.x, 1, f.z, 3, '#bfe8ff');
  shockwave(G.king.x, G.king.z, (G.ringR || 2) + 2, '#bfe8ff');
  setKingWeapon();
  refreshObstacles();
}
function setKingWeapon() {
  const W = world; W.kingWeapon.clear();
  const m = new THREE.Mesh(weaponGeo(G.tier), W.vmat); m.position.set(0.05, 1.0, 0.05); m.scale.setScalar(1.1); m.castShadow = true; W.kingWeapon.add(m);
}
function buildCannon(i) {
  const c = G.cannons[i];
  if (!c.built) {
    c.built = true; c.level = 1;
    c.b = makeBuilding(c.x, c.z, 0, cannonBaseGeo, 1, 5.5, 2.2);
    const tur = new THREE.Mesh(geoFor(cannonTurretGeo, 1), world.vmat); tur.position.y = CANNON_TOP[0]; tur.castShadow = true; tur.rotation.y = c.yaw;
    c.b.body.add(tur); c.turret = tur;
    c.b.onSwap = (lv) => { tur.geometry = geoFor(cannonTurretGeo, lv); tur.position.y = CANNON_TOP[lv - 1]; };
    celebrate(c.x, c.z, 2.2, false);
    reachRing(1);
  } else { c.level++; upgradeBuilding(c.b, c.level); }
  refreshObstacles();
}
function buildGold() {
  const gd = G.gold;
  if (!gd.built) {
    gd.built = true; gd.lv = 1;
    gd.b = makeBuilding(GOLD_HUT[0], GOLD_HUT[1], Math.PI / 4, goldHutGeo, 1, 7, 3.6);
    gd.plotB = makeBuilding(GOLD_PLOT[0], GOLD_PLOT[1], 0, plotGeo, 1, 0, 0.6);
    celebrate(GOLD_HUT[0], GOLD_HUT[1], 3.6, false);
    reachRing(3);
  } else { gd.lv++; upgradeBuilding(gd.b, gd.lv); }
  while (gd.boys.length < GOLD_BOYS[gd.lv - 1].n) gd.boys.push({ x: GOLD_HUT[0] + 1.6, z: GOLD_HUT[1] + 2.2, yaw: 0.8, bob: Math.random() * 6, load: 0, state: 'idle', target: null, retarget: 0.8 + gd.boys.length * 0.4, moving: false });
  bigText(gd.lv === 1 ? 'Gold boy' : '+1 gold boy', GOLD_HUT[0], 5, GOLD_HUT[1]);
  refreshObstacles();
}
// things the king bumps into
function refreshObstacles() {
  const rot = (bx, bz, yaw, lx, lz) => [bx + lx * Math.cos(yaw) + lz * Math.sin(yaw), bz - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
  const o = [[CASTLE.x, CASTLE.z, CASTLE.r + 0.4], [BARRACKS[0], BARRACKS[1], G.barracksLv >= 3 ? 2.8 : 2.6]];
  if (G.barracksLv >= 2) o.push([...rot(BARRACKS[0], BARRACKS[1], Math.PI / 4, 2.4, 0), 1.0]);
  if (G.barracksLv >= 4) o.push([...rot(BARRACKS[0], BARRACKS[1], Math.PI / 4, 2.5, -0.6), 1.2]);
  if (G.forge) { o.push([FORGE[0], FORGE[1], 1.3]); const r = [0, 0.9, 1.4, 1.6, 1.8, 1.9, 2.0][G.tier]; if (r) o.push([...rot(FORGE[0], FORGE[1], Math.PI / 4, 0.3, -2.0), r]); }
  for (const c of G.cannons) if (c.built) o.push([c.x, c.z, [1.5, 1.8, 2.0, 2.0, 2.1][c.level - 1]]);
  for (const t of G.towers) if (t.built && t.outer) o.push([t.x, t.z, t.level >= 5 ? 2.0 : 1.5]);
  const gd = G.gold;
  if (gd.built) { o.push([GOLD_HUT[0], GOLD_HUT[1], 2.0]); if (gd.lv >= 2) o.push([...rot(GOLD_HUT[0], GOLD_HUT[1], Math.PI / 4, 2.4, -1.0), 1.1]); if (gd.lv >= 3) o.push([...rot(GOLD_HUT[0], GOLD_HUT[1], Math.PI / 4, -0.6, -2.6), 1.3]); }
  G.obs = o;
}

// ---------------------------------------------------------------- enemies ----
// Difficulty rises smoothly with time; there are no waves. Groups are bought
// from a budget that grows over time, and the mix shifts from many small
// knights toward fewer, bigger brutes and giants.
const level = () => G.t / 13;
function spawnEnemy(kind, pathIdx) {
  const L = level(), theme = PATH_THEME[pathIdx], th = THEMES[theme], u = UNIT[kind];
  const path = PATHS[pathIdx];
  const e = {
    kind, theme, x: path[0][0] + (Math.random() - 0.5) * 1.2, z: path[0][1] + (Math.random() - 0.5) * 1.2, path: pathIdx, wp: 1,
    hp: 0, max: 0, speed: 0, dmg: 0, r: u.r, atk: 0, yaw: 0, bob: Math.random() * 6, state: 'path', seg: null, lunge: 0,
    value: 1, hitFlash: 0, side: (Math.random() - 0.5) * (kind === 'knight' ? 1.4 : 0.8), scale: u.scale,
  };
  e.max = 22 * Math.pow(1.10, L) * th.hp * u.hp;
  e.dmg = 8 * Math.pow(1.06, L) * u.dmg * (1 + (th.hp - 1) * 0.5);
  e.value = Math.max(1, Math.round((2 + L / 2) * u.value * th.value));
  e.speed = (kind === 'knight' ? 2.4 + Math.min(1.2, L * 0.03) : u.speed) * th.speed;
  const v = kind === 'knight' ? (Math.random() < 0.35 ? 'S' : '') : (kind === 'giant' && PAL[theme].giants[1] && Math.random() < 0.5 ? 'R' : '');
  e.mkey = kind + v + theme;
  e.hp = e.max;
  G.enemies.push(e);
  return e;
}
function queueGroup(p, L) {
  let budget = 5 + L * 0.7, t = 0, n = 0;
  const ws = Math.max(0.25, 1 - L * 0.03), wb = L < 3 ? 0 : Math.min(1.2, (L - 3) * 0.07), wg = L < 10 ? 0 : Math.min(0.8, (L - 10) * 0.04);
  while (budget >= 1 && n < 14) {
    const b = budget >= 4 ? wb : 0, g = budget >= 12 ? wg : 0, r = Math.random() * (ws + b + g);
    const kind = r < ws ? 'knight' : r < ws + b ? 'brute' : 'giant';
    budget -= UNIT[kind].cost; n++;
    G.spawnQueue.push({ p, kind, t }); t += kind === 'knight' ? 0.35 : 0.8;
  }
}
const trailOpen = (i) => G.trails[i].openAt !== null && G.t >= G.trails[i].openAt;
function updateSpawns(dt) {
  const L = level();
  if (G.enemies.length < 300) {
    G.spawnT -= dt;
    if (G.spawnT <= 0) {
      const open = [0, 1, 2].filter(trailOpen);
      if (open.length) queueGroup(open[G.nextPath++ % open.length], L);
      G.spawnT = Math.max(1.0, 3 * Math.pow(0.955, L));
    }
    // every outer road sends its own groups on top of that
    for (let i = 3; i < PATHS.length; i++) {
      if (!trailOpen(i)) continue;
      const tr = G.trails[i]; tr.timer -= dt;
      if (tr.timer <= 0) { queueGroup(i, L); tr.timer = Math.max(2.4, 5.5 * Math.pow(0.96, L)); }
    }
  }
  for (let i = G.spawnQueue.length - 1; i >= 0; i--) {
    const q = G.spawnQueue[i]; q.t -= dt;
    if (q.t <= 0) { spawnEnemy(q.kind, q.p); G.spawnQueue.splice(i, 1); }
  }
}

// spatial hash for enemies
const CELL = 3, grid = new Map();
const gkey = (cx, cz) => cx * 73856 + cz;
function rebuildGrid() {
  grid.clear();
  for (const e of G.enemies) {
    const k = gkey(Math.floor(e.x / CELL), Math.floor(e.z / CELL));
    let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(e);
  }
}
function nearestEnemy(x, z, range, exclude) {
  let best = null, bd = range * range;
  const r = Math.ceil(range / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    const a = grid.get(gkey(cx + i, cz + j)); if (!a) continue;
    for (const e of a) { if (e.hp <= 0 || (exclude && exclude.has(e))) continue; const d = (e.x - x) ** 2 + (e.z - z) ** 2; if (d < bd) { bd = d; best = e; } }
  }
  return best;
}
function enemiesNear(x, z, rad, out) {
  out.length = 0;
  const r = Math.ceil((rad + 1.3) / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { const a = grid.get(gkey(cx + i, cz + j)); if (!a) continue; for (const e of a) if (e.hp > 0 && (e.x - x) ** 2 + (e.z - z) ** 2 < (rad + e.r) ** 2) out.push(e); }
  return out;
}
const inside = (x, z) => Math.abs(x) < HX && Math.abs(z) < HZ;
function segAt(x0, z0, x1, z1) {
  // wall segment crossed when moving from outside (x0,z0) to inside (x1,z1)
  let t = 1, side = null;
  const tryX = (bx, nm) => { if ((x0 - bx) * (x1 - bx) <= 0 && x0 !== x1) { const tt = (bx - x0) / (x1 - x0); const zz = z0 + (z1 - z0) * tt; if (tt >= 0 && tt <= t && Math.abs(zz) <= HZ + 0.01) { t = tt; side = [nm, zz]; } } };
  const tryZ = (bz, nm) => { if ((z0 - bz) * (z1 - bz) <= 0 && z0 !== z1) { const tt = (bz - z0) / (z1 - z0); const xx = x0 + (x1 - x0) * tt; if (tt >= 0 && tt <= t && Math.abs(xx) <= HX + 0.01) { t = tt; side = [nm, xx]; } } };
  tryX(HX, 'E'); tryX(-HX, 'W'); tryZ(HZ, 'S'); tryZ(-HZ, 'N');
  if (!side) return null;
  const [nm, v] = side;
  for (const s of G.segs) if (s.side === nm && v >= s.lo - 0.01 && v <= s.hi + 0.01) return s;
  return null;
}
const near = [];
// Enemies march along their path to the castle. Walls in the way get
// battered down first; the king, his archers and the gold boys are never targeted.
function updateEnemies(dt) {
  const wallsUp = G.wallsUp, cs = G.castle;
  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    e.bob += dt * (e.kind === 'knight' ? 9 : 6); e.lunge = Math.max(0, e.lunge - dt * 3); e.hitFlash = Math.max(0, e.hitFlash - dt * 6);
    e.atk -= dt;
    if (e.state === 'wall') {
      if (!e.seg.alive) { e.state = 'path'; e.seg = null; }
      else {
        if (e.atk <= 0) { e.atk = UNIT[e.kind].atk; e.lunge = 1; hitWall(e.seg, e.dmg); }
        continue;
      }
    }
    if (e.state === 'castle') {
      if (e.atk <= 0 && cs.hp > 0) { e.atk = UNIT[e.kind].atk; e.lunge = 1; hitCastle(e.dmg, e.x, e.z); }
      continue;
    }
    const path = PATHS[e.path], last = e.wp >= path.length - 1;
    const p = path[Math.min(e.wp, path.length - 1)];
    // walk a little to one side of the trail so a column reads as a column, not a single file of clones
    const pp = path[Math.max(0, e.wp - 1)], sx = -(p[1] - pp[1]), sz = p[0] - pp[0], sl = Math.hypot(sx, sz) || 1;
    const tx = p[0] + (last ? 0 : sx / sl * e.side), tz = p[1] + (last ? 0 : sz / sl * e.side);
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
    if (last && Math.hypot(cs.x - e.x, cs.z - e.z) < cs.r + e.r + 0.2) { e.state = 'castle'; e.yaw = Math.atan2(cs.x - e.x, cs.z - e.z); continue; }
    // a waypoint counts as reached once it is close or already behind (a crowd can keep anyone from touching it)
    if (!last) {
      const nx2 = path[e.wp + 1][0] - p[0], nz2 = path[e.wp + 1][1] - p[1];
      if (d < 1.3 || (e.x - p[0]) * nx2 + (e.z - p[1]) * nz2 > 0) { e.wp++; continue; }
    }
    e.yaw += angleDiff(Math.atan2(dx, dz), e.yaw) * Math.min(1, dt * 8);
    const step = Math.min(d, e.speed * dt);
    const nx = e.x + dx / d * step, nz = e.z + dz / d * step;
    if (wallsUp && !inside(e.x, e.z) && inside(nx, nz)) {
      const s = segAt(e.x, e.z, nx, nz);
      if (s && s.alive) { e.state = 'wall'; e.seg = s; e.yaw = Math.atan2(dx, dz); continue; }
    }
    e.x = nx; e.z = nz;
  }
  // Spread enemies apart a little so they don't stack into one spot. The push
  // only ever goes sideways, never back against the way they walk, and is
  // capped, so a crowd can't hold itself up: in a jam they walk through each other.
  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    enemiesNear(e.x, e.z, e.r + 0.6, near);
    let px = 0, pz = 0, n = 0;
    for (const o of near) {
      if (o === e) continue;
      const dx = e.x - o.x, dz = e.z - o.z, d = Math.hypot(dx, dz) || 0.01, m = e.r + o.r;
      if (d < m) { const w = (m - d) * 0.5 * (o.r > e.r ? 1.4 : 0.8); px += dx / d * w; pz += dz / d * w; n++; }
    }
    if (!n || n > 8) continue;
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw), back = px * fx + pz * fz;
    if (back < 0) { px -= back * fx; pz -= back * fz; }
    const pl = Math.hypot(px, pz), cap = 2.5 * dt;
    if (pl > cap) { px *= cap / pl; pz *= cap / pl; }
    const nx = e.x + px, nz = e.z + pz;
    // pushing must not shove an attacker through an intact wall
    if (G.wallsUp && !inside(e.x, e.z) && inside(nx, nz)) { const s = segAt(e.x, e.z, nx, nz); if (s && s.alive) continue; }
    e.x = nx; e.z = nz;
  }
}
function hitWall(s, dmg) {
  s.hp -= dmg; s.hitT = 2.5;
  floatText(`-${Math.round(dmg)}`, s.cx + (Math.random() - 0.5), 2.6, s.cz + (Math.random() - 0.5), '#ffffff');
  if (s.hp <= 0) { s.alive = false; s.hp = 0; puff(s.cx, 1, s.cz, '#c8a27a', 14); rebuildWalls(); }
}
function hitCastle(dmg, x, z) {
  const cs = G.castle;
  cs.hp -= dmg; cs.hitT = 2.5;
  floatText(`-${Math.round(dmg)}`, cs.x + (x - cs.x) * 0.5, 4.2, cs.z + (z - cs.z) * 0.5, '#ffffff');
  if (cs.hp <= 0) { cs.hp = 0; gameOver(); }
}
function damageEnemy(e, dmg) {
  if (e.hp <= 0) return;
  e.hp -= dmg; e.hitFlash = 1;
  if (e.hp <= 0) {
    G.kills++;
    puff(e.x, 0.8 * e.scale, e.z, '#ffffff', e.kind === 'knight' ? 6 : e.kind === 'brute' ? 10 : 16);
    dropCoins(e.x, e.z, e.value);
  }
}

// ------------------------------------------------------------------ coins ----
function dropCoins(x, z, value) {
  const many = G.coinsOnGround.length > 350;
  const n = many ? Math.min(3, value) : Math.min(value, 12);
  const per = value / n;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2.2;
    G.coinsOnGround.push({ x, z, y: 0.6, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 5 + Math.random() * 2, v: per, spin: Math.random() * 6, rest: false, age: 0, gone: false, claimed: null });
  }
}
function updateCoins(dt) {
  const k = G.king;
  for (let i = G.coinsOnGround.length - 1; i >= 0; i--) {
    const c = G.coinsOnGround[i]; c.age += dt; c.spin += dt * 4;
    if (!c.rest) { c.vy -= 22 * dt; c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt; if (c.y <= 0.22) { c.y = 0.22; c.vy *= -0.35; c.vx *= 0.6; c.vz *= 0.6; if (Math.abs(c.vy) < 1.2) c.rest = true; } }
    const d2 = (c.x - k.x) ** 2 + (c.z - k.z) ** 2;
    const mag = 7.5 + (G.ringR || 2) * 0.3;
    if (c.age > 0.35 && d2 < mag * mag && !G.over) { G.flying.push({ x: c.x, y: c.y, z: c.z, t: 0, v: c.v, to: 'king' }); c.gone = true; G.coinsOnGround.splice(i, 1); }
    else if (c.age > 90) { c.gone = true; G.coinsOnGround.splice(i, 1); }
  }
  for (let i = G.flying.length - 1; i >= 0; i--) {
    const f = G.flying[i]; f.t += dt * 3.2;
    if (f.to === 'king') {
      const top = stackTop();
      f.x += (k.x - f.x) * Math.min(1, dt * 10); f.z += (k.z - f.z) * Math.min(1, dt * 10); f.y += (top - f.y) * Math.min(1, dt * 10) + Math.sin(f.t * Math.PI) * dt * 6;
      if (f.t >= 1) { G.coins += f.v; G.gainFlash = 0.5; G.flying.splice(i, 1); }
    } else {
      f.x += (f.tx - f.x) * Math.min(1, dt * 8); f.z += (f.tz - f.z) * Math.min(1, dt * 8); f.y += ((f.ty ?? 0.3) - f.y) * Math.min(1, dt * 8) + Math.sin(f.t * Math.PI) * dt * 5;
      if (f.t >= 1) G.flying.splice(i, 1);
    }
  }
}
const stackTop = () => 1.25 + Math.min(G.coins, 400) * 0.1;

// --------------------------------------------------------------- gold boy ----
// Gold boys run around outside the walls picking up coins and drop them on
// the plot next to their hut, where the king collects them.
const RX = HX + 2.2, RZ = HZ + 2.2;
function crossesBase(ax, az, bx, bz) {
  const x0 = -RX + 0.5, x1 = RX - 0.5, z0 = -RZ + 0.5, z1 = RZ - 0.5, dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  const clip = (p, q) => { if (p === 0) return q >= 0; const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
  return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dz, az - z0) && clip(dz, z1 - az) && t0 <= t1;
}
// walk around the walled base instead of through it
function steer(ax, az, bx, bz) {
  if (!crossesBase(ax, az, bx, bz)) return [bx, bz];
  let best = null, bd = 1e9;
  for (const [cx, cz] of [[RX, RZ], [RX, -RZ], [-RX, RZ], [-RX, -RZ]]) {
    if (Math.hypot(cx - ax, cz - az) < 0.8 || crossesBase(ax, az, cx, cz)) continue;
    const d = Math.hypot(cx - ax, cz - az) + Math.hypot(bx - cx, bz - cz) + (crossesBase(cx, cz, bx, bz) ? 40 : 0);
    if (d < bd) { bd = d; best = [cx, cz]; }
  }
  return best || [bx, bz];
}
const inBase = (x, z) => Math.abs(x) < RX - 0.5 && Math.abs(z) < RZ - 0.5;
function findCoin(b) {
  let best = null, bd = 1e9;
  for (const c of G.coinsOnGround) {
    if (c.age < 0.35 || (c.claimed && c.claimed !== b) || inBase(c.x, c.z)) continue;
    const d = (c.x - b.x) ** 2 + (c.z - b.z) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function updateGold(dt) {
  const gd = G.gold; if (!gd.built) return;
  const spec = GOLD_BOYS[gd.lv - 1], pl = gd.plot;
  for (const b of gd.boys) {
    b.bob += dt * 13; b.retarget -= dt;
    let tx = b.x, tz = b.z, speed = spec.speed;
    if (b.state === 'idle') {
      const a = G.t * 0.4 + gd.boys.indexOf(b) * 2;
      tx = GOLD_HUT[0] + 1.5 + Math.cos(a) * 1.2; tz = GOLD_HUT[1] + 3 + Math.sin(a) * 1.2; speed = 1.6;
      if (b.retarget <= 0) { b.retarget = 0.8; if (findCoin(b)) b.state = 'seek'; }
    }
    if (b.state === 'seek') {
      if (!b.target || b.target.gone || b.retarget <= 0) {
        if (b.target && b.target.claimed === b) b.target.claimed = null;
        b.target = findCoin(b); b.retarget = 1.5;
        if (b.target) b.target.claimed = b;
      }
      if (b.target) { tx = b.target.x; tz = b.target.z; }
      else b.state = b.load > 0 ? 'return' : 'idle';
    }
    if (b.state === 'return') {
      tx = pl.x; tz = pl.z;
      if (Math.hypot(pl.x - b.x, pl.z - b.z) < 1.4) {
        pl.value += b.load;
        for (let i = 0; i < Math.min(6, Math.ceil(b.load / 5)); i++) G.flying.push({ x: b.x, y: 1.2, z: b.z, t: -i * 0.06, v: 0, to: 'pt', tx: pl.x + (Math.random() - 0.5) * 1.6, tz: pl.z + (Math.random() - 0.5) * 1.6, ty: 0.4 });
        floatText(`+${Math.round(b.load)}`, pl.x, 1.8, pl.z, '#ffd84a');
        b.load = 0; b.state = 'seek'; b.retarget = 0;
      }
    }
    const [sx, sz] = steer(b.x, b.z, tx, tz), dx = sx - b.x, dz = sz - b.z, d = Math.hypot(dx, dz);
    b.moving = d > 0.15;
    if (b.moving) { const st = Math.min(d, speed * dt); b.x += dx / d * st; b.z += dz / d * st; b.yaw += angleDiff(Math.atan2(dx, dz), b.yaw) * Math.min(1, dt * 10); }
    // scoop up every coin he runs over
    if (b.state === 'seek') {
      for (let i = G.coinsOnGround.length - 1; i >= 0; i--) {
        const c = G.coinsOnGround[i];
        if (c.age < 0.35 || (c.x - b.x) ** 2 + (c.z - b.z) ** 2 > 1.3) continue;
        b.load += c.v; c.gone = true; G.coinsOnGround.splice(i, 1);
        if (G.flying.length < 200) G.flying.push({ x: c.x, y: c.y, z: c.z, t: 0, v: 0, to: 'pt', tx: b.x, tz: b.z, ty: 1.0 });
      }
      if (b.load >= spec.cap) { b.state = 'return'; if (b.target && b.target.claimed === b) b.target.claimed = null; b.target = null; }
    }
  }
  // the king empties the plot by standing on it
  const k = G.king;
  if (pl.value >= 1 && Math.abs(k.x - pl.x) < 2.4 && Math.abs(k.z - pl.z) < 2.4) {
    pl.acc += Math.max(30, pl.value * 2) * dt;
    const take = Math.min(Math.floor(pl.acc), Math.floor(pl.value));
    if (take > 0) { pl.acc -= take; pl.value -= take; G.flying.push({ x: pl.x + (Math.random() - 0.5) * 1.5, y: 0.5, z: pl.z + (Math.random() - 0.5) * 1.5, t: 0, v: take, to: 'king' }); }
  } else pl.acc = 0;
}

// --------------------------------------------------------------- shooting ----
function fire(sx, sy, sz, w, target) {
  if (w.kind === 'melee') { damageEnemy(target, w.dmg); spark(target.x, 0.9 * target.scale, target.z); return; }
  G.projectiles.push({ kind: w.kind, x: sx, y: sy, z: sz, target, tx: target.x, tz: target.z, ty: 0.8 * target.scale, speed: w.speed, dmg: w.dmg, pierce: w.pierce || 1, hit: null, life: 2, dir: null });
}
function updateShooting(dt) {
  const k = G.king, w = weapon(false), melee = w.kind === 'melee';
  // king
  k.cd -= dt;
  if (k.cd <= 0) {
    const e = nearestEnemy(k.x, k.z, melee ? w.range + 1.2 : w.range);
    if (e) { fire(k.x, 1.8, k.z, { ...w, dmg: w.dmg * 2 }, e); k.cd = w.cd; k.aim = Math.atan2(e.x - k.x, e.z - k.z); } else k.cd = 0.1;
  }
  // troop
  for (const f of G.followers) {
    f.cd -= dt; f.atkT = Math.max(0, f.atkT - dt);
    if (f.cd > 0) continue;
    const e = nearestEnemy(f.x, f.z, w.range);
    if (e) { fire(f.x, 0.9, f.z, f.rank > 1 ? { ...w, dmg: w.dmg * f.rank } : w, e); f.cd = w.cd * (0.9 + Math.random() * 0.2); f.aim = Math.atan2(e.x - f.x, e.z - f.z); f.atkT = 0.25; }
    else f.cd = 0.15;
  }
  // towers: higher levels have more archers, reach further and hit harder
  const tw = weapon(true);
  for (const t of G.towers) {
    if (!t.built) continue;
    const lv = TOWER_LV[t.level - 1], range = tw.range + 3 + (t.level - 1) * 0.8 + (t.outer ? 2 : 0), dmg = tw.dmg * (1 + 0.3 * (t.level - 1));
    while (t.cd.length < lv.archers) t.cd.push(Math.random());
    for (let i = 0; i < lv.archers; i++) {
      t.cd[i] -= dt;
      if (t.cd[i] > 0) continue;
      const e = nearestEnemy(t.x, t.z, range);
      if (e) { const o = TOWER_SLOTS[i]; fire(t.x + o[0], lv.h + 0.85, t.z + o[1], { ...tw, dmg }, e); t.cd[i] = tw.cd * (0.9 + Math.random() * 0.2); t.aim = Math.atan2(e.x - t.x, e.z - t.z); }
      else t.cd[i] = 0.2;
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
      const dmg = 90 * Math.pow(1.6, c.level - 1), y = CANNON_TOP[c.level - 1] + 0.63;
      const shots = c.level === 4 ? [-0.3, 0.3] : [0];
      for (const ox of shots) {
        const sx = c.x + Math.sin(c.yaw) * 1.4 + Math.cos(c.yaw) * ox, sz = c.z + Math.cos(c.yaw) * 1.4 - Math.sin(c.yaw) * ox;
        G.projectiles.push({ kind: 'ball', x: sx, y, z: sz, sx, sz, sy: y, tx: e.x + ox, tz: e.z, t: 0, dur: 0.9, dmg: dmg / shots.length * (shots.length > 1 ? 1.15 : 1), splash: 2.8 + 0.25 * (c.level - 1), target: null, life: 3 });
      }
      puff(c.x + Math.sin(c.yaw) * 1.8, y, c.z + Math.cos(c.yaw) * 1.8, '#ffffff', 4);
    }
  }
}
const TOWER_SLOTS = [[0, 0.45], [-0.45, -0.15], [0.45, -0.15], [-0.5, 0.55], [0.5, 0.55]];
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const hitList = [];
function updateProjectiles(dt) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    p.life -= dt;
    if (p.kind === 'ball') {
      p.t += dt / p.dur;
      const t = Math.min(1, p.t);
      p.x = p.sx + (p.tx - p.sx) * t; p.z = p.sz + (p.tz - p.sz) * t; p.y = p.sy * (1 - t) + 0.3 * t + Math.sin(t * Math.PI) * 5;
      if (p.t >= 1) {
        enemiesNear(p.tx, p.tz, p.splash, hitList);
        for (const e of hitList.slice()) damageEnemy(e, p.dmg);
        boom(p.tx, p.tz);
        G.projectiles.splice(i, 1);
      }
      continue;
    }
    if (p.kind === 'spear') {
      if (!p.dir) { const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz) || 1; p.dir = [dx / d, dz / d]; p.hit = new Set(); }
      const st = p.speed * dt;
      p.x += p.dir[0] * st; p.z += p.dir[1] * st; p.y += (0.8 - p.y) * Math.min(1, dt * 4);
      enemiesNear(p.x, p.z, 0.6, hitList);
      for (const e of hitList) if (!p.hit.has(e) && p.hit.size < p.pierce) { p.hit.add(e); damageEnemy(e, p.dmg); spark(e.x, 0.9, e.z); }
      if (p.hit.size >= p.pierce || p.life < 1.4) G.projectiles.splice(i, 1);
      continue;
    }
    const tgt = p.target;
    if (tgt && tgt.hp > 0) { p.tx = tgt.x; p.tz = tgt.z; p.ty = 0.8 * tgt.scale; }
    const dx = p.tx - p.x, dy = p.ty - p.y, dz = p.tz - p.z, d = Math.hypot(dx, dy, dz);
    const st = p.speed * dt;
    p.dir = [dx / (d || 1), dy / (d || 1), dz / (d || 1)];
    if (d <= st + 0.2) {
      if (tgt && tgt.hp > 0) { damageEnemy(tgt, p.dmg); spark(p.tx, p.ty, p.tz); }
      G.projectiles.splice(i, 1);
      continue;
    }
    p.x += p.dir[0] * st; p.y += p.dir[1] * st; p.z += p.dir[2] * st;
    if (p.life <= 0) G.projectiles.splice(i, 1);
  }
}

// ----------------------------------------------------------------- troops ----
function formation(i) {
  const a = i * 2.39996 + 0.6, r = 0.8 * Math.sqrt(i + 1.3);
  return [Math.cos(a) * r, Math.sin(a) * r];
}
function updateTroop(dt) {
  const k = G.king, w = weapon(false), melee = w.kind === 'melee';
  // the king
  let ix = G.input.x, iz = G.input.z;
  const len = Math.hypot(ix, iz);
  if (len > 1) { ix /= len; iz /= len; }
  const moving = len > 0.05;
  let nx = k.x + ix * KING_SPEED * dt, nz = k.z + iz * KING_SPEED * dt;
  nx = Math.max(BOUNDS.x0, Math.min(BOUNDS.x1, nx)); nz = Math.max(BOUNDS.z0, Math.min(BOUNDS.z1, nz));
  [nx, nz] = collideWalls(k.x, k.z, nx, nz);
  for (const [ox, oz, r] of G.obs) {
    const dx = nx - ox, dz = nz - oz, d = Math.hypot(dx, dz);
    if (d < r) { nx = ox + dx / (d || 1) * r; nz = oz + dz / (d || 1) * r; }
  }
  k.x = nx; k.z = nz;
  if (moving) k.yaw += angleDiff(Math.atan2(ix, iz), k.yaw) * Math.min(1, dt * 12);
  k.bob += dt * (moving ? 14 : 3);
  // followers; bigger ranks stand further apart
  let spread = 1;
  for (const f of G.followers) spread = Math.max(spread, RANKS[rankTier(f.rank)].s);
  G.followers.forEach((f, i) => {
    f.bob += dt * 12; f.pop = Math.max(0, f.pop - dt * 2.5);
    const [fx, fz] = formation(i), ox = fx * spread, oz = fz * spread;
    let tx = k.x + ox, tz = k.z + oz;
    if (melee) {
      const e = nearestEnemy(f.x, f.z, 4);
      if (e && Math.hypot(e.x - k.x, e.z - k.z) < w.leash) { tx = e.x - Math.sin(Math.atan2(e.x - f.x, e.z - f.z)) * 0.9; tz = e.z - Math.cos(Math.atan2(e.x - f.x, e.z - f.z)) * 0.9; }
    }
    const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
    const sp = Math.min(d, (KING_SPEED + 2) * dt * (d > 3 ? 1.6 : 1));
    if (d > 0.05) { f.x += dx / d * sp; f.z += dz / d * sp; }
    const face = f.atkT > 0 && f.aim !== undefined ? f.aim : (d > 0.2 ? Math.atan2(dx, dz) : k.yaw);
    f.yaw += angleDiff(face, f.yaw) * Math.min(1, dt * 10);
    f.moving = d > 0.2;
  });
  // recruits on their way to join someone
  for (let i = G.joiners.length - 1; i >= 0; i--) {
    const j = G.joiners[i], t = j.target;
    if (!G.followers.includes(t)) { G.joiners.splice(i, 1); continue; }
    const dx = t.x - j.x, dz = t.z - j.z, d = Math.hypot(dx, dz);
    j.bob += dt * 12;
    if (d < 0.5) { promote(t); G.joiners.splice(i, 1); continue; }
    const sp = Math.min(d, (KING_SPEED + 4) * dt); j.x += dx / d * sp; j.z += dz / d * sp; j.yaw = Math.atan2(dx, dz);
  }
  // ring scales with the troop
  const n = G.followers.length;
  G.ringR = (1.6 + 0.56 * Math.sqrt(n)) * spread;
}
function collideWalls(x0, z0, x1, z1) {
  if (!G.wallsUp) return [x1, z1];
  const a = inside(x0, z0), b = inside(x1, z1);
  if (a === b) return [x1, z1];
  const s = a ? segAt(x1, z1, x0, z0) : segAt(x0, z0, x1, z1);
  if (!s || s.gate || !s.alive) return [x1, z1];
  // slide along the wall instead of passing through it
  if (s.side === 'E' || s.side === 'W') return [x0, z1];
  return [x1, z0];
}

// -------------------------------------------------------------------- pads ----
function updatePads(dt) {
  const k = G.king;
  let onPad = null;
  for (const p of G.pads) {
    const vis = p.visible();
    if (vis !== p.visibleNow) { p.visibleNow = vis; p.mesh.visible = vis; if (vis) { p.cost = p.price(); p.paid = 0; p.mesh.scale.setScalar(0.01); p.popT = 0; } }
    if (!vis) continue;
    if (p.posFn) { const [x, z] = p.posFn(); if (x !== p.x || z !== p.z) { p.x = x; p.z = z; p.mesh.position.set(x, 0.06, z); p.popT = 0; p.mesh.scale.setScalar(0.01); } }
    if (p.popT !== undefined && p.popT < 1) { p.popT = Math.min(1, p.popT + dt * 4); const s = 1 + Math.sin(p.popT * Math.PI) * 0.25; p.mesh.scale.setScalar(Math.max(0.01, p.popT * s)); }
    if (Math.abs(k.x - p.x) < 2.0 && Math.abs(k.z - p.z) < 2.0) onPad = p;
  }
  G.padIn = onPad;
  if (onPad && G.coins >= 1) {
    const p = onPad, need = p.cost - p.paid;
    const rate = Math.max(10, p.cost * 0.7);
    G.spendAcc += rate * dt;
    const give = Math.min(Math.floor(G.spendAcc), Math.floor(G.coins), Math.ceil(need));
    if (give > 0) {
      G.spendAcc -= give; G.coins -= give; p.paid += give; G.spentFlash = 0.3;
      for (let i = 0; i < Math.min(give, 3); i++) G.flying.push({ x: k.x, y: stackTop(), z: k.z, t: 0, v: 0, to: 'pad', tx: p.x + (Math.random() - 0.5), tz: p.z + (Math.random() - 0.5) });
      if (p.paid >= p.cost) {
        const px = p.x, pz = p.z;
        p.buy(); p.paid = 0;
        burst(px, 0.5, pz, 10, '#7dff6a'); shockwave(px, pz, 3.2, '#7dff6a');
        // re-evaluate the next price for repeatable pads
        if (p.visible()) { p.cost = p.price(); p.popT = 0; }
      }
    }
  } else G.spendAcc = 0;
  // redraw changed pads
  for (const p of G.pads) {
    if (!p.visibleNow) continue;
    p.cost = p.price();
    const key = Math.ceil(p.cost - p.paid) + ':' + Math.floor((p.paid / p.cost) * 40) + ':' + (p.lv ? p.lv() : '');
    if (key !== p.key) { p.key = key; drawPad(p); }
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
function spark(x, y, z) {
  if (world.fx.length > 140) return;
  const s = new THREE.Sprite(world.sparkMat); s.position.set(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4); s.scale.setScalar(0.1);
  scene.add(s); world.fx.push({ o: s, t: 0, dur: 0.22, kind: 'spark', s0: 0.9 + Math.random() * 0.6 });
}
function puff(x, y, z, hex, n) {
  for (let i = 0; i < n; i++) {
    if (world.fx.length > 180) return;
    const m = new THREE.SpriteMaterial({ map: world.puffTex, color: hex, transparent: true, depthWrite: false });
    const s = new THREE.Sprite(m); s.position.set(x, y, z); scene.add(s);
    const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 2;
    world.fx.push({ o: s, t: 0, dur: 0.5 + Math.random() * 0.3, kind: 'puff', vx: Math.cos(a) * v, vy: 1 + Math.random() * 2, vz: Math.sin(a) * v, s0: 0.5 + Math.random() * 0.5 });
  }
}
// a ring of dust rolling outward from a building's foot
function dust(x, z, r, n) {
  for (let i = 0; i < n; i++) {
    if (world.fx.length > 230) return;
    const a = i / n * Math.PI * 2 + Math.random() * 0.3;
    const m = new THREE.SpriteMaterial({ map: world.puffTex, color: '#e6cba2', transparent: true, depthWrite: false });
    const s = new THREE.Sprite(m); s.position.set(x + Math.cos(a) * r, 0.5, z + Math.sin(a) * r); scene.add(s);
    world.fx.push({ o: s, t: 0, dur: 0.7 + Math.random() * 0.3, kind: 'puff', vx: Math.cos(a) * 3, vy: 0.8, vz: Math.sin(a) * 3, s0: 1.1 + Math.random() * 0.6 });
  }
}
function burst(x, y, z, n, hex) {
  for (let i = 0; i < n; i++) {
    if (world.fx.length > 230) return;
    const m = new THREE.SpriteMaterial({ map: world.sparkMat.map, color: hex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const s = new THREE.Sprite(m); s.position.set(x, y, z); scene.add(s);
    const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 3;
    world.fx.push({ o: s, t: 0, dur: 0.7, kind: 'puff', vx: Math.cos(a) * v, vy: 2 + Math.random() * 3, vz: Math.sin(a) * v, s0: 0.6 });
  }
}
function shockwave(x, z, r, hex) {
  const m = new THREE.Mesh(world.ringGeo, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.12, z); m.renderOrder = 4; m.scale.setScalar(0.1); scene.add(m);
  world.fx.push({ o: m, t: 0, dur: 0.6, kind: 'ring', s0: r });
}
function pillar(x, z, h) {
  const m = new THREE.Mesh(world.pillarGeo, new THREE.MeshBasicMaterial({ map: world.pillarTex, color: '#ffe48a', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.position.set(x, 0, z); m.scale.set(1.8, h, 1.8); scene.add(m);
  world.fx.push({ o: m, t: 0, dur: 0.9, kind: 'pillar', s0: 1.8, h });
}
// what a purchase looks like: dust, a ring on the ground, a column of light, sparkles and a little shake
function celebrate(x, z, h, big) {
  shockwave(x, z, big ? 7 : 5, '#ffffff');
  pillar(x, z, h + 4);
  burst(x, h, z, big ? 20 : 12, '#ffd84a');
  dust(x, z, 1.8, big ? 12 : 8);
  G.shake = Math.max(G.shake, big ? 0.32 : 0.2);
}
function boom(x, z) {
  const m = new THREE.SpriteMaterial({ map: world.puffTex, color: '#ffb02e', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(m); s.position.set(x, 0.8, z); scene.add(s);
  world.fx.push({ o: s, t: 0, dur: 0.35, kind: 'boom', s0: 5 });
  puff(x, 0.6, z, '#8a7f74', 6);
}
function floatText(txt, x, y, z, color, big = false) {
  if (G.texts.length > 40) return;
  const key = txt + color + big;
  let tex = world.textCache.get(key);
  if (!tex) {
    const w = big ? 640 : 256;
    tex = canvasTex(w, 128, (g) => { g.font = (big ? 72 : 84) + 'px "Lilita One", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = 16; g.strokeStyle = '#2a1d18'; g.strokeText(txt, w / 2, 66); g.fillStyle = color; g.fillText(txt, w / 2, 66); });
    if (world.textCache.size > 200) world.textCache.clear();
    world.textCache.set(key, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.position.set(x, y, z); s.scale.set(big ? 6.4 : 2.2, big ? 1.28 : 1.1, 1); s.renderOrder = 20; scene.add(s);
  G.texts.push({ o: s, t: 0, dur: big ? 1.8 : 0.9, rise: big ? 0.9 : 1.6, big });
}
const bigText = (txt, x, y, z) => floatText(txt, x, y, z, '#ffffff', true);
function updateFx(dt) {
  for (let i = world.fx.length - 1; i >= 0; i--) {
    const f = world.fx[i]; f.t += dt; const k = f.t / f.dur;
    if (k >= 1) { scene.remove(f.o); if (f.o.material !== world.sparkMat) f.o.material.dispose(); world.fx.splice(i, 1); continue; }
    if (f.kind === 'spark') f.o.scale.setScalar(f.s0 * Math.sin(k * Math.PI));
    else if (f.kind === 'boom') { f.o.scale.setScalar(f.s0 * (0.4 + k)); f.o.material.opacity = 1 - k; }
    else if (f.kind === 'ring') { f.o.scale.setScalar(f.s0 * (0.12 + 0.88 * easeOut(k))); f.o.material.opacity = 0.9 * (1 - k); }
    else if (f.kind === 'pillar') { const w = f.s0 * (1 - 0.75 * k); f.o.scale.set(w, f.h * (0.5 + 0.7 * easeOut(Math.min(1, k * 2))), w); f.o.material.opacity = 0.7 * (1 - k); }
    else if (f.kind === 'smoke') { f.o.position.y += dt * 1.6; f.o.position.x += dt * 0.5; f.o.scale.setScalar(f.s0 * (0.6 + k * 1.6)); f.o.material.opacity = 0.55 * Math.sin(k * Math.PI); }
    else { f.o.position.x += f.vx * dt; f.o.position.y += f.vy * dt; f.o.position.z += f.vz * dt; f.vy -= 4 * dt; f.o.scale.setScalar(f.s0 * (0.6 + k)); f.o.material.opacity = 1 - k; }
  }
  for (let i = G.texts.length - 1; i >= 0; i--) {
    const t = G.texts[i]; t.t += dt;
    t.o.position.y += dt * t.rise;
    if (t.big) { const k = Math.min(1, t.t / 0.25); t.o.scale.set(6.4 * easeOutBack(k), 1.28 * easeOutBack(k), 1); }
    t.o.material.opacity = Math.min(1, 2.5 * (1 - t.t / t.dur));
    if (t.t > t.dur) { scene.remove(t.o); t.o.material.dispose(); G.texts.splice(i, 1); }
  }
}

// ------------------------------------------------------------------ render ----
function setI(mesh, i, x, y, z, yaw, s, roll = 0) {
  tmpM.compose(tmpV.set(x, y, z), tmpQ.setFromEuler(tmpE.set(0, yaw, roll, 'YXZ')), tmpS.set(s, s, s));
  mesh.setMatrixAt(i, tmpM);
}
// coins heaped on the gold plot: a low cone that grows with the amount
const PILE = Array.from({ length: 80 }, (_, i) => { const a = i * 2.39996, r = 0.2 * Math.sqrt(i + 0.5); return [Math.cos(a) * r, Math.sin(a) * r, r, (i * 0.37) % 1]; });
const ecount = {};
function syncScene(dt) {
  const W = world, k = G.king;
  animBuildings(dt);
  if (G.wallsAnim) rebuildWalls(dt);
  updateThemes(dt);
  // king
  W.king.position.set(k.x, Math.abs(Math.sin(k.bob)) * 0.08, k.z);
  W.king.rotation.y = k.yaw;
  W.ring.position.set(k.x, 0.07, k.z); W.ring.scale.setScalar(G.ringR || 2);
  // followers + tower archers + weapons
  let n = 0, wn = 0, sh = 0;
  const wt = G.tier, wMesh = W.weapons[Math.min(wt, 6)], rn = [0, 0, 0];
  for (const m of W.weapons) m.count = 0;
  const putTroop = (x, y, z, yaw, bob, moving, rank = 1, pop = 0) => {
    const tier = rankTier(rank), s = RANKS[tier].s * (1 + 0.3 * Math.sin((1 - pop) * Math.PI) * (pop > 0 ? 1 : 0));
    const by = moving ? Math.abs(Math.sin(bob)) * 0.12 : 0, roll = moving ? Math.sin(bob) * 0.08 : 0;
    if (tier === 0) setI(W.follower, n++, x, y + by, z, yaw, s, roll); else setI(W.followerR[tier - 1], rn[tier - 1]++, x, y + by, z, yaw, s, roll);
    setI(wMesh, wn++, x, y + by, z, yaw, s, roll);
    setI(W.shadow, sh++, x, 0.05, z, 0, 1.1 * s);
  };
  for (const f of G.followers) putTroop(f.x, 0, f.z, f.yaw, f.bob, f.moving, f.rank, f.pop);
  for (const j of G.joiners) putTroop(j.x, 0, j.z, j.yaw, j.bob, true);
  W.followerR.forEach((m, i) => { m.count = rn[i]; m.visible = rn[i] > 0; m.instanceMatrix.needsUpdate = true; });
  // archers stand on their tower once it has finished going up
  const tw = weapon(true), towerMesh = W.weapons[tw.tier], archers = [];
  for (const t of G.towers) {
    if (!t.built || t.b.t < 1) continue;
    const lv = TOWER_LV[t.b.lv - 1];
    for (let i = 0; i < lv.archers; i++) { const o = TOWER_SLOTS[i]; archers.push([t.x + o[0], lv.h, t.z + o[1], t.aim ?? Math.PI * 0.75]); }
  }
  for (const [x, y, z, yaw] of archers) {
    if (n >= 180 || wn >= 160) break;
    setI(W.follower, n++, x, y, z, yaw, 1);
    if (towerMesh === wMesh) setI(wMesh, wn++, x, y, z, yaw, 1);
  }
  W.follower.count = n; wMesh.count = wn;
  W.follower.instanceMatrix.needsUpdate = true; wMesh.instanceMatrix.needsUpdate = true;
  // tower archers keep spears while the troop uses swords: draw those separately
  if (towerMesh !== wMesh) {
    let m = 0;
    for (const [x, y, z, yaw] of archers) setI(towerMesh, m++, x, y, z, yaw, 1);
    towerMesh.count = m; towerMesh.instanceMatrix.needsUpdate = true;
  }
  // gold boys and their sacks
  let bn = 0;
  for (const b of G.gold.boys) {
    const by = b.moving ? Math.abs(Math.sin(b.bob)) * 0.14 : 0, roll = b.moving ? Math.sin(b.bob) * 0.08 : 0;
    setI(W.boy, bn, b.x, by, b.z, b.yaw, 1.05, roll);
    const fill = Math.min(1, b.load / GOLD_BOYS[G.gold.lv - 1].cap), ss = 0.55 + fill * 0.75;
    tmpM.compose(tmpV.set(b.x - Math.sin(b.yaw) * (0.36 + ss * 0.12), 0.85 + by + ss * 0.12, b.z - Math.cos(b.yaw) * (0.36 + ss * 0.12)), tmpQ.setFromEuler(tmpE.set(0, b.yaw, roll, 'YXZ')), tmpS.set(ss, ss, ss));
    W.sack.setMatrixAt(bn, tmpM);
    setI(W.shadow, sh++, b.x, 0.05, b.z, 0, 1.1);
    bn++;
  }
  W.boy.count = W.sack.count = bn; W.boy.instanceMatrix.needsUpdate = W.sack.instanceMatrix.needsUpdate = true;
  // ghost recruits on the barracks pad
  const rp = G.pads.find(p => p.id === 'recruit');
  let gn = 0;
  if (rp.visibleNow) { const cnt = recruitStep()[1]; for (let i = 0; i < Math.min(cnt, 6); i++) { const o = [[0, 0], [-0.7, 0.5], [0.7, 0.5], [-0.7, -0.5], [0.7, -0.5], [0, 0.9]][i]; setI(W.ghost, gn++, rp.x + o[0], 0.05, rp.z + o[1], Math.PI * 0.75, 1); } }
  W.ghost.count = gn; W.ghost.instanceMatrix.needsUpdate = true;
  // enemies
  for (const key of W.ekeys) ecount[key] = 0;
  let bars = 0;
  const barQ = camera.quaternion;
  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    const m = W.emesh[e.mkey], i = ecount[e.mkey];
    if (i >= m.userData.cap) continue;
    ecount[e.mkey] = i + 1;
    const lx = Math.sin(e.yaw) * e.lunge * 0.35 * e.scale, lz = Math.cos(e.yaw) * e.lunge * 0.35 * e.scale;
    const by = Math.abs(Math.sin(e.bob)) * 0.1 * e.scale, roll = Math.sin(e.bob) * (e.kind === 'knight' ? 0.07 : 0.05);
    setI(m, i, e.x + lx, by, e.z + lz, e.yaw, e.scale, roll);
    const u = UNIT[e.kind];
    if (sh < 1200) setI(W.shadow, sh++, e.x, 0.05, e.z, 0, u.shadow);
    if (e.hp < e.max && bars < 690) bar(bars++, e.x, u.bar, e.z, u.barW, e.hp / e.max, '#e8242c', barQ);
  }
  for (const key of W.ekeys) { const m = W.emesh[key]; m.count = ecount[key]; m.visible = m.count > 0; m.instanceMatrix.needsUpdate = true; }
  // wall health
  for (const s of G.segs) if (s.alive && s.hitT > 0 && bars < 698) bar(bars++, s.cx, 3.2, s.cz, 1.6, s.hp / s.max, '#2fd04a', barQ);
  const cs = G.castle;
  if (cs.hp < cs.max && bars < 699) bar(bars++, cs.x, 7.6, cs.z, 3.6, cs.hp / cs.max, '#2fd04a', barQ);
  W.barBg.count = bars; W.barFill.count = bars;
  W.barBg.instanceMatrix.needsUpdate = true; W.barFill.instanceMatrix.needsUpdate = true; W.barFill.instanceColor.needsUpdate = true;
  setI(W.shadow, sh++, k.x, 0.05, k.z, k.yaw, 1.9);
  W.shadow.count = sh; W.shadow.instanceMatrix.needsUpdate = true;
  // coins: ground, flying, the gold plot and the king's stack
  let c = 0;
  const coinAt = (x, y, z, rx, ry) => { tmpM.compose(tmpV.set(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, 0)), tmpS.set(1, 1, 1)); W.coin.setMatrixAt(c++, tmpM); };
  for (const g of G.coinsOnGround) if (c < 1700) coinAt(g.x, g.y, g.z, g.rest ? 0 : g.spin, g.spin);
  for (const f of G.flying) if (c < 1780) coinAt(f.x, f.y, f.z, 0.3, f.t * 6);
  const pl = G.gold.plot;
  if (G.gold.built && pl.value >= 1) {
    const pn = Math.min(PILE.length, Math.ceil(pl.value / 4)), H = 0.1 + 0.9 * pn / PILE.length;
    for (let i = 0; i < pn; i++) { const [ox, oz, r, j] = PILE[i]; coinAt(pl.x + ox, 0.2 + Math.max(0, H * (1 - r / 1.9)) + j * 0.05, pl.z + oz, (j - 0.5) * 0.5, j * 6); }
  }
  const stackN = Math.min(Math.floor(G.coins), 400), bx = k.x - Math.sin(k.yaw) * 0.55, bz = k.z - Math.cos(k.yaw) * 0.55;
  for (let i = 0; i < stackN && c < 1890; i++) { const sway = Math.sin(k.bob * 0.5 + i * 0.02) * i * 0.0006; coinAt(bx + Math.sin(k.yaw) * sway, 1.3 + i * 0.1 + W.king.position.y, bz + Math.cos(k.yaw) * sway, 0, i * 0.3); }
  W.coin.count = c; W.coin.instanceMatrix.needsUpdate = true;
  // projectiles
  const cnt = { arrow: 0, arrow2: 0, bolt: 0, spear: 0, bullet: 0, ball: 0 };
  for (const p of G.projectiles) {
    const m = W.proj[p.kind]; if (!m || cnt[p.kind] >= m.userData.cap) continue;
    let yaw = 0, pitch = 0;
    if (p.dir) { yaw = Math.atan2(p.dir[0], p.dir.length === 3 ? p.dir[2] : p.dir[1]); pitch = p.dir.length === 3 ? -Math.asin(Math.max(-1, Math.min(1, p.dir[1]))) : 0; }
    tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ.setFromEuler(tmpE.set(pitch, yaw, 0, 'YXZ')), tmpS.set(1, 1, 1));
    m.setMatrixAt(cnt[p.kind]++, tmpM);
  }
  for (const key in cnt) { W.proj[key].count = cnt[key]; W.proj[key].instanceMatrix.needsUpdate = true; }
  // cannons aim, the castle falls, gates open for the king
  for (const cn of G.cannons) if (cn.turret) cn.turret.rotation.y = cn.yaw;
  if (G.over) { cs.fall = Math.min(1, cs.fall + dt * 0.8); W.castle.scale.set(1 + cs.fall * 0.08, Math.max(0.05, 1 - cs.fall * 0.85), 1 + cs.fall * 0.08); W.castle.rotation.z = Math.sin(cs.fall * 9) * 0.03 * (1 - cs.fall); }
  for (const gt of W.gates) {
    const want = gt.group.visible && Math.hypot(k.x - gt.x, k.z - gt.z) < 3.8 ? 1 : 0;
    gt.open += (want - gt.open) * Math.min(1, dt * 6);
    gt.a.rotation.y = -gt.open * 1.4 * gt.sgn; gt.b.rotation.y = gt.open * 1.4 * gt.sgn;
  }
  // chevrons toward the next pad you can afford
  const gtg = guideTarget();
  let cv = 0;
  if (gtg && gtg !== G.padIn) {
    const dx = gtg.x - k.x, dz = gtg.z - k.z, d = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
    const start = (G.ringR || 2) * 0.6, end = d - 1.7, step = 0.75, off = (G.t * 1.6) % step;
    for (let s = start + off; s < end && cv < 30; s += step) {
      tmpM.compose(tmpV.set(k.x + dx / d * s, 0.09, k.z + dz / d * s), tmpQ.setFromEuler(tmpE.set(0, yaw + Math.PI, 0)), tmpS.set(0.8, 1, 0.8));
      W.chev.setMatrixAt(cv, tmpM);
      const fade = Math.min(1, (s - start) / 1.2) * Math.min(1, (end - s) / 1.2);
      W.chev.setColorAt(cv, tmpC.set('#1f9dff').lerp(new THREE.Color('#5fe3ff'), fade).multiplyScalar(0.55 + 0.45 * fade));
      cv++;
    }
  }
  W.chev.count = cv; W.chev.instanceMatrix.needsUpdate = true; if (W.chev.instanceColor) W.chev.instanceColor.needsUpdate = true;
  W.lavaTex.offset.set(G.t * 0.05, G.t * 0.03);
  // camera and light follow the king; purchases give it a small shake
  const tx = k.x, tz = k.z;
  camera.position.set(tx + CAM_DIR.x * G.camDist, CAM_DIR.y * G.camDist, tz + CAM_DIR.z * G.camDist);
  camera.lookAt(tx, 0, tz);
  if (G.shake > 0) { const s = G.shake * G.shake * 1.6; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s; G.shake = Math.max(0, G.shake - dt * 1.1); }
  sun.position.set(tx - 14, 34, tz + 10); sun.target.position.set(tx, 0, tz);
}
// outer roads fading in once opened; the ash vents smoke while the king is near
function updateThemes(dt) {
  for (let i = 1; i < world.themes.length; i++) {
    const th = world.themes[i];
    if (th.revealT < 0) continue;
    if (th.revealT < 4) {
      th.revealT += dt;
      const k = Math.min(1, th.revealT / 1.5); th.overlay.material.opacity = k * k * (3 - 2 * k);
      for (const it of th.items) { const q = Math.max(0, Math.min(1, (th.revealT - it.userData.delay) / 0.5)); it.scale.setScalar(Math.max(0.001, it.userData.s * easeOutBack(q))); }
    }
    if (th.vents.length && Math.hypot(G.king.x - THEMES[i].center[0], G.king.z - THEMES[i].center[1]) < 50) {
      th.ventT -= dt;
      if (th.ventT <= 0 && world.fx.length < 200) {
        th.ventT = 0.35;
        const [x, z] = th.vents[(Math.random() * th.vents.length) | 0];
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: world.puffTex, color: '#6a6262', transparent: true, depthWrite: false }));
        s.position.set(x, 1.0, z); scene.add(s);
        world.fx.push({ o: s, t: 0, dur: 2.2, kind: 'smoke', s0: 1.1 });
      }
    }
  }
}
function bar(i, x, y, z, w, frac, hex, q) {
  const W = world;
  tmpM.compose(tmpV.set(x, y, z), q, tmpS.set(w + 0.1, 0.2, 1)); W.barBg.setMatrixAt(i, tmpM);
  const fw = Math.max(0.001, w * Math.max(0, frac));
  // shift the fill left inside the billboard plane
  const right = tmpV.set(1, 0, 0).applyQuaternion(q);
  tmpM.compose(new THREE.Vector3(x - right.x * (w - fw) / 2, y + 0.005, z - right.z * (w - fw) / 2), q, tmpS.set(fw, 0.12, 1));
  W.barFill.setMatrixAt(i, tmpM); W.barFill.setColorAt(i, tmpC.set(hex));
}

// --------------------------------------------------------------------- HUD ----
function updateHud(force) {
  const c = Math.floor(G.coins);
  if (force || c !== ui.lastCoins) { ui.coins.textContent = c; ui.lastCoins = c; }
  ui.coins.classList.toggle('spend', G.spentFlash > 0);
  ui.coins.classList.toggle('gain', G.spentFlash <= 0 && G.gainFlash > 0);
}
function toast(msg) {
  const t = ui.toast; if (!t) return;
  t.textContent = msg; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
}
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function gameOver() {
  if (G.over) return;
  G.over = true;
  const cs = G.castle;
  for (let i = 0; i < 4; i++) puff(cs.x + (Math.random() - 0.5) * 3, 2 + i, cs.z + (Math.random() - 0.5) * 3, '#d8d0c4', 8);
  let best = 0;
  try { best = +(localStorage.getItem('castle.bestTime') || 0); if (G.t > best) localStorage.setItem('castle.bestTime', String(Math.floor(G.t))); } catch (e) {}
  ui.overText.textContent = G.t > best ? `You held out for ${clock(G.t)}, your longest yet.` : `You held out for ${clock(G.t)}. Your longest is ${clock(best)}.`;
  setTimeout(() => { if (G.over) ui.over.hidden = false; }, 1400);
}

// -------------------------------------------------------------------- input ----
const keys = new Set();
let idleJoystick = () => {};
function initInput() {
  const joy = ui.joy, knob = ui.knob;
  let pid = null, ox = 0, oy = 0;
  const R = 56;
  canvas.addEventListener('pointerdown', (e) => {
    if (pid !== null || !G || G.over) return;
    pid = e.pointerId; ox = e.clientX; oy = e.clientY;
    const r = ui.root.getBoundingClientRect();
    joy.style.left = (ox - r.left) + 'px'; joy.style.top = (oy - r.top) + 'px'; joy.hidden = false; knob.style.transform = 'translate(-50%,-50%)';
    canvas.setPointerCapture(pid); joy.classList.remove('idle');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    let dx = e.clientX - ox, dy = e.clientY - oy; const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const jx = dx / R, jy = -dy / R;
    G.input.x = jx * SCR_R.x + jy * SCR_U.x; G.input.z = jx * SCR_R.z + jy * SCR_U.z;
  });
  const end = (e) => { if (e.pointerId !== pid) return; pid = null; joy.hidden = true; G.input.x = G.input.z = 0; };
  // before the first move the stick waits in the bottom-right corner, like a resting thumb
  idleJoystick = (on) => { joy.classList.toggle('idle', on); joy.hidden = !on; joy.style.left = ''; joy.style.top = ''; knob.style.transform = 'translate(-50%,-50%)'; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  window.addEventListener('keydown', (e) => { if (!running) return; const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); e.preventDefault(); if (joy.classList.contains('idle')) idleJoystick(false); } if (k === 'escape') togglePause(); });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
}
let keysWereDown = false;
function keyInput() {
  if (G.over) return;
  if (!keys.size) { if (keysWereDown) { G.input.x = G.input.z = 0; keysWereDown = false; } return; }
  keysWereDown = true;
  const jx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const jy = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  G.input.x = jx * SCR_R.x + jy * SCR_U.x; G.input.z = jx * SCR_R.z + jy * SCR_U.z;
}
function togglePause(force) {
  if (!G || G.over) return;
  G.paused = force ?? !G.paused;
  ui.pause.hidden = !G.paused;
}

// --------------------------------------------------------------------- loop ----
function step(dt) {
  if (G.over) { G.t += dt; updateFx(dt); return; }
  G.t += dt;
  const cs = G.castle;
  if (cs.hitT > 0) cs.hitT -= dt; else if (cs.hp < cs.max) cs.hp = Math.min(cs.max, cs.hp + cs.max * 0.01 * dt);
  keyInput();
  updateSpawns(dt);
  rebuildGrid();
  updateTroop(dt);
  updateEnemies(dt);
  rebuildGrid();
  updateShooting(dt);
  updateProjectiles(dt);
  // remove the dead
  G.enemies = G.enemies.filter(e => e.hp > 0);
  updateCoins(dt);
  updateGold(dt);
  updatePads(dt);
  for (const s of G.segs) { if (s.hitT > 0) s.hitT -= dt; else if (s.alive && s.hp < s.max) s.hp = Math.min(s.max, s.hp + s.max * 0.006 * dt); }
  G.spentFlash = Math.max(0, G.spentFlash - dt); G.gainFlash = Math.max(0, G.gainFlash - dt);
  G.stats.maxEnemies = Math.max(G.stats.maxEnemies, G.enemies.length);
  updateFx(dt);
}
let last = 0;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000 || 0)); last = Math.max(last, now);
  if (!G.paused) step(dt);
  syncScene(G.paused ? 0 : dt);
  updateHud();
  renderer.render(scene, camera);
}
function resize() {
  const r = ui.root.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  // landscape shows about 33 units of ground top to bottom, portrait about 25 across
  const span = w >= h ? 33 : Math.min(60, 25.5 / (w / h));
  if (G) G.camDist = span / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}

// ------------------------------------------------------------------ public ----
function setup() {
  ui = {
    root: document.getElementById('cd-app'), coins: document.getElementById('cd-coins'), toast: document.getElementById('cd-toast'),
    joy: document.getElementById('cd-joy'), knob: document.querySelector('#cd-joy .cd-knob'), pause: document.getElementById('cd-pausemenu'), over: document.getElementById('cd-over'), overText: document.getElementById('cd-over-text'),
  };
  initRenderer(); buildTerrain(); buildWorld(); initInput();
  document.getElementById('cd-pause-btn').onclick = () => togglePause(true);
  document.getElementById('cd-resume').onclick = () => togglePause(false);
  document.getElementById('cd-restart').onclick = () => { ui.pause.hidden = true; startGame(); };
  document.getElementById('cd-retry').onclick = () => { ui.over.hidden = true; startGame(); };
  for (const id of ['cd-menu1', 'cd-menu2']) document.getElementById(id).onclick = () => { if (window.GameHub) window.GameHub.menu(); };
  window.addEventListener('resize', () => { if (running) resize(); });
  started = true;
}
function startGame() {
  newGame(); resize();
  ui.over.hidden = true; ui.pause.hidden = true; idleJoystick(true);
  if (ui.toast) ui.toast.classList.remove('show');
}
async function show() {
  if (!started) setup();
  await fontReady;
  if (!G) startGame(); else resize();
  if (G && !G.over) G.paused = !ui.pause.hidden;
  if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
}
function hide() {
  running = false; cancelAnimationFrame(raf);
  if (G && !G.over) { G.paused = true; ui.pause.hidden = false; }
}
window.CastleDefender = { show, hide };

