// HITCH HUNT DRIVER (node): long frames (> 34 ms) on a lane, GM and the real player, in headless Chrome at a real device scale factor,
// with no load: each frame over 34 ms attributed by dev/hitch-probe.mjs (Long Animation Frame scripts, heap drops, timed WebGL calls,
// worker / socket handlers) and by a CPU profile of the whole run (samples inside the hitch: GC, our files, Foundry, PIXI, other
// modules, the browser itself).
//   node dev/hitch-run.mjs [--dpr 1,2] [--secs 120] [--cases empty,fire-rain,clouds,full] [--who GM,player] [--label hitch]
//        [--noprof] [--port 9444] [--gm http://127.0.0.14:30001] [--player http://127.0.0.13:30001] [--gmId ..] [--playerId ..] [--profile <dir>]
// Writes dev/out/hitch/<label>-<case>-<who>-dpr<k>.json (+ .cpuprofile) and prints a summary per run.
import fs from "node:fs";
import path from "node:path";
import { launchBrowser, closeBrowser } from "./lib/tmp.mjs";
import { LEAN_FLAGS } from "./lib/browser.mjs";
import { connect, join, targets } from "./tools/cdp-lane.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("port", 9444)), GM = arg("gm", "http://127.0.0.14:30001"), PL = arg("player", "http://127.0.0.13:30001");
const GMID = arg("gmId", "3dzfyqQ1n98OkCwE"), PLID = arg("playerId", "5gw9oNsrSdZuSUqQ"), SECS = Number(arg("secs", 120));
const DPRS = arg("dpr", "1,2").split(",").map(Number), CASES = arg("cases", "empty,fire-rain,clouds,full").split(","), WHO = arg("who", "GM,player").split(",");
const NOPROF = process.argv.includes("--noprof");   // (no CPU profile: the profiler itself adds hitches - counts without it)
const LABEL = arg("label", "hitch"), CHROME = arg("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "out", "hitch");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the cases: stack-bench layers, then the weather set exactly (rain L3 + lens; + clouds L3 with godrays)
const CASE = {
  empty: { layers: {}, wx: ["off", 1, {}] },
  "fire-rain": { layers: { fire: 20 }, wx: ["rain", 3, { lens: "auto" }] },
  clouds: { layers: { fire: 20 }, wx: ["rain+clouds", 3, { lens: "auto", clouds: { rays: true, mode: "sky" } }] },
  full: { layers: { d: true, fire: 20, smoke: 5 }, wx: ["rain+clouds", 3, { lens: "auto", clouds: { rays: true, mode: "sky" } }] }
};

async function startChrome(dpr) {
  const ch = launchBrowser(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, ...LEAN_FLAGS, "--window-size=1600,900", "--enable-gpu",
    "--use-angle=d3d11", "--ignore-gpu-blocklist", `--force-device-scale-factor=${dpr}`, "--enable-precise-memory-info", "about:blank"], { kind: "hitch-chrome", profile: arg("profile") });   // temp profile: dev/lib/tmp.mjs
  for ( let i = 0; i < 40; i++ ) { await sleep(500); try { await targets(PORT); return ch; } catch {} }
  throw new Error("chrome did not start");
}
async function stopChrome(ch) { await closeBrowser(ch, { port: PORT }); }

