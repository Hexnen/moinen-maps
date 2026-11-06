// Fire and smoke: recording / layout helpers for a lane GM page (browser side).
//   const R = await import("/modules/moinen-maps/dev/fire-rec.mjs")
// The Browser pane may tick at ~1 Hz while hidden: `rec` drives the frames itself (ticker.update + requestFrame at 30 fps of real
// time) and uploads the webm to the lane's Data/mm-rec (copy it into dev/out from there).
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
/** Strokes painted long ago (at rest): [{ x, y, k, lv, sm, st, c, r, s, len, wd, ws }]. */
export async function place(list) {
  const upd = {};
  list.forEach((o, i) => {
    const id = `r${i}${Math.random().toString(36).slice(2, 6)}`, len = o.len ?? 60;
    upd[`flags.moinen-maps.fireStrokes.${id}`] = { id, k: o.k ?? "fire", s: o.s ?? 0.9, r: o.r ?? 28, p: [o.x - len / 2, o.y, o.x + len / 2, o.y + 4], wd: o.wd ?? 0, ws: o.ws ?? 0, q: 1000 + i, lv: o.lv, sm: o.sm, st: o.st, c: o.c };
  });
  await canvas.scene.update(upd); await wait(2500);
}
/** Paint now through the API (it catches and grows): returns the stroke. */
export const paint = (o) => api().paint(o.pts ?? [[o.x - (o.len ?? 60) / 2, o.y], [o.x + (o.len ?? 60) / 2, o.y + 4]], { kind: o.k ?? "fire", radius: o.r ?? 28, strength: o.s ?? 0.9, level: o.lv ?? 2, smoke: o.sm ?? 2, style: o.st ?? "fire", color: o.c, wind: { dir: o.wd ?? 0, speed: o.ws ?? 0 } });
export async function dark(d) {
  await canvas.scene.update({ "environment.darknessLevel": d }, { animateDarkness: 0 }); await wait(1500);
  for ( let i = 0; i < 5; i++ ) canvas.app.ticker.update(performance.now());
}
export function view(x, y, scale) { canvas.pan({ x, y, scale }); for ( let i = 0; i < 3; i++ ) canvas.app.ticker.update(performance.now()); }
/** Record `ms` of the canvas as `name` (webm), running `during` = [[atMs, fn], ...] on the way. */
export async function rec(name, ms, during = []) {
  const st = canvas.app.view.captureStream(0), tr = st.getVideoTracks()[0], T = canvas.app.ticker, mf = T.maxFPS; T.maxFPS = 0;
  const rc = new MediaRecorder(st, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 10e6 }), parts = [];
  rc.ondataavailable = (e) => parts.push(e.data); rc.start();
  const t0 = performance.now(), fired = new Set(); let n = 0, next = t0;
  try {
    while ( performance.now() - t0 < ms ) {
      const el = performance.now() - t0;
      for ( const [at, fn] of during ) if ( el >= at && !fired.has(at) ) { fired.add(at); fn(); }
      T.update(performance.now()); tr.requestFrame(); n++; next += 1000 / 30;
      while ( performance.now() < next ) await new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });
    }
  } finally { T.maxFPS = mf; }
  rc.stop(); await new Promise((r) => { rc.onstop = r; });
  const file = new File(parts, name, { type: "video/webm" });
  try { await FP().createDirectory("data", "mm-rec"); } catch { /* there */ }
  const r = await FP().upload("data", "mm-rec", file, {}, { notify: false });
  return [file.size, r?.path, n];
}
