// Bike Race: menus, the play loop, ghosts, saving, sound, tilt/touch input, races against
// computer riders and live races through the race server. Exposes window.BikeRace { show, hide }.
(() => {
'use strict';
const C = window.BikeRaceCore, A = window.BikeRaceArt, Net = window.BikeRaceNet;
const $ = (id) => document.getElementById(id);
const STEP = C.STEP;
const fmt = (t) => (t == null || !isFinite(t)) ? '--' : t.toFixed(2);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const FEATURES = { garage: true, multiplayer: true };
// ?autopilot lets the computer rider drive your bike (used by the browser tests)
const AUTOPILOT = /[?&]autopilot\b/.test(location.search);
// The game is made for phones held sideways. On a computer it shows a "play on your phone" screen, unless the
// player picks "Try it with the keyboard" there, or the address has ?autopilot or ?keyboard (for testing).
let allowKeyboard = AUTOPILOT || /[?&]keyboard\b/.test(location.search);
const isPhone = () => isTouch();

// ------------------------------------------------------------------------------------------------
// Saved progress
const SAVE_KEY = 'bikerace.v1', GHOST_KEY = 'bikerace.ghost.v1.';
// bike, paint and name are the garage choices; seen lists the bikes already looked at in the garage, so a newly
// unlocked one can say "New"
const defaults = () => ({ best: {}, stars: {}, bike: 'scout', paint: 0, name: '', seen: ['scout'], ghost: true, sound: true, tilt: true, cpu: 2, lastWorld: 'clover' });
let save = defaults();
try { save = Object.assign(defaults(), JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) {}
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} };
const cleanName = (v) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 16);
function loadGhost(id) {
  try { const g = JSON.parse(localStorage.getItem(GHOST_KEY + id) || 'null'); return g && g.f ? { time: g.time, bike: C.bikeById(g.bike).id, frames: C.decodeGhost(g.f) } : null; } catch (e) { return null; }
}
function saveGhost(id, time, frames, bike) {
  try { localStorage.setItem(GHOST_KEY + id, JSON.stringify({ time, bike, f: C.encodeGhost(frames) })); } catch (e) {}
}
const totalStars = () => C.LEVELS.reduce((n, L) => n + (save.stars[L.id] || 0), 0);
const worldStars = (w) => w.levels.reduce((n, L) => n + (save.stars[L.id] || 0), 0);
const finished = (id) => save.best[id] > 0;
function worldUnlocked(w) {
  const i = C.WORLDS.indexOf(w);
  return i <= 0 || finished(C.WORLDS[i - 1].levels[C.WORLDS[i - 1].levels.length - 1].id);
}
function levelUnlocked(L) {
  const w = C.WORLDS.find(x => x.id === L.world);
  return worldUnlocked(w) && (L.index === 0 || finished(w.levels[L.index - 1].id));
}
const bikeUnlocked = (b) => totalStars() >= b.stars;
const nextLockedBike = () => C.BIKES.find(b => !bikeUnlocked(b)) || null;
const newBikes = () => C.BIKES.filter(b => bikeUnlocked(b) && !save.seen.includes(b.id));
// a save from an older version, or edited by hand, could name a bike that is locked or doesn't exist
(function checkSave() {
  if (!Array.isArray(save.seen)) save.seen = ['scout'];
  if (!C.BIKES.some(b => b.id === save.bike) || !bikeUnlocked(C.bikeById(save.bike))) save.bike = 'scout';
  save.paint = ((Math.floor(+save.paint) || 0) % A.PAINTS.length + A.PAINTS.length) % A.PAINTS.length;
  save.name = cleanName(save.name);
})();
const myLook = () => ({ bike: save.bike, paint: A.paintAt(save.paint), name: save.name || 'You' });

const builtLevels = new Map();
function getLevel(id) {
  if (!builtLevels.has(id)) builtLevels.set(id, C.buildLevel(C.worldOf(id), C.levelById(id)));
  return builtLevels.get(id);
}
function nextLevelId(id) {
  const i = C.LEVELS.findIndex(L => L.id === id);
  return i >= 0 && i + 1 < C.LEVELS.length ? C.LEVELS[i + 1].id : null;
}

// ------------------------------------------------------------------------------------------------
// Sound: a small WebAudio engine hum, crash, blips and a finish jingle. Muted with the HUD button.
const Sound = {
  ctx: null, master: null, eng: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    this.master = this.ctx.createGain(); this.master.gain.value = save.sound ? 0.6 : 0; this.master.connect(this.ctx.destination);
  },
  resume() { if (this.ctx && this.ctx.state !== 'running' && !document.hidden) this.ctx.resume().catch(() => {}); },
  // iPhones start Web Audio only from inside a tap; a silent sound played then unlocks it for good
  unlock() {
    this.init(); this.resume();
    if (!this.ctx || this.unlocked) return;
    this.unlocked = true;
    try { const s = this.ctx.createBufferSource(); s.buffer = this.ctx.createBuffer(1, 1, 22050); s.connect(this.ctx.destination); s.start(0); } catch (e) {}
  },
  // a page in the background must not keep humming (phones keep Web Audio running for other tabs and apps)
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); },
  setOn(on) { if (this.master) this.master.gain.setTargetAtTime(on ? 0.6 : 0, this.ctx.currentTime, 0.05); },
  engineOn() {
    if (!this.ctx || this.eng) return;
    const c = this.ctx, o1 = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), gn = c.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = -1200;
    f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 2;
    gn.gain.value = 0;
    const g2 = c.createGain(); g2.gain.value = 0.35;
    o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(gn); gn.connect(this.master);
    o1.start(); o2.start();
    this.eng = { o1, o2, f, gn };
  },
  engine(rpm, throttle, on) {
    if (!this.eng) return;
    const t = this.ctx.currentTime, fr = 38 + rpm * 120 + throttle * 14;
    this.eng.o1.frequency.setTargetAtTime(fr, t, 0.05); this.eng.o2.frequency.setTargetAtTime(fr, t, 0.05);
    this.eng.f.frequency.setTargetAtTime(500 + rpm * 900 + throttle * 500, t, 0.08);
    this.eng.gn.gain.setTargetAtTime(on ? 0.045 + throttle * 0.05 : 0, t, 0.08);
  },
  engineOff() {
    if (!this.eng) return;
    const e = this.eng; this.eng = null;
    e.gn.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    setTimeout(() => { try { e.o1.stop(); e.o2.stop(); } catch (er) {} }, 300);
  },
  noise(dur, from, to, vol) {
    if (!this.ctx) return;
    const c = this.ctx, n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), gn = c.createGain();
    s.buffer = buf; f.type = 'lowpass'; f.frequency.setValueAtTime(from, c.currentTime); f.frequency.exponentialRampToValueAtTime(to, c.currentTime + dur);
    gn.gain.value = vol; s.connect(f); f.connect(gn); gn.connect(this.master); s.start();
  },
  blip(freq, dur = 0.12, type = 'triangle', vol = 0.18, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), gn = c.createGain(), t = c.currentTime + delay;
    o.type = type; o.frequency.value = freq;
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(vol, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gn); gn.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  crash() { this.noise(0.6, 2400, 120, 0.5); this.blip(110, 0.3, 'square', 0.12); },
  land(hard) { this.noise(0.12, 500, 80, 0.15 + hard * 0.25); },
  flip() { this.blip(660, 0.1); this.blip(990, 0.16, 'triangle', 0.18, 0.08); },
  count(go) { this.blip(go ? 880 : 440, go ? 0.35 : 0.15, 'square', 0.12); },
  finish() { [523, 659, 784, 1046].forEach((f, i) => this.blip(f, 0.22, 'triangle', 0.2, i * 0.09)); },
  checkpoint() { this.blip(784, 0.1, 'triangle', 0.14); this.blip(1175, 0.18, 'triangle', 0.14, 0.07); },
  tap() { this.blip(520, 0.05, 'triangle', 0.08); },
};

