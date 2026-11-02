// Bike Race: menus, the play loop, ghosts, saving, sound, tilt/touch input, races against
// computer riders and live races through the race server. Exports the game for the hub: open, run in a scope while
// Bike Race is on screen, and reroute, for a new address while it is (#bike-race/CODE joins a room).
//
// Effect handles what the game does to the world around it: saved data (load and write with Schemas), listeners,
// the frame loop, timers (fibers that stop when the player leaves), the browser's promise APIs. The rules, physics,
// layout, sound synthesis and drawing are plain functions called from inside those. See "The visit" below.
import { Effect, FiberHandle, FiberSet, Predicate, Result, Schedule, Schema, type Scope } from 'effect';
import * as A from './bike-race-art';
import * as C from './bike-race-core';
import { forgiving } from './schemas';
import type {
  Bike,
  BikeEvent,
  BikeStats,
  BikeType,
  BotConfig,
  GhostFrame,
  Level,
  Pose,
  SavedGhost,
  World,
  WorldId,
} from './bike-race-core';
import * as Editor from './bike-race-editor';
import { Net } from './bike-race-net';
import type { CountdownMessage, NetEvent, RaceResult, RoomMessage, RoomSummary } from './bike-race-net';
import type { CustomLevel } from './bike-race-pieces';
import { type Game, GameHub } from './hub';
import { animate, listen, load, nextFrame, type PageServices, run, runSync, save as write } from './page';

const $ = (id: string) => document.getElementById(id)!;
const STEP = C.STEP;
const fmt = (t: number | null | undefined) => (t == null || !isFinite(t) ? '--' : t.toFixed(2));
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const ordinal = (n: number) =>
  n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const FEATURES = { garage: true, multiplayer: true };
// A flag in the address, such as ?keyboard: the name as a whole word after ? or &
const flag = (name: 'autopilot' | 'keyboard') => new RegExp(`[?&]${name}\\b`).test(location.search);
// ?autopilot lets the computer rider drive your bike (used by the browser tests)
const AUTOPILOT = flag('autopilot');
// The game is made for phones held sideways. On a computer it shows a "play on your phone" screen, unless the
// player picks "Try it with the keyboard" there, or the address has ?autopilot or ?keyboard (for testing).
let allowKeyboard = AUTOPILOT || flag('keyboard');
const isPhone = () => isTouch();
// #bike-race/CODE, an invite link: the room's four letters (in any case), or null
const INVITE = /^#bike-race\/([A-Za-z]{4})$/;
const invitedTo = (hash: string) => INVITE.exec(hash)?.[1]!.toUpperCase() ?? null;

// ------------------------------------------------------------------------------------------------
// Types

/** A rider's look: the bike, its paint and the name on the tag */
export interface RiderLook {
  bike: string;
  paint: A.Paint;
  name: string;
}
/** Your bike in a session: the simulation's bike, and how it looks */
export type Rider = Bike & { look: RiderLook };
export type Mode = 'solo' | 'cpu' | 'online' | 'attract';
export type Phase = 'ready' | 'countdown' | 'run' | 'crashed' | 'finished';
export type View = 'home' | 'worlds' | 'levels' | 'garage' | 'mp' | 'mylevels' | 'editor' | 'desktop' | 'play';
/** A best run loaded from localStorage */
interface Ghost {
  time: number;
  bike: string;
  frames: GhostFrame[];
}
/** What the editor gets back for a finished run on one of its levels */
export interface BestResult {
  best: number;
  newBest: boolean;
  prev: number;
}
/** A level from the editor to ride: a test ride from the editor, or one of My levels */
export interface CustomRun {
  level: CustomLevel; // from buildCustomLevel in bike-race-pieces.ts
  name: string;
  from: 'editor' | 'list';
  best: number | null;
  onFinish?: (time: number) => BestResult;
  onExit?: () => void;
}
/** The level a session plays: a built-in level, or a stand-in for one from the editor */
interface SessionDef {
  id: string;
  name: string;
  index: number;
  par: number;
  world?: WorldId;
  custom?: boolean;
}
/** A computer rider */
interface Cpu {
  bike: Bike;
  look: RiderLook;
  cfg: BotConfig;
  respawnAt: number;
}
/** Another rider in a live race: their poses as they arrive, stamped with their race clock */
interface Remote {
  buf: { t: number; p: Pose }[];
  off: number | null; // their race clock to ours (see remotePose)
  seen: number;
  look: RiderLook;
  finishTime: number | null;
  crashed: boolean;
  gone: boolean;
}
/** A line of race standings */
interface StandingRow {
  name: string;
  color: string;
  time: number | null;
  me?: boolean;
}
/** One run: the sim, your bike, the ghost and the phase */
interface Session {
  mode: Mode;
  levelId: string;
  def: SessionDef;
  world: World;
  level: Level;
  theme: A.Theme;
  sim: C.Sim;
  me: Rider;
  phase: Phase;
  paused: boolean;
  ghost: Ghost | null;
  rec: GhostFrame[];
  recNext: number;
  cpus: Cpu[];
  remote: Map<string, Remote>;
  countdown: number;
  crashTimer: number;
  finishTimer: number;
  respawnTimer: number;
  sendTimer: number;
  lastCount: number;
  results: StandingRow[] | null;
  finishedSent: boolean;
  flash: unknown[];
  cpSeen: number;
  custom: CustomRun | null;
  // set as the run goes
  restartIn?: number; // attract: start another ride after this many seconds
  subText?: string; // under the clock
  endsAt?: number; // live race: when it closes, on performance.now() / 1000
  reconnecting?: boolean;
  finishHeard?: boolean; // the server has our finish
  newBest?: boolean;
  prevBest?: number;
  customBest?: number;
  firstClear?: boolean;
  stars?: number;
  newBike?: BikeType | null; // the bike this run unlocked
}

// ------------------------------------------------------------------------------------------------
// Saved progress
const SAVE_KEY = 'bikerace.v1',
  GHOST_KEY = 'bikerace.ghost.v1.';
// bike, paint and name are the garage choices; seen lists the bikes already looked at in the garage, so a newly
// unlocked one can say "New"
interface Save {
  best: Record<string, number>;
  stars: Record<string, number>;
  bike: string;
  paint: number;
  name: string;
  seen: string[];
  ghost: boolean;
  sound: boolean;
  tilt: boolean;
  cpu: number;
  lastWorld: string;
}
const defaults = (): Save => ({
  best: {},
  stars: {},
  bike: 'scout',
  paint: 0,
  name: '',
  seen: ['scout'],
  ghost: true,
  sound: true,
  tilt: true,
  cpu: 2,
  lastWorld: 'clover',
});
const cleanName = (v: unknown) =>
  String(v || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 16);
// The save is read the way it always was, merged over the defaults: a missing field is the default, and so is one
// that doesn't fit (best times that aren't numbers, say). The paint wraps into range and the name loses control
// characters and is cut to 16; a bike that is locked or doesn't exist goes back to Scout below (that needs the stars).
const times = (v: unknown): Record<string, number> =>
  Predicate.isObject(v)
    ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => Predicate.isNumber(e[1])))
    : {};
const or =
  <A>(is: (v: unknown) => v is A, fallback: A) =>
  (v: unknown): A =>
    is(v) ? v : fallback;
// a setting kept as it was taken before: missing is the default, anything else on or off by its truthiness
const setting = (fallback: boolean) => (v: unknown) => (v === undefined ? fallback : !!v);
const SaveSchema: Schema.Codec<Save, unknown> = Schema.Struct({
  best: forgiving(Schema.Record(Schema.String, Schema.Number), times),
  stars: forgiving(Schema.Record(Schema.String, Schema.Number), times),
  bike: forgiving(Schema.String, or(Predicate.isString, 'scout')),
  paint: forgiving(Schema.Number, (v) => {
    const n = A.PAINTS.length;
    return (((Math.floor(+(v as number)) || 0) % n) + n) % n;
  }),
  name: forgiving(Schema.String, cleanName),
  seen: forgiving(Schema.mutable(Schema.Array(Schema.String)), (v) =>
    Array.isArray(v) ? v.filter(Predicate.isString) : ['scout'],
  ),
  ghost: forgiving(Schema.Boolean, setting(true)),
  sound: forgiving(Schema.Boolean, setting(true)),
  tilt: forgiving(Schema.Boolean, setting(true)),
  cpu: forgiving(Schema.Number, or(Predicate.isNumber, 2)),
  lastWorld: forgiving(Schema.String, or(Predicate.isString, 'clover')),
});
let save = runSync(load(SAVE_KEY, SaveSchema, defaults));
const persist = () => runSync(write(SAVE_KEY, SaveSchema, save));
function loadGhost(id: string): Ghost | null {
  const g = runSync(load<SavedGhost | null>(GHOST_KEY + id, C.SavedGhost, () => null));
  return g ? { time: g.time, bike: g.bike, frames: C.decodeGhost(g.f) } : null;
}
function saveGhost(id: string, time: number, frames: GhostFrame[], bike: string) {
  runSync(write(GHOST_KEY + id, C.SavedGhost, { time, bike, f: C.encodeGhost(frames) }));
}
const totalStars = () => C.LEVELS.reduce((n, L) => n + (save.stars[L.id] || 0), 0);
const worldStars = (w: World) => w.levels.reduce((n, L) => n + (save.stars[L.id] || 0), 0);
const finished = (id: string) => save.best[id] > 0;
function worldUnlocked(w: World) {
  const i = C.WORLDS.indexOf(w);
  return i <= 0 || finished(C.WORLDS[i - 1].levels[C.WORLDS[i - 1].levels.length - 1].id);
}
function levelUnlocked(L: C.LevelDef) {
  const w = C.WORLDS.find((x) => x.id === L.world)!;
  return worldUnlocked(w) && (L.index === 0 || finished(w.levels[L.index - 1].id));
}
const bikeUnlocked = (b: BikeType) => totalStars() >= b.stars;
const nextLockedBike = () => C.BIKES.find((b) => !bikeUnlocked(b)) || null;
const newBikes = () => C.BIKES.filter((b) => bikeUnlocked(b) && !save.seen.includes(b.id));
// a save from an older version, or edited by hand, could name a bike that is locked or doesn't exist
if (!C.BIKES.some((b) => b.id === save.bike) || !bikeUnlocked(C.bikeById(save.bike))) save.bike = 'scout';
const myLook = (): RiderLook => ({ bike: save.bike, paint: A.paintAt(save.paint), name: save.name || 'You' });

const builtLevels = new Map<string, Level>();
function getLevel(id: string): Level {
  if (!builtLevels.has(id)) builtLevels.set(id, C.buildLevel(C.worldOf(id)!, C.levelById(id)!));
  return builtLevels.get(id)!;
}
function nextLevelId(id: string) {
  const i = C.LEVELS.findIndex((L) => L.id === id);
  return i >= 0 && i + 1 < C.LEVELS.length ? C.LEVELS[i + 1].id : null;
}

// ------------------------------------------------------------------------------------------------
// Sound: a small WebAudio engine hum, crash, blips and a finish jingle. Muted with the HUD button.
interface Engine {
  o1: OscillatorNode;
  o2: OscillatorNode;
  f: BiquadFilterNode;
  gn: GainNode;
}
const Sound = {
  ctx: null as AudioContext | null,
  master: null as GainNode | null,
  eng: null as Engine | null,
  unlocked: false,
  init() {
    if (this.ctx) return;
    // Safari before 14.1 only has the prefixed one
    const AC =
      window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = save.sound ? 0.6 : 0;
    this.master.connect(this.ctx.destination);
  },
  // (a browser that won't resume or suspend now is no reason for an error: the next tap tries again)
  resume() {
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'running' && !document.hidden)
      run(Effect.tryPromise(() => ctx.resume()).pipe(Effect.ignore));
  },
  // iPhones start Web Audio only from inside a tap; a silent sound played then unlocks it for good
  unlock() {
    this.init();
    this.resume();
    if (!this.ctx || this.unlocked) return;
    this.unlocked = true;
    try {
      const s = this.ctx.createBufferSource();
      s.buffer = this.ctx.createBuffer(1, 1, 22050);
      s.connect(this.ctx.destination);
      s.start(0);
    } catch {}
  },
  // a page in the background must not keep humming (phones keep Web Audio running for other tabs and apps)
  suspend() {
    const ctx = this.ctx;
    if (ctx && ctx.state === 'running') run(Effect.tryPromise(() => ctx.suspend()).pipe(Effect.ignore));
  },
  setOn(on: boolean) {
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.6 : 0, this.ctx!.currentTime, 0.05);
  },
  engineOn() {
    if (!this.ctx || this.eng) return;
    const c = this.ctx,
      o1 = c.createOscillator(),
      o2 = c.createOscillator(),
      f = c.createBiquadFilter(),
      gn = c.createGain();
    o1.type = 'sawtooth';
    o2.type = 'square';
    o2.detune.value = -1200;
    f.type = 'lowpass';
    f.frequency.value = 700;
    f.Q.value = 2;
    gn.gain.value = 0;
    const g2 = c.createGain();
    g2.gain.value = 0.35;
    o1.connect(f);
    o2.connect(g2);
    g2.connect(f);
    f.connect(gn);
    gn.connect(this.master!);
    o1.start();
    o2.start();
    this.eng = { o1, o2, f, gn };
  },
  engine(rpm: number, throttle: number, on: boolean) {
    if (!this.eng) return;
    const t = this.ctx!.currentTime,
      fr = 38 + rpm * 120 + throttle * 14;
    this.eng.o1.frequency.setTargetAtTime(fr, t, 0.05);
    this.eng.o2.frequency.setTargetAtTime(fr, t, 0.05);
    this.eng.f.frequency.setTargetAtTime(500 + rpm * 900 + throttle * 500, t, 0.08);
    this.eng.gn.gain.setTargetAtTime(on ? 0.045 + throttle * 0.05 : 0, t, 0.08);
  },
  engineOff() {
    if (!this.eng) return;
    const e = this.eng;
    this.eng = null;
    e.gn.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.05);
    // the oscillators stop once the hum has faded. Leaving Bike Race is one of the ways the engine goes off, so this
    // runs on its own rather than in the visit, which is closing then.
    run(
      Effect.try(() => {
        e.o1.stop();
        e.o2.stop();
      }).pipe(Effect.delay(300), Effect.ignore),
    );
  },
  noise(dur: number, from: number, to: number, vol: number) {
    if (!this.ctx) return;
    const c = this.ctx,
      n = Math.floor(c.sampleRate * dur),
      buf = c.createBuffer(1, n, c.sampleRate),
      d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(),
      f = c.createBiquadFilter(),
      gn = c.createGain();
    s.buffer = buf;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(from, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(to, c.currentTime + dur);
    gn.gain.value = vol;
    s.connect(f);
    f.connect(gn);
    gn.connect(this.master!);
    s.start();
  },
  blip(freq: number, dur = 0.12, type: OscillatorType = 'triangle', vol = 0.18, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx,
      o = c.createOscillator(),
      gn = c.createGain(),
      t = c.currentTime + delay;
    o.type = type;
    o.frequency.value = freq;
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(vol, t + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gn);
    gn.connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  },
  crash() {
    this.noise(0.6, 2400, 120, 0.5);
    this.blip(110, 0.3, 'square', 0.12);
  },
  land(hard: number) {
    this.noise(0.12, 500, 80, 0.15 + hard * 0.25);
  },
  flip() {
    this.blip(660, 0.1);
    this.blip(990, 0.16, 'triangle', 0.18, 0.08);
  },
  count(go: boolean) {
    this.blip(go ? 880 : 440, go ? 0.35 : 0.15, 'square', 0.12);
  },
  finish() {
    [523, 659, 784, 1046].forEach((f, i) => this.blip(f, 0.22, 'triangle', 0.2, i * 0.09));
  },
  checkpoint() {
    this.blip(784, 0.1, 'triangle', 0.14);
    this.blip(1175, 0.18, 'triangle', 0.14, 0.07);
  },
  tap() {
    this.blip(520, 0.05, 'triangle', 0.08);
  },
};

