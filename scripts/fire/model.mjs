/**
 * FIRE AND SMOKE, the pure part (no Foundry, no PIXI: node-tested in dev/fire-model.test.mjs). A layer of its own drawn OVER the
 * destruction layer. What is stored, in two scene flags (written by the GM, read by every client, nothing is ever uploaded or baked):
 *
 *   flags.moinen-maps.fire          the layer's settings (PARAM_DEFAULTS): { v, on, who, smoke, flame, plume, speed, grow, spread, out,
 *                                   fireColor, smokeTint, light, lightRadius, lightIntensity, lightFollow, lightColor, lightFlicker }
 *   flags.moinen-maps.fireStrokes   { [id]: stroke }: every brush stroke an object of its own (an add or a delete touches one key, so
 *                                   two edits never overwrite each other)
 *     stroke = { id, k: "fire" | "smoke" | "erase", s: strength 0.1..1, r: radius (scene px), p: [x0, y0, x1, y1, ...] (scene px,
 *                whole numbers), wd: wind direction (degrees, screen: 0 = right, 90 = down), ws: wind 0..1, q: paint time (ms on the
 *                shared clock: the stroke catches fire from then), sd: seed,
 *                lv: FIRE LEVEL 1..3 (fire only: smouldering, a steady fire, a blaze), sm: SMOKE LEVEL, independent of the fire level
 *                (fire: 0..3, 0 = no smoke; smoke: 1..3: wisps, a plume, a thick dark column), st: "fireball" (the old rolling look)
 *                or absent (fire burning in place), c: the fire's COLOUR "#rrggbb" (absent: the scene's fireColor - the natural
                orange unless the GM changes it; look.mjs derives the whole palette from it), o: the time it was PUT OUT (absent while it burns), g: the time it was lit
 *                again (an undo / redo brings a stroke back: it grows again from g, but keeps its place q in the paint order) }
 *   LEVELS and STRENGTH: the level is the look (a real gradation: tongue height and density, the bed, sparks, the light; the smoke's
 *   density, colour and billow size); the strength stays a fine-tuning within the level. Old strokes without levels read as fire 2 /
 *   smoke 2, exactly the look they had.
 *
 * TIME (the same on every client: everything follows from q, o and the shared clock; no per-frame writes):
 *   a stroke CATCHES where it began and spreads along its path in drawing order (P.spread grid squares a second); each cell grows to
 *   full height in P.grow s; its smoke builds up after the flames (a third of the grow time later, then travelling up the plume).
 *   PUT OUT (o set: erase, delete, clear, undo): the flames sink back into the base over P.out s, the bed's embers glow a moment and
 *   darken, the smoke lingers, thins and drifts away; then the stroke is gone (the GM removes the record: one write). An eraser puts
 *   out what lies under it the same way; an eraser that is undone lets the fire grow back. `phaseOf` classifies a stroke at a moment;
 *   a client that loads later sees the right phase, after the end the end state (no replay). Reduced motion: no phases.
 *
 * From the strokes every client computes the same thing:
 *  1. AREAS: strokes of one style whose CORES (path and flame tongues) overlap form one area - the smoke plume does NOT join areas,
 *     so two fires stay two fires (and two lights). Its rectangle reaches over the plume too (areas may overlap where their smoke
 *     does). An eraser belongs to every area it touches. An area's KEY is a hash of its strokes, their phases and the settings.
 *  2. THE FIELD of an area (`raster`): one RGBA8 texel per art cell -
 *       R = flame heat (the burning ground and the tongues above it: heat decays upwards, tongues as tall as the fire and its level),
 *       G = smoke density (smoke strokes plus what the fire gives off, carried along the plume - up the screen, bent by the wind),
 *       B = the burning ground itself (the BASE: it never moves), A = 0 nothing, else 1 + (fire level - 1) * 4 + smoke level.
 *     While something in the area animates, a second texture holds per cell the ignite / out times of the flames (R, G) and of the
 *     smoke (B, A), bytes relative to the field's `anim` refs; the shader turns them into growing and going out with a few uniforms.
 *     At rest there is no second texture.
 *  3. LIGHTS (`lightsOf`): the burning ground binned and merged into a few clusters - one light per fire, never per cell or particle;
 *     fires more than a grid square apart keep their own lights.
 *  4. PARTICLES (`particleAt`): a pure function of (area, slot, time on the shared clock): no state, no spawning.
 *
 * THE FIELD IS THE CONTRACT: the renderer takes any RGBA field + the area's rectangle, wind and seed. A destruction stroke that should
 * burn later only has to produce a field of its own - see `fieldFromMask` - and hand it to the same display (fire.mjs `setExtra`).
 */

export const FLAG = "fire";
export const STROKES = "fireStrokes";
export const VERSION = 2;
export const KINDS = ["fire", "smoke", "erase"];
export const STYLES = ["fire", "fireball"];
export const LEVELS = [1, 2, 3];

export const PARAM_DEFAULTS = Object.freeze({
  on: true,              // the layer shows
  who: "all",            // "all" | "gm": who sees it
  smoke: 0.5,            // how much smoke a fire gives off (x its smoke level; 0: none)
  flame: 1,              // flame height (x 0.8 grid squares at full strength, level 2)
  plume: 2.5,            // smoke plume length (grid squares at full strength)
  speed: 1,              // animation speed
  grow: 1.6,             // seconds a cell takes to grow to full height
  spread: 3,             // grid squares a second the fire runs along a new stroke
  out: 2.2,              // seconds the flames take to go out (embers and smoke linger after)
  fireColor: NATURAL,    // the colour of strokes without one of their own (look.mjs derives the palette from it)
  smokeTint: 0,          // 0 = neutral smoke; up to 1 = the smoke takes on its fire's hue
  light: true,           // fire lights the scene (Foundry's own lighting)
  lightRadius: 1.5,      // the light's reach, a multiple of the burning area's size
  lightIntensity: 0.6,   // 0..1
  lightFollow: true,     // the light takes its fire's colour (look.mjs rampOf().light); false: lightColor for every fire
  lightColor: "#ff8a3c",
  lightFlicker: 0.5      // 0 = steady
});
export const LIMITS = { s: [0.1, 1], r: [4, 4000], ws: [0, 1], smoke: [0, 1], flame: [0.3, 2.5], plume: [0, 8], speed: [0.2, 3],
  grow: [0, 10], spread: [0.5, 40], out: [0, 10], smokeTint: [0, 1], lightRadius: [0.5, 4], lightIntensity: [0, 1], lightFlicker: [0, 1] };
export const MAX_POINTS = 2000;
/** Largest field side (cells); the art grid of a scene is at most ~2000 x 2000 (destruction MAX_ART), so this never cuts a real area. */
export const MAX_SIDE = 4096;

