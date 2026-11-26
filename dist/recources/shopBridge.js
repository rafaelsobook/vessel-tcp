"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shopRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../admin/auth");
const tomeSupply_1 = require("./tomeSupply");
// THE VESSEL MARKET'S DOOR INTO THE LIMITED TOMES. The REST server (server/routes/shopR.js) sells High and
// Legendary tomes for real money; a Legendary one is a copy from tcp's limited pool (tomeSupply.ts), so it
// asks HERE - with the same key tcp sends it (x-admin-key) - instead of keeping a second count that could
// disagree. Not for browsers: nothing in the client calls it, and a wrong key locks the address out.
//   POST /internal/shop/left     { skills: [skillName] }          -> { left: { skill: n } } (null: count not loaded yet)
//   POST /internal/shop/sell     { skill, orderId }               -> { ok, reason? }       takes one copy
//   POST /internal/shop/release  { skill, orderId }               -> { ok }                gives it back
exports.shopRouter = (0, express_1.Router)();
exports.shopRouter.use((req, res, next) => {
    const ip = (0, auth_1.clientIp)({ headers: req.headers, address: req.socket.remoteAddress });
    if ((0, auth_1.lockedFor)(ip)) {
        res.status(429).json({ error: "too many wrong keys" });
        return;
    }
    if (!(0, auth_1.isValidKey)(req.headers["x-admin-key"])) {
        (0, auth_1.recordFailure)(ip);
        res.status(401).json({ error: "no" });
        return;
    }
    (0, auth_1.recordSuccess)(ip);
    next();
});
const skillOf = (value) => typeof value === "string" && /^[a-z]{2,40}$/.test(value) ? value : null;
const orderOf = (value) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value) ? value : null;
exports.shopRouter.post("/left", (req, res) => {
    const skills = (Array.isArray(req.body?.skills) ? req.body.skills : []).map(skillOf).filter(Boolean).slice(0, 60);
    res.json({ left: (0, tomeSupply_1.shopLeft)(skills) });
});
exports.shopRouter.post("/sell", (req, res) => {
    const skill = skillOf(req.body?.skill), orderId = orderOf(req.body?.orderId);
    if (!skill || !orderId) {
        res.status(400).json({ ok: false, reason: "bad request" });
        return;
    }
    res.json((0, tomeSupply_1.shopSell)(skill, orderId));
});
exports.shopRouter.post("/release", (req, res) => {
    const skill = skillOf(req.body?.skill), orderId = orderOf(req.body?.orderId);
    if (!skill || !orderId) {
        res.status(400).json({ ok: false, reason: "bad request" });
        return;
    }
    res.json((0, tomeSupply_1.shopRelease)(skill, orderId));
});
