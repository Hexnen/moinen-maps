import { TABLE, lv } from "./tornado-model.mjs";

/**
 * The tornado's DEBRIS COUNTS as continuous quantities (weather slider T4, design dev/weather-slider-design.md D4 / D5). Pure: no
 * Foundry, node-tested (dev/tornado-debris.test.mjs).
 *
 * A count n (a table row x touch x the frame guard's q) is no longer rounded: the display visits ceil(n) slots and slot i takes the
 * SHARE clamp(n - i, 0, 1): 1 below the last, fract(n) for the last, so an item fades in or out instead of popping at each 0.5. A
 * whole n gives shares of exactly 0 or 1: the old Math.round(n) items, bit for bit.
 *
 * Map fragments and planks never fade (a solid piece of the map cannot be half there) and never change mid-flight: each slot's kind
 * (fragment / plank / none) and its size class are decided once, from the level at the slot's BIRTH, the fractional last slot by its
 * own hash (as the GPU particle slots do).
 */

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** n snapped to a whole number when it is one up to float noise (so a whole count gives shares of exactly 0 / 1). */
export const whole = (n) => { const r = Math.round(n); return Math.abs(n - r) < 1e-6 ? r : n; };

/** Slot i's share of count n: 1 for the whole slots, fract(n) for the last one, 0 beyond. */
export const share = (n, i) => Math.min(1, Math.max(0, n - i));

/** Every fragment / plank slot a level can use (level 3's 40 + 10). */
export const FRAG_SLOTS = Math.ceil(Math.max(...TABLE.frags) + Math.max(...TABLE.planks));

/** The share of BIG fragments (0..1, x 0.16 of the fragments) at level continuum s: none at 1, all of it from s 0.8 (a smooth ramp
 *  centred near the old step at frags >= 10, s 0.56); exactly 1 at levels 2 and 3. */
export const BIG = 0.16;
export const bigShare = (s) => ss(0.3, 0.8, s);

export const NONE = 0, FRAG = 1, PLANK = 2;

/**
 * The kind of fragment slot i at level continuum s (the slot's birth level), with h the slot cycle's own hash in [0, 1): fragments fill
 * slots [0, nF), planks [nF, nF + nP); a slot cut by a fractional boundary is either kind (or none) in proportion to its overlap.
 */
export function fragKind(s, i, h) {
  const nF = whole(lv(TABLE.frags, s)), nP = whole(lv(TABLE.planks, s));
  const wF = share(nF, i), wT = share(nF + nP, i);
  return h < wF ? FRAG : h < wT ? PLANK : NONE;
}
