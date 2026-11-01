// Bike Race drawing: skies, parallax scenery, terrain, bikes, riders and effects, all on a 2D canvas.
// Exposes window.BikeRaceArt. World units are metres with y up; the camera turns them into pixels.
(() => {
'use strict';
const C = window.BikeRaceCore;
const INK = '#3b2326';
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const withAlpha = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

// ---------- seeded noise ----------
function hash(n) {
  n = Math.imul(n ^ 0x27d4eb2d, 0x9e3779b1);
  n ^= n >>> 15; n = Math.imul(n, 0x85ebca6b); n ^= n >>> 13;
  return ((n >>> 0) % 100000) / 100000;   // 0..1
}
function noise1(x, seed) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i * 7919 + seed * 104729), hash((i + 1) * 7919 + seed * 104729), u);
}
const fbm = (x, seed) => noise1(x, seed) * 0.6 + noise1(x * 2.13, seed + 7) * 0.28 + noise1(x * 4.7, seed + 13) * 0.12;

// ---------- paints and themes ----------
const PAINTS = [
  { id: 'red', body: '#e8463c', dark: '#a52a24', suit: '#2f5fb3', helmet: '#ffd23f' },
  { id: 'blue', body: '#3a7bd5', dark: '#24508f', suit: '#e8463c', helmet: '#ffffff' },
  { id: 'green', body: '#43b05c', dark: '#2a7a3e', suit: '#2d3142', helmet: '#7be8fc' },
  { id: 'orange', body: '#f39234', dark: '#b8611a', suit: '#4a3aa8', helmet: '#ffffff' },
  { id: 'purple', body: '#8e5bd6', dark: '#5d3594', suit: '#22b3a6', helmet: '#ffd23f' },
  { id: 'pink', body: '#ec6fa4', dark: '#b2457a', suit: '#3b2f6b', helmet: '#ffffff' },
  { id: 'yellow', body: '#f2c230', dark: '#b38a12', suit: '#2b2b33', helmet: '#e8463c' },
  { id: 'teal', body: '#22b3a6', dark: '#14796f', suit: '#f39234', helmet: '#ffffff' },
];
const paintAt = (i) => PAINTS[((i % PAINTS.length) + PAINTS.length) % PAINTS.length];

const THEMES = {
  clover: {
    sky: ['#79c8ef', '#d9f4ff'], sun: { x: 0.8, y: 0.18, r: 0.06, c: '#fff6c4', glow: 'rgba(255,244,190,0.55)' }, clouds: '#ffffff',
    layers: [
      { p: 0.06, base: 0.62, amp: 0.16, freq: 0.0025, color: '#b8e2d0', seed: 3 },
      { p: 0.16, base: 0.7, amp: 0.12, freq: 0.005, color: '#97d39f', seed: 5, deco: 'tree', every: 70, dColor: '#7cbf84' },
      { p: 0.32, base: 0.8, amp: 0.08, freq: 0.009, color: '#79c472', seed: 8, deco: 'windmill', every: 520, dColor: '#f4efe6' },
    ],
    ground: '#9b6a45', strata: '#875b3a', deep: '#6e472d', top: '#5bbd4f', topHi: '#8fe070', wall: '#86593a',
    props: ['tuft', 'flower', 'tuft', 'bush', 'rock'], propColors: ['#4aa944', '#ff7aa8', '#ffd23f', '#3f9a44', '#c9b8a6'],
  },
  ember: {
    sky: ['#ff9f6b', '#ffe2b0'], sun: { x: 0.22, y: 0.28, r: 0.075, c: '#fff1c9', glow: 'rgba(255,220,160,0.6)' }, clouds: '#ffe9d6',
    layers: [
      { p: 0.06, base: 0.6, amp: 0.1, freq: 0.002, color: '#efb08d', seed: 11, flat: true },
      { p: 0.15, base: 0.7, amp: 0.1, freq: 0.004, color: '#e3906a', seed: 12, deco: 'mesa', every: 260, dColor: '#e3906a' },
      { p: 0.3, base: 0.82, amp: 0.05, freq: 0.01, color: '#cf7350', seed: 14, deco: 'spire', every: 150, dColor: '#c76a47' },
    ],
    ground: '#c0613a', strata: '#a9502f', deep: '#8a3f25', top: '#e98a55', topHi: '#ffb27c', wall: '#a9502f',
    props: ['rock', 'shrub', 'rock', 'skull'], propColors: ['#d98a62', '#9a7a3c', '#b8714f', '#f4e6d4'],
  },
  frost: {
    sky: ['#a9def7', '#f2fbff'], sun: { x: 0.7, y: 0.2, r: 0.05, c: '#ffffff', glow: 'rgba(255,255,255,0.6)' }, clouds: '#ffffff',
    layers: [
      { p: 0.06, base: 0.58, amp: 0.2, freq: 0.004, color: '#d8ecf7', seed: 21, peaks: true },
      { p: 0.15, base: 0.68, amp: 0.16, freq: 0.006, color: '#b4d6ea', seed: 22, peaks: true },
      { p: 0.32, base: 0.8, amp: 0.06, freq: 0.012, color: '#89b9d4', seed: 24, deco: 'pine', every: 40, dColor: '#5f93ad' },
    ],
    ground: '#7e9fb8', strata: '#6f8fa8', deep: '#5a7890', top: '#ffffff', topHi: '#ffffff', wall: '#6f8fa8', topEdge: '#cfe6f5',
    props: ['snow', 'pine', 'snow', 'rock'], propColors: ['#ffffff', '#4f8aa6', '#ffffff', '#9fb6c8'],
  },
  moon: {
    sky: ['#0f0c26', '#2e2b63'], sun: { x: 0.78, y: 0.22, r: 0.07, c: '#5fb6ff', glow: 'rgba(110,180,255,0.35)', planet: true }, stars: true,
    layers: [
      { p: 0.05, base: 0.66, amp: 0.1, freq: 0.003, color: '#3b3970', seed: 31 },
      { p: 0.14, base: 0.74, amp: 0.08, freq: 0.006, color: '#56538c', seed: 32, deco: 'dome', every: 600, dColor: '#8a87c2' },
      { p: 0.3, base: 0.83, amp: 0.05, freq: 0.012, color: '#6f6ca5', seed: 34, deco: 'antenna', every: 340, dColor: '#a9a6d6' },
    ],
    ground: '#8d8aa8', strata: '#7d7a98', deep: '#625f7e', top: '#cfcde2', topHi: '#eceaf7', wall: '#7d7a98',
    props: ['crater', 'rock', 'crater'], propColors: ['#77748f', '#a9a6c0', '#77748f'],
  },
  magma: {
    sky: ['#2a0f14', '#8c2f1d'], sun: { x: 0.3, y: 0.3, r: 0.09, c: '#ff9a3c', glow: 'rgba(255,120,40,0.4)' }, embers: true,
    layers: [
      { p: 0.06, base: 0.6, amp: 0.14, freq: 0.003, color: '#4a1c1d', seed: 41, deco: 'volcano', every: 900, dColor: '#4a1c1d' },
      { p: 0.15, base: 0.72, amp: 0.08, freq: 0.006, color: '#3a1718', seed: 42, deco: 'chimney', every: 300, dColor: '#2c1213' },
      { p: 0.3, base: 0.82, amp: 0.05, freq: 0.012, color: '#2c1415', seed: 44 },
    ],
    ground: '#3d2b2e', strata: '#4a3236', deep: '#2a1d20', top: '#6b4a47', topHi: '#8f6660', wall: '#4a3236', cracks: '#ff7a2f',
    props: ['ember', 'rock', 'pipe'], propColors: ['#ff8a3c', '#5b4140', '#7a6a66'],
  },
};

