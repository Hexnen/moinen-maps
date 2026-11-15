/* MAPSFXSEAT: ONE PICTURE FOR THE TABLE, then ONE RULE PER SEAT (pure: no Foundry, no PIXI, no DOM; node-tested in
   dev/sfx-seat.test.mjs). The owner's standard for the map's lettering: every seat that sees the place shows the same words, at the
   same size and place on the map, at the same instant, and the same again when the event is replayed.

   Before, each seat letters a map event from its OWN view: the words were written in the order its timers fired (a seat busy applying
   the destruction wrote the debris words after the ground was known, another before: other words), sized by its window height and zoom
   and clamped by the engine's size model with this seat's window and its own count of words up (a seat with more words up drew the main
   word smaller), placed around its own panels, its own tokens (the GM sees hidden ones) and its own words up, and started when its
   timer fired (a seat busy for two seconds dropped the words as too late).

   Now (the rule this module sets; plus-ultra's roll splash set the same for its map block: same-picture.mjs, MAPSEAT):
   1. The TABLE PICTURE of a map moment is computed from what every seat shares: the event (its record, its strokes, its shared time),
      the scene (grid, its rectangle, the tokens nobody hides, the note pins every player may see), the table's settings, and a
      REFERENCE VIEW instead of this seat's view: the reference window (REF_VW x REF_VH CSS px minus RESERVE, Foundry's bars) centred on
      the event at a REFERENCE ZOOM (refZoom: REF_SQ squares in the window's height, wider when the event itself is bigger). Words are
      sized in scene px by the engine's own size model fed that reference view (fit "world" afterwards: no second clamp per seat),
      measured by the engine (L.measure: the hold box and the whole reach of the entrance and the hold), placed off the shared
      obstacles and off the words the table picture already holds (the LEDGER: planned words, not what one seat happened to draw), and
      timed on the shared clock (`startAt`).
   2. A seat shows that picture unchanged, except by these rules only (seatFit), each logged per seat:
      - not on this seat's screen (the place and the word both off its view): nothing (as before);
      - smaller than READ_PX on this seat's screen (a far zoom): drawn at READ_PX cap height at its place ("read");
      - its reach (the whole entrance) bigger than this seat's view: made smaller to fit the view, at its place ("fit");
      - cut by this seat's view edge or under one of this seat's own panels: moved by the smallest shift that shows it whole ("shift");
      - a place this seat may not see (a player: fog, out of vision, a hidden shooter): unlocated on the screen (as before);
      - this seat's reduced motion and its performance mode (fewer words up) as before: they are this seat's needs, not its view.
      Words on the SCREEN (unlocated: thunder, a sound from a place this seat cannot see) are laid out once in the reference window
      (SCREEN_ZONES: the shared panel zones every seat keeps them off) and drawn centred in this seat's window; a smaller window
      shifts them in, then shrinks them, by the same rule. */

import * as SZ from "./sfx-size.mjs";
import * as FIT from "./sfx-fit.mjs";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inter = (a, b) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

/** the reference window (CSS px): as plus-ultra's same-picture.mjs (SAMEPIC-1) */
export const REF_VW = 1600, REF_VH = 900;
/** Foundry's own bars, kept off on the reference window (CSS px from its edges; same-picture.mjs RESERVE, measured live) */
export const RESERVE = Object.freeze({ l: 96, t: 54, r: 356, b: 98 });
/** the engine's usable width on the reference window (its sidebar collapsed: innerWidth; the engine counts an open sidebar out) */
export const REF_USABLE_W = REF_VW;
/** squares of the scene in the reference window's height at the reference zoom (provisional MAPSFXSEAT-1: a GM's usual table view,
    The Warehouse at 0.45 shows 5.7 squares of 350 px in 900 px) */
export const REF_SQ = 6;
/** the smallest cap height (CSS px) a map word is drawn at on any seat (the engine's legibility floor floorMin) */
export const READ_PX = 15;
/** a word's margin from a seat's view edge, CSS px (sfx-fit EDGE) */
export const SEAT_EDGE = 16;

