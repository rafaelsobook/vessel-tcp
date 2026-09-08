import { randNumString } from "../tools/tools"
import { simpleCoreLoot, waterslimeCoreLoot, fireslimeCoreLoot, electricslimeCoreLoot, darkslimeCoreLoot } from "../recources/coreDetails"

const slimeBase = {
    maxDistance: 0.5,
    name: "waterslime",
    dn: "Slime",
    modelStyle: "slime",
    elementType: "water",
    stats: {
        dmg: 5,
        magDmg: 1,
        spd: 2.5,
        atkSpd: 2,
        accuracy: 1,
        critical: 1.4,
    },
    lvl: 1,
    hp: 1000,
    maxHp: 1000,
    // reverted from a leftover TEMP DEBUG value (999999 - bumped way up to
    // make a since-fixed "other player also gets exp" multiplayer bug easy
    // to reproduce, never reverted after). This is waterslime's OWN real
    // value now - the weakest slime variant, so the smallest exp - not just
    // a shared fallback: fireSlimeBase/electricSlimeBase/darkSlimeBase below
    // all override this explicitly with their own higher amount instead of
    // inheriting it.
    expToGain: 50,
    bodyHeight: 1.15,
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
    _disabled: false, // skill.enemyBind - see index.ts's enemyBind handler
    _cursed: false, // dark magic's curse - see index.ts's enemyCurse handler
    weaponBlocking: false,
    magicBlocking: false,
    IsInVulnerable: false,
    loots: [waterslimeCoreLoot],
    // 10s - matching enemyInterface's own respawnTime (enemyDetails.ts) now,
    // so village and openworld slimes respawn at the same rate instead of
    // this being 15s while the village ones were 5s for no particular reason
    respawnDetails: {
        willRespawn: true,
        respawnTime: 10 * 1000,
    },
}
// fire/electric variants of slimeBase - same body/stats template, just the
// element/loot/skill swapped in, same pattern enemyDetails.ts's own
// standalone fireslime/electricslime entries (village, placeId 1) already
// use: skills: [elementSkill] (createEnemy.js's enemy skill-casting
// interval resolves this name to the real skill object client-side via
// SKILLS_BY_NAME) and canDodge: true (createEnemy.js's own dodge-detection
// interval). Both still spread via generateEnemies/scatterPosition exactly
// like generateSlimes does - only the base template differs.
const fireSlimeBase = {
    ...slimeBase,
    name: "fireslime",
    dn: "Fire Slime",
    elementType: "fire",
    titles: ['fire slime'],
    aptitude: ['fire'],
    skills: ['flamebrand'],
    canDodge: true,
    loots: [fireslimeCoreLoot],
    expToGain: 200,
    hp: 2500,
    maxHp: 2500,
}

const electricSlimeBase = {
    ...slimeBase,
    name: "electricslime",
    dn: "Electric Slime",
    // "lightning" not "electric" - matches the game's own established
    // element vocabulary, same reasoning as enemyDetails.ts's own
    // standalone electricslime entry
    elementType: "lightning",
    titles: ['electric slime'],
    aptitude: ['lightning'],
    skills: ['lightningbolt'],
    canDodge: true,
    loots: [electricslimeCoreLoot],
    expToGain: 500,
    hp: 3000,
    maxHp: 3000,
}

// darkslime - the enemy filling OPENWORLD_SLIME_TERRITORY's far edge (past
// electricslime's own 600-1000 band, see enemyDetails.ts's withTerritory
// call for this one), so it's deliberately built as the toughest of the
// slime family rather than just another same-strength recolor: real stat
// bumps on top of slimeBase's own (lvl 1/hp 2580/dmg 5), not just a palette
// swap. shadowbolt (skillsData.js - element: "dark") already exists and is
// already enemy-usable (lesserDemonBase above casts it too), so reused
// as-is instead of inventing a new skill. elementType: "dark" resolves to
// the purple/black palette added in client/src/enemies/skins.js.
const darkSlimeBase = {
    ...slimeBase,
    name: "darkslime",
    dn: "Dark Slime",
    elementType: "dark",
    stats: {
        dmg: 10,
        magDmg: 10,
        spd: 3.5,
        atkSpd: 3,
        accuracy: 1.2,
        critical: 1.5,
    },
    lvl: 5,
    hp: 4200,
    maxHp: 4200,
    // bodyHeight/bodyWidenes intentionally NOT overridden here anymore -
    // used to be bigger (1.3/1.1) than slimeBase's own 1/0.9 to read as
    // visibly heftier at a glance, matching its higher stats, but all four
    // slime types are unified to the same size now - "toughest of the
    // family" is still true (stats above), just not telegraphed by size
    titles: ['dark slime'],
    aptitude: ['dark'],
    skills: ['shadowbolt'],
    canDodge: true,
    loots: [darkslimeCoreLoot],
    expToGain: 2000,
}

