// HITCH TRACE (node): a Chrome trace (all processes: renderer main, GPU, viz) over a hitch-probe run on a lane GM or player, then
// for each frame over `--min` ms what ran longest on each thread while it lasted (the main thread can sit idle in a hitch: the GPU
// process, the compositor or the browser hold the frame back).
//   node dev/hitch-trace.mjs [--case full] [--who GM|player] [--dpr 1] [--secs 60] [--min 90] [--label trace] [--profile <dir>]
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, closeBrowser } from "./lib/tmp.mjs";
import { connect, join, targets } from "./tools/cdp-lane.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("port", 9444)), GM = arg("gm", "http://127.0.0.14:30001"), PL = arg("player", "http://127.0.0.13:30001");
const GMID = arg("gmId", "3dzfyqQ1n98OkCwE"), PLID = arg("playerId", "5gw9oNsrSdZuSUqQ"), SECS = Number(arg("secs", 60)), MIN = Number(arg("min", 90));
const CS = arg("case", "full"), WHO = arg("who", "GM"), DPR = Number(arg("dpr", 1)), LABEL = arg("label", "trace");
const CHROME = arg("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "out", "hitch");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CASE = {
  empty: { layers: {}, wx: ["off", 1, {}] },
  "fire-rain": { layers: { fire: 20 }, wx: ["rain", 3, { lens: "auto" }] },
  clouds: { layers: { fire: 20 }, wx: ["rain+clouds", 3, { lens: "auto", clouds: { rays: true, mode: "sky" } }] },
  full: { layers: { d: true, fire: 20, smoke: 5 }, wx: ["rain+clouds", 3, { lens: "auto", clouds: { rays: true, mode: "sky" } }] }
};
const CATS = ["toplevel", "gpu", "gpu.service", "viz", "cc", "v8", "disabled-by-default-v8.gc", "blink.user_timing", "devtools.timeline", "disabled-by-default-devtools.timeline", "benchmark", "renderer.scheduler", "ipc", "mojom", "memory"].join(",");

const ch = launchBrowser(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--window-size=1600,900", "--enable-gpu",
  "--use-angle=d3d11", "--ignore-gpu-blocklist", `--force-device-scale-factor=${DPR}`, "--enable-precise-memory-info", "about:blank"], { kind: "trace-chrome", profile: arg("profile") });   // temp profile: dev/lib/tmp.mjs
for ( let i = 0; i < 40; i++ ) { await sleep(500); try { await targets(PORT); break; } catch {} }
const SB = `const S = await import("/modules/moinen-maps/dev/stack-bench.mjs");`, HP = `const H = await import("/modules/moinen-maps/dev/hitch-probe.mjs");`;
try {
  const gm = await connect(PORT, await join(PORT, GM, GMID));
  await gm.front();
  await gm.ev(`${SB} await S.ensureScene(); await S.setLayers(${JSON.stringify({ ...CASE[CS].layers, weather: "off" })}); const W = await import("/modules/moinen-maps/dev/weather-cost.mjs"); await W.setCase(...${JSON.stringify(CASE[CS].wx)}); await S.ready(); return 1;`);
  let c = gm;
  if ( WHO === "player" ) { c = await connect(PORT, await join(PORT, PL, PLID)); await c.front(); await c.ev(`for ( let i = 0; i < 100 && canvas.scene?.name !== "moinen stack bench"; i++ ) await new Promise((r) => setTimeout(r, 300)); return 1;`); }
  await c.front(); await sleep(3000);
  await c.ev(`${SB} await S.ready(); canvas.pan({ x: 768, y: 512, scale: 1 }); return 1;`); await sleep(4000);
  // the browser-wide trace over its own socket (events: dataCollected / tracingComplete)
  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(), ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const events = []; let done = null, id = 0;
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if ( d.method === "Tracing.dataCollected" ) events.push(...d.params.value); else if ( d.method === "Tracing.tracingComplete" ) done?.(); });
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  send("Tracing.start", { traceConfig: { includedCategories: CATS.split(","), recordMode: "recordContinuously" }, bufferUsageReportingInterval: 1000 });
  await sleep(500);
  const p0 = await c.ev(`performance.mark("mm-hitch-start"); return performance.now();`);
  await c.ev(`${HP} return H.start();`);
  await sleep(SECS * 1000);
  const r = await c.ev(`${HP} return H.stop();`);
  const fin = new Promise((res) => { done = res; }); send("Tracing.end"); await fin; ws.close();
  // align: the mark's trace time (us) against the page's clock (ms)
  const mk = events.find((e) => e.name === "mm-hitch-start"), off = mk ? mk.ts / 1000 - p0 : null;
  const names = {}; for ( const e of events ) if ( e.ph === "M" && e.name === "thread_name" ) names[`${e.pid}:${e.tid}`] = e.args.name;
  const pnames = {}; for ( const e of events ) if ( e.ph === "M" && e.name === "process_name" ) pnames[e.pid] = e.args.name;
  // complete events (X) and B/E pairs per thread
  const spans = [], open = new Map();
  for ( const e of events ) {
    if ( e.ph === "X" && e.dur >= 2000 ) spans.push({ name: e.name, cat: e.cat, th: `${pnames[e.pid] ?? e.pid}/${names[`${e.pid}:${e.tid}`] ?? e.tid}`, t0: e.ts / 1000 - off, t1: (e.ts + e.dur) / 1000 - off, args: e.args });
    else if ( e.ph === "B" ) open.set(`${e.pid}:${e.tid}:${e.name}`, e);
    else if ( e.ph === "E" ) { const b = open.get(`${e.pid}:${e.tid}:${e.name}`); if ( b && e.ts - b.ts >= 2000 ) spans.push({ name: e.name, cat: e.cat, th: `${pnames[e.pid] ?? e.pid}/${names[`${e.pid}:${e.tid}`] ?? e.tid}`, t0: b.ts / 1000 - off, t1: e.ts / 1000 - off }); }
  }
  const big = r.hitches.filter((h) => h.dt >= MIN);
  const res = { label: `${LABEL}-${CS}-${WHO}-dpr${DPR}`, frames: r.frames, hitches: r.hitches.length, aligned: off !== null, events: events.length, big: [] };
  for ( const h of big ) {
    // per thread: the longest spans overlapping the hitch (leaf-ish: the 6 longest overlaps)
    const ov = spans.map((s) => ({ ...s, o: Math.min(s.t1, h.t1) - Math.max(s.t0, h.t0) })).filter((s) => s.o > 2).sort((a, b) => b.o - a.o);
    const byTh = {}; for ( const s of ov ) { (byTh[s.th] ??= []); if ( byTh[s.th].length < 6 ) byTh[s.th].push(`${s.name} ${s.o.toFixed(1)}${s.args?.data?.url ? " " + s.args.data.url : ""}`); }
    res.big.push({ t: h.t, dt: h.dt, threads: byTh });
    console.log(`\n${h.t} s ${h.dt} ms`); for ( const [th, l] of Object.entries(byTh) ) console.log(`  ${th}: ${l.join(" | ")}`);
  }
  fs.writeFileSync(path.join(OUT, `${res.label}.trace-summary.json`), JSON.stringify(res));
  console.log(`\n${res.label}: ${r.frames} frames, ${r.hitches.length} over 34 ms, ${big.length} over ${MIN} ms, ${events.length} trace events, aligned ${res.aligned}`);
  gm.close();
} finally {
  await closeBrowser(ch, { port: PORT });
}
process.exit(0);
