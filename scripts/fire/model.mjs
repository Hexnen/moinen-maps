/**
 * FIRE AND SMOKE, the pure part (no Foundry, no PIXI: node-tested in dev/fire-model.test.mjs). A layer of its own drawn OVER the
 * destruction layer. What is stored, in two scene flags (written by the GM, read by every client, nothing is ever uploaded or baked):
 *
 *   flags.moinen-maps.fire          the layer's settings (PARAM_DEFAULTS): { v, on, who, smoke, flame, plume, speed, grow, spread, out,
 *                                   fireColor, smokeTint, light, lightRadius, lightIntensity, lightFollow, lightColor, lightFlicker,
 *                                   torn, tear (the torn edges new strokes pin) }
 *   flags.moinen-maps.fireStrokes   { [id]: stroke }: every brush stroke an object of its own (an add or a delete touches one key, so
 *                                   two edits never overwrite each other)
 *     stroke = { id, k: "fire" | "smoke" | "erase", s: strength 0.1..1, r: radius (scene px), p: [x0, y0, x1, y1, ...] (scene px,
 *                whole numbers), wd: wind direction (degrees, screen: 0 = right, 90 = down), ws: wind 0..1, q: paint time (ms on the
 *                shared clock: the stroke catches fire from then), sd: seed,
 *                lv: FIRE LEVEL 1..3 (fire only: smouldering, a steady fire, a blaze), sm: SMOKE LEVEL, independent of the fire level
 *                (fire: 0..3, 0 = no smoke; smoke: 1..3: wisps, a plume, a thick dark column), st: "fireball" (the old rolling look)
 *                or absent (fire burning in place), c: the fire's COLOUR "#rrggbb" (absent: the scene's fireColor - the natural
                orange unless the GM changes it; look.mjs derives the whole palette from it), o: the time it was PUT OUT (absent while it burns), g: the time it was lit
 *                again (an undo / redo brings a stroke back: it grows again from g, but keeps its place q in the paint order),
 *                e: 1 an ORGANIC footprint edge (every stroke painted since outlines exist; absent: the old round brush), tn: TORN
 *                0.1..1 (absent: not torn) - see outlineOf }
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
  lightFlicker: 0.5,     // 0 = steady
  torn: false,           // new strokes get TORN edges (as destruction's torn borders; each stroke stores its own: `tn`)
  tear: 0.6              // how torn (0.1..1)
});
export const LIMITS = { s: [0.1, 1], r: [4, 4000], ws: [0, 1], smoke: [0, 1], flame: [0.3, 2.5], plume: [0, 8], speed: [0.2, 3],
  grow: [0, 10], spread: [0.5, 40], out: [0, 10], smokeTint: [0, 1], lightRadius: [0.5, 4], lightIntensity: [0, 1], lightFlicker: [0, 1], tear: [0.1, 1] };
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
    lightFlicker: num(o.lightFlicker, D.lightFlicker, ...L.lightFlicker),
    torn: o.torn === true, tear: num(o.tear, D.tear, ...L.tear)
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
  // the footprint: e = 1 an organic edge (every stroke painted since; older ones keep their round brush), tn = torn (0.1..1)
  if ( k !== "erase" && o.e === 1 ) out.e = 1;
  if ( k !== "erase" && Number(o.tn) > 0 ) out.tn = Math.round(num(o.tn, 0.6, ...LIMITS.tear) * 100) / 100;
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
  const { pts, R: R0 } = cellPath(st, geo), R = R0 + (st.st === "fireball" ? 0 : outlineMargin(st, R0));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const [x, y] of pts ) { x0 = Math.min(x0, x - R); y0 = Math.min(y0, y - R); x1 = Math.max(x1, x + R); y1 = Math.max(y1, y + R); }
  return { x0, y0, x1, y1 };
}
/** A rectangle in whole cells, grown by `m` cells (2; the fire style adds room for a soft edge: a quarter of a square). */
const cells = (r, m = 2) => ({ x0: Math.floor(r.x0) - m, y0: Math.floor(r.y0) - m, x1: Math.ceil(r.x1) + m, y1: Math.ceil(r.y1) + m });
const marginOf = (st, geo) => (st.st === "fireball" ? 2 : 2 + Math.ceil(geo.grid / geo.ap * 0.25));
/** How far a stroke's smoke travels (cells along the plume); the plume fades to nothing by then (fieldFrom). */
export const plumeReach = (s, Z) => Z.plumeL * (0.4 + 0.6 * s) * 2.4;

/**
 * How far the fire style's smoke PUFFS can reach from the cell that gives them off (cells): art.mjs's puff loop at its extremes - the
 * highest rise (level 3, the fastest puff), the shear and gust drift along the wind, the wobble, the lattice jitter, the largest
 * stretched lobe (the loop's own cull bound), the flow warp, the ground shadow's offset. { up (rows), sMin, sMax (cells across per
 * row risen), padX, padY }. The area's rectangle holds all of it (reachOf) and the field's G marks every cell a puff can cover
 * (puffMask): the smoke is never cut by either. Mirrors art.mjs (L_RISE, S_V0, S_R1, TAU, the 22 art px source lattice, the gust
 * 0.06..0.38): keep them in step.
 */
const P_RISE = [0, 10, 22, 40], P_V0 = [0, 16, 20, 24], P_R1 = [0, 11, 17, 21];   // (art.mjs L_RISE, S_V0, S_R1: art px)
export function puffReach(cpg, plume, wind, lv = 3, sm = 3) {
  const u = cpg / 32, Hk = plume / 2.5, wx = wind[0] ?? 0, wy = wind[1] ?? 0, gdir = wx < -0.05 ? -1 : 1;
  lv = Math.max(1, Math.min(3, lv)); sm = Math.max(1, Math.min(3, sm));
  const zMax = P_RISE[lv] * u + P_V0[sm] * u * Hk * 1.5 * 1.35 * 1.3, k = Math.max(0.25, 1 - 0.5 * wy);
  const sA = 0.6 * wx + 0.12 * gdir * 1.048, sB = 0.6 * wx + 0.12 * gdir * 1.304, sS = 0.6 * wx + 0.12 * gdir + 0.25;
  const sMin = Math.min(0, sA, sB) / k, sMax = Math.max(0, sA, sB, sS) / k;
  const r = P_R1[sm] * u * 1.2, strx = 1 + 0.55 * (0.3 + 2 * Math.max(Math.abs(sA), Math.abs(sB)));
  const padX = r * (0.87 + 1.2 * strx) + 2 + 4 * u + 2.5 * u + 11 * u + 2, padY = r * 1.85 + 2 + 4 * u + 8.8 * u + 2;
  return { up: Math.ceil(zMax * k), sMin, sMax, padX: Math.ceil(padX), padY: Math.ceil(padY) };
}