/**
 * The reference zoom of a map moment (pure, shared): REF_SQ squares in the reference window's height; a moment bigger than that (a
 * meteor's ring, a wide cluster) is referenced at the zoom that holds its extent `r` (scene px, radius) with room around it.
 */
export function refZoom(grid = 100, r = 0) {
  const g = grid > 0 ? grid : 100, zGrid = REF_VH / (REF_SQ * g);
  const inner = REF_VH - RESERVE.t - RESERVE.b;
  const zFit = r > 0 ? inner / (2.5 * r) : Infinity;
  return Math.max(zGrid * 0.25, Math.min(zGrid, zFit));
}
/** The reference view of a moment (scene px): the reference window minus RESERVE, centred on `c` (the event) at zoom `z`. */
export function refView(c, z) {
  const u = 1 / Math.max(1e-4, z);
  return { x0: c.x - (REF_VW / 2 - RESERVE.l) * u, y0: c.y - (REF_VH / 2 - RESERVE.t) * u, x1: c.x + (REF_VW / 2 - RESERVE.r) * u, y1: c.y + (REF_VH / 2 - RESERVE.b) * u };
}
/**
 * The engine's size model fed the REFERENCE view (shared): `sizeFor` = the engine's own model (scripts/letters/size.mjs sizeFor), `o`
 * the play options of the word, `plan` { sizeK, hold: { w } } (the engine's plan: its mood factor and hold-box width), `z` the
 * reference zoom, `alive` the table's world words up at its moment (the ledger), `grid`. -> { size (scene px, to play with fit "world"),
 * px (cap height on the reference screen), clamp }.
 */
export function refSize(sizeFor, o, plan, { z = 1, alive = 0, grid = 100, fit = null, space = "world" } = {}) {
  const world = space === "world";
  const info = sizeFor({ space: world ? "world" : "screen", size: o.size, magnitude: o.magnitude, area: world ? areaOf(o.area) : 0, tokenSpan: 0, grid, zoom: world ? z : 1,
    vw: REF_USABLE_W, vh: REF_VH, scale: o.scale ?? 1, sizeK: plan?.sizeK ?? 1, aspect: plan?.hold?.w ?? 3, fit: fit ?? o.fit ?? "legible", alive: world ? alive : 0, pixel: 0,
    ceilK: o.ceil });
  return { size: info.size, px: info.px, clamp: info.clamp, natural: info.natural };
}
const areaOf = (a) => (Number.isFinite(a) ? a : a && Number.isFinite(a.radius) ? a.radius : a && Number.isFinite(a.w) ? 0.5 * Math.sqrt(a.w * (a.h ?? a.w)) : 0);
/** the engine's loudest ceiling for a word on the REFERENCE screen (cap px incl. its mood factor): sfx-size LOUD_K steps under it */
export function refLoudCap(sizeFor, o, plan, { z = 1, grid = 100, hardHi = 1.15, space = "world" } = {}) {
  const zz = space === "world" ? z : 1;
  const q = refSize(sizeFor, { ...o, size: (20 * REF_VH) / zz, scale: 1, magnitude: SZ.LOUD_MAG }, plan, { z: zz, grid, fit: "legible", space });
  return q.px > 0 ? q.px / hardHi : 0;
}
/**
 * The TABLE size of a map word in scene px (shared; play it with fit "world"): the engine's own model on the reference view at zoom `z`
 * with the table's words up (`alive`), then the group's size step (SFXSIZE, sfx-size steppedPx: at a smaller step under the engine's
 * legibility floor of the reference screen, at a bigger one under its loudest ceiling there; `fitK` the ladder's share of the extra
 * size). `model` = the engine's L.sizeModel. -> { size, px (cap px on the reference screen, mood factor in), clamp } | null (exact or
 * pixel lettering: sized another way).
 */
