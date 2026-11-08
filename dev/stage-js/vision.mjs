// The combat stage on a token-vision scene (director-vision): PLAYER 1 owns dir-vis-pc; "Ukryty" is a hidden token, "Daleki" is out of
// the player's vision. Turns of combatants the player cannot see must never move its camera; then Daleki walks into the light.
//   node dev/stage-js/vision.mjs <cdpPort> <gmUrlPrefix> <p1UrlPrefix>
const [port, GM, P1] = process.argv.slice(2);
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
async function page(prefix) {
  const t = (await list()).find((x) => x.type === "page" && x.url.startsWith(prefix));
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map(); ws.addEventListener("message", (m) => { const q = JSON.parse(m.data); if ( q.id ) pend.get(q.id)?.(q); });
  return async (js) => { const q = await new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true } })); }); return q.result?.exceptionDetails ? { error: q.result.exceptionDetails.exception?.description } : q.result?.result?.value; };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gm = await page(GM), p1 = await page(P1);
let fails = 0; const check = (c, m, d) => { console.log(`${c ? "OK  " : "FAIL"} ${m}${d ? `   ${JSON.stringify(d)}` : ""}`); if ( !c ) fails++; };
const SC = "Og7H0L5kunEUMfZI";
const ids = await gm(`const s = game.scenes.get("${SC}"); return Object.fromEntries(s.tokens.map((t) => [t.name, t.id]));`);
await gm(`for ( const c of [...game.combats] ) await c.delete(); await game.scenes.get("${SC}").activate(); return 1;`);
await sleep(16000);                                                   // (the arrival + sketch-reveal's splash)
const cam = () => p1(`return [Math.round(canvas.stage.pivot.x), Math.round(canvas.stage.pivot.y), +canvas.stage.scale.x.toFixed(3), canvas.scene.name];`);
await p1(`window.__vlog = []; if ( window.__vh ) Hooks.off("moinenMapsDirector", window.__vh); window.__vh = Hooks.on("moinenMapsDirector", (k, d) => { if ( k === "shot" ) window.__vlog.push(["shot", d.form, d.shot.kind]); }); return 1;`);
const info = await p1(`const t = (n) => canvas.scene.tokens.getName(n)?.object; return { scene: canvas.scene.name, tv: canvas.scene.tokenVision, daleki: !!t("Daleki")?.visible, ukryty: !!t("Ukryty")?.visible, pc: !!t("dir-vis-pc")?.visible };`);
check(info.scene === "director-vision" && info.tv && info.pc && !info.daleki && !info.ukryty, "player on the vision scene: own token visible, Daleki and Ukryty not", info);
const order = ["Daleki", "Ukryty", "dir-vis-pc"];
await gm(`const sc = game.scenes.get("${SC}"); const c = await Combat.create({ scene: sc.id, active: true });
  await c.createEmbeddedDocuments("Combatant", ${JSON.stringify(order)}.map((n, i) => { const d = sc.tokens.getName(n); return { tokenId: d.id, sceneId: sc.id, actorId: d.actorId, initiative: 10 - i, hidden: d.hidden }; }));
  if ( !window.__autoCard ) window.__autoCard = Hooks.on("renderDialogV2", (app) => { if ( /Choose a Card/.test(app.title ?? "") ) setTimeout(() => app.element?.querySelector("button[data-action=ok]")?.click(), 100); });
  await c.startCombat(); return c.turns.map((t) => t.name);`);
const c0 = await cam();
const seenTurns = [];
for ( let i = 0; i < 3; i++ ) {
  const who = await gm(`return game.combat.combatant.name;`);
  const before = await cam();
  await sleep(2500);
  if ( who === "Daleki" ) await gm(`const d = game.combat.combatant.token; await d.update({ x: d.x + 4 * canvas.grid.size }); return 1;`);
  if ( who === "Ukryty" ) await gm(`const d = game.combat.combatant.token; await d.update({ y: d.y + 3 * canvas.grid.size }); return 1;`);
  await sleep(2500);
  const after = await cam();
  seenTurns.push({ who, before, after });
  if ( who !== "dir-vis-pc" ) check(before[0] === after[0] && before[1] === after[1] && before[2] === after[2], `turn of ${who} (not visible to the player) + its move: the camera did not move`, { before, after });
  await gm(`await game.combat.nextTurn(); return 1;`);
}
const log = await p1(`return window.__vlog;`);
check(!log.some((l) => l[1] === "take"), "no take-over on the player during the unseen combatants' turns", log);
const tr = await p1(`return game.modules.get("moinen-maps").api.directorStage._debug().trace;`);
console.log("trace", JSON.stringify(tr.slice(-6)));
// Daleki walks into the player's light (next to dir-vis-pc) on its turn: now the camera may follow (the move source's check decides)
let w = await gm(`return game.combat.combatant.name;`);
for ( let i = 0; i < 3 && w !== "Daleki"; i++ ) { await gm(`await game.combat.nextTurn(); return 1;`); await sleep(1200); w = await gm(`return game.combat.combatant.name;`); }
await gm(`const d = canvas.scene.tokens.getName("Daleki"); await d.update({ x: 320, y: 240 }); return 1;`);
await sleep(4000);
const log2 = await p1(`return window.__vlog;`);
console.log("after Daleki walks into the light:", JSON.stringify(log2.slice(log.length)), JSON.stringify(await cam()));
// restore
await gm(`await game.combat.delete(); const sc = game.scenes.get("${SC}"); await sc.tokens.getName("Daleki").update({ x: 1100, y: 220 }, { animate: false }); await sc.tokens.getName("Ukryty").update({ x: 660, y: 200 }, { animate: false }); await game.scenes.getName("director-test").activate(); return 1;`);
await sleep(12000);
console.log(JSON.stringify({ fails, turns: seenTurns, c0 }));
process.exit(fails ? 1 : 0);
