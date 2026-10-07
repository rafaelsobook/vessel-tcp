import { generateGhosts, generateLesserDemons, generateIceScorpions } from "../generate-datas/genenemy"
import { DUNGEONS, Cell, Rect, cellKey, toWorld, roomRect, bossRect, bossThrone, standableCells, floorY, walkingDepth } from "./dungeonLayouts"

// Enemies that live inside the procedural BSP dungeons - where they spawn and
// where they may wander, checked against the real layout (see dungeonLayouts.ts).

// ghosts per ordinary room: one per this many floor cells, 1 to MAX per room
const CELLS_PER_GHOST = 12
const MAX_GHOSTS_PER_ROOM = 3
// the frost scorpion guards the biggest ordinary room at least this deep
// (walking distance from the entrance, 0-1) - the deeper half, on the way to
// the boss, and a big room because it's a big monster
const SCORPION_MIN_DEPTH = 0.5

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
        const home = roomRect(room)
        const cells = standableCells(dungeon, home, false)
        if (!cells.length) return
        const count = Math.min(MAX_GHOSTS_PER_ROOM, Math.max(1, Math.round(home.w * home.h / CELLS_PER_GHOST)), cells.length)
        for (let i = 0; i < count; i++) {
            const c = cells[Math.floor((i + 0.5) * cells.length / count)]
            const { x, z } = toWorld(dungeon, c)
            enemies.push(place(generateGhosts(1, placeId, 0, "fixed", x, z)[0], dungeon, c, home, false))
        }
    })

    // the frost scorpion - one, in the biggest ordinary room of the deeper
    // half, on the open cell nearest that room's middle; it wanders that room
    const depth = walkingDepth(dungeon)
    const lair = dungeon.rooms
        .filter((room: any) => room.type !== "entrance" && room.type !== "boss_room")
        .map((room: any) => ({ room, rect: roomRect(room) }))
        .filter(({ rect }: { rect: Rect }) => (depth.get(cellKey({ x: rect.x + Math.floor(rect.w / 2), y: rect.y + Math.floor(rect.h / 2) })) ?? 0) >= SCORPION_MIN_DEPTH)
        .sort((a: any, b: any) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0]
    if (lair) {
        const { rect } = lair
        const mid = { x: rect.x + (rect.w - 1) / 2, y: rect.y + (rect.h - 1) / 2 }
        const spot = standableCells(dungeon, rect, false)
            .sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y))[0]
        if (spot) {
            const { x, z } = toWorld(dungeon, spot)
            enemies.push(place(generateIceScorpions(1, placeId, 0, "fixed", x, z)[0], dungeon, spot, rect, false))
        }
    }

    // boss - the lesser demon, on the dais at the far end from the stairs,
    // facing the way players come up
    // (dungeonLayouts.ts's bossThrone - treasuresInDungeon.ts puts the
    // boss's reward chest beside the same spot)
    const throne = bossThrone(dungeon)
    if (throne) {
        const c = throne.cell
        const entrance = dungeon.bossRoom.entrance
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
