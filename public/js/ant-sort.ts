// Ant Sort: tap a block in the front row to put it in a free slot, and ants come out for every block of that colour
// they can reach and carry it into the hole.
//
// The scene, the ants and the rules are plain code, set up when the page loads. The hub opens the game (`game`, at
// the bottom) in a scope while its screen is shown: the listeners, the frame loop, the confetti and the link to the
// per-user store run in it and stop when the player leaves. A level left unfinished waits for them to come back, and
// is saved, so that it is there after a reload too.
import { Cause, Effect, Fiber, FiberHandle, Option, Predicate, Queue, Schema, Stream } from 'effect';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import levels from './ant-sort-levels.json';
import {
  type LevelData,
  Sim,
  type SimLevel,
  type SimSave,
  type TickEvent,
  simFromSave,
  simLevel,
  simSave,
} from './ant-sort-logic';
import { type Game, GameHub } from './hub';
import { animate, forget, listen, load, nextFrame, run, save } from './page';
import { keepOnly } from './schemas';

const DATA = levels as { levels: LevelData[] };
// number labels are drawn on canvas, so a level waits for the display face (one that fails to load leaves the
// fallback face)
class FontError extends Schema.TaggedError<FontError>()('FontError', {}) {}
const loadFont = Effect.tryPromise({
  try: () => document.fonts.load('132px "Lilita One"'),
  catch: () => new FontError(),
}).pipe(
  Effect.asVoid,
  Effect.catchTag('FontError', () => Effect.void),
);
// each level carries its own palette; these point at the current level's colours
let HEX: string[] = [],
  COLORS: THREE.Color[] = [];
function usePalette(pal: string[]) {
  HEX = pal;
  COLORS = pal.map((h) => new THREE.Color(h));
}
const EMPTY_CELL = 255;

// ---- reference geometry: 1 world unit = 22.5px on a 1206px wide screen ----
const REF_W = 1206,
  REF_H = 2335,
  PXU = 22.5;
const TILT = (27 * Math.PI) / 180,
  COS = Math.cos(TILT),
  SIN = Math.sin(TILT);
const ORIGIN_Y = 566; // reference pixel row of world origin
const TRAY_W = 51.2,
  TRAY_D = 51.0,
  FLOOR_Y = 0.6,
  RIM_Y = 1.0;
const PIC_Z = 0.35;
const HOLE = { x: -0.2, z: 34.7, r: 2.7 };
const SLOT_X = [-17, -8.5, 0, 8.5, 17],
  SLOT_Z = 49.3,
  JAR_Z = 49.4;
const PED = { w: 7.3, h: 1.6, d: 7.0 };
const JAR = { w: 6.4, h: 4.2, d: 5.3 };
const COL_X = [-8.5, 0, 8.5];
const BLOCK = { w: 6.4, h: 3.6, d: 5.6 };
const rowZ = (r: number) => (r === 0 ? 60.5 : 69.9 + (r - 1) * 8.35);
const TICK = 0.14,
  ANT_SPEED = 11,
  ANT_SCALE = 1.3;

const app = document.getElementById('app')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
// cool fill on the sides, the rest from straight above, so top faces show their exact colour
scene.add(new THREE.AmbientLight(new THREE.Color(0.47, 0.38, 0.52), Math.PI));
const sun = new THREE.DirectionalLight(new THREE.Color(0.53, 0.62, 0.48), Math.PI);
sun.position.set(0, 10, 0);
scene.add(sun);

// ---------- textures ----------
type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;
function canvasTex(w: number, h: number, draw: Draw, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// soft rounded-rect shadow used under tiles, blocks and the tray
const softShadowTex = canvasTex(128, 128, (g) => {
  g.filter = 'blur(10px)';
  g.fillStyle = 'rgba(110,50,30,1)';
  roundRect(g, 24, 24, 80, 80, 18);
  g.fill();
});
function shadowPlane(w: number, d: number, opacity: number) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: softShadowTex, transparent: true, opacity, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -1;
  return m;
}
const blobTex = canvasTex(64, 64, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(90,50,40,0.55)');
  gr.addColorStop(0.55, 'rgba(90,50,40,0.25)');
  gr.addColorStop(1, 'rgba(90,50,40,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, w);
});

// ---------- background (screen-space gradient) ----------
let bgTex: THREE.CanvasTexture | null = null;
function makeBackground(w: number, h: number, S: number, OX: number) {
  const k = 0.25,
    cw = Math.max(8, Math.round(w * k)),
    ch = Math.max(8, Math.round(h * k));
  if (bgTex) bgTex.dispose();
  bgTex = canvasTex(cw, ch, (g) => {
    g.fillStyle = '#ecb395';
    g.fillRect(0, 0, cw, ch);
    const cx = (OX + 603 * S) * k,
      cy = 1250 * S * k,
      rx = 700 * S * k,
      ry = 1100 * S * k;
    g.save();
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, '#ecc6a2');
    gr.addColorStop(0.35, '#ecc4a1');
    gr.addColorStop(0.6, '#ebbd9c');
    gr.addColorStop(0.85, '#ebb697');
    gr.addColorStop(1, '#ecb395');
    g.fillStyle = gr;
    g.fillRect(-rx * 2, -rx * 2, rx * 4, rx * 4);
    g.restore();
  });
  scene.background = bgTex;
}

