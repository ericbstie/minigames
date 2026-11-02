// Bike Race level editor: My levels (new, play, edit, rename, delete) and the build screen, where a track is put
// together from one row of ready-made pieces (bike-race-pieces.ts) on the game's canvas. Levels are saved in this
// browser and played as solo runs by bike-race.ts, which imports this module, hands it what it needs from the game
// (connect), shows its screens (onView) and lets it draw on the canvas while the editor is up (frame).
import * as A from './bike-race-art';
import type { BestResult, CustomRun, EditorApi } from './bike-race';
import * as C from './bike-race-core';
import type { Box } from './bike-race-core';
import * as P from './bike-race-pieces';
import type {
  Cursor,
  Geom,
  LevelData,
  Piece,
  PieceEnd,
  PieceTypeId,
  SavedLevel,
  SavedLevels,
} from './bike-race-pieces';

const $ = (id: string) => document.getElementById(id)!;
// the game, once it has connected
let game: EditorApi | null = null;
const api = (): EditorApi => {
  if (!game) throw new Error('The Bike Race editor was used before the game connected it');
  return game;
};
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const fmt = (t: number | null | undefined) => (t == null || !isFinite(t) ? '--' : t.toFixed(2));
const THEME = A.THEMES.clover;
const LOOK: A.Look = { bike: 'scout', paint: A.PAINTS[0] };

/** A point on screen or in the world */
interface Point {
  x: number;
  y: number;
}
/** The arrow where Build adds the next piece: on end e of piece i, or out in the open at x, y heading dx, dy */
type EdCursor = { i: number; e: number; x?: undefined } | (Cursor & { i?: undefined });
type EdMode = 'build' | 'edit' | 'delete';
/** A finger or mouse button down on the canvas: a tap so far, then a pan or (Edit) a drag of a piece */
interface Press {
  kind: 'press' | 'pan' | 'drag';
  id: number;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  piece: number; // the piece under it (Edit), or -1
  w: Point;
  base?: LevelData; // a drag: the level before it
  from?: Piece;
  snap?: string; // the undo snapshot from before it
}
/** Two fingers: pinch to zoom */
interface Pinch {
  kind: 'pinch';
  d0: number;
  ppm0: number;
  mid: Point;
}
/** A stored value nobody has checked yet */
type Unchecked = Record<string, unknown>;
const isObj = (v: unknown): v is Unchecked => !!v && typeof v === 'object';

// ------------------------------------------------------------------------------------------------
// Saved levels: localStorage 'bikerace.levels.v1' = { v: 1, levels: [{ id, data, best: { t, key } | null, updated }] }.
// `data` is a bike-race-pieces.ts level; best.key is the track's trackKey, so a best time is dropped once the track changes.
const STORE_KEY = 'bikerace.levels.v1',
  MAX_LEVELS = 100;
let store: SavedLevels = { v: 1, levels: [] };
function loadStore() {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  } catch {}
  const list: unknown[] = isObj(raw) && Array.isArray(raw.levels) ? raw.levels : [];
  const seen = new Set<string>();
  store = { v: 1, levels: [] };
  for (const L of list.slice(0, MAX_LEVELS)) {
    if (!isObj(L) || typeof L.id !== 'string' || !/^[a-z0-9]{1,24}$/.test(L.id) || seen.has(L.id)) continue;
    seen.add(L.id);
    const best =
      isObj(L.best) && Number(L.best.t) > 0 && typeof L.best.key === 'string'
        ? { t: Number(L.best.t), key: L.best.key.slice(0, 16) }
        : null;
    store.levels.push({ id: L.id, data: P.sanitize(L.data), best, updated: Number(L.updated) || 0 });
  }
}
let saveFailed = false;
function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    saveFailed = false;
  } catch {
    if (!saveFailed) api().toast("Couldn't save: this browser's storage is full", 2600, 'small');
    saveFailed = true;
  }
}
const byId = (id: string) => store.levels.find((L) => L.id === id) || null;
const newId = () => (Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)).slice(0, 24);
function bestOf(L: SavedLevel) {
  return L.best && L.best.key === P.trackKey(L.data) ? L.best.t : null;
}
// a finished run on level id; returns what the result sheet shows
function recordBest(id: string, t: number): BestResult {
  const L = byId(id);
  if (!L) return { best: t, newBest: true, prev: 0 };
  const prev = bestOf(L),
    newBest = !prev || t < prev - 1e-9;
  if (newBest) {
    L.best = { t, key: P.trackKey(L.data) };
    saveStore();
  }
  return { best: newBest ? t : prev!, newBest, prev: prev || 0 };
}
function nextName() {
  const names = new Set(store.levels.map((L) => L.data.name));
  for (let n = store.levels.length + 1; ; n++) if (!names.has('My level ' + n)) return 'My level ' + n;
}

