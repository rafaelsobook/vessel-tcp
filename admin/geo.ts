import { DUNGEONS, Cell, Rect, cellKey, toWorld, roomRect, bossRect, stairKeys, occupiedKeys } from "../recources/dungeonLayouts"

// Putting things where they can stand. tcp has no terrain, so outside the
// dungeons a position is just (x, z) and the client works out the ground; a
// dungeon's grid is known, so anything placed there lands on a real floor
// cell, at that cell's own height, instead of in a wall.

// anything higher than this is a raised slab - a wall to walkers
// (dungeonLayouts.ts's WALKABLE_JITTER)
const WALKABLE_JITTER = 0.04

export type Spot = { x: number, y: number, z: number }

type FloorCell = { cell: Cell, x: number, z: number, y: number }
const floorCache = new WeakMap<any, FloorCell[]>()

// every cell something can stand on: the floor, minus raised slabs, props and
// ore; the boss room's dais (minus the stairs) at the dais' height
function floorCells(dungeon: any): FloorCell[] {
    const cached = floorCache.get(dungeon)
    if (cached) return cached
    const { grid } = dungeon.layout
    const occupied = occupiedKeys(dungeon)
    const stairs = stairKeys(dungeon)
    const boss = bossRect(dungeon)
    const elevation = dungeon.bossRoom.elevation ?? 0
    const cells: FloorCell[] = []
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            const cell = { x, y }
            const key = cellKey(cell)
            if (occupied.has(key) || stairs.has(key)) continue
            const inBoss = x >= boss.x && x < boss.x + boss.w && y >= boss.y && y < boss.y + boss.h
            if (inBoss) {
                cells.push({ cell, ...toWorld(dungeon, cell), y: elevation })
                continue
            }
            const height = dungeon.tileHeights[key] ?? 0
            if (grid[y][x] === 1 && height <= WALKABLE_JITTER) cells.push({ cell, ...toWorld(dungeon, cell), y: height })
        }
    }
    floorCache.set(dungeon, cells)
    return cells
}

// The cells something can stand on, as rows of text ("#" a floor cell, "."
// anything else) for the admin map to draw - the very cells
// snapToDungeonFloor puts things on, so what the map shows is what a placement
// can land on.
export function floorPlan(dungeon: any): { cellSize: number, rows: string[] } {
    const open = new Set(floorCells(dungeon).map(f => cellKey(f.cell)))
    const rows = dungeon.layout.grid.map((row: number[], y: number) =>
        row.map((_, x) => open.has(cellKey({ x, y })) ? "#" : ".").join(""))
    return { cellSize: dungeon.layout.cellSize, rows }
}

// The point itself when it already stands on a floor cell, otherwise the centre
// of the nearest one. `taken` is the cells earlier points of the same command
// were moved to: a batch aimed at a wall would otherwise all pile onto the one
// nearest cell, so each point takes the nearest cell not used yet (and only
// reuses one once there's nothing else close).
export function snapToDungeonFloor(dungeon: any, x: number, z: number, taken?: Set<string>): Spot {
    const cs = dungeon.layout.cellSize
    const floor = floorCells(dungeon)
    const own = floor.find(f => f.cell.x === Math.floor(x / cs) && f.cell.y === Math.floor(z / cs))
    if (own) return { x, y: own.y, z }
    if (!floor.length) return { x, y: 0, z }
    const byDistance = floor
        .map(f => ({ f, d: Math.hypot(f.x - x, f.z - z) }))
        .sort((a, b) => a.d - b.d)
    const pick = (taken && byDistance.slice(0, 40).find(({ f }) => !taken.has(cellKey(f.cell)))?.f) || byDistance[0].f
    taken?.add(cellKey(pick.cell))
    return { x: pick.x, y: pick.y, z: pick.z }
}

// The room a dungeon enemy wanders inside (index.ts's wander tick reads
// .homeRoom): the room that holds the cell, the boss room, or - in a corridor -
// just the cell itself, so it stays put instead of walking into a wall.
export function homeRoomFor(dungeon: any, x: number, z: number): Rect {
    const cs = dungeon.layout.cellSize
    const cell = { x: Math.floor(x / cs), y: Math.floor(z / cs) }
    const inside = (r: Rect) => cell.x >= r.x && cell.x < r.x + r.w && cell.y >= r.y && cell.y < r.y + r.h
    const boss = bossRect(dungeon)
    if (inside(boss)) return boss
    const room = (dungeon.rooms ?? []).map(roomRect).find(inside)
    return room ?? { x: cell.x, y: cell.y, w: 1, h: 1 }
}

// where something put at (x, z) in `placeId` ends up: snapped to a floor in a
// dungeon, as given elsewhere (y 0 - the client grounds it on terrain)
export function ground(placeId: number, x: number, z: number, taken?: Set<string>): Spot {
    const dungeon = DUNGEONS.get(placeId)
    return dungeon ? snapToDungeonFloor(dungeon, x, z, taken) : { x, y: 0, z }
}

// a random point within `radius` of the centre, spread evenly over the area
export function scatter(cx: number, cz: number, radius: number): { x: number, z: number } {
    if (radius <= 0) return { x: cx, z: cz }
    const angle = Math.random() * Math.PI * 2
    const dist = Math.sqrt(Math.random()) * radius
    return { x: cx + Math.cos(angle) * dist, z: cz + Math.sin(angle) * dist }
}

export const round2 = (n: number) => Math.round(n * 100) / 100
