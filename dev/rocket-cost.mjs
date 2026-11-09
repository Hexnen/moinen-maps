// ROCKET PRESET COST through its life (lane GM page, a ZZ- scene):   const R = await import("/modules/moinen-maps/dev/rocket-cost.mjs")
//   await R.timeline({ a, b, from, fr, at, zooms, weaks, leads, n })   rows { zoom, case, weak, lead (ms from T0), gpu, cpu, long }
// "none" first (the same view, nothing fired), then ONE rocket firing measured at each `lead` (ms from its impact; negative = the
// hiss / launch / flight) for every zoom x weak. stack-bench.measure steps the ticker in virtual time (Date.now), so each lead is
// reached by holding Date.now at T0 + lead - warm while measure pans and warms: the window really starts at that moment of the
// firing. Weak x n (the weak-GPU emulation of boom-cost / guns-cost): the rocket's art-cell passes (its shader into the render
// textures) and its drawn roots are rendered n times; dust passes through dust-cost.weak. (guns-cost wipe: ZZ- scenes only.)
import { wipe } from "./guns-cost.mjs";
const MOD = "moinen-maps";

async function weakRocket(n) {
  if ( n <= 1 ) return () => {};
  const R = canvas.app.renderer, orig = R.render, undo = [];
  R.render = function(o, opts) {
    const rocket = opts?.renderTexture && o?.shader?.uniforms?.uEmit !== undefined && o?.shader?.uniforms?.uB2 !== undefined;   // (the rocket smoke shader)
    for ( let i = 0, k = rocket ? n : 1; i < k; i++ ) orig.call(this, o, opts);
  };
  undo.push(() => { R.render = orig; });
  const M = await import("../scripts/presets/rocket.mjs"), { root, glowBox } = M.roots();
  for ( const o of [root, glowBox] ) {
    if ( !o ) continue;
    const r0 = o.render;
    o.render = function(...a) { for ( let i = 0; i < n; i++ ) r0.apply(this, a); };
    undo.push(() => { o.render = r0; });
  }
  return () => undo.reverse().forEach((f) => f());
}

export async function timeline({ a = [3300, 5900], b = null, from = null, fr = 50, at = null, zooms = [1, 3], weaks = [1, 2],
  leads = [-900, 0, 800, 2500], n = 60, warm = 30 } = {}) {
  if ( !/^ZZ-/.test(canvas.scene?.name ?? "") ) throw new Error("rocket-cost: ZZ- scenes only");
  const S = await import("./stack-bench.mjs"), DC = await import("./dust-cost.mjs"), { sharedNow } = await import("../scripts/shared-clock.mjs");
  const view = at ?? a, rows = [], r3 = (v) => Math.round(v * 1000) / 1000;
  const row = (zoom, kase, weak, lead, m) => rows.push({ zoom, case: kase, weak, lead, gpuMed: r3(m.gpu.med), gpuP95: r3(m.gpu.p95), cpuMed: r3(m.cpu.med), cpuP95: r3(m.cpu.p95), long: m.long, dpr: m.info?.dpr });
  await wipe();
  for ( const zoom of zooms ) row(zoom, "none", 1, null, await S.measure({ zoom, at: view, n, warm, passes: false }));
  const g = from ? { a: from, b: a, from, fr } : { a, b, from: null };
  const rec = await game.modules.get(MOD).api.presets.fire("rocket", g, { seed: 7 });
  const t0 = rec?.plan?.t0;
  if ( !Number.isFinite(t0) ) throw new Error("rocket-cost: no firing");
  await new Promise((r) => setTimeout(r, 2500));   // (the bake / chunk of the crater lands)
  const skew = sharedNow() - Date.now(), realNow = Date.now;
  for ( const lead of leads ) for ( const zoom of zooms ) for ( const weak of weaks ) {
    const u1 = await DC.weak(weak), u2 = await weakRocket(weak);
    const hold = t0 + lead - warm * 1000 / 60 - skew;
    Date.now = () => hold;
    try { row(zoom, from ? "shot" : "noShooter", weak, lead, await S.measure({ zoom, at: view, n, warm, passes: false })); }
    finally { Date.now = realNow; u2(); u1(); }
  }
  return rows;
}
