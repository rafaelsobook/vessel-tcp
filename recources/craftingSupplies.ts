import { randNumString } from "../tools/tools"

// The everyday crafting materials the dungeons' common chests hold alongside
// whatever else is in them (treasuresInDungeon.ts) - nails (what the camp
// anvil is built from, client/src/components/campcraft.js), cloth and leather.
// Shapes copied from the client's staticRecources/resourceLoot.js (tcp can't
// import client code) - keep the two in step. Their icons are
// images/items/crafting/<name>.webp.

const material = (name: string, dn: string, pieces: number, desc: string) => (qnty: number) => ({
    itemId: randNumString(),
    name,
    dn,
    itemCateg: "crafting",
    itemType: "material",
    qnty,
    price: { coinType: "bronze", pieces },
    desc,
    rarity: "common",
})

export const nail = material("nail", "Nail", 1,
    "A hand-forged iron nail. Small, but nothing a smith builds holds together without them.")
export const cloth = material("cloth", "Cloth", 5,
    "A bolt of coarse woven cloth, for bindings, wraps and padding.")
export const leather = material("leather", "Leather", 6,
    "Tanned hide, supple enough to wrap a grip without slipping.")

const SUPPLIES = { nail, cloth, leather }
export type TsupplyName = keyof typeof SUPPLIES

// a whole number from min to max, both included
const roll = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

// what to put in a chest: each entry is [material, fewest, most, chance 0-1]
export type TsupplyRoll = [TsupplyName, number, number, number?]

export function rollSupplies(rolls: TsupplyRoll[]) {
    return rolls
        .filter(([, , , chance = 1]) => Math.random() < chance)
        .map(([name, min, max]) => SUPPLIES[name](roll(min, max)))
}