// ---------- camera ----------
class Camera {
  constructor() { this.x = 0; this.y = 0; this.ppm = 40; this.W = 800; this.H = 450; }
  sx(x) { return (x - this.x) * this.ppm + this.W / 2; }
  sy(y) { return this.H / 2 - (y - this.y) * this.ppm; }
  wx(sx) { return (sx - this.W / 2) / this.ppm + this.x; }
}

// ---------- sky and scenery ----------
function drawSky(g, cam, theme, t) {
  const { W, H } = cam;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, theme.sky[0]); grad.addColorStop(1, theme.sky[1]);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  if (theme.stars) {
    g.fillStyle = '#fff';
    for (let i = 0; i < 90; i++) {
      const x = ((hash(i * 31 + 1) * W * 1.3 - cam.x * cam.ppm * 0.01) % W + W) % W, y = hash(i * 17 + 5) * H * 0.7;
      const r = hash(i * 13) < 0.15 ? 1.6 : 0.9;
      g.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.8 + i));
      g.fillRect(x, y, r, r);
    }
    g.globalAlpha = 1;
  }
  const s = theme.sun, R = s.r * Math.min(W, H * 1.6), sx = s.x * W, sy = s.y * H;
  const glow = g.createRadialGradient(sx, sy, R * 0.5, sx, sy, R * 3.2);
  glow.addColorStop(0, s.glow); glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow; g.fillRect(sx - R * 4, sy - R * 4, R * 8, R * 8);
  g.fillStyle = s.c; g.beginPath(); g.arc(sx, sy, R, 0, TAU); g.fill();
  if (s.planet) {   // a little blue-green planet with land blobs
    g.save(); g.beginPath(); g.arc(sx, sy, R, 0, TAU); g.clip();
    g.fillStyle = '#5ccf8a';
    for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(sx + (hash(i * 3) - 0.5) * R * 1.6, sy + (hash(i * 5) - 0.5) * R * 1.4, R * 0.35, R * 0.22, hash(i) * 3, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(10,10,40,0.35)'; g.beginPath(); g.arc(sx + R * 0.45, sy + R * 0.2, R * 1.05, 0, TAU); g.fill();
    g.restore();
  }
  if (theme.clouds) {
    g.fillStyle = theme.clouds;
    for (let i = 0; i < 6; i++) {
      const span = W + 400, x = ((hash(i * 41) * span - cam.x * cam.ppm * 0.03 - t * 6 * (1 + i % 3)) % span + span) % span - 200;
      const y = H * (0.08 + hash(i * 23) * 0.3), sc = 0.6 + hash(i * 7) * 0.8;
      g.globalAlpha = 0.75;
      cloud(g, x, y, 60 * sc);
    }
    g.globalAlpha = 1;
  }
}
function blobs(g, list) {
  g.beginPath();
  for (const [x, y, r] of list) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
  g.fill();
}
function cloud(g, x, y, s) {
  g.beginPath();
  g.ellipse(x, y, s, s * 0.32, 0, 0, TAU);
  g.ellipse(x - s * 0.4, y - s * 0.12, s * 0.42, s * 0.3, 0, 0, TAU);
  g.ellipse(x + s * 0.25, y - s * 0.2, s * 0.5, s * 0.38, 0, 0, TAU);
  g.fill();
}

