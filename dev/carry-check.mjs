// Browser-side check of CARRY A TOKEN WITH A DESTRUCTION STROKE (tokens/carry.mjs). On a lane server (a test world), tab FRONTED:
//   const C = await import("/modules/moinen-maps/dev/carry-check.mjs");  await C.carryCheck();   // -> { ok, rows: [{ name, ok, ... }] }
//   await C.carryStrip({ name: "carry" });                                     // a frame strip PNG of one carry (worlds/<world>/popout/<name>.png)
// It drives REAL pointer events (daily-bench drive: Ctrl on every event, button 0) over a token of the scene and watches the token's mesh
// every animation frame against the entry's front (display.anim.path.head: the same clock the destruction uses).
//   1 Ctrl+drag from a token (latch off): the stroke keeps `tk`; the token follows the front within a tolerance, ends at the path end
//     (its document moved for real), Ctrl+Z puts the token back and removes the stroke, Ctrl+Y carries it again;
//   2 a Ctrl+click (no drag) and a short Ctrl+drag (< 8 px): plain strokes, no `tk`, the token stays;
//   3 a plain drag from a token with the latch off: plain stroke; with the latch ON a plain drag carries and Ctrl+drag does not;
//   4 a drag that starts away from every token: plain stroke;
//   5 "returns": the token rides the path and is back at its start, the document never changed;
//   6 a Detonate replay: the token rides again, visually only (the document does not change);
//   7 nothing runs when idle (no carry, no ticker listener of the carry).
//   await C.carryFrontCheck();   // THE TOKEN IS ALWAYS IN FRONT (slow zigzag, graph order + pixels every step, draw / replay / returns, elevation 0 and 5);
//                                // { negative: true } raises the destruction over the tokens on purpose: both tests must then fail
const MODULE = "moinen-maps";
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const D = () => game.modules.get(MODULE).api.destruction;
const row = (name, ok, extra = {}) => ({ name, ok: !!ok, ...extra });

async function mods() {
  const B = await import(`/modules/${MODULE}/dev/daily-bench.mjs`);
  const K = await import(`/modules/${MODULE}/scripts/tokens/carry.mjs`);
  return { B, K };
}

/** The scene on screen, the brush in hand, every stroke gone, the settings at their defaults. */
async function prep({ latch = false, ends = "real", snap = false } = {}) {
  const d = D();
  d.clear(); await sleep(1500);
  d.activate("paint");
  await d.setBrush({ size: 1.2, level: 3, type: "blast" });
  await game.settings.set(MODULE, "destrCarry", latch);
  await game.settings.set(MODULE, "carryEnds", ends);
  await game.settings.set(MODULE, "carrySnap", snap);
  const R = canvas.dimensions.sceneRect;
  canvas.pan({ x: R.x + R.width / 2, y: R.y + R.height / 2, scale: Math.min(innerWidth / R.width, innerHeight / R.height) * 1.1 });
  await sleep(900);
}

/** Put the token where a case begins (its document, no animation) and let Foundry settle. */
async function place(token, x, y) {
  await token.document.update({ x, y }, { animate: false, diff: false });
  await sleep(250);
}

const line = (a, b, n) => Array.from({ length: n }, (_, i) => ({ x: a.x + (b.x - a.x) * i / (n - 1), y: a.y + (b.y - a.y) * i / (n - 1) + Math.sin(i / (n - 1) * Math.PI * 2) * 50 }));

/** The entry's front at `now`, as the displacement from the path's start in scene px (null while the stroke has no running entry). */
function frontAt(objId, now) {
  const d = D().display(); if ( !d ) return null;
  const R = canvas.dimensions.sceneRect, ap = D().state().ap;
  for ( const g of d.order ) {
    const a = g.anim; if ( g.objId !== objId || !a?.path ) continue;
    const P = a.path, el = now - a.start - a.delay, n = P.pts.length;
    const p0 = P.pts[0], pe = P.pts[n - 1];
    let q;
    if ( el <= 0 ) q = p0; else if ( el >= P.D ) q = pe; else { const h = P.head(el); q = h ? [h[0], h[1]] : pe; }
    return { x: (q[0] - p0[0]) * ap, y: (q[1] - p0[1]) * ap, el, D: P.D, R };
  }
  return null;
}

const vfxHover = (t) => { try { return game.modules.get("moinen-pixel-vfx")?.api?.visual?.baseHeight?.(t) ?? null; } catch { return null; } };

/** Sample the token's mesh centre every animation frame for `ms`, with where the entry's front says it should be. */
function sampler(token, getObjId) {
  const rows = [], c0 = { x: token.document.x + token.w / 2, y: token.document.y + token.h / 2 };
  let on = true;
  const loop = () => {
    if ( !on ) return;
    const now = performance.now(), id = getObjId(), f = id ? frontAt(id, now) : null, m = token.mesh;
    rows.push({ t: now, x: m.position.x, y: m.position.y, ty: token.position.y, h: vfxHover(token), f: f && { x: c0.x + f.x, y: c0.y + f.y, el: f.el, D: f.D } });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return { rows, stop: () => { on = false; }, c0 };
}

const wait = async (fn, ms = 9000, step = 60) => { const t = performance.now(); while ( performance.now() - t < ms ) { if ( fn() ) return true; await sleep(step); } return false; };
const strokes = () => D().state().o;
const key = (type, o = {}) => window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...o }));
const nearD = (a, b, e = 2) => Math.abs(a - b) <= e;

