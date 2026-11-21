"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOME_RANK = exports.TOME_SKILLS = void 0;
exports.setTomeAvailability = setTomeAvailability;
exports.tomeItem = tomeItem;
exports.tomeOfRank = tomeOfRank;
const tools_1 = require("../tools/tools");
// [the client's skillsData.js name, its displayName, its skillrank] - EVERY skill above Elite: with the
// shelves stopping at Elite, a skill missing here could never be had (keep in step with skillsData.js)
exports.TOME_SKILLS = [
    ["thunderstrike", "Thunderstrike", 2], ["lightpierce", "Lightpierce", 2], ["radiantjudgment", "Radiant Judgment", 2],
    ["shadowbolt", "Shadowbolt", 2], ["voidrend", "Voidrend", 2], ["pyroclasm", "Pyroclasm", 2],
    ["solarcataclysm", "Solar Cataclysm", 2], ["tsunamiwrath", "Tsunami Wrath", 2], ["abyssalcurrent", "Abyssal Current", 2],
    ["continentalrend", "Continental Rend", 2], ["seismicjudgment", "Seismic Judgment", 2], ["celestialverdict", "Celestial Verdict", 2],
    ["seraphicascension", "Seraphic Ascension", 2], ["voidcurse", "Void Curse", 2], ["abyssaldamnation", "Abyssal Damnation", 2],
    ["zoltraak", "Zoltraak", 2], ["glacialprison", "Glacial Prison", 2], ["gravityslam", "Gravity Slam", 2],
    ["soulwisps", "Soul Wisps", 2], ["bloodrite", "Blood Rite", 2], ["thornsnare", "Thorn Snare", 2], ["cyclone", "Cyclone", 2],
    ["burstshots", "Burst Shots", 3], ["disintegration", "Disintegration", 3], ["mjolnir", "Mjolnir", 3],
    ["wellspring", "Wellspring", 3], ["purification", "Purification", 3], ["crescenthowl", "Crescent Howl", 3],
    ["shadowlegion", "Shadow Legion", 3], ["chainsofdawn", "Chains of Dawn", 3], ["stormwyrm", "Storm Wyrm", 3],
    ["mirrorveil", "Mirror Veil", 3], ["sanctum", "Sanctum of Ruin", 3],
    ["astralrain", "Astral Rain", 4], ["darkorb", "Dark Orb", 4], ["multicast", "Multicast", 4],
    ["massivedisintegration", "Massive Disintegration", 4], ["meteor", "Meteor", 4], ["thunderclap", "Thunderclap", 4],
    ["singularity", "Singularity", 4], ["zerohour", "Zero Hour", 4],
];
// a printing's rarity rides on the skill's rank (rare: 2, epic: 3, legendary: 4); a rank-4 one can turn up mythic
exports.TOME_RANK = { rare: 2, epic: 3, legendary: 4, mythic: 4 };
// the client's skillBooks.js SKILLBOOK_PRICE_BY_RANK, and a mythic printing above it
const TOME_PRICE = { rare: 220, epic: 500, legendary: 1100, mythic: 1600 };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// which skills a chest may still roll - tomeSupply.ts says (Legendary and God tier ones run out)
let available = () => true;
function setTomeAvailability(fn) { available = fn; }
const STEP_DOWN = { mythic: "legendary", legendary: "epic", epic: "rare", rare: null };
function tomeItem(rarity) {
    const pool = exports.TOME_SKILLS.filter(([name, , rank]) => rank === exports.TOME_RANK[rarity] && available(name));
    // every copy of this rank found: the rank below (High never runs out)
    if (!pool.length)
        return STEP_DOWN[rarity] ? tomeItem(STEP_DOWN[rarity]) : tomeItem("rare");
    const [skillName, displayName] = pick(pool);
    return {
        itemId: (0, tools_1.randNumString)(),
        // the skill's own name, as every skill book's (it stacks with its copies)
        name: skillName,
        skillName,
        dn: `Tome of ${displayName}`,
        itemCateg: "skillbook",
        itemType: "skillbook",
        price: { coinType: "bronze", pieces: TOME_PRICE[rarity] },
        qnty: 1,
        rarity,
    };
}
/** A tome of a skill of this rank (2 High, 3 Legendary, 4 God) - a god tier one mythic now and then. */
function tomeOfRank(rank, mythicChance = 0.15) {
    const rarity = rank === 2 ? "rare" : rank === 3 ? "epic" : Math.random() < mythicChance ? "mythic" : "legendary";
    return tomeItem(rarity);
}
