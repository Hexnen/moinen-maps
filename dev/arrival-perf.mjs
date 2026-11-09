// ARRIVAL COST BENCH (node 22, a headless Chrome over CDP with a lane GM page and a REAL player page; see dev/tools/cdp-rec.mjs for
// starting the browser and opening the pages). What one scene switch costs the PLAYER, from the old scene's tearDown to +ms:
//   - frames: every rAF interval; the STALL = the longest interval from canvasReady to +4 s (the establishing frame), the longest
//     interval of the whole switch, frames over 50 ms after ready;
//   - the title card: when the Director inserts it (ms after canvasReady) and the first rAF after that (when it can be on screen);
//   - GL: texImage2D / texSubImage2D / compressedTexImage2D / generateMipmap calls and their ms (CPU side, as the page sees them);
//   - the CPU profile (sampling 100 us) of the stall: by part (moinen-maps inclusive = a module frame on the stack; Foundry; PIXI;
//     GL native; GC), the module's nearest functions, the top self functions.
// The player is moved with Foundry's own "pull to scene" (the GM's view stays where it is: one page loads at a time).
// Usage:
//   node dev/arrival-perf.mjs <cdpPort> <gmPrefix> <playerPrefix> <toScene> <backScene> [--reps n] [--throttle k] [--dir on|off|keep]
//        [--ms 9000] [--label s] [--out f.json]
// The world must be a lane copy (test-only). --dir switches the Director on / off for the run and puts it back as it was.
import fs from "node:fs";

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [port, gmPrefix, plPrefix, toName, backName] = args;
const reps = Number(flag("reps", 1)), throttle = Number(flag("throttle", 1)), dirArg = flag("dir", "keep"), label = flag("label", ""), outFile = flag("out", null);
const winMs = Number(flag("ms", 9000)), reload = args.includes("--reload");
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(prefix) {
  const t = (await (await fetch(`${base}/json/list`)).json()).find((x) => x.type === "page" && x.url.startsWith(prefix));
  if ( !t ) throw new Error(`no page ${prefix}`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (m) => { const q = JSON.parse(m.data); if ( q.id && pend.has(q.id) ) { pend.get(q.id)(q); pend.delete(q.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (js) => {
    const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if ( r.result?.exceptionDetails ) throw new Error(`${prefix}: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  };
  return { id: t.id, send, evaluate, close: () => ws.close() };
}

/* ---------------------------------------------------------------- page side (the player) */

const REC = `
if ( window.__arr?.on ) window.__arr.stop();
const S = { on: true, t0: performance.now(), raf: [], gl: { n: 0, ms: 0, max: 0, mipN: 0, mipMs: 0, calls: [] }, marks: {}, card: null, cardFrame: null, tick: [] };
const now = () => performance.now();
const mark = (k) => { S.marks[k] ??= now(); };
const f = (ts) => { if ( !S.on ) return; S.raf.push(now()); requestAnimationFrame(f); }; requestAnimationFrame(f);
const gl = canvas.app.renderer.gl, orig = {};
for ( const k of ["texImage2D", "texSubImage2D", "compressedTexImage2D", "generateMipmap"] ) {
  orig[k] = gl[k];
  gl[k] = function(...a) { const t = now(); try { return orig[k].apply(this, a); } finally { const ms = now() - t;
    if ( k === "generateMipmap" ) { S.gl.mipN++; S.gl.mipMs += ms; } else { S.gl.n++; S.gl.ms += ms; S.gl.max = Math.max(S.gl.max, ms); }
    if ( ms > 2 ) S.gl.calls.push([Math.round(t), k, +ms.toFixed(1), a.length >= 9 ? a[3] + "x" + a[4] : (a[6]?.width ?? a[5]?.width ?? "") + "x" + (a[6]?.height ?? a[5]?.height ?? "")]); } };
}
// program links: the wait for a link (getProgramParameter LINK_STATUS / COMPLETION) and which program it was (the fragment's first words)
S.prog = []; const linkAt = new Map();
for ( const k of ["linkProgram", "getProgramParameter"] ) {
  orig[k] = gl[k];
  gl[k] = function(p, q) { const t = now(); try { return orig[k].call(this, p, q); } finally { const ms = now() - t;
    if ( k === "linkProgram" ) linkAt.set(p, t);
    else if ( ms > 3 ) { let src = ""; try { const fs = orig.getAttachedShaders.call(gl, p).map((s) => orig.getShaderSource.call(gl, s)).find((x) => /gl_FragColor|out\\s+vec4|fragColor/.test(x ?? "")) ?? "";
      src = fs.replace(/#version[^\\n]*\\n|precision[^;]*;|#define[^\\n]*\\n|\\s+/g, " ").trim().slice(0, 140); } catch { }
      S.prog.push([Math.round(t), +ms.toFixed(1), q === gl.LINK_STATUS ? "link" : String(q), src, new Error().stack.split("\\n").slice(2, 9).map((l) => l.trim().replace(/^at /, "").replace(/https?:\\/\\/[^/]+\\//, "")).join(" < ")]); } } };
}
orig.getAttachedShaders = gl.getAttachedShaders; orig.getShaderSource = gl.getShaderSource;
const T = canvas.app.ticker, oU = T.update;
T.update = function(t) { const a = now(); try { return oU.call(this, t); } finally { if ( S.on ) S.tick.push([Math.round(a), +(now() - a).toFixed(1)]); } };
const hs = [["canvasTearDown", Hooks.on("canvasTearDown", () => mark("down"))], ["canvasInit", Hooks.on("canvasInit", () => mark("init"))],
  ["canvasReady", Hooks.on("canvasReady", () => mark("ready"))], ["canvasDraw", Hooks.on("canvasDraw", () => mark("draw"))]];
S.long = []; const lo = new PerformanceObserver((l) => { for ( const e of l.getEntries() ) S.long.push([Math.round(e.startTime), Math.round(e.duration)]); }); lo.observe({ type: "longtask" });
// the first canvasReady listener and the last one: the whole canvasReady dispatch
const evs = Hooks.events.canvasReady; const first = { fn: () => mark("readyFirst"), once: false, id: -1 }; evs?.unshift?.(first);
const mo = new MutationObserver((ms) => { for ( const m of ms ) for ( const n of m.addedNodes ) if ( n.classList?.contains("mm-dir-arr") && S.card == null ) {
  S.card = now(); requestAnimationFrame(() => { S.cardFrame = now(); }); } });
mo.observe(document.body, { childList: true, subtree: true });
S.stop = () => { S.on = false; for ( const k in orig ) gl[k] = orig[k]; T.update = oU; for ( const [h, id] of hs ) Hooks.off(h, id); mo.disconnect(); lo.disconnect();
  const i = Hooks.events.canvasReady?.indexOf(first); if ( i >= 0 ) Hooks.events.canvasReady.splice(i, 1);
  return { long: S.long, t0: S.t0, raf: S.raf.map((x) => +x.toFixed(1)), gl: S.gl, prog: S.prog, marks: S.marks, card: S.card, cardFrame: S.cardFrame, tick: S.tick, scene: canvas.scene?.name, arrival: game.modules.get("moinen-maps").api.director?.arrival?.status?.() ?? null }; };
window.__arr = S; return now();`;
/* ---------------------------------------------------------------- the profile */

function profileWindow(prof, a, b, syncAt) {
  // the page's performance.now() of profile time x (us): x/1000 - off. The sync: the busy loop's first sample.
  const nodes = new Map(prof.nodes.map((n) => [n.id, n])), parent = new Map();
  for ( const n of prof.nodes ) for ( const c of n.children ?? [] ) parent.set(c, n.id);
  let clock = prof.startTime, off = null;   // eslint-disable-line prefer-const
  const times = [];
  for ( let i = 0; i < prof.samples.length; i++ ) { clock += prof.timeDeltas[i] ?? 0; times.push(clock); }
  off = syncAt;                                 // (TimeTicks ms - performance.now(), measured round the run)
  if ( off == null ) return { error: "no sync" };
  const cat = (n) => {
    const u = n.callFrame.url, f = n.callFrame.functionName;
    if ( f === "(garbage collector)" ) return "gc";
    if ( f === "(program)" ) return "program";
    if ( f === "(idle)" ) return "idle";
    if ( /\/modules\/moinen-maps\//.test(u) ) return "mm";
    if ( /pixi/i.test(u) ) return "pixi";
    if ( /\/scripts\/foundry\.mjs|\/client\/|\/common\//.test(u) ) return "foundry";
    if ( /\/modules\//.test(u) ) return "otherMod";
    if ( u === "" && /^(texImage2D|texSubImage2D|compressedTexImage2D|generateMipmap|drawElements|bufferData|bufferSubData|readPixels|getError|uniform|linkProgram|compileShader)/.test(f) ) return "gl";
    return u === "" ? "native" : "other";
  };
  const memo = new Map();
  const chain = (id) => {                       // [mm frame nearest the leaf (or null), other module nearest, top category below]
    if ( memo.has(id) ) return memo.get(id);
    const n = nodes.get(id), p = parent.has(id) ? chain(parent.get(id)) : { mm: null, om: null };
    const c = cat(n);
    const r = { mm: c === "mm" ? n : p.mm, om: c === "otherMod" ? n : p.om };
    memo.set(id, r); return r;
  };
  const by = {}, mmFn = new Map(), self = new Map(), omFn = new Map();
  let total = 0;
  for ( let i = 0; i < prof.samples.length; i++ ) {
    const t = times[i] / 1000 - off;
    if ( t < a || t > b ) continue;
    const ms = (prof.timeDeltas[i + 1] ?? 0) / 1000, n = nodes.get(prof.samples[i]), c = cat(n);
    if ( c === "idle" ) continue;
    total += ms;
    const ch = chain(n.id);
    const k = ch.mm ? "mm" : ch.om ? "otherMod" : c;
    by[k] = (by[k] ?? 0) + ms;
    if ( ch.mm ) { const key = `${ch.mm.callFrame.url.split("/moinen-maps/")[1]}:${ch.mm.callFrame.functionName || "anon"}:${ch.mm.callFrame.lineNumber + 1}`; mmFn.set(key, (mmFn.get(key) ?? 0) + ms); }
    if ( ch.om && !ch.mm ) { const key = `${ch.om.callFrame.url.split("/modules/")[1]}:${ch.om.callFrame.functionName || "anon"}`; omFn.set(key, (omFn.get(key) ?? 0) + ms); }
    const sk = `${n.callFrame.functionName || "anon"} ${(n.callFrame.url.split("/").pop() || "native")}:${n.callFrame.lineNumber + 1}`;
    self.set(sk, (self.get(sk) ?? 0) + ms);
  }
  const top = (m, k = 12) => [...m].sort((x, y) => y[1] - x[1]).slice(0, k).map(([q, v]) => `${q} ${v.toFixed(1)}`);
  return { busy: +total.toFixed(1), by: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, +v.toFixed(1)])), mm: top(mmFn, 16), otherMods: top(omFn, 6), self: top(self, 16) };
}

/* ---------------------------------------------------------------- one switch */

function analyse(rec, prof) {
  const r = rec.raf, m = rec.marks, ready = m.ready ?? m.readyFirst;
  const gaps = []; for ( let i = 1; i < r.length; i++ ) gaps.push([r[i - 1], r[i] - r[i - 1]]);
  const after = gaps.filter(([t, g]) => t + g > ready && t < ready + 4000);
  const stall = after.reduce((x, y) => (y[1] > x[1] ? y : x), [ready, 0]);
  const all = gaps.filter(([t]) => t >= (m.down ?? rec.t0));
  const longest = all.reduce((x, y) => (y[1] > x[1] ? y : x), [0, 0]);
  const post = gaps.filter(([t]) => t >= ready);
  const ticks = rec.tick.filter(([t]) => t >= ready - 5);
  const firstTick = ticks[0] ?? null;
  const out = {
    scene: rec.scene, loadMs: m.down != null && ready != null ? Math.round(ready - m.down) : null,
    stallMs: +stall[1].toFixed(1), stallStartAfterReady: Math.round(stall[0] - ready),
    longestMs: +longest[1].toFixed(1), longestAt: Math.round(longest[0] - ready),
    over50AfterReady: post.filter(([, g]) => g > 50).length, over33AfterReady: post.filter(([, g]) => g > 33.4).length,
    firstFrameAfterReady: (() => { const g = gaps.find(([t, d]) => t + d > ready); return g ? Math.round(g[0] + g[1] - ready) : null; })(),
    firstTickMs: firstTick ? firstTick[1] : null, firstTickAt: firstTick ? Math.round(firstTick[0] - ready) : null,
    cardAt: rec.card != null ? Math.round(rec.card - ready) : null, cardFromDown: rec.cardFrame != null && m.down != null ? Math.round(rec.cardFrame - m.down) : null,
    marks: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v - ready)])),
    long: rec.long.filter(([t]) => t >= (m.down ?? 0) - 50).map(([t, d]) => [Math.round(t - ready), d]).slice(0, 14),
    ticks: ticks.slice(0, 10).map(([t, ms]) => [Math.round(t - ready), ms]), cardFrameAt: rec.cardFrame != null ? Math.round(rec.cardFrame - ready) : null,
    gl: { n: rec.gl.n, ms: +rec.gl.ms.toFixed(1), max: +rec.gl.max.toFixed(1), mipN: rec.gl.mipN, mipMs: +rec.gl.mipMs.toFixed(1),
      inStall: +rec.gl.calls.filter(([t]) => t >= stall[0] && t <= stall[0] + stall[1]).reduce((s, c) => s + c[2], 0).toFixed(1),
      big: rec.gl.calls.filter(([t]) => t >= stall[0] && t <= stall[0] + stall[1]).sort((a, b) => b[2] - a[2]).slice(0, 8).map((c) => `${c[1]} ${c[3]} ${c[2]}`) },
    progMs: +rec.prog.filter(([t]) => t >= (m.down ?? 0)).reduce((q, c) => q + c[1], 0).toFixed(1),
    progInStall: +rec.prog.filter(([t]) => t >= stall[0] && t <= stall[0] + stall[1]).reduce((q, c) => q + c[1], 0).toFixed(1),
    progs: rec.prog.filter(([t]) => t >= (m.down ?? 0)).map(([t, ms, q, src, st]) => ({ at: Math.round(t - ready), ms, src, st })),
    readyDispatch: m.readyFirst != null && m.ready != null ? +(m.ready - m.readyFirst).toFixed(1) : null,
    arrival: rec.arrival, warm: rec.warm,
    // a program link of > 400 ms anywhere in the switch: this run met a program-cache miss (cold) - reported apart
    cold: rec.prog.some(([t, ms]) => t >= (m.down ?? 0) && ms > 400) || (rec.warm?.warmMs ?? 0) > 1000
  };
  if ( prof ) {
    out.stallProf = profileWindow(prof, stall[0], stall[0] + stall[1], rec.syncAt);
    out.readyToFrameProf = profileWindow(prof, m.readyFirst ?? ready, ready + (out.firstFrameAfterReady ?? 0), rec.syncAt);
    out.postProf = profileWindow(prof, ready, ready + 4000, rec.syncAt);
    if ( firstTick ) out.firstTickProf = profileWindow(prof, firstTick[0], firstTick[0] + firstTick[1], rec.syncAt);
    out.dispatchProf = profileWindow(prof, m.readyFirst ?? ready, ready, rec.syncAt);
    if ( m.down != null ) out.loadProf = profileWindow(prof, m.down, m.readyFirst ?? ready, rec.syncAt);
  }
  return out;
}

const gm = await connect(gmPrefix), pl = await connect(plPrefix);
const ids = await gm.evaluate(`return { to: game.scenes.getName(${JSON.stringify(toName)})?.id, back: game.scenes.getName(${JSON.stringify(backName)})?.id, user: game.users.getName("Test Gracz 1")?.id, dir: game.modules.get("moinen-maps").api.director.isOn() };`);
if ( !ids.to || !ids.back ) throw new Error(`scenes? ${JSON.stringify(ids)}`);
const plUser = await pl.evaluate("return game.user.id;");
const pull = (sid) => gm.evaluate(`game.scenes.get(${JSON.stringify(sid)}).pullUsers([${JSON.stringify(plUser)}]); return true;`);
const dirWas = ids.dir;
if ( dirArg !== "keep" ) await gm.evaluate(`const D = game.modules.get("moinen-maps").api.director; await D.setOn(${dirArg === "on"}); if ( D.status().paused ) await D.setPaused(false); return D.isOn();`);
await pl.send("Page.bringToFront"); await pl.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await pl.send("Profiler.enable"); await pl.send("Profiler.setSamplingInterval", { interval: 100 });
const tsNow = async () => (await pl.send("Performance.getMetrics")).result.metrics.find((q) => q.name === "Timestamp").value * 1000;
const runs = [];
for ( let i = 0; i < reps; i++ ) {
  // start on the back scene, settled
  if ( (await pl.evaluate("return canvas.scene?.id;")) !== ids.back ) { await pull(ids.back); await sleep(9000); }
  if ( reload ) {
    // a fresh page on the back scene (a login): the arrival is then this page's first visit of the scene
    await pl.send("Page.reload", { ignoreCache: false });
    await sleep(4000);
    for ( let k = 0; k < 60; k++ ) { try { if ( await pl.evaluate("return !!(globalThis.game?.ready && canvas?.ready);") ) break; } catch { } await sleep(1000); }
    await sleep(10000);
  }
  await pl.evaluate(`await game.settings.set("moinen-maps", "dirMode", "auto"); for ( const a of [...foundry.applications.instances.values()] ) if ( a.hasFrame && a.rendered ) await a.close(); return true;`);
  await pl.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await sleep(1500);
  await pl.send("Profiler.start");
  await pl.send("Performance.enable", { timeDomain: "timeTicks" });
  const offs = [];
  for ( let k = 0; k < 5; k++ ) { const m0 = await tsNow(); const pn = await pl.evaluate("return performance.now();"); const m1 = await tsNow(); offs.push([m1 - m0, (m0 + m1) / 2 - pn]); }
  const syncAt = offs.sort((x, y) => x[0] - y[0])[0][1];
  await pl.evaluate(REC);
  await sleep(300);
  await pull(ids.to);
  await sleep(winMs);
  const rec = await pl.evaluate("return window.__arr.stop();"); rec.syncAt = syncAt;
  rec.warm = await pl.evaluate(`try { return { ...(await import("/modules/moinen-maps/scripts/load-warm.mjs")).stats }; } catch { return null; }`);
  const prof = (await pl.send("Profiler.stop")).result.profile;
  await pl.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const a = analyse(rec, prof);
  runs.push(a);
  console.error(`#${i + 1} ${a.scene}: load ${a.loadMs} stall ${a.stallMs} (+${a.stallStartAfterReady}) longest ${a.longestMs} (@${a.longestAt}) first frame +${a.firstFrameAfterReady} card ${a.cardAt}/${a.cardFrameAt} gl ${a.gl.ms}/${a.gl.n} inStall ${a.gl.inStall} >50 ${a.over50AfterReady}`);
  console.error(`   prog ${a.progMs} inStall ${a.progInStall}:`, a.progs.filter((p) => p.ms > 20).map((p) => `+${p.at} ${p.ms} [${p.src.slice(0, 60)}] ${p.st.slice(0, 160)}`).join(" | "));
  console.error("   stall by", JSON.stringify(a.stallProf?.by), "mm", JSON.stringify(a.stallProf?.mm?.slice(0, 6)));
  await pull(ids.back); await sleep(9000);
}
if ( dirArg !== "keep" ) await gm.evaluate(`await game.modules.get("moinen-maps").api.director.setOn(${dirWas}); return true;`);
const res = { label, throttle, dir: dirArg, to: toName, back: backName, at: new Date().toISOString(), runs };
if ( outFile ) fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
gm.close(); pl.close();
process.exit(0);
