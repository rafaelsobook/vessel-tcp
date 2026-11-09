"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leather = exports.cloth = exports.nail = void 0;
exports.rollSupplies = rollSupplies;
const tools_1 = require("../tools/tools");
// The everyday crafting materials the dungeons' common chests hold alongside
// whatever else is in them (treasuresInDungeon.ts) - nails (what the camp
// anvil is built from, client/src/components/campcraft.js), cloth and leather.
// Shapes copied from the client's staticRecources/resourceLoot.js (tcp can't
// import client code) - keep the two in step. Their icons are
// images/items/crafting/<name>.webp.
const material = (name, dn, pieces, desc) => (qnty) => ({
    itemId: (0, tools_1.randNumString)(),
    name,
    dn,
    itemCateg: "crafting",
    itemType: "material",
    qnty,
    price: { coinType: "bronze", pieces },
    desc,
    rarity: "common",
});
exports.nail = material("nail", "Nail", 1, "A hand-forged iron nail. Small, but nothing a smith builds holds together without them.");
exports.cloth = material("cloth", "Cloth", 5, "A bolt of coarse woven cloth, for bindings, wraps and padding.");
exports.leather = material("leather", "Leather", 6, "Tanned hide, supple enough to wrap a grip without slipping.");
const SUPPLIES = { nail: exports.nail, cloth: exports.cloth, leather: exports.leather };
// a whole number from min to max, both included
const roll = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
function rollSupplies(rolls) {
    return rolls
        .filter(([, , , chance = 1]) => Math.random() < chance)
        .map(([name, min, max]) => SUPPLIES[name](roll(min, max)));
}
