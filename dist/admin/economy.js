"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.economyStatus = exports.getSettings = exports.MIN_WITHDRAW_CENTS = exports.DEFAULT_SETTINGS = exports.SLIME_KINDS = void 0;
exports.loadSettings = loadSettings;
exports.saveSettings = saveSettings;
exports.verifySession = verifySession;
exports.payKill = payKill;
exports.clearAccountFlags = clearAccountFlags;
exports.flush = flush;
exports.forfeit = forfeit;
exports.onLeave = onLeave;
exports.setStanding = setStanding;
exports.purseOf = purseOf;
exports.startEconomy = startEconomy;
const persistence_1 = require("./persistence");
const watch_1 = require("./watch");
exports.SLIME_KINDS = ["waterslime", "fireslime", "electricslime"];
exports.DEFAULT_SETTINGS = {
    enabled: true,
    payChance: 0.5,
    slimePay: { waterslime: 5, fireslime: 10, electricslime: 15 },
    dailyCapCents: 200,
    maxHitFlag: 3000,
};
exports.MIN_WITHDRAW_CENTS = 1000;
const CHECK_LABELS = { kill: "Kill confirmed", record: "Clean record", limit: "Under today's limit", roll: "Lucky roll" };
const withDefaults = (given) => ({
    ...exports.DEFAULT_SETTINGS, ...(given ?? {}),
    slimePay: { ...exports.DEFAULT_SETTINGS.slimePay, ...(given?.slimePay ?? {}) },
});
const FLUSH_MS = 4000;
const QUEUE_WHILE_CHECKING_MS = 5 * 60 * 1000;
const RECENT = 8;
let settings = { ...exports.DEFAULT_SETTINGS };
let settingsLoaded = false;
const purses = new Map();
let hooks = { emitTo: () => { }, disconnect: () => { } };
const dayKey = () => new Date().toISOString().slice(0, 10);
const emptyOwed = () => ({ cents: 0, kills: 0, lucky: 0, best: 0, recent: [] });
function purse(owner) {
    let p = purses.get(owner);
    if (!p) {
        p = { owner, username: "", session: "pending", isGuest: false, banned: false, frozen: false, accountBadFlags: 0, day: dayKey(), dayCents: 0, balance: 0, owed: emptyOwed(), waiting: [], told: new Set(), diedAt: 0 };
        purses.set(owner, p);
    }
    if (p.day !== dayKey()) {
        p.day = dayKey();
        p.dayCents = 0;
        p.told.delete("capped");
    }
    return p;
}
const getSettings = () => ({ ...settings, slimePay: { ...settings.slimePay } });
exports.getSettings = getSettings;
const economyStatus = () => ({ settings: (0, exports.getSettings)(), loaded: settingsLoaded, rest: (0, persistence_1.restConfigured)(), purses: purses.size });
exports.economyStatus = economyStatus;
// ── settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
    if (!(0, persistence_1.restConfigured)())
        return;
    for (const wait of [0, 15000, 60000, 180000]) {
        if (wait)
            await new Promise(resolve => setTimeout(resolve, wait));
        try {
            const res = await (0, persistence_1.requestRest)("GET", `/admin/economy/${encodeURIComponent((0, persistence_1.worldName)())}`, undefined, 70000);
            if (res?.settings) {
                settings = withDefaults(res.settings);
                settingsLoaded = true;
            }
            return;
        }
        catch (error) {
            console.warn(`[economy] couldn't load the settings (${error?.message}) - using the defaults for now`);
        }
    }
}
async function saveSettings(next) {
    const merged = { ...settings, ...next, slimePay: { ...settings.slimePay, ...(next.slimePay ?? {}) } };
    const res = await (0, persistence_1.requestRest)("PUT", `/admin/economy/${encodeURIComponent((0, persistence_1.worldName)())}`, { settings: merged });
    settings = withDefaults(res.settings);
    settingsLoaded = true;
    return (0, exports.getSettings)();
}
// ── the login check ──────────────────────────────────────────────────────────
const checking = new Map(); // socket id -> its check
/**
 * Checks a connection's login token against the REST server, once per
 * connection and account. Returns at once; what it finds is applied when it
 * comes back - a bad token or a ban disconnects them.
 */
