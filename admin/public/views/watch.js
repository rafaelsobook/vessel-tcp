import { el, clear, chip, button, field, openModal, confirmDialog, toast, fmtDuration, fmtTime, fmtNum } from "../ui.js"

// WATCH - what one player is doing, live: where they are and the trail they've
// walked (a jump too fast for the game is drawn red), who and what is around
// them, their running numbers, the anti-cheat flags they've raised, and a feed
// of everything they do - hits, kills and what each paid, casts, chat, pickups.
// The list on the left is everyone seen in the last half hour, the most
// suspicious first (tcp's admin/watch.ts keeps all of it).

const POLL_MS = 1000
const LIST_MS = 3000
const FEED_MAX = 500
const MAP_RADIUS = 40          // world units from the player to the canvas edge
const FILTERS = [
    { id: "all", label: "Everything", kinds: null },
    { id: "combat", label: "Combat", kinds: ["hit", "kill-hit", "pvp", "cast"] },
    { id: "money", label: "Payouts", kinds: ["payout"] },
    { id: "chat", label: "Chat", kinds: ["chat"] },
    { id: "flags", label: "Flags", kinds: ["flag", "session", "admin"] },
    { id: "moves", label: "Places", kinds: ["join", "place", "leave", "pickup"] },
]
const SESSION_CHIP = {
    valid: ["login checked", "good"],
    pending: ["checking login", ""],
    missing: ["no login token", "warn"],
    invalid: ["bad login", "bad"],
}
const SEVERITY_KIND = { bad: "bad", warn: "warn", info: "" }
const cad = cents => `CA$${(Number(cents || 0) / 100).toFixed(2)}`

