"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMANDS = void 0;
exports.restoreOverlay = restoreOverlay;
const tools_1 = require("../tools/tools");
const types_1 = require("./types");
const catalog_1 = require("./catalog");
const dungeonLayouts_1 = require("../recources/dungeonLayouts");
const enemyDetails_1 = require("../recources/enemyDetails");
const treasures_1 = require("../recources/treasures");
const mushroomLibrary_1 = require("../recources/mushroomLibrary");
const ores_1 = require("../recources/ores");
const weather_1 = require("../recources/weather");
const dayNight_1 = require("../recources/dayNight");
const geo_1 = require("./geo");
const persistence_1 = require("./persistence");
// ── limits and validation ────────────────────────────────────────────────────
const MAX_SPAWN = 100; // enemies in one command
const MAX_CHESTS = 20;
const MAX_PICKUPS = 300; // grains or mushrooms in one command
const MAX_LIST = 500; // rows a list returns
const COORD_LIMIT = 1000000;
function num(value, label, min = -Infinity, max = Infinity) {
    const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) {
        const bounds = [Number.isFinite(min) ? `from ${min}` : "", Number.isFinite(max) ? `to ${max}` : ""].filter(Boolean).join(" ");
        return (0, types_1.fail)(`${label} must be a number${bounds ? " " + bounds : ""}`);
    }
    return n;
}
function int(value, label, min, max) {
    const n = num(value, label, min, max);
    return Number.isInteger(n) ? n : (0, types_1.fail)(`${label} must be a whole number`);
}
function text(value, label, max = 200) {
    if (typeof value !== "string" || !value.trim())
        return (0, types_1.fail)(`${label} is required`);
    return value.length > max ? (0, types_1.fail)(`${label} is too long (${max} characters at most)`) : value.trim();
}
const flag = (value) => value === true || value === "true" || value === 1;
function knownPlace(placeId) {
    const id = int(placeId, "place", 0, 100000);
    return (0, catalog_1.placeById)(id) ?? (0, types_1.fail)(`there's no place ${id}`);
}
const isBot = (ctx, owner) => ctx.world.bots.some(bot => bot.player.owner === owner);
function onlinePlayer(ctx, owner, allowBot = false) {
    const player = ctx.world.players.find(pl => pl.owner === text(owner, "player"));
    if (!player)
        return (0, types_1.fail)("that player isn't online");
    if (!allowBot && isBot(ctx, player.owner))
        return (0, types_1.fail)(`${player.name} is a bot`);
    return player;
}
function where(ctx, p) {
    if (p.playerOwner) {
        const player = onlinePlayer(ctx, p.playerOwner, true);
        if (!player.pos)
            return (0, types_1.fail)(`${player.name}'s position isn't known yet`);
        return { placeId: player.currentPlace.placeId, x: player.pos.x, z: player.pos.z, player };
    }
    const place = knownPlace(p.placeId);
    return { placeId: place.placeId, x: num(p.x, "x", -COORD_LIMIT, COORD_LIMIT), z: num(p.z, "z", -COORD_LIMIT, COORD_LIMIT) };
}
const placeLabel = (placeId) => (0, catalog_1.placeById)(placeId)?.name ?? `place ${placeId}`;
// ── saved-with-restart bookkeeping ───────────────────────────────────────────
// Everything an admin adds carries `adminKey`; with "keep" on it's also saved
// (persistence.ts) under that key, and forgotten again when it's removed here.
function stamp(entity, keep) {
    entity.adminKey = (0, tools_1.randNumString)();
    entity.keep = keep;
    return entity.adminKey;
}
function forget(kind, entity) {
    if (!kind)
        return;
    if (entity.adminKey && entity.keep)
        persistence_1.store.remove(kind, entity.adminKey);
}
// ── enemies ──────────────────────────────────────────────────────────────────
// A freshly generated enemy, set down where it will stand: on a real floor in a
// dungeon, with the room it wanders in, tagged as the admin's, and (when kept)
// written to the saved placements. Also how saved ones come back after a restart.
function prepareEnemy(enemy, kindName, placeId, respawn, keep, key, taken) {
    const spot = (0, geo_1.ground)(placeId, enemy.x, enemy.z, taken);
    enemy.x = (0, geo_1.round2)(spot.x);
    enemy.y = spot.y;
    enemy.z = (0, geo_1.round2)(spot.z);
    enemy.origPos = { x: enemy.x, y: enemy.y, z: enemy.z };
    const dungeon = dungeonLayouts_1.DUNGEONS.get(placeId);
    if (dungeon)
        enemy.homeRoom = (0, geo_1.homeRoomFor)(dungeon, enemy.x, enemy.z);
    if (placeId === 888)
        enemy.territory = enemyDetails_1.OPENWORLD_SLIME_TERRITORY;
    // the base's own respawnDetails is shared by every enemy made from it
    enemy.respawnDetails = { willRespawn: respawn, respawnTime: enemy.respawnDetails?.respawnTime ?? 60000 };
    if (key) {
        enemy.adminKey = key;
        enemy.keep = keep;
    }
    else {
        const newKey = stamp(enemy, keep);
        if (keep)
            persistence_1.store.add("enemies", { key: newKey, name: kindName, placeId, x: enemy.x, y: enemy.y, z: enemy.z, respawn });
    }
}
function spawnEnemies(ctx, p) {
    const kind = (0, catalog_1.enemyKind)(text(p.name, "enemy")) ?? (0, types_1.fail)("unknown enemy type");
    const count = int(p.count ?? 1, "count", 1, MAX_SPAWN);
    const at = where(ctx, p);
    const radius = num(p.radius ?? 0, "radius", 0, 3000);
    const respawn = flag(p.respawn);
    const keep = flag(p.keep);
    // a ring of `radius` around the spot, or exactly on it for a lone enemy
    const made = kind.gen(count, at.placeId, 300, count === 1 && radius === 0 ? "fixed" : "ring", at.x, at.z, 0, radius);
    const taken = new Set();
    made.forEach(enemy => prepareEnemy(enemy, kind.name, at.placeId, respawn, keep, undefined, taken));
    ctx.world.enemies.push(...made);
    ctx.io.emit("enemy-respawned", ctx.world.enemies);
    return { spawned: made.length };
}
function removeEnemies(ctx, ids) {
    const gone = ctx.world.enemies.filter(enemy => ids.has(enemy._id));
    ctx.world.enemies = ctx.world.enemies.filter(enemy => !ids.has(enemy._id));
    gone.forEach(enemy => {
        forget("enemies", enemy);
        ctx.io.emit("enemy-removed", enemy._id);
    });
    return { removed: gone.length };
}
const idList = (value, label, max = 1000) => {
    if (!Array.isArray(value) || !value.length)
        return (0, types_1.fail)(`${label}: nothing selected`);
    if (value.length > max)
        return (0, types_1.fail)(`${label}: too many at once (${max} at most)`);
    return new Set(value.map(id => text(id, "id", 80)));
};
function listEnemies(ctx, p) {
    const placeId = p.placeId == null || p.placeId === "" ? null : int(p.placeId, "place", 0, 100000);
    const name = p.name ? text(p.name, "name") : null;
    const rows = ctx.world.enemies
        .filter(enemy => (placeId === null || enemy.currentPlaceId === placeId) && (!name || enemy.name === name));
    return {
        total: rows.length,
        rows: rows.slice(0, MAX_LIST).map(enemy => ({
            id: enemy._id, name: enemy.name, dn: enemy.dn, placeId: enemy.currentPlaceId,
            x: (0, geo_1.round2)(enemy.x), z: (0, geo_1.round2)(enemy.z), hp: Math.round(enemy.hp), maxHp: enemy.maxHp,
            target: enemy._targetId || null, admin: !!enemy.adminKey, keep: !!enemy.keep,
        })),
    };
}
// ── chests, grains, mushrooms ────────────────────────────────────────────────
function parseCustomItem(raw) {
    let item = raw;
    if (typeof raw === "string") {
        if (raw.length > 10000)
            return (0, types_1.fail)("the item JSON is too long");
        try {
            item = JSON.parse(raw);
        }
        catch {
            return (0, types_1.fail)("the item isn't valid JSON");
        }
    }
    if (!item || typeof item !== "object" || Array.isArray(item))
        return (0, types_1.fail)("the item must be a JSON object");
    ["name", "dn", "itemCateg", "itemType"].forEach(field => { if (typeof item[field] !== "string" || !item[field])
        (0, types_1.fail)(`the item needs a "${field}" text`); });
    if (!(Number(item.qnty) >= 1))
        (0, types_1.fail)('the item needs a "qnty" of 1 or more');
    return JSON.parse(JSON.stringify(item));
}
function placeTreasures(ctx, p) {
    const at = where(ctx, p);
    const count = int(p.count ?? 1, "chests", 1, MAX_CHESTS);
    const radius = num(p.radius ?? 0, "radius", 0, 500);
    const qnty = int(p.qnty ?? 1, "amount", 1, 999);
    const keep = flag(p.keep);
    let build;
    if (p.preset === "custom") {
        const item = parseCustomItem(p.customItem);
        build = () => ({ ...JSON.parse(JSON.stringify(item)), itemId: (0, tools_1.randNumString)() });
    }
    else {
        const preset = (0, catalog_1.itemPreset)(text(p.preset, "item")) ?? (0, types_1.fail)("unknown item");
        build = () => preset.build(qnty);
    }
    const added = [];
    const taken = new Set();
    for (let i = 0; i < count; i++) {
        const pt = (0, geo_1.scatter)(at.x, at.z, radius);
        const spot = (0, geo_1.ground)(at.placeId, pt.x, pt.z, taken);
        const chest = (0, treasures_1.createTreasure)({ x: (0, geo_1.round2)(spot.x), y: spot.y, z: (0, geo_1.round2)(spot.z) }, at.placeId, build());
        const key = stamp(chest, keep);
        if (keep)
            persistence_1.store.add("treasures", { key, placeId: at.placeId, x: chest.pos.x, y: chest.pos.y, z: chest.pos.z, itemDetail: chest.itemDetail });
        added.push(chest);
    }
    ctx.world.treasures.push(...added);
    ctx.io.emit("treasure-added", added);
    return { placed: added.length };
}
function addGrains(ctx, p) {
    const at = where(ctx, p);
    const count = int(p.count ?? 1, "count", 1, MAX_PICKUPS);
    const radius = num(p.radius ?? 4, "radius", 0, 500);
    const keep = flag(p.keep);
    const added = [];
    for (let i = 0; i < count; i++) {
        const pt = (0, geo_1.scatter)(at.x, at.z, radius);
        const spot = (0, geo_1.ground)(at.placeId, pt.x, pt.z);
        const grain = { grainId: (0, tools_1.randNumString)(), pos: { x: (0, geo_1.round2)(spot.x), y: spot.y, z: (0, geo_1.round2)(spot.z) }, currentPlaceId: at.placeId };
        const key = stamp(grain, keep);
        if (keep)
            persistence_1.store.add("grains", { key, placeId: at.placeId, ...grain.pos });
        added.push(grain);
    }
    ctx.world.grains.push(...added);
    ctx.io.emit("grain-added", added);
    return { added: added.length };
}
function addMushrooms(ctx, p) {
    const at = where(ctx, p);
    const count = int(p.count ?? 1, "count", 1, MAX_PICKUPS);
    const radius = num(p.radius ?? 3, "radius", 0, 500);
    const keep = flag(p.keep);
    const wanted = text(p.kind ?? "random", "mushroom kind", 40);
    if (wanted !== "random" && !catalog_1.MUSHROOM_KINDS.some(k => k.kind === wanted))
        (0, types_1.fail)("unknown mushroom kind");
    const added = [];
    for (let i = 0; i < count; i++) {
        const pt = (0, geo_1.scatter)(at.x, at.z, radius);
        const spot = (0, geo_1.ground)(at.placeId, pt.x, pt.z);
        const kind = wanted === "random" ? (0, mushroomLibrary_1.rollMushroomKind)(1).kind : wanted;
        const mushroom = { mushroomId: (0, tools_1.randNumString)(), kind, pos: { x: (0, geo_1.round2)(spot.x), y: spot.y, z: (0, geo_1.round2)(spot.z) }, currentPlaceId: at.placeId };
        const key = stamp(mushroom, keep);
        if (keep)
            persistence_1.store.add("mushrooms", { key, placeId: at.placeId, kind, ...mushroom.pos });
        added.push(mushroom);
    }
    ctx.world.mushrooms.push(...added);
    ctx.io.emit("mushroom-added", added);
    return { added: added.length };
}
// ore deposits an admin puts down - a vein, its hit points, standing like tcp's
// own (recources/ores.ts); one worked out is gone, an hour later a fresh one
// stands there (index.ts). With "keep" it's also saved (persistence.ts) and put
// back after a restart.
function addOres(ctx, p) {
    const at = where(ctx, p);
    const count = int(p.count ?? 1, "count", 1, 50);
    const radius = num(p.radius ?? 3, "radius", 0, 500);
    const keep = flag(p.keep);
    const wanted = text(p.vein, "ore vein", 40);
    if (!(wanted in ores_1.VEINS))
        (0, types_1.fail)("unknown ore vein");
    const added = [];
    const taken = new Set();
    for (let i = 0; i < count; i++) {
        const pt = (0, geo_1.scatter)(at.x, at.z, radius);
        const spot = (0, geo_1.ground)(at.placeId, pt.x, pt.z, taken);
        const ore = (0, ores_1.makeOre)(wanted, { x: spot.x, y: spot.y, z: spot.z }, at.placeId);
        const key = stamp(ore, keep);
        if (keep)
            persistence_1.store.add("ores", { key, placeId: at.placeId, vein: wanted, x: ore.pos.x, y: ore.pos.y, z: ore.pos.z, rotation: ore.rotation });
        added.push(ore);
    }
    ctx.world.ores.push(...added);
    ctx.io.emit("ore-added", added);
    return { added: added.length };
}
// list / remove / clear for the kinds share one shape
const PICKUPS = {
    treasures: { list: (w) => w.treasures, idField: "itemId", removedEvent: "treasure-removed", store: "treasures" },
    grains: { list: (w) => w.grains, idField: "grainId", removedEvent: "grain-removed", store: "grains" },
    mushrooms: { list: (w) => w.mushrooms, idField: "mushroomId", removedEvent: "mushroom-removed", store: "mushrooms" },
    ores: { list: (w) => w.ores, idField: "oreId", removedEvent: "ore-removed", store: "ores" },
};
const pickupKind = (value) => (typeof value === "string" && value in PICKUPS ? value : (0, types_1.fail)("unknown kind"));
function listPickups(ctx, p) {
    const kind = pickupKind(p.kind);
    const def = PICKUPS[kind];
    const placeId = p.placeId == null || p.placeId === "" ? null : int(p.placeId, "place", 0, 100000);
    const rows = def.list(ctx.world).filter((item) => placeId === null || item.currentPlaceId === placeId);
    return {
        total: rows.length,
        rows: rows.slice(0, MAX_LIST).map((item) => ({
            id: item[def.idField], placeId: item.currentPlaceId, x: (0, geo_1.round2)(item.pos.x), z: (0, geo_1.round2)(item.pos.z),
            label: kind === "treasures" ? `${item.itemDetail?.dn ?? "?"}${item.itemDetail?.qnty > 1 ? " x" + item.itemDetail.qnty : ""}` : kind === "mushrooms" ? item.kind : kind === "ores" ? `${item.vein} ore (${item.color}) - ${item.hp}/${item.maxHp} hp` : "grain",
            admin: !!item.adminKey, keep: !!item.keep,
        })),
    };
}
function removePickups(ctx, kind, match) {
    const def = PICKUPS[kind];
    const gone = def.list(ctx.world).filter(match);
    if (!gone.length)
        return { removed: 0 };
    const goneIds = new Set(gone.map((item) => item[def.idField]));
    const rest = def.list(ctx.world).filter((item) => !goneIds.has(item[def.idField]));
    ctx.world[kind] = rest;
    gone.forEach((item) => {
        forget(def.store, item);
        ctx.io.emit(def.removedEvent, item[def.idField]);
    });
    return { removed: gone.length };
}
// ── players ──────────────────────────────────────────────────────────────────
// A player's position belongs to their own game, so moving one is a request to
// that game (client's "admin-teleport" in worldsocket.js): lift = raise them
// straight up out of whatever they're stuck in; x/z (+y) = go there, in the
// same place or another one.
function teleportPlayer(ctx, p) {
    const player = onlinePlayer(ctx, p.owner);
    const current = player.currentPlace.placeId;
    const payload = {};
    if (p.lift != null) {
        payload.lift = num(p.lift, "lift", 1, 100);
    }
    else if (p.toPlayer) {
        const other = onlinePlayer(ctx, p.toPlayer, true);
        if (!other.pos)
            return (0, types_1.fail)(`${other.name}'s position isn't known yet`);
        payload.placeId = other.currentPlace.placeId;
        const spot = (0, geo_1.ground)(payload.placeId, other.pos.x + 1.5, other.pos.z);
        Object.assign(payload, { x: spot.x, y: dungeonLayouts_1.DUNGEONS.has(payload.placeId) ? spot.y : other.pos.y, z: spot.z });
    }
    else if (flag(p.toSpawn) || p.x == null || p.z == null) {
        const place = knownPlace(p.placeId ?? current);
        Object.assign(payload, { placeId: place.placeId, x: place.spawn.x, y: place.spawn.y, z: place.spawn.z });
    }
    else {
        const place = knownPlace(p.placeId ?? current);
        const spot = (0, geo_1.ground)(place.placeId, num(p.x, "x", -COORD_LIMIT, COORD_LIMIT), num(p.z, "z", -COORD_LIMIT, COORD_LIMIT));
        Object.assign(payload, { placeId: place.placeId, x: (0, geo_1.round2)(spot.x), y: p.y != null && p.y !== "" ? num(p.y, "y", -1000, 10000) : (dungeonLayouts_1.DUNGEONS.has(place.placeId) ? spot.y : undefined), z: (0, geo_1.round2)(spot.z) });
    }
    ctx.io.to(player.socketId).emit("admin-teleport", payload);
    // the server's own copy catches up when the game reports its new position;
    // for a move inside the same place, say so now
    if (payload.x != null && (payload.placeId ?? current) === current)
        player.pos = { ...player.pos, x: payload.x, z: payload.z, y: payload.y ?? player.pos?.y ?? 0 };
    return { player: player.name, to: payload.lift ? `${payload.lift}m up` : `${placeLabel(payload.placeId ?? current)} (${(0, geo_1.round2)(payload.x)}, ${(0, geo_1.round2)(payload.z)})` };
}
function messagePlayer(ctx, p) {
    const player = onlinePlayer(ctx, p.owner);
    ctx.io.to(player.socketId).emit("admin-message", { text: text(p.text, "message", 300) });
    return { player: player.name };
}
function kickPlayer(ctx, p) {
    const player = onlinePlayer(ctx, p.owner);
    const reason = p.reason ? text(p.reason, "reason", 200) : "";
    ctx.io.to(player.socketId).emit("admin-kicked", { reason });
    // a beat for the message to arrive before the connection closes
    setTimeout(() => ctx.io.sockets.sockets.get(player.socketId)?.disconnect(true), 400);
    return { player: player.name };
}
// the REST server's own message, as something the admin can read
async function callRest(method, path, body) {
    if (!(0, persistence_1.restConfigured)())
        return (0, types_1.fail)("the REST server isn't set up for the admin (ADMIN_PERSIST is off)");
    try {
        return await (0, persistence_1.requestRest)(method, path, body);
    }
    catch (error) {
        return (0, types_1.fail)(`REST server: ${error?.message ?? error}`);
    }
}
async function findSaved(ctx, p) {
    const query = text(p.q, "name", 60);
    const res = await callRest("GET", `/admin/characters?q=${encodeURIComponent(query)}`);
    return {
        characters: (res?.characters ?? []).map((character) => ({
            ...character,
            online: ctx.world.players.some(player => player.owner === character.owner),
        })),
    };
}
async function repositionSaved(ctx, p) {
    const owner = text(p.owner, "character", 100);
    if (ctx.world.players.some(player => player.owner === owner)) {
        return (0, types_1.fail)("they're online right now - their game would save its own position over this. Use a live teleport instead");
    }
    const place = knownPlace(p.placeId);
    const x = p.x == null || p.x === "" ? place.spawn.x : num(p.x, "x", -COORD_LIMIT, COORD_LIMIT);
    const z = p.z == null || p.z === "" ? place.spawn.z : num(p.z, "z", -COORD_LIMIT, COORD_LIMIT);
    const y = p.y == null || p.y === "" ? (place.spawn.y ?? 1) : num(p.y, "y", -1000, 10000);
    const res = await callRest("POST", `/admin/characters/${encodeURIComponent(owner)}/reposition`, { placeId: place.placeId, name: place.name, areaType: place.areaType, x, y, z });
    return { character: res?.character?.name ?? owner, to: `${place.name} (${(0, geo_1.round2)(x)}, ${(0, geo_1.round2)(z)})` };
}
// ── the world ────────────────────────────────────────────────────────────────
function announce(ctx, p) {
    const message = text(p.text, "announcement", 300);
    // the chat line is for the record, the popup is what gets noticed
    ctx.io.emit("worldChatMessage", { name: "", message, ownerId: "admin", msgType: "system" });
    ctx.io.emit("admin-message", { text: message });
    return { sent: ctx.world.players.length };
}
function spawnBots(ctx, p) {
    const at = where(ctx, p);
    const place = (0, catalog_1.placeById)(at.placeId) ?? (0, types_1.fail)("unknown place");
    const count = int(p.count ?? 1, "count", 1, 10);
    const before = ctx.world.bots.length;
    for (let i = 0; i < count; i++) {
        const spot = (0, geo_1.scatter)(at.x, at.z, 3);
        ctx.world.spawnBot({ attitudeName: "caster", pos: spot, currentPlace: { placeId: place.placeId, name: place.name, areaType: place.areaType } });
    }
    return { spawned: ctx.world.bots.length - before };
}
// ── what's where, for the map ────────────────────────────────────────────────
function mapOf(ctx, p) {
    const placeId = knownPlace(p.placeId).placeId;
    const inPlace = (item) => item.currentPlaceId === placeId;
    const w = ctx.world;
    return {
        placeId,
        players: w.players.filter(pl => pl.currentPlace?.placeId === placeId && pl.pos)
            .map(pl => ({ id: pl.owner, name: pl.name, x: (0, geo_1.round2)(pl.pos.x), z: (0, geo_1.round2)(pl.pos.z), lvl: pl.lvl, bot: isBot(ctx, pl.owner) })),
        enemies: w.enemies.filter(inPlace).slice(0, 2500)
            .map(e => ({ id: e._id, name: e.name, dn: e.dn, x: (0, geo_1.round2)(e.x), z: (0, geo_1.round2)(e.z), hp: Math.round(e.hp), maxHp: e.maxHp, target: !!e._targetId, admin: !!e.adminKey })),
        treasures: w.treasures.filter(inPlace).map(t => ({ id: t.itemId, x: (0, geo_1.round2)(t.pos.x), z: (0, geo_1.round2)(t.pos.z), label: t.itemDetail?.dn ?? "chest" })),
        grains: w.grains.filter(inPlace).slice(0, 2500).map(g => ({ id: g.grainId, x: (0, geo_1.round2)(g.pos.x), z: (0, geo_1.round2)(g.pos.z) })),
        mushrooms: w.mushrooms.filter(inPlace).slice(0, 2500).map(m => ({ id: m.mushroomId, x: (0, geo_1.round2)(m.pos.x), z: (0, geo_1.round2)(m.pos.z), kind: m.kind })),
        ores: w.ores.filter(inPlace).slice(0, 2500).map(o => ({ id: o.oreId, x: (0, geo_1.round2)(o.pos.x), z: (0, geo_1.round2)(o.pos.z), vein: o.vein, color: o.color, hp: o.hp, maxHp: o.maxHp })),
        structures: [
            ...w.bonfires.filter(inPlace).map(s => ({ x: (0, geo_1.round2)(s.pos.x), z: (0, geo_1.round2)(s.pos.z), kind: "bonfire" })),
            ...w.trunks.filter(inPlace).map(s => ({ x: (0, geo_1.round2)(s.pos.x), z: (0, geo_1.round2)(s.pos.z), kind: "log" })),
            ...w.structures.filter(inPlace).map(s => ({ x: (0, geo_1.round2)(s.pos.x), z: (0, geo_1.round2)(s.pos.z), kind: s.kind })),
        ],
    };
}
// ── the registry ─────────────────────────────────────────────────────────────
exports.COMMANDS = {
    // what the page can pick from
    "catalog": {
        audit: false,
        run: () => ({
            enemies: catalog_1.ENEMY_KINDS.map(({ name, dn, group, lvl, maxHp }) => ({ name, dn, group, lvl, maxHp })),
            places: catalog_1.PLACES,
            items: catalog_1.ITEM_PRESETS.map(({ key, label }) => ({ key, label })),
            mushrooms: catalog_1.MUSHROOM_KINDS,
            ores: catalog_1.ORE_VEINS,
            weather: weather_1.WEATHER_TYPES,
        }),
    },
    "map.get": { audit: false, run: mapOf },
    "enemies.list": { audit: false, run: listEnemies },
    "enemies.spawn": {
        audit: true, run: spawnEnemies,
        describe: (p, r) => `${r.spawned} x ${(0, catalog_1.enemyKind)(p.name)?.dn ?? p.name} ${p.playerOwner ? "next to a player" : `at ${placeLabel(Number(p.placeId))} (${p.x}, ${p.z})`}${flag(p.keep) ? ", kept" : ""}`,
    },
    "enemies.remove": {
        audit: true,
        run: (ctx, p) => removeEnemies(ctx, idList(p.ids, "enemies")),
        describe: (p, r) => `${r.removed} enemy removed`,
    },
    "enemies.clear": {
        audit: true,
        run: (ctx, p) => {
            const placeId = int(p.placeId, "place", 0, 100000);
            const name = p.name ? text(p.name, "name") : null;
            const adminOnly = flag(p.adminOnly);
            const ids = new Set(ctx.world.enemies
                .filter(e => e.currentPlaceId === placeId && (!name || e.name === name) && (!adminOnly || e.adminKey))
                .map(e => e._id));
            return removeEnemies(ctx, ids);
        },
        describe: (p, r) => `${r.removed} ${p.name ?? "enemies"} cleared from ${placeLabel(Number(p.placeId))}${flag(p.adminOnly) ? " (admin-spawned only)" : ""}`,
    },
    "pickups.list": { audit: false, run: listPickups },
    "treasures.place": { audit: true, run: placeTreasures, describe: (p, r) => `${r.placed} chest of ${p.preset}${flag(p.keep) ? ", kept" : ""}` },
    "grains.add": { audit: true, run: addGrains, describe: (p, r) => `${r.added} grain${flag(p.keep) ? ", kept" : ""}` },
    "ores.add": { audit: true, run: addOres, describe: (p, r) => `${r.added} ${p.vein} ore${flag(p.keep) ? ", kept" : ""}` },
    "mushrooms.add": { audit: true, run: addMushrooms, describe: (p, r) => `${r.added} ${p.kind ?? "random"} mushroom${flag(p.keep) ? ", kept" : ""}` },
    "pickups.remove": {
        audit: true,
        run: (ctx, p) => {
            const ids = idList(p.ids, "items");
            const kind = pickupKind(p.kind);
            return removePickups(ctx, kind, item => ids.has(item[PICKUPS[kind].idField]));
        },
        describe: (p, r) => `${r.removed} ${p.kind} removed`,
    },
    "pickups.clear": {
        audit: true,
        run: (ctx, p) => {
            const kind = pickupKind(p.kind);
            const placeId = int(p.placeId, "place", 0, 100000);
            const adminOnly = flag(p.adminOnly);
            return removePickups(ctx, kind, item => item.currentPlaceId === placeId && (!adminOnly || item.adminKey));
        },
        describe: (p, r) => `${r.removed} ${p.kind} cleared from ${placeLabel(Number(p.placeId))}${flag(p.adminOnly) ? " (admin-placed only)" : ""}`,
    },
    "players.teleport": { audit: true, run: teleportPlayer, describe: (p, r) => `${r.player} -> ${r.to}` },
    "players.message": { audit: true, run: messagePlayer, describe: (p, r) => `to ${r.player}: ${String(p.text).slice(0, 80)}` },
    "players.kick": { audit: true, run: kickPlayer, describe: (p, r) => `${r.player}${p.reason ? ": " + p.reason : ""}` },
    "saved.find": { audit: false, run: findSaved },
    "saved.reposition": { audit: true, run: repositionSaved, describe: (p, r) => `${r.character} -> ${r.to}` },
    "world.announce": { audit: true, run: announce, describe: p => String(p.text).slice(0, 120) },
    "world.weather": {
        audit: true,
        run: (ctx, p) => {
            const applied = (0, weather_1.setWeather)(text(p.weather, "weather", 20));
            if (!applied)
                return (0, types_1.fail)("unknown weather");
            ctx.io.emit("weather-changed", (0, weather_1.getWeatherState)());
            return { weather: applied };
        },
        describe: (p, r) => r.weather,
    },
    "world.time": {
        audit: true,
        run: (ctx, p) => {
            const applied = (0, dayNight_1.setTimeOfDay)(num(p.timeOfDay, "time of day", 0, 0.999999));
            if (applied === null)
                return (0, types_1.fail)("time of day must be from 0 to 1");
            ctx.io.emit("daynight-sync", (0, dayNight_1.getDayNightState)());
            return { timeOfDay: applied };
        },
        describe: (p, r) => `${(r.timeOfDay * 24).toFixed(1)}h`,
    },
    "bots.toggle": {
        audit: true,
        run: (ctx, p) => { ctx.world.spawnBotsEnabled = flag(p.enabled); return { enabled: ctx.world.spawnBotsEnabled }; },
        describe: (p, r) => (r.enabled ? "bot spawning on" : "bot spawning off"),
    },
    "bots.spawn": { audit: true, run: spawnBots, describe: (p, r) => `${r.spawned} bot` },
    "persist.retry": { audit: true, run: () => { persistence_1.store.retry(); return { status: persistence_1.store.status }; }, describe: () => "retrying the load" },
    "persist.flush": { audit: true, run: async () => { await persistence_1.store.flush(); return { status: persistence_1.store.status }; }, describe: () => "save now" },
};
// ── bringing saved placements back ───────────────────────────────────────────
// After a restart (persistence.ts's load): everything an admin kept is put back
// into the world, once - an entry whose key is already here is skipped.
function restoreOverlay(ctx, saved) {
    const w = ctx.world;
    const haveKey = (list, key) => list.some(item => item.adminKey === key);
    let restored = 0;
    const enemies = [];
    saved.enemies.forEach(entry => {
        const kind = (0, catalog_1.enemyKind)(entry.name);
        if (!kind || haveKey(w.enemies, entry.key))
            return;
        const [enemy] = kind.gen(1, entry.placeId, 300, "fixed", entry.x, entry.z, 0, 0);
        prepareEnemy(enemy, kind.name, entry.placeId, entry.respawn, true, entry.key);
        enemies.push(enemy);
    });
    if (enemies.length) {
        w.enemies.push(...enemies);
        ctx.io.emit("enemy-respawned", w.enemies);
        restored += enemies.length;
    }
    const chests = saved.treasures.filter(entry => !haveKey(w.treasures, entry.key)).map(entry => {
        const chest = (0, treasures_1.createTreasure)({ x: entry.x, y: entry.y, z: entry.z }, entry.placeId, entry.itemDetail);
        chest.adminKey = entry.key;
        chest.keep = true;
        return chest;
    });
    if (chests.length) {
        w.treasures.push(...chests);
        ctx.io.emit("treasure-added", chests);
        restored += chests.length;
    }
    const grains = saved.grains.filter(entry => !haveKey(w.grains, entry.key)).map(entry => ({ grainId: (0, tools_1.randNumString)(), pos: { x: entry.x, y: entry.y, z: entry.z }, currentPlaceId: entry.placeId, adminKey: entry.key, keep: true }));
    if (grains.length) {
        w.grains.push(...grains);
        ctx.io.emit("grain-added", grains);
        restored += grains.length;
    }
    const mushrooms = saved.mushrooms.filter(entry => !haveKey(w.mushrooms, entry.key)).map(entry => ({ mushroomId: (0, tools_1.randNumString)(), kind: entry.kind, pos: { x: entry.x, y: entry.y, z: entry.z }, currentPlaceId: entry.placeId, adminKey: entry.key, keep: true }));
    if (mushrooms.length) {
        w.mushrooms.push(...mushrooms);
        ctx.io.emit("mushroom-added", mushrooms);
        restored += mushrooms.length;
    }
    const ores = (saved.ores ?? []).filter(entry => ores_1.VEINS[entry.vein] && !haveKey(w.ores, entry.key)).map(entry => {
        const ore = (0, ores_1.makeOre)(entry.vein, { x: entry.x, y: entry.y, z: entry.z }, entry.placeId, entry.rotation);
        ore.adminKey = entry.key;
        ore.keep = true;
        return ore;
    });
    if (ores.length) {
        w.ores.push(...ores);
        ctx.io.emit("ore-added", ores);
        restored += ores.length;
    }
    if (restored)
        console.log(`[admin] put ${restored} saved placements back into the world`);
}
