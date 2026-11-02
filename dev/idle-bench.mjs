// REST profile of the whole module (normal use: the scene sits still). Load in the browser (tab fronted, quiet machine):
//   const I = await import("/modules/moinen-maps/dev/idle-bench.mjs")
//   await I.rest({ frames: 400 })     per ticker listener ms/frame (median, mean) over stepped frames with nothing moving, total CPU/frame,
//                                     heap bytes allocated per frame (performance.memory deltas over a long run; coarse, so read the sum)
//   await I.hidden()                  document.hidden emulated: which listeners still do work (a ticker normally does not run at all)
//   I.timers(ms)                      setTimeout/setInterval/rAF callbacks scheduled by the page in `ms` (what runs between frames)
const MODULE = "moinen-maps";
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * f))].toFixed(3) : null; };
const avg = (a) => +(a.reduce((x, y) => x + y, 0) / (a.length || 1)).toFixed(3);

function label(l, i) {
  const fn = l._fn ?? l.fn, ctx = l.context?.constructor?.name ?? "";
  const src = String(fn).replace(/\s+/g, " ");
  return `${i}:${ctx}.${fn?.name || "anon"}@${l.priority}:${src.slice(0, 48)}`;
}

/** Step the canvas ticker by hand `frames` frames at 165 Hz spacing, timing every listener. */
export async function rest({ frames = 400, warm = 120, zoom = 1.2, gc = true } = {}) {
  const T = canvas.app.ticker, r = canvas.dimensions.sceneRect;
  canvas.pan({ x: r.x + r.width / 2, y: r.y + r.height / 2, scale: zoom });
  const ls = []; for ( let n = T._head.next; n; n = n.next ) ls.push(n);
  const keys = ls.map((l) => (l._fn ? "_fn" : "fn")), orig = ls.map((l, i) => l[keys[i]]), names = ls.map(label);
  const acc = new Array(ls.length).fill(0);
  ls.forEach((l, i) => { l[keys[i]] = function(...a) { const t = performance.now(); try { return orig[i].apply(this, a); } finally { acc[i] += performance.now() - t; } }; });
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const rows = [], mem = [];
  let t = performance.now();
  try {
    for ( let i = 0; i < warm; i++ ) { t += 6.06; T.update(t); }
    await new Promise((res) => setTimeout(res, 50));
    const m0 = performance.memory?.usedJSHeapSize ?? 0; let lastM = m0, gcs = 0, grew = 0;
    for ( let i = 0; i < frames; i++ ) {
      acc.fill(0); t += 6.06; const a = performance.now(); T.update(t); const c = performance.now() - a;
      rows.push({ c, by: acc.slice() });
      const m = performance.memory?.usedJSHeapSize ?? 0; if ( m < lastM ) gcs++; else grew += m - lastM; lastM = m;
    }
    mem.push({ gcs, grewKB: Math.round(grew / 1024), perFrameBytes: Math.round(grew / frames) });
  } finally { ls.forEach((l, i) => { l[keys[i]] = orig[i]; }); T.maxFPS = mf; if ( st ) T.start(); }
  const per = names.map((nm, i) => ({ nm, med: q(rows.map((x) => x.by[i]), 0.5), mean: avg(rows.map((x) => x.by[i])), p95: q(rows.map((x) => x.by[i]), 0.95) })).filter((x) => x.mean > 0.002);
  return { total: { med: q(rows.map((x) => x.c), 0.5), mean: avg(rows.map((x) => x.c)), p95: q(rows.map((x) => x.c), 0.95) }, listeners: per.sort((a, b) => b.mean - a.mean), mem: mem[0] };
}

/** Callbacks the page scheduled in `ms` of real time (timers and rAF), grouped by the start of their source. */
export async function timers(ms = 5000) {
  const out = {}, undo = [];
  const wrap = (obj, k) => { const o = obj[k]; obj[k] = function(fn, ...a) {
    if ( typeof fn !== "function" ) return o.call(this, fn, ...a);
    return o.call(this, function(...b) { const t = performance.now(); try { return fn.apply(this, b); } finally { const key = `${k}:${String(fn).slice(0, 80).replace(/\s+/g, " ")}`; const e = (out[key] ??= { n: 0, ms: 0 }); e.n++; e.ms += performance.now() - t; } }, ...a); }; undo.push(() => { obj[k] = o; }); };
  wrap(window, "setTimeout"); wrap(window, "setInterval"); wrap(window, "requestAnimationFrame");
  await new Promise((res) => { const real = undo[0]; setTimeout(res, ms); });
  undo.reverse().forEach((u) => u());
  return Object.entries(out).map(([k, v]) => ({ k, n: v.n, ms: +v.ms.toFixed(2) })).sort((a, b) => b.ms - a.ms).slice(0, 25);
}

/** Real-time long-run: the page's own rAF at its own pace for `ms`; the ticker's CPU per frame measured from the outside (rAF callback duration). */
export async function live({ ms = 5000 } = {}) {
  const T = canvas.app.ticker, o = T._tick, d = [];
  T._tick = function(...a) { const t = performance.now(); try { return o.apply(this, a); } finally { d.push(performance.now() - t); } };
  cancelAnimationFrame(T._requestId); T._requestId = requestAnimationFrame(T._tick);
  await new Promise((res) => setTimeout(res, ms));
  T._tick = o; cancelAnimationFrame(T._requestId); T._requestId = requestAnimationFrame(T._tick);
  return { frames: d.length, med: q(d, 0.5), mean: avg(d), p95: q(d, 0.95), max: +Math.max(...d).toFixed(2) };
}