/** One drag from `start` over `pts`: returns what the stroke and the token did. */
async function run({ B, K }, token, { ctrl, pts, dt = 14, settle = 1500 }) {
  const before = new Set(strokes().map((o) => o.id));
  let objId = null;
  const s = sampler(token, () => objId);
  const st0 = K._carryStats();
  // the pointer rests over the start first, as a hand's does (Foundry's token under it is hovered: a press must not also drag it)
  { const v = canvas.app.view, r = v.getBoundingClientRect(), s = canvas.stage.worldTransform.apply(pts[0]);
    v.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + s.x, clientY: r.top + s.y, pointerId: 1, isPrimary: true, bubbles: true, ctrlKey: ctrl })); await sleep(120); }
  await B.drive(pts, { dt, ctrl });
  await wait(() => { const n = strokes().find((o) => !before.has(o.id)); if ( n ) objId = n.id; return !!n; }, 3000);
  const o = strokes().find((q) => !before.has(q.id)) ?? null;
  // wait for the carry (it starts with the entry, after the bake) and for it to end
  if ( o?.tk ) {
    await wait(() => K._carryStats().played > st0.played, 12000);
    await wait(() => K._carryStats().active === 0, 12000);
  } else await sleep(settle);
  await sleep(settle);
  s.stop();
  return { o, rows: s.rows, c0: s.c0, st0, st1: K._carryStats() };
}

/** The worst and the mean distance of the token from the front while the front runs. */
function follow(rows) {
  const run = rows.filter((r) => r.f && r.f.el > 0 && r.f.el < r.f.D);
  const err = run.map((r) => Math.hypot(r.x - r.f.x, r.y - r.f.y));
  const s = [...err].sort((a, b) => a - b);
  return { n: run.length, max: err.length ? s.at(-1) : null, p90: err.length ? s[Math.floor(s.length * 0.9)] : null, mean: err.length ? err.reduce((a, b) => a + b, 0) / err.length : null };
}

