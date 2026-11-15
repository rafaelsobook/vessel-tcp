// SAFE ZONES - places the enemies leave you alone.
//
// MIRROR of client/src/constants/places/lumenhold.js's LUMENHOLD_POST.safeZone
// (tcp can't import client code, so a zone moved there has to be changed here
// too). Today there's one: the Leadale guard post on the openworld's southeast
// road, where Brask and Wendle stand at the cart. Talking to them used to be
// interrupted by slimes spawned right beside you.
//
//   - no enemy spawns within `spawnR` of a zone's centre (genenemy.ts's
//     generateEnemies rolls such a spot again; index.ts's openworld top-up
//     drops one that still lands there)
//   - a player inside the zone's box (`half` either side of the centre, the
//     client's guard-post box) can't be made an enemy's target, and stepping
//     into it releases every enemy already after them ("enter-safe-zone")
export type TsafeZone = { name: string, placeId: number, x: number, z: number, half: number, spawnR: number }

export const SAFE_ZONES: TsafeZone[] = [
    { name: "leadale-post", placeId: 888, x: 132, z: 387, half: 18, spawnR: 30 },
]

/** A spot no enemy should spawn on - within spawnR (+ margin) of a zone's centre. */
export function isInSafeSpawnZone(placeId: number, x: number, z: number, margin = 0): boolean {
    return SAFE_ZONES.some(s => s.placeId === placeId && (x - s.x) ** 2 + (z - s.z) ** 2 < (s.spawnR + margin) ** 2)
}

/** Inside a zone's protecting box (+ slack, for a position report that's a moment old). */
export function isInSafeZoneBox(placeId: number, x: number, z: number, slack = 0): boolean {
    return SAFE_ZONES.some(s => s.placeId === placeId && Math.abs(x - s.x) <= s.half + slack && Math.abs(z - s.z) <= s.half + slack)
}
