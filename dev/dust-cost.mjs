// DUST COST (lane GM or player page):   const D = await import("/modules/moinen-maps/dev/dust-cost.mjs")
//   await D.place({ at, mid })   four L3 dust strokes (bike, car, drag, heavy) as rows round `at`, painted `mid` ms ago (in their
//                                busiest part: the source still passing, the bursts and the lingering puffs all alive); GM only
//   await D.wipe()               every fire / dust stroke gone at once (a test reset)
//   await D.frame({ zoom, at, weak })   the whole frame on the stepped clock (stack-bench measure: GPU timer query + CPU per ticker step)
//                                with every dust pass drawn `weak` times (a weak-GPU emulation: a pass drawn twice costs what it
//                                would on a GPU half as fast): the art passes (renderArt, scissorPass - pure re-draws of the same
//                                frame) and the ground / show / front meshes; the job steps (a few cells per frame, ahead) stay single
//   await D.matrix({ zooms, weaks, at, mid })   rows { zoom, case: none | dust, weak, gpu, cpu, long } (none = the same view without dust)
//   await D.pan()                stack-bench move() over the dust (the real ticker: the page must tick)
const MOD = "moinen-maps";
const tick_ = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const wait = async (ms) => { const end = performance.now() + ms; while ( performance.now() < end ) { await tick_(); await new Promise((r) => setTimeout(r, 4)); } };
const api = () => game.modules.get(MOD).api.fire;

export const ROWS = { bike: [16, 500], car: [24, 500], drag: [20, 320], heavy: [36, 240] };

export async function wipe() {
  const keys = Object.keys(canvas.scene.flags[MOD]?.fireStrokes ?? {});
  if ( keys.length ) await canvas.scene.update(Object.fromEntries(keys.map((k) => [`flags.${MOD}.fireStrokes.-=${k}`, null])));
  for ( let i = 0; i < 100 && api().status().areas; i++ ) await wait(100);
}

export async function place({ at = [520, 640], mid = 2500 } = {}) {
  const { sharedNow } = await import("../scripts/shared-clock.mjs");
  await wipe();
  const now = Math.round(sharedNow()), upd = {};
  Object.entries(ROWS).forEach(([dk, [r, L]], i) => {
    const y = at[1] - 180 + i * 120, x0 = at[0] - L / 2, id = `dc${dk}`;
    upd[`flags.${MOD}.fireStrokes.${id}`] = { id, k: "dust", dk, lv: 3, r, s: 1, wd: 0, ws: 0, q: now - mid,
      p: [x0, y, x0 + L * 0.35, y + 15, x0 + L * 0.7, y - 10, x0 + L, y + 5] };
  });
  await canvas.scene.update(upd);
  for ( let i = 0; i < 200 && (api().status().areas < 4 || api().status().pending); i++ ) await wait(100);
  return api().status();
}

/** Draw every dust pass `n` times; returns the undo. */
export async function weak(n) {
  if ( n <= 1 ) return () => {};
  const { DustArt } = await import("../scripts/fire/dust-art.mjs"), undo = [];
  const twice = (o, m) => { const orig = o[m], own = Object.prototype.hasOwnProperty.call(o, m);
    o[m] = function(...a) { let r; for ( let i = 0; i < n; i++ ) r = orig.apply(this, a); return r; };
    undo.push(() => { if ( own ) o[m] = orig; else delete o[m]; }); };
  for ( const m of ["renderArt", "scissorPass"] ) twice(DustArt.prototype, m);
  for ( const a of api().display?.()?.areas?.values?.() ?? [] ) if ( a.mesh instanceof DustArt ) for ( const k of ["ground", "show", "front"] ) twice(a.mesh[k], "_render");
  return () => undo.reverse().forEach((f) => f());
}

export async function frame({ zoom = 1, at = [520, 640], weak: wk = 1, n = 240 } = {}) {
  const S = await import("./stack-bench.mjs"), un = await weak(wk);
  try { const m = await S.measure({ zoom, at, n, passes: false }); return { gpu: m.gpu, cpu: m.cpu, long: m.long, fire: m.listeners, info: m.info }; } finally { un(); }
}

export async function matrix({ zooms = [1, 3], weaks = [1, 2], at = [520, 640], mid = 2500 } = {}) {
  const rows = [];
  for ( const zoom of zooms ) {
    await wipe();
    const none = await frame({ zoom, at });
    rows.push({ zoom, case: "none", weak: 1, gpu: none.gpu, cpu: none.cpu, long: none.long, dpr: none.info?.dpr ?? devicePixelRatio });
    for ( const wk of weaks ) {
      await place({ at, mid });
      const d = await frame({ zoom, at, weak: wk });
      rows.push({ zoom, case: "dust", weak: wk, gpu: d.gpu, cpu: d.cpu, long: d.long, dpr: d.info?.dpr ?? devicePixelRatio });
    }
  }
  await wipe();
  return rows;
}

export async function pan({ at = [520, 640], mid = 2500, dust = true } = {}) {
  const S = await import("./stack-bench.mjs");
  if ( dust ) await place({ at, mid }); else await wipe();
  return S.move();
}
