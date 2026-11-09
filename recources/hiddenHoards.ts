import { randNumString } from "../tools/tools"
import { createTreasure, addRespawningChest } from "./treasures"
import { buildEquipableItem, WARBRINGER_ITEMS, RUNECALLER_ITEMS } from "./botItems"
import { MUSHROOM_LIBRARY, mushroomKind } from "./mushroomLibrary"
import { lunaraqum } from "./treasuresInDungeon"
import { Tmushroom } from "./mushroomsInDungeon"
import { HIDDEN_PLACES, ThiddenPlace, ThiddenSpot } from "./hiddenPlaces"

// THE HIDDEN PLACES' HOARDS - the best loot in the open world, left where only
// someone exploring finds it: at the bottom of the wells, walled away in the
// grottos' mazes, in the caves behind the waterfalls (hiddenPlaces.ts, from
// infterrain). In every one:
//
//  - a chest: one legendary or mythic piece - a weapon or armour, which also
//    picks the chest's skin (the client's createtreasure.js) - and with it
//    more armour, a priest's belt, rare ores, food for the climb back out -
//    and in a grotto's, which takes the most finding, a heap of bronze coin
//  - a weapon struck into the floor, there for the taking (the client's
//    creategroundweapon.js) - in every cave behind the falls, in some wells
//    and grottos
//  - a patch of the rarest mushrooms (mushroomLibrary.ts)
//
// The further a place is from the spawn, the likelier its pieces are mythic
// rather than legendary. Every record carries exactY: down a well the ground
// over it is a lid far above, so the client uses the floor height
// hiddenPlaces.ts has instead of the terrain's.
//
// A chest opened or a weapon taken comes back, rolled anew, HOARD_RESPAWN_MS
// later (index.ts - treasures.ts's respawnOf for the chests, hoardWeaponRespawnOf
// below for the weapons); a picked mushroom grows back PATCH_REGROW_MS later.
//
// Item shapes are the client's (tcp can't import client code): the weapons
// follow swordsdata.js and npcDetails.js's majesticsword, the armour is
// botItems.ts's buildEquipableItem, the belts are inventory.js's
// createPriestBeltItem/createRoyalPriestBeltItem, the ores resourceLoot.js's,
// the coins currencySystem.js's createCoinItem.
// Everything here rides in every "userJoined" (with the rest of the world's
// loot), so the chests hold a handful of things each, not dozens.

const OPENWORLD_PLACE_ID = 888
const HOARD_RESPAWN_MS = 2 * 60 * 60 * 1000
const PATCH_REGROW_MS = 30 * 60 * 1000
// how many hidden places of each kind hold a struck weapon
const WEAPON_CHANCE: Record<ThiddenPlace["kind"], number> = { falls: 1, well: 0.45, grotto: 0.45 }
// a piece's odds of being mythic, at the nearest place .. the furthest
const MYTHIC_NEAR = 0.12
const MYTHIC_FAR = 0.4
const PATCH_SIZE = { min: 2, max: 4 }
const PATCH_RADIUS = 0.7

type Trarity = "legendary" | "mythic"

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
function weighted<T>(entries: [T, number][]): T {
    let roll = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0)
    for (const [value, w] of entries) {
        roll -= w
        if (roll < 0) return value
    }
    return entries[entries.length - 1][0]
}
const round2 = (n: number) => Math.round(n * 100) / 100

// 0 at the nearest hidden place, 1 at the furthest
const NEAREST = HIDDEN_PLACES[0]?.distance ?? 0
const FURTHEST = HIDDEN_PLACES[HIDDEN_PLACES.length - 1]?.distance ?? 1
const farOut = (place: ThiddenPlace) => Math.min(1, Math.max(0, (place.distance - NEAREST) / Math.max(1, FURTHEST - NEAREST)))
const rollRarity = (place: ThiddenPlace): Trarity =>
    Math.random() < MYTHIC_NEAR + (MYTHIC_FAR - MYTHIC_NEAR) * farOut(place) ? "mythic" : "legendary"

