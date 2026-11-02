# Castle Defender

Ride the king around the castle, collect the coins that fallen enemies drop, and spend them on the pads to grow
a troop, towers, walls, cannons and weapons, and outposts that push the border out. The game lives in
`public/js/castle-defender.ts` (three.js) and `public/js/castle-defender-world.ts` (the world's shape, as plain
functions).

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
keep the road they started on. `tests/castle-defender-world.test.ts` checks that nearly every outpost built on a
front's road clears that front's camp.

## The forge

The forge sells the weapons in turn (`WEAPONS`): upgraded bows, crossbows, spears, iron swords, guns, machine guns
and bazookas, for 270, 720, 1,680, 3,600, 7,200, 14,400 and 115,200 coins (`FORGE_COSTS`). Bazookas are four times
the 28,800 the next step up after machine guns would be. After bazookas the forge sells +25% damage, 28,800 coins
for the first and 1.6 times the one before after that (`forgeExtraCost`). The king, the troop and the archers on
the towers all carry the forge's weapon (the archers keep spears while the troop has swords), and the forge grows
with each one: for bazookas it becomes a rocket works, with a rocket standing in a gantry behind the shed.

Bazookas fire rockets (olive, with a red nose and a puff of smoke behind them) that fly after their target and
blow up where they get to, even if the target fell on the way: everyone within 2.6 paces takes the hit (`blast`).
The blast's flash, ring and smoke are kept small, as a troop with bazookas fires a lot of them.

A pad draws its price centred under its icon, smaller when it is too wide for the pad, and from 100,000 as three
figures and k, M, B or T (`priceLabel`: 115k, 1.15M, 34.9B).

## Bosses

Every 3 minutes of play (`BOSS_EVERY`, from when the last one came) a boss marches on the castle from one of the
open camps. 20 seconds before (`BOSS_WARN`) a red panel at the top of the screen names it and the camp it comes from,
with the time left, and red smoke rises over that camp. Then it walks down that front's road like the rest, only
slowly, and the panel shows its name and health instead. While it, or the camp it is coming from, is off the screen, a
red marker with a crown at the edge of the screen points the way.

A boss is its own unit (`UNIT.boss`): a hulking warlord in the colours of its camp's biome, about 10 times a giant's
hit points and 3 times its blow, grown with time and camp tier like every other enemy. Its blows shake the ground. It
is named after its biome (`BOSS_NAMES`: the Red Warlord, the Frost Jarl, the Bog Troll, the Cinder Lord). Beaten, it
bursts into a shower of 30 coins worth its reward (100 times a knight's coins); the game-over panel says how many were
beaten. Only one comes at a time: while one is on the field, the next waits, and comes 20 seconds after it falls.

## Opening and leaving

The game is a `Game` for the hub (`game`, at the end of `castle-defender.ts`; [development.md](development.md) has
how games are scoped). The first time it opens it makes the renderer and the world, which stay for the page, and
waits for the Lilita One font the pad labels are drawn in. The rest belongs to the visit: the stick and the keys,
the buttons, the resize listener and the frame loop (`animate`). The game's rules, the world and the drawing are
plain functions the frame calls. Leaving closes the visit: the loop and the listeners stop, a game still going
pauses under the pause panel, and a key or a drag still held is let go. Coming back finds the game where it was,
paused.

When the castle falls, the time it held is checked against the longest saved under `castle.bestTime` (whole
seconds, as plain text such as `123`; anything else there counts as none) and saved if it is longer. The game-over
panel comes up 1.4 s later, from a fiber of the visit; leaving before then brings it up straight away, ready for
when the player comes back.

## The saved game

The game being played is saved under `castle.world.v1` every 5 seconds of play, when the page is hidden or goes
away (a reload, a closed tab), and when the player leaves for the menu, so a reload finds it where it was: paused
under the pause panel, the same as coming back from the menu. Restart saves the new game over it, and when the castle
falls the save is removed, so the next visit starts a new game.

`snapshot` saves what the game needs to carry on, as plain data: the clock, coins and kills, the king, the troop
(recruits still running to someone count as his rank), each building's level (barracks, forge and weapon, wall
towers, cannons and their aim, the gold hut and its boys), each stretch of wall's hit points, the claims, every
front (its road, the stretches added as it fell back, whether and when it opened, its timers and its camp), the
ruins, the outposts and their field cannons, the coins paid into pads, the enemies (each with the road it walks,
stored once for all who share it, a boss among them) and the groups about to set off, when the next boss comes (and
from where, once its warning is up), and the coins on the ground. Arrows, cannon balls,
dust and floating numbers start again empty. Coins flying to the king are added to his, and coins paid into a spot
for an outpost go back to him: `refreshFrontier` works the spots out again from the border, in the same places.

