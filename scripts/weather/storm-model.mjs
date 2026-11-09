import { hash3, timing as strikeTiming } from "../presets/lightning-core.mjs";

/**
 * WEATHER, the RAIN'S LIGHTNING - the pure part (no Foundry, no PIXI: node-tested in dev/weather-storm.test.mjs; drawn by storm.mjs).
 *
 * THE STORED SETTINGS live in the weather flag as `storm` (absent until the GM first touches the lightning: a scene that never did
 * stores and draws exactly what it did before):
 *   { on, rate (flashes per minute, on average), power 0..1, near 0..1 (0 a distant storm .. 1 right overhead), bolts (visible bolts
 *     for the close strikes), t (shared ms the settings took effect), prev (the settings before t, or null) }
 * Flashes that started before `t` keep the settings they started with (a switch-off or a slider never cuts a flash in half).
 *
 * THE FLASHES are a pure function of (the settings, the scene's seed, the rain's presence, the shared clock), so every client sees
 * the same flash at the same moment and nothing is sent per flash: the time is cut into 1 s SLOTS; each slot holds at most one
 * flash, by its own hash, with a chance of rate x the storm's ACTIVITY (a slow hashed wave: lulls and bursts, averaging 1) x the
 * rain's presence (the lightning comes and goes with the rain). Three kinds:
 *   far    a distant storm cell: a soft, flickering glow from beyond the scene's edge, several diffused pulses (the light through
 *          the clouds), no bolt
 *   mid    a nearer one: a brighter broad flash from one side, 1-3 pulses
 *   close  a strike in the scene: the return stroke and its restrikes (the strike preset's timing, so a visible bolt's strokes and the
 *          light pulse together), a pool of light round the strike point, the sky's flickers before it
 * `lightAt` is a flash's light at a moment (0..~1.3); `calmAt` the same flash for a client that opted out of flashes: one slow,
 * faint swell, no flicker.
 */
export const SLOT = 1000;                      // ms per slot (at most one flash starts in each)
export const LIMITS = { rate: [1, 30], power: [0, 1], near: [0, 1] };
export const DEFAULT = Object.freeze({ on: false, rate: 6, power: 0.7, near: 0.5, bolts: true });
export const KINDS = ["far", "mid", "close"];
/** The longest a flash lasts round its time (ms): [before, after] (the close strike's sky flickers come 760 ms before it). */
export const SPAN = [-800, 2700];
/** The storm's activity wave: one hashed value per ACT_MS, eased between. */
export const ACT_MS = 40000;
/** The share of every pulse's light that is the slow afterglow (the lit air and clouds round the channel). */
const AFTER = 0.35, GLOW = 1.8;

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const ss = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** The settings proper (no time, no history). */
export function cleanCore(s, d = DEFAULT) {
  const o = s && typeof s === "object" ? s : {};
  return { on: o.on === undefined ? d.on : o.on === true, rate: num(o.rate, ...LIMITS.rate, d.rate), power: num(o.power, ...LIMITS.power, d.power),
    near: num(o.near, ...LIMITS.near, d.near), bolts: o.bolts === undefined ? d.bolts : o.bolts !== false };
}
/** The stored storm (null: never set: the flag stays as it was). */
export function cleanStorm(s) {
  if ( !s || typeof s !== "object" ) return null;
  const t = Math.round(Number(s.t));
  return { ...cleanCore(s), t: Number.isFinite(t) && t > 0 ? t : 0, prev: s.prev && typeof s.prev === "object" ? cleanCore(s.prev) : null };
}
/** The settings a flash starting at `te` follows (null: none). */
export function settingsAt(S, te) {
  if ( !S ) return null;
  return te >= S.t ? S : S.prev;
}
/**
 * A GM change: the new stored storm, taking effect at shared ms `t` (the settings before it kept for the flashes already running).
 * `patch` = any of { on, rate, power, near, bolts }.
 */
export function withChange(S, patch, t) {
  const cur = S ? cleanCore(S) : { ...DEFAULT };
  const next = cleanCore({ ...cur, ...(patch ?? {}) });
  return { ...next, t: Math.round(t), prev: S ? cur : null };
}

/* ---------------------------------------------------------------- the schedule */

/** The storm's activity at shared ms t: a slow wave of lulls and bursts (0.3 .. 2.4, mean ~1). */
export function activity(seed, t) {
  const x = t / ACT_MS, k = Math.floor(x), f = x - k, e = f * f * (3 - 2 * f);
  const v = hash3(seed, k, 0x51a7) * (1 - e) + hash3(seed, k + 1, 0x51a7) * e;
  return 0.3 + 2.1 * v * v;
}