const monolithBase = {
    // was 4.5 - way past melee reach (renderer.js's chase loop stops
    // advancing once dist < maxDistance, and createEnemy.js's attack()
    // uses the same field for its own range check), so it stopped and
    // "attacked" from 4.5 units out with nothing ever visually connecting.
    // rangeAtkDetails below (range: 15) suggests 4.5 was actually tuned for
    // a ranged sting attack, but the code that would use rangeAtkDetails is
    // commented out in createEnemy.js and actionType here is "chasing" not
    // "dynamic"/"throwing" - it never fires, so this was silently running
    // melee-only this whole time. 0.7 is a real melee reach, roughly
    // matching slimeBase's own maxDistance-to-bodyWidenes ratio (0.5/0.9)
    // with a little extra for this enemy's taller frame (bodyHeight 2).
    maxDistance: 0.7,
    name: "orangelith",
    dn: "Orange Lith",
    modelStyle: "monolith",
    // see client/src/enemies/createEnemy.js's own dodge-detection interval
    canDodge: true,
    // was dmg:2/magDmg:1/accuracy:1/critical:1.4 - identical to or actually
    // LOWER than slimeBase's own dmg:5 despite monolith being lvl 10 vs
    // slime's lvl 1 and having 5700 hp vs 2580. Bumped so monolith is
    // genuinely tougher than electricSlimeBase (which spreads slimeBase's
    // stats unchanged) in melee dmg/magDmg/accuracy/critical too, not just
    // hp/spd/atkSpd.
    stats: {
        dmg: 12,
        magDmg: 4,
        spd: 7,
        atkSpd: 2.9,
        accuracy: 1.3,
        critical: 1.6,
    },
    lvl: 10,
    hp: 5700,
    maxHp: 5700,
    expToGain: 600,
    bodyHeight: 2,
    bodyWidenes: 1.1,
    actionType: "chasing",
    rangeAtkDetails: { range: 15, modelName: "sting", soundWhenHit: "struckS" },
    deathSound: "beeS",
    encounterSound: "beeS",
    effects: [
        { effectType: 'poisoned', chance: 10, permanent: true, dn: 'Venom Extracted', spcost: 20, hpcost: 10, mpcost: 0, hungercost: 4, energycost: 0, soundPlayPerDmg: 'dmgpm' },
    ],
    effectsWhenHit: [],
    titles: ['stinger'],
    // stoneshard (skillsData.js - earth, projectileStyle "blade", same
    // safe-for-enemies style flamebrand/lightningbolt already use) -
    // resolved client-side via SKILLS_BY_NAME, same generic det.skills-
    // driven casting interval fireslime/electricslime already use
    // (createEnemy.js)
    skills: ['stoneshard'],
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
    _disabled: false, // skill.enemyBind - see index.ts's enemyBind handler
    _cursed: false, // dark magic's curse - see index.ts's enemyCurse handler
    weaponBlocking: false,
    magicBlocking: false,
    IsInVulnerable: false,
    loots: [simpleCoreLoot],
    respawnDetails: {
        willRespawn: true,
        respawnTime: 30 * 1000,
    },
}

// forestdeer - modelStyle "deer" (models/monsters/deer.glb, already on disk,
// with real idle1/walking/running1/attack1/death clips - confirmed by
// grepping the glb's own text, not assumed) needs its own loadMonsterRoot
// call + switch case wired in client-side (containers.js/worldsocket.js/
// createEnemy.js) before this actually renders, same as every other
// modelStyle here. Also still needs a real body texture at
// images/textures/enemy/deer/forestdeer.jpg (createMonsterMaterial's own
// path convention, see monolith/goblin's existing texture folders) - not
// something this file can provide.
//
// deerBase (spread in below) is kept as its own object rather than inlined
// - stats.walkSpd is the one field here that's genuinely new (no other
// enemy base has it): renderer.js's own wander/roam movement branch reads
// it to move at a slower pace and play the real "walking" clip above while
// idly roaming, instead of always sprinting everywhere on "running" the way
// every walkSpd-less enemy (slime/monolith/lesserdemon) still does.
const deerBase = {
    canDodge: true,
    stats: {
        dmg: 40,
        magDmg: 4,
        spd: 8,
        walkSpd: 3,
        atkSpd: 5,
        accuracy: 1.3,
        critical: 1.6,
    },
}
const forestDeer = {
    ...deerBase,
    maxDistance: 0.7,
    name: "forestdeer",
    dn: "Forest Deer",
    modelStyle: "deer",
    lvl: 20,
    hp: 5700,
    maxHp: 5700,
    expToGain: 1000,
    bodyHeight: 3,
    bodyWidenes: 1.1,
    actionType: "chasing",
    effects: [
        { effectType: 'poisoned', chance: 10, permanent: true, dn: 'Venom Extracted', spcost: 20, hpcost: 10, mpcost: 0, hungercost: 4, energycost: 0, soundPlayPerDmg: 'dmgpm' },
    ],
    effectsWhenHit: [],
    skills: [],
    blessings: [],
    status: [],
    regens: { sp: 1, hp: 1, mana: 1 },
    monsSoul: 2,
    race: "monster",
    characterType: "enemy",
    weaponBlocking: false,
    magicBlocking: false,
    IsInVulnerable: false,
    // required - createEnemy.js's own death handler does `loots.length` with
    // no guard, so an enemy base missing this crashes the client on death.
    // simpleCoreLoot, not mediumCoreLoot, to match its lvl/hp tier (monolith
    // lvl10/hp5700 and lesserdemon lvl30/hp12000 both use simpleCoreLoot too -
    // mediumCoreLoot is reserved for woodbane, a much bigger hp26700 enemy)
    loots: [simpleCoreLoot],
    respawnDetails: {
        willRespawn: true,
        respawnTime: 30 * 1000,
    },
}

