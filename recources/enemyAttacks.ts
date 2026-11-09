// Attacks an enemy mixes in among its plain melee swings - an enemy's
// `additionalAttacks`. Each time it attacks in melee, the client running it
// (client/src/enemies/createEnemy.js's emitAttack) rolls every entry's
// `chance` in turn, and the first that comes up - if the enemy's rig has the
// clip for it - is swung instead of a plain attack. Its attackType rides the
// "enemy-attacked" relay, and everything it does to whoever it lands on is
// read from here (client/src/sockets/worldsocket.js, charactersystem/
// knockback.js, charactersystem/stun.js):
//
//   attackType                  its name on the relay - unique within one enemy
//   animationName               the enemy's clip for it
//   chance                      0-1, of any one melee attack being this one
//   impactAt                    how far into the clip (0-1) it lands
//   knockback                   throws the victim back to this far from the enemy (m)
//   playerAnimationWhenHit      the clip the victim plays as it lands
//   stunDuration                seconds the victim can't move, turn, jump,
//                               attack, cast or raise a guard - 0 for none
//   playerAnimationWhenStunned  the clip they loop meanwhile
//   whenBlocked                 a victim with their guard up (weaponblock)
//                               loses no hp, but anything set here replaces
//                               the above for them. A stunDuration over 0
//                               here breaks the guard: it drops, and they
//                               have to raise it again once they come to.
export type TadditionalAttack = {
    attackType: string
    animationName: string
    chance: number
    impactAt: number
    knockback?: number
    playerAnimationWhenHit?: string
    stunDuration?: number
    playerAnimationWhenStunned?: string
    whenBlocked?: {
        knockback?: number
        playerAnimationWhenHit?: string
        stunDuration?: number
        playerAnimationWhenStunned?: string
    }
}

// the slimes' body slam (slime.glb's bashattack: a jump that hits the ground
// at 0.63 of its 0.96 s). Lands hard enough to leave you dazed; a raised
// guard takes the edge off but breaks under it.
export const SLIME_BASH_ATTACK: TadditionalAttack = {
    attackType: "bashattack",
    animationName: "bashattack",
    chance: 0.35,
    impactAt: 0.65,
    knockback: 2,
    playerAnimationWhenHit: "hit1",
    stunDuration: 2,
    // avatar.glb's slumped stagger - the pose resting and tiredness use too
    playerAnimationWhenStunned: "structed",
    whenBlocked: {
        knockback: 3,
        playerAnimationWhenHit: "blockbreak",
        stunDuration: 1,
    },
}
