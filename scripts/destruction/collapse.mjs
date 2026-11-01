/**
 * COLLAPSE ('zapadnięcie'), the bake side (core.mjs calls these from its collapse paths only; every other kind bakes as before).
 *   collapseOutline  the stroke's outline: a tap is an asymmetric organic pit (radial lobes, a squash, sharp notches, chipped corners -
 *                    never a manhole disc); a followed stroke is a TRENCH along its path (one continuous channel that pinches and
 *                    bulges and wanders off the path, tapering at its ends - never a chain of round stamps)
 *   collapseSeeds    the fracture: rings of plates that follow the outline (bands of equal distance to the rim), so the rim breaks into
 *                    slabs along the edge, the next band inside them, and so on (a trench: slabs along both its sides)
 *   collapseFate     each plate's fate by its band and the level: level 1 sags (cracked plates tip a little towards the middle), level
 *                    2 breaks in (rim slabs tilt inward and sink, inner slabs lie on the floor), level 3 caves in (the middle is gone,
 *                    pieces fell into the void)
 *   collapseShade    the exposed layer: lip -> a sloped wall in tone bands lit from the top left, with strata lines along the
 *                    contours -> the deep void with a faint ambient floor
 *   collapseLip      the torn lip's ink: broken, of varying weight, occluded in long stretches (no inked lasso)
 * Deterministic: everything is drawn from the stroke's own seed and pixels.
 */

function h2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  const top = a + (b - a) * u, bot = c + (d - c) * u;
  return top + (bot - top) * v;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mul = (c, f) => [clamp(Math.round(c[0] * f), 0, 255), clamp(Math.round(c[1] * f), 0, 255), clamp(Math.round(c[2] * f), 0, 255)];
const mix = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
const TAU = Math.PI * 2;
const angDist = (a, b) => { const d = ((a - b) % TAU + TAU * 1.5) % TAU - Math.PI; return Math.abs(d); };

/**
 * The outline of a collapse stroke (partsOf). `ob` the stroke (mask px box, path in art px), K art px per mask px, Rb the brush radius
 * (art px), os the stroke's outline seed, lvT(mx, my) its mask level. Returns { margin, warp?, field? }: warp(ax, ay) -> [dx, dy] added
 * to the sampling point (a tap), field(ax, ay) -> the level there (a trench; 0 outside).
 */