// ------------------------------------------------------------------------------------------------
// My levels
function renderList() {
  loadStore();
  const list = $('br-ml-list');
  list.innerHTML = '';
  const levels = store.levels.slice().sort((a, b) => b.updated - a.updated);
  if (!levels.length) {
    list.innerHTML = '<p class="br-ml-empty">No levels yet. Tap <b>New level</b> to build one.</p>';
    return;
  }
  for (const L of levels) {
    const best = bestOf(L),
      n = L.data.pieces.length;
    const card = document.createElement('div');
    card.className = 'br-ml-card';
    card.dataset.id = L.id;
    card.innerHTML = `<canvas width="240" height="135" aria-hidden="true"></canvas>
      <div class="br-ml-info"><input class="br-ml-name" type="text" maxlength="${P.NAME_MAX}" value="${esc(L.data.name)}" aria-label="Level name" spellcheck="false" enterkeyhint="done">
      <span class="br-ml-meta">${n} piece${n === 1 ? '' : 's'}${best ? ' · Best ' + fmt(best) + 's' : ''}</span></div>
      <div class="br-ml-btns"><button class="b go outlined" type="button" data-act="play">Play</button><button class="b sky outlined" type="button" data-act="edit">Edit</button><button class="b plain outlined" type="button" data-act="del">Delete</button></div>`;
    const name = card.querySelector('input')!;
    name.onchange = () => {
      L.data.name = P.cleanName(name.value) || L.data.name;
      name.value = L.data.name;
      L.updated = Date.now();
      saveStore();
    };
    name.onkeydown = (e) => {
      if (e.key === 'Enter') name.blur();
    };
    card.querySelector<HTMLElement>('[data-act="play"]')!.onclick = () => play(L.id, 'list');
    card.querySelector<HTMLElement>('[data-act="edit"]')!.onclick = () => openEditor(L.id);
    const del = card.querySelector<HTMLElement>('[data-act="del"]')!;
    let armed = 0;
    del.onclick = () => {
      // a second tap within 3 s deletes it
      if (!armed) {
        del.textContent = 'Sure?';
        del.classList.add('warn');
        armed = window.setTimeout(() => {
          armed = 0;
          del.textContent = 'Delete';
          del.classList.remove('warn');
        }, 3000);
        return;
      }
      clearTimeout(armed);
      store.levels = store.levels.filter((x) => x.id !== L.id);
      saveStore();
      renderList();
    };
    list.appendChild(card);
    requestAnimationFrame(() => drawThumb(card.querySelector('canvas')!, L.data));
  }
}
function drawThumb(cv: HTMLCanvasElement, data: LevelData) {
  const g = cv.getContext('2d')!,
    geoms = P.allPieces(data).map(P.geom),
    cam = new A.Camera();
  cam.W = cv.width;
  cam.H = cv.height;
  frameBox(cam, boxOf(geoms), 0.1);
  A.drawSky(g, cam, THEME, 0);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(0, 0, cam.W, cam.H);
  A.drawTrackPaths(
    g,
    cam,
    geoms.map((m) => m.pts),
    THEME,
  );
  A.drawMarkers(g, cam, markerLevel(data), 0, false);
}
function newLevel() {
  loadStore();
  if (store.levels.length >= MAX_LEVELS) {
    api().toast(`That's ${MAX_LEVELS} levels: delete one to make room`, 2600, 'small');
    return;
  }
  const L: SavedLevel = { id: newId(), data: P.newLevel(nextName()), best: null, updated: Date.now() };
  store.levels.push(L);
  saveStore();
  openEditor(L.id);
}
function play(id: string, from: CustomRun['from']) {
  const L = byId(id);
  if (!L) return;
  api().startCustom({
    level: P.buildCustomLevel(L.data),
    name: L.data.name,
    from,
    best: bestOf(L),
    onFinish: (t) => recordBest(id, t),
    onExit: () => api().showView(from === 'editor' ? 'editor' : 'mylevels'),
  });
}

