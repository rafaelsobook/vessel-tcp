import { el, clear, chip, button, emptyRow, fmtDuration, fmtNum, fmtDateTime, clockOf } from "../ui.js"

// The at-a-glance view: how many of everything there is, who's where, whether
// the saved placements are safe, and the werewolf hunts under way.

export function create(app) {
    const root = el("div", { class: "view" })

    // ── numbers ──────────────────────────────────────────────────────────────
    const stats = {}
    const grid = el("div", { class: "grid cols-4" })
    ;[
        ["players", "Players online"], ["enemies", "Enemies"], ["treasures", "Chests"], ["grains", "Grains"],
        ["mushrooms", "Mushrooms"], ["crafted", "Crafted structures"], ["weather", "Weather"], ["time", "World time"],
        ["uptime", "Server uptime"], ["memory", "Memory"], ["admins", "Admins connected"], ["hunts", "Werewolf hunts"],
    ].forEach(([key, label]) => {
        stats[key] = { value: el("div", { class: "value", text: "-" }), sub: el("div", { class: "sub", text: " " }) }
        grid.append(el("div", { class: "stat" }, el("div", { class: "label", text: label }), stats[key].value, stats[key].sub))
    })

    // ── saved placements ─────────────────────────────────────────────────────
    const persistStatus = el("span")
    const persistBody = el("div", { class: "stack" })
    const persistPanel = el("div", { class: "panel" },
        el("div", { class: "panel-head" }, el("h2", { text: "Saved placements" }), persistStatus, el("span", { class: "grow" }),
            button("Save now", () => app.run("persist.flush", {}, "Saved"), { small: true }),
            button("Retry loading", () => app.run("persist.retry", {}, "Trying again"), { small: true })),
        persistBody)

    // ── who's where ──────────────────────────────────────────────────────────
    const enemiesBody = el("tbody")
    const playersBody = el("tbody")
    const huntsBody = el("div")

    root.append(
        grid,
        persistPanel,
        el("div", { class: "grid cols-2" },
            el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h2", { text: "Enemies by place" })),
                el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", { text: "Place" }), el("th", { text: "Total" }), el("th", { text: "Types" }))), enemiesBody))),
            el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h2", { text: "Players by place" })),
                el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", { text: "Place" }), el("th", { text: "Players" }), el("th", { text: "Bots" }))), playersBody)),
                el("div", { class: "hint", text: "Bots are AI players the server spawns for testing." }))),
        el("div", { class: "panel" }, el("div", { class: "panel-head" }, el("h2", { text: "Werewolf hunts" })), huntsBody))

    function renderPersistence(info) {
        const kind = { ready: "good", loading: "warn", error: "bad", off: "" }[info.status] ?? ""
        persistStatus.replaceChildren(chip(info.status === "off" ? "off" : info.status, kind))
        const counts = info.counts ?? {}
        // replaceChildren turns a null into the text "null", so the lines that
        // only sometimes apply are filtered out first
        persistBody.replaceChildren(...[
            el("div", {}, `Kept across restarts: ${counts.enemies ?? 0} enemies, ${counts.treasures ?? 0} chests, ${counts.grains ?? 0} grains, ${counts.mushrooms ?? 0} mushrooms.`),
            el("div", { class: "muted" }, `Stored by ${info.server} as "${info.world}".${info.lastSavedAt ? ` Last saved ${fmtDateTime(info.lastSavedAt)}.` : ""}${info.dirty ? " Changes waiting to be saved." : ""}`),
            info.status === "off" ? el("div", { class: "muted", text: "Persistence is switched off (ADMIN_PERSIST=off). Anything you add lasts until the next restart." }) : null,
            info.status === "loading" ? el("div", { class: "muted", text: "Waiting for the REST server (a free host can take a minute to wake up). Nothing is saved until it answers." }) : null,
            info.lastError ? el("div", { class: "fail", text: `Last problem: ${info.lastError}` }) : null
        ].filter(Boolean))
    }

    function onSnapshot(snapshot) {
        if (root.hidden) return
        const { world, server, players } = snapshot
        const set = (key, value, sub = " ") => { stats[key].value.textContent = value; stats[key].sub.textContent = sub }

        set("players", fmtNum(world.players), `${world.bots} bot${world.bots === 1 ? "" : "s"}${world.botsSpawning ? " (spawning)" : ""}`)
        set("enemies", fmtNum(world.enemies), `${fmtNum(world.enemiesFighting)} in a fight`)
        set("treasures", fmtNum(world.treasures))
        set("grains", fmtNum(world.grains))
        set("mushrooms", fmtNum(world.mushrooms))
        set("crafted", fmtNum(world.bonfires + world.trunks + world.structures), `${world.bonfires} bonfires, ${world.trunks} logs, ${world.structures} other`)
        set("weather", world.weather)
        set("time", clockOf(world.timeOfDay))
        set("uptime", fmtDuration(server.uptimeSec))
        set("memory", `${server.memoryMb} MB`, `${server.heapMb} MB heap - node ${server.node}`)
        set("admins", server.admins)
        set("hunts", world.hunts.length, world.hunts.map(h => `${h.wolf} -> ${h.prey ?? "?"}`).join(", ") || "none right now")

        renderPersistence(snapshot.persistence)

        const byPlace = Object.entries(world.enemiesByPlace).sort((a, b) => Number(a[0]) - Number(b[0]))
        clear(enemiesBody)
        if (!byPlace.length) enemiesBody.append(emptyRow(3, "No enemies"))
        byPlace.forEach(([placeId, kinds]) => {
            const total = Object.values(kinds).reduce((sum, n) => sum + n, 0)
            enemiesBody.append(el("tr", {},
                el("td", { text: app.placeName(placeId) }),
                el("td", { text: fmtNum(total) }),
                el("td", {}, Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([name, n]) => chip(`${name} ${n}`)))))
        })

        const playerPlaces = new Map()
        players.forEach(player => {
            const row = playerPlaces.get(player.placeId) ?? { real: 0, bots: 0 }
            row[player.bot ? "bots" : "real"]++
            playerPlaces.set(player.placeId, row)
        })
        clear(playersBody)
        if (!playerPlaces.size) playersBody.append(emptyRow(3, "Nobody is in the world"))
        ;[...playerPlaces].forEach(([placeId, row]) => playersBody.append(el("tr", {},
            el("td", { text: app.placeName(placeId) }), el("td", { text: row.real }), el("td", { text: row.bots }))))

        huntsBody.replaceChildren(world.hunts.length
            ? el("div", {}, world.hunts.map(h => chip(`${h.wolf} is hunting ${h.prey ?? "someone"}`, "bad")))
            : el("div", { class: "muted", text: "A player 3000 or more from the open world's start is hunted by the nearest standing wolf. None are hunting right now." }))
    }

    return { id: "dashboard", title: "Dashboard", root, onSnapshot }
}
