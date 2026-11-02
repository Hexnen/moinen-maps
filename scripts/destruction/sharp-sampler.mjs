/**
 * THE ONE TEXTURE SAMPLER of the destruction layer ("sharp bilinear" / pixel-art anti-aliasing), as a GLSL chunk plus a JS mirror of
 * its math (node tests, dev/sharp-sampler.test.mjs).
 *
 * Why: sampled NEAREST at 1..3 screen px per texel, the texel edges SNAP to pixel boundaries as the scale changes (a texel is 1 px wide,
 * then 2, in a pattern that crawls: the "waving" of a zoom or a shaking camera); plain bilinear never snaps but blurs every edge over a
 * whole texel. This sampler is the exact BOX filter of the texel grid over the screen pixel's footprint: texel interiors stay flat,
 * texel EDGES get one screen pixel of anti-aliased ramp, and as the scale (or the position) changes continuously the edges move
 * continuously by sub-pixel amounts. It is a function of the position and the derivatives only: no state, no time, no per-tile uniform,
 * so every tile, band and live unit that uses it agrees.
 *
 *   t  = uv * size                          (texel coordinates; texel k covers [k, k + 1])
 *   w  = clamp(fwidth(t), W_MIN, 1)         (the footprint of one screen pixel in texels, per axis)
 *   c  = floor(t + 0.5)                     (the texel EDGE nearest to t)
 *   b  = c + clamp((t - c) / w, -0.5, 0.5)  (where a plain bilinear fetch must read to give the box-filtered mix across that edge)
 *   out = bilinear(b), minified (w >= 1: b = t) -> ordinary bilinear + mips from the ORIGINAL uv gradients (textureGrad)
 *
 * Limits: w -> 0 (big magnification) gives NEAREST; at an integer screen/texel ratio the pixel centres sit exactly w/2 from every edge
 * so the result IS NEAREST (the ramp ends at the pixel's edge). Premultiplied alpha is preserved (a bilinear fetch of a premultiplied
 * texture), the output is a convex mix of two neighbouring texels per axis, so it is bounded by the texture.
 */
export const W_MIN = 0.01;

/** GLSL (ES 3.00): `vec4 sharpSample(sampler2D tex, vec2 uv, vec2 size, float k)`; k scales the footprint (1 = exact; > 1 softer; 0 = NEAREST). */
export const SHARP_SAMPLER_GLSL = `
vec2 sharpCoord(vec2 t, vec2 w) {
  vec2 c = floor(t + 0.5);
  return c + clamp((t - c) / w, vec2(-0.5), vec2(0.5));
}
vec4 sharpSample(sampler2D tex, vec2 uv, vec2 size, float k) {
  vec2 t = uv * size;
  vec2 w = clamp(fwidth(t) * k, vec2(${W_MIN}), vec2(1.0));
  return textureGrad(tex, sharpCoord(t, w) / size, dFdx(uv), dFdy(uv));
}`;

/** The footprint (texels per screen pixel, per axis), clamped as the shader does. `s` = screen px per texel. */
export function footprint(s, k = 1) { return Math.min(1, Math.max(W_MIN, k / s)); }

/** JS mirror of sharpCoord on one axis: the bilinear fetch position for texel coordinate t with footprint w. */
export function sharpCoord1(t, w) {
  const c = Math.floor(t + 0.5), x = (t - c) / w;
  return c + Math.min(0.5, Math.max(-0.5, x));
}

/** JS mirror of a clamp-to-edge 1D bilinear fetch of `tex` (texel k centred at k + 0.5) at texel coordinate b. */
export function bilinear1(tex, b) {
  const p = b - 0.5, i = Math.floor(p), f = p - i, n = tex.length;
  const at = (k) => tex[Math.min(n - 1, Math.max(0, k))];
  return at(i) * (1 - f) + at(i + 1) * f;
}

/** JS mirror of sharpSample on one axis at texel coordinate t, screen px per texel s. */
export function sharpSample1(tex, t, s, k = 1) { return bilinear1(tex, sharpCoord1(t, footprint(s, k))); }

/** The screen row of `n` pixels (centres at (i + 0.5 + off) / s texels) drawn from `tex` at scale s. */
export function render1(tex, s, n, off = 0, k = 1) {
  const out = new Array(n);
  for ( let i = 0; i < n; i++ ) out[i] = sharpSample1(tex, (i + 0.5 + off) / s, s, k);
  return out;
}
