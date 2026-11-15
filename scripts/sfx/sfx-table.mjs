/* MAPSFXSEAT: THE TABLE PICTURE of the map's lettering (pure planning: no Foundry, no PIXI, no DOM - everything a seat could differ in
   comes in through `d`, and nothing of a seat's view, window, zoom, panels, words up or arrival time is in it; node-tested with two
   simulated seats in dev/sfx-seat.test.mjs). sfx.mjs builds `d` from what every seat shares and calls these; the seat then draws the
   plan by the seat rule only (sfx.mjs seatCall / sfx-seat seatFit).

   d = { L (the engine: word, measure, planFor, sizeModel), sizeFor (the running copy's size model), grid, sceneId, lang, known (kind ids),
         ledger (sfx-seat makeLedger), toPerf (shared ms -> this page's clock), toShared, layer ({ layer }), step (group -> 0..3),
         memo (Map), tokens (view -> shared token boxes), pins (view -> shared pin boxes), warn (msg, err) }

   The words of a moment (planMoment: the destruction layer's entries, the fire layer's events, a Detonate) and of a page (planPage: a
   preset firing, a plough, a flash in view) are written in a fixed order, sized by the engine's own model on the REFERENCE view
   (sfx-seat refZoom / refView / tableSize), measured by the engine (L.measure: the box it will draw and the reach of its entrance and
   hold), placed off the shared obstacles and the ledger's words (sfx-core place, sfx-fit ladderPlace), timed on the shared clock. */
import * as C from "./sfx-core.mjs";
import * as PG from "./sfx-page.mjs";
import * as EV from "./sfx-events.mjs";
import * as SZ from "./sfx-size.mjs";
import * as FIT from "./sfx-fit.mjs";
import * as SEAT from "./sfx-seat.mjs";

/** steam's way up off what was put out (grid squares: sideways, up) */
export const DRIFT = [0.15, 0.9];
/** a fire's catch word sounds this long after the fire's shared moment (a seat on time shows its flames by then; question MAPSFXSEAT-2) */
export const CATCH_SHOW_MS = 400;

export const grpOf = (w) => w.grp ?? SZ.groupOfVoice(w.voice);
export const moveBox = (b, dx, dy) => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
export const unionBox = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
export const scaleBox = (b, f, cx, cy) => (f === 1 ? b : { x0: cx + (b.x0 - cx) * f, y0: cy + (b.y0 - cy) * f, x1: cx + (b.x1 - cx) * f, y1: cy + (b.y1 - cy) * f });
/** a word's life on the table (ms): its sound, its hold, its exit (sfx-seat lifeOf) */
export const lifeMs = (w) => SEAT.lifeOf(w, 0).t1;
/** the box a word holds on the table for its life: its box, a cave-in's sinking (half its height lower), a ride's whole way */
export function lifeBox(w) {
  let b = w.box ?? C.boxOf(w);
  if ( w.voice === "cavein" ) b = { ...b, y1: b.y1 + (b.y1 - b.y0) * 0.5 };
  if ( w.path?.length > 1 ) for ( const q of w.path ) b = unionBox(b, C.boxOf(w, q.x, q.y));
  return b;
}

/* ---------------------------------------------------------------- a word's options, size and box */

