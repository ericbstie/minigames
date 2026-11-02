// Water Sort: tap a tube, tap another, and the top colour pours across if it fits.
// Everything is laid out in the reference screenshot's pixels (640 wide) and scaled.
//
// The hub opens the game (`game`, at the bottom) in a scope while its screen is shown: the listeners, the frame loop
// and the timers for the note and the win sheet are set up in it and stop when the player leaves. The level being
// played stays as it was, for when they come back, and is saved after every move, so that it is there after a reload
// too. The rules, layout and drawing are plain functions.
import { Effect, FiberHandle, FiberSet, Predicate, Schema } from 'effect';
import { type Game, GameHub } from './hub';
import { animate, forget, listen, load, run, save } from './page';
import { keepOnly } from './schemas';
import {
  LEVELS,
  type State,
  type Tube,
  WS_CAP,
  wsApply,
  wsCanPour,
  wsDone,
  wsFits,
  wsPourCount,
  wsSolve,
  wsSolved,
} from './water-sort-logic';

// the eleven colours from the reference, in the order levels start using them
const COLORS = [
  '#ea0031',
  '#007fc6',
  '#ffce00',
  '#08a801',
  '#f835e0',
  '#ff7800',
  '#2ce7d5',
  '#5d2a8a',
  '#98cd00',
  '#b54c2e',
  '#d4a17a',
];
const BG = '#281f35',
  OUTLINE = '#dcd2e7';
const DIFF = (n: number) => (n <= 5 ? 'Easy' : n <= 10 ? 'Medium' : n <= 15 ? 'Hard' : 'Extra hard');
const HINTS = 3,
  LIFT = 30,
  ROW = 295,
  TUBE_H = 270;

// ---- tube shape (reference pixels; origin at the top centre, y down) ----
const SW2 = 1.75,
  HW = 35.5 - SW2,
  LIP = 44.5 - SW2,
  TOP = SW2,
  BY = TUBE_H - SW2 - HW;
function tubePath(g: CanvasRenderingContext2D) {
  g.beginPath();
  g.moveTo(-LIP + 6, TOP);
  g.lineTo(LIP - 6, TOP);
  g.quadraticCurveTo(LIP, TOP, LIP, TOP + 6);
  g.bezierCurveTo(LIP, TOP + 15, HW, TOP + 14, HW, TOP + 23);
  g.lineTo(HW, BY);
  g.arc(0, BY, HW, 0, Math.PI);
  g.lineTo(-HW, TOP + 23);
  g.bezierCurveTo(-HW, TOP + 14, -LIP, TOP + 15, -LIP, TOP + 6);
  g.quadraticCurveTo(-LIP, TOP, -LIP + 6, TOP);
  g.closePath();
}
// the inside, as a polygon, for working out where a tilted liquid's surface sits
type Pt = [x: number, y: number];
const IN = HW - SW2,
  IN_BOTTOM = BY + IN,
  UNIT = 55.25;
