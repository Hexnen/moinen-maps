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
import * as D from "./sfx-direct.mjs";

/** the engine's tick (24 a second): its timeline's pictures last whole ticks */
const TICK_MS = 1000 / 24;

/** steam's way up off what was put out (grid squares: sideways, up) */
export const DRIFT = [0.15, 0.9];
/** a fire's catch word sounds this long after the fire's shared moment (a seat on time shows its flames by then; question MAPSFXSEAT-2) */
export const CATCH_SHOW_MS = 400;

/** MAPDIRECT: where a rising word drifts to, in grid squares from its place ([dx, dy], dy < 0 = up): downwind of its fire's wind (`w.wind`) */
export const driftOf = (w) => D.driftTo(DRIFT, w?.wind ?? null);
/** MAPDIRECT: is this word knocked along a way (it has one and does not ride, drift or stream)? */
export const knocked = (w) => !!w?.way && Number.isFinite(w.way.ux) && Number.isFinite(w.way.uy) && !w.path && !w.drift && !w.stream;
/** MAPDIRECT: the knock of a word (sfx-direct KNOCK): a main word's or a smaller word's */
export const knockOf = (w) => (w.role === "main" ? D.KNOCK.main : D.KNOCK.sec);
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
  // (MAPDIRECT: a knocked word slides on along its way while it stands: the table keeps that room free of the words that come after it)
  if ( knocked(w) && w.size > 0 ) { const s = knockOf(w).drift * w.size; b = unionBox(b, moveBox(b, w.way.ux * s, w.way.uy * s)); }
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
  // MAPDIRECT: a word with a WAY grows and leans along it and its own sideways motions go that way (sfx-direct lookOf: an ANGLE, the same
  // on every seat; the word is measured and placed with it); its knock is the seat's (sfx.mjs seatCall). A rider or a drifter keeps its own way.
  // (a piece thrown out of a blast - `flat` - keeps the look it had: its footprint on the table is unchanged, only its knock is new)
  if ( knocked(w) && !w.flat ) Object.assign(o, D.lookOf(w.way, w.rotation ?? 0, w.role === "main" ? D.LEAN.main : D.LEAN.sec));
  // what was hit makes the sound: its material (the engine's look follows it); the word's own character stays, only its material changes
  if ( w.emat && o.character ) o.character = { ...o.character, material: w.emat };
  // the word lasts as long as its sound (a fire going out hisses while its flames die; a crack is a snap)
  if ( w.ms >= 900 ) o.hold = Math.round(Math.min(4500, Math.max(600, w.ms * 0.7)));
  // steam drifts up off what was put out
  // (MAPDIRECT: downwind - the wind of the fire it rises off, sfx-direct driftTo; still air: straight up as before)
  if ( w.drift ) o.path = { from: { x: w.x, y: w.y }, to: { x: w.x + G * driftOf(w)[0], y: w.y + G * driftOf(w)[1] }, duration: Math.round(w.ms * 1.1), ease: "out", orient: "none" };
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
  // (the smallest a word of a bigger step may be drawn where nothing clean holds it: the legibility floor with room for step 1 under it -
  // clean before big, MAPSFXSEAT2-1; step 1 then yields under it, `probe`)
  const lo = floor * SEAT.MIN_GAIN, small = s < SZ.SIZE_DEFAULT ? min : W(Math.min(lo, px2));
  // (step 1: the sizes a step-2 word of this seat would try here - its own, then smaller down to `small` -: where step 2 must shrink for
  // room, step 1 stays under what it gets, so a seat short of room still draws step 1 < step 2: seatLayout rule "yield")
  let probe = null;
  if ( s < SZ.SIZE_DEFAULT && s > 0 ) { probe = [W(px2)]; for ( let px = px2 * 0.95; px > lo * 1.0001; px *= 0.95 ) probe.push(W(px)); if ( lo < px2 ) probe.push(W(lo)); }
  // (MAPSAME: the three steps' own sizes on this seat - the seat layout draws the step's share inside ONE envelope for every step, so a
  // seat short of room keeps 3 > 2 > 1 as drawn: sfx-seat seatLayout)
  const nom = [W(Math.min(SEAT.stepPx(px2, 1, floor), px2 / SEAT.MIN_GAIN)), W(px2), W(SEAT.stepPx(px2, 3, floor))];
  return { sizes, min, full, small, probe, floor: W(floor), cap2: W(px2), nom, step: s };
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
  return ws.filter((w) => w && w.text && Number.isFinite(w.x)).map((w, i) => seatItem(w, i, d, seat));
}
/** MAPPLAN: one word's item of the seat layout; `i` its place among the located words of its picture (seatItems: the same item) */
export function seatItem(w, i, d, seat) {
  const sc = seat.scale > 0 ? seat.scale : 1;
  {
    const c = seatCaps(w, d, seat), u = w.size > 0 ? w.size : d.grid * 0.5;
    const prio = w.role === "main" ? 0 : w.role === "pre" ? 1 : w.wave || w.voice === "shockwave" ? 2 : 3 + i * 1e-3;
    return { key: w.key ?? `${w.seed}|${w.role}`, w, prio, box: w.box ?? C.boxOf(w), u, sub: w.subject ?? null, sizes: c?.sizes ?? [u * sc], min: c?.min ?? u * sc, full: c?.full ?? 0, small: c?.small ?? 0,
      probe: c?.probe ?? null, floor: c?.floor ?? 0, nom: c?.nom ?? null, step: c?.step ?? null, side: w.side ?? null, cov2: w.cov2 ?? null, box2: w.box2 ?? null, u2: w.size2 ?? null, cap2: c?.cap2 ?? u * sc, life: [w.ts ?? 0, (w.ts ?? 0) + lifeMs(w)], reach: w.inkU ?? null, heard: !!w.heard || !!w.hint, main: w.role === "main", sound: Number.isFinite(w.sx) && Number.isFinite(w.sy) ? { x: w.sx, y: w.sy } : null, ride: (w.path?.length ?? 0) > 1, path: w.path ?? null, cover: w.cover, ink: inkShare(w), around: w.around ?? C.AROUND, touch: C.TOUCH,
      // (MAPRIDE rideLayout: when a rider leaves (shared ms), the end of its way it is tied to - a fall its end over the impact, a wave or
      // a crack its start at the blast - and whether it may turn round that start - a shock wave leaves every way)
      ...((w.path?.length ?? 0) > 1 ? { stop: Number.isFinite(w.stopAt) && Number.isFinite(w.t) ? (w.ts ?? 0) + (w.stopAt - w.t) + (Number(w.exitMs) || 0) : null, anchor: w.role === "pre" ? "end" : "start", turn: w.voice === "shockwave" || w.kind === "shockwave" } : {}) };
  }
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
const INK_VIEW = { vw: SEAT.REF_VW, vh: SEAT.REF_VH, zoom: 1, alive: 0, dpr: 1 };
export function measureOf(text, o, d) {
  try {
    const m = d.L?.measure?.(text, { ...o, reduced: false, at: o.at ?? { x: 0, y: 0 } });
    if ( !(m?.unit > 0) || !(m.hold?.w > 0) ) return null;
    const u = m.unit;
    // (MAPEDGE: the INK the word really puts down from its first entrance drawing on - turned by its rotation, its entrance poses, a
    // tucked prefix, the duplicate block and rim (engine 1.9.18 inkReach) - in cap heights from its centre: what the seat keeps whole
    // inside its view. Live 2026-11-15 a detonate word turned a few degrees stood with its box in the view and its ink cut by the edge.)
    // (read from a measure on the REFERENCE view - its pixel floors at a fixed scale, not this seat's zoom: the ink of a live-zoom measure
    // differs per seat by its floors, and the engine's shared picture memo then gave the next word of the table a place 1 px apart)
    let ink = null;
    try { const ir = d.L.measure(text, { ...o, reduced: false, at: o.at ?? { x: 0, y: 0 }, view: INK_VIEW })?.stand; if ( ir && ["l", "r", "u", "d"].every((k) => Number.isFinite(ir[k])) ) ink = { l: ir.l / u, r: ir.r / u, u: ir.u / u, d: ir.d / u }; } catch { ink = null; }
    return { w: m.hold.w / u, h: m.hold.h / u, sk: m.sizeK ?? 1, reach: { l: m.reach.l / u, r: m.reach.r / u, u: m.reach.u / u, d: m.reach.d / u }, ink, holdMs: Number(m.plan?.holdMs) || 0,
      exitMs: (m.plan?.timeline?.exit ?? []).reduce((a, p) => a + (Number(p.ticks) || 0) * TICK_MS, 0) };
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
    w.inkU = md?.ink ?? null;
    // (MAPRIDE: the hold the engine gives the word - its sound family's own body: a shock wave holds 1.3 s, KA-BOOOOM 1.4 s - so its life
    // on the table (sfx-seat lifeOf) is as long as it really stands: live a wave word still stood when a debris word was laid onto it)
    w.holdMs = md?.holdMs ?? 0;
    // (and its exit: a rider stopped early - the wave at its rim - plays its exit from the stop, still legible about half of it: live
    // the debris word laid out 250 ms after the wave's stop was lettered onto it)
    w.exitMs = md?.exitMs ?? 0;
    if ( w.drift ) { const dr = driftOf(w); w.rise = Math.max(0, -d.grid * dr[1]); w.riseX = d.grid * dr[0]; }
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
export function planMoment(due, d0, recent = []) {
  const G = d0.grid, out = [], d = atStep2(d0);
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
    const mw = placed.find((w) => w.role === "main");
    if ( mw ) mainSide(mw, d0);
    for ( const w of placed ) restep(w, d0);
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
export function planPage(p, d0) {
  const pl = pagePlanner(p, d0);
  while ( pl.step() ) { /* every unit, at once */ }
  return pl.table;
}
/**
 * MAPPLAN: the table picture of a page, planned ONE UNIT AT A TIME (planPage runs them all at once: the same picture). Live 2026-11-16 a
 * bomb's whole page was planned inside one timer task of 44-75 ms at its firing (a fresh engine settle a word, two measures a word, the
 * main word's side) - a long frame on every seat at each bomb. The units, in the order planPage always did the work:
 *   a word of the page (in page order: written, sized, measured, placed, into the ledger) - the main word's SIDE is a unit of its own -,
 *   then each placed word drawn at its group's step (restep) and its ledger entry.
 * A caller that needs a word before the whole page is planned (sfx.mjs: the first word of a bomb's page is due a tenth of a second after
 * its record) plans up to it (`upTo`) and draws it at its step early (`early`: restep reads only the word itself; its ledger entry is
 * still written at the end, in the same order, so every later word is placed against the same ledger as before). The picture is the
 * same as planPage's as long as nothing else reads or writes the ledger between the units and `d0` answers the same throughout - the
 * caller's part (sfx.mjs settles a page in flight before anything else touches the ledger, and freezes the deps at its start).
 * -> { table (Map, filled as units run), words (the page's), planned (page words done), done, step() -> more?, upTo(i) (plan the page
 *      words up to index i, at once), early(q) (restep a placed word now), isPlaced(q) }
 */
export function pagePlanner(p, d0) {
  const table = new Map(), G = d0.grid, d = atStep2(d0);
  const words = p.pg.words, main = words.find((q) => q.role === "main") ?? words[0];
  const pl = { table, words, planned: 0, done: false, units: 0, step: () => false, upTo() {}, early() {}, isPlaced: (q) => !!(q?.box && !q.screenAt && !q.dropped) };
  if ( !main ) { pl.done = true; pl.planned = words.length; return pl; }
  // (the reference view: centred on the page's main sound, at the zoom that holds its subject)
  const c = { x: main.x, y: main.y }, zr = main.r ?? G * 0.5, z = SEAT.refZoom(G, zr), vw = SEAT.refView(c, z);
  const env = { c, z, zr, vw, used: new Set(), mainBox: null, pins: d.pins?.(vw) ?? [] };
  p.texts ??= new Set();
  let i = 0, pend = null, vals = null, j = 0;
  const stepped = new Set();
  // one word of the page; -> a second unit still to run for it (the main word's side), or null
  const word = (w) => {
    const sd = `${d.sceneId}|${w.seed}`;
    const wo = { ...w.wo, material: PG.materialFor(w.wo, p.ground) };
    if ( wo.material == null ) delete wo.material;
    // the word is written BEFORE any spot is picked (every seat writes the same words in the same order, whatever it shows), and never
    // repeats a word of its own page: one bomb's debris words were seen saying the same thing twice (EFFECTS1)
    let wd;
    try { wd = PG.unrepeated((s) => d.L.word(w.kind, { ...wo, seed: s, lang: d.lang }), sd, p.texts); }
    catch ( err ) { d.warn?.(`no word for ${w.kind}`, err); return null; }
    if ( !wd?.text ) return null;
    p.texts.add(wd.text);
    const q = pageWordPlan(p, w, wd, sd, env, d);
    const rest = (side) => {
      if ( side ) { mainSide(q, d0); d.ledger.add({ key: q.key, page: p.rec.id, box: lifeBox(q), t0: q.ts, t1: q.ts + lifeMs(q), main: true }); }
      table.set(w.key, q);
      if ( w.role === "main" && q?.box ) env.mainBox = q.box;
    };
    if ( w.role === "main" && q?.box && !q.screenAt ) return () => rest(true);
    rest(false);
    return null;
  };
  const unitA = () => {
    if ( pend ) { const f = pend; pend = null; f(); pl.planned = i; return; }
    pend = word(words[i++]);
    if ( !pend ) pl.planned = i;
  };
  const restepOnce = (q) => { if ( stepped.has(q) ) return false; stepped.add(q); restep(q, d0); return true; };
  pl.upTo = (k) => { while ( !pl.done && (pend || i < words.length) && pl.planned <= k ) { unitA(); pl.units++; } };
  pl.early = (q) => { if ( pl.isPlaced(q) ) restepOnce(q); };
  pl.step = () => {
    if ( pl.done ) return false;
    pl.units++;
    if ( pend || i < words.length ) { unitA(); return true; }
    // (MAPSAME: placed at step 2's sizes, drawn at the group's own step - each word scaled about its point nearest the thing)
    vals ??= [...table.values()];
    while ( j < vals.length ) {
      const q = vals[j++];
      if ( !pl.isPlaced(q) ) continue;
      const worked = restepOnce(q);
      d0.ledger.add({ key: q.key, page: p.rec.id, box: lifeBox(q), t0: q.ts, t1: q.ts + lifeMs(q), main: q.role === "main" });
      if ( worked && j < vals.length ) return true;
    }
    pl.done = true;
    return false;
  };
  return pl;
}
/** MAPSAME: the deps a table picture is PLACED with - the size step of every group at step 2 (0 stays 0): the table's places, the words it
    keeps and drops and the sides they stand on are the same whatever step the table plays at; each word is then drawn at its step's own
    size about its point nearest the thing (restep). Before, every step placed its own picture: a word stood below the bomb at step 1 and
    above it at steps 2 / 3 (MAPSFXSEAT2-6), and a seat's step 3 could get less room than its step 2. */
export function atStep2(d) {
  if ( d.__step2 ) return d;
  return { ...d, __step2: true, step: (g) => { const s = d.step(g); return s > 0 ? SZ.SIZE_DEFAULT : s; } };
}
/** MAPSAME: a placed table word drawn at its group's own size step: measured again at that step and scaled about the point of its step-2
    box nearest its subject's centre (its side and its gap kept); a word that rides keeps its way. */
export function restep(w, d) {
  try {
    if ( !w || !w.text || w.stream || !w.box ) return;
    const st = d.step(grpOf(w));
    if ( st === SZ.SIZE_DEFAULT || st === 0 ) return;
    const u2 = w.size, b2 = w.box;
    // (the share of its subject the table's step-2 box covers: what every step's seat layout lets it cover - one picture at every step)
    if ( w.subject ) { const sb = w.subject, ix = Math.max(0, Math.min(b2.x1, sb.x1) - Math.max(b2.x0, sb.x0)), iy = Math.max(0, Math.min(b2.y1, sb.y1) - Math.max(b2.y0, sb.y0));
      w.cov2 = (ix * iy) / Math.max(1, (sb.x1 - sb.x0) * (sb.y1 - sb.y0)); }
    // (the step-2 place every seat searches its envelope from: the same at every step)
    w.box2 = b2; w.size2 = u2;
    measure(w, d);
    if ( !(u2 > 0) || !(w.size > 0) ) return;
    const f = w.size / u2;
    if ( w.path?.length > 1 ) { w.box = C.boxOf(w); return; }
    // (the same side of its subject in the same proportion as at step 2: SEAT.shrinkOnSide, the seats' own rule for a smaller step)
    const nb = SEAT.shrinkOnSide(b2, f, w.subject ?? null), mx = (b2.x0 + b2.x1) / 2, my = (b2.y0 + b2.y1) / 2;
    w.x = (nb.x0 + nb.x1) / 2 + (w.x - mx) * f; w.y = (nb.y0 + nb.y1) / 2 + (w.y - my) * f;
    w.box = C.boxOf(w);
  } catch ( err ) { d.warn?.("restep", err); }
}
/** MAPSAME: the probe seats the table chooses its main word's side on (shared: the reference window centred on the word's subject at the
    moment's reference zoom and closer - where seats usually look from -, the shared panel zones of the reference window, the shared pins
    and tokens) */
export const SIDE_PROBES = [1, 1.45, 2];
/**
 * MAPSAME: THE SIDE of a main word - the side of its subject every seat draws it on (seatLayout keeps it). The table's own placement
 * looks only at the reference view, where a big word has room above a blast that a closer seat has not (live 2026-11-15: on the take's
 * seats the blast's word above the bomb had room for 181 / 88 world px at step 2, below it 222 / 126). So the table tries each side of its
 * shared order on the probe seats (SIDE_PROBES) and takes the side whose WORST probe holds the largest share of its step-3 size clean
 * (the earlier side of the order within 4 %); the table's word moves there on the reference probe when it stands clean there at its own
 * size. Pure, shared data only: every seat chooses the same. Sets w.side ({ x, y }).
 */
export function mainSide(w, d) {
  try {
    if ( !w?.subject || !w.box || w.path?.length > 1 ) return;
    const sub = w.subject, c = { x: (sub.x0 + sub.x1) / 2, y: (sub.y0 + sub.y1) / 2 }, z0 = w.z ?? SEAT.refZoom(d.grid, w.zr ?? 0);
    const order = [];
    for ( const [ox, oy] of (w.around ?? C.AROUND) ) { if ( !ox && !oy ) continue; const s = Math.abs(ox) > Math.abs(oy) ? { x: Math.sign(ox), y: 0 } : { x: 0, y: Math.sign(oy) }; if ( !order.some((q) => q.x === s.x && q.y === s.y) ) order.push(s); }
    for ( const s of [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }] ) if ( !order.some((q) => q.x === s.x && q.y === s.y) ) order.push(s);
    const d2 = atStep2(d), probes = SIDE_PROBES.map((k) => {
      const z = z0 * k, u = 1 / z, view = { x0: c.x - (SEAT.REF_VW / 2) * u, y0: c.y - (SEAT.REF_VH / 2) * u, x1: c.x + (SEAT.REF_VW / 2) * u, y1: c.y + (SEAT.REF_VH / 2) * u };
      const panels = SEAT.SCREEN_ZONES.map((r) => ({ x0: view.x0 + r.x0 * u, y0: view.y0 + r.y0 * u, x1: view.x0 + r.x1 * u, y1: view.y0 + r.y1 * u }));
      const item = seatItems([w], d2, { vw: SEAT.REF_VW, vh: SEAT.REF_VH, zoom: z, scale: 1 })[0];
      return { z, view, panels, item, pins: d.pins?.(view) ?? [], tokens: d.tokens?.(view) ?? [] };
    });
    let best = null;
    for ( const s of order ) {
      let worst = Infinity, ref = null;
      for ( const pr of probes ) {
        if ( !pr.item?.nom ) { worst = 0; break; }
        const f = SEAT.seatLayout([{ ...pr.item, side: s, step: 3, prio: 0 }], { view: pr.view, panels: pr.panels, pins: pr.pins, tokens: pr.tokens, zoom: pr.z }).get(pr.item.key);
        const r = f?.ok && !f.rules.includes("side") ? f.cap / pr.item.nom[2] : 0;
        worst = Math.min(worst, r);
        if ( pr === probes[0] ) ref = f;
      }
      if ( !best || worst > best.worst * 1.04 + 1e-9 ) best = { s, worst, ref };
    }
    if ( !best ) return;
    w.side = best.s;
    // (the table's own word on that side: where the reference probe stands it at step 2's size, when clean there)
    const s0 = SEAT.sideOfBox(w.box, sub);
    if ( s0 && s0.x === best.s.x && s0.y === best.s.y ) return;
    const pr = probes[0], f = SEAT.seatLayout([{ ...pr.item, side: best.s, step: 2, prio: 0 }], { view: pr.view, panels: pr.panels, pins: pr.pins, tokens: pr.tokens, zoom: pr.z }).get(pr.item.key);
    if ( f?.ok && f.box && !f.rules.includes("side") ) {
      const sc = w.size / Math.max(1e-6, f.cap), b = f.box, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      // (its box there at the table's own size, about the point nearest the subject)
      const px = Math.min(b.x1, Math.max(b.x0, c.x)), py = Math.min(b.y1, Math.max(b.y0, c.y));
      const nx = px + (cx - px) * sc, ny = py + (cy - py) * sc, ox = (w.box.x0 + w.box.x1) / 2, oy = (w.box.y0 + w.box.y1) / 2;
      w.x += nx - ox; w.y += ny - oy; w.box = C.boxOf(w);
    }
  } catch ( err ) { d.warn?.("main side", err); }
}
/** MAPSEATS3: where a page word's SOUND is - the point a seat must see to letter it on the map (sfx.mjs hereVisible): its own `at`, else
    for a word that rides its way the end the way is tied to (a falling bomb's or a meteor's whistle: the impact - its start lies in the sky,
    often off the scene, so a player's vision test of it failed and his seat drew the fall word unlocated on the screen while the GM's rode
    the path: ADVM r2 item 10), else its place. `impact` (the page's main word: the impact) - a fall word sounds there: a meteor's far
    whine hands over to its roar high in the sky, its own way's end off the scene (live 2026-11-15 the player still drew it on the screen). */
export function soundAt(w, impact = null) {
  if ( w.at && Number.isFinite(w.at.x) ) return { sx: w.at.x, sy: w.at.y };
  const r = Array.isArray(w.ride) && w.ride.length > 1 ? w.ride : null;
  if ( r && w.role === "pre" && impact && Number.isFinite(impact.x) && Number.isFinite(impact.y) ) return { sx: impact.x, sy: impact.y };
  if ( r ) { const q = w.role === "pre" ? r.at(-1) : r[0]; if ( Number.isFinite(q?.x) ) return { sx: q.x, sy: q.y }; }
  return { sx: w.x, sy: w.y };
}
/** MAPDIRECT: a page word's way - its own, or the way a piece was thrown (`thrown`: the impact) to where it is lettered */
const wayFor = (w, G) => w.way ?? (w.thrown ? D.wayOf(w.thrown, w, G * 0.25) : null);
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
    key: `${p.rec.id}|${w0.key}`, page: p.rec.id, z, zr, ...soundAt(w, p.pg?.words?.find((q) => q.role === "main") ?? null),
    // (MAPSEATS3: a sound heard all over the scene - a close thunder strike -: a seat whose view does not hold it letters it at its view's
    // edge toward it, by the seat rule, instead of each seat deciding by its own view whether it is a map word or a screen word)
    ...(w.heard ? { heard: true } : {}),
    // (MAPTHUNDER, ADVM r2 item 9, K 32.7 s: a bomb off every seat's view gave no hint at all - its main word was "off" everywhere. The main
    // word of a big event (rank 4 and up: a shell, a bomb, a meteor, a plough's stop) is HEARD beyond the view: a seat whose view does not
    // hold it letters it at its view's edge toward it, "away", at most OFF_K of its size - the rest of its page stays where it happens)
    ...(w.role === "main" && (w.rank ?? 0) >= 4 && !w.heard && !w.screen ? { hint: true } : {}),
    // (EFFECTS2: a story's words are sized by rank as a share of the REFERENCE view: readable, a lower rank never bigger)
    rank: w.rank, shrink: w.shrink ?? 1,
    magnitude: PG.pageMag(w, p.rec.size), area: Math.round(Math.max(G * 0.15, Math.min(r, G * 3))), rotation: (C.h01(w.seed + "|rot") - 0.5) * 10, stage: w.stage ?? {},
    cover: w.role === "main" ? 0.3 : 0.25, subject: w.box ?? { x0: w.x - r, y0: w.y - r, x1: w.x + r, y1: w.y + r }, drift: !!w.drift, ...(w.from ? { from: w.from } : {}),
    // (MAPDIRECT: its way - its own, or for a piece thrown out of the blast from the impact to the landing lettered here; its fire's wind)
    ...(wayFor(w, G) ? { way: wayFor(w, G), ...(w.thrown ? { flat: true } : {}) } : {}), ...(w.wind ? { wind: w.wind } : {}),
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
        ...(s === spots[0] ? {} : { subject: { x0: s.x - r, y0: s.y - r, x1: s.x + r, y1: s.y + r }, sx: s.x, sy: s.y, ...(w.thrown ? { way: D.wayOf(w.thrown, s, G * 0.25) ?? undefined } : {}) }) };
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
