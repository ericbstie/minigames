// Bike Race track pieces: the shapes the level editor places, the edits it makes to them (append, move, rotate,
// flip, delete) and buildCustomLevel, which turns a saved editor level into a level the simulation can ride.
// No DOM access, so Node can load it (tools/check-bike-pieces.js). The browser gets it as window.BikeRacePieces.
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./bike-race-core.js') : root.BikeRaceCore);
  if (isNode) module.exports = api;
  else root.BikeRacePieces = api;
})(typeof self !== 'undefined' ? self : this, function (C) {
'use strict';

const DEG = Math.PI / 180;
// Every loop piece shares one radius, so a 3/4 loop and a quarter loop (or two half loops) close into a full loop.
// 3.4 m leaves the rider's head (about 1.9 m above the track) 1.5 m short of the middle of the loop, and a bike at
// top speed on flat ground still has the speed to get round. See tools/check-bike-pieces.js.
const LOOP_R = 3.4;
// The pieces, in the order of the editor's row. Each starts at its own origin heading right (+x); ramps and loops
// curve up (anticlockwise), so a bike rides on the inside of the curve.
const TYPES = [
  { id: 'line1', name: 'Short line', len: 4 },
  { id: 'line2', name: 'Medium line', len: 8 },
  { id: 'line3', name: 'Long line', len: 16 },
  { id: 'ramp1', name: 'Small ramp', r: 9, sweep: 20 },
  { id: 'ramp2', name: 'Medium ramp', r: 10, sweep: 30 },
  { id: 'ramp3', name: 'Big ramp', r: 11, sweep: 40 },
  { id: 'loop1', name: 'Quarter loop', r: LOOP_R, sweep: 90, loop: true },
  { id: 'loop2', name: 'Half loop', r: LOOP_R, sweep: 180, loop: true },
  { id: 'loop3', name: '3/4 loop', r: LOOP_R, sweep: 270, loop: true },
];
// The start and finish pads are flat lines that every level has. The bike starts 3 m along the start pad, which
// never moves; the finish flag stands 3 m along the finish pad, which can be moved and turned round.
const PAD = { start: { len: 12, at: 3 }, finish: { len: 12, at: 3 } };
const TYPE = Object.fromEntries(TYPES.map(t => [t.id, t]));
for (const k of Object.keys(PAD)) TYPE[k] = { id: k, name: k === 'start' ? 'Start' : 'Finish', len: PAD[k].len, pad: true };
const MAX_PIECES = 400, MAX_COORD = 5000, NAME_MAX = 24;
const EPS = 0.02;          // ends closer than this are joined
const GRID = 0.5;          // free placement snaps to this grid (metres)
const ROTATE_STEP = 15;    // degrees per tap of a rotate button

// Points along a piece in its own frame, from its origin to its far end. Lines get a point every metre, curves
// every 0.3 m, so the bike's wheels roll smoothly and the editor can hit-test them.
const localCache = new Map();
function localPoints(t) {
  if (localCache.has(t)) return localCache.get(t);
  const T = TYPE[t], pts = [];
  if (T.len) {
    const n = Math.max(1, Math.ceil(T.len));
    for (let i = 0; i <= n; i++) pts.push(T.len * i / n, 0);
  } else {
    const sw = T.sweep * DEG, n = Math.max(4, Math.ceil(T.r * sw / 0.3));
    for (let i = 0; i <= n; i++) { const a = sw * i / n; pts.push(T.r * Math.sin(a), T.r * (1 - Math.cos(a))); }
  }
  const out = { pts, len: T.len || T.r * T.sweep * DEG, endAngle: T.len ? 0 : T.sweep * DEG };
  localCache.set(t, out);
  return out;
}

// A placed piece is { t, x, y, a, m }: its type, where its origin is, its rotation in degrees (anticlockwise) and
// whether it is mirrored across its own direction of travel (m, which turns an upward curve into a downward one).
// The world shape is origin + rotate(a) * (x, m ? -y : y).
function geom(p) {
  const L = localPoints(p.t), ca = Math.cos(p.a * DEG), sa = Math.sin(p.a * DEG), my = p.m ? -1 : 1;
  const pts = new Array(L.pts.length);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < L.pts.length; i += 2) {
    const lx = L.pts[i], ly = L.pts[i + 1] * my, x = p.x + lx * ca - ly * sa, y = p.y + lx * sa + ly * ca;
    pts[i] = x; pts[i + 1] = y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  // outward directions at the two ends: backwards at the origin, along the far end's heading at the other
  const ea = p.a * DEG + L.endAngle * my, n = pts.length;
  const ends = [
    { x: pts[0], y: pts[1], ox: -ca, oy: -sa },
    { x: pts[n - 2], y: pts[n - 1], ox: Math.cos(ea), oy: Math.sin(ea) },
  ];
  return { pts, ends, len: L.len, box: [x0, y0, x1, y1] };
}

// The pads as pieces, so the editor and the level builder can treat everything alike.
const startPad = () => ({ t: 'start', x: -PAD.start.at, y: 0, a: 0, m: false });
const finishPad = (f) => ({ t: 'finish', x: f.x, y: f.y, a: f.d < 0 ? 180 : 0, m: false });
// [start pad, ...pieces, finish pad]; the editor numbers pieces the same way (0 is the start pad)
function allPieces(data) { return [startPad(), ...data.pieces, finishPad(data.finish)]; }

function newLevel(name) {
  return { v: 1, name: name || 'My level', pieces: [], finish: { x: PAD.start.len - PAD.start.at, y: 0, d: 1 } };
}

// ------------------------------------------------------------------------------------------------
// Saved levels come from localStorage, which anyone can edit, so everything is checked and clamped on the way in.
const num = (v, lim) => { const n = +v; return Number.isFinite(n) ? Math.max(-lim, Math.min(lim, Math.round(n * 1000) / 1000)) : 0; };
function cleanName(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX); }
function sanitize(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const pieces = (Array.isArray(d.pieces) ? d.pieces : []).slice(0, MAX_PIECES)
    .filter(p => p && typeof p === 'object' && TYPE[p.t] && !TYPE[p.t].pad)
    .map(p => ({ t: p.t, x: num(p.x, MAX_COORD), y: num(p.y, MAX_COORD), a: ((num(p.a, 1e6) % 360) + 360) % 360, m: !!p.m }));
  const f = d.finish && typeof d.finish === 'object' ? d.finish : {};
  const finish = { x: num(f.x, MAX_COORD), y: num(f.y, MAX_COORD), d: f.d < 0 ? -1 : 1 };
  if (!Number.isFinite(+f.x)) { finish.x = PAD.start.len - PAD.start.at; finish.y = 0; }
  return { v: 1, name: cleanName(d.name) || 'My level', pieces, finish };
}

// ------------------------------------------------------------------------------------------------
// Editing. All of these work on piece numbers in allPieces(data): 0 is the start pad, the last is the finish pad.
// They change data in place and return what the editor needs next.
const finishIndex = (data) => data.pieces.length + 1;
const isPiece = (data, i) => i >= 1 && i <= data.pieces.length;
function getPiece(data, i) { return i === 0 ? startPad() : i === finishIndex(data) ? finishPad(data.finish) : data.pieces[i - 1]; }
function setPiece(data, i, p) {
  if (i === finishIndex(data)) data.finish = { x: p.x, y: p.y, d: Math.abs(((p.a % 360) + 360) % 360 - 180) < 1 ? -1 : 1 };
  else if (isPiece(data, i)) data.pieces[i - 1] = p;
}
// Every end that another end sits on: [i, end, j, end2]
function joinsOf(all, geoms, i) {
  const out = [];
  for (let e = 0; e < 2; e++) {
    const E = geoms[i].ends[e];
    for (let j = 0; j < all.length; j++) {
      if (j === i) continue;
      for (let e2 = 0; e2 < 2; e2++) {
        const F = geoms[j].ends[e2];
        if (Math.abs(F.x - E.x) < EPS && Math.abs(F.y - E.y) < EPS) out.push({ e, j, e2 });
      }
    }
  }
  return out;
}
function freeEnds(data, skip) {
  const all = allPieces(data), geoms = all.map(geom), out = [];
  for (let i = 0; i < all.length; i++) {
    if (i === skip) continue;
    for (let e = 0; e < 2; e++) {
      const E = geoms[i].ends[e];
      const taken = all.some((_, j) => j !== i && j !== skip && geoms[j].ends.some(F => Math.abs(F.x - E.x) < EPS && Math.abs(F.y - E.y) < EPS));
      if (!taken) out.push({ i, e, x: E.x, y: E.y, ox: E.ox, oy: E.oy });
    }
  }
  return out;
}
// The end a piece hangs from: the joined end whose neighbour came first (start pad first). Rotating turns the piece
// about it, and flipping keeps the piece on it.
function anchorOf(data, i) {
  const all = allPieces(data), geoms = all.map(geom);
  let best = null;
  for (const J of joinsOf(all, geoms, i)) {
    if (J.j === finishIndex(data) && i !== 0) continue;       // the finish follows the track, it doesn't hold it
    if (!best || J.j < best.j) best = J;
  }
  if (!best) return null;
  const E = geoms[i].ends[best.e], N = geoms[best.j].ends[best.e2];
  return { e: best.e, x: E.x, y: E.y, dx: N.ox, dy: N.oy };   // dx, dy: the neighbour's heading into this piece
}
// The finish pad, if it sits on an end of piece i: which end. The finish keeps to that end through edits.
function finishOn(data, i) {
  const F = geom(finishPad(data.finish)).ends[0], g = geom(getPiece(data, i));
  for (let e = 0; e < 2; e++) if (Math.abs(g.ends[e].x - F.x) < EPS && Math.abs(g.ends[e].y - F.y) < EPS) return e;
  return -1;
}
// put the finish pad on end e of piece i, facing the way the track leaves that end
function putFinish(data, i, e) {
  const E = geom(getPiece(data, i)).ends[e];
  data.finish = { x: E.x, y: E.y, d: E.ox < -1e-6 ? -1 : 1 };
}
const round3 = (v) => Math.round(v * 1000) / 1000;
const normDeg = (a) => { a = round3(((a % 360) + 360) % 360); return a >= 360 ? 0 : a; };
function place(p) { p.x = round3(p.x); p.y = round3(p.y); p.a = normDeg(p.a); return p; }

// Add a piece of type t at a cursor { x, y, dx, dy } (dx, dy: the heading into the new piece). If the finish pad
// stood on that spot it moves on to the new piece's far end, so the track grows towards the finish. Returns the new
// piece's number.
function append(data, t, cur) {
  if (!TYPE[t] || TYPE[t].pad || data.pieces.length >= MAX_PIECES) return -1;
  const F = geom(finishPad(data.finish)).ends[0];
  const pushFinish = Math.abs(F.x - cur.x) < EPS && Math.abs(F.y - cur.y) < EPS;
  const p = place({ t, x: cur.x, y: cur.y, a: Math.atan2(cur.dy, cur.dx) / DEG, m: false });
  data.pieces.push(p);
  const i = data.pieces.length;
  if (pushFinish) putFinish(data, i, 1);
  return i;
}
// Turn piece i by deg degrees, about the end it hangs from (or its middle when it hangs from nothing).
function rotate(data, i, deg) {
  if (!isPiece(data, i)) return false;
  const p = { ...getPiece(data, i) }, fin = finishOn(data, i), A = anchorOf(data, i), g = geom(p);
  const qx = A ? A.x : (g.box[0] + g.box[2]) / 2, qy = A ? A.y : (g.box[1] + g.box[3]) / 2;
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG), dx = p.x - qx, dy = p.y - qy;
  p.x = qx + dx * c - dy * s; p.y = qy + dx * s + dy * c; p.a += deg;
  setPiece(data, i, place(p));
  if (fin >= 0) putFinish(data, i, fin);
  return true;
}
// Mirror piece i left to right (axis 'h') or upside down ('v'). A piece that hangs from an end stays on it, joined by
// whichever of its ends carries on most smoothly from the neighbour: a ramp flipped left to right becomes a slope
// down that levels out, flipped upside down a rounded drop. The finish pad only turns round, on the same spot.
function flip(data, i, axis) {
  const fi = finishIndex(data);
  if (i === fi) {
    if (axis !== 'h') return false;
    data.finish = { ...data.finish, d: -data.finish.d };
    return true;
  }
  if (!isPiece(data, i)) return false;
  const p = { ...getPiece(data, i) }, fin = finishOn(data, i), A = anchorOf(data, i), g = geom(p);
  const qx = (g.box[0] + g.box[2]) / 2, qy = (g.box[1] + g.box[3]) / 2;
  if (axis === 'h') { p.a = 180 - p.a; p.x = 2 * qx - p.x; } else { p.a = -p.a; p.y = 2 * qy - p.y; }
  p.m = !p.m;
  if (A) {
    const ng = geom(p);
    let best = 0, bestDot = -Infinity;
    for (let e = 0; e < 2; e++) { const d = -(ng.ends[e].ox * A.dx + ng.ends[e].oy * A.dy); if (d > bestDot + 1e-9) { bestDot = d; best = e; } }
    p.x += A.x - ng.ends[best].x; p.y += A.y - ng.ends[best].y;
  }
  setPiece(data, i, place(p));
  if (fin >= 0) putFinish(data, i, fin === 0 && A && A.e === 0 ? 1 : fin);
  return true;
}
// Where piece i would go if dragged by (dx, dy) from `from` (its place when the drag began): onto a free end of
// another piece when one of its ends comes within `snap` metres, otherwise with its origin on the grid.
function moveTo(data, i, from, dx, dy, snap) {
  if (!isPiece(data, i) && i !== finishIndex(data)) return null;
  const p = { ...from, x: from.x + dx, y: from.y + dy };
  const g = geom(p), free = freeEnds(data, i);
  let best = null;
  for (let e = 0; e < 2; e++) {
    if (i === finishIndex(data) && e === 1) continue;         // the finish joins the track by its near end
    for (const F of free) {
      const d = Math.hypot(F.x - g.ends[e].x, F.y - g.ends[e].y);
      if (d < snap && (!best || d < best.d)) best = { d, x: F.x - g.ends[e].x, y: F.y - g.ends[e].y, F, e };
    }
  }
  if (best && i === finishIndex(data)) {
    // a finish dropped on a track end stands on it facing the way the track leaves it
    p.x = best.F.x; p.y = best.F.y; p.a = best.F.ox < -1e-6 ? 180 : 0;
  } else if (best) { p.x += best.x; p.y += best.y; }
  else { p.x = Math.round(p.x / GRID) * GRID; p.y = Math.round(p.y / GRID) * GRID; }
  return { snapped: !!best, piece: place(p) };
}
function commitMove(data, i, p) {
  const fin = isPiece(data, i) ? finishOn(data, i) : -1;
  setPiece(data, i, place({ ...p }));
  if (fin >= 0) putFinish(data, i, fin);
}
function remove(data, i) {
  if (!isPiece(data, i)) return false;
  const fin = finishOn(data, i), A = anchorOf(data, i);
  data.pieces.splice(i - 1, 1);
  // a finish that stood on the removed piece goes back to where that piece hung from
  if (fin >= 0 && A) data.finish = { x: A.x, y: A.y, d: A.dx < -1e-6 ? -1 : 1 };
  return true;
}

