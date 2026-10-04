// @ts-nocheck
// VERBATIM COPY of client/src/generate-datas/generatebsp.js - the client and
// this server must generate byte-identical dungeons from the same arguments
// (recources/enemiesInDungeon.ts places enemies on the server's copy of the
// layout, the client renders its own). Don't edit this file: change the
// client's and copy it over again, everything below this header unchanged.
// ts-nocheck because it's untyped JS; it still compiles as-is.

/**
 * bspDungeonGenerator.js  – v6
 * Changes from v5:
 *  - BSP split can no longer produce undersized leaves (overlapping rooms,
 *    floor on the grid's outer edge)
 *  - every floor cell is guaranteed reachable from the spawn
 *  - the boss room has exactly one entrance and a raised dais (bossRoom.elevation)
 *    reached by a staircase cut into it (bossRoom.entrance)
 *  - raised slabs only inside rooms, and never where they'd cut off a path
 * Changes from v4:
 *  - dungeon.tileHeights added: a flat object keyed "gx_gz" → Y offset (world units)
 *    Each floor cell gets a small deterministic random height lift so tiles appear
 *    slightly uneven, like real stone slabs. Range is controlled by TILE_HEIGHT_JITTER.
 *    generateDungeon reads this map and adds the offset to each floor tile's Y position.
 */

const T_WALL     = 0;
const T_FLOOR    = 1;
const T_CORRIDOR = 4;

// ─── Tile height jitter ────────────────────────────────────────────────────
//
// Two-tier system: most tiles get a subtle micro-jitter, but a small
// percentage get a much larger "raised slab" lift — visibly sticking up
// like a heaved flagstone.
//
// TILE_JITTER_NORMAL   range for the 85% majority  → subtle unevenness
// TILE_JITTER_RAISED   range for the 15% minority  → clearly raised slab
// TILE_RAISED_CHANCE   probability a tile ROLLS the raised tier (0–1) - far
//                      fewer keep it, see buildTileHeightMap
//
// The player's collider is a box (createcharacter.js) with no step-up logic -
// Havok-tested, it walks over a ledge up to ~0.04 and is stopped by 0.06+.
// So the normal tier stays walkable, and every raised slab is an obstacle
// you walk around (or jump onto) - buildTileHeightMap only allows one where
// it can't cut off any path.
const TILE_JITTER_NORMAL = { min: 0.0,  max:0.04  };
const TILE_JITTER_RAISED = { min: 0.04,  max: 0.5  };
const TILE_RAISED_CHANCE = 0.15;

// ─── Boss dais ─────────────────────────────────────────────────────────────
// Steepest rise-per-run the staircase ramp may have (~14°) - the box collider
// walked a 2-over-8 ramp in the same Havok test, while 0.1 risers stopped it
// dead, which is why createDungeon walks you up an invisible ramp instead of
// the visible steps.
const MAX_STAIR_SLOPE = 0.25;

