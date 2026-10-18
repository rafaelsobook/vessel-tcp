// Small DOM helpers. Everything the page shows is built with textContent or
// text nodes - never innerHTML - because much of it (player names, item names,
// log lines) comes from players, and a name must not be able to run script on
// the admin's page.

export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue
        if (key === "class") node.className = value
        else if (key === "text") node.textContent = value
        else if (key === "dataset") Object.assign(node.dataset, value)
        else if (key === "value") node.value = value
        else if (key === "checked" || key === "disabled" || key === "selected" || key === "hidden") node[key] = !!value
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value)
        else node.setAttribute(key, value === true ? "" : String(value))
    }
    for (const child of children.flat(Infinity)) {
        if (child == null || child === false) continue
        node.append(child.nodeType ? child : document.createTextNode(String(child)))
    }
    return node
}

export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild)
    return node
}

// ── formatting ───────────────────────────────────────────────────────────────
export function fmtDuration(totalSec) {
    const s = Math.max(0, Math.round(totalSec))
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60)
    if (d) return `${d}d ${h}h ${m}m`
    if (h) return `${h}h ${m}m`
    if (m) return `${m}m ${s % 60}s`
    return `${s}s`
}
export const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour12: false })
export const fmtDateTime = ts => new Date(ts).toLocaleString([], { hour12: false })
export const fmtNum = n => (n == null ? "-" : Number(n).toLocaleString())
export const fmtPos = p => (p ? `${Math.round(p.x * 10) / 10}, ${Math.round(p.z * 10) / 10}` : "-")
// 0 = midnight, 0.5 = noon - the game's own clock
export function clockOf(timeOfDay) {
    const minutes = Math.floor(timeOfDay * 24 * 60)
    const h24 = Math.floor(minutes / 60) % 24
    const h12 = h24 % 12 || 12
    return `${String(h12).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`
}

// ── form pieces ──────────────────────────────────────────────────────────────
export function field(label, control, { cls = "", hint = "" } = {}) {
    return el("div", { class: `f ${cls}` }, el("label", { text: label }), control, hint ? el("div", { class: "hint", text: hint }) : null)
}

// options: [{ value, label, group? }] - grouped ones go under an <optgroup>
export function select(options, { value = "", onchange } = {}) {
    const node = el("select", { onchange })
    const groups = new Map()
    options.forEach(option => {
        const opt = el("option", { value: option.value, text: option.label })
        if (option.group) {
            if (!groups.has(option.group)) { const g = el("optgroup", { label: option.group }); groups.set(option.group, g); node.append(g) }
            groups.get(option.group).append(opt)
        } else node.append(opt)
    })
    // Setting .value to something that isn't an option (an unset "" included)
    // leaves the box showing nothing and the form sending "" - so without a
    // value that's really there, the first option stays picked.
    if (value != null && value !== "") node.value = String(value)
    if (node.selectedIndex < 0 && node.options.length) node.selectedIndex = 0
    return node
}

// Replaces a <select>'s options without losing what was picked, when it's still there.
export function setOptions(node, options, emptyLabel = null) {
    const previous = node.value
    clear(node)
    if (emptyLabel != null) node.append(el("option", { value: "", text: emptyLabel }))
    options.forEach(option => node.append(el("option", { value: option.value, text: option.label })))
    if ([...node.options].some(o => o.value === previous)) node.value = previous
}

export function button(label, onclick, { kind = "", small = false, title = "" } = {}) {
    return el("button", { class: `btn ${kind} ${small ? "small" : ""}`.trim(), type: "button", onclick, title }, label)
}

export function chip(text, kind = "") {
    return el("span", { class: `chip ${kind}`.trim(), text })
}

export function emptyRow(columns, message) {
    return el("tr", {}, el("td", { colspan: columns, class: "empty", text: message }))
}

// ── toast ────────────────────────────────────────────────────────────────────
export function toast(message, kind = "info") {
    const node = el("div", { class: `toast ${kind}`, text: message })
    document.getElementById("toasts").append(node)
    setTimeout(() => node.remove(), kind === "fail" ? 7000 : 3500)
}

// ── modal ────────────────────────────────────────────────────────────────────
// actions: [{ label, kind, onclick(close) }]; returns close()
export function openModal({ title, body, actions = [] }) {
    const root = document.getElementById("modalRoot")
    const close = () => { back.remove(); document.removeEventListener("keydown", onKey) }
    const onKey = event => { if (event.key === "Escape") close() }
    const back = el("div", { class: "modal-back", onmousedown: event => { if (event.target === back) close() } },
        el("div", { class: "modal" },
            el("h2", { text: title }),
            body,
            el("div", { class: "modal-actions" },
                actions.map(action => button(action.label, () => action.onclick?.(close), { kind: action.kind })))))
    document.addEventListener("keydown", onKey)
    root.append(back)
    const first = back.querySelector("input, select, textarea")
    if (first) first.focus()
    return close
}

export function confirmDialog(message, confirmLabel = "Confirm", danger = true) {
    return new Promise(resolve => {
        let answered = false
        const answer = value => { if (!answered) { answered = true; resolve(value) } }
        const close = openModal({
            title: "Are you sure?",
            body: el("p", { text: message, style: "margin:0" }),
            actions: [
                { label: "Cancel", onclick: c => { answer(false); c() } },
                { label: confirmLabel, kind: danger ? "danger" : "primary", onclick: c => { answer(true); c() } },
            ],
        })
        // closing it any other way (Escape, a click outside) is a no
        const watcher = new MutationObserver(() => { if (!document.querySelector(".modal-back")) { answer(false); watcher.disconnect() } })
        watcher.observe(document.getElementById("modalRoot"), { childList: true })
        return close
    })
}
