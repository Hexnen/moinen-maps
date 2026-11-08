// a player's own wheel / pan right after a stage beat ended (while the director's screen still fades out)
const [port, GM, P2, DELAY = "300", KIND = "wheel"] = process.argv.slice(2);
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
async function page(prefix) { const t = (await list()).find((x) => x.type === "page" && x.url.startsWith(prefix)); const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r)); let id = 0; const pend = new Map(); ws.addEventListener("message", (m) => { const q = JSON.parse(m.data); if (q.id) pend.get(q.id)?.(q); }); const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }); const ev = async (js) => { const q = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }); return q.result?.exceptionDetails ? { error: q.result.exceptionDetails.exception?.description } : q.result?.result?.value; }; return { send, ev }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gm = await page(GM), p2 = await page(P2);
const S = 'const A = game.modules.get("moinen-maps").api; ';
const st = () => p2.ev(`${S} return { stage: A.directorStage.status(), screen: A.director.status().screen, cam: [Math.round(canvas.stage.pivot.x), Math.round(canvas.stage.pivot.y), +canvas.stage.scale.x.toFixed(3)], trace: A.directorStage._debug().trace.slice(-2) };`);
// park far away from everyone first
await p2.ev(`canvas.pan({ x: 200, y: 150, scale: 2.2 }); return 1;`); await sleep(5800);
console.log("next", await gm.ev("await game.combat.nextTurn(); return game.combat.combatant?.name;"));
// wait for the take to end
const end = await p2.ev(`return await new Promise((res) => { const h = Hooks.on("moinenMapsDirector", (k, d) => { if (k === "end") { Hooks.off("moinenMapsDirector", h); res([d.why, Math.round(performance.now())]); } }); setTimeout(() => res("timeout"), 8000); });`);
console.log("end", JSON.stringify(end));
await sleep(Number(DELAY));
console.log("screen at input", JSON.stringify(await st()));
if (KIND === "pan") await p2.ev(`canvas.pan({ x: 900, y: 300, scale: 2.2 }); return 1;`); if (KIND === "wheel") { await p2.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 900, y: 450 }); await p2.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 900, y: 450, deltaX: 0, deltaY: -300 }); }
await sleep(1200);
const after = await st(); console.log("after own input", JSON.stringify(after));
console.log("next", await gm.ev("await game.combat.nextTurn(); return game.combat.combatant?.name;"));
await sleep(3500);
console.log("next turn (within back=5s of own input)", JSON.stringify(await st()));
process.exit(0);
