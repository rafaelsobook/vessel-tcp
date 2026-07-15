"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSlimes = generateSlimes;
const tools_1 = require("../tools/tools");
const coreDetails_1 = require("../recources/coreDetails");
const slimeBase = {
    maxDistance: 0.5,
    name: "waterslime",
    dn: "Slime",
    modelStyle: "slime",
    elementType: "water",
    stats: {
        dmg: 5,
        magDmg: 1,
        spd: 3.3,
        atkSpd: 2,
        accuracy: 1,
        critical: 1.4,
    },
    lvl: 1,
    hp: 580,
    maxHp: 580,
    expToGain: 100,
    bodyHeight: 1,
    bodyWidenes: 0.9,
    effects: [
        { effectType: 'spdrain', chance: 10, permanent: false, dn: 'SP Drained', spcost: 20, hpcost: 0, mpcost: 0, hungercost: 4, energycost: 0 },
    ],
    effectsWhenHit: [
        { effectType: 'spdrain', chance: 10, permanent: false, dn: 'SP Drained', spcost: 20, hpcost: 0, mpcost: 0, hungercost: 4, energycost: 0 },
    ],
    titles: ['slime'],
    skills: [],
    aptitude: ['water'],
    blessings: [],
    status: [],
    regens: { sp: 1, hp: 1, mana: 1 },
    monsSoul: 1,
    race: "monster",
    characterType: "enemy",
    actionType: "chasing",
    _isMoving: false,
    _targetId: false,
    _dirTarg: { x: 0, y: 0, z: 0 },
    _attacking: false,
    _canAttack: true,
    loots: [coreDetails_1.simpleCoreLoot],
    respawnDetails: {
        willRespawn: true,
        respawnTime: 15 * 1000,
    },
};
function generateSlimes(total = 10, placeId = 1, areaSize = 300, areaType = "village") {
    const half = areaSize / 2;
    const slimes = [];
    for (let i = 0; i < total; i++) {
        let x, z;
        if (areaType === "village") {
            // Border band: outer 20% of each half (e.g. areaSize=300 → 120–150 range on each axis)
            const borderMin = half * 0.8;
            const borderMax = half * 0.97;
            const band = borderMax - borderMin;
            // Pick a random side (north/south/east/west) and scatter within that border strip
            const side = Math.floor(Math.random() * 4);
            if (side === 0) {
                // north strip: z positive border
                x = (Math.random() * 2 - 1) * half;
                z = borderMin + Math.random() * band;
            }
            else if (side === 1) {
                // south strip: z negative border
                x = (Math.random() * 2 - 1) * half;
                z = -(borderMin + Math.random() * band);
            }
            else if (side === 2) {
                // east strip: x positive border
                x = borderMin + Math.random() * band;
                z = (Math.random() * 2 - 1) * half;
            }
            else {
                // west strip: x negative border
                x = -(borderMin + Math.random() * band);
                z = (Math.random() * 2 - 1) * half;
            }
        }
        else {
            // Non-village: spread anywhere across the map
            x = (Math.random() * 2 - 1) * half;
            z = (Math.random() * 2 - 1) * half;
        }
        const y = 0;
        slimes.push({
            ...slimeBase,
            _id: `${(0, tools_1.randNumString)()}`,
            currentPlaceId: placeId,
            x,
            y,
            z,
            origPos: { x, y, z },
        });
    }
    return slimes;
}