// ── Weapons ──────────────────────────────────────────────────────────────────
// A sword's look is its parts (the client's weaponmat.js resolves the
// colours): the legendary ones on the rare meshes, the mythic ones on the
// epic1 meshes with their accent pieces - majesticsword's. The spear has only
// its rare1 meshes, so its materials are what set one apart. Any name works -
// the inventory shows a sword or spear by its weaponType. A firecrystal part
// glows, and carries fire (itemDictionary.js's weaponElements): it cuts ghosts.
type TweaponTemplate = {
    name: string, dn: string, weaponType: "sword" | "spear", rarity: Trarity,
    dmg: number, magicDmg?: number, pieces: number, desc: string, parts: any, fire?: boolean,
}
const RARE_PARTS = { bladeRarity: "rare2", guardRarity: "rare2", handleRarity: "rare1", pommelRarity: "rare1" }
const EPIC_PARTS = { bladeRarity: "epic1", guardRarity: "epic1", handleRarity: "epic1", pommelRarity: "epic1" }
const SPEAR_PARTS = { bladeRarity: "rare1", guardRarity: "rare1", handleRarity: "rare1", pommelRarity: "rare1" }

const WEAPONS: TweaponTemplate[] = [
    {
        name: "gloamreach", dn: "Gloamreach", weaponType: "sword", rarity: "legendary", dmg: 35, pieces: 260,
        desc: "Found point-down where no daylight reaches - an adamantine blade that seems to drink what little light there is.",
        parts: { ...RARE_PARTS, bladeColor: "adamantine", guardColor: "gold", handleColor: "leather", pommelColor: "frostshard" },
    },
    {
        name: "wellwardenblade", dn: "Wellwarden's Blade", weaponType: "sword", rarity: "legendary", dmg: 34, magicDmg: 6, pieces: 240,
        desc: "Carried by whoever once kept the old wells, and left in one when they went down and did not come back up.",
        parts: { ...RARE_PARTS, bladeColor: "mythril", guardColor: "gold", handleColor: "bone", pommelColor: "stormcrystal" },
    },
    {
        name: "hollowsong", dn: "Hollowsong", weaponType: "sword", rarity: "legendary", dmg: 36, pieces: 280,
        desc: "Its dragonscale edge hums when it cuts the air - in a cave it sings back off every wall.",
        parts: { ...RARE_PARTS, bladeColor: "dragonscale", guardColor: "silver", handleColor: "wood", pommelColor: "silver" },
    },
    {
        name: "deepthorn", dn: "Deepthorn", weaponType: "spear", rarity: "legendary", dmg: 33, pieces: 230,
        desc: "A long adamantine point on a shaft of old bone, made for keeping something in the dark at arm's length.",
        parts: { ...SPEAR_PARTS, bladeColor: "adamantine", guardColor: "gold", handleColor: "bone", pommelColor: "gold" },
    },
    {
        name: "nightwellreaver", dn: "Nightwell Reaver", weaponType: "sword", rarity: "mythic", dmg: 48, magicDmg: 10, pieces: 900,
        desc: "Black as the bottom of a well at midnight, with a violet storm caught in its guard. Few have held it and fewer have kept it.",
        parts: {
            ...EPIC_PARTS, bladeColor: "black", guardColor: "dragonscale", handleColor: "stormcrystal", pommelColor: "dragonscale",
            epicAccents: { bladeOuterColor: "silver", guardCoreColor: "violet", guardOuterColor: "silver" },
        },
    },
    {
        name: "emberheart", dn: "Emberheart", weaponType: "sword", rarity: "mythic", dmg: 47, magicDmg: 12, pieces: 950, fire: true,
        desc: "Its grip is a living ember, and the blade carries the fire - it cuts what steel alone cannot, even a ghost.",
        parts: {
            ...EPIC_PARTS, bladeColor: "adamantine", guardColor: "gold", handleColor: "firecrystal", pommelColor: "gold",
            epicAccents: { bladeOuterColor: "gold", guardCoreColor: "red", guardOuterColor: "gold" },
        },
    },
    {
        name: "sunkensunlance", dn: "Sunken Sunlance", weaponType: "spear", rarity: "mythic", dmg: 46, pieces: 880, fire: true,
        desc: "A black-iron point on a shaft of firecrystal that never cooled - drowned for an age, and still burning.",
        parts: { ...SPEAR_PARTS, bladeColor: "black", guardColor: "gold", handleColor: "firecrystal", pommelColor: "gold" },
    },
    {
        name: "frostfathom", dn: "Frostfathom", weaponType: "spear", rarity: "mythic", dmg: 45, magicDmg: 8, pieces: 860,
        desc: "Mythril over a shaft of frostshard, cold enough to ache through a glove. It was pulled from water that never froze.",
        parts: { ...SPEAR_PARTS, bladeColor: "mythril", guardColor: "silver", handleColor: "frostshard", pommelColor: "silver" },
    },
    // mythic, and nothing on them glows - see glows() below
    {
        name: "graveshade", dn: "Graveshade", weaponType: "sword", rarity: "mythic", dmg: 46, magicDmg: 8, pieces: 850,
        desc: "A black blade with a dragonscale guard. Whoever left it down here meant to come back for it, and never did.",
        parts: { ...RARE_PARTS, bladeColor: "black", guardColor: "dragonscale", handleColor: "bone", pommelColor: "dragonscale" },
    },
    {
        name: "deepmawpike", dn: "Deepmaw Pike", weaponType: "spear", rarity: "mythic", dmg: 44, pieces: 820,
        desc: "Dragonscale on a shaft of pale bone, capped in black iron. It has been waiting in the dark a long time.",
        parts: { ...SPEAR_PARTS, bladeColor: "dragonscale", guardColor: "black", handleColor: "bone", pommelColor: "black" },
    },
]

