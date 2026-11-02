// Renders the Bike Race picture for its card on the Pick a Game menu (public/assets/img/bike-race.jpg) with the
// game's own drawing code: three computer riders on a real level, the leader in the air over a gap.
//
// Usage: bun tools/render-bike-race-card.ts [--level=clover-6] [--t=5] [--out=path.jpg]
//   --level  which level to film      --t  seconds into the race to freeze it
// Draws in Bun's built-in headless browser (Bun.WebView), which needs Chrome or Chromium installed.
import { join } from 'node:path';

const arg = (k: string, d: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const LEVEL = arg('level', 'clover-6');
const T = +arg('t', '5');
const OUT = arg('out', join(import.meta.dir, '..', 'public', 'assets', 'img', 'bike-race.jpg'));
const JS = join(import.meta.dir, '..', 'public', 'js');

// The drawing code as plain scripts on a blank page with a canvas
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  routes: {
    '/': new Response(
      '<!doctype html><body style="margin:0"><canvas id="c" width="1280" height="960"></canvas>' +
        '<script src="core.js"></script><script src="art.js"></script></body>',
      { headers: { 'Content-Type': 'text/html' } },
    ),
    '/core.js': new Response(Bun.file(join(JS, 'bike-race-core.ts')), { headers: { 'Content-Type': 'text/javascript' } }),
    '/art.js': Bun.file(join(JS, 'bike-race-art.js')),
  },
});

// runs in the page
function draw(levelId: string, tFreeze: number): string {
  const { BikeRaceCore: C, BikeRaceArt: A } = window as any;
  const def = C.levelById(levelId),
    world = C.worldOf(levelId),
    level = C.buildLevel(world, def);
  const sim = new C.Sim(level);
  // three bikes held to the same speed so they stay in one picture, all ridden by the computer
  const riders = [
    { bike: 'comet', paint: A.paintAt(0), x: 0, cfg: { maxSpeed: 14 } },
    { bike: 'scout', paint: A.paintAt(1), x: -3.5, cfg: { maxSpeed: 14 } },
    { bike: 'twister', paint: A.paintAt(2), x: -7, cfg: { maxSpeed: 14 } },
  ].map((r) => ({ ...r, b: sim.addBike(r.bike, { x: r.x, id: r.bike }) }));
  for (const r of riders) r.b.running = true;
  while (sim.t < tFreeze) {
    for (const r of riders) r.b.input = C.botInput(r.b, r.cfg);
    sim.step();
  }
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const g = canvas.getContext('2d')!;
  g.scale(2, 2);
  const cam = new A.Camera();
  cam.W = 640;
  cam.H = 480;
  cam.ppm = 40;
  const lead = riders[0]!.b;
  cam.x = lead.c.x - 3;
  cam.y = lead.c.y - 1.5;
  const theme = A.THEMES[world.id];
  A.drawSky(g, cam, theme, 0);
  A.drawLayers(g, cam, theme, 0);
  A.drawLoops(g, cam, level, theme);
  A.drawTerrain(g, cam, level, theme);
  A.drawMarkers(g, cam, level, 0, false);
  for (const r of riders.slice().reverse()) {
    const b = r.b;
    const pose = { x: b.c.x, y: b.c.y, a: b.c.a, lean: b.leanVis, wheels: b.wheels.map((W: any) => [W.x, W.y, W.phi]) };
    A.drawBike(g, cam, pose, { bike: r.bike, paint: r.paint });
  }
  A.drawHazards(g, cam, level, 0);
  return canvas.toDataURL('image/jpeg', 0.88);
}

try {
  await using view = new Bun.WebView({ width: 640, height: 480 });
  await view.navigate(server.url.href);
  const jpg = (await view.evaluate(`(${draw})(${JSON.stringify(LEVEL)}, ${T})`)) as string;
  // halve to 640x480 for the card
  await view.navigate('about:blank');
  await view.cdp('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await view.evaluate(
    `new Promise((done) => { document.body.style.margin = '0'; const img = new Image(); img.style.cssText = 'width:640px;height:480px;display:block'; img.onload = done; img.src = ${JSON.stringify(jpg)}; document.body.append(img); })`,
  );
  const shot = (await view.screenshot({ format: 'jpeg', quality: 86 })) as Blob;
  await Bun.write(OUT, shot);
  console.log(`wrote ${OUT} (${(shot.size / 1024).toFixed(0)} KB)`);
} finally {
  server.stop(true);
}
