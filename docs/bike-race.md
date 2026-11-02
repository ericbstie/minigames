# Bike Race

A 2D physics motorbike game for phones, the fourth game on the Pick a Game menu (`#bike-race`). It follows the
genre (throttle, lean, flips, head-first crashes, timed runs, stars, ghosts) with its own art, worlds and menus.

## Playing

Hold the phone sideways. Turn it like a steering wheel to lean the bike: anticlockwise leans back, clockwise
leans forward. Hold the right half of the screen for gas and the left half to brake; keep holding the brake once
the bike has stopped and it backs up slowly. Before the start the two halves are tinted red and green with a
dashed line between them, so it's clear which is which.

The tilt sets how fast the bike turns, not how hard it is pushed, so there is no momentum to build up or fight. In
the air a small turn of the phone gives a slow rotation and a full turn (14°) a fast one; the bike reaches that
speed within about a twentieth of a second, and levelling the phone stops it just as quickly. On the ground,
leaning back lifts the front at a steady rate for a wheelie and leaning forward keeps the nose down. The
suspension is firm: it soaks up a landing in a single bounce. A crash throws the rider off and the wheels come off
the bike.

Five worlds with six levels each: Clover Hills, Ember Canyon, Frostbite Pass (ice), Crater Moon (low gravity and
loops) and Magma Works (lava). Finish a level to open the next one, and finish a world to open the next world.

