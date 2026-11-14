/* LETR impact frames: the ink shapes as plain geometry (flat [x, y, x, y, ...] polygons in px). Pure and seeded: the same seed draws
   the same star, lines and splash on every client. draw.mjs fills them. */
import { rng } from "../rng.mjs";

const TAU = Math.PI * 2;

/* a burst star: spikes alternate between the outer radius and an inner one; `stretch` lengthens it along `ang`; a few spikes run long */
export function star(seed, o) {
  const R = rng(seed);
  const n = o.spikes ?? 16, inner = o.inner ?? 0.55, jit = o.jitter ?? 0.22, st = o.stretch ?? 1, ang = o.ang ?? 0, long = o.long ?? 0;
  const rot = o.rot ?? R.f(0, TAU);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const longAt = new Set(); for ( let i = 0; i < long; i++ ) longAt.add(R.i(0, n - 1));
  const pts = [];
  for ( let i = 0; i < n * 2; i++ ) {
    const tip = i % 2 === 0;
    const a = rot + (i / (n * 2)) * TAU + (tip ? R.f(-0.35, 0.35) : R.f(-0.15, 0.15)) * (TAU / (n * 2));
    let r = o.r * (tip ? 1 + R.f(-jit, jit) : inner * (1 + R.f(-jit, jit) * 0.6));
    if ( tip && longAt.has(i / 2) ) r *= 1.45;
    /* stretch along the blow: scale the component along (ca, sa) */
    let x = Math.cos(a) * r, y = Math.sin(a) * r;
    const al = x * ca + y * sa, pe = -x * sa + y * ca;
    x = al * st * ca - pe * sa; y = al * st * sa + pe * ca;
    pts.push(o.cx + x, o.cy + y);
  }
  return pts;
}

/* focus lines: thin wedges from far outside the picture pointing at the centre, stopping at a ragged inner edge.
   -> [[x1, y1, x2, y2, x3, y3], ...] (base corner, base corner, tip) */
export function focusLines(seed, o) {
  const R = rng(seed);
  const n = o.n ?? 56, out = [];
  const rOut = o.rOut, rIn = o.rIn, ex = o.ex ?? 1, ey = o.ey ?? 1;
  let a = R.f(0, TAU);
  for ( let i = 0; i < n; i++ ) {
    a += (TAU / n) * R.f(0.45, 1.55);
    const w = (TAU / n) * (!o.thin && R.chance(0.22) ? R.f(0.5, 0.95) : R.f(0.1, 0.42)) * (o.fat ?? 1);
    const tip = rIn * R.f(0.85, 1.9);
    const c = Math.cos(a), s = Math.sin(a);
    out.push([o.cx + Math.cos(a - w / 2) * rOut, o.cy + Math.sin(a - w / 2) * rOut, o.cx + Math.cos(a + w / 2) * rOut, o.cy + Math.sin(a + w / 2) * rOut,
      o.cx + c * tip * ex, o.cy + s * tip * ey]);
  }
  return out;
}

/* speed lines: long tapered streaks along `ang` across the whole picture, thinning toward where the blow goes; a band round the
   centre (`gap`, px) stays clear. -> quads [x1, y1, x2, y2, x3, y3, x4, y4] */
export function speedLines(seed, o) {
  const R = rng(seed);
  const n = o.n ?? 44, out = [];
  const ca = Math.cos(o.ang), sa = Math.sin(o.ang), D = Math.hypot(o.W, o.H);
  for ( let i = 0; i < n; i++ ) {
    let off = R.f(-0.5, 0.5) * D;
    if ( Math.abs(off) < (o.gap ?? 0) ) off = Math.sign(off || 1) * ((o.gap ?? 0) + R.f(0, D * 0.08));
    const len = D * R.f(0.45, 1.3), start = R.f(-0.8, 0.1) * D;
    const w = D * (R.chance(0.14) ? R.f(0.01, 0.024) : R.f(0.0012, 0.0055)) * (o.fat ?? 1);
    const bx = o.cx - sa * off + ca * start, by = o.cy + ca * off + sa * start;
    const ex = bx + ca * len, ey = by + sa * len;
    out.push([bx - sa * w, by + ca * w, bx + sa * w, by - ca * w, ex + sa * w * 0.12, ey - ca * w * 0.12, ex - sa * w * 0.12, ey + ca * w * 0.12]);
  }
  return out;
}