function verifySession(socketId, owner, name, token, alreadyFor, onValid) {
    if (!owner || owner.startsWith("bot_"))
        return;
    if (alreadyFor === owner)
        return;
    const key = `${socketId}:${owner}`;
    if (checking.has(key))
        return;
    const p = purse(owner);
    p.username = name;
    p.session = "pending";
    if (!(0, persistence_1.restConfigured)()) {
        p.session = "missing";
        return;
    }
    const job = (async () => {
        try {
            const res = await (0, persistence_1.requestRest)("POST", "/admin/sessions/verify", { owner, token: typeof token === "string" ? token : null }, 70000);
            if (res?.reason === "noaccount" || res?.reason === "badowner") {
                p.session = "invalid";
                (0, watch_1.setSession)(owner, "invalid", null);
                (0, watch_1.raiseFlag)(owner, "bad-token", "bad", "joined as an account that doesn't exist");
                p.waiting = [];
                hooks.disconnect(owner, "session-invalid", { message: "Your session couldn't be checked - please log in again." });
                return;
            }
            p.isGuest = !!res?.isGuest;
            p.banned = !!res?.banned;
            p.frozen = !!res?.frozen;
            p.accountBadFlags = Number(res?.badFlags) || 0;
            const w = res?.wallet;
            if (w) {
                p.balance = w.cents ?? 0;
                if (w.day === dayKey())
                    p.dayCents = Math.max(p.dayCents, w.dayCents ?? 0);
            }
            if (p.banned) {
                p.waiting = [];
                hooks.disconnect(owner, "account-banned", { reason: res?.bannedReason ?? "" });
                return;
            }
            if (res?.tokenState === "valid") {
                p.session = "valid";
                (0, watch_1.setSession)(owner, "valid", p.isGuest);
                onValid();
                tellState(p);
                // what they killed while this was being checked
                const waiting = p.waiting.filter(kill => Date.now() - kill.t < QUEUE_WHILE_CHECKING_MS);
                p.waiting = [];
                waiting.forEach(kill => payKill(owner, kill.kind, kill.name, kill.targetId, kill.unpaidReason));
                return;
            }
            p.waiting = [];
            if (res?.tokenState === "missing") {
                p.session = "missing";
                (0, watch_1.setSession)(owner, "missing", p.isGuest);
                tellState(p);
                return;
            }
            // a token, but someone else's or forged
            p.session = "invalid";
            (0, watch_1.setSession)(owner, "invalid", p.isGuest);
            (0, watch_1.raiseFlag)(owner, "bad-token", "bad", `login token was ${res?.tokenState ?? "rejected"}`);
            hooks.disconnect(owner, "session-invalid", { message: "Your session couldn't be checked - please log in again." });
        }
        catch (error) {
            // the REST server asleep or down: still "pending" - kills wait, the next join tries again
            console.warn(`[economy] couldn't check ${name}'s session: ${error?.message}`);
        }
        finally {
            checking.delete(key);
        }
    })();
    checking.set(key, job);
}
// what the wallet card shows on entering
function tellState(p) {
    hooks.emitTo(p.owner, "wallet-state", {
        enabled: settings.enabled, session: p.session, isGuest: p.isGuest, frozen: p.frozen,
        balance: p.balance + p.owed.cents, dayCents: p.dayCents, capCents: settings.dailyCapCents,
        minWithdrawCents: exports.MIN_WITHDRAW_CENTS, currency: "CAD",
    });
}
// ── paying a kill ────────────────────────────────────────────────────────────
/**
 * A kill by `owner` of an enemy of `kind` (its tcp name: "waterslime"...).
 * Only the paying slimes go any further. unpaidReason: the blow that did it
 * looked wrong (watch.ts) - the kill check fails. targetId lets the bar and the
 * card sit over the body.
 */