/** The chance of each kind at a closeness `near` (0 distant .. 1 overhead): [far, mid, close]. */
export function kindShares(near) {
  const c = 0.05 + 0.45 * near, m = 0.25 + 0.15 * near;
  return [1 - c - m, m, c];
}

/**
 * The flash of slot k (or null): `rainP(t)` = the rain's presence at shared ms t (0..1, the world's, not a client's caps).
 * -> { k, t, kind, I (peak light 0..1), at: { u, v } (close: a point of the scene, as shares of its rect) | { a, d } (far / mid: an
 *   angle from the scene's centre and a distance in half-diagonals), R (the light's reach: squares for close, half-diagonals
 *   else), amb (the share of the light everywhere), pulses [{ dt, a, rise, dec }] (far / mid), seed, lv, bolt, dir, end (ms after t) }
 */
export function flashOf(S, seed, k, rainP) {
  const h = (i) => hash3(seed ^ 0x57042, k, i);
  const te = k * SLOT + Math.floor(h(1) * SLOT * 0.85);
  const C = settingsAt(S, te);
  if ( !C?.on ) return null;
  const p = Math.min(1, Math.max(0, Number(rainP(te)) || 0));
  if ( p <= 0.02 ) return null;
  const prob = Math.min(0.85, (C.rate / 60) * (SLOT / 1000) * activity(seed, te) * ss(p * 1.25));
  if ( h(0) >= prob ) return null;
  const [fs, ms] = kindShares(C.near), u = h(2);
  return makeFlash(C, seed, k, te, u < fs ? "far" : u < fs + ms ? "mid" : "close");
}

/** A flash of a given kind at shared ms te (slot k) with the settings C: its look (flashOf's, or a GM's local preview). */
export function makeFlash(C, seed, k, te, kind) {
  const h = (i) => hash3(seed ^ 0x57042, k, i);
  const pw = 0.4 + 0.6 * C.power, var_ = 0.75 + 0.25 * h(3);
  const ev = { k, t: te, kind, seed: Math.floor(h(9) * 0x7fffffff) >>> 0, bolt: false, lv: 0, dir: null };
  if ( kind === "close" ) {
    ev.I = 1.0 * pw * var_;
    ev.at = { u: 0.08 + 0.84 * h(4), v: 0.08 + 0.84 * h(5) };
    ev.R = 7 + 5 * h(6); ev.amb = 0.42;
    ev.lv = 1 + Math.floor(h(7) * 3);
    ev.bolt = C.bolts;
    const an = h(8) * 6.283; ev.dir = [Math.round(Math.cos(an) * 100) / 100, Math.round(Math.sin(an) * 100) / 100];
    const T = strikeTiming(ev.seed, ev.lv);
    ev.strokes = T.strokes;
    ev.end = T.last + 1900;
  } else {
    const far = kind === "far";
    ev.I = (far ? 0.4 : 0.7) * pw * var_;
    ev.at = { a: h(4) * 6.283, d: far ? 1.2 + 0.7 * h(5) : 0.55 + 0.5 * h(5) };
    ev.R = ev.at.d + (far ? 0.9 : 0.6); ev.amb = far ? 0.3 : 0.25;
    const n = far ? 2 + Math.floor(h(6) * 4) : 1 + Math.floor(h(6) * 3), pulses = [];
    let dt = 0;
    for ( let i = 0; i < n; i++ ) {
      const hi = (j) => hash3(ev.seed, i, j);
      if ( i ) dt += Math.round(far ? 60 + 120 * hi(1) : 50 + 110 * hi(1));
      pulses.push({ dt, a: i === 0 ? 1 : Math.round((far ? 0.4 + 0.6 * hi(2) : 0.55 + 0.4 * hi(2)) * 100) / 100,
        rise: Math.round(far ? 45 + 50 * hi(3) : 18 + 20 * hi(3)), dec: Math.round(far ? 130 + 100 * hi(4) : 100 + 80 * hi(4)) });
    }
    ev.pulses = pulses;
    ev.end = Math.round(Math.max(...pulses.map((q) => q.dt + q.rise + q.dec * GLOW * 4.5)));
  }
  ev.end = Math.min(ev.end, SPAN[1]);
  return ev;
}

