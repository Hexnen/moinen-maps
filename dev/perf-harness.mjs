// Browser-side perf harness for the destruction layer (paste-free):   const H = await import("/modules/moinen-maps/dev/perf-harness.mjs")
//   H.perf(n, label)   steps the ticker by hand n frames (works with a hidden pane: rAF 0 Hz), returns median CPU (ticker + gl.finish),
//                      GPU (EXT_disjoint_timer_query_webgl2), draw calls and framebuffer binds per frame, the layer's own tick + cache ms
//   H.cmp()            the destruction layer drawn with the cache vs live at the current view: mean |dRGB| per pixel, max, % pixels > 60
//   H.fit(scale)       centre the scene at a zoom (default: fit the window)
//   H.rebakeAndShare(name) + H.diffShared(name)   GM vs a COLD player after Detonate -> reload -> Rebake all (bar: shown.max <= 8); H.selfDiff()
//                      the GM's own bands against its live areas (a stale band shows here); recipe at blockMeans below
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
  // (at the renderer's own resolution: screen size x resolution pixels, as the checks that index it expect)
  const rt = PIXI.RenderTexture.create({ width: w, height: h, resolution: R.resolution });
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

/**
 * RESTING FRAMES. The static cache softens its tiles while the canvas scale moves and for SOFT_MS (220 ms) after the last change
 * (static-cache.mjs zoomSoft: the waving fix), and a check that pans / zooms and reads the very next frame measures that softening
 * (thin outlines at half their alpha: ~780 "gap" pixels on a 1366x800 frame, more with the pixel density) instead of the look at
 * rest. `restClock()` skews performance.now so that `rest()` draws the frame as if a second had passed since the pan; `done()` gives
 * the clock back.
 */
export function restClock() {
  const real = performance.now.bind(performance), T = canvas.app.ticker, c = { skew: 0 };
  performance.now = () => real() + c.skew;
  c.rest = (n = 2) => { step(1); c.skew += 1000; step(n); };
  c.done = () => { performance.now = real; T.lastTime = real(); };
  return c;
}

/** The destruction layer drawn live (every unit of `live`, no cache bands), without freeing the bands: the cache's own frame is still there. */
export function liveGrab() {
  const d = D(), sh = d.cache?.show, sv = sh?.visible, lv = d.live.visible;
  if ( sh ) sh.visible = false;
  d.live.visible = true;
  try { return grab(); } finally { if ( sh ) sh.visible = sv; d.live.visible = lv; }
}

/** After a reload: wait for the layer, make every shard, let the flooded holes load. */
export async function boot() {
  await settled(40000); step(400);
  await new Promise((r) => setTimeout(r, 4000)); step(30);
  // (areas shown as shells get their pixels asynchronously; a band waiting for them is stale and a check would measure that)
  for ( let i = 0; i < 60 && (D()?.cache?.waiting || D()?.shellCount); i++ ) { await new Promise((r) => setTimeout(r, 500)); step(5); }
  return { ...D()?.cache?.stats, waiting: !!D()?.cache?.waiting };
}

/**
 * A timeline: run `fn` (e.g. a Detonate), then step frames for `ms` of real time; per frame CPU (ticker + gl.finish), GPU (timer
 * query), the layer's own tick, the cache mode, animating areas and particles. Returns { fnMs, rows, sum: { median, p95, max } }.
 */
export async function trace(ms = 4500, fn = null) {
  const R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), T = canvas.app.ticker, d = D();
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const rows = [], qs = [];
  let nDraw = 0, upMs = 0, upN = 0; const od = gl.drawElements, oa = gl.drawArrays, ot = gl.texSubImage2D, oi = gl.texImage2D, obs = gl.bufferSubData;
  gl.drawElements = function(...a) { nDraw++; return od.apply(gl, a); }; gl.drawArrays = function(...a) { nDraw++; return oa.apply(gl, a); };
  const timed = (f) => function(...a) { const t = performance.now(); try { return f.apply(gl, a); } finally { upMs += performance.now() - t; upN++; } };
  gl.texSubImage2D = timed(ot); gl.texImage2D = timed(oi); gl.bufferSubData = timed(obs);
  const a = performance.now(); fn?.(); const fnMs = performance.now() - a;
  const t0 = performance.now();
  try {
    while ( performance.now() - t0 < ms ) {
      const t = performance.now(); let q = null; nDraw = 0; upMs = 0; upN = 0;
      if ( ext ) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      T.update(t);
      if ( ext ) gl.endQuery(ext.TIME_ELAPSED_EXT);
      gl.finish();
      rows.push({ t: Math.round(t - t0), cpu: performance.now() - t, layer: d.stats.frameMs, mode: d.cache?.stats.mode, anim: [...d.groups.values()].filter((g) => g.anim).length,
        parts: d.particles.length, draws: nDraw, up: +upMs.toFixed(1), upN, heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0, P: Object.fromEntries(Object.entries(d.stats.parts ?? {}).map(([k, v]) => [k, +v.toFixed(1)])), q });
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally { T.maxFPS = mf; if ( st ) T.start(); gl.drawElements = od; gl.drawArrays = oa; gl.texSubImage2D = ot; gl.texImage2D = oi; gl.bufferSubData = obs; }
  await new Promise((r) => setTimeout(r, 300));
  for ( const r of rows ) { if ( r.q && gl.getQueryParameter(r.q, gl.QUERY_RESULT_AVAILABLE) ) r.gpu = gl.getQueryParameter(r.q, gl.QUERY_RESULT) / 1e6; if ( r.q ) gl.deleteQuery(r.q); delete r.q; }
  const stat = (k, rs = rows) => { const v = rs.map((r) => r[k]).filter((x) => x !== undefined).sort((x, y) => x - y); return v.length ? { med: +v[v.length >> 1].toFixed(2), p95: +v[Math.floor(v.length * 0.95)].toFixed(2), max: +v[v.length - 1].toFixed(1) } : null; };
  const animRows = rows.filter((r) => r.anim > 0);
  return { fnMs: Math.round(fnMs), frames: rows.length, animFrames: animRows.length, cpu: stat("cpu", animRows), gpu: stat("gpu", animRows), layer: stat("layer", animRows),
    draws: stat("draws", animRows), rows: rows.map((r) => [r.t, +r.cpu.toFixed(1), r.gpu === undefined ? null : +r.gpu.toFixed(1), +r.layer.toFixed(1), r.mode, r.anim, r.parts, r.draws, r.up, r.upN, r.P, Math.round(r.heap)]) };
}

/** Bytes of CPU-side atlas the groups hold now (a freed atlas holds none). */
export function atlasBytes() {
  let n = 0, held = 0, freed = 0;
  for ( const g of D().groups.values() ) { const b = g.tex?.resource?.data?.byteLength ?? 0; n += b; if ( b ) held++; else if ( g.atlasFree ) freed++; }
  return { MB: Math.round(n / 1048576), held, freed };
}

/**
 * DETONATE BENCH: a whole-scene Detonate (api.destruction.replay) and `ms` of stepped frames. Returns the animated frames' CPU / GPU /
 * draws, the frames over 33 / 16.7 ms, how the entries went (played after a wait, faded instead, offscreen), the heap and the atlases
 * held before and after. Start from a fresh state (canvas.draw() + boot()) for each run.
 */
export async function detBench({ ms = 4500, label = "" } = {}) {
  const A = game.modules.get("moinen-maps").api.destruction, d = D();
  const keys = ["entries", "waits", "waitedIn", "noPixelEntries", "offscreenEntries", "restored"];
  const s0 = Object.fromEntries(keys.map((k) => [k, d.stats[k] ?? 0]));
  const mem0 = { heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576), atlas: atlasBytes() };
  let atlasPeak = 0; const iv = setInterval(() => { atlasPeak = Math.max(atlasPeak, atlasBytes().MB); }, 40);
  const t = await trace(ms, () => A.replay());
  clearInterval(iv);
  const rows = t.rows.filter((r) => r[5] > 0), cpu = rows.map((r) => r[1]);
  const mem1 = { heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576), heapPeakMB: Math.max(...t.rows.map((r) => r[11] ?? 0)), atlas: atlasBytes(), atlasPeakMB: atlasPeak };
  return { label, fnMs: t.fnMs, animFrames: t.animFrames, cpu: t.cpu, gpu: t.gpu, draws: t.draws, over16: cpu.filter((x) => x > 16.7).length, over33: cpu.filter((x) => x > 33.3).length,
    worst: cpu.length ? +Math.max(...cpu).toFixed(0) : 0, first: t.rows[0]?.[1], entries: Object.fromEntries(keys.map((k) => [k, (d.stats[k] ?? 0) - s0[k]])), mem0, mem1,
    worstRows: rows.filter((r) => r[1] > 33.3).slice(0, 40) };
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
    // (a cave-in's tremor patch - the plain map over its pit, trembling from the start by design: collapse-entry.mjs - is map pixels,
    // not damage shown early: hidden in both pictures)
    const tremor = entering.map((g) => g.anim?.coll?.patch).filter((p) => p && p.visible);
    for ( const p of tremor ) p.visible = false;
    const a = grab();
    for ( const g of entering ) g.cont.visible = false;
    const b = grab();
    for ( const g of entering ) g.cont.visible = true;
    for ( const p of tremor ) p.visible = true;
    let sum = 0, max = 0, bad = 0;
    for ( let i = 0; i < a.length; i++ ) { const v = Math.abs(a[i] - b[i]); sum += v; if ( v > max ) max = v; if ( v > 8 ) bad++; }
    for ( const g of entering ) d.endAnim(g);
    F += 10000; T.update(F);
    return { areas: entering.length, early, mean: +(sum / (a.length / 4)).toFixed(3), max, bad, tremorPatches: tremor.length };
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

/**
 * BATCHED vs SPRITE pieces (frozen clock): the same entry played twice from the same state, first with every piece a PIXI sprite
 * (CONFIG.moinenMaps.noBatchRender = true) and then batched (piece-batch.mjs); the destruction layer grabbed at each time (ms after
 * the start). `only(g)` picks the areas that enter (default: all, a whole-scene Detonate); `preMat` makes every piece at once in both
 * runs (the sprite path makes 2500 per frame: without it the comparison would include that lag); `opts(g)` entry options per area.
 * `pair` the two modes (true = the flag set; `key` the CONFIG.moinenMaps flag, default noBatchRender: true = sprites; noGpuErode: true = CPU erode). Math.random is seeded alike in both runs (without it two sprite runs differ by a few hundred
 * pixels: random debris and rubble).
 * Flood water hidden (it loops on its own clock). Returns per time [ms, mean |d| per channel... per pixel, max, channels off by more
 * than 8, pixels that differ at all] and `shots` (the two frames per time, RGBA) when `keep`.
 */
export async function abBatch({ times = [0, 60, 120, 300, 600, 1000, 1600, 2400, 3600], only = null, preMat = true, opts = null, keep = false, pair = [true, false], key = "noBatchRender" } = {}) {
  const d = D(), T = canvas.app.ticker, real = performance.now.bind(performance);
  CONFIG.moinenMaps ??= {}; const was = CONFIG.moinenMaps.noDestructionCache, wasB = CONFIG.moinenMaps[key], wasE = CONFIG.moinenMaps.erodeBudget, wasW = CONFIG.moinenMaps.noClockWorker;
  CONFIG.moinenMaps.noDestructionCache = true; const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  // (the clocks made on the page: a frozen clock never lets the workers' answers in; clockCheck() compares the two)
  CONFIG.moinenMaps.noClockWorker = true;
  const ws = [];
  for ( const g of d.order ) for ( const ch of g.cont.children ) if ( ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont && ch.visible ) { ch.visible = false; ws.push(ch); }
  const groups = only ? d.order.filter(only) : [...d.order];
  // every area back to its resting state with no pieces made (the next run makes them in its own mode)
  const reset = () => { for ( const g of d.order ) { if ( g.anim ) d.endAnim(g); if ( !g.flat && !d.flatten(g) ) { d.release(g); g.made = 0; } } };
  const run = (sprites) => {
    CONFIG.moinenMaps[key] = sprites; CONFIG.moinenMaps.erodeBudget = 1e9;   // (no catching-up lag in the CPU erode)
    // Math.random seeded the same in both runs (particles, debris, rubble): the two runs differ only by the renderer
    let seed = 12345; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let F = real(); performance.now = () => F;
    reset(); T.update(F);
    const start = F + 5;
    for ( const g of groups ) d.enter(g, { start, ...(opts?.(g) ?? {}) });
    if ( preMat ) for ( const g of d.order ) d.materialize(g, Infinity);   // (all: a light area that does not enter is made too)
    // (every atlas on the GPU before the first frame: the batched path otherwise sends a few per frame and holds their pieces back)
    if ( preMat ) for ( const g of groups ) if ( g.tex && !g.tex.destroyed ) canvas.app.renderer.texture.bind(g.tex, 0);
    const shots = []; let t = F;
    for ( const dt of times ) { while ( t < start + dt ) { t = Math.min(start + dt, t + 16); F = t; T.update(F); } shots.push(grab()); }
    const info = { batched: groups.filter((g) => g.batch).length, sprites: groups.filter((g) => g.made && !g.batch).length };
    for ( const g of groups ) d.endAnim(g);
    F += 10000; T.update(F);
    performance.now = real;
    return { shots, info };
  };
  let a, b; const rnd = Math.random;
  try { a = run(pair[0]); b = run(pair[1]); reset(); }
  finally { Math.random = rnd; performance.now = real; CONFIG.moinenMaps[key] = wasB; CONFIG.moinenMaps.erodeBudget = wasE; CONFIG.moinenMaps.noClockWorker = wasW; ws.forEach((w) => { w.visible = true; }); CONFIG.moinenMaps.noDestructionCache = was; T.maxFPS = mf; if ( st ) T.start(); }
  const rows = times.map((dt, k) => {
    const x = a.shots[k], y = b.shots[k]; let s = 0, m = 0, bad = 0, px = 0;
    for ( let i = 0; i < x.length; i += 4 ) {
      let any = false;
      for ( let c = 0; c < 4; c++ ) { const v = Math.abs(x[i + c] - y[i + c]); s += v; if ( v > m ) m = v; if ( v > 8 ) bad++; if ( v ) any = true; }
      if ( any ) px++;
    }
    return [dt, +(s / (x.length / 4)).toFixed(3), m, bad, px];
  });
  return { areas: groups.length, sprite: a.info, batch: b.info, rows, shots: keep ? { a: a.shots, b: b.shots } : undefined };
}

/**
 * GPU ERODE CHECK (frozen clock): every area enters (a local Detonate, clocks made on the page); at each time (ms after the start) the
 * ruin's render texture (the GPU erode, erode-gpu.mjs) is read back and compared, pixel by pixel, with the CPU erode run on a shadow
 * buffer over the very same clock (display.erode on a stand-in group, unlimited pixel budget, no particles). A pixel is a mismatch
 * when an opaque pixel's rgba differs at all, or a translucent one's differs by more than 1 (the browser premultiplied it on upload).
 * Returns { areas, rows: [[ms, areas compared, pixels compared, mismatches, worst area's mismatches]] }; all 0 is a pass.
 */