/** The play options of a word before its size (the table's: reduced motion off - a seat's own reduced motion is applied when it plays). */
export function baseOpts(w, d) {
  const G = d.grid, st = w.stage ?? {};
  const z = w.z ?? SEAT.refZoom(G, w.zr ?? 0);
  const o = { ...(w.word?.play ?? {}), space: "world", at: { x: w.x, y: w.y }, area: w.area, magnitude: w.magnitude, seed: w.seed, rotation: w.rotation, reduced: false,
    ceilK: C.CEIL_K[w.role] ?? C.CEIL_K.sec,
    // (a story's word sized by its rank as a share of the REFERENCE view height at the moment's reference zoom: the rank is the
    // hierarchy, the engine's ceiling share does not cut it again)
    ...(Number.isFinite(w.rank) ? { size: EV.rankSize(w.rank, SEAT.REF_VH / z, w.shrink ?? 1), ceilK: 1 } : {}),
    ...(w.from ? { from: w.from } : {}), ...(w.colors ? { colors: w.colors } : {}), ...(d.layer ?? {}) };
  for ( const k of ["in", "holdKind", "out", "on", "push", "glow"] ) if ( st[k] !== undefined ) o[k] = st[k];
  // what was hit makes the sound: its material (the engine's look follows it); the word's own character stays, only its material changes
  if ( w.emat && o.character ) o.character = { ...o.character, material: w.emat };
  // the word lasts as long as its sound (a fire going out hisses while its flames die; a crack is a snap)
  if ( w.ms >= 900 ) o.hold = Math.round(Math.min(4500, Math.max(600, w.ms * 0.7)));
  // steam drifts up off what was put out
  if ( w.drift ) o.path = { from: { x: w.x, y: w.y }, to: { x: w.x + G * DRIFT[0], y: w.y - G * DRIFT[1] }, duration: Math.round(w.ms * 1.1), ease: "out", orient: "none" };
  // a thing that travels: its word rides along with it
  if ( w.path ) { o.path = { points: w.path.map((q) => ({ x: q.x, y: q.y })), duration: Math.max(400, w.path.at(-1).ms), ease: "linear", orient: w.orient ?? "lean", smooth: "line" }; o.hold = Math.max(o.hold ?? 0, Math.round(w.path.at(-1).ms)); }
  return o;
}
/** The options a word plays with (and is measured with): its TABLE size at its group's size step (`raw`: before step and table size). */
export function optsOf(w, d, raw = false) {
  const o = baseOpts(w, d);
  if ( raw ) return o;
  const step = d.step(grpOf(w));
  // (a word sized another way - exact or pixel lettering - or an engine that cannot tell its size: the step's options as before)
  if ( step !== 0 && w.text ) { const b = tableSized(w, o, step, d); if ( b ) return b; }
  return SZ.sizeOpts(o, step);
}
/**
 * A world word's TABLE options: its size in scene px from the engine's own size model fed the REFERENCE view instead of a seat's
 * (sfx-seat tableSize: REF_VW x REF_VH at the moment's reference zoom, the table's words up from the ledger), at the group's step (a
 * smaller step under the engine's legibility floor there, a bigger one under its loudest ceiling there, `fitK` the ladder's share), then
 * drawn at exactly that size (fit "world": no second clamp by a seat's window, zoom or words up) and not pulled into a seat's view by the
 * engine (keepInView false: the seat rule moves it). On a seat whose window, zoom and words up are the reference's this is the size the
 * engine drew before (dev/sfx-seat.test.mjs STEP2).
 */
export function tableSized(w, o, step, d) {
  try {
    if ( o.fit === "exact" || o.pixel || !d.L?.sizeModel || !d.sizeFor ) return null;
    const z = w.z ?? SEAT.refZoom(d.grid, w.zr ?? 0);
    const ts = SEAT.tableSize(d.sizeFor, d.L.sizeModel, o, planInfo(w.text, o, d), { z, alive: w.alive ?? 0, grid: d.grid, step, fitK: w.fitK });
    if ( !(ts?.size > 0) ) return null;
    const out = { ...o, fit: "world", size: ts.size, keepInView: false };
    delete out.scale;
    return out;
  } catch { return null; }
}
/**
 * MAPSFXSEAT2: the sizes THIS seat draws a table word at (cap height in world units, this seat's own size setting `seat.scale` in): the
 * engine's own size of the word for this seat's window and zoom at step 2 - with the TABLE's options and the table's words up (the
 * ledger, not this seat's history), a ranked word's rank as a share of THIS seat's view height, as the map sized it before the table
 * picture - then the step's share of it (sfx-seat stepPx): what this seat drew before at step 2, step 3 bigger, step 1 smaller. A seat whose
 * window and zoom are the reference's draws the table size (dev/sfx-seat.test.mjs STEP2). seat = { vw (usable width), vh, zoom, scale }.
 * -> { sizes (preferred first), min, full (step 3: the size from which it counts as bigger), cap2, px2, sk } | null (sized another way)
 */
