// STACK BENCH (lane pages): does destruction + fire + smoke + weather cost more than the sum of its parts?
//   const S = await import("/modules/moinen-maps/dev/stack-bench.mjs")
//   GM:   await S.ensureScene()                 the bench scene ("moinen stack bench", a copy of "map", 1536 x 1024), activated
//         await S.setLayers({ d, fire, smoke, weather, dark })   d: destruction on (the user's 156-stroke "map" fixture); fire: 0 / 5 / 20
//                                               areas (no smoke of their own); smoke: 0 / 5 smoke-only sources; weather: "off" / "rain"
//                                               (L3 + lens) / "tornado" (L3) / "sand" (L3); dark: 0 day, 1 night
//   any:  await S.ready()                       this client's layers built (fire areas adopted, destruction baked, weather drawn)
//         await S.measure({ zoom })             the stepped-clock frame: GPU ms (timer query around the ticker step), CPU ms, CPU per
//                                               ticker listener, long frames, interaction counters (render-target binds, filters,
//                                               masks, draw calls, lighting refreshes, sorts, duplicate listeners), weather passes
//         await S.move()                        pan / zoom smoothness on the REAL ticker (frame intervals during camera moves)
// The node driver dev/stack-bench-run.mjs runs the matrix (GM + a real player, DPR 1 and 2 by Chrome's device scale factor).
// Guards: CONFIG.moinenMaps.fireAdaptive / weatherGuard are set false while measuring (full quality: a guard that steps down under load
// would hide exactly the cost asked about); `guards: true` measures with them on.
const MOD = "moinen-maps", SCENE = "moinen stack bench";
const tick_ = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const wait = async (ms) => { const end = performance.now() + ms; while ( performance.now() < end ) { await tick_(); await new Promise((r) => setTimeout(r, 4)); } };
const api = () => game.modules.get(MOD).api;
const r3 = (x) => Math.round(x * 1000) / 1000;
const qt = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? r3(s[Math.min(s.length - 1, Math.floor(s.length * f))]) : 0; };
const mean = (a) => r3(a.reduce((x, y) => x + y, 0) / (a.length || 1));

/** Fire positions: a 5 x 4 grid over the 1536 x 1024 map, far enough apart to stay separate areas; 5 = a spread subset. */
export const FIRE_AT = Array.from({ length: 20 }, (_, i) => [150 + (i % 5) * 300, 170 + Math.floor(i / 5) * 230]);
export const FIRE5 = [0, 4, 12, 15, 19];
export const SMOKE_AT = [[300, 285], [900, 285], [600, 515], [300, 745], [1200, 745]];

export async function ensureScene() {
  let s = game.scenes.getName(SCENE);
  if ( !s ) {
    const src = game.scenes.getName("map"); if ( !src ) throw new Error("no scene 'map' to copy");
    const o = src.toObject(); delete o._id;
    o.name = SCENE; o.navigation = false; o.tokens = []; o.flags = { ...(o.flags ?? {}) }; o.flags[MOD] = {};
    s = await Scene.create(o);
  }
  if ( !s.active ) { await s.activate(); await wait(4000); }
  for ( let i = 0; i < 100 && !(canvas.ready && canvas.scene?.id === s.id); i++ ) await wait(200);
  return { id: s.id, name: s.name, w: s.width, h: s.height };
}

let FIX = null;
async function fixture() { return FIX ??= await (await fetch(`/modules/${MOD}/dev/fixtures/destruction-flags/main-map-156.json`)).json(); }