// ------------------------------------------------------------------------------------------------
// Input. On a phone you lean the bike by turning the phone like a steering wheel, and hold the right half of
// the screen for gas and the left half for brake. Lean arrow buttons appear only when tilt can't be used: no
// motion sensor, motion access declined (iOS asks once, on a tap), tilt switched off in the pause menu, or a
// page that isn't https or localhost (browsers only send motion events to secure pages).
// The keyboard works too, for testing on a computer.
const keys = new Set();
const touchCtl = { gas: false, brake: false, back: false, fwd: false };
const KEYMAP = { ArrowUp: 'gas', KeyW: 'gas', Space: 'gas', ArrowDown: 'brake', KeyS: 'brake', ArrowLeft: 'back', KeyA: 'back', ArrowRight: 'fwd', KeyD: 'fwd' };
const TILT_FULL = 14, TILT_DEAD = 1.5;     // degrees of turn for full lean, and the dead zone around level
const DEG = Math.PI / 180;
// state: idle (not started) | asking (iOS prompt open) | waiting (listening, no reading yet) | on | denied | nosensor | insecure
const tilt = { state: 'idle', angle: 0, lean: 0, asked: false, told: '', timer: 0 };
function readInput() {
  const k = (n) => [...keys].some(c => KEYMAP[c] === n) || touchCtl[n];
  let lean = (k('back') ? 1 : 0) - (k('fwd') ? 1 : 0);
  if (!lean && useTilt()) lean = tilt.lean;
  return { gas: k('gas') ? 1 : 0, brake: k('brake') ? 1 : 0, lean: Math.max(-1, Math.min(1, lean)) };
}
const anyControl = () => { const i = readInput(); return i.gas || i.brake || (i.lean && !useTilt()); };
const useTilt = () => isPhone() && save.tilt && tilt.state === 'on';
function screenAngle() {
  const a = screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : (window.orientation || 0);
  return ((a % 360) + 360) % 360;
}
// How far the phone is turned from level, in degrees, anticlockwise positive. Works out which way is down in
// screen coordinates from the orientation angles, so it doesn't matter how far the phone is tipped back.
function tiltAngle(beta, gamma, screenDeg) {
  const b = beta * DEG, gm = gamma * DEG, th = screenDeg * DEG;
  const dx = Math.sin(gm) * Math.cos(b), dy = -Math.sin(b);                       // down, in phone coordinates
  const sx = dx * Math.cos(th) - dy * Math.sin(th), sy = dx * Math.sin(th) + dy * Math.cos(th);   // down, on screen
  if (Math.hypot(sx, sy) < 0.25) return null;                                     // lying flat: no clear answer
  return Math.atan2(-sx, -sy) / DEG;
}
function onOrientation(e) {
  if (e.beta == null || e.gamma == null) return;
  const a = tiltAngle(e.beta, e.gamma, screenAngle());
  if (tilt.state === 'waiting' || tilt.state === 'nosensor') { tilt.state = 'on'; clearTimeout(tilt.timer); refreshControls(); }   // a slow sensor can still switch tilt on
  if (a == null) return;
  tilt.angle = a;
  const m = Math.max(0, Math.abs(a) - TILT_DEAD) / (TILT_FULL - TILT_DEAD);
  tilt.lean = Math.sign(a) * Math.min(1, m);     // turning the phone anticlockwise leans the bike back (anticlockwise)
}
function listenTilt() {
  window.removeEventListener('deviceorientation', onOrientation);
  window.addEventListener('deviceorientation', onOrientation);
  if (tilt.state !== 'on') {
    tilt.state = 'waiting';
    clearTimeout(tilt.timer);
    tilt.timer = setTimeout(() => { if (tilt.state === 'waiting') { tilt.state = 'nosensor'; refreshControls(); } }, 1500);
  }
}
// Call from a tap or click: iOS shows its motion permission prompt only from inside one.
function startTilt() {
  if (!isPhone() || !save.tilt || ['on', 'waiting', 'asking', 'denied'].includes(tilt.state)) return;
  if (!window.isSecureContext) { tilt.state = 'insecure'; refreshControls(); return; }
  if (typeof DeviceOrientationEvent === 'undefined') { tilt.state = 'nosensor'; refreshControls(); return; }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    if (tilt.asked) return;
    tilt.asked = true; tilt.state = 'asking';
    DeviceOrientationEvent.requestPermission()
      .then((r) => { if (r === 'granted') listenTilt(); else tilt.state = 'denied'; refreshControls(); })
      .catch(() => { tilt.state = 'denied'; refreshControls(); });
  } else listenTilt();
  refreshControls();
}
// why tilt is off, under the switch in the pause menu
const TILT_WHY = { denied: 'Motion access is off for this site', insecure: 'Needs an https address', nosensor: 'No tilt sensor found' };
function syncTiltWhy() {
  if (ui.pTiltWhy) ui.pTiltWhy.textContent = save.tilt && isPhone() ? TILT_WHY[tilt.state] || '' : '';
}
function setTilt(on) {
  save.tilt = on; persist();
  if (on) startTilt();
  refreshControls(); syncToggles();
}
// Picks the touch layout: two big halves (tilt) or the four buttons (no tilt), and says once why tilt is off.
function refreshControls() {
  if (!ui.touch) return;
  const tiltOn = useTilt() || (save.tilt && ['waiting', 'asking'].includes(tilt.state));
  ui.touch.classList.toggle('tilt', tiltOn);
  ui.touch.classList.toggle('buttons', !tiltOn);
  app.classList.toggle('tilt-on', tiltOn);
  syncTiltWhy();
  if (!isPhone() || !save.tilt || tilt.told === tilt.state || view !== 'play') return;
  const why = { denied: 'Motion access is off, so lean with the arrows. To tilt, allow motion for this site and reload.',
    insecure: 'Tilt needs an https address. Lean with the arrows for now.',
    nosensor: 'No tilt sensor found. Lean with the arrows.' }[tilt.state];
  if (why) { tilt.told = tilt.state; ui.tipbar.hidden = true; toast(why, 4200, 'small'); }
}

// ------------------------------------------------------------------------------------------------
// Canvas, camera and the main loop
let app, canvas, g, dpr = 1;
const cam = new A.Camera();
const particles = new A.Particles();
let running = false, raf = 0, last = 0, acc = 0, clockT = 0;
let view = 'home';      // home | worlds | levels | garage | mp | play
let S = null;           // the session being played
let attract = null;     // the computer rider behind the menus
let started = false;

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = app.clientWidth || window.innerWidth, h = app.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  cam.W = w; cam.H = h;
}
function basePpm() { return Math.max(16, Math.min(72, Math.min(cam.H / 11.5, cam.W / 17))); }

function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; clockT += dt;
  const sess = view === 'play' ? S : attract;
  if (sess) {
    if (!sess.paused) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 24) { update(sess); acc -= STEP; n++; }
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

function followCamera(sess, dt, snap) {
  const b = sess.me, c = b.c;
  const lead = Math.max(-2, Math.min(5, c.vx * 0.3));
  // high over the ground (a big jump or a drop), pull back and frame the landing too
  const below = sess.level.terrain.surface(c.x + lead * 0.6, c.y);
  const high = below ? Math.max(0, Math.min(9, c.y - below.y - 2.2)) : 0;
  const ppmT = basePpm() * (1 / (1 + 0.18 * Math.min(1, b.airborne / 0.8) + 0.045 * high) - Math.min(0.12, Math.max(0, c.vx - 8) * 0.012));
  const k = snap ? 1 : 1 - Math.exp(-dt * 2.2);
  cam.ppm += (ppmT - cam.ppm) * k;
  const tx = c.x + lead + cam.W * 0.1 / cam.ppm, ty = c.y + 1.2 - high * 0.55 + Math.max(-1.5, Math.min(1.5, c.vy * 0.08));
  const kx = snap ? 1 : 1 - Math.exp(-dt * 7), ky = snap ? 1 : 1 - Math.exp(-dt * 4);
  cam.x += (tx - cam.x) * kx; cam.y += (ty - cam.y) * ky;
}

// ------------------------------------------------------------------------------------------------
// Sessions
function makeSession(mode, levelId, opts = {}) {
  const def = C.levelById(levelId), world = C.worldOf(levelId), level = getLevel(levelId);
  const sim = new C.Sim(level);
  const look = mode === 'attract' ? { bike: save.bike, paint: A.paintAt(save.paint), name: '' } : myLook();
  const me = sim.addBike(look.bike, { id: 'me' });
  me.look = look;
  const sess = {
    mode, levelId, def, world, level, theme: A.THEMES[world.id], sim, me,
    phase: mode === 'attract' ? 'run' : 'ready', paused: false,
    ghost: null, rec: [], recNext: 0, cpus: [], remote: new Map(),
    countdown: 0, crashTimer: 0, finishTimer: 0, respawnTimer: 0, sendTimer: 0, lastCount: -1,
    results: null, finishedSent: false, flash: [], cpSeen: 0,
  };
  if (mode === 'attract') me.running = true;
  if (mode === 'solo' && save.ghost) sess.ghost = loadGhost(levelId);
  return sess;
}

function update(sess) {
  const me = sess.me;
  if (sess.mode === 'attract') me.input = C.botInput(me);
  else if (sess.phase === 'run' && !me.crashed && !me.finished) me.input = AUTOPILOT ? C.botInput(me) : readInput();
  else me.input = { gas: 0, brake: 0, lean: 0 };
  if (sess.mode === 'solo' && sess.phase === 'ready' && (anyControl() || AUTOPILOT) && !anyModalOpen()) startClock(sess);
  for (const cpu of sess.cpus) cpu.bike.input = sess.phase === 'run' ? C.botInput(cpu.bike, cpu.cfg) : { gas: 0, brake: 0, lean: 0 };
  sess.sim.step();
  // ghost recording while the clock runs
  if (me.running && !me.finished && !me.crashed && sess.mode === 'solo') {
    while (me.time >= sess.recNext) { sess.rec.push([me.c.x, me.c.y, me.c.a]); sess.recNext += 1 / C.POSE_HZ; }
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
      particles.burst(sess.level.checkpoints[me.checkpoint - 1], me.c.y + 1.6, ['#43b05c', '#ffffff', '#ffd43b'], 12, 4, 'star');
    }
  }
  for (const cpu of sess.cpus) {
    for (const e of cpu.bike.events) if (e.type === 'crash') cpu.respawnAt = 1.2;
    cpu.bike.events.length = 0;
  }
}
function dustColor(sess) { return { clover: '#c8a27a', ember: '#e8b48c', frost: '#ffffff', moon: '#d8d6ea', magma: '#8a6a66' }[sess.world.id]; }

function onEvent(sess, me, e) {
  if (sess.mode === 'attract') {
    if (e.type === 'crash' || e.type === 'finish') sess.restartIn = e.type === 'crash' ? 1.5 : 2.5;
    return;
  }
  if (e.type === 'flip') {
    toast(`${e.n > 1 ? e.n + 'x ' : ''}${e.back ? 'Backflip' : 'Frontflip'}! −${(0.5 * e.n).toFixed(1)}s`);
    Sound.flip();
    particles.burst(me.c.x, me.c.y + 1, ['#ffd43b', '#fff3b0'], 10, 4, 'star');
  } else if (e.type === 'land') {
    Sound.land(e.hard);
    for (const W of me.wheels) particles.dust(W.x, W.y - 0.3, me.c.vx * 0.2, 0.6, dustColor(sess), 3 + Math.round(e.hard * 5), 0.22);
  } else if (e.type === 'crash') {
    Sound.crash();
    const [hx, hy] = me.toWorld(0.1, 1.0);
    particles.burst(hx, hy, e.kind === 'lava' ? ['#ff8a2c', '#ffd23f', '#c4321d'] : ['#ffd43b', '#ffffff'], 14, 5, 'star');
    particles.dust(me.c.x, me.c.y, 0, 1, e.kind === 'lava' ? '#5b4140' : dustColor(sess), 10, 0.35);
    if (sess.mode === 'solo') { sess.phase = 'crashed'; sess.crashTimer = 1.1; }
    else sess.respawnTimer = 1.2;
  } else if (e.type === 'finish') {
    Sound.finish();
    particles.burst(sess.level.finishX, me.c.y + 3, ['#e8463c', '#ffd43b', '#43b05c', '#3a7bd5', '#ec6fa4', '#ffffff'], 70, 9);
    if (sess.mode === 'solo') soloFinished(sess);
    else if (sess.mode === 'cpu') { sess.finishTimer = 1.3; center(`${ordinal(cpuPlace(sess))}!`, 'big'); }
    else if (sess.mode === 'online') {
      if (!sess.finishedSent) { Net.send({ t: 'finish', time: me.finishTime }); sess.finishedSent = true; }   // resent after a reconnect until the server echoes it
      center(`${fmt(me.finishTime)}s`, 'big'); setTimeout(() => { if (S === sess && !sess.results) center('Waiting for the others…', 'small'); }, 1600);
    }
  }
}

