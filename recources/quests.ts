import { randNumString } from "../tools/tools";

// Usable area of the guild board's paper region, in the board's local space.
// guildboard.glb's actual mesh bounds (read from the POSITION accessor in
// the glb itself) are Y: 0 to 3.78, Z: -2.495 to 2.495 — the board is much
// bigger than the earlier guess of Y:0.7-1.3 / Z:0-1, which only covered a
// small corner of it (that's what was causing the tight clustering). These
// margins trim off the wooden frame, the arched "Guild Board" title strip
// at the top, and the base ledge at the bottom, leaving roughly the
// paper-covered area — eyeballed against the board's screenshot, not an
// exact measurement, so nudge these if quests still land on the frame.
const BOARD_Y_MIN = 0.5
const BOARD_Y_MAX = 2.6
const BOARD_Z_MIN = -2.1
const BOARD_Z_MAX = 2.1

export function createSlaySlimesQuest(requiredNumber: number, pos: { y: number, z: number }) {
    return {
        questId: randNumString(),
        qName: "slaySlimes",
        qTtle: "Slay Slimes",
        desc: "This pesky slimes are all over town and keep on coming, we need to get rid of them",
        questRequirements: { reqType: "monster", modelStyle: "slime", name: "waterslime", current: 0, requiredNum: requiredNumber, completed: false }, //reqType'enemy/item/money
        reward: { receiveRewardType: "bronze", rewardItems: [
            {
                itemId: randNumString(), // should be string also in client
                name: "etherpearl", // is also the image name
                dn: "Etherpearl",
                itemCateg: "consumable",//equipable,crafting(for item looted),consum(/foods/buffs/potions)
                itemType: "food", // weapon/staff/spear/Pauldrons//armor/greaves || //food//potion//buff/cores
                // if you calc spd(1/10 = .1) mychar.spd += plusSpd/10// it should only be .1 to 1
                consumeAbilities: { plusHp: 100, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0, fillHunger: 15, fillTireness: 0, cure: [], effect: "sleep"}, //for buffs foods potions
                price: { coinType: "bronze", pieces: 1 },
                qnty: 1,
                desc: "A rare, luminous fruit that shimmers with a soft, otherworldly glow. ",
                rarity: "normal"
            },
            {
                itemId: randNumString(), // should be string also in client
                name: "commonale", // is also the image name
                dn: "Ale (Beer)",
                itemCateg: "consumable",//equipable,crafting(for item looted),consum(/foods/buffs/potions)
                itemType: "food", // weapon/staff/spear/Pauldrons//armor/greaves || //food//potion//buff/cores
                // if you calc spd(1/10 = .1) mychar.spd += plusSpd/10// it should only be .1 to 1
                consumeAbilities: { plusHp: 100, plusMp: 0, plusSp: 0, plusDmg: 0, plusSpd: 0, fillHunger: 15, fillTireness: 0, cure: [], effect: "sleep"}, //for buffs foods potions
                price: { coinType: "bronze", pieces: 1 },
                qnty: 1,
                desc: "The tavern's everyday ale. Affordable, light, and popular among laborers and novice adventurers.",
                rarity: "normal"
            },
        ], rewardCoin: 100 },
        rankPoints: 1, // this is for your rank to be promoted you must reach 100 points
        requiredRank: { rankNumber: 0, rankLabel: "f" },
        pos,
        claimed: false,
        price: { coinType: "bronze", pieces: 10 }
    }
}

// Scatters quests across a jittered grid instead of pure random positions.
// Plain Math.random() on both axes had no guardrail against two quests
// landing near the same spot — that's what caused the stacking. Splitting
// the board area into count-sized cells and jittering within each one keeps
// the scattered look while guaranteeing no two markers can collide.
function scatterPositions(count: number) {
    const cols = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / cols)
    const cellHeight = (BOARD_Y_MAX - BOARD_Y_MIN) / rows
    const cellWidth = (BOARD_Z_MAX - BOARD_Z_MIN) / cols

    const cells: { row: number, col: number }[] = []
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            cells.push({ row, col })
        }
    }
    // shuffle so quests don't always fill the grid in the same reading order
    for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]]
    }

    return cells.slice(0, count).map(({ row, col }) => {
        const jitterY = (Math.random() - 0.5) * cellHeight * 0.6
        const jitterZ = (Math.random() - 0.5) * cellWidth * 0.6
        return {
            y: BOARD_Y_MIN + cellHeight * (row + 0.5) + jitterY,
            z: BOARD_Z_MIN + cellWidth * (col + 0.5) + jitterZ,
        }
    })
}

// the board should always have exactly this many f-rank (slaySlimes) quests
// available - index.ts tops the pool back up to this whenever one is
// completed, and never lets it climb above it either
export const F_RANK_QUEST_COUNT = 10
const positions = scatterPositions(F_RANK_QUEST_COUNT)

export default positions.map(pos => createSlaySlimesQuest(2, pos))