/* an ink splash: round blobs and thrown drops (a drop = a teardrop polygon pointing away from the centre), thrown mostly along `ang`
   (null = all round). -> { blobs: [[x, y, r]], drops: [[...polygon]] } */
export function splat(seed, o) {
  const R = rng(seed);
  const n = o.n ?? 22, blobs = [], drops = [];
  const spread = o.ang == null ? Math.PI : (o.spread ?? 0.9);
  for ( let i = 0; i < n; i++ ) {
    const a = (o.ang ?? 0) + R.f(-spread, spread) * (R.chance(0.75) ? 1 : 1.8);
    const d = o.r * Math.pow(R(), 0.6) * R.f(0.25, 1.25);
    const r = o.r * 0.16 * Math.pow(R(), 2.2) + o.r * 0.012;
    const x = o.cx + Math.cos(a) * d, y = o.cy + Math.sin(a) * d;
    if ( R.chance(0.45) ) {
      const l = r * R.f(2.4, 5.5), c = Math.cos(a), s = Math.sin(a), p = [];
      for ( let k = 0; k <= 10; k++ ) { const t = (k / 10) * Math.PI; p.push(x + c * r * 0.2 + Math.cos(a - Math.PI / 2 + t) * r, y + s * r * 0.2 + Math.sin(a - Math.PI / 2 + t) * r); }
      p.push(x - c * l, y - s * l);
      drops.push(p);
    } else blobs.push([x, y, r]);
  }
  blobs.push([o.cx, o.cy, o.r * 0.2], [o.cx + R.f(-1, 1) * o.r * 0.12, o.cy + R.f(-1, 1) * o.r * 0.12, o.r * 0.15]);
  return { blobs, drops };
}

/* halftone: a tilted grid of dots that shrink away from the centre, inside a fan round `ang` (null = all round), between r0 and r1.
   -> [[x, y, r], ...] */
export function dots(seed, o) {
  const R = rng(seed);
  const pitch = Math.max(6, o.pitch ?? 16), tilt = o.tilt ?? R.f(0.2, 1.1), out = [];
  const ct = Math.cos(tilt), stn = Math.sin(tilt), fan = o.fan ?? Math.PI, N = Math.ceil(o.r1 / pitch) + 1;
  for ( let j = -N; j <= N; j++ ) for ( let i = -N; i <= N; i++ ) {
    const gx = (i + (j & 1) * 0.5) * pitch, gy = j * pitch * 0.866;
    const x = gx * ct - gy * stn, y = gx * stn + gy * ct, d = Math.hypot(x, y);
    if ( d < o.r0 || d > o.r1 ) continue;
    if ( o.ang != null ) { let da = Math.atan2(y, x) - o.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); if ( Math.abs(da) > fan ) continue; }
    const k = 1 - (d - o.r0) / (o.r1 - o.r0);
    const r = pitch * 0.5 * Math.pow(k, 0.8) * 0.98;
    if ( r > 0.7 ) out.push([o.cx + x, o.cy + y, r]);
  }
  return out;
}

/* a tear across the picture through the centre along `ang`: a zigzag band, widest at the centre.
   -> { band: polygon, sideA: polygon (the half on one side, for the split backdrop), sideB: polygon } */
