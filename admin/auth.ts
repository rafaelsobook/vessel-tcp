import crypto from "crypto"

// The admin key. It stays "rafadmin" - the same literal server/routes/questR.js
// already checks - unless ADMIN_KEY is set in the environment, so it can be
// changed later from the host's dashboard without touching code.
const ADMIN_KEY = process.env.ADMIN_KEY ?? "rafadmin"

const digest = (text: string) => crypto.createHash("sha256").update(text).digest()
const KEY_DIGEST = digest(ADMIN_KEY)

// compared as fixed-length digests in constant time, so the check doesn't leak
// how much of a guess was right
export function isValidKey(candidate: unknown): boolean {
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 200) return false
    return crypto.timingSafeEqual(digest(candidate), KEY_DIGEST)
}

// what tcp sends the REST server (server/routes/adminR.js) in x-admin-key
export const adminKeyForServices = () => ADMIN_KEY

// ── guessing protection ──────────────────────────────────────────────────────
// A short, guessable key is only safe if guessing is slow: a few wrong tries
// from one address lock that address out for a while.
const MAX_FAILURES = 5
const LOCK_MS = 10 * 60 * 1000
const failures = new Map<string, { count: number, lockedUntil: number }>()

// ms left on this address's lockout, 0 when it may try
export function lockedFor(ip: string): number {
    const entry = failures.get(ip)
    if (!entry || entry.lockedUntil <= Date.now()) return 0
    return entry.lockedUntil - Date.now()
}

export function recordFailure(ip: string) {
    const entry = failures.get(ip) ?? { count: 0, lockedUntil: 0 }
    // a lockout that ran out starts the count over
    if (entry.lockedUntil && entry.lockedUntil <= Date.now()) { entry.count = 0; entry.lockedUntil = 0 }
    entry.count++
    if (entry.count >= MAX_FAILURES) entry.lockedUntil = Date.now() + LOCK_MS
    failures.set(ip, entry)
}

export function recordSuccess(ip: string) {
    failures.delete(ip)
}

// stale entries don't pile up
setInterval(() => {
    const now = Date.now()
    failures.forEach((entry, ip) => {
        if (entry.lockedUntil <= now && entry.count < MAX_FAILURES) failures.delete(ip)
    })
}, LOCK_MS).unref()

// The real client address. Behind the host's proxy (Render, Fly) the socket's
// own address is the proxy's, and the client comes in x-forwarded-for.
export function clientIp(handshake: { headers: Record<string, any>, address?: string }): string {
    const forwarded = handshake.headers["x-forwarded-for"]
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim()
    return first || handshake.address || "unknown"
}
