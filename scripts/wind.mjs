/**
 * THE SCENE WIND: one wind field for every layer that moves with the air (weather: rain, snow, grit, dust, embers, wind lines;
 * fire: lean and plume). The weather engine REGISTERS the scene's base wind (its timeline, scene flags); fire READS it, so a fire
 * stroke that follows the scene wind leans with the weather. Gusts are a pure function of the shared clock and the place, so every
 * client and every layer sees the same gust at the same moment, with no per-frame CPU work or network traffic:
 *
 *   W(x, t) = base dir x str x factor(G(t - (x . dir) / GUST_SPEED))
 *   G(t)    = the GUST ENVELOPE: hashed gust events every 9 s (62 % of them blow), each building over 2-4 s (smoothstep) and dying over
 *             3-6 s (exponential): an asymmetric attack / decay; plus a 0.6 Hz and a 0.39 Hz flutter and a 0.017 Hz swell. It travels
 *             along the wind at GUST_SPEED, so a gust front crosses the map visibly.
 *   factor  (1 - gust) + gust x (0.35 + 0.95 G): `gust` 0 = a steady wind, 1 = the full gusty look (calm lulls, strong gusts).
 *
 * Every term is a whole number of cycles per hour (the shader's time runs mod 3600 s), so the hour wrap is seamless.
 * GLSL_WIND is the same function for shaders (identical integer hash: GLSL uint arithmetic wraps like Math.imul).
 *
 * Units: dir in degrees on screen (0 = right, 90 = down: the same as fire's `wd`), str 0..1 (fire's `ws`), positions in grid
 * squares, time in seconds. SPEED_SQ = squares per second at str 1.
 * This file imports nothing (node-tested).
 */
export const HOUR = 3600;
export const GUST_PERIOD = 9;            // s per gust slot (400 per hour)
export const GUST_SPEED = 4;             // squares / s a gust front travels
export const SPEED_SQ = 4;               // squares / s at str 1
export const WIND_DEFAULT = Object.freeze({ dir: 0, str: 0, gust: 0.5 });

