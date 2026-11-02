// Plays Castle Defender in Bun's headless browser the way a person would: the king rides to the coins and stands on
// the pads to buy, through the gates and around the buildings (no teleports, no free coins). Prints a line per
// minute of game time and how long the castle held. For balance work on the open world.
//
// Usage: bun tools/play-castle-defender.ts [minutes=15] [strategy=balanced] [--check] [--no-lands]
//   strategy: balanced (buys the cheapest pad it can afford, outposts a little later), turtle (outposts last),
//             expand (outposts first)
//   --check: fail unless the castle holds 9 minutes and the border has been pushed out by 5 outposts (balanced)
//   --no-lands: the lands past the first border never open (no shops...), to compare with the game before them
// It serves the site itself, like the browser tests, and needs Chrome or Chromium installed.
import { openPage, startSite } from '../tests/support/browser';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const minutes = +(args[0] || 15),
  strategy = args[1] || 'balanced',
  check = process.argv.includes('--check'),
  noLands = process.argv.includes('--no-lands');

type Gate = [x: number, z: number, nx: number, nz: number];
interface Bot {
  goal: string;
  stuck: number;
  last: [number, number];
  via: Gate | null;
  viaFrom?: boolean;
  phase?: number;
  wiggle: number;
  wa?: number;
  outposts: number[]; // the game time each outpost went up
  lands: number[]; // the game time each land opened
}
declare global {
  interface Window {
    __bot?: Bot;
    __think?: () => void;
  }
}

