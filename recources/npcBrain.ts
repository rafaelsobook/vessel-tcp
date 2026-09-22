import { Vehicle, ArriveBehavior, ObstacleAvoidanceBehavior, GameEntity, Vector3 as YukaVector3 } from "yuka"

// Attitude shape mirrors client/src/staticRecources/npcDetails.js's own
// per-npcFighter `attitude` field ({weapon, dodging, blocking,
// standbycasting, distancing, continuescast}, each 0-1) - same concept,
// reused here so a bot's personality is expressed the exact same way a
// hand-authored duel opponent's already is, instead of inventing a second
// parallel "how aggressive is this NPC" vocabulary. combat-only fields
// (weapon/dodging/blocking/continuescast) ride along and are exposed on
// the Brain for when attacking gets implemented later, but only
// standbycasting/distancing actually influence anything in this
// movement-only phase - see think()'s own comment on why.
export type Attitude = {
    weapon: number
    dodging: number
    blocking: number
    standbycasting: number
    distancing: number
    continuescast: number
}

// Four starting personality presets - not exhaustive, just enough variety
// that a handful of bots spawned back to back don't all move identically.
// "warrior" paces around like it's on patrol (fighting mode, sprint pace,
// doesn't sit still), "caster" mostly holds position and only occasionally
// repositions (standbycasting-heavy), "adventurer" wanders the widest and
// most often (distancing-heavy). Same {weapon, dodging, blocking,
// standbycasting, distancing, continuescast} shape real npcFighters
// already use, so the exact same preset objects will still make sense
// once attacking reads dodging/blocking/continuescast too.
// "lazy" - tcp/index.ts's own goal/currentMood system reads the PRESET
// NAME a bot was given (not derived from these numbers) to decide if it's
// the resting type - these values just keep it low-effort across the
// board for whatever combat it does still do in between rests, not the
// thing that actually drives the resting behavior itself.
export const ATTITUDE_PRESETS: Record<string, Attitude> = {
    warrior:    { weapon: 1,   dodging: 0.3, blocking: 0.6, standbycasting: 0,   distancing: 0.2, continuescast: 0 },
    caster:     { weapon: 0,   dodging: 0.5, blocking: 0.2, standbycasting: 1,   distancing: 0.3, continuescast: 0.8 },
    adventurer: { weapon: 0.3, dodging: 0.4, blocking: 0.3, standbycasting: 0.2, distancing: 0.8, continuescast: 0.2 },
    lazy:       { weapon: 0.1, dodging: 0.1, blocking: 0.1, standbycasting: 0.1, distancing: 0.1, continuescast: 0.1 },
}

// real player pacing (client/src/controllers/inputMovement.js's own
// walkSpeed:1/sprintSpeed:20) as the starting point - a bot moving at
// WALK_SPEED covers ground at the same rate a real player's own idle-walk
// does. SPRINT_SPEED is deliberately NOT the real 20 though - a bot
// actually sprinting at real player speed read as too fast/frantic, cut
// 80% off the real value (20 * 0.2 = 4) on request. Must match
// client/src/sockets/renderer.js's own BOT_SPRINT_SPEED exactly - that's
// what actually steps a bot's position each frame, this is only what the
// server's own internal simulation (arrival timing, combat range/cooldown
// pacing) assumes it's moving at; if the two drift apart, the server's own
// "have I arrived yet"/combat-engagement timing would stop matching what's
// rendered.
const WALK_SPEED = 1
const SPRINT_SPEED = 4

// how often the brain re-decides what to do next ("outputs 0 to 1" - see
// think() below) - randomized per-decision, not fixed, so a room full of
// bots doesn't visibly re-decide in lockstep
const DECISION_MIN_MS = 4000
const DECISION_MAX_MS = 9000
// how often a MOVING bot's position actually gets stepped and broadcast -
// real players emit at up to ~20Hz while moving (inputMovement.js's own
// >50ms throttle on emitMove) - 120ms is a deliberately coarser cadence
// than that ceiling (a real player's own OWN throttle, not a hard
// requirement), trading a little smoothness for not running this loop 8x
// more than necessary per bot once several are on scene at once
const MOVE_TICK_MS = 120
// max distance covered by a SINGLE wander hop (scaled down per-bot by
// distancing in pickWanderTarget - not a hard fence on that hop, just its
// own roll range). Each hop now originates from wherever the bot CURRENTLY
// is, not a fixed point - see pickWanderTarget's own header comment for
// why that changed.
const WANDER_RADIUS = 40
// each hop must cover at least this fraction of its own rolled distance -
// a plain `Math.random() * radius` (the old behavior) is uniform from 0,
// so on average half of all hops were short micro-steps. Combined with
// every hop being independently re-rolled around a single FIXED anchor for
// the bot's entire lifetime (also fixed below), that's what produced the
// "runs 4 steps, stops, runs 4 steps some other direction, forever near
// the same spot" look - confirmed from an actual report, not a guess.
const WANDER_MIN_DIST_FRACTION = 0.5
// hard leash - each hop originates from the bot's current position now
// (so consecutive hops actually go somewhere, compounding outward instead
// of resetting), but is pulled back toward homeAnchor (the TRUE, never-
// updated spawn point) if it would land further than this - keeps a bot
// from wandering off indefinitely over many compounding hops
const MAX_HOME_DRIFT = 50
// "close enough, stop and pick a new decision on the next think() tick"
const ARRIVE_RADIUS = 1.5