const POLY = ((): Pt[] => {
  const p: Pt[] = [
    [-IN, 3],
    [IN, 3],
  ];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI;
    p.push([Math.cos(a) * IN, BY + Math.sin(a) * IN]);
  }
  return p;
})();
const levelY = (v: number) => IN_BOTTOM - UNIT * v; // upright surface height for v units
function areaBelow(poly: Pt[], L: number) {
  // area of the polygon with y >= L (canvas y down)
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      ia = a[1] >= L,
      ib = b[1] >= L;
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (L - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, L]);
    }
  }
  let s = 0;
  for (let i = 0; i < out.length; i++) {
    const a = out[i],
      b = out[(i + 1) % out.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}
const volArea = (v: number) => areaBelow(POLY, levelY(v));
const rotPoly = (th: number) => {
  const c = Math.cos(th),
    s = Math.sin(th);
  return POLY.map(([x, y]): Pt => [x * c - y * s, x * s + y * c]);
};
function levelFor(poly: Pt[], area: number) {
  // world surface height holding `area`
  let lo = -400,
    hi = 400;
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    if (areaBelow(poly, m) > area) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
// how far the tube must tip (pouring to the right) before `v` units reach the lip
const SPILL = (() => {
  const t: [th: number, area: number][] = [];
  for (let i = 0; i <= 200; i++) {
    const th = (i / 200) * 2.0,
      p = rotPoly(th),
      c = Math.cos(th),
      s = Math.sin(th),
      ly = IN * s + 3 * c;
    t.push([th, areaBelow(p, ly)]);
  }
  return t;
})();
function spillAngle(v: number) {
  const a = volArea(v);
  for (let i = 1; i < SPILL.length; i++)
    if (SPILL[i][1] <= a) {
      const [t0, a0] = SPILL[i - 1],
        [t1, a1] = SPILL[i];
      return t0 + ((t1 - t0) * (a0 - a)) / (a0 - a1 || 1);
    }
  return 2.0;
}

// ---- state ----
// a run of one colour in a tube: [colour, units] (units can be fractional mid-pour)
type Run = [c: number, v: number];
interface Anim {
  src: number;
  dst: number;
  c: number;
  n: number;
  srcBefore: Tube;
  dstBefore: Tube;
  sgn: number;
  t: number;
  d1: number;
  d2: number;
  d3: number;
  liftFrom: number;
  phase: number;
  p: number;
  thEnd: number; // the pour's stage (0 tip, 1 pour, 2 return), how much has poured, the last tilt
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  t: number;
  life: number;
  w: number;
  h: number;
  c: string;
}
interface GameState {
  level: number;
  tubes: State;
  start: State;
  undo: State[];
  hints: number;
  extra: boolean;
  sel: number;
  lift: number[];
  anims: Anim[];
  parts: Particle[];
  pos: { x: number; y: number; sp: number }[];
  spacing: number;
  hint: { a: number; b: number; t: number } | null;
  won: boolean;
  shakes: { i: number; t: number }[];
}
interface UI {
  picker: HTMLElement;
  play: HTMLElement;
  grid: HTMLElement;
  diff: HTMLElement;
  level: HTMLElement;
  undo: HTMLButtonElement;
  hint: HTMLButtonElement;
  hints: HTMLElement;
  win: HTMLElement;
  winPill: HTMLElement;
  next: HTMLElement;
  note: HTMLElement;
  back: HTMLElement; // from a level to the picker
  pickBack: HTMLElement; // from the picker to the main menu
  restart: HTMLElement;
  levels: HTMLElement; // the win sheet's way to the picker
}
let app!: HTMLElement,
  cv!: HTMLCanvasElement,
  g!: CanvasRenderingContext2D,
  ui!: UI,
  started = false;
let U = 1,
  SWd = 640,
  SHd = 1380,
  dpr = 1,
  SPEED = 1; // css px per ref px, stage size in ref px
const S: GameState = {
  level: 0,
  tubes: [],
  start: [],
  undo: [],
  hints: HINTS,
  extra: false,
  sel: -1,
  lift: [],
  anims: [],
  parts: [],
  pos: [],
  spacing: 118,
  hint: null,
  won: false,
  shakes: [],
};
// The levels finished, numbered from 1, saved as a JSON array. Only a number can match a level, so anything else in
// there is dropped on the way in, and the rest kept.
const DONE_KEY = 'watersort.done.v1';
const Done = keepOnly(Schema.Number, Predicate.isNumber);
const done = new Set<number>();
const saveDone = () => run(save(DONE_KEY, Done, [...done]));
// The level being played, saved after every change so that a reload, or a tab closed and opened again, comes back to
// it: the level (numbered from 1), the tubes, the positions Undo goes back to, the hints left and whether the spare
// tube is out. It goes when the level is won or the player goes back to the picker. Only a position the level can
// be in fits (its tubes, its colours, not solved yet); anything else is no level in progress, and the picker shows.
const PLAY_KEY = 'watersort.play.v1';
const Tubes = Schema.mutable(Schema.Array(Schema.mutable(Schema.Array(Schema.Int))));
const Play = Schema.Struct({
  level: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: LEVELS.length })),
  tubes: Tubes,
  undo: Schema.mutable(Schema.Array(Tubes)),
  hints: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: HINTS })),
  extra: Schema.Boolean,
}).check(
  Schema.makeFilter((p) => {
    const L = LEVELS[p.level - 1];
    return wsFits(L, p.tubes, p.extra) && !wsSolved(p.tubes) && p.undo.every((u) => wsFits(L, u, p.extra));
  }),
);
type Play = typeof Play.Type;
const savePlay = () =>
  run(save(PLAY_KEY, Play, { level: S.level + 1, tubes: S.tubes, undo: S.undo, hints: S.hints, extra: S.extra }));
