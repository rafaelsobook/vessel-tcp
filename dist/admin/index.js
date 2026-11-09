"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAdmin = setupAdmin;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const types_1 = require("./types");
const auth_1 = require("./auth");
const audit_1 = require("./audit");
const logTap_1 = require("./logTap");
const commands_1 = require("./commands");
const snapshot_1 = require("./snapshot");
const persistence_1 = require("./persistence");
// The master control: a page at /admin and a socket.io namespace of the same
// name behind it. The page itself is public - all it shows without the key is
// a login box - and everything that matters happens over the socket, which
// refuses any connection that doesn't present the admin key (auth.ts) and then
// runs commands (commands.ts) against the live world. index.ts hands in the
// world through getters and setters, because it reassigns its own state.
const SNAPSHOT_EVERY_MS = 2000;
const LOG_FLUSH_EVERY_MS = 600;
// per connection: a runaway page can't flood the server
const COMMAND_BURST = 40;
const COMMAND_WINDOW_MS = 5000;
// the page lives in admin/public: next to this file when run with ts-node,
// two levels up from dist/admin when run compiled
function publicDir() {
    const candidates = [path_1.default.join(__dirname, "public"), path_1.default.join(__dirname, "..", "..", "admin", "public")];
    return candidates.find(dir => fs_1.default.existsSync(path_1.default.join(dir, "index.html"))) ?? null;
}
function setupAdmin({ app, io, world }) {
    // ── the page ─────────────────────────────────────────────────────────────
    const dir = publicDir();
    if (dir) {
        app.use("/admin", (req, res, next) => {
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("X-Robots-Tag", "noindex, nofollow");
            res.setHeader("X-Frame-Options", "DENY");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Referrer-Policy", "no-referrer");
            // nothing inline but styles: a stray <script> in a player's name can't run here
            res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'");
            next();
        });
        app.use("/admin", express_1.default.static(dir, { index: "index.html" }));
    }
    else {
        console.warn("[admin] the admin page (admin/public) wasn't found - the namespace still runs, the page won't open");
    }
    // ── the socket ───────────────────────────────────────────────────────────
    const ns = io.of("/admin");
    ns.use((socket, next) => {
        const ip = (0, auth_1.clientIp)(socket.handshake);
        const wait = (0, auth_1.lockedFor)(ip);
        if (wait > 0)
            return next(new Error(`locked:${Math.ceil(wait / 1000)}`));
        if (!(0, auth_1.isValidKey)(socket.handshake.auth?.key)) {
            (0, auth_1.recordFailure)(ip);
            (0, audit_1.audit)({ ip, action: "login", detail: "wrong key", ok: false, error: "denied" });
            return next(new Error("denied"));
        }
        (0, auth_1.recordSuccess)(ip);
        next();
    });
    ns.on("connection", (socket) => {
        const ip = (0, auth_1.clientIp)(socket.handshake);
        (0, audit_1.audit)({ ip, action: "login", detail: "", ok: true });
        const ctx = { world, io, ip };
        socket.emit("hello", {
            snapshot: (0, snapshot_1.buildSnapshot)(world, ns.sockets.size),
            audit: (0, audit_1.recentAudit)(),
            log: (0, logTap_1.recentLog)(),
        });
        let recent = [];
        socket.on("cmd", async (name, payload, ack) => {
            const reply = typeof ack === "function" ? ack : () => { };
            const command = typeof name === "string" && Object.prototype.hasOwnProperty.call(commands_1.COMMANDS, name) ? commands_1.COMMANDS[name] : null;
            if (!command)
                return reply({ ok: false, error: "unknown command" });
            const now = Date.now();
            recent = recent.filter(t => now - t < COMMAND_WINDOW_MS);
            if (recent.length >= COMMAND_BURST)
                return reply({ ok: false, error: "slow down - too many commands at once" });
            recent.push(now);
            const data = payload && typeof payload === "object" ? payload : {};
            try {
                const result = await command.run(ctx, data);
                if (command.audit)
                    (0, audit_1.audit)({ ip, action: name, detail: command.describe?.(data, result) ?? "", ok: true });
                reply({ ok: true, result });
            }
            catch (error) {
                const known = error instanceof types_1.AdminError;
                if (command.audit)
                    (0, audit_1.audit)({ ip, action: name, detail: "", ok: false, error: known ? error.message : `server error: ${error?.message}` });
                if (!known)
                    console.error(`[admin] ${name} threw:`, error);
                reply({ ok: false, error: known ? error.message : "something went wrong on the server - see the log" });
            }
        });
    });
    // ── what's pushed to every open admin page ───────────────────────────────
    setInterval(() => {
        if (ns.sockets.size)
            ns.emit("snapshot", (0, snapshot_1.buildSnapshot)(world, ns.sockets.size));
    }, SNAPSHOT_EVERY_MS);
    (0, audit_1.onAudit)(entry => { if (ns.sockets.size)
        ns.emit("audit", entry); });
    // log lines go out in small batches, not one message per line
    let pendingLines = [];
    (0, logTap_1.onLog)(line => { if (ns.sockets.size)
        pendingLines.push(line); });
    setInterval(() => {
        if (!pendingLines.length)
            return;
        const lines = pendingLines.slice(-100);
        pendingLines = [];
        if (ns.sockets.size)
            ns.emit("log", lines);
    }, LOG_FLUSH_EVERY_MS);
    // ── saved placements ─────────────────────────────────────────────────────
    persistence_1.store.start(saved => (0, commands_1.restoreOverlay)({ world, io, ip: "startup" }, saved));
    console.log(`[admin] master control ready at /admin${dir ? "" : " (no page)"}`);
}