export async function erodeGpuCheck({ times = [0, 40, 90, 150, 250, 400, 600, 900, 1300, 2000, 3000], only = null, samples = 0 } = {}) {
  const SM = [];
  const d = D(), T = canvas.app.ticker, real = performance.now.bind(performance), R = canvas.app.renderer;
  CONFIG.moinenMaps ??= {}; const was = [CONFIG.moinenMaps.noDestructionCache, CONFIG.moinenMaps.noClockWorker, CONFIG.moinenMaps.noGpuErode];
  CONFIG.moinenMaps.noDestructionCache = true; CONFIG.moinenMaps.noClockWorker = true; CONFIG.moinenMaps.noGpuErode = false;
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const ws = [];
  for ( const g of d.order ) for ( const ch of g.cont.children ) if ( ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont && ch.visible ) { ch.visible = false; ws.push(ch); }
  let F = real(); performance.now = () => F;
  const rows = [];
  try {
    for ( const g of d.order ) { if ( g.anim ) d.endAnim(g); if ( !g.flat && !d.flatten(g) ) { d.release(g); g.made = 0; } }
    T.update(F);
    const start = F + 5, groups = only ? d.order.filter(only) : [...d.order];
    for ( const g of groups ) d.enter(g, { start });
    for ( const g of d.order ) d.materialize(g, Infinity);
    for ( const g of groups ) if ( g.tex && !g.tex.destroyed ) R.texture.bind(g.tex, 0);
    for ( let i = 0; i < 400 && d.clocks.length; i++ ) { F += 0.01; T.update(F); }
    const live = groups.filter((g) => g.anim?.rev?.gpu && g.anim.rev.keys);
    // the shadow CPU buffers
    const sh = new Map();
    for ( const g of live ) {
      const r = g.anim.rev, w = r.w, h = r.h;
      sh.set(g, { rev: { keys: r.keys, tms: r.tms, next: 0, buf: new Uint8Array(w * h * 4), data: r.data, w, stages: r.stages, cur: new Int32Array(r.stages.length), tex: { resource: { mark() {} }, update() {} } }, start: g.anim.start });
    }
    const fake = { info: null, baseSpr: null, batch: null };
    for ( const dt of times ) {
      F = start + dt; T.update(F);
      let areas = 0, px = 0, bad = 0, worst = 0;
      for ( const g of live ) {
        const r = g.anim?.rev; if ( !r?.gpu || !r.rt ) continue;
        const s = sh.get(g);
        fake.info = g.info;
        d.erode.call(d, fake, { start: s.start, type: g.anim.type, rev: s.rev, cl: null, k: g.anim.k }, F, false, Infinity);
        const gpu = R.extract.pixels(r.rt), cpu = s.rev.buf; let b = 0;
        for ( let i = 0; i < cpu.length; i += 4 ) {
          const a = cpu[i + 3];
          if ( a === 255 || a === 0 ) { if ( gpu[i] !== cpu[i] || gpu[i + 1] !== cpu[i + 1] || gpu[i + 2] !== cpu[i + 2] || gpu[i + 3] !== a ) { if ( !(a === 0 && gpu[i + 3] === 0) ) { b++; if ( SM.length < samples ) SM.push({ dt, hash: g.hash, type: g.anim.type, px: i / 4, cpu: [...cpu.subarray(i, i + 4)], gpu: [...gpu.subarray(i, i + 4)], data: [...s.rev.data.subarray(i, i + 4)], tm: (() => { const j = s.rev.keys.indexOf(i / 4); return j < 0 ? null : s.rev.tms[j]; })() }); } } }
          else {
            // (the browser truncates when it premultiplies on upload, and Extract.pixels may un-premultiply what it reads: either way within one premultiplied byte)
            const k = a / 255, tol = 255 / a + 1.01;
            let ok = gpu[i + 3] === a;
            for ( let c = 0; c < 3 && ok; c++ ) if ( Math.abs(gpu[i + c] - cpu[i + c] * k) > 1.01 && Math.abs(gpu[i + c] - cpu[i + c]) > tol ) ok = false;
            if ( !ok ) { b++; if ( SM.length < samples ) SM.push({ dt, hash: g.hash, type: g.anim.type, px: i / 4, cpu: [...cpu.subarray(i, i + 4)], gpu: [...gpu.subarray(i, i + 4)], data: [...s.rev.data.subarray(i, i + 4)] }); }
          }
        }
        areas++; px += cpu.length / 4; bad += b; if ( b > worst ) worst = b;
      }
      rows.push([dt, areas, px, bad, worst]);
    }
    for ( const g of groups ) d.endAnim(g);
    F += 10000; T.update(F);
  } finally {
    performance.now = real; ws.forEach((w) => { w.visible = true; });
    [CONFIG.moinenMaps.noDestructionCache, CONFIG.moinenMaps.noClockWorker, CONFIG.moinenMaps.noGpuErode] = was; T.maxFPS = mf; if ( st ) T.start();
  }
  return { areas: d.order.length, rows, samples: SM };
}

/**
 * BATCH VERTEX CHECK: for `n` areas (the biggest first), every piece made batched and, beside it, a PIXI sprite posed the same way
 * (as display.makePiece / place leave it at rest) in the same container: the quad's four vertices, UVs and packed colour compared
 * with what PIXI's batcher would take from the sprite (vertexData, uvs, Color.toPremultiplied). Returns { pieces, vertices, uvs,
 * colours } - the counts that differ (all 0: the same numbers).
 */
export function batchVertexCheck(n = 12) {
  const d = D(); CONFIG.moinenMaps ??= {};
  const was = [CONFIG.moinenMaps.noBatchRender, CONFIG.moinenMaps.noDestructionCache];
  CONFIG.moinenMaps.noBatchRender = false; CONFIG.moinenMaps.noDestructionCache = true;
  let pieces = 0, vbad = 0, ubad = 0, cbad = 0;
  try {
    const list = d.order.filter((g) => g.flat && !g.anim && g.pieces.length).sort((a, b) => b.pieces.length - a.pieces.length).slice(0, n);
    for ( const g of list ) { d.unflatten(g); d.materialize(g, Infinity); }
    step(2);
    for ( const g of list ) {
      const b = g.batch, D2 = b.G.dynF32, U = b.G.dynU32, S = b.G.statF32, ap = d.ap, o = d.origin;
      for ( let k = 0; k < g.pieces.length; k++ ) {
        const p = g.pieces[k], s = new PIXI.Sprite(g.frame(p.frame)); s.anchor.set(0.5); s.scale.set(ap); s.position.set(o.x + p.fx * ap, o.y + p.fy * ap);
        g.shardCont.addChild(s); s.updateTransform(); s.calculateVertices(); g.shardCont.removeChild(s);
        const q = (k + 1) * 12, v = s.vertexData, u = s.uvs;
        if ( [0, 1, 3, 4, 6, 7, 9, 10].some((j, i) => D2[q + j] !== v[i]) ) vbad++;
        if ( [0, 1, 3, 4, 6, 7, 9, 10].some((j, i) => S[q + j] !== u[i]) ) ubad++;
        if ( U[q + 2] !== (PIXI.Color.shared.setValue(s._tintRGB).toPremultiplied(Math.min(s.worldAlpha, 1), true) >>> 0) ) cbad++;
        pieces++; s.destroy({ texture: true });
      }
    }
    for ( const g of list ) d.flatten(g);
  } finally { [CONFIG.moinenMaps.noBatchRender, CONFIG.moinenMaps.noDestructionCache] = was; step(1); }
  return { pieces, vertices: vbad, uvs: ubad, colours: cbad };
}

/**
 * CLOCK CHECK: every area enters (entries set up at once), its clocks made by the clock workers (clock-pool.mjs) and, a second time,
 * on the page (clockSlice); per clock the two sorted pixel orders and moments compared. Returns { clocks, same, differ, ms }.
 */
export async function clockCheck() {
  const d = D(), T = canvas.app.ticker; CONFIG.moinenMaps ??= {};
  const wasW = CONFIG.moinenMaps.noClockWorker, wasE = CONFIG.moinenMaps.enterAtOnce, mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const snap = () => d.order.filter((g) => g.anim).flatMap((g) => [g.anim.rev, g.anim.crev].filter(Boolean).map((R) => ({ h: g.hash, c: R === g.anim.crev, ix: R.keys, tm: R.tms })));
  try {
    CONFIG.moinenMaps.enterAtOnce = true;
    CONFIG.moinenMaps.noClockWorker = false;
    let t = performance.now(); d.detonate(performance.now());
    const all = () => d.order.filter((g) => g.anim).every((g) => [g.anim.rev, g.anim.crev].every((R) => !R || R.keys));
    while ( !all() && performance.now() - t < 60000 ) await new Promise((r) => setTimeout(r, 20));
    const ms = Math.round(performance.now() - t);
    const A = snap();
    for ( const g of d.order ) d.endAnim(g);
    CONFIG.moinenMaps.noClockWorker = true;
    d.detonate(performance.now());
    d.clockSlice(1e9, { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 });
    const B = snap();
    for ( const g of d.order ) d.endAnim(g);
    let same = 0, differ = 0;
    const key = (q) => `${q.h}|${q.c}`, bm = new Map(B.map((q) => [key(q), q]));
    for ( const a of A ) {
      const b = bm.get(key(a));
      const eq = !!b && a.ix && b.ix && a.ix.length === b.ix.length && a.ix.every((v, i) => v === b.ix[i] && a.tm[i] === b.tm[i]);
      if ( eq ) same++; else differ++;
    }
    return { clocks: A.length, same, differ, workerMs: ms };
  } finally { CONFIG.moinenMaps.noClockWorker = wasW; CONFIG.moinenMaps.enterAtOnce = wasE; T.maxFPS = mf; if ( st ) T.start(); step(5); }
}

/**
 * AFTER-LOAD CHECK (call it right after the scene opens, e.g. from a driver that reloads the page): for `ms` (default 15 s) of real
 * frames (requestAnimationFrame, nothing stepped) every frame's ticker listeners (instrument()) and the long tasks between frames
 * (PerformanceObserver 'longtask'). Returns the frames whose ticker work took more than `over` ms (default 8) with the listeners in
 * them, and the long tasks; `destructionMax` = the destruction display's own tick, worst frame.
 */
export async function loadCheck({ ms = 15000, over = 8 } = {}) {
  const inst = instrument(), rows = [], tasks = [];
  let obs = null;
  try { obs = new PerformanceObserver((l) => { for ( const e of l.getEntries() ) tasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); }); obs.observe({ type: "longtask", buffered: false }); } catch { obs = null; }
  const t0 = performance.now();
  try {
    await new Promise((res) => { const f = () => { const fr = inst.frame(); rows.push({ t: Math.round(performance.now() - t0), ...fr }); if ( performance.now() - t0 < ms ) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  } finally { inst.restore(); obs?.disconnect(); }
  const tickOf = (r) => Object.entries(r).filter(([k]) => k.includes(".")).reduce((a, [, v]) => a + v, 0);
  const isD = (k) => /DestructionDisplay/.test(k);
  const big = rows.filter((r) => tickOf(r) > over).map((r) => ({ t: r.t, ms: +tickOf(r).toFixed(1), ...Object.fromEntries(Object.entries(r).filter(([k, v]) => k !== "t" && v >= 1).map(([k, v]) => [k.slice(0, 60), +v.toFixed(1)])) }));
  const dmax = Math.max(0, ...rows.map((r) => Object.entries(r).filter(([k]) => isD(k)).reduce((a, [, v]) => a + v, 0)));
  return { frames: rows.length, over: big.length, destructionMax: +dmax.toFixed(1), big: big.slice(0, 30), longTasks: tasks.filter((x) => x.at >= t0) };
}

/**
 * SEAM CHECK: a zoom sweep (and a few pan offsets); every frame the whole canvas (or `target`) is drawn to a texture and searched for
 * thin vertical / horizontal lines: a column whose pixels stand out from BOTH neighbours (by more than `thr`, summed RGB) while the two
 * neighbours agree with each other, over a large share of the rows. Lines in the map art sit at the same scene x at every zoom and
 * are there with the module off too; a seam from a texture edge appears at some zooms only. Returns the lines found:
 * [{ zoom, axis, screen, scene, score }] and per zoom the number of lines.
 */
export function seamCheck({ zooms = null, offsets = [0, 0.37, 0.71], thr = 36, minScore = 0.35, target = null } = {}) {
  const R = canvas.app.renderer, T = canvas.app.ticker;
  zooms ??= Array.from({ length: 58 }, (_, i) => +(0.3 + i * 0.1).toFixed(2));
  const found = [], per = {};
  const W = R.screen.width, H = R.screen.height;
  const rt = PIXI.RenderTexture.create({ width: W, height: H, resolution: R.resolution });
  const PW = Math.round(W * R.resolution), PH = Math.round(H * R.resolution);
  const clock = restClock();                 // (the resting look: not the cache's softening while the scale moves)
  try {
    for ( const z of zooms ) for ( const off of offsets ) {
      const r = canvas.dimensions.sceneRect;
      canvas.pan({ x: r.x + r.width / 2 + off, y: r.y + r.height / 2 + off * 0.5, scale: z });
      clock.rest(2);
      // what reached the screen: the frame just drawn, read from the default framebuffer (the primary group draws through its own
      // render texture, so drawing the stage again into a texture is not the same picture); `target`: that object alone
      let px;
      if ( target ) { R.render(target, { renderTexture: rt, clear: true, transform: target.parent?.worldTransform ?? null }); px = R.extract.pixels(rt); }
      else { const T2 = canvas.app.ticker, mf = T2.maxFPS; T2.maxFPS = 0; T2.update(performance.now()); T2.maxFPS = mf; R.renderTexture.bind(null); px = R.extract.pixels(); }
      const M = canvas.stage.worldTransform, s = M.a * R.resolution;
      const at = (x, y) => { const i = (y * PW + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
      const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]);
      let n = 0;
      // (Foundry's own scene outline - the interface group, not the primary one that holds this module's layers - is a dark line 1-2 px
      // outside the scene rectangle at some zooms / resolutions: 1.25 at 1137x733 puts it at scene -1.4 / +0.2 past the far edges; not a seam)
      const sr = canvas.dimensions.sceneRect, tol = 4 * R.resolution;
      const onBorder = (v, ax) => (ax === "x" ? [sr.x, sr.x + sr.width].map((e) => (e * M.a + M.tx) * R.resolution) : [sr.y, sr.y + sr.height].map((e) => (e * M.d + M.ty) * R.resolution)).some((e) => Math.abs(v - e) <= tol);
      // columns
      for ( let x = 1; x < PW - 1; x++ ) {
        let hit = 0, rows = 0;
        for ( let y = 0; y < PH; y += 3 ) {
          const L = at(x - 1, y), C = at(x, y), Rr = at(x + 1, y);
          if ( !L[3] && !C[3] && !Rr[3] ) continue;
          rows++;
          if ( diff(L, Rr) < thr * 0.5 && diff(C, L) > thr && diff(C, Rr) > thr ) hit++;
        }
        if ( rows > 30 && hit / rows >= minScore && !onBorder(x, "x") ) { n++; found.push({ zoom: z, off, axis: "x", screen: x, scene: +(((x / R.resolution) - M.tx) / M.a).toFixed(1), score: +(hit / rows).toFixed(2) }); }
      }
      // rows
      for ( let y = 1; y < PH - 1; y++ ) {
        let hit = 0, cols = 0;
        for ( let x = 0; x < PW; x += 3 ) {
          const U = at(x, y - 1), C = at(x, y), Dn = at(x, y + 1);
          if ( !U[3] && !C[3] && !Dn[3] ) continue;
          cols++;
          if ( diff(U, Dn) < thr * 0.5 && diff(C, U) > thr && diff(C, Dn) > thr ) hit++;
        }
        if ( cols > 30 && hit / cols >= minScore && !onBorder(y, "y") ) { n++; found.push({ zoom: z, off, axis: "y", screen: y, scene: +(((y / R.resolution) - M.ty) / M.d).toFixed(1), score: +(hit / cols).toFixed(2) }); }
      }
      per[`${z}/${off}`] = n;
    }
  } finally { rt.destroy(true); clock.done(); }
  return { found, per };
}

/**
 * OUTLINE CHECK: does the damage look the same at every zoom, apart from its size? A region (default: around the largest tear) is
 * drawn at each zoom (the destruction layer alone, as it reaches the screen with the current cache / flatten settings) and sampled
 * back onto one grid of `cell` scene px (box average of the screen pixels in each cell). Per zoom: dark outline cells (luma < 70,
 * mostly opaque) relative to zoom 1, and the correlation of the Sobel edge maps with zoom 1. `sweep` adds the same metrics over a
 * fine zoom sweep and the largest jump between neighbouring zoom steps (a switch of the sampling shows as a jump).
 */
export function outlineCheck({ zooms = [0.5, 0.725, 1, 1.25, 2, 3.5, 6], cell = 2, region = null, sweep = false } = {}) {
  const R = canvas.app.renderer, d = D(), ap = d.ap, o = d.origin;
  if ( !region ) {
    const g = [...d.groups.values()].filter((q) => q.info.type === "gash").sort((a, b) => b.pieces.length - a.pieces.length)[0] ?? d.order[0];
    const r = g.info.rect, cx = o.x + (r.x0 + r.x1) / 2 * ap, cy = o.y + (r.y0 + r.y1) / 2 * ap;
    region = { x: Math.round(cx - 100), y: Math.round(cy - 60), w: 200, h: 120 };
  }
  const GW = Math.floor(region.w / cell), GH = Math.floor(region.h / cell);
  const grabGrid = (z) => {
    canvas.pan({ x: region.x + region.w / 2, y: region.y + region.h / 2, scale: z });
    clock.rest(3);
    const W = R.screen.width, H = R.screen.height, rt = PIXI.RenderTexture.create({ width: W, height: H, resolution: R.resolution });
    R.render(d.objs, { renderTexture: rt, transform: canvas.primary.worldTransform.clone(), clear: true });
    const px = R.extract.pixels(rt), PW = Math.round(W * R.resolution), PH = Math.round(H * R.resolution); rt.destroy(true);
    const M = canvas.primary.worldTransform, k = R.resolution;
    const L = new Float32Array(GW * GH), A = new Float32Array(GW * GH);
    for ( let gy = 0; gy < GH; gy++ ) for ( let gx = 0; gx < GW; gx++ ) {
      const sx0 = Math.floor((M.a * (region.x + gx * cell) + M.tx) * k), sx1 = Math.max(sx0 + 1, Math.floor((M.a * (region.x + (gx + 1) * cell) + M.tx) * k));
      const sy0 = Math.floor((M.d * (region.y + gy * cell) + M.ty) * k), sy1 = Math.max(sy0 + 1, Math.floor((M.d * (region.y + (gy + 1) * cell) + M.ty) * k));
      let l = 0, a = 0, n = 0;
      for ( let y = sy0; y < sy1; y++ ) for ( let x = sx0; x < sx1; x++ ) {
        if ( x < 0 || y < 0 || x >= PW || y >= PH ) continue;
        const i = (y * PW + x) * 4; l += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; a += px[i + 3]; n++;
      }
      L[gy * GW + gx] = n ? l / n : 0; A[gy * GW + gx] = n ? a / n : 0;
    }
    return { L, A };
  };
  const sobel = (L) => { const E = new Float32Array(GW * GH); for ( let y = 1; y < GH - 1; y++ ) for ( let x = 1; x < GW - 1; x++ ) {
    const v = (dx, dy) => L[(y + dy) * GW + x + dx];
    const gx = -v(-1, -1) - 2 * v(-1, 0) - v(-1, 1) + v(1, -1) + 2 * v(1, 0) + v(1, 1);
    const gy = -v(-1, -1) - 2 * v(0, -1) - v(1, -1) + v(-1, 1) + 2 * v(0, 1) + v(1, 1);
    E[y * GW + x] = Math.hypot(gx, gy); } return E; };
  const dark = ({ L, A }) => { let n = 0; for ( let i = 0; i < L.length; i++ ) if ( A[i] > 128 && L[i] * 255 / Math.max(1, A[i]) < 70 ) n++; return n; };
  const corr = (a, b) => { let sa = 0, sb = 0, n = a.length; for ( let i = 0; i < n; i++ ) { sa += a[i]; sb += b[i]; } const ma = sa / n, mb = sb / n;
    let num = 0, da = 0, db = 0; for ( let i = 0; i < n; i++ ) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; } return num / Math.sqrt(da * db || 1); };
  // the flooded holes' water loops on its own clock: hidden while measuring (restored at the end)
  const ws = [], clock = restClock();      // (the resting look: not the cache's softening while the scale moves)
  for ( const g of d.order ) for ( const ch of g.cont.children ) if ( ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont && ch.visible ) { ch.visible = false; ws.push(ch); }
  try {
  const ref = grabGrid(1), refE = sobel(ref.L), refDark = dark(ref);
  const rows = zooms.map((z) => { const g = grabGrid(z); return { zoom: +canvas.stage.scale.x.toFixed(3), darkRatio: +(dark(g) / Math.max(1, refDark)).toFixed(3), edgeCorr: +corr(sobel(g.L), refE).toFixed(3), mode: d.cache?.stats.mode }; });
  let sw = null;
  if ( sweep ) {
    const zs = Array.from({ length: 115 }, (_, i) => +(0.3 + i * 0.05).toFixed(2));
    const pts = zs.map((z) => { const g = grabGrid(z); return { z, dark: dark(g) / Math.max(1, refDark), corr: corr(sobel(g.L), refE) }; });
    let jump = { dark: 0, corr: 0, at: null };
    for ( let i = 1; i < pts.length; i++ ) {
      const dd = Math.abs(pts[i].dark - pts[i - 1].dark), dc = Math.abs(pts[i].corr - pts[i - 1].corr);
      if ( dd > jump.dark ) jump = { ...jump, dark: +dd.toFixed(3), at: pts[i].z };
      if ( dc > jump.corr ) jump.corr = +dc.toFixed(3);
    }
    sw = { jump, curve: pts.filter((_, i) => i % 5 === 0).map((p) => [p.z, +p.dark.toFixed(2), +p.corr.toFixed(2)]) };
  }
  return { region, refDark, rows, sweep: sw };
  } finally { clock.done(); ws.forEach((w) => { w.visible = true; }); }
}

/* ---------------------------------------------------------------------------------------------------------------------------------
 * ZOOM / PAN BENCHMARK and the instruments it shares with the animation benchmark.
 * A hidden pane has no requestAnimationFrame: frames are stepped by hand at `hz` (default 165: 6.06 ms per frame), each frame waits
 * for its slot in real time (busy wait), so a frame that takes longer than its slot makes the next one late, like a dropped vsync.
 * Input (wheel / drag) runs between frames, as the browser delivers it. Per frame: CPU of the input handlers + the ticker update +
 * gl.finish, GPU (EXT_disjoint_timer_query_webgl2 round the update). Counted per phase: hook calls and their time (per hook and per
 * canvasPan listener), ticker listeners' time (per listener), GL texture uploads / creations / mipmap builds / framebuffer binds /
 * draws, RenderTexture.create, getBounds / sortChildren calls, filter passes.
 * --------------------------------------------------------------------------------------------------------------------------------- */
const pct = (a, p) => { if ( !a.length ) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2); };
export const dist = (a) => ({ n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), p99: pct(a, 0.99), max: a.length ? +Math.max(...a).toFixed(1) : null,
  over6: a.filter((x) => x > 6.06).length, over16: a.filter((x) => x > 16.7).length, over33: a.filter((x) => x > 33.3).length });