const forgetPlay = () => run(forget(PLAY_KEY));
// Starts a timer from plain code (a frame) while the game is open. The hub's scope for the visit holds it, so it stops
// when the player leaves; open sets this up, and after the game closes it starts nothing.
let later: (timer: Effect.Effect<void>) => unknown = () => {};

// ---- layout ----
function resize() {
  const r = app.getBoundingClientRect(),
    W = Math.max(1, r.width),
    H = Math.max(1, r.height);
  U = Math.min(W / 640, H / 1380);
  SWd = W / U;
  SHd = H / U;
  app.style.setProperty('--u', U + 'px');
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  layout();
}
function layout() {
  const n = S.tubes.length + (S.extra ? 0 : 1),
    rows = Math.ceil(n / 5),
    counts: number[] = [];
  for (let i = 0; i < rows; i++) counts.push(Math.floor(n / rows) + (i >= rows - (n % rows) && n % rows ? 1 : 0));
  // shorter rows first, like the reference (4, 5, 5)
  counts.sort((a, b) => a - b);
  const top0 = 257,
    avail = SHd - 230 - top0,
    content = rows * ROW - 24;
  const y0 = top0 + Math.max(0, (avail - content) / 2),
    x0 = (SWd - 640) / 2;
  S.pos = [];
  let i = 0;
  counts.forEach((k, r) => {
    const sp = Math.min(143, 592 / k);
    for (let j = 0; j < k; j++, i++) S.pos.push({ x: x0 + 320 + (j - (k - 1) / 2) * sp, y: y0 + r * ROW, sp });
  });
  while (S.lift.length < S.tubes.length) S.lift.push(0);
}

// ---- level flow ----
// Starts level i from the beginning, or carries on with it from where a saved game left it
function startLevel(i: number, from?: Play) {
  S.level = i;
  const L = LEVELS[i];
  S.extra = from ? from.extra : false;
  S.start = L.tubes.map((t) => t.map((c) => c));
  if (S.extra) S.start.push([]);
  S.tubes = (from ? from.tubes : S.start).map((t) => t.slice());
  S.undo = from ? from.undo.map((s) => s.map((t) => t.slice())) : [];
  S.hints = from ? from.hints : HINTS;
  S.sel = -1;
  S.lift = S.tubes.map(() => 0);
  S.anims = [];
  S.parts = [];
  S.hint = null;
  S.won = false;
  S.shakes = [];
  ui.diff.textContent = DIFF(i + 1);
  ui.level.textContent = `Level ${i + 1}`;
  ui.win.hidden = true;
  showPlay(true);
  layout();
  syncButtons();
  if (!from) savePlay();
}
function restart() {
  const h = S.hints;
  startLevel(S.level);
  S.hints = h;
  syncButtons();
  savePlay();
}
function syncButtons() {
  ui.undo.disabled = !S.undo.length;
  ui.hints.textContent = String(S.hints);
  ui.hint.disabled = S.hints <= 0;
}
function showPlay(on: boolean) {
  ui.play.hidden = !on;
  ui.picker.hidden = on;
  if (!on) buildGrid();
}
function buildGrid() {
  ui.grid.innerHTML = '';
  LEVELS.forEach((_L, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ws-cell' + (done.has(i + 1) ? ' done' : '');
    b.setAttribute('aria-label', `Level ${i + 1}, ${DIFF(i + 1)}${done.has(i + 1) ? ', complete' : ''}`);
    b.innerHTML = `<span class="n">${i + 1}</span><span class="d">${DIFF(i + 1)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.6 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8Z"/></svg>`;
    // a click on a cell starts its level (one listener on the grid, see open, as the cells are made anew here)
    ui.grid.appendChild(b);
  });
}
// The level of the cell a click on the grid landed in, or -1
function cellAt(target: EventTarget | null): number {
  const cell = target instanceof Element ? target.closest('.ws-cell') : null;
  return cell ? [...ui.grid.children].indexOf(cell) : -1;
}
// A note under the board for a couple of seconds; a new note takes over the timer of the one before
const note = (timer: FiberHandle.FiberHandle, msg: string) =>
  Effect.suspend(() => {
    ui.note.textContent = msg;
    ui.note.classList.add('show');
    return FiberHandle.run(
      timer,
      Effect.sleep(2200).pipe(Effect.andThen(Effect.sync(() => ui.note.classList.remove('show')))),
    );
  }).pipe(Effect.asVoid);

