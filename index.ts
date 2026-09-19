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
import { createWagon, WAGON_HEADINGS, createHarnessDeer, Tharnessdeer, Twagon } from "./recources/wagons"
import { Brain, ATTITUDE_PRESETS, RESTING_Y } from "./recources/npcBrain"

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
    IsInVulnerable: boolean
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
let bots: { player: Tplayers, brain: Brain }[] = []
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
// wagons is now the FOLLOWER array (recources/wagons.ts's own header
// comment on the flip) - each entry only references which harness deer
// pulls it via deerId, no movement law of its own. Never removed once
// placed (same permanence as bonfires above). Starts EMPTY, not
// pre-populated - the staggered startup sequence below fills this in one
// heading at a time instead of all 4 appearing the instant the server boots.
let wagons: Twagon[] = []
// harness deer - the primary/driving entity of the pairing now, one per
// wagon. Same permanence as wagons above. Also starts EMPTY, same reasoning.
let harnessDeer: Tharnessdeer[] = []

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

// the ONE place enemy hp actually gets mutated - originally inline inside
// the "enemyIsHit" socket handler below, pulled out so recources/npcBrain.ts's
// own bot combat (BOT PLAYERS block further down) can deal REAL damage
// through the exact same path a real player's own hit already does,
// instead of a second, easy-to-drift-out-of-sync copy of this logic.
// data shape matches whatever a real emitEnemyIsHit() call already sends
// ({targetId, dmgDetails, playerId, currentPlaceId, isPhysical, ...}) - a
// bot-dealt hit just builds that same shape with its own owner id as
// playerId (see performBotAttack further down).
function applyDamageToEnemy(data: any) {
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
        return log("not found enemy to be damaged, told the client to clean up its own ghost - ", targetId)
    }
    const dmgToApply = dmgDetails.weaponDmg ? dmgDetails.weaponDmg : dmgDetails.physicalDmg
    enemyTarg.hp -= dmgToApply
    if(enemyTarg.hp <= 0) tcpEnemies = tcpEnemies.filter(enemy => enemy._id !== targetId)
    console.log(`enemy hp ${enemyTarg.hp} / ${enemyTarg.maxHp}`)
    // {...data, ...} is what carries a hit weapon's own effectsWhenHit
    // (client's characterstate.js dealDamageToEnemy, e.g. the Majestic
    // Sword's burn - npcDetails.js item data) all the way back to every
    // connected client's own enemyIsHit() (createEnemy.js), which is
    // what actually starts the burn tick/particles - already just rides
    // along for free with everything else in data, no explicit
    // destructuring/whitelisting needed here.
    io.emit("enemy-is-hit", {...data, dmgToApply, hp: enemyTarg.hp, maxHp: enemyTarg.maxHp})
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

        console.log(players)
        io.emit("userJoined", { currentPlaceId: data.currentPlace.placeId, newPlayerName: data.name,
            players, placesMD, tcpEnemies, quests,
            treasures, bonfires, wagons, harnessDeer, struckWeapons
        }) // always send the updated players count
    })

    // client's inputMovement.js "v" debug key - flips the module-level
    // spawnBotsEnabled flag the BOT PLAYERS block's own setInterval (further
    // down this file) checks every BOT_SPAWN_INTERVAL_MS. No payload/state
    // to store per-player, so this is the simplest possible relay shape
    // (compare emitCraftBonfire/emitRemoveTreasure above) - toggled by
    // whichever connected client presses "v", affects every bot spawned
    // from then on, not scoped to that one player.
    safeOn(socket, "toggle-spawn-bots", () => {
        spawnBotsEnabled = !spawnBotsEnabled
        console.log(`[bots] spawning ${spawnBotsEnabled ? "ENABLED" : "disabled"}`)
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
    safeOn(socket, "enemyIsHit", data => applyDamageToEnemy(data))
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
        io.emit("enemy-attacked", data)
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
    safeOn(socket, "registerPlayerAsEnemy", data => {
        tcpEnemies.forEach(enem => {
            if(data._id === enem._id){
                console.log("confirm enemy exist")
                if(enem._targetId) return console.log("enemy already has target ", enem._targetId)

                enem._targetId = data.targetId
                enem._dirTarg = data.dirTarg
            }
        })
        io.emit("registered-playerAsEnemy", tcpEnemies)
    })
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
            tcpEnemies.forEach(mon => {
                if(mon._targetId === ownerId){
                    mon._targetId = false
                    mon._isMoving = false
                    mon._attacking = false
                }
            })
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

        io.emit("enemy-wander", { _id: enem._id, currentPlaceId: enem.currentPlaceId, x: destX, z: destZ })
    })
}, WANDER_INTERVAL_MS)

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
const BOT_SPAWN_PLACES = [
    { placeId: 1, name: "village", areaType: "village", center: { x: 0, z: 0 }, radius: 20 },
    { placeId: 888, name: "openworld", areaType: "openworld", center: { x: 0, z: 500 }, radius: 40 },
]

