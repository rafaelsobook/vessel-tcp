"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOME_COPIES = void 0;
exports.loadTomeSupply = loadTomeSupply;
exports.reserveChest = reserveChest;
exports.confirmChest = confirmChest;
exports.releaseChest = releaseChest;
exports.tomeSupplyStatus = tomeSupplyStatus;
exports.shopLeft = shopLeft;
exports.shopSell = shopSell;
exports.shopRelease = shopRelease;
const persistence_1 = require("../admin/persistence");
const skillTomes_1 = require("./skillTomes");
// LIMITED TOMES (the user, 2026-11-18): only so many copies of each Legendary and God tier skill book
// are ever found in a world - TOME_COPIES of each skill. Once they're all found, a chest that would
// have held one holds a High tome instead.
//
// tcp decides, from its own count in memory: the client waits only 1.5 s for a claim's answer, and the
// REST server (asleep on a free host) can take far longer - so the count is loaded once at start and
// saved in the background after every change (REST /admin/tomes/:world - each environment its own).
//
// A copy is RESERVED when a player starts taking a chest that holds one (index.ts "claimPickup"),
// CONFIRMED when the chest is taken ("removeTreasure"), and given back if they stop short - walking
// off, the claim running out. A copy that runs out the moment someone claims it is swapped for a
// High tome right then, and the claim's answer tells the client what's really inside.
// Chests and grotto tomes are only ROLLED from skills with copies left (skillTomes.ts), so a swap
// only happens when two players race for the last one.
exports.TOME_COPIES = { 3: 10, 4: 3 };
const RANK = new Map(skillTomes_1.TOME_SKILLS.map(([name, , rank]) => [name, rank]));
const capOf = (item) => item?.itemCateg === "skillbook" ? exports.TOME_COPIES[RANK.get(item.skillName) ?? 0] : undefined;
let counts = {};
// Market orders (the REST server's routes/shopR.js) whose copy was taken, newest last - kept with the count so a
// retry after a restart can't take a second copy for the same order
let shopOrders = [];
let loaded = false;
const left = (skill) => {
    const cap = exports.TOME_COPIES[RANK.get(skill) ?? 0];
    return cap === undefined ? Infinity : cap - (counts[skill] ?? 0);
};
// what a fresh chest may roll: only skills with copies left. Before the count is in (chests roll at
// start) anything may - the claim still decides, and swaps one that has run out
(0, skillTomes_1.setTomeAvailability)(skill => !exports.TOME_COPIES[RANK.get(skill) ?? 0] || !loaded || left(skill) > 0);
async function loadTomeSupply() {
    if (!(0, persistence_1.restConfigured)()) {
        loaded = true;
        return;
    }
    for (const wait of [0, 15000, 60000, 180000, 300000]) {
        if (wait)
            await new Promise(resolve => setTimeout(resolve, wait));
        try {
            const res = await (0, persistence_1.requestRest)("GET", `/admin/tomes/${encodeURIComponent((0, persistence_1.worldName)())}`, undefined, 70000);
            // copies counted meanwhile (none can be, while it isn't loaded - but just in case) stay on top
            const saved = res?.counts ?? {};
            for (const [skill, n] of Object.entries(saved))
                counts[skill] = Math.max(counts[skill] ?? 0, Number(n) || 0);
            shopOrders = [...new Set([...(Array.isArray(res?.shopOrders) ? res.shopOrders : []), ...shopOrders])].slice(-2000);
            loaded = true;
            console.log(`[tomes] limited copies found so far: ${Object.entries(counts).map(([s, n]) => `${s} ${n}`).join(", ") || "none"}`);
            return;
        }
        catch (error) {
            console.warn(`[tomes] couldn't load the copies found (${error?.message}) - limited tomes wait till it's in`);
        }
    }
}
let saveTimer = null;
function save() {
    if (!(0, persistence_1.restConfigured)())
        return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        try {
            await (0, persistence_1.requestRest)("PUT", `/admin/tomes/${encodeURIComponent((0, persistence_1.worldName)())}`, { counts, shopOrders });
        }
        catch (error) {
            console.warn(`[tomes] couldn't save the copies found (${error?.message}) - trying again`);
            save();
        }
    }, 1000);
}
// chest id -> the limited skills reserved for whoever's taking it
const held = new Map();
/**
 * A player starts taking this chest (index.ts claimPickup). ok false + "busy": the count isn't loaded
 * yet - try again shortly. contents: what's really inside, when a limited tome had to be swapped.
 */
