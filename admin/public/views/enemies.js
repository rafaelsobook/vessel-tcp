import { el, clear, field, select, button, chip, emptyRow, confirmDialog, toast, fmtNum, fmtPos } from "../ui.js"
import { createWhereForm } from "../where.js"

// Spawning enemies anywhere, and the list of every enemy in the world with the
// tools to remove them.

export function create(app) {
    const root = el("div", { class: "view" })

    // ── spawn ────────────────────────────────────────────────────────────────
    const typeSel = select(app.catalog.enemies.map(kind => ({
        value: kind.name,
        label: `${kind.dn} - lv ${kind.lvl}, ${fmtNum(kind.maxHp)} hp`,
        group: kind.group,
    })))
    const count = el("input", { type: "number", min: 1, max: 100, value: 1 })
    const where = createWhereForm(app, { radiusLabel: "Spread (radius)", radiusDefault: 0 })
    const respawn = el("input", { type: "checkbox" })
    const keep = el("input", { type: "checkbox" })

    root.append(el("div", { class: "panel" },
        el("div", { class: "panel-head" }, el("h2", { text: "Spawn enemies" })),
        el("div", { class: "stack" },
            el("div", { class: "row" }, field("Enemy", typeSel, { cls: "wide" }), field("How many", count, { cls: "narrow", hint: "100 at most" })),
            where.node,
            el("div", { class: "checks" },
                el("label", { class: "check" }, respawn, "Respawns after it's killed"),
                el("label", { class: "check" }, keep, "Keep across server restarts")),
            el("div", { class: "hint", text: "Several in one spot are scattered inside the spread radius; with a spread of 0 a single enemy stands exactly there. In a dungeon they're moved onto the floor. Enemies that aren't set to respawn are gone for good once killed." }),
            el("div", {}, button("Spawn", spawn, { kind: "primary" })))))

    async function spawn() {
        let target
        try { target = where.get() } catch (error) { return toast(error.message, "fail") }
        const result = await app.run("enemies.spawn", { name: typeSel.value, count: count.value, ...target, respawn: respawn.checked, keep: keep.checked }, r => `${r.spawned} spawned`)
        if (result) refresh()
    }

    // ── the list ─────────────────────────────────────────────────────────────
    const placeFilter = select([{ value: "", label: "All places" }, ...app.catalog.places.map(place => ({ value: place.placeId, label: place.name }))], { onchange: () => { selected.clear(); refresh() } })
    const typeFilter = select([{ value: "", label: "All types" }, ...app.catalog.enemies.map(kind => ({ value: kind.name, label: kind.dn }))], { onchange: () => { selected.clear(); refresh() } })
    const auto = el("input", { type: "checkbox", checked: true })
    const selectAll = el("input", { type: "checkbox", onchange: () => toggleAll(selectAll.checked) })
    const body = el("tbody")
    const summary = el("span", { class: "muted" })
    const removeSelected = button("Remove selected", removeChosen, { kind: "danger", small: true })
    const clearMatching = button("Remove all matching...", clearAll, { kind: "danger", small: true })

    root.append(el("div", { class: "panel" },
        el("div", { class: "panel-head" }, el("h2", { text: "Enemies in the world" }), summary, el("span", { class: "grow" }),
            el("label", { class: "check" }, auto, "Refresh by itself"), button("Refresh", refresh, { small: true })),
        el("div", { class: "row", style: "margin-bottom:12px" },
            field("Place", placeFilter), field("Type", typeFilter),
            el("div", { class: "f" }, el("label", { text: " " }), el("div", { class: "row" }, removeSelected, clearMatching))),
        el("div", { class: "table-wrap" }, el("table", { onclick: onTableClick },
            el("thead", {}, el("tr", {}, el("th", {}, selectAll), ["Enemy", "Place", "Position (x, z)", "Health", "Target", "", ""].map(text => el("th", { text })))),
            body))))

    const selected = new Set()
    let rows = []
    let loading = false

    async function refresh() {
        if (loading) return
        loading = true
        try {
            const result = await app.cmd("enemies.list", { placeId: placeFilter.value, name: typeFilter.value })
            rows = result.rows
            summary.textContent = result.total > rows.length ? `showing ${fmtNum(rows.length)} of ${fmtNum(result.total)}` : `${fmtNum(result.total)}`
            // a selection never keeps enemies that are gone
            const here = new Set(rows.map(row => row.id))
            ;[...selected].forEach(id => { if (!here.has(id)) selected.delete(id) })
            render()
        } catch (error) {
            summary.textContent = error.message
        } finally {
            loading = false
        }
    }

    function render() {
        clear(body)
        if (!rows.length) body.append(emptyRow(8, "No enemies match"))
        rows.forEach(row => {
            const tick = el("input", { type: "checkbox", checked: selected.has(row.id), dataset: { id: row.id } })
            body.append(el("tr", {},
                el("td", {}, tick),
                el("td", {}, row.dn ?? row.name, " ", row.admin ? chip("admin", "gold") : null, row.keep ? chip("kept", "good") : null),
                el("td", { text: app.placeName(row.placeId) }),
                el("td", { class: "mono", text: fmtPos(row) }),
                el("td", { text: `${fmtNum(row.hp)} / ${fmtNum(row.maxHp)}` }),
                el("td", {}, row.target ? chip("in a fight", "bad") : null),
                el("td", {}),
                el("td", { class: "actions" }, el("button", { class: "btn small danger", type: "button", dataset: { remove: row.id } }, "Remove"))))
        })
        selectAll.checked = rows.length > 0 && rows.every(row => selected.has(row.id))
        removeSelected.textContent = selected.size ? `Remove selected (${selected.size})` : "Remove selected"
        removeSelected.disabled = !selected.size
        clearMatching.disabled = placeFilter.value === ""
        clearMatching.title = placeFilter.value === "" ? "Choose a place first" : ""
    }

    function toggleAll(on) {
        rows.forEach(row => { if (on) selected.add(row.id); else selected.delete(row.id) })
        render()
    }

    function onTableClick(event) {
        const tick = event.target.closest("input[data-id]")
        if (tick) {
            if (tick.checked) selected.add(tick.dataset.id); else selected.delete(tick.dataset.id)
            return render()
        }
        const btn = event.target.closest("button[data-remove]")
        if (btn) app.run("enemies.remove", { ids: [btn.dataset.remove] }, "Removed").then(refresh)
    }

    async function removeChosen() {
        if (!selected.size) return
        if (!await confirmDialog(`Remove ${selected.size} enemies from the world?`, "Remove")) return
        const result = await app.run("enemies.remove", { ids: [...selected] }, r => `${r.removed} removed`)
        if (result) { selected.clear(); refresh() }
    }

    async function clearAll() {
        if (placeFilter.value === "") return
        const what = typeFilter.value ? app.catalog.enemies.find(kind => kind.name === typeFilter.value)?.dn : "enemy"
        if (!await confirmDialog(`Remove every ${what} in ${app.placeName(placeFilter.value)}? Base enemies come back only when the server restarts (or the area tops itself up).`, "Remove them all")) return
        const result = await app.run("enemies.clear", { placeId: placeFilter.value, name: typeFilter.value }, r => `${r.removed} removed`)
        if (result) { selected.clear(); refresh() }
    }

    let timer = null
    return {
        id: "enemies", title: "Enemies", root,
        onSnapshot(snapshot) { where.syncPlayers(snapshot) },
        onShow() {
            refresh()
            clearInterval(timer)
            timer = setInterval(() => { if (auto.checked) refresh() }, 4000)
        },
        onHide() { clearInterval(timer) },
        onGoto() { where.usePick() },
    }
}
