"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SLIME_BASH_ATTACK = void 0;
// the slimes' body slam (slime.glb's bashattack: a jump that hits the ground
// at 0.63 of its 0.96 s). Lands hard enough to leave you dazed; a raised
// guard takes the edge off but breaks under it.
exports.SLIME_BASH_ATTACK = {
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
};
