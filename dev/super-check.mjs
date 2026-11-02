// Browser-side check of SUPERHERO: a carried token ploughs through the tokens on its way (tokens/plough-core.mjs, tokens/carry.mjs). On a lane
// server (a test world), tab FRONTED, as the GM:
//   const S = await import("/modules/moinen-maps/dev/super-check.mjs");  await S.superCheck();   // -> { ok, rows: [{ name, ok, ... }] }
//   await S.superStrip({ name: "plough" });                                  // a frame strip PNG of one plough (worlds/<world>/popout/<name>.png)
// A real PLAYER (separate origin, another tab) sees the same:  S.superWatch()  on the player's page BEFORE the GM paints, then
//   S.superWatchReport()  after the plough ended.
// It drives REAL pointer events (daily-bench drive: Ctrl on every event, button 0) from the carried token over a row of other tokens and
// watches every mesh every animation frame:
//   1  superhero ON, 'moves for real': the stroke keeps tk.hit (the row); every pushed token's DISPLAYED centre stays ahead of the carrier along the
//      path (and each ahead of the one before it), all end at their recorded finals (documents and meshes), every document moves ONCE (one
//      batched update), nobody ends overlapping, Ctrl+Z puts ALL back, Ctrl+Y re-applies;
//   2  a Detonate replay is visual only (no document change, the pushed tokens ride again);
//   3  superhero OFF: no hit, nothing in the row moves at all;
//   4  'returns': the pile rides and every token is back, no document moves;
//   5  locked and hidden tokens are not pushed; a token a user is dragging and one that is controlled are handled;
//   6  snap: finals are on distinct cells; 7 idle: nothing runs.
const MODULE = "moinen-maps";
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const D = () => game.modules.get(MODULE).api.destruction;
const row = (name, ok, extra = {}) => ({ name, ok: !!ok, ...extra });
const wait = async (fn, ms = 9000, step = 60) => { const t = performance.now(); while ( performance.now() - t < ms ) { if ( fn() ) return true; await sleep(step); } return false; };
const strokes = () => D().state().o;
const key = (type, o = {}) => window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...o }));
const nearD = (a, b, e = 2) => Math.abs(a - b) <= e;
const cen = (t) => ({ x: t.document.x + t.w / 2, y: t.document.y + t.h / 2 });

async function mods() {
  return { B: await import(`/modules/${MODULE}/dev/daily-bench.mjs`), K: await import(`/modules/${MODULE}/scripts/tokens/carry.mjs`), X: await import(`/modules/${MODULE}/scripts/tokens/plough-core.mjs`) };
}

/** The scene on screen, the brush in hand, every stroke gone, the settings at what a case wants. */
async function prep({ sup = true, ends = "real", snap = false, latch = false } = {}) {
  const d = D();
  d.clear(); await sleep(1500);
  d.activate("paint");
  await d.setBrush({ size: 1.2, level: 3, type: "blast" });
  await game.settings.set(MODULE, "destrCarry", latch);
  await game.settings.set(MODULE, "destrSuper", sup);
  await game.settings.set(MODULE, "carryEnds", ends);
  await game.settings.set(MODULE, "carrySnap", snap);
  const R = canvas.dimensions.sceneRect;
  canvas.pan({ x: R.x + R.width / 2, y: R.y + R.height / 2, scale: Math.min(innerWidth / R.width, innerHeight / R.height) * 1.1 });
  await sleep(900);
}

/** Put the carrier at its home and the others in a row ahead of it (documents, no animation). Returns the home centre. */
async function layout(carrier, row_, G, R, { gaps = [4.2, 6.6, 9.0, 11.6, 14], dy = [0.2, -0.15, 0.1, 0, 0.15] } = {}) {
  const home = { x: Math.round(R.x + R.width * 0.06), y: Math.round(R.y + R.height * 0.42) };
  const ups = [{ _id: carrier.document.id, x: home.x, y: home.y }];
  const c = { x: home.x + carrier.w / 2, y: home.y + carrier.h / 2 };
  row_.forEach((t, i) => ups.push({ _id: t.document.id, x: Math.round(c.x + gaps[i] * G - t.w / 2), y: Math.round(c.y + dy[i] * G - t.h / 2) }));
  await canvas.scene.updateEmbeddedDocuments("Token", ups.map((u) => ({ ...u, action: "displace" })), { animate: false, diff: false });
  await sleep(350);
  return { home, c };
}