/** Install the counters; returns { snap(), restore() }: snap() reads and zeroes the counters. */
export function instrument() {
  const R = canvas.app.renderer, gl = R.gl, T = canvas.app.ticker, undo = [];
  const c = { hooks: {}, hookMs: {}, pan: {}, tick: {}, gl: {} };
  let fr = {};                                         // this frame's counts (frame() reads and resets them)
  const bump = (o, k, v = 1) => { o[k] = (o[k] ?? 0) + v; if ( o !== c.hooks ) fr[k] = (fr[k] ?? 0) + v; };
  const wrapObj = (obj, name, pre) => { const o = obj[name]; obj[name] = function(...a) { pre(...a); return o.apply(this, a); }; undo.push(() => { obj[name] = o; }); };
  for ( const n of ["texImage2D", "texSubImage2D", "generateMipmap", "createTexture", "deleteTexture", "bindFramebuffer", "drawElements", "drawArrays", "createFramebuffer"] ) wrapObj(gl, n, () => bump(c.gl, n));
  wrapObj(PIXI.RenderTexture, "create", () => bump(c.gl, "RenderTexture.create"));
  wrapObj(PIXI.DisplayObject.prototype, "getBounds", () => bump(c.gl, "getBounds"));
  wrapObj(PIXI.Container.prototype, "sortChildren", () => bump(c.gl, "sortChildren"));
  wrapObj(PIXI.Texture, "from", () => bump(c.gl, "Texture.from"));
  if ( R.filter ) wrapObj(R.filter, "push", () => bump(c.gl, "filterPass"));
  // timers: a callback longer than 2 ms is counted as a task between frames (label: the start of its source)
  c.tasks = {};
  for ( const k of ["setTimeout", "setInterval"] ) {
    const o = globalThis[k];
    globalThis[k] = function(fn, ...a) {
      if ( typeof fn !== "function" ) return o.call(this, fn, ...a);
      return o.call(this, function(...b) { const t = performance.now(); try { return fn.apply(this, b); } finally { const ms = performance.now() - t;
        if ( ms > 2 ) bump(c.tasks, `${k}:${String(fn).slice(0, 70).replace(/\s+/g, " ")}`, ms); } }, ...a);
    };
    undo.push(() => { globalThis[k] = o; });
  }
  // hooks: the time of every callAll / call, and of each canvasPan listener on its own
  for ( const k of ["callAll", "call"] ) {
    const o = Hooks[k];
    Hooks[k] = function(name, ...a) { const t = performance.now(); try { return o.call(this, name, ...a); } finally { bump(c.hooks, name); bump(c.hookMs, name, performance.now() - t); } };
    undo.push(() => { Hooks[k] = o; });
  }
  for ( const h of Hooks.events.canvasPan ?? [] ) {
    const fn = h.fn, label = `${fn.name || "anon"}:${String(fn).slice(0, 60).replace(/\s+/g, " ")}`;
    h.fn = function(...a) { const t = performance.now(); try { return fn.apply(this, a); } finally { bump(c.pan, label, performance.now() - t); } };
    undo.push(() => { h.fn = fn; });
  }
  // ticker listeners (the list as it is now; a listener added later is not timed)
  for ( let l = T._head.next; l; l = l.next ) {
    const key = l._fn ? "_fn" : "fn", fn = l[key]; if ( !fn ) continue;
    const label = `${l.context?.constructor?.name ?? ""}.${fn.name || "anon"}@${l.priority}:${String(fn).slice(0, 50).replace(/\s+/g, " ")}`;
    l[key] = function(...a) { const t = performance.now(); try { return fn.apply(this, a); } finally { bump(c.tick, label, performance.now() - t); } };
    undo.push(() => { l[key] = fn; });
  }
  const r2 = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(2)]));
  return {
    snap() { const out = { hooks: r2(c.hooks), hookMs: r2(c.hookMs), pan: r2(c.pan), tick: r2(c.tick), gl: r2(c.gl), tasks: r2(c.tasks) }; for ( const k of Object.keys(c) ) c[k] = {}; fr = {}; return out; },
    frame() { const f = fr; fr = {}; return f; },
    restore() { for ( const u of undo.reverse() ) u(); }
  };
}

/** Busy-wait until `t` (performance.now()). */
const until = (t) => { while ( performance.now() < t ) { /* spin */ } };

/**
 * Run `frames` (an array of per-frame input functions or null) at `hz`. Returns per-frame rows { input, cpu, gpu, t }.
 * `cb(i, t)` (optional) after every frame (e.g. to sample positions for the animation benchmark).
 */
export async function runFrames(frames, { hz = 165, cb = null } = {}) {
  const R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), T = canvas.app.ticker;
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const per = 1000 / hz, rows = [];
  // between frames the event loop runs (timers, messages, idle callbacks: work the module defers with setTimeout lands there, as
  // in a browser); `gap` = the longest task seen while waiting, `interval` = start to start of consecutive frames (ideal: 1000 / hz)
  const ch = new MessageChannel(); let wake = null; ch.port1.onmessage = () => wake?.();
  const yieldTask = () => new Promise((r) => { wake = r; ch.port2.postMessage(0); });
  let slot = performance.now(); const t00 = slot; let prev = null;
  try {
    for ( let i = 0; i < frames.length; i++ ) {
      slot += per;
      let gap = 0, gc = 0;
      while ( performance.now() < slot - 0.3 ) {
        const a = performance.now(), h0 = performance.memory?.usedJSHeapSize ?? 0;
        await yieldTask();
        const g = performance.now() - a, h1 = performance.memory?.usedJSHeapSize ?? 0;
        if ( g > gap ) { gap = g; gc = h0 - h1 > 1 << 20 ? (h0 - h1) / 1048576 : 0; }   // the heap shrank by > 1 MB meanwhile: a GC
      }
      until(slot);
      const now0 = performance.now();
      if ( now0 - slot > per ) slot = Math.ceil((now0 - t00) / per) * per + t00;   // late: the next vsync after it
      const t = performance.now();
      frames[i]?.(i);
      const ti = performance.now();
      let q = null;
      if ( ext ) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      T.update(ti);
      if ( ext ) gl.endQuery(ext.TIME_ELAPSED_EXT);
      gl.finish();
      const t1 = performance.now();
      rows.push({ input: ti - t, cpu: t1 - t, q, t: t - t00, gap, gc, interval: prev === null ? per : t - prev });
      prev = t;
      cb?.(i, t);
    }
  } finally { T.maxFPS = mf; if ( st ) T.start(); ch.port1.close(); }
  await new Promise((r) => setTimeout(r, 250));
  for ( const r of rows ) { if ( r.q ) { if ( gl.getQueryParameter(r.q, gl.QUERY_RESULT_AVAILABLE) ) r.gpu = gl.getQueryParameter(r.q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(r.q); } delete r.q; }
  return rows;
}

/** A wheel notch through Foundry's own handler (5% per notch round the view centre), as the mouse manager calls it. */
export const wheelNotch = (dir) => canvas._onMouseWheel({ delta: dir, deltaY: dir, clientX: innerWidth / 2, clientY: innerHeight / 2,
  preventDefault() {}, stopPropagation() {}, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, target: canvas.app.view });

/**
 * The zoom sequence: wheel notches 1 -> 0.3 -> 3 -> 6 -> 1, delivered like a free-spinning wheel / trackpad (a gesture: dense at its
 * start, thinning out with inertia), then a drag pan and an animatePan, with idle frames after each. Every phase is measured on its
 * own. Returns per phase the frame-time distribution (cpu = input + ticker + gl.finish), input handler time, GPU, the reached zoom
 * and the instrument counts; `rest` = idle frames at zoom 1 for reference.
 */