function layerY(L, cam, px) {
  let n = fbm(px * L.freq, L.seed);
  if (L.peaks) n = 1 - Math.abs(n * 2 - 1);         // sharper ridges
  if (L.flat) n = Math.round(n * 3) / 3;            // stepped plateaus
  return cam.H * (L.base - L.amp * n);
}
function drawLayers(g, cam, theme, t) {
  const { W, H } = cam;
  const yShift = Math.max(-H * 0.08, Math.min(H * 0.08, cam.y * cam.ppm * 0.04));
  for (const L of theme.layers) {
    const off = cam.x * cam.ppm * L.p, dy = yShift * (L.p * 4);
    g.fillStyle = L.color;
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W + 8; x += 8) g.lineTo(x, layerY(L, cam, x + off) + dy);
    g.lineTo(W, H); g.closePath(); g.fill();
    if (L.deco) {
      const k0 = Math.floor((off - 200) / L.every), k1 = Math.ceil((off + W + 200) / L.every);
      for (let k = k0; k <= k1; k++) {
        if (hash(k * 97 + L.seed) < 0.45) continue;
        const px = k * L.every + hash(k * 13 + L.seed) * L.every * 0.6, x = px - off;
        drawDeco(g, L.deco, x, layerY(L, cam, px) + dy + 4, L, hash(k * 7 + L.seed), t, cam);
      }
    }
  }
}
function drawDeco(g, kind, x, y, L, r, t, cam) {
  const s = cam.H / 450;
  g.fillStyle = L.dColor;
  switch (kind) {
    case 'tree': {
      const h = (26 + r * 18) * s;
      g.fillRect(x - 2 * s, y - h * 0.5, 4 * s, h * 0.5);
      blobs(g, [[x, y - h * 0.62, h * 0.36], [x - h * 0.22, y - h * 0.45, h * 0.26], [x + h * 0.22, y - h * 0.48, h * 0.28]]);
      break;
    }
    case 'pine': {
      const h = (30 + r * 26) * s;
      g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + h * 0.32, y - h * 0.1); g.lineTo(x - h * 0.32, y - h * 0.1); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + h * 0.12, y - h * 0.68); g.lineTo(x - h * 0.12, y - h * 0.68); g.fill();
      break;
    }
    case 'windmill': {
      const h = 64 * s, col = L.dColor;
      g.beginPath(); g.moveTo(x - 11 * s, y); g.lineTo(x - 6 * s, y - h); g.lineTo(x + 6 * s, y - h); g.lineTo(x + 11 * s, y); g.fill();
      g.beginPath(); g.moveTo(x - 9 * s, y - h); g.lineTo(x, y - h - 12 * s); g.lineTo(x + 9 * s, y - h); g.fill();
      g.fillStyle = 'rgba(80,60,50,0.35)'; g.fillRect(x - 3 * s, y - 12 * s, 6 * s, 12 * s);
      const a0 = t * 0.9 + r * 6, cx = x, cy = y - h - 2 * s;
      for (let i = 0; i < 4; i++) {
        const a = a0 + i * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(cx + ca * 6 * s, cy + sa * 6 * s);
        g.lineTo(cx + ca * 42 * s, cy + sa * 42 * s);
        g.lineTo(cx + ca * 42 * s + px * 9 * s, cy + sa * 42 * s + py * 9 * s);
        g.lineTo(cx + ca * 10 * s + px * 9 * s, cy + sa * 10 * s + py * 9 * s);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(80,60,50,0.3)'; g.lineWidth = 1.2 * s; g.stroke();
      }
      g.fillStyle = 'rgba(80,60,50,0.6)'; g.beginPath(); g.arc(cx, cy, 3.5 * s, 0, TAU); g.fill();
      break;
    }
    case 'mesa': {
      const w = (60 + r * 80) * s, h = (50 + r * 50) * s;
      g.beginPath(); g.moveTo(x - w * 0.6, y); g.lineTo(x - w * 0.42, y - h); g.lineTo(x + w * 0.42, y - h); g.lineTo(x + w * 0.6, y); g.fill();
      g.fillStyle = 'rgba(255,240,220,0.18)'; g.fillRect(x - w * 0.42, y - h, w * 0.84, 4 * s);
      break;
    }
    case 'spire': {
      const h = (60 + r * 70) * s, w = (14 + r * 10) * s;
      g.beginPath(); g.moveTo(x - w, y); g.lineTo(x - w * 0.55, y - h * 0.6); g.lineTo(x - w * 0.9, y - h); g.lineTo(x + w * 0.7, y - h); g.lineTo(x + w * 0.45, y - h * 0.55); g.lineTo(x + w, y); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x - w * 0.6, y - h * 0.45, w * 1.2, 3 * s); g.fillRect(x - w * 0.7, y - h * 0.8, w * 1.4, 3 * s);
      break;
    }
    case 'dome': {
      const R = (26 + r * 14) * s;
      g.beginPath(); g.arc(x, y, R, Math.PI, 0); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(x - R * 0.3, y - R * 0.45, R * 0.25, 0, TAU); g.fill();
      g.fillStyle = '#ffe680'; g.fillRect(x - 4 * s, y - 8 * s, 8 * s, 8 * s);
      break;
    }
    case 'antenna': {
      const h = (50 + r * 30) * s;
      g.fillRect(x - 2 * s, y - h, 4 * s, h);
      g.beginPath(); g.ellipse(x, y - h, 14 * s, 6 * s, -0.5, 0, TAU); g.fill();
      g.fillStyle = Math.sin(t * 3 + r * 9) > 0 ? '#ff5d5d' : '#7a2a2a'; g.beginPath(); g.arc(x, y - h - 6 * s, 3 * s, 0, TAU); g.fill();
      break;
    }
    case 'volcano': {
      const w = 240 * s, h = 120 * s;
      g.beginPath(); g.moveTo(x - w, y); g.lineTo(x - w * 0.18, y - h); g.lineTo(x + w * 0.18, y - h); g.lineTo(x + w, y); g.fill();
      const gl = g.createRadialGradient(x, y - h, 2, x, y - h, 70 * s);
      gl.addColorStop(0, 'rgba(255,140,50,0.75)'); gl.addColorStop(1, 'rgba(255,80,30,0)');
      g.fillStyle = gl; g.beginPath(); g.arc(x, y - h, 70 * s, 0, TAU); g.fill();
      break;
    }
    case 'chimney': {
      const h = (70 + r * 50) * s;
      g.fillRect(x - 8 * s, y - h, 16 * s, h);
      g.fillStyle = 'rgba(120,90,90,0.35)';
      for (let i = 0; i < 4; i++) { const k = (t * 0.25 + i / 4 + r) % 1; g.beginPath(); g.arc(x + k * 30 * s, y - h - k * 60 * s, (6 + k * 16) * s, 0, TAU); g.fill(); }
      break;
    }
  }
}

// ---------- terrain ----------
function visibleRange(cam) { return [cam.wx(-60), cam.wx(cam.W + 60)]; }

