import { randNumString } from "../tools/tools"
import { AdminContext, fail } from "./types"
import { ENEMY_KINDS, enemyKind, PLACES, placeById, ITEM_PRESETS, itemPreset, MUSHROOM_KINDS, ORE_VEINS } from "./catalog"
import { DUNGEONS } from "../recources/dungeonLayouts"
import { OPENWORLD_SLIME_TERRITORY } from "../recources/enemyDetails"
import { createTreasure } from "../recources/treasures"
import { rollMushroomKind } from "../recources/mushroomLibrary"
import { makeOre, VEINS } from "../recources/ores"
import { setWeather, getWeatherState, WEATHER_TYPES } from "../recources/weather"
import { setTimeOfDay, getDayNightState } from "../recources/dayNight"
import { ground, scatter, homeRoomFor, round2 } from "./geo"
import { store, requestRest, restConfigured, Overlay } from "./persistence"

// Everything an admin can do, one function each. A command gets the live world
// and the socket server (see types.ts) and a payload that came off the wire, so
// it checks every field before using it and throws an AdminError (`fail`) with
// a message for the admin when something's wrong. Commands that change the world
// are audited; the ones that only look aren't (audit: false).

export type Command = {
    audit: boolean
    run: (ctx: AdminContext, payload: any) => any | Promise<any>
    // one line for the audit log - what was asked, and what came of it
    describe?: (payload: any, result: any) => string
}

// ── limits and validation ────────────────────────────────────────────────────
const MAX_SPAWN = 100       // enemies in one command
const MAX_CHESTS = 20
const MAX_PICKUPS = 300     // grains or mushrooms in one command
const MAX_LIST = 500        // rows a list returns
const COORD_LIMIT = 1_000_000

function num(value: unknown, label: string, min = -Infinity, max = Infinity): number {
    const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) {
        const bounds = [Number.isFinite(min) ? `from ${min}` : "", Number.isFinite(max) ? `to ${max}` : ""].filter(Boolean).join(" ")
        return fail(`${label} must be a number${bounds ? " " + bounds : ""}`)
    }
    return n
}
function int(value: unknown, label: string, min: number, max: number): number {
    const n = num(value, label, min, max)
    return Number.isInteger(n) ? n : fail(`${label} must be a whole number`)
}
function text(value: unknown, label: string, max = 200): string {
    if (typeof value !== "string" || !value.trim()) return fail(`${label} is required`)
    return value.length > max ? fail(`${label} is too long (${max} characters at most)`) : value.trim()
}
const flag = (value: unknown) => value === true || value === "true" || value === 1

function knownPlace(placeId: unknown) {
    const id = int(placeId, "place", 0, 100000)
    return placeById(id) ?? fail(`there's no place ${id}`)
}

const isBot = (ctx: AdminContext, owner: string) => ctx.world.bots.some(bot => bot.player.owner === owner)

function onlinePlayer(ctx: AdminContext, owner: unknown, allowBot = false) {
    const player = ctx.world.players.find(pl => pl.owner === text(owner, "player"))
    if (!player) return fail("that player isn't online")
    if (!allowBot && isBot(ctx, player.owner)) return fail(`${player.name} is a bot`)
    return player
}

// Where a command acts: next to a player (their place and position), or at x/z
// in a place.
type Where = { placeId: number, x: number, z: number, player?: any }
function where(ctx: AdminContext, p: any): Where {
    if (p.playerOwner) {
        const player = onlinePlayer(ctx, p.playerOwner, true)
        if (!player.pos) return fail(`${player.name}'s position isn't known yet`)
        return { placeId: player.currentPlace.placeId, x: player.pos.x, z: player.pos.z, player }
    }
    const place = knownPlace(p.placeId)
    return { placeId: place.placeId, x: num(p.x, "x", -COORD_LIMIT, COORD_LIMIT), z: num(p.z, "z", -COORD_LIMIT, COORD_LIMIT) }
}

