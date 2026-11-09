// Weather cost per PASS (lane GM page).   const C = await import("/modules/moinen-maps/dev/weather-cost.mjs")
// `await C.passes({ n })`: steps the shared clock (Date.now and the ticker, 60 Hz, nothing dropped) for n frames, renders each, and times
// every weather pass on the GPU by its own timer query (the batch flushed before and after, so nothing else lands in it) and every
// weather ticker on the CPU. Per key: `f` = ms per FRAME (sum over the frames / n: a pass that runs 12 times a second counts 1/5),
// `c` = ms per CALL (median), `k` = calls per frame. `frame` (C.frame) = the whole ticker step incl. the render (CPU) and its GPU time,
// separately (timer queries do not nest).
// `await C.matrix(cases)`: rows over effect x level x zoom x DPR. `await C.shots(times)` / `C.diff(a, b)`: frames at fixed shared times
// (the weather is a pure function of the clock) for the A/B pixel check across builds (the page reloaded on each build).
// (a wait that a hidden Browser pane does not stretch: a background page's timers can be held back to once a minute; a message
// channel's turn is not, and every turn lets the socket and the other events in)
const tick_ = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const wait = async (ms) => { const end = performance.now() + ms; while ( performance.now() < end ) await tick_(); };
const W = () => game.modules.get("moinen-maps").api.weather;
const r3 = (x) => Math.round(x * 1000) / 1000;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/** Wait (up to 5 s) until every timer query's result is available: a heavy frame's results come in late (2026-11-09: a fixed 250 ms
 * dropped most of them under the frame-guard sweep's 8x load at DPR 2, and the per-frame means came out a quarter of the truth). */
async function ready(gl, list) {
  const end = performance.now() + 5000;
  while ( performance.now() < end && list.some((q) => !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) ) await wait(20);
}

/** Every weather object worth timing: [key, object, method] (GPU: render; CPU: tick). */
export function targets() {
  const out = [], d = W().display(), L = W().lensDisplay(), T = W().tornadoDisplay?.(), S = W().steamDisplay?.(), K = W().cloudDisplay?.();
  if ( d?.ground ) {
    out.push(["ground", d.ground], ["splash", d.splash], ["air", d.air], ["haze", d.haze]);
    for ( const [k, m] of Object.entries(d.parts ?? {}) ) out.push([`part.${k}`, m]);
    if ( d.groundCells ) out.push(["ground.cells", d.groundCells, "draw"], ["haze.cells", d.hazeCells, "draw"]);
  }
  if ( L?.slices ) {   // (the pass in bands, its two pre-passes)
    L.slices.forEach((m, i) => out.push([`lens.band${i}`, m]));
    L.dslices?.forEach((m, i) => out.push([`lens.disp${i}`, m]));   // (the refraction half of each band: one output per program)
    if ( L.runMesh ) out.push(["lens.pre1", L.runMesh], ["lens.pre2", L.beadMesh]);
    out.push(["lens.show", L.sprite]);
  }
  else if ( L?.pass ) out.push(["lens.pass", L.pass], ["lens.show", L.sprite]);
  if ( S?.root ) out.push(["steam", S.root]);
  if ( K?.body ) out.push(["clouds.tex", K, "draw"], ["clouds.shadow", K.shadow], ["clouds.rays", K.rays], ["clouds.body", K.body]);   // (tex: the field + light passes)
  for ( const v of T?.views?.values?.() ?? [] ) {
    for ( const k of ["curtain", "skirt", "back", "debB", "wallB", "column", "debF", "wallF", "front", "curtainF", "deck"] ) if ( v[k] ) out.push([`torn.art.${k}`, v[k]]);
    for ( const k of ["debB", "wallB", "debF", "wallF"] ) if ( v[k]?.march ) out.push([`torn.march.${k}`, v[k].march.mesh]);   // (the volumes' coarse ray march)
    out.push(["torn.ground", v.ground], ["torn.marks", v.marks], ["torn.show", v.show]);
    if ( v.groundCells ) out.push(["torn.ground.cells", v.groundCells, "draw"]);
  }
  return out;
}
const tickers = () => [["cpu.weather", W().display()], ["cpu.lens", W().lensDisplay()], ["cpu.tornado", W().tornadoDisplay?.()], ["cpu.steam", W().steamDisplay?.()], ["cpu.clouds", W().cloudDisplay?.()]].filter((x) => x[1]);