// client/src/charactersystem/createcharacter.js's own capsuleHeight (1.5) -
// a non-physics character rig's body.position.y (what every "emitted-*"
// handler snaps a WATCHED player's mesh straight to, no correction of its
// own) is the CAPSULE'S OWN CENTER, not its feet - same relationship that
// file's own physics capsule creation uses (spawnPos.y + capsuleHeight/2)
// and putFakeShadow's own ground offset confirms in reverse
// (-capsuleHeight/2 + 0.02 back down to actual ground). A real player's
// broadcast pos.y already reflects this correctly (it's their own real,
// physics-settled body.position), so it never looks wrong - a bot has no
// physics of its own to settle with, so it has to add this offset itself
// or it renders sunk into the ground up to about the waist (confirmed from
// an actual screenshot: bots showed only their upper half above the
// floor). reCreateMeshesInScene's own hardcoded y:0.01 for a brand-new
// OTHER player's first-ever spawn is NOT this value and is very much
// visibly wrong too - it's just invisible in practice for a real player
// because their own very next movement packet (already carrying their
// real, correct pos.y) overwrites it within moments. A bot broadcasting
// the same 0.01 on every subsequent update never gets that self-correction.
const CAPSULE_HEIGHT = 1.5
export const RESTING_Y = CAPSULE_HEIGHT / 2

// COMBAT + HUNTING - one unified system, not two. checkCombat() below is
// the ONLY thing that ever moves a bot toward an enemy: the moment any
// enemy exists anywhere in the bot's own place (combat.getNearestEnemy has
// no distance cap at all), it locks on and re-aims the SAME arrive
// steering wandering uses at that enemy's own live position, every single
// COMBAT_CHECK_MS tick, uninterrupted, until it's actually in range. This
// used to be split into two layers - a short-range "engage" check here
// plus a separate cone-randomized bias nudging wander's own hop angle
// toward a far-off enemy - and that produced exactly the "stop dead, sit
// idle a few seconds, then walk off in a noticeably different direction"
// look reported as looking erratic/inconsistent ("pressing w-a-s-d
// randomly"): each wander hop re-rolled a fresh +-45 degree angle around
// the bearing to the enemy AND fully halted between hops waiting on
// think()'s own 4-9s decision cycle. Collapsing both into this one
// always-on, never-interrupted chase (think() already yields control
// entirely to checkCombat whenever combatTargetId is set - see think()'s
// own guard) is what "if they hunt then they hunt, they just run/walk
// continuously to that location" actually requires - simple, one
// continuous trip, arrive, fight, done.
// weapon-heavy ("warrior") bots have to actually close to melee range;
// everyone else (caster-leaning attitudes) can start attacking from
// further out without walking all the way up - same split
// pickWanderTarget's own isPurposeful check already uses for pacing
const MELEE_RANGE = 2.5
const CAST_RANGE = 10
// how often combat state (target selection, in-range check, attack
// cooldown) gets re-evaluated - independent of, and much slower than,
// MOVE_TICK_MS's own per-frame position stepping
const COMBAT_CHECK_MS = 1000
const MELEE_COOLDOWN_MS = 1800
const CAST_COOLDOWN_MS = 3200
// KITING - caster-only (see notifyDamaged below): once hit, a caster spends
// RETREAT_DURATION_MS backing straight away from its current target instead
// of holding position and trading hits like it normally would, then falls
// back into checkCombat's own usual close/hold logic on its own once that
// window passes - no separate re-engage step needed, the very next tick
// just evaluates dist-vs-range fresh like nothing happened. RETREAT_DISTANCE
// is how far out the arrive-steering target is placed (same steering system
// the chase-in branch already uses, just aimed the opposite direction) -
// not a hard stop-at-exactly-this-range, just far enough to clear CAST_RANGE
// a caster would otherwise immediately re-enter and start attacking from a
// standstill again the very next check.
const RETREAT_DISTANCE = 6
const RETREAT_DURATION_MS = 2500
// SERVANTS - how close a following bot tries to stay to its owner (close
// enough to read as "with them", not so close it's constantly jostling for
// the exact same spot the owner's standing on). checkCombat's own
// moveArriveRadius reuses this directly while chasing in, same as the
// combat branches reuse MELEE_RANGE/CAST_RANGE for the identical purpose.
const FOLLOW_STOP_DISTANCE = 3
// hysteresis on top of FOLLOW_STOP_DISTANCE (same reasoning renderer.js's
// own OPENWORLD_ENEMY_SHOW_DIST/HIDE_DIST split already uses) - a single
// shared threshold for BOTH "start chasing" and "stop chasing" flickers
// between the two every single checkCombat tick whenever dist happens to
// settle right at that exact boundary (yuka's own arrive steering doesn't
// stop EXACTLY on the radius, it decelerates to somewhere close to it) -
// confirmed from an actual report ("faces me, then just starts running").
// Deliberately bigger than FOLLOW_STOP_DISTANCE so there's real separation
// between the two triggers, not just a hairline gap.
const FOLLOW_RESUME_DISTANCE = 5
// flat damage numbers, not a real weapon/magic stat formula - bots have no
// equipped gear yet (spawnBot's own items:[]), so there's no real
// calcDmg-style input to derive this from. Cast hits harder to compensate
// for its slower cooldown/no-need-to-close-distance advantage.
const MELEE_DMG = 18
const CAST_DMG = 32

