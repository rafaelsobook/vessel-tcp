import { randNumString } from "../tools/tools"

// ============================================================
// BOT EQUIPMENT CATALOGUE
// ============================================================
// Every equipable a bot can end up wearing, split by the two bot archetypes.
// Bots spawn with a WEAPON ONLY (see index.ts's own buildBotItems) and earn
// everything in here by levelling - so this file is the reward pool, not the
// starting kit.
//
// botType maps onto characterclass names the game already uses
// (server/models/charDetM.js carries warbringer/runecaller alongside
// duskrunner/berserker/paladin/necromancer):
//   "warbringer" - close combat. Plate, helms, pauldrons, gauntlets.
//   "runecaller" - caster. Hats and light robes, never plate.
//
// Every name/modelName below is a REAL item that renders - verified against
// avatar.glb (armor.*/boots.*), helmets.glb, pauldrons.glb and gauntlets.glb.
// They are hand-mirrored from client/src/charactersystem/inventory.js's own
// "give all items" catalogue and npcDetails.js's NPC gear, because tcp is a
// separate node project and cannot import from client/. If an item is
// renamed on the client it has to be renamed here too - a name that does not
// resolve makes createcharacter.js warn and render nothing.

export type TBotType = "warbringer" | "runecaller"

// ============================================================
// METAL TIERS
// ============================================================
// The metal a piece rolls is what decides how good it is. This replaces the
// old arrangement where every metal was cosmetically different but
// mechanically identical and exactly ONE combination (a black Knight's Scale)
// was special - now the whole palette is a ladder, and ANY metal-tinted piece
// can roll anywhere on it.
//
// The keys are exactly client/src/tools/metalmat.js's own METAL_TINTS keys,
// and that is not negotiable: createMetalMat does
// `METAL_TINTS[metalColor] ?? METAL_TINTS.iron`, so a key that is not in that
// table does not throw - it silently renders as plain iron while still
// carrying epic stats, which looks like a bug and is very hard to trace.
//
// Worth knowing before adding more: solarore/orichalcum/unobtanium etc.
// (client/src/staticRecources/itemDictionary.js) are CRAFTING MATERIALS, not
// armour colours. Each carries a `tintKey` pointing into this same palette -
// solarore and sunduskore both tint "gold", orichalcum tints "mythril", so
// they are already represented here under the tint they actually paint. Only
// unobtanium's "stormcrystal" has no METAL_TINTS entry at all (it lives in
// weaponmat.js's GEM_TINTS, which only weapon parts read), which is why it is
// the one material name that cannot be used as armour.
//
//   defMult/resMult - multiply the piece's base def/resistance
//   priceMult       - multiply its base price
//   weight          - relative roll frequency, out of WEIGHT_TOTAL below
//   prefix          - goes in front of the base dn ("Adamantine Knight's
//                     Scale"), which is the naming rule already in force
//                     elsewhere: never call a piece "Iron" when it is not.

export type TMetalRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic"

type TMetalTier = {
    prefix: string
    rarity: TMetalRarity
    weight: number
    defMult: number
    resMult: number
    priceMult: number
}

