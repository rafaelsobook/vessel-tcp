"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cellKey = exports.DUNGEONS = void 0;
exports.toWorld = toWorld;
exports.rectCells = rectCells;
exports.roomRect = roomRect;
exports.bossRect = bossRect;
exports.stairKeys = stairKeys;
exports.occupiedKeys = occupiedKeys;
exports.standableCells = standableCells;
exports.bossThrone = bossThrone;
exports.walkingDepth = walkingDepth;
exports.floorY = floorY;
const generatebsp_1 = require("../generate-datas/generatebsp");
// The procedural BSP dungeons as the server knows them, and the grid helpers
// everything placed inside one shares (enemiesInDungeon.ts, treasuresInDungeon.ts).
// The server can't see a dungeon's walls, but generateBSPDungeon is
// deterministic: fed the same arguments as the client, it returns the exact
// grid - props, river, ore and all - that every client renders.
// MIRROR of the layout arguments of client/src/constants/localroomdb.js's
// DUNGEON_12 - tcp can't import client code (same arrangement as
// graveyards.ts). Change one side and the other has to follow, or enemies and
// chests end up inside walls. textures/sceneTemp/exitPlaceDetail and the ore's
// resourceTemplates don't affect where anything goes, so they're left out.
const DUNGEON_12 = (0, generatebsp_1.generateBSPDungeon)({
    placeId: 12,
    seed: 12345,
    rockDensity: 0,
    gridWidth: 32,
    gridHeight: 32,
    cellSize: 4,
    wallHeight: 15,
    corridorWidth: 3,
    // 5, as the client's (dungeons.js) - it was 2 here while the client had
    // moved to 5, and every room came out different on the two sides
    bossRoomWidthScale: 5,
});
exports.DUNGEONS = new Map([[12, DUNGEON_12]]);
// anything higher than this is a raised slab - a wall to walkers (the
// generator's TILE_JITTER_NORMAL.max), so never a spawn, wander or chest spot
const WALKABLE_JITTER = 0.04;
const cellKey = (c) => `${c.x}_${c.y}`;
exports.cellKey = cellKey;
function toWorld(dungeon, c) {
    const cs = dungeon.layout.cellSize;
    return { x: (c.x + 0.5) * cs, z: (c.y + 0.5) * cs };
}
function rectCells(r) {
    const cells = [];
    for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++)
            cells.push({ x, y });
    return cells;
}
function roomRect(room) {
    return { x: room.bounds.x, y: room.bounds.y, w: room.bounds.width, h: room.bounds.height };
}
function bossRect(dungeon) {
    const b = dungeon.bossRoom;
    return { x: b.gridX, y: b.gridY, w: b.width, h: b.height };
}
// the boss room cells the entrance staircase is cut into (createDungeon's own
// stairKeys) - they slope from the floor up to the dais
function stairKeys(dungeon) {
    const keys = new Set();
    const { elevation, entrance } = dungeon.bossRoom;
    if (!(elevation > 0) || !entrance)
        return keys;
    entrance.cells.forEach((c) => {
        for (let k = 1; k <= entrance.stairCells; k++)
            keys.add((0, exports.cellKey)({ x: c.x + entrance.dx * k, y: c.y + entrance.dz * k }));
    });
    return keys;
}
// cells something solid stands on - props (torches, barrels, chests, vases)
// and ore. The river is shallow water you wade through, so it isn't one.
function occupiedKeys(dungeon) {
    return new Set([
        ...(dungeon.props ?? []).map((p) => (0, exports.cellKey)(p)),
        ...(dungeon.resources ?? []).map((r) => (0, exports.cellKey)(r.cell)),
    ]);
}
// where something of `home` may stand: ordinary rooms - their floor minus
// raised slabs and occupied cells; the boss room - its raised dais, minus the
// stairs and whatever stands on it
function standableCells(dungeon, home, isBossRoom) {
    const occupied = occupiedKeys(dungeon);
    if (isBossRoom) {
        const stairs = stairKeys(dungeon);
        return rectCells(home).filter(c => !stairs.has((0, exports.cellKey)(c)) && !occupied.has((0, exports.cellKey)(c)));
    }
    return rectCells(home).filter(c => dungeon.layout.grid[c.y]?.[c.x] === 1
        && (dungeon.tileHeights[(0, exports.cellKey)(c)] ?? 0) <= WALKABLE_JITTER
        && !occupied.has((0, exports.cellKey)(c)));
}
// The boss's spot - the dais cell furthest from the stairs, as close to the
// room's centre line as it gets - plus a measure of how deep into the room
// (along the stairs' direction) any cell is. null when there's no dais/entrance.
function bossThrone(dungeon) {
    const boss = bossRect(dungeon);
    const entrance = dungeon.bossRoom.entrance;
    const dais = standableCells(dungeon, boss, true);
    if (!dais.length || !entrance)
        return null;
    const centre = { x: boss.x + (boss.w - 1) / 2, y: boss.y + (boss.h - 1) / 2 };
    const depth = (c) => c.x * entrance.dx + c.y * entrance.dz;
    const offCentre = (c) => entrance.dx !== 0 ? Math.abs(c.y - centre.y) : Math.abs(c.x - centre.x);
    const cell = dais.reduce((best, c) => depth(c) > depth(best) || (depth(c) === depth(best) && offCentre(c) < offCentre(best)) ? c : best);
    return { cell, depth };
}
// How deep into the dungeon every floor cell is: its walking distance from
// the spawn (4-way steps over any floor), scaled so the furthest cell is 1.
// cellKey -> 0..1. Unreachable cells (there shouldn't be any) are left out.
const depthCache = new WeakMap();
function walkingDepth(dungeon) {
    const cached = depthCache.get(dungeon);
    if (cached)
        return cached;
    const grid = dungeon.layout.grid;
    const start = { x: Math.floor(dungeon.spawn.x), y: Math.floor(dungeon.spawn.z) };
    const steps = new Map([[(0, exports.cellKey)(start), 0]]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
        const c = queue[i];
        const d = steps.get((0, exports.cellKey)(c));
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = { x: c.x + dx, y: c.y + dy };
            if ((grid[n.y]?.[n.x] ?? 0) === 0 || steps.has((0, exports.cellKey)(n)))
                continue;
            steps.set((0, exports.cellKey)(n), d + 1);
            queue.push(n);
        }
    }
    const furthest = Math.max(1, ...steps.values());
    const depth = new Map([...steps].map(([k, d]) => [k, d / furthest]));
    depthCache.set(dungeon, depth);
    return depth;
}
// floor height of a cell - the dais for the boss room, the tile's own jitter
// elsewhere (createEnemy.js stands a non-openworld enemy at its own y)
function floorY(dungeon, c, isBossRoom) {
    return isBossRoom ? dungeon.bossRoom.elevation : (dungeon.tileHeights[(0, exports.cellKey)(c)] ?? 0);
}