// approachX/approachZ (optional) - a per-bot-unique point NEAR the enemy
// (not its exact center) to walk toward WHILE still closing the distance,
// so several bots targeting the SAME enemy spread into a rough ring around
// it instead of all beelining for the identical coordinate and visually
// stacking into one merged mesh (confirmed from an actual screenshot -
// same class of problem duelSystem.js/renderer.js's own enemy-separation
// pass already solved for multiple ENEMIES converging on one player, just
// the reverse direction here). index.ts's own getNearestEnemy is what
// actually computes these (it has the cross-bot visibility this file
// deliberately doesn't) - checkCombat below just uses them if present,
// falling back to the enemy's own x/z if not.
export type EnemyLike = { _id: string, x: number, z: number, hp: number, approachX?: number, approachZ?: number }
export type DealDamageCallback = (targetId: string, dmgDetails: { physicalDmg: number, weaponDmg: number }) => void
// SERVANTS - index.ts's own recruit-bot/dismiss-bot handlers call
// setFollowOwner() below, which is the only thing that ever reads this.
// Reuses whatever live position that owner's OWN emitmove/emitStop
// handlers already keep fresh in `players` - null if that owner isn't
// even connected right now (see followOwner()'s own null-handling)
export type GetOwnerPos = (ownerId: string) => { x: number, z: number } | null
// closest enemy ANYWHERE in the bot's own place, no distance cap at all -
// null if that place currently has none. The single source of truth for
// both target ACQUISITION (checkCombat locks onto whatever this returns
// once nothing is currently locked) and, every tick after, that target's
// own live position while chasing/fighting it.
export type GetNearestEnemy = (x: number, z: number) => EnemyLike | null
export type CombatContext = {
    getNearestEnemy: GetNearestEnemy
    dealDamage: DealDamageCallback
    getOwnerPos: GetOwnerPos
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
// +-0.15 randomness on each utility score - keeps two bots with the
// identical attitude preset from making the identical decision at the
// identical moment every time
const jitter = () => (Math.random() - 0.5) * 0.3

// dirYaw (radians, Y-axis only) - NOT a dirTarg point. A point-based
// facing target only works when whoever applies it (client's own
// body.lookAt) is standing at the SAME position this was computed
// relative to - true for a real player (client/index.ts's own
// "emitted-moving"/"stopped" SNAP that client's body.position directly
// from the server's own reported pos, so there's never a mismatch), but
// NOT true for a bot: renderer.js's own per-frame bot-stepping is a
// simple constant-speed locallyTranslate, completely independent of this
// Brain's own richer yuka steering/deceleration/obstacle-avoidance
// simulation, so a bot's CLIENT-rendered position drifts from what THIS
// class believes it is. lookAt(dirTargPoint) computed from the client's
// own (drifted) position produces a badly wrong angle - confirmed via
// live matching server/client console logs (client's own
// bodyPos-to-dirTarg direction matched its rendered facing exactly, but
// diverged sharply from the direction this class itself would have
// computed using ITS OWN position, by however far the two had drifted
// apart - worse the closer the target, since CAST_RANGE is only 10 units).
// A pure angle sidesteps this entirely: index.ts's own onMove callback
// sends it straight through, and worldsocket.js applies it directly via
// Quaternion.RotationAxis(Vector3.Up(), dirYaw) - no position of any
// kind involved in reconstructing the rotation, so client-side drift
// can't corrupt it.
export type BotMoveCallback = (
    pos: { x: number, y: number, z: number },
    dirYaw: number,
    mode: string,
    moving: boolean,
) => void

// One bot's own decision-making + movement-simulation loop. Doesn't know
// anything about sockets, the `players` array, or io.emit - it only ever
// calls the onMove callback it was constructed with, so index.ts owns the
// entire "how does this become a real Tplayers update the client sees"
// half, and this file stays a pure, independently-testable brain.
//
// Movement itself is yuka's own Vehicle + ArriveBehavior (steering-based
// seek-and-decelerate, not a hand-rolled straight-line lerp) - see this
// project's own npm dependency add for why yuka specifically (a
// dependency-free JS game-AI library with exactly the steering-behavior
// piece this needed, nothing else pulled in). The actual STOP decision
// is still made explicitly here (real remaining distance to the current
// target, checked every tick), not inferred from yuka's own velocity
// dropping near zero - that can happen transiently for other reasons
// (force-limited acceleration, briefly against a decel curve) and isn't a
// reliable "did we actually arrive" signal on its own.
export class Brain {
    attitude: Attitude
    // TRUE, never-updated spawn point - only ever used as the leash center
    // in pickWanderTarget below, NOT as where each hop originates from
    // anymore (see that function's own header comment)
    private homeAnchor: { x: number, z: number }
    private vehicle: Vehicle
    private arrive: ArriveBehavior
    private obstacleAvoidance: ObstacleAvoidanceBehavior
    private target: { x: number, z: number } | null = null
    private moving = false
    private mode = "idle"
    // how close counts as "arrived" for tickMove()'s own check below -
    // ARRIVE_RADIUS while wandering, the live attack range while
    // approaching an enemy (see checkCombat()) - a caster shouldn't have
    // to walk all the way down to melee's own tight radius before it's
    // allowed to stop and start casting
    private moveArriveRadius = ARRIVE_RADIUS
    private onMove: BotMoveCallback
    private combat: CombatContext
    // real players get gated off dashstrikeSkill's own requiresWeapon flag
    // (skillsui.js's click handler, "equip a weapon to use this") before
    // they're ever allowed to fire it - isMeleeStyle() below enforces that
    // exact same rule for a bot, rather than just trusting attitude.weapon
    // alone. Every bot happens to always have one today (spawnBot's own
    // buildBotItems() call is unconditional), so this can't actually go
    // false right now - it's here so that stays a real, enforced rule
    // instead of an assumption a future change (a disarm mechanic, an
    // attitude-based loadout) could silently break.
    private hasWeapon: boolean
    private combatTargetId: string | null = null
    private lastAttackAt = 0
    // set by notifyDamaged() below, read by checkCombat() - a timestamp
    // rather than a plain boolean so checkCombat can just compare against
    // Date.now() each tick with no separate timer/timeout of its own to
    // manage or clean up
    private retreatUntil = 0
    // set by setFollowOwner() below, read by checkCombat() (which checks
    // this FIRST, ahead of everything else) and think() (which skips
    // rolling a fresh wander/hold decision entirely while this is set,
    // same reasoning it already skips one while combatTargetId is set)
    private followOwnerId: string | null = null
    // hysteresis state for followOwner() below (FOLLOW_STOP_DISTANCE/
    // FOLLOW_RESUME_DISTANCE's own comment has the full "why") - which of
    // the two thresholds actually applies next depends on which side of
    // the gap this bot was already on, not just its current raw distance
    private followingOwner = false
    private decisionTimer: ReturnType<typeof setTimeout> | null = null
    private moveTimer: ReturnType<typeof setInterval> | null = null
    private combatTimer: ReturnType<typeof setInterval> | null = null
    private lastTickAt = Date.now()
    // tcp/index.ts's own goal/currentMood system (a "lazy" bot resting) -
    // this class has no idea what "resting" even means (that's index.ts's
    // own concept, driven by botPlayer.currentMood, not anything Brain
    // tracks), it just knows how to fully stop and later pick back up
    // exactly where a fresh bot would: no memory of the interrupted wander/
    // hunt is kept, resume() just starts making fresh decisions again the
    // same way the constructor's own first scheduleThink() call does.
    private paused = false

    constructor(attitude: Attitude, spawnPos: { x: number, z: number }, onMove: BotMoveCallback, combat: CombatContext, hasWeapon: boolean){
        this.attitude = attitude
        this.homeAnchor = { ...spawnPos }
        this.onMove = onMove
        this.combat = combat
        this.hasWeapon = hasWeapon

        this.vehicle = new Vehicle()
        this.vehicle.position.set(spawnPos.x, 0, spawnPos.z)
        this.vehicle.updateOrientation = false // facing is derived from velocity ourselves below (dirTarg), matching how a real player's own dirTarg is computed (pos + facing), not yuka's own quaternion
        // rough human-scale radius (client's own capsuleRadius is 0.25,
        // this is deliberately a bit more generous) - ObstacleAvoidanceBehavior
        // below needs the vehicle's OWN size to know how much clearance to
        // actually steer for, not just the obstacles'
        this.vehicle.boundingRadius = 0.5

        this.arrive = new ArriveBehavior(new YukaVector3(spawnPos.x, 0, spawnPos.z), 3, 0.5)
        this.arrive.active = false
        this.vehicle.steering.add(this.arrive)

        // starts empty - populated whenever index.ts relays a fresh
        // sockets/botSensor.js report for this bot's own place (see
        // updateObstacles below). Coexists with `arrive` above just fine -
        // yuka's own SteeringManager sums every active behavior's force
        // together each update, avoidance just adds a deflection on top of
        // arrive's own pull toward the current target instead of replacing it
        this.obstacleAvoidance = new ObstacleAvoidanceBehavior([])
        this.vehicle.steering.add(this.obstacleAvoidance)

        this.scheduleThink()
        this.moveTimer = setInterval(() => this.tickMove(), MOVE_TICK_MS)
        this.combatTimer = setInterval(() => this.checkCombat(), COMBAT_CHECK_MS)
    }

    // called by index.ts whenever a fresh obstacle report lands for this
    // bot's own currentPlace (tcp/index.ts's obstaclesByPlace) - replaces
    // the whole set each time rather than merging, same reasoning that
    // store's own comment gives (a report is already a full fresh snapshot)
    updateObstacles(obstacles: { x: number, z: number, radius: number }[]){
        this.obstacleAvoidance.obstacles.length = 0
        for(const o of obstacles){
            const entity = new GameEntity()
            entity.position.set(o.x, 0, o.z)
            entity.boundingRadius = o.radius
            this.obstacleAvoidance.obstacles.push(entity)
        }
    }

    // weapon-heavy attitude fights up close, everyone else prefers range -
    // same threshold pickWanderTarget's own isPurposeful check already uses.
    // Gated on hasWeapon too (see that field's own comment) - a
    // weapon-attituded bot that somehow ended up with none falls back to
    // fighting at CAST_RANGE instead of trying to dashstrike bare-handed,
    // same as a real player would just be refused the click entirely.
    private isMeleeStyle(){
        return this.attitude.weapon > 0.5 && this.hasWeapon
    }

    // re-evaluated every COMBAT_CHECK_MS, independent of think()'s own
    // wander decisions (which skip themselves entirely while
    // combatTargetId is set - see think()'s own guard). getNearestEnemy has
    // NO distance cap, so this single lookup IS the bot's hunting behavior:
    // the instant any enemy exists anywhere in its place, it locks on and
    // keeps re-aiming at that same lookup's result every tick (whatever's
    // currently closest) until the place has none left at all.
    private checkCombat(){
        const p = this.vehicle.position

        // SERVANTS - takes over movement/target entirely while serving an
        // owner, ahead of even LOOKING for an enemy - a recruited bot is a
        // companion first, not expected to wander off mid-escort to go
        // pick a fight (see followOwner()'s own comment for the full
        // "why exclusively this, nothing else" reasoning)
        if(this.followOwnerId){
            this.followOwner(p)
            return
        }

        const target = this.combat.getNearestEnemy(p.x, p.z)

        if(!target){
            if(this.combatTargetId){
                // hunt just ended - nothing left anywhere in this place to
                // chase. Force back to idle directly rather than routing
                // through stop() (which no-ops if this bot was already
                // holding still in attack range, leaving it visually stuck
                // in "fighting" mode/pose with nothing left to fight)
                this.combatTargetId = null
                this.moving = false
                this.arrive.active = false
                this.vehicle.velocity.set(0, 0, 0)
                this.mode = "idle"
                // arbitrary "face world +Z" placeholder, same as stop()'s
                // own identical fallback - there's no meaningful facing
                // left to report once the hunt is over, this just avoids
                // sending a stale/undefined angle
                this.onMove({ x: p.x, y: RESTING_Y, z: p.z }, 0, this.mode, false)
            }
            return
        }
        this.combatTargetId = target._id

        const dx = target.x - p.x
        const dz = target.z - p.z
        const dist = Math.hypot(dx, dz)
        const range = this.isMeleeStyle() ? MELEE_RANGE : CAST_RANGE

        // KITING - notifyDamaged() set this on a recent hit (caster-only,
        // see its own comment) - takes priority over both the chase-in and
        // hold-and-attack branches below for RETREAT_DURATION_MS, same
        // arrive-steering fields the chase-in branch uses just aimed
        // straight away from the target instead of toward it. Falls
        // through to the normal dist-vs-range logic on its own the instant
        // Date.now() clears retreatUntil - no explicit "re-engage" step,
        // the very next tick just evaluates fresh like nothing happened.
        if(Date.now() < this.retreatUntil){
            // dist > 0.01 guard mirrors this function's own facing
            // fallback further down - an attacker standing exactly on top
            // of this bot has no real direction to flee FROM, so this
            // just picks a fixed arbitrary heading instead of dividing by
            // zero into a NaN target
            const awayX = p.x + (dist > 0.01 ? -dx / dist : 0) * RETREAT_DISTANCE
            const awayZ = p.z + (dist > 0.01 ? -dz / dist : 1) * RETREAT_DISTANCE
            this.mode = "fighting"
            this.target = { x: awayX, z: awayZ }
            this.moveArriveRadius = ARRIVE_RADIUS
            this.arrive.target.set(awayX, 0, awayZ)
            this.arrive.active = true
            this.vehicle.maxSpeed = SPRINT_SPEED
            this.moving = true
            return
        }

        if(dist > range){
            // close the distance - re-aims the SAME arrive steering
            // wandering uses at the enemy's own latest known position,
            // re-checked (and re-aimed) every tick since it can move
            // between checks. Mode stays "fighting" (not "casting") for
            // BOTH styles while actually moving - renderer.js's own bot
            // stepping reads mode==="fighting" to pick BOT_SPRINT_SPEED,
            // matching the SPRINT_SPEED this same branch sets server-side;
            // a caster-style bot chasing at "casting"+walk speed would
            // desync from what the server's own arrival timing assumes.
            // approachX/approachZ (index.ts's own getNearestEnemy) - a point
            // NEAR the enemy, not its exact center, so several bots sharing
            // this same target spread into a ring instead of all beelining
            // for the identical coordinate. Falls back to the enemy's own
            // x/z if absent (e.g. a future caller that doesn't compute
            // one) - moveArriveRadius only tightens to ARRIVE_RADIUS when
            // there's an actual approach point to arrive AT precisely;
            // walking straight at the enemy's raw center still wants the
            // old range-wide tolerance (stop as soon as within attack range,
            // don't walk needlessly closer).
            const hasApproachPoint = target.approachX !== undefined && target.approachZ !== undefined
            const approachX = target.approachX ?? target.x
            const approachZ = target.approachZ ?? target.z
            this.mode = "fighting"
            this.target = { x: approachX, z: approachZ }
            this.moveArriveRadius = hasApproachPoint ? ARRIVE_RADIUS : range
            this.arrive.target.set(approachX, 0, approachZ)
            this.arrive.active = true
            this.vehicle.maxSpeed = SPRINT_SPEED
            this.moving = true
            return
        }

        // in range - hold position, but keep FACING the target's own live
        // position every single check tick (not just when an attack
        // actually fires below) - an enemy can keep moving/repositioning
        // while the bot is holding still on cooldown, and this is what
        // actually keeps it turning to track that instead of freezing
        // toward wherever the target was the last time it swung. Same
        // dirTarg-must-match-pos.y reasoning stop()'s own comment gives
        // (worldsocket.js's "stopped" handler uses dirTarg verbatim).
        //
        // mode splits by style HERE (not moving) is what actually makes a
        // caster-attitude bot visibly do something instead of just
        // standing there while damage silently lands on cooldown - "casting"
        // is a real, continuously-looping mode client/src/sockets/
        // renderer.js already renders (ANIM_STATE.CASTING) for any player
        // whose mode is "casting" and isn't moving, same mechanism a real
        // player's own spellcast idle pose already uses. Melee bots keep
        // "fighting" (COMBAT_IDLE) and additionally get a one-shot swing
        // per swing via index.ts's own dealDamage callback below - a caster
        // doesn't need that on top, the continuous cast loop already reads
        // as "doing something" every tick, not just at the cooldown instant.
        this.mode = this.isMeleeStyle() ? "fighting" : "casting"
        this.moving = false
        this.arrive.active = false
        this.vehicle.velocity.set(0, 0, 0)

        const facing = dist > 0.01 ? { x: dx / dist, z: dz / dist } : { x: 0, z: 1 }
        // same atan2(x,z) yaw convention client/src/charactersystem/
        // createcharacter.js's own creation-time facing already uses
        // (Math.atan2(dx, dz)) - matching it here isn't load-bearing on
        // its own (any consistent convention would round-trip fine as
        // long as both ends agree), just avoids inventing a second one
        const dirYaw = Math.atan2(facing.x, facing.z)
        this.onMove(
            { x: p.x, y: RESTING_Y, z: p.z },
            dirYaw,
            this.mode,
            false,
        )

        // the actual swing/cast still only fires on its own cooldown -
        // facing above refreshes independently of this, every tick
        const cooldown = this.isMeleeStyle() ? MELEE_COOLDOWN_MS : CAST_COOLDOWN_MS
        const now = Date.now()
        if(now - this.lastAttackAt < cooldown) return
        this.lastAttackAt = now

        const dmg = this.isMeleeStyle() ? MELEE_DMG : CAST_DMG
        this.combat.dealDamage(target._id, { physicalDmg: dmg, weaponDmg: 0 })
    }

    // SERVANTS - checkCombat's own followOwnerId branch delegates here
    // instead of ever reaching getNearestEnemy()/the hunting logic at all.
    // Deliberately exclusive, not "follow AND still fight anything nearby" -
    // a v1 escort-only companion, same scope as what was actually asked
    // for ("the bot can follow me"); layering in "also fights for you while
    // following" is a real separate feature on top of this, not something
    // this pass tries to guess at.
    private followOwner(p: YukaVector3){
        const ownerPos = this.combat.getOwnerPos(this.followOwnerId!)
        if(!ownerPos){
            // owner disconnected (or never actually connected - shouldn't
            // happen, but this is the same safe fallback either way) -
            // nothing to walk toward, just hold still exactly like
            // checkCombat's own "hunt just ended" branch does rather than
            // leaving stale arrive/velocity state active
            if(this.moving){
                this.moving = false
                this.arrive.active = false
                this.vehicle.velocity.set(0, 0, 0)
                this.mode = "idle"
                this.onMove({ x: p.x, y: RESTING_Y, z: p.z }, 0, this.mode, false)
            }
            return
        }

        const dx = ownerPos.x - p.x
        const dz = ownerPos.z - p.z
        const dist = Math.hypot(dx, dz)

        // hysteresis - see FOLLOW_RESUME_DISTANCE's own comment. Only
        // flips state at the FAR edge (resume chasing) or the NEAR edge
        // (stop chasing) - anywhere in between just continues whatever it
        // was already doing, instead of a single boundary both edges share
        if(this.followingOwner){
            if(dist <= FOLLOW_STOP_DISTANCE) this.followingOwner = false
        } else {
            if(dist > FOLLOW_RESUME_DISTANCE) this.followingOwner = true
        }

        if(this.followingOwner){
            // same arrive-steering shape checkCombat's own chase-in branch
            // uses, just aimed at the owner instead of an enemy - mode
            // "fighting" (not "casting"/"idle") purely because that's what
            // renderer.js's own bot-stepping reads to pick BOT_SPRINT_SPEED,
            // same reasoning that branch's own comment gives, nothing to do
            // with this bot's actual combat style
            this.mode = "fighting"
            this.target = { x: ownerPos.x, z: ownerPos.z }
            this.moveArriveRadius = FOLLOW_STOP_DISTANCE
            this.arrive.target.set(ownerPos.x, 0, ownerPos.z)
            this.arrive.active = true
            this.vehicle.maxSpeed = SPRINT_SPEED
            this.moving = true
            return
        }

        // close enough - hold position, but keep FACING the owner's own
        // live position every tick, same "why" checkCombat's own in-range
        // branch gives for doing the exact same thing toward an enemy
        this.mode = "idle"
        this.moving = false
        this.arrive.active = false
        this.vehicle.velocity.set(0, 0, 0)

        const facing = dist > 0.01 ? { x: dx / dist, z: dz / dist } : { x: 0, z: 1 }
        const dirYaw = Math.atan2(facing.x, facing.z)
        this.onMove({ x: p.x, y: RESTING_Y, z: p.z }, dirYaw, this.mode, false)
    }

    // index.ts's own recruit-bot/dismiss-bot handlers - the ONLY callers,
    // and the only thing that ever mutates followOwnerId. null dismisses:
    // checkCombat's own followOwnerId check just goes false on the very
    // next tick and the bot falls straight back into normal
    // hunting/wandering with no extra reset needed here (same "just flip a
    // flag, let the existing loop read it" shape pause()/resume() already
    // use for resting).
    setFollowOwner(ownerId: string | null){
        this.followOwnerId = ownerId
        // fresh start every time (a new recruit, a re-recruit, or a
        // dismiss) - followOwner()'s own hysteresis has nothing meaningful
        // to remember across a boundary like this, so there's no reason to
        // carry a stale true/false over from whatever it was serving before
        this.followingOwner = false
    }

    // SERVANTS - index.ts's own "join-world" handler calls this the
    // instant it detects a place change for an owner who has a servant,
    // right before it repositions botPlayer.pos/currentPlace to match. A
    // place change means an entirely different coordinate space - without
    // this, the bot would keep steering toward wherever the owner "was" in
    // the OLD place's coordinates, a meaningless direction once it's
    // actually dropped into the new one. Resets THIS class's own real
    // simulated position (vehicle.position), not just whatever gets
    // broadcast to clients - same reasoning followOwner()'s own header
    // comment gives for why position (unlike facing) has to be handled
    // carefully: Brain is the actual gameplay authority here, a stale
    // internal position would send it chasing nowhere real regardless of
    // what index.ts tells clients to render. homeAnchor moves too - the
    // true wander-leash center a dismissed servant would fall back to
    // means nothing once it's not even in that old place anymore.
    teleport(x: number, z: number){
        this.vehicle.position.set(x, 0, z)
        this.homeAnchor = { x, z }
        this.target = null
        this.moving = false
        this.arrive.active = false
        this.vehicle.velocity.set(0, 0, 0)
        this.followingOwner = false
    }

    // a small utility-AI pass: score every candidate action 0-1 against
    // this bot's own attitude weights plus a little jitter, then act on
    // whichever scores highest. Only two real candidates exist in this
    // movement-only phase - fighting/dodging/blocking/continuescast (the
    // OTHER attitude fields) plug into this exact same scoring shape once
    // attacking is implemented, they're just not scored yet.
    private think(){
        // combat (checkCombat, its own independent COMBAT_CHECK_MS loop)
        // owns movement/target entirely while engaged - re-rolling a wander
        // decision mid-fight would fight it for control of `target`/`arrive`
        if(this.combatTargetId){
            this.scheduleThink()
            return
        }

        // SERVANTS - same reasoning as combatTargetId right above: checkCombat
        // (which checks followOwnerId FIRST, ahead of any hunting) already
        // owns movement/target entirely while serving someone, a wander
        // decision here would fight it for control the same way
        if(this.followOwnerId){
            this.scheduleThink()
            return
        }

        // already mid-walk toward a wander target - let it actually arrive
        // (tickMove's own arrival check calls stop(), which is what clears
        // `moving` and lets the NEXT think() tick roll a fresh decision).
        // Without this guard, think() re-rolled wanderScore/holdScore every
        // single DECISION_MIN/MAX_MS cycle regardless of whether the
        // previous wander had finished - a fresh target is rolled
        // independently around the fixed anchor each time, not from
        // wherever the bot currently is, so it could easily land behind or
        // to the side of the bot's current heading. Confirmed from an
        // actual screenshot: bots visibly yanked back and forth in a tiny
        // area instead of ever completing one trip out and back.
        if(this.moving){
            this.scheduleThink()
            return
        }

        const wanderScore = clamp01(0.5 + this.attitude.distancing * 0.5 - this.attitude.standbycasting * 0.3 + jitter())
        const holdScore = clamp01(0.5 + this.attitude.standbycasting * 0.5 - this.attitude.distancing * 0.3 + jitter())

        if(wanderScore >= holdScore) this.pickWanderTarget()
        else this.stop()

        this.scheduleThink()
    }

    private scheduleThink(){
        const delay = DECISION_MIN_MS + Math.random() * (DECISION_MAX_MS - DECISION_MIN_MS)
        this.decisionTimer = setTimeout(() => this.think(), delay)
    }

    // hops from wherever the bot CURRENTLY is (this.vehicle.position), not
    // a single fixed anchor re-used for its whole lifetime - the old
    // version rolled every hop independently around the original spawn
    // point, which (combined with distance being uniform-random from 0)
    // produced a lot of short, directionally-unrelated hops that never
    // went anywhere - confirmed from an actual report as looking like a
    // bot running back and forth in place. Hops now compound (each one
    // continues from where the last ended) and cover a real minimum
    // distance (WANDER_MIN_DIST_FRACTION), so a bot actually travels
    // somewhere each time - MAX_HOME_DRIFT is what stops that compounding
    // from letting it wander off indefinitely.
    //
    // Purely aimless movement only - checkCombat() is what handles heading
    // toward a known enemy now (see that function's own header comment for
    // why an earlier version of hunting lived here instead, and what that
    // looked like). think()'s own guard already hands full control to
    // checkCombat whenever any enemy exists anywhere in the bot's place, so
    // this only ever runs when there's truly nothing to hunt.
    private pickWanderTarget(){
        // distancing scales the roll UP toward the full radius - a
        // low-distancing bot (a caster that did decide to move) still only
        // repositions a short way, a high-distancing one (adventurer) can
        // roll the full WANDER_RADIUS
        const hopRadius = WANDER_RADIUS * (0.15 + this.attitude.distancing * 0.85)
        const angle = Math.random() * Math.PI * 2
        const dist = hopRadius * (WANDER_MIN_DIST_FRACTION + Math.random() * (1 - WANDER_MIN_DIST_FRACTION))
        let tx = this.vehicle.position.x + Math.cos(angle) * dist
        let tz = this.vehicle.position.z + Math.sin(angle) * dist

        // leash - pull the target back toward homeAnchor if this hop would
        // land further than MAX_HOME_DRIFT from the bot's true spawn point
        const homeDx = tx - this.homeAnchor.x
        const homeDz = tz - this.homeAnchor.z
        const homeDist = Math.hypot(homeDx, homeDz)
        if(homeDist > MAX_HOME_DRIFT){
            const pullBack = MAX_HOME_DRIFT / homeDist
            tx = this.homeAnchor.x + homeDx * pullBack
            tz = this.homeAnchor.z + homeDz * pullBack
        }

        this.target = { x: tx, z: tz }
        this.moveArriveRadius = ARRIVE_RADIUS
        this.arrive.target.set(tx, 0, tz)
        this.arrive.active = true

        // weapon-heavy attitude reads as purposeful/on-patrol -> "fighting"
        // mode, the same mode+moving combo a real player's own sprint
        // already renders as (renderer.js: fighting+moving = running
        // animation); everyone else ambles at the idle/walk pace
        const isPurposeful = this.attitude.weapon > 0.6
        this.mode = isPurposeful ? "fighting" : "idle"
        this.vehicle.maxSpeed = isPurposeful ? SPRINT_SPEED : WALK_SPEED
        this.moving = true
    }

    private stop(){
        if(!this.moving) return
        this.moving = false
        this.target = null
        this.arrive.active = false
        this.vehicle.velocity.set(0, 0, 0)
        this.mode = "idle"

        const p = this.vehicle.position
        // arbitrary "face world +Z" placeholder (dirYaw:0) - a wandering
        // bot arriving at a plain waypoint has no real target to face, same
        // reasoning checkCombat's own "hunt just ended" branch gives for
        // its identical fallback
        this.onMove({ x: p.x, y: RESTING_Y, z: p.z }, 0, this.mode, false)
    }

    private tickMove(){
        const now = Date.now()
        // clamped - a stalled event loop (gc pause, whatever) producing one
        // huge delta must not let this bot teleport across the map on the
        // next tick
        const delta = Math.min(0.5, (now - this.lastTickAt) / 1000)
        this.lastTickAt = now
        if(!this.moving || !this.target) return

        const dx = this.target.x - this.vehicle.position.x
        const dz = this.target.z - this.vehicle.position.z
        if(Math.hypot(dx, dz) < this.moveArriveRadius){
            if(this.combatTargetId || this.followOwnerId){
                // just halt, stay facing wherever it currently is -
                // checkCombat's own independent COMBAT_CHECK_MS loop (up to
                // 1s away, not this 120ms arrival check) is what actually
                // decides what happens next: swing/cast for a combat
                // target, or re-face the owner for a following bot.
                // followOwnerId used to fall through to the stop() branch
                // below instead (it's not a combatTargetId) - stop() resets
                // dirYaw to an arbitrary "face world +Z" placeholder, so a
                // bot arriving next to its owner would instantly snap to
                // face some unrelated direction instead of the owner, for
                // however long it took checkCombat's own next tick (up to
                // 1s) to correct it - looked exactly like "invited it and
                // it immediately turned and ran off".
                this.moving = false
                this.arrive.active = false
                this.vehicle.velocity.set(0, 0, 0)
            } else {
                this.stop()
            }
            return
        }

        this.vehicle.update(delta)
        const p = this.vehicle.position
        const v = this.vehicle.velocity
        const speed = Math.hypot(v.x, v.z)
        // same "point 1 unit ahead along the facing direction" shape
        // client/src/charactersystem/createcharacter.js's own
        // getPlayerCoord() computes dirTarg as - falls back to facing the
        // target directly if velocity hasn't built up yet (right after a
        // fresh pickWanderTarget(), still accelerating from a stop)
        const facing = speed > 0.01
            ? { x: v.x / speed, z: v.z / speed }
            : { x: dx / Math.hypot(dx, dz), z: dz / Math.hypot(dx, dz) }

        this.onMove(
            { x: p.x, y: RESTING_Y, z: p.z },
            Math.atan2(facing.x, facing.z),
            this.mode,
            true,
        )
    }

    // called from index.ts's applyDamageToBot the instant a hit actually
    // lands on this bot - any source (a real world enemy, a real player's
    // own melee swing, another bot). Caster-only: a melee-style bot WANTS
    // to be in someone's face, so retreating the moment it takes a hit
    // would fight its own combat style - checkCombat's own isMeleeStyle()
    // check already decides fighting vs casting everywhere else, matched
    // here as well rather than inventing a second flag for the same split.
    // Just sets a timestamp - doesn't touch combatTargetId/mode/movement
    // itself, checkCombat's own next tick (COMBAT_CHECK_MS, already
    // running regardless of this) is what actually reads it and reacts,
    // same "flip a flag, let the existing loop read it" shape pause()
    // below already uses for resting.
    notifyDamaged(){
        if(this.isMeleeStyle()) return
        this.retreatUntil = Date.now() + RETREAT_DURATION_MS
    }

    // stops every timer and brings the bot to a dead stop in place -
    // resting reads as fully disengaged, not frozen mid-swing, so any
    // in-progress hunt is dropped too (combatTargetId cleared), not just
    // paused-and-remembered. Idempotent - a second pause() while already
    // paused no-ops instead of double-clearing null timers.
    pause(){
        if(this.paused) return
        this.paused = true
        if(this.decisionTimer) clearTimeout(this.decisionTimer)
        if(this.moveTimer) clearInterval(this.moveTimer)
        if(this.combatTimer) clearInterval(this.combatTimer)
        this.decisionTimer = null
        this.moveTimer = null
        this.combatTimer = null
        this.combatTargetId = null
        this.moving = false
        this.target = null
        this.arrive.active = false
        this.vehicle.velocity.set(0, 0, 0)
        this.mode = "idle"
    }

    // restarts all three timers exactly as the constructor first did -
    // no special "continue where it left off" logic, the bot just starts
    // making fresh decisions again from wherever it's currently standing
    resume(){
        if(!this.paused) return
        this.paused = false
        this.lastTickAt = Date.now()
        this.scheduleThink()
        this.moveTimer = setInterval(() => this.tickMove(), MOVE_TICK_MS)
        this.combatTimer = setInterval(() => this.checkCombat(), COMBAT_CHECK_MS)
    }

    destroy(){
        if(this.decisionTimer) clearTimeout(this.decisionTimer)
        if(this.moveTimer) clearInterval(this.moveTimer)
        if(this.combatTimer) clearInterval(this.combatTimer)
    }
}