export function seatCaps(w, d, seat) {
  try {
    if ( !w?.text || !d.sizeFor ) return null;
    const o = baseOpts(w, d);
    if ( o.fit === "exact" || o.pixel ) return null;
    const step = d.step(grpOf(w)), z = seat.zoom > 0 ? seat.zoom : 1, sc = seat.scale > 0 ? seat.scale : 1;
    // (a ranked word: its rank's share of the larger of the table's reference view and this seat's own view, as the engine's request -
    // the engine's size model then holds it to this seat's window: a seat zoomed closer than the reference draws the most its window
    // gives the word, as before the table picture; a seat zoomed out farther its own view's share, as before)
    if ( Number.isFinite(w.rank) ) o.size = Math.max(o.size ?? 0, EV.rankSize(w.rank, seat.vh / z, w.shrink ?? 1));
    const plan = planInfo(w.text, o, d), sk = plan.sizeK ?? 1;
    const q = SEAT.refSize(d.sizeFor, o, plan, { z, alive: w.alive ?? 0, grid: d.grid, vw: seat.vw, vh: seat.vh });
    if ( !(q?.px > 0) ) return null;
    const px2 = q.px, floor = SZ.floorPx(seat.vh, sk, d.L?.sizeModel);
    return { ...capLadder(px2, step, floor, (px) => (px / z) * sc), px2, sk, sc };
  } catch { return null; }
}
/** MAPSFXSEAT2: the sizes to try for a word drawn at `px2` (cap px on this seat's screen) at step 2, at step `step`, as `W(px)` (the units
    the layout works in): step 3 from the full step down to MIN_GAIN x step 2 in small steps, then - only where nothing that big is clean on
    this view - down to step 2's own size (the rule "full", question MAPSFXSEAT2-1); step 2 its own size; step 1 its share, never under the
    legibility floor `floor`, always at most step 2 / MIN_GAIN. -> { sizes (preferred first), min, full, cap2 } */
export function capLadder(px2, step, floor, W = (px) => px) {
  const s = SZ.stepOf(step), pxS = SEAT.stepPx(px2, s, floor), sizes = [];
  let min, full = 0;
  if ( s > SZ.SIZE_DEFAULT ) {
    for ( let px = pxS; px > px2 * SEAT.MIN_GAIN * 0.999; px *= 0.94 ) sizes.push(W(px));
    sizes.push(W(px2 * SEAT.MIN_GAIN));
    for ( let px = px2 * SEAT.MIN_GAIN * 0.95; px > px2; px *= 0.95 ) sizes.push(W(px));
    sizes.push(W(px2)); min = W(px2); full = W(px2 * SEAT.MIN_GAIN);
  } else if ( s < SZ.SIZE_DEFAULT && s > 0 ) {
    for ( let px = pxS, i = 0; i < 4; i++, px *= 0.93 ) if ( px >= floor ) sizes.push(W(Math.min(px, px2 / SEAT.MIN_GAIN)));
    if ( !sizes.length ) sizes.push(W(Math.min(pxS, px2 / SEAT.MIN_GAIN)));
    min = sizes.at(-1);
  } else { sizes.push(W(px2)); min = W(px2); }
  // (the smallest a word of a bigger step may be drawn where nothing clean holds it: this seat's step-1 size)
  const small = s < SZ.SIZE_DEFAULT ? min : W(Math.min(SEAT.stepPx(px2, 1, floor), px2 / SEAT.MIN_GAIN));
  return { sizes, min, full, small, cap2: W(px2) };
}
/** MAPSFXSEAT2: the sizes THIS seat draws an unlocated (screen) word at, CSS px of cap height (its own size setting in): a ranked word its
    rank's share of THIS window's height, another the engine's own size on this window - as the map sized it before - then the step's share
    (capLadder). seat = { vw, vh, scale } */
