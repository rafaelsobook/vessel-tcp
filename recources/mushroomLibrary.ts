import { randNumString } from "../tools/tools"

// Every kind of mushroom that grows in the dungeons - where it may grow, how
// often, and what you get for picking it. mushroomsInDungeon.ts rolls a kind
// per cluster from here; index.ts's "pickupMushroom" hands the picker this
// kind's item. The server is the only one that knows the items - a client
// gets one back for each mushroom it actually took, never for one someone
// else got to first.
//
// `kind` is also the mushroom's skin: client/public/images/textures/mushrooms/
// <kind>.jpg on the shared models/outdors/mushroom.glb (createmushroom.js).

export type TmushroomKind = {
    kind: string
    // relative chance against the other kinds allowed at the same spot
    weight: number
    // how deep into the dungeon it starts growing: 0 = from the entrance on,
    // 1 = only the very furthest floor from it (by walking distance)
    minDepth: number
    // a fresh, ready-to-obtain() item every call
    item: () => any
}

export type FoodStats = {
    plusHp?: number, plusMp?: number, plusSp?: number, plusDmg?: number, plusSpd?: number,
    fillHunger?: number, fillTireness?: number, cure?: string[],
    // status effects eating it gives you - same shape as the enemies' own
    // effects (genenemy.ts), see the client's itemInfoSystem.js consumeItemFunc
    inflict?: any[],
}

// what roasting does to a mushroom: everything it restores goes up by this
// much, and the fire burns any poison out of it. A permanent stat gain
// (plusDmg/plusSpd) stays as it was - roasting is no way to farm strength.
const ROAST_BOOST = 1.5
const ROAST_PRICE_BOOST = 2

function consumeAbilities(stats: FoodStats) {
    return {
        plusHp: 0, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0,
        fillHunger: 0, fillTireness: 0, cure: [] as string[],
        ...stats,
    }
}

function roasted(stats: FoodStats): FoodStats {
    const { inflict, ...rest } = stats
    const boost = (n?: number) => n ? Math.round(n * ROAST_BOOST) : 0
    return {
        ...rest,
        plusHp: boost(stats.plusHp), plusMp: boost(stats.plusMp), plusSp: boost(stats.plusSp),
        fillHunger: boost(stats.fillHunger), fillTireness: boost(stats.fillTireness),
    }
}

// The consumable shape the client's other foods use (npcDetails.js's
// etherpearl/lunaraqum). Its icon is images/items/consumable/<name>.webp, so
// `name` is the mushroom's kind (orange.webp, white.webp...). Not only for
// mushrooms - any food that can go over a bonfire (meatLoots.ts's Beast Meat).
//
// canBeCooked + cookRecipe: roasting it over a crafted bonfire (the client's
// components/bonfireCooking.js) turns one raw mushroom into this recipe - only
// items that carry one can be cooked at all. What comes off the fire is the
// raw item with the recipe laid over it, plus `cooked: true` (cooking.js's
// makeCookedItem). It keeps the raw one's picture (icon), shown toasted.
export function cookableFood(name: string, dn: string, rarity: string, pieces: number, desc: string, stats: FoodStats) {
    return () => ({
        itemId: randNumString(),
        name,
        dn,
        itemCateg: "consumable",
        itemType: "food",
        consumeAbilities: consumeAbilities(stats),
        price: { coinType: "bronze", pieces },
        qnty: 1,
        desc,
        rarity,
        canBeCooked: true,
        cookRecipe: {
            name: `roasted${name}`,
            dn: `Roasted ${dn}`,
            icon: `./images/items/consumable/${name}.webp`,
            consumeAbilities: consumeAbilities(roasted(stats)),
            price: { coinType: "bronze", pieces: pieces * ROAST_PRICE_BOOST },
            desc: stats.inflict?.length
                ? `Roasted over a bonfire until the fire burned the poison out of it. ${desc}`
                : `Roasted over a bonfire - more filling, and it does more for you than eaten raw. ${desc}`,
        },
    })
}

// the white mushroom's poison - tcp's venomous enemies' own "poisoned"
// (genenemy.ts), so the same cures (lunaraqum's cure: ["poisoned"]) lift it
const MUSHROOM_POISON = {
    effectType: "poisoned", chance: 100, permanent: true, dn: "Pale Poison",
    hpcost: 10, spcost: 20, mpcost: 0, hungercost: 4, energycost: 0,
}

