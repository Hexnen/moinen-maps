const [port, GM, P2] = process.argv.slice(2);
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
async function page(prefix) { const t = (await list()).find((x) => x.type === "page" && x.url.startsWith(prefix)); const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r)); let id = 0; const pend = new Map(); ws.addEventListener("message", (m) => { const q = JSON.parse(m.data); if (q.id) pend.get(q.id)?.(q); }); const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }); const ev = async (js) => { const q = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }); return q.result?.exceptionDetails ? { error: q.result.exceptionDetails.exception?.description } : q.result?.result?.value; }; return { send, ev }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gm = await page(GM), p2 = await page(P2);
const S = 'const A = game.modules.get("moinen-maps").api; ';
const state = () => p2.ev(`${S} const d = A.directorStage._debug(); return { cam: [Math.round(canvas.stage.pivot.x), Math.round(canvas.stage.pivot.y), +canvas.stage.scale.x.toFixed(3)], take: A.director.status().take?.kind ?? null, home: d.st.home, parked: d.st.parked, trace: d.trace.slice(-1) };`);
await p2.ev(`if (window.__SL) Hooks.off("moinenMapsDirector", window.__SL); window.__SLog = []; window.__SL = Hooks.on("moinenMapsDirector", (k, d) => { if (k === "end" || k === "shot") window.__SLog.push([Math.round(performance.now()), k, d.form, d.shot?.kind, d.why ?? null]); }); return 1;`);
await gm.ev(`await game.combat.startCombat(); return 1;`); await sleep(4000);
for (let i = 0; i < 4; i++) {
  await p2.ev(`canvas.pan({ x: 627, y: 684, scale: 2.2 }); return 1;`); await sleep(5600);
  const before = await state();
  await gm.ev(`await game.combat.nextTurn(); return 1;`); await sleep(900);
  const s = await state();
  if (s.take) { await gm.ev(`${S} await A.director.skip(); return 1;`); await sleep(1500); console.log("skip", JSON.stringify({ before: before.cam, during: s.cam, after: await state(), log: await p2.ev(`return window.__SLog.slice(-3);`) })); }
  else { console.log("no take", JSON.stringify(s)); await sleep(2800); }
}
await gm.ev(`for (const c of [...game.combats]) await c.delete(); return 1;`);
process.exit(0);
