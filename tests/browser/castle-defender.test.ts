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

/** Castle Defender in a page, once a game is up */
async function open({ width = 1000, height = 600, mobile = false } = {}): Promise<Page> {
  const page = await openPage(site, { width, height, mobile, path: '/#castle-defender' });
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
        const pad = d.sites().reduce((a, b) => (b.x > a.x ? b : a));
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
