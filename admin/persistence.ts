import { adminKeyForServices } from "./auth"

// Admin placements that outlive a restart.
//
// The world lives in this server's memory and is rebuilt from the data files
// on every start, so whatever an admin adds from the page is gone with the next
// restart unless it's written somewhere. This server has no database of its
// own and the host's disk doesn't last, so the REST server (which already has
// Mongo) keeps one document for it - server/routes/adminR.js. What's kept is
// only what an admin chose to keep: the spawn points of enemies, the chests,
// grains, mushrooms and ores they placed with "keep" on. The data files stay the
// source for the base world.

export type OverlayEnemy = { key: string, name: string, placeId: number, x: number, y: number, z: number, respawn: boolean }
export type OverlayTreasure = { key: string, placeId: number, x: number, y: number, z: number, itemDetail: any }
export type OverlayGrain = { key: string, placeId: number, x: number, y: number, z: number }
export type OverlayMushroom = { key: string, placeId: number, kind: string, x: number, y: number, z: number }
export type OverlayOre = { key: string, placeId: number, vein: string, x: number, y: number, z: number, rotation: number }
export type Overlay = {
    enemies: OverlayEnemy[]
    treasures: OverlayTreasure[]
    grains: OverlayGrain[]
    mushrooms: OverlayMushroom[]
    ores: OverlayOre[]
}
export type OverlayKind = keyof Overlay

const emptyOverlay = (): Overlay => ({ enemies: [], treasures: [], grains: [], mushrooms: [], ores: [] })

// Where the REST server is. API_URL wins; on Render it falls back to the
// production REST server, anywhere else to a local one - so a tcp running on
// someone's machine never writes into the live world by accident.
const API_URL = (process.env.API_URL
    ?? (process.env.RENDER ? "https://vessel-serv.onrender.com" : "http://localhost:8100")).replace(/\/+$/, "")
// each environment keeps its own document, in case they share a database
const WORLD_NAME = process.env.ADMIN_WORLD_NAME ?? (process.env.RENDER ? "production" : "dev")
const ENABLED = process.env.ADMIN_PERSIST !== "off"

// a cold REST server (a free host waking up) can take most of a minute
const LOAD_TIMEOUT_MS = 70_000
const SAVE_TIMEOUT_MS = 30_000
const RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 120_000, 180_000, 300_000]
const SAVE_DEBOUNCE_MS = 3_000

export async function requestRest(method: string, path: string, body?: unknown, timeoutMs = SAVE_TIMEOUT_MS): Promise<any> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const res = await fetch(`${API_URL}${path}`, {
            method,
            headers: { "content-type": "application/json", "x-admin-key": adminKeyForServices() },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
        })
        const text = await res.text()
        let json: any = null
        try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
        if (!res.ok) throw new Error(json?.error ?? `REST server answered ${res.status}`)
        return json
    } catch (error: any) {
        if (error?.name === "AbortError") throw new Error("REST server didn't answer in time")
        throw error
    } finally {
        clearTimeout(timer)
    }
}

export const restConfigured = () => ENABLED

type Status = "off" | "loading" | "ready" | "error"

class OverlayStore {
    overlay: Overlay = emptyOverlay()
    status: Status = ENABLED ? "loading" : "off"
    lastError: string | null = null
    lastSavedAt: number | null = null
    private dirty = false
    private saveTimer: NodeJS.Timeout | null = null
    private attempt = 0
    private applyLoaded: ((entries: Overlay) => void) | null = null

    info() {
        return {
            status: this.status,
            server: API_URL.replace(/^https?:\/\//, ""),
            world: WORLD_NAME,
            lastError: this.lastError,
            lastSavedAt: this.lastSavedAt,
            dirty: this.dirty,
            counts: Object.fromEntries((Object.keys(this.overlay) as OverlayKind[]).map(kind => [kind, this.overlay[kind].length])),
        }
    }

    // Loads the saved placements and hands the ones this run doesn't have yet to
    // applyLoaded. Retries with a growing wait - the REST server may well be
    // waking up - and says so in the log rather than failing silently.
    start(applyLoaded: (entries: Overlay) => void) {
        this.applyLoaded = applyLoaded
        if (!ENABLED) return console.log("[admin] persistence is off (ADMIN_PERSIST=off) - placements last until the next restart")
        this.status = "loading"
        this.attempt = 0
        setTimeout(() => this.load(), 3_000)
    }

    retry() {
        if (!ENABLED || this.status === "loading" || this.status === "ready") return
        this.status = "loading"
        this.attempt = 0
        this.load()
    }

    private async load() {
        try {
            const res = await requestRest("GET", `/admin/world-state/${encodeURIComponent(WORLD_NAME)}`, undefined, LOAD_TIMEOUT_MS)
            const saved: Overlay = { ...emptyOverlay(), ...(res?.data ?? {}) }
            // placements made while this was loading are kept; the saved ones
            // that aren't here yet are added to the world
            const fresh = emptyOverlay()
            ;(Object.keys(saved) as OverlayKind[]).forEach(kind => {
                const have = new Set(this.overlay[kind].map(entry => entry.key))
                saved[kind].forEach((entry: any) => {
                    if (!have.has(entry.key)) { (this.overlay[kind] as any[]).push(entry); (fresh[kind] as any[]).push(entry) }
                })
            })
            this.status = "ready"
            this.lastError = null
            console.log(`[admin] saved placements loaded from ${API_URL} (${WORLD_NAME}): ${Object.entries(saved).map(([kind, list]) => `${(list as any[]).length} ${kind}`).join(", ")}`)
            this.applyLoaded?.(fresh)
            if (this.dirty) this.scheduleSave()
        } catch (error: any) {
            this.lastError = error?.message ?? String(error)
            if (this.attempt >= RETRY_DELAYS_MS.length) {
                this.status = "error"
                return console.warn(`[admin] gave up loading saved placements: ${this.lastError}`)
            }
            const wait = RETRY_DELAYS_MS[this.attempt++]
            console.warn(`[admin] couldn't load saved placements (${this.lastError}) - trying again in ${wait / 1000}s`)
            setTimeout(() => this.load(), wait)
        }
    }

    add<K extends OverlayKind>(kind: K, entry: Overlay[K][number]) {
        if (!ENABLED) return
        ;(this.overlay[kind] as any[]).push(entry)
        this.markDirty()
    }

    remove(kind: OverlayKind, key: string) {
        if (!ENABLED) return
        const list = this.overlay[kind] as any[]
        const index = list.findIndex(entry => entry.key === key)
        if (index === -1) return
        list.splice(index, 1)
        this.markDirty()
    }

    has(kind: OverlayKind, key: string) {
        return (this.overlay[kind] as any[]).some(entry => entry.key === key)
    }

    private markDirty() {
        this.dirty = true
        this.scheduleSave()
    }

    private scheduleSave() {
        // never writes before the saved copy has been read - that would replace
        // everything saved with only what was added since this server started
        if (this.status !== "ready" || this.saveTimer) return
        this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush() }, SAVE_DEBOUNCE_MS)
    }

    async flush() {
        if (this.status !== "ready" || !this.dirty) return
        this.dirty = false
        try {
            await requestRest("PUT", `/admin/world-state/${encodeURIComponent(WORLD_NAME)}`, { data: this.overlay })
            this.lastSavedAt = Date.now()
            this.lastError = null
        } catch (error: any) {
            this.dirty = true
            this.lastError = error?.message ?? String(error)
            console.warn(`[admin] couldn't save placements (${this.lastError}) - trying again in 30s`)
            if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush() }, 30_000)
        }
    }
}

export const store = new OverlayStore()