export async function carryCheck() {
  const M = await mods(), { K } = M, d = D();
  const rows = [];
  const token = canvas.tokens.placeables.find((t) => !t.document.locked && t.visible);
  if ( !token ) return { ok: false, rows: [row("a token to carry", false)] };
  const doc = token.document, G = canvas.grid.size, R = canvas.dimensions.sceneRect;
  const home = { x: Math.round(R.x + R.width * 0.15), y: Math.round(R.y + R.height * 0.45) };
  const cen = () => ({ x: home.x + token.w / 2, y: home.y + token.h / 2 });
  const to = (dx, dy) => ({ x: cen().x + dx, y: cen().y + dy });
  const tickBefore = canvas.app.ticker.count;
  // the other tokens step aside (the topmost token under the brush is the one carried): their places are given back at the end
  const others = canvas.tokens.placeables.filter((t) => t !== token).map((t) => ({ doc: t.document, x: t.document.x, y: t.document.y }));
  for ( const [i, o] of others.entries() ) await o.doc.update({ x: Math.round(R.x + R.width - 100), y: Math.round(R.y + 60 + i * 120) }, { animate: false, diff: false });
  const origin = { x: doc.x, y: doc.y };
  const log = [], hook = Hooks.on("updateToken", (dd, ch, op) => { if ( dd.id === doc.id && ("x" in ch || "y" in ch) ) log.push([Math.round(performance.now() % 1e6), ch.x, ch.y, op.action ?? op._movement ? "mv" : ""]); });
  try {
    /* 1 Ctrl+drag from the token */
    await prep(); await place(token, home.x, home.y);
    const r1 = await run(M, token, { ctrl: true, pts: line(cen(), to(420, 120), 44) });
    const tk = r1.o?.tk, dx = tk ? tk.x1 - tk.x0 : 0, f1 = follow(r1.rows);
    rows.push(row("Ctrl+drag from a token: the stroke keeps tk (id, start, end, path)", tk && tk.id === doc.id && tk.x0 === home.x && tk.y0 === home.y && tk.p.length >= 9 && tk.e === 0, { tk: tk && { x0: tk.x0, y0: tk.y0, x1: tk.x1, y1: tk.y1, n: tk.p.length } }));
    rows.push(row(`the token tracks the entry's front within ${Math.round(G * 0.4)} px at the 90th percentile (${f1.n} frames; one dropped frame is ~10 px)`, f1.n > 8 && f1.p90 < G * 0.4 && f1.max < G && f1.mean < G * 0.25, { max: f1.max && +f1.max.toFixed(1), p90: f1.p90 && +f1.p90.toFixed(1), mean: f1.mean && +f1.mean.toFixed(1) }));
    rows.push(row("it moved with the stroke (not before the entry starts)", (() => { const a = r1.rows.filter((q) => q.f && q.f.el < -50); return a.length === 0 || a.every((q) => Math.hypot(q.x - r1.c0.x, q.y - r1.c0.y) < 3); })()));
    rows.push(row("it ends at the path end: the document moved for real, the mesh is there", tk && nearD(doc.x, tk.x1) && nearD(doc.y, tk.y1) && Math.hypot(token.mesh.position.x - (doc.x + token.w / 2), token.mesh.position.y - (doc.y + token.h / 2)) < 1.5 && dx > 300, { doc: [doc.x, doc.y] }));
    const last = r1.rows.at(-1); const popped = r1.rows.filter((q) => q.f && q.f.el > q.f.D + 600).every((q) => Math.hypot(q.x - (doc.x + token.w / 2), q.y - (doc.y + token.h / 2)) < 2);
    rows.push(row("no pop when the document takes over (the mesh sits at the real position afterwards)", popped && !!last));
    const snapped = { x: doc.x, y: doc.y };
    // Ctrl+Z: the token goes back, the stroke goes; Ctrl+Y: carried again
    key("keydown", { key: "z", ctrlKey: true }); await sleep(900);
    rows.push(row("Ctrl+Z: the stroke is gone and the token is back at its start", strokes().length === 0 && nearD(doc.x, home.x) && nearD(doc.y, home.y), { doc: [doc.x, doc.y] }));
    const p0 = K._carryStats().played;
    key("keydown", { key: "y", ctrlKey: true }); await wait(() => K._carryStats().played > p0 && K._carryStats().active === 0, 12000); await sleep(600);
    rows.push(row("Ctrl+Y: the stroke is back and the token is carried to the end again", strokes().length === 1 && nearD(doc.x, snapped.x) && nearD(doc.y, snapped.y), { doc: [doc.x, doc.y] }));

    /* 6 replay (the stroke is there, the token at its end) */
    const pr = K._carryStats().played, atEnd = { x: doc.x, y: doc.y };
    const sp = sampler(token, () => strokes()[0]?.id);
    await d.replay(); await wait(() => K._carryStats().played > pr, 8000); await wait(() => K._carryStats().active === 0, 12000); await sleep(500); sp.stop();
    const away = Math.max(...sp.rows.map((q) => Math.hypot(q.x - (atEnd.x + token.w / 2), q.y - (atEnd.y + token.h / 2))));
    rows.push(row("Detonate replay: the token rides the path again, visually only (document unchanged, ends in place)", away > G * 2 && doc.x === atEnd.x && doc.y === atEnd.y && Math.hypot(token.mesh.position.x - (doc.x + token.w / 2), token.mesh.position.y - (doc.y + token.h / 2)) < 1.5, { away: Math.round(away) }));

    /* 2 a click and a short drag */
    await prep(); await place(token, home.x, home.y);
    const c = cen();
    const r2 = await run(M, token, { ctrl: true, pts: [c, c] , settle: 800 });
    rows.push(row("Ctrl+click on a token: a plain stroke, no tk, the token stays", r2.o && !r2.o.tk && doc.x === home.x && doc.y === home.y, { stroke: !!r2.o }));
    const r2b = await run(M, token, { ctrl: true, pts: [c, { x: c.x + 3, y: c.y + 2 }, { x: c.x + 5, y: c.y + 3 }], settle: 800 });
    rows.push(row("a Ctrl+drag under 8 px is a click", r2b.o && !r2b.o.tk && doc.x === home.x, {}));

    /* 3 no Ctrl, latch off; then the latch */
    const r3 = await run(M, token, { ctrl: false, pts: line(cen(), to(300, 80), 30), settle: 800 });
    rows.push(row("a plain drag from a token (latch off) is a plain stroke", r3.o && !r3.o.tk && doc.x === home.x && doc.y === home.y, { stroke: !!r3.o, tk: !!r3.o?.tk, doc: [doc.x, doc.y], home, latch: game.settings.get(MODULE, "destrCarry"), log: log.slice(-8), now: Math.round(performance.now() % 1e6) }));
    await prep({ latch: true }); await place(token, home.x, home.y);
    const r3b = await run(M, token, { ctrl: false, pts: line(cen(), to(380, 100), 40) });
    rows.push(row("latch ON: a plain drag from a token carries it", r3b.o?.tk && r3b.o.tk.id === doc.id && nearD(doc.x, r3b.o.tk.x1) && doc.x !== home.x, { doc: [doc.x, doc.y] }));
    await prep({ latch: true }); await place(token, home.x, home.y);
    const r3c = await run(M, token, { ctrl: true, pts: line(cen(), to(380, 100), 40), settle: 800 });
    rows.push(row("latch ON: Ctrl+drag does the opposite (a plain stroke)", r3c.o && !r3c.o.tk && doc.x === home.x));

    /* 4 away from every token */
    await prep(); await place(token, home.x, home.y);
    const away0 = { x: R.x + R.width * 0.8, y: R.y + R.height * 0.12 };
    const r4 = await run(M, token, { ctrl: true, pts: line(away0, { x: away0.x - 200, y: away0.y + 60 }, 30), settle: 800 });
    rows.push(row("Ctrl+drag that starts on no token: a plain stroke", r4.o && !r4.o.tk && doc.x === home.x));

    /* 5 returns */
    await prep({ ends: "return" }); await place(token, home.x, home.y);
    const r5 = await run(M, token, { ctrl: true, pts: line(cen(), to(380, 100), 40) });
    const far = Math.max(...r5.rows.map((q) => Math.hypot(q.x - r5.c0.x, q.y - r5.c0.y)));
    rows.push(row("'returns': the token rides the path and is back at its start, the document never moved", r5.o?.tk?.e === 1 && far > G * 5 && doc.x === home.x && doc.y === home.y && Math.hypot(token.mesh.position.x - (home.x + token.w / 2), token.mesh.position.y - (home.y + token.h / 2)) < 1.5, { far: Math.round(far), e: r5.o?.tk?.e, doc: [doc.x, doc.y], mesh: [token.mesh.position.x, token.mesh.position.y], home }));
    await prep();
    await place(token, home.x, home.y);
    // 7 idle
    await sleep(500);
    rows.push(row("idle: no carry running, no ticker listener left by the carry", K._carryStats().active === 0 && !K._carryStats().ticking && canvas.app.ticker.count <= tickBefore + 1, { ticker: canvas.app.ticker.count, before: tickBefore }));
  } catch ( err ) { rows.push(row(`error: ${err.message}`, false, { stack: String(err.stack).slice(0, 400) })); }
  finally {
    try { await game.settings.set(MODULE, "destrCarry", false); await game.settings.set(MODULE, "carryEnds", "real"); } catch { /* ignore */ }
    try { await doc.update({ x: origin.x, y: origin.y }, { animate: false, diff: false }); for ( const o of others ) await o.doc.update({ x: o.x, y: o.y, sort: o.sort }, { animate: false, diff: false }); } catch { /* ignore */ }
    Hooks.off("updateToken", hook); d.clear(); d.deactivate();
  }
  return { ok: rows.every((r) => r.ok), rows };
}