export function collapseOutline({ ob, K, Rb, os, directional, lvT }) {
  const path = ob.path;
  let plen = 0;
  if ( path?.length > 1 ) for ( let k = 1; k < path.length; k++ ) plen += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
  if ( directional && path?.length > 1 && plen >= Rb * 2.5 ) return trench(path, plen, { ob, K, Rb, os, lvT });
  const W = ob.w * K, H = ob.h * K, span = Math.max(W, H);
  // only a compact stroke (a tap, a short dab) is reshaped round its middle; a long stroke keeps the plain organic warp
  if ( span > Rb * 3.4 || Math.max(W, H) > 1.7 * Math.min(W, H) ) return { margin: 0 };
  const cx = (ob.x0 + ob.w / 2) * K, cy = (ob.y0 + ob.h / 2) * K;
  const r = (k) => h2(os, k, 9187);
  // the sampling radius scale by angle: s > 1 pulls the rim in, s < 1 pushes it out (outline radius ~ Rb / s)
  const H2 = [0.13 + 0.06 * r(1), r(2) * TAU], H3 = [0.09 + 0.05 * r(3), r(4) * TAU], H5 = [0.045 + 0.03 * r(5), r(6) * TAU], H8 = [0.025, r(7) * TAU];
  const notches = Array.from({ length: 2 + (r(8) < 0.5 ? 1 : 0) }, (_, q) => ({ a: r(10 + q) * TAU, d: 0.16 + 0.12 * r(20 + q), w: 0.16 + 0.12 * r(30 + q) }));
  const sOf = (a) => {
    let s = 1 + H2[0] * Math.cos(2 * a + H2[1]) + H3[0] * Math.cos(3 * a + H3[1]) + H5[0] * Math.cos(5 * a + H5[1]) + H8[0] * Math.cos(8 * a + H8[1]);
    for ( const n of notches ) { const t = 1 - angDist(a, n.a) / n.w; if ( t > 0 ) s += n.d * t * t; }
    return clamp(s, 0.7, 1.6);
  };
  // the mask read SMOOTHED (two box blurs of radius 2 mask px): a brush disc of mask pixels has straight runs along its top, bottom and
  // sides, and the reshaping above would stretch them into long straight edges
  const P = 6, BW = ob.w + 2 * P, BH = ob.h + 2 * P;
  let a = new Float32Array(BW * BH), b = new Float32Array(BW * BH);
  for ( let y = 0; y < BH; y++ ) for ( let x = 0; x < BW; x++ ) a[y * BW + x] = lvT(ob.x0 + x - P, ob.y0 + y - P);
  for ( let pass = 0; pass < 2; pass++ ) {
    for ( let y = 0; y < BH; y++ ) for ( let x = 0; x < BW; x++ ) { let s = 0; for ( let k = -2; k <= 2; k++ ) s += a[y * BW + clamp(x + k, 0, BW - 1)]; b[y * BW + x] = s / 5; }
    for ( let y = 0; y < BH; y++ ) for ( let x = 0; x < BW; x++ ) { let s = 0; for ( let k = -2; k <= 2; k++ ) s += b[clamp(y + k, 0, BH - 1) * BW + x]; a[y * BW + x] = s / 5; }
  }
  const at = (mx, my) => { const x = mx - ob.x0 + P, y = my - ob.y0 + P; return x < 0 || y < 0 || x >= BW || y >= BH ? 0 : a[y * BW + x]; };
  return {
    margin: Math.ceil(Rb * 0.45) + 2,
    /** The smoothed level at mask coordinates (mx, my), bilinear. */
    sample(mx, my) {
      const ix = Math.floor(mx), iy = Math.floor(my), fx = mx - ix, fy = my - iy;
      const p = at(ix, iy), q = at(ix + 1, iy), r2 = at(ix, iy + 1), s = at(ix + 1, iy + 1);
      return (p + (q - p) * fx) * (1 - fy) + (r2 + (s - r2) * fx) * fy;
    },
    warp(ax, ay) {
      const dx = ax - cx, dy = ay - cy, d = Math.hypot(dx, dy);
      if ( d < 0.5 ) return [0, 0];
      const s = sOf(Math.atan2(dy, dx)) - 1;
      return [dx * s, dy * s];
    }
  };
}