function reserveChest(treasure, ms) {
    const items = [treasure?.itemDetail, ...(treasure?.extras ?? [])];
    const limited = items.map((item, i) => (capOf(item) ? i : -1)).filter(i => i >= 0);
    if (!limited.length || held.has(treasure.itemId))
        return { ok: true };
    if (!loaded)
        return { ok: false, reason: "busy" };
    const skills = [], swapped = [];
    limited.forEach(i => {
        const skill = items[i].skillName;
        if (left(skill) > 0) {
            counts[skill] = (counts[skill] ?? 0) + 1;
            skills.push(skill);
        }
        else {
            swapped.push(items[i].dn);
            items[i] = (0, skillTomes_1.tomeOfRank)(2);
        }
    });
    if (swapped.length) {
        treasure.itemDetail = items[0];
        treasure.extras = items.slice(1);
    }
    const holdMs = Math.min(20000, Math.max(0, Number(ms) || 0)) + 10000;
    held.set(treasure.itemId, { skills, timer: setTimeout(() => releaseChest(treasure.itemId), holdMs) });
    if (skills.length)
        save();
    return { ok: true, swapped, contents: swapped.length ? { itemDetail: items[0], extras: items.slice(1) } : undefined };
}
/** The chest was taken (removeTreasure): its copies are found for good. One taken unclaimed counts now. */
function confirmChest(treasure) {
    const h = held.get(treasure?.itemId);
    if (h) {
        clearTimeout(h.timer);
        held.delete(treasure.itemId);
        return;
    }
    // taken without a claim (an old client, or the claim's answer late): counted now, cap or not
    const late = [treasure?.itemDetail, ...(treasure?.extras ?? [])].filter(capOf);
    late.forEach(item => { counts[item.skillName] = (counts[item.skillName] ?? 0) + 1; });
    if (late.length)
        save();
}
/** They stopped short (releasePickup) or the claim ran out: the copies go back. */
function releaseChest(treasureId) {
    const h = held.get(treasureId);
    if (!h)
        return;
    clearTimeout(h.timer);
    held.delete(treasureId);
    h.skills.forEach(skill => { counts[skill] = Math.max(0, (counts[skill] ?? 0) - 1); });
    if (h.skills.length)
        save();
}
/** For the admin: every limited skill, how many found of how many. */
function tomeSupplyStatus() {
    return {
        loaded,
        tomes: skillTomes_1.TOME_SKILLS.filter(([, , rank]) => exports.TOME_COPIES[rank]).map(([name, dn, rank]) => ({ name, dn, rank, found: counts[name] ?? 0, copies: exports.TOME_COPIES[rank] })),
    };
}
// ── the Vessel Market ──────────────────────────────────────────────────────────
// The market (server routes/shopR.js, client/src/shop/) sells High and Legendary tomes for real money. A
// Legendary one is a copy from THIS pool, so a bought one counts exactly like a found one. The REST server asks
// after it has the money: take a copy (shopSell), and give it back if the order then fails (shopRelease).
/** How many copies of each limited skill are left, for the market's shelf. null while the count isn't loaded. */
function shopLeft(skills) {
    if (!loaded)
        return null;
    const out = {};
    skills.forEach(skill => { if (exports.TOME_COPIES[RANK.get(skill) ?? 0])
        out[skill] = Math.max(0, left(skill)); });
    return out;
}
/** Takes one copy of a Legendary skill for a market order. Asking twice for the same order takes one copy. */
function shopSell(skill, orderId) {
    if (!exports.TOME_COPIES[RANK.get(skill) ?? 0])
        return { ok: false, reason: "notlimited" };
    if (!loaded)
        return { ok: false, reason: "busy" };
    if (shopOrders.includes(orderId))
        return { ok: true };
    if (left(skill) <= 0)
        return { ok: false, reason: "soldout" };
    counts[skill] = (counts[skill] ?? 0) + 1;
    shopOrders.push(orderId);
    if (shopOrders.length > 2000)
        shopOrders.shift();
    save();
    return { ok: true };
}
/** The order failed after its copy was taken (a refund): the copy goes back. Safe to repeat. */
function shopRelease(skill, orderId) {
    const at = shopOrders.indexOf(orderId);
    if (at < 0)
        return { ok: true };
    shopOrders.splice(at, 1);
    counts[skill] = Math.max(0, (counts[skill] ?? 0) - 1);
    save();
    return { ok: true };
}