/** Per FIRE LEVEL (index 1..3): heat of the bed, flame height, spark share, light radius, light intensity. Level 2 = the old look. */
export const FIRE_LV = {
  heat: [0, 0.74, 1, 1], height: [0, 0.55, 1, 1.6], sparks: [0, 0.35, 1, 2], lightR: [0, 0.7, 1, 1.4], lightI: [0, 0.6, 1, 1.3]
};
/** Per SMOKE LEVEL (index 0..3): how much smoke (x the layer's `smoke`), 0 = none. Level 2 = the old amount. */
export const SMOKE_LV = [0, 0.55, 1, 1.45];

import { NATURAL, cleanColor, rampOf, puffsOf } from "./look.mjs";
export { NATURAL, rampOf };

const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const int = (v, d, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const COLOR = /^#[0-9a-f]{6}$/i;

/** The layer's settings, cleaned (unknown keys dropped, numbers clamped). */
export function cleanParams(p = {}) {
  const D = PARAM_DEFAULTS, L = LIMITS, o = p && typeof p === "object" ? p : {};
  return {
    on: o.on !== false, who: o.who === "gm" ? "gm" : "all",
    smoke: num(o.smoke, D.smoke, ...L.smoke), flame: num(o.flame, D.flame, ...L.flame), plume: num(o.plume, D.plume, ...L.plume),
    speed: num(o.speed, D.speed, ...L.speed),
    grow: num(o.grow, D.grow, ...L.grow), spread: num(o.spread, D.spread, ...L.spread), out: num(o.out, D.out, ...L.out),
    fireColor: cleanColor(o.fireColor) ?? D.fireColor, smokeTint: num(o.smokeTint, D.smokeTint, ...L.smokeTint), lightFollow: o.lightFollow !== false,
    light: o.light !== false,
    lightRadius: num(o.lightRadius, D.lightRadius, ...L.lightRadius), lightIntensity: num(o.lightIntensity, D.lightIntensity, ...L.lightIntensity),
    lightColor: COLOR.test(String(o.lightColor)) ? String(o.lightColor).toLowerCase() : D.lightColor,
    lightFlicker: num(o.lightFlicker, D.lightFlicker, ...L.lightFlicker)
  };
}

/** One stroke, cleaned; null when it is not a stroke (no id, no points, unknown kind). */
export function cleanStroke(o) {
  if ( !o || typeof o !== "object" || typeof o.id !== "string" || !/^[\w-]{1,32}$/.test(o.id) ) return null;
  const k = KINDS.includes(o.k) ? o.k : null; if ( !k ) return null;
  const raw = Array.isArray(o.p) ? o.p : [];
  const p = [];
  for ( let i = 0; i + 1 < raw.length && p.length < MAX_POINTS * 2; i += 2 ) {
    const x = Number(raw[i]), y = Number(raw[i + 1]);
    if ( Number.isFinite(x) && Number.isFinite(y) ) p.push(Math.round(x), Math.round(y));
  }
  if ( !p.length ) return null;
  const out = { id: o.id, k, s: Math.round(num(o.s, 0.8, ...LIMITS.s) * 100) / 100, r: Math.round(num(o.r, 50, ...LIMITS.r)), p,
    wd: Math.round(((Number(o.wd) || 0) % 360 + 360) % 360), ws: Math.round(num(o.ws, 0, ...LIMITS.ws) * 100) / 100,
    q: Number.isFinite(Number(o.q)) ? Math.round(Number(o.q)) : 0, sd: (Number(o.sd) >>> 0) || hashStr(o.id) };
  if ( k === "fire" ) { out.lv = int(o.lv, 2, 1, 3); out.sm = int(o.sm, 2, 0, 3); }
  else if ( k === "smoke" ) out.sm = int(o.sm, 2, 1, 3);
  if ( k !== "erase" && o.st === "fireball" ) out.st = "fireball";
  if ( k !== "erase" ) { const c = cleanColor(o.c); if ( c ) out.c = c; }
  if ( o.o !== undefined && o.o !== null && Number.isFinite(Number(o.o)) ) out.o = Math.round(Number(o.o));
  if ( o.g !== undefined && o.g !== null && Number.isFinite(Number(o.g)) ) out.g = Math.round(Number(o.g));
  return out;
}

/** The strokes of a flag value ({ id: stroke }), cleaned and in their order (q, then id). */
export function strokesOf(flag) {
  const out = [];
  for ( const v of Object.values(flag && typeof flag === "object" ? flag : {}) ) { const s = cleanStroke(v); if ( s ) out.push(s); }
  return out.sort(byOrder);
}
export const byOrder = (a, b) => (a.q - b.q) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A path thinned to a point every `step` scene px (the first and the last kept), as the flat list a stroke stores. */
export function thinPath(points, step) {
  const out = [];
  let lx = NaN, ly = NaN;
  for ( let i = 0; i < points.length; i++ ) {
    const [x, y] = points[i];
    if ( i === 0 || i === points.length - 1 || Math.hypot(x - lx, y - ly) >= step ) { out.push(Math.round(x), Math.round(y)); lx = x; ly = y; }
  }
  return out;
}

/* ---------------------------------------------------------------- hashing (deterministic, the same on every client) */

export function hashStr(s, h = 2166136261) { for ( let i = 0; i < s.length; i++ ) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
/** Integer hash of up to four integers -> [0, 1). */
export function hash4(a, b = 0, c = 0, d = 0) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (b | 0) ^ (h >>> 15), 0xc2b2ae35);
  h = Math.imul(h ^ (c | 0) ^ (h >>> 13), 0x27d4eb2f);
  h = Math.imul(h ^ (d | 0) ^ (h >>> 16), 0x165667b1);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* ---------------------------------------------------------------- geometry */

/** Wind as a unit vector times its strength (screen: +y down). */
export function windVec(wd, ws) { const a = (wd || 0) * Math.PI / 180; return [Math.cos(a) * (ws || 0), Math.sin(a) * (ws || 0)]; }
/** The direction smoke travels: up the screen, bent by the wind (strong wind can lay it flat or even push it down). Unit vector. */
export function plumeDir(wx, wy) {
  const x = wx * 1.6, y = -1 + wy * 1.6, l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

/** Grid-relative sizes (cells) for a geometry `geo` = { ap, ox, oy, grid } and the settings. */
export function sizes(geo, P) {
  const g = geo.grid / geo.ap;
  return { flameH: Math.max(3, g * 0.8 * P.flame), plumeL: Math.max(2, g * P.plume), cellsPerGrid: g };
}

/** A stroke's path in cells: [[x, y], ...] and its radius in cells. */
function cellPath(st, geo) {
  const pts = [];
  for ( let i = 0; i + 1 < st.p.length; i += 2 ) pts.push([(st.p[i] - geo.ox) / geo.ap, (st.p[i + 1] - geo.oy) / geo.ap]);
  return { pts, R: Math.max(0.75, st.r / geo.ap) };
}

/** A stroke's smoke level (0 = it makes no smoke). */
export const smokeOf = (st, P) => (st.k === "smoke" ? st.sm ?? 2 : st.k === "fire" && P.smoke > 0 ? st.sm ?? 2 : 0);
// (the fire style's licking tongues reach up to 1.25 x their mean length: its rectangle is a little taller)
const flameOf = (st, Z) => Z.flameH * FIRE_LV.height[st.lv ?? 2] * st.s * (st.st === "fireball" ? 1 : 1.3);

function pathBox(st, geo) {
  const { pts, R } = cellPath(st, geo);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const [x, y] of pts ) { x0 = Math.min(x0, x - R); y0 = Math.min(y0, y - R); x1 = Math.max(x1, x + R); y1 = Math.max(y1, y + R); }
  return { x0, y0, x1, y1 };
}
/** A rectangle in whole cells, grown by `m` cells (2; the fire style adds room for a soft edge: a quarter of a square). */
const cells = (r, m = 2) => ({ x0: Math.floor(r.x0) - m, y0: Math.floor(r.y0) - m, x1: Math.ceil(r.x1) + m, y1: Math.ceil(r.y1) + m });
const marginOf = (st, geo) => (st.st === "fireball" ? 2 : 2 + Math.ceil(geo.grid / geo.ap * 0.25));
/** How far a stroke's smoke travels (cells along the plume); the plume fades to nothing by then (fieldFrom). */
export const plumeReach = (s, Z) => Z.plumeL * (0.4 + 0.6 * s) * 2.4;

/** A stroke's CORE (cells, integers, x1/y1 exclusive): its path and its flame tongues - what joins areas. */
export function coreOf(st, geo, P) {
  const b = pathBox(st, geo);
  if ( st.k === "fire" ) b.y0 -= flameOf(st, sizes(geo, P)) + 2;
  return cells(b, marginOf(st, geo));
}

/** What a stroke can reach (cells, integers, x1/y1 exclusive): its path, its flame tongues and its smoke plume. */
export function reachOf(st, geo, P) {
  const Z = sizes(geo, P), b = pathBox(st, geo), r = { ...b };
  if ( st.k === "fire" ) r.y0 -= flameOf(st, Z) + 2;
  if ( smokeOf(st, P) > 0 && P.plume > 0 ) {
    const [wx, wy] = windVec(st.wd, st.ws), [ux, uy] = plumeDir(wx, wy);
    const E = plumeReach(st.s, Z) + (st.k === "fire" ? flameOf(st, Z) : 0), ex = ux * E, ey = uy * E;
    r.x0 = Math.min(r.x0, b.x0 + ex); r.x1 = Math.max(r.x1, b.x1 + ex); r.y0 = Math.min(r.y0, b.y0 + ey); r.y1 = Math.max(r.y1, b.y1 + ey);
    const spread = E * 0.15; r.x0 -= spread; r.x1 += spread;
  }
  return cells(r, marginOf(st, geo));
}

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/* ---------------------------------------------------------------- time: catching, growing, going out */

/** The timing (ms) of the settings: grow, the smoke's lag, out, the smoke's travel up the plume (per cell and at most), the spans. */
export function timing(geo, P) {
  const g = geo.grid / geo.ap, Z = sizes(geo, P), perCell = 1000 / (2 * g);   // (the smoke fills its plume at 2 squares a second)
  const G = P.grow * 1000, O = P.out * 1000, travel = (Z.plumeL * 2.4 + Z.flameH * 1.6) * perCell;
  return { G, O, lag: 0.35 * G, perCell, travel, growSpan: 1.35 * G + travel, outSpan: 1.6 * O + travel };
}

/** How long a stroke takes to catch along its whole path (ms): its length (plus half its radius) at P.spread squares a second. */
export function catchMs(st, geo, P) {
  if ( st.k === "erase" ) return 0;
  const { pts, R } = cellPath(st, geo);
  let len = 0; for ( let i = 1; i < pts.length; i++ ) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return Math.min(8000, 1000 * (len + R * 0.5) / (P.spread * geo.grid / geo.ap));
}

/** When a stroke's current animation ends (ms). */
/** When a stroke was lit (or its eraser applied): its paint time, or the time an undo / redo brought it back. */
export const litTime = (st) => st.g ?? st.q;
function endOf(st, geo, P, T) {
  if ( st.k === "erase" ) return st.o !== undefined ? st.o + T.growSpan : litTime(st) + T.outSpan;
  return st.o !== undefined ? st.o + T.outSpan : litTime(st) + catchMs(st, geo, P) + T.growSpan;
}

/**
 * A stroke's PHASE at shared time `now` (ms): fire / smoke "grow" | "on" | "out" | "gone"; eraser "out" (putting out what is under
 * it) | "on" (done: a plain cut) | "regrow" (undone: the fire grows back) | "gone". `now` undefined or `still` (reduced motion): no
 * animation (on, or gone once put out).
 */
export function phaseOf(st, now, geo, P, still = false) {
  const put = st.o !== undefined;
  if ( still || now === undefined ) return put ? "gone" : "on";
  const live = now < endOf(st, geo, P, timing(geo, P));
  if ( st.k === "erase" ) return put ? (live ? "regrow" : "gone") : (live ? "out" : "on");
  return put ? (live ? "out" : "gone") : (live ? "grow" : "on");
}

/** The next moment (ms, > now) one of the strokes changes phase; Infinity when none will. */
export function nextChange(strokes, now, geo, P, still = false) {
  if ( still || now === undefined ) return Infinity;
  const T = timing(geo, P);
  let t = Infinity;
  for ( const st of strokes ) { const e = endOf(st, geo, P, T); if ( e > now && e < t ) t = e; }
  return t;
}

/** The strokes whose put-out animation is over at `now` (the GM removes their records). */
export const goneAt = (strokes, now, geo, P) => strokes.filter((s) => s.o !== undefined && phaseOf(s, now, geo, P) === "gone");

/** A stroke's fire colour: its own, else the scene's (P.fireColor), else the natural orange. */
export const colorOf = (st, P) => st.c ?? P?.fireColor ?? NATURAL;

/**
 * The AREAS of a set of strokes at time `now`: [{ id, key, rect (cells), strokes (in order, erasers included), phases { id: phase },
 * wind: [wx, wy], seed, style }]. Strokes "gone" are left out. Strokes of one style whose CORES overlap share an area (the plume does
 * not join areas); an eraser joins every area it touches (and makes none of its own). Deterministic.
 */
export function areasOf(strokes, geo, P, now = undefined, still = false) {
  const phases = {};
  for ( const s of strokes ) phases[s.id] = phaseOf(s, now, geo, P, still);
  const live = strokes.filter((s) => phases[s.id] !== "gone");
  const list = live.filter((s) => s.k !== "erase"), erasers = live.filter((s) => s.k === "erase");
  const style = (s) => (s.st === "fireball" ? "fireball" : "fire"), color = (s) => colorOf(s, P);
  const reach = list.map((s) => reachOf(s, geo, P)), rects = list.map((s) => coreOf(s, geo, P));
  const parent = list.map((_, i) => i);
  const find = (i) => { while ( parent[i] !== i ) i = parent[i] = parent[parent[i]]; return i; };
  // (merge until no two groups' core rectangles overlap: a merged rectangle can reach a third stroke)
  let changed = true;
  while ( changed ) {
    changed = false;
    for ( let i = 0; i < list.length; i++ ) for ( let j = i + 1; j < list.length; j++ ) {
      const a = find(i), b = find(j); if ( a === b || style(list[a]) !== style(list[b]) || color(list[a]) !== color(list[b]) ) continue;
      if ( overlaps(rects[a], rects[b]) ) {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        parent[hi] = lo; rects[lo] = union(rects[a], rects[b]);
        changed = true;
      }
    }
  }
  const groups = new Map();
  for ( let i = 0; i < list.length; i++ ) { const g = find(i); if ( !groups.has(g) ) groups.set(g, []); groups.get(g).push(i); }
  const pkey = JSON.stringify([P.smoke, P.flame, P.plume, P.grow, P.spread, P.out, P.smokeTint, geo.ap, geo.ox, geo.oy, geo.grid]);
  const out = [];
  for ( const [, idx] of groups ) {
    const members = idx.map((i) => list[i]);
    let rect = reach[idx[0]]; for ( const i of idx ) rect = union(rect, reach[i]);
    rect = { ...rect, x1: Math.min(rect.x1, rect.x0 + MAX_SIDE), y1: Math.min(rect.y1, rect.y0 + MAX_SIDE) };
    const er = erasers.filter((e) => overlaps(reachOf(e, geo, P), rect));
    const all = [...members, ...er].sort(byOrder);
    // the area's wind: the strength-weighted mean of its strokes' (an area is one plume direction)
    let wx = 0, wy = 0, wsum = 0;
    for ( const s of members ) { const [x, y] = windVec(s.wd, s.ws); wx += x * s.s; wy += y * s.s; wsum += s.s; }
    wx /= wsum || 1; wy /= wsum || 1;
    const id = members.map((s) => s.id).sort()[0], ph = {};
    for ( const s of all ) ph[s.id] = phases[s.id];
    const key = `${id}:${hashStr(pkey + JSON.stringify(all.map((s) => [s.id, s.k, s.s, s.r, s.wd, s.ws, s.q, s.g ?? null, s.o ?? null, s.lv ?? 0, s.sm ?? 0, s.st ?? "", color(s), ph[s.id], s.p.length, hashStr(s.p.join(","))])))}`;
    out.push({ id, key, rect, strokes: all, phases: ph, wind: [wx, wy], seed: hashStr(id), style: style(members[0]), color: color(members[0]) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/* ---------------------------------------------------------------- the field */

/** The per-cell buffers of `raster` (N cells). */
function buffers(N) {
  return { F: new Float32Array(N), S: new Float32Array(N), FA: new Float32Array(N), I: new Float64Array(N).fill(NaN), O: new Float64Array(N).fill(Infinity),
    SI: new Float64Array(N).fill(NaN), SO: new Float64Array(N).fill(Infinity),
    LF: new Uint8Array(N).fill(2), SMF: new Uint8Array(N).fill(2), LS: new Uint8Array(N).fill(2), FH: new Float32Array(N) };
}

/** Stamp a stroke into the buffers (W x H, area origin x0, y0 in cells), in paint order. */
function stamp(buf, W, H, x0, y0, st, geo, P, phase, Z, T, ball = true) {
  const { pts, R } = cellPath(st, geo), soft = Math.max(1, R * 0.35);
  const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((b, i) => [pts[i], b]);
  const cm = catchMs(st, geo, P);
  let total = 0; const lens = segs.map(([a, b]) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); total += l; return l; });
  const lv = st.lv ?? 2, heat = FIRE_LV.heat[lv], fh = Z.flameH * FIRE_LV.height[lv];
  // ignite times are encoded only while they matter: a stroke still growing, or one put out before it had finished growing
  const lt = litTime(st), timed = phase === "grow" || (phase === "out" && st.o < lt + cm + T.growSpan);
  const fire = st.k === "fire";
  let acc = 0;
  for ( let s = 0; s < segs.length; s++ ) {
    const [a, b] = segs[s];
    const ax = a[0] - x0, ay = a[1] - y0, bx = b[0] - x0, by = b[1] - y0, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const cx0 = Math.max(0, Math.floor(Math.min(ax, bx) - R)), cx1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + R));
    const cy0 = Math.max(0, Math.floor(Math.min(ay, by) - R)), cy1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + R));
    for ( let y = cy0; y <= cy1; y++ ) for ( let x = cx0; x <= cx1; x++ ) {
      const px = x + 0.5 - ax, py = y + 0.5 - ay;
      const t = L2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / L2)) : 0;
      const d = Math.hypot(px - dx * t, py - dy * t);
      if ( d > R ) continue;
      const i = y * W + x;
      if ( st.k === "erase" ) {
        if ( phase === "on" ) { buf.F[i] = 0; buf.S[i] = 0; buf.FA[i] = 0; buf.I[i] = buf.SI[i] = NaN; buf.O[i] = buf.SO[i] = Infinity; }
        else if ( phase === "out" ) {
          if ( buf.F[i] > 0 ) { buf.O[i] = Math.min(buf.O[i], lt); buf.FA[i] = 0; }
          if ( buf.S[i] > 0 ) buf.SO[i] = Math.min(buf.SO[i], lt);
        } else if ( phase === "regrow" ) {
          if ( buf.F[i] > 0 ) buf.I[i] = Number.isNaN(buf.I[i]) ? st.o : Math.max(buf.I[i], st.o);
          if ( buf.S[i] > 0 ) buf.SI[i] = Number.isNaN(buf.SI[i]) ? st.o : Math.max(buf.SI[i], st.o);
        }
        continue;
      }
      // where along the stroke this cell lies (0 at its start, 1 at its end, plus its distance from the path): when it catches
      const along = total ? (acc + lens[s] * t + d) / (total + R) : d / R * 0.5;
      const ign = timed ? lt + along * cm : NaN, outT = phase === "out" ? st.o : Infinity;
      // (the fire style's smoke strokes fade out over their whole radius: a soft source, no cut-out silhouette)
      const e = Math.min(1, (R - d) / soft), u = d / R, v = !fire && !ball ? st.s * (1 - u * u) * (1 - u * u) : st.s * (0.35 + 0.65 * e) * (fire ? heat : 1);
      if ( fire ) {
        const dying = buf.O[i] < Infinity;           // (what is going out under a new stroke is replaced by it)
        if ( v > buf.F[i] || (dying && phase !== "out") ) {
          const lit = buf.F[i] > 0.02 && !dying;
          buf.F[i] = v; buf.LF[i] = lv; buf.SMF[i] = st.sm ?? 2; buf.FH[i] = fh;
          if ( !lit ) buf.I[i] = ign;
          buf.O[i] = outT;
        }
        if ( phase !== "out" && v > buf.FA[i] ) buf.FA[i] = v;
      } else {
        const dying = buf.SO[i] < Infinity;
        if ( v > buf.S[i] || (dying && phase !== "out") ) {
          const lit = buf.S[i] > 0.02 && !dying;
          buf.S[i] = v; buf.LS[i] = st.sm ?? 2;
          if ( !lit ) buf.SI[i] = ign;
          buf.SO[i] = outT;
        }
      }
    }
    acc += lens[s];
  }
}

