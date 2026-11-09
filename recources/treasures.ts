import { randNumString } from "../tools/tools"
import { rollSupplies, TsupplyRoll } from "./craftingSupplies"
import { VILLAGE_CHEST_SPOTS } from "./villageChestSpots"

// World treasure chests - each one pairs a spawn position with the item
// inside it. itemDetail mirrors client/src/staticRecources/swordsdata.js's
// sword shape exactly (parts-based: blade/guard/handle/pommel, each with its
// own rarity tier + material color, resolved to real colors client-side in
// tools/weaponmat.js) rather than npcDetails.js's older metalColor+3-part
// shape, since swordsdata.js is the current canonical convention for a
// sword item. Client-side, client/src/assetcreation/createtreasure.js's
// createTreasureMesh(scene, position, itemDetail) is what actually spawns
// the chest and hands out itemDetail via obtain() once opened - this file
// is just the data feeding it, same division of labor quests.ts has with
// index.ts's guild board.
//
// Only one sword for now (per rarity's own steel-blue treasure0/1/2.jpg
// skin, this one's "rare" - see createtreasure.js's RARITY_TREASURE_TEX) -
// more treasures (any item shape obtain() already accepts, not just swords)
// can just be added to the array below the same way.
//
// currentPlaceId is what scopes a treasure to one place (same flat field
// enemyDetails.ts's own entries use) - without it, worldsocket.js's
// reCreateMeshesInScene() would have no way to know which place `pos`
// actually belongs to, and a chest meant for one place would silently also
// spawn anywhere else that happens to reuse those same coordinates. 1 =
// village, since that's the one everyone's actually standing in for now.
export type TreasurePos = { x: number, y: number, z: number }

// any chest: where it stands, which place it's in, and the ready-to-obtain()
// item inside (createTreasureMesh skins the chest by itemDetail.rarity).
// extras: more items in the same chest - the client hands them all out
// together when it's opened; the skin still follows itemDetail alone.
export function createTreasure(pos: TreasurePos, currentPlaceId: number, itemDetail: any, extras: any[] = []) {
    return { itemId: randNumString(), pos, currentPlaceId, itemDetail, ...(extras.length ? { extras } : {}) }
}

export function createSwordTreasure(pos: TreasurePos, currentPlaceId: number = 1) {
    return createTreasure(pos, currentPlaceId, {
        itemId: randNumString(), // should be string also in client
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
    })
}
// THE VILLAGE SUPPLY CHEST - one plain chest of nails and leather somewhere in
// the village, so the anvil's nails (client campcraft.js) can be had without
// a dungeon run. Opened, it comes back VILLAGE_CHEST_RESPAWN_MS later
// somewhere else in the village (villageChestSpots.ts) - index.ts's
// removeTreasure handler, through respawnOf below.
const VILLAGE_PLACE_ID = 1
const VILLAGE_CHEST_RESPAWN_MS = 60 * 1000
const VILLAGE_CHEST_CONTENTS: TsupplyRoll[] = [["nail", 3, 5], ["leather", 1, 3]]

function villageSupplyChest(notAt?: TreasurePos) {
    // anywhere but where it just was
    const spots = VILLAGE_CHEST_SPOTS.filter(([x, z]) => !notAt || x !== notAt.x || z !== notAt.z)
    const [x, z] = spots[Math.floor(Math.random() * spots.length)]
    const [first, ...rest] = rollSupplies(VILLAGE_CHEST_CONTENTS)
    return { ...createTreasure({ x, y: 0, z }, VILLAGE_PLACE_ID, first, rest), respawns: "villageSupply" }
}

// a chest that comes back once it's opened (its record's `respawns`): when, and
// the new one to put out then. null for every other chest - opened for good.
type TrespawnRule = { afterMs: number, make: (opened: any) => any }
const RESPAWNING_CHESTS: Record<string, TrespawnRule> = {
    villageSupply: { afterMs: VILLAGE_CHEST_RESPAWN_MS, make: opened => villageSupplyChest(opened.pos) },
}
// another file's chests that come back (hiddenHoards.ts's) - added from there,
// since that file imports this one and this one can't import it back
export function addRespawningChest(name: string, rule: TrespawnRule) {
    RESPAWNING_CHESTS[name] = rule
}
export function respawnOf(opened: any) {
    const rule = RESPAWNING_CHESTS[opened?.respawns]
    return rule ? { afterMs: rule.afterMs, make: () => rule.make(opened) } : null
}

export const startingTreasures = [
    createSwordTreasure({ x: 2.2, y: 0, z: 4.12 }),
    villageSupplyChest(),
]
