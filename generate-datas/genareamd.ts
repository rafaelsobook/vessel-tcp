/**
 * genvillagemd.js — unified area / village metadata generator
 *
 * One function handles open-air areas (forest, plains) and settlements.
 * The caller shapes the output by adjusting property counts:
 *
 *   Forest  →  totalSmallHouse: 0,  totalBigTrees: 20, wallHeight: 0
 *   Village →  totalBigHouse: 15,   totalBigTrees: 2,  palisadeSpacing: 2.5
 *   Room    →  totalSmallHouse: 0,  totalBigTrees: 0,  wallHeight: 15
 *
 * entry / exit set which edge connects to the next zone and punch a gate gap
 * in the palisade (village) or mark a transition point on the boundary (area).
 */

// ─── Types ────────────────────────────────────────────────────────────────────
type RNG = () => number;
type Direction = 'north' | 'south' | 'east' | 'west';

interface OccupancyGrid {
    markOccupied(wx: number, wz: number, radius: number): void;
    isAreaFree(wx: number, wz: number, radius: number): boolean;
}

interface PlaceItemsOptions {
    type: string;
    count: number;
    clearance: number;
    halfW: number;
    halfH: number;
    grid: OccupancyGrid;
    rng: RNG;
    scaleRange?: number[];
    yOffset?: number;
}

export interface GenerateAreaOptions {
    placeId?: string;
    name?: string;
    width?: number;
    height?: number;
    cellSize?: number;
    seed?: number;
    theme?: string;
    areaType?: string;
    totalSmallHouse?: number;
    totalMediumHouse?: number;
    totalBigHouse?: number;
    totalSmallTrees?: number;
    totalMediumTrees?: number;
    totalBigTrees?: number;
    totalLightPoles?: number;
    totalGrass?: number;
    totalHerbs?: number;
    totalMushrooms?: number;
    palisadeSpacing?: number;
    palisadeStakeHeight?: number;
    palisadeStakeRadius?: number;
    palisadeMargin?: number;
    palisadeDoorWidth?: number;
    wallHeight?: number;
    difficulty?: number;
    textures?: object | null;
    floor?: object | null;
    walls?: object | null;
    ceiling?: object | null;
    entry?: Direction;
    exit?: Direction;
}

