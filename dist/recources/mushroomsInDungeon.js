"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DUNGEON_MUSHROOMS = void 0;
const tools_1 = require("../tools/tools");
const dungeonLayouts_1 = require("./dungeonLayouts");
const treasuresInDungeon_1 = require("./treasuresInDungeon");
const mushroomLibrary_1 = require("./mushroomLibrary");
// clusters per room: one per this many floor cells, 1 to MAX
const CELLS_PER_CLUSTER = 14;
const MAX_CLUSTERS_PER_ROOM = 3;
// a room at least this deep (mushroomLibrary.ts's depth, 0-1) always has
// one cluster of a deep-only kind - left to the dice alone, a whole server
// run could go by without a single rare mushroom
const RARE_ROOM_DEPTH = 0.4;
// corridors: one cluster per this many corridor cells
const CORRIDOR_CELLS_PER_CLUSTER = 40;
const MUSHROOMS_PER_CLUSTER = { min: 3, max: 6 };
// how far a cluster spreads from its cell's centre - well inside the cell's
// own tile (cells are 4 wide), so every mushroom stands on the height tcp gives it
const CLUSTER_RADIUS = 1.2;
function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
// mushrooms like it damp and dark - against the wall, where there is one
function hugsWall(dungeon, c) {
    for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
            if ((dx || dy) && (dungeon.layout.grid[c.y + dy]?.[c.x + dx] ?? 0) === 0)
                return true;
    return false;
}
// `count` clusters on `cells`, each on its own cell, wall-hugging cells first.
// rareFirst: the first cluster is one of the deep-only kinds.
function clustersOn(placeId, dungeon, cells, count, rareFirst = false) {
    const pool = [...cells].sort(() => Math.random() - 0.5)
        .sort((a, b) => Number(hugsWall(dungeon, b)) - Number(hugsWall(dungeon, a)));
    const cs = dungeon.layout.cellSize;
    const depth = (0, dungeonLayouts_1.walkingDepth)(dungeon);
    const mushrooms = [];
    pool.slice(0, count).forEach((c, ci) => {
        const y = (0, dungeonLayouts_1.floorY)(dungeon, c, false);
        const { kind } = (0, mushroomLibrary_1.rollMushroomKind)(depth.get((0, dungeonLayouts_1.cellKey)(c)) ?? 0, rareFirst && ci === 0);
        const n = randInt(MUSHROOMS_PER_CLUSTER.min, MUSHROOMS_PER_CLUSTER.max);
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            // sqrt keeps the scatter even across the disc instead of bunching at its centre
            const r = Math.sqrt(Math.random()) * CLUSTER_RADIUS;
            mushrooms.push({
                mushroomId: (0, tools_1.randNumString)(),
                kind,
                pos: { x: round2((c.x + 0.5) * cs + Math.cos(a) * r), y: round2(y), z: round2((c.y + 0.5) * cs + Math.sin(a) * r) },
                currentPlaceId: placeId,
            });
        }
    });
    return mushrooms;
}
function spawnDungeonMushrooms(placeId, dungeon) {
    const cs = dungeon.layout.cellSize;
    // no mushrooms in the river or under a chest (standableCells already
    // leaves out walls, raised slabs, props and ore)
    const river = new Set(dungeon.rivers?.flatMap((r) => r.cells.map(dungeonLayouts_1.cellKey)) ?? []);
    const chests = new Set(treasuresInDungeon_1.DUNGEON_TREASURES
        .filter(t => t.currentPlaceId === placeId)
        .map(t => (0, dungeonLayouts_1.cellKey)({ x: Math.floor(t.pos.x / cs), y: Math.floor(t.pos.z / cs) })));
    const free = (c) => !river.has((0, dungeonLayouts_1.cellKey)(c)) && !chests.has((0, dungeonLayouts_1.cellKey)(c));
    const mushrooms = [];
    const roomKeys = new Set();
    // every room but the boss hall
    dungeon.rooms.forEach((room) => {
        const rect = (0, dungeonLayouts_1.roomRect)(room);
        for (let y = rect.y; y < rect.y + rect.h; y++)
            for (let x = rect.x; x < rect.x + rect.w; x++)
                roomKeys.add((0, dungeonLayouts_1.cellKey)({ x, y }));
        if (room.type === "boss_room")
            return;
        const cells = (0, dungeonLayouts_1.standableCells)(dungeon, rect, false).filter(free);
        const count = Math.min(MAX_CLUSTERS_PER_ROOM, Math.max(1, Math.round(rect.w * rect.h / CELLS_PER_CLUSTER)));
        const centre = { x: rect.x + Math.floor(rect.w / 2), y: rect.y + Math.floor(rect.h / 2) };
        const deep = ((0, dungeonLayouts_1.walkingDepth)(dungeon).get((0, dungeonLayouts_1.cellKey)(centre)) ?? 0) >= RARE_ROOM_DEPTH;
        mushrooms.push(...clustersOn(placeId, dungeon, cells, count, deep));
    });
    // and the odd cluster along the corridors between them
    const grid = dungeon.layout.grid;
    const corridor = (0, dungeonLayouts_1.standableCells)(dungeon, { x: 0, y: 0, w: grid[0].length, h: grid.length }, false)
        .filter(c => !roomKeys.has((0, dungeonLayouts_1.cellKey)(c)) && free(c));
    mushrooms.push(...clustersOn(placeId, dungeon, corridor, Math.round(corridor.length / CORRIDOR_CELLS_PER_CLUSTER)));
    return mushrooms;
}
exports.DUNGEON_MUSHROOMS = [...dungeonLayouts_1.DUNGEONS].flatMap(([placeId, dungeon]) => spawnDungeonMushrooms(placeId, dungeon));