// ---------- number labels ----------
const numCache = new Map<number, THREE.CanvasTexture>();
function numberTex(n: number) {
  if (numCache.has(n)) return numCache.get(n)!;
  const t = canvasTex(320, 180, (g, w, h) => {
    g.font = '132px "Lilita One"';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 22;
    g.strokeStyle = '#3b2326';
    const s = String(n),
      y = h / 2 + 8;
    g.strokeText(s, w / 2, y);
    const gr = g.createLinearGradient(0, y - 50, 0, y + 50);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(1, '#ece5f1');
    g.fillStyle = gr;
    g.fillText(s, w / 2, y);
  });
  numCache.set(n, t);
  return t;
}
const numGeo = new THREE.PlaneGeometry(7.2, 4.05);
function numberPlane(n: number) {
  const m = new THREE.Mesh(
    numGeo,
    new THREE.MeshBasicMaterial({ map: numberTex(n), transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.scale.y = 1 / COS;
  m.renderOrder = 2;
  return m;
}

// ---------- shared geometry/materials ----------
function rrShapeEarly(w: number, d: number, r: number) {
  const sh = new THREE.Shape(),
    x = -w / 2,
    y = -d / 2;
  sh.moveTo(x + r, y);
  sh.lineTo(x + w - r, y);
  sh.quadraticCurveTo(x + w, y, x + w, y + r);
  sh.lineTo(x + w, y + d - r);
  sh.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  sh.lineTo(x + r, y + d);
  sh.quadraticCurveTo(x, y + d, x, y + d - r);
  sh.lineTo(x, y + r);
  sh.quadraticCurveTo(x, y, x + r, y);
  return sh;
}
const voxGeo = new RoundedBoxGeometry(1.0, 1.0, 1.0, 1, 0.22);
const blockGeo = new RoundedBoxGeometry(BLOCK.w, BLOCK.h, BLOCK.d, 4, 1.05);
const outlineGeo = new RoundedBoxGeometry(BLOCK.w + 0.8, BLOCK.h + 0.8, BLOCK.d + 0.8, 4, 1.4);
const pedGeo = new RoundedBoxGeometry(PED.w, PED.h, PED.d, 4, 0.6);
const jarGeo = new RoundedBoxGeometry(JAR.w, JAR.h, JAR.d, 4, 1.1);
const capGeo = new RoundedBoxGeometry(5.2, 1.9, 3.2, 4, 0.75);
const capInGeo = new THREE.ShapeGeometry(rrShapeEarly(4.0, 2.0, 0.45), 6);
capInGeo.rotateX(-Math.PI / 2);
const matCache = new Map<string, THREE.MeshLambertMaterial>();
function lambert(hex: string) {
  if (!matCache.has(hex)) matCache.set(hex, new THREE.MeshLambertMaterial({ color: hex }));
  return matCache.get(hex)!;
}
const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
// UI blocks read a touch brighter than the board in the reference
const UI_HEX: Record<string, string> = {
  '#90defa': '#7be8fc',
  '#f7f5f9': '#f2eefd',
  '#f3c7ee': '#f6d3f2',
  '#48434a': '#2e252c',
};
const uiHex = (i: number) => UI_HEX[HEX[i].toLowerCase()] || HEX[i];
const isLight = (i: number) => {
  const c = COLORS[i];
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.75;
};

// ---------- static scene: tray, hole, slots ----------
const world = new THREE.Group();
scene.add(world);
function buildTray() {
  const g = new THREE.Group();
  // drop shadow
  const sh = shadowPlane(TRAY_W * 1.28, TRAY_D * 1.28, 0.22);
  sh.position.set(0, 0.01, 0.7);
  g.add(sh);
  // base slab
  const base = new THREE.Mesh(
    new RoundedBoxGeometry(TRAY_W, FLOOR_Y + 0.02, TRAY_D, 3, 0.3),
    new THREE.MeshBasicMaterial({ vertexColors: true }),
  );
  shadeByNormal(base.geometry, '#efdbd3', '#e6cbc1', '#d8b8ab');
  base.position.y = (FLOOR_Y + 0.02) / 2;
  g.add(base);
  // rim: rounded-rect frame extruded upward
  const shape = rrShape(TRAY_W, TRAY_D, 1.45);
  shape.holes.push(rrShape(TRAY_W - 1.5, TRAY_D - 1.5, 0.85));
  const rimGeo = new THREE.ExtrudeGeometry(shape, {
    depth: RIM_Y - FLOOR_Y - 0.12,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.16,
    bevelSegments: 3,
    curveSegments: 10,
  });
  rimGeo.rotateX(-Math.PI / 2);
  rimGeo.translate(0, FLOOR_Y, 0);
  shadeByNormal(rimGeo, '#f1ddd6', '#ead2ca', '#e4c9c0');
  g.add(new THREE.Mesh(rimGeo, new THREE.MeshBasicMaterial({ vertexColors: true })));
  // floor with fine dots and a soft inner shadow along the far walls
  const fw = TRAY_W - 1.5,
    fd = TRAY_D - 1.5;
  const floorTex = canvasTex(1024, 1024, (c, w, h) => {
    c.fillStyle = '#e7d6ce';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(205,180,170,0.35)';
    for (let y = 4; y < h; y += 9) for (let x = ((y / 9) % 2) * 4.5; x < w; x += 9) c.fillRect(x, y, 2, 2);
    const top = c.createLinearGradient(0, 0, 0, 40);
    top.addColorStop(0, 'rgba(170,120,105,0.32)');
    top.addColorStop(1, 'rgba(170,120,105,0)');
    c.fillStyle = top;
    c.fillRect(0, 0, w, 40);
    const left = c.createLinearGradient(0, 0, 26, 0);
    left.addColorStop(0, 'rgba(170,120,105,0.18)');
    left.addColorStop(1, 'rgba(170,120,105,0)');
    c.fillStyle = left;
    c.fillRect(0, 0, 26, h);
    const right = c.createLinearGradient(w, 0, w - 26, 0);
    right.addColorStop(0, 'rgba(170,120,105,0.18)');
    right.addColorStop(1, 'rgba(170,120,105,0)');
    c.fillStyle = right;
    c.fillRect(w - 26, 0, 26, h);
  });
  const floor = new THREE.Mesh(
    new THREE.ShapeGeometry(rrShape(fw, fd, 0.85), 10),
    new THREE.MeshBasicMaterial({ map: floorTex }),
  );
  // ShapeGeometry UVs are in shape units; remap to 0..1
  const uv = floor.geometry.attributes.uv,
    pos = floor.geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / fw + 0.5, pos.getY(i) / fd + 0.5);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y + 0.005;
  g.add(floor);
  return g;
}
function rrShape(w: number, d: number, r: number) {
  const s = new THREE.Shape(),
    x = -w / 2,
    y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// unlit colouring by face direction (top / side / downward-facing)
function shadeByNormal(geo: THREE.BufferGeometry, top: string, side: string, bottom: string) {
  const n = geo.attributes.normal,
    cols = new Float32Array(n.count * 3);
  const ct = new THREE.Color(top),
    cs = new THREE.Color(side),
    cb = new THREE.Color(bottom),
    tmp = new THREE.Color();
  for (let i = 0; i < n.count; i++) {
    const ny = n.getY(i);
    if (ny >= 0) tmp.copy(cs).lerp(ct, Math.pow(ny, 1.5));
    else tmp.copy(cs).lerp(cb, -ny);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}
function buildHole() {
  const tex = canvasTex(256, 256, (g, w) => {
    const c = w / 2;
    // light lip around the hole
    let gr = g.createRadialGradient(c, c + 6, c * 0.78, c, c, c);
    gr.addColorStop(0, 'rgba(244,214,186,0.9)');
    gr.addColorStop(1, 'rgba(244,214,186,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    // pit
    g.save();
    g.beginPath();
    g.arc(c, c, c * 0.8, 0, Math.PI * 2);
    g.clip();
    gr = g.createLinearGradient(0, c * 0.2, 0, c * 1.8);
    gr.addColorStop(0, '#4f342f');
    gr.addColorStop(0.45, '#6e504a');
    gr.addColorStop(1, '#8b6f68');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
    gr = g.createRadialGradient(c * 1.05, c * 0.95, 0, c * 1.05, c * 0.95, c * 0.55);
    gr.addColorStop(0, 'rgba(190,175,172,0.75)');
    gr.addColorStop(1, 'rgba(190,175,172,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
    // far wall shading
    gr = g.createLinearGradient(0, c * 0.2, 0, c * 0.75);
    gr.addColorStop(0, 'rgba(40,22,20,0.55)');
    gr.addColorStop(1, 'rgba(40,22,20,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
    g.restore();
    g.strokeStyle = 'rgba(120,80,65,0.5)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(c, c, c * 0.8, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
  });
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(HOLE.r * 2.5, HOLE.r * 2.5),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(HOLE.x, 0.02, HOLE.z);
  m.renderOrder = -1;
  return m;
}
function buildPedestals() {
  const g = new THREE.Group();
  const geo = pedGeo.clone();
  shadeByNormal(geo, '#fefcfd', '#d9d4d8', '#c4b9bb');
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  for (const x of SLOT_X) {
    const p = new THREE.Mesh(geo, mat);
    p.position.set(x, PED.h / 2, SLOT_Z);
    g.add(p);
    const sh = shadowPlane(PED.w * 1.45, PED.d * 1.5, 0.28);
    sh.position.set(x, 0.015, SLOT_Z + 0.9);
    g.add(sh);
  }
  return g;
}
world.add(buildTray(), buildHole(), buildPedestals());

// ---------- ants (instanced parts) ----------
const MAXA = 420;
const sphereGeo = new THREE.SphereGeometry(1, 12, 8);
const legGeo = new THREE.CylinderGeometry(0.07, 0.05, 1, 6);
legGeo.translate(0, -0.5, 0);
const antGeo = new THREE.CylinderGeometry(0.05, 0.035, 1, 5);
antGeo.translate(0, 0.5, 0);
const shadowGeo = new THREE.PlaneGeometry(1, 1);
shadowGeo.rotateX(-Math.PI / 2);
function inst(geo: THREE.BufferGeometry, mat: THREE.Material, n: number) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.frustumCulled = false;
  m.setColorAt(0, new THREE.Color());
  m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  scene.add(m);
  return m;
}
const antMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const P = {
  shadow: inst(shadowGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }), MAXA),
  abdomen: inst(sphereGeo, antMat, MAXA),
  thorax: inst(sphereGeo, antMat, MAXA),
  head: inst(sphereGeo, antMat, MAXA),
  eye: inst(sphereGeo, antMat, MAXA * 2),
  leg: inst(legGeo, antMat, MAXA * 6),
  ant: inst(antGeo, antMat, MAXA * 2),
  cube: inst(voxGeo, antMat, MAXA),
};
P.shadow.renderOrder = 1;
const tm = new THREE.Matrix4(),
  tb = new THREE.Matrix4(),
  tq = new THREE.Quaternion(),
  tv = new THREE.Vector3(),
  ts = new THREE.Vector3(),
  te = new THREE.Euler(),
  tcol = new THREE.Color();
function local(px: number, py: number, pz: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
}
// ant local frame: forward is +z
const L_ABD = local(0, 0.6, -0.55, 0.56, 0.5, 0.6);
const L_THX = local(0, 0.55, 0.12, 0.33, 0.3, 0.36);
const L_HEAD = local(0, 0.66, 0.68, 0.5, 0.47, 0.47);
const L_EYE = [local(-0.27, 0.86, 1.02, 0.1, 0.11, 0.08), local(0.27, 0.86, 1.02, 0.1, 0.11, 0.08)];
const L_ANT = [local(-0.18, 1.0, 0.85, 1, 0.62, 1, 0.9, 0, 0.55), local(0.18, 1.0, 0.85, 1, 0.62, 1, 0.9, 0, -0.55)];
const L_CUBE = local(0, 1.18, -0.3, 0.98 / ANT_SCALE, 0.98 / ANT_SCALE, 0.98 / ANT_SCALE);
const LEG_Z = [0.42, 0.12, -0.18];

// a point on the tray floor, and a walk along a polyline of them
interface Pt {
  x: number;
  z: number;
}
interface Path {
  pts: Pt[];
  cum: number[];
  len: number;
}
interface Ant {
  path: Path;
  stop: number;
  s: number;
  back: Pt[];
  state: 'out' | 'carry' | 'sink';
  c: number;
  cell: number;
  tgt: Pt;
  x: number;
  z: number;
  h: number;
  phase: number;
  sc: number;
  t: number;
  carry: boolean;
  wait: number;
}
const ants: Ant[] = [];
function groundY(x: number, z: number) {
  const ax = Math.abs(x),
    hw = TRAY_W / 2 - 0.4,
    hd = TRAY_D / 2 - 0.4;
  if (ax < hw && Math.abs(z) < hd) return FLOOR_Y;
  if (ax < TRAY_W / 2 + 0.6 && z > hd && z < TRAY_D / 2 + 1.2) {
    const t = (z - hd) / (TRAY_D / 2 + 1.2 - hd);
    return (
      FLOOR_Y +
      (RIM_Y - FLOOR_Y + 0.15) *
        Math.sin((Math.min(1, t * 1.6) * Math.PI) / 2) *
        (t < 0.62 ? 1 : 1 - ((t - 0.62) / 0.38) * 1.6)
    );
  }
  return 0;
}

// ---------- level state ----------
// A block waiting in a column, and a jar on a slot: groups that carry what the game needs to know about them
type NumberMesh = ReturnType<typeof numberPlane>;
class Block extends THREE.Group {
  declare userData: { c: number; n: number; body: THREE.Mesh; sh: THREE.Mesh };
}
class Jar extends THREE.Group {
  declare userData: { c: number; n: number; num: NumberMesh; alarm?: boolean; x0?: number };
}
// a slot whose block is still flying to it
interface Pending {
  pending: true;
}
interface Tween {
  t: number;
  dur: number;
  fn: (k: number) => void;
  done?: () => void;
}
interface Play {
  idx: number;
  L: LevelData;
  level: SimLevel;
  sim: Sim;
  root: THREE.Group;
  acc: number;
  over: boolean;
  paused: boolean;
  stuckT: number;
  winT: number;
  jars: (Jar | Pending | null)[];
  dying: THREE.Object3D[];
  tweens: Tween[];
  vox: THREE.InstancedMesh;
  shCtx: CanvasRenderingContext2D;
  shTex: THREE.CanvasTexture;
  shDirty: boolean;
  queue: Block[][];
  outlines: THREE.Mesh[];
}
let play: Play | null = null;
const voxMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

function cellToWorld(sim: Sim, c: number): Pt {
  const x = c % sim.PW,
    y = (c / sim.PW) | 0;
  return { x: x - 1 - (sim.W - 1) / 2, z: y - 1 - (sim.H - 1) / 2 + PIC_Z };
}

// Starts level idx from the beginning, or from a saved position of it
function startLevel(idx: number, from?: SimSave) {
  stopLevel();
  const L = DATA.levels[idx];
  usePalette(L.palette);
  const level = simLevel(L);
  const sim = (from && simFromSave(level, from)) || new Sim(level);
  const root = new THREE.Group();
  scene.add(root);
  // board voxels (the blocks the ants have taken already are there, at no size)
  const left = (x: number, y: number) => sim.cell[(y + 1) * sim.PW + x + 1] !== EMPTY_CELL;
  const vox = new THREE.InstancedMesh(voxGeo, voxMat, L.W * L.H);
  vox.frustumCulled = false;
  for (let y = 0; y < L.H; y++)
    for (let x = 0; x < L.W; x++) {
      const i = y * L.W + x,
        v = L.grid[i];
      if (!left(x, y)) tm.makeScale(0, 0, 0);
      else tm.makeTranslation(x - (L.W - 1) / 2, FLOOR_Y + 0.5, y - (L.H - 1) / 2 + PIC_Z);
      vox.setMatrixAt(i, tm);
      vox.setColorAt(i, COLORS[v === EMPTY_CELL ? 0 : v]);
    }
  root.add(vox);
  // soft contact shadow of the voxels on the floor
  const PW = L.W + 2,
    PH = L.H + 2;
  const shCanvas = document.createElement('canvas');
  shCanvas.width = PW;
  shCanvas.height = PH;
  const shCtx = shCanvas.getContext('2d')!;
  shCtx.fillStyle = 'rgba(120,70,60,0.42)';
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) if (left(x, y)) shCtx.fillRect(x + 1, y + 1, 1, 1);
  const shTex = new THREE.CanvasTexture(shCanvas);
  shTex.magFilter = THREE.LinearFilter;
  shTex.minFilter = THREE.LinearFilter;
  shTex.colorSpace = THREE.SRGBColorSpace;
  const shPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(PW, PH),
    new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }),
  );
  shPlane.rotation.x = -Math.PI / 2;
  shPlane.position.set(0.05, FLOOR_Y + 0.01, PIC_Z + 0.42);
  shPlane.renderOrder = -1;
  root.add(shPlane);
  // the columns, from the front block on (a block already sent to a slot has no place, as nothing looks there)
  const queue = level.columns.map((q, ci) => {
    const col: Block[] = [],
      front = sim.colPtr[ci];
    for (let r = front; r < q.length; r++) {
      const item = makeBlock(q[r].c, q[r].n);
      item.position.set(COL_X[ci], 0, rowZ(r - front));
      root.add(item);
      col[r] = item;
    }
    return col;
  });
  // and the jars on the slots
  const jars = sim.slots.map((s, i) => {
    if (!s) return null;
    const jar = makeJar(s.c, s.n);
    jar.position.set(SLOT_X[i], 0, SLOT_Z);
    root.add(jar);
    return jar;
  });
  const outlines = COL_X.map(() => {
    const o = new THREE.Mesh(outlineGeo, whiteMat);
    o.renderOrder = 0;
    return o;
  });
  play = {
    idx,
    L,
    level,
    sim,
    root,
    acc: 0,
    over: false,
    paused: false,
    stuckT: 0,
    winT: 0,
    jars,
    dying: [],
    tweens: [],
    vox,
    shCtx,
    shTex,
    shDirty: false,
    queue,
    outlines,
  };
  refreshFront();
  showScreen(null);
  if (!from) savePlay();
}
function stopLevel() {
  if (!play) return;
  scene.remove(play.root);
  play.vox.dispose();
  play.shTex.dispose();
  ants.length = 0;
  play = null;
}
function makeBlock(c: number, n: number) {
  const g = new Block();
  const sh = shadowPlane(BLOCK.w * 1.5, BLOCK.d * 1.6, 0.3);
  sh.position.set(0, 0.012, 0.9);
  g.add(sh);
  const body = new THREE.Mesh(blockGeo, lambert(uiHex(c)));
  body.position.y = BLOCK.h / 2;
  g.add(body);
  const num = numberPlane(n);
  num.position.set(0, BLOCK.h + 0.02, 0.05);
  g.add(num);
  g.userData = { c, n, body, sh };
  return g;
}
function makeJar(c: number, n: number) {
  const g = new Jar();
  const body = new THREE.Mesh(jarGeo, lambert(uiHex(c)));
  body.position.y = PED.h + JAR.h / 2;
  g.add(body);
  body.position.z = JAR_Z - SLOT_Z;
  const capZ = JAR_Z - SLOT_Z - 3.3,
    capTop = PED.h + JAR.h + 1.55;
  const cap = new THREE.Mesh(capGeo, lambert(uiHex(c)));
  cap.position.set(0, capTop - 0.9, capZ);
  g.add(cap);
  const inner = new THREE.Mesh(
    capInGeo,
    new THREE.MeshBasicMaterial({ color: shade(uiHex(c), isLight(c) ? 0.9 : 0.8) }),
  );
  inner.position.set(0, capTop + 0.08, capZ + 0.15);
  g.add(inner);
  const num = numberPlane(n);
  num.position.set(0, PED.h + JAR.h + 0.02, JAR_Z - SLOT_Z - 0.1);
  g.add(num);
  g.userData = { c, n, num };
  return g;
}
function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}

