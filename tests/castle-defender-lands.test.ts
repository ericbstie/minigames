// Checks Castle Defender's lands (public/js/castle-defender-lands.ts), no browser needed: the lands open in order as
// the border reaches them, the enemy's threat follows the clock until it eases off and then keeps growing more slowly,
// and the shops' prices and takings go the way the game needs.
import { describe, expect, test } from 'bun:test';
import * as L from '../public/js/castle-defender-lands';
import type { Pt } from '../public/js/castle-defender-world';

describe('Lands', () => {
  test('each opens further out than the one before', () => {
    for (let i = 1; i < L.LANDS.length; i++) expect(L.LANDS[i].at).toBeGreaterThan(L.LANDS[i - 1].at);
  });
  test('none is open with only the home land (44 paces), and they open one by one going out', () => {
    expect(L.landsReached(44)).toBe(0);
    expect(L.landsReached(69)).toBe(0); // the first outpost alone doesn't get there
    for (const [i, land] of L.LANDS.entries()) {
      expect(L.landsReached(land.at - 0.5)).toBe(i);
      expect(L.landsReached(land.at)).toBe(i + 1);
    }
    expect(L.landsReached(1e4)).toBe(L.LANDS.length);
  });
});

describe('The threat level', () => {
  const minute = (m: number) => m * 60;
  test('is the clock (a level every 13 seconds) up to 19 minutes, as before the lands', () => {
    for (const t of [0, 13, 60, 300, 600, L.EASE_FROM]) expect(L.threatLevel(t)).toBeCloseTo(t / 13, 9);
  });
  test('goes on smoothly from there, at the same pace at first', () => {
    const a = L.threatLevel(L.EASE_FROM),
      b = L.threatLevel(L.EASE_FROM + 1);
    expect(b - a).toBeGreaterThan(0.99 / 13);
    expect(b - a).toBeLessThanOrEqual(1 / 13);
  });
  test('keeps growing, but ever more slowly, and well below the clock an hour in', () => {
    let last = L.threatLevel(L.EASE_FROM),
      lastStep = Infinity;
    for (let m = L.EASE_FROM / 60 + 1; m <= 90; m++) {
      const now = L.threatLevel(minute(m));
      expect(now).toBeGreaterThan(last);
      expect(now - last).toBeLessThan(lastStep);
      lastStep = now - last;
      last = now;
    }
    expect(L.threatLevel(minute(60))).toBeLessThan((minute(60) / 13) * 0.6);
  });
});

describe('Shops', () => {
  test('each lot costs more than the one before', () => {
    expect(L.lotPrice(0)).toBe(L.LOT_COST);
    for (let n = 1; n < 12; n++) expect(L.lotPrice(n)).toBeGreaterThan(L.lotPrice(n - 1));
  });
  test('each level costs more than the one before, and takes more', () => {
    const lot = L.lotPrice(2);
    let price = lot;
    for (let lv = 1; lv < L.SHOP_MAX; lv++) {
      const up = L.shopUpPrice(lot, lv);
      expect(up).toBeGreaterThan(price);
      expect(L.shopRate(lot, lv + 1, 1)).toBeGreaterThan(L.shopRate(lot, lv, 1) * 2);
      price = up;
    }
  });
  test('a first level shop in home land pays its lot back in SHOP_PAYBACK seconds', () => {
    const lot = L.lotPrice(0);
    expect(L.shopRate(lot, 1, L.landWealth(4, 0)) * L.SHOP_PAYBACK).toBeCloseTo(lot, 6);
  });
  test("every shop level makes everything of the king's hit TRADE harder, adding up", () => {
    expect(L.tradeMight([])).toBe(1);
    expect(L.tradeMight([0, 0])).toBe(1);
    expect(L.tradeMight([1])).toBeCloseTo(1 + L.TRADE, 9);
    expect(L.tradeMight([5, 3, 0, 2])).toBeCloseTo(1 + 10 * L.TRADE, 9);
  });
  test('land further out is richer', () => {
    expect(L.landWealth(4, 0)).toBe(1);
    expect(L.landWealth(60, 0)).toBe(1);
    expect(L.landWealth(130, 0)).toBeGreaterThan(L.landWealth(100, 0));
  });
  test('there is a kind of shop for every biome', () => {
    for (let b = 0; b < 4; b++) expect(L.SHOP_KINDS[b as 0 | 1 | 2 | 3].name).toBeTruthy();
  });
});