/** Step the shared clock n frames at 60 Hz from `t0` (ms, default now), rendering each; `each(i)` after each render. */
export function run(n, { t0 = Date.now(), each = null } = {}) {
  const T = canvas.app.ticker, R = canvas.app.renderer, gl = R.gl, realNow = Date.now;
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  // (the SHARED clock = vt exactly: this client's skew taken off Date.now and held, so a frame at a time is the same after a reload)
  const sk = CLK?.clockInfo().skew ?? 0; CLK?.holdClock(true);
  let vt = t0, pt = performance.now(); Date.now = () => Math.floor(vt) - sk;
  try {
    for ( let i = 0; i < n; i++ ) { vt = t0 + i * 1000 / 60; pt += 1000 / 60; T.update(pt); each?.(i); gl.finish(); }   // (the ticker renders the stage)
  } finally { Date.now = realNow; CLK?.holdClock(false); T.maxFPS = mf; if ( st ) T.start(); }
}
let CLK = null;
import("../scripts/shared-clock.mjs").then((m) => { CLK = m; });

/** Per-pass GPU and per-ticker CPU (see the header). */
export async function passes({ n = 120, warm = 20, t0 = Date.now() } = {}) {
  const R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  run(warm, { t0 });   // (passes made, textures uploaded, the lens target sized)
  const tg = targets(), qs = new Map(), cpu = new Map(), undo = [];
  let on = false;
  for ( const [key, o, m = "render"] of tg ) {
    const orig = o[m], cache = m !== "render"; qs.set(key, []);
    o[m] = function(...a) {
      const r = canvas.app.renderer;
      if ( !on || !ext || (!cache && (this.visible === false || !this.renderable)) ) return orig.apply(this, a);
      r.batch.flush(); const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      try { return orig.apply(this, a); } finally { r.batch.flush(); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.get(key).push(q); }
    };
    undo.push(() => { delete o[m]; if ( o[m] !== orig ) o[m] = orig; });
  }
  for ( const [key, o] of tickers() ) {
    const orig = o.tick; cpu.set(key, []);
    o.tick = function(...a) { const t = performance.now(); try { return orig.apply(this, a); } finally { if ( on ) cpu.get(key).push(performance.now() - t); } };
    undo.push(() => { delete o.tick; });
  }
  try { on = true; run(n, { t0: t0 + warm * 1000 / 60 }); } finally { on = false; undo.forEach((f) => f()); }
  await ready(gl, [...qs.values()].flat());   // (every query: one still pending would be dropped and the mean come out too low)
  const out = {};
  for ( const [key, list] of qs ) {
    if ( !list.length ) continue;
    const ms = [];
    for ( const q of list ) { if ( gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ) ms.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
    out[key] = { f: r3(ms.reduce((a, b) => a + b, 0) / n), c: r3(med(ms)), k: r3(list.length / n) };
  }
  for ( const [key, a] of cpu ) out[key] = { f: r3(a.reduce((x, y) => x + y, 0) / n), m: r3(med(a)) };   // (mean per frame; median per frame)
  return out;
}

/** The whole frame (GPU timer around the render, CPU of the ticker step), median of n, on the stepped shared clock. */
export async function frame({ n = 120, warm = 20, t0 = Date.now() } = {}) {
  const R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), T = canvas.app.ticker, realNow = Date.now;
  run(warm, { t0 });
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const qs = [], cpu = []; let vt = t0 + warm * 1000 / 60, pt = performance.now(); Date.now = () => Math.floor(vt);
  try {
    for ( let i = 0; i < n; i++ ) {
      vt += 1000 / 60; pt += 1000 / 60;
      const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const a = performance.now(); T.update(pt); cpu.push(performance.now() - a);   // (the ticker: every listener, then the render)
      gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); gl.finish();
    }
  } finally { Date.now = realNow; T.maxFPS = mf; if ( st ) T.start(); }
  await ready(gl, qs);
  const g = []; for ( const q of qs ) { if ( gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ) g.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
  return { gpu: r3(med(g)), cpu: r3(med(cpu)) };
}