function drawTerrain(g, cam, level, theme, t, opts = {}) {
  const P = level.ground, K = level.kinds;
  const [x0, x1] = visibleRange(cam);
  // index range of visible points (ground x is non-decreasing apart from walls)
  let i0 = 0;
  while (i0 + 2 < P.length && P[i0 + 2] < x0) i0 += 2;
  let i1 = i0;
  while (i1 < P.length - 2 && P[i1] <= x1) i1 += 2;
  const bottom = cam.H + 20;
  const pts = [];
  for (let i = i0; i <= i1; i += 2) pts.push(cam.sx(P[i]), cam.sy(P[i + 1]));
  // pits and lava behind the ground
  for (const pit of level.pits) {
    if (pit.x1 < x0 || pit.x0 > x1) continue;
    const ax = cam.sx(pit.x0), bx = cam.sx(pit.x1), top = cam.sy(pit.top + 1), fl = cam.sy(pit.y);
    // the far wall of the trench, fading in below the rim so it reads as a hole, not a window
    const rim = cam.sy(pit.top - 0.4), wall = g.createLinearGradient(0, rim, 0, rim + 2.6 * cam.ppm);
    wall.addColorStop(0, withAlpha(theme.deep, 0)); wall.addColorStop(1, withAlpha(theme.deep, 0.95));
    g.fillStyle = wall; g.fillRect(ax, rim, bx - ax, fl - rim);
    if (pit.kind === 'lava') {
      const lg = g.createLinearGradient(0, fl - 80, 0, fl);
      lg.addColorStop(0, 'rgba(255,120,40,0)'); lg.addColorStop(1, 'rgba(255,120,40,0.55)');
      g.fillStyle = lg; g.fillRect(ax, top, bx - ax, fl - top);
    } else {
      g.fillStyle = 'rgba(30,15,20,0.25)'; g.fillRect(ax, fl - 40, bx - ax, 40);
    }
  }
  // ground body
  g.beginPath(); g.moveTo(pts[0], bottom);
  for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.lineTo(pts[pts.length - 2], bottom); g.closePath();
  const gg = g.createLinearGradient(0, cam.sy(level.maxY), 0, cam.sy(level.minY - 12));
  gg.addColorStop(0, theme.ground); gg.addColorStop(1, theme.deep);
  g.fillStyle = gg; g.fill();
  // strata: the outline shifted down a few times, clipped to the ground
  g.save(); g.clip();
  g.lineJoin = 'round';
  const ppm = cam.ppm;
  for (const [d, w, a] of [[1.1, 0.28, 0.55], [2.5, 0.5, 0.35], [4.6, 0.8, 0.25]]) {
    g.strokeStyle = theme.strata; g.globalAlpha = a; g.lineWidth = w * ppm;
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) { const y = pts[i + 1] + d * ppm; if (i) g.lineTo(pts[i], y); else g.moveTo(pts[i], y); }
    g.stroke();
  }
  g.globalAlpha = 1;
  if (theme.cracks) {   // glowing cracks in the basalt
    g.strokeStyle = theme.cracks; g.lineWidth = Math.max(1.5, 0.06 * ppm); g.globalAlpha = 0.55 + 0.25 * Math.sin(t * 2);
    const k0 = Math.floor(x0 / 7), k1 = Math.ceil(x1 / 7);
    for (let k = k0; k <= k1; k++) {
      if (hash(k * 3 + 1) < 0.5) continue;
      const wx = k * 7 + hash(k) * 4, s = level.terrain.surface(wx);
      if (!s) continue;
      let x = cam.sx(wx), y = cam.sy(s.y) + 0.8 * ppm;
      g.beginPath(); g.moveTo(x, y);
      for (let j = 1; j < 4; j++) { x += (hash(k * 11 + j) - 0.5) * 0.9 * ppm; y += 0.55 * ppm; g.lineTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  if (theme.props.includes('crater')) {
    g.fillStyle = 'rgba(60,58,90,0.35)';
    const k0 = Math.floor(x0 / 5), k1 = Math.ceil(x1 / 5);
    for (let k = k0; k <= k1; k++) {
      const wx = k * 5 + hash(k * 5) * 3, s = level.terrain.surface(wx);
      if (!s) continue;
      g.beginPath(); g.ellipse(cam.sx(wx), cam.sy(s.y - 1.5 - hash(k) * 4), (0.3 + hash(k * 9) * 0.6) * ppm, (0.18 + hash(k * 9) * 0.3) * ppm, 0, 0, TAU); g.fill();
    }
  }
  g.restore();
  // top band
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (theme.topEdge) { g.strokeStyle = theme.topEdge; g.lineWidth = 0.5 * ppm; strokeTop(g, pts, K, i0, 0.12 * ppm); }
  g.strokeStyle = theme.top; g.lineWidth = 0.36 * ppm; strokeTop(g, pts, K, i0, 0);
  g.strokeStyle = theme.topHi; g.lineWidth = 0.09 * ppm; strokeTop(g, pts, K, i0, -0.1 * ppm);
  // ice patches
  g.strokeStyle = '#bff4ff'; g.lineWidth = 0.34 * ppm;
  g.beginPath();
  let on = false;
  for (let i = 0; i + 2 < pts.length; i += 2) {
    const k = K[(i0 + i) / 2];
    if (k === 'ice') { if (!on) { g.moveTo(pts[i], pts[i + 1]); on = true; } g.lineTo(pts[i + 2], pts[i + 3]); } else on = false;
  }
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 0.07 * ppm; g.stroke();
  // lava surfaces
  for (const pit of level.pits) {
    if (pit.kind !== 'lava' || pit.x1 < x0 || pit.x0 > x1) continue;
    const ax = cam.sx(pit.x0 + 0.05), bx = cam.sx(pit.x1 - 0.05), y = cam.sy(pit.y + 2.2), fl = cam.sy(pit.y - 1);
    const lg = g.createLinearGradient(0, y, 0, fl);
    lg.addColorStop(0, '#ffd23f'); lg.addColorStop(0.25, '#ff8a2c'); lg.addColorStop(1, '#c4321d');
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(ax, fl);
    for (let x = ax; x <= bx; x += 6) g.lineTo(x, y + Math.sin(x * 0.05 + t * 3) * 0.12 * ppm);
    g.lineTo(bx, y); g.lineTo(bx, fl); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,240,170,0.85)';
    for (let k = 0; k < 4; k++) {
      const ph = (t * 0.7 + k * 0.29 + pit.x0) % 1, bxp = lerp(ax, bx, hash(k * 7 + Math.floor(pit.x0)));
      g.beginPath(); g.arc(bxp, y - ph * 0.4 * ppm, (1 - ph) * 0.14 * ppm, 0, TAU); g.fill();
    }
  }
}
function strokeTop(g, pts, K, i0, dy) {
  // stroke only the parts that face up (walls and pit floors get no grass/snow)
  g.beginPath();
  let drawing = false;
  for (let i = 0; i + 2 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i], up = dx > Math.abs(pts[i + 3] - pts[i + 1]) * 0.5 && K[(i0 + i) / 2] !== 'pit' && K[(i0 + i) / 2] !== 'lava';
    if (up) {
      if (!drawing) { g.moveTo(pts[i], pts[i + 1] + dy); drawing = true; }
      g.lineTo(pts[i + 2], pts[i + 3] + dy);
    } else drawing = false;
  }
  g.stroke();
}

