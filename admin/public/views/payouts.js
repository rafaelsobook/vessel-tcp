import { el, clear, chip, button, field, openModal, toast, fmtDateTime, fmtNum, emptyRow } from "../ui.js"

// PAYOUTS - VesselPay, real CAD. Players earn from kills (tcp works it out,
// admin/economy.ts) and ask for their balance once it reaches CA$10. Each
// request waits here with what's needed to judge it: who it's for, where the
// money goes (PayPal email or phone, and the name on that PayPal), their
// Discord, how old and how honest the account looks (anti-cheat flags, the same
// PayPal on other accounts). Pay it in PayPal yourself, then "Mark paid" with
// PayPal's transaction id - or reject it: refunded to their balance, or voided
// when it was cheated. Above: the money at a glance and what a kill pays.

const STATUSES = [
    { id: "pending", label: "Waiting" },
    { id: "paid", label: "Paid" },
    { id: "rejected", label: "Rejected" },
    { id: "all", label: "All" },
]
const cad = cents => `CA$${(Number(cents || 0) / 100).toFixed(2)}`
const hoursSince = date => (Date.now() - new Date(date).getTime()) / 3600000
const ageText = date => {
    if (!date) return "?"
    const h = hoursSince(date)
    return h < 48 ? `${Math.floor(h)}h old` : `${Math.floor(h / 24)} days old`
}
const SEVERITY_KIND = { bad: "bad", warn: "warn", info: "" }

