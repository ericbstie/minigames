# Castle Defender

Ride the king around the castle, collect the coins that fallen enemies drop, and spend them on the pads to grow
a troop, towers, walls, cannons and weapons, and outposts that push the border out. The game lives in `public/js/castle-defender.js` (three.js) and
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
from the start; the roads of the fronts (`front-<id>-<n>`) are added as they open or grow, and a new game removes
them again.

**The canyon wall** runs north to south on the west side and leans back further west the further it gets from
the castle (`cliffEdge(z)`, sampled every 4 paces at z = 4k + 1). It is built in 48 pace strips along z around
the king, coloured by the biome at its foot (sand and rust in the canyon, snow and blue rock to the north, moss to
the south). Two mesas stand by it north-west and south-west of the castle.

## The border

The king's land is a union of round claims (`G.claims`): 44 paces around home, and 34 around each outpost built.
`borderDist(claims, x, z)` is how far a spot is outside the border (negative inside). The king is kept 1.2 paces
inside it (`clampToClaims`), east of the canyon wall (`cliffMinX`) and off the mesas (`pushOutOfMesas`); enemies,
coins and gold boys are not.

The border is drawn by one big plane that follows the king (`initBorder`): its shader takes up to 64 claims (the
nearest, if there are more) and draws a dashed white line along the edge and a dusky veil past it. Blue flags
stand along it every 9 paces (`refreshPosts`), not on roads, the wall or the mesas. A new claim grows out from
its outpost over about a second (`claim.shown` eases up to `claim.r`), and its flags rise as it gets there.

**Fronts and camps.** The enemy marches from camps past the border, one camp per front, each down its front's
road to the castle (`G.fronts`). E, NE and SE are there from the start and take turns on one spawn timer; N (the
Frozen Pass) opens with the first cannon and S (the Mire) with the first outpost, and each sends groups on its own
timer as well. Enemies take their colours and pace from the biome of their camp, and get tougher and richer the
further out it is: `campTier` is 0 up to 62 paces from home and 1 more every 32 paces after that, and hit points
and coins grow with it (`tierHp`, `tierValue`) on top of the rise with time.

**Outposts.** Once two cannons stand, an outpost spot shows on each open front's road where it first gets 8 paces
inside the border, 4.6 to one side (`refreshFrontier`, `findSite`; spots within 10 of each other are one spot).
An outpost is an archer tower without walls, upgradeable like the wall towers. Building one claims 34 paces around
it; each costs 1.4 times the last (700 first). It also offers a field cannon spot across the road (500 first,
then 1.3 times the last).

**Camps fall back.** A camp the border comes within 4 paces of is cleared: it falls into a ruin and stops sending
anyone. The front's new camp goes up on outward from home in about the same direction (`nextCamp`): at least 20
paces further, 14 past the new border (so the next outpost on its road reaches it), clear of the canyon wall and
of the other camps. A new stretch of road (`campRoad`) runs from it to the old camp, and the front's road becomes
that stretch plus the old road, so its march gets longer, through the king's land. Enemies already on the way
keep the road they started on. `tools/check-castle-world.mjs` checks that nearly every outpost built on a front's
road clears that front's camp.

## Balance

`tools/play-castle-defender.js` plays the real page like a person: the king rides to coins and stands on pads
to buy (through the gates, round the buildings), buying the cheapest pad it can afford. With it the castle holds
about 11:10 to 12:15 and the border gets about 110 to 135 paces out with 10 or 11 outposts; the game from before the
open world held about 11:00 to 11:45 with the same player. Building outposts last (`turtle`) lasts about as long,
and rushing them before weapons (`expand`) falls before 5 minutes, just as rushing the old outer towers did. So
pushing out costs no survival time and is the way the world opens up. Enemies from a camp 2 tiers out have about
2.6 times the hit points and 2.1 times the coins of ones from home.

## Checks

```sh
node tools/check-castle-world.mjs                   # the world functions, in Node
node tools/test-castle-defender-browser.js          # the real page in headless Chromium (Playwright); --keep saves screenshots
node tools/play-castle-defender.js 15 balanced --check   # a headless play-through, a line per game minute
```

The browser test loads three.js from its CDN; `CD_THREE=/path/to/three.module.js` serves a local copy instead.
`CastleDefender._debug()` in the page gives the tests the game state, a `teleport(x, z)` (which also lets the king
past the border), an `advance(seconds)` that runs the game faster than real time, `buy(padId)`, and lists of the
pads, outpost spots, fronts and claims.
