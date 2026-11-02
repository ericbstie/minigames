// Bike Race drawing: skies, parallax scenery, terrain, bikes, riders and effects, all on a 2D canvas.
// An ES module that bike-race.ts and the editor import. World units are metres with y up; the camera turns them
// into pixels.
import * as C from './bike-race-core';

export const INK = '#3b2326';
const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------- types ----------
/** x, y in bike-local metres */
type Pt = [x: number, y: number];
/** x, y, radius of a blob of foliage, in pixels */
type Blob = [x: number, y: number, r: number];

/** A rider's colours: the bike's body and its darker trim, the rider's suit and helmet */
export interface Paint {
  body: string;
  dark: string;
  suit: string;
  helmet: string;
}

/** The sun, moon or planet: where it is as a share of the screen, its radius, colour and glow */
export interface Sun {
  x: number;
  y: number;
  r: number;
  c: string;
  glow: string;
  planet?: boolean; // a little blue-green planet with land blobs
}
/** What stands along a layer's ridge */
export type Deco =
  | 'tree'
  | 'bush'
  | 'pine'
  | 'windmill'
  | 'arch'
  | 'hoodoo'
  | 'rocks'
  | 'crater'
  | 'crack'
  | 'dome'
  | 'antenna'
  | 'volcano'
  | 'chimney';
/** A parallax layer of scenery (the fields are described above THEMES) */
interface LayerBase {
  p: number;
  base: number;
  amp: number;
  freq: number;
  peaks?: boolean;
  flat?: boolean;
  round?: boolean;
  color: string;
  color2?: string;
  rim?: string;
  caps?: string;
  seed: number;
}
/** A layer with something standing on its ridge every so many pixels */
export interface DecoLayer extends LayerBase {
  deco: Deco;
  every: number;
  dColor: string;
}
export type Layer = (LayerBase & { deco?: undefined }) | DecoLayer;
/** A world's backdrop and track colours */
export interface Theme {
  sky: string[]; // top to bottom
  sun: Sun;
  clouds?: string;
  stars?: boolean;
  embers?: boolean; // sparks drifting up from the lava
  line: string; // the track
  lineEdge: string;
  halo?: string; // a pale glow around the track on the dark worlds
  layers: Layer[]; // far to near
}

/** How a bike looks: which bike's bodywork, and its paint (Scout and the first paint when left out) */
export interface Look {
  bike?: string;
  paint?: Paint;
}
/** A wheel's centre and how far it has turned */
export type WheelPose = [x: number, y: number, phi: number];
/** Where drawBike draws a bike (see drawBike) */
export interface BikePose {
  x: number;
  y: number;
  a: number;
  wheels?: WheelPose[] | null; // rear, front; without them the wheels sit where they hang, turned by phi
  phi?: number;
  lean?: number; // > 0 leans back, < 0 leans forward
  loose?: boolean; // crashed: the wheels came off and are drawn with drawWheel
  noRider?: boolean;
  noBike?: boolean;
}
export interface DrawBikeOptions {
  alpha?: number;
  ghost?: boolean; // the best run's ghost (drawn the same; the pale paint and alpha make it a ghost)
}
/** What drawMarkers needs: a built level, or the editor's stand-in, which gives the start and finish heights and
 * shows no checkpoints, so it needs no terrain */
export type MarkerLevel = Pick<C.Level, 'startY' | 'finishX' | 'finishY' | 'checkpoints'> &
  Partial<Pick<C.Level, 'terrain'>>;

// ---------- seeded noise ----------
export function hash(n: number): number {
  n = Math.imul(n ^ 0x27d4eb2d, 0x9e3779b1);
  n ^= n >>> 15;
  n = Math.imul(n, 0x85ebca6b);
  n ^= n >>> 13;
  return ((n >>> 0) % 100000) / 100000; // 0..1
}
function noise1(x: number, seed: number) {
  const i = Math.floor(x),
    f = x - i,
    u = f * f * (3 - 2 * f);
  return lerp(hash(i * 7919 + seed * 104729), hash((i + 1) * 7919 + seed * 104729), u);
}
const fbm = (x: number, seed: number) =>
  noise1(x, seed) * 0.6 + noise1(x * 2.13, seed + 7) * 0.28 + noise1(x * 4.7, seed + 13) * 0.12;

// ---------- paints and themes ----------
export const PAINTS: (Paint & { id: string })[] = [
  { id: 'red', body: '#e8463c', dark: '#a52a24', suit: '#2f5fb3', helmet: '#ffd23f' },
  { id: 'blue', body: '#3a7bd5', dark: '#24508f', suit: '#e8463c', helmet: '#ffffff' },
  { id: 'green', body: '#43b05c', dark: '#2a7a3e', suit: '#2d3142', helmet: '#7be8fc' },
  { id: 'orange', body: '#f39234', dark: '#b8611a', suit: '#4a3aa8', helmet: '#ffffff' },
  { id: 'purple', body: '#8e5bd6', dark: '#5d3594', suit: '#22b3a6', helmet: '#ffd23f' },
  { id: 'pink', body: '#ec6fa4', dark: '#b2457a', suit: '#3b2f6b', helmet: '#ffffff' },
  { id: 'yellow', body: '#f2c230', dark: '#b38a12', suit: '#2b2b33', helmet: '#e8463c' },
  { id: 'teal', body: '#22b3a6', dark: '#14796f', suit: '#f39234', helmet: '#ffffff' },
  { id: 'black', body: '#3d3b4a', dark: '#24222e', suit: '#e8463c', helmet: '#ffd23f' },
  { id: 'white', body: '#f4f1ea', dark: '#bcb4a8', suit: '#3a7bd5', helmet: '#e8463c' },
];
export const paintAt = (i: number) => PAINTS[((i % PAINTS.length) + PAINTS.length) % PAINTS.length];