/** A sliding-window min (or max) along rows (`across`) or columns, window +-w, in place over Float32 `v` (W x H). O(N). */
function slide(v, W, H, across, w, max) {
  const n = across ? W : H, m = across ? H : W, at = across ? (k, j) => k * W + j : (k, j) => j * W + k;
  const line = new Float32Array(n), q = new Int32Array(n), better = max ? (a, b) => a >= b : (a, b) => a <= b;
  for ( let k = 0; k < m; k++ ) {
    for ( let j = 0; j < n; j++ ) line[j] = v[at(k, j)];
    let h = 0, t = 0, j2 = 0;
    for ( let j = 0; j < n; j++ ) {
      for ( ; j2 < n && j2 <= j + w; j2++ ) { while ( t > h && better(line[j2], line[q[t - 1]]) ) t--; q[t++] = j2; }
      while ( q[h] < j - w ) h++;
      v[at(k, j)] = line[q[h]];
    }
  }
}

/**
 * The cells the puffs can cover, and from where: { M (Uint8Array W x H, 1 = maybe smoke), lo, hi (Float32Array: how far below the
 * cell, in rows, the nearest / the farthest source that can reach it lies; negative = above), xlo, xhi (the columns those sources
 * lie in, relative to the cell) }. Every smoke source (`src(i)`) swept up
 * its drift cone, then grown by the puff's own extent. O(N x a few); conservative (a cell more, a row more, never less). art.mjs only
 * looks for puffs on these cells, and only among those source rows and columns.
 */
export function puffMask(W, H, src, R) {
  const N = W * H, B = new Int32Array(N).fill(-1), Bm = new Int32Array(N).fill(-1), BIG = 1e9;
  const Xa = new Float32Array(N).fill(BIG), Xb = new Float32Array(N).fill(-BIG);   // (the reaching sources' columns: min, max)
  for ( let i = 0; i < N; i++ ) if ( src(i) ) { B[i] = Bm[i] = R.up; Xa[i] = Xb[i] = i % W; }
  // the cone, row by row upwards (B = the rows the NEAREST source's puffs can still rise, Bm = the farthest's): the drift counted from
  // the bottom row and rounded per row, so the shifts telescope - a source's spread stays within a cell of the exact one (the pads
  // hold that cell)
  const off = (y, s) => s * (H - 1 - y);
  for ( let y = H - 2; y >= 0; y-- ) {
    const lo = Math.floor(off(y, R.sMin)) - Math.floor(off(y + 1, R.sMin)), hi = Math.ceil(off(y, R.sMax)) - Math.ceil(off(y + 1, R.sMax));
    for ( let x = 0; x < W; x++ ) {
      const i = y * W + x; let b = B[i], bm = Bm[i] >= 0 ? Bm[i] : 1e9;
      for ( let d = lo; d <= hi; d++ ) {
        const xs = x - d; if ( xs < 0 || xs >= W ) continue;
        const j = (y + 1) * W + xs;
        if ( B[j] > 0 ) b = Math.max(b, B[j] - 1);
        if ( B[j] > 0 ) { bm = Math.min(bm, Math.max(0, Bm[j] - 1)); Xa[i] = Math.min(Xa[i], Xa[j]); Xb[i] = Math.max(Xb[i], Xb[j]); }   // (the farthest may run out first: then 0, never less - conservative)
      }
      B[i] = b; Bm[i] = bm < 1e9 ? bm : -1;
    }
  }
  // grown by the puff's extent (across, then down): the source distances of the cells within reach, widened by the vertical pad
  const lo = new Float32Array(N), hi = new Float32Array(N);
  for ( let i = 0; i < N; i++ ) { lo[i] = B[i] >= 0 ? R.up - B[i] : BIG; hi[i] = Bm[i] >= 0 ? R.up - Bm[i] : -BIG; }
  slide(lo, W, H, true, R.padX, false); slide(hi, W, H, true, R.padX, true);
  slide(lo, W, H, false, R.padY, false); slide(hi, W, H, false, R.padY, true);
  slide(Xa, W, H, true, R.padX, false); slide(Xb, W, H, true, R.padX, true); slide(Xa, W, H, false, R.padY, false); slide(Xb, W, H, false, R.padY, true);
  const M = new Uint8Array(N);
  for ( let i = 0; i < N; i++ ) if ( lo[i] < BIG / 2 ) { M[i] = 1; lo[i] -= R.padY; hi[i] += R.padY; Xa[i] -= i % W; Xb[i] -= i % W; }
  return { M, lo, hi, xlo: Xa, xhi: Xb };
}

/** A stroke's CORE (cells, integers, x1/y1 exclusive): its path and its flame tongues - what joins areas. */
export function coreOf(st, geo, P) {
  const b = pathBox(st, geo);
  if ( st.k === "fire" ) b.y0 -= flameOf(st, sizes(geo, P)) + 2;
  return cells(b, marginOf(st, geo));
}

/**
 * What a stroke can reach (cells, integers, x1/y1 exclusive): its path, its flame tongues, its smoke plume and (`puffs`) its smoke
 * puffs' whole reach. Without the puffs: the FIRE BOX (where the tongues, the bed and the sparks are drawn; art.mjs skips them outside).
 */
export function reachOf(st, geo, P, puffs = true) {
  const Z = sizes(geo, P), b = pathBox(st, geo), r = { ...b };
  if ( st.k === "fire" ) r.y0 -= flameOf(st, Z) + 2;
  if ( smokeOf(st, P) > 0 && P.plume > 0 ) {
    const [wx, wy] = windVec(st.wd, st.ws), [ux, uy] = plumeDir(wx, wy);
    const E = plumeReach(st.s, Z) + (st.k === "fire" ? flameOf(st, Z) : 0), ex = ux * E, ey = uy * E;
    r.x0 = Math.min(r.x0, b.x0 + ex); r.x1 = Math.max(r.x1, b.x1 + ex); r.y0 = Math.min(r.y0, b.y0 + ey); r.y1 = Math.max(r.y1, b.y1 + ey);
    const spread = E * 0.15; r.x0 -= spread; r.x1 += spread;
  }
  // the fire style's PUFFS: their whole reach (rise, drift, size) fits, so none ever comes near the rectangle (art.mjs also fades a
  // puff out as a whole before its extent could touch the edge: a safety, for the clamped and the mixed-wind areas)
  if ( puffs && st.st !== "fireball" && smokeOf(st, P) > 0 ) {
    const R = puffReach(geo.grid / geo.ap, P.plume, windVec(st.wd, st.ws), st.k === "fire" ? st.lv ?? 2 : 1, smokeOf(st, P));
    r.x0 = Math.min(r.x0, b.x0 + Math.min(0, R.sMin * R.up) - R.padX); r.x1 = Math.max(r.x1, b.x1 + Math.max(0, R.sMax * R.up) + R.padX);
    r.y0 = Math.min(r.y0, b.y0 - R.up - R.padY); r.y1 = Math.max(r.y1, b.y1 + R.padY);
  }
  return cells(r, marginOf(st, geo));
}

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/* ---------------------------------------------------------------- time: catching, growing, going out */

