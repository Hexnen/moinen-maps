// METEOR COST over its life (lane GM page):   const M = await import("/modules/moinen-maps/dev/meteor-cost.mjs")
//   await M.timeline({ a, at, zooms, weaks, leads })   rows { zoom, case, weak, lead (s from T0, as measured), gpu, cpu, long }
// As boom-cost.mjs timeline, but a FRESH firing per lead (the approach is short: one firing cannot hold every zoom x weak at -1.5 s),
// and the weak-GPU emulation also draws the meteor's own layer (meteor-art roots) `weak` times. Leads span the approach (the head and
// its trail in the sky), the fireball and the thrown rocks, the trail blowing away, the aftermath and the haze. ZZ- scenes only.
import { wipe } from "./guns-cost.mjs";
const MOD = "moinen-maps";
const tick_ = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const wait = async (ms) => { const end = performance.now() + ms; while ( performance.now() < end ) { await tick_(); await new Promise((r) => setTimeout(r, 4)); } };

async function weakDraw(n) {
  if ( n <= 1 ) return () => {};
  const A = await import("../scripts/presets/accents.mjs"), MA = await import("../scripts/presets/meteor-art.mjs"), undo = [];
  for ( const o of [A.roots().root, A.roots().glowBox, MA.roots().root, MA.roots().glowBox] ) {
    if ( !o ) continue;
    const orig = o.render;
    o.render = function(...a) { for ( let i = 0; i < n; i++ ) orig.apply(this, a); };
    undo.push(() => { o.render = orig; });
  }
  return () => undo.forEach((f) => f());
}

export async function timeline({ a, at = a, zooms = [1, 3], weaks = [1, 2], leads = [-1500, 400, 3000, 20000, 90000], n = 60, seed = 7 } = {}) {
  const S = await import("./stack-bench.mjs"), DC = await import("./dust-cost.mjs"), { sharedNow } = await import("../scripts/shared-clock.mjs");
  const rows = [], api = game.modules.get(MOD).api.presets;
  await wipe();
  for ( const zoom of zooms ) {
    const m = await S.measure({ zoom, at, n, passes: false });
    rows.push({ zoom, case: "none", weak: 1, lead: null, gpu: m.gpu, cpu: m.cpu, long: m.long, dpr: m.info?.dpr });
  }
  for ( const lead of leads ) {
    await wipe();
    canvas.pan({ x: at[0], y: at[1], scale: zooms[0] }); await wait(800);
    const rec = await api.fire("meteor", { a }, { seed });
    const t0 = rec?.plan?.t0;
    while ( sharedNow() < t0 + lead - 400 ) await wait(50);
    for ( const zoom of zooms ) for ( const weak of weaks ) {
      const u1 = await DC.weak(weak), u2 = await weakDraw(weak), l0 = (sharedNow() - t0) / 1000;
      try {
        const m = await S.measure({ zoom, at, n, passes: false });
        rows.push({ zoom, case: "meteor", weak, lead: Math.round(l0 * 10) / 10, gpu: m.gpu, cpu: m.cpu, long: m.long, dpr: m.info?.dpr });
      } finally { u1(); u2(); }
    }
  }
  await wipe();
  return rows;
}