/**
 * A frame strip of one carry: the screen region around the path, `n` frames while the token is carried (captured from the live canvas,
 * with the milliseconds since the front started written on each), laid in a row; uploaded to worlds/<world>/popout/<name>.png.
 */
export async function carryStrip({ name = "carry", n = 10, scale = 1, dist = [420, 120], size = 0.6 } = {}) {
  const M = await mods(), { B, K } = M, d = D();
  const token = canvas.tokens.placeables.find((t) => !t.document.locked && t.visible);
  const R = canvas.dimensions.sceneRect, home = { x: Math.round(R.x + R.width * 0.15), y: Math.round(R.y + R.height * 0.45) };
  await prep(); await place(token, home.x, home.y);
  const c = { x: home.x + token.w / 2, y: home.y + token.h / 2 };
  const pts = line(c, { x: c.x + dist[0], y: c.y + dist[1] }, 44);
  const before = new Set(strokes().map((o) => o.id));
  const rect = new PIXI.Rectangle(Math.round(c.x - 90), Math.round(c.y - 140), dist[0] + 200, 330);
  const frames = [];
  await B.drive(pts, { dt: 14, ctrl: true });
  await wait(() => strokes().some((o) => !before.has(o.id)), 3000);
  const id = strokes().find((o) => !before.has(o.id)).id;
  // from the start of the front to a little after its end
  let a = null; await wait(() => { const g = d.display().order.find((q) => q.objId === id && q.anim?.path); a = g?.anim ?? null; return !!a; }, 12000, 10);
  const t0 = a.start + a.delay, D_ = a.path.D;
  // the clock is frozen and stepped by hand (as endPopCheck does): a capture takes longer than a frame, so a live strip would skip the run
  const T = canvas.app.ticker, real = performance.now.bind(performance), mf = T.maxFPS, was = T.started;
  T.maxFPS = 0; T.stop();
  try {
    for ( let i = 0; i < n; i++ ) {
      const el = Math.round(-40 + (D_ + 700) * i / (n - 1)), F = t0 + el;
      performance.now = () => F; T.update(F); await sleep(30);
      frames.push({ cv: canvas.app.renderer.extract.canvas(canvas.stage, rect), el });
    }
    const Fe = t0 + D_ + 5000; performance.now = () => Fe; T.update(Fe);
  } finally { performance.now = real; T.maxFPS = mf; if ( was ) T.start(); }
  await wait(() => K._carryStats().active === 0, 8000);
  const w = Math.round(rect.width * size), h = Math.round(rect.height * size), cols = Math.min(5, n), rowsN = Math.ceil(n / cols);
  const out = new OffscreenCanvas(cols * (w + 4), rowsN * (h + 4)), ctx = out.getContext("2d");
  ctx.fillStyle = "#222"; ctx.fillRect(0, 0, out.width, out.height);
  frames.forEach((f, i) => { const x = (i % cols) * (w + 4), y = Math.floor(i / cols) * (h + 4); ctx.drawImage(f.cv, x, y, w, h); ctx.fillStyle = "#000a"; ctx.fillRect(x, y, 70, 18); ctx.fillStyle = "#6fe0ff"; ctx.font = "13px monospace"; ctx.fillText(`${f.el} ms`, x + 4, y + 13); });
  const file = new File([await out.convertToBlob({ type: "image/png" })], name + ".png", { type: "image/png" }), fp = foundry.applications.apps.FilePicker.implementation;
  try { await fp.createDirectory("data", `worlds/${game.world.id}/popout`); } catch { /* exists */ }
  const r = await fp.upload("data", `worlds/${game.world.id}/popout`, file, {}, { notify: false });
  d.clear(); d.deactivate();
  return { path: r?.path, frames: frames.map((f) => f.el), D: Math.round(D_) };
}

/* ================================================================== the token is always in front */

/** Every destruction DisplayObject root a frame may hold in the primary group. */
function destructionRoots() {
  const d = D().display(), r = [];
  if ( d?.objs && !d.objs.destroyed ) r.push(d.objs);
  if ( d?.fx && !d.fx.destroyed ) r.push(d.fx);
  return r;
}
const overlays = async () => {
  const E = await import(`/modules/${MODULE}/scripts/destruction/editor.mjs`);
  // (a build without the hook: the overlay and the cursor are the interface's zIndex 800 / 900 objects that listen to nothing)
  return E._overlays ? E._overlays() : canvas.interface.children.filter((c) => (c.zIndex === 800 || c.zIndex === 900) && c.eventMode === "none" && (c instanceof PIXI.Sprite || c instanceof PIXI.Graphics));
};

