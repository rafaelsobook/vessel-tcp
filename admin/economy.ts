import { requestRest, restConfigured, worldName } from "./persistence"
import { raiseFlag, setSession, takeFlagReports, watchKill, badFlagCount } from "./watch"

// VESSELPAY - real CAD paid for monsters killed, worked out HERE, never by a
// game client. This server already decides when an enemy dies (index.ts's
// applyDamageToEnemy), so it also decides what the kill pays and who gets it:
// the account its connection proved it was (the login token, checked once per
// connection against the REST server) - not whatever id the client wrote.
//
//   verifySession  join-world: is the token this account's? banned? its wallet
//   payKill        a slime killed - the checks, the roll, the pay (see below)
//   flush          every few seconds: the kills paid, batched, to the REST server
//                  (server/routes/adminR.js /wallets/credit), which keeps the money
//
// A connection whose token is missing (an old client) plays on but earns
// nothing; a wrong one is disconnected; a banned account is turned away.
// The settings (what a slime pays, the chance, the daily cap...) are the admin page's.
//
// ONLY SLIMES PAY (2026-11-18, the user's call): a water slime 5c, a fire slime
// 10c, an electric slime 15c - and only half the time. Every kill of one runs
// four checks here, in order, and the killer's game plays them out on a
// progress bar over the body ("wallet-check"; client payouts/payoutCheck.js),
// then shows the money - or "none":
//   kill    the lethal blow was this connection's own (its login checked),
//           landed within reach (watch.ts)
//   record  nothing that looks like cheating - no serious flag this session or
//           kept on the account (an admin clears them), not frozen or banned
//   limit   today's cap has room for it
//   roll    payChance (50%) - decided here, never by the client
// Any other enemy pays nothing and shows nothing.

export type EconomySettings = { enabled: boolean, payChance: number, slimePay: Record<string, number>, dailyCapCents: number, maxHitFlag: number }
export const SLIME_KINDS = ["waterslime", "fireslime", "electricslime"]
export const DEFAULT_SETTINGS: EconomySettings = {
    enabled: true,
    payChance: 0.5,
    slimePay: { waterslime: 5, fireslime: 10, electricslime: 15 },
    dailyCapCents: 200,
    maxHitFlag: 3000,
}
export const MIN_WITHDRAW_CENTS = 1000
const CHECK_LABELS: Record<string, string> = { kill: "Kill confirmed", record: "Clean record", limit: "Under today's limit", roll: "Lucky roll" }
const withDefaults = (given: any): EconomySettings => ({
    ...DEFAULT_SETTINGS, ...(given ?? {}),
    slimePay: { ...DEFAULT_SETTINGS.slimePay, ...(given?.slimePay ?? {}) },
})

const FLUSH_MS = 4000
const QUEUE_WHILE_CHECKING_MS = 5 * 60 * 1000
const RECENT = 8

type Kill = { kind: string, name: string, targetId: string | null, unpaidReason?: string, t: number }
type Purse = {
    owner: string
    username: string
    // the login token, as the REST server judged it
    session: "pending" | "valid" | "missing" | "invalid"
    isGuest: boolean
    banned: boolean
    frozen: boolean
    // serious anti-cheat flags kept on the account (REST) - any fails the record check
    accountBadFlags: number
    // Registered Player (REST user.registration): "none" | "requesting" | "registered", and its ID
    registration: { status: string, playerId: string | null }
    day: string
    dayCents: number
    balance: number
    // paid but not yet sent to the REST server
    owed: { cents: number, kills: number, lucky: number, best: number, recent: { n: string, c: number, l: number, t: number }[] }
    // kills made before the token check came back - paid if it's good, dropped if not
    waiting: Kill[]
    told: Set<string>       // one-off notices already shown (capped, frozen, unverified)
    // when they last died - a credit that was in flight then is never put back (flush)
    diedAt: number
}

let settings: EconomySettings = { ...DEFAULT_SETTINGS }
let settingsLoaded = false
const purses = new Map<string, Purse>()

type Hooks = {
    emitTo(owner: string, event: string, data: any): void
    disconnect(owner: string, event: string, data: any): void
}
let hooks: Hooks = { emitTo: () => {}, disconnect: () => {} }

const dayKey = () => new Date().toISOString().slice(0, 10)
const emptyOwed = () => ({ cents: 0, kills: 0, lucky: 0, best: 0, recent: [] as Purse["owed"]["recent"] })

function purse(owner: string): Purse {
    let p = purses.get(owner)
    if (!p) {
        p = { owner, username: "", session: "pending", isGuest: false, banned: false, frozen: false, accountBadFlags: 0, registration: { status: "none", playerId: null }, day: dayKey(), dayCents: 0, balance: 0, owed: emptyOwed(), waiting: [], told: new Set(), diedAt: 0 }
        purses.set(owner, p)
    }
    if (p.day !== dayKey()) { p.day = dayKey(); p.dayCents = 0; p.told.delete("capped") }
    return p
}

