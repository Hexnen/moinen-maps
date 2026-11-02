// Browser-side check of CINEMATIC MODE staging / hiding / the show (destruction/cinematic.mjs). Lane server (a test world), a GM page AND a
// REAL PLAYER page (login "Test Gracz 1", ANOTHER origin, e.g. http://127.0.0.4:30004 and http://127.0.0.41:30004), both tabs FRONTED.
//   const C = await import("/modules/moinen-maps/dev/cinematic-check.mjs");
//   GM page:     await C.gmSetup({ mode: "drags", preview: false })      the scene empty, the brush in hand, the mode set
//                await C.gmPaint({ from: [.2, .3], to: [.4, .3] })        a REAL pointer drag (fractions of the scene); { tap: true } a click; { ctrl: true } carries the token under the start
//                await C.gmAction()  /  C.gmSkip()  /  C.gmUndo()  /  C.gmRedo()  /  C.gmClear()
//   either page: await C.probe()      every stroke: its state, whether it is on the display, the PIXELS of the destruction layer in its box,
//                                     the tokens' positions, the show; C.watch() / await C.watchReport()   per-frame: when each stroke's entry
//                                     started (mapped to the shared clock) and every token's mesh
//   await C.cinematicCheck()          (GM page) the whole GM-side scenario, one row per claim; the player page is asked through probe() by the
//                                     runner (see dev/cinematic-check notes in the status file): rows say which page must show what
//   await C.idleRest()                the idle ticker cost with no staged strokes (idle-bench rest)
const MODULE = "moinen-maps";
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const D = () => game.modules.get(MODULE).api.destruction;
const CIN = () => D().cinematic;
const row = (name, ok, extra = {}) => ({ name, ok: !!ok, ...extra });
const wait = async (fn, ms = 12000, step = 80) => { const t = performance.now(); while ( performance.now() - t < ms ) { if ( fn() ) return true; await sleep(step); } return false; };
const objs = () => D().state()?.o ?? [];
const R = () => canvas.dimensions.sceneRect;
const at = (f) => ({ x: R().x + R().width * f[0], y: R().y + R().height * f[1] });

/* ------------------------------------------------------------------ pixels */

/** Pixels (alpha > 8) of the destruction layer inside a scene box, drawn on their own (the map and tokens are not in it). */
export function ink(box) {
  const d = D().display(); if ( !d?.objs ) return 0;
  const r = canvas.app.renderer, W = Math.round(r.screen.width), H = Math.round(r.screen.height);
  const rt = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1 });
  try {
    r.render(d.objs, { renderTexture: rt, transform: d.objs.parent.worldTransform.clone(), clear: true });
    const px = r.extract.pixels(rt), wt = canvas.stage.worldTransform, a = wt.apply({ x: box.x0, y: box.y0 }), b = wt.apply({ x: box.x1, y: box.y1 });
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x))), x1 = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x))), y0 = Math.max(0, Math.floor(Math.min(a.y, b.y))), y1 = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y)));
    let n = 0;
    for ( let y = y0; y <= y1; y++ ) for ( let x = x0; x <= x1; x++ ) if ( px[(y * W + x) * 4 + 3] > 8 ) n++;
    return n;
  } finally { rt.destroy(true); }
}
/** A stroke's box in scene px (mask px x the art pixel size x K). */
async function geoBox(o) {
  const Model = await import(`/modules/${MODULE}/scripts/destruction/model.mjs`), S = D().state(), r = Model.sceneRect(), mpx = S.ap * Model.K;
  return { x0: r.x + o.x0 * mpx, y0: r.y + o.y0 * mpx, x1: r.x + (o.x0 + o.w) * mpx, y1: r.y + (o.y0 + o.h) * mpx };
}

/* ------------------------------------------------------------------ both pages */

/** What this page knows right now. */
export async function probe() {
  const d = D(), S = d.state(), disp = d.display(), now = performance.now(), shared = CIN().now();
  const strokes = [];
  for ( const o of S?.o ?? [] ) {
    if ( o.k ) continue;
    const groups = (disp?.order ?? []).filter((g) => g.objId === o.id);
    const b = await geoBox(o);
    strokes.push({ id: o.id, cin: o.cin ?? null, tk: !!o.tk, groups: groups.length, anim: groups.filter((g) => g.anim).length, ink: ink(b),
      entry: groups.filter((g) => g.anim).map((g) => Math.round(g.anim.start - now + shared)) });
  }
  const tokens = canvas.tokens.placeables.map((t) => ({ id: t.document.id, doc: [t.document.x, t.document.y], mesh: [Math.round(t.mesh.position.x), Math.round(t.mesh.position.y)] }));
  return { user: game.user.name, gm: game.user.isGM, status: CIN().status(), run: CIN().runInfo(), strokes, tokens, flag: canvas.scene.flags?.[MODULE]?.cinShows ?? null, groups: disp?.order?.length ?? 0 };
}