export function tableSize(sizeFor, model, o, plan, { z, alive = 0, grid = 100, step = SZ.SIZE_DEFAULT, fitK = 1 } = {}) {
  if ( !o || o.fit === "exact" || o.pixel ) return null;
  const q = refSize(sizeFor, o, plan, { z, alive, grid });
  const sk = plan?.sizeK ?? 1, s = SZ.stepOf(step);
  let px = q.px;
  if ( s !== SZ.SIZE_DEFAULT && s !== 0 ) {
    const st = SZ.steppedPx(px, s, s > SZ.SIZE_DEFAULT ? { cap: refLoudCap(sizeFor, o, plan, { z, grid, hardHi: model?.hardHi ?? 1.15 }) } : { floor: SZ.floorPx(REF_VH, sk, model) });
    px = s > SZ.SIZE_DEFAULT && Number.isFinite(fitK) && fitK < 1 ? px + (st - px) * Math.max(0, fitK) : st;
  }
  return { size: px / (sk * z), px, clamp: q.clamp };
}
/** The TABLE size of an unlocated (screen) ranked word, CSS px on the reference window: its rank's share of the reference height,
    stepped (SFXSIZE screenSizeAt, at a bigger step under the engine's loudest ceiling of the reference screen). */
export function tableScreenSize(sizeFor, model, o, plan, step = SZ.SIZE_DEFAULT) {
  const s = SZ.stepOf(step), sk = plan?.sizeK ?? 1;
  if ( s === SZ.SIZE_DEFAULT || s === 0 ) return o.size;
  return SZ.screenSizeAt(o.size, s, s > SZ.SIZE_DEFAULT ? refLoudCap(sizeFor, o, plan, { space: "screen", hardHi: model?.hardHi ?? 1.15 }) : 0, sk);
}

/* ---------------------------------------------------------------- the ledger: what the table picture holds */

/**
 * The words the table picture holds (shared: planned from shared events, never "what this seat drew"): { key, box (scene px), t0, t1
 * (shared ms), main? }. A word is placed off the ones that stand at its moment; its own life is [t0, t1].
 */
export function makeLedger(max = 200) {
  const list = [];
  return {
    list,
    add(e) { const i = list.findIndex((q) => q.key === e.key); if ( i >= 0 ) list.splice(i, 1); list.push(e); if ( list.length > max ) list.splice(0, list.length - max); return e; },
    /** the boxes of the words up during [t0, t1] (other keys than `skip`) */
    boxes(t0, t1, skip = null) { return list.filter((q) => q.box && q.t1 > t0 && q.t0 < t1 && q.key !== skip && !(skip && q.page && q.page === skip)).map((q) => q.box); },
    count(t0, t1) { return list.filter((q) => q.t1 > t0 && q.t0 < t1).length; },
    has: (key) => list.some((q) => q.key === key),
    get: (key) => list.find((q) => q.key === key) ?? null,
    prune(now) { for ( let i = list.length - 1; i >= 0; i-- ) if ( list[i].t1 < now - 30000 ) list.splice(i, 1); },
    clear() { list.length = 0; }
  };
}
/** a word's life on the table (shared ms): its sound, its hold, an exit */
export const lifeOf = (w, t) => ({ t0: t, t1: t + Math.max(600, Number(w.hold) || 0, Number(w.ms) || 0) + 450 });

/* ---------------------------------------------------------------- the seat rule */

/**
 * How THIS seat shows a word of the table picture (pure). `box` its hold box and `reach` its reach box (scene px, from L.measure at its
 * table place), `view` this seat's view (scene px), `panels` this seat's own interface panels (scene px), `zoom` this seat's zoom,
 * `cap` the word's cap height (scene px), `subject` what it letters (scene px, optional). -> { rule: "ok" | "off" | "read" | "fit" |
 * "shift", k (size factor), dx, dy (scene px) }. Only a seat's view and panels move or resize it, never its text or its instant.
 */
