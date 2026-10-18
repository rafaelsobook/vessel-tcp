import { el, field, button, chip, toast, confirmDialog, clockOf } from "../ui.js"
import { createWhereForm } from "../where.js"

// Whole-world controls: tell everyone something, set the sky and the clock,
// and the test bots.

const WEATHER_LABELS = { clear: "Clear", rain: "Rain", fog: "Fog", snow: "Snow", sandstorm: "Sandstorm" }
const TIME_PRESETS = [["Midnight", 0], ["Dawn", 6], ["Noon", 12], ["Dusk", 18]]

export function create(app) {
    const root = el("div", { class: "view" })

    // ── announcement ─────────────────────────────────────────────────────────
    const announcement = el("textarea", { maxlength: 300, placeholder: "e.g. The server restarts in 5 minutes - please finish what you're doing." })
    const announce = async () => {
        if (!announcement.value.trim()) return toast("Write the announcement first", "fail")
        if (!await confirmDialog("Send this to every player in the game?", "Send", false)) return
        if (await app.run("world.announce", { text: announcement.value }, r => `Sent to ${r.sent} players`)) announcement.value = ""
    }

    // ── weather ──────────────────────────────────────────────────────────────
    const currentWeather = el("span")
    const weatherButtons = el("div", { class: "row" }, app.catalog.weather.map(weather =>
        button(WEATHER_LABELS[weather] ?? weather, () => app.run("world.weather", { weather }, `Weather: ${weather}`), { small: true })))

    // ── clock ────────────────────────────────────────────────────────────────
    const currentTime = el("span")
    const hours = el("input", { type: "range", class: "range", min: 0, max: 23.9, step: 0.1, value: 12 })
    const hoursLabel = el("span", { class: "mono", text: "12:00 PM" })
    hours.addEventListener("input", () => { hoursLabel.textContent = clockOf(Number(hours.value) / 24) })
    const setTime = hour => app.run("world.time", { timeOfDay: hour / 24 }, `Time set to ${clockOf(hour / 24)}`)

    // ── bots ─────────────────────────────────────────────────────────────────
    const botsOn = el("input", { type: "checkbox", onchange: () => app.run("bots.toggle", { enabled: botsOn.checked }, botsOn.checked ? "Bots will spawn" : "Bots stopped spawning") })
    const botCount = el("input", { type: "number", min: 1, max: 10, value: 1 })
    const botWhere = createWhereForm(app, { radius: false, defaultPlace: 1 })

    root.append(
        el("div", { class: "panel" },
            el("div", { class: "panel-head" }, el("h2", { text: "Announcement" })),
            el("div", { class: "stack" }, announcement, el("div", { class: "hint", text: "Shows on every player's screen for a few seconds and goes into world chat as a server line." }),
                el("div", {}, button("Send to everyone", announce, { kind: "primary" })))),
        el("div", { class: "grid cols-2" },
            el("div", { class: "panel" },
                el("div", { class: "panel-head" }, el("h2", { text: "Weather" }), currentWeather),
                weatherButtons,
                el("div", { class: "hint", text: "The whole world has one weather; it changes by itself every few minutes." })),
            el("div", { class: "panel" },
                el("div", { class: "panel-head" }, el("h2", { text: "Time of day" }), currentTime),
                el("div", { class: "stack" },
                    el("div", { class: "row" }, TIME_PRESETS.map(([label, hour]) => button(label, () => setTime(hour), { small: true }))),
                    el("div", { class: "row" }, el("div", { class: "f wide" }, hours), hoursLabel, button("Set", () => setTime(Number(hours.value)), { small: true }))))),
        el("div", { class: "panel" },
            el("div", { class: "panel-head" }, el("h2", { text: "Test bots" })),
            el("div", { class: "stack" },
                el("label", { class: "check" }, botsOn, "Let the server keep spawning bots (one every few seconds, up to its cap)"),
                el("div", { class: "hint", text: "Bots are AI players for testing fights and the player list." }),
                el("div", { class: "row" }, field("Spawn now", botCount, { cls: "narrow" })),
                botWhere.node,
                el("div", {}, button("Spawn bots", async () => {
                    let target
                    try { target = botWhere.get() } catch (error) { return toast(error.message, "fail") }
                    await app.run("bots.spawn", { count: botCount.value, ...target }, r => `${r.spawned} spawned`)
                }, { kind: "primary" })))))

    return {
        id: "server", title: "World & server", root,
        onSnapshot(snapshot) {
            botWhere.syncPlayers(snapshot)
            if (root.hidden) return
            currentWeather.replaceChildren(chip(snapshot.world.weather, "good"))
            currentTime.replaceChildren(chip(clockOf(snapshot.world.timeOfDay)))
            if (document.activeElement !== botsOn) botsOn.checked = snapshot.world.botsSpawning
        },
        onGoto() { botWhere.usePick() },
    }
}