- Three stars for beating par, two for finishing within 30% of par, one for finishing.
- Landed flips get a cheer, but no time off: the clock is just the time from start to finish.
- Your best run on each level is saved and replayed as a ghost (it can be turned off in the pause menu).
- Stars unlock bikes in the garage. See [Garage](#garage).

When tilt can't be used, two lean arrow buttons appear on the left and gas and brake move to the right, and a
short message says why. That happens when:

- the phone has no motion sensor,
- motion access was declined (iPhones ask once, on the first tap in the game),
- "Tilt the phone to lean" is switched off in the pause menu,
- the page is not https or localhost (browsers only send motion events to secure pages).

Held upright, the game shows a "Turn your phone sideways" screen, and turning the phone upright mid-run pauses
it. On Android, tapping Single player also goes fullscreen and locks the screen sideways. iPhones can't do
either from a web page.

On a computer the game shows a "Made for phones" screen with the page address. Its "Try it here with the
keyboard" button is for testing: ↑ ride, ↓ brake (then back up), ← lean back, → lean forward, R restart, Esc pause.

## Racing other people

Multiplayer on the home menu races other phones live, on the same track at the same time. One phone creates a
room on a track and gets a 4-letter code. The others type the code, tap the room in the "Open rooms" list, or
open the invite link (the Invite button shares it on phones; elsewhere it copies it). Links look like
`https://192.168.1.20:8443/#bike-race/BKTZ`. Up to six riders fit in a room.

- The host picks the track and starts the race. Everyone gets 3, 2, 1, GO at the same moment.
- Each rider rides their own garage bike. The others show up as see-through bikes with name tags, as dots on the
  progress bar, and in the place counter (2nd / 3).
- A crash puts you back at the last checkpoint flag with the clock still running.
- When the first rider finishes, the rest have 30 seconds ("Race ends in 23s" under the clock), then the race
  ends and everyone gets the standings. Anyone who hadn't finished is DNF. Every rider's time is their own
  phone's race clock, so a slow connection doesn't cost time.
- The winner gets a win next to their name in the room. The host can race again from the results; the others can
  go back to the room, where the last race's standings stay up.
- "Leave race" in the pause menu gives up the race but stays in the room. Leave room, or Back, leaves it.
- If the host leaves, or drops out between races, the next rider to have joined who is still connected becomes
  host, so the others can carry on.
- A phone that loses its connection (screen locked, another app opened, Wi-Fi blip) reconnects by itself and
  keeps its place for 45 seconds. A finish made while offline is sent when it's back.

When the page has no race server (opened from a plain static host), Multiplayer says so and offers "Race the
computer" instead: one to three computer riders on any track, which works anywhere.

## Trying it on a phone

```sh
mise run phone
```

This serves the site over https on your Wi-Fi, with the race server, and prints the address to open on the phone
(port 8443). Friends on the same Wi-Fi open the same address to race you. It makes a self-signed certificate in
`.cert/` the first time, using the `openssl` command, so each phone warns that the connection is not private.
That is expected here: tap "Advanced" then "Proceed" on Android, or "Show Details" then "visit this website" on
iPhone. `mise run app` works too, but it only listens on this computer, and over plain http a phone falls back to
the lean buttons.

## Files

```
public/js/bike-race-core.ts   physics, track builder, worlds and levels, bikes, computer rider, ghost encoding
public/js/bike-race-pieces.ts the level editor's track pieces and its level builder (docs/bike-race-editor.md)
public/js/bike-race-art.ts    canvas drawing: world backdrops, the track line, lava, loops, flags, bikes, riders, particles
public/js/bike-race-net.ts    the connection to the race server: WebSocket or event stream, reconnecting
public/js/bike-race-protocol.ts  every race message as an Effect Schema, shared with the server
public/js/bike-race.ts        the game: saves, sound, tilt and touch input, camera and loop, sessions, HUD, menus
public/js/bike-race-editor.ts the level editor: My levels and the build screen (docs/bike-race-editor.md)
public/index.html             #br-app markup (canvas, HUD, touch areas, screens, modals)
public/css/styles.css         the "Bike Race" section, all classes start with br-
public/js/hub.ts              routes #bike-race and #bike-race/<code> to the game
public/js/main.ts             registers bike-race.ts with the hub as the `br` game
public/assets/img/bike-race.jpg   menu card picture, made by tools/render-bike-race-card.ts
server/serve.ts               the site server and race server behind `mise run app` and `mise run phone`
server/race.ts                the rooms and races (the RaceLobby service)
tools/check-bike-levels.ts    prints every level's times on every bike and suggests par times
tools/bike-levels.ts          the computer rider's riding styles, shared by the level checker and its test
tests/bike-race-levels.test.ts   every bike finishes every level in all seven riding styles
tests/bike-race-pieces.test.ts   the editor's pieces and edits, and that tracks made of them can be ridden
tests/browser/bike-race.test.ts          phone-sized browser tests for the garage and the sheets around it
tests/browser/bike-race-editor.test.ts   phone-sized browser tests for the level editor
tests/browser/bike-race-online.test.ts   live races between phones in the browser, and the no-server fallback
tests/race-server.test.ts     the race server's messages, without a browser
tests/race-lobby.test.ts      the rooms on Effect's TestClock: whole races with the real timings, no waiting
tests/bike-race-net.test.ts   the game's reconnect schedule, on a TestClock
tools/render-bike-race-card.ts    redraws the menu card picture with the game's own drawing code
```

## How the code fits together

- All six files are ES modules in strict TypeScript and import each other; nothing but the test hooks
  (`window.BikeRace`, `window.BikeRaceEditor`, typed in `globals.d.ts`) is put on `window`.
- `bike-race-core.ts` has no DOM code. Its typed exports (`Level`, `Sim`, `Bike`, `BikeType`, `LevelDef`,
  `BotConfig`, ...) are shared by the game, the editor, the tests and the tools.
  - `buildLevel(world, def)` walks a list of track pieces (`flat`, `hill`, `bumps`, `kicker`, `gap`, `table`,
    `ledge`, `step`, `loop`, `ice`, ...) and returns the terrain, finish line, checkpoints and drawing data.
  - `Sim` steps every bike at a fixed 1/120 s with 5 substeps. `Bike` is a chassis plus two sprung wheels, and
    crashes when the head or body hits the ground or the bike falls into a pit or lava. On a crash `bike.loose`
    turns the springs off, so the wheels and the frame tumble on their own (the frame gets two extra hit circles,
    `WRECK_HULLS`), and the rider becomes a separate body (`bike.rider`).
  - Bike input is `{ gas, brake, lean }`, with lean from -1 (forward) to 1 (back). Tilt gives values in between.
  - Leaning sets the spin rate (see `Bike.step`). In the air the bike's spin follows input × `leanMaxW` within
    1/`AIR_SNAP` s (about 0.02 s), and with no input it stops; air means both wheels off the ground for 0.06 s.
    On the ground, while leaning, it pushes towards `GROUND_SPIN` (55%) of that rate, never harder than the
    bike's `lean`, so wheelies come up at a steady rate; with no lean the ground and springs decide.
  - Braking slows both wheels. Once the bike is stopped or rolling back on the ground, holding the brake (without
    gas) drives the back wheel backwards, up to `REVERSE` (15%) of top speed.
  - Bikes report what happened through `bike.events` (flip, land, crash, finish).
  - `botInput(bike, cfg)` is the computer rider. The level checker, the menu background rider, `?autopilot`
    and the computer racers all use it.
  - Ghosts are 20 frames a second of `[x, y, angle]`, packed by `encodeGhost` / `decodeGhost`.
- `bike-race-art.ts` only draws. It takes a `Camera` and plain poses (`BikePose`), and never touches
  the simulation.
  - The track is a thin line (`theme.line` with a darker `theme.lineEdge`, plus a pale `halo` on the dark moon
    and magma worlds) over the backdrop. Nothing is filled in under it. Ice stretches are pale blue. Pit walls and
    floors are left out, so a pit is a break in the line; lava is a pool drawn in the gap after the bikes
    (`drawHazards`), so a bike sinks into it. Loops are circles of the same line.
  - Each world in `THEMES` is a sky (two or three colours, a sun or planet, clouds, stars or sparks) and four
    flat parallax layers that run to the bottom of the screen. Layer fields are listed above `THEMES`: ridge
    shape (`peaks` for pointed mountains with optional snow `caps`, `flat` for plateaus, `round` for hills), a top
    and bottom colour, a lit `rim`, and a `deco` drawn along the ridge (trees, windmills, arches, rock columns,
    pines, domes, aerials, craters, chimneys, a volcano, glowing cracks).
  - The finish is one pole with a chequered flag that ripples. The start has a small post.
- The camera (`followCamera` in `bike-race.ts`) zooms out a little in the air and, when the ground below is far
  away (a big jump or drop), pulls back and lowers itself so the landing stays on screen.
- `bike-race.ts` owns everything else and is the game the hub shows (`show`, `hide`). A _session_ (`makeSession(mode, levelId)`) holds one
  run: the sim, your bike, the ghost and the phase (`ready`, `countdown`, `run`, `crashed`, `finished`). The modes
  are `solo`, `cpu`, `online` and `attract` (the menu background).
- Tilt lives in the "Input" section of `bike-race.ts`. `tiltAngle(beta, gamma, screenAngle)` works out which way
  is down on the screen from the `deviceorientation` angles, so it reads the steering-wheel turn however far the
  phone is tipped back. Full lean is 14° (`TILT_FULL`), with a 1.5° dead zone around level (`TILT_DEAD`). `tilt.state` is `idle`, `asking`,
  `waiting`, `on`, `denied`, `nosensor` or `insecure`, and `refreshControls()` picks the touch layout from it.

## Garage

The garage opens from the home menu, and from the pause, crash and result sheets during a run. It shows one bike
on a turntable with its perk, a short blurb, four stat bars and whether you ride it. Below are the five bikes;
on the right are your rider name and ten paints. Picks save as soon as they are made.

| Bike    | Stars | Perk        | Tuning (changes from `BASE` in `bike-race-core.ts`)                                          |
| ------- | ----- | ----------- | -------------------------------------------------------------------------------------------- |
| Scout   | 0     | All-rounder | none                                                                                         |
| Hopper  | 10    | Big air     | light, softer long-travel springs, 86% gravity, a bit less grip                              |
| Twister | 25    | Fast flips  | strong, fast lean: a flip takes 0.63 s against 0.82 s                                        |
| Bulldog | 45    | Grip        | heavy, grippy tyres (ice grip 0.55 against 0.28), strong pull, slow lean, falls a bit faster |
| Comet   | 70    | Top speed   | top speed 18 m/s against 15.6, quick off the line, big wheelies, slides on ice               |

There are 90 stars in all. What the computer rider measures on flat ground (top speed, 0 to 10 m/s, time for
one flip at full lean from a standstill in the air, and time and distance in the air off an 8 m long, 2 m high
ramp with no drop after it, taken at 11 m/s):

| Bike    | Top speed | 0–10 m/s | Flip   | Air           |
| ------- | --------- | -------- | ------ | ------------- |
| Scout   | 15.6 m/s  | 1.57 s   | 0.82 s | 0.56 s, 5.7 m |
| Hopper  | 15.6 m/s  | 1.46 s   | 0.82 s | 0.69 s, 7.1 m |
| Twister | 15.6 m/s  | 1.57 s   | 0.63 s | 0.57 s, 5.8 m |
| Bulldog | 15.1 m/s  | 1.39 s   | 0.98 s | 0.54 s, 5.5 m |
| Comet   | 18.0 m/s  | 1.27 s   | 0.82 s | 0.58 s, 5.9 m |

Bulldog climbs an icy hill in 5.3 s where Scout takes 6.9 s. Hopper is the slowest on the moon, because it
floats too long there.

- Bikes live in `BIKES` in `bike-race-core.ts`. Each has `id`, `name`, `stars` (total needed to unlock), `perk`,
  `blurb` and `tune`, which is merged over `BASE`. Two tuning values were added for the garage: `iceMu` (grip on
  ice) and `grav` (multiplies the level's gravity, read through `bike.gravity`).
- `bikeStats(bike)` turns the tuning into the four 0 to 1 bars (Speed, Grip, Flips, Air). `flipTime(tune)` is
  the time for one full flip.
- Looks are in `SHAPES` in `bike-race-art.ts`: tyres, rims, springs, fenders, frame, fairing and how far the
  rider tucks. Paints are `PAINTS` (10 of them).
- Locked bikes are drawn as grey silhouettes with a padlock and "N more stars". Tapping one shakes it.
- A bike you've unlocked but not looked at yet has a "New" tag in the garage, and the home menu's Garage button
  says "New bike!" until you open it. `save.seen` keeps track.
- The result sheet shows a card with the next bike and a progress bar, or "New bike: X!" when the run unlocked
  one. Tapping the card opens the garage on that bike, with a Ride button.
- Leaving the garage goes back where you came from. From the pause sheet, a new bike (or a run that hadn't
  started yet) restarts the level on it. A new paint or name keeps the same paused run. From the crash and
  result sheets, Back returns to that sheet, and Retry or Next level then uses the new bike.
- Garage buttons are hidden during live races, where the bike is fixed for the race.

## Checking levels

```sh
bun tools/check-bike-levels.ts                  # every level with every bike, as a table of times
bun tools/check-bike-levels.ts --robust         # and seven riding styles each (about 20 s)
bun tools/check-bike-levels.ts moon-3 --bike=comet --verbose
bun test tests/bike-race-levels.test.ts         # the same seven styles as a test: every run has to finish
```

It prints each bike's finish time, or where it crashed and on which track piece, and exits with an error if any
bike can't finish any level. A `!` after a time means one of the `--robust` riding styles crashed. A `*` shows a
suggested par that differs from the level list: the starter bike's time plus 0.5 s, rounded up to the next
0.5 s. The pars were set this way, so other bikes beat or miss par by their own handling (Comet beats every par,
Hopper misses most of the moon pars). Run it again, with `--robust`, after changing a track or any bike's tuning.

`--robust` also rides steadier, twitchier, slower and faster lines, so a level that only works for one exact
line shows up. Every bike finishes every level in all seven styles, and `tests/bike-race-levels.test.ts` (part of
`bun test`) keeps it that way. The styles live in `tools/bike-levels.ts`, which both use.

## Browser tests

```sh
bun test tests/browser/bike-race.test.ts                 # about a minute
KEEP_SHOTS=1 bun test tests/browser/bike-race.test.ts    # also saves screenshots to .shots/
```

It runs the server in-process on a free port and opens the game in Bun's headless browser as a touch phone held
sideways. It checks the garage with no stars and with unlocked bikes, that picks survive a reload,
that bad saves are put right, the round trips from the pause, crash and result sheets, the unlock card, that
every bike finishes a level in the page, and that the garage and pause sheet fit without scrolling at six phone
sizes from 568x320 to 932x430. See [development.md](development.md) for what the browser tests need.

```sh
bun test tests/race-server.test.ts                       # the race server on its own (a few seconds)
bun test tests/browser/bike-race-online.test.ts          # live races between phones (about two minutes)
KEEP_SHOTS=1 bun test tests/browser/bike-race-online.test.ts   # also saves screenshots of the room, a race and the results
```

`race-server.test.ts` talks to the server over a WebSocket and the event stream: the page, rooms and codes,
a whole race with results, the closing clock, dropping out and coming back, and the host passing on.
`bike-race-online.test.ts` plays the real page as two phones with the computer rider steering: create a room, join
through the invite link, race, results on both, race again, leave a race, drop the connection mid-race and come
back, the room list, the host leaving. Then the same over https with one phone forced onto the event stream, a
page with no race server (the `bun build` output on a plain static server) falling back to computer riders, and
that the room fits at 568x320. It starts its own servers on free ports.

Address options for testing in a browser:

- `?autopilot` lets the computer rider play every level you start, and skips the "Made for phones" screen.
- `?keyboard` skips the "Made for phones" screen.
- `?net=ws` or `?net=sse` uses only that way of reaching the race server.

## Saved data

Levels made in the editor are kept separately, under `bikerace.levels.v1` (see the editor notes).

`localStorage` key `bikerace.v1` holds best times, stars, settings (ghost, sound, tilt), the chosen bike, paint,
name and `seen` (bikes already looked at in the garage). On load, a saved bike that doesn't exist or isn't
unlocked goes back to Scout, the paint is wrapped into range, and the name loses control characters and is cut
to 16 characters.

Each level's ghost is stored under `bikerace.ghost.v1.<level id>`, for example `bikerace.ghost.v1.clover-1`,
as `{ time, bike, f }`. `bike` is the bike that set it, so the ghost is drawn on that bike, in a pale paint.

## Race server

`server/serve.ts` is one Bun process behind both mise tasks. It serves the page (Bun bundles `public/index.html`
with its scripts, styles and pictures) and runs the rooms, which live in `server/race.ts`. `bun server/serve.ts`
listens on 127.0.0.1:8000 and rebuilds the page when a file changes; `--https` listens on every address on port
8443 with the certificate in `.cert/`, and bundles the page once. `PORT` and `HOST` change either. It prints a
line for each room opened, joined and closed, each race and its results.

The server only keeps rooms and passes messages on. Every phone runs its own bike in its own simulation, sends
its pose 20 times a second, and draws the others from their poses. Bikes don't touch each other.

### Connections

The game connects when Multiplayer opens, and drops the connection when you leave Bike Race.

- A WebSocket at `/ws` first. If it won't open, an event stream from `GET /net/events` (its first message is
  `{ t: 'conn', sid }`) plus `POST /net/send?sid=...` with a JSON array of messages. Both carry the same
  messages. The fallback is there because an iPhone may refuse a WebSocket to a self-signed certificate even
  after the page was allowed. Which one is in use: `Net.transport` (`bike-race-net.ts`).
- The game pings every 5 s. The server drops a connection that says nothing for 30 s; the game drops one that
  hears nothing for 15 s, and checks straight away when the page shows again.
- A dropped connection retries by itself (`Net.retrying`, "Reconnecting…"): six tries, 1, 2, 4, 8 and 8 s apart
  (`reconnectSchedule`), and then it is offline. `welcome` hands out a key, kept in sessionStorage, and `hello`
  sends it back, so the server gives the rider their place back if they return within 45 s (`AWAY`). The same key
  from a second connection takes over and the first gets `replaced`.
- The server refuses a WebSocket or stream from a page on another site (the Origin must match the Host).

### Messages

All are JSON objects with a type in `t`.

| The game sends                         |                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `hello` name, paint, bike, key         | first, and again when the name, paint or bike changes                                               |
| `list`                                 | asks for the open rooms (every 3 s in the lobby)                                                    |
| `create` level · `join` code · `leave` | rooms                                                                                               |
| `level` level · `start`                | host only                                                                                           |
| `state` p, c                           | the pose `[x, y, angle, wheel spin, lean, flags]` (flags: 1 crashed, 2 finished) and the race clock |
| `finish` time · `retire`               | crossed the line, or gave up the race but stays in the room                                         |
| `ping` c                               | answered with `pong`                                                                                |

| The server sends                                               |                                                                                                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `welcome` id, key, resumed, share                              | after the first `hello`; `share` is its Wi-Fi address when it listens there                                                                                       |
| `rooms` rooms                                                  | code, host name, level, count, state                                                                                                                              |
| `room` code, host, level, state, players, racers, ending, last | whenever anything in the room changes; state is `lobby`, `countdown` or `race`; players have id, name, paint, bike, wins, away; `last` is the last race's results |
| `left` · `error` msg · `replaced`                              |                                                                                                                                                                   |
| `countdown` level, racers, seconds                             | the race starts; GO is `seconds` later                                                                                                                            |
| `state` id, p, c                                               | another racer's pose                                                                                                                                              |
| `finished` id, time · `ending` seconds                         | someone crossed the line; the closing clock started                                                                                                               |
| `results` level, results                                       | id, name, paint, bike, time (null for DNF), fastest first                                                                                                         |

### In the game

- `startOnlineRace` makes an `online` session with an entry in `S.remote` for each other racer: a buffer of
  poses, their look from the room, and their finish time.
- Remote poses carry the sender's race clock `c`. `r.off` maps it onto this phone's clock using the quickest
  delivery seen, and `remotePose` draws each rider 0.1 s back in time, blending between the poses either side, so
  network jitter doesn't make bikes stutter.
- A crashed rider's bike is drawn without its rider and faded until they're back at a checkpoint. A rider whose
  poses stop for 3 s fades too.
- Finish times are each phone's own race clock (`bike.time`), so lag never changes a result.
- If the connection was down when the results came, the `last` field of the next `room` message shows them.
- Live race rules on the server: `COUNTDOWN` 3 s, `ENDING` 30 s after the first finish, `RACE_LIMIT` 300 s, six
  riders a room. The browser tests shorten them with the `countdown`, `ending` and `away` options of `startSite`
  (`RaceSettings` in `server/race.ts`); `tests/race-lobby.test.ts` keeps them and runs on a `TestClock` instead.
- The garage buttons are hidden during a live race, since the bike is fixed for the race. `sendProfile()` sends a
  new name, paint or bike to the room.

## Gotchas

- Tilt needs a secure page: https, or localhost on the same device. A phone on plain http over Wi-Fi gets the
  lean buttons.
- `DeviceOrientationEvent.requestPermission()` only works inside a tap or click, so the game calls it from a
  click listener on `#br-app` the first time anything in the game is tapped. Chrome has this function too.
  Headless Chrome answers "denied" unless the test grants the `accelerometer` and `gyroscope` permissions, and
  `DeviceOrientation.setDeviceOrientationOverride` over CDP simulates turning the phone.
- The game and the editor need each other. `bike-race.ts` imports the editor and hands it `editorApi` with
  `Editor.connect()` at load; the editor only imports types from `bike-race.ts`, so there is no import cycle at
  run time.
- `main.ts` routes once every game has loaded. Code that runs on `#bike-race` has to cope with being called after
  load.
- Chrome won't paint an SVG gradient defined inside a hidden element. That's why `#br-app` has its own
  `br-gold` gradient for stars, rather than using the one in `#app`.
- Loops use collision groups. Each loop is two halves, and a bike only collides with the half it should be on.
  See `updateLoops` in the core.
- Never put a kicker right after a table, a ledge or a step down. A fast or floaty bike flies over the gap and
  lands on the kicker's face, which stops it dead or throws it on its head. Leave at least 8 m of flat before the
  next kicker, and 14 m after a 5 m step down. That is why Slag Slide, Core Meltdown, Ember Gauntlet and Eruption
  have the extra flats they do.
- Changing a bike's tuning changes every level for it. Run `bun tools/check-bike-levels.ts --robust` after.
- A phone stops a page in the background, so its bike stops too: a locked screen during a live race pauses that
  rider's clock and bike, and the others see them fade until they come back.
- Invite links use the page's own address. A page opened as localhost would hand out a link nobody else can open,
  so then the game uses the server's Wi-Fi address from `welcome` (only when the server listens on the network).
- A select box is as wide as its longest option unless its panel is `box-sizing: border-box` and the column can
  shrink (`min-width: 0`). That is why `.br-panel` sets both; without them the multiplayer screen scrolled
  sideways at 568 px.

## Menu picture

```sh
bun tools/render-bike-race-card.ts                        # writes public/assets/img/bike-race.jpg
bun tools/render-bike-race-card.ts --level=ember-1 --t=5 --out=/tmp/card.jpg
```

It races three computer riders (Comet, Scout and Twister, held to the same speed so they stay together) on a real
level, stops the clock at `--t` seconds and draws that moment with `bike-race-art.ts` at 1280x960, then saves it
as a 640x480 JPEG. Run it again after changing the art so the card matches the game.

## On a real phone

Everything above is tested in a headless browser posing as a phone. These need a real iPhone and a real Android
phone on `mise run phone`:

- Tilt feel: full lean at 14° and the 1.5° dead zone. Is a full flip easy to start and stop? Too twitchy riding
  along? `TILT_FULL` and `TILT_DEAD` in `bike-race.ts`, and `AIR_SNAP`, `GROUND_SPIN` and each bike's `lean` and
  `leanMaxW` in the core, are the knobs. The springs are `kU`, `cU` and `travelUp` in `BASE`.
- iPhone: the motion permission prompt on the first tap, and what happens after "Don't Allow" (lean arrows and
  the "Motion access is off" line in the pause menu).
- The certificate warning on each phone, then a live race between the two. The room screen shows how each phone
  is connected ("Connected over a WebSocket" or "an event stream") and the ping; on the event stream, check the
  other bike still moves smoothly.
- Locking the screen mid-race and coming back, and switching apps: the run pauses, sound stops and comes back.
- Android: Single player goes fullscreen and locks sideways.
- Sound on iPhone with the ring/silent switch on silent (web audio follows it on some iOS versions).

Known gaps: a rider who joins a room mid-race only sees the room until the next race (no watching), and the
"Your name" field in Multiplayer and the garage name are the same setting shown in two places.
