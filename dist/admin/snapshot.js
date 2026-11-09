"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSnapshot = buildSnapshot;
const weather_1 = require("../recources/weather");
const dayNight_1 = require("../recources/dayNight");
const catalog_1 = require("./catalog");
const persistence_1 = require("./persistence");
// The state the admin page keeps on screen: a summary of the world and the
// roster of who's in it, sent every couple of seconds while someone is looking.
// Lists with more rows than that (all the enemies, say) are fetched on request
// instead - see commands.ts.
const startedAt = Date.now();
const round2 = (n) => Math.round(n * 100) / 100;
function countBy(items, keyOf) {
    const counts = {};
    items.forEach(item => {
        const key = String(keyOf(item));
        counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
}
function buildSnapshot(world, adminCount) {
    const botOwners = new Set(world.bots.map(bot => bot.player.owner));
    const memory = process.memoryUsage();
    const enemiesByPlace = {};
    world.enemies.forEach(enemy => {
        var _a;
        const place = (enemiesByPlace[_a = enemy.currentPlaceId] ?? (enemiesByPlace[_a] = {}));
        place[enemy.name] = (place[enemy.name] ?? 0) + 1;
    });
    const players = world.players.map(pl => ({
        owner: pl.owner,
        name: pl.name,
        lvl: pl.lvl,
        gender: pl.gender,
        bot: botOwners.has(pl.owner),
        placeId: pl.currentPlace?.placeId ?? null,
        place: pl.currentPlace?.name ?? (0, catalog_1.placeById)(pl.currentPlace?.placeId)?.name ?? "?",
        pos: pl.pos ? { x: round2(pl.pos.x), y: round2(pl.pos.y), z: round2(pl.pos.z) } : null,
        mode: pl.mode,
        seated: !!pl.seat,
        hp: pl.hp ?? null,
        maxHp: pl.maxHp ?? null,
        tired: !!pl.isTired,
        bleeding: !!pl.isBleeding,
    }));
    return {
        t: Date.now(),
        server: {
            uptimeSec: Math.round((Date.now() - startedAt) / 1000),
            memoryMb: Math.round(memory.rss / 1048576),
            heapMb: Math.round(memory.heapUsed / 1048576),
            node: process.version,
            admins: adminCount,
        },
        world: {
            players: players.filter(p => !p.bot).length,
            bots: players.filter(p => p.bot).length,
            botsSpawning: world.spawnBotsEnabled,
            enemies: world.enemies.length,
            enemiesFighting: world.enemies.filter(e => e._targetId).length,
            enemiesByPlace,
            treasures: world.treasures.length,
            grains: world.grains.length,
            mushrooms: world.mushrooms.length,
            mushroomsByKind: countBy(world.mushrooms, m => m.kind),
            ores: world.ores.length,
            oresByVein: countBy(world.ores, o => o.vein),
            bonfires: world.bonfires.length,
            trunks: world.trunks.length,
            structures: world.structures.length,
            struckWeapons: world.struckWeapons.length,
            weather: (0, weather_1.getWeatherState)().weather,
            timeOfDay: (0, dayNight_1.getDayNightState)().timeOfDay,
            hunts: [...world.hunts].map(([wolf, owner]) => ({ wolf, owner, prey: world.players.find(pl => pl.owner === owner)?.name ?? null })),
        },
        persistence: persistence_1.store.info(),
        players,
    };
}
