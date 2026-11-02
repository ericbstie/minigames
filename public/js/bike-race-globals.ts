// Bike Race's core and track pieces are CommonJS-style modules (so the level checkers can require them); the other
// Bike Race scripts find them on window. This goes away when Bike Race is converted to TypeScript.
import core from './bike-race-core';
import pieces from './bike-race-pieces';

window.BikeRaceCore = core;
window.BikeRacePieces = pieces;