/**
 * Scene-graph order test (one frame): the primary group sorted as Foundry sorts it, the carried mesh against everything else; the editor's
 * overlay and cursor (`ui`) must lie in the primary group before the mesh while the token is held (not on the interface above it).
 */
function graphOrder(token, ui = []) {
  const P = canvas.primary, m = token.mesh;
  if ( P.sortDirty ) P.sortChildren();
  const ch = P.children, im = ch.indexOf(m), bad = [];
  const key = (o) => [o.elevation ?? 0, o.sortLayer ?? 0, o.sort ?? 0];
  const less = (a, b) => { const x = key(a), y = key(b); for ( let i = 0; i < 3; i++ ) if ( x[i] !== y[i] ) return x[i] < y[i]; return false; };
  if ( im < 0 ) bad.push(["the mesh is not in the primary group"]);
  for ( const r of destructionRoots() ) { const i = ch.indexOf(r); if ( i < 0 || i > im ) bad.push(["destruction root above/out of the group", r.sortLayer, i, im]); }
  for ( const o of ui ) { const i = ch.indexOf(o); if ( i < 0 || i > im ) bad.push(["editor overlay/cursor above the token", o.constructor.name, i, im]); }
  // everything that sorts below the mesh by its keys must also draw before it (a stale sort order would break this)
  // the carried token also draws over every OTHER token, whatever its `sort` (the order rule of carry-core frontKeys)
  for ( const t of canvas.tokens.placeables ) { const o = t.mesh; if ( !o || o === m || o.destroyed ) continue; const i = ch.indexOf(o); if ( i > im || less(m, o) || !less(o, m) ) bad.push(["another token draws over the carried one", t.document.name, o.sortLayer, o.sort, i, im]); }
  ch.forEach((c, i) => { if ( c !== m && i > im && less(c, m) ) bad.push(["sorted below, drawn above", c.constructor.name, c.sortLayer, i, im]); });
  return { im, n: ch.length, bad };
}

/**
 * A frame's pixel test: the pixels the carried token's mesh covers are the same with the destruction (and the editor's overlay and cursor,
 * `ui`) hidden as with them shown - nothing of the destruction (pieces, debris, dust, accents, water, cache bands, composite, glow, tremor)
 * lies over the token. The token's pixels are those that change when its mesh is hidden too, eroded by a pixel (its soft edge blends with
 * whatever lies under it). Returns { covered (all), coveredRoots (the primary roots only), mask }.
 */
function pixelFront(token, roots, ui = [], rectIn = null) {
  const m = token.mesh, ex = canvas.app.renderer.extract;
  const sc = Math.max(token.w, token.h), rect = rectIn ?? new PIXI.Rectangle(Math.round(m.position.x - sc * 1.2), Math.round(m.position.y - sc * 1.5), Math.round(sc * 2.4), Math.round(sc * 2.6));
  const read = () => { const cv = ex.canvas(canvas.stage, rect); return cv.getContext("2d").getImageData(0, 0, cv.width, cv.height); };
  const full = read();
  const hidden = [];
  const hide = (o) => { if ( o && o.visible ) { o.visible = false; hidden.push(o); } };
  for ( const o of roots ) hide(o);
  const noRoots = read();
  for ( const o of ui ) hide(o);
  const noDestr = read();
  m.visible = false; const noMesh = read(); m.visible = true;
  for ( const o of hidden ) o.visible = true;
  let mask = 0, covered = 0, coveredRoots = 0;
  const a = full.data, b = noDestr.data, t = noMesh.data, q = noRoots.data, thr = 24, W = full.width, H = full.height;
  const dif = (u, v, i) => Math.abs(u[i] - v[i]) > thr || Math.abs(u[i + 1] - v[i + 1]) > thr || Math.abs(u[i + 2] - v[i + 2]) > thr;
  const inMesh = (x, y) => { if ( x < 0 || y < 0 || x >= W || y >= H ) return false; const i = (y * W + x) * 4; return Math.abs(b[i] - t[i]) > 12 || Math.abs(b[i + 1] - t[i + 1]) > 12 || Math.abs(b[i + 2] - t[i + 2]) > 12; };
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    if ( !(inMesh(x, y) && inMesh(x - 1, y) && inMesh(x + 1, y) && inMesh(x, y - 1) && inMesh(x, y + 1)) ) continue;
    const i = (y * W + x) * 4;
    mask++;
    if ( dif(a, b, i) ) covered++;
    if ( dif(a, q, i) ) coveredRoots++;
  }
  return { covered, coveredRoots, mask, w: W, h: H };
}

const zigzag = (c, legs = 6, dx = 90, up = 120, down = 170, per = 60) => {
  const k = [c, ...Array.from({ length: legs + 1 }, (_, i) => ({ x: c.x + i * dx, y: c.y + (i % 2 ? down : -up) }))], o = [];
  for ( let i = 0; i < k.length - 1; i++ ) for ( let j = 0; j < per; j++ ) { const u = j / per; o.push({ x: k[i].x + (k[i + 1].x - k[i].x) * u, y: k[i].y + (k[i + 1].y - k[i].y) * u }); }
  o.push(k.at(-1)); return o;
};

