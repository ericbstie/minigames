(() => {
// Water Sort rules and solver. Shared by the level generator (Node) and the game (browser).
// A state is an array of tubes; a tube is an array of colour indices, bottom first.
const WS_CAP = 4;
const wsTop = (t) => t[t.length - 1];
function wsCanPour(s, a, b) {
  const A = s[a], B = s[b];
  if (a === b || !A.length || B.length >= WS_CAP) return false;
  return !B.length || wsTop(A) === wsTop(B);
}
// how many units of the top colour run move from a to b
function wsPourCount(s, a, b) {
  const A = s[a], c = wsTop(A);
  let n = 0;
  for (let i = A.length - 1; i >= 0 && A[i] === c; i--) n++;
  return Math.min(n, WS_CAP - s[b].length);
}
function wsApply(s, a, b) {
  const n = wsPourCount(s, a, b), c = wsTop(s[a]), out = s.map(t => t.slice());
  for (let i = 0; i < n; i++) { out[a].pop(); out[b].push(c); }
  return out;
}
const wsUniform = (t) => t.every(c => c === t[0]);
const wsDone = (t) => t.length === 0 || (t.length === WS_CAP && wsUniform(t));
const wsSolved = (s) => s.every(wsDone);
const wsKey = (s) => s.map(t => t.join(',')).sort().join('|');
// moves worth considering: never pour a finished tube, never pour a one-colour tube into an empty one
function wsMoves(s) {
  const out = [];
  for (let a = 0; a < s.length; a++) {
    const A = s[a];
    if (!A.length || wsDone(A)) continue;
    let emptyTried = false;
    for (let b = 0; b < s.length; b++) {
      if (!wsCanPour(s, a, b)) continue;
      const B = s[b];
      if (!B.length) { if (wsUniform(A) || emptyTried) continue; emptyTried = true; }
      const n = wsPourCount(s, a, b);
      let score = B.length ? 10 : 0;
      if (B.length + n === WS_CAP && wsUniform(B)) score += 20;
      if (n === A.length) score += 5;                 // empties the source
      if (n < runLength(A)) score -= 8;               // splits a run
      out.push([a, b, score]);
    }
  }
  out.sort((x, y) => y[2] - x[2]);
  return out;
}
function runLength(A) { const c = wsTop(A); let n = 0; for (let i = A.length - 1; i >= 0 && A[i] === c; i--) n++; return n; }
// depth-first search with a visited set; returns a list of [from, to] moves or null
function wsSolve(start, maxNodes = 400000) {
  const seen = new Set(), path = [];
  let nodes = 0;
  const dfs = (s) => {
    if (wsSolved(s)) return true;
    if (++nodes > maxNodes) return false;
    const k = wsKey(s);
    if (seen.has(k)) return false;
    seen.add(k);
    for (const [a, b] of wsMoves(s)) {
      path.push([a, b]);
      if (dfs(wsApply(s, a, b))) return true;
      path.pop();
      if (nodes > maxNodes) return false;
    }
    return false;
  };
  const ok = dfs(start);
  return ok ? path.slice() : null;
}
if (typeof module !== 'undefined') module.exports = { WS_CAP, wsCanPour, wsPourCount, wsApply, wsSolved, wsDone, wsKey, wsMoves, wsSolve, wsUniform };

// Water Sort: tap a tube, tap another, and the top colour pours across if it fits.
// Everything is laid out in the reference screenshot's pixels (640 wide) and scaled.
(() => {
const LEVELS = [{"colors":3,"tubes":[[2,1,1,0],[2,1,0,0],[2,1,2,0],[],[]]},{"colors":4,"tubes":[[3,1,2,3],[0,1,2,0],[1,0,3,1],[0,2,3,2],[],[]]},{"colors":4,"tubes":[[0,2,1,0],[3,1,1,2],[3,1,2,0],[0,2,3,3],[],[]]},{"colors":5,"tubes":[[3,4,0,2],[2,0,1,1],[3,4,4,0],[3,0,1,2],[1,4,3,2],[],[]]},{"colors":5,"tubes":[[0,1,0,3],[0,4,2,1],[0,1,4,3],[2,3,2,4],[3,1,4,2],[],[]]},{"colors":6,"tubes":[[4,4,1,1],[3,3,2,5],[5,2,0,2],[1,0,0,5],[5,4,0,3],[3,4,2,1],[],[]]},{"colors":6,"tubes":[[3,0,5,1],[3,4,1,2],[2,4,2,3],[4,5,1,2],[0,4,5,3],[1,0,5,0],[],[]]},{"colors":7,"tubes":[[5,6,3,1],[5,0,6,3],[4,5,1,0],[2,0,5,2],[6,6,2,4],[3,4,3,4],[1,0,2,1],[],[]]},{"colors":7,"tubes":[[3,3,2,6],[1,2,5,1],[5,3,4,6],[3,2,6,5],[2,0,4,0],[1,6,4,4],[1,0,0,5],[],[]]},{"colors":8,"tubes":[[6,1,4,0],[6,0,1,5],[4,7,5,7],[6,1,3,3],[5,1,7,7],[2,0,4,2],[5,2,3,4],[3,6,2,0],[],[]]},{"colors":8,"tubes":[[5,3,1,0],[6,3,0,4],[4,3,4,5],[2,5,2,1],[1,7,0,2],[7,6,0,4],[6,6,2,5],[3,7,7,1],[],[]]},{"colors":9,"tubes":[[3,6,1,0],[0,2,1,8],[1,5,4,2],[7,8,3,3],[0,4,7,7],[6,2,3,0],[5,7,2,1],[6,8,8,5],[6,5,4,4],[],[]]},{"colors":9,"tubes":[[7,3,0,3],[6,1,5,4],[4,8,5,7],[3,1,2,8],[0,2,7,5],[6,4,1,3],[7,8,0,4],[1,0,2,6],[6,2,8,5],[],[]]},{"colors":10,"tubes":[[2,3,1,2],[9,8,1,7],[2,9,3,5],[1,4,0,5],[0,4,7,3],[8,5,7,4],[6,6,0,2],[8,6,5,3],[1,8,4,7],[9,0,9,6],[],[]]},{"colors":10,"tubes":[[5,1,1,8],[5,7,2,9],[9,4,6,9],[7,1,9,1],[2,8,4,6],[8,5,3,0],[4,3,0,2],[7,0,5,6],[0,8,4,3],[6,3,7,2],[],[]]},{"colors":10,"tubes":[[4,8,0,3],[2,6,8,5],[9,1,1,4],[2,4,4,7],[1,0,5,6],[8,3,8,9],[0,7,6,2],[2,5,3,1],[7,5,0,7],[9,3,6,9],[],[]]},{"colors":11,"tubes":[[5,7,2,6],[0,3,2,6],[1,8,4,2],[10,3,1,4],[3,6,10,10],[7,3,9,8],[0,1,1,6],[2,0,7,10],[8,5,0,9],[4,7,5,8],[9,4,5,9],[],[]]},{"colors":11,"tubes":[[10,8,1,8],[1,3,9,2],[5,6,6,0],[5,0,4,2],[7,3,5,8],[9,4,2,10],[5,1,9,4],[6,4,9,0],[8,6,2,10],[3,7,7,1],[3,7,10,0],[],[]]},{"colors":11,"tubes":[[2,9,8,1],[4,0,8,1],[10,1,3,8],[0,9,10,9],[6,10,4,7],[0,0,6,7],[2,1,5,9],[4,3,7,4],[5,3,6,7],[2,6,2,5],[8,10,3,5],[],[]]},{"colors":11,"tubes":[[2,0,5,5],[6,1,4,3],[9,6,3,2],[8,8,9,0],[5,2,8,7],[3,1,6,7],[0,10,9,1],[4,10,2,4],[6,10,4,10],[9,0,3,1],[8,5,7,7],[],[]]}];
// the eleven colours from the reference, in the order levels start using them
const COLORS = ['#ea0031', '#007fc6', '#ffce00', '#08a801', '#f835e0', '#ff7800', '#2ce7d5', '#5d2a8a', '#98cd00', '#b54c2e', '#d4a17a'];
const BG = '#281f35', OUTLINE = '#dcd2e7';
const DIFF = (n) => n <= 5 ? 'Easy' : n <= 10 ? 'Medium' : n <= 15 ? 'Hard' : 'Extra hard';
const HINTS = 3, LIFT = 30, ROW = 295, TUBE_H = 270;

// ---- tube shape (reference pixels; origin at the top centre, y down) ----
const SW2 = 1.75, HW = 35.5 - SW2, LIP = 44.5 - SW2, TOP = SW2, BY = TUBE_H - SW2 - HW;
function tubePath(g) {
  g.beginPath();
  g.moveTo(-LIP + 6, TOP); g.lineTo(LIP - 6, TOP);
  g.quadraticCurveTo(LIP, TOP, LIP, TOP + 6);
  g.bezierCurveTo(LIP, TOP + 15, HW, TOP + 14, HW, TOP + 23);
  g.lineTo(HW, BY); g.arc(0, BY, HW, 0, Math.PI); g.lineTo(-HW, TOP + 23);
  g.bezierCurveTo(-HW, TOP + 14, -LIP, TOP + 15, -LIP, TOP + 6);
  g.quadraticCurveTo(-LIP, TOP, -LIP + 6, TOP);
  g.closePath();
}
// the inside, as a polygon, for working out where a tilted liquid's surface sits
const IN = HW - SW2, IN_BOTTOM = BY + IN, UNIT = 55.25;
const POLY = (() => { const p = [[-IN, 3], [IN, 3]]; for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI; p.push([Math.cos(a) * IN, BY + Math.sin(a) * IN]); } return p; })();
const levelY = (v) => IN_BOTTOM - UNIT * v;              // upright surface height for v units
function areaBelow(poly, L) {                          // area of the polygon with y >= L (canvas y down)
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ia = a[1] >= L, ib = b[1] >= L;
    if (ia) out.push(a);
    if (ia !== ib) { const t = (L - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, L]); }
  }
  let s = 0; for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
const volArea = (v) => areaBelow(POLY, levelY(v));
const rotPoly = (th) => { const c = Math.cos(th), s = Math.sin(th); return POLY.map(([x, y]) => [x * c - y * s, x * s + y * c]); };
function levelFor(poly, area) {                        // world surface height holding `area`
  let lo = -400, hi = 400;
  for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (areaBelow(poly, m) > area) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// how far the tube must tip (pouring to the right) before `v` units reach the lip
const SPILL = (() => {
  const t = [];
  for (let i = 0; i <= 200; i++) { const th = i / 200 * 2.0, p = rotPoly(th), c = Math.cos(th), s = Math.sin(th), ly = IN * s + 3 * c; t.push([th, areaBelow(p, ly)]); }
  return t;
})();
function spillAngle(v) {
  const a = volArea(v);
  for (let i = 1; i < SPILL.length; i++) if (SPILL[i][1] <= a) { const [t0, a0] = SPILL[i - 1], [t1, a1] = SPILL[i]; return t0 + (t1 - t0) * (a0 - a) / ((a0 - a1) || 1); }
  return 2.0;
}

// ---- state ----
let app, cv, g, ui = {}, started = false, running = false, raf = 0, last = 0;
let U = 1, SWd = 640, SHd = 1380, dpr = 1, SPEED = 1;  // css px per ref px, stage size in ref px
const S = { level: 0, tubes: [], start: [], undo: [], hints: HINTS, extra: false, sel: -1, lift: [], anims: [], parts: [], pos: [], spacing: 118, hint: null, won: false, shakes: [] };
let done = new Set();
try { done = new Set(JSON.parse(localStorage.getItem('watersort.done.v1') || '[]')); } catch (e) {}
const saveDone = () => { try { localStorage.setItem('watersort.done.v1', JSON.stringify([...done])); } catch (e) {} };

// ---- layout ----
function resize() {
  const r = app.getBoundingClientRect(), W = Math.max(1, r.width), H = Math.max(1, r.height);
  U = Math.min(W / 640, H / 1380); SWd = W / U; SHd = H / U;
  app.style.setProperty('--u', U + 'px');
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  layout();
}
function layout() {
  const n = S.tubes.length + (S.extra ? 0 : 1), rows = Math.ceil(n / 5), counts = [];
  for (let i = 0; i < rows; i++) counts.push(Math.floor(n / rows) + (i >= rows - n % rows && n % rows ? 1 : 0));
  // shorter rows first, like the reference (4, 5, 5)
  counts.sort((a, b) => a - b);
  const top0 = 257, avail = SHd - 230 - top0, content = rows * ROW - 24;
  const y0 = top0 + Math.max(0, (avail - content) / 2), x0 = (SWd - 640) / 2;
  S.pos = []; let i = 0;
  counts.forEach((k, r) => { const sp = Math.min(143, 592 / k); for (let j = 0; j < k; j++, i++) S.pos.push({ x: x0 + 320 + (j - (k - 1) / 2) * sp, y: y0 + r * ROW, sp }); });
  while (S.lift.length < S.tubes.length) S.lift.push(0);
}

// ---- level flow ----
function startLevel(i) {
  S.level = i; const L = LEVELS[i];
  S.start = L.tubes.map(t => t.map(c => c)); S.tubes = S.start.map(t => t.slice());
  S.undo = []; S.hints = HINTS; S.extra = false; S.sel = -1; S.lift = S.tubes.map(() => 0); S.anims = []; S.parts = []; S.hint = null; S.won = false; S.shakes = [];
  ui.diff.textContent = DIFF(i + 1); ui.level.textContent = `Level ${i + 1}`;
  ui.win.hidden = true; showPlay(true); layout(); syncButtons();
}
function restart() { const h = S.hints; startLevel(S.level); S.hints = h; syncButtons(); }
function syncButtons() {
  ui.undo.disabled = !S.undo.length;
  ui.hints.textContent = S.hints; ui.hint.disabled = S.hints <= 0;
}
function showPlay(on) { ui.play.hidden = !on; ui.picker.hidden = on; if (!on) buildGrid(); }
function buildGrid() {
  ui.grid.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ws-cell' + (done.has(i + 1) ? ' done' : '');
    b.setAttribute('aria-label', `Level ${i + 1}, ${DIFF(i + 1)}${done.has(i + 1) ? ', complete' : ''}`);
    b.innerHTML = `<span class="n">${i + 1}</span><span class="d">${DIFF(i + 1)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.6 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8Z"/></svg>`;
    b.onclick = () => startLevel(i);
    ui.grid.appendChild(b);
  });
}
let noteT = 0;
function note(msg) { ui.note.textContent = msg; ui.note.classList.add('show'); clearTimeout(noteT); noteT = setTimeout(() => ui.note.classList.remove('show'), 2200); }

// ---- moves ----
const busy = (i) => S.anims.some(a => a.src === i || a.dst === i);
function tap(i) {
  if (S.won) return;
  if (i === 'add') { if (!S.extra && !S.anims.length) { S.extra = true; S.tubes.push([]); S.start.push([]); S.undo.forEach(u => u.push([])); S.lift.push(0); layout(); burst(S.pos[S.tubes.length - 1].x, S.pos[S.tubes.length - 1].y + 140, '#ffbf2f', 18); } return; }
  if (busy(i)) return;
  S.hint = null;
  if (S.sel < 0) { if (S.tubes[i].length && !wsDone(S.tubes[i])) S.sel = i; else if (S.tubes[i].length) shake(i); return; }
  if (S.sel === i) { S.sel = -1; return; }
  if (wsCanPour(S.tubes, S.sel, i)) { pour(S.sel, i); S.sel = -1; return; }
  if (S.tubes[i].length && !wsDone(S.tubes[i])) S.sel = i; else { shake(i); S.sel = -1; }
}
function shake(i) { S.shakes = S.shakes.filter(s => s.i !== i); S.shakes.push({ i, t: 0 }); }
function pour(a, b) {
  const n = wsPourCount(S.tubes, a, b), c = S.tubes[a][S.tubes[a].length - 1];
  const srcBefore = S.tubes[a].slice(), dstBefore = S.tubes[b].slice();
  S.undo.push(S.tubes.map(t => t.slice()));
  S.tubes = wsApply(S.tubes, a, b);
  const sgn = S.pos[b].x >= S.pos[a].x ? 1 : -1;
  S.anims.push({ src: a, dst: b, c, n, srcBefore, dstBefore, sgn, t: 0, d1: 0.24, d2: 0.2 + 0.14 * n, d3: 0.24, liftFrom: S.lift[a] });
  syncButtons();
}
function undo() {
  if (!S.undo.length || S.won) return;
  S.anims = []; S.sel = -1; S.hint = null;
  S.tubes = S.undo.pop(); syncButtons();
}
function hint() {
  if (S.hints <= 0 || S.won) return;
  S.anims.length = 0;
  const sol = wsSolve(S.tubes, 80000);
  if (!sol || !sol.length) { note('No way forward from here. Try Undo.'); return; }
  S.hints--; syncButtons();
  const [a, b] = sol[0]; S.sel = a; S.hint = { a, b, t: 0 };
}

// ---- drawing ----
const runsOf = (t) => { const r = []; for (const c of t) { if (r.length && r[r.length - 1][0] === c) r[r.length - 1][1]++; else r.push([c, 1]); } return r; };
function shade(hex, k) {  // mix with white (k > 0) or black (k < 0)
  const n = parseInt(hex.slice(1), 16), r = n >> 16, gg = n >> 8 & 255, b = n & 255, t = k > 0 ? 255 : 0, a = Math.abs(k);
  return `rgb(${Math.round(r + (t - r) * a)},${Math.round(gg + (t - gg) * a)},${Math.round(b + (t - b) * a)})`;
}
// one tube at (x, y) = its top centre, tipped by th around that point
function drawTube(x, y, th, runs, opt = {}) {
  g.save(); g.translate(x, y);
  // drop shadow to the lower right
  g.save(); g.translate(9, 6); g.rotate(th); tubePath(g); g.fillStyle = 'rgba(0,0,0,0.19)'; g.fill(); g.restore();
  g.rotate(th);
  tubePath(g); g.fillStyle = BG; g.fill();
  const total = runs.reduce((s, r) => s + r[1], 0);
  if (total > 0.001) {
    g.save(); tubePath(g); g.clip();
    // surfaces between colours, in world height (they stay level when the tube tips)
    const poly = th ? rotPoly(th) : null, levels = [];
    let v = 0;
    for (const r of runs) { v += r[1]; levels.push(th ? levelFor(poly, volArea(v)) : levelY(v)); }
    const base = th ? 400 : IN_BOTTOM + 4;
    // fill bands in world orientation
    g.rotate(-th);
    let lower = base;
    runs.forEach((r, i) => { const up = levels[i]; g.fillStyle = COLORS[r[0]]; g.fillRect(-300, up - (i === runs.length - 1 ? 0 : 0.6), 600, lower - up + 0.6); lower = up; });
    // the glass: a light stripe down the left and a darker one on the right, only over the liquid
    g.beginPath(); g.rect(-300, levels[levels.length - 1], 600, 900); g.clip();
    g.rotate(th);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(-IN - 2, 0, 17, TUBE_H);
    g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(IN - 9, 0, 11, TUBE_H);
    g.restore();
  }
  // glass highlights at the top
  g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(-IN, 26, 15, BY - 26);
  g.fillStyle = '#94909a'; g.beginPath(); g.roundRect(-22, 7, 27, 8, 4); g.fill();
  g.fillStyle = '#a3a0aa'; g.beginPath(); g.arc(-31, 11, 4.6, 0, Math.PI * 2); g.fill();
  tubePath(g); g.lineWidth = 3.5; g.strokeStyle = opt.glow ? `rgba(255,214,90,${opt.glow})` : OUTLINE; g.stroke();
  if (opt.glow) { g.lineWidth = 3.5; g.globalAlpha = 1 - opt.glow; g.strokeStyle = OUTLINE; g.stroke(); g.globalAlpha = 1; }
  g.restore();
}
// the spare tube that the + button unlocks
function drawLocked(x, y) {
  g.save(); g.translate(x, y);
  tubePath(g); g.setLineDash([11, 10]); g.lineDashOffset = -4; g.lineWidth = 3.5; g.strokeStyle = '#4a4356'; g.stroke(); g.setLineDash([]);
  g.beginPath(); g.moveTo(-HW, 205); g.lineTo(HW, 205); g.lineTo(HW, BY); g.arc(0, BY, HW, 0, Math.PI); g.closePath();
  g.fillStyle = '#261f32'; g.fill(); g.lineWidth = 3.5; g.strokeStyle = '#cdc4d9'; g.stroke();
  g.fillStyle = '#9b98a1'; g.beginPath(); g.roundRect(-13, 230, 26, 21, 4); g.fill();
  g.strokeStyle = '#9b98a1'; g.lineWidth = 4.2; g.beginPath(); g.arc(0, 230, 8, Math.PI, 0); g.stroke();
  g.fillStyle = '#261f32'; g.beginPath(); g.arc(0, 239, 3, 0, Math.PI * 2); g.fill(); g.fillRect(-1.6, 239, 3.2, 7);
  // the + button below it
  const by = TUBE_H + 33;
  g.fillStyle = '#e3ab2a'; g.beginPath(); g.arc(0, by + 3, 33, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffbf2f'; g.beginPath(); g.arc(0, by, 33, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = 6; g.beginPath(); g.moveTo(-23, by); g.lineTo(-7, by); g.moveTo(-15, by - 8); g.lineTo(-15, by + 8); g.stroke();
  g.save(); g.translate(9, by - 2);
  g.beginPath(); g.moveTo(-6, -17); g.lineTo(-6, 9); g.arc(0, 9, 6, Math.PI, 0, true); g.lineTo(6, -17); g.fillStyle = '#ff9a1a'; g.save(); g.clip(); g.fillRect(-8, 4, 16, 14); g.restore();
  g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke(); g.beginPath(); g.moveTo(-8.5, -17); g.lineTo(8.5, -17); g.stroke();
  g.restore();
  g.fillStyle = '#30b743'; g.beginPath(); g.arc(21, by + 21, 12.5, 0, Math.PI * 2); g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke();
  g.lineWidth = 3.6; g.beginPath(); g.moveTo(15, by + 21); g.lineTo(27, by + 21); g.moveTo(21, by + 15); g.lineTo(21, by + 27); g.stroke();
  g.restore();
}
const ease = (k) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
function render(dt) {
  g.setTransform(dpr * U, 0, 0, dpr * U, 0, 0);
  g.fillStyle = BG; g.fillRect(0, 0, SWd, SHd);
  // lift for the selected tube
  S.tubes.forEach((_, i) => { const want = i === S.sel ? 1 : 0; S.lift[i] += (want - S.lift[i]) * Math.min(1, dt * 16); });
  const animOf = new Map(); for (const a of S.anims) { animOf.set(a.src, a); animOf.set(a.dst, a); }
  const shakeX = (i) => { const s = S.shakes.find(q => q.i === i); return s ? Math.sin(s.t * 40) * 7 * (1 - s.t / 0.35) : 0; };
  // still tubes and pour targets first
  S.tubes.forEach((t, i) => {
    const p = S.pos[i]; if (!p) return;
    const a = animOf.get(i);
    if (a && a.src === i) return;
    let runs = runsOf(t);
    if (a && a.dst === i) { runs = runsOf(a.dstBefore); const k = a.p || 0; if (k > 0) { if (runs.length && runs[runs.length - 1][0] === a.c) runs[runs.length - 1][1] += a.n * k; else runs.push([a.c, a.n * k]); } }
    const glow = S.hint && S.hint.b === i ? 0.55 + 0.45 * Math.sin(S.hint.t * 7) : 0;
    drawTube(p.x + shakeX(i), p.y - LIFT * S.lift[i], 0, runs, { glow });
  });
  if (!S.extra && S.pos[S.tubes.length]) drawLocked(S.pos[S.tubes.length].x, S.pos[S.tubes.length].y);
  // pouring tubes on top, each with its stream
  for (const a of S.anims) {
    const sp = S.pos[a.src], dp = S.pos[a.dst];
    const runs = runsOf(a.srcBefore), k = a.p || 0;
    runs[runs.length - 1][1] -= a.n * k; if (runs[runs.length - 1][1] <= 1e-4) runs.pop();
    const vol = runs.reduce((s, r) => s + r[1], 0);
    // the lip comes to rest just above the target's mouth
    const target = { x: dp.x - a.sgn * 4, y: dp.y - 34 };
    const lip = [a.sgn * (LIP - 1), 3];
    let th, ox, oy;
    const thPour = a.sgn * Math.min(1.95, spillAngle(vol) + 0.02);
    const placeAt = (ang) => { const c = Math.cos(ang), s = Math.sin(ang); return [target.x - (lip[0] * c - lip[1] * s), target.y - (lip[0] * s + lip[1] * c)]; };
    const rest = [sp.x, sp.y - LIFT * a.liftFrom];
    if (a.phase === 0) { const e = ease(a.t / a.d1), th0 = a.sgn * Math.min(1.95, spillAngle(vol) + 0.02); th = th0 * e; const [px, py] = placeAt(th0); ox = rest[0] + (px - rest[0]) * e; oy = rest[1] + (py - rest[1]) * e - Math.sin(e * Math.PI) * 40; }
    else if (a.phase === 1) { th = thPour; [ox, oy] = placeAt(th); }
    else { const e = ease(a.t / a.d3), [px, py] = placeAt(a.thEnd); th = a.thEnd * (1 - e); ox = px + (sp.x - px) * e; oy = py + (sp.y - py) * e - Math.sin(e * Math.PI) * 30; }
    if (a.phase !== 2) a.thEnd = th;
    // stream from the lip down into the target
    if (a.phase === 1) {
      const dRuns = runsOf(a.dstBefore), dv = dRuns.reduce((s, r) => s + r[1], 0) + a.n * k, surf = dp.y + levelY(dv);
      const grow = Math.min(1, a.t / 0.06), fall = a.t > a.d2 - 0.06 ? (a.t - (a.d2 - 0.06)) / 0.06 : 0;
      const y0 = target.y + 2 + (surf - target.y) * fall, y1 = target.y + (surf - target.y) * grow;
      g.fillStyle = COLORS[a.c]; g.fillRect(target.x - 4.5, y0, 9, Math.max(0, y1 - y0));
    }
    drawTube(ox, oy, th, runs);
  }
  // confetti
  for (const q of S.parts) { g.save(); g.translate(q.x, q.y); g.rotate(q.r); g.globalAlpha = Math.max(0, 1 - q.t / q.life); g.fillStyle = q.c; g.fillRect(-q.w / 2, -q.h / 2, q.w, q.h); g.restore(); }
  g.globalAlpha = 1;
}
function burst(x, y, c, n, spread = 1) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6 * spread, v = 380 + Math.random() * 420;
    S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, t: 0, life: 1 + Math.random() * 0.6, w: 9 + Math.random() * 7, h: 5 + Math.random() * 5, c: Array.isArray(c) ? c[i % c.length] : c });
  }
}
function update(dt) {
  for (let i = S.anims.length - 1; i >= 0; i--) {
    const a = S.anims[i]; a.phase = a.phase || 0; a.t += dt;
    if (a.phase === 0 && a.t >= a.d1) { a.phase = 1; a.t -= a.d1; }
    if (a.phase === 1) { a.p = Math.min(1, a.t / a.d2); if (a.t >= a.d2) { a.phase = 2; a.t -= a.d2; a.p = 1; landed(a); } }
    if (a.phase === 2 && a.t >= a.d3) { S.anims.splice(i, 1); S.lift[a.src] = 0; checkWin(); }
  }
  for (const s of S.shakes) s.t += dt;
  S.shakes = S.shakes.filter(s => s.t < 0.35);
  if (S.hint) S.hint.t += dt;
  for (const q of S.parts) { q.t += dt; q.vy += 1300 * dt; q.vx *= 1 - 1.2 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.r += q.vr * dt; }
  S.parts = S.parts.filter(q => q.t < q.life);
}
// a tube that has just been filled with one colour throws a little confetti
function landed(a) {
  const t = S.tubes[a.dst];
  if (t.length === WS_CAP && t.every(c => c === t[0])) { const p = S.pos[a.dst]; burst(p.x, p.y + 10, [COLORS[t[0]], '#ffffff', shade(COLORS[t[0]], 0.4)], 26, 0.8); }
}
function checkWin() {
  if (S.won || S.anims.length || !wsSolved(S.tubes)) return;
  S.won = true; done.add(S.level + 1); saveDone();
  const cols = COLORS.slice(0, LEVELS[S.level].colors);
  for (let k = 0; k < 4; k++) burst(SWd / 2 + (k - 1.5) * 150, SHd * 0.55, cols, 30, 1.4);
  setTimeout(() => {
    if (!S.won) return;
    ui.winPill.textContent = `Level ${S.level + 1}`; ui.next.hidden = S.level >= LEVELS.length - 1;
    ui.win.hidden = false;
  }, 700);
}
// taps: the tube under the finger, or the + button
function hit(ev) {
  const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) / U, y = (ev.clientY - r.top) / U;
  if (!S.extra) { const p = S.pos[S.tubes.length]; if (p && Math.hypot(x - p.x, y - (p.y + TUBE_H + 33)) < 40) return 'add'; }
  for (let i = 0; i < S.tubes.length; i++) { const p = S.pos[i]; if (Math.abs(x - p.x) < p.sp / 2 && y > p.y - 50 && y < p.y + TUBE_H + 20) return i; }
  return null;
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000 || 0)); last = Math.max(last, now);
  if (ui.play.hidden) return;
  update(dt * SPEED); render(dt * SPEED);
}
function setup() {
  app = document.getElementById('ws-app'); cv = document.getElementById('ws-canvas'); g = cv.getContext('2d');
  const $ = (id) => document.getElementById(id);
  ui = { picker: $('ws-picker'), play: $('ws-play'), grid: $('ws-grid'), diff: $('ws-diff'), level: $('ws-level'), undo: $('ws-undo'), hint: $('ws-hint'), hints: $('ws-hints'),
    win: $('ws-win'), winPill: $('ws-win-pill'), next: $('ws-next'), note: $('ws-note') };
  cv.addEventListener('pointerdown', (e) => { const i = hit(e); if (i !== null) tap(i); else if (S.sel >= 0 && !S.anims.some(a => a.src === S.sel)) S.sel = -1; });
  $('ws-back').onclick = () => { S.anims = []; showPlay(false); };
  $('ws-pick-back').onclick = () => { if (window.GameHub) window.GameHub.menu(); };
  $('ws-restart').onclick = () => restart();
  ui.undo.onclick = () => undo();
  ui.hint.onclick = () => hint();
  ui.next.onclick = () => startLevel(Math.min(LEVELS.length - 1, S.level + 1));
  $('ws-levels').onclick = () => { ui.win.hidden = true; showPlay(false); };
  window.addEventListener('resize', () => { if (running) resize(); });
  started = true;
}
function show() {
  if (!started) setup();
  resize();
  if (!S.tubes.length) showPlay(false);
  if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
}
function hide() { running = false; cancelAnimationFrame(raf); }
window.WaterSort = { show, hide };

})();

})();
