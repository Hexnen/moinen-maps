/**
 * THE ONE TEXTURE SAMPLER of the destruction layer ("sharp bilinear" / pixel-art anti-aliasing), as a GLSL chunk plus a JS mirror of
 * its math (node tests, dev/sharp-sampler.test.mjs).
 *
 * Why: sampled NEAREST at 1..3 screen px per texel, the texel edges SNAP to pixel boundaries as the scale changes (a texel is 1 px wide,
 * then 2, in a pattern that crawls: the "waving" of a zoom or a shaking camera); plain bilinear never snaps but blurs every edge over a
 * whole texel; trilinear mips minified beat against the power-of-two grid of their levels. This sampler is the exact BOX filter of the
 * texture over the screen pixel's footprint, for ANY footprint, from a magnified texel (edges get one pixel of anti-aliasing, interiors
 * stay flat) to a minified area of many texels:
 *
 *   w  = max(fwidth(uv * size), W_MIN)       the footprint of one screen pixel in level-0 texels, per axis (L1 norm of the derivatives)
 *   a  = floor(log2(max(w)))                 the mip level below the footprint (0 when magnified): there it spans 1..2 cells; the next level
 *                                            holds it in 1 cell or less; the two are blended by log2(w) - a (continuous, like trilinear)
 *   per axis, the box [t - w'/2, t + w'/2] (level-m texel units) covers at most 3 cells: weights a0 a1 a2 (sum w'); two BILINEAR taps
 *   do it exactly: one at i0 + 1/2 + a1 / (a0 + a1) (weight (a0 + a1) / w'), one on the third cell (weight a2 / w'); 2 x 2 = 4 fetches,
 *   1 when magnified (a2 = 0 on both axes). Level m is the exact average of its 2^m x 2^m texels (generateMipmap), so the result is
 *   the box average of the footprint up to the (second-order) alignment of the level's cells.
 *
 * It is a function of the position and the derivatives only: no state, no time, no per-tile uniform, so every tile, band and live
 * unit that uses it agrees, and the picture is a continuous function of the scale and of the position. Limits: w -> 0 (big
 * magnification) is NEAREST; at an integer screen/texel ratio the pixel centres sit exactly w/2 from every edge, so the result IS
 * NEAREST (the ramp ends at the pixel's edge); minified, 1-px lines keep their coverage (the average conserves ink). Premultiplied
 * alpha is preserved (bilinear taps of a premultiplied texture) and the output is a convex combination of texels.
 */
export const W_MIN = 0.01;
/** Where in an octave of the footprint the blend to the next mip level starts (0 = linear over the whole octave = trilinear's fractions; 1 = no blend). */
export const BLEND0 = 0.75;

/**
 * GLSL (ES 3.00): `vec4 sharpSample(sampler2D tex, vec2 uv, float k)` (derivatives of the uv taken inside: call it from uniform control
 * flow), `sharpSampleG(tex, uv, gx, gy, k)` (the uv's derivatives given: take them once, outside any branch) and `sharpSampleT(..., top)`
 * (the texture's highest mip level given: 0 for a texture without mips). k scales the footprint (1 = exact; 0 = NEAREST).
 */
export const SHARP_SAMPLER_GLSL = `
uniform float uSharpB;   // where in the octave the blend to the next level starts (0..1)
// one axis of the box [t - w/2, t + w/2] (level texels, w <= 2): (x of the tap over the first two cells, its weight, x of the third cell, its weight)
vec4 sharpAxis(float t, float w) {
  float a = t - 0.5 * w, b = t + 0.5 * w, i0 = floor(a);
  float a0 = min(i0 + 1.0, b) - a;
  float a1 = clamp(min(i0 + 2.0, b) - (i0 + 1.0), 0.0, 1.0);
  float a2 = max(0.0, b - (i0 + 2.0));
  float s = a0 + a1;
  return vec4(i0 + 0.5 + a1 / max(s, 1e-6), s / w, i0 + 2.5, a2 / w);
}
// the box of footprint w (level-0 texels per pixel, per axis) read from mip level m (a footprint of at most 2 cells there)
vec4 sharpBox(sampler2D tex, vec2 uv, vec2 w, float m) {
  vec2 sz = vec2(textureSize(tex, int(m)));
  vec2 t = uv * sz, wl = min(w * exp2(-m), vec2(2.0));
  vec4 X = sharpAxis(t.x, wl.x), Y = sharpAxis(t.y, wl.y);
  vec4 c = X.y * Y.y * textureLod(tex, vec2(X.x, Y.x) / sz, m);
  if ( X.w > 0.0 ) c += X.w * Y.y * textureLod(tex, vec2(X.z, Y.x) / sz, m);
  if ( Y.w > 0.0 ) {
    c += X.y * Y.w * textureLod(tex, vec2(X.x, Y.z) / sz, m);
    if ( X.w > 0.0 ) c += X.w * Y.w * textureLod(tex, vec2(X.z, Y.z) / sz, m);
  }
  return c;
}
vec4 sharpSampleT(sampler2D tex, vec2 uv, vec2 gx, vec2 gy, float k, float top) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 w = max((abs(gx) + abs(gy)) * size * k, vec2(${W_MIN}));
  float L = log2(max(w.x, w.y));
  if ( L <= 0.0 || top < 1.0 ) return sharpBox(tex, uv, w, 0.0);
  // minified: the level a below the footprint (a box of 1..2 cells there) and the next one (1 cell or less), blended by the fraction of
  // the footprint's log - continuous across the level switches (as trilinear is) while each level is read as a true box, not a bilinear tap
  float a = min(floor(L), top), f = a >= top ? 0.0 : clamp((L - a - uSharpB) / (1.0 - uSharpB), 0.0, 1.0);
  vec4 c = sharpBox(tex, uv, w, a);
  return f > 0.0 ? mix(c, sharpBox(tex, uv, w, a + 1.0), f) : c;
}
vec4 sharpSampleG(sampler2D tex, vec2 uv, vec2 gx, vec2 gy, float k) {
  vec2 size = vec2(textureSize(tex, 0));
  return sharpSampleT(tex, uv, gx, gy, k, floor(log2(max(size.x, size.y))));
}
vec4 sharpSample(sampler2D tex, vec2 uv, float k) { return sharpSampleG(tex, uv, dFdx(uv), dFdy(uv), k); }`;