export function create(app) {
    const root = el("div", { class: "view" })

    // ── the money at a glance ────────────────────────────────────────────────
    const tiles = el("div", { class: "grid cols-4" })

    // ── what a kill pays ─────────────────────────────────────────────────────
    // only water, fire and electric slimes pay - each kill runs tcp's checks and a roll
    const money = () => el("input", { type: "number", step: "0.01", min: 0 })
    const inputs = {
        enabled: el("input", { type: "checkbox" }),
        payChance: el("input", { type: "number", step: "1", min: 0, max: 100 }),
        waterslime: money(),
        fireslime: money(),
        electricslime: money(),
        cap: el("input", { type: "number", step: "0.25", min: 0 }),
        maxHitFlag: el("input", { type: "number", step: "100", min: 100 }),
    }
    const settingsPanel = el("div", { class: "panel" },
        el("div", { class: "panel-head" }, el("h2", { text: "What a kill pays" }), el("span", { class: "grow" }), button("Save", saveSettings, { kind: "primary" })),
        el("div", { class: "row top" },
            field("Payouts", el("label", { class: "check", style: "padding:7px 0" }, inputs.enabled, "On")),
            field("Chance a slime pays (%)", inputs.payChance, { hint: "the roll, decided by tcp" }),
            field("Water slime (CA$)", inputs.waterslime),
            field("Fire slime (CA$)", inputs.fireslime),
            field("Electric slime (CA$)", inputs.electricslime),
            field("Daily cap per player (CA$)", inputs.cap, { hint: "0 = no cap" }),
            field("Flag a hit at (damage)", inputs.maxHitFlag, { hint: "\"huge-hit\" on the Watch tab" })),
        el("div", { class: "hint", text: "Only water, fire and electric slimes pay. Every kill of one runs four checks in tcp - the kill was really theirs, a clean record (no serious flags, not frozen), today's limit, then the roll - and the player watches them on a progress bar over the slime. Withdrawals open at CA$10.00 (fixed); players also need a real (not guest) account at least 48 hours old and to be in your Discord. Changes apply to the next kill." }))

    // ── the queue ────────────────────────────────────────────────────────────
    let status = "pending"
    const statusBox = el("div", { class: "tabs-inner", style: "margin:0" })
    STATUSES.forEach(s => statusBox.append(el("button", { class: `pill ${s.id === status ? "active" : ""}`, type: "button", dataset: { id: s.id }, onclick: () => {
        status = s.id
        statusBox.querySelectorAll(".pill").forEach(p => p.classList.toggle("active", p.dataset.id === status))
        refreshQueue()
    } }, s.label)))
    const queueBody = el("tbody")
    const queuePanel = el("div", { class: "panel" },
        el("div", { class: "panel-head" }, el("h2", { text: "Withdrawal requests" }), statusBox, el("span", { class: "grow" }), button("Refresh", () => refreshQueue(), { small: true })),
        el("div", { class: "table-wrap", style: "max-height:none" }, el("table", {},
            el("thead", {}, el("tr", {}, ["Asked", "Player", "Amount", "Send to (PayPal)", "Discord", "Account", "Warnings", ""].map(text => el("th", { text })))),
            queueBody)))

    // ── banned / frozen ──────────────────────────────────────────────────────
    const bannedBody = el("tbody")
    const bannedPanel = el("div", { class: "panel" },
        el("div", { class: "panel-head" }, el("h2", { text: "Banned and frozen accounts" }), el("span", { class: "grow" }), button("Refresh", () => refreshBanned(), { small: true })),
        el("div", { class: "table-wrap" }, el("table", {},
            el("thead", {}, el("tr", {}, ["Account", "Banned", "Earnings frozen", ""].map(text => el("th", { text })))),
            bannedBody)))

    root.append(tiles, settingsPanel, queuePanel, bannedPanel)

    // ── loading ──────────────────────────────────────────────────────────────
    function tile(label, value, sub = "") {
        return el("div", { class: "stat" }, el("div", { class: "label", text: label }), el("div", { class: "value", text: value }), el("div", { class: "sub", text: sub || " " }))
    }

    async function refreshEconomy() {
        let result
        try { result = await app.cmd("economy.get") } catch (error) { return toast(error.message, "fail") }
        const st = result.settings, stats = result.stats ?? {}
        inputs.enabled.checked = !!st.enabled
        inputs.payChance.value = Math.round((st.payChance ?? 0.5) * 1000) / 10
        ;["waterslime", "fireslime", "electricslime"].forEach(kind => { inputs[kind].value = ((st.slimePay?.[kind] ?? 0) / 100).toFixed(2) })
        inputs.cap.value = (st.dailyCapCents / 100).toFixed(2)
        inputs.maxHitFlag.value = st.maxHitFlag
        clear(tiles).append(
            tile("Waiting to be paid", stats.error ? "?" : fmtNum(stats.pendingCount ?? 0), stats.error ? stats.error : cad(stats.pendingCents)),
            tile("Players' balances", cad(stats.balances), `${fmtNum(stats.readyAccounts ?? 0)} accounts at CA$10+`),
            tile("Paid out", cad(stats.paid), `voided ${cad(stats.voided)}`),
            tile("Earned all time", cad(stats.earned), st.enabled ? `${Math.round((st.payChance ?? 0.5) * 100)}% of slimes pay${st.dailyCapCents ? `, cap ${cad(st.dailyCapCents)}/day` : ""}` : "PAYOUTS OFF"),
            tile("Discord check", stats.discordOAuth ? "Discord sign-in" : "Typed usernames", stats.discordOAuth ? "verified by Discord itself" : "check each one by hand - see the setup note"))
    }

    async function saveSettings() {
        const settings = {
            enabled: inputs.enabled.checked,
            payChance: Number(inputs.payChance.value) / 100,
            slimePay: Object.fromEntries(["waterslime", "fireslime", "electricslime"].map(kind => [kind, Math.round(Number(inputs[kind].value) * 100)])),
            dailyCapCents: Math.round(Number(inputs.cap.value) * 100),
            maxHitFlag: Number(inputs.maxHitFlag.value),
        }
        if (await app.run("economy.set", { settings }, "Saved - the next kill pays by these")) refreshEconomy()
    }

    let rows = []
    async function refreshQueue() {
        clear(queueBody).append(emptyRow(8, "Loading... (the first call can take a minute if the database server is waking up)"))
        let result
        try { result = await app.cmd("payouts.list", { status }) } catch (error) {
            clear(queueBody).append(emptyRow(8, error.message))
            return
        }
        rows = result.withdrawals ?? []
        clear(queueBody)
        if (!rows.length) return queueBody.append(emptyRow(8, status === "pending" ? "Nobody is waiting" : "None"))
        rows.forEach(w => queueBody.append(rowOf(w)))
    }

    function copyButton(text) {
        return button("Copy", async () => {
            try { await navigator.clipboard.writeText(text); toast("Copied", "ok") } catch { toast("Couldn't copy - select it by hand", "fail") }
        }, { small: true })
    }

    function warningsOf(w) {
        const a = w.account
        const list = []
        if (!a) list.push(chip("account gone", "bad"))
        if (a?.banned) list.push(chip("banned", "bad"))
        if (a?.frozen) list.push(chip("frozen", "warn"))
        if (w.wasGuest || a?.isGuest) list.push(chip("guest", "bad"))
        if (w.samePaypalOwners?.length) list.push(chip(`same PayPal on ${w.samePaypalOwners.length} other account${w.samePaypalOwners.length > 1 ? "s" : ""}`, "bad"))
        const flags = a?.flags ?? []
        const bad = flags.filter(f => f.severity === "bad").length, warn = flags.filter(f => f.severity === "warn").length
        if (bad) list.push(chip(`${bad} serious flag${bad > 1 ? "s" : ""}`, "bad"))
        if (warn) list.push(chip(`${warn} warning${warn > 1 ? "s" : ""}`, "warn"))
        if (w.accountCreatedAt && hoursSince(w.accountCreatedAt) < 72) list.push(chip("new account", "warn"))
        return list.length ? list : [chip("none", "good")]
    }

    function discordOf(w) {
        const d = w.account?.discord
        if (!d?.linked) return chip("not linked", "bad")
        if (d.method === "oauth") return el("span", {}, chip(d.ok ? "member (checked)" : d.inGuild ? "check expired" : "not a member", d.ok ? "good" : "warn"), " ", d.username ?? "")
        return el("span", {}, chip("typed - check it", "warn"), " ", d.username ?? "")
    }

    function rowOf(w) {
        const a = w.account
        const pending = w.status === "pending"
        const statusChip = w.status === "paid" ? chip(`paid ${w.txnId ? "- " + w.txnId : ""}`, "good")
            : w.status === "rejected" ? chip(w.refunded ? "rejected, refunded" : "rejected, VOIDED", w.refunded ? "warn" : "bad") : null
        return el("tr", {},
            el("td", { class: "mono", text: fmtDateTime(w.createdAt) }),
            el("td", {}, el("b", { text: w.username }), el("div", { class: "muted", text: w.characterName ? `as ${w.characterName}` : "no character now" })),
            el("td", {}, el("b", { text: cad(w.amountCents) }), statusChip ? el("div", {}, statusChip) : null),
            el("td", {},
                el("div", {}, chip(w.method), " ", el("span", { class: "mono", text: w.paypal }), " ", copyButton(w.paypal)),
                el("div", { class: "muted" }, "name: ", el("b", { text: w.paypalName || "-" }))),
            el("td", {}, discordOf(w)),
            el("td", {},
                el("div", { text: a ? ageText(a.createdAt) : "-" }),
                a ? el("div", { class: "muted", text: `balance ${cad(a.wallet?.cents)} - earned ${cad(a.wallet?.earnedCents)} - ${fmtNum(a.wallet?.kills)} kills` }) : null),
            el("td", {}, warningsOf(w)),
            el("td", { class: "actions" },
                button("Details", () => openDetails(w), { small: true }),
                pending ? button("Mark paid...", () => openPaid(w), { small: true, kind: "primary" }) : null,
                pending ? button("Reject...", () => openReject(w), { small: true, kind: "danger" }) : null))
    }

    function openDetails(w) {
        const a = w.account
        const flags = a?.flags ?? []
        openModal({
            title: `${w.username} - ${cad(w.amountCents)}`,
            body: el("div", { class: "stack" },
                el("div", {}, el("label", { text: "Send to" }), el("div", { class: "mono", text: `${w.method}: ${w.paypal}` }), el("div", { text: `Name on PayPal: ${w.paypalName || "-"}` })),
                el("div", {}, el("label", { text: "Account" }), el("div", { text: a ? `${a.username}, ${ageText(a.createdAt)}${a.isGuest ? ", guest" : ""}${a.banned ? ", BANNED" : ""}${a.frozen ? ", frozen" : ""}` : "gone" })),
                el("div", {}, el("label", { text: "When they asked" }), el("div", { text: `${fmtDateTime(w.createdAt)} from ${w.ip || "?"}` }),
                    el("div", { class: "muted", text: `they had earned ${cad(w.walletAtRequest?.earnedCents)} over ${fmtNum(w.walletAtRequest?.kills)} kills (best ${cad(w.walletAtRequest?.best)}, ${fmtNum(w.walletAtRequest?.lucky)} lucky)` })),
                w.samePaypalOwners?.length ? el("div", {}, el("label", { text: "The same PayPal was asked for by" }), el("div", { class: "mono", text: w.samePaypalOwners.join(", ") }),
                    el("div", { class: "hint", text: "One person farming with several accounts often pays them all into one PayPal." })) : null,
                el("div", {}, el("label", { text: `Anti-cheat flags on the account (${flags.length})` }),
                    flags.length ? el("div", { class: "log", style: "height:auto;max-height:220px" }, flags.slice().reverse().map(f =>
                        el("div", { class: f.severity === "bad" ? "error" : f.severity === "warn" ? "warn" : "" }, el("span", { class: "time", text: fmtDateTime(f.t) }), `${f.kind}: ${f.detail}`)))
                        : el("div", { class: "muted", text: "none" })),
                w.reason ? el("div", {}, el("label", { text: "Rejected because" }), el("div", { text: w.reason })) : null,
                w.note ? el("div", {}, el("label", { text: "Your note" }), el("div", { text: w.note })) : null,
                el("div", { class: "row" },
                    button("Watch this player", () => { app.goto("watch", { owner: w.owner }) }, { small: true }),
                    a && !a.frozen ? button("Freeze earnings", () => app.run("accounts.freeze", { owner: w.owner, frozen: true, reason: "under review" }, "Frozen").then(refreshQueue), { small: true }) : null)),
            actions: [{ label: "Close", onclick: close => close() }],
        })
    }

    function openPaid(w) {
        const txn = el("input", { type: "text", maxlength: 80, placeholder: "e.g. 5TY05013RG002845M" })
        const note = el("input", { type: "text", maxlength: 500, placeholder: "Optional, only you see it" })
        openModal({
            title: `Mark ${cad(w.amountCents)} to ${w.username} as paid`,
            body: el("div", { class: "stack" },
                el("ol", { style: "margin:0;padding-left:20px;line-height:1.7" },
                    el("li", {}, "In PayPal, send ", el("b", { text: cad(w.amountCents) }), " to ", el("b", { class: "mono", text: w.paypal }), " ", copyButton(w.paypal)),
                    el("li", {}, "Before you confirm in PayPal, check the name it shows is ", el("b", { text: w.paypalName || "(none given)" }), "."),
                    el("li", {}, "Paste PayPal's transaction id here.")),
                field("PayPal transaction id", txn),
                field("Note", note)),
            actions: [{ label: "Cancel", onclick: close => close() }, { label: "Mark paid", kind: "primary", onclick: async close => {
                if (!txn.value.trim()) return toast("Paste the PayPal transaction id", "fail")
                if (await app.run("payouts.paid", { id: w._id, txnId: txn.value, note: note.value }, r => `${r.username}: ${cad(r.amountCents)} marked paid`)) { close(); refreshQueue(); refreshEconomy() }
            } }],
        })
    }

    function openReject(w) {
        const reason = el("input", { type: "text", maxlength: 300, placeholder: "They'll see this" })
        const note = el("input", { type: "text", maxlength: 500, placeholder: "Optional, only you see it" })
        const refund = el("input", { type: "radio", name: "rejectKind", checked: true })
        const voided = el("input", { type: "radio", name: "rejectKind" })
        openModal({
            title: `Reject ${w.username}'s ${cad(w.amountCents)}`,
            body: el("div", { class: "stack" },
                el("label", { class: "check" }, refund, "Refund - the money goes back to their balance (a mistake in the details, say)"),
                el("label", { class: "check" }, voided, "Void - the money is taken away for good (it was cheated)"),
                field("Reason", reason),
                field("Note", note)),
            actions: [{ label: "Cancel", onclick: close => close() }, { label: "Reject", kind: "danger", onclick: async close => {
                if (!reason.value.trim()) return toast("Say why - they'll see it", "fail")
                if (await app.run("payouts.reject", { id: w._id, reason: reason.value, refund: refund.checked, note: note.value }, r => `${r.username}: ${r.refunded ? "refunded" : "voided"}`)) { close(); refreshQueue(); refreshEconomy() }
            } }],
        })
    }

    async function refreshBanned() {
        clear(bannedBody).append(emptyRow(4, "Loading..."))
        let result
        try { result = await app.cmd("accounts.banned") } catch (error) { clear(bannedBody).append(emptyRow(4, error.message)); return }
        clear(bannedBody)
        const users = result.users ?? []
        if (!users.length) return bannedBody.append(emptyRow(4, "Nobody"))
        users.forEach(u => bannedBody.append(el("tr", {},
            el("td", {}, el("b", { text: u.username }), el("div", { class: "muted mono", text: u.owner })),
            el("td", {}, u.banned ? el("span", {}, chip("banned", "bad"), " ", u.bannedReason) : "-"),
            el("td", {}, u.frozen ? el("span", {}, chip("frozen", "warn"), " ", u.frozenReason) : "-"),
            el("td", { class: "actions" },
                u.banned ? button("Unban", async () => { if (await app.run("accounts.ban", { owner: u.owner, banned: false }, `${u.username} unbanned`)) refreshBanned() }, { small: true }) : null,
                u.frozen ? button("Unfreeze", async () => { if (await app.run("accounts.freeze", { owner: u.owner, frozen: false }, `${u.username} unfrozen`)) refreshBanned() }, { small: true }) : null))))
    }

    return {
        id: "payouts", title: "Payouts", root,
        onShow: () => { refreshEconomy(); refreshQueue(); refreshBanned() },
        badge: () => "",
    }
}