// Each world is a painted backdrop of flat parallax layers (far to near), with the track drawn over it as a thin
// line. Layer fields: p parallax, base/amp baseline and height as a share of the screen, freq ridge width, color
// and color2 top and bottom fill, rim the lit top edge, peaks/flat/round ridge shape, caps snow on the peaks,
// deco something standing on the ridge every so many pixels.
export const THEMES: Record<C.WorldId, Theme> = {
  clover: {
    sky: ['#5fb8ec', '#a9dcf5', '#e2f6fd'],
    sun: { x: 0.8, y: 0.17, r: 0.055, c: '#fff8cf', glow: 'rgba(255,246,196,0.55)' },
    clouds: '#ffffff',
    line: '#c9302a',
    lineEdge: '#5e1612',
    layers: [
      {
        p: 0.04,
        base: 0.56,
        amp: 0.2,
        freq: 0.0024,
        peaks: true,
        color: '#a6cfe4',
        color2: '#c6e4f0',
        caps: '#f2fafd',
        seed: 3,
      },
      {
        p: 0.1,
        base: 0.65,
        amp: 0.12,
        freq: 0.0042,
        round: true,
        color: '#9fd39b',
        color2: '#88c48a',
        rim: '#c2ebb5',
        seed: 5,
        deco: 'tree',
        every: 44,
        dColor: '#6aae70',
      },
      {
        p: 0.2,
        base: 0.75,
        amp: 0.09,
        freq: 0.0068,
        round: true,
        color: '#7cc46c',
        color2: '#61ad59',
        rim: '#a6de8c',
        seed: 8,
        deco: 'windmill',
        every: 430,
        dColor: '#f6f1e8',
      },
      {
        p: 0.4,
        base: 0.87,
        amp: 0.06,
        freq: 0.011,
        round: true,
        color: '#4f9c4a',
        color2: '#3b823e',
        rim: '#72bd5f',
        seed: 9,
        deco: 'bush',
        every: 34,
        dColor: '#3c873e',
      },
    ],
  },
  ember: {
    sky: ['#e9737a', '#ffaf8f', '#ffe1b8'],
    sun: { x: 0.72, y: 0.34, r: 0.085, c: '#fff1d2', glow: 'rgba(255,228,186,0.6)' },
    clouds: '#ffe4d2',
    line: '#a8231b',
    lineEdge: '#4d0f0b',
    layers: [
      { p: 0.04, base: 0.58, amp: 0.13, freq: 0.0018, flat: true, color: '#e6a0a6', color2: '#f2bcb0', seed: 11 },
      {
        p: 0.1,
        base: 0.68,
        amp: 0.1,
        freq: 0.0034,
        flat: true,
        color: '#d9806f',
        color2: '#e5997f',
        rim: '#f6b896',
        seed: 12,
        deco: 'arch',
        every: 330,
        dColor: '#d47766',
      },
      {
        p: 0.2,
        base: 0.78,
        amp: 0.07,
        freq: 0.008,
        color: '#bf5a45',
        color2: '#a54a39',
        rim: '#e3876a',
        seed: 14,
        deco: 'hoodoo',
        every: 150,
        dColor: '#b8553f',
      },
      {
        p: 0.4,
        base: 0.9,
        amp: 0.05,
        freq: 0.014,
        color: '#8c392d',
        color2: '#6c2a22',
        rim: '#b85b45',
        seed: 15,
        deco: 'rocks',
        every: 38,
        dColor: '#7a3127',
      },
    ],
  },
  frost: {
    sky: ['#7cc6ef', '#bfe6f8', '#f0faff'],
    sun: { x: 0.68, y: 0.2, r: 0.045, c: '#ffffff', glow: 'rgba(255,255,255,0.6)' },
    clouds: '#ffffff',
    line: '#cf3530',
    lineEdge: '#5e1612',
    layers: [
      {
        p: 0.04,
        base: 0.56,
        amp: 0.24,
        freq: 0.0034,
        peaks: true,
        color: '#c4dced',
        color2: '#d9eaf5',
        caps: '#ffffff',
        seed: 21,
      },
      {
        p: 0.1,
        base: 0.66,
        amp: 0.18,
        freq: 0.0058,
        peaks: true,
        color: '#97bfd8',
        color2: '#b3d2e5',
        caps: '#f6fcff',
        seed: 22,
      },
      {
        p: 0.2,
        base: 0.77,
        amp: 0.07,
        freq: 0.01,
        round: true,
        color: '#eef7fc',
        color2: '#d3e7f2',
        rim: '#ffffff',
        seed: 24,
        deco: 'pine',
        every: 24,
        dColor: '#4c84a1',
      },
      {
        p: 0.4,
        base: 0.89,
        amp: 0.05,
        freq: 0.014,
        round: true,
        color: '#ffffff',
        color2: '#d8e9f3',
        rim: '#ffffff',
        seed: 25,
        deco: 'pine',
        every: 70,
        dColor: '#3a708c',
      },
    ],
  },
  moon: {
    sky: ['#09081d', '#1b1844', '#383274'],
    sun: { x: 0.78, y: 0.22, r: 0.07, c: '#5fb6ff', glow: 'rgba(110,180,255,0.35)', planet: true },
    stars: true,
    line: '#ff5747',
    lineEdge: '#2a0710',
    halo: 'rgba(255,236,236,0.22)',
    layers: [
      { p: 0.04, base: 0.64, amp: 0.1, freq: 0.003, color: '#36336e', color2: '#2b2858', seed: 31 },
      {
        p: 0.1,
        base: 0.72,
        amp: 0.08,
        freq: 0.006,
        color: '#4b4888',
        color2: '#3b3970',
        rim: '#6d6aaa',
        seed: 32,
        deco: 'dome',
        every: 560,
        dColor: '#8a87c2',
      },
      {
        p: 0.2,
        base: 0.8,
        amp: 0.05,
        freq: 0.01,
        color: '#625f9e',
        color2: '#4e4b86',
        rim: '#8986c2',
        seed: 34,
        deco: 'antenna',
        every: 320,
        dColor: '#a9a6d6',
      },
      {
        p: 0.4,
        base: 0.9,
        amp: 0.04,
        freq: 0.014,
        color: '#7a77b3',
        color2: '#5b5894',
        rim: '#a3a0d6',
        seed: 35,
        deco: 'crater',
        every: 16,
        dColor: '#5d5a97',
      },
    ],
  },
  magma: {
    sky: ['#1c080d', '#561916', '#a63d1d'],
    sun: { x: 0.3, y: 0.3, r: 0.09, c: '#ff9a3c', glow: 'rgba(255,120,40,0.4)' },
    embers: true,
    line: '#ff5a36',
    lineEdge: '#1c0606',
    halo: 'rgba(255,214,170,0.24)',
    layers: [
      {
        p: 0.04,
        base: 0.6,
        amp: 0.14,
        freq: 0.003,
        color: '#4a1c1d',
        color2: '#3d1718',
        seed: 41,
        deco: 'volcano',
        every: 900,
        dColor: '#4a1c1d',
      },
      {
        p: 0.1,
        base: 0.72,
        amp: 0.08,
        freq: 0.006,
        color: '#3a1718',
        color2: '#301314',
        rim: '#6a2a22',
        seed: 42,
        deco: 'chimney',
        every: 300,
        dColor: '#2c1213',
      },
      { p: 0.2, base: 0.8, amp: 0.05, freq: 0.012, color: '#2c1415', color2: '#231011', rim: '#5a241c', seed: 44 },
      {
        p: 0.4,
        base: 0.9,
        amp: 0.04,
        freq: 0.016,
        color: '#1f0e0f',
        color2: '#150a0b',
        rim: '#c8501f',
        seed: 45,
        deco: 'crack',
        every: 60,
        dColor: '#ff7a2f',
      },
    ],
  },
};
// the line colour for a stretch of track
const ICE = { line: '#a8ecff', edge: '#2b6b8a' };

// ---------- camera ----------
export class Camera {
  x = 0;
  y = 0;
  ppm = 40;
  W = 800;
  H = 450;
  sx(x: number) {
    return (x - this.x) * this.ppm + this.W / 2;
  }
  sy(y: number) {
    return this.H / 2 - (y - this.y) * this.ppm;
  }
  wx(sx: number) {
    return (sx - this.W / 2) / this.ppm + this.x;
  }
}

// ---------- sky and scenery ----------
export function drawSky(g: CanvasRenderingContext2D, cam: Camera, theme: Theme, t: number) {
  const { W, H } = cam;
  const grad = g.createLinearGradient(0, 0, 0, H);
  theme.sky.forEach((c, i) => grad.addColorStop(i / (theme.sky.length - 1), c));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  if (theme.stars) {
    g.fillStyle = '#fff';
    for (let i = 0; i < 90; i++) {
      const x = (((hash(i * 31 + 1) * W * 1.3 - cam.x * cam.ppm * 0.01) % W) + W) % W,
        y = hash(i * 17 + 5) * H * 0.7;
      const r = hash(i * 13) < 0.15 ? 1.6 : 0.9;
      g.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.8 + i));
      g.fillRect(x, y, r, r);
    }
    g.globalAlpha = 1;
  }
  const s = theme.sun,
    R = s.r * Math.min(W, H * 1.6),
    sx = s.x * W,
    sy = s.y * H;
  const glow = g.createRadialGradient(sx, sy, R * 0.5, sx, sy, R * 3.2);
  glow.addColorStop(0, s.glow);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(sx - R * 4, sy - R * 4, R * 8, R * 8);
  g.fillStyle = s.c;
  g.beginPath();
  g.arc(sx, sy, R, 0, TAU);
  g.fill();
  if (s.planet) {
    // a little blue-green planet with land blobs
    g.save();
    g.beginPath();
    g.arc(sx, sy, R, 0, TAU);
    g.clip();
    g.fillStyle = '#5ccf8a';
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse(
        sx + (hash(i * 3) - 0.5) * R * 1.6,
        sy + (hash(i * 5) - 0.5) * R * 1.4,
        R * 0.35,
        R * 0.22,
        hash(i) * 3,
        0,
        TAU,
      );
      g.fill();
    }
    g.fillStyle = 'rgba(10,10,40,0.35)';
    g.beginPath();
    g.arc(sx + R * 0.45, sy + R * 0.2, R * 1.05, 0, TAU);
    g.fill();
    g.restore();
  }
  if (theme.clouds) {
    g.fillStyle = theme.clouds;
    for (let i = 0; i < 6; i++) {
      const span = W + 400,
        x = ((((hash(i * 41) * span - cam.x * cam.ppm * 0.03 - t * 6 * (1 + (i % 3))) % span) + span) % span) - 200;
      const y = H * (0.08 + hash(i * 23) * 0.3),
        sc = 0.6 + hash(i * 7) * 0.8;
      g.globalAlpha = 0.75;
      cloud(g, x, y, 60 * sc);
    }
    g.globalAlpha = 1;
  }
  if (theme.embers) {
    // sparks drifting up from the lava
    g.fillStyle = '#ffb347';
    for (let i = 0; i < 26; i++) {
      const k = (t * (0.05 + hash(i * 3) * 0.06) + hash(i * 11)) % 1;
      const x = (((hash(i * 29) * W * 1.4 - cam.x * cam.ppm * 0.12 + Math.sin(t + i) * 12) % W) + W) % W,
        y = H * (1 - k * 0.9);
      g.globalAlpha = Math.sin(k * Math.PI) * 0.8;
      g.fillRect(x, y, 2, 2);
    }
    g.globalAlpha = 1;
  }
}
function blobs(g: CanvasRenderingContext2D, list: Blob[]) {
  g.beginPath();
  for (const [x, y, r] of list) {
    g.moveTo(x + r, y);
    g.arc(x, y, r, 0, TAU);
  }
  g.fill();
}
function cloud(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.beginPath();
  g.ellipse(x, y, s, s * 0.32, 0, 0, TAU);
  g.ellipse(x - s * 0.4, y - s * 0.12, s * 0.42, s * 0.3, 0, 0, TAU);
  g.ellipse(x + s * 0.25, y - s * 0.2, s * 0.5, s * 0.38, 0, 0, TAU);
  g.fill();
}