export async function zoomBench({ hz = 165, quiet = false } = {}) {
  const r = canvas.dimensions.sceneRect, cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  canvas.pan({ x: cx, y: cy, scale: 1 }); step(30);
  // Foundry's own hit test under the pointer (PrimarySpriteMesh.containsCanvasPoint -> TextureLoader.getTextureAlphaData) makes ONE
  // 384x256 render texture the first time it meets a texture, i.e. in the first zoom-in over the scene: a createTexture "during" the
  // gesture that is core's, not this module's (traced 2026-11-02). Done here once, before the phases, so `during` shows only our own.
  for ( const m of canvas.primary?.children ?? [] ) { try { m.containsCanvasPoint?.({ x: cx, y: cy }); } catch { /* not a mesh */ } }
  const gesture = (dir, n, ms) => {
    const nf = Math.ceil(ms / (1000 / hz)) + 1, f = Array(nf).fill(0);
    for ( let k = 0; k < n; k++ ) f[Math.min(nf - 1, Math.round((ms * (k / n) ** 1.6) / (1000 / hz)))]++;
    return f.map((c) => (c ? () => { for ( let j = 0; j < c; j++ ) wheelNotch(dir); } : null));
  };
  const idle = (n) => Array(n).fill(null);
  const inst = instrument();
  const out = {};
  let p = null;
  try {
    // (each gesture is followed by 90 idle frames, ~550 ms: work deferred until the zoom settles lands there, after the 30-frame
    // window that counts as the gesture)
    const phase = async (name, frames) => { inst.snap(); const fl = [];
      const rows = await runFrames(frames, { hz, cb: (i) => { fl[i] = inst.frame(); fl[i].zoom = +canvas.stage.scale.x.toFixed(3); } }); const s = inst.snap();
      // the long frames with what ran in them (ms per ticker listener / canvasPan listener, GL counts)
      const spikes = rows.map((x, i) => [i, x.cpu, fl[i], x.gap, x.gc]).filter((x) => x[1] + x[3] > 8).sort((a, b) => b[1] + b[3] - a[1] - a[3]).slice(0, 6)
        .map(([i, ms, f, gap, gc]) => ({ i, ms: +ms.toFixed(1), gap: +gap.toFixed(1), gcMB: +gc.toFixed(1), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v >= 0.5).map(([k, v]) => [k.slice(0, 40), +v.toFixed(1)])) }));
      // GPU-side work started during the gesture (frames with input and the 30 after the last one: ~180 ms of settle)
      const last = frames.reduce((a, f, i) => (f ? i : a), -1);
      // (generateMipmap alone is not counted: PIXI rebuilds a texture's mipmaps on the GPU when its scaleMode changes - the destruction
      // layer's NEAREST / LINEAR switch at 2.6 / 3 screen px per art pixel, 37 small shard atlases, ~0 ms - it is reported as `mips`)
      const heavy = ["createTexture", "texImage2D", "texSubImage2D", "RenderTexture.create", "Texture.from"];
      const during = {}; let mips = 0;
      for ( let i = 0; i <= Math.min(rows.length - 1, last + 30); i++ ) { mips += fl[i]?.generateMipmap ?? 0; for ( const k of heavy ) if ( fl[i]?.[k] ) during[k] = (during[k] ?? 0) + fl[i][k]; }
      out[name] = { frames: rows.length, cost: dist(rows.map((x) => x.cpu + Math.max(0, x.gap - 0.2))), cpu: dist(rows.map((x) => x.cpu)), gap: dist(rows.map((x) => x.gap)),
        input: dist(rows.map((x) => x.input)), gpu: dist(rows.filter((x) => x.gpu !== undefined).map((x) => x.gpu)),
        zoom: +canvas.stage.scale.x.toFixed(3), during, mips, spikes, ...s };
      const c = out[name].cost;
      out[name].pass = c.p99 < 8 && c.max < 16 && c.over33 === 0 && (name === "rest" || !Object.keys(during).length); };
    await phase("rest", idle(165));
    await phase("zoomOut", [...gesture(1, 24, 900), ...idle(90)]);                  // 1 -> ~0.3
    await phase("zoomIn", [...gesture(-1, 46, 1500), ...idle(90)]);                 // 0.3 -> ~3
    await phase("zoomInDeep", [...gesture(-1, 14, 600), ...idle(90)]);              // 3 -> ~6
    await phase("zoomBack", [...gesture(1, 36, 1300), ...idle(90)]);                // 6 -> ~1
    // drag pan: 400 px right and back over 2 s, every frame (a pointer drag pans per pointermove)
    const n = Math.round(2 * hz), x0 = canvas.stage.pivot.x, y0 = canvas.stage.pivot.y;
    await phase("pan", Array.from({ length: n }, (_, i) => () => canvas.pan({ x: x0 + 400 * Math.sin(Math.PI * i / n), y: y0 + 120 * Math.sin(2 * Math.PI * i / n) })));
    // animatePan (as a pan to a pin), there and back with a change of scale
    await phase("animatePan", [() => { p = canvas.animatePan({ x: x0 + 300, y: y0 + 200, scale: 2, duration: 400 }); }, ...idle(80),
      () => { p = canvas.animatePan({ x: x0, y: y0, scale: 1, duration: 400 }); }, ...idle(80)]);
  } finally { inst.restore(); for ( let k = 0; k < 200 && p && CanvasAnimation.animations["canvas.animatePan"]; k++ ) step(1); canvas.pan({ x: cx, y: cy, scale: 1 }); }
  out.pass = Object.values(out).every((v) => v.pass);
  if ( !quiet ) console.log("zoomBench", out);
  return out;
}

/**
 * NIGHT LIGHTS BENCHMARK: `districts` synthetic districts (vertical strips over the scene, style town at full density: up to
 * 900 windows + 360 lamps each, twinkle and switching on) or, with districts = 0, the scene's own districts, forced to night;
 * per frame CPU / GPU (perf) and the lights' own ticker time, against the same frames with the lights off. `grabAt`: a frame of the
 * whole canvas at rest with a frozen clock is returned for A/B (pixels) as `px`.
 */
export async function lightsBench({ districts = 5, n = 165, grabAt = null } = {}) {
  const L = await import("../scripts/lights.mjs"), Dm = await import("../scripts/districts.mjs");
  const r = canvas.dimensions.sceneRect, views = new Map();
  for ( let i = 0; i < districts; i++ ) {
    const x0 = r.x + r.width * i / districts, x1 = r.x + r.width * (i + 1) / districts;
    views.set(`bench${i}`, { data: { id: `bench${i}`, rings: [[x0, r.y, x1, r.y, x1, r.y + r.height, x0, r.y + r.height]],
      lights: { on: "on", own: true, style: "town", density: 1, twinkle: 0.35, switching: 0.25, glow: 0.6, size: 1, warmth: "warm" } }, visible: true, baseAlpha: 1 });
  }
  const run = async (night) => {
    if ( districts ) L.lightsSync(views);
    L.setNightPreview("*", night);
    await runFrames(Array(560).fill(null));                // ~3.4 s of real time: the night fades in completely (to the snap)
    const inst = instrument(); let p;
    try { p = await perf(n); } finally { var s = inst.snap(); inst.restore(); }
    const lt = Object.entries(s.tick).filter(([k]) => /function tick\(\) \{ const dt = Math\.min\(\(canvas/.test(k) || k.includes("lightsTick")).reduce((a, [, v]) => a + v, 0);
    return { cpu: p.cpu, gpu: p.gpu, draws: p.draws, lightsTickMs: +(lt / (n + 5)).toFixed(3) };
  };
  try {
    const on = await run(true);
    const count = L._stats?.() ?? null;
    let px = null;
    if ( grabAt !== null ) {
      // the lights alone (their cores in the primary group, their halos in the illumination layer), each drawn into a screen-sized
      // texture with its world transform, at a frozen clock
      const real = performance.now.bind(performance); performance.now = () => grabAt;
      try {
        step(2);
        const R = canvas.app.renderer, cores = canvas.primary.children.find((c) => c.sortLayer === 251);
        const halos = canvas.effects.illumination.lights.children.find((c) => c.zIndex === 1e6 && c !== cores);
        px = [cores, halos].map((o) => { if ( !o ) return null; const rt = PIXI.RenderTexture.create({ width: R.screen.width, height: R.screen.height });
          R.render(o, { renderTexture: rt, transform: o.parent.worldTransform.clone(), clear: true }); const a = R.extract.pixels(rt); rt.destroy(true); return a; });
      } finally { performance.now = real; }
    }
    const off = await run(false);
    return { districts, lights: count, on, off, px };
  } finally {
    L.setNightPreview("*", false);
    Dm.refreshAllDistricts?.();
  }
}

/**
 * CRISPNESS CHECK (resting damage vs the same damage drawn live, as in an entry frame): at each zoom the destruction layer is drawn
 * with its cache (resting: bands, flattened areas) and with the cache off (live sprites), flood water hidden; over the screen pixels
 * of the damage (either frame opaque) the mean Sobel gradient magnitude of the luma is compared: `ratio` = cached / live. Blurred
 * resting damage (LINEAR-magnified art pixels) shows as a ratio well under 1. Pass: every ratio from zoom 3 up within 10% of 1
 * ("map" before the fix: 0.69 at zoom 4 and 6 - the cache's sharp-bilinear edges against the live layer's NEAREST; after: 1.000).
 * `shards` (default on): also the flattened areas un-flattened into shard sprites (an entry frame's drawing) against their flattened
 * textures: `flatVsShards` = flattened / shards, also within 10%.
 */
export function crispCheck({ zooms = [1, 2, 3, 4, 6], region = null, shards = true } = {}) {
  const d = D(), R = canvas.app.renderer, T = canvas.app.ticker; CONFIG.moinenMaps ??= {};
  const was = CONFIG.moinenMaps.noDestructionCache, mf = T.maxFPS; T.maxFPS = 0;
  if ( !region ) {
    const g = [...d.groups.values()].sort((a, b) => b.pieces.length - a.pieces.length)[0];
    const r = g.info.rect, ap = d.ap, o = d.origin;
    region = { x: o.x + (r.x0 + r.x1) / 2 * ap, y: o.y + (r.y0 + r.y1) / 2 * ap };
  }
  const ws = [];
  for ( const g of d.order ) for ( const ch of g.cont.children ) if ( ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont && ch.visible ) { ch.visible = false; ws.push(ch); }
  const sob = (px, W, H) => { let s = 0, n = 0;
    const L = (x, y) => { const i = (y * W + x) * 4; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };
    const A = (x, y) => px[(y * W + x) * 4 + 3];
    return { at: (x, y) => { const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1);
      const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1); return Math.hypot(gx, gy); }, A }; };
  const rows = [];
  const clock = { real: performance.now.bind(performance), skew: 0 };
  performance.now = () => clock.real() + clock.skew;
  try {
    for ( const z of zooms ) {
      canvas.pan({ x: region.x, y: region.y, scale: z });
      // RESTING: the cache softens its tiles while the scale moves (static-cache.mjs zoomSoft, back to crisp 220 ms after the last
      // change) - the frames are drawn as if a second had passed since the pan, or the softening window would be measured
      CONFIG.moinenMaps.noDestructionCache = false; T.update(performance.now());
      clock.skew += 1000; T.update(performance.now()); T.update(performance.now());
      const mode = d.cache?.stats.mode, a = grab();
      CONFIG.moinenMaps.noDestructionCache = true; T.update(performance.now()); T.update(performance.now());
      const b = grab();
      const W = Math.round(R.screen.width * R.resolution), H = Math.round(R.screen.height * R.resolution);
      const sa = sob(a, W, H), sb = sob(b, W, H);
      let ga = 0, gb = 0, n = 0;
      for ( let y = 1; y < H - 1; y += 2 ) for ( let x = 1; x < W - 1; x += 2 ) {
        if ( sa.A(x, y) < 200 && sb.A(x, y) < 200 ) continue;
        ga += sa.at(x, y); gb += sb.at(x, y); n++;
      }
      const row = { zoom: z, mode, px: n, cached: +(ga / Math.max(1, n)).toFixed(2), live: +(gb / Math.max(1, n)).toFixed(2), ratio: +(ga / Math.max(1e-6, gb)).toFixed(3) };
      if ( shards ) {
        // the flattened areas as shard sprites (as in an entry frame) against the flattened textures (live, cache off)
        const flat = d.order.filter((g) => g.flat);
        for ( const g of flat ) { d.unflatten(g); d.materialize(g, Infinity); }
        T.update(performance.now()); T.update(performance.now());
        const c = grab(), sc = sob(c, W, H); let gc = 0;
        for ( let y = 1; y < H - 1; y += 2 ) for ( let x = 1; x < W - 1; x += 2 ) { if ( sa.A(x, y) < 200 && sb.A(x, y) < 200 ) continue; gc += sc.at(x, y); }
        for ( const g of flat ) d.flatten(g);
        T.update(performance.now());
        Object.assign(row, { shards: +(gc / Math.max(1, n)).toFixed(2), flatVsShards: +(gb / Math.max(1e-6, gc)).toFixed(3) });
      }
      rows.push(row);
    }
  } finally { CONFIG.moinenMaps.noDestructionCache = was; T.update(performance.now()); performance.now = clock.real; T.lastTime = clock.real(); T.maxFPS = mf; ws.forEach((w) => { w.visible = true; }); }
  // judged from zoom 3 up (where the live layer samples NEAREST); below it the cache is a little crisper than the live LINEAR drawing
  return { pass: rows.filter((r) => r.zoom >= 3).every((r) => Math.abs(r.ratio - 1) <= 0.1 && (r.flatVsShards === undefined || Math.abs(r.flatVsShards - 1) <= 0.1)), rows };
}

/**
 * ANIMATION PACING BENCHMARK (the settled scene's continuous animation: painted water loop, cars, pins, lights, flood loops).
 * The canvas ticker is driven through its own requestAnimationFrame callback (`ticker._tick`) with vsync timestamps at `hz`
 * (rAF stubbed, real time kept by busy-waiting), so Foundry's fps cap / the frame pacing gate (scripts/view-smooth.mjs) decide which
 * vsyncs draw - as in a browser on a `hz` display. `pacing`: "foundry" (PIXI's own cap), "even", "display" (the client setting is
 * set for the run and put back). Per drawn frame: its vsync time, CPU; tracked: the painted water's frame (texture), the first
 * visible cars' positions, the pins' body transform. Returns:
 *  - frames: drawn frames, fps, gap CV (stddev / mean of the gaps between drawn frames; 0 = perfectly even), gap kinds in vsyncs;
 *  - water: per shown loop frame how long it stayed on screen (ms): mean, CV, and how many of them were held 1 drawn frame more or
 *    less than the median (the stepped loop's own quantisation);
 *  - cars: per car the screen speed between drawn frames (px per ms) - its CV over the run (constant speed = 0 at even pacing) and
 *    the mean |second difference| of the displacement per vsync (jerk);
 *  - cpu: the drawn frames' CPU distribution.
 */
export async function animBench({ hz = 165, seconds = 3, pacing = "even" } = {}) {
  const T = canvas.app.ticker, per = 1000 / hz, MID = "moinen-maps";
  const was = game.settings.get(MID, "framePacing");
  if ( was !== pacing ) await game.settings.set(MID, "framePacing", pacing);
  const VS = await import("../scripts/view-smooth.mjs");
  VS.applyPacing();
  // the tracked objects
  const water = canvas.primary.children.find((c) => c.sortLayer === 240 && c.children[0] instanceof PIXI.Sprite)?.children[0];
  const cars = []; const walk = (o) => { for ( const c of o.children ?? [] ) { if ( c.constructor.name === "CarSprite" ) { if ( c.visible && c.worldVisible ) cars.push(c); } else walk(c); } };
  walk(canvas.primary); cars.splice(6);
  const pins = canvas.notes.placeables.map((n) => n.children.find((c) => c.constructor.name === "Pin")).filter(Boolean).slice(0, 4);
  // a drawn frame = one that reached the renderer (PIXI's cap returns early inside update())
  const oraf = globalThis.requestAnimationFrame, ou = T.update, R = canvas.app.renderer, orr = R.render; let drew = false, cpu = 0;
  globalThis.requestAnimationFrame = () => 0;
  R.render = function(...a) { drew = true; return orr.apply(this, a); };
  T.update = function(t) { const a = performance.now(); ou.call(this, t); cpu = performance.now() - a; };
  const rows = [];
  const t0 = performance.now(); let t = t0;
  try {
    while ( t - t0 < seconds * 1000 ) {
      t += per;
      until(t);
      drew = false;
      T._tick(t + (Math.random() - 0.5) * 0.3);
      if ( !drew ) continue;
      const g = canvas.stage.worldTransform;
      rows.push({ t, cpu, tex: water?.texture?.baseTexture?.uid ?? null,
        cars: cars.map((c) => { const p = c.getGlobalPosition(); return [p.x, p.y, c.visible]; }),
        pins: pins.map((p) => [p.body.scale.y, p.body.y]) });
    }
  } finally {
    delete T.update; delete R.render; globalThis.requestAnimationFrame = oraf;
    if ( was !== pacing ) await game.settings.set(MID, "framePacing", was);
    VS.applyPacing(); T.start();
  }
  const cv = (a) => { if ( a.length < 2 ) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; const v = a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length; return m ? +(Math.sqrt(v) / m).toFixed(3) : null; };
  const gaps = rows.slice(1).map((r, i) => r.t - rows[i].t), kinds = {};
  for ( const x of gaps ) { const k = Math.round(x / per); kinds[k] = (kinds[k] ?? 0) + 1; }
  // water: hold time of each loop frame (first and last are cut off)
  const holds = []; let since = null;
  for ( let i = 1; i < rows.length; i++ ) if ( rows[i].tex !== rows[i - 1].tex ) { if ( since !== null ) holds.push(rows[i].t - since); since = rows[i].t; }
  const hm = holds.length ? [...holds].sort((a, b) => a - b)[holds.length >> 1] : 0;
  const carStats = cars.map((_, k) => {
    const sp = [], d = [];
    for ( let i = 1; i < rows.length; i++ ) {
      const a = rows[i - 1].cars[k], b = rows[i].cars[k]; if ( !a?.[2] || !b?.[2] ) continue;
      const dist = Math.hypot(b[0] - a[0], b[1] - a[1]); if ( dist > 200 ) continue;           // a respawn
      sp.push(dist / (rows[i].t - rows[i - 1].t)); d.push(dist / Math.max(1, Math.round((rows[i].t - rows[i - 1].t) / per)));
    }
    const jerk = d.slice(1).map((x, i) => Math.abs(x - d[i]));
    return { speedCV: cv(sp.filter((x) => x > 0.005)), meanSpeed: sp.length ? +(sp.reduce((x, y) => x + y, 0) / sp.length).toFixed(4) : 0,
      jerk: jerk.length ? +(jerk.reduce((x, y) => x + y, 0) / jerk.length).toFixed(4) : null };
  }).filter((c) => c.meanSpeed > 0.005);
  return { pacing, hz, frames: rows.length, fps: +(rows.length / seconds).toFixed(1), gapCV: cv(gaps), gapsInVsyncs: kinds,
    water: { frames: holds.length, holdMs: hm ? +hm.toFixed(1) : null, holdCV: cv(holds), off: holds.filter((x) => Math.abs(x - hm) > per / 2).length },
    cars: carStats, cpu: dist(rows.map((r) => r.cpu)) };
}

/** Compact table of a zoomBench result: per phase [frames, zoom, cost p50, p95, p99, max, >6.06 ms, >16.7, >33.3, gpu p50, gpu p95, longest
 * task between frames, pass]; cost = input + ticker + gl.finish + any task that ran between the frames. */
export const table = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.cost).map(([k, v]) => [k, [v.frames, v.zoom, v.cost.p50, v.cost.p95, v.cost.p99, v.cost.max,
  v.cost.over6, v.cost.over16, v.cost.over33, v.gpu.p50, v.gpu.p95, v.gap.max, v.pass ? "PASS" : `FAIL${Object.keys(v.during).length ? ` (gpu work: ${JSON.stringify(v.during)})` : ""}`]]));

