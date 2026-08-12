import { randNumString } from "../tools/tools"
import { simpleCoreLoot, mediumCoreLoot, waterslimeCoreLoot, fireslimeCoreLoot, electricslimeCoreLoot } from "./coreDetails"
import { generateSlimes, generateFireSlimes, generateElectricSlimes, generateMonoliths, generateLesserDemons } from "../generate-datas/genenemy"

let monolithBodyHeight = 2

// openworld (placeId 888) slime territory - every water/fire/electric slime
// placed there (both the static ones below AND any index.ts spawns
// dynamically on top of them, see its own SLIME_SPAWN_* interval) carries
// this same object on .territory, a shared reference rather than a fresh
// copy per enemy. Centered on infterrain's own SPAWN_X/SPAWN_Z (0, 500) -
// same center every ring/band below is already scattered around - covering
// the combined range every slime type's own band sits within (waterslime
// 100-150, fireslime 300-600, electricslime 600-1000).
export const OPENWORLD_SLIME_TERRITORY = { center: { x: 0, y: 0, z: 500 }, minDist: 0, maxDist: 1000 }
// applies OPENWORLD_SLIME_TERRITORY to every enemy a generator call
// produced - .map() instead of baking .territory into the shared
// slimeBase/fireSlimeBase/electricSlimeBase templates themselves
// (genenemy.ts), since those generators are generic/reusable for any
// future placeId, not just this openworld population
function withTerritory(enemies: any[]) {
    return enemies.map(enem => ({ ...enem, territory: OPENWORLD_SLIME_TERRITORY }))
}

const enemyInterface = {
    currentPlaceId: 1,
    _id: `${randNumString()}`,

    encounterSound: false,

    // TEMP DEBUG - bumped way up from 100 so a single kill (village
    // waterslime/fireslime/electricslime, all built from this same
    // enemyInterface) is guaranteed to trigger a level-up regardless of
    // current character level, to make reproducing the "other player also
    // gets exp" multiplayer bug fast to trigger over and over. Revert to
    // 100 once done debugging.
    expToGain: 999999,
    bodyHeight: 1.8,
    bodyWidenes: .9,
    origPos: { x: 3.6, y: 0, z: 130 },
    effects: [
        { effectType: 'spdrain', chance: 10, permanent: false, dn: 'SP Drained', spcost: 20, hpcost: 0, mpcost: 0, hungercost: 4, energycost: 0 },
    ],
    effectsWhenHit: [
        { effectType: 'spdrain', chance: 10, permanent: false, dn: 'SP Drained', spcost: 20, hpcost: 0, mpcost: 0, hungercost: 4, energycost: 0 }
    ],
    titles: ['human killer'],
    skills: [],
    aptitude: ['light'],
    blessings: [],
    status: [],
    regens: { sp: 1, hp: 1, mana: 1 },
    monsSoul: 2,
    race: "monster",
    characterType: "enemy",
    actionType: "chasing",
    _isMoving: false,
    _targetId: false as string | false,
    _dirTarg: { x: 0, y:0, z: 0 },
    _attacking: false,
    _canAttack: true, // If stunned turn to false
    _disabled: false, // skill.enemyBind - see index.ts's enemyBind handler
    _cursed: false, // dark magic's curse - see index.ts's enemyCurse handler
    loots: [simpleCoreLoot],
    respawnDetails: {
        willRespawn: true,
        respawnTime: 5 * 1000,
    }
}

