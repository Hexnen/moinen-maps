window.__A = { atk: "g6EcTYucya8eklEZ", tgt: ["xvGY6hI8aVlS1L5H"], dice: 6, dmg: 5, type: "shooting", mode: "publicroll", flavor: "Concussion Blast", min: 2 };
const hit = new Function(`return (async()=>{${window.__hitSrc}})()`);
await hit();
setTimeout(async () => { const { applyTargetDamage } = await import("/systems/invincible/system/helpers/rolls.mjs"); const msg = game.messages.contents.filter((m) => m.rolls?.[0]?.attackDamage > 0 && m.rolls[0].successCount > 0).at(-1); canvas.tokens.activate(); canvas.tokens.get("xvGY6hI8aVlS1L5H").control({ releaseOthers: true }); await applyTargetDamage(msg, msg.rolls[0]); }, 8800);
return 1;
