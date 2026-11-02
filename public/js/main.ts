// The page's one script: every game, and the hub that switches between them.
import { Effect } from 'effect';
import * as AntSort from './ant-sort';
import * as BikeRace from './bike-race';
import * as CastleDefender from './castle-defender';
import { GameHub, registerGame, route } from './hub';
import { listen, run } from './page';
import * as WaterSort from './water-sort';

registerGame('ant', AntSort.game);
registerGame('castle', CastleDefender.game);
registerGame('ws', WaterSort.game);
registerGame('br', BikeRace);

// The menu's cards and the address bar, for as long as the page is open
run(
  Effect.scoped(
    Effect.gen(function* () {
      for (const card of document.querySelectorAll<HTMLElement>('.hub-card'))
        yield* listen(card, 'click', () => GameHub.open(card.dataset.game!));
      yield* listen(window, 'hashchange', () => route);
      yield* route;
      return yield* Effect.never;
    }),
  ),
);
