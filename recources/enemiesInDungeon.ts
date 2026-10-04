import { generateBSPDungeon } from "../generate-datas/generatebsp"
import { generateGhosts, generateLesserDemons } from "../generate-datas/genenemy"

// Enemies that live inside the procedural BSP dungeons - where they spawn and
// where they may wander. The server can't see a dungeon's walls, but
// generateBSPDungeon is deterministic: fed the same arguments as the client,
// it returns the exact grid every client renders, so every placement and
// wander target here is checked against the real layout.

// MIRROR of the layout arguments of client/src/constants/localroomdb.js's
// DUNGEON_12 - tcp can't import client code (same arrangement as
// graveyards.ts). Change one side and the other has to follow, or enemies end
// up inside walls. textures/sceneTemp/exitPlaceDetail don't affect the
// layout, so they're left out.
const DUNGEON_12 = generateBSPDungeon({
    placeId: 12,
    seed: 12345,
    rockDensity: 0,
    gridWidth: 32,
    gridHeight: 32,
    cellSize: 4,
    wallHeight: 15,
    corridorWidth: 3,
    bossRoomWidthScale: 2,
})

const DUNGEONS = new Map<number, any>([[12, DUNGEON_12]])

// ghosts per ordinary room: one per this many floor cells, 1 to MAX per room
const CELLS_PER_GHOST = 12
const MAX_GHOSTS_PER_ROOM = 3
// anything higher than this is a raised slab - a wall to walkers (the
// generator's TILE_JITTER_NORMAL.max), so never a spawn or wander spot
const WALKABLE_JITTER = 0.04

type Cell = { x: number, y: number }
// a room in grid cells - what each dungeon enemy keeps as its .homeRoom
type Rect = { x: number, y: number, w: number, h: number }

const cellKey = (c: Cell) => `${c.x}_${c.y}`

function toWorld(dungeon: any, c: Cell) {
    const cs = dungeon.layout.cellSize
    return { x: (c.x + 0.5) * cs, z: (c.y + 0.5) * cs }
}

function rectCells(r: Rect): Cell[] {
    const cells: Cell[] = []
    for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) cells.push({ x, y })
    return cells
}

function bossRect(dungeon: any): Rect {
    const b = dungeon.bossRoom
    return { x: b.gridX, y: b.gridY, w: b.width, h: b.height }
}

// the boss room cells the entrance staircase is cut into (createDungeon's own
// stairKeys) - they slope from the floor up to the dais
function stairKeys(dungeon: any): Set<string> {
    const keys = new Set<string>()
    const { elevation, entrance } = dungeon.bossRoom
    if (!(elevation > 0) || !entrance) return keys
    entrance.cells.forEach((c: Cell) => {
        for (let k = 1; k <= entrance.stairCells; k++) keys.add(cellKey({ x: c.x + entrance.dx * k, y: c.y + entrance.dz * k }))
    })
    return keys
}

// where an enemy of `home` may stand: ordinary rooms - their floor minus
// raised slabs and prop cells; the boss room - its raised dais only
function standableCells(dungeon: any, home: Rect, isBossRoom: boolean): Cell[] {
    if (isBossRoom) {
        const stairs = stairKeys(dungeon)
        return rectCells(home).filter(c => !stairs.has(cellKey(c)))
    }
    const props = new Set((dungeon.props ?? []).map((p: any) => cellKey(p)))
    return rectCells(home).filter(c =>
        dungeon.layout.grid[c.y]?.[c.x] === 1
        && (dungeon.tileHeights[cellKey(c)] ?? 0) <= WALKABLE_JITTER
        && !props.has(cellKey(c)))
}

// floor height of a cell - the dais for the boss room, the tile's own jitter
// elsewhere (createEnemy.js stands a non-openworld enemy at its own y)
function floorY(dungeon: any, c: Cell, isBossRoom: boolean) {
    return isBossRoom ? dungeon.bossRoom.elevation : (dungeon.tileHeights[cellKey(c)] ?? 0)
}

// genenemy's "fixed" generators place one enemy exactly at (x, z) with y 0 -
// lifted onto its cell's real floor here, and tagged with the room it belongs to
function place(enemy: any, dungeon: any, c: Cell, home: Rect, isBossRoom: boolean) {
    const y = floorY(dungeon, c, isBossRoom)
    enemy.y = y
    enemy.origPos = { ...enemy.origPos, y }
    enemy.homeRoom = home
    return enemy
}

