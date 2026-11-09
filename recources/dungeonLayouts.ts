import { generateBSPDungeon } from "../generate-datas/generatebsp"

// The procedural BSP dungeons as the server knows them, and the grid helpers
// everything placed inside one shares (enemiesInDungeon.ts, treasuresInDungeon.ts).
// The server can't see a dungeon's walls, but generateBSPDungeon is
// deterministic: fed the same arguments as the client, it returns the exact
// grid - props, river, ore and all - that every client renders.

// MIRROR of the layout arguments of client/src/constants/localroomdb.js's
// DUNGEON_12 - tcp can't import client code (same arrangement as
// graveyards.ts). Change one side and the other has to follow, or enemies and
// chests end up inside walls. textures/sceneTemp/exitPlaceDetail and the ore's
// resourceTemplates don't affect where anything goes, so they're left out.
const DUNGEON_12 = generateBSPDungeon({
    placeId: 12,
    seed: 12345,
    rockDensity: 0,
    gridWidth: 32,
    gridHeight: 32,
    cellSize: 4,
    wallHeight: 15,
    corridorWidth: 3,
    // 5, as the client's (dungeons.js) - it was 2 here while the client had
    // moved to 5, and every room came out different on the two sides
    bossRoomWidthScale: 5,
})

export const DUNGEONS = new Map<number, any>([[12, DUNGEON_12]])

// anything higher than this is a raised slab - a wall to walkers (the
// generator's TILE_JITTER_NORMAL.max), so never a spawn, wander or chest spot
const WALKABLE_JITTER = 0.04

export type Cell = { x: number, y: number }
// a room in grid cells - what each dungeon enemy keeps as its .homeRoom
export type Rect = { x: number, y: number, w: number, h: number }

export const cellKey = (c: Cell) => `${c.x}_${c.y}`

export function toWorld(dungeon: any, c: Cell) {
    const cs = dungeon.layout.cellSize
    return { x: (c.x + 0.5) * cs, z: (c.y + 0.5) * cs }
}

export function rectCells(r: Rect): Cell[] {
    const cells: Cell[] = []
    for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) cells.push({ x, y })
    return cells
}

export function roomRect(room: any): Rect {
    return { x: room.bounds.x, y: room.bounds.y, w: room.bounds.width, h: room.bounds.height }
}

export function bossRect(dungeon: any): Rect {
    const b = dungeon.bossRoom
    return { x: b.gridX, y: b.gridY, w: b.width, h: b.height }
}

// the boss room cells the entrance staircase is cut into (createDungeon's own
// stairKeys) - they slope from the floor up to the dais
export function stairKeys(dungeon: any): Set<string> {
    const keys = new Set<string>()
    const { elevation, entrance } = dungeon.bossRoom
    if (!(elevation > 0) || !entrance) return keys
    entrance.cells.forEach((c: Cell) => {
        for (let k = 1; k <= entrance.stairCells; k++) keys.add(cellKey({ x: c.x + entrance.dx * k, y: c.y + entrance.dz * k }))
    })
    return keys
}

// cells something solid stands on - props (torches, barrels, chests, vases)
// and ore. The river is shallow water you wade through, so it isn't one.
export function occupiedKeys(dungeon: any): Set<string> {
    return new Set([
        ...(dungeon.props ?? []).map((p: any) => cellKey(p)),
        ...(dungeon.resources ?? []).map((r: any) => cellKey(r.cell)),
    ])
}

// where something of `home` may stand: ordinary rooms - their floor minus
// raised slabs and occupied cells; the boss room - its raised dais, minus the
// stairs and whatever stands on it
export function standableCells(dungeon: any, home: Rect, isBossRoom: boolean): Cell[] {
    const occupied = occupiedKeys(dungeon)
    if (isBossRoom) {
        const stairs = stairKeys(dungeon)
        return rectCells(home).filter(c => !stairs.has(cellKey(c)) && !occupied.has(cellKey(c)))
    }
    return rectCells(home).filter(c =>
        dungeon.layout.grid[c.y]?.[c.x] === 1
        && (dungeon.tileHeights[cellKey(c)] ?? 0) <= WALKABLE_JITTER
        && !occupied.has(cellKey(c)))
}

// The boss's spot - the dais cell furthest from the stairs, as close to the
// room's centre line as it gets - plus a measure of how deep into the room
// (along the stairs' direction) any cell is. null when there's no dais/entrance.
export function bossThrone(dungeon: any): { cell: Cell, depth: (c: Cell) => number } | null {
    const boss = bossRect(dungeon)
    const entrance = dungeon.bossRoom.entrance
    const dais = standableCells(dungeon, boss, true)
    if (!dais.length || !entrance) return null
    const centre = { x: boss.x + (boss.w - 1) / 2, y: boss.y + (boss.h - 1) / 2 }
    const depth = (c: Cell) => c.x * entrance.dx + c.y * entrance.dz
    const offCentre = (c: Cell) => entrance.dx !== 0 ? Math.abs(c.y - centre.y) : Math.abs(c.x - centre.x)
    const cell = dais.reduce((best, c) =>
        depth(c) > depth(best) || (depth(c) === depth(best) && offCentre(c) < offCentre(best)) ? c : best)
    return { cell, depth }
}

// How deep into the dungeon every floor cell is: its walking distance from
// the spawn (4-way steps over any floor), scaled so the furthest cell is 1.
// cellKey -> 0..1. Unreachable cells (there shouldn't be any) are left out.
const depthCache = new WeakMap<any, Map<string, number>>()
export function walkingDepth(dungeon: any): Map<string, number> {
    const cached = depthCache.get(dungeon)
    if (cached) return cached
    const grid = dungeon.layout.grid
    const start = { x: Math.floor(dungeon.spawn.x), y: Math.floor(dungeon.spawn.z) }
    const steps = new Map<string, number>([[cellKey(start), 0]])
    const queue: Cell[] = [start]
    for (let i = 0; i < queue.length; i++) {
        const c = queue[i]
        const d = steps.get(cellKey(c))!
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = { x: c.x + dx, y: c.y + dy }
            if ((grid[n.y]?.[n.x] ?? 0) === 0 || steps.has(cellKey(n))) continue
            steps.set(cellKey(n), d + 1)
            queue.push(n)
        }
    }
    const furthest = Math.max(1, ...steps.values())
    const depth = new Map([...steps].map(([k, d]) => [k, d / furthest]))
    depthCache.set(dungeon, depth)
    return depth
}

// floor height of a cell - the dais for the boss room, the tile's own jitter
// elsewhere (createEnemy.js stands a non-openworld enemy at its own y)
export function floorY(dungeon: any, c: Cell, isBossRoom: boolean) {
    return isBossRoom ? dungeon.bossRoom.elevation : (dungeon.tileHeights[cellKey(c)] ?? 0)
}