const placeLabel = (placeId: number) => placeById(placeId)?.name ?? `place ${placeId}`

// ── saved-with-restart bookkeeping ───────────────────────────────────────────
// Everything an admin adds carries `adminKey`; with "keep" on it's also saved
// (persistence.ts) under that key, and forgotten again when it's removed here.
function stamp(entity: any, keep: boolean) {
    entity.adminKey = randNumString()
    entity.keep = keep
    return entity.adminKey as string
}
function forget(kind: "enemies" | "treasures" | "grains" | "mushrooms" | "ores" | null, entity: any) {
    if (!kind) return
    if (entity.adminKey && entity.keep) store.remove(kind, entity.adminKey)
}

// ── enemies ──────────────────────────────────────────────────────────────────
// A freshly generated enemy, set down where it will stand: on a real floor in a
// dungeon, with the room it wanders in, tagged as the admin's, and (when kept)
// written to the saved placements. Also how saved ones come back after a restart.
function prepareEnemy(enemy: any, kindName: string, placeId: number, respawn: boolean, keep: boolean, key?: string, taken?: Set<string>) {
    const spot = ground(placeId, enemy.x, enemy.z, taken)
    enemy.x = round2(spot.x)
    enemy.y = spot.y
    enemy.z = round2(spot.z)
    enemy.origPos = { x: enemy.x, y: enemy.y, z: enemy.z }
    const dungeon = DUNGEONS.get(placeId)
    if (dungeon) enemy.homeRoom = homeRoomFor(dungeon, enemy.x, enemy.z)
    if (placeId === 888) enemy.territory = OPENWORLD_SLIME_TERRITORY
    // the base's own respawnDetails is shared by every enemy made from it
    enemy.respawnDetails = { willRespawn: respawn, respawnTime: enemy.respawnDetails?.respawnTime ?? 60_000 }
    if (key) { enemy.adminKey = key; enemy.keep = keep }
    else {
        const newKey = stamp(enemy, keep)
        if (keep) store.add("enemies", { key: newKey, name: kindName, placeId, x: enemy.x, y: enemy.y, z: enemy.z, respawn })
    }
}

function spawnEnemies(ctx: AdminContext, p: any) {
    const kind = enemyKind(text(p.name, "enemy")) ?? fail("unknown enemy type")
    const count = int(p.count ?? 1, "count", 1, MAX_SPAWN)
    const at = where(ctx, p)
    const radius = num(p.radius ?? 0, "radius", 0, 3000)
    const respawn = flag(p.respawn)
    const keep = flag(p.keep)

    // a ring of `radius` around the spot, or exactly on it for a lone enemy
    const made = kind.gen(count, at.placeId, 300, count === 1 && radius === 0 ? "fixed" : "ring", at.x, at.z, 0, radius)
    const taken = new Set<string>()
    made.forEach(enemy => prepareEnemy(enemy, kind.name, at.placeId, respawn, keep, undefined, taken))
    ctx.world.enemies.push(...made)
    ctx.io.emit("enemy-respawned", ctx.world.enemies)
    return { spawned: made.length }
}

function removeEnemies(ctx: AdminContext, ids: Set<string>) {
    const gone = ctx.world.enemies.filter(enemy => ids.has(enemy._id))
    ctx.world.enemies = ctx.world.enemies.filter(enemy => !ids.has(enemy._id))
    gone.forEach(enemy => {
        forget("enemies", enemy)
        ctx.io.emit("enemy-removed", enemy._id)
    })
    return { removed: gone.length }
}

const idList = (value: unknown, label: string, max = 1000): Set<string> => {
    if (!Array.isArray(value) || !value.length) return fail(`${label}: nothing selected`)
    if (value.length > max) return fail(`${label}: too many at once (${max} at most)`)
    return new Set(value.map(id => text(id, "id", 80)))
}