// weights sum to 1000, so a weight reads directly as a per-mille chance
export const METAL_TIERS: Record<string, TMetalTier> = {
    iron:        { prefix: "Iron",        rarity: "common",   weight: 272, defMult: 1.0,  resMult: 1.0, priceMult: 1 },
    bronze:      { prefix: "Bronze",      rarity: "common",   weight: 235, defMult: 1.05, resMult: 1.0, priceMult: 1.2 },
    steel:       { prefix: "Steel",       rarity: "uncommon", weight: 180, defMult: 1.25, resMult: 1.1, priceMult: 1.8 },
    // silver is the traditional anti-magic metal, and itemDictionary.js's own
    // silverore already reads that way ("best magicResistance among the
    // metals") - mirrored here as a resistance specialist, not a defence one
    silver:      { prefix: "Silver",      rarity: "uncommon", weight: 127, defMult: 1.2,  resMult: 1.6, priceMult: 2.4 },
    gold:        { prefix: "Gold",        rarity: "rare",     weight: 72,  defMult: 1.3,  resMult: 1.5, priceMult: 3.5 },
    ruby:        { prefix: "Ruby",        rarity: "rare",     weight: 54,  defMult: 1.5,  resMult: 1.5, priceMult: 4.5 },
    // orichalcum ("legendary alloy... never tarnish") tints mythril - strong
    // across the board, same as its own statWeights in itemDictionary.js
    mythril:     { prefix: "Mythril",     rarity: "epic",     weight: 32,  defMult: 1.8,  resMult: 2.0, priceMult: 7 },
    // "near-indestructible" (resourceLoot.js) -> the raw-defence leader
    adamantine:  { prefix: "Adamantine",  rarity: "epic",     weight: 18,  defMult: 2.2,  resMult: 1.8, priceMult: 9 },
    // blackdragon is the priciest material in resourceLoot.js (150, above
    // even unobtanium's own 100) and dragonscale is the one tint carrying a
    // real surface image in MATERIAL_TEXTURES, so it visibly reads as rare
    dragonscale: { prefix: "Dragonscale", rarity: "legendary", weight: 8,  defMult: 2.6,  resMult: 2.4, priceMult: 14 },
    // THE top roll, 0.2%. Flat unadorned black plate with no texture of its
    // own, so it cannot be mistaken for dragonscale's patterned near-black.
    // 3x base defence keeps a black Knight's Scale at def 60 against the
    // ordinary 20 - exactly what it was worth when black was a special case
    // hardcoded to that one item, just no longer limited to it.
    black:       { prefix: "Black",       rarity: "mythic",   weight: 2,   defMult: 3.0,  resMult: 3.0, priceMult: 20 },
}

const METAL_KEYS = Object.keys(METAL_TIERS)
const WEIGHT_TOTAL = METAL_KEYS.reduce((sum, k) => sum + METAL_TIERS[k].weight, 0)

// anything at or above this announces itself in world chat when a bot earns
// it - rare enough that everyone online should get to see it happen
const ANNOUNCE_RARITIES: TMetalRarity[] = ["legendary", "mythic"]

// The plain list of usable armour tints, for anything that just wants the keys.
export const BOT_METAL_COLORS = METAL_KEYS

type TBotItemTemplate = {
    name: string
    // BASE display name, with no metal in it - buildBotItem puts the rolled
    // metal's own prefix in front ("Adamantine Knight's Scale"). This is why
    // the pauldron is "Pauldron" here and not "Iron Pauldron" as it reads in
    // Bram's shop: the shop sells one fixed iron version, these roll.
    dn: string
    itemType: "helmet" | "armor" | "pauldron" | "boots" | "gauntlet"
    modelName?: string
    hairVisible?: boolean
    // metal-tinted gear only. A cloth hat has no metal to tint -
    // createHelmet paints those from a texture instead (it keys off the item
    // name containing "hat"), so rolling a metal for one is meaningless and
    // would be silently ignored. Those pieces keep their template stats,
    // price and rarity untouched.
    metalTinted?: boolean
    def: number
    resistance: number
    price: number
    rarity: string
}

// close combat
export const WARBRINGER_ITEMS: TBotItemTemplate[] = [
    { name: "knightscale", dn: "Knight's Scale", itemType: "armor", metalTinted: true, def: 20, resistance: 10, price: 45, rarity: "rare" },
    { name: "lightarmor", dn: "Light Armor", itemType: "armor", metalTinted: true, def: 12, resistance: 14, price: 30, rarity: "rare" },
    { name: "ironpaul", dn: "Pauldron", itemType: "pauldron", metalTinted: true, def: 20, resistance: 0, price: 30, rarity: "rare" },
    { name: "ironjaw", modelName: "ironjaw", dn: "Knight's Helm III", itemType: "helmet", metalTinted: true, def: 20, resistance: 10, price: 35, rarity: "rare" },
    { name: "orionhelm", modelName: "orionhelm", dn: "Orion Helm", itemType: "helmet", metalTinted: true, def: 18, resistance: 12, price: 32, rarity: "rare" },
    { name: "ironmask", modelName: "ironmask", dn: "Mask", itemType: "helmet", metalTinted: true, hairVisible: true, def: 14, resistance: 8, price: 25, rarity: "rare" },
    { name: "gauntler", dn: "Gauntlet", itemType: "gauntlet", metalTinted: true, def: 10, resistance: 6, price: 22, rarity: "rare" },
    { name: "leatherboots", dn: "Leather Boots", itemType: "boots", def: 0, resistance: 5, price: 9, rarity: "common" },
]