// MAX_BOTS-or-more entries on purpose (see pickBotName below) - with only
// 10 names and up to 20 bots alive at once, duplicates were near-guaranteed
// (confirmed from an actual screenshot: two different bots both named
// "Marrow" joined back to back, unreadable in world chat).
const BOT_NAMES = [
    "Wren", "Talon", "Brisk", "Marrow", "Ashen", "Fennick", "Corvid", "Dusk", "Bramble", "Quill",
    "Hollis", "Thistle", "Rowan", "Grael", "Nyx", "Fenwick", "Orin", "Larkin", "Sylas", "Brakk",
]
// known-good values, pulled straight off real npcDetails.js entries that
// already render correctly today - NOT the full set of everything that
// exists, just a safe pool guaranteed not to 404 a missing mesh/texture.
// gender is always "male" on purpose: createcharacterpage.js's own comment
// confirms female has no cloth/pants styles yet, so a female bot would be
// stuck half-dressed - not worth the risk for a cosmetic randomization.
const BOT_HAIR = ["hair1", "hair2", "style1", "style2"]
const BOT_CLOTH = ["style1", "style2", "style3"]
const BOT_PANTS = ["style1", "style2"]
const BOT_BOOTS = ["style1", "style2"]
const BOT_SKIN = ["skin1", "skin2", "skin3", "skin4"]
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

// picks a name no CURRENTLY ALIVE bot is already using - plain pickOne(BOT_NAMES)
// let two different bots both land on "Marrow" (confirmed from an actual
// screenshot), unreadable in world chat/nametags with no way to tell them
// apart. Falls back to a random pick + numeric suffix only if every name in
// the pool is already taken (BOT_NAMES has MAX_BOTS entries, so this should
// never actually trigger, just a safety net if that ever changes).
function pickBotName(): string {
    const taken = new Set(bots.map(b => b.player.name))
    const free = BOT_NAMES.filter(n => !taken.has(n))
    if(free.length) return pickOne(free)
    return `${pickOne(BOT_NAMES)} ${randNumString().slice(0, 2)}`
}

