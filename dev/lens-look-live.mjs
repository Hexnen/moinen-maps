// DROPS live (lane GM page, fronted):   const D = await import("/modules/moinen-maps/dev/lens-look-live.mjs")
// The two looks of the weather lens on the real renderer, at the same shared times (the lens is a pure function of the clock):
//   await D.begin()                      keep the scene's weather flag and the table's look (D.end() puts both back)
//   await D.look("pixel" | "smooth")      the table's look (the GM's world setting, live)
//   await D.rain({ level, z, dpr, dark, c })   rain + lens at T0, the view at c / zoom z, DPR, darkness
//   await D.png(name, t)                  the canvas at shared time t as a lossless png in mm-rec/ (+ the lens off: name-off.png)
//   await D.film(name, { ms, t0 })        a 60 fps webm on the virtual clock (lens-smooth.mjs rec): the same frames on any run
//   await D.cost({ n })                   the lens's GPU per pass (weather-cost.mjs passes) for the look now
//   D.gl()                                the lens programs linked and no GL error
//   await D.end()
const W = () => game.modules.get("moinen-maps").api.weather;
const tick_ = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const wait = async (ms) => { const end = performance.now() + ms; while ( performance.now() < end ) await tick_(); };
export const T0 = 1794150000000;
let saved = null;

export async function begin() {
  const f = canvas.scene.getFlag("moinen-maps", "weather");
  const doc = () => game.settings.storage.get("world").getSetting("moinen-maps.weatherLensLook");
  saved = { doc, stored: !!doc(), flag: f ? structuredClone(f) : null, look: await W().look(), dpr: canvas.app.renderer.resolution, dark: canvas.scene.environment?.darknessLevel ?? 0 };
  const M = (CONFIG.moinenMaps ??= {}); M.weatherGuard = false; M.weatherLensBands = 1;
  return saved;
}
export async function look(v) { const r = await W().look(v); await wait(400); W().refresh(); await wait(300); return r; }
export async function rain({ level = 3, z = 1, dpr = 1, dark = 0, c = null } = {}) {
  const H = await import("./perf-harness.mjs"), C = await import("./weather-cost.mjs"), R = await import("./weather-rec.mjs");
  if ( canvas.app.renderer.resolution !== dpr ) await H.setDPR(dpr);
  if ( (canvas.scene.environment?.darknessLevel ?? 0) !== dark ) await R.dark(dark);
  const r = canvas.dimensions.sceneRect, cc = c ?? [r.x + r.width / 2, r.y + r.height / 2];
  canvas.pan({ x: cc[0], y: cc[1], scale: z }); await wait(300);
  await C.setCase("rain", level, { t: T0 });
  return W().status().lensStats;
}
/** The canvas at shared time t (ms) as a png (and, with off, the same frame with the lens hidden: what lies under the glass). */
export async function png(name, t, { off = false } = {}) {
  const C = await import("./weather-cost.mjs");
  const out = [await save(`${name}.png`, C.shots([t])[0])];
  if ( off ) {
    const s = W().lensDisplay()?.sprite; if ( s ) s.renderable = false;
    try { out.push(await save(`${name}-off.png`, C.shots([t])[0])); } finally { if ( s ) s.renderable = true; }
  }
  return out;
}
async function save(name, b) {
  const gl = canvas.app.renderer.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const cv = Object.assign(document.createElement("canvas"), { width: w, height: h }), g = cv.getContext("2d"), im = g.createImageData(w, h);
  for ( let y = 0; y < h; y++ ) im.data.set(b.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  for ( let k = 3; k < im.data.length; k += 4 ) im.data[k] = 255;
  g.putImageData(im, 0, 0);
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const FP = foundry.applications.apps.FilePicker.implementation;
  return (await FP.upload("data", "mm-rec", new File([blob], name, { type: "image/png" }), {}, { notify: false }))?.path;
}
export async function film(name, { ms = 5000, t0 = T0 + 6000 } = {}) { return (await import("./lens-smooth.mjs")).rec(name, ms, t0); }
export async function cost({ n = 120 } = {}) {
  const C = await import("./weather-cost.mjs"), p = await C.passes({ n, t0: T0 + 6000 }), out = {};
  for ( const [k, v] of Object.entries(p) ) if ( k.startsWith("lens") || k === "cpu.lens" ) out[k] = v;
  out.sum = +Object.entries(out).filter(([k]) => !k.startsWith("cpu")).reduce((a, [, v]) => a + v.f, 0).toFixed(3);
  out.look = W().lensDisplay()?.stats?.look; out.lpx = W().lensDisplay()?.stats?.lpx; out.dpr = canvas.app.renderer.resolution;
  return out;
}
export function gl() {
  const L = W().lensDisplay(), r = canvas.app.renderer, g = r.gl, out = { look: L?.stats?.look, err: g.getError() };
  [L?.slices?.[0], L?.dslices?.[0], L?.runMesh, L?.beadMesh, L?.sprite].forEach((m, i) => {
    const p = m?.shader?.program, gp = p?.glPrograms?.[r.CONTEXT_UID]?.program;
    out[["pass", "disp", "pre1", "pre2", "show"][i]] = gp ? g.getProgramParameter(gp, g.LINK_STATUS) : "not linked yet";
  });
  return out;
}
export async function end() {
  const H = await import("./perf-harness.mjs"), R = await import("./weather-rec.mjs");
  if ( saved ) {
    if ( saved.flag ) await canvas.scene.update({ "flags.moinen-maps.weather": saved.flag });
    else await canvas.scene.unsetFlag("moinen-maps", "weather");
    await W().look(saved.look);
    if ( !saved.stored ) await saved.doc()?.delete();   // (the world had no stored look: none again)
    if ( canvas.app.renderer.resolution !== saved.dpr ) await H.setDPR(saved.dpr);
    if ( (canvas.scene.environment?.darknessLevel ?? 0) !== saved.dark ) await R.dark(saved.dark);
  }
  const M = CONFIG.moinenMaps ?? {}; delete M.weatherGuard; delete M.weatherLensBands;
  canvas.pan({ scale: 1 }); W().refresh();
  return "restored";
}
