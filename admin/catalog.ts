import { randNumString } from "../tools/tools"
import {
    generateSlimes, generateFireSlimes, generateElectricSlimes, generateDarkSlimes, generateMonoliths,
    generateForestDeer, generateJasferDeer, generateLuminaDeer, generateNightmareDeer, generateScorchDeer, generateWisfDeer,
    generateLesserDemons, generateGhosts, generateIceScorpions, generateStrayWolves, generateStandingWolf,
} from "../generate-datas/genenemy"
import { MUSHROOM_LIBRARY } from "../recources/mushroomLibrary"
import { createSwordTreasure } from "../recources/treasures"
import { simpleCoreLoot, mediumCoreLoot, waterslimeCoreLoot, fireslimeCoreLoot, electricslimeCoreLoot, darkslimeCoreLoot, orangelithCoreLoot, celestineOreLoot } from "../recources/coreDetails"
import { beastMeatLoot } from "../recources/meatLoots"
import { DUNGEONS } from "../recources/dungeonLayouts"
import { floorPlan } from "./geo"

// What the admin page can offer: the enemies that can be spawned, the places
// that exist, and the items a chest can hold. Everything about an enemy is read
// off a sample from its own generator, so the list can't drift from the data.

// ── enemies ──────────────────────────────────────────────────────────────────
// (total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
export type EnemyGenerator = (total: number, placeId: number, areaSize: number, areaType: string, centerX: number, centerZ: number, minRadius: number, maxRadius: number) => any[]

const standingWolf = (name: "vargoth" | "zareth" | "morvane" | "skallgrim"): EnemyGenerator =>
    (total, placeId, areaSize, areaType, cx, cz, min, max) => generateStandingWolf(name, total, placeId, areaSize, areaType, cx, cz, min, max)

const SOURCES: { group: string, gen: EnemyGenerator }[] = [
    { group: "Slimes", gen: generateSlimes },
    { group: "Slimes", gen: generateFireSlimes },
    { group: "Slimes", gen: generateElectricSlimes },
    { group: "Slimes", gen: generateDarkSlimes },
    { group: "Monsters", gen: generateMonoliths },
    { group: "Monsters", gen: generateGhosts },
    { group: "Monsters", gen: generateIceScorpions },
    { group: "Monsters", gen: generateLesserDemons },
    { group: "Deer", gen: generateForestDeer },
    { group: "Deer", gen: generateJasferDeer },
    { group: "Deer", gen: generateLuminaDeer },
    { group: "Deer", gen: generateNightmareDeer },
    { group: "Deer", gen: generateScorchDeer },
    { group: "Deer", gen: generateWisfDeer },
    { group: "Wolves", gen: generateStrayWolves },
    { group: "Wolves", gen: standingWolf("vargoth") },
    { group: "Wolves", gen: standingWolf("zareth") },
    { group: "Wolves", gen: standingWolf("morvane") },
    { group: "Wolves", gen: standingWolf("skallgrim") },
]

export type EnemyKind = { name: string, dn: string, group: string, lvl: number, maxHp: number, modelStyle: string, gen: EnemyGenerator }

export const ENEMY_KINDS: EnemyKind[] = SOURCES.map(({ group, gen }) => {
    const sample = gen(1, 1, 0, "fixed", 0, 0, 0, 0)[0]
    return { name: sample.name, dn: sample.dn ?? sample.name, group, lvl: sample.lvl, maxHp: sample.maxHp, modelStyle: sample.modelStyle, gen }
})

export const enemyKind = (name: string) => ENEMY_KINDS.find(kind => kind.name === name)

// ── places ───────────────────────────────────────────────────────────────────
// Mirrors the client's constants/places (names, sizes, spawn points) - tcp can't
// import client code. `view` is where the map first looks: its centre and how
// many units across it shows.
export type Place = {
    placeId: number
    name: string
    areaType: string
    // where "send to spawn" and "unstick" put a player; y is the height of the
    // floor there, left out where the client works it out from the terrain
    spawn: { x: number, y?: number, z: number }
    view: { cx: number, cz: number, span: number }
    // a dungeon's walkable cells (geo.ts's floorPlan), for the map to draw
    floor?: { cellSize: number, rows: string[] }
}

const room = (placeId: number, name: string, width: number, height: number, spawn: Place["spawn"]): Place =>
    ({ placeId, name, areaType: "room", spawn, view: { cx: 0, cz: 0, span: Math.max(width, height) + 6 } })
const duel = (placeId: number, name: string): Place =>
    ({ placeId, name, areaType: "duel", spawn: { x: 0, y: 0.4, z: -20 }, view: { cx: 0, cz: 0, span: 70 } })