function refreshFront() {
  const g = play!;
  g.queue.forEach((col, ci) => {
    const o = g.outlines[ci];
    const p = g.sim.colPtr[ci];
    if (o.parent) o.parent.remove(o);
    if (col[p]) {
      const body = col[p].userData.body;
      o.position.copy(body.position);
      col[p].add(o);
    }
  });
}

// ---------- input ----------
const ray = new THREE.Raycaster(),
  ndc = new THREE.Vector2();
// a tap on the board: the front block under it, if any
function tapBoard(e: PointerEvent) {
  const g = play;
  if (!g || g.over) return;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const fronts = g.queue.map((col, ci) => col[g.sim.colPtr[ci]]).filter(Boolean);
  const hit = ray.intersectObjects(
    fronts.map((f) => f.userData.body),
    false,
  )[0];
  if (!hit) return;
  const col = g.queue.findIndex((q, ci) => q[g.sim.colPtr[ci]] && q[g.sim.colPtr[ci]].userData.body === hit.object);
  tapColumn(col);
}
function tapColumn(col: number) {
  const g = play!;
  const item = g.queue[col][g.sim.colPtr[col]];
  if (!item) return;
  if (!g.sim.canPop(col)) {
    shake(item);
    return;
  }
  const r0 = g.sim.colPtr[col];
  const slot = g.sim.pop(col);
  savePlay();
  const from = item.position.clone();
  const to = new THREE.Vector3(SLOT_X[slot], PED.h + JAR.h - BLOCK.h, JAR_Z);
  item.userData.sh.visible = false;
  const token: Pending = { pending: true };
  g.jars[slot] = token;
  tween(
    0.3,
    (t) => {
      const e = 1 - Math.pow(1 - t, 3);
      item.position.lerpVectors(from, to, e);
      item.position.y += Math.sin(t * Math.PI) * 4;
    },
    () => {
      g.root.remove(item);
      const s = g.sim.slots[slot];
      const jar = makeJar(item.userData.c, s ? s.n : 0);
      jar.position.set(SLOT_X[slot], 0, SLOT_Z);
      g.root.add(jar);
      if (g.jars[slot] === token && s && s.c === item.userData.c) {
        g.jars[slot] = jar;
        jar.scale.set(1.08, 0.9, 1.08);
        tween(0.18, (t) => jar.scale.set(1.08 - 0.08 * t, 0.9 + 0.1 * t, 1.08 - 0.08 * t));
      } else {
        if (g.jars[slot] === token) g.jars[slot] = null;
        vanish(jar);
      }
      updateJars();
    },
  );
  // shift the column forward
  g.queue[col].slice(r0 + 1).forEach((it, k) => {
    const z0 = it.position.z,
      z1 = rowZ(k);
    tween(0.25, (t) => {
      it.position.z = z0 + (z1 - z0) * (1 - Math.pow(1 - t, 2));
    });
  });
  refreshFront();
}
function shake(item: THREE.Object3D) {
  const x0 = item.position.x;
  tween(0.3, (t) => {
    item.position.x = x0 + Math.sin(t * Math.PI * 6) * 0.35 * (1 - t);
  });
}
function vanish(obj: THREE.Object3D) {
  play!.dying.push(obj);
  tween(
    0.22,
    (t) => obj.scale.setScalar(Math.max(0.001, 1 - t)),
    () => {
      if (obj.parent) obj.parent.remove(obj);
    },
  );
}
function tween(dur: number, fn: (k: number) => void, done?: () => void) {
  play!.tweens.push({ t: 0, dur, fn, done });
}