/** How long the last smoke puffs of a put-out fire live on (ms): the longest puff life (art.mjs: level 3, 4.6 s x 1.3). */
export const SMOKE_TAIL = 6000;

/** The timing (ms) of the settings: grow, the smoke's lag, out, the smoke's travel up the plume (per cell and at most), the spans. */
export function timing(geo, P) {
  const g = geo.grid / geo.ap, Z = sizes(geo, P), perCell = 1000 / (2 * g);   // (the smoke fills its plume at 2 squares a second)
  const G = P.grow * 1000, O = P.out * 1000, travel = (Z.plumeL * 2.4 + Z.flameH * 1.6) * perCell;
  // (outSpan includes SMOKE_TAIL: the fire style's last smoke puffs finish their lives after the flames are out)
  return { G, O, lag: 0.35 * G, perCell, travel, growSpan: 1.35 * G + travel, outSpan: 1.6 * O + travel + SMOKE_TAIL };
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
    let box = reachOf(members[0], geo, P, false); for ( const s of members ) box = union(box, reachOf(s, geo, P, false));
    box = { x0: Math.max(box.x0, rect.x0), y0: Math.max(box.y0, rect.y0), x1: Math.min(box.x1, rect.x1), y1: Math.min(box.y1, rect.y1) };
    const er = erasers.filter((e) => overlaps(reachOf(e, geo, P), rect));
    const all = [...members, ...er].sort(byOrder);
    // the area's wind: the strength-weighted mean of its strokes' (an area is one plume direction)
    let wx = 0, wy = 0, wsum = 0;
    for ( const s of members ) { const [x, y] = windVec(s.wd, s.ws); wx += x * s.s; wy += y * s.s; wsum += s.s; }
    wx /= wsum || 1; wy /= wsum || 1;
    const id = members.map((s) => s.id).sort()[0], ph = {};
    for ( const s of all ) ph[s.id] = phases[s.id];
    const key = `${id}:${hashStr(pkey + JSON.stringify(all.map((s) => [s.id, s.k, s.s, s.r, s.wd, s.ws, s.q, s.g ?? null, s.o ?? null, s.lv ?? 0, s.sm ?? 0, s.st ?? "", s.e ?? 0, s.tn ?? 0, color(s), ph[s.id], s.p.length, hashStr(s.p.join(","))])))}`;
    out.push({ id, key, rect, box, strokes: all, phases: ph, wind: [wx, wy], seed: hashStr(id), style: style(members[0]), color: color(members[0]) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/* ---------------------------------------------------------------- the field */

/* ---------------------------------------------------------------- the footprint's outline */

const fade = (t) => t * t * (3 - 2 * t);
/** Value noise (smooth, 0..1) on integer lattice points hashed with seed `s`. Pure. */
export function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = fade(x - ix), fy = fade(y - iy);
  const a = hash4(ix, iy, s), b = hash4(ix + 1, iy, s), c = hash4(ix, iy + 1, s), d = hash4(ix + 1, iy + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/**
 * A stroke's OUTLINE (cells; null: the plain round brush of the strokes painted before outlines existed, the fireball, an eraser).
 * As destruction's organic / torn outline (destruction/core.mjs partsOf), at art-pixel scale: the footprint is read through a domain
 * warp scaled to the brush (lobes and inlets a brush radius apart, a finer octave), its width varies along the path, the rim gets
 * a little roughness and bites; TORN (st.tn) adds a stronger warp, three octaves of rim roughness, chipped 2 x 2 bites and teeth, and
 * a few detached islands just outside the rim. Seeded by the stroke (sd), in scene-absolute cells: the same on every client and in
 * every area the stroke lands in.
 */
function outlineOf(st, R) {
  if ( st.k === "erase" || st.st === "fireball" || (!st.e && !st.tn) ) return null;
  const tn = st.tn ?? 0;
  return { tn, sd: (st.sd | 0) & 0x3fffffff, OA: Math.min(9, Math.max(0.8, R * 0.2)) * (1 + 1.1 * tn), OL: Math.max(5, R * 0.9), OL2: Math.max(2.5, R * 0.38),
    WV: 0.22 + 0.4 * tn, WL: Math.max(6, R * 1.7), RG: tn * (0.8 + 0.09 * R), ISL: tn ? R * (0.16 + 0.2 * tn) + 2 : 0, IS: Math.max(2.5, R * 0.22) };
}
/** How far a stroke's outline can reach past its brush radius (cells). */
function outlineMargin(st, R) {
  const O = outlineOf(st, R);
  return O ? Math.ceil(O.OA * 1.75 + R * O.WV * 0.8 + O.RG * 1.6 + O.ISL + 2) : 0;
}
/** The outline's smooth part at scene-absolute cell (ax, ay): the warp and the island noise (sampled on a 2-cell lattice, interpolated). */
function outlineWarp(O, ax, ay, out, o) {
  const s = O.sd;
  out[o] = (vnoise(ax / O.OL, ay / O.OL, s + 1) - 0.5) * 2.4 * O.OA + (vnoise(ax / O.OL2, ay / O.OL2, s + 3) - 0.5) * 0.9 * O.OA;
  out[o + 1] = (vnoise(ax / O.OL, ay / O.OL, s + 2) - 0.5) * 2.4 * O.OA + (vnoise(ax / O.OL2, ay / O.OL2, s + 4) - 0.5) * 0.9 * O.OA;
  // islands: blobs of a noise that only count in a ring just outside the rim (torn only)
  out[o + 2] = O.tn ? vnoise(ax / O.IS, ay / O.IS, s + 31) : 0;
}
/** The rim's noise at scene-absolute cell (ax, ay) (cells; only asked near the rim): roughness, bites (inlets), torn lobes and chips. */
function outlineRim(O, ax, ay) {
  const s = O.sd;
  let n = (vnoise(ax / 2.6, ay / 2.6, s + 11) - 0.5) * 1.3;
  const b = vnoise(ax / (O.OL2 * 0.55), ay / (O.OL2 * 0.55), s + 5);
  if ( b > 0.68 ) n -= (b - 0.68) * O.OL2 * 1.6;
  if ( O.tn ) {
    // (coarse to fine, the finest kept small: torn lobes and chipped steps, never salt-and-pepper)
    n += O.RG * ((vnoise(ax / 3.2, ay / 3.2, s + 21) - 0.5) * 0.5 + (vnoise(ax / 7.5, ay / 7.5, s + 22) - 0.5) * 1.4 + (vnoise(ax / 16, ay / 16, s + 23) - 0.5) * 1.6);
    // chipped bites: 3 x 3 steps bitten in where a mid noise is low
    const cb = vnoise((ax / 3 | 0) / 1.6, (ay / 3 | 0) / 1.6, s + 24);
    if ( cb < 0.2 * O.tn ) n -= 1.5 + O.RG * 0.5;
  }
  return n;
}
/** The largest the rim noise can be either way (cells): farther inside the rim than this (plus the soft edge), it changes nothing. */
const rimMax = (O) => 0.7 + 0.52 * O.OL2 + (O.tn ? 2.3 * O.RG + 1.5 : 0);

/** The per-cell buffers of `raster` (N cells). */
function buffers(N) {
  return { F: new Float32Array(N), S: new Float32Array(N), FA: new Float32Array(N), I: new Float64Array(N).fill(NaN), O: new Float64Array(N).fill(Infinity),
    SI: new Float64Array(N).fill(NaN), SO: new Float64Array(N).fill(Infinity),
    LF: new Uint8Array(N).fill(2), LO: new Uint8Array(N), SMF: new Uint8Array(N).fill(2), LS: new Uint8Array(N).fill(2), FH: new Float32Array(N) };
}

/** Stamp a stroke into the buffers (W x H, area origin x0, y0 in cells), in paint order. */
function stamp(buf, W, H, x0, y0, st, geo, P, phase, Z, T, ball = true) {
  const { pts, R } = cellPath(st, geo), soft = Math.max(1, R * 0.35);
  const O = ball ? null : outlineOf(st, R);
  const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((b, i) => [pts[i], b]);
  const cm = catchMs(st, geo, P);
  let total = 0; const lens = segs.map(([a, b]) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); total += l; return l; });
  const lv = st.lv ?? 2, heat = FIRE_LV.heat[lv], fh = Z.flameH * FIRE_LV.height[lv];
  // ignite times are encoded only while they matter: a stroke still growing, or one put out before it had finished growing
  const lt = litTime(st), timed = phase === "grow" || (phase === "out" && st.o < lt + cm + T.growSpan);
  const fire = st.k === "fire";
  /** One cell under the stroke: `d` its distance from the path, `Re` the radius there, `la` how far along the path it lies. */
  const put = (i, d, Re, la) => {
    if ( st.k === "erase" ) {
      if ( phase === "on" ) { buf.F[i] = 0; buf.S[i] = 0; buf.FA[i] = 0; buf.I[i] = buf.SI[i] = NaN; buf.O[i] = buf.SO[i] = Infinity; }
      else if ( phase === "out" ) {
        if ( buf.F[i] > 0 ) { buf.O[i] = Math.min(buf.O[i], lt); buf.FA[i] = 0; }
        if ( buf.S[i] > 0 ) buf.SO[i] = Math.min(buf.SO[i], lt);
      } else if ( phase === "regrow" ) {
        if ( buf.F[i] > 0 ) buf.I[i] = Number.isNaN(buf.I[i]) ? st.o : Math.max(buf.I[i], st.o);
        if ( buf.S[i] > 0 ) buf.SI[i] = Number.isNaN(buf.SI[i]) ? st.o : Math.max(buf.SI[i], st.o);
      }
      return;
    }
    // where along the stroke this cell lies (0 at its start, 1 at its end, plus its distance from the path): when it catches
    const along = total ? (la + d) / (total + R) : Math.min(1, d / R) * 0.5;
    const ign = timed ? lt + along * cm : NaN, outT = phase === "out" ? st.o : Infinity;
    // (the fire style's smoke strokes fade out over their whole radius: a soft source, no cut-out silhouette)
    const e = Math.min(1, (Re - d) / soft), u = Math.min(1, d / Re), v = !fire && !ball ? st.s * (1 - u * u) * (1 - u * u) : st.s * (0.35 + 0.65 * e) * (fire ? heat : 1);
    if ( fire ) {
      const dying = buf.O[i] < Infinity;           // (what is going out under a new stroke is replaced by it)
      if ( v > buf.F[i] || (dying && phase !== "out") ) {
        const lit = buf.F[i] > 0.02 && !dying;
        if ( lit && timed && Number.isNaN(buf.I[i]) && !buf.LO[i] && buf.LF[i] !== lv ) buf.LO[i] = buf.LF[i];   // (a burning cell raised: its old level)
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
  };

  if ( !O ) {
    // the round brush (strokes from before outlines, the fireball, an eraser): capsules along the path
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
        put(y * W + x, d, R, acc + lens[s] * t);
      }
      acc += lens[s];
    }
    return;
  }

  // THE OUTLINE (outlineOf): 1. the distance from the path and how far along it, for every cell of the stroke's box (plain
  // capsules, cheap); 2. per cell once: that field read through the warp, the width along the path, the rim noise near the rim
  // (only there), the islands - so the cost is per cell, not per cell and segment.
  const OM = outlineMargin(st, R);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for ( const [px, py] of pts ) { bx0 = Math.min(bx0, px - x0); by0 = Math.min(by0, py - y0); bx1 = Math.max(bx1, px - x0); by1 = Math.max(by1, py - y0); }
  const X0 = Math.max(0, Math.floor(bx0 - R - OM)), Y0 = Math.max(0, Math.floor(by0 - R - OM));
  const BW = Math.min(W - 1, Math.ceil(bx1 + R + OM)) - X0 + 1, BH = Math.min(H - 1, Math.ceil(by1 + R + OM)) - Y0 + 1;
  if ( BW <= 1 || BH <= 1 ) return;
  const BN = BW * BH, Dd = new Float32Array(BN).fill(1e9), Al = new Float32Array(BN);
  let acc = 0;
  for ( let s = 0; s < segs.length; s++ ) {
    const [a, b] = segs[s];
    const ax = a[0] - x0, ay = a[1] - y0, bx = b[0] - x0, by = b[1] - y0, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, RM = R + OM;
    const cx0 = Math.max(X0, Math.floor(Math.min(ax, bx) - RM)), cx1 = Math.min(X0 + BW - 1, Math.ceil(Math.max(ax, bx) + RM));
    const cy0 = Math.max(Y0, Math.floor(Math.min(ay, by) - RM)), cy1 = Math.min(Y0 + BH - 1, Math.ceil(Math.max(ay, by) + RM));
    for ( let y = cy0; y <= cy1; y++ ) {
      let j = (y - Y0) * BW + (cx0 - X0);
      for ( let x = cx0; x <= cx1; x++, j++ ) {
        const px = x + 0.5 - ax, py = y + 0.5 - ay;
        const t = L2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / L2)) : 0;
        const ex = px - dx * t, ey = py - dy * t, d2 = ex * ex + ey * ey;
        if ( d2 < Dd[j] ) { Dd[j] = d2; Al[j] = acc + lens[s] * t; }
      }
    }
    acc += lens[s];
  }
  for ( let j = 0; j < BN; j++ ) Dd[j] = Math.sqrt(Dd[j]);
  // (the width along the path, one sample per cell of length)
  const wtab = new Float32Array(Math.ceil(total) + 2);
  for ( let i = 0; i < wtab.length; i++ ) wtab[i] = R * (1 + O.WV * (vnoise(i / O.WL, 3.7, O.sd + 7) - 0.5) * 1.6);
  // the smooth part (warp, islands) on a lattice of every second scene-absolute cell: the same lattice in every area
  const lX = Math.floor((X0 + x0) / 2), lY = Math.floor((Y0 + y0) / 2), lW = Math.ceil(BW / 2) + 2, lH = Math.ceil(BH / 2) + 2;
  const lat = new Float32Array(lW * lH * 3);
  for ( let gy = 0; gy < lH; gy++ ) for ( let gx = 0; gx < lW; gx++ ) outlineWarp(O, (lX + gx) * 2, (lY + gy) * 2, lat, (gy * lW + gx) * 3);
  const RMX = rimMax(O) + soft, ISL = O.tn ? O.ISL : 0, thr = 0.8 - 0.08 * O.tn, far = R * (1 + O.WV) + RMX + ISL;
  const sample = (F, sx, sy) => {
    sx = Math.max(0, Math.min(BW - 1.001, sx)); sy = Math.max(0, Math.min(BH - 1.001, sy));
    const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy, j = iy * BW + ix;
    const u0 = F[j] + (F[j + 1] - F[j]) * fx, u1 = F[j + BW] + (F[j + BW + 1] - F[j + BW]) * fx;
    return u0 + (u1 - u0) * fy;
  };
  for ( let y = Y0; y < Y0 + BH; y++ ) for ( let x = X0; x < X0 + BW; x++ ) {
    const cx = x + x0, cy = y + y0, gx = (cx >> 1) - lX, gy = (cy >> 1) - lY, fx = (cx & 1) / 2, fy = (cy & 1) / 2;
    const ka = (gy * lW + gx) * 3, kb = ka + 3, kc = ka + lW * 3, kd = kc + 3;
    const wx = lat[ka] + (lat[kb] - lat[ka]) * fx, wx1 = lat[kc] + (lat[kd] - lat[kc]) * fx;
    const wy = lat[ka + 1] + (lat[kb + 1] - lat[ka + 1]) * fx, wy1 = lat[kc + 1] + (lat[kd + 1] - lat[kc + 1]) * fx;
    const sx = x - X0 + wx + (wx1 - wx) * fy, sy = y - Y0 + wy + (wy1 - wy) * fy, D = sample(Dd, sx, sy);
    if ( D > far ) continue;
    const la = sample(Al, sx, sy), li = Math.max(0, Math.min(wtab.length - 2, la | 0));
    const Re = wtab[li] + (wtab[li + 1] - wtab[li]) * (la - li);                                    // (the width varies along the path)
    let dE = Re - D;
    if ( dE < RMX ) {
      if ( dE < -RMX - ISL ) continue;
      dE += outlineRim(O, cx, cy);
    }
    if ( dE <= 0 ) {
      // a detached island just outside the rim (torn): where the island noise peaks, a small blob of its own
      if ( !O.tn || -dE < 1.5 || -dE > ISL ) continue;
      const i0 = lat[ka + 2] + (lat[kb + 2] - lat[ka + 2]) * fx, i1 = lat[kc + 2] + (lat[kd + 2] - lat[kc + 2]) * fx, isl = i0 + (i1 - i0) * fy;
      if ( isl <= thr ) continue;
      dE = (isl - thr) * R * 2;
    }
    put(y * W + x, Math.max(0, Re - dE), Re, la);
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
  if ( area.style !== "fireball" ) {
    f.aux = auxOf(buf, W, H, P); f.auxOld = auxOldOf(buf, W, H);
    // where the smoke PUFFS can be (art.mjs draws smoke only there, so it is never cut where the plume field thins out)
    const lvs = area.strokes.filter((s) => s.k !== "erase"), lvM = Math.max(1, ...lvs.map((s) => (s.k === "fire" ? s.lv ?? 2 : 1))), smM = Math.max(1, ...lvs.map((s) => smokeOf(s, P)));
    const aux = f.aux, R = puffReach(Z.cellsPerGrid, P.plume, area.wind ?? [0, 0], lvM, smM), { M, lo, hi, xlo, xhi } = puffMask(W, H, (i) => aux[i * 4 + 2] >= 5, R);
    // the PUFF texture (RGBA8): G = 1 + the nearest source row's distance below (floored), R = the farthest's (ceiled), both + OFF,
    // in steps of S rows; B = 1 + the sources' leftmost column (floored), A = their rightmost (ceiled), relative, + OX, steps of SX
    // (art.mjs decodes them with uPuffQ = [S, OFF, SX, OX] and searches only there); G = 0: no puff reaches this cell
    const OFF = R.padY + 2, S = Math.max(1, Math.ceil((R.up + 2 * R.padY + 4) / 253)), pf = new Uint8Array(N * 4);
    const OX = R.padX + Math.ceil(Math.max(Math.abs(R.sMin), Math.abs(R.sMax)) * R.up) + 2, SX = Math.max(1, Math.ceil((2 * OX + 2) / 253));
    const enc = (v, o, q, up) => Math.min(255, Math.max(1, up ? Math.ceil((v + o) / q) : Math.floor((v + o) / q) + 1));
    for ( let i = 0; i < N; i++ ) {
      if ( !M[i] ) continue;
      const o = i * 4;
      pf[o + 1] = Math.min(255, enc(lo[i], OFF, S, false)); pf[o] = enc(hi[i], OFF, S, true);
      pf[o + 2] = Math.min(255, enc(xlo[i], OX, SX, false)); pf[o + 3] = enc(xhi[i], OX, SX, true);
    }
    f.puff = pf; f.puffQ = [S, OFF, SX, OX];
  }
  return withColor(f, area.color, P);
}

/** Ground-plane foreshortening of the oblique view (research 2f: ground ellipses ry = 0.8 r). */
export const RY = 0.8;

/**
 * Two-pass chamfer distance (cells, in the ground plane: y / RY) to the nearest cell where `inside(i)` differs: 0 on the far side.
 * Pure. Used for the bed's coverage ramps (inside) and the heat-tint ring (outside). `edge`: whether beyond the grid counts as the far
 * side (true: the bed's inside distance; false for the OUTSIDE distance - beyond the area's rectangle is outside too, never a bed: else
 * the ring and coals would trace the rectangle, the area's bounding box showing on the map).
 */
export function chamfer(inside, W, H, edge = true) {
  const N = W * H, D = new Float32Array(N), BIG = 1e6, a = 1, b = 1 / RY, c = Math.hypot(1, 1 / RY);
  for ( let i = 0; i < N; i++ ) D[i] = inside[i] ? BIG : 0;
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    const i = y * W + x; if ( !D[i] ) continue;
    let d = D[i];
    if ( x > 0 ) d = Math.min(d, D[i - 1] + a); else if ( edge ) d = Math.min(d, 0.5);
    if ( y > 0 ) { d = Math.min(d, D[i - W] + b); if ( x > 0 ) d = Math.min(d, D[i - W - 1] + c); if ( x < W - 1 ) d = Math.min(d, D[i - W + 1] + c); }
    else if ( edge ) d = Math.min(d, 0.5 * b);
    D[i] = d;
  }
  for ( let y = H - 1; y >= 0; y-- ) for ( let x = W - 1; x >= 0; x-- ) {
    const i = y * W + x; if ( !D[i] ) continue;
    let d = D[i];
    if ( x < W - 1 ) d = Math.min(d, D[i + 1] + a); else if ( edge ) d = Math.min(d, 0.5);
    if ( y < H - 1 ) { d = Math.min(d, D[i + W] + b); if ( x < W - 1 ) d = Math.min(d, D[i + W + 1] + c); if ( x > 0 ) d = Math.min(d, D[i + W - 1] + c); }
    else if ( edge ) d = Math.min(d, 0.5 * b);
    D[i] = d;
  }
  return D;
}