export function tear(seed, o) {
  const R = rng(seed);
  const ca = Math.cos(o.ang), sa = Math.sin(o.ang), D = Math.hypot(o.W, o.H) * 1.1, n = o.n ?? 15;
  const up = [], dn = [], mid = [];
  for ( let i = 0; i <= n; i++ ) {
    const t = i / n, u = (t - 0.5) * 2 * D;
    const zig = (i % 2 ? 1 : -1) * o.w * R.f(0.5, 1.6) * 0.6;
    const half = o.w * (0.15 + 0.85 * Math.pow(1 - Math.abs(t - 0.5) * 2, 0.7)) * R.f(0.6, 1.2);
    const mx = o.cx + ca * u - sa * zig, my = o.cy + sa * u + ca * zig;
    mid.push(mx, my);
    up.push(mx - sa * half, my + ca * half); dn.push(mx + sa * half, my - ca * half);
  }
  const rev = (p) => { const o2 = []; for ( let i = p.length - 2; i >= 0; i -= 2 ) o2.push(p[i], p[i + 1]); return o2; };
  const far = (sgn) => [o.cx + ca * D - sa * D * sgn, o.cy + sa * D + ca * D * sgn, o.cx - ca * D - sa * D * sgn, o.cy - sa * D + ca * D * sgn];
  return { band: [...up, ...rev(dn)], sideA: [...mid, ...far(1)], sideB: [...mid, ...far(-1)] };
}

/* cracks: ragged tapering fracture lines running out from the centre, and loose shards between them.
   -> { cracks: [polygon], shards: [polygon (triangles)] } */
export function cracks(seed, o) {
  const R = rng(seed);
  const n = o.n ?? 9, out = { cracks: [], shards: [] };
  let a = R.f(0, TAU);
  for ( let i = 0; i < n; i++ ) {
    a += (TAU / n) * R.f(0.6, 1.4);
    const len = o.r * R.f(0.55, 1.25), segs = 5 + R.i(0, 3);
    const L = [], Rr = [];
    let x = o.cx, y = o.cy, dir = a;
    for ( let k = 0; k <= segs; k++ ) {
      const t = k / segs, w = o.w * (1 - t) * (1 - t) + 0.6;
      L.push(x - Math.sin(dir) * w, y + Math.cos(dir) * w); Rr.unshift([x + Math.sin(dir) * w, y - Math.cos(dir) * w]);
      dir = a + R.f(-0.55, 0.55);
      x += Math.cos(dir) * (len / segs); y += Math.sin(dir) * (len / segs);
    }
    out.cracks.push([...L, ...Rr.flat()]);
    if ( R.chance(0.8) ) {
      const d = o.r * R.f(0.3, 1.05), sa = a + (TAU / n) * R.f(0.25, 0.75), s = o.r * R.f(0.05, 0.16), ta = R.f(0, TAU);
      const sx = o.cx + Math.cos(sa) * d, sy = o.cy + Math.sin(sa) * d, p = [];
      for ( let k = 0; k < 3; k++ ) { const q = ta + k * (TAU / 3) + R.f(-0.5, 0.5); p.push(sx + Math.cos(q) * s * R.f(0.6, 1.4), sy + Math.sin(q) * s * R.f(0.6, 1.4)); }
      out.shards.push(p);
    }
  }
  return out;
}

/* shock rings: thick broken arcs round the centre. -> [{ r, w, a0, a1 }] */
export function rings(seed, o) {
  const R = rng(seed);
  const out = [];
  for ( let k = 0; k < (o.n ?? 2); k++ ) {
    const r = o.r * (1 - k * 0.3), w = o.w * (1 - k * 0.35);
    let a = R.f(0, TAU);
    const parts = 3 + R.i(0, 2);
    for ( let i = 0; i < parts; i++ ) { const len = (TAU / parts) * R.f(0.55, 0.9); out.push({ r, w, a0: a, a1: a + len }); a += TAU / parts; }
  }
  return out;
}

/* what a shock ring throws off: small ragged chunks just outside its rim and short ticks running outward.
   -> { chunks: [polygon], ticks: [[x1, y1, x2, y2, x3, y3]] } */
