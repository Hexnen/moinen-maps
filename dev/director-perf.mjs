// DIRECTOR COST BENCH (node 22, a headless Chrome over CDP with a lane GM page + REAL player pages; see dev/tools/cdp-rec.mjs for
// starting the browser and opening the pages). Per scenario, on every watched page at once:
//   - frames: rAF intervals (median, p95, frames over 33 ms), the PIXI ticker update per frame (median / p95 / max: the canvas CPU),
//     long animation frames >= 50 ms;
//   - the CPU profile (sampling 200 us): the Director's own JS (self, and INCLUSIVE = every sample with a scripts/director/ frame on
//     its stack: what it calls into, e.g. canvas.pan from a follow, forced layouts from getBoundingClientRect), the GC time;
//   - Chrome's Performance metrics deltas: layouts, style recalcs (count, ms), script ms, heap;
//   - the module socket: frames and bytes of "module.moinen-maps" sent / received.
// Usage:
//   node dev/director-perf.mjs <cdpPort> <gmUrl> <playerUrl>[,<playerUrl2>] <scenarios a,b,..> [--reps n] [--throttle k] [--label s] [--out f.json]
//   scenarios: rest, pan, take, soft, follow, attack, combat, busy, arrival, arrivalOff
// The world must be a lane copy (test-only): the scenarios switch the director on, move tokens, make combats and chat messages.
import fs from "node:fs";

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [port, gmUrl, playersArg, scenArg] = args;
const players = playersArg.split(",");
const scens = scenArg.split(",");
const dpr = Number(flag("dpr", 1)), reps = Number(flag("reps", 1)), throttle = Number(flag("throttle", 1)), label = flag("label", ""), outFile = flag("out", null);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(prefix) {
  const t = (await (await fetch(`${base}/json/list`)).json()).find((x) => x.type === "page" && x.url.startsWith(prefix));
  if ( !t ) throw new Error(`no page ${prefix}`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let id = 0; const pend = new Map(), on = new Map();
  ws.addEventListener("message", (m) => { const q = JSON.parse(m.data); if ( q.id && pend.has(q.id) ) { pend.get(q.id)(q); pend.delete(q.id); } else if ( q.method ) for ( const f of on.get(q.method) ?? [] ) f(q.params); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (js, wait = true) => {
    const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: wait, returnByValue: true, timeout: 120000 });
    if ( r.result?.exceptionDetails ) throw new Error(`${prefix}: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  };
  return { prefix, send, evaluate, on: (m, f) => { if ( !on.has(m) ) on.set(m, []); on.get(m).push(f); }, close: () => ws.close() };
}

/* ---------------------------------------------------------------- page side */

const REC = `
window.__dpStart = () => {
  const T = canvas.app.ticker, S = { raf: [], tick: [], loaf: [], t0: performance.now(), on: true };
  const o = T.update; T.update = function(t) { const a = performance.now(); try { return o.call(this, t); } finally { if ( S.on ) S.tick.push(performance.now() - a); } };
  let last = null; const f = (ts) => { if ( !S.on ) return; if ( last !== null ) S.raf.push(ts - last); last = ts; requestAnimationFrame(f); }; requestAnimationFrame(f);
  let po = null; try { po = new PerformanceObserver((l) => { for ( const e of l.getEntries() ) if ( e.duration >= 50 ) S.loaf.push({ ms: Math.round(e.duration), block: Math.round(e.blockingDuration ?? 0), style: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0),
    scripts: (e.scripts ?? []).filter((q) => q.duration > 5).map((q) => (q.sourceURL || "").split("/").slice(-2).join("/") + ":" + (q.sourceFunctionName || "") + ":" + Math.round(q.duration)).slice(0, 5) }); }); po.observe({ type: "long-animation-frame" }); } catch { }
  const hT = Hooks.once("canvasTearDown", () => { S.down = performance.now() - S.t0; }), hR = Hooks.on("canvasReady", () => { S.ready ??= performance.now() - S.t0; });
  S.stop = () => { S.on = false; Hooks.off("canvasTearDown", hT); Hooks.off("canvasReady", hR); T.update = o; po?.disconnect(); return { raf: S.raf, tick: S.tick, loaf: S.loaf, ms: performance.now() - S.t0, down: S.down ?? null, ready: S.ready ?? null }; };
  window.__dp = S; return true;
};`;

/* ---------------------------------------------------------------- GM-side scenario actions */

const A = {
  setup: `const D = game.modules.get("moinen-maps").api.director; if ( !D.isOn() ) await D.setOn(true);
    if ( D.status().paused ) await D.setPaused(false);
    if ( canvas.scene.tokenVision ) await canvas.scene.update({ tokenVision: false });
    for ( const c of [...game.combats] ) await c.delete();
    return D.status();`,
  // a heavy destruction event (take-over: letterbox, vignette, flash, shake, caption) far from the players' view
  take: (i) => `game.modules.get("moinen-maps").api.director.emit({ kind: "destruction", weight: 1, force: true, x: ${3600 - (i % 3) * 300}, y: ${900 + (i % 2) * 400}, box: { x0: ${3300 - (i % 3) * 300}, y0: ${700 + (i % 2) * 400}, x1: ${3900 - (i % 3) * 300}, y1: ${1100 + (i % 2) * 400} }, caption: { key: "Dir.cap.collapse", data: {} } }); return true;`,
  move: (i) => `const d = canvas.scene.tokens.get("sYce4RTsRN35qzSP"); const to = d.x < 2000 ? 4200 : 700; await d.update({ x: to, y: 1050 }); return to;`,
  moveBack: `const d = canvas.scene.tokens.get("sYce4RTsRN35qzSP"); await d.update({ x: 700, y: 1050 }, { animate: false }); return true;`,
  attack: `const tok = canvas.tokens.get("g6EcTYucya8eklEZ");
    for ( const t of [...game.user.targets] ) t.setTarget(false, { releaseOthers: false });
    canvas.tokens.get("xvGY6hI8aVlS1L5H").setTarget(true, { releaseOthers: false });
    const Y = CONFIG.Dice.rolls.find((r) => r.name === "YearZeroRoll");
    const roll = await new Y("4db", { maxPush: 1 }, { damage: 3, attackType: "shooting", minRange: 0, maxRange: 3, breakdown: [], stressCost: 0, actualDamage: true }).roll();
    const msg = await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token: tok.document }), flavor: "Concussion Blast" }, { rollMode: "publicroll" });
    for ( const t of [...game.user.targets] ) t.setTarget(false, { releaseOthers: false });
    return roll.successCount;`,
  combat: `const W = (ms) => new Promise((r) => setTimeout(r, ms));
    const ids = ["xvGY6hI8aVlS1L5H", "j7A4bctOMNXwJKYA", "g6EcTYucya8eklEZ", "sYce4RTsRN35qzSP"];
    const c = await Combat.create({ scene: canvas.scene.id, active: true });
    await c.createEmbeddedDocuments("Combatant", ids.map((id, k) => ({ tokenId: id, sceneId: canvas.scene.id, actorId: canvas.scene.tokens.get(id).actorId, initiative: 40 - k * 10 })));
    await c.update({ turn: 0 }); await Promise.race([c.startCombat(), W(3000)]);
    if ( c.combatant?.tokenId !== "xvGY6hI8aVlS1L5H" ) await c.update({ turn: 0 });
    await W(3500); await c.nextTurn();                                         // Omni-Man
    await W(2500); await canvas.scene.tokens.get("j7A4bctOMNXwJKYA").update({ x: 3500, y: 4200 });
    await W(4500); await c.nextTurn();                                         // turret
    await W(2500);
    { const tok = canvas.tokens.get("g6EcTYucya8eklEZ"); canvas.tokens.get("j7A4bctOMNXwJKYA").setTarget(true, { releaseOthers: true });
      const Y = CONFIG.Dice.rolls.find((r) => r.name === "YearZeroRoll");
      const roll = await new Y("4db", { maxPush: 1 }, { damage: 3, attackType: "shooting", minRange: 0, maxRange: 3, breakdown: [], stressCost: 0, actualDamage: true }).roll();
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token: tok.document }), flavor: "Concussion Blast" }, { rollMode: "publicroll" });
      for ( const t of [...game.user.targets] ) t.setTarget(false, { releaseOthers: false }); }
    await W(8000); await c.nextTurn();                                         // scientists
    await W(3000); await c.nextTurn();                                         // round 2: Kid (TG1's own turn)
    await W(3500); await c.delete(); await W(3000);
    await canvas.scene.tokens.get("j7A4bctOMNXwJKYA").update({ x: 2100, y: 5250 }, { animate: false });
    return true;`,
  // busy events: token flag updates, small token moves, chat messages, combat updates (no shots expected from most of them)
  busy: `const W = (ms) => new Promise((r) => setTimeout(r, ms));
    const ids = canvas.scene.tokens.filter((d) => !d.hidden).map((d) => d.id);
    for ( let k = 0; k < 20; k++ ) { await canvas.scene.updateEmbeddedDocuments("Token", ids.map((id) => ({ _id: id, "flags.world.dpTick": k }))); await W(60); }
    for ( let k = 0; k < 30; k++ ) { await ChatMessage.create({ content: "dp " + k }); await W(40); }
    const c = await Combat.create({ scene: canvas.scene.id, active: false });
    await c.createEmbeddedDocuments("Combatant", ids.slice(0, 4).map((id) => ({ tokenId: id, sceneId: canvas.scene.id, actorId: canvas.scene.tokens.get(id).actorId })));
    for ( let k = 0; k < 20; k++ ) { await c.updateEmbeddedDocuments("Combatant", c.combatants.map((cb) => ({ _id: cb.id, initiative: (k * 7 + cb.id.charCodeAt(0)) % 30 }))); await W(40); }
    await c.delete();
    return true;`,
  arrival: `const to = game.scenes.getName("street"); await to.activate(); return to.id;`,
  arrivalBack: `const to = game.scenes.getName("ZZ-dir-rolls"); await to.activate(); return to.id;`,
  dirOff: `await game.modules.get("moinen-maps").api.director.setOn(false); return true;`,
  dirOn: `await game.modules.get("moinen-maps").api.director.setOn(true); return true;`
};
// player-side setup: a view of its own (near Kid Omni-Man), mode full
const PLAYER_HOME = `for ( const a of [...foundry.applications.instances.values()] ) if ( a.hasFrame && a.rendered ) await a.close(); await game.settings.set("moinen-maps", "dirMode", "auto"); await canvas.animatePan({ x: 1500, y: 5300, scale: 0.6, duration: 0 }); return { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };`;

/* ---------------------------------------------------------------- measuring */

const SCEN = {
  rest: { ms: 6000 },
  pan: { ms: 6000, player: `for ( let k = 0; k < 4; k++ ) await canvas.animatePan({ x: 1500 + (k % 2 ? 900 : 0), y: 5300 - (k % 2 ? 600 : 0), scale: 0.6, duration: 1300 }); return true;` },
  take: { ms: 7500, gm: (i) => A.take(i) },
  soft: { ms: 7000, pre: `await game.settings.set("moinen-maps", "dirMode", "soft"); return true;`, gm: (i) => A.take(i + 7),
    player: `await new Promise((r) => setTimeout(r, 900)); for ( let k = 0; k < 3; k++ ) await canvas.animatePan({ x: 1500 + (k % 2 ? 700 : 0), y: 5300 - (k % 2 ? 500 : 0), scale: 0.6, duration: 1400 }); return true;`,
    post: `await game.settings.set("moinen-maps", "dirMode", "auto"); return true;` },
  follow: { ms: 9000, gm: () => A.move() },
  attack: { ms: 14000, gm: () => A.attack },
  combat: { ms: 46000, gm: () => A.combat },
  busy: { ms: 12000, gm: () => A.busy },
  arrival: { ms: 9000, gm: () => A.arrival, gmPost: A.arrivalBack, settleAfter: 9000 },
  arrivalOff: { ms: 9000, gmPre: A.dirOff, gm: () => A.arrival, gmPost: A.arrivalBack + "", gmPost2: A.dirOn, settleAfter: 9000 }
};

const pct = (a, p) => { if ( !a.length ) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))].toFixed(2); };

function profileSum(prof) {
  const nodes = new Map(prof.nodes.map((n) => [n.id, n])), parent = new Map();
  for ( const n of prof.nodes ) for ( const c of n.children ?? [] ) parent.set(c, n.id);
  const isDir = (n) => /\/scripts\/director\//.test(n.callFrame.url);
  const isMM = (n) => /\/modules\/moinen-maps\//.test(n.callFrame.url);
  const memo = new Map();
  const under = (id) => {                          // [director on the stack, moinen-maps on the stack]
    if ( memo.has(id) ) return memo.get(id);
    const n = nodes.get(id); const p = parent.has(id) ? under(parent.get(id)) : [false, false];
    const r = [p[0] || isDir(n), p[1] || isMM(n)]; memo.set(id, r); return r;
  };
  const nearest = new Map();                       // node -> the nearest director frame at or above it (the director code that caused it)
  const near = (id) => { if ( nearest.has(id) ) return nearest.get(id); const n = nodes.get(id); const r = isDir(n) ? n : parent.has(id) ? near(parent.get(id)) : null; nearest.set(id, r); return r; };
  const byCaller = new Map();
  let run = 0, runMax = 0, cur = new Map(), best = null;                         // the longest unbroken stretch of director samples (one task: a frame spike)
  let total = 0, dirSelf = 0, dirIncl = 0, mmIncl = 0, gc = 0, idle = 0; const byFn = new Map();
  const dt = prof.timeDeltas;
  for ( let i = 0; i < prof.samples.length; i++ ) {
    const ms = (dt[i + 1] ?? dt[i] ?? 0) / 1000, n = nodes.get(prof.samples[i]); total += ms;
    const fn = n.callFrame.functionName;
    if ( fn === "(idle)" ) { idle += ms; run = 0; continue; }
    if ( fn === "(garbage collector)" ) gc += ms;
    const [d, m] = under(n.id);
    if ( d ) { run += ms; const c = near(n.id), k = c ? `${c.callFrame.url.split("/").pop()}:${c.callFrame.functionName || "anon"}` : "?", k2 = isDir(n) ? k : `${k}>${fn}`; cur.set(k2, (cur.get(k2) ?? 0) + ms); if ( run > runMax ) { runMax = run; best = new Map(cur); } }
    else if ( fn !== "(garbage collector)" && fn !== "(program)" ) { run = 0; cur = new Map(); }
    if ( d ) { dirIncl += ms; const c = near(n.id); if ( c ) { const k = `${c.callFrame.url.split("/").pop()}:${c.callFrame.functionName || "anon"}:${c.callFrame.lineNumber + 1}`; byCaller.set(k, (byCaller.get(k) ?? 0) + ms); } }
    if ( m ) mmIncl += ms;
    if ( isDir(n) ) { dirSelf += ms; const k = `${n.callFrame.url.split("/").pop()}:${fn || "anon"}:${n.callFrame.lineNumber + 1}`; byFn.set(k, (byFn.get(k) ?? 0) + ms); }
    else if ( d ) { const k = `> ${(n.callFrame.url.split("/").pop() || "native")}:${fn || "anon"}`; byFn.set(k, (byFn.get(k) ?? 0) + ms); }
  }
  const top = [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v.toFixed(1)}`);
  const callers = [...byCaller].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v.toFixed(1)}`);
  return { callers, runParts: best ? [...best].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v.toFixed(1)}`) : [], dirRunMax: +runMax.toFixed(1), busyMs: +(total - idle).toFixed(1), dirSelfMs: +dirSelf.toFixed(2), dirInclMs: +dirIncl.toFixed(2), mmInclMs: +mmIncl.toFixed(1), gcMs: +gc.toFixed(1), top };
}
const METRICS = ["LayoutCount", "RecalcStyleCount", "LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration", "JSHeapUsedSize"];
const metrics = async (p) => Object.fromEntries((await p.send("Performance.getMetrics")).result.metrics.filter((m) => METRICS.includes(m.name)).map((m) => [m.name, m.value]));

