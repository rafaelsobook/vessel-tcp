"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.store = exports.restConfigured = void 0;
exports.requestRest = requestRest;
const auth_1 = require("./auth");
const emptyOverlay = () => ({ enemies: [], treasures: [], grains: [], mushrooms: [], ores: [] });
// Where the REST server is. API_URL wins; on Render it falls back to the
// production REST server, anywhere else to a local one - so a tcp running on
// someone's machine never writes into the live world by accident.
const API_URL = (process.env.API_URL
    ?? (process.env.RENDER ? "https://vessel-serv.onrender.com" : "http://localhost:8100")).replace(/\/+$/, "");
// each environment keeps its own document, in case they share a database
const WORLD_NAME = process.env.ADMIN_WORLD_NAME ?? (process.env.RENDER ? "production" : "dev");
const ENABLED = process.env.ADMIN_PERSIST !== "off";
// a cold REST server (a free host waking up) can take most of a minute
const LOAD_TIMEOUT_MS = 70000;
const SAVE_TIMEOUT_MS = 30000;
const RETRY_DELAYS_MS = [10000, 30000, 60000, 120000, 180000, 300000];
const SAVE_DEBOUNCE_MS = 3000;
async function requestRest(method, path, body, timeoutMs = SAVE_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${API_URL}${path}`, {
            method,
            headers: { "content-type": "application/json", "x-admin-key": (0, auth_1.adminKeyForServices)() },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
        });
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        }
        catch { /* not JSON */ }
        if (!res.ok)
            throw new Error(json?.error ?? `REST server answered ${res.status}`);
        return json;
    }
    catch (error) {
        if (error?.name === "AbortError")
            throw new Error("REST server didn't answer in time");
        throw error;
    }
    finally {
        clearTimeout(timer);
    }
}
const restConfigured = () => ENABLED;
exports.restConfigured = restConfigured;
class OverlayStore {
    constructor() {
        this.overlay = emptyOverlay();
        this.status = ENABLED ? "loading" : "off";
        this.lastError = null;
        this.lastSavedAt = null;
        this.dirty = false;
        this.saveTimer = null;
        this.attempt = 0;
        this.applyLoaded = null;
    }
    info() {
        return {
            status: this.status,
            server: API_URL.replace(/^https?:\/\//, ""),
            world: WORLD_NAME,
            lastError: this.lastError,
            lastSavedAt: this.lastSavedAt,
            dirty: this.dirty,
            counts: Object.fromEntries(Object.keys(this.overlay).map(kind => [kind, this.overlay[kind].length])),
        };
    }
    // Loads the saved placements and hands the ones this run doesn't have yet to
    // applyLoaded. Retries with a growing wait - the REST server may well be
    // waking up - and says so in the log rather than failing silently.
    start(applyLoaded) {
        this.applyLoaded = applyLoaded;
        if (!ENABLED)
            return console.log("[admin] persistence is off (ADMIN_PERSIST=off) - placements last until the next restart");
        this.status = "loading";
        this.attempt = 0;
        setTimeout(() => this.load(), 3000);
    }
    retry() {
        if (!ENABLED || this.status === "loading" || this.status === "ready")
            return;
        this.status = "loading";
        this.attempt = 0;
        this.load();
    }
    async load() {
        try {
            const res = await requestRest("GET", `/admin/world-state/${encodeURIComponent(WORLD_NAME)}`, undefined, LOAD_TIMEOUT_MS);
            const saved = { ...emptyOverlay(), ...(res?.data ?? {}) };
            // placements made while this was loading are kept; the saved ones
            // that aren't here yet are added to the world
            const fresh = emptyOverlay();
            Object.keys(saved).forEach(kind => {
                const have = new Set(this.overlay[kind].map(entry => entry.key));
                saved[kind].forEach((entry) => {
                    if (!have.has(entry.key)) {
                        this.overlay[kind].push(entry);
                        fresh[kind].push(entry);
                    }
                });
            });
            this.status = "ready";
            this.lastError = null;
            console.log(`[admin] saved placements loaded from ${API_URL} (${WORLD_NAME}): ${Object.entries(saved).map(([kind, list]) => `${list.length} ${kind}`).join(", ")}`);
            this.applyLoaded?.(fresh);
            if (this.dirty)
                this.scheduleSave();
        }
        catch (error) {
            this.lastError = error?.message ?? String(error);
            if (this.attempt >= RETRY_DELAYS_MS.length) {
                this.status = "error";
                return console.warn(`[admin] gave up loading saved placements: ${this.lastError}`);
            }
            const wait = RETRY_DELAYS_MS[this.attempt++];
            console.warn(`[admin] couldn't load saved placements (${this.lastError}) - trying again in ${wait / 1000}s`);
            setTimeout(() => this.load(), wait);
        }
    }
    add(kind, entry) {
        if (!ENABLED)
            return;
        this.overlay[kind].push(entry);
        this.markDirty();
    }
    remove(kind, key) {
        if (!ENABLED)
            return;
        const list = this.overlay[kind];
        const index = list.findIndex(entry => entry.key === key);
        if (index === -1)
            return;
        list.splice(index, 1);
        this.markDirty();
    }
    has(kind, key) {
        return this.overlay[kind].some(entry => entry.key === key);
    }
    markDirty() {
        this.dirty = true;
        this.scheduleSave();
    }
    scheduleSave() {
        // never writes before the saved copy has been read - that would replace
        // everything saved with only what was added since this server started
        if (this.status !== "ready" || this.saveTimer)
            return;
        this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush(); }, SAVE_DEBOUNCE_MS);
    }
    async flush() {
        if (this.status !== "ready" || !this.dirty)
            return;
        this.dirty = false;
        try {
            await requestRest("PUT", `/admin/world-state/${encodeURIComponent(WORLD_NAME)}`, { data: this.overlay });
            this.lastSavedAt = Date.now();
            this.lastError = null;
        }
        catch (error) {
            this.dirty = true;
            this.lastError = error?.message ?? String(error);
            console.warn(`[admin] couldn't save placements (${this.lastError}) - trying again in 30s`);
            if (!this.saveTimer)
                this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush(); }, 30000);
        }
    }
}
exports.store = new OverlayStore();
