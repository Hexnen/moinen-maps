const A = window.__A;
const tok = canvas.tokens.get(A.atk);
for ( const t of [...game.user.targets] ) t.setTarget(false, { releaseOthers: false });
for ( const id of A.tgt ) canvas.tokens.get(id)?.setTarget(true, { releaseOthers: false });
const Y = CONFIG.Dice.rolls.find((r) => r.name === "YearZeroRoll");
let roll; for ( let i = 0; i < 50; i++ ) { roll = await new Y(`${A.dice}db`, { maxPush: 0 }, { damage: A.dmg, attackType: A.type, minRange: 0, maxRange: 3, breakdown: [], stressCost: 0, actualDamage: true }).evaluate(); if ( roll.successCount >= (A.min ?? 1) ) break; }
const msg = await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token: tok.document }), flavor: A.flavor }, { rollMode: A.mode });
return { id: msg.id, n: roll.successCount, pushable: roll.pushable };