/**
 * GAP CHECK: the destruction layer with its cache against the same layer drawn live, over a zoom sweep (mouse-wheel steps from the
 * fit zoom, x1.1 .. x1.25 per step, both ways) and pan offsets. A GAP pixel is one where the cached frame is (nearly) transparent but
 * the live frame shows damage: a crack between cache tiles or bands. Both frames are the RESTING look (restClock: the cache's zoom
 * softening is over) and the live one is `liveGrab` (bands untouched). Measured on "map" 1366x800: 0 at zoom > 1.2, a few dozen scattered
 * rim pixels below 1 (the live layer's NEAREST mask edge against the cache's mipmapped one), 54 / 68 / 125 / 217 worst frame at DPR 1 / 1.25 / 1.5 / 2. Returns per frame the gap count and where they sit
 * (scene x / y histogram peaks), plus the cache's tile rectangles.
 */
export function gapCheck({ steps = [1.1, 1.25], n = 8, offsets = [0, 0.37, 0.71], minAlpha = 96 } = {}) {
  const R = canvas.app.renderer, d = D(), r = canvas.dimensions.sceneRect;
  const fitZ = Math.min(R.screen.width / r.width, R.screen.height / r.height);
  const zooms = new Set([fitZ]);
  for ( const f of steps ) for ( let k = -n; k <= n; k++ ) zooms.add(+(fitZ * f ** k).toFixed(4));
  const ws = [];
  for ( const g of d.order ) for ( const ch of g.cont.children ) if ( ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont && ch.visible ) { ch.visible = false; ws.push(ch); }
  const rows = [], clock = restClock();
  // (the live frame is the same layer drawn from `live` with the cache's bands left alone: switching the cache off freed them, and a
  // shell's pixels come back asynchronously - the first frames after switching it on again lacked areas, hundreds of thousands of "gaps")
  const waiting0 = !!d.cache?.waiting;
  try {
    for ( const z of [...zooms].sort((a, b) => a - b) ) for ( const off of offsets ) {
      canvas.pan({ x: r.x + r.width / 2 + off * 13, y: r.y + r.height / 2 + off * 7, scale: z });
      clock.rest(2); const a = grab();
      const b = liveGrab();
      const M = canvas.primary.worldTransform, k = R.resolution, PW = Math.round(R.screen.width * k);
      let gaps = 0; const hx = new Map(), hy = new Map();
      for ( let i = 0; i < a.length; i += 4 ) {
        if ( b[i + 3] >= minAlpha && a[i + 3] < b[i + 3] - minAlpha ) {
          gaps++;
          const p = i / 4, sx = Math.round(((p % PW) / k - M.tx) / M.a), sy = Math.round((Math.floor(p / PW) / k - M.ty) / M.d);
          hx.set(sx, (hx.get(sx) ?? 0) + 1); hy.set(sy, (hy.get(sy) ?? 0) + 1);
        }
      }
      const top = (h) => [...h].sort((p, q) => q[1] - p[1]).slice(0, 3);
      rows.push({ zoom: +canvas.stage.scale.x.toFixed(4), off, gaps, x: top(hx), y: top(hy) });
    }
  } finally { clock.done(); ws.forEach((w) => { w.visible = true; }); step(1); }
  const tiles = (d.cache?.bands ?? []).flatMap((b) => b.tiles.map((t) => [b.level, +t.x.toFixed(2), +t.y.toFixed(2), +t.w.toFixed(2), +t.h.toFixed(2)]));
  return { frames: rows.length, withGaps: rows.filter((q) => q.gaps).length, total: rows.reduce((a, q) => a + q.gaps, 0), dpr: R.resolution, waiting: waiting0 || !!d.cache?.waiting,
    worst: rows.sort((p, q) => q.gaps - p.gaps).slice(0, 6), tiles };
}

/**
 * WAVING CHECK (temporal): the stage scale is stepped from `from` down to `to` (default: the scene's fit / minimum zoom) in small
 * steps, as a gliding zoom-out draws it; each step the frame that reaches the screen is read twice - with the destruction layer and
 * without it (the map alone) - and both are sampled at fixed SCENE points of a region (bilinear between screen pixels). Per step the
 * change of every sample from the previous step; WAVING = that change over the damaged points, relative to the same change of the
 * map alone at the same points (both are minified alike: the damage should not shimmer more than the map; ratio <= 1.3).
 * SEAMS: for every vertical / horizontal edge of a cache tile, the step-to-step mean deviation of the screen column (row) at that
 * edge from its two neighbours, against the same for a column 5 px away (ratio; > 1.5 is a seam). Returns { ratio, steps, seams, ... }.
 */
export function wavingCheck({ from = 1, to = null, stepSize = 0.005, region = null, grid = 3, maxSteps = 140, beat = true } = {}) {
  const R = canvas.app.renderer, d = D(), T = canvas.app.ticker, sr = canvas.dimensions.sceneRect;
  region ??= { x: sr.x + sr.width * 0.3, y: sr.y + sr.height * 0.3, w: sr.width * 0.4, h: sr.height * 0.4 };
  const cx = region.x + region.w / 2, cy = region.y + region.h / 2;
  // below the canvas's own minimum (another window size or DPR reaches it): the stage is scaled by hand round the same centre
  const setZoom = (z) => {
    canvas.pan({ x: cx, y: cy, scale: z });
    if ( Math.abs(canvas.stage.scale.x - z) > 1e-6 ) { canvas.stage.scale.set(z, z); canvas.stage.pivot.set(cx, cy); canvas.stage.position.set(R.screen.width / 2, R.screen.height / 2); }
  };
  canvas.pan({ x: cx, y: cy, scale: 0.01 }); step(1);
  to ??= canvas.stage.scale.x;                       // what the canvas allows
  const frame = () => { const mf = T.maxFPS; T.maxFPS = 0; T.update(performance.now()); T.maxFPS = mf; R.renderTexture.bind(null); return R.extract.pixels(); };
  const BLK = 24, blocks = [];
  for ( let y = region.y; y + BLK <= region.y + region.h; y += BLK ) for ( let x = region.x; x + BLK <= region.x + region.w; x += BLK ) blocks.push([x, y]);
  let bp = null, bpp = null, bSum = 0, bN = 0;
  const pts = [];
  for ( let y = region.y; y < region.y + region.h; y += grid ) for ( let x = region.x; x < region.x + region.w; x += grid ) pts.push([x, y]);
  const k = R.resolution, PW = Math.round(R.screen.width * k), PH = Math.round(R.screen.height * k);
  const sample = (px) => {
    const M = canvas.stage.worldTransform, out = new Float32Array(pts.length);
    for ( let i = 0; i < pts.length; i++ ) {
      const X = (M.a * pts[i][0] + M.tx) * k - 0.5, Y = (M.d * pts[i][1] + M.ty) * k - 0.5, x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0;
      if ( x0 < 0 || y0 < 0 || x0 + 1 >= PW || y0 + 1 >= PH ) { out[i] = NaN; continue; }
      const L = (x, y) => { const q = (y * PW + x) * 4; return 0.299 * px[q] + 0.587 * px[q + 1] + 0.114 * px[q + 2]; };
      out[i] = (L(x0, y0) * (1 - fx) + L(x0 + 1, y0) * fx) * (1 - fy) + (L(x0, y0 + 1) * (1 - fx) + L(x0 + 1, y0 + 1) * fx) * fy;
    }
    return out;
  };
  const tiles = (d.cache?.bands ?? []).flatMap((b) => b.tiles.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h })));
  const edgeDev = (px, sx, y0, y1, horiz) => {      // mean |c - (l + r) / 2| along a screen column (or row)
    let s = 0, n = 0;
    for ( let t = Math.max(1, y0); t < Math.min(horiz ? PW : PH, y1) - 1; t += 2 ) {
      const at = (a, b) => { const q = ((horiz ? a : b) * PW + (horiz ? b : a)) * 4; return px[q] + px[q + 1] + px[q + 2]; };
      if ( sx < 1 || sx >= (horiz ? PH : PW) - 1 ) continue;
      s += Math.abs(at(sx, t) - (at(sx - 1, t) + at(sx + 1, t)) / 2); n++;
    }
    return n ? s / n : 0;
  };
  let prevD = null, prevM = null, pp = null, ppM = null, eD = 0, eM = 0, nD = 0, steps = 0, jD = 0, jM = 0, nJ = 0;
  const seam = new Map();
  // a frozen clock (water, lights, particles hold still: only the scale changes between steps); dust and embers hidden
  const real = performance.now.bind(performance); let F = real(); performance.now = () => (F += 0.001);
  const fxWas = d.fx.visible; d.fx.visible = false;
  try {
    for ( let z = from; z >= to - 1e-9 && steps < maxSteps; z -= stepSize, steps++ ) {
      setZoom(Math.max(z, to));
      d.objs.visible = true; const full = frame();
      d.objs.visible = false; const map = frame(); d.objs.visible = true;
      const sD = sample(full), sM = sample(map);
      // BEAT: the damage layer alone; per block of the region (fixed in the scene) its fine-detail energy (|pixel - mean of its 4
      // neighbours|): resampled at a scale that drifts, that energy swells and sinks in bands that sweep over the picture (the
      // waving); its second difference over steps, relative to its level
      if ( beat ) {
        const g = grab(), Mb = canvas.primary.worldTransform, BW = PW, BH = PH;
        const Lb = (x, y) => { const q = (y * BW + x) * 4; return g[q] + g[q + 1] + g[q + 2]; };
        const e = new Float32Array(blocks.length);
        blocks.forEach(([bx, by], bi) => {
          const x0 = Math.max(1, Math.round((Mb.a * bx + Mb.tx) * k)), y0 = Math.max(1, Math.round((Mb.d * by + Mb.ty) * k));
          const x1 = Math.min(BW - 1, Math.round((Mb.a * (bx + BLK) + Mb.tx) * k)), y1 = Math.min(BH - 1, Math.round((Mb.d * (by + BLK) + Mb.ty) * k));
          let s2 = 0, n2 = 0;
          for ( let y = y0; y < y1; y++ ) for ( let x = x0; x < x1; x++ ) { s2 += Math.abs(Lb(x, y) - (Lb(x - 1, y) + Lb(x + 1, y) + Lb(x, y - 1) + Lb(x, y + 1)) / 4); n2++; }
          e[bi] = n2 ? s2 / n2 : 0;
        });
        if ( bp && bpp ) for ( let bi = 0; bi < e.length; bi++ ) { const lvl = (e[bi] + bp[bi] + bpp[bi]) / 3; if ( lvl > 2 ) { bSum += Math.abs(e[bi] - 2 * bp[bi] + bpp[bi]) / lvl; bN++; } }
        bpp = bp; bp = e;
      }
      if ( prevD ) for ( let i = 0; i < pts.length; i++ ) {
        if ( Number.isNaN(sD[i]) || Number.isNaN(prevD[i]) ) continue;
        if ( Math.abs(sD[i] - sM[i]) < 6 ) continue;      // no damage at this point
        eD += Math.abs(sD[i] - prevD[i]); eM += Math.abs(sM[i] - prevM[i]); nD++;
        // JITTER: the second difference over three steps - a value gliding with the zoom has little, one that pops back and forth
        // (texels flipping between one and two screen pixels, aliasing) has a lot
        if ( pp && !Number.isNaN(pp[i]) ) { jD += Math.abs(sD[i] - 2 * prevD[i] + pp[i]); jM += Math.abs(sM[i] - 2 * prevM[i] + ppM[i]); nJ++; }
      }
      pp = prevD; ppM = prevM; prevD = sD; prevM = sM;
      // seams at the cache tiles' edges (this step), against a control column 5 px away
      const M = canvas.stage.worldTransform;
      for ( const t of tiles ) for ( const [ex, horiz] of [[t.x, false], [t.x + t.w, false], [t.y, true], [t.y + t.h, true]] ) {
        const s = Math.round(((horiz ? M.d * ex + M.ty : M.a * ex + M.tx)) * k);
        const a0 = Math.round(((horiz ? M.a * t.x + M.tx : M.d * t.y + M.ty)) * k), a1 = Math.round(((horiz ? M.a * (t.x + t.w) + M.tx : M.d * (t.y + t.h) + M.ty)) * k);
        const dev = edgeDev(full, s, a0, a1, horiz), ctl = edgeDev(full, s + 5, a0, a1, horiz) + edgeDev(full, s - 5, a0, a1, horiz);
        const key = `${horiz ? "y" : "x"}=${+ex.toFixed(1)}`, cur = seam.get(key) ?? { dev: 0, ctl: 0, n: 0 };
        cur.dev += dev; cur.ctl += ctl / 2; cur.n++; seam.set(key, cur);
      }
    }
  } finally { d.objs.visible = true; d.fx.visible = fxWas; performance.now = real; }
  const seams = [...seam].map(([k2, v]) => [k2, +(v.dev / Math.max(1e-6, v.ctl)).toFixed(2)]).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return { from, to: +to.toFixed(4), steps, points: nD, damageChange: +(eD / Math.max(1, nD)).toFixed(3), mapChange: +(eM / Math.max(1, nD)).toFixed(3),
    ratio: +(eD / Math.max(1e-6, eM)).toFixed(3), jitter: +(jD / Math.max(1e-6, jM)).toFixed(3), swim: +(jD / Math.max(1, nJ)).toFixed(3), mapSwim: +(jM / Math.max(1, nJ)).toFixed(3), dpr: k, beat: +(bSum / Math.max(1, bN)).toFixed(4), seams, mode: d.cache?.stats.mode, tiles: tiles.length };
}

/**
 * REST CHECK: the destruction layer's own tick with nothing moving (median / mean ms of its tick and of the cache's part over 120
 * stepped frames at zoom 1.2), and the worst frame while a zoom crosses the live layer's NEAREST / LINEAR switch (2.4 <-> 3.4).
 */