/** A trench along the path: half width that pinches and bulges, a centre that wanders off the path, tapered ends. */
function trench(path, plen, { ob, K, Rb, os, lvT }) {
  const segs = [];
  let acc = 0, lmax = 0;
  const lvAt = (x, y) => {
    const mx = Math.floor(x / K), my = Math.floor(y / K);
    let v = 0; for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) v = Math.max(v, lvT(mx + dx, my + dy));
    return v;
  };
  for ( let k = 1; k < path.length; k++ ) {
    const [x0, y0] = path[k - 1], [x1, y1] = path[k], l = Math.hypot(x1 - x0, y1 - y0);
    if ( l < 1e-6 ) continue;
    const pad = Rb * 1.6 + 3;
    segs.push({ x0, y0, x1, y1, l, s0: acc, ux: (x1 - x0) / l, uy: (y1 - y0) / l, bx0: Math.min(x0, x1) - pad, by0: Math.min(y0, y1) - pad, bx1: Math.max(x0, x1) + pad, by1: Math.max(y0, y1) + pad, lv0: lvAt(x0, y0), lv1: lvAt(x1, y1) });
    acc += l;
  }
  for ( const s of segs ) lmax = Math.max(lmax, s.lv0, s.lv1);
  if ( !lmax ) lmax = 3;
  const halfW = (s) => {
    const e = Math.min(s, plen - s), taper = 0.5 + 0.5 * clamp(e / (1.3 * Rb), 0, 1);
    return Rb * (0.55 + 0.68 * vnoise(s / (1.5 * Rb), 0.5, os + 21) + 0.12 * (vnoise(s / (0.5 * Rb), 2.5, os + 22) - 0.5)) * taper;
  };
  const offOf = (s) => Rb * 0.3 * (vnoise(s / (2.2 * Rb), 3.5, os + 23) - 0.5) * 2;
  return {
    margin: Math.ceil(Rb * 0.5) + 3,
    field(ax, ay) {
      let bd = Infinity, bq = 0, bs = 0, cap = false, lv = 0;
      for ( let k = 0; k < segs.length; k++ ) {
        const g = segs[k];
        if ( ax < g.bx0 || ay < g.by0 || ax > g.bx1 || ay > g.by1 ) continue;
        const px = ax - g.x0, py = ay - g.y0, t = px * g.ux + py * g.uy, tc = clamp(t, 0, g.l);
        const q = py * g.ux - px * g.uy, d2 = (t - tc) ** 2 + q * q;
        if ( d2 < bd ) { bd = d2; bq = q; bs = g.s0 + tc; cap = (k === 0 && t < 0) || (k === segs.length - 1 && t > g.l); lv = g.lv0 + (g.lv1 - g.lv0) * (tc / g.l); }
      }
      if ( bd === Infinity ) return 0;
      const w = halfW(bs), a = cap ? Math.sqrt(bd) : Math.abs(bq - offOf(bs));
      const L = Math.max(1, lv || lmax);
      return L * clamp((w - a) * 0.5 + 0.5, 0, 1);
    }
  };
}

/**
 * The seeds of a collapse's plates: rings of seeds at equal distance to the rim (band b = din / bw), spaced along each ring, so the
 * plates follow the outline - the rim slabs first, the next band inside them. Returns [{ x, y, e, band }] and the band width.
 */
export function collapseSeeds(C, din, W, seed, R) {
  const maxD = Math.max(2, C.maxD), lv1 = C.maxSev < 1.5;
  const bw = lv1 ? clamp(maxD / 2.2, 3, 9) : clamp(maxD / 3.1, 2.2, 6.5);
  const nb = Math.max(1, Math.ceil(maxD / bw));
  const cand = [];
  for ( const i of C.px ) {
    const d = din[i], b = Math.min(nb - 1, Math.floor(d / bw)), mid = (b + 0.5) * bw;
    if ( Math.abs(d - Math.min(mid, maxD)) < 0.75 ) cand.push(i);
  }
  cand.sort((a, b) => h2(a, 7, seed) - h2(b, 7, seed));
  const G = 8, grid = new Map(), seeds = [];
  // (a seed of the same band keeps the ring spacing; one of another band only must not sit on top of it)
  const near = (x, y, r, b) => {
    const g0x = Math.floor((x - r) / G), g1x = Math.floor((x + r) / G), g0y = Math.floor((y - r) / G), g1y = Math.floor((y + r) / G), ro = bw * 0.85;
    for ( let gy = g0y; gy <= g1y; gy++ ) for ( let gx = g0x; gx <= g1x; gx++ ) for ( const s of grid.get(gy * 100003 + gx) ?? [] ) {
      const d2 = (s.x - x) ** 2 + (s.y - y) ** 2;
      if ( d2 < (s.band === b ? r * r : ro * ro) ) return true;
    }
    return false;
  };
  for ( const i of cand ) {
    const x = i % W, y = (i - x) / W, b = Math.min(nb - 1, Math.floor(din[i] / bw));
    // along a ring the plates are longer than the band is wide (slabs along the edge), longer still further in
    const sp = bw * (1.6 + 0.35 * b) + 1.2 + R() * bw * 0.6;
    if ( near(x, y, sp, b) ) continue;
    let e = 0, bd = Infinity;
    C.epi.forEach((q, j) => { const dd = (q.x - x) ** 2 + (q.y - y) ** 2; if ( dd < bd ) { bd = dd; e = j; } });
    const s = { x: x + 0.5 + (R() - 0.5) * 0.6, y: y + 0.5 + (R() - 0.5) * 0.6, e, band: b };
    seeds.push(s);
    const key = Math.floor(s.y / G) * 100003 + Math.floor(s.x / G);
    (grid.get(key) ?? grid.set(key, []).get(key)).push(s);
  }
  if ( !seeds.length ) seeds.push({ x: C.epi[0].x + 0.5, y: C.epi[0].y + 0.5, e: 0, band: 0 });
  return { seeds, bw };
}