// runs in the page: one decision, every tenth of a second of game time
function bot(strategy: string): void {
  const d = window.CastleDefender!._debug();
  const GATES: Gate[] = [
    [14, 0, 1, 0],
    [0, -12, 0, -1],
    [6, 12, 0, 1],
    [-14, -7, -1, 0],
  ]; // centre and outward normal
  const inBase = (x: number, z: number) => Math.abs(x) < 14 && Math.abs(z) < 12;
  // does the straight line from a to b run through the walled base?
  const crosses = (ax: number, az: number, bx: number, bz: number) => {
    const dx = bx - ax,
      dz = bz - az;
    let t0 = 0,
      t1 = 1;
    const clip = (p: number, q: number) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    return clip(-dx, ax + 15.2) && clip(dx, 15.2 - ax) && clip(-dz, az + 13.2) && clip(dz, 13.2 - az) && t0 <= t1;
  };
  const B: Bot = (window.__bot = {
    goal: '',
    stuck: 0,
    last: [0, 0],
    via: null,
    wiggle: 0,
    outposts: [],
    lands: [],
  });
  window.__think = () => {
    const G = d.G,
      k = G.king;
    // buy the cheapest pad there are coins for (outposts weighted by strategy), else pick up the nearest coin;
    // weapons cost twice what they did when these weights were set, so the forge counts half as much to keep them
    // coming in the same order, and with coins for the forge four times over the next weapon comes first
    const outpostWeight = ({ expand: 0.5, turtle: 6 } as Record<string, number>)[strategy] || 1.1;
    const weight = (p: { id: string; cost: number }) =>
      p.id === 'forge' && p.cost * 4 <= G.coins
        ? 0
        : p.cost * (p.id.startsWith('outpost') ? outpostWeight : p.id === 'forge' ? 0.4 : p.id === 'recruit' ? 0.8 : 1);
    const want = G.pads
      .filter((p) => p.visibleNow && p.cost - p.paid > 0 && p.cost - p.paid <= G.coins)
      .sort((a, b) => weight(a) - weight(b))[0];
    let tx = 24,
      tz = 0;
    B.goal = 'wait';
    if (want) {
      tx = want.x;
      tz = want.z;
      B.goal = want.id;
    } else {
      let best = null as { x: number; z: number } | null,
        bd = 1e9;
      for (const c of G.coinsOnGround) {
        if (c.age < 0.3 || d.borderDist(c.x, c.z) > -0.5) continue;
        const v = Math.hypot(c.x - k.x, c.z - k.z) + Math.hypot(c.x - 4, c.z) * 0.3;
        if (v < bd) {
          bd = v;
          best = c;
        }
      }
      // a shop's till worth the ride (a full one more so) beats a coin as far away
      let till = false;
      for (const s of d.shops()) {
        const tl = s.till;
        if (!s.lv || tl.value < Math.max(150, tl.cap * 0.3)) continue;
        const v =
          Math.hypot(tl.x - k.x, tl.z - k.z) * (tl.value > tl.cap * 0.95 ? 0.5 : 0.8) +
          Math.hypot(tl.x - 4, tl.z) * 0.3;
        if (v < bd) {
          bd = v;
          best = tl;
          till = true;
        }
      }
      if (best) {
        tx = best.x;
        tz = best.z;
        B.goal = till ? 'till' : 'coin';
      }
    }
    // a pad on the wall line is bought from just inside
    if (
      (Math.abs(Math.abs(tx) - 14) < 0.8 && Math.abs(tz) < 12.8) ||
      (Math.abs(Math.abs(tz) - 12) < 0.8 && Math.abs(tx) < 14.8)
    ) {
      tx = Math.max(-12.6, Math.min(12.6, tx));
      tz = Math.max(-10.6, Math.min(10.6, tz));
    }
    if (G.wallsUp && inBase(k.x, k.z) !== inBase(tx, tz)) {
      // in or out through the best gate: to a spot in front of it, then through
      if (!B.via || B.viaFrom !== inBase(k.x, k.z)) {
        B.via = GATES.reduce((a, g) =>
          Math.hypot(g[0] - k.x, g[1] - k.z) + Math.hypot(g[0] - tx, g[1] - tz) <
          Math.hypot(a[0] - k.x, a[1] - k.z) + Math.hypot(a[0] - tx, a[1] - tz)
            ? g
            : a,
        );
        B.viaFrom = inBase(k.x, k.z);
        B.phase = 0;
      }
      const [gx, gz, nx, nz] = B.via,
        s = B.viaFrom ? 1 : -1,
        bx = gx - nx * 3 * s,
        bz = gz - nz * 3 * s;
      if (B.phase === 0 && Math.hypot(k.x - bx, k.z - bz) < 1) B.phase = 1;
      if (B.phase === 0) {
        tx = bx;
        tz = bz;
      } else {
        tx = gx + nx * 3 * s;
        tz = gz + nz * 3 * s;
      }
    } else {
      B.via = null;
      // outside to outside: round a corner of the base rather than into its walls
      if (G.wallsUp && !inBase(k.x, k.z) && crosses(k.x, k.z, tx, tz)) {
        let best = null as [number, number] | null,
          bd = 1e9;
        for (const [cx, cz] of [
          [17, 15],
          [17, -15],
          [-17, 15],
          [-17, -15],
        ] as const) {
          if (crosses(k.x, k.z, cx, cz) || Math.hypot(cx - k.x, cz - k.z) < 1) continue;
          const v = Math.hypot(cx - k.x, cz - k.z) + Math.hypot(tx - cx, tz - cz) + (crosses(cx, cz, tx, tz) ? 60 : 0);
          if (v < bd) {
            bd = v;
            best = [cx, cz];
          }
        }
        if (best) [tx, tz] = best;
      }
    }
    // round the first building in the way
    for (const [ox, oz, r] of G.obs!) {
      const ex = tx - k.x,
        ez = tz - k.z,
        L = Math.hypot(ex, ez) || 1,
        ux = ex / L,
        uz = ez / L;
      const along = (ox - k.x) * ux + (oz - k.z) * uz,
        side = (ox - k.x) * uz - (oz - k.z) * ux;
      if (along > 0 && along < L && Math.abs(side) < r + 0.9 && Math.hypot(tx - ox, tz - oz) > r + 0.5) {
        const sg = side > 0 ? -1 : 1;
        tx = ox + uz * sg * (r + 1.6);
        tz = oz - ux * sg * (r + 1.6);
        break;
      }
    }
    let dx = tx - k.x,
      dz = tz - k.z,
      L = Math.hypot(dx, dz);
    // still stuck somewhere: ride off in a random direction for a moment
    if (Math.hypot(k.x - B.last[0], k.z - B.last[1]) < 0.05 && L > 1) B.stuck++;
    else B.stuck = Math.max(0, B.stuck - 1);
    B.last = [k.x, k.z];
    if (B.stuck > 5 && !B.wiggle) {
      B.wiggle = 8 + ((Math.random() * 8) | 0);
      B.wa = Math.random() * 6.283;
      B.stuck = 0;
    }
    if (B.wiggle) {
      B.wiggle--;
      dx = Math.cos(B.wa!);
      dz = Math.sin(B.wa!);
      L = 1;
    }
    G.input.x = L > 0.3 ? dx / L : 0;
    G.input.z = L > 0.3 ? dz / L : 0;
    while (B.outposts.length < G.outposts) B.outposts.push(Math.round(G.t));
    while (B.lands.length < G.land) B.lands.push(Math.round(G.t));
  };
}
// runs in the page: a minute of play, then the state
function minute() {
  const d = window.CastleDefender!._debug(),
    G = d.G;
  G.free = false;
  for (let s = 0; s < 600 && !G.over; s++) {
    window.__think!();
    d.advance(0.1, 1 / 30);
  }
  return {
    t: Math.round(G.t),
    over: G.over,
    coins: Math.round(G.coins),
    castle: Math.round((G.castle.hp / G.castle.max) * 100) + '%',
    enemies: G.enemies.length,
    kills: G.kills,
    weapon: G.tier + (G.extraDmg ? '+' + G.extraDmg : ''),
    troop: G.followers.reduce((s, f) => s + f.rank, 0),
    walls: G.towers
      .filter((t) => t.built && !t.outer)
      .map((t) => t.level)
      .join(''),
    outposts: G.towers
      .filter((t) => t.built && t.outer)
      .map((t) => t.level)
      .join(''),
    cannons: G.cannons
      .filter((c) => c.built)
      .map((c) => c.level)
      .join(''),
    reach: Math.round(G.reach),
    bosses: `${G.boss.slain}/${G.boss.came}`, // beaten / come
    land: G.land,
    shops: G.shops.map((s) => s.lv).join(''),
    camps: d
      .fronts()
      .filter((f) => f.open)
      .map((f) => f.id + ':' + f.tier.toFixed(1))
      .join(' '),
  };
}

