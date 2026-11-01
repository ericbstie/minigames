# Castle Defender

Ride the king around the castle, collect the coins that fallen enemies drop, and spend them on the pads to grow
a troop, towers, walls, cannons and weapons. The game lives in `public/js/castle-defender.js` (three.js) and
`public/js/castle-defender-world.js` (the world's shape, as plain functions).

## The world

The world has no edge. North is -z and east is +x; the walled base is around (0, 0) and the castle at
(-5.5, -4.5).

**Biomes.** The sandy canyon reaches about 66 paces from home. Past it, three biomes each own a wedge of compass
directions and run on outward for ever: Frozen Pass to the north, Ashlands to the east and Mire to the
south-east. Their borders are rays out from home that wander by up to 16 paces of noise and blend over about 7
paces on either side, so the ground fades from one biome into the next. `biomeWeights(x, z)` returns how much of
each biome is at a spot (they add up to 1) and `biomeAt(x, z)` the strongest one. Enemies take their colours
from the biome their road starts in.

**Ground chunks.** The ground is made in 32 by 32 pace chunks (a 256 px canvas each) within about 84 paces of the
king, nearest first, a few milliseconds' worth per frame, and thrown away past 150 paces. A chunk is painted only
from functions of the ground position, so neighbours meet without seams and a chunk comes back the same when the
king returns:

1. the blended biome colour, a sample per pace, smoothed up to the texture,
2. patches, mire pools, ice and lava cracks, each a seeded list per chunk (the ones from neighbouring chunks
   that reach over are drawn too),
3. the roads: every road crossing the chunk is stroked in white on a mask and filled with the road colour of the
   biome it runs through,
4. a fine grain.

Decor (trees, rocks, pines, drifts, reeds, lava pools, ash vents...) is picked per chunk from the same seed,
merged into one mesh per chunk, and kept off roads, the canyon wall, and the hand-placed canyon decor near the
castle (inside 50 paces of home).

**Roads.** `addRoad(id, points)` paints a road into every chunk it crosses (they repaint on the next frames) and
clears decor off it; `removeRoad(id)` takes it away. The three first roads and four worn cross trails are there
from the start; an outer road is added when it opens, and a new game removes it again.

**The canyon wall** runs north to south on the west side and leans back further west the further it gets from
the castle (`cliffEdge(z)`, sampled every 4 paces at z = 4k + 1). It is built in 48 pace strips along z around
the king, coloured by the biome at its foot (sand and rust in the canyon, snow and blue rock to the north, moss to
the south). Two mesas stand by it north-west and south-west of the castle.

## Checks

```sh
node tools/check-castle-world.mjs           # the world functions, in Node
node tools/test-castle-defender-browser.js  # the real page in headless Chromium (Playwright); --keep saves screenshots
```

The browser test loads three.js from its CDN; `CD_THREE=/path/to/three.module.js` serves a local copy instead.
`CastleDefender._debug()` in the page gives the tests the game state, a `teleport(x, z)` and an `advance(seconds)`
that runs the game faster than real time.
