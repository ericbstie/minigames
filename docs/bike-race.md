# Bike Race

A 2D physics motorbike game for phones, the fourth game on the Pick a Game menu (`#bike-race`). It follows the
genre (throttle, lean, flips, head-first crashes, timed runs, stars, ghosts) with its own art, worlds and menus.

## Playing

Hold the phone sideways. Turn it like a steering wheel to lean the bike: anticlockwise leans back, clockwise
leans forward. Hold the right half of the screen for gas and the left half to brake.

Five worlds with six levels each: Clover Hills, Ember Canyon, Frostbite Pass (ice), Crater Moon (low gravity and
loops) and Magma Works (lava). Finish a level to open the next one, and finish a world to open the next world.

- Three stars for beating par, two for finishing within 30% of par, one for finishing.
- Each landed flip takes 0.5 s off the clock.
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
keyboard" button is for testing: ↑ ride, ↓ brake, ← lean back, → lean forward, R restart, Esc pause.

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
- If the host leaves, the next rider to have joined becomes host.
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
public/js/bike-race-core.js   physics, track builder, worlds and levels, bikes, computer rider, ghost encoding
public/js/bike-race-art.js    canvas drawing: themes, skies, parallax, terrain, props, loops, bikes, riders, particles
public/js/bike-race-net.js    the connection to the race server: WebSocket or event stream, reconnecting
public/js/bike-race.js        the game: saves, sound, tilt and touch input, camera and loop, sessions, HUD, menus
public/index.html             #br-app markup (canvas, HUD, touch areas, screens, modals) and the script tags
public/css/styles.css         the "Bike Race" section, all classes start with br-
public/js/hub.js              routes #bike-race and #bike-race/<code> to the game
public/assets/img/bike-race.jpg   menu card picture
tools/serve.py                the site server and race server behind `mise run app` and `mise run phone`
tools/check-bike-levels.js    proves every bike can finish every level and suggests par times
tools/test-bike-race-browser.js   phone-sized browser tests for the garage and the sheets around it
tools/test-bike-race-online.js    live races between phones in the browser, and the no-server fallback
tools/test-race-server.js     the race server's messages, without a browser
```

## How the code fits together

- `bike-race-core.js` has no DOM code. It loads in the page as `window.BikeRaceCore` and in Node with `require`.
  - `buildLevel(world, def)` walks a list of track pieces (`flat`, `hill`, `bumps`, `kicker`, `gap`, `table`,
    `ledge`, `step`, `loop`, `ice`, ...) and returns the terrain, finish line, checkpoints and drawing data.
  - `Sim` steps every bike at a fixed 1/120 s with 5 substeps. `Bike` is a chassis plus two sprung wheels, and
    crashes when the head or body hits the ground or the bike falls into a pit or lava.
  - Bike input is `{ gas, brake, lean }`, with lean from -1 (forward) to 1 (back). Tilt gives values in between.
  - Bikes report what happened through `bike.events` (flip, land, crash, finish).
  - `botInput(bike, cfg)` is the computer rider. The level checker, the menu background rider, `?autopilot`
    and the computer racers all use it.
  - Ghosts are 20 frames a second of `[x, y, angle]`, packed by `encodeGhost` / `decodeGhost`.
- `bike-race-art.js` (`window.BikeRaceArt`) only draws. It takes a `Camera` and plain poses, and never touches
  the simulation.
- `bike-race.js` (`window.BikeRace`) owns everything else. A *session* (`makeSession(mode, levelId)`) holds one
  run: the sim, your bike, the ghost and the phase (`ready`, `countdown`, `run`, `crashed`, `finished`). The modes
  are `solo`, `cpu`, `online` and `attract` (the menu background).
- Tilt lives in the "Input" section of `bike-race.js`. `tiltAngle(beta, gamma, screenAngle)` works out which way
  is down on the screen from the `deviceorientation` angles, so it reads the steering-wheel turn however far the
  phone is tipped back. Full lean is 24°, with a 2.5° dead zone around level. `tilt.state` is `idle`, `asking`,
  `waiting`, `on`, `denied`, `nosensor` or `insecure`, and `refreshControls()` picks the touch layout from it.

## Garage

The garage opens from the home menu, and from the pause, crash and result sheets during a run. It shows one bike
on a turntable with its perk, a short blurb, four stat bars and whether you ride it. Below are the five bikes;
on the right are your rider name and ten paints. Picks save as soon as they are made.

| Bike | Stars | Perk | Tuning (changes from `BASE` in `bike-race-core.js`) |
|---|---|---|---|
| Scout | 0 | All-rounder | none |
| Hopper | 10 | Big air | light, soft long-travel springs, 86% gravity, a bit less grip |
| Twister | 25 | Fast flips | strong, fast lean: a flip takes 0.94 s against 1.32 s |
| Bulldog | 45 | Grip | heavy, grippy tyres (ice grip 0.55 against 0.28), strong pull, slow lean, falls a bit faster |
| Comet | 70 | Top speed | top speed 18 m/s against 15.6, quick off the line, big wheelies, slides on ice |

There are 90 stars in all. What the computer rider measures on flat ground (top speed, 0 to 10 m/s, time for
one flip, and time and distance in the air off an 8 m long, 2 m high kicker taken at 11 m/s):

| Bike | Top speed | 0–10 m/s | Flip | Air |
|---|---|---|---|---|
| Scout | 15.6 m/s | 1.57 s | 1.32 s | 0.97 s, 8.7 m |
| Hopper | 15.6 m/s | 1.47 s | 1.27 s | 1.10 s, 10.0 m |
| Twister | 15.6 m/s | 1.57 s | 0.94 s | 0.96 s, 8.6 m |
| Bulldog | 15.1 m/s | 1.39 s | 1.42 s | 0.93 s, 8.4 m |
| Comet | 18.0 m/s | 1.27 s | 1.35 s | 0.97 s, 8.8 m |

Bulldog climbs an icy hill in 5.3 s where Scout takes 6.9 s. Hopper is the slowest on the moon, because it
floats too long there.

- Bikes live in `BIKES` in `bike-race-core.js`. Each has `id`, `name`, `stars` (total needed to unlock), `perk`,
  `blurb` and `tune`, which is merged over `BASE`. Two tuning values were added for the garage: `iceMu` (grip on
  ice) and `grav` (multiplies the level's gravity, read through `bike.gravity`).
- `bikeStats(bike)` turns the tuning into the four 0 to 1 bars (Speed, Grip, Flips, Air). `flipTime(tune)` is
  the time for one full flip.
- Looks are in `SHAPES` in `bike-race-art.js`: tyres, rims, springs, fenders, frame, fairing and how far the
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
node tools/check-bike-levels.js                 # every level with every bike, as a table of times
node tools/check-bike-levels.js --robust        # and seven riding styles each (about 20 s)
node tools/check-bike-levels.js moon-3 --bike=comet --verbose
```