/** A straight line of `n` scene points. */
const line = (a, b, n) => Array.from({ length: n }, (_, i) => ({ x: a.x + (b.x - a.x) * i / (n - 1), y: a.y + (b.y - a.y) * i / (n - 1) }));

/** Every frame: the meshes' centres of `tokens` (and the time). */
function sampler(tokens) {
  const rows = []; let on = true;
  const loop = () => { if ( !on ) return; rows.push({ t: performance.now(), p: tokens.map((t) => (t.mesh && !t.mesh.destroyed ? [t.mesh.position.x, t.mesh.position.y] : [NaN, NaN])) }); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  return { rows, stop: () => { on = false; } };
}

/** One Ctrl+drag over `pts`: waits for the stroke, its carry and everything to settle. */
async function run({ B, K }, tokens, { ctrl = true, pts, dt = 14, settle = 1500, waitPlay = true }) {
  const before = new Set(strokes().map((o) => o.id));
  const s = sampler(tokens), st0 = K._carryStats();
  { const v = canvas.app.view, r = v.getBoundingClientRect(), q = canvas.stage.worldTransform.apply(pts[0]);
    v.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + q.x, clientY: r.top + q.y, pointerId: 1, isPrimary: true, bubbles: true, ctrlKey: ctrl })); await sleep(120); }
  await B.drive(pts, { dt, ctrl });
  await wait(() => strokes().some((o) => !before.has(o.id)), 3000);
  const o = strokes().find((q) => !before.has(q.id)) ?? null;
  if ( o?.tk && waitPlay ) { await wait(() => K._carryStats().played > st0.played, 12000); await wait(() => K._carryStats().active === 0, 12000); }
  await sleep(settle);
  s.stop();
  return { o, rows: s.rows, st0, st1: K._carryStats() };
}

/** Counters on the document updates of tokens (per id) and on the batched calls. */
function watchUpdates() {
  const per = new Map(), calls = []; const scene = canvas.scene, orig = scene.updateEmbeddedDocuments.bind(scene);
  scene.updateEmbeddedDocuments = function(type, ups, opt) { if ( type === "Token" ) calls.push(ups.length); return orig(type, ups, opt); };
  const h = Hooks.on("updateToken", (d, ch) => { if ( "x" in ch || "y" in ch ) per.set(d.id, (per.get(d.id) ?? 0) + 1); });
  return { per, calls, reset() { per.clear(); calls.length = 0; }, stop() { delete scene.updateEmbeddedDocuments; Hooks.off("updateToken", h); } };
}

/** The tokens' centres in the sampler rows against the carrier (index 0): { minGap per pushed token, moved frames } along +x. */
function ahead(rows, tokens, homes, size) {
  const out = tokens.slice(1).map(() => ({ min: Infinity, moved: 0, maxMove: 0 }));
  for ( const r of rows ) {
    const cx = r.p[0][0];
    for ( let i = 1; i < tokens.length; i++ ) {
      const x = r.p[i][0], y = r.p[i][1]; if ( !Number.isFinite(x) ) continue;
      const mv = Math.hypot(x - homes[i].x, y - homes[i].y); out[i - 1].maxMove = Math.max(out[i - 1].maxMove, mv);
      if ( mv > 3 ) { out[i - 1].moved++; out[i - 1].min = Math.min(out[i - 1].min, x - cx); }
    }
  }
  return out;
}

/** Rectangles of the tokens at their documents: any pair overlapping by more than 1 px? */
const clashes = (tokens) => {
  const out = [];
  for ( let i = 0; i < tokens.length; i++ ) for ( let j = i + 1; j < tokens.length; j++ ) {
    const a = tokens[i].document, b = tokens[j].document, A = tokens[i], B = tokens[j];
    if ( Math.min(a.x + A.w, b.x + B.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + A.h, b.y + B.h) - Math.max(a.y, b.y) > 1 ) out.push([a.name, b.name]);
  }
  return out;
};

