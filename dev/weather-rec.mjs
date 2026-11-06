// Weather: recording helpers for a lane GM page (browser side).   const R = await import("/modules/moinen-maps/dev/weather-rec.mjs")
// As dev/fire-rec.mjs: `rec` drives the frames itself on a VIRTUAL clock (Date.now, so sharedNow and the weather's shader time, steps
// exactly 1 / fps per captured frame), renders and captures each frame once, uploads the webm to the lane's Data/mm-rec; re-time it
// with `node dev/fire-retime.mjs <in> <out> 60 <frames>` (fixed rate, frame count, no duplicates). `snap` uploads a full-res png.
// `set(preset, level, opts)` puts the weather at a level at once (over 0) and lets the ground be wet already (base wet).
const FP = () => foundry.applications.apps.FilePicker.implementation;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const W = () => game.modules.get("moinen-maps").api.weather;

/** Hide the page furniture that is not canvas (the recording is the canvas only anyway), unpause. */
export async function prep() {
  document.querySelector("#mm-filter")?.style.setProperty("display", "none"); document.querySelector("#pause")?.remove();
  if ( game.paused ) game.togglePause(false, { broadcast: true });
  await ui.controls.activate({ control: "tokens" });
}
/** The weather at once: preset at level, wind, wet ground already at `wet` (0..1), lens level (false = lens off). */
export async function set(preset, level = 2, { wind = { dir: 20, str: 0.45, gust: 0.7 }, wet = null, lens = "auto", i = 0.5 } = {}) {
  const now = Date.now();
  const M = W().model, P0 = W().params();
  const key = M.cleanKey({ t: now - 60000, dur: 0, preset, level, i, wind });
  const base = { t: now - 60000, fx: {}, wind, wet: wet ?? M.wetCeil(level - 1 + (i - 0.5) * 0.7) };
  await canvas.scene.update({ "flags.moinen-maps.weather": { ...P0, keys: [key], base, lens: { ...P0.lens, on: lens !== false, level: lens === false ? P0.lens.level : lens } } });
  await wait(1200);
  W().refresh();
}
export function view(x, y, scale) { canvas.pan({ x, y, scale }); for ( let i = 0; i < 3; i++ ) canvas.app.ticker.update(performance.now()); }
export async function dark(d) {
  await canvas.scene.update({ "environment.darknessLevel": d }, { animateDarkness: 0 }); await wait(1500);
  for ( let i = 0; i < 5; i++ ) canvas.app.ticker.update(performance.now());
}

/** Record `ms` of effect time as `name` (webm) on a virtual clock (see dev/fire-rec.mjs). Returns [bytes, path, frames, fps]. */
export async function rec(name, ms, { fps = 60, pace = 30, during = [] } = {}) {
  const st = canvas.app.view.captureStream(0), tr = st.getVideoTracks()[0], T = canvas.app.ticker, mf = T.maxFPS; T.maxFPS = 0;
  const rc = new MediaRecorder(st, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 10e6 }), parts = [];
  rc.ondataavailable = (e) => parts.push(e.data);
  const realNow = Date.now, dt = 1000 / fps, n = Math.round(ms / dt);
  const base = Math.ceil(realNow() / 1000) * 1000 + 1, perf0 = performance.now(), fired = new Set();
  let vt = base;
  Date.now = () => Math.floor(vt);
  rc.start();
  try {
    for ( let i = 0; i < n; i++ ) {
      vt = base + i * dt;
      for ( const [at, fn] of during ) if ( i * dt >= at && !fired.has(at) ) { fired.add(at); fn(); }
      T.update(perf0 + i * dt); canvas.app.renderer.render(canvas.app.stage); tr.requestFrame();
      await wait(pace);
    }
  } finally { Date.now = realNow; T.maxFPS = mf; }
  rc.stop(); await new Promise((r) => { rc.onstop = r; });
  const file = new File(parts, name, { type: "video/webm" });
  try { await FP().createDirectory("data", "mm-rec"); } catch { /* there */ }
  const r = await FP().upload("data", "mm-rec", file, {}, { notify: false });
  return [file.size, r?.path, n, fps];
}

/** A still of the canvas (full resolution) as `name` (png); `at` = a virtual shared ms to render at (optional). */
export async function snap(name, at = null) {
  const realNow = Date.now; if ( at ) Date.now = () => at;
  try { canvas.app.ticker.update(performance.now()); canvas.app.renderer.render(canvas.app.stage); } finally { Date.now = realNow; }
  const blob = await new Promise((r) => canvas.app.view.toBlob(r, "image/png"));
  const file = new File([blob], name, { type: "image/png" });
  try { await FP().createDirectory("data", "mm-rec"); } catch { /* there */ }
  const r = await FP().upload("data", "mm-rec", file, {}, { notify: false });
  return [file.size, r?.path];
}

/** Consecutive frames as pngs (a strip for checking smoothness): `n` frames 1 / fps apart starting at shared ms `t0`. */
export async function strip(prefix, n = 6, fps = 60, t0 = Math.ceil(Date.now() / 1000) * 1000 + 1) {
  const out = [];
  for ( let i = 0; i < n; i++ ) out.push((await snap(`${prefix}-${String(i).padStart(2, "0")}.png`, t0 + i * 1000 / fps))[1]);
  return out;
}