export function restCheck() {
  const d = D(), T = canvas.app.ticker, r = canvas.dimensions.sceneRect;
  canvas.pan({ x: r.x + r.width / 2, y: r.y + r.height / 2, scale: 1.2 });
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  let t = performance.now();
  const fm = [], cm = [], sw = [];
  try {
    for ( let i = 0; i < 20; i++ ) { t += 16.7; T.update(t); }
    for ( let i = 0; i < 120; i++ ) { t += 16.7; T.update(t); fm.push(d.stats.frameMs); cm.push(d.stats.cacheMs ?? 0); }
    for ( const [z0, z1] of [[2.4, 3.4], [3.4, 2.4]] ) {
      canvas.pan({ scale: z0 }); for ( let i = 0; i < 5; i++ ) { t += 16.7; T.update(t); }
      let mx = 0;
      for ( let k = 1; k <= 20; k++ ) { canvas.pan({ scale: z0 + (z1 - z0) * k / 20 }); const a = performance.now(); t += 16.7; T.update(t); mx = Math.max(mx, performance.now() - a); }
      sw.push(+mx.toFixed(2));
    }
  } finally { T.maxFPS = mf; if ( st ) T.start(); }
  const avg = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3);
  return { tickMed: med(fm), tickAvg: avg(fm), cacheMed: med(cm), switchMaxFrame: sw, fast: d.cache?.stats.fast ?? null, particles: d.particles.length };
}

/* ---------------------------------------------------------------------------------------------------------------------------------
 * TOKEN EFFECTS and WATER REFLECTIONS benchmarks (many tokens at once).
 * --------------------------------------------------------------------------------------------------------------------------------- */

const TEST_FLAG = "perfBenchToken";

/** `n` throw-away tokens (flag perfBenchToken) in a grid over the scene, each with its own picture when `distinct` (core icons). */
export async function makeTokens(n = 48, { size = 1, distinct = true, rect = null } = {}) {
  const sc = canvas.scene, g = canvas.grid.size, r = rect ?? canvas.dimensions.sceneRect;
  let srcs = [canvas.tokens.placeables.find((t) => t.document.texture.src)?.document.texture.src ?? "icons/svg/mystery-man.svg"];
  if ( distinct ) {
    try { const b = await foundry.applications.apps.FilePicker.implementation.browse("public", "icons/svg"); srcs = b.files.filter((f) => f.endsWith(".svg")); } catch { /* keep the one */ }
  }
  const cols = Math.max(1, Math.floor(r.width / (g * (size + 0.5)))), data = [];
  for ( let i = 0; i < n; i++ ) {
    const cx = i % cols, cy = Math.floor(i / cols);
    data.push({ name: `bench${i}`, x: Math.round(r.x + (cx + 0.25) * g * (size + 0.5)), y: Math.round(r.y + (cy + 0.25) * g * (size + 0.5)), width: size, height: size,
      texture: { src: srcs[i % srcs.length] }, disposition: 0, flags: { [MODULE]: { [TEST_FLAG]: true, fx: { enterStyle: "none", leaveStyle: "none", deathStyle: "none", idleStyle: "none" } } } });
  }
  const docs = await sc.createEmbeddedDocuments("Token", data, { animate: false });
  await new Promise((res) => setTimeout(res, 1500)); step(30);
  return docs.length;
}
const MODULE = "moinen-maps";

export async function dropTokens() {
  const ids = canvas.scene.tokens.filter((t) => t.getFlag(MODULE, TEST_FLAG)).map((t) => t.id);
  if ( ids.length ) await canvas.scene.deleteEmbeddedDocuments("Token", ids, { animate: false });
  await new Promise((res) => setTimeout(res, 500)); step(10);
  return ids.length;
}
const benchTokens = () => canvas.tokens.placeables.filter((t) => t.document.getFlag(MODULE, TEST_FLAG));

/**
 * TOKEN EFFECTS BENCH: all bench tokens play the same effect at once (the worst case: a burst of 25+ is staggered by the module in
 * play, here every token starts together through the preview API). Per case: frame cost (cpu = ticker + gl.finish, gap = tasks between
 * frames), GPU, draw calls per frame, live particles (peak), heap growth (sum of the frames' positive heap steps, MB per second: a
 * lower bound of allocation), GCs seen. `cases`: [["enter","fade"], ...] (default: every style of every kind + idle styles + rest).
 */
export async function tokenFxBench({ hz = 60, cases = null, ms = 1600 } = {}) {
  const Fx = await import("../scripts/tokens/fx.mjs"), Px = await import("../scripts/tokens/pixels.mjs"), St = await import("../scripts/tokens/styles.mjs");
  const toks = benchTokens(); if ( !toks.length ) throw new Error("makeTokens() first");
  cases ??= [["rest", "-"],
    ...Object.keys(St.ENTER_STYLES).filter((s) => !St.ENTER_STYLES[s].legacy && s !== "none").map((s) => ["enter", s]),
    ...Object.keys(St.LEAVE_STYLES).filter((s) => !St.LEAVE_STYLES[s].legacy && s !== "none").map((s) => ["leave", s]),
    ...Object.keys(St.DEATH_STYLES).filter((s) => s !== "none").map((s) => ["death", s]),
    ...Object.keys(St.IDLE_STYLES).filter((s) => s !== "none").map((s) => ["idle", s])];
  const out = [], inst = instrument();
  const settle = async () => { for ( let k = 0; k < 400; k++ ) { const s = Fx._tokenFx(); if ( !s.rigs && !s.extras ) break; await runFrames(Array(6).fill(null), { hz }); } };
  try {
    for ( const [kind, style] of cases ) {
      await settle(); await runFrames(Array(20).fill(null), { hz });
      // cells of the pictures are sampled on first use (a readback): a first pass warms them, not measured
      const start = () => { if ( kind === "rest" ) return; for ( const t of toks ) { if ( kind === "leave" ) { Fx.preview(t, "leave", style); } else Fx.preview(t, kind, style); } };
      let peak = 0, gcs = 0, grow = 0, prevH = performance.memory?.usedJSHeapSize ?? 0; const fl = [];
      inst.snap();
      const nf = Math.round(ms / (1000 / hz));
      const frames = Array.from({ length: nf }, (_, i) => (i === 2 ? start : null));
      const rows = await runFrames(frames, { hz, cb: (i) => {
        peak = Math.max(peak, Px.liveParticles()); const h = performance.memory?.usedJSHeapSize ?? 0; if ( h > prevH ) grow += h - prevH; prevH = h; fl[i] = inst.frame(); } });
      const s = inst.snap();
      for ( const r of rows ) if ( r.gc ) gcs++;
      const meas = rows.slice(3), dr = fl.slice(3).map((f) => (f.drawElements ?? 0) + (f.drawArrays ?? 0));
      const worst = meas.map((r, i) => [i + 3, r.cpu + Math.max(0, r.gap - 0.2), fl[i + 3]]).sort((a, b) => b[1] - a[1])[0];
      out.push({ kind, style, cost: dist(meas.map((r) => r.cpu + Math.max(0, r.gap - 0.2))), cpu: dist(meas.map((r) => r.cpu)), gpu: dist(meas.filter((r) => r.gpu !== undefined).map((r) => r.gpu)),
        draws: pct(dr, 0.5), drawsMax: Math.max(...dr), peakParticles: peak, heapMBps: +(grow / 1048576 / (ms / 1000)).toFixed(2), gcs,
        tick: Object.fromEntries(Object.entries(s.tick).filter(([k]) => /tick@/.test(k) || /fx|Rig|Emitter/.test(k)).slice(0, 3).map(([k, v]) => [k.slice(0, 40), +(v / nf).toFixed(3)])),
        glWorst: worst ? Object.fromEntries(Object.entries(worst[2]).filter(([, v]) => v >= 1).map(([k, v]) => [k.slice(0, 24), +v.toFixed(1)])) : null });
    }
  } finally { inst.restore(); await settle(); }
  return out;
}

/** A compact table of tokenFxBench rows: [kind/style, p50, p95, max cost ms, gpu p50, draws, peak particles, MB/s, GCs]. */
export const fxTable = (rows) => rows.map((r) => [`${r.kind}/${r.style}`, r.cost.p50, r.cost.p95, r.cost.max, r.gpu.p50, r.draws, r.peakParticles, r.heapMBps, r.gcs].join("\t")).join("\n");

/**
 * REFLECTION BENCH (scripts/water/reflect.mjs): the painted water's masks are filled with water (in memory only: nothing is saved) so
 * every bench token (makeTokens(n, { size }) first) stands in water; per blur type the same frames with reflections off and on:
 * frame cost (cpu = ticker + gl.finish + the tasks between frames), the reflection ticker's own time per frame (mean and worst frame:
 * every token redraws its canvases every 90 ms, staggered), texture uploads per frame. `reflect`: the params laid over the scene's.
 */
export async function reflectBench({ hz = 60, ms = 3000, blurs = ["none", "3x3", "9x9", "17x17"], reflect = {} } = {}) {
  const W = await import("../scripts/water/water.mjs"), s = W.state(); if ( !s ) throw new Error("no water on this scene");
  const toks = benchTokens(); if ( !toks.length ) throw new Error("makeTokens() first");
  const was = { water: Uint8Array.from(s.masks.water), fall: Uint8Array.from(s.masks.fall), p: { ...s.params } };
  s.masks.water.fill(1); s.masks.fall.fill(0);
  Hooks.callAll("moinenMapsWater", "edited");
  const inst = instrument(), out = [];
  const run = async (label, over) => {
    Object.assign(s.params, { reflectOn: false }, over);
    Hooks.callAll("moinenMapsWater", "edited");
    await runFrames(Array(40).fill(null), { hz });
    inst.snap();
    const nf = Math.round(ms / (1000 / hz)), fl = [];
    const rows = await runFrames(Array(nf).fill(null), { hz, cb: (i) => { fl[i] = inst.frame(); } });
    const sn = inst.snap();
    const rt = Object.entries(sn.tick).find(([k]) => /\(\) => onTick\(\)/.test(k) && !/@-/.test(k))?.[1] ?? 0;
    const cost = rows.map((r) => r.cpu + Math.max(0, r.gap - 0.2));
    out.push({ label, cost: dist(cost), gpu: dist(rows.filter((r) => r.gpu !== undefined).map((r) => r.gpu)), uploads: +((sn.gl.texImage2D ?? 0) + (sn.gl.texSubImage2D ?? 0)) / nf,
      tickMsPerFrame: +(rt / nf).toFixed(3), draws: pct(fl.map((f) => f.drawElements ?? 0), 0.5) });
  };
  try {
    await run("off", { reflectOn: false });
    for ( const b of blurs ) await run(`on blur=${b}`, { reflectOn: true, reflectBlurType: b, ...reflect });
  } finally {
    inst.restore();
    s.masks.water.set(was.water); s.masks.fall.set(was.fall);
    for ( const k of Object.keys(s.params) ) if ( !(k in was.p) ) delete s.params[k];
    Object.assign(s.params, was.p);
    Hooks.callAll("moinenMapsWater", "edited"); step(5);
  }
  return out;
}

/**
 * REFLECTION PIXELS: the reflections' canvases (every bench token and the scene's own, water everywhere, `blur`, `reflect` params) at a
 * frozen clock, as a hash per token and a hash of all: run it on two builds of reflect.mjs and compare (the output must be equal).
 * Returns { n, all, per: [hash...] } (FNV-1a over the canvas bytes).
 */
export async function reflectHash({ blur = "none", reflect = {}, keep = false } = {}) {
  const W = await import("../scripts/water/water.mjs"), s = W.state(); if ( !s ) throw new Error("no water on this scene");
  const T = canvas.app.ticker, mf = T.maxFPS, st = T.started, real = performance.now.bind(performance); CONFIG.moinenMaps ??= {};
  const wasB = CONFIG.moinenMaps.reflectBudgetMs, was = { water: Uint8Array.from(s.masks.water), fall: Uint8Array.from(s.masks.fall), p: { ...s.params } };
  T.maxFPS = 0; T.stop(); CONFIG.moinenMaps.reflectBudgetMs = 1e9;
  s.masks.water.fill(1); s.masks.fall.fill(0);
  s.params.reflectOn = false; T.update(real());          // the layer's canvases of a run before are dropped
  Object.assign(s.params, { reflectOn: true, reflectBlurType: blur, ...reflect }); Hooks.callAll("moinenMapsWater", "edited");
  let F = Math.ceil((real() + 1000) / 1440) * 1440; performance.now = () => F;
  const rnd = Math.random; let seed = 424242; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };   // (scan jumps, token phases)      // (a multiple of the water loop: the same ripple phase in every run)
  try {
    for ( let i = 0; i < 4; i++ ) { F += 200; T.update(F); }
    const root = canvas.primary.children.find((c) => c.sortLayer === 248), per = [];
    const fnv = (b) => { let h = 2166136261; for ( let i = 0; i < b.length; i++ ) { h ^= b[i]; h = Math.imul(h, 16777619) >>> 0; } return h; };
    for ( const spr of root.children ) {
      const c = spr.texture?.baseTexture?.resource?.source; if ( !(c instanceof HTMLCanvasElement) || c.width < 3 ) continue;
      per.push(`${c.width}x${c.height}:${fnv(c.getContext("2d").getImageData(0, 0, c.width, c.height).data).toString(16)}${spr.visible ? "" : "!"}`);
    }
    // (sorted: the order of the canvases follows the tokens' order, which depends on their random ids - two makeTokens() runs gave the same canvases in another order)
    per.sort();
    const out = { n: per.length, all: fnv(new TextEncoder().encode(per.join(","))).toString(16), per };
    if ( keep ) {      // the raw bytes of every reflection canvas (not the mask), as one string per canvas (latin-1) for a diff between builds
      out.raw = root.children.map((spr) => spr.texture?.baseTexture?.resource?.source).filter((c) => c instanceof HTMLCanvasElement && c.width < 1000)
        .map((c) => String.fromCharCode.apply(null, c.getContext("2d").getImageData(0, 0, c.width, c.height).data));
    }
    return out;
  } finally {
    performance.now = real; Math.random = rnd; CONFIG.moinenMaps.reflectBudgetMs = wasB;
    s.masks.water.set(was.water); s.masks.fall.set(was.fall);
    for ( const k of Object.keys(s.params) ) if ( !(k in was.p) ) delete s.params[k];
    Object.assign(s.params, was.p); Hooks.callAll("moinenMapsWater", "edited"); s.params.reflectOn = false; T.update(real()); Object.assign(s.params, was.p); T.maxFPS = mf; if ( st ) T.start();
  }
}

/* ---------------------------------------------------------------------------------------------------------------------------------
 * DISPLAY SCALE and WINDOW SIZE (the built-in pane: resize_window sets the window, this sets the pixel ratio).
 * --------------------------------------------------------------------------------------------------------------------------------- */

/** Emulate a display's pixel ratio: window.devicePixelRatio and the renderer's resolution (what Foundry reads at start-up), then a resize. */
export async function setDPR(r) {
  Object.defineProperty(window, "devicePixelRatio", { get: () => r, configurable: true });
  const R = canvas.app.renderer;
  R.resolution = r; R.resize(innerWidth, innerHeight); window.dispatchEvent(new Event("resize"));
  // (the destruction cache draws its bands again at the new resolution a few frames later, and the first frames build the filters'
  // textures: settled here, else they land in the first phase of whatever is measured next and read as a rest spike)
  await new Promise((res) => setTimeout(res, 1500)); step(90); await new Promise((res) => setTimeout(res, 600));
  return { dpr: R.resolution, css: [R.screen.width, R.screen.height], backing: [R.view.width, R.view.height] };
}

/**
 * GPU MEMORY (an estimate): every texture PIXI keeps on the GPU (renderer.texture.managedTextures), in MB at 4 bytes a texel (+1/3 when
 * mipmapped), split into render textures (the static cache's bands, flattened areas, composite tiles, the primary group and filters'
 * pools) and the rest; plus the biggest ten. `cache` = the destruction cache's own count (mpx).
 */
