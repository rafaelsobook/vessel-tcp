import { randNumString } from "../tools/tools"
import { simpleCoreLoot, mediumCoreLoot, waterslimeCoreLoot, fireslimeCoreLoot, electricslimeCoreLoot } from "./coreDetails"
import { OPENWORLD_GRAVEYARDS, ghostsForGraveyard } from "./graveyards"
import { generateSlimes, generateFireSlimes, generateElectricSlimes, generateMonoliths, generateLesserDemons, generateDarkSlimes, generateForestDeer, generateJasferDeer, generateLuminaDeer, generateNightmareDeer, generateScorchDeer, generateWisfDeer, generateGhosts } from "../generate-datas/genenemy"

let monolithBodyHeight = 2

// openworld (placeId 888) enemy territory - every enemy placed there (both
// the static OPENWORLD_ENEMY_BANDS population below AND any index.ts spawns
// dynamically topped up on top of them) carries this same object on
// .territory, a shared reference rather than a fresh copy per enemy.
// Centered on infterrain's own SPAWN_X/SPAWN_Z (0, 500) - same center every
// band below is already scattered around. maxDist (2600) matches
// OPENWORLD_ENEMY_BANDS' own outermost band (forestdeer, ...-2600) exactly -
// see that table further down for the real per-type radius breakdown; kept
// as its own separate constant here only because this whole object needs to
// exist before withTerritory (right below) can reference it, and
// withTerritory itself needs to exist before OPENWORLD_ENEMY_BANDS' own
// static population uses it. Keep these two in sync if either end of the
// outermost band ever changes.
export const OPENWORLD_SLIME_TERRITORY = { center: { x: 0, y: 0, z: 500 }, minDist: 0, maxDist: 2600 }
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

    // reverted from a leftover TEMP DEBUG value (999999 - bumped way up to
    // make a since-fixed "other player also gets exp" multiplayer bug easy
    // to reproduce, never reverted after). The three live entries that
    // spread this (waterslime/fireslime/electricslime below) all set their
    // own real expToGain explicitly now anyway - this is just a sane
    // fallback default for anything else built from enemyInterface without
    // its own override, not a value anything currently actually relies on.
    expToGain: 50,
    // was 1.8 - unified to match genenemy.ts's own slimeBase (openworld
    // waterslime/fireslime/electricslime), so the same-named slime is the
    // same size everywhere instead of visibly taller in the village than
    // in the open world
    bodyHeight: 1,
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
    weaponBlocking: false,
    magicBlocking: false,
    IsInVulnerable: false,
    loots: [simpleCoreLoot],
    // 10s - matching slimeBase's own respawnTime (genenemy.ts) now, so
    // village and openworld slimes respawn at the same rate instead of
    // this being 5s while openworld's own slimeBase was 15s for no
    // particular reason
    respawnDetails: {
        willRespawn: true,
        respawnTime: 10 * 1000,
    }
}

// --- OPENWORLD (placeId 888) RADIAL BANDING ---
// Single source of truth for "how far from center does each enemy type
// spawn," centered on OPENWORLD_SLIME_TERRITORY's own (0, 500) (infterrain's
// SPAWN_X/SPAWN_Z, also the player's own openworld spawn point). Ordered
// nearest-to-farthest, matching the intended difficulty progression a
// player walking straight out from spawn should actually encounter:
// waterslime -> fireslime -> electricslime -> orangelith -> darkslime ->
// forestdeer. Bands are contiguous and non-overlapping by construction (each
// one's minDist is the previous one's maxDist) - keep them that way when
// tuning, or two types end up sharing ground again.
//
// Used for BOTH the static population below (one flatMap instead of six
// hand-typed withTerritory(generateX(...)) calls that could silently drift
// out of sync with each other - which is exactly what had happened here:
// the six calls used to be typed in a completely different order than their
// own radius numbers actually put them in, so reading the file top-to-bottom
// never matched what a player walking outward actually ran into) AND
// index.ts's own dynamic top-up interval, which used to pick a generator
// UNIFORMLY AT RANDOM across all five types regardless of the player's
// actual distance from center - see that file's own comment on
// OPENWORLD_ENEMY_BANDS for the full "why" this was the real bug behind
// seeing the wrong monsters near spawn. The static rings below were always
// correctly banded; the dynamic top-up that keeps the world populated as
// players roam/kill things was not, and it runs far more often (every 500ms,
// per player) than the one-time static build.
//
// areaSize (unused by "ring" scatter itself, kept only because
// generateEnemies' own signature still takes one) is derived here as
// maxDist*2, same "roughly 2x maxRadius" convention this file's own
// generator calls always used by hand.
export const OPENWORLD_ENEMY_BANDS = [
    { generator: generateSlimes,         name: "waterslime",    count: 15, minDist: 100,  maxDist: 150 },
    { generator: generateFireSlimes,     name: "fireslime",     count: 50, minDist: 150,  maxDist: 450 },
    { generator: generateElectricSlimes, name: "electricslime", count: 50, minDist: 450,  maxDist: 850 },
    { generator: generateMonoliths,      name: "orangelith",    count: 5,  minDist: 850,  maxDist: 950 },
    { generator: generateDarkSlimes,     name: "darkslime",     count: 50, minDist: 950,  maxDist: 2000 },
    { generator: generateForestDeer,     name: "forestdeer",    count: 10, minDist: 2000, maxDist: 2600 },
]