/** Heap bytes allocated per call of each ticker listener on its own (400 calls, performance.memory growth; GC dips are added back). */
export async function alloc({ n = 600 } = {}) {
  const T = canvas.app.ticker, out = [];
  const grow = (fn) => { for ( let i = 0; i < 100; i++ ) fn(); let last = performance.memory.usedJSHeapSize, g = 0, ms = 0; for ( let i = 0; i < n; i++ ) { const t = performance.now(); fn(); ms += performance.now() - t; const m = performance.memory.usedJSHeapSize; if ( m > last ) g += m - last; last = m; } return { bytes: Math.round(g / n), us: +(ms / n * 1000).toFixed(1) }; };
  let i = 0;
  for ( let l = T._head.next; l; l = l.next, i++ ) {
    const fn = l._fn ?? l.fn; if ( !fn ) continue;
    const ctx = l.context;
    out.push({ nm: label(l, i), ...grow(() => fn.call(ctx, 1)) });
  }
  out.push({ nm: "empty", ...grow(() => {}) });
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** All long animation frames (> `min` ms) in the `ms` after `fn` starts (offsets from the start), with the scripts that ran in them. */
export async function frames(fn, { ms = 3000, min = 20 } = {}) {
  const lo = [], t0 = performance.now();
  const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => lo.push({ at: Math.round(e.startTime - t0), ms: Math.round(e.duration), blocking: Math.round(e.blockingDuration ?? 0), render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0),
    by: [...new Set(e.scripts.map((x) => x.sourceFunctionName || x.invoker))].join(",").slice(0, 80) })));
  po.observe({ type: "long-animation-frame" });
  let result, fnMs = 0;
  try { const a = performance.now(); result = await fn(); fnMs = performance.now() - a; await new Promise((r) => setTimeout(r, ms)); } finally { po.disconnect(); }
  return { result, fnMs: Math.round(fnMs), frames: lo.filter((x) => x.ms >= min) };
}

/** One road stroke (the roads pen) at `at` of the scene; frames after it. */
export async function roadStroke({ at = [0.4, 0.5], r = 140, n = 40, ms = 3000, tool = "mm-r-draw" } = {}) {
  const B = await import(`/modules/${MODULE}/dev/daily-bench.mjs`), SH = await import(`/modules/${MODULE}/scripts/workspace/shell.mjs`);
  await SH.useTool("roads", tool); await new Promise((res) => setTimeout(res, 400));
  const R = canvas.dimensions.sceneRect;
  const pts = B.circle(R.x + R.width * at[0], R.y + R.height * at[1], r, n);
  return frames(async () => { const d = await B.drive(pts); return { upCost: +d.upCost.toFixed(1) }; }, { ms });
}

/**
 * GPU vs CPU per frame around a destruction stroke: the ticker is stepped by hand (a frame every 16 ms of real time) for `ms` after the
 * stroke, each frame measured with a GPU timer query (our own GPU time, not the queue wait of other processes) and wall time with
 * gl.finish. Frames over `min` ms (cpu, gpu or wall) are listed with the gl counters and what changed (groups, bakes).
 */
export async function gpuFrames({ at = [0.5, 0.5], r = 90, n = 50, ms = 9000, min = 20, tool = "mm-d-paint", section = "destruction" } = {}) {
  const B = await import(`/modules/${MODULE}/dev/daily-bench.mjs`), SH = await import(`/modules/${MODULE}/scripts/workspace/shell.mjs`), H = await import(`/modules/${MODULE}/dev/perf-harness.mjs`);
  const R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), T = canvas.app.ticker, d = game.modules.get(MODULE).api.destruction.display();
  await SH.useTool(section, tool); await new Promise((res) => setTimeout(res, 400));
  const sr = canvas.dimensions.sceneRect, pts = B.circle(sr.x + sr.width * at[0], sr.y + sr.height * at[1], r, n);
  const ins = H.instrument(), rows = [], qs = [];
  const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  let t = performance.now(), stop = false;
  const step = async () => {
    while ( !stop ) {
      await new Promise((res) => setTimeout(res, 12));
      t = performance.now(); const q = ext ? gl.createQuery() : null; if ( q ) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const a = performance.now(); T.update(t); const cpu = performance.now() - a; if ( q ) gl.endQuery(ext.TIME_ELAPSED_EXT);
      gl.finish(); const wall = performance.now() - a;
      rows.push({ at: Math.round(t - t00), cpu: +cpu.toFixed(1), wall: +wall.toFixed(1), q, g: ins.frame(), groups: d.groups.size, bakes: d.cache.stats.bakes, anim: [...d.groups.values()].filter((x) => x.anim).length }); if ( q ) qs.push(q);
    }
  };
  const t00 = performance.now(); const loop = step();
  try {
    await B.drive(pts); const up = Math.round(performance.now() - t00);
    await new Promise((res) => setTimeout(res, ms)); stop = true; await loop;
    await new Promise((res) => setTimeout(res, 300));
    for ( const x of rows ) { if ( x.q ) { x.gpu = gl.getQueryParameter(x.q, gl.QUERY_RESULT_AVAILABLE) ? +(gl.getQueryParameter(x.q, gl.QUERY_RESULT) / 1e6).toFixed(1) : null; gl.deleteQuery(x.q); delete x.q; } }
    const pick = (f) => Object.fromEntries(Object.entries(f).filter(([k]) => /texImage|texSub|createTexture|RenderTexture|generateMipmap|createFramebuffer|Texture.from|drawElements|bindFramebuffer|tick|render/.test(k)).map(([k, v]) => [k.slice(0, 28), typeof v === "number" ? +v.toFixed(1) : v]));
    return { up, frames: rows.length, over: rows.filter((x) => x.cpu > min || x.gpu > min || x.wall > min * 2).map((x) => ({ ...x, g: pick(x.g) })) };
  } finally { stop = true; ins.restore(); T.maxFPS = mf; if ( st ) T.start(); }
}