It prints each bike's finish time, or where it crashed and on which track piece, and exits with an error if any
bike can't finish any level. A `!` after a time means one of the `--robust` riding styles crashed. A `*` shows a
suggested par that differs from the level list: the starter bike's time plus 0.5 s, rounded up to the next
0.5 s. The pars were set this way, so other bikes beat or miss par by their own handling (Comet beats every par,
Hopper misses most of the moon pars). Run it again, with `--robust`, after changing a track or any bike's tuning.

`--robust` also rides steadier, twitchier, slower and faster lines, so a level that only works for one exact
line shows up. Every bike finishes every level in all seven styles.

## Browser tests

```sh
node tools/test-bike-race-browser.js            # about a minute
node tools/test-bike-race-browser.js --keep     # also saves screenshots to tools/.shots/
```

It serves `public/` with `tools/serve.py` on port 8123 (`BR_PORT` changes it) and opens the game in headless
Chromium as a touch phone held sideways. It checks the garage with no stars and with unlocked bikes, that picks survive a reload,
that bad saves are put right, the round trips from the pause, crash and result sheets, the unlock card, that
every bike finishes a level in the page, and that the garage and pause sheet fit without scrolling at six phone
sizes from 568x320 to 932x430. It needs Playwright (`require('playwright')`).

```sh
node tools/test-race-server.js                  # the race server on its own (about 10 s, Node 22 or newer)
node tools/test-bike-race-online.js             # live races between phones (about two minutes)
node tools/test-bike-race-online.js --keep      # also saves screenshots of the room, a race and the results
```