export function screenCaps(sizeFor, model, o, plan, { rank = null, shrink = 1, step = SZ.SIZE_DEFAULT, vw, vh, scale = 1 } = {}) {
  try {
    const sk = plan?.sizeK ?? 1, sc = scale > 0 ? scale : 1;
    const px2 = Number.isFinite(rank) ? EV.rankSize(rank, vh, shrink) * sk : SEAT.refSize(sizeFor, o, plan, { space: "screen", vw, vh }).px;
    if ( !(px2 > 0) ) return null;
    return { ...capLadder(px2, step, SZ.floorPx(vh, sk, model), (px) => px * sc), px2, sk, sc };
  } catch { return null; }
}
/** MAPSFXSEAT2: the items of the seat layout (sfx-seat seatLayout) for the table words of one page / moment on THIS seat: each word's
    table box and cap, its subject, its sizes on this seat (seatCaps), its life on the table, whether it rides its way */
export function seatItems(ws, d, seat) {
  const sc = seat.scale > 0 ? seat.scale : 1;
  return ws.filter((w) => w && w.text && Number.isFinite(w.x)).map((w, i) => {
    const c = seatCaps(w, d, seat), u = w.size > 0 ? w.size : d.grid * 0.5;
    const prio = w.role === "main" ? 0 : w.role === "pre" ? 1 : w.wave || w.voice === "shockwave" ? 2 : 3 + i * 1e-3;
    return { key: w.key ?? `${w.seed}|${w.role}`, w, prio, box: w.box ?? C.boxOf(w), u, sub: w.subject ?? null, sizes: c?.sizes ?? [u * sc], min: c?.min ?? u * sc, full: c?.full ?? 0, small: c?.small ?? 0,
      cap2: c?.cap2 ?? u * sc, life: [w.ts ?? 0, (w.ts ?? 0) + lifeMs(w)], ride: (w.path?.length ?? 0) > 1, path: w.path ?? null, cover: w.cover, ink: inkShare(w), around: w.around ?? C.AROUND, touch: C.TOUCH };
  });
}
/** MAPSFXSEAT2: the share of a word's box (FIT.wordBox: its hold box with room for its entrance and outline) its INK covers - the hold
    picture and the ink rim the engine draws under a world word (RIMUNDER 1.9.12, about INK_RIM cap heights round it): what may not lie on
    a pin, a token, a panel or another word. [kx, ky]; [1, 1] for a word without a measured box. */
export const INK_RIM = 0.08;
export function inkShare(w) {
  const u = w.size > 0 ? w.size : 0;
  if ( !(u > 0) || !(w.bw > 0) || !(w.bh > 0) ) return [1, 1];
  const bx = w.bw / u, by = w.bh / u, hx = (bx - FIT.PAD.wc) / FIT.PAD.w, hy = (by - FIT.PAD.hc) / FIT.PAD.h;
  return [Math.min(1, Math.max(0.5, (hx + 2 * INK_RIM) / bx)), Math.min(1, Math.max(0.5, (hy + 2 * INK_RIM) / by))];
}
/** the engine's plan facts the size model reads (its mood factor sizeK, its hold box's width) */
export function planInfo(text, o, d) {
  const hd = holdOf(text, o, d);
  return hd ? { sizeK: hd.sk, hold: { w: hd.w } } : { sizeK: 1, hold: { w: 3 } };
}
/** THUNDERFIT: the engine's hold box of a word ({ w, h } in units of its cap height, sizeK): L.planFor, else its planner; remembered */
export function holdOf(text, o, d) {
  const key = `${text}|${o.seed ?? ""}|${o.space ?? ""}|${o.in ?? ""}|${o.holdKind ?? ""}|${o.out ?? ""}|${o.character?.material ?? ""}`;
  if ( d.memo?.has(key) ) return d.memo.get(key);
  const L = d.L;
  let r = null;
  try {
    const pf = L?.planFor?.(text, { ...o, reduced: false }), hb = pf?.plan?._holdBox;
    if ( hb?.w > 0 ) r = { w: hb.w, h: hb.h, sk: pf.plan.sizeK ?? 1 };
  } catch { /* the planner below */ }
  if ( !r ) try {
    if ( L?._plan && L?._settle ) { const plan = L._plan(String(text), { ...o, reduced: false }); L._settle(plan); r = plan._holdBox?.w > 0 ? { w: plan._holdBox.w, h: plan._holdBox.h, sk: plan.sizeK ?? 1 } : null; }
  } catch { r = null; }
  if ( d.memo ) { d.memo.set(key, r); if ( d.memo.size > 400 ) d.memo.delete(d.memo.keys().next().value); }
  return r;
}
/** The engine's own measure of a word (L.measure, LETR 1.9.11: the box it will draw and the whole reach of its entrance and hold), in
    units of its cap height (no seat's own size setting is in it), with the table's motion (reduced false). null without L.measure. */
