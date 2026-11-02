// Browser checks for the Bike Race level editor: My levels (new, rename, play, delete), building a track from the
// row of pieces, turning, flipping, dragging, deleting, undo and redo, touch gestures on the track, saving, the test
// ride and the sheets it shows, levels that come back after a reload, and that it all fits on phones held sideways.
// It plays the real page in headless Chromium through Playwright, as a phone with touch.
//
// Usage: node tools/test-bike-race-editor.js [--keep]      (needs Playwright: npm i -g playwright, or NODE_PATH)
// It starts its own static server for public/ on port 8124 (BR_PORT to change it), and prints a line per check.
// --keep leaves screenshots in tools/.shots/ (ignored by git).
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const PORT = +(process.env.BR_PORT || 8124);
const BASE = `http://127.0.0.1:${PORT}/`;
const keep = process.argv.includes('--keep');
const SHOTS = path.join(__dirname, '.shots');
const STORE = 'bikerace.levels.v1';
let failed = 0, passed = 0;
const ok = (cond, what, extra) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

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

async function phone(browser, { w = 844, h = 390, levels = null, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|jsdelivr/.test(m.text())) page.errors.push(m.text()); });
  await page.route(/cdn\.jsdelivr\.net|fonts\.googleapis|fonts\.gstatic/, r => r.abort());   // the other games' CDN, not needed here
  await page.goto(BASE + 'favicon-none');
  await page.evaluate(([k, s]) => { localStorage.clear(); if (s != null) localStorage.setItem(k, typeof s === 'string' ? s : JSON.stringify(s)); }, [STORE, levels]);
  await page.goto(BASE + query + '#bike-race');
  await page.waitForFunction(() => window.BikeRace && window.BikeRaceEditor && !document.getElementById('br-home').hidden, null, { timeout: 5000 });
  page.cdp = await ctx.newCDPSession(page);
  return page;
}
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), STORE);
const visible = (page, id) => page.evaluate((id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.offsetParent !== null; }, id);
const tap = (page, sel) => page.locator(sel).first().click();
const text = (page, sel) => page.textContent(sel);
// run fn(editor internals, arg) in the page
const ed = (page, fn, arg) => page.evaluate(new Function('arg', 'const d = BikeRaceEditor._debug(); return (' + fn + ')(d, arg);'), arg);
const addTile = (page, t) => page.locator(`.br-ed-tile[data-t="${t}"]`).click();
// the camera glides after a piece is added: wait for it to settle before working out where things are on screen
const settle = (page) => page.waitForFunction(() => !BikeRaceEditor._debug().ed.camTo, null, { timeout: 3000 });
// a world point on screen (CSS pixels)
async function screenAt(page, x, y) {
  await settle(page);
  return ed(page, (d, [x, y]) => { const r = document.getElementById('br-canvas').getBoundingClientRect(); return { x: r.left + d.ed.cam.sx(x), y: r.top + d.ed.cam.sy(y) }; }, [x, y]);
}
// the middle of piece i's path, on screen
async function pieceAt(page, i) {
  await settle(page);
  return ed(page, (d, i) => {
    const m = d.ed.geoms[i], k = (m.pts.length >> 2) << 1, r = document.getElementById('br-canvas').getBoundingClientRect();
    return { x: r.left + d.ed.cam.sx(m.pts[k]), y: r.top + d.ed.cam.sy(m.pts[k + 1]) };
  }, i);
}
// real touch input through the DevTools protocol: one or two fingers
const touch = (page, type, pts) => page.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
async function touchTap(page, p) { await touch(page, 'touchStart', [p]); await touch(page, 'touchEnd', []); await wait(30); }
async function touchDrag(page, a, b, steps = 12) {
  await touch(page, 'touchStart', [a]);
  for (let k = 1; k <= steps; k++) await touch(page, 'touchMove', [{ x: a.x + (b.x - a.x) * k / steps, y: a.y + (b.y - a.y) * k / steps }]);
  await touch(page, 'touchEnd', []);
  await wait(30);
}
async function pinch(page, c, d0, d1, steps = 10) {
  const at = (d) => [{ x: c.x - d / 2, y: c.y }, { x: c.x + d / 2, y: c.y }];
  await touch(page, 'touchStart', at(d0));
  for (let k = 1; k <= steps; k++) await touch(page, 'touchMove', at(d0 + (d1 - d0) * k / steps));
  await touch(page, 'touchEnd', []);
  await wait(30);
}
const state = (page) => ed(page, (d) => ({ n: d.ed.data.pieces.length, pieces: d.ed.data.pieces, finish: d.ed.data.finish, sel: d.ed.sel, cur: d.ed.cur, mode: d.ed.mode, undo: d.ed.undo.length, redo: d.ed.redo.length, ppm: d.ed.cam.ppm, camX: d.ed.cam.x }));