async function attach(prefix) {
  const p = await connect(prefix);
  await p.send("Performance.enable", { timeDomain: "timeTicks" });
  await p.send("Profiler.enable"); await p.send("Profiler.setSamplingInterval", { interval: 200 });
  await p.send("Network.enable");
  p.sock = { sent: 0, sentB: 0, recv: 0, recvB: 0, on: false };
  const count = (dir) => (q) => { if ( !p.sock.on ) return; const s = q.response?.payloadData ?? ""; if ( !s.includes("module.moinen-maps") ) return; p.sock[dir]++; p.sock[dir + "B"] += s.length; };
  p.on("Network.webSocketFrameSent", count("sent")); p.on("Network.webSocketFrameReceived", count("recv"));
  return p;
}

async function measure(pages, sc, i) {
  for ( const p of pages ) { await p.evaluate(REC + "return true;"); }
  for ( const p of pages ) if ( p.role === "player" && sc.pre ) await p.evaluate(sc.pre);
  if ( sc.gmPre ) await pages[0].evaluate(sc.gmPre);
  await sleep(sc.gmPre ? 1500 : 300);
  const m0 = [];
  for ( const p of pages ) { p.sock = { sent: 0, sentB: 0, recv: 0, recvB: 0, on: true }; m0.push(await metrics(p)); await p.send("Profiler.start"); await p.evaluate("return window.__dpStart();"); }
  if ( sc.gm ) pages[0].evaluate(sc.gm(i)).catch((e) => console.error("gm", e.message));
  if ( sc.player ) for ( const p of pages ) if ( p.role === "player" ) p.evaluate(sc.player).catch((e) => console.error("player", e.message));
  await sleep(sc.ms);
  const out = [];
  for ( const [k, p] of pages.entries() ) {
    let rec = null; try { rec = await p.evaluate("return window.__dp?.stop?.() ?? null;"); } catch ( err ) { rec = null; }
    const prof = (await p.send("Profiler.stop")).result.profile, m1 = await metrics(p);
    p.sock.on = false;
    const d = (n) => +((m1[n] ?? 0) - (m0[k][n] ?? 0)).toFixed(n.endsWith("Duration") ? 4 : 0);
    out.push({ page: p.name, rec, prof: profileSum(prof), m: { layouts: d("LayoutCount"), styles: d("RecalcStyleCount"), layoutMs: +(d("LayoutDuration") * 1000).toFixed(1), styleMs: +(d("RecalcStyleDuration") * 1000).toFixed(1), scriptMs: +(d("ScriptDuration") * 1000).toFixed(0), heapMB: +(d("JSHeapUsedSize") / 1048576).toFixed(2) }, sock: { ...p.sock } });
  }
  for ( const p of pages ) if ( p.role === "player" && sc.post ) await p.evaluate(sc.post);
  return out;
}

