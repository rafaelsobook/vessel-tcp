import { randNumString } from "../tools/tools"

export const simpleCoreLoot = {
    itemId: randNumString(),
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
}

export const waterslimeCoreLoot = {
    itemId: randNumString(),
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
}

export const fireslimeCoreLoot = {
    itemId: randNumString(),
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
}

export const electricslimeCoreLoot = {
    itemId: randNumString(),
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
}

export const darkslimeCoreLoot = {
    itemId: randNumString(),
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
}

// the orange lith's own core (genenemy.ts's monolithBase) - its icon,
// images/items/crafting/orangelithcore.webp, was already in the client
export const orangelithCoreLoot = {
    itemId: randNumString(),
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
}

export const mediumCoreLoot = {
    itemId: randNumString(),
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
}

// not a core - the same "Celestine Ore" the client's resourceLoot.js mints
// (name "celestineore", so it stacks with any already mined, and shows that
// item's icon). The frost scorpion (genenemy.ts) drops it: an icy crystal
// shard off a crystal-skinned monster.
export const celestineOreLoot = {
    itemId: randNumString(),
    name: "celestineore",
    dn: "Celestine Ore",
    itemCateg: "crafting",
    itemType: "material",
    qnty: 1,
    price: { coinType: "bronze", pieces: 15 },
    desc: "A shard of Celestine Ore, prized by enchanters.",
    hardness: 28, // resourceLoot.js celestineore
    rarity: "rare"
}