// ------------------------------------------------------------------------------------------------
// Input. On a phone you lean the bike by turning the phone like a steering wheel, and hold the right half of
// the screen for gas and the left half for brake. Lean arrow buttons appear only when tilt can't be used: no
// motion sensor, motion access declined (iOS asks once, on a tap), tilt switched off in the pause menu, or a
// page that isn't https or localhost (browsers only send motion events to secure pages).
// The keyboard works too, for testing on a computer.
type Control = 'gas' | 'brake' | 'back' | 'fwd';
const keys = new Set<string>();
const touchCtl: Record<Control, boolean> = { gas: false, brake: false, back: false, fwd: false };
const KEYMAP: Record<string, Control> = {
  ArrowUp: 'gas',
  KeyW: 'gas',
  Space: 'gas',
  ArrowDown: 'brake',
  KeyS: 'brake',
  ArrowLeft: 'back',
  KeyA: 'back',
  ArrowRight: 'fwd',
  KeyD: 'fwd',
};
const TILT_FULL = 14,
  TILT_DEAD = 1.5; // degrees of turn for full lean, and the dead zone around level
const DEG = Math.PI / 180;
// state: idle (not started) | asking (iOS prompt open) | waiting (listening, no reading yet) | on | denied | nosensor | insecure
type TiltState = 'idle' | 'asking' | 'waiting' | 'on' | 'denied' | 'nosensor' | 'insecure';
// listening: the game wants motion events (each visit listens again while this is set)
const tilt = {
  state: 'idle' as TiltState,
  angle: 0,
  lean: 0,
  asked: false,
  told: '' as TiltState | '',
  listening: false,
};
// iOS asks for motion access, and only from inside a tap. Its DeviceOrientationEvent.requestPermission is not in
// the DOM types.
type AskMotion = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> };
function readInput(): C.BikeInput {
  const k = (n: Control) => [...keys].some((c) => KEYMAP[c] === n) || touchCtl[n];
  let lean = (k('back') ? 1 : 0) - (k('fwd') ? 1 : 0);
  if (!lean && useTilt()) lean = tilt.lean;
  return { gas: k('gas') ? 1 : 0, brake: k('brake') ? 1 : 0, lean: Math.max(-1, Math.min(1, lean)) };
}
const anyControl = () => {
  const i = readInput();
  return i.gas || i.brake || (i.lean && !useTilt());
};
const useTilt = () => isPhone() && save.tilt && tilt.state === 'on';
function screenAngle() {
  const a =
    screen.orientation && Predicate.isNumber(screen.orientation.angle)
      ? screen.orientation.angle
      : window.orientation || 0;
  return ((a % 360) + 360) % 360;
}
// How far the phone is turned from level, in degrees, anticlockwise positive. Works out which way is down in
// screen coordinates from the orientation angles, so it doesn't matter how far the phone is tipped back.
function tiltAngle(beta: number, gamma: number, screenDeg: number) {
  const b = beta * DEG,
    gm = gamma * DEG,
    th = screenDeg * DEG;
  const dx = Math.sin(gm) * Math.cos(b),
    dy = -Math.sin(b); // down, in phone coordinates
  const sx = dx * Math.cos(th) - dy * Math.sin(th),
    sy = dx * Math.sin(th) + dy * Math.cos(th); // down, on screen
  if (Math.hypot(sx, sy) < 0.25) return null; // lying flat: no clear answer
  return Math.atan2(-sx, -sy) / DEG;
}
function onOrientation(e: DeviceOrientationEvent) {
  if (e.beta == null || e.gamma == null) return;
  const a = tiltAngle(e.beta, e.gamma, screenAngle());
  if (tilt.state === 'waiting' || tilt.state === 'nosensor') {
    tilt.state = 'on'; // (the wait below then finds it on, and leaves it)
    refreshControls();
  } // a slow sensor can still switch tilt on
  if (a == null) return;
  tilt.angle = a;
  const m = Math.max(0, Math.abs(a) - TILT_DEAD) / (TILT_FULL - TILT_DEAD);
  tilt.lean = Math.sign(a) * Math.min(1, m); // turning the phone anticlockwise leans the bike back (anticlockwise)
}
function listenTilt() {
  tilt.listening = true;
  watchOrientation();
  if (tilt.state !== 'on') {
    tilt.state = 'waiting';
    waitForTilt();
  }
}
// Motion events for as long as the visit lasts, once a visit
function watchOrientation() {
  if (!visit || visit.orientation) return;
  visit.orientation = true;
  visit.fork(Effect.scoped(Effect.andThen(listen(window, 'deviceorientation', onOrientation), Effect.never)));
}
// No reading within 1.5 s means no sensor (a new wait replaces the last)
function waitForTilt() {
  if (!visit) return; // (open waits again on the next visit)
  replace(
    visit.tiltWait,
    Effect.sync(() => {
      if (tilt.state === 'waiting') {
        tilt.state = 'nosensor';
        refreshControls();
      }
    }).pipe(Effect.delay(1500)),
  );
}
// Call from a tap or click: iOS shows its motion permission prompt only from inside one.
function startTilt() {
  if (!isPhone() || !save.tilt || ['on', 'waiting', 'asking', 'denied'].includes(tilt.state)) return;
  if (!window.isSecureContext) {
    tilt.state = 'insecure';
    refreshControls();
    return;
  }
  if (typeof DeviceOrientationEvent === 'undefined') {
    tilt.state = 'nosensor';
    refreshControls();
    return;
  }
  const ask = (DeviceOrientationEvent as AskMotion).requestPermission;
  if (Predicate.isFunction(ask)) {
    if (tilt.asked) return;
    tilt.asked = true;
    tilt.state = 'asking';
    // iOS asks once a page, so the answer counts even if the player has left Bike Race by the time it comes: this
    // runs on its own, not in the visit. (run starts it at once, still inside the tap.)
    run(
      Effect.tryPromise(() => ask.call(DeviceOrientationEvent)).pipe(
        Effect.match({
          onFailure: () => (tilt.state = 'denied'),
          onSuccess: (r) => (r === 'granted' ? listenTilt() : (tilt.state = 'denied')),
        }),
        Effect.andThen(Effect.sync(refreshControls)),
      ),
    );
  } else listenTilt();
  refreshControls();
}
// why tilt is off, under the switch in the pause menu
const TILT_WHY: Partial<Record<TiltState, string>> = {
  denied: 'Motion access is off for this site',
  insecure: 'Needs an https address',
  nosensor: 'No tilt sensor found',
};
function syncTiltWhy() {
  if (ui.pTiltWhy) ui.pTiltWhy.textContent = save.tilt && isPhone() ? TILT_WHY[tilt.state] || '' : '';
}
function setTilt(on: boolean) {
  save.tilt = on;
  persist();
  if (on) startTilt();
  refreshControls();
  syncToggles();
}
// Picks the touch layout: two big halves (tilt) or the four buttons (no tilt), and says once why tilt is off.
const TILT_TOLD: Partial<Record<TiltState, string>> = {
  denied: 'Motion access is off, so lean with the arrows. To tilt, allow motion for this site and reload.',
  insecure: 'Tilt needs an https address. Lean with the arrows for now.',
  nosensor: 'No tilt sensor found. Lean with the arrows.',
};
function refreshControls() {
  if (!ui.touch) return;
  const tiltOn = useTilt() || (save.tilt && ['waiting', 'asking'].includes(tilt.state));
  ui.touch.classList.toggle('tilt', tiltOn);
  ui.touch.classList.toggle('buttons', !tiltOn);
  app.classList.toggle('tilt-on', tiltOn);
  syncTiltWhy();
  if (!isPhone() || !save.tilt || tilt.told === tilt.state || view !== 'play') return;
  const why = TILT_TOLD[tilt.state];
  if (why) {
    tilt.told = tilt.state;
    ui.tipbar.hidden = true;
    toast(why, 4200, 'small');
  }
}

// ------------------------------------------------------------------------------------------------
// Canvas, camera and the main loop
let app: HTMLElement,
  canvas: HTMLCanvasElement,
  g: CanvasRenderingContext2D,
  dpr = 1;
const cam = new A.Camera();
const particles = new A.Particles();
let last = 0, // the last frame's time stamp (ms)
  acc = 0,
  clockT = 0;
let view: View = 'home'; // home | worlds | levels | garage | mp | mylevels | editor | desktop | play
let S: Session | null = null; // the session being played
let attract: Session | null = null; // the computer rider behind the menus
let started = false; // the page's elements have been found (on the first visit)

// The visit: Bike Race on screen. The hub runs `open` (at the end of this file) in a scope when the player arrives
// and closes it when they leave, which removes the listeners and stops the frame loop and every timer started in
// it. Plain game code starts its timers through `visit`, which is null while the game is closed: nothing needs one
// then, as no listener, frame or race message reaches the game.
interface Visit {
  /** Runs an effect in a fiber that stops when the player leaves */
  readonly fork: (effect: Effect.Effect<void, never, PageServices>) => unknown;
  /** Timers that replace the one before: the toast's, the tilt wait and the lobby's refresh */
  readonly toast: FiberHandle.FiberHandle<void, never>;
  readonly tiltWait: FiberHandle.FiberHandle<void, never>;
  readonly lobby: FiberHandle.FiberHandle<void, never>;
  /** Motion events are coming in to onOrientation */
  orientation: boolean;
}
let visit: Visit | null = null;
/** Runs effect in handle h, in place of whatever ran there */
const replace = (h: FiberHandle.FiberHandle<void, never>, effect: Effect.Effect<void>) =>
  void run(FiberHandle.run(h, effect));
/** fn after ms, unless the player has left Bike Race by then */
const later = (ms: number, fn: () => void) => visit?.fork(Effect.sync(fn).pipe(Effect.delay(ms)));
/** fn on the next frame, once the page has laid out what was just added (to draw on a new canvas, say) */
const afterFrame = (fn: () => void) => visit?.fork(Effect.map(nextFrame, () => fn()));

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = app.clientWidth || window.innerWidth,
    h = app.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  cam.W = w;
  cam.H = h;
}
function basePpm() {
  return Math.max(16, Math.min(72, Math.min(cam.H / 11.5, cam.W / 17)));
}

// One frame, from animate (in open). The game keeps its own clock from the frame's time stamp: a frame counts for up
// to 0.1 s (animate's own step stops at 0.05), and resume() restarts it after a pause.
function frame(now: number) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  clockT += dt;
  // the level editor draws its own scene (bike-race-editor.ts)
  if (view === 'editor') {
    Editor.frame(g, dpr, dt, clockT);
    Sound.engine(0, 0, false);
    return;
  }
  const sess = view === 'play' ? S : attract;
  if (sess) {
    if (!sess.paused) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 24) {
        update(sess);
        acc -= STEP;
        n++;
      }
      if (n >= 24) acc = 0;
      particles.step(dt, sess.level.gravity);
      sessionTimers(sess, dt);
    }
    followCamera(sess, dt);
    draw(sess);
  }
  if (view === 'garage') drawStage(dt);
  if (view === 'play' && S) hud();
  else Sound.engine(0, 0, false);
}

function followCamera(sess: Session, dt: number, snap?: boolean) {
  const b = sess.me,
    c = b.c;
  const lead = Math.max(-2, Math.min(5, c.vx * 0.3));
  // high over the ground (a big jump or a drop), pull back and frame the landing too
  const below = sess.level.terrain.surface(c.x + lead * 0.6, c.y);
  const high = below ? Math.max(0, Math.min(9, c.y - below.y - 2.2)) : 0;
  const ppmT =
    basePpm() *
    (1 / (1 + 0.18 * Math.min(1, b.airborne / 0.8) + 0.045 * high) - Math.min(0.12, Math.max(0, c.vx - 8) * 0.012));
  const k = snap ? 1 : 1 - Math.exp(-dt * 2.2);
  cam.ppm += (ppmT - cam.ppm) * k;
  const tx = c.x + lead + (cam.W * 0.1) / cam.ppm,
    ty = c.y + 1.2 - high * 0.55 + Math.max(-1.5, Math.min(1.5, c.vy * 0.08));
  const kx = snap ? 1 : 1 - Math.exp(-dt * 7),
    ky = snap ? 1 : 1 - Math.exp(-dt * 4);
  cam.x += (tx - cam.x) * kx;
  cam.y += (ty - cam.y) * ky;
}

// ------------------------------------------------------------------------------------------------
// Sessions
// opts.custom: a level from the editor (see CustomRun). It plays in Clover Hills' colours, without stars, par or a
// ghost.
function makeSession(mode: Mode, levelId: string, opts: { custom?: CustomRun } = {}): Session {
  const cu = opts.custom || null;
  const def: SessionDef = cu ? { id: 'custom', name: cu.name, index: 0, par: 0, custom: true } : C.levelById(levelId)!;
  const world = cu ? C.WORLDS[0] : C.worldOf(levelId)!,
    level = cu ? cu.level : getLevel(levelId);
  const sim = new C.Sim(level);
  const look = mode === 'attract' ? { bike: save.bike, paint: A.paintAt(save.paint), name: '' } : myLook();
  const me: Rider = Object.assign(sim.addBike(look.bike, { id: 'me' }), { look });
  const sess: Session = {
    mode,
    levelId,
    def,
    world,
    level,
    theme: A.THEMES[world.id],
    sim,
    me,
    phase: mode === 'attract' ? 'run' : 'ready',
    paused: false,
    ghost: null,
    rec: [],
    recNext: 0,
    cpus: [],
    remote: new Map(),
    countdown: 0,
    crashTimer: 0,
    finishTimer: 0,
    respawnTimer: 0,
    sendTimer: 0,
    lastCount: -1,
    results: null,
    finishedSent: false,
    flash: [],
    cpSeen: 0,
    custom: cu,
  };
  if (mode === 'attract') me.running = true;
  if (mode === 'solo' && save.ghost && !cu) sess.ghost = loadGhost(levelId);
  return sess;
}

