/**
 * TORNADOES, the pure model (no Foundry, no PIXI: node-tested in dev/weather-tornado.test.mjs).
 *
 * A tornado is its own weather OBJECT, not a preset (research 3.2, D18): it has a place, a path drawn by the GM, a speed, a size and
 * its own level 1..3. The scene stores at most MAX_TORNADOES of them in the weather flag (`flags.moinen-maps.weather.tornadoes`):
 *
 *   { id, path: [[x, y], ...] (scene px, simplified), t0 (shared ms: it starts forming), speed (squares / s), wander (squares),
 *     size (x), level 1..3, lv0 (the level before the last change), lvT (shared ms of that change), end: "loop" | "stop" | "ropeOut",
 *     out (shared ms: the GM sent it away, it ropes out; null), damage (false: D20, off by default), seed }
 *
 * EVERYTHING ELSE IS A PURE FUNCTION of that record and the shared clock, so every client draws the same tornado at the same place
 * with nothing sent per frame:
 *   - the base moves along the smoothed path (Chaikin corners, arc length), speeding up from rest over ACCEL_S; "loop" goes back and
 *     forth with a slow turn at each end, "stop" brakes to a halt at the end, "ropeOut" brakes and ropes out there;
 *   - a WANDER of incommensurate sines is added, so it never follows the line exactly;
 *   - PRESENCE: it forms over FORM_MS from t0 (the cloud first, then the funnel lowers and touches down), and ropes out over ROPE_MS
 *     from `out` (or from its arrival with "ropeOut"); `phase()` splits that into the parts the display needs;
 *   - its LEVEL ramps over LEVEL_MS after a change (level continuum s = level - 1, as the weather's levels).
 */
export const MAX_TORNADOES = 3;
export const FORM_MS = 7000;
export const ROPE_MS = 6500;
export const LEVEL_MS = 5000;
export const ACCEL_S = 2.5;
export const LIMITS = { speed: [0.1, 2], wander: [0, 2], size: [0.5, 1.6] };
export const DEFAULTS = Object.freeze({ speed: 0.6, wander: 0.35, size: 1, level: 2, end: "loop" });
export const ENDS = ["loop", "stop", "ropeOut"];

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const lvl = (v, d = 2) => { const n = Math.round(Number(v)); return n >= 1 && n <= 3 ? n : d; };
const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** A string's 31-bit hash (seeds). */
export function hashStr(s) { let h = 2166136261; for ( const ch of String(s) ) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 2147483647; }

/** Ramer-Douglas-Peucker: drop points closer than `tol` to the line through their neighbours. */
export function simplify(pts, tol) {
  if ( pts.length < 3 ) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while ( stack.length ) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bi = -1;
    for ( let i = a + 1; i < b; i++ ) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if ( d > best ) { best = d; bi = i; }
    }
    if ( best > tol ) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A clean path: [[x, y], ...] scene px, rounded, consecutive duplicates dropped, at most 64 points (simplified further if longer). */
export function cleanPath(raw, tol = 4) {
  let pts = (Array.isArray(raw) ? raw : []).map((p) => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p?.x), Number(p?.y)])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [Math.round(p[0]), Math.round(p[1])]);
  pts = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if ( pts.length > 2 ) pts = simplify(pts, tol);
  let t = tol;
  while ( pts.length > 64 ) { t *= 1.6; pts = simplify(pts, t); }
  return pts;
}

export function cleanTornado(r) {
  if ( !r || typeof r !== "object" ) return null;
  const path = cleanPath(r.path, 0.5);
  if ( !path.length || !Number.isFinite(Number(r.t0)) ) return null;
  const id = typeof r.id === "string" && /^[\w-]{1,32}$/.test(r.id) ? r.id : null; if ( !id ) return null;
  const level = lvl(r.level, DEFAULTS.level);
  return {
    id, path, t0: Math.round(Number(r.t0)),
    speed: num(r.speed, ...LIMITS.speed, DEFAULTS.speed), wander: num(r.wander, ...LIMITS.wander, DEFAULTS.wander), size: num(r.size, ...LIMITS.size, DEFAULTS.size),
    level, lv0: lvl(r.lv0, level), lvT: Number.isFinite(Number(r.lvT)) ? Math.round(Number(r.lvT)) : Math.round(Number(r.t0)),
    end: ENDS.includes(r.end) ? r.end : DEFAULTS.end, out: Number.isFinite(Number(r.out)) && r.out !== null ? Math.round(Number(r.out)) : null,
    damage: r.damage === true, seed: Math.round(num(r.seed, 1, 2147483646, hashStr(id) || 1))
  };
}

/** The scene's tornadoes, cleaned (at most MAX_TORNADOES, the newest kept). */
export function cleanTornadoes(list) {
  const out = (Array.isArray(list) ? list : []).map(cleanTornado).filter(Boolean);
  const seen = new Set();
  return out.filter((t) => !seen.has(t.id) && seen.add(t.id)).sort((a, b) => a.t0 - b.t0).slice(-MAX_TORNADOES);
}

/* ---------------------------------------------------------------- the path */

