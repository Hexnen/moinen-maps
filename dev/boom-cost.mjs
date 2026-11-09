// BLAST PRESETS COST over a firing's whole life (lane GM page):   const B = await import("/modules/moinen-maps/dev/boom-cost.mjs")
//   await B.timeline({ id, a, b, at, zooms, weaks, leads })   rows { zoom, case, weak, lead (s after T0, as measured), gpu, cpu, long }
// "none" first (the same view, nothing fired), then ONE firing of preset `id` (a -> b), measured at each `lead` ms after its impact at
// every zoom x weak (stack-bench measure: GPU timer query + CPU per ticker step; dust passes and accents drawn `weak` times - the
// weak-GPU emulation of dust-cost.mjs / guns-cost.mjs). The leads span the blast (fireball, shock dust), the aftermath and the
// minutes of the haze, so the cost of what lives long is measured where it lives (guns-cost wipe: ZZ- scenes only).
import { wipe } from "./guns-cost.mjs";
const MOD = "moinen-maps";
const tick_ = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const wait = async (ms) => { const end = performance.now() + ms; while ( performance.now() < end ) { await tick_(); await new Promise((r) => setTimeout(r, 4)); } };

async function weakAccents(n) {
  if ( n <= 1 ) return () => {};
  const A = await import("../scripts/presets/accents.mjs"), { root, glowBox } = A.roots(), undo = [];
  for ( const o of [root, glowBox] ) {
    if ( !o ) continue;
    const orig = o.render;
    o.render = function(...a) { for ( let i = 0; i < n; i++ ) orig.apply(this, a); };
    undo.push(() => { o.render = orig; });
  }
  return () => undo.forEach((f) => f());
}

export async function timeline({ id = "bomb", a, b = null, at, zooms = [1, 3], weaks = [1, 2], leads = [900, 20000, 90000, 240000], n = 150 } = {}) {
  const S = await import("./stack-bench.mjs"), DC = await import("./dust-cost.mjs"), { sharedNow } = await import("../scripts/shared-clock.mjs");
  const rows = [];
  await wipe();
  for ( const zoom of zooms ) {
    const m = await S.measure({ zoom, at, n, passes: false });
    rows.push({ zoom, case: "none", weak: 1, lead: null, gpu: m.gpu, cpu: m.cpu, long: m.long, dpr: m.info?.dpr });
  }
  canvas.pan({ x: at[0], y: at[1], scale: zooms[0] }); await wait(800);
  const rec = await game.modules.get(MOD).api.presets.fire(id, { a, b }, { seed: 7 });
  const t0 = rec?.plan?.t0 ?? Object.values(canvas.scene.flags[MOD]?.presetFirings ?? {})[0]?.t0;
  for ( const lead of leads ) {
    while ( sharedNow() < t0 + lead - 1200 ) await wait(100);   // (measure warms ~1.2 s at the view first)
    for ( const zoom of zooms ) for ( const weak of weaks ) {
      const u1 = await DC.weak(weak), u2 = await weakAccents(weak), l0 = (sharedNow() - t0) / 1000;
      try {
        const m = await S.measure({ zoom, at, n, passes: false });
        rows.push({ zoom, case: id, weak, lead: Math.round(l0 * 10) / 10, gpu: m.gpu, cpu: m.cpu, long: m.long, dpr: m.info?.dpr });
      } finally { u1(); u2(); }
    }
  }
  await wipe();
  return rows;
}
