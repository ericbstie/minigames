// The page's one script: every game, and the hub that switches between them.
import * as AntSort from './ant-sort';
import * as CastleDefender from './castle-defender';
import { GameHub, registerGame } from './hub';
import * as WaterSort from './water-sort';
// Bike Race is still plain scripts that share globals, so they load in order after the core and the track pieces
// are on window.
import './bike-race-globals';
import './bike-race-art.js';
import './bike-race-net.js';
import './bike-race.js';
import './bike-race-editor.js';

registerGame('ant', AntSort);
registerGame('castle', CastleDefender);
registerGame('ws', WaterSort);
registerGame('br', window.BikeRace!);

for (const card of document.querySelectorAll<HTMLElement>('.hub-card')) {
  card.addEventListener('click', () => GameHub.open(card.dataset.game!));
}
window.addEventListener('hashchange', () => GameHub.route());
GameHub.route();
