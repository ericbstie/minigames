// Castle Defender's lands: what opens up the further out the king pushes his border, and the numbers behind it, as
// plain functions (no three.js, no game state) so tests can check them without a browser.
//
// The first time the border reaches a land's distance from home, that land opens and something new shows up in it.
// The first land brings shops: lots for sale beside the outposts, where the king buys a business that fills its till
// with coins.
import { BIOME, type Biome, HOME, type Pt } from './castle-defender-world';

export interface Land {
  at: number; // how far out the border has to reach, in paces from home
  name: string;
  news: string; // what the banner says has opened
}
export const LANDS: Land[] = [{ at: 75, name: 'The market roads', news: 'Shops for sale' }];
/** How many lands a border reaching `reach` paces from home has opened */
export const landsReached = (reach: number) => LANDS.filter((l) => reach >= l.at).length;

// ----- the enemy's threat
// The enemy's strength follows a threat level (hit points grow 1.1 times and blows 1.06 times per level, groups get
// bigger and come faster). Up to EASE_FROM it is the clock's, a level every 13 seconds, which makes the enemy about
// 55% tougher every minute; the game as it was before the lands could not keep up with that much past 12 minutes,
// whatever it had built. From there it keeps growing, ever more slowly, so what the lands bring can hold it off.
export const EASE_FROM = 12 * 60,
  EASE_K = 25;
export function threatLevel(t: number): number {
  if (t <= EASE_FROM) return t / 13;
  return EASE_FROM / 13 + EASE_K * Math.log1p((t - EASE_FROM) / (13 * EASE_K));
}

// ----- shops
// A lot for sale shows beside each outpost once the first land is open. Buying it opens a shop, which fills its till
// with coins for the king (or a gold boy) to come and empty; it holds TILL_SECONDS of takings and then stops filling.
// Upgrades on the same pad make it earn more. Shops further out, in richer land, earn more for the same price.
export const SHOP_MAX = 5;
export const TILL_SECONDS = 75;
export const LOT_COST = 3000,
  LOT_GROW = 1.45,
  SHOP_UP = 2, // each level costs this many times the one before (from the lot's price)
  SHOP_GAIN = 2.2, // and earns this many times as much
  SHOP_PAYBACK = 60; // a first-level shop earns its lot's price back in this many seconds (in home land)
/** The price of the `n`-th lot for sale (counting from 0) */
export const lotPrice = (n: number) => Math.round(LOT_COST * Math.pow(LOT_GROW, n));
/** The price of a shop's next level, from the level it has (1 to SHOP_MAX - 1) and its lot's price */
export const shopUpPrice = (lot: number, lv: number) => Math.round(lot * Math.pow(SHOP_UP, lv));
/** How rich the land is at a spot: 1 near home, more the further out */
export const landWealth = (x: number, z: number) =>
  1 + 0.35 * Math.max(0, (Math.hypot(x - HOME.x, z - HOME.z) - 62) / 32);
/** Coins a second a shop at level `lv` (1 or more) takes, on a lot bought for `lot`, in land of wealth `wealth` */
export const shopRate = (lot: number, lv: number, wealth: number) =>
  (lot / SHOP_PAYBACK) * Math.pow(SHOP_GAIN, lv - 1) * wealth;

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
