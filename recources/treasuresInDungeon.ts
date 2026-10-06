import { randNumString } from "../tools/tools"
import { createTreasure } from "./treasures"
import { DUNGEONS, Cell, cellKey, toWorld, roomRect, bossRect, bossThrone, standableCells, floorY } from "./dungeonLayouts"

// Treasure chests inside the procedural BSP dungeons - same world-treasure
// records as treasures.ts (index.ts's `treasures`, opened through the client's
// createtreasure.js), placed on the server's copy of each layout
// (dungeonLayouts.ts) so a chest never lands in a wall, on a raised slab, in
// the river or on top of a prop or ore.
//
//  - crypt:  the generator's own chest prop (room centre) - food for the road
//  - armory: against the back wall, between its two display vases - a blade
//  - boss:   beside the lesser demon's spot on the dais - the dungeon's prize
//
// Looted for good (until the server restarts), like every other world treasure.

// ── What's inside ────────────────────────────────────────────────────────────
// Item shapes copied from the client (tcp can't import client code): the
// consumable is npcDetails.js's lunaraqum, the blades follow swordsdata.js -
// a sword's look comes from its parts, so any name works.

function lunaraqum(qnty: number) {
    return {
        itemId: randNumString(),
        name: "lunaraqum",
        dn: "Lunaraqum",
        itemCateg: "consumable",
        itemType: "food",
        consumeAbilities: { plusHp: 400, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0, fillHunger: 30, fillTireness: 10, cure: ["poisoned"] },
        price: { coinType: "bronze", pieces: 3 },
        qnty,
        desc: "A striking fruit with a deep crimson skin that glimmers like molten metal under moonlight. Its content can even cure poisons",
        rarity: "normal",
    }
}

function sword(name: string, dn: string, rarity: string, dmg: number, pieces: number, desc: string, parts: any) {
    return {
        itemId: randNumString(),
        name,
        dn,
        itemCateg: "equipable",
        itemType: "weapon",
        weaponType: "sword",
        equipAbilities: { dmg, def: 0, magicDmg: 0, plusStr: 0, plusDex: 0, plusInt: 0 },
        consumeAbilities: { plusHp: 0, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 1 },
        equiped: false,
        soulFeed: 0,
        isEnhanceAble: true,
        enhancedLevel: 0,
        slots: [],
        durability: { current: 100, max: 100 },
        price: { coinType: "bronze", pieces },
        qnty: 1,
        desc,
        rarity,
        parts,
    }
}

const armoryBlade = () => sword("stormcalleredge", "Stormcaller Edge", "rare", 23, 17,
    "Stormcaller Edge, a rare blade forged with a silver guard, a wood grip, and a stormcrystal pommel.",
    {
        bladeRarity: "rare1", guardRarity: "rare1", handleRarity: "rare1", pommelRarity: "rare1",
        bladeColor: "mythril", guardColor: "silver", handleColor: "wood", pommelColor: "stormcrystal",
    })

// "legendary" - the gold-leaf chest skin (createtreasure.js's RARITY_TREASURE_TEX)
const bossBlade = () => sword("demonbanefang", "Demonbane Fang", "legendary", 32, 120,
    "Pried from beside the lesser demon's throne - an adamantine fang that still hums when something unholy draws near.",
    {
        bladeRarity: "rare1", guardRarity: "rare1", handleRarity: "rare1", pommelRarity: "rare1",
        bladeColor: "adamantine", guardColor: "gold", handleColor: "leather", pommelColor: "firecrystal",
    })

// ── Where ────────────────────────────────────────────────────────────────────

function chestAt(placeId: number, dungeon: any, c: Cell, isBossRoom: boolean, itemDetail: any) {
    const { x, z } = toWorld(dungeon, c)
    return createTreasure({ x, y: floorY(dungeon, c, isBossRoom), z }, placeId, itemDetail)
}

function spawnDungeonTreasures(placeId: number, dungeon: any) {
    const chests: any[] = []
    // a chest is a solid box - the river's shallow water is walkable, but no place for one
    const river = new Set<string>(dungeon.rivers?.flatMap((r: any) => r.cells.map(cellKey)) ?? [])

    // crypts - the generator already put a chest prop in the middle of each
    dungeon.props?.filter((p: any) => p.type === "chest").forEach((p: any) =>
        chests.push(chestAt(placeId, dungeon, p, false, lunaraqum(3))))

    // armories - on the back row (where the generator stands its two display
    // vases), as close to the middle of the room as that row allows
    dungeon.rooms.filter((room: any) => room.type === "armory").forEach((room: any) => {
        const r = roomRect(room)
        const backRow = r.y + r.h - 2
        const midX = r.x + (r.w - 1) / 2
        const spots = standableCells(dungeon, r, false)
            .filter(c => c.y === backRow && !river.has(cellKey(c)))
            .sort((a, b) => Math.abs(a.x - midX) - Math.abs(b.x - midX))
        if (spots.length) chests.push(chestAt(placeId, dungeon, spots[0], false, armoryBlade()))
    })

    // the boss's reward - beside its throne, as deep into the dais as it gets
    const throne = bossThrone(dungeon)
    if (throne) {
        const spots = standableCells(dungeon, bossRect(dungeon), true)
            .filter(c => cellKey(c) !== cellKey(throne.cell))
            .sort((a, b) => throne.depth(b) - throne.depth(a)
                || Math.hypot(a.x - throne.cell.x, a.y - throne.cell.y) - Math.hypot(b.x - throne.cell.x, b.y - throne.cell.y))
        if (spots.length) chests.push(chestAt(placeId, dungeon, spots[0], true, bossBlade()))
    }

    return chests
}

export const DUNGEON_TREASURES = [...DUNGEONS].flatMap(([placeId, dungeon]) => spawnDungeonTreasures(placeId, dungeon))
