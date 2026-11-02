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
public/js/main.ts        imports every game and registers it with the hub
public/js/hub.ts         the menu and the #game routing (registerGame, GameHub)
public/js/<game>*.ts     one game each: Ant Sort, Castle Defender, Water Sort
public/js/bike-race*.js  Bike Race, still JavaScript until it is converted (bundled, not type checked)
public/js/globals.d.ts   what the page puts on window (the debug hooks the tests use)
server/serve.ts          Bun.serve: the bundled page, the race server's WebSocket and event stream, https
server/race.ts           Bike Race rooms and races, with no networking in it
tests/*.test.ts          tests that need no browser (game logic, the race server)
tests/browser/*.test.ts  tests that play the real page in a headless browser
tests/support/browser.ts the in-process server and page helpers the browser tests share
tools/                   scripts run by hand: level checks, the Castle Defender balance bot, the Bike Race card
```

`public/tsconfig.json` checks the browser code against the DOM without Bun's types, so a game can't use a Bun API
by mistake. The root `tsconfig.json` checks the rest with Bun's types.

## Packages

`three` is the only package the site uses, bundled into the page. The other two are type declarations:
`@types/three` and `@types/bun`. Bun has everything else built in, so there is nothing else to install: no
TypeScript compiler (`bun check`), formatter (`bun fmt`), test runner (`bun test`), browser automation
(`Bun.WebView`) or web server (`Bun.serve`).

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

`bun fmt` formats with the settings in `bunfig.toml` (120 columns, single quotes). The Bike Race scripts are left
out until they are converted, and so is the Ant Sort level data, which is one long line of numbers.
