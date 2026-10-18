import { el, clear, toast, fmtDuration } from "./ui.js"
import { create as createDashboard } from "./views/dashboard.js"
import { create as createPlayers } from "./views/players.js"
import { create as createEnemies } from "./views/enemies.js"
import { create as createItems } from "./views/items.js"
import { create as createMap } from "./views/map.js"
import { create as createServer } from "./views/server.js"
import { create as createLogs } from "./views/logs.js"

// The page's core: signing in, the socket to the server's /admin namespace,
// the tabs, and what every view shares (`app`). Each view lives in views/ and
// is handed `app` once the catalog has arrived.

const KEY_STORAGE = "masterControlKey"
const $ = id => document.getElementById(id)

export const app = {
    socket: null,
    snapshot: null,     // the latest summary + roster pushed by the server
    catalog: null,      // what can be spawned, where, and which items exist
    audit: [],
    log: [],
    pick: null,         // { placeId, x, z } - the spot last clicked on the map
    views: [],
    active: null,
    handlers: {},

    on(event, handler) { (this.handlers[event] ??= []).push(handler) },
    emit(event, data) {
        for (const handler of this.handlers[event] ?? []) {
            try { handler(data) } catch (error) { console.error(`handler for "${event}" threw`, error) }
        }
    },

    // Sends a command and resolves with its result, or rejects with the
    // server's message. The wait is long on purpose: looking up a saved
    // character can wait on a REST server that's waking up.
    cmd(name, payload = {}) {
        return new Promise((resolve, reject) => {
            if (!this.socket?.connected) return reject(new Error("not connected to the server"))
            const timer = setTimeout(() => reject(new Error("the server didn't answer in time")), 90_000)
            this.socket.emit("cmd", name, payload, reply => {
                clearTimeout(timer)
                if (reply?.ok) resolve(reply.result)
                else reject(new Error(reply?.error ?? "no answer from the server"))
            })
        })
    },

    // cmd + a toast either way. Resolves with the result, or null when it failed.
    async run(name, payload = {}, success = null) {
        try {
            const result = await this.cmd(name, payload)
            if (success) toast(typeof success === "function" ? success(result) : success, "ok")
            return result
        } catch (error) {
            toast(error.message, "fail")
            return null
        }
    },

    placeById(placeId) { return this.catalog?.places.find(place => place.placeId === Number(placeId)) },
    placeName(placeId) { return this.placeById(placeId)?.name ?? `place ${placeId}` },

    // switch tab; the view may take the picked map spot or whatever it's told
    goto(tabId, detail) {
        showTab(tabId)
        this.views.find(view => view.id === tabId)?.onGoto?.(detail)
    },
}

// ── tabs ─────────────────────────────────────────────────────────────────────
function showTab(id) {
    const view = app.views.find(v => v.id === id) ?? app.views[0]
    if (!view) return
    app.active?.onHide?.()
    app.active = view
    app.views.forEach(v => { v.root.hidden = v !== view })
    document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.id === view.id))
    if (location.hash !== `#${view.id}`) history.replaceState(null, "", `#${view.id}`)
    view.onShow?.()
    if (app.snapshot) view.onSnapshot?.(app.snapshot)
}

function buildViews() {
    app.views = [createDashboard, createPlayers, createEnemies, createItems, createMap, createServer, createLogs].map(make => make(app))
    const tabs = clear($("tabs"))
    const views = clear($("views"))
    app.views.forEach(view => {
        view.tabButton = el("button", { class: "tab", type: "button", dataset: { id: view.id }, onclick: () => showTab(view.id) }, view.title)
        tabs.append(view.tabButton)
        view.root.hidden = true
        views.append(view.root)
    })
    showTab(location.hash.slice(1))
}

// the little number on a tab (players online, say)
function updateBadges() {
    app.views.forEach(view => {
        const text = view.badge?.(app.snapshot)
        let badge = view.tabButton.querySelector(".count")
        if (text == null || text === "") return badge?.remove()
        if (!badge) { badge = el("span", { class: "count" }); view.tabButton.append(badge) }
        badge.textContent = text
    })
}

