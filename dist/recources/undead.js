"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNDEAD_SPEED = void 0;
exports.undeadCountFor = undeadCountFor;
exports.createUndeadDirector = createUndeadDirector;
const tools_1 = require("../tools/tools");
const botItems_1 = require("./botItems");
// ============================================================
// THE UNDEAD
// ============================================================
// When the fog rolls in, the dead get up. Each one rises SPAWN_DIST away from
// one player in the open world - its target from the first moment - and comes
// for them at UNDEAD_SPEED, so running away only buys time. How many come for
// a player is that player's level halved, rounded down, never fewer than one
// (level 5 -> 2). How they fight is that level too:
//
//   below ELITE_LEVEL   swing, dodge, block, jump attack
//   ELITE_LEVEL and up  all of that, plus dashstrike, blinkstrike, running
//                       when far off, and healing themselves
//
// At night they rise twice as strong. When the fog lifts they drop where they
// stand - wiped here and on every client.
//
// The client builds each one like a player (createcharacter.js, det.race
// "undead": avatar.glb's skeleton wearing whatever armour it rose in), but
// they are NOT in index.ts's `players` - nothing that hunts, spawns around or
// counts players should ever see one. This file keeps its own list and talks
// to the clients through its own events:
//
//   undead-spawned  { undeads }             new ones, or the whole list for a
//                                           client entering the open world
//   undead-moves    { moves }               every undead that moved or turned
//                                           this tick, in one message
//   undead-action   { ownerId, kind, ... }  swing, dodge, block, jump, dash,
//                                           blink, heal, triumph, evade
//   undead-hp       { ownerId, hp, maxHp }
//   undead-died     { ownerId, killerId }
//   undead-cleared  { owners, reason }      fog lifted, or its target is gone
//
// Their blows on a player go out as the "player-is-hit" a bot's do: the
// victim's own client takes the hp off, since a real player's hp lives there.
// Hits ON them come in through index.ts ("playerIsHit" for a melee blow,
// "undeadIsHit" for a spell) and land in takeHit, the only place their hp
// changes.
const OPENWORLD = { placeId: 888, name: "openworld", areaType: "openworld" };
// a non-physics character's pos.y is its capsule's centre (npcBrain.ts's
// RESTING_Y); the client grounds it on the terrain anyway
const RESTING_Y = 0.75;
// ── movement ──
// MUST match client/src/enemies/undead.js's own UNDEAD_SPEED: the client
// walks each one toward the positions reported here at this speed
exports.UNDEAD_SPEED = 4.5;
// an elite breaks into a run while its target is this far off
const RUN_SPEED = 6.5;
const RUN_FROM_DIST = 9;
const TICK_MS = 100;
// ── rising ──
const SPAWN_DIST = 50;
// a group rises spread over this much of a circle round its target, not all
// out of one spot
const SPAWN_SPREAD = 0.8;
// how often a fog looks for open-world players it has not sent anyone after
// yet (they walked in, or logged in, after it rolled in)
const FOG_SWEEP_MS = 5000;
// level 40 would be 20 skeletons on one player - every one a full avatar on
// every client nearby. These keep a fog survivable for the machine too.
const MAX_PER_PLAYER = 10;
const MAX_UNDEAD = 40;
// ── fighting ──
const ELITE_LEVEL = 10;
const NIGHT_MULT = 2;
// stops and fights inside this
const MELEE_RANGE = 2.1;
// a blow lands if its target is still within this when it connects
const HIT_RANGE = 2.7;
// several on one player close in on their own spot round them
const RING_RADIUS = 1.4;
// special moves are considered this often, not every tick
const DECISION_MS = 450;
const SWING_COOLDOWN_MS = { basic: [1500, 2300], elite: [1100, 1700] };
const SWING = { landMs: 380, busyMs: 700 };
const DODGE = { chance: 0.3, cooldownMs: 2600, dist: 2.2, sideAngle: 1.0, durationMs: 450, invulnMs: 550 };
// a blocked blow keeps this share of its damage
const BLOCK = { chance: 0.32, cooldownMs: 2200, durationMs: 900, keep: 0.15 };
// a swing this close to it (and in front of the swinger) is one it reacts to
const REACT_RANGE = 3.2;
const JUMP = { minDist: 3.2, maxDist: 7, chance: 0.4, cooldownMs: [6000, 9000], durationMs: 800, mult: 1.4 };
const DASH = { minDist: 3, maxDist: 7.5, chance: 0.35, cooldownMs: [6500, 9000], durationMs: 550, mult: 1.5 };
const BLINK = { minDist: 2.5, maxDist: 14, chance: 0.3, cooldownMs: [8000, 11000], vanishMs: 380, strikeMs: 560, mult: 1.75, behind: 1.1 };
const HEAL = { below: 0.45, cooldownMs: 12000, durationMs: 1300, landMs: 900, share: 0.3 };
// A player's weapon on-hit effects (the client's staticRecources/weaponEffects.js,
// riding in on "playerIsHit" as effectsWhenHit): a bash throws it straight back
// from whoever swung, distanceKnockback metres; a stun (a hammer's) holds it for
// stunDuration seconds. Either one cuts short whatever it was doing - a blow
// on its way, a leap, a heal. Neither through a guard.
const KNOCK = { durationMs: 320 };
const STUN_SECONDS = 1.5; // a stun entry with no stunDuration of its own
// how long they stand over a player they killed before falling apart
const TRIUMPH_MS = 3500;
// a failed roll for a special move waits this long before the next try
const RETRY_MS = 1500;
const TAU = Math.PI * 2;
const rand = (min, max) => min + Math.random() * (max - min);
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const round2 = (n) => Math.round(n * 100) / 100;
function weighted(entries) {
    let roll = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);
    for (const [value, w] of entries) {
        roll -= w;
        if (roll < 0)
            return value;
    }
    return entries[entries.length - 1][0];
}
/** max(1, floor(level / 2)) - the formula as asked - capped at MAX_PER_PLAYER. */
function undeadCountFor(lvl) {
    return Math.min(MAX_PER_PLAYER, Math.max(1, Math.floor((lvl ?? 1) / 2)));
}
function statsFor(lvl, night) {
    const mult = night ? NIGHT_MULT : 1;
    return {
        maxHp: Math.round((100 + 30 * lvl) * mult),
        dmg: Math.round((6 + 1.6 * lvl) * mult),
    };
}
// ── what they rise wearing ──
// The warbringer catalogue (botItems.ts) minus boots, which are leg meshes
// shaped for a body - a skeleton has none to swap. Each slot is a roll, so no
// two come up dressed the same.
const SLOT_CHANCE = { armor: 0.8, helmet: 0.6, pauldron: 0.55, gauntlet: 0.55, kneearmor: 0.35 };
// old, cheap metal mostly - an elite's grave was a richer one
const METALS = {
    basic: [["iron", 34], ["bronze", 28], ["steel", 20], ["silver", 9], ["black", 6], ["dragonscale", 3]],
    elite: [["iron", 14], ["bronze", 14], ["steel", 24], ["silver", 18], ["black", 18], ["dragonscale", 12]],
};
// hand-copied part names that already render (index.ts's BOT_SWORDS,
// hiddenHoards.ts's spears) - nothing that glows, since the glow layer would
// shine it through walls
const SWORD_PARTS = { bladeRarity: "common1", guardRarity: "common1", handleRarity: "common1", pommelRarity: "common1" };
const SPEAR_PARTS = { bladeRarity: "rare1", guardRarity: "rare1", handleRarity: "rare1", pommelRarity: "rare1" };
const WEAPONS = [
    { name: "gravebrand", dn: "Gravebrand", weaponType: "sword", parts: { ...SWORD_PARTS, bladeColor: "iron", guardColor: "black", handleColor: "bone", pommelColor: "black" } },
    { name: "rustedoath", dn: "Rusted Oath", weaponType: "sword", parts: { ...SWORD_PARTS, bladeColor: "steel", guardColor: "bronze", handleColor: "leather", pommelColor: "silver" } },
    { name: "barrowblade", dn: "Barrow Blade", weaponType: "sword", parts: { ...SWORD_PARTS, bladeColor: "black", guardColor: "iron", handleColor: "bone", pommelColor: "black" } },
    { name: "gravepike", dn: "Grave Pike", weaponType: "spear", parts: { ...SPEAR_PARTS, bladeColor: "iron", guardColor: "black", handleColor: "bone", pommelColor: "black" } },
];
function buildUndeadItems(elite) {
    const items = [];
    const metals = METALS[elite ? "elite" : "basic"];
    for (const [slot, chance] of Object.entries(SLOT_CHANCE)) {
        if (Math.random() >= chance)
            continue;
        const template = pickOne(botItems_1.WARBRINGER_ITEMS.filter(t => t.itemType === slot));
        if (!template)
            continue;
        items.push({ ...(0, botItems_1.buildEquipableItem)(template, weighted(metals)), itemId: `undead-item-${(0, tools_1.randNumString)()}`, equiped: true });
    }
    const weapon = weighted(WEAPONS.map(w => [w, w.weaponType === "spear" ? 1 : 3]));
    items.push({
        itemId: `undead-item-${(0, tools_1.randNumString)()}`,
        name: weapon.name,
        dn: weapon.dn,
        itemCateg: "equipable",
        itemType: "weapon",
        weaponType: weapon.weaponType,
        equipAbilities: { dmg: 14, def: 0, magicDmg: 0, plusStr: 0, plusDex: 0, plusInt: 0 },
        consumeAbilities: { plusHp: 0, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0 },
        equiped: true,
        soulFeed: 0,
        isEnhanceAble: false,
        enhancedLevel: 0,
        slots: [],
        durability: { current: 100, max: 100 },
        price: { coinType: "bronze", pieces: 1 },
        qnty: 1,
        rarity: "common",
        parts: weapon.parts,
    });
    return items;
}
function createUndeadDirector(hooks) {
    let undeads = [];
    let fogActive = false;
    // players this fog has already sent its dead after - each gets one wave
    // per fog, so killing yours is how you win the fog
    const sentAfter = new Set();
    const isUndeadOwner = (owner) => !!owner && owner.startsWith("undead_");
    const byOwner = (owner) => undeads.find(u => u.owner === owner && u.alive);
    // a delayed part of an action (a blow landing, a heal taking hold) - skipped
    // if the undead is gone by then
    function later(u, ms, fn) {
        const gen = u.gen;
        setTimeout(() => { if (u.alive && u.gen === gen)
            fn(); }, ms);
    }
    function makeUndead(target, lvl, elite, night, x, z, slot) {
        const owner = `undead_${(0, tools_1.randNumString)()}`;
        const { maxHp, dmg } = statsFor(lvl, night);
        const items = buildUndeadItems(elite);
        const weapon = items.find(itm => itm.itemType === "weapon");
        const player = {
            _id: owner,
            owner,
            ownerId: owner,
            // createcharacter.js only wires a player's melee blows onto bodies
            // that carry a socketId - see its "OPEN PVP" block
            socketId: `undead-socket-${owner}`,
            name: night ? "Nightrisen" : "Risen",
            lvl,
            gender: "male",
            race: "undead",
            currentPlace: OPENWORLD,
            currentPlaceId: OPENWORLD.placeId,
            // "fighting" from the start: createcharacter.js puts the weapon in
            // the hand only for a body created in that mode
            mode: "fighting",
            _moving: false,
            _minning: false,
            _attacking: false,
            pos: { x, y: RESTING_Y, z },
            dirTarg: { x: target.pos.x, y: 0, z: target.pos.z },
            // createcharacter.js turns a new body toward this
            _dirTarg: { x: target.pos.x, z: target.pos.z },
            items,
            skills: [],
            hasWeapon: true,
            weaponBlocking: false,
            magicBlocking: false,
            IsInVulnerable: false,
            hp: maxHp,
            maxHp,
            targetId: target.owner,
            elite,
            night,
        };
        const now = Date.now();
        return {
            owner, player, targetId: target.owner, elite, dmg, hp: maxHp, maxHp,
            weaponName: weapon?.name, weaponType: weapon?.weaponType ?? "sword",
            x, z, yaw: Math.atan2(target.pos.x - x, target.pos.z - z), moving: false, speed: exports.UNDEAD_SPEED,
            slot, alive: true, triumphing: false,
            busyUntil: 0, gen: 0, invulnerableUntil: 0, blockingUntil: 0,
            nextDecisionAt: now, nextSwingAt: now, nextDodgeAt: now, nextBlockAt: now,
            nextJumpAt: now + 2000, nextDashAt: now + 3000, nextBlinkAt: now + 4000, nextHealAt: now,
            sentYaw: NaN, sentMoving: false,
        };
    }
    function spawnFor(target) {
        if (!target?.pos)
            return;
        const lvl = Math.max(1, target.lvl ?? 1);
        const count = Math.min(undeadCountFor(lvl), MAX_UNDEAD - undeads.length);
        if (count <= 0)
            return;
        const night = hooks.isNight();
        const elite = lvl >= ELITE_LEVEL;
        const baseAngle = Math.random() * TAU;
        const spawned = [];
        for (let i = 0; i < count; i++) {
            const angle = baseAngle + (count > 1 ? (i / (count - 1) - 0.5) * 2 * SPAWN_SPREAD : 0);
            const x = target.pos.x + Math.sin(angle) * SPAWN_DIST;
            const z = target.pos.z + Math.cos(angle) * SPAWN_DIST;
            spawned.push(makeUndead(target, lvl, elite, night, x, z, (i / count) * TAU + baseAngle));
        }
        undeads.push(...spawned);
        hooks.emit("undead-spawned", { undeads: spawned.map(u => u.player) });
    }
    function sweepFog() {
        if (!fogActive)
            return;
        hooks.openworldPlayers().forEach(pl => {
            if (sentAfter.has(pl.owner))
                return;
            sentAfter.add(pl.owner);
            spawnFor(pl);
        });
    }
    // gone without a fight - the fog lifted, or there is no one left to hunt
    function crumble(list, reason) {
        const going = list.filter(u => u.alive);
        if (!going.length)
            return;
        going.forEach(u => { u.alive = false; });
        undeads = undeads.filter(u => u.alive);
        hooks.emit("undead-cleared", { owners: going.map(u => u.owner), reason });
    }
    function die(u, killerId) {
        u.alive = false;
        undeads = undeads.filter(other => other.alive);
        hooks.emit("undead-died", { ownerId: u.owner, killerId });
    }
    // ── actions ──
    function emitAction(u, kind, extra = {}) {
        hooks.emit("undead-action", { ownerId: u.owner, kind, x: round2(u.x), z: round2(u.z), yaw: u.yaw, ...extra });
    }
    // a blow connecting - only if its target is still close enough to take it,
    // so stepping back from a swing is a real way not to get hit
    function landBlow(u, dmg) {
        const target = hooks.getPlayer(u.targetId);
        if (!target?.pos || target.currentPlace?.placeId !== OPENWORLD.placeId)
            return;
        if (Math.hypot(target.pos.x - u.x, target.pos.z - u.z) > HIT_RANGE)
            return;
        const dmgToApply = Math.round(dmg);
        hooks.emit("player-is-hit", {
            playerId: u.owner,
            targetId: u.targetId,
            currentPlaceId: OPENWORLD.placeId,
            dmgToApply,
            dmgDetails: { physicalDmg: dmgToApply, weaponDmg: 0, magicDmg: 0, accuracy: 1 },
            isPhysical: true,
        });
    }
    function stopMoving(u) {
        u.moving = false;
        u.player._moving = false;
    }
    function swing(u, now) {
        const [min, max] = u.elite ? SWING_COOLDOWN_MS.elite : SWING_COOLDOWN_MS.basic;
        u.nextSwingAt = now + rand(min, max);
        u.busyUntil = now + SWING.busyMs;
        const animName = pickOne(u.weaponType === "spear" ? ["spearattack1", "spearattack2"] : ["swordattack1", "swordattack2"]);
        emitAction(u, "swing", { animName, weaponName: u.weaponName, weaponType: u.weaponType });
        later(u, SWING.landMs, () => landBlow(u, u.dmg));
    }
    // the target's own spot, `back` short of it along the line from the undead
    function shortOf(u, target, dist, back) {
        const k = Math.max(0, dist - back) / Math.max(dist, 0.01);
        return { x: round2(u.x + (target.pos.x - u.x) * k), z: round2(u.z + (target.pos.z - u.z) * k) };
    }
    // a leap onto them from mid range - any undead, any level
    function tryJump(u, target, dist, now) {
        if (now < u.nextJumpAt || dist < JUMP.minDist || dist > JUMP.maxDist)
            return false;
        if (Math.random() > JUMP.chance) {
            u.nextJumpAt = now + RETRY_MS;
            return false;
        }
        u.nextJumpAt = now + rand(JUMP.cooldownMs[0], JUMP.cooldownMs[1]);
        const from = { x: round2(u.x), z: round2(u.z) };
        const to = shortOf(u, target, dist, 1.1);
        u.busyUntil = now + JUMP.durationMs + 200;
        stopMoving(u);
        emitAction(u, "jump", { from, to, durationMs: JUMP.durationMs, weaponName: u.weaponName });
        later(u, JUMP.durationMs, () => {
            u.x = to.x;
            u.z = to.z;
            landBlow(u, u.dmg * JUMP.mult);
        });
        return true;
    }
    function tryDash(u, target, dist, now) {
        if (now < u.nextDashAt || dist < DASH.minDist || dist > DASH.maxDist)
            return false;
        if (Math.random() > DASH.chance) {
            u.nextDashAt = now + RETRY_MS;
            return false;
        }
        u.nextDashAt = now + rand(DASH.cooldownMs[0], DASH.cooldownMs[1]);
        const from = { x: round2(u.x), z: round2(u.z) };
        const to = shortOf(u, target, dist, 1);
        u.busyUntil = now + DASH.durationMs + 250;
        stopMoving(u);
        emitAction(u, "dash", { from, to, durationMs: DASH.durationMs, weaponName: u.weaponName });
        later(u, DASH.durationMs, () => {
            u.x = to.x;
            u.z = to.z;
            landBlow(u, u.dmg * DASH.mult);
        });
        return true;
    }
    // gone in a puff and out again behind them, already swinging
    function tryBlink(u, target, dist, now) {
        if (now < u.nextBlinkAt || dist < BLINK.minDist || dist > BLINK.maxDist)
            return false;
        if (Math.random() > BLINK.chance) {
            u.nextBlinkAt = now + RETRY_MS;
            return false;
        }
        u.nextBlinkAt = now + rand(BLINK.cooldownMs[0], BLINK.cooldownMs[1]);
        // behind is where they are not looking - their facing off their own
        // reported dirTarg, or failing that, the far side from the undead
        let fx = (target.dirTarg?.x ?? 0) - target.pos.x;
        let fz = (target.dirTarg?.z ?? 0) - target.pos.z;
        let fl = Math.hypot(fx, fz);
        if (!(fl > 0.01)) {
            fx = target.pos.x - u.x;
            fz = target.pos.z - u.z;
            fl = Math.max(dist, 0.01);
        }
        const from = { x: round2(u.x), z: round2(u.z) };
        const to = { x: round2(target.pos.x - fx / fl * BLINK.behind), z: round2(target.pos.z - fz / fl * BLINK.behind) };
        const yaw = Math.atan2(target.pos.x - to.x, target.pos.z - to.z);
        u.busyUntil = now + BLINK.strikeMs + 500;
        stopMoving(u);
        const animName = u.weaponType === "spear" ? "spearattack1" : "swordattack2";
        emitAction(u, "blink", { from, to, toYaw: yaw, vanishMs: BLINK.vanishMs, animName, weaponName: u.weaponName, weaponType: u.weaponType });
        later(u, BLINK.vanishMs, () => {
            u.x = to.x;
            u.z = to.z;
            u.yaw = yaw;
        });
        later(u, BLINK.strikeMs, () => landBlow(u, u.dmg * BLINK.mult));
        return true;
    }
    function tryHeal(u, now) {
        if (now < u.nextHealAt || u.hp > u.maxHp * HEAL.below)
            return false;
        u.nextHealAt = now + HEAL.cooldownMs;
        u.busyUntil = now + HEAL.durationMs;
        stopMoving(u);
        emitAction(u, "heal", { durationMs: HEAL.durationMs });
        later(u, HEAL.landMs, () => {
            u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * HEAL.share));
            u.player.hp = u.hp;
            hooks.emit("undead-hp", { ownerId: u.owner, hp: u.hp, maxHp: u.maxHp });
        });
        return true;
    }
    function dodge(u, from, now) {
        const ax = u.x - from.x;
        const az = u.z - from.z;
        const al = Math.hypot(ax, az) || 1;
        // back and off to one side - never straight back into the next swing
        const angle = Math.atan2(ax / al, az / al) + (Math.random() < 0.5 ? 1 : -1) * DODGE.sideAngle;
        const start = { x: round2(u.x), z: round2(u.z) };
        u.x = round2(u.x + Math.sin(angle) * DODGE.dist);
        u.z = round2(u.z + Math.cos(angle) * DODGE.dist);
        // still facing whoever swung
        u.yaw = Math.atan2(from.x - u.x, from.z - u.z);
        u.invulnerableUntil = now + DODGE.invulnMs;
        u.busyUntil = now + DODGE.durationMs + 100;
        u.nextDodgeAt = now + DODGE.cooldownMs;
        stopMoving(u);
        emitAction(u, "dodge", { from: start, to: { x: u.x, z: u.z }, durationMs: DODGE.durationMs });
    }
    // ── a player's weapon effects ──
    function triggerMet(triggerWhen, hit) {
        if (!triggerWhen || triggerWhen === "always")
            return true;
        if (triggerWhen === "critical")
            return !!hit.isCritical;
        return false;
    }
    function triggered(effects, effectName, hit) {
        if (!Array.isArray(effects))
            return null;
        return effects.find(effect => effect?.effectName === effectName && triggerMet(effect.triggerWhen, hit)) ?? null;
    }
    function knockBack(u, attackerId, distance, now) {
        const attacker = hooks.getPlayer(attackerId);
        if (!attacker?.pos || !(distance > 0))
            return;
        let dx = u.x - attacker.pos.x;
        let dz = u.z - attacker.pos.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) {
            dx = Math.sin(u.yaw);
            dz = Math.cos(u.yaw);
        }
        else {
            dx /= len;
            dz /= len;
        }
        const from = { x: round2(u.x), z: round2(u.z) };
        u.x = round2(u.x + dx * distance);
        u.z = round2(u.z + dz * distance);
        // still facing whoever hit it
        u.yaw = Math.atan2(attacker.pos.x - u.x, attacker.pos.z - u.z);
        u.busyUntil = Math.max(u.busyUntil, now + KNOCK.durationMs + 150);
        stopMoving(u);
        emitAction(u, "knocked", { from, to: { x: u.x, z: u.z }, durationMs: KNOCK.durationMs });
    }
    function stun(u, seconds, now) {
        const ms = Math.max(0, seconds) * 1000;
        if (!(ms > 0))
            return;
        u.busyUntil = Math.max(u.busyUntil, now + ms);
        stopMoving(u);
        emitAction(u, "stunned", { durationMs: ms });
    }
    function block(u, from, now) {
        u.yaw = Math.atan2(from.x - u.x, from.z - u.z);
        u.blockingUntil = now + BLOCK.durationMs;
        u.busyUntil = u.blockingUntil;
        u.nextBlockAt = now + BLOCK.cooldownMs;
        stopMoving(u);
        emitAction(u, "block", { durationMs: BLOCK.durationMs });
    }
    // ── the loop ──
    function tickOne(u, now, moves) {
        if (u.triumphing)
            return;
        const target = hooks.getPlayer(u.targetId);
        if (!target?.pos || target.currentPlace?.placeId !== OPENWORLD.placeId) {
            crumble([u], "target-gone");
            return;
        }
        if (now < u.busyUntil)
            return;
        const tx = target.pos.x;
        const tz = target.pos.z;
        const dist = Math.hypot(tx - u.x, tz - u.z);
        if (now >= u.nextDecisionAt) {
            u.nextDecisionAt = now + DECISION_MS;
            if (u.elite && tryHeal(u, now))
                return;
            if (tryJump(u, target, dist, now))
                return;
            if (u.elite && tryDash(u, target, dist, now))
                return;
            if (u.elite && tryBlink(u, target, dist, now))
                return;
        }
        if (dist <= MELEE_RANGE) {
            u.yaw = Math.atan2(tx - u.x, tz - u.z);
            if (now >= u.nextSwingAt) {
                stopMoving(u);
                u.sentMoving = false;
                u.sentYaw = u.yaw;
                swing(u, now);
                return;
            }
            stopMoving(u);
        }
        else {
            // on its own spot round the target once close, straight at them
            // from further off
            const near = dist < 5;
            const gx = near ? tx + Math.sin(u.slot) * RING_RADIUS : tx;
            const gz = near ? tz + Math.cos(u.slot) * RING_RADIUS : tz;
            const gdx = gx - u.x;
            const gdz = gz - u.z;
            const gd = Math.hypot(gdx, gdz);
            u.speed = u.elite && dist > RUN_FROM_DIST ? RUN_SPEED : exports.UNDEAD_SPEED;
            if (gd > 0.05) {
                const step = Math.min(u.speed * TICK_MS / 1000, gd);
                u.x += gdx / gd * step;
                u.z += gdz / gd * step;
                u.yaw = Math.atan2(gdx, gdz);
                u.moving = true;
                u.player._moving = true;
            }
            else {
                u.yaw = Math.atan2(tx - u.x, tz - u.z);
                stopMoving(u);
            }
        }
        u.player.pos.x = u.x;
        u.player.pos.z = u.z;
        // nothing to tell anyone about a still one that has not turned
        if (!u.moving && !u.sentMoving && Math.abs(u.yaw - u.sentYaw) < 0.15)
            return;
        u.sentMoving = u.moving;
        u.sentYaw = u.yaw;
        moves.push({ o: u.owner, x: round2(u.x), z: round2(u.z), y: Math.round(u.yaw * 1000) / 1000, m: u.moving ? 1 : 0, s: u.speed });
    }
    setInterval(() => {
        if (!undeads.length)
            return;
        const now = Date.now();
        const moves = [];
        // a copy - an undead can crumble mid-loop
        undeads.slice().forEach(u => { if (u.alive)
            tickOne(u, now, moves); });
        if (moves.length)
            hooks.emit("undead-moves", { moves });
    }, TICK_MS);
    setInterval(sweepFog, FOG_SWEEP_MS);
    return {
        /** Every undead standing right now, in the shape the client builds bodies from. */
        list() {
            return undeads.filter(u => u.alive).map(u => ({ ...u.player, pos: { x: round2(u.x), y: RESTING_Y, z: round2(u.z) }, hp: u.hp }));
        },
        isUndead: isUndeadOwner,
        onWeatherChanged(weather) {
            if (weather === "fog" && !fogActive) {
                fogActive = true;
                sentAfter.clear();
                sweepFog();
            }
            else if (weather !== "fog" && fogActive) {
                fogActive = false;
                sentAfter.clear();
                crumble(undeads, "fog-lifted");
            }
        },
        // a player swung (index.ts's "emitPlayerAttack") - any undead close in
        // front of the swing may roll out of it, or get its guard up
        onPlayerSwing(attackerOwner, pos, dirTarg) {
            if (!pos)
                return;
            const now = Date.now();
            undeads.forEach(u => {
                if (!u.alive || u.triumphing || now < u.busyUntil)
                    return;
                if (Math.hypot(u.x - pos.x, u.z - pos.z) > REACT_RANGE)
                    return;
                if (dirTarg) {
                    const fx = dirTarg.x - pos.x;
                    const fz = dirTarg.z - pos.z;
                    if (fx * (u.x - pos.x) + fz * (u.z - pos.z) < 0)
                        return;
                }
                if (now >= u.nextDodgeAt && Math.random() < DODGE.chance)
                    return dodge(u, pos, now);
                if (now >= u.nextBlockAt && Math.random() < BLOCK.chance)
                    return block(u, pos, now);
            });
        },
        /**
         * A blow on an undead. Returns false when `targetId` is not one, so
         * index.ts can hand every other hit to its own bot/player handling.
         */
        // hit: the blow's isCritical and the weapon's effectsWhenHit (a melee blow's)
        takeHit(targetId, rawDmg, attackerId, isMagic, hit = {}) {
            if (!isUndeadOwner(targetId))
                return false;
            const u = byOwner(targetId);
            if (!u)
                return true;
            const now = Date.now();
            // rolled out of it - nothing lands
            if (now < u.invulnerableUntil) {
                emitAction(u, "evade");
                return true;
            }
            let dmg = isMagic ? rawDmg : (0, botItems_1.botDamageAfterArmor)(u.player.items, rawDmg);
            const guarded = !isMagic && now < u.blockingUntil;
            if (guarded)
                dmg = Math.max(1, dmg * BLOCK.keep);
            dmg = Math.max(0, Math.round(dmg || 0));
            u.hp -= dmg;
            u.player.hp = u.hp;
            hooks.emit("player-is-hit", {
                playerId: attackerId,
                targetId,
                currentPlaceId: OPENWORLD.placeId,
                dmgToApply: dmg,
                dmgDetails: { physicalDmg: dmg, weaponDmg: 0, magicDmg: 0, accuracy: 1 },
                isPhysical: !isMagic,
            });
            hooks.emit("undead-hp", { ownerId: u.owner, hp: Math.max(0, u.hp), maxHp: u.maxHp });
            if (u.hp <= 0) {
                die(u, attackerId);
                return true;
            }
            // the weapon's bash and stun - knocked off whatever it was doing
            if (!isMagic && !guarded && !u.triumphing) {
                const bash = triggered(hit.effectsWhenHit, "bash", hit);
                const daze = triggered(hit.effectsWhenHit, "stun", hit);
                if (bash || daze)
                    u.gen++;
                if (bash)
                    knockBack(u, attackerId, Number(bash.distanceKnockback) || 0, now);
                if (daze)
                    stun(u, Number(daze.stunDuration ?? STUN_SECONDS), now);
            }
            return true;
        },
        // a player left the open world one way or another. Killed: their dead
        // stand over them a moment, then fall apart. Logged off or walked
        // out: theirs just fall apart.
        onPlayerGone(owner, reason) {
            const theirs = undeads.filter(u => u.alive && u.targetId === owner);
            if (!theirs.length)
                return;
            if (reason !== "died")
                return crumble(theirs, "target-gone");
            theirs.forEach(u => {
                u.triumphing = true;
                stopMoving(u);
                emitAction(u, "triumph");
                setTimeout(() => crumble([u], "target-died"), TRIUMPH_MS);
            });
        },
    };
}