const site = startSite();
const page = await openPage(site, { width: 640, height: 400, path: '/#castle-defender' });
let last: Awaited<ReturnType<typeof minute>> | null = null,
  outposts: number[] = [],
  lands: number[] = [];
try {
  await page.waitFor(() => !!window.CastleDefender?._debug().G, [], { timeout: 20_000 });
  await page.eval(bot, strategy);
  if (noLands) await page.eval(() => window.CastleDefender!._debug().lockLands());
  console.log(`Castle Defender, ${strategy} play${noLands ? ', lands shut' : ''}, up to ${minutes} minutes`);
  for (let m = 0; m < minutes; m++) {
    last = await page.eval(minute);
    console.log(JSON.stringify(last));
    if (last.over) break;
  }
  ({ outposts, lands } = await page.eval(() => window.__bot!));
  if (page.errors.length) {
    console.log('page errors:', page.errors);
    process.exitCode = 1;
  }
} finally {
  page.close();
  site.stop();
}
if (last) {
  const held = last.over
    ? `the castle fell after ${Math.floor(last.t / 60)}:${String(last.t % 60).padStart(2, '0')}`
    : `the castle still stands after ${minutes} minutes`;
  const at = (ts: number[]) => ts.map((t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`).join(', ');
  console.log(
    `\n${held}; ${outposts.length} outposts (at ${outposts.join(', ') || '-'} s), border ${last.reach} paces out`,
  );
  console.log(`lands opened: ${lands.length ? at(lands) : 'none'}; ${last.coins} coins left unspent`);
  if (check && ((last.over && last.t < 540) || outposts.length < 5)) {
    console.log('FAIL: expected the castle to hold 9 minutes with 5 outposts');
    process.exitCode = 1;
  }
}
