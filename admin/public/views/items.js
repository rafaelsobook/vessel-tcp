import { el, clear, field, select, button, chip, emptyRow, confirmDialog, toast, fmtNum, fmtPos } from "../ui.js"
import { createWhereForm } from "../where.js"

// Chests, grains, mushrooms and ore deposits: put them down anywhere, see what's there, take
// them away. One panel per kind, the same shape each.

const EXAMPLE_ITEM = JSON.stringify({
    name: "jerky", dn: "Jerky", itemCateg: "consumable", itemType: "food", qnty: 1,
    consumeAbilities: { plusHp: 50, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0, fillHunger: 30, fillTireness: 0, cure: [] },
    price: { coinType: "bronze", pieces: 5 }, desc: "Dried meat.", rarity: "normal",
}, null, 2)

export function create(app) {
    const root = el("div", { class: "view" })
    const tabs = el("div", { class: "tabs-inner" })
    root.append(tabs)

    const kinds = [
        { id: "treasures", label: "Chests", noun: "chest", form: chestForm },
        { id: "grains", label: "Grains", noun: "grain", form: grainForm },
        { id: "mushrooms", label: "Mushrooms", noun: "mushroom", form: mushroomForm },
        { id: "ores", label: "Ores", noun: "ore", form: oreForm },
    ]
    const panels = new Map()
    let current = kinds[0].id
    const wheres = []

    kinds.forEach(kind => {
        const panel = buildPanel(kind)
        panels.set(kind.id, panel)
        const pill = el("button", { class: "pill", type: "button", onclick: () => show(kind.id) }, kind.label)
        panel.pill = pill
        tabs.append(pill)
        root.append(panel.root)
    })

    function show(id) {
        current = id
        panels.forEach((panel, panelId) => {
            panel.root.hidden = panelId !== id
            panel.pill.classList.toggle("active", panelId === id)
        })
        panels.get(id).refresh()
    }

    // ── one kind's panel: its add form on top, its list below ────────────────
    function buildPanel(kind) {
        const addForm = kind.form()
        const placeFilter = select([{ value: "", label: "All places" }, ...app.catalog.places.map(place => ({ value: place.placeId, label: place.name }))], { onchange: () => refresh() })
        const body = el("tbody")
        const summary = el("span", { class: "muted" })
        const clearMine = button("Remove admin-placed here...", () => clearHere(true), { kind: "danger", small: true })
        const clearAll = button("Remove all here...", () => clearHere(false), { kind: "danger", small: true })

        const rootNode = el("div", { class: "stack" },
            el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h2", { text: `Add ${kind.noun}s` })), addForm.node,
                el("div", { style: "margin-top:12px" }, button(addForm.submitLabel, async () => {
                    let payload
                    try { payload = addForm.get() } catch (error) { return toast(error.message, "fail") }
                    const result = await app.run(addForm.command, payload, addForm.done)
                    if (result) refresh()
                }, { kind: "primary" }))),
            el("div", { class: "panel" },
                el("div", { class: "panel-head" }, el("h2", { text: `${kind.label} in the world` }), summary, el("span", { class: "grow" }), button("Refresh", () => refresh(), { small: true })),
                el("div", { class: "row", style: "margin-bottom:12px" },
                    field("Place", placeFilter),
                    el("div", { class: "f wide" }, el("label", { text: " " }), el("div", { class: "row" }, clearMine, clearAll))),
                el("div", { class: "table-wrap" }, el("table", { onclick: onClick },
                    el("thead", {}, el("tr", {}, ["What", "Place", "Position (x, z)", "", ""].map(text => el("th", { text })))),
                    body))))
        rootNode.hidden = true
        wheres.push(addForm.where)

        let rows = []
        async function refresh() {
            try {
                const result = await app.cmd("pickups.list", { kind: kind.id, placeId: placeFilter.value })
                rows = result.rows
                summary.textContent = result.total > rows.length ? `showing ${fmtNum(rows.length)} of ${fmtNum(result.total)}` : fmtNum(result.total)
                render()
            } catch (error) { summary.textContent = error.message }
        }
        function render() {
            clear(body)
            if (!rows.length) body.append(emptyRow(5, `No ${kind.noun}s here`))
            rows.forEach(row => body.append(el("tr", {},
                el("td", {}, row.label, " ", row.admin ? chip("admin", "gold") : null, row.keep ? chip("kept", "good") : null),
                el("td", { text: app.placeName(row.placeId) }),
                el("td", { class: "mono", text: fmtPos(row) }),
                el("td", {}),
                el("td", { class: "actions" }, el("button", { class: "btn small danger", type: "button", dataset: { id: row.id } }, "Remove")))))
            clearMine.disabled = clearAll.disabled = placeFilter.value === ""
        }
        async function onClick(event) {
            const btn = event.target.closest("button[data-id]")
            if (btn && await app.run("pickups.remove", { kind: kind.id, ids: [btn.dataset.id] }, "Removed")) refresh()
        }
        async function clearHere(adminOnly) {
            if (placeFilter.value === "") return
            const place = app.placeName(placeFilter.value)
            if (!await confirmDialog(adminOnly ? `Remove every ${kind.noun} you placed in ${place}?` : `Remove EVERY ${kind.noun} in ${place}, including the ones that belong to the world? They only come back when the server restarts.`, "Remove")) return
            const result = await app.run("pickups.clear", { kind: kind.id, placeId: placeFilter.value, adminOnly }, r => `${r.removed} removed`)
            if (result) refresh()
        }
        return { root: rootNode, refresh }
    }

    // ── the add forms ────────────────────────────────────────────────────────
    function keepBox() {
        const input = el("input", { type: "checkbox" })
        return { input, node: el("label", { class: "check" }, input, "Keep across server restarts") }
    }

    function chestForm() {
        const preset = select([...app.catalog.items.map(item => ({ value: item.key, label: item.label })), { value: "custom", label: "Custom item (JSON)..." }], {
            onchange: () => { custom.hidden = preset.value !== "custom" },
        })
        const qnty = el("input", { type: "number", min: 1, max: 999, value: 1 })
        const chests = el("input", { type: "number", min: 1, max: 20, value: 1 })
        const where = createWhereForm(app, { radiusLabel: "Spread (radius)", radiusDefault: 0 })
        const keep = keepBox()
        const json = el("textarea", { rows: 10, spellcheck: "false", value: EXAMPLE_ITEM })
        const custom = el("div", { hidden: true }, field("Item", json, { hint: "Any item the game can obtain(): it needs name, dn, itemCateg, itemType and qnty. Its icon is images/items/<itemCateg>/<name>.webp on the client." }))
        return {
            where, submitLabel: "Place chests", command: "treasures.place", done: r => `${r.placed} placed`,
            node: el("div", { class: "stack" },
                el("div", { class: "row" }, field("What's inside", preset, { cls: "wide" }), field("Amount in each", qnty, { cls: "narrow" }), field("Chests", chests, { cls: "narrow", hint: "20 at most" })),
                custom, where.node, keep.node,
                el("div", { class: "hint", text: "The chest is skinned by the item's rarity. Whoever opens it gets the item, and it's gone from the world for everyone." })),
            get: () => ({ preset: preset.value, customItem: json.value, qnty: qnty.value, count: chests.value, ...where.get(), keep: keep.input.checked }),
        }
    }

    function grainForm() {
        const count = el("input", { type: "number", min: 1, max: 300, value: 10 })
        const where = createWhereForm(app, { radiusLabel: "Spread (radius)", radiusDefault: 4 })
        const keep = keepBox()
        return {
            where, submitLabel: "Add grains", command: "grains.add", done: r => `${r.added} added`,
            node: el("div", { class: "stack" }, el("div", { class: "row" }, field("How many", count, { cls: "narrow", hint: "300 at most" })), where.node, keep.node,
                el("div", { class: "hint", text: "A picked grain grows back where it was after 5 minutes." })),
            get: () => ({ count: count.value, ...where.get(), keep: keep.input.checked }),
        }
    }

    function mushroomForm() {
        const kind = select([{ value: "random", label: "Random mix" }, ...app.catalog.mushrooms.map(m => ({ value: m.kind, label: `${m.dn} (${m.rarity})` }))])
        const count = el("input", { type: "number", min: 1, max: 300, value: 5 })
        const where = createWhereForm(app, { radiusLabel: "Spread (radius)", radiusDefault: 3 })
        const keep = keepBox()
        return {
            where, submitLabel: "Add mushrooms", command: "mushrooms.add", done: r => `${r.added} added`,
            node: el("div", { class: "stack" }, el("div", { class: "row" }, field("Kind", kind, { cls: "wide" }), field("How many", count, { cls: "narrow", hint: "300 at most" })), where.node, keep.node,
                el("div", { class: "hint", text: "A picked mushroom grows back where it was after 10 minutes." })),
            get: () => ({ kind: kind.value, count: count.value, ...where.get(), keep: keep.input.checked }),
        }
    }

    function oreForm() {
        const vein = select(app.catalog.ores.map(o => ({ value: o.vein, label: `${o.vein} - ${o.color} (${o.holds})` })))
        const count = el("input", { type: "number", min: 1, max: 50, value: 3 })
        const where = createWhereForm(app, { radiusLabel: "Spread (radius)", radiusDefault: 3 })
        const keep = keepBox()
        return {
            where, submitLabel: "Add ores", command: "ores.add", done: r => `${r.added} added`,
            node: el("div", { class: "stack" }, el("div", { class: "row" }, field("Vein", vein, { cls: "wide" }), field("How many", count, { cls: "narrow", hint: "50 at most" })), where.node, keep.node,
                el("div", { class: "hint", text: "Each has 100 hit points - a pickaxe swing takes one. One worked out is gone; an hour later a fresh one stands where it did." })),
            get: () => ({ vein: vein.value, count: count.value, ...where.get(), keep: keep.input.checked }),
        }
    }

    show(current)
    return {
        id: "items", title: "Chests & pickups", root,
        onSnapshot(snapshot) { wheres.forEach(where => where.syncPlayers(snapshot)) },
        onShow() { panels.get(current).refresh() },
        onGoto() { wheres.forEach(where => where.usePick()) },
    }
}
