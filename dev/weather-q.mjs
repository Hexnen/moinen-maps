// THE FRAME GUARD'S DETAIL per weather type (lane GM page).   const Q = await import("/modules/moinen-maps/dev/weather-q.mjs")
// `await Q.sweep({ cases, views, qs, shots })`: for each view [DPR, zoom] and case [effect, level], the weather at q held fixed
// (CONFIG.moinenMaps.weatherQ: the detail the guard gives at that level, without a load), each q in turn: the GPU per pass group
// (weather-cost.mjs passes: ms per frame on the stepped shared clock) and, with `shots`, a frame at a fixed shared time uploaded as
// mm-rec/q-<label>-<case>-<dpr>-<zoom>-<q>.png (crop and compare them: the look at each guard level). Cases: a preset; "tornado";
// "off+clouds" (clouds L + godrays); "lens" (rain + the lens); "steam" (rain over three fire strokes it adds and removes again).
// Groups: display (the drops, particles, ground, haze), lens, tornado, clouds, steam. Repeat a q in `qs` to get repetitions (noisy:
// one sample of a pass swings 20-50 %; take the median).
// 2026-11-09 (3070 Ti, 1584 x 805 CSS px, medians of 2): see the README's frame-guard paragraph.
const MOD = "moinen-maps";
const W = () => game.modules.get(MOD).api.weather;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const CASES = [["rain", 3], ["snow", 3], ["sand", 3], ["dust", 3], ["embers", 3], ["wind", 3], ["tornado", 3], ["off+clouds", 3], ["lens", 3], ["steam", 3]];
export const OWN = { lens: "lens", steam: "steam", tornado: "tornado", "off+clouds": "clouds" };
const group = (k) => k.startsWith("cpu.") ? null : k.startsWith("lens.") ? "lens" : k.startsWith("torn.") ? "tornado" : k.startsWith("clouds.") ? "clouds" : k === "steam" ? "steam" : "display";

/** Three fire strokes near the view centre (on) or none of this tool's (off); waits until the fire is built. */
export async function fire(on) {
  const F = canvas.scene.flags[MOD]?.fireStrokes ?? {}, upd = {};
  for ( const k of Object.keys(F) ) if ( !on && k.startsWith("qsF") ) upd[`flags.${MOD}.fireStrokes.-=${k}`] = null;
  if ( on ) for ( let i = 0; i < 3; i++ ) {
    const x = 640 + i * 120, y = 470 + (i % 2) * 70, id = `qsF${i}`;
    if ( !F[id] ) upd[`flags.${MOD}.fireStrokes.${id}`] = { id, k: "fire", s: 0.85, r: 22, p: [x - 30, y, x + 30, y + 6], wd: 0, ws: 0, q: 7 + i, lv: 3, sm: 0, e: 1 };
  }
  if ( Object.keys(upd).length ) await canvas.scene.update(upd);
  const A = game.modules.get(MOD).api;
  for ( let i = 0; i < 300 && (A.fire.status().pending ?? 0) > 0; i++ ) await wait(100);
  await wait(1500);
}

export async function sweep({ cases = CASES, views = [[1, 1], [1, 3], [2, 1]], qs = [1, 0.7, 0.5, 0.35], shots = false, label = "x", T0 = 1794150000000, n = 60, onRow = null } = {}) {
  const C = await import("./weather-cost.mjs"), H = await import("./perf-harness.mjs");
  const MM = (CONFIG.moinenMaps ??= {}), rows = [], dpr0 = canvas.app.renderer.resolution;
  const FP = foundry.applications.apps.FilePicker.implementation;
  try {
    for ( const [dpr, z] of views ) {
      if ( canvas.app.renderer.resolution !== dpr ) await H.setDPR(dpr);
      canvas.pan({ x: 768, y: 512, scale: z }); await wait(400);
      for ( const [e, l] of cases ) {
        const steam = e === "steam";
        if ( steam ) await fire(true);
        const opt = { t: T0, at: [768, 560], lens: e === "lens" ? "auto" : false };
        if ( e === "off+clouds" ) opt.clouds = { mode: "sky", rays: true };
        await C.setCase(e === "lens" || steam ? "rain" : e, l, opt);
        for ( const q of qs ) {
          MM.weatherQ = q;
          const p = await C.passes({ n, t0: T0 + 6000 }), g = {};
          for ( const [k, v] of Object.entries(p) ) { const G = group(k); if ( G ) g[G] = +((g[G] ?? 0) + v.f).toFixed(3); }
          const row = { e, l, dpr, z, q, own: g[OWN[e] ?? "display"] ?? 0, g, passes: p };
          if ( shots ) {
            const gl = canvas.app.renderer.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, [b] = C.shots([T0 + 7000]);
            const oc = new OffscreenCanvas(w, h); oc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(b.buffer), w, h), 0, 0);
            const blob = await oc.convertToBlob({ type: "image/png" });
            row.shot = (await FP.upload("data", "mm-rec", new File([blob], `q-${label}-${e.replace("+", "_")}-${dpr}-${z}-${q}.png`, { type: "image/png" }), {}, { notify: false }))?.path;
          }
          rows.push(row); onRow?.(row);
        }
        if ( steam ) await fire(false);
      }
    }
  } finally { delete MM.weatherQ; await H.setDPR(dpr0); await C.setCase("off", 1); }
  return rows;
}

/** Median own-group GPU per case x view x q from sweep rows: { "<e> d<dpr> z<z>": { q: ms } }. */
export function table(rows) {
  const t = {};
  for ( const r of rows ) ((t[`${r.e} d${r.dpr} z${r.z}`] ??= {})[r.q] ??= []).push(r.own);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  for ( const v of Object.values(t) ) for ( const q of Object.keys(v) ) v[q] = med(v[q]);
  return t;
}
