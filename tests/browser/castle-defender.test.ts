// Browser checks for Castle Defender's open world: the ground is made around the king wherever he goes and
// thrown away behind him, each biome shows where it should, the roads are painted, outposts push the border out
// and the enemy camps back, the king stays inside his land, and the game still runs.
// It plays the real page in Bun's headless browser. KEEP_SHOTS=1 keeps screenshots in .shots/.
//
// The checks run in order on one page per section, each going on from where the one before left the game.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { CastleDebug } from '../../public/js/castle-defender';
import { biomeAt, type Pt } from '../../public/js/castle-defender-world';
import { KEEP_SHOTS, openPage, startSite, wait, type Page } from '../support/browser';

setDefaultTimeout(120_000);
const site = startSite();
afterAll(() => site.stop());

type RGB = [number, number, number];
type Terrain = ReturnType<CastleDebug['terrain']>;
type Front = ReturnType<CastleDebug['fronts']>[number];
type Site = ReturnType<CastleDebug['sites']>[number];
// functions some checks put in the page for the ones after them
interface Helpers {
  __pushOut: () => boolean;
  __quiet: () => void;
}

/** Castle Defender in a page, once a game is up (storage: localStorage items in place before it loads) */
async function open({
  width = 1000,
  height = 600,
  mobile = false,
  storage,
}: { width?: number; height?: number; mobile?: boolean; storage?: Record<string, string> } = {}): Promise<Page> {
  const page = await openPage(site, { width, height, mobile, storage, path: '/#castle-defender' });
  await page.waitFor(() => !!window.CastleDefender?._debug().G, [], { timeout: 20_000 });
  // the ground away from the king is made a little each frame: give it the frames 300 ms would bring at 60 a second
  // (this browser draws WebGL in software, at a few frames a second)
  await wait(300);
  await frames(page, 18);
  return page;
}

/** Wait until the page has drawn n more frames */
const frames = (page: Page, n: number) =>
  page.eval(
    (n) =>
      new Promise<void>((done) => {
        const tick = () => (--n <= 0 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

/**
 * Run a function against the game's debug handle: dbg(page, (d, arg) => ..., arg). Like page.eval, the function
 * goes to the page as its source text, so it can only use `d`, its argument and the page's globals.
 */
function dbg<R>(page: Page, fn: (d: CastleDebug) => R): Promise<Awaited<R>>;
function dbg<A, R>(page: Page, fn: (d: CastleDebug, arg: A) => R, arg: A): Promise<Awaited<R>>;
function dbg(page: Page, fn: (d: CastleDebug, arg?: unknown) => unknown, arg?: unknown): Promise<unknown> {
  return page.view.evaluate(
    `(${fn.toString()})(window.CastleDefender._debug(), ${JSON.stringify(arg) ?? 'undefined'})`,
  );
}

const shot = async (page: Page, name: string) => {
  if (KEEP_SHOTS) await page.screenshot(`castle-${name}.png`, 'png');
};

/** The average colour of the middle of the screen, around the king */
async function groundColour(page: Page): Promise<RGB> {
  await wait(250);
  await frames(page, 2);
  // the page helper's screenshot is of the whole page: ask the browser for just this part
  const { data } = await page.view.cdp<{ data: string }>('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 300, y: 380, width: 140, height: 100, scale: 1 },
  });
  return page.eval(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0,
      gg = 0,
      b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]!;
      gg += d[i + 1]!;
      b += d[i + 2]!;
    }
    const n = d.length / 4;
    return [r / n, gg / n, b / n].map(Math.round) as RGB;
  }, data);
}

let page: Page;

describe('The world around the castle', () => {
  let t: Terrain;
  beforeAll(async () => {
    page = await open();
    t = await dbg(page, (d) => d.terrain());
  });

  test('ground chunks are made around the king at the start', () => {
    expect(t.chunks).toBeGreaterThanOrEqual(20);
    expect(t.chunks).toBeLessThanOrEqual(60);
  });
  test('the canyon wall is there', () => {
    expect(t.strips).toBeGreaterThanOrEqual(3);
  });
  test('the three first roads are painted', () => {
    expect(t.roads).toEqual(expect.arrayContaining(['road0', 'road1', 'road2']));
  });
  test('a chunk takes a few milliseconds to make', () => {
    expect(t.made).toBeGreaterThan(0);
    expect(t.ms / t.made).toBeLessThan(40);
  });
  test('sandy ground at the castle', async () => {
    const sand = await groundColour(page);
    await shot(page, 'home');
    expect(sand[0]).toBeGreaterThan(sand[2] + 40);
    expect(sand[0]).toBeGreaterThan(120);
  });
});

describe('Riding out: the biomes go on and on', () => {
  beforeAll(async () => {
    // the land past the border is veiled; look at the bare ground
    await dbg(page, (d) => {
      d.world.border.visible = false;
    });
  });

  const spots: [string, Pt, (c: RGB) => void][] = [
    [
      'Frozen Pass',
      [4, -110],
      (c) => {
        expect(c[2]).toBeGreaterThan(170);
        expect(Math.abs(c[0] - c[2])).toBeLessThan(50);
      },
    ],
    [
      'Ashlands',
      [100, -6],
      (c) => {
        expect(c[0]).toBeLessThan(110);
        expect(c[1]).toBeLessThan(100);
      },
    ],
    [
      'Mire',
      [80, 70],
      (c) => {
        expect(c[1]).toBeGreaterThan(c[0]);
        expect(c[1]).toBeGreaterThan(c[2]);
      },
    ],
    [
      'far Frozen Pass',
      [-150, -700],
      (c) => {
        expect(c[2]).toBeGreaterThan(170);
      },
    ],
    [
      'far Ashlands',
      [900, 60],
      (c) => {
        expect(c[0]).toBeLessThan(110);
        expect(c[1]).toBeLessThan(100);
      },
    ],
    [
      'far Mire',
      [300, 900],
      (c) => {
        expect(c[1]).toBeGreaterThan(c[0]);
        expect(c[1]).toBeGreaterThan(c[2]);
      },
    ],
  ];
  for (const [name, [x, z], looks] of spots)
    test(`${name} at (${x}, ${z}) looks like it (biome ${biomeAt(x, z)})`, async () => {
      await dbg(page, (d, [x, z]) => d.teleport(x, z), [x, z]);
      const c = await groundColour(page);
      await shot(page, name.replace(/ /g, '-').toLowerCase());
      looks(c);
    });

  test('chunks and wall strips far behind are thrown away', async () => {
    const t = await dbg(page, (d) => d.terrain());
    expect(t.chunks).toBeLessThanOrEqual(60);
    expect(t.strips).toBeLessThanOrEqual(12);
  });
  test('no chunk is kept far from the king', async () => {
    const far = await dbg(page, (d) => {
      let far = 0;
      const k = d.G.king;
      for (const ch of d.world.terrain.chunks.values())
        if (Math.hypot(ch.cx * 32 + 16 - k.x, ch.cz * 32 + 16 - k.z) > 160) far++;
      return far;
    });
    expect(far).toBe(0);
  });
  // the same place comes back the same
  test('a place looks the same when the king comes back to it', async () => {
    await dbg(page, (d) => d.teleport(4, -110));
    const again = await groundColour(page);
    await dbg(page, (d) => d.teleport(900, 60));
    await dbg(page, (d) => d.teleport(4, -110));
    const third = await groundColour(page);
    for (let i = 0; i < 3; i++) expect(Math.abs(again[i]! - third[i]!)).toBeLessThanOrEqual(2);
  });
});

describe('Riding along: chunks keep up', () => {
  test('riding 200 paces the ground is always made before the king gets there', async () => {
    await dbg(page, (d) => d.teleport(4, 2));
    const ride = await dbg(page, (d) => {
      const k = d.G.king;
      let missing = 0;
      d.G.free = true;
      for (let i = 0; i < 600; i++) {
        // 20 s of riding north-east at full speed, a frame at a time
        d.G.input.x = 0.7;
        d.G.input.z = -0.7;
        d.advance(1 / 30);
        // every chunk in sight of the king must be there
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++)
            if (!d.world.terrain.chunks.has(Math.floor(k.x / 32 + dx) + ',' + Math.floor(k.z / 32 + dz))) missing++;
      }
      d.G.input.x = d.G.input.z = 0;
      return { missing, x: k.x, z: k.z };
    });
    expect(ride.missing).toBe(0);
    expect(ride.x).toBeGreaterThan(100);
  });
});