/**
 * An area's FIELD: { w, h, data: RGBA bytes, times: RGBA bytes or null, anim: { iRef, iSpan, oRef, oSpan } or null, emit: { fire,
 * smoke: [[x, y, igniteMs|null, outMs|null], ...] } (cells, area-local), mass, plume, burn, lv, style, tOut } - see the file header
 * for the channels. Pure and deterministic (the same bytes on every client).
 */
export function raster(area, geo, P) {
  const { rect } = area, W = Math.max(1, rect.x1 - rect.x0), H = Math.max(1, rect.y1 - rect.y0), N = W * H;
  const Z = sizes(geo, P), T = timing(geo, P), buf = buffers(N);
  for ( const st of area.strokes ) stamp(buf, W, H, rect.x0, rect.y0, st, geo, P, area.phases?.[st.id] ?? "on", Z, T, area.style === "fireball");
  // a cell going out under a stroke that still burns there (one deleted over an older fire) keeps the burning one's heat, no anim
  for ( let i = 0; i < N; i++ ) if ( buf.O[i] < Infinity && buf.FA[i] > 0 && buf.FA[i] >= 0.25 * buf.F[i] ) { buf.F[i] = buf.FA[i]; buf.O[i] = Infinity; }
  const sMax = Math.max(0.1, ...area.strokes.filter((s) => s.k !== "erase").map((s) => s.s));
  const f = fieldFrom(buf.F, buf.S, W, H, area.wind, geo, P, area.seed, { style: area.style, buf, reach: plumeReach(sMax, Z) });
  return withColor(f, area.color, P);
}

