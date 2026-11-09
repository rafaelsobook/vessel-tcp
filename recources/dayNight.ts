// Server-owned world clock - ONE time of day for the whole world, like the
// weather (recources/weather.ts). Only openworld and village show it; rooms,
// dungeons and duel arenas aren't lit by the sky, which the CLIENT decides
// (components/dayNightSystem.js), since only it knows which place its own
// player is standing in.
//
// The clock runs continuously off server time. Clients get the current
// timeOfDay (0..1) plus the day length and advance it themselves with their own
// clock, so no per-frame traffic - getDayNightState rides on every userJoined
// snapshot and a periodic resync in index.ts, which also corrects drift.

// one full day/night cycle in real time
export const DAY_LENGTH_MS = 24 * 60 * 1000
// how often index.ts re-broadcasts the clock to correct client drift
export const DAY_NIGHT_SYNC_INTERVAL_MS = 60 * 1000
// timeOfDay: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
// The server boots into morning rather than the middle of the night.
const BOOT_TIME_OF_DAY = 0.3

let clockOrigin = Date.now() - BOOT_TIME_OF_DAY * DAY_LENGTH_MS

export function getTimeOfDay(): number {
    return ((Date.now() - clockOrigin) / DAY_LENGTH_MS) % 1
}

export function getDayNightState(){
    return { timeOfDay: getTimeOfDay(), dayLengthMs: DAY_LENGTH_MS }
}

// Whether it is night - MIRROR of client/src/components/dayNightSystem.js's
// isNightNow (its sunState and SUN_SET_HEIGHT/SUN_UP_HEIGHT): the sun well
// down, a quarter of full daylight or less. Keep the two identical, or the
// server will call it night (the undead rising twice as strong) while every
// client still shows dusk.
const SUN_SET_HEIGHT = -0.08
const SUN_UP_HEIGHT = 0.3
export function isNightTime(): boolean {
    const height = Math.sin((getTimeOfDay() - 0.25) * Math.PI * 2)
    const t = Math.min(1, Math.max(0, (height - SUN_SET_HEIGHT) / (SUN_UP_HEIGHT - SUN_SET_HEIGHT)))
    return t * t * (3 - 2 * t) < 0.25
}

// debug/admin path - jumps the world clock to timeOfDay (0..1). Returns null
// for anything outside that range, since the caller passes a client-supplied
// value through.
export function setTimeOfDay(timeOfDay: number): number | null {
    if(typeof timeOfDay !== "number" || !(timeOfDay >= 0 && timeOfDay < 1)) return null
    clockOrigin = Date.now() - timeOfDay * DAY_LENGTH_MS
    return timeOfDay
}