export function create(app) {
    const root = el("div", { class: "view" })

    // ── the list ─────────────────────────────────────────────────────────────
    const listBox = el("div", { class: "watch-list" })
    const listHint = el("div", { class: "hint", text: "Everyone seen in the last 30 minutes, the most suspicious first." })

    // ── the player ───────────────────────────────────────────────────────────
    const title = el("h2", { text: "Pick a player" })
    const chips = el("span")
    const actions = el("div", { class: "row" })
    const facts = el("div", { class: "muted watch-facts" })
    const tiles = el("div", { class: "grid cols-4" })
    const canvas = el("canvas")
    const mapNote = el("div", { class: "hint" })
    const flagsBody = el("tbody")
    const feed = el("div", { class: "log watch-feed" })
    const filterBox = el("div", { class: "tabs-inner" })
    const pauseBox = el("input", { type: "checkbox" })

    let filter = "all"
    FILTERS.forEach(f => filterBox.append(el("button", { class: `pill ${f.id === filter ? "active" : ""}`, type: "button", dataset: { id: f.id }, onclick: () => {
        filter = f.id
        filterBox.querySelectorAll(".pill").forEach(p => p.classList.toggle("active", p.dataset.id === filter))
        renderFeed()
    } }, f.label)))

    const detail = el("div", { class: "stack", hidden: true },
        el("div", { class: "panel" },
            el("div", { class: "panel-head" }, title, chips, el("span", { class: "grow" }), actions),
            facts),
        tiles,
        el("div", { class: "watch-layout" },
            el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h3", { text: "Around them" }), el("span", { class: "grow" }), mapNote),
                el("div", { class: "map-frame watch-map" }, canvas),
                el("div", { class: "legend", style: "margin-top:8px" },
                    legendDot("#edd59f", "them"), legendDot("#5b9bd5", "trail"), legendDot("#e5645c", "jump / enemy"), legendDot("#ff9d96", "enemy on them"), legendDot("#4cc38a", "other players"))),
            el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h3", { text: "Flags" })),
                el("div", { class: "table-wrap", style: "max-height:300px" }, el("table", {},
                    el("thead", {}, el("tr", {}, ["", "What", "Times", "Last", "Detail"].map(text => el("th", { text })))), flagsBody)),
                el("div", { class: "hint", text: "Flags are pointers, not proof: a laggy player can trip \"reach\" or \"speed\" now and then. A hit sent as another account, a bad login token, or a kill rate far past the rest are the strong signs." }))),
        el("div", { class: "panel" },
            el("div", { class: "panel-head" }, el("h3", { text: "Activity" }), filterBox, el("span", { class: "grow" }), el("label", { class: "check" }, pauseBox, "Pause")),
            feed))

    const empty = el("div", { class: "panel empty", text: "Pick someone from the list to watch them." })

    root.append(el("div", { class: "watch-shell" },
        el("div", { class: "panel watch-side" }, el("div", { class: "panel-head" }, el("h2", { text: "Players" })), listHint, listBox),
        el("div", { class: "stack" }, empty, detail)))

    function legendDot(color, label) {
        return el("span", { class: "check" }, el("span", { class: "swatch", style: `background:${color}` }), label)
    }

    // ── state ────────────────────────────────────────────────────────────────
    let owner = null
    let data = null
    let events = []
    let lastId = 0
    let pollTimer = null
    let listTimer = null
    let listed = []

    async function refreshList() {
        try {
            listed = (await app.cmd("watch.list")).players
        } catch { return }
        clear(listBox)
        if (!listed.length) return listBox.append(el("div", { class: "empty", text: "Nobody has played since the server started." }))
        listed.forEach(p => {
            const card = el("button", { class: `watch-card ${p.owner === owner ? "active" : ""} ${p.worst ?? ""}`, type: "button", onclick: () => select(p.owner) },
                el("div", {}, el("b", { text: p.name || p.owner }), " ", p.online ? null : chip("left", "")),
                el("div", { class: "muted small" }, app.placeName(p.placeId), " - ", `${p.kills ?? 0} kills, ${cad(p.earnedCents)}`),
                el("div", {},
                    sessionChip(p.session),
                    p.isGuest ? chip("guest") : null,
                    p.flags ? chip(`${p.flags} flag${p.flags > 1 ? "s" : ""}`, SEVERITY_KIND[p.worst] ?? "warn") : null,
                    p.killsLastMin >= 10 ? chip(`${p.killsLastMin} kills/min`, "warn") : null))
            listBox.append(card)
        })
    }
    function sessionChip(session) {
        const [label, kind] = SESSION_CHIP[session] ?? [session ?? "?", ""]
        return chip(label, kind)
    }

    function select(nextOwner) {
        if (owner === nextOwner) return
        owner = nextOwner
        data = null
        events = []
        lastId = 0
        clear(feed)
        empty.hidden = true
        detail.hidden = false
        listBox.querySelectorAll(".watch-card").forEach(card => card.classList.remove("active"))
        refreshList()
        poll()
    }

    async function poll() {
        if (!owner || root.hidden) return
        if (pauseBox.checked && data) return
        const asked = owner
        let result
        try {
            result = await app.cmd("watch.get", { owner, since: lastId })
        } catch (error) {
            mapNote.textContent = error.message
            return
        }
        if (asked !== owner) return
        data = result
        if (result.events.length) {
            events.push(...result.events)
            if (events.length > FEED_MAX) events.splice(0, events.length - FEED_MAX)
            lastId = result.lastEventId
            renderFeed()
        }
        renderHeader()
        renderTiles()
        renderFlags()
        draw()
    }

    // ── drawing it ───────────────────────────────────────────────────────────
    function renderHeader() {
        const d = data, live = d.live, purse = d.purse
        title.textContent = d.name || d.owner
        // .append() writes a null as the text "null" - only what is there
        clear(chips).append(...[
            d.online ? chip("online", "good") : chip("left the game"),
            sessionChip(d.session),
            d.isGuest ? chip("guest account") : null,
            purse?.frozen ? chip("earnings frozen", "warn") : null,
            purse?.banned ? chip("banned", "bad") : null].filter(Boolean))
        const parts = []
        if (live) {
            parts.push(`${live.place} (${Math.round(live.pos?.x ?? 0)}, ${Math.round(live.pos?.z ?? 0)})`)
            if (live.lvl != null) parts.push(`level ${live.lvl}`)
            if (live.vessel) parts.push(live.vessel)
            if (live.hp != null) parts.push(`hp ${Math.round(live.hp)}/${live.maxHp}`)
            if (live.mode) parts.push(live.mode)
        }
        parts.push(`playing ${fmtDuration((Date.now() - d.joinedAt) / 1000)}`)
        facts.textContent = parts.join("  -  ")

        const isAccount = /^[a-f0-9]{24}$/i.test(d.owner)
        clear(actions).append(...[
            live ? button("Message", () => openMessage(), { small: true }) : null,
            live ? button("Show on map", () => { app.pick = { placeId: live.placeId, x: live.pos?.x ?? 0, z: live.pos?.z ?? 0 }; app.goto("map", { placeId: live.placeId }) }, { small: true }) : null,
            d.flags.length ? button("Clear flags", async () => { if (await confirmDialog(`Clear ${d.name}'s flags? Do it once you've looked into them.`, "Clear", false)) app.run("watch.clearFlags", { owner: d.owner }, "Flags cleared") }, { small: true }) : null,
            isAccount ? button(purse?.frozen ? "Unfreeze earnings" : "Freeze earnings", () => openFreeze(!purse?.frozen), { small: true }) : null,
            live ? button("Kick", () => openKick(), { small: true, kind: "danger" }) : null,
            isAccount ? button("Ban...", () => openBan(), { small: true, kind: "danger" }) : null].filter(Boolean))
    }

    function tile(label, value, sub = "", kind = "") {
        return el("div", { class: `stat ${kind}` }, el("div", { class: "label", text: label }), el("div", { class: "value", text: value }), el("div", { class: "sub", text: sub || " " }))
    }
    function renderTiles() {
        const s = data.stats, purse = data.purse
        clear(tiles).append(
            tile("Kills", fmtNum(s.kills), `${s.killsPerMin}/min average, ${s.killsLastMin} in the last minute`, s.killsLastMin >= 25 ? "warn" : ""),
            tile("Hits", fmtNum(s.hits), `${s.hitsLast2s} in the last 2s`),
            tile("Biggest hit", fmtNum(Math.round(s.dmgMax)), `average ${fmtNum(s.dmgAvg)}`),
            tile("Earned this session", cad(s.earnedCents), `${s.payouts} payouts, ${s.unpaid} kills unpaid`),
            tile("Earned today", purse ? cad(purse.dayCents) : "-", purse ? `balance ${cad(purse.balance)}` : "no wallet yet"),
            tile("PvP hits", fmtNum(s.pvpHits), ""),
            tile("Chat", fmtNum(s.chat), "messages this session"),
            tile("Watched for", `${s.minutes}m`, d0(data.leftAt) ? `left ${fmtTime(data.leftAt)}` : ""))
    }
    const d0 = value => value != null

    function renderFlags() {
        clear(flagsBody)
        if (!data.flags.length) return flagsBody.append(el("tr", {}, el("td", { colspan: 5, class: "empty", text: "Nothing suspicious seen" })))
        data.flags.forEach(flag => flagsBody.append(el("tr", {},
            el("td", {}, chip(flag.severity, SEVERITY_KIND[flag.severity])),
            el("td", { text: flag.kind }),
            el("td", { text: flag.count }),
            el("td", { class: "mono", text: fmtTime(flag.last) }),
            el("td", { text: flag.detail }))))
    }

    function renderFeed() {
        const kinds = FILTERS.find(f => f.id === filter)?.kinds
        const shown = events.filter(event => !kinds || kinds.includes(event.kind)).slice(-300).reverse()
        clear(feed)
        if (!shown.length) return feed.append(el("div", { class: "muted", text: "Nothing yet" }))
        shown.forEach(event => feed.append(el("div", { class: `feed-${event.kind} ${event.severity ?? ""}` },
            el("span", { class: "time", text: fmtTime(event.t) }), event.text)))
    }

    // follows the player: north (+z) up, MAP_RADIUS units to the nearer edge
    function draw() {
        const ctx = canvas.getContext("2d")
        const dpr = window.devicePixelRatio || 1
        const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr)
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
        ctx.clearRect(0, 0, w, h)
        const live = data?.live
        const centre = live?.pos ?? data?.trail?.at(-1)
        if (!centre) { mapNote.textContent = "No position yet"; return }
        mapNote.textContent = live ? `${live.place}, ${MAP_RADIUS * 2} units across` : "Last known position"
        const scale = Math.min(w, h) / 2 / MAP_RADIUS
        const sx = x => w / 2 + (x - centre.x) * scale
        const sy = z => h / 2 - (z - centre.z) * scale

        // a grid every 10 units
        ctx.strokeStyle = "#1c2029"
        ctx.lineWidth = 1
        for (let gx = Math.floor((centre.x - MAP_RADIUS * 2) / 10) * 10; gx <= centre.x + MAP_RADIUS * 2; gx += 10) { ctx.beginPath(); ctx.moveTo(sx(gx), 0); ctx.lineTo(sx(gx), h); ctx.stroke() }
        for (let gz = Math.floor((centre.z - MAP_RADIUS * 2) / 10) * 10; gz <= centre.z + MAP_RADIUS * 2; gz += 10) { ctx.beginPath(); ctx.moveTo(0, sy(gz)); ctx.lineTo(w, sy(gz)); ctx.stroke() }

        // the trail, older fainter; a jump in red
        const trail = data.trail ?? []
        for (let i = 1; i < trail.length; i++) {
            const a = trail[i - 1], b = trail[i]
            ctx.strokeStyle = b.jump ? "#e5645c" : `rgba(91,155,213,${0.15 + 0.75 * i / trail.length})`
            ctx.lineWidth = (b.jump ? 2.5 : 2) * dpr
            ctx.setLineDash(b.jump ? [6 * dpr, 4 * dpr] : [])
            ctx.beginPath(); ctx.moveTo(sx(a.x), sy(a.z)); ctx.lineTo(sx(b.x), sy(b.z)); ctx.stroke()
        }
        ctx.setLineDash([])

        const dot = (x, y, r, color, ring) => {
            ctx.beginPath(); ctx.arc(x, y, r * dpr, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
            if (ring) { ctx.lineWidth = 2 * dpr; ctx.strokeStyle = ring; ctx.stroke() }
        }
        ctx.font = `${11 * dpr}px system-ui, sans-serif`
        ;(data.nearby?.enemies ?? []).forEach(enemy => dot(sx(enemy.x), sy(enemy.z), enemy.targetingThem ? 5 : 3.5, enemy.targetingThem ? "#ff9d96" : "#e5645c"))
        ;(data.nearby?.players ?? []).forEach(other => {
            dot(sx(other.x), sy(other.z), 4.5, "#4cc38a")
            ctx.fillStyle = "#9fd8bb"; ctx.fillText(other.name, sx(other.x) + 7 * dpr, sy(other.z) - 5 * dpr)
        })
        dot(sx(centre.x), sy(centre.z), 7, "#edd59f", "#12141a")
        ctx.fillStyle = "#edd59f"; ctx.fillText(data.name, sx(centre.x) + 10 * dpr, sy(centre.z) - 8 * dpr)
    }

    // ── actions ──────────────────────────────────────────────────────────────
    function openMessage() {
        const text = el("textarea", { maxlength: 300, placeholder: "What to tell them..." })
        openModal({
            title: `Message ${data.name}`,
            body: el("div", { class: "stack" }, field("Message", text), el("div", { class: "hint", text: "Appears on their screen for a few seconds." })),
            actions: [{ label: "Cancel", onclick: close => close() }, { label: "Send", kind: "primary", onclick: async close => { if (await app.run("players.message", { owner: data.owner, text: text.value }, "Sent")) close() } }],
        })
    }
    function openKick() {
        const reason = el("input", { type: "text", maxlength: 200, placeholder: "Reason (they'll see it)" })
        openModal({
            title: `Disconnect ${data.name}`,
            body: el("div", { class: "stack" }, el("p", { style: "margin:0", text: "They're taken out of the game and can come back by reloading. To keep them out, ban them." }), field("Reason", reason)),
            actions: [{ label: "Cancel", onclick: close => close() }, { label: "Disconnect", kind: "danger", onclick: async close => { if (await app.run("players.kick", { owner: data.owner, reason: reason.value }, `${data.name} disconnected`)) close() } }],
        })
    }
    function openFreeze(freeze) {
        const reason = el("input", { type: "text", maxlength: 300, placeholder: "Why (they'll see it)" })
        openModal({
            title: `${freeze ? "Freeze" : "Unfreeze"} ${data.name}'s earnings`,
            body: el("div", { class: "stack" },
                el("p", { style: "margin:0", text: freeze ? "They keep playing, but kills pay nothing and they can't ask for a withdrawal until you unfreeze them. Their balance stays as it is." : "Kills pay again and withdrawals open up." }),
                freeze ? field("Reason", reason) : null),
            actions: [{ label: "Cancel", onclick: close => close() }, { label: freeze ? "Freeze" : "Unfreeze", kind: freeze ? "danger" : "primary", onclick: async close => {
                if (await app.run("accounts.freeze", { owner: data.owner, frozen: freeze, reason: reason.value }, r => `${r.username} ${r.frozen ? "frozen" : "unfrozen"}`)) { close(); poll() }
            } }],
        })
    }
    function openBan() {
        const reason = el("input", { type: "text", maxlength: 300, placeholder: "Reason (they'll see it)" })
        openModal({
            title: `Ban ${data.name}`,
            body: el("div", { class: "stack" },
                el("p", { style: "margin:0", text: "They're disconnected now and can't log in or join again. Their balance and any waiting withdrawal stay - reject the withdrawal on the Payouts tab if it was cheated. Unban from the Payouts tab." }),
                field("Reason", reason)),
            actions: [{ label: "Cancel", onclick: close => close() }, { label: "Ban", kind: "danger", onclick: async close => {
                if (!reason.value.trim()) return toast("Give a reason", "fail")
                if (await app.run("accounts.ban", { owner: data.owner, banned: true, reason: reason.value }, r => `${r.username} banned`)) { close(); poll() }
            } }],
        })
    }

    // ── start/stop with the tab ──────────────────────────────────────────────
    function onShow() {
        refreshList()
        clearInterval(pollTimer); clearInterval(listTimer)
        pollTimer = setInterval(poll, POLL_MS)
        listTimer = setInterval(refreshList, LIST_MS)
        poll()
    }
    function onHide() {
        clearInterval(pollTimer); clearInterval(listTimer)
    }

    return {
        id: "watch", title: "Watch", root, onShow, onHide,
        onGoto: detail => { if (detail?.owner) select(detail.owner) },
        badge: snapshot => {
            const flagged = (snapshot?.players ?? []).filter(p => p.watch?.worst === "bad" || p.watch?.worst === "warn").length
            return flagged ? `${flagged} flagged` : ""
        },
    }
}
