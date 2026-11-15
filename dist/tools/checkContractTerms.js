"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/// <reference types="node" />
// Checks the guild board's fair-pay rules (recources/quests.ts, "WHAT A
// CONTRACT PAYS AND COSTS"). Run after changing any contract terms:
//   npx ts-node tools/checkContractTerms.ts
// Prints the table and exits 1 if a rule is broken.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const quests_1 = require("../recources/quests");
const botItems_1 = require("../recources/botItems");
const RANKS = Object.keys(quests_1.RANK_TERMS);
const LADDER = Object.keys(botItems_1.METAL_TIERS);
const failures = [];
const check = (ok, msg) => { if (!ok)
    failures.push(msg); };
// the metal a rank first pays in - the ladder's promise, spelled out
const FIRST_RANK_OF_METAL = {
    iron: "f", bronze: "f", steel: "e", silver: "d", gold: "c", ruby: "b", mythril: "a", adamantine: "a", dragonscale: "s", black: "s",
};
const avgMetalMult = (rank) => {
    const metals = Object.entries(quests_1.RANK_TERMS[rank].metals);
    const total = metals.reduce((sum, [, w]) => sum + w, 0);
    return metals.reduce((sum, [m, w]) => sum + botItems_1.METAL_TIERS[m].priceMult * w / total, 0);
};
const rows = RANKS.map(rank => {
    const worth = (0, quests_1.contractWorth)(rank);
    const fee = quests_1.RANK_FEES[rank];
    const idx = Object.keys(quests_1.RANK_TERMS[rank].metals).map(m => LADDER.indexOf(m)).sort((a, b) => a - b);
    return { rank, coins: quests_1.RANK_TERMS[rank].coins, gearChance: quests_1.RANK_TERMS[rank].gearChance, metalMult: avgMetalMult(rank),
        gear: (0, quests_1.avgGearWorth)(rank), worth, fee, keep: worth - fee, lo: idx[0], hi: idx[idx.length - 1], idx };
});
rows.forEach((r, i) => {
    const R = r.rank.toUpperCase();
    // rule 2: a band of neighbouring metals, at most three wide
    check(r.idx.every(x => x >= 0), `${R}: a metal not on METAL_TIERS`);
    check(r.hi - r.lo + 1 === r.idx.length, `${R}: metals aren't neighbours on the ladder`);
    check(r.idx.length <= 3, `${R}: more than three metals`);
    for (const m of Object.keys(quests_1.RANK_TERMS[r.rank].metals)) {
        check(RANKS.indexOf(r.rank) >= RANKS.indexOf(FIRST_RANK_OF_METAL[m]), `${R}: pays ${m}, which starts at ${FIRST_RANK_OF_METAL[m].toUpperCase()}`);
    }
    // rule 3: the fee is a fair share, never near the pay
    check(r.fee / r.worth <= 0.25, `${R}: fee is ${(100 * r.fee / r.worth).toFixed(0)}% of the worth`);
    check(r.fee < r.coins, `${R}: fee ${r.fee} >= the bronze it pays`);
    if (i === 0)
        return;
    const p = rows[i - 1];
    // rule 1: everything climbs, strictly
    for (const key of ["coins", "gearChance", "metalMult", "gear", "worth", "fee", "keep"]) {
        check(r[key] > p[key], `${R} ${key} ${r[key]} isn't above ${p.rank.toUpperCase()}'s ${p[key]}`);
    }
    check(r.lo >= p.lo && r.hi > p.hi, `${R}: metal band doesn't move up from ${p.rank.toUpperCase()}'s`);
});
// the real thing: roll contracts and check every one
for (const rank of RANKS) {
    const metals = Object.keys(quests_1.RANK_TERMS[rank].metals);
    for (let n = 0; n < 3000; n++) {
        const c = (0, quests_1.createContract)(rank, { x: 0, y: 0, z: 0 });
        if (!c)
            break; // a rank with no contract kinds yet (S)
        check(c.price.pieces === quests_1.RANK_FEES[rank], `${rank} contract costs ${c.price.pieces}, not ${quests_1.RANK_FEES[rank]}`);
        check(c.reward.rewardCoin === quests_1.RANK_TERMS[rank].coins && c.reward.receiveRewardType === "bronze", `${rank} contract pays ${c.reward.rewardCoin} ${c.reward.receiveRewardType}`);
        check(c.reward.rewardItems.length === 2, `${rank} contract has ${c.reward.rewardItems.length} items`);
        for (const item of c.reward.rewardItems) {
            if (item.metalColor)
                check(metals.includes(item.metalColor), `${rank} contract rolled ${item.metalColor} ${item.dn}`);
        }
    }
}
// who may take what: your rank, anything below, and CONTRACT_RANKS_ABOVE above;
// unranked (undefined, or junk) counts as F
for (const mine of [undefined, "", "none", ...RANKS]) {
    const myIdx = Math.max(0, RANKS.indexOf(mine));
    for (const rank of RANKS) {
        const expected = RANKS.indexOf(rank) <= myIdx + quests_1.CONTRACT_RANKS_ABOVE;
        check((0, quests_1.canTakeContract)(mine, rank) === expected, `rank ${mine ?? "none"} ${expected ? "can't" : "can"} take a ${rank} contract`);
    }
}
check((0, quests_1.canTakeContract)("f", "e") && !(0, quests_1.canTakeContract)("f", "d") && (0, quests_1.canTakeContract)("a", "s") && (0, quests_1.canTakeContract)("s", "f"), "spot checks of canTakeContract");
// rank points climb with the contract's rank, so harder work ranks you faster
const pointsOf = (rank) => (0, quests_1.createContract)(rank, { x: 0, y: 0, z: 0 })?.rankPoints;
RANKS.forEach((rank, i) => {
    if (i && pointsOf(rank) !== undefined)
        check(pointsOf(rank) > pointsOf(RANKS[i - 1]), `${rank} contracts don't give more rank points than ${RANKS[i - 1]}`);
});
// the pace, for the record: the client's evaluateRank curve (12 to leave F, x1.5
// a rank after), taking the highest contract you may
let toNext = 12;
const pace = RANKS.slice(0, -1).map((rank, i) => {
    // the highest rank you may take that has contracts at all (S has none yet)
    const best = RANKS.slice(0, i + quests_1.CONTRACT_RANKS_ABOVE + 1).filter(r => pointsOf(r) !== undefined).pop();
    const pts = pointsOf(best);
    const row = { from: rank.toUpperCase(), to: RANKS[i + 1].toUpperCase(), pointsNeeded: toNext, bestContract: best.toUpperCase(), contracts: Math.ceil(toNext / pts) };
    toNext = Math.floor(toNext * 1.5);
    return row;
});
// the side stories are scaled by the same bronze (client/src/sidestories/worth.js GUILD_PAY)
const worthJs = path.join(__dirname, "../../client/src/sidestories/worth.js");
if (fs.existsSync(worthJs)) {
    const m = fs.readFileSync(worthJs, "utf8").match(/GUILD_PAY\s*=\s*\{([^}]*)\}/);
    const pay = Object.fromEntries((m?.[1] ?? "").split(",").map(s => s.split(":").map(t => t.trim())).filter(kv => kv.length === 2).map(([k, v]) => [k, Number(v)]));
    for (const rank of RANKS)
        check(pay[rank] === quests_1.RANK_TERMS[rank].coins, `worth.js GUILD_PAY.${rank} is ${pay[rank]}, the board pays ${quests_1.RANK_TERMS[rank].coins}`);
}
console.table(rows.map(r => ({
    rank: r.rank.toUpperCase(), bronze: r.coins, gearOdds: `${Math.round(r.gearChance * 100)}%`,
    metals: Object.entries(quests_1.RANK_TERMS[r.rank].metals).map(([m, w]) => `${m} ${w}`).join(", "),
    avgGear: Math.round(r.gear), worth: Math.round(r.worth), feeShare: `${((0, quests_1.feeShare)(r.rank) * 100).toFixed(1)}%`, fee: r.fee, youKeep: Math.round(r.keep),
})));
console.log("\nrank pace (taking the highest contract you may):");
console.table(pace);
if (failures.length) {
    console.log(`\n${failures.length} rule(s) broken:\n - ${failures.join("\n - ")}`);
    process.exit(1);
}
console.log("\nall contract rules hold");