// timers that run once per frame
function sessionTimers(sess, dt) {
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
      if (n > 0) { center(String(n), 'count'); Sound.count(false); }
      else { center('GO!', 'count go'); Sound.count(true); startClock(sess); setTimeout(() => { if (S === sess) center(''); }, 700); }
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
  for (const cpu of sess.cpus) if (cpu.respawnAt > 0 && (cpu.respawnAt -= dt) <= 0) {
    const b = cpu.bike; b.respawn(b.checkpoint > 0 ? sess.level.checkpoints[b.checkpoint - 1] : 0);
  }
  if (sess.mode === 'online' && me.running) {
    sess.sendTimer -= dt;
    if (sess.sendTimer <= 0) {
      sess.sendTimer = 1 / C.POSE_HZ;
      const p = me.pose();
      Net.send({ t: 'state', p: [+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(3), +p[3].toFixed(2), +p[4].toFixed(2), p[5]], c: +me.time.toFixed(3) });
    }
  }
}

function startClock(sess) {
  sess.phase = 'run';
  sess.me.running = true;
  for (const cpu of sess.cpus) cpu.bike.running = true;
  if (sess.mode === 'solo') center('');
  Sound.init(); Sound.resume(); Sound.engineOn();
}

// ------------------------------------------------------------------------------------------------
// Drawing
function draw(sess) {
  const theme = sess.theme, t = clockT;
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
  const now = performance.now() / 1000, poses = [];
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
    for (const cpu of sess.cpus) if (!cpu.bike.crashed) A.drawTag(g, cam, cpu.bike.c.x, cpu.bike.c.y, cpu.look.name, cpu.look.paint.body);
    for (const [p, r] of poses) A.drawTag(g, cam, p.x, p.y, r.look.name, r.look.paint.body);
  }
}
const GHOST_PAINT = { body: '#ffffff', dark: '#d9d4e4', suit: '#e8e3f2', helmet: '#ffffff' };
function drawSimBike(b, look, alpha) {
  const pose = { x: b.c.x, y: b.c.y, a: b.c.a, lean: b.leanVis, wheels: b.wheels.map(W => [W.x, W.y, W.phi]), noRider: !!b.rider, loose: b.loose };
  A.drawBike(g, cam, pose, look, { alpha });
  if (b.loose) for (const W of b.wheels) A.drawWheel(g, cam, W.x, W.y, W.phi, look, alpha);
  if (b.rider) A.drawRagdoll(g, cam, b.rider, look.paint);
}
function ghostPose(frames, t) {
  const f = t * C.POSE_HZ, i = Math.max(0, Math.min(frames.length - 1, Math.floor(f))), j = Math.min(frames.length - 1, i + 1), k = Math.max(0, Math.min(1, f - i));
  const a = frames[i], b = frames[j];
  const x = a[0] + (b[0] - a[0]) * k;
  return { x, y: a[1] + (b[1] - a[1]) * k, a: a[2] + C.wrapAngle(b[2] - a[2]) * k, phi: -x / C.BASE.radius, lean: 0 };
}
// Another rider's pose a moment ago. Poses carry the sender's race clock, which r.off maps onto ours, and are drawn
// REMOTE_LAG behind so there is nearly always a newer one to blend towards.
const REMOTE_LAG = 0.1;
function remotePose(r, now) {
  const buf = r.buf;
  if (!buf.length) return null;
  const t = now - REMOTE_LAG - (r.off == null ? 0 : r.off);
  let i = buf.length - 1;
  while (i > 0 && buf[i - 1].t > t) i--;
  const b = buf[i], a = buf[Math.max(0, i - 1)];
  const span = b.t - a.t, k = span > 0 ? Math.max(0, Math.min(1, (t - a.t) / span)) : 1;
  const P = a.p, Q = b.p;
  return { x: P[0] + (Q[0] - P[0]) * k, y: P[1] + (Q[1] - P[1]) * k, a: P[2] + C.wrapAngle(Q[2] - P[2]) * k, phi: P[3] + (Q[3] - P[3]) * k, lean: Q[4], crashed: !!(Q[5] & 1), finished: !!(Q[5] & 2) };
}

// ------------------------------------------------------------------------------------------------
// HUD
let hudCache = {};
function setText(el, key, text) { if (hudCache[key] !== text) { hudCache[key] = text; el.textContent = text; } }
function hud() {
  const s = S, me = s.me;
  const t = me.finished ? me.finishTime : me.clock;
  setText(ui.time, 'time', fmt(t));
  const left = s.endsAt && !me.finished ? Math.max(0, Math.ceil(s.endsAt - performance.now() / 1000)) : -1;
  setText(ui.sub, 'sub', left >= 0 ? `Race ends in ${left}s` : s.subText || '');
  ui.sub.classList.toggle('hurry', left >= 0);
  // show the two touch halves until the race is under way
  const waiting = s.phase === 'ready' || s.phase === 'countdown';
  if (ui.touch.classList.contains('ready') !== waiting) ui.touch.classList.toggle('ready', waiting);
  // progress dots
  const L = s.level.finishX, pct = (x) => Math.max(0, Math.min(100, x / L * 100)).toFixed(1) + '%';
  ui.dotMe.style.left = pct(me.c.x);
  if (s.ghost && s.ghost.frames.length) { ui.dotGhost.hidden = false; ui.dotGhost.style.left = pct(ghostPose(s.ghost.frames, me.running ? me.time : 0).x); }
  else ui.dotGhost.hidden = true;
  const others = [];
  for (const cpu of s.cpus) others.push({ x: cpu.bike.c.x, color: cpu.look.paint.body, fin: cpu.bike.finished, ft: cpu.bike.finishTime });
  const now = performance.now() / 1000;
  for (const [, r] of s.remote) { const p = !r.gone && remotePose(r, now); if (p) others.push({ x: p.x, color: r.look.paint.body, fin: r.finishTime != null, ft: r.finishTime }); }
  while (ui.dotsOthers.children.length < others.length) { const d = document.createElement('span'); d.className = 'br-dot'; ui.dotsOthers.appendChild(d); }
  while (ui.dotsOthers.children.length > others.length) ui.dotsOthers.lastChild.remove();
  others.forEach((o, i) => { const d = ui.dotsOthers.children[i]; d.style.left = pct(o.x); d.style.background = o.color; });
  if (s.mode === 'cpu' || s.mode === 'online') {
    const all = [{ x: me.c.x, fin: me.finished, ft: me.finishTime, me: true }, ...others];
    all.sort((a, b) => (a.fin && b.fin) ? a.ft - b.ft : a.fin ? -1 : b.fin ? 1 : b.x - a.x);
    setText(ui.pos, 'pos', `${ordinal(all.findIndex(a => a.me) + 1)} / ${all.length}`);
  }
  // engine sound follows the rear wheel
  const R = me.wheels[0];
  Sound.engine(Math.min(1, Math.abs(R.om) / me.s.maxSpin), me.input.gas, me.running && !me.crashed && !me.finished && !s.paused);
}
let toastTimer = 0;
function toast(text, ms = 1800, cls = '') {
  ui.toast.textContent = text;
  ui.toast.className = 'br-toast outlined' + (cls ? ' ' + cls : '');
  ui.toast.style.animationDuration = ms + 'ms';
  void ui.toast.offsetWidth; ui.toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms);
}
function center(text, cls = '', tip = '') {
  ui.tipbar.textContent = tip; ui.tipbar.hidden = !tip;
  ui.center.className = 'br-center outlined ' + cls;
  ui.center.innerHTML = text;
  if (cls.includes('count')) { void ui.center.offsetWidth; ui.center.classList.add('pop'); }
}

// ------------------------------------------------------------------------------------------------
// Single player
function startSolo(levelId) {
  closeModals();
  S = makeSession('solo', levelId);
  save.lastWorld = S.world.id; persist();
  enterPlay();
  const best = save.best[levelId];
  const how = isPhone() ? 'Hold <b>GAS</b> to start' : 'Press <b>↑</b> to start';
  const tip = isPhone() && save.tilt && tilt.state !== 'denied' && tilt.state !== 'insecure' && tilt.state !== 'nosensor' && Object.keys(save.best).length < 3
    ? 'Turn your phone like a steering wheel to lean the bike.' : '';
  center(`<span class="br-lvl">${esc(S.world.name)} ${S.def.index + 1} · ${esc(S.def.name)}</span>${how}${best ? `<span class="br-best">Best ${fmt(best)}s</span>` : ''}`, 'ready', tip);
  S.subText = `${S.world.name} ${S.def.index + 1}`;
}
function restart() {
  if (!S) return;
  if (S.mode === 'solo') startSolo(S.levelId);
  else if (S.mode === 'cpu') startCpuRace(S.levelId, S.cpus.length);
}
function soloFinished(sess) {
  const id = sess.levelId, time = sess.me.finishTime, prev = save.best[id];
  const stars = C.starsFor(sess.def, time), prevStars = save.stars[id] || 0;
  sess.newBest = !prev || time < prev - 1e-9;
  sess.firstClear = !prev;
  sess.prevBest = prev;
  sess.stars = stars;
  const unlockedBefore = C.BIKES.filter(bikeUnlocked).length;
  if (sess.newBest) { save.best[id] = time; saveGhost(id, time, sess.rec, sess.me.type.id); }
  save.stars[id] = Math.max(prevStars, stars);
  persist();
  sess.newBike = C.BIKES.filter(bikeUnlocked).length > unlockedBefore ? C.BIKES.filter(bikeUnlocked).pop() : null;
  sess.phase = 'finished';
  sess.finishTimer = 1.2;
}
function showResult(sess) {
  const def = sess.def, time = sess.me.finishTime, stars = sess.stars;
  ui.resStars.forEach((el, i) => { el.classList.toggle('on', i < stars); el.style.animationDelay = (0.15 + i * 0.18) + 's'; });
  const lastInWorld = def.index === sess.world.levels.length - 1, lastWorld = sess.world === C.WORLDS[C.WORLDS.length - 1];
  ui.resTitle.textContent = sess.firstClear && lastInWorld ? (lastWorld ? 'Every world cleared!' : `${sess.world.name} cleared!`)
    : stars === 3 ? 'Perfect run!' : 'Level cleared!';
  ui.resTime.textContent = fmt(time) + 's';
  ui.resBest.textContent = fmt(save.best[def.id]) + 's';
  ui.resNew.hidden = !sess.newBest || !sess.prevBest;
  let hint = stars < 3 ? `Finish under ${fmt(stars < 2 ? C.twoStarTime(def) : def.par)}s for ${stars < 2 ? 2 : 3} stars.` : `Under par (${fmt(def.par)}s). Nice riding.`;
  if (sess.me.flips) hint += ` ${sess.me.flips} flip${sess.me.flips > 1 ? 's' : ''} took off ${(sess.me.flips * 0.5).toFixed(1)}s.`;
  if (sess.firstClear && lastInWorld && lastWorld) hint = `That was the last level. ${totalStars()} of ${C.LEVELS.length * 3} stars so far: go back for the rest.`;
  ui.resHint.textContent = hint;
  garageButtons();
  renderUnlock(sess);
  const nxt = nextLevelId(def.id);
  ui.resNext.hidden = !nxt || !levelUnlocked(C.levelById(nxt));
  ui.resNext.textContent = nxt && C.levelById(nxt).world !== def.world ? 'Next world' : 'Next level';
  openModal(ui.result);
}
function showCrash() {
  if (!S || S.mode !== 'solo') return;
  const kind = S.me.crashKind;
  const air = useTilt() ? 'In the air, turn the phone anticlockwise if the nose drops and clockwise if it rises.'
    : isPhone() ? 'In the air, lean back (‹) if the nose drops and forward (›) if it rises.'
    : 'Lean back (←) in the air if the nose drops, forward (→) if it rises.';
  const tips = kind === 'lava' || kind === 'fall' || kind === 'pit'
    ? ['Carry more speed into the jump to clear the gap.', 'Keep the gas on as you take off, and land level.']
    : [air, 'Land with both wheels at the same time for a smooth touchdown.', 'Ease off the gas before big bumps.', 'Lean the way the ground slopes where you will land.', 'Flips take 0.5s off your time each, if you land them.'];
  ui.crashText.textContent = tips[Math.floor(Math.random() * tips.length)];
  if (S.me.crashKind === 'lava') ui.crashTitle.textContent = 'Too hot!';
  else if (S.me.crashKind === 'fall' || S.me.crashKind === 'pit') ui.crashTitle.textContent = 'Down the pit!';
  else ui.crashTitle.textContent = 'Wipeout!';
  garageButtons();
  openModal(ui.crash);
}

