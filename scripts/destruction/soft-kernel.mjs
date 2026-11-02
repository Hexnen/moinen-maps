/**
 * ZOOM SOFTENING KERNEL (pure, no PIXI: node-testable, dev/soft-kernel.test.mjs). While the canvas scale moves, the static cache's
 * tiles are resampled with a kernel that is the same at every phase of the texel grid (no bands of sharp and blurred texels sweeping
 * over the art: "waving"). The kernel is a function of u = screen px per texel (device px, the canvas's own resolution included) and of
 * the pixel ratio, so a screen of any density gets the same picture (measured with dev/perf-harness softTable at DPR 1 / 1.25 / 1.5 / 2):
 *
 *   u up to SH0 (the waving range, a texel of 1-2.4 screen px): four plain bilinear taps TAP texels apart (0.35: the value the user
 *     judged by eye at DPR 1), the minified look below u = 1 (mip bias BIAS): exactly the old kernel, whose beat against the screen
 *     grid is the calmest there; crisp texel edges at these sizes are what beats (the waving), so none are used;
 *   u from SH0 to SH1 (2.4 .. 3.0, where the resting look turns crisp): the taps' texel edges turn from bilinear to ANTI-ALIASED
 *     CRISP, the taps close up (FADE) and their reach is capped to W = PX device px (a texel many screen pixels wide is not smeared over
 *     several of them: the outline keeps its weight); the edge ramp is EDGE CSS px wide = EDGE * dpr^EE device px (a denser screen
 *     needs a wider ramp in device px for the same calm: with a 1 device px ramp, DPR 2 beat 2.4x the old kernel's in the zoom range
 *     2.4 -> 1.3 - a texel there is 2.6-4.8 device px wide - with 1.5 CSS px it beats less than the old kernel at every DPR);
 *   `soft` (0..1) takes the taps' reach, sharpness, edge ramp and the mip bias back to the resting look, so the end of the soft phase
 *     is a continuous change (a kernel going to nothing), not a cross-fade of two pictures.
 *
 * CONFIG.moinenMaps.zoomSoftK = [TAP, BIAS, PX, MGAIN, E, EB, SH0, SH1, FADE, EDGE, EE] overrides the defaults (dev knob); MGAIN: minified,
 * the share of the detail between the biased mip level and one MIP_SPAN coarser given back (unsharp; 0 - it raised the beat as fast as
 * the weight); E / EB: the reach / mip bias grow with dpr^E / log2(dpr) (0: constant in device px - the reach binds only where the
 * taps are already closed, so E has no visible effect).
 */
export const SOFT_DEFAULTS = Object.freeze({ tap: 0.35, bias: 0.5, px: 0.9, mgain: 0, e: 0, eb: 0, sh0: 2.4, sh1: 3.0, fade: 1, edge: 1.5, ee: 1 });
export const MIP_SPAN = 1.5;
export const MAX_TAP = 1.5, MAX_BIAS = 3;

const num = (v, d) => (Number.isFinite(v) ? v : d);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** The knob as an object (missing / bad entries -> the defaults). */
export function softConfig(k = null, d = SOFT_DEFAULTS) {
  return { tap: num(k?.[0], d.tap), bias: num(k?.[1], d.bias), px: num(k?.[2], d.px), mgain: num(k?.[3], d.mgain), e: num(k?.[4], d.e), eb: num(k?.[5], d.eb), sh0: num(k?.[6], d.sh0), sh1: num(k?.[7], d.sh1), fade: clamp01(num(k?.[8], d.fade)), edge: Math.max(0.5, num(k?.[9], d.edge)), ee: num(k?.[10], d.ee) };
}

/**
 * The kernel for a tile drawn at `uPx` screen px per texel on a screen of pixel ratio `dpr`, at softening level `soft` (0..1); `sharp`
 * and `scale` are the tile's resting sharpness (0..1) and edge ramp (screen px per texel; 1e4 where it samples NEAREST).
 * -> { tap: texels (0..MAX_TAP), bias: mip levels (0..MAX_BIAS), mgain, sharp: the taps' sharpness, edge: their edge ramp, width: device px }.
 */
export function softKernel(uPx, dpr, soft, cfg = SOFT_DEFAULTS, sharp = 0, scale = uPx) {
  const s = clamp01(num(soft, 0)), r = Math.max(1, num(dpr, 1)), px = Math.max(1e-3, num(uPx, 1));
  const width = cfg.px * r ** cfg.e;
  const t = clamp01((px - cfg.sh0) / Math.max(1e-6, cfg.sh1 - cfg.sh0)), sh = t * t * (3 - 2 * t);
  const tap = Math.min(MAX_TAP, Math.max(0, Math.min(cfg.tap, width / px))) * s * (1 - cfg.fade * sh);
  const bias = Math.min(MAX_BIAS, Math.max(0, cfg.bias + cfg.eb * Math.log2(r))) * s;
  const edgeW = (1 - s) / Math.max(1e-3, num(scale, px)) + s * cfg.edge * r ** cfg.ee / px;       // (the edge's width in texels: 1 / scale at rest, EDGE CSS px = EDGE * dpr^EE device px while soft)
  return { tap, bias, mgain: clamp01(cfg.mgain) * s, sharp: (1 - s) * clamp01(num(sharp, 0)) + s * sh, edge: Math.max(1, 1 / edgeW), width };
}

/**
 * The softening level over time: it rises over RISE_FRAMES frames while the scale moves (no one-frame jump from the resting look) and,
 * once it stopped, falls along a smooth ease (zero slope at both ends) over `ms`. `level` is the previous level, `since` the ms since the
 * scale last changed (0 or less while it moves). -> the new level.
 */
export const RISE_FRAMES = 3;
export function softLevel(level, since, ms) {
  if ( since <= 0 ) return Math.min(1, level + 1 / RISE_FRAMES);
  const x = Math.min(1, since / ms);
  return Math.min(level, 1 - x * x * (3 - 2 * x));
}
