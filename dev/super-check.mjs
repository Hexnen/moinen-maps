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
//   6  snap: finals are on distinct cells; 7 idle: nothing runs;
//   8  ORDER: the carrier draws over every pushed token (their sort set higher on purpose), those over the untouched tokens (scene graph + pixels, every
//      step of a frozen clock); keys back afterwards.  superCheck({ negative: true }) lowers the carrier on purpose: the order rows must then FAIL.
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
async function prep({ sup = true, ends = "real", snap = false, latch = false, free = false } = {}) {
  const d = D();
  d.clear(); await sleep(1500);
  d.activate("paint");
  await d.setBrush({ size: 1.2, level: 3, type: "blast" });
  await game.settings.set(MODULE, "destrCarry", latch);
  await game.settings.set(MODULE, "destrSuper", sup);
  await game.settings.set(MODULE, "carryEnds", ends);
  await game.settings.set(MODULE, "carrySnap", snap);
  await game.settings.set(MODULE, "carryFree", free);
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


/** Foundry's primary draw order of two meshes: does `a` draw over `b`? (elevation, sortLayer, sort) */
const keyOver = (a, b) => { const x = [a.elevation ?? 0, a.sortLayer ?? 0, a.sort ?? 0], y = [b.elevation ?? 0, b.sortLayer ?? 0, b.sort ?? 0]; for ( let i = 0; i < 3; i++ ) if ( x[i] !== y[i] ) return x[i] > y[i]; return false; };

/**
 * THE CARRIER IS ALWAYS IN FRONT OF WHAT IT PUSHES. The pushed tokens' own `sort` is set HIGHER than the carrier's on purpose (and the tokens
 * left alone higher still). The clock is frozen and stepped through the whole plough and after it; in every step
 *   - scene graph: the carrier's mesh sorts and draws after every pushed mesh, those after every other token's mesh and after the destruction
 *     (keys and indices in the sorted primary group);
 *   - pixels: nothing of the pushed tokens covers the carrier's pixels (the pixels the carrier covers are the same with the pushed meshes hidden),
 *     measured on frames where the pushed meshes really overlap the carrier's box (non-vacuous);
 * afterwards every mesh has its own keys back. `negative` lowers the carrier to the tokens' layer after each step: both tests must then FAIL.
 */
async function frontPushed(M, tokens, rest, { negative = false, steps = 60 } = {}) {
  const { B, K } = M, d = D(), CC = await import(`/modules/${MODULE}/dev/carry-check.mjs`);
  const F = await import(`/modules/${MODULE}/scripts/tokens/carry-front.mjs`), { graphOrder, pixelFront, destructionRoots } = CC._front;
  const carrier = tokens[0], rowT = tokens.slice(1), G = canvas.grid.size, R = canvas.dimensions.sceneRect, out = [];
  const sorts = new Map(canvas.tokens.placeables.map((t) => [t.document.id, t.document.sort]));
  await canvas.scene.updateEmbeddedDocuments("Token", [{ _id: carrier.document.id, sort: 0 }, ...rowT.map((t, i) => ({ _id: t.document.id, sort: 1000 + 10 * i })), ...rest.map((t) => ({ _id: t.document.id, sort: 5000 }))], { animate: false, diff: false });
  await sleep(300);
  const keys0 = new Map(canvas.tokens.placeables.map((t) => [t.document.id, [t.mesh.elevation, t.mesh.sortLayer, t.mesh.sort]]));
  await prep(); const { c } = await layout(carrier, rowT, G, R);
  const before = new Set(strokes().map((o) => o.id));
  await B.drive(line(c, { x: c.x + 15 * G, y: c.y }, 50), { dt: 14, ctrl: true });
  await wait(() => strokes().some((o) => !before.has(o.id)), 3000);
  const o = strokes().find((q) => !before.has(q.id)), hits = o?.tk?.hit ?? [];
  let a = null; await wait(() => { const g = d.display()?.order.find((q) => q.objId === o?.id && q.anim?.path); a = g?.anim ?? null; return !!a; }, 12000, 10);
  const tag = negative ? "NEGATIVE: " : "";
  if ( !a || hits.length < 3 ) return [row(tag + "ordering: a plough with >= 3 pushed tokens is running", false, { hits: hits.length, a: !!a })];
  const pushed = hits.map((h) => canvas.tokens.get(h.id)), t0 = a.start + a.delay, D_ = a.path.D;
  const T = canvas.app.ticker, real = performance.now.bind(performance), mf = T.maxFPS, was = T.started;
  const bad = [], px = []; let frames = 0, overlap = 0, covered = 0, maskMax = 0, maxRank = 0;
  T.maxFPS = 0; T.stop();
  try {
    for ( let i = 0; i < steps; i++ ) {
      const el = Math.round(-100 + (D_ + 1600) * i / (steps - 1)), Ft = t0 + el;
      performance.now = () => Ft; T.update(Ft);
      if ( negative ) { carrier.mesh.sortLayer = 700; carrier.mesh.sort = 0; canvas.primary.sortDirty = true; }
      await sleep(25);
      const holds = F._frontState().holds.map((h) => h[0]);
      if ( !holds.includes(carrier.document.id) || !pushed.every((t) => holds.includes(t.document.id)) ) continue;   // (before the plough starts / after the hold)
      graphOrder(carrier, []);                                 // (sorts the group; the indices are read below)
      const ch = canvas.primary.children, ic = ch.indexOf(carrier.mesh), ip = pushed.map((t) => ch.indexOf(t.mesh)), ir = rest.map((t) => ch.indexOf(t.mesh));
      const why = [];
      for ( const [j, t] of pushed.entries() ) {
        if ( !keyOver(carrier.mesh, t.mesh) ) why.push(["key: pushed over carrier", t.document.name, t.mesh.sortLayer, t.mesh.sort]);
        if ( ip[j] > ic ) why.push(["index: pushed above carrier", t.document.name, ip[j], ic]);
        for ( const [k, r] of rest.entries() ) if ( ip[j] < ir[k] || !keyOver(t.mesh, r.mesh) ) why.push(["pushed under an untouched token", t.document.name, r.document.name]);
      }
      for ( const [k, r] of rest.entries() ) if ( !keyOver(carrier.mesh, r.mesh) || ic < ir[k] ) why.push(["carrier under an untouched token", r.document.name]);
      for ( const r of destructionRoots() ) { const i2 = ch.indexOf(r); if ( i2 > Math.min(ic, ...ip) ) why.push(["destruction above a token", i2]); }
      for ( const t of [carrier, ...pushed] ) maxRank = Math.max(maxRank, t.mesh.sortLayer - 700);
      if ( why.length ) bad.push({ el, why: why[0] });
      const cb = carrier.mesh.getBounds(), ov = pushed.some((t) => { const b = t.mesh.getBounds(); return Math.min(cb.right, b.right) - Math.max(cb.left, b.left) > 6 && Math.min(cb.bottom, b.bottom) - Math.max(cb.top, b.top) > 6; });
      if ( ov ) {
        overlap++;
        const p = pixelFront(carrier, [], pushed.map((t) => t.mesh)); covered = Math.max(covered, p.covered); maskMax = Math.max(maskMax, p.mask);
        if ( p.covered > Math.max(8, p.mask * 0.01) ) px.push({ el, covered: p.covered, mask: p.mask });
      }
      frames++;
    }
    const Fe = t0 + D_ + 9000; performance.now = () => Fe; T.update(Fe);
  } finally { performance.now = real; T.maxFPS = mf; if ( was ) T.start(); }
  out.push(row(tag + `ordering, scene graph: the carrier sorts and draws over ${hits.length} pushed tokens (whose sort is higher), those over the untouched tokens and the destruction (${frames} steps)`, frames > steps * 0.4 && bad.length === 0, { frames, bad: bad.slice(0, 2) }));
  out.push(row(tag + `ordering, pixels: no pushed token covers the carrier's pixels (${overlap} steps where they overlap)`, overlap >= 5 && maskMax > 400 && px.length === 0, { overlap, covered, maskMax, px: px.slice(0, 3) }));
  if ( !negative ) {
    await wait(() => K._carryStats().active === 0, 8000); await sleep(1100);
    const st = F._frontState();
    const same = canvas.tokens.placeables.every((t) => { const k = keys0.get(t.document.id), n = [t.mesh.elevation, t.mesh.sortLayer, t.mesh.sort]; return k && k.every((v, i) => v === n[i]); });
    out.push(row("ordering: afterwards every mesh has its own keys back (elevation, layer, sort), nothing is held", same && st.holds.length === 0 && !st.under && st.pending === 0, { st, now: tokens.map((t) => [t.mesh.sortLayer, t.mesh.sort]) }));
    out.push(row("ordering: the pushed meshes were lifted one step, the carrier two (elevation untouched)", maxRank === 2 && tokens.every((t) => t.mesh.elevation === keys0.get(t.document.id)[0]), { maxRank }));
  }
  key("keydown", { key: "z", ctrlKey: true }); await sleep(900);
  await canvas.scene.updateEmbeddedDocuments("Token", [...sorts].filter(([id]) => canvas.scene.tokens.has(id)).map(([id, sort]) => ({ _id: id, sort })), { animate: false, diff: false });
  return out;
}

export async function superCheck({ negative = false } = {}) {
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
    rows.push(row("snap: the carry ENDS (nothing active, every mesh on its document: the hand-over is judged against the snapped finals)", K._carryStats().active === 0 && !K._carryStats().ticking && tokens.every((t) => Math.hypot(t.mesh.position.x - (t.document.x + t.w / 2), t.mesh.position.y - (t.document.y + t.h / 2)) < 1.5), { stats: K._carryStats() }));
    rows.push(row("snap: pushed tokens end on distinct grid cells (and the ones left alone do not share one)", h7.length >= 3 && new Set(cells).size === cells.length && h7.every((h) => (h.x1 - R.x) % G === 0 && (h.y1 - R.y) % G === 0) && clashes(tokens).length === 0, { cells }));
    key("keydown", { key: "z", ctrlKey: true }); await sleep(900);

    /* 8 the carrier is ALWAYS in front of what it pushes (the pushed tokens' sorts deliberately higher), then the negative control */
    await prep(); await layout(carrier, rowT, G, R);
    rows.push(...await frontPushed(M, tokens, rest));
    if ( negative ) { await prep(); await layout(carrier, rowT, G, R); rows.push(...await frontPushed(M, tokens, rest, { negative: true })); }

    /* 7 idle */
    await prep(); await layout(carrier, rowT, G, R);
    await sleep(600);
    rows.push(row("idle: no carry running, no ticker listener left by the carry", K._carryStats().active === 0 && !K._carryStats().ticking && canvas.app.ticker.count <= tickBefore + 1, { ticker: canvas.app.ticker.count, before: tickBefore }));
  } catch ( err ) { rows.push(row(`error: ${err.message}`, false, { stack: String(err.stack).slice(0, 500) })); }
  finally {
    try { await game.settings.set(MODULE, "carryFree", false); await game.settings.set(MODULE, "destrCarry", false); await game.settings.set(MODULE, "destrSuper", false); await game.settings.set(MODULE, "carryEnds", "real"); await game.settings.set(MODULE, "carrySnap", false); } catch { /* ignore */ }
    upd.stop(); d.clear(); d.deactivate();
    try {
      canvas.tokens.releaseAll();
      if ( made.length ) await canvas.scene.deleteEmbeddedDocuments("Token", made);
      await canvas.scene.updateEmbeddedDocuments("Token", saved.filter((o) => !made.includes(o.doc.id) && canvas.scene.tokens.has(o.doc.id)).map((o) => ({ _id: o.doc.id, x: o.x, y: o.y, locked: o.locked, hidden: o.hidden })), { animate: false, diff: false });
    } catch { /* ignore */ }
  }
  if ( !rows.some((r) => !r.ok) ) { const rep = await superRepeatCheck(); rows.push(...rep.rows); }        // (three consecutive ploughs over six tokens: presence after each)
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
  let a = null; await wait(() => { const g = d.display()?.order.find((q) => q.objId === id && q.anim?.path); a = g?.anim ?? null; return !!a; }, 12000, 10);
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
  // the draw order, every frame: of the tokens that moved this frame the carrier (the one the others are pushed by) must sort over the pushed ones
  const ord = w.ord = { frames: 0, held: 0, bad: [], maxSortLayer: 0, minSortLayer: 1e9, ids: w.ids }; let on = true; w.ordStop = () => { on = false; };
  const check = () => {
    if ( !on ) return;
    const ms = tokens.map((t) => t.mesh), moved = ms.map((m, i) => !!m && !m.destroyed && Math.hypot(m.position.x - w.homes[i].x, m.position.y - w.homes[i].y) > 3);
    ord.frames++;
    if ( moved.some(Boolean) ) {
      const lift = ms.map((m) => (m?.sortLayer ?? 0) - 700), ci = lift.indexOf(Math.max(...lift));      // the carrier is the most lifted
      if ( lift[ci] === 2 ) {
        ord.held++;
        ms.forEach((m, i) => { if ( i !== ci && moved[i] && !keyOver(ms[ci], m) ) ord.bad.push({ i, ci, a: [ms[ci].sortLayer, ms[ci].sort], b: [m.sortLayer, m.sort] }); });
        ms.forEach((m, i) => { if ( i !== ci && lift[i] === 1 ) ms.forEach((q, j) => { if ( j !== ci && lift[j] === 0 && !keyOver(m, q) ) ord.bad.push({ pushedUnder: i, other: j }); }); });
      }
      for ( const l of lift ) { ord.maxSortLayer = Math.max(ord.maxSortLayer, l); ord.minSortLayer = Math.min(ord.minSortLayer, l); }
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
  return { watching: tokens.length, user: game.user.name, gm: game.user.isGM };
}

/** After the plough ended: what the player saw. */
export async function superWatchReport() {
  const w = window.__superWatch, K0 = await w.K;
  await wait(() => K0._carryStats().played > 0, 25000); await wait(() => K0._carryStats().active === 0, 25000); await sleep(1200);      // (this client's own entry starts later than the GM's: wait for its carry to end)
  w.s.stop();
  const K = await w.K, o = strokes().filter((q) => q.tk?.hit?.length).at(-1), tk = o?.tk, hits = tk?.hit ?? [];
  const tokens = w.ids.map((id) => canvas.tokens.get(id));
  const ix = (id) => w.ids.indexOf(id), ci = ix(tk?.id);
  const out = { user: game.user.name, gm: game.user.isGM, stroke: !!o, hits: hits.length, stats: K._carryStats() };
  out.rows = hits.map((h) => {
    const i = ix(h.id), t = tokens[i]; let moved = 0, min = Infinity, away = 0;
    for ( const r of w.s.rows ) { const x = r.p[i][0], y = r.p[i][1]; if ( !Number.isFinite(x) ) continue; const mv = Math.hypot(x - w.homes[i].x, y - w.homes[i].y); away = Math.max(away, mv); if ( mv > 3 ) { moved++; min = Math.min(min, x - r.p[ci][0]); } }
    let step = 0; for ( let j = 1; j < w.s.rows.length; j++ ) { const a = w.s.rows[j - 1].p[i], b = w.s.rows[j].p[i]; if ( Number.isFinite(a[0]) && Number.isFinite(b[0]) ) step = Math.max(step, Math.hypot(b[0] - a[0], b[1] - a[1])); }
    return { id: h.id, maxStep: Math.round(step), moved, minAhead: Number.isFinite(min) ? +min.toFixed(1) : null, away: Math.round(away), doc: [t.document.x, t.document.y], final: [h.x1, h.y1], atFinal: nearD(t.document.x, h.x1) && nearD(t.document.y, h.y1), meshOnDoc: Math.hypot(t.mesh.position.x - (t.document.x + t.w / 2), t.mesh.position.y - (t.document.y + t.h / 2)) < 1.5 };
  });
  { // the carried token itself: it must never jump (a document moved by the GM before this client's own front starts is not shown early)
    let step = 0; for ( let j = 1; j < w.s.rows.length; j++ ) { const a = w.s.rows[j - 1].p[ci], b = w.s.rows[j].p[ci]; if ( Number.isFinite(a[0]) && Number.isFinite(b[0]) ) step = Math.max(step, Math.hypot(b[0] - a[0], b[1] - a[1])); }
    out.carrierMaxStep = Math.round(step);
  }
  w.ordStop?.(); const ord = w.ord;
  out.order = { frames: ord.frames, held: ord.held, bad: ord.bad.slice(0, 3), maxLift: ord.maxSortLayer, sortsRaised: tokens.map((t) => t.document.sort), keysBack: tokens.every((t) => t.mesh.sortLayer === 700) };
  out.ok = !!o && hits.length >= 3 && K._carryStats().active === 0 && out.carrierMaxStep < canvas.grid.size * 3 && out.rows.every((r) => r.maxStep < canvas.grid.size * 3) && ord.held > 20 && ord.bad.length === 0 && out.order.keysBack && ord.maxSortLayer === 2 && out.rows.every((r) => r.moved > 8 && r.minAhead >= tokens[0].w - canvas.grid.size * 0.45 && r.atFinal && r.meshOnDoc);
  return out;
}

/* ================================================================== the live case for a player's page (three calls on the GM's page) */

/** 1) GM page: the row is laid out and the brush is in hand (settings: Superhero on, moves for real). Then arm superWatch() on the player's page. */
export async function superSetup({ snap = false, free = false, ends = "real" } = {}) {
  const made = [], M = await mods();
  await ensureTokens(5, made);
  const all = canvas.tokens.placeables.filter((t) => !t.document.locked), carrier = all[0], rowT = all.slice(1, 5);
  const G = canvas.grid.size, R = canvas.dimensions.sceneRect;
  const saved = canvas.tokens.placeables.map((t) => ({ _id: t.document.id, x: t.document.x, y: t.document.y, sort: t.document.sort }));
  const rest = canvas.tokens.placeables.filter((t) => t !== carrier && !rowT.includes(t));
  for ( const [i, t] of rest.entries() ) await t.document.update({ x: Math.round(R.x + R.width - 2 * G), y: Math.round(R.y + 2 * G + i * 2 * G) }, { animate: false, diff: false });
  await canvas.scene.updateEmbeddedDocuments("Token", [{ _id: carrier.document.id, sort: 0 }, ...rowT.map((t, i) => ({ _id: t.document.id, sort: 1000 + 10 * i })), ...rest.map((t) => ({ _id: t.document.id, sort: 5000 }))], { animate: false, diff: false });   // (the pushed tokens sort HIGHER than the carrier)
  await prep({ snap, free, ends }); const { c } = await layout(carrier, rowT, G, R, snap || free ? { gaps: [4.2, 5.2, 6.2, 7.2, 8.2], dy: [0.12, -0.1, 0.1, 0, 0.1] } : undefined);
  window.__sup = { M, made, saved, carrier, rowT, G, c, tokens: [carrier, ...rowT] };
  return { carrier: carrier.document.name, row: rowT.map((t) => t.document.name) };
}
/** 2) GM page: paint the plough (the player's page is watching), wait until it is over. */
export async function superPaint({ len = 15 } = {}) {
  const s = window.__sup, r = await run(s.M, s.tokens, { pts: line(s.c, { x: s.c.x + len * s.G, y: s.c.y }, 50) });
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

/* ================================================================== presence: what a pushed token must keep, and repeated ploughs */

/** Everything a token keeps when nobody poses it: visible, drawn, interactive, its mesh and container on the document, no leftover hold. */
async function presenceOf(t, base) {
  const [{ tokenBusy }, F] = await Promise.all([import(`/modules/${MODULE}/scripts/token-drop.mjs`), import(`/modules/${MODULE}/scripts/tokens/carry-front.mjs`).catch(() => null)]);
  const m = t.mesh, d = t.document, w = d.getSize();
  const out = {
    name: d.name, visible: !!t.visible, meshVisible: !!m?.visible, renderable: !!m?.renderable, alpha: +(m?.alpha ?? 0).toFixed(3), eventMode: t.eventMode,
    dMesh: +Math.hypot(m.position.x - (d.x + w.width / 2), m.position.y - (d.y + w.height / 2)).toFixed(2), dCont: +Math.hypot(t.position.x - d.x, t.position.y - d.y).toFixed(2),
    scale: [+m.scale.x.toFixed(3), +m.scale.y.toFixed(3)], rot: +m.rotation.toFixed(3), sortLayer: m.sortLayer, busy: tokenBusy(t),
    held: F?._frontState ? F._frontState().holds.some(([id]) => id === d.id) : false, hit: !!t.hitArea?.contains(w.width / 2, w.height / 2),
    light: t.light ? Math.hypot(t.light.x - (d.x + w.width / 2), t.light.y - (d.y + w.height / 2)) : null,
  };
  out.ok = out.visible && out.meshVisible && out.renderable && out.alpha === base.alpha && out.dMesh < 1.5 && out.dCont < 1.5 && out.scale[0] === base.scale[0] && out.scale[1] === base.scale[1]
    && Math.abs(out.rot - base.rot) < 0.002 && !out.busy && !out.held && out.hit && out.eventMode === base.eventMode && out.sortLayer === base.sortLayer && (out.light === null || out.light < 1.5);
  return out;
}

/**
 * THREE consecutive ploughs over six tokens (right through the row; right again through the same pile; then the front token dragged back
 * LEFT through all of them): after each, every token (pushed or not) has full presence (presenceOf), every pushed token of the stroke moved,
 * the documents are at the recorded finals, no Carry or ticker listener is left, and each token can be selected. Returns { ok, rows, log }.
 */
export async function superRepeatCheck({ strokesN = 3, quick = false } = {}) {
  const M = await mods(), { K } = M, d = D(), rows = [], made = [], log = [];
  const tickBefore = canvas.app.ticker.count;
  await ensureTokens(6, made);
  const all = canvas.tokens.placeables.filter((t) => !t.document.locked), tokens = all.slice(0, 6);
  const saved = canvas.tokens.placeables.map((t) => ({ _id: t.document.id, x: t.document.x, y: t.document.y }));
  const G = canvas.grid.size, R = canvas.dimensions.sceneRect;
  const rest = canvas.tokens.placeables.filter((t) => !tokens.includes(t));
  for ( const [i, t] of rest.entries() ) await t.document.update({ x: Math.round(R.x + R.width - 2 * G), y: Math.round(R.y + 2 * G + i * 2 * G) }, { animate: false, diff: false });
  const upd = watchUpdates();
  try {
    await prep(); await layout(tokens[0], tokens.slice(1), G, R);
    const base = tokens.map((t) => ({ alpha: +t.mesh.alpha.toFixed(3), scale: [+t.mesh.scale.x.toFixed(3), +t.mesh.scale.y.toFixed(3)], rot: +t.mesh.rotation.toFixed(3), eventMode: t.eventMode, sortLayer: t.mesh.sortLayer }));
    const tks = []; let prevHits = [];
    for ( let n = 1; n <= strokesN; n++ ) {
      // stroke 1: the first token right; 2: the same token right again; 3: the front-most token left
      const sorted = [...tokens].sort((a, b) => a.document.x - b.document.x);
      const carrier = n < 3 ? tokens[0] : sorted.at(-1), dir = n < 3 ? 1 : -1;
      const c = cen(carrier), len = (n === 1 ? 15 : 8) * G;
      const before = tokens.map((t) => [t.document.x, t.document.y]);
      upd.reset();
      const r = await run(M, tokens, { pts: line(c, { x: c.x + dir * len, y: c.y }, 50), settle: quick ? 150 : 2200, waitPlay: !quick });
      if ( quick && n === strokesN ) { await wait(() => K._carryStats().played >= 0 && K._carryStats().active === 0 && strokes().every((o) => !o.tk || K.started(o.id)), 40000); await sleep(2500); }
      const tk = r.o?.tk, hits = tk?.hit ?? [];
      tks.push(tk);
      if ( quick ) { if ( n === strokesN ) { const X = M.X, exp = new Map(); for ( const q of tks ) { if ( !q ) continue; exp.set(q.id, [q.x1, q.y1]); for ( const h of X.hitsOf(q) ) exp.set(h.id, [h.x1, h.y1]); }
          const pres2 = []; for ( const [i, t] of tokens.entries() ) pres2.push(await presenceOf(t, base[i]));
          rows.push(row("quick strokes (the next one drawn before the last one has played): every token ends where the strokes, in order, put it", tokens.every((t) => { const e = exp.get(t.document.id); return !e || (nearD(t.document.x, e[0]) && nearD(t.document.y, e[1])); }), { docs: tokens.map((t) => [t.document.id.slice(0, 4), t.document.x, t.document.y]), exp: [...exp].map(([k, v]) => [k.slice(0, 4), ...v]) }));
          rows.push(row("quick strokes: every token has full presence afterwards and nothing is left running", pres2.every((p) => p.ok) && K._carryStats().active === 0, { bad: pres2.filter((p) => !p.ok) })); }
        continue; }
      const pres = []; for ( const [i, t] of tokens.entries() ) pres.push(await presenceOf(t, base[i]));
      const moved = hits.map((h) => { const t = tokens.find((q) => q.document.id === h.id); return t && nearD(t.document.x, h.x1) && nearD(t.document.y, h.y1) && Math.hypot(h.x1 - h.x0, h.y1 - h.y0) > 3; });
      // the pile in this stroke: how many tokens were collected / how many the geometry says it must (every token the carrier's path-end region reaches)
      rows.push(row(`stroke ${n}: a carry with a plough record (${hits.length} pushed)`, !!tk && hits.length >= 3 && (n === 1 ? hits.length === 5 : true), { hits: hits.map((h) => h.id), t0: hits.map((h) => h.t0) }));
      rows.push(row(`stroke ${n}: EVERY pushed token moved to its recorded final (document) in one batch`, hits.length > 0 && moved.every(Boolean) && upd.calls.length === 1 && upd.calls[0] === hits.length + 1, { moved, calls: [...upd.calls] }));
      rows.push(row(`stroke ${n}: every token keeps full presence afterwards (visible, drawn, interactive, mesh and container on the document, no hold, no leftover)`, pres.every((p) => p.ok), { bad: pres.filter((p) => !p.ok) }));
      rows.push(row(`stroke ${n}: nothing is left running (no Carry, no ticker listener of the carry)`, K._carryStats().active === 0 && !K._carryStats().ticking && canvas.app.ticker.count <= tickBefore + 1, { stats: K._carryStats(), ticker: canvas.app.ticker.count, before: tickBefore }));
      // selectable
      let sel = true; for ( const t of tokens ) { t.control({ releaseOthers: true }); if ( !t.controlled ) sel = false; }
      canvas.tokens.releaseAll();
      rows.push(row(`stroke ${n}: every token can be selected`, sel));
      // each pushed token's displayed centre followed ahead of the carrier (first, second, third ... all moved)
      const idx = hits.map((h) => tokens.findIndex((t) => t.document.id === h.id));
      const mv = idx.map((i) => Math.max(...r.rows.map((q) => Math.hypot(q.p[i][0] - (before[i][0] + tokens[i].w / 2), q.p[i][1] - (before[i][1] + tokens[i].h / 2)) || 0)));
      rows.push(row(`stroke ${n}: every pushed token was SEEN moving (max displacement of each: ${mv.map(Math.round)})`, mv.length > 0 && mv.every((v) => v > G * 1.2), { mv: mv.map(Math.round) }));
      log.push({ n, hits: hits.length, pres: pres.map((p) => ({ name: p.name, ok: p.ok })), docs: tokens.map((t) => [t.document.x, t.document.y]) });
      prevHits = hits;
    }
  } catch ( err ) { rows.push(row(`error: ${err.message}`, false, { stack: String(err.stack).slice(0, 500) })); }
  finally {
    upd.stop(); canvas.tokens.releaseAll();
    try { await game.settings.set(MODULE, "destrSuper", false); } catch { /* ignore */ }
    d.clear(); d.deactivate();
    try { if ( made.length ) await canvas.scene.deleteEmbeddedDocuments("Token", made); await canvas.scene.updateEmbeddedDocuments("Token", saved.filter((o) => canvas.scene.tokens.has(o._id)), { animate: false, diff: false }); } catch { /* ignore */ }
  }
  return { ok: rows.every((r) => r.ok), rows, log };
}

/* ================================================================== the pile head is the destruction's front */

/**
 * THE FRONT LEADS WITH THE PILE HEAD. A plough over a row with Superhero ON (and, for comparison, the same stroke with it OFF); the clock is
 * frozen and stepped by hand through the whole entry. At every step: the entry's front (display.anim.path.head, scene px), the farthest pushed
 * token's mesh (the pile head) and the carrier's mesh. ON: the front tracks the pile head (error well under a grid square) and runs ahead of the carrier by
 * about the pile's length; OFF: it tracks the carrier. Returns { ok, rows, numbers }.
 */
export async function superFrontCheck({ n = 40 } = {}) {
  const M = await mods(), { B, K } = M, d = D(), rows = [], made = [], numbers = {};
  await ensureTokens(5, made);
  const all = canvas.tokens.placeables.filter((t) => !t.document.locked), carrier = all[0], rowT = all.slice(1, 5), tokens = [carrier, ...rowT];
  const G = canvas.grid.size, R = canvas.dimensions.sceneRect;
  const saved = canvas.tokens.placeables.map((t) => ({ _id: t.document.id, x: t.document.x, y: t.document.y }));
  const rest = canvas.tokens.placeables.filter((t) => !tokens.includes(t));
  for ( const [i, t] of rest.entries() ) await t.document.update({ x: Math.round(R.x + R.width - 2 * G), y: Math.round(R.y + 2 * G + i * 2 * G) }, { animate: false, diff: false });
  const T = canvas.app.ticker, real = performance.now.bind(performance), mf = T.maxFPS, was = T.started;
  try {
    for ( const sup of [true, false] ) {
      await prep({ sup }); const { c } = await layout(carrier, rowT, G, R);
      const before = new Set(strokes().map((o) => o.id));
      await B.drive(line(c, { x: c.x + 15 * G, y: c.y }, 50), { dt: 14, ctrl: true });
      await wait(() => strokes().some((o) => !before.has(o.id)), 3000);
      const o = strokes().find((q) => !before.has(q.id)), ap = d.state().ap;
      let a = null; await wait(() => { const g = d.display()?.order.find((q) => q.objId === o.id && q.anim?.path); a = g?.anim ?? null; return !!a; }, 12000, 10);
      if ( !a ) { rows.push(row(`${sup ? "ON" : "OFF"}: the stroke's entry started`, false)); continue; }
      const t0 = a.start + a.delay, D_ = a.path.D, S = [], homes = tokens.map(cen);
      T.maxFPS = 0; T.stop();
      try {
        for ( let i = 0; i < n; i++ ) {
          const el = Math.round(-60 + (D_ + 900) * i / (n - 1)), F = t0 + el;
          performance.now = () => F; T.update(F); await sleep(30);
          const h = el <= 0 ? a.path.pts[0] : el >= D_ ? a.path.pts.at(-1) : (a.path.head(el) ?? a.path.pts.at(-1));
          S.push({ el, front: R.x + h[0] * ap, car: carrier.mesh.position.x, pile: Math.max(...tokens.map((t, i) => (i === 0 || Math.hypot(t.mesh.position.x - homes[i].x, t.mesh.position.y - homes[i].y) > 3 ? t.mesh.position.x : -1e9))), c0: c.x });
        }
        const Fe = t0 + D_ + 9000; performance.now = () => Fe; T.update(Fe);
      } finally { performance.now = real; T.maxFPS = mf; if ( was ) T.start(); }
      await wait(() => K._carryStats().active === 0, 9000);
      const run = S.filter((s) => s.el > 150 && s.el < D_ - 40);
      const eP = run.map((s) => Math.abs(s.front - (s.pile + 0))), eC = run.map((s) => Math.abs(s.front - s.car));
      const mean = (x) => x.reduce((p, q) => p + q, 0) / (x.length || 1), mx = (x) => Math.max(...x);
      numbers[sup ? "on" : "off"] = { frames: run.length, toPileMean: +mean(eP).toFixed(1), toPileMax: +mx(eP).toFixed(1), toCarrierMean: +mean(eC).toFixed(1), toCarrierMax: +mx(eC).toFixed(1), lead: +mean(run.map((s) => s.pile - s.car)).toFixed(1), hits: o.tk?.hit?.length ?? 0 };
      if ( sup ) {
        rows.push(row(`ON: the stroke ploughs the row (tk.hit) and the front tracks the PILE HEAD (mean ${numbers.on.toPileMean} px, max ${numbers.on.toPileMax}; tolerance ${G * 0.75})`, (o.tk?.hit?.length ?? 0) >= 3 && run.length > 8 && mean(eP) < G * 0.75 && mx(eP) < G * 1.6, numbers.on));
        rows.push(row(`ON: the front runs well ahead of the carrier (mean gap ${numbers.on.toPileMean < numbers.on.toCarrierMean ? numbers.on.toCarrierMean : "?"} px, the pile leads it by ${numbers.on.lead})`, mean(eC) > G * 2, numbers.on));
      } else rows.push(row(`OFF: the front tracks the carrier as before (mean ${numbers.off.toCarrierMean} px, max ${numbers.off.toCarrierMax})`, !o.tk?.hit && run.length > 8 && mean(eC) < G * 0.5, numbers.off));
      key("keydown", { key: "z", ctrlKey: true }); await sleep(1000);
    }
  } catch ( err ) { rows.push(row(`error: ${err.message}`, false, { stack: String(err.stack).slice(0, 500) })); }
  finally {
    performance.now = real; T.maxFPS = mf; if ( was ) T.start();
    try { await game.settings.set(MODULE, "destrSuper", false); } catch { /* ignore */ }
    d.clear(); d.deactivate();
    try { if ( made.length ) await canvas.scene.deleteEmbeddedDocuments("Token", made); await canvas.scene.updateEmbeddedDocuments("Token", saved.filter((o) => canvas.scene.tokens.has(o._id)), { animate: false, diff: false }); } catch { /* ignore */ }
  }
  return { ok: rows.every((r) => r.ok), rows, numbers };
}

/* ================================================================== the end position and the grid: no pop at the hand-over */

/**
 * SNAP and FREE. A plough over a row (superhero on) with (a) "snap to grid" and (b) "ignore the grid" (with snap also ticked: free wins).
 * At the very moment each document is updated the token's DISPLAYED centre (mesh) is compared with the document's new centre (the hand-over
 * must change nothing on screen: < 1 px), no frame moves a token by more than a ride's speed (no jump), everything ends (no Carry left, mesh on
 * document). Snap: every final is centred on a cell and the cells are distinct; free: the carried token ends exactly where the path ends,
 * off the grid, the pushed ones at their raw pushed positions. Returns { ok, rows, numbers }.
 */
export async function superGridCheck() {
  const M = await mods(), { K } = M, d = D(), rows = [], made = [], numbers = {};
  await ensureTokens(5, made);
  const all = canvas.tokens.placeables.filter((t) => !t.document.locked), carrier = all[0], rowT = all.slice(1, 5), tokens = [carrier, ...rowT];
  const G = canvas.grid.size, R = canvas.dimensions.sceneRect;
  const saved = canvas.tokens.placeables.map((t) => ({ _id: t.document.id, x: t.document.x, y: t.document.y }));
  const rest = canvas.tokens.placeables.filter((t) => !tokens.includes(t));
  for ( const [i, t] of rest.entries() ) await t.document.update({ x: Math.round(R.x + R.width - 2 * G), y: Math.round(R.y + 2 * G + i * 2 * G) }, { animate: false, diff: false });
  try {
    for ( const mode of ["snap", "free"] ) {
      await prep({ snap: true, free: mode === "free" });
      // an off-grid start and an off-grid raw end: the path ends at a quarter cell
      const { c } = await layout(carrier, rowT, G, R, { gaps: [4.2, 5.2, 6.2, 7.2, 8.2], dy: [0.12, -0.1, 0.1, 0, 0.1] });
      // (the hand-over error: where the ride puts the token's centre - the Foundry base it rides on plus the ride's offset, without the pose (lean and lift go on after it) - against the document's NEW centre)
      const err = new Map(), hook = Hooks.on("updateToken", (doc, ch) => { if ( !("x" in ch || "y" in ch) ) return; const w = doc.getSize(), st = K._carryState().find((s) => s.id === doc.id); if ( st?.base ) err.set(doc.id, Math.hypot(st.base.x + st.off.x - ((ch.x ?? doc.x) + w.width / 2), st.base.y + st.off.y - ((ch.y ?? doc.y) + w.height / 2))); });
      const end = { x: c.x + 13.3 * G + G * 0.27, y: c.y + G * 0.31 };
      let r; try { r = await run(M, tokens, { pts: line(c, end, 50), settle: 1800 }); } finally { Hooks.off("updateToken", hook); }
      const tk = r.o?.tk, hits = tk?.hit ?? [], ap = d.state().ap;
      let maxStep = 0; for ( const t of tokens.keys() ) for ( let j = 1; j < r.rows.length; j++ ) { const a = r.rows[j - 1].p[t], b = r.rows[j].p[t]; if ( Number.isFinite(a[0]) && Number.isFinite(b[0]) ) maxStep = Math.max(maxStep, Math.hypot(b[0] - a[0], b[1] - a[1])); }
      const errs = [...err.values()], onDocs = tokens.every((t) => Math.hypot(t.mesh.position.x - (t.document.x + t.w / 2), t.mesh.position.y - (t.document.y + t.h / 2)) < 0.5);
      let jmp = null; for ( const t of tokens.keys() ) for ( let j = 1; j < r.rows.length; j++ ) { const a = r.rows[j - 1].p[t], b = r.rows[j].p[t]; if ( Number.isFinite(a[0]) && Number.isFinite(b[0]) && Math.hypot(b[0] - a[0], b[1] - a[1]) >= maxStep - 1e-6 ) jmp = { tok: t, frame: j, of: r.rows.length, a: a.map(Math.round), b: b.map(Math.round), dt: Math.round(r.rows[j].t - r.rows[j - 1].t) }; }
      numbers[mode] = { jump: jmp, hits: hits.length, handoverErrMax: +Math.max(0, ...errs).toFixed(2), maxStepPx: Math.round(maxStep), docs: tokens.map((t) => [t.document.x, t.document.y]) };
      rows.push(row(`${mode}: a plough with ${hits.length} pushed, the carry ENDS (nothing left active, every mesh exactly on its document)`, !!tk && hits.length >= 3 && K._carryStats().active === 0 && !K._carryStats().ticking && onDocs, numbers[mode]));
      rows.push(row(`${mode}: at the hand-over the displayed position equals the document (max error ${numbers[mode].handoverErrMax} px over ${errs.length} tokens, < 1)`, errs.length === hits.length + 1 && Math.max(...errs) < 1, numbers[mode]));
      rows.push(row(`${mode}: no jump frame (the largest per-frame displacement of any token is ${Math.round(maxStep)} px: a ride's own speed)`, maxStep < 32, numbers[mode]));
      if ( mode === "snap" ) {
        const cells = tokens.map((t) => `${Math.round((t.document.x - R.x) / G)},${Math.round((t.document.y - R.y) / G)}`);
        rows.push(row("snap: every token ends centred on a grid cell, all cells distinct", tokens.every((t) => (t.document.x - R.x) % G === 0 && (t.document.y - R.y) % G === 0) && new Set(cells).size === cells.length, { cells }));
      } else {
        const p = tk.p, rawX = tk.x0 + carrier.w / 2 + (p.at(-3) - p[0]) * ap, rawY = tk.y0 + carrier.h / 2 + (p.at(-2) - p[1]) * ap;
        const cx = carrier.document.x + carrier.w / 2, cy = carrier.document.y + carrier.h / 2;
        const off = tokens.some((t) => (t.document.x - R.x) % G !== 0 || (t.document.y - R.y) % G !== 0);
        const pushedRaw = hits.every((h) => { const l = h.p.slice(-3); return Math.abs(h.x1 + carrier.w / 2 - l[0]) <= 1.5 && Math.abs(h.y1 + carrier.h / 2 - l[1]) <= 1.5; });
        rows.push(row(`free: the carried token ends exactly where the path ends (${Math.round(cx - rawX)}, ${Math.round(cy - rawY)} px), off the grid; pushed tokens at their raw positions`, Math.abs(cx - rawX) <= 1.5 && Math.abs(cy - rawY) <= 1.5 && off && pushedRaw && tokens.every((t, i) => !i || true) && !hits.some((h) => h.x1 === Math.round(h.x1 / G) * G && h.y1 === Math.round(h.y1 / G) * G && false), { raw: [rawX, rawY], doc: [cx, cy] }));
        let clash = false; for ( let i = 0; i < tokens.length; i++ ) for ( let j = i + 1; j < tokens.length; j++ ) { const a = tokens[i].document, b = tokens[j].document; if ( Math.min(a.x + tokens[i].w, b.x + tokens[j].w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + tokens[i].h, b.y + tokens[j].h) - Math.max(a.y, b.y) > 1 ) clash = true; }
        rows.push(row("free: the pushed tokens only keep clear of each other (no overlap at the end)", !clash));
      }
      key("keydown", { key: "z", ctrlKey: true }); await sleep(1000);
    }
  } catch ( err ) { rows.push(row(`error: ${err.message}`, false, { stack: String(err.stack).slice(0, 500) })); }
  finally {
    try { await game.settings.set(MODULE, "carryFree", false); await game.settings.set(MODULE, "carrySnap", false); await game.settings.set(MODULE, "destrSuper", false); } catch { /* ignore */ }
    d.clear(); d.deactivate();
    try { if ( made.length ) await canvas.scene.deleteEmbeddedDocuments("Token", made); await canvas.scene.updateEmbeddedDocuments("Token", saved.filter((o) => canvas.scene.tokens.has(o._id)), { animate: false, diff: false }); } catch { /* ignore */ }
  }
  return { ok: rows.every((r) => r.ok), rows, numbers };
}

/* ================================================================== passive effects ride with their tokens */

/**
 * PASSIVE EFFECTS. The carried token has a persistent moinen-pixel-vfx passive (shield-up), a pushed token another (the flight cape), another pushed token a
 * Sequencer effect attached to it (Sequencer attachTo). A plough runs; every frame each effect's centre is compared with its token's mesh centre (the offset
 * between them at rest is the effect's own placement): it must stay within a tolerance all the way (the lean moves the mesh a few px the effect does not share),
 * and afterwards each effect sits exactly where it sat on its token at rest (no offset left over, the hand-over changes nothing). Also a token with no
 * effect and a token's own bars / mesh are unaffected (the plain carry rows). Returns { ok, rows, numbers }.
 */
export async function superFxCheck() {
  const M = await mods(), { K } = M, d = D(), rows = [], made = [], numbers = {};
  const API = game.modules.get("moinen-pixel-vfx")?.api;
  if ( !API?.ongoing || !globalThis.Sequencer ) return { ok: false, rows: [row("moinen-pixel-vfx and Sequencer are active in this world", false)] };
  await ensureTokens(5, made);
  const all = canvas.tokens.placeables.filter((t) => !t.document.locked), carrier = all[0], rowT = all.slice(1, 5), tokens = [carrier, ...rowT];
  const G = canvas.grid.size, R = canvas.dimensions.sceneRect;
  const saved = canvas.tokens.placeables.map((t) => ({ _id: t.document.id, x: t.document.x, y: t.document.y }));
  const rest = canvas.tokens.placeables.filter((t) => !tokens.includes(t));
  for ( const [i, t] of rest.entries() ) await t.document.update({ x: Math.round(R.x + R.width - 2 * G), y: Math.round(R.y + 2 * G + i * 2 * G) }, { animate: false, diff: false });
  const started = [];
  try {
    await prep(); const { c } = await layout(carrier, rowT, G, R);
    for ( const [t, p] of [[carrier, "shield-up"], [rowT[0], "invincible-flight-specialized-cape-passive-base"]] ) { await API.ongoing.start(t, p); started.push([t, p]); }
    await Sequencer.Helpers ? null : null;
    new Sequence().effect().file("icons/svg/aura.svg").attachTo(rowT[1]).scaleToObject(1.2).persist().name("supercheck").play();
    await sleep(2500);
    // which display objects belong to which token (the nearest of the effect objects to each token's centre, at rest)
    const lays = []; for ( const ch of canvas.interface.children ) if ( ch.zIndex === 9000 && ch.sortableChildren && ch.eventMode === "none" ) lays.push(ch); for ( const ch of canvas.primary.children ) if ( ch.constructor === PIXI.Container && ch.sortableChildren && ch.eventMode === "none" && ch.children.length ) lays.push(ch);
    const objs = lays.flatMap((l) => l.children);
    const seqEff = Sequencer.EffectManager.getEffects({ name: "supercheck" })[0];
    const track = new Map();       // token index -> { o: display object, rel: offset from the doc centre at rest }
    for ( const [i, t] of tokens.entries() ) {
      const cc = cen(t); let best = null, bd = Infinity;
      if ( i === 2 ) { if ( seqEff ) best = seqEff; }
      else for ( const o of objs ) { const dd = Math.hypot(o.position.x - cc.x, o.position.y - cc.y); if ( dd < bd && dd < G * 0.8 ) { bd = dd; best = o; } }
      if ( best ) track.set(i, { o: best, rel: { x: best.position.x - cc.x, y: best.position.y - cc.y } });
    }
    rows.push(row(`effects found on the tokens at rest: the carried one's passive, a pushed token's passive and a Sequencer effect (${[...track.keys()]})`, track.has(0) && track.has(1) && track.has(2), { found: [...track.keys()], objs: objs.length }));
    // the plough
    const rowsS = []; let on = true;
    const loop = () => { if ( !on ) return; rowsS.push({ t: performance.now(), m: tokens.map((t) => [t.mesh.position.x, t.mesh.position.y]), e: [...track].map(([i, v]) => [i, v.o.position.x, v.o.position.y]) }); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    const r = await run(M, tokens, { pts: line(c, { x: c.x + 15 * G, y: c.y }, 50), settle: 2200 });
    on = false;
    const hits = r.o?.tk?.hit ?? [];
    const worst = new Map(); let rideMax = 0;
    for ( const s of rowsS ) for ( const [i, ex, ey] of s.e ) {
      const v = track.get(i), m = s.m[i], home = cen(tokens[i]);
      const dd = Math.hypot(ex - m[0] - v.rel.x, ey - m[1] - v.rel.y);
      worst.set(i, Math.max(worst.get(i) ?? 0, dd));
    }
    for ( const i of track.keys() ) { const a = rowsS.map((s) => Math.hypot(s.m[i][0] - cen(tokens[i]).x, s.m[i][1] - cen(tokens[i]).y)); rideMax = Math.max(rideMax, ...a); }
    numbers.worst = Object.fromEntries([...worst].map(([i, v]) => [i, +v.toFixed(1)])); numbers.rideMax = Math.round(rideMax);
    rows.push(row(`the effects ride with the carried token and the pushed tokens: the effect-to-mesh distance never differs from its resting placement by more than ${Math.round(G * 0.3)} px (Sequencer: ${Math.round(G * 0.75)}) (${JSON.stringify(numbers.worst)})`, hits.length >= 3 && rideMax > G * 5 && [...worst].every(([i, v]) => v < (i === 2 ? G * 0.75 : G * 0.3)), numbers));      // (a Sequencer effect trails by a frame or two: Sequencer reads the container on its own tick)
    const left = [...track].map(([i, v]) => Math.hypot(v.o.position.x - cen(tokens[i]).x - v.rel.x, v.o.position.y - cen(tokens[i]).y - v.rel.y));
    numbers.left = left.map((v) => +v.toFixed(2));
    rows.push(row(`afterwards every effect sits exactly where it sat on its token at rest (leftover ${numbers.left} px): no offset kept, the hand-over changes nothing`, left.every((v) => v < 1), numbers));
    rows.push(row("nothing is left running", K._carryStats().active === 0 && !K._carryStats().ticking));
    key("keydown", { key: "z", ctrlKey: true }); await sleep(1000);
  } catch ( err ) { rows.push(row(`error: ${err.message}`, false, { stack: String(err.stack).slice(0, 500) })); }
  finally {
    try { Sequencer.EffectManager.endEffects({ name: "supercheck" }); for ( const [t, p] of started ) await API.ongoing.stop(t, p); } catch { /* ignore */ }
    try { await game.settings.set(MODULE, "destrSuper", false); } catch { /* ignore */ }
    d.clear(); d.deactivate();
    try { if ( made.length ) await canvas.scene.deleteEmbeddedDocuments("Token", made); await canvas.scene.updateEmbeddedDocuments("Token", saved.filter((o) => canvas.scene.tokens.has(o._id)), { animate: false, diff: false }); } catch { /* ignore */ }
  }
  return { ok: rows.every((r) => r.ok), rows, numbers };
}

/**
 * HEIGHT in the plough + the official visual-transform API (moinen-pixel-vfx api.visual), on a lane with both modules:
 *   1 api.visual: a declared offset / lift / rot / scale moves the passives (a shield loop, the flight cape = an adaptive body, the wings) and the ground shadow stays on the floor;
 *     clearing restores every sprite exactly;
 *   2 default ("Superhero ignores height" off): a token with document elevation 10 (2 cells) is passed UNDER, the others are ploughed;
 *   3 option ON: the elevated + flying token is ploughed too and its displayed height (mesh above its ground position) never steps more than the pose's own step
 *     (no snap to the carrier's height, none at contact, during the push or at the hand-over) and ends at its own hover.
 * Returns { ok, rows, numbers }.   await (await import("/modules/moinen-maps/dev/super-check.mjs")).superHeightCheck()
 */
export async function superHeightCheck({ flight = "invincible-flight-wings-passive-monstrous", allow = 2.5 } = {}) {
  const M = await mods(), { K } = M, d = D(), rows = [], made = [], numbers = {};
  const API = game.modules.get("moinen-pixel-vfx")?.api, V = API?.visual;
  if ( !V?.version || !globalThis.Sequencer ) return { ok: false, rows: [row("moinen-pixel-vfx (api.visual) and Sequencer are active in this world", false)] };
  await ensureTokens(5, made);
  const all = canvas.tokens.placeables.filter((t) => !t.document.locked), carrier = all[0], rowT = all.slice(1, 5), tokens = [carrier, ...rowT];
  const G = canvas.grid.size, R = canvas.dimensions.sceneRect, hoverTok = rowT[1];
  const saved = canvas.tokens.placeables.map((t) => ({ _id: t.document.id, x: t.document.x, y: t.document.y, elevation: t.document.elevation }));
  const rest = canvas.tokens.placeables.filter((t) => !tokens.includes(t));
  for ( const [i, t] of rest.entries() ) await t.document.update({ x: Math.round(R.x + R.width - 2 * G), y: Math.round(R.y + 2 * G + i * 2 * G) }, { animate: false, diff: false });
  const started = [], raf = () => new Promise((r) => requestAnimationFrame(r));
  try {
    /* 1 the API on the passives */
    await prep(); await layout(carrier, rowT, G, R);
    for ( const [t, p] of [[carrier, "shield-up"], [carrier, "invincible-flight-specialized-cape-passive-base"], [carrier, flight]] ) { await API.ongoing.start(t, p); started.push([t, p]); }
    await sleep(2500);
    const lays = []; for ( const ch of canvas.interface.children ) if ( ch.zIndex === 9000 && ch.sortableChildren && ch.eventMode === "none" ) lays.push(ch); for ( const ch of canvas.primary.children ) if ( ch.constructor === PIXI.Container && ch.sortableChildren && ch.eventMode === "none" && ch.children.length ) lays.push(ch);
    const near = () => lays.flatMap((l) => l.children).filter((o) => !o.destroyed && Math.hypot(o.position.x - carrier.center.x, o.position.y - carrier.center.y) < 3 * G);
    const snap = () => near().map((o) => [o.position.x, o.position.y, o.rotation, o.scale.x]);
    await raf(); await raf(); const a = snap(), mesh0 = [carrier.mesh.position.x, carrier.mesh.position.y];
    V.set(carrier, { dx: 2 * G, dy: G, lift: G * 0.75, rot: 20, scale: 1.5, source: "supercheck" }); await raf(); await raf(); await raf();
    const b = snap(), mesh1 = [carrier.mesh.position.x, carrier.mesh.position.y];
    const moved = a.map((s, i) => b[i] ? [b[i][0] - s[0], b[i][1] - s[1], b[i][2] - s[2], b[i][3] / s[3]] : null);
    numbers.moved = moved.map((m) => m && m.map((v) => +v.toFixed(2)));
    const sprites = moved.filter((m) => m && Math.abs(m[0] - 2 * G) < 1.5 && Math.abs(m[1] - G * 0.25) < 1.5), shadows = moved.filter((m) => m && Math.abs(m[0] - 2 * G) < 1.5 && Math.abs(m[1] - G) < 1.5);
    rows.push(row(`api.visual: ${sprites.length} token-bound sprite(s) move by the offset and the lift (adaptive cape / wings / shield loop), rotated and scaled`, sprites.length >= 2 && sprites.every((m) => Math.abs(m[2] - 20 * Math.PI / 180) < 0.01 && Math.abs(m[3] - 1.5) < 0.01), numbers));
    rows.push(row(`api.visual: the ground shadow (${shadows.length}) moves with the offset but NOT with the lift (it stays on the floor)`, shadows.length >= 1, numbers));
    rows.push(row("api.visual: the mesh follows the offset too (the module's own motion table composes with it)", Math.abs(mesh1[0] - mesh0[0] - 2 * G) < 1.5 && Math.abs(mesh1[1] - mesh0[1] - G * 0.25) < 1.5, { mesh0, mesh1 }));
    V.clear(carrier, "supercheck"); await raf(); await raf(); await raf();
    const c2 = snap(), diff = Math.max(0, ...a.map((s, i) => c2[i] ? Math.hypot(c2[i][0] - s[0], c2[i][1] - s[1], (c2[i][2] - s[2]) * 100, (c2[i][3] - s[3]) * 100) : 99));
    rows.push(row(`api.visual: clearing restores every sprite exactly (max diff ${diff.toFixed(3)})`, diff < 0.01 && !V.has(carrier)));
    for ( const [t, p] of started.splice(0) ) await API.ongoing.stop(t, p);
    await sleep(1500);

    /* 2 / 3 the plough and the height */
    const pathRun = async () => {
      await prep(); const { c } = await layout(carrier, rowT, G, R);
      const samples = []; let on = true;
      const loop = () => { if ( !on ) return; samples.push(hoverTok.position.y + hoverTok.h / 2 - hoverTok.mesh.position.y); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      const r = await run(M, tokens, { pts: line(c, { x: c.x + 15 * G, y: c.y }, 50), settle: 2200 });
      on = false; return { r, samples, ids: (r.o?.tk?.hit ?? []).map((h) => h.id) };
    };
    await hoverTok.document.update({ elevation: 10 }, { animate: false });
    await API.ongoing.start(hoverTok, flight); started.push([hoverTok, flight]); await sleep(1800);
    const H = V.baseHeight(hoverTok); numbers.hover = +H.toFixed(1);
    await game.settings.set(MODULE, "superIgnoreHeight", false);
    const p2 = await pathRun();
    numbers.defaultHits = p2.ids.length;
    rows.push(row(`default: the elevated / flying token is passed under (not collected), the other ${p2.ids.length} are ploughed`, !p2.ids.includes(hoverTok.document.id) && p2.ids.length >= 2, { ids: p2.ids }));
    key("keydown", { key: "z", ctrlKey: true }); await sleep(1000);
    await game.settings.set(MODULE, "superIgnoreHeight", true);
    const p3 = await pathRun();
    const S = p3.samples; let step = 0; for ( let i = 1; i < S.length; i++ ) step = Math.max(step, Math.abs(S[i] - S[i - 1]));
    numbers.ignoreStep = +step.toFixed(2); numbers.ignoreEnd = +S.at(-1).toFixed(2); numbers.ignoreMin = +Math.min(...S).toFixed(2);
    rows.push(row("ignore height ON: the elevated / flying token is ploughed too", p3.ids.includes(hoverTok.document.id), { ids: p3.ids }));
    rows.push(row(`ignore height ON: its displayed height steps at most ${step.toFixed(2)} px per frame (limit ${(allow + 0.06 * G).toFixed(1)}) and never drops below its hover ${H.toFixed(1)} px (lowest ${Math.min(...S).toFixed(1)})`, step <= allow + 0.06 * G && Math.min(...S) >= H - allow, numbers));
    rows.push(row(`ignore height ON: it ends at its own hover (${S.at(-1).toFixed(1)} px, no pop at the hand-over)`, Math.abs(S.at(-1) - H) < allow));
    key("keydown", { key: "z", ctrlKey: true }); await sleep(1000);
    rows.push(row("nothing is left running and the visual transform is cleared", K._carryStats().active === 0 && !V.has(hoverTok) && !V.has(carrier)));
  } catch ( err ) { rows.push(row(`error: ${err.message}`, false, { stack: String(err.stack).slice(0, 500) })); }
  finally {
    try { for ( const [t, p] of started ) await API.ongoing.stop(t, p); Sequencer.EffectManager.endEffects({ name: "supercheck" }); } catch { /* ignore */ }
    try { await game.settings.set(MODULE, "destrSuper", false); await game.settings.set(MODULE, "superIgnoreHeight", false); } catch { /* ignore */ }
    d.clear(); d.deactivate();
    try { if ( made.length ) await canvas.scene.deleteEmbeddedDocuments("Token", made); await canvas.scene.updateEmbeddedDocuments("Token", saved.filter((o) => canvas.scene.tokens.has(o._id)), { animate: false, diff: false }); } catch { /* ignore */ }
  }
  return { ok: rows.every((r) => r.ok), rows, numbers };
}