export function seatFit({ box, reach = null, view, panels = [], zoom = 1, cap = 0, subject = null, read = READ_PX, edge = SEAT_EDGE }) {
  const R = reach ?? box;
  if ( !view ) return { rule: "ok", k: 1, dx: 0, dy: 0 };
  if ( inter(R, view) <= 0 && !(subject && inter(subject, view) > 0) ) return { rule: "off", k: 1, dx: 0, dy: 0 };
  const rules = [];
  let k = 1;
  // (too small to read at this zoom: the readable floor, in place)
  if ( cap > 0 && cap * zoom < read ) { k = read / (cap * zoom); rules.push("read"); }
  const m = edge / Math.max(1e-4, zoom);
  const v = { x0: view.x0 + m, y0: view.y0 + m, x1: view.x1 - m, y1: view.y1 - m };
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const sc = (b, f) => ({ x0: cx + (b.x0 - cx) * f, y0: cy + (b.y0 - cy) * f, x1: cx + (b.x1 - cx) * f, y1: cy + (b.y1 - cy) * f });
  let r = sc(R, k);
  // (its whole reach bigger than this seat's view: smaller, to fit)
  const kv = Math.min(1, (v.x1 - v.x0) / Math.max(1e-6, r.x1 - r.x0), (v.y1 - v.y0) / Math.max(1e-6, r.y1 - r.y0));
  if ( kv < 1 - 1e-6 ) { k *= kv; r = sc(R, k); rules.push("fit"); }
  // (cut by this seat's view edge or under its own panel: the smallest shift that shows it whole)
  const d = shiftClear(r, sc(box, k), panels, v);
  if ( Math.abs(d.dx) > 1e-6 || Math.abs(d.dy) > 1e-6 ) rules.push("shift");
  return { rule: rules.length ? rules.at(-1) : "ok", rules, k, dx: d.dx, dy: d.dy };
}
/**
 * THE SEAT RULE FOR A GROUP: the words of one page or one moment are one picture (placed off each other, beside what they letter, off
 * the shared pins): a seat that must move or shrink them moves and shrinks them TOGETHER - one scale about the event's anchor, one
 * shift - so no word lands on another or loses its place in the story. items: [{ box, reach, cap }] (world units, this seat's scale
 * applied); anchor { x, y } (the event); subject: the event's box. -> { rule, rules, k, dx, dy, ax, ay } (apply with groupAt / groupBox).
 * Live (two seats, 2026-11-15): moved word by word, the player's FHWOOOOMMFF! was shifted onto the main word.
 */
export function seatGroup({ items, anchor = null, view, panels = [], zoom = 1, read = READ_PX, edge = SEAT_EDGE, subject = null }) {
  const its = (items ?? []).filter((q) => q?.box);
  if ( !view || !its.length ) return { rule: "ok", rules: [], k: 1, dx: 0, dy: 0, ax: 0, ay: 0 };
  const U = (bs) => bs.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
  const R = U(its.map((q) => q.reach ?? q.box));
  const ax = Number.isFinite(anchor?.x) ? anchor.x : (R.x0 + R.x1) / 2, ay = Number.isFinite(anchor?.y) ? anchor.y : (R.y0 + R.y1) / 2;
  if ( inter(R, view) <= 0 && !(subject && inter(subject, view) > 0) ) return { rule: "off", rules: ["off"], k: 1, dx: 0, dy: 0, ax, ay };
  const rules = [];
  let k = 1;
  // (the group's smallest word under the readable floor at this zoom: the whole group grows to it)
  const caps = its.map((q) => q.cap).filter((c) => c > 0), cmin = caps.length ? Math.min(...caps) : 0;
  if ( cmin > 0 && cmin * zoom < read ) { k = read / (cmin * zoom); rules.push("read"); }
  const m = edge / Math.max(1e-4, zoom);
  const v = { x0: view.x0 + m, y0: view.y0 + m, x1: view.x1 - m, y1: view.y1 - m };
  const sc = (b, f) => ({ x0: ax + (b.x0 - ax) * f, y0: ay + (b.y0 - ay) * f, x1: ax + (b.x1 - ax) * f, y1: ay + (b.y1 - ay) * f });
  let r = sc(R, k);
  // (the group's whole reach bigger than this seat's view: all smaller together, to fit)
  const kv = Math.min(1, (v.x1 - v.x0) / Math.max(1e-6, r.x1 - r.x0), (v.y1 - v.y0) / Math.max(1e-6, r.y1 - r.y0));
  if ( kv < 1 - 1e-6 ) { k *= kv; r = sc(R, k); rules.push("fit"); }
  const covered = (f, d) => its.reduce((s, q) => { const b = sc(q.box, f); const m2 = { x0: b.x0 + d.dx, y0: b.y0 + d.dy, x1: b.x1 + d.dx, y1: b.y1 + d.dy }; return s + panels.reduce((t, p) => t + inter(m2, p), 0); }, 0);
  let d = shiftClear(r, its.map((q) => sc(q.box, k)), panels, v), c = covered(k, d);
  // (no shift clears this seat's panels: the group a little smaller, a few steps, never under the readable floor - live, a player's
  // main word stood on the macro bar)
  for ( let i = 0, f = k; c > 1e-6 && i < 5; i++ ) {
    f *= 0.9;
    if ( cmin > 0 && cmin * f * zoom < read ) break;
    const d2 = shiftClear(sc(R, f), its.map((q) => sc(q.box, f)), panels, v), c2 = covered(f, d2);
    if ( c2 < c - 1e-6 ) { k = f; d = d2; c = c2; if ( !rules.includes("fit") ) rules.push("fit"); }
  }
  if ( Math.abs(d.dx) > 1e-6 || Math.abs(d.dy) > 1e-6 ) rules.push("shift");
  return { rule: rules.length ? rules.at(-1) : "ok", rules, k, dx: d.dx, dy: d.dy, ax, ay };
}
/** after the group's move, a word that now stands on a pin (the move pulls the words toward the event, where its pins are) steps off it
    by the smallest shift that keeps it in the view: [{ dx, dy }] per box (boxes as this seat draws them, world units) */