/**
 * The weather for a case: effect (a preset, "tornado", or "off"), level 1-3, lens "auto"/false, started at shared ms `t` (default now:
 * pass a fixed `t` to get the same weather after a reload). A tornado stands at `at` (scene px; default the view centre, 2 squares down).
 * "<effect>+clouds" adds the cloud layer at the same level (`clouds`: { mode, rays } its look, default as the scene has it).
 */
export async function setCase(effect, level, { lens = "auto", at = null, t = null, wind = { dir: 20, str: 0.45, gust: 0.7 }, path = null, clouds = null } = {}) {
  const now = t ?? Date.now(), M = W().model, P0 = W().params();
  const withClouds = String(effect).endsWith("+clouds"); effect = String(effect).replace(/\+clouds$/, "");
  const preset = effect === "off" || effect === "tornado" ? "clear" : effect, fx = M.PRESETS[preset] ?? {}, sl = level - 1;
  const key = M.cleanKey({ t: now - 60000, dur: 0, preset, level, i: 0.5, wind });
  if ( withClouds ) key.fx.clouds = { l: level, i: 0.5 };
  const base = { t: now - 60000, fx: {}, wind, wet: "rain" in fx ? M.wetCeil(sl) : 0, cover: "snow" in fx ? M.coverCeil(sl) : 0 };
  const lon = preset !== "clear" && lens !== false;
  // a tornado written with the rest (a fixed id: its seed is the hash of its id, so the same tornado after a reload)
  let tornadoes = [];
  if ( effect === "tornado" ) {
    const TM = await import("../scripts/weather/tornado-model.mjs"), c = at ?? [canvas.stage.pivot.x, canvas.stage.pivot.y + 80], t0 = now - 20000;
    tornadoes = [TM.cleanTornado({ id: "abTornado1", path: path ?? [c], t0, level, lv0: level, lvT: t0, speed: 0.001, size: TM.DEFAULTS.size, wander: 0, end: "stop" })];
  }
  const cl = P0.clouds ? { clouds: { ...P0.clouds, ...(clouds ?? {}), modeT: 0, raysT: 0 } } : {};
  await canvas.scene.update({ "flags.moinen-maps.weather": { ...P0, keys: [key], base, tornadoes, lens: { ...P0.lens, on: lon, level: lon ? lens : P0.lens.level }, ...cl } });
  await wait(1200); W().refresh();
  await wait(600);
}

/** Rows over cases [[effect, level]], zooms and DPRs (the view centred at `c`). DPR switched by perf-harness setDPR. */
export async function matrix(cases, { zooms = [1, 3], dprs = [1, 2], c = null, n = 120 } = {}) {
  const H = await import("./perf-harness.mjs"), rows = [];
  const ctr = c ?? [canvas.dimensions.sceneRect.x + canvas.dimensions.sceneRect.width / 2, canvas.dimensions.sceneRect.y + canvas.dimensions.sceneRect.height / 2];
  const dpr0 = canvas.app.renderer.resolution;
  try {
    for ( const dpr of dprs ) {
      await H.setDPR(dpr);
      for ( const z of zooms ) {
        canvas.pan({ x: ctr[0], y: ctr[1], scale: z }); await wait(300);
        for ( const [e, l] of cases ) {
          await setCase(e, l);
          const p = await passes({ n }), f = await frame({ n });
          rows.push({ case: `${e} L${l} z${z} dpr${dpr}`, frame: f, passes: p });
        }
      }
    }
  } finally { await H.setDPR(dpr0); }
  return rows;
}