// jasfer/lumina/nightmare/scorch/wisf - pure texture recolors of forestDeer
// (images/textures/enemy/deer/<name>.jpg, all 6 already on disk, confirmed).
// Same modelStyle "deer" (one shared deer.glb), same combat stats/loot/
// effects as forestDeer - only name/dn differ, since that's what
// createMonsterMaterial's own ${modelStyle}/${name}.jpg path convention
// keys its texture lookup on. Not elementally distinct yet (no
// aptitude/skill changes) - can be split apart the same way
// fireSlimeBase/electricSlimeBase diverge from slimeBase if these are
// meant to play differently later, not just look different.
const jasferDeer     = { ...forestDeer, name: "jasferdeer",    dn: "Jasfer Deer" }
const luminaDeer      = { ...forestDeer, name: "luminadeer",    dn: "Lumina Deer" }
const nightmareDeer   = { ...forestDeer, name: "nightmaredeer", dn: "Nightmare Deer" }
const scorchDeer      = { ...forestDeer, name: "scorchdeer",    dn: "Scorch Deer" }
const wisfDeer        = { ...forestDeer, name: "wisfdeer",      dn: "Wisf Deer" }

const lesserDemonBase = {
    // was 7.5, same "stops and swings from way too far away" issue as
    // monolithBase above - this one has no rangeAtkDetails at all backing
    // it, just an oversized value. 1.0 is a real melee reach, scaled up
    // from slimeBase's own maxDistance-to-bodyWidenes ratio (0.5/0.9) for
    // this enemy's much larger frame (bodyWidenes 1.5, bodyHeight 3.5).
    maxDistance: 1.0,
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
    // shadowbolt (skillsData.js - dark, projectileStyle "bolt", a particle
    // trail with no mesh/material for fireEnemySkillProjectile's own cached
    // InstancedMesh box to fight - see that function's own comment on why
    // "lightning"/"halo" specifically would silently fail there) - resolved
    // client-side via SKILLS_BY_NAME, same generic det.skills-driven
    // casting interval every other skill-casting enemy already uses
    skills: ['shadowbolt'],
    aptitude: ['dark'],
    blessings: [],
    status: [],
    regens: { sp: 1, hp: 1, mana: 1 },
    monsSoul: 2,
    race: "monster",
    characterType: "enemy",
    // "teleporting" not "chasing" - this enemy never walks toward its
    // target at all (renderer.js's own movement loop only actually
    // translates an enemy forward when det.actionType === "chasing", a
    // guard added specifically for this). Instead it teleports in near
    // whoever it's decided to approach (client/src/enemies/createEnemy.js's
    // own lesserdemon-only teleport interval: telegraphs with a magic
    // circle, teleports a beat later close enough to melee) rather than
    // covering the distance on foot.
    actionType: "teleporting",
    _isMoving: false,
    _targetId: false as string | false,
    _dirTarg: { x: 0, y: 0, z: 0 },
    _attacking: false,
    _canAttack: true,
    _disabled: false, // skill.enemyBind - see index.ts's enemyBind handler
    _cursed: false, // dark magic's curse - see index.ts's enemyCurse handler
    weaponBlocking: false,
    magicBlocking: false,
    IsInVulnerable: false,
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

export function generateFireSlimes(total = 10, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(fireSlimeBase, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateElectricSlimes(total = 10, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(electricSlimeBase, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateDarkSlimes(total = 10, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(darkSlimeBase, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateMonoliths(total = 5, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(monolithBase, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateForestDeer(total = 10, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(forestDeer, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateJasferDeer(total = 10, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(jasferDeer, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateLuminaDeer(total = 10, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(luminaDeer, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateNightmareDeer(total = 10, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(nightmareDeer, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateScorchDeer(total = 10, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(scorchDeer, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateWisfDeer(total = 10, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(wisfDeer, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateLesserDemons(total = 1, placeId = 1, areaSize = 300, areaType = "fixed", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(lesserDemonBase, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}
