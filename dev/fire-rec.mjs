// Fire and smoke: recording / layout helpers for a lane GM page (browser side).
//   const R = await import("/modules/moinen-maps/dev/fire-rec.mjs")
// The Browser pane may tick at ~1 Hz while hidden: `rec` drives the frames itself on a virtual clock (exactly 1 / fps of effect time
// per captured frame) and uploads the webm to the lane's Data/mm-rec; re-time it with dev/fire-retime.mjs (copy it into dev/out).
const FP = () => foundry.applications.apps.FilePicker.implementation;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = () => game.modules.get("moinen-maps").api.fire;

/** Prepare the page: no filter overlay, no pause banner, the token layer. */
export async function prep() {
  document.querySelector("#mm-filter")?.style.setProperty("display", "none"); document.querySelector("#pause")?.remove();
  await ui.controls.activate({ control: "tokens" });
}
/** Remove every fire stroke at once (no animation: a test reset). */
export async function wipe() {
  const keys = Object.keys(canvas.scene.flags["moinen-maps"]?.fireStrokes ?? {});
  if ( keys.length ) await canvas.scene.update(Object.fromEntries(keys.map((k) => [`flags.moinen-maps.fireStrokes.-=${k}`, null])));
  await wait(800);
}
/** Strokes painted long ago (at rest): [{ x, y, k, lv, sm, st, c, r, s, len, wd, ws, pts, e (organic edge), tn (torn) }]. */
export async function place(list) {
  const upd = {};
  list.forEach((o, i) => {
    const id = `r${i}${Math.random().toString(36).slice(2, 6)}`, len = o.len ?? 60;
    upd[`flags.moinen-maps.fireStrokes.${id}`] = { id, k: o.k ?? "fire", s: o.s ?? 0.9, r: o.r ?? 28, p: o.pts ? o.pts.flat() : [o.x - len / 2, o.y, o.x + len / 2, o.y + 4], wd: o.wd ?? 0, ws: o.ws ?? 0, q: 1000 + i, lv: o.lv, sm: o.sm, st: o.st, c: o.c,
      ...(o.e ? { e: 1 } : {}), ...(o.tn ? { tn: o.tn } : {}) };
  });
  await canvas.scene.update(upd); await wait(2500);
}
/** Paint now through the API (it catches and grows; `k: "dust"` with `dk` the dust kind): returns the stroke. */
export const paint = (o) => api().paint(o.pts ?? [[o.x - (o.len ?? 60) / 2, o.y], [o.x + (o.len ?? 60) / 2, o.y + 4]], { kind: o.k ?? "fire", radius: o.r ?? 28, strength: o.s ?? 0.9, level: o.lv ?? 2, smoke: o.sm ?? 2, style: o.st ?? "fire", color: o.c, wind: { dir: o.wd ?? 0, speed: o.ws ?? 0 }, torn: o.tn, dust: o.dk });
export async function dark(d) {
  await canvas.scene.update({ "environment.darknessLevel": d }, { animateDarkness: 0 }); await wait(1500);
  for ( let i = 0; i < 5; i++ ) canvas.app.ticker.update(performance.now());
}
export function view(x, y, scale) { canvas.pan({ x, y, scale }); for ( let i = 0; i < 3; i++ ) canvas.app.ticker.update(performance.now()); }
/**
 * Record `ms` of EFFECT time as `name` (webm), DETERMINISTIC: the clock the fire reads (Date.now, so sharedNow; the ticker's time) is
 * virtual during the recording and steps exactly 1 / fps per captured frame; each step is rendered, waits for the field worker
 * (fire.status().pending less .adopting - new areas being made ready take the frames they take, A13) and is captured once
 * (track.requestFrame), paced in real time so the encoder never drops one. The webm's
 * own timestamps are wall-clock, so re-time it to a fixed rate with `node dev/fire-retime.mjs <file.webm>` (setpts = N / fps; it
 * checks the frame count and the deltas). fps 60: each 12 fps art frame is held exactly 5 video frames (the virtual clock starts
 * 1 ms after a whole art frame, so the art steps fall on frame boundaries). `during` = [[atMs, fn], ...] in effect time. `base`: the
 * virtual clock's start (ms; a whole second + 1), to record the same moment of a fire again (A/B).
 * Returns [bytes, path, frames, fps].
 */
export async function rec(name, ms, during = [], { fps = 60, pace = 34, base: base0 = null } = {}) {
  const st = canvas.app.view.captureStream(0), tr = st.getVideoTracks()[0], T = canvas.app.ticker, mf = T.maxFPS; T.maxFPS = 0;
  const rc = new MediaRecorder(st, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 12e6 }), parts = [];
  rc.ondataavailable = (e) => parts.push(e.data);
  const realNow = Date.now, dt = 1000 / fps, n = Math.round(ms / dt);
  const base = base0 ?? Math.ceil(realNow() / 1000) * 1000 + 1, perf0 = performance.now(), fired = new Set();
  let vt = base;
  Date.now = () => Math.floor(vt);
  // (each frame: wait for the field worker, then redraw at once - the layer's own redraw waits for a requestAnimationFrame and its
  // phase timer for real time, both late against the virtual clock: a stroke would show up seconds into its grow, a pop)
  const FM = await import("/modules/moinen-maps/scripts/fire/fire.mjs"), CK = await import("/modules/moinen-maps/scripts/shared-clock.mjs");
  // (the shared clock's skew is refined by every scene update against Date.now: on the virtual clock that reads as a client falling
  // behind, and each edit during the recording would jump the fire's time forward - held for the recording)
  CK.holdClock?.(true);
  const settle = async () => {
    for ( let k = 0; k < 200 && ((api().status().pending ?? 0) - (api().status().adopting ?? 0)) > 0; k++ ) await wait(10);
    FM.draw();
    for ( let k = 0; k < 200 && ((api().status().pending ?? 0) - (api().status().adopting ?? 0)) > 0; k++ ) await wait(10);
    FM.draw();
  };
  // (the recorder starts asynchronously: frames requested before it runs are lost - wait for it; and let the encoder take the last
  // frames before stopping)
  await new Promise((r) => { rc.onstart = r; rc.start(); setTimeout(r, 1000); }); await wait(250);
  try {
    for ( let i = 0; i < n; i++ ) {
      vt = base + i * dt;
      for ( const [at, fn] of during ) if ( i * dt >= at && !fired.has(at) ) { fired.add(at); fn(); }
      await settle();
      T.update(perf0 + i * dt); canvas.app.renderer.render(canvas.app.stage); tr.requestFrame();
      await wait(pace);
    }
  } finally { Date.now = realNow; T.maxFPS = mf; CK.holdClock?.(false); }
  await wait(500);
  rc.stop(); await new Promise((r) => { rc.onstop = r; });
  const file = new File(parts, name, { type: "video/webm" });
  try { await FP().createDirectory("data", "mm-rec"); } catch { /* there */ }
  const r = await FP().upload("data", "mm-rec", file, {}, { notify: false });
  return [file.size, r?.path, n, fps];
}
/** A still of the canvas as it is now (full resolution), uploaded as `name` (png) next to the recordings. */
export async function snap(name) {
  const T = canvas.app.ticker; T.update(performance.now());
  canvas.app.renderer.render(canvas.app.stage);
  const blob = await new Promise((r) => canvas.app.view.toBlob(r, "image/png"));
  const file = new File([blob], name, { type: "image/png" });
  try { await FP().createDirectory("data", "mm-rec"); } catch { /* there */ }
  const r = await FP().upload("data", "mm-rec", file, {}, { notify: false });
  return [file.size, r?.path];
}