function listEnemies(ctx: AdminContext, p: any) {
    const placeId = p.placeId == null || p.placeId === "" ? null : int(p.placeId, "place", 0, 100000)
    const name = p.name ? text(p.name, "name") : null
    const rows = ctx.world.enemies
        .filter(enemy => (placeId === null || enemy.currentPlaceId === placeId) && (!name || enemy.name === name))
    return {
        total: rows.length,
        rows: rows.slice(0, MAX_LIST).map(enemy => ({
            id: enemy._id, name: enemy.name, dn: enemy.dn, placeId: enemy.currentPlaceId,
            x: round2(enemy.x), z: round2(enemy.z), hp: Math.round(enemy.hp), maxHp: enemy.maxHp,
            target: enemy._targetId || null, admin: !!enemy.adminKey, keep: !!enemy.keep,
        })),
    }
}

// ── chests, grains, mushrooms ────────────────────────────────────────────────
function parseCustomItem(raw: unknown): any {
    let item: any = raw
    if (typeof raw === "string") {
        if (raw.length > 10_000) return fail("the item JSON is too long")
        try { item = JSON.parse(raw) } catch { return fail("the item isn't valid JSON") }
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("the item must be a JSON object")
    ;["name", "dn", "itemCateg", "itemType"].forEach(field => { if (typeof item[field] !== "string" || !item[field]) fail(`the item needs a "${field}" text`) })
    if (!(Number(item.qnty) >= 1)) fail('the item needs a "qnty" of 1 or more')
    return JSON.parse(JSON.stringify(item))
}

function placeTreasures(ctx: AdminContext, p: any) {
    const at = where(ctx, p)
    const count = int(p.count ?? 1, "chests", 1, MAX_CHESTS)
    const radius = num(p.radius ?? 0, "radius", 0, 500)
    const qnty = int(p.qnty ?? 1, "amount", 1, 999)
    const keep = flag(p.keep)

    let build: () => any
    if (p.preset === "custom") {
        const item = parseCustomItem(p.customItem)
        build = () => ({ ...JSON.parse(JSON.stringify(item)), itemId: randNumString() })
    } else {
        const preset = itemPreset(text(p.preset, "item")) ?? fail("unknown item")
        build = () => preset.build(qnty)
    }

    const added: any[] = []
    const taken = new Set<string>()
    for (let i = 0; i < count; i++) {
        const pt = scatter(at.x, at.z, radius)
        const spot = ground(at.placeId, pt.x, pt.z, taken)
        const chest = createTreasure({ x: round2(spot.x), y: spot.y, z: round2(spot.z) }, at.placeId, build())
        const key = stamp(chest, keep)
        if (keep) store.add("treasures", { key, placeId: at.placeId, x: chest.pos.x, y: chest.pos.y, z: chest.pos.z, itemDetail: chest.itemDetail })
        added.push(chest)
    }
    ctx.world.treasures.push(...added)
    ctx.io.emit("treasure-added", added)
    return { placed: added.length }
}

function addGrains(ctx: AdminContext, p: any) {
    const at = where(ctx, p)
    const count = int(p.count ?? 1, "count", 1, MAX_PICKUPS)
    const radius = num(p.radius ?? 4, "radius", 0, 500)
    const keep = flag(p.keep)
    const added: any[] = []
    for (let i = 0; i < count; i++) {
        const pt = scatter(at.x, at.z, radius)
        const spot = ground(at.placeId, pt.x, pt.z)
        const grain = { grainId: randNumString(), pos: { x: round2(spot.x), y: spot.y, z: round2(spot.z) }, currentPlaceId: at.placeId }
        const key = stamp(grain, keep)
        if (keep) store.add("grains", { key, placeId: at.placeId, ...grain.pos })
        added.push(grain)
    }
    ctx.world.grains.push(...added)
    ctx.io.emit("grain-added", added)
    return { added: added.length }
}

function addMushrooms(ctx: AdminContext, p: any) {
    const at = where(ctx, p)
    const count = int(p.count ?? 1, "count", 1, MAX_PICKUPS)
    const radius = num(p.radius ?? 3, "radius", 0, 500)
    const keep = flag(p.keep)
    const wanted = text(p.kind ?? "random", "mushroom kind", 40)
    if (wanted !== "random" && !MUSHROOM_KINDS.some(k => k.kind === wanted)) fail("unknown mushroom kind")
    const added: any[] = []
    for (let i = 0; i < count; i++) {
        const pt = scatter(at.x, at.z, radius)
        const spot = ground(at.placeId, pt.x, pt.z)
        const kind = wanted === "random" ? rollMushroomKind(1).kind : wanted
        const mushroom = { mushroomId: randNumString(), kind, pos: { x: round2(spot.x), y: spot.y, z: round2(spot.z) }, currentPlaceId: at.placeId }
        const key = stamp(mushroom, keep)
        if (keep) store.add("mushrooms", { key, placeId: at.placeId, kind, ...mushroom.pos })
        added.push(mushroom)
    }
    ctx.world.mushrooms.push(...added)
    ctx.io.emit("mushroom-added", added)
    return { added: added.length }
}

// ore deposits an admin puts down - a vein, its hit points, standing like tcp's
// own (recources/ores.ts); one worked out is gone, an hour later a fresh one
// stands there (index.ts). With "keep" it's also saved (persistence.ts) and put
// back after a restart.
function addOres(ctx: AdminContext, p: any) {
    const at = where(ctx, p)
    const count = int(p.count ?? 1, "count", 1, 50)
    const radius = num(p.radius ?? 3, "radius", 0, 500)
    const keep = flag(p.keep)
    const wanted = text(p.vein, "ore vein", 40)
    if (!(wanted in VEINS)) fail("unknown ore vein")
    const added: any[] = []
    const taken = new Set<string>()
    for (let i = 0; i < count; i++) {
        const pt = scatter(at.x, at.z, radius)
        const spot = ground(at.placeId, pt.x, pt.z, taken)
        const ore: any = makeOre(wanted, { x: spot.x, y: spot.y, z: spot.z }, at.placeId)
        const key = stamp(ore, keep)
        if (keep) store.add("ores", { key, placeId: at.placeId, vein: wanted, x: ore.pos.x, y: ore.pos.y, z: ore.pos.z, rotation: ore.rotation })
        added.push(ore)
    }
    ctx.world.ores.push(...added)
    ctx.io.emit("ore-added", added)
    return { added: added.length }
}

// list / remove / clear for the kinds share one shape
const PICKUPS = {
    treasures: { list: (w: AdminContext["world"]) => w.treasures, idField: "itemId", removedEvent: "treasure-removed", store: "treasures" as const },
    grains: { list: (w: AdminContext["world"]) => w.grains, idField: "grainId", removedEvent: "grain-removed", store: "grains" as const },
    mushrooms: { list: (w: AdminContext["world"]) => w.mushrooms, idField: "mushroomId", removedEvent: "mushroom-removed", store: "mushrooms" as const },
    ores: { list: (w: AdminContext["world"]) => w.ores, idField: "oreId", removedEvent: "ore-removed", store: "ores" as const },
}
type PickupKind = keyof typeof PICKUPS
const pickupKind = (value: unknown): PickupKind => (typeof value === "string" && value in PICKUPS ? value as PickupKind : fail("unknown kind"))

function listPickups(ctx: AdminContext, p: any) {
    const kind = pickupKind(p.kind)
    const def = PICKUPS[kind]
    const placeId = p.placeId == null || p.placeId === "" ? null : int(p.placeId, "place", 0, 100000)
    const rows = def.list(ctx.world).filter((item: any) => placeId === null || item.currentPlaceId === placeId)
    return {
        total: rows.length,
        rows: rows.slice(0, MAX_LIST).map((item: any) => ({
            id: item[def.idField], placeId: item.currentPlaceId, x: round2(item.pos.x), z: round2(item.pos.z),
            label: kind === "treasures" ? `${item.itemDetail?.dn ?? "?"}${item.itemDetail?.qnty > 1 ? " x" + item.itemDetail.qnty : ""}` : kind === "mushrooms" ? item.kind : kind === "ores" ? `${item.vein} ore (${item.color}) - ${item.hp}/${item.maxHp} hp` : "grain",
            admin: !!item.adminKey, keep: !!item.keep,
        })),
    }
}

function removePickups(ctx: AdminContext, kind: PickupKind, match: (item: any) => boolean) {
    const def = PICKUPS[kind]
    const gone = def.list(ctx.world).filter(match)
    if (!gone.length) return { removed: 0 }
    const goneIds = new Set(gone.map((item: any) => item[def.idField]))
    const rest = def.list(ctx.world).filter((item: any) => !goneIds.has(item[def.idField]))
    ;(ctx.world as any)[kind] = rest
    gone.forEach((item: any) => {
        forget(def.store, item)
        ctx.io.emit(def.removedEvent, item[def.idField])
    })
    return { removed: gone.length }
}

// ── players ──────────────────────────────────────────────────────────────────
// A player's position belongs to their own game, so moving one is a request to
// that game (client's "admin-teleport" in worldsocket.js): lift = raise them
// straight up out of whatever they're stuck in; x/z (+y) = go there, in the
// same place or another one.
function teleportPlayer(ctx: AdminContext, p: any) {
    const player = onlinePlayer(ctx, p.owner)
    const current = player.currentPlace.placeId
    const payload: any = {}

    if (p.lift != null) {
        payload.lift = num(p.lift, "lift", 1, 100)
    } else if (p.toPlayer) {
        const other = onlinePlayer(ctx, p.toPlayer, true)
        if (!other.pos) return fail(`${other.name}'s position isn't known yet`)
        payload.placeId = other.currentPlace.placeId
        const spot = ground(payload.placeId, other.pos.x + 1.5, other.pos.z)
        Object.assign(payload, { x: spot.x, y: DUNGEONS.has(payload.placeId) ? spot.y : other.pos.y, z: spot.z })
    } else if (flag(p.toSpawn) || p.x == null || p.z == null) {
        const place = knownPlace(p.placeId ?? current)
        Object.assign(payload, { placeId: place.placeId, x: place.spawn.x, y: place.spawn.y, z: place.spawn.z })
    } else {
        const place = knownPlace(p.placeId ?? current)
        const spot = ground(place.placeId, num(p.x, "x", -COORD_LIMIT, COORD_LIMIT), num(p.z, "z", -COORD_LIMIT, COORD_LIMIT))
        Object.assign(payload, { placeId: place.placeId, x: round2(spot.x), y: p.y != null && p.y !== "" ? num(p.y, "y", -1000, 10000) : (DUNGEONS.has(place.placeId) ? spot.y : undefined), z: round2(spot.z) })
    }

    ctx.io.to(player.socketId).emit("admin-teleport", payload)
    // the server's own copy catches up when the game reports its new position;
    // for a move inside the same place, say so now
    if (payload.x != null && (payload.placeId ?? current) === current) player.pos = { ...player.pos, x: payload.x, z: payload.z, y: payload.y ?? player.pos?.y ?? 0 }
    return { player: player.name, to: payload.lift ? `${payload.lift}m up` : `${placeLabel(payload.placeId ?? current)} (${round2(payload.x)}, ${round2(payload.z)})` }
}

function messagePlayer(ctx: AdminContext, p: any) {
    const player = onlinePlayer(ctx, p.owner)
    ctx.io.to(player.socketId).emit("admin-message", { text: text(p.text, "message", 300) })
    return { player: player.name }
}

function kickPlayer(ctx: AdminContext, p: any) {
    const player = onlinePlayer(ctx, p.owner)
    const reason = p.reason ? text(p.reason, "reason", 200) : ""
    ctx.io.to(player.socketId).emit("admin-kicked", { reason })
    // a beat for the message to arrive before the connection closes
    setTimeout(() => ctx.io.sockets.sockets.get(player.socketId)?.disconnect(true), 400)
    return { player: player.name }
}

// the REST server's own message, as something the admin can read
async function callRest(method: string, path: string, body?: unknown) {
    if (!restConfigured()) return fail("the REST server isn't set up for the admin (ADMIN_PERSIST is off)")
    try {
        return await requestRest(method, path, body)
    } catch (error: any) {
        return fail(`REST server: ${error?.message ?? error}`)
    }
}

async function findSaved(ctx: AdminContext, p: any) {
    const query = text(p.q, "name", 60)
    const res = await callRest("GET", `/admin/characters?q=${encodeURIComponent(query)}`)
    return {
        characters: (res?.characters ?? []).map((character: any) => ({
            ...character,
            online: ctx.world.players.some(player => player.owner === character.owner),
        })),
    }
}

async function repositionSaved(ctx: AdminContext, p: any) {
    const owner = text(p.owner, "character", 100)
    if (ctx.world.players.some(player => player.owner === owner)) {
        return fail("they're online right now - their game would save its own position over this. Use a live teleport instead")
    }
    const place = knownPlace(p.placeId)
    const x = p.x == null || p.x === "" ? place.spawn.x : num(p.x, "x", -COORD_LIMIT, COORD_LIMIT)
    const z = p.z == null || p.z === "" ? place.spawn.z : num(p.z, "z", -COORD_LIMIT, COORD_LIMIT)
    const y = p.y == null || p.y === "" ? (place.spawn.y ?? 1) : num(p.y, "y", -1000, 10000)
    const res = await callRest("POST", `/admin/characters/${encodeURIComponent(owner)}/reposition`, { placeId: place.placeId, name: place.name, areaType: place.areaType, x, y, z })
    return { character: res?.character?.name ?? owner, to: `${place.name} (${round2(x)}, ${round2(z)})` }
}

// ── the world ────────────────────────────────────────────────────────────────
function announce(ctx: AdminContext, p: any) {
    const message = text(p.text, "announcement", 300)
    // the chat line is for the record, the popup is what gets noticed
    ctx.io.emit("worldChatMessage", { name: "", message, ownerId: "admin", msgType: "system" })
    ctx.io.emit("admin-message", { text: message })
    return { sent: ctx.world.players.length }
}

function spawnBots(ctx: AdminContext, p: any) {
    const at = where(ctx, p)
    const place = placeById(at.placeId) ?? fail("unknown place")
    const count = int(p.count ?? 1, "count", 1, 10)
    const before = ctx.world.bots.length
    for (let i = 0; i < count; i++) {
        const spot = scatter(at.x, at.z, 3)
        ctx.world.spawnBot({ attitudeName: "caster", pos: spot, currentPlace: { placeId: place.placeId, name: place.name, areaType: place.areaType } })
    }
    return { spawned: ctx.world.bots.length - before }
}

// ── what's where, for the map ────────────────────────────────────────────────
function mapOf(ctx: AdminContext, p: any) {
    const placeId = knownPlace(p.placeId).placeId
    const inPlace = (item: any) => item.currentPlaceId === placeId
    const w = ctx.world
    return {
        placeId,
        players: w.players.filter(pl => pl.currentPlace?.placeId === placeId && pl.pos)
            .map(pl => ({ id: pl.owner, name: pl.name, x: round2(pl.pos.x), z: round2(pl.pos.z), lvl: pl.lvl, bot: isBot(ctx, pl.owner) })),
        enemies: w.enemies.filter(inPlace).slice(0, 2500)
            .map(e => ({ id: e._id, name: e.name, dn: e.dn, x: round2(e.x), z: round2(e.z), hp: Math.round(e.hp), maxHp: e.maxHp, target: !!e._targetId, admin: !!e.adminKey })),
        treasures: w.treasures.filter(inPlace).map(t => ({ id: t.itemId, x: round2(t.pos.x), z: round2(t.pos.z), label: t.itemDetail?.dn ?? "chest" })),
        grains: w.grains.filter(inPlace).slice(0, 2500).map(g => ({ id: g.grainId, x: round2(g.pos.x), z: round2(g.pos.z) })),
        mushrooms: w.mushrooms.filter(inPlace).slice(0, 2500).map(m => ({ id: m.mushroomId, x: round2(m.pos.x), z: round2(m.pos.z), kind: m.kind })),
        ores: w.ores.filter(inPlace).slice(0, 2500).map(o => ({ id: o.oreId, x: round2(o.pos.x), z: round2(o.pos.z), vein: o.vein, color: o.color, hp: o.hp, maxHp: o.maxHp })),
        structures: [
            ...w.bonfires.filter(inPlace).map(s => ({ x: round2(s.pos.x), z: round2(s.pos.z), kind: "bonfire" })),
            ...w.trunks.filter(inPlace).map(s => ({ x: round2(s.pos.x), z: round2(s.pos.z), kind: "log" })),
            ...w.structures.filter(inPlace).map(s => ({ x: round2(s.pos.x), z: round2(s.pos.z), kind: s.kind })),
        ],
    }
}

// ── the registry ─────────────────────────────────────────────────────────────
export const COMMANDS: Record<string, Command> = {
    // what the page can pick from
    "catalog": {
        audit: false,
        run: () => ({
            enemies: ENEMY_KINDS.map(({ name, dn, group, lvl, maxHp }) => ({ name, dn, group, lvl, maxHp })),
            places: PLACES,
            items: ITEM_PRESETS.map(({ key, label }) => ({ key, label })),
            mushrooms: MUSHROOM_KINDS,
            ores: ORE_VEINS,
            weather: WEATHER_TYPES,
        }),
    },
    "map.get": { audit: false, run: mapOf },

    "enemies.list": { audit: false, run: listEnemies },
    "enemies.spawn": {
        audit: true, run: spawnEnemies,
        describe: (p, r) => `${r.spawned} x ${enemyKind(p.name)?.dn ?? p.name} ${p.playerOwner ? "next to a player" : `at ${placeLabel(Number(p.placeId))} (${p.x}, ${p.z})`}${flag(p.keep) ? ", kept" : ""}`,
    },
    "enemies.remove": {
        audit: true,
        run: (ctx, p) => removeEnemies(ctx, idList(p.ids, "enemies")),
        describe: (p, r) => `${r.removed} enemy removed`,
    },
    "enemies.clear": {
        audit: true,
        run: (ctx, p) => {
            const placeId = int(p.placeId, "place", 0, 100000)
            const name = p.name ? text(p.name, "name") : null
            const adminOnly = flag(p.adminOnly)
            const ids = new Set<string>(ctx.world.enemies
                .filter(e => e.currentPlaceId === placeId && (!name || e.name === name) && (!adminOnly || e.adminKey))
                .map(e => e._id))
            return removeEnemies(ctx, ids)
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
            const ids = idList(p.ids, "items")
            const kind = pickupKind(p.kind)
            return removePickups(ctx, kind, item => ids.has(item[PICKUPS[kind].idField]))
        },
        describe: (p, r) => `${r.removed} ${p.kind} removed`,
    },
    "pickups.clear": {
        audit: true,
        run: (ctx, p) => {
            const kind = pickupKind(p.kind)
            const placeId = int(p.placeId, "place", 0, 100000)
            const adminOnly = flag(p.adminOnly)
            return removePickups(ctx, kind, item => item.currentPlaceId === placeId && (!adminOnly || item.adminKey))
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
            const applied = setWeather(text(p.weather, "weather", 20))
            if (!applied) return fail("unknown weather")
            ctx.io.emit("weather-changed", getWeatherState())
            return { weather: applied }
        },
        describe: (p, r) => r.weather,
    },
    "world.time": {
        audit: true,
        run: (ctx, p) => {
            const applied = setTimeOfDay(num(p.timeOfDay, "time of day", 0, 0.999999))
            if (applied === null) return fail("time of day must be from 0 to 1")
            ctx.io.emit("daynight-sync", getDayNightState())
            return { timeOfDay: applied }
        },
        describe: (p, r) => `${(r.timeOfDay * 24).toFixed(1)}h`,
    },
    "bots.toggle": {
        audit: true,
        run: (ctx, p) => { ctx.world.spawnBotsEnabled = flag(p.enabled); return { enabled: ctx.world.spawnBotsEnabled } },
        describe: (p, r) => (r.enabled ? "bot spawning on" : "bot spawning off"),
    },
    "bots.spawn": { audit: true, run: spawnBots, describe: (p, r) => `${r.spawned} bot` },

    "persist.retry": { audit: true, run: () => { store.retry(); return { status: store.status } }, describe: () => "retrying the load" },
    "persist.flush": { audit: true, run: async () => { await store.flush(); return { status: store.status } }, describe: () => "save now" },
}

// ── bringing saved placements back ───────────────────────────────────────────
// After a restart (persistence.ts's load): everything an admin kept is put back
// into the world, once - an entry whose key is already here is skipped.
export function restoreOverlay(ctx: AdminContext, saved: Overlay) {
    const w = ctx.world
    const haveKey = (list: any[], key: string) => list.some(item => item.adminKey === key)
    let restored = 0

    const enemies: any[] = []
    saved.enemies.forEach(entry => {
        const kind = enemyKind(entry.name)
        if (!kind || haveKey(w.enemies, entry.key)) return
        const [enemy] = kind.gen(1, entry.placeId, 300, "fixed", entry.x, entry.z, 0, 0)
        prepareEnemy(enemy, kind.name, entry.placeId, entry.respawn, true, entry.key)
        enemies.push(enemy)
    })
    if (enemies.length) { w.enemies.push(...enemies); ctx.io.emit("enemy-respawned", w.enemies); restored += enemies.length }

    const chests = saved.treasures.filter(entry => !haveKey(w.treasures, entry.key)).map(entry => {
        const chest: any = createTreasure({ x: entry.x, y: entry.y, z: entry.z }, entry.placeId, entry.itemDetail)
        chest.adminKey = entry.key
        chest.keep = true
        return chest
    })
    if (chests.length) { w.treasures.push(...chests); ctx.io.emit("treasure-added", chests); restored += chests.length }

    const grains = saved.grains.filter(entry => !haveKey(w.grains, entry.key)).map(entry =>
        ({ grainId: randNumString(), pos: { x: entry.x, y: entry.y, z: entry.z }, currentPlaceId: entry.placeId, adminKey: entry.key, keep: true }))
    if (grains.length) { w.grains.push(...grains); ctx.io.emit("grain-added", grains); restored += grains.length }

    const mushrooms = saved.mushrooms.filter(entry => !haveKey(w.mushrooms, entry.key)).map(entry =>
        ({ mushroomId: randNumString(), kind: entry.kind, pos: { x: entry.x, y: entry.y, z: entry.z }, currentPlaceId: entry.placeId, adminKey: entry.key, keep: true }))
    if (mushrooms.length) { w.mushrooms.push(...mushrooms); ctx.io.emit("mushroom-added", mushrooms); restored += mushrooms.length }

    const ores = (saved.ores ?? []).filter(entry => VEINS[entry.vein] && !haveKey(w.ores, entry.key)).map(entry => {
        const ore: any = makeOre(entry.vein, { x: entry.x, y: entry.y, z: entry.z }, entry.placeId, entry.rotation)
        ore.adminKey = entry.key
        ore.keep = true
        return ore
    })
    if (ores.length) { w.ores.push(...ores); ctx.io.emit("ore-added", ores); restored += ores.length }

    if (restored) console.log(`[admin] put ${restored} saved placements back into the world`)
}
