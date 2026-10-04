"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEATHER_ROLL_INTERVAL_MS = exports.WEATHER_AMBIENT_TEMP = exports.WEATHER_TYPES = void 0;
exports.getWeather = getWeather;
exports.getWeatherState = getWeatherState;
exports.rollWeather = rollWeather;
exports.setWeather = setWeather;
// Server-owned world weather. There is exactly ONE weather at a time for the
// whole world, not one per place - whatever is falling in the openworld is
// falling in the village too (only those two areaTypes show it at all; rooms,
// dungeons and duel arenas stay clear regardless, which the CLIENT decides
// since it's the only side that knows what place its own player is standing
// in right now).
//
// MIRROR of client/src/constants/weather.js's own WEATHER_TYPES /
// WEATHER_AMBIENT_TEMP. Only the NAME ever crosses the wire - every client
// looks the temperature up in its own copy - so these two tables have to stay
// identical or players in the same storm take different damage. Same hazard
// npcBrain.ts's SPRINT_SPEED already carries: a constant both sides depend on
// that neither one actually sends.
exports.WEATHER_TYPES = ["clear", "rain", "fog", "snow", "sandstorm"];
exports.WEATHER_AMBIENT_TEMP = {
    clear: 20,
    rain: 10,
    fog: 0,
    snow: -30,
    sandstorm: 40,
};
// How long one weather state lasts before a new roll. Long enough that a
// player crossing the map usually stays under one sky, short enough that
// someone standing still still sees it change.
exports.WEATHER_ROLL_INTERVAL_MS = 4 * 60 * 1000;
// Weighted so the world is usually calm - an endless cycle of storms stops
// reading as weather and starts reading as a broken effect. Snow and sandstorm
// are the two that actually threaten an unequipped player (see the client's
// own temperatureStrain), so they're the rarest.
const WEATHER_WEIGHTS = {
    clear: 45,
    rain: 20,
    fog: 15,
    snow: 10,
    sandstorm: 10,
};
let currentWeather = "clear";
let weatherSince = Date.now();
function getWeather() {
    return currentWeather;
}
// Included in the join-world snapshot so a client arriving mid-storm starts
// already showing it, rather than staying clear until the next roll happens
// to come around - the same reason that broadcast carries treasures/bonfires
// rather than only their change events.
function getWeatherState() {
    return { weather: currentWeather, since: weatherSince };
}
// Never rolls the same weather twice in a row: repeating a roll would emit a
// "changed" broadcast that changes nothing, and to a player it reads as the
// weather system having stalled.
function rollWeather() {
    const candidates = exports.WEATHER_TYPES.filter(w => w !== currentWeather);
    const totalWeight = candidates.reduce((sum, w) => sum + WEATHER_WEIGHTS[w], 0);
    let roll = Math.random() * totalWeight;
    let picked = candidates[0];
    for (const weather of candidates) {
        roll -= WEATHER_WEIGHTS[weather];
        if (roll <= 0) {
            picked = weather;
            break;
        }
    }
    currentWeather = picked;
    weatherSince = Date.now();
    return picked;
}
// debug/admin path - same shape as rollWeather so callers can treat them
// interchangeably. Returns null for an unknown name rather than throwing,
// since the only caller is a socket handler reading a client-supplied string.
function setWeather(weather) {
    if (!exports.WEATHER_TYPES.includes(weather))
        return null;
    currentWeather = weather;
    weatherSince = Date.now();
    return currentWeather;
}
