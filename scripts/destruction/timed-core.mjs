/**
 * TIMED STROKES (P2 of dev/presets-design.md, G5 / G6): the pure parts. A stroke written by a destruction preset carries
 *   at  its entry start on the shared clock (ms): every client puts its areas on screen LEAD ms before and starts their entry then;
 *   ps  the firing it belongs to (scripts/presets): the preset owns it, so the brush's undo leaves it alone and the director tells
 *       the firing once instead of each stroke.
 * Neither field is part of the bake signature (store.mjs objStr): the same pixels and chunks as a brush stroke. A stroke without them
 * is untouched by everything here.
 */

/** How far past its start a timed stroke still plays its entry (the chunk came late); later it is shown settled (display WAIT_LATE_MS). */
export const LATE_MS = 1500;
/** A start further ahead than this is not believed (a broken clock, a hand-made flag): the stroke is not held. */
export const AHEAD_MAX = 60000;

/** `at` as stored: a whole number of ms, or null. */
export function cleanAt(v) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
/** `ps` as stored: a firing id usable as a flag key, or null. */
export const cleanPs = (v) => (typeof v === "string" && /^[\w-]{1,32}$/.test(v) ? v : null);

/** Is this stroke a timed one (its `at` usable)? */
export const isTimed = (o) => !!o && !o.k && cleanAt(o.at) !== null;
/** Does the preset own this stroke? */
export const isPreset = (o) => !!o && cleanPs(o.ps) !== null;

/**
 * Where a timed stroke stands at `now` (shared ms):
 *   { k: "hold", wait }  off the screen; `wait` ms until it goes on (LEAD before its start);
 *   { k: "enter", ahead } on screen with its entry `ahead` ms from now (<= 0: late - it starts now);
 *   { k: "settled" }     its moment passed long ago: shown as it lies.
 * A stroke without `at` -> null.
 */
export function phase(o, now, { lead = 450, late = LATE_MS, aheadMax = AHEAD_MAX } = {}) {
  if ( !isTimed(o) ) return null;
  const at = cleanAt(o.at), ahead = at - now;
  if ( ahead > aheadMax ) return { k: "enter", ahead: 0 };
  if ( ahead > lead ) return { k: "hold", wait: ahead - lead };
  if ( ahead >= -late ) return { k: "enter", ahead };
  return { k: "settled" };
}

/** The index of the stroke the brush's undo takes back: the last one the preset does not own (-1: none). */
export function lastUndoable(objects) {
  const L = objects ?? [];
  for ( let i = L.length - 1; i >= 0; i-- ) if ( !isPreset(L[i]) ) return i;
  return -1;
}

/**
 * Where a stroke brought back by redo goes: under the preset strokes placed after it (their `s`), so a reload keeps the same order;
 * with no such stroke on top, last (as the brush always did).
 */
export function redoIndex(objects, o) {
  const L = objects ?? [], s = Number.isFinite(o?.s) ? o.s : Infinity;
  let i = L.length;
  while ( i > 0 && isPreset(L[i - 1]) && Number.isFinite(L[i - 1].s) && L[i - 1].s > s ) i--;
  return i;
}

/**
 * The moment (ms after the start) one art pixel of a leaving area drops out: the rim first, the heart last, broken up by value
 * noise and a little grain so the edge is a ragged, dissolving zone (never a line, never a square). ~0..DROP_MS.
 * `noise(x, y)` and `grain(x, y)` in 0..1.
 */
export const DROP_MS = 600;
export function dropTime(x, y, cx, cy, R, noise, grain) {
  const d = Math.min(1, Math.hypot(x - cx, y - cy) / Math.max(1, R));
  const t = 40 + 230 * (1 - d) + 270 * noise(x / 7, y / 7) + 60 * (grain(x, y) - 0.5);
  return Math.max(0, Math.min(DROP_MS, t));
}