function payKill(owner, kind, name, targetId, unpaidReason) {
    if (!owner || owner.startsWith("bot_") || owner.startsWith("undead_"))
        return;
    const base = Math.round(Number(settings.slimePay[kind]));
    if (!exports.SLIME_KINDS.includes(kind) || !(base > 0))
        return;
    if (!settings.enabled)
        return;
    const p = purse(owner);
    // the login check isn't back yet - this kill is judged when it is
    if (p.session === "pending") {
        if (p.waiting.length < 500)
            p.waiting.push({ kind, name, targetId, unpaidReason, t: Date.now() });
        return;
    }
    // the four checks, in order - the first that fails ends it
    const room = settings.dailyCapCents > 0 ? Math.max(0, settings.dailyCapCents - p.dayCents) : Infinity;
    const steps = [
        ["kill", () => p.session === "valid" && !unpaidReason, p.session !== "valid" ? "unverified session" : unpaidReason ?? ""],
        ["record", () => !p.banned && !p.frozen && (0, watch_1.badFlagCount)(owner) === 0 && p.accountBadFlags === 0, p.frozen || p.banned ? "account frozen" : "flagged record"],
        ["limit", () => room >= base, "daily cap reached"],
        ["roll", () => Math.random() < settings.payChance, "no pay this time"],
    ];
    const checks = [];
    let failed = null;
    for (const [id, test, why] of steps) {
        if (failed) {
            checks.push({ id, label: CHECK_LABELS[id], state: "skip" });
            continue;
        }
        const ok = test();
        checks.push({ id, label: CHECK_LABELS[id], state: ok ? "ok" : "fail" });
        if (!ok)
            failed = why;
    }
    const cents = failed ? 0 : base;
    if (cents > 0) {
        p.dayCents += cents;
        p.owed.cents += cents;
        p.owed.kills += 1;
        p.owed.best = Math.max(p.owed.best, cents);
        p.owed.recent.unshift({ n: String(name || "Slime").slice(0, 40), c: cents, l: 0, t: Date.now() });
        p.owed.recent.length = Math.min(p.owed.recent.length, RECENT);
    }
    (0, watch_1.watchKill)(owner, name, cents, false, failed ?? undefined);
    hooks.emitTo(owner, "wallet-check", {
        // stake: what this slime pays when every check passes - the card shows it while it checks
        targetId, name, kind, checks, cents, stake: base,
        balance: p.balance + p.owed.cents, dayCents: p.dayCents, capCents: settings.dailyCapCents,
    });
}
/** An admin cleared their flags (commands.ts) - the record check passes again. */
function clearAccountFlags(owner) {
    purse(owner).accountBadFlags = 0;
}
// ── saving it ────────────────────────────────────────────────────────────────
let flushing = false;
// the credit batch on its way to the REST server, if any - a death waits for it, then wipes
let inFlight = Promise.resolve();
async function flush(onlyOwner) {
    if (flushing && !onlyOwner)
        return;
    const due = [...purses.values()].filter(p => p.owed.cents > 0 || p.owed.kills > 0).filter(p => !onlyOwner || p.owner === onlyOwner);
    const flags = (0, watch_1.takeFlagReports)();
    if (!due.length && !flags.length)
        return;
    if (!(0, persistence_1.restConfigured)())
        return;
    flushing = !onlyOwner;
    // taken off now; put back if the send fails
    const batch = due.map(p => { const owed = p.owed; p.owed = emptyOwed(); return { p, owed }; });
    const sentAt = Date.now();
    try {
        if (batch.length) {
            const sending = (0, persistence_1.requestRest)("POST", "/admin/wallets/credit", {
                capCents: settings.dailyCapCents,
                credits: batch.map(({ p, owed }) => ({ owner: p.owner, ...owed })),
            });
            inFlight = sending.catch(() => { });
            const res = await sending;
            for (const result of res?.results ?? []) {
                const p = purses.get(result.owner);
                if (!p)
                    continue;
                if (Number.isFinite(result.cents))
                    p.balance = result.cents;
                if (result.frozen)
                    p.frozen = true;
            }
        }
        // the anti-cheat warnings, kept on each account
        const byOwner = new Map();
        flags.forEach(({ owner, flag }) => { if (/^[a-f0-9]{24}$/i.test(owner))
            byOwner.set(owner, [...(byOwner.get(owner) ?? []), flag]); });
        for (const [owner, list] of byOwner)
            await (0, persistence_1.requestRest)("POST", `/admin/users/${owner}/flags`, { flags: list }).catch(() => { });
    }
    catch (error) {
        console.warn(`[economy] couldn't save ${batch.length} wallet credit(s): ${error?.message} - will retry`);
        batch.forEach(({ p, owed }) => {
            // they died since - that money died with them
            if (p.diedAt >= sentAt)
                return;
            p.owed.cents += owed.cents;
            p.owed.kills += owed.kills;
            p.owed.lucky += owed.lucky;
            p.owed.best = Math.max(p.owed.best, owed.best);
            p.owed.recent = [...p.owed.recent, ...owed.recent].slice(0, RECENT);
        });
    }
    finally {
        if (!onlyOwner)
            flushing = false;
    }
}
/**
 * They died (index.ts "will-die" - permadeath): every cent in VesselPay goes with them. Wiped here at
 * once (nothing owed is ever sent), then on the account once any credit already on its way has landed -
 * so it can't land after the wipe. The REST server wipes it again when the client deletes the character.
 * A withdrawal already asked for stays in review. The day's count stays (dying doesn't reset the cap).
 */
