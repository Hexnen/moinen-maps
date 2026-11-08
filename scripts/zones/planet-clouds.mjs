/**
 * The Orbit planet's clouds, drifting: the visible part of the planet's disc as a small RGBA buffer at art resolution, repainted for a
 * cloud phase (how far the clouds have turned around the planet, in the sphere's u). The surface under the clouds is the picture's own
 * (space.mjs planetSurface: the same colours, light, terminator, ice, cities, haze, limb line), so the layer lies exactly over the
 * baked planet and covers its baked clouds - they are never doubled. The clouds move along the sphere's longitude, so they follow its
 * curve: fastest across the middle of the cap, squeezed and slow towards the limb, and dimmed as they cross into the night.
 *
 * Cheap to repaint: everything fixed is computed once per pixel (its base colour, its colour in a cloud's shadow, its light factor);
 * the cloud field is read from a table over the sphere's (u, v) filled a column at a time as the clouds move (bilinear, a fraction of
 * the field's finest feature apart), so a repaint is two table reads per pixel and no noise. Pure JS (node tests run it).
 */
import { rng, makeNoise, planetSurface, PALETTES, SHADOW_DU, SHADOW_DV, CLOUD_T } from "./space.mjs";

const rgba = (c) => (c[0] | (c[1] << 8) | (c[2] << 16) | (255 << 24)) >>> 0;

/**
 * @param {number} seed       the picture's seed
 * @param {number} w          the picture's width in art px
 * @param {number} h          the picture's height in art px
 * @param {{cx:number, cy:number, R:number, lo:number}} planet   where the picture put its planet (paintSpace's lastLayout.planet)
 * @param {{du?:number, dv?:number, exact?:boolean}} [opts]  table spacing in u / v; exact = read the noise itself (tests)
 * @returns {{x0:number, y0:number, cw:number, ch:number, data:Uint8Array, pixels:number, pxPerPhase:number, paint:(phase:number)=>number}}
 *   data: RGBA (cw x ch, at art px x0, y0 of the picture; transparent outside the disc); paint returns how many pixels changed.
 */
export function cloudLayer(seed, w, h, planet, { du = 0.009, dv = 0.004, exact = false } = {}) {
  const { fbm, noise } = makeNoise(rng(seed));
  const { cx, cy, R, lo } = planet;
  const P = planetSurface({ fbm, noise, cx, cy, R, lo });
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(w, Math.ceil(cx + R) + 1);
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(h, Math.ceil(cy + R) + 1);
  const cw = Math.max(1, x1 - x0), ch = Math.max(1, y1 - y0);
  const data = new Uint8Array(cw * ch * 4), d32 = new Uint32Array(data.buffer);

  // ---- what never changes, per disc pixel
  const list = [], px = {}, rgb = new Uint8ClampedArray(3);
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity, pxPerPhase = 0;
  for ( let y = y0; y < y1; y++ ) for ( let x = x0; x < x1; x++ ) {
    if ( !P.at(x, y, px) ) continue;
    const base = rgba(P.color(px, 0, 0, rgb)), shadow = rgba(P.color(px, 0, 1, rgb));
    list.push([(y - y0) * cw + (x - x0), px.u, px.v, px.cloudK, px.bay, base, shadow, (px.haze ? 3 : 0) + px.rim]);
    if ( px.u < umin ) umin = px.u; if ( px.u > umax ) umax = px.u;
    if ( px.v < vmin ) vmin = px.v; if ( px.v > vmax ) vmax = px.v;
    // how many art px a point of the cap moves per unit of phase (u): R nz / 1.6 along x, the fastest of the visible pixels
    pxPerPhase = Math.max(pxPerPhase, (R * px.nz) / 1.6);
  }
  const n = list.length;
  const idx = new Int32Array(n), U = new Float64Array(n), V = new Float64Array(n), K = new Float64Array(n), BAY = new Float32Array(n);
  const BASE = new Uint32Array(n), SHADOW = new Uint32Array(n), KEY = new Uint8Array(n);
  list.forEach((r, i) => { idx[i] = r[0]; U[i] = r[1]; V[i] = r[2]; K[i] = r[3]; BAY[i] = r[4]; BASE[i] = r[5]; SHADOW[i] = r[6]; KEY[i] = r[7]; });
  // the cloud colours with each pixel's overlays (haze yes/no x limb line 0..2) x the five cloud shades
  const LUT = new Uint32Array(6 * 5);
  for ( let k = 0; k < 6; k++ ) for ( let c = 0; c < 5; c++ ) LUT[k * 5 + c] = rgba(P.finish(PALETTES.cloud[c], k >= 3, null, k % 3, rgb));

  // ---- the cloud field as a table over (u, v): rows fixed (v does not move), columns a ring that follows the phase
  const NR = n ? Math.ceil((vmax + SHADOW_DV - vmin) / dv) + 3 : 1, v0 = vmin - dv;
  const NC = n ? Math.ceil((umax + SHADOW_DU - umin) / du) + 4 : 1;
  const T = new Float32Array(NC * NR), colOf = new Float64Array(NC).fill(NaN);
  // per pixel: the table row (and fraction) of its own v and of its shadow's
  const RJ = new Int32Array(n), RB = new Float32Array(n), SJ = new Int32Array(n), SB = new Float32Array(n);
  for ( let i = 0; i < n; i++ ) {
    let f = (V[i] - v0) / dv; RJ[i] = Math.floor(f); RB[i] = f - RJ[i];
    f = (V[i] + SHADOW_DV - v0) / dv; SJ[i] = Math.floor(f); SB[i] = f - SJ[i];
  }
  const fill = (k) => {
    const slot = ((k % NC) + NC) % NC;
    if ( colOf[slot] === k ) return;
    colOf[slot] = k;
    const uu = k * du, o = slot * NR;
    for ( let j = 0; j < NR; j++ ) T[o + j] = P.cloudN(uu, v0 + j * dv);
  };
  const field = (s, j, b) => {
    const f = s / du, k = Math.floor(f), a = f - k;
    const o0 = (((k % NC) + NC) % NC) * NR + j, o1 = ((((k + 1) % NC) + NC) % NC) * NR + j;
    const t0 = T[o0] + (T[o0 + 1] - T[o0]) * b, t1 = T[o1] + (T[o1 + 1] - T[o1]) * b;
    return t0 + (t1 - t0) * a;
  };

  /** Paint the layer for a cloud phase (the clouds have moved `phase` along +u, towards the night side). Returns pixels changed. */
  const paint = (phase) => {
    if ( !exact && n ) for ( let k = Math.floor((umin - phase) / du) - 1, kh = Math.floor((umax + SHADOW_DU - phase) / du) + 1; k <= kh; k++ ) fill(k);
    let changed = 0;
    for ( let i = 0; i < n; i++ ) {
      const s = U[i] - phase;
      const cN = exact ? P.cloudN(s, V[i]) : field(s, RJ[i], RB[i]);
      let c;
      if ( cN > CLOUD_T ) c = LUT[KEY[i] * 5 + P.cloudIndex(K[i], cN, BAY[i])];
      else c = (exact ? P.cloudN(s + SHADOW_DU, V[i] + SHADOW_DV) : field(s + SHADOW_DU, SJ[i], SB[i])) > CLOUD_T ? SHADOW[i] : BASE[i];
      const o = idx[i];
      if ( d32[o] !== c ) { d32[o] = c; changed++; }
    }
    return changed;
  };
  return { x0, y0, cw, ch, data, pixels: n, pxPerPhase, paint };
}
