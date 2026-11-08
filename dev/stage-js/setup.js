const D = game.modules.get("moinen-maps").api.director;
await D.setPaused(true);                       // (the resets below are no shots)
for ( const c of [...game.combats] ) await c.delete();
const ids = ["R4hFNWZj1BNOkHkY", "1cFaD2vRMk4RmRMD", "akYjM5eS7fvdheb1", "p5SEfEkc7qNqWyVL", "ZMe1OqfBuNwSPRaV"];
// positions as the adversaries left them
const pos = { R4hFNWZj1BNOkHkY: [700, 700], "1cFaD2vRMk4RmRMD": [1240, 400], akYjM5eS7fvdheb1: [607, 649], p5SEfEkc7qNqWyVL: [300, 700], ZMe1OqfBuNwSPRaV: [300, 300] };
for ( const [id, [x, y]] of Object.entries(pos) ) { const d = canvas.scene.tokens.get(id); if ( d.x !== x || d.y !== y ) await d.update({ x, y }, { animate: false }); }
await new Promise((r) => setTimeout(r, 1200)); await D.setPaused(false);
const combat = await Combat.create({ scene: canvas.scene.id, active: true });
await combat.createEmbeddedDocuments("Combatant", ids.map((id, i) => ({ tokenId: id, sceneId: canvas.scene.id, actorId: canvas.scene.tokens.get(id).actorId, initiative: 10 - i })));
for ( const m of game.messages.contents.slice(-30) ) if ( m.rolls?.length ) await m.delete();
return { id: combat.id, turns: combat.turns.map((t) => t.name) };