/**
 * The fire style's AUX texture (RGBA8, one texel per cell; art.mjs): R = distance inside the burning ground (cells, ground plane,
 * capped 255), G = distance outside it (0 inside), B = smoke SOURCE strength (where puffs are born: a smoking fire's bed, a smoke
 * stroke), A = the source's smoke level (1..3) + 4 if it is a fire's smoke. The plume field (G of the field) never gates the drawing.
 */
/**
 * The OLD bed's inside distance (RGBA8, R; G = the old level of a burning cell a new stroke raised, 0 = unchanged; null when nothing is catching next to a long-burning bed): a stroke added onto a
 * burning fire makes the old edge cells interior at once (their coverage ramp would jump: the old tongues there would pop taller);
 * art.mjs blends each cell from this distance to the new one while the new ground catches, so the burning part changes gently.
 */
function auxOldOf(buf, W, H) {
  const N = W * H, old = new Uint8Array(N);
  let fresh = false, any = false;
  for ( let i = 0; i < N; i++ ) {
    if ( buf.F[i] <= 0.05 ) continue;
    if ( Number.isNaN(buf.I[i]) ) { old[i] = 1; any = true; } else fresh = true;
    if ( buf.LO[i] ) fresh = true;
  }
  if ( !fresh || !any ) return null;
  const D = chamfer(old, W, H), out = new Uint8Array(N * 4);
  for ( let i = 0; i < N; i++ ) if ( old[i] ) { out[i * 4] = Math.min(255, Math.max(1, Math.round(D[i]))); out[i * 4 + 1] = buf.LO[i]; }
  return out;
}

