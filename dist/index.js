"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const socket_io_1 = require("socket.io");
const tools_1 = require("./tools/tools");
const places_1 = require("./placedetails/places");
const enemyDetails_1 = __importDefault(require("./recources/enemyDetails"));
const quests_1 = __importStar(require("./recources/quests"));
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const PORT = process.env.PORT || 3000;
const log = console.log;
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: false }));
app.use((0, cors_1.default)({ origin: "*", methods: ["GET", "POST"] }));
// Backstop for anything outside a socket handler's synchronous body - e.g. a
// rejected fire-and-forget promise, or a bug inside a setTimeout callback
// like the one in respawnEnemy below, which safeOn's try/catch can't see
// since it runs after the handler that scheduled it has already returned.
// Logging (rather than letting the process die and the host silently
// restart it) keeps prod failures visible instead of showing up as an
// unexplained blip in uptime.
process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (error) => {
    console.error("[uncaughtException]", error);
});
let players = [];
let gates = [];
let tcpEnemies = enemyDetails_1.default;
let quests = quests_1.default;
let treasures = [];
app.get("/", (req, res) => {
    res.status(200).send(players);
});
// public server status - no auth/socket connection needed, so the client
// can show a live online count on the home page before login
app.get("/status", (req, res) => {
    res.status(200).json({ online: players.length });
});
const io = new socket_io_1.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
// Unlike Express 5 (which auto-forwards a thrown/rejected async route handler
// to its own error middleware instead of crashing), Socket.IO has no built-in
// protection against a listener throwing - and every handler below reads
// straight from a client-supplied payload (data.currentPlace.placeId,
// data.dmgDetails.weaponDmg, etc.) with no validation. One malformed message
// from any single connected player would otherwise take the whole server
// down for everyone. This only guards the synchronous portion of a handler -
// see the process-level uncaughtException/unhandledRejection handlers below
// for the backstop covering deferred callbacks (e.g. respawnEnemy's setTimeout).
function safeOn(socket, event, handler) {
    socket.on(event, (...args) => {
        try {
            handler(...args);
        }
        catch (error) {
            console.error(`[socket:${event}] handler threw:`, error);
        }
    });
}
io.on("connection", (socket) => {
    safeOn(socket, "join-world", (data, callback) => {
        // join-world fires every time the client loads a new place, not just
        // on first connect (see areascene.js) - so an existing entry for this
        // owner only means another device is logged in if it's a different
        // socket. Same socket re-joining is just a place change and must
        // still re-broadcast userJoined, otherwise reCreateMeshesInScene()
        // never runs again after the first place (no enemies get spawned,
        // and this player also drops out of `players`, so the server can no
        // longer find them to echo back their own attacks either).
        const alreadyJoined = players.find(user => user.owner === data.owner);
        if (alreadyJoined && alreadyJoined.socketId !== socket.id) {
            socket.to(alreadyJoined.socketId).emit("duplicate-login", { message: "You have logged in from another device." });
        }
        players = players.filter(user => user.owner !== data.owner);
        const hasWeapon = Array.isArray(data.items) && data.items.some((itm) => itm.itemType === "weapon" && itm.equiped);
        players.push({ ...data,
            mode: "idle",
            _moving: false,
            _minning: false,
            hasWeapon,
            socketId: socket.id });
        // if (callback) {
        //     callback({socketId: socket.id, placesMD});
        // }
        console.log(players);
        io.emit("userJoined", { currentPlaceId: data.currentPlace.placeId, newPlayerName: data.name, players, placesMD: places_1.placesMD, tcpEnemies, quests }); // always send the updated players count
    });
    // WORLD CHAT - simple global relay, no rooms/parties. tcp has no db
    // access, so persistence happens client-side straight to the server's
    // own REST api (see server/routes/worldMessageR.js); this just fans the
    // message back out to everyone in realtime.
    safeOn(socket, "worldChatMessage", data => {
        const { playerId, message } = data;
        if (!message || !message.trim())
            return;
        if (!players.find(uzr => uzr.owner === playerId))
            return log(`no valid player ${playerId}`);
        io.emit("worldChatMessage", data);
    });
    // MOVEMENTS
    safeOn(socket, "emitMode", data => {
        const { ownerId, mode, weaponName } = data;
        let player = players.find(user => user.owner === ownerId);
        if (!player)
            return;
        player.mode = mode;
        io.emit("emitted-mode", data);
    });
    safeOn(socket, "emitLoc", data => {
        const { ownerId, pos, dirTarg, mode, weaponName } = data;
        let player = players.find(user => user.owner === ownerId);
        if (!player)
            return;
        player.mode = mode;
        player.pos = pos;
        player.dirTarg = dirTarg;
        // log(`mode: `, player.mode)
        // log(`pos: `, player.pos)
        // log(`dirTarg: `, player.dirTarg)
        io.emit("emitted-loc", data);
    });
    safeOn(socket, "emitmove", data => {
        const { ownerId, pos, dirTarg, mode } = data;
        let player = players.find(user => user.owner === ownerId);
        if (!player)
            return;
        player._moving = true;
        player.mode = mode;
        player.pos = pos;
        player.dirTarg = dirTarg;
        // log(`mode: `, player.mode)
        // log(`pos: `, player.pos)
        // log(`dirTarg: `, player.dirTarg)
        io.emit("emitted-moving", data);
    });
    safeOn(socket, "emitStop", data => {
        const { ownerId, pos, dirTarg, mode } = data;
        let player = players.find(user => user.owner === ownerId);
        if (!player)
            return;
        player._moving = false;
        player.mode = mode;
        player.pos = pos;
        player.dirTarg = dirTarg;
        // log(`mode: `, player.mode)
        // log(`pos: `, player.pos)
        // log(`dirTarg: `, player.dirTarg)
        io.emit("stopped", data);
    });
    // Actions
    safeOn(socket, "emitPlayerAttack", data => {
        const { owner, pos, dirTarg, animName, dmgDetails, hasWeapon, isMissed, weaponType, currentPlaceId, atkSpd } = data;
        const player = players.find(uzr => uzr.owner === owner);
        if (!player)
            return log(`no valid player ${owner}`);
        player._attacking = true;
        player._moving = false;
        // const enemyTarg = tcpEnemies.find(ene => ene._id === data.targetId)
        // if(!enemyTarg) return log("not found enemy to be damaged ", data.targetId)
        // if(!isMissed){
        //     enemyTarg.hp -= data.hasWeapon ? data.dmgDetails.weaponDmg : data.dmgDetails.physicalDmg
        //     if(enemyTarg.hp <= 0) tcpEnemies = tcpEnemies.filter(enemy => enemy._id !== data.targetId)
        // }
        player.pos.x = pos.x;
        player.pos.z = pos.z;
        player.dirTarg = dirTarg;
        io.emit("player-attacked", data);
    });
    safeOn(socket, "activate-skill", data => {
        const { ownerId, skill, currentPlaceId } = data;
        switch (skill.name) {
            case "flexaura":
                const player = players.find(uzr => uzr.owner === ownerId);
                if (!player)
                    return log(`no valid player ${ownerId}`);
                player.skills.forEach((skl) => {
                    if (skl.name === skill.name)
                        skl.isActive = skill.isActive;
                });
                break;
            default:
                break;
        }
        io.emit("skillactivated", data);
    });
    // MAGIC CIRCLES - purely visual sync, no server state to touch. Client is
    // responsible for filtering by placeId (and by ownerId, once emitSpawnCircle
    // sends one - see note in client/src/sockets/emits.js) before spawning.
    safeOn(socket, "spawncirc", data => {
        const { pos, placeId, element } = data;
        io.emit("circle-spawned", { pos, placeId, element });
    });
    // EQUIPING
    safeOn(socket, "emitEquipItem", data => {
        const { ownerId, itemName, itemModelStyle, itemType, currentPlaceId } = data;
        const isValidPlayer = players.find(uzr => uzr.owner === ownerId);
        if (!isValidPlayer)
            return log(`no valid player ${ownerId}`);
        log(`A Player is equiping ${itemName} in ${currentPlaceId}`);
        if (itemType === "weapon")
            isValidPlayer.hasWeapon = true;
        io.emit('equiped-item', data);
    });
    safeOn(socket, "emitUnEquip", data => {
        const { ownerId, itemType, currentPlaceId } = data;
        const player = players.find(uzr => uzr.owner === ownerId);
        if (!player)
            return log(`no valid player ${ownerId}`);
        player.items.forEach((item) => {
            if (item.itemType === itemType)
                item.equiped = false;
        });
        if (itemType === "weapon")
            player.hasWeapon = false;
        log("unequping ", player);
        io.emit("unequiped-item", data);
    });
    // QUESTS (guild board)
    safeOn(socket, "emitClaimQuest", data => {
        const { ownerId, questId, currentPlaceId } = data;
        const player = players.find(uzr => uzr.owner === ownerId);
        if (!player)
            return log(`no valid player ${ownerId}`);
        const targetQuest = quests.find(q => q.questId === questId);
        if (!targetQuest)
            return log(`no valid quest ${questId}`);
        if (targetQuest.claimed) {
            log(`quest ${questId} already claimed, rejecting ${ownerId}`);
            io.emit("quest-claim-result", { ownerId, questId, currentPlaceId, success: false });
            return;
        }
        targetQuest.claimed = true;
        log(`${ownerId} claimed quest ${questId}`);
        io.emit("quest-claim-result", { ownerId, questId, currentPlaceId, success: true, quest: targetQuest });
    });
    safeOn(socket, "emitCancelQuest", data => {
        const { ownerId, questId, currentPlaceId } = data;
        const targetQuest = quests.find(q => q.questId === questId);
        if (!targetQuest)
            return log(`no valid quest ${questId}`);
        targetQuest.claimed = false;
        log(`${ownerId} cancelled quest ${questId}`);
        io.emit("quest-cancelled", { ownerId, questId, currentPlaceId, quest: targetQuest });
    });
    // fired once the player turns the finished quest in (client already
    // checked completion and granted the reward) - this just retires it from
    // the board's pool for good and, if that drops f-rank quests (like the
    // slime ones) below F_RANK_QUEST_COUNT, tops the pool back up so it never
    // drifts above or below that count
    safeOn(socket, "emitCompleteQuest", data => {
        const { ownerId, questId, currentPlaceId } = data;
        const targetQuest = quests.find(q => q.questId === questId);
        if (!targetQuest)
            return log(`no valid quest ${questId}`);
        quests = quests.filter(q => q.questId !== questId);
        log(`${ownerId} completed quest ${questId}`);
        if (targetQuest.requiredRank.rankLabel === "f") {
            const fRankCount = quests.filter(q => q.requiredRank.rankLabel === "f").length;
            if (fRankCount < quests_1.F_RANK_QUEST_COUNT) {
                const newQuest = (0, quests_1.createSlaySlimesQuest)(2, targetQuest.pos);
                quests.push(newQuest);
                io.emit("quest-spawned", { currentPlaceId, quest: newQuest });
            }
        }
    });
    //enemy related
    safeOn(socket, "enemyIsHit", data => {
        const { targetId, dmgDetails } = data;
        // console.log(`${targetId} is hit with ${dmgDetails.weaponDmg ? dmgDetails.weaponDmg : dmgDetails.physicalDmg} damage`)
        // log(data.dmgDetails)
        const enemyTarg = tcpEnemies.find(ene => ene._id === targetId);
        if (!enemyTarg)
            return log("not found enemy to be damaged ", targetId);
        // if(!data.isMissed){
        // enemyTarg.hp -= data.hasWeapon ? data.dmgDetails.weaponDmg : data.dmgDetails.physicalDmg
        const dmgToApply = data.dmgDetails.weaponDmg ? data.dmgDetails.weaponDmg : data.dmgDetails.physicalDmg;
        enemyTarg.hp -= dmgToApply;
        if (enemyTarg.hp <= 0)
            tcpEnemies = tcpEnemies.filter(enemy => enemy._id !== data.targetId);
        // }
        console.log(`enemy hp ${enemyTarg.hp} / ${enemyTarg.maxHp}`);
        io.emit("enemy-is-hit", { ...data, dmgToApply, hp: enemyTarg.hp, maxHp: enemyTarg.maxHp });
    });
    safeOn(socket, 'enemyChangeTarget', data => {
        tcpEnemies.forEach(enem => {
            if (data._id === enem._id) {
                enem._targetId = data.newTargetId;
            }
        });
        io.emit("enemy-changedtarget", data);
    });
    safeOn(socket, "respawnEnemy", data => {
        const { maxHp, name, respawnDetails } = data;
        setTimeout(() => {
            tcpEnemies.push({ ...data,
                _id: (0, tools_1.randNumString)(),
                hp: maxHp,
                _isMoving: false,
                _targetId: undefined,
                _dirTarg: { x: 0, z: 0 },
                _attacking: false,
            });
            io.emit("enemy-respawned", tcpEnemies);
        }, respawnDetails.respawnTime);
    });
    safeOn(socket, "removeEnemy", enemyId => {
        tcpEnemies = tcpEnemies.filter(enemy => enemy._id !== enemyId);
        console.log("enemy removed ", enemyId);
        console.log("tcpEnemies ", tcpEnemies.length);
        io.emit("enemy-removed", enemyId);
    });
    safeOn(socket, "enemyWillAttack", data => {
        const { pos } = data;
        tcpEnemies.forEach(enem => {
            if (data._id === enem._id) {
                enem._targetId = data.targetId;
                enem._isMoving = false;
                enem._attacking = true;
                enem.x = pos.x;
                enem.z = pos.z;
            }
        });
        io.emit("enemy-attacked", data);
    });
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
        const { _id, y } = data;
        const enem = tcpEnemies.find(enem => enem._id === _id);
        if (!enem)
            return;
        enem.y = y;
        socket.broadcast.emit("enemy-y-corrected", data);
    });
    safeOn(socket, "enemyAttackedRange", data => {
        tcpEnemies.forEach(enem => {
            if (data._id === enem._id) {
                // enem._targetId = data.targetId
                // enem._isMoving = false
                // enem._attacking = true
            }
        });
        io.emit("enemy-attacked-range", data);
    });
    safeOn(socket, "registerPlayerAsEnemy", data => {
        tcpEnemies.forEach(enem => {
            if (data._id === enem._id) {
                console.log("confirm enemy exist");
                if (enem._targetId)
                    return console.log("enemy already has target ", enem._targetId);
                enem._targetId = data.targetId;
                enem._dirTarg = data.dirTarg;
            }
        });
        io.emit("registered-playerAsEnemy", tcpEnemies);
    });
    safeOn(socket, "enemyWillChase", data => {
        const { currentPlaceId, _id, targetId, actionType } = data;
        tcpEnemies.forEach(enem => {
            if (_id === enem._id) {
                if (enem._targetId !== targetId)
                    return;
                // enem._targetId = data.targetId //redundant
                enem._isMoving = true;
                enem._attacking = false;
                if (actionType === "idle") {
                    enem._isMoving = false;
                    enem._attacking = true;
                }
            }
        });
        io.emit("enemy-chasing", data);
    });
    // DISCONNECTIONS
    safeOn(socket, 'will-die', data => {
        const { ownerId, currentPlaceId } = data;
        const theUzer = players.find(user => user.owner === ownerId);
        if (!theUzer)
            return log("uzer died id not found. line.147");
        if (theUzer) {
            players = players.filter(user => user.owner !== ownerId);
            tcpEnemies.forEach(mon => {
                if (mon._targetId === ownerId) {
                    mon._targetId = false;
                    mon._isMoving = false;
                    mon._attacking = false;
                }
            });
            log("total of players after death " + players.length);
            io.emit('player-death', { ownerId: theUzer.owner, currentPlaceId });
        }
    });
    safeOn(socket, 'dispose', data => {
        const { owner } = data;
        console.log("dispose ", data);
        // I will use owner since owner is also a unique string ID from login info
        const thePlayer = players.find(player => player.owner === owner);
        if (!thePlayer)
            return console.log("not found ", owner);
        removeCharacter(thePlayer.owner, thePlayer.name, thePlayer.currentPlace.placeId);
    });
    safeOn(socket, "disconnect", () => {
        const thePlayer = players.find(player => player.socketId === socket.id);
        if (thePlayer) {
            removeCharacter(thePlayer.owner, thePlayer.name, thePlayer.currentPlace.placeId);
        }
    });
    // setInterval(() => {
    // io.emit("add-recources", {tcpEnemies})
    // console.log("tcpEnemies ", tcpEnemies.length)
    // }, 1000)
});
function removeCharacter(ownerId, playerName, placeId) {
    log(playerName, " disconnecting ... ");
    players = players.filter(plyr => plyr.owner !== ownerId);
    tcpEnemies.forEach(enem => {
        if (enem._targetId === ownerId) {
            enem._targetId = false;
        }
    });
    log("total of players after disconnect " + players.length);
    io.emit('removeChar', { ownerId, playerName, placeId });
}
server.listen(PORT, () => log("TCP server is on port", PORT));
// If you are planning to create a room
// socket.on('join-room', (roomId) => {
//     socket.join(roomId);
//     socket.to(roomId).emit('player-joined', { id: socket.id });
// });
// socket.on('game-move', (data) => {
//     socket.to(data.roomId).emit('opponent-moved', data.move);
// });
