import { Router } from "express"
import { isValidKey, lockedFor, recordFailure, recordSuccess, clientIp } from "../admin/auth"
import { shopLeft, shopSell, shopRelease } from "./tomeSupply"

// THE VESSEL MARKET'S DOOR INTO THE LIMITED TOMES. The REST server (server/routes/shopR.js) sells High and
// Legendary tomes for real money; a Legendary one is a copy from tcp's limited pool (tomeSupply.ts), so it
// asks HERE - with the same key tcp sends it (x-admin-key) - instead of keeping a second count that could
// disagree. Not for browsers: nothing in the client calls it, and a wrong key locks the address out.
//   POST /internal/shop/left     { skills: [skillName] }          -> { left: { skill: n } } (null: count not loaded yet)
//   POST /internal/shop/sell     { skill, orderId }               -> { ok, reason? }       takes one copy
//   POST /internal/shop/release  { skill, orderId }               -> { ok }                gives it back

export const shopRouter = Router()

shopRouter.use((req, res, next) => {
    const ip = clientIp({ headers: req.headers as any, address: req.socket.remoteAddress })
    if (lockedFor(ip)) { res.status(429).json({ error: "too many wrong keys" }); return }
    if (!isValidKey(req.headers["x-admin-key"])) { recordFailure(ip); res.status(401).json({ error: "no" }); return }
    recordSuccess(ip)
    next()
})

const skillOf = (value: unknown) => typeof value === "string" && /^[a-z]{2,40}$/.test(value) ? value : null
const orderOf = (value: unknown) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value) ? value : null

shopRouter.post("/left", (req, res) => {
    const skills = (Array.isArray(req.body?.skills) ? req.body.skills : []).map(skillOf).filter(Boolean).slice(0, 60) as string[]
    res.json({ left: shopLeft(skills) })
})

shopRouter.post("/sell", (req, res) => {
    const skill = skillOf(req.body?.skill), orderId = orderOf(req.body?.orderId)
    if (!skill || !orderId) { res.status(400).json({ ok: false, reason: "bad request" }); return }
    res.json(shopSell(skill, orderId))
})

shopRouter.post("/release", (req, res) => {
    const skill = skillOf(req.body?.skill), orderId = orderOf(req.body?.orderId)
    if (!skill || !orderId) { res.status(400).json({ ok: false, reason: "bad request" }); return }
    res.json(shopRelease(skill, orderId))
})
