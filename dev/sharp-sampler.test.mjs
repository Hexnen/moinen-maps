// The one sampler (sharp bilinear, scripts/destruction/sharp-sampler.mjs):   node dev/sharp-sampler.test.mjs
//   JS mirror of the GLSL math, 1D. Checked: bounded by the texture, NEAREST at integer screen/texel ratios, continuity in the scale
//   and in the position, a texel edge's apparent position moves smoothly (no snapping, no shimmer) as the scale varies in tiny steps
//   (where NEAREST steps), plain bilinear when minified, ink (coverage) of a 1-texel line is constant at every phase and scale.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = await import(pathToFileURL(path.join(root, "scripts/destruction/sharp-sampler.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
let seed = 777;
const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2654435761) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;

// bounded + NEAREST limit
const tex = Array.from({ length: 64 }, () => rnd());
for ( let c = 0; c < 4000; c++ ) {
  const s = 0.2 + rnd() * 12, t = rnd() * 64;
  const v = S.sharpSample1(tex, t, s), lo = Math.min(...tex), hi = Math.max(...tex);
  ok(v >= lo - 1e-12 && v <= hi + 1e-12, "bounded by the texture");
}
for ( const s of [1, 2, 3, 4, 5, 8] ) {
  const row = S.render1(tex, s, 64 * s - 2, 0);
  for ( let i = 0; i < row.length; i++ ) ok(near(row[i], tex[Math.floor(i / s)], 1e-9), `exactly NEAREST at ${s} px per texel (pixel ${i})`);
}
// minified (s <= 1): ordinary bilinear
for ( let c = 0; c < 500; c++ ) { const s = 0.1 + rnd() * 0.9, t = 2 + rnd() * 60; ok(near(S.sharpSample1(tex, t, s), S.bilinear1(tex, t)), "minified = bilinear"); }
// a texel interior stays flat: at s = 2.5 the middle of every texel is the texel's own value
for ( const s of [1.3, 1.5, 2.5, 3.7, 6] ) for ( let k = 3; k < 60; k++ ) ok(near(S.sharpSample1(tex, k + 0.5, s), tex[k]), `texel centre is the texel (${s})`);
// continuity in the position (a step of 1e-4 texel moves the value by at most ~1e-4 / w) and in the scale
for ( let c = 0; c < 4000; c++ ) {
  const s = 1 + rnd() * 6, t = 1 + rnd() * 60, w = S.footprint(s);
  const d = Math.abs(S.sharpSample1(tex, t + 1e-4, s) - S.sharpSample1(tex, t, s));
  ok(d <= 1e-4 / w * 1.0001 + 1e-12, "Lipschitz in the position: slope <= 1 / footprint");
  const e = Math.abs(S.sharpSample1(tex, t, s + 1e-4) - S.sharpSample1(tex, t, s));
  ok(e <= 0.02, "continuous in the scale");
}
// THE SHIMMER: a texel edge (0 | 1 step at texel 20) drawn into a screen row of pixels; the edge's apparent screen position (the ink:
// pixels' worth of 'dark' to its left) must follow the geometric position 20 * s smoothly as s varies in tiny steps. NEAREST steps by whole
// pixels; the box filter tracks it to within the numerical noise, the second difference of the position is ~0.
const step = Array.from({ length: 64 }, (_, i) => (i < 20 ? 0 : 1));
const edgePos = (s, k = 1, off = 0) => { const row = S.render1(step, s, Math.ceil(30 * s), off, k); let dark = 0; for ( const v of row ) dark += 1 - v; return dark + off; };
let worst = 0, worstNearest = 0;
for ( let s = 1.0; s < 6.0; s += 0.0137 ) {
  const p = edgePos(s), q = edgePos(s + 0.001), r = edgePos(s - 0.001);
  worst = Math.max(worst, Math.abs(p - 20 * s));
  worstNearest = Math.max(worstNearest, Math.abs(Math.round(20 * s) - 20 * s));
  ok(Math.abs(q - 2 * p + r) < 0.003, `edge position is smooth in the scale (s=${s.toFixed(3)}: second difference ${(q - 2 * p + r).toExponential(2)})`);
}
ok(worst < 0.01, `the apparent edge position tracks the geometric one (error ${worst.toFixed(4)} px; NEAREST would be off by up to ${worstNearest.toFixed(2)})`);
ok(worstNearest > 0.3, "(sanity: NEAREST's own error is large)");
// ... and the same under sub-pixel shake offsets
for ( let off = 0; off < 1; off += 0.071 ) for ( const s of [1.4, 2.2, 3.3] ) ok(Math.abs(edgePos(s, 1, off) - 20 * s) < 0.01, "edge position is shake-independent");
// COVERAGE: a one-texel line (value 1 on a 0 background) has ink = s screen pixels at every phase and scale (no thin-line flicker)
const line = Array.from({ length: 64 }, (_, i) => (i === 30 ? 1 : 0));
for ( const s of [1.1, 1.5, 1.9, 2.4, 3.1, 4.7] ) for ( let off = 0; off < 1; off += 0.13 ) {
  const row = S.render1(line, s, Math.ceil(64 * s), off); const ink = row.reduce((a, b) => a + b, 0);
  ok(Math.abs(ink - s) < 0.02 * s + 1e-9, `a 1-texel line keeps its coverage (${s}, phase ${off.toFixed(2)}: ink ${ink.toFixed(3)})`);
}
// the softness knob: k = 0 is NEAREST at any scale, k = 1/footprint (a footprint of 1) is bilinear
for ( let c = 0; c < 200; c++ ) { const s = 1.2 + rnd() * 5, t = 2 + rnd() * 60; if ( Math.abs(t - Math.round(t)) < 0.02 ) continue; ok(near(S.sharpSample1(tex, t, s, 0), tex[Math.floor(t)], 1e-6), "k = 0: NEAREST"); ok(near(S.sharpSample1(tex, t, s, s), S.bilinear1(tex, t)), "k = s: bilinear"); }
console.log(`sharp-sampler: ${n} checks passed (edge tracking error ${worst.toFixed(5)} px vs NEAREST up to ${worstNearest.toFixed(2)} px)`);