export function texMem(top = 8) {
  const R = canvas.app.renderer, list = [];
  for ( const bt of R.texture.managedTextures ) {
    const px = bt.realWidth * bt.realHeight, mb = px * 4 * (bt.mipmap === PIXI.MIPMAP_MODES.ON && PIXI.utils.isPow2(bt.width) ? 4 / 3 : bt.mipmap === PIXI.MIPMAP_MODES.ON ? 4 / 3 : 1) / 1048576;
    list.push({ mb, w: bt.realWidth, h: bt.realHeight, rt: !!bt.framebuffer || bt.resource === null && bt.valid && !bt.resource, res: bt.resolution });
  }
  const sum = (a) => +a.reduce((s, x) => s + x.mb, 0).toFixed(1);
  const d = D();
  return { total: sum(list), rt: sum(list.filter((x) => x.rt)), plain: sum(list.filter((x) => !x.rt)), n: list.length,
    top: list.sort((a, b) => b.mb - a.mb).slice(0, top).map((x) => `${x.w}x${x.h}${x.rt ? " rt" : ""} ${x.mb.toFixed(1)}MB`), cache: { ...d?.cache?.stats }, heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576) };
}

/**
 * BADGE CHECK (tokens/fx.mjs corpse badges): the cracks and the skull drawn as one Graphics (now) and as a Sprite per pixel
 * (CONFIG.moinenMaps.spritePx = true, the old way), each into a texture at several zooms (and a half-way crack for the petrify
 * animation); per zoom [mean |d| per channel, max, channels off by more than 2]. All 0 is a pass.
 */
export async function badgeCheck({ zooms = [1, 1.37, 2, 3.3, 0.6], seeds = [12345, 777] } = {}) {
  const F = await import("../scripts/tokens/fx.mjs"), R = canvas.app.renderer; CONFIG.moinenMaps ??= {};
  const g = canvas.grid.size, ap = Math.max(2, Math.round(g / 32)), W = g * 2, H = g * 2, was = CONFIG.moinenMaps.spritePx, rows = [];
  const draw = (sprites, z, seed, upto) => {
    CONFIG.moinenMaps.spritePx = sprites;
    const box = new PIXI.Container(); F._badges.drawCracks(box, W, H, seed, ap, upto); F._badges.drawSkull(box, Math.round((W - 9 * ap) / ap) * ap, ap * 2, ap);
    box.scale.set(z);
    const rt = PIXI.RenderTexture.create({ width: Math.ceil(W * z) + 2, height: Math.ceil(H * z) + 2 });
    R.render(box, { renderTexture: rt, clear: true }); const px = R.extract.pixels(rt); rt.destroy(true); box.destroy({ children: true }); return px;
  };
  try {
    for ( const seed of seeds ) for ( const upto of [1, 0.6] ) for ( const z of zooms ) {
      const a = draw(true, z, seed, upto), b = draw(false, z, seed, upto); let s = 0, m = 0, bad = 0, ink = 0;
      for ( let i = 0; i < a.length; i++ ) { const d = Math.abs(a[i] - b[i]); s += d; if ( d > m ) m = d; if ( d > 2 ) bad++; if ( i % 4 === 3 && a[i] ) ink++; }
      rows.push([seed, upto, z, +(s / a.length).toFixed(4), m, bad, ink]);
    }
  } finally { CONFIG.moinenMaps.spritePx = was; }
  return rows;
}

/**
 * CULL BENCH: what the GM's composite publish costs on the page (round 2): the bands' texels read back (readPixels), then the cull
 * (the page, or the codec worker when `Composite.cullJob` exists). Returns { bands, tiles, mpx, readMs, cullMs, cleared, eff }; nothing is uploaded.
 */
export async function cullBench() {
  const Comp = await import("../scripts/destruction/composite.mjs");
  const d = D(), C = d.cache, R = canvas.app.renderer, gl = R.gl;
  const bands = C.bands.filter((b) => b.ckey && b.tiles.length), all = [];
  const t0 = performance.now();
  for ( const b of bands ) for ( const t of b.tiles ) {
    const bt = t.rt.baseTexture, w = bt.realWidth, h = bt.realHeight;
    if ( t.shared && t.id && bt.resource?.data ) { all.push({ L: b.meta.L, x: t.x, y: t.y, w, h, data: bt.resource.data.slice(), fresh: true }); continue; }
    const out = new Uint8Array(w * h * 4);
    R.renderTexture.bind(t.rt); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out); R.renderTexture.bind(null);
    all.push({ L: b.meta.L, x: t.x, y: t.y, w, h, data: out, fresh: true });
  }
  const readMs = performance.now() - t0, t1 = performance.now();
  const effOne = bands.every((b) => b.meta.eff === 1);
  const cleared = effOne ? Comp.cull(all) : -1;
  return { bands: bands.length, tiles: all.length, mpx: +(all.reduce((a, q) => a + q.w * q.h, 0) / 1e6).toFixed(2), readMs: +readMs.toFixed(1), cullMs: +(performance.now() - t1).toFixed(1), cleared, effOne };
}

/**
 * NET CHECK: the downloads of this session so far, by kind of chunk (d stroke, w water, k composite tile, x index, b bundle). `load`: the
 * requests made until the background read-ahead of the strokes near the view starts (the reveal + 2.4 s; destruction.mjs prefetchNear), the
 * ones a scene needs to be shown; `requests` / `kinds`: all of them. Open the scene with a cold IndexedDB first (see coldReload).
 */
export async function netCheck() {
  const Net = await import("../scripts/net/stream.mjs");
  const tr = game.modules.get("moinen-maps").api.destruction.net.trace();
  const rv = tr.marks.find((m) => m.name === "reveal")?.t ?? null, cut = rv === null ? Infinity : tr.t0 + rv + 2400;
  const by = (list) => { const kinds = {}; for ( const r of list ) { const k = r.id[0]; kinds[k] ??= { n: 0, kb: 0 }; kinds[k].n++; kinds[k].kb += r.bytes / 1024; } for ( const k of Object.values(kinds) ) k.kb = Math.round(k.kb); return kinds; };
  const early = Net.reqLog.filter((r) => r.t <= cut);
  return { requests: Net.stats.requests, bytesDown: Net.stats.bytesDown, idbHits: Net.stats.idbHits, memHits: Net.stats.memHits, kinds: by(Net.reqLog),
    load: { requests: early.length, kb: Math.round(early.reduce((a, r) => a + r.bytes, 0) / 1024), kinds: by(early) }, revealMs: rv };
}

/** Forget the chunks IndexedDB holds and reload the page (a cold client). */
export async function coldReload() {
  await new Promise((res) => { const r = indexedDB.deleteDatabase("moinen-maps-chunks"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  setTimeout(() => location.reload(), 100);
}

/**
 * PUBLISH BENCH (dry): the GM's composite publish up to the packed tiles, nothing uploaded or written: `pageMs` (the page: texel readback,
 * the index, handing the texels to the codec worker - the part that holds the page), `jobMs` (the worker: cull + pack + deflate, off the page),
 * `cleared` texels, and the longest long task the page saw meanwhile. Every tile is read back (`fresh`), as for a first publish.
 */
export async function publishBench() {
  const Comp = await import("../scripts/destruction/composite.mjs"), d = D(), scene = canvas.scene;
  let long = 0; const obs = new PerformanceObserver((l) => { for ( const e of l.getEntries() ) long = Math.max(long, e.duration); });
  try { obs.observe({ type: "longtask" }); } catch { /* none */ }
  const r = await Comp.publish(d, { scene, dir: `worlds/${game.world.id}/moinen-maps/c/${scene.id}`, base: "bench", strokes: [], dry: true, fresh: true });
  await new Promise((res) => setTimeout(res, 120)); obs.disconnect();
  return typeof r === "object" ? { ...r, longTaskMs: Math.round(long) } : r;
}

/**
 * LIGHTS A/B: synthetic town districts forced to night; the lights' cores and halos drawn alone at a frozen clock, at the whole-scene view
 * and zoomed into a corner (where per-light culling skips lights), as an FNV hash + count of the screen pixels each. Run on two builds and
 * compare the hashes. Also the build time of lightsSync (ms; the call returns before a sliced build is done) and how long the lights take
 * to be all built. Returns { build: { callMs, doneMs, lights }, shots: { whole: [coreHash, haloHash], zoom: [...] } }.
 */
export async function lightsAB({ districts = 5, at = 123456, zoom = 2.6 } = {}) {
  const L = await import("../scripts/lights.mjs"), Dm = await import("../scripts/districts.mjs");
  const r = canvas.dimensions.sceneRect, views = new Map();
  for ( let i = 0; i < districts; i++ ) {
    const x0 = r.x + r.width * i / districts, x1 = r.x + r.width * (i + 1) / districts;
    views.set(`bench${i}`, { data: { id: `bench${i}`, rings: [[x0, r.y, x1, r.y, x1, r.y + r.height, x0, r.y + r.height]],
      lights: { on: "on", own: true, style: "town", density: 1, twinkle: 0.35, switching: 0.25, glow: 0.6, size: 1, warmth: "warm" } }, visible: true, baseAlpha: 1 });
  }
  const hash = (a) => { let h = 2166136261, nz = 0; for ( let i = 0; i < a.length; i++ ) { h = Math.imul(h ^ a[i], 16777619); if ( a[i] ) nz++; } return `${(h >>> 0).toString(16)}/${nz}`; };
  const out = { build: null, shots: {} };
  try {
    const t0 = performance.now(); L.lightsSync(views); const callMs = performance.now() - t0;
    L.setNightPreview("*", true);
    await runFrames(Array(560).fill(null));                // the night fades in completely
    const lights = L._stats().lights;
    out.build = { callMs: +callMs.toFixed(1), lights };
    const real = performance.now.bind(performance);
    for ( const [name, scale, fx, fy] of [["whole", fit(), 0.5, 0.5], ["zoom", zoom, 0.22, 0.3]] ) {
      canvas.pan({ x: r.x + r.width * fx, y: r.y + r.height * fy, scale: name === "whole" ? fit() : scale });
      await runFrames(Array(30).fill(null));
      performance.now = () => at;
      try {
        step(2);
        const R = canvas.app.renderer, cores = canvas.primary.children.find((c) => c.sortLayer === 251);
        const halos = canvas.effects.illumination.lights.children.find((c) => c.zIndex === 1e6 && c !== cores);
        out.shots[name] = [cores, halos].map((o) => { if ( !o ) return null; const rt = PIXI.RenderTexture.create({ width: R.screen.width, height: R.screen.height });
          R.render(o, { renderTexture: rt, transform: o.parent.worldTransform.clone(), clear: true }); const a = R.extract.pixels(rt); rt.destroy(true); return hash(a); });
      } finally { performance.now = real; }
    }
  } finally {
    L.setNightPreview("*", false); L.lightsSync(new Map()); Dm.refreshAllDistricts?.(); fit();
  }
  return out;
}

/**
 * REBAKE BENCH: "Rebake all" over `ids` (default: the strokes in an older look) with a gap detector (a 4 ms timer: a gap over 30 ms is the
 * page held by something), the JS heap sampled every 50 ms, and the bake pool's per-lane peak (Trace "prime-lanes": Mpx of plain looks
 * a lane held at most, x4 bytes of RGBA). Waits for status.rebake to end. Returns { strokes, seconds, gaps: { n, max, over100, top },
 * heapMB: { start, peak }, lanes, events }.
 */
export async function rebakeBench({ ids = null, maxS = 420, tailS = 12 } = {}) {
  const A = game.modules.get("moinen-maps").api.destruction, Trace = A.net.trace;
  const list = ids ?? A.status().olderLook?.ids ?? [];
  const gaps = [], tail = [], loaf = []; let last = performance.now(), peak = 0, inTail = false;
  const heap = () => (performance.memory?.usedJSHeapSize ?? 0) / 1048576;
  const start = heap();
  const gi = setInterval(() => { const n = performance.now(), g = n - last; if ( g > 30 ) (inTail ? tail : gaps).push(Math.round(g)); last = n; }, 4);
  const hi = setInterval(() => { peak = Math.max(peak, heap()); }, 50);
  // long animation frames name the scripts in them (needs the pane fronted: a hidden page has no frames)
  let po = null;
  try { po = new PerformanceObserver((l) => { for ( const e of l.getEntries() ) if ( e.duration >= 80 ) loaf.push({ ms: Math.round(e.duration), scripts: e.scripts.map((q) => `${(q.sourceURL || "").split("/").slice(-1)[0]}@${q.sourceCharPosition}:${Math.round(q.duration)}`).join(" | ").slice(0, 200) }); }); po.observe({ type: "long-animation-frame" }); } catch { /* not offered */ }
  const evBefore = Trace().events.length, t0 = performance.now();
  try {
    A.rebakeAll(list);
    while ( performance.now() - t0 < maxS * 1000 ) {
      await new Promise((r) => setTimeout(r, 250));
      const st = A.status({ fast: true });   // (the full status hashes every record's pixels: ~300 ms, a gap of the bench's own making)
      if ( !st.rebake && performance.now() - t0 > 1500 ) break;
    }
    // the publish, the composite and the early-stored strokes' last swaps follow the pass: gaps there count apart (`tail`)
    inTail = true; await new Promise((r) => setTimeout(r, tailS * 1000));
  } finally { clearInterval(gi); clearInterval(hi); po?.disconnect(); }
  const ev = Trace().events.slice(evBefore).filter((e) => /rebake|prime-lanes|bake-lanes|publish|composite-published/.test(e.reason)).map((e) => ({ r: e.reason, ...(e.data ?? {}) }));
  const top = (a) => [...a].sort((x, y) => y - x).slice(0, 12), sum = (a) => ({ n: a.length, max: top(a)[0] ?? 0, over100: a.filter((g) => g > 100).length, top: top(a) });
  return { strokes: list.length, seconds: Math.round((performance.now() - t0) / 100) / 10, gaps: sum(gaps), tail: sum(tail), loaf: loaf.slice(0, 10),
    heapMB: { start: Math.round(start), peak: Math.round(peak), end: Math.round(heap()) }, events: ev.slice(-8) };
}

/**
 * GM vs PLAYER PICTURE (the players must see exactly what the GM sees): run `blockMeans()` on the GM's page and on a COLD player's page
 * (another origin, e.g. 127.0.0.2 / 127.0.0.3, so another IndexedDB; both pages with the same window size) after `boot()`, then compare
 * the two lists with `blockDiff(a, b)`. The destruction layer is drawn live at the whole-scene view and read in `bw` x `bh` px blocks
 * (RGBA mean per block); the water of flooded holes loops with the clock, so the clock is frozen for the grab.
 * Sequence of the regression (diverge-fix): GM `api.destruction.detonate()` -> GM reload -> `rebakeAll(ids of every stroke)` -> a cold
 * player loads -> `blockDiff` max <= 8.
 */
export function blockMeans({ bw = 32, bh = 24, live = false, region = null } = {}) {
  // the whole scene drawn with a transform of its own (the canvas's pan is not used: a player cannot zoom out as far as the GM, and
  // innerWidth / innerHeight of a background tab need not match the renderer)
  const R = canvas.app.renderer, sr = region ?? canvas.dimensions.sceneRect, W = Math.round(R.screen.width * R.resolution), H = Math.round(R.screen.height * R.resolution);
  const sc = Math.min(W / sr.width, H / sr.height), m = new PIXI.Matrix(sc, 0, 0, sc, Math.round((W - sr.width * sc) / 2 - sr.x * sc), Math.round((H - sr.height * sc) / 2 - sr.y * sc));
  const real = performance.now.bind(performance), at = real();
  performance.now = () => at;
  let px;
  try {
    step(3);
    const d = D(), sh = d.cache?.show, sv = sh?.visible, lv = d.live.visible;
    if ( live ) { if ( sh ) sh.visible = false; d.live.visible = true; }
    const rt = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1 });
    try { R.render(d.objs, { renderTexture: rt, transform: m, clear: true }); px = R.extract.pixels(rt); }
    finally { rt.destroy(true); if ( live ) { if ( sh ) sh.visible = sv; d.live.visible = lv; } }
  } finally { performance.now = real; canvas.app.ticker.lastTime = real(); }
  const nx = Math.ceil(W / bw), ny = Math.ceil(H / bh), out = new Array(nx * ny * 4).fill(0), cnt = new Array(nx * ny).fill(0);
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    const b = (Math.floor(y / bh) * nx + Math.floor(x / bw)), i = (y * W + x) * 4;
    cnt[b]++; for ( let c = 0; c < 4; c++ ) out[b * 4 + c] += px[i + c];
  }
  for ( let b = 0; b < nx * ny; b++ ) for ( let c = 0; c < 4; c++ ) out[b * 4 + c] = Math.round(out[b * 4 + c] / cnt[b] * 10) / 10;
  // (packed: one byte a channel mean as base64, so a result can be carried from one page to the other as one short string)
  return { nx, ny, bw, bh, packed: btoa(String.fromCharCode(...out.map((v) => Math.min(255, Math.round(v))))) };
}