// ─── PRNG ──────────────────────────────────────────────────────────────────
function seededRNG(seed) {
    let s = seed >>> 0;
    return () => {
        s += 0x6d2b79f5;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function rInt(rng, lo, hi) { return Math.floor(rng() * (hi - lo + 1)) + lo; }

// ─── Grid ──────────────────────────────────────────────────────────────────
function inBounds(grid, x, y) {
    return y >= 0 && y < grid.length && x >= 0 && x < grid[0].length;
}
function get(grid, x, y)        { return inBounds(grid, x, y) ? grid[y][x] : T_WALL; }
function set(grid, x, y, tile)  { if (inBounds(grid, x, y)) grid[y][x] = tile; }
function fillRect(grid, x, y, w, h, tile) {
    for (let row = y; row < y + h; row++)
        for (let col = x; col < x + w; col++)
            set(grid, col, row, tile);
}

// ─── BSP ───────────────────────────────────────────────────────────────────
const MIN_LEAF = 8;

class BSPNode {
    constructor(x, y, w, h) {
        this.x = x; this.y = y; this.w = w; this.h = h;
        this.left = null; this.right = null; this.room = null;
    }
    isLeaf() { return !this.left && !this.right; }
    centre() {
        if (this.room) return {
            x: this.room.x + Math.floor(this.room.w / 2),
            y: this.room.y + Math.floor(this.room.h / 2),
        };
        const lc = this.left?.centre(), rc = this.right?.centre();
        if (lc && rc) return { x: Math.floor((lc.x + rc.x) / 2), y: Math.floor((lc.y + rc.y) / 2) };
        return lc ?? rc ?? { x: this.x + Math.floor(this.w / 2), y: this.y + Math.floor(this.h / 2) };
    }
    leaves(out = []) {
        if (this.isLeaf()) { out.push(this); return out; }
        this.left?.leaves(out); this.right?.leaves(out); return out;
    }
}

function splitNode(node, rng, depth = 0) {
    if (depth >= 5) return;
    const canW = node.w >= MIN_LEAF * 2, canH = node.h >= MIN_LEAF * 2;
    if (!canW && !canH) return;
    let horiz = node.h >= node.w;
    // The random flip has to come BEFORE the can-split guards - after them it
    // could pick an axis too short to split (< MIN_LEAF*2), which left
    // undersized leaves, overlapping rooms and floor on the grid's outer edge
    // (open to the void) on ~2/3 of seeds. Same single rng() call per split
    // either way, so seeds the old order never broke generate identically.
    if (rng() < 0.2) horiz = !horiz;
    if (canW && !canH) horiz = false;
    if (canH && !canW) horiz = true;
    if (horiz) {
        const sp = rInt(rng, MIN_LEAF, node.h - MIN_LEAF);
        node.left  = new BSPNode(node.x, node.y,        node.w, sp);
        node.right = new BSPNode(node.x, node.y + sp,   node.w, node.h - sp);
    } else {
        const sp = rInt(rng, MIN_LEAF, node.w - MIN_LEAF);
        node.left  = new BSPNode(node.x,        node.y, sp,          node.h);
        node.right = new BSPNode(node.x + sp,   node.y, node.w - sp, node.h);
    }
    splitNode(node.left,  rng, depth + 1);
    splitNode(node.right, rng, depth + 1);
}

function carveRooms(node, rng) {
    if (node.isLeaf()) {
        const maxW = node.w - 2, maxH = node.h - 2;
        const rw = rInt(rng, 4, Math.max(4, maxW));
        const rh = rInt(rng, 4, Math.max(4, maxH));
        const rx = node.x + rInt(rng, 1, Math.max(1, maxW - rw + 1));
        const ry = node.y + rInt(rng, 1, Math.max(1, maxH - rh + 1));
        node.room = { x: rx, y: ry, w: rw, h: rh };
        return;
    }
    node.left  && carveRooms(node.left,  rng);
    node.right && carveRooms(node.right, rng);
}

function paintRooms(node, grid) {
    if (node.isLeaf() && node.room) {
        fillRect(grid, node.room.x, node.room.y, node.room.w, node.room.h, T_FLOOR);
        return;
    }
    node.left  && paintRooms(node.left,  grid);
    node.right && paintRooms(node.right, grid);
}

// ─── Corridors ─────────────────────────────────────────────────────────────
// Offsets [lo, hi] around a corridor's centre line - exactly cw cells wide.
// (-floor(cw/2)..floor(cw/2) made every even width one cell wider; odd
// widths come out the same as before.)
function corridorSpan(cw) {
    const lo = Math.floor((cw - 1) / 2);
    return [-lo, cw - 1 - lo];
}

function digLine(grid, x0, y0, x1, y1, cw) {
    const [lo, hi] = corridorSpan(cw);
    if (x0 === x1) {
        const [minY, maxY] = [Math.min(y0,y1), Math.max(y0,y1)];
        for (let y = minY; y <= maxY; y++)
            for (let dx = lo; dx <= hi; dx++) {
                const t = get(grid, x0+dx, y);
                if (t !== T_FLOOR) set(grid, x0+dx, y, T_CORRIDOR);
            }
    } else {
        const [minX, maxX] = [Math.min(x0,x1), Math.max(x0,x1)];
        for (let x = minX; x <= maxX; x++)
            for (let dy = lo; dy <= hi; dy++) {
                const t = get(grid, x, y0+dy);
                if (t !== T_FLOOR) set(grid, x, y0+dy, T_CORRIDOR);
            }
    }
}

function digLCorridor(grid, ax, ay, bx, by, cw, rng) {
    const [lo, hi] = corridorSpan(cw);
    const bendX = rng() < 0.5 ? bx : ax;
    const bendY = bendX === bx  ? ay : by;
    digLine(grid, ax, ay, bendX, bendY, cw);
    digLine(grid, bendX, bendY, bx, by, cw);
    for (let dy = lo; dy <= hi; dy++)
        for (let dx = lo; dx <= hi; dx++) {
            const t = get(grid, bendX+dx, bendY+dy);
            if (t !== T_FLOOR) set(grid, bendX+dx, bendY+dy, T_CORRIDOR);
        }
}

function connectSiblings(node, grid, rng, cw) {
    if (node.isLeaf()) return;
    node.left  && connectSiblings(node.left,  grid, rng, cw);
    node.right && connectSiblings(node.right, grid, rng, cw);
    const lc = node.left?.centre(), rc = node.right?.centre();
    if (lc && rc) digLCorridor(grid, lc.x, lc.y, rc.x, rc.y, cw, rng);
}

function finaliseTiles(grid) {
    for (let y = 0; y < grid.length; y++)
        for (let x = 0; x < grid[y].length; x++)
            if (grid[y][x] === T_CORRIDOR) grid[y][x] = T_FLOOR;
}

// Makes the boss room `extra` cells wider by inserting copies of one of its
// columns into the whole grid - everything east of that column shifts over, so
// nothing can overlap, and every corridor crossing it just gets longer. Its
// BSP leaf alone has no room to grow (a room is carved inside its leaf).
// Picks the boss column whose stretch widens the least other floor (the same
// column runs through whatever is north and south of the boss room). Rooms and
// leaves are updated in place.
function widenBossRoom(grid, leaves, bossRoom, extra) {
    if (extra <= 0) return;
    let col = bossRoom.x, fewest = Infinity;
    for (let x = bossRoom.x; x < bossRoom.x + bossRoom.w; x++) {
        let others = 0;
        for (let y = 0; y < grid.length; y++)
            if (grid[y][x] === T_FLOOR && (y < bossRoom.y || y >= bossRoom.y + bossRoom.h)) others++;
        if (others < fewest) { fewest = others; col = x; }
    }
    for (const row of grid) row.splice(col + 1, 0, ...new Array(extra).fill(row[col]));
    const shift = r => {
        if (r.x > col) r.x += extra;
        else if (r.x + r.w > col) r.w += extra;
    };
    leaves.forEach(leaf => { shift(leaf); shift(leaf.room); });
}

// The grid's outer ring has nothing beyond it, so a floor cell there is a hole
// into the void. Nothing digs there anymore - this just guarantees it.
function sealOuterRing(grid) {
    const H = grid.length, W = grid[0].length;
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
            if (x === 0 || y === 0 || x === W - 1 || y === H - 1) grid[y][x] = T_WALL;
}

// ─── Connectivity ──────────────────────────────────────────────────────────
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const cellKey = (x, y) => `${x}_${y}`;   // same "gx_gz" format tileHeights uses

function inRect(r, x, y) {
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

function rectCells(r) {
    const cells = [];
    for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) cells.push({ x, y });
    return cells;
}

// Every cell reachable from `starts` through cells passable(x, y) accepts.
function floodFill(grid, starts, passable) {
    const seen = new Set();
    const stack = [];
    for (const { x, y } of starts) {
        const k = cellKey(x, y);
        if (seen.has(k) || !inBounds(grid, x, y) || !passable(x, y)) continue;
        seen.add(k);
        stack.push([x, y]);
    }
    while (stack.length) {
        const [x, y] = stack.pop();
        for (const [dx, dy] of DIRS4) {
            const nx = x + dx, ny = y + dy, k = cellKey(nx, ny);
            if (seen.has(k) || !inBounds(grid, nx, ny) || !passable(nx, ny)) continue;
            seen.add(k);
            stack.push([nx, ny]);
        }
    }
    return seen;
}

// Shortest 4-connected path from any of `sources` to a cell isTarget(x, y)
// accepts, never stepping onto a blocked(x, y) cell. Sources are taken as
// given (they may themselves be blocked cells, e.g. the boss room's edge).
// Deterministic - fixed neighbour order, sources in the order passed. null if
// there's no way through.
function findPath(grid, sources, isTarget, blocked) {
    const prev = new Map();
    const queue = [];
    for (const { x, y } of sources) {
        const k = cellKey(x, y);
        if (prev.has(k)) continue;
        prev.set(k, null);
        queue.push([x, y]);
    }
    for (let i = 0; i < queue.length; i++) {
        const [x, y] = queue[i];
        if (isTarget(x, y)) {
            const path = [];
            for (let k = cellKey(x, y); k !== null; k = prev.get(k)) {
                const [px, py] = k.split("_").map(Number);
                path.push({ x: px, y: py });
            }
            return path.reverse();
        }
        for (const [dx, dy] of DIRS4) {
            const nx = x + dx, ny = y + dy, k = cellKey(nx, ny);
            if (prev.has(k) || !inBounds(grid, nx, ny) || blocked(nx, ny)) continue;
            prev.set(k, cellKey(x, y));
            queue.push([nx, ny]);
        }
    }
    return null;
}

// Digs `path` out as a corridor cw cells wide, skipping every cell
// forbidden(x, y) rejects - widening never breaks into the boss room.
function digPath(grid, path, cw, forbidden) {
    const [lo, hi] = corridorSpan(cw);
    for (const { x, y } of path)
        for (let dy = lo; dy <= hi; dy++)
            for (let dx = lo; dx <= hi; dx++) {
                const nx = x + dx, ny = y + dy;
                if (inBounds(grid, nx, ny) && !forbidden(nx, ny)) set(grid, nx, ny, T_FLOOR);
            }
}

// The cells just outside each side of a room, with the direction pointing back
// INTO the room and how deep the room is that way. Same south/north/east/west
// order (and "south" = the +y side) the old stair finder used.
function roomSides(r) {
    const along = (n, f) => Array.from({ length: n }, (_, i) => f(i));
    return [
        { side: "south", dx:  0, dz: -1, depth: r.h, cells: along(r.w, i => ({ x: r.x + i, y: r.y + r.h })) },
        { side: "north", dx:  0, dz:  1, depth: r.h, cells: along(r.w, i => ({ x: r.x + i, y: r.y - 1 })) },
        { side: "east",  dx: -1, dz:  0, depth: r.w, cells: along(r.h, i => ({ x: r.x + r.w, y: r.y + i })) },
        { side: "west",  dx:  1, dz:  0, depth: r.w, cells: along(r.h, i => ({ x: r.x - 1, y: r.y + i })) },
    ];
}

// Contiguous runs of floor along each side - every way into the room.
function openingRuns(grid, r) {
    const runs = [];
    for (const s of roomSides(r)) {
        let run = null;
        for (const c of s.cells) {
            if (get(grid, c.x, c.y) !== T_FLOOR) { run = null; continue; }
            if (!run) runs.push(run = { side: s.side, dx: s.dx, dz: s.dz, depth: s.depth, cells: [] });
            run.cells.push(c);
        }
    }
    return runs;
}

// One way into the boss room (its dais gets one staircase), and every room plus
// that entrance reachable from the spawn. Closes extra boss openings, digs a
// corridor to anything left cut off, then walls off floor that still can't be
// reached. Changes nothing on a layout that already satisfies all of that (like
// placeId 12's seed) and uses no rng, so props/rocks rolled afterwards never
// shift because of it. Returns the entrance run - with fitsStairs false when
// no side of the room is deep enough for the staircase (the caller then leaves
// the dais flat) - or null if no way in could be made at all.
function enforceBossEntranceAndConnectivity(grid, rooms, bossRoom, spawn, cw, stairCells) {
    const isBoss = (x, y) => inRect(bossRoom, x, y);
    const isOuterRing = (x, y) => x === 0 || y === 0 || x === grid[0].length - 1 || y === grid.length - 1;
    const sides = roomSides(bossRoom);
    const perimeter = new Map();   // cellKey -> side
    sides.forEach(s => s.cells.forEach(c => perimeter.set(cellKey(c.x, c.y), s.side)));
    const reachFromSpawn = () => floodFill(grid, [spawn], (x, y) => get(grid, x, y) === T_FLOOR && !isBoss(x, y));
    const deepEnough = s => s.depth >= stairCells + 1;   // staircase + at least one row of dais

    // 1. the entrance: widest opening reachable without crossing the boss room,
    //    preferring sides deep enough for the staircase - every other opening
    //    is closed. A room with no deep-enough side still keeps an entrance
    //    (its dais just stays flat) rather than being sealed off.
    let reach = reachFromSpawn();
    const runs = openingRuns(grid, bossRoom);
    const widest = list => list.reduce((best, run) => (!best || run.cells.length > best.cells.length) ? run : best, null);
    const isReachable = run => run.cells.some(c => reach.has(cellKey(c.x, c.y)));
    let entrance = widest(runs.filter(run => deepEnough(run) && isReachable(run)))
        ?? widest(runs.filter(deepEnough))
        ?? widest(runs.filter(isReachable))
        ?? widest(runs);
    const keep = new Set(entrance ? entrance.cells.map(c => cellKey(c.x, c.y)) : []);
    perimeter.forEach((_, k) => {
        if (keep.has(k)) return;
        const [x, y] = k.split("_").map(Number);
        set(grid, x, y, T_WALL);
    });

    // 2. no opening at all - dig one from a deep-enough side (any side if none
    //    is) out to the nearest reachable floor, widened only along that side
    if (!entrance) {
        reach = reachFromSpawn();
        const deepSides = sides.filter(deepEnough);
        const sources = (deepSides.length ? deepSides : sides).flatMap(s => s.cells);
        const path = findPath(grid, sources, (x, y) => reach.has(cellKey(x, y)),
            (x, y) => isBoss(x, y) || isOuterRing(x, y) || perimeter.has(cellKey(x, y)));
        if (path) {
            const side = perimeter.get(cellKey(path[0].x, path[0].y));
            digPath(grid, path, cw, (x, y) => isBoss(x, y) || isOuterRing(x, y)
                || (perimeter.has(cellKey(x, y)) && perimeter.get(cellKey(x, y)) !== side));
            entrance = openingRuns(grid, bossRoom).find(run => run.cells.some(c => c.x === path[0].x && c.y === path[0].y)) ?? null;
        }
    }

    // 3. every other room, then the entrance itself, connected to the spawn -
    //    repair corridors stay clear of the boss room and its whole edge so
    //    they can never open a second way in
    const blocked = (x, y) => isBoss(x, y) || isOuterRing(x, y) || perimeter.has(cellKey(x, y));
    const groups = rooms.filter(r => r !== bossRoom).map(rectCells);
    if (entrance) groups.push(entrance.cells);
    for (const cells of groups) {
        reach = reachFromSpawn();
        if (cells.some(c => reach.has(cellKey(c.x, c.y)))) continue;
        const path = findPath(grid, cells, (x, y) => reach.has(cellKey(x, y)), blocked);
        if (path) digPath(grid, path, cw, blocked);
    }

    // 4. anything still unreachable is a sealed-off pocket - turn it back into
    //    wall (the boss room is left alone even if it somehow stayed cut off)
    const all = floodFill(grid, [spawn], (x, y) => get(grid, x, y) === T_FLOOR);
    for (let y = 0; y < grid.length; y++)
        for (let x = 0; x < grid[y].length; x++)
            if (grid[y][x] === T_FLOOR && !all.has(cellKey(x, y)) && !isBoss(x, y)) grid[y][x] = T_WALL;

    if (!entrance || !all.has(cellKey(entrance.cells[0].x, entrance.cells[0].y))) return null;
    return { ...entrance, fitsStairs: deepEnough(entrance) };
}

// ─── Tile height jitter map ────────────────────────────────────────────────
//
// Two-tier roll per tile:
//   85% of rolls → small lift in [TILE_JITTER_NORMAL.min, TILE_JITTER_NORMAL.max]
//   15% of rolls → large lift in [TILE_JITTER_RAISED.min, TILE_JITTER_RAISED.max]
//
// Two rng() calls consumed per tile (tier roll + offset roll) — deterministic.
// Boss room tiles are always 0 (its dais height is bossRoom.elevation instead).
// A raised slab blocks walking (see TILE_JITTER_* above), so a tile that rolls
// the raised tier only keeps it inside a room - not on the room's edge row or
// column, a corridor, or a protected cell (around the spawn and the exit) -
// and only if every other floor cell stays reachable from the spawn with it
// in place. Otherwise it gets the normal tier from the same offset roll.
//
function buildTileHeightMap(grid, rooms, bossRoom, spawn, protectedKeys, jitterRng) {
    const map = {};
    const lerp = (min, max, t) => min + t * (max - min);
    const isBoss = (x, y) => inRect(bossRoom, x, y);
    const inRoomInterior = (x, y) => rooms.some(r => r !== bossRoom
        && x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1);

    let floorCount = 0;
    for (const row of grid) for (const t of row) if (t === T_FLOOR) floorCount++;
    const raised = new Set();
    const keepsEverythingReachable = k => {
        raised.add(k);
        const reach = floodFill(grid, [spawn], (x, y) => get(grid, x, y) === T_FLOOR && !raised.has(cellKey(x, y)));
        const ok = reach.size === floorCount - raised.size;
        if (!ok) raised.delete(k);
        return ok;
    };

    for (let gz = 0; gz < grid.length; gz++) {
        for (let gx = 0; gx < grid[gz].length; gx++) {
            if (grid[gz][gx] !== T_FLOOR) continue;

            const k = cellKey(gx, gz);
            if (isBoss(gx, gz)) { map[k] = 0; continue; }

            const tierRoll   = jitterRng(); // decides normal vs raised
            const offsetRoll = jitterRng(); // picks value within that tier

            map[k] = tierRoll < TILE_RAISED_CHANCE && inRoomInterior(gx, gz)
                    && !protectedKeys.has(k) && keepsEverythingReachable(k)
                ? lerp(TILE_JITTER_RAISED.min, TILE_JITTER_RAISED.max, offsetRoll)
                : lerp(TILE_JITTER_NORMAL.min, TILE_JITTER_NORMAL.max, offsetRoll);
        }
    }
    return map;
}

// ─── Room metadata ─────────────────────────────────────────────────────────
const ROOM_TYPES = ["chamber", "armory", "library", "crypt", "guard_post", "barracks"];

function collectRooms(leaves, wallH) {
    const ceilH = wallH - 0.1;
    return leaves.map((leaf, i) => {
        const { x, y, w, h } = leaf.room;
        const isLast = i === leaves.length - 1;
        const type   = i === 0     ? "entrance"
                     : isLast      ? "boss_room"
                     : ROOM_TYPES[i % ROOM_TYPES.length];
        return {
            id:     `room_${i}`,
            type,
            bounds: { x, y, width: w, height: h },
            floor:  type === "entrance"  ? "stone_tile"
                  : type === "boss_room" ? "marble"
                  : "cobblestone",
            ceiling: { height: ceilH, texture: "stone_ceiling" },
            pbr: {
                floor:   type === "boss_room"
                    ? { albedoColor: "#3a1a1a", roughness: 0.6, metallic: 0.1 }
                    : { albedoColor: "#282828", roughness: 0.88, metallic: 0.02 },
                ceiling: type === "boss_room"
                    ? { albedoColor: "#2a0808", roughness: 0.7, metallic: 0.05 }
                    : { albedoColor: "#111111", roughness: 0.92, metallic: 0.0  },
            },
        };
    });
}

// ─── Props ─────────────────────────────────────────────────────────────────
function placeProps(rooms, grid, rng, spawnX, spawnZ) {
    const props = [];
    rooms.forEach((room, ri) => {
        const { x, y, width: w, height: h } = room.bounds;
        if (room.type === "boss_room") return;

        if (w >= 4 && h >= 4) {
            [{ tx: x+1, ty: y+1 }, { tx: x+w-2, ty: y+1 }].forEach(({ tx, ty }, ti) => {
                if (get(grid, tx, ty) === T_FLOOR)
                    props.push({ id: `torch_${ri}_${ti}`, type: "torch", x: tx, y: ty, rotation: 0, lit: true });
            });
        }

        if (w >= 3 && h >= 3) {
            const bx = x + rInt(rng, 1, w-2), bz = y + rInt(rng, 1, h-2);
            // never on the spawn cell (you'd arrive standing on it) - skipped
            // after both rolls, so the rng sequence is the same either way
            if (get(grid, bx, bz) === T_FLOOR && !(bx === spawnX && bz === spawnZ))
                props.push({ id: `barrel_${ri}`, type: "barrel", x: bx, y: bz, rotation: rInt(rng, 0, 359) });
        }

        if (room.type === "crypt") {
            props.push({ id: `chest_${ri}`, type: "chest",
                x: x + Math.floor(w/2), y: y + Math.floor(h/2), rotation: 0, locked: true });
        }
    });
    return props;
}

// ─── Rocks ─────────────────────────────────────────────────────────────────
// keepClear: cells ({x, y}) no rock may reach over - a rock is up to ~12 units
// across (createRock's 1.2-radius icosphere at scale 5), several cells wide,
// so skipping only its own cell isn't enough
function placeRocks(rooms, grid, rng, spawnX, spawnZ, rockDensity = 1, cellSize = 4, keepClear = []) {
    const rocks = [];

    const varieties = [
        { type: "boulder", sx: [1.5, 3.5], sy: [1.5, 3.0], sz: [1.5, 3.5], rx: 0,   rz: 0   },
        { type: "slab",    sx: [2.5, 5.0], sy: [0.4, 0.9], sz: [2.5, 5.0], rx: 0,   rz: 0   },
        { type: "pillar",  sx: [0.8, 1.5], sy: [2.5, 5.0], sz: [0.8, 1.5], rx: 0,   rz: 0   },
        { type: "chunk",   sx: [1.2, 3.0], sy: [1.0, 2.5], sz: [1.5, 3.5], rx: 0,   rz: 0   },
        { type: "fallen",  sx: [2.0, 4.0], sy: [1.0, 2.0], sz: [1.5, 3.0], rx: 25,  rz: 15  },
        { type: "tilted",  sx: [1.5, 3.0], sy: [1.5, 3.0], sz: [1.5, 3.0], rx: -20, rz: 30  },
    ];

    rooms.forEach((room, ri) => {
        if (room.type === "boss_room") return;
        const { x, y, width: w, height: h } = room.bounds;

        const area      = w * h;
        const rockCount = rockDensity <= 0
            ? 0
            : Math.min(20, Math.max(2, Math.round((area / 25) * rockDensity)));

        let placed = 0, attempts = 0;
        while (placed < rockCount && attempts < 60) {
            attempts++;
            const rx = x + rInt(rng, 1, Math.max(1, w - 2));
            const rz = y + rInt(rng, 1, Math.max(1, h - 2));

            if (grid[rz][rx] !== T_FLOOR) continue;
            if (rx === spawnX && rz === spawnZ) continue;
            if (rocks.some(r => Math.abs(r.gridX - rx) < 1 && Math.abs(r.gridZ - rz) < 1)) continue;

            const v = varieties[Math.floor(rng() * varieties.length)];
            const lerp = (lo, hi) => lo + rng() * (hi - lo);
            const jitter = () => (rng() - 0.5) * 10;

            const rock = {
                id:      `rock_${ri}_${placed}`,
                type:    "rock",
                variety: v.type,
                gridX:   rx,
                gridZ:   rz,
                scaleX:  lerp(v.sx[0], v.sx[1]),
                scaleY:  lerp(v.sy[0], v.sy[1]),
                scaleZ:  lerp(v.sz[0], v.sz[1]),
                rotY:    Math.floor(rng() * 360),
                rotX:    v.rx + jitter(),
                rotZ:    v.rz + jitter(),
            };
            // its widest horizontal reach, plus room for the player to stand
            const reach = 1.2 * Math.max(rock.scaleX, rock.scaleZ) + 1;
            if (keepClear.some(c => Math.hypot(c.x - rx, c.y - rz) * cellSize < reach)) continue;

            rocks.push(rock);
            placed++;
        }
    });
    return rocks;
}

// ─── Lights ────────────────────────────────────────────────────────────────
// x/z/range in cells, y in world units (above the floor - the boss room's
// light sits that much higher again, over its raised dais)
function placeLights(rooms, wallH, bossElevation) {
    return rooms.map(r => ({
        type:      "point",
        x:         r.bounds.x + r.bounds.width  / 2,
        y:         wallH * 0.7 + (r.type === "boss_room" ? bossElevation : 0),
        z:         r.bounds.y + r.bounds.height / 2,
        intensity: r.type === "boss_room" ? 0.6 : 0.3,
        color:     r.type === "boss_room" ? "#ff2200" : "#445566",
        range:     Math.max(r.bounds.width, r.bounds.height) * 2,
    }));
}

// ─── Public API ────────────────────────────────────────────────────────────
// sceneTemp/placeId/seed default to undefined explicitly - TypeScript infers
// this options object's type from the defaults, and tcp's copy of this file
// would otherwise reject them as unknown properties
export function generateBSPDungeon({
    sceneTemp     = undefined,
    placeId       = undefined,
    seed          = undefined,
    gridWidth     = 32,
    gridHeight    = 32,
    cellSize      = 4,
    wallHeight    = 15,
    corridorWidth = 3,
    name          = "Procedural Dungeon",
    difficulty    = 1,
    textures      = null,
    rockDensity   = 1,
    // boss room width multiplier - 2 doubles it (the grid grows east to fit)
    bossRoomWidthScale = 1,
    isMultiplayer   = true,
    // { placeId, name, areaType, startingPos } of the place the exit leads
    // back to - becomes this dungeon's one roomPaths door (see roomPaths below)
    exitPlaceDetail = null,
    // world units the boss room's dais stands above the rest of the floor
    bossElevation   = 2,
} = {}) {
    if (seed === undefined) {
        // every client generates its own copy of the dungeon, so the old
        // Date.now() default handed each player a different layout - fall back
        // to something every client agrees on instead
        seed = Number(placeId) || 1;
        console.warn(`[generateBSPDungeon] no seed for placeId ${placeId} - using ${seed}`);
    }
    const rng = seededRNG(seed);

    const grid = Array.from({ length: gridHeight }, () => new Array(gridWidth).fill(T_WALL));

    const root = new BSPNode(1, 1, gridWidth - 2, gridHeight - 2);
    splitNode(root, rng);
    carveRooms(root, rng);
    paintRooms(root, grid);
    connectSiblings(root, grid, rng, corridorWidth);
    finaliseTiles(grid);

    const leaves = root.leaves();
    // the boss room is always the last leaf (see collectRooms)
    const bossLeafRoom = leaves[leaves.length - 1].room;
    widenBossRoom(grid, leaves, bossLeafRoom, Math.round(bossLeafRoom.w * (bossRoomWidthScale - 1)));
    sealOuterRing(grid);

    const rooms  = collectRooms(leaves, wallHeight);

    const entranceRoom = rooms[0];
    const spawnGX = entranceRoom.bounds.x + Math.floor(entranceRoom.bounds.width  / 2);
    const spawnGZ = entranceRoom.bounds.y + Math.floor(entranceRoom.bounds.height / 2);

    const bossLeaf = leaves[leaves.length - 1];
    const bossRoom = bossLeaf.room;

    // ── Boss entrance + connectivity ───────────────────────────────────────
    // stairCells: how deep (in cells) the staircase cuts into the dais so it
    // never climbs steeper than MAX_STAIR_SLOPE - 2 cells for the default
    // 2-high dais on 4-unit cells. The entrance prefers a side deep enough for
    // that plus one row of dais; if there's none, see daisStairCells below.
    const stairCells = Math.max(1, Math.ceil(bossElevation / MAX_STAIR_SLOPE / cellSize));
    const bossEntrance = leaves.length > 1
        ? enforceBossEntranceAndConnectivity(grid, leaves.map(l => l.room), bossRoom,
            { x: spawnGX, y: spawnGZ }, corridorWidth, stairCells)
        : null;
    // a room too shallow for the full staircase still gets a dais - as high as
    // a staircase leaving one row of dais can climb at MAX_STAIR_SLOPE
    let daisStairCells = stairCells;
    let elevation = 0;
    if (bossEntrance && bossElevation > 0) {
        if (bossEntrance.fitsStairs) elevation = bossElevation;
        else if (bossEntrance.depth >= 2) {
            daisStairCells = bossEntrance.depth - 1;
            elevation = Math.min(bossElevation, daisStairCells * cellSize * MAX_STAIR_SLOPE);
        }
    }

    const props  = placeProps(rooms, grid, rng, spawnGX, spawnGZ);
    const lights = placeLights(rooms, wallHeight, elevation);
    const rocks = placeRocks(rooms, grid, rng, spawnGX, spawnGZ, rockDensity, cellSize,
        [{ x: spawnGX, y: spawnGZ }, { x: entranceRoom.bounds.x, y: entranceRoom.bounds.y }]);

    // ── Tile height jitter ─────────────────────────────────────────────────
    // A SEPARATE rng is seeded from the same seed so the jitter pass never
    // affects the corridor/room generation above (those already consumed rng).
    // Using seed+1 gives a fully independent sequence.
    // No raised slab on or next to (diagonals too) the spawn cell or the exit
    // door's cell - the entrance room's corner, see roomPaths - so you never
    // arrive boxed in or have a slab in front of the way out.
    const protectedCells = new Set();
    for (const [cx, cz] of [[spawnGX, spawnGZ], [entranceRoom.bounds.x, entranceRoom.bounds.y]])
        for (let oz = -1; oz <= 1; oz++)
            for (let ox = -1; ox <= 1; ox++) protectedCells.add(cellKey(cx + ox, cz + oz));
    const jitterRng    = seededRNG(seed + 1);
    const tileHeights  = buildTileHeightMap(grid, leaves.map(l => l.room), bossRoom,
        { x: spawnGX, y: spawnGZ }, protectedCells, jitterRng);

    // x/z in cell units like the rest of the layout, +0.5 so getSpawnPos's
    // cell * cellSize lands in the middle of the spawn cell rather than on
    // its corner. y is the arrival height above the floor (a short drop).
    const spawn = {
        x: spawnGX + 0.5,
        y: 1,
        z: spawnGZ + 0.5,
        rotation: 0,
    };

    // The way back out - a roomPaths door (areascene.js turns every entry
    // into an interact trigger) on the entrance room's own corner cell, in
    // world units unlike spawn above. Room cells are always floor and
    // placeRocks/props/raised slabs never use a room's edge row/column, so
    // nothing can block it; rooms are at least 4 cells wide, so it's always
    // 1.5+ cells from the spawn point instead of the player arriving inside
    // the trigger.
    const roomPaths = exitPlaceDetail ? [{
        ...exitPlaceDetail,
        pos: {
            x: entranceRoom.bounds.x * cellSize + cellSize / 2,
            // 1 above the floor surface - areascene.js re-lifts it by
            // createDungeon's floorTopY, in case the floor isn't at y 0
            y: 1,
            z: entranceRoom.bounds.y * cellSize + cellSize / 2,
        },
    }] : [];

    return {
        isMultiplayer,
        sceneTemp,
        placeId,
        areaType: "dungeon",
        meta: { name, difficulty, theme: "stone_dungeon", seed, created: Date.now(), rockCount: rocks.length },
        // width from the grid itself - bossRoomWidthScale can grow it past gridWidth
        layout: { width: grid[0].length, height: gridHeight, cellSize, grid },
        rooms,
        walls: {
            thickness: 0.3,
            height:    wallHeight,
            pbr:       { albedoColor: "#1c1c1c", roughness: 0.92, metallic: 0.02 },
            segments:  [],
        },
        textures,
        // tileHeights: "gx_gz" → Y offset in world units added on top of the
        // normal floor Y - createDungeon puts each tile's top surface at
        // (dais elevation) + dungeon.tileHeights[`${gx}_${gz}`]
        tileHeights,
        doors:  [],
        props,
        rocks,
        lighting: {
            ambient: { intensity: 0.15, color: "#2a2a3e" },
            lights,
        },
        bossRoom: {
            gridX:  bossRoom.x,
            gridY:  bossRoom.y,
            width:  bossRoom.w,
            height: bossRoom.h,
            // world units the dais stands above the floor - bossElevation, or
            // less if the room is too shallow for that staircase; 0 (flat)
            // only when no entrance could be made
            elevation,
            // the one way in: `cells` are the corridor cells right outside the
            // room, dx/dz point into it, and (when elevation > 0) the staircase
            // runs stairCells deep into the dais from there. null only if no
            // way in could be made at all.
            entrance: bossEntrance && {
                side:  bossEntrance.side,
                dx:    bossEntrance.dx,
                dz:    bossEntrance.dz,
                cells: bossEntrance.cells,
                stairCells: daisStairCells,
            },
        },
        spawn,
        roomPaths,
    };
}