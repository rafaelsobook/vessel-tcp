import { randNumString } from "../tools/tools"
import { DUNGEONS } from "./dungeonLayouts"
import { isNearCastle } from "./castles"
import { CRYSTAL_HOLLOW_SPOTS } from "./crystalHollows"
import { HIDDEN_PLACES } from "./hiddenPlaces"

// Ore deposits you mine with a pickaxe - the village's, the dungeons', the rich
// veins far out in the open world, and those in the grottos' mazes. The
// client's components/oreDeposits.js builds each one and runs the walk-up +
// mine flow; every swing of the pickaxe
// is a "mineOre" here (index.ts), one hit point off the deposit. At 0 it's
// gone - removed here and from every client ("ore-removed"). Rolled fresh
// each server start, like the grains and mushrooms.
//
// What a swing digs out is the client's to roll, against the deposit's loots
// (each { name, chance } - a staticRecources/resourceLoot.js material and
// its odds per swing), as it always has for any minable resource.

export type ToreLoot = { name: string, chance: number }
export type Tore = {
    oreId: string
    // which vein (VEINS below)
    vein: string
    // its look - client/public/images/modeltex/recources/ore<color>.jpg
    color: string
    pos: { x: number, y: number, z: number }
    rotation: number
    currentPlaceId: number
    hp: number
    maxHp: number
    loots: ToreLoot[]
    // the "hollow" vein only: which of the Crystal Hollows' three crystals it
    // is (0 violet, 1 teal, 2 rose) - the client draws it as that crystal
    tint?: number
}

// every swing takes one; 100 swings and it's worked out
const ORE_HP = 100
// and an hour after it is, a fresh one stands where it did (index.ts's "mineOre")
export const ORE_RESPAWN_MS = 60 * 60 * 1000

// The kinds of vein. Their colour isn't picked by hand: it's the colour of the
// rarest thing in them (oreColor), so a vein always looks like what it holds.
export const VEINS: Record<string, ToreLoot[]> = {
    // the village's and the dungeons' everyday vein
    plain: [
        { name: "stone", chance: 0.25 },
        { name: "bronzeore", chance: 0.15 },
    ],
    // the dungeons' two (the client's old dungeons.js resourceTemplates)
    silver: [
        { name: "stone", chance: 0.25 },
        { name: "bronzeore", chance: 0.15 },
        { name: "silverore", chance: 0.08 },
        { name: "solarore", chance: 0.045 },
    ],
    rich: [
        { name: "stone", chance: 0.15 },
        { name: "rubyore", chance: 0.06 },
        { name: "manastone", chance: 0.05 },
        { name: "bloodstone", chance: 0.03 },
    ],
    // the Crystal Hollows' own crystals (crystalHollows.ts) - the same real
    // materials as the wild "crystal" vein below, but standing as the great
    // crystals of the hollows rather than a mound of rock
    hollow: [
        { name: "stone", chance: 0.15 },
        { name: "crystal", chance: 0.07 },
        { name: "manastone", chance: 0.06 },
    ],
    // out in the wild, ~3000 from the spawn
    crystal: [
        { name: "stone", chance: 0.15 },
        { name: "crystal", chance: 0.07 },
        { name: "manastone", chance: 0.06 },
    ],
    solar: [
        { name: "stone", chance: 0.15 },
        { name: "solarore", chance: 0.08 },
        { name: "sunduskore", chance: 0.05 },
    ],
    adamant: [
        { name: "stone", chance: 0.12 },
        { name: "silverore", chance: 0.08 },
        { name: "adamantine", chance: 0.04 },
    ],
    orichalcum: [
        { name: "stone", chance: 0.12 },
        { name: "adamantine", chance: 0.04 },
        { name: "orichalcum", chance: 0.02 },
    ],
    phoenix: [
        { name: "stone", chance: 0.12 },
        { name: "sunduskore", chance: 0.06 },
        { name: "phoenixore", chance: 0.015 },
    ],
    abyssal: [
        { name: "stone", chance: 0.1 },
        { name: "bloodstone", chance: 0.05 },
        { name: "unobtanium", chance: 0.008 },
    ],
}

// Each material's colour, rarest first - an ore takes the colour of the first
// of these it holds (stone alone, or bronze, is the plain dark rock)
const COLOR_BY_MATERIAL: [string, string][] = [
    ["unobtanium", "purple"],
    ["phoenixore", "red"],
    ["orichalcum", "green"],
    ["adamantine", "blue"],
    ["crystal", "gloom"],
    ["bloodstone", "red"],
    ["rubyore", "red"],
    ["sunduskore", "gold"],
    ["solarore", "gold"],
    ["manastone", "purple"],
    ["silverore", "white"],
    ["bronzeore", "dark"],
]
export function oreColor(loots: ToreLoot[]): string {
    return COLOR_BY_MATERIAL.find(([material]) => loots.some(loot => loot.name === material))?.[1] ?? "dark"
}

