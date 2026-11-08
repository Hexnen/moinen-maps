// Weather COST A/B across builds (lane GM page).   const O = await import("/modules/moinen-maps/dev/weather-opt.mjs")
// `O.costStart(label)`: on a fresh page load, per view (DPR, zoom) and case, the per-pass GPU (timer queries) and per-ticker CPU of
// weather-cost.mjs `passes`, `reps` times in the same page (the a/a), and with every weather pass drawn `weak` times (a weak-GPU
// emulation: a pass drawn twice costs what it would on a GPU half as fast). Rows to mm-rec/cost-<label>.json; poll `window.__oc`.
// Every case starts at the fixed shared time T0, so the A and B builds draw the same weather.
// `O.sum(rows)`: weather GPU / CPU per frame per row (the sum over the weather passes and tickers).
const W = () => game.modules.get("moinen-maps").api.weather;
const tick_ = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const wait = async (ms) => { const end = performance.now() + ms; while ( performance.now() < end ) await tick_(); };

export const OPT_CASES = [["rain", 3], ["sand", 3], ["wind", 3], ["snow", 3], ["embers", 3], ["storm", 3], ["tornado", 3]];
export const OPT_VIEWS = [[1, 1], [1, 3], [2, 1], [2, 3]];

/** Draw every weather pass `n` times (the weak-GPU emulation); returns the undo. */
export async function weak(n) {
  const C = await import("./weather-cost.mjs"), undo = [];
  if ( n <= 1 ) return () => {};
  for ( const [, o, m = "render"] of C.targets() ) {
    const orig = o[m];
    o[m] = function(...a) { let r; for ( let i = 0; i < n; i++ ) r = orig.apply(this, a); return r; };
    undo.push(() => { delete o[m]; if ( o[m] !== orig ) o[m] = orig; });
  }
  return () => undo.forEach((f) => f());
}

/**
 * SPIKE SPY: every weather ticker call over `over` ms (absolute time, ms) and, in a Worker on its own thread, every gap over 15 ms
 * in a busy loop (the CANARY). A weather tick that is long while the canary saw a gap at the same time was the whole process held
 * (descheduled, another tab, the OS): not the weather's own work. Each long tick also carries the JS heap change across it (MB, from
 * performance.memory): a large DROP is a garbage collection that ran inside it. Returns { stop() -> { ticks, canary } }.
 */
export function spy({ over = 8 } = {}) {
  const src = `let last = performance.now(), on = true; const out = [];
    onmessage = (e) => { if ( e.data === "stop" ) { on = false; postMessage(out); } };
    (function loop() { last = performance.now(); const end = last + 40; while ( performance.now() < end ) { const t = performance.now(); if ( t - last > 15 ) out.push([performance.timeOrigin + last, t - last]); last = t; }
      if ( on ) setTimeout(loop, 0); })();`;
  const wk = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
  const ticks = [], undo = [];
  const objs = [W().display(), W().lensDisplay(), W().tornadoDisplay?.(), W().steamDisplay?.()].filter(Boolean);
  // inside a tick: where its time went (the named steps); a long tick whose time is NOT in any step was held between two lines of
  // plain code (the thread paused from outside: a debugger evaluation, the OS), not the weather's work
  let parts = null;
  const part = (o, m, name) => {
    if ( typeof o?.[m] !== "function" ) return;
    const orig = o[m], own = Object.hasOwn(o, m);
    o[m] = function(...a) { const t = performance.now(); try { return orig.apply(this, a); } finally { if ( parts ) parts[name] = (parts[name] ?? 0) + performance.now() - t; } };
    undo.push(() => { if ( own ) o[m] = orig; else delete o[m]; });
  };
  const D = W().display(), T = W().tornadoDisplay?.();
  part(D, "onStep", "step"); part(D, "vortex", "vortex"); part(D?.groundCells, "update", "gCells"); part(D?.hazeCells, "update", "hCells");
  for ( const v of T?.views?.values?.() ?? [] ) { part(v, "axisAt", "axis"); part(v, "debris", "debris"); part(v, "render", "art"); part(v.groundCells, "update", "tCells"); part(v, "dust", "dust"); }
  part(W().lensDisplay(), "render", "lens");
  for ( const o of objs ) {
    const orig = o.tick;
    o.tick = function(...a) {
      const t = performance.now(), m0 = performance.memory?.usedJSHeapSize ?? 0; parts = {};
      try { return orig.apply(this, a); }
      finally {
        const d = performance.now() - t;
        if ( d > over ) { const inSteps = Object.values(parts).reduce((x, y) => x + y, 0); ticks.push([performance.timeOrigin + t, d, o.constructor.name, Object.fromEntries(Object.entries(parts).map(([k, x]) => [k, Math.round(x * 10) / 10])), Math.round((d - inSteps) * 10) / 10, Math.round(((performance.memory?.usedJSHeapSize ?? 0) - m0) / 1e5) / 10]); }
        parts = null;
      }
    };
    undo.push(() => { delete o.tick; if ( o.tick !== orig ) o.tick = orig; });
  }
  return {
    stop: () => new Promise((res) => {
      undo.forEach((f) => f());
      wk.onmessage = (e) => { wk.terminate(); res({ ticks, canary: e.data, held: ticks.map(([t, d]) => e.data.some(([c, g]) => c < t + d && c + g > t)) }); };
      wk.postMessage("stop");
    })
  };
}

