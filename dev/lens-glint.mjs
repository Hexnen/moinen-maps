// Lens glints A/B across builds (lane GM page).   const G = await import("/modules/moinen-maps/dev/lens-glint.mjs")
// `G.capture(label)`: rain 3 with the lens at the fixed shared time T0, per DPR x darkness, whole-canvas shots at fixed times, kept
// as mm-rec/glint-<label>-d<dpr>-n<dark>-<i>.png (one load per build: swap the build on disk, reload, capture the other label).
// Compare in node: `node dev/lens-glint-cmp.mjs <mm-rec dir> A B`: per shot, the pixels that differ, grouped into 8-connected
// clusters: their count, the largest cluster's box (CSS px) and the largest channel difference. A change confined to the glints = a
// few small clusters, nothing else.
// `G.video(name, dark)`: a webm of the same weather at the same shared times (virtual clock), for the side by side.
const T0 = 1794150000000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const TIMES = [5000, 5250, 5900, 7300].map((d) => T0 + d);

async function setup(dpr, dark, { z = 3, c = [768, 512] } = {}) {
  const H = await import("./perf-harness.mjs"), C = await import("./weather-cost.mjs"), R = await import("./weather-rec.mjs");
  if ( canvas.app.renderer.resolution !== dpr ) await H.setDPR(dpr);
  if ( (canvas.scene.environment?.darknessLevel ?? 0) !== dark ) await R.dark(dark);
  canvas.pan({ x: c[0], y: c[1], scale: z }); await wait(300);
  await C.setCase("rain", 3, { t: T0 });
  return C;
}

export async function capture(label, { dprs = [1, 2], darks = [0, 1], z = 3 } = {}) {
  (CONFIG.moinenMaps ??= {}).weatherGuard = false;
  const out = {};
  for ( const dpr of dprs ) for ( const dark of darks ) {
    const C = await setup(dpr, dark, { z });
    const sh = C.shots(TIMES);
    for ( let i = 0; i < sh.length; i++ ) await png(`glint-${label}-d${dpr}-n${dark}-${i}.png`, sh[i]);
    out[`d${dpr} n${dark}`] = sh.map(C.hash);
  }
  return out;
}

/** A shot (RGBA, bottom row first, as readPixels) kept losslessly as a png in mm-rec (upright; a .bin upload is refused). */
async function png(name, b) {
  const gl = canvas.app.renderer.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h }), g = c.getContext("2d"), im = g.createImageData(w, h);
  for ( let y = 0; y < h; y++ ) {
    const row = b.subarray((h - 1 - y) * w * 4, (h - y) * w * 4);
    im.data.set(row, y * w * 4);
    for ( let x = 3; x < w * 4; x += 4 ) im.data[y * w * 4 + x] = 255;   // (opaque: a png keeps the colour exactly)
  }
  g.putImageData(im, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const FP = foundry.applications.apps.FilePicker.implementation;
  return (await FP.upload("data", "mm-rec", new File([blob], name, { type: "image/png" }), {}, { notify: false }))?.path;
}

/** A webm of rain 3 + lens at zoom 3 from shared time T0 + 6 s (the same frames on any build), `ms` long, at DPR 1. */
export async function video(name, dark, { ms = 4000, z = 3, dpr = 1 } = {}) {
  (CONFIG.moinenMaps ??= {}).weatherGuard = false;
  await setup(dpr, dark, { z });
  const R = await import("./weather-rec.mjs"), real = Date.now;
  Date.now = () => T0 + 6000 - 1;   // (rec starts at the next whole second of "now": T0 + 6 s)
  try { return await R.rec(name, ms, { fps: 60, pace: 45 }); } finally { Date.now = real; }
}

/** A png crop (CSS px box at DPR `dpr`) of the canvas at shared time `t`, scaled up `k` times with no smoothing. */
export async function crop(name, t, [x, y, w, h], k = 4) {
  const C = await import("./weather-cost.mjs"), dpr = canvas.app.renderer.resolution;
  C.run(6, { t0: t - 5 * 1000 / 60 });
  canvas.app.renderer.render(canvas.app.stage);
  const V = canvas.app.view, o = Object.assign(document.createElement("canvas"), { width: w * dpr * k, height: h * dpr * k }), g = o.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(V, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, w * dpr * k, h * dpr * k);
  const blob = await new Promise((r) => o.toBlob(r, "image/png"));
  const FP = foundry.applications.apps.FilePicker.implementation;
  return (await FP.upload("data", "mm-rec", new File([blob], name, { type: "image/png" }), {}, { notify: false }))?.path;
}
