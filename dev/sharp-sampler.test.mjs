// The one sampler (exact box filter over the pixel footprint, scripts/destruction/sharp-sampler.mjs):   node dev/sharp-sampler.test.mjs
//   JS mirror of the GLSL math, 1D, with a real mip pyramid. Checked: bounded by the texture, exactly NEAREST at integer screen/texel
//   ratios, exactly the box average for footprints up to 1 texel (any magnification and the first minification), near it beyond,
//   continuity in the scale and in the position (also across a mip level switch), a texel edge's apparent position moves smoothly with
//   the scale (no snapping, no shimmer), the ink of a 1-texel line is conserved at every phase and scale (magnified AND minified).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = await import(pathToFileURL(path.join(root, "scripts/destruction/sharp-sampler.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
let seed = 777;
const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2654435761) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;

const N = 256;
const noise = Array.from({ length: N }, () => rnd()), P = S.pyramid(noise);
const smooth = Array.from({ length: N }, (_, i) => 0.5 + 0.5 * Math.sin(i / 7) * Math.cos(i / 23)), PS = S.pyramid(smooth);
const lo = Math.min(...noise), hi = Math.max(...noise);

// bounded (convex combination of texels)
for ( let c = 0; c < 5000; c++ ) { const w = 0.01 + rnd() * 20, t = rnd() * N; const v = S.sharpSample1(P, t, w); ok(v >= lo - 1e-12 && v <= hi + 1e-12, "bounded by the texture"); }
// weights sum to one
for ( let c = 0; c < 2000; c++ ) { const w = 0.01 + rnd() * 2, [, w1, , w2] = S.axis(rnd() * 100, w); ok(near(w1 + w2, 1, 1e-9), "the taps' weights sum to 1"); }
// exactly NEAREST at integer ratios (magnified)
for ( const s of [1, 2, 3, 4, 5, 8] ) {
  const row = S.render1(P, s, 100 * s - 2, 0);
  for ( let i = 0; i < row.length; i++ ) ok(near(row[i], noise[Math.floor(i / s)], 1e-9), `exactly NEAREST at ${s} px per texel (pixel ${i})`);
}
// exactly the box average up to 1 texel per pixel (level 0), near it beyond
for ( let c = 0; c < 4000; c++ ) { const w = 0.02 + rnd() * 0.98, t = 3 + rnd() * 200; ok(near(S.sharpSample1(P, t, w), S.exactBox(noise, t, w), 1e-9), `box average exact for footprint ${w.toFixed(3)}`); }
// plain trilinear (the hardware minification) for comparison: bilinear at the two nearest levels of log2(footprint)
const tri = (pyr, t, w) => { const L = Math.min(pyr.length - 1, Math.max(0, Math.log2(Math.max(w, 1e-9)))), a = Math.floor(L), f = L - a, at = (m) => S.bilinear1(pyr[m], t * 2 ** -m);
  return f > 0 && a + 1 < pyr.length ? at(a) * (1 - f) + at(a + 1) * f : at(a); };
let errSum = 0, errN = 0, errMax = 0, triSum = 0, triMax = 0;
for ( let c = 0; c < 4000; c++ ) {
  const w = 2.01 + rnd() * 14, t = 20 + rnd() * 200, ex = S.exactBox(smooth, t, w), e = Math.abs(S.sharpSample1(PS, t, w) - ex), e2 = Math.abs(tri(PS, t, w) - ex);
  errSum += e; errN++; errMax = Math.max(errMax, e); triSum += e2; triMax = Math.max(triMax, e2);
}
ok(errSum <= triSum * 1.15 && errMax <= triMax * 1.1, `minified: about as close to the exact box as trilinear (mean ${(errSum / errN).toFixed(4)} vs ${(triSum / errN).toFixed(4)}, max ${errMax.toFixed(3)} vs ${triMax.toFixed(3)})`);
// continuity in the position
for ( let c = 0; c < 4000; c++ ) {
  const w = 0.02 + rnd() * 10, t = 20 + rnd() * 200;
  const d = Math.abs(S.sharpSample1(P, t + 1e-4, w) - S.sharpSample1(P, t, w));
  ok(d <= 1e-4 / Math.min(w, 1) * 2 + 1e-9 + 2e-4 * 8, `position: no jump (w ${w.toFixed(2)}: ${d})`);
}
// continuity in the scale, across the level switches too (the worst jump of a smooth signal over a scale sweep)
let worstSw = 0, worstSwNoise = 0;
for ( const wsw of [2, 4, 8, 16] ) for ( let c = 0; c < 200; c++ ) {
  const t = 20 + rnd() * 200;
  worstSw = Math.max(worstSw, Math.abs(S.sharpSample1(PS, t, wsw * (1 + 1e-6)) - S.sharpSample1(PS, t, wsw * (1 - 1e-6))));
  worstSwNoise = Math.max(worstSwNoise, Math.abs(S.sharpSample1(P, t, wsw * (1 + 1e-6)) - S.sharpSample1(P, t, wsw * (1 - 1e-6))));
}
ok(worstSw < 0.02, `a mip level switch moves a smooth signal by under 2 % (${worstSw.toFixed(4)}; white noise: ${worstSwNoise.toFixed(3)})`);
for ( let c = 0; c < 3000; c++ ) { const w = 0.05 + rnd() * 3, t = 20 + rnd() * 200, e = Math.abs(S.sharpSample1(P, t, w * 1.0001) - S.sharpSample1(P, t, w)); ok(e <= 0.01, "continuous in the scale"); }

