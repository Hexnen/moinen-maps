// F1 FIRE LEVEL COST (lane GM page, a ZZ- test scene):   const C = await import("/modules/moinen-maps/dev/fire-slider-cost.mjs")
//   await C.measure({ strokes, x, y, zoom, weak, frames, ramp })   places `strokes` (at rest), views (x, y) at `zoom`, then steps a
//        virtual clock (60 fps, the layer's 12 fps art frames included) and measures each frame: CPU (ticker step + render, gl.finish)
//        and GPU (EXT_disjoint_timer_query around the render); `weak` = every fire art pass (scissorPass: ART_F + ART_S over its cells) drawn that many times (a weak-GPU
//        emulation: the art passes are the fire's GPU cost); `ramp` = [[atMs, id, level, over]] level changes during the frames
//        (setLevels on the virtual clock). Returns { cpu, gpu, cpu95, gpu95 } medians / p95 (ms) of every frame, cpuArt / gpuArt the same on the art frames (12 fps), artCpu the art passes' own CPU time.
//   await C.matrix({ cases, views, weaks, frames })   rows of measure() for every case x view x weak.
// Same procedure on main (no F1) and on the branch: the whole-level rows compare like for like.
const MOD = "moinen-maps";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const api = () => game.modules.get(MOD).api.fire;
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const p95 = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : null; };
const r2 = (v) => (v === null ? null : Math.round(v * 100) / 100);

export async function put(strokes) {
  if ( !canvas.scene.name.startsWith("ZZ-") ) throw new Error(`fire-slider-cost: a test scene only (ZZ-...), not ${canvas.scene.name}`);
  const keys = Object.keys(canvas.scene.flags[MOD]?.fireStrokes ?? {}), upd = {};
  for ( const k of keys ) upd[`flags.${MOD}.fireStrokes.-=${k}`] = null;
  if ( keys.length ) await canvas.scene.update(upd);
  await wait(500);
  const add = {}; for ( const s of strokes ) add[`flags.${MOD}.fireStrokes.${s.id}`] = s;
  await canvas.scene.update(add);
  for ( let i = 0; i < 300 && (api().status().pending ?? 0) > 0; i++ ) await wait(50);
  await wait(1500);
}

async function weakArt(n) {
  if ( n <= 1 ) return () => {};
  const A = await import(`/modules/${MOD}/scripts/fire/art.mjs`), P = A.FireArt.prototype, o = P.scissorPass;
  P.scissorPass = function(...a) { let r; for ( let i = 0; i < n; i++ ) r = o.apply(this, a); return r; };
  return () => { P.scissorPass = o; };
}

export async function measure({ strokes = null, x = 768, y = 512, zoom = 1, weak = 1, frames = 180, ramp = [], base = 1794400000001 } = {}) {
  if ( strokes ) await put(strokes);
  canvas.pan({ x, y, scale: zoom }); await wait(800);
  const R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), T = canvas.app.ticker;
  const FM = await import(`/modules/${MOD}/scripts/fire/fire.mjs`), CK = await import(`/modules/${MOD}/scripts/shared-clock.mjs`);
  const A = await import(`/modules/${MOD}/scripts/fire/art.mjs`), P = A.FireArt.prototype, oArt = P.scissorPass;
  let artMs = 0; P.scissorPass = function(...a) { const t = performance.now(); const r = oArt.apply(this, a); artMs += performance.now() - t; return r; };
  const unweak = await weakArt(weak);
  const real = Date.now, mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop(); CK.holdClock?.(true);
  let vt = base; Date.now = () => Math.floor(vt);
  const cpu = [], gpu = [], qs = [], art = [], fired = new Set(), perf0 = performance.now();
  try {
    for ( let i = 0; i < frames + 20; i++ ) {
      vt = base + i * 1000 / 60;
      for ( const [at, id, level, over] of ramp ) if ( i * 1000 / 60 >= at && !fired.has(at) ) { fired.add(at); api().setLevels(id, { level, ...(over !== undefined ? { over } : {}) }); }
      for ( let k = 0; k < 200 && ((api().status().pending ?? 0) - (api().status().adopting ?? 0)) > 0; k++ ) await wait(5);
      FM.draw();
      await wait(2);
      artMs = 0;
      const q = ext && i >= 20 ? gl.createQuery() : null;
      const t = performance.now();
      if ( q ) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      T.update(perf0 + i * 1000 / 60); R.render(canvas.app.stage);
      if ( q ) gl.endQuery(ext.TIME_ELAPSED_EXT);
      gl.finish();
      if ( i >= 20 ) { cpu.push(performance.now() - t); art.push(artMs); qs.push(q); }
    }
  } finally { Date.now = real; T.maxFPS = mf; if ( st ) T.start(); CK.holdClock?.(false); P.scissorPass = oArt; unweak(); }
  await wait(200);
  // (per frame; the art passes run on the 12 fps art frames only, so those frames are also reported apart: cpuArt / gpuArt)
  const g = qs.map((q) => { if ( !q ) return null; const v = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ? gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 : null; gl.deleteQuery(q); return v; });
  for ( const v of g ) if ( v !== null ) gpu.push(v);
  const artF = art.filter((v) => v > 0), on = art.map((v) => v > 0);
  const cpuArt = cpu.filter((_, i) => on[i]), gpuArt = g.filter((v, i) => on[i] && v !== null);
  return { zoom, weak, frames: cpu.length, cpu: r2(med(cpu)), cpu95: r2(p95(cpu)), gpu: r2(med(gpu)), gpu95: r2(p95(gpu)), gpuN: gpu.length, artCpu: r2(med(artF)), artFrames: artF.length, cpuArt: r2(med(cpuArt)), cpuArt95: r2(p95(cpuArt)), gpuArt: r2(med(gpuArt)), gpuArt95: r2(p95(gpuArt)) };
}

/** Rows of measure() for every case ({ name, strokes, x, y, ramp }) x view ({ zoom, x?, y? }) x weak. */
export async function matrix({ cases, views = [{ zoom: 1 }, { zoom: 3 }], weaks = [1, 2], frames = 180 } = {}) {
  const rows = [];
  for ( const c of cases ) {
    await put(c.strokes);
    for ( const v of views ) for ( const w of weaks ) {
      if ( c.ramp ) await put(c.strokes);                              // (a ramp case starts from its strokes at rest every time)
      const r = await measure({ x: v.x ?? c.x, y: v.y ?? c.y, zoom: v.zoom, weak: w, frames, ramp: c.ramp ?? [] });
      rows.push({ case: c.name, ...r });
    }
  }
  return rows;
}