// ── connection ───────────────────────────────────────────────────────────────
let everConnected = false

function setConnection(connected, text) {
    $("connDot").className = `dot ${connected ? "on" : "off"}`
    $("connText").textContent = text ?? (connected ? "connected" : "reconnecting...")
}

function loginError(message) {
    const box = $("loginError")
    box.textContent = message
    box.hidden = !message
    $("loginBtn").disabled = false
    $("loginBtn").textContent = "Connect"
}

function showApp(visible) {
    $("login").hidden = visible
    $("app").hidden = !visible
}

function connect(key, remember) {
    $("loginBtn").disabled = true
    $("loginBtn").textContent = "Connecting..."
    loginError("")
    app.socket?.close()
    everConnected = false

    // eslint-disable-next-line no-undef
    const socket = io("/admin", { auth: { key }, transports: ["websocket"], reconnection: true })
    app.socket = socket

    socket.on("connect_error", error => {
        const message = String(error?.message ?? "")
        if (message === "denied") {
            socket.close()
            forgetKey()
            showApp(false)
            return loginError("That's not the admin key.")
        }
        if (message.startsWith("locked:")) {
            socket.close()
            showApp(false)
            return loginError(`Too many wrong keys from this address. Try again in ${Math.ceil(Number(message.split(":")[1]) / 60)} minute(s).`)
        }
        // couldn't reach it at all: say so rather than retrying behind the login box
        if (!everConnected) {
            socket.close()
            return loginError("Can't reach the server. If it's just waking up, try again in a minute.")
        }
        setConnection(false)
    })
    socket.on("disconnect", () => setConnection(false))

    socket.on("hello", async data => {
        everConnected = true
        app.snapshot = data.snapshot
        app.audit = data.audit
        app.log = data.log
        if (!app.catalog) {
            try { app.catalog = await app.cmd("catalog") } catch (error) { return loginError(`Connected, but couldn't load the catalog: ${error.message}`) }
            buildViews()
        }
        rememberKey(key, remember)
        showApp(true)
        setConnection(true)
        app.emit("hello", data)
        updateBadges()
        app.views.forEach(view => view.onSnapshot?.(app.snapshot))
    })

    socket.on("snapshot", snapshot => {
        app.snapshot = snapshot
        $("topUptime").textContent = `server up ${fmtDuration(snapshot.server.uptimeSec)}`
        updateBadges()
        app.emit("snapshot", snapshot)
        app.views.forEach(view => view.onSnapshot?.(snapshot))
    })
    socket.on("audit", entry => {
        app.audit.push(entry)
        if (app.audit.length > 500) app.audit.shift()
        app.emit("audit", entry)
    })
    socket.on("log", lines => {
        app.log.push(...lines)
        if (app.log.length > 400) app.log.splice(0, app.log.length - 400)
        app.emit("log", lines)
    })
}

// ── the key ──────────────────────────────────────────────────────────────────
// kept for this tab, or for the device when asked - nothing else is stored
function rememberKey(key, remember) {
    try {
        sessionStorage.setItem(KEY_STORAGE, key)
        if (remember) localStorage.setItem(KEY_STORAGE, key)
        else localStorage.removeItem(KEY_STORAGE)
    } catch { /* storage can be off */ }
}
function forgetKey() {
    try { sessionStorage.removeItem(KEY_STORAGE); localStorage.removeItem(KEY_STORAGE) } catch { /* storage can be off */ }
}
function savedKey() {
    try { return sessionStorage.getItem(KEY_STORAGE) ?? localStorage.getItem(KEY_STORAGE) } catch { return null }
}

$("loginForm").addEventListener("submit", event => {
    event.preventDefault()
    const key = $("keyInput").value
    if (!key) return loginError("Enter the admin key.")
    connect(key, $("rememberInput").checked)
})

$("logoutBtn").addEventListener("click", () => {
    app.socket?.close()
    forgetKey()
    location.hash = ""
    location.reload()
})

const stored = savedKey()
if (stored) {
    $("rememberInput").checked = !!localStorage.getItem(KEY_STORAGE)
    connect(stored, $("rememberInput").checked)
}