/** A field with its fire colour: { color, embers, puffs } (look.rampOf; the natural fire's are the old constants). */
export function withColor(f, color, P) {
  const R = rampOf(color ?? NATURAL);
  f.color = R.base; f.embers = R.embers; f.puffs = puffsOf(R, P?.smokeTint ?? 0);
  return f;
}

/**
 * The field of burning ground `F` and smoke sources `S0` (W x H, 0..1 each): tongues, the smoke the fire gives off, the plume. The
 * entry point for any other source of fire (a destruction stroke's mask: `fieldFromMask`). `opt.buf` (from `raster`) carries the
 * per-cell levels and times; without it everything is level 2 and at rest.
 */
export function fieldFrom(F, S0, W, H, wind, geo, P, seed = 1, { style = "fire", buf = null, reach = null } = {}) {
  const N = W * H, Z = sizes(geo, P), T = timing(geo, P), Ht = new Float32Array(N), Sm = new Float32Array(N);
  const ball = style === "fireball";
  // carried with the heat: the source cell of each tongue cell (its times, levels)
  const src = new Int32Array(N).fill(-1);
  // flame tongues: from the bottom up, the heat carried upwards loses 1 / (its source's flame height) per row; the fire's own style
  // leans the tongues with the wind (the fireball stays upright, exactly as it always was)
  const lean = ball ? 0 : Math.max(-0.8, Math.min(0.8, wind[0] * 0.7)), dec0 = 1 / Z.flameH;
  const decOf = (i) => (buf && buf.FH[i] ? 1 / Math.max(3, buf.FH[i]) : dec0);
  const cv = new Float64Array(W), cd = new Float64Array(W).fill(dec0), ci = new Int32Array(W).fill(-1);
  const nv = new Float64Array(W), nd = new Float64Array(W), ni = new Int32Array(W);
  for ( let y = H - 1; y >= 0; y-- ) {
    for ( let x = 0; x < W; x++ ) {
      const i = y * W + x;
      let v, dd = dec0, s = -1;
      if ( lean === 0 ) { v = cv[x] - cd[x]; dd = cd[x]; s = ci[x]; }
      else {
        const sx = x - lean, x0 = Math.floor(sx), f = sx - x0;
        const a = x0 >= 0 && x0 < W ? cv[x0] - cd[x0] : 0, b = x0 + 1 < W && x0 + 1 >= 0 ? cv[x0 + 1] - cd[x0 + 1] : 0;
        v = a * (1 - f) + b * f; const k = f < 0.5 ? x0 : x0 + 1; if ( k >= 0 && k < W ) { dd = cd[k]; s = ci[k]; }
      }
      // (the old column carry, bit for bit, when there is no lean: carry = max(F, carry - dec))
      if ( F[i] > 0 && F[i] >= v ) { nv[x] = F[i]; nd[x] = decOf(i); ni[x] = i; }
      else if ( v > 0 ) { nv[x] = v; nd[x] = dd; ni[x] = s; }
      else { nv[x] = Math.max(F[i], v); nd[x] = decOf(i); ni[x] = -1; }
      Ht[i] = nv[x]; src[i] = ni[x];
    }
    cv.set(nv); cd.set(nd); ci.set(ni);
  }
  const lvF = (i) => (buf && src[i] >= 0 ? buf.LF[src[i]] : 2), smF = (i) => (buf ? (src[i] >= 0 ? buf.SMF[src[i]] : 0) : 2);
  // smoke sources: the strokes' own and what the fire gives off (fireball: its tongues' upper half most; fire: the tips of its tongues)
  const Lsrc = new Uint8Array(N), fromFire = new Uint8Array(N), SS = new Float32Array(N);
  for ( let i = 0; i < N; i++ ) {
    const h = Ht[i], ls = h > 0 ? smF(i) : 0;
    let fs = 0;
    if ( P.smoke > 0 && h > 0 && ls > 0 ) fs = ball ? Math.min(1, P.smoke * 2.4 * h * SMOKE_LV[ls]) : Math.min(1, P.smoke * 4.2 * SMOKE_LV[ls] * Math.max(0, Math.min(h, 1.1 - h)));
    const ss = S0[i] > 0 ? Math.min(1, S0[i] * (buf ? SMOKE_LV[buf.LS[i]] : 1)) : 0; SS[i] = ss;
    if ( ss >= fs ) { Sm[i] = ss; Lsrc[i] = ss > 0 ? (buf ? buf.LS[i] : 2) : 0; } else { Sm[i] = fs; Lsrc[i] = ls; fromFire[i] = 1; }
  }
  // the times of a cell: of its flames (from the tongue's source cell) and of its smoke (a lag after the flames, or the smoke stroke's)
  const I = new Float64Array(N).fill(NaN), O = new Float64Array(N).fill(Infinity), PI = new Float64Array(N).fill(NaN), PO = new Float64Array(N).fill(Infinity);
  if ( buf ) for ( let i = 0; i < N; i++ ) {
    const s = src[i];
    if ( s >= 0 ) { I[i] = buf.I[s]; O[i] = buf.O[s]; }
    if ( fromFire[i] && s >= 0 ) { PI[i] = Number.isNaN(buf.I[s]) ? NaN : buf.I[s] + T.lag; PO[i] = buf.O[s] < Infinity ? buf.O[s] + T.O * 0.4 : Infinity; }
    else if ( Sm[i] > 0 ) { PI[i] = buf.SI[i]; PO[i] = buf.SO[i]; }
  }
  // the plume: carried along the plume direction one step of the dominant axis at a time (semi-Lagrangian, linear across), fading;
  // the fire's own style widens it a little with distance (a gentle blur across: the smoke spreads out and thins as it rises)
  const [ux, uy] = plumeDir(wind[0], wind[1]), Pl = new Float32Array(N), LS = new Uint8Array(N);
  const blur = ball ? 0 : 0.24;
  // the fire style's plume FADES TO NOTHING over the last 40 % of its reach (the distance each cell's smoke has travelled is carried
  // with it), so it never reaches the area's rectangle and is never cut by it, whatever the wind (the fireball keeps its v1 plume)
  const Dst = ball ? null : new Float32Array(N), E = reach ?? plumeReach(1, Z);
  if ( P.plume > 0 ) {
    const rows = Math.abs(uy) >= Math.abs(ux), stepLen = rows ? 1 / Math.abs(uy) : 1 / Math.abs(ux), keep = Math.exp(-stepLen / Z.plumeL), dt = stepLen * T.perCell;
    const n1 = rows ? H : W, n2 = rows ? W : H, dir = rows ? (Math.sign(uy) || -1) : Math.sign(ux), slope = rows ? ux / Math.abs(uy) : uy / Math.abs(ux);
    const at = rows ? (k, j) => k * W + j : (k, j) => j * W + k;
    const val = (k, j) => (j >= 0 && j < n2 ? Pl[at(k, j)] : 0);
    for ( let kk = 0; kk < n1; kk++ ) {
      const k = dir < 0 ? n1 - 1 - kk : kk, pk = k - dir;
      for ( let j = 0; j < n2; j++ ) {
        const i = at(k, j); let v = Sm[i], from = -1;
        if ( pk >= 0 && pk < n1 ) {
          const sj = j - slope, j0 = Math.floor(sj), f = sj - j0, a = val(pk, j0), b = val(pk, j0 + 1);
          let c = a * (1 - f) + b * f;
          if ( blur ) c = c * (1 - 2 * blur) + (val(pk, j0 - 1) * (1 - f) + a * f) * blur + (b * (1 - f) + val(pk, j0 + 2) * f) * blur;
          c *= keep;
          if ( c > v ) { v = c; const jj = Math.max(0, Math.min(n2 - 1, f < 0.5 ? j0 : j0 + 1)); from = at(pk, jj); }
        }
        if ( Dst ) {
          Dst[i] = from >= 0 ? Dst[from] + stepLen : 0;
          const u = Dst[i] / E;
          if ( u > 0.6 ) { const k = Math.max(0, 1 - (u - 0.6) / 0.4); v *= k * k * (3 - 2 * k); }
        }
        Pl[i] = v;
        if ( from >= 0 ) { LS[i] = LS[from] || Lsrc[from]; if ( buf ) { PI[i] = PI[from] + dt; PO[i] = PO[from] + dt; } }
        else LS[i] = Lsrc[i];
      }
    }
  } else { Pl.set(SS); for ( let i = 0; i < N; i++ ) LS[i] = SS[i] > 0 ? Lsrc[i] : 0; }   // (no plume: only the smoke strokes' own smoke, as before)
  // the bytes
  const data = new Uint8Array(N * 4), emitF = [], emitS = [];
  let mass = 0, anim = false;
  for ( let i = 0; i < N; i++ ) {
    const r = Math.round(Math.min(1, Ht[i]) * 255), g = Math.round(Math.min(1, Pl[i]) * 255), b = Math.round(Math.min(1, F[i]) * 255);
    const o = i * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b;
    data[o + 3] = r || g ? 1 + (lvF(i) - 1) * 4 + (g ? Math.max(1, LS[i] || 2) : 0) : 0;
    mass += F[i];
    if ( buf && (r || g) && (!Number.isNaN(I[i]) || O[i] < Infinity || !Number.isNaN(PI[i]) || PO[i] < Infinity) ) anim = true;
  }
  // the times texture (only while something animates): R / G the flames' ignite / out, B / A the smoke's (0 = long burning, 255 =
  // not going out)
  let times = null, refs = null;
  if ( anim ) {
    let iMin = Infinity, iMax = -Infinity, oMin = Infinity, oMax = -Infinity;
    for ( let i = 0; i < N; i++ ) {
      if ( !Number.isNaN(I[i]) ) { iMin = Math.min(iMin, I[i]); iMax = Math.max(iMax, I[i]); }
      if ( !Number.isNaN(PI[i]) ) { iMin = Math.min(iMin, PI[i]); iMax = Math.max(iMax, PI[i]); }
      if ( O[i] < Infinity ) { oMin = Math.min(oMin, O[i]); oMax = Math.max(oMax, O[i]); }
      if ( PO[i] < Infinity ) { oMin = Math.min(oMin, PO[i]); oMax = Math.max(oMax, PO[i]); }
    }
    refs = { iRef: Number.isFinite(iMin) ? iMin : 0, iSpan: Number.isFinite(iMin) ? Math.max(1, iMax - iMin) : 1,
      oRef: Number.isFinite(oMin) ? oMin : 0, oSpan: Number.isFinite(oMin) ? Math.max(1, oMax - oMin) : 1 };
    const enI = (t) => (Number.isNaN(t) ? 0 : 1 + Math.round((t - refs.iRef) / refs.iSpan * 254));
    const enO = (t) => (t < Infinity ? Math.round((t - refs.oRef) / refs.oSpan * 254) : 255);
    times = new Uint8Array(N * 4);
    for ( let i = 0; i < N; i++ ) { const o = i * 4; times[o] = enI(I[i]); times[o + 1] = enO(O[i]); times[o + 2] = enI(PI[i]); times[o + 3] = enO(PO[i]); }
  }
  // emitters: burning cells (embers: fewer for smouldering, more for a blaze) and smoke sources (puffs, only where there is smoke),
  // evenly thinned to at most 240 / 160, deterministic; each carries its ignite / out time
  for ( let i = 0; i < N; i++ ) {
    const lf = buf ? buf.LF[i] : 2;
    if ( F[i] >= 0.45 * FIRE_LV.heat[lf] ) {
      const sp = FIRE_LV.sparks[lf];
      if ( sp >= 1 || hash4(seed, i, 11) < sp ) emitF.push(i);
      if ( sp >= 2 ) emitF.push(i);
    } else if ( S0[i] >= 0.3 || (Ht[i] > 0.12 && Ht[i] < 0.3 && P.smoke > 0 && smF(i) > 0) ) emitS.push(i);
  }
  const thin = (L, n) => { if ( L.length <= n ) return L; const out = []; for ( let k = 0; k < n; k++ ) out.push(L[Math.floor((k + hash4(seed, k, 7) * 0.999) * L.length / n)]); return out; };
  const em = (smoke) => (i) => {
    const a = smoke ? PI[i] : I[i], b = smoke ? PO[i] : O[i];
    return [i % W, Math.floor(i / W), Number.isNaN(a) ? null : a, b < Infinity ? b : null];
  };
  const lv = new Uint8Array(N); for ( let i = 0; i < N; i++ ) lv[i] = buf ? buf.LF[i] : 2;
  return { w: W, h: H, data, times, anim: refs, mass, emit: { fire: thin(emitF, 240).map(em(false)), smoke: thin(emitS, 160).map(em(true)) },
    plume: [ux, uy], burn: F, lv, I: buf ? buf.I : null, O: buf ? buf.O : null, style: ball ? "fireball" : "fire", tOut: T.O, tGrow: T.G };
}

