// Browser checks for Bike Race live races: two phones in headless Chromium race each other through the race server
// (tools/serve.py), over http and over https with the event stream fallback, and a page with no race server falls
// back to racing computer riders. The computer rider steers both bikes (?autopilot).
//
// Usage: node tools/test-bike-race-online.js [--keep]     (needs Playwright; about two minutes)
// It starts its own servers on ports 8126 to 8128 (BR_PORT moves them). --keep saves screenshots to tools/.shots/.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const PORT = +(process.env.BR_PORT || 8126);
const keep = process.argv.includes('--keep');
const SHOTS = path.join(__dirname, '.shots');
let failed = 0, passed = 0;
const ok = (cond, what, extra) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const servers = [];

function serve(port, args = [], env = {}) {
  const p = spawn('python3', [path.join(__dirname, 'serve.py'), ...args], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BR_ENDING: '10', BR_AWAY: '30', ...env }, stdio: 'ignore' });
  servers.push(p);
  return p;
}
async function up(url) {
  for (let i = 0; i < 80; i++) {
    try { await fetch(url); return; } catch (e) {
      if (e.cause && /self.signed|certificate/i.test(String(e.cause.code || e.cause.message))) return;
      await wait(100);
    }
  }
  throw new Error('server did not start: ' + url);
}

// Stars unlock Hopper (10), so the two riders are on different bikes.
const stars = (n) => { const s = {}; for (const id of ['clover-1', 'clover-2', 'clover-3', 'clover-4', 'clover-5', 'clover-6']) { if (n <= 0) break; s[id] = Math.min(3, n); n -= s[id]; } return s; };
const ANN = { name: 'Ann', paint: 2 };
const BEA = { name: 'Bea', paint: 6, bike: 'hopper', stars: stars(12), best: { 'clover-1': 30, 'clover-2': 30, 'clover-3': 30, 'clover-4': 30 } };