function spawnDungeonEnemies(placeId: number, dungeon: any) {
    const enemies: any[] = []
    const boss = bossRect(dungeon)

    // ghosts - every ordinary room, none in the entrance room (rooms[0], where
    // players arrive) or the boss room. Spread evenly through each room's
    // standable cells, so a server restart puts them in the same spots.
    dungeon.rooms.forEach((room: any) => {
        if (room.type === "entrance" || room.type === "boss_room") return
        const home: Rect = { x: room.bounds.x, y: room.bounds.y, w: room.bounds.width, h: room.bounds.height }
        const cells = standableCells(dungeon, home, false)
        if (!cells.length) return
        const count = Math.min(MAX_GHOSTS_PER_ROOM, Math.max(1, Math.round(home.w * home.h / CELLS_PER_GHOST)), cells.length)
        for (let i = 0; i < count; i++) {
            const c = cells[Math.floor((i + 0.5) * cells.length / count)]
            const { x, z } = toWorld(dungeon, c)
            enemies.push(place(generateGhosts(1, placeId, 0, "fixed", x, z)[0], dungeon, c, home, false))
        }
    })

    // boss - the lesser demon, on the dais at the far end from the stairs,
    // facing the way players come up
    const dais = standableCells(dungeon, boss, true)
    const entrance = dungeon.bossRoom.entrance
    if (dais.length && entrance) {
        const centre = { x: boss.x + (boss.w - 1) / 2, y: boss.y + (boss.h - 1) / 2 }
        // how far into the room along the stairs' direction, then how close
        // to the room's centre line across it
        const depth = (c: Cell) => c.x * entrance.dx + c.y * entrance.dz
        const offCentre = (c: Cell) => entrance.dx !== 0 ? Math.abs(c.y - centre.y) : Math.abs(c.x - centre.x)
        const c = dais.reduce((best, cell) =>
            depth(cell) > depth(best) || (depth(cell) === depth(best) && offCentre(cell) < offCentre(best)) ? cell : best)
        const { x, z } = toWorld(dungeon, c)
        const demon = place(generateLesserDemons(1, placeId, 0, "fixed", x, z)[0], dungeon, c, boss, true)
        demon._dirTarg = toWorld(dungeon, { x: c.x - entrance.dx, y: c.y - entrance.dz })
        enemies.push(demon)
    }

    return enemies
}

export const DUNGEON_ENEMIES = [...DUNGEONS].flatMap(([placeId, dungeon]) => spawnDungeonEnemies(placeId, dungeon))

// Where a dungeon enemy wanders next (index.ts's wander tick). Returns
// undefined for an enemy outside any dungeon (the caller uses its normal open
// wander), null when nothing reachable came up this tick (stay put), or a
// world {x, z} within `radius` of its spawn, inside its own room, reachable in
// a straight line without crossing a raised slab, prop, wall or - for the
// boss - the stair trench (an enemy moves at a fixed height, so it would float
// over it).
export function dungeonWanderTarget(enem: any, radius: number): { x: number, z: number } | null | undefined {
    const dungeon = DUNGEONS.get(enem.currentPlaceId)
    if (!dungeon || !enem.homeRoom) return undefined

    const home: Rect = enem.homeRoom
    const isBossRoom = home.x === dungeon.bossRoom.gridX && home.y === dungeon.bossRoom.gridY
    const standable = standableCells(dungeon, home, isBossRoom)
    const standableKeys = new Set(standable.map(cellKey))
    const origin = enem.origPos ?? { x: enem.x, z: enem.z }
    const inReach = standable.filter(c => {
        const p = toWorld(dungeon, c)
        return Math.hypot(p.x - origin.x, p.z - origin.z) <= radius
    })
    if (!inReach.length) return null

    // dragged out of its room (a chase is client-side and can end anywhere) -
    // head straight back to its spawn instead of failing every check below
    const cs = dungeon.layout.cellSize
    if (!standableKeys.has(cellKey({ x: Math.floor(enem.x / cs), y: Math.floor(enem.z / cs) })))
        return { x: origin.x, z: origin.z }

    const cell = inReach[Math.floor(Math.random() * inReach.length)]
    const dest = toWorld(dungeon, cell)
    // the straight walk there, sampled every half unit
    const dist = Math.hypot(dest.x - enem.x, dest.z - enem.z)
    const steps = Math.ceil(dist / 0.5)
    for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const c = { x: Math.floor((enem.x + (dest.x - enem.x) * t) / cs), y: Math.floor((enem.z + (dest.z - enem.z) * t) / cs) }
        if (!standableKeys.has(cellKey(c))) return null
    }
    return dest
}