/**
 * A field from a MASK of burning ground (any source, e.g. a destruction stroke later on): `mask` W x H bytes (0 = not burning, 255 =
 * full strength), optional smoke mask. The hook for "a destruction stroke carries fire": no strokes of this layer needed.
 */
export function fieldFromMask(mask, W, H, { smoke = null, wind = [0, 0], geo, P, seed = 1, style = "fire", color = null } = {}) {
  const N = W * H, F = new Float32Array(N), S = new Float32Array(N), Pc = cleanParams(P);
  for ( let i = 0; i < N; i++ ) { F[i] = mask[i] / 255; if ( smoke ) S[i] = smoke[i] / 255; }
  return withColor(fieldFrom(F, S, W, H, wind, geo, Pc, seed, { style }), color ?? Pc.fireColor, Pc);
}

/* ---------------------------------------------------------------- lights */

/**
 * The LIGHTS of the burning ground of some areas: the burning cells binned (bins of `bin` grid squares), then neighbouring bins merged
 * (closest first) while they lie within `gap` grid squares of each other and the merged light stays compact; over `max` the closest
 * merge anyway. So one fire is one or a few lights and two fires more than a square apart never share one. One light per cluster:
 * { x, y (scene px), radius (scene px: lightRadius x the cluster's half-diagonal + half a square, x its fire level), strength 0..1,
 * level 1..3, ignite / out (ms or null: the light grows and fades with its fire), seed, fire (its base colour), color (the light colour, look.rampOf) }; clusters of different colours never merge (except over the cap). `items`: [{ area, field }]. Deterministic.
 */
