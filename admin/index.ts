import fs from "fs"
import path from "path"
import express from "express"
import type { Express } from "express"
import type { Server, Socket } from "socket.io"
import { AdminWorld, AdminContext, AdminError } from "./types"
import { isValidKey, lockedFor, recordFailure, recordSuccess, clientIp } from "./auth"
import { audit, recentAudit, onAudit } from "./audit"
import { recentLog, onLog, LogLine } from "./logTap"
import { COMMANDS, restoreOverlay } from "./commands"
import { buildSnapshot } from "./snapshot"
import { store } from "./persistence"

// The master control: a page at /admin and a socket.io namespace of the same
// name behind it. The page itself is public - all it shows without the key is
// a login box - and everything that matters happens over the socket, which
// refuses any connection that doesn't present the admin key (auth.ts) and then
// runs commands (commands.ts) against the live world. index.ts hands in the
// world through getters and setters, because it reassigns its own state.

const SNAPSHOT_EVERY_MS = 2000
const LOG_FLUSH_EVERY_MS = 600
// per connection: a runaway page can't flood the server
const COMMAND_BURST = 40
const COMMAND_WINDOW_MS = 5000

// the page lives in admin/public: next to this file when run with ts-node,
// two levels up from dist/admin when run compiled
function publicDir(): string | null {
    const candidates = [path.join(__dirname, "public"), path.join(__dirname, "..", "..", "admin", "public")]
    return candidates.find(dir => fs.existsSync(path.join(dir, "index.html"))) ?? null
}

export function setupAdmin({ app, io, world }: { app: Express, io: Server, world: AdminWorld }) {
    // ── the page ─────────────────────────────────────────────────────────────
    const dir = publicDir()
    if (dir) {
        app.use("/admin", (req, res, next) => {
            res.setHeader("Cache-Control", "no-store")
            res.setHeader("X-Robots-Tag", "noindex, nofollow")
            res.setHeader("X-Frame-Options", "DENY")
            res.setHeader("X-Content-Type-Options", "nosniff")
            res.setHeader("Referrer-Policy", "no-referrer")
            // nothing inline but styles: a stray <script> in a player's name can't run here
            res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'")
            next()
        })
        app.use("/admin", express.static(dir, { index: "index.html" }))
    } else {
        console.warn("[admin] the admin page (admin/public) wasn't found - the namespace still runs, the page won't open")
    }

    // ── the socket ───────────────────────────────────────────────────────────
    const ns = io.of("/admin")

    ns.use((socket, next) => {
        const ip = clientIp(socket.handshake)
        const wait = lockedFor(ip)
        if (wait > 0) return next(new Error(`locked:${Math.ceil(wait / 1000)}`))
        if (!isValidKey(socket.handshake.auth?.key)) {
            recordFailure(ip)
            audit({ ip, action: "login", detail: "wrong key", ok: false, error: "denied" })
            return next(new Error("denied"))
        }
        recordSuccess(ip)
        next()
    })

    ns.on("connection", (socket: Socket) => {
        const ip = clientIp(socket.handshake)
        audit({ ip, action: "login", detail: "", ok: true })
        const ctx: AdminContext = { world, io, ip }

        socket.emit("hello", {
            snapshot: buildSnapshot(world, ns.sockets.size),
            audit: recentAudit(),
            log: recentLog(),
        })

        let recent: number[] = []
        socket.on("cmd", async (name: unknown, payload: unknown, ack?: (reply: unknown) => void) => {
            const reply = typeof ack === "function" ? ack : () => {}
            const command = typeof name === "string" && Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : null
            if (!command) return reply({ ok: false, error: "unknown command" })

            const now = Date.now()
            recent = recent.filter(t => now - t < COMMAND_WINDOW_MS)
            if (recent.length >= COMMAND_BURST) return reply({ ok: false, error: "slow down - too many commands at once" })
            recent.push(now)

            const data = payload && typeof payload === "object" ? payload as any : {}
            try {
                const result = await command.run(ctx, data)
                if (command.audit) audit({ ip, action: name as string, detail: command.describe?.(data, result) ?? "", ok: true })
                reply({ ok: true, result })
            } catch (error: any) {
                const known = error instanceof AdminError
                if (command.audit) audit({ ip, action: name as string, detail: "", ok: false, error: known ? error.message : `server error: ${error?.message}` })
                if (!known) console.error(`[admin] ${name} threw:`, error)
                reply({ ok: false, error: known ? error.message : "something went wrong on the server - see the log" })
            }
        })
    })

    // ── what's pushed to every open admin page ───────────────────────────────
    setInterval(() => {
        if (ns.sockets.size) ns.emit("snapshot", buildSnapshot(world, ns.sockets.size))
    }, SNAPSHOT_EVERY_MS)

    onAudit(entry => { if (ns.sockets.size) ns.emit("audit", entry) })

    // log lines go out in small batches, not one message per line
    let pendingLines: LogLine[] = []
    onLog(line => { if (ns.sockets.size) pendingLines.push(line) })
    setInterval(() => {
        if (!pendingLines.length) return
        const lines = pendingLines.slice(-100)
        pendingLines = []
        if (ns.sockets.size) ns.emit("log", lines)
    }, LOG_FLUSH_EVERY_MS)

    // ── saved placements ─────────────────────────────────────────────────────
    store.start(saved => restoreOverlay({ world, io, ip: "startup" }, saved))

    console.log(`[admin] master control ready at /admin${dir ? "" : " (no page)"}`)
}
