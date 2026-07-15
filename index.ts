import http from "http"
import express from "express"
import cors from "cors"
import { Server, Socket } from "socket.io"
import { randNumString, randNum } from "./tools/tools"

import { placesMD } from "./placedetails/places"
import enemyArray from "./recources/enemyDetails"
import startingQuests, { createSlaySlimesQuest, F_RANK_QUEST_COUNT } from "./recources/quests"

const app = express()
const server = http.createServer(app)
const PORT = process.env.PORT || 3000
const log = console.log

app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cors({ origin: "*", methods: ["GET", "POST"] }))

type Tplayers = {
    socketId: string
    owner: string,
    name: string,
    lvl: number,
    cloth: string,
    pants: string,
    hair: string,
    boots: string,
    clothColor: string,
    pantsColor: string,
    hairColor: string,
    currentPlace: any, // placeId, name, areaType
    _moving: boolean,
    _minning: boolean,
    _attacking: boolean,
    mode: string, // idle// fighting // structed // paralized //
    pos: { x: number, y: number, z: number},
    dirTarg: { x: number, y: number, z: number},
    items: any,
    skills: any[],
    hasWeapon: boolean
}

let players: Tplayers[] = []
let gates: unknown[] = []

let tcpEnemies = enemyArray
let quests = startingQuests
let treasures: unknown[] = []


app.get("/", (req, res) => {
    res.status(200).send(players)
})

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
})

io.on("connection", (socket: Socket) => {
    socket.on("join-world", (data, callback) => {
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
        socketId: socket.id})
        // if (callback) {
        //     callback({socketId: socket.id, placesMD});
        // }

        console.log(players)
        io.emit("userJoined", { currentPlaceId: data.currentPlace.placeId, newPlayerName: data.name,  players, placesMD, tcpEnemies, quests }) // always send the updated players count
    })

    // WORLD CHAT - simple global relay, no rooms/parties. tcp has no db
    // access, so persistence happens client-side straight to the server's
    // own REST api (see server/routes/worldMessageR.js); this just fans the
    // message back out to everyone in realtime.
    socket.on("worldChatMessage", data => {
        const { playerId, message } = data
        if(!message || !message.trim()) return
        if(!players.find(uzr => uzr.owner === playerId)) return log(`no valid player ${playerId}`)
        io.emit("worldChatMessage", data)
    })

    // MOVEMENTS
    socket.on("emitMode", data => {
        const { ownerId, mode, weaponName} = data
        let player = players.find(user => user.owner === ownerId)
        if(!player) return
        
        player.mode = mode
        io.emit("emitted-mode", data)
    })
    socket.on("emitLoc", data => {
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
    socket.on("emitmove", data => {
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
    socket.on("emitStop", data => {
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
    socket.on("emitPlayerAttack", data => {
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
    socket.on("activate-skill", data => {
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
    socket.on("spawncirc", data => {
        const { pos, placeId, element } = data
        io.emit("circle-spawned", { pos, placeId, element })
    })
    // EQUIPING
    socket.on("emitEquipItem", data =>{
        const {ownerId, itemName, itemModelStyle,  itemType, currentPlaceId} = data
        const isValidPlayer = players.find(uzr => uzr.owner === ownerId)
        if(!isValidPlayer) return log(`no valid player ${ownerId}`)
        log(`A Player is equiping ${itemName} in ${currentPlaceId}`)
        if(itemType === "weapon") isValidPlayer.hasWeapon = true
        io.emit('equiped-item', data)
    })
    socket.on("emitUnEquip", data =>{
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
    socket.on("emitClaimQuest", data => {
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
    socket.on("emitCancelQuest", data => {
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
    socket.on("emitCompleteQuest", data => {
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
    socket.on("enemyIsHit", data => {
        const { targetId, dmgDetails } = data
        // console.log(`${targetId} is hit with ${dmgDetails.weaponDmg ? dmgDetails.weaponDmg : dmgDetails.physicalDmg} damage`)
        // log(data.dmgDetails)

        const enemyTarg = tcpEnemies.find(ene => ene._id === targetId)
        if(!enemyTarg) return log("not found enemy to be damaged ", targetId)
        // if(!data.isMissed){
        // enemyTarg.hp -= data.hasWeapon ? data.dmgDetails.weaponDmg : data.dmgDetails.physicalDmg
        const dmgToApply = data.dmgDetails.weaponDmg ? data.dmgDetails.weaponDmg : data.dmgDetails.physicalDmg
        enemyTarg.hp -= dmgToApply
        if(enemyTarg.hp <= 0) tcpEnemies = tcpEnemies.filter(enemy => enemy._id !== data.targetId)
        // }
        console.log(`enemy hp ${enemyTarg.hp} / ${enemyTarg.maxHp}`)
        io.emit("enemy-is-hit", {...data, dmgToApply, hp: enemyTarg.hp, maxHp: enemyTarg.maxHp})
    })
    socket.on('enemyChangeTarget', data => {
        tcpEnemies.forEach(enem => {
            if(data._id === enem._id){
                enem._targetId = data.newTargetId
            }
        })
        io.emit("enemy-changedtarget", data)
    })
    socket.on("respawnEnemy", data => {
        const {maxHp, name, respawnDetails} = data
        setTimeout(() => {
            tcpEnemies.push({...data,
                _id: randNumString(),
                hp: maxHp,
                _isMoving: false,
                _targetId: undefined,
                _dirTarg: {x:0,z:0},
                _attacking: false,
            })
            io.emit("enemy-respawned", tcpEnemies)
        }, respawnDetails.respawnTime)
    })
    socket.on("removeEnemy", enemyId => {
        tcpEnemies = tcpEnemies.filter(enemy => enemy._id !== enemyId)
        console.log("enemy removed ", enemyId)
        console.log("tcpEnemies ", tcpEnemies.length)
        io.emit("enemy-removed", enemyId)
    })
    socket.on("enemyWillAttack", data => {
        const { pos } = data
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
    socket.on("enemyAttackedRange", data => {
        tcpEnemies.forEach(enem => {
            if(data._id === enem._id){
                // enem._targetId = data.targetId
                // enem._isMoving = false
                // enem._attacking = true
            }
        })
        io.emit("enemy-attacked-range", data)
    })
    socket.on("registerPlayerAsEnemy", data => {
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
    socket.on("enemyWillChase", data => {
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
    socket.on('will-die', data => {
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
    socket.on('dispose', data => {
        const { owner } = data
        console.log("dispose ", data)
        // I will use owner since owner is also a unique string ID from login info
        const thePlayer = players.find(player => player.owner === owner)
        if(!thePlayer) return console.log("not found ", owner)

        removeCharacter(thePlayer.owner, thePlayer.name, thePlayer.currentPlace.placeId)
        
    })
    socket.on("disconnect", () => {
        const thePlayer = players.find(player => player.socketId === socket.id)        
        if(thePlayer) {            
            removeCharacter(thePlayer.owner, thePlayer.name, thePlayer.currentPlace.placeId)
        }
    })

    // setInterval(() => {

        // io.emit("add-recources", {tcpEnemies})
        // console.log("tcpEnemies ", tcpEnemies.length)
    // }, 1000)
})
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