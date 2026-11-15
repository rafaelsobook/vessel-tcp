"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFE_ZONES = void 0;
exports.isInSafeSpawnZone = isInSafeSpawnZone;
exports.isInSafeZoneBox = isInSafeZoneBox;
exports.SAFE_ZONES = [
    { name: "leadale-post", placeId: 888, x: 132, z: 387, half: 18, spawnR: 30 },
];
/** A spot no enemy should spawn on - within spawnR (+ margin) of a zone's centre. */
function isInSafeSpawnZone(placeId, x, z, margin = 0) {
    return exports.SAFE_ZONES.some(s => s.placeId === placeId && (x - s.x) ** 2 + (z - s.z) ** 2 < (s.spawnR + margin) ** 2);
}
/** Inside a zone's protecting box (+ slack, for a position report that's a moment old). */
function isInSafeZoneBox(placeId, x, z, slack = 0) {
    return exports.SAFE_ZONES.some(s => s.placeId === placeId && Math.abs(x - s.x) <= s.half + slack && Math.abs(z - s.z) <= s.half + slack);
}