/**
 * One plate's fate. ctx: { W, din, maxD, bw, liftK, split, stats, R }; base: the plate ({ px, cx, cy, sv, type, e, ox, oy, u }), cell
 * its fracture cell (seed.band). Returns the shards it becomes ([] = pulverised).
 */
export function collapseFate(ctx, base, cell) {
  const { W, din, bw, liftK, split, stats, R } = ctx;
  let gx = 0, gy = 0, ds = 0;
  for ( const i of base.px ) { gx += (din[i + 1] ?? 0) - (din[i - 1] ?? 0); gy += (din[i + W] ?? 0) - (din[i - W] ?? 0); ds += din[i]; }
  let gl = Math.hypot(gx, gy);
  // inward: up the distance-to-rim field (towards the deepest part); a plate on a flat top falls back to its impact
  let ix = gx / (gl || 1), iy = gy / (gl || 1);
  if ( gl < 0.5 * base.px.length * 0.2 ) { ix = -base.ox; iy = -base.oy; }
  const band = cell.seed.band ?? Math.floor(ds / base.px.length / bw), sv = base.sv;
  const plate = (d, slope, z0, T, th = 0, extra = {}) => ({ ...base, dx: ix * d, dy: iy * d, th, tx: -ix * slope, ty: -iy * slope, z0, T, ...extra });
  if ( sv < 1.5 ) {
    // level 1: sagging ground - the rim ring stays, the plates inside tip a little towards the middle and sink a hair
    if ( band === 0 ) return [{ ...base, dx: 0, dy: 0, th: 0, tx: 0, ty: 0, z0: 0, T: 0 }];
    const d = R() < 0.55 ? 1 : 0, slope = (0.1 + 0.07 * band + R() * 0.05) * liftK;
    return [{ ...plate(0, slope, -0.5 * band, 0), dx: Math.round(ix * d), dy: Math.round(iy * d) }];
  }
  const deep = sv >= 2.45;
  if ( band === 0 ) return [plate((deep ? 0.8 : 0.5) + R() * 1.1, (0.3 + R() * 0.22) * liftK, -1.2, 2, (R() - 0.5) * 0.16)];
  if ( band === 1 ) {
    if ( deep && R() < 0.42 ) { stats.pulverised++; return []; }
    return [plate((deep ? 1.6 : 1.1) + R() * 1.6, ((deep ? 0.62 : 0.5) + R() * 0.3) * liftK, deep ? -3 : -2.4, 2, (R() - 0.5) * 0.3)];
  }
  // the inner bands: pieces on the floor (level 2) or fallen into the void (level 3)
  const gone = deep ? 0.8 : band >= 3 ? 0.4 : 0.3;
  if ( R() < gone ) { stats.pulverised++; return []; }
  const out = [];
  for ( const chip of split(base.px, deep ? 8 + Math.round(R() * 8) : 14 + Math.round(R() * 10), R) ) {
    let ccx = 0, ccy = 0, cd = 0; for ( const i of chip ) { const x = i % W; ccx += x; ccy += (i - x) / W; cd += din[i]; }
    ccx /= chip.length; ccy /= chip.length; cd /= chip.length;
    const d = deep ? Math.max(1, (ctx.maxD - cd) * (0.25 + R() * 0.45)) : 1.2 + R() * 1.8, lat = (R() - 0.5) * 2;
    const tiltA = R() * TAU, slope = R() * (deep ? 0.5 : 0.28) * liftK;
    out.push({ ...base, px: chip, cx: ccx, cy: ccy, dx: ix * d - iy * lat, dy: iy * d + ix * lat, th: (R() - 0.5) * (deep ? 2.4 : 0.9),
      tx: Math.cos(tiltA) * slope, ty: Math.sin(tiltA) * slope, z0: deep ? -4.5 : -3.2, T: 1, chip: deep ? 1 : 0, thrown: false });
    stats.chips++;
  }
  return out;
}

