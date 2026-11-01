// Browser checks for Castle Defender's open world: the ground is made around the king wherever he goes and
// thrown away behind him, each biome shows where it should, the roads are painted, outposts push the border out
// and the enemy camps back, the king stays inside his land, and the game still runs.
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
  await dbg(page, d => { d.world.border.visible = false; });   // the land past the border is veiled; look at the bare ground
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
  t = await dbg(page, d => d.terrain());
  ok(!t.roads.some(r => r.startsWith('front-')), 'at the start only the first roads are painted', t.roads);
  await dbg(page, d => { d.G.recruitIdx = 1; d.buy('tower0'); d.buy('tower1'); d.buy('tower2'); d.buy('tower3'); d.buy('cannon0'); });
  t = await dbg(page, d => d.terrain());
  ok(t.roads.includes('front-N-0'), 'the first cannon opens the north road', t.roads);
  await dbg(page, d => d.teleport(10, -78));
  await shot(page, 'frozen-road');
  // read the painted ground on the north road and beside it
  const road = await dbg(page, (d) => {
    const at = (x, z) => { const ch = d.world.terrain.chunks.get(Math.floor(x / 32) + ',' + Math.floor(z / 32)); const p = ch.g.getImageData(Math.floor((x - ch.cx * 32) * 8), Math.floor((z - ch.cz * 32) * 8), 1, 1).data; return [p[0], p[1], p[2]]; };
    return { on: at(6, -82), off: at(13, -84) };
  });
  ok(road.on[2] > 150 && road.off[2] > 200 && road.off[0] - road.on[0] > 25, 'the north road is painted through the snow, darker than the snow beside it', road);

  console.log('The border moves out');
  await dbg(page, d => { d.teleport(4, 2); d.G.free = false; d.buy('cannon1'); d.advance(0.5); });
  let sites = await dbg(page, d => { const vis = d.pads().map(p => p.id); return d.sites().filter(s => vis.includes(s.id)); });
  ok(sites.length >= 3 && sites.every(s => s.border < -3 && s.border > -16), 'with two cannons up, outpost spots show where the roads cross the border', sites);
  const east = sites.reduce((a, b) => (b.x > a.x ? b : a));
  const before = await dbg(page, d => d.fronts().find(f => f.id === 'E'));
  await dbg(page, (d, id) => { d.teleport(30, 2); d.G.free = false; d.buy(id); d.G.enemies.length = 0; d.G.spawnQueue.length = 0; d.advance(2); }, east.id);
  await shot(page, 'outpost');
  let st = await dbg(page, d => ({ claims: d.claims(), fronts: d.fronts(), roads: d.terrain().roads, ruins: d.G.ruins.length, posts: d.G.posts.map(p => d.borderDist(p.x, p.z)) }));
  const E = st.fronts.find(f => f.id === 'E'), far = (f) => Math.hypot(f.x - 4, f.z);
  ok(st.claims.length === 2, 'building an outpost claims more land', st.claims);
  ok(far(E) >= far(before) + 18 && E.tier > 0 && st.ruins >= 1, 'the east camp the border reached is cleared and the enemy falls back further out, tougher', { before, E, ruins: st.ruins });
  ok(st.roads.includes('front-E-0') && st.roads.includes('front-S-0'), 'a new road runs from the new camp to the old one, and the south road opens', st.roads);
  ok(st.posts.length > 10 && st.posts.every(v => Math.abs(v) < 0.6), 'flags stand along the border', st.posts.length);
  const after = await dbg(page, d => { d.advance(12); return d.G.enemies.map(e => [Math.round(e.route[0][0]), Math.round(e.route[0][1]), e.theme]); });
  ok(after.length > 0 && !after.some(([x, z]) => x === 56 && z === -2), 'the cleared camp sends no one any more', after.length);
  ok(after.some(([x, z, th]) => Math.hypot(x - E.x, z - E.z) < 1.5 && th === E.theme), 'the new camp sends its own enemies, in its biome\'s colours', { E, after: after.slice(0, 8) });
  sites = await dbg(page, d => d.sites());
  ok(sites.some(s => s.x > east.x + 20 && s.border < -3), 'the next outpost spot on the east road is out at the new border', sites);
  // keep pushing east: each outpost on the east road clears its camp, the next one is further out and its enemies stronger
  const push = await dbg(page, (d) => {
    const out = [];
    for (let n = 0; n < 4; n++) {
      const pad = d.sites().reduce((a, b) => (b.x > a.x ? b : a));
      d.buy(pad.id); d.advance(1);
      const f = d.fronts().find(o => o.id === 'E');
      out.push({ x: Math.round(f.x), z: Math.round(f.z), tier: +f.tier.toFixed(2), theme: f.theme });
    }
    d.G.enemies.length = 0; d.G.spawnQueue.length = 0; d.advance(10);
    const hp = (sx, sz) => Math.max(0, ...d.G.enemies.filter(e => e.kind === 'knight' && Math.hypot(e.route[0][0] - sx, e.route[0][1] - sz) < 1.5).map(e => e.max));
    const last = out[out.length - 1], ne = d.fronts().find(o => o.id === 'NE');
    return { out, eastHp: hp(last.x, last.z), neHp: hp(ne.x, ne.z) };
  });
  ok(push.out.every((c, i) => i === 0 || Math.hypot(c.x - 4, c.z) > Math.hypot(push.out[i - 1].x - 4, push.out[i - 1].z)) && push.out.every(c => c.theme === 3), 'pushing east, every outpost clears the camp, and it falls back further into the Ashlands', push.out);
  ok(push.eastHp > push.neHp * 2, 'enemies from the far camp are much stronger than from a camp near home', push);
  await dbg(page, d => d.teleport(d.G.fronts[0].camp.x - 30, d.G.fronts[0].camp.z));
  await shot(page, 'far-east');
  const inside = await dbg(page, (d) => {
    d.teleport(4, 2); d.G.free = false; let worst = -1e9;
    for (const [ix, iz] of [[1, 0.1], [0.3, 1], [-1, -0.7], [0.2, -1]]) for (let i = 0; i < 240; i++) { d.G.input.x = ix; d.G.input.z = iz; d.advance(1 / 30); worst = Math.max(worst, d.borderDist(d.G.king.x, d.G.king.z)); }
    d.G.input.x = d.G.input.z = 0;
    return worst;
  });
  ok(inside <= -1.1, 'the king can ride anywhere in his land but not past the border', inside);
  await page.evaluate(() => document.getElementById('cd-pause-btn').click());
  await page.evaluate(() => document.getElementById('cd-restart').click());
  st = await dbg(page, d => ({ claims: d.claims().length, roads: d.terrain().roads, fronts: d.fronts().map(f => [f.id, f.open, f.x, f.z]), ruins: d.G.ruins.length, sites: d.pads().filter(p => p.id.startsWith('outpost')).length }));
  ok(st.claims === 1 && !st.roads.some(r => r.startsWith('front-')) && st.ruins === 0 && st.fronts[0][2] === 56 && !st.fronts[3][1], 'a new game starts with the home land, the first camps and only the first roads', st);

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