function updateJars() {
  const g = play!;
  for (let i = 0; i < 5; i++) {
    const s = g.sim.slots[i],
      j = g.jars[i];
    if (!(j instanceof Jar)) continue;
    if (!s) {
      g.jars[i] = null;
      vanish(j);
      continue;
    }
    if (j.userData.n !== s.n) {
      j.userData.n = s.n;
      j.userData.num.material.map = numberTex(s.n);
    }
  }
}

// ---------- ants ----------
function spawnAnt(ev: TickEvent) {
  const g = play!,
    sim = g.sim;
  const PW = sim.PW,
    H = sim.H;
  const sx = SLOT_X[ev.slot];
  const entryX = Math.max(1, Math.min(PW - 2, Math.round(sx + (sim.W - 1) / 2 + 1)));
  const entry = (H + 1) * PW + entryX;
  const exitX = Math.max(1, Math.min(PW - 2, Math.round(HOLE.x + (sim.W - 1) / 2 + 1)));
  const exit = (H + 1) * PW + exitX;
  const go = sim.path(entry, (c) => c === ev.p);
  const back = sim.path(ev.p, (c) => c === exit);
  const pts: Pt[] = [{ x: sx, z: SLOT_Z - 3.2 }];
  // walk around the hole rather than over it
  if (Math.abs(sx - HOLE.x) < HOLE.r + 1.5)
    pts.push({ x: HOLE.x + HOLE.r + 2.2, z: HOLE.z + 2 }, { x: HOLE.x + HOLE.r + 2.2, z: HOLE.z - 2.5 });
  pts.push({ x: cellToWorld(sim, entry).x, z: TRAY_D / 2 + 1.0 });
  for (const c of go) pts.push(cellToWorld(sim, c));
  const path = polyline(pts);
  const stop = Math.max(0, path.len - 1.1);
  const tgt = cellToWorld(sim, ev.p);
  const ret: Pt[] = [];
  for (const c of back) ret.push(cellToWorld(sim, c));
  ret.push({ x: cellToWorld(sim, exit).x, z: TRAY_D / 2 + 1.0 }, { x: HOLE.x, z: HOLE.z });
  const a: Ant = {
    path,
    stop,
    s: 0,
    back: ret,
    state: 'out',
    c: ev.c,
    cell: ev.p,
    tgt,
    x: pts[0].x,
    z: pts[0].z,
    h: Math.PI,
    phase: Math.random() * 6,
    sc: 0,
    t: 0,
    carry: false,
    wait: 0,
  };
  a.h = Math.atan2(pts[1].x - pts[0].x, pts[1].z - pts[0].z);
  ants.push(a);
}
function polyline(pts: Pt[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return { pts, cum, len: cum[cum.length - 1] };
}
function at(path: Path, s: number, out: Pt) {
  const { pts, cum } = path;
  s = Math.max(0, Math.min(path.len, s));
  let lo = 0,
    hi = cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= s) lo = m;
    else hi = m;
  }
  const seg = cum[hi] - cum[lo] || 1,
    t = (s - cum[lo]) / seg;
  out.x = pts[lo].x + (pts[hi].x - pts[lo].x) * t;
  out.z = pts[lo].z + (pts[hi].z - pts[lo].z) * t;
  return out;
}
const P0 = { x: 0, z: 0 },
  P1 = { x: 0, z: 0 };
