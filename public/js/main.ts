// The page's one script: every game, and the hub that switches between them.
import { GameHub, registerGame } from './hub';
// Still JavaScript while they are converted: these put their show/hide on window.
import './ant-sort.js';
import './castle-defender.js';
import './water-sort.js';
// Bike Race is still plain scripts that share globals, so they load in order after the core is on window.
import './bike-race-globals';
import './bike-race-art.js';
import './bike-race-net.js';
import './bike-race.js';

registerGame('ant', { show: () => window.dispatchEvent(new CustomEvent('game:show', { detail: 'ant' })), hide() {} });
registerGame('castle', window.CastleDefender!);
registerGame('ws', window.WaterSort!);
registerGame('br', window.BikeRace!);

for (const card of document.querySelectorAll<HTMLElement>('.hub-card')) {
  card.addEventListener('click', () => GameHub.open(card.dataset.game!));
}
window.addEventListener('hashchange', () => GameHub.route());
GameHub.route();
