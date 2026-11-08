// Weather: cost per effect and level on a lane GM page (fronted tab).   const P = await import("/modules/moinen-maps/dev/weather-perf.mjs")
// `table(cases)`: per case (preset, level, lens) the frame cost (`frame`: CPU ms of the ticker step, GPU ms of the render by timer query, draw calls) and the weather's
// own numbers (instances, tick ms; the lens pass GPU ms measured alone, forced). `idle()`: I.rest with the weather off and on.
const I = () => import("/modules/moinen-maps/dev/idle-bench.mjs");
const R = () => import("/modules/moinen-maps/dev/weather-rec.mjs");
const W = () => game.modules.get("moinen-maps").api.weather;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (x) => Math.round(x * 100) / 100;

/** GPU ms of the lens pass alone (forced `n` times), median. */
export async function lensPass(n = 30) {
  const L = W().lensDisplay(); if ( !L?.pass ) return null;
  const gl = canvas.app.renderer.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), qs = [], cpu = [];
  for ( let i = 0; i < n; i++ ) {
    const q = ext ? gl.createQuery() : null; if ( q ) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    const t = performance.now(); L.render(Math.floor(((Date.now() / 1000) % 3600) * 12) / 12 + i / 12, canvas.stage.worldTransform); cpu.push(performance.now() - t);
    if ( q ) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
    gl.finish();
  }
  await wait(200);
  const gpu = [];
  for ( const q of qs ) { if ( gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  return { gpu: med(gpu) == null ? null : r2(med(gpu)), cpu: r2(med(cpu)), lens: [L.stats.lw, L.stats.lh, L.stats.lpx] };
}

/**
 * The frame on a fake 60 Hz clock: the ticker stepped (listeners incl. the weather's tick and lens pass when due) and the stage
 * rendered, GPU time by timer query around the render, CPU of the update, draw calls per render. Median of `n`.
 */
export async function frame(n = 120) {
  const R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), T = canvas.app.ticker;
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const cpu = [], qs = []; let draws = 0, on = false, t = performance.now();
  const od = gl.drawElements, oa = gl.drawArrays, odi = gl.drawElementsInstanced;
  gl.drawElements = function(...a) { if ( on ) draws++; return od.apply(gl, a); };
  gl.drawArrays = function(...a) { if ( on ) draws++; return oa.apply(gl, a); };
  gl.drawElementsInstanced = function(...a) { if ( on ) draws++; return odi.apply(gl, a); };
  try {
    for ( let i = 0; i < 10; i++ ) { t += 16.67; T.update(t); }
    draws = 0;
    for ( let i = 0; i < n; i++ ) {
      t += 16.67;
      const a = performance.now(); T.update(t); cpu.push(performance.now() - a);
      const q = ext ? gl.createQuery() : null; if ( q ) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      on = true; R.render(canvas.app.stage); on = false;
      if ( q ) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
      gl.finish();
    }
  } finally { gl.drawElements = od; gl.drawArrays = oa; gl.drawElementsInstanced = odi; T.maxFPS = mf; if ( st ) T.start(); }
  await wait(200);
  const gpu = [];
  for ( const q of qs ) { if ( gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  return { cpu: r2(med(cpu)), gpu: gpu.length ? r2(med(gpu)) : null, draws: Math.round(draws / n) };
}

/** One row: weather (preset, level, lens) then the frame cost. preset null = weather cleared (and dry). */
export async function row(preset, level = 2, lens = false, n = 120) {
  const rec = await R();
  await W().lens({ heat: preset === "embers" && !!lens });
  await rec.set(preset ?? "clear", level, { lens, wet: preset ? null : 0, cover: preset ? null : 0 });
  await wait(800);
  const p = await frame(n);
  const st = W().status();
  return { case: `${preset ?? "off"} L${level} lens ${lens}`, cpu: p.cpu, gpu: p.gpu, draws: p.draws, instances: (st.instances ?? 0) + (st.parts ?? 0), tickMs: r2(st.tickMs ?? 0),
    lensPass: lens ? await lensPass() : null };
}

export async function table(cases = [[null], ["rain", 1], ["rain", 2], ["rain", 3], ["rain", 1, "auto"], ["rain", 2, "auto"], ["rain", 3, "auto"]], n = 120) {
  const out = [];
  for ( const c of cases ) out.push(await row(c[0], c[1] ?? 2, c[2] ?? false, n));
  return out;
}

/** I.rest: the per-listener ms per frame at rest, weather off then on (preset, level, lens). */
export async function idle(preset = "rain", level = 2, lens = "auto") {
  const i = await I(), rec = await R();
  await rec.set("clear", 1, { lens: false, wet: 0 }); await wait(500);
  const off = await i.rest({ frames: 300 });
  await rec.set(preset, level, { lens }); await wait(1000);
  const on = await i.rest({ frames: 300 });
  const pick = (r) => ({ total: r2(r.total.med), mean: r2(r.total.mean), top: r.listeners.slice(0, 6).map((l) => `${l.nm}: ${r2(l.mean)}`) });
  return { off: pick(off), on: pick(on) };
}
