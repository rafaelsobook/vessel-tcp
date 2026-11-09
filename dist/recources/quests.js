"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createContract = createContract;
const tools_1 = require("../tools/tools");
const botItems_1 = require("./botItems");
// ============================================================
// GUILD BOARD CONTRACTS
// ============================================================
// The guild hall has two boards (client/public/models/indors/guildboard.glb,
// placed by the client's constants/places/guildHall.js): guildboard1 carries
// the F, E and D contracts, guildboard2 - right of it - the C, B, A and S ones.
// A contract's `board` says which one its marker hangs on, `pos` where on it.
// the client's characterstate.js rankOrder - a rank's number is its index
const RANK_ORDER = ["f", "e", "d", "c", "b", "a", "s"];
// Each board's paper area, in the board's local space - x is the paper's
// surface (the marker sits just in front of it), y up, z across. guildboard1
// is 3.78 tall and 4.99 wide (Z -2.495 to 2.495), guildboard2 4.68 tall and
// 5.41 wide (Z -2.706 to 2.706) - read from the glb's POSITION accessors. These
// trim off each board's frame, pillars, arch and bottom ledge. Their paper
// (raycast in the guild hall) is at x 0.13 on guildboard1 and 0.00 on
// guildboard2, under an arch from y 3 and between pillars from z +-2.1.
const BOARDS = {
    guildboard1: { yMin: 0.5, yMax: 2.6, zMin: -2.1, zMax: 2.1, x: -0.01 },
    guildboard2: { yMin: 0.8, yMax: 2.85, zMin: -1.85, zMax: 1.85, x: -0.04 },
};
// The ranks of the contracts on each board, one entry per marker - 10 on the
// first board, 8 on the second. A finished contract is replaced by a new one of
// the same rank in the same spot (index.ts's emitCompleteQuest), so this mix
// holds for as long as the server runs.
const BOARD_SLOTS = {
    guildboard1: ["f", "f", "f", "f", "e", "e", "e", "e", "d", "d"],
    guildboard2: ["c", "c", "c", "b", "b", "b", "a", "a"],
};
function boardOfRank(rank) {
    return RANK_ORDER.indexOf(rank) <= RANK_ORDER.indexOf("d") ? "guildboard1" : "guildboard2";
}
const CONTRACT_KINDS = [
    // F - water slimes, 100-150 from the village
    { rank: "f", names: ["waterslime"], image: "slime", targetDn: "Water Slime", requiredNum: 2,
        qTtle: "Hunt Water Slimes",
        desc: "These pesky water slimes are all over town and keep on coming. We need someone to get rid of them." },
    // E - fire slimes 150-450, electric slimes 450-850, orangeliths 850-950
    { rank: "e", names: ["fireslime"], image: "slime", targetDn: "Fire Slime", requiredNum: 3,
        qTtle: "Hunt Fire Slimes",
        desc: "Fire slimes have been scorching the fields past the village. Put them out before they burn the harvest." },
    { rank: "e", names: ["electricslime"], image: "slime", targetDn: "Electric Slime", requiredNum: 3,
        qTtle: "Hunt Electric Slimes",
        desc: "Electric slimes are crackling through the far plains, and no traveller wants to cross them. Clear them out." },
    { rank: "e", names: ["orangelith"], image: "monolith", targetDn: "Orangelith", requiredNum: 2,
        qTtle: "Topple the Orangeliths",
        desc: "Living stone has been seen walking the ridge beyond the plains. Orangeliths are slow but they hit like a landslide. Bring two of them down." },
    // D - dark slimes, 950-2000
    { rank: "d", names: ["darkslime"], image: "slime", targetDn: "Dark Slime", requiredNum: 3,
        qTtle: "Purge the Dark Slimes",
        desc: "Dark slimes are oozing out of the deep wilds, and the ground they cross turns sour. Purge them before the rot spreads." },
    // C - ghosts in the graveyards and dungeons; deer (any coat) 2000-2600
    { rank: "c", names: ["ghost"], image: "ghost", targetDn: "Ghost", requiredNum: 3,
        qTtle: "Lay the Restless Dead",
        desc: "The graveyards won't stay quiet. Ghosts have been seen drifting between the stones at night - put them to rest." },
    { rank: "c", names: ["forestdeer", "jasferdeer", "luminadeer", "nightmaredeer", "scorchdeer", "wisfdeer"], image: "fantasydeer", targetDn: "Wild Deer", requiredNum: 2,
        qTtle: "Cull the Wild Herd",
        desc: "The wild deer of the far forest are no ordinary game - they bite back. A trader's caravan wants the herd thinned before it passes." },
    // B - stray wolves 2600-3400; scorpions in the dungeons (the ice
    // scorpion is the giant scorpion's dungeon variant - the plain one isn't
    // spawned anywhere yet, so the contract takes either)
    { rank: "b", names: ["straywolf"], image: "straywolf", targetDn: "Stray Wolf", requiredNum: 3,
        qTtle: "Break the Wolf Pack",
        desc: "Stray wolves are hunting in packs at the edge of the world, and they've started following travellers home. Break the pack." },
    { rank: "b", names: ["giantscorpion", "icescorpion"], image: "giantscorpion", targetDn: "Giant Scorpion", requiredNum: 2,
        qTtle: "Giant Scorpions Below",
        desc: "Delvers keep coming back from the dungeons with frostbitten stings - or not coming back at all. Kill the giant scorpions down there." },
    // A - the four standing wolves, one named elite each
    { rank: "a", names: ["vargoth", "zareth", "morvane", "skallgrim"], image: "standingwolf", targetDn: "Standing Wolf", requiredNum: 1,
        qTtle: "Hunt a Standing Wolf",
        desc: "Vargoth, Zareth, Morvane, Skallgrim - the werewolves that walk on two legs. Bring down any one of them. Go prepared, or don't go at all." },
];
const RANK_TERMS = {
    f: { coins: 100, fee: 10, gearChance: 0.3, bestGear: false, metals: { iron: 40, bronze: 30, steel: 18, silver: 12 } },
    e: { coins: 150, fee: 15, gearChance: 0.45, bestGear: false, metals: { iron: 25, bronze: 30, steel: 25, silver: 20 } },
    d: { coins: 220, fee: 25, gearChance: 0.55, bestGear: false, metals: { bronze: 20, steel: 35, silver: 30, gold: 15 } },
    c: { coins: 320, fee: 40, gearChance: 0.65, bestGear: true, metals: { steel: 30, silver: 30, gold: 25, ruby: 15 } },
    b: { coins: 450, fee: 60, gearChance: 0.75, bestGear: true, metals: { gold: 35, ruby: 35, mythril: 30 } },
    a: { coins: 700, fee: 100, gearChance: 0.9, bestGear: true, metals: { mythril: 45, adamantine: 40, dragonscale: 15 } },
    s: { coins: 1000, fee: 150, gearChance: 1, bestGear: true, metals: { adamantine: 50, dragonscale: 40, black: 10 } },
};
// CONTRACT REWARDS - food every time, plus either gear or a second food.
// Hand-mirrored from the client's own definitions (staticRecources/foodItems.js's
// jerky, npcDetails.js's shop stock) since tcp can't import from client/ -
// name is also the icon, images/items/consumable/<name>.webp. minRank keeps the
// pricier food for the harder contracts.
const REWARD_FOODS = [
    { name: "jerky", dn: "Jerky", itemType: "food", maxQnty: 3, rarity: "normal", minRank: "f",
        consumeAbilities: { plusHp: 50, plusMp: 0, plusSp: 10, plusDmg: 0, plusSpd: 0, fillHunger: 30, fillTireness: 0, cure: [] },
        price: 5, desc: "Strips of dried, salted meat - tough to chew, but it keeps for weeks on the road. A guild ration for new members." },
    { name: "commonale", dn: "Traveler's Ale", itemType: "food", maxQnty: 2, rarity: "normal", minRank: "f",
        consumeAbilities: { plusHp: 150, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 1, fillHunger: 20, fillTireness: 5, cure: [] },
        price: 4, desc: "Thin, bitter, and exactly what every guide on a long road swears by. Keeps your feet moving after the sun's given up." },
    { name: "etherpearl", dn: "Etherpearl", itemType: "food", maxQnty: 3, rarity: "normal", minRank: "f",
        consumeAbilities: { plusHp: 100, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0, fillHunger: 15, fillTireness: 0, cure: [] },
        price: 1, desc: "A rare, luminous fruit that shimmers with a soft, otherworldly glow." },
    { name: "sylfple", dn: "Sylfple", itemType: "food", maxQnty: 2, rarity: "normal", minRank: "f",
        consumeAbilities: { plusHp: 200, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0, fillHunger: 25, fillTireness: 0, cure: [] },
        price: 2, desc: "A delicate, green-skinned fruit, with soft, velvety flesh that emits a fresh, herbal fragrance." },
    { name: "lunaraqum", dn: "Lunaraqum", itemType: "food", maxQnty: 1, rarity: "normal", minRank: "f",
        consumeAbilities: { plusHp: 400, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0, fillHunger: 30, fillTireness: 10, cure: ["poisoned"] },
        price: 3, desc: "A striking fruit with a deep crimson skin that glimmers like molten metal under moonlight. Its content can even cure poisons" },
    { name: "embergale", dn: "Embergale", itemType: "food", maxQnty: 1, rarity: "normal", minRank: "f",
        consumeAbilities: { plusHp: 300, plusMp: 0, plusSp: 0, plusDmg: 5, plusSpd: 0, fillHunger: 25, fillTireness: 10, cure: [] },
        price: 10, desc: "Brewed with enough fire-pepper to warm you through before a dangerous stretch of road. Zerech won't set out without one in hand." },
    { name: "duskmire", dn: "Duskmire", itemType: "food", maxQnty: 2, rarity: "rare", minRank: "c",
        consumeAbilities: { plusHp: 900, plusMp: 200, plusSp: 200, plusDmg: 10, plusSpd: 0, fillHunger: 60, fillTireness: 15, cure: [] },
        price: 13, desc: "Its rarity stems from the fact that it only grows in the heart of enchanted swamps, blooming at dusk under the watchful eye of ancient spirits." },
];
// the gear a contract can pay in - botItems.ts's own templates (real meshes and
// icons). The light pieces at every rank; the full plate and the helms only
// where RANK_TERMS says bestGear.
const LIGHT_GEAR_NAMES = ["lightarmor", "ironpaul", "gauntler", "braveknee", "ironmask", "leatherboots"];
const LIGHT_GEAR = botItems_1.WARBRINGER_ITEMS.filter(t => LIGHT_GEAR_NAMES.includes(t.name));
const ALL_METAL_GEAR = botItems_1.WARBRINGER_ITEMS.filter(t => t.metalTinted);
function pickOne(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function pickWeighted(weights) {
    const keys = Object.keys(weights);
    let roll = Math.random() * keys.reduce((sum, k) => sum + weights[k], 0);
    for (const k of keys) {
        roll -= weights[k];
        if (roll < 0)
            return k;
    }
    return keys[0];
}
function rankAtLeast(rank, min) {
    return RANK_ORDER.indexOf(rank) >= RANK_ORDER.indexOf(min);
}
function makeRewardFood(food) {
    return {
        itemId: (0, tools_1.randNumString)(),
        name: food.name,
        dn: food.dn,
        itemCateg: "consumable",
        itemType: food.itemType,
        consumeAbilities: food.consumeAbilities,
        price: { coinType: "bronze", pieces: food.price },
        qnty: 1 + Math.floor(Math.random() * food.maxQnty),
        desc: food.desc,
        rarity: food.rarity,
    };
}
function rollContractRewards(rank) {
    const terms = RANK_TERMS[rank];
    const foods = REWARD_FOODS.filter(f => rankAtLeast(rank, f.minRank));
    const firstFood = pickOne(foods);
    const rewards = [makeRewardFood(firstFood)];
    if (Math.random() < terms.gearChance) {
        const pool = terms.bestGear ? ALL_METAL_GEAR : LIGHT_GEAR;
        rewards.push((0, botItems_1.buildEquipableItem)(pickOne(pool), pickWeighted(terms.metals)));
    }
    else {
        rewards.push(makeRewardFood(pickOne(foods.filter(f => f !== firstFood))));
    }
    return rewards;
}
// A new contract of this rank, hung at pos on its rank's board. Any of the
// rank's kinds (CONTRACT_KINDS); a rank with none yet (S) gets nothing.
function createContract(rank, pos) {
    const kinds = CONTRACT_KINDS.filter(k => k.rank === rank);
    if (!kinds.length)
        return null;
    const kind = pickOne(kinds);
    const terms = RANK_TERMS[rank];
    return {
        questId: (0, tools_1.randNumString)(),
        qName: "guildContract",
        qTtle: kind.qTtle,
        desc: kind.desc,
        // name is the first of names, for anything that still reads only that
        questRequirements: { reqType: "monster", modelStyle: kind.image, name: kind.names[0], names: kind.names, targetDn: kind.targetDn,
            current: 0, requiredNum: kind.requiredNum, completed: false },
        reward: { receiveRewardType: "bronze", rewardItems: rollContractRewards(rank), rewardCoin: terms.coins },
        rankPoints: RANK_ORDER.indexOf(rank) + 1, // for when contracts raise your rank
        requiredRank: { rankNumber: RANK_ORDER.indexOf(rank), rankLabel: rank },
        board: boardOfRank(rank),
        pos,
        claimed: false,
        // owner id of whoever holds it - one contract per player (index.ts's emitClaimQuest)
        claimedBy: null,
        // what taking the contract costs - paid by the client once the claim succeeds
        price: { coinType: "bronze", pieces: terms.fee },
    };
}
// Scatters quests across a jittered grid instead of pure random positions.
// Plain Math.random() on both axes had no guardrail against two quests
// landing near the same spot — that's what caused the stacking. Splitting
// the board area into count-sized cells and jittering within each one keeps
// the scattered look while guaranteeing no two markers can collide.
function scatterPositions(board, count) {
    const { yMin, yMax, zMin, zMax, x } = BOARDS[board];
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const cellHeight = (yMax - yMin) / rows;
    const cellWidth = (zMax - zMin) / cols;
    const cells = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            cells.push({ row, col });
        }
    }
    // shuffle so quests don't always fill the grid in the same reading order
    for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    return cells.slice(0, count).map(({ row, col }) => {
        const jitterY = (Math.random() - 0.5) * cellHeight * 0.6;
        const jitterZ = (Math.random() - 0.5) * cellWidth * 0.6;
        return {
            x,
            y: yMin + cellHeight * (row + 0.5) + jitterY,
            z: zMin + cellWidth * (col + 0.5) + jitterZ,
        };
    });
}
function fillBoard(board) {
    const ranks = BOARD_SLOTS[board];
    const positions = scatterPositions(board, ranks.length);
    return ranks.map((rank, i) => createContract(rank, positions[i])).filter((q) => !!q);
}
exports.default = [...fillBoard("guildboard1"), ...fillBoard("guildboard2")];