// THE SHIMMER: a texel edge (0 | 1 step at texel 20) drawn into a screen row; the edge's apparent screen position (the ink to its
// left) must follow the geometric position 20 * s smoothly as s varies in tiny steps. NEAREST steps by whole pixels; the box filter
// tracks it to within numerical noise when magnified and to a small error when minified; the second difference is ~0.
const step = Array.from({ length: 256 }, (_, i) => (i < 20 ? 0 : 1)), PSt = S.pyramid(step);
const edgePos = (s, off = 0) => { const row = S.render1(PSt, s, Math.ceil(30 * s) + 2, off); let dark = 0; for ( const v of row ) dark += 1 - v; return dark + off; };
let worst = 0, worstNearest = 0, worst2 = 0;
for ( let s = 1.0; s < 6.0; s += 0.0137 ) {
  const p = edgePos(s), q = edgePos(s + 0.001), r = edgePos(s - 0.001);
  worst = Math.max(worst, Math.abs(p - 20 * s)); worstNearest = Math.max(worstNearest, Math.abs(Math.round(20 * s) - 20 * s)); worst2 = Math.max(worst2, Math.abs(q - 2 * p + r));
}
ok(worst < 0.01 && worst2 < 0.003, `magnified: the apparent edge position tracks the geometric one (error ${worst.toFixed(5)} px, 2nd difference ${worst2.toExponential(1)}; NEAREST: up to ${worstNearest.toFixed(2)})`);
ok(worstNearest > 0.3, "(sanity: NEAREST's own error is large)");
let worstMin = 0, worstMin2 = 0;
for ( let s = 0.12; s < 1.0; s += 0.0071 ) { const p = edgePos(s), q = edgePos(s + 0.0005), r = edgePos(s - 0.0005); worstMin = Math.max(worstMin, Math.abs(p - 20 * s)); worstMin2 = Math.max(worstMin2, Math.abs(q - 2 * p + r)); }
ok(worstMin < 0.12 && worstMin2 < 0.03, `minified: the edge follows the geometry (error ${worstMin.toFixed(4)} px, 2nd difference ${worstMin2.toFixed(4)})`);
for ( let off = 0; off < 1; off += 0.071 ) for ( const s of [1.4, 2.2, 3.3] ) ok(Math.abs(edgePos(s, off) - 20 * s) < 0.01, "edge position is shake-independent");

// COVERAGE: a one-texel line has ink = s screen pixels at every phase and scale, magnified and minified (no thin-line flicker)
const line = Array.from({ length: 256 }, (_, i) => (i === 130 ? 1 : 0)), PL = S.pyramid(line);
let inkWorst = 0;
for ( const s of [0.15, 0.3, 0.45, 0.7, 0.9, 1.1, 1.5, 1.9, 2.4, 3.1, 4.7] ) for ( let off = 0; off < 1; off += 0.13 ) {
  const row = S.render1(PL, s, Math.ceil(256 * s) + 2, off); const ink = row.reduce((a, b) => a + b, 0);
  inkWorst = Math.max(inkWorst, Math.abs(ink - s) / s);
}
ok(inkWorst < 0.06, `a 1-texel line keeps its coverage at any scale and phase (worst ${(inkWorst * 100).toFixed(2)} %)`);
// the softness knob: k = 0 is NEAREST at any scale
for ( let c = 0; c < 200; c++ ) { const s = 1.2 + rnd() * 5, t = 2 + rnd() * 60; if ( Math.abs(t - Math.round(t)) < 0.02 ) continue; ok(near(S.sharpSample1(P, t, S.footprint(s, 0)), noise[Math.floor(t)], 1e-6), "k = 0: NEAREST"); }
console.log(`sharp-sampler: ${n} checks passed (magnified edge error ${worst.toFixed(5)} px vs NEAREST up to ${worstNearest.toFixed(2)} px; minified ${worstMin.toFixed(3)} px; line ink ${(inkWorst * 100).toFixed(1)} %; level switch ${worstSw.toFixed(4)})`);
