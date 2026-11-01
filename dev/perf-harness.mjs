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
    await phase("zoomOut", [...gesture(1, 24, 900), ...idle(40)]);                  // 1 -> ~0.3
    await phase("zoomIn", [...gesture(-1, 46, 1500), ...idle(40)]);                 // 0.3 -> ~3
    await phase("zoomInDeep", [...gesture(-1, 14, 600), ...idle(40)]);              // 3 -> ~6
    await phase("zoomBack", [...gesture(1, 36, 1300), ...idle(40)]);                // 6 -> ~1
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
