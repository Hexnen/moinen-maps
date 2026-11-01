// Browser-side perf harness for the destruction layer (paste-free):   const H = await import("/modules/moinen-maps/dev/perf-harness.mjs")
//   H.perf(n, label)   steps the ticker by hand n frames (works with a hidden pane: rAF 0 Hz), returns median CPU (ticker + gl.finish),
//                      GPU (EXT_disjoint_timer_query_webgl2), draw calls and framebuffer binds per frame, the layer's own tick + cache ms
//   H.cmp()            the destruction layer drawn with the cache vs live at the current view: mean |dRGB| per pixel, max, % pixels > 60
//   H.fit(scale)       centre the scene at a zoom (default: fit the window)
const D = () => game.modules.get("moinen-maps").api.destruction.display();
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[s.length >> 1].toFixed(2) : null; };

export async function perf(n = 60, label = "") {
  const R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), T = canvas.app.ticker;
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();          // maxFPS skips fast frames when stepped by hand
  const cpu = [], gpu = [], qs = [], own = [];
  let draws = 0, binds = 0;
  const od = gl.drawElements, oa = gl.drawArrays, ob = gl.bindFramebuffer;
  gl.drawElements = function(...a) { draws++; return od.apply(gl, a); };
  gl.drawArrays = function(...a) { draws++; return oa.apply(gl, a); };
  gl.bindFramebuffer = function(...a) { binds++; return ob.apply(gl, a); };
  try {
    for ( let i = 0; i < 5; i++ ) T.update(performance.now());
    draws = binds = 0;
    for ( let i = 0; i < n; i++ ) {
      const t = performance.now(); let q = null;
      if ( ext ) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      T.update(performance.now());
      if ( ext ) gl.endQuery(ext.TIME_ELAPSED_EXT);
      gl.finish(); cpu.push(performance.now() - t); if ( q ) qs.push(q);
      own.push((D()?.stats.frameMs ?? 0));
    }
  } finally {
    gl.drawElements = od; gl.drawArrays = oa; gl.bindFramebuffer = ob;
    T.maxFPS = mf; if ( st ) T.start();
  }
  await new Promise((r) => setTimeout(r, 200));
  for ( const q of qs ) { if ( gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
  return { label, cpu: med(cpu), gpu: med(gpu), draws: Math.round(draws / n), binds: Math.round(binds / n), layerMs: med(own),
    cache: { ...D()?.cache?.stats }, heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576) };
}

export function grab() {
  const R = canvas.app.renderer, w = R.screen.width, h = R.screen.height;
  const rt = PIXI.RenderTexture.create({ width: w, height: h });
  R.render(D().objs, { renderTexture: rt, transform: canvas.primary.worldTransform.clone(), clear: true });
  const px = R.extract.pixels(rt); rt.destroy(true); return px;
}

export function cmp() {
  const T = canvas.app.ticker; CONFIG.moinenMaps ??= {};
  const was = !!CONFIG.moinenMaps.noDestructionCache, mf = T.maxFPS; T.maxFPS = 0;   // else a quick second update is skipped
  // the flooded holes' water loops with the clock: freeze it for the two grabs
  const waters = D().cache?.units?.().filter((u) => u.water).map((u) => u.water) ?? [];
  CONFIG.moinenMaps.noDestructionCache = false; T.update(performance.now()); T.update(performance.now());
  const tex = waters.map((w) => w.texture);
  const a = grab(); const mode = D().cache?.stats.mode;
  CONFIG.moinenMaps.noDestructionCache = true; T.update(performance.now());
  waters.forEach((w, i) => { w.texture = tex[i]; });
  const b = grab();
  CONFIG.moinenMaps.noDestructionCache = was; T.update(performance.now()); T.maxFPS = mf;
  let sum = 0, max = 0, bad = 0; const n = a.length / 4;
  for ( let i = 0; i < a.length; i += 4 ) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    sum += d; if ( d > max ) max = d; if ( d > 60 ) bad++;
  }
  return { mode, zoom: +canvas.stage.scale.x.toFixed(3), mean: +(sum / n).toFixed(2), max, badPct: +(bad / n * 100).toFixed(3) };
}

export function fit(scale) {
  const r = canvas.dimensions.sceneRect;
  const s = scale ?? Math.min(innerWidth / r.width, innerHeight / r.height);
  canvas.pan({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), scale: s });
  return s;
}

