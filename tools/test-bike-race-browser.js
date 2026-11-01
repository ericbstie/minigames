// Browser checks for Bike Race: the garage (bikes, paint, name, saving), opening it from the pause, crash and
// result sheets, the "new bike" badges, and that the garage and sheets fit on phones held sideways.
// It plays the real page in headless Chromium through Playwright, as a phone with touch.
//
// Usage: node tools/test-bike-race-browser.js [--keep]      (needs Playwright: npm i -g playwright, or NODE_PATH)
// It starts its own static server for public/ on port 8123 (BR_PORT to change it), and prints a line per check.
// --keep leaves screenshots of each phone size in tools/.shots/ (ignored by git).
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const PORT = +(process.env.BR_PORT || 8123);
const ROOT = path.join(__dirname, '..', 'public');
const BASE = `http://127.0.0.1:${PORT}/`;
const keep = process.argv.includes('--keep');
const SHOTS = path.join(__dirname, '.shots');
let failed = 0, passed = 0;
const ok = (cond, what, extra) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// some saves to start from
const stars = (n) => { const s = {}; for (const id of ['clover-1', 'clover-2', 'clover-3', 'clover-4', 'clover-5', 'clover-6', 'ember-1', 'ember-2', 'ember-3', 'ember-4']) { if (n <= 0) break; s[id] = Math.min(3, n); n -= s[id]; } return s; };
const bestFor = (st) => Object.fromEntries(Object.keys(st).map(id => [id, 30]));
const SAVE_0 = {};
const SAVE_18 = { stars: stars(18), best: bestFor(stars(18)), name: 'Eric' };
const SAVE_8 = { stars: { 'clover-2': 3, 'clover-3': 3, 'clover-4': 2 }, best: { 'clover-2': 17, 'clover-3': 17, 'clover-4': 22 } };

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch (e) { await wait(100); } }
    const browser = await chromium.launch();
    try { await run(browser); } finally { await browser.close(); }
  } finally { server.kill(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

async function phone(browser, { w = 844, h = 390, save = null, query = '', desktop = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: !desktop, hasTouch: !desktop });
  await ctx.grantPermissions(['accelerometer', 'gyroscope']).catch(() => {});
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|jsdelivr/.test(m.text())) page.errors.push(m.text()); });
  await page.route(/cdn\.jsdelivr\.net|fonts\.googleapis|fonts\.gstatic/, r => r.abort());   // the other games' CDN, not needed here
  await page.goto(BASE + 'favicon-none');
  await page.evaluate((s) => { localStorage.clear(); if (s) localStorage.setItem('bikerace.v1', JSON.stringify(s)); }, save);
  await page.goto(BASE + query + '#bike-race');
  await page.waitForFunction(() => window.BikeRace && !document.getElementById('br-home').hidden, null, { timeout: 5000 });
  return page;
}
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('bikerace.v1') || '{}'));
const visible = (page, id) => page.evaluate((id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.offsetParent !== null; }, id);
const tap = (page, sel) => page.locator(sel).first().click();
const dbg = (page, fn, arg) => page.evaluate(new Function('arg', 'const d = BikeRace._debug(); return (' + fn + ')(d, arg);'), arg);