/** Make sure the scene has `n` tokens (clones of the first; deleted at the end). */
async function ensureTokens(n, made) {
  const have = canvas.tokens.placeables.filter((t) => !t.document.locked);
  if ( have.length >= n ) return;
  const src = have[0].document.toObject(); delete src._id;
  const docs = await canvas.scene.createEmbeddedDocuments("Token", Array.from({ length: n - have.length }, (_, i) => ({ ...src, name: `plough-extra-${i}`, x: src.x + 40 * (i + 1), y: src.y + 120 })), { animate: false });
  for ( const d of docs ) made.push(d.id);
  await sleep(600);
}

export async function superCheck() {
  const M = await mods(), { K } = M, d = D();
  const rows = [], made = [];
  const upd = watchUpdates();
  await ensureTokens(5, made);
  const all = canvas.tokens.placeables.filter((t) => !t.document.locked);
  const carrier = all[0], rowT = all.slice(1, 5);
  const saved = canvas.tokens.placeables.map((t) => ({ doc: t.document, x: t.document.x, y: t.document.y, locked: t.document.locked, hidden: t.document.hidden }));
  const G = canvas.grid.size, R = canvas.dimensions.sceneRect;
  const tokens = [carrier, ...rowT];
  const tickBefore = canvas.app.ticker.count;
  // every other token steps away (the topmost token under the brush is the one carried)
  const rest = canvas.tokens.placeables.filter((t) => !tokens.includes(t));
  for ( const [i, t] of rest.entries() ) await t.document.update({ x: Math.round(R.x + R.width - 2 * G), y: Math.round(R.y + 2 * G + i * 2 * G) }, { animate: false, diff: false });
  try {
    /* 1 superhero on, moves for real */
    await prep(); let { home, c } = await layout(carrier, rowT, G, R);
    const homes = tokens.map(cen);
    const pts = line(c, { x: c.x + 15 * G, y: c.y }, 50);
    upd.reset();
    const r1 = await run(M, tokens, { pts });
    const tk = r1.o?.tk, hits = tk?.hit ?? [];
    rows.push(row("Ctrl+drag with Superhero on: the stroke keeps tk.hit for the row", tk && hits.length >= 3 && hits.every((h) => rowT.some((t) => t.document.id === h.id) && M.X.validHit(h)), { n: hits.length, ids: hits.map((h) => h.id) }));
    const A = ahead(r1.rows, tokens, homes, carrier.w);
    rows.push(row(`every pushed token's displayed centre stays ahead of the carrier along the path (>= ${Math.round(carrier.w - G * 0.45)} px; ${A.map((a) => `${a.moved}f ${a.min.toFixed?.(0)}`).join(", ")})`,
      A.slice(0, hits.length).every((a) => a.moved > 8 && a.min >= carrier.w - G * 0.45), { A: A.map((a) => ({ moved: a.moved, min: +a.min.toFixed(1) })) }));
    // ... and each ahead of the one before it (the pile keeps its order)
    let order = true, worstGap = Infinity;
    const idx = hits.map((h) => tokens.findIndex((t) => t.document.id === h.id));
    for ( const r of r1.rows ) for ( let k = 1; k < idx.length; k++ ) {
      const a = r.p[idx[k - 1]], b = r.p[idx[k]], ha = homes[idx[k - 1]], hb = homes[idx[k]];
      if ( !Number.isFinite(a[0]) || !Number.isFinite(b[0]) ) continue;
      if ( Math.hypot(a[0] - ha.x, a[1] - ha.y) > 3 && Math.hypot(b[0] - hb.x, b[1] - hb.y) > 3 && Math.abs(b[1] - a[1]) < carrier.h * 0.7 ) { worstGap = Math.min(worstGap, b[0] - a[0]); if ( b[0] - a[0] < carrier.w - G * 0.45 ) order = false; }
    }
    rows.push(row("the pile keeps its order (each pushed token ahead of the one that pushes it)", order, { worstGap: Number.isFinite(worstGap) ? +worstGap.toFixed(1) : null }));
    const fin = hits.every((h) => { const dd = canvas.scene.tokens.get(h.id), t = dd.object; return nearD(dd.x, h.x1) && nearD(dd.y, h.y1) && Math.hypot(t.mesh.position.x - (dd.x + t.w / 2), t.mesh.position.y - (dd.y + t.h / 2)) < 1.5; });
    rows.push(row("every pushed token ends at its recorded final (document and mesh there)", fin && tk && nearD(carrier.document.x, tk.x1), { docs: hits.map((h) => { const dd = canvas.scene.tokens.get(h.id); return [dd.x, dd.y, h.x1, h.y1]; }) }));
    rows.push(row("the documents moved once each, in ONE batched update", [carrier.document.id, ...hits.map((h) => h.id)].every((id) => upd.per.get(id) === 1) && upd.calls.length === 1 && upd.calls[0] === hits.length + 1, { per: [...upd.per.values()], calls: [...upd.calls] }));
    rows.push(row("nobody ends overlapping anybody", clashes(tokens).length === 0, { clashes: clashes(tokens) }));
    rows.push(row("a pushed token is not carried alone: the carry's stats count the pile", r1.st1.pushed - r1.st0.pushed === hits.length, { pushed: r1.st1.pushed - r1.st0.pushed }));
    const snapshot = tokens.map((t) => [t.document.x, t.document.y]);
    // Ctrl+Z: all back; Ctrl+Y: all again
    key("keydown", { key: "z", ctrlKey: true }); await sleep(1000);
    const back = tokens.every((t, i) => nearD(t.document.x, i ? (hits.find((h) => h.id === t.document.id)?.x0 ?? t.document.x) : tk.x0) && nearD(t.document.y, i ? (hits.find((h) => h.id === t.document.id)?.y0 ?? t.document.y) : tk.y0));
    rows.push(row("Ctrl+Z: the stroke is gone and ALL the tokens are back at their starts", strokes().length === 0 && back && tokens.every((t, i) => Math.hypot(t.document.x + t.w / 2 - homes[i].x, t.document.y + t.h / 2 - homes[i].y) < 2.5), { docs: tokens.map((t) => [t.document.x, t.document.y]) }));
    const p0 = K._carryStats().played;
    key("keydown", { key: "y", ctrlKey: true }); await wait(() => K._carryStats().played > p0 && K._carryStats().active === 0, 12000); await sleep(800);
    rows.push(row("Ctrl+Y: the stroke is back and all are ploughed to the same finals again", strokes().length === 1 && tokens.every((t, i) => nearD(t.document.x, snapshot[i][0]) && nearD(t.document.y, snapshot[i][1])), { docs: tokens.map((t) => [t.document.x, t.document.y]), snapshot }));

    /* 2 replay */
    upd.reset();
    const pr = K._carryStats().played, atEnd = tokens.map((t) => ({ x: t.document.x, y: t.document.y }));
    const sp = sampler(tokens);
    await d.replay(); await wait(() => K._carryStats().played > pr, 8000); await wait(() => K._carryStats().active === 0, 12000); await sleep(600); sp.stop();
    const away = tokens.map((t, i) => Math.max(...sp.rows.map((q) => Math.hypot(q.p[i][0] - (atEnd[i].x + t.w / 2), q.p[i][1] - (atEnd[i].y + t.h / 2)) || 0)));
    rows.push(row("Detonate replay: the pile rides again, visually only (no document update, all end in place)", away.slice(0, 1 + hits.length).every((a) => a > G * 1.5) && upd.calls.length === 0 && [...upd.per.values()].length === 0
      && tokens.every((t, i) => nearD(t.document.x, atEnd[i].x) && Math.hypot(t.mesh.position.x - (t.document.x + t.w / 2), t.mesh.position.y - (t.document.y + t.h / 2)) < 1.5), { away: away.map(Math.round) }));
    key("keydown", { key: "z", ctrlKey: true }); await sleep(1000);

    /* 3 superhero off */
    await prep({ sup: false }); ({ home, c } = await layout(carrier, rowT, G, R));
    upd.reset();
    const r3 = await run(M, tokens, { pts: line(c, { x: c.x + 15 * G, y: c.y }, 50) });
    const A3 = ahead(r3.rows, tokens, homes, carrier.w);
    rows.push(row("Superhero off: a plain carry (no tk.hit), nothing in the row moves at all", r3.o?.tk && !r3.o.tk.hit && A3.every((a) => a.maxMove < 1) && rowT.every((t, i) => t.document.x === Math.round(homes[i + 1].x - t.w / 2)) && upd.calls.length === 1 && upd.calls[0] === 1, { maxMove: A3.map((a) => +a.maxMove.toFixed(1)), calls: [...upd.calls] }));
    key("keydown", { key: "z", ctrlKey: true }); await sleep(900);

    /* 4 returns */
    await prep({ ends: "return" }); ({ home, c } = await layout(carrier, rowT, G, R));
    upd.reset();
    const r4 = await run(M, tokens, { pts: line(c, { x: c.x + 15 * G, y: c.y }, 50) });
    const A4 = ahead(r4.rows, tokens, homes, carrier.w), h4 = r4.o?.tk?.hit ?? [];
    rows.push(row("'Returns': the pile rides ahead and every token is back at its start; no document moved", r4.o?.tk?.e === 1 && h4.length >= 3 && A4.slice(0, h4.length).every((a) => a.maxMove > G * 2)
      && tokens.every((t, i) => Math.hypot(t.mesh.position.x - homes[i].x, t.mesh.position.y - homes[i].y) < 1.5) && upd.calls.length === 0, { maxMove: A4.map((a) => +a.maxMove.toFixed(0)), calls: [...upd.calls] }));
    key("keydown", { key: "z", ctrlKey: true }); await sleep(900);

    /* 5 locked, hidden, dragged, controlled */
    await prep(); ({ home, c } = await layout(carrier, rowT, G, R));
    await rowT[0].document.update({ locked: true }); await rowT[1].document.update({ hidden: true }); await sleep(300);
    const r5 = await run(M, tokens, { pts: line(c, { x: c.x + 15 * G, y: c.y }, 50), waitPlay: true });
    const ids5 = (r5.o?.tk?.hit ?? []).map((h) => h.id);
    rows.push(row("a locked token and a hidden token are not pushed (the others are)", r5.o?.tk && !ids5.includes(rowT[0].document.id) && !ids5.includes(rowT[1].document.id) && ids5.length >= 1 && rowT[0].document.x === Math.round(homes[1].x - rowT[0].w / 2), { ids5 }));
    key("keydown", { key: "z", ctrlKey: true }); await sleep(900);
    await rowT[0].document.update({ locked: false }); await rowT[1].document.update({ hidden: false });
    ({ home, c } = await layout(carrier, rowT, G, R));
    // the second token is being dragged by a user while the plough plays; the first is controlled
    rowT[0].control({ releaseOthers: true });
    const before5 = new Set(strokes().map((o) => o.id));
    const hook = Hooks.on("updateScene", () => {}); Hooks.off("updateScene", hook);
    const drag = rowT[1];
    const armed = (async () => { await wait(() => strokes().some((o) => !before5.has(o.id) && o.tk?.hit?.length), 6000, 20); Object.defineProperty(drag, "isDragged", { get: () => true, configurable: true }); })();
    const r6 = await run(M, tokens, { pts: line(c, { x: c.x + 15 * G, y: c.y }, 50) });
    await armed; delete drag.isDragged;
    const h6 = r6.o?.tk?.hit ?? [];
    const dragged = h6.find((h) => h.id === drag.document.id), ctrl = h6.find((h) => h.id === rowT[0].document.id);
    rows.push(row("a controlled token is pushed and ends right; one a user is dragging stays where it is (document and mesh)", dragged && ctrl && nearD(rowT[0].document.x, ctrl.x1) && nearD(rowT[0].document.y, ctrl.y1)
      && nearD(drag.document.x, dragged.x0) && nearD(drag.document.y, dragged.y0) && Math.hypot(drag.mesh.position.x - (drag.document.x + drag.w / 2), drag.mesh.position.y - (drag.document.y + drag.h / 2)) < 1.5, { ctrl: !!ctrl, dragged: !!dragged }));
    canvas.tokens.releaseAll();
    key("keydown", { key: "z", ctrlKey: true }); await sleep(900);

    /* 6 snap */
    await prep({ snap: true }); ({ home, c } = await layout(carrier, rowT, G, R, { gaps: [4.2, 5.2, 6.2, 7.2, 8.2], dy: [0.12, -0.1, 0.1, 0, 0.1] }));
    const r7 = await run(M, tokens, { pts: line(c, { x: c.x + 15 * G, y: c.y }, 50) });
    const t7 = r7.o?.tk, h7 = t7?.hit ?? [];
    const cells = [carrier, ...rowT.filter((t) => h7.some((h) => h.id === t.document.id))].map((t) => `${Math.round((t.document.x - R.x) / G)},${Math.round((t.document.y - R.y) / G)}`);
    rows.push(row("snap: pushed tokens end on distinct grid cells (and the ones left alone do not share one)", h7.length >= 3 && new Set(cells).size === cells.length && h7.every((h) => (h.x1 - R.x) % G === 0 && (h.y1 - R.y) % G === 0) && clashes(tokens).length === 0, { cells }));
    key("keydown", { key: "z", ctrlKey: true }); await sleep(900);

    /* 7 idle */
    await prep(); await layout(carrier, rowT, G, R);
    await sleep(600);
    rows.push(row("idle: no carry running, no ticker listener left by the carry", K._carryStats().active === 0 && !K._carryStats().ticking && canvas.app.ticker.count <= tickBefore + 1, { ticker: canvas.app.ticker.count, before: tickBefore }));
  } catch ( err ) { rows.push(row(`error: ${err.message}`, false, { stack: String(err.stack).slice(0, 500) })); }
  finally {
    try { await game.settings.set(MODULE, "destrCarry", false); await game.settings.set(MODULE, "destrSuper", false); await game.settings.set(MODULE, "carryEnds", "real"); await game.settings.set(MODULE, "carrySnap", false); } catch { /* ignore */ }
    upd.stop(); d.clear(); d.deactivate();
    try {
      canvas.tokens.releaseAll();
      if ( made.length ) await canvas.scene.deleteEmbeddedDocuments("Token", made);
      await canvas.scene.updateEmbeddedDocuments("Token", saved.filter((o) => !made.includes(o.doc.id) && canvas.scene.tokens.has(o.doc.id)).map((o) => ({ _id: o.doc.id, x: o.x, y: o.y, locked: o.locked, hidden: o.hidden })), { animate: false, diff: false });
    } catch { /* ignore */ }
  }
  return { ok: rows.every((r) => r.ok), rows };
}