describe('New roads', () => {
  beforeAll(async () => {
    page.close();
    page = await open();
  });

  test('at the start only the first roads are painted', async () => {
    const t = await dbg(page, (d) => d.terrain());
    expect(t.roads.filter((r) => r.startsWith('front-'))).toEqual([]);
  });
  test('the first cannon opens the north road', async () => {
    await dbg(page, (d) => {
      d.G.recruitIdx = 1;
      d.buy('tower0');
      d.buy('tower1');
      d.buy('tower2');
      d.buy('tower3');
      d.buy('cannon0');
    });
    const t = await dbg(page, (d) => d.terrain());
    expect(t.roads).toContain('front-N-0');
  });
  test('the north road is painted through the snow, darker than the snow beside it', async () => {
    await dbg(page, (d) => d.teleport(10, -78));
    await shot(page, 'frozen-road');
    // read the painted ground on the north road and beside it
    const road = await dbg(page, (d) => {
      const at = (x: number, z: number) => {
        const ch = d.world.terrain.chunks.get(Math.floor(x / 32) + ',' + Math.floor(z / 32))!;
        const p = ch.g.getImageData(Math.floor((x - ch.cx * 32) * 8), Math.floor((z - ch.cz * 32) * 8), 1, 1).data;
        return [p[0]!, p[1]!, p[2]!];
      };
      return { on: at(6, -82), off: at(13, -84) };
    });
    expect(road.on[2]).toBeGreaterThan(150);
    expect(road.off[2]).toBeGreaterThan(200);
    expect(road.off[0]! - road.on[0]!).toBeGreaterThan(25);
  });
});

describe('The border moves out', () => {
  let sites: Site[], east: Site, before: Front;
  let st: {
    claims: { x: number; z: number; r: number }[];
    fronts: Front[];
    roads: string[];
    ruins: number;
    posts: number[];
  };
  let E: Front;
  let after: [x: number, z: number, theme: number][];
  const far = (f: Front) => Math.hypot(f.x - 4, f.z);

  test('with two cannons up, outpost spots show where the roads cross the border', async () => {
    await dbg(page, (d) => {
      d.teleport(4, 2);
      d.G.free = false;
      d.buy('cannon1');
      d.advance(0.5);
    });
    sites = await dbg(page, (d) => {
      const vis = d.pads().map((p) => p.id);
      return d.sites().filter((s) => vis.includes(s.id));
    });
    expect(sites.length).toBeGreaterThanOrEqual(3);
    for (const s of sites) {
      expect(s.border).toBeLessThan(-3);
      expect(s.border).toBeGreaterThan(-16);
    }
  });
  test('building an outpost claims more land', async () => {
    east = sites.reduce((a, b) => (b.x > a.x ? b : a));
    before = (await dbg(page, (d) => d.fronts().find((f) => f.id === 'E')))!;
    await dbg(
      page,
      (d, id) => {
        d.teleport(30, 2);
        d.G.free = false;
        d.buy(id);
        d.G.enemies.length = 0;
        d.G.spawnQueue.length = 0;
        d.advance(2);
      },
      east.id,
    );
    await shot(page, 'outpost');
    st = await dbg(page, (d) => ({
      claims: d.claims(),
      fronts: d.fronts(),
      roads: d.terrain().roads,
      ruins: d.G.ruins.length,
      posts: d.G.posts.map((p) => d.borderDist(p.x, p.z)),
    }));
    E = st.fronts.find((f) => f.id === 'E')!;
    expect(st.claims).toHaveLength(2);
  });
  test('the east camp the border reached is cleared and the enemy falls back further out, tougher', () => {
    expect(far(E)).toBeGreaterThanOrEqual(far(before) + 18);
    expect(E.tier).toBeGreaterThan(0);
    expect(st.ruins).toBeGreaterThanOrEqual(1);
  });
  test('a new road runs from the new camp to the old one, and the south road opens', () => {
    expect(st.roads).toContain('front-E-0');
    expect(st.roads).toContain('front-S-0');
  });
  test('flags stand along the border', () => {
    expect(st.posts.length).toBeGreaterThan(10);
    expect(st.posts.filter((v) => Math.abs(v) >= 0.6)).toEqual([]);
  });
  test('the cleared camp sends no one any more', async () => {
    after = await dbg(page, (d) => {
      d.advance(12);
      return d.G.enemies.map((e): [number, number, number] => [
        Math.round(e.route[0]![0]),
        Math.round(e.route[0]![1]),
        e.theme,
      ]);
    });
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter(([x, z]) => x === 56 && z === -2)).toEqual([]);
  });
  test("the new camp sends its own enemies, in its biome's colours", () => {
    expect(after.some(([x, z, th]) => Math.hypot(x - E.x, z - E.z) < 1.5 && th === E.theme)).toBe(true);
  });
  test('the outpost is a new center: a camp rises past the border beside it, its road runs past the outpost', async () => {
    const c = await dbg(
      page,
      (d, id) => {
        const f = d.G.fronts.find((f) => f.id === 'o' + id.slice('outpost'.length))!,
          t = d.G.towers.find((t) => 'outpost' + t.idx === id)!;
        const near = (x: number, z: number) =>
          Math.min(...f.road.map(([rx, rz], i) => (i ? Math.hypot(rx - x, rz - z) : 1e9)));
        return {
          open: f?.open,
          border: d.borderDist(f.camp.x, f.camp.z),
          fromOutpost: Math.hypot(f.camp.x - t.x, f.camp.z - t.z),
          pastOutpost: near(t.x, t.z),
          end: f.road[f.road.length - 1],
          roads: d.terrain().roads,
          sent: d.G.enemies.filter((e) => e.route === f.road).length,
        };
      },
      east.id,
    );
    expect(c.open).toBe(true);
    expect(c.border).toBeGreaterThan(12);
    expect(c.fromOutpost).toBeLessThan(90);
    expect(c.pastOutpost).toBeLessThan(6);
    expect(c.end).toEqual([-5.5, -4.5]);
    expect(c.roads).toContain('front-o' + east.id.slice('outpost'.length) + '-0');
    expect(c.sent).toBeGreaterThan(0);
  });
  test('the next outpost spot on the east road is out at the new border', async () => {
    sites = await dbg(page, (d) => d.sites());
    expect(sites.some((s) => s.x > east.x + 20 && s.border < -3)).toBe(true);
  });

  // keep pushing east: each outpost on the east road clears its camp, the next one is further out and its enemies stronger
  let push: { out: { x: number; z: number; tier: number; theme: number }[]; eastHp: number; neHp: number };
  test('pushing east, every outpost clears the camp, and it falls back further into the Ashlands', async () => {
    push = await dbg(page, (d) => {
      const out: { x: number; z: number; tier: number; theme: number }[] = [];
      for (let n = 0; n < 4; n++) {
        // the east road's spot (an outpost's own camp may have a road further east)
        const road = d.G.fronts.find((o) => o.id === 'E')!.road;
        const pad = d
          .sites()
          .filter((s) => d.G.towers.some((t) => t.outer && 'outpost' + t.idx === s.id && t.site?.road === road))
          .reduce((a, b) => (b.x > a.x ? b : a));
        d.buy(pad.id);
        d.advance(1);
        const f = d.fronts().find((o) => o.id === 'E')!;
        out.push({ x: Math.round(f.x), z: Math.round(f.z), tier: +f.tier.toFixed(2), theme: f.theme });
      }
      d.G.enemies.length = 0;
      d.G.spawnQueue.length = 0;
      const hp = (sx: number, sz: number) =>
        Math.max(
          0,
          ...d.G.enemies
            .filter((e) => e.kind === 'knight' && Math.hypot(e.route[0]![0] - sx, e.route[0]![1] - sz) < 1.5)
            .map((e) => e.max),
        );
      const last = out[out.length - 1]!,
        ne = d.fronts().find((o) => o.id === 'NE')!;
      // waves are random: give both camps time to send a knight (10 s nearly always does)
      for (let t = 0; t < 40 && !(t >= 10 && hp(last.x, last.z) && hp(ne.x, ne.z)); t += 5) d.advance(5);
      return { out, eastHp: hp(last.x, last.z), neHp: hp(ne.x, ne.z) };
    });
    for (let i = 1; i < push.out.length; i++)
      expect(Math.hypot(push.out[i]!.x - 4, push.out[i]!.z)).toBeGreaterThan(
        Math.hypot(push.out[i - 1]!.x - 4, push.out[i - 1]!.z),
      );
    expect(push.out.map((c) => c.theme)).toEqual(push.out.map(() => 3));
  });
  test('enemies from the far camp are much stronger than from a camp near home', () => {
    expect(push.neHp).toBeGreaterThan(0);
    expect(push.eastHp).toBeGreaterThan(push.neHp * 2);
  });

  test('the king can ride anywhere in his land but not past the border', async () => {
    await dbg(page, (d) => d.teleport(d.G.fronts[0]!.camp.x - 30, d.G.fronts[0]!.camp.z));
    await shot(page, 'far-east');
    const inside = await dbg(page, (d) => {
      d.teleport(4, 2);
      d.G.free = false;
      let worst = -1e9;
      for (const [ix, iz] of [
        [1, 0.1],
        [0.3, 1],
        [-1, -0.7],
        [0.2, -1],
      ] as const)
        for (let i = 0; i < 240; i++) {
          d.G.input.x = ix;
          d.G.input.z = iz;
          d.advance(1 / 30);
          worst = Math.max(worst, d.borderDist(d.G.king.x, d.G.king.z));
        }
      d.G.input.x = d.G.input.z = 0;
      return worst;
    });
    expect(inside).toBeLessThanOrEqual(-1.1);
  });
  test('a new game starts with the home land, the first camps and only the first roads', async () => {
    await page.eval(() => document.getElementById('cd-pause-btn')!.click());
    await page.eval(() => document.getElementById('cd-restart')!.click());
    const now = await dbg(page, (d) => ({
      claims: d.claims().length,
      roads: d.terrain().roads,
      fronts: d.fronts().map((f) => [f.id, f.open, f.x, f.z] as const),
      ruins: d.G.ruins.length,
      sites: d.pads().filter((p) => p.id.startsWith('outpost')).length,
    }));
    expect(now.claims).toBe(1);
    expect(now.roads.filter((r) => r.startsWith('front-'))).toEqual([]);
    expect(now.ruins).toBe(0);
    expect(now.fronts[0]![2]).toBe(56);
    expect(now.fronts[3]![1]).toBeFalsy();
  });
});

