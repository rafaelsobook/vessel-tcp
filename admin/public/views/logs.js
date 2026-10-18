import { el, clear, field, button, emptyRow, fmtTime, fmtDateTime } from "../ui.js"

// What's been done from the admin page (the audit trail) and a live tail of the
// server's own log - the same lines the host's log shows, without leaving the page.

export function create(app) {
    const root = el("div", { class: "view" })

    // ── audit ────────────────────────────────────────────────────────────────
    const auditBody = el("tbody")
    const auditTable = el("div", { class: "table-wrap" }, el("table", {},
        el("thead", {}, el("tr", {}, ["When", "From", "Action", "Details", "Result"].map(text => el("th", { text })))), auditBody))

    function auditRow(entry) {
        return el("tr", {},
            el("td", { class: "mono", title: fmtDateTime(entry.t), text: fmtTime(entry.t) }),
            el("td", { class: "mono", text: entry.ip }),
            el("td", { text: entry.action }),
            el("td", { text: entry.detail || "" }),
            el("td", { class: entry.ok ? "ok" : "fail", text: entry.ok ? "ok" : entry.error }))
    }
    function renderAudit() {
        clear(auditBody)
        if (!app.audit.length) return auditBody.append(emptyRow(5, "Nothing has been done yet"))
        ;[...app.audit].reverse().forEach(entry => auditBody.append(auditRow(entry)))
    }

    // ── server log ───────────────────────────────────────────────────────────
    const logBox = el("div", { class: "log" })
    const filter = el("input", { type: "text", placeholder: "Filter...", oninput: () => renderLog() })
    const follow = el("input", { type: "checkbox", checked: true })
    const warnsOnly = el("input", { type: "checkbox", onchange: () => renderLog() })

    function lineNode(line) {
        return el("div", { class: line.level === "log" ? "" : line.level }, el("span", { class: "time", text: fmtTime(line.t) }), line.text)
    }
    function passes(line) {
        if (warnsOnly.checked && line.level === "log") return false
        const needle = filter.value.trim().toLowerCase()
        return !needle || line.text.toLowerCase().includes(needle)
    }
    function renderLog() {
        clear(logBox)
        app.log.filter(passes).forEach(line => logBox.append(lineNode(line)))
        if (follow.checked) logBox.scrollTop = logBox.scrollHeight
    }

    root.append(
        el("div", { class: "panel" },
            el("div", { class: "panel-head" }, el("h2", { text: "Admin actions" }), el("span", { class: "grow" })),
            auditTable),
        el("div", { class: "panel" },
            el("div", { class: "panel-head" }, el("h2", { text: "Server log" }), el("span", { class: "grow" }),
                el("div", { style: "width:220px" }, filter),
                el("label", { class: "check" }, warnsOnly, "Warnings and errors only"),
                el("label", { class: "check" }, follow, "Follow"),
                button("Clear view", () => { app.log.length = 0; renderLog() }, { small: true })),
            logBox))

    app.on("audit", entry => {
        if (root.hidden) return
        if (auditBody.querySelector(".empty")) clear(auditBody)
        auditBody.prepend(auditRow(entry))
    })
    app.on("log", lines => {
        if (root.hidden) return
        const stick = follow.checked
        lines.filter(passes).forEach(line => logBox.append(lineNode(line)))
        while (logBox.childElementCount > 400) logBox.firstChild.remove()
        if (stick) logBox.scrollTop = logBox.scrollHeight
    })

    return {
        id: "logs", title: "Logs", root,
        onShow() { renderAudit(); renderLog() },
    }
}