// a row of pointed mountains: each one a peak of its own height with straight-ish flanks
function peaks(x: number, seed: number) {
  const k = Math.floor(x);
  let best = 0;
  for (let j = k - 2; j <= k + 2; j++) {
    const px = j + hash(j * 31 + seed) * 0.7,
      h = 0.35 + hash(j * 17 + seed) * 0.65,
      slope = 1.1 + hash(j * 7 + seed) * 0.8;
    best = Math.max(best, h - Math.abs(x - px) * slope);
  }
  return Math.max(0, Math.min(1, best + (fbm(x * 5, seed) - 0.5) * 0.08));
}
function layerY(L: Layer, cam: Camera, px: number) {
  let n = L.peaks ? peaks(px * L.freq, L.seed) : fbm(px * L.freq, L.seed);
  if (L.flat) n = Math.round((n - 0.15) * 4.5) / 3; // stepped plateaus
  if (L.round) n = 0.5 - 0.5 * Math.cos(n * Math.PI); // soft rolling hills
  return cam.H * (L.base - L.amp * n);
}
// The scenery fills the whole screen, so the ground under the track is the backdrop showing through.
export function drawLayers(g: CanvasRenderingContext2D, cam: Camera, theme: Theme, t: number) {
  const { W, H } = cam;
  const yShift = Math.max(-H * 0.08, Math.min(H * 0.08, cam.y * cam.ppm * 0.04));
  for (const L of theme.layers) {
    const off = cam.x * cam.ppm * L.p,
      dy = yShift * (L.p * 4);
    const top = H * (L.base - L.amp) + dy;
    const fill = g.createLinearGradient(0, top, 0, H);
    fill.addColorStop(0, L.color);
    fill.addColorStop(1, L.color2 || L.color);
    const ridge: number[] = [];
    for (let x = -8; x <= W + 8; x += 6) ridge.push(x, layerY(L, cam, x + off) + dy);
    g.beginPath();
    g.moveTo(-8, H + 2);
    for (let i = 0; i < ridge.length; i += 2) g.lineTo(ridge[i], ridge[i + 1]);
    g.lineTo(W + 8, H + 2);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (L.caps) {
      // snow on everything above the snow line
      g.save();
      g.clip();
      g.fillStyle = L.caps;
      g.fillRect(0, 0, W, H * (L.base - L.amp * 0.66) + dy);
      g.restore();
    }
    if (L.rim) {
      g.strokeStyle = L.rim;
      g.lineWidth = Math.max(1.5, H / 260);
      g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < ridge.length; i += 2)
        i ? g.lineTo(ridge[i], ridge[i + 1] + 1) : g.moveTo(ridge[i], ridge[i + 1] + 1);
      g.stroke();
    }
    if (L.deco) {
      const k0 = Math.floor((off - 260) / L.every),
        k1 = Math.ceil((off + W + 260) / L.every);
      for (let k = k0; k <= k1; k++) {
        if (hash(k * 97 + L.seed) < 0.45) continue;
        const px = k * L.every + hash(k * 13 + L.seed) * L.every * 0.6,
          x = px - off;
        drawDeco(g, L.deco, x, layerY(L, cam, px) + dy + 3, L, hash(k * 7 + L.seed), t, cam);
      }
    }
  }
}
function drawDeco(
  g: CanvasRenderingContext2D,
  kind: Deco,
  x: number,
  y: number,
  L: DecoLayer,
  r: number,
  t: number,
  cam: Camera,
) {
  const s = cam.H / 450;
  g.fillStyle = L.dColor;
  switch (kind) {
    case 'tree': {
      const h = (24 + r * 16) * s;
      g.fillRect(x - 1.5 * s, y - h * 0.5, 3 * s, h * 0.5);
      blobs(g, [
        [x, y - h * 0.62, h * 0.34],
        [x - h * 0.2, y - h * 0.46, h * 0.24],
        [x + h * 0.2, y - h * 0.48, h * 0.26],
      ]);
      g.fillStyle = 'rgba(255,255,255,0.16)';
      blobs(g, [[x - h * 0.1, y - h * 0.72, h * 0.14]]);
      break;
    }
    case 'bush': {
      const h = (10 + r * 10) * s;
      blobs(g, [
        [x - h * 0.6, y - h * 0.2, h * 0.55],
        [x + h * 0.5, y - h * 0.25, h * 0.6],
        [x, y - h * 0.55, h * 0.6],
      ]);
      break;
    }
    case 'pine': {
      const h = (30 + r * 26) * s;
      g.beginPath();
      g.moveTo(x, y - h);
      g.lineTo(x + h * 0.3, y - h * 0.08);
      g.lineTo(x - h * 0.3, y - h * 0.08);
      g.fill();
      g.fillRect(x - 1.5 * s, y - h * 0.1, 3 * s, h * 0.12);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.beginPath();
      g.moveTo(x, y - h);
      g.lineTo(x + h * 0.11, y - h * 0.68);
      g.lineTo(x - h * 0.11, y - h * 0.68);
      g.fill();
      break;
    }
    case 'windmill': {
      const h = 64 * s,
        col = L.dColor;
      g.beginPath();
      g.moveTo(x - 11 * s, y);
      g.lineTo(x - 6 * s, y - h);
      g.lineTo(x + 6 * s, y - h);
      g.lineTo(x + 11 * s, y);
      g.fill();
      g.beginPath();
      g.moveTo(x - 9 * s, y - h);
      g.lineTo(x, y - h - 12 * s);
      g.lineTo(x + 9 * s, y - h);
      g.fill();
      g.fillStyle = 'rgba(80,60,50,0.35)';
      g.fillRect(x - 3 * s, y - 12 * s, 6 * s, 12 * s);
      const a0 = t * 0.9 + r * 6,
        cx = x,
        cy = y - h - 2 * s;
      for (let i = 0; i < 4; i++) {
        const a = a0 + (i * Math.PI) / 2,
          ca = Math.cos(a),
          sa = Math.sin(a),
          px = -sa,
          py = ca;
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(cx + ca * 6 * s, cy + sa * 6 * s);
        g.lineTo(cx + ca * 42 * s, cy + sa * 42 * s);
        g.lineTo(cx + ca * 42 * s + px * 9 * s, cy + sa * 42 * s + py * 9 * s);
        g.lineTo(cx + ca * 10 * s + px * 9 * s, cy + sa * 10 * s + py * 9 * s);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(80,60,50,0.3)';
        g.lineWidth = 1.2 * s;
        g.stroke();
      }
      g.fillStyle = 'rgba(80,60,50,0.6)';
      g.beginPath();
      g.arc(cx, cy, 3.5 * s, 0, TAU);
      g.fill();
      break;
    }
    case 'arch': {
      // a sandstone arch with sky showing through
      const w = (70 + r * 50) * s,
        h = (46 + r * 30) * s,
        leg = w * 0.2;
      g.beginPath();
      g.moveTo(x - w / 2, y);
      g.lineTo(x - w / 2 + 4 * s, y - h * 0.8);
      g.quadraticCurveTo(x, y - h * 1.12, x + w / 2 - 4 * s, y - h * 0.8);
      g.lineTo(x + w / 2, y);
      g.lineTo(x + w / 2 - leg, y);
      g.lineTo(x + w / 2 - leg, y - h * 0.4);
      g.quadraticCurveTo(x, y - h * 0.9, x - w / 2 + leg, y - h * 0.4);
      g.lineTo(x - w / 2 + leg, y);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,236,214,0.22)';
      g.fillRect(x - w * 0.34, y - h * 0.94, w * 0.5, 3 * s);
      break;
    }
    case 'hoodoo': {
      // a rock column with a cap balanced on top
      const h = (46 + r * 46) * s,
        w = (9 + r * 6) * s;
      g.beginPath();
      g.moveTo(x - w * 1.3, y);
      g.lineTo(x - w * 0.7, y - h * 0.5);
      g.lineTo(x - w, y - h * 0.62);
      g.lineTo(x - w * 0.6, y - h);
      g.lineTo(x + w * 0.6, y - h);
      g.lineTo(x + w * 0.9, y - h * 0.6);
      g.lineTo(x + w * 0.6, y - h * 0.48);
      g.lineTo(x + w * 1.3, y);
      g.fill();
      g.beginPath();
      g.ellipse(x, y - h - 4 * s, w * 1.5, 6 * s, 0, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.1)';
      g.fillRect(x - w * 0.8, y - h * 0.3, w * 1.6, 2.5 * s);
      g.fillRect(x - w * 0.7, y - h * 0.75, w * 1.4, 2.5 * s);
      break;
    }
    case 'rocks': {
      const h = (8 + r * 9) * s;
      g.beginPath();
      g.ellipse(x, y - h * 0.3, h * 1.1, h * 0.75, 0, Math.PI, 0);
      g.fill();
      g.beginPath();
      g.ellipse(x + h * 1.1, y - h * 0.15, h * 0.6, h * 0.45, 0, Math.PI, 0);
      g.fill();
      break;
    }
    case 'crater': {
      const w = (8 + r * 14) * s;
      g.beginPath();
      g.ellipse(x, y + w * 0.9, w, w * 0.32, 0, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.beginPath();
      g.ellipse(x, y + w * 0.9 + w * 0.12, w * 0.85, w * 0.18, 0, 0, Math.PI);
      g.fill();
      break;
    }
    case 'crack': {
      // glowing cracks in the near basalt
      g.strokeStyle = L.dColor;
      g.lineWidth = 1.6 * s;
      g.globalAlpha = 0.5 + 0.3 * Math.sin(t * 2 + r * 9);
      g.beginPath();
      let cx = x,
        cy = y + 6 * s;
      g.moveTo(cx, cy);
      for (let j = 1; j < 5; j++) {
        cx += (hash(Math.floor(r * 1e5) + j) - 0.5) * 16 * s;
        cy += 9 * s;
        g.lineTo(cx, cy);
      }
      g.stroke();
      g.globalAlpha = 1;
      break;
    }
    case 'dome': {
      const R = (26 + r * 14) * s;
      g.beginPath();
      g.arc(x, y, R, Math.PI, 0);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.beginPath();
      g.arc(x - R * 0.3, y - R * 0.45, R * 0.25, 0, TAU);
      g.fill();
      g.fillStyle = '#ffe680';
      g.fillRect(x - 4 * s, y - 8 * s, 8 * s, 8 * s);
      break;
    }
    case 'antenna': {
      const h = (50 + r * 30) * s;
      g.fillRect(x - 2 * s, y - h, 4 * s, h);
      g.beginPath();
      g.ellipse(x, y - h, 14 * s, 6 * s, -0.5, 0, TAU);
      g.fill();
      g.fillStyle = Math.sin(t * 3 + r * 9) > 0 ? '#ff5d5d' : '#7a2a2a';
      g.beginPath();
      g.arc(x, y - h - 6 * s, 3 * s, 0, TAU);
      g.fill();
      break;
    }
    case 'volcano': {
      const w = 240 * s,
        h = 120 * s;
      g.beginPath();
      g.moveTo(x - w, y);
      g.lineTo(x - w * 0.18, y - h);
      g.lineTo(x + w * 0.18, y - h);
      g.lineTo(x + w, y);
      g.fill();
      const gl = g.createRadialGradient(x, y - h, 2, x, y - h, 70 * s);
      gl.addColorStop(0, 'rgba(255,140,50,0.75)');
      gl.addColorStop(1, 'rgba(255,80,30,0)');
      g.fillStyle = gl;
      g.beginPath();
      g.arc(x, y - h, 70 * s, 0, TAU);
      g.fill();
      // a lava run down the side
      g.strokeStyle = 'rgba(255,120,40,0.7)';
      g.lineWidth = 3 * s;
      g.beginPath();
      g.moveTo(x + w * 0.05, y - h);
      g.quadraticCurveTo(x + w * 0.2, y - h * 0.55, x + w * 0.16, y - h * 0.2);
      g.stroke();
      break;
    }
    case 'chimney': {
      const h = (70 + r * 50) * s;
      g.fillRect(x - 8 * s, y - h, 16 * s, h);
      g.fillStyle = 'rgba(120,90,90,0.35)';
      for (let i = 0; i < 4; i++) {
        const k = (t * 0.25 + i / 4 + r) % 1;
        g.beginPath();
        g.arc(x + k * 30 * s, y - h - k * 60 * s, (6 + k * 16) * s, 0, TAU);
        g.fill();
      }
      break;
    }
  }
}

