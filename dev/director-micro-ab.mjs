// DIRECTOR MICRO A/B (node 22, a headless Chrome over CDP, a lane PLAYER page). Each case isolates one thing a change touched and
// runs it the same way on whichever build the lane serves, so two runs (junction flipped + reload between) compare the builds without
// the machine noise of a whole scenario. Per case: Chrome's LayoutCount / RecalcStyleCount / LayoutDuration deltas, the frames
// (rAF intervals) over 16.7 / 20 / 33 ms and the worst one, and the case's own numbers.
//   node dev/director-micro-ab.mjs <cdpPort> <playerUrlPrefix> [--throttle 2] [--reps 3] [--out f.json] [--cases a,b]
// Cases:
//   impacts  a take-over screen (bars, vignette, flash, shake) and 12 impacts during a 3 s camera pan (each impact: flash + shake start)
//   captions three take-over captions placed from kept hit answers during a 3 s camera pan (the live re-check runs after each)
//   card     the arrival title card (its 2.6 s transitions) for 3 s, the page otherwise at rest (needs an arrival played on this page)
//   pan      the 3 s camera pan alone (the control for impacts / captions)
import fs from "node:fs";
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [port, pref] = args;
const rate = Number(flag("throttle", 2)), reps = Number(flag("reps", 3)), outFile = flag("out", null), cases = flag("cases", "pan,impacts,captions,card").split(",");
const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === "page" && x.url.startsWith(pref));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); ws.addEventListener("message", (m) => { const q = JSON.parse(m.data); if ( pend.has(q.id) ) { pend.get(q.id)(q); pend.delete(q.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (js) => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true, timeout: 60000 }); if ( r.result?.exceptionDetails ) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
const M = async () => Object.fromEntries((await send("Performance.getMetrics")).result.metrics.map((m) => [m.name, m.value]));
await send("Performance.enable");

const PRE = `
const API = game.modules.get("moinen-maps").api, Ov = await import("/modules/moinen-maps/scripts/director/overlay.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for ( const a of [...foundry.applications.instances.values()] ) if ( a.hasFrame && a.rendered ) await a.close();
const H = { x: 1500, y: 5300, scale: 0.6 };
const frames = []; let last = null, on = true; const f = (ts) => { if ( !on ) return; if ( last !== null ) frames.push(ts - last); last = ts; requestAnimationFrame(f); };
const pan = () => canvas.animatePan({ x: H.x + 900, y: H.y - 500, scale: 0.75, duration: 3000 });
const done = (extra = {}) => { on = false; return { frames: frames.length, over17: frames.filter((x) => x > 16.7).length, over20: frames.filter((x) => x > 20).length, over33: frames.filter((x) => x > 33.4).length, max: +Math.max(0, ...frames).toFixed(1), ...extra }; };
`;
const CASE = {
  pan: `await canvas.animatePan({ ...H, duration: 0 }); await sleep(400); requestAnimationFrame(f); await pan(); return done();`,
  impacts: `await canvas.animatePan({ ...H, duration: 0 }); await sleep(400);
    const look = { fx: true, lbOn: true, vgOn: true, flOn: true, shOn: true, smOn: false, camOn: false };
    API.cinematic.begin({ r: look }, { owner: "director", guard: false, frame: false, opts: { noCamera: true } });
    requestAnimationFrame(f);
    let n = 0, ms = 0; const h = Hooks.on("canvasPan", () => { if ( ++n % 14 ) return; const a = performance.now(); API.cinematic.impact({ x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, size: 160 }); ms += performance.now() - a; });
    await pan(); Hooks.off("canvasPan", h);
    await API.cinematic.end({ immediate: true });
    return done({ impacts: Math.floor(n / 14), impactMs: +ms.toFixed(2) });`,
  captions: `await canvas.animatePan({ ...H, duration: 0 }); await sleep(400);
    // (kept answers first: one caption of each text placed and gone, as the warm-up / an earlier shot leaves them)
    const T = ["Zone 1 collapses", "Atom Eve hits Battle Beast for 3 damage", "The street floods"];
    for ( const title of T ) { const c = Ov.caption({ kick: "Destruction", title, icon: "fa-solid fa-burst", lb: 12, hint: "Esc" }); for ( let i = 0; i < 300 && !c.shown; i++ ) await sleep(20); await sleep(1500); c.remove(); }
    await sleep(300);
    requestAnimationFrame(f);
    const p = pan(), shown = [];
    for ( const title of T ) { const t0 = performance.now(), c = Ov.caption({ kick: "Destruction", title, icon: "fa-solid fa-burst", lb: 12, hint: "Esc" }); for ( let i = 0; i < 300 && !c.shown; i++ ) await sleep(5); shown.push(Math.round(performance.now() - t0)); await sleep(900); c.out(200); }
    await p; await sleep(300);
    return done({ shownMs: shown });`,
  card: `if ( !document.querySelector("style[data-mm-dir-arr]") ) return { skipped: "no arrival stylesheet" };
    await canvas.animatePan({ ...H, duration: 0 }); await sleep(400);
    const ui = document.getElementById("interface"), el = document.createElement("div"); el.className = "mm-dir-arr";
    el.innerHTML = '<div class="mm-dir-arr-card"><div class="mm-dir-arr-kick">Orbit</div><div class="mm-dir-arr-title">ZZ-dir-rolls street</div><div class="mm-dir-arr-rule"></div><div class="mm-dir-arr-sub">Night falls</div></div>';
    requestAnimationFrame(f);
    ui.parentNode.insertBefore(el, ui); void getComputedStyle(el).opacity; el.classList.add("is-in");
    await sleep(3000); el.remove();
    return done({ contain: getComputedStyle(document.body).contain !== undefined ? (document.querySelector("style[data-mm-dir-arr]").textContent.includes("contain: strict") ? "strict" : "none") : "?" });`
};
await send("Emulation.setCPUThrottlingRate", { rate });
const res = { rate, reps, at: new Date().toISOString(), build: await ev(`return typeof (await import("/modules/moinen-maps/scripts/director/overlay.mjs")).idleSliced === "function" ? "after" : "before";`), cases: {} };
for ( const c of cases ) {
  const runs = [];
  for ( let i = 0; i < reps; i++ ) {
    const a = await M();
    const r = await ev(PRE + CASE[c]);
    const b = await M();
    runs.push({ ...r, layouts: b.LayoutCount - a.LayoutCount, styles: b.RecalcStyleCount - a.RecalcStyleCount, layoutMs: +((b.LayoutDuration - a.LayoutDuration) * 1000).toFixed(1), styleMs: +((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000).toFixed(1), scriptMs: +((b.ScriptDuration - a.ScriptDuration) * 1000).toFixed(1) });
    await new Promise((r) => setTimeout(r, 800));
  }
  const med = (k) => { const v = runs.map((r) => r[k]).filter((x) => typeof x === "number").sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
  res.cases[c] = { median: Object.fromEntries(["frames", "over17", "over20", "over33", "max", "layouts", "layoutMs", "styles", "styleMs", "scriptMs", "impactMs"].map((k) => [k, med(k)])), runs };
  console.error(c, JSON.stringify(res.cases[c].median));
}
await send("Emulation.setCPUThrottlingRate", { rate: 1 });
await ev(`await canvas.animatePan({ x: 1500, y: 5300, scale: 0.6, duration: 0 }); return 1;`);
if ( outFile ) fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ build: res.build, rate, ...Object.fromEntries(Object.entries(res.cases).map(([k, v]) => [k, v.median])) }));
process.exit(0);