export function measureOf(text, o, d) {
  try {
    const m = d.L?.measure?.(text, { ...o, reduced: false, at: o.at ?? { x: 0, y: 0 } });
    if ( !(m?.unit > 0) || !(m.hold?.w > 0) ) return null;
    const u = m.unit;
    return { w: m.hold.w / u, h: m.hold.h / u, sk: m.sizeK ?? 1, reach: { l: m.reach.l / u, r: m.reach.r / u, u: m.reach.u / u, d: m.reach.d / u } };
  } catch { return null; }
}
/** The word's TABLE box (scene px) at its table size and its reach (the engine's own measure): the table's placement keeps the box free,
    the seat rule keeps the reach in a seat's view. */
export function measure(w, d) {
  if ( !w.text ) return;
  try {
    const o = optsOf(w, d);
    const md = measureOf(w.text, o, d), hd = md ?? holdOf(w.text, o, d), hb = hd ?? FIT.estHold(w.chars ?? [...w.text].length), sk = hd?.sk ?? 1;
    // (the table size, counted once; a seat's own size setting - the engine's `_k` - is the seat's, not the table's)
    const u = (o.size ?? d.grid * 0.5) * sk;
    w.size = u;
    const b = FIT.wordBox(hb, u);
    w.bw = b.bw; w.bh = b.bh;
    // (the reach the engine itself reports for THIS word, instead of a factor per entrance that goes stale with the engine's motion)
    w.reachU = md?.reach ?? null; w.rk = md ? FIT.reachFactor(hb, md.reach) : FIT.reachOf(o.in);
    if ( w.drift ) { w.rise = d.grid * DRIFT[1]; w.riseX = d.grid * DRIFT[0]; }
  } catch { /* the estimate stands */ }
}
/** The engine's word for a spec (its vocabulary), different from the other words of the same moment. */
export function write(w, taken, d) {
  if ( w.stream ) return;
  try {
    const o = { seed: w.seed, lang: d.lang, loud: w.textLoud ?? w.loud, duration: w.ms, avoid: taken.slice() };
    // (engine 1.7.1 vocabulary: what was hit, the size of the pieces, the fire's stage; a cave-in's own spelling)
    const { kind = w.kind, ...wo } = C.wordOpts({ voice: w.voice, kind: w.kind, loud: o.loud, emat: w.emat, mat: w.mat, lang: o.lang, level: w.level });
    const word = d.L.word(kind, { ...o, ...wo });
    if ( !word?.text ) return;
    w.word = word; w.text = word.text; w.chars = [...word.text].length;
    taken.push(word.text, word.template);
  } catch ( err ) { d.warn?.(`no word for ${w.kind}`, err); }
}

/** The moments of a batch of due events (sfx.mjs flush), in the chunks a seat ON TIME gathers them in: from the earliest event's due time
    to GATHER_MS (+ a frame) after it, then the next. A seat whose events came late (busy applying the destruction) gets them all at once
    and, before, clustered two moments into one: other words than its neighbour. `dueAt` = sfx-core dueAt. */
export function moments(due, dueAt = C.dueAt) {
  const list = due.slice().sort((a, b) => (dueAt(a) - dueAt(b)) || (String(a.key) < String(b.key) ? -1 : 1)), out = [];
  while ( list.length ) {
    const d0 = dueAt(list[0]), n = list.findIndex((e) => dueAt(e) > d0 + C.GATHER_MS + 20);
    out.push(list.splice(0, n < 0 ? list.length : n));
  }
  return out;
}

/* ---------------------------------------------------------------- placement on the table */

/** The TABLE's placement context of a moment: the reference view round `c` at zoom `z` (no seat's panels: Foundry's bars are already off
    it), the tokens nobody hides, the pins every player may see, the ledger's words during [t0, t1] */
