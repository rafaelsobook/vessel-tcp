"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MUSHROOM_KINDS = exports.ORE_VEINS = exports.itemPreset = exports.ITEM_PRESETS = exports.placeById = exports.PLACES = exports.enemyKind = exports.ENEMY_KINDS = void 0;
const tools_1 = require("../tools/tools");
const genenemy_1 = require("../generate-datas/genenemy");
const mushroomLibrary_1 = require("../recources/mushroomLibrary");
const ores_1 = require("../recources/ores");
const treasures_1 = require("../recources/treasures");
const coreDetails_1 = require("../recources/coreDetails");
const meatLoots_1 = require("../recources/meatLoots");
const dungeonLayouts_1 = require("../recources/dungeonLayouts");
const geo_1 = require("./geo");
const standingWolf = (name) => (total, placeId, areaSize, areaType, cx, cz, min, max) => (0, genenemy_1.generateStandingWolf)(name, total, placeId, areaSize, areaType, cx, cz, min, max);
const SOURCES = [
    { group: "Slimes", gen: genenemy_1.generateSlimes },
    { group: "Slimes", gen: genenemy_1.generateFireSlimes },
    { group: "Slimes", gen: genenemy_1.generateElectricSlimes },
    { group: "Slimes", gen: genenemy_1.generateDarkSlimes },
    { group: "Monsters", gen: genenemy_1.generateMonoliths },
    { group: "Monsters", gen: genenemy_1.generateGhosts },
    { group: "Monsters", gen: genenemy_1.generateIceScorpions },
    { group: "Monsters", gen: genenemy_1.generateLesserDemons },
    { group: "Deer", gen: genenemy_1.generateForestDeer },
    { group: "Deer", gen: genenemy_1.generateJasferDeer },
    { group: "Deer", gen: genenemy_1.generateLuminaDeer },
    { group: "Deer", gen: genenemy_1.generateNightmareDeer },
    { group: "Deer", gen: genenemy_1.generateScorchDeer },
    { group: "Deer", gen: genenemy_1.generateWisfDeer },
    { group: "Wolves", gen: genenemy_1.generateStrayWolves },
    { group: "Wolves", gen: standingWolf("vargoth") },
    { group: "Wolves", gen: standingWolf("zareth") },
    { group: "Wolves", gen: standingWolf("morvane") },
    { group: "Wolves", gen: standingWolf("skallgrim") },
];
exports.ENEMY_KINDS = SOURCES.map(({ group, gen }) => {
    const sample = gen(1, 1, 0, "fixed", 0, 0, 0, 0)[0];
    return { name: sample.name, dn: sample.dn ?? sample.name, group, lvl: sample.lvl, maxHp: sample.maxHp, modelStyle: sample.modelStyle, gen };
});
const enemyKind = (name) => exports.ENEMY_KINDS.find(kind => kind.name === name);
exports.enemyKind = enemyKind;
const room = (placeId, name, width, height, spawn) => ({ placeId, name, areaType: "room", spawn, view: { cx: 0, cz: 0, span: Math.max(width, height) + 6 } });
const duel = (placeId, name) => ({ placeId, name, areaType: "duel", spawn: { x: 0, y: 0.4, z: -20 }, view: { cx: 0, cz: 0, span: 70 } });
const dungeon12 = dungeonLayouts_1.DUNGEONS.get(12);
// the generator widens the grid past the gridWidth it was given when the boss
// room needs the space, so the size is read off the layout it returned
const dungeonWidth = dungeon12 ? dungeon12.layout.width * dungeon12.layout.cellSize : 128;
const dungeonDepth = dungeon12 ? dungeon12.layout.height * dungeon12.layout.cellSize : 128;
exports.PLACES = [
    { placeId: 1, name: "Village", areaType: "village", spawn: { x: 0.6, y: 1, z: -10 }, view: { cx: 0, cz: 0, span: 340 } },
    { placeId: 888, name: "Open world", areaType: "openworld", spawn: { x: 0, z: 500 }, view: { cx: 0, cz: 500, span: 900 } },
    {
        placeId: 12, name: "Dungeon", areaType: "dungeon",
        spawn: dungeon12 ? { x: dungeon12.spawn.x * dungeon12.layout.cellSize, y: 0.4, z: dungeon12.spawn.z * dungeon12.layout.cellSize } : { x: 8, y: 0.4, z: 8 },
        view: { cx: dungeonWidth / 2, cz: dungeonDepth / 2, span: Math.max(dungeonWidth, dungeonDepth) + 12 },
        floor: dungeon12 ? (0, geo_1.floorPlan)(dungeon12) : undefined,
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
    duel(203, "Ilvara's Dueling Grounds"),
    duel(204, "Sable's Dueling Grounds"),
];
const placeById = (placeId) => exports.PLACES.find(place => place.placeId === placeId);
exports.placeById = placeById;
// the starter ration the client gives new members (client/src/staticRecources/foodItems.js)
const jerky = (qnty) => ({
    itemId: (0, tools_1.randNumString)(),
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
});
// a loot object from the data files carries one fixed itemId - every chest needs its own
const fresh = (loot) => (qnty) => ({ ...loot, itemId: (0, tools_1.randNumString)(), qnty });
exports.ITEM_PRESETS = [
    { key: "sword", label: "Sunfang Edge (rare sword)", build: () => (0, treasures_1.createSwordTreasure)({ x: 0, y: 0, z: 0 }).itemDetail },
    { key: "jerky", label: "Jerky", build: jerky },
    { key: "beastmeat", label: "Beast Meat", build: fresh(meatLoots_1.beastMeatLoot) },
    { key: "wolfrib", label: "Wolf Rib", build: fresh(meatLoots_1.wolfRibLoot) },
    ...mushroomLibrary_1.MUSHROOM_LIBRARY.map(kind => ({
        key: `mushroom:${kind.kind}`,
        label: `Mushroom - ${kind.item().dn}`,
        build: (qnty) => ({ ...kind.item(), qnty }),
    })),
    { key: "core:small", label: "Small core", build: fresh(coreDetails_1.simpleCoreLoot) },
    { key: "core:medium", label: "Medium core", build: fresh(coreDetails_1.mediumCoreLoot) },
    { key: "core:waterslime", label: "Water slime core", build: fresh(coreDetails_1.waterslimeCoreLoot) },
    { key: "core:fireslime", label: "Fire slime core", build: fresh(coreDetails_1.fireslimeCoreLoot) },
    { key: "core:electricslime", label: "Electric slime core", build: fresh(coreDetails_1.electricslimeCoreLoot) },
    { key: "core:darkslime", label: "Dark slime core", build: fresh(coreDetails_1.darkslimeCoreLoot) },
    { key: "core:orangelith", label: "Orange lith core", build: fresh(coreDetails_1.orangelithCoreLoot) },
    { key: "celestineore", label: "Celestine ore", build: fresh(coreDetails_1.celestineOreLoot) },
];
const itemPreset = (key) => exports.ITEM_PRESETS.find(preset => preset.key === key);
exports.itemPreset = itemPreset;
// every kind of ore vein an admin can put down - its look and what it holds
exports.ORE_VEINS = Object.entries(ores_1.VEINS).map(([vein, loots]) => ({ vein, color: (0, ores_1.oreColor)(loots), holds: loots.map(loot => loot.name).join(", ") }));
exports.MUSHROOM_KINDS = mushroomLibrary_1.MUSHROOM_LIBRARY.map(kind => ({ kind: kind.kind, dn: kind.item().dn, rarity: kind.item().rarity }));
