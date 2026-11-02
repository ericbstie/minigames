// Bike Race core: terrain, worlds and levels, bikes, the physics step and the computer rider.
// No DOM access here, so Bun can load this file to check that every level can be finished
// (see tools/check-bike-levels.ts). The browser gets it as window.BikeRaceCore (bike-race-globals.ts).

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const wrapAngle = (a: number) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const GRAVITY = 13; // m/s², a little stronger than Earth so jumps feel snappy
export const STEP = 1 / 120; // fixed simulation step
export const SUBSTEPS = 5; // collision substeps per step
const EMPTY: readonly number[] = [];

// ---------------------------------------------------------------------------------------------
// Types

/** What a stretch of track is: lethal pit and lava floors, slippery ice, loops (a little extra grip) */
export type SurfaceKind = 'ground' | 'ice' | 'pit' | 'lava' | 'loop';
/** The floor of a gap */
export type PitKind = 'pit' | 'lava';
/** How a bike crashed: its head or body hit the track, it fell below the level, or it touched a pit or lava floor */
export type CrashKind = 'head' | 'fall' | PitKind;
/** x, y, radius: a hit circle in the bike's frame */
export type Circle = [x: number, y: number, r: number];
/** x0, y0, x1, y1 */
export type Box = [x0: number, y0: number, x1: number, y1: number];
/** 1 to the right, -1 to the left */
export type Dir = 1 | -1;

/** A polyline of track for Terrain, in metres, y up */
export interface TerrainLine {
  pts: number[]; // x, y pairs
  kinds?: SurfaceKind[]; // per segment, else kind
  kind?: SurfaceKind;
  group?: number; // 0 (or none) always collides; other groups are switched on and off per bike
  s?: number[]; // each segment's distance along the track (editor levels)
}

/** The highest upward-facing track at an x (Terrain.surface) */
export interface Surface {
  y: number;
  seg: number;
  kind: SurfaceKind;
  angle: number;
}

/** A gap's lethal floor, for drawing */
export interface Pit {
  x0: number;
  x1: number;
  y: number; // the floor
  top: number; // the higher of the two edges
  kind: PitKind;
}

/** A full loop: its middle and radius, and the terrain groups of its two halves */
export interface Loop {
  cx: number;
  cy: number;
  r: number;
  gA: number;
  gB: number;
}

/** A stretch of ice */
export interface IcyStretch {
  x0: number;
  x1: number;
}

/** Where each piece of a built-in level starts: x, and the piece as text ("kicker 8 1.6") */
export type Mark = [x: number, piece: string];

/**
 * Stretches of an editor level's track that take turns being solid where it crosses itself (see Bike.updateGhosts):
 * terrain group g is solid while the bike is between lo and hi along the track.
 */
export interface Ghosts {
  segs: { g: number; lo: number; hi: number }[];
  bounds: number[]; // every lo and hi, sorted
  startS: number; // how far along the track the bike starts
}

/** A level ready to ride: from buildLevel, or from the editor (BikeRacePieces.buildCustomLevel) */
export interface Level {
  terrain: Terrain;
  finishX: number;
  startX: number;
  checkpoints: number[]; // x of each respawn point (multiplayer)
  ground: number[]; // the main line's x, y pairs (empty for editor levels)
  kinds: SurfaceKind[]; // the main line's segment kinds
  pits: Pit[];
  loops: Loop[];
  icy: IcyStretch[];
  marks: Mark[];
  gravity: number;
  killY: number; // below this a bike has fallen out of the level
  minY: number;
  maxY: number;
  // Levels from the editor also have these (see bike-race-pieces.ts):
  custom?: boolean;
  startY?: number; // the height of the start
  startTop?: number; // look for the start's ground below this height (track may pass above the start)
  finishY?: number; // the height of the finish flag: the bike has to cross the line near it
  finishDir?: Dir; // which way the finish line is crossed
  finishS?: number; // how far along the track the finish is
  paths?: number[][]; // one polyline (x, y pairs) per piece, for drawing
  box?: Box;
  ghosts?: Ghosts;
}

/** A track piece of a built-in level: a Builder method and its arguments */
export type TrackPiece = { [K in PieceName]: [K, ...Parameters<Builder[K]>] }[PieceName];
type PieceName =
  'flat' | 'slope' | 'rise' | 'hill' | 'bumps' | 'kicker' | 'gap' | 'step' | 'table' | 'ice' | 'loop' | 'ledge';

export type WorldId = 'clover' | 'ember' | 'frost' | 'moon' | 'magma';

/** A built-in level as written in WORLDS */
interface LevelSpec {
  name: string;
  par: number; // seconds, for three stars
  track: TrackPiece[];
}
/** A built-in level */
export interface LevelDef extends LevelSpec {
  id: string; // 'clover-1'
  index: number; // within its world, from 0
  world: WorldId;
}
interface WorldSpec {
  id: WorldId;
  name: string;
  blurb: string;
  gravity: number; // times GRAVITY
  levels: LevelSpec[];
}
export interface World extends WorldSpec {
  levels: LevelDef[];
}

export type BikeId = 'scout' | 'hopper' | 'twister' | 'bulldog' | 'comet';
/** A bike's frame and tuning (see BASE) */
export interface BikeSpec {
  massC: number;
  inertiaC: number;
  massW: number;
  radius: number;
  inertiaW: number;
  anchors: [x: number, y: number][]; // where the rear and front wheels hang, in the bike's frame
  kU: number;
  cU: number;
  kP: number;
  cP: number;
  travelUp: number;
  travelDown: number;
  torque: number;
  maxSpin: number;
  wheelie: number;
  brake: number;
  lean: number;
  leanMaxW: number;
  mu: number;
  iceMu: number;
  grav: number;
  head: Circle;
  torso: Circle;
  hulls: Circle[];
  wreckHulls?: Circle[]; // hulls plus WRECK_HULLS, made the first time a bike of this kind tumbles
}
interface BikeSpecDef {
  id: BikeId;
  name: string;
  stars: number; // total stars needed to unlock
  perk: string; // the one-line strength shown in the garage
  blurb: string;
  tune: Partial<BikeSpec>; // changes from BASE
}
/** A bike in the garage */
export interface BikeType extends BikeSpecDef {
  spec: BikeSpec;
}
/** 0..1 ratings for the garage bars */
export interface BikeStats {
  speed: number;
  grip: number;
  spin: number;
  air: number;
}

/** The controls, each 0..1 (lean -1..1, positive leans back) */
export interface BikeInput {
  gas: number;
  brake: number;
  lean: number;
}
/** The chassis (bike plus rider): position, angle, velocity and spin */
export interface Chassis {
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  w: number;
}
export interface Wheel {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phi: number; // how far it has turned
  om: number; // spin (negative rolls forwards)
  contact: boolean;
  age: number; // seconds since it last touched the track
  nx: number; // the normal of the track it last touched
  ny: number;
  kind: SurfaceKind;
  seg?: number; // the terrain segment it last touched
}
/** The rider thrown off after a crash */
export interface Ragdoll {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  w: number;
  r: number;
}
/** What happened to a bike in a step (Bike.events, emptied by the game) */
export type BikeEvent =
  | { type: 'flip'; n: number; back: boolean }
  | { type: 'land'; hard: number }
  | { type: 'crash'; kind: CrashKind }
  | { type: 'finish'; time: number };
export interface BikeOptions {
  id?: string; // 'me' unless given
  x?: number; // where it starts, else the level's startX
}
/** A compact pose for ghosts and the network: x, y, angle, rear wheel spin, lean, flags (1 crashed, 2 finished) */
export type Pose = [x: number, y: number, a: number, phi: number, lean: number, flags: number];
/** How the computer rider rides (botInput); the defaults are the game's own rider */
export interface BotConfig {
  kp?: number; // how hard it steers towards the angle it wants
  kd?: number; // how much it damps the spin
  dead?: number; // leans smaller than this are let go
  maxSpeed?: number; // no gas above this speed
}
/** A ghost frame: x, y, angle */
export type GhostFrame = [x: number, y: number, a: number];
/** A best run as bike-race.js saves it in localStorage (bikerace.ghost.v1.<level id>); f is encodeGhost's text */
export interface SavedGhost {
  time: number;
  bike: string;
  f: string;
}