`restoreGame` starts a new game and sets it up as saved, putting each building up at its level straight away (no
dust, no celebration) through the same helpers the purchases use (`makeForge`, `makeCannon`, `makeGoldHut`,
`outpostPad`). The `SavedWorld` Schema checks every field and that the save fits this game (six wall towers,
every stretch of wall, the five fronts in order, enemies on roads that are there, looks their kind has, one boss at
most). A game saved before there were bosses meets its first a minute after it carries on. A save that
doesn't fit starts a new game, and `castle.bestTime` is a key of its own, so it is kept either way. A save that
fits but still can't be set up (a mistake in this code) is reported, removed, and a new game starts. A save from
before there were bazookas (the forge at machine guns, maybe with +1s on them) fits: the forge offers bazookas next,
and the +1s are kept.

## Balance

`tools/play-castle-defender.ts` plays the real page like a person: the king rides to coins and stands on pads
to buy (through the gates, round the buildings), buying the cheapest pad it can afford. With it the castle holds
about 11:10 to 12:15 and the border gets about 110 to 135 paces out with 10 or 11 outposts; the game from before the
open world held about 11:00 to 11:45 with the same player. Building outposts last (`turtle`) lasts about as long,
and rushing them before weapons (`expand`) falls before 5 minutes, just as rushing the old outer towers did. So
pushing out costs no survival time and is the way the world opens up. Enemies from a camp 2 tiers out have about
2.6 times the hit points and 2.1 times the coins of ones from home.

With bosses the bot held 11:21, 11:48 and 11:11 (12:19 and 11:01 without them, the same day) and beat every boss that
came, three a game, without the castle losing hit points to one: the 3:00 boss falls at the walls within about a
minute of coming, most of it the walk in, and its 900 or so coins buy the next weapon early.

Doubling the weapon prices (with bazookas) took that to about 10:50 to 11:10, with 9 or 10 outposts and the border
about 115 paces out, once the player counts the forge half as much as before so the weapons still come in the same
order; left at the old weighting the player puts weapons off and falls before 5 minutes. The bot doesn't get to
bazookas (it has about 70,000 coins at 10 minutes, and spends them on cheaper pads), but handed them at 9 minutes
it still stands at 15, so they are a big step up for a player who saves for them.

## Checks

```sh
bun test tests/castle-defender-world.test.ts             # the world functions, no browser
bun test tests/browser/castle-defender.test.ts           # the real page in Bun's headless browser
bun tools/play-castle-defender.ts 15 balanced --check    # a headless play-through, a line per game minute
```

`mise run test` runs both tests with all the others. The play-through is not a test: run it by hand after a
balance change. `KEEP_SHOTS=1` keeps the browser test's screenshots in `.shots/`.
`CastleDefender._debug()` in the page gives the tests the game state, a `teleport(x, z)` (which also lets the king
past the border), an `advance(seconds)` that runs the game faster than real time, `buy(padId)`, lists of the
pads, outpost spots, fronts and claims, and the boss on the field (`boss()`; set `G.boss.next` to bring one sooner).
