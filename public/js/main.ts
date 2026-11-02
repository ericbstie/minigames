// The page's one script: every game, and the hub that switches between them.
import * as AntSort from './ant-sort';
import * as BikeRace from './bike-race';
import * as CastleDefender from './castle-defender';
import { GameHub, registerGame } from './hub';
import * as WaterSort from './water-sort';

registerGame('ant', AntSort);
registerGame('castle', CastleDefender);
registerGame('ws', WaterSort);
registerGame('br', BikeRace);

for (const card of document.querySelectorAll<HTMLElement>('.hub-card')) {
  card.addEventListener('click', () => GameHub.open(card.dataset.game!));
}
window.addEventListener('hashchange', () => GameHub.route());
GameHub.route();