// casters - no plate at all, a runecaller reads as robed. kraunmask is metal
// but it is a face mask rather than a helm, which suits the silhouette.
export const RUNECALLER_ITEMS: TBotItemTemplate[] = [
    { name: "lauriethat", modelName: "magicianhat", dn: "Lauriet's Hat", itemType: "helmet", def: 6, resistance: 14, price: 20, rarity: "rare" },
    { name: "farmhat", modelName: "farmhat", dn: "Farmer's Hat", itemType: "helmet", def: 4, resistance: 10, price: 12, rarity: "common" },
    { name: "kraunmask", modelName: "kraunmask", dn: "Kraun Mask", itemType: "helmet", metalTinted: true, hairVisible: true, def: 12, resistance: 10, price: 30, rarity: "rare" },
    { name: "lightarmor", dn: "Light Armor", itemType: "armor", metalTinted: true, def: 10, resistance: 18, price: 30, rarity: "rare" },
    { name: "leatherboots", dn: "Leather Boots", itemType: "boots", def: 0, resistance: 5, price: 9, rarity: "common" },
]

export const BOT_ITEMS_BY_TYPE: Record<TBotType, TBotItemTemplate[]> = {
    warbringer: WARBRINGER_ITEMS,
    runecaller: RUNECALLER_ITEMS,
}

function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)]
}

/** One weighted draw against METAL_TIERS. */
function drawMetal(): string {
    let roll = Math.random() * WEIGHT_TOTAL
    for(const key of METAL_KEYS){
        roll -= METAL_TIERS[key].weight
        if(roll < 0) return key
    }
    return "iron"
}

/**
 * How many metal draws a bot of this level gets, keeping the best one.
 *
 * This is the only thing that makes a level 20 bot look meaningfully better
 * than a level 5 one. Without it every reward would sit on the same flat
 * table forever, and levelling would mean nothing but more hp - a bot's gear
 * should visibly improve as it survives, not just its health bar.
 *
 * Best-of-N rather than a shifted table, so the ladder itself stays fixed and
 * readable: a high level bot is not rolling from some different pool, it just
 * gets more chances at the same rare top end.
 */
function metalDrawsForLevel(botLvl: number): number {
    return 1 + Math.floor((botLvl ?? 1) / 10)
}

/** Best (rarest) of however many draws the bot's level earns it. */
function rollMetalColor(botLvl: number): string {
    let best = drawMetal()
    for(let i = 1; i < metalDrawsForLevel(botLvl); i++){
        const next = drawMetal()
        if(METAL_TIERS[next].weight < METAL_TIERS[best].weight) best = next
    }
    return best
}

/**
 * Build a full, client-ready item object from a template. The shape mirrors
 * what buildBotItems already produced, so the client's own
 * createcharacter.js and equiped-item paths need no special handling.
 */
export function buildBotItem(template: TBotItemTemplate, botLvl: number = 1){
    const metalColor = template.metalTinted ? rollMetalColor(botLvl) : undefined
    const tier = metalColor ? METAL_TIERS[metalColor] : undefined

    const def = tier ? Math.round(template.def * tier.defMult) : template.def
    const resistance = tier ? Math.round(template.resistance * tier.resMult) : template.resistance
    const price = tier ? Math.round(template.price * tier.priceMult) : template.price
    const rarity = tier ? tier.rarity : template.rarity
    // "Adamantine Knight's Scale". Untinted pieces (cloth hats, leather
    // boots) keep their own name as-is - there is no metal to name.
    const dn = tier ? `${tier.prefix} ${template.dn}` : template.dn

    return {
        itemId: `bot-item-${randNumString()}`,
        name: template.name,
        modelName: template.modelName,
        dn,
        itemCateg: "equipable",
        itemType: template.itemType,
        weaponType: undefined,
        equipAbilities: { dmg: 0, def, resistance, magicDmg: 0, plusStr: 0, plusDex: 0, plusInt: 0 },
        consumeAbilities: { plusHp: 0, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0 },
        equiped: true,
        soulFeed: 0,
        isEnhanceAble: true,
        enhancedLevel: 0,
        slots: [],
        durability: { current: 100, max: 100 },
        price: { coinType: "bronze", pieces: price },
        qnty: 1,
        rarity,
        metalColor,
        hairVisible: template.hairVisible,
        // read only by the level-up broadcast, so it knows whether this one
        // is worth telling the whole server about
        _announce: ANNOUNCE_RARITIES.includes(rarity as TMetalRarity),
    }
}