// ------------------------------------------------------------------------------------------------
// The build screen. Pieces are numbered as in P.allPieces: 0 the start pad, then the pieces, last the
// finish pad. The cursor (the arrow) is where Build adds the next piece: { i, e } on a piece's end, or
// { x, y, dx, dy } out in the open.
const ed = {
  id: null as string | null,
  data: null as LevelData | null,
  geoms: [] as Geom[],
  open: [] as PieceEnd[],
  mode: 'build' as EdMode,
  sel: -1,
  cur: null as EdCursor | null,
  cam: new A.Camera(),
  undo: [] as string[],
  redo: [] as string[],
  ptrs: new Map<number, Point>(),
  gesture: null as Press | Pinch | null,
  camTo: null as Point | null,
  snapAt: null as Point | null,
  flash: 0,
};
const HINTS: Record<EdMode, string> = {
  build: 'Tap a piece below to add it at the arrow. Tap an end to build from there.',
  edit: 'Tap a piece to pick it, then turn or flip it. Drag to move it: ends snap together.',
  delete: 'Tap a piece to remove it.',
};
let hintTimer = 0;
function hint(text: string, ms = 4000) {
  const el = $('br-ed-hint');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

const fi = () => P.finishIndex(ed.data!);
function refresh() {
  ed.geoms = P.allPieces(ed.data!).map(P.geom);
  ed.open = P.openEnds(ed.data!);
}
function snapshot() {
  return JSON.stringify({ data: ed.data, cur: ed.cur, sel: ed.sel });
}
function restore(s: string) {
  const o = JSON.parse(s) as { data: unknown; cur: EdCursor | null; sel: number };
  ed.data = P.sanitize(o.data);
  ed.cur = o.cur;
  ed.sel = o.sel;
  refresh();
  fixCursor();
}
function pushUndo(snap?: string) {
  ed.undo.push(snap || snapshot());
  if (ed.undo.length > 100) ed.undo.shift();
  ed.redo = [];
}
// after any change: save, redraw the buttons
function changed() {
  refresh();
  fixCursor();
  const L = byId(ed.id!);
  if (L) {
    L.data = ed.data!;
    L.updated = Date.now();
    saveStore();
  }
  syncButtons();
}
function syncButtons() {
  const data = ed.data!;
  ($('br-ed-undo') as HTMLButtonElement).disabled = !ed.undo.length;
  ($('br-ed-redo') as HTMLButtonElement).disabled = !ed.redo.length;
  const piece = P.isPiece(data, ed.sel),
    fin = ed.sel === fi();
  for (const id of ['br-ed-rotl', 'br-ed-rotr', 'br-ed-flipv']) ($(id) as HTMLButtonElement).disabled = !piece;
  ($('br-ed-fliph') as HTMLButtonElement).disabled = !piece && !fin;
  for (const b of document.querySelectorAll<HTMLElement>('.br-ed-modes button'))
    b.setAttribute('aria-pressed', String(b.dataset.mode === ed.mode));
  $('br-editor').dataset.mode = ed.mode;
  $('br-ed-name').textContent = data.name;
  const n = data.pieces.length;
  $('br-ed-count').textContent = `${n} piece${n === 1 ? '' : 's'}`;
}

// Ends a piece can be added to (P.openEnds): free ends, the end the finish stands on, and the end of
// a piece that closes a loop.
const cursorEnds = () => ed.open;
function cursorPos(): Cursor {
  const c = ed.cur;
  if (c && c.i != null && ed.geoms[c.i]) {
    const E = ed.geoms[c.i].ends[c.e];
    return { x: E.x, y: E.y, dx: E.ox, dy: E.oy };
  }
  if (c && c.x != null) return { x: c.x, y: c.y, dx: c.dx, dy: c.dy };
  return defaultCursor();
}
// where the finish stands, if that is on the end of a piece; else the end of the last piece; else the start pad
function defaultCursor(): Cursor & ({ i: number; e: number } | { i?: undefined; e?: undefined }) {
  const ends = cursorEnds(),
    F = ed.geoms[fi()].ends[0];
  const at =
    ends.find((E) => Math.abs(E.x - F.x) < P.EPS && Math.abs(E.y - F.y) < P.EPS) ||
    ends.find((E) => E.i === ed.data!.pieces.length && E.e === 1) ||
    ends.slice().sort((a, b) => b.i - a.i || b.e - a.e)[0];
  return at ? { x: at.x, y: at.y, dx: at.ox, dy: at.oy, i: at.i, e: at.e } : { x: 9, y: 0, dx: 1, dy: 0 };
}
// keep the cursor on an end that can still be built from
function fixCursor() {
  const c = ed.cur;
  if (c && c.i == null && c.x != null) return;
  const ends = cursorEnds();
  if (c && c.i != null) {
    if (ends.some((E) => E.i === c.i && E.e === c.e)) return;
    const other = ends.find((E) => E.i === c.i);
    if (other) {
      ed.cur = { i: other.i, e: other.e };
      return;
    }
  }
  const d = defaultCursor();
  ed.cur = d.i != null ? { i: d.i, e: d.e } : { x: d.x, y: d.y, dx: d.dx, dy: d.dy };
}

function openEditor(id: string) {
  loadStore();
  const L = byId(id);
  if (!L) return;
  if (ed.id !== id) {
    ed.id = id;
    ed.data = P.sanitize(L.data);
    ed.undo = [];
    ed.redo = [];
    ed.sel = -1;
    ed.cur = null;
    ed.mode = 'build';
    refresh();
    fixCursor();
    fitView();
  }
  api().showView('editor');
}
/** The game shows one of the editor's screens */
export function onView(v: 'mylevels' | 'editor'): void {
  if (v === 'mylevels') renderList();
  if (v === 'editor') {
    if (!ed.data) {
      api().showView('mylevels');
      return;
    }
    renderRow();
    syncButtons();
    hint(HINTS[ed.mode]);
  }
}
/** The game hands the editor what it uses from it, once, as it loads */
export function connect(gameApi: EditorApi): void {
  game = gameApi;
}

// ---------- camera ----------
// the part of the screen not under the top buttons and the bottom bar
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
function viewRect(): Rect {
  const W = ed.cam.W,
    H = ed.cam.H,
    bar = $('br-editor').querySelector('.br-ed-bar')!.getBoundingClientRect(),
    top = 62;
  return { x0: 0, y0: top, x1: W, y1: bar.height ? Math.max(top + 60, bar.top - 8) : H - 100 };
}
function boxOf(geoms: Geom[]): Box {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const m of geoms) {
    b[0] = Math.min(b[0], m.box[0]);
    b[1] = Math.min(b[1], m.box[1]);
    b[2] = Math.max(b[2], m.box[2]);
    b[3] = Math.max(b[3], m.box[3]);
  }
  return b;
}
function frameBox(cam: A.Camera, b: Box, margin: number, rect?: Rect) {
  const r = rect || { x0: 0, y0: 0, x1: cam.W, y1: cam.H },
    w = r.x1 - r.x0,
    h = r.y1 - r.y0;
  const bw = Math.max(8, b[2] - b[0] + 4),
    bh = Math.max(5, b[3] - b[1] + 4);
  cam.ppm = Math.max(MIN_PPM, Math.min(36, Math.min(w / bw, h / bh) * (1 - margin)));
  // centre of the box on the centre of the rect
  const cx = (b[0] + b[2]) / 2,
    cy = (b[1] + b[3]) / 2;
  cam.x = cx - ((r.x0 + r.x1) / 2 - cam.W / 2) / cam.ppm;
  cam.y = cy + ((r.y0 + r.y1) / 2 - cam.H / 2) / cam.ppm;
}
const MIN_PPM = 5,
  MAX_PPM = 80;
