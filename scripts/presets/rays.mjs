/**
 * DESTRUCTION PRESETS, the RAYS place (pure, node-tested in dev/presets-landing.test.mjs): cracks running out from an impact - the
 * superhero landing's radial cracks (dev/presets-design.md section 20). Each ray is its OWN damage stroke with a timed path from near
 * the centre outward: the destruction layer's crack strokes grow one dominant fissure along a followed path, widest where it starts,
 * inside the stroke's own mask (scripts/destruction/core.mjs crackStrokes) - so a ray's mask is a tapering band round its path, wide
 * enough for the fissure's kinks, and the path's times open it from the centre out (fast, then slowing: a crack running out of
 * energy). A star of rays in one stroke would be one area with one fissure; a ray per stroke is a fissure per ray.
 *
 *   place = { m: "rays", n: [lo, hi] rays, d: [lo, hi] length (sq), from: start (sq from the centre), w: [root, tip] half-width of
 *             the band (sq), ms: [lo, hi] time to the tip, fwd: 0..1 (a drag: rays ahead of the direction run longer, behind shorter),
 *             bend: 0..1 (how much a ray wanders) }
 */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v, k = 10) => Math.round(v * k) / k;

/**
 * The rays of one firing: [{ discs: [[x, y, r, lv], ...], path: [[x, y, ms], ...] }] (scene px; path times from the ray's start).
 * c the centre, sq px per square at the firing's size, dir the firing's direction (or null), r the layer's stream, lvOf(i) a ray's
 * level, R the scene rect (a point outside cuts the ray there).
 */
export function raysOf(P, { c, sq, dir, r, lvOf, inRect }) {
  const n = Math.max(1, r.int(P.n)), out = [];
  // uneven gaps (0.35 - 1.65 of the even one): a star of cracks, never a spoked wheel
  const gaps = Array.from({ length: n }, () => 0.35 + 1.3 * r()), sum = gaps.reduce((a, b) => a + b, 0), a0 = r() * Math.PI * 2;
  const dAng = dir ? Math.atan2(dir[1], dir[0]) : 0, step = Math.max(2, 0.1 * sq);
  let acc = 0;
  for ( let k = 0; k < n; k++ ) {
    const ang0 = a0 + acc / sum * Math.PI * 2; acc += gaps[k];
    const fwd = dir ? 1 + (P.fwd ?? 0) * Math.cos(ang0 - dAng) : 1;
    const L = Math.max(P.from + 0.3, r.range(P.d) * fwd) * sq, s0 = P.from * sq, ms = r.range(P.ms), lv = lvOf(k);
    const bend = (P.bend ?? 0.5) * 0.09, discs = [], path = [];
    let a = ang0, turn = (r() - 0.5) * bend, x = c[0] + Math.cos(a) * s0, y = c[1] + Math.sin(a) * s0;
    const N = Math.max(2, Math.ceil((L - s0) / step));
    for ( let i = 0; i <= N; i++ ) {
      const u = i / N;
      if ( i ) { turn = turn * 0.7 + (r() - 0.5) * bend; a += turn; x += Math.cos(a) * (L - s0) / N; y += Math.sin(a) * (L - s0) / N; }
      if ( inRect && !inRect({ x, y }) ) break;
      discs.push([round(x), round(y), round(Math.max(1.5, (P.w[0] + (P.w[1] - P.w[0]) * u) * sq)), lv]);
      // (the front runs out fast and slows towards the tip: u = 1 - (1 - t / ms)^2)
      if ( i % 3 === 0 || i === N ) path.push([round(x), round(y), Math.round(ms * (1 - Math.sqrt(clamp(1 - u, 0, 1))))]);
    }
    if ( discs.length < 3 || path.length < 2 ) continue;
    out.push({ discs, path });
  }
  return out;
}
