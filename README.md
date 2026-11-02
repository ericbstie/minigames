# Pick a Game

Four browser minigames: Ant Sort, Castle Defender, Water Sort and Bike Race (made for phones).

## Run

Requires [mise](https://mise.jdx.dev).

```sh
mise trust
mise run app
```

Then open http://localhost:8000. To have the page rebuilt as you edit the games, run `mise run dev` instead.

To play Bike Race with tilt on a phone, run `mise run phone` and open the address it prints on the phone.
More in [docs/bike-race.md](docs/bike-race.md).

The site is hosted at https://minigames.ericbs.dev: `mise run app` behind Caddy, as [docs/hosting.md](docs/hosting.md) describes.
