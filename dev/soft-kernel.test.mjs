// Zoom softening kernel:   node dev/soft-kernel.test.mjs
//   The kernel (scripts/destruction/soft-kernel.mjs) is a function of screen px per texel, the pixel ratio and the softening level:
//   bounded everywhere, monotone in each argument where the design says so, the resting look at level 0, and the level itself eases
//   without a jump (no pop at the end of the soft phase).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const K = await import(pathToFileURL(path.join(root, "scripts/destruction/soft-kernel.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const DPRS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4], PXS = [], SOFTS = [0, 0.1, 0.25, 0.5, 0.75, 1];
for ( let p = 0.1; p <= 40; p *= 1.07 ) PXS.push(p);
const CFGS = [K.SOFT_DEFAULTS, K.softConfig([0.35, 0.5]), K.softConfig([1, 1.5, 0.5, 0.5, 1, 1, 2, 3, 0.5]), K.softConfig([0.75, 0, 2, 1, 2, 0.5]), K.softConfig(null), K.softConfig([NaN, "x"])];

// bounded, finite, resting look at level 0
for ( const cfg of CFGS ) for ( const d of DPRS ) for ( const px of PXS ) for ( const s of SOFTS ) for ( const sharp of [0, 0.5, 1] ) {
  const k = K.softKernel(px, d, s, cfg, sharp, sharp === 1 && px > 1.5 ? 1e4 : px);
  ok(Object.values(k).every(Number.isFinite), `finite (px ${px}, dpr ${d}, soft ${s})`);
  ok(k.tap >= 0 && k.tap <= K.MAX_TAP + 1e-12, `tap bounded (${k.tap})`);
  ok(k.bias >= 0 && k.bias <= K.MAX_BIAS + 1e-12, `bias bounded (${k.bias})`);
  ok(k.mgain >= 0 && k.mgain <= 1, `mgain bounded`);
  ok(k.sharp >= -1e-12 && k.sharp <= 1 + 1e-12, `sharp bounded (${k.sharp})`);
  ok(k.edge > 0, `edge positive`);
  if ( s === 0 ) {
    ok(k.tap === 0 && k.bias === 0 && k.mgain === 0, "level 0: no kernel");
    ok(near(k.sharp, sharp) && near(k.edge / Math.max(1, sharp === 1 && px > 1.5 ? 1e4 : px), 1, 1e-9), "level 0: the resting sharpness and edge ramp");
  }
}
// monotone in the level (the kernel grows with it, so the end of the soft phase shrinks it to nothing)
for ( const cfg of CFGS ) for ( const d of DPRS ) for ( const px of PXS ) {
  let q = K.softKernel(px, d, 0, cfg);
  for ( const s of SOFTS.slice(1) ) { const k = K.softKernel(px, d, s, cfg); ok(k.tap >= q.tap - 1e-12 && k.bias >= q.bias - 1e-12, `monotone in the level (px ${px}, dpr ${d})`); q = k; }
}
// the taps never widen as a texel gets wider on screen (outline weight), and never narrow as the screen gets denser (e >= 0: same calm)
for ( const cfg of CFGS ) for ( const d of DPRS ) {
  let q = Infinity;
  for ( const px of PXS ) { const k = K.softKernel(px, d, 1, cfg); if ( px >= cfg.px / cfg.tap || cfg.px === 0 ) { ok(k.tap <= q + 1e-12, `tap non-increasing in px per texel (px ${px}, dpr ${d})`); q = k.tap; } }
}
for ( const cfg of CFGS ) if ( cfg.e >= 0 && cfg.eb >= 0 ) for ( const px of PXS ) {
  let q = K.softKernel(px, 1, 1, cfg);
  for ( const d of DPRS.slice(1) ) { const k = K.softKernel(px, d, 1, cfg); ok(k.tap >= q.tap - 1e-12 && k.bias >= q.bias - 1e-12, `non-decreasing in the pixel ratio (px ${px}, dpr ${d})`); q = k; }
}
// the taps' sharpness rises with the texel's screen size (crisp where a texel is wide), from the resting value at level 0
for ( const cfg of CFGS ) {
  let q = -1;
  for ( const px of PXS ) { const k = K.softKernel(px, 1, 1, cfg); ok(k.sharp >= q - 1e-12, `sharpness non-decreasing in px per texel`); q = k.sharp; }
}
// a kernel defined in device px: at the default (e 0) the width is the same on every screen; at e 1 it is the same in CSS px
{ const a = K.softConfig([1, 0.5, 0.8, 0, 0, 0]), b = K.softConfig([1, 0.5, 0.8, 0, 1, 0]);
  for ( const d of DPRS ) { ok(near(K.softKernel(4, d, 1, a).width, 0.8), "e 0: width in device px"); ok(near(K.softKernel(4, d, 1, b).width, 0.8 * d), "e 1: width in CSS px"); } }
// the edge ramp is set in CSS px: twice the pixel ratio, twice the ramp in device px (EE 1), and the same in CSS px
{ const c = K.softConfig(null);
  for ( const px of [3, 4, 6, 10] ) { const e1 = K.softKernel(px, 1, 1, c, 1, 1e4).edge, e2 = K.softKernel(px, 2, 1, c, 1, 1e4).edge;
    ok(near(e1 * c.edge, px, 1e-9) || e1 === 1, "edge ramp: EDGE CSS px at dpr 1"); ok(near(e2, e1 / 2, 1e-9) || e2 === 1, "edge ramp: twice as wide in device px at dpr 2"); } }
// the level over time: rises over RISE_FRAMES frames, holds, falls with an ease and ends at 0; never a jump of more than ~11 % per 60 Hz frame
{ let L = 0, t = 0; const trace = [];
  for ( let f = 0; f < 30; f++ ) { L = K.softLevel(L, 0, 220); trace.push(L); ok(L >= 0 && L <= 1, "level bounded"); }
  ok(near(L, 1) && near(trace[K.RISE_FRAMES - 1], 1), "rises to 1 in RISE_FRAMES frames");
  for ( let f = 1; f < K.RISE_FRAMES; f++ ) ok(near(trace[f] - trace[f - 1], 1 / K.RISE_FRAMES), "rises evenly");
  let prev = L, mono = true, maxJump = 0;
  for ( t = 16.7; t < 400; t += 16.7 ) { L = K.softLevel(L, t, 220); maxJump = Math.max(maxJump, prev - L); if ( L > prev + 1e-12 ) mono = false; prev = L; }
  ok(mono, "falls monotonically"); ok(maxJump < 0.12, `no jump at the end (${maxJump.toFixed(3)})`); ok(L === 0, "ends at 0");
  // stopped before the rise was complete: it never rises again by itself
  L = K.softLevel(K.softLevel(0, 0, 220), 5, 220); ok(L <= 1 / K.RISE_FRAMES + 1e-12, "stop during the rise");
  // the ease has zero slope at both ends
  const e0 = K.softLevel(1, 1, 220), e1 = K.softLevel(1, 219, 220); ok(1 - e0 < 1e-3 && e1 < 1e-3, "zero slope at both ends");
}
console.log(`soft-kernel: ${n} checks ok`);