`test-race-server.js` talks to the server over a WebSocket and the event stream: static files, rooms and codes,
a whole race with results, the closing clock, dropping out and coming back, and the host passing on.
`test-bike-race-online.js` plays the real page as two phones with the computer rider steering: create a room, join
through the invite link, race, results on both, race again, leave a race, drop the connection mid-race and come
back, the room list, the host leaving. Then the same over https with one phone forced onto the event stream, a
page with no race server falling back to computer riders, and that the room fits at 568x320. It starts its own
servers on ports 8126 to 8128.

Address options for testing in a browser:

- `?autopilot` lets the computer rider play every level you start, and skips the "Made for phones" screen.
- `?keyboard` skips the "Made for phones" screen.
- `?net=ws` or `?net=sse` uses only that way of reaching the race server.

## Saved data

`localStorage` key `bikerace.v1` holds best times, stars, settings (ghost, sound, tilt), the chosen bike, paint,
name and `seen` (bikes already looked at in the garage). On load, a saved bike that doesn't exist or isn't
unlocked goes back to Scout, the paint is wrapped into range, and the name loses control characters and is cut
to 16 characters.

Each level's ghost is stored under `bikerace.ghost.v1.<level id>`, for example `bikerace.ghost.v1.clover-1`,
as `{ time, bike, f }`. `bike` is the bike that set it, so the ghost is drawn on that bike, in a pale paint.

## Race server

`tools/serve.py` is one Python process, standard library only, behind both mise tasks. It serves `public/` (with
ETags, so unchanged files come back as 304) and runs the rooms. `python tools/serve.py` listens on
127.0.0.1:8000; `--https` listens on every address on port 8443 with the certificate in `.cert/`. `PORT` and
`HOST` change either. It prints a line for each room opened, joined and closed, each race and its results.

The server only keeps rooms and passes messages on. Every phone runs its own bike in its own simulation, sends
its pose 20 times a second, and draws the others from their poses. Bikes don't touch each other.

### Connections

The game connects when Multiplayer opens, and drops the connection when you leave Bike Race.

- A WebSocket at `/ws` first. If it won't open, an event stream from `GET /net/events` (its first message is
  `{ t: 'conn', sid }`) plus `POST /net/send?sid=...` with a JSON array of messages. Both carry the same
  messages. The fallback is there because an iPhone may refuse a WebSocket to a self-signed certificate even
  after the page was allowed. Which one is in use: `BikeRaceNet.transport`.
- The game pings every 5 s. The server drops a connection that says nothing for 30 s; the game drops one that
  hears nothing for 15 s, and checks straight away when the page shows again.
- A dropped connection retries by itself (`Net.retrying`, "Reconnecting…"). `welcome` hands out a key, kept in
  sessionStorage, and `hello` sends it back, so the server gives the rider their place back if they return within
  45 s (`AWAY`). The same key from a second connection takes over and the first gets `replaced`.
- The server refuses a WebSocket or stream from a page on another site (the Origin must match the Host).

### Messages

All are JSON objects with a type in `t`.

| The game sends | |
|---|---|
| `hello` name, paint, bike, key | first, and again when the name, paint or bike changes |
| `list` | asks for the open rooms (every 3 s in the lobby) |
| `create` level · `join` code · `leave` | rooms |
| `level` level · `start` | host only |
| `state` p, c | the pose `[x, y, angle, wheel spin, lean, flags]` (flags: 1 crashed, 2 finished) and the race clock |
| `finish` time · `retire` | crossed the line, or gave up the race but stays in the room |
| `ping` c | answered with `pong` |

| The server sends | |
|---|---|
| `welcome` id, key, resumed, share | after the first `hello`; `share` is its Wi-Fi address when it listens there |
| `rooms` rooms | code, host name, level, count, state |
| `room` code, host, level, state, players, racers, ending, last | whenever anything in the room changes; state is `lobby`, `countdown` or `race`; players have id, name, paint, bike, wins, away; `last` is the last race's results |
| `left` · `error` msg · `replaced` | |
| `countdown` level, racers, seconds | the race starts; GO is `seconds` later |
| `state` id, p, c | another racer's pose |
| `finished` id, time · `ending` seconds | someone crossed the line; the closing clock started |
| `results` level, results | id, name, paint, bike, time (null for DNF), fastest first |