/**
 * THE CARRIED TOKEN IS ALWAYS IN FRONT: a slow zigzag Ctrl-drag (the path doubles back over places the front has already passed), once
 * with the token at elevation 0 and once at elevation 5. Three views:
 *   - while the stroke is drawn (live): the overlay and the cursor are already under the token;
 *   - the clock frozen and stepped through the whole entry and a while after it: in every step the scene-graph order (graphOrder) and the
 *     pixels (pixelFront) say that nothing of the destruction, the overlay or the cursor draws over the token, and the other tokens keep their keys;
 *   - afterwards: the token has Foundry's own keys again, the overlay and the cursor are on the interface, no hold or wait is left.
 * `negative: true` raises the destruction above the tokens on purpose: both tests must then FAIL (the check can see a break).
 */
export async function carryFrontCheck({ steps = 60, legs = 6, dt = 14, negative = false, elevations = [0, 5] } = {}) {
  const M = await mods(), { B, K } = M, d = D();
  const F = await import(`/modules/${MODULE}/scripts/tokens/carry-front.mjs`);
  const rows = [];
  const token = canvas.tokens.placeables.find((t) => !t.document.locked && t.visible);
  if ( !token ) return { ok: false, rows: [row("a token to carry", false)] };
  const doc = token.document, R = canvas.dimensions.sceneRect;
  const home = { x: Math.round(R.x + R.width * 0.1), y: Math.round(R.y + R.height * 0.45) };
  const others = canvas.tokens.placeables.filter((t) => t !== token).map((t) => ({ t, doc: t.document, x: t.document.x, y: t.document.y, sort: t.document.sort }));
  const origin = { x: doc.x, y: doc.y, elevation: doc.elevation };
  const keysOf = (t) => ({ e: t.mesh.elevation, l: t.mesh.sortLayer, s: t.mesh.sort });
  const same = (a, b) => a.e === b.e && a.l === b.l && a.s === b.s;
  const T = canvas.app.ticker, real = performance.now.bind(performance), mf = T.maxFPS, was = T.started;
  const saved = [], report = {};
  try {
    for ( const [i, o] of others.entries() ) await o.doc.update({ x: Math.round(R.x + R.width - 100), y: Math.round(R.y + 60 + i * 120), sort: 5000 + i }, { animate: false, diff: false });   // (their sort is HIGHER than the carried token's: it still draws over them)
    // the clock frozen and stepped through the entry of `o` (its running area `a`) and a while after it
    const observe = async (tag, a, o, ko, key) => {
      const t0 = a.start + a.delay, D_ = a.path.D, bad = [], px = [], moved = [];
      // negative control: the destruction layers raised above the tokens must be caught by both tests
      if ( negative ) { for ( const r of destructionRoots() ) { saved.push([r, r.sortLayer]); r.sortLayer = 800; } canvas.primary.sortDirty = true; }
      let worst = 0, worstRoots = 0, frames = 0, maskMax = 0, entryEnd = null, holdEnd = null;
      const live = () => !!d.display()?.order.some((q) => q.objId === o.id && q.anim);
      T.maxFPS = 0; T.stop();
      try {
        for ( let i = 0; i < steps; i++ ) {
          const el = Math.round(-200 + (D_ + 2200) * i / (steps - 1)), Ft = t0 + el;
          performance.now = () => Ft; T.update(Ft); await sleep(25);
          if ( !token.mesh || token.mesh.destroyed ) continue;
          const inEntry = live(), held = F._frontState().holds.length > 0;
          if ( !inEntry && entryEnd === null && el > 0 ) entryEnd = el;
          if ( !held && holdEnd === null && el > 0 ) holdEnd = el;
          if ( !inEntry && !held ) continue;               // (the entry is over and the token let go: nothing left to hold)
          frames++;
          const ui = await overlays();
          const g = graphOrder(token, ui); if ( g.bad.length ) bad.push({ el, ...g.bad[0] });
          const p = pixelFront(token, destructionRoots(), ui); worst = Math.max(worst, p.covered); worstRoots = Math.max(worstRoots, p.coveredRoots); maskMax = Math.max(maskMax, p.mask);
          if ( p.covered > Math.max(8, p.mask * 0.01) ) px.push({ el, covered: p.covered, roots: p.coveredRoots, mask: p.mask });
          others.forEach((q, j) => { if ( !same(keysOf(q.t), ko[j]) ) moved.push(q.t.name); });
        }
        const Fe = t0 + D_ + 9000; performance.now = () => Fe; T.update(Fe);
      } finally { performance.now = real; T.maxFPS = mf; if ( was ) T.start(); }
      report[key] = { frames, worst, worstRoots, maskMax, D: Math.round(D_), entryEnd, holdEnd };
      rows.push(row(tag + "the token is held until the entry has ended", entryEnd !== null && (holdEnd === null || holdEnd >= entryEnd), { entryEnd, holdEnd }));
      rows.push(row(tag + `scene graph: nothing of the destruction, the overlay or the cursor sorts over the token (${frames} steps)`, frames > steps * 0.5 && bad.length === 0, { bad: bad.slice(0, 3) }));
      rows.push(row(tag + "pixels: nothing of the destruction, the overlay or the cursor covers the token's pixels", frames > steps * 0.5 && maskMax > 400 && px.length === 0, { worst, worstRoots, maskMax, px: px.slice(0, 4) }));
      rows.push(row(tag + "the other tokens keep their keys", moved.length === 0, { moved: [...new Set(moved)] }));
    };
    const scenarios = [...elevations.map((e) => ({ elev: e, ends: "real" })), { elev: elevations[0], ends: "return" }];
    for ( const [si, sc] of scenarios.entries() ) {
      const elev = sc.elev, tag = sc.ends === "return" ? `returns, elevation ${elev}: ` : `elevation ${elev}: `;
      await prep({ ends: sc.ends }); await doc.update({ elevation: elev }, { animate: false, diff: false }); await place(token, home.x, home.y);
      const k0 = keysOf(token), ko = others.map((o) => keysOf(o.t)), c = { x: home.x + token.w / 2, y: home.y + token.h / 2 };
      const before = new Set(strokes().map((o) => o.id));
      // the stroke is being drawn (live): at about 60% of the way the overlay and the cursor must be under the token already
      const pts = zigzag(c, legs), drive = B.drive(pts, { dt, ctrl: true });
      await sleep(pts.length * dt * 0.6);
      const ui0 = await overlays(), gDraw = graphOrder(token, ui0), heldDraw = F._frontState().holds.length;
      await drive;
      rows.push(row(tag + "while the stroke is drawn the grabbed token is held and the overlay and the cursor lie under it", heldDraw === 1 && ui0.length >= 1 && gDraw.bad.length === 0, { held: heldDraw, ui: ui0.length, bad: gDraw.bad.slice(0, 2) }));
      await wait(() => strokes().some((o) => !before.has(o.id)), 4000);
      const o = strokes().find((q) => !before.has(q.id));
      let a = null; await wait(() => { const g = d.display()?.order.find((q) => q.objId === o?.id && q.anim?.path); a = g?.anim ?? null; return !!a; }, 12000, 10);
      rows.push(row(tag + "a slow zigzag Ctrl+drag carries the token", !!o?.tk && !!a, { n: o?.tk?.p?.length, D: a && Math.round(a.path.D) }));
      if ( !a ) continue;
      await observe(tag, a, o, ko, si);
      if ( si === 0 ) {      // a Detonate replay of the same stroke (every other client and a late joiner play it so): the token rides again, in front
        await wait(() => K._carryStats().active === 0, 8000); await sleep(500);
        const pr = K._carryStats().played, old = a.start;
        await d.replay(); await wait(() => K._carryStats().played > pr, 8000);
        let a2 = null; await wait(() => { const g = d.display()?.order.find((q) => q.objId === o.id && q.anim?.path && q.anim.start > old); a2 = g?.anim ?? null; return !!a2; }, 12000, 10);
        if ( a2 ) await observe("replay, " + tag, a2, o, ko, "replay"); else rows.push(row("replay, " + tag + "the replay's entry runs", false));
      }
      await wait(() => K._carryStats().active === 0, 8000); await sleep(1100);
      const st = F._frontState(), ui = await overlays();
      rows.push(row(tag + "afterwards: the token has Foundry's own keys, the overlay and the cursor are on the interface again, no hold or timer is left",
        same(keysOf(token), { e: elev, l: k0.l, s: k0.s }) && st.holds.length === 0 && !st.under && st.pending === 0 && !st.ticking && ui.every((u) => u.parent === canvas.interface), { keys: keysOf(token), k0, st }));
      for ( const [r, l] of saved.splice(0) ) r.sortLayer = l;
      canvas.primary.sortDirty = true;
    }
  } catch ( err ) { rows.push(row(`error: ${err.message}`, false, { stack: String(err.stack).slice(0, 400) })); }
  finally {
    performance.now = real; T.maxFPS = mf; if ( was ) T.start();
    for ( const [r, l] of saved ) r.sortLayer = l;
    canvas.primary.sortDirty = true;
    try { await game.settings.set(MODULE, "destrCarry", false); await game.settings.set(MODULE, "carryEnds", "real"); } catch { /* ignore */ }
    try { await doc.update({ x: origin.x, y: origin.y, elevation: origin.elevation }, { animate: false, diff: false }); for ( const o of others ) await o.doc.update({ x: o.x, y: o.y }, { animate: false, diff: false }); } catch { /* ignore */ }
    d.clear(); d.deactivate();
  }
  return { ok: rows.every((r) => r.ok), rows, report };
}
export const _front = { graphOrder, pixelFront, destructionRoots, zigzag };