// ---- moves ----
const busy = (i: number) => S.anims.some((a) => a.src === i || a.dst === i);
function tap(i: number | 'add') {
  if (S.won) return;
  if (i === 'add') {
    if (!S.extra && !S.anims.length) {
      S.extra = true;
      S.tubes.push([]);
      S.start.push([]);
      S.undo.forEach((u) => u.push([]));
      S.lift.push(0);
      layout();
      savePlay();
      burst(S.pos[S.tubes.length - 1].x, S.pos[S.tubes.length - 1].y + 140, '#ffbf2f', 18);
    }
    return;
  }
  if (busy(i)) return;
  S.hint = null;
  if (S.sel < 0) {
    if (S.tubes[i].length && !wsDone(S.tubes[i])) S.sel = i;
    else if (S.tubes[i].length) shake(i);
    return;
  }
  if (S.sel === i) {
    S.sel = -1;
    return;
  }
  if (wsCanPour(S.tubes, S.sel, i)) {
    pour(S.sel, i);
    S.sel = -1;
    return;
  }
  if (S.tubes[i].length && !wsDone(S.tubes[i])) S.sel = i;
  else {
    shake(i);
    S.sel = -1;
  }
}
function shake(i: number) {
  S.shakes = S.shakes.filter((s) => s.i !== i);
  S.shakes.push({ i, t: 0 });
}
function pour(a: number, b: number) {
  const n = wsPourCount(S.tubes, a, b),
    c = S.tubes[a][S.tubes[a].length - 1];
  const srcBefore = S.tubes[a].slice(),
    dstBefore = S.tubes[b].slice();
  S.undo.push(S.tubes.map((t) => t.slice()));
  S.tubes = wsApply(S.tubes, a, b);
  const sgn = S.pos[b].x >= S.pos[a].x ? 1 : -1;
  S.anims.push({
    src: a,
    dst: b,
    c,
    n,
    srcBefore,
    dstBefore,
    sgn,
    t: 0,
    d1: 0.24,
    d2: 0.2 + 0.14 * n,
    d3: 0.24,
    liftFrom: S.lift[a],
    phase: 0,
    p: 0,
    thEnd: 0,
  });
  syncButtons();
  savePlay();
}
function undo() {
  if (!S.undo.length || S.won) return;
  S.anims = [];
  S.sel = -1;
  S.hint = null;
  S.tubes = S.undo.pop()!;
  syncButtons();
  savePlay();
}
// Picks up the tube of the solver's next move and points at where it goes. Answers true when there is no way
// forward, for the caller to say so.
function hint(): boolean {
  if (S.hints <= 0 || S.won) return false;
  S.anims.length = 0;
  const sol = wsSolve(S.tubes, 80000);
  if (!sol || !sol.length) return true;
  S.hints--;
  syncButtons();
  savePlay();
  const [a, b] = sol[0];
  S.sel = a;
  S.hint = { a, b, t: 0 };
  return false;
}

