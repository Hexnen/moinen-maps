// node bench.mjs <scen,scen> [--throttle 2] [--reps 3] [--out f.json] [--prof 0|1]
// scen: glide (4x animatePan 1300 ms), drag (right-button drag pans via CDP input, 4 strokes), take (GM director take-over far away),
//       follow (GM moves a token, director follow), rest
import fs from "node:fs"; import { page, sleep } from "./lib.mjs";
const args = process.argv.slice(2); const flag = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const scens = args[0].split(","); const rate = +flag("throttle", 2), reps = +flag("reps", 3), out = flag("out", null), profOn = flag("prof", "1") === "1";
const needG = scens.some((s) => s === "take" || s === "follow");
const P = await page("http://127.0.0.152"), G = needG ? await page("http://127.0.0.151") : null;
await P.send("Performance.enable"); await P.send("Profiler.enable"); await P.send("Profiler.setSamplingInterval", { interval: 200 });
const HOME = `for ( const a of [...foundry.applications.instances.values()] ) if ( a.hasFrame && a.rendered ) await a.close(); await canvas.animatePan({ x: 1500, y: 5300, scale: 0.6, duration: 0 }); await new Promise((r) => setTimeout(r, 900)); return 1;`;
const INST = `const S = window.__ib = { pans: 0, pm: 0, loafFl: 0, loaf: [] };
  S.h = Hooks.on("canvasPan", () => S.pans++);
  const pm = () => S.pm++; canvas.app.view.addEventListener("pointermove", pm, { capture: true, passive: true }); S.pmf = pm;
  S.po = new PerformanceObserver((l) => { for ( const e of l.getEntries() ) for ( const q of e.scripts ?? [] ) { S.loafFl += q.forcedStyleAndLayoutDuration; if ( q.forcedStyleAndLayoutDuration > 1 ) S.loaf.push((q.sourceURL || "").split("/").slice(-2).join("/") + ":" + q.sourceFunctionName + ":" + Math.round(q.forcedStyleAndLayoutDuration)); } });
  S.po.observe({ type: "long-animation-frame" });
  window.__fr = []; let l = null; window.__on = true; const f = (t) => { if ( !window.__on ) return; if ( l !== null ) window.__fr.push(t - l); l = t; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1;`;
const UNINST = `const S = window.__ib; Hooks.off("canvasPan", S.h); canvas.app.view.removeEventListener("pointermove", S.pmf, { capture: true }); S.po.disconnect(); window.__on = false;
  const fr = window.__fr, s = [...fr].sort((a, b) => a - b);
  return { pans: S.pans, pm: S.pm, loafFl: Math.round(S.loafFl), loafTop: S.loaf.slice(0, 6), frames: fr.length, over17: fr.filter((x) => x > 16.8).length, over33: fr.filter((x) => x > 33.4).length, max: +Math.max(...fr).toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1) };`;