/** Wait until the layer is loaded and settled. */
export async function settled(ms = 40000) {
  const end = performance.now() + ms;
  while ( performance.now() < end ) {
    const st = game.modules.get("moinen-maps")?.api?.destruction?.status?.();
    if ( canvas.ready && st && !st.baking && st.areas?.length && D()?.stats.entries !== undefined ) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Step the ticker by hand n frames (a hidden pane has no rAF). */
export function step(n = 1) {
  const T = canvas.app.ticker, mf = T.maxFPS; T.maxFPS = 0;
  try { for ( let i = 0; i < n; i++ ) T.update(performance.now()); } finally { T.maxFPS = mf; }
}

/** After a reload: wait for the layer, make every shard, let the flooded holes load. */
export async function boot() {
  await settled(40000); step(400);
  await new Promise((r) => setTimeout(r, 4000)); step(30);
  return { ...D()?.cache?.stats };
}

/**
 * A timeline: run `fn` (e.g. a Detonate), then step frames for `ms` of real time; per frame CPU (ticker + gl.finish), GPU (timer
 * query), the layer's own tick, the cache mode, animating areas and particles. Returns { fnMs, rows, sum: { median, p95, max } }.
 */
export async function trace(ms = 4500, fn = null) {
  const R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), T = canvas.app.ticker, d = D();
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const rows = [], qs = [];
  const a = performance.now(); fn?.(); const fnMs = performance.now() - a;
  const t0 = performance.now();
  try {
    while ( performance.now() - t0 < ms ) {
      const t = performance.now(); let q = null;
      if ( ext ) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      T.update(t);
      if ( ext ) gl.endQuery(ext.TIME_ELAPSED_EXT);
      gl.finish();
      rows.push({ t: Math.round(t - t0), cpu: performance.now() - t, layer: d.stats.frameMs, mode: d.cache?.stats.mode, anim: [...d.groups.values()].filter((g) => g.anim).length,
        parts: d.particles.length, q });
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally { T.maxFPS = mf; if ( st ) T.start(); }
  await new Promise((r) => setTimeout(r, 300));
  for ( const r of rows ) { if ( r.q && gl.getQueryParameter(r.q, gl.QUERY_RESULT_AVAILABLE) ) r.gpu = gl.getQueryParameter(r.q, gl.QUERY_RESULT) / 1e6; if ( r.q ) gl.deleteQuery(r.q); delete r.q; }
  const stat = (k, rs = rows) => { const v = rs.map((r) => r[k]).filter((x) => x !== undefined).sort((x, y) => x - y); return v.length ? { med: +v[v.length >> 1].toFixed(2), p95: +v[Math.floor(v.length * 0.95)].toFixed(2), max: +v[v.length - 1].toFixed(1) } : null; };
  const animRows = rows.filter((r) => r.anim > 0);
  return { fnMs: Math.round(fnMs), frames: rows.length, animFrames: animRows.length, cpu: stat("cpu", animRows), gpu: stat("gpu", animRows), layer: stat("layer", animRows),
    rows: rows.map((r) => [r.t, +r.cpu.toFixed(1), r.gpu === undefined ? null : +r.gpu.toFixed(1), +r.layer.toFixed(1), r.mode, r.anim, r.parts]) };
}

/**
 * ENTRY START CHECK (frozen clock): every area enters (a local Detonate) at a frozen moment; the shards are made as they would be
 * (frames stepped a hundredth of a ms apart); then nothing of an entering area may show before its time:
 *  - every piece whose life has not begun (now < t0 - pre) is hidden or not made,
 *  - the layer's pixels equal the layer with every entering area hidden (flood water hidden in both: it loops on its own clock).
 * Returns { areas, early (visible pieces before their time), mean, max, bad (pixels off by more than 8) }; all 0 is a pass.
 */
export function entryCheck() {
  const d = D(), A = game.modules.get("moinen-maps").api.destruction, T = canvas.app.ticker, real = performance.now.bind(performance);
  CONFIG.moinenMaps ??= {}; const was = CONFIG.moinenMaps.noDestructionCache; CONFIG.moinenMaps.noDestructionCache = true;
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const waters = [];
  for ( const g of d.order ) for ( const ch of g.cont.children ) if ( ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont && ch.visible ) { ch.visible = false; waters.push(ch); }
  let F = real(); performance.now = () => F;
  try {
    T.update(F);
    A.replay();                                   // every area enters, start = now
    for ( let i = 0; i < 60; i++ ) { F += 0.01; T.update(F); }
    const now = F, entering = d.order.filter((g) => g.anim);
    let early = 0;
    for ( const g of entering ) for ( const it of g.anim.list ) {
      if ( g.anim.tear ) continue;                // a tear's pieces keep their own clock (tear-entry.mjs)
      if ( now < it.t0 - it.pre && it.p.spr?.visible && it.p.spr.alpha > 0 ) early++;
    }
    const a = grab();
    for ( const g of entering ) g.cont.visible = false;
    const b = grab();
    for ( const g of entering ) g.cont.visible = true;
    let sum = 0, max = 0, bad = 0;
    for ( let i = 0; i < a.length; i++ ) { const v = Math.abs(a[i] - b[i]); sum += v; if ( v > max ) max = v; if ( v > 8 ) bad++; }
    for ( const g of entering ) d.endAnim(g);
    F += 10000; T.update(F);
    return { areas: entering.length, early, mean: +(sum / (a.length / 4)).toFixed(3), max, bad };
  } finally {
    performance.now = real; waters.forEach((w) => { w.visible = true; });
    CONFIG.moinenMaps.noDestructionCache = was; T.maxFPS = mf; if ( st ) T.start();
  }
}

/**
 * FROZEN-CLOCK A/B of a whole-scene entry against another renderer: `oldUrl` a copy of an older display.mjs served next to this one
 * (e.g. `git show <rev>:scripts/destruction/display.mjs > scripts/destruction/zz-display-old.mjs`, deleted after); its entry methods
 * run on shard sprites made beforehand (as the old renderer had them), then this renderer runs from its own state (flattened areas).
 * Returns per time [ms, mean |d| per pixel, max, channels off by more than 8]; flood water hidden (it loops on its own clock).
 * `preMat`: make this renderer's shards at once too (isolates the logic from the shards being made over frames).
 */
export async function abOld(oldUrl, times = [0, 60, 120, 300, 600, 1000, 1600, 2400, 3600], preMat = false) {
  const Old = (await import(`${oldUrl}?v=${Date.now()}`)).DestructionDisplay.prototype;
  const d = D(), T = canvas.app.ticker, names = ["enter", "animate", "erode", "makeDissolve", "stepDissolve", "endAnim"];
  const real = performance.now.bind(performance); CONFIG.moinenMaps ??= {}; const was = CONFIG.moinenMaps.noDestructionCache;
  CONFIG.moinenMaps.noDestructionCache = true; const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const ws = [];
  for ( const g of d.order ) for ( const ch of g.cont.children ) if ( ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont && ch.visible ) { ch.visible = false; ws.push(ch); }
  const run = (useOld) => {
    let F = real(); performance.now = () => F; T.update(F);
    if ( useOld ) { for ( const g of d.order ) if ( g.flat ) d.unflatten(g); for ( const g of d.order ) d.materialize(g, Infinity); for ( const n of names ) d[n] = Old[n]; }
    const start = F + 5;
    for ( const g of d.order ) d.enter(g, { start });
    if ( !useOld && preMat ) for ( const g of d.order ) d.materialize(g, Infinity);
    const shots = []; let t = F;
    for ( const dt of times ) { while ( t < start + dt ) { t = Math.min(start + dt, t + 16); F = t; T.update(F); } shots.push(grab()); }
    for ( const g of d.order ) d.endAnim(g);
    F += 10000; T.update(F);
    for ( const n of names ) delete d[n];
    performance.now = real;
    if ( useOld ) for ( const g of d.order ) d.flatten(g);
    return shots;
  };
  let a, b;
  try { a = run(true); b = run(false); }
  finally { performance.now = real; for ( const n of names ) delete d[n]; ws.forEach((w) => { w.visible = true; }); CONFIG.moinenMaps.noDestructionCache = was; T.maxFPS = mf; if ( st ) T.start(); }
  return times.map((dt, k) => {
    const x = a[k], y = b[k]; let s = 0, m = 0, bad = 0;
    for ( let i = 0; i < x.length; i++ ) { const v = Math.abs(x[i] - y[i]); s += v; if ( v > m ) m = v; if ( v > 8 ) bad++; }
    return [dt, +(s / (x.length / 4)).toFixed(3), m, bad];
  });
}
