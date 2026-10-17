import { cookableFood } from "./mushroomLibrary"

// Meat the beasts drop - the same cookable food as the dungeon's mushrooms
// (mushroomLibrary.ts's cookableFood): fine raw, better roasted over a
// bonfire, and roasting burns out what raw meat can give you.

// raw meat can turn - a mild poison, same shape as the venomous enemies' own
// (genenemy.ts), lifted by the same cures (lunaraqum's cure: ["poisoned"])
const TAINTED_MEAT = {
    effectType: "poisoned", chance: 25, permanent: true, dn: "Tainted Meat",
    hpcost: 6, spcost: 10, mpcost: 0, hungercost: 2, energycost: 0,
}

// the standing werewolves (genenemy.ts) - icon images/items/consumable/standingwolfmeat.webp
export const beastMeatLoot = cookableFood("standingwolfmeat", "Beast Meat", "normal", 8,
    "Dark, sinewy meat carved from a werewolf. It fills you up, but eaten raw it can turn your stomach.",
    { plusHp: 250, fillHunger: 35, inflict: [TAINTED_MEAT] })()
