# Security audit

An audit of Pick a Game on 2 November 2026, after the move to Bun, TypeScript and Effect. It covers the Bun server,
the Bike Race race server and its protocol, the page, the packages, and the tooling. Each finding has a fix in this
repository unless it says it is accepted.

## Who could attack what

- `mise run app` listens on 127.0.0.1 only, so only programs on the computer reach it, and websites open in a
  browser on the computer (through DNS rebinding, below).
- `mise run phone` listens on every network address over https with a self-signed certificate, so anyone on the
  same Wi-Fi can open the site and join races.
- `mise run build` makes a static site with no race server.
- A rider can run a changed copy of the game and send the race server anything.

Nothing in the site is secret: there are no accounts, passwords or cookies. What is worth protecting is that the
games keep working (for everyone in a race, not just the attacker), that one player can't run code in another
player's page, and that nobody can reach files on the computer running the server.

## Findings

| #   | Severity | Finding                                                                      | Status    |
| --- | -------- | ---------------------------------------------------------------------------- | --------- |
| 1   | Medium   | One device can take every race connection and room, and fill the memory      | Fixed     |
| 2   | Low      | A rider's pose of 1 to 8 numbers is passed on; other games read 6            | Fixed     |
| 3   | Low      | A website open on the same computer can use the race server (DNS rebinding)  | Fixed     |
| 4   | Low      | No Content-Security-Policy behind the hand-escaped HTML                      | To fix    |
| 5   | Low      | Bun's development server runs on any address, not just this computer         | To fix    |
| 6   | Low      | Rider names can carry C1 control characters and text-direction overrides     | Fixed     |
| 7   | Low      | A host can pick a track that doesn't exist, and nobody in the room can race  | Fixed     |
| 8   | Low      | The phone server's certificate is never renewed                              | To fix    |
| 9   | Info     | A POST whose body can't be read fails as a defect, and errors use Bun's page | Fixed     |
| 10  | Info     | Finish times and poses are each rider's own word                             | By design |
| 11  | Info     | Room codes aren't secret                                                     | Accepted  |
| 12  | Info     | Phone mode is open to the whole network, behind a certificate warning        | Accepted  |
| 13  | Info     | No clickjacking or `nosniff` headers on the page                             | Accepted  |
| 14  | Info     | Packages: no known vulnerabilities                                           | Checked   |
| 15  | Info     | What was checked and found sound                                             | Checked   |

### 1. One device can take every race connection and room, and fill the memory (Medium)

The race server allows 300 connections, 200 rooms and 90 messages a second per connection, but nothing per device.
One phone or laptop on the Wi-Fi (or one script) could:

- open all 300 connections, so nobody else can connect ("Too many riders"),
- open a room on each of 200 of them, so nobody else can open one ("This race server is full"),
- connect, say hello and drop, over and over: each rider is kept for 45 s in case they come back, with no limit on how
  many are kept, so memory grows with the rate of reconnecting,
- spend its 90 messages a second on the messages that cost the server most: each `hello` sends the whole room to
  every rider in it, and each `list` sends up to 30 rooms back. Frames that aren't JSON, and POSTs with no messages,
  weren't counted at all.

Fix: at most 16 race connections and 16 riders kept per address (an IPv6 address counts by its /64, as a device can
pick any address in it), at most 1000 riders kept in all, and 20 a second of the 90 for anything but poses. Every
frame and every POST counts, whatever is in it. A refused rider is told why.

### 2. A rider's pose of 1 to 8 numbers is passed on; other games read 6 (Low)

`Pose` in the protocol accepted 1 to 8 finite numbers, and the server passes a pose on to the other racers as it
came. The game reads six (x, y, angle, wheel spin, lean, flags), so a short pose made the other players' games draw
that bike with NaN. Fix: a pose is exactly six finite numbers, for the server and for the game.

### 3. A website open on the same computer can use the race server (Low)

The race server checks that a WebSocket or event stream comes from a page on the same origin, by comparing the
`Origin` header with the `Host` header. A website using DNS rebinding (its own name pointed at 127.0.0.1 after the
page loads) sends a `Host` of its own name, so the check passes. That website could then list the rooms, join them,
see riders' names and race. Fix: the race server only answers when `Host` is an IP address, `localhost` or a name
under it, a name that only means something on a local network (one word, or ending in `.local`, `.lan`,
`.home.arpa` or `.internal`), or the `HOST` the server was started with. A public domain name can't be any of those.

### 4. No Content-Security-Policy behind the hand-escaped HTML (Low)

Bike Race builds parts of its screens as HTML strings, including other riders' names, room codes and the rooms
list. Every one of them goes through `esc()` today, so there is no XSS, but nothing would stop a script if one were
missed later. (Ant Sort put its level names into HTML without escaping them; they are fixed data in the bundle, so
that was safe, but it is escaped now too.) Fix: the page carries a Content-Security-Policy that only lets in
scripts, styles, fonts and pictures from the site itself, and connections to it:

```
default-src 'self'; script-src 'self' blob: 'sha256-…'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; form-action 'none'
```

It is a `<meta>` tag, because Bun serves the bundled page itself and takes no headers for it, and because the static
build needs it too. The exceptions are for the development server: Bun adds one small inline script there (allowed
by its hash) and loads changed modules from `blob:` URLs, which only a script already on the page can make.
`'unsafe-inline'` for styles is for the `style` attributes the screens set, which can't run code. `ws:` and `wss:`
are there because older Safari doesn't count a WebSocket to the same address as `'self'`.

