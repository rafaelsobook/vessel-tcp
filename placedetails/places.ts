// roomdb.js
import { generateArea } from '../generate-datas/genareamd';
import { generateBSPDungeon } from '../generate-datas/generatebsp';

export const placesMD = [

    generateBSPDungeon({ 
    placeId: "dungeon101",
    areaType: "dungeon",
    seed: 12345,
    rockDensity: 0,
    gridWidth: 32,
    gridHeight: 32,
    cellSize: 4,
    wallHeight: 15,
    corridorWidth: 3,
    difficulty: 1,
    // textures: { wallTexName: "wall1", floorTexName: "floor1", ceilingTexName: "ceil1" }
    textures: null
    // ↑ shorthand — applies rock2.jpg to wall, floor AND ceiling
    }),
    generateArea({ 
        placeId: "village101",
        areaType: "village",
        width:      100,
        height:     100,
        seed: 123, 
        totalBigHouse: 10, 
        totalBigTrees: 1, 
        entry: "south",
        exit: "north",
    })
];