// The client's Mushruu (npcDetails.js's "121_mushruu") tells players what each
// of these does, from a hand-copied table of kind / minDepth / stats in
// client/src/constants/mushruudata.js - the client can't import this file. Add
// or tune a mushroom here and change that table too, or he'll say the old thing.
export const MUSHROOM_LIBRARY: TmushroomKind[] = [
    // ── common - anywhere, from the entrance in ────────────────────────────
    {
        kind: "orange", weight: 30, minDepth: 0,
        item: cookableFood("orange", "Ember Cap", "normal", 2,
            "A bright orange cap that tastes faintly of smoke. Filling, and warms the blood a little.",
            { plusHp: 60, fillHunger: 12 }),
    },
    {
        kind: "brown", weight: 30, minDepth: 0,
        item: cookableFood("brown", "Loam Cap", "normal", 1,
            "The plain brown mushroom every dungeon delver learns to recognise first. Earthy, chewy, safe.",
            { plusHp: 30, fillHunger: 18 }),
    },
    {
        kind: "swamp", weight: 25, minDepth: 0,
        item: cookableFood("swamp", "Bog Cap", "normal", 2,
            "Slick and olive green, grown wherever the floor stays wet. Tastes like pond water, but it gets your legs moving again.",
            { plusHp: 40, plusSp: 60, fillHunger: 10 }),
    },
    // common too, but the rarest of them - and poisonous
    {
        kind: "white", weight: 10, minDepth: 0,
        item: cookableFood("white", "Pale Deathcap", "normal", 4,
            "Pale, pretty, and poisonous. It fills the belly - then turns it. Better roasted, or sold.",
            { fillHunger: 8, inflict: [MUSHROOM_POISON] }),
    },

    // ── rare - only the deeper half of the dungeon, the rarest deepest ─────
    {
        // cure: ["bleed"] - closes a standing wolf's bleed (the client's
        // characterstate.js tickBleed); itemInfoSystem.js's consumeItemFunc
        // lifts it. Roasting keeps the cure - roasted() only drops `inflict`.
        kind: "purple", weight: 6, minDepth: 0.4,
        item: cookableFood("purple", "Duskveil", "rare", 18,
            "A violet cap streaked with darker veins. Mages chew it before a long night of casting. Its sap also closes open wounds, stopping a bleed.",
            { plusMp: 150, fillHunger: 8, cure: ["bleed"] }),
    },
    {
        kind: "bluemist", weight: 6, minDepth: 0.4,
        item: cookableFood("bluemist", "Mistcap", "rare", 20,
            "Cold to the touch and wreathed in a faint blue haze. Clears the head and the lungs alike.",
            { plusMp: 80, plusSp: 150, fillTireness: 15 }),
    },
    {
        kind: "crimson", weight: 4, minDepth: 0.55,
        item: cookableFood("crimson", "Bloodcap", "rare", 30,
            "Deep red and faintly warm, as if something still beats inside it. Hardens the arm that eats it - for good.",
            { plusHp: 120, plusDmg: 1, fillHunger: 10 }),
    },
    {
        kind: "galaxygreen", weight: 3, minDepth: 0.65,
        item: cookableFood("galaxygreen", "Starspore", "epic", 55,
            "Its cap is flecked with points of light like a night sky. Restores body and mind at once.",
            { plusHp: 250, plusMp: 250, plusSp: 150, fillHunger: 15, fillTireness: 20 }),
    },
    {
        kind: "devilred", weight: 2, minDepth: 0.75,
        item: cookableFood("devilred", "Devil's Crown", "epic", 80,
            "Found only near where the dungeon's master sleeps. Burns going down, and leaves the eater stronger for it.",
            { plusHp: 300, plusDmg: 3, fillHunger: 10 }),
    },
]

export const mushroomKind = (kind: string) => MUSHROOM_LIBRARY.find(k => k.kind === kind)

// A kind for a spot `depth` (0-1) into the dungeon, weighted among those that
// grow that deep. rareOnly: just the deep-only kinds - unless none grow this
// shallow, then any.
export function rollMushroomKind(depth: number, rareOnly = false): TmushroomKind {
    let allowed = MUSHROOM_LIBRARY.filter(k => depth >= k.minDepth)
    const rare = allowed.filter(k => k.minDepth > 0)
    if (rareOnly && rare.length) allowed = rare
    let roll = Math.random() * allowed.reduce((sum, k) => sum + k.weight, 0)
    for (const k of allowed) {
        roll -= k.weight
        if (roll < 0) return k
    }
    return allowed[allowed.length - 1]
}