### 5. Bun's development server runs on any address (Low)

`mise run app` runs Bun's development server, which reloads the page as files change and serves Bun's own `/_bun/`
routes (the reload socket, error reports, an open-in-editor route, source maps of the page). It was on whenever
https was off, so `HOST=0.0.0.0 mise run app` put it on the network. Fix: it is only on when the server listens on
this computer alone (127.0.0.1, ::1 or localhost); otherwise the page is bundled once, as for phones.

### 6. Rider names can carry C1 control characters and text-direction overrides (Low)

Names lost the C0 control characters (newlines, escape) and were cut to 16 characters, but kept the C1 controls
(U+0080 to U+009F, where U+009B starts a terminal escape sequence in some terminals) and the Unicode text-direction
overrides (U+202A to U+202E, U+2066 to U+2069). Names go into the server's log and onto every other rider's screen,
so a name could write escape sequences into the server's terminal or show reversed text. Fix: those are removed
too, along with the line and paragraph separators (U+2028, U+2029).

### 7. A host can pick a track that doesn't exist (Low)

The server took any level id shaped like `word-12`. A game refuses to race on a track it doesn't know, so everyone
in the room would wait at "3, 2, 1" for nothing. Fix: the server only takes the ids of real tracks.

### 8. The phone server's certificate is never renewed (Low)

`mise run phone` makes a certificate valid for 825 days and keeps it in `.cert/`. Once it ran out, phones would
refuse the site with an error that can't be clicked past on some phones. Fix: a certificate that has run out, or
runs out within 30 days, or can't be read, is made again when the server starts. `.cert/` is now readable by its
owner only; the key in it already was.

### 9. Errors (Info)

Reading a POST's body used `Effect.promise`, so a body that couldn't be read (the phone went away mid-request) was a
defect, and anything thrown in a request went to Bun's default error response, which on the development server is
a page with the stack trace. Fix: an unreadable body is a 400, and a server error is a plain 500 with no details.

### 10. Finish times and poses are each rider's own word (accepted)

Each phone simulates its own bike, and its finish time is on its own race clock, so that lag never changes results
(docs/bike-race.md). A changed copy of the game can therefore claim any time over 0 and win, or put its bike
anywhere. Stopping that would need the server to simulate every bike, which is a different game. What a rider can't
do is speak for anyone else: the server puts the sender's own id on every pose and finish it passes on, and ignores
any id a message brings.

### 11. Room codes aren't secret (accepted)

Codes are four of 20 letters (160,000 codes), and every connected game sees the open rooms in the list anyway. There
are no private rooms, so there is nothing to guess.

### 12. Phone mode is open to the whole network (accepted)

`mise run phone` listens on every address so phones on the Wi-Fi can reach it, behind a self-signed certificate that
each phone has to accept once. Anyone on the same network can open the site and race. That is the point of it; run
it on a network you trust, not on public Wi-Fi.

### 13. No clickjacking or `nosniff` headers (accepted)

`frame-ancestors` and `X-Content-Type-Options` can only come as headers, and Bun's bundled page takes no headers.
The page has nothing worth tricking someone into clicking in a frame, and Bun sends the right content type for every
file it serves.

### 14. Packages (checked)

`bun audit` finds no known vulnerabilities in the 13 packages. The lockfile pins exact versions with integrity
hashes, `mise run install` installs with `--frozen-lockfile`, and no package runs an install script. `three` is
0.170.0 (0.187.0 is out) and `effect` 4.1.1 (4.1.2 is out); neither has an advisory, so they stay where they are
rather than risk changing how the games look and behave. There are no GitHub Actions workflows, so there is no CI
configuration to attack.

### 15. Checked and sound

- **Files.** The server serves only the bundled page and its files, from memory: nothing maps a URL to a path on
  disk. Requests for `../`, encoded dots, `.cert/key.pem`, `package.json`, the TypeScript sources and Bun's
  `/_bun/src/` all get 404 or 501.
- **The race protocol.** Every message is decoded with a Schema (the server's in `bike-race-protocol.ts`, the game's
  with `ServerMessage`); fields a message doesn't define are dropped, and the server builds every message it sends
  itself, so nothing a rider sends passes through as it came except the checked name, paint, bike, pose and clock.
  JSON decoding doesn't pollute prototypes (`__proto__` stays a plain key).
- **Connections.** WebSockets and event streams must come from a page on the same origin. A WebSocket message is at
  most 16 KB and a POST 64 KB with at most 60 messages; a connection that stops reading is dropped at 512 KB, and one
  that is silent for 30 s is closed. Event stream ids are 96 random bits and resume keys 64, from `crypto`.
- **TLS.** Bun offers TLS 1.2 and 1.3 only, with forward-secret ciphers. The key file is mode 600.
- **The page.** Server messages, saves in localStorage and the address all go through Schemas. Names, room codes and
  level names are escaped wherever they go into HTML, and set as text everywhere else. The debug hooks on `window`
  are only reachable by scripts already on the page.
- **The repository.** No keys, tokens or certificates in the history; `.cert/` is in `.gitignore`.
