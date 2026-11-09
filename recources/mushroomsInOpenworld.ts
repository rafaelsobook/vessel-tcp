import { randNumString } from "../tools/tools"
import { rollMushroomKind } from "./mushroomLibrary"
import { isNearCastle } from "./castles"
import { Tmushroom } from "./mushroomsInDungeon"

// Mushrooms out in the open world (placeId 888) - picked exactly like the
// dungeon ones (mushroomsInDungeon.ts): the client's createmushroom.js
// renders them and runs the walk-up + click-to-pick flow, index.ts's
// "pickupMushroom" hands the picker the kind's item. Rolled fresh each server
// start; a picked one grows back where it was (index.ts's MUSHROOM_REGROW_MS).
//
// Clusters ring the player's spawn (0, 500), the centre the openworld's enemy
// bands (enemyDetails.ts) and grain clusters (grains.ts) use. A cluster's kind
// is rolled from mushroomLibrary.ts by how far out it is - distance from the
// spawn plays the part a dungeon's depth does, so the rare kinds only grow far
// out in the wild, where the tougher enemies are.
//
// y stays 0 - tcp has no terrain, so the client grounds each mushroom itself
// (worldsocket.js's reCreateMeshesInScene samples the openworld terrain).
//
// The whole list rides in every "userJoined" broadcast (with the dungeons'
// and the grains), so raising the cluster count grows that payload for every
// client on every join.

const OPENWORLD_PLACE_ID = 888
const OPENWORLD_CENTER = { x: 0, z: 500 }
const CLUSTER_COUNT = 60
// clear of the stone scriptures ringing the spawn 15 out
// (the client's createstonescripture.js), out to the stray wolves' far edge
const MIN_DIST = 40
const MAX_DIST = 3200
// clear of every castle's walls and the ramp up to its gate
const CASTLE_MARGIN = 10
const MUSHROOMS_PER_CLUSTER = { min: 3, max: 6 }
const CLUSTER_RADIUS = 1.6

function randInt(min: number, max: number) {
    return min + Math.floor(Math.random() * (max - min + 1))
}
function round2(n: number) {
    return Math.round(n * 100) / 100
}

function openworldClusters(): Tmushroom[] {
    const mushrooms: Tmushroom[] = []
    let clusters = 0
    while (clusters < CLUSTER_COUNT) {
        const angle = Math.random() * Math.PI * 2
        // uniform in distance, not area - clusters come thicker near the
        // spawn, where most players are, and thin out into the wild
        const dist = MIN_DIST + Math.random() * (MAX_DIST - MIN_DIST)
        const cx = OPENWORLD_CENTER.x + Math.cos(angle) * dist
        const cz = OPENWORLD_CENTER.z + Math.sin(angle) * dist
        if (isNearCastle(cx, cz, CASTLE_MARGIN + CLUSTER_RADIUS)) continue

        // 0 at the spawn's edge .. 1 at the far edge - mushroomLibrary.ts's minDepth
        const { kind } = rollMushroomKind((dist - MIN_DIST) / (MAX_DIST - MIN_DIST))
        const n = randInt(MUSHROOMS_PER_CLUSTER.min, MUSHROOMS_PER_CLUSTER.max)
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2
            // sqrt keeps the scatter even across the disc instead of bunching at its centre
            const r = Math.sqrt(Math.random()) * CLUSTER_RADIUS
            mushrooms.push({
                mushroomId: randNumString(),
                kind,
                pos: { x: round2(cx + Math.cos(a) * r), y: 0, z: round2(cz + Math.sin(a) * r) },
                currentPlaceId: OPENWORLD_PLACE_ID,
            })
        }
        clusters++
    }
    return mushrooms
}

export const OPENWORLD_MUSHROOMS: Tmushroom[] = openworldClusters()