function sizeCam() {
  const cv = api().canvas,
    d = Math.min(2, window.devicePixelRatio || 1);
  ed.cam.W = cv.width / d || cv.clientWidth;
  ed.cam.H = cv.height / d || cv.clientHeight;
}
function fitView() {
  sizeCam();
  frameBox(ed.cam, boxOf(ed.geoms), 0.08, viewRect());
  ed.camTo = null;
}
// bring a point into view if it is off screen (after adding a piece)
function keepInView(x: number, y: number) {
  const r = viewRect(),
    cam = ed.cam,
    sx = cam.sx(x),
    sy = cam.sy(y),
    m = 50;
  let dx = 0,
    dy = 0;
  if (sx < r.x0 + m) dx = sx - (r.x0 + m);
  else if (sx > r.x1 - m) dx = sx - (r.x1 - m);
  if (sy < r.y0 + m) dy = sy - (r.y0 + m);
  else if (sy > r.y1 - m) dy = sy - (r.y1 - m);
  if (dx || dy) ed.camTo = { x: cam.x + dx / cam.ppm, y: cam.y - dy / cam.ppm };
}
function zoomAt(sx: number, sy: number, k: number) {
  const cam = ed.cam,
    wx = cam.wx(sx),
    wy = cam.y + (cam.H / 2 - sy) / cam.ppm;
  cam.ppm = Math.max(MIN_PPM, Math.min(MAX_PPM, cam.ppm * k));
  cam.x = wx - (sx - cam.W / 2) / cam.ppm;
  cam.y = wy - (cam.H / 2 - sy) / cam.ppm;
}
const toWorld = (sx: number, sy: number): Point => ({
  x: ed.cam.wx(sx),
  y: ed.cam.y + (ed.cam.H / 2 - sy) / ed.cam.ppm,
});