async function phone(browser, base, { save = null, query = '?autopilot', hash = '#bike-race', https = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: https });
  await ctx.grantPermissions(['accelerometer', 'gyroscope']).catch(() => {});
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|jsdelivr|WebSocket connection/.test(m.text())) page.errors.push(m.text()); });
  await page.route(/cdn\.jsdelivr\.net|fonts\.googleapis|fonts\.gstatic/, r => r.abort());
  await page.goto(base + 'favicon-none');
  await page.evaluate((s) => { localStorage.clear(); sessionStorage.clear(); if (s) localStorage.setItem('bikerace.v1', JSON.stringify(s)); }, save);
  await page.goto(base + query + hash);
  await page.waitForFunction(() => window.BikeRace && document.querySelector('#br-app .br-screen:not([hidden])'), null, { timeout: 8000 });
  return page;
}
const dbg = (page, fn, arg) => page.evaluate(new Function('arg', 'const d = BikeRace._debug(); return (' + fn + ')(d, arg);'), arg);
const visible = (page, id) => page.evaluate((id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.offsetParent !== null; }, id);
const text = (page, sel) => page.evaluate((sel) => (document.querySelector(sel) || {}).textContent || '', sel);
const until = (page, fn, arg, ms = 10000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const online = (page) => until(page, () => BikeRace._debug().Net.status === 'online' && BikeRace._debug().Net.id);
const inRoom = (page, n) => until(page, (n) => { const el = document.getElementById('br-mp-room'); return !el.hidden && document.querySelectorAll('#br-room-players li').length === n; }, n);
const racing = (page) => until(page, () => { const d = BikeRace._debug(); return d.S && d.S.mode === 'online' && d.S.phase === 'run'; });
const results = (page, ms = 60000) => until(page, () => !document.getElementById('br-raceresult').hidden, null, ms);
const standings = (page) => page.$$eval('#br-rr-list li', els => els.map(e => ({ name: e.querySelector('.nm').textContent, time: e.querySelector('.tm').textContent, me: e.classList.contains('me') })));

async function main() {
  serve(PORT);
  serve(PORT + 1, ['--https']);
  servers.push(spawn('python3', ['-m', 'http.server', String(PORT + 2), '--bind', '127.0.0.1', '--directory', path.join(__dirname, '..', 'public')], { stdio: 'ignore' }));
  try {
    await up(`http://127.0.0.1:${PORT}/`); await up(`https://127.0.0.1:${PORT + 1}/`); await up(`http://127.0.0.1:${PORT + 2}/`);
    if (keep) fs.mkdirSync(SHOTS, { recursive: true });
    const browser = await chromium.launch();
    try { await run(browser); } finally { await browser.close(); }
  } finally { for (const s of servers) s.kill(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

async function run(browser) {
  const BASE = `http://127.0.0.1:${PORT}/`;
  console.log('Two phones meet in a room');
  const a = await phone(browser, BASE, { save: ANN });
  ok(await page_enabled(a, '#br-go-mp'), 'the Multiplayer button is switched on');
  await a.locator('#br-go-mp').click();
  ok(await online(a), 'the first phone finds the race server');
  ok(await dbg(a, d => d.Net.transport) === 'ws', 'over a WebSocket');
  ok(await visible(a, 'br-mp-lobby') && await visible(a, 'br-mp-cpu'), 'it shows the lobby and the computer race');
  await a.selectOption('#br-mp-level', 'clover-2');
  await a.locator('#br-mp-create').click();
  ok(await inRoom(a, 1), 'Create room opens a room');
  const code = await text(a, '#br-room-code');
  ok(/^[A-Z]{4}$/.test(code), 'with a 4-letter code', code);
  ok((await text(a, '#br-room-link')).endsWith('#bike-race/' + code), 'and an invite link', await text(a, '#br-room-link'));
  ok(await visible(a, 'br-room-start') && !(await visible(a, 'br-mp-cpu')), 'the host can start, and the computer race is out of the way');
  if (keep) await a.screenshot({ path: path.join(SHOTS, 'online-room-host.png') });

  const b = await phone(browser, BASE, { save: BEA, hash: '#bike-race/' + code.toLowerCase() });
  ok(await inRoom(b, 2), 'the invite link puts the second phone in the room');
  ok(await until(b, () => location.hash === '#bike-race'), 'and tidies the address');
  ok(await inRoom(a, 2), 'the host sees the second rider arrive');
  const riders = await a.$$eval('#br-room-players li', els => els.map(e => e.textContent));
  ok(/Ann.*host/.test(riders[0]) && /Bea.*Hopper/.test(riders[1]), 'with names, host and bikes', riders);
  ok(!(await visible(b, 'br-room-start')) && /Waiting for Ann/.test(await text(b, '#br-room-note')), 'the guest waits for the host', await text(b, '#br-room-note'));
  ok(await text(b, '#br-room-level-text') === 'Clover Hills 2 · ' + await a.evaluate(() => BikeRaceCore.levelById('clover-2').name), 'the guest sees the track');
  if (keep) await b.screenshot({ path: path.join(SHOTS, 'online-room-guest.png') });

  console.log('A live race');
  await a.locator('#br-room-start').click();
  ok(await racing(a) && await racing(b), 'Start race counts down and starts the race on both phones');
  const tagA = await dbg(a, d => [...d.S.remote.values()].map(r => r.look.name + ' ' + r.look.bike));
  const tagB = await dbg(b, d => [...d.S.remote.values()].map(r => r.look.name + ' ' + r.look.bike));
  ok(tagA.join() === 'Bea hopper' && tagB.join() === 'Ann scout', 'each phone has the other rider, with their name and bike', [tagA, tagB]);
  await wait(2500);
  const seen = await dbg(a, d => { const r = [...d.S.remote.values()][0]; const p = d.remotePose(r, performance.now() / 1000); return { n: r.buf.length, x: p && p.x, me: d.S.me.c.x }; });
  ok(seen.n > 20 && seen.x > 5, 'the other rider\'s positions stream in and their bike moves', seen);
  ok(Math.abs(seen.x - seen.me) < 25, 'the two bikes are near each other on the track', seen);
  ok(/\/ 2$/.test(await text(a, '#br-pos')), 'the HUD shows the place out of 2', await text(a, '#br-pos'));
  if (keep) await a.screenshot({ path: path.join(SHOTS, 'online-race.png') });
  ok(await results(a) && await results(b), 'both phones get the results');
  const sa = await standings(a), sb = await standings(b);
  ok(sa.length === 2 && sa.map(r => r.name + r.time).join() === sb.map(r => r.name + r.time).join() && sa.every(r => /s$/.test(r.time)), 'the same standings on both, with two times', [sa, sb]);
  ok(sa.find(r => r.me).name === 'Ann' && sb.find(r => r.me).name === 'Bea', 'each phone highlights its own row');
  ok(await visible(a, 'br-rr-again') && !(await visible(b, 'br-rr-again')) && await visible(b, 'br-rr-wait'), 'the host can race again, the guest waits');
  if (keep) await b.screenshot({ path: path.join(SHOTS, 'online-results.png') });

  console.log('Leaving a race, the last race, and racing again');
  await b.locator('#br-rr-room').click();
  ok(await inRoom(b, 2) && await visible(b, 'br-room-last'), 'Back to room shows the room with the last race');
  const winner = sa[0].name;
  ok(new RegExp(`${winner}.*1 win`).test((await b.$$eval('#br-room-players li', els => els.map(e => e.textContent))).join('|')), 'the winner has a win');
  await a.locator('#br-rr-again').click();
  ok(await racing(a) && await racing(b), 'Race again starts a race for the host on the results sheet and the guest in the room');
  await wait(800);
  await a.locator('#br-pause').click();
  await a.locator('#br-p-levels').click();
  ok(await inRoom(a, 2) && /race is on/i.test(await text(a, '#br-room-note')), 'Leave race in the pause menu goes back to the room while the race goes on', await text(a, '#br-room-note'));
  ok(await results(b), 'the other rider still finishes and gets results');
  const s2 = await standings(b);
  ok(s2.length === 2 && s2[0].name === 'Bea' && s2[1].time === 'DNF', 'the one who left the race did not finish', s2);
  ok(await until(a, () => !document.getElementById('br-room-last').hidden && /DNF/.test(document.getElementById('br-room-last-list').textContent)), 'the room shows that race too');

  console.log('A dropped connection comes back');
  await b.locator('#br-rr-room').click();
  const idB = await dbg(b, d => d.Net.id);
  await dbg(b, d => d.Net._t.kill());
  ok(await until(b, () => BikeRace._debug().Net.status === 'online' && BikeRace._debug().Net.id), 'the phone reconnects by itself');
  ok(await dbg(b, d => d.Net.id) === idB && await inRoom(b, 2), 'as the same rider, still in the room');
  await a.locator('#br-room-start').click();
  ok(await racing(a) && await racing(b), 'a third race starts');
  await wait(1500);
  await dbg(b, d => d.Net.close());
  ok(await until(a, () => /away/.test(document.getElementById('br-room-players').textContent) || [...BikeRace._debug().S.remote.values()].length === 1), 'one phone loses its connection mid-race');
  ok(await until(b, () => BikeRace._debug().S.me.finished, null, 60000), 'it keeps riding and crosses the line offline');
  await dbg(b, d => d.Net.connect());
  ok(await results(a) && await results(b), 'once it is back, its finish counts and both get results');
  const s3 = await standings(a);
  ok(s3.length === 2 && s3.every(r => /s$/.test(r.time)), 'with two times', s3);
  await b.locator('#br-rr-room').click();
  await a.locator('#br-rr-room').click();
  await b.locator('#br-room-leave').click();
  ok(await until(b, () => !document.getElementById('br-mp-lobby').hidden), 'Leave room goes back to the lobby');
  ok(await inRoom(a, 1), 'and the host sees them go');
  await b.reload();
  await b.waitForFunction(() => window.BikeRace && !document.getElementById('br-home').hidden);
  await b.locator('#br-go-mp').click();
  await online(b);
  ok(await until(b, (c) => [...document.querySelectorAll('#br-mp-rooms li')].some(li => li.textContent.includes(c)), code), 'the open room is listed in the lobby');
  await b.locator(`#br-mp-rooms button[data-code="${code}"]`).click();
  ok(await inRoom(b, 2), 'and Join from the list works');
  await a.locator('#br-room-leave').click();
  ok(await until(b, () => !document.getElementById('br-room-start').hidden), 'when the host leaves, the other rider becomes host');
  ok(a.errors.length === 0 && b.errors.length === 0, 'no errors in either page', [a.errors, b.errors]);
  await a.context().close(); await b.context().close();

  console.log('Over https, with one phone on the event stream');
  const HTTPS = `https://127.0.0.1:${PORT + 1}/`;
  const c = await phone(browser, HTTPS, { save: ANN, https: true });
  await c.locator('#br-go-mp').click();
  ok(await online(c), 'a phone finds the race server over https');
  ok(await dbg(c, d => d.Net.transport) === 'ws', 'with a secure WebSocket');
  await c.locator('#br-mp-create').click();
  await inRoom(c, 1);
  const code2 = await text(c, '#br-room-code');
  const e = await phone(browser, HTTPS, { save: BEA, query: '?autopilot&net=sse', hash: '#bike-race/' + code2, https: true });
  ok(await inRoom(e, 2), 'a phone on the event stream joins through the link');
  ok(await dbg(e, d => d.Net.transport) === 'sse', 'it really is on the event stream');
  await c.locator('#br-room-start').click();
  ok(await racing(c) && await racing(e), 'they race');
  await wait(2000);
  const seen2 = await dbg(c, d => [...d.S.remote.values()][0].buf.length);
  ok(seen2 > 15, 'positions from the event stream phone arrive', seen2);
  const seen3 = await dbg(e, d => [...d.S.remote.values()][0].buf.length);
  ok(seen3 > 15, 'and the event stream phone gets the others', seen3);
  ok(await results(c) && await results(e), 'both get results');
  ok((await standings(c)).length === 2 && (await standings(e)).every(r => /s$/.test(r.time)), 'with both times', await standings(e));
  ok(c.errors.length === 0 && e.errors.length === 0, 'no errors in either page', [c.errors, e.errors]);
  await c.context().close(); await e.context().close();

  console.log('No race server: race the computer');
  const STATIC = `http://127.0.0.1:${PORT + 2}/`;
  const f = await phone(browser, STATIC, { save: ANN, hash: '#bike-race/BCDF' });
  ok(await until(f, () => !document.getElementById('br-mp-offline').hidden), 'a link to a room on a page with no race server says so');
  ok(/Room BCDF/.test(await text(f, '#br-mp-offline-why')) && await visible(f, 'br-mp-cpu'), 'it names the room and offers the computer race', await text(f, '#br-mp-offline-why'));
  if (keep) await f.screenshot({ path: path.join(SHOTS, 'online-offline.png') });
  await f.locator('#br-cpu-count button[data-n="3"]').click();
  await f.locator('#br-cpu-start').click();
  ok(await until(f, () => { const d = BikeRace._debug(); return d.S && d.S.mode === 'cpu' && d.S.cpus.length === 3; }), 'Race computer riders starts a race against three');
  ok(await results(f), 'and it ends with standings');
  ok((await standings(f)).length === 4, 'four riders in the standings');
  ok(f.errors.length === 0, 'no errors in the page', f.errors);
  await f.context().close();

  console.log('The multiplayer screens fit on phones');
  for (const [w, h] of [[568, 320], [844, 390]]) {
    const g = await phone(browser, BASE, { save: ANN });
    await g.setViewportSize({ width: w, height: h });
    await g.locator('#br-go-mp').click();
    await online(g);
    await g.locator('#br-mp-create').click();
    await inRoom(g, 1);
    const fit = await g.evaluate(() => { const scr = document.getElementById('br-mp'), out = []; for (const el of scr.querySelectorAll('.br-panel, .b, input, select')) { if (el.offsetParent === null) continue; const r = el.getBoundingClientRect(); if (r.left < -1 || r.right > innerWidth + 1) out.push(el.id || el.className); } return { out, wide: scr.scrollWidth - scr.clientWidth }; });
    ok(!fit.out.length && fit.wide <= 1, `the room fits across at ${w}x${h}`, fit);
    if (keep) await g.screenshot({ path: path.join(SHOTS, `online-room-${w}x${h}.png`), fullPage: false });
    await g.context().close();
  }
}
const page_enabled = (page, sel) => page.evaluate((sel) => !document.querySelector(sel).disabled, sel);

main().catch(e => { console.error(e); process.exitCode = 1; });
