"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startingTreasures = void 0;
exports.createTreasure = createTreasure;
exports.createSwordTreasure = createSwordTreasure;
exports.addRespawningChest = addRespawningChest;
exports.respawnOf = respawnOf;
const tools_1 = require("../tools/tools");
const craftingSupplies_1 = require("./craftingSupplies");
const villageChestSpots_1 = require("./villageChestSpots");
// any chest: where it stands, which place it's in, and the ready-to-obtain()
// item inside (createTreasureMesh skins the chest by itemDetail.rarity).
// extras: more items in the same chest - the client hands them all out
// together when it's opened; the skin still follows itemDetail alone.
function createTreasure(pos, currentPlaceId, itemDetail, extras = []) {
    return { itemId: (0, tools_1.randNumString)(), pos, currentPlaceId, itemDetail, ...(extras.length ? { extras } : {}) };
}
function createSwordTreasure(pos, currentPlaceId = 1) {
    return createTreasure(pos, currentPlaceId, {
        itemId: (0, tools_1.randNumString)(), // should be string also in client
        name: "sunfangedge",
        dn: "Sunfang Edge",
        itemCateg: "equipable", //equipable,crafting(for item looted),consum(/foods/buffs/potions)
        itemType: "weapon", // weapon/staff/spear/Pauldrons//armor/greaves || //food//potion//buff
        weaponType: "sword",
        effectsWhenHit: [
            { effectName: "bash", distanceKnockback: 4, triggerWhen: "critical", particlesystem: null, texture: null },
        ],
        equipAbilities: {
            dmg: 16, def: 0, magicDmg: 0, plusStr: 0, plusDex: 0, plusInt: 0,
        }, //str(hp,dmg) // dex(def, spd) // int(magicDmg, mana)
        consumeAbilities: { plusHp: 0, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0 }, //for buffs foods potions
        equiped: false,
        soulFeed: 0,
        isEnhanceAble: true, // only for equipable items
        enhancedLevel: 0,
        slots: [], // { name, dn, equipAbilities } cores
        durability: { current: 100, max: 100 },
        price: { coinType: "bronze", pieces: 45 },
        qnty: 1,
        desc: "A gleaming blade said to have been forged under an open sun - its edge still holds a faint warmth long after being drawn.",
        rarity: "rare",
        parts: {
            bladeRarity: "rare1",
            guardRarity: "rare1",
            handleRarity: "rare1",
            pommelRarity: "rare1",
            bladeColor: "gold",
            guardColor: "iron",
            handleColor: "leather",
            pommelColor: "firecrystal",
        }
    });
}
// THE VILLAGE SUPPLY CHEST - one plain chest of nails and leather somewhere in
// the village, so the anvil's nails (client campcraft.js) can be had without
// a dungeon run. Opened, it comes back VILLAGE_CHEST_RESPAWN_MS later
// somewhere else in the village (villageChestSpots.ts) - index.ts's
// removeTreasure handler, through respawnOf below.
const VILLAGE_PLACE_ID = 1;
const VILLAGE_CHEST_RESPAWN_MS = 60 * 1000;
const VILLAGE_CHEST_CONTENTS = [["nail", 3, 5], ["leather", 1, 3]];
function villageSupplyChest(notAt) {
    // anywhere but where it just was
    const spots = villageChestSpots_1.VILLAGE_CHEST_SPOTS.filter(([x, z]) => !notAt || x !== notAt.x || z !== notAt.z);
    const [x, z] = spots[Math.floor(Math.random() * spots.length)];
    const [first, ...rest] = (0, craftingSupplies_1.rollSupplies)(VILLAGE_CHEST_CONTENTS);
    return { ...createTreasure({ x, y: 0, z }, VILLAGE_PLACE_ID, first, rest), respawns: "villageSupply" };
}
const RESPAWNING_CHESTS = {
    villageSupply: { afterMs: VILLAGE_CHEST_RESPAWN_MS, make: opened => villageSupplyChest(opened.pos) },
};
// another file's chests that come back (hiddenHoards.ts's) - added from there,
// since that file imports this one and this one can't import it back
function addRespawningChest(name, rule) {
    RESPAWNING_CHESTS[name] = rule;
}
function respawnOf(opened) {
    const rule = RESPAWNING_CHESTS[opened?.respawns];
    return rule ? { afterMs: rule.afterMs, make: () => rule.make(opened) } : null;
}
exports.startingTreasures = [
    createSwordTreasure({ x: 2.2, y: 0, z: 4.12 }),
    villageSupplyChest(),
];