async function run(browser) {
  console.log('Garage basics (no stars yet)');
  let page = await phone(browser, { save: SAVE_0 });
  ok(await page.evaluate(() => !document.getElementById('br-go-garage').disabled), 'the Garage button is switched on');
  ok(await page.evaluate(() => !document.getElementById('br-go-garage').classList.contains('has-new')), 'no "New bike" badge with no stars');
  await tap(page, '#br-go-garage');
  ok(await visible(page, 'br-garage'), 'the garage opens');
  let tiles = await page.$$eval('.br-gbike', els => els.map(e => ({ cls: e.className, name: e.querySelector('.nm').textContent })));
  ok(tiles.length === 5, 'five bikes in the strip', tiles.length);
  ok(tiles[0].cls.includes('riding') && tiles.slice(1).every(t => t.cls.includes('locked')), 'Scout is ridden and the other four are locked', tiles.map(t => t.cls));
  await page.locator('.br-gbike').nth(4).click();
  ok((await saved(page)).bike !== 'comet', 'tapping a locked bike does not pick it');
  ok(/more stars/.test(await page.textContent('#br-g-status')), 'the locked bike shows how many more stars it needs', await page.textContent('#br-g-status'));
  ok(await page.textContent('#br-g-name') === 'Comet', 'the showroom shows the tapped bike');
  await tap(page, '#br-garage-back');
  ok(await visible(page, 'br-home'), 'Back goes to the home menu');
  ok(page.errors.length === 0, 'no errors in the page', page.errors);
  await page.context().close();

  console.log('Unlocking, picking and saving');
  page = await phone(browser, { save: SAVE_18 });
  ok(await page.evaluate(() => document.getElementById('br-go-garage').classList.contains('has-new')), 'home shows "New bike" once Hopper is unlocked');
  await tap(page, '#br-go-garage');
  ok(await page.locator('.br-gbike').nth(1).locator('.br-new').count() === 1, 'Hopper\'s tile says New');
  await page.locator('.br-gbike').nth(1).click();
  let sv = await saved(page);
  ok(sv.bike === 'hopper' && sv.seen.includes('hopper'), 'tapping Hopper rides it and clears New', sv);
  ok(await page.locator('.br-gbike').nth(1).locator('.br-new').count() === 0, 'the New tag goes away');
  ok(await dbg(page, d => d.attract.me.look.bike) === 'hopper', 'the rider behind the menus switches to Hopper');
  await page.locator('.br-paint').nth(3).click();
  ok((await saved(page)).paint === 3, 'picking the fourth paint saves it');
  await page.fill('#br-name', 'A\u0007B');
  await page.locator('#br-name').press('Enter');
  ok((await saved(page)).name === 'AB', 'control characters are taken out of the name', (await saved(page)).name);
  await page.fill('#br-name', 'Zed the Quick Rider!!');
  await page.locator('#br-name').press('Enter');
  sv = await saved(page);
  ok(sv.name === 'Zed the Quick Ri', 'the name is saved and cut to 16', sv.name);
  await tap(page, '#br-garage-back');
  ok(await page.evaluate(() => !document.getElementById('br-go-garage').classList.contains('has-new')), 'the home badge is gone after looking at the new bike');
  await page.reload();
  await page.waitForFunction(() => window.BikeRace && !document.getElementById('br-home').hidden);
  await tap(page, '#br-go-garage');
  ok(await page.evaluate(() => document.querySelector('.br-gbike.riding .nm').textContent) === 'Hopper', 'after a reload Hopper is still ridden');
  ok(await page.inputValue('#br-name') === 'Zed the Quick Ri', 'after a reload the name is still there');
  ok(await page.evaluate(() => document.querySelectorAll('.br-paint')[3].classList.contains('sel')), 'after a reload the paint is still picked');
  ok(page.errors.length === 0, 'no errors in the page', page.errors);
  await page.context().close();

  console.log('Saves that name a locked bike are put right');
  page = await phone(browser, { save: { bike: 'comet', paint: 99, name: 'A\u0001B' } });
  sv = await dbg(page, d => d.save);
  ok(sv.bike === 'scout' && sv.paint === 99 % 10 && sv.name === 'AB', 'locked bike back to Scout, paint wrapped, name cleaned', sv);
  await page.context().close();

  console.log('Garage from the pause menu');
  page = await phone(browser, { save: SAVE_18, query: '?keyboard' });
  await dbg(page, d => d.startSolo('clover-1'));
  await page.keyboard.down('ArrowUp'); await wait(1200); await page.keyboard.up('ArrowUp');
  await tap(page, '#br-pause');
  const before = await dbg(page, d => ({ x: d.S.me.c.x, t: d.S.me.time, sess: (window.__s = d.S, 1) }));
  ok(await visible(page, 'br-p-garage'), 'the pause menu has a Garage button');
  await tap(page, '#br-p-garage');
  ok(await visible(page, 'br-garage'), 'it opens the garage');
  await page.locator('.br-paint').nth(5).click();
  await tap(page, '#br-garage-back');
  let after = await dbg(page, d => ({ same: d.S === window.__s, x: d.S.me.c.x, t: d.S.me.time, paint: d.S.me.look.paint.id, pause: !document.getElementById('br-pausemenu').hidden }));
  ok(after.same && Math.abs(after.x - before.x) < 1e-6 && after.pause, 'with only a new paint, Back returns to the same paused run', after);
  ok(after.paint === 'pink', 'and the bike wears the new paint', after.paint);
  await tap(page, '#br-p-garage');
  await page.locator('.br-gbike').nth(1).click();     // Hopper
  await tap(page, '#br-garage-back');
  after = await dbg(page, d => ({ same: d.S === window.__s, bike: d.S.me.type.id, phase: d.S.phase, view: !document.getElementById('br-hud').hidden }));
  ok(!after.same && after.bike === 'hopper' && after.phase === 'ready' && after.view, 'with a new bike, Back restarts the level on it', after);
  await page.keyboard.down('ArrowUp'); await wait(600); await page.keyboard.up('ArrowUp');
  await page.keyboard.press('Escape');
  ok(await visible(page, 'br-pausemenu'), 'Esc pauses the run (keyboard test mode)');
  await tap(page, '#br-p-garage');
  await page.keyboard.press('Escape');
  ok(await visible(page, 'br-pausemenu') && !(await visible(page, 'br-garage')), 'Esc leaves the garage, back to the pause menu');
  ok(page.errors.length === 0, 'no errors in the page', page.errors);
  await page.context().close();

  console.log('Garage from the crash sheet');
  page = await phone(browser, { save: SAVE_18, query: '?autopilot' });
  await dbg(page, d => d.startSolo('clover-1'));
  await wait(800);
  await dbg(page, d => { d.S.me.c.a = Math.PI; d.S.me.c.y += 0.6; });     // upside down: the head hits the ground
  await page.waitForFunction(() => !document.getElementById('br-crash').hidden, null, { timeout: 5000 });
  ok(await visible(page, 'br-crash-garage'), 'the crash sheet has a Garage button');
  await tap(page, '#br-crash-garage');
  await tap(page, '#br-garage-back');
  ok(await visible(page, 'br-crash'), 'Back returns to the crash sheet');
  await page.context().close();

  console.log('Result sheet: next bike, then a new bike');
  page = await phone(browser, { save: SAVE_0, query: '?autopilot' });
  await dbg(page, d => d.startSolo('clover-1'));
  await page.waitForFunction(() => !document.getElementById('br-result').hidden, null, { timeout: 30000 });
  ok(/Next bike: Hopper/.test(await page.textContent('#br-res-unlock')), 'the result shows progress to the next bike', await page.textContent('#br-res-unlock'));
  const ghost = await page.evaluate(() => JSON.parse(localStorage.getItem('bikerace.ghost.v1.clover-1')));
  ok(ghost && ghost.bike === 'scout' && ghost.f.length > 100, 'the ghost remembers which bike set it');
  await page.context().close();

  page = await phone(browser, { save: SAVE_8, query: '?autopilot' });
  await dbg(page, d => d.startSolo('clover-1'));
  await page.waitForFunction(() => !document.getElementById('br-result').hidden, null, { timeout: 30000 });
  ok(/New bike: Hopper/.test(await page.textContent('#br-res-unlock')), 'three more stars unlock Hopper on the result sheet', await page.textContent('#br-res-unlock'));
  ok(await page.evaluate(() => document.getElementById('br-res-garage').classList.contains('sky')), 'the Garage button stands out when a bike was unlocked');
  await tap(page, '#br-res-unlock');
  ok(await page.textContent('#br-g-name') === 'Hopper' && /Ride Hopper/.test(await page.textContent('#br-g-status')), 'the card opens the garage on Hopper with a Ride button');
  await tap(page, '.br-ride');
  ok((await saved(page)).bike === 'hopper', 'Ride picks it');
  await tap(page, '#br-garage-back');
  ok(await visible(page, 'br-result'), 'Back returns to the result sheet');
  await tap(page, '#br-res-next');
  ok(await dbg(page, d => d.S.levelId + ' ' + d.S.me.type.id) === 'clover-2 hopper', 'the next level starts on the new bike');
  ok(page.errors.length === 0, 'no errors in the page', page.errors);
  await page.context().close();

  console.log('Every bike rides in the browser');
  page = await phone(browser, { save: { stars: Object.fromEntries(['clover', 'ember', 'frost', 'moon', 'magma'].flatMap(w => [1, 2, 3, 4, 5, 6].map(i => [`${w}-${i}`, 3]))) }, query: '?autopilot' });
  for (const b of ['scout', 'hopper', 'twister', 'bulldog', 'comet']) {
    // fast-forward the run in the page with the same code the game uses
    const r = await page.evaluate((b) => { const C = BikeRaceCore, L = C.levelById('magma-4'), sim = new C.Sim(C.buildLevel(C.worldOf(L.id), L)), me = sim.addBike(b); me.running = true; while (!me.finished && !me.crashed && sim.t < 90) { me.input = C.botInput(me); sim.step(); } return me.finished; }, b);
    ok(r, `${b} finishes Slag Slide`);
  }
  await page.context().close();

  console.log('Fits on phones held sideways');
  if (keep) fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, h] of [[844, 390], [932, 430], [740, 360], [667, 375], [667, 320], [568, 320]]) {
    page = await phone(browser, { w, h, save: SAVE_18 });
    await tap(page, '#br-go-garage');
    await page.locator('.br-gbike').nth(3).click();
    await wait(200);
    const fit = await page.evaluate(() => {
      const scr = document.getElementById('br-garage'), out = [];
      for (const el of scr.querySelectorAll('.br-g-head, .br-g-show, .br-g-strip > *, .br-g-side, .br-paint, #br-name, .br-g-status')) {
        const r = el.getBoundingClientRect();
        if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(el.className || el.id);
      }
      const side = document.querySelector('.br-g-side');
      return { out, scroll: scr.scrollHeight - scr.clientHeight, side: side.scrollHeight - side.clientHeight, stage: document.getElementById('br-g-stage').clientHeight };
    });
    ok(!fit.out.length && fit.scroll <= 1 && fit.side <= 1 && fit.stage >= 110, `garage fits at ${w}x${h}`, fit);
    if (keep) await page.screenshot({ path: path.join(SHOTS, `garage-${w}x${h}.png`) });
    await tap(page, '#br-garage-back');
    await dbg(page, d => d.startSolo('clover-1'));
    await tap(page, '#br-pause');
    const sheet = await page.evaluate(() => { const s = document.querySelector('#br-pausemenu .sheet'); const r = s.getBoundingClientRect(); return { over: s.scrollHeight - s.clientHeight, top: r.top, bottom: r.bottom - innerHeight }; });
    ok(sheet.over <= 1 && sheet.top >= 0 && sheet.bottom <= 0, `pause sheet fits at ${w}x${h}`, sheet);
    if (keep) { await wait(500); await page.screenshot({ path: path.join(SHOTS, `pause-${w}x${h}.png`) }); }
    ok(page.errors.length === 0, 'no errors in the page', page.errors);
    await page.context().close();
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