/** Frames (RGBA of the whole canvas) at fixed shared times (ms): the A/B pixel check across builds. */
export function shots(times) {
  const R = canvas.app.renderer, gl = R.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, out = [];
  for ( const t of times ) {
    run(6, { t0: t - 5 * 1000 / 60 });   // (5 frames before: tickers that step at 12 Hz are on the same step)
    const b = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); out.push(b);
  }
  return out;
}
/** Two shots: pixels that differ at all, by more than 8 in a channel, the largest channel difference, mean |d| per pixel. */
export function diff(a, b) {
  let px = 0, big = 0, m = 0, s = 0;
  for ( let i = 0; i < a.length; i += 4 ) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if ( d ) px++; if ( d > 8 ) big++; if ( d > m ) m = d; s += d;
  }
  return { px, big, max: m, mean: +(s / (a.length / 4)).toFixed(4) };
}
/** Keep shots on the server (mm-rec/<name>.bin) and read them back after a reload (the A/B across builds). */
export async function save(name, list) {
  const FP = foundry.applications.apps.FilePicker.implementation;
  return (await FP.upload("data", "mm-rec", new File(list, `${name}.bin`, { type: "application/octet-stream" }), {}, { notify: false }))?.path;
}
export async function load(name, n) {
  const b = new Uint8Array(await (await fetch(`/mm-rec/${name}.bin?v=${Date.now()}`)).arrayBuffer()), L = b.length / n;
  return Array.from({ length: n }, (_, i) => b.subarray(i * L, (i + 1) * L));
}
/** A hash of a shot (to compare across page reloads without keeping the pixels): FNV-1a over the bytes. */
export function hash(b) { let h = 0x811c9dc5; for ( let i = 0; i < b.length; i++ ) { h ^= b[i]; h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }

/**
 * One build's side of the A/B (run once per page load, the builds swapped on disk between loads): per view (DPR, zoom) and case, the
 * frame cost (GPU / CPU median), the per-pass costs, and hashes of frames at fixed shared times (every case starts at the fixed `T0`,
 * so frames of the same time compare across loads). Kept as mm-rec/ab-<label>.json. Start it, then poll `window.__ab`.
 */
export const AB_CASES = [["rain", 1], ["rain", 3], ["snow", 3], ["sand", 1], ["sand", 3], ["dust", 3], ["embers", 3], ["wind", 1], ["wind", 3], ["tornado", 1], ["tornado", 3]];
export const AB_VIEWS = [[1, 1], [1, 3], [2, 1], [2, 3]];
export function abStart(label, T0, { cases = AB_CASES, views = AB_VIEWS, n = 120, c = [768, 512], save: save_ = (e) => e === "tornado", timing = true } = {}) {
  window.__ab = { label, done: false, i: 0 };
  (async () => {
    const H = await import("./perf-harness.mjs"), rows = [], dpr0 = canvas.app.renderer.resolution;
    try {
      for ( const [dpr, z] of views ) {
        if ( canvas.app.renderer.resolution !== dpr ) await H.setDPR(dpr);
        canvas.pan({ x: c[0], y: c[1], scale: z }); await wait(300);
        for ( const [e, l] of cases ) {
          await setCase(e, l, { t: T0, at: [c[0], c[1] + 48] });
          const raw = shots([T0 + 5000, T0 + 5900]), sh = raw.map(hash), gq = W().guard?.().q ?? null;   // (the frame guard's level at the shots: 1 = full)
          if ( save_?.(e, dpr, z) ) await save(`ab-${label}-${dpr}-${z}-${e}${l}`, [raw[0]]);
          // in this build: the cell caches off (twice: the a/a control) vs on, pixel diffs (a build without them: all zero)
          let cells = null;
          if ( globalThis.CONFIG?.moinenMaps ) {
            const was = CONFIG.moinenMaps.weatherCells;
            CONFIG.moinenMaps.weatherCells = false; const x = shots([T0 + 5000]), x2 = shots([T0 + 5000]);
            CONFIG.moinenMaps.weatherCells = was; const y = shots([T0 + 5000]);
            cells = { aa: diff(x[0], x2[0]), ab: diff(x[0], y[0]) };
          }
          if ( !timing ) { rows.push({ dpr, z, e, l, sh, gq, cells, scr: [canvas.app.renderer.width, canvas.app.renderer.height] }); window.__ab.i = rows.length; continue; }
          const p = await passes({ n, t0: T0 + 6000 }), f = await frame({ n, t0: T0 + 9000 });
          // in this build, interleaved in the same page: the caches off / on / off / on (per-pass GPU; the a/a = off vs off)
          let inter = null;
          const has = !!W().display()?.groundCells || [...(W().tornadoDisplay?.()?.views?.values?.() ?? [])].some((v) => v.groundCells);
          if ( has ) {
            inter = [];
            const was = CONFIG.moinenMaps.weatherCells;
            for ( const fl of [false, was, false, was] ) { CONFIG.moinenMaps.weatherCells = fl; inter.push(await passes({ n, t0: T0 + 6000 })); }
            CONFIG.moinenMaps.weatherCells = was;
          }
          rows.push({ dpr, z, e, l, frame: f, passes: p, sh, gq, cells, inter });
          window.__ab.i = rows.length;
        }
      }
      if ( canvas.app.renderer.resolution !== dpr0 ) await H.setDPR(dpr0);
      await setCase("off", 1);
      const FP = foundry.applications.apps.FilePicker.implementation;
      await FP.upload("data", "mm-rec", new File([JSON.stringify(rows)], `ab-${label}.json`, { type: "application/json" }), {}, { notify: false });
      window.__ab = { label, done: true, rows };
    } catch ( err ) { window.__ab = { label, done: true, err: String(err?.stack ?? err), rows }; }
  })();
  return "started";
}

/**
 * WALL-CLOCK FRAME (no timer queries): the ticker step and its render with gl.finish after it, on the stepped shared clock; median ms
 * per frame, CPU and GPU in series. Only with the Browser pane SHOWN: in a hidden pane gl.finish waits for frames that do not come
 * (~70 ms), and after a few minutes hidden the timer queries never become available either (re-load, measure first).
 */
export function frameWall({ n = 90, warm = 10, t0 = Date.now() } = {}) {
  const gl = canvas.app.renderer.gl, ms = [];
  run(warm, { t0 });
  run(n, { t0: t0 + warm * 1000 / 60, each: () => {} });
  const T = canvas.app.ticker, realNow = Date.now, mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const sk = CLK?.clockInfo().skew ?? 0; CLK?.holdClock(true);
  let vt = t0, pt = performance.now(); Date.now = () => Math.floor(vt) - sk;
  try {
    for ( let i = 0; i < n; i++ ) { vt = t0 + i * 1000 / 60; pt += 1000 / 60; gl.finish(); const a = performance.now(); T.update(pt); gl.finish(); ms.push(performance.now() - a); }
  } finally { Date.now = realNow; CLK?.holdClock(false); T.maxFPS = mf; if ( st ) T.start(); }
  return r3(med(ms));
}
/** frameWall with the cell caches off / on, `rounds` times interleaved: [[off, on], ...]. */
export function frameWallCells({ rounds = 3, ...o } = {}) {
  const was = CONFIG.moinenMaps.weatherCells, out = [];
  try { for ( let i = 0; i < rounds; i++ ) { const p = []; for ( const fl of [false, was] ) { CONFIG.moinenMaps.weatherCells = fl; p.push(frameWall(o)); } out.push(p); } }
  finally { CONFIG.moinenMaps.weatherCells = was; }
  return out;
}