export function groupNudge(boxes, pins, view, zoom = 1, edge = SEAT_EDGE, lives = null, panels = []) {
  const out = boxes.map(() => ({ dx: 0, dy: 0 }));
  if ( !view || !pins?.length ) return out;
  const m = edge / Math.max(1e-4, zoom), v = { x0: view.x0 + m, y0: view.y0 + m, x1: view.x1 - m, y1: view.y1 - m };
  const mv = (b, d) => ({ x0: b.x0 + d.dx, y0: b.y0 + d.dy, x1: b.x1 + d.dx, y1: b.y1 + d.dy });
  // (the words up at the same time are obstacles too - lives [t0, t1] per box; without them every word of the group: a word stepped off
  // a pin must not step onto another word)
  const meet = (i, j) => !lives || (lives[i][0] < lives[j][1] && lives[j][0] < lives[i][1]);
  boxes.forEach((b, i) => {
    if ( !pins.some((p) => inter(b, p) > 0) ) return;
    const others = boxes.map((q, j) => (j !== i && meet(i, j) ? mv(q, out[j]) : null)).filter(Boolean);
    // (and this seat's panels: live, the main word stepped off the pin onto the challenges' panel)
    const obs = [...pins, ...others, ...(panels ?? [])];
    const d = shiftClear(b, b, obs, v), nb = mv(b, d);
    const cost = (q) => obs.reduce((s, p) => s + inter(q, p), 0);
    if ( cost(nb) < cost(b) - 1e-6 ) out[i] = d;
  });
  return out;
}
/** a point of the group's table picture as this seat draws it (seatGroup) */
export const groupAt = (p, g) => ({ ...p, x: g.ax + (p.x - g.ax) * g.k + g.dx, y: g.ay + (p.y - g.ay) * g.k + g.dy });
/** a box of the group's table picture as this seat draws it */
export const groupBox = (b, g) => ({ x0: g.ax + (b.x0 - g.ax) * g.k + g.dx, y0: g.ay + (b.y0 - g.ay) * g.k + g.dy, x1: g.ax + (b.x1 - g.ax) * g.k + g.dx, y1: g.ay + (b.y1 - g.ay) * g.k + g.dy });

/** the smallest shift that brings reach `r` inside `v` and the box `b` (or every box of a group) off every panel (inside the view
    first; panels as far as they let it stay inside the view; nothing clean: the least covered) */
