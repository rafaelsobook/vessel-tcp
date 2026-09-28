import { randNumString } from "../tools/tools"

// Gatherable wheat - client/src/assetcreation/creategrain.js renders each one
// and handles the walk-up + click-to-pick-up flow; index.ts's "pickupGrain"
// handler removes it here once someone takes it.
export type Tgrain = {
    grainId: string
    pos: { x: number, y: number, z: number }
    currentPlaceId: number
}

// village = client localroomdb.js's placeId 1: 300x300 around the origin,
// inner palisade at +-156. Grains go in a strip just inside that wall.
const VILLAGE_PLACE_ID = 1
const VILLAGE_GRAIN_COUNT = 10
const VILLAGE_BORDER_INNER = 128
const VILLAGE_BORDER_OUTER = 146
// every side's gate sits at the middle of that side - keep that stretch clear
const VILLAGE_GATE_CLEARANCE = 14

// openworld = placeId 888, centered on the player spawn (0, 500) - the same
// center enemyDetails.ts's OPENWORLD_ENEMY_BANDS use. Uniform-distance
// sampling packs clusters denser near spawn, thinner toward the edge.
// The whole list rides in every "userJoined" broadcast, so raising the
// cluster count also grows that payload for every client on every join.
const OPENWORLD_PLACE_ID = 888
const OPENWORLD_CENTER = { x: 0, z: 500 }
const OPENWORLD_CLUSTER_COUNT = 50
const OPENWORLD_MIN_DIST = 40
const OPENWORLD_MAX_DIST = 2400
// createcastle.js places the castle at (0, 600)
const CASTLE_POS = { x: 0, z: 600 }
const CASTLE_CLEARANCE = 60
const GRAINS_PER_CLUSTER = 10
const CLUSTER_RADIUS = 4

function randRange(min: number, max: number): number {
    return min + Math.random() * (max - min)
}
function randSign(): number {
    return Math.random() < 0.5 ? -1 : 1
}
function round2(n: number): number {
    return Math.round(n * 100) / 100
}

// y stays 0 - tcp has no terrain, so the client grounds each grain itself
// (worldsocket.js's reCreateMeshesInScene samples the openworld terrain)
function makeGrain(x: number, z: number, currentPlaceId: number): Tgrain {
    return { grainId: randNumString(), pos: { x: round2(x), y: 0, z: round2(z) }, currentPlaceId }
}

function villageBorderGrains(): Tgrain[] {
    const grains: Tgrain[] = []
    for(let i = 0; i < VILLAGE_GRAIN_COUNT; i++){
        const depth = randRange(VILLAGE_BORDER_INNER, VILLAGE_BORDER_OUTER) * randSign()
        const along = randRange(VILLAGE_GATE_CLEARANCE, VILLAGE_BORDER_INNER) * randSign()
        const onXSide = Math.random() < 0.5
        grains.push(onXSide
            ? makeGrain(depth, along, VILLAGE_PLACE_ID)
            : makeGrain(along, depth, VILLAGE_PLACE_ID))
    }
    return grains
}

function openworldGrainClusters(): Tgrain[] {
    const grains: Tgrain[] = []
    let clusters = 0
    while(clusters < OPENWORLD_CLUSTER_COUNT){
        const angle = Math.random() * Math.PI * 2
        const dist = randRange(OPENWORLD_MIN_DIST, OPENWORLD_MAX_DIST)
        const cx = OPENWORLD_CENTER.x + Math.cos(angle) * dist
        const cz = OPENWORLD_CENTER.z + Math.sin(angle) * dist
        if(Math.hypot(cx - CASTLE_POS.x, cz - CASTLE_POS.z) < CASTLE_CLEARANCE) continue

        for(let i = 0; i < GRAINS_PER_CLUSTER; i++){
            const a = Math.random() * Math.PI * 2
            // sqrt keeps the scatter even across the disc instead of bunching at its center
            const r = Math.sqrt(Math.random()) * CLUSTER_RADIUS
            grains.push(makeGrain(cx + Math.cos(a) * r, cz + Math.sin(a) * r, OPENWORLD_PLACE_ID))
        }
        clusters++
    }
    return grains
}

export const startingGrains: Tgrain[] = [
    ...villageBorderGrains(),
    ...openworldGrainClusters(),
]