const PATHS = new Map();
/** The smoothed path (Chaikin, 3 rounds; the ends kept) with its cumulative length: { pts, cum, L }. Cached by content. */
export function smoothPath(path) {
  const key = path.map((p) => p.join(",")).join(";");
  let P = PATHS.get(key);
  if ( P ) return P;
  let pts = path.map((p) => [p[0], p[1]]);
  for ( let r = 0; r < 3 && pts.length > 2; r++ ) {
    const nx = [pts[0]];
    for ( let i = 0; i < pts.length - 1; i++ ) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      if ( i > 0 ) nx.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
      if ( i < pts.length - 2 ) nx.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    nx.push(pts[pts.length - 1]);
    pts = nx;
  }
  const cum = [0];
  for ( let i = 1; i < pts.length; i++ ) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  P = { pts, cum, L: cum[cum.length - 1] };
  if ( PATHS.size > 32 ) PATHS.clear();
  PATHS.set(key, P);
  return P;
}

/** The point at distance s along a smoothed path. */
export function along(P, s) {
  const { pts, cum, L } = P;
  if ( pts.length === 1 || L <= 0 ) return [pts[0][0], pts[0][1]];
  s = Math.min(L, Math.max(0, s));
  let lo = 0, hi = cum.length - 1;
  while ( hi - lo > 1 ) { const m = (lo + hi) >> 1; if ( cum[m] <= s ) lo = m; else hi = m; }
  const f = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
}

/** Distance the base would have gone at constant speed, from rest (accelerating over ACCEL_S): px after e seconds at v px / s. */
const travelled = (e, v) => e <= 0 ? 0 : e < ACCEL_S ? v * e * e / (2 * ACCEL_S) : v * (e - ACCEL_S / 2);
/** The inverse: seconds to have gone d px. */
const timeFor = (d, v) => d <= v * ACCEL_S / 2 ? Math.sqrt(2 * ACCEL_S * d / v) : d / v + ACCEL_S / 2;
/** The braking distance at the end of a "stop" / "ropeOut" path (px). */
const brakeOf = (L, grid) => Math.min(L / 3, grid * 1.2);

/**
 * Where the path's end is reached (shared ms) for "stop" / "ropeOut", else null.
 */
export function arrival(T, grid) {
  if ( T.end === "loop" ) return null;
  const P = smoothPath(T.path), v = T.speed * grid;
  if ( P.L <= 0 ) return null;
  const b = brakeOf(P.L, grid);
  return T.t0 + 1000 * timeFor(P.L + b, v);
}

/** The distance along the path at elapsed seconds e (the GM's end behaviour applied). */
export function distAt(T, e, grid) {
  const P = smoothPath(T.path), v = T.speed * grid, L = P.L;
  if ( L <= 0 ) return 0;
  const d = travelled(e, v);
  if ( T.end === "loop" ) {
    const u = d / L, leg = Math.floor(u), f = u - leg, g = (1 - Math.cos(Math.PI * f)) / 2;
    return (leg % 2 === 0 ? g : 1 - g) * L;
  }
  const b = brakeOf(L, grid);
  if ( d <= L - b ) return d;
  const x = Math.min(2 * b, d - (L - b));
  return L - b + x - x * x / (4 * b);
}

/** The wander offset (scene px) at elapsed seconds e. */
export function wanderAt(T, e, grid) {
  const w = T.wander * grid, s = T.seed;
  const ph = (k) => ((s * (k + 3) * 2654435761) >>> 0) / 4294967296 * 6.2832;
  return [w * (0.6 * Math.sin(0.41 * e + ph(1)) + 0.3 * Math.sin(1.07 * e + ph(2)) + 0.1 * Math.sin(2.31 * e + ph(3))),
    w * (0.6 * Math.sin(0.37 * e + ph(4)) + 0.3 * Math.sin(0.93 * e + ph(5)) + 0.1 * Math.sin(2.67 * e + ph(6)))];
}

/** THE BASE at shared ms `now`: [x, y] scene px (path + wander). Before t0 it waits at the start. */
export function baseAt(T, now, grid) {
  const e = Math.max(0, (now - T.t0) / 1000), P = smoothPath(T.path);
  const [x, y] = along(P, distAt(T, e, grid)), [wx, wy] = wanderAt(T, e, grid);
  return [x + wx, y + wy];
}

/** The base's velocity (scene px / s) and its smoothed acceleration (px / s^2, over +-h s). */
export function motionAt(T, now, grid, h = 0.4) {
  const a = baseAt(T, now - 50, grid), b = baseAt(T, now + 50, grid);
  const p0 = baseAt(T, now - h * 1000, grid), p1 = baseAt(T, now, grid), p2 = baseAt(T, now + h * 1000, grid);
  return { vx: (b[0] - a[0]) / 0.1, vy: (b[1] - a[1]) / 0.1, ax: (p0[0] - 2 * p1[0] + p2[0]) / (h * h), ay: (p0[1] - 2 * p1[1] + p2[1]) / (h * h) };
}

/** When it starts roping out (shared ms) or null: the GM sent it away, or it arrived ("ropeOut"). */
export function outAt(T, grid) {
  const a = T.end === "ropeOut" ? arrival(T, grid) : null;
  if ( T.out !== null && a !== null ) return Math.min(T.out, a);
  return T.out ?? a;
}

