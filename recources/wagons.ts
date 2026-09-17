import { randNumString } from "../tools/tools"

// Openworld (placeId 888) ambient wagon traffic - a harness DEER is the
// primary, driving entity here (client/public/models/monsters/deer.glb,
// the same rig every other deer variant already uses), and the WAGON just
// trails behind it (client/public/models/outdors/wagon.glb - a static,
// non-animated prop, confirmed by grepping the glb's own raw text: no
// "animations" key at all). This used to be the other way around (the
// wagon drove, the deer was parented to/offset ahead of it) - flipped so
// the wagon can orient itself toward wherever the deer's REAL 3D position
// is (client/src/assetcreation/createwagon.js's own positionWagonBehindDeer),
// tilting to match an incline between them instead of always staying dead
// level regardless of slope. It also just makes more physical sense this
// way: the deer (a living thing) is the one that reacts to a tree in its
// path (see resolveHarnessDeerPosition's own comment,
// createharnessdeer.js), not the cart being towed behind it.
//
// Movement is deliberately NOT server-ticked/broadcast the way tcpEnemies'
// own wander interval is (index.ts's setInterval emitting a fresh "enemy-
// wander" waypoint every 5s, trusting the client to dead-reckon between
// them). A deer's own leg is FAR longer (see HARNESS_HALF_DISTANCE below)
// and perfectly regular/non-reactive (no AI beyond the local tree-dodge,
// nothing else to decide) - a waypoint-broadcast model would mean a player
// who joins mid-leg only knows where it WAS at its last waypoint, not where
// it actually is now, and would see it snap back and re-walk the whole
// remaining leg. Instead, each deer's definition below (origin/heading/
// spd/halfDistance/startTime) is the ENTIRE authoritative state -
// client/src/assetcreation/createharnessdeer.js computes its live position
// as a pure function of real-world elapsed time since startTime, so every
// client (regardless of when it joined) computes the exact same position
// independently, with zero ongoing network traffic and zero drift to
// correct. startTime is stamped ONCE, at createHarnessDeer's own call time
// (not per-request) - index.ts's own staggered startup calls this at a
// different moment for each heading on purpose (see its own
// WAGON_STARTUP_STAGGER_MS), so every client that ever receives this same
// deer object (via "userJoined") is deriving position from that SAME
// deer's identical shared epoch, even though different deer now start
// their own epoch at different real times.
//
// heading is a unit vector, not a compass string, so client-side position
// math is a single lerp along it rather than a switch. Axis convention
// confirmed from an existing real reference in this codebase (client/src/
// constants/localroomdb.js's own room-wall comment: "south wall now at
// z:-8") - so +z is north, -z is south, and east/west follow the standard
// right-handed pairing (+x east, -x west) that convention implies.
//
// origin is SPAWN_X/SPAWN_Z (0, 500) - infterrain's own openworld player
// spawn point, the same center every other openworld system (enemyDetails.ts's
// OPENWORLD_SLIME_TERRITORY, index.ts's dynamic slime-spawn interval)
// already anchors around, so these roads cross right through the area
// players/enemies actually populate instead of some arbitrary other spot.
const HARNESS_ORIGIN = { x: 0, z: 500 }
// how far out (one-way) a deer travels before turning back - well inside
// OPENWORLD_SLIME_TERRITORY's own 0-3000 unit range (enemyDetails.ts), so
// the whole round trip stays through terrain players/enemies actually
// populate rather than wandering out to empty, irrelevant space
const HARNESS_HALF_DISTANCE = 1500
// units/sec - a one-way leg takes HALF_DISTANCE/SPD = 100s (~1.7 min), round
// trip ~3.3 min. 3x the original walking-pace value (was 5) - matches
// client/src/assetcreation/createwagon.js's own WAGON_SPD, kept in sync
// manually (same reasoning WAGON_TRAIL_OFFSET_Z below already documents) -
// the wagon's own base velocity has to match this or its correction term
// ends up constantly fighting a mismatched pace instead of just holding
// the trailing offset
const HARNESS_SPD = 15
// how far BEHIND the deer (along its current direction of travel) the
// wagon it's pulling trails - matches client/src/assetcreation/
// createwagon.js's own WAGON_TRAIL_OFFSET_Z, kept in sync manually since
// one lives in TS server data and the other in client positioning code,
// no shared import between them
const WAGON_TRAIL_OFFSET_Z = 6

export type Tharnessdeer = {
    _id: string
    currentPlaceId: number
    name: string
    modelStyle: string
    textureName: string
    origin: { x: number, z: number }
    heading: { x: number, z: number }
    halfDistance: number
    spd: number
    startTime: number
}

// exported - index.ts's own quota-check interval reuses this exact factory
// to top up a missing heading later, instead of a second hand-duplicated
// copy of this shape that could drift out of sync (same reasoning
// ENEMY_GENERATOR_BY_NAME's own reuse of genenemy.ts's real generators
// already follows)
export function createHarnessDeer(headingName: string, heading: { x: number, z: number }): Tharnessdeer {
    return {
        _id: randNumString(),
        currentPlaceId: 888,
        name: `harnessdeer-${headingName}`,
        modelStyle: "deer",
        textureName: "forestdeer",
        origin: HARNESS_ORIGIN,
        heading,
        halfDistance: HARNESS_HALF_DISTANCE,
        spd: HARNESS_SPD,
        startTime: Date.now(),
    }
}

// exported - index.ts's own quota-check interval walks this same
// name->heading map to know what SHOULD exist, rather than a second
// hand-typed copy that could silently drift out of sync with the actual
// starting set below
//
// TEMP: down to just "north" while tracking down the sideways-drift bug -
// easier to watch ONE wagon closely without 3 others cluttering the view.
// The quota-check interval (index.ts) walks this SAME map to decide what
// should exist, so trimming it here (rather than just limiting the
// staggered-startup loop) is what actually keeps the other 3 from getting
// self-healed back in within 10s anyway. Un-comment south/east/west once
// done debugging.
export const WAGON_HEADINGS: Record<string, { x: number, z: number }> = {
    north: { x: 0, z: 1 },
    // south: { x: 0, z: -1 },
    // east: { x: 1, z: 0 },
    // west: { x: -1, z: 0 },
}

// The wagon - now just a follower, carrying NONE of the deer's own movement
// fields. deerId is the only thing tying it to anything - client-side, its
// own position/orientation is derived entirely from wherever that deer
// actually is this exact frame (createwagon.js's own positionWagonBehindDeer),
// never computed independently.
export type Twagon = {
    _id: string
    currentPlaceId: number
    name: string
    modelStyle: string
    deerId: string
    offsetZ: number
}

// exported - index.ts's own quota-check interval reuses this to spawn a
// matching wagon any time it has to top up a missing deer, so a topped-up
// deer never ends up permanently cart-less
export function createWagon(deer: Tharnessdeer): Twagon {
    return {
        _id: randNumString(),
        currentPlaceId: deer.currentPlaceId,
        name: deer.name.replace("harnessdeer-", "wagon-"),
        modelStyle: "wagon",
        deerId: deer._id,
        offsetZ: WAGON_TRAIL_OFFSET_Z,
    }
}

// No more startingHarnessDeer/startingWagons eager arrays - index.ts's own
// startup now spawns each WAGON_HEADINGS entry one at a time, staggered
// (see its own WAGON_STARTUP_STAGGER_MS), reusing createHarnessDeer/
// createWagon exactly the way the quota-check interval already does for a
// topped-up heading, rather than a second hand-built "create all 4 at
// once" path that could drift out of sync with it.