/**
 * The exposed layer of a cave-in at one pixel (depth 0..1, dn its normalised distance to the rim, lit the slope's light from the
 * top left, -1..1): a sloped wall in three tone bands (lit ones lighter), strata lines along the contours of the wall, then the deep
 * void with a faint ambient floor. Returns the colour.
 */
export function collapseShade(pal, seed, x, y, d, depth, lit) {
  const rp = pal.ramp;
  const dz = depth + (vnoise(x / 3, y / 3, seed + 45) - 0.5) * 0.1 + (bayer(x, y) - 0.5) * 0.07;
  const L = lit > 0.18 ? 1 : lit < -0.18 ? -1 : 0;
  // strata: thin layers along the wall's contours (equal distance to the rim), wavering, broken now and then
  const sf = ((d / 2.7 + vnoise(x / 7, y / 7, seed + 49) * 1.1) % 1 + 1) % 1, brk = vnoise(x / 4, y / 4, seed + 50) < 0.3;
  if ( dz < 0.16 ) return L > 0 ? rp[3] : L < 0 ? rp[1] : rp[2];
  if ( dz < 0.42 ) {
    if ( sf < 0.17 && !brk ) return L > 0 ? pal.strata[0] : mul(pal.strata[1], 0.9);
    return L > 0 ? rp[2] : L < 0 ? rp[0] : rp[1];
  }
  if ( dz < 0.62 ) {
    if ( sf < 0.11 && !brk ) return mix(pal.strata[1], pal.void, L > 0 ? 0.15 : 0.45);
    return L > 0 ? rp[1] : mix(rp[0], pal.void, L < 0 ? 0.55 : 0.25);
  }
  // the void: almost black, a faint floor of fallen dirt in patches (dithered), a rare lit grain
  const fl = vnoise(x / 5, y / 5, seed + 47) * 0.8 + vnoise(x / 2, y / 2, seed + 48) * 0.2;
  if ( h2(x, y, seed + 46) < 0.025 ) return rp[1];
  if ( fl > 0.56 && bayer(x, y) < (fl - 0.56) * 3.2 ) return mix(rp[0], pal.void, 0.35);
  return pal.void;
}

/**
 * The torn lip's ink at an intact pixel next to the hole (w: a smooth noise there): long gaps (occluded - the map shows), stretches
 * of light and of mid ink, short full-ink runs. Returns the ink amount (0 = no ink, the pixel is dropped) or 1 to keep it as drawn.
 */
export function collapseLip(x, y, seed) {
  const w = vnoise(x / 5.5, y / 5.5, seed + 91) * 0.8 + vnoise(x / 2, y / 2, seed + 93) * 0.2 + (h2(x, y, seed + 92) - 0.5) * 0.12;
  if ( w > 0.66 ) return 1;
  if ( w > 0.5 ) return 0.55;
  if ( w > 0.38 ) return 0.28;
  return 0;
}
