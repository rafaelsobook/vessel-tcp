// MIRROR of client/src/constants/graveyards.js's OPENWORLD_GRAVEYARDS (the
// openworld's graveyards, placeId 888) - tcp can't import client code, so a
// graveyard added, moved or resized there has to be changed here too. Only
// position and areaSize matter on this side: enemyDetails.ts spawns each
// plot's ghosts from them (entrance is the client's business).
export const OPENWORLD_GRAVEYARDS = [
    { position: { x: 412,   z: 255 },  areaSize: 100 },
    { position: { x: 875,   z: 400 },  areaSize: 80 },
    { position: { x: 775,   z: 1125 }, areaSize: 70 },
    { position: { x: -325,  z: 2025 }, areaSize: 60 },
    { position: { x: -50,   z: 1575 }, areaSize: 60 },
    { position: { x: -50,   z: 2850 }, areaSize: 60 },
    { position: { x: 50,    z: 2400 }, areaSize: 50 },
    { position: { x: 325,   z: 1875 }, areaSize: 50 },
    { position: { x: -1750, z: 500 },  areaSize: 50 },
    { position: { x: -1300, z: 625 },  areaSize: 40 },
    { position: { x: 1650,  z: 525 },  areaSize: 40 },
    { position: { x: -825,  z: 600 },  areaSize: 40 },
    { position: { x: 325,   z: 825 },  areaSize: 40 },
]

// how many ghosts haunt a plot - scaled by its area, so the original
// 100-wide plot keeps its 8 and a 40-wide one gets 2 (never fewer)
export function ghostsForGraveyard(areaSize: number): number {
    return Math.max(2, Math.round(areaSize * areaSize / 1250))
}
