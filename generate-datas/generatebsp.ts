/**
 * bspDungeonGenerator.js  – v5
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
const TILE_JITTER_NORMAL = { min: 0.0,  max: 0.04 };
const TILE_JITTER_RAISED = { min: 0.04, max: 0.5  };
const TILE_RAISED_CHANCE = 0.15;

// ─── Types ─────────────────────────────────────────────────────────────────
type RNG = () => number;
type Grid = number[][];

interface BSPRect { x: number; y: number; w: number; h: number; }
interface RoomBounds { x: number; y: number; width: number; height: number; }
interface RoomMeta {
    id: string;
    type: string;
    bounds: RoomBounds;
    floor: string;
    ceiling: { height: number; texture: string };
    pbr: { floor: Record<string, unknown>; ceiling: Record<string, unknown> };
}
interface StairCandidate {
    side: string;
    isRow: boolean;
    fixedVal: number;
    scanFrom: number;
    scanTo: number;
    dir: { dx: number; dz: number };
    getFloorEdgeX: (mid: number) => number;
    getFloorEdgeZ: (mid: number) => number;
    getStairBaseZ: (mid: number) => number;
    getStairBaseX: (mid: number) => number;
}
export interface BSPDungeonOptions {
    placeId?: string;
    seed?: number;
    gridWidth?: number;
    gridHeight?: number;
    cellSize?: number;
    wallHeight?: number;
    corridorWidth?: number;
    name?: string;
    difficulty?: number;
    textures?: object | null;
    rockDensity?: number;
    areaType?: string;
}

// ─── PRNG ──────────────────────────────────────────────────────────────────
function seededRNG(seed: number): RNG {
    let s = seed >>> 0;
    return () => {
        s += 0x6d2b79f5;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function rInt(rng: RNG, lo: number, hi: number): number { return Math.floor(rng() * (hi - lo + 1)) + lo; }

// ─── Grid ──────────────────────────────────────────────────────────────────
function inBounds(grid: Grid, x: number, y: number): boolean {
    return y >= 0 && y < grid.length && x >= 0 && x < grid[0].length;
}
function get(grid: Grid, x: number, y: number): number        { return inBounds(grid, x, y) ? grid[y][x] : T_WALL; }
function set(grid: Grid, x: number, y: number, tile: number): void  { if (inBounds(grid, x, y)) grid[y][x] = tile; }
function fillRect(grid: Grid, x: number, y: number, w: number, h: number, tile: number): void {
    for (let row = y; row < y + h; row++)
        for (let col = x; col < x + w; col++)
            set(grid, col, row, tile);
}

// ─── BSP ───────────────────────────────────────────────────────────────────
const MIN_LEAF = 8;

class BSPNode {
    x: number; y: number; w: number; h: number;
    left: BSPNode | null = null;
    right: BSPNode | null = null;
    room: BSPRect | null = null;

    constructor(x: number, y: number, w: number, h: number) {
        this.x = x; this.y = y; this.w = w; this.h = h;
    }
    isLeaf(): boolean { return !this.left && !this.right; }
    centre(): { x: number; y: number } {
        if (this.room) return {
            x: this.room.x + Math.floor(this.room.w / 2),
            y: this.room.y + Math.floor(this.room.h / 2),
        };
        const lc = this.left?.centre(), rc = this.right?.centre();
        if (lc && rc) return { x: Math.floor((lc.x + rc.x) / 2), y: Math.floor((lc.y + rc.y) / 2) };
        return lc ?? rc ?? { x: this.x + Math.floor(this.w / 2), y: this.y + Math.floor(this.h / 2) };
    }
    leaves(out: BSPNode[] = []): BSPNode[] {
        if (this.isLeaf()) { out.push(this); return out; }
        this.left?.leaves(out); this.right?.leaves(out); return out;
    }
}

function splitNode(node: BSPNode, rng: RNG, depth = 0): void {
    if (depth >= 5) return;
    const canW = node.w >= MIN_LEAF * 2, canH = node.h >= MIN_LEAF * 2;
    if (!canW && !canH) return;
    let horiz = node.h >= node.w;
    if (canW && !canH) horiz = false;
    if (canH && !canW) horiz = true;
    if (rng() < 0.2) horiz = !horiz;
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

function carveRooms(node: BSPNode, rng: RNG): void {
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

function paintRooms(node: BSPNode, grid: Grid): void {
    if (node.isLeaf() && node.room) {
        fillRect(grid, node.room.x, node.room.y, node.room.w, node.room.h, T_FLOOR);
        return;
    }
    node.left  && paintRooms(node.left,  grid);
    node.right && paintRooms(node.right, grid);
}

// ─── Corridors ─────────────────────────────────────────────────────────────
function digLine(grid: Grid, x0: number, y0: number, x1: number, y1: number, cw: number): void {
    const hw = Math.floor(cw / 2);
    if (x0 === x1) {
        const [minY, maxY] = [Math.min(y0,y1), Math.max(y0,y1)];
        for (let y = minY; y <= maxY; y++)
            for (let dx = -hw; dx <= hw; dx++) {
                const t = get(grid, x0+dx, y);
                if (t !== T_FLOOR) set(grid, x0+dx, y, T_CORRIDOR);
            }
    } else {
        const [minX, maxX] = [Math.min(x0,x1), Math.max(x0,x1)];
        for (let x = minX; x <= maxX; x++)
            for (let dy = -hw; dy <= hw; dy++) {
                const t = get(grid, x, y0+dy);
                if (t !== T_FLOOR) set(grid, x, y0+dy, T_CORRIDOR);
            }
    }
}

function digLCorridor(grid: Grid, ax: number, ay: number, bx: number, by: number, cw: number, rng: RNG): void {
    const hw = Math.floor(cw / 2);
    const bendX = rng() < 0.5 ? bx : ax;
    const bendY = bendX === bx  ? ay : by;
    digLine(grid, ax, ay, bendX, bendY, cw);
    digLine(grid, bendX, bendY, bx, by, cw);
    for (let dy = -hw; dy <= hw; dy++)
        for (let dx = -hw; dx <= hw; dx++) {
            const t = get(grid, bendX+dx, bendY+dy);
            if (t !== T_FLOOR) set(grid, bendX+dx, bendY+dy, T_CORRIDOR);
        }
}

function connectSiblings(node: BSPNode, grid: Grid, rng: RNG, cw: number): void {
    if (node.isLeaf()) return;
    node.left  && connectSiblings(node.left,  grid, rng, cw);
    node.right && connectSiblings(node.right, grid, rng, cw);
    const lc = node.left?.centre(), rc = node.right?.centre();
    if (lc && rc) digLCorridor(grid, lc.x, lc.y, rc.x, rc.y, cw, rng);
}

function finaliseTiles(grid: Grid): void {
    for (let y = 0; y < grid.length; y++)
        for (let x = 0; x < grid[y].length; x++)
            if (grid[y][x] === T_CORRIDOR) grid[y][x] = T_FLOOR;
}

// ─── Tile height jitter map ────────────────────────────────────────────────
function buildTileHeightMap(grid: Grid, bossRoom: BSPRect, jitterRng: RNG): Record<string, number> {
    const map: Record<string, number> = {};
    const { x: bx, y: by, w: bw, h: bh } = bossRoom;
    const lerp = (min: number, max: number, t: number) => min + t * (max - min);

    for (let gz = 0; gz < grid.length; gz++) {
        for (let gx = 0; gx < grid[gz].length; gx++) {
            if (grid[gz][gx] !== T_FLOOR) continue;

            const inBoss = gx >= bx && gx < bx + bw && gz >= by && gz < by + bh;
            if (inBoss) { map[`${gx}_${gz}`] = 0; continue; }

            const tierRoll   = jitterRng();
            const offsetRoll = jitterRng();

            map[`${gx}_${gz}`] = tierRoll < TILE_RAISED_CHANCE
                ? lerp(TILE_JITTER_RAISED.min, TILE_JITTER_RAISED.max, offsetRoll)
                : lerp(TILE_JITTER_NORMAL.min, TILE_JITTER_NORMAL.max, offsetRoll);
        }
    }
    return map;
}

// ─── Compute exact stair approach geometry from the grid ─────────────────────
const STAIR_CELLS = 6;

function findStairApproach(grid: Grid, room: BSPRect, cellSize: number) {
    const { x, y, w, h } = room;
    const rows = grid.length;
    const cols = grid[0].length;

    function scanSide(fixedVal: number, scanFrom: number, scanTo: number, isRow: boolean): { minFloor: number | null; maxFloor: number | null } {
        let minFloor: number | null = null, maxFloor: number | null = null;
        for (let i = scanFrom; i <= scanTo; i++) {
            const gx = isRow ? i        : fixedVal;
            const gy = isRow ? fixedVal : i;
            if (gy >= 0 && gy < rows && gx >= 0 && gx < cols && grid[gy][gx] === T_FLOOR) {
                if (minFloor === null) minFloor = i;
                maxFloor = i;
            }
        }
        return { minFloor, maxFloor };
    }

    const candidates: StairCandidate[] = [
        { side: 'south', isRow: true,  fixedVal: y + h,  scanFrom: x, scanTo: x + w - 1,
          dir: { dx: 0, dz: -1 },
          getFloorEdgeX: (mid) => mid * cellSize + cellSize / 2,
          getFloorEdgeZ: ()    => (y + h) * cellSize,
          getStairBaseZ: ()    => (y + h + STAIR_CELLS) * cellSize,
          getStairBaseX: (mid) => mid * cellSize + cellSize / 2,
        },
        { side: 'north', isRow: true,  fixedVal: y - 1,  scanFrom: x, scanTo: x + w - 1,
          dir: { dx: 0, dz: 1 },
          getFloorEdgeX: (mid) => mid * cellSize + cellSize / 2,
          getFloorEdgeZ: ()    => y * cellSize,
          getStairBaseZ: ()    => (y - STAIR_CELLS) * cellSize,
          getStairBaseX: (mid) => mid * cellSize + cellSize / 2,
        },
        { side: 'east', isRow: false, fixedVal: x + w,  scanFrom: y, scanTo: y + h - 1,
          dir: { dx: -1, dz: 0 },
          getFloorEdgeX: ()    => (x + w) * cellSize,
          getFloorEdgeZ: (mid) => mid * cellSize + cellSize / 2,
          getStairBaseX: ()    => (x + w + STAIR_CELLS) * cellSize,
          getStairBaseZ: (mid) => mid * cellSize + cellSize / 2,
        },
        { side: 'west', isRow: false, fixedVal: x - 1,  scanFrom: y, scanTo: y + h - 1,
          dir: { dx: 1, dz: 0 },
          getFloorEdgeX: ()    => x * cellSize,
          getFloorEdgeZ: (mid) => mid * cellSize + cellSize / 2,
          getStairBaseX: ()    => (x - STAIR_CELLS) * cellSize,
          getStairBaseZ: (mid) => mid * cellSize + cellSize / 2,
        },
    ];

    for (const c of candidates) {
        const { minFloor, maxFloor } = scanSide(c.fixedVal, c.scanFrom, c.scanTo, c.isRow);
        if (minFloor === null) continue;

        const spanCells          = maxFloor! - minFloor + 1;
        const midCell            = minFloor + (spanCells - 1) / 2;
        const corridorWorldWidth = spanCells * cellSize;
        const stairCentreX       = c.getFloorEdgeX(midCell);
        const stairCentreZ       = c.getFloorEdgeZ(midCell);

        return {
            approachDir:        c.dir,
            floorEdgeX:         c.getFloorEdgeX(midCell),
            floorEdgeZ:         c.getFloorEdgeZ(midCell),
            stairCentreX,
            stairCentreZ,
            corridorWorldWidth,
            stairBaseX:         c.getStairBaseX(midCell),
            stairBaseZ:         c.getStairBaseZ(midCell),
        };
    }

    // Fallback
    const cx = x + Math.floor(w / 2);
    return {
        approachDir:        { dx: 0, dz: -1 },
        floorEdgeX:         (cx + 0.5) * cellSize,
        floorEdgeZ:         (y + h)    * cellSize,
        stairCentreX:       (cx + 0.5) * cellSize,
        stairCentreZ:       (y + h)    * cellSize,
        corridorWorldWidth: 3 * cellSize,
        stairBaseX:         (cx + 0.5) * cellSize,
        stairBaseZ:         (y + h + STAIR_CELLS) * cellSize,
    };
}

// ─── Room metadata ─────────────────────────────────────────────────────────
const ROOM_TYPES = ["chamber", "armory", "library", "crypt", "guard_post", "barracks"];

function collectRooms(leaves: BSPNode[], wallH: number): RoomMeta[] {
    const ceilH = wallH - 0.1;
    return leaves.map((leaf, i) => {
        const { x, y, w, h } = leaf.room!;
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
function placeProps(rooms: RoomMeta[], grid: Grid, rng: RNG): object[] {
    const props: object[] = [];
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
            if (get(grid, bx, bz) === T_FLOOR)
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
interface Rock {
    id: string; type: string; variety: string;
    gridX: number; gridZ: number;
    scaleX: number; scaleY: number; scaleZ: number;
    rotY: number; rotX: number; rotZ: number;
}

function placeRocks(rooms: RoomMeta[], grid: Grid, rng: RNG, spawnX: number, spawnZ: number, rockDensity = 1): Rock[] {
    const rocks: Rock[] = [];

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
            const lerp = (lo: number, hi: number) => lo + rng() * (hi - lo);
            const jitter = () => (rng() - 0.5) * 10;

            rocks.push({
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
            });
            placed++;
        }
    });
    return rocks;
}

// ─── Lights ────────────────────────────────────────────────────────────────
function placeLights(rooms: RoomMeta[], wallH: number): object[] {
    return rooms.map(r => ({
        type:      "point",
        x:         r.bounds.x + r.bounds.width  / 2,
        y:         wallH * 0.7,
        z:         r.bounds.y + r.bounds.height / 2,
        intensity: r.type === "boss_room" ? 0.6 : 0.3,
        color:     r.type === "boss_room" ? "#ff2200" : "#445566",
        range:     Math.max(r.bounds.width, r.bounds.height) * 2,
    }));
}

// ─── Public API ────────────────────────────────────────────────────────────
export function generateBSPDungeon({
    placeId       = "",
    seed          = Date.now(),
    gridWidth     = 32,
    gridHeight    = 32,
    cellSize      = 4,
    wallHeight    = 15,
    corridorWidth = 3,
    name          = "Procedural Dungeon",
    difficulty    = 1,
    textures      = null,
    rockDensity   = 1,
}: BSPDungeonOptions = {}) {
    const rng = seededRNG(seed);

    const grid = Array.from({ length: gridHeight }, () => new Array(gridWidth).fill(T_WALL));

    const root = new BSPNode(1, 1, gridWidth - 2, gridHeight - 2);
    splitNode(root, rng);
    carveRooms(root, rng);
    paintRooms(root, grid);
    connectSiblings(root, grid, rng, corridorWidth);
    finaliseTiles(grid);

    const leaves = root.leaves();
    const rooms  = collectRooms(leaves, wallHeight);
    const props  = placeProps(rooms, grid, rng);
    const lights = placeLights(rooms, wallHeight);

    const entranceRoom = rooms[0];
    const spawnGX = entranceRoom.bounds.x + Math.floor(entranceRoom.bounds.width  / 2);
    const spawnGZ = entranceRoom.bounds.y + Math.floor(entranceRoom.bounds.height / 2);
    const rocks = placeRocks(rooms, grid, rng, spawnGX, spawnGZ, rockDensity);

    const bossLeaf = leaves[leaves.length - 1];
    const bossRoom = bossLeaf.room!;

    const jitterRng   = seededRNG(seed + 1);
    const tileHeights = buildTileHeightMap(grid, bossRoom, jitterRng);

    const stairApproach = findStairApproach(grid, bossRoom, cellSize);

    const spawn = {
        x: spawnGX,
        y: 10,
        z: spawnGZ,
        rotation: 0,
    };

    return {
        placeId,
        areaType: "dungeon",
        meta: { name, difficulty, theme: "stone_dungeon", seed, created: Date.now(), rockCount: rocks.length },
        layout: { width: gridWidth, height: gridHeight, cellSize, grid },
        rooms,
        walls: {
            thickness: 0.3,
            height:    wallHeight,
            pbr:       { albedoColor: "#1c1c1c", roughness: 0.92, metallic: 0.02 },
            segments:  [],
        },
        textures,
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
        },
        stairApproach,
        spawn,
    };
}
