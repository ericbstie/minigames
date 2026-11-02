# Developing Pick a Game

Everything runs on [Bun](https://bun.com): the server, the bundler, the tests, the type checker and the formatter.
mise installs the Bun version pinned in `mise.toml`, so `mise run <task>` is all you need.

## Tasks

| Task             | What it does                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `mise run app`   | Serves the site and the Bike Race race server on http://localhost:8000. The page is rebuilt when a file changes and the browser reloads. |
| `mise run phone` | The same over https on your Wi-Fi (port 8443), so phones get tilt. See [bike-race.md](bike-race.md).                                     |
| `mise run build` | Builds the site into `dist/` for any static host. There is no race server there, so Bike Race offers computer riders.                    |
| `mise run test`  | Every test, including the ones that play the games in a headless browser.                                                                |
| `mise run check` | Type checks the server, tests and tools, then the browser code.                                                                          |
| `mise run fmt`   | Formats everything with `bun fmt`.                                                                                                       |
| `mise run ci`    | Formatting, types and tests: what a pull request has to pass.                                                                            |

Each task runs `bun install` first. Without mise, the same commands work with Bun on its own: `bun install`,
`bun server/serve.ts`, `bun test`, `bun check`, `bun fmt`.

## Layout

```
public/index.html        the page; its one script is js/main.ts, which Bun bundles with the CSS and pictures
public/js/main.ts        imports every game, registers it with the hub, and starts the routing
public/js/hub.ts         the menu and the #game routing (registerGame, GameHub); each game runs in a scope
public/js/page.ts        the page's Effect services and helpers: saves, listeners, frame loops, run
public/js/<game>*.ts     one game each: Ant Sort, Bike Race, Castle Defender, Water Sort
public/js/bike-race-protocol.ts  the race messages as Schemas, shared by the game and the server
public/js/globals.d.ts   what the page puts on window (the debug hooks the tests use)
server/serve.ts          Bun.serve: the bundled page, the race server's WebSocket and event stream, https
server/race.ts           Bike Race rooms and races (the RaceLobby service), with no networking in it
tests/*.test.ts          tests that need no browser (game logic, the race server, the rooms on a TestClock)
tests/browser/*.test.ts  tests that play the real page in a headless browser
tests/support/browser.ts the in-process server and page helpers the browser tests share
tools/                   scripts run by hand: level checks, the Castle Defender balance bot, the Bike Race card
```

`public/tsconfig.json` checks the browser code against the DOM without Bun's types, so a game can't use a Bun API
by mistake. The root `tsconfig.json` checks the rest with Bun's types.

## Packages

The site uses two packages: `effect` (see below), which has no dependencies of its own, and `three` for Castle
Defender and Ant Sort's 3D. Both are bundled into the page. The other two are type declarations: `@types/three` and
`@types/bun`. Bun has everything else built in, so there is nothing else to install: no TypeScript compiler
(`bun check`), formatter (`bun fmt`), test runner (`bun test`), browser automation (`Bun.WebView`) or web server
(`Bun.serve`). The `@effect/platform-*` packages are left out on purpose: `server/serve.ts` holds `Bun.serve` in a
scope itself, which is all they would do for us.

## Effect

The site is written with [Effect](https://effect.website) 4. Effect handles every side effect and how the parts
fit together: the server, the network, saved data, timers, input listeners, game loops, and what happens when a
game opens and closes. The game rules, physics and drawing stay plain functions, called from inside those effects:
wrapping per-frame maths in Effect would cost frame rate and gain nothing. The package ships its own guides in
`node_modules/effect/ai-docs/` and its source in `node_modules/effect/src/`.

- **Server.** `server/serve.ts` builds `SiteServer`, which is `Bun.serve` held open by a scope, on top of
  `RaceLobby` (`server/race.ts`), which holds the rooms. Bun's callbacks run effects with the services the server
  was built with. `main` reads `PORT` and `HOST` with `Config`, turns its failures into tagged errors
  (`ListenError`, `CertificateError`) with plain messages, and runs until Ctrl+C interrupts it.
- **The race protocol.** `public/js/bike-race-protocol.ts` has every message as a Schema. The server decodes what a
  game sends with it (forgiving a missing name or bike, refusing a pose that makes no sense) and the game decodes
  what the server sends.
- **Timers are fibers.** A countdown is `Effect.sleep` and then the work, forked into the scope it belongs to (a
  room's timers, a game's visit). Cancelling one is interrupting it, and closing the scope stops them all. The
  server reads the time from `Clock`, so `tests/race-lobby.test.ts` runs whole races on a `TestClock`.
- **The page.** `public/js/page.ts` has the services (`Saves` for localStorage and `SessionSaves` for
  sessionStorage, both Effect's `KeyValueStore`) and the helpers: `load` and `save` for saved data, `listen` for an
  event listener that goes when its scope closes, `animate` for a frame loop, and `run` to run an effect from plain
  code. `main.ts` routes with `listen` and the hub.
- **Games are scoped.** A game registers a `Game` with the hub: an `open` effect that the hub runs in a fresh scope
  when the player arrives, and closes when they leave. Whatever `open` sets up with `listen`, `animate` or a forked
  fiber stops then, so nothing keeps running behind the menu. `reroute` handles a new address while the game is
  open (Bike Race's `#bike-race/CODE`).

Conventions:

- Anything from outside goes through a Schema: network messages, saved data, the address. A saved value that doesn't
  fit gives the defaults, as a broken save always did. A saved-data schema lists every field, because decoding
  drops fields it doesn't know, and the next save would lose them. Save keys and the JSON under them stay as they
  are, so players keep their progress.
- Services are `Context.Service` classes with a `layer`; settings with a default are a `Context.Reference`. Errors
  are `Schema.TaggedError` classes, handled with `catchTag`; a defect in one message or one frame is logged and the
  rest carries on.
- No `setTimeout`, `setInterval` or `addEventListener` outside `page.ts`: use a forked `Effect.sleep`, `listen` and
  `animate`, in the scope they belong to. `requestAnimationFrame` only inside `animate` and `nextFrame`.
- Per-frame code stays plain: a frame step is a function, not an effect, and draws or steps without allocating
  fibers. Plain code that needs an effect (saving after a win, say) returns it from a `listen` handler or passes it
  to `run`.
- Tests run effects with `Effect.runPromise` under `bun test`, with `TestClock` from `effect/testing` for anything
  timed. `tests/support/browser.ts` builds the real server with `ManagedRuntime`.

## Tests

```sh
mise run test                                      # everything, about six minutes
bun test tests/race-server.test.ts                 # one file
bun test --test-name-pattern garage                # tests whose name matches
KEEP_SHOTS=1 bun test tests/browser                # and keep screenshots in .shots/
```

The browser tests use `Bun.WebView`, Bun's built-in headless browser. On Linux and Windows it drives an installed
Chrome, Chromium, Edge or Brave (set `BUN_CHROME_PATH` if Bun can't find one); on macOS it uses Safari's WebKit
unless told otherwise, and the tests ask for Chrome because they use the DevTools protocol for touch and phone
screens. Each page opens on its own origin (`p1.localhost`, `p2.localhost`, ...), so every page starts with
empty storage, like a fresh browser profile.

## Types and lint

`bun check` is TypeScript's own checker, built into Bun. The tsconfig turns on strict mode and the checks that
work as lint rules: unused variables and parameters, missing returns, switch fall-through, unreachable code.
Bun's documentation also describes a built-in `bun lint`, but Bun 1.4.4 (the current release) doesn't ship it
yet. When a release has it, add it to the `check` and `ci` tasks.

## Formatting

`bun fmt` formats with the settings in `bunfig.toml` (120 columns, single quotes): the code, the page, the styles
and the docs. Only the Ant Sort level data is left out, as it is one long line of numbers.
