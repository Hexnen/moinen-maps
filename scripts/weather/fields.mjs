import { hu } from "../wind.mjs";

/**
 * The ground fields whose SHARE OF THE LAND is a level parameter (snow cover 10 / 42 %, sand drifts 5 / 12 / 18 %): the shader draws a
 * cell where its score is over a threshold, and the threshold that gives the wanted share is a quantile of the score over the
 * scene's land. The scores are the shader's exact formulas (glsl.mjs `snowScore`, `driftScore`) on the same integer hash and value
 * noise, evaluated here on a fixed sample of land cells (from the ground info), so the share is right on every map. Pure (no
 * Foundry): node-tested. Computed once per scene (snow) or per wind direction (drifts), never per frame.
 */

export function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hu(ix, iy, s), b = hu(ix + 1, iy, s), c = hu(ix, iy + 1, s), d = hu(ix + 1, iy + 1, s);
  const m0 = a + (b - a) * ux, m1 = c + (d - c) * ux;
  return m0 + (m1 - m0) * uy;
}
const rot = (x, y, c, s) => [c * x - s * y, s * x + c * y];
export function fbm2(x, y, s) {
  // (GLSL: mat2(0.9563, 0.2924, -0.2924, 0.9563) * p is column-major: x' = 0.9563 x - 0.2924 y, y' = 0.2924 x + 0.9563 y)
  const [qx, qy] = rot(x, y, 0.9563, 0.2924);
  return (vnoise(x, y, s) + 0.5 * vnoise(qx * 2.17 + 17.3, qy * 2.17 - 9.1, s + 1)) / 1.5;
}
export function fbm3(x, y, s) {
  const [qx, qy] = rot(x, y, 0.9563, 0.2924), [rx, ry] = rot(x, y, 0.7547, 0.6561);
  return (vnoise(x, y, s) + 0.5 * vnoise(qx * 2.17 + 17.3, qy * 2.17 - 9.1, s + 1) + 0.25 * vnoise(rx * 4.71 - 31.7, ry * 4.71 + 5.3, s + 2)) / 1.75;
}
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The snow's score at art cell (x, y) with its map lum and contrast (glsl.mjs snowScore). */
export function snowScore(x, y, lum, con, seed) {
  const warp = fbm2(x / 31, y / 31, seed + 41);
  const n = fbm3(x / 19 + 4 * warp, y / 19 - 3 * warp, seed + 42);
  const flat = 1 - ss(0.02, 0.14, con), fine = fbm2(x / 6.3, y / 6.3, seed + 44);
  return 0.42 * n + 0.22 * fine + 0.26 * flat + 0.13 * lum + (vnoise(x / 2.0, y / 2.0, seed + 43) - 0.5) * 0.1;
}
/** Settled sand in the lee at art cell (x, y), wind unit vector (dx, dy) (glsl.mjs driftScore). */
export function driftScore(x, y, con, seed, dx, dy) {
  const pr = x * dx + y * dy, ac = -x * dy + y * dx;
  const n = fbm3(pr / 30 + 2 * fbm2(x / 50, y / 50, seed + 3), ac / 9, seed + 101);
  return 0.6 * n + 0.4 * (1 - ss(0.02, 0.12, con));
}

/**
 * A fixed sample of land cells from ground-info rgba (texel grid w x h, `scale` art cells per texel): [{ x, y, lum, con }]
 * (painted water excluded, as in the shader).
 */
export function landSample(px, w, h, scale, n = 3000) {
  const out = [];
  for ( let i = 0, tries = 0; out.length < n && tries < n * 6; tries++, i++ ) {
    const tx = Math.floor(hu(i, 1, 9001) * w), ty = Math.floor(hu(i, 2, 9001) * h), o = (ty * w + tx) * 4;
    const r = px[o] / 255, g = px[o + 1] / 255, b = px[o + 2] / 255, lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if ( b > r + 0.04 && lum < 0.36 ) continue;
    out.push({ x: tx * scale + Math.floor(hu(i, 3, 9001) * scale) + 0.5, y: ty * scale + Math.floor(hu(i, 4, 9001) * scale) + 0.5, lum, con: px[o + 3] / 255 * 0.25 });
  }
  return out;
}

/** The threshold over which `share` (0..1) of the scores lie. */
export function quantileThr(sorted, share) {
  if ( !sorted.length || share <= 0 ) return 9;
  if ( share >= 1 ) return -9;
  const f = (1 - share) * (sorted.length - 1), i = Math.floor(f), a = sorted[i], b = sorted[Math.min(sorted.length - 1, i + 1)];
  return a + (b - a) * (f - i);
}
export const sortedScores = (sample, fn) => Float64Array.from(sample.map(fn)).sort();
