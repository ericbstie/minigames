// Browser checks for Castle Defender's open world: the ground is made around the king wherever he goes and
// thrown away behind him, each biome shows where it should, the roads are painted, and the game still runs.
// It plays the real page in headless Chromium through Playwright.
//
// Usage: node tools/test-castle-defender-browser.js [--keep]   (needs Playwright: npm i -g playwright, or NODE_PATH)
// It starts its own server for public/ on port 8124 (CD_PORT to change it) and prints a line per check.
// three.js comes from its CDN; set CD_THREE=/path/to/three.module.js to use a local copy instead.
// --keep leaves screenshots in tools/.shots/ (ignored by git).
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const PORT = +(process.env.CD_PORT || 8124);
const BASE = `http://127.0.0.1:${PORT}/`;
const keep = process.argv.includes('--keep');
const SHOTS = path.join(__dirname, '.shots');
let failed = 0, passed = 0;
const ok = (cond, what, extra) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const server = spawn('python3', [path.join(__dirname, 'serve.py')], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch (e) { await wait(100); } }
    const browser = await chromium.launch();
    try { await run(browser); } finally { await browser.close(); }
  } finally { server.kill(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

async function open(browser, { w = 1000, h = 600, mobile = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  if (process.env.CD_THREE) await page.route(/three\.module\.js$/, r => r.fulfill({ path: process.env.CD_THREE, contentType: 'text/javascript' }));
  await page.route(/fonts\.googleapis|fonts\.gstatic/, r => r.abort());
  await page.goto(BASE + '#castle-defender');
  await page.waitForFunction(() => window.CastleDefender && CastleDefender._debug && CastleDefender._debug().G, null, { timeout: 20000 });
  await wait(300);
  return page;
}
// run a function against the game's debug handle: dbg(page, (d, arg) => ..., arg)
const dbg = (page, fn, arg) => page.evaluate(new Function('arg', 'const d = CastleDefender._debug(); return (' + fn + ')(d, arg);'), arg);
const shot = async (page, name) => { if (!keep) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'castle-' + name + '.png') }); };
// the average colour of the middle of the screen, around the king
async function groundColour(page) {
  await wait(250);
  const buf = await page.screenshot({ clip: { x: 300, y: 380, width: 140, height: 100 } });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4; return [r / n, gg / n, b / n].map(Math.round);
  }, buf.toString('base64'));
}