export function tableCtx(c, z, t0, t1, skip, d) {
  const v = SEAT.refView(c, z);
  return { view: v, ui: [], tokens: d.tokens?.(v) ?? [], pins: d.pins?.(v) ?? [], alive: d.ledger.boxes(t0, t1, skip) };
}
/** THUNDERFIT: placement where some words stand at a BIGGER step: sfx-core place, then the ladder down toward step 2's size (sfx-fit) */
export function placeFit(specs, ctx, d) {
  return FIT.ladderPlace(specs, ctx, { place: C.place, grows: (w) => !!w.text && !w.stream && !w.path && d.step(grpOf(w)) > SZ.SIZE_DEFAULT,
    resize: (w, f) => { const q = { ...w, fitK: f }; measure(q, d); return q; } });
}

/**
 * The TABLE picture of one moment's events (sfx.mjs flush gathers them in the chunks a seat on time gathers them in): clusters (sfx-core),
 * an echo of a sound just planned skipped (`recent`: the table's main words lately, kept by the caller), every satellite the best seat
 * keeps (CAPS.high), the words written in order, sized, measured and placed on the table; every placed word into the ledger.
 * -> [{ g, placed }] (placed: the words with x, y, box, size, t (this page's clock), ts (shared), key)
 */
export function planMoment(due, d, recent = []) {
  const G = d.grid, out = [];
  const groups = C.cluster(due, G).sort((a, b) => ((C.VOICES[b.main.voice]?.prio ?? 0) - (C.VOICES[a.main.voice]?.prio ?? 0)) || (b.rEq - a.rEq));
  for ( const g of groups ) {
    // (an echo of a sound just played - a bomb's crater after its fireball - is part of it)
    if ( !g.main.det && C.isEcho(g, recent, G) ) { out.push({ g, echo: true, placed: [] }); continue; }
    const specs = C.planCluster(g, { grid: G, sec: C.CAPS.high.sec, seed: d.sceneId, big: false, known: d.known });
    // (the reference view of the moment: centred on the cluster, at the zoom that holds its reach)
    const zr = g.span, z = SEAT.refZoom(G, zr), c = { x: g.x, y: g.y };
    for ( const w of specs ) { if ( w.role === "main" ) w.obj = g.main.obj; w.z = z; w.zr = zr; w.ts = d.toShared(w.t); w.key = `${w.seed}|${w.role}`; }
    // the engine writes each word (its vocabulary: the kind, how loud, how long; seeded, the same on every seat); the words of one moment
    // differ from each other (avoid), nothing of a seat's history changes them
    const taken = [];
    for ( const w of specs ) { write(w, taken, d); w.alive = d.ledger.count(w.ts, w.ts + lifeMs(w)); measure(w, d); }
    const t0 = Math.min(...specs.map((w) => w.ts)), t1 = Math.max(...specs.map((w) => w.ts + lifeMs(w)));
    const placed = placeFit(specs.filter((w) => w.text || w.stream), tableCtx(c, z, t0, t1, null, d), d);
    for ( const w of placed ) if ( w.box ) d.ledger.add({ key: w.key, box: lifeBox(w), t0: w.ts, t1: w.ts + lifeMs(w), main: w.role === "main" });
    const main = placed.find((w) => w.role === "main");
    if ( main ) recent.push({ x: g.x, y: g.y, reach: Math.max(g.span, (main.bh ?? 0) * 2), t: g.t, prio: C.VOICES[g.main.voice]?.prio ?? 0, voice: g.main.voice });
    out.push({ g, placed, specs: specs.length });
  }
  return out;
}

/**
 * The TABLE picture of a page (a preset firing, a plough, a flash in view): every word written in page order (its ground known from the
 * map: `p.ground`), sized on the reference view, measured by the engine, placed off the shared obstacles and the words the table already
 * holds, timed on the shared clock. -> Map(word key -> the placed word | { screenAt } | { dropped, why })
 */