/** The flashes that show any light in [t0, t1] (shared ms), in time order. */
export function flashes(S, seed, t0, t1, rainP) {
  const out = [];
  if ( !S || (!S.on && !S.prev?.on) ) return out;
  for ( let k = Math.floor((t0 - SPAN[1]) / SLOT); k <= Math.floor((t1 - SPAN[0]) / SLOT); k++ ) {
    const ev = flashOf(S, seed, k, rainP);
    if ( ev && ev.t + SPAN[0] <= t1 && ev.t + ev.end >= t0 ) out.push(ev);
  }
  return out;
}

/* ---------------------------------------------------------------- the light */

/** A stroke's light: full for a frame, then an exponential fall (dec ms), with the slow afterglow. */
const stroke = (x, dec) => (x < 0 ? 0 : (x < 17 ? 1 : Math.exp(-(x - 17) / dec)) * (1 - AFTER) + AFTER * Math.exp(-x / 420));
/** The close strike's sky flickers before it (the leader lighting the cloud): [ms, strength]. */
export const PRE = [[-760, 0.16], [-560, 0.24], [-140, 0.1]];

/** A flash's light at `t` ms from its time (0..~1.3, times its I). */
export function lightAt(ev, t) {
  let L = 0;
  if ( ev.kind === "close" ) {
    for ( const [ts, a] of PRE ) { const x = t - ts; if ( x >= 0 && x < 110 ) L = Math.max(L, a * (x < 30 ? x / 30 : 1 - (x - 30) / 80)); }
    // (each restroke re-lights the land; their afterglows overlap: the brightest carries, the rest add a little)
    let mx = 0, sum = 0;
    for ( const s of ev.strokes ) { const v = s.a * stroke(t - s.t, 110); mx = Math.max(mx, v); sum += v; }
    L = Math.max(L, mx + 0.3 * (sum - mx));
  } else {
    // (the flickers of one cell overlap: the brightest carries, the others add a little - never a sum that runs away)
    let mx = 0, sum = 0;
    for ( const P of ev.pulses ) {
      const x = t - P.dt; if ( x < 0 ) continue;
      const v = P.a * (x < P.rise ? ss(x / P.rise) : (1 - AFTER) * Math.exp(-(x - P.rise) / P.dec) + AFTER * Math.exp(-(x - P.rise) / (P.dec * GLOW)));
      mx = Math.max(mx, v); sum += v;
    }
    L = mx + 0.25 * (sum - mx);
  }
  return L * ev.I;
}

/**
 * THE STORM'S GLOOM at shared ms `now`: how much the storm darkens the land (0..~0.2), so its flashes read by day: it fades in over
 * GLOOM_MS after a switch-on and out after a switch-off, follows the rain's presence and is deeper for a storm overhead than a distant
 * one. 0 when the lightning is off (and after its fade).
 */
export const GLOOM_MS = 6000;
export function gloomAt(S, now, rainP) {
  if ( !S ) return 0;
  const f = Math.min(1, Math.max(0, (now - S.t) / GLOOM_MS)), e = f * f * (3 - 2 * f);
  // (from the settings before the change to the new ones: a switch or a distance slider glides, never jumps)
  const amt = (C) => (C?.on ? 0.07 + 0.11 * C.near : 0), g = amt(S.prev) * (1 - e) + amt(S) * e;
  if ( g <= 0 ) return 0;
  return g * ss(Math.min(1, Math.max(0, Number(rainP(now)) || 0)) * 1.25);
}

/** The same flash for a client with no flashes / reduced motion: one slow faint swell (0.4 s up, 1.1 s down), no flicker. */
export const CALM = { k: 0.3, up: 400, down: 1100 };
export function calmAt(ev, t) {
  const e = t < 0 ? 0 : t < CALM.up ? ss(t / CALM.up) : 1 - ss((t - CALM.up) / CALM.down);
  return e * ev.I * CALM.k;
}

/** Where a flash's light comes from, in scene px: { x, y, R (px), amb }; `rect` the scene rect, `grid` px per square. */
export function placeOf(ev, rect, grid) {
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2, hd = Math.hypot(rect.width, rect.height) / 2;
  if ( ev.kind === "close" ) return { x: rect.x + ev.at.u * rect.width, y: rect.y + ev.at.v * rect.height, R: ev.R * grid, amb: ev.amb };
  return { x: cx + Math.cos(ev.at.a) * ev.at.d * hd, y: cy + Math.sin(ev.at.a) * ev.at.d * hd, R: ev.R * hd, amb: ev.amb };
}