/**
 * Roll one level-up reward for a bot.
 *
 * Returns null when the bot already wears something in every slot its pool
 * offers, rather than handing out a duplicate it cannot use - the client
 * renders one item per slot, so a second helm would be invisible and just
 * inflate the items array forever.
 */
export function rollBotLevelReward(botType: TBotType, currentItems: any[], botLvl: number = 1){
    const pool = BOT_ITEMS_BY_TYPE[botType] ?? WARBRINGER_ITEMS
    const wornTypes = new Set(
        (currentItems ?? [])
            .filter(itm => itm && itm.equiped && itm.itemType !== "weapon")
            .map(itm => itm.itemType)
    )
    const available = pool.filter(t => !wornTypes.has(t.itemType))
    if(!available.length) return null
    return buildBotItem(pick(available), botLvl)
}

/** attitude.weapon <= 0.5 is a caster - the same threshold npcBrain.ts uses. */
export function botTypeFor(isCaster: boolean): TBotType {
    return isCaster ? "runecaller" : "warbringer"
}

// ============================================================
// ARMOUR MITIGATION
// ============================================================
// Without this every `def` above is decoration: index.ts's applyDamageToBot
// subtracted raw damage, so a bot in full plate died exactly as fast as a
// naked one and the whole metal ladder would be a set of recolours.
//
// Diminishing returns rather than flat subtraction. Flat would be unusable
// here - a full warbringer set is 70 def even in plain iron, against enemy
// hits in the 5-40 range, which would make the bot literally immune to most
// of the world. The softcap keeps every point worth something while never
// reaching immunity:
//
//     def  20 (one iron Knight's Scale)       ->   9%
//     def  70 (full iron set)                 ->  26%
//     def 154 (full adamantine set)           ->  43%
//     def 210 (full black set, ~impossible)   ->  51%
//
// The hard cap at 60% is therefore never actually reached by any real
// loadout - it exists so that enhancement or stacking added later cannot
// accidentally produce an unkillable bot.
const BOT_ARMOR_SOFTCAP = 200
const BOT_MAX_MITIGATION = 0.6

/** Sum of def across everything the bot currently wears. Weapons carry def:0. */
export function botTotalDef(items: any[]): number {
    return (items ?? []).reduce((total, itm) => {
        if(!itm || !itm.equiped) return total
        return total + (itm.equipAbilities?.def ?? 0)
    }, 0)
}

/**
 * Incoming physical damage after the bot's worn armour.
 *
 * Never returns less than 1 on a real hit, so stacked armour can slow a bot's
 * death but can never make it unkillable - and never returns more than it was
 * given, so this is always safe to run on an un-armoured bot.
 *
 * `resistance` is deliberately NOT applied: it is magic mitigation, and every
 * path that currently reaches applyDamageToBot is physical (a player's melee
 * swing and an enemy's own attack). When bots can be hit by a skill this
 * should grow an isMagic branch rather than quietly folding resistance in
 * here, which would double-count on physical hits.
 */
export function botDamageAfterArmor(items: any[], dmg: number): number {
    if(!(dmg > 0)) return dmg
    const def = botTotalDef(items)
    if(def <= 0) return dmg
    const mitigation = Math.min(def / (def + BOT_ARMOR_SOFTCAP), BOT_MAX_MITIGATION)
    return Math.max(1, Math.round(dmg * (1 - mitigation)))
}
