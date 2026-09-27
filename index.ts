import http from "http"
import express from "express"
import cors from "cors"
import { Server, Socket } from "socket.io"
import { randNumString, randNum } from "./tools/tools"

import { placesMD } from "./placedetails/places"
import enemyArray, { OPENWORLD_SLIME_TERRITORY, OPENWORLD_ENEMY_BANDS } from "./recources/enemyDetails"
import startingQuests, { createSlaySlimesQuest, F_RANK_QUEST_COUNT } from "./recources/quests"
import { generateSlimes, generateFireSlimes, generateElectricSlimes, generateMonoliths, generateDarkSlimes, generateLesserDemons } from "./generate-datas/genenemy"
import { startingTreasures } from "./recources/treasures"
import { Brain, ATTITUDE_PRESETS, RESTING_Y } from "./recources/npcBrain"
import { rollBotLevelReward, botTypeFor, botDamageAfterArmor } from "./recources/botItems"
import { getWeather, getWeatherState, rollWeather, setWeather, WEATHER_ROLL_INTERVAL_MS } from "./recources/weather"
import { faker } from "@faker-js/faker"

export const enemyLengthsInPlace = [
    {   
        placeId: 1,
        areaType: "village",
        placeWidth:      300,
        placeHeight:     300,
        name: "waterslime",
        length: 3
    },
    {   
        placeId: 1,
        areaType: "village",
        placeWidth:      300,
        placeHeight:     300,
        name: "fireslime",
        length: 2
    },
]

const app = express()
const server = http.createServer(app)
const PORT = process.env.PORT || 3000
const log = console.log

app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cors({ origin: "*", methods: ["GET", "POST"] }))

// Backstop for anything outside a socket handler's synchronous body - e.g. a
// rejected fire-and-forget promise, or a bug inside a setTimeout callback
// like the one in respawnEnemy below, which safeOn's try/catch can't see
// since it runs after the handler that scheduled it has already returned.
// Logging (rather than letting the process die and the host silently
// restart it) keeps prod failures visible instead of showing up as an
// unexplained blip in uptime.
process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason)
})
process.on("uncaughtException", (error) => {
    console.error("[uncaughtException]", error)
})

// bot-only "what is this bot ultimately working toward" - "leveling"
// tracks real kills (landHit's own level-up hook increments it), while
// "minning"/"chopwoods" are tracked here already but have no corresponding
// BEHAVIOR yet (bots don't actually mine or chop wood at all right now) -
// a bot given one of those goals just sits at current:0 until that's
// built. afterGoalCateg is a fixed 3-way rotation (leveling -> minning ->
// chopwoods -> leveling -> ...), not randomized, so progression stays
// predictable/easy to reason about.
type BotGoalCateg = "leveling" | "minning" | "chopwoods"
type BotGoal = { categ: BotGoalCateg, current: number, goal: number, afterGoalCateg: BotGoalCateg }

type Tplayers = {
    socketId: string
    owner: string,
    name: string,
    lvl: number,
    gender: string, // "male"/"female" - see getCharSocket()'s own comment
    cloth: string,
    pants: string,
    hair: string,
    boots: string,
    clothColor: string,
    pantsColor: string,
    hairColor: string,
    skinColor: string, // was already sent by getCharSocket() but missing from this type
    race: string,
    currentPlace: any, // placeId, name, areaType
    _moving: boolean,
    _minning: boolean,
    _attacking: boolean,
    mode: string, // idle// fighting // structed // paralized //
    pos: { x: number, y: number, z: number},
    dirTarg: { x: number, y: number, z: number},
    items: any,
    skills: any[],
    hasWeapon: boolean,
    weaponBlocking: boolean,
    magicBlocking: boolean,
    IsInVulnerable: boolean,
    // bot-only for now - a real player's own hp lives entirely client-side
    // (characterstate.js), tracked server-side here only because a bot has
    // no client of its own to be authoritative over its own hp the way a
    // real player is. Undefined for every real Tplayers entry.
    hp?: number,
    maxHp?: number,
    // bot-only progression. A bot has no client of its own to hold these
    // (same reasoning hp/maxHp above are bot-only), so tcp is authoritative:
    // every kill adds 1 exp, and reaching maxExp levels the bot up.
    exp?: number,
    maxExp?: number,
    // bot-only, ongoing facing (radians, Y-axis only) - see
    // BotMoveCallback's own header comment (recources/npcBrain.ts) for why
    // this is a plain angle and not a dirTarg point. dirTarg above stays a
    // one-time creation-time value for bots too (createcharacter.js's own
    // initial-facing computation still needs a point, but only ever reads
    // it once, at the same moment spawnPos is fresh/non-drifted) - this is
    // what every ONGOING update after that uses instead.
    dirYaw?: number,
    // bot-only - which ATTITUDE_PRESETS key this bot was given (the preset
    // OBJECT itself, `attitude`, is only ever held in spawnBot()'s own
    // closure, thrown away otherwise) - kept here specifically so the
    // goal-check interval can ask "is this one the lazy preset" from
    // outside that closure.
    attitudeName?: string,
    // bot-only - what this bot is ultimately working toward (see BotGoal's
    // own comment above)
    goal?: BotGoal,
    // bot-only - what the bot is doing RIGHT NOW: "hunt" | "rest" |
    // "minning" | "chopwoods". Set by the 30s goal-check interval below
    // (spawnBot's own laziness/goal-completion check) - tracked/updated
    // for now, doesn't drive any actual behavior change yet (a "rest"
    // bot doesn't yet actually stop moving or show a resting animation -
    // that's real behavioral wiring on top of this, not part of just
    // tracking the goal/mood data itself).
    currentMood?: string,
    // bot-only for now - mirrors server/models/charDetM.js's own
    // characterclass field exactly (same 4 classes, same experties/lvl
    // shape, same sword/staff/pickaxe/axe expertise-per-class mapping) so
    // the two never drift apart, even though a bot never actually goes
    // through the server's REST /save route that field lives behind. A
    // real Tplayers entry never sets this (its own characterclass lives in
    // MongoDB, fetched separately) - undefined here, same convention hp/
    // maxHp above already use for a bot-only field.
    characterclass?: CharacterClass,
    // bot-only - the owner id of whichever real player recruited this bot
    // as a servant/companion (client's own "invite to follow you" prompt,
    // createcharacter.js's bot-interaction wiring), undefined for every
    // bot that hasn't been recruited yet and for every real Tplayers entry.
    // Set/cleared exclusively by the "recruit-bot"/"dismiss-bot" handlers
    // below, which are also the only things that ever call the matching
    // brain.setFollowOwner() - this field and the Brain's own internal
    // followOwnerId are kept in sync by those two handlers alone, never
    // independently.
    servantOfOwnerId?: string,
}

// same shape/expertise-per-class mapping as server/models/charDetM.js's own
// characterclass field - see buildBotCharacterClass below for the one place
// a bot's own copy actually gets built
type CharacterClass = {
    warbringer: { experties: string, lvl: number },
    runecaller: { experties: string, lvl: number },
    duskrunner: { experties: string, lvl: number },
    soulmender: { experties: string, lvl: number },
}

// matches treasures.ts's createSwordTreasure return shape - itemDetail kept
// loose (any) since it's just whatever obtain()-ready item shape a given
// treasure holds (swordsdata.js's sword shape for now, others later), not
// something this server ever reads into/validates field-by-field
type Ttreasure = {
    itemId: string
    pos: { x: number, y: number, z: number }
    currentPlaceId: number
    itemDetail: any
}

// client/src/components/campcraft.js's crafted structures (bonfire for
// now) - unlike Ttreasure above, these are never removed once placed (a
// bonfire doesn't get "picked up" the way a chest does), and there's no
// starting/seeded array - every entry here only ever comes from a player
// actually crafting one at runtime (the "craft-bonfire" handler below).
type Tbonfire = {
    craftId: string
    pos: { x: number, y: number, z: number }
    currentPlaceId: number
}

// A weapon struck into the ground or into an enemy's body (client's
// itemInfoSystem.js's struckItemFunc "struck" button, and skills.js's
// spawnProjectile - a thrown spear's env-hit/enemy-hit cases) -
// createGroundWeapon on the client renders it. Same shape/removal model as
// Ttreasure above (pickup-able, filtered out on pickup) but player-created
// at runtime like Tbonfire, not seeded. itemDetail is a full obtain()-ready
// inventory item, kept loose (any) same reasoning as Ttreasure's own
// itemDetail. ownerId is who struck it - worldsocket.js's own
// reCreateMeshesInScene loop uses it to skip re-creating a duplicate on the
// striker's OWN client, which already rendered its own local copy the
// instant it struck (same self-exclusion shape the players loop already
// uses: `if (tcpCharDet.owner === characterState.owner) return`).
type Tstruckweapon = {
    itemId: string
    pos: { x: number, y: number, z: number }
    currentPlaceId: number
    itemDetail: any
    ownerId: string
    // set only for the enemy-stick case (creations/skills.js's own
    // enemy-hit branch) - worldsocket.js's own struck-weapon sync uses this
    // to parent every other client's copy directly to that enemy instead of
    // a floating static copy at `pos` (kept as the fallback either way)
    targetEnemyId?: string
}

let players: Tplayers[] = []
let gates: unknown[] = []
// AI-controlled bot players (recources/npcBrain.ts's own Brain class) - see
// the "BOT PLAYERS" block further down for the actual spawn/toggle logic.
// Each bot's own Tplayers entry lives in `players` above like any real
// player (that's what makes it render identically on every client - see
// spawnBot's own comment) - this array is purely server-side bookkeeping so
// a bot's own Brain instance (and its setInterval/setTimeout timers) can be
// found and torn down later, keyed by the same `owner` id.
let bots: { player: Tplayers, brain: Brain, goalInterval: ReturnType<typeof setInterval>, wakeInterval: ReturnType<typeof setInterval> }[] = []
let spawnBotsEnabled = false
// client's sockets/botSensor.js's own periodic report - tcp has no idea
// where trees/buildings/decorations are otherwise (all client-only scene
// data). Keyed by placeId, always just the MOST RECENT report for that
// place (not merged/accumulated across multiple reporters) - a report is
// already a fresh full snapshot of what's near whichever real player sent
// it, so replacing beats trying to merge stale + fresh entries together.
let obstaclesByPlace: Record<number, { x: number, z: number, radius: number }[]> = {}

let tcpEnemies = enemyArray
let quests = startingQuests
let treasures: Ttreasure[] = startingTreasures
let bonfires: Tbonfire[] = []
let struckWeapons: Tstruckweapon[] = []

// enemy._id -> a per-bind counter, only used by the enemyBind handler below
// (skill.enemyBind) - lets a second bind landing on an already-bound enemy
// supersede the first one's timer instead of racing it: only the MOST
// RECENT bind's own setTimeout is allowed to actually clear _disabled
const enemyBindTokens = new Map<string, number>()


app.get("/", (req, res) => {
    res.status(200).send(players)
})

// public server status - no auth/socket connection needed, so the client
// can show a live online count on the home page before login
app.get("/status", (req, res) => {
    res.status(200).json({ online: players.length })
})

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
})

// Unlike Express 5 (which auto-forwards a thrown/rejected async route handler
// to its own error middleware instead of crashing), Socket.IO has no built-in
// protection against a listener throwing - and every handler below reads
// straight from a client-supplied payload (data.currentPlace.placeId,
// data.dmgDetails.weaponDmg, etc.) with no validation. One malformed message
// from any single connected player would otherwise take the whole server
// down for everyone. This only guards the synchronous portion of a handler -
// see the process-level uncaughtException/unhandledRejection handlers below
// for the backstop covering deferred callbacks (e.g. respawnEnemy's setTimeout).
function safeOn(socket: Socket, event: string, handler: (...args: any[]) => void) {
    socket.on(event, (...args: any[]) => {
        try {
            handler(...args)
        } catch (error) {
            console.error(`[socket:${event}] handler threw:`, error)
        }
    })
}

// The ONE line this server prints about enemy combat.
//
// It used to log every single hit's remaining hp ("enemy hp 2062 / 2500").
// With several bots fighting at once that scrolls continuously and buries
// everything else in the terminal, while telling you nothing you cannot
// already see in game - an enemy's health bar counting down is the client's
// job. A KILL is the event actually worth a line, so only that gets one.
//
// The killer is looked up in `players`, which holds bots and real players
// alike (spawnBot pushes its botPlayer straight into it), so a single lookup
// covers both cases. `bots` is consulted only to label which kind it was,
// since Tplayers carries no isBot flag of its own.
function logEnemyKill(enemyTarg: any, killerId: string){
    const enemyName = enemyTarg?.dn ?? enemyTarg?.name ?? "enemy"
    const killer = players.find(pl => pl.owner === killerId)
    // no killer resolves when the hit came from a player who disconnected
    // mid-swing, or a bot that died to something else on the same tick -
    // still worth a line, just without a name to put on it
    if(!killer) return log(`[kill] ${enemyName} killed by <unknown ${killerId ?? "?"}>`)
    const kind = bots.some(b => b.player.owner === killerId) ? "bot" : "player"
    log(`[kill] ${enemyName} killed by ${killer.name} lvl ${killer.lvl} (${kind})`)
}

// the ONE place enemy hp actually gets mutated - originally inline inside
// the "enemyIsHit" socket handler below, pulled out so recources/npcBrain.ts's
// own bot combat (BOT PLAYERS block further down) can deal REAL damage
// through the exact same path a real player's own hit already does,
// instead of a second, easy-to-drift-out-of-sync copy of this logic.
// data shape matches whatever a real emitEnemyIsHit() call already sends
// ({targetId, dmgDetails, playerId, currentPlaceId, isPhysical, ...}) - a
// bot-dealt hit just builds that same shape with its own owner id as
// playerId (see performBotAttack further down).
// return value: true if this specific hit is what actually killed the
// enemy (hp crossed to <=0 on THIS call), false otherwise - callers that
// don't care (every real-player call site) just ignore it. Added for
// spawnBot()'s own dealDamage callback, which needs to know exactly when
// one of ITS hits was the killing blow, to level the bot up off of.
function applyDamageToEnemy(data: any): boolean {
    const { targetId, dmgDetails } = data

    const enemyTarg = tcpEnemies.find(ene => ene._id === targetId)
    if(!enemyTarg){
        // same shape "removeEnemy"'s own handler already broadcasts
        // (io.emit("enemy-removed", enemyId) - a plain string) - this
        // was an object instead ({targetId, currentPlaceId}), but the
        // client's own "enemy-removed" listener always treats its
        // payload as the bare id string (enmy._id === enemyId, and
        // `enemy.${enemyId}` for the mesh-name lookup). An object
        // compared with === against a string is always false, and
        // interpolated into a template literal it stringifies to the
        // literal text "enemy.[object Object]", which can never match
        // any real mesh name - so this self-healing fallback (tell the
        // client to clean up a ghost it's still holding onto, the
        // moment the server confirms it doesn't actually exist) was
        // silently never doing anything. Fixed by matching the one
        // shape that already works everywhere else.
        io.emit("enemy-removed", targetId)
        log("not found enemy to be damaged, told the client to clean up its own ghost - ", targetId)
        return false
    }
    const dmgToApply = dmgDetails.weaponDmg ? dmgDetails.weaponDmg : dmgDetails.physicalDmg
    enemyTarg.hp -= dmgToApply
    const isLethal = enemyTarg.hp <= 0
    if(isLethal){
        tcpEnemies = tcpEnemies.filter(enemy => enemy._id !== targetId)
        logEnemyKill(enemyTarg, data.playerId)
    }
    // {...data, ...} is what carries a hit weapon's own effectsWhenHit
    // (client's characterstate.js dealDamageToEnemy, e.g. the Majestic
    // Sword's burn - npcDetails.js item data) all the way back to every
    // connected client's own enemyIsHit() (createEnemy.js), which is
    // what actually starts the burn tick/particles - already just rides
    // along for free with everything else in data, no explicit
    // destructuring/whitelisting needed here.
    io.emit("enemy-is-hit", {...data, dmgToApply, hp: enemyTarg.hp, maxHp: enemyTarg.maxHp})
    return isLethal
}

