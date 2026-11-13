// Render LETR impact frames offline (no Foundry): every drawing of an impact on a stepped 24-tick clock, over a drawn test scene.
//   node dev/tools/impact-render.mjs --out <dir> [--spec spec.json] [--w 1280] [--h 720] [--bg map|dark|light] [--photosafe 0] [--mode full|local] [--motion full|reduced|gentle]
// Opens ONE headless Edge (lean flags): take a light slot first (STANDING-RULES), give it after.
// Spec (JSON, optional; default = every frame type held, then every kind at four strengths):
//   { "items": [ { "label": "crit", "fn": "play" | "show", "type": "slam", "args": { "kind": "crit", "magnitude": 1.7, "dir": 20, "subject": "tok" } } ] }
//   "subject": "tok" = the test figure, "tok2" = the small one, "word" = a lettered word; { "fx", "fy" } = a point (viewport fractions).
// Output: <out>/<nn>-<label>/f##.png (one per tick), <out>/<nn>-<label>.png (the strip), <out>/frames.png (sheet of the single frame
// types), <out>/kinds-*.png, <out>/film.webm (all items in order, 24 fps), <out>/report.json (plans, modes, paint ms).
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startHeadless, closeBrowser, session, firstPage, EDGE } from "../lib/browser.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ENG = path.resolve(arg("eng", fileURLToPath(new URL("../../scripts/letters", import.meta.url))));
const OUT = path.resolve(arg("out", "impact-out")); const W = +arg("w", 1280), H = +arg("h", 720);
const SPEC = arg("spec") ? JSON.parse(fs.readFileSync(arg("spec"), "utf8")) : null;
const PREFS = { photosafe: arg("photosafe", "1") !== "0", motion: arg("motion", "full"), flashes: arg("flashes", "1") !== "0", enabled: true };
const MODE = arg("mode", "full"), BG = arg("bg", "map");

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;overflow:hidden;background:#000} #board{position:fixed;inset:0;width:100vw;height:100vh;display:block}
#tok,#tok2{position:fixed;pointer-events:none}
</style></head><body><canvas id=board></canvas><canvas id=tok></canvas><canvas id=tok2></canvas><script>
(() => {   /* the film clock: time moves only when the driver says so */
  let T = 0; const timers = []; let tid = 0; let raf = [];
  performance.now = () => T;
  window.setTimeout = (f, ms = 0) => { const id = ++tid; timers.push({ id, at: T + Math.max(0, +ms || 0), f }); return id; };
  window.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if ( i >= 0 ) timers.splice(i, 1); };
  window.requestAnimationFrame = (f) => { raf.push(f); return raf.length; };
  window.cancelAnimationFrame = () => {};
  window.__advance = async (ms) => {
    const end = T + ms;
    while ( T < end ) {
      T = Math.min(end, T + 1000 / 120);
      for (;;) { timers.sort((a, b) => a.at - b.at || a.id - b.id); const t = timers[0]; if ( !t || t.at > T ) break; timers.shift(); try { t.f(); } catch (e) { console.error(e); } }
      const fr = raf; raf = []; for ( const f of fr ) try { f(T); } catch (e) { console.error(e); }
      await new Promise((r) => queueMicrotask(r));
    }
  };
})();
</script><script type=module>
const q = new URLSearchParams(location.search);
/* a drawn test scene: a street from above (flat colours, so the black-and-white frames have something to bite) */
const B = document.getElementById("board"), W = innerWidth, H = innerHeight; B.width = W; B.height = H;
{ const c = B.getContext("2d"), bg = q.get("bg");
  let s = 7; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  c.fillStyle = bg === "dark" ? "#1a1c26" : bg === "light" ? "#d9d4c4" : "#5b6068"; c.fillRect(0, 0, W, H);
  if ( bg === "map" || !bg ) {
    c.fillStyle = "#3f434b"; c.fillRect(0, H * 0.36, W, H * 0.26);
    c.fillStyle = "#e8d44a"; for ( let x = 20; x < W; x += 110 ) c.fillRect(x, H * 0.485, 60, 8);
    const roofs = ["#8c4a3a", "#566b7a", "#a08a5c", "#3d5a45", "#74586e"];
    for ( let i = 0; i < 9; i++ ) { const x = i * (W / 8.2) - 30, w = W / 9.5, top = i % 2; c.fillStyle = roofs[i % 5]; c.fillRect(x, top ? H * 0.02 : H * 0.68, w, H * 0.3);
      c.fillStyle = "rgba(255,255,255,.18)"; c.fillRect(x + 8, (top ? H * 0.02 : H * 0.68) + 8, w - 16, 10); c.fillStyle = "rgba(0,0,0,.35)"; c.fillRect(x, top ? H * 0.32 - 12 : H * 0.68, w, 12); }
    for ( let i = 0; i < 26; i++ ) { c.fillStyle = ["#c9c2a8", "#22242a", "#b23a2e", "#2f6fb0"][i % 4]; const x = R() * W, y = H * (0.36 + R() * 0.26); c.fillRect(x, y, 14 + R() * 30, 10 + R() * 18); }
    for ( let i = 0; i < 5; i++ ) { c.fillStyle = "#2c8a4a"; c.beginPath(); c.arc(R() * W, H * (i % 2 ? 0.34 : 0.64), 26 + R() * 18, 0, 7); c.fill(); }
  }
}
/* a test figure seen from above: cape, shoulders, head */
function figure(id, size, x, y, col) {
  const t = document.getElementById(id); t.width = t.height = 256; t.style.width = t.style.height = size + "px"; t.style.left = (x - size / 2) + "px"; t.style.top = (y - size / 2) + "px";
  const c = t.getContext("2d"); c.translate(128, 128);
  c.fillStyle = col[0]; c.beginPath(); c.moveTo(-70, -20); c.quadraticCurveTo(-120, 70, -60, 118); c.lineTo(0, 92); c.lineTo(60, 118); c.quadraticCurveTo(120, 70, 70, -20); c.closePath(); c.fill();
  c.fillStyle = col[1]; c.beginPath(); c.ellipse(0, -8, 92, 46, 0, 0, 7); c.fill();
  c.fillStyle = col[1]; c.beginPath(); c.ellipse(-88, -40, 26, 22, -0.6, 0, 7); c.ellipse(88, -40, 26, 22, 0.6, 0, 7); c.fill();
  c.fillStyle = col[2]; c.beginPath(); c.arc(0, -14, 36, 0, 7); c.fill();
  c.strokeStyle = "#101014"; c.lineWidth = 6; c.beginPath(); c.arc(0, -14, 36, 0, 7); c.stroke();
}
figure("tok", +(q.get("tok") ?? 120), W * 0.56, H * 0.5, ["#c8102e", "#f2c400", "#22242c"]);
figure("tok2", 54, W * 0.24, H * 0.44, ["#1d4fa8", "#e7e7ea", "#5a3a22"]);
const { createImpact } = await import("/eng/impact/index.mjs");
const prefs = JSON.parse(q.get("prefs"));
const I = createImpact({ get prefs() { return prefs; } }, null); window.I = I;
await I.setMode(q.get("mode") ?? "full");
const fx = (v) => (v === "tok" || v === "tok2" ? document.getElementById(v) : v && typeof v === "object" && ("fx" in v) ? { x: v.fx * W, y: v.fy * H } : v);
window.__run = (it) => { const a = { ...(it.args ?? {}) }; a.subject = fx(a.subject); if ( a.from ) a.from = fx(a.from); if ( typeof a.from?.getBoundingClientRect === "function" ) { const r = a.from.getBoundingClientRect(); a.from = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  const h = it.fn === "show" ? I.show(it.type, a) : I.play(a); window.__h = h;
  return { alive: h.alive, mode: h.mode, ms: h.plan?.ms, frames: h.plan?.frames.map((f) => [f.type, f.ticks, f.full ? "F" : "", f.stop ? "s" : "", f.punch ? "p" : ""].join("")), guard: h.plan?.guard }; };
window.__done = true;
</script></body></html>`;

const MIME = { ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json" };
const srv = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  if ( u === "/" ) { s.writeHead(200, { "content-type": "text/html" }); return s.end(PAGE); }
  if ( !u.startsWith("/eng/") ) { s.writeHead(404); return s.end(); }
  const f = path.join(ENG, u.slice(5));
  if ( !f.startsWith(ENG) ) { s.writeHead(403); return s.end(); }
  fs.readFile(f, (e, b) => { if ( e ) { s.writeHead(404); s.end(); return; } s.writeHead(200, { "content-type": MIME[path.extname(f)] ?? "application/octet-stream", "cache-control": "no-store" }); s.end(b); });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
fs.mkdirSync(OUT, { recursive: true });

const FRAME_TYPES = ["pop", "splat", "lines", "ink", "slam", "shadow", "glare", "swap", "window", "smear", "tear", "rip", "dots", "shatter", "chroma", "ring", "fade"];
const KINDS = ["hit", "heavy", "crit", "blast", "slash", "landing", "ko", "shock", "word"];
const items = SPEC?.items ?? [
  ...FRAME_TYPES.map((t) => ({ label: `frame-${t}`, fn: "show", type: t, group: "frames", args: { subject: "tok", from: "tok2", magnitude: 1.3, ticks: 2, seed: `f:${t}`, tone: "hero" } })),
  ...KINDS.flatMap((k) => [0.2, 0.6, 1.1, 1.7].map((m) => ({ label: `${k}-${m}`, fn: "play", group: `kinds-${k}`, args: { kind: k, magnitude: m, subject: k === "blast" || k === "landing" ? { fx: 0.5, fy: 0.5 } : "tok", from: k === "blast" ? undefined : "tok2", dir: k === "landing" ? 90 : undefined, seed: `k:${k}:${m}` } })))
];

const { b, port } = await startHeadless({ kind: "impact-render", exe: EDGE, args: [`--window-size=${W + 300},${H + 300}`, "--hide-scrollbars", "--force-device-scale-factor=1"] });
const report = [];
try {
  const s = await session((await firstPage(port)).webSocketDebuggerUrl);
  await s.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await s.send("Page.enable"); await s.send("Runtime.enable");
  const logs = []; s.on("Runtime.consoleAPICalled", (e) => { if ( e.type === "error" || e.type === "warning" ) logs.push(e.args.map((a) => a.value ?? a.description).join(" ")); });
  s.on("Runtime.exceptionThrown", (e) => logs.push("EXC " + (e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text)));
  await s.send("Page.navigate", { url: `http://127.0.0.1:${srv.address().port}/?bg=${BG}&mode=${MODE}&tok=${arg("tok", "120")}&prefs=${encodeURIComponent(JSON.stringify(PREFS))}` });
  const ev = async (x) => { const r = await s.send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true }); if ( r.result?.exceptionDetails ) logs.push("EVAL " + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  for ( let i = 0; i < 80 && !(await ev("window.__done===true")); i++ ) await new Promise((r) => setTimeout(r, 250));
  const shot = async (f) => { const r = await s.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(f, Buffer.from(r.result.data, "base64")); };
  await shot(path.join(OUT, "scene.png"));
  const all = path.join(OUT, "all"); fs.rmSync(all, { recursive: true, force: true }); fs.mkdirSync(all, { recursive: true });
  let n = 0, idx = 0;
  for ( const it of items ) {
    const dir = path.join(OUT, `${String(++idx).padStart(2, "0")}-${it.label}`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    await ev("window.__advance(1300).then(()=>true)");   // the guard's rolling second passes between items
    const info = JSON.parse(await ev(`JSON.stringify(window.__run(${JSON.stringify(it)}))`) ?? "{}");
    const ticks = Math.round((info.ms ?? 0) / (1000 / 24));
    await ev("window.__advance(2).then(()=>true)");
    let k = 0;
    for ( ; k < ticks + 2; k++ ) {
      const f = path.join(dir, `f${String(k).padStart(2, "0")}.png`);
      await shot(f); fs.copyFileSync(f, path.join(all, `f${String(n++).padStart(5, "0")}.png`));
      await ev("window.__advance(1000/24).then(()=>true)");
    }
    const st = JSON.parse(await ev("JSON.stringify({ last: I.stats.last, nodes: document.querySelectorAll('[id^=moinen-impact-] > div').length, board: [document.getElementById('board').style.translate, document.getElementById('board').style.scale] })"));
    report.push({ label: it.label, ...info, shots: k, after: st });
    try { execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(dir, "f%02d.png"), "-vf", `scale=${it.fn === "show" ? 640 : 426}:-1,tile=${it.fn === "show" ? 1 : k}x1`, "-frames:v", "1", path.join(OUT, `${String(idx).padStart(2, "0")}-${it.label}.png`)]); } catch (e) { console.log("ffmpeg strip skipped:", String(e.message).split("\n")[0]); }
  }
  try { execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "24", "-i", path.join(all, "f%05d.png"), "-c:v", "libvpx-vp9", "-b:v", "3M", "-pix_fmt", "yuv420p", path.join(OUT, "film.webm")]); } catch (e) { console.log("ffmpeg film skipped:", String(e.message).split("\n")[0]); }
  fs.rmSync(all, { recursive: true, force: true });
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ prefs: PREFS, mode: MODE, stats: JSON.parse(await ev("JSON.stringify(I.stats)")), items: report }, null, 1));
  console.log(`${items.length} items -> ${OUT}`);
  if ( logs.length ) console.log("console warnings/errors:", logs.length, [...new Set(logs)].slice(0, 8).join(" | "));
} finally { await closeBrowser(b, { port }); srv.close(); }
