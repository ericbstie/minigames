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
tools/check-bike-levels.js    proves every level can be finished and suggests par times
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

## Checking levels

```sh
node tools/check-bike-levels.js                 # every level with the starter bike
node tools/check-bike-levels.js moon-3 --verbose
node tools/check-bike-levels.js --bike=comet
```

It prints each level's finish time, or where it crashed and on which track piece, and exits with an error if
any level can't be finished. Each finished line shows a suggested par: the starter bike's time plus 0.5 s,
rounded up to the next 0.5 s. The pars in the level list were set this way. Run it again after changing a track
or the bike tuning.

Address options for testing in a browser:

- `?autopilot` lets the computer rider play every level you start, and skips the "Made for phones" screen.
- `?keyboard` skips the "Made for phones" screen.

## Saved data

`localStorage` key `bikerace.v1` holds best times, stars, settings (ghost, sound, tilt), the chosen bike, paint
and name. Each level's ghost is stored under `bikerace.ghost.v1.<level id>`, for example
`bikerace.ghost.v1.clover-1`.

## Not finished yet

`FEATURES` at the top of `bike-race.js` keeps two parts switched off, and their menu buttons say "Coming soon":

- `garage`: the screen to pick one of five bikes (unlocked by total stars) and a paint colour, and set your name.
  The screen and bike tuning are drafted.
- `multiplayer`: live rooms with 4-letter codes, plus races against computer riders when no server is
  reachable. The client side is drafted (`bike-race-net.js` and the "Live races" section of `bike-race.js`).
  It needs a small server that serves `public/` and accepts WebSockets on `/ws`. That server would replace
  `python -m http.server` in `mise.toml`, and should keep an https mode for phones like `mise run phone`.

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
- With the current tuning, the computer rider crashes on magma-6 with `bulldog` and on magma-4 with `comet`.
  The starter bike finishes everything. Check this again when the garage makes those bikes playable.