// the ONE place an enemy's _targetId actually gets set, WITHOUT overwriting
// one it already has - originally inline inside the "registerPlayerAsEnemy"
// handler below (a real player's own atkDetection proximity trigger,
// createEnemy.js, calls emitRegisterAsEnemy the moment their OWN character
// walks into an enemy's detection zone). Pulled out the same way
// applyDamageToEnemy was, so the BOT PLAYERS block further down can
// register a bot as an enemy's target too - a bot has no real client of
// its own to run that exact proximity-trigger code (it only ever exists as
// broadcast data, never a real body in anyone's physics scene), so without
// this an enemy a bot is actively hitting would just never notice/retaliate
// at all. Called from the bot's own dealDamage callback the moment it lands
// a hit, as the closest available stand-in for "is now engaging this
// enemy up close" - not on every single hit's worth of urgency, just
// whenever the enemy doesn't already have SOME target (same guard the real
// player path already enforces).
function registerTargetIfNone(enemyId: string, targetId: string, dirTarg: any) {
    const enemyTarg = tcpEnemies.find(enem => enem._id === enemyId)
    if(!enemyTarg) return
    if(enemyTarg._targetId) return

    enemyTarg._targetId = targetId
    enemyTarg._dirTarg = dirTarg
    io.emit("registered-playerAsEnemy", tcpEnemies)
}

// the "someone just died, release whoever was chasing them" half of that
// same relationship - originally duplicated inline in both "will-die" (a
// real player's own death) and the bot-death branch inside "enemyWillAttack"
// below, pulled out the same way registerTargetIfNone/applyDamageToEnemy
// already were. Resetting tcpEnemies alone was never enough on its own -
// renderer.js's own chase-movement branch gates purely on an enemy's
// _isMoving/_targetId, not on whether the target it looks up actually
// still resolves to anything, so an already-connected client that never
// heard about this reset kept replaying the running animation in place
// forever even after its target vanished from playersOnScene (confirmed
// from an actual report: a deer that had just killed a bot). Broadcasting
// via "registered-playerAsEnemy" reuses the exact relay target ACQUISITION
// already goes through - every client already has a handler for it, no new
// event needed.
// SERVANTS - "whatever my owner is fighting is what I fight". Called from
// the "enemyIsHit" handler below, which every real player attack on an
// enemy reaches (melee swings AND skill hits), so simply attacking
// something is how you command your companions - there is no separate order
// to issue, which is the whole point of the design.
//
// Broadcasts nothing: a servant switching target has no client-visible
// effect of its own beyond the movement/attacks it is already emitting
// through its normal Brain loop, so there is nothing extra for anyone to
// render. Silently does nothing for a player with no servants, which is the
// overwhelmingly common case and why the early return is worth having on a
// path this hot (it runs on every single hit anyone lands).
function commandServantsToAttack(ownerId: string, enemyId: string){
    if(!ownerId || !enemyId) return
    bots.forEach(b => {
        if(b.player.servantOfOwnerId !== ownerId) return
        b.brain.commandAttack(enemyId)
    })
}

function releaseEnemiesTargeting(deadOwnerId: string){
    let anyReleased = false
    tcpEnemies.forEach(enem => {
        if(enem._targetId !== deadOwnerId) return
        enem._targetId = false
        enem._isMoving = false
        enem._attacking = false
        anyReleased = true
    })
    if(anyReleased) io.emit('registered-playerAsEnemy', tcpEnemies)
}

// Physical damage after the target's worn armour, for any target id.
//
// Returns `dmg` untouched when the id is not a bot, which is what makes it
// safe to run on EVERY hit at both call sites below: a real player's hp is
// tracked entirely client-side (see "enemy-attacked"'s own comment), so
// their armour is their own client's business and this must not touch it.
//
// Callers apply this BEFORE both the hp deduction and the broadcast, so the
// number that goes out on the wire is the number that actually landed -
// worldsocket.js's "player-is-hit" handler reads it to decide between the
// blood spray and the weapon-block clang, and a bot in heavy plate shrugging
// off a hit should sound like it.
function mitigatedBotDamage(targetId: string, dmg: number): number {
    const targetBot = bots.find(b => b.player.owner === targetId)
    if(!targetBot) return dmg
    return botDamageAfterArmor(targetBot.player.items, dmg)
}

// mirrors applyDamageToEnemy's own shape/return convention (true = this hit
// was the killing blow) - the one place a bot's hp actually gets reduced,
// shared by every path that can damage a bot: a real enemy's own attack
// ("enemyWillAttack" below, originally inlined here) and now a real
// player's own melee swing ("playerIsHit" below, createcharacter.js's new
// atkCollider exit trigger). Same "bot has no client of its own to apply
// its own damage" reasoning BOT_MAX_HP's own comment already gives - the
// server has to be authoritative for it regardless of who dealt the hit.
function applyDamageToBot(targetId: string, dmg: number): boolean {
    const targetBot = bots.find(b => b.player.owner === targetId)
    if(!targetBot || targetBot.player.hp === undefined) return false

    targetBot.player.hp -= dmg
    // npcBrain.ts's own kiting behavior (caster-only, no-ops for a melee
    // bot - see notifyDamaged's own comment) - called on every hit, lethal
    // or not, since a bot that's about to die has no meaningful "retreat"
    // to react to anyway and this is a no-op either way once destroy()
    // tears the timers down right below
    targetBot.brain.notifyDamaged()
    if(targetBot.player.hp > 0) return false

    targetBot.brain.destroy()
    clearInterval(targetBot.goalInterval)
    clearInterval(targetBot.wakeInterval)
    const deadOwner = targetBot.player.owner
    const deadPlaceId = targetBot.player.currentPlace.placeId
    bots = bots.filter(b => b.player.owner !== deadOwner)
    players = players.filter(pl => pl.owner !== deadOwner)
    releaseEnemiesTargeting(deadOwner)
    // same broadcast a real player's own client sends itself via "will-die"
    // on real death (see that handler above) - NOT "removeChar" (see
    // applyDamageToBot's own former call site's identical comment, still
    // true here: this plays the same death-clip-then-despawn sequence a
    // real player's own death already gets, no new client code needed)
    io.emit('player-death', { ownerId: deadOwner, currentPlaceId: deadPlaceId })
    return true
}

// the "owner just left, release any bot(s) still serving them" half of the
// servant relationship (see Tplayers.servantOfOwnerId's own comment) - a
// bot whose owner disconnects would otherwise chase a spot that never
// updates again forever (Brain's own followOwner() only ever gets a null
// ownerPos once `players` no longer has that owner at all, which just makes
// it hold still in place - never crashes, but never resumes normal AI
// either without this). Called from removeCharacter() below, same
// "someone left, clean up every reference to them" moment
// releaseEnemiesTargeting already runs at for enemy targeting.
function releaseServantsOf(ownerId: string){
    bots.forEach(b => {
        if(b.player.servantOfOwnerId !== ownerId) return
        b.player.servantOfOwnerId = undefined
        b.brain.setFollowOwner(null)
        io.emit("bot-servant-updated", { botOwnerId: b.player.owner, servantOfOwnerId: null })
    })
}