function auxOf(buf, W, H, P) {
  const N = W * H, bed = new Uint8Array(N), out = new Uint8Array(N);
  for ( let i = 0; i < N; i++ ) { bed[i] = buf.F[i] > 0.05 ? 1 : 0; out[i] = 1 - bed[i]; }
  const Din = chamfer(bed, W, H), Dout = chamfer(out, W, H, false), aux = new Uint8Array(N * 4);
  for ( let i = 0; i < N; i++ ) {
    const o = i * 4;
    aux[o] = bed[i] ? Math.min(255, Math.max(1, Math.round(Din[i]))) : 0;
    aux[o + 1] = bed[i] ? 0 : Math.min(255, Math.round(Dout[i]));
    const fireS = bed[i] && P.smoke > 0 && buf.SMF[i] > 0 ? Math.min(1, buf.F[i] * Math.min(1, P.smoke * 2)) : 0;
    const ss = buf.S[i];
    if ( ss >= fireS && ss > 0.02 ) { aux[o + 2] = Math.round(Math.min(1, ss) * 255); aux[o + 3] = buf.LS[i]; }
    else if ( fireS > 0.02 ) { aux[o + 2] = Math.round(fireS * 255); aux[o + 3] = buf.SMF[i] + 4; }
  }
  return aux;
}

