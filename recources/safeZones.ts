// SAFE ZONES - places the enemies leave you alone.
//
// MIRROR of client/src/tools/safeZones.js (the post: constants/places/lumenhold.js's LUMENHOLD_POST.safeZone;
// the castles: castles.ts here)
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
import { OPENWORLD_CASTLES, CASTLE_RADIUS } from "./castles"

// a box (half either side of the centre), or a castle (its exact walls are the client's; here only its centre)
export type TsafeZone = { name: string, placeId: number, x: number, z: number, half?: number, castle?: boolean, spawnR: number }

// WHO IS SAFE is the client's call: it knows the exact shapes (the post's box, each castle's real walls -
// createcastle.js isInsideCastle) and tells tcp "enter-safe-zone" / "leave-safe-zone", which index.ts keeps
// on the player as insideSafezone. tcp only checks the claim is plausible (isPlausiblySafe: that zone, this
// place, and the player's reported position on its grounds) - so a client can't declare itself safe in an open
// field. WHERE NOTHING SPAWNS is tcp's own: within spawnR of a zone's centre - a castle's whole footprint
// (CASTLE_RADIUS): the openworld's slime top-up used to drop slimes inside the walls round a player
// delivering Vesper's letters.
export const SAFE_ZONES: TsafeZone[] = [
    { name: "leadale-post", placeId: 888, x: 132, z: 387, half: 18, spawnR: 30 },
    ...OPENWORLD_CASTLES.map(c => ({ name: c.name, placeId: 888, x: c.x, z: c.z, castle: true, spawnR: CASTLE_RADIUS })),
]

/** A spot no enemy should spawn on - within spawnR (+ margin) of a zone's centre. */
export function isInSafeSpawnZone(placeId: number, x: number, z: number, margin = 0): boolean {
    return SAFE_ZONES.some(s => s.placeId === placeId && (x - s.x) ** 2 + (z - s.z) ** 2 < (s.spawnR + margin) ** 2)
}

/**
 * Whether a client's "I'm inside zone NAME" can be true for a player at (x, z) in placeId - the post's box
 * (+ slack), or anywhere on a castle's footprint. slack: the reported position is a moment old.
 */
export function isPlausiblySafe(name: string, placeId: number, x: number, z: number, slack = 0): boolean {
    const s = SAFE_ZONES.find(zone => zone.name === name)
    if(!s || s.placeId !== placeId) return false
    if(s.castle) return (x - s.x) ** 2 + (z - s.z) ** 2 <= (s.spawnR + slack) ** 2
    return Math.abs(x - s.x) <= (s.half ?? 0) + slack && Math.abs(z - s.z) <= (s.half ?? 0) + slack
}