export const getSettings = () => ({ ...settings, slimePay: { ...settings.slimePay } })
export const economyStatus = () => ({ settings: getSettings(), loaded: settingsLoaded, rest: restConfigured(), purses: purses.size })

// ── settings ─────────────────────────────────────────────────────────────────
export async function loadSettings() {
    if (!restConfigured()) return
    for (const wait of [0, 15_000, 60_000, 180_000]) {
        if (wait) await new Promise(resolve => setTimeout(resolve, wait))
        try {
            const res = await requestRest("GET", `/admin/economy/${encodeURIComponent(worldName())}`, undefined, 70_000)
            if (res?.settings) { settings = withDefaults(res.settings); settingsLoaded = true }
            return
        } catch (error: any) {
            console.warn(`[economy] couldn't load the settings (${error?.message}) - using the defaults for now`)
        }
    }
}

export async function saveSettings(next: Partial<EconomySettings>) {
    const merged = { ...settings, ...next, slimePay: { ...settings.slimePay, ...(next.slimePay ?? {}) } }
    const res = await requestRest("PUT", `/admin/economy/${encodeURIComponent(worldName())}`, { settings: merged })
    settings = withDefaults(res.settings)
    settingsLoaded = true
    return getSettings()
}

// ── the login check ──────────────────────────────────────────────────────────
const checking = new Map<string, Promise<void>>()   // socket id -> its check

/**
 * Checks a connection's login token against the REST server, once per
 * connection and account. Returns at once; what it finds is applied when it
 * comes back - a bad token or a ban disconnects them.
 */
export function verifySession(socketId: string, owner: string, name: string, token: unknown, alreadyFor: string | undefined, onValid: () => void) {
    if (!owner || owner.startsWith("bot_")) return
    if (alreadyFor === owner) return
    const key = `${socketId}:${owner}`
    if (checking.has(key)) return
    const p = purse(owner)
    p.username = name
    p.session = "pending"
    if (!restConfigured()) { p.session = "missing"; return }

    const job = (async () => {
        try {
            const res = await requestRest("POST", "/admin/sessions/verify", { owner, token: typeof token === "string" ? token : null }, 70_000)
            if (res?.reason === "noaccount" || res?.reason === "badowner") {
                p.session = "invalid"
                setSession(owner, "invalid", null)
                raiseFlag(owner, "bad-token", "bad", "joined as an account that doesn't exist")
                p.waiting = []
                hooks.disconnect(owner, "session-invalid", { message: "Your session couldn't be checked - please log in again." })
                return
            }
            p.isGuest = !!res?.isGuest
            p.banned = !!res?.banned
            p.frozen = !!res?.frozen
            p.accountBadFlags = Number(res?.badFlags) || 0
            if (res?.registration) p.registration = { status: res.registration.status || "none", playerId: res.registration.playerId || null }
            const w = res?.wallet
            if (w) { p.balance = w.cents ?? 0; if (w.day === dayKey()) p.dayCents = Math.max(p.dayCents, w.dayCents ?? 0) }

            if (p.banned) {
                p.waiting = []
                hooks.disconnect(owner, "account-banned", { reason: res?.bannedReason ?? "" })
                return
            }
            if (res?.tokenState === "valid") {
                p.session = "valid"
                setSession(owner, "valid", p.isGuest)
                onValid()
                tellState(p)
                // what they killed while this was being checked
                const waiting = p.waiting.filter(kill => Date.now() - kill.t < QUEUE_WHILE_CHECKING_MS)
                p.waiting = []
                waiting.forEach(kill => payKill(owner, kill.kind, kill.name, kill.targetId, kill.unpaidReason))
                return
            }
            p.waiting = []
            if (res?.tokenState === "missing") {
                p.session = "missing"
                setSession(owner, "missing", p.isGuest)
                tellState(p)
                return
            }
            // a token, but someone else's or forged
            p.session = "invalid"
            setSession(owner, "invalid", p.isGuest)
            raiseFlag(owner, "bad-token", "bad", `login token was ${res?.tokenState ?? "rejected"}`)
            hooks.disconnect(owner, "session-invalid", { message: "Your session couldn't be checked - please log in again." })
        } catch (error: any) {
            // the REST server asleep or down: still "pending" - kills wait, the next join tries again
            console.warn(`[economy] couldn't check ${name}'s session: ${error?.message}`)
        } finally {
            checking.delete(key)
        }
    })()
    checking.set(key, job)
}