function spawnBot() {
    if (bots.length >= MAX_BOTS) return

    const owner = `bot_${randNumString()}`
    const attitudeNames = Object.keys(ATTITUDE_PRESETS)
    const attitude = ATTITUDE_PRESETS[pickOne(attitudeNames)]

    const place = pickOne(BOT_SPAWN_PLACES)
    const angle = Math.random() * Math.PI * 2
    const dist = Math.random() * place.radius
    const spawnX = place.center.x + Math.cos(angle) * dist
    const spawnZ = place.center.z + Math.sin(angle) * dist

    // same shape/fields a real join-world push builds (see that handler
    // above) - items/skills empty is deliberate for this movement-only
    // phase (no weapon data needed yet, "attacking later" per spec), so
    // hasWeapon correctly comes out false the same way a real unarmed
    // player's own join would compute it
    const botPlayer: Tplayers = {
        socketId: `bot-socket-${owner}`,
        owner,
        name: pickBotName(),
        lvl: 1,
        gender: "male",
        cloth: pickOne(BOT_CLOTH),
        pants: pickOne(BOT_PANTS),
        hair: pickOne(BOT_HAIR),
        boots: pickOne(BOT_BOOTS),
        clothColor: pickOne(BOT_COLORS) as any,
        pantsColor: pickOne(BOT_COLORS) as any,
        hairColor: pickOne(BOT_COLORS) as any,
        skinColor: pickOne(BOT_SKIN),
        race: "human",
        currentPlace: { placeId: place.placeId, name: place.name, areaType: place.areaType },
        _moving: false,
        _minning: false,
        _attacking: false,
        mode: "idle",
        pos: { x: spawnX, y: RESTING_Y, z: spawnZ },
        dirTarg: { x: spawnX, y: 0, z: spawnZ + 1 },
        items: [],
        skills: [],
        hasWeapon: false,
        weaponBlocking: false,
        magicBlocking: false,
        IsInVulnerable: false,
    }

    players.push(botPlayer)

    const brain = new Brain(attitude, { x: spawnX, z: spawnZ }, (pos, dirTarg, mode, moving) => {
        botPlayer.pos = pos
        botPlayer.dirTarg = dirTarg
        botPlayer.mode = mode
        botPlayer._moving = moving
        // same event NAME/PAYLOAD SHAPE a real player's own "emitmove"/
        // "emitStop" server handlers already broadcast - every connected
        // client's worldsocket.js already knows exactly how to apply
        // these (snap position, look at dirTarg, switch mode), no bot-
        // aware branch needed anywhere client-side
        io.emit(moving ? "emitted-moving" : "stopped", { ownerId: owner, pos, dirTarg, mode })
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
        getNearbyEnemies: (x, z, radius) => {
            const radiusSq = radius * radius
            return tcpEnemies
                .filter(enem => enem.currentPlaceId === botPlayer.currentPlace.placeId && !enem._disabled)
                .filter(enem => ((enem.x - x) ** 2 + (enem.z - z) ** 2) <= radiusSq)
                .map(enem => ({ _id: enem._id, x: enem.x, z: enem.z, hp: enem.hp }))
        },
        // same applyDamageToEnemy() every real player's own "enemyIsHit"
        // handler already goes through (see that function's own header
        // comment) - a bot-dealt hit is real, server-tracked damage that
        // can actually kill the enemy, visible/consistent for every
        // connected client, not a bot-only illusion
        dealDamage: (targetId, dmgDetails) => {
            applyDamageToEnemy({
                targetId,
                dmgDetails,
                playerId: owner,
                currentPlaceId: botPlayer.currentPlace.placeId,
                isPhysical: true,
            })
        },
    })

    bots.push({ player: botPlayer, brain })

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
        treasures, bonfires, wagons, harnessDeer, struckWeapons,
    })
}

setInterval(() => {
    if (!spawnBotsEnabled) return
    spawnBot()
}, BOT_SPAWN_INTERVAL_MS)

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

// Staggered startup spawn (openworld/placeId 888) - each WAGON_HEADINGS
// entry appears one at a time (north immediately, then the next heading
// WAGON_STARTUP_STAGGER_MS later, and so on) instead of all 4 popping into
// existence in the same instant the server boots. Reuses createHarnessDeer/
// createWagon - the exact same factories the quota-check interval right
// below already calls to top up a missing heading later - rather than a
// second hand-built "create them all" path that could drift out of sync.
// Runs ONCE, at module load; the quota-check interval below is what keeps
// these topped up ongoing (e.g. if this sequence gets interrupted by a
// restart partway through staggering).
//
// wagonStaggerComplete gates the quota-check interval below until this
// entire sequence has actually finished. Without it, WAGON_QUOTA_CHECK_INTERVAL_MS's
// own first tick (10s) would fire WHILE this is still mid-stagger (the last
// heading here can land as late as 3 * WAGON_STARTUP_STAGGER_MS = 15s), see
// whichever headings haven't had their turn yet as "missing", and spawn
// them immediately right then - defeating the stagger for exactly the
// headings it was supposed to still be delaying.
let wagonStaggerComplete = false
const WAGON_STARTUP_STAGGER_MS = 5 * 1000
const wagonHeadingEntries = Object.entries(WAGON_HEADINGS)
wagonHeadingEntries.forEach(([headingName, heading], index) => {
    setTimeout(() => {
        const deer = createHarnessDeer(headingName, heading)
        harnessDeer.push(deer)
        wagons.push(createWagon(deer))
        log(`[wagonStagger] spawned harness deer/wagon heading: ${headingName}`)
        io.emit("harness-deer-spawned", harnessDeer)
        io.emit("wagons-spawned", wagons)
        if(index === wagonHeadingEntries.length - 1) wagonStaggerComplete = true
    }, index * WAGON_STARTUP_STAGGER_MS)
})