// ---------------------------------------------------------------------------------------------
// Terrain: polylines in metres, y up. Each segment can have a kind (ground, ice, pit, lava) and a
// group. Group 0 always collides; loop halves use other groups that a bike switches on and off
// as it goes round, so the way in and the way out of a loop never block each other.
// A line may also carry `s`, each segment's distance along the track (levels built in the editor use it to
// know where a bike is, see Bike.updateGhosts); Terrain.s is then that distance per segment.
const CELL = 1;
const PAD = 1.4; // bigger than the largest collider radius

export class Terrain {
  lines: TerrainLine[];
  n: number;
  ax: Float64Array;
  ay: Float64Array;
  bx: Float64Array;
  by: Float64Array;
  nx: Float64Array;
  ny: Float64Array;
  kind: SurfaceKind[];
  group: Int32Array;
  s: Float64Array;
  x0: number;
  cells: number;
  buckets: number[][];

  constructor(lines: TerrainLine[]) {
    this.lines = lines;
    const ax: number[] = [],
      ay: number[] = [],
      bx: number[] = [],
      by: number[] = [],
      nx: number[] = [],
      ny: number[] = [],
      kind: SurfaceKind[] = [],
      group: number[] = [],
      segS: number[] = [];
    for (const L of lines) {
      const p = L.pts;
      for (let i = 0, s = 0; i + 3 < p.length; i += 2, s++) {
        const x0 = p[i],
          y0 = p[i + 1],
          x1 = p[i + 2],
          y1 = p[i + 3];
        const dx = x1 - x0,
          dy = y1 - y0,
          l = Math.hypot(dx, dy);
        if (l < 1e-6) continue;
        ax.push(x0);
        ay.push(y0);
        bx.push(x1);
        by.push(y1);
        nx.push(-dy / l);
        ny.push(dx / l);
        kind.push((L.kinds && L.kinds[s]) || L.kind || 'ground');
        group.push(L.group || 0);
        segS.push(L.s ? L.s[s] : NaN);
      }
    }
    this.n = ax.length;
    this.ax = Float64Array.from(ax);
    this.ay = Float64Array.from(ay);
    this.bx = Float64Array.from(bx);
    this.by = Float64Array.from(by);
    this.nx = Float64Array.from(nx);
    this.ny = Float64Array.from(ny);
    this.kind = kind;
    this.group = Int32Array.from(group);
    this.s = Float64Array.from(segS);
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < this.n; i++) {
      lo = Math.min(lo, ax[i], bx[i]);
      hi = Math.max(hi, ax[i], bx[i]);
    }
    this.x0 = Math.floor(lo - PAD);
    this.cells = Math.ceil(hi + PAD) - this.x0 + 1;
    this.buckets = Array.from({ length: this.cells }, () => []);
    for (let i = 0; i < this.n; i++) {
      const c0 = Math.floor((Math.min(ax[i], bx[i]) - PAD - this.x0) / CELL);
      const c1 = Math.floor((Math.max(ax[i], bx[i]) + PAD - this.x0) / CELL);
      for (let c = Math.max(0, c0); c <= Math.min(this.cells - 1, c1); c++) this.buckets[c].push(i);
    }
  }
  /** The segments that might touch x (within PAD) */
  near(x: number): readonly number[] {
    const c = Math.floor((x - this.x0) / CELL);
    return c >= 0 && c < this.cells ? this.buckets[c] : EMPTY;
  }
  // Highest upward-facing surface at x that lies at or below yMax (ignores loop groups).
  surface(x: number, yMax = 1e9): Surface | null {
    let best = -1,
      bestY = -Infinity;
    for (const i of this.near(x)) {
      if (this.ny[i] < 0.15 || this.group[i] !== 0) continue;
      const x0 = this.ax[i],
        x1 = this.bx[i];
      if (x < x0 || x > x1) continue;
      const y = this.ay[i] + ((x - x0) / (x1 - x0)) * (this.by[i] - this.ay[i]);
      if (y <= yMax && y > bestY) {
        bestY = y;
        best = i;
      }
    }
    if (best < 0) return null;
    return {
      y: bestY,
      seg: best,
      kind: this.kind[best],
      angle: Math.atan2(this.by[best] - this.ay[best], this.bx[best] - this.ax[best]),
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Level builder: a "turtle" that walks right and appends ground points piece by piece.
class Builder {
  x = 0;
  y = 0;
  pts: number[] = [0, 0];
  kinds: SurfaceKind[] = [];
  kindNow: SurfaceKind = 'ground';
  extra: TerrainLine[] = []; // loops and other separate lines
  pits: Pit[] = []; // {x0, x1, y, kind} lethal floors, for drawing
  loops: Loop[] = []; // {cx, cy, r}
  icy: IcyStretch[] = []; // {x0, x1}
  groupNext = 1;

  pt(x: number, y: number, kind?: SurfaceKind) {
    this.pts.push(x, y);
    this.kinds.push(kind || this.kindNow);
    this.x = x;
    this.y = y;
  }
  curve(len: number, f: (t: number) => number, step = 0.35) {
    // f(t) gives y offset at t in [0,1]
    const x0 = this.x,
      y0 = this.y,
      n = Math.max(1, Math.ceil(len / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this.pt(x0 + len * t, y0 + f(t));
    }
  }
  flat(len: number) {
    this.curve(len, () => 0, 2);
  }
  slope(len: number, dy: number) {
    this.curve(len, (t) => dy * t, 1);
  }
  rise(len: number, dy: number) {
    this.curve(len, (t) => (dy * (1 - Math.cos(Math.PI * t))) / 2);
  }
  hill(len: number, h: number) {
    this.curve(len, (t) => (h * (1 - Math.cos(TAU * t))) / 2);
  }
  bumps(len: number, n: number, h: number) {
    for (let i = 0; i < n; i++) this.hill(len / n, h);
  }
  // concave launch ramp; with drop it ends in a vertical lip back down to the start height
  kicker(len: number, h: number, drop = true) {
    const y0 = this.y;
    this.curve(len, (t) => h * t * t, 0.3);
    if (drop) this.pt(this.x, y0);
  }
  // pit with steep walls and a lethal floor; the far side is dy higher than the near side
  gap(len: number, dy = 0, kind: PitKind = 'pit', depth = 9) {
    const x0 = this.x,
      y0 = this.y,
      floor = Math.min(y0, y0 + dy) - depth;
    this.pt(x0 + 0.05, floor);
    this.pt(x0 + len - 0.05, floor, kind);
    this.pt(x0 + len, y0 + dy);
    this.pits.push({ x0, x1: x0 + len, y: floor, top: Math.max(y0, y0 + dy), kind });
  }
  step(dy: number) {
    this.pt(this.x + 0.02, this.y + dy);
  }
  table(up: number, h: number, top: number, down: number) {
    this.curve(up, (t) => h * Math.pow(t, 1.6), 0.3);
    this.flat(top);
    this.rise(down, -h);
  }
  ice(on: boolean) {
    if (on) this.icy.push({ x0: this.x, x1: Infinity });
    else if (this.icy.length) this.icy[this.icy.length - 1].x1 = this.x;
    this.kindNow = on ? 'ice' : 'ground';
  }
  // A full loop that sits on the ground; the ground continues flat underneath it.
  // The two halves overlap a little at the top so there is always track under the wheels.
  loop(r: number) {
    const cx = this.x + r + 1.5,
      cy = this.y + r,
      gA = this.groupNext++,
      gB = this.groupNext++;
    const arc = (t0: number, t1: number) => {
      const out: number[] = [],
        n = Math.max(4, Math.ceil((Math.abs(t1 - t0) * r) / 0.3));
      for (let i = 0; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n;
        out.push(cx + r * Math.cos(t), cy + r * Math.sin(t));
      }
      return out;
    };
    // first half: from the bottom, up the right side, just past the top (counter-clockwise)
    const a = [cx - 0.9, cy - r, ...arc(-Math.PI / 2, Math.PI / 2 + 0.45)];
    // second half: from just before the top, down the left side, back to the bottom and out
    const b = [...arc(Math.PI / 2 - 0.45, 1.5 * Math.PI), cx + 0.9, cy - r];
    this.extra.push({ pts: a, group: gA, kind: 'loop' }, { pts: b, group: gB, kind: 'loop' });
    this.loops.push({ cx, cy, r, gA, gB });
    this.flat(2 * r + 4);
  }
  // a short steep ramp up onto a ledge
  ledge(dy: number) {
    this.slope(Math.max(1.6, dy * 1.8), dy);
  }
}

export function buildLevel(world: Pick<World, 'gravity'>, def: Pick<LevelDef, 'name' | 'track'>): Level {
  const B = new Builder();
  // start: a wall behind, then a flat run-up; the bike starts at x = 0
  B.pts = [-30, 40, -30, 0];
  B.kinds = ['ground'];
  B.x = -30;
  B.y = 0;
  B.flat(42);
  const marks: Mark[] = [];
  for (const p of def.track) {
    const [name, ...args] = p;
    if (typeof B[name] !== 'function') throw new Error('Unknown piece ' + String(name) + ' in ' + def.name);
    marks.push([B.x, p.join(' ')]);
    (B[name] as (this: Builder, ...a: typeof args) => void).apply(B, args);
  }
  if (B.kindNow !== 'ground') B.ice(false);
  B.flat(6);
  const finishX = B.x;
  B.flat(46);
  B.pt(B.x, B.y + 40);
  const lines: TerrainLine[] = [{ pts: B.pts, kinds: B.kinds, kind: 'ground' }, ...B.extra];
  const terrain = new Terrain(lines);
  // checkpoints for multiplayer respawns: roughly every 70 m, on calm ground
  const checkpoints: number[] = [];
  for (let x = 70; x < finishX - 30; x += 6) {
    const last = checkpoints.length ? checkpoints[checkpoints.length - 1] : 6;
    if (x - last < 70) continue;
    const s1 = terrain.surface(x),
      s2 = terrain.surface(x + 3),
      s0 = terrain.surface(x - 3);
    if (!s1 || !s2 || !s0 || s1.kind !== 'ground') continue;
    if (Math.abs(s1.angle) > 0.25 || Math.abs(s2.y - s1.y) > 0.8 || Math.abs(s0.y - s1.y) > 0.8) continue;
    if (B.loops.some((L) => Math.abs(L.cx - x) < L.r + 4)) continue;
    checkpoints.push(x);
  }
  let minY = 0,
    maxY = 0;
  for (let i = 1; i < B.pts.length; i += 2) {
    minY = Math.min(minY, B.pts[i]);
    maxY = Math.max(maxY, B.pts[i]);
  }
  return {
    terrain,
    finishX,
    startX: 0,
    checkpoints,
    ground: B.pts,
    kinds: B.kinds,
    pits: B.pits,
    loops: B.loops,
    icy: B.icy,
    marks,
    gravity: GRAVITY * (world.gravity || 1),
    killY: minY - 6,
    minY,
    maxY,
  };
}

// ---------------------------------------------------------------------------------------------
// Worlds and levels. Each track is a list of pieces for the builder above. Par times come from
// tools/check-bike-levels.ts (the computer rider's time, rounded); beat par for three stars.
// prettier-ignore
const WORLD_SPECS: WorldSpec[] = [
  { id: 'clover', name: 'Clover Hills', blurb: 'Rolling meadows and gentle jumps.', gravity: 1, levels: [
    { name: 'First Gear', par: 16, track: [['hill', 24, 1.5], ['flat', 10], ['hill', 30, 3], ['flat', 8], ['bumps', 24, 3, 0.5], ['flat', 10], ['rise', 24, 4], ['flat', 12], ['rise', 24, -4], ['flat', 10], ['hill', 26, 2.5]] },
    { name: 'Daisy Dash', par: 18.5, track: [['bumps', 32, 4, 0.5], ['flat', 8], ['kicker', 7, 1.2], ['flat', 26], ['hill', 34, 4], ['flat', 6], ['kicker', 8, 1.6], ['flat', 28], ['bumps', 24, 3, 0.45], ['rise', 18, 3], ['flat', 10], ['rise', 26, -3]] },
    { name: 'Hay Bale Hop', par: 17.5, track: [['kicker', 7, 1.4], ['flat', 24], ['table', 8, 2, 6, 12], ['flat', 10], ['hill', 40, 5], ['flat', 8], ['kicker', 8, 1.8], ['gap', 6, 0], ['flat', 22], ['bumps', 30, 4, 0.6], ['flat', 10], ['table', 8, 2.2, 8, 12]] },
    { name: 'Windmill Way', par: 21, track: [['rise', 30, 6], ['flat', 6], ['rise', 18, -3], ['hill', 26, 3], ['kicker', 8, 1.8], ['gap', 7, -1], ['flat', 20], ['bumps', 24, 3, 0.6], ['rise', 34, 7], ['flat', 4], ['rise', 30, -10], ['flat', 8], ['kicker', 9, 2], ['flat', 28], ['hill', 30, 4]] },
    { name: 'Picnic Plunge', par: 20.5, track: [['table', 9, 2.5, 4, 12], ['flat', 6], ['rise', 26, 8], ['flat', 6], ['step', -4], ['flat', 14], ['bumps', 30, 4, 0.6], ['kicker', 9, 2], ['gap', 8, 0], ['flat', 22], ['hill', 36, 5], ['hill', 24, -2.5], ['kicker', 8, 1.6], ['flat', 26], ['rise', 20, 3]] },
    { name: 'Clover Crown', par: 24.5, track: [['hill', 30, 4], ['kicker', 8, 2], ['gap', 8, 1], ['flat', 20], ['rise', 30, 8], ['kicker', 6, 1], ['gap', 6, -3], ['rise', 24, -4], ['bumps', 30, 4, 0.6], ['table', 9, 3, 6, 12], ['flat', 6], ['hill', 40, 7], ['kicker', 9, 2.2], ['gap', 10, 0], ['flat', 22], ['bumps', 20, 2, 0.7], ['rise', 20, -4]] },
  ] },
  { id: 'ember', name: 'Ember Canyon', blurb: 'Red rock, deep gaps and big drops.', gravity: 1, levels: [
    { name: 'Dust Devil', par: 16.5, track: [['rise', 20, 4], ['step', -2], ['flat', 12], ['kicker', 8, 1.6], ['gap', 7, 0], ['flat', 22], ['hill', 30, 5], ['flat', 20], ['step', -3], ['flat', 10], ['bumps', 20, 3, 0.5], ['rise', 24, 5], ['flat', 6], ['rise', 24, -6]] },
    { name: 'Mesa Mile', par: 18.5, track: [['rise', 26, 6], ['flat', 10], ['kicker', 6, 1], ['gap', 9, -4], ['rise', 24, -2], ['flat', 8], ['table', 8, 3, 8, 12], ['bumps', 26, 3, 0.7], ['rise', 30, 8], ['flat', 8], ['step', -5], ['flat', 12], ['kicker', 9, 2], ['gap', 9, 0], ['flat', 20]] },
    { name: 'Rattlesnake Run', par: 21, track: [['bumps', 36, 4, 0.7], ['kicker', 8, 1.8], ['gap', 8, 1], ['flat', 20], ['rise', 20, 4], ['step', -6], ['flat', 12], ['hill', 26, 4], ['hill', 26, -3], ['kicker', 9, 2.2], ['gap', 10, -2], ['flat', 20], ['bumps', 24, 3, 0.6], ['rise', 30, -4]] },
    { name: 'Spire Leap', par: 18.5, track: [['rise', 34, 9], ['kicker', 6, 1.2], ['gap', 12, -6], ['rise', 24, -3], ['flat', 6], ['kicker', 8, 1.8], ['gap', 8, 1], ['flat', 18], ['ledge', 1.2], ['flat', 8], ['ledge', 1.2], ['flat', 8], ['rise', 26, -6], ['bumps', 30, 4, 0.6], ['table', 10, 3.5, 6, 14]] },
    { name: 'Canyon Drop', par: 19, track: [['rise', 40, 12], ['flat', 6], ['step', -6], ['flat', 6], ['rise', 18, -6], ['flat', 6], ['kicker', 9, 2.4], ['gap', 12, 0], ['flat', 20], ['hill', 30, 5], ['kicker', 8, 2], ['gap', 10, 2], ['flat', 20], ['bumps', 26, 3, 0.7], ['rise', 26, -6]] },
    { name: 'Ember Gauntlet', par: 25, track: [['kicker', 8, 2], ['gap', 9, 0], ['flat', 18], ['rise', 30, 8], ['step', -4], ['bumps', 24, 3, 0.6], ['kicker', 9, 2.4], ['gap', 12, -2], ['flat', 20], ['table', 9, 3.5, 4, 12], ['flat', 10], ['ledge', 1.4], ['flat', 7], ['ledge', 1.4], ['flat', 13], ['kicker', 6, 1.2], ['gap', 8, -4], ['rise', 24, -4], ['hill', 40, 7], ['kicker', 9, 2.2], ['gap', 11, 0], ['flat', 20]] },
  ] },
  { id: 'frost', name: 'Frostbite Pass', blurb: 'Snowy peaks with slippery ice patches.', gravity: 1, levels: [
    { name: 'First Frost', par: 15.5, track: [['hill', 26, 3], ['ice', true], ['flat', 24], ['ice', false], ['kicker', 8, 1.6], ['flat', 26], ['rise', 26, 6], ['ice', true], ['rise', 26, -6], ['ice', false], ['bumps', 24, 3, 0.5], ['hill', 30, 4]] },
    { name: 'Icicle Alley', par: 16, track: [['ice', true], ['bumps', 30, 3, 0.5], ['ice', false], ['kicker', 8, 1.8], ['gap', 7, 0], ['flat', 20], ['rise', 30, 7], ['flat', 6], ['ice', true], ['rise', 30, -7], ['flat', 10], ['ice', false], ['table', 9, 2.5, 6, 12], ['hill', 30, 4]] },
    { name: 'Glacier Glide', par: 16, track: [['rise', 30, 8], ['ice', true], ['flat', 10], ['rise', 34, -10], ['ice', false], ['kicker', 9, 2.2], ['gap', 10, 0], ['flat', 20], ['ice', true], ['hill', 30, 3], ['ice', false], ['bumps', 26, 3, 0.6], ['kicker', 8, 1.8], ['gap', 8, 1], ['flat', 20]] },
    { name: 'Avalanche', par: 17, track: [['rise', 40, 12], ['flat', 4], ['ice', true], ['rise', 30, -9], ['ice', false], ['step', -3], ['flat', 10], ['kicker', 9, 2.2], ['gap', 10, -1], ['flat', 20], ['ice', true], ['bumps', 30, 3, 0.6], ['ice', false], ['table', 10, 3, 6, 14], ['hill', 26, 3]] },
    { name: 'Polar Pipe', par: 20, track: [['hill', 34, -4], ['hill', 34, -5], ['kicker', 8, 2], ['gap', 9, 0], ['flat', 18], ['ice', true], ['flat', 16], ['ice', false], ['rise', 26, 7], ['kicker', 6, 1.2], ['gap', 10, -5], ['rise', 24, -2], ['ice', true], ['bumps', 26, 3, 0.6], ['ice', false], ['hill', 36, 6]] },
    { name: 'Summit Storm', par: 23.5, track: [['ice', true], ['rise', 30, 6], ['ice', false], ['kicker', 8, 2], ['gap', 10, 0], ['flat', 18], ['rise', 30, 8], ['ice', true], ['flat', 10], ['ice', false], ['step', -5], ['flat', 10], ['kicker', 9, 2.4], ['gap', 12, -1], ['flat', 18], ['ice', true], ['hill', 30, -4], ['ice', false], ['table', 10, 3.5, 6, 14], ['bumps', 24, 3, 0.6], ['kicker', 9, 2.2], ['gap', 11, 0], ['flat', 20]] },
  ] },
  { id: 'moon', name: 'Crater Moon', blurb: 'Low gravity, huge air and loops.', gravity: 0.42, levels: [
    { name: 'Small Step', par: 23.5, track: [['hill', 30, 2], ['flat', 20], ['kicker', 8, 1.6], ['flat', 50], ['hill', 40, -5], ['flat', 30], ['kicker', 9, 2], ['gap', 16, 0], ['flat', 50], ['bumps', 40, 3, 0.8]] },
    { name: 'Crater Hop', par: 28, track: [['hill', 40, -6], ['flat', 30], ['kicker', 8, 2], ['gap', 18, 0], ['flat', 50], ['hill', 44, -8], ['flat', 30], ['loop', 4], ['flat', 14], ['kicker', 9, 2.2], ['gap', 16, 2], ['flat', 50]] },
    { name: 'Moonwalk', par: 30.5, track: [['loop', 4.5], ['flat', 14], ['rise', 30, 10], ['flat', 8], ['kicker', 6, 1.5], ['gap', 20, -8], ['rise', 40, -2], ['flat', 30], ['table', 10, 3, 10, 16], ['flat', 30], ['bumps', 40, 3, 0.8], ['flat', 10], ['kicker', 9, 2.4], ['gap', 18, 0], ['flat', 50]] },
    { name: 'Orbit', par: 37, track: [['kicker', 9, 2.4], ['gap', 18, 0], ['flat', 50], ['loop', 5], ['flat', 10], ['hill', 50, 8], ['flat', 40], ['kicker', 8, 2], ['gap', 20, -4], ['flat', 50], ['loop', 4.5], ['flat', 14], ['bumps', 40, 3, 0.8], ['flat', 10], ['kicker', 10, 2.6], ['gap', 22, 0], ['flat', 50]] },
    { name: 'Dark Side', par: 40.5, track: [['rise', 40, 14], ['flat', 6], ['kicker', 6, 1.4], ['gap', 20, -12], ['rise', 50, -2], ['flat', 20], ['loop', 5], ['flat', 10], ['table', 12, 4, 10, 18], ['flat', 30], ['hill', 50, -10], ['flat', 30], ['kicker', 10, 2.6], ['gap', 22, 2], ['flat', 50], ['bumps', 30, 2, 0.8], ['flat', 10], ['loop', 4.5], ['flat', 16]] },
    { name: 'Lunar Loopfest', par: 45, track: [['loop', 4.5], ['flat', 10], ['kicker', 9, 2.4], ['gap', 20, 0], ['flat', 50], ['loop', 5], ['flat', 10], ['rise', 40, 12], ['flat', 6], ['kicker', 6, 1.4], ['gap', 20, -10], ['rise', 50, -2], ['flat', 20], ['loop', 5.5], ['flat', 10], ['hill', 50, 8], ['flat', 40], ['kicker', 10, 2.6], ['gap', 24, 0], ['flat', 50], ['loop', 4.5], ['flat', 12]] },
  ] },
  { id: 'magma', name: 'Magma Works', blurb: 'Lava pits. Do not fall in.', gravity: 1, levels: [
    { name: 'Hot Start', par: 17, track: [['hill', 26, 3], ['kicker', 8, 1.8], ['gap', 7, 0, 'lava'], ['flat', 22], ['bumps', 24, 3, 0.5], ['kicker', 8, 2], ['gap', 8, 0, 'lava'], ['flat', 22], ['rise', 24, 5], ['flat', 6], ['rise', 24, -5], ['hill', 26, 3]] },
    { name: 'Cinder Steps', par: 17, track: [['flat', 4], ['ledge', 1.2], ['flat', 8], ['ledge', 1.2], ['flat', 8], ['kicker', 8, 2], ['gap', 9, -2, 'lava'], ['flat', 20], ['rise', 30, 7], ['kicker', 6, 1.2], ['gap', 9, -4, 'lava'], ['rise', 24, -3], ['bumps', 26, 3, 0.6], ['table', 9, 3, 6, 12]] },
    { name: 'Forge Floor', par: 17, track: [['kicker', 8, 2], ['gap', 9, 0, 'lava'], ['flat', 18], ['hill', 30, 5], ['kicker', 9, 2.2], ['gap', 11, 0, 'lava'], ['flat', 18], ['step', -4], ['flat', 8], ['bumps', 30, 4, 0.6], ['kicker', 8, 2], ['gap', 9, 1, 'lava'], ['flat', 18], ['rise', 26, -5]] },
    { name: 'Slag Slide', par: 22.5, track: [['rise', 40, 12], ['flat', 4], ['rise', 30, -10], ['kicker', 9, 2.4], ['gap', 12, -2, 'lava'], ['flat', 20], ['table', 9, 3.5, 4, 12], ['flat', 8], ['kicker', 8, 2], ['gap', 10, 0, 'lava'], ['flat', 18], ['bumps', 26, 3, 0.7], ['rise', 30, 6], ['kicker', 6, 1.4], ['gap', 10, -5, 'lava'], ['rise', 24, -2], ['flat', 10]] },
    { name: 'Eruption', par: 23, track: [['hill', 40, 8], ['kicker', 9, 2.4], ['gap', 12, 0, 'lava'], ['flat', 18], ['ledge', 1.3], ['flat', 7], ['ledge', 1.3], ['flat', 7], ['kicker', 8, 2], ['gap', 10, -2, 'lava'], ['flat', 18], ['bumps', 30, 4, 0.6], ['rise', 34, 9], ['step', -5], ['flat', 14], ['kicker', 9, 2.4], ['gap', 12, 0, 'lava'], ['flat', 18], ['hill', 26, -3]] },
    { name: 'Core Meltdown', par: 28, track: [['kicker', 8, 2], ['gap', 9, 0, 'lava'], ['flat', 18], ['rise', 30, 8], ['kicker', 6, 1.4], ['gap', 12, -5, 'lava'], ['rise', 24, -3], ['bumps', 24, 3, 0.6], ['kicker', 9, 2.4], ['gap', 12, 0, 'lava'], ['flat', 18], ['table', 10, 3.5, 4, 12], ['flat', 8], ['ledge', 1.4], ['flat', 7], ['ledge', 1.4], ['flat', 7], ['kicker', 9, 2.4], ['gap', 12, -2, 'lava'], ['flat', 18], ['hill', 40, 7], ['kicker', 10, 2.6], ['gap', 13, 0, 'lava'], ['flat', 20]] },
  ] },
];
// each level knows its id ('clover-1'), its place in its world and its world
export const WORLDS: World[] = WORLD_SPECS.map((w) => ({
  ...w,
  levels: w.levels.map((L, i) => ({ ...L, id: `${w.id}-${i + 1}`, index: i, world: w.id })),
}));
export const LEVELS: LevelDef[] = WORLDS.flatMap((w) => w.levels);
export const levelById = (id: string) => LEVELS.find((L) => L.id === id) || null;
export const worldOf = (id: string) => WORLDS.find((w) => w.id === levelById(id)?.world) || null;
// stars: 3 for par or better, 2 within 30% of par, 1 for finishing
export function starsFor(level: Pick<LevelDef, 'par'>, time: number) {
  if (!(time > 0)) return 0;
  if (time <= level.par + 1e-9) return 3;
  if (time <= twoStarTime(level) + 1e-9) return 2;
  return 1;
}
export const twoStarTime = (level: Pick<LevelDef, 'par'>) => Math.round(level.par * 1.3 * 10) / 10;

// ---------------------------------------------------------------------------------------------
// Bikes. Every bike shares the same frame (wheel size, wheelbase, rider) and differs in its tuning, so a
// level that one bike can finish is never blocked by another bike's shape. tools/check-bike-levels.ts
// runs every bike through every level; rerun it after changing anything here.
//   torque, maxSpin   engine pull and top wheel speed (top speed is maxSpin * radius m/s)
//   wheelie           how much the front lifts under gas
//   lean, leanMaxW    the most push leaning has on the ground, and the spin speed at full lean (rad/s)
//   mu, iceMu         tyre grip on ground and on ice
//   grav              share of the level's gravity the bike feels (below 1 floats longer in the air)
//   kU, cU, travelUp  suspension spring, damping and travel
// The tilt sets how fast the bike turns, not how hard it is pushed: full lean asks for leanMaxW in the air and
// GROUND_SPIN of that on the ground. AIR_SNAP is how quickly the air spin follows (1/s, so 1/AIR_SNAP seconds).
const AIR_SNAP = 45,
  GROUND_SPIN = 0.55,
  REVERSE = 0.15; // REVERSE: backing-up speed over top wheel speed
const WRECK_HULLS: Circle[] = [
  [-0.3, 0.3, 0.18],
  [0.35, 0.3, 0.18],
]; // extra hit circles for the frame once it tumbles on its own
export const BASE: BikeSpec = {
  massC: 10,
  inertiaC: 3.0,
  massW: 1.0,
  radius: 0.34,
  inertiaW: 0.09,
  anchors: [
    [-0.62, -0.4],
    [0.64, -0.4],
  ],
  kU: 1500,
  cU: 85,
  kP: 7000,
  cP: 90,
  travelUp: 0.12,
  travelDown: 0.06,
  torque: 30,
  maxSpin: 46,
  wheelie: 0.15,
  brake: 40,
  lean: 90,
  leanMaxW: 8.5,
  mu: 1.15,
  iceMu: 0.28,
  grav: 1,
  head: [0.08, 0.98, 0.21],
  torso: [-0.2, 0.52, 0.17],
  hulls: [
    [0, -0.12, 0.25],
    [-0.62, -0.02, 0.16],
    [0.6, 0.06, 0.15],
  ],
};
// stars: total stars needed to unlock. perk: the one-line strength shown in the garage.
const BIKE_SPECS: BikeSpecDef[] = [
  {
    id: 'scout',
    name: 'Scout',
    stars: 0,
    perk: 'All-rounder',
    blurb: 'Steady and forgiving. Good at a bit of everything.',
    tune: {},
  },
  {
    id: 'hopper',
    name: 'Hopper',
    stars: 10,
    perk: 'Big air',
    blurb: 'Light and springy. Floats over gaps, but drifts on the moon.',
    tune: { massC: 8.6, inertiaC: 2.6, kU: 1100, cU: 60, travelUp: 0.17, torque: 29, grav: 0.86, mu: 1.05, lean: 64 },
  },
  {
    id: 'twister',
    name: 'Twister',
    stars: 25,
    perk: 'Fast flips',
    blurb: 'Spins round in a flash, so flips come easy. Twitchy on the ground.',
    tune: { lean: 86, leanMaxW: 11.5, inertiaC: 2.5, wheelie: 0.18 },
  },
  {
    id: 'bulldog',
    name: 'Bulldog',
    stars: 45,
    perk: 'Grip',
    blurb: 'Heavy and grippy. Climbs ice like it is dry, but drops fast off jumps.',
    tune: {
      massC: 12.5,
      inertiaC: 4.3,
      mu: 1.5,
      iceMu: 0.55,
      torque: 40,
      maxSpin: 44.5,
      wheelie: 0.08,
      lean: 96,
      leanMaxW: 7,
      kU: 1700,
      cU: 95,
      grav: 1.05,
    },
  },
  {
    id: 'comet',
    name: 'Comet',
    stars: 70,
    perk: 'Top speed',
    blurb: 'The fastest bike. Pulls big wheelies and slides on ice.',
    tune: { maxSpin: 53, torque: 37, wheelie: 0.28, lean: 72, mu: 1.08, iceMu: 0.22 },
  },
];
export const BIKES: BikeType[] = BIKE_SPECS.map((b) => ({ ...b, spec: Object.assign({}, BASE, b.tune) }));
export const bikeById = (id: string) => BIKES.find((b) => b.id === id) || BIKES[0];
// Seconds for one full flip at full lean, from a standstill in the air.
export function flipTime(s: BikeSpec) {
  return TAU / s.leanMaxW + 1 / AIR_SNAP;
}
// 0..1 ratings for the garage bars, worked out from the tuning above
export function bikeStats(b: BikeType): BikeStats {
  const s = b.spec;
  return {
    speed: clamp(((s.maxSpin * s.radius - 13.5) / 5) * 0.8 + (s.torque / (s.massC + 2 * s.massW) - 2.3) * 0.2, 0, 1),
    grip: clamp(((s.mu - 0.9) / 0.7) * 0.6 + ((s.iceMu - 0.15) / 0.45) * 0.4, 0, 1),
    spin: clamp((1.0 - flipTime(s)) / 0.45, 0, 1),
    air: clamp((1.1 - s.grav) / 0.25 + (s.travelUp - 0.12) * 1.5, 0, 1),
  };
}

// ---------------------------------------------------------------------------------------------
// One bike in the simulation: a chassis (bike plus rider) and two wheels on springs.
export const rot = (a: number, x: number, y: number): [x: number, y: number] => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
};

export class Bike {
  sim: Sim;
  type: BikeType;
  s: BikeSpec;
  id: string;
  input: BikeInput;
  disabledGroups: Set<number>;
  running = false; // the race clock runs (set by the game)
  frozen = false; // Sim.step leaves the bike alone (set by the game)
  c!: Chassis;
  wheels!: Wheel[]; // rear, front
  crashed!: boolean;
  crashAt!: number;
  crashKind!: CrashKind | '';
  finished!: boolean;
  finishTime!: number;
  time!: number;
  flips!: number;
  airborne!: number;
  airRot!: number;
  grounded!: boolean;
  leanVis!: number;
  events!: BikeEvent[];
  rider!: Ragdoll | null;
  loose!: boolean;
  checkpoint!: number;
  loopState!: number[];
  pathS!: number;
  ghostZone!: number;

  constructor(sim: Sim, bikeId: string, opts: BikeOptions = {}) {
    this.sim = sim;
    this.type = bikeById(bikeId);
    this.s = this.type.spec;
    this.id = opts.id || 'me';
    this.input = { gas: 0, brake: 0, lean: 0 };
    this.disabledGroups = new Set();
    this.reset(opts.x != null ? opts.x : sim.level.startX);
  }
  reset(x: number) {
    const s = this.s,
      L = this.sim.level,
      T = L.terrain;
    // startTop: a level from the editor may have track above the start, so look below it
    const surf = T.surface(x, L.startTop != null ? L.startTop : 1e9) || { y: 0, angle: 0 };
    const a = surf.angle;
    const lift = -s.anchors[0][1] + s.radius + 0.02;
    const [ox, oy] = rot(a, 0, lift);
    this.c = { x: x + ox, y: surf.y + oy, a, vx: 0, vy: 0, w: 0 };
    this.wheels = s.anchors.map(([lx, ly]): Wheel => {
      const [wx, wy] = rot(a, lx, ly);
      return {
        x: this.c.x + wx,
        y: this.c.y + wy,
        vx: 0,
        vy: 0,
        phi: 0,
        om: 0,
        contact: false,
        age: 9,
        nx: 0,
        ny: 1,
        kind: 'ground',
      };
    });
    this.crashed = false;
    this.crashAt = 0;
    this.crashKind = '';
    this.finished = false;
    this.finishTime = 0;
    this.time = 0; // seconds since this bike's race clock started
    this.flips = 0;
    this.airborne = 0;
    this.airRot = 0;
    this.grounded = true;
    this.leanVis = 0;
    this.events = [];
    this.rider = null; // the tumbling rider after a crash
    this.loose = false; // after a crash the wheels come off and everything tumbles on its own
    this.checkpoint = 0; // index of the last checkpoint passed (multiplayer respawns)
    this.disabledGroups.clear();
    for (const lp of L.loops) this.disabledGroups.add(lp.gB);
    this.loopState = L.loops.map(() => 0);
    this.pathS = L.ghosts ? L.ghosts.startS : 0; // how far along the track the bike is (editor levels)
    this.ghostZone = -1;
    if (L.ghosts) this.updateGhosts();
  }
  // put the bike back on its feet at x, keeping the race clock running (multiplayer crashes)
  respawn(x: number) {
    const keep = { time: this.time, flips: this.flips, checkpoint: this.checkpoint, running: this.running };
    this.reset(x);
    Object.assign(this, keep);
  }
  get speed() {
    return Math.hypot(this.c.vx, this.c.vy);
  }
  // the level's gravity times the bike's own float (grav below 1 hangs in the air longer)
  get gravity() {
    return this.sim.level.gravity * this.s.grav;
  }
  toWorld(lx: number, ly: number): [x: number, y: number] {
    const [x, y] = rot(this.c.a, lx, ly);
    return [this.c.x + x, this.c.y + y];
  }
  // compact pose for ghosts and the network: x, y, angle, rear wheel spin, lean, flags
  pose(): Pose {
    return [
      this.c.x,
      this.c.y,
      this.c.a,
      this.wheels[0].phi,
      this.leanVis,
      (this.crashed ? 1 : 0) | (this.finished ? 2 : 0),
    ];
  }

  step(dt: number) {
    const s = this.s,
      c = this.c,
      g = this.gravity,
      T = this.sim.level.terrain;
    const live = !this.crashed && !this.finished;
    const inp = live ? this.input : this.finished ? { gas: 0, brake: 1, lean: 0 } : { gas: 0, brake: 0, lean: 0 };
    this.leanVis += (clamp(inp.lean, -1, 1) - this.leanVis) * Math.min(1, dt * 18);
    let fx = 0,
      fy = -g * s.massC,
      tq = 0;
    const ca = Math.cos(c.a),
      sa = Math.sin(c.a);
    const ux = -sa,
      uy = ca,
      px = ca,
      py = sa; // chassis up and forward axes
    if (this.loose) for (const W of this.wheels) W.vy -= g * dt;
    else
      for (let i = 0; i < 2; i++) {
        const W = this.wheels[i],
          [lx, ly] = s.anchors[i];
        const rx = lx * ca - ly * sa,
          ry = lx * sa + ly * ca;
        const Ax = c.x + rx,
          Ay = c.y + ry;
        const vAx = c.vx - c.w * ry,
          vAy = c.vy + c.w * rx;
        const dx = W.x - Ax,
          dy = W.y - Ay,
          rvx = W.vx - vAx,
          rvy = W.vy - vAy;
        const eu = dx * ux + dy * uy,
          ep = dx * px + dy * py;
        const Fu = -s.kU * eu - s.cU * (rvx * ux + rvy * uy);
        const Fp = -s.kP * ep - s.cP * (rvx * px + rvy * py);
        const Fx = Fu * ux + Fp * px,
          Fy = Fu * uy + Fp * py;
        W.vx += (Fx / s.massW) * dt;
        W.vy += (Fy / s.massW - g) * dt;
        fx -= Fx;
        fy -= Fy;
        tq -= rx * Fy - ry * Fx;
      }
    // motor drives the rear wheel clockwise; its reaction lifts the front
    const R = this.wheels[0];
    if (inp.gas > 0 && R.om > -s.maxSpin) {
      const before = R.om;
      R.om = Math.max(-s.maxSpin, R.om - ((s.torque * inp.gas) / s.inertiaW) * dt);
      tq += (s.wheelie * s.inertiaW * (before - R.om)) / dt;
    }
    if (inp.brake > 0) {
      if (live && !inp.gas && this.grounded && c.vx * px + c.vy * py < 0.5) {
        // stopped (or rolling back): holding the brake backs the bike up slowly
        const top = s.maxSpin * REVERSE;
        if (R.om < top) R.om = Math.min(top, R.om + ((s.torque * 0.5 * inp.brake) / s.inertiaW) * dt);
      } else
        for (const W of this.wheels) {
          const d = ((s.brake * inp.brake) / s.inertiaW) * dt;
          W.om = Math.abs(W.om) <= d ? 0 : W.om - Math.sign(W.om) * d;
        }
    }
    for (const W of this.wheels) W.om *= 1 - 0.15 * dt; // bearing drag
    // Leaning sets how fast the bike turns. On the ground it pushes towards GROUND_SPIN of that speed, as hard as
    // the bike's `lean` allows, so a wheelie comes up at a steady rate; let go and the bike settles by itself.
    const lean = clamp(inp.lean, -1, 1),
      air = live && !this.grounded;
    if (live && this.grounded && lean)
      tq += clamp((lean * s.leanMaxW * GROUND_SPIN - c.w) * 20 * s.inertiaC, -s.lean, s.lean);
    else if (!live && !this.grounded) c.w *= 1 - 0.4 * dt; // a wreck, or a bike past the finish, just tumbles
    // integrate
    c.vx += (fx / s.massC) * dt;
    c.vy += (fy / s.massC) * dt;
    c.w += (tq / s.inertiaC) * dt;
    // in the air the spin follows the lean almost at once (within 1/AIR_SNAP s), and stops when the phone is level
    if (air) c.w = lean * s.leanMaxW + (c.w - lean * s.leanMaxW) * Math.exp(-AIR_SNAP * dt);
    const drag = 1 - 0.012 * dt;
    c.vx *= drag;
    c.vy *= drag;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.a += c.w * dt;
    for (const W of this.wheels) {
      W.x += W.vx * dt;
      W.y += W.vy * dt;
      W.phi += W.om * dt;
    }
    if (!this.loose) this.bumpStops();
    // collisions
    let touching = false;
    for (const W of this.wheels) {
      if (this.collideWheel(W, T)) touching = true;
      W.age += dt;
    }
    this.collideHulls(T);
    this.updateLoops();
    // flips are counted from the rotation made while both wheels are off the ground
    if (touching) {
      if (this.airborne > 0.25 && live) {
        const n = Math.floor((Math.abs(this.airRot) + 0.7) / TAU);
        if (n > 0) {
          this.flips += n;
          this.events.push({ type: 'flip', n, back: this.airRot > 0 });
        }
        if (this.airborne > 0.45) this.events.push({ type: 'land', hard: Math.min(1, this.airborne / 1.6) });
      }
      this.airborne = 0;
      this.airRot = 0;
      this.grounded = true;
    } else {
      this.airborne += dt;
      this.airRot += c.w * dt;
      if (this.airborne > 0.06) this.grounded = false;
    }
    if (live) {
      if (this.headHit(T)) this.crash('head');
      else if (c.y < this.sim.level.killY) this.crash('fall');
    }
    if (this.rider) this.stepRider(dt, T, g);
  }

  bumpStops() {
    const s = this.s,
      c = this.c,
      ca = Math.cos(c.a),
      sa = Math.sin(c.a);
    const ux = -sa,
      uy = ca;
    for (let i = 0; i < 2; i++) {
      const W = this.wheels[i],
        [lx, ly] = s.anchors[i];
      const rx = lx * ca - ly * sa,
        ry = lx * sa + ly * ca;
      const eu = (W.x - c.x - rx) * ux + (W.y - c.y - ry) * uy;
      let over = 0;
      if (eu > s.travelUp) over = eu - s.travelUp;
      else if (eu < -s.travelDown) over = eu + s.travelDown;
      if (!over) continue;
      // push apart along the axis, sharing by mass
      const kW = s.massC / (s.massC + s.massW),
        kC = 1 - kW;
      W.x -= ux * over * kW;
      W.y -= uy * over * kW;
      c.x += ux * over * kC;
      c.y += uy * over * kC;
      const vAx = c.vx - c.w * ry,
        vAy = c.vy + c.w * rx;
      const rel = (W.vx - vAx) * ux + (W.vy - vAy) * uy;
      if ((over > 0 && rel > 0) || (over < 0 && rel < 0)) {
        const rn = rx * uy - ry * ux;
        const k = 1 / s.massW + 1 / s.massC + (rn * rn) / s.inertiaC,
          j = rel / k;
        W.vx -= (ux * j) / s.massW;
        W.vy -= (uy * j) / s.massW;
        c.vx += (ux * j) / s.massC;
        c.vy += (uy * j) / s.massC;
        c.w += (rn * j) / s.inertiaC;
      }
    }
  }

  // circle against nearby segments; returns the deepest contact via callback-free loop
  collideWheel(W: Wheel, T: Terrain) {
    const s = this.s,
      r = s.radius;
    let hit = false;
    for (const i of T.near(W.x)) {
      const g = T.group[i];
      if (g && this.disabledGroups.has(g)) continue;
      const ax = T.ax[i],
        ay = T.ay[i],
        ex = T.bx[i] - ax,
        ey = T.by[i] - ay;
      const l2 = ex * ex + ey * ey;
      let t = ((W.x - ax) * ex + (W.y - ay) * ey) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = W.x - (ax + ex * t),
        dy = W.y - (ay + ey * t);
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2) || 1e-6;
      let nx = dx / d,
        ny = dy / d;
      if (d2 < 1e-12) {
        nx = T.nx[i];
        ny = T.ny[i];
      }
      const kind = T.kind[i];
      if ((kind === 'pit' || kind === 'lava') && !this.crashed && !this.finished) this.crash(kind);
      const pen = r - d;
      W.x += nx * pen;
      W.y += ny * pen;
      const vn = W.vx * nx + W.vy * ny;
      let jn = 0;
      if (vn < 0) {
        jn = -1.05 * vn * s.massW;
        W.vx -= 1.05 * vn * nx;
        W.vy -= 1.05 * vn * ny;
      }
      jn += pen * s.massW * 2; // resting contact still grips
      const mu = kind === 'ice' ? s.iceMu : kind === 'loop' ? s.mu * 1.25 : s.mu;
      const tx = ny,
        ty = -nx;
      const vt = W.vx * tx + W.vy * ty + W.om * r;
      const kt = 1 / s.massW + (r * r) / s.inertiaW;
      let jt = -vt / kt;
      const lim = mu * jn;
      if (jt > lim) jt = lim;
      else if (jt < -lim) jt = -lim;
      W.vx += (jt / s.massW) * tx;
      W.vy += (jt / s.massW) * ty;
      W.om += (jt * r) / s.inertiaW;
      W.contact = true;
      W.age = 0;
      W.nx = nx;
      W.ny = ny;
      W.kind = kind;
      W.seg = i;
      hit = true;
    }
    if (!hit && W.age > 0.05) W.contact = false;
    return hit;
  }

  collideHulls(T: Terrain) {
    const s = this.s,
      c = this.c;
    for (const [lx, ly, r] of this.loose ? s.wreckHulls || (s.wreckHulls = s.hulls.concat(WRECK_HULLS)) : s.hulls) {
      const [hx, hy] = this.toWorld(lx, ly);
      for (const i of T.near(hx)) {
        const g = T.group[i];
        if (g && this.disabledGroups.has(g)) continue;
        const ax = T.ax[i],
          ay = T.ay[i],
          ex = T.bx[i] - ax,
          ey = T.by[i] - ay;
        let t = ((hx - ax) * ex + (hy - ay) * ey) / (ex * ex + ey * ey);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = hx - (ax + ex * t),
          dy = hy - (ay + ey * t),
          d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2) || 1e-6,
          nx = d2 < 1e-12 ? T.nx[i] : dx / d,
          ny = d2 < 1e-12 ? T.ny[i] : dy / d;
        const pen = r - d;
        c.x += nx * pen * 0.8;
        c.y += ny * pen * 0.8;
        const rx = hx - nx * r - c.x,
          ry = hy - ny * r - c.y;
        const vpx = c.vx - c.w * ry,
          vpy = c.vy + c.w * rx,
          vn = vpx * nx + vpy * ny;
        if (vn >= 0) continue;
        const rn = rx * ny - ry * nx,
          kn = 1 / s.massC + (rn * rn) / s.inertiaC,
          jn = (-1.1 * vn) / kn;
        c.vx += (jn * nx) / s.massC;
        c.vy += (jn * ny) / s.massC;
        c.w += (rn * jn) / s.inertiaC;
        const tx = ny,
          ty = -nx,
          vt = (c.vx - c.w * ry) * tx + (c.vy + c.w * rx) * ty;
        const rt = rx * ty - ry * tx,
          kt = 1 / s.massC + (rt * rt) / s.inertiaC;
        let jt = -vt / kt;
        const lim = 0.5 * jn;
        if (jt > lim) jt = lim;
        else if (jt < -lim) jt = -lim;
        c.vx += (jt * tx) / s.massC;
        c.vy += (jt * ty) / s.massC;
        c.w += (rt * jt) / s.inertiaC;
      }
    }
  }

  headHit(T: Terrain) {
    const s = this.s;
    for (const [lx, ly, r] of [s.head, s.torso]) {
      const [hx, hy] = this.toWorld(lx, ly);
      for (const i of T.near(hx)) {
        const g = T.group[i];
        if (g && this.disabledGroups.has(g)) continue;
        const ax = T.ax[i],
          ay = T.ay[i],
          ex = T.bx[i] - ax,
          ey = T.by[i] - ay;
        let t = ((hx - ax) * ex + (hy - ay) * ey) / (ex * ex + ey * ey);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = hx - (ax + ex * t),
          dy = hy - (ay + ey * t);
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  // loop halves: the second half switches on once the bike is over the top, and back after the exit
  updateLoops() {
    if (this.sim.level.ghosts) this.updateGhosts();
    const L = this.sim.level.loops;
    for (let k = 0; k < L.length; k++) {
      const lp = L[k],
        c = this.c,
        st = this.loopState[k];
      if (st === 0 && c.y > lp.cy + lp.r * 0.4 && c.x < lp.cx && c.x > lp.cx - lp.r) {
        this.loopState[k] = 1;
        this.disabledGroups.add(lp.gA);
        this.disabledGroups.delete(lp.gB);
      } else if (st === 1 && (c.x > lp.cx + lp.r + 2.5 || c.x < lp.cx - lp.r - 6)) {
        this.loopState[k] = 0;
        this.disabledGroups.delete(lp.gA);
        this.disabledGroups.add(lp.gB);
      }
    }
  }

  // Levels from the editor can cross themselves: a loop made of a 3/4 loop and a quarter loop comes back down
  // onto the track it started from. Where two stretches far apart along the track come close, each is solid only
  // while the bike is nearer to it along the track (level.ghosts, made by BikeRacePieces.buildCustomLevel), so the
  // way out of a loop never blocks the way in. pathS follows the segments the wheels touch.
  updateGhosts() {
    const G = this.sim.level.ghosts,
      T = this.sim.level.terrain;
    if (!G) return;
    let sum = 0,
      n = 0;
    for (const W of this.wheels)
      if (W.age < 0.005 && W.seg != null && T.s[W.seg] === T.s[W.seg]) {
        sum += T.s[W.seg];
        n++;
      }
    if (n) this.pathS = sum / n;
    // the switch points are sorted, so only redo the groups when the bike moves past one
    const b = G.bounds,
      s = this.pathS;
    let lo = 0,
      hi = b.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (b[m] <= s) lo = m + 1;
      else hi = m;
    }
    if (lo === this.ghostZone) return;
    this.ghostZone = lo;
    for (const q of G.segs) {
      if (s >= q.lo && s < q.hi) this.disabledGroups.delete(q.g);
      else this.disabledGroups.add(q.g);
    }
  }

  crash(kind: CrashKind) {
    if (this.crashed || this.finished) return;
    this.crashed = true;
    this.crashAt = this.time;
    this.crashKind = kind;
    const c = this.c,
      [hx, hy] = this.toWorld(this.s.torso[0], this.s.torso[1] + 0.2);
    this.rider = {
      x: hx,
      y: hy,
      vx: c.vx * 0.8 - c.w * 0.4,
      vy: c.vy * 0.8 + 2.5,
      a: c.a,
      w: c.w + (c.vx > 0 ? -4 : 4),
      r: 0.3,
    };
    // the wheels pop off: the back one up and behind, the front one up and ahead
    this.loose = true;
    this.wheels.forEach((W, i) => {
      W.vx += i ? 1.6 : -1.2;
      W.vy += i ? 3.4 : 2.6;
      W.om += i ? -6 : 6;
    });
    this.events.push({ type: 'crash', kind });
  }
  stepRider(dt: number, T: Terrain, g: number) {
    const R = this.rider;
    if (!R) return;
    R.vy -= g * dt;
    R.x += R.vx * dt;
    R.y += R.vy * dt;
    R.a += R.w * dt;
    for (const i of T.near(R.x)) {
      if (T.group[i]) continue;
      const ax = T.ax[i],
        ay = T.ay[i],
        ex = T.bx[i] - ax,
        ey = T.by[i] - ay;
      let t = ((R.x - ax) * ex + (R.y - ay) * ey) / (ex * ex + ey * ey);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = R.x - (ax + ex * t),
        dy = R.y - (ay + ey * t),
        d2 = dx * dx + dy * dy;
      if (d2 >= R.r * R.r) continue;
      const d = Math.sqrt(d2) || 1e-6,
        nx = dx / d,
        ny = dy / d;
      R.x += nx * (R.r - d);
      R.y += ny * (R.r - d);
      const vn = R.vx * nx + R.vy * ny;
      if (vn < 0) {
        R.vx -= 1.4 * vn * nx;
        R.vy -= 1.4 * vn * ny;
        R.vx *= 0.8;
        R.vy *= 0.8;
        R.w *= 0.7;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
export class Sim {
  level: Level;
  bikes: Bike[];
  t: number;

  constructor(level: Level) {
    this.level = level;
    this.bikes = [];
    this.t = 0;
  }
  addBike(bikeId: string, opts?: BikeOptions) {
    const b = new Bike(this, bikeId, opts);
    this.bikes.push(b);
    return b;
  }
  step() {
    const h = STEP / SUBSTEPS;
    for (const b of this.bikes) {
      if (b.frozen) continue;
      for (let k = 0; k < SUBSTEPS; k++) {
        const x0 = b.c.x;
        b.step(h);
        if (b.running) b.time += h;
        if (!b.finished && !b.crashed && b.running && this.crossedFinish(b, x0)) {
          const f = (this.level.finishX - x0) / Math.max(1e-6, b.c.x - x0);
          b.finished = true;
          b.finishTime = Math.max(0, b.time - h * (1 - f));
          b.events.push({ type: 'finish', time: b.finishTime });
        }
        const cps = this.level.checkpoints;
        while (b.checkpoint < cps.length && b.c.x >= cps[b.checkpoint]) b.checkpoint++;
      }
    }
    this.t += STEP;
  }
  // Past the finish line. A level from the editor has a finish flag somewhere on its track (finishY) and may be
  // ridden leftwards (finishDir -1), so the bike has to cross the line near the flag, going the right way.
  crossedFinish(b: Bike, x0: number) {
    const L = this.level,
      x = b.c.x;
    if (L.finishY == null) return x >= L.finishX;
    const dir = L.finishDir || 1,
      y = b.c.y - L.finishY;
    return (x - L.finishX) * dir >= 0 && (x0 - L.finishX) * dir < 0 && y > -1 && y < 5;
  }
}

// ---------------------------------------------------------------------------------------------
// Computer rider: full gas, keeps the bike lined up with the ground it is on or about to land on.
export function botInput(bike: Bike, cfg: BotConfig = {}): BikeInput {
  const c = bike.c,
    T = bike.sim.level.terrain,
    g = bike.gravity;
  const kp = cfg.kp || 2.4,
    kd = cfg.kd || 0.42;
  let target = 0;
  const grounded = bike.grounded;
  if (grounded) {
    let nx = 0,
      ny = 0;
    for (const W of bike.wheels)
      if (W.age < 0.08) {
        nx += W.nx;
        ny += W.ny;
      }
    const base = Math.atan2(-nx, ny || 1);
    // look a little ahead for crests and dips
    const ahead = T.surface(c.x + 1.2 + Math.max(0, c.vx) * 0.12, c.y + 0.6);
    target = ahead && Math.abs(wrapAngle(ahead.angle - base)) < 0.9 ? base * 0.5 + ahead.angle * 0.5 : base;
  } else {
    // follow the ballistic path to where we will land
    let x = c.x,
      y = c.y,
      vy = c.vy,
      land: Surface | null = null;
    const vx = c.vx;
    for (let t = 0; t < 4; t += 0.04) {
      vy -= g * 0.04;
      x += vx * 0.04;
      y += vy * 0.04;
      const s = T.surface(x, y + 3);
      if (s && y - s.y < 1.0) {
        land = s;
        break;
      }
    }
    target = land ? land.angle : 0;
    if (land && land.kind !== 'ground' && land.kind !== 'ice') target = 0.15;
  }
  const err = wrapAngle(target - c.a);
  let lean = clamp(err * kp - c.w * kd, -1, 1);
  if (Math.abs(lean) < (cfg.dead || 0.05)) lean = 0;
  let gas = 1;
  if (grounded && err < -0.3) {
    gas = 0;
    lean = -1;
  } // nose too high: ease off and push forward
  if (cfg.maxSpeed && bike.speed > cfg.maxSpeed) gas = 0;
  return { gas, brake: 0, lean };
}

// Ghost and network poses are sampled at a fixed rate and interpolated for drawing.
export const POSE_HZ = 20;
export function encodeGhost(frames: readonly (readonly number[])[]) {
  // frames: array of [x, y, a]; stored as centimetres and milliradians, delta encoded
  const out: number[] = [];
  let px = 0,
    py = 0,
    pa = 0;
  for (const f of frames) {
    const x = Math.round(f[0] * 100),
      y = Math.round(f[1] * 100),
      a = Math.round(f[2] * 1000);
    out.push(x - px, y - py, a - pa);
    px = x;
    py = y;
    pa = a;
  }
  return out.join(',');
}
export function decodeGhost(str: string | null | undefined): GhostFrame[] {
  if (!str) return [];
  const v = str.split(',').map(Number),
    out: GhostFrame[] = [];
  let x = 0,
    y = 0,
    a = 0;
  for (let i = 0; i + 2 < v.length; i += 3) {
    x += v[i];
    y += v[i + 1];
    a += v[i + 2];
    out.push([x / 100, y / 100, a / 1000]);
  }
  return out;
}
