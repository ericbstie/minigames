// What the page puts on window: the hub (for the games still in plain JavaScript), and the debug hooks the browser
// tests reach for. Shared by public/tsconfig.json and the root tsconfig.json, which checks the tests.
import type { Game, GameHub } from './hub';

declare global {
  interface Window {
    GameHub: typeof GameHub;

    // Castle Defender
    CastleDefender?: Game & { _debug(): import('./castle-defender').CastleDebug };

    // Ant Sort: its state for the browser tests, and a speed beyond the 2x button for them (a software-rendered
    // browser draws a level at a few frames a second)
    AntSort?: {
      _debug(): {
        level: number; // the level being played (from 0), or -1
        over: boolean;
        won: boolean;
        quiet: boolean; // no ant can be sent out until another block is tapped
        remaining: number;
        colPtr: number[];
        slots: ({ c: number; n: number } | null)[];
        ants: number;
        columns: { x: number; y: number; ready: boolean }[]; // where on the page to tap each column's front block
      };
      _speed(k: number): void;
    };

    // Water Sort: its state for the browser tests
    WaterSort?: {
      _debug(): {
        level: number;
        tubes: number[][];
        sel: number;
        busy: boolean; // a pour is still animating
        won: boolean;
        hints: number;
        tubesAt: { x: number; y: number }[]; // the middle of each tube on the page
        addAt: { x: number; y: number } | null; // the + button that unlocks the spare tube
      };
    };

    // Bike Race (still plain JavaScript)
    BikeRace?: Game & { _debug(): any };
    BikeRaceCore?: any;
    BikeRaceArt?: any;
    BikeRaceNet?: any;
    BikeRacePieces?: any;
    BikeRaceEditor?: any;
  }
}
