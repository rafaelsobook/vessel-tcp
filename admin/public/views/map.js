import { el, field, select, button, confirmDialog, toast, fmtPos } from "../ui.js"

// A top-down map of one place with everything in it. Drag to pan, scroll to
// zoom. Click an empty spot to pick it - then "Spawn here", "Add things here"
// or any form's "Use map pick" start from that spot. Click a player to move them
// to the picked spot; click an enemy or chest to remove it.

const LAYERS = [
    { id: "players", label: "Players", color: "#edd59f" },
    { id: "enemies", label: "Enemies", color: "#e5645c" },
    { id: "treasures", label: "Chests", color: "#e0a43a" },
    { id: "grains", label: "Grains", color: "#8fbf5a" },
    { id: "mushrooms", label: "Mushrooms", color: "#b07fd6" },
    { id: "structures", label: "Crafted", color: "#e08a4a" },
]
const REFRESH_MS = 2000
const HIT_RADIUS_PX = 9
// how much closer a bigger, drawn-on-top marker counts as (see hitTest)
const DRAWN_ON_TOP_PX = { players: 5, treasures: 3 }

export function create(app) {
    const root = el("div", { class: "view" })

    const placeSel = select(app.catalog.places.map(place => ({ value: place.placeId, label: place.name })), { value: 888, onchange: () => { resetView(); refresh() } })
    const canvas = el("canvas")
    const tip = el("div", { class: "map-tip", hidden: true })
    const frame = el("div", { class: "map-frame" }, canvas, tip)

    const layerOn = Object.fromEntries(LAYERS.map(layer => [layer.id, true]))
    const legend = el("div", { class: "legend" }, LAYERS.map(layer => {
        const box = el("input", { type: "checkbox", checked: true, onchange: () => { layerOn[layer.id] = box.checked; draw() } })
        return el("label", { class: "check" }, box, el("span", { class: "swatch", style: `background:${layer.color}` }), layer.label)
    }))

    const pickBox = el("div", { class: "stack" })
    const selectBox = el("div", { class: "stack" })
    const summary = el("span", { class: "muted" })

    root.append(
        el("div", { class: "panel" }, el("div", { class: "panel-head" },
            el("h2", { text: "Map" }), field("", placeSel, { cls: "wide" }), summary, el("span", { class: "grow" }),
            button("Re-centre", () => { resetView(); draw() }, { small: true }), button("Refresh", () => refresh(), { small: true })),
            legend),
        el("div", { class: "map-layout" }, frame, el("div", { class: "map-side" },
            el("div", { class: "panel" }, el("h3", { text: "Picked spot" }), pickBox),
            el("div", { class: "panel" }, el("h3", { text: "Selected" }), selectBox))))

    // ── view: world <-> screen ───────────────────────────────────────────────
    let data = null
    let scale = 1           // pixels per world unit
    let centre = { x: 0, z: 0 }
    let selected = null     // { kind, item }
    let hover = null

    const place = () => app.placeById(placeSel.value)

    function resetView() {
        const view = place().view
        centre = { x: view.cx, z: view.cz }
        const size = Math.min(canvas.clientWidth || 800, canvas.clientHeight || 600)
        scale = size / view.span
        selected = null
        renderSelected()
    }

    // north (+z) is up the screen
    const toScreen = (x, z) => ({ x: canvas.width / 2 + (x - centre.x) * scale * dpr, y: canvas.height / 2 - (z - centre.z) * scale * dpr })
    const toWorld = (sx, sy) => ({ x: centre.x + (sx * dpr - canvas.width / 2) / (scale * dpr), z: centre.z - (sy * dpr - canvas.height / 2) / (scale * dpr) })
    let dpr = 1

    function fitCanvas() {
        dpr = window.devicePixelRatio || 1
        const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr)
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    }

    // ── drawing ──────────────────────────────────────────────────────────────
    function gridStep() {
        // about 70px between lines, on a 1-2-5 ladder
        const target = 70 / scale
        const pow = 10 ** Math.floor(Math.log10(target))
        return [1, 2, 5, 10].map(m => m * pow).find(step => step >= target) ?? pow * 10
    }

    function draw() {
        if (root.hidden) return
        fitCanvas()
        // a zero or broken scale would make the grid loops below run forever
        if (!(scale > 0) || !Number.isFinite(scale)) return
        const ctx = canvas.getContext("2d")
        ctx.fillStyle = "#0c0e12"
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        const current = place()
        // a dungeon: the cells that can be stood on, so it's clear where rooms and corridors are
        if (current?.floor) {
            const { cellSize, rows } = current.floor
            const side = cellSize * scale * dpr
            ctx.fillStyle = "#171b24"
            rows.forEach((row, cy) => {
                const top = Math.floor(toScreen(0, (cy + 1) * cellSize).y)
                for (let cx = 0; cx < row.length; cx++) {
                    if (row[cx] !== "#") continue
                    ctx.fillRect(Math.floor(toScreen(cx * cellSize, 0).x), top, Math.ceil(side) + 1, Math.ceil(side) + 1)
                }
            })
        }

        // grid
        const step = gridStep()
        const topLeft = toWorld(0, 0), bottomRight = toWorld(canvas.clientWidth, canvas.clientHeight)
        ctx.lineWidth = 1
        ctx.font = `${11 * dpr}px system-ui, sans-serif`
        ctx.fillStyle = "#4a5060"
        for (let gx = Math.floor(topLeft.x / step) * step; gx <= bottomRight.x; gx += step) {
            const sx = Math.round(toScreen(gx, 0).x) + 0.5
            ctx.strokeStyle = gx === 0 ? "#3a4050" : "#1b1f28"
            ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, canvas.height); ctx.stroke()
            ctx.fillText(String(Math.round(gx * 100) / 100), sx + 3 * dpr, canvas.height - 5 * dpr)
        }
        for (let gz = Math.floor(bottomRight.z / step) * step; gz <= topLeft.z; gz += step) {
            const sy = Math.round(toScreen(0, gz).y) + 0.5
            ctx.strokeStyle = gz === 0 ? "#3a4050" : "#1b1f28"
            ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(canvas.width, sy); ctx.stroke()
            ctx.fillText(String(Math.round(gz * 100) / 100), 4 * dpr, sy - 3 * dpr)
        }

        // the place's own outline, where it has no floor plan to show
        if (current && !current.floor && current.areaType !== "openworld") {
            const half = current.view.span / 2 - 3
            const a = toScreen(current.view.cx - half, current.view.cz + half), b = toScreen(current.view.cx + half, current.view.cz - half)
            ctx.strokeStyle = "#323847"; ctx.setLineDash([6 * dpr, 6 * dpr]); ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([])
        }
        if (current?.spawn) {
            const s = toScreen(current.spawn.x, current.spawn.z)
            ctx.strokeStyle = "#4cc38a"; ctx.lineWidth = 2 * dpr
            ctx.beginPath(); ctx.arc(s.x, s.y, 7 * dpr, 0, Math.PI * 2); ctx.stroke()
            ctx.fillStyle = "#4cc38a"; ctx.fillText("spawn", s.x + 10 * dpr, s.y + 4 * dpr); ctx.lineWidth = 1
        }

        if (!data) return
        const dot = (item, color, radius) => {
            const p = toScreen(item.x, item.z)
            if (p.x < -20 || p.y < -20 || p.x > canvas.width + 20 || p.y > canvas.height + 20) return
            ctx.fillStyle = color
            ctx.beginPath(); ctx.arc(p.x, p.y, radius * dpr, 0, Math.PI * 2); ctx.fill()
        }
        if (layerOn.grains) data.grains.forEach(item => dot(item, "#8fbf5a", 2))
        if (layerOn.mushrooms) data.mushrooms.forEach(item => dot(item, "#b07fd6", 2.6))
        if (layerOn.structures) data.structures.forEach(item => dot(item, "#e08a4a", 4))
        if (layerOn.treasures) data.treasures.forEach(item => {
            const p = toScreen(item.x, item.z)
            ctx.fillStyle = "#e0a43a"; ctx.fillRect(p.x - 4 * dpr, p.y - 4 * dpr, 8 * dpr, 8 * dpr)
        })
        if (layerOn.enemies) data.enemies.forEach(item => {
            dot(item, item.target ? "#ff8a80" : "#e5645c", item.target ? 4 : 3)
            if (item.admin) {
                const p = toScreen(item.x, item.z)
                ctx.strokeStyle = "#edd59f"; ctx.beginPath(); ctx.arc(p.x, p.y, 6 * dpr, 0, Math.PI * 2); ctx.stroke()
            }
        })
        if (layerOn.players) data.players.forEach(item => {
            const p = toScreen(item.x, item.z)
            ctx.fillStyle = item.bot ? "#8a8f9c" : "#edd59f"
            ctx.beginPath(); ctx.arc(p.x, p.y, 6 * dpr, 0, Math.PI * 2); ctx.fill()
            ctx.strokeStyle = "#12141a"; ctx.lineWidth = 2 * dpr; ctx.stroke(); ctx.lineWidth = 1
            ctx.fillStyle = "#e6e4dc"; ctx.fillText(item.name, p.x + 9 * dpr, p.y + 4 * dpr)
        })

        // the picked spot and the selection
        if (app.pick && app.pick.placeId === Number(placeSel.value)) {
            const p = toScreen(app.pick.x, app.pick.z)
            ctx.strokeStyle = "#5b9bd5"; ctx.lineWidth = 2 * dpr
            ctx.beginPath(); ctx.moveTo(p.x - 9 * dpr, p.y); ctx.lineTo(p.x + 9 * dpr, p.y); ctx.moveTo(p.x, p.y - 9 * dpr); ctx.lineTo(p.x, p.y + 9 * dpr); ctx.stroke(); ctx.lineWidth = 1
        }
        if (selected) {
            const p = toScreen(selected.item.x, selected.item.z)
            ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2 * dpr
            ctx.beginPath(); ctx.arc(p.x, p.y, 10 * dpr, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1
        }
    }

    // ── what's under the cursor ──────────────────────────────────────────────
    function hitTest(clientX, clientY) {
        if (!data) return null
        const rect = canvas.getBoundingClientRect()
        const mx = clientX - rect.left, my = clientY - rect.top
        let best = null, bestScore = Infinity
        // Nearest wins, but a marker that is drawn bigger and on top (a player's
        // disc covers the dots under it) counts as that much closer - so clicking
        // a player standing among enemies selects the player, while clicking
        // right on an enemy next to them still selects the enemy.
        const consider = (kind, items) => items.forEach(item => {
            const p = toScreen(item.x, item.z)
            const dist = Math.hypot(p.x / dpr - mx, p.y / dpr - my)
            if (dist >= HIT_RADIUS_PX) return
            const score = dist - (DRAWN_ON_TOP_PX[kind] ?? 0)
            if (score < bestScore) { best = { kind, item }; bestScore = score }
        })
        if (layerOn.enemies) consider("enemies", data.enemies)
        if (layerOn.treasures) consider("treasures", data.treasures)
        if (layerOn.mushrooms) consider("mushrooms", data.mushrooms)
        if (layerOn.grains) consider("grains", data.grains)
        if (layerOn.players) consider("players", data.players)
        return best
    }

    function describe(hit) {
        const { kind, item } = hit
        if (kind === "players") return `${item.name}${item.bot ? " (bot)" : ""} - lv ${item.lvl ?? "?"}`
        if (kind === "enemies") return `${item.dn ?? item.name} - ${item.hp}/${item.maxHp} hp${item.target ? " - in a fight" : ""}`
        if (kind === "treasures") return `Chest: ${item.label}`
        if (kind === "mushrooms") return `${item.kind} mushroom`
        return "Grain"
    }

    // ── mouse ────────────────────────────────────────────────────────────────
    let drag = null
    canvas.addEventListener("mousedown", event => { drag = { x: event.clientX, y: event.clientY, moved: false, centre: { ...centre } } })
    window.addEventListener("mouseup", event => {
        if (!drag) return
        const wasClick = !drag.moved
        drag = null
        if (wasClick && event.target === canvas) onClick(event)
    })
    window.addEventListener("mousemove", event => {
        if (drag) {
            const dx = event.clientX - drag.x, dy = event.clientY - drag.y
            if (Math.hypot(dx, dy) > 4) drag.moved = true
            if (drag.moved) { centre = { x: drag.centre.x - dx / scale, z: drag.centre.z + dy / scale }; draw() }
            return
        }
        if (event.target !== canvas) return (tip.hidden = true)
        hover = hitTest(event.clientX, event.clientY)
        const rect = frame.getBoundingClientRect()
        const w = toWorld(event.clientX - canvas.getBoundingClientRect().left, event.clientY - canvas.getBoundingClientRect().top)
        tip.hidden = false
        tip.textContent = hover ? describe(hover) : `${Math.round(w.x * 10) / 10}, ${Math.round(w.z * 10) / 10}`
        tip.style.left = `${Math.min(event.clientX - rect.left + 14, rect.width - tip.offsetWidth - 6)}px`
        tip.style.top = `${event.clientY - rect.top + 14}px`
    })
    canvas.addEventListener("mouseleave", () => { tip.hidden = true })
    canvas.addEventListener("wheel", event => {
        event.preventDefault()
        const rect = canvas.getBoundingClientRect()
        const before = toWorld(event.clientX - rect.left, event.clientY - rect.top)
        scale = Math.min(200, Math.max(0.02, scale * (event.deltaY < 0 ? 1.18 : 1 / 1.18)))
        // the point under the cursor stays under it
        const after = toWorld(event.clientX - rect.left, event.clientY - rect.top)
        centre = { x: centre.x + before.x - after.x, z: centre.z + before.z - after.z }
        draw()
    }, { passive: false })

    function onClick(event) {
        const hit = hitTest(event.clientX, event.clientY)
        if (hit) {
            selected = hit
        } else {
            const rect = canvas.getBoundingClientRect()
            const w = toWorld(event.clientX - rect.left, event.clientY - rect.top)
            app.pick = { placeId: Number(placeSel.value), x: Math.round(w.x * 10) / 10, z: Math.round(w.z * 10) / 10 }
            selected = null
        }
        renderPick()
        renderSelected()
        draw()
    }

    // ── side panels ──────────────────────────────────────────────────────────
    function renderPick() {
        pickBox.replaceChildren()
        if (!app.pick) return pickBox.append(el("div", { class: "muted", text: "Click an empty spot on the map." }))
        pickBox.append(
            el("div", {}, el("strong", { text: app.placeName(app.pick.placeId) }), ` (${app.pick.x}, ${app.pick.z})`),
            el("div", { class: "row" },
                button("Spawn enemy here", () => app.goto("enemies"), { small: true }),
                button("Add chest/grain here", () => app.goto("items"), { small: true })),
            el("div", { class: "hint", text: "Any form's \"Use map pick\" button fills in this spot." }))
    }

    function renderSelected() {
        selectBox.replaceChildren()
        if (!selected) return selectBox.append(el("div", { class: "muted", text: "Click a player, enemy or chest." }))
        const { kind, item } = selected
        selectBox.append(el("div", {}, el("strong", { text: describe(selected) })), el("div", { class: "mono muted", text: fmtPos(item) }))
        const actions = el("div", { class: "row" })
        if (kind === "players" && !item.bot) {
            actions.append(button("Move here to the picked spot", async () => {
                if (!app.pick) return toast("Pick a spot first by clicking an empty place on the map", "fail")
                if (app.pick.placeId !== Number(placeSel.value)) return toast("The picked spot is in another place", "fail")
                await app.run("players.teleport", { owner: item.id, placeId: app.pick.placeId, x: app.pick.x, z: app.pick.z }, r => `${r.player} sent to ${r.to}`)
            }, { small: true }), button("Lift 4", () => app.run("players.teleport", { owner: item.id, lift: 4 }, "Lifted"), { small: true }))
        }
        if (kind === "enemies") actions.append(button("Remove", async () => { if (await app.run("enemies.remove", { ids: [item.id] }, "Removed")) { selected = null; refresh() } }, { small: true, kind: "danger" }))
        if (kind === "treasures" || kind === "grains" || kind === "mushrooms") {
            actions.append(button("Remove", async () => { if (await app.run("pickups.remove", { kind, ids: [item.id] }, "Removed")) { selected = null; refresh() } }, { small: true, kind: "danger" }))
        }
        selectBox.append(actions)
    }

    // ── data ─────────────────────────────────────────────────────────────────
    let loading = false
    async function refresh() {
        if (loading) return
        loading = true
        try {
            data = await app.cmd("map.get", { placeId: placeSel.value })
            // keep the selection pointing at the fresh copy of the same thing
            if (selected) {
                const fresh = data[selected.kind]?.find(item => item.id === selected.item.id)
                selected = fresh ? { kind: selected.kind, item: fresh } : null
                renderSelected()
            }
            summary.textContent = `${data.players.length} players, ${data.enemies.length} enemies, ${data.treasures.length} chests, ${data.grains.length} grains, ${data.mushrooms.length} mushrooms`
            draw()
        } catch (error) { summary.textContent = error.message } finally { loading = false }
    }

    let timer = null
    new ResizeObserver(() => draw()).observe(frame)
    renderPick()
    renderSelected()

    return {
        id: "map", title: "Map", root,
        onShow() {
            // the canvas has no size until it's visible
            requestAnimationFrame(() => { if (!data) resetView(); refresh() })
            clearInterval(timer)
            timer = setInterval(refresh, REFRESH_MS)
        },
        onHide() { clearInterval(timer) },
    }
}