/** The layers of the bench scene (GM). Only what changes is written. Returns the time it took to settle here. */
export async function setLayers({ d = false, fire = 0, smoke = 0, weather = "off", dark = 0 } = {}) {
  const t0 = performance.now(), sc = canvas.scene, F = sc.flags[MOD] ?? {}, upd = {};
  // destruction
  const has = !!Object.keys(F.destructionObjects ?? {}).length;
  if ( d && !has ) { const j = await fixture(); for ( const k of ["destruction", "destructionObjects", "destructionPaths"] ) upd[`flags.${MOD}.${k}`] = j[k]; }
  if ( !d && has ) for ( const k of ["destruction", "destructionObjects", "destructionPaths"] ) upd[`flags.${MOD}.-=${k}`] = null;
  // fire + smoke: ids say what they are, so an unchanged layer is not rewritten (its areas stay built)
  const want = {}, q = Math.round(game.time.serverTime) - 120000;
  const idx = fire >= 20 ? FIRE_AT.map((_, i) => i) : fire > 0 ? FIRE5.slice(0, fire) : [];
  for ( const i of idx ) { const [x, y] = FIRE_AT[i], id = `sbF${i}`; want[id] = { id, k: "fire", s: 0.85, r: 22, p: [x - 30, y, x + 30, y + 6], wd: 0, ws: 0, q: q + i, lv: 2 + (i % 2), sm: 0, e: 1 }; }
  for ( let i = 0; i < smoke; i++ ) { const [x, y] = SMOKE_AT[i], id = `sbS${i}`; want[id] = { id, k: "smoke", s: 0.8, r: 20, p: [x - 20, y, x + 20, y + 4], wd: 0, ws: 0, q: q + 50 + i, sm: 2, e: 1 }; }
  const cur = F.fireStrokes ?? {};
  for ( const k of Object.keys(cur) ) if ( !want[k] ) upd[`flags.${MOD}.fireStrokes.-=${k}`] = null;
  for ( const [k, v] of Object.entries(want) ) if ( !cur[k] ) upd[`flags.${MOD}.fireStrokes.${k}`] = v;
  if ( (sc.environment?.darknessLevel ?? 0) !== dark ) upd["environment.darknessLevel"] = dark;
  if ( Object.keys(upd).length ) await sc.update(upd);
  // weather (weather-cost's cases: the same effects as the weather agent measures; a fixed tornado below the map's centre)
  const C = await import("./weather-cost.mjs");
  // (what the scene has now, from its flag - not from this module's memory: another copy of the module, a reload, the driver)
  if ( weatherNow() !== weather ) {
    if ( weather === "off" ) await C.setCase("off", 1);
    else await C.setCase(weather, 3, { lens: weather === "rain" ? "auto" : false, at: [768, 600] });
  }
  await ready();
  return { s: r3((performance.now() - t0) / 1000) };
}

/** The bench weather the scene holds: "tornado", a preset name, or "off" (clear, no key). */
export function weatherNow() {
  const w = canvas.scene.flags[MOD]?.weather; if ( !w ) return "off";
  if ( w.tornadoes?.length ) return "tornado";
  const k = w.keys?.[w.keys.length - 1]; return !k || k.preset === "clear" ? "off" : k.preset;
}

/** This client's layers built and quiet (fire adopted, destruction baked, weather drawn); the darkness transition over. */
export async function ready({ maxS = 240 } = {}) {
  const A = api(), t0 = performance.now(); let quiet = 0, last = "";
  while ( performance.now() - t0 < maxS * 1000 ) {
    await wait(300);
    const f = A.fire.status(), ds = A.destruction.status({ fast: true });
    const sig = `${f.areas}|${f.pending}|${!!ds.baking}|${!!ds.rebake}`;
    // (a player with no destruction on the scene reports baking for good: only strokes there make it count; with strokes, a player's
    // "baking" ends when its chunks are in)
    const hasD = !!Object.keys(canvas.scene.flags[MOD]?.destructionObjects ?? {}).length;
    const busy = f.pending > 0 || (f.strokes > 0 && !f.display) || (hasD && (ds.baking || ds.rebake));
    quiet = !busy && sig === last ? quiet + 0.3 : 0; last = sig;
    if ( quiet >= 2.4 ) break;
  }
  await wait(1500);   // (the darkness animation, entry animations' tails)
  return info();
}

/** What is up on this client. */
export function info() {
  const A = api(), R = canvas.app.renderer, f = A.fire.status(), W = A.weather;
  return { user: game.user.name, gm: game.user.isGM, dpr: [window.devicePixelRatio, R.resolution, R.view.width, R.screen.width], zoom: r3(canvas.stage.scale.x),
    fireAreas: f.areas, fireVisible: f.visible ?? null, fireLights: f.lights ?? null, destr: Object.keys(canvas.scene.flags[MOD]?.destructionObjects ?? {}).length,
    weather: weatherNow(), fireWet: W?.status?.()?.fireWet?.dim ?? 0,
    lens: !!W?.lensDisplay?.()?.sprite?.visible, dark: canvas.scene.environment?.darknessLevel ?? 0, guardW: W?.guard?.().q ?? null, fireLevel: A.fire.display?.()?.level ?? null };
}