io.on("connection", (socket: Socket) => {
    safeOn(socket, "join-world", (data, callback) => {
        // join-world fires every time the client loads a new place, not just
        // on first connect (see areascene.js) - so an existing entry for this
        // owner only means another device is logged in if it's a different
        // socket. Same socket re-joining is just a place change and must
        // still re-broadcast userJoined, otherwise reCreateMeshesInScene()
        // never runs again after the first place (no enemies get spawned,
        // and this player also drops out of `players`, so the server can no
        // longer find them to echo back their own attacks either).
        const alreadyJoined = players.find(user => user.owner === data.owner)
        if(alreadyJoined && alreadyJoined.socketId !== socket.id) {
            socket.to(alreadyJoined.socketId).emit("duplicate-login", { message: "You have logged in from another device." })
        }
        players = players.filter(user => user.owner !== data.owner)

        const hasWeapon = Array.isArray(data.items) && data.items.some((itm: any) => itm.itemType === "weapon" && itm.equiped)
        players.push({...data,
        mode: "idle",
        _moving: false,
        _minning: false,
        hasWeapon,
        weaponBlocking: false,
        magicBlocking: false,
        IsInVulnerable: false,
        socketId: socket.id})
        // if (callback) {
        //     callback({socketId: socket.id, placesMD});
        // }

        // SERVANTS - a bot serving this owner has to move WITH them across
        // a place change (this handler fires on every door/place transition,
        // not just first login - see this handler's own header comment) -
        // without this, the bot stays behind in whatever place it was just
        // in, and every client (including the owner's own) only ever
        // renders players/bots whose currentPlace matches ITS OWN
        // (worldsocket.js's reCreateMeshesInScene) - looks exactly like
        // "the bot just isn't there anymore", confirmed from an actual
        // report. Repositioned near the owner's own freshly-reported pos,
        // same small-random-offset convention "spawn-bot-near-me" already
        // uses so it doesn't land literally on top of them.
        // b.player is the SAME object reference `players` itself holds
        // (spawnBot's own players.push(botPlayer)) - mutating it here means
        // the userJoined broadcast just below already carries the updated
        // currentPlace/pos, no separate emit needed for that part.
        // brain.teleport() resets the ACTUAL simulated position this bot
        // steers from (not just this Tplayers bookkeeping) - see that
        // method's own comment for why that's required, not optional,
        // the moment the place itself (an entirely different coordinate
        // space) has changed out from under it.
        //
        // Known limitation, not fixed here: other players still in the
        // OLD place get no signal that this bot just left - it lingers as
        // a frozen "ghost" on their own screen until something else
        // refreshes their scene. Pre-existing for ANY departing player
        // (reCreateMeshesInScene's own would-be stale-cleanup pass is
        // commented out, sitting on the 5s ENEMY_TARGET_VALIDATION-style
        // sweep instead for enemies, nothing equivalent for players yet) -
        // not a new gap this feature introduces.
        bots.forEach(b => {
            if(b.player.servantOfOwnerId !== data.owner) return
            const angle = Math.random() * Math.PI * 2
            const newX = data.pos.x + Math.cos(angle) * BOT_BESIDE_OFFSET_DIST
            const newZ = data.pos.z + Math.sin(angle) * BOT_BESIDE_OFFSET_DIST
            b.player.currentPlace = data.currentPlace
            b.player.pos = { x: newX, y: RESTING_Y, z: newZ }
            b.brain.teleport(newX, newZ)
        })

        console.log(players)
        // weather rides along in the snapshot rather than waiting for the next
        // "weather-changed" broadcast - a player joining (or walking through
        // any door, since this fires on every place change) would otherwise
        // stand in clear skies until the next roll came around, while everyone
        // already in the world was in a storm. Same reasoning this payload
        // already carries treasures/bonfires instead of only their deltas.
        io.emit("userJoined", { currentPlaceId: data.currentPlace.placeId, newPlayerName: data.name,
            players, placesMD, tcpEnemies, quests,
            treasures, bonfires, struckWeapons,
            weather: getWeatherState()
        }) // always send the updated players count
    })

    // client's inputMovement.js "v" debug key - flips the module-level
    // spawnBotsEnabled flag the BOT PLAYERS block's own setInterval (further
    // down this file) checks every BOT_SPAWN_INTERVAL_MS. No payload/state
    // to store per-player, so this is the simplest possible relay shape
    // (compare emitCraftBonfire/emitRemoveTreasure above) - toggled by
    // whichever connected client presses "v", affects every bot spawned
    // from then on, not scoped to that one player.
    // debug/admin override - forces the world onto one weather immediately
    // instead of waiting on the roll timer, so all five states can actually be
    // looked at without sitting through WEATHER_ROLL_INTERVAL_MS each time.
    // Same "whichever client asks, everyone gets it" scope as
    // toggle-spawn-bots below; there's no per-player weather to scope it to.
    safeOn(socket, "set-weather", (data) => {
        const applied = setWeather(data?.weather)
        if(!applied) return log(`[weather] ignored unknown weather "${data?.weather}"`)
        log(`[weather] forced -> ${applied}`)
        io.emit("weather-changed", getWeatherState())
    })

    safeOn(socket, "toggle-spawn-bots", () => {
        spawnBotsEnabled = !spawnBotsEnabled
        console.log(`[bots] spawning ${spawnBotsEnabled ? "ENABLED" : "disabled"}`)
    })
    // debug convenience - drops exactly one caster-attitude bot right next
    // to whoever pressed the key (inputMovement.js's own "g" debug key),
    // instead of waiting on the random 5s interval/random place/random
    // attitude the toggle above otherwise relies on. Small random offset
    // so it doesn't spawn literally overlapping the requester's own body.
    safeOn(socket, "spawn-bot-near-me", data => {
        const angle = Math.random() * Math.PI * 2
        spawnBot({
            attitudeName: "caster",
            pos: {
                x: data.pos.x + Math.cos(angle) * BOT_BESIDE_OFFSET_DIST,
                z: data.pos.z + Math.sin(angle) * BOT_BESIDE_OFFSET_DIST,
            },
            currentPlace: data.currentPlace,
        })
    })

    // client's createcharacter.js own new bot-interaction proximity prompt
    // ("invite to follow you") - a bot already serving someone (its own
    // servantOfOwnerId set to a DIFFERENT owner) can't be poached by a
    // second player just walking up and re-recruiting it; the current
    // owner has to dismiss-bot it first. Re-inviting from the SAME owner
    // that already has it is a harmless no-op (falls through the same
    // guard, brain.setFollowOwner() just gets called again with the exact
    // same id).
    safeOn(socket, "recruit-bot", data => {
        const { botOwnerId, ownerId } = data
        const targetBot = bots.find(b => b.player.owner === botOwnerId)
        if(!targetBot) return
        if(targetBot.player.servantOfOwnerId && targetBot.player.servantOfOwnerId !== ownerId) return

        targetBot.player.servantOfOwnerId = ownerId
        targetBot.brain.setFollowOwner(ownerId)
        io.emit("bot-servant-updated", { botOwnerId, servantOfOwnerId: ownerId })
    })
    // only the bot's own current servant-owner can dismiss it - not just
    // anyone who happens to walk up to someone else's companion
    safeOn(socket, "dismiss-bot", data => {
        const { botOwnerId, ownerId } = data
        const targetBot = bots.find(b => b.player.owner === botOwnerId)
        if(!targetBot) return
        if(targetBot.player.servantOfOwnerId !== ownerId) return

        targetBot.player.servantOfOwnerId = undefined
        targetBot.brain.setFollowOwner(null)
        io.emit("bot-servant-updated", { botOwnerId, servantOfOwnerId: null })
    })

    // client's sockets/botSensor.js - see obstaclesByPlace's own comment
    // above. Purely server-side bookkeeping, no broadcast - this data only
    // ever feeds bot pathing, no other client needs to know about it.
    safeOn(socket, "bot-obstacle-report", data => {
        const { obstacles, currentPlaceId } = data
        if(!Array.isArray(obstacles)) return
        obstaclesByPlace[currentPlaceId] = obstacles
    })

    // client/src/components/campcraft.js's own craft flow already spawns
    // the bonfire LOCALLY the instant the player crafts it (no waiting on
    // a round-trip for their own client - same "client acts immediately,
    // server just relays to everyone else" trust level every other action
    // in this game already gets, e.g. enemyIsHit never waiting on the
    // server to confirm a hit landed before showing it). This is only
    // what makes every OTHER connected client also see it, and what a
    // fresh joiner's own userJoined payload above replays it from.
    //
    // Bare io.emit (not socket.broadcast.emit), same as "treasure-removed"
    // above - the crafting client gets this echoed back to itself too, but
    // that's fine/expected: it already spawned + tracked this craftId
    // locally (worldsocket.js's own pushBonfireOnScene), so its own
    // reCreateMeshesInScene-style handling of this event is a harmless
    // no-op rather than a double-spawn.
    safeOn(socket, "craft-bonfire", data => {
        const { placeId, position, craftId } = data
        const bonfire: Tbonfire = { craftId, pos: position, currentPlaceId: placeId }
        bonfires.push(bonfire)
        io.emit("bonfire-crafted", bonfire)
    })

    // client's assetcreation/creategroundweapon.js already rendered this
    // LOCALLY the instant the player struck it (struckItemFunc's "struck"
    // button, or a thrown spear's env-hit/enemy-hit case) - same
    // "client acts immediately, server just relays to everyone else + what
    // a fresh joiner's userJoined payload replays it from" trust level
    // craft-bonfire above already uses. Bare io.emit, same reasoning - the
    // striker's own reCreateMeshesInScene-style handling of this event
    // (worldsocket.js) already skips re-creating a duplicate for its own
    // ownerId, so the echo back to itself is a harmless no-op there.
    safeOn(socket, "strike-weapon", data => {
        const { itemId, pos, placeId, itemDetail, ownerId, targetEnemyId } = data
        const weapon: Tstruckweapon = { itemId, pos, currentPlaceId: placeId, itemDetail, ownerId, targetEnemyId }
        struckWeapons.push(weapon)
        io.emit("weapon-struck", weapon)
    })
    // a struck weapon getting picked up - same shape as removeTreasure above
    // (bare id string, naturally idempotent, client-authoritative - not a
    // hardened anti-duplication lock, same trust level this whole server
    // already gives every other piece of loot).
    safeOn(socket, "pickup-struck-weapon", weaponId => {
        struckWeapons = struckWeapons.filter(w => w.itemId !== weaponId)
        io.emit("struck-weapon-removed", weaponId)
    })

    // WORLD CHAT - simple global relay, no rooms/parties. tcp has no db
    // access, so persistence happens client-side straight to the server's
    // own REST api (see server/routes/worldMessageR.js); this just fans the
    // message back out to everyone in realtime.
    safeOn(socket, "worldChatMessage", data => {
        const { playerId, message } = data
        if(!message || !message.trim()) return
        if(!players.find(uzr => uzr.owner === playerId)) return log(`no valid player ${playerId}`)
        io.emit("worldChatMessage", data)
        console.log(data)
    })

    // MOVEMENTS
    safeOn(socket, "emitMode", data => {
        const { ownerId, mode, weaponName} = data
        let player = players.find(user => user.owner === ownerId)
        if(!player) return

        player.mode = mode
        io.emit("emitted-mode", data)
    })
    // r-click hold-to-block (inputMovement.js's activateMouseControls,
    // relayed via emits.js's emitWeaponBlock) - same store-on-Tplayers-then-
    // rebroadcast shape as emitMode right above. Kept on `players` (not
    // just relayed blind) so a client that joins/re-syncs mid-fight can
    // read this player's current stance off the roster instead of having
    // missed the one-off toggle event entirely.
    safeOn(socket, "emitWeaponBlock", data => {
        const { ownerId, isBlocking } = data
        let player = players.find(user => user.owner === ownerId)
        if(!player) return

        player.weaponBlocking = isBlocking
        io.emit("emitted-weaponblock", data)
    })
    safeOn(socket, "emitLoc", data => {
        const { ownerId, pos, dirTarg, mode, weaponName} = data
        let player = players.find(user => user.owner === ownerId)
        if(!player) return
        
        player.mode = mode
        player.pos = pos
        player.dirTarg = dirTarg

        // log(`mode: `, player.mode)
        // log(`pos: `, player.pos)
        // log(`dirTarg: `, player.dirTarg)
        io.emit("emitted-loc", data)
    })
    safeOn(socket, "emitmove", data => {
        const { ownerId, pos, dirTarg, mode} = data
        let player = players.find(user => user.owner === ownerId)
        if(!player) return
        
        player._moving = true
        player.mode = mode
        player.pos = pos
        player.dirTarg = dirTarg

        // log(`mode: `, player.mode)
        // log(`pos: `, player.pos)
        // log(`dirTarg: `, player.dirTarg)
        io.emit("emitted-moving", data)
    })
    safeOn(socket, "emitStop", data => {
        const { ownerId, pos, dirTarg, mode} = data
        let player = players.find(user => user.owner === ownerId)
        if(!player) return
        
        player._moving = false
        player.mode = mode
        player.pos = pos
        player.dirTarg = dirTarg

        // log(`mode: `, player.mode)
        // log(`pos: `, player.pos)
        // log(`dirTarg: `, player.dirTarg)
        io.emit("stopped", data)
    })
    // Actions
    safeOn(socket, "emitPlayerAttack", data => {
        const {
            owner,
            pos,
            dirTarg,
            animName,
            dmgDetails,
            hasWeapon,
            isMissed,
            weaponType,
            currentPlaceId,
            atkSpd
        } = data

        const player = players.find(uzr => uzr.owner === owner)
        if(!player) return log(`no valid player ${owner}`)
        player._attacking = true
        player._moving = false
        // const enemyTarg = tcpEnemies.find(ene => ene._id === data.targetId)
        // if(!enemyTarg) return log("not found enemy to be damaged ", data.targetId)
        
        // if(!isMissed){
        //     enemyTarg.hp -= data.hasWeapon ? data.dmgDetails.weaponDmg : data.dmgDetails.physicalDmg
        //     if(enemyTarg.hp <= 0) tcpEnemies = tcpEnemies.filter(enemy => enemy._id !== data.targetId)
        // }
        player.pos.x = pos.x
        player.pos.z = pos.z
        player.dirTarg = dirTarg
        io.emit("player-attacked", data)
    })
    safeOn(socket, "activate-skill", data => {
        const { ownerId, skill, currentPlaceId } = data
        switch(skill.name){
            case "flexaura":
                const player = players.find(uzr => uzr.owner === ownerId)
                if(!player) return log(`no valid player ${ownerId}`)
                player.skills.forEach((skl: any) => {
                    if(skl.name === skill.name) skl.isActive = skill.isActive
                })
                break
            default:
                break
        }
        io.emit("skillactivated", data)
    })
    // MAGIC CIRCLES - purely visual sync, no server state to touch. Client is
    // responsible for filtering by placeId (and by ownerId, once emitSpawnCircle
    // sends one - see note in client/src/sockets/emits.js) before spawning.
    // socket.broadcast.emit (not io.emit) - every existing caller (the
    // shrine circle in localroomdb.js, createEnemy.js's own lesserdemon
    // teleport telegraph) already spawns its OWN circle locally before/
    // alongside emitting this, same "I already applied it locally, this is
    // just for everyone else watching" reasoning correctEnemyY's own
    // handler below already uses - io.emit would echo it right back to the
    // sender too, rendering a second overlapping circle on their own screen.
    safeOn(socket, "spawncirc", data => {
        const { pos, placeId, element } = data
        socket.broadcast.emit("circle-spawned", { pos, placeId, element })
    })
    // SPEAR THROW - same "purely visual sync, no server state to touch"
    // shape as spawncirc right above, and the exact same reason for
    // socket.broadcast.emit over io.emit: client/src/charactersystem/
    // uimanagement.js's throwSpearProjectile already spawns the thrower's
    // OWN projectile locally before this ever fires, so io.emit would echo
    // it right back and spawn a second overlapping spear on their own screen.
    safeOn(socket, "throwspear", data => {
        const { spawnPos, targetPos, parts, placeId } = data
        socket.broadcast.emit("spear-thrown", { spawnPos, targetPos, parts, placeId })
    })
    // EQUIPING
    safeOn(socket, "emitEquipItem", data =>{
        const {ownerId, itemName, itemModelStyle,  itemType, currentPlaceId} = data
        const isValidPlayer = players.find(uzr => uzr.owner === ownerId)
        if(!isValidPlayer) return log(`no valid player ${ownerId}`)
        log(`A Player is equiping ${itemName} in ${currentPlaceId}`)
        if(itemType === "weapon") isValidPlayer.hasWeapon = true
        io.emit('equiped-item', data)
    })
    safeOn(socket, "emitUnEquip", data =>{
        const {ownerId, itemType, currentPlaceId} = data
        const player = players.find(uzr => uzr.owner === ownerId)
        if(!player) return log(`no valid player ${ownerId}`)
            player.items.forEach( (item: any) => {

            if(item.itemType === itemType) item.equiped = false
        })
        if(itemType === "weapon") player.hasWeapon = false
        log("unequping ",player)
        io.emit("unequiped-item", data)
    })

    // QUESTS (guild board)
    safeOn(socket, "emitClaimQuest", data => {
        const { ownerId, questId, currentPlaceId } = data
        const player = players.find(uzr => uzr.owner === ownerId)
        if(!player) return log(`no valid player ${ownerId}`)
        const targetQuest = quests.find(q => q.questId === questId)
        if(!targetQuest) return log(`no valid quest ${questId}`)
        if(targetQuest.claimed) {
            log(`quest ${questId} already claimed, rejecting ${ownerId}`)
            io.emit("quest-claim-result", { ownerId, questId, currentPlaceId, success: false })
            return
        }
        targetQuest.claimed = true
        log(`${ownerId} claimed quest ${questId}`)
        io.emit("quest-claim-result", { ownerId, questId, currentPlaceId, success: true, quest: targetQuest })
    })
    safeOn(socket, "emitCancelQuest", data => {
        const { ownerId, questId, currentPlaceId } = data
        const targetQuest = quests.find(q => q.questId === questId)
        if(!targetQuest) return log(`no valid quest ${questId}`)
        targetQuest.claimed = false
        log(`${ownerId} cancelled quest ${questId}`)
        io.emit("quest-cancelled", { ownerId, questId, currentPlaceId, quest: targetQuest })
    })
    // fired once the player turns the finished quest in (client already
    // checked completion and granted the reward) - this just retires it from
    // the board's pool for good and, if that drops f-rank quests (like the
    // slime ones) below F_RANK_QUEST_COUNT, tops the pool back up so it never
    // drifts above or below that count
    safeOn(socket, "emitCompleteQuest", data => {
        const { ownerId, questId, currentPlaceId } = data
        const targetQuest = quests.find(q => q.questId === questId)
        if(!targetQuest) return log(`no valid quest ${questId}`)

        quests = quests.filter(q => q.questId !== questId)
        log(`${ownerId} completed quest ${questId}`)

        if(targetQuest.requiredRank.rankLabel === "f"){
            const fRankCount = quests.filter(q => q.requiredRank.rankLabel === "f").length
            if(fRankCount < F_RANK_QUEST_COUNT){
                const newQuest = createSlaySlimesQuest(2, targetQuest.pos)
                quests.push(newQuest)
                io.emit("quest-spawned", { currentPlaceId, quest: newQuest })
            }
        }
    })

    //enemy related
    // SERVANTS - a real player landing a hit on an enemy is also the ORDER
    // that sends their servants at it. There is no separate "attack that"
    // button by design: whatever you are fighting is what your companions
    // fight (npcBrain.ts's own commandAttack). This fires for melee swings
    // and skill hits alike, since every one of them reaches this handler.
    safeOn(socket, "enemyIsHit", data => {
        applyDamageToEnemy(data)
        commandServantsToAttack(data.playerId, data.targetId)
    })
    // open PvP - createcharacter.js's own new atkCollider exit trigger
    // (mirrors createEnemy.js's identical mechanism for world enemies) fires
    // this the moment my own swing's hitbox clears ANOTHER player's or bot's
    // body. dmgToApply computed the exact same weaponDmg-else-physicalDmg
    // way applyDamageToEnemy/duelSystem.js's own local copy already do.
    //
    // targetId is a bot -> this server IS the authority for its hp (same
    // reasoning applyDamageToBot's own header comment gives - a bot has no
    // client of its own to apply anything). targetId is a REAL player ->
    // this server tracks no hp for them at all (see "enemy-attacked"'s own
    // comment on that convention) - the broadcast below is the only thing
    // that ever applies this hit, read by the TARGETED player's own client
    // (data.targetId === their own charState.owner) the same way
    // "enemy-attacked" already works for enemy-dealt damage, just reusing
    // this new event name instead of pretending an enemy attacked them.
    safeOn(socket, "playerIsHit", data => {
        const rawDmg = data.dmgDetails.weaponDmg ? data.dmgDetails.weaponDmg : data.dmgDetails.physicalDmg
        // a bot target soaks this through whatever armour it has earned;
        // a real player target gets it back unchanged (see mitigatedBotDamage)
        const dmgToApply = mitigatedBotDamage(data.targetId, rawDmg)
        applyDamageToBot(data.targetId, dmgToApply)
        // RETALIATION - a bot that just got hit fights back, hired or not.
        // data.playerId is whoever swung: createcharacter.js's atkCollider
        // exit trigger sends its own charState.owner, so the attacker is
        // already known here with nothing new to plumb through. No-ops when
        // the target is a real player (nothing to notify) and, deliberately,
        // when a servant's own owner is the one who clipped it - see
        // notifyAttackedBy's own comment on why that guard has to exist.
        bots.find(b => b.player.owner === data.targetId)?.brain.notifyAttackedBy(data.playerId)
        io.emit("player-is-hit", { ...data, dmgToApply })
    })
    // skill.enemyBind (see client's skillsData.js radiantjudgmentSkill and
    // skillEffects.js's hit handler) - bindChance was already rolled
    // client-side before this ever fires (this server never sees a miss,
    // same as every other hit-resolution decision in this game - see
    // enemyIsHit above). This server IS the authority for the disabled
    // window itself though: sets _disabled here and is the only thing that
    // flips it back off, via the timer below, rather than trusting any
    // client to report "time's up" (a client could lag, disconnect, or lie).
    safeOn(socket, "enemyBind", data => {
        const { targetId, shape, bindDuration, currentPlaceId } = data
        const enemyTarg = tcpEnemies.find(ene => ene._id === targetId)
        if(!enemyTarg) return log("not found enemy to bind ", targetId)

        enemyTarg._disabled = true
        io.emit("enemy-bound", { targetId, shape, bindDuration, currentPlaceId })

        // a second bind landing before this one's timer expires shouldn't
        // let THIS timer clear _disabled early once ITS shorter/earlier
        // duration runs out - only the most recent bind's own timer is
        // allowed to actually turn it back off (see enemyBindTokens above)
        const myToken = (enemyBindTokens.get(targetId) ?? 0) + 1
        enemyBindTokens.set(targetId, myToken)

        setTimeout(() => {
            if(enemyBindTokens.get(targetId) !== myToken) return // a newer bind has since taken over
            enemyBindTokens.delete(targetId)
            // may have died (and been filtered out of tcpEnemies) by now -
            // either way still broadcast enemy-unbound so every client's
            // local bind visual/timer gets cleaned up
            const stillBound = tcpEnemies.find(ene => ene._id === targetId)
            if(stillBound) stillBound._disabled = false
            io.emit("enemy-unbound", { targetId, currentPlaceId })
        }, bindDuration * 1000)
    })
    // dark magic's curse (see client's skillsData.js header comment,
    // skillEffects.js's hit handler - every dark-element skill's hit curses
    // its target, no chance roll unlike enemyBind above). Permanent for the
    // rest of the enemy's life - unlike _disabled there's no timer/un-curse
    // here, it only ever clears by the enemy dying (removed from tcpEnemies
    // entirely, and a respawn starts fresh with _cursed: false). The actual
    // damage-reflection this causes lives entirely client-side (worldsocket.js's
    // "enemy-attacked" handler) - this server only owns the persistent flag.
    safeOn(socket, "enemyCurse", data => {
        const { targetId, currentPlaceId } = data
        const enemyTarg = tcpEnemies.find(ene => ene._id === targetId)
        if(!enemyTarg) return log("not found enemy to curse ", targetId)
        if(enemyTarg._cursed) return // already cursed, nothing new to broadcast

        enemyTarg._cursed = true
        io.emit("enemy-cursed", { targetId, currentPlaceId })
    })
    safeOn(socket, 'enemyChangeTarget', data => {
        tcpEnemies.forEach(enem => {
            if(data._id === enem._id){
                enem._targetId = data.newTargetId
            }
        })
        io.emit("enemy-changedtarget", data)
    })
    safeOn(socket, "respawnEnemy", data => {
        const {maxHp, name, respawnDetails} = data
        if(respawnDetails.willRespawn === false) return
        data._id = randNumString()
        setTimeout(() => {
            tcpEnemies.push({...data,
                hp: maxHp,
                _isMoving: false,
                _targetId: undefined,
                _dirTarg: {x:0,z:0},
                _attacking: false,
                _disabled: false,
                _cursed: false,
            })
            io.emit("enemy-respawned", tcpEnemies)
        }, respawnDetails.respawnTime)
    })
    safeOn(socket, "removeEnemy", enemyId => {
        tcpEnemies = tcpEnemies.filter(enemy => enemy._id !== enemyId)
        console.log("enemy removed ", enemyId)
        console.log("tcpEnemies ", tcpEnemies.length)
        io.emit("enemy-removed", enemyId)
    })
    // A treasure chest getting opened (client's createtreasure.js, on
    // interact) - same shape as removeEnemy right above (a bare id string,
    // not an object) on purpose. Filtering here + broadcasting is naturally
    // idempotent (a second removeTreasure for an id already gone is just a
    // no-op filter and a redundant, harmless re-broadcast), which matters
    // since two players could plausibly click the same chest within the
    // same round-trip window - this doesn't resolve who "wins" server-side,
    // it just makes sure every client's scene ends up agreeing the chest is
    // gone. Client-authoritative, same trust level this whole server
    // already gives combat/loot (see enemyIsHit's own comment on misses
    // never being seen here either) - not a hardened anti-duplication lock.
    safeOn(socket, "removeTreasure", treasureId => {
        treasures = treasures.filter(treasure => treasure.itemId !== treasureId)
        console.log("treasure removed ", treasureId)
        console.log("treasures ", treasures.length)
        io.emit("treasure-removed", treasureId)
    })
    safeOn(socket, "enemyWillAttack", data => {
        const { pos } = data
        const exist = tcpEnemies.find(enem => enem._id === data._id)
        if(!exist) {
            console.log("enemyWillAttack not found ", data._id)
            return io.emit("enemy-removed", data._id)
        }
        tcpEnemies.forEach(enem => {
            if(data._id === enem._id){
                enem._targetId = data.targetId
                enem._isMoving = false
                enem._attacking = true
                enem.x = pos.x
                enem.z = pos.z
            }
        })

        // a real player's own hp lives entirely client-side (their own
        // "enemy-attacked" handler deducts it locally, gated to
        // data.targetId === their own charState.owner) - a bot has no
        // client of its own to ever satisfy that check, so nothing was
        // ever taking this damage off anywhere. The server has to be
        // authoritative for a bot's hp instead, same reasoning BOT_MAX_HP's
        // own comment gives. Pulled out into applyDamageToBot (this file's
        // own top-level function, shared with "playerIsHit" below) once a
        // second caller needed the exact same hp/death handling.
        // a bot target soaks this through whatever armour it has earned; a
        // real player target gets it back unchanged (see mitigatedBotDamage),
        // which is what makes it safe to fold into the broadcast too - and
        // worth folding in, because the client's own "enemy-attacked" handler
        // reads dmg to pick blood vs the shrugged-off clang, and that comment
        // already calls that threshold "armor/toughness".
        const dmgAfterArmor = mitigatedBotDamage(data.targetId, data.dmg)
        applyDamageToBot(data.targetId, dmgAfterArmor)

        io.emit("enemy-attacked", { ...data, dmg: dmgAfterArmor })
    })
    // coarse, throttled ping from a client's own chase loop (renderer.js,
    // emitEnemyChasePosition's own header comment) - chase movement itself
    // stays deliberately client-local/unsynced (that file's own header
    // comment on why), this just keeps tcpEnemies' x/z reasonably fresh
    // for anything that reads it BETWEEN real report moments (attacks/
    // wander/skill-casts) - bots hunting/aiming via getNearestEnemy
    // (npcBrain.ts) being the actual reason this exists (a caster bot was
    // aiming at wherever a chasing enemy last attacked FROM, not where
    // it's actually walking to right now). Not rebroadcast - every OTHER
    // client already runs this exact same chase simulation independently
    // and doesn't need correcting from someone else's report.
    safeOn(socket, "enemyChasePosition", data => {
        const enem = tcpEnemies.find(enem => enem._id === data._id)
        if(!enem) return
        enem.x = data.x
        enem.z = data.z
    })
    // openworld's terrain is uneven and enemyDetails/genenemy.ts only ever seed
    // y:0 - clients periodically verify/correct an enemy's y against the real
    // terrain height (see createEnemy.js) and report it here so tcpEnemies (and
    // therefore anyone who joins/re-syncs later) reflects the corrected height,
    // and everyone already connected gets it live via the broadcast below.
    // socket.broadcast.emit (not io.emit) deliberately excludes the sender - the
    // sender already applied this exact correction locally, synchronously, before
    // emitting. Echoing it back via io.emit would round-trip a value computed for
    // wherever the (possibly still-chasing) enemy WAS at emit time, arriving after
    // the enemy has already moved on - a guaranteed "correct, then instantly wrong
    // again" flicker on every single correction, not just an occasional race.
    safeOn(socket, "correctEnemyY", data => {
        const { _id, y } = data
        const enem = tcpEnemies.find(enem => enem._id === _id)
        if(!enem) return
        enem.y = y
        socket.broadcast.emit("enemy-y-corrected", data)
    })
    // enemy skill-casting (client/src/creations/skillEffects.js's
    // castEnemySkill/fireEnemySkillProjectile) - same plain relay pattern
    // as enemyWillAttack above: this server does no validation of its own,
    // it just stamps the enemy's current target/position and rebroadcasts
    // to everyone (including the sender). Every client decides for itself
    // whether it's the actual target and only applies damage then - see
    // that function's own comment for why that's safe even though this
    // relay trusts whichever single client emitted it.
    safeOn(socket, "enemyWillCastSkill", data => {
        const { pos } = data
        tcpEnemies.forEach(enem => {
            if(data._id === enem._id){
                enem._targetId = data.targetId
                enem.x = pos.x
                enem.z = pos.z
            }
        })
        io.emit("enemy-cast-skill", data)
    })
    safeOn(socket, "enemyAttackedRange", data => {
        tcpEnemies.forEach(enem => {
            if(data._id === enem._id){
                // enem._targetId = data.targetId
                // enem._isMoving = false
                // enem._attacking = true
            }
        })
        io.emit("enemy-attacked-range", data)
    })
    safeOn(socket, "registerPlayerAsEnemy", data => registerTargetIfNone(data._id, data.targetId, data.dirTarg))
    safeOn(socket, "enemyWillChase", data => {
        const { currentPlaceId, _id, targetId, actionType } = data
        tcpEnemies.forEach(enem => {
            
            if(_id === enem._id){
                if(enem._targetId !== targetId) return
                // enem._targetId = data.targetId //redundant
                enem._isMoving = true
                enem._attacking = false
                if(actionType === "idle"){
                    enem._isMoving = false
                    enem._attacking = true
                }
            }
        })
        io.emit("enemy-chasing", data)
    })
    // DISCONNECTIONS
    safeOn(socket, 'will-die', data => {
        const {ownerId, currentPlaceId} = data
        const theUzer = players.find(user => user.owner === ownerId)
        if(!theUzer) return log("uzer died id not found. line.147")
        if(theUzer){

            players = players.filter(user => user.owner !== ownerId)
            releaseEnemiesTargeting(ownerId)
            log("total of players after death " + players.length)
            io.emit('player-death', {ownerId: theUzer.owner, currentPlaceId})
        }
        
    })
    safeOn(socket, 'dispose', data => {
        const { owner } = data
        console.log("dispose ", data)
        // I will use owner since owner is also a unique string ID from login info
        const thePlayer = players.find(player => player.owner === owner)
        if(!thePlayer) return console.log("not found ", owner)

        removeCharacter(thePlayer.owner, thePlayer.name, thePlayer.currentPlace.placeId)
        
    })
    safeOn(socket, "disconnect", () => {
        const thePlayer = players.find(player => player.socketId === socket.id)
        if(thePlayer) {
            removeCharacter(thePlayer.owner, thePlayer.name, thePlayer.currentPlace.placeId)
        }
    })

    // enemy dodge (client/src/enemies/createEnemy.js's own 2s projectile-
    // threat check, det.canDodge - fireslime/electricslime/orangelith for
    // now) - any client watching a given enemy can independently decide it
    // should dodge (every projectile is a client-local render, not a
    // shared network entity, so there's no single "authoritative" client
    // to restrict this to the way enemyWillCastSkill restricts to the
    // closest player). Multiple clients can plausibly emit this for the
    // same enemy within the same moment since they're all watching
    // roughly the same threat - _dodgeCooldownUntil collapses those into
    // a single broadcast instead of relaying every duplicate.
    safeOn(socket, "enemyWillDodge", data => {
        const enem = tcpEnemies.find(e => e._id === data._id)
        if(!enem) return
        if(enem._disabled) return
        const now = Date.now()
        if(enem._dodgeCooldownUntil && now < enem._dodgeCooldownUntil) return
        enem._dodgeCooldownUntil = now + DODGE_COOLDOWN_MS
        io.emit("enemy-dodge", data)
    })
    // lesserdemon's own "teleport in near you instead of chasing" (see
    // genenemy.ts's lesserDemonBase, actionType "teleporting", and
    // createEnemy.js's own teleport interval) - same relay-and-stamp
    // pattern enemyWillAttack below already uses (x/z updated here too, so
    // tcpEnemies - and therefore anyone who joins/re-syncs after this -
    // reflects where it actually landed, not just live clients watching the
    // broadcast). io.emit (not socket.broadcast.emit) - unlike spawncirc
    // above, the deciding client does NOT apply this locally first; it only
    // ever moves once the broadcast round-trips back, same as every other
    // enemy position update in this game.
    safeOn(socket, "enemyWillTeleport", data => {
        const { _id, x, z } = data
        const enem = tcpEnemies.find(e => e._id === _id)
        if(!enem) return
        enem.x = x
        enem.z = z
        io.emit("enemy-teleported", data)
    })

    // setInterval(() => {

        // io.emit("add-recources", {tcpEnemies})
        // console.log("tcpEnemies ", tcpEnemies.length)
    // }, 1000)
})