/**
 * A frame strip of one plough: the screen region around the row, `n` frames (the clock is frozen and stepped by hand, as carryStrip does),
 * the milliseconds since the front started written on each; uploaded to worlds/<world>/popout/<name>.png.
 */
export async function superStrip({ name = "plough", n = 10, size = 0.62, count = 4, reach = 13 } = {}) {
  const M = await mods(), { B, K } = M, d = D(), made = [];
  await ensureTokens(count + 1, made);
  const all = canvas.tokens.placeables.filter((t) => !t.document.locked);
  const carrier = all[0], rowT = all.slice(1, 1 + count);
  const G = canvas.grid.size, R = canvas.dimensions.sceneRect;
  const saved = canvas.tokens.placeables.map((t) => ({ _id: t.document.id, x: t.document.x, y: t.document.y }));
  const rest = canvas.tokens.placeables.filter((t) => t !== carrier && !rowT.includes(t));
  for ( const [i, t] of rest.entries() ) await t.document.update({ x: Math.round(R.x + R.width - 2 * G), y: Math.round(R.y + 2 * G + i * 2 * G) }, { animate: false, diff: false });
  await prep(); const { c } = await layout(carrier, rowT, G, R);
  const pts = line(c, { x: c.x + reach * G, y: c.y + 0.4 * G }, 50);
  const before = new Set(strokes().map((o) => o.id));
  const rect = new PIXI.Rectangle(Math.round(c.x - 1.5 * G), Math.round(c.y - 4 * G), Math.round((reach + 7) * G), Math.round(8 * G));
  await B.drive(pts, { dt: 14, ctrl: true });
  await wait(() => strokes().some((o) => !before.has(o.id)), 3000);
  const id = strokes().find((o) => !before.has(o.id)).id;
  let a = null; await wait(() => { const g = d.display().order.find((q) => q.objId === id && q.anim?.path); a = g?.anim ?? null; return !!a; }, 12000, 10);
  const t0 = a.start + a.delay, D_ = a.path.D, frames = [];
  const T = canvas.app.ticker, real = performance.now.bind(performance), mf = T.maxFPS, was = T.started;
  T.maxFPS = 0; T.stop();
  try {
    for ( let i = 0; i < n; i++ ) {
      const el = Math.round(-40 + (D_ + 700) * i / (n - 1)), F = t0 + el;
      performance.now = () => F; T.update(F); await sleep(40);
      frames.push({ cv: canvas.app.renderer.extract.canvas(canvas.stage, rect), el });
    }
    const Fe = t0 + D_ + 5000; performance.now = () => Fe; T.update(Fe);
  } finally { performance.now = real; T.maxFPS = mf; if ( was ) T.start(); }
  await wait(() => K._carryStats().active === 0, 8000);
  const w = Math.round(rect.width * size), h = Math.round(rect.height * size), cols = 2, rowsN = Math.ceil(n / cols);
  const out = new OffscreenCanvas(cols * (w + 4), rowsN * (h + 4)), ctx = out.getContext("2d");
  ctx.fillStyle = "#222"; ctx.fillRect(0, 0, out.width, out.height);
  frames.forEach((f, i) => { const x = (i % cols) * (w + 4), y = Math.floor(i / cols) * (h + 4); ctx.drawImage(f.cv, x, y, w, h); ctx.fillStyle = "#000a"; ctx.fillRect(x, y, 70, 18); ctx.fillStyle = "#6fe0ff"; ctx.font = "13px monospace"; ctx.fillText(`${f.el} ms`, x + 4, y + 13); });
  const file = new File([await out.convertToBlob({ type: "image/png" })], name + ".png", { type: "image/png" }), fp = foundry.applications.apps.FilePicker.implementation;
  try { await fp.createDirectory("data", `worlds/${game.world.id}/popout`); } catch { /* exists */ }
  const r = await fp.upload("data", `worlds/${game.world.id}/popout`, file, {}, { notify: false });
  d.clear(); d.deactivate();
  try { await game.settings.set(MODULE, "destrSuper", false); if ( made.length ) await canvas.scene.deleteEmbeddedDocuments("Token", made); await canvas.scene.updateEmbeddedDocuments("Token", saved.filter((o) => canvas.scene.tokens.has(o._id)), { animate: false, diff: false }); } catch { /* ignore */ }
  return { path: r?.path, frames: frames.map((f) => f.el), D: Math.round(D_) };
}