export function sum(p) {
  let gpu = 0, cpu = 0;
  for ( const [k, v] of Object.entries(p ?? {}) ) { if ( k.startsWith("cpu.") ) cpu += v.f; else gpu += v.f; }
  return { gpu: Math.round(gpu * 1000) / 1000, cpu: Math.round(cpu * 1000) / 1000 };
}

export function costStart(label, { T0 = 1794150000000, cases = OPT_CASES, views = OPT_VIEWS, n = 60, reps = 2, weaks = [1, 2], c = [768, 512] } = {}) {
  window.__oc = { label, done: false, i: 0, rows: [] };
  (async () => {
    const C = await import("./weather-cost.mjs"), H = await import("./perf-harness.mjs"), rows = window.__oc.rows;
    const dpr0 = canvas.app.renderer.resolution;
    (CONFIG.moinenMaps ??= {}).weatherGuard = false;   // (the frame guard off: every build draws q = 1, whatever this page's frame times)
    try {
      for ( const [dpr, z] of views ) {
        if ( canvas.app.renderer.resolution !== dpr ) await H.setDPR(dpr);
        canvas.pan({ x: c[0], y: c[1], scale: z }); await wait(300);
        for ( const [e, l] of cases ) {
          await C.setCase(e, l, { t: T0, at: e === "tornado" ? [c[0], c[1] + 80] : null });
          for ( let rep = 0; rep < reps; rep++ ) for ( const wk of weaks ) {
            const un = await weak(wk), sp = spy();
            let p; try { p = await C.passes({ n, t0: T0 + 6000 }); } finally { un(); }
            const spikes = await sp.stop();
            rows.push({ dpr, z, e, l, rep, weak: wk, passes: p, ...sum(p), spikes: spikes.ticks.length ? spikes : undefined });
            window.__oc.i = rows.length;
          }
        }
      }
      if ( canvas.app.renderer.resolution !== dpr0 ) await H.setDPR(dpr0);
      await C.setCase("off", 1);
      const FP = foundry.applications.apps.FilePicker.implementation;
      await FP.upload("data", "mm-rec", new File([JSON.stringify(rows)], `cost-${label}.json`, { type: "application/json" }), {}, { notify: false });
      window.__oc.done = true;
    } catch ( err ) { window.__oc.err = String(err?.stack ?? err); window.__oc.done = true; }
  })();
  return "started";
}