// small props standing on the track edge, behind the bikes
function drawProps(g, cam, level, theme, t) {
  const [x0, x1] = visibleRange(cam), ppm = cam.ppm, T = level.terrain;
  const k0 = Math.floor(x0 / 2.6), k1 = Math.ceil(x1 / 2.6);
  for (let k = k0; k <= k1; k++) {
    if (hash(k * 19 + 3) < 0.55) continue;
    const wx = k * 2.6 + hash(k * 23) * 1.6;
    if (wx < 4 || Math.abs(wx - level.finishX) < 3) continue;
    const s = T.surface(wx);
    if (!s || s.kind !== 'ground' || Math.abs(s.angle) > 0.45) continue;
    const i = Math.floor(hash(k * 29) * theme.props.length), kind = theme.props[i], col = theme.propColors[i];
    const x = cam.sx(wx), y = cam.sy(s.y) + 0.05 * ppm, sc = (0.7 + hash(k * 31) * 0.6) * ppm;
    g.fillStyle = col; g.strokeStyle = col;
    switch (kind) {
      case 'tuft':
        g.lineWidth = 0.06 * ppm; g.lineCap = 'round'; g.beginPath();
        for (let j = -2; j <= 2; j++) { g.moveTo(x + j * 0.06 * sc, y); g.lineTo(x + j * 0.13 * sc, y - (0.28 - Math.abs(j) * 0.05) * sc); }
        g.stroke(); break;
      case 'flower':
        g.strokeStyle = '#4aa944'; g.lineWidth = 0.04 * ppm; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 0.3 * sc); g.stroke();
        g.fillStyle = col; for (let j = 0; j < 5; j++) { const a = j * TAU / 5; g.beginPath(); g.arc(x + Math.cos(a) * 0.07 * sc, y - 0.3 * sc + Math.sin(a) * 0.07 * sc, 0.055 * sc, 0, TAU); g.fill(); }
        g.fillStyle = '#fff3b0'; g.beginPath(); g.arc(x, y - 0.3 * sc, 0.045 * sc, 0, TAU); g.fill(); break;
      case 'bush':
        blobs(g, [[x - 0.18 * sc, y - 0.12 * sc, 0.17 * sc], [x + 0.14 * sc, y - 0.14 * sc, 0.2 * sc], [x, y - 0.26 * sc, 0.18 * sc]]); break;
      case 'rock': case 'snow': case 'crater':
        g.beginPath(); g.ellipse(x, y - 0.06 * sc, 0.26 * sc, 0.16 * sc, 0, Math.PI, 0); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.ellipse(x - 0.07 * sc, y - 0.14 * sc, 0.08 * sc, 0.04 * sc, 0, 0, TAU); g.fill(); break;
      case 'shrub':
        g.lineWidth = 0.04 * ppm; g.beginPath();
        for (let j = 0; j < 6; j++) { const a = -Math.PI / 2 + (j - 2.5) * 0.35; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 0.32 * sc, y + Math.sin(a) * 0.32 * sc); }
        g.stroke(); break;
      case 'skull':
        g.beginPath(); g.ellipse(x, y - 0.06 * sc, 0.13 * sc, 0.09 * sc, 0, Math.PI, 0); g.fill();
        g.fillStyle = '#7a4a3a'; g.fillRect(x - 0.07 * sc, y - 0.1 * sc, 0.035 * sc, 0.03 * sc); g.fillRect(x + 0.03 * sc, y - 0.1 * sc, 0.035 * sc, 0.03 * sc); break;
      case 'pine':
        g.beginPath(); g.moveTo(x, y - 1.1 * sc); g.lineTo(x + 0.35 * sc, y); g.lineTo(x - 0.35 * sc, y); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x, y - 1.1 * sc); g.lineTo(x + 0.12 * sc, y - 0.75 * sc); g.lineTo(x - 0.12 * sc, y - 0.75 * sc); g.fill(); break;
      case 'ember':
        g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 3 + k);
        g.beginPath(); g.arc(x, y - 0.08 * sc, 0.07 * sc, 0, TAU); g.fill(); g.globalAlpha = 1; break;
      case 'pipe':
        g.fillRect(x - 0.06 * sc, y - 0.7 * sc, 0.12 * sc, 0.7 * sc); g.fillRect(x - 0.12 * sc, y - 0.75 * sc, 0.24 * sc, 0.1 * sc); break;
    }
  }
}

// loops: a ring of track on struts
function drawLoops(g, cam, level, theme) {
  const ppm = cam.ppm;
  for (const L of level.loops) {
    const x = cam.sx(L.cx), y = cam.sy(L.cy), r = L.r * ppm;
    if (x + r < -50 || x - r > cam.W + 50) continue;
    g.strokeStyle = theme.deep; g.lineWidth = 0.18 * ppm;
    for (const a of [-0.5, 0.5]) { g.beginPath(); g.moveTo(x + Math.sin(a) * r, y - Math.cos(a) * r); g.lineTo(x + Math.sin(a) * r * 1.6, cam.sy(L.cy - L.r)); g.stroke(); }
    g.strokeStyle = theme.wall; g.lineWidth = 0.5 * ppm; g.beginPath(); g.arc(x, y, r + 0.25 * ppm, 0, TAU); g.stroke();
    g.strokeStyle = theme.top; g.lineWidth = 0.18 * ppm; g.beginPath(); g.arc(x, y, r + 0.06 * ppm, 0, TAU); g.stroke();
  }
}