/* ================================================================== a player's page */

/** On a PLAYER's page, before the GM paints: record every token's mesh every frame. */
export function superWatch() {
  const tokens = canvas.tokens.placeables, K = import(`/modules/${MODULE}/scripts/tokens/carry.mjs`);
  const s = sampler(tokens), w = window.__superWatch = { s, ids: tokens.map((t) => t.document.id), homes: tokens.map(cen), K };
  return { watching: tokens.length, user: game.user.name, gm: game.user.isGM };
}

/** After the plough ended: what the player saw. */
export async function superWatchReport() {
  const w = window.__superWatch; w.s.stop();
  const K = await w.K, o = strokes().filter((q) => q.tk?.hit?.length).at(-1), tk = o?.tk, hits = tk?.hit ?? [];
  const tokens = w.ids.map((id) => canvas.tokens.get(id));
  const ix = (id) => w.ids.indexOf(id), ci = ix(tk?.id);
  const out = { user: game.user.name, gm: game.user.isGM, stroke: !!o, hits: hits.length, stats: K._carryStats() };
  out.rows = hits.map((h) => {
    const i = ix(h.id), t = tokens[i]; let moved = 0, min = Infinity, away = 0;
    for ( const r of w.s.rows ) { const x = r.p[i][0], y = r.p[i][1]; if ( !Number.isFinite(x) ) continue; const mv = Math.hypot(x - w.homes[i].x, y - w.homes[i].y); away = Math.max(away, mv); if ( mv > 3 ) { moved++; min = Math.min(min, x - r.p[ci][0]); } }
    return { id: h.id, moved, minAhead: Number.isFinite(min) ? +min.toFixed(1) : null, away: Math.round(away), doc: [t.document.x, t.document.y], final: [h.x1, h.y1], atFinal: nearD(t.document.x, h.x1) && nearD(t.document.y, h.y1), meshOnDoc: Math.hypot(t.mesh.position.x - (t.document.x + t.w / 2), t.mesh.position.y - (t.document.y + t.h / 2)) < 1.5 };
  });
  out.ok = !!o && hits.length >= 3 && out.rows.every((r) => r.moved > 8 && r.minAhead >= tokens[0].w - canvas.grid.size * 0.45 && r.atFinal && r.meshOnDoc);
  return out;
}