export function shiftClear(r, b, panels, v) {
  const bs = Array.isArray(b) ? b : [b];
  const into = (lo, hi, a, z) => (hi - lo > z - a ? (a + z) / 2 - (lo + hi) / 2 : lo < a ? a - lo : hi > z ? z - hi : 0);
  const d0 = { dx: into(r.x0, r.x1, v.x0, v.x1), dy: into(r.y0, r.y1, v.y0, v.y1) };
  const mv = (q, d) => ({ x0: q.x0 + d.dx, y0: q.y0 + d.dy, x1: q.x1 + d.dx, y1: q.y1 + d.dy });
  const hit = (d) => panels.reduce((s, p) => s + bs.reduce((t, q) => t + inter(mv(q, d), p), 0), 0) + (area(mv(r, d)) - inter(mv(r, d), v)) * 4;
  if ( hit(d0) <= 1e-6 ) return d0;
  let best = { ...d0, h: hit(d0), dist: Math.hypot(d0.dx, d0.dy) };
  const cands = [];
  for ( const p of panels ) for ( const b1 of bs ) {
    const q = mv(b1, d0); if ( inter(q, p) <= 0 ) continue;
    cands.push({ dx: d0.dx + p.x0 - q.x1 - 1, dy: d0.dy }, { dx: d0.dx + p.x1 - q.x0 + 1, dy: d0.dy }, { dx: d0.dx, dy: d0.dy + p.y0 - q.y1 - 1 }, { dx: d0.dx, dy: d0.dy + p.y1 - q.y0 + 1 });
  }
  for ( const c of cands ) { const h = hit(c), dist = Math.hypot(c.dx, c.dy); if ( h < best.h - 1e-6 || (Math.abs(h - best.h) <= 1e-6 && dist < best.dist) ) best = { ...c, h, dist }; }
  return { dx: best.dx, dy: best.dy };
}

/* ---------------------------------------------------------------- the screen: one reference window for every seat */

/** the shared panel zones of the reference window (CSS px in it): Foundry's bars (RESERVE) and the panels every seat may have at a
    fixed spot - the party cards bottom left, the challenges' panel top right (plus-ultra same-picture.mjs PANEL_ZONES / dockZone), the
    map's own meter top left (CROWD2 METER_ZONE). A seat's other panels move only that seat's words (seatFit). */
export const SCREEN_ZONES = Object.freeze([
  { x0: 0, y0: 0, x1: RESERVE.l, y1: REF_VH }, { x0: 0, y0: 0, x1: REF_VW, y1: RESERVE.t }, { x0: REF_VW - RESERVE.r, y0: 0, x1: REF_VW, y1: REF_VH },
  { x0: 0, y0: REF_VH - RESERVE.b, x1: REF_VW, y1: REF_VH },
  { x0: 0, y0: REF_VH - 414, x1: 340, y1: REF_VH - 108 }, { x0: REF_VW - RESERVE.r + 2 - 310, y0: 48, x1: REF_VW - RESERVE.r + 2, y1: 281 },
  { x0: 96, y0: 92, x1: 360, y1: 144 }
]);
/** the reference window's offset on a seat's window W x H (it is centred there) */
export const screenOffset = (W, H) => ({ x: (W - REF_VW) / 2, y: (H - REF_VH) / 2 });
/** a screen spot of the reference window (fx, fy: shares of the reference window) */
export const refSpot = (fx, fy) => ({ x: fx * REF_VW, y: fy * REF_VH });

const scaleAt = (b, f, cx, cy) => (f === 1 ? b : { x0: cx + (b.x0 - cx) * f, y0: cy + (b.y0 - cy) * f, x1: cx + (b.x1 - cx) * f, y1: cy + (b.y1 - cy) * f });
/** a spot of the reference window free of SCREEN_ZONES for a word `bw` x `bh` (CSS px), the upper middle first (`turn` 0..2 rotates the
    order by the word's seed: two unlocated words of one moment start at different spots) */
