import http from "http"
import express from "express"
import cors from "cors"
import { Server, Socket } from "socket.io"
import { randNumString, randNum } from "./tools/tools"

import { placesMD } from "./placedetails/places"
import enemyArray, { OPENWORLD_SLIME_TERRITORY } from "./recources/enemyDetails"
import startingQuests, { createSlaySlimesQuest, F_RANK_QUEST_COUNT } from "./recources/quests"
import { generateSlimes, generateFireSlimes, generateElectricSlimes, generateMonoliths, generateDarkSlimes, generateLesserDemons } from "./generate-datas/genenemy"
import { startingTreasures } from "./recources/treasures"
import { startingWagons, createWagon, WAGON_HEADINGS, startingHarnessDeer, createHarnessDeer, Tharnessdeer, Twagon } from "./recources/wagons"

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

let players: Tplayers[] = []
let gates: unknown[] = []

let tcpEnemies = enemyArray
let quests = startingQuests
let treasures: Ttreasure[] = startingTreasures
let bonfires: Tbonfire[] = []
// wagons is now the FOLLOWER array (recources/wagons.ts's own header
// comment on the flip) - each entry only references which harness deer
// pulls it via deerId, no movement law of its own. Never removed once
// placed (same permanence as bonfires above).
let wagons: Twagon[] = startingWagons
// harness deer - the primary/driving entity of the pairing now, one per
// wagon. Same permanence as wagons above.
let harnessDeer: Tharnessdeer[] = startingHarnessDeer

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
            treasures, bonfires, wagons, harnessDeer
        }) // always send the updated players count
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

    // WORLD CHAT - simple global relay, no rooms/parties. tcp has no db
    // access, so persistence happens client-side straight to the server's
    // own REST api (see server/routes/worldMessageR.js); this just fans the
    // message back out to everyone in realtime.
    safeOn(socket, "worldChatMessage", data => {
        const { playerId, message } = data
        if(!message || !message.trim()) return
        if(!players.find(uzr => uzr.owner === playerId)) return log(`no valid player ${playerId}`)
        io.emit("worldChatMessage", data)
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
    safeOn(socket, "enemyIsHit", data => {
        const { targetId, dmgDetails } = data
        // console.log(`${targetId} is hit with ${dmgDetails.weaponDmg ? dmgDetails.weaponDmg : dmgDetails.physicalDmg} damage`)
        // log(data.dmgDetails)

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
        // if(!data.isMissed){
        // enemyTarg.hp -= data.hasWeapon ? data.dmgDetails.weaponDmg : data.dmgDetails.physicalDmg
        const dmgToApply = data.dmgDetails.weaponDmg ? data.dmgDetails.weaponDmg : data.dmgDetails.physicalDmg
        enemyTarg.hp -= dmgToApply
        if(enemyTarg.hp <= 0) tcpEnemies = tcpEnemies.filter(enemy => enemy._id !== data.targetId)
        // }
        console.log(`enemy hp ${enemyTarg.hp} / ${enemyTarg.maxHp}`)
        io.emit("enemy-is-hit", {...data, dmgToApply, hp: enemyTarg.hp, maxHp: enemyTarg.maxHp})
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
// waterslime/fireslime/electricslime/orangelith/darkslime, one random pick
// per qualifying player per tick - "as long as I am in their territory" was
// given as a single shared gate (OPENWORLD_SLIME_TERRITORY) covering all
// five types together, not a separate per-type sub-range check. Monoliths
// and darkslime reuse this exact same territory (not a separate one of
// their own) - still named SLIME_SPAWN_* despite generateMonoliths/
// generateDarkSlimes being in here too, same constants/interval, just a
// wider generator pool now. Each generator call below still gets its own
// band via SLIME_SPAWN_DIST_MIN/MAX around the player, same as always -
// this pool only decides WHICH type can spawn near a player anywhere
// inside the whole 0-3000 territory, not where within it. That's fine:
// unlike the static withTerritory bands above (which keep each type in
// its own ring), the dynamic top-up has always let any of these spawn
// near any qualifying player regardless of distance from center - a
// darkslime can already turn up close to spawn this way, same as a
// monolith or electricslime could before it.
const SLIME_SPAWN_GENERATORS = [generateFireSlimes, generateElectricSlimes, generateSlimes, generateMonoliths, generateDarkSlimes]
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

        const generator = SLIME_SPAWN_GENERATORS[Math.floor(Math.random() * SLIME_SPAWN_GENERATORS.length)]
        const [newSlime] = generator(1, 888, 100, "ring", player.pos.x, player.pos.z, SLIME_SPAWN_DIST_MIN, SLIME_SPAWN_DIST_MAX)
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

// wagon quota top-up (openworld/placeId 888) - same "keep at least N of
// these alive" shape as enemyLengthsInPlace's own quota check right above,
// not a literal "spawn 4 more every 10s forever": recources/wagons.ts's own
// wagons are permanent (no removal path exists at all, same as bonfires),
// so in steady state this finds nothing missing and does nothing, every
// tick, forever - it only actually creates anything the first time a
// heading turns out to be missing (a fresh boot where startingWagons somehow
// didn't seed, or this array got cleared some other way). This is what
// actually explains "I don't see the wagons" if wagons was never populated
// in the first place - restarting this server process is what makes the
// FIRST tick of this pick that up; this interval alone can't fix a client
// that's still holding an old cached bundle/socket connection from before
// wagons existed at all, only a stale/empty wagons array on THIS process.
const WAGON_QUOTA_CHECK_INTERVAL_MS = 10 * 1000
setInterval(() => {
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
        // pairing startingHarnessDeer/startingWagons already establish -
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