// start line, checkpoints and the finish gate
function drawMarkers(g, cam, level, t, showCheckpoints) {
  const ppm = cam.ppm, T = level.terrain;
  const sy0 = cam.sy((T.surface(1.2) || { y: 0 }).y);
  g.fillStyle = '#fff'; g.globalAlpha = 0.85;
  g.fillRect(cam.sx(1.1), sy0 - 0.02 * ppm, 0.12 * ppm, 0.25 * ppm); g.globalAlpha = 1;
  if (showCheckpoints) for (const cx of level.checkpoints) {
    const s = T.surface(cx); if (!s) continue;
    const x = cam.sx(cx), y = cam.sy(s.y);
    if (x < -40 || x > cam.W + 40) continue;
    g.fillStyle = '#5b4a4c'; g.fillRect(x - 0.04 * ppm, y - 1.6 * ppm, 0.08 * ppm, 1.6 * ppm);
    g.fillStyle = '#7be8fc'; g.beginPath(); g.moveTo(x + 0.04 * ppm, y - 1.6 * ppm);
    g.lineTo(x + 0.7 * ppm, y - (1.42 + Math.sin(t * 5) * 0.04) * ppm); g.lineTo(x + 0.04 * ppm, y - 1.22 * ppm); g.fill();
  }
  const fx = level.finishX, s = T.surface(fx) || { y: 0 };
  const x = cam.sx(fx), y = cam.sy(s.y);
  if (x < -6 * ppm || x > cam.W + 6 * ppm) return;
  const h = 3.4 * ppm, w = 0.16 * ppm, half = 1.6 * ppm;
  // posts
  for (const px of [x - half * 0.25, x + half * 0.25]) {
    g.fillStyle = INK; g.fillRect(px - w / 2 - 2, y - h - 2, w + 4, h + 2);
    g.fillStyle = '#fdfbfd'; g.fillRect(px - w / 2, y - h, w, h);
  }
  // waving checker banner between and above the posts
  const bw = half * 1.3, bh = 0.7 * ppm, cols = 8, rows = 2, cw = bw / cols, ch = bh / rows, bx = x - bw / 2, by = y - h - bh * 0.4;
  g.fillStyle = INK; g.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const wave = Math.sin(t * 4 + i * 0.7) * 0.06 * ppm;
    g.fillStyle = (i + j) % 2 ? '#2b2b33' : '#ffffff';
    g.fillRect(bx + i * cw, by + j * ch + wave, cw + 0.5, ch + 0.5);
  }
  g.fillStyle = '#ffd43b'; g.beginPath(); g.arc(x - half * 0.25, y - h - 0.1 * ppm, 0.12 * ppm, 0, TAU); g.arc(x + half * 0.25, y - h - 0.1 * ppm, 0.12 * ppm, 0, TAU); g.fill();
}

// ---------- bike and rider ----------
// body shapes in bike-local metres (origin at the centre of mass, y up, facing +x)
const SHAPES = {
  scout: { tire: 0.1, tank: [[-0.5, 0.22], [-0.05, 0.36], [0.36, 0.33], [0.46, 0.16], [0.05, 0.04], [-0.35, 0.06]], fender: true, plate: '#fdfbfd' },
  hopper: { tire: 0.08, tank: [[-0.46, 0.26], [-0.08, 0.4], [0.32, 0.36], [0.4, 0.2], [0.02, 0.1], [-0.3, 0.1]], fender: true, plate: '#fff3b0', tall: 0.06 },
  twister: { tire: 0.09, tank: [[-0.36, 0.18], [-0.02, 0.3], [0.32, 0.3], [0.4, 0.14], [0.02, 0.02], [-0.26, 0.04]], fender: false, plate: '#7be8fc' },
  bulldog: { tire: 0.14, tank: [[-0.56, 0.2], [-0.1, 0.42], [0.4, 0.38], [0.52, 0.12], [0.06, -0.02], [-0.42, 0.02]], fender: true, plate: '#ffd43b' },
  comet: { tire: 0.09, tank: [[-0.6, 0.24], [-0.1, 0.32], [0.3, 0.38], [0.62, 0.16], [0.4, 0.0], [-0.3, 0.02]], fender: false, plate: '#ffffff', fairing: true },
};

function capsule(g, x0, y0, x1, y1, w, col) {
  g.strokeStyle = INK; g.lineWidth = w + 0.05; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}
function poly(g, pts, fill) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath(); g.fillStyle = fill; g.fill();
  g.strokeStyle = INK; g.lineWidth = 0.045; g.stroke();
}
function wheel(g, x, y, r, phi, tireW) {
  g.save(); g.translate(x, y); g.rotate(phi);
  g.fillStyle = '#2d2a32'; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  g.strokeStyle = INK; g.lineWidth = 0.035; g.stroke();
  // tread knobs
  g.fillStyle = '#423e48';
  for (let i = 0; i < 12; i++) { const a = i * TAU / 12; g.beginPath(); g.arc(Math.cos(a) * (r - 0.02), Math.sin(a) * (r - 0.02), 0.028, 0, TAU); g.fill(); }
  const ri = r - tireW;
  g.fillStyle = '#c9c6cf'; g.beginPath(); g.arc(0, 0, ri, 0, TAU); g.fill();
  g.fillStyle = '#efedf2'; g.beginPath(); g.arc(0, 0, ri - 0.035, 0, TAU); g.fill();
  g.strokeStyle = '#8f8b97'; g.lineWidth = 0.022;
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * (ri - 0.03), Math.sin(a) * (ri - 0.03)); g.stroke(); }
  g.fillStyle = '#6d6975'; g.beginPath(); g.arc(0, 0, 0.05, 0, TAU); g.fill();
  g.restore();
}

