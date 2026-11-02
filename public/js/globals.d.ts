// What the page puts on window: the hub (for the games still in plain JavaScript), and the debug hooks the browser
// tests reach for. Shared by public/tsconfig.json and the root tsconfig.json, which checks the tests.
import type { Game, GameHub } from './hub';

declare global {
  interface Window {
    GameHub: typeof GameHub;

    // Castle Defender
    CastleDefender?: Game & { _debug(): any };

    // Water Sort
    WaterSort?: Game;

    // Bike Race (still plain JavaScript)
    BikeRace?: Game & { _debug(): any };
    BikeRaceCore?: any;
    BikeRaceArt?: any;
    BikeRaceNet?: any;
  }
}