// ------------------------------------------------------------------------------------------------
// Turning a saved level into a level for the simulation.
// GHOST_NEAR: stretches of track closer than this to each other (the rider's head is 1.9 m above the track);
// GHOST_APART: ...that are further apart than this along the track, take turns being solid (see Bike.updateGhosts).
const GHOST_NEAR = 3, GHOST_APART = 4.5, JOINT_NEAR = 4;

// The order a rider meets the pieces in, from the start pad: at each far end, carry on along whichever joined piece
// continues most smoothly (most nearly straight on, then curving up, then the one placed first); with nothing
// joined, jump to the nearest end not yet ridden, preferring ends ahead. Returns [{ i, rev, s0 }].
function ridingOrder(all, geoms) {
  const seen = new Uint8Array(all.length), order = [];
  let i = 0, rev = false, s = 0;
  for (;;) {
    seen[i] = 1;
    order.push({ i, rev, s0: s });
    s += geoms[i].len;
    const out = geoms[i].ends[rev ? 0 : 1];
    let best = null;
    for (let j = 0; j < all.length; j++) {
      if (seen[j]) continue;
      for (let e = 0; e < 2; e++) {
        const E = geoms[j].ends[e];
        const d = Math.hypot(E.x - out.x, E.y - out.y);
        if (d < EPS) {
          // how straight on it carries, and how much it then curves up (anticlockwise) over its first metres
          const straight = -(E.ox * out.ox + E.oy * out.oy);
          const P = geoms[j].pts, k = e === 0 ? Math.min(P.length - 2, 10) : Math.max(0, P.length - 12);
          const vx = P[k] - E.x, vy = P[k + 1] - E.y, turn = (out.ox * vy - out.oy * vx) / (Math.hypot(vx, vy) || 1);
          const score = Math.round(straight * 100) * 10 + turn;
          if (!best || !best.joined || score > best.score + 1e-9) best = { j, e, joined: true, score, gap: 0 };
        } else if (!best || !best.joined) {
          const ahead = (E.x - out.x) * out.ox + (E.y - out.y) * out.oy > 0;
          const score = -(d + (ahead ? 0 : 1000));
          if (!best || score > best.score) best = { j, e, joined: false, score, gap: d };
        }
      }
    }
    if (!best) break;
    s += best.gap;
    i = best.j; rev = best.e === 1;
  }
  return order;
}
function segDist(ax, ay, bx, by, cx, cy, dx, dy) {
  // shortest distance between segments AB and CD
  const pd = (px, py, x0, y0, x1, y1) => {
    const ex = x1 - x0, ey = y1 - y0, l2 = ex * ex + ey * ey;
    let t = l2 > 0 ? ((px - x0) * ex + (py - y0) * ey) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - x0 - ex * t, py - y0 - ey * t);
  };
  const cross = (x0, y0, x1, y1, x2, y2) => (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  const d1 = cross(ax, ay, bx, by, cx, cy), d2 = cross(ax, ay, bx, by, dx, dy), d3 = cross(cx, cy, dx, dy, ax, ay), d4 = cross(cx, cy, dx, dy, bx, by);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0;
  return Math.min(pd(ax, ay, cx, cy, dx, dy), pd(bx, by, cx, cy, dx, dy), pd(cx, cy, ax, ay, bx, by), pd(dx, dy, ax, ay, bx, by));
}