// enemy wander ("scouting" - makes idle enemies walk to a nearby open spot
// on their own instead of standing frozen at their spawn point). Module-
// level, NOT inside io.on("connection", ...) above - this must run once
// total, not once per connected client (an interval placed inside the
// connection handler would duplicate itself for every player currently
// online, each one independently re-broadcasting the same wander ticks).
// Every enemy in tcpEnemies is eligible - fireslime/electricslime/
// orangelith aren't special-cased here, only dodging is skill/enemy-
// specific (see enemyWillDodge above and createEnemy.js's own det.canDodge
// gate).
const WANDER_INTERVAL_MS = 5000
const WANDER_RADIUS = 8
const WANDER_CHANCE = 0.35
const DODGE_COOLDOWN_MS = 3000
setInterval(() => {
    tcpEnemies.forEach(enem => {
        // busy fighting/chasing a player, or bound (skill.enemyBind) -
        // leave it alone, don't interrupt with a wander order
        if(enem._targetId) return
        if(enem._disabled) return
        if(Math.random() > WANDER_CHANCE) return

        // origPos (enemyInterface/generateEnemies - every enemy has one)
        // is the enemy's own spawn point, not wherever it currently is -
        // wandering stays anchored to its own territory instead of
        // drifting further and further from where it was placed over
        // successive wander ticks
        const origin = enem.origPos ?? { x: enem.x, z: enem.z }
        const angle = Math.random() * Math.PI * 2
        const radius = Math.random() * WANDER_RADIUS
        const destX = origin.x + Math.cos(angle) * radius
        const destZ = origin.z + Math.sin(angle) * radius

        // every OTHER position-changing event in this file (enemyWillAttack
        // etc.) writes its new x/z straight onto the tcpEnemies entry right
        // alongside its own broadcast - this was the one spot that only
        // ever told CLIENTS where the enemy is walking to, leaving the
        // server's own copy frozen whenever no one has fought it recently
        // (getNearestEnemy/getNearbyEnemies below read straight off this
        // same enem.x/z - a bot hunting a wild, never-yet-aggroed enemy was
        // walking to and facing wherever it spawned/last attacked from, not
        // where it actually currently is, confirmed from actual screenshots
        // of bots aimed at empty ground the enemy had long since wandered
        // away from)
        enem.x = destX
        enem.z = destZ
        io.emit("enemy-wander", { _id: enem._id, currentPlaceId: enem.currentPlaceId, x: destX, z: destZ })
    })
}, WANDER_INTERVAL_MS)

// SAFETY NET - every place that removes a player is SUPPOSED to also
// release any enemy still targeting them AND broadcast that release (see
// "will-die"/the bot-death branch in "enemyWillAttack" above, both patched
// for this after an actual report: an enemy that just killed its target
// kept replaying its running animation in place forever, since resetting
// tcpEnemies locally never told any already-connected client to actually
// stop chasing). Auditing every removal site for that is exactly the kind
// of thing that's easy to get right today and silently miss tomorrow -
// removeCharacter() (real disconnects/manual dispose) turned out to be a
// THIRD spot with the same gap (resets _targetId, never _isMoving, never
// broadcasts) while looking into this. Rather than keep patching call
// sites one at a time, this just periodically verifies every enemy's own
// _targetId still points at someone actually in `players` - self-healing
// within ENEMY_TARGET_VALIDATION_INTERVAL_MS regardless of which removal
// path (or a future one) forgot to clean up after itself.
const ENEMY_TARGET_VALIDATION_INTERVAL_MS = 5000
setInterval(() => {
    let anyReleased = false
    tcpEnemies.forEach(enem => {
        if(!enem._targetId) return
        const targetStillExists = players.some(pl => pl.owner === enem._targetId)
        if(targetStillExists) return
        enem._targetId = false
        enem._isMoving = false
        enem._attacking = false
        anyReleased = true
    })
    if(anyReleased) io.emit('registered-playerAsEnemy', tcpEnemies)
}, ENEMY_TARGET_VALIDATION_INTERVAL_MS)

// BOT PLAYERS - AI-controlled fake players (recources/npcBrain.ts's own
// Brain class), built to be indistinguishable from a real logged-in player
// to every other connected client. The trick is that nothing client-side
// needs to know a bot even exists: a bot gets pushed into `players` (the
// exact same array a real "join-world" push goes into) and gets its own
// "userJoined" broadcast (the exact same event/payload shape join-world's
// own handler above already sends) - so worldsocket.js's reCreateMeshesInScene
// picks it up and renders it via createCharacter() same as any real player.
// Movement afterward reuses "emitted-moving"/"stopped" (the exact events a
// real player's own emitmove/emitStop server handlers already broadcast) -
// so no new client-side code was needed anywhere for a bot to walk/run
// around convincingly. See this project's own package.json for the new
// "yuka" dependency (recources/npcBrain.ts) - a small, dependency-free game-
// AI library used for the actual per-tick movement (steering/arrive), not
// reimplemented here.
const MAX_BOTS = 20 // safety cap - "spawn one every 5s forever" would otherwise never stop
const BOT_SPAWN_INTERVAL_MS = 5000
// "spawn-bot-near-me" debug handler's own small random offset - far enough
// that the new bot's body doesn't spawn literally overlapping the
// requesting player's own
const BOT_BESIDE_OFFSET_DIST = 2.5
// one candidate place per entry - spawnBot() below picks one at random
// each tick, so bots gradually populate every listed place instead of only
// ever the first one. openworld's center is OPENWORLD_SLIME_TERRITORY's own
// (0, 500) (enemyDetails.ts), also the player's own openworld spawn point.
// village (placeId 1) has no equivalent server-known "center" constant
// anywhere (real players' own spawn position is authored client-side, in
// localroomdb.js, which tcp has no access to) - (0,0) with a tighter 20-unit
// radius is a reasonable village-sized guess, smaller than openworld's 40
// since a village is a much more tightly-built space (buildings/fences) a
// wide roam radius could wander a bot into.
// village center is BACK at (0,0), its true own origin - a previous fix
// moved this to (6.6,130), right on top of the only 3 village enemies, so a
// bot could actually reach them - but spawning a bot already standing next
// to its prey skips the entire point of watching it hunt. (0,0) is fine
// again now that checkCombat's own getNearestEnemy lookup (npcBrain.ts) has
// no distance cap at all - it locks onto and continuously chases ANY known
// enemy in the bot's place, no matter how far, the instant one exists, so a
// village bot spawned at (0,0) actually walks the whole ~130 units to those
// slimes in one continuous, uninterrupted trip instead of only ever
// bumbling into one by pure chance within some tighter aggro range.
const BOT_SPAWN_PLACES = [
    { placeId: 1, name: "village", areaType: "village", center: { x: 0, z: 0 }, radius: 20 },
    { placeId: 888, name: "openworld", areaType: "openworld", center: { x: 0, z: 500 }, radius: 40 },
]