describe('Playing', () => {
  test('45 seconds of play: enemies march and fall', async () => {
    const play = await dbg(page, (d) => {
      d.teleport(4, 2);
      d.G.free = false;
      d.advance(45);
      return { t: Math.round(d.G.t), enemies: d.G.enemies.length, kills: d.G.kills, over: d.G.over };
    });
    expect(play.t).toBeGreaterThanOrEqual(44);
    expect(play.over).toBe(false);
    expect(play.enemies + play.kills).toBeGreaterThan(10);
  });
  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
});

describe('The first land past the border: shops', () => {
  type Shop = ReturnType<CastleDebug['shops']>[number];
  let shops: Shop[], first: Shop;
  beforeAll(async () => {
    page = await open();
    await dbg(page, helpers);
  });
  afterAll(() => page.close());
  // helpers in the page, for the checks below: build the outpost spot furthest out (if there is one), and clear the
  // field of enemies for good, so nothing gets in the way
  const helpers = (d: CastleDebug) => {
    const w = window as unknown as Helpers;
    w.__pushOut = () => {
      const vis = d.pads().map((p) => p.id);
      const spots = d.sites().filter((s) => vis.includes(s.id));
      if (!spots.length) return false;
      d.buy(spots.reduce((a, b) => (Math.hypot(b.x - 4, b.z) > Math.hypot(a.x - 4, a.z) ? b : a)).id);
      d.advance(0.5);
      return true;
    };
    w.__quiet = () => {
      d.G.enemies.length = 0;
      d.G.spawnQueue.length = 0;
      d.G.spawnT = 1e9;
      for (const f of d.G.fronts) f.timer = 1e9;
    };
  };
  test('no lots for sale while the border is near home', async () => {
    const got = await dbg(page, (d) => {
      d.rich(1e6);
      for (let i = 0; i < 4; i++) d.buy('recruit');
      for (let i = 0; i < 6; i++) d.buy('tower' + i);
      d.buy('cannon0');
      d.buy('cannon1');
      d.advance(0.5);
      (window as unknown as Helpers).__pushOut();
      return { reach: d.G.reach, outposts: d.G.outposts, land: d.G.land, shops: d.shops().length };
    });
    expect(got.outposts).toBe(1);
    expect(got.reach).toBeLessThan(75);
    expect([got.land, got.shops]).toEqual([0, 0]);
  });

  test('pushing the border past 75 paces opens the market roads, with a lot for sale by the outposts', async () => {
    const got = await dbg(page, (d) => {
      for (let n = 0; n < 8 && d.G.reach < 75; n++) (window as unknown as Helpers).__pushOut();
      const toast = document.getElementById('cd-toast')!.textContent ?? '';
      return {
        reach: d.G.reach,
        land: d.G.land,
        outposts: d.G.outposts,
        news: [toast, ...d.G.toastQ].some((m) => m.includes('New land: The market roads')),
        shops: d.shops(),
        pads: d.pads(),
        border: d.shops().map((s) => d.borderDist(s.x, s.z)),
      };
    });
    expect(got.reach).toBeGreaterThanOrEqual(75);
    expect(got.land).toBe(1);
    expect(got.news).toBe(true);
    shops = got.shops;
    expect(shops.length).toBeGreaterThanOrEqual(got.outposts - 1);
    expect(shops.length).toBeLessThanOrEqual(got.outposts);
    for (const [i, s] of shops.entries()) {
      expect(s.lv).toBe(0);
      expect(got.border[i]).toBeLessThan(-5);
      const pad = got.pads.find((p) => p.id === s.id)!;
      expect([pad.x, pad.z]).toEqual([s.x, s.z]);
      expect(pad.cost).toBe(s.lot);
      for (const o of shops) if (o !== s) expect(Math.hypot(o.x - s.x, o.z - s.z)).toBeGreaterThanOrEqual(11);
    }
    // the first lot is the cheapest, and each costs more than the one before
    expect(shops.map((s) => s.lot)).toEqual(shops.map((s) => s.lot).sort((a, b) => a - b));
  });

  test('no lot is on a road', async () => {
    const near = await dbg(page, (d) =>
      d.shops().map((s) =>
        Math.min(
          ...d.G.fronts
            .filter((f) => f.open)
            .map((f) => {
              let m = 1e9;
              for (let i = 0; i < f.road.length - 1; i++) {
                const [ax, az] = f.road[i]!,
                  [bx, bz] = f.road[i + 1]!,
                  L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1,
                  t = Math.max(0, Math.min(1, ((s.x - ax) * (bx - ax) + (s.z - az) * (bz - az)) / L2));
                m = Math.min(m, Math.hypot(s.x - ax - (bx - ax) * t, s.z - az - (bz - az) * t));
              }
              return m;
            }),
        ),
      ),
    );
    for (const d of near) expect(d).toBeGreaterThanOrEqual(5.2);
  });

  test('buying a lot opens a shop of its biome, which fills its till up to what it holds', async () => {
    first = shops[0]!;
    const got = await dbg(
      page,
      (d, id) => {
        (window as unknown as Helpers).__quiet();
        d.buy(id);
        d.teleport(4, 2);
        d.G.free = false;
        d.advance(20);
        const s20 = d.shops().find((s) => s.id === id)!;
        d.advance(100);
        const s120 = d.shops().find((s) => s.id === id)!;
        return { s20, s120, built: d.G.buildings.some((b) => b.fn.name.startsWith('shopGeo') && b.lv === 1) };
      },
      first.id,
    );
    expect(got.built).toBe(true);
    expect(got.s20.lv).toBe(1);
    expect(got.s20.kind).toBe(biomeAt(first.x, first.z));
    // about 20 seconds' takings, and then full
    expect(got.s20.till.value).toBeGreaterThan((got.s20.till.cap * 18) / 75);
    expect(got.s20.till.value).toBeLessThan((got.s20.till.cap * 22) / 75);
    expect(got.s120.till.value).toBe(got.s120.till.cap);
    await shot(page, 'shop-till-full');
  });

  test('riding over the till takes its coins', async () => {
    const got = await dbg(
      page,
      (d, id) => {
        const s = d.shops().find((o) => o.id === id)!,
          coins = d.G.coins;
        d.teleport(s.till.x, s.till.z);
        d.G.free = false;
        d.advance(2);
        return { gained: d.G.coins - coins, had: s.till.value, left: d.shops().find((o) => o.id === id)!.till.value };
      },
      first.id,
    );
    expect(got.gained).toBeGreaterThanOrEqual(got.had);
    expect(got.left).toBeLessThan(got.had * 0.05);
  });

  test('each level makes it earn more, and it grows', async () => {
    const got = await dbg(
      page,
      (d, id) => {
        const rate = () => {
          const s = d.shops().find((o) => o.id === id)!;
          return s.till.cap / 75;
        };
        const rates = [rate()],
          heights = [d.G.buildings.find((b) => b.fn.name.startsWith('shopGeo'))!.h];
        for (let lv = 2; lv <= 5; lv++) {
          d.buy(id);
          d.advance(1.5);
          rates.push(rate());
          heights.push(d.G.buildings.find((b) => b.fn.name.startsWith('shopGeo'))!.h);
        }
        return { rates, heights, lv: d.shops().find((o) => o.id === id)!.lv, pad: d.pads().some((p) => p.id === id) };
      },
      first.id,
    );
    expect(got.lv).toBe(5);
    for (let i = 1; i < got.rates.length; i++) expect(got.rates[i]!).toBeGreaterThan(got.rates[i - 1]! * 2);
    expect(got.heights[4]).toBeGreaterThan(got.heights[0]!);
    expect(got.pad).toBe(false); // nothing left to buy there
    await shot(page, 'shop-top-level');
  });

  test('an outpost built later brings a lot of its own', async () => {
    const got = await dbg(page, (d) => {
      const before = d.shops().length,
        outposts = d.G.outposts;
      for (let n = 0; n < 3; n++) (window as unknown as Helpers).__pushOut();
      return { lots: d.shops().length - before, outposts: d.G.outposts - outposts };
    });
    expect(got.outposts).toBeGreaterThan(0);
    expect(got.lots).toBeGreaterThan(0);
  });

  test('the land and the shops are saved, and a reload brings them back', async () => {
    await dbg(page, (d) => {
      const lot = d.shops().find((s) => s.lv === 0)!;
      d.buy(lot.id);
      d.advance(10);
      d.G.pads.find((p) => p.id === d.shops().find((s) => s.lv === 0)?.id)!.paid = 9;
    });
    await page.click('#cd-pause-btn');
    const before = await everything(page);
    expect(before.shops.filter((s) => s[5]).length).toBe(2);
    await dbg(page, (d) => d.save());
    await page.reload();
    await reopened(page);
    const after = await everything(page);
    // (a spot for an outpost stays where it was while the border moves a little near it, and is worked out afresh
    // from the border after a reload: it may come back up to 3 paces away, the same as a spot moving along)
    const spots = (o: typeof before) => ({
      towers: o.towers.filter((t) => !t.includes('true,false,0,-1]')),
      pads: o.pads.filter((p) => !p.startsWith('["spot"')),
      at: o.pads.filter((p) => p.startsWith('["spot"')).map((p) => JSON.parse(p) as [string, number, number, number]),
    });
    const [b, a] = [spots(before), spots(after)];
    expect(a.towers).toEqual(b.towers);
    expect(a.pads).toEqual(b.pads);
    expect(a.at.length).toBe(b.at.length);
    for (const [, x, z, cost] of b.at)
      expect(a.at.some(([, x2, z2, c2]) => c2 === cost && Math.hypot(x2 - x, z2 - z) < 3)).toBe(true);
    const clear = (o: typeof before) => o.clear.map((c) => JSON.parse(c) as { x: number; z: number; r: number });
    expect(clear(after).length).toBe(clear(before).length);
    for (const c of clear(before))
      expect(clear(after).some((o) => o.r === c.r && Math.hypot(o.x - c.x, o.z - c.z) < 3)).toBe(true);
    for (const key of Object.keys(before) as (keyof typeof before)[])
      if (key !== 'towers' && key !== 'pads' && key !== 'clear') expect(after[key], key).toEqual(before[key]);
    await shot(page, 'shops-after-reload');
  });

  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
});