/**
 * PRESENCE at shared ms `now`: { p (0..1 overall), cloud (the storm deck), reach (0..1: how far the funnel has lowered toward the
 * ground), touch (0..1: on the ground, the debris), rope (0..1: roping out, thin and broken), gone (finished for good) }.
 */
export function phase(T, now, grid) {
  const fin = (now - T.t0) / FORM_MS;
  const o = outAt(T, grid), r = o === null ? 0 : Math.max(0, (now - o) / ROPE_MS);
  const formed = smooth(fin), out = Math.min(1, r);
  const cloud = smooth(fin / 0.35) * (1 - smooth((r - 0.55) / 0.45));
  const reach = smooth((fin - 0.2) / 0.55) * (1 - smooth((r - 0.45) / 0.5));
  const touch = smooth((fin - 0.62) / 0.38) * (1 - smooth(r / 0.5));
  return { p: formed * (1 - smooth(r)), cloud, reach, touch, rope: smooth(out / 0.6), gone: r >= 1, forming: fin < 1 };
}

/** The level continuum s (0..2) at shared ms `now` (a change ramps over LEVEL_MS). */
export function levelS(T, now) {
  const f = smooth((now - T.lvT) / LEVEL_MS);
  return T.lv0 - 1 + (T.level - T.lv0) * f;
}

/** One value of a level table [L1, L2, L3] at s (piecewise linear). */
export function lv(table, s) {
  const [a, b, c] = table;
  if ( s <= 0 ) return a; if ( s >= 2 ) return c;
  return s < 1 ? a + (b - a) * s : b + (c - b) * (s - 1);
}

/**
 * THE LEVEL TABLE (per level 1 / 2 / 3; lengths in art px at 32 per square, x size): levels differ in kind, not only in amount -
 * 1 a thin rope from a light deck, a little dust, no thrown fragments, no curtain; 2 a cone with a debris cloud, fragments, feeder
 * bands; 3 a wedge in a dark storm deck with a rain curtain, lightning, a violent skirt and big fragments.
 */
export const TABLE = {
  Z: [210, 240, 262],               // funnel height (cloud base)
  r0: [2.6, 6.5, 15],               // core radius just above the foot
  rMid: [3.8, 10, 22],              // ... at mid height
  rTop: [17, 27, 40],               // ... where it flares into the wall cloud
  foot: [5, 11, 20],                // the foot's swell (x touchdowns)
  snake: [1.5, 1, 0.75],            // rope snaking (x the wave amplitudes)
  dust: [0.15, 0.55, 0.75],         // how dusty (brown) the lower funnel is
  deckR: [70, 115, 160],            // storm deck radius
  deckD: [0.45, 0.75, 1],           // deck density
  deckDark: [0.2, 0.55, 1],         // deck darkness (0 light grey .. 1 storm)
  feed: [0, 0.7, 1],                // feeder bands
  wallR: [22, 34, 50],              // wall cloud radius
  skirt: [26, 52, 82],              // the dust skirt on the ground (radius)
  puffs: [14, 48, 90],              // debris-cloud puffs at the foot
  puffR: [3, 4.5, 6],               // their radius
  puffH: [10, 20, 30],              // how high the debris cloud billows
  specks: [24, 80, 150],            // fine debris orbiting the funnel
  frags: [0, 14, 30],               // map fragments torn out (slots)
  fragSz: [4, 7, 10],               // their size (art px, before the size x)
  planks: [0, 4, 10],
  clumps: [10, 36, 70],             // sprayed dust clumps
  inflow: [24, 70, 120],            // ground streaks dragged in
  wisps: [6, 20, 34],               // torn wisps peeling off the funnel
  curtain: [0, 0.35, 1],            // rain curtain behind
  flash: [0, 0, 1],                 // lightning in the deck
  storm: [0.93, 0.8, 0.66],         // storm light on the ground (multiply)
  swirlR: [2.5, 4.5, 7],            // the vortex wind reaches this far (squares)
  spin: [0.9, 1.1, 1.25]            // spin rate (x)
};
/** All of the table at s: { key: value }. */
export function looks(s) { const o = {}; for ( const [k, t] of Object.entries(TABLE) ) o[k] = lv(t, s); return o; }

export { vortexWind, SPIN } from "../wind.mjs";

/** The vortices of the scene's tornadoes at shared ms `now` (for wind.mjs): squares, only the ones present. */
export function vortices(list, now, grid) {
  const out = [];
  for ( const T of list ?? [] ) {
    const ph = phase(T, now, grid); if ( ph.gone || ph.p <= 0.001 ) continue;
    const s = levelS(T, now), [x, y] = baseAt(T, now, grid);
    out.push({ id: T.id, x: x / grid, y: y / grid, R: lv(TABLE.swirlR, s) * T.size, r0: 0.6 * T.size, w: 5 + 3 * s, inflow: 0.8 + 0.6 * s, p: ph.touch * 0.7 + ph.p * 0.3, s });
  }
  return out;
}