async function run(browser) {
  console.log('The world around the castle');
  let page = await open(browser);
  let t = await dbg(page, d => d.terrain());
  ok(t.chunks >= 20 && t.chunks <= 60, 'ground chunks are made around the king at the start', t.chunks);
  ok(t.strips >= 3, 'the canyon wall is there', t.strips);
  ok(['road0', 'road1', 'road2'].every(r => t.roads.includes(r)), 'the three first roads are painted', t.roads);
  ok(t.made ? t.ms / t.made < 40 : false, 'a chunk takes a few milliseconds to make', +(t.ms / t.made).toFixed(1));
  const sand = await groundColour(page);
  ok(sand[0] > sand[2] + 40 && sand[0] > 120, 'sandy ground at the castle', sand);
  await shot(page, 'home');

  console.log('Riding out: the biomes go on and on');
  const spots = [
    ['Frozen Pass', [4, -110], (c) => c[2] > 170 && Math.abs(c[0] - c[2]) < 50],
    ['Ashlands', [100, -6], (c) => c[0] < 110 && c[1] < 100],
    ['Mire', [80, 70], (c) => c[1] > c[0] && c[1] > c[2]],
    ['far Frozen Pass', [-150, -700], (c) => c[2] > 170],
    ['far Ashlands', [900, 60], (c) => c[0] < 110 && c[1] < 100],
    ['far Mire', [300, 900], (c) => c[1] > c[0] && c[1] > c[2]],
  ];
  for (const [name, [x, z], looks] of spots) {
    await dbg(page, (d, [x, z]) => d.teleport(x, z), [x, z]);
    const b = await dbg(page, (d, [x, z]) => d.biomeAt(x, z), [x, z]);
    const c = await groundColour(page);
    ok(looks(c), `${name} at (${x}, ${z}) looks like it (biome ${b})`, c);
    await shot(page, name.replace(/ /g, '-').toLowerCase());
  }
  t = await dbg(page, d => d.terrain());
  ok(t.chunks <= 60 && t.strips <= 12, 'chunks and wall strips far behind are thrown away', t);
  ok(await dbg(page, d => { let far = 0; const k = d.G.king; for (const ch of d.world.terrain.chunks.values()) if (Math.hypot(ch.cx * 32 + 16 - k.x, ch.cz * 32 + 16 - k.z) > 160) far++; return far; }) === 0, 'no chunk is kept far from the king');
  // the same place comes back the same
  await dbg(page, d => d.teleport(4, -110));
  const again = await groundColour(page);
  await dbg(page, d => d.teleport(900, 60)); await dbg(page, d => d.teleport(4, -110));
  const third = await groundColour(page);
  ok(again.every((v, i) => Math.abs(v - third[i]) <= 2), 'a place looks the same when the king comes back to it', [again, third]);

  console.log('Riding along: chunks keep up');
  await dbg(page, d => d.teleport(4, 2));
  const ride = await dbg(page, async (d) => {
    const k = d.G.king, out = { missing: 0 };
    d.G.free = true;
    for (let i = 0; i < 600; i++) {   // 20 s of riding north-east at full speed, a frame at a time
      d.G.input.x = 0.7; d.G.input.z = -0.7;
      d.advance(1 / 30);
      // every chunk in sight of the king must be there
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!d.world.terrain.chunks.has(Math.floor(k.x / 32 + dx) + ',' + Math.floor(k.z / 32 + dz))) out.missing++;
    }
    d.G.input.x = d.G.input.z = 0;
    out.x = k.x; out.z = k.z;
    return out;
  });
  ok(ride.missing === 0 && ride.x > 100, 'riding 200 paces the ground is always made before the king gets there', ride);

  console.log('New roads');
  page = await reopen(page, browser);
  await dbg(page, d => d.reachRing(3));
  t = await dbg(page, d => d.terrain());
  ok(['theme1', 'theme2', 'theme3'].every(r => t.roads.includes(r)), 'the three outer roads are painted once they open', t.roads);
  await dbg(page, d => d.teleport(10, -78));
  await shot(page, 'frozen-road');
  // read the painted ground on the north road and beside it
  const road = await dbg(page, (d) => {
    const at = (x, z) => { const ch = d.world.terrain.chunks.get(Math.floor(x / 32) + ',' + Math.floor(z / 32)); const p = ch.g.getImageData(Math.floor((x - ch.cx * 32) * 8), Math.floor((z - ch.cz * 32) * 8), 1, 1).data; return [p[0], p[1], p[2]]; };
    return { on: at(6, -82), off: at(13, -84) };
  });
  ok(road.on[2] > 150 && road.off[2] > 200 && road.off[0] - road.on[0] > 25, 'the north road is painted through the snow, darker than the snow beside it', road);
  await page.evaluate(() => document.getElementById('cd-pause-btn').click());
  await page.evaluate(() => document.getElementById('cd-restart').click());
  t = await dbg(page, d => d.terrain());
  ok(!t.roads.some(r => r.startsWith('theme')), 'a new game starts with only the first roads', t.roads);

  console.log('Playing');
  const play = await dbg(page, (d) => { d.teleport(4, 2); d.G.free = false; d.advance(45); return { t: Math.round(d.G.t), enemies: d.G.enemies.length, kills: d.G.kills, over: d.G.over }; });
  ok(play.t >= 44 && !play.over && play.enemies + play.kills > 10, '45 seconds of play: enemies march and fall', play);
  ok(page.errors.length === 0, 'no errors in the page', page.errors);
  await page.context().close();

  console.log('A phone held upright');
  page = await open(browser, { w: 390, h: 844, mobile: true });
  t = await dbg(page, d => d.terrain());
  const corners = await dbg(page, (d) => {
    // every corner of the screen looks at ground that exists
    const { THREE, camera } = d, ray = new THREE.Raycaster(), miss = [];
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1]]) {
      ray.setFromCamera(new THREE.Vector2(x, y), camera);
      const t = -ray.ray.origin.y / ray.ray.direction.y, gx = ray.ray.origin.x + ray.ray.direction.x * t, gz = ray.ray.origin.z + ray.ray.direction.z * t;
      if (!d.world.terrain.chunks.has(Math.floor(gx / 32) + ',' + Math.floor(gz / 32))) miss.push([x, y, Math.round(gx), Math.round(gz)]);
    }
    return miss;
  });
  ok(corners.length === 0, 'the ground reaches every corner of a tall screen', corners);
  await shot(page, 'phone');
  ok(page.errors.length === 0, 'no errors in the page', page.errors);
  await page.context().close();
}
async function reopen(page, browser) { await page.context().close(); return open(browser); }

main();