// known-good values, pulled straight off real npcDetails.js entries that
// already render correctly today - NOT the full set of everything that
// exists, just a safe pool guaranteed not to 404 a missing mesh/texture.
// These are the MALE-side pool - createcharacter.js's own createAnimeBody
// only ever reads cloth/pants/skinColor as STYLE CHOICES for a male body;
// a female body has no equivalent style system at all (one fixed default
// outfit - belt/blindfold/mask/skirt/bag/silverine, always on - and no
// pants/cloth/skinColor variety), so these 3 pools are simply never
// consulted for a female bot at all, not just harmless if passed.
const BOT_HAIR = ["hair1", "hair2", "style1", "style2"]
const BOT_CLOTH = ["style1", "style2", "style3"]
const BOT_PANTS = ["style1", "style2"]
const BOT_BOOTS = ["style1", "style2"]
const BOT_SKIN = ["skin1", "skin2", "skin3", "skin4"]
// female's own hair mesh-matching (createcharacter.js's createAnimeBody)
// looks for a mesh literally named "femaile.hair1"/"female.hair2" (yes,
// "femaile" - an existing typo baked into the actual asset) and compares
// its own name.split(".")[1] against det.hair directly - "style1"/"style2"
// (the male-only entries in BOT_HAIR above) match no such mesh at all, so
// a female bot given one of those would just render bald. Hair color
// still comes from the same shared BOT_COLORS pool either way (her hair
// materials are built from det.hairColor same as male's).
const BOT_FEMALE_HAIR = ["hair1", "hair2"]
// real common-tier swordsData.js entries, hand-copied (tcp can't import
// client/src/staticRecources/swordsdata.js directly - separate node
// project) - createWeapon() needs a valid weaponType + parts shape to
// render anything at all, so these are 3 of the actual shipped common
// swords rather than invented placeholder values that might not resolve
// to real part-mesh/color names.
const BOT_SWORDS = [
    {
        name: "frostmarkblade", dn: "Frostmark Blade",
        parts: { bladeRarity: "common1", guardRarity: "common1", handleRarity: "common1", pommelRarity: "common1", bladeColor: "iron", guardColor: "sodalite", handleColor: "wood", pommelColor: "firecrystal" },
    },
    {
        name: "emberfallblade", dn: "Emberfall Blade",
        parts: { bladeRarity: "common1", guardRarity: "common1", handleRarity: "common1", pommelRarity: "common2", bladeColor: "steel", guardColor: "bronze", handleColor: "leather", pommelColor: "firecrystal" },
    },
    {
        name: "winterlaceblade", dn: "Winterlace Blade",
        parts: { bladeRarity: "common1", guardRarity: "common1", handleRarity: "common2", pommelRarity: "common1", bladeColor: "silver", guardColor: "silver", handleColor: "bone", pommelColor: "frostshard" },
    },
]
// wanderersstaff (client/src/staticRecources/swordsdata.js) - the only
// staff item that exists in the whole game right now (that file's own
// comment: "only 'wood' is modeled today, so this is the only staff that
// can exist"). A whole, undecomposed mesh (createWeapon's own
// createWholeMeshWeapon), so parts is just the one handleColor field, not
// the full blade/guard/handle/pommel shape BOT_SWORDS' own entries need.
// Every caster bot gets this instead of a sword (see buildBotItems below) -
// a staff reads as an actual caster's weapon, unlike a sword a caster-leaning
// bot would otherwise be shown carrying but never really swinging.
const BOT_STAFF = { name: "wanderersstaff", dn: "Wanderer's Staff", parts: { handleColor: "wood" } }
// Bot armour/helmet/pauldron pools used to live here. They moved to
// recources/botItems.ts when bots stopped spawning pre-equipped: that file
// is now the single catalogue, split by archetype, and is the only thing
// that hands gear out (as level-up rewards). Only the WEAPON pools above
// stay here, because a weapon is still granted at spawn.
// {r,g,b} 0-1 floats, same shape/range client/src/constants/adventurerColors.js's
// own ADVENTURER_COLORS palette already uses (a small hand-picked subset of
// it, not imported directly - tcp is a separate node project from client,
// no shared module between them)
const BOT_COLORS = [
    { r: 0, g: 0, b: 0 },
    { r: 0.5, g: 0.5, b: 0.5 },
    { r: 0.22, g: 0.13, b: 0.05 },
    { r: 0.3, g: 0.2, b: 0.1 },
    { r: 0.15, g: 0.15, b: 0.15 },
    { r: 0.42, g: 0.30, b: 0.16 },
]
const pickOne = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

// npcBrain.ts's own EnemyLike.approachX/approachZ - a stable per-bot angle
// around any enemy it ever engages, derived from its own owner id (no
// cross-bot bookkeeping needed at all: two DIFFERENT bots naturally land on
// two DIFFERENT angles just because their owner strings differ, and the
// SAME bot always gets the SAME angle every tick, so it doesn't jitter/
// re-slot mid-fight). Not perfectly evenly spaced around the circle the
// way a real formation-slot system would guarantee, but good enough to
// stop several bots sharing one target from all beelining for its exact
// center and visually merging into one mesh (confirmed from an actual
// screenshot) - the actual goal here, not a precise tactical formation.
function hashOwnerToAngle(owner: string): number {
    let hash = 0
    for(let i = 0; i < owner.length; i++) hash = (hash * 31 + owner.charCodeAt(i)) % 360
    return (hash / 360) * Math.PI * 2
}
// roughly npcBrain.ts's own MELEE_RANGE(2.5)/CAST_RANGE(10), scaled a
// little inward (~0.85-0.9x) - not imported directly (Brain deliberately
// exposes neither constant, staying a pure/standalone class), just close
// enough that a bot's approach point already sits just inside its own real
// attack range, so checkCombat's own separate range check usually confirms
// "in range" on the very next tick after arriving instead of needing a
// visible extra correction hop.
const BOT_MELEE_APPROACH_RADIUS = 2.2
const BOT_CAST_APPROACH_RADIUS = 9

// BOT SKILL VISUALS - close-distance ("melee") bots get dashstrikeSkill's
// own signature move, long-distance ("caster") bots get a real projectile
// cast instead of silently landing CAST_DMG with nothing visible. Both ride
// the exact same "skillactivated" relay a real player's own skillsui.js
// click emits (tcp/index.ts's own "activate-skill" handler above just
// rebroadcasts whatever it's handed, unchanged) - every connected client's
// attackingSystem.js activateSkill() dispatches on skill.effects' own
// effectType exactly like a real cast, so this needs no new client code at
// all. Hand-copied field-for-field from client/src/staticRecources/
// skillsData.js's own dashstrikeSkill/singlecastSkill (tcp is a separate
// node project, no shared import between them - same reasoning BOT_SWORDS'
// own comment gives) - only the fields those two skills' own cast paths
// (castDashSkill/castOffenseSkill, both in client/src/creations/
// skillEffects.js) actually read, trimmed of real-player-only bookkeeping
// (slotNumber, pointsToClaim/pointsForUpgrade, evolution, upgradePlus, desc).
//
// Every hit-detection/damage-application branch inside both cast functions
// is isCaster-gated (`charState.owner === getCharState()?.owner`) - since
// no real client's own local charState.owner is EVER a bot's `bot_<id>`
// owner string, that gate never once passes on any connected screen. Every
// client still plays the identical animation/circle/projectile/sound (that
// part runs ungated, before the isCaster check), but not one of them ever
// applies real damage from it - tcp's own dealDamage callback below stays
// the sole source of truth for that, via the same applyDamageToEnemy()
// every real player's own hit already goes through. Exactly the same
// "safe to broadcast a real skill cast for a caster with no client of its
// own" trick "player-attacked" already relies on for a bot's plain swing.
const BOT_DASH_SKILL = {
    name: "dashstrike",
    // attackingSystem.js's activateSkill() switch only actually runs
    // castDashSkill/castOffenseSkill when skillDetail.isActive is true -
    // real players get this set by skillsui.js's own click handler right
    // before it emits "activate-skill" (skill.isActive = willActivate),
    // which a hand-built object here has no equivalent of, so it has to be
    // baked in directly or the whole cast silently no-ops on every client
    isActive: true,
    lvl: 1,
    element: "normal",
    castDuration: 0,
    demand: [],
    effects: [
        { effectType: "dash", dmgPm: 0, plusDmg: 90, chance: 1, bashPower: 0.5 },
        { effectType: "critical", criticalPercent: 0.4 },
    ],
    dash: { distance: 6, impulseForce: 120, durationMs: 350 },
    animationName: "dashstrike",
    activationSound: { soundType: "blade", willPlayAfterSeconds: 200 },
    impactSound: "struckS",
    explosionColor: "red",
    explosionScale: 1,
    projectileVisual: { useProjectile: false },
}
// how long the client-side "bot-dashing" lunge (see the melee branch of
// dealDamage below) actually takes to cover BOT_DASH_SKILL.dash.distance -
// deliberately NOT that skill's own dash.durationMs (350, tuned for a REAL
// player's physics impulse). client/src/npc/duelSystem.js's own
// performOpponentDashStrike hit this exact same problem for its dashstrike-
// using npcFighters (also no physics body, just a locallyTranslate ramp)
// and found 350ms "read as barely moving at all" once nothing else was
// competing for control of the body's position - a full second is what
// that file's own comment says actually reads as a real lunge. Distance (6)
// over 1000ms works out to roughly 6x this bot's own BOT_WALK_SPEED (1) -
// a fast, obvious dash, not a subtle nudge.
const BOT_DASH_MOVE_DURATION_MS = 1000
// a POOL of real elemental basic-attack skills, one assigned per caster bot
// at spawn (so it always casts the same flavor its whole life, not a
// different random spell every attack) - previously every single caster
// bot always cast the literal same "singlecast" bolt. Hand-copied
// field-for-field from client/src/staticRecources/skillsData.js's own
// singlecast/tidalspike/stoneshard/lightningbolt/flamebrand entries, same
// trimming BOT_DASH_SKILL's own comment describes.
//
// Each entry's own name gets suffixed per-bot at emit time (see the
// dealDamage callback below), same reasoning the old single-skill version
// already needed (skillEffects.js's pendingCasts is keyed by name alone,
// shared across every caster it ever sees). That suffix is only actually
// SAFE for a skill whose projectileVisual doesn't derive any asset path
// FROM skill.name - checked each of these individually:
//  - particle (singlecast): reads particleStyles, never skill.name
//  - no shape, beam-only onHit (tidalspike): its beam/burst texture paths
//    are explicit literals, not skill.name-derived
//  - glbModel (stoneshard): model.name + material.texturePath are both
//    explicit fields, separate from skill.name
//  - weapon (lightningbolt/flamebrand): built from pv.weapon's own
//    explicit rarities/type, never skill.name
// The ONE shape that WOULD break (a bare shape:"plane" skill relying on
// the DEFAULT getGenericIconMat(scene, skill) icon-by-name lookup,
// "./images/projectiles/<skill.name>projectile.webp") is deliberately not
// in this pool.
//
// No real per-element damage-bonus wiring for bots yet (getWeaknessMultiplier,
// skillEffects.js) - a bot's actual damage stays the flat, server-computed
// CAST_DMG regardless of which element got picked here, since that
// multiplier only ever runs inside the SAME isCaster-gated block that
// never executes for a bot. This pool is purely visual variety for now.
const BOT_CAST_SKILLS = [
    {
        name: "singlecast",
        isActive: true,
        lvl: 1,
        element: "normal",
        castDuration: 3,
        demand: [],
        effects: [{ effectType: "offense", dmgPm: 0, plusCasterMagicDmg: 0.6, plusDmg: 100, chance: 1, bashPower: 0.5 }],
        explosionColor: "blue",
        explosionScale: 1,
        particleStyles: [{ name: "oneline", color: "blue" }],
        projectileVisual: { useProjectile: true, visible: true, shape: "particle", material: { kind: "none" } },
        onHitVisual: [{ type: "burst", burst: { texture: "drunkBubble", fireScale: 0.9, smokeScale: 0.7, emberEmitRate: 11, gravitySign: 1, includeSmoke: true } }],
    },
    {
        name: "tidalspike",
        isActive: true,
        lvl: 1,
        element: "water",
        castDuration: 2,
        demand: [],
        effects: [{ effectType: "offense", dmgPm: 0, plusCasterMagicDmg: 0.5, plusDmg: 70, chance: 1, bashPower: 0.3 }],
        explosionColor: "blue",
        explosionScale: 1,
        arcCount: 0,
        projectileVisual: { useProjectile: true, visible: false, material: { kind: "none" } },
        onHitVisual: [
            { type: "beam", beam: { width: 0.5, lingerMs: 3000, texturePath: "./images/particles/watercurrent.webp", scrollSpeed: 0.6, uScale: 4 }, impactSound: "waterHitS" },
            { type: "burst", burst: { texture: "splash", fireScale: 0.9, smokeScale: 0.7, emberEmitRate: 11, gravitySign: 1, includeSmoke: false } },
        ],
    },
    {
        name: "stoneshard",
        isActive: true,
        lvl: 1,
        element: "earth",
        castDuration: 2,
        demand: [],
        effects: [{ effectType: "offense", dmgPm: 0, plusCasterMagicDmg: 0.1, plusDmg: 75, chance: 1, bashPower: 0.35 }],
        explosionColor: "green",
        explosionScale: 1,
        magicCircleImg: "apt_earth",
        arcCount: 0,
        projectileVisual: {
            useProjectile: true, visible: true, shape: "glbModel",
            model: { name: "stoneshard", scale: 1 },
            copies: [{ rotation: { x: Math.PI / 2, y: 0, z: 0 } }],
            material: { kind: "texture", texturePath: "./images/modeltex/rock1.jpg" },
        },
        onHitVisual: [{ type: "burst", burst: { texture: "rockTex", fireScale: 1.2, smokeScale: 1.3, emberEmitRate: 13, gravitySign: -1, includeSmoke: true } }],
    },
    {
        name: "lightningbolt",
        isActive: true,
        lvl: 1,
        element: "lightning",
        castDuration: 2,
        demand: [],
        effects: [{ effectType: "offense", dmgPm: 0, plusCasterMagicDmg: 0.1, plusDmg: 70, chance: 1, bashPower: 0.3 }],
        explosionColor: "yellow",
        explosionScale: 1,
        arcCount: 0,
        projectileVisual: {
            useProjectile: true, visible: false, shape: "weapon",
            weapon: { type: "sword", rarities: { bladeRarity: "rare2", guardRarity: "rare1", handleRarity: "common1", pommelRarity: "common1" }, scale: 0.12 },
            copies: [{ rotation: { x: Math.PI, y: 0, z: Math.PI / 2 } }],
            material: { kind: "glow" },
            arcs: { enabled: true, weaponGlow: false, width: 0.015, updateInterval: 90 },
            launchSound: "spearS1",
            speedMult: 2,
        },
        onHitVisual: [{ type: "burst", burst: { texture: "flare3", fireScale: 0.85, smokeScale: 0.6, emberEmitRate: 10, gravitySign: 1, includeSmoke: false }, stickBriefly: true, impactSound: "electricHitS" }],
    },
    {
        name: "flamebrand",
        isActive: true,
        lvl: 1,
        element: "fire",
        castDuration: 2,
        demand: [],
        effects: [
            { effectType: "offense", dmgPm: 0, plusCasterMagicDmg: 0.1, plusDmg: 70, chance: 1, bashPower: 0.3 },
            { effectType: "burn", dmgPm: 30, duration: 4000, soundPlayPerDmg: "dmgpm" },
        ],
        explosionColor: "red",
        explosionScale: 1,
        arcCount: 0,
        projectileVisual: {
            useProjectile: true, visible: false, shape: "weapon",
            weapon: { type: "sword", rarities: { bladeRarity: "rare2", guardRarity: "rare1", handleRarity: "common1", pommelRarity: "common1" }, scale: 0.12 },
            copies: [{ rotation: { x: Math.PI, y: 0, z: Math.PI / 2 } }],
            material: { kind: "glow" },
            arcs: { enabled: true, weaponGlow: false, width: 0.015, updateInterval: 90 },
            launchSound: "spearS1",
        },
        onHitVisual: [{ type: "burst", burst: { texture: "explodeTex", fireScale: 1, smokeScale: 1, emberEmitRate: 15, gravitySign: 1, includeSmoke: false }, stickBriefly: true, impactSound: "struckS" }],
    },
]
// casterStats only ever feeds the isCaster-gated damage math inside
// castOffenseSkill (see BOT_CAST_SKILLS' own comment on why that never
// actually runs for a bot) - same default new-character shape server/
// routes/characterR.js hands a real fresh character, just so nothing
// downstream reads an unexpected undefined field
const BOT_CASTER_STATS = { weapon: 1, accuracy: 1, critical: 1, dex: 1, strength: 1, magic: 1, spd: 3.4, atkSpd: 0.9 }