describe('Relics', () => {
  const none = L.RELICS.map(() => 0);
  test('the first digs bring each relic once, whatever the luck', () => {
    for (const r of [0, 0.3, 0.99]) {
      const have = none.slice();
      for (let n = 0; n < L.RELICS.length; n++) {
        const i = L.pickRelic(have, r);
        expect(have[i]).toBe(0);
        have[i]++;
      }
      expect(have).toEqual(L.RELICS.map(() => 1));
    }
  });
  test('then they level up, to RELIC_MAX, and then there are none left', () => {
    const have = L.RELICS.map(() => 1);
    let digs = 0;
    for (let i = L.pickRelic(have, 0.5); i >= 0; i = L.pickRelic(have, (digs * 0.37) % 1)) {
      expect(have[i]).toBeLessThan(L.RELIC_MAX);
      have[i]++;
      digs++;
    }
    expect(digs).toBe(L.RELICS.length * (L.RELIC_MAX - 1));
    expect(have).toEqual(L.RELICS.map(() => L.RELIC_MAX));
  });
  test('there are as many digs as relic levels', () => {
    expect(L.digsLeft(none)).toBe(L.RELICS.length * L.RELIC_MAX);
    expect(L.digsLeft([3, 1, 0, 2, 3])).toBe(0 + 2 + 3 + 1 + 0);
    expect(L.digsLeft([])).toBe(L.RELICS.length * L.RELIC_MAX);
  });
  test('each level does more', () => {
    for (let lv = 1; lv <= L.RELIC_MAX; lv++) {
      expect(L.haste(lv)).toBeGreaterThan(L.haste(lv - 1));
      expect(L.chill(lv)).toBeLessThan(L.chill(lv - 1));
      expect(L.chill(lv)).toBeGreaterThan(0.5);
      expect(L.sturdy(lv)).toBeGreaterThan(L.sturdy(lv - 1));
    }
    expect([L.haste(0), L.chill(0), L.sturdy(0)]).toEqual([1, 1, 1]);
  });
  test('every relic says what it does at every level', () => {
    for (const r of L.RELICS) for (let lv = 1; lv <= L.RELIC_MAX; lv++) expect(r.what(lv).length).toBeGreaterThan(10);
    expect(L.RELICS[L.RELIC.storm].what(1)).toContain('an enemy');
    expect(L.RELICS[L.RELIC.storm].what(3)).toContain('3 enemies');
  });
});

describe('Dirty money', () => {
  test('a beaten boss leaves more of it than a cleared camp, and the horse carries a few trips of it', () => {
    expect(L.SACKS_BOSS).toBeGreaterThan(L.SACKS_CAMP);
    expect(L.SACK_MAX).toBeGreaterThanOrEqual(L.SACKS_BOSS);
    expect(L.SACKS_GROUND).toBeGreaterThan(L.SACK_MAX);
  });
  test('the higher a shop is, the faster it washes', () => {
    expect(L.washTime(1)).toBe(L.WASH_SECONDS);
    for (let lv = 2; lv <= L.SHOP_MAX; lv++) expect(L.washTime(lv)).toBeLessThan(L.washTime(lv - 1));
  });
  test("every sack washed makes everything of the king's hit WASH harder, on top of what the shops bring", () => {
    expect(L.kingMight([], 0)).toBe(1);
    expect(L.kingMight([3, 2], 0)).toBeCloseTo(L.tradeMight([3, 2]), 9);
    expect(L.kingMight([], 4)).toBeCloseTo(1 + 4 * L.WASH, 9);
    expect(L.kingMight([3, 2], 10)).toBeCloseTo(L.tradeMight([3, 2]) * (1 + 10 * L.WASH), 9);
  });
});

describe('The nearest point of a road', () => {
  const road: Pt[] = [
    [0, 0],
    [10, 0],
    [10, 10],
  ];
  test('beside the first stretch', () => {
    const c = L.closestOnRoad(road, 4, 3);
    expect([c.x, c.z, c.at, c.dx, c.dz, c.d]).toEqual([4, 0, 4, 1, 0, 3]);
  });
  test('beside the second stretch, counting along the road', () => {
    const c = L.closestOnRoad(road, 13, 6);
    expect([c.x, c.z, c.at, c.dx, c.dz, c.d]).toEqual([10, 6, 16, 0, 1, 3]);
  });
  test('past the end, the end', () => {
    const c = L.closestOnRoad(road, 10, 14);
    expect([c.x, c.z, c.at, c.d]).toEqual([10, 10, 20, 4]);
  });
});
