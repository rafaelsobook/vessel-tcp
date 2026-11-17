"use strict";
// PLAYER vs PLAYER - duels and parties between real players.
//
// The client (client/src/pvp/) shows the menus and the fight; this decides who is paired with whom and
// judges the result. Nothing here trusts a payload's "who am I": the sender is always the player on that
// socket.
//
//   INVITES   "pvp-invite" { kind: "duel"|"party", to }  -> the target gets "pvp-invited" (20 s to answer)
//             "pvp-respond" { kind, from, accept }        -> declined: the inviter gets "pvp-declined"
//   DUELS     accepted -> both get "duel-begin" { duelId, placeId, side, opponent } and travel to a private
//             arena of their own (placeId PVP_PLACE_BASE + n*10 + arena variant - the client builds it from
//             one of the five duel grounds, constants/places/duelingGrounds.js). Each sends "duel-arrived";
//             with both there, "duel-go" { startAt } - the VS screen and the countdown run to startAt, then
//             the fight is live. The arena is a "duel" area: a player stops at 1 hp, never dies (areascene.js
//             setAllowDeath). "duel-hp" is relayed to the opponent (their bar); the one who drops to 1 hp
//             sends "duel-lost". Leaving the arena, disconnecting or "duel-forfeit" loses it.
//             "duel-over" { winner, loser, reason, durationMs } to both.
//   PARTIES   accepted -> "party-updated" { members, leader } to every member; "party-leave"; up to 4.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PVP_PLACE_BASE = void 0;
exports.isPvpPlace = isPvpPlace;
exports.setupPvp = setupPvp;
exports.registerPvpSocket = registerPvpSocket;
exports.pvpOnDisconnect = pvpOnDisconnect;
exports.pvpOnPlace = pvpOnPlace;
exports.isPartyMates = isPartyMates;
exports.PVP_PLACE_BASE = 70000;
const ARENA_VARIANTS = 5;
const INVITE_MS = 20000;
const INTRO_MS = 5600; // the VS screen and the 3-2-1, before the fight is live
const ARRIVE_TIMEOUT_MS = 45000;
const PARTY_MAX = 4;
const invites = new Map();
const duels = new Map();
const duelOf = new Map();
const parties = new Map();
const partyOf = new Map();
let seq = 0;
let io;
let getPlayers;
const player = (owner) => getPlayers().find(p => p.owner === owner);
const send = (owner, event, data) => { const p = player(owner); if (p?.socketId)
    io.to(p.socketId).emit(event, data); };
