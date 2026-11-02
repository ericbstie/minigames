# Hosting Pick a Game

The site is at https://minigames.ericbs.dev. `mise run app` serves it: the page, bundled once when the server
starts, and the Bike Race race server, over plain http on 127.0.0.1:8000. [Caddy](https://caddyserver.com), on the
same computer, answers https for minigames.ericbs.dev and passes every request on to it, WebSockets included.

```
browser ──https/wss──▶ Caddy (minigames.ericbs.dev:443) ──http/ws──▶ mise run app (127.0.0.1:8000)
```

## Running it

```sh
git pull
pkill -f 'server/serve.ts'          # stop the one running now, if there is one
mise run app >/dev/null 2>&1 &
disown
```

`mise run app` installs the packages first, so a pull that changes them needs nothing more. The settings are
environment variables:

| Variable        | Default                | What it is                                                                             |
| --------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `PORT`          | `8000`                 | The port to listen on                                                                  |
| `HOST`          | `127.0.0.1`            | The address to listen on. `0.0.0.0` if Caddy runs on another machine or in a container |
| `ALLOWED_HOSTS` | `minigames.ericbs.dev` | The site's public names, separated by commas. Setting it replaces the default          |

`mise run dev` is not for hosting. It is Bun's development server, which rebuilds the page as files change, answers
only to the names of this computer (anything else gets "Blocked: Host header does not match the dev server"), and
has routes of its own under `/_bun/` for the browser on this computer.

## Caddy

```
minigames.ericbs.dev {
	reverse_proxy 127.0.0.1:8000
}
```

That is all it needs. Caddy gets and renews the certificate, passes the `Host` on as the browser sent it, sets
`X-Forwarded-For` to the player's address and `X-Forwarded-Proto` to `https`, passes WebSocket upgrades through, and
sends the event stream on as it comes.

If Cloudflare's proxy (the orange cloud) is in front of Caddy as well, every player reaches Caddy from a Cloudflare
address, and players who come through the same Cloudflare server would share the limits for one device. Then have
Caddy put the player's own address in `X-Forwarded-For`: Cloudflare's addresses in `trusted_proxies`,
`client_ip_headers CF-Connecting-IP`, and `header_up X-Forwarded-For {client_ip}` in the `reverse_proxy` block.

Other proxies work the same way. nginx needs to be told to pass WebSocket upgrades on (`proxy_http_version 1.1`, and
`Upgrade` and `Connection` headers), to add the player's address (`proxy_set_header X-Forwarded-For
$proxy_add_x_forwarded_for`) and to keep idle connections open for at least a minute (`proxy_read_timeout`); the
server already asks it not to buffer the event stream. A Cloudflare Tunnel needs only `service: http://localhost:8000`.

## What the server checks

- **Names.** The page is served for any name, but the race server only answers when the `Host` is one of
  `ALLOWED_HOSTS`, an IP address, `localhost` or a local network name (security audit, finding 3). A proxy that
  puts its own address in `Host` instead, as nginx does unless told not to, is fine too.
- **Origins.** A WebSocket or event stream must come from a page on the same host, or on one of `ALLOWED_HOSTS`.
- **Players.** The limits for one device (16 connections) count each player by their own address. Behind a proxy
  every request comes from the proxy, so the server takes the player's address from the last entry in
  `X-Forwarded-For`, which is the one the proxy adds. It believes that header only from an address on this computer
  or a private network (`127.x`, `10.x`, `172.16-31.x`, `192.168.x`, `::1`, `fc00::/7`, `fe80::/10`), so someone who
  reaches the server directly can't pick an address of their choosing. `mise run phone` never believes it, as phones
  on the Wi-Fi reach it directly.
- **https and wss.** These are Caddy's job. Nothing in the server depends on the scheme, so it has no need of
  `X-Forwarded-Proto`: the page connects with `wss://` because it was loaded over `https://`, and with `ws://` over
  `http://`. The page's Content-Security-Policy allows both (`connect-src 'self' ws: wss:`).

`tests/serve.test.ts` starts the server as `mise run app` and `mise run dev` do and asks for minigames.ericbs.dev as
Caddy passes it on; `tests/browser/hosting.test.ts` has two phones meet in a room at https://minigames.ericbs.dev
through an https proxy (`tests/support/proxy.ts`), one over a secure WebSocket and one over the event stream.

## A static host instead

`mise run build` puts the site in `dist/` for any static host. There is no race server there, so Bike Race offers
races against computer riders instead of live ones.