export function chunks(seed, o) {
  const R = rng(seed);
  const n = o.n ?? 14, flat = o.flat ?? 1, out = { chunks: [], ticks: [] };
  for ( let i = 0; i < n; i++ ) {
    const a = R.f(0, TAU), d = o.r * R.f(1.0, 1.35), s = o.size * R.f(0.5, 1.4);
    const x = o.cx + Math.cos(a) * d, y = o.cy + Math.sin(a) * d * flat, p = [], k = 3 + R.i(0, 2), t0 = R.f(0, TAU);
    for ( let j = 0; j < k; j++ ) { const q = t0 + (j / k) * TAU + R.f(-0.4, 0.4); p.push(x + Math.cos(q) * s * R.f(0.5, 1.3), y + Math.sin(q) * s * R.f(0.5, 1.3)); }
    out.chunks.push(p);
  }
  for ( let i = 0; i < Math.round(n * 1.4); i++ ) {
    const a = R.f(0, TAU), r0 = o.r * R.f(1.08, 1.3), r1 = r0 + o.r * R.f(0.12, 0.3), w = R.f(0.008, 0.02);
    out.ticks.push([o.cx + Math.cos(a - w) * r0, o.cy + Math.sin(a - w) * r0 * flat, o.cx + Math.cos(a + w) * r0, o.cy + Math.sin(a + w) * r0 * flat,
      o.cx + Math.cos(a) * r1, o.cy + Math.sin(a) * r1 * flat]);
  }
  return out;
}

/* puffs of dust: little clusters of round lumps thrown mostly along `ang` (null = all round). -> [[[x, y, r], ...], ...] one list per puff */
export function puffs(seed, o) {
  const R = rng(seed);
  const n = o.n ?? 6, spread = o.ang == null ? Math.PI : 1.1, out = [];
  for ( let i = 0; i < n; i++ ) {
    const a = (o.ang ?? 0) + R.f(-spread, spread), d = o.r * R.f(0.45, 1), s = o.size * R.f(0.6, 1.3);
    const x = o.cx + Math.cos(a) * d, y = o.cy + Math.sin(a) * d, lumps = [];
    for ( let k = 0; k < 4; k++ ) lumps.push([x + R.f(-0.6, 0.6) * s, y + R.f(-0.6, 0.6) * s, s * R.f(0.45, 0.8)]);
    out.push(lumps);
  }
  return out;
}

/* a tapered streak from (x0, y0) to (x1, y1), widest at its front end. -> { outer, inner } polygons */
export function streak(seed, o) {
  const R = rng(seed);
  const dx = o.x1 - o.x0, dy = o.y1 - o.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, n = 9;
  const side = (k) => { const up = [], dn = []; for ( let i = 0; i <= n; i++ ) { const t = i / n, w = o.w * k * Math.pow(t, 0.7) * R.f(0.85, 1.1), x = o.x0 + dx * t, y = o.y0 + dy * t; up.push(x - uy * w, y + ux * w); dn.push(x + uy * w, y - ux * w); } const rv = []; for ( let i = dn.length - 2; i >= 0; i -= 2 ) rv.push(dn[i], dn[i + 1]); return [...up, ...rv]; };
  return { outer: side(1), inner: side(0.5) };
}

/* bounds of a flat polygon: { x0, y0, x1, y1 } */
export function boundsOf(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( let i = 0; i < p.length; i += 2 ) { if ( p[i] < x0 ) x0 = p[i]; if ( p[i] > x1 ) x1 = p[i]; if ( p[i + 1] < y0 ) y0 = p[i + 1]; if ( p[i + 1] > y1 ) y1 = p[i + 1]; }
  return { x0, y0, x1, y1 };
}
/* area of a flat polygon (absolute) */
export function areaOf(p) {
  let a = 0;
  for ( let i = 0, n = p.length; i < n; i += 2 ) { const j = (i + 2) % n; a += p[i] * p[j + 1] - p[j] * p[i + 1]; }
  return Math.abs(a) / 2;
}