// ─── PRNG ──────────────────────────────────────────────────────────────────────
function seededRNG(seed: number): RNG {
    let s = seed >>> 0;
    return () => {
        s += 0x6d2b79f5;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ─── Constants ────────────────────────────────────────────────────────────────
const CELL_SIZE = 4;

const CLEARANCE: Record<string, number> = {
    smallHouse:  1,
    mediumHouse: 1,
    bigHouse:    1,
    smallTree:   2,
    mediumTree:  2,
    bigTree:     2,
    lightPole:   1,
    grass:       0,
    herb:        1,
    mushroom:    1,
};

const VARIANTS: Record<string, number> = {
    smallHouse:  3,
    mediumHouse: 3,
    bigHouse:    2,
    smallTree:   4,
    mediumTree:  3,
    bigTree:     2,
    lightPole:   1,
    grass:       5,
    herb:        4,
    mushroom:    3,
};

// ─── PBR defaults ─────────────────────────────────────────────────────────────
const DEFAULT_OUTDOOR_FLOOR_PBR = { albedoColor: '#4a6741', roughness: 0.95, metallic: 0.00 };
const DEFAULT_DIRT_PBR          = { albedoColor: '#7a5c3a', roughness: 0.98, metallic: 0.00 };
const DEFAULT_INDOOR_FLOOR_PBR  = { albedoColor: '#282828', roughness: 0.88, metallic: 0.02 };
const DEFAULT_WALL_PBR          = { albedoColor: '#1c1c1c', roughness: 0.92, metallic: 0.02 };
const DEFAULT_CEIL_PBR          = { albedoColor: '#080808', roughness: 1.00, metallic: 0.00 };

// ─── Tile height jitter ───────────────────────────────────────────────────────
const TILE_JITTER = { min: 0.0, max: 0.06 };

function buildTileHeightMap(cols: number, rows: number, rng: RNG): Record<string, number> {
    const map: Record<string, number> = {};
    const lerp = (a: number, b: number, t: number) => a + t * (b - a);
    for (let tz = 0; tz < rows; tz++)
        for (let tx = 0; tx < cols; tx++)
            map[`${tx}_${tz}`] = lerp(TILE_JITTER.min, TILE_JITTER.max, rng());
    return map;
}

// ─── Occupancy grid ───────────────────────────────────────────────────────────
function makeGrid(): OccupancyGrid {
    const occupied = new Set<string>();

    function worldToCell(wx: number, wz: number) {
        return { gx: Math.floor(wx / CELL_SIZE), gz: Math.floor(wz / CELL_SIZE) };
    }

    function markOccupied(wx: number, wz: number, radius: number): void {
        const r = Math.ceil(radius / CELL_SIZE);
        const { gx: cx, gz: cz } = worldToCell(wx, wz);
        for (let dz = -r; dz <= r; dz++)
            for (let dx = -r; dx <= r; dx++)
                if (dx * dx + dz * dz <= r * r)
                    occupied.add(`${cx + dx}_${cz + dz}`);
    }

    function isAreaFree(wx: number, wz: number, radius: number): boolean {
        const r = Math.ceil(radius / CELL_SIZE);
        const { gx: cx, gz: cz } = worldToCell(wx, wz);
        for (let dz = -r; dz <= r; dz++)
            for (let dx = -r; dx <= r; dx++)
                if (dx * dx + dz * dz <= r * r)
                    if (occupied.has(`${cx + dx}_${cz + dz}`)) return false;
        return true;
    }

    return { markOccupied, isAreaFree };
}

// ─── Palisade ─────────────────────────────────────────────────────────────────
function buildPalisade(width: number, height: number, spacing: number, stakeHeight: number, stakeRadius: number, entryDir: Direction, exitDir: Direction, doorWidth: number) {
    const stakes: object[] = [];
    let id = 0;

    const halfW = width  / 2;
    const halfH = height / 2;
    const y     = stakeHeight / 2;
    const hw    = doorWidth   / 2;

    const tiltVariants = [0, 0.04, -0.03, 0.02, -0.05, 0.03];

    function addStake(x: number, z: number): void {
        const tilt = tiltVariants[id % tiltVariants.length];
        stakes.push({
            id:      `palisade_${id++}`,
            type:    'palisadeStake',
            x, y, z,
            rotation: 0,
            tiltX:    tilt,
            scale:   { x: 1, y: 1, z: 1 },
            radius:   stakeRadius,
            height:   stakeHeight,
        });
    }

    function inGap(along: number, sideDir: Direction): boolean {
        return (sideDir === entryDir || sideDir === exitDir) && Math.abs(along) < hw;
    }

    // Front row
    for (let x = -halfW; x <= halfW; x += spacing)
        if (!inGap(x, 'north')) addStake(x,  halfH);

    for (let x = -halfW; x <= halfW; x += spacing)
        if (!inGap(x, 'south')) addStake(x, -halfH);

    for (let z = -halfH + spacing; z < halfH; z += spacing)
        if (!inGap(z, 'west')) addStake(-halfW, z);

    for (let z = -halfH + spacing; z < halfH; z += spacing)
        if (!inGap(z, 'east')) addStake( halfW, z);

    // Back row — offset inward by 1.5 units, staggered by half-spacing to fill gaps
    const rowOffset = 1.5;
    const halfS = spacing / 2;

    for (let x = -halfW + halfS; x <= halfW; x += spacing)
        if (!inGap(x, 'north')) addStake(x,  halfH - rowOffset);

    for (let x = -halfW + halfS; x <= halfW; x += spacing)
        if (!inGap(x, 'south')) addStake(x, -(halfH - rowOffset));

    for (let z = -halfH + spacing + halfS; z < halfH; z += spacing)
        if (!inGap(z, 'west')) addStake(-(halfW - rowOffset), z);

    for (let z = -halfH + spacing + halfS; z < halfH; z += spacing)
        if (!inGap(z, 'east')) addStake( halfW - rowOffset, z);

    return { stakeHeight, stakeRadius, spacing, doorWidth, stakes };
}

// ─── Item placement ───────────────────────────────────────────────────────────
function placeItems({ type, count, clearance, halfW, halfH, grid, rng, scaleRange = [1.0, 1.0], yOffset = 0 }: PlaceItemsOptions): object[] {
    const MAX_ATTEMPTS = 250;
    const items: object[] = [];
    for (let i = 0; i < count; i++) {
        for (let a = 0; a < MAX_ATTEMPTS; a++) {
            const x = (rng() * 2 - 1) * halfW;
            const z = (rng() * 2 - 1) * halfH;
            if (clearance > 0 && !grid.isAreaFree(x, z, clearance)) continue;
            const s = scaleRange[0] + rng() * (scaleRange[1] - scaleRange[0]);
            items.push({
                id:       `${type}_${i}`,
                type,
                x,
                y:        yOffset,
                z,
                rotation: Math.floor(rng() * 4) * 90,
                scale:    { x: s, y: s, z: s },
                variant:  Math.floor(rng() * VARIANTS[type]),
            });
            if (clearance > 0) grid.markOccupied(x, z, clearance);
            break;
        }
    }
    return items;
}

function placeLightPoles(count: number, halfW: number, halfH: number, grid: OccupancyGrid, rng: RNG): object[] {
    return placeItems({
        type: 'lightPole', count, clearance: CLEARANCE.lightPole,
        halfW, halfH, grid, rng, scaleRange: [1.0, 1.0],
    }).map(pole => ({ ...(pole as object), lit: true }));
}

// ─── Indoor torches (enclosed rooms) ─────────────────────────────────────────
function placeTorches(width: number, height: number): object[] {
    const hw = width  / 2 - 1;
    const hd = height / 2 - 1;
    return [
        { id: 'torch_nw', type: 'torch', x: -hw, y: 0, z: -hd, rotation:   0, lit: true },
        { id: 'torch_ne', type: 'torch', x:  hw, y: 0, z: -hd, rotation: 180, lit: true },
        { id: 'torch_sw', type: 'torch', x: -hw, y: 0, z:  hd, rotation:   0, lit: true },
        { id: 'torch_se', type: 'torch', x:  hw, y: 0, z:  hd, rotation: 180, lit: true },
    ];
}

// ─── Lighting ─────────────────────────────────────────────────────────────────
function buildOutdoorLighting(width: number, height: number) {
    const hw = width  / 2;
    const hd = height / 2;
    return {
        ambient: { intensity: 0.55, color: '#c8d4e8' },
        lights: [
            { type: 'directional', x:  hw * 0.6, y: 80, z: -hd * 0.4, color: '#fffbe6', intensity: 1.1,  range: 0 },
            { type: 'directional', x: -hw * 0.5, y: 40, z:  hd * 0.3, color: '#dce8ff', intensity: 0.35, range: 0 },
            { type: 'hemisphere',  x:  0,         y:  0, z:  0,        color: '#7a9c5a', intensity: 0.2,  range: 0 },
        ],
    };
}

function buildIndoorLighting(width: number, height: number, wallHeight: number) {
    const hw = width  / 2;
    const hd = height / 2;
    const y  = wallHeight * 0.7;
    return {
        ambient: { intensity: 0.15, color: '#2a2a3e' },
        lights: [
            { type: 'point', x:  0,        y, z:  0,        color: '#445566', intensity: 0.4, range: Math.max(width, height) * 1.2 },
            { type: 'point', x: -hw * 0.6, y, z: -hd * 0.6, color: '#334455', intensity: 0.2, range: 14 },
            { type: 'point', x:  hw * 0.6, y, z: -hd * 0.6, color: '#334455', intensity: 0.2, range: 14 },
            { type: 'point', x: -hw * 0.6, y, z:  hd * 0.6, color: '#334455', intensity: 0.2, range: 14 },
            { type: 'point', x:  hw * 0.6, y, z:  hd * 0.6, color: '#334455', intensity: 0.2, range: 14 },
        ],
    };
}

// ─── Dirt paths ───────────────────────────────────────────────────────────────
function buildPaths(width: number, height: number): object[] {
    const hw = width  / 2;
    const hd = height / 2;
    return [
        { id: 'path_ew', x1: -hw, z1:  0,   x2: hw, z2:  0,  width: 4, pbr: DEFAULT_DIRT_PBR },
        { id: 'path_ns', x1:  0,  z1: -hd,  x2:  0, z2:  hd, width: 4, pbr: DEFAULT_DIRT_PBR },
    ];
}

// ─── Portal descriptor ────────────────────────────────────────────────────────
function buildPortal(dir: Direction, halfW: number, halfH: number, edgeOffset: number) {
    switch (dir) {
        case 'north': return { direction: 'north', x:  0,                  z:  halfH + edgeOffset   };
        case 'south': return { direction: 'south', x:  0,                  z: -(halfH + edgeOffset) };
        case 'east':  return { direction: 'east',  x:  halfW + edgeOffset, z:  0                    };
        case 'west':  return { direction: 'west',  x: -(halfW + edgeOffset), z: 0                   };
        default:      return { direction: 'north', x:  0,                  z:  halfH + edgeOffset   };
    }
}

// ─── Spawn point ──────────────────────────────────────────────────────────────
const SPAWN_CLEARANCE = 6;

function buildSpawn(entry: Direction, halfW: number, halfH: number, isEnclosed: boolean) {
    const inset = 3;
    const y = isEnclosed ? 10 : 1;
    switch (entry) {
        case 'north': return { x:  0,               y, z:  halfH - inset,  rotation: 180 };
        case 'south': return { x:  0,               y, z: -(halfH - inset), rotation:   0 };
        case 'east':  return { x:  halfW - inset,   y, z:  0,              rotation: 270 };
        case 'west':  return { x: -(halfW - inset), y, z:  0,              rotation:  90 };
        default:      return { x:  0,               y, z:  halfH - inset,  rotation: 180 };
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function generateArea({
    name             = 'village',
    width            = 200,
    height           = 200,
    cellSize         = CELL_SIZE,
    seed             = Date.now(),
    theme            = 'japanese_village',
    placeId,
    areaType,
    totalSmallHouse  = 0,
    totalMediumHouse = 0,
    totalBigHouse    = 0,
    totalSmallTrees  = 10,
    totalMediumTrees = 5,
    totalBigTrees    = 2,
    totalLightPoles  = 10,
    totalGrass       = 1000,
    totalHerbs       = 10,
    totalMushrooms   = 10,
    palisadeSpacing      = 2.5,
    palisadeStakeHeight  = 12,
    palisadeStakeRadius  = 1.1,
    palisadeMargin       = 6,
    palisadeDoorWidth    = 8,
    wallHeight = 0,
    difficulty = 1,
    textures   = null,
    floor:   floorOverride = null,
    walls:   wallsOverride = null,
    ceiling: ceilOverride  = null,
    entry = 'north' as Direction,
    exit  = 'south' as Direction,
}: GenerateAreaOptions = {}) {

    const isVillage  = (totalSmallHouse + totalMediumHouse + totalBigHouse) > 0;
    const isEnclosed = wallHeight > 0 && !isVillage;

    const floorPBR = floorOverride ?? (isEnclosed ? DEFAULT_INDOOR_FLOOR_PBR : DEFAULT_OUTDOOR_FLOOR_PBR);
    const wallsPBR = wallsOverride ?? DEFAULT_WALL_PBR;
    const ceilPBR  = ceilOverride  ?? DEFAULT_CEIL_PBR;

    const cols  = Math.ceil(width  / cellSize);
    const rows  = Math.ceil(height / cellSize);
    const halfW = width  / 2;
    const halfH = height / 2;

    const houseRng   = seededRNG(seed);
    const treeRng    = seededRNG(seed + 1);
    const foliageRng = seededRNG(seed + 2);
    const poleRng    = seededRNG(seed + 3);
    const jitterRng  = seededRNG(seed + 4);

    const grid = makeGrid();

    const spawn = buildSpawn(entry, halfW, halfH, isEnclosed);
    grid.markOccupied(spawn.x, spawn.z, SPAWN_CLEARANCE);

    const bigHouses = placeItems({
        type: 'bigHouse', count: totalBigHouse,
        clearance: CLEARANCE.bigHouse, halfW, halfH, grid, rng: houseRng,
        scaleRange: [1.0, 1.2],
    });
    const mediumHouses = placeItems({
        type: 'mediumHouse', count: totalMediumHouse,
        clearance: CLEARANCE.mediumHouse, halfW, halfH, grid, rng: houseRng,
        scaleRange: [0.9, 1.1],
    });
    const smallHouses = placeItems({
        type: 'smallHouse', count: totalSmallHouse,
        clearance: CLEARANCE.smallHouse, halfW, halfH, grid, rng: houseRng,
        scaleRange: [0.85, 1.05],
    });

    const bigTrees = placeItems({
        type: 'bigTree', count: totalBigTrees,
        clearance: CLEARANCE.bigTree, halfW, halfH, grid, rng: treeRng,
        scaleRange: [1.0, 1.4],
    });
    const mediumTrees = placeItems({
        type: 'mediumTree', count: totalMediumTrees,
        clearance: CLEARANCE.mediumTree, halfW, halfH, grid, rng: treeRng,
        scaleRange: [0.9, 1.2],
    });
    const smallTrees = placeItems({
        type: 'smallTree', count: totalSmallTrees,
        clearance: CLEARANCE.smallTree, halfW, halfH, grid, rng: treeRng,
        scaleRange: [0.8, 1.1],
    });

    const lightPoles = placeLightPoles(totalLightPoles, halfW, halfH, grid, poleRng);
    const grass      = placeItems({
        type: 'grass', count: totalGrass, clearance: 0,
        halfW, halfH, grid, rng: foliageRng, scaleRange: [0.6, 1.3],
    });
    const herbs = placeItems({
        type: 'herb', count: totalHerbs,
        clearance: CLEARANCE.herb, halfW, halfH, grid, rng: foliageRng,
        scaleRange: [0.7, 1.1],
    });
    const mushrooms = placeItems({
        type: 'mushroom', count: totalMushrooms,
        clearance: CLEARANCE.mushroom, halfW, halfH, grid, rng: foliageRng,
        scaleRange: [0.5, 1.0],
    });

    const tileHeights = buildTileHeightMap(cols, rows, jitterRng);

    const portalOffset = isVillage ? palisadeMargin : 0;

    return {
        placeId,
        areaType,

        meta: {
            name, difficulty, theme, seed,
            created: Date.now(),
            counts: {
                smallHouses:  smallHouses.length,
                mediumHouses: mediumHouses.length,
                bigHouses:    bigHouses.length,
                smallTrees:   smallTrees.length,
                mediumTrees:  mediumTrees.length,
                bigTrees:     bigTrees.length,
                lightPoles:   lightPoles.length,
                grass:        grass.length,
                herbs:        herbs.length,
                mushrooms:    mushrooms.length,
            },
        },

        layout: { width, height, cellSize, cols, rows, grid: [] },

        floor:      { pbr: floorPBR },
        tileHeights,

        entry: buildPortal(entry, halfW, halfH, portalOffset),
        exit:  buildPortal(exit,  halfW, halfH, portalOffset),

        paths:    isVillage ? buildPaths(width, height) : null,
        palisade: isVillage
            ? {
                ...buildPalisade(
                    width  + palisadeMargin * 2,
                    height + palisadeMargin * 2,
                    palisadeSpacing, palisadeStakeHeight, palisadeStakeRadius,
                    entry, exit, palisadeDoorWidth,
                ),
                outerWidth:  width  + palisadeMargin * 2,
                outerHeight: height + palisadeMargin * 2,
              }
            : null,

        smallHouses, mediumHouses, bigHouses,
        smallTrees, mediumTrees, bigTrees,
        lightPoles, grass, herbs, mushrooms,

        rooms: isEnclosed ? [{
            id:      'room_0',
            type:    'area',
            bounds:  { x: -(width / 2), y: -(height / 2), width, height },
            floor:   'stone_tile',
            ceiling: { height: wallHeight - 0.1, texture: 'stone_ceiling' },
            pbr:     { floor: floorPBR, ceiling: ceilPBR },
        }] : null,
        walls:   isEnclosed ? { thickness: 0.3, height: wallHeight, pbr: wallsPBR, segments: [] } : null,
        ceiling: isEnclosed ? { height: wallHeight, pbr: ceilPBR } : null,
        textures: isEnclosed ? textures : null,
        props:    isEnclosed ? placeTorches(width, height) : [],

        lighting: isEnclosed
            ? buildIndoorLighting(width, height, wallHeight)
            : buildOutdoorLighting(width, height),

        doors:         [],
        rocks:         [],
        bossRoom:      null,
        stairApproach: null,

        spawn,
    };
}