/** A field with its fire colour: { color, embers, puffs } (look.rampOf; the natural fire's are the old constants). */
export function withColor(f, color, P) {
  const R = rampOf(color ?? NATURAL);
  f.color = R.base; f.embers = R.embers; f.sparks = R.sparks; f.puffs = puffsOf(R, P?.smokeTint ?? 0);
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
      oRef: Number.isFinite(oMin) ? oMin : 0, oSpan: Number.isFinite(oMin) ? Math.max(1, oMax - oMin) : 1,
      hasIgnite: Number.isFinite(iMin), hasOut: Number.isFinite(oMin) };
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
export function lightsOf(items, geo, P, { bin = 3, max = 24, gap = 1, samples = 24 } = {}) {
  const B = Math.max(2, Math.round(bin * geo.grid / geo.ap)), G = gap * geo.grid / geo.ap, cl = [];
  // (the light's SAMPLES: the burning ground in one-square cells, each with its own ignite / out, level and the area's fuel seed and
  // wind - model.lightDrive reads the fire's live strength there: grow-in, go-out, the fuel map, the breathing)
  const SB = Math.max(1, Math.round(geo.grid / geo.ap));
  for ( const { area, field } of items ) {
    const F = field.burn, W = field.w, H = field.h, bins = new Map();
    if ( !F ) continue;
    const fuel = field.style === "fire", fs = hashStr("art:" + (area.color ?? "")) % 65536, wx = area.wind?.[0] ?? 0;
    for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
      const i = y * W + x, v = F[i]; if ( v < 0.05 ) continue;
      const k = Math.floor(x / B) + Math.floor(y / B) * 65536;
      let c = bins.get(k); if ( !c ) bins.set(k, c = { m: 0, sx: 0, sy: 0, x0: x, y0: y, x1: x, y1: y, n: 0, lv: 0, im: 0, iw: 0, om: 0, ow: 0, subs: new Map() });
      c.m += v; c.sx += x * v; c.sy += y * v; c.n++; c.lv += (field.lv?.[i] ?? 2) * v;
      const I = field.I?.[i], O = field.O?.[i];
      if ( I !== undefined && !Number.isNaN(I) ) { c.im += I * v; c.iw += v; }
      if ( O !== undefined && O < Infinity ) { c.om += O * v; c.ow += v; }
      if ( x < c.x0 ) c.x0 = x; if ( x > c.x1 ) c.x1 = x; if ( y < c.y0 ) c.y0 = y; if ( y > c.y1 ) c.y1 = y;
      const sk = Math.floor(x / SB) + Math.floor(y / SB) * 65536;
      let sb = c.subs.get(sk); if ( !sb ) c.subs.set(sk, sb = { m: 0, sx: 0, sy: 0, lv: 0, im: 0, iw: 0, om: 0, ow: 0 });
      sb.m += v; sb.sx += x * v; sb.sy += y * v; sb.lv += (field.lv?.[i] ?? 2) * v;
      if ( I !== undefined && !Number.isNaN(I) ) { sb.im += I * v; sb.iw += v; }
      if ( O !== undefined && O < Infinity ) { sb.om += O * v; sb.ow += v; }
    }
    for ( const c of [...bins.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]) ) {
      const subs = [...c.subs.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => ({ w: b.m, cx: area.rect.x0 + b.sx / b.m, cy: area.rect.y0 + b.sy / b.m,
        lv: Math.max(1, Math.min(3, Math.round(b.lv / b.m))), I: b.iw > b.m * 0.25 ? Math.round(b.im / b.iw) : null, O: b.ow > b.m * 0.5 ? Math.round(b.om / b.ow) : null,
        fs: fuel ? fs : -1, wx }));
      delete c.subs;
      cl.push({ ...c, subs, col: area.color ?? field.color ?? NATURAL, cx: area.rect.x0 + c.sx / c.m, cy: area.rect.y0 + c.sy / c.m,
        x0: area.rect.x0 + c.x0, y0: area.rect.y0 + c.y0, x1: area.rect.x0 + c.x1 + 1, y1: area.rect.y0 + c.y1 + 1, seed: area.seed });
    }
  }
  const merge = (a, b) => {
    const m = a.m + b.m;
    return { m, col: a.m >= b.m ? a.col : b.col, n: a.n + b.n, cx: (a.cx * a.m + b.cx * b.m) / m, cy: (a.cy * a.m + b.cy * b.m) / m, lv: a.lv + b.lv,
      im: a.im + b.im, iw: a.iw + b.iw, om: a.om + b.om, ow: a.ow + b.ow, subs: [...a.subs, ...b.subs],
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
      out: c.ow > c.m * 0.5 ? Math.round(c.om / c.ow) : null, seed: (c.seed + i * 7919) >>> 0, fire: c.col, color: rampOf(c.col).light,
      // (the heaviest one-square samples, at most `samples`, in scene px and world art cells)
      samples: [...c.subs].sort((a, b) => b.w - a.w || a.cy - b.cy || a.cx - b.cx).slice(0, samples)
        .map((s) => ({ ...s, x: geo.ox + s.cx * geo.ap, y: geo.oy + s.cy * geo.ap })) };
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

/* ---------------------------------------------------------------- the light's drive (pure: the flames' own signals on the CPU) */

// art.mjs's GLSL hash and noises, bit for bit in 32-bit integer maths (the shader's uints), so a light reads the SAME fuel map, breathing
// and gust its flames are drawn from (floats differ only in the last bits: nothing a light can show)
const hu = (x) => { x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return x >>> 0; };
/** art.mjs h1(a, b, c) with the area's uSeed: [0, 1). */
export function artHash(a, b, c, seed) {
  return (hu((Math.imul(a, 0x9E3779B1) ^ Math.imul(b, 0x85EBCA77) ^ ((Math.imul(c, 0x2545F491) + Math.imul(seed, 0x27d4eb2f)) | 0)) >>> 0) >>> 8) / 16777216;
}
const sstep = (f) => f * f * (3 - 2 * f);
function artNoise(px, py, k, seed) {
  const ix = Math.floor(px), iy = Math.floor(py), fx = sstep(px - ix), fy = sstep(py - iy);
  const a = artHash(ix, iy, k, seed), b = artHash(ix + 1, iy, k, seed), c = artHash(ix, iy + 1, k, seed), d = artHash(ix + 1, iy + 1, k, seed);
  return a + (b - a) * fx + (c + (d - c) * fx - a - (b - a) * fx) * fy;
}
function artMorph(px, py, t, per, k, seed) {
  const kk = t / per, k0 = Math.floor(kk); let w = kk - k0; w = sstep(w);
  const a = artNoise(px, py, k + k0 * 17, seed), b = artNoise(px, py, k + (k0 + 1) * 17, seed);
  return 0.5 + (a + (b - a) * w - 0.5) / Math.sqrt((1 - w) * (1 - w) + w * w);
}
/**
 * The FUEL map at world art cell (cx, cy), shader time t (s): art.mjs FUEL + fuelAt's contrast shaping (0 dead .. 1 hot). `seed` the
 * area's art seed (uSeed), `u` art px scale (grid / 32), `wx` the area's wind x.
 */
export function fuelAt(cx, cy, t, seed, u, wx = 0) {
  const S = 32 * u, fs = seed & 1023;
  const w1x = S * (1.4 * Math.sin(t * 0.083 + fs) + 0.6 * Math.sin(t * 0.191 + 2 * fs)) + wx * S * 0.12 * t, w1y = S * 0.7 * Math.sin(t * 0.067 + 0.5 * fs);
  const w2x = S * 0.9 * Math.sin(t * 0.137 + 3 * fs), w2y = S * 0.5 * Math.sin(t * 0.113 + fs) - 0.05 * S * t;
  const big = artMorph((cx + w1x) / (2.1 * S), (cy + w1y) / (2.1 * S), t, 10.3, 501, seed), mid = artMorph((cx + w2x) / (0.85 * S), (cy + w2y) / (0.85 * S), t, 7.1, 503, seed);
  const f = Math.max(0, Math.min(1, 0.62 * big + 0.38 * mid)), g = Math.max(0, Math.min(1, (f - 0.34) / 0.32));
  return sstep(g);
}
/** art.mjs breath(t, s): the flames' slow breathing of cluster s (0.65 .. 1.15, no period). */
export function breathAt(t, s, seed) {
  const fs = (s & 1023) * 0.731;
  const b = 0.9 + 0.12 * Math.sin(t * 1.6982 + fs) + 0.08 * Math.sin(t * 1.065 + 2 * fs) + 0.05 * Math.sin(t * 2.7318);
  const k = Math.floor(t / 0.7), f = sstep(t / 0.7 - k);
  return b + 0.16 * ((1 - f) * (artHash(s, k, 91, seed) - 0.5) + f * (artHash(s, k + 1, 91, seed) - 0.5));
}
/** art.mjs's breathing cluster of a world art cell. */
export const breathCluster = (cx, cy, u, seed) => Math.floor(cx / (96 * u)) * 7 + Math.floor(cy / (96 * u)) * 13 + seed;
/** art.mjs gust(t, x): the gust travelling along the wind, 0 calm .. 1 its peak at world art column x (A7: broad, ~5 squares at once). */
export function gustAt(t, x, u, seed) {
  const v = t * 0.22 - x / (480 * u) + (seed & 255) * 0.0137, f = v - Math.floor(v);
  return Math.max(0, Math.sin(Math.PI * Math.max(0, Math.min(1, (f - 0.5) / 0.4))));
}
const vn1 = (t, seed, k) => { const i = Math.floor(t), f = sstep(t - i), a = hash4(seed, i, k, 77), b = hash4(seed, i + 1, k, 77); return a + (b - a) * f; };
/**
 * A light's own FLICKER at shader time t (s), seeded per light (neighbours never in step): a slow swell, a tremor and rare short
 * dips and flares, every one hashed value noise (no sinusoid, no strobe). 1 = steady; `strength` the flicker setting.
 */
export function fireFlicker(t, seed, strength) {
  if ( !(strength > 0) ) return 1;
  seed = Math.floor(hash4(seed, 991) * 2147483647);                  // (scrambled: lights with near seeds share nothing)
  const swell = vn1(t * 0.9 + (seed % 97), seed, 1) - 0.5, trem = vn1(t * 3.1, seed, 2) - 0.5;
  const sl = t * 2.5, si = Math.floor(sl), h = hash4(seed, si, 3, 77), env = Math.sin(Math.PI * (sl - si));
  const ev = h < 0.08 ? -env * (0.6 + 4 * h) : h > 0.95 ? env * 0.7 : 0;
  return 1 + strength * (0.2 * swell + 0.1 * trem + 0.2 * ev);
}

/**
 * THE LIGHT'S DRIVE at shared time `now` (ms), shader time `T` (s): how strong the fire under light `L` (model.lightsOf, with samples)
 * burns right now, from the same signals as its flames - each sample's grow-in / go-out (litAt), the FUEL map there (a flaring patch
 * brightens the light near it, a dying one dims it), the breathing of its cluster - plus the gust passing it and the light's own
 * flicker. Returns { gain (0 dark .. ~1 normal .. ~1.6 flaring), heat (0 weak .. 1 flaring: the colour), x, y (where the fire is
 * hottest now, scene px), mass (the samples' weight) }. `u` art px scale, `G` / `O` grow / out ms, `flicker` the setting (0 = steady). Pure, deterministic.
 */
export function lightDrive(L, now, T, { u = 1, G = 0, O = 0, flicker = 0, ref = 0 } = {}) {
  const S = L.samples?.length ? L.samples : [{ w: 1, cx: 0, cy: 0, x: L.x, y: L.y, lv: L.level ?? 2, I: L.ignite, O: L.out, fs: -1, wx: 0 }];
  let sw = 0, sh = 0, mx = 0, my = 0, gx = 0;
  for ( const s of S ) {
    const k = litAt(now, s.I, s.O, G, O); if ( s.w <= 0 ) continue;
    sw += s.w; gx += s.w * s.cx;
    if ( k <= 0 ) continue;
    const fz = s.fs >= 0 ? Math.max(fuelAt(s.cx, s.cy, T, s.fs, u, s.wx), 0.07 * (s.lv - 1)) : 0.55;
    const b = s.fs >= 0 ? breathAt(T, breathCluster(s.cx, s.cy, u, s.fs), s.fs) : 1;
    const h = k * (0.3 + 0.7 * fz) * b, wh = s.w * h;
    sh += wh; mx += wh * s.x; my += wh * s.y;
  }
  if ( !(sw > 0) ) return { gain: 0, heat: 0, x: L.x, y: L.y, mass: 0 };
  // (0.65: a sample at average fuel, mid breath; `ref` a fixed reference mass - the light's own, so ground added to its fire and still
  // catching brightens it as it catches instead of first diluting it)
  const base = sh / (ref > 0 ? ref : sw) / 0.65;
  const fs = S[0].fs >= 0 ? S[0].fs : 0, gust = S[0].fs >= 0 ? gustAt(T, gx / sw, u, fs) : 0;
  const gain = base * (1 + 0.25 * gust) * fireFlicker(T, L.seed ?? 0, flicker);
  return { gain, heat: Math.max(0, Math.min(1, (gain - 0.45) / 1.0)), x: sh > 0 ? mx / sh : L.x, y: sh > 0 ? my / sh : L.y, mass: sw };
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
  const em = field.emit, puff = field.style !== "fire" && em.smoke.length && (k % 4 === 3 || !em.fire.length);   // (the fire style's smoke is all in the shader)
  const list = puff ? em.smoke : em.fire; if ( !list.length ) return null;
  const life = puff ? 1500 + hash4(seed, k, 1) * 1100 : 600 + hash4(seed, k, 1) * 800, period = life + hash4(seed, k, 2) * 900;
  const tt = now * speed + hash4(seed, k, 3) * period, cyc = Math.floor(tt / period), age = tt - cyc * period;
  if ( age >= life ) return null;
  const f = age / life, src = list[Math.floor(hash4(seed, k, cyc, 4) * list.length)], j = hash4(seed, k, cyc, 5), sec = age / 1000;
  if ( (src[2] !== null && src[2] !== undefined && now < src[2] + (field.tGrow ?? 0) * 0.3) || (src[3] !== null && src[3] !== undefined && now > src[3] + (field.tOut ?? 0) * (puff ? 0.8 : 0.4)) ) return null;
  if ( puff ) {
    if ( f > 0.8 && hash4(seed, k, cyc, Math.floor(age / 120)) < (f - 0.8) * 4 ) return null;     // dissolving: pixel dropout, no fade
    const rise = (5 + j * 4) * u, ux = wind[0] * 9 * u, uy = wind[1] * 9 * u;
    return { x: Math.round(src[0] + ux * sec + Math.sin(sec * 1.7 + j * 6) * 1.2 * u), y: Math.round(src[1] - rise * sec + uy * sec), color: (field.puffs ?? PUFF)[Math.min(2, Math.floor(f * 3))], size: 2, kind: "puff", by: src[1] };
  }
  const rise = (12 + j * 16) * u, sway = (0.8 + hash4(seed, k, cyc, 6) * 2) * u;
  return { x: Math.round(src[0] + wind[0] * 8 * u * sec + Math.sin(sec * 5 + j * 9) * sway), y: Math.round(src[1] - rise * sec), color: (field.style === "fire" ? field.sparks ?? field.embers ?? EMBER : field.embers ?? EMBER)[Math.min(3, Math.floor(f * 4))], size: 1, kind: "ember", by: src[1] };
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