### In the game

- `startOnlineRace` makes an `online` session with an entry in `S.remote` for each other racer: a buffer of
  poses, their look from the room, and their finish time.
- Remote poses carry the sender's race clock `c`. `r.off` maps it onto this phone's clock using the quickest
  delivery seen, and `remotePose` draws each rider 0.1 s back in time, blending between the poses either side, so
  network jitter doesn't make bikes stutter.
- A crashed rider's bike is drawn without its rider and faded until they're back at a checkpoint. A rider whose
  poses stop for 3 s fades too.
- Finish times are each phone's own race clock (`bike.time` less flip bonuses), so lag never changes a result.
- If the connection was down when the results came, the `last` field of the next `room` message shows them.
- Live race rules on the server: `COUNTDOWN` 3 s, `ENDING` 30 s after the first finish, `RACE_LIMIT` 300 s, six
  riders a room. The tests shorten them with the `BR_COUNTDOWN`, `BR_ENDING` and `BR_AWAY` variables.
- The garage buttons are hidden during a live race, since the bike is fixed for the race. `sendProfile()` sends a
  new name, paint or bike to the room.

## Gotchas

- Tilt needs a secure page: https, or localhost on the same device. A phone on plain http over Wi-Fi gets the
  lean buttons.
- `DeviceOrientationEvent.requestPermission()` only works inside a tap or click, so the game calls it from a
  click listener on `#br-app` the first time anything in the game is tapped. Chrome has this function too.
  Headless Chrome answers "denied" unless the test grants the `accelerometer` and `gyroscope` permissions, and
  `DeviceOrientation.setDeviceOrientationOverride` over CDP simulates turning the phone.
- Script order in `index.html` matters: core, art, net, then `bike-race.js`.
- `hub.js` routes once before the later scripts have loaded, and `main.js` routes again afterwards. Code that
  runs on `#bike-race` has to cope with being called after load.
- Chrome won't paint an SVG gradient defined inside a hidden element. That's why `#br-app` has its own
  `br-gold` gradient for stars, rather than using the one in `#app`.
- Loops use collision groups. Each loop is two halves, and a bike only collides with the half it should be on.
  See `updateLoops` in the core.
- Never put a kicker right after a table or a ledge. A fast or floaty bike flies over the gap and lands on the
  kicker's face, which stops it dead or throws it on its head. Leave at least 8 m of flat before the next kicker.
  That is why Slag Slide, Core Meltdown and Ember Gauntlet have the extra flats they do.
- Changing a bike's tuning changes every level for it. Run `node tools/check-bike-levels.js --robust` after.
- A phone stops a page in the background, so its bike stops too: a locked screen during a live race pauses that
  rider's clock and bike, and the others see them fade until they come back.
- Invite links use the page's own address. A page opened as localhost would hand out a link nobody else can open,
  so then the game uses the server's Wi-Fi address from `welcome` (only when the server listens on the network).
- A select box is as wide as its longest option unless its panel is `box-sizing: border-box` and the column can
  shrink (`min-width: 0`). That is why `.br-panel` sets both; without them the multiplayer screen scrolled
  sideways at 568 px.

## Next: polish and ship (step 5)

Live races are done and tested in headless Chromium, but never on real phones. What step 5 should cover:

- A real phone pass on an iPhone and an Android phone over `mise run phone`: tilt feel (full lean at 24°, the
  2.5° dead zone), the certificate warning flow, and a live race between two phones. Note which transport each
  phone ends up on (`BikeRaceNet.transport` in the console, or add it to the room screen): if iPhones use the
  event stream, check the poses still look smooth.
- A full browser test pass: `node tools/test-bike-race-browser.js`, `node tools/test-bike-race-online.js`,
  `node tools/test-race-server.js` and `node tools/check-bike-levels.js --robust`, plus a look at every screen at
  the six phone sizes the garage test uses.
- The menu picture for the Pick a Game screen (`public/assets/img/bike-race.jpg`) is a render from step 1 of one
  rider and a ghost. It could show a live race now, with riders in different paints and name tags.
- Rough edges seen while building step 4: the room code and track are the only things a rider joining mid-race
  sees (no way to watch the race on); the "Your name" field and the garage name are the same setting in two
  places; a host who drops out keeps the room for 45 s before the next rider can start.

