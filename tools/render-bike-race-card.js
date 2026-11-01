// Renders the Bike Race picture for its card on the Pick a Game menu (public/assets/img/bike-race.jpg) with the
// game's own drawing code: three computer riders on a real level, the leader in the air over a gap.
//
// Usage: node tools/render-bike-race-card.js [--level=clover-6] [--t=5] [--out=path.jpg]
//   --level  which level to film      --t  seconds into the race to freeze it
// Needs Playwright, like the browser tests. Starts its own server on port 8129 (BR_PORT to change it).
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const LEVEL = arg('level', 'clover-6'), T = +arg('t', 5);
const OUT = arg('out', path.join(__dirname, '..', 'public', 'assets', 'img', 'bike-race.jpg'));
const PORT = +(process.env.BR_PORT || 8129), BASE = `http://127.0.0.1:${PORT}/`;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const server = spawn('python3', [path.join(__dirname, 'serve.py')], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch (e) { await wait(100); } }
    const page = await browser.newPage();
    await page.goto(BASE + 'js/bike-race-core.js');   // any page on the server, for the scripts' origin
    await page.setContent('<canvas id="c" width="1280" height="960"></canvas>');
    await page.addScriptTag({ url: BASE + 'js/bike-race-core.js' });
    await page.addScriptTag({ url: BASE + 'js/bike-race-art.js' });
    const jpg = await page.evaluate(([levelId, tFreeze]) => {
      const C = window.BikeRaceCore, A = window.BikeRaceArt;
      const def = C.levelById(levelId), world = C.worldOf(levelId), level = C.buildLevel(world, def);
      const sim = new C.Sim(level);
      // three bikes held to the same speed so they stay in one picture, all ridden by the computer
      const riders = [
        { bike: 'comet', paint: A.paintAt(0), x: 0, cfg: { maxSpeed: 14 } },
        { bike: 'scout', paint: A.paintAt(1), x: -3.5, cfg: { maxSpeed: 14 } },
        { bike: 'twister', paint: A.paintAt(2), x: -7, cfg: { maxSpeed: 14 } },
      ].map(r => Object.assign(r, { b: sim.addBike(r.bike, { x: r.x, id: r.bike }) }));
      for (const r of riders) r.b.running = true;
      while (sim.t < tFreeze) {
        for (const r of riders) r.b.input = C.botInput(r.b, r.cfg);
        sim.step();
      }
      const canvas = document.getElementById('c'), g = canvas.getContext('2d');
      g.scale(2, 2);
      const cam = new A.Camera(); cam.W = 640; cam.H = 480; cam.ppm = 40;
      const lead = riders[0].b;
      cam.x = lead.c.x - 3; cam.y = lead.c.y - 1.5;
      const theme = A.THEMES[world.id];
      A.drawSky(g, cam, theme, 0); A.drawLayers(g, cam, theme, 0); A.drawLoops(g, cam, level, theme);
      A.drawTerrain(g, cam, level, theme); A.drawMarkers(g, cam, level, 0, false);
      for (const r of riders.slice().reverse()) {
        const b = r.b;
        A.drawBike(g, cam, { x: b.c.x, y: b.c.y, a: b.c.a, lean: b.leanVis, wheels: b.wheels.map(W => [W.x, W.y, W.phi]) }, { bike: r.bike, paint: r.paint });
      }
      A.drawHazards(g, cam, level, 0);
      return canvas.toDataURL('image/jpeg', 0.88);
    }, [LEVEL, T]);
    // halve to 640x480 for the card
    const small = await browser.newPage({ viewport: { width: 640, height: 480 } });
    await small.setContent(`<body style="margin:0"><img src="${jpg}" style="width:640px;height:480px;display:block"></body>`);
    await small.waitForFunction(() => document.querySelector('img').complete);
    const buf = await small.screenshot({ type: 'jpeg', quality: 86 });
    fs.writeFileSync(OUT, buf);
    console.log(`wrote ${OUT} (${(buf.length / 1024).toFixed(0)} KB)`);
  } finally { await browser.close(); server.kill(); }
}
main().catch(e => { console.error(e); process.exit(1); });