// ---- drawing ----
const runsOf = (t: Tube) => {
  const r: Run[] = [];
  for (const c of t) {
    if (r.length && r[r.length - 1][0] === c) r[r.length - 1][1]++;
    else r.push([c, 1]);
  }
  return r;
};
function shade(hex: string, k: number) {
  // mix with white (k > 0) or black (k < 0)
  const n = parseInt(hex.slice(1), 16),
    r = n >> 16,
    gg = (n >> 8) & 255,
    b = n & 255,
    t = k > 0 ? 255 : 0,
    a = Math.abs(k);
  return `rgb(${Math.round(r + (t - r) * a)},${Math.round(gg + (t - gg) * a)},${Math.round(b + (t - b) * a)})`;
}
// one tube at (x, y) = its top centre, tipped by th around that point
function drawTube(x: number, y: number, th: number, runs: Run[], opt: { glow?: number } = {}) {
  g.save();
  g.translate(x, y);
  // drop shadow to the lower right
  g.save();
  g.translate(9, 6);
  g.rotate(th);
  tubePath(g);
  g.fillStyle = 'rgba(0,0,0,0.19)';
  g.fill();
  g.restore();
  g.rotate(th);
  tubePath(g);
  g.fillStyle = BG;
  g.fill();
  const total = runs.reduce((s, r) => s + r[1], 0);
  if (total > 0.001) {
    g.save();
    tubePath(g);
    g.clip();
    // surfaces between colours, in world height (they stay level when the tube tips)
    const poly = th ? rotPoly(th) : null,
      levels: number[] = [];
    let v = 0;
    for (const r of runs) {
      v += r[1];
      levels.push(poly ? levelFor(poly, volArea(v)) : levelY(v));
    }
    const base = th ? 400 : IN_BOTTOM + 4;
    // fill bands in world orientation
    g.rotate(-th);
    let lower = base;
    runs.forEach((r, i) => {
      const up = levels[i];
      g.fillStyle = COLORS[r[0]];
      g.fillRect(-300, up - (i === runs.length - 1 ? 0 : 0.6), 600, lower - up + 0.6);
      lower = up;
    });
    // the glass: a light stripe down the left and a darker one on the right, only over the liquid
    g.beginPath();
    g.rect(-300, levels[levels.length - 1], 600, 900);
    g.clip();
    g.rotate(th);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(-IN - 2, 0, 17, TUBE_H);
    g.fillStyle = 'rgba(0,0,0,0.05)';
    g.fillRect(IN - 9, 0, 11, TUBE_H);
    g.restore();
  }
  // glass highlights at the top
  g.fillStyle = 'rgba(255,255,255,0.025)';
  g.fillRect(-IN, 26, 15, BY - 26);
  g.fillStyle = '#94909a';
  g.beginPath();
  g.roundRect(-22, 7, 27, 8, 4);
  g.fill();
  g.fillStyle = '#a3a0aa';
  g.beginPath();
  g.arc(-31, 11, 4.6, 0, Math.PI * 2);
  g.fill();
  tubePath(g);
  g.lineWidth = 3.5;
  g.strokeStyle = opt.glow ? `rgba(255,214,90,${opt.glow})` : OUTLINE;
  g.stroke();
  if (opt.glow) {
    g.lineWidth = 3.5;
    g.globalAlpha = 1 - opt.glow;
    g.strokeStyle = OUTLINE;
    g.stroke();
    g.globalAlpha = 1;
  }
  g.restore();
}
// the spare tube that the + button unlocks
function drawLocked(x: number, y: number) {
  g.save();
  g.translate(x, y);
  tubePath(g);
  g.setLineDash([11, 10]);
  g.lineDashOffset = -4;
  g.lineWidth = 3.5;
  g.strokeStyle = '#4a4356';
  g.stroke();
  g.setLineDash([]);
  g.beginPath();
  g.moveTo(-HW, 205);
  g.lineTo(HW, 205);
  g.lineTo(HW, BY);
  g.arc(0, BY, HW, 0, Math.PI);
  g.closePath();
  g.fillStyle = '#261f32';
  g.fill();
  g.lineWidth = 3.5;
  g.strokeStyle = '#cdc4d9';
  g.stroke();
  g.fillStyle = '#9b98a1';
  g.beginPath();
  g.roundRect(-13, 230, 26, 21, 4);
  g.fill();
  g.strokeStyle = '#9b98a1';
  g.lineWidth = 4.2;
  g.beginPath();
  g.arc(0, 230, 8, Math.PI, 0);
  g.stroke();
  g.fillStyle = '#261f32';
  g.beginPath();
  g.arc(0, 239, 3, 0, Math.PI * 2);
  g.fill();
  g.fillRect(-1.6, 239, 3.2, 7);
  // the + button below it
  const by = TUBE_H + 33;
  g.fillStyle = '#e3ab2a';
  g.beginPath();
  g.arc(0, by + 3, 33, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffbf2f';
  g.beginPath();
  g.arc(0, by, 33, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(-23, by);
  g.lineTo(-7, by);
  g.moveTo(-15, by - 8);
  g.lineTo(-15, by + 8);
  g.stroke();
  g.save();
  g.translate(9, by - 2);
  g.beginPath();
  g.moveTo(-6, -17);
  g.lineTo(-6, 9);
  g.arc(0, 9, 6, Math.PI, 0, true);
  g.lineTo(6, -17);
  g.fillStyle = '#ff9a1a';
  g.save();
  g.clip();
  g.fillRect(-8, 4, 16, 14);
  g.restore();
  g.lineWidth = 3;
  g.strokeStyle = '#fff';
  g.stroke();
  g.beginPath();
  g.moveTo(-8.5, -17);
  g.lineTo(8.5, -17);
  g.stroke();
  g.restore();
  g.fillStyle = '#30b743';
  g.beginPath();
  g.arc(21, by + 21, 12.5, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = '#fff';
  g.stroke();
  g.lineWidth = 3.6;
  g.beginPath();
  g.moveTo(15, by + 21);
  g.lineTo(27, by + 21);
  g.moveTo(21, by + 15);
  g.lineTo(21, by + 27);
  g.stroke();
  g.restore();
}
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
function render(dt: number) {
  g.setTransform(dpr * U, 0, 0, dpr * U, 0, 0);
  g.fillStyle = BG;
  g.fillRect(0, 0, SWd, SHd);
  // lift for the selected tube
  S.tubes.forEach((_, i) => {
    const want = i === S.sel ? 1 : 0;
    S.lift[i] += (want - S.lift[i]) * Math.min(1, dt * 16);
  });
  const animOf = new Map<number, Anim>();
  for (const a of S.anims) {
    animOf.set(a.src, a);
    animOf.set(a.dst, a);
  }
  const shakeX = (i: number) => {
    const s = S.shakes.find((q) => q.i === i);
    return s ? Math.sin(s.t * 40) * 7 * (1 - s.t / 0.35) : 0;
  };
  // still tubes and pour targets first
  S.tubes.forEach((t, i) => {
    const p = S.pos[i];
    if (!p) return;
    const a = animOf.get(i);
    if (a && a.src === i) return;
    let runs = runsOf(t);
    if (a && a.dst === i) {
      runs = runsOf(a.dstBefore);
      const k = a.p || 0;
      if (k > 0) {
        if (runs.length && runs[runs.length - 1][0] === a.c) runs[runs.length - 1][1] += a.n * k;
        else runs.push([a.c, a.n * k]);
      }
    }
    const glow = S.hint && S.hint.b === i ? 0.55 + 0.45 * Math.sin(S.hint.t * 7) : 0;
    drawTube(p.x + shakeX(i), p.y - LIFT * S.lift[i], 0, runs, { glow });
  });
  if (!S.extra && S.pos[S.tubes.length]) drawLocked(S.pos[S.tubes.length].x, S.pos[S.tubes.length].y);
  // pouring tubes on top, each with its stream
  for (const a of S.anims) {
    const sp = S.pos[a.src],
      dp = S.pos[a.dst];
    const runs = runsOf(a.srcBefore),
      k = a.p || 0;
    runs[runs.length - 1][1] -= a.n * k;
    if (runs[runs.length - 1][1] <= 1e-4) runs.pop();
    const vol = runs.reduce((s, r) => s + r[1], 0);
    // the lip comes to rest just above the target's mouth
    const target = { x: dp.x - a.sgn * 4, y: dp.y - 34 };
    const lip = [a.sgn * (LIP - 1), 3];
    let th: number, ox: number, oy: number;
    const thPour = a.sgn * Math.min(1.95, spillAngle(vol) + 0.02);
    const placeAt = (ang: number): Pt => {
      const c = Math.cos(ang),
        s = Math.sin(ang);
      return [target.x - (lip[0] * c - lip[1] * s), target.y - (lip[0] * s + lip[1] * c)];
    };
    const rest = [sp.x, sp.y - LIFT * a.liftFrom];
    if (a.phase === 0) {
      const e = ease(a.t / a.d1),
        th0 = a.sgn * Math.min(1.95, spillAngle(vol) + 0.02);
      th = th0 * e;
      const [px, py] = placeAt(th0);
      ox = rest[0] + (px - rest[0]) * e;
      oy = rest[1] + (py - rest[1]) * e - Math.sin(e * Math.PI) * 40;
    } else if (a.phase === 1) {
      th = thPour;
      [ox, oy] = placeAt(th);
    } else {
      const e = ease(a.t / a.d3),
        [px, py] = placeAt(a.thEnd);
      th = a.thEnd * (1 - e);
      ox = px + (sp.x - px) * e;
      oy = py + (sp.y - py) * e - Math.sin(e * Math.PI) * 30;
    }
    if (a.phase !== 2) a.thEnd = th;
    // stream from the lip down into the target
    if (a.phase === 1) {
      const dRuns = runsOf(a.dstBefore),
        dv = dRuns.reduce((s, r) => s + r[1], 0) + a.n * k,
        surf = dp.y + levelY(dv);
      const grow = Math.min(1, a.t / 0.06),
        fall = a.t > a.d2 - 0.06 ? (a.t - (a.d2 - 0.06)) / 0.06 : 0;
      const y0 = target.y + 2 + (surf - target.y) * fall,
        y1 = target.y + (surf - target.y) * grow;
      g.fillStyle = COLORS[a.c];
      g.fillRect(target.x - 4.5, y0, 9, Math.max(0, y1 - y0));
    }
    drawTube(ox, oy, th, runs);
  }
  // confetti
  for (const q of S.parts) {
    g.save();
    g.translate(q.x, q.y);
    g.rotate(q.r);
    g.globalAlpha = Math.max(0, 1 - q.t / q.life);
    g.fillStyle = q.c;
    g.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
    g.restore();
  }
  g.globalAlpha = 1;
}
function burst(x: number, y: number, c: string | string[], n: number, spread = 1) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6 * spread,
      v = 380 + Math.random() * 420;
    S.parts.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      r: Math.random() * 6,
      vr: (Math.random() - 0.5) * 14,
      t: 0,
      life: 1 + Math.random() * 0.6,
      w: 9 + Math.random() * 7,
      h: 5 + Math.random() * 5,
      c: Array.isArray(c) ? c[i % c.length] : c,
    });
  }
}
function update(dt: number) {
  for (let i = S.anims.length - 1; i >= 0; i--) {
    const a = S.anims[i];
    a.t += dt;
    if (a.phase === 0 && a.t >= a.d1) {
      a.phase = 1;
      a.t -= a.d1;
    }
    if (a.phase === 1) {
      a.p = Math.min(1, a.t / a.d2);
      if (a.t >= a.d2) {
        a.phase = 2;
        a.t -= a.d2;
        a.p = 1;
        landed(a);
      }
    }
    if (a.phase === 2 && a.t >= a.d3) {
      S.anims.splice(i, 1);
      S.lift[a.src] = 0;
      checkWin();
    }
  }
  for (const s of S.shakes) s.t += dt;
  S.shakes = S.shakes.filter((s) => s.t < 0.35);
  if (S.hint) S.hint.t += dt;
  for (const q of S.parts) {
    q.t += dt;
    q.vy += 1300 * dt;
    q.vx *= 1 - 1.2 * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.r += q.vr * dt;
  }
  S.parts = S.parts.filter((q) => q.t < q.life);
}
// a tube that has just been filled with one colour throws a little confetti
function landed(a: Anim) {
  const t = S.tubes[a.dst];
  if (t.length === WS_CAP && t.every((c) => c === t[0])) {
    const p = S.pos[a.dst];
    burst(p.x, p.y + 10, [COLORS[t[0]], '#ffffff', shade(COLORS[t[0]], 0.4)], 26, 0.8);
  }
}
function checkWin() {
  if (S.won || S.anims.length || !wsSolved(S.tubes)) return;
  S.won = true;
  done.add(S.level + 1);
  saveDone();
  forgetPlay();
  const cols = COLORS.slice(0, LEVELS[S.level].colors);
  for (let k = 0; k < 4; k++) burst(SWd / 2 + (k - 1.5) * 150, SHd * 0.55, cols, 30, 1.4);
  // the win sheet once the confetti has had a moment; at once if the player leaves first, so it is up when they
  // come back
  later(Effect.sleep(700).pipe(Effect.ensuring(Effect.sync(showWin))));
}
function showWin() {
  if (!S.won) return;
  ui.winPill.textContent = `Level ${S.level + 1}`;
  ui.next.hidden = S.level >= LEVELS.length - 1;
  ui.win.hidden = false;
}
// taps: the tube under the finger, or the + button
function hit(ev: PointerEvent): number | 'add' | null {
  const r = cv.getBoundingClientRect(),
    x = (ev.clientX - r.left) / U,
    y = (ev.clientY - r.top) / U;
  if (!S.extra) {
    const p = S.pos[S.tubes.length];
    if (p && Math.hypot(x - p.x, y - (p.y + TUBE_H + 33)) < 40) return 'add';
  }
  for (let i = 0; i < S.tubes.length; i++) {
    const p = S.pos[i];
    if (Math.abs(x - p.x) < p.sp / 2 && y > p.y - 50 && y < p.y + TUBE_H + 20) return i;
  }
  return null;
}