/** Per frame: the strokes' entry starts on the shared clock (first seen) and every token's mesh. Call before the show, read with watchReport(). */
export function watch() {
  const w = window.__cinW = { on: true, entries: {}, tok: [], first: {}, t0: performance.now() };
  const loop = () => {
    if ( !w.on ) return;
    const d = D().display(), now = performance.now(), shared = CIN().now();
    for ( const g of d?.order ?? [] ) {
      if ( !g.objId ) continue;
      w.first[g.objId] ??= { frame: Math.round(now - w.t0), shared };
      if ( g.anim && !(g.objId in w.entries) ) w.entries[g.objId] = { start: Math.round(g.anim.start - now + shared), seen: Math.round(now - w.t0) };
    }
    w.tok.push({ t: Math.round(now - w.t0), p: canvas.tokens.placeables.map((t) => [Math.round(t.mesh.position.x), Math.round(t.mesh.position.y)]) });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return { watching: true, user: game.user.name };
}
export function watchReport() {
  const w = window.__cinW; if ( !w ) return null;
  w.on = false;
  const ids = canvas.tokens.placeables.map((t) => t.document.id);
  const moved = ids.map((id, i) => { const a = w.tok[0]?.p[i], m = w.tok.reduce((s, r) => Math.max(s, a ? Math.hypot(r.p[i][0] - a[0], r.p[i][1] - a[1]) : 0), 0); return Math.round(m); });
  return { user: game.user.name, entries: w.entries, first: w.first, tokenMaxMove: moved, frames: w.tok.length };
}

/* ------------------------------------------------------------------ the GM page */

export async function gmSetup({ mode = "drags", preview = false } = {}) {
  const d = D();
  d.setCinematic({ mode: "off" }); d.clear(); await sleep(1500);
  d.setCinematic({ mode, preview });
  d.activate("paint"); await d.setBrush({ size: 1.3, level: 3, type: "blast" });
  await game.settings.set(MODULE, "destrCarry", false); await game.settings.set(MODULE, "carryEnds", "real");
  window.__cinCfg = CONFIG.moinenMaps ??= {}; CONFIG.moinenMaps.noCinematic = false;
  canvas.pan({ x: R().x + R().width / 2, y: R().y + R().height / 2, scale: Math.min(innerWidth / R().width, innerHeight / R().height) * 1.1 });
  await sleep(900);
  return { scene: canvas.scene.name, cin: CIN().status(), tokens: canvas.tokens.placeables.length };
}

const line = (a, b, n) => Array.from({ length: n }, (_, i) => ({ x: a.x + (b.x - a.x) * i / (n - 1), y: a.y + (b.y - a.y) * i / (n - 1) + Math.sin(i / (n - 1) * Math.PI * 2) * 30 }));
/** One stroke with real pointer events. `tap`: a click. `ctrl`: the carry modifier (a token under the start is carried). */
export async function gmPaint({ from = [0.3, 0.4], to = [0.5, 0.4], tap = false, ctrl = false, n = 36, dt = 14, wait: w = true } = {}) {
  const B = await import(`/modules/${MODULE}/dev/daily-bench.mjs`), before = new Set(objs().map((o) => o.id));
  const a = at(from), b = at(to), pts = tap ? [a, a] : line(a, b, n);
  { const v = canvas.app.view, r = v.getBoundingClientRect(), s = canvas.stage.worldTransform.apply(pts[0]);
    v.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + s.x, clientY: r.top + s.y, pointerId: 1, isPrimary: true, bubbles: true, ctrlKey: ctrl })); await sleep(120); }
  await B.drive(pts, { dt, ctrl });
  await wait(() => objs().some((o) => !before.has(o.id)), 3000);
  const o = objs().find((q) => !before.has(q.id)) ?? null;
  if ( w ) await sleep(1200);
  return o && { id: o.id, cin: o.cin ?? null, tk: !!o.tk, count: CIN().status().staged };
}
export const gmUndo = async () => { const key = (t, o = {}) => window.dispatchEvent(new KeyboardEvent(t, { bubbles: true, cancelable: true, ...o })); key("keydown", { key: "z", code: "KeyZ", ctrlKey: true }); await sleep(900); return { staged: CIN().status().staged, n: objs().length }; };
export const gmRedo = async () => { const key = (t, o = {}) => window.dispatchEvent(new KeyboardEvent(t, { bubbles: true, cancelable: true, ...o })); key("keydown", { key: "y", code: "KeyY", ctrlKey: true }); await sleep(900); return { staged: CIN().status().staged, n: objs().length }; };
export const gmClear = async () => { D().clear(); await sleep(1200); return { staged: CIN().status().staged, n: objs().length }; };
export const gmAction = async () => { const s = await CIN().action(); return s && { id: s.id, t0: s.t0, offs: s.offs, ids: s.snap.ids, at: s.at, now: CIN().now() }; };
export const gmSkip = async () => ({ n: await CIN().skip(), staged: CIN().status().staged });
export async function gmEnd() { const d = D(); d.setCinematic({ mode: "off" }); d.clear(); d.deactivate(); await sleep(800); if ( CONFIG.moinenMaps ) CONFIG.moinenMaps.noCinematic = false; return true; }

/** Wait until the running show is over on this page (the controller has no show and no stroke is held). */
export const waitShow = (ms = 40000) => wait(() => !CIN().status().showing && CIN().status().scheduled.length === 0, ms, 150);

/** The idle ticker cost (nothing staged): idle-bench rest. */
export async function idleRest({ frames = 400 } = {}) {
  const I = await import(`/modules/${MODULE}/dev/idle-bench.mjs`);
  const r = await I.rest({ frames });
  return { total: r.total, top: r.listeners.slice(0, 5), mem: r.mem, cinListeners: r.listeners.filter((x) => /cin/i.test(x.nm)).length };
}

/** Sample the destruction layer's ink inside stroke `id`'s box every `every` ms for `ms`: [{ shared, ink }] (the flash test: nothing may show before the entry starts). */
export async function inkWatch(id, { ms = 7000, every = 40 } = {}) {
  const o = objs().find((q) => q.id === id); if ( !o ) return null;
  const b = await geoBox(o), out = [], t0 = performance.now();
  while ( performance.now() - t0 < ms ) { out.push({ shared: Math.round(CIN().now()), ink: ink(b), groups: (D().display()?.order ?? []).filter((g) => g.objId === id).length }); await sleep(every); }
  return out;
}