describe('A phone held upright', () => {
  beforeAll(async () => {
    page.close();
    page = await open({ width: 390, height: 844, mobile: true });
  });
  afterAll(() => page.close());

  test('the ground reaches every corner of a tall screen', async () => {
    const corners = await dbg(page, (d) => {
      // every corner of the screen looks at ground that exists
      const { THREE, camera } = d,
        ray = new THREE.Raycaster(),
        miss: number[][] = [];
      for (const [x, y] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
        [0, 1],
      ] as const) {
        ray.setFromCamera(new THREE.Vector2(x, y), camera);
        const t = -ray.ray.origin.y / ray.ray.direction.y,
          gx = ray.ray.origin.x + ray.ray.direction.x * t,
          gz = ray.ray.origin.z + ray.ray.direction.z * t;
        if (!d.world.terrain.chunks.has(Math.floor(gx / 32) + ',' + Math.floor(gz / 32)))
          miss.push([x, y, Math.round(gx), Math.round(gz)]);
      }
      return miss;
    });
    await shot(page, 'phone');
    expect(corners).toEqual([]);
  });
  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
});

/**
 * Let the castle fall at game time t: the first enemy on its way is put at the castle with a blow that ends it.
 * With leave, the player goes back to the menu straight away, before the game-over panel's delay is over.
 */
const fall = (page: Page, t: number, leave = false) =>
  dbg(
    page,
    (d, [t, leave]) => {
      const G = d.G;
      for (let i = 0; i < 60 && !G.enemies.length; i++) d.advance(1);
      Object.assign(G.enemies[0]!, { state: 'castle', atk: 0, dmg: 1e9 });
      G.t = t;
      d.advance(1 / 30);
      if (leave) window.GameHub.menu();
      return G.over;
    },
    [t, leave] as const,
  );
const overPanel = (page: Page) => page.until(() => !document.getElementById('cd-over')!.hidden, [], 5000);
const overText = (page: Page) => page.eval(() => document.getElementById('cd-over-text')!.textContent);
const savedBest = (page: Page) => page.eval(() => localStorage.getItem('castle.bestTime'));
const drawn = (page: Page) => dbg(page, (d) => d.renderer.info.render.frame);
const comeBack = async (page: Page) => {
  await page.eval(() => (location.hash = '#castle-defender'));
  expect(await page.until(() => !document.getElementById('cd-app')!.hidden)).toBe(true);
};

describe('The longest time held', () => {
  beforeAll(async () => {
    page = await open({ storage: { 'castle.bestTime': '123' } });
  });

  test('a shorter game says how long the longest was, and keeps it', async () => {
    expect(await fall(page, 30)).toBe(true);
    expect(await overPanel(page)).toBe(true);
    expect(await overText(page)).toBe('You held out for 0:30. Your longest is 2:03.');
    expect(await savedBest(page)).toBe('123');
  });
  test('a longer game is the new longest, saved in whole seconds', async () => {
    await page.eval(() => document.getElementById('cd-retry')!.click());
    expect(await fall(page, 200.6)).toBe(true);
    expect(await overPanel(page)).toBe(true);
    expect(await overText(page)).toBe('You held out for 3:20, your longest yet.');
    expect(await savedBest(page)).toBe('200');
  });
});

describe('Leaving and coming back', () => {
  afterAll(() => page.close());

  test('leaving pauses the game under the pause panel and stops drawing it', async () => {
    await page.eval(() => document.getElementById('cd-retry')!.click());
    await frames(page, 2);
    await page.eval(() => window.GameHub.menu());
    expect(
      await page.until(
        () => window.CastleDefender!._debug().G.paused && !document.getElementById('cd-pausemenu')!.hidden,
      ),
    ).toBe(true);
    const away = await drawn(page);
    await wait(400);
    expect(await drawn(page)).toBe(away);
  });
  test('coming back finds it paused under the pause panel, drawn again, and it plays on', async () => {
    const away = await drawn(page);
    await comeBack(page);
    expect(await page.until((n) => window.CastleDefender!._debug().renderer.info.render.frame > n, [away])).toBe(true);
    expect(await dbg(page, (d) => d.G.paused)).toBe(true);
    expect(await page.visible('cd-pausemenu')).toBe(true);
    await page.click('#cd-resume');
    expect(await dbg(page, (d) => d.G.paused)).toBe(false);
    expect(await page.visible('cd-pausemenu')).toBe(false);
  });
  test('leaving just after the castle falls, the game-over panel is up on coming back', async () => {
    expect(await fall(page, 30, true)).toBe(true);
    expect(await page.visible('cd-app')).toBe(false);
    await comeBack(page);
    expect(await overPanel(page)).toBe(true);
    expect(await page.visible('cd-over')).toBe(true);
    expect(await page.visible('cd-pausemenu')).toBe(false);
  });
  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
});

describe('Junk where the longest time is saved', () => {
  test('counts as no longest time, and the new one is saved over it', async () => {
    const junk = await open({ storage: { 'castle.bestTime': 'two minutes' } });
    expect(await fall(junk, 30)).toBe(true);
    expect(await overPanel(junk)).toBe(true);
    expect(await overText(junk)).toBe('You held out for 0:30, your longest yet.');
    expect(await savedBest(junk)).toBe('30');
    expect(junk.errors).toEqual([]);
    junk.close();
  });
});

/**
 * Everything the saved game has to bring back, as it is in the page: the game paused, so nothing moves while it is
 * read. Coins on their way to the king count as his, coins paid into a spot for an outpost as his too (they go back to
 * him), and recruits running over to join someone as part of that someone; spots for outposts are known by where they
 * are (they get new ids).
 */