/* ================================================================== the live case for a player's page (three calls on the GM's page) */

/** 1) GM page: the row is laid out and the brush is in hand (settings: Superhero on, moves for real). Then arm superWatch() on the player's page. */
export async function superSetup() {
  const made = [], M = await mods();
  await ensureTokens(5, made);
  const all = canvas.tokens.placeables.filter((t) => !t.document.locked), carrier = all[0], rowT = all.slice(1, 5);
  const G = canvas.grid.size, R = canvas.dimensions.sceneRect;
  const saved = canvas.tokens.placeables.map((t) => ({ _id: t.document.id, x: t.document.x, y: t.document.y }));
  const rest = canvas.tokens.placeables.filter((t) => t !== carrier && !rowT.includes(t));
  for ( const [i, t] of rest.entries() ) await t.document.update({ x: Math.round(R.x + R.width - 2 * G), y: Math.round(R.y + 2 * G + i * 2 * G) }, { animate: false, diff: false });
  await prep(); const { c } = await layout(carrier, rowT, G, R);
  window.__sup = { M, made, saved, carrier, rowT, G, c, tokens: [carrier, ...rowT] };
  return { carrier: carrier.document.name, row: rowT.map((t) => t.document.name) };
}
/** 2) GM page: paint the plough (the player's page is watching), wait until it is over. */
export async function superPaint() {
  const s = window.__sup, r = await run(s.M, s.tokens, { pts: line(s.c, { x: s.c.x + 15 * s.G, y: s.c.y }, 50) });
  return { tk: !!r.o?.tk, hits: r.o?.tk?.hit?.length ?? 0, finals: (r.o?.tk?.hit ?? []).map((h) => [h.x1, h.y1]), docs: s.tokens.map((t) => [t.document.x, t.document.y]) };
}
/** 3) GM page, after the player's report: put everything back. */
export async function superTeardown() {
  const s = window.__sup, d = D();
  d.clear(); d.deactivate(); await game.settings.set(MODULE, "destrSuper", false);
  if ( s.made.length ) await canvas.scene.deleteEmbeddedDocuments("Token", s.made);
  await canvas.scene.updateEmbeddedDocuments("Token", s.saved.filter((o) => canvas.scene.tokens.has(o._id)), { animate: false, diff: false });
  return true;
}