// What makes a weapon glow on the client: weaponmat.js's SELF_GLOW gems, and an
// epic accent core (createweapon.js). The game's glow layer draws only the
// glowing meshes, so nothing in front of one hides its glow - a glowing blade
// struck into a well's floor would shine up through the ground. So the struck
// ones are only ever plain metal; the chests can hold the glowing ones, which
// only show once someone carries them back up.
const GLOWING_PARTS = ["firecrystal", "frostshard", "stormcrystal"]
const glows = (t: TweaponTemplate) =>
    [t.parts.bladeColor, t.parts.guardColor, t.parts.handleColor, t.parts.pommelColor].some(c => GLOWING_PARTS.includes(c))
    || !!t.parts.epicAccents?.guardCoreColor

function weaponItem(t: TweaponTemplate) {
    return {
        itemId: randNumString(),
        name: t.name,
        dn: t.dn,
        itemCateg: "equipable",
        itemType: "weapon",
        weaponType: t.weaponType,
        // a critical throws what it hits back (the client's staticRecources/weaponEffects.js)
        effectsWhenHit: [
            { effectName: "bash", distanceKnockback: 4, triggerWhen: "critical", particlesystem: null, texture: null },
        ],
        equipAbilities: { dmg: t.dmg, def: 0, magicDmg: t.magicDmg ?? 0, plusStr: 0, plusDex: 0, plusInt: 0 },
        consumeAbilities: { plusHp: 0, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 1 },
        ...(t.fire ? { elements: [{ elementType: "fire" }] } : {}),
        equiped: false,
        soulFeed: 0,
        isEnhanceAble: true,
        enhancedLevel: 0,
        slots: [],
        durability: { current: 100, max: 100 },
        price: { coinType: "bronze", pieces: t.pieces },
        qnty: 1,
        desc: t.desc,
        rarity: t.rarity,
        parts: t.parts,
    }
}
// struck: one to stand in a floor, so none that glow
const rollWeapon = (rarity: Trarity, struck = false) =>
    weaponItem(pick(WEAPONS.filter(w => w.rarity === rarity && !(struck && glows(w)))))

// ── Armour ───────────────────────────────────────────────────────────────────
// every metal-tinted piece either archetype wears - its metal sets its rarity
// (botItems.ts's METAL_TIERS): dragonscale is legendary, black mythic
const ARMOR = [...WARBRINGER_ITEMS, ...RUNECALLER_ITEMS]
    .filter((t, i, all) => t.metalTinted && all.findIndex(o => o.name === t.name) === i)
const HEADLINE_METAL: Record<Trarity, string> = { legendary: "dragonscale", mythic: "black" }
// the chest's other armour - a step or so below its headline piece
const EXTRA_METALS: Record<Trarity, [string, number][]> = {
    legendary: [["mythril", 4], ["adamantine", 4], ["dragonscale", 2]],
    mythic: [["adamantine", 4], ["dragonscale", 4], ["black", 2]],
}
const armorPiece = (metal: string, notTypes: Set<string> = new Set()) => {
    const pool = ARMOR.filter(t => !notTypes.has(t.itemType))
    return buildEquipableItem(pick(pool.length ? pool : ARMOR), metal)
}