function update(sess: Session) {
  const me = sess.me;
  if (sess.mode === 'attract') me.input = C.botInput(me);
  else if (sess.phase === 'run' && !me.crashed && !me.finished) me.input = AUTOPILOT ? C.botInput(me) : readInput();
  else me.input = { gas: 0, brake: 0, lean: 0 };
  if (sess.mode === 'solo' && sess.phase === 'ready' && (anyControl() || AUTOPILOT) && !anyModalOpen())
    startClock(sess);
  for (const cpu of sess.cpus)
    cpu.bike.input = sess.phase === 'run' ? C.botInput(cpu.bike, cpu.cfg) : { gas: 0, brake: 0, lean: 0 };
  sess.sim.step();
  // ghost recording while the clock runs
  if (me.running && !me.finished && !me.crashed && sess.mode === 'solo') {
    while (me.time >= sess.recNext) {
      sess.rec.push([me.c.x, me.c.y, me.c.a]);
      sess.recNext += 1 / C.POSE_HZ;
    }
  }
  // dust from the rear wheel
  const R = me.wheels[0];
  if (R.contact && me.input.gas && me.speed > 1.5 && Math.random() < 0.25 && sess.mode !== 'attract') {
    particles.dust(R.x - 0.3, R.y - 0.25, -1 - Math.random(), 0.5, dustColor(sess), 1);
  }
  for (const e of me.events) onEvent(sess, me, e);
  me.events.length = 0;
  if (me.checkpoint > sess.cpSeen) {
    sess.cpSeen = me.checkpoint;
    if ((sess.mode === 'cpu' || sess.mode === 'online') && !me.crashed) {
      Sound.checkpoint();
      particles.burst(
        sess.level.checkpoints[me.checkpoint - 1],
        me.c.y + 1.6,
        ['#43b05c', '#ffffff', '#ffd43b'],
        12,
        4,
        'star',
      );
    }
  }
  for (const cpu of sess.cpus) {
    for (const e of cpu.bike.events) if (e.type === 'crash') cpu.respawnAt = 1.2;
    cpu.bike.events.length = 0;
  }
}
const DUST: Record<WorldId, string> = {
  clover: '#c8a27a',
  ember: '#e8b48c',
  frost: '#ffffff',
  moon: '#d8d6ea',
  magma: '#8a6a66',
};
function dustColor(sess: Session) {
  return DUST[sess.world.id];
}

function onEvent(sess: Session, me: Rider, e: BikeEvent) {
  if (sess.mode === 'attract') {
    if (e.type === 'crash' || e.type === 'finish') sess.restartIn = e.type === 'crash' ? 1.5 : 2.5;
    return;
  }
  if (e.type === 'flip') {
    toast(`${e.n > 1 ? e.n + 'x ' : ''}${e.back ? 'Backflip' : 'Frontflip'}!`);
    Sound.flip();
    particles.burst(me.c.x, me.c.y + 1, ['#ffd43b', '#fff3b0'], 10, 4, 'star');
  } else if (e.type === 'land') {
    Sound.land(e.hard);
    for (const W of me.wheels)
      particles.dust(W.x, W.y - 0.3, me.c.vx * 0.2, 0.6, dustColor(sess), 3 + Math.round(e.hard * 5), 0.22);
  } else if (e.type === 'crash') {
    Sound.crash();
    const [hx, hy] = me.toWorld(0.1, 1.0);
    particles.burst(
      hx,
      hy,
      e.kind === 'lava' ? ['#ff8a2c', '#ffd23f', '#c4321d'] : ['#ffd43b', '#ffffff'],
      14,
      5,
      'star',
    );
    particles.dust(me.c.x, me.c.y, 0, 1, e.kind === 'lava' ? '#5b4140' : dustColor(sess), 10, 0.35);
    if (sess.mode === 'solo') {
      sess.phase = 'crashed';
      sess.crashTimer = 1.1;
    } else sess.respawnTimer = 1.2;
  } else if (e.type === 'finish') {
    Sound.finish();
    particles.burst(
      sess.level.finishX,
      me.c.y + 3,
      ['#e8463c', '#ffd43b', '#43b05c', '#3a7bd5', '#ec6fa4', '#ffffff'],
      70,
      9,
    );
    if (sess.mode === 'solo') soloFinished(sess);
    else if (sess.mode === 'cpu') {
      sess.finishTimer = 1.3;
      center(`${ordinal(cpuPlace(sess))}!`, 'big');
    } else if (sess.mode === 'online') {
      if (!sess.finishedSent) {
        Net.send({ t: 'finish', time: me.finishTime });
        sess.finishedSent = true;
      } // resent after a reconnect until the server echoes it
      center(`${fmt(me.finishTime)}s`, 'big');
      later(1600, () => {
        if (S === sess && !sess.results) center('Waiting for the others…', 'small');
      });
    }
  }
}

// timers that run once per frame
function sessionTimers(sess: Session, dt: number) {
  if (sess.mode === 'attract') {
    if (sess.restartIn != null && (sess.restartIn -= dt) <= 0) newAttract(true);
    return;
  }
  const me = sess.me;
  if (sess.phase === 'countdown') {
    sess.countdown -= dt;
    const n = Math.ceil(sess.countdown);
    if (n !== sess.lastCount) {
      sess.lastCount = n;
      if (n > 0) {
        center(String(n), 'count');
        Sound.count(false);
      } else {
        center('GO!', 'count go');
        Sound.count(true);
        startClock(sess);
        later(700, () => {
          if (S === sess) center('');
        });
      }
    }
  }
  if (sess.crashTimer > 0 && (sess.crashTimer -= dt) <= 0) showCrash();
  if (sess.finishTimer > 0 && (sess.finishTimer -= dt) <= 0) {
    if (sess.mode === 'solo') showResult(sess);
    else if (sess.mode === 'cpu') showCpuResults(sess);
  }
  if (sess.respawnTimer > 0 && (sess.respawnTimer -= dt) <= 0) {
    const cp = me.checkpoint > 0 ? sess.level.checkpoints[me.checkpoint - 1] : 0;
    me.respawn(cp);
  }
  for (const cpu of sess.cpus)
    if (cpu.respawnAt > 0 && (cpu.respawnAt -= dt) <= 0) {
      const b = cpu.bike;
      b.respawn(b.checkpoint > 0 ? sess.level.checkpoints[b.checkpoint - 1] : 0);
    }
  if (sess.mode === 'online' && me.running) {
    sess.sendTimer -= dt;
    if (sess.sendTimer <= 0) {
      sess.sendTimer = 1 / C.POSE_HZ;
      const p = me.pose();
      Net.send({
        t: 'state',
        p: [+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(3), +p[3].toFixed(2), +p[4].toFixed(2), p[5]],
        c: +me.time.toFixed(3),
      });
    }
  }
}

function startClock(sess: Session) {
  sess.phase = 'run';
  sess.me.running = true;
  for (const cpu of sess.cpus) cpu.bike.running = true;
  if (sess.mode === 'solo') center('');
  Sound.init();
  Sound.resume();
  Sound.engineOn();
}

// ------------------------------------------------------------------------------------------------
// Drawing
function draw(sess: Session) {
  const theme = sess.theme,
    t = clockT;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  A.drawSky(g, cam, theme, t);
  A.drawLayers(g, cam, theme, t);
  A.drawLoops(g, cam, sess.level, theme);
  A.drawTerrain(g, cam, sess.level, theme);
  A.drawMarkers(g, cam, sess.level, t, sess.mode === 'online' || sess.mode === 'cpu');
  // ghost of the best run
  if (sess.ghost && sess.ghost.frames.length) {
    const f = ghostPose(sess.ghost.frames, sess.me.running ? sess.me.time : 0);
    A.drawBike(g, cam, f, { bike: sess.ghost.bike, paint: GHOST_PAINT }, { alpha: 0.38, ghost: true });
  }
  // computer riders and other players
  for (const cpu of sess.cpus) drawSimBike(cpu.bike, cpu.look, 0.85);
  const now = performance.now() / 1000,
    poses: [RemotePose, Remote][] = [];
  for (const [, r] of sess.remote) {
    if (r.gone) continue;
    const p = remotePose(r, now);
    if (!p) continue;
    // a crashed rider's bike lies there riderless until they are back at a checkpoint; a quiet one fades
    const quiet = now - r.seen > 3;
    A.drawBike(g, cam, p.crashed ? { ...p, noRider: true } : p, r.look, { alpha: p.crashed || quiet ? 0.45 : 0.85 });
    if (!p.crashed) poses.push([p, r]);
  }
  drawSimBike(sess.me, sess.me.look, 1);
  A.drawHazards(g, cam, sess.level, t);
  particles.draw(g, cam);
  // name tags
  if (sess.mode === 'cpu' || sess.mode === 'online') {
    for (const cpu of sess.cpus)
      if (!cpu.bike.crashed) A.drawTag(g, cam, cpu.bike.c.x, cpu.bike.c.y, cpu.look.name, cpu.look.paint.body);
    for (const [p, r] of poses) A.drawTag(g, cam, p.x, p.y, r.look.name, r.look.paint.body);
  }
}
const GHOST_PAINT: A.Paint = { body: '#ffffff', dark: '#d9d4e4', suit: '#e8e3f2', helmet: '#ffffff' };
function drawSimBike(b: Bike, look: RiderLook, alpha: number) {
  const pose: A.BikePose = {
    x: b.c.x,
    y: b.c.y,
    a: b.c.a,
    lean: b.leanVis,
    wheels: b.wheels.map((W): A.WheelPose => [W.x, W.y, W.phi]),
    noRider: !!b.rider,
    loose: b.loose,
  };
  A.drawBike(g, cam, pose, look, { alpha });
  if (b.loose) for (const W of b.wheels) A.drawWheel(g, cam, W.x, W.y, W.phi, look, alpha);
  if (b.rider) A.drawRagdoll(g, cam, b.rider, look.paint);
}
function ghostPose(frames: GhostFrame[], t: number): A.BikePose {
  const f = t * C.POSE_HZ,
    i = Math.max(0, Math.min(frames.length - 1, Math.floor(f))),
    j = Math.min(frames.length - 1, i + 1),
    k = Math.max(0, Math.min(1, f - i));
  const a = frames[i],
    b = frames[j];
  const x = a[0] + (b[0] - a[0]) * k;
  return { x, y: a[1] + (b[1] - a[1]) * k, a: a[2] + C.wrapAngle(b[2] - a[2]) * k, phi: -x / C.BASE.radius, lean: 0 };
}
// Another rider's pose a moment ago. Poses carry the sender's race clock, which r.off maps onto ours, and are drawn
// REMOTE_LAG behind so there is nearly always a newer one to blend towards.
const REMOTE_LAG = 0.1;
interface RemotePose {
  x: number;
  y: number;
  a: number;
  phi: number;
  lean: number;
  crashed: boolean;
  finished: boolean;
}
function remotePose(r: Remote, now: number): RemotePose | null {
  const buf = r.buf;
  if (!buf.length) return null;
  const t = now - REMOTE_LAG - (r.off == null ? 0 : r.off);
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1].t > t) i--;
  const b = buf[i],
    a = buf[Math.max(0, i - 1)];
  const span = b.t - a.t,
    k = span > 0 ? Math.max(0, Math.min(1, (t - a.t) / span)) : 1;
  const P = a.p,
    Q = b.p;
  return {
    x: P[0] + (Q[0] - P[0]) * k,
    y: P[1] + (Q[1] - P[1]) * k,
    a: P[2] + C.wrapAngle(Q[2] - P[2]) * k,
    phi: P[3] + (Q[3] - P[3]) * k,
    lean: Q[4],
    crashed: !!(Q[5] & 1),
    finished: !!(Q[5] & 2),
  };
}

// ------------------------------------------------------------------------------------------------
// HUD
let hudCache: Record<string, string> = {};
function setText(el: HTMLElement, key: string, text: string) {
  if (hudCache[key] !== text) {
    hudCache[key] = text;
    el.textContent = text;
  }
}
function hud() {
  const s = S!,
    me = s.me;
  const t = me.finished ? me.finishTime : me.time;
  setText(ui.time, 'time', fmt(t));
  const left = s.endsAt && !me.finished ? Math.max(0, Math.ceil(s.endsAt - performance.now() / 1000)) : -1;
  setText(ui.sub, 'sub', left >= 0 ? `Race ends in ${left}s` : s.subText || '');
  ui.sub.classList.toggle('hurry', left >= 0);
  // show the two touch halves until the race is under way
  const waiting = s.phase === 'ready' || s.phase === 'countdown';
  if (ui.touch.classList.contains('ready') !== waiting) ui.touch.classList.toggle('ready', waiting);
  // progress dots
  const L = s.level.finishX,
    pct = (x: number) => Math.max(0, Math.min(100, (x / L) * 100)).toFixed(1) + '%';
  // an editor track can go any way, so its progress is the distance along the track
  ui.dotMe.style.left = s.custom
    ? Math.max(0, Math.min(100, (me.pathS / s.custom.level.finishS) * 100)).toFixed(1) + '%'
    : pct(me.c.x);
  if (s.ghost && s.ghost.frames.length) {
    ui.dotGhost.hidden = false;
    ui.dotGhost.style.left = pct(ghostPose(s.ghost.frames, me.running ? me.time : 0).x);
  } else ui.dotGhost.hidden = true;
  const others: { x: number; color: string; fin: boolean; ft: number | null }[] = [];
  for (const cpu of s.cpus)
    others.push({ x: cpu.bike.c.x, color: cpu.look.paint.body, fin: cpu.bike.finished, ft: cpu.bike.finishTime });
  const now = performance.now() / 1000;
  for (const [, r] of s.remote) {
    const p = !r.gone && remotePose(r, now);
    if (p) others.push({ x: p.x, color: r.look.paint.body, fin: r.finishTime != null, ft: r.finishTime });
  }
  while (ui.dotsOthers.children.length < others.length) {
    const d = document.createElement('span');
    d.className = 'br-dot';
    ui.dotsOthers.appendChild(d);
  }
  while (ui.dotsOthers.children.length > others.length) ui.dotsOthers.lastChild!.remove();
  others.forEach((o, i) => {
    const d = ui.dotsOthers.children[i] as HTMLElement;
    d.style.left = pct(o.x);
    d.style.background = o.color;
  });
  if (s.mode === 'cpu' || s.mode === 'online') {
    const all: { x: number; fin: boolean; ft: number | null; me?: boolean }[] = [
      { x: me.c.x, fin: me.finished, ft: me.finishTime, me: true },
      ...others,
    ];
    all.sort((a, b) => (a.fin && b.fin ? a.ft! - b.ft! : a.fin ? -1 : b.fin ? 1 : b.x - a.x));
    setText(ui.pos, 'pos', `${ordinal(all.findIndex((a) => a.me) + 1)} / ${all.length}`);
  }
  // engine sound follows the rear wheel
  const R = me.wheels[0];
  Sound.engine(
    Math.min(1, Math.abs(R.om) / me.s.maxSpin),
    me.input.gas,
    me.running && !me.crashed && !me.finished && !s.paused,
  );
}
function toast(text: string, ms = 1800, cls = '') {
  ui.toast.textContent = text;
  ui.toast.className = 'br-toast outlined' + (cls ? ' ' + cls : '');
  ui.toast.style.animationDuration = ms + 'ms';
  void ui.toast.offsetWidth;
  ui.toast.classList.add('show');
  if (visit) replace(visit.toast, Effect.sync(() => ui.toast.classList.remove('show')).pipe(Effect.delay(ms)));
}
function center(text: string, cls = '', tip = '') {
  ui.tipbar.textContent = tip;
  ui.tipbar.hidden = !tip;
  ui.center.className = 'br-center outlined ' + cls;
  ui.center.innerHTML = text;
  if (cls.includes('count')) {
    void ui.center.offsetWidth;
    ui.center.classList.add('pop');
  }
}