const everything = (page: Page) =>
  dbg(page, (d) => {
    const G = d.G;
    const sort = <T>(a: T[]) => a.map((x) => JSON.stringify(x)).sort();
    const spots = G.towers.filter((t) => t.outer && !t.built);
    return {
      t: G.t,
      kills: G.kills,
      wealth: Math.round(
        G.coins +
          G.flying.reduce((n, f) => n + (f.to === 'king' ? f.v : 0), 0) +
          spots.reduce((n, t) => n + (t.pad ? t.pad.paid : 0), 0),
      ),
      king: [G.king.x, G.king.z, G.king.yaw],
      castle: [G.castle.hp, G.castle.max],
      troop: G.followers.map((f) => [f.x, f.z, f.rank + G.joiners.filter((j) => j.target === f).length]),
      levels: [G.recruitIdx, G.barracksLv, G.tier, G.extraDmg, !!G.forge, G.outposts, G.fieldCannons],
      buildings: sort(G.buildings.map((b) => [b.x, b.z, b.lv, b.fn.name, b.h])),
      towers: sort(G.towers.map((t) => [t.x, t.z, t.up, t.outer, t.built, t.level, t.built && t.outer ? t.idx : -1])),
      cannons: G.cannons.map((c) => [c.x, c.z, c.side, c.field ?? false, c.built, c.level, c.cost0, c.yaw]),
      gold: [G.gold.built, G.gold.lv, G.outpostBoys, sort(G.gold.boys.map((b) => [b.x, b.z, b.load, b.home]))],
      walls: G.segs.map((s) => [s.hp, s.alive, s.tier, s.max]),
      wallsUp: G.wallsUp,
      claims: d.claims(),
      reach: G.reach,
      fronts: G.fronts.map((f) => [
        f.id,
        f.road,
        f.segs,
        f.open,
        f.openAt,
        f.shared,
        f.timer,
        f.restAt,
        f.camp.x,
        f.camp.z,
        f.camp.theme,
        f.camp.state,
        f.camp.group.visible,
      ]),
      ruins: G.ruins.map((c) => [c.x, c.z, c.theme, c.state]),
      pads: sort(
        G.pads
          .filter((p) => p.visibleNow)
          .map((p) =>
            p.site && !p.site.built ? ['spot', p.x, p.z, p.cost] : [p.id, p.x, p.z, p.cost, Math.floor(p.paid)],
          ),
      ),
      drawn: G.pads.filter((p) => p.visibleNow).every((p) => p.key !== ''),
      clear: sort(G.clear),
      roads: d.terrain().roads.slice().sort(),
      posts: G.posts.length,
      obstacles: G.obs,
      spawn: [G.spawnT, G.nextPath, G.spawnQueue.map((q) => [q.f.id, q.kind, q.t])],
      enemies: G.enemies
        .filter((e) => e.hp > 0)
        .map((e) => [
          e.kind,
          e.mkey,
          e.x,
          e.z,
          e.hp,
          e.max,
          e.speed,
          e.dmg,
          e.value,
          e.state,
          e.wp,
          e.route,
          e.seg ? G.segs.indexOf(e.seg) : -1,
        ]),
      ground: G.coinsOnGround.map((c) => [c.x, c.z, c.v]),
      land: [G.land, G.lotSeq],
      shops: G.shops.map((s) => [s.idx, s.x, s.z, s.yaw, s.kind, s.lv, s.lot, Math.round(s.till.value)]),
    };
  });
const WORLD = 'castle.world.v1';
const savedWorld = (page: Page) => page.eval((k) => localStorage.getItem(k), WORLD);
/** After a reload: wait for the game to be up again */
const reopened = async (page: Page) => {
  await page.waitFor(() => !!window.CastleDefender?._debug().G, [], { timeout: 20_000 });
  await frames(page, 2);
};

describe('The game is saved, and a reload carries on with it', () => {
  let before: Awaited<ReturnType<typeof everything>>;
  beforeAll(async () => {
    page = await open();
  });
  afterAll(() => page.close());

  test('a game well under way: walls, forge, cannons, an outpost, the gold hut, enemies and coins', async () => {
    const got = await dbg(page, (d) => {
      const G = d.G;
      d.rich(1e6);
      for (let i = 0; i < 4; i++) d.buy('recruit');
      for (let i = 0; i < 6; i++) d.buy('tower' + i);
      d.buy('tower0');
      d.buy('tower0');
      d.buy('tower1');
      d.buy('forgebuild');
      for (let i = 0; i < 3; i++) d.buy('forge');
      d.buy('cannon0');
      d.buy('cannon1');
      d.buy('cannon0');
      d.advance(0.5);
      const vis = d.pads().map((p) => p.id);
      const east = d
        .sites()
        .filter((s) => vis.includes(s.id))
        .reduce((a, b) => (b.x > a.x ? b : a));
      d.buy(east.id);
      d.advance(0.5);
      const field = G.cannons.findIndex((c) => c.field);
      if (field >= 0) d.buy('cannon' + field);
      d.buy('gold');
      d.buy('gold');
      d.buy('goldboy' + east.id.slice('outpost'.length));
      d.teleport(4, 2);
      G.free = false;
      G.coins = 321;
      d.advance(60);
      // a stretch of wall knocked about, and coins paid into a pad (and into a spot for an outpost)
      const wall = G.segs.find((s) => s.alive && !s.gate)!;
      wall.hp = Math.round(wall.max / 3);
      for (const p of G.pads.filter((p) => p.visibleNow && p.cost > 20)) p.paid = 7;
      return {
        enemies: G.enemies.length,
        outposts: G.outposts,
        outpostBoys: G.gold.boys.filter((b) => b.home !== 'home').length,
        field,
        ruins: G.ruins.length,
        ground: G.coinsOnGround.length,
        spots: G.towers.filter((t) => t.outer && !t.built).length,
      };
    });
    expect(got.outposts).toBe(1);
    expect(got.outpostBoys).toBe(1);
    expect(got.field).toBeGreaterThanOrEqual(3);
    expect(got.ruins).toBeGreaterThanOrEqual(1);
    expect(got.enemies).toBeGreaterThan(0);
    expect(got.spots).toBeGreaterThan(0);
  });

  test('it is saved every few seconds while it runs', async () => {
    expect(await page.until((k) => (JSON.parse(localStorage.getItem(k) ?? '{}').t ?? 0) > 60, [WORLD], 8000)).toBe(
      true,
    );
    const saved = JSON.parse((await savedWorld(page))!);
    expect(saved.outposts).toHaveLength(1);
    expect(saved.t).toBeGreaterThan(60);
  });

  test('a reload (the page saves as it goes) comes back to it as it was, paused under the pause panel', async () => {
    await page.click('#cd-pause-btn');
    expect(await dbg(page, (d) => d.G.paused)).toBe(true);
    before = await everything(page);
    await shot(page, 'before-reload');
    await page.reload();
    await reopened(page);
    expect(await dbg(page, (d) => d.G.paused)).toBe(true);
    expect(await page.visible('cd-pausemenu')).toBe(true);
    expect(await page.visible('cd-over')).toBe(false);
    const after = await everything(page);
    for (const key of Object.keys(before) as (keyof typeof before)[]) expect(after[key], key).toEqual(before[key]);
    await shot(page, 'after-reload');
  });

  test('Keep playing carries on: the enemies march, the towers shoot, coins come in', async () => {
    await page.click('#cd-resume');
    expect(await dbg(page, (d) => d.G.paused)).toBe(false);
    const played = await dbg(page, (d) => {
      const G = d.G,
        kills = G.kills,
        t = G.t;
      d.advance(30);
      return { kills: G.kills - kills, t: G.t - t, over: G.over };
    });
    expect(played.kills).toBeGreaterThan(0);
    expect(played.t).toBeGreaterThan(29);
    expect(played.over).toBe(false);
  });

  test('Restart starts a new game, and saves it over the old one', async () => {
    await page.click('#cd-pause-btn');
    await page.click('#cd-restart');
    expect(await dbg(page, (d) => [d.G.t < 1, d.G.outposts, d.G.paused])).toEqual([true, 0, false]);
    const saved = JSON.parse((await savedWorld(page))!);
    expect(saved.t).toBeLessThan(1);
    expect(saved.outposts).toEqual([]);
  });

  test('when the castle falls the save goes, and a reload starts a new game', async () => {
    expect(await fall(page, 50)).toBe(true);
    expect(await page.until((k) => localStorage.getItem(k) === null, [WORLD])).toBe(true);
    await page.reload();
    await reopened(page);
    expect(await dbg(page, (d) => [d.G.t < 2, d.G.over, d.G.paused])).toEqual([true, false, false]);
    expect(await page.visible('cd-pausemenu')).toBe(false);
  });

  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
});