export function planPage(p, d) {
  const table = new Map(), G = d.grid;
  const words = p.pg.words, main = words.find((q) => q.role === "main") ?? words[0];
  if ( !main ) return table;
  // (the reference view: centred on the page's main sound, at the zoom that holds its subject)
  const c = { x: main.x, y: main.y }, zr = main.r ?? G * 0.5, z = SEAT.refZoom(G, zr), vw = SEAT.refView(c, z);
  const env = { c, z, zr, vw, used: new Set(), mainBox: null, pins: d.pins?.(vw) ?? [] };
  p.texts ??= new Set();
  for ( const w of words ) {
    const sd = `${d.sceneId}|${w.seed}`;
    const wo = { ...w.wo, material: PG.materialFor(w.wo, p.ground) };
    if ( wo.material == null ) delete wo.material;
    // the word is written BEFORE any spot is picked (every seat writes the same words in the same order, whatever it shows), and never
    // repeats a word of its own page: one bomb's debris words were seen saying the same thing twice (EFFECTS1)
    let word;
    try { word = PG.unrepeated((s) => d.L.word(w.kind, { ...wo, seed: s, lang: d.lang }), sd, p.texts); }
    catch ( err ) { d.warn?.(`no word for ${w.kind}`, err); continue; }
    if ( !word?.text ) continue;
    p.texts.add(word.text);
    const q = pageWordPlan(p, w, word, sd, env, d);
    table.set(w.key, q);
    if ( w.role === "main" && q?.box ) env.mainBox = q.box;
  }
  return table;
}
/** One word of a page on the TABLE: its spot (a landing or a fire the reference view holds), its size, its box, its way, its place. */
function pageWordPlan(p, w0, word, sd, env, d) {
  const G = d.grid, { vw, z, zr } = env;
  let w = w0, alts = [];
  if ( w.cands ) {
    const ss = PG.pickSpots(w, vw, env.used, Number(p.rec.t0), 6), s = ss[0];
    if ( !s ) return { dropped: "spot", text: word.text, key: w0.key };
    alts = ss.slice(1);
    env.used.add(`${Math.round(s.x)},${Math.round(s.y)}`);
    w = { ...w, x: s.x, y: s.y };
  }
  const role = w.role === "main" ? "main" : w.role === "pre" ? "pre" : "sec";
  const r = w.r ?? G * 0.4, grp = SZ.groupOfPageWord(w0, p.grp), lag = w0.gate ? CATCH_SHOW_MS : 0;
  const spec = { role, grp, voice: w.kind, kind: w.kind, word, text: word.text, chars: [...word.text].length, x: w.x, y: w.y, t: d.toPerf(w.t + lag), ts: w.t + lag, ms: w.ms ?? 700, seed: sd,
    key: `${p.rec.id}|${w0.key}`, page: p.rec.id, z, zr, sx: w.at?.x ?? w.x, sy: w.at?.y ?? w.y,
    // (EFFECTS2: a story's words are sized by rank as a share of the REFERENCE view: readable, a lower rank never bigger)
    rank: w.rank, shrink: w.shrink ?? 1,
    magnitude: PG.pageMag(w, p.rec.size), area: Math.round(Math.max(G * 0.15, Math.min(r, G * 3))), rotation: (C.h01(w.seed + "|rot") - 0.5) * 10, stage: w.stage ?? {},
    cover: w.role === "main" ? 0.3 : 0.25, subject: w.box ?? { x0: w.x - r, y0: w.y - r, x1: w.x + r, y1: w.y + r }, drift: !!w.drift, ...(w.from ? { from: w.from } : {}),
    ...(w.role === "main" && w.side ? { around: C.besideOf(w.side) } : {}), ...(w.ride ? { path: w.ride } : {}) };
  if ( w.screen ) return { ...spec, screenAt: w.screen };
  spec.alive = d.ledger.count(spec.ts, spec.ts + lifeMs(spec));
  measure(spec, d);
  // (a ride from beyond the reference view's edge comes in AT the edge, whole; one going past it - the plough's grind - stops at it)
  if ( w.ride && spec.path ) {
    spec.path = PG.rideInView(spec.path, vw, spec.bw ?? 0, spec.bh ?? 0);
    if ( spec.path[0] ) { spec.x = spec.path[0].x; spec.y = spec.path[0].y; }
  }
  // a travelling PRE word leaves (its exit, about a fifth of a second) so it is gone PRE_GAP before the main word's frame
  if ( w.role === "pre" && w.ride ) {
    const mw = p.pg.words.find((q) => q.role === "main");
    if ( mw ) spec.stopAt = d.toPerf(mw.t) - PG.PRE_GAP - 220;
    // (a ride that hands over to the next one - the meteor's far whine to its roar - leaves when its own way ends)
    if ( p.pg.words.some((q) => q !== w0 && q.role === "pre" && q.ride && q.t > w0.t) ) spec.stopAt = Math.min(spec.stopAt ?? Infinity, spec.t + (w.ms ?? 0) + 60);
  } else if ( w.role === "pre" ) {
    // (EFFECTS2: a standing PRE word - the meteor's rumble - yields when the main word lands)
    const mw = p.pg.words.find((q) => q.role === "main");
    if ( mw ) spec.stopAt = d.toPerf(mw.t) + 40;
  }
  const life = lifeMs(spec), upNow = () => d.ledger.boxes(spec.ts, spec.ts + life, spec.key);
  // the wave rides out the free way of the TABLE picture: away from the main word as placed there, off the shared pins and the table's
  // words up, inside the reference view; its whole reach (the engine's measure) held there and off the pins along its whole way
  if ( w.wave ) {
    const avoid = [...(env.mainBox ? [env.mainBox] : []), ...upNow(), ...env.pins];
    const wr = PG.waveRide(w.wave.at, w.wave.r0, w.wave.reach, w.wave.rim, { avoid, ui: [], v: vw, wb: { w: spec.bw ?? G, h: spec.bh ?? G * 0.4 } });
    spec.path = FIT.rideFit(wr.ride, vw, avoid, spec.bw ?? G, spec.bh ?? G * 0.4, spec.rk ?? FIT.REACH.other, FIT.EDGE / z);
    spec.x = spec.path[0].x; spec.y = spec.path[0].y;
    // (a pressure front: the word travels upright and is gone soon after the front breaks up)
    spec.orient = "none"; spec.stopAt = spec.t + w.wave.rim + 180;
  }
  const ctxAt = (ts) => tableCtx(env.c, z, ts, ts + life, spec.key, d);
  // the debris / catch word covered by the story's bigger words takes the next landing the reference view holds; still covered, it
  // waits on the TABLE's timeline (a quarter second at a time, up to FALL_WAIT_MS) for the bigger words to clear: the debris keeps coming
  // down, the story still resolves - the same wait on every seat (before: on this seat's words up)
  const spots = [{ x: spec.x, y: spec.y }, ...alts];
  let placed = [];
  for ( let dt = 0; dt <= (w0.cands ? PG.FALL_WAIT_MS : 0) && !placed.length; dt += 250 ) {
    for ( const s of spots ) {
      const s2 = s === spots[0] && dt === 0 ? spec : { ...spec, x: s.x, y: s.y, t: spec.t + dt, ts: spec.ts + dt,
        ...(s === spots[0] ? {} : { subject: { x0: s.x - r, y0: s.y - r, x1: s.x + r, y1: s.y + r }, sx: s.x, sy: s.y }) };
      placed = placeFit([s2], ctxAt(s2.ts), d);
      if ( placed.length ) { if ( s !== spots[0] ) env.used.add(`${Math.round(s.x)},${Math.round(s.y)}`); break; }
    }
  }
  if ( !placed.length ) {
    const why = C.place([{ ...spec, role: "main" }], ctxAt(spec.ts))[0]?.pen;
    return { dropped: "room", text: spec.text, key: w0.key, why: why && { tok: +why.tok.toFixed(2), pin: +(why.pin ?? 0).toFixed(2), wrd: +why.wrd.toFixed(2), off: +why.off.toFixed(2) } };
  }
  const q = placed[0];
  d.ledger.add({ key: q.key, page: p.rec.id, box: lifeBox(q), t0: q.ts, t1: q.ts + lifeMs(q), main: q.role === "main" });
  return q;
}