/** Compare two `blockMeans()` results (JSON from the two pages): the largest per-channel block difference and how many blocks differ by more than `over`. */
export function blockDiff(a, b, over = 8) {
  if ( a.packed.length !== b.packed.length ) return { error: "different sizes", a: [a.nx, a.ny], b: [b.nx, b.ny] };
  const A = Uint8Array.from(atob(a.packed), (c) => c.charCodeAt(0)), B = Uint8Array.from(atob(b.packed), (c) => c.charCodeAt(0));
  let max = 0, n = 0, worst = null;
  for ( let k = 0; k < A.length; k += 4 ) {
    let m = 0; for ( let c = 0; c < 4; c++ ) m = Math.max(m, Math.abs(A[k + c] - B[k + c]));
    if ( m > over ) n++;
    if ( m > max ) { max = m; worst = [(k / 4) % a.nx, Math.floor(k / 4 / a.nx)]; }
  }
  return { max: +max.toFixed(1), blocksOver: n, over, worst };
}

/** The views a GM-vs-player comparison looks at: the whole scene and its four quarters (2x), as scene rectangles. */
export function divergeViews() {
  const r = canvas.dimensions.sceneRect, hw = r.width / 2, hh = r.height / 2;
  return [null, ...[0, 1].flatMap((j) => [0, 1].map((i) => ({ x: r.x + i * hw, y: r.y + j * hh, width: hw, height: hh })))];
}

/** GM: `blockMeans()` of every view (divergeViews, drawn as shown and drawn live) uploaded to the world folder as `<name>.json` (the lane servers' test world), so another origin can compare. */
export async function shareMeans(name = "diverge-gm", opts = {}) {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const out = divergeViews().map((region) => ({ region, shown: blockMeans({ ...opts, region }), live: blockMeans({ ...opts, region, live: true }) }));
  await FP.upload("data", `worlds/${game.world.id}`, new File([JSON.stringify(out)], `${name}.json`, { type: "application/json" }), {}, { notify: false });
  return { name, views: out.length };
}

/**
 * Player: this page's views against the GM's `shareMeans(name)`: { shown: { max, blocksOver }, live: { max, blocksOver } | null, shells, views } (the
 * regression bar: shown.max <= 8; live is the areas' own pixels drawn without the cache - null while areas are still shells, which have none).
 * `views`: [{ i, shown: [max, blocks], live: [max, blocks] }].
 */
export async function diffShared(name = "diverge-gm", opts = {}) {
  const gm = await (await fetch(`/worlds/${game.world.id}/${name}.json?${Date.now()}`)).json();
  const shells = D()?.shellCount ?? 0, res = { shown: { max: 0, blocksOver: 0 }, live: shells ? null : { max: 0, blocksOver: 0 }, shells, views: [] };
  gm.forEach((g, i) => {
    const sh = blockDiff(g.shown, blockMeans({ ...opts, region: g.region })), lv = shells ? null : blockDiff(g.live, blockMeans({ ...opts, region: g.region, live: true }));
    for ( const [k, d] of [["shown", sh], ["live", lv]] ) if ( d ) { res[k].max = Math.max(res[k].max, d.max); res[k].blocksOver += d.blocksOver; }
    res.views.push({ i, shown: [sh.max, sh.blocksOver], live: lv ? [lv.max, lv.blocksOver] : null });
  });
  return res;
}

/**
 * GM side of the regression "Detonate -> reload -> Rebake all -> a cold player loads" (the player: \`boot()\` then \`diffShared(name)\`, bar
 * shown.max <= 8): on the GM's page, after \`detonate()\` and a reload (\`boot()\` first), this rebakes every stroke, waits for the pass, the publish and
 * the settled composite (frames are stepped: a background tab has no ticker), then \`shareMeans(name)\`. Returns { strokes, seconds, publish, composite }.
 */
export async function rebakeAndShare(name = "diverge-gm", { maxS = 420 } = {}) {
  const run = await rebakeRun({ maxS });
  await boot();
  await shareMeans(name);
  return { strokes: run.strokes, seconds: run.seconds, publish: run.publish, composite: run.composite };
}

/** The published manifest's chunk ids by stroke ({ strokeId: chunkId }), from the scene flag (what a player reads). */
export function manifestIds(scene = canvas.scene) {
  const c = scene.flags[MODULE]?.destruction?.baked?.c ?? {};
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v).split(":")[1]]));
}

/** Two `manifestIds()` compared: { same, changed: [stroke ids whose chunk differs], only: [ids in one only] }. */
export function idsDiff(a, b) {
  const changed = Object.keys(a).filter((k) => k in b && a[k] !== b[k]), only = [...Object.keys(a).filter((k) => !(k in b)), ...Object.keys(b).filter((k) => !(k in a))];
  return { same: Object.keys(a).length - changed.length - only.length, changed, only };
}

/**
 * GM: Rebake all (every stroke, or `ids`) and wait for the pass, the publish and the settled composite (frames are stepped: a background
 * tab has no ticker). Returns { strokes, seconds, publish, composite, ids (manifestIds after), manifests (how many times the manifest was written) }.
 */
export async function rebakeRun({ maxS = 420, ids = null } = {}) {
  const A = game.modules.get("moinen-maps").api.destruction, T = A.net.trace, list = ids ?? A.state().o.filter((o) => !o.k).map((o) => o.id);
  const at0 = canvas.scene.flags[MODULE]?.destructionComposite?.at ?? 0, n0 = T().events.length, t0 = performance.now(), b0 = canvas.scene.flags[MODULE]?.destruction?.baked?.at ?? 0;
  A.rebakeAll(list);
  const gone = (re) => T().events.slice(n0).filter((e) => re.test(e.reason));
  while ( performance.now() - t0 < maxS * 1000 ) {
    await new Promise((r) => setTimeout(r, 300)); step(20);
    if ( !A.status().rebake && performance.now() - t0 > 1500 && gone(/^rebake-done$/).length ) break;
  }
  // (the publish follows the pass; the composite follows the publish once nothing moves - and is not rewritten when its tiles are the same)
  let tPub = 0;
  for ( let i = 0; i < 400; i++ ) {
    step(60); await new Promise((r) => setTimeout(r, 300));
    if ( (canvas.scene.flags[MODULE]?.destructionComposite?.at ?? 0) > at0 && !A.status().baking ) break;
    if ( gone(/^publish$/).length || !A.status().baking ) tPub ||= performance.now();
    if ( tPub && performance.now() - tPub > 15000 && !gone(/^composite-wait$/).length ) break;
  }
  const pub = gone(/^publish$/).pop()?.data ?? null, comp = gone(/^composite-published$/).length;
  return { strokes: list.length, seconds: Math.round((performance.now() - t0) / 100) / 10, publish: pub, composite: comp, ids: manifestIds(), manifestWritten: (canvas.scene.flags[MODULE]?.destruction?.baked?.at ?? 0) > b0 };
}

/** This page's own pictures per view: the areas as shown (cache bands) against the areas drawn live (without the cache): [[view, max, blocks over 8]] (a band that is not the areas' picture shows here). */
export function selfDiff() {
  return divergeViews().map((region, i) => { const d = blockDiff(blockMeans({ region }), blockMeans({ region, live: true })); return [i, d.max, d.blocksOver]; });
}

/**
 * A FRESH STATE for a Detonate bench: the scene drawn again, fitted, every shard made, and the rim lights / clocks left over from the
 * draw done (a bench started while they run measures them: ~12 ms of every frame in a dark-scene-like queue). -> { rimQ, dark, shells }
 */
export async function fresh() {
  await canvas.draw(); fit(); await boot();
  for ( let i = 0; i < 400 && (D()?.rimQueue?.length || D()?.clocks?.length); i++ ) { step(5); await new Promise((r) => setTimeout(r, 30)); }
  await new Promise((r) => setTimeout(r, 2500)); step(30);
  return { rimQ: D()?.rimQueue?.length, dark: canvas.environment?.darknessLevel, shells: D()?.shellCount };
}

/** fresh() + detBench() with CONFIG.moinenMaps flags set for the run (and put back): the headline numbers of one Detonate. */
export async function runCfg(tag, cfg = {}) {
  CONFIG.moinenMaps ??= {}; const saved = {};
  for ( const k in cfg ) { saved[k] = CONFIG.moinenMaps[k]; CONFIG.moinenMaps[k] = cfg[k]; }
  try {
    await fresh(); const r = await detBench({});
    return { tag, med: r.cpu.med, p95: r.cpu.p95, over33: r.over33, frames: r.animFrames, gpuMed: r.gpu.med, gpuP95: r.gpu.p95, worst: r.worst, draws: r.draws.med,
      heapPeak: r.mem1.heapPeakMB, entries: r.entries.entries, noPix: r.entries.noPixelEntries, waitedIn: r.entries.waitedIn };
  } finally { for ( const k in saved ) CONFIG.moinenMaps[k] = saved[k]; }
}

/** The display's methods timed over a Detonate (ms, calls): `await profile(["erodeGpu", "effects", ...])`. */
export async function profile(names, ms = 2600) {
  const P = D().constructor.prototype, acc = {}, orig = {};
  for ( const n of names ) { orig[n] = P[n]; acc[n] = { ms: 0, n: 0 }; P[n] = function(...a) { const t = performance.now(); try { return orig[n].apply(this, a); } finally { acc[n].ms += performance.now() - t; acc[n].n++; } }; }
  try { await fresh(); const t = await trace(ms, () => game.modules.get("moinen-maps").api.destruction.replay()); return { frames: t.animFrames, cpu: t.cpu, acc: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, [Math.round(v.ms), v.n]])) }; }
  finally { for ( const n of names ) P[n] = orig[n]; }
}

/**
 * COLD PLAYER flood check (a cold player's holes stuck in state 'none'): run after a COLD load as a player (fresh origin, e.g.
 * http://127.0.0.N:PORT/join, new IndexedDB): waits until no hole is new / loading / dry / baking, then returns
 * { ok, n, states, none: [hashes], dry: how many holes were first unreadable, recovered: by the retry, gaveUp }. `ok` = no hole left 'none'.
 * Repeat >= 10 times on fresh origins; the retry is flood.mjs retryDry (flood-core dryDelay backoff).
 */
export async function floodCheck({ maxMs = 45000 } = {}) {
  const F = game.modules.get("moinen-maps").api.destruction.flood, t0 = performance.now();
  for ( let i = 0; i < 200 && !canvas?.ready; i++ ) await new Promise((r) => setTimeout(r, 250));
  let s;
  while ( true ) {
    await new Promise((r) => setTimeout(r, 500));
    s = F.status();
    const busy = s.holes.some((h) => ["new", "loading", "dry", "baking", "stale"].includes(h.state));
    if ( (!busy && s.holes.length && performance.now() - t0 > 8000) || performance.now() - t0 > maxMs ) break;
  }
  const states = s.holes.reduce((a, h) => (a[h.state] = (a[h.state] || 0) + 1, a), {});
  const none = s.holes.filter((h) => h.state === "none").map((h) => h.hash);
  return { ok: !none.length && s.holes.length > 0, n: s.holes.length, states, none, dry: s.dry ?? 0, recovered: s.dryRecovered ?? 0, gaveUp: s.dryGaveUp ?? 0, user: game.user.name, ms: Math.round(performance.now() - t0) };
}

/**
 * FLOOD DRY, LIVE (the retry path of flood.mjs retryDry, which a normal load never needs): the scene is drawn again with its strokes' chunks
 * (and bundles) held back for `stallMs` - the composite's shells cannot get their pixels, so every flooded hole is dry - then let through.
 * IndexedDB reads are refused meanwhile and the stream's memory is emptied first, so the chunks really come from the network. Returns
 * { holes, during: states just before the release, gaveUp, recovered, afterMs: until no hole is dry / new / loading, final: states }.
 * Before the fix a hole gave up after ~31 s (state 'none') and stayed without water; a stall of 40 s shows it.
 */
export async function floodDryLive({ stallMs = 40000, maxMs = 90000 } = {}) {
  const A = game.modules.get("moinen-maps").api.destruction, F = A.flood, Net = await import("../scripts/net/stream.mjs");
  const sc = canvas.scene, ids = [...Object.values(manifestIds(sc)), ...(sc.flags[MODULE]?.chunkBundle?.t ?? [])];
  const realFetch = window.fetch, realTx = IDBDatabase.prototype.transaction;
  let blocked = true, release; const gate = new Promise((r) => { release = r; });
  window.fetch = function(input, init) {
    const u = String(input?.url ?? input);
    return /\/c\/[^/]+\/[bd][^/]*\.png/.test(u) ? gate.then(() => realFetch.call(this, input, init)) : realFetch.call(this, input, init);
  };
  IDBDatabase.prototype.transaction = function(...a) { if ( blocked ) throw new Error("held back (floodDryLive)"); return realTx.apply(this, a); };
  const states = () => F.status().holes.reduce((o, h) => (o[h.state] = (o[h.state] || 0) + 1, o), {});
  try {
    for ( const id of ids ) Net.forget(id);
    await canvas.draw();
    const t0 = performance.now(), holes = F.status().holes.length;
    while ( performance.now() - t0 < stallMs ) { await new Promise((r) => setTimeout(r, 500)); step(5); }
    const during = states(), st = F.status(), gaveUp = st.dryGaveUp ?? 0;
    blocked = false; release();
    const t1 = performance.now();
    while ( performance.now() - t1 < maxMs ) {
      await new Promise((r) => setTimeout(r, 500)); step(5);
      const s = F.status();
      if ( s.holes.length && !s.holes.some((h) => ["new", "loading", "dry", "baking", "stale"].includes(h.state)) ) break;
    }
    const end = F.status();
    return { holes, during, gaveUp, recovered: end.dryRecovered ?? 0, afterMs: Math.round(performance.now() - t1), final: states() };
  } finally { blocked = false; release(); window.fetch = realFetch; IDBDatabase.prototype.transaction = realTx; }
}

/**
 * WARM PLAYER (a player already on the scene while the GM runs Rebake all): the player's picture against the GM's `shareMeans(name)`
 * (diffShared), polled until shown.max <= `want` or `maxS`. No reload: the page is the one that was on the scene. Returns { converged,
 * seconds, series ([[s, shown.max, blocks over 8]]), requests (chunk requests since the call), warm (the warm-refresh trace events),
 * longTaskMs (the longest task the page saw) }.
 */
export async function warmWatch(name = "diverge-gm", { maxS = 120, want = 8 } = {}) {
  const Net = await import("../scripts/net/stream.mjs"), T = game.modules.get("moinen-maps").api.destruction.net.trace;
  const r0 = Net.stats.requests, k0 = Net.reqLog.length, n0 = T().events.length, t0 = performance.now(), series = [];
  let long = 0; const obs = new PerformanceObserver((l) => { for ( const e of l.getEntries() ) long = Math.max(long, e.duration); });
  try { obs.observe({ type: "longtask" }); } catch { /* none */ }
  let converged = false;
  while ( performance.now() - t0 < maxS * 1000 ) {
    step(10);
    const d = await diffShared(name);
    series.push([Math.round((performance.now() - t0) / 100) / 10, d.shown.max, d.shown.blocksOver]);
    if ( d.shown.max <= want ) { converged = true; break; }
    await new Promise((r) => setTimeout(r, 1500));
  }
  obs.disconnect();
  return { converged, seconds: Math.round((performance.now() - t0) / 100) / 10, series: series.length > 8 ? [...series.slice(0, 3), ...series.slice(-3)] : series, requests: Net.stats.requests - r0,
    kb: Math.round(Net.reqLog.slice(k0).reduce((a, r) => a + r.bytes, 0) / 1024), longTaskMs: Math.round(long),
    warm: T().events.slice(n0).filter((e) => /^warm-/.test(e.reason)).map((e) => ({ r: e.reason, ...(e.data ?? {}) })) };
}