export function lightsOf(items, geo, P, { bin = 3, max = 24, gap = 1 } = {}) {
  const B = Math.max(2, Math.round(bin * geo.grid / geo.ap)), G = gap * geo.grid / geo.ap, cl = [];
  for ( const { area, field } of items ) {
    const F = field.burn, W = field.w, H = field.h, bins = new Map();
    if ( !F ) continue;
    for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
      const i = y * W + x, v = F[i]; if ( v < 0.05 ) continue;
      const k = Math.floor(x / B) + Math.floor(y / B) * 65536;
      let c = bins.get(k); if ( !c ) bins.set(k, c = { m: 0, sx: 0, sy: 0, x0: x, y0: y, x1: x, y1: y, n: 0, lv: 0, im: 0, iw: 0, om: 0, ow: 0 });
      c.m += v; c.sx += x * v; c.sy += y * v; c.n++; c.lv += (field.lv?.[i] ?? 2) * v;
      const I = field.I?.[i], O = field.O?.[i];
      if ( I !== undefined && !Number.isNaN(I) ) { c.im += I * v; c.iw += v; }
      if ( O !== undefined && O < Infinity ) { c.om += O * v; c.ow += v; }
      if ( x < c.x0 ) c.x0 = x; if ( x > c.x1 ) c.x1 = x; if ( y < c.y0 ) c.y0 = y; if ( y > c.y1 ) c.y1 = y;
    }
    for ( const c of [...bins.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]) ) {
      cl.push({ ...c, col: area.color ?? field.color ?? NATURAL, cx: area.rect.x0 + c.sx / c.m, cy: area.rect.y0 + c.sy / c.m,
        x0: area.rect.x0 + c.x0, y0: area.rect.y0 + c.y0, x1: area.rect.x0 + c.x1 + 1, y1: area.rect.y0 + c.y1 + 1, seed: area.seed });
    }
  }
  const merge = (a, b) => {
    const m = a.m + b.m;
    return { m, col: a.m >= b.m ? a.col : b.col, n: a.n + b.n, cx: (a.cx * a.m + b.cx * b.m) / m, cy: (a.cy * a.m + b.cy * b.m) / m, lv: a.lv + b.lv,
      im: a.im + b.im, iw: a.iw + b.iw, om: a.om + b.om, ow: a.ow + b.ow,
      x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), seed: (a.seed ^ b.seed) >>> 0 };
  };
  const gapOf = (a, b) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
  const compact = (a, b) => Math.hypot(Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0), Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0)) <= B * 2.2;
  for ( ;; ) {
    let bi = -1, bj = -1, bd = Infinity, fi = -1, fj = -1, fd = Infinity;
    for ( let i = 0; i < cl.length; i++ ) for ( let j = i + 1; j < cl.length; j++ ) {
      const d = Math.hypot(cl[i].cx - cl[j].cx, cl[i].cy - cl[j].cy);
      if ( d < fd ) { fd = d; fi = i; fj = j; }
      if ( d < bd && cl[i].col === cl[j].col && gapOf(cl[i], cl[j]) <= G && compact(cl[i], cl[j]) ) { bd = d; bi = i; bj = j; }
    }
    if ( cl.length > max && fi >= 0 ) { cl[fi] = merge(cl[fi], cl[fj]); cl.splice(fj, 1); continue; }
    if ( bi < 0 ) break;
    cl[bi] = merge(cl[bi], cl[bj]); cl.splice(bj, 1);
  }
  return cl.map((c, i) => {
    const half = Math.hypot(c.x1 - c.x0, c.y1 - c.y0) / 2 * geo.ap, level = Math.max(1, Math.min(3, Math.round(c.lv / c.m)));
    return { x: geo.ox + c.cx * geo.ap, y: geo.oy + c.cy * geo.ap, radius: Math.round(P.lightRadius * (half + geo.grid / 2) * FIRE_LV.lightR[level]),
      strength: Math.min(1, c.m / c.n / FIRE_LV.heat[level]), level, ignite: c.iw > c.m * 0.25 ? Math.round(c.im / c.iw) : null,
      out: c.ow > c.m * 0.5 ? Math.round(c.om / c.ow) : null, seed: (c.seed + i * 7919) >>> 0, fire: c.col, color: rampOf(c.col).light };
  });
}