function buildCustomLevel(raw) {
  const data = sanitize(raw), all = allPieces(data), geoms = all.map(geom);
  const order = ridingOrder(all, geoms);
  // every segment with its distance along the track
  const segs = [];
  for (const o of order) {
    const g = geoms[o.i], P = g.pts, n = P.length / 2 - 1, T = TYPE[all[o.i].t];
    let along = 0;
    const lens = [];
    for (let k = 0; k < n; k++) { const l = Math.hypot(P[k * 2 + 2] - P[k * 2], P[k * 2 + 3] - P[k * 2 + 1]); lens.push(l); }
    for (let k = 0; k < n; k++) {
      const mid = along + lens[k] / 2;
      along += lens[k];
      segs.push({ piece: o.i, k, ax: P[k * 2], ay: P[k * 2 + 1], bx: P[k * 2 + 2], by: P[k * 2 + 3], from: [mid, g.len - mid],
        s: o.s0 + (o.rev ? g.len - mid : mid), kind: T.loop ? 'loop' : 'ground', lo: -Infinity, hi: Infinity, ghost: false });
    }
  }
  // Two pieces joined end to end (and nothing else at that spot) are always solid near their joint, even when the
  // riding order reaches them far apart (a finish pad joined behind the start, say). Where three or more ends
  // meet, as at the bottom of a closed loop, the stretches still take turns.
  const simple = new Map();
  for (let i = 0; i < all.length; i++) for (let e = 0; e < 2; e++) {
    const E = geoms[i].ends[e], here = [];
    for (let j = 0; j < all.length; j++) for (let e2 = 0; e2 < 2; e2++) {
      const F = geoms[j].ends[e2];
      if (Math.abs(F.x - E.x) < EPS && Math.abs(F.y - E.y) < EPS) here.push([j, e2]);
    }
    if (here.length === 2) { const [[p, ep], [q, eq]] = here; simple.set(p * 4096 + q, [ep, eq]); simple.set(q * 4096 + p, [eq, ep]); }
  }
  const joinedNear = (a, b) => {
    const J = simple.get(a.piece * 4096 + b.piece);
    return !!J && a.from[J[0]] < JOINT_NEAR && b.from[J[1]] < JOINT_NEAR;
  };
  // pairs of segments close in space but far apart along the track
  const cell = GHOST_NEAR, grid = new Map(), key = (cx, cy) => cx * 100003 + cy;
  segs.forEach((q, n) => {
    const x0 = Math.floor((Math.min(q.ax, q.bx) - cell) / cell), x1 = Math.floor((Math.max(q.ax, q.bx) + cell) / cell);
    const y0 = Math.floor((Math.min(q.ay, q.by) - cell) / cell), y1 = Math.floor((Math.max(q.ay, q.by) + cell) / cell);
    q.cells = [x0, y0, x1, y1];
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) { const k = key(cx, cy); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); }
  });
  const tested = new Set();
  for (const [, list] of grid) {
    for (let u = 0; u < list.length; u++) for (let v = u + 1; v < list.length; v++) {
      const a = segs[list[u]], b = segs[list[v]];
      if (Math.abs(a.s - b.s) <= GHOST_APART) continue;
      const pk = list[u] < list[v] ? list[u] * 1e6 + list[v] : list[v] * 1e6 + list[u];
      if (tested.has(pk)) continue;
      tested.add(pk);
      if (joinedNear(a, b) || segDist(a.ax, a.ay, a.bx, a.by, b.ax, b.ay, b.bx, b.by) >= GHOST_NEAR) continue;
      const [first, later] = a.s < b.s ? [a, b] : [b, a], mid = (a.s + b.s) / 2;
      first.hi = Math.min(first.hi, mid); later.lo = Math.max(later.lo, mid);
      first.ghost = later.ghost = true;
    }
  }
  // lines for the terrain: runs of ordinary segments per piece, and each ghost segment on its own with its own group
  const lines = [], ghostSegs = [], bounds = new Set();
  let group = 1, run = null;
  const flush = () => { if (run) { lines.push(run); run = null; } };
  for (const q of segs) {
    if (q.ghost) {
      flush();
      const g = group++;
      lines.push({ pts: [q.ax, q.ay, q.bx, q.by], kinds: [q.kind], group: g, s: [q.s] });
      ghostSegs.push({ g, lo: q.lo, hi: q.hi });
      if (isFinite(q.lo)) bounds.add(q.lo);
      if (isFinite(q.hi)) bounds.add(q.hi);
      continue;
    }
    if (!run || run.piece !== q.piece || run.k + 1 !== q.k) { flush(); run = { pts: [q.ax, q.ay], kinds: [], s: [], piece: q.piece, k: q.k - 1 }; }
    run.pts.push(q.bx, q.by); run.kinds.push(q.kind); run.s.push(q.s); run.k = q.k;
  }
  flush();
  const terrain = new C.Terrain(lines);
  let minY = 0, maxY = 0, minX = 0, maxX = 0;
  for (const g of geoms) { minX = Math.min(minX, g.box[0]); minY = Math.min(minY, g.box[1]); maxX = Math.max(maxX, g.box[2]); maxY = Math.max(maxY, g.box[3]); }
  const fo = order.find(o => o.i === all.length - 1), fg = geoms[all.length - 1];
  const flagX = fg.pts[0] + (data.finish.d < 0 ? -PAD.finish.at : PAD.finish.at);
  return {
    custom: true, data,
    terrain, finishX: flagX, finishY: data.finish.y, finishDir: data.finish.d,
    finishS: fo ? fo.s0 + PAD.finish.at : 1,
    startX: 0, startY: 0, startTop: 0.5, checkpoints: [],
    ground: [], kinds: [], pits: [], loops: [], icy: [], marks: [],
    paths: geoms.map(g => g.pts), box: [minX, minY, maxX, maxY],
    ghosts: { segs: ghostSegs, bounds: [...bounds].sort((a, b) => a - b), startS: PAD.start.at },
    gravity: C.GRAVITY, killY: minY - 6, minY, maxY,
  };
}

// a short text that changes whenever the track does, so a best time can be thrown away when the track changes
function trackKey(data) {
  const d = sanitize(data);
  let h = 2166136261;
  const str = JSON.stringify([d.pieces, d.finish]);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

return {
  TYPES, TYPE, PAD, LOOP_R, MAX_PIECES, NAME_MAX, GRID, ROTATE_STEP, EPS, GHOST_NEAR, GHOST_APART,
  localPoints, geom, allPieces, newLevel, sanitize, cleanName, getPiece, finishIndex, isPiece, freeEnds, anchorOf, finishOn,
  append, rotate, flip, moveTo, commitMove, remove, buildCustomLevel, ridingOrder, trackKey,
};
});
