// LANE TEST of dev/tools/table-check.js (node, a headless Chrome with remote debugging, GM + player tabs already joined - cdp-lane.mjs join):
//   node dev/tools/table-check-lane.mjs <label> <GM|player> <layers json | -> [TABLE_CHECK options json] [--port 9444] [--gm <url>] [--player <url>]
//   layers: dev/stack-bench.mjs setLayers on the bench scene, set from the GM tab ("-" = leave as is), e.g.
//     '{"d":true,"fire":20,"smoke":5,"weather":"rain","dark":0}' (full stack) or '{}' (empty); options e.g. '{"slowGpu":2}', '{"noTimer":true}'
// The tab is reloaded (a fresh session: guards as a new player has them), settled 20 s, then the snippet runs exactly as pasted. READ-ONLY
// CHECKS around it: the scene + user documents, the world settings and localStorage before vs after (a diff is printed), and every
// socket message the tab emits while it runs (Foundry's own periodic "time" sync is the only expected one).
// Writes dev/out/table-check/<label>.json and prints one line.
import fs from "node:fs";
import path from "node:path";
import { connect } from "./cdp-lane.mjs";
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); if ( i < 0 ) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const PORT = Number(opt("port", 9444)), GMURL = opt("gm", "http://127.0.0.14:30001/game"), PLURL = opt("player", "http://127.0.0.13:30001/game");
const [label, who, layers, opts = "{}"] = argv;
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "out", "table-check");
fs.mkdirSync(OUT, { recursive: true });
const gm = await connect(PORT, GMURL), pl = await connect(PORT, PLURL);
const IMP = `const S = await import("/modules/moinen-maps/dev/stack-bench.mjs");`;
if ( layers !== "-" ) { await gm.front(); await gm.ev(`${IMP} await S.ensureScene(); return await S.setLayers(${layers});`); }
const c = who === "GM" ? gm : pl;
await c.front();
// (a fresh page per run: the guards start as in a new session, not from the last run's blocks)
await c.send("Page.reload", { ignoreCache: false });
for ( let i = 0; i < 120; i++ ) { await new Promise((r) => setTimeout(r, 1000)); try { if ( await c.ev("return !!(globalThis.game?.ready && canvas?.ready)", 5000) ) break; } catch {} }
await c.ev(`${IMP} for ( let i = 0; i < 100 && canvas.scene?.name !== "moinen stack bench"; i++ ) await new Promise((r) => setTimeout(r, 300)); await S.ready(); return 1;`);
await new Promise((r) => setTimeout(r, 20000));   // (a tab in front for a while, as a player's is: guards settled)
const src = fs.readFileSync(new URL("./table-check.js", import.meta.url), "utf8");
const SNAP = `return JSON.stringify([canvas.scene.toObject(), game.user.toObject(), Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]), game.settings.storage.get("world")?.contents?.map?.((x) => [x.key, x.value]) ?? null]);`;
const before = await c.ev(SNAP);
await c.send("Runtime.enable");
const r = await c.ev(`const sent = [], t0s = performance.now(); const em = game.socket.emit; game.socket.emit = function(ev, ...a) { sent.push(ev + "@" + Math.round(performance.now() - t0s) + ":" + Object.keys(a[1] ?? {}).join(",")); return em.call(this, ev, ...a); };
const lsk = () => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])); const ls0 = lsk();
try { globalThis.TABLE_CHECK = ${opts};
${src}
; const res = await window.__tableCheckP; delete globalThis.TABLE_CHECK; res.__sent = sent; res.__lsSame = ls0 === lsk(); return res; } finally { game.socket.emit = em; }`);
const after = await c.ev(SNAP);
const same = before === after;
if ( !same ) { const a = JSON.parse(before), b = JSON.parse(after), out = []; const walk = (x, y, p) => { if ( JSON.stringify(x) === JSON.stringify(y) ) return; if ( x && y && typeof x === "object" && typeof y === "object" && out.length < 30 ) { for ( const k of new Set([...Object.keys(x), ...Object.keys(y)]) ) walk(x[k], y[k], `${p}.${k}`); } else out.push(`${p}: ${JSON.stringify(x)?.slice(0, 120)} -> ${JSON.stringify(y)?.slice(0, 120)}`); }; walk(a, b, ""); console.log("DIFF", out.join(" || ").slice(0, 400)); }
fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(r, null, 1));
const s = (x) => JSON.stringify(x);
console.log(label, who, r.verdict, s(r.why), "| dpr", r.info.dpr, r.info.resolution, r.info.canvasPx.join("x"), "| rest fps", r.rest.fps, "p95", r.rest.frameMs.p95, "max", r.rest.frameMs.max, "cpu", r.rest.cpuMs.mean,
  "| cap", r.capacity.frameMs, "ms gpu", s(r.capacity.gpuMs), "cpu50", r.capacity.cpuMs.p50, "n", r.capacity.frames, "| owners", s(r.ownersGpuMs), "| pan", r.pan.mode, r.pan.fps, "p95", r.pan.frameMs.p95, "max", r.pan.frameMs.max, ">34", r.pan.over34,
  "| loaf", r.rest.loaf?.count, r.pan.loaf?.count, "| guards", s(r.rest.guards), s(r.pan.guards), "| emu", s(r.info.emulated ?? null), "| fire", r.info.scene.fire, "w", r.info.scene.weather, "d", r.info.scene.destruction, "| adv", s(r.advice.map((a) => a.en.slice(0, 40))), "| s", r.seconds, "| readOnly", same, "| sent", JSON.stringify(r.__sent), "lsSame", r.__lsSame);
process.exit(0);