// ---------------------------------------------------------------------------------------------------------------- the stepped frame
/** Interaction counters per frame (wrapped for the run, unwrapped after). */
function counters() {
  const R = canvas.app.renderer, gl = R.gl, c = { rtBind: 0, rtSwitch: 0, filterPush: 0, maskPush: 0, draws: 0, sorts: 0, lightRefresh: 0, perception: 0, clears: 0 }, undo = [];
  const wrap = (o, m, f) => { if ( !o?.[m] ) return; const orig = o[m], own = Object.prototype.hasOwnProperty.call(o, m); o[m] = function(...a) { f(a, this); return orig.apply(this, a); }; undo.push(() => { if ( own ) o[m] = orig; else delete o[m]; }); };
  let lastRt = undefined;
  wrap(R.renderTexture, "bind", (a) => { c.rtBind++; if ( a[0] !== lastRt ) { c.rtSwitch++; lastRt = a[0]; } });
  wrap(R.filter, "push", () => c.filterPush++);
  wrap(R.mask, "push", () => c.maskPush++);
  wrap(gl, "drawElements", () => c.draws++); wrap(gl, "drawArrays", () => c.draws++);
  wrap(gl, "drawElementsInstanced", () => c.draws++); wrap(gl, "drawArraysInstanced", () => c.draws++);
  wrap(gl, "clear", () => c.clears++);
  const sortOn = [canvas.primary, canvas.interface, canvas.effects, canvas.environment, canvas.stage].filter(Boolean);
  for ( const o of sortOn ) wrap(o, "sortChildren", () => c.sorts++);
  wrap(canvas.perception, "update", () => c.perception++);
  const hk = Hooks.on("lightingRefresh", () => c.lightRefresh++);
  undo.push(() => Hooks.off("lightingRefresh", hk));
  return { c, undo: () => undo.reverse().forEach((f) => f()) };
}

/** The ticker's listeners, wrapped to time each one (idle-bench's way; a listener that removes itself is unwrapped first). */
function listeners() {
  const T = canvas.app.ticker, ls = []; for ( let n = T._head.next; n; n = n.next ) ls.push(n);
  const key = (l) => (l._fn ? "_fn" : "fn");
  const name = (l) => { const fn = l._fn ?? l.fn, ctx = l.context?.constructor?.name ?? ""; return `${ctx}.${fn?.name || "anon"}:${String(fn).replace(/\s+/g, " ").slice(0, 40)}`; };
  // (owners by identity: many listeners share the source `() => this.tick()`)
  const A = api(), W = A.weather, own = new Map();
  for ( const [k, o] of [["fire", A.fire.display?.()], ["destruction", A.destruction.display?.()], ["weather", W?.display?.()], ["lens", W?.lensDisplay?.()], ["steam", W?.steamDisplay?.()], ["tornado", W?.tornadoDisplay?.()]] ) if ( o?._tick ) own.set(o._tick, k);
  const orig = ls.map((l) => l[key(l)]), acc = new Array(ls.length).fill(0), names = ls.map((l, i) => (own.has(orig[i]) ? `[${own.get(orig[i])}] ` : "") + name(l));
  ls.forEach((l, i) => { l[key(l)] = function(...a) { const t = performance.now(); try { return orig[i].apply(this, a); } finally { acc[i] += performance.now() - t; } }; });
  const rm = T.remove;
  T.remove = function(fn, ctx) { ls.forEach((l, i) => { if ( orig[i] === fn ) l[key(l)] = orig[i]; }); return rm.call(this, fn, ctx); };
  // the same function object with the same context twice on the ticker = a duplicate tick (identity, not source text: many owners share
  // a `() => this.tick()` source)
  const dup = []; ls.forEach((l, i) => { for ( let j = 0; j < i; j++ ) if ( orig[j] === orig[i] && ls[j].context === l.context ) dup.push(names[i]); });
  return { acc, names, dup, undo: () => { ls.forEach((l, i) => { if ( l[key(l)] !== orig[i] ) l[key(l)] = orig[i]; }); T.remove = rm; } };
}

/**
 * Pan to the map's centre at `zoom`, let it settle on the real ticker, then `n` frames on the stepped shared clock (weather-cost's run:
 * Date.now and the ticker at 60 Hz, every frame rendered and finished): per frame the GPU time of the whole step (timer query) and its
 * CPU time; per listener the CPU ms per frame; the interaction counters per frame; long = frames whose CPU + GPU passes 16.7 ms.
 */
