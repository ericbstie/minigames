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

## Trying it on a phone

```sh
mise run phone
```

This serves the site over https on your Wi-Fi and prints the address to open on the phone (port 8443). It makes
a self-signed certificate in `.cert/` the first time, using the `openssl` command, so the phone warns that the
connection is not private. That is expected here: tap "Advanced" then "Proceed" on Android, or "Show Details"
then "visit this website" on iPhone. `mise run app` works too, but over plain http from a phone it falls back
to the lean buttons.

## Files

```
public/js/bike-race-core.js   physics, track builder, worlds and levels, bikes, computer rider, ghost encoding
public/js/bike-race-art.js    canvas drawing: themes, skies, parallax, terrain, props, loops, bikes, riders, particles
public/js/bike-race-net.js    WebSocket client for live races (not switched on yet)
public/js/bike-race.js        the game: saves, sound, tilt and touch input, camera and loop, sessions, HUD, menus
public/index.html             #br-app markup (canvas, HUD, touch areas, screens, modals) and the script tags
public/css/styles.css         the "Bike Race" section, all classes start with br-
public/js/hub.js              routes #bike-race and #bike-race/<code> to the game
public/assets/img/bike-race.jpg   menu card picture
tools/check-bike-levels.js    proves every bike can finish every level and suggests par times
tools/test-bike-race-browser.js   phone-sized browser tests for the garage and the sheets around it
tools/phone-server.py         the https server behind `mise run phone`
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

It serves `public/` on port 8123 (`BR_PORT` changes it) and opens the game in headless Chromium as a touch
phone held sideways. It checks the garage with no stars and with unlocked bikes, that picks survive a reload,
that bad saves are put right, the round trips from the pause, crash and result sheets, the unlock card, that
every bike finishes a level in the page, and that the garage and pause sheet fit without scrolling at six phone
sizes from 568x320 to 932x430. It needs Playwright (`require('playwright')`).

Address options for testing in a browser:

- `?autopilot` lets the computer rider play every level you start, and skips the "Made for phones" screen.
- `?keyboard` skips the "Made for phones" screen.

## Saved data

`localStorage` key `bikerace.v1` holds best times, stars, settings (ghost, sound, tilt), the chosen bike, paint,
name and `seen` (bikes already looked at in the garage). On load, a saved bike that doesn't exist or isn't
unlocked goes back to Scout, the paint is wrapped into range, and the name loses control characters and is cut
to 16 characters.

Each level's ghost is stored under `bikerace.ghost.v1.<level id>`, for example `bikerace.ghost.v1.clover-1`,
as `{ time, bike, f }`. `bike` is the bike that set it, so the ghost is drawn on that bike, in a pale paint.

## Not finished yet: live races (step 4)

`FEATURES` at the top of `bike-race.js` is `{ garage: true, multiplayer: false }`. With `multiplayer` off, the
home menu's Multiplayer button says "Coming soon".

What step 4 needs:

- A race server that serves `public/` and accepts WebSockets on `/ws`. It replaces `python -m http.server` in
  `mise run app`, and needs an https mode for phones, like `mise run phone`. `tools/phone-server.py` already
  makes the self-signed certificate in `.cert/` and finds the Wi-Fi address, so reuse that logic.
- Rooms with 4-letter codes. `hub.js` already routes `#bike-race/<code>` to the game, so a shared link joins.
- Races against computer riders when no server is reachable. The `cpu` session mode and `botInput` exist.
- The client side is drafted and untested against a server: `bike-race-net.js` (connects to `/ws` on the same
  host, `wss:` on https, gives up after 4 s) and the "Live races" section of `bike-race.js`.
  - It sends `hello` (name, paint, bike), `list`, `create` (level), `join` (code), `leave`, `level`, `start`,
    `state` (position about 20 times a second) and `finish` (time).
  - It expects `welcome`, `rooms`, `room`, `left`, `error`, `countdown`, `state`, `finished` and `results`.
- The garage is already wired for it: `sendProfile()` resends name, paint and bike when any of them change, and
  the garage buttons are hidden during an online race.

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
