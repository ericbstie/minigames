// Bike Race's core and track pieces are TypeScript modules; the other Bike Race scripts are still plain JavaScript
// and find them on window. This goes away when the rest of Bike Race is converted to TypeScript.
import * as core from './bike-race-core';
import * as pieces from './bike-race-pieces';

window.BikeRaceCore = core;
window.BikeRacePieces = pieces;
