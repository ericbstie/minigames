// Main menu routing: #ant-sort, #castle-defender, #water-sort, #bike-race (or #bike-race/CODE to join a room), or
// the menu. Each game registers itself with registerGame; the hub shows one game's screen and hides the others.

export type GameId = 'ant' | 'castle' | 'ws' | 'br';

export interface Game {
  show(): void;
  hide(): void;
}

// The element that holds each game's screen
const SCREENS: Record<GameId, string> = { ant: 'app', castle: 'cd-app', ws: 'ws-app', br: 'br-app' };
const games: Partial<Record<GameId, Game>> = {};

export function registerGame(id: GameId, game: Game): void {
  games[id] = game;
}

function current(): GameId | 'menu' {
  const h = location.hash.slice(1);
  if (h === 'ant-sort') return 'ant';
  if (h === 'castle-defender') return 'castle';
  if (h === 'water-sort') return 'ws';
  if (h === 'bike-race' || h.startsWith('bike-race/')) return 'br';
  return 'menu';
}

export const GameHub = {
  route(): void {
    const game = current();
    document.getElementById('hub')!.hidden = game !== 'menu';
    const ids = Object.keys(SCREENS) as GameId[];
    for (const id of ids) document.getElementById(SCREENS[id])!.hidden = game !== id;
    for (const id of ids) if (id !== game) games[id]?.hide();
    if (game !== 'menu') games[game]?.show();
  },
  open(name: string): void {
    if (location.hash.slice(1) === name) this.route();
    else location.hash = name;
  },
  menu(): void {
    if (location.hash) {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch {
        location.hash = '';
      }
    }
    this.route();
  },
};

// for the browser tests (tests/smoke.test.ts goes back to the menu through it)
window.GameHub = GameHub;