// Draws a bike. pose: { x, y, a, wheels: [[x, y, phi], [x, y, phi]] | null, lean, crashed }
function drawBike(g, cam, pose, look, opts = {}) {
  const ppm = cam.ppm, type = look.bike || 'scout', shape = SHAPES[type] || SHAPES.scout, paint = look.paint || PAINTS[0];
  const B = C.BASE, r = B.radius;
  g.save();
  g.globalAlpha = opts.alpha != null ? opts.alpha : 1;
  g.translate(cam.sx(pose.x), cam.sy(pose.y));
  g.scale(ppm, -ppm);
  g.rotate(pose.a);
  g.lineCap = 'round'; g.lineJoin = 'round';
  // wheel centres in bike-local space
  const ca = Math.cos(-pose.a), sa = Math.sin(-pose.a);
  const local = (wx, wy) => { const dx = wx - pose.x, dy = wy - pose.y; return [dx * ca - dy * sa, dx * sa + dy * ca]; };
  const tall = shape.tall || 0;
  let rw, fw, rphi, fphi;
  if (pose.wheels) { rw = local(pose.wheels[0][0], pose.wheels[0][1]); fw = local(pose.wheels[1][0], pose.wheels[1][1]); rphi = pose.wheels[0][2]; fphi = pose.wheels[1][2]; }
  else { rw = [B.anchors[0][0], B.anchors[0][1] - 0.04]; fw = [B.anchors[1][0], B.anchors[1][1] - 0.04]; rphi = fphi = pose.phi || 0; }
  const ghost = opts.ghost;
  if (!pose.noBike) {
    // swingarm and fork
    capsule(g, -0.12, -0.16 + tall, rw[0], rw[1], 0.075, '#8f8b97');
    capsule(g, 0.4, 0.3 + tall, fw[0], fw[1], 0.065, '#d8b45a');
    capsule(g, 0.37, 0.36 + tall, fw[0] - 0.03, fw[1] + 0.12, 0.05, '#efedf2');
    wheel(g, rw[0], rw[1], r, rphi, shape.tire);
    wheel(g, fw[0], fw[1], r, fphi, shape.tire);
    g.strokeStyle = INK; g.lineWidth = 0.04;
    // engine and exhaust
    poly(g, [[-0.22, -0.02], [0.18, -0.02], [0.2, -0.26], [-0.16, -0.28]], '#55505d');
    capsule(g, 0.1, -0.2, -0.55, 0.08 + tall, 0.06, '#c9c6cf');
    // rear fender and seat
    if (shape.fender) poly(g, [[-0.4, 0.2 + tall], [-0.95, 0.3 + tall], [-0.9, 0.36 + tall], [-0.36, 0.3 + tall]], paint.body);
    poly(g, [[-0.62, 0.3 + tall], [0.02, 0.38 + tall], [0.02, 0.44 + tall], [-0.58, 0.38 + tall]], '#2d2a32');
    // tank and side panel
    poly(g, shape.tank.map(([x, y]) => [x, y + tall]), paint.body);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.moveTo(shape.tank[1][0], shape.tank[1][1] + tall - 0.04); g.lineTo(shape.tank[2][0] - 0.05, shape.tank[2][1] + tall - 0.05); g.lineTo(shape.tank[2][0] - 0.12, shape.tank[2][1] + tall - 0.1); g.closePath(); g.fill();
    g.fillStyle = paint.dark; g.beginPath(); g.moveTo(-0.3, 0.12 + tall); g.lineTo(0.1, 0.1 + tall); g.lineTo(0.05, 0.18 + tall); g.lineTo(-0.28, 0.2 + tall); g.fill();
    // front fender and number plate
    if (!shape.fairing) poly(g, [[0.5, 0.14], [0.98, 0.12], [0.95, 0.06], [0.52, 0.06]], paint.body);
    else poly(g, [[0.3, 0.38 + tall], [0.58, 0.5 + tall], [0.66, 0.2], [0.42, 0.06]], paint.dark);
    poly(g, [[0.4, 0.3 + tall], [0.56, 0.44 + tall], [0.6, 0.3 + tall], [0.48, 0.2 + tall]], shape.plate);
    // handlebar
    capsule(g, 0.42, 0.42 + tall, 0.34, 0.6 + tall, 0.045, '#55505d');
  }
  if (!pose.noRider) drawRider(g, pose.lean || 0, paint, tall, ghost);
  g.restore();
}
function drawRider(g, lean, paint, tall, ghost) {
  // lean > 0 leans back, < 0 leans forward
  const L = Math.max(-1, Math.min(1, lean));
  const hip = [-0.2 - L * 0.08, 0.46 + tall], shoulder = [0.02 - L * 0.16, 0.86 + tall - Math.abs(L) * 0.03];
  const head = [0.1 - L * 0.17, 1.04 + tall - Math.abs(L) * 0.03], hand = [0.33, 0.6 + tall];
  const knee = [0.12, 0.32 + tall], foot = [-0.04, 0.0];
  const elbow = [(shoulder[0] + hand[0]) / 2 + 0.02, (shoulder[1] + hand[1]) / 2 - 0.08];
  capsule(g, hip[0], hip[1], knee[0], knee[1], 0.15, paint.suit);
  capsule(g, knee[0], knee[1], foot[0], foot[1], 0.12, paint.suit);
  capsule(g, foot[0] - 0.02, foot[1] - 0.01, foot[0] + 0.1, foot[1] - 0.02, 0.09, '#2d2a32');
  capsule(g, hip[0], hip[1], shoulder[0], shoulder[1], 0.22, paint.suit);
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(hip[0] + 0.04, hip[1] + 0.05); g.lineTo(shoulder[0] + 0.05, shoulder[1] - 0.04); g.stroke();
  capsule(g, shoulder[0], shoulder[1], elbow[0], elbow[1], 0.1, paint.suit);
  capsule(g, elbow[0], elbow[1], hand[0], hand[1], 0.09, paint.suit);
  g.fillStyle = '#2d2a32'; g.beginPath(); g.arc(hand[0], hand[1], 0.055, 0, TAU); g.fill();
  drawHelmet(g, head[0], head[1], paint);
}
function drawHelmet(g, x, y, paint) {
  g.save(); g.translate(x, y);
  g.fillStyle = paint.helmet; g.strokeStyle = INK; g.lineWidth = 0.04;
  g.beginPath(); g.arc(0, 0, 0.21, 0, TAU); g.fill(); g.stroke();
  // chin guard
  g.beginPath(); g.moveTo(0.08, -0.1); g.quadraticCurveTo(0.26, -0.14, 0.24, -0.02); g.lineTo(0.1, 0.0); g.closePath(); g.fill(); g.stroke();
  // visor opening
  g.fillStyle = '#2d2a32'; g.beginPath(); g.moveTo(0.05, 0.06); g.quadraticCurveTo(0.2, 0.08, 0.215, 0.0); g.lineTo(0.2, -0.04); g.quadraticCurveTo(0.12, -0.01, 0.05, 0.0); g.closePath(); g.fill();
  g.fillStyle = 'rgba(123,232,252,0.85)'; g.beginPath(); g.ellipse(0.15, 0.025, 0.045, 0.02, 0, 0, TAU); g.fill();
  // stripe and peak
  g.strokeStyle = paint.body; g.lineWidth = 0.05; g.beginPath(); g.arc(0, 0, 0.15, Math.PI * 0.55, Math.PI * 1.05); g.stroke();
  g.fillStyle = paint.body; g.strokeStyle = INK; g.lineWidth = 0.035;
  g.beginPath(); g.moveTo(0.02, 0.17); g.lineTo(0.3, 0.13); g.lineTo(0.22, 0.08); g.lineTo(0.0, 0.12); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
// the rider tumbling free after a crash
function drawRagdoll(g, cam, R, paint) {
  const ppm = cam.ppm;
  g.save(); g.translate(cam.sx(R.x), cam.sy(R.y)); g.scale(ppm, -ppm); g.rotate(R.a);
  g.lineCap = 'round';
  capsule(g, -0.05, -0.25, 0.05, 0.2, 0.22, paint.suit);
  capsule(g, 0.0, -0.25, -0.25, -0.55, 0.13, paint.suit);
  capsule(g, 0.0, -0.25, 0.22, -0.52, 0.13, paint.suit);
  capsule(g, 0.04, 0.15, 0.3, 0.0, 0.1, paint.suit);
  capsule(g, 0.04, 0.15, -0.25, 0.05, 0.1, paint.suit);
  drawHelmet(g, 0.06, 0.4, paint);
  g.restore();
}
function drawTag(g, cam, x, y, text, color) {
  const sx = cam.sx(x), sy = cam.sy(y + 1.9);
  g.font = `${Math.round(Math.max(12, cam.ppm * 0.42))}px 'Lilita One', 'Trebuchet MS', sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'bottom';
  const w = g.measureText(text).width + 14, h = Math.max(18, cam.ppm * 0.56);
  g.fillStyle = 'rgba(43,30,34,0.72)';
  roundRect(g, sx - w / 2, sy - h, w, h, h / 2); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(sx - w / 2 + h / 2 - 1, sy - h / 2, h * 0.2, 0, TAU); g.fill();
  g.fillStyle = '#fff'; g.fillText(text, sx + h * 0.15, sy - h * 0.12);
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ---------- particles ----------
class Particles {
  constructor() { this.list = []; }
  add(p) { if (this.list.length < 400) this.list.push(p); }
  dust(x, y, vx, vy, color, n = 1, size = 0.18) {
    for (let i = 0; i < n; i++) this.add({ x, y, vx: vx + (Math.random() - 0.5) * 1.6, vy: vy + Math.random() * 1.4, life: 0.5 + Math.random() * 0.4, age: 0, size: size * (0.6 + Math.random() * 0.8), color, kind: 'dust' });
  }
  burst(x, y, colors, n = 40, speed = 7, kind = 'confetti') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.3 + Math.random() * 0.7);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + speed * 0.4, life: 1 + Math.random() * 0.8, age: 0, size: 0.12 + Math.random() * 0.1, color: colors[i % colors.length], kind, rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 12 });
    }
  }
  step(dt, gravity) {
    for (const p of this.list) {
      p.age += dt;
      if (p.kind === 'dust') { p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; p.vy += 0.6 * dt; p.size += dt * 0.5; }
      else { p.vy -= gravity * 0.45 * dt; p.vx *= 1 - 0.8 * dt; p.rot += p.spin * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this.list = this.list.filter(p => p.age < p.life);
  }
  draw(g, cam) {
    const ppm = cam.ppm;
    for (const p of this.list) {
      const k = 1 - p.age / p.life, x = cam.sx(p.x), y = cam.sy(p.y);
      if (x < -30 || x > cam.W + 30) continue;
      g.globalAlpha = p.kind === 'dust' ? k * 0.7 : Math.min(1, k * 2);
      g.fillStyle = p.color;
      if (p.kind === 'dust' || p.kind === 'puff') { g.beginPath(); g.arc(x, y, p.size * ppm, 0, TAU); g.fill(); }
      else if (p.kind === 'star') { star(g, x, y, p.size * ppm * 1.6, p.rot); }
      else { g.save(); g.translate(x, y); g.rotate(p.rot); g.fillRect(-p.size * ppm, -p.size * ppm * 0.5, p.size * ppm * 2, p.size * ppm); g.restore(); }
    }
    g.globalAlpha = 1;
  }
}
function star(g, x, y, r, rot) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = rot + i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath(); g.fill();
}

// a still picture of a world for the world cards
function drawThumb(canvas, world, level) {
  const g = canvas.getContext('2d'), theme = THEMES[world.id];
  const cam = new Camera(); cam.W = canvas.width; cam.H = canvas.height; cam.ppm = canvas.height / 11;
  // frame a stretch of solid ground a little way in, away from pits
  let x = 40;
  for (let tx = 40; tx < Math.min(level.finishX - 20, 160); tx += 2) {
    const ok = !level.pits.some(p => tx > p.x0 - 14 && tx < p.x1 + 8) && !level.loops.some(L => Math.abs(L.cx - tx) < L.r + 6);
    const s = level.terrain.surface(tx);
    if (ok && s && Math.abs(s.y) < 6) { x = tx; if (tx > 55) break; }
  }
  const s = level.terrain.surface(x) || { y: 0 };
  cam.x = x + 4; cam.y = s.y + 2.6;
  drawSky(g, cam, theme, 0); drawLayers(g, cam, theme, 0);
  drawLoops(g, cam, level, theme);
  drawTerrain(g, cam, level, theme, 0); drawProps(g, cam, level, theme, 0);
}

window.BikeRaceArt = { THEMES, PAINTS, paintAt, Camera, drawSky, drawLayers, drawTerrain, drawProps, drawLoops, drawMarkers, drawBike, drawRagdoll, drawTag, Particles, drawThumb, INK, hash };
})();