async function drag() {
  const m = (type, x, y, extra = {}) => P.send("Input.dispatchMouseEvent", { type, x, y, button: "right", buttons: type === "mouseReleased" ? 0 : 2, ...extra });
  for ( let k = 0; k < 4; k++ ) {
    const dx = k % 2 ? 1 : -1, x0 = 800 - dx * 300, y0 = 450 - dx * 150;
    await P.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y: y0, button: "none", buttons: 0 });
    await m("mousePressed", x0, y0, { clickCount: 1 });
    for ( let i = 1; i <= 60; i++ ) { await m("mouseMoved", x0 + dx * 10 * i, y0 + dx * 5 * i); await sleep(16); }
    await m("mouseReleased", x0 + dx * 600, y0 + dx * 300, { clickCount: 1 });
    await sleep(150);
  }
}
const SC = {
  rest: async () => sleep(6000),
  glide: async () => P.ev(`for ( let k = 0; k < 4; k++ ) await canvas.animatePan({ x: 1500 + (k % 2 ? 900 : 0), y: 5300 - (k % 2 ? 600 : 0), scale: 0.6, duration: 1300 }); return 1;`),
  drag,
  take: async (i) => { await G.ev(`game.modules.get("moinen-maps").api.director.emit({ kind: "destruction", weight: 1, force: true, x: ${3600 - (i % 3) * 300}, y: ${900 + (i % 2) * 400}, box: { x0: ${3300 - (i % 3) * 300}, y0: ${700 + (i % 2) * 400}, x1: ${3900 - (i % 3) * 300}, y1: ${1100 + (i % 2) * 400} }, caption: { key: "Dir.cap.collapse", data: {} } }); return 1;`); await sleep(7500); },
  follow: async () => { await G.ev(`const d = canvas.scene.tokens.get("sYce4RTsRN35qzSP"); const to = d.x < 2000 ? 4200 : 700; await d.update({ x: to, y: 1050 }); return to;`); await sleep(9000); },
};
const M = async () => Object.fromEntries((await P.send("Performance.getMetrics")).result.metrics.map((m) => [m.name, m.value]));
const bucket = (url) => { if ( !url ) return "(native)"; const m = url.match(/\/modules\/([^/]+)\/(.*)$/); if ( m ) return m[1] === "moinen-maps" ? "mm:" + m[2] : m[1]; return "foundry"; };
if ( needG ) await G.ev(`const D = game.modules.get("moinen-maps").api.director; if ( !D.isOn() ) await D.setOn(true); if ( D.status().paused ) await D.setPaused(false); return 1;`);
const res = {};
await P.send("Emulation.setCPUThrottlingRate", { rate });
try {
for ( const s of scens ) {
  res[s] = [];
  for ( let r = 0; r < reps; r++ ) {
    await P.ev(HOME); await P.ev(INST);
    const m0 = await M(); if ( profOn ) await P.send("Profiler.start");
    await SC[s](r);
    const prof = profOn ? (await P.send("Profiler.stop")).result.profile : null; const m1 = await M();
    const o = await P.ev(UNINST);
    Object.assign(o, { layouts: m1.LayoutCount - m0.LayoutCount, layoutMs: +((m1.LayoutDuration - m0.LayoutDuration) * 1000).toFixed(1), styles: m1.RecalcStyleCount - m0.RecalcStyleCount, styleMs: +((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000).toFixed(1), scriptMs: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000), taskMs: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000) });
    if ( prof ) {
      const nodes = new Map(prof.nodes.map((n) => [n.id, n])), parent = new Map(); for ( const n of prof.nodes ) for ( const c of n.children ?? [] ) parent.set(c, n.id);
      const dmap = new Map(); const acc = { orbit: 0, lockview: 0, lvGetUser: 0, weatherSetting: 0, zonesHover: 0, mmAll: 0, busy: 0 };
      for ( let i = 0; i < prof.samples.length; i++ ) {
        const ms = (prof.timeDeltas[i + 1] ?? prof.timeDeltas[i]) / 1000; let id = prof.samples[i]; const fn = nodes.get(id).callFrame.functionName;
        if ( fn === "(idle)" || fn === "(program)" ) continue; acc.busy += ms;
        let deep = null;
        while ( id !== undefined ) { const q = nodes.get(id).callFrame; const b = bucket(q.url); if ( b.startsWith("mm:") || b === "LockView" ) { deep = { b, f: q.functionName || "(anon)", l: q.lineNumber }; break; } id = parent.get(id); }
        if ( !deep ) continue;
        { const dk = deep.b.replace("mm:scripts/", "") + " " + deep.f + ":" + deep.l; dmap.set(dk, (dmap.get(dk) ?? 0) + ms); }
        if ( deep.b === "mm:scripts/zones/orbit.mjs" ) acc.orbit += ms;
        if ( deep.b === "LockView" ) { acc.lockview += ms; if ( deep.f === "getUserSetting" ) acc.lvGetUser += ms; }
        if ( deep.b === "mm:scripts/weather/weather.mjs" && ["setting", "detailCap", "lensCap"].includes(deep.f) ) acc.weatherSetting += ms;
        if ( (deep.b === "mm:scripts/zones/zones.mjs" && /hover|icon|anon/i.test(deep.f)) || (deep.b === "mm:scripts/zones/display.mjs" && deep.f === "iconAt") ) acc.zonesHover += ms;
        if ( deep.b.startsWith("mm:") && !(deep.b === "mm:scripts/fire/display.mjs" && deep.f === "R.render") && !(deep.b === "mm:scripts/view-smooth.mjs" && deep.f === "ticker._tick") ) acc.mmAll += ms;
      }
      for ( const k in acc ) acc[k] = +acc[k].toFixed(1); o.prof = acc; o.deepTop = [...dmap].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => k + "=" + v.toFixed(1));
    }
    res[s].push(o); console.error(s, r, JSON.stringify({ ...o, deepTop: undefined }));
    await sleep(s === "take" ? 2500 : 800);
  }
}
} finally {
  await P.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  if ( needG ) await G.ev(`const D = game.modules.get("moinen-maps").api.director; await D.setOn(false); const d = canvas.scene.tokens.get("sYce4RTsRN35qzSP"); if ( d && d.x !== 700 ) await d.update({ x: 700, y: 1050 }, { animate: false }); return 1;`);
}
if ( out ) fs.writeFileSync(out, JSON.stringify(res, null, 1));
process.exit(0);