function summary(runs) {
  // merge reps per page
  const by = new Map();
  for ( const run of runs ) for ( const r of run ) { if ( !by.has(r.page) ) by.set(r.page, []); by.get(r.page).push(r); }
  const res = {};
  for ( const [page, rs] of by ) {
    const raf = rs.flatMap((r) => r.rec?.raf ?? []), tick = rs.flatMap((r) => r.rec?.tick ?? []), loaf = rs.flatMap((r) => r.rec?.loaf ?? []);
    const sum = (f) => +rs.reduce((s, r) => s + f(r), 0).toFixed(2), n = rs.length;
    res[page] = {
      frames: raf.length, rafP50: pct(raf, 0.5), rafP95: pct(raf, 0.95), over33: raf.filter((x) => x > 33.4).length, over50: raf.filter((x) => x > 50).length,
      tickP50: pct(tick, 0.5), tickP95: pct(tick, 0.95), tickMax: tick.length ? +Math.max(...tick).toFixed(1) : null, loaf50: loaf.length, loafMax: loaf.length ? Math.max(...loaf.map((l) => l.ms)) : 0,
      dirSelfMs: +(sum((r) => r.prof.dirSelfMs) / n).toFixed(2), dirRunMax: Math.max(...rs.map((r) => r.prof.dirRunMax ?? 0)), dirInclMs: +(sum((r) => r.prof.dirInclMs) / n).toFixed(2), mmInclMs: +(sum((r) => r.prof.mmInclMs) / n).toFixed(1), gcMs: +(sum((r) => r.prof.gcMs) / n).toFixed(1), busyMs: +(sum((r) => r.prof.busyMs) / n).toFixed(0),
      layouts: Math.round(sum((r) => r.m.layouts) / n), styles: Math.round(sum((r) => r.m.styles) / n), layoutMs: +(sum((r) => r.m.layoutMs) / n).toFixed(1), styleMs: +(sum((r) => r.m.styleMs) / n).toFixed(1), heapMB: +(sum((r) => r.m.heapMB) / n).toFixed(2),
      sock: { sent: sum((r) => r.sock.sent) / n, sentB: Math.round(sum((r) => r.sock.sentB) / n), recv: sum((r) => r.sock.recv) / n, recvB: Math.round(sum((r) => r.sock.recvB) / n) },
      callers: rs[0].prof.callers, runParts: rs.reduce((m, r) => ((r.prof.dirRunMax ?? 0) >= (m.v ?? -1) ? { v: r.prof.dirRunMax, p: r.prof.runParts } : m), {}).p, load: rs.map((r) => (r.rec?.ready != null && r.rec?.down != null ? Math.round(r.rec.ready - r.rec.down) : null)), top: rs[0].prof.top, loafs: loaf.slice(0, 4)
    };
  }
  return res;
}