/** The light's flicker at shared time `now` (ms): stepped at 12 Hz (pixel-art pace), smooth noise between steps, 1 = full. Pure. */
export function flickerAt(now, seed, strength) {
  if ( !(strength > 0) ) return 1;
  const t = Math.floor(now / 83.333) / 12 * 3 + (seed % 1000) * 0.137, i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f);
  const a = hash4(seed, i), b = hash4(seed, i + 1), n = a + (b - a) * s;     // 0..1
  return 1 - strength * 0.45 * n;
}

/**
 * How far a light (or a cell) is lit at `now` (ms): 0..1 - growing from `ignite` over grow ms (eased), fading from `out` over out ms.
 * null times = steady. Pure.
 */
export function litAt(now, ignite, out, G, O) {
  let k = 1;
  if ( ignite !== null && ignite !== undefined ) { const g = G > 0 ? Math.max(0, Math.min(1, (now - ignite) / G)) : now >= ignite ? 1 : 0; k *= g * (2 - g); }
  if ( out !== null && out !== undefined ) { const f = O > 0 ? Math.max(0, Math.min(1, (now - out) / O)) : now >= out ? 1 : 0; k *= 1 - f; }
  return k;
}

/* ---------------------------------------------------------------- particles (pure) */

export const EMBER = [0xfff0a0, 0xffb030, 0xe0501c, 0x7a2a14];
export const PUFF = [0x4a4541, 0x5d5853, 0x77716b];