// a frame of the level being played (the picker needs none)
function frame(dt: number) {
  if (ui.play.hidden) return;
  update(dt * SPEED);
  render(dt * SPEED);
}
// the page's elements, found the first time the game opens
function setup() {
  app = document.getElementById('ws-app')!;
  cv = document.getElementById('ws-canvas') as HTMLCanvasElement;
  g = cv.getContext('2d')!;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  ui = {
    picker: $('ws-picker'),
    play: $('ws-play'),
    grid: $('ws-grid'),
    diff: $('ws-diff'),
    level: $('ws-level'),
    undo: $('ws-undo'),
    hint: $('ws-hint'),
    hints: $('ws-hints'),
    win: $('ws-win'),
    winPill: $('ws-win-pill'),
    next: $('ws-next'),
    note: $('ws-note'),
    back: $('ws-back'),
    pickBack: $('ws-pick-back'),
    restart: $('ws-restart'),
    levels: $('ws-levels'),
  };
  started = true;
}

/** Water Sort for the hub: the picker, or the level left unfinished last time */
export const game: Game = {
  open: Effect.gen(function* () {
    if (!started) setup();
    // levels finished before (in another tab, say); levels only ever get finished, so they join what is here
    for (const n of yield* load(DONE_KEY, Done, () => [])) done.add(n);
    resize();
    // the first time the game opens on this page: the level left unfinished last time, or else the picker
    if (!S.tubes.length) {
      const saved = yield* load<Play | null>(PLAY_KEY, Play, () => null);
      if (saved) startLevel(saved.level - 1, saved);
      else showPlay(false);
    }

    // the note's timer (a note cut short by leaving goes with it), and the timers plain code starts (the win sheet)
    const noteTimer = yield* FiberHandle.make();
    yield* Effect.addFinalizer(() => Effect.sync(() => ui.note.classList.remove('show')));
    later = yield* FiberSet.makeRuntime();

    yield* listen(window, 'resize', resize);
    yield* listen(cv, 'pointerdown', (e) => {
      const i = hit(e);
      if (i !== null) tap(i);
      else if (S.sel >= 0 && !S.anims.some((a) => a.src === S.sel)) S.sel = -1;
    });
    yield* listen(ui.grid, 'click', (e) => {
      const i = cellAt(e.target);
      if (i >= 0) startLevel(i);
    });
    yield* listen(ui.back, 'click', () => {
      S.anims = [];
      showPlay(false);
      forgetPlay();
    });
    yield* listen(ui.pickBack, 'click', () => GameHub.menu());
    yield* listen(ui.restart, 'click', restart);
    yield* listen(ui.undo, 'click', undo);
    yield* listen(ui.hint, 'click', () =>
      hint() ? note(noteTimer, 'No way forward from here. Try Undo.') : Effect.void,
    );
    yield* listen(ui.next, 'click', () => startLevel(Math.min(LEVELS.length - 1, S.level + 1)));
    yield* listen(ui.levels, 'click', () => {
      ui.win.hidden = true;
      showPlay(false);
    });
    yield* animate(frame);
  }),
  // on the menu's card: the levels finished, and the level left unfinished
  progress: Effect.gen(function* () {
    const saved = new Set([...done, ...(yield* load(DONE_KEY, Done, () => []))]),
      n = LEVELS.filter((_L, i) => saved.has(i + 1)).length,
      playing = yield* load<Play | null>(PLAY_KEY, Play, () => null);
    return [
      ...(n ? [`${n} of ${LEVELS.length} stars`] : []),
      ...(playing ? [`Level ${playing.level} in progress`] : []),
    ];
  }),
};

// What the browser tests read
window.WaterSort = {
  _debug() {
    const r = started ? cv.getBoundingClientRect() : new DOMRect(),
      add = S.extra ? null : S.pos[S.tubes.length];
    return {
      level: S.level,
      tubes: S.tubes.map((t) => t.slice()),
      sel: S.sel,
      busy: S.anims.length > 0,
      won: S.won,
      hints: S.hints,
      tubesAt: S.tubes.map((_, i) => ({ x: r.left + S.pos[i].x * U, y: r.top + (S.pos[i].y + TUBE_H / 2) * U })),
      addAt: add ? { x: r.left + add.x * U, y: r.top + (add.y + TUBE_H + 33) * U } : null,
    };
  },
};
