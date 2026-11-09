// LIGHTNING STRIKE COST over the strike's whole life (lane GM page):   const B = await import("/modules/moinen-maps/dev/lightning-cost.mjs")
//   await B.run({ at, zooms, weaks, n })   rows { zoom, case, weak, gpu {med, p95, max}, cpu {med, p95, max}, long, dpr }
// "none" first (the same view, nothing fired: stack-bench measure), then per zoom x weak ONE fresh firing of "lightning" at `at` and a
// virtual clock stepped at 60 fps from T0 - 1000 (the crackle) to T0 + 1600 (the spray and the plasma gone) - every frame of the
// strike is measured once, the peak frames are in the p95 / max (stack-bench's way: GPU timer query per frame, CPU = the ticker step).
// weak: the strike's meshes and its illumination box drawn `weak` times plus dust-cost's weak dust (the weak-GPU emulation of
// boom-cost). Every case is wiped (guns-cost wipe: ZZ- scenes only).
import { wipe } from "./guns-cost.mjs";
const MOD = "moinen-maps";
const r3 = (x) => Math.round(x * 1000) / 1000;
const qt = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? r3(s[Math.min(s.length - 1, Math.floor(s.length * f))]) : 0; };
const tick_ = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const wait = async (ms) => { const end = performance.now() + ms; while ( performance.now() < end ) { await tick_(); await new Promise((r) => setTimeout(r, 4)); } };

async function weakStrike(n) {
  if ( n <= 1 ) return () => {};
  const M = await import("../scripts/presets/lightning.mjs"), { root, glowBox } = M.roots(), undo = [];
  for ( const o of [root, glowBox] ) {
    if ( !o ) continue;
    const orig = o.render;
    o.render = function(...a) { for ( let i = 0; i < n; i++ ) orig.apply(this, a); };
    undo.push(() => { o.render = orig; });
  }
  return () => undo.forEach((f) => f());
}

/** Step the ticker over virtual time [from, from + n frames) (Date.now faked; sharedNow follows it). */
function stepped(from, n) {
  const R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), T = canvas.app.ticker;
  const qs = [], cpu = [], mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
  const realNow = Date.now; let vt = from, pt = performance.now(); Date.now = () => Math.floor(vt);
  try {
    for ( let i = 0; i < n; i++ ) {
      vt += 1000 / 60; pt += 1000 / 60;
      const q = ext ? gl.createQuery() : null; if ( q ) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const a = performance.now(); T.update(pt); cpu.push(performance.now() - a);
      if ( q ) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
    }
    gl.finish();
  } finally { Date.now = realNow; T.maxFPS = mf; if ( st ) T.start(); }
  return { qs, cpu, gl, ext };
}

export async function run({ at = [1250, 690], zooms = [1, 3], weaks = [1, 2], n = 156 } = {}) {
  const S = await import("./stack-bench.mjs"), DC = await import("./dust-cost.mjs"), { sharedNow } = await import("../scripts/shared-clock.mjs");
  CONFIG.moinenMaps ??= {};
  const g0 = [CONFIG.moinenMaps.fireAdaptive, CONFIG.moinenMaps.weatherGuard];
  const rows = [];
  await wipe();
  for ( const zoom of zooms ) {
    const m = await S.measure({ zoom, at, n, passes: false });
    rows.push({ zoom, case: "none", weak: 1, gpu: m.gpu, cpu: m.cpu, long: m.long, dpr: m.info?.dpr });
  }
  CONFIG.moinenMaps.fireAdaptive = false; CONFIG.moinenMaps.weatherGuard = false;
  try {
    for ( const zoom of zooms ) for ( const weak of weaks ) {
      await wipe();
      canvas.pan({ x: at[0], y: at[1], scale: zoom }); await wait(600);
      const rec = await game.modules.get(MOD).api.presets.fire("lightning", { a: at }, { seed: 7 });
      const t0 = rec?.plan?.t0 ?? rec?.t0 ?? Object.values(canvas.scene.flags[MOD]?.presetFirings ?? {})[0]?.t0;
      await wait(300);   // (the record reaches the renderers)
      const skew = sharedNow() - Date.now();
      const M = await import("../scripts/presets/lightning.mjs"), live = M.status().strikes.length;
      const u1 = await DC.weak(weak), u2 = await weakStrike(weak);
      let res;
      try { res = stepped(t0 - 1000 - skew, n); } finally { u1(); u2(); }
      await wait(300);
      const gpu = []; for ( const q of res.qs ) { if ( res.gl.getQueryParameter(q, res.gl.QUERY_RESULT_AVAILABLE) ) gpu.push(res.gl.getQueryParameter(q, res.gl.QUERY_RESULT) / 1e6); res.gl.deleteQuery(q); }
      const tot = res.cpu.map((c, i) => c + (gpu[i] ?? 0));
      rows.push({ zoom, case: "lightning", weak, gpu: { med: qt(gpu, 0.5), p95: qt(gpu, 0.95), max: qt(gpu, 1) },
        cpu: { med: qt(res.cpu, 0.5), p95: qt(res.cpu, 0.95), max: qt(res.cpu, 1) }, long: tot.filter((x) => x > 16.7).length, strikes: live, dpr: canvas.app.renderer.resolution });
    }
  } finally { CONFIG.moinenMaps.fireAdaptive = g0[0]; CONFIG.moinenMaps.weatherGuard = g0[1]; await wipe(); }
  return rows;
}
