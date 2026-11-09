// Record a destruction PRESET firing on a lane GM page in a headless Chrome over CDP: scene, view, wipe, fire, screencast click -> settled.
//   node dev/tools/preset-rec.mjs <cdpPort> <urlPrefix> <out.webm> <json opts>
//   opts { scene: "ZZ-pol-day", id: "bomb", a: [x, y], b?: [x, y], from?, at?: [x, y] (view centre, default a / mid a-b), zoom: 1, ms: 12000,
//          seed: 7, pre: 600 (ms recorded before the click), crop?: [x, y, w, h] (CSS px of the page, a region captured at full DPR),
//          ui: false (hide the Foundry interface), from?: [x, y] + fr?: px (a shooter: its centre and radius) }
// The screencast frames are resampled to 30 fps (the frame shown at each 1/30 s), vp9 webm. Prints { frames, secs, maxGapMs, t0Lag }.
// Only scenes named ZZ-... are wiped (guns-cost wipe).
import { spawn } from "node:child_process";
import { connect } from "./cdp-lane.mjs";

const [port, prefix, out, js] = process.argv.slice(2);
const o = { scene: "ZZ-pol-day", zoom: 1, ms: 12000, seed: 7, pre: 600, ui: false, ...JSON.parse(js ?? "{}") };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = await connect(port, prefix);
await c.front();
const prep = await c.ev(`
  const o = ${JSON.stringify(o)};
  const sc = game.scenes.getName(o.scene); if ( !sc ) throw new Error("no scene " + o.scene);
  if ( canvas.scene?.id !== sc.id ) { await sc.view(); await new Promise((r) => setTimeout(r, 4000)); }
  const G = await import("/modules/moinen-maps/dev/guns-cost.mjs"); await G.wipe();
  for ( const id of ["interface", "invincible-combat-bar", "notifications", "pause", "mm-orbit-strip", "hud"] ) { const I = document.getElementById(id); if ( I ) I.style.visibility = o.ui ? "" : "hidden"; }
  const at = o.at ?? (o.b ? [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2] : o.a);
  canvas.pan({ x: at[0], y: at[1], scale: o.zoom, duration: 0 });
  await new Promise((r) => setTimeout(r, 2500));
  return { scene: canvas.scene.name, scale: canvas.stage.scale.x, dpr: devicePixelRatio };`);
const frames = [];
let cap = { maxWidth: 1600, maxHeight: 900 };
if ( o.crop ) {
  // capture only the crop region at full device pixels: emulate a viewport offset with a clip via screenshots is slow, so instead
  // scale the screencast to full DPR and crop in ffmpeg
  cap = { maxWidth: 3200, maxHeight: 1800 };
}
const s2 = await (async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const t = list.find((x) => x.id === c.id);
  const w = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => w.addEventListener("open", r));
  let id = 0; const pend = new Map();
  w.addEventListener("message", (m) => {
    const q = JSON.parse(m.data);
    if ( q.id && pend.has(q.id) ) { pend.get(q.id)(q); pend.delete(q.id); }
    else if ( q.method === "Page.screencastFrame" ) { frames.push({ t: q.params.metadata.timestamp * 1000, data: q.params.data }); w.send(JSON.stringify({ id: ++id, method: "Page.screencastFrameAck", params: { sessionId: q.params.sessionId } })); }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); w.send(JSON.stringify({ id: i, method, params })); });
  return { send, close: () => w.close() };
})();
await s2.send("Page.startScreencast", { format: "jpeg", quality: 85, ...cap, everyNthFrame: 1 });
await sleep(o.pre);
const tClick = Date.now();
const fired = await c.ev(`
  const o = ${JSON.stringify(o)};
  const P = game.modules.get("moinen-maps").api.presets;
  // (o.off: layer ids switched off - a diagnosis of which layer draws what)
  const def = o.def ? o.def : o.off ? { ...P.get(o.id), id: o.id + "-diag", layers: P.get(o.id).layers.filter((l) => !o.off.includes(l.id)) } : o.id;
  const rec = await P.fire(def, { a: o.a, ...(o.b ? { b: o.b } : {}), ...(o.from ? { from: o.from } : {}), ...(o.fr ? { fr: o.fr } : {}) }, { seed: o.seed, ...(o.opts ?? {}) });
  const t0 = rec?.plan?.t0 ?? null;
  if ( o.clock && t0 ) {
    // (diagnosis only: a label with the shared clock relative to the impact, in every frame)
    const { sharedNow } = await import("/modules/moinen-maps/scripts/shared-clock.mjs");
    const el = document.createElement("div"); el.id = "mm-rec-clock";
    Object.assign(el.style, { position: "fixed", ...(o.crop ? { left: o.crop[0] + 4 + "px", top: o.crop[1] + o.crop[3] - 30 + "px" } : { left: "8px", bottom: "8px" }), zIndex: 99999, font: "bold 20px monospace", color: "#fff", background: "#000a", padding: "2px 6px", pointerEvents: "none" });
    document.body.appendChild(el);
    window.__gaps = []; let last = performance.now();
    const up = () => { if ( !el.isConnected ) return; const n = performance.now(); if ( n - last > 45 ) window.__gaps.push([Math.round(sharedNow() - t0 - (n - last)), Math.round(n - last)]); last = n; el.textContent = "T" + (sharedNow() - t0 >= 0 ? "+" : "") + Math.round(sharedNow() - t0); requestAnimationFrame(up); };
    up(); setTimeout(() => el.remove(), o.ms + 2000);
  }
  return { fid: rec?.id ?? null, t0 };`);
await sleep(Math.max(0, o.ms - (Date.now() - tClick)));
await s2.send("Page.stopScreencast"); s2.close();
const rafGaps = o.clock ? await c.ev("return window.__gaps") : undefined;
c.close();
if ( !frames.length ) { console.log("no frames"); process.exit(1); }
const fps = o.fps ?? 30, start = frames[0].t, end = frames.at(-1).t;
const vf = o.crop ? ["-vf", `crop=${o.crop[2] * 2}:${o.crop[3] * 2}:${o.crop[0] * 2}:${o.crop[1] * 2}`] : [];
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", ...vf,
  "-c:v", "libvpx-vp9", "-b:v", o.crop ? "6M" : "4M", "-pix_fmt", "yuv420p", out], { stdio: ["pipe", "inherit", "inherit"] });
let j = 0;
for ( let tt = start; tt < end; tt += 1000 / fps ) { while ( j + 1 < frames.length && frames[j + 1].t <= tt ) j++; ff.stdin.write(Buffer.from(frames[j].data, "base64")); }
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((a, b) => a - b);
console.log(JSON.stringify({ out, prep, fired, rafGaps, frames: frames.length, secs: Math.round(end - start) / 1000, medGapMs: Math.round(gaps[gaps.length >> 1]), maxGapMs: Math.round(gaps.at(-1)), clickAtS: (tClick - start) / 1000 }));
process.exit(0);
