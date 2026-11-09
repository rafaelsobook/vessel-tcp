import type { Server } from "socket.io"

// What the admin module may touch of index.ts's world. index.ts holds its
// state in module-level variables it REASSIGNS (tcpEnemies = tcpEnemies.filter
// ...), so the admin code reads and writes them through this object - getters
// and setters over those variables - rather than holding copies that would
// go stale. Items are loosely typed: this module only ever reads the few
// fields it needs from them.
export interface AdminWorld {
    players: any[]
    enemies: any[]
    treasures: any[]
    grains: any[]
    mushrooms: any[]
    ores: any[]
    readonly bonfires: any[]
    readonly trunks: any[]
    readonly structures: any[]
    readonly struckWeapons: any[]
    readonly bots: { player: any }[]
    spawnBotsEnabled: boolean
    spawnBot(overrides?: any): void
    // standing wolf name -> the owner of the player it's hunting
    readonly hunts: Map<string, string>
}

// A command that couldn't be carried out, with a message for the admin. Any
// other error thrown inside a command is a bug and is reported as such.
export class AdminError extends Error {}

export interface AdminContext {
    world: AdminWorld
    io: Server
    ip: string
}

export const fail = (message: string): never => { throw new AdminError(message) }