// ------------------------------------------------------------------------------------------------
// Races against computer riders (works without any server)
const CPU_NAMES = ['Pip', 'Rusty', 'Juno', 'Mako', 'Zed', 'Fern', 'Bolt', 'Kiko'];
function startCpuRace(levelId, n) {
  closeModals();
  S = makeSession('cpu', levelId);
  n = Math.max(1, Math.min(3, n | 0));
  const bikes = ['scout', 'hopper', 'twister', 'bulldog', 'comet'];
  const skills = [{ maxSpeed: 13.6, kp: 2.2 }, { maxSpeed: 14.6, kp: 2.4 }, { maxSpeed: 15.4, kp: 2.6 }];
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
function beginCountdown(sess) { sess.phase = 'countdown'; sess.countdown = 3; sess.lastCount = -1; }
function cpuPlace(sess) { return 1 + sess.cpus.filter(c => c.bike.finished && c.bike.finishTime < sess.me.finishTime).length; }
function showCpuResults(sess) {
  // let the computer riders finish in fast-forward
  for (let k = 0; k < 120 * 90 && sess.cpus.some(c => !c.bike.finished); k++) {
    for (const cpu of sess.cpus) {
      cpu.bike.input = C.botInput(cpu.bike, cpu.cfg);
      if (cpu.bike.crashed && cpu.bike.time - cpu.bike.crashAt > 1.2) cpu.bike.respawn(cpu.bike.checkpoint > 0 ? sess.level.checkpoints[cpu.bike.checkpoint - 1] : 0);
    }
    sess.me.frozen = true;
    sess.sim.step();
  }
  sess.me.frozen = false;
  const rows = [{ name: myLook().name, color: myLook().paint.body, time: sess.me.finishTime, me: true },
    ...sess.cpus.map(c => ({ name: c.look.name, color: c.look.paint.body, time: c.bike.finished ? c.bike.finishTime : null }))];
  showStandings(rows, 'cpu');
}
function showStandings(rows, mode) {
  rows.sort((a, b) => (a.time == null) - (b.time == null) || (a.time || 0) - (b.time || 0));
  const myPlace = rows.findIndex(r => r.me) + 1;
  ui.rrTitle.textContent = myPlace === 1 ? 'You won!' : myPlace ? `${ordinal(myPlace)} place` : 'Race over';
  ui.rrList.innerHTML = standingRows(rows);
  const host = mode === 'online' && roomState && roomState.host === Net.id;
  ui.rrAgain.hidden = mode === 'online' && !host;
  ui.rrAgain.textContent = 'Race again';
  ui.rrRoom.textContent = mode === 'online' ? 'Back to room' : 'Change track';
  ui.rrLeave.hidden = mode !== 'online';
  ui.rrWait.hidden = !(mode === 'online' && !host);
  openModal(ui.raceResult);
  if (myPlace === 1) particles.burst(S.me.c.x, S.me.c.y + 2, ['#ffd43b', '#e8463c', '#43b05c', '#3a7bd5'], 50, 8);
}

// ------------------------------------------------------------------------------------------------
// Live races through the race server (tools/serve.py). The server keeps the rooms and passes messages on; every
// phone runs its own bike and sends its pose 20 times a second, and draws the others from their poses.
let roomState = null, roomsList = [], pendingJoin = null, listTimer = 0, lastResults = null;
const inRace = () => !!(S && S.mode === 'online' && view === 'play');
Net.on((m) => {
  switch (m.t) {
    case 'status':
      if (m.status === 'online') sendProfile();
      else if (m.status === 'connecting' && Net.retrying && inRace() && !S.reconnecting) { S.reconnecting = true; toast('Connection lost. Reconnecting…', 3000, 'small'); }
      else if (m.status === 'offline') {
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
      if (m.resumed && S && S.reconnecting) { S.reconnecting = false; toast('Back online', 1200, 'small'); }
      // we crossed the line while the connection was down: tell the server now (it ignores a second one)
      if (m.resumed && inRace() && S.me.finished && !S.finishHeard) Net.send({ t: 'finish', time: S.me.finishTime });
      if (pendingJoin) { Net.send({ t: 'join', code: pendingJoin }); pendingJoin = null; }
      else if (!roomState) Net.send({ t: 'list' });
      if (view === 'mp') renderMp();
      break;
    case 'replaced': toast('Bike Race was opened in another tab', 2600, 'small'); break;
    case 'rooms': roomsList = Array.isArray(m.rooms) ? m.rooms : []; if (view === 'mp') renderMp(); break;
    case 'room': {
      // back from a dropped connection into a room we meant to leave
      if (view !== 'mp' && !inRace()) { roomState = null; Net.send({ t: 'leave' }); break; }
      roomState = m;
      if (Array.isArray(m.last)) lastResults = { code: m.code, rows: resultRows(m.last) };
      if (S && S.mode === 'online') syncRemote(S);
      // the race ended while our connection was down, so the results never came: show the room's copy
      if (m.state === 'lobby' && inRace() && !S.results && S.phase !== 'countdown' && lastResults) showOnlineResults(lastResults.rows);
      // the server still counts us in a race we no longer have (we reloaded mid-race): give that place up
      if (m.state !== 'lobby' && (m.racers || []).includes(Net.id) && !inRace()) Net.send({ t: 'retire' });
      if (view === 'mp') renderMp();
      break;
    }
    case 'left': roomState = null; if (view === 'mp') renderMp(); break;
    case 'error': toast(m.msg || 'Something went wrong', 2600, 'small'); if (view === 'mp') renderMp(); break;
    case 'countdown': startOnlineRace(m); break;
    case 'state': {
      if (!S || S.mode !== 'online' || !Array.isArray(m.p)) break;
      const r = S.remote.get(m.id);
      if (!r) break;
      const now = performance.now() / 1000, c = typeof m.c === 'number' ? m.c : null;
      // map the sender's race clock onto ours by the quickest delivery seen; slower ones only add delay. The slow
      // creep upwards follows a sender whose game stalled for a moment (a phone pausing a page in the background).
      if (c != null) r.off = r.off == null ? now - c : Math.min(now - c, r.off + 0.02);
      const t = c != null ? c : now - (r.off || 0);
      if (r.buf.length && t <= r.buf[r.buf.length - 1].t) break;
      r.buf.push({ t, p: m.p });
      if (r.buf.length > 40) r.buf.shift();
      r.seen = now;
      const crashed = !!(m.p[5] & 1);
      if (crashed && !r.crashed && view === 'play') particles.burst(m.p[0], m.p[1] + 1, ['#ffd43b', '#ffffff'], 10, 4, 'star');
      r.crashed = crashed;
      break;
    }
    case 'finished': {
      if (!S || S.mode !== 'online') break;
      if (m.id === Net.id) { S.finishHeard = true; break; }
      const r = S.remote.get(m.id);
      if (r) { r.finishTime = m.time; if (inRace()) toast(`${r.look.name} finished · ${fmt(m.time)}s`, 2000, 'small'); }
      break;
    }
    case 'ending':
      if (S && S.mode === 'online' && typeof m.seconds === 'number') S.endsAt = performance.now() / 1000 + m.seconds;
      break;
    case 'results': {
      const rows = resultRows(m.results);
      lastResults = { code: roomState && roomState.code, rows };
      if (view === 'mp') renderMp();
      if (inRace()) showOnlineResults(rows);
      break;
    }
  }
});
const resultRows = (list) => (Array.isArray(list) ? list : []).map(r => ({ name: String(r.name), color: A.paintAt(r.paint).body, time: typeof r.time === 'number' ? r.time : null, me: r.id === Net.id }));
function showOnlineResults(rows) {
  const sess = S;
  sess.results = rows; sess.endsAt = 0;
  setTimeout(() => { if (S === sess && view === 'play') { center(''); closeModals(); showStandings(rows.map(r => ({ ...r })), 'online'); } }, sess.me.finished ? 700 : 0);
}
function sendProfile() { Net.send({ t: 'hello', name: (save.name || '').trim() || 'Rider', paint: save.paint, bike: save.bike, key: Net.key }); }
function lostRace(text) {
  const sess = S;
  toast(text, 2600, 'small');
  setTimeout(() => { if (S === sess && view === 'play') { exitPlay(); showView('mp'); } }, 1800);
}
function startOnlineRace(m) {
  if (!roomState || !Array.isArray(m.racers) || !m.racers.includes(Net.id) || !C.levelById(m.level)) return;
  if (view !== 'mp' && !inRace()) return;
  closeModals();
  S = makeSession('online', m.level);
  // everyone starts on the line with us, until their own poses arrive
  const start = S.me.pose(), now = performance.now() / 1000;
  for (const id of m.racers) if (id !== Net.id) S.remote.set(id, { buf: [{ t: 0, p: start }], off: null, seen: now, look: { bike: 'scout', paint: A.paintAt(0), name: '?' }, finishTime: null, crashed: false, gone: false });
  syncRemote(S);
  enterPlay();
  S.subText = `${S.world.name} ${S.def.index + 1} · Room ${roomState.code}`;
  beginCountdown(S);
  S.countdown = Math.max(1, +m.seconds || 3);
}
// names, bikes and paints from the room; riders who left the room drop out of the race
function syncRemote(sess) {
  if (!roomState) return;
  const here = new Set();
  for (const p of roomState.players || []) {
    here.add(p.id);
    const r = sess.remote.get(p.id);
    if (r) r.look = { bike: C.bikeById(p.bike).id, paint: A.paintAt(p.paint), name: p.name };
  }
  for (const [id, r] of sess.remote) if (!here.has(id)) r.gone = true;
}
const canShare = () => isPhone() && typeof navigator.share === 'function';
// The link that joins the room. A page opened on this computer as localhost would hand out a link nobody else can
// open, so when the server is reachable on the network it uses the server's network address instead.
function inviteLink() {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const base = local && Net.share ? Net.share + '/' : location.origin + location.pathname;
  return `${base}#bike-race/${roomState ? roomState.code : ''}`;
}
async function invite() {
  if (!roomState) return;
  const link = inviteLink();
  if (canShare()) {
    try { await navigator.share({ title: 'Bike Race', text: `Race me in Bike Race! Room ${roomState.code}`, url: link }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied', 1800, 'small'); } catch (e) { prompt('Copy this link', link); }
}

// ------------------------------------------------------------------------------------------------
// Menus
let ui = {};
const VIEWS = ['home', 'worlds', 'levels', 'garage', 'mp', 'desktop'];
function showView(v) {
  if (!isPhone() && !allowKeyboard && v !== 'play') v = 'desktop';
  view = v;
  for (const id of VIEWS) $('br-' + id).hidden = id !== v;
  ui.hud.hidden = v !== 'play';
  ui.touch.hidden = v !== 'play' || !isPhone();
  ui.center.hidden = v !== 'play';
  if (v !== 'play') { Sound.engineOff(); center(''); if (!attract) newAttract(); }
  if (v === 'home') renderHome();
  if (v === 'desktop') ui.deskUrl.textContent = location.origin + location.pathname + '#bike-race';
  if (v === 'worlds') renderWorlds();
  if (v === 'garage') renderGarage();
  if (v === 'mp') { Net.connect(); renderMp(); clearInterval(listTimer); listTimer = setInterval(() => { if (view === 'mp') { if (!roomState) Net.send({ t: 'list' }); renderConn(); } }, 3000); }
  else clearInterval(listTimer);
  const scr = $('br-' + v); if (scr) scr.scrollTop = 0;
}
function enterPlay() {
  hudCache = {};
  particles.list.length = 0;
  view = 'play';
  for (const id of VIEWS) $('br-' + id).hidden = true;
  ui.hud.hidden = false; ui.center.hidden = false;
  ui.touch.hidden = !isPhone();
  refreshControls();
  ui.pos.hidden = S.mode === 'solo';
  ui.retry.hidden = S.mode === 'online';
  followCamera(S, 0, true);
  cam.ppm = basePpm();
  acc = 0;
  hud();
}
function exitPlay() {
  closeModals();
  if (S && S.mode === 'online' && roomState) { /* stay in the room */ }
  S = null; Sound.engineOff();
}
function newAttract(random) {
  const pool = C.LEVELS.filter(levelUnlocked);
  let L = pool.filter(l => l.world === save.lastWorld);
  if (!L.length) L = pool;
  const pick = random ? L[Math.floor(Math.random() * L.length)] : L[0];
  attract = makeSession('attract', pick.id);
  followCamera(attract, 0, true);
  cam.ppm = basePpm();
}

const starSvg = (on) => `<svg viewBox="0 0 24 24" class="${on ? 'star-on' : 'star-off'}" aria-hidden="true"><path d="M12.0 2.3 L14.9 8.8 L22.0 9.6 L16.8 14.3 L18.2 21.3 L12.0 17.8 L5.8 21.3 L7.2 14.3 L2.0 9.6 L9.1 8.8 Z"/></svg>`;
const lockSvg = `<svg viewBox="0 0 24 24" class="br-lock" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke-width="2.6"/></svg>`;

function renderHome() {
  ui.homeStars.textContent = `${totalStars()} / ${C.LEVELS.length * 3}`;
  for (const [id, on] of [['br-go-mp', FEATURES.multiplayer], ['br-go-garage', FEATURES.garage]]) {
    const b = $(id); b.disabled = !on; b.classList.toggle('soon', !on);
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
    b.type = 'button'; b.className = 'br-world' + (open ? '' : ' locked');
    b.disabled = !open;
    b.innerHTML = `<canvas width="320" height="200"></canvas><div class="nm outlined">${esc(w.name)}</div><div class="ds">${esc(open ? w.blurb : 'Finish ' + C.WORLDS[i - 1].name + ' to unlock')}</div>
      <div class="br-wstars">${starSvg(true)}<span>${worldStars(w)} / ${w.levels.length * 3}</span></div>${open ? '' : lockSvg}`;
    b.onclick = () => { save.lastWorld = w.id; persist(); renderLevels(w); showLevels(); };
    ui.worldCards.appendChild(b);
    requestAnimationFrame(() => A.drawThumb(b.querySelector('canvas'), w, getLevel(w.levels[Math.min(2, w.levels.length - 1)].id)));
  });
}
function showLevels() { view = 'levels'; for (const id of VIEWS) $('br-' + id).hidden = id !== 'levels'; $('br-levels').scrollTop = 0; }
function renderLevels(w) {
  ui.levelsTitle.textContent = w.name;
  ui.levelsStars.textContent = `${worldStars(w)} / ${w.levels.length * 3}`;
  ui.levelsSub.textContent = w.blurb;
  ui.levelGrid.innerHTML = '';
  w.levels.forEach((L, i) => {
    const open = levelUnlocked(L), st = save.stars[L.id] || 0, best = save.best[L.id];
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'card br-level' + (open ? '' : ' locked'); b.disabled = !open;
    b.innerHTML = `<div class="lv">Level ${i + 1}</div><div class="n outlined">${i + 1}</div><div class="nm2">${esc(L.name)}</div>
      <div class="br-lstars">${[0, 1, 2].map(k => starSvg(k < st)).join('')}</div><div class="bt">${best ? 'Best ' + fmt(best) + 's' : open ? 'Par ' + fmt(L.par) + 's' : ''}</div>${open ? '' : lockSvg}`;
    b.onclick = () => startSolo(L.id);
    ui.levelGrid.appendChild(b);
  });
}

// ------------------------------------------------------------------------------------------------
// Garage: pick a bike (each unlocks at a total number of stars), a paint and a rider name. Every choice is saved
// as soon as it is made. It opens from the home menu, and from the pause, crash and result sheets during a run;
// leaving it then goes back to that sheet, or restarts the level when the bike changed.
const garage = { focus: 'scout', t: 0, rev: 0, hop: 0, shake: 0, from: null };
const STAT_NAMES = [['speed', 'Speed'], ['grip', 'Grip'], ['spin', 'Flips'], ['air', 'Air']];
const starTiny = '<svg viewBox="0 0 24 24" class="star-on" aria-hidden="true"><path d="M12.0 2.3 L14.9 8.8 L22.0 9.6 L16.8 14.3 L18.2 21.3 L12.0 17.8 L5.8 21.3 L7.2 14.3 L2.0 9.6 L9.1 8.8 Z"/></svg>';

function openGarage(focus) {
  if (!FEATURES.garage) return;
  garage.from = null;
  if (view === 'play' && S && S.mode !== 'online') {
    const open = [['pause', ui.pause], ['crash', ui.crash], ['result', ui.result], ['race', ui.raceResult]].find(([, m]) => !m.hidden);
    garage.from = { modal: open ? open[0] : 'pause', bike: save.bike };
    S.paused = true;
    closeModals();
  }
  garage.focus = focus || save.bike;
  garage.rev = 0; garage.hop = 0; garage.shake = 0;
  showView('garage');
}
function closeGarage() {
  const from = garage.from;
  garage.from = null;
  if (!from || !S) { showView('home'); return; }
  // a different bike, or a run that hadn't started yet: start the level again on the bike now chosen
  if (from.modal === 'pause' && (from.bike !== save.bike || S.phase === 'ready')) { restart(); return; }
  S.me.look = { ...myLook(), bike: S.me.type.id };     // new paint and name show straight away
  enterPlay();
  if (from.modal === 'pause') pause();
  else if (from.modal === 'crash') openModal(ui.crash);
  else if (from.modal === 'result') { renderUnlock(S); openModal(ui.result); }
  else openModal(ui.raceResult);
}
function pickBike(b) {
  garage.focus = b.id;
  if (bikeUnlocked(b)) {
    if (!save.seen.includes(b.id)) save.seen.push(b.id);
    if (save.bike !== b.id) {
      save.bike = b.id;
      garage.rev = 1;
      Sound.blip(196, 0.18, 'sawtooth', 0.1); Sound.blip(294, 0.22, 'sawtooth', 0.08, 0.1);
      if (Net.status === 'online') sendProfile();
      newAttract();
    }
    persist();
  } else { garage.shake = 1; Sound.blip(160, 0.14, 'square', 0.08); }
  renderGarage();
}
function pickPaint(i) {
  save.paint = i; persist();
  garage.focus = save.bike; garage.hop = 1;
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
    const open = bikeUnlocked(b), riding = save.bike === b.id, fresh = open && !save.seen.includes(b.id);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'br-gbike' + (riding ? ' riding' : '') + (open ? '' : ' locked') + (garage.focus === b.id ? ' focus' : '');
    el.setAttribute('role', 'radio');
    el.setAttribute('aria-checked', String(riding));
    el.setAttribute('aria-label', open ? `${b.name}, ${b.perk}` : `${b.name}, locked until ${b.stars} stars`);
    el.innerHTML = `<canvas width="176" height="104"></canvas><span class="nm">${esc(b.name)}</span>`
      + `<span class="st">${riding ? 'Riding' : open ? esc(b.perk) : `${starTiny}${b.stars}`}</span>`
      + (fresh ? '<em class="br-new">New</em>' : '') + (open ? '' : lockSvg);
    el.onclick = () => pickBike(b);
    ui.bikes.appendChild(el);
    drawBikeThumb(el.querySelector('canvas'), b, !open);
  }
  ui.paints.innerHTML = '';
  A.PAINTS.forEach((p, i) => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'br-paint' + (i === save.paint ? ' sel' : '');
    el.style.setProperty('--body', p.body); el.style.setProperty('--suit', p.suit);
    el.setAttribute('role', 'radio'); el.setAttribute('aria-label', p.id); el.setAttribute('aria-checked', String(i === save.paint));
    el.onclick = () => pickPaint(i);
    ui.paints.appendChild(el);
  });
  // the bike on show
  const b = C.bikeById(garage.focus), open = bikeUnlocked(b), st = C.bikeStats(b);
  ui.gName.textContent = b.name;
  ui.gPerk.textContent = b.perk;
  ui.gBlurb.textContent = b.blurb;
  ui.gStats.innerHTML = STAT_NAMES.map(([k, label]) => `<div><span>${label}</span><i><b style="width:${Math.round(12 + st[k] * 88)}%"></b></i></div>`).join('');
  if (save.bike === b.id) ui.gStatus.innerHTML = '<span class="br-chip go">Riding this bike</span>';
  else if (open) {
    ui.gStatus.innerHTML = `<button class="b go outlined br-ride" type="button">Ride ${esc(b.name)}</button>`;
    ui.gStatus.firstElementChild.onclick = () => pickBike(b);
  }
  else {
    const prev = Math.max(0, ...C.BIKES.filter(x => x.stars < b.stars).map(x => x.stars)), need = b.stars - total;
    const pct = Math.max(0, Math.min(1, (total - prev) / (b.stars - prev)));
    ui.gStatus.innerHTML = `<div class="br-lockline">${lockSvg}<b>${need} more star${need === 1 ? '' : 's'}</b><span class="n">${starTiny}${total} / ${b.stars}</span></div><i class="br-meter"><b style="width:${Math.round(pct * 100)}%"></b></i>`;
  }
  ui.garage.classList.toggle('locked', !open);
}
// a still bike for the strip and the result sheet; locked bikes are a dark outline
function drawBikeThumb(cv, b, locked) {
  const gg = cv.getContext('2d'), c2 = new A.Camera();
  c2.W = cv.width; c2.H = cv.height; c2.ppm = Math.min(cv.height / 2.35, cv.width / 2.3); c2.x = 0; c2.y = 0.27;
  gg.setTransform(1, 0, 0, 1, 0, 0);
  gg.clearRect(0, 0, cv.width, cv.height);
  gg.fillStyle = 'rgba(59,35,38,0.12)'; gg.beginPath(); gg.ellipse(cv.width / 2, c2.sy(-0.8), c2.ppm * 1.05, c2.ppm * 0.09, 0, 0, Math.PI * 2); gg.fill();
  drawBikeOn(gg, c2, { x: 0, y: 0, a: 0, lean: 0, phi: 0.4 }, { bike: b.id, paint: A.paintAt(save.paint) }, locked);
}
const silCanvas = document.createElement('canvas');
function drawBikeOn(gg, c2, pose, look, locked) {
  if (!locked) { A.drawBike(gg, c2, pose, look); return; }
  const W = gg.canvas.width, H = gg.canvas.height;
  if (silCanvas.width !== W || silCanvas.height !== H) { silCanvas.width = W; silCanvas.height = H; }
  const sg = silCanvas.getContext('2d');
  sg.setTransform(1, 0, 0, 1, 0, 0); sg.globalCompositeOperation = 'source-over'; sg.clearRect(0, 0, W, H);
  sg.setTransform(gg.getTransform());
  A.drawBike(sg, c2, pose, look);
  sg.setTransform(1, 0, 0, 1, 0, 0); sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = '#6b5559'; sg.fillRect(0, 0, W, H);
  sg.globalCompositeOperation = 'source-over';
  gg.save(); gg.setTransform(1, 0, 0, 1, 0, 0); gg.globalAlpha = 0.5; gg.drawImage(silCanvas, 0, 0); gg.restore();
}
// The showroom: the bike on a turntable with your name on it. It idles, pops a wheelie when you pick it,
// hops when you repaint it, and shakes its head when you tap a locked bike.
function drawStage(dt) {
  const cv = ui.gStage, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const d = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
  const gg = cv.getContext('2d');
  gg.setTransform(d, 0, 0, d, 0, 0);
  gg.clearRect(0, 0, w, h);
  garage.t += dt;
  garage.rev = Math.max(0, garage.rev - dt / 0.9); garage.hop = Math.max(0, garage.hop - dt / 0.45); garage.shake = Math.max(0, garage.shake - dt / 0.4);
  const b = C.bikeById(garage.focus), open = bikeUnlocked(b), t = garage.t;
  const c2 = new A.Camera();
  c2.W = w; c2.H = h; c2.ppm = Math.max(20, Math.min(h / 3.05, w / 2.75)); c2.x = 0.02; c2.y = 0.1;
  // spotlight and turntable
  const cx = c2.sx(0), floor = c2.sy(-0.8), ppm = c2.ppm;
  const glowR = Math.min(ppm * 1.9, w * 0.5, h * 0.62), glow = gg.createRadialGradient(cx, floor - ppm * 0.9, glowR * 0.1, cx, floor - ppm * 0.9, glowR);
  glow.addColorStop(0, open ? 'rgba(255,224,130,0.55)' : 'rgba(200,190,205,0.45)'); glow.addColorStop(1, 'rgba(255,224,130,0)');
  gg.fillStyle = glow; gg.fillRect(0, 0, w, h);
  const rx = ppm * 1.3, ry = ppm * 0.2, band = ppm * 0.22;
  gg.fillStyle = '#c9b8bf'; gg.beginPath(); gg.ellipse(cx, floor + band, rx, ry, 0, 0, Math.PI); gg.lineTo(cx - rx, floor); gg.ellipse(cx, floor, rx, ry, 0, Math.PI, 0, true); gg.closePath(); gg.fill();
  gg.fillStyle = '#efe6ea'; gg.beginPath(); gg.ellipse(cx, floor, rx, ry, 0, 0, Math.PI * 2); gg.fill();
  gg.strokeStyle = 'rgba(59,35,38,0.12)'; gg.lineWidth = 2;
  for (let i = 0; i < 6; i++) { const a = t * 0.5 + i * Math.PI / 3; gg.beginPath(); gg.moveTo(cx, floor); gg.lineTo(cx + Math.cos(a) * rx * 0.96, floor + Math.sin(a) * ry * 0.96); gg.stroke(); }
  gg.fillStyle = 'rgba(59,35,38,0.16)'; gg.beginPath(); gg.ellipse(cx, floor, rx * 0.78, ry * 0.55, 0, 0, Math.PI * 2); gg.fill();
  gg.strokeStyle = '#3b2326'; gg.lineWidth = 2.5; gg.beginPath(); gg.ellipse(cx, floor, rx, ry, 0, 0, Math.PI * 2); gg.moveTo(cx - rx, floor); gg.lineTo(cx - rx, floor + band); gg.ellipse(cx, floor + band, rx, ry, 0, Math.PI, 0, true); gg.lineTo(cx + rx, floor); gg.stroke();
  // the rider's name on the front of the turntable
  const nm = (save.name || 'Rider').toUpperCase();
  gg.font = `${Math.round(Math.max(10, band * 0.78))}px 'Lilita One', 'Trebuchet MS', sans-serif`; gg.textAlign = 'center'; gg.textBaseline = 'middle';
  gg.fillStyle = '#7c6870'; gg.fillText(nm, cx, floor + band * 0.5 + ry * 0.92);
  // the bike: idle sway, a wheelie on the back wheel when picked, a hop when repainted
  const k = garage.rev > 0 ? Math.sin(Math.PI * (1 - garage.rev)) : 0;
  const a = 0.32 * k, rwx = C.BASE.anchors[0][0], rwy = C.BASE.anchors[0][1] - 0.04;
  const [ox, oy] = C.rot(a, rwx, rwy);
  const hop = garage.hop > 0 ? 0.16 * Math.sin(Math.PI * (1 - garage.hop)) : 0;
  const pose = { x: rwx - ox + Math.sin(t * 46) * 0.05 * garage.shake, y: rwy - oy + hop, a, lean: open ? Math.sin(t * 1.7) * 0.14 + k * 0.6 : 0, phi: 0.4 - (1 - garage.rev) * (garage.rev > 0 ? 9 : 0) };
  drawBikeOn(gg, c2, pose, { bike: b.id, paint: A.paintAt(save.paint) }, !open);
  if (!open) {
    // a big padlock over the outline
    const lx = c2.sx(0), ly = c2.sy(0.25), s = ppm * 0.36;
    gg.fillStyle = '#fdfbfd'; gg.strokeStyle = '#3b2326'; gg.lineWidth = Math.max(2, s * 0.12);
    gg.beginPath(); gg.arc(lx, ly - s * 0.3, s * 0.42, Math.PI, 0); gg.stroke();
    gg.beginPath(); gg.roundRect ? gg.roundRect(lx - s * 0.62, ly - s * 0.3, s * 1.24, s * 0.95, s * 0.18) : gg.rect(lx - s * 0.62, ly - s * 0.3, s * 1.24, s * 0.95); gg.fill(); gg.stroke();
    gg.fillStyle = '#3b2326'; gg.beginPath(); gg.arc(lx, ly + s * 0.1, s * 0.12, 0, Math.PI * 2); gg.fill(); gg.fillRect(lx - s * 0.05, ly + s * 0.1, s * 0.1, s * 0.28);
  }
}
// the "new bike" or "next bike" card on the result sheet
function renderUnlock(sess) {
  const el = ui.resUnlock, fresh = sess && sess.newBike, next = nextLockedBike(), b = fresh || next;
  el.hidden = !FEATURES.garage || !b;
  ui.resGarage.classList.toggle('sky', !!fresh); ui.resGarage.classList.toggle('plain', !fresh);
  if (el.hidden) return;
  const total = totalStars();
  el.classList.toggle('fresh', !!fresh);
  ui.resUnlockTitle.textContent = fresh ? `New bike: ${fresh.name}!` : `Next bike: ${next.name}`;
  ui.resUnlockSub.textContent = fresh ? `${fresh.perk}. Try it in the garage.` : `${total} / ${next.stars} stars`;
  const prev = Math.max(0, ...C.BIKES.filter(x => x.stars < b.stars).map(x => x.stars));
  ui.resUnlockMeter.hidden = !!fresh;
  ui.resUnlockMeter.firstElementChild.style.width = Math.round(Math.max(0, Math.min(1, (total - prev) / (b.stars - prev))) * 100) + '%';
  drawBikeThumb(el.querySelector('canvas'), b, !fresh);
}
function garageButtons() {
  const off = !FEATURES.garage || (S && S.mode === 'online');
  for (const el of document.querySelectorAll('.br-to-garage')) el.hidden = off;
}

function levelOptions(sel, selected) {
  sel.innerHTML = C.WORLDS.map(w => `<optgroup label="${esc(w.name)}">${w.levels.map((L, i) => `<option value="${L.id}"${L.id === selected ? ' selected' : ''}>${i + 1}. ${esc(L.name)}</option>`).join('')}</optgroup>`).join('');
}
function renderMpStatus() {
  const st = Net.status;
  ui.mpStatus.dataset.state = st === 'idle' ? 'connecting' : st;
  ui.mpStatusText.textContent = st === 'online' ? 'Connected to the race server' : st === 'offline' ? 'No race server found'
    : Net.retrying ? 'Reconnecting…' : 'Looking for the race server…';
}
// how this phone reaches the race server, for checking a real phone (an iPhone may end up on the event stream)
function renderConn() {
  if (!ui.roomConn) return;
  const kind = Net.transport;
  ui.roomConn.textContent = kind ? `Connected over ${kind === 'ws' ? 'a WebSocket' : 'an event stream'}${Net.pingMs ? ` · ping ${Net.pingMs} ms` : ''}` : '';
}
const standingRows = (rows) => rows.map((r, i) => `<li class="${r.me ? 'me' : ''}"><span class="pl">${i + 1}</span><span class="sw" style="background:${esc(r.color)}"></span><span class="nm">${esc(r.name)}</span><span class="tm">${r.time == null ? 'DNF' : fmt(r.time) + 's'}</span></li>`).join('');
function renderMp() {
  if (!ui.mpLobby) return;
  renderMpStatus();
  const online = Net.status === 'online';
  ui.mpLobby.hidden = !online || !!roomState;
  ui.mpRoom.hidden = !online || !roomState;
  ui.mpCpu.hidden = online && !!roomState;
  ui.mpNamePanel.hidden = online && !!roomState;      // in a room the name is on the riders list, and the garage changes it
  ui.mpOffline.hidden = Net.status !== 'offline';
  ui.mpOfflineWhy.textContent = pendingJoin ? `Room ${pendingJoin} is on a race server that this page can't reach.` : 'Live races need the race server.';
  ui.mpName.value = document.activeElement === ui.mpName ? ui.mpName.value : (save.name || '');
  if (!ui.cpuLevel.options.length) levelOptions(ui.cpuLevel, C.LEVELS.find(levelUnlocked).id);
  [...ui.cpuCount.children].forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.n === save.cpu)));
  if (online && !roomState) {
    if (!ui.mpLevel.options.length) levelOptions(ui.mpLevel, 'clover-1');
    const open = roomsList.filter(r => r.state === 'lobby' && r.count < 6);
    ui.mpRooms.innerHTML = open.length ? open.map(r => {
      const L = C.levelById(r.level), w = L && C.worldOf(r.level);
      return `<li><span class="code">${esc(r.code)}</span><span class="who"><b>${esc(r.host)}</b><small>${w ? esc(w.name + ' ' + (L.index + 1)) : ''} · ${r.count} rider${r.count > 1 ? 's' : ''}</small></span><button class="b sky outlined" type="button" data-code="${esc(r.code)}">Join</button></li>`;
    }).join('') : '<li class="empty">No open rooms yet. Start one and share the code.</li>';
    ui.mpRooms.querySelectorAll('button[data-code]').forEach(b => b.onclick = () => { sendProfile(); Net.send({ t: 'join', code: b.dataset.code }); });
  }
  if (online && roomState) {
    const r = roomState, host = r.host === Net.id, players = r.players || [], racing = r.state !== 'lobby';
    ui.roomCode.textContent = r.code;
    ui.roomLink.textContent = inviteLink().replace(/^https?:\/\//, '');
    ui.roomCopy.textContent = canShare() ? 'Invite' : 'Copy invite link';
    const L = C.levelById(r.level), w = L && C.worldOf(r.level);
    ui.roomLevel.hidden = !host || racing; ui.roomLevelText.hidden = host && !racing;
    if (host) { if (ui.roomLevel.dataset.for !== r.code || ui.roomLevel.value !== r.level) { levelOptions(ui.roomLevel, r.level); ui.roomLevel.dataset.for = r.code; } }
    ui.roomLevelText.textContent = L ? `${w.name} ${L.index + 1} · ${L.name}` : r.level;
    const racers = racing ? r.racers || [] : [];
    ui.roomPlayers.innerHTML = players.map(p => `<li class="${p.away ? 'away' : ''}"><span class="sw" style="background:${A.paintAt(p.paint).body}"></span><span class="nm">${esc(p.name)}${p.id === Net.id ? ' <small>(you)</small>' : ''}${p.id === r.host ? ' <small>host</small>' : ''}${p.away ? ' <small>away</small>' : racers.includes(p.id) ? ' <small>racing</small>' : ''}</span><span class="bk">${esc(C.bikeById(p.bike).name)}</span><span class="wn">${p.wins || 0} win${p.wins === 1 ? '' : 's'}</span></li>`).join('');
    ui.roomStart.hidden = !host || racing;
    const hostName = (players.find(p => p.id === r.host) || {}).name || 'the host';
    ui.roomNote.textContent = racing ? 'A race is on. You will be in the next one.'
      : host ? (players.length > 1 ? 'Everyone here? Start the race.' : 'Share the code or the link. You can also start alone to warm up.')
      : `Waiting for ${hostName} to start the race.`;
    const last = lastResults && lastResults.code === r.code ? lastResults : null;
    ui.roomLast.hidden = !last;
    if (last) ui.roomLastList.innerHTML = standingRows(last.rows);
    renderConn();
  }
}