function round2(n: number) {
    return Math.round(n * 100) / 100
}

export function makeOre(vein: string, pos: { x: number, y: number, z: number }, currentPlaceId: number, rotation = Math.random() * Math.PI * 2): Tore {
    const loots = VEINS[vein]
    // a hollow's colour comes from where it stands, so a regrown one (index.ts's
    // "mineOre" calls this again with the same spot) is the same crystal
    const tint = vein === "hollow" ? (((Math.round(pos.x) * 73856093) ^ (Math.round(pos.z) * 19349663)) >>> 0) % 3 : undefined
    return {
        oreId: randNumString(), vein, color: oreColor(loots),
        pos: { x: round2(pos.x), y: round2(pos.y), z: round2(pos.z) }, rotation: round2(rotation),
        currentPlaceId, hp: ORE_HP, maxHp: ORE_HP, loots: loots.map(loot => ({ ...loot })),
        ...(tint === undefined ? {} : { tint }),
    }
}

// ── the village (placeId 1) - one plain vein, where its ore always stood
const VILLAGE_PLACE_ID = 1
function villageOres(): Tore[] {
    return [makeOre("plain", { x: -16, y: 0, z: 108 }, VILLAGE_PLACE_ID, 0)]
}

// ── the dungeons - at the generator's own ore spots (dungeonLayouts.ts runs
// the same generator as the client, so they stand where its rooms leave room
// for them), the veins dealt in turn
const DUNGEON_VEINS = ["silver", "rich"]
function dungeonOres(): Tore[] {
    return [...DUNGEONS].flatMap(([placeId, dungeon]) =>
        (dungeon.resources ?? []).map((spot: any, i: number) =>
            makeOre(DUNGEON_VEINS[i % DUNGEON_VEINS.length], spot.position, placeId, spot.rotation)))
}

// ── the open world (placeId 888) - the rich veins, far out in the wild round
// the spawn (0, 500), out where the stray wolves hunt. y stays 0: tcp has no
// terrain, the client grounds each one (worldsocket.js, like the grains).
const OPENWORLD_PLACE_ID = 888
const OPENWORLD_CENTER = { x: 0, z: 500 }
const OPENWORLD_ORE_COUNT = 40
const OPENWORLD_MIN_DIST = 2800
const OPENWORLD_MAX_DIST = 3300
// how often each vein turns up out there, against the others
const WILD_VEINS: [string, number][] = [
    ["crystal", 6], ["solar", 6], ["adamant", 5], ["orichalcum", 3], ["phoenix", 2], ["abyssal", 1],
]
const CASTLE_MARGIN = 10

function rollWildVein(): string {
    let roll = Math.random() * WILD_VEINS.reduce((sum, [, weight]) => sum + weight, 0)
    for (const [vein, weight] of WILD_VEINS) {
        roll -= weight
        if (roll < 0) return vein
    }
    return WILD_VEINS[0][0]
}
function openworldOres(): Tore[] {
    const ores: Tore[] = []
    while (ores.length < OPENWORLD_ORE_COUNT) {
        const angle = Math.random() * Math.PI * 2
        const dist = OPENWORLD_MIN_DIST + Math.random() * (OPENWORLD_MAX_DIST - OPENWORLD_MIN_DIST)
        const x = OPENWORLD_CENTER.x + Math.cos(angle) * dist
        const z = OPENWORLD_CENTER.z + Math.sin(angle) * dist
        if (isNearCastle(x, z, CASTLE_MARGIN)) continue
        ores.push(makeOre(rollWildVein(), { x, y: 0, z }, OPENWORLD_PLACE_ID))
    }
    return ores
}

// ── the Crystal Hollows (open world) - a great crystal at each of the spots
// generate-datas/genCrystalHollows.mjs found inside the biome
function hollowOres(): Tore[] {
    return CRYSTAL_HOLLOW_SPOTS
        .filter(spot => !isNearCastle(spot.x, spot.z, CASTLE_MARGIN))
        .map(spot => makeOre("hollow", { x: spot.x, y: 0, z: spot.z }, OPENWORLD_PLACE_ID))
}

// ── the grottos (open world) - veins in the maze inside each crag, at the ore
// spots infterrain keeps clear for them (hiddenPlaces.ts), the dungeons' two
// dealt in turn. The maze's floor is the ground, flattened, so the client
// grounds them like any other open-world ore
const GROTTO_VEINS = ["silver", "rich"]
function grottoOres(): Tore[] {
    return HIDDEN_PLACES.flatMap(place =>
        place.ores.map((spot, i) => makeOre(GROTTO_VEINS[i % GROTTO_VEINS.length], spot, OPENWORLD_PLACE_ID)))
}

export const startingOres: Tore[] = [...villageOres(), ...dungeonOres(), ...openworldOres(), ...hollowOres(), ...grottoOres()]