export default [
    // ...generateSlimes(20),
    // openworld (placeId 888) - centered on infterrain's own SPAWN_X/SPAWN_Z (0, 500),
    // not world origin, since that's where the actual playable terrain/player spawn is
    // ...generateSlimes(10, 888, 300, "ring", 0, 500),
    // ring surrounding the openworld cluster - scattered 100-150 units out from (0, 500)
    ...withTerritory(generateSlimes(15, 888, 300, "ring", 0, 500, 100, 150)),
    // fireslime/electricslime openworld population, banded rings around the
    // same (0, 500) center (infterrain's own SPAWN_X/SPAWN_Z, also the
    // player's own openworld spawn point) - fireslime 300-600 units out,
    // electricslime 600-1000, so the spawn point itself and its immediate
    // surroundings (0-300) stay completely enemy-free instead of dropping a
    // fresh arrival straight into a slime cluster. "ring" scatterPosition
    // picks a uniformly random angle (0-2π) for every single enemy
    // regardless of minRadius/maxRadius, so this still naturally covers
    // every direction - north/south/east/west - within each band, not just
    // one strip. These numbers are exactly what checkDistance({x:0,y:0,
    // z:500}, yourPos) reads client-side (creationTools.js's checkDistance
    // flattens both points to the same y before measuring, so it's the same
    // planar distance minRadius/maxRadius are measured in here) - inputMovement.js:407
    // is a live example of reading that same distance. areaSize (unused by
    // "ring" scatter, only minRadius/maxRadius matter for it) passed just
    // for readability, roughly 2x each band's own maxRadius.
    // 50 each (down from an initial 250/250) - static population is
    // deliberately sparse now, index.ts's own SLIME_SPAWN_* interval tops
    // territory up dynamically near whichever players are actually out
    // there instead of pre-building the whole area upfront. See
    // client/src/sockets/renderer.js's own OPENWORLD_PLACE_ID distance-based
    // mesh hiding (200 units) for how the client keeps this affordable to
    // render regardless of how many end up alive at once.
    ...withTerritory(generateFireSlimes(50, 888, 1200, "ring", 0, 500, 300, 600)),
    ...withTerritory(generateElectricSlimes(50, 888, 2000, "ring", 0, 500, 600, 1000)),
    // orangelith monoliths - further out than the slime ring, ~200 units from (0, 500)
    ...generateMonoliths(5, 888, 300, "ring", 0, 500, 200, 260),
    // single lesserdemon at the openworld center
    ...generateLesserDemons(1, 888, 300, "fixed", -34, 70),
    {...enemyInterface,
        _id: `${randNumString()}`,
        maxDistance: 0.5,
        x: 3.6,
        y: 0,
        z: 130,
        name: "waterslime",
        dn: "Slime",
        modelStyle: "slime",
        elementType: "water",
        aptitude: ['water'],
        stats: {
            dmg: 5,
            magDmg: 1,
            spd: 3.3,
            atkSpd: 2,
            accuracy: 1,
            critical: 1.4,
        },
        lvl: 1,
        hp: 580,
        maxHp: 580,
        loots: [waterslimeCoreLoot],
        // deathSound: "slimedeath",
    },
    // fireslime/electricslime - same spot/stats as the waterslime above,
    // just spaced a few units apart along x (3.6/6.6/9.6) so all three spawn
    // side by side instead of overlapping, placeId 1 (village) - see
    // enemyInterface's own currentPlaceId. Client-side, modelStyle "slime"
    // reuses the exact same slime.glb as waterslime (see client/src/enemies/
    // createEnemy.js), and elementType now actually picks the material's
    // color too (SLIME_ELEMENT_COLORS in skins.js - orange-red for fire,
    // yellow for electric, the original green for water/anything else).
    {...enemyInterface,
        _id: `${randNumString()}`,
        maxDistance: 0.5,
        x: 6.6,
        y: 0,
        z: 130,
        name: "fireslime",
        dn: "Fire Slime",
        modelStyle: "slime",
        elementType: "fire",
        aptitude: ['fire'],
        // Elite Skill (skillrank 1) matching its element - see createEnemy.js's
        // enemy skill-casting setInterval (SKILLS_BY_NAME resolves this name
        // to the real skill object client-side)
        skills: ['flamebrand'],
        // see createEnemy.js's own dodge-detection interval
        canDodge: true,
        stats: {
            dmg: 5,
            magDmg: 1,
            spd: 3.3,
            atkSpd: 2,
            accuracy: 1,
            critical: 1.4,
        },
        lvl: 1,
        hp: 580,
        maxHp: 580,
        loots: [fireslimeCoreLoot],
        // deathSound: "slimedeath",
    },
    {...enemyInterface,
        _id: `${randNumString()}`,
        maxDistance: 0.5,
        x: 9.6,
        y: 0,
        z: 130,
        name: "electricslime",
        dn: "Electric Slime",
        modelStyle: "slime",
        // "lightning" not "electric" - matches the game's own established
        // element vocabulary (see npcDetails.js's crystal NPC dialogue:
        // "Fire, water, wind, earth, lightning, light, dark...") and every
        // other aptitude entry in this codebase, none of which ever use
        // "electric"
        elementType: "lightning",
        aptitude: ['lightning'],
        // Elite Skill (skillrank 1) matching its element - see
        // client/src/staticRecources/skillsData.js's lightningboltSkill
        skills: ['lightningbolt'],
        // see createEnemy.js's own dodge-detection interval
        canDodge: true,
        stats: {
            dmg: 5,
            magDmg: 1,
            spd: 3.3,
            atkSpd: 2,
            accuracy: 1,
            critical: 1.4,
        },
        lvl: 1,
        hp: 580,
        maxHp: 580,
        loots: [electricslimeCoreLoot],
        // deathSound: "slimedeath",
    },
    // {...enemyInterface,
    //     _id: `${randNumString()}`,
    //     x: 3.6,
    //     y: 0,
    //     z: 130,
    //     name: "dirtGoblin",
    //     dn: "dirt goblin",
    //     modelStyle: "goblin",
    // },
    // {...enemyInterface,
    //     _id: `${randNumString()}`,
    //     x: -3.6,
    //     y: 0,
    //     z: 130,
    //     name: "orangelith",
    //     dn: "Monolith",
    //     modelStyle: "monolith",
    // },
    // dummy on training hall
    // {
    //     ...enemyInterface,
    //     _id: `${randNumString()}`,
    //     x: 0,
    //     z: 5,
    //     origPos: { x: 0, z: 5 },
    //     currentPlace: "churchTrainingHall",
    //     actionType: "idle",
    //     name: "wooddummy",
    //     dn: "Wood Dummy",
    //     modelStyle: "dummy",
    //     deathSound: "brokenWoodS",
    //     hp: 300,
    //     maxHp: 300,
    //     stats: { dmg: 1, magDmg: 1, accuracy: 0, critical: 1.4, spd: 3, atkSpd: 1 },
    //     loots: []
    // },
    // {
    //     ...enemyInterface,
    //     _id: `${randNumString()}`,
    //     x: -3,
    //     z: 5,
    //     origPos: { x: -3, z: 5 },
    //     currentPlace: "churchTrainingHall",
    //     actionType: "idle",
    //     name: "wooddummy",
    //     dn: "Wood Dummy",
    //     modelStyle: "dummy",
    //     deathSound: "brokenWoodS",
    //     hp: 30,
    //     maxHp: 30,
    //     stats: { dmg: 1, magDmg: 1, accuracy: 0, critical: 1.4, spd: 3, atkSpd: 1 },
    //     loots: []
    // },
    // {
    //     ...enemyInterface,
    //     _id: `${randNumString()}`,
    //     x: 1,
    //     z: 5,
    //     origPos: { x: 1, z: 5 },
    //     currentPlace: "churchTrainingHall",
    //     actionType: "idle",
    //     name: "wooddummy",
    //     dn: "Wood Dummy",
    //     modelStyle: "dummy",
    //     deathSound: "brokenWoodS",
    //     hp: 30,
    //     maxHp: 30,
    //     stats: { dmg: 1, magDmg: 1, accuracy: 0, critical: 1.4, spd: 3, atkSpd: 1 },
    //     loots: []
    // },
    // // goblins - afterWarScene
    // { ...enemyInterface, _id: `${randNumString()}`, x: -30, z: -30, origPos: { x: -30, z: -30 }, currentPlace: "afterWarScene" },
    // { ...enemyInterface, _id: `${randNumString()}`, x: 1, z: 55, origPos: { x: 1, z: 55 }, currentPlace: "afterWarScene" },
    // { ...enemyInterface, _id: `${randNumString()}`, x: 10, z: 40, origPos: { x: 10, z: 40 }, currentPlace: "afterWarScene" },
    // { ...enemyInterface, _id: `${randNumString()}`, x: -12, z: -34, origPos: { x: -12, z: -34 }, currentPlace: "afterWarScene" },
    // { ...enemyInterface, _id: `${randNumString()}`, x: -20, z: -38, origPos: { x: -12, z: -34 }, currentPlace: "afterWarScene" },
    // // monolith - afterWarScene
    // {
    //     ...enemyInterface,
    //     _id: `${randNumString()}`,
    //     x: -5,
    //     z: 45,
    //     bodyHeight: monolithBodyHeight,
    //     origPos: { x: -5, z: 45 },
    //     currentPlace: "afterWarScene",
    //     actionType: "dynamic",
    //     rangeAtkDetails: { range: 15, modelName: "sting", soundWhenHit: "struckS" },
    //     name: "orangelith",
    //     dn: "Orange Lith",
    //     modelStyle: "monolith",
    //     deathSound: "beeS",
    //     encounterSound: "beeS",
    //     hp: 5700,
    //     maxHp: 5700,
    //     stats: { dmg: 40, magDmg: 1, accuracy: 1, critical: 1.4, spd: 3, atkSpd: 2.9 },
    //     loots: [simpleCoreLoot],
    //     respawnDetails: { willRespawn: true, respawnTime: 30 * 1000 },
    //     effects: [{ effectType: 'poisoned', chance: 10, permanent: true, dn: 'Venom Extracted', spcost: 20, hpcost: 10, mpcost: 0, hungercost: 4, energycost: 0 }],
    // },
    // // goblins - ogresforest
    // { ...enemyInterface, _id: `${randNumString()}`, x: -12, z: -34, origPos: { x: -12, z: -34 }, currentPlace: "ogresforest" },
    // { ...enemyInterface, _id: `${randNumString()}`, x: -20, z: -38, origPos: { x: -12, z: -34 }, currentPlace: "ogresforest" },
    // // monoliths - ogresforest
    // {
    //     ...enemyInterface,
    //     _id: `${randNumString()}`,
    //     x: -5,
    //     z: 45,
    //     bodyHeight: monolithBodyHeight,
    //     origPos: { x: -5, z: 45 },
    //     currentPlace: "ogresforest",
    //     actionType: "dynamic",
    //     rangeAtkDetails: { range: 15, modelName: "sting", soundWhenHit: "struckS" },
    //     name: "orangelith",
    //     dn: "Orange Lith",
    //     modelStyle: "monolith",
    //     deathSound: "beeS",
    //     encounterSound: "beeS",
    //     hp: 5700,
    //     maxHp: 5700,
    //     stats: { dmg: 40, magDmg: 1, accuracy: 1, critical: 1.4, spd: 3, atkSpd: 2.9 },
    //     loots: [simpleCoreLoot],
    //     respawnDetails: { willRespawn: true, respawnTime: 30 * 1000 },
    //     effects: [{ effectType: 'poisoned', chance: 10, permanent: true, dn: 'Venom Extracted', spcost: 20, hpcost: 10, mpcost: 0, hungercost: 4, energycost: 0 }],
    // },
    // {
    //     ...enemyInterface,
    //     _id: `${randNumString()}`,
    //     x: 5,
    //     z: 40,
    //     bodyHeight: monolithBodyHeight,
    //     origPos: { x: -5, z: 45 },
    //     currentPlace: "ogresforest",
    //     actionType: "dynamic",
    //     rangeAtkDetails: { range: 15, modelName: "sting", soundWhenHit: "struckS" },
    //     name: "orangelith",
    //     dn: "Orange Lith",
    //     modelStyle: "monolith",
    //     deathSound: "beeS",
    //     encounterSound: "beeS",
    //     hp: 5700,
    //     maxHp: 5700,
    //     stats: { dmg: 40, magDmg: 1, accuracy: 1, critical: 1.4, spd: 3, atkSpd: 2.9 },
    //     loots: [simpleCoreLoot],
    //     respawnDetails: { willRespawn: true, respawnTime: 30 * 1000 },
    //     effects: [{ effectType: 'poisoned', chance: 10, permanent: true, dn: 'Venom Extracted', spcost: 20, hpcost: 10, mpcost: 0, hungercost: 4, energycost: 0 }],
    // },
    // {
    //     ...enemyInterface,
    //     _id: `${randNumString()}`,
    //     x: -5,
    //     z: -35,
    //     bodyHeight: monolithBodyHeight,
    //     origPos: { x: -5, z: 45 },
    //     currentPlace: "ogresforest",
    //     actionType: "dynamic",
    //     rangeAtkDetails: { range: 15, modelName: "sting", soundWhenHit: "struckS" },
    //     name: "orangelith",
    //     dn: "Orange Lith",
    //     modelStyle: "monolith",
    //     deathSound: "beeS",
    //     encounterSound: "beeS",
    //     hp: 5700,
    //     maxHp: 5700,
    //     stats: { dmg: 40, magDmg: 1, accuracy: 1, critical: 1.4, spd: 3, atkSpd: 2.9 },
    //     loots: [simpleCoreLoot],
    //     respawnDetails: { willRespawn: true, respawnTime: 30 * 1000 },
    //     effects: [{ effectType: 'poisoned', chance: 10, permanent: true, dn: 'Venom Extracted', spcost: 20, hpcost: 10, mpcost: 0, hungercost: 4, energycost: 0 }],
    // },
    // {
    //     ...enemyInterface,
    //     _id: `${randNumString()}`,
    //     x: 6,
    //     z: -35,
    //     bodyHeight: monolithBodyHeight,
    //     origPos: { x: -5, z: 45 },
    //     currentPlace: "ogresforest",
    //     actionType: "dynamic",
    //     rangeAtkDetails: { range: 15, modelName: "sting", soundWhenHit: "struckS" },
    //     name: "orangelith",
    //     dn: "Orange Lith",
    //     modelStyle: "monolith",
    //     deathSound: "beeS",
    //     encounterSound: "beeS",
    //     hp: 5700,
    //     maxHp: 5700,
    //     stats: { dmg: 40, magDmg: 1, accuracy: 1, critical: 1.4, spd: 3, atkSpd: 2.9 },
    //     loots: [simpleCoreLoot],
    //     respawnDetails: { willRespawn: true, respawnTime: 30 * 1000 },
    //     effects: [{ effectType: 'poisoned', chance: 10, permanent: true, dn: 'Venom Extracted', spcost: 20, hpcost: 10, mpcost: 0, hungercost: 4, energycost: 0 }],
    // },
    // // woodbane - ogresforest
    // {
    //     ...enemyInterface,
    //     _id: `${randNumString()}`,
    //     x: 0,
    //     z: 50,
    //     bodyHeight: 4.1,
    //     origPos: { x: -5, z: 45 },
    //     currentPlace: "ogresforest",
    //     actionType: "dynamic",
    //     rangeAtkDetails: { range: 25, modelName: "rock", soundWhenHit: "rockSmashS" },
    //     deathSound: "giantencounter",
    //     encounterSound: "giantencounter",
    //     name: "woodbane",
    //     dn: "Wood Bane",
    //     modelStyle: "woodbane",
    //     hp: 26700,
    //     maxHp: 26700,
    //     stats: { dmg: 90, magDmg: 1, accuracy: 4, critical: 1.4, spd: 3.6, atkSpd: 2.4 },
    //     loots: [mediumCoreLoot],
    //     respawnDetails: { willRespawn: true, respawnTime: 30 * 1000 },
    //     effects: [
    //         { effectType: 'spdrain', chance: 10, permanent: false, dn: 'SP Drained', spcost: 20, hpcost: 0, mpcost: 0, hungercost: 4, energycost: 0 },
    //     ],
    // },
]