// ---------- track ----------
// The track is a thin red line over the scenery, nothing filled in under it. Pit walls and floors aren't drawn,
// so a pit is simply a break in the line; lava sits in its gap (drawn after the bikes, so a bike sinks into it).
function visibleRange(cam: Camera) {
  return [cam.wx(-60), cam.wx(cam.W + 60)];
}
// which ground segments to leave out: pit walls and floors, and the tall walls that close off each end
const hiddenCache = new WeakMap<C.Level, Uint8Array>();
function hiddenSegments(level: C.Level) {
  const cached = hiddenCache.get(level);
  if (cached) return cached;
  const P = level.ground,
    K = level.kinds,
    hide = new Uint8Array(K.length);
  for (let i = 0; i < K.length; i++) {
    const ax = P[i * 2],
      ay = P[i * 2 + 1],
      bx = P[i * 2 + 2],
      by = P[i * 2 + 3];
    if (K[i] === 'pit' || K[i] === 'lava') {
      hide[i] = 1;
      continue;
    }
    if (Math.abs(bx - ax) < 0.01 && Math.abs(by - ay) > 20) {
      hide[i] = 1;
      continue;
    }
    for (const pit of level.pits)
      if (Math.min(ax, bx) >= pit.x0 - 0.01 && Math.max(ax, bx) <= pit.x1 + 0.01 && Math.min(ay, by) <= pit.y + 0.01) {
        hide[i] = 1;
        break;
      }
  }
  hiddenCache.set(level, hide);
  return hide;
}
export function lineWidth(cam: Camera) {
  return Math.max(2.4, 0.08 * cam.ppm);
}
export function drawTerrain(g: CanvasRenderingContext2D, cam: Camera, level: C.Level, theme: Theme) {
  if (level.paths) {
    drawTrackPaths(g, cam, level.paths, theme);
    return;
  }
  const P = level.ground,
    K = level.kinds,
    hide = hiddenSegments(level);
  const [x0, x1] = visibleRange(cam);
  // index range of visible segments (ground x is non-decreasing)
  let s0 = 0;
  while (s0 + 1 < K.length && P[s0 * 2 + 2] < x0) s0++;
  let s1 = s0;
  while (s1 < K.length - 1 && P[s1 * 2] <= x1) s1++;
  const w = lineWidth(cam),
    edge = Math.max(1, w * 0.3);
  // one path per kind of stretch: ground in the world's red, ice in pale blue
  const path = (want: boolean) => {
    g.beginPath();
    let open = false;
    for (let i = s0; i <= s1; i++) {
      if (hide[i] || (K[i] === 'ice') !== want) {
        open = false;
        continue;
      }
      const ax = cam.sx(P[i * 2]),
        ay = cam.sy(P[i * 2 + 1]),
        bx = cam.sx(P[i * 2 + 2]),
        by = cam.sy(P[i * 2 + 3]);
      if (!open) {
        g.moveTo(ax, ay);
        open = true;
      }
      g.lineTo(bx, by);
    }
  };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const icy of [false, true]) {
    path(icy);
    if (theme.halo) {
      g.strokeStyle = theme.halo;
      g.lineWidth = w + edge * 2 + 5;
      g.stroke();
    }
    g.strokeStyle = icy ? ICE.edge : theme.lineEdge;
    g.lineWidth = w + edge * 2;
    g.stroke();
    g.strokeStyle = icy ? ICE.line : theme.line;
    g.lineWidth = w;
    g.stroke();
  }
}
// Track from the level editor: one polyline per piece, going any way (ramps, loops, upside down). Same red line.
const pathBoxes = new WeakMap<number[], C.Box>();
export function drawTrackPaths(g: CanvasRenderingContext2D, cam: Camera, paths: number[][], theme: Theme) {
  const w = lineWidth(cam),
    edge = Math.max(1, w * 0.3),
    pad = 4 / cam.ppm + 1;
  const x0 = cam.wx(-60),
    x1 = cam.wx(cam.W + 60),
    yTop = cam.y + cam.H / 2 / cam.ppm + pad,
    yBot = cam.y - cam.H / 2 / cam.ppm - pad;
  g.beginPath();
  for (const P of paths) {
    let b = pathBoxes.get(P);
    if (!b) {
      b = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < P.length; i += 2) {
        b[0] = Math.min(b[0], P[i]);
        b[1] = Math.min(b[1], P[i + 1]);
        b[2] = Math.max(b[2], P[i]);
        b[3] = Math.max(b[3], P[i + 1]);
      }
      pathBoxes.set(P, b);
    }
    if (b[2] < x0 || b[0] > x1 || b[3] < yBot || b[1] > yTop) continue;
    g.moveTo(cam.sx(P[0]), cam.sy(P[1]));
    for (let i = 2; i < P.length; i += 2) g.lineTo(cam.sx(P[i]), cam.sy(P[i + 1]));
  }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (theme.halo) {
    g.strokeStyle = theme.halo;
    g.lineWidth = w + edge * 2 + 5;
    g.stroke();
  }
  g.strokeStyle = theme.lineEdge;
  g.lineWidth = w + edge * 2;
  g.stroke();
  g.strokeStyle = theme.line;
  g.lineWidth = w;
  g.stroke();
}
// lava pools in the gaps, drawn over the bikes
export function drawHazards(g: CanvasRenderingContext2D, cam: Camera, level: C.Level, t: number) {
  const [x0, x1] = visibleRange(cam),
    ppm = cam.ppm;
  for (const pit of level.pits) {
    if (pit.kind !== 'lava' || pit.x1 < x0 || pit.x0 > x1) continue;
    const ax = cam.sx(pit.x0),
      bx = cam.sx(pit.x1),
      y = cam.sy(pit.top - 1.4),
      bottom = cam.H + 4;
    if (y > bottom) continue;
    const glow = g.createLinearGradient(0, y - 2.2 * ppm, 0, y);
    glow.addColorStop(0, 'rgba(255,140,50,0)');
    glow.addColorStop(1, 'rgba(255,140,50,0.45)');
    g.fillStyle = glow;
    g.fillRect(ax, y - 2.2 * ppm, bx - ax, 2.2 * ppm);
    const lg = g.createLinearGradient(0, y, 0, y + 4.5 * ppm);
    lg.addColorStop(0, '#ffd23f');
    lg.addColorStop(0.12, '#ff8a2c');
    lg.addColorStop(0.5, '#c4321d');
    lg.addColorStop(1, '#5c140d');
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(ax, bottom);
    for (let x = ax; x <= bx; x += 5) g.lineTo(x, y + Math.sin(x * 0.05 + t * 3) * 0.1 * ppm);
    g.lineTo(bx, y);
    g.lineTo(bx, bottom);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,240,170,0.85)';
    for (let k = 0; k < 4; k++) {
      const ph = (t * 0.7 + k * 0.29 + pit.x0) % 1,
        bxp = lerp(ax + 8, bx - 8, hash(k * 7 + Math.floor(pit.x0)));
      g.beginPath();
      g.arc(bxp, y - ph * 0.4 * ppm, (1 - ph) * 0.14 * ppm, 0, TAU);
      g.fill();
    }
  }
}

