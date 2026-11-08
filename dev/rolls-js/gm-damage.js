const { applyTargetDamage } = await import("/systems/invincible/system/helpers/rolls.mjs");
const msg = game.messages.contents.filter((m) => m.rolls?.[0]?.attackDamage > 0 && m.rolls[0].successCount > 0).at(-1);
canvas.tokens.get(window.__T ?? "xvGY6hI8aVlS1L5H").control({ releaseOthers: true });
await applyTargetDamage(msg, msg.rolls[0]);
const last = game.messages.contents.at(-1);
return { from: msg.id, card: last.flavor, content: last.content, pu: last.flags["invincible-plus-ultra"] };