/** The footprint (texels per screen pixel, per axis), clamped as the shader does. `s` = screen px per texel. */
export function footprint(s, k = 1) { return Math.max(W_MIN, k / s); }

/** The mip pyramid of a 1D texture (each level the average of pairs; an odd tail texel is dropped, as GL does). */
export function pyramid(tex) {
  const L = [tex.slice()];
  while ( L[L.length - 1].length > 1 ) { const p = L[L.length - 1], n = Math.floor(p.length / 2), q = new Array(n); for ( let i = 0; i < n; i++ ) q[i] = (p[2 * i] + p[2 * i + 1]) / 2; L.push(q); }
  return L;
}

/** One axis of the box, as the GLSL: [x1, weight1, x2, weight2] (level texel units). */
export function axis(t, w) {
  const a = t - 0.5 * w, b = t + 0.5 * w, i0 = Math.floor(a);
  const a0 = Math.min(i0 + 1, b) - a, a1 = Math.min(1, Math.max(0, Math.min(i0 + 2, b) - (i0 + 1))), a2 = Math.max(0, b - (i0 + 2)), s = a0 + a1;
  return [i0 + 0.5 + a1 / Math.max(s, 1e-6), s / w, i0 + 2.5, a2 / w];
}

/** Clamp-to-edge 1D bilinear fetch of a level (texel k centred at k + 0.5) at texel coordinate x. */
export function bilinear1(tex, x) {
  const p = x - 0.5, i = Math.floor(p), f = p - i, n = tex.length;
  const at = (k) => tex[Math.min(n - 1, Math.max(0, k))];
  return at(i) * (1 - f) + at(i + 1) * f;
}

/** The box of footprint w (level-0 texels) read from level m of the pyramid. */
export function boxAt(pyr, t, w, m) {
  const sc = 2 ** -m, lv = pyr[m], [x1, w1, x2, w2] = axis(t * sc, Math.min(w * sc, 2));
  return w1 * bilinear1(lv, x1) + (w2 > 0 ? w2 * bilinear1(lv, x2) : 0);
}

/** JS mirror of sharpSample on one axis: texel coordinate t (level 0), footprint w (level-0 texels per pixel). */
export function sharpSample1(pyr, t, w, b = BLEND0) {
  w = Math.max(W_MIN, w);
  const L = Math.log2(w), top = pyr.length - 1;
  if ( L <= 0 || top < 1 ) return boxAt(pyr, t, w, 0);
  const a = Math.min(Math.floor(L), top), f = a >= top ? 0 : Math.min(1, Math.max(0, (L - a - b) / (1 - b))), c = boxAt(pyr, t, w, a);
  return f > 0 ? c + (boxAt(pyr, t, w, a + 1) - c) * f : c;
}

/** The exact box average of a 1D texture over [t - w/2, t + w/2] (level-0 texels): the reference the sampler approximates. */
export function exactBox(tex, t, w) {
  const a = t - w / 2, b = t + w / 2, n = tex.length; let s = 0;
  for ( let k = Math.floor(a); k < b; k++ ) { const lo = Math.max(a, k), hi = Math.min(b, k + 1); if ( hi > lo ) s += (hi - lo) * tex[Math.min(n - 1, Math.max(0, k))]; }
  return s / w;
}

/** The screen row of `n` pixels (centres at (i + 0.5 + off) / s texels) drawn at `s` screen px per texel. */
export function render1(pyr, s, n, off = 0, k = 1) {
  const out = new Array(n), w = footprint(s, k);
  for ( let i = 0; i < n; i++ ) out[i] = sharpSample1(pyr, (i + 0.5 + off) / s, w);
  return out;
}