function updateAnts(dt: number, speed: number) {
  const g = play!;
  for (let i = ants.length - 1; i >= 0; i--) {
    const a = ants[i];
    a.phase += dt * 18 * speed;
    if (a.state === 'sink') {
      a.t += dt * speed;
      a.sc = Math.max(0, 1 - a.t / 0.35);
      if (a.t >= 0.35) {
        ants.splice(i, 1);
      }
      continue;
    }
    a.sc = Math.min(1, a.sc + dt * speed * 6);
    if (a.wait > 0) {
      a.wait -= dt * speed;
      continue;
    }
    const lim = a.state === 'out' ? a.stop : a.path.len;
    a.s = Math.min(lim, a.s + ANT_SPEED * speed * dt);
    at(a.path, a.s, P0);
    at(a.path, a.s + 0.9, P1);
    a.x = P0.x;
    a.z = P0.z;
    if (Math.hypot(P1.x - P0.x, P1.z - P0.z) > 0.05) {
      const want = Math.atan2(P1.x - P0.x, P1.z - P0.z);
      let d = want - a.h;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.h += d * Math.min(1, dt * speed * 14);
    }
    if (a.s >= lim) {
      if (a.state === 'out') {
        // pick up the block
        const x = (a.cell % g.sim.PW) - 1,
          y = ((a.cell / g.sim.PW) | 0) - 1;
        tm.makeScale(0, 0, 0);
        g.vox.setMatrixAt(y * g.L.W + x, tm);
        g.vox.instanceMatrix.needsUpdate = true;
        g.shCtx.clearRect(x + 1, y + 1, 1, 1);
        g.shDirty = true;
        a.carry = true;
        a.wait = 0.08;
        a.state = 'carry';
        a.path = polyline([{ x: a.x, z: a.z }, ...a.back]);
        a.s = 0;
      } else {
        a.state = 'sink';
        a.t = 0;
      }
    }
  }
}
function writeAnts() {
  let n = 0;
  for (const a of ants) {
    const col = COLORS[a.c];
    const dark = col.r * 0.3 + col.g * 0.59 + col.b * 0.11 < 0.12;
    const sink = a.state === 'sink';
    const y = (sink ? -0.9 * (1 - a.sc) : 0) + groundY(a.x, a.z) + 0.02;
    const sc = ANT_SCALE * Math.max(0.01, a.sc);
    tb.compose(tv.set(a.x, y, a.z), tq.setFromEuler(te.set(0, a.h, 0)), ts.set(sc, sc, sc));
    const bob = Math.abs(Math.sin(a.phase)) * 0.06;
    put(
      P.shadow,
      n,
      tm
        .copy(tb)
        .multiply(tmpS.makeScale(1.5, 1, a.carry ? 2.6 : 2.4))
        .premultiply(tmpT.makeTranslation(0, 0.005, 0)),
      null,
      sink ? 0 : 1,
    );
    put(P.abdomen, n, tm.multiplyMatrices(tb, L_ABD), col);
    put(P.thorax, n, tm.multiplyMatrices(tb, L_THX), col);
    put(P.head, n, tm.multiplyMatrices(tb, tmpT.makeTranslation(0, bob, 0).multiply(L_HEAD)), col);
    const eyeCol = dark ? WHITE : BLACK;
    for (let k = 0; k < 2; k++) {
      put(P.eye, n * 2 + k, tm.multiplyMatrices(tb, tmpT.makeTranslation(0, bob, 0).multiply(L_EYE[k])), eyeCol);
      put(
        P.ant,
        n * 2 + k,
        tm.multiplyMatrices(tb, tmpT.makeTranslation(0, bob, 0).multiply(L_ANT[k])),
        tcol.copy(col).lerp(WHITE, 0.35),
      );
    }
    const legCol = tcol.copy(col).multiplyScalar(0.82);
    for (let k = 0; k < 6; k++) {
      const side = k < 3 ? -1 : 1,
        j = k % 3;
      const swing = Math.sin(a.phase + j * 2.1 + (side > 0 ? Math.PI : 0)) * 0.45;
      tmpL.compose(
        tv.set(side * 0.2, 0.55, LEG_Z[j]),
        tq.setFromEuler(te.set(swing * 0.6, (j - 1) * 0.5 * side, side * -1.05, 'YXZ')),
        ts.set(1, 0.95, 1),
      );
      put(P.leg, n * 6 + k, tm.multiplyMatrices(tb, tmpL), legCol);
    }
    if (a.carry) put(P.cube, n, tm.multiplyMatrices(tb, L_CUBE), col);
    else put(P.cube, n, tm.makeScale(0, 0, 0), col);
    n++;
  }
  P.shadow.count = P.abdomen.count = P.thorax.count = P.head.count = P.cube.count = n;
  P.eye.count = P.ant.count = n * 2;
  P.leg.count = n * 6;
  for (const m of Object.values(P)) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}
const tmpS = new THREE.Matrix4(),
  tmpT = new THREE.Matrix4(),
  tmpL = new THREE.Matrix4();
