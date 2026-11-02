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

/** Sample the token's mesh centre every animation frame for `ms`, with where the entry's front says it should be. */
function sampler(token, getObjId) {
  const rows = [], c0 = { x: token.document.x + token.w / 2, y: token.document.y + token.h / 2 };
  let on = true;
  const loop = () => {
    if ( !on ) return;
    const now = performance.now(), id = getObjId(), f = id ? frontAt(id, now) : null, m = token.mesh;
    rows.push({ t: now, x: m.position.x, y: m.position.y, f: f && { x: c0.x + f.x, y: c0.y + f.y, el: f.el, D: f.D } });
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
    try { await doc.update({ x: origin.x, y: origin.y }, { animate: false, diff: false }); for ( const o of others ) await o.doc.update({ x: o.x, y: o.y }, { animate: false, diff: false }); } catch { /* ignore */ }
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