// loops: a ring of the same line
export function drawLoops(g: CanvasRenderingContext2D, cam: Camera, level: C.Level, theme: Theme) {
  const ppm = cam.ppm,
    w = lineWidth(cam),
    edge = Math.max(1, w * 0.3);
  for (const L of level.loops) {
    const x = cam.sx(L.cx),
      y = cam.sy(L.cy),
      r = (L.r + 0.01) * ppm;
    if (x + r < -50 || x - r > cam.W + 50) continue;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    if (theme.halo) {
      g.strokeStyle = theme.halo;
      g.lineWidth = w + edge * 2 + 5;
      g.stroke();
    }
    g.strokeStyle = theme.lineEdge;
    g.lineWidth = w + edge * 2;
    g.stroke();
    g.strokeStyle = theme.line;
    g.lineWidth = w;
    g.stroke();
  }
}

// start line, checkpoint flags and the chequered finish flag
export function drawMarkers(
  g: CanvasRenderingContext2D,
  cam: Camera,
  level: MarkerLevel,
  t: number,
  showCheckpoints: boolean,
) {
  const ppm = cam.ppm,
    T = level.terrain;
  // levels from the editor say how high the start and finish are (their track can pass above both)
  const sy0 = cam.sy(level.startY != null ? level.startY : (T?.surface(0.6) || { y: 0 }).y),
    sx0 = cam.sx(0.6);
  if (sx0 > -20 && sx0 < cam.W + 20) {
    // a little start post
    g.fillStyle = INK;
    g.fillRect(sx0 - 0.05 * ppm - 1, sy0 - 0.9 * ppm - 1, 0.1 * ppm + 2, 0.9 * ppm + 1);
    g.fillStyle = '#ffffff';
    g.fillRect(sx0 - 0.05 * ppm, sy0 - 0.9 * ppm, 0.1 * ppm, 0.9 * ppm);
    g.fillStyle = '#43b05c';
    g.beginPath();
    g.arc(sx0, sy0 - 0.95 * ppm, 0.13 * ppm, 0, TAU);
    g.fill();
  }
  if (showCheckpoints)
    for (const cx of level.checkpoints) {
      const s = T?.surface(cx);
      if (!s) continue;
      const x = cam.sx(cx),
        y = cam.sy(s.y);
      if (x < -40 || x > cam.W + 40) continue;
      g.fillStyle = '#5b4a4c';
      g.fillRect(x - 0.04 * ppm, y - 1.6 * ppm, 0.08 * ppm, 1.6 * ppm);
      g.fillStyle = '#7be8fc';
      g.beginPath();
      g.moveTo(x + 0.04 * ppm, y - 1.6 * ppm);
      g.lineTo(x + 0.7 * ppm, y - (1.42 + Math.sin(t * 5) * 0.04) * ppm);
      g.lineTo(x + 0.04 * ppm, y - 1.22 * ppm);
      g.fill();
    }
  const fx = level.finishX,
    s = level.finishY != null ? { y: level.finishY } : T?.surface(fx) || { y: 0 };
  const x = cam.sx(fx),
    y = cam.sy(s.y);
  if (x < -4 * ppm || x > cam.W + 4 * ppm) return;
  // one tall pole with a chequered flag rippling in the wind
  const h = 4.2 * ppm,
    pw = Math.max(3, 0.12 * ppm);
  g.fillStyle = INK;
  g.fillRect(x - pw / 2 - 1.5, y - h - 1.5, pw + 3, h + 1.5);
  const pole = g.createLinearGradient(x - pw / 2, 0, x + pw / 2, 0);
  pole.addColorStop(0, '#f2eee8');
  pole.addColorStop(1, '#b9b2aa');
  g.fillStyle = pole;
  g.fillRect(x - pw / 2, y - h, pw, h);
  g.fillStyle = '#ffd43b';
  g.beginPath();
  g.arc(x, y - h - 0.06 * ppm, 0.14 * ppm, 0, TAU);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 1.5;
  g.stroke();
  const cols = 6,
    rows = 4,
    fw = 1.9 * ppm,
    fh = 1.25 * ppm,
    cw = fw / cols,
    ch = fh / rows,
    top = y - h + 0.1 * ppm;
  const wave = (i: number) => Math.sin(t * 5 - i * 0.9) * 0.08 * ppm * (i / cols);
  // outline first, then the squares, each column bent by the wave
  g.fillStyle = INK;
  g.beginPath();
  g.moveTo(x + pw / 2, top - 1.5);
  for (let i = 1; i <= cols; i++) g.lineTo(x + pw / 2 + i * cw + (i === cols ? 1.5 : 0), top + wave(i) - 1.5);
  for (let i = cols; i >= 0; i--) g.lineTo(x + pw / 2 + i * cw + (i === cols ? 1.5 : 0), top + fh + wave(i) + 1.5);
  g.closePath();
  g.fill();
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const xa = x + pw / 2 + i * cw,
        xb = xa + cw,
        wa = wave(i),
        wb = wave(i + 1);
      g.fillStyle = (i + j) % 2 ? '#2b2b33' : '#ffffff';
      g.beginPath();
      g.moveTo(xa, top + j * ch + wa);
      g.lineTo(xb + 0.4, top + j * ch + wb);
      g.lineTo(xb + 0.4, top + (j + 1) * ch + wb + 0.4);
      g.lineTo(xa, top + (j + 1) * ch + wa + 0.4);
      g.closePath();
      g.fill();
    }
}

