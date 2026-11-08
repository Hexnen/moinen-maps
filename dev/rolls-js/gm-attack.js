const A = window.__A ?? { atk: "g6EcTYucya8eklEZ", tgt: ["xvGY6hI8aVlS1L5H"], dice: 4, dmg: 3, type: "shooting", mode: "publicroll", flavor: "Concussion Blast" };
const tok = canvas.tokens.get(A.atk);
for ( const t of [...game.user.targets] ) t.setTarget(false, { releaseOthers: false });
for ( const id of A.tgt ) canvas.tokens.get(id)?.setTarget(true, { releaseOthers: false });
const Y = CONFIG.Dice.rolls.find((r) => r.name === "YearZeroRoll");
const opts = A.type ? { damage: A.dmg, attackType: A.type, minRange: 0, maxRange: 3, breakdown: [], stressCost: 0, actualDamage: true } : { breakdown: [], stressCost: 0 };
const roll = await new Y(`${A.dice}db`, { maxPush: 1 }, opts).roll();
const msg = await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token: tok.document }), flavor: A.flavor }, { rollMode: A.mode });
return { id: msg.id, n: roll.successCount, flags: msg.flags["moinen-maps"], whisper: msg.whisper, blind: msg.blind };