export default [
    // openworld (placeId 888) - the six bands above, in the exact same
    // nearest-to-farthest order they're declared in (see that table's own
    // header comment). 50/50/50 for the three common trash-mob bands (down
    // from an initial 250/250 - static population is deliberately sparse
    // now, index.ts's own dynamic top-up interval tops territory up near
    // whichever players are actually out there instead of pre-building the
    // whole area upfront - see client/src/sockets/renderer.js's own
    // OPENWORLD_PLACE_ID distance-based mesh hiding for how the client keeps
    // this affordable regardless of how many end up alive at once), 5/10 for
    // the two rarer/tougher single-type bands (orangelith/forestdeer).
    ...OPENWORLD_ENEMY_BANDS.flatMap(band =>
        withTerritory(band.generator(band.count, 888, band.maxDist * 2, "ring", 0, 500, band.minDist, band.maxDist))
    ),
    // graveyard ghosts (placeId 888, openworld) - one group per plot in
    // graveyards.ts (the mirror of the client's constants/graveyards.js).
    // 0.8x each plot's areaSize as the scatter square keeps every ghost
    // comfortably inside creategraveyard.js's fence line instead of right
    // on top of it. ghostsForGraveyard scales the count by plot area -
    // sparse and elite, not one of the OPENWORLD_ENEMY_BANDS' trash-mob
    // fields. The client only builds an openworld enemy within 300 units
    // (worldsocket.js's OPENWORLD_ENEMY_CREATE_DIST), so ghosts at plots
    // nobody is near cost nothing there.
    ...OPENWORLD_GRAVEYARDS.flatMap(plot =>
        generateGhosts(ghostsForGraveyard(plot.areaSize), 888, plot.areaSize * 0.8, "square", plot.position.x, plot.position.z)
    ),
    // single lesserdemon - removed for now (was at (85, 585), ~120 units
    // from the true openworld center (0, 500), inside waterslime's own
    // 100-150 band - see git history/prior comment here for the full
    // "was (-34, 70), nowhere near center" fix this position itself was).
    // Re-add with `...generateLesserDemons(1, 888, 300, "fixed", 85, 585),`
    // if/when this comes back.
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
        // own explicit value now, not enemyInterface's shared 999999 debug
        // leftover - weakest slime variant, so the smallest exp
        expToGain: 50,
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
        expToGain: 200,
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
        expToGain: 500,
        // deathSound: "slimedeath",
    },
    // one of each deer texture variant, village (placeId 1) - "fixed"
    // areaType lands each exactly at (centerX, centerZ) with no scatter,
    // same pattern generateLesserDemons(1, 888, ...) uses for its own single
    // openworld spawn. Continues the waterslime/fireslime/electricslime row
    // above (3.6/6.6/9.6 along x) in the same 3-unit spacing, purely so all
    // 6 are lined up and easy to walk down and look at - genenemy.ts's own
    // jasferDeer/luminaDeer/nightmareDeer/scorchDeer/wisfDeer bases already
    // carry their own real stats/loot/effects (recolors of forestDeer), no
    // need to redeclare them here.
    ...generateForestDeer(1, 1, 300, "fixed", 12.6, 130),
    ...generateJasferDeer(1, 1, 300, "fixed", 15.6, 130),
    ...generateLuminaDeer(1, 1, 300, "fixed", 18.6, 130),
    ...generateNightmareDeer(1, 1, 300, "fixed", 21.6, 130),
    ...generateScorchDeer(1, 1, 300, "fixed", 24.6, 130),
    ...generateWisfDeer(1, 1, 300, "fixed", 27.6, 130),
    // graveyard ghosts (placeId 1, village) - localroomdb.js's graveYards
    // entry for this place: position (55, 10), areaSize 10. Same 0.8x
    // shrink-to-stay-inside-the-fence reasoning as the openworld graveyard
    // ghosts above, just a much smaller plot - 2 ghosts, not this file's
    // usual village trash-mob counts, since the whole fenced square is only
    // 10x10 and already shares that space with creategraveyard.js's own
    // rows of gravestones.
    ...generateGhosts(2, 1, 8, "square", 55, 10),
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