// a real player starts around lifeRandomHp+1000 (server/routes/characterR.js) -
// a bot is a much lower-stakes "trash tier" fight by comparison (waterslime's
// own dmg:5, forestDeer's own dmg:40 - a deer can meaningfully hurt one over
// a real fight without this being a throwaway one-hit), not meant to survive
// a real player-scale beating
const BOT_MAX_HP = 300
// BOT PROGRESSION
// A kill no longer levels a bot outright - it grants 1 exp, and the bot
// levels when exp reaches maxExp. Each level then makes the NEXT one dearer,
// so a bot climbs quickly at first and then slows, instead of gaining a level
// per kill forever.
//
//   kill            -> exp += 1
//   exp >= maxExp   -> lvl += 1, hp/maxHp += 50, maxExp += 10, exp resets
//   lvl % 5 === 0   -> one random equipable from recources/botItems.ts
const BOT_LEVEL_UP_HP_BONUS = 50
const BOT_EXP_PER_KILL = 1
const BOT_STARTING_MAX_EXP = 5
const BOT_MAX_EXP_GROWTH = 10
// every Nth level grants gear. 5 per spec - levels 5, 10, 15, 20...
const BOT_REWARD_LEVEL_INTERVAL = 5

// BOT GOALS - see BotGoal's own type comment. Fixed per-category target +
// fixed 3-way rotation, not randomized - matches the exact shape asked
// for ({categ:"leveling", current:0, goal:5, afterGoalCateg:"minning"})
// verbatim when built for "leveling", and stays simple/predictable for
// the other two once mining/chopwood behavior actually exists to feed them.
const BOT_GOAL_TARGETS: Record<BotGoalCateg, number> = { leveling: 5, minning: 10, chopwoods: 10 }
const BOT_GOAL_NEXT_CATEG: Record<BotGoalCateg, BotGoalCateg> = { leveling: "minning", minning: "chopwoods", chopwoods: "leveling" }
function buildBotGoal(categ: BotGoalCateg): BotGoal {
    return { categ, current: 0, goal: BOT_GOAL_TARGETS[categ], afterGoalCateg: BOT_GOAL_NEXT_CATEG[categ] }
}
// same 4-class shape/expertise mapping server/models/charDetM.js's own
// characterclass field defaults to (sword/staff/pickaxe/axe, one each) -
// every bot gets all 4 entries the same way a real character does, just
// with whichever class actually matches this bot's own combat style
// (isMeleeStyle()'s exact isCaster threshold, npcBrain.ts) bumped to lvl 1
// instead of sitting at the schema's own lvl:0 default. duskrunner/
// soulmender stay at lvl 0 for every bot - neither style has an equivalent
// yet for either of those to represent.
function buildBotCharacterClass(isCaster: boolean): CharacterClass {
    return {
        warbringer: { experties: "sword", lvl: isCaster ? 0 : 1 },
        runecaller: { experties: "staff", lvl: isCaster ? 1 : 0 },
        duskrunner: { experties: "pickaxe", lvl: 0 },
        soulmender: { experties: "axe", lvl: 0 },
    }
}
// currentMood for whatever categ a bot's goal currently points at -
// "leveling" reads as actively hunting (that's the only way its own
// current progresses right now), the other two just take their own
// categ's name directly as the mood
function moodForGoalCateg(categ: BotGoalCateg): string {
    return categ === "leveling" ? "hunt" : categ
}
// how often each bot re-checks its own laziness/goal-completion (see the
// interval created per-bot in spawnBot() below)
const BOT_GOAL_CHECK_INTERVAL_MS = 30000
// how long a nap lasts before the WAKE interval ends it - same 30s asked
// for, kept as its own named constant since it's a duration being compared
// against elapsed time, a different thing from BOT_GOAL_CHECK_INTERVAL_MS
// above (how often the check itself runs) even though they happen to share
// the same value right now
const BOT_REST_DURATION_MS = 30000
// deliberately shorter than BOT_REST_DURATION_MS itself - checking on the
// same 30s cadence as the nap duration would only catch "has it been
// resting long enough" up to 30s late; a tighter check here is what keeps
// the actual wake-up reasonably close to the real 30s mark
const BOT_REST_WAKE_CHECK_INTERVAL_MS = 5000

// @faker-js/faker instead of a small hand-written pool (was 20 fixed
// fantasy-ish names - a hardcoded list this size guaranteed duplicates
// once several bots were alive together, confirmed from an actual
// screenshot: two different bots both named "Marrow" joined back to
// back, unreadable in world chat). Takes the bot's own already-chosen
// gender so the name actually matches its appearance (female characters
// have a real, working rig now - see BOT_FEMALE_HAIR's own comment -
// so there's no reason to force every bot's name through the male pool
// anymore).
// Still retries against currently-alive bots same as before: faker's own
// name pools are much bigger than the old 20-entry list, but with up to
// MAX_BOTS(20) alive at once, the birthday-paradox odds of SOME repeat
// are still real, not negligible - capped at 20 attempts (never expected
// to actually exhaust that) rather than looping forever.
function pickBotName(gender: "male" | "female"): string {
    const taken = new Set(bots.map(b => b.player.name))
    let name = faker.person.firstName(gender)
    for(let attempts = 0; taken.has(name) && attempts < 20; attempts++){
        name = faker.person.firstName(gender)
    }
    return name
}

// same "guaranteed unique, not just probably unique" reasoning
// pickBotName's own header comment gives for names - randNumString()
// (Math.random().toString().split(".")[1]) is astronomically unlikely to
// repeat, but "unlikely" isn't "impossible", and `owner` is the actual
// identity key everything (players/bots/tcpEnemies._targetId/sockets)
// keys off - a collision there would be far worse than a duplicate
// nametag. Checked against `players` (not just `bots`) since a bot's
// owner has to be unique across every kind of connected identity, not
// just other bots. Whether spawned by the periodic interval ("v") or the
// on-demand debug spawn ("g"), both funnel through this same spawnBot(),
// so both get this same guarantee for free.
function generateUniqueBotOwner(): string {
    let owner = `bot_${randNumString()}`
    while(players.some(pl => pl.owner === owner)) owner = `bot_${randNumString()}`
    return owner
}
// A bot now spawns with its WEAPON ONLY - no boots, helmet, armor or
// pauldron. Everything else is earned: recources/botItems.ts is the reward
// pool, handed out one piece at a time every BOT_REWARD_LEVEL_INTERVAL
// levels (see the level-up block in spawnBot own dealDamage callback).
//
// The weapon stays because it is the bot identity rather than loot - it
// decides whether the thing reads as a swordsman or a spellcaster, and the
// combat code assumes everyone is armed (hasWeapon feeds the attack style).
// isCaster picks a wanderersstaff instead of a random sword - a caster
// visibly carrying a sword it never really swings looked wrong once bots
// actually started casting real skills.
function buildBotItems(isCaster: boolean): any[] {
    const weaponType = isCaster ? "staff" : "sword"
    const weapon = isCaster ? BOT_STAFF : pickOne(BOT_SWORDS)
    return [
        {
            itemId: `bot-item-${randNumString()}`,
            name: weapon.name,
            dn: weapon.dn,
            itemCateg: "equipable",
            itemType: "weapon",
            weaponType,
            equipAbilities: { dmg: 14, def: 0, magicDmg: isCaster ? 12 : 0, plusStr: 0, plusDex: 0, plusInt: 0 },
            consumeAbilities: { plusHp: 0, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0 },
            equiped: true,
            soulFeed: 0,
            isEnhanceAble: true,
            enhancedLevel: 0,
            slots: [],
            durability: { current: 100, max: 100 },
            price: { coinType: "bronze", pieces: 8 },
            qnty: 1,
            rarity: "common",
            parts: weapon.parts,
        },
    ]
}

// ============================================================
// BOT PROGRESSION
// ============================================================
// Called once per confirmed kill by a bot (the isLethal branch of its own
// dealDamage callback). Owns the entire chain so there is exactly one place
// that decides how a bot grows:
//
//   +1 exp  ->  level when exp reaches maxExp  ->  +50 hp, maxExp +10
//           ->  a random equipable every 5th level
//
// A while loop rather than a single check, because a future change that
// grants more than 1 exp per kill (a boss, a bonus) could cross more than one
// threshold at once - this way that cannot silently swallow a level.
//
// Everything is broadcast, because a bot has no client of its own to report
// from: the stat changes ride on the existing "userJoined" full-state
// snapshot (bots are in `players`, which every client reads), while a gear
// reward additionally emits "equiped-item" so already-connected clients put
// the new piece on the bot they are already rendering, instead of only
// showing it to whoever joins next.
function grantBotKillExp(botPlayer: Tplayers, isCaster: boolean){
    botPlayer.exp = (botPlayer.exp ?? 0) + BOT_EXP_PER_KILL
    botPlayer.maxExp = botPlayer.maxExp ?? BOT_STARTING_MAX_EXP

    let leveledUp = false
    while(botPlayer.exp >= botPlayer.maxExp){
        // carry the remainder rather than resetting to 0, so overshoot is
        // never thrown away
        botPlayer.exp -= botPlayer.maxExp
        botPlayer.maxExp += BOT_MAX_EXP_GROWTH
        botPlayer.lvl += 1
        botPlayer.maxHp = (botPlayer.maxHp ?? BOT_MAX_HP) + BOT_LEVEL_UP_HP_BONUS
        // healed by the same amount rather than to full - levelling should
        // help mid-fight without being a free reset
        botPlayer.hp = (botPlayer.hp ?? BOT_MAX_HP) + BOT_LEVEL_UP_HP_BONUS
        leveledUp = true

        if(botPlayer.lvl % BOT_REWARD_LEVEL_INTERVAL === 0){
            grantBotLevelReward(botPlayer, isCaster)
        }
    }

    if(leveledUp){
        log(`[botLevel] ${botPlayer.name} reached lvl ${botPlayer.lvl} (hp ${botPlayer.hp}/${botPlayer.maxHp}, next at ${botPlayer.maxExp} exp)`)
    }
}

// One equipable from recources/botItems.ts, chosen off the bot's own
// archetype. Null when every slot its pool offers is already filled - a bot
// that has everything simply gets nothing rather than a duplicate it could
// never render.
//
// The bot's own level is handed down because it biases the METAL roll, not
// which item comes out: a higher level bot gets more draws against the same
// metal ladder and keeps the best, so its gear visibly improves as it
// survives instead of staying on a flat table forever.
function grantBotLevelReward(botPlayer: Tplayers, isCaster: boolean){
    const botType = botTypeFor(isCaster)
    const reward = rollBotLevelReward(botType, botPlayer.items, botPlayer.lvl)
    if(!reward) return

    botPlayer.items = [...(botPlayer.items ?? []), reward]

    // Put it on NOW for every client already rendering this bot. A client
    // that joins later gets it from the items array in the join snapshot
    // instead, so both paths are covered.
    io.emit("equiped-item", {
        ownerId: botPlayer.owner,
        itemName: reward.name,
        itemModelName: reward.modelName,
        itemModelStyle: undefined,
        itemType: reward.itemType,
        currentPlaceId: botPlayer.currentPlace.placeId,
        metalColor: reward.metalColor,
        weaponType: undefined,
        hairVisible: reward.hairVisible,
        parts: undefined,
    })

    if(reward._announce){
        log(`[botLevel] *** ${botPlayer.name} rolled a ${String(reward.rarity).toUpperCase()} ${reward.dn} at lvl ${botPlayer.lvl} ***`)
        // world chat announcement - dragonscale is 0.8% of a metal roll and
        // black is 0.2%, rare enough that it is worth everyone seeing. Reuses
        // the channel the chat system already listens on rather than inventing
        // a new event. msgType:"system" is what tells worldsocket.js to render
        // it as a plain announcement line (appendSystemMessage) instead of a
        // "name: message" chat line - this has no sender.
        io.emit("worldChatMessage", {
            name: "",
            message: `${botPlayer.name} has found a ${reward.dn}!`,
            ownerId: botPlayer.owner,
            msgType: "system",
        })
    } else {
        log(`[botLevel] ${botPlayer.name} earned ${reward.dn} at lvl ${botPlayer.lvl}`)
    }
}