export function refScreenSpot(bw, bh, turn = 0) {
  const F = [[0.5, 0.2], [0.36, 0.24], [0.64, 0.24], [0.5, 0.32], [0.28, 0.4], [0.72, 0.4], [0.5, 0.7]];
  const k = clamp(Math.floor(turn), 0, F.length - 1), order = [...F.slice(k), ...F.slice(0, k)];
  let best = null;
  for ( const [fx, fy] of order ) {
    const x = fx * REF_VW, y = fy * REF_VH, b = { x0: x - bw / 2, y0: y - bh / 2, x1: x + bw / 2, y1: y + bh / 2 };
    const hit = SCREEN_ZONES.reduce((s, u) => s + inter(b, u), 0);
    if ( !best || hit < best.hit ) best = { x, y, hit };
    if ( !hit ) break;
  }
  return { x: best.x, y: best.y };
}
/**
 * THUNDERFIT + MAPSFXSEAT: an unlocated word laid out ONCE in the reference window (the same for every seat), by its real box: `hold`
 * { w, h } and `reach` { l, r, u, d } in units of its cap height (the engine's L.measure; null: the old factor of its entrance
 * `stageIn`), `cap` its cap height (CSS px). As big as it is but never bigger than the window (sfx-fit viewFit), at its spot - the edge
 * toward the strike (`fixed` { fx, fy }) or a free spot of the upper middle - when it is clean there (whole reach inside the window, box
 * off SCREEN_ZONES), else the nearest clean spot, else a little smaller where it fits (sfx-fit screenFit).
 * -> { x, y, k (share of its size), cap, hit, box, reach } in reference-window CSS px | null.
 */
export function screenLayout({ hold, reach = null, cap, fixed = null, turn = 0, stageIn = null }) {
  const b = FIT.wordBox(hold, cap);
  if ( !(b.bw > 0) ) return null;
  const W = REF_VW, H = REF_VH;
  const rk = reach ? FIT.reachFactor(hold, reach) : FIT.reachOf(stageIn), kv = FIT.viewFit(b.bw * rk, b.bh * rk, W, H);
  const fw = b.bw * kv * 0.5 + 16, fh = b.bh * kv * 0.75 + 16;
  const today = fixed ? { x: Math.min(Math.max(fixed.fx * W, fw), Math.max(fw, W - fw)), y: Math.min(Math.max(fixed.fy * H, fh), Math.max(fh, H - fh)) } : refScreenSpot(b.bw * kv, b.bh * kv, turn);
  const want = fixed ? refSpot(fixed.fx, fixed.fy) : today;
  const r = FIT.screenFit({ today: kv >= 1 ? today : null, want, bw: b.bw * kv, bh: b.bh * kv, rk, view: { x0: 0, y0: 0, x1: W, y1: H }, ui: SCREEN_ZONES });
  const k = kv * r.k, c = cap * k, w2 = b.bw * k / 2, h2 = b.bh * k / 2;
  const box = { x0: r.x - w2, y0: r.y - h2, x1: r.x + w2, y1: r.y + h2 };
  const rb = reach ? { x0: Math.min(box.x0, r.x - reach.l * c), y0: Math.min(box.y0, r.y - reach.u * c), x1: Math.max(box.x1, r.x + reach.r * c), y1: Math.max(box.y1, r.y + reach.d * c) } : scaleAt(box, rk, r.x, r.y);
  return { x: r.x, y: r.y, k, cap: c, hit: r.hit, box, reach: rb };
}
/** A seat's drawing of a laid-out unlocated word (`ref`: screenLayout): the reference window centred in its window W x H, its own size
    setting `scale`, then the seat rule (seatFit: off its `panels`, whole in its window, smaller only when its reach is bigger than the
    window). -> { at (CSS px of this window), k (size factor on the table's size), fit } */
export function seatScreen(ref, { W, H, panels = [], scale = 1 }) {
  const off = screenOffset(W, H), cx = ref.x + off.x, cy = ref.y + off.y;
  const mv = (b) => scaleAt({ x0: b.x0 + off.x, y0: b.y0 + off.y, x1: b.x1 + off.x, y1: b.y1 + off.y }, scale, cx, cy);
  const f = seatFit({ box: mv(ref.box), reach: mv(ref.reach), view: { x0: 0, y0: 0, x1: W, y1: H }, panels, zoom: 1, cap: ref.cap * scale });
  return { at: { x: cx + f.dx, y: cy + f.dy }, k: f.k, fit: f };
}

