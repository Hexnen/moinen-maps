// World weather "no squares" A/B across builds (lane GM page).   const S = await import("/modules/moinen-maps/dev/world-smooth.mjs")
// `S.capture(label)`: every world weather layer (rain, snow, sand, dust, embers, wind, tornado) with the LENS OFF at the fixed shared
// time T0, per zoom x DPR x darkness, whole-canvas shots kept as mm-rec/ws-<label>-<case>-z<z>-d<dpr>-n<dark>-<i>.png (swap the build
// on disk, reload, capture the other label). `S.steam(label)`: steam over a test fire stroke under rain. `S.offPng(label)`: the same views with NO weather (ws-<label>-none-...: the frame under
// the weather, for the world-only blocks metric). `S.offHashes()`: the no-weather frames hashed (equal on both builds = nothing but the
// weather changed). `S.video(name, effect, dark, {z, dpr})` (effect "steam" = rain over the fire stroke): a webm from shared time T0 + 6 s (virtual clock, frames read back).
// Compare and crop in node: dev/world-smooth-cmp.mjs.
import { rec } from "./lens-smooth.mjs";

const T0 = 1794150000000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const TIMES = [5000, 7300].map((d) => T0 + d);
export const CASES = [["rain", 3], ["snow", 3], ["sand", 3], ["dust", 3], ["embers", 3], ["wind", 3], ["tornado", 3]];
const C_ = [768, 512];

async function setup(effect, level, dpr, dark, z, { c = C_ } = {}) {
  const H = await import("./perf-harness.mjs"), C = await import("./weather-cost.mjs"), R = await import("./weather-rec.mjs");
  if ( canvas.app.renderer.resolution !== dpr ) await H.setDPR(dpr);
  if ( (canvas.scene.environment?.darknessLevel ?? 0) !== dark ) await R.dark(dark);
  canvas.pan({ x: c[0], y: c[1], scale: z }); await wait(300);
  await C.setCase(effect, level, { t: T0, lens: false, at: [c[0], c[1] + 48] });
  return C;
}

function prep() { (CONFIG.moinenMaps ??= {}).weatherGuard = false; }

const zsOf = (e, zs) => (e === "rain" ? zs : zs.filter((z) => z === 3));

export async function capture(label, { cases = CASES, zs = [0.5, 1, 3], dprs = [1, 2], darks = [0, 1] } = {}) {
  prep();
  const out = {};
  for ( const [e, l] of cases ) for ( const z of zsOf(e, zs) ) for ( const dpr of dprs ) for ( const dark of darks ) {
    const C = await setup(e, l, dpr, dark, z);
    const sh = C.shots(e === "rain" ? TIMES : TIMES.slice(1));
    for ( let i = 0; i < sh.length; i++ ) await png(`ws-${label}-${e}-z${z}-d${dpr}-n${dark}-${i}.png`, sh[i]);
    out[`${e} z${z} d${dpr} n${dark}`] = sh.map(C.hash);
  }
  return out;
}

/** The same views with no weather at all, kept as pngs (ws-<label>-none-<view>-<i>.png) and hashed. */
export async function offPng(label, { zs = [0.5, 1, 3], dprs = [1, 2], darks = [0, 1] } = {}) {
  prep();
  const out = {};
  for ( const z of zs ) for ( const dpr of dprs ) for ( const dark of darks ) {
    const C = await setup("off", 1, dpr, dark, z);
    const sh = C.shots(TIMES);
    for ( let i = 0; i < sh.length; i++ ) await png(`ws-${label}-none-z${z}-d${dpr}-n${dark}-${i}.png`, sh[i]);
    out[`none z${z} d${dpr} n${dark}`] = sh.map(C.hash);
  }
  return out;
}

/** A fire stroke at rest under the view's centre, written with a FIXED id (the format of dev/fire-rec.mjs place: its seed, so its
 * flames, are the same on both builds; scene flags only, no fire file touched); `fireOff` wipes every stroke. */
export async function fireOn() {
  const F = await import("./fire-rec.mjs");
  await F.wipe();
  const x = C_[0] - 20, y = C_[1] + 70;
  await canvas.scene.update({ "flags.moinen-maps.fireStrokes.wsSteam1": { id: "wsSteam1", k: "fire", s: 0.9, r: 34, p: [x - 70, y, x + 70, y + 4], wd: 0, ws: 0, q: 1000, lv: 3 } });
  await wait(2500);
}
export async function fireOff() { const F = await import("./fire-rec.mjs"); await F.wipe(); }

/** STEAM (rain over fire): the fire stroke, rain 3, the frames at TIMES (ws-<label>-steam-...), then the fire wiped; and how much of
 * each frame the steam layer is (the same frame with it hidden). */
export async function steam(label, { z = 3, dpr = 1, dark = 0 } = {}) {
  prep();
  await fireOn();
  const C = await setup("rain", 3, dpr, dark, z), out = [];
  await wait(4000);
  try {
    const S = game.modules.get("moinen-maps").api.weather.steamDisplay?.();
    const sh = C.shots(TIMES);
    for ( let i = 0; i < sh.length; i++ ) await png(`ws-${label}-steam-z${z}-d${dpr}-n${dark}-${i}.png`, sh[i]);
    out.push(sh.map(C.hash), { ...S?.stats });
    if ( S?.root ) {
      S.root.renderable = false;
      const sh0 = C.shots(TIMES);
      S.root.renderable = true;
      out.push(sh.map((x, i) => C.diff(x, sh0[i])));
    }
  } finally { await fireOff(); }
  return out;
}

/** A shot (RGBA, bottom row first) kept losslessly as an upright opaque png in mm-rec. */
export async function png(name, b) {
  const gl = canvas.app.renderer.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h }), g = c.getContext("2d"), im = g.createImageData(w, h);
  for ( let y = 0; y < h; y++ ) {
    im.data.set(b.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    for ( let x = 3; x < w * 4; x += 4 ) im.data[y * w * 4 + x] = 255;
  }
  g.putImageData(im, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const FP = foundry.applications.apps.FilePicker.implementation;
  return (await FP.upload("data", "mm-rec", new File([blob], name, { type: "image/png" }), {}, { notify: false }))?.path;
}

/** A webm of `effect` (level 3, lens off) from shared time T0 + 6 s (the same frames on any build), `ms` long. */
export async function video(name, effect, dark, { ms = 4000, z = 3, dpr = 1, level = 3 } = {}) {
  prep();
  const st = effect === "steam";
  if ( st ) await fireOn();
  try {
    await setup(st ? "rain" : effect, level, dpr, dark, z);
    if ( st ) await wait(4000);
    return await rec(name, ms, T0 + 6000);
  } finally { if ( st ) await fireOff(); }
}

/** Put the lane back: weather off, DPR 1, day, zoom 1, the dev overrides gone; the lens flag as `lens` (as it was found). */
export async function clean(lens = null) {
  const H = await import("./perf-harness.mjs"), C = await import("./weather-cost.mjs"), R = await import("./weather-rec.mjs");
  await C.setCase("off", 1);
  if ( lens ) await canvas.scene.update({ "flags.moinen-maps.weather.lens": lens });
  if ( canvas.app.renderer.resolution !== 1 ) await H.setDPR(1);
  if ( (canvas.scene.environment?.darknessLevel ?? 0) !== 0 ) await R.dark(0);
  canvas.pan({ scale: 1 });
  delete (CONFIG.moinenMaps ?? {}).weatherGuard;
}