const dungeon12 = DUNGEONS.get(12)
// the generator widens the grid past the gridWidth it was given when the boss
// room needs the space, so the size is read off the layout it returned
const dungeonWidth = dungeon12 ? dungeon12.layout.width * dungeon12.layout.cellSize : 128
const dungeonDepth = dungeon12 ? dungeon12.layout.height * dungeon12.layout.cellSize : 128

export const PLACES: Place[] = [
    { placeId: 1, name: "Village", areaType: "village", spawn: { x: 0.6, y: 1, z: -10 }, view: { cx: 0, cz: 0, span: 340 } },
    { placeId: 888, name: "Open world", areaType: "openworld", spawn: { x: 0, z: 500 }, view: { cx: 0, cz: 500, span: 900 } },
    {
        placeId: 12, name: "Dungeon", areaType: "dungeon",
        spawn: dungeon12 ? { x: dungeon12.spawn.x * dungeon12.layout.cellSize, y: 0.4, z: dungeon12.spawn.z * dungeon12.layout.cellSize } : { x: 8, y: 0.4, z: 8 },
        view: { cx: dungeonWidth / 2, cz: dungeonDepth / 2, span: Math.max(dungeonWidth, dungeonDepth) + 12 },
        floor: dungeon12 ? floorPlan(dungeon12) : undefined,
    },
    room(9, "Guild House", 24, 20, { x: 4.4, y: 0.4, z: 2.5 }),
    room(10, "Simple Room", 14, 14, { x: 0, y: 1, z: -2 }),
    room(101, "Guildmaster's Office", 20, 16, { x: 0, y: 0.4, z: -1 }),
    room(15, "Witch House", 9, 12, { x: 0, y: 1, z: -4 }),
    room(16, "Ilvara's Tower", 8, 10, { x: 0, y: 1, z: -4 }),
    room(17, "Sable's Tower", 8, 10, { x: 0, y: 1, z: -4 }),
    room(18, "Tavern", 20, 14, { x: 0, y: 1, z: -4 }),
    duel(200, "Dueling Grounds"),
    duel(201, "Colousa's Dueling Grounds"),
    duel(202, "Vesper's Dueling Grounds"),
]

export const placeById = (placeId: number) => PLACES.find(place => place.placeId === placeId)

// ── items a chest can hold ───────────────────────────────────────────────────
export type ItemPreset = { key: string, label: string, build: (qnty: number) => any }

// the starter ration the client gives new members (client/src/staticRecources/foodItems.js)
const jerky = (qnty: number) => ({
    itemId: randNumString(),
    name: "jerky",
    dn: "Jerky",
    itemCateg: "consumable",
    itemType: "food",
    weaponType: false,
    consumeAbilities: { plusHp: 50, plusMp: 0, plusSp: 10, plusDmg: 0, plusSpd: 0, fillHunger: 30, fillTireness: 0, cure: [] },
    price: { coinType: "bronze", pieces: 5 },
    qnty,
    desc: "Strips of dried, salted meat - tough to chew, but it keeps for weeks on the road. A guild ration for new members.",
    rarity: "normal",
})

// a loot object from the data files carries one fixed itemId - every chest needs its own
const fresh = (loot: any) => (qnty: number) => ({ ...loot, itemId: randNumString(), qnty })

export const ITEM_PRESETS: ItemPreset[] = [
    { key: "sword", label: "Sunfang Edge (rare sword)", build: () => createSwordTreasure({ x: 0, y: 0, z: 0 }).itemDetail },
    { key: "jerky", label: "Jerky", build: jerky },
    { key: "beastmeat", label: "Beast Meat", build: fresh(beastMeatLoot) },
    ...MUSHROOM_LIBRARY.map(kind => ({
        key: `mushroom:${kind.kind}`,
        label: `Mushroom - ${kind.item().dn}`,
        build: (qnty: number) => ({ ...kind.item(), qnty }),
    })),
    { key: "core:small", label: "Small core", build: fresh(simpleCoreLoot) },
    { key: "core:medium", label: "Medium core", build: fresh(mediumCoreLoot) },
    { key: "core:waterslime", label: "Water slime core", build: fresh(waterslimeCoreLoot) },
    { key: "core:fireslime", label: "Fire slime core", build: fresh(fireslimeCoreLoot) },
    { key: "core:electricslime", label: "Electric slime core", build: fresh(electricslimeCoreLoot) },
    { key: "core:darkslime", label: "Dark slime core", build: fresh(darkslimeCoreLoot) },
    { key: "core:orangelith", label: "Orange lith core", build: fresh(orangelithCoreLoot) },
    { key: "celestineore", label: "Celestine ore", build: fresh(celestineOreLoot) },
]

export const itemPreset = (key: string) => ITEM_PRESETS.find(preset => preset.key === key)

export const MUSHROOM_KINDS = MUSHROOM_LIBRARY.map(kind => ({ kind: kind.kind, dn: kind.item().dn, rarity: kind.item().rarity }))