const brief = (p) => ({ owner: p.owner, name: p.name, lvl: p.lvl });
const inviteKey = (kind, from, to) => `${kind}:${from}>${to}`;
function isPvpPlace(placeId) {
    return placeId >= exports.PVP_PLACE_BASE;
}
function setupPvp(theIo, players) {
    io = theIo;
    getPlayers = players;
}
/** Wires one socket's pvp events. `safeOn` is index.ts's own (a throw in a handler doesn't take the server down). */
function registerPvpSocket(socket, safeOn) {
    const me = () => getPlayers().find(p => p.socketId === socket.id);
    safeOn(socket, "pvp-invite", data => {
        const from = me(), to = player(data?.to);
        const kind = data?.kind === "party" ? "party" : "duel";
        if (!from || !to || from.owner === to.owner)
            return;
        if (kind === "duel") {
            if (duelOf.has(from.owner))
                return send(from.owner, "pvp-notice", { text: "You are already in a duel." });
            if (duelOf.has(to.owner))
                return send(from.owner, "pvp-notice", { text: `${to.name} is already in a duel.` });
        }
        else {
            const mine = parties.get(partyOf.get(from.owner) ?? "");
            if (mine && mine.members.includes(to.owner))
                return send(from.owner, "pvp-notice", { text: `${to.name} is already in your party.` });
            if (mine && mine.members.length >= PARTY_MAX)
                return send(from.owner, "pvp-notice", { text: "Your party is full." });
            if (partyOf.has(to.owner))
                return send(from.owner, "pvp-notice", { text: `${to.name} is already in a party.` });
        }
        invites.set(inviteKey(kind, from.owner, to.owner), { kind, from: from.owner, to: to.owner, until: Date.now() + INVITE_MS });
        send(to.owner, "pvp-invited", { kind, from: from.owner, fromName: from.name, fromLvl: from.lvl, expiresIn: INVITE_MS });
        send(from.owner, "pvp-invite-sent", { kind, to: to.owner, toName: to.name });
    });
    safeOn(socket, "pvp-respond", data => {
        const responder = me();
        const kind = data?.kind === "party" ? "party" : "duel";
        if (!responder || typeof data?.from !== "string")
            return;
        const key = inviteKey(kind, data.from, responder.owner);
        const invite = invites.get(key);
        invites.delete(key);
        const inviter = player(data.from);
        if (!invite || invite.until < Date.now() || !inviter)
            return send(responder.owner, "pvp-notice", { text: "That invitation has expired." });
        if (!data.accept)
            return send(inviter.owner, "pvp-declined", { kind, byName: responder.name });
        if (kind === "duel")
            beginDuel(inviter, responder);
        else
            joinParty(inviter, responder);
    });
    safeOn(socket, "duel-arrived", data => {
        const p = me();
        const duel = duels.get(data?.duelId);
        if (!p || !duel || (duel.a !== p.owner && duel.b !== p.owner))
            return;
        duel.joined.add(p.owner);
        if (duel.joined.size < 2 || duel.live)
            return;
        clearTimeout(duel.arriveTimer);
        duel.live = true;
        duel.startAt = Date.now() + INTRO_MS;
        const go = (owner, other) => send(owner, "duel-go", { duelId: duel.id, startAt: duel.startAt, serverNow: Date.now(), opponent: brief(player(other) ?? { owner: other, name: "?", lvl: 0, socketId: "" }) });
        go(duel.a, duel.b);
        go(duel.b, duel.a);
    });
    safeOn(socket, "duel-hp", data => {
        const p = me();
        const duel = duels.get(data?.duelId);
        if (!p || !duel)
            return;
        const other = duel.a === p.owner ? duel.b : duel.b === p.owner ? duel.a : null;
        if (other)
            send(other, "duel-hp", { owner: p.owner, hp: Number(data.hp) || 0, maxHp: Number(data.maxHp) || 1 });
    });
    safeOn(socket, "duel-lost", data => {
        const p = me();
        const duel = duels.get(data?.duelId);
        // only once the fight is actually on - a knock before "FIGHT!" can't end it
        if (!p || !duel || !duel.live || Date.now() < duel.startAt)
            return;
        endDuel(duel, p.owner, "ko");
    });
    safeOn(socket, "duel-forfeit", data => {
        const p = me();
        const duel = duels.get(data?.duelId);
        if (p && duel)
            endDuel(duel, p.owner, "forfeit");
    });
    safeOn(socket, "party-leave", () => {
        const p = me();
        if (p)
            leaveParty(p.owner);
    });
}
function beginDuel(a, b) {
    if (duelOf.has(a.owner) || duelOf.has(b.owner))
        return send(b.owner, "pvp-notice", { text: "One of you is already in a duel." });
    seq = (seq + 1) % 100000;
    const id = `duel_${Date.now().toString(36)}_${seq}`;
    const placeId = exports.PVP_PLACE_BASE + seq * 10 + Math.floor(Math.random() * ARENA_VARIANTS);
    const duel = { id, a: a.owner, b: b.owner, placeId, joined: new Set(), live: false, startAt: 0, arriveTimer: null };
    duels.set(id, duel);
    duelOf.set(a.owner, id);
    duelOf.set(b.owner, id);
    // somebody never turned up - the duel is off, nobody wins
    duel.arriveTimer = setTimeout(() => {
        if (!duels.has(id) || duel.live)
            return;
        [duel.a, duel.b].forEach(o => send(o, "duel-cancelled", { duelId: id, text: "The duel was called off - your opponent never arrived." }));
        dropDuel(duel);
    }, ARRIVE_TIMEOUT_MS);
    send(a.owner, "duel-begin", { duelId: id, placeId, side: "a", opponent: brief(b) });
    send(b.owner, "duel-begin", { duelId: id, placeId, side: "b", opponent: brief(a) });
}
function endDuel(duel, loser, reason) {
    if (!duels.has(duel.id))
        return;
    const winner = duel.a === loser ? duel.b : duel.a;
    const out = {
        duelId: duel.id, winner, loser, reason,
        winnerName: player(winner)?.name ?? "?", loserName: player(loser)?.name ?? "?",
        durationMs: duel.live && duel.startAt ? Math.max(0, Date.now() - duel.startAt) : 0,
    };
    // a duel that never went live (someone left on the way) is just called off
    if (!duel.live) {
        ;
        [duel.a, duel.b].forEach(o => send(o, "duel-cancelled", { duelId: duel.id, text: `The duel was called off - ${out.loserName} withdrew.` }));
    }
    else {
        send(duel.a, "duel-over", out);
        send(duel.b, "duel-over", out);
    }
    dropDuel(duel);
}
function dropDuel(duel) {
    clearTimeout(duel.arriveTimer);
    duels.delete(duel.id);
    if (duelOf.get(duel.a) === duel.id)
        duelOf.delete(duel.a);
    if (duelOf.get(duel.b) === duel.id)
        duelOf.delete(duel.b);
}
function joinParty(inviter, joiner) {
    if (partyOf.has(joiner.owner))
        leaveParty(joiner.owner);
    let party = parties.get(partyOf.get(inviter.owner) ?? "");
    if (!party) {
        party = { id: `party_${Date.now().toString(36)}_${inviter.owner}`, leader: inviter.owner, members: [inviter.owner] };
        parties.set(party.id, party);
        partyOf.set(inviter.owner, party.id);
    }
    if (party.members.length >= PARTY_MAX)
        return send(joiner.owner, "pvp-notice", { text: "That party is full." });
    party.members.push(joiner.owner);
    partyOf.set(joiner.owner, party.id);
    broadcastParty(party, `${joiner.name} joined the party`);
}
function leaveParty(owner) {
    const party = parties.get(partyOf.get(owner) ?? "");
    partyOf.delete(owner);
    send(owner, "party-updated", { members: [], leader: null });
    if (!party)
        return;
    party.members = party.members.filter(m => m !== owner);
    const name = player(owner)?.name ?? "Someone";
    if (party.members.length <= 1) {
        party.members.forEach(m => { partyOf.delete(m); send(m, "party-updated", { members: [], leader: null, text: `${name} left - the party disbanded` }); });
        parties.delete(party.id);
        return;
    }
    if (party.leader === owner)
        party.leader = party.members[0];
    broadcastParty(party, `${name} left the party`);
}
function broadcastParty(party, text) {
    const members = party.members.map(o => { const p = player(o); return p ? brief(p) : { owner: o, name: "?", lvl: 0 }; });
    party.members.forEach(m => send(m, "party-updated", { members, leader: party.leader, text }));
}
/** The player left (disconnected): a duel they're in is lost, they leave their party. */
function pvpOnDisconnect(owner) {
    const duel = duels.get(duelOf.get(owner) ?? "");
    if (duel)
        endDuel(duel, owner, "forfeit");
    if (partyOf.has(owner))
        leaveParty(owner);
    for (const [key, inv] of invites)
        if (inv.from === owner || inv.to === owner)
            invites.delete(key);
}
/** The player arrived somewhere (join-world). Walking out of their duel's arena mid-duel loses it. */
function pvpOnPlace(owner, placeId) {
    const duel = duels.get(duelOf.get(owner) ?? "");
    if (!duel)
        return;
    if (placeId === duel.placeId)
        return;
    // still on the way in: not yet arrived. Gone back out after arriving: forfeit
    if (duel.joined.has(owner))
        endDuel(duel, owner, "forfeit");
}
function isPartyMates(a, b) {
    const id = partyOf.get(a);
    return !!id && id === partyOf.get(b);
}