// what the wallet card shows on entering
function tellState(p: Purse) {
    hooks.emitTo(p.owner, "wallet-state", {
        enabled: settings.enabled, session: p.session, isGuest: p.isGuest, frozen: p.frozen,
        balance: p.balance + p.owed.cents, dayCents: p.dayCents, capCents: settings.dailyCapCents,
        minWithdrawCents: MIN_WITHDRAW_CENTS, currency: "CAD", registration: p.registration,
    })
}

// ── paying a kill ────────────────────────────────────────────────────────────
/**
 * A kill by `owner` of an enemy of `kind` (its tcp name: "waterslime"...).
 * Only the paying slimes go any further. unpaidReason: the blow that did it
 * looked wrong (watch.ts) - the kill check fails. targetId lets the bar and the
 * card sit over the body.
 */
export function payKill(owner: string, kind: string, name: string, targetId: string | null, unpaidReason?: string) {
    if (!owner || owner.startsWith("bot_") || owner.startsWith("undead_")) return
    const base = Math.round(Number(settings.slimePay[kind]))
    if (!SLIME_KINDS.includes(kind) || !(base > 0)) return
    if (!settings.enabled) return
    const p = purse(owner)
    // the login check isn't back yet - this kill is judged when it is
    if (p.session === "pending") {
        if (p.waiting.length < 500) p.waiting.push({ kind, name, targetId, unpaidReason, t: Date.now() })
        return
    }

    // the four checks, in order - the first that fails ends it
    const room = settings.dailyCapCents > 0 ? Math.max(0, settings.dailyCapCents - p.dayCents) : Infinity
    const steps: [string, () => boolean, string][] = [
        ["kill", () => p.session === "valid" && !unpaidReason, p.session !== "valid" ? "unverified session" : unpaidReason ?? ""],
        ["record", () => !p.banned && !p.frozen && badFlagCount(owner) === 0 && p.accountBadFlags === 0, p.frozen || p.banned ? "account frozen" : "flagged record"],
        ["limit", () => room >= base, "daily cap reached"],
        ["roll", () => Math.random() < settings.payChance, "no pay this time"],
    ]
    const checks: { id: string, label: string, state: "ok" | "fail" | "skip" }[] = []
    let failed: string | null = null
    for (const [id, test, why] of steps) {
        if (failed) { checks.push({ id, label: CHECK_LABELS[id], state: "skip" }); continue }
        const ok = test()
        checks.push({ id, label: CHECK_LABELS[id], state: ok ? "ok" : "fail" })
        if (!ok) failed = why
    }

    const cents = failed ? 0 : base
    if (cents > 0) {
        p.dayCents += cents
        p.owed.cents += cents
        p.owed.kills += 1
        p.owed.best = Math.max(p.owed.best, cents)
        p.owed.recent.unshift({ n: String(name || "Slime").slice(0, 40), c: cents, l: 0, t: Date.now() })
        p.owed.recent.length = Math.min(p.owed.recent.length, RECENT)
    }
    watchKill(owner, name, cents, false, failed ?? undefined)
    hooks.emitTo(owner, "wallet-check", {
        // stake: what this slime pays when every check passes - the card shows it while it checks
        targetId, name, kind, checks, cents, stake: base,
        balance: p.balance + p.owed.cents, dayCents: p.dayCents, capCents: settings.dailyCapCents,
    })
}

// ── Registered Player ────────────────────────────────────────────────────────
/** The status changed (the player asked, an admin granted) - the purse and the player's own card hear at once. */
export function setRegistration(owner: string, registration: { status: string, playerId: string | null }) {
    const p = purse(owner)
    p.registration = { status: registration?.status || "none", playerId: registration?.playerId || null }
    hooks.emitTo(owner, "wallet-registration", p.registration)
    return p.registration
}

/**
 * The player pressed "Send request" on their VesselPay card (index.ts "registration-request"). Only a
 * checked login asks; a registered one is told it already is. The REST server keeps it on the account.
 */
export async function requestRegistration(owner: string) {
    const p = purse(owner)
    if (p.registration.status === "registered") return hooks.emitTo(owner, "wallet-registration", p.registration)
    if (p.session !== "valid") return hooks.emitTo(owner, "wallet-registration", { ...p.registration, error: "Your login couldn't be checked - reload the game and try again." })
    if (p.isGuest) return hooks.emitTo(owner, "wallet-registration", { ...p.registration, error: "Guest accounts can't register - save your hero with a username and password first." })
    try {
        const res = await requestRest("POST", `/admin/users/${owner}/registration`, { status: "requesting" })
        setRegistration(owner, res?.registration ?? { status: "requesting", playerId: null })
    } catch (error: any) {
        hooks.emitTo(owner, "wallet-registration", { ...p.registration, error: "Couldn't send it - try again in a moment." })
    }
}

/** An admin cleared their flags (commands.ts) - the record check passes again. */
export function clearAccountFlags(owner: string) {
    purse(owner).accountBadFlags = 0
}