describe('A saved game the game cannot carry on from', () => {
  test('starts a new game, and keeps the longest time held', async () => {
    const good = await open();
    await dbg(good, (d) => {
      d.advance(20);
      d.save();
    });
    const saved = JSON.parse((await savedWorld(good))!);
    good.close();
    const broken: [why: string, saved: string][] = [
      ['not JSON', JSON.stringify(saved).slice(0, -1)],
      ['another kind of save', JSON.stringify({ t: 30, coins: 5 })],
      ['a front missing', JSON.stringify({ ...saved, fronts: saved.fronts.slice(1) })],
      [
        'an enemy on a road there is none of',
        JSON.stringify({ ...saved, enemies: [{ ...saved.enemies[0], route: 99 }] }),
      ],
      ['a castle already fallen', JSON.stringify({ ...saved, castle: 0 })],
      [
        'a camp for an outpost there is none of',
        JSON.stringify({ ...saved, fronts: [...saved.fronts, { ...saved.fronts[0], id: 'o7' }] }),
      ],
      ['a wall tower at a level there is none of', JSON.stringify({ ...saved, towers: [9, 0, 0, 0, 0, 0] })],
      [
        'a shop at a level there is none of',
        JSON.stringify({
          ...saved,
          lotSeq: 1,
          shops: [{ idx: 0, at: [30, 3], yaw: 0, kind: 0, lv: 9, lot: 3000, till: 0 }],
        }),
      ],
    ];
    expect(saved.enemies.length).toBeGreaterThan(0);
    for (const [why, junk] of broken) {
      const page = await open({ storage: { [WORLD]: junk, 'castle.bestTime': '123' } });
      expect(await dbg(page, (d) => [d.G.t < 2, d.G.paused]), why).toEqual([true, false]);
      expect(await page.visible('cd-pausemenu'), why).toBe(false);
      expect(await savedBest(page)).toBe('123');
      expect(page.errors, why).toEqual([]);
      page.close();
    }
    // and the good one carries on, as does one saved before there were lands and shops
    const { land: _land, lotSeq: _lotSeq, shops: _shops, ...older } = saved;
    for (const ok of [saved, older]) {
      const back = await open({ storage: { [WORLD]: JSON.stringify(ok) } });
      expect(await dbg(back, (d) => [Math.round(d.G.t), d.G.paused, d.G.land])).toEqual([Math.round(saved.t), true, 0]);
      expect(back.errors).toEqual([]);
      back.close();
    }
  });
});

/** The boss panel at the top of the screen, as it reads */
const bossPanel = (page: Page) =>
  page.eval(() => {
    const el = document.getElementById('cd-boss')!;
    return {
      shown: !el.hidden,
      warn: el.classList.contains('warn'),
      name: document.getElementById('cd-boss-name')!.textContent,
      when: document.getElementById('cd-boss-when')!.textContent,
      health: document.getElementById('cd-boss-fill')!.style.width,
    };
  });

