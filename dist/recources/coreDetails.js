"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.celestineOreLoot = exports.mediumCoreLoot = exports.orangelithCoreLoot = exports.darkslimeCoreLoot = exports.electricslimeCoreLoot = exports.fireslimeCoreLoot = exports.waterslimeCoreLoot = exports.simpleCoreLoot = void 0;
const tools_1 = require("../tools/tools");
exports.simpleCoreLoot = {
    itemId: (0, tools_1.randNumString)(),
    name: "smallcore",
    dn: "small core",
    itemCateg: "crafting",
    itemType: "core",
    weaponType: false,
    equipAbilities: {
        dmg: 10, def: 10, magicDmg: 10, plusStr: 0, plusDex: 0, plusInt: 0,
        plusDurability: 30
    },
    equiped: false,
    price: { coinType: "bronze", pieces: 50 },
    qnty: 1,
    desc: "core that can be found on almost any small monsters, can be useful for enhancing items",
    rarity: "normal"
};
exports.waterslimeCoreLoot = {
    itemId: (0, tools_1.randNumString)(),
    name: "waterslimecore",
    dn: "water slime core",
    itemCateg: "crafting",
    itemType: "core",
    weaponType: false,
    equipAbilities: {
        dmg: 10, def: 10, magicDmg: 10, plusStr: 0, plusDex: 0, plusInt: 0,
        plusDurability: 30
    },
    equiped: false,
    price: { coinType: "bronze", pieces: 50 },
    qnty: 1,
    desc: "a gelatinous core taken from a water slime, useful for enhancing items",
    rarity: "normal"
};
exports.fireslimeCoreLoot = {
    itemId: (0, tools_1.randNumString)(),
    name: "fireslimecore",
    dn: "fire slime core",
    itemCateg: "crafting",
    itemType: "core",
    weaponType: false,
    equipAbilities: {
        dmg: 10, def: 10, magicDmg: 10, plusStr: 0, plusDex: 0, plusInt: 0,
        plusDurability: 30
    },
    equiped: false,
    price: { coinType: "bronze", pieces: 50 },
    qnty: 1,
    desc: "a smoldering core taken from a fire slime, useful for enhancing items",
    rarity: "normal"
};
exports.electricslimeCoreLoot = {
    itemId: (0, tools_1.randNumString)(),
    name: "electricslimecore",
    dn: "electric slime core",
    itemCateg: "crafting",
    itemType: "core",
    weaponType: false,
    equipAbilities: {
        dmg: 10, def: 10, magicDmg: 10, plusStr: 0, plusDex: 0, plusInt: 0,
        plusDurability: 30
    },
    equiped: false,
    price: { coinType: "bronze", pieces: 50 },
    qnty: 1,
    desc: "a crackling core taken from an electric slime, useful for enhancing items",
    rarity: "normal"
};
exports.darkslimeCoreLoot = {
    itemId: (0, tools_1.randNumString)(),
    name: "darkslimecore",
    dn: "dark slime core",
    itemCateg: "crafting",
    itemType: "core",
    weaponType: false,
    equipAbilities: {
        dmg: 10, def: 10, magicDmg: 10, plusStr: 0, plusDex: 0, plusInt: 0,
        plusDurability: 30
    },
    equiped: false,
    price: { coinType: "bronze", pieces: 50 },
    qnty: 1,
    desc: "a shadow-wreathed core taken from a dark slime, useful for enhancing items",
    rarity: "normal"
};
// the orange lith's own core (genenemy.ts's monolithBase) - its icon,
// images/items/crafting/orangelithcore.webp, was already in the client
exports.orangelithCoreLoot = {
    itemId: (0, tools_1.randNumString)(),
    name: "orangelithcore",
    dn: "orange lith core",
    itemCateg: "crafting",
    itemType: "core",
    weaponType: false,
    equipAbilities: {
        dmg: 10, def: 10, magicDmg: 10, plusStr: 0, plusDex: 0, plusInt: 0,
        plusDurability: 30
    },
    equiped: false,
    price: { coinType: "bronze", pieces: 60 },
    qnty: 1,
    desc: "a heavy, ember-veined core broken out of an orange lith, useful for enhancing items",
    rarity: "normal"
};
exports.mediumCoreLoot = {
    itemId: (0, tools_1.randNumString)(),
    name: "mediumcore",
    dn: "medium core",
    itemCateg: "crafting",
    itemType: "core",
    weaponType: false,
    equipAbilities: {
        dmg: 30, def: 30, magicDmg: 30, plusStr: 0, plusDex: 0, plusInt: 0,
        plusDurability: 60
    },
    equiped: false,
    price: { coinType: "bronze", pieces: 150 },
    qnty: 1,
    desc: "core found on larger monsters, useful for enhancing stronger items",
    rarity: "uncommon"
};
// not a core - the same "Celestine Ore" the client's resourceLoot.js mints
// (name "celestineore", so it stacks with any already mined, and shows that
// item's icon). The frost scorpion (genenemy.ts) drops it: an icy crystal
// shard off a crystal-skinned monster.
exports.celestineOreLoot = {
    itemId: (0, tools_1.randNumString)(),
    name: "celestineore",
    dn: "Celestine Ore",
    itemCateg: "crafting",
    itemType: "material",
    qnty: 1,
    price: { coinType: "bronze", pieces: 15 },
    desc: "A shard of Celestine Ore, prized by enchanters.",
    hardness: 28, // resourceLoot.js celestineore
    rarity: "rare"
};