// ── saving it ────────────────────────────────────────────────────────────────
let flushing = false
// the credit batch on its way to the REST server, if any - a death waits for it, then wipes
let inFlight: Promise<unknown> = Promise.resolve()
export async function flush(onlyOwner?: string) {
    if (flushing && !onlyOwner) return
    const due = [...purses.values()].filter(p => p.owed.cents > 0 || p.owed.kills > 0).filter(p => !onlyOwner || p.owner === onlyOwner)
    const flags = takeFlagReports()
    if (!due.length && !flags.length) return
    if (!restConfigured()) return
    flushing = !onlyOwner
    // taken off now; put back if the send fails
    const batch = due.map(p => { const owed = p.owed; p.owed = emptyOwed(); return { p, owed } })
    const sentAt = Date.now()
    try {
        if (batch.length) {
            const sending = requestRest("POST", "/admin/wallets/credit", {
                capCents: settings.dailyCapCents,
                credits: batch.map(({ p, owed }) => ({ owner: p.owner, ...owed })),
            })
            inFlight = sending.catch(() => {})
            const res = await sending
            for (const result of res?.results ?? []) {
                const p = purses.get(result.owner)
                if (!p) continue
                if (Number.isFinite(result.cents)) p.balance = result.cents
                if (result.frozen) p.frozen = true
            }
        }
        // the anti-cheat warnings, kept on each account
        const byOwner = new Map<string, any[]>()
        flags.forEach(({ owner, flag }) => { if (/^[a-f0-9]{24}$/i.test(owner)) byOwner.set(owner, [...(byOwner.get(owner) ?? []), flag]) })
        for (const [owner, list] of byOwner) await requestRest("POST", `/admin/users/${owner}/flags`, { flags: list }).catch(() => {})
    } catch (error: any) {
        console.warn(`[economy] couldn't save ${batch.length} wallet credit(s): ${error?.message} - will retry`)
        batch.forEach(({ p, owed }) => {
            // they died since - that money died with them
            if (p.diedAt >= sentAt) return
            p.owed.cents += owed.cents
            p.owed.kills += owed.kills
            p.owed.lucky += owed.lucky
            p.owed.best = Math.max(p.owed.best, owed.best)
            p.owed.recent = [...p.owed.recent, ...owed.recent].slice(0, RECENT)
        })
    } finally {
        if (!onlyOwner) flushing = false
    }
}

/**
 * They died (index.ts "will-die" - permadeath): every cent in VesselPay goes with them. Wiped here at
 * once (nothing owed is ever sent), then on the account once any credit already on its way has landed -
 * so it can't land after the wipe. The REST server wipes it again when the client deletes the character.
 * A withdrawal already asked for stays in review. The day's count stays (dying doesn't reset the cap).
 */
export async function forfeit(owner: string) {
    if (!owner || owner.startsWith("bot_") || owner.startsWith("undead_")) return
    const p = purses.get(owner)
    if (p) {
        p.diedAt = Date.now()
        p.owed = emptyOwed()
        p.waiting = []
        p.balance = 0
    }
    if (!restConfigured() || !/^[a-f0-9]{24}$/i.test(owner)) return
    await inFlight
    for (const wait of [0, 5_000, 20_000]) {
        if (wait) await new Promise(resolve => setTimeout(resolve, wait))
        try {
            const res = await requestRest("POST", `/admin/wallets/${owner}/forfeit`, { reason: "died" })
            if (res?.forfeited) console.log(`[economy] ${p?.username || owner} died - CA$${(res.forfeited / 100).toFixed(2)} of VesselPay gone with them`)
            return
        } catch (error: any) {
            console.warn(`[economy] couldn't wipe ${owner}'s wallet on death: ${error?.message}`)
        }
    }
}

/** They left - what they're owed goes now; the purse stays (a reconnect keeps the day's count). */
export function onLeave(owner: string) {
    flush(owner).catch(() => {})
}

/** An admin froze or banned them (commands.ts) - takes effect at once. */
export function setStanding(owner: string, change: { banned?: boolean, frozen?: boolean }) {
    const p = purse(owner)
    if (change.banned !== undefined) p.banned = change.banned
    if (change.frozen !== undefined) { p.frozen = change.frozen; p.told.delete("frozen") }
}

export function purseOf(owner: string) {
    const p = purses.get(owner)
    if (!p) return null
    return { registration: p.registration, session: p.session, isGuest: p.isGuest, banned: p.banned, frozen: p.frozen, dayCents: p.dayCents, balance: p.balance + p.owed.cents, owedCents: p.owed.cents, waiting: p.waiting.length }
}

export function startEconomy(h: Hooks) {
    hooks = h
    loadSettings()
    setInterval(() => { flush().catch(() => {}) }, FLUSH_MS).unref()
}
