// THE RAIN'S LIGHTNING, its cost (lane GM page, a ZZ- scene with rain):   const B = await import("/modules/moinen-maps/dev/weather-storm-cost.mjs")
//   await B.run({ zooms, weaks, n })   rows { case, zoom, weak, gpu {med, p95, max}, cpu {med, p95, max}, long, lightMax, litFrames, dpr }
// Cases, each over n frames of a virtual clock stepped at 60 fps (Date.now faked; the shared clock follows it), every frame rendered and
// timed (GPU: a timer query per frame; CPU: the ticker step, as stack-bench / lightning-cost):
//   rain     the lightning off (its display gone)
//   gloom    the lightning on between flashes (only the storm's gloom pass draws; no ticker of its own)
//   strike   the lightning on over a CLOSE STRIKE WITH A BOLT, from 900 ms before it (the sky flickers, the leader) through its restrikes
//            and afterglow, the view on the strike point
// weak: the storm's own passes (gloom, light, night light, bolt and its emission) drawn `weak` times (the weak-GPU emulation of
// boom-cost / lightning-cost). The frame guard is held off while measuring. Leaves the lightning as it found it.
const MOD = "moinen-maps";
const r3 = (x) => Math.round(x * 1000) / 1000;
const qt = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? r3(s[Math.min(s.length - 1, Math.floor(s.length * f))]) : 0; };
const tick_ = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const wait = async (ms) => { const end = performance.now() + ms; while ( performance.now() < end ) { await tick_(); await new Promise((r) => setTimeout(r, 4)); } };
const W = () => game.modules.get(MOD).api.weather;

function stepped(from, n) {
  const R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), T = canvas.app.ticker;
  const qs = [], cpu = [], lit = [], mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const realNow = Date.now; let vt = from, pt = performance.now(); Date.now = () => Math.floor(vt);
  try {
    for ( let i = 0; i < n; i++ ) {
      vt += 1000 / 60; pt += 1000 / 60;
      const q = ext ? gl.createQuery() : null; if ( q ) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const a = performance.now(); T.update(pt); cpu.push(performance.now() - a); lit.push(W().stormDisplay()?.stats.light ?? 0);
      if ( q ) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
    }
    gl.finish();
  } finally { Date.now = realNow; T.maxFPS = mf; if ( st ) T.start(); }
  return { qs, cpu, gl, lit };
}
async function result(res) {
  const end = performance.now() + 5000;
  while ( performance.now() < end && res.qs.some((q) => !res.gl.getQueryParameter(q, res.gl.QUERY_RESULT_AVAILABLE)) ) await wait(20);
  const gpu = [];
  for ( const q of res.qs ) { if ( res.gl.getQueryParameter(q, res.gl.QUERY_RESULT_AVAILABLE) ) gpu.push(res.gl.getQueryParameter(q, res.gl.QUERY_RESULT) / 1e6); res.gl.deleteQuery(q); }
  const tot = res.cpu.map((c, i) => c + (gpu[i] ?? 0));
  return { gpu: { med: qt(gpu, 0.5), p95: qt(gpu, 0.95), max: qt(gpu, 1) }, cpu: { med: qt(res.cpu, 0.5), p95: qt(res.cpu, 0.95), max: qt(res.cpu, 1) },
    long: tot.filter((x) => x > 16.7).length, frames: tot.length, lightMax: qt(res.lit, 1), litFrames: res.lit.filter((x) => x > 0.02).length };
}
/** The storm's passes drawn n times (undo returned). */
function weak(n) {
  const d = W().stormDisplay(); if ( n <= 1 || !d ) return () => {};
  const undo = [];
  for ( const o of [d.gloom, d.light, d.root, d.glow] ) {
    if ( !o ) continue;
    const orig = o.render;
    o.render = function(...a) { for ( let i = 0; i < n; i++ ) orig.apply(this, a); };
    undo.push(() => { o.render = orig; });
  }
  return () => undo.forEach((f) => f());
}

export async function run({ zooms = [1, 3], weaks = [1, 2], n = 150 } = {}) {
  if ( !canvas.scene?.name?.startsWith("ZZ-") ) throw new Error("run on a ZZ- scene");
  const { sharedNow } = await import("../scripts/shared-clock.mjs");
  CONFIG.moinenMaps ??= {};
  const g0 = CONFIG.moinenMaps.weatherGuard, was = W().lightning(), rows = [], c = [canvas.dimensions.sceneRect.x + canvas.dimensions.sceneRect.width / 2, canvas.dimensions.sceneRect.y + canvas.dimensions.sceneRect.height / 2];
  if ( !(W().state().fx.rain?.p > 0.9) ) { W().set("rain", { level: 3, over: 0 }); await wait(2000); }
  CONFIG.moinenMaps.weatherGuard = false;
  const dpr = canvas.app.renderer.resolution, dark = canvas.environment?.darknessLevel ?? 0;
  try {
    // RAIN: the lightning off and its display gone
    W().lightning({ on: false });
    for ( let i = 0; i < 60 && W().stormDisplay(); i++ ) await wait(250);
    for ( const zoom of zooms ) {
      canvas.pan({ x: c[0], y: c[1], scale: zoom }); await wait(600);
      rows.push({ case: "rain", zoom, weak: 1, ...(await result(stepped(Date.now(), n))), dpr, dark });
    }
    // the lightning on, close strikes with bolts; the gloom faded in
    W().lightning({ on: true, rate: 30, near: 1, power: 1, bolts: true });
    await wait(7500);
    const SM = W().stormModel, P = W().params(), rp = (t) => W().state(t).fx.rain?.p ?? 0;
    for ( const zoom of zooms ) for ( const wk of weaks ) {
      // GLOOM: a stretch with no flash in it (searched in the schedule)
      const now = sharedNow(), skew = now - Date.now();
      let t = now + 500;
      for ( let k = 0; k < 400; k++, t += 250 ) if ( !SM.flashes(P.storm, P.seed, t - 100, t + n * 1000 / 60 + 100, rp).length ) break;
      canvas.pan({ x: c[0], y: c[1], scale: zoom }); await wait(500);
      let u = weak(wk);
      try { rows.push({ case: "gloom", zoom, weak: wk, ...(await result(stepped(t - skew, n))), dpr, dark }); } finally { u(); }
      // STRIKE: the next close strike with a bolt, its bolt built before the clock reaches it
      const ev = SM.flashes(P.storm, P.seed, sharedNow() + 4000, sharedNow() + 120000, rp).find((e) => e.kind === "close" && e.bolt);
      if ( !ev ) { rows.push({ case: "strike", zoom, weak: wk, error: "no close strike in 2 min" }); continue; }
      const p = SM.placeOf(ev, canvas.dimensions.sceneRect, canvas.grid.size);
      canvas.pan({ x: p.x, y: p.y - 4 * canvas.grid.size / zoom, scale: zoom }); await wait(500);
      const d = W().stormDisplay();
      d.update(P.storm, P.seed, rp, W().geo(), W().view(), W().display(), W().cloudDisplay(), ev.t - 1500);
      for ( let i = 0; i < 40 && !d.bolts.size; i++ ) await wait(50);
      const built = d.bolts.size;
      u = weak(wk);
      try { rows.push({ case: "strike", zoom, weak: wk, ...(await result(stepped(ev.t - 900 - skew, n))), bolt: built, lv: ev.lv, dpr, dark }); } finally { u(); }
    }
  } finally {
    CONFIG.moinenMaps.weatherGuard = g0;
    W().lightning(was);
  }
  return rows;
}
