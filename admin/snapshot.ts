import { AdminWorld } from "./types"
import { getWeatherState } from "../recources/weather"
import { getDayNightState } from "../recources/dayNight"
import { placeById } from "./catalog"
import { store } from "./persistence"

// The state the admin page keeps on screen: a summary of the world and the
// roster of who's in it, sent every couple of seconds while someone is looking.
// Lists with more rows than that (all the enemies, say) are fetched on request
// instead - see commands.ts.

const startedAt = Date.now()
const round2 = (n: number) => Math.round(n * 100) / 100

function countBy<T>(items: T[], keyOf: (item: T) => string | number) {
    const counts: Record<string, number> = {}
    items.forEach(item => {
        const key = String(keyOf(item))
        counts[key] = (counts[key] ?? 0) + 1
    })
    return counts
}

export function buildSnapshot(world: AdminWorld, adminCount: number) {
    const botOwners = new Set(world.bots.map(bot => bot.player.owner))
    const memory = process.memoryUsage()

    const enemiesByPlace: Record<string, Record<string, number>> = {}
    world.enemies.forEach(enemy => {
        const place = (enemiesByPlace[enemy.currentPlaceId] ??= {})
        place[enemy.name] = (place[enemy.name] ?? 0) + 1
    })

    const players = world.players.map(pl => ({
        owner: pl.owner,
        name: pl.name,
        lvl: pl.lvl,
        gender: pl.gender,
        bot: botOwners.has(pl.owner),
        placeId: pl.currentPlace?.placeId ?? null,
        place: pl.currentPlace?.name ?? placeById(pl.currentPlace?.placeId)?.name ?? "?",
        pos: pl.pos ? { x: round2(pl.pos.x), y: round2(pl.pos.y), z: round2(pl.pos.z) } : null,
        mode: pl.mode,
        seated: !!pl.seat,
        hp: pl.hp ?? null,
        maxHp: pl.maxHp ?? null,
        tired: !!pl.isTired,
        bleeding: !!pl.isBleeding,
    }))

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
            bonfires: world.bonfires.length,
            trunks: world.trunks.length,
            structures: world.structures.length,
            struckWeapons: world.struckWeapons.length,
            weather: getWeatherState().weather,
            timeOfDay: getDayNightState().timeOfDay,
            hunts: [...world.hunts].map(([wolf, owner]) => ({ wolf, owner, prey: world.players.find(pl => pl.owner === owner)?.name ?? null })),
        },
        persistence: store.info(),
        players,
    }
}