// overrides lets a caller pin down exactly who/where/what instead of the
// periodic spawn interval's own fully-random pick (attitude, place, and
// position within that place's radius) - used by the "spawn-bot-near-me"
// debug handler below to drop one specific-attitude bot at one exact spot
// on demand, without duplicating everything else spawnBot already does
// (item building, Brain construction, the whole dealDamage callback, the
// join broadcast).
function spawnBot(overrides?: { attitudeName?: string, pos?: { x: number, z: number }, currentPlace?: { placeId: number, name: string, areaType: string } }) {
    if (bots.length >= MAX_BOTS) return

    const owner = generateUniqueBotOwner()
    const attitudeNames = Object.keys(ATTITUDE_PRESETS)
    const attitudeName = overrides?.attitudeName ?? pickOne(attitudeNames)
    const attitude = ATTITUDE_PRESETS[attitudeName]
    // picked ONCE per bot, same as its sword/attitude/etc below - a caster
    // bot casts the same elemental flavor its whole life, not a different
    // random spell every attack
    const castSkillTemplate = pickOne(BOT_CAST_SKILLS)
    // female characters have a real, working rig now (body + 2 hairstyles +
    // one fixed always-on outfit - see BOT_FEMALE_HAIR's own comment for
    // the full picture and why cloth/pants/skinColor don't need any
    // gender-specific handling below despite only ever mattering for
    // male). Bots only ever equip a sword + boots (buildBotItems) - never
    // helmet/gauntlet/armor/pauldron, the one category of equipment
    // actually known to clip/misalign on the female body rig (built for
    // the male body's proportions) - so that risk doesn't apply here at all.
    // faker's own SexType can also be "generic" - createcharacter.js's
    // own createAnimeBody only ever checks `det.gender === "female"`,
    // treating anything else as male regardless (isFemale = ...; if(!isFemale)
    // det.gender = "male") - normalizing here matches that same fallback
    // explicitly instead of relying on it silently
    const rawSex = faker.person.sexType()
    const gender: "male" | "female" = rawSex === "female" ? "female" : "male"

    let spawnX: number, spawnZ: number, spawnPlace: { placeId: number, name: string, areaType: string }
    if(overrides?.pos && overrides?.currentPlace){
        spawnX = overrides.pos.x
        spawnZ = overrides.pos.z
        spawnPlace = overrides.currentPlace
    } else {
        const place = pickOne(BOT_SPAWN_PLACES)
        const angle = Math.random() * Math.PI * 2
        const dist = Math.random() * place.radius
        spawnX = place.center.x + Math.cos(angle) * dist
        spawnZ = place.center.z + Math.sin(angle) * dist
        spawnPlace = { placeId: place.placeId, name: place.name, areaType: place.areaType }
    }

    // same shape/fields a real join-world push builds (see that handler
    // above) - items now include a real equipped weapon + boots + helmet
    // (buildBotItems), so hasWeapon is computed the exact same way a real
    // join already does (data.items.some(...)), not hardcoded false.
    // isCaster gates weapon (staff vs sword) and helmet (witch/magician
    // hat odds) - same attitude.weapon>0.5 threshold npcBrain.ts's own
    // isMeleeStyle() uses, must stay in sync (it's the inverse: NOT melee)
    const isCaster = attitude.weapon <= 0.5
    const botItems = buildBotItems(isCaster)
    const botPlayer: Tplayers = {
        socketId: `bot-socket-${owner}`,
        owner,
        name: pickBotName(gender),
        lvl: 1,
        gender,
        // never actually rendered for a female body (createAnimeBody's own
        // fixed-outfit branch) - harmless to keep drawing from the same
        // male-oriented pools either way, see BOT_FEMALE_HAIR's own comment
        cloth: pickOne(BOT_CLOTH),
        pants: pickOne(BOT_PANTS),
        hair: gender === "female" ? pickOne(BOT_FEMALE_HAIR) : pickOne(BOT_HAIR),
        boots: pickOne(BOT_BOOTS),
        clothColor: pickOne(BOT_COLORS) as any,
        pantsColor: pickOne(BOT_COLORS) as any,
        hairColor: pickOne(BOT_COLORS) as any,
        skinColor: pickOne(BOT_SKIN),
        race: "human",
        currentPlace: spawnPlace,
        _moving: false,
        _minning: false,
        _attacking: false,
        mode: "idle",
        pos: { x: spawnX, y: RESTING_Y, z: spawnZ },
        dirTarg: { x: spawnX, y: 0, z: spawnZ + 1 },
        items: botItems,
        skills: [],
        hasWeapon: botItems.some(itm => itm.itemType === "weapon" && itm.equiped),
        weaponBlocking: false,
        magicBlocking: false,
        IsInVulnerable: false,
        hp: BOT_MAX_HP,
        maxHp: BOT_MAX_HP,
        exp: 0,
        maxExp: BOT_STARTING_MAX_EXP,
        attitudeName,
        goal: buildBotGoal("leveling"),
        currentMood: attitudeName === "lazy" ? "rest" : moodForGoalCateg("leveling"),
        characterclass: buildBotCharacterClass(isCaster),
    }

    players.push(botPlayer)

    // The VISUAL half of a bot attack - the swing/dash/cast every client
    // actually sees - shared by both damage callbacks below.
    //
    // Split out because a bot now has two things it can hit: a world
    // enemy (hunting, or an order from its owner) and a PLAYER
    // (retaliation - see npcBrain.ts's own notifyAttackedBy). Those
    // resolve and apply damage completely differently, but they look
    // exactly the same from the outside - the same sword swing, the same
    // dashstrike flourish, the same magic circle. `landHit` is the only
    // part that differs, handed in by the caller and fired at whatever
    // delay this particular attack's own animation needs.
    //
    // liveTargetPos is debug-only (the [botAim] log below): it lets a
    // server-side aim bug be diffed directly against worldsocket.js's own
    // matching [clientBotAim] log, instead of guessing which target a
    // given cast was even aimed at.
    const performBotAttack = (
        targetId: string,
        dmgDetails: { physicalDmg: number, weaponDmg: number },
        liveTarget: { x: number, z: number } | null,
        landHit: () => void,
    ) => {
        // log(`[botAim] ${owner} pos=(${botPlayer.pos.x.toFixed(2)},${botPlayer.pos.z.toFixed(2)}) dirYaw=${(botPlayer.dirYaw ?? 0).toFixed(3)} target=${targetId} targetPos=(${liveTarget?.x.toFixed(2)},${liveTarget?.z.toFixed(2)})`)
        // createcharacter.js only ever parents a weapon mesh onto rHand
        // if mode==="fighting" AT CREATION TIME (see its own
        // det.items.forEach block) - every bot spawns with mode "idle",
        // so its weapon (sword OR staff) starts sheathed on
        // weaponSocket regardless of style. Read once here so every
        // branch below (melee's normal swing/dashstrike AND the
        // caster's own cast) shares the same equipped weapon and can
        // re-parent it onto rHand the same way.
        const equippedWeapon = botItems.find(itm => itm.itemType === "weapon" && itm.equiped)
        const weaponType = equippedWeapon?.weaponType ?? "sword"

        // Melee-style bots (attitude.weapon > 0.5 - same threshold
        // npcBrain.ts's own isMeleeStyle() uses, must stay in sync) get
        // dashstrikeSkill as their signature close-distance move;
        // everyone else gets a real long-distance projectile cast
        // instead of silently landing CAST_DMG with nothing visible -
        // see BOT_DASH_SKILL/BOT_CAST_SKILLS' own header comment for why
        // broadcasting a real "skillactivated" cast for a bot is safe
        // (never actually double-applies damage on any client).
        if(attitude.weapon > 0.5){
            // dashstrike as a rare flourish, not the bot's every swing -
            // per spec, only a ~20% roll (Math.random() > 0.8) actually
            // fires it; the other ~80% is just a plain sword/spear swing,
            // same "player-attacked" broadcast a real melee swing already
            // produces (attackingSystem.js's attack() plays whatever
            // animName rides along, AND re-parents the sword onto rHand
            // itself via its own equipSword(hasWeapon, true) call - no
            // separate re-equip step needed on this path, unlike dashstrike's).
            if(Math.random() > 0.8){
                io.emit("skillactivated", {
                    ownerId: owner,
                    // per-bot-unique name (skillEffects.js's pendingCasts is
                    // keyed by this string alone, shared across EVERY
                    // caster it ever sees - see BOT_CAST_SKILLS' own
                    // comment below for why the literal shared name is
                    // unsafe here) - dashstrike has no pendingCasts entry
                    // of its own (castDuration:0, nothing to track), so
                    // this isn't load-bearing for melee bots today, just
                    // consistent/future-proof against that ever changing
                    skill: { ...BOT_DASH_SKILL, name: `${BOT_DASH_SKILL.name}_${owner}` },
                    currentPlaceId: botPlayer.currentPlace.placeId,
                    casterStats: BOT_CASTER_STATS,
                    // re-faces the caster ONE more time, client-side, in the
                    // exact same synchronous "skillactivated" handler that's
                    // about to read the body's facing to aim the cast - a
                    // plain angle now (dirYaw), not a dirTarg point - see
                    // BotMoveCallback's own header comment (npcBrain.ts)
                    // for why a point silently breaks once this bot's
                    // client-rendered position has drifted from what the
                    // server believes it is
                    dirYaw: botPlayer.dirYaw,
                    botTcpPos: botPlayer.pos,
                    // debug only - lets worldsocket.js's own matching
                    // [clientBotAim] log reference the EXACT same
                    // target/position this tick's own [botAim] server
                    // log just printed, so the two can be diffed
                    // side by side instead of guessing which enemy a
                    // given cast was even aimed at
                    debugTargetId: targetId,
                    debugTargetPos: liveTarget ? { x: liveTarget.x, z: liveTarget.z } : null,
                })
                // dashstrikeSkill's own real castDashSkill is entirely
                // PLAYER-shaped (physics impulse/isCaster-gated), which is
                // why it never visibly moves a bot on anyone's screen - same
                // reason client/src/npc/duelSystem.js's own dashstrike-using
                // npcFighters don't reuse it either, and instead run their
                // OWN dedicated locallyTranslate ramp (performOpponentDashStrike).
                // "bot-dashing" is that same idea, broadcast so every
                // client's own renderer.js can run that exact ramp locally
                // against this bot's body - see BOT_DASH_MOVE_DURATION_MS's
                // own comment for why 1000ms (not dashstrikeSkill's own
                // 350ms) is what actually reads as a real lunge.
                io.emit("bot-dashing", {
                    ownerId: owner,
                    distance: BOT_DASH_SKILL.dash.distance,
                    durationMs: BOT_DASH_MOVE_DURATION_MS,
                    // real weapon data (same fields createcharacter.js's own
                    // det.items.forEach block reads at creation time) so the
                    // client's own "bot-dashing" handler can re-parent the
                    // ALREADY-CREATED sword mesh onto rHand, same as a real
                    // player's attack() call already does on every swing
                    weaponName: equippedWeapon?.name,
                    parts: equippedWeapon?.parts,
                    weaponType: equippedWeapon?.weaponType,
                    metalColor: equippedWeapon?.metalColor,
                    botTcpPos: botPlayer.pos
                })
                // damage lands once the dash has had time to actually reach
                // the target, same reasoning performOpponentDashStrike's own
                // delayed hit gives (duelSystem.js) - instant would land
                // before the lunge itself has even visibly finished
                setTimeout(landHit, BOT_DASH_MOVE_DURATION_MS)
            } else {
                const animPool = weaponType === "spear" ? ["spearattack1", "spearattack2"] : ["swordattack1", "swordattack2"]
                io.emit("player-attacked", {
                    owner,
                    pos: botPlayer.pos,
                    dirTarg: botPlayer.dirTarg,
                    dmgDetails: { physicalDmg: dmgDetails.physicalDmg, weaponDmg: dmgDetails.weaponDmg, magicDmg: 0, accuracy: 1 },
                    hasWeapon: equippedWeapon?.name ?? false,
                    isMissed: false,
                    weaponType,
                    currentPlaceId: botPlayer.currentPlace.placeId,
                    atkSpd: 0.2,
                    animName: pickOne(animPool),
                })
                landHit()
            }
        } else {
            io.emit("skillactivated", {
                ownerId: owner,
                // MUST be unique per bot, not the shared literal
                // "singlecast" - castOffenseSkill's own
                // cancelPendingCast(skill.name) call cancels whatever
                // OTHER cast (any caster, bot or real player) currently
                // owns that exact name in skillEffects.js's pendingCasts
                // map (keyed by name alone, see its own header comment -
                // built for one player's own multiple DIFFERENT skills
                // staying pending at once, never for two DIFFERENT
                // casters sharing one identical name). With every
                // caster bot sending the literal "singlecast", any two
                // whose 3-second cast windows overlapped were silently
                // cancelling each other's still-charging cast before
                // its bolt ever fired - confirmed from an actual
                // screenshot (several magic circles blooming with none
                // of them clearly landing a correctly-aimed shot).
                // Nothing else keys off the literal name (every cast
                // dispatch/visual reads skill.effects/projectileVisual,
                // not skill.name), so suffixing it is fully safe.
                skill: { ...castSkillTemplate, name: `${castSkillTemplate.name}_${owner}` },
                currentPlaceId: botPlayer.currentPlace.placeId,
                casterStats: BOT_CASTER_STATS,
                // see the melee branch's own identical field above - same
                // "re-face right before this exact cast reads the body's
                // rotation" fix, now a plain angle instead of a point
                dirYaw: botPlayer.dirYaw,
                botTcpPos: botPlayer.pos,
                // re-parents the caster's own staff onto rHand, same
                // "createcharacter.js only equips onto rHand if
                // mode==='fighting' at CREATION time" gap the melee
                // branch's own bot-dashing payload already fixes for a
                // sword - a caster's mode is "casting", never
                // "fighting", so its staff would otherwise stay
                // sheathed on its back forever, never actually held
                // while casting
                weaponName: equippedWeapon?.name,
                parts: equippedWeapon?.parts,
                weaponType: equippedWeapon?.weaponType,
                metalColor: equippedWeapon?.metalColor,
                // debug only - see the melee branch's own identical
                // fields above for what this is for
                debugTargetId: targetId,
                debugTargetPos: liveTarget ? { x: liveTarget.x, z: liveTarget.z } : null,
            })
            // castSkillTemplate.castDuration (seconds) is how long every
            // client's own castOffenseSkill sits on the magic circle
            // before it actually looses the bolt - landing the real
            // damage on that same delay (instead of instantly, like
            // melee above) is what keeps the enemy's hp bar dropping
            // roughly in sync with the bolt's own visible impact
            // instead of several seconds before any client even shows
            // an explosion. Per-skill now (2-3s depending which one this
            // bot got assigned), not a single hardcoded value.
            setTimeout(landHit, castSkillTemplate.castDuration * 1000)
        }
    }

    const brain = new Brain(attitude, { x: spawnX, z: spawnZ }, (pos, dirYaw, mode, moving) => {
        // botPlayer.pos kept in sync server-side (Brain's own internal
        // tracking, useful if anything else ever wants "where does the
        // server think this bot is"), but deliberately NOT sent to
        // clients below anymore - see the emit comment just under this
        botPlayer.pos = pos
        botPlayer.dirYaw = dirYaw
        botPlayer.mode = mode
        botPlayer._moving = moving
        // like npc/enemy movement now, not the real-player snap-to-exact-
        // position model this used to copy: clients get told y/direction/
        // moving and do their OWN per-frame body.locallyTranslate()
        // stepping (renderer.js's own new bot-movement branch), the same
        // way enemy wander/chase already works, instead of the server
        // computing and broadcasting an exact x/z every single tick. x/z
        // is deliberately left OUT of this payload - a real player's
        // "emitted-moving"/"stopped" still carry it (their own client is
        // the position authority), a bot's shouldn't (Brain is the
        // authority for gameplay decisions like combat range, but the
        // VISUAL position is now each client's own local simulation, same
        // trust level enemy movement already runs on).
        //
        // dirYaw (a plain angle), NOT the old dirTarg point - see
        // BotMoveCallback's own header comment (npcBrain.ts) for why a
        // point-based facing target silently breaks the moment a bot's
        // client-rendered position drifts from what THIS server believes
        // it is (confirmed via live matching server/client console logs).
        // worldsocket.js's own "bot-moving"/"bot-stopped" apply this
        // directly via Quaternion.RotationAxis, no lookAt/position involved.
        //
        // SERVANTS - x/z resync, servant-only. Combat tolerates the pure
        // dead-reckoning this payload otherwise relies on because an enemy
        // barely moves AND every attack (every 1.8-3.2s) already sends a
        // one-off botTcpPos snap (the caster/melee dealDamage callbacks
        // below) that periodically corrects any drift. Following has
        // neither: the owner moves continuously and faster than an enemy
        // ever does, and pure escorting throws no attack event to ever
        // snap from - so with no correction at all, client-rendered drift
        // from this server's own actual vehicle.position accumulates
        // completely unchecked. Confirmed from an actual report: a
        // followed bot looked correct for the first 10-30s, then visibly
        // "ran off to nowhere" - it was still correctly chasing the owner
        // server-side the whole time, just rendered from a position that
        // had drifted far enough from reality that its own path no longer
        // looked like "toward the owner" on screen. Riding this existing
        // broadcast (not a new one) is enough on its own - onMove already
        // fires roughly every MOVE_TICK_MS (120ms) while a bot is actively
        // chasing (npcBrain.ts's own tickMove), so a servant bot gets
        // resynced far more often than combat's own once-per-attack snap
        // ever needed to.
        const servantPos = botPlayer.servantOfOwnerId ? { x: pos.x, z: pos.z } : undefined
        io.emit(moving ? "bot-moving" : "bot-stopped", { ownerId: owner, y: pos.y, dirYaw, mode, pos: servantPos })
    }, {
        // tcpEnemies' own x/z is only refreshed at specific moments (an
        // attack/skill-cast/teleport landing - see enemyWillAttack et al
        // above), NOT continuously while an enemy is simply chasing someone
        // else - so a bot's own view of "where is that enemy right now" can
        // be up to a few seconds stale for an enemy mid-chase. Re-queried
        // fresh every COMBAT_CHECK_MS (npcBrain.ts) rather than cached, so
        // it self-corrects the moment any newer position lands, and is
        // close enough in practice for a bot to walk into range and fight -
        // not pixel-precise tracking, just "good enough to find and reach it".
        //
        // no radius cap at all - this single lookup powers BOTH target
        // acquisition and the ongoing chase (npcBrain.ts's checkCombat), so
        // a bot spawned nowhere near any enemy still locks onto and walks
        // the whole distance to the nearest one instead of only ever
        // finding one by pure chance within some tighter aggro range.
        getNearestEnemy: (x, z) => {
            let closest: { _id: string, x: number, z: number, hp: number } | null = null
            let closestDistSq = Infinity
            tcpEnemies
                .filter(enem => enem.currentPlaceId === botPlayer.currentPlace.placeId && !enem._disabled)
                .forEach(enem => {
                    const distSq = (enem.x - x) ** 2 + (enem.z - z) ** 2
                    if(distSq < closestDistSq){
                        closestDistSq = distSq
                        closest = { _id: enem._id, x: enem.x, z: enem.z, hp: enem.hp }
                    }
                })
            if(!closest) return null
            // approachX/approachZ - see hashOwnerToAngle's own header
            // comment for why this alone is enough to spread several bots
            // sharing one target into a rough ring instead of all
            // beelining for its exact center
            const angle = hashOwnerToAngle(owner)
            const approachRadius = attitude.weapon > 0.5 ? BOT_MELEE_APPROACH_RADIUS : BOT_CAST_APPROACH_RADIUS
            const foundClosest = closest
            return {
                ...foundClosest,
                approachX: foundClosest.x + Math.cos(angle) * approachRadius,
                approachZ: foundClosest.z + Math.sin(angle) * approachRadius,
            }
        },
        // hunting, and orders from an owner - a bot-dealt hit on a world
        // enemy is real, server-tracked damage through the same
        // applyDamageToEnemy() every real player's own "enemyIsHit" handler
        // already goes through, so it can actually kill and is consistent
        // for every connected client, not a bot-only illusion
        dealDamage: (targetId, dmgDetails) => {
            const liveTarget = tcpEnemies.find(enem => enem._id === targetId)
            performBotAttack(targetId, dmgDetails, liveTarget ? { x: liveTarget.x, z: liveTarget.z } : null, () => {
                // an enemy with no target yet doesn't otherwise notice a bot
                // at all (see registerTargetIfNone's own header comment - a
                // bot has no client of its own to run the real atkDetection
                // proximity trigger real players register through). Landing
                // a hit is the closest available stand-in for "is now
                // engaging this enemy up close" - won't steal a target away
                // from whoever the enemy is already fighting, same guard the
                // real player path already enforces.
                const isLethal = applyDamageToEnemy({
                    targetId,
                    dmgDetails,
                    playerId: owner,
                    currentPlaceId: botPlayer.currentPlace.placeId,
                    isPhysical: attitude.weapon > 0.5,
                })
                registerTargetIfNone(targetId, owner, botPlayer.pos)

                // A kill grants EXP, it no longer levels the bot outright.
                // grantBotKillExp owns the whole progression (exp -> level ->
                // hp -> gear reward) and broadcasts whatever changed.
                if(isLethal){
                    grantBotKillExp(botPlayer, isCaster)
                    // the only real progress signal a "leveling" goal has
                    // right now - "minning"/"chopwoods" have no equivalent
                    // yet since bots do not actually do either of those
                    if(botPlayer.goal?.categ === "leveling") botPlayer.goal.current += 1
                }
            })
        },
        // ONE specific enemy by id - what an ORDERED target is tracked by
        // (npcBrain.ts's own commandAttack/fightCommandedTarget). Returning
        // null once it stops resolving is exactly how "the target died" is
        // detected there, so the _disabled/place filters matter: a servant
        // should come back to its owner when its quarry is gone for ANY
        // reason, not just a killing blow.
        getEnemyById: (id: string) => {
            const enem = tcpEnemies.find(e => e._id === id && !e._disabled && e.currentPlaceId === botPlayer.currentPlace.placeId)
            if(!enem) return null
            // same per-bot approach offset getNearestEnemy applies, so
            // several servants sent at one enemy still ring it instead of
            // stacking on its exact center
            const angle = hashOwnerToAngle(owner)
            const approachRadius = attitude.weapon > 0.5 ? BOT_MELEE_APPROACH_RADIUS : BOT_CAST_APPROACH_RADIUS
            return {
                _id: enem._id, x: enem.x, z: enem.z, hp: enem.hp,
                approachX: enem.x + Math.cos(angle) * approachRadius,
                approachZ: enem.z + Math.sin(angle) * approachRadius,
            }
        },
        // RETALIATION - hitting a PLAYER back (npcBrain.ts's fightAttacker).
        // A completely different damage path from an enemy's: a real
        // player's hp is not tracked here at all (see the "enemy-attacked"
        // handler's own comment on that convention), so the BROADCAST is the
        // damage - their own client applies it on receiving this, exactly
        // the way it already does for a hit from another player.
        dealDamageToPlayer: (targetOwnerId, dmgDetails) => {
            const victim = players.find(pl => pl.owner === targetOwnerId)
            performBotAttack(targetOwnerId, dmgDetails, victim ? { x: victim.pos.x, z: victim.pos.z } : null, () => {
                // the victim being ANOTHER BOT cannot arise from retaliation
                // alone (a bot only ever swings at an enemy, or at whoever
                // hit it first - nothing makes one open on another), but it
                // is handled rather than assumed away: both of these no-op
                // cleanly on a real player, so this one path stays correct
                // either way.
                const dmgToApply = mitigatedBotDamage(targetOwnerId, dmgDetails.physicalDmg)
                applyDamageToBot(targetOwnerId, dmgToApply)
                // ...and a bot that got hit fights back like anything else
                bots.find(b => b.player.owner === targetOwnerId)?.brain.notifyAttackedBy(owner)

                io.emit("player-is-hit", {
                    playerId: owner,
                    targetId: targetOwnerId,
                    currentPlaceId: botPlayer.currentPlace.placeId,
                    dmgToApply,
                    dmgDetails: { ...dmgDetails, magicDmg: 0, accuracy: 1 },
                    isPhysical: attitude.weapon > 0.5,
                })
            })
        },
        // servant-following (npcBrain.ts's own setFollowOwner/followOwner) -
        // reads the SAME live players[].pos every real player's own
        // emitmove/emitStop handler already keeps fresh (up to ~20Hz while
        // moving, exact on stop - see those handlers above), no new
        // position-tracking needed. Returns null if the owner isn't even
        // connected right now (disconnected, or - can't actually happen,
        // but defensively covered anyway - somehow still mid-join) so
        // Brain's own followOwner() has a clean "nothing to walk toward,
        // just hold still" signal instead of chasing a stale/undefined spot.
        getOwnerPos: (ownerId: string) => {
            const ownerPlayer = players.find(pl => pl.owner === ownerId)
            return ownerPlayer ? { x: ownerPlayer.pos.x, z: ownerPlayer.pos.z } : null
        },
    }, botItems.some(itm => itm.itemType === "weapon" && itm.equiped))

    // when this bot's CURRENT rest started (Date.now(), not a duration) -
    // null whenever it isn't resting. Closure-scoped like lastAttackAt/etc
    // elsewhere in this codebase rather than a Tplayers field - nothing
    // outside this function's own two intervals below needs to read it.
    let restStartedAt: number | null = null

    // GOAL interval - every 30s, decides what to do NEXT only while NOT
    // currently resting (a resting bot is entirely the wake-interval's own
    // job below, this one just leaves it alone until it's active again) -
    // checks if this bot is the lazy preset (always naps when checked, no
    // probability roll - kept simple for this first pass) and, if not,
    // whether its current goal is done (advance to afterGoalCateg's own
    // fixed target if so).
    const goalInterval = setInterval(() => {
        if(botPlayer.currentMood === "rest") return

        if(botPlayer.attitudeName === "lazy"){
            // stops the Brain fully in place (see its own pause() comment
            // for why nothing about the interrupted hunt/wander is kept) -
            // Brain itself has no idea what "resting" even means, so the
            // actual mode/visual broadcast happens here, not inside pause()
            brain.pause()
            botPlayer.currentMood = "rest"
            botPlayer.mode = "resting"
            botPlayer._moving = false
            restStartedAt = Date.now()
            io.emit("bot-stopped", { ownerId: owner, y: botPlayer.pos.y, dirYaw: botPlayer.dirYaw ?? 0, mode: "resting" })
            return
        }

        if(botPlayer.goal && botPlayer.goal.current >= botPlayer.goal.goal){
            botPlayer.goal = buildBotGoal(botPlayer.goal.afterGoalCateg)
        }
        if(botPlayer.goal) botPlayer.currentMood = moodForGoalCateg(botPlayer.goal.categ)
    }, BOT_GOAL_CHECK_INTERVAL_MS)

    // WAKE interval - the other half of the nap cycle: checks (on its own,
    // shorter cadence, so the 30s threshold below is caught with decent
    // precision instead of waiting for goalInterval's own next 30s tick)
    // whether this bot has been resting for over BOT_REST_DURATION_MS, and
    // if so, ends the nap and hands control back to whatever its goal
    // actually is. A "lazy" bot's own attitudeName never changes, so
    // goalInterval's very next 30s check will just send it right back to
    // sleep again - the two intervals together are what actually produces
    // a periodic "naps, wakes, potters around, naps again" cycle instead
    // of either "always resting forever" or "never resting at all".
    const wakeInterval = setInterval(() => {
        if(botPlayer.currentMood !== "rest" || restStartedAt === null) return
        if(Date.now() - restStartedAt < BOT_REST_DURATION_MS) return

        restStartedAt = null
        brain.resume()
        // no broadcast needed here - resume() restarts Brain's own timers,
        // and its very next think()/tickMove() tick reports a fresh mode/
        // position through the normal onMove callback same as it always does
        if(botPlayer.goal) botPlayer.currentMood = moodForGoalCateg(botPlayer.goal.categ)
    }, BOT_REST_WAKE_CHECK_INTERVAL_MS)

    bots.push({ player: botPlayer, brain, goalInterval, wakeInterval })

    // same broadcast shape join-world's own handler sends above - a bot
    // "joining" has to look identical to a real one for every connected
    // client's reCreateMeshesInScene to pick it up and render it through
    // the exact same createCharacter() path. isBot:true is the one extra
    // field a real join never sends - worldsocket.js's own "userJoined"
    // handler uses it to world-chat-announce a bot spawn ("Name has
    // joined") without also doing that for a real player's own join-world
    // (which fires on every PLACE CHANGE too, not just first login - that
    // would announce every door a real player walks through).
    io.emit("userJoined", {
        currentPlaceId: botPlayer.currentPlace.placeId, newPlayerName: botPlayer.name, isBot: true,
        players, placesMD, tcpEnemies, quests,
        treasures, bonfires, struckWeapons,
        weather: getWeatherState()
    })
}