// ---------- bike and rider ----------
// Body shapes in bike-local metres (origin at the centre of mass, y up, facing +x). The wheels, rider and
// hit circles are the same on every bike (see BASE in the core); only the bodywork and wheels look different.
//   tire: tyre depth   knobs/knobR: tread blocks (0 = road tyre)   rim: 'paint' or a colour   hub: spoke | wire | alloy
//   tank: tank outline   tall: raises the whole body (long suspension)   tuck: rider crouches forward
interface ShapeBase {
  tire: number;
  knobs: number;
  knobR?: number;
  rim: string;
  hub: 'spoke' | 'wire' | 'alloy';
  fender: 'low' | 'high' | 'none';
  tank: Pt[];
  tall?: number;
  springs?: boolean;
  frame?: boolean;
  seat?: 'stub' | 'race';
  bars?: 'tall';
  guard?: boolean;
  twinPipe?: boolean;
  lamp?: boolean;
  skid?: boolean;
  tuck?: number;
}
// a bike with a fairing has no number plate
type Shape = ShapeBase & ({ fairing: true; plate?: undefined } | { fairing?: undefined; plate: string });
const SHAPES: Record<C.BikeId, Shape> = {
  scout: {
    tire: 0.1,
    knobs: 12,
    knobR: 0.028,
    rim: '#c9c6cf',
    hub: 'spoke',
    plate: '#fdfbfd',
    fender: 'low',
    tank: [
      [-0.5, 0.22],
      [-0.05, 0.36],
      [0.36, 0.33],
      [0.46, 0.16],
      [0.05, 0.04],
      [-0.35, 0.06],
    ],
  },
  hopper: {
    tire: 0.075,
    knobs: 14,
    knobR: 0.024,
    rim: '#ffd23f',
    hub: 'wire',
    plate: '#fff3b0',
    fender: 'high',
    tall: 0.07,
    springs: true,
    tank: [
      [-0.46, 0.24],
      [-0.08, 0.38],
      [0.3, 0.35],
      [0.38, 0.2],
      [0.02, 0.1],
      [-0.3, 0.1],
    ],
  },
  twister: {
    tire: 0.09,
    knobs: 10,
    knobR: 0.032,
    rim: 'paint',
    hub: 'spoke',
    plate: '#7be8fc',
    fender: 'none',
    frame: true,
    seat: 'stub',
    bars: 'tall',
    tank: [
      [-0.18, 0.24],
      [0.06, 0.33],
      [0.32, 0.3],
      [0.36, 0.18],
      [0.08, 0.12],
      [-0.12, 0.14],
    ],
  },
  bulldog: {
    tire: 0.15,
    knobs: 10,
    knobR: 0.046,
    rim: '#55505d',
    hub: 'alloy',
    plate: '#ffd43b',
    fender: 'low',
    guard: true,
    twinPipe: true,
    lamp: true,
    skid: true,
    tank: [
      [-0.56, 0.2],
      [-0.14, 0.44],
      [0.4, 0.4],
      [0.54, 0.14],
      [0.08, -0.02],
      [-0.42, 0.02],
    ],
  },
  comet: {
    tire: 0.07,
    knobs: 0,
    rim: 'paint',
    hub: 'alloy',
    fender: 'none',
    fairing: true,
    tuck: 0.35,
    seat: 'race',
    tank: [
      [-0.36, 0.26],
      [-0.08, 0.38],
      [0.3, 0.4],
      [0.42, 0.26],
      [0.1, 0.12],
      [-0.26, 0.12],
    ],
  },
};
// a bike id from a save or another phone may be anything: those get Scout's bodywork
const shapeOf = (bike: string | undefined): Shape => SHAPES[(bike || 'scout') as C.BikeId] || SHAPES.scout;

function capsule(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, col: string) {
  g.strokeStyle = INK;
  g.lineWidth = w + 0.05;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = col;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}
function poly(g: CanvasRenderingContext2D, pts: Pt[], fill: string) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 0.045;
  g.stroke();
}
// a coil spring between two points (long-travel suspension)
function spring(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, col: string) {
  const dx = x1 - x0,
    dy = y1 - y0,
    l = Math.hypot(dx, dy),
    ux = dx / l,
    uy = dy / l,
    px = -uy * w,
    py = ux * w,
    n = 7;
  g.beginPath();
  g.moveTo(x0, y0);
  for (let i = 1; i < n * 2; i++) {
    const t = i / (n * 2),
      s = i % 2 ? 1 : -1;
    g.lineTo(x0 + dx * t + px * s, y0 + dy * t + py * s);
  }
  g.lineTo(x1, y1);
  g.strokeStyle = INK;
  g.lineWidth = 0.06;
  g.stroke();
  g.strokeStyle = col;
  g.lineWidth = 0.032;
  g.stroke();
}
function wheel(g: CanvasRenderingContext2D, x: number, y: number, r: number, phi: number, shape: Shape, paint: Paint) {
  g.save();
  g.translate(x, y);
  g.rotate(phi);
  g.fillStyle = '#2d2a32';
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 0.035;
  g.stroke();
  // tread blocks, or a shiny stripe on a road tyre
  if (shape.knobs) {
    g.fillStyle = '#423e48';
    const kr = shape.knobR || 0.028;
    for (let i = 0; i < shape.knobs; i++) {
      const a = (i * TAU) / shape.knobs;
      g.beginPath();
      g.arc(Math.cos(a) * (r - kr * 0.7), Math.sin(a) * (r - kr * 0.7), kr, 0, TAU);
      g.fill();
    }
  } else {
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 0.02;
    g.beginPath();
    g.arc(0, 0, r - 0.03, 0.4, 1.6);
    g.stroke();
  }
  const ri = r - shape.tire,
    rim = shape.rim === 'paint' ? paint.body : shape.rim;
  g.fillStyle = rim;
  g.beginPath();
  g.arc(0, 0, ri, 0, TAU);
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 0.02;
  g.stroke();
  if (shape.hub === 'alloy') {
    // five thick spokes on a dark disc
    g.fillStyle = '#3a3640';
    g.beginPath();
    g.arc(0, 0, ri - 0.03, 0, TAU);
    g.fill();
    g.strokeStyle = rim;
    g.lineWidth = 0.045;
    for (let i = 0; i < 5; i++) {
      const a = (i * TAU) / 5;
      g.beginPath();
      g.moveTo(Math.cos(a) * 0.04, Math.sin(a) * 0.04);
      g.lineTo(Math.cos(a) * (ri - 0.03), Math.sin(a) * (ri - 0.03));
      g.stroke();
    }
  } else {
    g.fillStyle = '#efedf2';
    g.beginPath();
    g.arc(0, 0, ri - 0.03, 0, TAU);
    g.fill();
    const n = shape.hub === 'wire' ? 12 : 6;
    g.strokeStyle = '#8f8b97';
    g.lineWidth = shape.hub === 'wire' ? 0.012 : 0.022;
    for (let i = 0; i < n; i++) {
      const a = (i * TAU) / n,
        b = shape.hub === 'wire' ? a + 0.5 : a;
      g.beginPath();
      g.moveTo(Math.cos(a) * 0.04, Math.sin(a) * 0.04);
      g.lineTo(Math.cos(b) * (ri - 0.03), Math.sin(b) * (ri - 0.03));
      g.stroke();
    }
  }
  g.fillStyle = '#6d6975';
  g.beginPath();
  g.arc(0, 0, 0.05, 0, TAU);
  g.fill();
  g.restore();
}

