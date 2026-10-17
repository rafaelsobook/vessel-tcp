// MIRROR of client/src/constants/castles.js's OPENWORLD_CASTLES (the
// openworld's castles, placeId 888) - tcp can't import client code, so a
// castle added or moved there has to be changed here too. Only the centres
// matter on this side: enemies don't spawn in or next to a castle
// (genenemy.ts generateEnemies), so their wandering never takes them into one.
export const OPENWORLD_CASTLES = [
    { name: "castle_hub",   x: 0,      z: 600 },
    { name: "castle_north", x: 100.6,  z: 1500 },
    { name: "castle_south", x: 80.6,   z: -600 },
    { name: "castle_east",  x: 1000.6, z: 380 },
    { name: "castle_west",  x: -974.4, z: 480 },
]

// Every castle's whole footprint - walls, towers, the terrace they stand on
// and the ramp down from the gate - fits inside this radius of its centre.
// createcastle.js sizes each castle to fit its palace; the biggest of the five
// (castle_north, with the longest gate ramp) reaches 69.
export const CASTLE_RADIUS = 72

export function isNearCastle(x: number, z: number, margin = 0): boolean {
    const reach = CASTLE_RADIUS + margin
    return OPENWORLD_CASTLES.some(c => (x - c.x) ** 2 + (z - c.z) ** 2 < reach * reach)
}
