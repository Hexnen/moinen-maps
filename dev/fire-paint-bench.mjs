// FIRE painting hitches (browser, lane GM tab, fronted):   const FB = await import("/modules/moinen-maps/dev/fire-paint-bench.mjs")
//   await FB.run({ torn: [false, true], levels: [1, 3], shapes: ["short", "long"] })
// Each case: a fresh scene of fire strokes wiped, the fire brush in hand, a curvy stroke drawn with real pointer events
// (daily-bench drive), then 4 s watched: every long animation frame (> 50 ms) while dragging and after pointer-up, the pointer
// costs, and the field rebuild time of the finished area on the main thread (model.raster, median of 3) for the cost table
// (`rebuild: false` skips it: it blocks the main thread itself, so leave it off while a long-frame probe watches).
// Also `FB.undoRedo()`: the long frames around an undo and a redo of the last stroke.
const MOD = "moinen-maps";
const api = () => game.modules.get(MOD).api.fire;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const curvy = (x0, y0, len, amp, n) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return { x: x0 + len * t, y: y0 + amp * Math.sin(t * 9) }; });
export const SHAPES = { short: () => curvy(560, 520, 220, 30, 24), long: () => curvy(250, 520, 1050, 90, 110) };

export async function run({ torn = [false, true], levels = [1, 3], shapes = ["short", "long"], ms = 4000, rebuild = true } = {}) {
  const B = await import(`/modules/${MOD}/dev/daily-bench.mjs?v=${Date.now()}`);
  const SH = await import(`/modules/${MOD}/scripts/workspace/shell.mjs`);
  const R = await import(`/modules/${MOD}/dev/fire-rec.mjs`);
  await SH.useTool("destruction", "mm-fire-paint"); await wait(500);
  canvas.pan({ x: 768, y: 512, scale: 0.8 }); await wait(600);
  const out = [];
  for ( const tn of torn ) for ( const lv of levels ) for ( const sh of shapes ) {
    await R.wipe(); await wait(400);
    if ( api().params().torn !== tn ) { api().setParams({ torn: tn }); await wait(600); }
    await game.settings.set(MOD, "fireLevel", lv); await game.settings.set(MOD, "fireSmoke", 2); await game.settings.set(MOD, "fireBrush", 1.5);
    let d;
    const h = await B.hitches(async () => { d = await B.drive(SHAPES[sh](), { dt: 16 }); }, ms);
    // the field rebuild of the stroke's area, on the main thread (what the worker now does off it)
    const M = api().model, g = api().geo(), P = api().params();
    const areas = M.areasOf(api().list(), g, P);
    const ts = [];
    for ( let k = 0; k < (rebuild ? 3 : 0); k++ ) { const t = performance.now(); for ( const a of areas ) M.raster(a, g, P); ts.push(performance.now() - t); }
    ts.sort((a, b) => a - b);
    const cost = d.cost.slice(1).sort((a, b) => a - b);
    out.push({ torn: tn, lv, shape: sh, longFrames: h.frames, moveMed: +cost[cost.length >> 1].toFixed(1), moveMax: +Math.max(...cost).toFixed(1), upCost: +d.upCost.toFixed(1), rebuildMs: rebuild ? +ts[1].toFixed(1) : null });
    if ( rebuild ) await wait(400);   // (the measurement itself blocks: keep it out of the next case's watch)
  }
  return out;
}

/** Undo then redo the last stroke (fire's own undo), each watched for long frames. */
export async function undoRedo(ms = 3000) {
  const B = await import(`/modules/${MOD}/dev/daily-bench.mjs`);
  const u = await B.hitches(async () => api().undo(), ms), r = await B.hitches(async () => api().redo(), ms);
  return { undo: u.frames, redo: r.frames };
}
