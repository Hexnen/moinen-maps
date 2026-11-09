// Drive Foundry pages in a HEADLESS Chrome over CDP and record one page as a webm (the director's shots as a PLAYER sees them).
// Start a private headless Chrome first (it ticks every page, fronted or not) with dev/tools/chrome.mjs - its temp profile is removed
// on every way out (never chrome.exe by hand with a --user-data-dir under %TEMP%: that profile leaks):
//   node dev/tools/chrome.mjs --port 9333                       (until Ctrl+C), or wrap the whole job:
//   node dev/tools/chrome.mjs --port 9333 -- node dev/tools/cdp-rec.mjs rec 9333 ...
// Usage (node 22, ffmpeg on PATH):
//   node dev/tools/cdp-rec.mjs open <port> <url>                          new page at url, in its own window (so every page stays visible and ticks)
//   node dev/tools/cdp-rec.mjs front <port> <urlPrefix>                   bring a page to the front
//   node dev/tools/cdp-rec.mjs eval <port> <urlPrefix> <js | @file>      evaluate (async body, `return` a value) -> JSON
//   node dev/tools/cdp-rec.mjs rec <port> <recPrefix> <out.webm> <ms> [<drivePrefix> <js | @file>] [--at ms]
//        screencast the page <recPrefix> for <ms>; after --at ms (default 400) the js runs in <drivePrefix> (not awaited); 30 fps webm.
import fs from "node:fs";
import { spawn } from "node:child_process";

const [cmd, port, a, b, c, d, e, ...rest] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const W = Number(process.env.CDP_W ?? 1600), H = Number(process.env.CDP_H ?? 900), DPR = Number(process.env.CDP_DPR ?? 1);   // the page size (open, rec)
const list = async () => (await fetch(`${base}/json/list`)).json();
async function connect(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let id = 0; const pend = new Map(), on = new Map();
  ws.addEventListener("message", (m) => { const q = JSON.parse(m.data); if ( q.id && pend.has(q.id) ) { pend.get(q.id)(q); pend.delete(q.id); } else if ( q.method ) on.get(q.method)?.(q.params); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ws, send, on: (m, fn) => on.set(m, fn), close: () => ws.close() };
}
const find = async (prefix) => { const t = (await list()).find((x) => x.type === "page" && x.url.startsWith(prefix)); if ( !t ) throw new Error(`no page ${prefix}: ${(await list()).map((x) => x.url).join(", ")}`); return t; };
const code = (s) => (s?.startsWith("@") ? fs.readFileSync(s.slice(1), "utf8") : s);
async function evaluate(t, js, wait = true) {
  const s = await connect(t);
  const p = s.send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: wait, returnByValue: true, timeout: 280000 });
  if ( !wait ) { await new Promise((r) => setTimeout(r, 50)); s.close(); return null; }
  const r = await p; s.close();
  return r.result?.exceptionDetails ? { exception: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text } : r.result?.result?.value;
}

async function browser() { return connect({ webSocketDebuggerUrl: (await (await fetch(`${base}/json/version`)).json()).webSocketDebuggerUrl }); }
if ( cmd === "open" ) {
  // each page in its OWN window: a background tab of a shared window is "hidden" and its requestAnimationFrame stops
  const br = await browser(), made = await br.send("Target.createTarget", { url: a, newWindow: true }); br.close();
  const t = (await list()).find((x) => x.id === made.result.targetId);
  const s = await connect(t);
  await s.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  await s.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  s.close(); console.log(t.id);
} else if ( cmd === "front" ) {
  const br = await browser(); await br.send("Target.activateTarget", { targetId: (await find(a)).id }); br.close();
} else if ( cmd === "eval" ) {
  console.log(JSON.stringify(await evaluate(await find(a), code(b)), null, 1));
} else if ( cmd === "rec" ) {
  const t = await find(a), out = b, ms = Number(c), at = Number((rest.concat([d, e])).join(" ").match(/--at (\d+)/)?.[1] ?? 400);
  const s = await connect(t);
  await s.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  if ( process.env.CDP_W ) { await s.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false }); await new Promise((r) => setTimeout(r, 300)); }
  const frames = [];
  s.on("Page.screencastFrame", (p) => { frames.push({ t: p.metadata.timestamp * 1000, data: p.data }); s.send("Page.screencastFrameAck", { sessionId: p.sessionId }); });
  await s.send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: Number(process.env.CDP_CAPW ?? W), maxHeight: Number(process.env.CDP_CAPH ?? H), everyNthFrame: 1 });
  const t0 = Date.now();
  if ( d && e && !String(d).startsWith("--") ) setTimeout(async () => { try { await evaluate(await find(d), code(e), false); } catch ( err ) { console.error(err.message); } }, at);
  await new Promise((r) => setTimeout(r, ms));
  await s.send("Page.stopScreencast"); s.close();
  if ( !frames.length ) { console.log("no frames"); process.exit(1); }
  const fps = 30, start = frames[0].t, end = start + ms, ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libvpx-vp9", "-b:v", "2.5M", "-pix_fmt", "yuv420p", out], { stdio: ["pipe", "inherit", "inherit"] });
  let j = 0;
  for ( let tt = start; tt < end; tt += 1000 / fps ) { while ( j + 1 < frames.length && frames[j + 1].t <= tt ) j++; ff.stdin.write(Buffer.from(frames[j].data, "base64")); }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t);
  console.log(JSON.stringify({ out, frames: frames.length, secs: (frames.at(-1).t - start) / 1000, wallMs: Date.now() - t0, maxGapMs: Math.round(Math.max(0, ...gaps)) }));
}
process.exit(0);