// ------------------------------------------------------------------------------------------------
// Modals
function openModal(m) { m.hidden = false; const b = m.querySelector('.b.go:not([hidden]), .b:not([hidden])'); if (b && !isPhone()) setTimeout(() => b.focus(), 50); }
function closeModals() { for (const m of [ui.pause, ui.crash, ui.result, ui.raceResult]) m.hidden = true; }
const anyModalOpen = () => [ui.pause, ui.crash, ui.result, ui.raceResult].some(m => !m.hidden);
function pause() {
  if (!S || anyModalOpen()) return;
  if (S.mode !== 'online') S.paused = true;
  ui.pauseText.textContent = S.mode === 'online' ? 'The race keeps going while this menu is open.' : `${S.world.name} ${S.def.index + 1} · ${S.def.name}` + (save.best[S.levelId] && S.mode === 'solo' ? ` · Best ${fmt(save.best[S.levelId])}s` : '');
  ui.pRestart.hidden = S.mode === 'online';
  ui.pLevels.textContent = S.mode === 'solo' ? 'Levels' : 'Leave race';
  ui.pGhostRow.hidden = S.mode !== 'solo';
  garageButtons();
  syncToggles();
  openModal(ui.pause);
}
// a run that is going and can be stopped: your own, or a race against computer riders (live races can't wait)
const shouldAutoPause = () => view === 'play' && !!S && (S.mode === 'solo' ? S.phase === 'run' : S.mode === 'cpu' && (S.phase === 'run' || S.phase === 'countdown') && !S.me.finished);
function resume() { closeModals(); if (S) { S.paused = false; last = performance.now(); } }
function syncToggles() {
  for (const [el, on] of [[ui.tGhost, save.ghost], [ui.tSound, save.sound], [ui.pTilt, save.tilt]]) if (el) el.setAttribute('aria-pressed', String(!!on));
  if (ui.soundBtn) ui.soundBtn.setAttribute('aria-pressed', String(!!save.sound));
  if (ui.pTiltRow) ui.pTiltRow.hidden = !isPhone();
}
function leaveToMenu() {
  const mode = S && S.mode, w = S && S.world;
  exitPlay();
  if (mode === 'solo') { renderLevels(w); showView('levels'); showLevels(); }
  else showView(mode === 'online' || mode === 'cpu' ? 'mp' : 'home');
}