// ---------- hit testing ----------
function distToPath(P_: number[], x: number, y: number) {
  let best = Infinity;
  for (let k = 0; k + 3 < P_.length; k += 2) {
    const ax = P_[k],
      ay = P_[k + 1],
      ex = P_[k + 2] - ax,
      ey = P_[k + 3] - ay,
      l2 = ex * ex + ey * ey;
    let t = l2 ? ((x - ax) * ex + (y - ay) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t));
  }
  return best;
}
// the piece nearest to a world point, within r metres (pieces drawn on top, later ones, win ties)
function hitPiece(x: number, y: number, r: number) {
  let best = -1,
    bd = r;
  ed.geoms.forEach((m, i) => {
    if (x < m.box[0] - r || x > m.box[2] + r || y < m.box[1] - r || y > m.box[3] + r) return;
    const d = distToPath(m.pts, x, y);
    if (d <= bd + 1e-6) {
      bd = d;
      best = i;
    }
  });
  return best;
}
const tapRadius = () => Math.max(0.5, 22 / ed.cam.ppm);

// ---------- edits ----------
function setMode(m: EdMode) {
  if (ed.mode === m) {
    hint(HINTS[m]);
    return;
  }
  ed.mode = m;
  if (m === 'delete') ed.sel = -1;
  syncButtons();
  hint(HINTS[m]);
}
function addPiece(t: string) {
  if (ed.data!.pieces.length >= P.MAX_PIECES) {
    hint(`That's the most pieces a level can have (${P.MAX_PIECES}).`);
    return;
  }
  const c = cursorPos();
  pushUndo();
  const i = P.append(ed.data!, t, c);
  ed.sel = i;
  ed.cur = { i, e: 1 };
  ed.flash = 1;
  if (ed.mode !== 'build') ed.mode = 'build';
  changed();
  const E = ed.geoms[i].ends[1],
    B = ed.geoms[i].box;
  keepInView((B[0] + B[2]) / 2, (B[1] + B[3]) / 2);
  keepInView(E.x, E.y);
}
type Action = 'rotl' | 'rotr' | 'fliph' | 'flipv';
function act(kind: Action) {
  const i = ed.sel,
    data = ed.data!;
  if (!(P.isPiece(data, i) || (i === fi() && kind === 'fliph'))) return;
  const snap = snapshot();
  const ok =
    kind === 'rotl'
      ? P.rotate(data, i, P.ROTATE_STEP)
      : kind === 'rotr'
        ? P.rotate(data, i, -P.ROTATE_STEP)
        : P.flip(data, i, kind === 'fliph' ? 'h' : 'v');
  if (!ok) return;
  pushUndo(snap);
  ed.flash = 1;
  changed();
}
function removePiece(i: number) {
  if (!P.isPiece(ed.data!, i)) {
    hint(i === 0 ? 'The start stays where it is.' : "The finish can't be removed. Drag it in Edit mode.");
    return;
  }
  pushUndo();
  const c = ed.cur;
  P.remove(ed.data!, i);
  if (c && c.i != null) ed.cur = c.i === i ? null : c.i > i ? { i: c.i - 1, e: c.e } : c;
  ed.sel = -1;
  changed();
}
function undo() {
  if (!ed.undo.length) return;
  ed.redo.push(snapshot());
  restore(ed.undo.pop()!);
  changed();
}
function redo() {
  if (!ed.redo.length) return;
  ed.undo.push(snapshot());
  restore(ed.redo.pop()!);
  changed();
}

// a tap on the track
function tap(sx: number, sy: number) {
  const w = toWorld(sx, sy),
    r = tapRadius();
  if (ed.mode === 'delete') {
    const i = hitPiece(w.x, w.y, r);
    if (i >= 0) removePiece(i);
    return;
  }
  if (ed.mode === 'edit') {
    const i = hitPiece(w.x, w.y, r);
    if (i === 0) hint('The start stays where it is.');
    ed.sel = i > 0 ? i : -1;
    syncButtons();
    return;
  }
  // build: an end to build from, a piece to pick, or a spot out in the open to start from
  let best: PieceEnd | null = null,
    bd = r * 1.4;
  for (const E of cursorEnds()) {
    const d = Math.hypot(E.x - w.x, E.y - w.y);
    if (d < bd) {
      bd = d;
      best = E;
    }
  }
  if (best) {
    ed.cur = { i: best.i, e: best.e };
    ed.sel = best.i > 0 ? best.i : -1;
    syncButtons();
    return;
  }
  const i = hitPiece(w.x, w.y, r);
  if (i >= 0) {
    ed.sel = i > 0 ? i : -1;
    const ends = cursorEnds().filter((E) => E.i === i);
    if (ends.length) {
      const E = ends.find((x) => x.e === 1) || ends[0];
      ed.cur = { i, e: E.e };
    }
    syncButtons();
    return;
  }
  const g = P.GRID;
  ed.cur = { x: Math.round(w.x / g) * g, y: Math.round(w.y / g) * g, dx: 1, dy: 0 };
  ed.sel = -1;
  syncButtons();
}

