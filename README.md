# Pick a Game

A small static website with three browser minigames: **Ant Sort**, **Castle Defender** and **Water Sort**.
There is no build step. Everything the site needs lives in `public/`.

## Run it locally

You need [mise](https://mise.jdx.dev). From the project folder:

```sh
mise trust      # first time only, lets mise read mise.toml
mise run app
```

Then open http://localhost:8000. mise installs the Python version it needs and serves `public/` with
Python's built-in static server.

Options:

- `PORT=3000 mise run app` serves on another port.
- `HOST=0.0.0.0 mise run app` makes it reachable from other devices on your network (for example, to try it on a phone).

The site must be opened through a web server rather than as a `file://` page, because the games load
JavaScript modules.

## Layout

```
public/
  index.html               page markup, the three game screens and the script tags
  css/base.css             base page reset
  css/styles.css           all game styles
  js/hub.js                main menu and hash routing (#ant-sort, #castle-defender, #water-sort)
  js/ant-sort-logic.js     Ant Sort rules
  js/ant-sort-levels.js    Ant Sort level data
  js/ant-sort.js           Ant Sort game (three.js)
  js/castle-defender.js    Castle Defender game (three.js)
  js/water-sort.js         Water Sort game, rules and levels
  js/main.js               wires the menu cards and starts routing
  assets/fonts/            Lilita One and Nunito (woff2)
  assets/img/              menu card pictures
```

The script order in `index.html` matters: the classic scripts share globals, so keep them in the
order they appear.

## Hosting

`public/` can be uploaded as is to any static host, such as GitHub Pages, Netlify, Cloudflare Pages or an
S3 bucket. three.js 0.170.0 is loaded from the jsDelivr CDN through the import map in `index.html`, so players
need an internet connection.

## Progress

Stars and completed levels are saved in the browser's `localStorage`. The cross-device star sync that
worked when this ran as a claude.ai artifact is skipped automatically outside claude.ai.