// ------------------------------------------------------------------------------------------------
function setup() {
  app = $('br-app'); canvas = $('br-canvas'); g = canvas.getContext('2d');
  ui = {
    hud: $('br-hud'), time: $('br-time'), sub: $('br-sub'), pos: $('br-pos'), retry: $('br-retry'), soundBtn: $('br-sound'),
    dotMe: $('br-dot-me'), dotGhost: $('br-dot-ghost'), dotsOthers: $('br-dots'),
    center: $('br-center'), toast: $('br-toast'), touch: $('br-touch'), tipbar: $('br-tipbar'),
    homeStars: $('br-home-stars'), homeHow: $('br-home-how'),
    worldCards: $('br-world-cards'), worldsStars: $('br-worlds-stars'),
    levelsTitle: $('br-levels-title'), levelsSub: $('br-levels-sub'), levelsStars: $('br-levels-stars'), levelGrid: $('br-level-grid'),
    garage: $('br-garage'), bikes: $('br-bikes'), paints: $('br-paints'), name: $('br-name'), garageStars: $('br-garage-stars'),
    gStage: $('br-g-stage'), gName: $('br-g-name'), gPerk: $('br-g-perk'), gBlurb: $('br-g-blurb'), gStats: $('br-g-stats'), gStatus: $('br-g-status'),
    pause: $('br-pausemenu'), pauseText: $('br-pause-text'), pRestart: $('br-p-restart'), pLevels: $('br-p-levels'), tGhost: $('br-t-ghost'), tSound: $('br-t-sound'), pGhostRow: $('br-p-ghost-row'), pTilt: $('br-p-tilt'), pTiltRow: $('br-p-tilt-row'), pTiltWhy: $('br-p-tilt-why'),
    crash: $('br-crash'), crashTitle: $('br-crash-title'), crashText: $('br-crash-text'),
    result: $('br-result'), resStars: [...document.querySelectorAll('#br-result .br-rstar')], resTitle: $('br-res-title'), resTime: $('br-res-time'), resBest: $('br-res-best'), resNew: $('br-res-new'), resHint: $('br-res-hint'), resNext: $('br-res-next'),
    resUnlock: $('br-res-unlock'), resUnlockTitle: $('br-res-unlock-title'), resUnlockSub: $('br-res-unlock-sub'), resUnlockMeter: $('br-res-unlock-meter'), resGarage: $('br-res-garage'),
    raceResult: $('br-raceresult'), rrTitle: $('br-rr-title'), rrList: $('br-rr-list'), rrAgain: $('br-rr-again'), rrRoom: $('br-rr-room'), rrWait: $('br-rr-wait'), rrLeave: $('br-rr-leave'),
    mpStatus: $('br-mp-status'), mpStatusText: $('br-mp-status-text'), mpName: $('br-mp-name'), mpLobby: $('br-mp-lobby'), mpRoom: $('br-mp-room'), mpOffline: $('br-mp-offline'), mpOfflineWhy: $('br-mp-offline-why'), mpCpu: $('br-mp-cpu'), mpNamePanel: $('br-mp-name-panel'),
    mpLevel: $('br-mp-level'), mpRooms: $('br-mp-rooms'), mpCode: $('br-mp-code'),
    roomCode: $('br-room-code'), roomLink: $('br-room-link'), roomCopy: $('br-room-copy'), roomLevel: $('br-room-level'), roomLevelText: $('br-room-level-text'), roomPlayers: $('br-room-players'), roomStart: $('br-room-start'), roomNote: $('br-room-note'), roomLast: $('br-room-last'), roomLastList: $('br-room-last-list'),
    cpuLevel: $('br-cpu-level'), cpuCount: $('br-cpu-count'), deskUrl: $('br-desk-url'), roomConn: $('br-room-conn'),
  };
  app.classList.toggle('touch', isPhone());
  const go = (fn) => (e) => { Sound.init(); Sound.resume(); fn(e); };
  // home
  const toHub = () => { leaveFullscreen(); if (window.GameHub) window.GameHub.menu(); };
  $('br-home-back').onclick = toHub;
  $('br-go-solo').onclick = go(() => { goFullscreen(); showView('worlds'); });
  $('br-desk-back').onclick = toHub;
  $('br-desk-keys').onclick = () => { allowKeyboard = true; showView('home'); };
  // any tap in the game may be the first one: iOS only shows its motion permission prompt from a tap
  app.addEventListener('click', () => { startTilt(); Sound.unlock(); }, true);
  app.addEventListener('touchend', () => Sound.unlock(), true);
  // a soft tick for menu buttons (not the gas and brake)
  app.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && !b.closest('.br-touch') && !b.disabled) Sound.tap(); });
  $('br-rotate-back').onclick = toHub;
  $('br-go-mp').onclick = go(() => showView('mp'));
  $('br-go-garage').onclick = go(() => openGarage());
  $('br-worlds-back').onclick = () => showView('home');
  $('br-levels-back').onclick = () => showView('worlds');
  $('br-garage-back').onclick = () => closeGarage();
  $('br-mp-back').onclick = () => { if (roomState) Net.send({ t: 'leave' }); roomState = null; showView('home'); };
  // garage
  const setName = (v) => { save.name = cleanName(v); persist(); };
  ui.name.oninput = () => setName(ui.name.value);
  ui.name.onchange = () => { ui.name.value = save.name = cleanName(ui.name.value.trim()); persist(); if (Net.status === 'online') sendProfile(); };
  ui.name.onkeydown = (e) => { if (e.key === 'Enter') ui.name.blur(); };
  for (const id of ['br-p-garage', 'br-crash-garage', 'br-res-garage']) $(id).onclick = go(() => openGarage(S && S.newBike && S.newBike.id));
  ui.resUnlock.onclick = go(() => openGarage(S && S.newBike ? S.newBike.id : (nextLockedBike() || {}).id));
  // play HUD
  $('br-pause').onclick = () => pause();
  ui.retry.onclick = () => restart();
  ui.soundBtn.onclick = () => { save.sound = !save.sound; persist(); Sound.init(); Sound.setOn(save.sound); syncToggles(); };
  // pause menu
  $('br-p-resume').onclick = () => resume();
  ui.pRestart.onclick = () => restart();
  ui.pLevels.onclick = () => { if (S && S.mode === 'online') Net.send({ t: 'retire' }); leaveToMenu(); };
  ui.tGhost.onclick = () => { save.ghost = !save.ghost; persist(); if (S && S.mode === 'solo') S.ghost = save.ghost ? loadGhost(S.levelId) : null; syncToggles(); };
  ui.tSound.onclick = () => { save.sound = !save.sound; persist(); Sound.init(); Sound.setOn(save.sound); syncToggles(); };
  ui.pTilt.onclick = () => setTilt(!save.tilt);
  // crash and result
  $('br-crash-retry').onclick = () => restart();
  $('br-crash-levels').onclick = () => leaveToMenu();
  ui.resNext.onclick = () => { const n = nextLevelId(S.levelId); if (n) startSolo(n); };
  $('br-res-retry').onclick = () => restart();
  $('br-res-levels').onclick = () => leaveToMenu();
  // race results
  ui.rrAgain.onclick = () => {
    if (!S) return;
    if (S.mode === 'cpu') startCpuRace(S.levelId, S.cpus.length);
    else if (S.mode === 'online') Net.send({ t: 'start' });     // the countdown closes the sheet
  };
  ui.rrRoom.onclick = () => { exitPlay(); showView('mp'); };
  $('br-rr-leave').onclick = () => { if (S && S.mode === 'online') Net.send({ t: 'leave' }); roomState = null; exitPlay(); showView('mp'); };
  // multiplayer lobby
  ui.mpName.oninput = () => { setName(ui.mpName.value); };
  ui.mpName.onchange = () => sendProfile();
  $('br-mp-create').onclick = () => { sendProfile(); Net.send({ t: 'create', level: ui.mpLevel.value }); };
  const joinCode = () => {
    const c = ui.mpCode.value.trim().toUpperCase();
    if (c.length !== 4) { toast('Room codes have 4 letters', 2000, 'small'); ui.mpCode.focus(); return; }
    sendProfile(); Net.send({ t: 'join', code: c });
  };
  ui.mpCode.oninput = () => { const v = ui.mpCode.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); if (v !== ui.mpCode.value) ui.mpCode.value = v; };
  $('br-mp-join').onclick = joinCode;
  ui.mpCode.onkeydown = (e) => { if (e.key === 'Enter') joinCode(); };
  $('br-mp-retry').onclick = () => { Net.close(); Net.connect(); renderMp(); };
  ui.roomLevel.onchange = () => Net.send({ t: 'level', level: ui.roomLevel.value });
  ui.roomStart.onclick = () => Net.send({ t: 'start' });
  $('br-room-leave').onclick = () => { Net.send({ t: 'leave' }); roomState = null; renderMp(); };
  ui.roomCopy.onclick = () => invite();
  ui.cpuCount.querySelectorAll('button').forEach(b => b.onclick = () => { save.cpu = +b.dataset.n; persist(); renderMp(); });
  $('br-cpu-start').onclick = go(() => startCpuRace(ui.cpuLevel.value, save.cpu));
  // keyboard
  window.addEventListener('keydown', (e) => {
    if (running && view === 'garage' && e.code === 'Escape' && !/INPUT/.test((e.target && e.target.tagName) || '')) { e.preventDefault(); closeGarage(); return; }
    if (!running || view !== 'play') return;
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    Sound.init(); Sound.resume();
    if (KEYMAP[e.code]) { keys.add(e.code); e.preventDefault(); }
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); if (!ui.pause.hidden) resume(); else pause(); }
    else if (e.code === 'KeyR' && S && S.mode !== 'online') { e.preventDefault(); restart(); }
    else if ((e.code === 'Enter' || e.code === 'Space') && !ui.crash.hidden) { e.preventDefault(); restart(); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  const releaseAll = () => { keys.clear(); for (const k in touchCtl) touchCtl[k] = false; for (const el of document.querySelectorAll('.br-touch .on')) el.classList.remove('on'); };
  window.addEventListener('blur', () => { releaseAll(); if (shouldAutoPause()) pause(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { releaseAll(); if (shouldAutoPause()) pause(); Sound.suspend(); }
    else if (running) { Net.wake(); Sound.resume(); }    // phones stop pages in the background, and the connection may have died
  });
  window.addEventListener('pageshow', () => { if (running) Net.wake(); });
  // touch controls
  for (const [id, k] of [['br-tgas', 'gas'], ['br-tbrake', 'brake'], ['br-tback', 'back'], ['br-tfwd', 'fwd']]) {
    const el = $(id);
    const on = (e) => { e.preventDefault(); Sound.init(); Sound.resume(); touchCtl[k] = true; el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch (er) {} };
    const off = (e) => { touchCtl[k] = false; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  // tapping the screen retries after a crash
  canvas.addEventListener('pointerdown', () => { Sound.init(); Sound.resume(); });
  window.addEventListener('resize', () => {
    if (!running) return;
    resize();
    if (isPhone() && innerHeight > innerWidth && shouldAutoPause()) pause();
  });
  // Android and others send motion events without asking, so tilt can start now. iOS waits for the first tap.
  if (isPhone() && save.tilt && !(typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')) startTilt();
  started = true;
}

// Android: play fullscreen and locked sideways. (iPhones can't do either from a web page.)
function goFullscreen() {
  const el = document.documentElement;
  if (!isPhone() || document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation && screen.orientation.lock ? screen.orientation.lock('landscape') : null)
    .catch(() => {});
}
function leaveFullscreen() { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); }
function show() {
  if (!started) setup();
  resize();
  const h = location.hash.slice(1), m = /^bike-race\/([A-Za-z]{4})$/.exec(h);
  if (!running) {
    running = true; last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  if (m) {
    pendingJoin = m[1].toUpperCase();
    try { history.replaceState(null, '', location.pathname + location.search + '#bike-race'); } catch (e) {}
    if (Net.status === 'online' && Net.id) { Net.send({ t: 'join', code: pendingJoin }); pendingJoin = null; }
    showView('mp');
  } else if (view === 'play' && S) {
    // coming back to a game in progress
  } else showView(view === 'play' ? 'home' : view);
}
function hide() {
  // leaving Bike Race for the games menu leaves any room too
  if (roomState) Net.send({ t: 'leave' });
  roomState = null;
  if (S && S.mode === 'online') { exitPlay(); view = 'mp'; }
  Net.close();
  running = false; cancelAnimationFrame(raf);
  leaveFullscreen();
  Sound.engineOff();
  if (view === 'play' && S) pause();
}
window.BikeRace = { show, hide, _debug: () => ({ S, attract, save, cam, C, Net, startSolo, startCpuRace, readInput, touchCtl, keys, tilt, tiltAngle, refreshControls, remotePose, roomState, inviteLink }) };
})();
