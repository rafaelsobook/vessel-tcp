// WATCHING PLAYERS - what every real player is doing, for the master control's
// Watch tab: a live feed of their actions, the trail they've walked, running
// stats, and anti-cheat flags. index.ts reports what it sees (joins, moves,
// hits, kills, chat, pickups...); nothing here changes the game, except that a
// hit that looks wrong (sent as someone else, or from much too far away) is
// marked untrusted, and an untrusted kill pays nothing (economy.ts).
//
// The flags are heuristics, not verdicts - the game's own clients still decide
// most things, so they say where to look:
//   spoof       an event sent as another account (dropped)            bad
//   bad-token   a login token that isn't this account's               bad
//   speed       moved faster than anything in the game goes           warn
//   reach       a hit from much further than its weapon or spell reaches  warn
//               (tcp only knows where an enemy is when a client reports it, so a
//               chasing enemy's spot lags - flagged past REACH_FLAG, the kill unpaid
//               only past REACH_UNPAID, further than any lag could explain)
//   debug-cmd   a debug key's command sent to the live server (index.ts)    warn
//   hit-rate    more hits a second than any skill makes               warn
//   kill-rate   kills a minute far past normal farming                warn / bad
//   huge-hit    one hit at or over the economy's maxHitFlag           warn
// Warnings and worse are also kept on the account (economy.ts sends them to the
// REST server), so a withdrawal's review still sees them after a restart.

export type Severity = "info" | "warn" | "bad"
export type WatchEvent = { id: number, t: number, kind: string, text: string, severity?: Severity }
export type Flag = { kind: string, severity: Severity, count: number, first: number, last: number, detail: string }

type Point = { t: number, x: number, z: number, placeId: number | null, jump?: boolean }

type Track = {
    owner: string
    name: string
    online: boolean
    joinedAt: number
    leftAt: number | null
    placeId: number | null
    // the login token: "pending" until tcp has asked the REST server, then whether it was this account's
    session: "pending" | "valid" | "missing" | "invalid"
    isGuest: boolean | null
    events: WatchEvent[]
    trail: Point[]
    last: Point | null
    graceUntil: number          // no speed checks until then (a place change, an admin teleport)
    hitTimes: number[]
    killTimes: number[]
    stats: { hits: number, kills: number, dmgTotal: number, dmgMax: number, earnedCents: number, payouts: number, unpaid: number, chat: number, pvpHits: number }
    flags: Map<string, Flag>
    reportedAt: Map<string, number>
}

const MAX_EVENTS = 400
const TRAIL_MS = 4 * 60 * 1000
const TRAIL_MAX = 1500
const KEEP_AFTER_LEAVE_MS = 30 * 60 * 1000
const GRACE_MS = 6000

// the limits
const SPEED_LIMIT = 35          // units a second - sprinting and dashing stay well under
const SPEED_MIN_DIST = 12       // a jump shorter than this is never flagged (lag, a blink)
const REACH_FLAG = { melee: 15, spell: 50 }
const REACH_UNPAID = { melee: 30, spell: 90 }
const HITS_PER_2S = 40
const KILLS_PER_MIN_WARN = 25
const KILLS_PER_MIN_BAD = 50
const REPORT_EVERY_MS = 5 * 60 * 1000   // one stored flag per kind per account in this window

const tracks = new Map<string, Track>()
let nextEventId = 1
// warnings waiting to be kept on the account (economy.ts sends them)
const toReport: { owner: string, flag: { t: number, kind: string, severity: Severity, detail: string } }[] = []

const round1 = (n: number) => Math.round(n * 10) / 10
const isReal = (owner: unknown) => typeof owner === "string" && !!owner && !owner.startsWith("bot_") && !owner.startsWith("undead_")