/** The category of a profile node. */
export function category(n) {
  const f = n.callFrame, u = f.url ?? "";
  if ( f.functionName === "(garbage collector)" ) return "GC";
  if ( f.functionName === "(idle)" ) return "idle";
  if ( f.functionName === "(program)" ) return "browser";
  if ( f.functionName === "(root)" ) return "browser";
  if ( /\/modules\/moinen-maps\//.test(u) ) return `ours:${u.replace(/.*\/modules\/moinen-maps\//, "").replace(/\?.*/, "")}`;
  if ( /\/modules\/([^/]+)\//.test(u) ) return `module:${u.match(/\/modules\/([^/]+)\//)[1]}`;
  if ( /\/systems\/([^/]+)\//.test(u) ) return `system:${u.match(/\/systems\/([^/]+)\//)[1]}`;
  if ( /pixi/i.test(u) ) return "PIXI";
  if ( /\/scripts\/|foundry|\/common\//.test(u) ) return "Foundry";
  if ( !u ) return f.functionName ? `native:${f.functionName}` : "browser";
  return `other:${u.replace(/^https?:\/\/[^/]+/, "")}`;
}
/** Per hitch: the profile's samples inside it, by category and by top function (ms). `off` = profile ms - page ms. */
export function attribute(profile, hitches, off) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  let t = profile.startTime / 1000 - off;
  const out = hitches.map(() => ({ cat: {}, fn: {} }));
  for ( let i = 0; i < profile.samples.length; i++ ) {
    t += profile.timeDeltas[i] / 1000;
    const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    for ( let h = 0; h < hitches.length; h++ ) {
      if ( t < hitches[h].t0 || t > hitches[h].t1 ) continue;
      const n = nodes.get(profile.samples[i]), c = category(n), fn = `${n.callFrame.functionName || "(anon)"} ${c}:${n.callFrame.lineNumber + 1}`;
      out[h].cat[c] = (out[h].cat[c] ?? 0) + dt; out[h].fn[fn] = (out[h].fn[fn] ?? 0) + dt;
    }
  }
  return out.map((o) => ({ cat: Object.fromEntries(Object.entries(o.cat).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, +v.toFixed(1)])), fn: Object.entries(o.fn).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v.toFixed(1)}`) }));
}

const SB = `const S = await import("/modules/moinen-maps/dev/stack-bench.mjs");`, HP = `const H = await import("/modules/moinen-maps/dev/hitch-probe.mjs");`;
const summary = [];
async function measure(c, label) {
  await c.front(); await sleep(3000);
  await c.ev(`${SB} await S.ready(); canvas.pan({ x: 768, y: 512, scale: 1 }); return 1;`);
  await sleep(4000);
  if ( !NOPROF ) { await c.send("Profiler.enable"); await c.send("Profiler.setSamplingInterval", { interval: 250 }); await c.send("Profiler.start"); }
  const p0 = await c.ev("return performance.now();");
  await c.ev(`${HP} return H.start();`);
  await sleep(SECS * 1000);
  const r = await c.ev(`${HP} return H.stop();`);
  if ( !NOPROF ) {
    const prof = (await c.send("Profiler.stop")).result.profile; await c.send("Profiler.disable");
    const at = attribute(prof, r.hitches, prof.startTime / 1000 - p0);
    r.hitches.forEach((h, i) => { h.prof = at[i]; });
    fs.writeFileSync(path.join(OUT, `${label}.cpuprofile`), JSON.stringify(prof));
  } else r.hitches.forEach((h) => { h.prof = { cat: {}, fn: [] }; });
  fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(r));
  const hs = r.hitches, n = (ms) => hs.filter((h) => h.dt > ms).length;
  const line = `${label}: ${r.frames} frames ${r.secs} s, p50 ${r.p50} p99 ${r.p99} max ${r.max} | >34 ${n(34)} >50 ${n(50)} >100 ${n(100)}`;
  console.log("\n" + line); summary.push(line);
  for ( const h of hs ) {
    const z = Object.entries(h.zones).filter(([, v]) => v >= 1).map(([k, v]) => `${k} ${v}`).join(", ");
    const sc = h.loaf.flatMap((l) => l.scripts.map((s) => `${s.inv || s.fn} ${s.src.split("/").slice(-2).join("/")} ${s.dur}`)).slice(0, 4).join(" ; ");
    console.log(`  ${String(h.t).padStart(6)} s ${String(h.dt).padStart(6)} ms heap ${h.dHeapMB >= 0 ? "+" : ""}${h.dHeapMB} MB | prof ${JSON.stringify(h.prof.cat)} | ${h.prof.fn.slice(0, 2).join(" ; ")}${z ? ` | zones ${z}` : ""}${sc ? ` | loaf ${sc}` : ""}`);
  }
}

for ( const dpr of DPRS ) {
  const ch = await startChrome(dpr);
  try {
    const gm = await connect(PORT, await join(PORT, GM, GMID));
    const pl = WHO.includes("player") ? await connect(PORT, await join(PORT, PL, PLID)) : null;
    await gm.front();
    await gm.ev(`${SB} await S.ensureScene(); return 1;`);
    for ( const cs of CASES ) {
      const C = CASE[cs];
      await gm.front();
      await gm.ev(`${SB} await S.setLayers(${JSON.stringify({ ...C.layers, weather: "off" })}); const W = await import("/modules/moinen-maps/dev/weather-cost.mjs"); await W.setCase(...${JSON.stringify(C.wx)}); await S.ready(); return 1;`);
      if ( WHO.includes("GM") ) await measure(gm, `${LABEL}-${cs}-GM-dpr${dpr}`);
      if ( pl ) {
        await pl.front();
        await pl.ev(`for ( let i = 0; i < 100 && canvas.scene?.name !== "moinen stack bench"; i++ ) await new Promise((r) => setTimeout(r, 300)); return canvas.scene?.name;`);
        await measure(pl, `${LABEL}-${cs}-player-dpr${dpr}`);
      }
    }
    await gm.front(); await gm.ev(`${SB} await S.setLayers({}); const W = await import("/modules/moinen-maps/dev/weather-cost.mjs"); await W.setCase("off", 1); return 1;`);
    gm.close(); pl?.close();
  } finally { await stopChrome(ch); }
}
console.log("\nSUMMARY\n" + summary.join("\n"));
process.exit(0);
