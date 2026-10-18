import { el, field, select, setOptions, button, toast } from "./ui.js"

// "Where" for a command - the same little form wherever something is placed:
// either a spot in a place (coordinates, or the last point clicked on the map)
// or right next to a player. get() hands back the fields the server's `where`
// reads (commands.ts): { placeId, x, z } or { playerOwner }, plus radius.

export function createWhereForm(app, { radius = true, radiusLabel = "Spread (radius)", radiusDefault = 0, defaultPlace = 888 } = {}) {
    let mode = "coords"

    const placeSel = select(app.catalog.places.map(place => ({ value: place.placeId, label: place.name })), { value: defaultPlace })
    const x = el("input", { type: "number", step: "any", placeholder: "x" })
    const z = el("input", { type: "number", step: "any", placeholder: "z" })
    const radiusInput = el("input", { type: "number", min: 0, step: "any", value: radiusDefault })
    const playerSel = el("select")

    const coordsBtn = el("button", { class: "pill active", type: "button", onclick: () => setMode("coords") }, "At coordinates")
    const playerBtn = el("button", { class: "pill", type: "button", onclick: () => setMode("player") }, "Next to a player")

    const coordsRow = el("div", { class: "row" },
        field("Place", placeSel, { cls: "wide" }),
        field("X", x, { cls: "narrow" }),
        field("Z", z, { cls: "narrow" }),
        el("div", { class: "f narrow" }, el("label", { text: " " }), button("Use map pick", usePick, { small: true, title: "Fill from the spot last clicked on the Map tab" })))
    const playerRow = el("div", { class: "row", hidden: true }, field("Player", playerSel, { cls: "wide", hint: "Placed in whatever place they're in, at their position." }))
    const radiusRow = radius ? el("div", { class: "row" }, field(radiusLabel, radiusInput, { cls: "narrow" })) : null

    const node = el("div", { class: "stack" },
        el("div", { class: "tabs-inner" }, coordsBtn, playerBtn),
        coordsRow, playerRow, radiusRow)

    function setMode(next) {
        mode = next
        coordsBtn.classList.toggle("active", mode === "coords")
        playerBtn.classList.toggle("active", mode === "player")
        coordsRow.hidden = mode !== "coords"
        playerRow.hidden = mode !== "player"
    }

    function usePick() {
        if (!app.pick) return toast("Click a spot on the Map tab first", "fail")
        setMode("coords")
        placeSel.value = String(app.pick.placeId)
        x.value = app.pick.x
        z.value = app.pick.z
    }

    function get() {
        const out = {}
        if (mode === "player") {
            if (!playerSel.value) throw new Error("pick a player")
            out.playerOwner = playerSel.value
        } else {
            if (x.value === "" || z.value === "") throw new Error("fill in x and z, or click a spot on the Map tab and press \"Use map pick\"")
            Object.assign(out, { placeId: Number(placeSel.value), x: x.value, z: z.value })
        }
        if (radius) out.radius = radiusInput.value === "" ? 0 : radiusInput.value
        return out
    }

    // keeps the player list current without losing who was picked
    function syncPlayers(snapshot) {
        setOptions(playerSel, (snapshot?.players ?? []).map(player => ({ value: player.owner, label: `${player.name}${player.bot ? " (bot)" : ""} - ${player.place}` })), "Choose a player...")
    }

    syncPlayers(app.snapshot)
    return { node, get, syncPlayers, usePick, setMode }
}
