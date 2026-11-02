// Castle Defender's lands: what opens up the further out the king pushes his border, and the numbers behind it, as
// plain functions (no three.js, no game state) so tests can check them without a browser.
//
// The first time the border reaches a land's distance from home, that land opens and something new shows up in it.
// The first land brings shops: lots for sale beside the outposts, where the king buys a business that makes his army
// stronger and fills its till with coins. The second brings treasure: marks in the ground where the king digs up
// relics that change how the fight goes.
import { BIOME, type Biome, HOME, type Pt } from './castle-defender-world';

export interface Land {
  at: number; // how far out the border has to reach, in paces from home
  name: string;
  news: string; // what the banner says has opened
}
export const LANDS: Land[] = [
  { at: 75, name: 'The market roads', news: 'Shops for sale' },
  { at: 110, name: 'The old battlefields', news: 'Treasure in the ground' },
];
/** How many lands a border reaching `reach` paces from home has opened */
export const landsReached = (reach: number) => LANDS.filter((l) => reach >= l.at).length;

// ----- the enemy's threat
// The enemy's strength follows a threat level (hit points grow 1.1 times and blows 1.06 times per level, groups get
// bigger and come faster). Up to EASE_FROM it is the clock's, a level every 13 seconds, which makes the enemy about
// 55% tougher every minute; the game as it was before the lands could not keep up with that much past 19 minutes
// (the boss that comes at 18 brings the castle down), whatever it had built. From there it keeps growing, ever more
// slowly, so what the lands bring can hold it off.
export const EASE_FROM = 19 * 60,
  EASE_K = 25;
export function threatLevel(t: number): number {
  if (t <= EASE_FROM) return t / 13;
  return EASE_FROM / 13 + EASE_K * Math.log1p((t - EASE_FROM) / (13 * EASE_K));
}

// ----- shops
// A lot for sale shows beside each outpost once the first land is open. Buying it opens a shop, which makes the
// whole army stronger (a richer kingdom arms its people better: every shop level adds TRADE to the damage everything
// of the king's does) and fills its till with coins for the king to come and take; a till holds TILL_SECONDS of
// takings and then stops filling. Upgrades on the same pad add to both. Shops further out, in richer land, take more
// for the same price.
export const SHOP_MAX = 5;
export const TILL_SECONDS = 75;
export const TRADE = 0.1;
export const LOT_COST = 20000,
  LOT_GROW = 1.5,
  SHOP_UP = 2.5, // each level costs this many times the one before (from the lot's price)
  SHOP_GAIN = 2.2, // and takes this many times as much
  SHOP_PAYBACK = 120; // a first-level shop takes its lot's price in this many seconds (in home land)
/** The price of the `n`-th lot for sale (counting from 0) */
export const lotPrice = (n: number) => Math.round(LOT_COST * Math.pow(LOT_GROW, n));
/** The price of a shop's next level, from the level it has (1 to SHOP_MAX - 1) and its lot's price */
export const shopUpPrice = (lot: number, lv: number) => Math.round(lot * Math.pow(SHOP_UP, lv));
/** How much harder everything of the king's hits with shops at these levels (1: no shops) */
export const tradeMight = (levels: readonly number[]) => 1 + TRADE * levels.reduce((n, lv) => n + lv, 0);
/** How rich the land is at a spot: 1 near home, more the further out */
export const landWealth = (x: number, z: number) =>
  1 + 0.35 * Math.max(0, (Math.hypot(x - HOME.x, z - HOME.z) - 62) / 32);
/** Coins a second a shop at level `lv` (1 or more) takes, on a lot bought for `lot`, in land of wealth `wealth` */
export const shopRate = (lot: number, lv: number, wealth: number) =>
  (lot / SHOP_PAYBACK) * Math.pow(SHOP_GAIN, lv - 1) * wealth;

// ----- treasure
// Once the second land is open, a mark shows on the ground now and then (one every DIG_EVERY seconds, DIG_MAX at most
// waiting), out towards the border. The king stands on it for DIG_SECONDS to dig up a relic, or the next level of one
// he has. There are as many digs as relic levels; then there is nothing left in the ground.
export const DIG_SECONDS = 3,
  DIG_EVERY = 45,
  DIG_MAX = 2;