// ------------------------------------------------------------------------------------------------
// Single player
function startSolo(levelId: string) {
  closeModals();
  S = makeSession('solo', levelId);
  save.lastWorld = S.world.id;
  persist();
  enterPlay();
  const best = save.best[levelId];
  const how = isPhone() ? 'Hold <b>GAS</b> to start' : 'Press <b>↑</b> to start';
  const tip =
    isPhone() &&
    save.tilt &&
    tilt.state !== 'denied' &&
    tilt.state !== 'insecure' &&
    tilt.state !== 'nosensor' &&
    Object.keys(save.best).length < 3
      ? 'Turn your phone like a steering wheel to lean the bike.'
      : '';
  center(
    `<span class="br-lvl">${esc(S.world.name)} ${S.def.index + 1} · ${esc(S.def.name)}</span>${how}${best ? `<span class="br-best">Best ${fmt(best)}s</span>` : ''}`,
    'ready',
    tip,
  );
  S.subText = `${S.world.name} ${S.def.index + 1}`;
}
// a level from the editor: a test ride from the editor, or one of My levels
function startCustom(cu: CustomRun) {
  closeModals();
  S = makeSession('solo', 'custom', { custom: cu });
  enterPlay();
  const how = isPhone() ? 'Hold <b>GAS</b> to start' : 'Press <b>↑</b> to start';
  center(
    `<span class="br-lvl">${esc(cu.from === 'editor' ? 'Test ride · ' + cu.name : cu.name)}</span>${how}${cu.best ? `<span class="br-best">Best ${fmt(cu.best)}s</span>` : ''}`,
    'ready',
  );
  S.subText = cu.name;
}
const backLabel = (sess: Session | null) =>
  sess && sess.custom ? (sess.custom.from === 'editor' ? 'Edit' : 'My levels') : 'Levels';
function restart() {
  if (!S) return;
  if (S.custom) startCustom(S.custom);
  else if (S.mode === 'solo') startSolo(S.levelId);
  else if (S.mode === 'cpu') startCpuRace(S.levelId, S.cpus.length);
}
function soloFinished(sess: Session) {
  if (sess.custom) {
    // the editor keeps best times for its levels
    const r: Partial<BestResult> = sess.custom.onFinish ? sess.custom.onFinish(sess.me.finishTime) : {};
    sess.newBest = !!r.newBest;
    sess.prevBest = r.prev || 0;
    sess.customBest = r.best || sess.me.finishTime;
    if (r.best) sess.custom.best = r.best;
    sess.phase = 'finished';
    sess.finishTimer = 1.2;
    return;
  }
  const id = sess.levelId,
    time = sess.me.finishTime,
    prev = save.best[id];
  const stars = C.starsFor(sess.def, time),
    prevStars = save.stars[id] || 0;
  sess.newBest = !prev || time < prev - 1e-9;
  sess.firstClear = !prev;
  sess.prevBest = prev;
  sess.stars = stars;
  const unlockedBefore = C.BIKES.filter(bikeUnlocked).length;
  if (sess.newBest) {
    save.best[id] = time;
    saveGhost(id, time, sess.rec, sess.me.type.id);
  }
  save.stars[id] = Math.max(prevStars, stars);
  persist();
  sess.newBike = C.BIKES.filter(bikeUnlocked).length > unlockedBefore ? C.BIKES.filter(bikeUnlocked).pop() : null;
  sess.phase = 'finished';
  sess.finishTimer = 1.2;
}
function showResult(sess: Session) {
  const def = sess.def,
    time = sess.me.finishTime,
    stars = sess.stars ?? 0;
  ui.result.classList.toggle('custom', !!sess.custom);
  ui.resLevels.textContent = backLabel(sess);
  if (sess.custom) {
    ui.resTitle.textContent = sess.custom.from === 'editor' ? 'Test ride done!' : 'Finished!';
    ui.resTime.textContent = fmt(time) + 's';
    ui.resBest.textContent = fmt(sess.customBest) + 's';
    ui.resNew.hidden = !sess.newBest || !sess.prevBest;
    ui.resHint.textContent = sess.custom.from === 'editor' ? 'Edit goes back to the editor.' : '';
    ui.resNext.hidden = true;
    ui.resUnlock.hidden = true;
    garageButtons();
    openModal(ui.result);
    return;
  }
  ui.resStars.forEach((el, i) => {
    el.classList.toggle('on', i < stars);
    el.style.animationDelay = 0.15 + i * 0.18 + 's';
  });
  const lastInWorld = def.index === sess.world.levels.length - 1,
    lastWorld = sess.world === C.WORLDS[C.WORLDS.length - 1];
  ui.resTitle.textContent =
    sess.firstClear && lastInWorld
      ? lastWorld
        ? 'Every world cleared!'
        : `${sess.world.name} cleared!`
      : stars === 3
        ? 'Perfect run!'
        : 'Level cleared!';
  ui.resTime.textContent = fmt(time) + 's';
  ui.resBest.textContent = fmt(save.best[def.id]) + 's';
  ui.resNew.hidden = !sess.newBest || !sess.prevBest;
  let hint =
    stars < 3
      ? `Finish under ${fmt(stars < 2 ? C.twoStarTime(def) : def.par)}s for ${stars < 2 ? 2 : 3} stars.`
      : `Under par (${fmt(def.par)}s). Nice riding.`;
  if (sess.firstClear && lastInWorld && lastWorld)
    hint = `That was the last level. ${totalStars()} of ${C.LEVELS.length * 3} stars so far: go back for the rest.`;
  ui.resHint.textContent = hint;
  garageButtons();
  renderUnlock(sess);
  const nxt = nextLevelId(def.id);
  ui.resNext.hidden = !nxt || !levelUnlocked(C.levelById(nxt)!);
  ui.resNext.textContent = nxt && C.levelById(nxt)!.world !== def.world ? 'Next world' : 'Next level';
  openModal(ui.result);
}
function showCrash() {
  if (!S || S.mode !== 'solo') return;
  const kind = S.me.crashKind;
  const air = useTilt()
    ? 'In the air, turn the phone anticlockwise if the nose drops and clockwise if it rises.'
    : isPhone()
      ? 'In the air, lean back (‹) if the nose drops and forward (›) if it rises.'
      : 'Lean back (←) in the air if the nose drops, forward (→) if it rises.';
  const tips =
    kind === 'lava' || kind === 'fall' || kind === 'pit'
      ? ['Carry more speed into the jump to clear the gap.', 'Keep the gas on as you take off, and land level.']
      : [
          air,
          'Land with both wheels at the same time for a smooth touchdown.',
          'Ease off the gas before big bumps.',
          'Lean the way the ground slopes where you will land.',
        ];
  ui.crashText.textContent = tips[Math.floor(Math.random() * tips.length)];
  ui.crashLevels.textContent = backLabel(S);
  if (S.me.crashKind === 'lava') ui.crashTitle.textContent = 'Too hot!';
  else if (S.me.crashKind === 'fall' || S.me.crashKind === 'pit') ui.crashTitle.textContent = 'Down the pit!';
  else ui.crashTitle.textContent = 'Wipeout!';
  garageButtons();
  openModal(ui.crash);
}

// ------------------------------------------------------------------------------------------------
// Races against computer riders (works without any server)
const CPU_NAMES = ['Pip', 'Rusty', 'Juno', 'Mako', 'Zed', 'Fern', 'Bolt', 'Kiko'];
function startCpuRace(levelId: string, n: number) {
  closeModals();
  S = makeSession('cpu', levelId);
  n = Math.max(1, Math.min(3, n | 0));
  const bikes = ['scout', 'hopper', 'twister', 'bulldog', 'comet'];
  const skills: BotConfig[] = [
    { maxSpeed: 13.6, kp: 2.2 },
    { maxSpeed: 14.6, kp: 2.4 },
    { maxSpeed: 15.4, kp: 2.6 },
  ];
  const names = CPU_NAMES.slice().sort(() => Math.random() - 0.5);
  for (let i = 0; i < n; i++) {
    const bike = S.sim.addBike(bikes[(i * 2 + 1) % bikes.length], { id: 'cpu' + i, x: 0 });
    const look = { bike: bike.type.id, paint: A.paintAt(save.paint + 2 + i * 2), name: names[i] };
    S.cpus.push({ bike, look, cfg: skills[(3 - n + i) % 3], respawnAt: 0 });
  }
  enterPlay();
  S.subText = `${S.world.name} ${S.def.index + 1} · ${n + 1} riders`;
  beginCountdown(S);
}
function beginCountdown(sess: Session) {
  sess.phase = 'countdown';
  sess.countdown = 3;
  sess.lastCount = -1;
}
function cpuPlace(sess: Session) {
  return 1 + sess.cpus.filter((c) => c.bike.finished && c.bike.finishTime < sess.me.finishTime).length;
}
function showCpuResults(sess: Session) {
  // let the computer riders finish in fast-forward
  for (let k = 0; k < 120 * 90 && sess.cpus.some((c) => !c.bike.finished); k++) {
    for (const cpu of sess.cpus) {
      cpu.bike.input = C.botInput(cpu.bike, cpu.cfg);
      if (cpu.bike.crashed && cpu.bike.time - cpu.bike.crashAt > 1.2)
        cpu.bike.respawn(cpu.bike.checkpoint > 0 ? sess.level.checkpoints[cpu.bike.checkpoint - 1] : 0);
    }
    sess.me.frozen = true;
    sess.sim.step();
  }
  sess.me.frozen = false;
  const rows: StandingRow[] = [
    { name: myLook().name, color: myLook().paint.body, time: sess.me.finishTime, me: true },
    ...sess.cpus.map((c) => ({
      name: c.look.name,
      color: c.look.paint.body,
      time: c.bike.finished ? c.bike.finishTime : null,
    })),
  ];
  showStandings(rows, 'cpu');
}
function showStandings(rows: StandingRow[], mode: 'cpu' | 'online') {
  rows.sort((a, b) => +(a.time == null) - +(b.time == null) || (a.time || 0) - (b.time || 0));
  const myPlace = rows.findIndex((r) => r.me) + 1;
  ui.rrTitle.textContent = myPlace === 1 ? 'You won!' : myPlace ? `${ordinal(myPlace)} place` : 'Race over';
  ui.rrList.innerHTML = standingRows(rows);
  const host = mode === 'online' && !!roomState && roomState.host === Net.id;
  ui.rrAgain.hidden = mode === 'online' && !host;
  ui.rrAgain.textContent = 'Race again';
  ui.rrRoom.textContent = mode === 'online' ? 'Back to room' : 'Change track';
  ui.rrLeave.hidden = mode !== 'online';
  ui.rrWait.hidden = !(mode === 'online' && !host);
  openModal(ui.raceResult);
  if (myPlace === 1) particles.burst(S!.me.c.x, S!.me.c.y + 2, ['#ffd43b', '#e8463c', '#43b05c', '#3a7bd5'], 50, 8);
}

// ------------------------------------------------------------------------------------------------
// Live races through the race server (server/race.ts). The server keeps the rooms and passes messages on; every
// phone runs its own bike and sends its pose 20 times a second, and draws the others from their poses.
let roomState: RoomMessage | null = null,
  roomsList: RoomSummary[] = [],
  pendingJoin: string | null = null,
  lastResults: { code: string | null; rows: StandingRow[] } | null = null;