// ---------- pointer input on the canvas: tap, drag a piece (Edit), pan, pinch ----------
function onDown(e: PointerEvent) {
  if (api().view !== 'editor') return;
  e.preventDefault();
  try {
    (e.target as Element).setPointerCapture(e.pointerId);
  } catch {}
  ed.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ed.ptrs.size === 1) {
    const w = toWorld(e.clientX, e.clientY);
    let piece = -1;
    if (ed.mode === 'edit') {
      const i = hitPiece(w.x, w.y, tapRadius());
      if (i > 0) piece = i;
    }
    ed.gesture = { kind: 'press', id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: ed.cam.x, cy: ed.cam.y, piece, w };
  } else if (ed.ptrs.size === 2) {
    // a second finger: pinch (put back a piece that was being dragged)
    if (ed.gesture && ed.gesture.kind === 'drag') {
      ed.data = ed.gesture.base!;
      changed();
      ed.snapAt = null;
    }
    const [a, b] = [...ed.ptrs.values()];
    ed.gesture = {
      kind: 'pinch',
      d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      ppm0: ed.cam.ppm,
      mid: toWorld((a.x + b.x) / 2, (a.y + b.y) / 2),
    };
  }
}
function onMove(e: PointerEvent) {
  if (!ed.ptrs.has(e.pointerId)) return;
  ed.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const G = ed.gesture;
  if (!G) return;
  if (G.kind === 'pinch') {
    if (ed.ptrs.size < 2) return;
    const [a, b] = [...ed.ptrs.values()],
      d = Math.hypot(a.x - b.x, a.y - b.y),
      cam = ed.cam;
    cam.ppm = Math.max(MIN_PPM, Math.min(MAX_PPM, (G.ppm0 * d) / G.d0));
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    cam.x = G.mid.x - (mx - cam.W / 2) / cam.ppm;
    cam.y = G.mid.y - (cam.H / 2 - my) / cam.ppm;
    ed.camTo = null;
    return;
  }
  if (e.pointerId !== G.id) return;
  const dx = e.clientX - G.sx,
    dy = e.clientY - G.sy;
  if (G.kind === 'press' && Math.hypot(dx, dy) > 8) {
    if (G.piece > 0) {
      G.kind = 'drag';
      G.base = JSON.parse(JSON.stringify(ed.data)) as LevelData;
      G.from = P.getPiece(ed.data!, G.piece);
      G.snap = snapshot();
      ed.sel = G.piece;
      syncButtons();
    } else G.kind = 'pan';
  }
  if (G.kind === 'pan') {
    ed.cam.x = G.cx - dx / ed.cam.ppm;
    ed.cam.y = G.cy + dy / ed.cam.ppm;
    ed.camTo = null;
  } else if (G.kind === 'drag') {
    const w = toWorld(e.clientX, e.clientY),
      snapR = Math.max(0.6, 26 / ed.cam.ppm);
    const res = P.moveTo(G.base!, G.piece, G.from!, w.x - G.w.x, w.y - G.w.y, snapR);
    if (!res) return;
    ed.data = JSON.parse(JSON.stringify(G.base)) as LevelData;
    P.commitMove(ed.data, G.piece, res.piece);
    refresh();
    ed.snapAt = res.snapped ? nearestEnd(G.piece) : null;
  }
}
// the end of piece i that sits on another piece's end (to ring it while dragging)
function nearestEnd(i: number): Point | null {
  for (const E of ed.geoms[i].ends)
    for (let j = 0; j < ed.geoms.length; j++) {
      if (j === i) continue;
      if (ed.geoms[j].ends.some((F) => Math.abs(F.x - E.x) < P.EPS && Math.abs(F.y - E.y) < P.EPS))
        return { x: E.x, y: E.y };
    }
  return null;
}
function onUp(e: PointerEvent) {
  if (!ed.ptrs.has(e.pointerId)) return;
  ed.ptrs.delete(e.pointerId);
  const G = ed.gesture;
  if (!G) return;
  if (G.kind === 'pinch') {
    if (ed.ptrs.size === 0) ed.gesture = null;
    return;
  }
  if (e.pointerId !== G.id) return;
  ed.gesture = null;
  if (e.type === 'pointercancel') {
    if (G.kind === 'drag') {
      ed.data = G.base!;
      changed();
    }
    ed.snapAt = null;
    return;
  }
  if (G.kind === 'press') tap(e.clientX, e.clientY);
  else if (G.kind === 'drag') {
    ed.snapAt = null;
    if (JSON.stringify(ed.data) !== JSON.stringify(G.base)) {
      pushUndo(G.snap);
      changed();
    } else refresh();
  }
}
function onWheel(e: WheelEvent) {
  if (api().view !== 'editor') return;
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
  ed.camTo = null;
}

