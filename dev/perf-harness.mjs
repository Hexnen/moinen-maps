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
 * `pair` the two modes (true = sprites). Math.random is seeded alike in both runs (without it two sprite runs differ by a few hundred
 * pixels: random debris and rubble).
 * Flood water hidden (it loops on its own clock). Returns per time [ms, mean |d| per channel... per pixel, max, channels off by more
 * than 8, pixels that differ at all] and `shots` (the two frames per time, RGBA) when `keep`.
 */
export async function abBatch({ times = [0, 60, 120, 300, 600, 1000, 1600, 2400, 3600], only = null, preMat = true, opts = null, keep = false, pair = [true, false] } = {}) {
  const d = D(), T = canvas.app.ticker, real = performance.now.bind(performance);
  CONFIG.moinenMaps ??= {}; const was = CONFIG.moinenMaps.noDestructionCache, wasB = CONFIG.moinenMaps.noBatchRender, wasW = CONFIG.moinenMaps.noClockWorker;
  CONFIG.moinenMaps.noDestructionCache = true; const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  // (the clocks made on the page: a frozen clock never lets the workers' answers in; clockCheck() compares the two)
  CONFIG.moinenMaps.noClockWorker = true;
  const ws = [];
  for ( const g of d.order ) for ( const ch of g.cont.children ) if ( ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont && ch.visible ) { ch.visible = false; ws.push(ch); }
  const groups = only ? d.order.filter(only) : [...d.order];
  // every area back to its resting state with no pieces made (the next run makes them in its own mode)
  const reset = () => { for ( const g of d.order ) { if ( g.anim ) d.endAnim(g); if ( !g.flat && !d.flatten(g) ) { d.release(g); g.made = 0; } } };
  const run = (sprites) => {
    CONFIG.moinenMaps.noBatchRender = sprites;
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
  finally { Math.random = rnd; performance.now = real; CONFIG.moinenMaps.noBatchRender = wasB; CONFIG.moinenMaps.noClockWorker = wasW; ws.forEach((w) => { w.visible = true; }); CONFIG.moinenMaps.noDestructionCache = was; T.maxFPS = mf; if ( st ) T.start(); }
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
  try {
    for ( const z of zooms ) for ( const off of offsets ) {
      const r = canvas.dimensions.sceneRect;
      canvas.pan({ x: r.x + r.width / 2 + off, y: r.y + r.height / 2 + off * 0.5, scale: z });
      step(2);
      // what reached the screen: the frame just drawn, read from the default framebuffer (the primary group draws through its own
      // render texture, so drawing the stage again into a texture is not the same picture); `target`: that object alone
      let px;
      if ( target ) { R.render(target, { renderTexture: rt, clear: true, transform: target.parent?.worldTransform ?? null }); px = R.extract.pixels(rt); }
      else { const T2 = canvas.app.ticker, mf = T2.maxFPS; T2.maxFPS = 0; T2.update(performance.now()); T2.maxFPS = mf; R.renderTexture.bind(null); px = R.extract.pixels(); }
      const M = canvas.stage.worldTransform, s = M.a * R.resolution;
      const at = (x, y) => { const i = (y * PW + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
      const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]);
      let n = 0;
      // columns
      for ( let x = 1; x < PW - 1; x++ ) {
        let hit = 0, rows = 0;
        for ( let y = 0; y < PH; y += 3 ) {
          const L = at(x - 1, y), C = at(x, y), Rr = at(x + 1, y);
          if ( !L[3] && !C[3] && !Rr[3] ) continue;
          rows++;
          if ( diff(L, Rr) < thr * 0.5 && diff(C, L) > thr && diff(C, Rr) > thr ) hit++;
        }
        if ( rows > 30 && hit / rows >= minScore ) { n++; found.push({ zoom: z, off, axis: "x", screen: x, scene: +(((x / R.resolution) - M.tx) / M.a).toFixed(1), score: +(hit / rows).toFixed(2) }); }
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
        if ( cols > 30 && hit / cols >= minScore ) { n++; found.push({ zoom: z, off, axis: "y", screen: y, scene: +(((y / R.resolution) - M.ty) / M.d).toFixed(1), score: +(hit / cols).toFixed(2) }); }
      }
      per[`${z}/${off}`] = n;
    }
  } finally { rt.destroy(true); }
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
    step(3);
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
  const ws = [];
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
  } finally { ws.forEach((w) => { w.visible = true; }); }
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
 * the live frame shows damage: a crack between cache tiles or bands. Must be 0. Returns per frame the gap count and where they sit
 * (scene x / y histogram peaks), plus the cache's tile rectangles.
 */
export function gapCheck({ steps = [1.1, 1.25], n = 8, offsets = [0, 0.37, 0.71], minAlpha = 96 } = {}) {
  const R = canvas.app.renderer, d = D(); CONFIG.moinenMaps ??= {};
  const was = CONFIG.moinenMaps.noDestructionCache, r = canvas.dimensions.sceneRect;
  const fitZ = Math.min(R.screen.width / r.width, R.screen.height / r.height);
  const zooms = new Set([fitZ]);
  for ( const f of steps ) for ( let k = -n; k <= n; k++ ) zooms.add(+(fitZ * f ** k).toFixed(4));
  const ws = [];
  for ( const g of d.order ) for ( const ch of g.cont.children ) if ( ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont && ch.visible ) { ch.visible = false; ws.push(ch); }
  const rows = [];
  try {
    for ( const z of [...zooms].sort((a, b) => a - b) ) for ( const off of offsets ) {
      canvas.pan({ x: r.x + r.width / 2 + off * 13, y: r.y + r.height / 2 + off * 7, scale: z });
      CONFIG.moinenMaps.noDestructionCache = false; step(2); const a = grab();
      CONFIG.moinenMaps.noDestructionCache = true; step(1); const b = grab();
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
  } finally { CONFIG.moinenMaps.noDestructionCache = was; ws.forEach((w) => { w.visible = true; }); step(1); }
  const tiles = (d.cache?.bands ?? []).flatMap((b) => b.tiles.map((t) => [b.level, +t.x.toFixed(2), +t.y.toFixed(2), +t.w.toFixed(2), +t.h.toFixed(2)]));
  return { frames: rows.length, withGaps: rows.filter((q) => q.gaps).length, worst: rows.sort((p, q) => q.gaps - p.gaps).slice(0, 6), tiles };
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
        const g = grab(), Mb = canvas.primary.worldTransform, BW = Math.round(R.screen.width), BH = Math.round(R.screen.height);
        const Lb = (x, y) => { const q = (y * BW + x) * 4; return g[q] + g[q + 1] + g[q + 2]; };
        const e = new Float32Array(blocks.length);
        blocks.forEach(([bx, by], bi) => {
          const x0 = Math.max(1, Math.round(Mb.a * bx + Mb.tx)), y0 = Math.max(1, Math.round(Mb.d * by + Mb.ty));
          const x1 = Math.min(BW - 1, Math.round(Mb.a * (bx + BLK) + Mb.tx)), y1 = Math.min(BH - 1, Math.round(Mb.d * (by + BLK) + Mb.ty));
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
    ratio: +(eD / Math.max(1e-6, eM)).toFixed(3), jitter: +(jD / Math.max(1e-6, jM)).toFixed(3), swim: +(jD / Math.max(1, nJ)).toFixed(3), beat: +(bSum / Math.max(1, bN)).toFixed(4), seams, mode: d.cache?.stats.mode, tiles: tiles.length };
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
export async function rebakeBench({ ids = null, maxS = 420 } = {}) {
  const A = game.modules.get("moinen-maps").api.destruction, Trace = A.net.trace;
  const list = ids ?? A.status().olderLook?.ids ?? [];
  const gaps = []; let last = performance.now(), peak = 0;
  const heap = () => (performance.memory?.usedJSHeapSize ?? 0) / 1048576;
  const start = heap();
  const gi = setInterval(() => { const n = performance.now(), g = n - last; if ( g > 30 ) gaps.push(Math.round(g)); last = n; }, 4);
  const hi = setInterval(() => { peak = Math.max(peak, heap()); }, 50);
  const evBefore = Trace().events.length, t0 = performance.now();
  try {
    A.rebakeAll(list);
    while ( performance.now() - t0 < maxS * 1000 ) {
      await new Promise((r) => setTimeout(r, 250));
      const st = A.status();
      if ( !st.rebake && performance.now() - t0 > 1500 ) break;
    }
  } finally { clearInterval(gi); clearInterval(hi); }
  await new Promise((r) => setTimeout(r, 1500));
  const ev = Trace().events.filter((e) => /rebake|prime-lanes|bake-lanes/.test(e.reason)).map((e) => ({ r: e.reason, ...(e.data ?? {}) }));
  const top = [...gaps].sort((a, b) => b - a).slice(0, 12);
  return { strokes: list.length, seconds: Math.round((performance.now() - t0) / 100) / 10, gaps: { n: gaps.length, max: top[0] ?? 0, over100: gaps.filter((g) => g > 100).length, top },
    heapMB: { start: Math.round(start), peak: Math.round(peak), end: Math.round(heap()) }, events: ev.slice(-8) };
}