const inRace = () => !!(S && S.mode === 'online' && view === 'play');
// Everything from the race server, and Net's own status changes. open listens while Bike Race is on screen; leaving
// closes the connection, so nothing comes while it is closed.
function onNet(m: NetEvent) {
  switch (m.t) {
    case 'status':
      if (m.status === 'online') sendProfile();
      else if (m.status === 'connecting' && Net.retrying && inRace() && !S!.reconnecting) {
        S!.reconnecting = true;
        toast('Connection lost. Reconnecting…', 3000, 'small');
      } else if (m.status === 'offline') {
        roomState = null;
        if (inRace()) lostRace('Lost the race server');
      }
      if (view === 'mp') renderMp();
      break;
    case 'welcome':
      // a fresh start on the server (it restarted, or we were away too long): the room and race are gone
      if (!m.resumed && (roomState || inRace())) {
        roomState = null;
        if (inRace()) lostRace('Lost your place in the race');
        else if (view === 'mp') toast('Lost your place in the room', 2600, 'small');
      }
      if (m.resumed && S && S.reconnecting) {
        S.reconnecting = false;
        toast('Back online', 1200, 'small');
      }
      // we crossed the line while the connection was down: tell the server now (it ignores a second one)
      if (m.resumed && inRace() && S!.me.finished && !S!.finishHeard) Net.send({ t: 'finish', time: S!.me.finishTime });
      if (pendingJoin) {
        Net.send({ t: 'join', code: pendingJoin });
        pendingJoin = null;
      } else if (!roomState) Net.send({ t: 'list' });
      if (view === 'mp') renderMp();
      break;
    case 'replaced':
      toast('Bike Race was opened in another tab', 2600, 'small');
      break;
    case 'rooms':
      roomsList = Array.isArray(m.rooms) ? m.rooms : [];
      if (view === 'mp') renderMp();
      break;
    case 'room': {
      // back from a dropped connection into a room we meant to leave
      if (view !== 'mp' && !inRace()) {
        roomState = null;
        Net.send({ t: 'leave' });
        break;
      }
      roomState = m;
      if (Array.isArray(m.last)) lastResults = { code: m.code, rows: resultRows(m.last) };
      if (S && S.mode === 'online') syncRemote(S);
      // the race ended while our connection was down, so the results never came: show the room's copy
      if (m.state === 'lobby' && inRace() && !S!.results && S!.phase !== 'countdown' && lastResults)
        showOnlineResults(lastResults.rows);
      // the server still counts us in a race we no longer have (we reloaded mid-race): give that place up
      if (m.state !== 'lobby' && (m.racers || []).includes(Net.id!) && !inRace()) Net.send({ t: 'retire' });
      if (view === 'mp') renderMp();
      break;
    }
    case 'left':
      roomState = null;
      if (view === 'mp') renderMp();
      break;
    case 'error':
      toast(m.msg || 'Something went wrong', 2600, 'small');
      if (view === 'mp') renderMp();
      break;
    case 'countdown':
      startOnlineRace(m);
      break;
    case 'state': {
      if (!S || S.mode !== 'online' || !Array.isArray(m.p)) break;
      const r = S.remote.get(m.id);
      if (!r) break;
      const now = performance.now() / 1000,
        c = Predicate.isNumber(m.c) ? m.c : null;
      // map the sender's race clock onto ours by the quickest delivery seen; slower ones only add delay. The slow
      // creep upwards follows a sender whose game stalled for a moment (a phone pausing a page in the background).
      if (c != null) r.off = r.off == null ? now - c : Math.min(now - c, r.off + 0.02);
      const t = c != null ? c : now - (r.off || 0);
      if (r.buf.length && t <= r.buf[r.buf.length - 1].t) break;
      r.buf.push({ t, p: m.p });
      if (r.buf.length > 40) r.buf.shift();
      r.seen = now;
      const crashed = !!(m.p[5] & 1);
      if (crashed && !r.crashed && view === 'play')
        particles.burst(m.p[0], m.p[1] + 1, ['#ffd43b', '#ffffff'], 10, 4, 'star');
      r.crashed = crashed;
      break;
    }
    case 'finished': {
      if (!S || S.mode !== 'online') break;
      if (m.id === Net.id) {
        S.finishHeard = true;
        break;
      }
      const r = S.remote.get(m.id);
      if (r) {
        r.finishTime = m.time;
        if (inRace()) toast(`${r.look.name} finished · ${fmt(m.time)}s`, 2000, 'small');
      }
      break;
    }
    case 'ending':
      if (S && S.mode === 'online' && Predicate.isNumber(m.seconds)) S.endsAt = performance.now() / 1000 + m.seconds;
      break;
    case 'results': {
      const rows = resultRows(m.results);
      lastResults = { code: roomState && roomState.code, rows };
      if (view === 'mp') renderMp();
      if (inRace()) showOnlineResults(rows);
      break;
    }
  }
}
const resultRows = (list: RaceResult[] | null): StandingRow[] =>
  (Array.isArray(list) ? list : []).map((r) => ({
    name: String(r.name),
    color: A.paintAt(r.paint).body,
    time: Predicate.isNumber(r.time) ? r.time : null,
    me: r.id === Net.id,
  }));
function showOnlineResults(rows: StandingRow[]) {
  const sess = S!;
  sess.results = rows;
  sess.endsAt = 0;
  later(sess.me.finished ? 700 : 0, () => {
    if (S === sess && view === 'play') {
      center('');
      closeModals();
      showStandings(
        rows.map((r) => ({ ...r })),
        'online',
      );
    }
  });
}
function sendProfile() {
  Net.send({ t: 'hello', name: (save.name || '').trim() || 'Rider', paint: save.paint, bike: save.bike, key: Net.key });
}
function lostRace(text: string) {
  const sess = S;
  toast(text, 2600, 'small');
  later(1800, () => {
    if (S === sess && view === 'play') {
      exitPlay();
      showView('mp');
    }
  });
}
function startOnlineRace(m: CountdownMessage) {
  if (!roomState || !Array.isArray(m.racers) || !m.racers.includes(Net.id!) || !C.levelById(m.level)) return;
  if (view !== 'mp' && !inRace()) return;
  closeModals();
  S = makeSession('online', m.level);
  // everyone starts on the line with us, until their own poses arrive
  const start = S.me.pose(),
    now = performance.now() / 1000;
  for (const id of m.racers)
    if (id !== Net.id)
      S.remote.set(id, {
        buf: [{ t: 0, p: start }],
        off: null,
        seen: now,
        look: { bike: 'scout', paint: A.paintAt(0), name: '?' },
        finishTime: null,
        crashed: false,
        gone: false,
      });
  syncRemote(S);
  enterPlay();
  S.subText = `${S.world.name} ${S.def.index + 1} · Room ${roomState.code}`;
  beginCountdown(S);
  S.countdown = Math.max(1, +m.seconds || 3);
}
// names, bikes and paints from the room; riders who left the room drop out of the race
function syncRemote(sess: Session) {
  if (!roomState) return;
  const here = new Set<string>();
  for (const p of roomState.players || []) {
    here.add(p.id);
    const r = sess.remote.get(p.id);
    if (r) r.look = { bike: C.bikeById(p.bike).id, paint: A.paintAt(p.paint), name: p.name };
  }
  for (const [id, r] of sess.remote) if (!here.has(id)) r.gone = true;
}
const canShare = () => isPhone() && Predicate.isFunction(navigator.share);
// The link that joins the room. A page opened on this computer as localhost would hand out a link nobody else can
// open, so when the server is reachable on the network it uses the server's network address instead.
function inviteLink() {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const base = local && Net.share ? Net.share + '/' : location.origin + location.pathname;
  return `${base}#bike-race/${roomState ? roomState.code : ''}`;
}
// Shares the invite link on a phone, or copies it. Both need the tap that asked, so the Invite button's listener
// returns this, and it starts there and then.
const invite = Effect.gen(function* () {
  if (!roomState) return;
  const link = inviteLink(),
    code = roomState.code;
  if (canShare()) {
    const shared = yield* Effect.result(
      Effect.tryPromise({
        try: () => navigator.share({ title: 'Bike Race', text: `Race me in Bike Race! Room ${code}`, url: link }),
        catch: (e) => e,
      }),
    );
    // shared, or the player closed the share sheet; any other failure copies the link instead
    if (Result.isSuccess(shared)) return;
    if (Predicate.hasProperty(shared.failure, 'name') && shared.failure.name === 'AbortError') return;
  }
  const copied = yield* Effect.result(Effect.tryPromise(() => navigator.clipboard.writeText(link)));
  if (Result.isSuccess(copied)) toast('Invite link copied', 1800, 'small');
  else prompt('Copy this link', link);
});

// ------------------------------------------------------------------------------------------------
// Menus
// the page's elements, found once by setup(); the few functions that can run before it check for them first
function findUi() {
  return {
    hud: $('br-hud'),
    time: $('br-time'),
    sub: $('br-sub'),
    pos: $('br-pos'),
    retry: $('br-retry'),
    soundBtn: $('br-sound'),
    dotMe: $('br-dot-me'),
    dotGhost: $('br-dot-ghost'),
    dotsOthers: $('br-dots'),
    center: $('br-center'),
    toast: $('br-toast'),
    touch: $('br-touch'),
    tipbar: $('br-tipbar'),
    homeStars: $('br-home-stars'),
    homeHow: $('br-home-how'),
    worldCards: $('br-world-cards'),
    worldsStars: $('br-worlds-stars'),
    levelsTitle: $('br-levels-title'),
    levelsSub: $('br-levels-sub'),
    levelsStars: $('br-levels-stars'),
    levelGrid: $('br-level-grid'),
    garage: $('br-garage'),
    bikes: $('br-bikes'),
    paints: $('br-paints'),
    name: $('br-name') as HTMLInputElement,
    garageStars: $('br-garage-stars'),
    gStage: $('br-g-stage') as HTMLCanvasElement,
    gName: $('br-g-name'),
    gPerk: $('br-g-perk'),
    gBlurb: $('br-g-blurb'),
    gStats: $('br-g-stats'),
    gStatus: $('br-g-status'),
    pause: $('br-pausemenu'),
    pauseText: $('br-pause-text'),
    pRestart: $('br-p-restart'),
    pLevels: $('br-p-levels'),
    tGhost: $('br-t-ghost'),
    tSound: $('br-t-sound'),
    pGhostRow: $('br-p-ghost-row'),
    pTilt: $('br-p-tilt'),
    pTiltRow: $('br-p-tilt-row'),
    pTiltWhy: $('br-p-tilt-why'),
    crash: $('br-crash'),
    crashTitle: $('br-crash-title'),
    crashText: $('br-crash-text'),
    crashLevels: $('br-crash-levels'),
    resLevels: $('br-res-levels'),
    result: $('br-result'),
    resStars: [...document.querySelectorAll<SVGSVGElement>('#br-result .br-rstar')],
    resTitle: $('br-res-title'),
    resTime: $('br-res-time'),
    resBest: $('br-res-best'),
    resNew: $('br-res-new'),
    resHint: $('br-res-hint'),
    resNext: $('br-res-next'),
    resUnlock: $('br-res-unlock'),
    resUnlockTitle: $('br-res-unlock-title'),
    resUnlockSub: $('br-res-unlock-sub'),
    resUnlockMeter: $('br-res-unlock-meter'),
    resGarage: $('br-res-garage'),
    raceResult: $('br-raceresult'),
    rrTitle: $('br-rr-title'),
    rrList: $('br-rr-list'),
    rrAgain: $('br-rr-again'),
    rrRoom: $('br-rr-room'),
    rrWait: $('br-rr-wait'),
    rrLeave: $('br-rr-leave'),
    mpStatus: $('br-mp-status'),
    mpStatusText: $('br-mp-status-text'),
    mpName: $('br-mp-name') as HTMLInputElement,
    mpLobby: $('br-mp-lobby'),
    mpRoom: $('br-mp-room'),
    mpOffline: $('br-mp-offline'),
    mpOfflineWhy: $('br-mp-offline-why'),
    mpCpu: $('br-mp-cpu'),
    mpNamePanel: $('br-mp-name-panel'),
    mpLevel: $('br-mp-level') as HTMLSelectElement,
    mpRooms: $('br-mp-rooms'),
    mpCode: $('br-mp-code') as HTMLInputElement,
    roomCode: $('br-room-code'),
    roomLink: $('br-room-link'),
    roomCopy: $('br-room-copy'),
    roomLevel: $('br-room-level') as HTMLSelectElement,
    roomLevelText: $('br-room-level-text'),
    roomPlayers: $('br-room-players'),
    roomStart: $('br-room-start'),
    roomNote: $('br-room-note'),
    roomLast: $('br-room-last'),
    roomLastList: $('br-room-last-list'),
    cpuLevel: $('br-cpu-level') as HTMLSelectElement,
    cpuCount: $('br-cpu-count'),
    deskUrl: $('br-desk-url'),
    roomConn: $('br-room-conn'),
  };
}
let ui = {} as ReturnType<typeof findUi>;
const VIEWS = ['home', 'worlds', 'levels', 'garage', 'mp', 'mylevels', 'editor', 'desktop'] as const;
function showView(v: View) {
  if (!isPhone() && !allowKeyboard && v !== 'play') v = 'desktop';
  view = v;
  for (const id of VIEWS) $('br-' + id).hidden = id !== v;
  ui.hud.hidden = v !== 'play';
  ui.touch.hidden = v !== 'play' || !isPhone();
  ui.center.hidden = v !== 'play';
  if (v !== 'play') {
    Sound.engineOff();
    center('');
    if (!attract) newAttract();
  }
  if (v === 'home') renderHome();
  if (v === 'desktop') ui.deskUrl.textContent = location.origin + location.pathname + '#bike-race';
  if (v === 'worlds') renderWorlds();
  if (v === 'garage') renderGarage();
  if (v === 'mylevels' || v === 'editor') Editor.onView(v);
  if (v === 'mp') {
    Net.connect();
    renderMp();
    // every 3 s while the lobby is up: the open rooms, and how this phone is connected
    const refresh = Effect.sync(() => {
      if (view === 'mp') {
        if (!roomState) Net.send({ t: 'list' });
        renderConn();
      }
    });
    if (visit) replace(visit.lobby, Effect.asVoid(Effect.schedule(refresh, Schedule.spaced('3 seconds'))));
  } else if (visit) run(FiberHandle.clear(visit.lobby));
  const scr = document.getElementById('br-' + v);
  if (scr) scr.scrollTop = 0;
}
function enterPlay() {
  hudCache = {};
  particles.list.length = 0;
  view = 'play';
  for (const id of VIEWS) $('br-' + id).hidden = true;
  ui.hud.hidden = false;
  ui.center.hidden = false;
  ui.touch.hidden = !isPhone();
  refreshControls();
  ui.pos.hidden = S!.mode === 'solo';
  ui.retry.hidden = S!.mode === 'online';
  followCamera(S!, 0, true);
  cam.ppm = basePpm();
  acc = 0;
  hud();
}
function exitPlay() {
  closeModals();
  if (S && S.mode === 'online' && roomState) {
    /* stay in the room */
  }
  S = null;
  Sound.engineOff();
}
function newAttract(random?: boolean) {
  const pool = C.LEVELS.filter(levelUnlocked);
  let L = pool.filter((l) => l.world === save.lastWorld);
  if (!L.length) L = pool;
  const pick = random ? L[Math.floor(Math.random() * L.length)] : L[0];
  attract = makeSession('attract', pick.id);
  followCamera(attract, 0, true);
  cam.ppm = basePpm();
}

const starSvg = (on: boolean) =>
  `<svg viewBox="0 0 24 24" class="${on ? 'star-on' : 'star-off'}" aria-hidden="true"><path d="M12.0 2.3 L14.9 8.8 L22.0 9.6 L16.8 14.3 L18.2 21.3 L12.0 17.8 L5.8 21.3 L7.2 14.3 L2.0 9.6 L9.1 8.8 Z"/></svg>`;
const lockSvg = `<svg viewBox="0 0 24 24" class="br-lock" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke-width="2.6"/></svg>`;

