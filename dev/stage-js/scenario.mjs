// The combat scenario (5 combatants, normal GM pace, a real player acting on its own turn), driven over CDP on the GM page and on
// PLAYER 1's page (its own move and attack come from its own client). Run setup.js on the GM page first.
//   node dev/stage-js/scenario.mjs <cdpPort> <gmUrlPrefix> <p1UrlPrefix>   -> prints the step log (ms after the start)
const [port, GM, P1] = process.argv.slice(2);
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
async function page(prefix) {
  const t = (await list()).find((x) => x.type === "page" && x.url.startsWith(prefix));
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map(); ws.addEventListener("message", (m) => { const q = JSON.parse(m.data); if ( q.id ) pend.get(q.id)?.(q); });
  return (js) => new Promise((r) => { const i = ++id; pend.set(i, (q) => r(q.result?.exceptionDetails ? { error: q.result.exceptionDetails.exception?.description } : q.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true } })); });
}
const gm = await page(GM), p1 = await page(P1);
const ATK = `const atk = async (a, t) => {
  for ( const x of [...game.user.targets] ) x.setTarget(false, { releaseOthers: false });
  canvas.tokens.get(t).setTarget(true, { releaseOthers: false });
  const Y = CONFIG.Dice.rolls.find((r) => r.name === "YearZeroRoll");
  const roll = await new Y("4db", { maxPush: 1 }, { damage: 3, attackType: "melee", minRange: 0, maxRange: 1, breakdown: [], stressCost: 0, actualDamage: true }).roll();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token: canvas.tokens.get(a).document }), flavor: "Punch" }, { rollMode: "publicroll" });
  return roll.successCount; };`;
const BB = "R4hFNWZj1BNOkHkY", AE = "1cFaD2vRMk4RmRMD", SH = "akYjM5eS7fvdheb1", TS = "p5SEfEkc7qNqWyVL";
const who = "return game.combat?.combatant?.name + ' r' + game.combat?.round;";
// what each combatant does on its own turn (role based: yze-combat draws the initiative order anew every time)
const plan = {
  "Battle Beast": [[2500, gm, "moves 8 sq", `await canvas.scene.tokens.get("${BB}").update({ x: 1000, y: 540 }); return "ok";`],
    [6000, gm, "attacks Atom Eve", `${ATK} return await atk("${BB}", "${AE}");`], [12500]],
  "TT0": [[4000]],
  "Atom Eve": [[2500, p1, "P1 moves Atom Eve 4 sq", `await canvas.scene.tokens.get("${AE}").update({ x: 1120, y: 480 }); return "ok";`],
    [5500, p1, "P1 attacks Battle Beast", `${ATK} return await atk("${AE}", "${BB}");`], [12000]],
  "test": [[2000, gm, "moves 3 sq", `await canvas.scene.tokens.get("${TS}").update({ x: 420, y: 700 }); return "ok";`], [5000]],
  "Superhero": [[2000, gm, "attacks Atom Eve", `${ATK} return await atk("${SH}", "${AE}");`], [8000]]
};
const t0 = Date.now(), out = [], log = (label, v) => out.push([Date.now() - t0, label, v]);
log("start", await gm(`await game.combat.startCombat(); ${who}`));
for ( let n = 0; n < 5; n++ ) {
  const name = (await gm("return game.combat.combatant?.name;")), ts = Date.now();
  for ( const [at, pg, label, js] of plan[name] ?? [[4000]] ) {
    const w = at - (Date.now() - ts); if ( w > 0 ) await new Promise((r) => setTimeout(r, w));
    if ( pg ) log(`${name} ${label}`, await pg(js));
  }
  if ( n < 4 ) log("next", await gm(`await game.combat.nextTurn(); ${who}`));
}
log("end combat", await gm(`await game.combat.delete(); return "ok";`));
await new Promise((r) => setTimeout(r, 4000));
console.log(JSON.stringify(out));
process.exit(0);
