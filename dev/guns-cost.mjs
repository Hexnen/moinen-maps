// GUN PRESETS COST (lane GM page):   const G = await import("/modules/moinen-maps/dev/guns-cost.mjs")
//   await G.frame({ id, a, b, zoom, at, weak, lead })   fires preset `id` along a -> b, waits until `lead` ms after its first hit (the
//                                burst at its busiest: pocks entering, hits dust kicking, tracers and sparks in the air), then measures
//                                the whole frame on the stepped clock (stack-bench measure: GPU timer query + CPU per ticker step) with
//                                the dust passes and the accents drawn `weak` times (a weak-GPU emulation, as dust-cost.mjs)
//   await G.matrix({ id, a, b, at, zooms, weaks })   rows { zoom, case: none | id, weak, gpu, cpu, long } (none = the same view, nothing fired)
// The destruction entry (the pocks) is drawn once in every case (not weak-emulated: it is the brush's own, measured in its rounds).
const MOD = "moinen-maps";
const tick_ = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const wait = async (ms) => { const end = performance.now() + ms; while ( performance.now() < end ) { await tick_(); await new Promise((r) => setTimeout(r, 4)); } };

export async function wipe() {
  if ( !canvas.scene.name.startsWith("ZZ-") ) throw new Error(`guns-cost: a test scene only (ZZ-...), not ${canvas.scene.name}`);
  const F = canvas.scene.flags[MOD] ?? {}, upd = {};
  for ( const k of ["fireStrokes", "presetFirings"] ) for ( const id of Object.keys(F[k] ?? {}) ) upd[`flags.${MOD}.${k}.-=${id}`] = null;
  if ( Object.keys(upd).length ) await canvas.scene.update(upd);
  const D = game.modules.get(MOD).api.destruction, ids = Object.keys(canvas.scene.flags[MOD]?.destructionObjects ?? {});
  if ( ids.length ) { D.removeStrokes?.(ids); await D.saveNow?.(); }
  await wait(1500);
}

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

export async function frame({ id = "heliHmg", a, b, from = null, zoom = 1, at, weak = 1, lead = 900, n = 180 } = {}) {
  const S = await import("./stack-bench.mjs"), DC = await import("./dust-cost.mjs");
  canvas.pan({ x: at[0], y: at[1], scale: zoom }); await wait(800);
  const rec = await game.modules.get(MOD).api.presets.fire(id, { a, b, ...(from ? { from } : {}) }, { seed: 7 });
  const t0 = rec?.plan?.t0 ?? Object.values(canvas.scene.flags[MOD]?.presetFirings ?? {})[0]?.t0;
  const { sharedNow } = await import("../scripts/shared-clock.mjs");
  while ( sharedNow() < t0 + lead - 1200 ) await wait(50);   // (measure warms ~1.2 s at the view first)
  const u1 = await DC.weak(weak), u2 = await weakAccents(weak);
  try { const m = await S.measure({ zoom, at, n, passes: false }); return { gpu: m.gpu, cpu: m.cpu, long: m.long, info: m.info }; }
  finally { u1(); u2(); }
}

export async function matrix({ id = "heliHmg", a, b, from = null, at, zooms = [1, 3], weaks = [1, 2] } = {}) {
  const S = await import("./stack-bench.mjs"), rows = [];
  for ( const zoom of zooms ) {
    await wipe();
    const none = await S.measure({ zoom, at, n: 180, passes: false });
    rows.push({ zoom, case: "none", weak: 1, gpu: none.gpu, cpu: none.cpu, long: none.long, dpr: none.info?.dpr });
    for ( const weak of weaks ) {
      await wipe();
      const m = await frame({ id, a, b, from, zoom, at, weak });
      rows.push({ zoom, case: id, weak, gpu: m.gpu, cpu: m.cpu, long: m.long, dpr: m.info?.dpr });
    }
  }
  await wipe();
  return rows;
}
