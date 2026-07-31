import { randNumString } from "../tools/tools"
import { simpleCoreLoot } from "../recources/coreDetails"

const slimeBase = {
    maxDistance: 0.5,
    name: "waterslime",
    dn: "Slime",
    modelStyle: "slime",
    elementType: "water",
    stats: {
        dmg: 5,
        magDmg: 1,
        spd: 5.3,
        atkSpd: 2,
        accuracy: 1,
        critical: 1.4,
    },
    lvl: 1,
    hp: 580,
    maxHp: 580,
    expToGain: 100,
    bodyHeight: 1,
    bodyWidenes: 0.9,
    effects: [
        { effectType: 'spdrain', chance: 10, permanent: false, dn: 'SP Drained', spcost: 20, hpcost: 0, mpcost: 0, hungercost: 4, energycost: 0 },
    ],
    effectsWhenHit: [
        { effectType: 'spdrain', chance: 10, permanent: false, dn: 'SP Drained', spcost: 20, hpcost: 0, mpcost: 0, hungercost: 4, energycost: 0 },
    ],
    titles: ['slime'],
    skills: [],
    aptitude: ['water'],
    blessings: [],
    status: [],
    regens: { sp: 1, hp: 1, mana: 1 },
    monsSoul: 1,
    race: "monster",
    characterType: "enemy",
    actionType: "chasing",
    _isMoving: false,
    _targetId: false as string | false,
    _dirTarg: { x: 0, y: 0, z: 0 },
    _attacking: false,
    _canAttack: true,
    loots: [simpleCoreLoot],
    respawnDetails: {
        willRespawn: true,
        respawnTime: 15 * 1000,
    },
}

const monolithBase = {
    maxDistance: 4.5,
    name: "orangelith",
    dn: "Orange Lith",
    modelStyle: "monolith",
    stats: {
        dmg: 2,
        magDmg: 1,
        spd: 7,
        atkSpd: 2.9,
        accuracy: 1,
        critical: 1.4,
    },
    lvl: 10,
    hp: 5700,
    maxHp: 5700,
    expToGain: 240,
    bodyHeight: 2,
    bodyWidenes: 1.1,
    actionType: "chasing",
    rangeAtkDetails: { range: 15, modelName: "sting", soundWhenHit: "struckS" },
    deathSound: "beeS",
    encounterSound: "beeS",
    effects: [
        { effectType: 'poisoned', chance: 10, permanent: true, dn: 'Venom Extracted', spcost: 20, hpcost: 10, mpcost: 0, hungercost: 4, energycost: 0 },
    ],
    effectsWhenHit: [],
    titles: ['stinger'],
    skills: [],
    aptitude: ['poison'],
    blessings: [],
    status: [],
    regens: { sp: 1, hp: 1, mana: 1 },
    monsSoul: 2,
    race: "monster",
    characterType: "enemy",
    _isMoving: false,
    _targetId: false as string | false,
    _dirTarg: { x: 0, y: 0, z: 0 },
    _attacking: false,
    _canAttack: true,
    loots: [simpleCoreLoot],
    respawnDetails: {
        willRespawn: true,
        respawnTime: 30 * 1000,
    },
}

const lesserDemonBase = {
    maxDistance: 7.5,
    name: "lesserdemon",
    dn: "Demon",
    modelStyle: "lesserdemon",
    stats: {
        dmg: 0,
        magDmg: 1,
        spd: 5.5,
        atkSpd: 2.5,
        accuracy: 4,
        critical: 1.4,
    },
    deathSound: false,
    encounterSound: false,
    lvl: 30,
    hp: 12000,
    maxHp: 12000,
    expToGain: 600,
    bodyHeight: 3.5,
    bodyWidenes: 1.5,
    effects: [
        { effectType: 'spdrain', chance: 10, permanent: false, dn: 'SP Drained', spcost: 20, hpcost: 0, mpcost: 0, hungercost: 4, energycost: 0 },
    ],
    effectsWhenHit: [
        { effectType: 'spdrain', chance: 10, permanent: false, dn: 'SP Drained', spcost: 20, hpcost: 0, mpcost: 0, hungercost: 4, energycost: 0 },
    ],
    titles: [],
    skills: [],
    aptitude: [],
    blessings: [],
    status: [],
    regens: { sp: 1, hp: 1, mana: 1 },
    monsSoul: 2,
    race: "monster",
    characterType: "enemy",
    actionType: "chasing",
    _isMoving: false,
    _targetId: false as string | false,
    _dirTarg: { x: 0, y: 0, z: 0 },
    _attacking: false,
    _canAttack: true,
    loots: [simpleCoreLoot],
    respawnDetails: {
        willRespawn: true,
        respawnTime: 5000 * 1000,
    },
}

function scatterPosition(areaType: string, half: number, minRadius: number, maxRadius: number) {
    let x: number, z: number

    if (areaType === "fixed") {
        // no scatter - lands exactly at (centerX, centerZ), for lone/boss-style spawns
        x = 0
        z = 0
    } else if (areaType === "ring") {
        // Scatter in an annulus [minRadius, maxRadius] around (centerX, centerZ),
        // surrounding an inner area rather than filling a square/border band
        const angle = Math.random() * Math.PI * 2
        const dist = minRadius + Math.random() * (maxRadius - minRadius)
        x = Math.cos(angle) * dist
        z = Math.sin(angle) * dist
    } else if (areaType === "village") {
        // Border band: outer 20% of each half (e.g. areaSize=300 → 120–150 range on each axis)
        const borderMin = half * 0.8
        const borderMax = half * 0.97
        const band = borderMax - borderMin

        // Pick a random side (north/south/east/west) and scatter within that border strip
        const side = Math.floor(Math.random() * 4)
        if (side === 0) {
            // north strip: z positive border
            x = (Math.random() * 2 - 1) * half
            z = borderMin + Math.random() * band
        } else if (side === 1) {
            // south strip: z negative border
            x = (Math.random() * 2 - 1) * half
            z = -(borderMin + Math.random() * band)
        } else if (side === 2) {
            // east strip: x positive border
            x = borderMin + Math.random() * band
            z = (Math.random() * 2 - 1) * half
        } else {
            // west strip: x negative border
            x = -(borderMin + Math.random() * band)
            z = (Math.random() * 2 - 1) * half
        }
    } else {
        // Non-village: spread anywhere across the map
        x = (Math.random() * 2 - 1) * half
        z = (Math.random() * 2 - 1) * half
    }

    return { x, z }
}

function generateEnemies(base: object, total: number, placeId: number, areaSize: number, areaType: string, centerX: number, centerZ: number, minRadius: number, maxRadius: number) {
    const half = areaSize / 2
    const enemies = []

    for (let i = 0; i < total; i++) {
        let { x, z } = scatterPosition(areaType, half, minRadius, maxRadius)

        // recenters the whole scatter around (centerX, centerZ) instead of world
        // origin - needed for areas like openworld where the actual playable/spawn
        // region isn't at (0,0) (infterrain's own SPAWN_X/SPAWN_Z is (0, 500))
        x += centerX
        z += centerZ

        const y = 0

        enemies.push({
            ...base,
            _id: `${randNumString()}`,
            currentPlaceId: placeId,
            x,
            y,
            z,
            origPos: { x, y, z },
        })
    }

    return enemies
}

export function generateSlimes(total = 10, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(slimeBase, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateMonoliths(total = 5, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(monolithBase, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateLesserDemons(total = 1, placeId = 1, areaSize = 300, areaType = "fixed", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(lesserDemonBase, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}
