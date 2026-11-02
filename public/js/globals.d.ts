// What the page puts on window: the hub and the debug hooks the browser tests reach for. The games themselves are
// modules and import each other. Shared by public/tsconfig.json and the root tsconfig.json, which checks the tests.
import type { GameHub } from './hub';

declare global {
  interface Window {
    GameHub: typeof GameHub;

    // Castle Defender: its state for the browser tests and the balance bot (tools/play-castle-defender.ts)
    CastleDefender?: { _debug(): import('./castle-defender').CastleDebug };

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
    // The per-user store, on a page that runs with one: Ant Sort keeps the viewer's stars there. Unknown until checked.
    claude?: unknown;

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

    // Bike Race and its level editor: their state for the browser tests (the game reaches the editor through
    // imports, not these)
    BikeRace?: { editor: import('./bike-race').EditorApi; _debug(): import('./bike-race').BikeRaceDebug };
    BikeRaceEditor?: {
      onView: typeof import('./bike-race-editor').onView;
      frame: typeof import('./bike-race-editor').frame;
      _debug(): import('./bike-race-editor').EditorDebug;
    };
  }
}