setInterval(() => {
    if (!spawnBotsEnabled) return
    spawnBot()
}, BOT_SPAWN_INTERVAL_MS)

// World weather clock. Module-level (not inside io.on("connection")) so it
// ticks once for the whole server rather than once per connected socket -
// same placement reasoning the bot-spawn interval above already follows.
// Broadcast carries only the NAME; every client maps that to an ambient
// temperature through its own constants/weather.js copy.
setInterval(() => {
    const rolled = rollWeather()
    log(`[weather] rolled -> ${rolled}`)
    io.emit("weather-changed", getWeatherState())
}, WEATHER_ROLL_INTERVAL_MS)

// pushes each live bot's own place's latest obstaclesByPlace snapshot into
// its Brain - a bit slower than botSensor.js's own 4s report cadence, no
// need to sync more often than the underlying data actually changes.
// bots.length && guards the (very cheap either way) no-op case of nobody
// having spawned any bots yet.
const OBSTACLE_SYNC_INTERVAL_MS = 5000
setInterval(() => {
    if(!bots.length) return
    bots.forEach(({ player, brain }) => {
        brain.updateObstacles(obstaclesByPlace[player.currentPlace.placeId] ?? [])
    })
}, OBSTACLE_SYNC_INTERVAL_MS)

// dynamic slime spawning (openworld, placeId 888) - tops territory back up
// near whichever players actually wander into an empty pocket of it,
// instead of pre-building the whole 0-1000-unit OPENWORLD_SLIME_TERRITORY
// upfront (see enemyDetails.ts's own much sparser 50/50 fireslime/
// electricslime counts now, down from an initial 250/250). Module-level,
// same reasoning as the wander interval above it - runs once total, not
// once per connection.
const SLIME_SPAWN_CHECK_INTERVAL_MS = 500
// how far from the player the new slime actually lands - never right on
// top of them, same "ring" scatter (random angle, min/max radius) every
// other spawn in this game already uses
const SLIME_SPAWN_DIST_MIN = 15
const SLIME_SPAWN_DIST_MAX = 25
// "no enemy near me (20-30 distance)" - was 25, exactly equal to
// SLIME_SPAWN_DIST_MAX above, i.e. zero safety margin: a slime that
// happened to land right near the far edge of its own spawn band (up to
// 25 out) sat exactly on the "still counts as covered" boundary, so any
// player movement at all before the NEXT check (every
// SLIME_SPAWN_CHECK_INTERVAL_MS, now 1s) could push it back outside 25 and
// re-trigger another spawn - repeatedly, since each freshly-spawned slime
// has the same chance of landing near ITS OWN edge too. This was the
// actual cause of slimes piling up into visible stacks: not a single
// runaway loop, but this same near-miss happening again every second.
// Comfortably larger than SLIME_SPAWN_DIST_MAX now (not equal to it) so
// anything this interval just spawned reliably still reads as "covered"
// on the very next check even after a second of player movement.
const SLIME_SPAWN_NEARBY_RADIUS = 40
// band-matched to the PLAYER's own current distance from center, using the
// exact same OPENWORLD_ENEMY_BANDS table the static population
// (enemyDetails.ts) was built from - NOT a uniform random pick across every
// type regardless of where the player actually is, which is what this used
// to do (a flat SLIME_SPAWN_GENERATORS array, one random element per tick).
// That was the actual bug behind seeing the wrong monsters near spawn: the
// static rings were always correctly banded, but this dynamic top-up - the
// thing that keeps the world populated as players roam/kill things, and
// which runs far more often (every 500ms, per player) than the one-time
// static build - could spawn a darkslime or monolith 15-25 units from a
// player standing right in waterslime's own 100-150 band, since it never
// checked distance-from-center at all, only "is this player somewhere in
// the whole 0-3000 territory." Now it looks up whichever band the player's
// own distFromCenter actually falls into and only ever tops up with THAT
// type - a player in waterslime's band gets more waterslime, nothing else.
setInterval(() => {
    players.forEach(player => {
        if(player.currentPlace?.placeId !== 888) return
        if(!player.pos) return

        const { center, minDist, maxDist } = OPENWORLD_SLIME_TERRITORY
        const distFromCenter = Math.hypot(player.pos.x - center.x, player.pos.z - center.z)
        if(distFromCenter < minDist || distFromCenter > maxDist) return

        // self-throttling by construction - once a spawned slime is close
        // enough to count as "nearby" (including the one just spawned a
        // moment ago, synchronously already in tcpEnemies by the next
        // tick), this stops firing for this player on its own, no extra
        // per-player cooldown bookkeeping needed
        const hasNearbyEnemy = tcpEnemies.some(enem =>
            enem.currentPlaceId === 888 &&
            Math.hypot(enem.x - player.pos.x, enem.z - player.pos.z) <= SLIME_SPAWN_NEARBY_RADIUS
        )
        if(hasNearbyEnemy) return

        const band = OPENWORLD_ENEMY_BANDS.find(b => distFromCenter >= b.minDist && distFromCenter <= b.maxDist)
        if(!band) return // between two bands (shouldn't happen, they're contiguous) or past the outermost one

        const [newSlime] = band.generator(1, 888, 100, "ring", player.pos.x, player.pos.z, SLIME_SPAWN_DIST_MIN, SLIME_SPAWN_DIST_MAX)
        ;(newSlime as any).territory = OPENWORLD_SLIME_TERRITORY
        newSlime._id = randNumString()
        newSlime.respawnDetails = {
            willRespawn: false,
            respawnTime: 100,
        }
        tcpEnemies.push(newSlime as any)
        io.emit("enemy-respawned", tcpEnemies)
    })
}, SLIME_SPAWN_CHECK_INTERVAL_MS)

// enemyLengthsInPlace quota top-up (placeId 1's own waterslime/fireslime
// counts, see the top of this file) - a flat "keep at least `length` of
// `name` alive in `placeId`" check, distinct from the openworld interval
// right above it (that one tops up based on PLAYER PROXIMITY, this one just
// tracks a raw population floor per place regardless of where anyone is
// standing - village slimes don't need a player nearby to justify existing).
// generateEnemies (genenemy.ts) already assigns each generated enemy its own
// random _id - no need to roll one here separately.
const ENEMY_QUOTA_CHECK_INTERVAL_MS = 10 * 1000
const ENEMY_GENERATOR_BY_NAME: Record<string, typeof generateSlimes> = {
    waterslime: generateSlimes,
    fireslime: generateFireSlimes,
    electricslime: generateElectricSlimes,
    darkslime: generateDarkSlimes,
    orangelith: generateMonoliths,
    lesserdemon: generateLesserDemons,
}
setInterval(() => {
    enemyLengthsInPlace.forEach(quota => {
        const generator = ENEMY_GENERATOR_BY_NAME[quota.name]
        if(!generator){
            console.warn(`[enemyQuota] no generator registered for "${quota.name}" - skipping`)
            return
        }

        const currentCount = tcpEnemies.filter(enem =>
            enem.currentPlaceId === quota.placeId && enem.name === quota.name
        ).length
        const shortfall = quota.length - currentCount
        if(shortfall <= 0) return

        // centered on world origin (0, 0), not OPENWORLD_SLIME_TERRITORY's
        // own (0, 500) - enemyLengthsInPlace is village/placeId-anchored
        // areas, not the openworld territory the interval above already owns
        const newEnemies = generator(shortfall, quota.placeId, quota.placeWidth, quota.areaType, 0, 0, 0, 0)
        tcpEnemies.push(...(newEnemies as any[]))
        io.emit("enemy-respawned", tcpEnemies)
    })
}, ENEMY_QUOTA_CHECK_INTERVAL_MS)



function removeCharacter(ownerId: string, playerName: string, placeId: number){
    log(playerName , " disconnecting ... ")
    players = players.filter(plyr => plyr.owner !== ownerId)
    tcpEnemies.forEach(enem => {
        if(enem._targetId === ownerId){
            enem._targetId = false
        }
    })
    releaseServantsOf(ownerId)

    log("total of players after disconnect " + players.length)

    io.emit('removeChar', { ownerId, playerName, placeId })
}
server.listen(PORT, () => log("TCP server is on port", PORT))


// If you are planning to create a room
    // socket.on('join-room', (roomId) => {
    //     socket.join(roomId);
    //     socket.to(roomId).emit('player-joined', { id: socket.id });
    // });

    // socket.on('game-move', (data) => {
    //     socket.to(data.roomId).emit('opponent-moved', data.move);
    // });