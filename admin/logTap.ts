import util from "util"

// A copy of everything the server prints, kept for the admin page's live log.
// index.ts imports this first of all: it takes `const log = console.log` at
// the top of its own body, so the tap has to be in place before that line runs.
// What's printed is unchanged - the original function is called first, and the
// copy is cut short so a dumped object (join-world prints the whole players
// list) can't fill the buffer.

export type LogLine = { id: number, t: number, level: "log" | "warn" | "error", text: string }

const MAX_LINES = 400
const MAX_TEXT = 500
const lines: LogLine[] = []
let nextId = 1
const listeners = new Set<(line: LogLine) => void>()

function formatArg(arg: unknown): string {
    if (typeof arg === "string") return arg
    if (arg instanceof Error) return arg.stack ?? arg.message
    if (arg !== null && typeof arg === "object") {
        return util.inspect(arg, { depth: 1, maxArrayLength: 3, maxStringLength: 80, breakLength: Infinity })
    }
    return String(arg)
}

function record(level: LogLine["level"], args: unknown[]) {
    let text = args.map(formatArg).join(" ")
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + " …"
    const line: LogLine = { id: nextId++, t: Date.now(), level, text }
    lines.push(line)
    if (lines.length > MAX_LINES) lines.shift()
    listeners.forEach(listener => listener(line))
}

let installed = false
export function installLogTap() {
    if (installed) return
    installed = true
    const levels: [keyof Console, LogLine["level"]][] = [["log", "log"], ["info", "log"], ["warn", "warn"], ["error", "error"]]
    levels.forEach(([method, level]) => {
        const original = (console as any)[method].bind(console)
        ;(console as any)[method] = (...args: unknown[]) => {
            original(...args)
            // a failing listener must never break the server's own logging
            try { record(level, args) } catch { /* ignore */ }
        }
    })
}

export const recentLog = () => lines.slice()

export function onLog(listener: (line: LogLine) => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

installLogTap()