export async function measure({ zoom = 1, n = 240, warm = 60, at = [768, 512], guards = false, passes = true } = {}) {
  CONFIG.moinenMaps ??= {};
  const g0 = [CONFIG.moinenMaps.fireAdaptive, CONFIG.moinenMaps.weatherGuard];
  if ( !guards ) { CONFIG.moinenMaps.fireAdaptive = false; CONFIG.moinenMaps.weatherGuard = false; }
  try {
    canvas.pan({ x: at[0], y: at[1], scale: zoom }); await wait(1200);
    const C = await import("./weather-cost.mjs"), R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const T = canvas.app.ticker, t0 = Date.now();
    C.run(warm, { t0 });
    const L = listeners(), K = counters(), fd = api().fire.display?.(), fs0 = { ...(fd?.stats ?? {}) };
    const qs = [], cpu = [];
    const mf = T.maxFPS, st = T.started; T.maxFPS = 0; T.stop();
    const realNow = Date.now; let vt = t0 + warm * 1000 / 60, pt = performance.now(); Date.now = () => Math.floor(vt);
    try {
      for ( let i = 0; i < n; i++ ) {
        vt += 1000 / 60; pt += 1000 / 60;
        const q = ext ? gl.createQuery() : null; if ( q ) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        const a = performance.now(); T.update(pt); cpu.push(performance.now() - a);
        if ( q ) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
        // (no gl.finish per frame: the GPU stays busy and clocked up, as in play; a finish per frame let it idle between frames and
        // drop its clock, which made the empty scene read slower than a full one. The CPU number is then the ticker step alone.)
      }
      gl.finish();
    } finally { Date.now = realNow; T.maxFPS = mf; if ( st ) T.start(); L.undo(); K.undo(); }
    await wait(300);
    const gpu = []; for ( const q of qs ) { if ( gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
    const per = {}; L.names.forEach((nm, i) => { const v = L.acc[i] / n; if ( v >= 0.005 ) per[nm] = r3(v); });
    const cnt = Object.fromEntries(Object.entries(K.c).map(([k, v]) => [k, r3(v / n)]));
    const fs1 = fd?.stats ?? {}, fireStats = {}; for ( const k of Object.keys(fs1) ) if ( typeof fs1[k] === "number" && fs1[k] !== fs0[k] ) fireStats[k] = r3(fs1[k] - (fs0[k] ?? 0));
    const tot = cpu.map((c, i) => c + (gpu[i] ?? 0));
    const out = { info: info(), gpu: { med: qt(gpu, 0.5), mean: mean(gpu), p95: qt(gpu, 0.95), max: qt(gpu, 1) }, cpu: { med: qt(cpu, 0.5), mean: mean(cpu), p95: qt(cpu, 0.95), max: qt(cpu, 1) },
      long: tot.filter((x) => x > 16.7).length, n, listeners: per, dupListeners: L.dup, counters: cnt, fireStats };
    if ( passes && (canvas.scene.flags[MOD]?.weather?.keys?.length || canvas.scene.flags[MOD]?.weather?.tornadoes?.length) ) {
      const p = await C.passes({ n: 60, warm: 10 }), lens = {};
      for ( const [k, v] of Object.entries(p) ) if ( k.startsWith("lens") || k.startsWith("cpu.") ) lens[k] = v.f;
      out.weatherPasses = lens;
      out.weatherGpuSum = r3(Object.entries(p).filter(([k]) => !k.startsWith("cpu.")).reduce((s, [, v]) => s + v.f, 0));
    }
    return out;
  } finally { CONFIG.moinenMaps.fireAdaptive = g0[0]; CONFIG.moinenMaps.weatherGuard = g0[1]; }
}

/**
 * PAN / ZOOM SMOOTHNESS on the real ticker (the page must be the fronted tab): a fixed camera path (pan across at zoom 1, zoom in to 3,
 * pan at 3, zoom out) with canvas.animatePan; the frame intervals during it (rAF timestamps): median, p95, max, frames over 25 / 34 ms.
 */
export async function move({ guards = true } = {}) {
  CONFIG.moinenMaps ??= {};
  const g0 = [CONFIG.moinenMaps.fireAdaptive, CONFIG.moinenMaps.weatherGuard];
  if ( !guards ) { CONFIG.moinenMaps.fireAdaptive = false; CONFIG.moinenMaps.weatherGuard = false; }
  try {
    canvas.pan({ x: 300, y: 300, scale: 1 }); await wait(800);
    const iv = []; let last = null, on = true;
    const loop = (t) => { if ( last !== null ) iv.push(t - last); last = t; if ( on ) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    for ( const v of [{ x: 1200, y: 700, scale: 1 }, { x: 900, y: 500, scale: 3 }, { x: 500, y: 400, scale: 3 }, { x: 768, y: 512, scale: 1 }] ) await canvas.animatePan({ ...v, duration: 1200 });
    on = false; await wait(100);
    return { frames: iv.length, med: qt(iv, 0.5), p95: qt(iv, 0.95), max: qt(iv, 1), over25: iv.filter((x) => x > 25).length, over34: iv.filter((x) => x > 34).length };
  } finally { CONFIG.moinenMaps.fireAdaptive = g0[0]; CONFIG.moinenMaps.weatherGuard = g0[1]; }
}

/**
 * GPU BY OWNER over `n` stepped frames: timer queries around the render of each owner's own objects (queries cannot nest: an object
 * drawn inside another timed one counts to the outer - the fire's glow inside the lighting, say). Owners: fire (art passes + its
 * every-frame meshes), smoke is the fire system's too; destruction (its object and fx layers); weather (weather-cost's passes, the
 * lens included); lighting (the effects group's illumination / coloration / background layers). The whole frame: measure().
 * -> { owners: { name: ms per frame }, keys: { pass: ms per frame } }
 */
export async function attribute({ zoom = 1, n = 90, warm = 20, at = [768, 512] } = {}) {
  CONFIG.moinenMaps ??= {};
  const g0 = [CONFIG.moinenMaps.fireAdaptive, CONFIG.moinenMaps.weatherGuard];
  CONFIG.moinenMaps.fireAdaptive = false; CONFIG.moinenMaps.weatherGuard = false;
  const R = canvas.app.renderer, gl = R.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2"), undo = [], qs = [];
  let active = false;
  const time = (owner, key, o, m = "render") => {
    if ( !o?.[m] ) return;
    const orig = o[m], own = Object.prototype.hasOwnProperty.call(o, m);
    o[m] = function(...a) {
      if ( active || !ext ) return orig.apply(this, a);
      R.batch.flush(); const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); active = true;
      try { return orig.apply(this, a); } finally { R.batch.flush(); gl.endQuery(ext.TIME_ELAPSED_EXT); active = false; qs.push([owner, key, q]); }
    };
    undo.push(() => { if ( own ) o[m] = orig; else delete o[m]; });
  };
  try {
    canvas.pan({ x: at[0], y: at[1], scale: zoom }); await wait(1200);
    const C = await import("./weather-cost.mjs"), A = await import("../scripts/fire/art.mjs");
    C.run(warm);
    // fire: the art passes (prototype: every area) and each area's meshes
    for ( const m of ["renderArt", "extendArt", "stepJob", "swapJob", "startPre"] ) time("fire", `art.${m}`, A.FireArt.prototype, m);
    const fd = api().fire.display?.();
    for ( const a of fd?.areas?.values?.() ?? [] ) { const mm = a.mesh; for ( const k of ["ground", "show", "smoke", "front", "glow"] ) if ( mm?.[k] ) time("fire", `mesh.${k}`, mm[k], "_render"); if ( mm && !mm.isArt ) time("fire", "mesh.other", mm); }
    for ( const k of ["particles", "sparks", "root", "embers"] ) if ( fd?.[k]?.render ) time("fire", `display.${k}`, fd[k]);
    const dd = api().destruction.display?.();
    if ( dd ) { time("destruction", "objs", dd.objs); time("destruction", "fx", dd.fx); }
    for ( const [key, o, m = "render"] of C.targets() ) time("weather", key, o, m);
    const E = canvas.effects;
    for ( const k of ["illumination", "coloration", "background", "darkness"] ) if ( E?.[k] ) time("lighting", k, E[k]);
    C.run(n);
  } finally { undo.reverse().forEach((f) => f()); CONFIG.moinenMaps.fireAdaptive = g0[0]; CONFIG.moinenMaps.weatherGuard = g0[1]; }
  await wait(300);
  const owners = {}, keys = {};
  for ( const [o, k, q] of qs ) { let ms = 0; if ( gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) ) ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q); owners[o] = (owners[o] ?? 0) + ms / n; keys[`${o}.${k}`] = (keys[`${o}.${k}`] ?? 0) + ms / n; }
  for ( const k of Object.keys(owners) ) owners[k] = r3(owners[k]);
  const top = Object.fromEntries(Object.entries(keys).filter(([, v]) => v >= 0.01).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r3(v)]));
  return { info: info(), owners, keys: top };
}