function track(owner: string, name = ""): Track {
    let t = tracks.get(owner)
    if (!t) {
        t = {
            owner, name, online: true, joinedAt: Date.now(), leftAt: null, placeId: null,
            session: "pending", isGuest: null,
            events: [], trail: [], last: null, graceUntil: 0, hitTimes: [], killTimes: [],
            stats: { hits: 0, kills: 0, dmgTotal: 0, dmgMax: 0, earnedCents: 0, payouts: 0, unpaid: 0, chat: 0, pvpHits: 0 },
            flags: new Map(), reportedAt: new Map(),
        }
        tracks.set(owner, t)
    }
    if (name) t.name = name
    return t
}

function push(t: Track, kind: string, text: string, severity?: Severity) {
    t.events.push({ id: nextEventId++, t: Date.now(), kind, text, severity })
    if (t.events.length > MAX_EVENTS) t.events.splice(0, t.events.length - MAX_EVENTS)
}

/** Something worth a look. Shows in the feed; warnings and worse are also kept on the account. */
export function raiseFlag(owner: string, kind: string, severity: Severity, detail: string) {
    if (!isReal(owner)) return
    const t = track(owner)
    const now = Date.now()
    const flag = t.flags.get(kind) ?? { kind, severity, count: 0, first: now, last: now, detail }
    flag.count++
    flag.last = now
    flag.detail = detail
    if (rank(severity) > rank(flag.severity)) flag.severity = severity
    t.flags.set(kind, flag)
    push(t, "flag", `${kind}: ${detail}`, severity)
    if (severity !== "info" && now - (t.reportedAt.get(kind) ?? 0) > REPORT_EVERY_MS) {
        t.reportedAt.set(kind, now)
        toReport.push({ owner, flag: { t: now, kind, severity, detail } })
    }
}
const rank = (s: Severity) => (s === "bad" ? 2 : s === "warn" ? 1 : 0)

/** Flags waiting to be stored on their accounts - taken, so each goes once. */
export function takeFlagReports() {
    return toReport.splice(0, toReport.length)
}

// ── what index.ts reports ────────────────────────────────────────────────────

/** Joined, or walked into another place (join-world fires on every place change). */
export function watchJoin(owner: string, name: string, placeId: number | null, placeName: string, pos?: { x: number, z: number }) {
    if (!isReal(owner)) return
    const t = track(owner, name)
    const first = !t.online || !t.events.length
    t.online = true
    t.leftAt = null
    t.placeId = placeId
    t.graceUntil = Date.now() + GRACE_MS
    t.last = null
    push(t, first ? "join" : "place", first ? `joined the world - ${placeName}` : `entered ${placeName}`)
    if (pos) addPoint(t, pos.x, pos.z, placeId, false)
}

export function watchLeave(owner: string) {
    const t = tracks.get(owner)
    if (!t) return
    t.online = false
    t.leftAt = Date.now()
    push(t, "leave", "left the game")
}

/** An admin moved them - their next position jump is expected. */
export function noteTeleport(owner: string) {
    const t = tracks.get(owner)
    if (t) { t.graceUntil = Date.now() + GRACE_MS; push(t, "admin", "moved by an admin") }
}

export function setSession(owner: string, session: Track["session"], isGuest: boolean | null) {
    if (!isReal(owner)) return
    const t = track(owner)
    t.session = session
    t.isGuest = isGuest
    if (session === "valid") push(t, "session", `login checked${isGuest ? " (guest account)" : ""}`)
    if (session === "missing") push(t, "session", "no login token sent (an old game version?) - earns nothing", "info")
}

function addPoint(t: Track, x: number, z: number, placeId: number | null, jump: boolean) {
    const now = Date.now()
    const point = { t: now, x: round1(x), z: round1(z), placeId, jump: jump || undefined }
    t.trail.push(point)
    t.last = point
    const cutoff = now - TRAIL_MS
    while (t.trail.length && (t.trail[0].t < cutoff || t.trail.length > TRAIL_MAX)) t.trail.shift()
}

