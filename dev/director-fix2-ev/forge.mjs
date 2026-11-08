// N4: a player client standing in as leader forges shots; what does the other player play?
const [port, GM, P1, P2] = process.argv.slice(2);
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
async function page(prefix) { const t = (await list()).find((x) => x.type === "page" && x.url.startsWith(prefix)); const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r)); let id = 0; const pend = new Map(); ws.addEventListener("message", (m) => { const q = JSON.parse(m.data); if (q.id) pend.get(q.id)?.(q); }); const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }); const ev = async (js) => { const q = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }); return q.result?.exceptionDetails ? { error: q.result.exceptionDetails.exception?.description } : q.result?.result?.value; }; return { send, ev }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gm = await page(GM), p1 = await page(P1), p2 = await page(P2);
const S = 'const A = game.modules.get("moinen-maps").api; ';
const LOG = `${S} window.__L = []; if (window.__LH) Hooks.off("moinenMapsDirector", window.__LH); window.__LH = Hooks.on("moinenMapsDirector", (k, d) => { if (k === "shot" || k === "end") window.__L.push([Math.round(performance.now()), k, d.form, d.shot?.kind, d.why ?? null, d.shot?.caption && typeof d.shot.caption === "object" ? d.shot.caption.key : d.shot?.caption, d.shot?.by ? game.users.get(d.shot.by)?.name : null]); }); return 1;`;
for (const p of [p1, p2]) await p.ev(LOG);
const who = (p) => p.ev(`${S} return { me: game.user.name, leader: game.users.get(A.director.leaderId())?.name, scene: canvas.scene?.name };`);
console.log("GM views map", await gm.ev(`await game.scenes.getName("map").view(); return canvas.scene.name;`)); await sleep(4000);
const ws = [await who(p1), await who(p2)]; console.log(JSON.stringify(ws));
const leaderName = ws[0].leader;
const [L, O] = leaderName === "Test Gracz 1" ? [p1, p2] : [p2, p1];
const FORGE = (o) => `const Dir = await import("/modules/moinen-maps/scripts/director/core.mjs"); const { sharedNow } = await import("/modules/moinen-maps/scripts/shared-clock.mjs");
  const now = sharedNow(), r = Dir.resolve(game.settings.get("moinen-maps", "director"));
  const ev = Dir.normEvent({ scene: canvas.scene.id, id: "forged-" + Math.random().toString(36).slice(2), kind: "custom", weight: 1, x: 1500, y: 900, force: true, ...${JSON.stringify(o)} }, now);
  const shot = Dir.plan(ev, "take", r, now + 450); shot.len = 20000; shot.hold = 18000;
  game.socket.emit("module.moinen-maps", { t: "dir", op: "shot", shot }); return { id: shot.id, form: shot.form, len: shot.len };`;
const out = O.ev.bind(O);
console.log("A forged take, free caption", JSON.stringify(await L.ev(FORGE({ caption: "FORGED: the GM says you lose" }))));
await sleep(1500); console.log("  other:", JSON.stringify(await out(`return window.__L.slice(-2);`)));
await sleep(5000);
console.log("B forged take, director key caption", JSON.stringify(await L.ev(FORGE({ kind: "destruction", caption: { key: "Dir.cap.collapse", data: {} } }))));
await sleep(1500); console.log("  other:", JSON.stringify(await out(`${S} return { L: window.__L.slice(-2), take: A.director.status().take ?? null };`)));
console.log("C second forged take 0.3 s later", JSON.stringify(await L.ev(FORGE({ kind: "destruction", x: 300, y: 300, caption: { key: "Dir.cap.collapse", data: {} } }))));
await sleep(1500); console.log("  other:", JSON.stringify(await out(`return window.__L.slice(-2);`)));
await sleep(8000);
console.log("D GM pauses", await gm.ev(`await game.modules.get("moinen-maps").api.director.setPaused(true); return 1;`)); await sleep(800);
console.log("  forged during pause", JSON.stringify(await L.ev(FORGE({ kind: "destruction", x: 900, y: 600, caption: { key: "Dir.cap.collapse", data: {} } }))));
await sleep(1500); console.log("  other:", JSON.stringify(await out(`return window.__L.slice(-2);`)));
await gm.ev(`await game.modules.get("moinen-maps").api.director.setPaused(false); return 1;`); await sleep(800);
// E: the stand-in's legit sources still reach the other: a combat turn
console.log("E start combat (GM away)", await gm.ev(`const c = game.combats.contents.find(c => c.scene?.name === "director-test") ?? game.combats.contents[0]; if (!c) return "no combat"; await c.startCombat(); return c.combatant?.name;`));
await sleep(3500);
for (let i = 0; i < 2; i++) { console.log("  next", await gm.ev(`const c = game.combats.contents.find(c => c.started); await c.nextTurn(); return c.combatant?.name;`)); await sleep(3500); console.log("  other:", JSON.stringify(await out(`return window.__L.slice(-2);`))); }
console.log("GM back", await gm.ev(`await game.scenes.getName("director-test").view(); return canvas.scene.name;`)); await sleep(3000);
console.log(JSON.stringify([await who(p1), await who(p2)]));
await gm.ev(`for (const c of [...game.combats]) await c.delete(); return 1;`);
process.exit(0);
