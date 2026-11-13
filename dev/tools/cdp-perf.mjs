// CDP perf driver (headless Edge by default, real GPU): the repo's version of the old scratch perf.py, with a temp profile that is
// always cleaned up (dev/lib/tmp.mjs; perf.py leaked ~1 GB of profile per crashed or killed run).
//   node dev/tools/cdp-perf.mjs URL BENCH.js OUT.json [W H DPR] [--chrome <exe>] [--port N] [--profile <dir>]
// The page-side bench script (BENCH.js) is evaluated after window.ready; it must evaluate to a Promise of a JSON-able value.
// It can call `await cdp(op, arg)` for: gc (collect garbage + metrics + live object counts), metrics, throttle (rate),
// trace_start (label), trace_end (label), prof_start, prof_end (label).
// env FOUNDRY_USER=<user name>: URL is a Foundry /join page; that user joins, then window.ready is set after FOUNDRY_SETTLE s (4).
import fs from "node:fs";
import { startHeadless, closeBrowser, session, firstPage, EDGE, exeOf } from "../lib/browser.mjs";

const flag = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const pos = []; for ( let i = 2; i < process.argv.length; i++ ) { if ( process.argv[i].startsWith("--") ) i++; else pos.push(process.argv[i]); }
const [url, bench, out] = pos, W = Number(pos[3] ?? 1600), H = Number(pos[4] ?? 900), DPR = Number(pos[5] ?? 1);
if ( !out ) { console.log("usage: node dev/tools/cdp-perf.mjs URL BENCH.js OUT.json [W H DPR] [--chrome <exe>] [--port N] [--profile <dir>]"); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { url, W, H, dpr: DPR, traces: [], profiles: [] };

const { b, port } = await startHeadless({
  kind: "perf-edge", exe: exeOf(flag("chrome", null), EDGE), port: Number(flag("port", 0)), profile: flag("profile", null),
  args: [`--window-size=${W},${H}`, "--hide-scrollbars", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-precise-memory-info",
    "--js-flags=--expose-gc", "about:blank"]
});
try {
  const s = await session((await firstPage(port)).webSocketDebuggerUrl);
  const call = s.send;
  let traceBuf = [], traceDone = null;
  s.on("Tracing.dataCollected", (p) => { for ( const e of p.value ) traceBuf.push(e); });
  s.on("Tracing.tracingComplete", () => traceDone?.());
  s.on("Runtime.consoleAPICalled", (p) => console.log("console:", (p.args ?? []).map((a) => String(a.value ?? a.description ?? "")).join(" ").slice(0, 400)));
  s.on("Runtime.exceptionThrown", (p) => console.log("EXC:", JSON.stringify(p.exceptionDetails).slice(0, 600)));
  s.on("Runtime.bindingCalled", async (p) => {
    if ( p.name !== "cdpCall" ) return;
    const pl = JSON.parse(p.payload);
    let val; try { val = await doOp(pl.op, pl.arg); } catch ( e ) { val = { error: String(e?.stack ?? e) }; }
    call("Runtime.evaluate", { expression: `window.__cdpReply(${JSON.stringify(pl.token)}, ${JSON.stringify(JSON.stringify(val ?? null))})` });
  });

  const metrics = async () => Object.fromEntries((await call("Performance.getMetrics")).result.metrics.map((x) => [x.name, x.value]));
  async function objects(proto) {
    const oid = (await call("Runtime.evaluate", { expression: proto })).result.result.objectId;
    const arr = (await call("Runtime.queryObjects", { prototypeObjectId: oid })).result.objects.objectId;
    const fn = "function(){let det=0,px=0,detPx=0;for(const o of this){const c=o.isConnected===false;if(c)det++;if(o.width!==undefined&&typeof o.width==='number'){px+=o.width*o.height;if(c)detPx+=o.width*o.height}}return{n:this.length,detached:det,px,detPx}}";
    return (await call("Runtime.callFunctionOn", { objectId: arr, functionDeclaration: fn, returnByValue: true })).result.result.value;
  }
  const label = (cf) => `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber + 1}`;
  const r1 = (x) => Math.round(x * 10) / 10;
  async function doOp(op, arg) {
    if ( op === "gc" ) {
      await call("HeapProfiler.collectGarbage"); await call("HeapProfiler.collectGarbage");
      const m = await metrics();
      return { metrics: Object.fromEntries(["JSHeapUsedSize", "JSHeapTotalSize", "Nodes", "JSEventListeners", "Documents", "LayoutCount", "RecalcStyleCount", "LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration"].map((k) => [k, m[k] ?? null])),
        canvas: await objects("HTMLCanvasElement.prototype"), div: await objects("HTMLDivElement.prototype"), anim: await objects("Animation.prototype"), img: await objects("HTMLImageElement.prototype") };
    }
    if ( op === "metrics" ) return metrics();
    if ( op === "throttle" ) { await call("Emulation.setCPUThrottlingRate", { rate: Number(arg) }); return { rate: arg }; }
    if ( op === "trace_start" ) {
      traceBuf = [];
      const cats = "toplevel,blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,benchmark,viz,gpu,v8,blink_gc,blink";
      await call("Tracing.start", { categories: cats, transferMode: "ReportEvents" });
      return { ok: true };
    }
    if ( op === "trace_end" ) {
      const done = new Promise((r) => { traceDone = r; });
      await call("Tracing.end"); await done; traceDone = null;
      results.traces.push(analyzeTrace(traceBuf, arg));
      return { ok: true, events: traceBuf.length };
    }
    if ( op === "prof_start" ) { await call("Profiler.enable"); await call("Profiler.setSamplingInterval", { interval: 200 }); await call("Profiler.start"); return { ok: true }; }
    if ( op === "prof_end" ) {
      const r = (await call("Profiler.stop")).result.profile, nodes = new Map(r.nodes.map((n) => [n.id, n])), parent = new Map();
      for ( const n of r.nodes ) for ( const c of n.children ?? [] ) parent.set(c, n.id);
      const self = new Map(), inc = new Map(), add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
      const samples = r.samples ?? [], deltas = r.timeDeltas ?? [];
      samples.forEach((sm, i) => {
        const d = (i + 1 < deltas.length ? deltas[i + 1] : 0) / 1000;
        add(self, label(nodes.get(sm).callFrame), d);
        const seen = new Set();
        for ( let x = sm; x != null; x = parent.get(x) ) { const k = label(nodes.get(x).callFrame); if ( !seen.has(k) ) { add(inc, k, d); seen.add(k); } }
      });
      const top = (m, n) => [...m].sort((a, c) => c[1] - a[1]).slice(0, n).map(([k, v]) => [k, r1(v)]);
      results.profiles.push({ label: arg, self: top(self, 30), incl: top(inc, 45) });
      return { ok: true };
    }
    return { error: `unknown op ${op}` };
  }

  await call("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  await call("Page.enable"); await call("Runtime.enable"); await call("Performance.enable");
  await call("Runtime.addBinding", { name: "cdpCall" });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{const pend=new Map();let k=0;window.__cdpReply=(t,v)=>{const r=pend.get(t);pend.delete(t);r&&r(JSON.parse(v));};
    window.cdp=(op,arg)=>new Promise(r=>{const t='t'+(++k);pend.set(t,r);window.cdpCall(JSON.stringify({op,arg,token:t}));});})();` });
  await call("Page.navigate", { url });
  const ev = async (expression, awaitPromise = false) => (await call("Runtime.evaluate", { expression, awaitPromise, returnByValue: true })).result?.result?.value;
  const fu = process.env.FOUNDRY_USER;
  if ( fu ) {
    await sleep(3000);
    console.log("join:", await ev(`(async()=>{const s=document.querySelector('select[name=userid]'); const o=[...s.options].find(o=>o.textContent.trim()===${JSON.stringify(fu)}); s.value=o.value; document.querySelector('button[name=join]').click(); return o.value})()`, true));
    for ( let i = 0; i < 120; i++ ) { await sleep(1000); if ( (await ev("!!(window.game && game.ready && window.canvas && canvas.ready)")) === true ) break; }
    await sleep(Number(process.env.FOUNDRY_SETTLE ?? 4) * 1000);
    await ev("window.ready = true");
  }
  for ( let i = 0; i < 120; i++ ) { await sleep(250); if ( (await ev("!!window.ready")) === true ) break; }
  const src = fs.readFileSync(bench, "utf8");
  const val = await ev(`(async()=>{ ${src} })().then(v=>JSON.stringify(v)).catch(e=>JSON.stringify({error:String(e&&e.stack||e)}))`, true);
  try { results.bench = JSON.parse(val); } catch { results.bench = val ?? null; }
  s.close();
} finally {
  await closeBrowser(b, { port });
}
fs.writeFileSync(out, JSON.stringify(results, null, 1));
console.log("wrote", out);
process.exit(0);

/** The summary of one trace (same fields as perf.py): per-thread busy time by phase (P:<name> user-timing marks), top tasks, frames. */
function analyzeTrace(ev, label) {
  const key = (e) => `${e.pid}:${e.tid}`, tname = new Map();
  for ( const e of ev ) if ( e.ph === "M" && e.name === "thread_name" ) tname.set(key(e), e.args.name);
  const marks = ev.filter((e) => (e.cat ?? "").includes("blink.user_timing") && ["R", "I", "n", "b", "e"].includes(e.ph) && (e.name ?? "").startsWith("P:"))
    .map((e) => [e.ts, e.name.slice(2)]).sort((a, c) => a[0] - c[0]);
  const phase = (ts) => { let ph = "pre"; for ( const [t, nm] of marks ) if ( ts >= t ) ph = nm; return ph; };
  const r1 = (x) => Math.round(x * 10) / 10, roundObj = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r1(v)]));
  const out = { label, marks: marks.length ? marks.map(([t, nm]) => [r1((t - marks[0][0]) / 1000), nm]) : [] };
  const per = new Map();
  for ( const e of ev ) if ( e.ph === "X" && (e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask") && "dur" in e ) { if ( !per.has(key(e)) ) per.set(key(e), []); per.get(key(e)).push(e); }
  const statsFor = (nm) => {
    const c = [...per.keys()].filter((k) => tname.get(k) === nm);
    if ( !c.length ) return [null, []];
    const sum = (k) => per.get(k).reduce((s, x) => s + x.dur, 0), k = c.reduce((a, x) => (sum(x) > sum(a) ? x : a));
    return [k, per.get(k)];
  };
  for ( const nm of ["CrRendererMain", "CrGpuMain", "VizCompositorThread", "Compositor"] ) {
    const [k, tasks] = statsFor(nm);
    if ( !tasks.length ) continue;
    const byph = {};
    for ( const t of tasks ) {
      const b = (byph[phase(t.ts)] ??= { busy_ms: 0, n_over50: 0, n_over16: 0, max_ms: 0 }), d = t.dur / 1000;
      b.busy_ms += d; if ( d > 50 ) b.n_over50++; if ( d > 16.7 ) b.n_over16++; b.max_ms = Math.max(b.max_ms, d);
    }
    const top = [...tasks].sort((a, c) => c.dur - a.dur).slice(0, 6);
    const inner = (t) => ev.filter((e) => e.ph === "X" && key(e) === k && e.ts >= t.ts && e.ts + (e.dur ?? 0) <= t.ts + t.dur && e !== t && (e.dur ?? 0) > t.dur * 0.15)
      .sort((a, c) => (c.dur ?? 0) - (a.dur ?? 0)).slice(0, 6).map((e) => `${e.name}:${((e.dur ?? 0) / 1000).toFixed(1)}`);
    out[nm] = { by_phase: Object.fromEntries(Object.entries(byph).map(([ph, v]) => [ph, roundObj(v)])), top: top.map((t) => ({ ms: r1(t.dur / 1000), phase: phase(t.ts), inner: inner(t) })) };
  }
  const fr = {};
  for ( const e of ev ) if ( e.name === "PipelineReporter" && (e.ph === "b" || e.ph === "X") ) {
    const st = e.args?.chrome_frame_reporter?.state ?? "?", ph = phase(e.ts);
    (fr[ph] ??= {})[st] = (fr[ph][st] ?? 0) + 1;
  }
  out.frames = fr;
  const [mk] = statsFor("CrRendererMain");
  const LAY = new Set(["Layout", "UpdateLayoutTree", "Paint", "PrePaint", "Layerize", "Commit", "ParseHTML", "GPUTask", "Canvas2DLayerBridge::FlushRecording", "v8.gc", "MajorGC", "MinorGC", "V8.GC_MARK_COMPACTOR", "BlinkGC.AtomicPhase"]);
  const lay = {};
  for ( const e of ev ) if ( mk && key(e) === mk && e.ph === "X" && LAY.has(e.name) ) { const l = (lay[e.name] ??= [0, 0]); l[0]++; l[1] += (e.dur ?? 0) / 1000; }
  out.main_events = Object.fromEntries(Object.entries(lay).map(([k, v]) => [k, [v[0], r1(v[1])]]));
  const NAMES = new Set(["UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Commit", "FunctionCall", "FireAnimationFrame", "TimerFire", "MajorGC", "MinorGC", "HitTest", "Layerize", "UpdateLayer", "RasterTask", "Decode Image", "ImageDecodeTask"]);
  const mp = {};
  for ( const e of ev ) if ( mk && key(e) === mk && e.ph === "X" && NAMES.has(e.name) ) { const d = (mp[phase(e.ts)] ??= {}); d[e.name] = (d[e.name] ?? 0) + (e.dur ?? 0) / 1000; }
  out.main_by_phase = Object.fromEntries(Object.entries(mp).map(([ph, d]) => [ph, Object.fromEntries(Object.entries(d).filter(([, v]) => v >= 1).map(([k, v]) => [k, r1(v)]))]));
  const ds = ev.filter((e) => e.name === "Display::DrawAndSwap" && (e.ph === "X" || e.ph === "B")).map((e) => e.ts).sort((a, c) => a - c);
  const iv = {};
  for ( let i = 1; i < ds.length; i++ ) (iv[phase(ds[i])] ??= []).push((ds[i] - ds[i - 1]) / 1000);
  const st = (a) => { const s = [...a].sort((x, y) => x - y), q = (p) => r1(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]); return { n: s.length, p50: q(0.5), p95: q(0.95), max: r1(s.at(-1)), "gaps>25": s.filter((x) => x > 25).length, "gaps>50": s.filter((x) => x > 50).length }; };
  out.swap = Object.fromEntries(Object.entries(iv).filter(([, a]) => a.length).map(([ph, a]) => [ph, st(a)]));
  const rb = {};
  for ( const [k, tasks] of per ) {
    const nm = tname.get(k) ?? "";
    if ( nm.includes("Raster") || (nm.includes("Compositor") && nm !== "Compositor") ) for ( const t of tasks ) rb[nm] = (rb[nm] ?? 0) + t.dur / 1000;
  }
  out.raster_busy = roundObj(rb);
  return out;
}
