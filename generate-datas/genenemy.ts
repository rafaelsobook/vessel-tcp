import { randNumString } from "../tools/tools"
import { simpleCoreLoot, mediumCoreLoot, waterslimeCoreLoot, fireslimeCoreLoot, electricslimeCoreLoot, darkslimeCoreLoot, celestineOreLoot, orangelithCoreLoot } from "../recources/coreDetails"
import { isNearCastle } from "../recources/castles"
import { beastMeatLoot } from "../recources/meatLoots"

// clear ground kept around each openworld castle when placing enemies - see
// generateEnemies
const CASTLE_SPAWN_MARGIN = 10

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
    // tidalspikeSkill (client/src/staticRecources/skillsData.js) - element
    // "water", skillrank:1 ("Elite Skill"), same tier/stat shape
    // fireSlimeBase's own flamebrand and electricSlimeBase's own
    // lightningbolt already sit at (castDuration:2, skillCoolDown:1500, mp
    // demand:15, plusDmg:70) - waterslime was the only one of the four
    // slime variants with no skill at all until now. canDodge:true to match
    // (client/src/enemies/createEnemy.js's own dodge-detection interval
    // gates on this flag, same as the other three).
    skills: ['tidalspike'],
    canDodge: true,
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
    elementType: "earth",
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
    // its own core now, not the generic small one (coreDetails.ts)
    loots: [orangelithCoreLoot],
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
    elementType: "none",
    // elemental weakness (client's creations/skillEffects.js's own
    // getElementDamageMultiplier reads this off det.weakness) - a player
    // skill whose own element matches this deals bonus damage. Not the
    // same field as elementType above (that one's purely cosmetic - which
    // SLIME_ELEMENT_COLORS palette a slime's shared material uses,
    // client's enemies/skins.js - deer don't even use that material).
    weakness: "fire",
    maxDistance: 0.7,
    modelStyle: "deer",
    stats: {
        dmg: 40,
        magDmg: 4,
        spd: 8,
        walkSpd: 3,
        atkSpd: 5,
        accuracy: 1.3,
        critical: 1.6,
    },
    effects: [
        // { effectType: 'poisoned', chance: 10, permanent: true, dn: 'Venom Extracted', spcost: 20, hpcost: 10, mpcost: 0, hungercost: 4, energycost: 0, soundPlayPerDmg: 'dmgpm' },
    ],
}
const forestDeer = {
    ...deerBase,

    name: "forestdeer",
    dn: "Forest Deer",

    lvl: 20,
    hp: 5700,
    maxHp: 5700,
    expToGain: 1000,
    bodyHeight: 3,
    bodyWidenes: 1.1,
    actionType: "chasing",

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
    // simpleCoreLoot, not mediumCoreLoot, to match its lvl/hp tier (lesserdemon
    // lvl30/hp12000 uses simpleCoreLoot too - mediumCoreLoot is reserved for
    // much bigger enemies)
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
const jasferDeer     = { ...forestDeer, elementType: "none", name: "jasferdeer",    dn: "Jasfer Deer" }
const luminaDeer      = { ...forestDeer,elementType: "none", name: "luminadeer",    dn: "Lumina Deer" }
const nightmareDeer   = { ...forestDeer,elementType: "none", name: "nightmaredeer", dn: "Nightmare Deer" }
const scorchDeer      = { ...forestDeer,elementType: "none", name: "scorchdeer",    dn: "Scorch Deer" }
const wisfDeer        = { ...forestDeer,elementType: "none", name: "wisfdeer",      dn: "Wisf Deer" }

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

// ghost - modelStyle "ghost" (models/monsters/ghost.glb, with real
// idle1/running1/attack1/attack2/hit1/hit2/death clips - confirmed by
// reading the glb's own animation list). Rendered client-side by
// containers.js's ghostRoot + createEnemy.js's "ghost" case, textured by
// images/textures/enemy/ghost/ghost.jpg (createMonsterMaterial's
// convention).
//
// A graveyard-only enemy - generateGhosts (below) is called from
// enemyDetails.ts once per graveYards entry (localroomdb.js), scattered
// through that graveyard's own square footprint via scatterPosition's
// "square" branch, not one of the openworld radial bands every other
// openworld enemy above uses. weakness: "light" - the classic
// undead-vs-holy-magic matchup (client's skillEffects.js's own
// getElementDamageMultiplier reads this the same way deerBase's own
// weakness:"fire" already does), giving a light-element caster a reason to
// visit.
//
// skills - createEnemy.js's casting interval picks one at random per cast.
// blinkstrike goes through skillEffects.js's triggerEnemyBlinkstrike (a
// telegraphed teleport + one boosted melee hit: (stats.dmg + the skill's
// plusDmg 100) x1.5 guaranteed crit = 165 before the player's defense).
// darkorb goes through the generic enemy projectile path (its custom orb
// and stick-and-grow hit both work on a player target): the skill's
// plusDmg 260 + magDmg x20 - see magDmg below.
const ghostBase = {
    maxDistance: 0.6,
    name: "ghost",
    dn: "Restless Spirit",
    modelStyle: "ghost",
    elementType: "dark",
    weakness: "light",
    // weapons and fists pass straight through it - tcp/index.ts's
    // applyDamageToEnemy zeroes any hit whose dmgDetails.isPhysicalDmg is
    // true (a real swing, a thrown weapon, dashstrike/blinkstrike, a melee
    // bot) and tells every client to pop "miss" instead of a damage number
    // (createEnemy.js's enemyIsHit). Skills and burn ticks still land
    // normally - they never set isPhysicalDmg.
    physicalImmune: true,
    // the Purification skill destroys it outright - applyDamageToEnemy
    // (tcp/index.ts) turns a dmgDetails.isPurify hit into its full remaining
    // hp. Only enemies with this flag; anything else a purify hit lands on
    // takes nothing.
    purifiable: true,
    stats: {
        dmg: 10,
        // was 16 - fireEnemySkillProjectile scales an enemy's spell by
        // plusDmg + magDmg x20, so 16 added 320 to every cast (a 580 darkorb
        // against a lvl 13 player's 330 hp). 2 -> darkorb 300, still the
        // ghost's big hit, telegraphed by its own 4s cast circle.
        magDmg: 2,
        spd: 3.6,
        atkSpd: 2.2,
        accuracy: 1.2,
        critical: 1.5,
    },
    skills: ['blinkstrike', 'darkorb'],
    canDodge: true,
    lvl: 5,
    hp: 1800,
    maxHp: 1800,
    expToGain: 350,
    // ghost.glb hovers - its mesh spans y 0.56..1.68 above its own origin,
    // which createEnemy.js always puts at ground level regardless of
    // bodyHeight. 1.8 (not the 1.6 first tried) keeps createHpBar's
    // bodyHeight/2+0.1 offset clear of the top of the head instead of
    // sitting right on it.
    bodyHeight: 1.8,
    bodyWidenes: 0.8,
    effects: [
        { effectType: 'spdrain', chance: 10, permanent: false, dn: 'SP Drained', spcost: 20, hpcost: 0, mpcost: 0, hungercost: 4, energycost: 0 },
    ],
    effectsWhenHit: [
        { effectType: 'spdrain', chance: 10, permanent: false, dn: 'SP Drained', spcost: 20, hpcost: 0, mpcost: 0, hungercost: 4, energycost: 0 },
    ],
    titles: ['haunt'],
    aptitude: ['dark'],
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
    _disabled: false, // skill.enemyBind - see index.ts's enemyBind handler
    _cursed: false, // dark magic's curse - see index.ts's enemyCurse handler
    weaponBlocking: false,
    magicBlocking: false,
    IsInVulnerable: false,
    loots: [simpleCoreLoot],
    // between slimeBase's 10s and monolithBase's 30s - a graveyard "elite",
    // not a trash mob, but still a themed area meant to be farmed a bit
    respawnDetails: {
        willRespawn: true,
        respawnTime: 20 * 1000,
    },
}

// giant scorpion - modelStyle "giantscorpion" (models/monsters/giantscorpion.glb,
// idle1/running1/attack1/attack2/hit1/death - the same clip names ghost.glb
// uses, so createEnemy.js plays it with no special cases). ONE rig for every
// kind of scorpion: a kind is a copy of this base with its own `name`, which
// picks its skin (images/textures/enemy/giantscorpion/<name>.jpg -
// createMonsterMaterial's convention), plus stats/element/loot.
//
// modelScale/modelYaw (createEnemy.js applies both): as exported the model is
// ~3x too big (a 4.6-wide body, tail curling 12+ up) and faces -z - 0.38
// makes it ~2.5 wide and ~5 tall tail-up, a real giant next to a 1.5-tall
// player that still fits a dungeon's 4-unit cells; Math.PI turns it to face
// the way it walks.
const giantScorpionBase = {
    // reach - its tail strikes well ahead of it
    maxDistance: 1.4,
    name: "giantscorpion",
    dn: "Giant Scorpion",
    modelStyle: "giantscorpion",
    modelScale: 0.38,
    modelYaw: Math.PI,
    elementType: "earth",
    stats: {
        dmg: 22,
        magDmg: 1,
        spd: 3.0,
        atkSpd: 2.0,
        accuracy: 1.2,
        critical: 1.5,
    },
    lvl: 6,
    hp: 3200,
    maxHp: 3200,
    expToGain: 420,
    // the hp bar and name sit over its back, below the raised tail
    bodyHeight: 2.0,
    bodyWidenes: 1.6,
    // the sting - same "poisoned" shape the venomous enemies use, lifted
    // by the same cures (lunaraqum's cure: ["poisoned"])
    effects: [
        { effectType: 'poisoned', chance: 15, permanent: true, dn: 'Scorpion Venom', spcost: 10, hpcost: 15, mpcost: 0, hungercost: 2, energycost: 0 },
    ],
    effectsWhenHit: [],
    titles: ['scorpion'],
    aptitude: ['earth'],
    skills: [] as string[],
    canDodge: false,
    blessings: [],
    status: [],
    regens: { sp: 1, hp: 1, mana: 1 },
    monsSoul: 3,
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
    loots: [simpleCoreLoot],
    respawnDetails: {
        willRespawn: true,
        respawnTime: 30 * 1000,
    },
}

// the first kind - icy, crystal-skinned (images/textures/enemy/giantscorpion/
// icescorpion.jpg). skin: "crystal" gives it the client's crystal material
// (enemies/skins.js's createCrystalMat - glints and a cold rim glow) instead
// of a plain textured one. Ice melts: weak to fire.
const iceScorpionBase = {
    ...giantScorpionBase,
    name: "icescorpion",
    dn: "Frost Scorpion",
    elementType: "water",
    weakness: "fire",
    skin: "crystal",
    titles: ['frost scorpion'],
    aptitude: ['water'],
    loots: [celestineOreLoot],
}

// stray wolf - modelStyle "wolf" (models/monsters/wolf.glb, idle1/running1/
// attack1/attack2/hit1/hit2/death - the same clip names ghost.glb and
// giantscorpion.glb use, so createEnemy.js plays it with no special cases),
// skinned by images/textures/enemy/wolf/straywolf.jpg (createMonsterMaterial's
// convention). A fast hunter: spd 9 out-runs everything else here (deer 8,
// monolith 7) but stays under the player's sprint (inputMovement.js's
// sprintSpeed 10) - you can still get away from one, just barely. No walkSpd:
// the model has no walking clip, so it lopes everywhere on running1. They
// roam the openworld's outermost band, past the forest deer (enemyDetails.ts's
// OPENWORLD_ENEMY_BANDS), so they sit just above the deer's tier: a touch
// more level, a little less hp, quicker, lighter bites.
const strayWolfBase = {
    maxDistance: 0.8,
    name: "straywolf",
    dn: "Stray Wolf",
    // a hunter, not a grazer - sees you coming from this far off and runs
    // you down (createEnemy.js's det.detectRange poll, same as the standing
    // wolves; no roar clip, so it just comes)
    detectRange: 20,
    // and hunts as a pack: once one of them is after you, every other stray
    // wolf within this far of it joins in (createEnemy.js, same poll)
    packRange: 25,
    modelStyle: "wolf",
    elementType: "none",
    weakness: "fire",
    stats: {
        dmg: 36,
        magDmg: 1,
        spd: 9,
        atkSpd: 4,
        accuracy: 1.4,
        critical: 1.6,
    },
    lvl: 22,
    hp: 5200,
    maxHp: 5200,
    expToGain: 1100,
    // the hp bar clears its ears (head top ~1.55 when it stands up)
    bodyHeight: 1.6,
    bodyWidenes: 1.0,
    effects: [],
    effectsWhenHit: [],
    titles: ['wolf'],
    aptitude: [],
    skills: [] as string[],
    canDodge: true,
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
    _disabled: false, // skill.enemyBind - see index.ts's enemyBind handler
    _cursed: false, // dark magic's curse - see index.ts's enemyCurse handler
    weaponBlocking: false,
    magicBlocking: false,
    IsInVulnerable: false,
    // required - createEnemy.js's death handler reads loots.length unguarded
    loots: [simpleCoreLoot],
    respawnDetails: {
        willRespawn: true,
        respawnTime: 60 * 1000,
    },
}

// standing wolves - modelStyle "standingwolf" (models/monsters/standingwolf.glb),
// four named werewolves on ONE rig: each one's `name` picks its skin
// (images/textures/enemy/standingwolf/<name>.jpg, createMonsterMaterial's
// convention), and its element and loot follow that skin. The village's
// elites, in rising order: Vargoth (plain brown - the brawler, pounces),
// Zareth (crimson, ember-veined - fire), Morvane (black-marked - dark) and
// Skallgrim (frost-white - the strongest).
//
// NOTE the glb only has an idle1 clip so far - no running1/attack1/hit/death.
// createEnemy.js/renderer.js skip missing clips quietly, so until those are
// added a standing wolf glides after you in its idle pose and vanishes on
// death without a death animation. Add the clips under those names and they
// play with no code change.
//
// Their claws make you bleed - client's characterstate.js tickBleed: 2% of
// max hp every second, lethal, until a cure lifts it (Purification, the
// healing circle, Vesper). Every wolf below keeps it, including the ones with
// their own effects list. Costs all 0 - the drain is the tick, not the hit.
const bleedEffect = { effectType: 'bleed', chance: 25, permanent: true, dn: 'Bleeding', spcost: 0, hpcost: 0, mpcost: 0, hungercost: 0, energycost: 0 }
const standingWolfBase = {
    hitmarks: [
        {
            attackType: "normal",
            animationName: "attack2",
            hitmarkTexture: "claw.webp"
        }
    ],
    maxDistance: 1.3,
    // sight - notices a player this far off, any direction (createEnemy.js's
    // det.detectRange poll), roars at them (its roar1 clip) and comes for
    // them. Most other enemies only notice you once you bump into it or hit it
    // (the stray wolves have sight too).
    detectRange: 24,
    modelStyle: "standingwolf",
    elementType: "none",
    weakness: "light",
    stats: {
        dmg: 45,
        magDmg: 2,
        // faster than the stray wolf (9) - the bigger hunter - but still
        // under the player's sprint (inputMovement.js's sprintSpeed 10), so
        // a sprinting player can still pull away, slowly
        spd: 9.6,
        atkSpd: 3,
        accuracy: 1.4,
        critical: 1.6,
    },
    lvl: 18,
    hp: 7000,
    maxHp: 7000,
    expToGain: 1400,
    // ~2.9 tall in its crouch, about twice the player - 3.0 keeps the hp bar
    // just over its ears
    bodyHeight: 3.0,
    bodyWidenes: 1.6,
    effects: [bleedEffect] as any[],
    effectsWhenHit: [] as any[],
    titles: ['werewolf'],
    // every attack is these clips back to back, its damage split across the
    // swings (client's worldsocket.js "enemy-attacked"). 1.33s each - the
    // pair just fits atkSpd 3's 2.7s between attacks (createEnemy.js); a
    // quicker atkSpd (skallgrim's 2.6) plays them a little faster to fit
    attackCombo: ["attack1", "attack2"],
    aptitude: [] as string[],
    // claws and the pounce only, no spells - blinkstrike: a telegraphed
    // leap to you and one boosted swipe (skillEffects.js's
    // triggerEnemyBlinkstrike). Every standing wolf but Zareth has it.
    skills: ['blinkstrike'] as string[],
    canDodge: true,
    blessings: [],
    status: [],
    regens: { sp: 1, hp: 1, mana: 1 },
    monsSoul: 3,
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
    loots: [mediumCoreLoot, beastMeatLoot],
    respawnDetails: {
        willRespawn: true,
        respawnTime: 60 * 1000,
    },
}

// the brawler
const vargoth = {
    ...standingWolfBase,
    name: "vargoth",
    dn: "Vargoth",
    weakness: "lightning",
}

// ember-veined - claws that burn, drops a fire core
const zareth = {
    ...standingWolfBase,
    name: "zareth",
    dn: "Zareth",
    elementType: "fire",
    weakness: "water",
    aptitude: ['fire'],
    // no pounce - the one wolf that never had it; his claws burn instead
    skills: [] as string[],
    stats: { ...standingWolfBase.stats, dmg: 50, magDmg: 3 },
    lvl: 22,
    hp: 8500,
    maxHp: 8500,
    expToGain: 1800,
    effects: [
        // characterstate.js's startBurnDamage - dmgPm off your hp each tick for duration ms
        { effectType: 'burn', chance: 15, permanent: false, dn: 'Scorched', dmgPm: 20, duration: 4000, soundPlayPerDmg: 'dmgpm' },
        bleedEffect,
    ],
    loots: [mediumCoreLoot, fireslimeCoreLoot, beastMeatLoot],
}

// black-marked - claws that drain you
const morvane = {
    ...standingWolfBase,
    name: "morvane",
    dn: "Morvane",
    elementType: "dark",
    weakness: "light",
    aptitude: ['dark'],
    stats: { ...standingWolfBase.stats, dmg: 48, magDmg: 3, spd: 9.8 },
    lvl: 25,
    hp: 9500,
    maxHp: 9500,
    expToGain: 2100,
    effects: [
        { effectType: 'spdrain', chance: 15, permanent: false, dn: 'SP Drained', spcost: 30, hpcost: 0, mpcost: 0, hungercost: 4, energycost: 0 },
        bleedEffect,
    ],
    loots: [mediumCoreLoot, darkslimeCoreLoot, beastMeatLoot],
}

// frost-white - the pack's strongest: the heaviest blows; drops an icy
// celestine shard like the frost scorpion
const skallgrim = {
    ...standingWolfBase,
    name: "skallgrim",
    dn: "Skallgrim",
    elementType: "water",
    weakness: "fire",
    aptitude: ['water'],
    stats: { ...standingWolfBase.stats, dmg: 60, magDmg: 3, atkSpd: 2.6 },
    lvl: 28,
    hp: 11000,
    maxHp: 11000,
    expToGain: 2600,
    loots: [mediumCoreLoot, celestineOreLoot, beastMeatLoot],
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
        // "square" (generateGhosts, below - scatter anywhere through the
        // whole fenced graveyard plot rather than hugging its border the
        // way "village" does) and any other/unrecognized areaType: spread
        // anywhere within the square area centered on (centerX, centerZ).
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

        // openworld castles (castles.ts) - a spot in or beside one is rolled
        // again. The margin is more than index.ts's WANDER_RADIUS (8), which is
        // all an enemy ever strays from its spawn on its own, so wandering
        // never walks one into a castle wall either. "fixed" spawns are
        // placed on purpose and left alone.
        for (let tries = 0; placeId === 888 && areaType !== "fixed" && isNearCastle(x, z, CASTLE_SPAWN_MARGIN) && tries < 20; tries++) {
            const again = scatterPosition(areaType, half, minRadius, maxRadius)
            x = again.x + centerX
            z = again.z + centerZ
        }

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

// the openworld's deer band (enemyDetails.ts's OPENWORLD_ENEMY_BANDS) - each
// one spawned is any of the six deer, rolled per deer, so a herd out there is
// a mix of every coat
const DEER_VARIANTS = [forestDeer, jasferDeer, luminaDeer, nightmareDeer, scorchDeer, wisfDeer]
export function generateWildDeer(total = 10, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return Array.from({ length: total }, () => {
        const variant = DEER_VARIANTS[Math.floor(Math.random() * DEER_VARIANTS.length)]
        return generateEnemies(variant, 1, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)[0]
    })
}

export function generateLesserDemons(total = 1, placeId = 1, areaSize = 300, areaType = "fixed", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(lesserDemonBase, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

// areaType defaults to "square" (not "village"/"ring"/"fixed" like every
// generator above) - a graveyard is a small fenced square, not a radial
// territory or a border band, so its own enemy should scatter through the
// whole plot instead. Call with the graveyard's own position/areaSize
// (localroomdb.js's graveYards entries, creations/creategraveyard.js's own
// same areaSize convention) as centerX/centerZ/areaSize.
export function generateGhosts(total = 5, placeId = 1, areaSize = 10, areaType = "square", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(ghostBase, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateStrayWolves(total = 5, placeId = 1, areaSize = 300, areaType = "village", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(strayWolfBase, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

// one of the four standing wolves by name ("vargoth", "zareth", "morvane",
// "skallgrim") - each is a single named elite, so total defaults to 1 and
// areaType to "fixed" (exactly at centerX, centerZ)
const STANDING_WOLVES = { vargoth, zareth, morvane, skallgrim }
export function generateStandingWolf(name: keyof typeof STANDING_WOLVES, total = 1, placeId = 1, areaSize = 300, areaType = "fixed", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(STANDING_WOLVES[name], total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}

export function generateIceScorpions(total = 1, placeId = 1, areaSize = 10, areaType = "square", centerX = 0, centerZ = 0, minRadius = 0, maxRadius = 0) {
    return generateEnemies(iceScorpionBase, total, placeId, areaSize, areaType, centerX, centerZ, minRadius, maxRadius)
}
