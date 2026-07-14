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