describe('Bosses', () => {
  beforeAll(async () => {
    page = await open();
  });
  afterAll(() => page.close());

  test('the first boss is due 3 minutes in, and nothing shows before its warning', async () => {
    const s = await dbg(page, (d) => {
      d.advance(10);
      return [d.BOSS_EVERY, d.G.boss.next, d.G.boss.front, !!d.boss()];
    });
    expect(s).toEqual([180, 180, null, false]);
    await frames(page, 2);
    expect((await bossPanel(page)).shown).toBe(false);
  });

  let front = '';
  test('a warning goes up before it comes: which boss, the camp it comes from and the time left', async () => {
    const w = await dbg(page, (d) => {
      const G = d.G;
      G.boss.next = G.t + d.BOSS_WARN + 1;
      d.advance(1.5);
      const f = G.fronts.find((f) => f.id === G.boss.front);
      return { front: G.boss.front, open: f?.open, boss: !!d.boss() };
    });
    expect(w.front).not.toBeNull();
    expect(w.open).toBe(true);
    expect(w.boss).toBe(false);
    front = w.front!;
    await frames(page, 2);
    const panel = await bossPanel(page);
    expect(panel.shown).toBe(true);
    expect(panel.warn).toBe(true);
    expect(panel.name).toMatch(/^The [A-Z][a-z]+ [A-Z][a-z]+ is coming$/);
    expect(panel.when).toMatch(/^from the [A-Za-z ]+ in 0:(19|20)$/);
    await shot(page, 'boss-warning');
  });

  test('then it marches from that camp: far stronger than the others, its name and health at the top', async () => {
    const b = await dbg(
      page,
      (d, id) => {
        const G = d.G,
          f = G.fronts.find((f) => f.id === id)!;
        d.advance(d.BOSS_WARN);
        const e = d.boss();
        const others = G.enemies.filter((o) => o !== e).map((o) => o.max);
        return {
          boss: !!e,
          fromCamp: e ? Math.hypot(e.x - f.road[0]![0], e.z - f.road[0]![1]) : -1,
          route: e?.route === f.road,
          strength: e ? e.max / Math.max(...others) : 0,
          came: G.boss.came,
          front: G.boss.front,
          next: G.boss.next - G.t,
        };
      },
      front,
    );
    expect(b.boss).toBe(true);
    expect(b.route).toBe(true);
    expect(b.fromCamp).toBeLessThan(8);
    expect(b.strength).toBeGreaterThan(10);
    expect(b.came).toBe(1);
    expect(b.front).toBeNull();
    expect(b.next).toBeGreaterThan(175);
    await frames(page, 2);
    const panel = await bossPanel(page);
    expect(panel.shown).toBe(true);
    expect(panel.warn).toBe(false);
    expect(panel.name).toMatch(/^The [A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(panel.health).toBe('100%');
  });

  test('while it is on the field no other boss comes', async () => {
    const s = await dbg(page, (d) => {
      const G = d.G,
        due = G.boss.next;
      G.boss.next = G.t;
      d.advance(2);
      const got = [G.boss.front, G.boss.came, G.boss.next - G.t >= d.BOSS_WARN - 0.1];
      G.boss.next = due;
      return got;
    });
    expect(s).toEqual([null, 1, true]);
  });

  test('the king and his troop can fight it: its health goes down at the top', async () => {
    const hp = await dbg(page, (d) => {
      const e = d.boss()!;
      d.teleport(e.x - 3, e.z);
      d.advance(2);
      return e.hp / e.max;
    });
    expect(hp).toBeLessThan(1);
    await frames(page, 2);
    expect(parseFloat((await bossPanel(page)).health)).toBeLessThan(100);
    await shot(page, 'boss-fight');
  });

  test('a boss on the field is saved, and comes back after a reload', async () => {
    await page.click('#cd-pause-btn');
    const before = await dbg(page, (d) => {
      d.save();
      const e = d.boss()!;
      return [e.x, e.z, e.hp, e.max, e.dmg, e.value, e.mkey, d.G.boss.next, d.G.boss.came];
    });
    await page.reload();
    await reopened(page);
    const after = await dbg(page, (d) => {
      const e = d.boss()!;
      return [e.x, e.z, e.hp, e.max, e.dmg, e.value, e.mkey, d.G.boss.next, d.G.boss.came];
    });
    expect(after).toEqual(before);
    expect((await bossPanel(page)).shown).toBe(true);
    await page.click('#cd-resume');
  });

  test('beaten, it bursts into a shower of coins worth its reward, and the panel goes', async () => {
    const r = await dbg(page, (d) => {
      const G = d.G,
        e = d.boss()!,
        value = e.value;
      d.teleport(e.x - 3, e.z);
      e.hp = 1;
      for (let i = 0; i < 60 && d.boss(); i++) d.advance(1 / 30);
      const shower = G.coinsOnGround.filter((c) => c.v === value / 30);
      return { gone: !d.boss(), slain: G.boss.slain, value, coins: shower.length };
    });
    expect(r.gone).toBe(true);
    expect(r.slain).toBe(1);
    expect(r.value).toBeGreaterThan(100);
    expect(r.coins).toBe(30);
    await frames(page, 2);
    expect((await bossPanel(page)).shown).toBe(false);
    await shot(page, 'boss-beaten');
  });

  test('the next boss is due 3 minutes after the last one came', async () => {
    const next = await dbg(page, (d) => d.G.boss.next - d.G.t);
    expect(next).toBeGreaterThan(150);
    expect(next).toBeLessThanOrEqual(180);
  });

  test('the warning is saved too, and a reload shows it again', async () => {
    await page.click('#cd-pause-btn');
    const before = await dbg(page, (d) => {
      const G = d.G;
      G.boss.next = G.t + d.BOSS_WARN - 5;
      d.advance(0.5);
      d.save();
      return [G.boss.front, G.boss.next];
    });
    expect(before[0]).not.toBeNull();
    await page.reload();
    await reopened(page);
    expect(await dbg(page, (d) => [d.G.boss.front, d.G.boss.next])).toEqual(before);
    const panel = await bossPanel(page);
    expect([panel.shown, panel.warn]).toEqual([true, true]);
  });

  test('when the castle falls, the panel says how many bosses were beaten', async () => {
    await page.click('#cd-resume');
    expect(await fall(page, 400)).toBe(true);
    expect(await overPanel(page)).toBe(true);
    expect(await overText(page)).toMatch(/ You beat 1 boss\.$/);
    expect((await bossPanel(page)).shown).toBe(false);
  });

  test('a game saved before there were bosses carries on, with its first boss a minute away', async () => {
    const good = await open();
    await dbg(good, (d) => {
      d.advance(20);
      d.G.t = 300;
      d.save();
    });
    const { boss: _, ...old } = JSON.parse((await savedWorld(good))!);
    good.close();
    const back = await open({ storage: { [WORLD]: JSON.stringify(old) } });
    expect(await dbg(back, (d) => [d.G.t, d.G.paused, d.G.boss.next, d.G.boss.came])).toEqual([300, true, 360, 0]);
    expect(back.errors).toEqual([]);
    back.close();
  });

  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
});

describe('Gold boys', () => {
  // (the checks play a frame at a time with the enemies taken away, so the only coins are the ones they put down)
  let gold: Page;
  beforeAll(async () => {
    gold = await open();
  });
  afterAll(() => gold.close());

  test('their hut goes up inside the walls, once there is an outpost', async () => {
    const got = await dbg(gold, (d) => {
      const G = d.G;
      d.rich(1e6);
      d.buy('recruit');
      for (let i = 0; i < 6; i++) d.buy('tower' + i);
      d.buy('cannon0');
      d.buy('cannon1');
      d.advance(0.5);
      const vis = d.pads().map((p) => p.id);
      const east = d
        .sites()
        .filter((s) => vis.includes(s.id))
        .reduce((a, b) => (b.x > a.x ? b : a));
      d.buy(east.id);
      d.advance(0.5);
      d.buy('gold');
      d.teleport(2, 3); // in the base, off the pads, his coin magnet far from where the checks put coins
      G.free = false;
      G.coinsOnGround.length = 0;
      for (let i = 0; i < 60; i++) {
        G.enemies.length = 0;
        G.spawnQueue.length = 0;
        d.advance(1 / 30, 1 / 30);
      }
      const hut = G.gold.b!;
      return {
        hut: [hut.x, hut.z],
        boys: G.gold.boys.map((b) => [b.home, b.state]),
        pad: d.pads().find((p) => p.id === 'gold'),
      };
    });
    expect(Math.abs(got.hut[0]!)).toBeLessThan(10);
    expect(Math.abs(got.hut[1]!)).toBeLessThan(9);
    expect(got.boys).toEqual([['home', 'idle']]);
    expect(Math.abs(got.pad!.x)).toBeLessThan(12);
    expect(Math.abs(got.pad!.z)).toBeLessThan(10);
  });

  test('a boy picks a coin up at ten times its worth, and brings it home through a gate: the king gets it', async () => {
    const got = await dbg(gold, (d) => {
      const G = d.G,
        b = G.gold.boys[0]!,
        inWalls = (x: number, z: number) => Math.abs(x) < 14 && Math.abs(z) < 12;
      G.coins = 0;
      G.coinsOnGround.length = G.flying.length = 0;
      G.coinsOnGround.push({
        x: -4,
        z: 22,
        y: 0,
        vx: 0,
        vz: 0,
        vy: 0,
        v: 7,
        spin: 0,
        rest: true,
        age: 1,
        gone: false,
        claimed: null,
      });
      const gates: string[] = [];
      let carried = 0,
        given = 0,
        at: number[] = [],
        dest: string | null = null;
      for (let i = 0; i < 30 * 40 && !at.length; i++) {
        const was = [b.x, b.z],
          load = b.load,
          coins = G.coins;
        dest = b.dest ?? dest;
        G.enemies.length = G.spawnQueue.length = 0;
        d.advance(1 / 30, 1 / 30);
        carried = Math.max(carried, b.load);
        if (inWalls(was[0]!, was[1]!) !== inWalls(b.x, b.z))
          gates.push(
            Math.abs(b.z) < 2.2 ? 'E' : b.x > 4 && b.x < 8 && Math.abs(b.z) > 11 ? 'S' : `wall at ${b.x}, ${b.z}`,
          );
        if (load > 0 && b.load === 0) {
          at = [b.x, b.z];
          given = G.coins - coins;
        }
      }
      return { carried, given, at, dest, gates, coins: G.coins };
    });
    expect(got.carried).toBe(70);
    expect(got.given).toBe(70);
    expect(got.coins).toBe(70);
    expect(got.dest).toBe('home');
    expect(Math.abs(got.at[0]!)).toBeLessThan(14);
    expect(Math.abs(got.at[1]!)).toBeLessThan(12);
    // out and back in, through the gates (never over a wall)
    expect(got.gates.length).toBe(2);
    expect(got.gates.every((g) => g === 'E' || g === 'S')).toBe(true);
  });

  test('with an outpost nearer than home, he takes his coins there', async () => {
    const got = await dbg(gold, (d) => {
      const G = d.G,
        b = G.gold.boys[0]!,
        t = G.towers.find((o) => o.outer && o.built)!,
        l = Math.hypot(t.x, t.z);
      G.coins = 0;
      G.coinsOnGround.length = G.flying.length = 0;
      G.coinsOnGround.push({
        x: t.x + (t.x / l) * 6,
        z: t.z + (t.z / l) * 6,
        y: 0,
        vx: 0,
        vz: 0,
        vy: 0,
        v: 12,
        spin: 0,
        rest: true,
        age: 1,
        gone: false,
        claimed: null,
      });
      let at: number[] = [],
        dest: string | null = null;
      for (let i = 0; i < 30 * 40 && !at.length; i++) {
        const load = b.load;
        dest = b.dest ?? dest;
        G.enemies.length = G.spawnQueue.length = 0;
        d.advance(1 / 30, 1 / 30);
        if (load > 0 && b.load === 0) at = [b.x, b.z];
      }
      return { dest, outpost: 'outpost' + t.idx, from: Math.hypot(at[0]! - t.x, at[1]! - t.z), coins: G.coins };
    });
    expect(got.dest).toBe(got.outpost);
    expect(got.from).toBeLessThan(3);
    expect(got.coins).toBe(120);
  });

  test('each outpost has a pad beside it that sells a gold boy of its own', async () => {
    const got = await dbg(gold, (d) => {
      const t = d.G.towers.find((o) => o.outer && o.built)!,
        pad = d.pads().find((p) => p.id === 'goldboy' + t.idx);
      return {
        pad,
        from: pad ? Math.hypot(pad.x - t.x, pad.z - t.z) : -1,
        border: pad ? d.borderDist(pad.x, pad.z) : 0,
      };
    });
    expect(got.pad?.cost).toBe(2000);
    expect(got.from).toBeLessThan(5);
    expect(got.border).toBeLessThan(-3);
  });

  test("the outpost's boy waits at it, picks up the coins around it and hands them in: the king gets them", async () => {
    const got = await dbg(gold, (d) => {
      const G = d.G,
        t = G.towers.find((o) => o.outer && o.built)!,
        l = Math.hypot(t.x, t.z);
      d.buy('goldboy' + t.idx);
      const b = G.gold.boys.find((b) => b.home === 'outpost' + t.idx)!;
      G.coins = 0;
      G.coinsOnGround.length = G.flying.length = 0;
      G.coinsOnGround.push({
        x: t.x + (t.x / l) * 14,
        z: t.z + (t.z / l) * 14 + 4,
        y: 0,
        vx: 0,
        vz: 0,
        vy: 0,
        v: 9,
        spin: 0,
        rest: true,
        age: 1,
        gone: false,
        claimed: null,
      });
      let carried = 0,
        at: number[] = [],
        dest: string | null = null;
      for (let i = 0; i < 30 * 30 && !at.length; i++) {
        const load = b.load;
        dest = b.dest ?? dest;
        G.enemies.length = G.spawnQueue.length = 0;
        d.advance(1 / 30, 1 / 30);
        carried = Math.max(carried, b.load);
        if (load > 0 && b.load === 0) at = [b.x, b.z];
      }
      return {
        boys: G.gold.boys.map((b) => b.home),
        pad: d.pads().some((p) => p.id === 'goldboy' + t.idx),
        carried,
        dest,
        outpost: 'outpost' + t.idx,
        from: Math.hypot(at[0]! - t.x, at[1]! - t.z),
        coins: G.coins,
      };
    });
    expect(got.boys).toEqual(['home', got.outpost]);
    expect(got.pad).toBe(false);
    expect(got.carried).toBe(90);
    expect(got.dest).toBe(got.outpost);
    expect(got.from).toBeLessThan(3);
    expect(got.coins).toBe(90);
  });

  test('he leaves the coins far from his outpost to others, and stays by it', async () => {
    const got = await dbg(gold, (d) => {
      const G = d.G,
        t = G.towers.find((o) => o.outer && o.built)!,
        b = G.gold.boys.find((b) => b.home === 'outpost' + t.idx)!;
      G.coinsOnGround.length = G.flying.length = 0;
      G.coinsOnGround.push({
        x: -4,
        z: 22,
        y: 0,
        vx: 0,
        vz: 0,
        vy: 0,
        v: 5,
        spin: 0,
        rest: true,
        age: 1,
        gone: false,
        claimed: null,
      });
      let far = 0;
      for (let i = 0; i < 30 * 4; i++) {
        G.enemies.length = G.spawnQueue.length = 0;
        d.advance(1 / 30, 1 / 30);
        far = Math.max(far, Math.hypot(b.x - t.x, b.z - t.z));
      }
      return { far, target: b.target, coinFrom: Math.hypot(-4 - t.x, 22 - t.z) };
    });
    expect(got.coinFrom).toBeGreaterThan(50);
    expect(got.target).toBeNull();
    expect(got.far).toBeLessThan(8);
  });

  test('the king carries a green bill for every thousand coins, and the coins left over on top', async () => {
    const stack = await dbg(gold, (d) =>
      [3140, 999, 40_000].map((n) => {
        const G = d.G;
        G.coins = n;
        G.coinsOnGround.length = G.flying.length = G.enemies.length = G.spawnQueue.length = 0;
        d.advance(1 / 30, 1 / 30);
        return [d.world.bill.count, d.world.coin.count];
      }),
    );
    expect(stack).toEqual([
      [3, 140],
      [0, 400],
      [40, 0],
    ]);
  });

  test('a game saved before the boys took coins home: what lay on their plot goes to the king', async () => {
    await dbg(gold, (d) => d.save());
    const saved = JSON.parse((await savedWorld(gold))!);
    expect(saved.gold.plot).toBeUndefined();
    expect(saved.gold.lv).toBe(1);
    const old = await open({ storage: { [WORLD]: JSON.stringify({ ...saved, gold: { ...saved.gold, plot: 250 } }) } });
    const back = await dbg(old, (d) => ({
      coins: d.G.coins,
      boys: d.G.gold.boys.map((b) => b.home).sort(),
      paused: d.G.paused,
    }));
    // the base's boy, and the outpost's from the tests above
    expect(back).toEqual({
      coins: saved.coins + 250,
      boys: ['home', 'outpost' + saved.outposts.find((o: { boy?: unknown }) => o.boy).idx],
      paused: true,
    });
    expect(old.errors).toEqual([]);
    old.close();
  });

  test('no errors in the page', () => {
    expect(gold.errors).toEqual([]);
  });
});

describe('The forge: weapon after weapon, bazookas last', () => {
  beforeAll(async () => {
    page = await open();
  });
  afterAll(() => page.close());

  test('each weapon costs twice what it did, and bazookas four times the step after machine guns', async () => {
    const prices = await dbg(page, (d) => {
      const G = d.G;
      d.rich(1e9);
      for (let i = 0; i < 4; i++) d.buy('recruit');
      for (let i = 0; i < 6; i++) d.buy('tower' + i);
      d.buy('forgebuild');
      const out: [tier: number, extra: number, cost: number][] = [];
      for (let i = 0; i < 9; i++) {
        out.push([G.tier, G.extraDmg, d.pads().find((p) => p.id === 'forge')!.cost]);
        d.buy('forge');
      }
      return out;
    });
    expect(prices).toEqual([
      [0, 0, 270],
      [1, 0, 720],
      [2, 0, 1680],
      [3, 0, 3600],
      [4, 0, 7200],
      [5, 0, 14400],
      [6, 0, 115200],
      [7, 0, 28800],
      [7, 1, 46080],
    ]);
  });

  test('a price of any length fits on its pad', async () => {
    const spilt = await dbg(page, (d) => {
      const G = d.G,
        pad = G.pads.find((p) => p.id === 'forge')!,
        out: [cost: number, inkOutside: number][] = [];
      for (const extra of [1, 5, 12, 40]) {
        G.extraDmg = extra;
        d.advance(0.1);
        const img = (pad.tex.image as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 256, 256).data;
        let ink = 0;
        for (let y = 0; y < 256; y++)
          for (let x = 0; x < 256; x++) if ((x < 16 || x > 240) && img[(y * 256 + x) * 4 + 3] > 0) ink++;
        out.push([pad.cost, ink]);
      }
      G.extraDmg = 0;
      return out;
    });
    // from five figures up to thirteen: nothing is drawn past the outline of the pad
    expect(spilt.map(([cost]) => String(cost).length)).toEqual([5, 6, 7, 13]);
    for (const [cost, ink] of spilt) expect(ink, String(cost)).toBe(0);
  });

  test("a rocket blows up where it lands, hurting an enemy out of the king's reach beside the one it hit", async () => {
    // the king alone, far from the towers, with two tough enemies that stand still: one in his reach, one 2.5 paces
    // past it and out of reach of anything
    const hurt = await dbg(page, (d) => {
      const G = d.G;
      G.tier = 6; // machine guns, from where the test before left the forge
      G.extraDmg = 0;
      while (G.enemies.length < 2) d.advance(0.5);
      const [a, b] = G.enemies;
      const setUp = () => {
        d.teleport(-40, 60);
        G.followers.length = 0;
        G.joiners.length = 0;
        G.enemies = [a, b];
        G.projectiles.length = 0;
        for (const [e, x] of [
          [a, -40 + 14.5],
          [b, -40 + 17],
        ] as const) {
          Object.assign(e, { x, z: 60, hp: 1e9, max: 1e9, speed: 0, state: 'path' });
          e.route = [[x, 60]];
          e.wp = 0;
        }
        d.advance(1.5);
        return [Math.round(a.max - a.hp), Math.round(b.max - b.hp)];
      };
      const machineGuns = [G.tier, ...setUp()];
      d.buy('forge');
      const bazookas = [G.tier, ...setUp()];
      return { machineGuns, bazookas };
    });
    expect(hurt.machineGuns[0]).toBe(6);
    expect(hurt.machineGuns[1]).toBeGreaterThan(0);
    expect(hurt.machineGuns[2]).toBe(0);
    expect(hurt.bazookas[0]).toBe(7);
    expect(hurt.bazookas[1]).toBeGreaterThan(0);
    expect(hurt.bazookas[2]).toBeGreaterThan(0);
  });

  test('no errors in the page', () => {
    expect(page.errors).toEqual([]);
  });
});

describe('Saves from before there were bazookas', () => {
  test('machine guns +2 carry on, with bazookas next at the forge; bazookas are saved and come back', async () => {
    // a save then had the same fields as now, with the forge's tier at most 6 (machine guns) and +1s on top
    const first = await open();
    await dbg(first, (d) => {
      const G = d.G;
      d.rich(1e9);
      for (let i = 0; i < 4; i++) d.buy('recruit');
      for (let i = 0; i < 6; i++) d.buy('tower' + i);
      d.buy('forgebuild');
      while (G.tier < 6) d.buy('forge');
      G.extraDmg = 2;
      d.save();
    });
    const old = JSON.parse((await savedWorld(first))!);
    first.close();
    expect([old.forge, old.extraDmg]).toEqual([6, 2]);

    const back = await open({ storage: { [WORLD]: JSON.stringify(old) } });
    const forge = (d: CastleDebug) => [d.G.tier, d.G.extraDmg, d.pads().find((p) => p.id === 'forge')!.cost];
    expect(await dbg(back, forge)).toEqual([6, 2, 115200]);
    await dbg(back, (d) => {
      d.rich(1e6);
      d.buy('forge');
      d.save();
    });
    expect(JSON.parse((await savedWorld(back))!).forge).toBe(7);
    await back.reload();
    await reopened(back);
    expect(await dbg(back, forge)).toEqual([7, 2, Math.round(28800 * 1.6 ** 2)]);
    expect(back.errors).toEqual([]);
    back.close();

    // a weapon there is none of yet is a save this game can't carry on from
    const junk = await open({ storage: { [WORLD]: JSON.stringify({ ...old, forge: 8 }) } });
    expect(await dbg(junk, (d) => [d.G.t < 2, d.G.tier, d.G.paused])).toEqual([true, 0, false]);
    expect(junk.errors).toEqual([]);
    junk.close();
  });
});