function renderHome() {
  ui.homeStars.textContent = `${totalStars()} / ${C.LEVELS.length * 3}`;
  for (const [id, on] of [
    ['br-go-mp', FEATURES.multiplayer],
    ['br-go-garage', FEATURES.garage],
  ] as const) {
    const b = $(id) as HTMLButtonElement;
    b.disabled = !on;
    b.classList.toggle('soon', !on);
  }
  const fresh = FEATURES.garage ? newBikes() : [];
  $('br-go-garage').classList.toggle('has-new', fresh.length > 0);
  $('br-go-garage').dataset.badge = fresh.length > 1 ? `${fresh.length} new bikes` : 'New bike!';
  ui.homeHow.innerHTML = isPhone()
    ? 'Hold the right side of the screen for <b>GAS</b> and the left side to <b>BRAKE</b> (keep holding to back up). Turn the phone like a steering wheel to lean the bike.'
    : 'Keyboard test mode: <b>↑</b> gas · <b>↓</b> brake, then back up · <b>←</b> lean back · <b>→</b> lean forward · <b>R</b> restart · <b>Esc</b> pause';
}
function renderWorlds() {
  ui.worldsStars.textContent = `${totalStars()} / ${C.LEVELS.length * 3}`;
  ui.worldCards.innerHTML = '';
  C.WORLDS.forEach((w, i) => {
    const open = worldUnlocked(w);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'br-world' + (open ? '' : ' locked');
    b.disabled = !open;
    b.innerHTML = `<canvas width="320" height="200"></canvas><div class="nm outlined">${esc(w.name)}</div><div class="ds">${esc(open ? w.blurb : 'Finish ' + C.WORLDS[i - 1].name + ' to unlock')}</div>
      <div class="br-wstars">${starSvg(true)}<span>${worldStars(w)} / ${w.levels.length * 3}</span></div>${open ? '' : lockSvg}`;
    ui.worldCards.appendChild(b);
    afterFrame(() =>
      A.drawThumb(b.querySelector('canvas')!, w, getLevel(w.levels[Math.min(2, w.levels.length - 1)].id)),
    );
  });
}
// a world's card was tapped (see tapped)
function pickWorld(w: World) {
  save.lastWorld = w.id;
  persist();
  renderLevels(w);
  showLevels();
}
function showLevels() {
  view = 'levels';
  for (const id of VIEWS) $('br-' + id).hidden = id !== 'levels';
  $('br-levels').scrollTop = 0;
}
let levelsWorld: World = C.WORLDS[0]; // the world whose levels are listed
function renderLevels(w: World) {
  levelsWorld = w;
  ui.levelsTitle.textContent = w.name;
  ui.levelsStars.textContent = `${worldStars(w)} / ${w.levels.length * 3}`;
  ui.levelsSub.textContent = w.blurb;
  ui.levelGrid.innerHTML = '';
  w.levels.forEach((L, i) => {
    const open = levelUnlocked(L),
      st = save.stars[L.id] || 0,
      best = save.best[L.id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card br-level' + (open ? '' : ' locked');
    b.disabled = !open;
    b.innerHTML = `<div class="lv">Level ${i + 1}</div><div class="n outlined">${i + 1}</div><div class="nm2">${esc(L.name)}</div>
      <div class="br-lstars">${[0, 1, 2].map((k) => starSvg(k < st)).join('')}</div><div class="bt">${best ? 'Best ' + fmt(best) + 's' : open ? 'Par ' + fmt(L.par) + 's' : ''}</div>${open ? '' : lockSvg}`;
    ui.levelGrid.appendChild(b);
  });
}
// The cards of the worlds and levels and the garage's bikes and paints are made again on every render, so the list
// holding them listens for taps (see open), and this finds the card tapped: its place in the list, or -1 (none, or
// switched off).
function tapped(list: HTMLElement, e: Event): number {
  let el = e.target instanceof Element ? e.target : null;
  while (el && el.parentElement !== list) el = el.parentElement;
  return el && !(el as HTMLButtonElement).disabled ? Array.prototype.indexOf.call(list.children, el) : -1;
}

// ------------------------------------------------------------------------------------------------
// Garage: pick a bike (each unlocks at a total number of stars), a paint and a rider name. Every choice is saved
// as soon as it is made. It opens from the home menu, and from the pause, crash and result sheets during a run;
// leaving it then goes back to that sheet, or restarts the level when the bike changed.
type Sheet = 'pause' | 'crash' | 'result' | 'race';
const garage = { focus: 'scout', t: 0, rev: 0, hop: 0, shake: 0, from: null as { modal: Sheet; bike: string } | null };
const STAT_NAMES: [keyof BikeStats, string][] = [
  ['speed', 'Speed'],
  ['grip', 'Grip'],
  ['spin', 'Flips'],
  ['air', 'Air'],
];
const starTiny =
  '<svg viewBox="0 0 24 24" class="star-on" aria-hidden="true"><path d="M12.0 2.3 L14.9 8.8 L22.0 9.6 L16.8 14.3 L18.2 21.3 L12.0 17.8 L5.8 21.3 L7.2 14.3 L2.0 9.6 L9.1 8.8 Z"/></svg>';

function openGarage(focus?: string | null) {
  if (!FEATURES.garage) return;
  garage.from = null;
  if (view === 'play' && S && S.mode !== 'online') {
    const sheets: [Sheet, HTMLElement][] = [
      ['pause', ui.pause],
      ['crash', ui.crash],
      ['result', ui.result],
      ['race', ui.raceResult],
    ];
    const open = sheets.find(([, m]) => !m.hidden);
    garage.from = { modal: open ? open[0] : 'pause', bike: save.bike };
    S.paused = true;
    closeModals();
  }
  garage.focus = focus || save.bike;
  garage.rev = 0;
  garage.hop = 0;
  garage.shake = 0;
  showView('garage');
}
function closeGarage() {
  const from = garage.from;
  garage.from = null;
  if (!from || !S) {
    showView('home');
    return;
  }
  // a different bike, or a run that hadn't started yet: start the level again on the bike now chosen
  if (from.modal === 'pause' && (from.bike !== save.bike || S.phase === 'ready')) {
    restart();
    return;
  }
  S.me.look = { ...myLook(), bike: S.me.type.id }; // new paint and name show straight away
  enterPlay();
  if (from.modal === 'pause') pause();
  else if (from.modal === 'crash') openModal(ui.crash);
  else if (from.modal === 'result') {
    if (!S.custom) renderUnlock(S);
    openModal(ui.result);
  } else openModal(ui.raceResult);
}
function pickBike(b: BikeType) {
  garage.focus = b.id;
  if (bikeUnlocked(b)) {
    if (!save.seen.includes(b.id)) save.seen.push(b.id);
    if (save.bike !== b.id) {
      save.bike = b.id;
      garage.rev = 1;
      Sound.blip(196, 0.18, 'sawtooth', 0.1);
      Sound.blip(294, 0.22, 'sawtooth', 0.08, 0.1);
      if (Net.status === 'online') sendProfile();
      newAttract();
    }
    persist();
  } else {
    garage.shake = 1;
    Sound.blip(160, 0.14, 'square', 0.08);
  }
  renderGarage();
}
function pickPaint(i: number) {
  save.paint = i;
  persist();
  garage.focus = save.bike;
  garage.hop = 1;
  Sound.blip(660 + i * 30, 0.08, 'triangle', 0.1);
  if (Net.status === 'online') sendProfile();
  if (attract) attract.me.look = { ...attract.me.look, paint: A.paintAt(i) };
  renderGarage();
}
function renderGarage() {
  const total = totalStars();
  ui.garageStars.textContent = `${total} / ${C.LEVELS.length * 3}`;
  if (document.activeElement !== ui.name) ui.name.value = save.name;
  ui.bikes.innerHTML = '';
  for (const b of C.BIKES) {
    const open = bikeUnlocked(b),
      riding = save.bike === b.id,
      fresh = open && !save.seen.includes(b.id);
    const el = document.createElement('button');
    el.type = 'button';
    el.className =
      'br-gbike' + (riding ? ' riding' : '') + (open ? '' : ' locked') + (garage.focus === b.id ? ' focus' : '');
    el.setAttribute('role', 'radio');
    el.setAttribute('aria-checked', String(riding));
    el.setAttribute('aria-label', open ? `${b.name}, ${b.perk}` : `${b.name}, locked until ${b.stars} stars`);
    el.innerHTML =
      `<canvas width="176" height="104"></canvas><span class="nm">${esc(b.name)}</span>` +
      `<span class="st">${riding ? 'Riding' : open ? esc(b.perk) : `${starTiny}${b.stars}`}</span>` +
      (fresh ? '<em class="br-new">New</em>' : '') +
      (open ? '' : lockSvg);
    ui.bikes.appendChild(el);
    drawBikeThumb(el.querySelector('canvas')!, b, !open);
  }
  ui.paints.innerHTML = '';
  A.PAINTS.forEach((p, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'br-paint' + (i === save.paint ? ' sel' : '');
    el.style.setProperty('--body', p.body);
    el.style.setProperty('--suit', p.suit);
    el.setAttribute('role', 'radio');
    el.setAttribute('aria-label', p.id);
    el.setAttribute('aria-checked', String(i === save.paint));
    ui.paints.appendChild(el);
  });
  // the bike on show
  const b = C.bikeById(garage.focus),
    open = bikeUnlocked(b),
    st = C.bikeStats(b);
  ui.gName.textContent = b.name;
  ui.gPerk.textContent = b.perk;
  ui.gBlurb.textContent = b.blurb;
  ui.gStats.innerHTML = STAT_NAMES.map(
    ([k, label]) => `<div><span>${label}</span><i><b style="width:${Math.round(12 + st[k] * 88)}%"></b></i></div>`,
  ).join('');
  if (save.bike === b.id) ui.gStatus.innerHTML = '<span class="br-chip go">Riding this bike</span>';
  // (its Ride button picks the bike on show: a listener in open)
  else if (open)
    ui.gStatus.innerHTML = `<button class="b go outlined br-ride" type="button">Ride ${esc(b.name)}</button>`;
  else {
    const prev = Math.max(0, ...C.BIKES.filter((x) => x.stars < b.stars).map((x) => x.stars)),
      need = b.stars - total;
    const pct = Math.max(0, Math.min(1, (total - prev) / (b.stars - prev)));
    ui.gStatus.innerHTML = `<div class="br-lockline">${lockSvg}<b>${need} more star${need === 1 ? '' : 's'}</b><span class="n">${starTiny}${total} / ${b.stars}</span></div><i class="br-meter"><b style="width:${Math.round(pct * 100)}%"></b></i>`;
  }
  ui.garage.classList.toggle('locked', !open);
}
// a still bike for the strip and the result sheet; locked bikes are a dark outline
function drawBikeThumb(cv: HTMLCanvasElement, b: BikeType, locked: boolean) {
  const gg = cv.getContext('2d')!,
    c2 = new A.Camera();
  c2.W = cv.width;
  c2.H = cv.height;
  c2.ppm = Math.min(cv.height / 2.35, cv.width / 2.3);
  c2.x = 0;
  c2.y = 0.27;
  gg.setTransform(1, 0, 0, 1, 0, 0);
  gg.clearRect(0, 0, cv.width, cv.height);
  gg.fillStyle = 'rgba(59,35,38,0.12)';
  gg.beginPath();
  gg.ellipse(cv.width / 2, c2.sy(-0.8), c2.ppm * 1.05, c2.ppm * 0.09, 0, 0, Math.PI * 2);
  gg.fill();
  drawBikeOn(gg, c2, { x: 0, y: 0, a: 0, lean: 0, phi: 0.4 }, { bike: b.id, paint: A.paintAt(save.paint) }, locked);
}
const silCanvas = document.createElement('canvas');
function drawBikeOn(gg: CanvasRenderingContext2D, c2: A.Camera, pose: A.BikePose, look: A.Look, locked: boolean) {
  if (!locked) {
    A.drawBike(gg, c2, pose, look);
    return;
  }
  const W = gg.canvas.width,
    H = gg.canvas.height;
  if (silCanvas.width !== W || silCanvas.height !== H) {
    silCanvas.width = W;
    silCanvas.height = H;
  }
  const sg = silCanvas.getContext('2d')!;
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.globalCompositeOperation = 'source-over';
  sg.clearRect(0, 0, W, H);
  sg.setTransform(gg.getTransform());
  A.drawBike(sg, c2, pose, look);
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = '#6b5559';
  sg.fillRect(0, 0, W, H);
  sg.globalCompositeOperation = 'source-over';
  gg.save();
  gg.setTransform(1, 0, 0, 1, 0, 0);
  gg.globalAlpha = 0.5;
  gg.drawImage(silCanvas, 0, 0);
  gg.restore();
}
// The showroom: the bike on a turntable with your name on it. It idles, pops a wheelie when you pick it,
// hops when you repaint it, and shakes its head when you tap a locked bike.
function drawStage(dt: number) {
  const cv = ui.gStage,
    w = cv.clientWidth,
    h = cv.clientHeight;
  if (!w || !h) return;
  const d = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) {
    cv.width = Math.round(w * d);
    cv.height = Math.round(h * d);
  }
  const gg = cv.getContext('2d')!;
  gg.setTransform(d, 0, 0, d, 0, 0);
  gg.clearRect(0, 0, w, h);
  garage.t += dt;
  garage.rev = Math.max(0, garage.rev - dt / 0.9);
  garage.hop = Math.max(0, garage.hop - dt / 0.45);
  garage.shake = Math.max(0, garage.shake - dt / 0.4);
  const b = C.bikeById(garage.focus),
    open = bikeUnlocked(b),
    t = garage.t;
  const c2 = new A.Camera();
  c2.W = w;
  c2.H = h;
  c2.ppm = Math.max(20, Math.min(h / 3.05, w / 2.75));
  c2.x = 0.02;
  c2.y = 0.1;
  // spotlight and turntable
  const cx = c2.sx(0),
    floor = c2.sy(-0.8),
    ppm = c2.ppm;
  const glowR = Math.min(ppm * 1.9, w * 0.5, h * 0.62),
    glow = gg.createRadialGradient(cx, floor - ppm * 0.9, glowR * 0.1, cx, floor - ppm * 0.9, glowR);
  glow.addColorStop(0, open ? 'rgba(255,224,130,0.55)' : 'rgba(200,190,205,0.45)');
  glow.addColorStop(1, 'rgba(255,224,130,0)');
  gg.fillStyle = glow;
  gg.fillRect(0, 0, w, h);
  const rx = ppm * 1.3,
    ry = ppm * 0.2,
    band = ppm * 0.22;
  gg.fillStyle = '#c9b8bf';
  gg.beginPath();
  gg.ellipse(cx, floor + band, rx, ry, 0, 0, Math.PI);
  gg.lineTo(cx - rx, floor);
  gg.ellipse(cx, floor, rx, ry, 0, Math.PI, 0, true);
  gg.closePath();
  gg.fill();
  gg.fillStyle = '#efe6ea';
  gg.beginPath();
  gg.ellipse(cx, floor, rx, ry, 0, 0, Math.PI * 2);
  gg.fill();
  gg.strokeStyle = 'rgba(59,35,38,0.12)';
  gg.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const a = t * 0.5 + (i * Math.PI) / 3;
    gg.beginPath();
    gg.moveTo(cx, floor);
    gg.lineTo(cx + Math.cos(a) * rx * 0.96, floor + Math.sin(a) * ry * 0.96);
    gg.stroke();
  }
  gg.fillStyle = 'rgba(59,35,38,0.16)';
  gg.beginPath();
  gg.ellipse(cx, floor, rx * 0.78, ry * 0.55, 0, 0, Math.PI * 2);
  gg.fill();
  gg.strokeStyle = '#3b2326';
  gg.lineWidth = 2.5;
  gg.beginPath();
  gg.ellipse(cx, floor, rx, ry, 0, 0, Math.PI * 2);
  gg.moveTo(cx - rx, floor);
  gg.lineTo(cx - rx, floor + band);
  gg.ellipse(cx, floor + band, rx, ry, 0, Math.PI, 0, true);
  gg.lineTo(cx + rx, floor);
  gg.stroke();
  // the rider's name on the front of the turntable
  const nm = (save.name || 'Rider').toUpperCase();
  gg.font = `${Math.round(Math.max(10, band * 0.78))}px 'Lilita One', 'Trebuchet MS', sans-serif`;
  gg.textAlign = 'center';
  gg.textBaseline = 'middle';
  gg.fillStyle = '#7c6870';
  gg.fillText(nm, cx, floor + band * 0.5 + ry * 0.92);
  // the bike: idle sway, a wheelie on the back wheel when picked, a hop when repainted
  const k = garage.rev > 0 ? Math.sin(Math.PI * (1 - garage.rev)) : 0;
  const a = 0.32 * k,
    rwx = C.BASE.anchors[0][0],
    rwy = C.BASE.anchors[0][1] - 0.04;
  const [ox, oy] = C.rot(a, rwx, rwy);
  const hop = garage.hop > 0 ? 0.16 * Math.sin(Math.PI * (1 - garage.hop)) : 0;
  const pose = {
    x: rwx - ox + Math.sin(t * 46) * 0.05 * garage.shake,
    y: rwy - oy + hop,
    a,
    lean: open ? Math.sin(t * 1.7) * 0.14 + k * 0.6 : 0,
    phi: 0.4 - (1 - garage.rev) * (garage.rev > 0 ? 9 : 0),
  };
  drawBikeOn(gg, c2, pose, { bike: b.id, paint: A.paintAt(save.paint) }, !open);
  if (!open) {
    // a big padlock over the outline
    const lx = c2.sx(0),
      ly = c2.sy(0.25),
      s = ppm * 0.36;
    gg.fillStyle = '#fdfbfd';
    gg.strokeStyle = '#3b2326';
    gg.lineWidth = Math.max(2, s * 0.12);
    gg.beginPath();
    gg.arc(lx, ly - s * 0.3, s * 0.42, Math.PI, 0);
    gg.stroke();
    gg.beginPath();
    if (gg.roundRect) gg.roundRect(lx - s * 0.62, ly - s * 0.3, s * 1.24, s * 0.95, s * 0.18);
    else gg.rect(lx - s * 0.62, ly - s * 0.3, s * 1.24, s * 0.95);
    gg.fill();
    gg.stroke();
    gg.fillStyle = '#3b2326';
    gg.beginPath();
    gg.arc(lx, ly + s * 0.1, s * 0.12, 0, Math.PI * 2);
    gg.fill();
    gg.fillRect(lx - s * 0.05, ly + s * 0.1, s * 0.1, s * 0.28);
  }
}
// the "new bike" or "next bike" card on the result sheet
function renderUnlock(sess: Session | null) {
  const el = ui.resUnlock,
    fresh = sess && sess.newBike,
    next = nextLockedBike(),
    b = fresh || next;
  el.hidden = !FEATURES.garage || !b;
  ui.resGarage.classList.toggle('sky', !!fresh);
  ui.resGarage.classList.toggle('plain', !fresh);
  if (el.hidden || !b) return;
  const total = totalStars();
  el.classList.toggle('fresh', !!fresh);
  ui.resUnlockTitle.textContent = fresh ? `New bike: ${fresh.name}!` : `Next bike: ${next!.name}`;
  ui.resUnlockSub.textContent = fresh ? `${fresh.perk}. Try it in the garage.` : `${total} / ${next!.stars} stars`;
  const prev = Math.max(0, ...C.BIKES.filter((x) => x.stars < b.stars).map((x) => x.stars));
  ui.resUnlockMeter.hidden = !!fresh;
  (ui.resUnlockMeter.firstElementChild as HTMLElement).style.width =
    Math.round(Math.max(0, Math.min(1, (total - prev) / (b.stars - prev))) * 100) + '%';
  drawBikeThumb(el.querySelector('canvas')!, b, !fresh);
}
function garageButtons() {
  const off = !FEATURES.garage || !!(S && S.mode === 'online');
  for (const el of document.querySelectorAll<HTMLElement>('.br-to-garage')) el.hidden = off;
}