const WHITE = new THREE.Color(0xffffff),
  BLACK = new THREE.Color(0x1d1416),
  SHC = new THREE.Color(0xffffff);
function put(mesh: THREE.InstancedMesh, i: number, m: THREE.Matrix4, col: THREE.Color | null, vis = 1) {
  if (i >= mesh.instanceMatrix.count) return;
  if (!vis) m.makeScale(0, 0, 0);
  mesh.setMatrixAt(i, m);
  mesh.setColorAt(i, col || SHC);
}

// ---------- main loop ----------
// Frames come only while the game is open (see `game`), so its screen is always shown when one does
let speed = 1;
function frame(dt: number) {
  if (play && !play.paused) step(dt);
  renderer.render(scene, camera);
}
function step(dt: number) {
  const g = play!;
  for (let i = g.tweens.length - 1; i >= 0; i--) {
    const tw = g.tweens[i];
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    tw.fn(k);
    if (k >= 1) {
      g.tweens.splice(i, 1);
      if (tw.done) tw.done();
    }
  }
  if (!g.over) {
    g.acc += dt * speed;
    while (g.acc >= TICK) {
      g.acc -= TICK;
      const ev = g.sim.tick();
      for (const e of ev) spawnAnt(e);
      if (ev.length) updateJars();
    }
    if (g.sim.won()) {
      if (!ants.length) {
        g.winT += dt;
        if (g.winT > 0.4) finish(true);
      }
    } else if (g.sim.stuck()) {
      g.stuckT += dt;
      if (g.stuckT > 0.25) alarmJars(g.stuckT - 0.25);
      if (g.stuckT > 1.5) finish(false);
    } else {
      if (g.stuckT > 0.25) alarmJars(-1);
      g.stuckT = 0;
    }
  }
  updateAnts(dt, speed);
  writeAnts();
  if (g.shDirty) {
    g.shTex.needsUpdate = true;
    g.shDirty = false;
  }
}

// ---------- layout ----------
const speedBtn = document.getElementById('speed')!,
  infoBtn = document.getElementById('info')!;
function resize() {
  const w = app.clientWidth,
    h = app.clientHeight;
  renderer.setSize(w, h, false);
  const S = Math.min(w / REF_W, h / REF_H),
    OX = (w - REF_W * S) / 2;
  const hw = w / (2 * S * PXU),
    hh = h / (2 * S * PXU);
  camera.left = -hw;
  camera.right = hw;
  camera.top = hh;
  camera.bottom = -hh;
  camera.updateProjectionMatrix();
  const yc = h / (2 * S);
  const tz = (yc - ORIGIN_Y) / (PXU * COS);
  camera.position.set(0, COS * 300, tz + SIN * 300);
  camera.lookAt(0, 0, tz);
  makeBackground(w, h, S, OX);
  const px = (v: number) => v * S + 'px';
  Object.assign(speedBtn.style, {
    left: OX + 1003 * S + 'px',
    top: px(15),
    width: px(147),
    height: px(77),
    fontSize: px(70),
  });
  // keep the icon at the reference size but give it a finger-sized hit area
  const isz = Math.max(40 * S, 40),
    icy = Math.min(2192 * S, h - 20 * S - isz / 2);
  Object.assign(infoBtn.style, {
    left: OX + 53 * S - isz / 2 + 'px',
    top: icy - isz / 2 + 'px',
    width: isz + 'px',
    height: isz + 'px',
    padding: (isz - 40 * S) / 2 + 'px',
  });
}
function toggleSpeed() {
  speed = speed === 1 ? 2 : 1;
  speedBtn.setAttribute('aria-pressed', speed === 2 ? 'true' : 'false');
}

// ---------- stars ----------
// One star per completed level, keyed by level name. Kept in this browser,
// and in the viewer's private per-user store when they are signed in, so
// stars follow them to other devices. Stars only ever get added, so the
// two copies merge by union.
const STAR_KEY = 'antsort.stars.v1';
// The names of the levels with a star, as a JSON array in the order they were earned. Only a name can match a
// level, so anything else in there is dropped on the way in, and the rest kept.
const StarNames = keepOnly(Schema.String, Predicate.isString);
const stars = new Set<string>();
const saveStars = Effect.suspend(() => save(STAR_KEY, StarNames, [...stars]));
function earnStar(name: string) {
  if (stars.has(name)) return false;
  stars.add(name);
  run(saveStars);
  renderStars();
  pushProgress();
  return true;
}
function renderStars() {
  const els = cards.children;
  DATA.levels.forEach((L, i) => {
    const on = stars.has(L.name),
      c = els[i];
    if (!c) return;
    c.querySelector('.cstar')!.setAttribute('class', 'cstar ' + (on ? 'star-on' : 'star-off'));
    c.setAttribute('aria-label', `Level ${i + 1}, ${L.name}${on ? ', star earned' : ''}`);
  });
  const n = DATA.levels.filter((L) => stars.has(L.name)).length;
  document.getElementById('tallyN')!.textContent = `${n} / ${DATA.levels.length}`;
}

// ---------- the level in progress ----------
// The level being played, saved when it starts and after every tap, so that a reload, or a tab closed and opened
// again, comes back to it: the level's name and the Sim's position then (simSave). Between taps the Sim takes the
// same steps whatever the time, so from there the ants fetch what they would have (a block an ant had set off for
// when the tap was made is gone when the level comes back). It goes when the level ends or the player goes back to
// the levels. Only a position the level can be in fits; anything else is no level in progress, and the levels show.
const PLAY_KEY = 'antsort.play.v1';
const levelNamed = (name: string) => DATA.levels.findIndex((L) => L.name === name);
const SavedPlay = Schema.Struct({
  level: Schema.String,
  board: Schema.String,
  columns: Schema.Array(Schema.Int),
  slots: Schema.Array(Schema.NullOr(Schema.Struct({ c: Schema.Int, n: Schema.Int }))),
}).check(
  Schema.makeFilter((p) => {
    const i = levelNamed(p.level);
    return i >= 0 && simFromSave(simLevel(DATA.levels[i]), p) !== null;
  }),
);
type SavedPlay = typeof SavedPlay.Type;
const savePlay = () => {
  if (play) run(save(PLAY_KEY, SavedPlay, { level: play.L.name, ...simSave(play.sim) }));
};
const forgetPlay = () => run(forget(PLAY_KEY));

// The per-user store, where the page runs with one (window.claude). It keeps a document of the viewer's progress
// that it sends again whenever it changes, from this device or another.
interface ProgressDoc {
  stars?: string[];
}
interface ProgressSnapshot {
  exists: boolean;
  data(): unknown;
  metadata: { fromCache: boolean };
}
interface ProgressRef {
  set(doc: ProgressDoc): Promise<unknown>;
  onSnapshot(next: (snap: ProgressSnapshot) => void, error: () => void): unknown; // gives a function that stops it
}
interface Store {
  use(name: 'db'): Promise<{ doc(path: string): ProgressRef } | null>;
  use(name: 'user'): Promise<{ id(): Promise<string | null> } | null>;
}
const isStore = (u: unknown): u is Store => Predicate.hasProperty(u, 'use') && Predicate.isFunction(u.use);
/** The store failed. refused: it won't take the document as written, so no more writes until it sends the next one */
class ProgressError extends Schema.TaggedError<ProgressError>()('ProgressError', { refused: Schema.Boolean }) {}
const progressError = (e: unknown) =>
  new ProgressError({ refused: Predicate.hasProperty(e, 'code') && e.code === 'invalid_argument' });
