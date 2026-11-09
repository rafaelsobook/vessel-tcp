"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOWER_SAFE_RADIUS = exports.OPENWORLD_WITCH_TOWERS = void 0;
exports.isNearWitchTower = isNearWitchTower;
// MIRROR of client/src/constants/places/witchTowers.js's TOWER_SPOTS (the three
// witch towers in the openworld, placeId 888) - tcp can't import client code,
// so a tower moved there has to be changed here too. Only the spots matter on
// this side: the strong enemies (the dark slimes, genenemy.ts) don't spawn
// near a tower, so a visit to one - the witches sell the skill books - isn't
// a fight with them.
exports.OPENWORLD_WITCH_TOWERS = [
    { name: "vesper", x: -1857, z: 569 },
    { name: "ilvara", x: 1238, z: 430 },
    { name: "sable", x: -12.5, z: -1418 },
];
// how far from a tower the dark slimes stay away. The client builds an
// openworld enemy within 300 units of the player (worldsocket.js's
// OPENWORLD_ENEMY_CREATE_DIST), so this is enough that none can be seen from
// a tower's door.
exports.TOWER_SAFE_RADIUS = 300;
function isNearWitchTower(x, z, margin = exports.TOWER_SAFE_RADIUS) {
    return exports.OPENWORLD_WITCH_TOWERS.some(t => (x - t.x) ** 2 + (z - t.z) ** 2 < margin * margin);
}