function levelOptions(sel: HTMLSelectElement, selected: string) {
  sel.innerHTML = C.WORLDS.map(
    (w) =>
      `<optgroup label="${esc(w.name)}">${w.levels.map((L, i) => `<option value="${L.id}"${L.id === selected ? ' selected' : ''}>${i + 1}. ${esc(L.name)}</option>`).join('')}</optgroup>`,
  ).join('');
}
function renderMpStatus() {
  const st = Net.status;
  ui.mpStatus.dataset.state = st === 'idle' ? 'connecting' : st;
  ui.mpStatusText.textContent =
    st === 'online'
      ? 'Connected to the race server'
      : st === 'offline'
        ? 'No race server found'
        : Net.retrying
          ? 'Reconnecting…'
          : 'Looking for the race server…';
}
// how this phone reaches the race server, for checking a real phone (an iPhone may end up on the event stream)
function renderConn() {
  if (!ui.roomConn) return;
  const kind = Net.transport;
  ui.roomConn.textContent = kind
    ? `Connected over ${kind === 'ws' ? 'a WebSocket' : 'an event stream'}${Net.pingMs ? ` · ping ${Net.pingMs} ms` : ''}`
    : '';
}
const standingRows = (rows: StandingRow[]) =>
  rows
    .map(
      (r, i) =>
        `<li class="${r.me ? 'me' : ''}"><span class="pl">${i + 1}</span><span class="sw" style="background:${esc(r.color)}"></span><span class="nm">${esc(r.name)}</span><span class="tm">${r.time == null ? 'DNF' : fmt(r.time) + 's'}</span></li>`,
    )
    .join('');
function renderMp() {
  if (!ui.mpLobby) return;
  renderMpStatus();
  const online = Net.status === 'online';
  ui.mpLobby.hidden = !online || !!roomState;
  ui.mpRoom.hidden = !online || !roomState;
  ui.mpCpu.hidden = online && !!roomState;
  ui.mpNamePanel.hidden = online && !!roomState; // in a room the name is on the riders list, and the garage changes it
  ui.mpOffline.hidden = Net.status !== 'offline';
  ui.mpOfflineWhy.textContent = pendingJoin
    ? `Room ${pendingJoin} is on a race server that this page can't reach.`
    : 'Live races need the race server.';
  ui.mpName.value = document.activeElement === ui.mpName ? ui.mpName.value : save.name || '';
  if (!ui.cpuLevel.options.length) levelOptions(ui.cpuLevel, C.LEVELS.find(levelUnlocked)!.id);
  for (const b of [...ui.cpuCount.children] as HTMLElement[])
    b.setAttribute('aria-pressed', String(+b.dataset.n! === save.cpu));
  if (online && !roomState) {
    if (!ui.mpLevel.options.length) levelOptions(ui.mpLevel, 'clover-1');
    const open = roomsList.filter((r) => r.state === 'lobby' && r.count < 6);
    ui.mpRooms.innerHTML = open.length
      ? open
          .map((r) => {
            const L = C.levelById(r.level),
              w = L && C.worldOf(r.level);
            return `<li><span class="code">${esc(r.code)}</span><span class="who"><b>${esc(r.host)}</b><small>${w ? esc(w.name + ' ' + (L!.index + 1)) : ''} · ${r.count} rider${r.count > 1 ? 's' : ''}</small></span><button class="b sky outlined" type="button" data-code="${esc(r.code)}">Join</button></li>`;
          })
          .join('')
      : '<li class="empty">No open rooms yet. Start one and share the code.</li>';
    // (a room's Join button joins it: a listener on the list, in open)
  }
  if (online && roomState) {
    const r = roomState,
      host = r.host === Net.id,
      players = r.players || [],
      racing = r.state !== 'lobby';
    ui.roomCode.textContent = r.code;
    ui.roomLink.textContent = inviteLink().replace(/^https?:\/\//, '');
    ui.roomCopy.textContent = canShare() ? 'Invite' : 'Copy invite link';
    const L = C.levelById(r.level),
      w = L && C.worldOf(r.level);
    ui.roomLevel.hidden = !host || racing;
    ui.roomLevelText.hidden = host && !racing;
    if (host) {
      if (ui.roomLevel.dataset.for !== r.code || ui.roomLevel.value !== r.level) {
        levelOptions(ui.roomLevel, r.level);
        ui.roomLevel.dataset.for = r.code;
      }
    }
    ui.roomLevelText.textContent = L ? `${w!.name} ${L.index + 1} · ${L.name}` : r.level;
    const racers = racing ? r.racers || [] : [];
    ui.roomPlayers.innerHTML = players
      .map(
        (p) =>
          `<li class="${p.away ? 'away' : ''}"><span class="sw" style="background:${A.paintAt(p.paint).body}"></span><span class="nm">${esc(p.name)}${p.id === Net.id ? ' <small>(you)</small>' : ''}${p.id === r.host ? ' <small>host</small>' : ''}${p.away ? ' <small>away</small>' : racers.includes(p.id) ? ' <small>racing</small>' : ''}</span><span class="bk">${esc(C.bikeById(p.bike).name)}</span><span class="wn">${p.wins || 0} win${p.wins === 1 ? '' : 's'}</span></li>`,
      )
      .join('');
    ui.roomStart.hidden = !host || racing;
    const hostName = players.find((p) => p.id === r.host)?.name || 'the host';
    ui.roomNote.textContent = racing
      ? 'A race is on. You will be in the next one.'
      : host
        ? players.length > 1
          ? 'Everyone here? Start the race.'
          : 'Share the code or the link. You can also start alone to warm up.'
        : `Waiting for ${hostName} to start the race.`;
    const last = lastResults && lastResults.code === r.code ? lastResults : null;
    ui.roomLast.hidden = !last;
    if (last) ui.roomLastList.innerHTML = standingRows(last.rows);
    renderConn();
  }
}

// ------------------------------------------------------------------------------------------------
// Modals
function openModal(m: HTMLElement) {
  m.hidden = false;
  const b = m.querySelector<HTMLElement>('.b.go:not([hidden]), .b:not([hidden])');
  if (b && !isPhone()) later(50, () => b.focus());
}
function closeModals() {
  for (const m of [ui.pause, ui.crash, ui.result, ui.raceResult]) m.hidden = true;
}
const anyModalOpen = () => [ui.pause, ui.crash, ui.result, ui.raceResult].some((m) => !m.hidden);
function pause() {
  if (!S || anyModalOpen()) return;
  if (S.mode !== 'online') S.paused = true;
  ui.pauseText.textContent =
    S.mode === 'online'
      ? 'The race keeps going while this menu is open.'
      : `${S.world.name} ${S.def.index + 1} · ${S.def.name}` +
        (save.best[S.levelId] && S.mode === 'solo' ? ` · Best ${fmt(save.best[S.levelId])}s` : '');
  ui.pRestart.hidden = S.mode === 'online';
  ui.pLevels.textContent = S.mode === 'solo' ? backLabel(S) : 'Leave race';
  ui.pGhostRow.hidden = S.mode !== 'solo' || !!S.custom;
  if (S.custom) ui.pauseText.textContent = S.custom.name + (S.custom.best ? ` · Best ${fmt(S.custom.best)}s` : '');
  garageButtons();
  syncToggles();
  openModal(ui.pause);
}
// a run that is going and can be stopped: your own, or a race against computer riders (live races can't wait)
const shouldAutoPause = () =>
  view === 'play' &&
  !!S &&
  (S.mode === 'solo'
    ? S.phase === 'run'
    : S.mode === 'cpu' && (S.phase === 'run' || S.phase === 'countdown') && !S.me.finished);
function resume() {
  closeModals();
  if (S) {
    S.paused = false;
    last = performance.now();
  }
}
function syncToggles() {
  for (const [el, on] of [
    [ui.tGhost, save.ghost],
    [ui.tSound, save.sound],
    [ui.pTilt, save.tilt],
  ] as const)
    if (el) el.setAttribute('aria-pressed', String(!!on));
  if (ui.soundBtn) ui.soundBtn.setAttribute('aria-pressed', String(!!save.sound));
  if (ui.pTiltRow) ui.pTiltRow.hidden = !isPhone();
}
function leaveToMenu() {
  if (S && S.custom) {
    const cu = S.custom;
    exitPlay();
    if (cu.onExit) cu.onExit();
    else showView('mylevels');
    return;
  }
  const mode = S && S.mode,
    w = S && S.world;
  exitPlay();
  if (mode === 'solo') {
    renderLevels(w!);
    showView('levels');
    showLevels();
  } else showView(mode === 'online' || mode === 'cpu' ? 'mp' : 'home');
}

// ------------------------------------------------------------------------------------------------
// Opening and leaving: the listeners, the frame loop and what leaving does (see "The visit" above)

// the page's elements, found on the first visit
function findElements() {
  app = $('br-app');
  canvas = $('br-canvas') as HTMLCanvasElement;
  g = canvas.getContext('2d')!;
  ui = findUi();
  app.classList.toggle('touch', isPhone());
}
// a menu button that may be the first tap: sound can start from inside it
const go = (fn: (e: Event) => void) => (e: Event) => {
  Sound.init();
  Sound.resume();
  fn(e);
};
const toHub = () => {
  leaveFullscreen();
  GameHub.menu();
};
const setName = (v: string) => {
  save.name = cleanName(v);
  persist();
};
function toggleSound() {
  save.sound = !save.sound;
  persist();
  Sound.init();
  Sound.setOn(save.sound);
  syncToggles();
}
function joinCode() {
  const c = ui.mpCode.value.trim().toUpperCase();
  if (c.length !== 4) {
    toast('Room codes have 4 letters', 2000, 'small');
    ui.mpCode.focus();
    return;
  }
  sendProfile();
  Net.send({ t: 'join', code: c });
}
function onKey(e: KeyboardEvent) {
  const tag = (e.target as Element | null)?.tagName || '';
  if (view === 'garage' && e.code === 'Escape' && !/INPUT/.test(tag)) {
    e.preventDefault();
    closeGarage();
    return;
  }
  if (view !== 'play') return;
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(tag)) return;
  Sound.init();
  Sound.resume();
  if (KEYMAP[e.code]) {
    keys.add(e.code);
    e.preventDefault();
  }
  if (e.repeat) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    if (!ui.pause.hidden) resume();
    else pause();
  } else if (e.code === 'KeyR' && S && S.mode !== 'online') {
    e.preventDefault();
    restart();
  } else if ((e.code === 'Enter' || e.code === 'Space') && !ui.crash.hidden) {
    e.preventDefault();
    restart();
  }
}
// let go of every key and touch control
function releaseAll() {
  keys.clear();
  for (const k of Object.keys(touchCtl) as Control[]) touchCtl[k] = false;
  for (const el of document.querySelectorAll('.br-touch .on')) el.classList.remove('on');
}

