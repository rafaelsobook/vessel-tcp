import { randNumString } from "../tools/tools"

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
export function createSwordTreasure(pos: { x: number, y: number, z: number }, currentPlaceId: number = 1) {
    return {
        itemId: randNumString(),
        pos,
        currentPlaceId,
        itemDetail: {
            itemId: randNumString(), // should be string also in client
            name: "sunfangedge",
            dn: "Sunfang Edge",
            itemCateg: "equipable", //equipable,crafting(for item looted),consum(/foods/buffs/potions)
            itemType: "weapon", // weapon/staff/spear/Pauldrons//armor/greaves || //food//potion//buff
            weaponType: "sword",
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
        }
    }
}
export const startingTreasures = [
    createSwordTreasure({ x: 2.2, y: 0, z: 4.12 }),
]
