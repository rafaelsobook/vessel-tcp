import { requestRest, restConfigured, worldName } from "../admin/persistence"
import { TOME_SKILLS, tomeOfRank, setTomeAvailability } from "./skillTomes"

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

export const TOME_COPIES: Record<number, number> = { 3: 10, 4: 3 }
const RANK = new Map<string, number>(TOME_SKILLS.map(([name, , rank]) => [name, rank]))
const capOf = (item: any): number | undefined => item?.itemCateg === "skillbook" ? TOME_COPIES[RANK.get(item.skillName) ?? 0] : undefined

let counts: Record<string, number> = {}
// Market orders (the REST server's routes/shopR.js) whose copy was taken, newest last - kept with the count so a
// retry after a restart can't take a second copy for the same order
let shopOrders: string[] = []
let loaded = false
const left = (skill: string) => {
    const cap = TOME_COPIES[RANK.get(skill) ?? 0]
    return cap === undefined ? Infinity : cap - (counts[skill] ?? 0)
}
// what a fresh chest may roll: only skills with copies left. Before the count is in (chests roll at
// start) anything may - the claim still decides, and swaps one that has run out
setTomeAvailability(skill => !TOME_COPIES[RANK.get(skill) ?? 0] || !loaded || left(skill) > 0)

export async function loadTomeSupply() {
    if (!restConfigured()) { loaded = true; return }
    for (const wait of [0, 15_000, 60_000, 180_000, 300_000]) {
        if (wait) await new Promise(resolve => setTimeout(resolve, wait))
        try {
            const res = await requestRest("GET", `/admin/tomes/${encodeURIComponent(worldName())}`, undefined, 70_000)
            // copies counted meanwhile (none can be, while it isn't loaded - but just in case) stay on top
            const saved = res?.counts ?? {}
            for (const [skill, n] of Object.entries(saved)) counts[skill] = Math.max(counts[skill] ?? 0, Number(n) || 0)
            shopOrders = [...new Set([...(Array.isArray(res?.shopOrders) ? res.shopOrders : []), ...shopOrders])].slice(-2000)
            loaded = true
            console.log(`[tomes] limited copies found so far: ${Object.entries(counts).map(([s, n]) => `${s} ${n}`).join(", ") || "none"}`)
            return
        } catch (error: any) {
            console.warn(`[tomes] couldn't load the copies found (${error?.message}) - limited tomes wait till it's in`)
        }
    }
}

let saveTimer: any = null
function save() {
    if (!restConfigured()) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
        try {
            await requestRest("PUT", `/admin/tomes/${encodeURIComponent(worldName())}`, { counts, shopOrders })
        } catch (error: any) {
            console.warn(`[tomes] couldn't save the copies found (${error?.message}) - trying again`)
            save()
        }
    }, 1000)
}

// chest id -> the limited skills reserved for whoever's taking it
const held = new Map<string, { skills: string[], timer: any }>()

/**
 * A player starts taking this chest (index.ts claimPickup). ok false + "busy": the count isn't loaded
 * yet - try again shortly. contents: what's really inside, when a limited tome had to be swapped.
 */
export function reserveChest(treasure: any, ms: number): { ok: boolean, reason?: string, contents?: any, swapped?: string[] } {
    const items = [treasure?.itemDetail, ...(treasure?.extras ?? [])]
    const limited = items.map((item, i) => (capOf(item) ? i : -1)).filter(i => i >= 0)
    if (!limited.length || held.has(treasure.itemId)) return { ok: true }
    if (!loaded) return { ok: false, reason: "busy" }
    const skills: string[] = [], swapped: string[] = []
    limited.forEach(i => {
        const skill = items[i].skillName
        if (left(skill) > 0) {
            counts[skill] = (counts[skill] ?? 0) + 1
            skills.push(skill)
        } else {
            swapped.push(items[i].dn)
            items[i] = tomeOfRank(2)
        }
    })
    if (swapped.length) {
        treasure.itemDetail = items[0]
        treasure.extras = items.slice(1)
    }
    const holdMs = Math.min(20_000, Math.max(0, Number(ms) || 0)) + 10_000
    held.set(treasure.itemId, { skills, timer: setTimeout(() => releaseChest(treasure.itemId), holdMs) })
    if (skills.length) save()
    return { ok: true, swapped, contents: swapped.length ? { itemDetail: items[0], extras: items.slice(1) } : undefined }
}

/** The chest was taken (removeTreasure): its copies are found for good. One taken unclaimed counts now. */
export function confirmChest(treasure: any) {
    const h = held.get(treasure?.itemId)
    if (h) { clearTimeout(h.timer); held.delete(treasure.itemId); return }
    // taken without a claim (an old client, or the claim's answer late): counted now, cap or not
    const late = [treasure?.itemDetail, ...(treasure?.extras ?? [])].filter(capOf)
    late.forEach(item => { counts[item.skillName] = (counts[item.skillName] ?? 0) + 1 })
    if (late.length) save()
}

/** They stopped short (releasePickup) or the claim ran out: the copies go back. */
export function releaseChest(treasureId: string) {
    const h = held.get(treasureId)
    if (!h) return
    clearTimeout(h.timer)
    held.delete(treasureId)
    h.skills.forEach(skill => { counts[skill] = Math.max(0, (counts[skill] ?? 0) - 1) })
    if (h.skills.length) save()
}

/** For the admin: every limited skill, how many found of how many. */
export function tomeSupplyStatus() {
    return {
        loaded,
        tomes: TOME_SKILLS.filter(([, , rank]) => TOME_COPIES[rank]).map(([name, dn, rank]) => ({ name, dn, rank, found: counts[name] ?? 0, copies: TOME_COPIES[rank] })),
    }
}

// ── the Vessel Market ──────────────────────────────────────────────────────────
// The market (server routes/shopR.js, client/src/shop/) sells High and Legendary tomes for real money. A
// Legendary one is a copy from THIS pool, so a bought one counts exactly like a found one. The REST server asks
// after it has the money: take a copy (shopSell), and give it back if the order then fails (shopRelease).

/** How many copies of each limited skill are left, for the market's shelf. null while the count isn't loaded. */
export function shopLeft(skills: string[]): Record<string, number> | null {
    if (!loaded) return null
    const out: Record<string, number> = {}
    skills.forEach(skill => { if (TOME_COPIES[RANK.get(skill) ?? 0]) out[skill] = Math.max(0, left(skill)) })
    return out
}

/** Takes one copy of a Legendary skill for a market order. Asking twice for the same order takes one copy. */
export function shopSell(skill: string, orderId: string): { ok: boolean, reason?: string } {
    if (!TOME_COPIES[RANK.get(skill) ?? 0]) return { ok: false, reason: "notlimited" }
    if (!loaded) return { ok: false, reason: "busy" }
    if (shopOrders.includes(orderId)) return { ok: true }
    if (left(skill) <= 0) return { ok: false, reason: "soldout" }
    counts[skill] = (counts[skill] ?? 0) + 1
    shopOrders.push(orderId)
    if (shopOrders.length > 2000) shopOrders.shift()
    save()
    return { ok: true }
}

/** The order failed after its copy was taken (a refund): the copy goes back. Safe to repeat. */
export function shopRelease(skill: string, orderId: string): { ok: boolean } {
    const at = shopOrders.indexOf(orderId)
    if (at < 0) return { ok: true }
    shopOrders.splice(at, 1)
    counts[skill] = Math.max(0, (counts[skill] ?? 0) - 1)
    save()
    return { ok: true }
}