export interface Relic {
  name: string;
  colour: string;
  what: (lv: number) => string; // what it does at a level, for the banner
}
export const RELIC_MAX = 3;
export const RELIC = { drum: 0, frost: 1, bone: 2, storm: 3, ember: 4 } as const;
export const RELICS: Relic[] = [
  { name: 'War Drum', colour: '#e0662a', what: (lv) => `Everything shoots ${Math.round(DRUM * lv * 100)}% faster` },
  {
    name: 'Frost Heart',
    colour: '#7fd3ff',
    what: (lv) => `Enemies walk and strike ${Math.round(FROST * lv * 100)}% slower`,
  },
  {
    name: "Giant's Bone",
    colour: '#efe3c2',
    what: (lv) => `Walls and castle ${Math.round(BONE * lv * 100)}% tougher`,
  },
  {
    name: 'Storm Horn',
    colour: '#ffe14a',
    what: (lv) => `Lightning strikes ${lv === 1 ? 'an enemy' : lv + ' enemies'} every ${STORM_EVERY} seconds`,
  },
  {
    name: 'Ember Crown',
    colour: '#ff4a2a',
    what: (lv) => `Fallen enemies burst into flames${lv > 1 ? `, ${lv} times as hot` : ''}`,
  },
];
export const DRUM = 0.2, // everything of the king's shoots this much faster a level
  FROST = 0.12, // and the enemy walks this much slower
  BONE = 0.5, // walls and castle have this much more hit points
  STORM_EVERY = 4, // lightning strikes the toughest enemies near the border this often, one a level
  STORM_HIT = 25, // as hard as this many hits of the king's weapon
  EMBER = 2, // an enemy that falls burns the ones around it as hard as this many hits of the weapon, a level
  EMBER_R = 3;
// (the lightning and the flames hit as hard as the king's weapon does, not by a share of the enemy's hit points, so
// they keep up with what the king builds, not with how tough the enemy gets)
export const haste = (lv: number) => 1 + DRUM * lv;
export const chill = (lv: number) => 1 - FROST * lv;
export const sturdy = (lv: number) => 1 + BONE * lv;
/** Which relic a dig brings, from the levels the king has of each and a random number in [0, 1): one he hasn't
 * found while there are any, else one he can still level; -1 when there are none left */
export function pickRelic(levels: readonly number[], r: number): number {
  const ids = (ok: (lv: number) => boolean) => RELICS.map((_, i) => i).filter((i) => ok(levels[i] ?? 0));
  const fresh = ids((lv) => lv === 0),
    open = fresh.length ? fresh : ids((lv) => lv < RELIC_MAX);
  return open.length ? open[Math.min(open.length - 1, Math.floor(r * open.length))] : -1;
}
/** How many digs are left in the ground for a king with relics at these levels */
export const digsLeft = (levels: readonly number[]) =>
  RELICS.reduce((n, _, i) => n + RELIC_MAX - Math.min(RELIC_MAX, levels[i] ?? 0), 0);

/** The point of a road nearest to (x, z): where it is, how far along the road, the road's direction there, and how
 * far away it is */
export function closestOnRoad(road: readonly Pt[], x: number, z: number) {
  let best = { x: road[0][0], z: road[0][1], at: 0, dx: 1, dz: 0, d: Infinity },
    along = 0;
  for (let i = 0; i < road.length - 1; i++) {
    const [ax, az] = road[i],
      [bx, bz] = road[i + 1],
      L = Math.hypot(bx - ax, bz - az);
    if (L > 0) {
      const ux = (bx - ax) / L,
        uz = (bz - az) / L,
        t = Math.max(0, Math.min(L, (x - ax) * ux + (z - az) * uz)),
        px = ax + ux * t,
        pz = az + uz * t,
        d = Math.hypot(x - px, z - pz);
      if (d < best.d) best = { x: px, z: pz, at: along + t, dx: ux, dz: uz, d };
    }
    along += L;
  }
  return best;
}

// what a shop sells and how it looks comes from the biome it stands in
export interface ShopKind {
  name: string;
  wall: string;
  trim: string;
  roof: string;
  awning: [string, string];
  sign: string;
}
export const SHOP_KINDS: Record<Biome, ShopKind> = {
  [BIOME.canyon]: {
    name: 'Bakery',
    wall: '#e8c99a',
    trim: '#8a5a36',
    roof: '#b9472e',
    awning: ['#e23b3b', '#f4ede2'],
    sign: '#f2b84a',
  },
  [BIOME.frozen]: {
    name: 'Fur trader',
    wall: '#9a6a44',
    trim: '#5e3b22',
    roof: '#eef4fb',
    awning: ['#3d7be0', '#f4f7fb'],
    sign: '#d8e6f5',
  },
  [BIOME.mire]: {
    name: 'Herbalist',
    wall: '#b7a77a',
    trim: '#4f5a2e',
    roof: '#4f7d3a',
    awning: ['#7b4fb0', '#efe7d2'],
    sign: '#9ad15a',
  },
  [BIOME.ash]: {
    name: 'Smeltery',
    wall: '#8d8682',
    trim: '#3e3633',
    roof: '#4a3f3b',
    awning: ['#e0662a', '#2e2a28'],
    sign: '#ff9a3a',
  },
};