// ── Belts ────────────────────────────────────────────────────────────────────
// the belt.prieststyle1 mesh in avatar.glb, its name picking the texture
function priestBelt() {
    return {
        itemId: randNumString(),
        itemModelStyle: "prieststyle1",
        name: "priestbelt",
        dn: "Priest Belt",
        itemCateg: "equipable",
        itemType: "belt",
        weaponType: undefined,
        equipAbilities: { dmg: 0, def: 4, resistance: 8, magicDmg: 0, plusStr: 0, plusDex: 0, plusInt: 0 },
        consumeAbilities: { plusHp: 0, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0 },
        equiped: false,
        soulFeed: 0,
        isEnhanceAble: true,
        enhancedLevel: 0,
        slots: [],
        durability: { current: 100, max: 100 },
        price: { coinType: "bronze", pieces: 40 },
        qnty: 1,
        desc: "A blessed priest's sash. It keeps the cold at bay and turns aside dark magic.",
        rarity: "rare",
        tempResistance: { cold: 10, heat: 0 },
        darkResistance: 0.2,
    }
}
function royalPriestBelt() {
    return {
        ...priestBelt(),
        name: "royalpriest",
        dn: "Royal Priest Belt",
        equipAbilities: { dmg: 0, def: 7, resistance: 14, magicDmg: 0, plusStr: 0, plusDex: 0, plusInt: 0 },
        price: { coinType: "bronze", pieces: 95 },
        desc: "A high priest's gilded vestment, stitched with old prayers. It wards off the cold and dark magic far better than a common sash.",
        rarity: "epic",
        tempResistance: { cold: 15, heat: 0 },
        darkResistance: 0.35,
    }
}

// ── Ores ─────────────────────────────────────────────────────────────────────
const ore = (name: string, dn: string, rarity: string, pieces: number, hardness: number, desc: string) => (qnty: number) => ({
    itemId: randNumString(), name, dn, itemCateg: "crafting", itemType: "material",
    qnty, price: { coinType: "bronze", pieces }, desc, hardness, rarity,
})
// [the ore, fewest, most, weight]
const ORES: [(qnty: number) => any, number, number, number][] = [
    [ore("unobtanium", "Unobtanium", "legendary", 100, 85, "An impossibly rare material. If you're holding this, you got lucky."), 1, 1, 1],
    [ore("phoenixore", "Phoenix Ore", "epic", 135, 45, "Ore said to have cooled in phoenix-fire - it's still warm to the touch."), 1, 2, 2],
    [ore("orichalcum", "Orichalcum", "epic", 60, 70, "A legendary alloy from a bygone age, said to never tarnish."), 1, 2, 2],
    [ore("adamantine", "Adamantine", "rare", 40, 50, "A rare, near-indestructible metal ore."), 2, 3, 3],
]
function rollOre() {
    const [make, min, max] = weighted(ORES.map(entry => [entry, entry[3]] as [typeof entry, number]))
    return make(randInt(min, max))
}

// ── Coin ─────────────────────────────────────────────────────────────────────
// a grotto chest's bronze: more the further out it is. Coins are inventory
// items that stack by name (the client's currencySystem.js)
const GROTTO_BRONZE = { near: [150, 260], far: [330, 480] }
function bronzeCoins(place: ThiddenPlace) {
    const t = farOut(place)
    const qnty = randInt(Math.round(GROTTO_BRONZE.near[0] + (GROTTO_BRONZE.far[0] - GROTTO_BRONZE.near[0]) * t),
        Math.round(GROTTO_BRONZE.near[1] + (GROTTO_BRONZE.far[1] - GROTTO_BRONZE.near[1]) * t))
    return {
        itemId: "coin_bronze", name: "bronze", dn: "Bronze Coin", itemCateg: "currency", itemType: "coin",
        price: { coinType: "bronze", pieces: 1 }, qnty, desc: "A bronze coin.", rarity: "common",
    }
}

// ── The rarest mushrooms ─────────────────────────────────────────────────────
// only the deep-dungeon kinds that grow no shallower than this
const RAREST_DEPTH = 0.55
const RAREST_KINDS = MUSHROOM_LIBRARY.filter(k => k.minDepth >= RAREST_DEPTH)
const rollRarestKind = () => weighted(RAREST_KINDS.map(k => [k, k.weight] as [typeof k, number]))