/** The integer hash shared with the shaders (x, y, seed: integers) -> [0, 1). */
export function hu(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const NG = HOUR / GUST_PERIOD;

/** The gust envelope at time t (s, any real; periodic in an hour): about 0 (lull) .. 1.2 (a strong gust). */
export function gustEnv(t, seed = 0) {
  t = ((t % HOUR) + HOUR) % HOUR;
  const j0 = Math.floor(t / GUST_PERIOD);
  let g = 0;
  for ( let k = 0; k <= 3; k++ ) {
    const j = j0 - k, jj = ((j % NG) + NG) % NG;
    if ( hu(jj, 1, seed + 41) >= 0.62 ) continue;
    const start = j * GUST_PERIOD + hu(jj, 2, seed + 41) * 4.5, A = 2 + 2 * hu(jj, 3, seed + 41), D = 3 + 3 * hu(jj, 4, seed + 41);
    const amp = 0.55 + 0.45 * hu(jj, 5, seed + 41), d = t - start;
    if ( d < 0 ) continue;
    g += amp * (d < A ? ss(0, A, d) : Math.exp(-(d - A) * 2.3 / D));
  }
  const w = TAU / HOUR;
  return Math.min(1.2, g) + 0.06 * Math.sin(2160 * w * t + 1.3) + 0.04 * Math.sin(1404 * w * t + 0.4) + 0.12 * Math.sin(61 * w * t + 2.0);
}

/** The wind's unit direction for `dir` degrees. */
export const dirVec = (dir) => { const a = (Number(dir) || 0) * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; };

/** The gust at a place (squares) and time (s): the envelope delayed by the time the front needs to get there. */
export function gustAt(w, x, y, t, seed = 0) {
  const [dx, dy] = dirVec(w.dir);
  return gustEnv(t - (x * dx + y * dy) / GUST_SPEED, seed);
}

/** How strong the wind blows for a gust value G: 1 = the base strength. */
export const factor = (G, gust) => (1 - gust) + gust * (0.35 + 0.95 * G);

/** The wind vector at a place (squares) and time (s): [wx, wy] in units of str (0..~1.4), and the gust value. */
export function windVecAt(w, x, y, t, seed = 0) {
  if ( !w || !(w.str > 0) ) return { x: 0, y: 0, g: 0 };
  const G = gustAt(w, x, y, t, seed), f = factor(G, w.gust ?? 0.5) * w.str, [dx, dy] = dirVec(w.dir);
  return { x: dx * f, y: dy * f, g: G };
}

/* ---------------------------------------------------------------- the provider (weather registers, fire reads) */

let provider = null;
/** The weather engine registers `fn() -> { dir, str, gust } | null` (the scene's resolved base wind now); null unregisters. */
export function setWindProvider(fn) { provider = typeof fn === "function" ? fn : null; }
/** The scene's base wind now (null when no weather wind is set: layers keep their own). */
export function sceneWind() { try { const w = provider?.(); return w && w.str > 0 ? w : null; } catch { return null; } }

/* ---------------------------------------------------------------- tornado vortices (weather registers, fire and weather read) */

let vortexProvider = null;
/**
 * The weather engine registers `fn() -> [{ x, y (squares), R, r0, w, inflow, p }]`: the scene's tornadoes now (tornado-model.mjs
 * `vortices`, a pure function of the stored paths and the shared clock); the wind they add is tornado-model `vortexWind`.
 */
export function setVortexProvider(fn) { vortexProvider = typeof fn === "function" ? fn : null; }
/** The tornado vortices now ([] when there are none: the common case costs one call). */
export function vortices() { try { return vortexProvider?.() ?? []; } catch { return []; } }
const vSmooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
/**
 * THE VORTEX WIND (research 3.2 "Interaction"): what the tornado adds to the scene wind at a point, in squares / s: a tangential
 * swirl Gamma / (2 pi max(d, r0)) and an inflow toward the base, both fading out beyond R squares. It turns COUNTER-CLOCKWISE on the
 * map (north up, as a northern-hemisphere tornado seen from above): on screen (y down) the angle atan2(dy, dx) DEcreases (SPIN = -1).
 * `v` = { x, y (squares), R, w (tangential speed at r0, squares / s), r0, inflow, p }.
 */
export const SPIN = -1;
export function vortexWind(v, x, y) {
  const dx = x - v.x, dy = y - v.y, d = Math.hypot(dx, dy);
  if ( !(d < v.R) || d < 1e-6 ) return [0, 0];
  const fall = 1 - vSmooth((d - v.R * 0.45) / (v.R * 0.55));
  const tang = v.w * v.r0 / Math.max(d, v.r0) * fall * v.p, inn = v.inflow * fall * v.p * Math.min(1, d / v.r0);
  return [(dy / d) * tang - (dx / d) * inn, (-dx / d) * tang - (dy / d) * inn];
}
/** The wind all the scene's tornadoes add at scene px x, y now: [x, y] squares / s ([0, 0] when there are none). */
export function vortexWindAt(x, y, grid) {
  const list = vortices(); if ( !list.length ) return [0, 0];
  let vx = 0, vy = 0;
  for ( const v of list ) { const [a, b] = vortexWind(v, x / grid, y / grid); vx += a; vy += b; }
  return [vx, vy];
}

/* ---------------------------------------------------------------- the same in GLSL (ES 3.00) */

export const GLSL_WIND = `
float hu(int x, int y, int s) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(s) * 1274126177u;
  h = (h ^ (h >> 13u)) * 1103515245u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}
float gustEnv(float t, int seed) {
  t = mod(t, ${HOUR.toFixed(1)});
  float j0 = floor(t / ${GUST_PERIOD.toFixed(1)});
  float g = 0.0;
  for ( int k = 0; k <= 3; k++ ) {
    float j = j0 - float(k);
    int jj = int(mod(j, ${NG.toFixed(1)}));
    if ( hu(jj, 1, seed + 41) >= 0.62 ) continue;
    float st = j * ${GUST_PERIOD.toFixed(1)} + hu(jj, 2, seed + 41) * 4.5, A = 2.0 + 2.0 * hu(jj, 3, seed + 41), D = 3.0 + 3.0 * hu(jj, 4, seed + 41);
    float amp = 0.55 + 0.45 * hu(jj, 5, seed + 41), d = t - st;
    if ( d < 0.0 ) continue;
    g += amp * (d < A ? smoothstep(0.0, A, d) : exp(-(d - A) * 2.3 / D));
  }
  float w = 6.283185307 / ${HOUR.toFixed(1)};
  return min(1.2, g) + 0.06 * sin(2160.0 * w * t + 1.3) + 0.04 * sin(1404.0 * w * t + 0.4) + 0.12 * sin(61.0 * w * t + 2.0);
}
// p in squares; uWindDir unit vector; returns the gust value
float gustAt(vec2 p, vec2 dir, float t, int seed) { return gustEnv(t - dot(p, dir) / ${GUST_SPEED.toFixed(1)}, seed); }
float windFactor(float G, float gust) { return (1.0 - gust) + gust * (0.35 + 0.95 * G); }
`;