/**
 * Slot `k` of an area at shared time `now` (ms): null (resting between lives) or { x, y (cells, area-local, whole numbers: the art
 * grid), color, size (1 | 2), kind }. A pure function of its inputs: every client draws the same particle at the same moment, at any
 * frame rate, with no state kept between frames. `speed` the layer's animation speed, `wind` the area's [wx, wy]. An emitter not yet
 * caught or already out gives nothing.
 */
export function particleAt(field, seed, k, now, speed = 1, wind = [0, 0], g = 32) {
  const u = g / 32;   // (speeds below are for 32 cells per grid square: the module's art grid)
  const em = field.emit, puff = em.smoke.length && (k % 4 === 3 || !em.fire.length);
  const list = puff ? em.smoke : em.fire; if ( !list.length ) return null;
  const life = puff ? 1500 + hash4(seed, k, 1) * 1100 : 600 + hash4(seed, k, 1) * 800, period = life + hash4(seed, k, 2) * 900;
  const tt = now * speed + hash4(seed, k, 3) * period, cyc = Math.floor(tt / period), age = tt - cyc * period;
  if ( age >= life ) return null;
  const f = age / life, src = list[Math.floor(hash4(seed, k, cyc, 4) * list.length)], j = hash4(seed, k, cyc, 5), sec = age / 1000;
  if ( (src[2] !== null && src[2] !== undefined && now < src[2] + (field.tGrow ?? 0) * 0.3) || (src[3] !== null && src[3] !== undefined && now > src[3] + (field.tOut ?? 0) * (puff ? 0.8 : 0.4)) ) return null;
  if ( puff ) {
    if ( f > 0.8 && hash4(seed, k, cyc, Math.floor(age / 120)) < (f - 0.8) * 4 ) return null;     // dissolving: pixel dropout, no fade
    const rise = (5 + j * 4) * u, ux = wind[0] * 9 * u, uy = wind[1] * 9 * u;
    return { x: Math.round(src[0] + ux * sec + Math.sin(sec * 1.7 + j * 6) * 1.2 * u), y: Math.round(src[1] - rise * sec + uy * sec), color: (field.puffs ?? PUFF)[Math.min(2, Math.floor(f * 3))], size: 2, kind: "puff" };
  }
  const rise = (12 + j * 16) * u, sway = (0.8 + hash4(seed, k, cyc, 6) * 2) * u;
  return { x: Math.round(src[0] + wind[0] * 8 * u * sec + Math.sin(sec * 5 + j * 9) * sway), y: Math.round(src[1] - rise * sec), color: (field.embers ?? EMBER)[Math.min(3, Math.floor(f * 4))], size: 1, kind: "ember" };
}

/** Particle slots an area gets out of `cap` shared by the visible areas (by their emitters), at least 2 when it has any. */
export function shareSlots(fields, cap) {
  const w = fields.map((f) => f ? Math.min(60, f.emit.fire.length + f.emit.smoke.length * 0.5) : 0), sum = w.reduce((a, b) => a + b, 0);
  if ( !cap || !sum ) return fields.map(() => 0);
  return w.map((x) => x ? Math.max(2, Math.floor(cap * x / sum)) : 0);
}

/* ---------------------------------------------------------------- culling */

/** Is an area's rectangle (cells) inside the view (scene px rectangle { x0, y0, x1, y1 }), grown by `margin` scene px? */
export function inView(rect, geo, view, margin = 0) {
  const x0 = geo.ox + rect.x0 * geo.ap, y0 = geo.oy + rect.y0 * geo.ap, x1 = geo.ox + rect.x1 * geo.ap, y1 = geo.oy + rect.y1 * geo.ap;
  return !(x0 > view.x1 + margin || y0 > view.y1 + margin || x1 < view.x0 - margin || y1 < view.y0 - margin);
}

/** The shader's time (seconds) at shared time `now` (ms): stepped at 12 frames a second, wrapped every 1000 s (float precision). */
export function shaderTime(now, speed = 1) { return (Math.floor(now * speed / 83.333) / 12) % 1000; }