// Draws a bike. pose: { x, y, a, wheels: [[x, y, phi], [x, y, phi]] | null, phi, lean, noRider }
export function drawBike(
  g: CanvasRenderingContext2D,
  cam: Camera,
  pose: BikePose,
  look: Look,
  opts: DrawBikeOptions = {},
) {
  const ppm = cam.ppm,
    shape = shapeOf(look.bike),
    paint = look.paint || PAINTS[0];
  const B = C.BASE,
    r = B.radius;
  g.save();
  g.globalAlpha = opts.alpha != null ? opts.alpha : 1;
  g.translate(cam.sx(pose.x), cam.sy(pose.y));
  g.scale(ppm, -ppm);
  g.rotate(pose.a);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // wheel centres in bike-local space
  const ca = Math.cos(-pose.a),
    sa = Math.sin(-pose.a);
  const local = (wx: number, wy: number): Pt => {
    const dx = wx - pose.x,
      dy = wy - pose.y;
    return [dx * ca - dy * sa, dx * sa + dy * ca];
  };
  const T = shape.tall || 0;
  let rw: Pt, fw: Pt, rphi: number, fphi: number;
  if (pose.wheels && !pose.loose) {
    rw = local(pose.wheels[0][0], pose.wheels[0][1]);
    fw = local(pose.wheels[1][0], pose.wheels[1][1]);
    rphi = pose.wheels[0][2];
    fphi = pose.wheels[1][2];
  } else {
    rw = [B.anchors[0][0], B.anchors[0][1] - 0.04];
    fw = [B.anchors[1][0], B.anchors[1][1] - 0.04];
    rphi = fphi = pose.phi || 0;
  }
  if (!pose.noBike) {
    // swingarm, rear shock and fork
    capsule(g, -0.12, -0.16 + T, rw[0], rw[1], 0.075, '#8f8b97');
    if (shape.springs) spring(g, (rw[0] - 0.12) / 2, (rw[1] - 0.16 + T) / 2 + 0.02, -0.34, 0.3 + T, 0.055, '#ffd23f');
    capsule(g, 0.4, 0.3 + T, fw[0], fw[1], 0.065, shape.springs ? '#efedf2' : '#d8b45a');
    if (shape.springs)
      spring(
        g,
        fw[0] - 0.03 + (0.37 - fw[0]) * 0.2,
        fw[1] + 0.12 + (0.36 + T - fw[1]) * 0.2,
        0.37 - (0.37 - fw[0]) * 0.12,
        0.36 + T - (0.36 + T - fw[1]) * 0.12,
        0.05,
        '#ffd23f',
      );
    else capsule(g, 0.37, 0.36 + T, fw[0] - 0.03, fw[1] + 0.12, 0.05, '#efedf2');
    if (!pose.loose) {
      wheel(g, rw[0], rw[1], r, rphi, shape, paint);
      wheel(g, fw[0], fw[1], r, fphi, shape, paint);
    }
    // engine, skid plate and exhaust
    poly(
      g,
      [
        [-0.22, -0.02],
        [0.18, -0.02],
        [0.2, -0.26],
        [-0.16, -0.28],
      ],
      '#55505d',
    );
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(-0.16, -0.12, 0.3, 0.035);
    g.fillRect(-0.16, -0.2, 0.3, 0.035);
    if (shape.skid)
      poly(
        g,
        [
          [-0.24, -0.26],
          [0.24, -0.24],
          [0.16, -0.36],
          [-0.18, -0.36],
        ],
        '#8f8b97',
      );
    if (shape.fairing) {
      capsule(g, 0.0, -0.24, -0.52, -0.1, 0.07, '#c9c6cf');
      poly(
        g,
        [
          [-0.62, -0.06],
          [-0.4, -0.1],
          [-0.4, -0.2],
          [-0.62, -0.16],
        ],
        '#8f8b97',
      );
    } else if (shape.frame) {
      capsule(g, 0.05, -0.24, -0.46, -0.14, 0.06, '#c9c6cf');
    } else {
      capsule(g, 0.1, -0.2, -0.55, 0.08 + T, 0.06, '#c9c6cf');
      if (shape.twinPipe) capsule(g, 0.12, -0.27, -0.6, -0.02 + T, 0.06, '#c9c6cf');
    }
    // open frame tubes (trials style)
    if (shape.frame) {
      capsule(g, 0.38, 0.32 + T, -0.1, -0.12 + T, 0.07, paint.dark);
      capsule(g, -0.44, 0.34 + T, -0.12, -0.12 + T, 0.06, paint.dark);
      capsule(g, 0.3, 0.3 + T, -0.44, 0.34 + T, 0.06, paint.dark);
    }
    // rear fender or tail, and the seat
    if (shape.fender === 'low')
      poly(
        g,
        [
          [-0.4, 0.2 + T],
          [-0.95, 0.3 + T],
          [-0.9, 0.36 + T],
          [-0.36, 0.3 + T],
        ],
        paint.body,
      );
    else if (shape.fender === 'high')
      poly(
        g,
        [
          [-0.42, 0.24 + T],
          [-1.0, 0.44 + T],
          [-0.96, 0.5 + T],
          [-0.38, 0.34 + T],
        ],
        paint.body,
      );
    if (shape.fairing) {
      // pointed tail with a stripe
      poly(
        g,
        [
          [-0.2, 0.3],
          [-0.94, 0.5],
          [-0.92, 0.42],
          [-0.32, 0.12],
        ],
        paint.body,
      );
      g.strokeStyle = paint.dark;
      g.lineWidth = 0.05;
      g.beginPath();
      g.moveTo(-0.34, 0.28);
      g.lineTo(-0.86, 0.44);
      g.stroke();
    }
    if (shape.seat === 'stub')
      poly(
        g,
        [
          [-0.5, 0.32 + T],
          [-0.26, 0.36 + T],
          [-0.26, 0.42 + T],
          [-0.48, 0.38 + T],
        ],
        '#2d2a32',
      );
    else if (shape.seat === 'race')
      poly(
        g,
        [
          [-0.44, 0.34],
          [0.0, 0.38],
          [0.0, 0.44],
          [-0.42, 0.4],
        ],
        '#2d2a32',
      );
    else
      poly(
        g,
        [
          [-0.62, 0.3 + T],
          [0.02, 0.38 + T],
          [0.02, 0.44 + T],
          [-0.58, 0.38 + T],
        ],
        '#2d2a32',
      );
    // tank and its shine
    poly(
      g,
      shape.tank.map(([x, y]): Pt => [x, y + T]),
      paint.body,
    );
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.moveTo(shape.tank[1][0], shape.tank[1][1] + T - 0.04);
    g.lineTo(shape.tank[2][0] - 0.05, shape.tank[2][1] + T - 0.05);
    g.lineTo(shape.tank[2][0] - 0.12, shape.tank[2][1] + T - 0.1);
    g.closePath();
    g.fill();
    if (!shape.frame && !shape.fairing) {
      g.fillStyle = paint.dark;
      g.beginPath();
      g.moveTo(-0.3, 0.12 + T);
      g.lineTo(0.1, 0.1 + T);
      g.lineTo(0.05, 0.18 + T);
      g.lineTo(-0.28, 0.2 + T);
      g.fill();
    }
    // crash bars in front of the engine
    if (shape.guard) {
      capsule(g, 0.46, 0.22, 0.38, -0.14, 0.05, '#55505d');
      capsule(g, 0.38, -0.14, 0.14, -0.33, 0.05, '#55505d');
    }
    // front end
    if (shape.fairing) {
      // belly pan
      poly(
        g,
        [
          [-0.22, -0.02],
          [0.26, 0.0],
          [0.38, -0.2],
          [0.0, -0.3],
          [-0.2, -0.26],
        ],
        paint.dark,
      );
      // nose
      poly(
        g,
        [
          [0.12, 0.3],
          [0.42, 0.58],
          [0.7, 0.34],
          [0.66, 0.06],
          [0.3, -0.02],
          [0.1, 0.1],
        ],
        paint.body,
      );
      // windscreen
      g.fillStyle = 'rgba(123,232,252,0.75)';
      g.strokeStyle = INK;
      g.lineWidth = 0.035;
      g.beginPath();
      g.moveTo(0.4, 0.56);
      g.lineTo(0.5, 0.74);
      g.lineTo(0.6, 0.64);
      g.lineTo(0.66, 0.4);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#fff3b0';
      g.beginPath();
      g.ellipse(0.62, 0.2, 0.06, 0.035, -0.6, 0, TAU);
      g.fill();
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.lineWidth = 0.04;
      g.beginPath();
      g.moveTo(0.2, 0.26);
      g.lineTo(0.44, 0.48);
      g.stroke();
      // a short front mudguard over the road tyre
      poly(
        g,
        [
          [fw[0] - 0.26, fw[1] + 0.3],
          [fw[0] + 0.12, fw[1] + 0.38],
          [fw[0] + 0.16, fw[1] + 0.33],
          [fw[0] - 0.2, fw[1] + 0.25],
        ],
        paint.dark,
      );
    } else {
      if (shape.fender === 'low')
        poly(
          g,
          [
            [0.5, 0.14],
            [0.98, 0.12],
            [0.95, 0.06],
            [0.52, 0.06],
          ],
          paint.body,
        );
      else if (shape.fender === 'high')
        poly(
          g,
          [
            [0.44, 0.24 + T],
            [1.02, 0.28 + T],
            [0.98, 0.2 + T],
            [0.48, 0.16 + T],
          ],
          paint.body,
        );
      poly(
        g,
        [
          [0.4, 0.3 + T],
          [0.56, 0.44 + T],
          [0.6, 0.3 + T],
          [0.48, 0.2 + T],
        ],
        shape.plate,
      );
      if (shape.lamp) {
        g.fillStyle = '#fff3b0';
        g.strokeStyle = INK;
        g.lineWidth = 0.035;
        g.beginPath();
        g.arc(0.6, 0.36, 0.08, 0, TAU);
        g.fill();
        g.stroke();
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(0.62, 0.38, 0.028, 0, TAU);
        g.fill();
      }
    }
    // handlebar
    if (shape.bars === 'tall') {
      capsule(g, 0.42, 0.42 + T, 0.36, 0.68 + T, 0.045, '#55505d');
      capsule(g, 0.3, 0.66 + T, 0.42, 0.64 + T, 0.035, '#55505d');
    } else if (shape.fairing) capsule(g, 0.44, 0.5, 0.34, 0.58, 0.045, '#55505d');
    else capsule(g, 0.42, 0.42 + T, 0.34, 0.6 + T, 0.045, '#55505d');
  }
  if (!pose.noRider) drawRider(g, (pose.lean || 0) - (shape.tuck || 0), paint, T);
  g.restore();
}
function drawRider(g: CanvasRenderingContext2D, lean: number, paint: Paint, tall: number) {
  // lean > 0 leans back, < 0 leans forward
  const L = Math.max(-1, Math.min(1, lean));
  const hip = [-0.2 - L * 0.08, 0.46 + tall],
    shoulder = [0.02 - L * 0.16, 0.86 + tall - Math.abs(L) * 0.03];
  const head = [0.1 - L * 0.17, 1.04 + tall - Math.abs(L) * 0.03],
    hand = [0.33, 0.6 + tall];
  const knee = [0.12, 0.32 + tall],
    foot = [-0.04, 0.0];
  const elbow = [(shoulder[0] + hand[0]) / 2 + 0.02, (shoulder[1] + hand[1]) / 2 - 0.08];
  capsule(g, hip[0], hip[1], knee[0], knee[1], 0.15, paint.suit);
  capsule(g, knee[0], knee[1], foot[0], foot[1], 0.12, paint.suit);
  capsule(g, foot[0] - 0.02, foot[1] - 0.01, foot[0] + 0.1, foot[1] - 0.02, 0.09, '#2d2a32');
  capsule(g, hip[0], hip[1], shoulder[0], shoulder[1], 0.22, paint.suit);
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.lineWidth = 0.05;
  g.beginPath();
  g.moveTo(hip[0] + 0.04, hip[1] + 0.05);
  g.lineTo(shoulder[0] + 0.05, shoulder[1] - 0.04);
  g.stroke();
  capsule(g, shoulder[0], shoulder[1], elbow[0], elbow[1], 0.1, paint.suit);
  capsule(g, elbow[0], elbow[1], hand[0], hand[1], 0.09, paint.suit);
  g.fillStyle = '#2d2a32';
  g.beginPath();
  g.arc(hand[0], hand[1], 0.055, 0, TAU);
  g.fill();
  drawHelmet(g, head[0], head[1], paint);
}
function drawHelmet(g: CanvasRenderingContext2D, x: number, y: number, paint: Paint) {
  g.save();
  g.translate(x, y);
  g.fillStyle = paint.helmet;
  g.strokeStyle = INK;
  g.lineWidth = 0.04;
  g.beginPath();
  g.arc(0, 0, 0.21, 0, TAU);
  g.fill();
  g.stroke();
  // chin guard
  g.beginPath();
  g.moveTo(0.08, -0.1);
  g.quadraticCurveTo(0.26, -0.14, 0.24, -0.02);
  g.lineTo(0.1, 0.0);
  g.closePath();
  g.fill();
  g.stroke();
  // visor opening
  g.fillStyle = '#2d2a32';
  g.beginPath();
  g.moveTo(0.05, 0.06);
  g.quadraticCurveTo(0.2, 0.08, 0.215, 0.0);
  g.lineTo(0.2, -0.04);
  g.quadraticCurveTo(0.12, -0.01, 0.05, 0.0);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(123,232,252,0.85)';
  g.beginPath();
  g.ellipse(0.15, 0.025, 0.045, 0.02, 0, 0, TAU);
  g.fill();
  // stripe and peak
  g.strokeStyle = paint.body;
  g.lineWidth = 0.05;
  g.beginPath();
  g.arc(0, 0, 0.15, Math.PI * 0.55, Math.PI * 1.05);
  g.stroke();
  g.fillStyle = paint.body;
  g.strokeStyle = INK;
  g.lineWidth = 0.035;
  g.beginPath();
  g.moveTo(0.02, 0.17);
  g.lineTo(0.3, 0.13);
  g.lineTo(0.22, 0.08);
  g.lineTo(0.0, 0.12);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}
