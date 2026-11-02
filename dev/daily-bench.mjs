// Browser-side checks for NORMAL USE (the GM paints, edits, navigates; the frame never freezes). Load:
//   const B = await import("/modules/moinen-maps/dev/daily-bench.mjs")
//   B.stroke({ section: "water", tool: "mm-w-water" })     one drawn stroke with real pointer events; returns the pointer costs and every
//                                                          long animation frame (> 50 ms) in the seconds after pointer-up (offset from up)
//   B.hitches(fn, ms)                                      the same watcher around any async action
// Needs the tab fronted (requestAnimationFrame runs only then); a freeze here is what the GM feels, so the bar is: no frame > 50 ms.
const MODULE = "moinen-maps";

export const circle = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos(i / n * 6.283), y: cy + r * Math.sin(i / n * 6.283) }));

/** A stroke through `pts` (scene points) as pointer events on the canvas: down, moves every `dt` ms, up on the window. */
export async function drive(pts, { dt = 8, button = 0, shift = false, ctrl = false } = {}) {
  const v = canvas.app.view, r = v.getBoundingClientRect();
  const toC = (p) => { const s = canvas.stage.worldTransform.apply(p); return { clientX: r.left + s.x, clientY: r.top + s.y }; };
  const ev = (t, p) => new PointerEvent(t, { ...toC(p), button, buttons: t === "pointerup" ? 0 : 1, pointerId: 1, isPrimary: true, bubbles: true, cancelable: true, shiftKey: shift, ctrlKey: ctrl });
  const cost = [];
  let t0 = performance.now(); v.dispatchEvent(ev("pointerdown", pts[0])); cost.push(performance.now() - t0);
  for ( const p of pts.slice(1) ) {
    await new Promise((res) => setTimeout(res, dt));
    const a = performance.now(); v.dispatchEvent(ev("pointermove", p)); cost.push(performance.now() - a);
  }
  await new Promise((res) => setTimeout(res, dt));
  const up = performance.now(), a = performance.now();
  window.dispatchEvent(ev("pointerup", pts.at(-1)));
  return { cost, up, upCost: performance.now() - a };
}

/** Run `fn` (async, gets nothing) and report the long animation frames (> 50 ms) and long tasks from its start for `ms`. */
export async function hitches(fn, ms = 6000) {
  const lo = [], t00 = performance.now();
  const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => lo.push({ at: Math.round(e.startTime - t00), ms: Math.round(e.duration),
    by: [...new Set(e.scripts.map((x) => x.sourceFunctionName || x.invoker))].join(",") })));
  po.observe({ type: "long-animation-frame" });
  const tasks = [], os = globalThis.setTimeout;
  globalThis.setTimeout = function(f, d, ...a) {
    if ( typeof f !== "function" ) return os.call(this, f, d, ...a);
    const src = String(f).slice(0, 90).replace(/\s+/g, " ");
    return os.call(this, function(...b) { const t = performance.now(); try { return f.apply(this, b); } finally { const x = performance.now() - t; if ( x > 15 ) tasks.push({ at: Math.round(t - t00), ms: Math.round(x), src }); } }, d, ...a);
  };
  let r;
  try { r = await fn(); await new Promise((res) => os(res, ms)); } finally { globalThis.setTimeout = os; po.disconnect(); }
  return { result: r, frames: lo.filter((x) => x.ms > 50), tasks };
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return +(s[s.length >> 1] ?? 0).toFixed(2); };

/** One stroke with `tool` of `section` (the workspace's ids), then the freeze list. */
export async function stroke({ section, tool, at = [0.4, 0.5], r = 140, n = 70, ms = 6000, view = true } = {}) {
  const SH = await import(`/modules/${MODULE}/scripts/workspace/shell.mjs`);
  await SH.useTool(section, tool);
  await new Promise((res) => setTimeout(res, 600));
  const R = canvas.dimensions.sceneRect;
  if ( view ) { canvas.pan({ x: R.x + R.width / 2, y: R.y + R.height / 2, scale: Math.min(innerWidth / R.width, innerHeight / R.height) * 1.1 }); await new Promise((res) => setTimeout(res, 1200)); }
  const pts = circle(R.x + R.width * at[0], R.y + R.height * at[1], r, n);
  let d;
  const h = await hitches(async () => { d = await drive(pts); return d; }, ms);
  const up = Math.round(d.up - (performance.now() - h.frames.length * 0)); // (offsets below are from the watcher's start)
  return { tool, moveMed: med(d.cost), moveMax: +Math.max(...d.cost).toFixed(1), upCost: +d.upCost.toFixed(1), frames: h.frames, tasks: h.tasks };
}
