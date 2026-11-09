"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recentLog = void 0;
exports.installLogTap = installLogTap;
exports.onLog = onLog;
const util_1 = __importDefault(require("util"));
const MAX_LINES = 400;
const MAX_TEXT = 500;
const lines = [];
let nextId = 1;
const listeners = new Set();
function formatArg(arg) {
    if (typeof arg === "string")
        return arg;
    if (arg instanceof Error)
        return arg.stack ?? arg.message;
    if (arg !== null && typeof arg === "object") {
        return util_1.default.inspect(arg, { depth: 1, maxArrayLength: 3, maxStringLength: 80, breakLength: Infinity });
    }
    return String(arg);
}
function record(level, args) {
    let text = args.map(formatArg).join(" ");
    if (text.length > MAX_TEXT)
        text = text.slice(0, MAX_TEXT) + " …";
    const line = { id: nextId++, t: Date.now(), level, text };
    lines.push(line);
    if (lines.length > MAX_LINES)
        lines.shift();
    listeners.forEach(listener => listener(line));
}
let installed = false;
function installLogTap() {
    if (installed)
        return;
    installed = true;
    const levels = [["log", "log"], ["info", "log"], ["warn", "warn"], ["error", "error"]];
    levels.forEach(([method, level]) => {
        const original = console[method].bind(console);
        console[method] = (...args) => {
            original(...args);
            // a failing listener must never break the server's own logging
            try {
                record(level, args);
            }
            catch { /* ignore */ }
        };
    });
}
const recentLog = () => lines.slice();
exports.recentLog = recentLog;
function onLog(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
installLogTap();