/** Every button, key, touch and page event the game answers while it is open */
const controls: Effect.Effect<void, never, Scope.Scope> = Effect.gen(function* () {
  const click = (el: string | HTMLElement, fn: (e: MouseEvent) => void) =>
    listen(typeof el === 'string' ? $(el) : el, 'click', fn);
  // home
  yield* click('br-home-back', toHub);
  yield* click(
    'br-go-solo',
    go(() => {
      goFullscreen();
      showView('worlds');
    }),
  );
  yield* click('br-desk-back', toHub);
  yield* click('br-desk-keys', () => {
    allowKeyboard = true;
    showView('home');
  });
  // any tap in the game may be the first one: iOS only shows its motion permission prompt from a tap
  yield* listen(
    app,
    'click',
    () => {
      startTilt();
      Sound.unlock();
    },
    { capture: true },
  );
  yield* listen(app, 'touchend', () => Sound.unlock(), { capture: true });
  // a soft tick for menu buttons (not the gas and brake)
  yield* listen(app, 'click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    if (b && !b.closest('.br-touch') && !b.disabled) Sound.tap();
  });
  yield* click('br-rotate-back', toHub);
  yield* click(
    'br-go-mp',
    go(() => showView('mp')),
  );
  yield* click(
    'br-go-garage',
    go(() => openGarage()),
  );
  yield* click(
    'br-go-editor',
    go(() => showView('mylevels')),
  );
  yield* click('br-worlds-back', () => showView('home'));
  yield* click('br-levels-back', () => showView('worlds'));
  yield* click('br-garage-back', () => closeGarage());
  yield* click('br-mp-back', () => {
    if (roomState) Net.send({ t: 'leave' });
    roomState = null;
    showView('home');
  });
  // the world and level cards (see tapped)
  yield* click(ui.worldCards, (e) => {
    const i = tapped(ui.worldCards, e);
    if (i >= 0) pickWorld(C.WORLDS[i]);
  });
  yield* click(ui.levelGrid, (e) => {
    const i = tapped(ui.levelGrid, e);
    if (i >= 0) startSolo(levelsWorld.levels[i].id);
  });
  // garage: the bikes, the paints, the bike on show's Ride button and the name
  yield* click(ui.bikes, (e) => {
    const i = tapped(ui.bikes, e);
    if (i >= 0) pickBike(C.BIKES[i]);
  });
  yield* click(ui.paints, (e) => {
    const i = tapped(ui.paints, e);
    if (i >= 0) pickPaint(i);
  });
  yield* click(ui.gStatus, (e) => {
    if (e.target instanceof Element && e.target.closest('.br-ride')) pickBike(C.bikeById(garage.focus));
  });
  yield* listen(ui.name, 'input', () => setName(ui.name.value));
  yield* listen(ui.name, 'change', () => {
    ui.name.value = save.name = cleanName(ui.name.value.trim());
    persist();
    if (Net.status === 'online') sendProfile();
  });
  yield* listen(ui.name, 'keydown', (e) => {
    if (e.key === 'Enter') ui.name.blur();
  });
  for (const id of ['br-p-garage', 'br-crash-garage', 'br-res-garage'])
    yield* click(
      id,
      go(() => openGarage(S && S.newBike && S.newBike.id)),
    );
  yield* click(
    ui.resUnlock,
    go(() => openGarage(S && S.newBike ? S.newBike.id : nextLockedBike()?.id)),
  );
  // play HUD
  yield* click('br-pause', () => pause());
  yield* click(ui.retry, () => restart());
  yield* click(ui.soundBtn, () => toggleSound());
  // pause menu
  yield* click('br-p-resume', () => resume());
  yield* click(ui.pRestart, () => restart());
  yield* click(ui.pLevels, () => {
    if (S && S.mode === 'online') Net.send({ t: 'retire' });
    leaveToMenu();
  });
  yield* click(ui.tGhost, () => {
    save.ghost = !save.ghost;
    persist();
    if (S && S.mode === 'solo') S.ghost = save.ghost ? loadGhost(S.levelId) : null;
    syncToggles();
  });
  yield* click(ui.tSound, () => toggleSound());
  yield* click(ui.pTilt, () => setTilt(!save.tilt));
  // crash and result
  yield* click('br-crash-retry', () => restart());
  yield* click('br-crash-levels', () => leaveToMenu());
  yield* click(ui.resNext, () => {
    const n = nextLevelId(S!.levelId);
    if (n) startSolo(n);
  });
  yield* click('br-res-retry', () => restart());
  yield* click('br-res-levels', () => leaveToMenu());
  // race results
  yield* click(ui.rrAgain, () => {
    if (!S) return;
    if (S.mode === 'cpu') startCpuRace(S.levelId, S.cpus.length);
    else if (S.mode === 'online') Net.send({ t: 'start' }); // the countdown closes the sheet
  });
  yield* click(ui.rrRoom, () => {
    exitPlay();
    showView('mp');
  });
  yield* click('br-rr-leave', () => {
    if (S && S.mode === 'online') Net.send({ t: 'leave' });
    roomState = null;
    exitPlay();
    showView('mp');
  });
  // multiplayer lobby
  yield* listen(ui.mpName, 'input', () => setName(ui.mpName.value));
  yield* listen(ui.mpName, 'change', () => sendProfile());
  yield* click('br-mp-create', () => {
    sendProfile();
    Net.send({ t: 'create', level: ui.mpLevel.value });
  });
  yield* listen(ui.mpCode, 'input', () => {
    const v = ui.mpCode.value
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 4);
    if (v !== ui.mpCode.value) ui.mpCode.value = v;
  });
  yield* click('br-mp-join', () => joinCode());
  yield* listen(ui.mpCode, 'keydown', (e) => {
    if (e.key === 'Enter') joinCode();
  });
  yield* click('br-mp-retry', () => {
    Net.close();
    Net.connect();
    renderMp();
  });
  // a room's Join button in the open rooms list
  yield* click(ui.mpRooms, (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>('button[data-code]') : null;
    if (!b) return;
    sendProfile();
    Net.send({ t: 'join', code: b.dataset.code! });
  });
  yield* listen(ui.roomLevel, 'change', () => {
    Net.send({ t: 'level', level: ui.roomLevel.value });
  });
  yield* click(ui.roomStart, () => {
    Net.send({ t: 'start' });
  });
  yield* click('br-room-leave', () => {
    Net.send({ t: 'leave' });
    roomState = null;
    renderMp();
  });
  yield* listen(ui.roomCopy, 'click', () => invite);
  for (const b of ui.cpuCount.querySelectorAll('button'))
    yield* click(b, () => {
      save.cpu = +b.dataset.n!;
      persist();
      renderMp();
    });
  yield* click(
    'br-cpu-start',
    go(() => startCpuRace(ui.cpuLevel.value, save.cpu)),
  );
  // keyboard
  yield* listen(window, 'keydown', onKey);
  yield* listen(window, 'keyup', (e) => {
    keys.delete(e.code);
  });
  yield* listen(window, 'blur', () => {
    releaseAll();
    if (shouldAutoPause()) pause();
  });
  // phones stop pages in the background, and the connection may have died meanwhile
  yield* listen(document, 'visibilitychange', () => {
    if (document.hidden) {
      releaseAll();
      if (shouldAutoPause()) pause();
      Sound.suspend();
    } else {
      Net.wake();
      Sound.resume();
    }
  });
  yield* listen(window, 'pageshow', () => Net.wake());
  // touch controls
  for (const [id, k] of [
    ['br-tgas', 'gas'],
    ['br-tbrake', 'brake'],
    ['br-tback', 'back'],
    ['br-tfwd', 'fwd'],
  ] as const) {
    const el = $(id);
    const on = (e: PointerEvent) => {
      e.preventDefault();
      Sound.init();
      Sound.resume();
      touchCtl[k] = true;
      el.classList.add('on');
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
    };
    const off = () => {
      touchCtl[k] = false;
      el.classList.remove('on');
    };
    yield* listen(el, 'pointerdown', on);
    yield* listen(el, 'pointerup', off);
    yield* listen(el, 'pointercancel', off);
    yield* listen(el, 'lostpointercapture', off);
    yield* listen(el, 'contextmenu', (e) => e.preventDefault());
  }
  // tapping the screen retries after a crash
  yield* listen(canvas, 'pointerdown', () => {
    Sound.init();
    Sound.resume();
  });
  yield* listen(window, 'resize', () => {
    resize();
    if (isPhone() && innerHeight > innerWidth && shouldAutoPause()) pause();
  });
});

// Android: play fullscreen and locked sideways. (iPhones can't do either from a web page.) A browser that says no is
// no reason for an error. run starts it at once, still inside the tap that asked, which fullscreen needs.
function goFullscreen() {
  const el = document.documentElement;
  if (!isPhone() || document.fullscreenElement || !el.requestFullscreen) return;
  const lock = Effect.suspend(() =>
    screen.orientation && screen.orientation.lock
      ? Effect.tryPromise(() => screen.orientation.lock('landscape'))
      : Effect.void,
  );
  run(
    Effect.tryPromise(() => el.requestFullscreen({ navigationUI: 'hide' })).pipe(Effect.andThen(lock), Effect.ignore),
  );
}
function leaveFullscreen() {
  if (document.fullscreenElement && document.exitFullscreen)
    run(Effect.tryPromise(() => document.exitFullscreen()).pipe(Effect.ignore));
}

// The player left Bike Race (the visit's scope is closing, its listeners and loop already gone): leave any room,
// close the connection, leave fullscreen, quiet the engine and pause a run.
function leave() {
  visit = null;
  // leaving Bike Race for the games menu leaves any room too
  if (roomState) Net.send({ t: 'leave' });
  roomState = null;
  if (S && S.mode === 'online') {
    exitPlay();
    view = 'mp';
  }
  Net.close();
  leaveFullscreen();
  Sound.engineOff();
  // keys and buttons let go of while the game was closed would otherwise still count as held when it opens again
  releaseAll();
  if (view === 'play' && S) pause();
}

/**
 * Bike Race on screen: the hub runs this in a scope when the player arrives and closes the scope when they leave.
 * What it starts (listeners, the race server's messages, the frame loop, timers) stops then, and leave() does the
 * rest of leaving.
 */
export const open: Effect.Effect<void, never, Scope.Scope | PageServices> = Effect.gen(function* () {
  if (!started) findElements();
  visit = {
    fork: yield* FiberSet.makeRuntime<PageServices>(),
    toast: yield* FiberHandle.make<void, never>(),
    tiltWait: yield* FiberHandle.make<void, never>(),
    lobby: yield* FiberHandle.make<void, never>(),
    orientation: false,
  };
  // The race server's messages. leave() (the finalizer added next, so it runs first) closes the connection while
  // this still listens, so the lobby hears that it is closed, as it always did.
  yield* Effect.acquireRelease(
    Effect.sync(() => Net.on(onNet)),
    (off) => Effect.sync(off),
  );
  yield* Effect.addFinalizer(() => Effect.sync(leave));
  // the editor's buttons and canvas gestures first, as they always came before the game's own
  yield* Editor.open;
  yield* controls;
  // Android and others send motion events without asking, so tilt can start on the first visit (iOS waits for the
  // first tap). Later visits listen again, and wait again for a first reading if the last visit was still waiting.
  if (!started) {
    started = true;
    const ask =
      typeof DeviceOrientationEvent !== 'undefined' && (DeviceOrientationEvent as AskMotion).requestPermission;
    if (isPhone() && save.tilt && !Predicate.isFunction(ask)) startTilt();
  } else if (tilt.listening) {
    watchOrientation();
    if (tilt.state === 'waiting') waitForTilt();
  }
  last = performance.now();
  yield* animate((_dt, now) => frame(now));
  yield* reroute;
});

/** The address on arrival, or a new one while the game is open: #bike-race/CODE joins that room */
export const reroute: Effect.Effect<void, never, PageServices> = Effect.gen(function* () {
  resize();
  const code = invitedTo(location.hash);
  if (code) {
    pendingJoin = code;
    // the address goes back to plain #bike-race (a page that refuses is no reason to stop)
    yield* Effect.try(() => history.replaceState(null, '', location.pathname + location.search + '#bike-race')).pipe(
      Effect.ignore,
    );
    if (Net.status === 'online' && Net.id) {
      Net.send({ t: 'join', code });
      pendingJoin = null;
    }
    showView('mp');
  } else if (view === 'play' && S) {
    // coming back to a game in progress
  } else showView(view === 'play' ? 'home' : view);
});

/** Bike Race for the hub */
export const game: Game = { open, reroute };

// what the level editor (bike-race-editor.ts) uses from the game
const editorApi = {
  startCustom,
  showView,
  toast,
  isPhone,
  get view() {
    return view;
  },
  get canvas() {
    return canvas;
  },
  Sound,
};
export type EditorApi = typeof editorApi;
Editor.connect(editorApi);

// for the browser tests (tests/browser/bike-race*.test.ts)
function debug() {
  return {
    S,
    attract,
    save,
    cam,
    C,
    Net,
    startSolo,
    startCpuRace,
    readInput,
    touchCtl,
    keys,
    tilt,
    tiltAngle,
    refreshControls,
    remotePose,
    roomState,
    inviteLink,
  };
}
export type BikeRaceDebug = ReturnType<typeof debug>;
window.BikeRace = { editor: editorApi, _debug: debug };
