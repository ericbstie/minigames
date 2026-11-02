// Bike Race's core is a CommonJS-style module (so the level checker can require it); the other Bike Race scripts
// find it on window. This goes away when Bike Race is converted to TypeScript.
import core from './bike-race-core.js';

window.BikeRaceCore = core;
