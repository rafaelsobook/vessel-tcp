import { el, clear, field, select, button, chip, emptyRow, openModal, confirmDialog, toast, setOptions, fmtPos } from "../ui.js"

// Who's online, with the tools for helping them: lift or move a player who's
// stuck, tell them something, send them away - and, for a character that isn't
// online, change the position they'll log in at.

export function create(app) {
    const root = el("div", { class: "view" })

    // ── online players ───────────────────────────────────────────────────────
    const filter = el("input", { type: "text", placeholder: "Filter by name or place...", oninput: () => render() })
    const body = el("tbody")
    const onlineCount = el("span", { class: "muted" })

    // ── characters that aren't online ────────────────────────────────────────
    const searchInput = el("input", { type: "text", placeholder: "Character name...", maxlength: 60, onkeydown: event => { if (event.key === "Enter") search() } })
    const savedBody = el("tbody")
    const savedHint = el("div", { class: "hint", text: "Looks a character up in the database. Use this when someone can't get into the game or keeps landing in the same bad spot: their next login starts where you put them." })

    root.append(
        el("div", { class: "panel" },
            el("div", { class: "panel-head" }, el("h2", { text: "Online" }), onlineCount, el("span", { class: "grow" }), el("div", { style: "width:260px" }, filter)),
            el("div", { class: "table-wrap" }, el("table", { onclick: onTableClick },
                el("thead", {}, el("tr", {}, ["Name", "Lvl", "Place", "Position (x, z)", "Mode", "", ""].map(text => el("th", { text })))),
                body))),
        el("div", { class: "panel" },
            el("div", { class: "panel-head" }, el("h2", { text: "Characters not online" }), el("span", { class: "grow" }),
                el("div", { style: "width:260px" }, searchInput), button("Search", search, { kind: "primary" })),
            savedHint,
            el("div", { class: "table-wrap", style: "margin-top:10px" }, el("table", { onclick: onSavedClick },
                el("thead", {}, el("tr", {}, ["Name", "Lvl", "Saved place", "Saved position (x, z)", ""].map(text => el("th", { text })))),
                savedBody))))

    let players = []

    function render() {
        const needle = filter.value.trim().toLowerCase()
        const rows = players.filter(player => !needle || player.name.toLowerCase().includes(needle) || player.place.toLowerCase().includes(needle))
        onlineCount.textContent = `${players.filter(p => !p.bot).length} players, ${players.filter(p => p.bot).length} bots`
        clear(body)
        if (!rows.length) return body.append(emptyRow(7, players.length ? "Nothing matches the filter" : "Nobody is in the world"))
        rows.forEach(player => {
            const status = [
                player.bot ? chip("bot", "gold") : null,
                player.seated ? chip("sitting") : null,
                player.tired ? chip("tired", "warn") : null,
                player.bleeding ? chip("bleeding", "bad") : null,
            ]
            const actions = player.bot
                ? el("td", { class: "actions muted", text: "" })
                : el("td", { class: "actions" },
                    button("Lift", null, { small: true, title: "Raise 4 units straight up - for someone stuck in a wall or the ground" }),
                    button("Move...", null, { small: true }),
                    button("Message", null, { small: true }),
                    button("Kick", null, { small: true, kind: "danger" }))
            actions.querySelectorAll("button").forEach(btn => { btn.dataset.owner = player.owner; btn.dataset.act = btn.textContent.replace("...", "").toLowerCase() })
            body.append(el("tr", {},
                el("td", {}, player.name, " ", status),
                el("td", { text: player.lvl ?? "-" }),
                el("td", { text: player.place }),
                el("td", { class: "mono", text: fmtPos(player.pos) }),
                el("td", { text: player.mode ?? "-" }),
                el("td", {}, player.hp != null ? chip(`hp ${Math.round(player.hp)}/${player.maxHp}`) : null),
                actions))
        })
    }

    function playerOf(owner) { return players.find(player => player.owner === owner) }

    function onTableClick(event) {
        const btn = event.target.closest("button[data-act]")
        if (!btn) return
        const player = playerOf(btn.dataset.owner)
        if (!player) return toast("That player has left", "fail")
        if (btn.dataset.act === "lift") app.run("players.teleport", { owner: player.owner, lift: 4 }, `${player.name} lifted`)
        if (btn.dataset.act === "move") openMove(player)
        if (btn.dataset.act === "message") openMessage(player)
        if (btn.dataset.act === "kick") openKick(player)
    }

    // ── dialogs ──────────────────────────────────────────────────────────────
    const numberInput = placeholder => el("input", { type: "number", step: "any", placeholder })
    const placeOptions = () => app.catalog.places.map(place => ({ value: place.placeId, label: place.name }))

    function openMove(player) {
        let mode = "place"
        const placeSel = select(placeOptions(), { value: player.placeId })
        const x = numberInput("x"), z = numberInput("z"), y = numberInput("y")
        const others = players.filter(other => other.owner !== player.owner)
        const otherSel = select(others.map(other => ({ value: other.owner, label: `${other.name} - ${other.place}` })))
        const placeBtn = el("button", { class: "pill active", type: "button", onclick: () => setMode("place") }, "To a place")
        const playerBtn = el("button", { class: "pill", type: "button", onclick: () => setMode("player") }, "To another player")
        const placeBox = el("div", { class: "stack" },
            el("div", { class: "row" }, field("Place", placeSel, { cls: "wide" })),
            el("div", { class: "row" }, field("X", x), field("Z", z), field("Y (optional)", y, { cls: "narrow" })),
            el("div", { class: "row" }, button("Use map pick", () => {
                if (!app.pick) return toast("Click a spot on the Map tab first", "fail")
                placeSel.value = String(app.pick.placeId); x.value = app.pick.x; z.value = app.pick.z
            }, { small: true })),
            el("div", { class: "hint", text: "Leave X and Z empty to send them to the place's spawn point. In a dungeon the spot is moved onto the nearest floor." }))
        const playerBox = el("div", { class: "stack", hidden: true }, field("Player", otherSel), el("div", { class: "hint", text: "They'll appear next to that player, even in another place." }))
        function setMode(next) {
            mode = next
            placeBtn.classList.toggle("active", mode === "place"); playerBtn.classList.toggle("active", mode === "player")
            placeBox.hidden = mode !== "place"; playerBox.hidden = mode !== "player"
        }
        openModal({
            title: `Move ${player.name}`,
            body: el("div", { class: "stack" }, el("div", { class: "tabs-inner" }, placeBtn, playerBtn), placeBox, playerBox),
            actions: [
                { label: "Cancel", onclick: close => close() },
                {
                    label: "Move", kind: "primary", onclick: async close => {
                        const payload = { owner: player.owner }
                        if (mode === "player") {
                            if (!otherSel.value) return toast("Pick a player", "fail")
                            payload.toPlayer = otherSel.value
                        } else {
                            payload.placeId = Number(placeSel.value)
                            if (x.value === "" || z.value === "") payload.toSpawn = true
                            else { payload.x = x.value; payload.z = z.value; if (y.value !== "") payload.y = y.value }
                        }
                        const result = await app.run("players.teleport", payload, r => `${r.player} sent to ${r.to}`)
                        if (result) close()
                    },
                },
            ],
        })
    }

    function openMessage(player) {
        const text = el("textarea", { maxlength: 300, placeholder: "What to tell them..." })
        openModal({
            title: `Message ${player.name}`,
            body: el("div", { class: "stack" }, field("Message", text), el("div", { class: "hint", text: "Appears on their screen for a few seconds." })),
            actions: [
                { label: "Cancel", onclick: close => close() },
                { label: "Send", kind: "primary", onclick: async close => { if (await app.run("players.message", { owner: player.owner, text: text.value }, "Sent")) close() } },
            ],
        })
    }

    async function openKick(player) {
        const reason = el("input", { type: "text", maxlength: 200, placeholder: "Reason (they'll see it)" })
        openModal({
            title: `Disconnect ${player.name}`,
            body: el("div", { class: "stack" }, el("p", { style: "margin:0", text: "They're taken out of the game and have to reload the page to come back." }), field("Reason", reason)),
            actions: [
                { label: "Cancel", onclick: close => close() },
                { label: "Disconnect", kind: "danger", onclick: async close => { if (await app.run("players.kick", { owner: player.owner, reason: reason.value }, `${player.name} disconnected`)) close() } },
            ],
        })
    }

    // ── saved characters ─────────────────────────────────────────────────────
    let found = []

    async function search() {
        const q = searchInput.value.trim()
        if (!q) return toast("Type part of a character's name", "fail")
        clear(savedBody).append(emptyRow(5, "Searching... (the first lookup can take a minute if the database server is waking up)"))
        const result = await app.run("saved.find", { q })
        found = result?.characters ?? []
        clear(savedBody)
        if (!result) return savedBody.append(emptyRow(5, "The search failed"))
        if (!found.length) return savedBody.append(emptyRow(5, "No character with that name"))
        found.forEach(character => {
            const place = character.currentPlace ?? {}
            savedBody.append(el("tr", {},
                el("td", {}, character.name, " ", character.online ? chip("online now", "good") : null),
                el("td", { text: character.lvl ?? "-" }),
                el("td", { text: place.placeId != null ? app.placeName(place.placeId) : "?" }),
                el("td", { class: "mono", text: fmtPos(character) }),
                el("td", { class: "actions" }, el("button", { class: "btn small", type: "button", dataset: { owner: character.owner }, disabled: character.online, title: character.online ? "They're online - use Move on the Online list instead" : "" }, "Move..."))))
        })
    }

    function onSavedClick(event) {
        const btn = event.target.closest("button[data-owner]")
        if (!btn) return
        const character = found.find(c => c.owner === btn.dataset.owner)
        if (character) openReposition(character)
    }

    function openReposition(character) {
        const placeSel = select(placeOptions(), { value: 1 })
        const x = numberInput("x"), z = numberInput("z"), y = numberInput("y")
        openModal({
            title: `Where ${character.name} logs in`,
            body: el("div", { class: "stack" },
                el("p", { style: "margin:0", class: "muted", text: `Saved now: ${character.currentPlace?.placeId != null ? app.placeName(character.currentPlace.placeId) : "?"} (${fmtPos(character)})` }),
                el("div", { class: "row" }, field("Place", placeSel, { cls: "wide" })),
                el("div", { class: "row" }, field("X", x), field("Z", z), field("Y (optional)", y, { cls: "narrow" })),
                el("div", { class: "hint", text: "Leave X and Z empty to use the place's spawn point. This only works while they're offline - if they come online first, their own game would save its position over this." })),
            actions: [
                { label: "Cancel", onclick: close => close() },
                {
                    label: "Save position", kind: "primary", onclick: async close => {
                        const payload = { owner: character.owner, placeId: Number(placeSel.value) }
                        if (x.value !== "") payload.x = x.value
                        if (z.value !== "") payload.z = z.value
                        if (y.value !== "") payload.y = y.value
                        const result = await app.run("saved.reposition", payload, r => `${r.character} will log in at ${r.to}`)
                        if (result) { close(); search() }
                    },
                },
            ],
        })
    }

    function onSnapshot(snapshot) {
        players = snapshot.players
        if (!root.hidden) render()
    }

    return {
        id: "players", title: "Players", root, onSnapshot,
        onShow: () => render(),
        badge: snapshot => snapshot?.world.players,
    }
}