// wagon quota top-up (openworld/placeId 888) - same "keep at least N of
// these alive" shape as enemyLengthsInPlace's own quota check right above,
// not a literal "spawn 4 more every 10s forever": recources/wagons.ts's own
// wagons are permanent (no removal path exists at all, same as bonfires),
// so in steady state this finds nothing missing and does nothing, every
// tick, forever - it only actually creates anything if a heading is
// missing (the staggered startup sequence above hasn't reached it yet, got
// interrupted by a restart, or this array got cleared some other way).
// This is what actually explains "I don't see the wagons" if wagons was
// never populated in the first place - restarting this server process is
// what makes the FIRST tick of this pick that up; this interval alone
// can't fix a client that's still holding an old cached bundle/socket
// connection from before wagons existed at all, only a stale/empty wagons
// array on THIS process.
const WAGON_QUOTA_CHECK_INTERVAL_MS = 10 * 1000
setInterval(() => {
    // wait for the staggered startup sequence above to actually finish
    // before this starts checking anything - see wagonStaggerComplete's
    // own comment for why
    if(!wagonStaggerComplete) return

    // deer is the primary entity now (recources/wagons.ts's own header
    // comment on why) - check ITS headings first, and spawn a paired
    // wagon for anything freshly created here
    const missingHeadings = Object.keys(WAGON_HEADINGS).filter(headingName =>
        !harnessDeer.some(d => d.currentPlaceId === 888 && d.name === `harnessdeer-${headingName}`)
    )
    if(missingHeadings.length){
        const newDeer = missingHeadings.map(headingName => createHarnessDeer(headingName, WAGON_HEADINGS[headingName]))
        harnessDeer.push(...newDeer)
        // a freshly topped-up deer needs its own wagon too, same 1:1
        // pairing the staggered startup sequence above already establishes -
        // otherwise a deer that only ever exists because THIS check
        // created it would stay permanently cart-less
        wagons.push(...newDeer.map(createWagon))
        log(`[wagonQuota] topped up missing harness deer/wagon headings: ${missingHeadings.join(", ")}`)
        io.emit("harness-deer-spawned", harnessDeer)
        io.emit("wagons-spawned", wagons)
        return
    }

    // deer were all already fine, but wagon is its own separate array
    // (recources/wagons.ts's own Twagon) - check independently in case a
    // wagon entry itself ever went missing without its deer also going
    // missing (nothing removes either today, but this is the same "cheap
    // to keep correct" self-healing check every other quota interval in
    // this file already follows)
    const deerMissingWagon = harnessDeer.filter(d => !wagons.some(w => w.deerId === d._id))
    if(!deerMissingWagon.length) return

    wagons.push(...deerMissingWagon.map(createWagon))
    log(`[wagonQuota] topped up missing wagons for: ${deerMissingWagon.map(d => d.name).join(", ")}`)
    io.emit("wagons-spawned", wagons)
}, WAGON_QUOTA_CHECK_INTERVAL_MS)

function removeCharacter(ownerId: string, playerName: string, placeId: number){
    log(playerName , " disconnecting ... ")    
    players = players.filter(plyr => plyr.owner !== ownerId)
    tcpEnemies.forEach(enem => {
        if(enem._targetId === ownerId){
            enem._targetId = false
        }
    })

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