// The progress document, as forgiving as the save: no stars, or stars that aren't a list, are none
const Progress = Schema.Struct({ stars: Schema.optionalKey(StarNames) });
const decodeProgress = Schema.decodeUnknownOption(Progress);

/** Every version of the progress document the store sends, until it reports an error */
const snapshots = (ref: ProgressRef) =>
  Stream.callback<ProgressSnapshot, ProgressError>((queue) =>
    Effect.acquireRelease(
      Effect.try({
        try: () =>
          ref.onSnapshot(
            (snap) => Queue.offerUnsafe(queue, snap),
            () => Queue.failCauseUnsafe(queue, Cause.fail(new ProgressError({ refused: false }))),
          ),
        catch: progressError,
      }),
      (stop) => Effect.sync(() => Predicate.isFunction(stop) && stop()),
    ),
  );

/**
 * Keeps the stars and the per-user store in step while the game is open, when the page has a store and the viewer
 * is signed in: what the store has joins the stars here, and stars earned here go up to it. Gives the function that
 * sends the stars up.
 */
const syncProgress = Effect.gen(function* () {
  // the document to write to, once the store has sent it (and until it reports an error)
  let ref: ProgressRef | null = null;
  const write = Effect.suspend(() => {
    const to = ref;
    if (!to) return Effect.void;
    return Effect.tryPromise({ try: () => to.set({ stars: [...stars].sort() }), catch: progressError }).pipe(
      Effect.catchTag('ProgressError', (e) =>
        Effect.sync(() => {
          if (e.refused) ref = null;
        }),
      ),
    );
  });
  // one write at a time: stars earned while one is on its way go up together in the next
  const pushes = yield* Queue.sliding<void>(1);
  yield* Effect.forkScoped(Effect.forever(Effect.andThen(Queue.take(pushes), write)));
  const push = () => void Queue.offerUnsafe(pushes, undefined);

  const connect = Effect.gen(function* () {
    const claude = window.claude;
    if (!isStore(claude)) return;
    const [db, user] = yield* Effect.tryPromise({
      try: () => Promise.all([claude.use('db'), claude.use('user')]),
      catch: progressError,
    });
    if (!db || !user) return;
    const id = yield* Effect.tryPromise({ try: () => user.id(), catch: progressError });
    if (!id) return;
    const doc = yield* Effect.try({ try: () => db.doc('data/users/' + id + '/progress'), catch: progressError });
    let synced = false;
    yield* Stream.runForEach(snapshots(doc), (snap) =>
      Effect.gen(function* () {
        const remote = snap.exists ? Option.getOrUndefined(decodeProgress(snap.data()))?.stars : undefined;
        const before = stars.size;
        for (const n of remote ?? []) stars.add(n);
        if (stars.size !== before) {
          yield* saveStars;
          renderStars();
        }
        ref = doc;
        // first confirmed read: upload stars this browser has that the store lacks
        if (!synced && !snap.metadata.fromCache) {
          synced = true;
          if ((remote?.length ?? 0) < stars.size) push();
        }
      }),
    );
  }).pipe(
    Effect.catchTag('ProgressError', () =>
      Effect.sync(() => {
        ref = null;
      }),
    ),
  );
  yield* Effect.forkScoped(connect);
  return push;
});
// Sends the stars to the per-user store, while the game is open (open sets it up)
let pushProgress = () => {};

// ---------- win and loss effects ----------
// stuck: the full slots pulse red and shudder before the result appears
function alarmJars(t: number) {
  const g = play!;
  for (const j of g.jars) {
    if (!(j instanceof Jar)) continue;
    if (!j.userData.alarm) {
      if (t < 0) continue;
      j.userData.alarm = true;
      j.userData.x0 = j.position.x;
      j.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial) o.material = o.material.clone();
      });
    }
    const k = t < 0 ? 0 : 0.5 + 0.25 * Math.sin(t * 14);
    j.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial)
        o.material.emissive.setRGB(k, 0.05 * k, 0.06 * k);
    });
    j.position.x = j.userData.x0! + (t < 0 ? 0 : Math.sin(t * 40) * 0.18 * Math.min(1, t * 3));
    if (t < 0) j.userData.alarm = false;
  }
}
// win: confetti in the level's colours plus gold
const fx = document.getElementById('fx') as HTMLCanvasElement,
  fxc = fx.getContext('2d')!;
interface Confetto {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  s: number;
  c: string;
  t: number;
}
let confetti: Confetto[] = [];
// Starts the confetti's fall from plain code (a frame) in the game's scope, so it stops when the player leaves. open
// sets this up, and after the game closes it starts nothing.
let startFall: (fall: Effect.Effect<void>, options: { readonly onlyIfMissing: boolean }) => unknown = () => {};
function burstConfetti(colors: string[]) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2),
    w = app.clientWidth,
    h = app.clientHeight;
  fx.width = w * dpr;
  fx.height = h * dpr;
  fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pal = colors.concat(['#ffd43b', '#ffe680', '#ffffff']);
  const sz = Math.max(6, Math.min(w, h) / 70);
  confetti = [];
  for (let i = 0; i < 170; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2,
      v = (0.6 + Math.random()) * h * 0.9;
    confetti.push({
      x: w / 2 + (Math.random() - 0.5) * w * 0.25,
      y: h * 0.42,
      vx: Math.cos(a) * v * 0.6,
      vy: Math.sin(a) * v,
      r: Math.random() * 6,
      vr: (Math.random() - 0.5) * 12,
      s: sz * (0.6 + Math.random() * 0.7),
      c: pal[i % pal.length],
      t: 0,
    });
  }
  // a fall already under way carries on with the new confetti
  startFall(fall(w, h), { onlyIfMissing: true });
}
// The confetti falling, a frame at a time, until the last piece is gone; the canvas is cleared at the end, or when
// the game closes first
const fall = (w: number, h: number) =>
  Effect.suspend(() => {
    let prev = performance.now();
    return nextFrame.pipe(
      Effect.map((now) => {
        const dt = Math.max(0, Math.min(0.05, (now - prev) / 1000));
        prev = Math.max(prev, now);
        return drawConfetti(dt, w, h) > 0;
      }),
      Effect.repeat({ while: (alive) => alive }),
      Effect.ensuring(Effect.sync(() => fxc.clearRect(0, 0, w, h))),
      Effect.asVoid,
    );
  });
// one frame of confetti; answers how many pieces are still falling
function drawConfetti(dt: number, w: number, h: number) {
  fxc.clearRect(0, 0, w, h);
  let alive = 0;
  for (const p of confetti) {
    p.t += dt;
    p.vy += h * 1.1 * dt;
    p.vx *= 1 - 1.4 * dt;
    p.vy *= 1 - 0.6 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.r += p.vr * dt;
    if (p.y > h + 20 || p.t > 4) continue;
    alive++;
    fxc.save();
    fxc.translate(p.x, p.y);
    fxc.rotate(p.r);
    fxc.scale(1, Math.abs(Math.cos(p.r * 1.7)) * 0.8 + 0.2);
    fxc.fillStyle = p.c;
    fxc.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66);
    fxc.restore();
  }
  return alive;
}

// ---------- screens ----------
const levelsEl = document.getElementById('levels')!,
  menuEl = document.getElementById('menu')!,
  resultEl = document.getElementById('result')!;