// a wheel that came off in a crash, rolling on its own
export function drawWheel(
  g: CanvasRenderingContext2D,
  cam: Camera,
  x: number,
  y: number,
  phi: number,
  look: Look,
  alpha = 1,
) {
  const shape = shapeOf(look.bike),
    paint = look.paint || PAINTS[0];
  g.save();
  g.globalAlpha = alpha;
  g.translate(cam.sx(x), cam.sy(y));
  g.scale(cam.ppm, -cam.ppm);
  wheel(g, 0, 0, C.BASE.radius, phi, shape, paint);
  g.restore();
}
// the rider tumbling free after a crash
export function drawRagdoll(
  g: CanvasRenderingContext2D,
  cam: Camera,
  R: Pick<C.Ragdoll, 'x' | 'y' | 'a'>,
  paint: Paint,
) {
  const ppm = cam.ppm;
  g.save();
  g.translate(cam.sx(R.x), cam.sy(R.y));
  g.scale(ppm, -ppm);
  g.rotate(R.a);
  g.lineCap = 'round';
  capsule(g, -0.05, -0.25, 0.05, 0.2, 0.22, paint.suit);
  capsule(g, 0.0, -0.25, -0.25, -0.55, 0.13, paint.suit);
  capsule(g, 0.0, -0.25, 0.22, -0.52, 0.13, paint.suit);
  capsule(g, 0.04, 0.15, 0.3, 0.0, 0.1, paint.suit);
  capsule(g, 0.04, 0.15, -0.25, 0.05, 0.1, paint.suit);
  drawHelmet(g, 0.06, 0.4, paint);
  g.restore();
}
export function drawTag(g: CanvasRenderingContext2D, cam: Camera, x: number, y: number, text: string, color: string) {
  const sx = cam.sx(x),
    sy = cam.sy(y + 1.9);
  g.font = `${Math.round(Math.max(12, cam.ppm * 0.42))}px 'Lilita One', 'Trebuchet MS', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  const w = g.measureText(text).width + 14,
    h = Math.max(18, cam.ppm * 0.56);
  g.fillStyle = 'rgba(43,30,34,0.72)';
  roundRect(g, sx - w / 2, sy - h, w, h, h / 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(sx - w / 2 + h / 2 - 1, sy - h / 2, h * 0.2, 0, TAU);
  g.fill();
  g.fillStyle = '#fff';
  g.fillText(text, sx + h * 0.15, sy - h * 0.12);
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------- particles ----------
/** How a burst particle looks: a spinning confetti strip, a star or a round puff */
export type BurstKind = 'confetti' | 'star' | 'puff';
/** A particle in metres, with its age and lifetime in seconds; dust drifts and grows, the rest fall and spin */
export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  size: number;
  color: string;
} & ({ kind: 'dust' } | { kind: BurstKind; rot: number; spin: number });
export class Particles {
  list: Particle[] = [];
  add(p: Particle) {
    if (this.list.length < 400) this.list.push(p);
  }
  dust(x: number, y: number, vx: number, vy: number, color: string, n = 1, size = 0.18) {
    for (let i = 0; i < n; i++)
      this.add({
        x,
        y,
        vx: vx + (Math.random() - 0.5) * 1.6,
        vy: vy + Math.random() * 1.4,
        life: 0.5 + Math.random() * 0.4,
        age: 0,
        size: size * (0.6 + Math.random() * 0.8),
        color,
        kind: 'dust',
      });
  }
  burst(x: number, y: number, colors: string[], n = 40, speed = 7, kind: BurstKind = 'confetti') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU,
        s = speed * (0.3 + Math.random() * 0.7);
      this.add({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s + speed * 0.4,
        life: 1 + Math.random() * 0.8,
        age: 0,
        size: 0.12 + Math.random() * 0.1,
        color: colors[i % colors.length],
        kind,
        rot: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 12,
      });
    }
  }
  step(dt: number, gravity: number) {
    for (const p of this.list) {
      p.age += dt;
      if (p.kind === 'dust') {
        p.vx *= 1 - 2 * dt;
        p.vy *= 1 - 2 * dt;
        p.vy += 0.6 * dt;
        p.size += dt * 0.5;
      } else {
        p.vy -= gravity * 0.45 * dt;
        p.vx *= 1 - 0.8 * dt;
        p.rot += p.spin * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.age < p.life);
  }
  draw(g: CanvasRenderingContext2D, cam: Camera) {
    const ppm = cam.ppm;
    for (const p of this.list) {
      const k = 1 - p.age / p.life,
        x = cam.sx(p.x),
        y = cam.sy(p.y);
      if (x < -30 || x > cam.W + 30) continue;
      g.globalAlpha = p.kind === 'dust' ? k * 0.7 : Math.min(1, k * 2);
      g.fillStyle = p.color;
      if (p.kind === 'dust' || p.kind === 'puff') {
        g.beginPath();
        g.arc(x, y, p.size * ppm, 0, TAU);
        g.fill();
      } else if (p.kind === 'star') {
        star(g, x, y, p.size * ppm * 1.6, p.rot);
      } else {
        g.save();
        g.translate(x, y);
        g.rotate(p.rot);
        g.fillRect(-p.size * ppm, -p.size * ppm * 0.5, p.size * ppm * 2, p.size * ppm);
        g.restore();
      }
    }
    g.globalAlpha = 1;
  }
}
function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2,
      rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

// a still picture of a world for the world cards
export function drawThumb(canvas: HTMLCanvasElement, world: Pick<C.World, 'id'>, level: C.Level) {
  const g = canvas.getContext('2d')!,
    theme = THEMES[world.id];
  const cam = new Camera();
  cam.W = canvas.width;
  cam.H = canvas.height;
  cam.ppm = canvas.height / 11;
  // frame a stretch of solid ground a little way in, away from pits
  let x = 40;
  for (let tx = 40; tx < Math.min(level.finishX - 20, 160); tx += 2) {
    const ok =
      !level.pits.some((p) => tx > p.x0 - 14 && tx < p.x1 + 8) &&
      !level.loops.some((L) => Math.abs(L.cx - tx) < L.r + 6);
    const s = level.terrain.surface(tx);
    if (ok && s && Math.abs(s.y) < 6) {
      x = tx;
      if (tx > 55) break;
    }
  }
  const s = level.terrain.surface(x) || { y: 0 };
  cam.x = x + 4;
  cam.y = s.y + 2.6;
  drawSky(g, cam, theme, 0);
  drawLayers(g, cam, theme, 0);
  drawLoops(g, cam, level, theme);
  drawTerrain(g, cam, level, theme);
  drawHazards(g, cam, level, 0);
}
