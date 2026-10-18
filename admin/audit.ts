// Every change an admin makes, newest last - what was done, from where, and
// whether it worked. Kept in memory (the last MAX_ENTRIES) and printed on the
// server log as it happens, so the host's own log has the full history.

export type AuditEntry = {
    id: number
    t: number
    ip: string
    action: string
    detail: string
    ok: boolean
    error?: string
}

const MAX_ENTRIES = 500
const entries: AuditEntry[] = []
let nextId = 1
const listeners = new Set<(entry: AuditEntry) => void>()

export function audit(entry: Omit<AuditEntry, "id" | "t">): AuditEntry {
    const full: AuditEntry = { id: nextId++, t: Date.now(), ...entry }
    entries.push(full)
    if (entries.length > MAX_ENTRIES) entries.shift()
    console.log(`[admin] ${full.ip} ${full.action}${full.detail ? " " + full.detail : ""} -> ${full.ok ? "ok" : "FAILED: " + full.error}`)
    listeners.forEach(listener => listener(full))
    return full
}

export const recentAudit = () => entries.slice()

export function onAudit(listener: (entry: AuditEntry) => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}