function showScreen(which: 'levels' | 'menu' | 'result' | null) {
  levelsEl.hidden = which !== 'levels';
  menuEl.hidden = which !== 'menu';
  resultEl.hidden = which !== 'result';
  const inGame = which !== 'levels';
  speedBtn.hidden = !inGame;
  infoBtn.hidden = !inGame;
}
// the result sheet's main button, and the level it starts
const resultMain = document.getElementById('rMain')!;
let resultNext = 0;
function finish(win: boolean) {
  const g = play!;
  g.over = true;
  const last = g.idx === DATA.levels.length - 1;
  let isNew = false;
  if (win) isNew = earnStar(g.L.name);
  forgetPlay();
  resultEl.classList.toggle('win', win);
  resultEl.classList.toggle('lose', !win);
  // restart the entry animations
  resultEl.querySelectorAll<HTMLElement>('.sheet, .badge svg, .badge .rays').forEach((el) => {
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  });
  const n = stars.size,
    total = DATA.levels.length;
  document.getElementById('rTitle')!.textContent = win
    ? n === total && isNew
      ? 'All stars!'
      : 'Level complete'
    : 'Out of space';
  document.getElementById('rText')!.textContent = win
    ? isNew
      ? `You earned a star. ${n} of ${total} collected.`
      : `You already have this star. ${n} of ${total} collected.`
    : 'All five slots hold blocks the ants can’t reach yet. Try a different order.';
  if (win) burstConfetti(HEX);
  resultMain.textContent = win ? (last ? 'Play again' : 'Next level') : 'Retry';
  resultMain.className = 'b outlined ' + (win ? 'go' : 'sky');
  resultNext = win ? (last ? 0 : g.idx + 1) : g.idx;
  showScreen('result');
}
// the buttons on the result sheet and the in-game menu (listened to while the game is open, see `game`)
function toLevels() {
  stopLevel();
  forgetPlay();
  showScreen('levels');
}
function openMenu() {
  if (play && !play.over) {
    play.paused = true;
    showScreen('menu');
  }
}
function closeMenu() {
  if (play) play.paused = false;
  showScreen(null);
}

// level cards with a small picture of each board
const cards = document.getElementById('cards')!;
DATA.levels.forEach((L, i) => {
  const b = document.createElement('button');
  b.className = 'card';
  b.type = 'button';
  const cv = document.createElement('canvas');
  cv.width = 208;
  cv.height = 208;
  const g = cv.getContext('2d')!,
    cs = 184 / L.W,
    o = 12;
  for (let y = 0; y < L.H; y++)
    for (let x = 0; x < L.W; x++) {
      const v = L.grid[y * L.W + x];
      if (v === EMPTY_CELL) continue;
      g.fillStyle = L.palette[v];
      g.fillRect(o + x * cs, o + y * cs, cs - 0.6, cs - 0.6);
    }
  b.append(cv);
  const t = document.createElement('div');
  t.innerHTML = `<div class="lv">Level ${i + 1}</div><div class="nm outlined"></div>`;
  t.querySelector('.nm')!.textContent = L.name;
  b.append(t);
  const st = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  st.setAttribute('viewBox', '0 0 24 24');
  st.setAttribute('class', 'cstar star-off');
  st.setAttribute('aria-hidden', 'true');
  st.innerHTML =
    '<path d="M12.0 2.3 L14.9 8.8 L22.0 9.6 L16.8 14.3 L18.2 21.3 L12.0 17.8 L5.8 21.3 L7.2 14.3 L2.0 9.6 L9.1 8.8 Z"/>';
  b.append(st);
  cards.append(b);
});
showScreen('levels');
const toMenu = document.getElementById('toMenu')!;
toMenu.hidden = false;

/** Ant Sort for the hub: the level picker, or the level left unfinished last time */
export const game: Game = {
  open: Effect.gen(function* () {
    // stars saved in this browser (in another tab, say); stars only ever get added, so they join what is here
    for (const name of yield* load(STAR_KEY, StarNames, () => [])) stars.add(name);
    renderStars();
    resize();

    // a level starts once the number labels' face has loaded
    const font = yield* Effect.forkScoped(loadFont);
    const startWithFont = (level: number) =>
      Effect.andThen(
        Fiber.join(font),
        Effect.sync(() => startLevel(level)),
      );

    yield* listen(window, 'resize', resize);
    yield* listen(canvas, 'pointerdown', tapBoard);
    yield* listen(speedBtn, 'click', toggleSpeed);
    yield* listen(infoBtn, 'click', openMenu);
    yield* listen(document.getElementById('mClose')!, 'click', closeMenu);
    yield* listen(document.getElementById('mRestart')!, 'click', () => startLevel(play!.idx));
    yield* listen(document.getElementById('mLevels')!, 'click', toLevels);
    yield* listen(document.getElementById('rLevels')!, 'click', toLevels);
    yield* listen(resultMain, 'click', () => startWithFont(resultNext));
    for (const [i, card] of [...cards.children].entries()) yield* listen(card, 'click', () => startWithFont(i));
    yield* listen(toMenu, 'click', () => GameHub.menu());
    // on the levels (the first time the game opens on this page, say): the level left unfinished, if one was saved
    if (!play) {
      const saved = yield* load<SavedPlay | null>(PLAY_KEY, SavedPlay, () => null);
      if (saved)
        yield* Effect.forkScoped(
          Effect.andThen(
            Fiber.join(font),
            Effect.sync(() => {
              if (!play) startLevel(levelNamed(saved.level), saved);
            }),
          ),
        );
    }

    startFall = yield* FiberHandle.makeRuntime<never>();
    pushProgress = yield* syncProgress;
    yield* animate(frame);
  }),
  // on the menu's card: the stars (saved here, or come from the per-user store while the game was open), and the
  // level left unfinished
  progress: Effect.gen(function* () {
    const saved = new Set([...stars, ...(yield* load(STAR_KEY, StarNames, () => []))]),
      n = DATA.levels.filter((L) => saved.has(L.name)).length,
      playing = yield* load<SavedPlay | null>(PLAY_KEY, SavedPlay, () => null);
    return [
      ...(n ? [`${n} of ${DATA.levels.length} stars`] : []),
      ...(playing ? [`Level ${levelNamed(playing.level) + 1} in progress`] : []),
    ];
  }),
};

// What the browser tests read, and a speed for them: a software-rendered browser draws a level at a few frames a
// second, far too slowly to win one at the speeds a player can pick.
const frontAt = new THREE.Vector3();
window.AntSort = {
  _debug() {
    const g = play,
      r = canvas.getBoundingClientRect();
    return {
      level: g ? g.idx : -1,
      over: !!g && g.over,
      won: !!g && g.sim.won(),
      quiet: !g || g.sim.quiet(),
      remaining: g ? g.sim.remaining : 0,
      colPtr: g ? g.sim.colPtr.slice() : [],
      slots: g ? g.sim.slots.map((s) => s && { c: s.c, n: s.n }) : [],
      ants: ants.length,
      // where to tap each column's front block on the page once it has moved up to the front row, and whether it
      // is there (or close enough to take a tap there)
      columns: COL_X.map((x, ci) => {
        frontAt.set(x, BLOCK.h / 2, rowZ(0)).project(camera);
        const front = g && g.queue[ci][g.sim.colPtr[ci]];
        return {
          x: r.left + ((frontAt.x + 1) / 2) * r.width,
          y: r.top + ((1 - frontAt.y) / 2) * r.height,
          ready: !!front && Math.abs(front.position.z - rowZ(0)) < 3,
        };
      }),
    };
  },
  _speed(k) {
    speed = k;
  },
};
