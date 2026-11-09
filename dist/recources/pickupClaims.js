"use strict";
// PICKUP CLAIMS - picking something up takes a moment now (the client's
// components/timedPickup.js fills a bar over it first: a second or two for
// grain, a mushroom or a struck weapon, longer for a chest), and while one
// player's bar is filling nobody else can start on the same thing. Before its
// bar, a client asks index.ts's "claimPickup"; the answer is yes only if the
// thing is still there and nobody else holds it. The claim is let go when the
// pickup itself arrives (pickupGrain, removeTreasure...), when the client
// gives up early ("releasePickup"), when its player disconnects - or on its
// own once its time is up, in case none of those ever comes.
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimPickup = claimPickup;
exports.releasePickup = releasePickup;
exports.releaseClaimsOf = releaseClaimsOf;
const claims = new Map();
// a claim lasts as long as the client says its bar takes, plus this much slack
// for the pickup to arrive - and never longer than the cap
const CLAIM_SLACK_MS = 3000;
const MAX_CLAIM_MS = 20000;
const keyOf = (kind, id) => `${kind}:${id}`;
// true: it's owner's to pick up (newly, or already theirs). false: someone
// else is on it
function claimPickup(kind, id, owner, ms) {
    const key = keyOf(kind, id);
    const now = Date.now();
    const held = claims.get(key);
    if (held && held.owner !== owner && held.until > now)
        return false;
    const hold = Math.min(MAX_CLAIM_MS, Math.max(0, Number(ms) || 0) + CLAIM_SLACK_MS);
    claims.set(key, { owner, until: now + hold });
    return true;
}
// owner given: only if it's theirs (a client can't let go of someone else's)
function releasePickup(kind, id, owner) {
    const key = keyOf(kind, id);
    const held = claims.get(key);
    if (!held || (owner && held.owner !== owner))
        return;
    claims.delete(key);
}
function releaseClaimsOf(owner) {
    claims.forEach((held, key) => { if (held.owner === owner)
        claims.delete(key); });
}