async function run(browser) {
  console.log('My levels and a new level');
  let page = await phone(browser);
  ok(await visible(page, 'br-go-editor'), 'the home menu has a Level editor button');
  await tap(page, '#br-go-editor');
  ok(await visible(page, 'br-mylevels'), 'it opens My levels');
  ok(/No levels yet/.test(await text(page, '#br-ml-list')), 'with nothing saved it says how to start');
  await tap(page, '#br-ml-new');
  ok(await visible(page, 'br-editor'), 'New level opens the editor');
  ok(await text(page, '#br-ed-name') === 'My level 1' && await text(page, '#br-ed-count') === '0 pieces', 'the new level is named and empty', [await text(page, '#br-ed-name'), await text(page, '#br-ed-count')]);
  ok(await page.evaluate(() => document.getElementById('br-ed-undo').disabled && document.getElementById('br-ed-redo').disabled), 'undo and redo start switched off');
  ok(await page.locator('.br-ed-tile').count() === 9, 'one row of nine pieces');
  let s = await stored(page);
  ok(s && s.levels.length === 1 && s.levels[0].data.name === 'My level 1', 'the new level is saved straight away', s);

  console.log('Building');
  for (const t of ['line3', 'ramp2', 'line2']) await addTile(page, t);
  let st = await state(page);
  ok(st.n === 3 && st.pieces.map(p => p.t).join() === 'line3,ramp2,line2', 'tapping pieces in the row adds them one after another', st.pieces);
  ok(near(st.pieces[2].a, 30) && st.sel === 3, 'each piece carries on from the last and is picked once added', st);
  const end = await ed(page, (d) => d.ed.geoms[3].ends[1]);
  ok(near(st.finish.x, end.x) && near(st.finish.y, end.y), 'the finish moves along to the end of the track');
  ok(await text(page, '#br-ed-count') === '3 pieces', 'the piece count follows');
  s = await stored(page);
  ok(s.levels[0].data.pieces.length === 3, 'every change is saved');
  // turn and flip the picked piece, then undo it all
  await tap(page, '#br-ed-rotl');
  st = await state(page);
  ok(near(st.pieces[2].a, 45), 'turn left turns the picked piece 15 degrees', st.pieces[2]);
  await tap(page, '#br-ed-rotr'); await tap(page, '#br-ed-rotr');
  ok(near((await state(page)).pieces[2].a, 15), 'turn right turns it back the other way');
  await tap(page, '#br-ed-flipv');
  ok((await state(page)).pieces[2].m === true, 'flip upside down mirrors it');
  for (let k = 0; k < 4; k++) await tap(page, '#br-ed-undo');
  st = await state(page);
  ok(near(st.pieces[2].a, 30) && !st.pieces[2].m && st.redo === 4, 'undo takes the turns and the flip back', st);
  await tap(page, '#br-ed-redo');
  ok(near((await state(page)).pieces[2].a, 45), 'redo puts a turn back');
  await tap(page, '#br-ed-undo');
  // close a loop: a 3/4 loop then a quarter loop, and the track carries on out of it
  await addTile(page, 'loop3'); await addTile(page, 'loop1'); await addTile(page, 'line3');
  st = await state(page);
  const loopIn = await ed(page, (d) => d.ed.geoms[4].ends[0]), out0 = await ed(page, (d) => d.ed.geoms[6].ends[0]);
  ok(near(out0.x, loopIn.x) && near(out0.y, loopIn.y) && near(st.pieces[5].a, 30), 'after a closed loop the next piece carries on out of the loop', { out0, loopIn, a: st.pieces[5].a });
  if (keep) { fs.mkdirSync(SHOTS, { recursive: true }); await ed(page, (d) => d.fitView()); await wait(300); await page.screenshot({ path: path.join(SHOTS, 'editor-built.png') }); }

  console.log('Touching the track');
  // Build: tap the start pad's back end, and the next piece goes off the back
  let p = await screenAt(page, -3, 0);
  await touchTap(page, p);
  st = await state(page);
  ok(st.cur && st.cur.i === 0 && st.cur.e === 0, 'tapping an end in Build moves the arrow there', st.cur);
  await addTile(page, 'line1');
  st = await state(page);
  ok(st.n === 7 && near(st.pieces[6].x, -3) && near(st.pieces[6].a, 180), 'and the next piece is added there', st.pieces[6]);
  await tap(page, '#br-ed-undo');
  // Build: tap open space above the first line, and the next piece starts there, on the grid
  await touchTap(page, await screenAt(page, 15.2, 6.1));
  await addTile(page, 'line1');
  st = await state(page);
  const loose = st.n - 1;
  ok(near(st.pieces[loose].x, 15) && near(st.pieces[loose].y, 6) && near(st.pieces[loose].a, 0), 'tapping open space starts a piece there on the grid', st.pieces[loose]);
  // Edit: pick a piece, then drag the loose one by its middle so its start lands near the end of the first line
  await tap(page, '.br-ed-modes [data-mode="edit"]');
  ok((await state(page)).mode === 'edit' && await page.evaluate(() => document.getElementById('br-editor').dataset.mode === 'edit'), 'Edit mode is shown as on');
  await touchTap(page, await pieceAt(page, 1));
  st = await state(page);
  ok(st.sel === 1 && await page.evaluate(() => !document.getElementById('br-ed-rotl').disabled), 'tapping a piece in Edit picks it and turns on the buttons', st.sel);
  await touchTap(page, await screenAt(page, 0, 0));
  ok((await state(page)).sel === -1, 'the start pad can\'t be picked');
  const lineEnd = await ed(page, (d) => d.ed.geoms[1].ends[1]);
  const grab = await pieceAt(page, loose + 1), mid = await ed(page, (d, i) => { const m = d.ed.geoms[i]; const k = (m.pts.length >> 2) << 1; return { x: m.pts[k], y: m.pts[k + 1] }; }, loose + 1);
  // where the grabbed point ends up if the piece's start moves to just off the line's end (joined to the ramp:
  // a piece can still be snapped onto it)
  const drop = await screenAt(page, mid.x + (lineEnd.x + 0.3 - 15), mid.y + (lineEnd.y + 0.2 - 6));
  await touchDrag(page, grab, drop);
  st = await state(page);
  const moved = await ed(page, (d, i) => d.ed.geoms[i].ends.map(E => ({ x: E.x, y: E.y })), loose + 1);
  ok(moved.some(E => near(E.x, lineEnd.x) && near(E.y, lineEnd.y)), 'dragging a piece in Edit moves it, and its end snaps onto the end it is dropped near', { moved, lineEnd });
  ok(st.undo > 0 && st.sel === loose + 1, 'the move can be undone and the piece stays picked');
  await tap(page, '#br-ed-undo');
  st = await state(page);
  ok(near(st.pieces[loose].x, 15) && near(st.pieces[loose].y, 6), 'undo puts the dragged piece back', st.pieces[loose]);
  // a drag that starts off the track pans the view; pinch and the mouse wheel zoom
  const cam0 = await state(page);
  await touchDrag(page, await screenAt(page, 30, 20), await screenAt(page, 25, 20));
  st = await state(page);
  ok(st.camX > cam0.camX + 2 && st.n === cam0.n, 'dragging the sky pans the view', [cam0.camX, st.camX]);
  await pinch(page, { x: 400, y: 180 }, 200, 100);
  const pinched = (await state(page)).ppm;
  ok(pinched < st.ppm * 0.7, 'pinching zooms out', [st.ppm, pinched]);
  await page.mouse.move(400, 180); await page.mouse.wheel(0, -300); await wait(50);
  ok((await state(page)).ppm > pinched * 1.2, 'the mouse wheel zooms in');
  // Delete
  await ed(page, (d) => d.fitView());
  await tap(page, '.br-ed-modes [data-mode="delete"]');
  const before = (await state(page)).n;
  await touchTap(page, await pieceAt(page, loose + 1));
  ok((await state(page)).n === before - 1, 'tapping a piece in Delete removes it');
  await touchTap(page, await pieceAt(page, before));   // the finish pad
  ok((await state(page)).n === before - 1 && /can't be removed/.test(await text(page, '#br-ed-hint')), 'the finish can\'t be deleted, and says so', await text(page, '#br-ed-hint'));
  await tap(page, '.br-ed-modes [data-mode="build"]');
  ok(page.errors.length === 0, 'no errors in the page', page.errors);
  await page.context().close();

  console.log('Test ride');
  page = await phone(browser, { query: '?autopilot' });
  await tap(page, '#br-go-editor'); await tap(page, '#br-ml-new');
  for (const t of ['line3', 'ramp1', 'line3']) await addTile(page, t);
  await tap(page, '#br-ed-test');
  await page.waitForFunction(() => !document.getElementById('br-hud').hidden, null, { timeout: 3000 });
  ok(await visible(page, 'br-hud'), 'Test starts a ride on the level');
  await page.waitForFunction(() => !document.getElementById('br-result').hidden, null, { timeout: 30000 });
  ok(await text(page, '#br-res-title') === 'Test ride done!', 'the result says it was a test ride', await text(page, '#br-res-title'));
  ok(await page.evaluate(() => document.getElementById('br-res-next').hidden && getComputedStyle(document.querySelector('#br-result .br-rstars')).display === 'none'), 'no stars and no next level on a level of your own');
  ok(await text(page, '#br-res-levels') === 'Edit', 'the way back is labelled Edit');
  s = await stored(page);
  ok(s.levels[0].best && s.levels[0].best.t > 0, 'the time is saved as the level\'s best', s.levels[0].best);
  await tap(page, '#br-res-levels');
  ok(await visible(page, 'br-editor') && (await state(page)).n === 3, 'Edit goes back to the editor with the level as it was');
  // a crash
  await tap(page, '#br-ed-test');
  await wait(600);
  await page.evaluate(() => { const d = BikeRace._debug(); d.S.me.c.a = Math.PI; d.S.me.c.y += 0.6; });
  await page.waitForFunction(() => !document.getElementById('br-crash').hidden, null, { timeout: 5000 });
  ok(await text(page, '#br-crash-levels') === 'Edit', 'the crash sheet goes back to Edit too');
  await tap(page, '#br-crash-levels');
  ok(await visible(page, 'br-editor'), 'and it does');
  // the pause sheet
  await tap(page, '#br-ed-test');
  await wait(300);
  await tap(page, '#br-pause');
  ok(/My level 1/.test(await text(page, '#br-pause-text')) && await text(page, '#br-p-levels') === 'Edit', 'the pause sheet names the level and goes back to Edit', await text(page, '#br-pause-text'));
  await tap(page, '#br-p-levels');
  ok(await visible(page, 'br-editor'), 'Edit from the pause sheet goes back to the editor');
  // changing the track drops the best time
  await addTile(page, 'line1');
  await tap(page, '#br-ed-back');
  ok(await visible(page, 'br-mylevels') && !/Best/.test(await text(page, '.br-ml-meta')), 'a changed track loses its old best time', await text(page, '.br-ml-meta'));
  ok(page.errors.length === 0, 'no errors in the page', page.errors);
  await page.context().close();

  console.log('Saved levels');
  const saved = { v: 1, levels: [
    { id: 'aaa1', updated: 2, best: null, data: { v: 1, name: 'Hills', pieces: [{ t: 'ramp1', x: 9, y: 0, a: 0, m: false }], finish: { x: 17.9, y: 0.5, d: 1 } } },
    { id: 'bbb2', updated: 1, best: null, data: { v: 1, name: 'Flat', pieces: [{ t: 'line2', x: 9, y: 0, a: 0, m: false }], finish: { x: 17, y: 0, d: 1 } } },
  ] };
  page = await phone(browser, { levels: saved, query: '?autopilot' });
  await tap(page, '#br-go-editor');
  let names = await page.$$eval('.br-ml-name', els => els.map(e => e.value));
  ok(names.join() === 'Hills,Flat', 'My levels lists saved levels, latest first', names);
  // play from the list
  await page.locator('.br-ml-card[data-id="bbb2"] [data-act="play"]').click();
  await page.waitForFunction(() => !document.getElementById('br-result').hidden, null, { timeout: 30000 });
  ok(await text(page, '#br-res-title') === 'Finished!' && await text(page, '#br-res-levels') === 'My levels', 'a level played from the list finishes and goes back to My levels');
  await tap(page, '#br-res-levels');
  ok(await visible(page, 'br-mylevels') && /Best \d+\.\d\ds/.test(await text(page, '.br-ml-card[data-id="bbb2"] .br-ml-meta')), 'the list shows its best time', await text(page, '.br-ml-card[data-id="bbb2"] .br-ml-meta'));
  // rename
  await page.locator('.br-ml-card[data-id="aaa1"] .br-ml-name').fill('Big hills');
  await page.locator('.br-ml-card[data-id="aaa1"] .br-ml-name').press('Enter');
  s = await stored(page);
  ok(s.levels.find(L => L.id === 'aaa1').data.name === 'Big hills', 'renaming in the list saves the new name');
  // still there after a reload
  await page.reload();
  await page.waitForFunction(() => window.BikeRace && !document.getElementById('br-home').hidden, null, { timeout: 5000 });
  await tap(page, '#br-go-editor');
  names = await page.$$eval('.br-ml-name', els => els.map(e => e.value));
  ok(names.includes('Big hills') && names.includes('Flat'), 'levels are still there after a reload', names);
  // edit opens it
  await page.locator('.br-ml-card[data-id="aaa1"] [data-act="edit"]').click();
  ok(await visible(page, 'br-editor') && await text(page, '#br-ed-name') === 'Big hills' && (await state(page)).pieces[0].t === 'ramp1', 'Edit opens the saved level');
  await tap(page, '#br-ed-back');
  // delete asks once
  const del = page.locator('.br-ml-card[data-id="bbb2"] [data-act="del"]');
  await del.click();
  ok(await del.textContent() === 'Sure?' && await page.locator('.br-ml-card').count() === 2, 'Delete asks to be sure first');
  await del.click();
  ok(await page.locator('.br-ml-card').count() === 1 && (await stored(page)).levels.length === 1, 'a second tap deletes the level');
  ok(page.errors.length === 0, 'no errors in the page', page.errors);
  await page.context().close();

  console.log('Damaged storage');
  const bad = { v: 1, levels: [{ id: '../x', data: {} }, null, 5, { id: 'okay1', data: { name: '<img src=x onerror="window.pwned=1">', pieces: [{ t: 'nope' }, { t: 'line1', x: 'NaN', y: 1e99 }] } }, { id: 'okay1', data: {} }] };
  page = await phone(browser, { levels: bad });
  await tap(page, '#br-go-editor');
  ok(await page.locator('.br-ml-card').count() === 1, 'only well-formed levels are listed', await page.locator('.br-ml-card').count());
  ok(await page.evaluate(() => !document.querySelector('#br-ml-list img') && !window.pwned), 'a name is shown as text, never as page markup');
  await page.locator('.br-ml-card [data-act="edit"]').click();
  st = await state(page);
  ok(st.n === 1 && st.pieces[0].y === 5000 && st.pieces[0].x === 0, 'pieces are cleaned up when the level opens', st.pieces);
  page.errors = page.errors.filter(e => !/favicon/.test(e));
  for (const raw of ['not json', '{"levels": 7}']) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORE, raw]);
    await page.evaluate(() => BikeRace.editor.showView('mylevels'));
    ok(/No levels yet/.test(await text(page, '#br-ml-list')), `storage holding ${raw} shows an empty list`);
  }
  ok(page.errors.length === 0, 'no errors in the page', page.errors);
  await page.context().close();

  console.log('Fits on phones held sideways');
  if (keep) fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, h] of [[844, 390], [932, 430], [740, 360], [667, 375], [667, 320], [568, 320]]) {
    page = await phone(browser, { w, h, levels: saved });
    const home = await page.evaluate(() => { const r = document.getElementById('br-go-editor').getBoundingClientRect(); return r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.width > 100; });
    ok(home, `the Level editor button fits on the home menu at ${w}x${h}`);
    await tap(page, '#br-go-editor');
    await page.locator('.br-ml-card[data-id="aaa1"] [data-act="edit"]').click();
    for (const t of ['line2', 'loop2']) await addTile(page, t);
    await wait(400);
    const fit = await page.evaluate(() => {
      const R = (el) => el.getBoundingClientRect(), out = [];
      const inside = (el) => { const r = R(el); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; };
      for (const el of document.querySelectorAll('#br-editor .br-ed-tl button, #br-ed-test, .br-ed-bar, .br-ed-modes button, .br-ed-acts button')) if (!inside(el)) out.push(el.id || el.className);
      const back = R(document.getElementById('br-ed-redo')), test = R(document.getElementById('br-ed-test')), name = R(document.getElementById('br-ed-name'));
      const tiles = [...document.querySelectorAll('.br-ed-tile')].map(R), row = document.getElementById('br-ed-row');
      const small = [...document.querySelectorAll('.br-ed-modes button, .br-ed-acts button, #br-editor .br-ed-tl button')].map(R).filter(r => r.height < 17 || r.width < 30).length;
      return { out, overlap: name.left < back.right - 1 || name.right > test.left + 1, tileW: Math.min(...tiles.map(r => r.width)), tileH: Math.min(...tiles.map(r => r.height)), scrolls: row.scrollWidth > row.clientWidth + 1, small };
    });
    ok(!fit.out.length && !fit.overlap && !fit.small, `the editor's buttons fit at ${w}x${h}`, fit);
    ok(fit.tileW >= 44 && fit.tileH >= 44, `the pieces are big enough to tap at ${w}x${h}`, fit);
    // the last piece in the row can be reached (the row scrolls on small phones)
    await page.locator('.br-ed-tile[data-t="loop3"]').scrollIntoViewIfNeeded();
    const last = await page.evaluate(() => { const r = document.querySelector('.br-ed-tile[data-t="loop3"]').getBoundingClientRect(), row = document.getElementById('br-ed-row').getBoundingClientRect(); return r.right <= row.right + 1 && r.left >= row.left - 1; });
    ok(last, `every piece in the row can be reached at ${w}x${h}`);
    if (keep) await page.screenshot({ path: path.join(SHOTS, `editor-${w}x${h}.png`) });
    await tap(page, '#br-ed-back');
    const list = await page.evaluate(() => { const c = document.querySelector('.br-ml-card'), r = c.getBoundingClientRect(); return { right: r.right - innerWidth, over: c.scrollWidth - c.clientWidth }; });
    ok(list.right <= 0 && list.over <= 1, `the My levels cards fit at ${w}x${h}`, list);
    if (keep) { await wait(500); await page.screenshot({ path: path.join(SHOTS, `mylevels-${w}x${h}.png`) }); }
    ok(page.errors.length === 0, 'no errors in the page', page.errors);
    await page.context().close();
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