/* ---------------------------------------------------------------- the ground under a firing, shared */

/**
 * The ground material at a firing's impact from the map's own pixels (RGBA of a box round it; every seat reads the same map): the same
 * rule as the destruction layer's bake (scripts/destruction/core.mjs classify), so a page's debris words are written for the ground the
 * crater will show - and written at once, on every seat alike (before, the ground was taken from the first damage area to ENTER on this
 * seat: a seat still applying the destruction wrote "earth" debris, another "stone": other words). -> a MATS name of sfx-core.
 */
export function groundOfPixels(px, W) {
  const n0 = Math.floor((px?.length ?? 0) / 4);
  if ( !n0 || !(W > 0) ) return "auto";
  let n = 0, sr = 0, sg = 0, sb = 0, hx = 0, hy = 0, ssat = 0, sl = 0, sl2 = 0, gx = 0, gy = 0;
  const lum = (o) => 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
  const step = Math.max(1, Math.floor(n0 / 4000));
  for ( let i = 0; i < n0; i += step ) {
    const o = i * 4, [h, s, l] = hsl(px[o], px[o + 1], px[o + 2]);
    sr += px[o]; sg += px[o + 1]; sb += px[o + 2]; ssat += s; sl += l; sl2 += l * l;
    hx += Math.cos((h * Math.PI) / 180) * s; hy += Math.sin((h * Math.PI) / 180) * s;
    if ( (i % W) + 1 < W ) gx += Math.abs(lum(o + 4) - lum(o));
    if ( i + W < n0 ) gy += Math.abs(lum(o + W * 4) - lum(o));
    n++;
  }
  const hue = (((Math.atan2(hy, hx) * 180) / Math.PI) + 360) % 360, sat = ssat / n, l = sl / n;
  const tex = Math.sqrt(Math.max(0, sl2 / n - l * l)), aniso = Math.abs(gx - gy) / Math.max(1, gx + gy);
  if ( hue >= 175 && hue <= 255 && sat > 0.2 && l > 0.12 && l < 0.75 ) return "water";
  if ( l > 0.74 && sat < 0.16 ) return "snow";
  if ( sat < 0.13 ) return tex < 0.045 && l < 0.6 ? "metal" : "stone";
  if ( hue >= 65 && hue < 175 && sat > 0.15 ) return "grass";
  if ( hue >= 32 && hue < 65 && sat > 0.2 && l > 0.52 ) return "sand";
  if ( hue >= 8 && hue < 50 && sat > 0.22 && aniso > 0.16 ) return "wood";
  if ( sat < 0.2 ) return "stone";
  return "earth";
}
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if ( mx === mn ) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/* ---------------------------------------------------------------- what every seat counts as an obstacle */

/** a token every seat counts (its document not hidden; the GM's hidden tokens are no obstacle on any seat, so nothing of them shows in
    anyone's picture): its box from the document (scene px), whatever this seat's vision shows */
export function sharedTokenBox(doc, grid = 100) {
  if ( !doc || doc.hidden ) return null;
  const w = (Number(doc.width) || 1) * grid, h = (Number(doc.height) || 1) * grid, x = Number(doc.x) || 0, y = Number(doc.y) || 0;
  return { x0: x, y0: y, x1: x + w, y1: y + h };
}
/** is a note pin one every player may see (then it is an obstacle on every seat; a pin of a page some player may not open is none on
    any seat, so nothing of it shows in a player's placement)? `perm(user)` -> that user may see the note's page or entry */
export const sharedPin = (players, perm) => players.every((u) => { try { return perm(u) !== false; } catch { return false; } });

/** a stable sort key of a play call for the per-seat logs and the checks: what must be equal on every seat */
export function callKey(c) {
  const r = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v);
  return JSON.stringify([c.text, c.seed ?? null, r(c.size), c.at ? [r(c.at.x), r(c.at.y)] : null, r(c.t), c.space ?? null]);
}