async function forfeit(owner) {
    if (!owner || owner.startsWith("bot_") || owner.startsWith("undead_"))
        return;
    const p = purses.get(owner);
    if (p) {
        p.diedAt = Date.now();
        p.owed = emptyOwed();
        p.waiting = [];
        p.balance = 0;
    }
    if (!(0, persistence_1.restConfigured)() || !/^[a-f0-9]{24}$/i.test(owner))
        return;
    await inFlight;
    for (const wait of [0, 5000, 20000]) {
        if (wait)
            await new Promise(resolve => setTimeout(resolve, wait));
        try {
            const res = await (0, persistence_1.requestRest)("POST", `/admin/wallets/${owner}/forfeit`, { reason: "died" });
            if (res?.forfeited)
                console.log(`[economy] ${p?.username || owner} died - CA${(res.forfeited / 100).toFixed(2)} of VesselPay gone with them`);
            return;
        }
        catch (error) {
            console.warn(`[economy] couldn't wipe ${owner}'s wallet on death: ${error?.message}`);
        }
    }
}
/** They left - what they're owed goes now; the purse stays (a reconnect keeps the day's count). */
function onLeave(owner) {
    flush(owner).catch(() => { });
}
/** An admin froze or banned them (commands.ts) - takes effect at once. */
function setStanding(owner, change) {
    const p = purse(owner);
    if (change.banned !== undefined)
        p.banned = change.banned;
    if (change.frozen !== undefined) {
        p.frozen = change.frozen;
        p.told.delete("frozen");
    }
}
function purseOf(owner) {
    const p = purses.get(owner);
    if (!p)
        return null;
    return { session: p.session, isGuest: p.isGuest, banned: p.banned, frozen: p.frozen, dayCents: p.dayCents, balance: p.balance + p.owed.cents, owedCents: p.owed.cents, waiting: p.waiting.length };
}
function startEconomy(h) {
    hooks = h;
    loadSettings();
    setInterval(() => { flush().catch(() => { }); }, FLUSH_MS).unref();
}