/**
 * HEIGHT CONTINUITY OF THE PLAIN CARRY (user bug: a hovering token jumps in height). One token is carried by a real Ctrl+drag twice over the same path: grounded (control) and
 * hovering (a moinen-pixel-vfx flight passive: a held transform lift, `preset`), then once more with a document elevation. Every animation frame the DISPLAYED height is measured:
 * e(t) = mesh.y - (the front's y) = -(hover + pose lift). Checks: the rest height before the grab and after the landing equals the hover (no reset to the ground), the height never dips below
 * the hover in the ride, and the largest per-frame step is the control's own plus a small allowance (the hover adds no step at the grab, the lift-off, the landing or the hand-over).
 * With `ignoreHeight` it also runs the plough over a second, hovering token (Superhero + the "ignores height" setting) and checks that one's per-frame height step too.
 * Returns { ok, rows, numbers }.   await (await import("/modules/moinen-maps/dev/carry-check.mjs")).carryHoverCheck()
 */
export async function carryHoverCheck({ preset = "invincible-flight-wings-passive-monstrous", allow = 2.5, ignoreHeight = true } = {}) {
  const M = await mods(), { K } = M, d = D(), rows = [], numbers = {};
  const API = game.modules.get("moinen-pixel-vfx")?.api;
  const token = canvas.tokens.placeables.find((t) => !t.document.locked && t.visible);
  if ( !token || !API?.ongoing ) return { ok: false, rows: [row("a token and moinen-pixel-vfx", false)] };
  const doc = token.document, G = canvas.grid.size, R = canvas.dimensions.sceneRect;
  const home = { x: Math.round(R.x + R.width * 0.15), y: Math.round(R.y + R.height * 0.45) };
  const cen = () => ({ x: home.x + token.w / 2, y: home.y + token.h / 2 });
  const origin = { x: doc.x, y: doc.y, elevation: doc.elevation };
  const others = canvas.tokens.placeables.filter((t) => t !== token).map((t) => ({ doc: t.document, x: t.document.x, y: t.document.y }));
  for ( const [i, o] of others.entries() ) await o.doc.update({ x: Math.round(R.x + R.width - 100), y: Math.round(R.y + 60 + i * 120) }, { animate: false, diff: false });
  // the DISPLAYED height of a frame: how far the mesh stands above the token's ground position (the container, which the carry moves with the ride and the pose but never lifts by the hover)
  const stats = (r) => {
    const hs = r.rows.map((q) => ({ up: q.ty + token.h / 2 - q.y, f: q.f }));
    let step = 0, at = 0; for ( let i = 1; i < hs.length; i++ ) { const s = Math.abs(hs[i].up - hs[i - 1].up); if ( s > step ) { step = s; at = i; } }
    const first = hs.findIndex((q) => q.f && q.f.el > 0), last = hs.length - 1 - [...hs].reverse().findIndex((q) => q.f && q.f.el < q.f.D);
    const ride = hs.filter((q) => q.f && q.f.el > 0 && q.f.el < q.f.D);
    return { step, atFrame: at, n: hs.length, minUp: ride.length ? Math.min(...ride.map((q) => q.up)) : null, maxUp: ride.length ? Math.max(...ride.map((q) => q.up)) : null,
      beforeUp: hs[Math.max(0, first - 3)]?.up, afterUp: hs.at(-1).up, hoverRead: Math.max(...r.rows.map((q) => q.h ?? 0)) };
  };
  const once = async (label) => { await prep(); await place(token, home.x, home.y); const r = await run(M, token, { ctrl: true, pts: line(cen(), { x: cen().x + 420, y: cen().y + 120 }, 44) }); const st = stats(r); numbers[label] = Object.fromEntries(Object.entries(st).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(2) : v])); return st; };
  try {
    const ctrl = await once("ground");
    rows.push(row(`control (grounded): the pose alone steps ${ctrl.step.toFixed(2)} px per frame at most`, ctrl.n > 20 && ctrl.step < G * 0.2, numbers.ground));
    await API.ongoing.start(token, preset); await sleep(1800);
    const H = API.visual.baseHeight(token); numbers.hover = +H.toFixed(1);
    rows.push(row(`the flight passive hovers the token at ${H.toFixed(1)} px`, H > 10));
    const hv = await once("hover");
    rows.push(row(`hovering: at rest before the grab the token stands ${hv.beforeUp?.toFixed(1)} px up (= its hover ${H.toFixed(1)})`, Math.abs(hv.beforeUp - H) < 2.5, numbers.hover));
    rows.push(row(`hovering: after the landing and the hand-over it stands ${hv.afterUp.toFixed(1)} px up (no reset to the ground, no pop)`, Math.abs(hv.afterUp - H) < 2.5));
    rows.push(row(`hovering: during the ride it never dips below its hover (lowest ${hv.minUp?.toFixed(1)} px >= ${(H - allow).toFixed(1)})`, hv.minUp != null && hv.minUp >= H - allow));
    rows.push(row(`hovering: the largest per-frame height step is ${hv.step.toFixed(2)} px (control ${ctrl.step.toFixed(2)} + ${allow}), at frame ${hv.atFrame}`, hv.step <= ctrl.step + allow, { hv, ctrl }));
    await API.ongoing.stop(token, preset); await sleep(1200);
    await doc.update({ elevation: 5 }, { animate: false }); 
    const el = await once("elevation");
    rows.push(row(`elevation 5 (no vfx hover): the carry's per-frame step is the control's (${el.step.toFixed(2)} vs ${ctrl.step.toFixed(2)})`, el.step <= ctrl.step + 0.5, numbers.elevation));
    await doc.update({ elevation: origin.elevation ?? 0 }, { animate: false });
    rows.push(row("nothing is left running and the visual transform is cleared", K._carryStats().active === 0 && !API.visual.has(token), { has: API.visual.has(token) }));
  } catch ( err ) { rows.push(row(`error: ${err.message}`, false, { stack: String(err.stack).slice(0, 400) })); }
  finally {
    try { await API.ongoing.stop(token, preset); await game.settings.set(MODULE, "destrCarry", false); await game.settings.set(MODULE, "carryEnds", "real"); } catch { /* ignore */ }
    try { await doc.update({ x: origin.x, y: origin.y, elevation: origin.elevation ?? 0 }, { animate: false, diff: false }); for ( const o of others ) await o.doc.update({ x: o.x, y: o.y }, { animate: false, diff: false }); } catch { /* ignore */ }
    d.clear(); d.deactivate();
  }
  return { ok: rows.every((r) => r.ok), rows, numbers };
}
