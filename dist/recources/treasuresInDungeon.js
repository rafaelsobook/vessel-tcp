"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DUNGEON_TREASURES = void 0;
exports.lunaraqum = lunaraqum;
const tools_1 = require("../tools/tools");
const treasures_1 = require("./treasures");
const craftingSupplies_1 = require("./craftingSupplies");
const dungeonLayouts_1 = require("./dungeonLayouts");
// Treasure chests inside the procedural BSP dungeons - same world-treasure
// records as treasures.ts (index.ts's `treasures`, opened through the client's
// createtreasure.js), placed on the server's copy of each layout
// (dungeonLayouts.ts) so a chest never lands in a wall, on a raised slab, in
// the river or on top of a prop or ore.
//
//  - crypt:  the generator's own chest prop (room centre) - food for the road
//  - armory: against the back wall, between its two display vases - a blade
//  - boss:   beside the lesser demon's spot on the dais - the dungeon's prize
//  - supply: a plain chest in the back of the library, guard post, barracks and
//            chamber - nails, cloth and leather (craftingSupplies.ts). Common
//            loot, so these (and the crypt's, which holds some too) wear the
//            plain chest skin - createtreasure.js skins a chest by rarity.
//
// Looted for good (until the server restarts), like every other world treasure.
// ── What's inside ────────────────────────────────────────────────────────────
// Item shapes copied from the client (tcp can't import client code): the
// consumable is npcDetails.js's lunaraqum, the blades follow swordsdata.js -
// a sword's look comes from its parts, so any name works.
// (hiddenHoards.ts puts some in its chests too)
function lunaraqum(qnty) {
    return {
        itemId: (0, tools_1.randNumString)(),
        name: "lunaraqum",
        dn: "Lunaraqum",
        itemCateg: "consumable",
        itemType: "food",
        consumeAbilities: { plusHp: 400, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0, fillHunger: 30, fillTireness: 10, cure: ["poisoned"] },
        price: { coinType: "bronze", pieces: 3 },
        qnty,
        desc: "A striking fruit with a deep crimson skin that glimmers like molten metal under moonlight. Its content can even cure poisons",
        rarity: "normal",
    };
}
function sword(name, dn, rarity, dmg, pieces, desc, parts) {
    return {
        itemId: (0, tools_1.randNumString)(),
        name,
        dn,
        itemCateg: "equipable",
        itemType: "weapon",
        weaponType: "sword",
        effectsWhenHit: [
            { effectName: "bash", distanceKnockback: 4, triggerWhen: "critical", particlesystem: null, texture: null },
        ],
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
    };
}
const armoryBlade = () => sword("stormcalleredge", "Stormcaller Edge", "rare", 23, 17, "Stormcaller Edge, a rare blade forged with a silver guard, a wood grip, and a stormcrystal pommel.", {
    bladeRarity: "rare1", guardRarity: "rare1", handleRarity: "rare1", pommelRarity: "rare1",
    bladeColor: "mythril", guardColor: "silver", handleColor: "wood", pommelColor: "stormcrystal",
});
// "legendary" - the gold-leaf chest skin (createtreasure.js's RARITY_TREASURE_TEX)
const bossBlade = () => sword("demonbanefang", "Demonbane Fang", "legendary", 32, 120, "Pried from beside the lesser demon's throne - an adamantine fang that still hums when something unholy draws near.", {
    bladeRarity: "rare1", guardRarity: "rare1", handleRarity: "rare1", pommelRarity: "rare1",
    bladeColor: "adamantine", guardColor: "gold", handleColor: "leather", pommelColor: "firecrystal",
});
// what each room's plain chest holds: [material, fewest, most, chance]. Nails
// are what the camp anvil costs (4 each), so the rooms a guard would keep
// them in are heavy with them; every chest has at least one thing in it.
const SUPPLY_CHESTS = {
    guard_post: [["nail", 3, 5], ["leather", 1, 2, 0.6]],
    barracks: [["nail", 1, 3], ["leather", 2, 3], ["cloth", 1, 2, 0.5]],
    library: [["cloth", 2, 4], ["nail", 1, 2, 0.5]],
    chamber: [["nail", 2, 3], ["cloth", 1, 2], ["leather", 1, 2, 0.4]],
};
// the crypt's food chest carries a little of it too
const CRYPT_SUPPLIES = [["nail", 2, 3], ["cloth", 1, 2, 0.5], ["leather", 1, 2, 0.5]];
// ── Where ────────────────────────────────────────────────────────────────────
function chestAt(placeId, dungeon, c, isBossRoom, itemDetail, extras = []) {
    const { x, z } = (0, dungeonLayouts_1.toWorld)(dungeon, c);
    return (0, treasures_1.createTreasure)({ x, y: (0, dungeonLayouts_1.floorY)(dungeon, c, isBossRoom), z }, placeId, itemDetail, extras);
}
function spawnDungeonTreasures(placeId, dungeon) {
    const chests = [];
    // a chest is a solid box - the river's shallow water is walkable, but no place for one
    const river = new Set(dungeon.rivers?.flatMap((r) => r.cells.map(dungeonLayouts_1.cellKey)) ?? []);
    // crypts - the generator already put a chest prop in the middle of each
    dungeon.props?.filter((p) => p.type === "chest").forEach((p) => chests.push(chestAt(placeId, dungeon, p, false, lunaraqum(3), (0, craftingSupplies_1.rollSupplies)(CRYPT_SUPPLIES))));
    // supply rooms - a plain chest at the back, as far from the middle of the
    // room as its free cells go (out of the way of the doors and the fighting)
    dungeon.rooms.filter((room) => SUPPLY_CHESTS[room.type]).forEach((room) => {
        const r = (0, dungeonLayouts_1.roomRect)(room);
        const mid = { x: r.x + (r.w - 1) / 2, y: r.y + (r.h - 1) / 2 };
        const spots = (0, dungeonLayouts_1.standableCells)(dungeon, r, false)
            .filter(c => !river.has((0, dungeonLayouts_1.cellKey)(c)))
            .sort((a, b) => Math.hypot(b.x - mid.x, b.y - mid.y) - Math.hypot(a.x - mid.x, a.y - mid.y));
        if (!spots.length)
            return;
        const [first, ...rest] = (0, craftingSupplies_1.rollSupplies)(SUPPLY_CHESTS[room.type]);
        if (first)
            chests.push(chestAt(placeId, dungeon, spots[0], false, first, rest));
    });
    // armories - on the back row (where the generator stands its two display
    // vases), as close to the middle of the room as that row allows
    dungeon.rooms.filter((room) => room.type === "armory").forEach((room) => {
        const r = (0, dungeonLayouts_1.roomRect)(room);
        const backRow = r.y + r.h - 2;
        const midX = r.x + (r.w - 1) / 2;
        const spots = (0, dungeonLayouts_1.standableCells)(dungeon, r, false)
            .filter(c => c.y === backRow && !river.has((0, dungeonLayouts_1.cellKey)(c)))
            .sort((a, b) => Math.abs(a.x - midX) - Math.abs(b.x - midX));
        if (spots.length)
            chests.push(chestAt(placeId, dungeon, spots[0], false, armoryBlade()));
    });
    // the boss's reward - beside its throne, as deep into the dais as it gets
    const throne = (0, dungeonLayouts_1.bossThrone)(dungeon);
    if (throne) {
        const spots = (0, dungeonLayouts_1.standableCells)(dungeon, (0, dungeonLayouts_1.bossRect)(dungeon), true)
            .filter(c => (0, dungeonLayouts_1.cellKey)(c) !== (0, dungeonLayouts_1.cellKey)(throne.cell))
            .sort((a, b) => throne.depth(b) - throne.depth(a)
            || Math.hypot(a.x - throne.cell.x, a.y - throne.cell.y) - Math.hypot(b.x - throne.cell.x, b.y - throne.cell.y));
        if (spots.length)
            chests.push(chestAt(placeId, dungeon, spots[0], true, bossBlade()));
    }
    return chests;
}
exports.DUNGEON_TREASURES = [...dungeonLayouts_1.DUNGEONS].flatMap(([placeId, dungeon]) => spawnDungeonTreasures(placeId, dungeon));