/** A position update - checked for speed against the last one. */
export function watchMove(owner: string, pos: any, placeId: number | null) {
    if (!isReal(owner) || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return
    const t = track(owner)
    const now = Date.now()
    let jump = false
    const last = t.last
    if (last && last.placeId === placeId && now > t.graceUntil) {
        const dist = Math.hypot(pos.x - last.x, pos.z - last.z)
        const dt = Math.max(0.05, (now - last.t) / 1000)
        if (dist > SPEED_MIN_DIST && dist / dt > SPEED_LIMIT) {
            jump = true
            raiseFlag(owner, "speed", "warn", `moved ${round1(dist)} units in ${round1(dt)}s (${Math.round(dist / dt)}/s)`)
        }
    }
    // the trail keeps a point a second, plus every jump
    if (!last || jump || now - last.t > 1000 || last.placeId !== placeId) addPoint(t, pos.x, pos.z, placeId, jump)
    t.placeId = placeId
}

/**
 * A hit on a world enemy, as the server saw it. Returns whether it's trusted:
 * an untrusted lethal hit's kill pays nothing (economy.ts).
 */
export function watchHit(owner: string, hit: { target: string, dmg: number, dist: number | null, magic: boolean, lethal: boolean, maxHitFlag: number }): { trusted: boolean, reason?: string } {
    if (!isReal(owner)) return { trusted: false, reason: "not a player" }
    const t = track(owner)
    const now = Date.now()
    t.stats.hits++
    t.stats.dmgTotal += Math.max(0, hit.dmg)
    t.stats.dmgMax = Math.max(t.stats.dmgMax, hit.dmg)
    t.hitTimes.push(now)
    while (t.hitTimes.length && t.hitTimes[0] < now - 2000) t.hitTimes.shift()

    let trusted = true
    let reason: string | undefined
    const kind = hit.magic ? "spell" : "melee"
    if (hit.dist != null && hit.dist > REACH_FLAG[kind]) {
        const unpaid = hit.dist > REACH_UNPAID[kind]
        if (unpaid) { trusted = false; reason = "out of reach" }
        raiseFlag(owner, "reach", unpaid ? "warn" : "info", `${kind} hit on ${hit.target} from ${round1(hit.dist)} units${unpaid ? " - not paid" : ""}`)
    }
    if (t.hitTimes.length > HITS_PER_2S) raiseFlag(owner, "hit-rate", "warn", `${t.hitTimes.length} hits in 2s`)
    if (hit.dmg >= hit.maxHitFlag) raiseFlag(owner, "huge-hit", "warn", `hit ${hit.target} for ${Math.round(hit.dmg)}`)

    push(t, hit.lethal ? "kill-hit" : "hit", `${hit.lethal ? "killed" : "hit"} ${hit.target} - ${Math.round(hit.dmg)} dmg${hit.dist != null ? ` at ${round1(hit.dist)}u` : ""}${hit.magic ? " (spell)" : ""}`)
    return { trusted, reason }
}

/** A kill and what it paid (cents 0 + a reason when it didn't). */
export function watchKill(owner: string, target: string, cents: number, lucky: boolean, unpaidReason?: string) {
    if (!isReal(owner)) return
    const t = track(owner)
    const now = Date.now()
    t.stats.kills++
    t.killTimes.push(now)
    while (t.killTimes.length && t.killTimes[0] < now - 60000) t.killTimes.shift()
    if (cents > 0) { t.stats.earnedCents += cents; t.stats.payouts++ }
    else t.stats.unpaid++
    const perMin = t.killTimes.length
    if (perMin >= KILLS_PER_MIN_BAD) raiseFlag(owner, "kill-rate", "bad", `${perMin} kills in the last minute`)
    else if (perMin >= KILLS_PER_MIN_WARN) raiseFlag(owner, "kill-rate", "warn", `${perMin} kills in the last minute`)
    push(t, "payout", cents > 0 ? `+$${(cents / 100).toFixed(2)} for ${target}${lucky ? " (lucky)" : ""}` : `${target} paid nothing - ${unpaidReason ?? "no payout"}`)
}

/** Anything else worth seeing in the feed: chat, a pickup, a cast, a PvP blow... */
export function watchEvent(owner: string, kind: string, text: string, severity?: Severity) {
    if (!isReal(owner)) return
    const t = track(owner)
    if (kind === "chat") t.stats.chat++
    if (kind === "pvp") t.stats.pvpHits++
    push(t, kind, text, severity)
}

// ── what the master control reads ────────────────────────────────────────────

const worstOf = (t: Track): Severity | null => {
    let worst: Severity | null = null
    t.flags.forEach(f => { if (!worst || rank(f.severity) > rank(worst)) worst = f.severity })
    return worst
}

/** A line for the roster (snapshot.ts). */
export function watchSummary(owner: string) {
    const t = tracks.get(owner)
    if (!t) return null
    return {
        session: t.session, isGuest: t.isGuest,
        flags: t.flags.size, worst: worstOf(t),
        kills: t.stats.kills, earnedCents: t.stats.earnedCents,
        killsLastMin: t.killTimes.filter(time => time > Date.now() - 60000).length,
    }
}

/** Everything about one player; events after `since` (an event id) only. */
export function watchDetail(owner: string, since = 0) {
    const t = tracks.get(owner)
    if (!t) return null
    const now = Date.now()
    const minutes = Math.max(1 / 60, (now - t.joinedAt) / 60000)
    return {
        owner: t.owner, name: t.name, online: t.online, joinedAt: t.joinedAt, leftAt: t.leftAt, placeId: t.placeId,
        session: t.session, isGuest: t.isGuest,
        stats: {
            ...t.stats,
            dmgAvg: t.stats.hits ? Math.round(t.stats.dmgTotal / t.stats.hits) : 0,
            killsPerMin: round1(t.stats.kills / minutes),
            killsLastMin: t.killTimes.filter(time => time > now - 60000).length,
            hitsLast2s: t.hitTimes.filter(time => time > now - 2000).length,
            minutes: Math.round(minutes),
        },
        flags: [...t.flags.values()].sort((a, b) => rank(b.severity) - rank(a.severity) || b.last - a.last),
        trail: t.trail.filter(point => point.placeId === t.placeId),
        events: t.events.filter(event => event.id > since),
        lastEventId: t.events.length ? t.events[t.events.length - 1].id : since,
    }
}

/** Everyone tracked, the most suspicious first - online or gone within the last half hour. */
export function watchList() {
    const now = Date.now()
    return [...tracks.values()]
        .filter(t => t.online || (t.leftAt != null && now - t.leftAt < KEEP_AFTER_LEAVE_MS))
        .map(t => ({ owner: t.owner, name: t.name, online: t.online, placeId: t.placeId, ...watchSummary(t.owner)! }))
        .sort((a, b) => rank(b.worst ?? "info") * 100 + b.flags - (rank(a.worst ?? "info") * 100 + a.flags) || Number(b.online) - Number(a.online))
}

/** Serious flags (spoof, bad login, a far-out kill rate) this session - any fails a payout's record check (economy.ts). */
export function badFlagCount(owner: string) {
    const t = tracks.get(owner)
    if (!t) return 0
    let n = 0
    t.flags.forEach(f => { if (f.severity === "bad") n++ })
    return n
}

/** An admin cleared a player's flags after looking into them. */
export function clearFlags(owner: string) {
    const t = tracks.get(owner)
    if (!t) return false
    t.flags.clear()
    push(t, "admin", "flags cleared by an admin")
    return true
}

// gone players are forgotten after a while
setInterval(() => {
    const now = Date.now()
    tracks.forEach((t, owner) => { if (!t.online && t.leftAt != null && now - t.leftAt > KEEP_AFTER_LEAVE_MS) tracks.delete(owner) })
}, 60_000).unref()
