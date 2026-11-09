"use strict";
// Every change an admin makes, newest last - what was done, from where, and
// whether it worked. Kept in memory (the last MAX_ENTRIES) and printed on the
// server log as it happens, so the host's own log has the full history.
Object.defineProperty(exports, "__esModule", { value: true });
exports.recentAudit = void 0;
exports.audit = audit;
exports.onAudit = onAudit;
const MAX_ENTRIES = 500;
const entries = [];
let nextId = 1;
const listeners = new Set();
function audit(entry) {
    const full = { id: nextId++, t: Date.now(), ...entry };
    entries.push(full);
    if (entries.length > MAX_ENTRIES)
        entries.shift();
    console.log(`[admin] ${full.ip} ${full.action}${full.detail ? " " + full.detail : ""} -> ${full.ok ? "ok" : "FAILED: " + full.error}`);
    listeners.forEach(listener => listener(full));
    return full;
}
const recentAudit = () => entries.slice();
exports.recentAudit = recentAudit;
function onAudit(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
