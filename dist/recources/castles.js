"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CASTLE_RADIUS = exports.OPENWORLD_CASTLES = void 0;
exports.isNearCastle = isNearCastle;
// MIRROR of client/src/constants/castles.js's OPENWORLD_CASTLES (the
// openworld's castles, placeId 888) - tcp can't import client code, so a
// castle added or moved there has to be changed here too. Only the centres
// matter on this side: enemies don't spawn in or next to a castle
// (genenemy.ts generateEnemies), so their wandering never takes them into one.
exports.OPENWORLD_CASTLES = [
    { name: "castle_hub", x: -29, z: 645 },
    { name: "castle_north", x: 99.9, z: 1601.4 },
    { name: "castle_south", x: 110.6, z: -600 },
    { name: "castle_east", x: 1040.1, z: 356.1 },
    { name: "castle_west", x: -934.4, z: 440 },
];
// Every castle's whole footprint - walls, towers, the terrace they stand on
// and the ramp down from the gate - fits inside this radius of its centre.
// The castles are ~200 wide and ~115 deep since they became the noble houses'
// seats (createcastle.js rollLayout: hx 84-94, hz 46-52, plus walls, terrace
// and a gate ramp of up to ~25): the biggest reaches ~135.
exports.CASTLE_RADIUS = 140;
function isNearCastle(x, z, margin = 0) {
    const reach = exports.CASTLE_RADIUS + margin;
    return exports.OPENWORLD_CASTLES.some(c => (x - c.x) ** 2 + (z - c.z) ** 2 < reach * reach);
}