const pages = [];
const gm = await attach(gmUrl); gm.name = "gm"; gm.role = "gm"; pages.push(gm);
for ( const [k, u] of players.entries() ) { const p = await attach(u); p.name = `p${k + 1}`; p.role = "player"; pages.push(p); }
await gm.evaluate(A.setup);
for ( const p of pages ) if ( p.role === "player" ) {
  await p.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  if ( dpr !== 1 ) {
    await p.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: dpr, mobile: false });
    await p.evaluate(`await new Promise((r) => setTimeout(r, 500)); const R = canvas.app.renderer; R.resolution = ${dpr}; R.resize(innerWidth, innerHeight); window.dispatchEvent(new Event("resize")); await new Promise((r) => setTimeout(r, 1500)); return [devicePixelRatio, R.view.width];`);
  }
}
const result = { label, throttle, dpr, at: new Date().toISOString(), scen: {} };
for ( const s of scens ) {
  const sc = SCEN[s]; if ( !sc ) { console.error("unknown scenario", s); continue; }
  const runs = [];
  for ( let i = 0; i < reps; i++ ) {
    for ( const p of pages ) if ( p.role === "player" ) await p.evaluate(PLAYER_HOME);
    await sleep(800);
    runs.push(await measure(pages, sc, i));
    if ( sc.gmPost ) { await gm.evaluate(sc.gmPost); await sleep(sc.settleAfter ?? 3000); }
    if ( sc.gmPost2 ) { await gm.evaluate(sc.gmPost2); await sleep(1000); }
    await sleep(s === "take" || s === "soft" ? 2500 : 1500);
  }
  result.scen[s] = summary(runs);
  console.error(s, JSON.stringify(Object.fromEntries(Object.entries(result.scen[s]).map(([k, v]) => [k, { tick: [v.tickP50, v.tickP95, v.tickMax], raf: [v.rafP50, v.rafP95, v.over33], loaf: v.loaf50, dir: [v.dirSelfMs, v.dirInclMs], gc: v.gcMs, lay: [v.layouts, v.layoutMs], sty: [v.styles, v.styleMs], sock: v.sock }]))));
}
for ( const p of pages ) {
  if ( p.role === "player" ) {
    await p.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    if ( dpr !== 1 ) { await p.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }); await p.evaluate(`const R = canvas.app.renderer; R.resolution = 1; R.resize(innerWidth, innerHeight); window.dispatchEvent(new Event("resize")); return true;`); }
  }
  p.close();
}
if ( outFile ) fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result.scen, (k, v) => (k === "loafs" ? undefined : v)));
process.exit(0);