// ---------- drawing ----------
/** Draws the build screen on the game's canvas, once a frame while the editor is up */
export function frame(g: CanvasRenderingContext2D, dpr: number, dt: number, t: number): void {
  if (!ed.data) return;
  sizeCam();
  const cam = ed.cam;
  if (ed.camTo) {
    const k = 1 - Math.exp(-dt * 8);
    cam.x += (ed.camTo.x - cam.x) * k;
    cam.y += (ed.camTo.y - cam.y) * k;
    if (Math.abs(ed.camTo.x - cam.x) < 0.01 && Math.abs(ed.camTo.y - cam.y) < 0.01) ed.camTo = null;
  }
  ed.flash = Math.max(0, ed.flash - dt * 2.5);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  A.drawSky(g, cam, THEME, t);
  A.drawLayers(g, cam, THEME, t);
  g.fillStyle = 'rgba(255, 255, 255, 0.28)';
  g.fillRect(0, 0, cam.W, cam.H);
  drawGrid(g, cam);
  const lw = A.lineWidth(cam);
  // the picked piece glows
  if (ed.sel >= 0 && ed.geoms[ed.sel]) {
    stroke(g, cam, ed.geoms[ed.sel].pts, `rgba(255, 212, 59, ${0.75 + 0.25 * ed.flash})`, lw * 3.4 + 6);
    if (ed.flash) stroke(g, cam, ed.geoms[ed.sel].pts, `rgba(255, 255, 255, ${ed.flash})`, lw * 2 + 4);
  }
  A.drawTrackPaths(
    g,
    cam,
    ed.geoms.map((m) => m.pts),
    THEME,
  );
  A.drawMarkers(g, cam, markerLevel(ed.data), t, false);
  // a bike on the start, for scale
  A.drawBike(g, cam, { x: 0, y: -C.BASE.anchors[0][1] + C.BASE.radius + 0.02, a: 0, lean: 0, phi: 0 }, LOOK, {
    alpha: 0.9,
  });
  // ends that can be built from
  const r = Math.max(3.5, Math.min(7, lw * 1.2));
  g.lineWidth = 2;
  g.strokeStyle = A.INK;
  g.fillStyle = '#ffffff';
  if (ed.mode !== 'delete')
    for (const E of cursorEnds()) {
      g.beginPath();
      g.arc(cam.sx(E.x), cam.sy(E.y), r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  if (ed.mode === 'build') drawCursor(g, cam, cursorPos(), t, r);
  if (ed.snapAt) {
    g.strokeStyle = '#3f9a44';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cam.sx(ed.snapAt.x), cam.sy(ed.snapAt.y), r + 7, 0, Math.PI * 2);
    g.stroke();
  }
}
function stroke(g: CanvasRenderingContext2D, cam: A.Camera, pts: number[], color: string, w: number) {
  g.beginPath();
  g.moveTo(cam.sx(pts[0]), cam.sy(pts[1]));
  for (let k = 2; k < pts.length; k += 2) g.lineTo(cam.sx(pts[k]), cam.sy(pts[k + 1]));
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
}
function markerLevel(data: LevelData): A.MarkerLevel {
  const d = data.finish.d < 0 ? -1 : 1;
  return { startY: 0, finishX: data.finish.x + d * P.PAD.finish.at, finishY: data.finish.y, checkpoints: [] };
}
function drawGrid(g: CanvasRenderingContext2D, cam: A.Camera) {
  const x0 = cam.wx(0),
    x1 = cam.wx(cam.W),
    y1 = cam.y + cam.H / 2 / cam.ppm,
    y0 = cam.y - cam.H / 2 / cam.ppm;
  const lines = (step: number, color: string, width: number) => {
    if (step * cam.ppm < 9) return;
    g.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const s = Math.round(cam.sx(x)) + 0.5;
      g.moveTo(s, 0);
      g.lineTo(s, cam.H);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const s = Math.round(cam.sy(y)) + 0.5;
      g.moveTo(0, s);
      g.lineTo(cam.W, s);
    }
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  };
  lines(1, 'rgba(255, 255, 255, 0.28)', 1);
  lines(5, 'rgba(255, 255, 255, 0.55)', 1.5);
  if (5 * cam.ppm < 9) lines(25, 'rgba(255, 255, 255, 0.55)', 1.5);
}
// the arrow: a pulsing ring where the next piece goes, pointing the way it will be laid
function drawCursor(g: CanvasRenderingContext2D, cam: A.Camera, c: Cursor, t: number, r: number) {
  const x = cam.sx(c.x),
    y = cam.sy(c.y),
    a = Math.atan2(-c.dy, c.dx),
    pulse = 1 + 0.18 * Math.sin(t * 6);
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(255, 212, 59, 0.35)';
  g.beginPath();
  g.arc(0, 0, (r + 9) * pulse, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = A.INK;
  g.lineWidth = 2.5;
  g.fillStyle = '#ffd43b';
  g.beginPath();
  g.arc(0, 0, r + 2, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.rotate(a);
  const L = r + 12 + 3 * Math.sin(t * 6);
  g.beginPath();
  g.moveTo(L + 15, 0);
  g.lineTo(L, -7);
  g.lineTo(L + 3, 0);
  g.lineTo(L, 7);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

// ---------- the row of pieces ----------
// Each piece drawn small; pieces of a kind share a scale so short, medium and long look it.
function renderRow() {
  const row = $('br-ed-row');
  if (!row.children.length) {
    for (const T of P.TYPES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'br-ed-tile';
      b.dataset.t = T.id;
      b.setAttribute('aria-label', 'Add ' + T.name.toLowerCase());
      b.title = T.name;
      b.innerHTML = '<canvas aria-hidden="true"></canvas>';
      b.onclick = () => addPiece(T.id);
      row.appendChild(b);
    }
  }
  requestAnimationFrame(() => {
    for (const b of row.children as HTMLCollectionOf<HTMLElement>)
      drawTile(b.querySelector('canvas')!, b.dataset.t as PieceTypeId);
  });
}
// each kind fits its biggest piece in the tile
const BIGGEST: Record<string, PieceTypeId> = { line: 'line3', ramp: 'ramp3', loop: 'loop3' };
function drawTile(cv: HTMLCanvasElement, t: PieceTypeId) {
  const w = cv.clientWidth,
    h = cv.clientHeight,
    d = Math.min(3, window.devicePixelRatio || 1);
  if (!w || !h) return;
  cv.width = Math.round(w * d);
  cv.height = Math.round(h * d);
  const g = cv.getContext('2d')!;
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  const kind = t.slice(0, -1),
    pad = 7;
  const big = BIGGEST[kind];
  const bb = P.geom({ t: big, x: 0, y: 0, a: 0, m: false }).box,
    s = Math.min((w - pad * 2) / (bb[2] - bb[0]), (h - pad * 2) / Math.max(1, bb[3] - bb[1]));
  const m = P.geom({ t, x: 0, y: 0, a: 0, m: false }),
    b = m.box;
  const ox = w / 2 - ((b[0] + b[2]) / 2) * s,
    oy = h / 2 + ((b[1] + b[3]) / 2) * s;
  const path = () => {
    g.beginPath();
    g.moveTo(ox + m.pts[0] * s, oy - m.pts[1] * s);
    for (let k = 2; k < m.pts.length; k += 2) g.lineTo(ox + m.pts[k] * s, oy - m.pts[k + 1] * s);
  };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  path();
  g.strokeStyle = THEME.lineEdge;
  g.lineWidth = 5;
  g.stroke();
  path();
  g.strokeStyle = THEME.line;
  g.lineWidth = 3;
  g.stroke();
}

// ------------------------------------------------------------------------------------------------
function setup() {
  loadStore();
  $('br-ml-back').onclick = () => api().showView('home');
  $('br-ml-new').onclick = () => newLevel();
  $('br-ed-back').onclick = () => api().showView('mylevels');
  $('br-ed-undo').onclick = () => undo();
  $('br-ed-redo').onclick = () => redo();
  $('br-ed-test').onclick = () => {
    if (ed.id) play(ed.id, 'editor');
  };
  for (const b of document.querySelectorAll<HTMLElement>('.br-ed-modes button'))
    b.onclick = () => setMode(b.dataset.mode as EdMode);
  for (const [id, k] of [
    ['br-ed-rotl', 'rotl'],
    ['br-ed-rotr', 'rotr'],
    ['br-ed-fliph', 'fliph'],
    ['br-ed-flipv', 'flipv'],
  ] as const)
    $(id).onclick = () => act(k);
  const cv = $('br-canvas');
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', () => {
    if (api().view === 'editor') requestAnimationFrame(() => renderRow());
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
else setup();

// for the browser tests (tests/browser/bike-race-editor.test.ts)
function debug() {
  return {
    ed,
    store,
    P,
    openEditor,
    addPiece,
    act,
    tap,
    undo,
    redo,
    setMode,
    removePiece,
    cursorPos,
    fitView,
    toWorld,
  };
}
export type EditorDebug = ReturnType<typeof debug>;
window.BikeRaceEditor = { onView, frame, _debug: debug };