// food for the climb back out: a rare mushroom or two, or lunaraqum
function rollFood() {
    if (Math.random() < 0.5) return { ...rollRarestKind().item(), qnty: randInt(1, 2) }
    return lunaraqum(randInt(2, 3))
}

// ── The chest ────────────────────────────────────────────────────────────────
// its headline piece (the chest's skin follows its rarity), then the rest
function rollChestContents(place: ThiddenPlace) {
    const rarity = rollRarity(place)
    const headline = Math.random() < 0.5 ? rollWeapon(rarity) : armorPiece(HEADLINE_METAL[rarity])
    const extras: any[] = [armorPiece(weighted(EXTRA_METALS[rarity]), new Set([headline.itemType]))]
    if (Math.random() < 0.5) extras.push(Math.random() < 0.4 ? royalPriestBelt() : priestBelt())
    extras.push(rollOre())
    if (Math.random() < 0.5) extras.push(rollFood())
    if (place.kind === "grotto") extras.push(bronzeCoins(place))
    return { headline, extras }
}

const placeByKey = (key: string) => HIDDEN_PLACES.find(p => p.key === key)
const at = (spot: ThiddenSpot, lift = 0) => ({ x: spot.x, y: round2(spot.y + lift), z: spot.z })

function hoardChest(place: ThiddenPlace) {
    const { headline, extras } = rollChestContents(place)
    return { ...createTreasure(at(place.chest), OPENWORLD_PLACE_ID, headline, extras), exactY: true, hoardKey: place.key, respawns: "hiddenHoard" }
}
addRespawningChest("hiddenHoard", {
    afterMs: HOARD_RESPAWN_MS,
    make: opened => hoardChest(placeByKey(opened.hoardKey)),
})

// a struck weapon's record (index.ts's Tstruckweapon). Its id is the item's
// own, as for one a player strikes (the client's emitStrikeWeapon) - the
// client names its mesh by it. The 0.02 keeps it off the floor, as
// itemInfoSystem.js's struckItemFunc does.
function hoardWeapon(place: ThiddenPlace) {
    const pos = at(place.weapon, 0.02)
    const item = rollWeapon(rollRarity(place), true)
    return {
        itemId: item.itemId, pos, currentPlaceId: OPENWORLD_PLACE_ID,
        itemDetail: { ...item, lootPosition: pos },
        ownerId: "hiddenhoard", exactY: true, hoardKey: place.key,
    }
}
/** A taken hidden-place weapon's replacement: when, and the new one then. null for any other struck weapon. */
export function hoardWeaponRespawnOf(taken: any) {
    const place = taken?.hoardKey && placeByKey(taken.hoardKey)
    return place ? { afterMs: HOARD_RESPAWN_MS, make: () => hoardWeapon(place) } : null
}

function hoardPatch(place: ThiddenPlace): Tmushroom[] {
    const { kind } = rollRarestKind()
    return Array.from({ length: randInt(PATCH_SIZE.min, PATCH_SIZE.max) }, () => {
        const a = Math.random() * Math.PI * 2
        // sqrt keeps the scatter even across the disc
        const r = Math.sqrt(Math.random()) * PATCH_RADIUS
        return {
            mushroomId: randNumString(), kind,
            pos: { x: round2(place.patch.x + Math.cos(a) * r), y: place.patch.y, z: round2(place.patch.z + Math.sin(a) * r) },
            currentPlaceId: OPENWORLD_PLACE_ID, exactY: true, regrowMs: PATCH_REGROW_MS,
        }
    })
}

export const HIDDEN_TREASURES = HIDDEN_PLACES.map(hoardChest)
export const HIDDEN_WEAPONS = HIDDEN_PLACES.filter(p => Math.random() < WEAPON_CHANCE[p.kind]).map(hoardWeapon)
export const HIDDEN_MUSHROOMS = HIDDEN_PLACES.flatMap(hoardPatch)

// for index.ts's start-up line
export function describeHoards() {
    const mythic = [...HIDDEN_TREASURES.map(t => t.itemDetail), ...HIDDEN_WEAPONS.map(w => w.itemDetail)].filter(i => i.rarity === "mythic").length
    return `${HIDDEN_PLACES.length} places, ${HIDDEN_TREASURES.length} chests, ${HIDDEN_WEAPONS.length} struck weapons, ` +
        `${HIDDEN_MUSHROOMS.length} mushrooms - ${mythic} mythic pieces`
}
