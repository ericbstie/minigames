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

**Outposts are new centers.** Each outpost built brings a camp of its own (`campBeyond`): it goes up past the border
off to one side of the way out from home (`campAround`, alternating sides, 14 past the border and clear of the wall,
the mesas and the other camps), and its road runs in to the outpost and on down the road the outpost stands by
(`roadFrom`), to the castle. So every outpost is a crossroads where two camps' roads meet, and the first thing their
enemies pass is its tower and field cannon. These fronts are `o` and the outpost's idx; they come after the five
first ones in `G.fronts`, take turns sending groups on one timer of their own (`G.centerT`, as often as the north
road's), get outpost spots on their roads where they cross the border, and fall back like any camp.

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

## Gold boys

Once the first outpost stands, a pad by the north wall of the base sells the gold hut (1500), and then upgrades it
twice (3000, 6000): one, two and then three gold boys. The hut stands inside the walls, and the boys belong to the
walled base: each has a `home` base, and waits in front of it. They run out after the coins on the ground outside the
base (the king's own coin magnet takes the ones inside), and each coin a boy picks up is worth `GOLD_PICKUP` (10)
times its value to him. With a full sack (400, 800 or 1500 coins, by the hut's level) or nothing left to pick up, a
boy takes his load to the nearest base, `goldBases()`: the walled base, at the hut's door, or any outpost, at its
tower. He hands it in there and it goes straight to the king. Outside the walls a boy goes round the base
(`steer`); in and out of it he goes through the east or south gate (`GOLD_GATES`, the ones with a clear way to the
hut's door), whichever makes the shorter way, and the gate opens for him as it does for the king.

**An outpost's own gold boy.** Each outpost built has a pad of its own beside its tower, on the side away from the
road (`outpostGoldPad`), that sells it a gold boy: 2000 coins for the first and 1.3 times more for each one after
(`OUTPOST_BOY_COST`, `OUTPOST_BOY_GROW`), and it doesn't need the hut. He belongs to that outpost (his `home` is
`outpost` and its idx), waits by it, and keeps to the coins within 44 paces of it (`OUTPOST_BOY.range`), so he works
the ground its camp's enemies fall on, which the base's boys seldom get out to. He carries what a second-level boy
does (800 coins, at his speed) and hands it in at the nearest base, which is nearly always his own outpost.

**Bills.** The king carries his coins as a stack on his back: a green bill for every thousand (`BILL`) at the
bottom, and a coin for each one left over on top (at most 300 bills and 400 coins are drawn). A boy handing in a
thousand or more sends a bill flying in for each thousand, up to four.

## The lands

The further out the border reaches, the more there is to do. The lands are rings of distance from home, listed in
`LANDS` in `public/js/castle-defender-lands.ts` with the numbers behind them (plain functions, checked by
`tests/castle-defender-lands.test.ts`). The first time `G.reach` (how far the border reaches from home) gets to a
land's distance, the land opens (`updateLands`): a banner says what has come, and it shows up. `G.land` counts the
lands open. Everything in them works the way the rest of the game does, by riding over things and standing on pads.

**Shops** (the market roads, 75 paces out, usually the third or fourth outpost). A lot for sale shows beside every
outpost standing, and beside each one built after (`addLot`): 8 paces off the outpost's road, further in towards the
castle, its door facing the road, clear of roads, buildings, pads and other lots (`lotFree`). Each lot costs 1.5 times
the one before (20,000 first, which the gold boys bring in a few minutes by then). Buying it opens a shop
(`buyShop`), whose kind and look come from the biome it stands in: a bakery in the canyon, a fur trader in the Frozen
Pass, a herbalist in the Mire, a smeltery in the Ashlands. Every shop level makes everything of the king's hit 10%
harder (`G.might`, from `tradeMight`, adding up over all the shops; `damageEnemy` multiplies by it): with coins
coming in by the bag, that is what makes a shop worth its price. A shop also fills the till in front of its door with
coins, and the king empties it by riding over it. A till holds 75 seconds of takings and then stops filling, so shops
pay the king for riding round his land. The same pad, now beside the shop, buys four more levels, each costing 2.5
times the last and earning 2.2 times as much (a first level shop takes its lot's price in two minutes); the shop grows
with them (crates, an upper floor, a side room, a turret). Shops further out, in richer land, take more for the same
price (`landWealth`).

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
front (its road, the stretches added as it fell back, whether and when it opened, its timers and its camp, the
outposts' camps after the first five, and their timer), the
ruins, the outposts and their field cannons, the lands open, the lots and shops with their tills, the coins paid into
pads, the enemies (each with the road it walks, stored once for all who share it, a boss among them) and the groups
about to set off, when the next boss comes (and from where, once its warning is up), and the coins on the ground.
Arrows, cannon balls,
dust and floating numbers start again empty. Coins flying to the king are added to his, and coins paid into a spot
for an outpost go back to him: `refreshFrontier` works the spots out again from the border, in the same places.
Each gold boy is saved with what he carries, and works out again which base to take it to; an outpost's boy is
saved with his outpost, with where its pad stands (saves from before work it out, on the side away from the roads). Saves from before the
boys took their coins home have a `gold.plot`, the coins left on the plot where they used to drop them (the king
had to fetch them): the king gets those.

`restoreGame` starts a new game and sets it up as saved, putting each building up at its level straight away (no
dust, no celebration) through the same helpers the purchases use (`makeForge`, `makeCannon`, `makeGoldHut`,
`outpostPad`). The `SavedWorld` Schema checks every field and that the save fits this game (six wall towers,
every stretch of wall, the five first fronts in order and then only camps of outposts that stand, enemies on roads
that are there, looks their kind has, one boss at most). A game saved before there were bosses meets its first a minute after it carries on. A save from before the
lands (no `land`, `lotSeq` or `shops`) carries on with none open; they open as the border gets there. A save that
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
pushing out costs no survival time and is the way the world opens up. Since the gold boys bring their coins
home ten times over (and to the king, so the bot gets them too), the bot ends with over a million coins it has
nothing left to spend on, and the castle holds about as long: 12:10 with 12 outposts and the border 138 paces out,
against 12:22, 11 and 113 just before (one run each, before the bosses came), and 12:15 with the bosses. Enemies from a camp 2 tiers out have about
2.6 times the hit points and 2.1 times the coins of ones from home.

With bosses the bot held 11:21, 11:48 and 11:11 (12:19 and 11:01 without them, the same day) and beat every boss that
came, three a game, without the castle losing hit points to one: the 3:00 boss falls at the walls within about a
minute of coming, most of it the walk in, and its 900 or so coins buy the next weapon early.

Weapons cost twice what they did since bazookas came. Left at its old weighting the bot puts weapons off and falls
before 5 minutes, so it counts the forge half as much as before, keeping the weapons coming in the same order, and
goes for the forge first once it has the coins for it four times over. With bosses, the gold boys and that player
the castle still stands at 15 minutes (two runs, 13 outposts, the border 137 paces out): bazookas come at about 9
to 10 minutes and the +1s after them. Without the four-times rule the bot never gets to bazookas, riding from one
cheaper pad to the next with 650,000 to 950,000 coins, and falls at about 11:06; before the gold boys came, doubled
prices held 10:34 and 11:04 with bosses, and handed bazookas at 9 minutes the bot stood at 15.

With the outposts as new centers (a camp beside each, and a gold boy for each) the castle still stands at 15 minutes
at full hit points (three runs each, the same day, with bazookas): the outposts' camps send more enemies at the border,
so it gets out a little slower (10 or 11 outposts and 114 to 118 paces against 12 or 13 and 116 to 139), and the
outposts' gold boys bring the bot about 4 million coins by the end against 2.5 to 3 million, one more +25% from the
forge. Before bazookas, when the castle fell at about 12 minutes, the new camps cost it about 50 seconds (11:08, 11:02,
11:59 and 10:48 against 11:56, 12:16, 11:48 and 12:15): they don't add to how many enemies are out (300 at most), but
theirs are tougher, standing out past the border, and sending their groups less often made no difference.

**The threat level.** The enemy's strength follows a threat level, `threatLevel(t)` in
`castle-defender-lands.ts`: hit points grow 1.1 times and blows 1.06 times a level, and groups get bigger and come
sooner. Up to 19 minutes it is the clock's, a level every 13 seconds, which makes the enemy about 55% tougher every
minute; after that it keeps growing, ever more slowly (`EASE_FROM`, `EASE_K`). The game from before the lands falls
at about 19:40 whatever it has built (19:45 and 19:39 on main with bazookas and the outposts as centers, both times to
the boss that comes at 18 minutes), so easing off after that can't make that game last longer, and only what the
lands bring can keep the castle standing into the easier stretch. `--no-lands` checks it: with the lands shut the
play-through fell at 19:58.

With the shops the bot held 22:56, 22:48 and 22:46 (a fourth fell at 4:48, before any land had opened, so in the game as it was
before them). The market roads open at about 6:15; the
bot buys 9 to 12 shops by the end, most of them to level 2 to 5, which beats the boss at 18 minutes, and falls to the
one at 21. It still ends with 2 to 8 million coins it has nothing to spend on.

## Checks

```sh
bun test tests/castle-defender-world.test.ts             # the world functions, no browser
bun test tests/castle-defender-lands.test.ts             # the lands' numbers, no browser
bun test tests/browser/castle-defender.test.ts           # the real page in Bun's headless browser
bun tools/play-castle-defender.ts 15 balanced --check    # a headless play-through, a line per game minute
bun tools/play-castle-defender.ts 60 balanced --no-lands # the same with the lands shut, to compare
```

`mise run test` runs both tests with all the others. The play-through is not a test: run it by hand after a
balance change. `KEEP_SHOTS=1` keeps the browser test's screenshots in `.shots/`.
`CastleDefender._debug()` in the page gives the tests the game state, a `teleport(x, z)` (which also lets the king
past the border), an `advance(seconds)` that runs the game faster than real time, `buy(padId)`, `lockLands()`, lists
of the pads, outpost spots, fronts, claims, and lots and shops with their tills, and the boss on the field (`boss()`;
set `G.boss.next` to bring one sooner).
