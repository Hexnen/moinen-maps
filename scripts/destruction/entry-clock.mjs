/**
 * The ENTRY CLOCK of an area (display.mjs enter): when the front reaches each point and the moment of every pixel of its ruin and
 * cover. Pure (no PIXI, no canvas), so the clock worker (clock-worker.mjs) makes exactly the same clock from the same inputs as the
 * page: the page plans the pieces from it, the workers compute and sort the per-pixel moments (PERF: ~2 s of main-thread work on a
 * whole-scene Detonate of 'map', 12.6 M pixels).
 */
import { causeLook } from "./cause-fx.mjs";
import { tearClock } from "./tear-entry.mjs";

const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;

/** Per type: reveal delay and duration (ms at speed 1), how the front runs, piece motion. */
export const LOOK = {
  blast:    { delay: 70,  reveal: 420, flight: 1,    arc: 1,    order: "out" },
  collapse: { delay: 200, reveal: 560, flight: 1.1,  arc: 0.35, order: "in" },
  scorch:   { delay: 0,   reveal: 950, flight: 1.3,  arc: 0.5,  order: "out" },
  flood:    { delay: 120, reveal: 680, flight: 1.4,  arc: 0.3,  order: "out" },
  cracks:   { delay: 0,   reveal: 260, flight: 0.8,  arc: 0.6,  order: "out" },
  gash:     { delay: 40,  reveal: 460, flight: 0.9,  arc: 0.7,  order: "wipe" }
};


/** Deterministic hash (0..1) and smooth value noise, for the entry's per-pixel and per-piece timing. */
export function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/**
 * vnoise(X / scale, Y / scale, s) over a known box, the same numbers (same lattice hashes, same arithmetic) from a precomputed grid of
 * the lattice hashes: an entry evaluates it for every pixel of its ruin, and the hashes were most of that cost (PERF). Outside the box:
 * vnoise itself.
 */
export function latticeNoise(x0, y0, x1, y1, scale, s) {
  const gx0 = Math.floor(x0 / scale) - 1, gy0 = Math.floor(y0 / scale) - 1;
  const GW = Math.floor(x1 / scale) - gx0 + 3, GH = Math.floor(y1 / scale) - gy0 + 3;
  if ( !(GW > 0 && GH > 0) || GW * GH > 4e6 ) return (X, Y) => vnoise(X / scale, Y / scale, s);
  // (the grid is made once the function has been asked about as many points as the grid has cells: an entry's pieces alone - a few
  // hundred - read vnoise itself; a clock - every pixel - the grid)
  let G = null, asked = 0;
  return (X, Y) => {
    if ( !G ) {
      if ( ++asked < GW * GH ) return vnoise(X / scale, Y / scale, s);
      G = new Float64Array(GW * GH);
      for ( let j = 0; j < GH; j++ ) for ( let i = 0; i < GW; i++ ) G[j * GW + i] = hash2(gx0 + i, gy0 + j, s);
    }
    const x = X / scale, y = Y / scale, xi = Math.floor(x), yi = Math.floor(y), i = xi - gx0, j = yi - gy0;
    if ( i < 0 || j < 0 || i + 1 >= GW || j + 1 >= GH ) return vnoise(x, y, s);
    const fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), q = j * GW + i;
    const a = G[q], b = G[q + 1], c = G[q + GW], d = G[q + GW + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
/**
 * The front of a stroke that is followed: per path point the time it is reached (the drawing speed; the whole run clamped to
 * 0.35 .. 2.2 s and divided by the entry speed), the head at a time, and when the front reaches any point (its nearest path point
 * plus a little per pixel away from the path). Short taps return null (radial entry). (display.pathFront adds its reach.)
 */
export function pathTimes(path, k) {
  if ( !path || path.length < 2 ) return null;
  const pts = path.map((q) => [q[0], q[1]]);
  let len = 0; const cum = [0];
  for ( let i = 1; i < pts.length; i++ ) { len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(len); }
  if ( len < 12 ) return null;   // a tap: radial
  const T = path[path.length - 1][2] || 0;
  const D = Math.min(2200, Math.max(350, T || len * 6)) * k;
  const tt = path.map((q, i) => T > 0 ? (q[2] || 0) / T * D : cum[i] / len * D);
  const near = (x, y) => {
    let bd = Infinity, bt = 0;
    for ( let i = 1; i < pts.length; i++ ) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], sx = x1 - x0, sy = y1 - y0, l2 = sx * sx + sy * sy || 1;
      const t = clamp01(((x - x0) * sx + (y - y0) * sy) / l2), d = (x - x0 - sx * t) ** 2 + (y - y0 - sy * t) ** 2;
      if ( d < bd ) { bd = d; bt = tt[i - 1] + (tt[i] - tt[i - 1]) * t; }
    }
    return [Math.sqrt(bd), bt];
  };
  const head = (el) => {
    for ( let i = 1; i < pts.length; i++ ) if ( tt[i] >= el ) {
      const f = (el - tt[i - 1]) / ((tt[i] - tt[i - 1]) || 1);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f, pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
    }
    return null;
  };
  return { pts, tt, D, near, head, at: (x, y) => { const [d, t] = near(x, y); return t + d * 4 * k; } };
}

/** The fields of an area's info a clock reads (a plain, cloneable copy). */
export const plainInfo = (i) => ({ x: i.x, y: i.y, w: i.w, h: i.h, ex: i.ex, ey: i.ey, R: i.R, type: i.type, mat: i.mat, cause: i.cause, axis: i.axis, len: i.len,
  rect: { x0: i.rect.x0, y0: i.rect.y0, x1: i.rect.x1, y1: i.rect.y1 } });

/**
 * The clock of an entry (not a cave-in's: collapse-entry.mjs collapseClock replaces delay, reveal, band, arrive and pixelTime).
 * `info` the area's info, `hash` its hash, `o` the impact (default its epicentre), `dir` the stroke direction, `path` the followed
 * stroke, `spine` a tear's own path, `speed` the entry speed, `pathFront` (optional) the display's front of `path`.
 */
export function clockOf({ info, hash, o = null, dir = null, path = null, spine = null, speed = 1, pathFront = undefined }) {
  // the cause tunes the clock on top of the kind's (cause-fx.mjs): rot creeps, lightning strikes, arcane spirals
  const CL = causeLook(info.cause);
  const L = LOOK[info.type] ?? LOOK.blast, k = (1 / (speed || 1)) * (CL?.slow ?? 1);
  const ox = o?.[0] ?? info.ex, oy = o?.[1] ?? info.ey;
  const r = info.rect;
  let wipe = null;
  const d = dir && Math.hypot(dir[0], dir[1]) > 0.1 ? [dir[0] / Math.hypot(dir[0], dir[1]), dir[1] / Math.hypot(dir[0], dir[1])] : null;
  if ( d ) {
    const proj = [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => (x - ox) * d[0] + (y - oy) * d[1]);
    wipe = { u: d, p0: Math.min(...proj, 0) - 2, p1: Math.max(...proj) + 2 };
  }
  const Rmax = Math.max(...[[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => Math.hypot(x - ox, y - oy))) + 2;
  if ( pathFront === undefined ) pathFront = pathTimes(path, k);
  // a tear has its own clock (tear-entry.mjs): a pinprick, then a fast front both ways along its spine on a narrow band
  const tear = info.type === "gash" ? tearClock(info, { pathFront, spine, k }) : null;
  const delay = tear ? tear.delay : pathFront ? 40 * k : L.delay * k;
  const reveal = tear ? tear.reveal : pathFront ? pathFront.D : L.reveal * k * (0.6 + 0.4 * Math.min(2, Rmax / 40));
  const band = tear ? tear.band : info.type === "cracks" ? 45 * k : Math.max(160 * k, reveal * 0.38);
  const front = (x, y) => {   // 0..1: when the front reaches (x, y)
    if ( wipe ) return clamp01((((x - ox) * wipe.u[0] + (y - oy) * wipe.u[1]) - wipe.p0) / (wipe.p1 - wipe.p0));
    // a cave-in runs from the rim of the hole (the impact's reach), not from the corners of the halo
    if ( L.order === "in" ) return 1 - clamp01(Math.hypot(x - ox, y - oy) / (Math.max(6, info.R) + 3));
    return clamp01(Math.hypot(x - ox, y - oy) / Rmax);
  };
  // the front's arrival at a point (ms after start)
  const arrive = tear ? tear.arrive : pathFront ? (x, y) => delay + pathFront.at(x, y)
    : CL ? (CL.curve.length > 1 ? (x, y) => delay + reveal * CL.curve(front(x, y), Math.atan2(y - oy, x - ox)) * 0.85 : (x, y) => delay + reveal * CL.curve(front(x, y)) * 0.85)   // (the angle only for a curve that reads it)
    : (x, y) => delay + reveal * Math.sqrt(front(x, y)) * 0.85;
  const seed = hash % 9973;
  // 0..1, smooth: vnoise(x / 7, y / 7, seed) * 0.65 + vnoise(x / 2.6, y / 2.6, seed + 17) * 0.35, from lattice grids over the area
  const n7 = latticeNoise(r.x0, r.y0, r.x1, r.y1, 7, seed), n26 = latticeNoise(r.x0, r.y0, r.x1, r.y1, 2.6, seed + 17);
  const noise = (x, y) => n7(x, y) * 0.65 + n26(x, y) * 0.35;
  // every pixel's moment (ms after start): the front's arrival, a wide band of smooth noise, a little grain (absolute coordinates,
  // so the ruin and the cover of the same pixel share it)
  const pixelTime = (ax, ay) => arrive(ax, ay) + (noise(ax, ay) - 0.5) * band + (hash2(ax | 0, ay | 0, seed) - 0.5) * band * 0.22;
  return { CL, L, k, ox, oy, wipe, Rmax, pathFront, tear, delay, reveal, band, front, arrive, seed, noise, pixelTime };
}

/**
 * A clock: its pixels sorted by moment (ties in pixel order) as `ix` (pixel index, Uint32) and `tm` (moment, whole ms, Int32) - the
 * order of the keys moment * 2^20 + pixel (a key is `tm[j] * 1048576 + ix[j]`), without a float modulo per pixel to read them back.
 * A counting sort over the moments 0..tmax (linear; the typed-array sort of the keys was ~40% of building a clock).
 */
export function countSort(tm, ix, n, tmax) {
  const oi = new Uint32Array(n), ot = new Int32Array(n);
  if ( !(tmax < 1e7) ) {
    const k = new Float64Array(n); for ( let j = 0; j < n; j++ ) k[j] = tm[j] * 1048576 + ix[j]; k.sort();
    for ( let j = 0; j < n; j++ ) { ot[j] = Math.floor(k[j] / 1048576); oi[j] = k[j] - ot[j] * 1048576; }
    return { ix: oi, tm: ot };
  }
  const cnt = new Uint32Array(tmax + 2);
  for ( let j = 0; j < n; j++ ) cnt[tm[j] + 1]++;
  for ( let t = 1; t <= tmax + 1; t++ ) cnt[t] += cnt[t - 1];
  for ( let j = 0; j < n; j++ ) { const t = tm[j], q = cnt[t]++; ot[q] = t; oi[q] = ix[j]; }
  return { ix: oi, tm: ot };
}

/** The first place j >= from in a clock whose key (tm * 2^20 + ix) is not below `lim` (binary search). */
export function clockUpper(C, from, lim) {
  const tm = C.tm, ix = C.ix;
  let a = from, b = ix.length;
  while ( a < b ) { const m = (a + b) >> 1; if ( tm[m] * 1048576 + ix[m] < lim ) a = m + 1; else b = m; }
  return a;
}

/** The pixel mask clockKeys reads, from RGBA: 0 transparent, 1 opaque, 2 opaque and dark (r + g + b < 150; only when `dark`). */
export function clockMask(data, w, h, dark) {
  const m = new Uint8Array(w * h);
  for ( let i = 0, p = 3; i < w * h; i++, p += 4 ) if ( data[p] ) m[i] = dark && data[p - 3] + data[p - 2] + data[p - 1] < 150 ? 2 : 1;
  return m;
}

/**
 * The sorted clock ({ ix, tm }, countSort) of a w x h image at (x0, y0) (art px) from its pixel mask (clockMask): a dark pixel comes
 * `dark` ms earlier. The same clock as display.clockSlice makes from the pixels themselves.
 */
export function clockKeys(timeOf, mask, w, h, x0, y0, dark) {
  const tm = new Int32Array(w * h), ix = new Uint32Array(w * h);
  let c = 0, tmax = 0;
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    const i = y * w + x, m = mask[i]; if ( !m ) continue;
    let t = timeOf(x0 + x + 0.5, y0 + y + 0.5);
    if ( dark && m === 2 ) t -= dark;
    const v = Math.max(0, Math.round(t));
    tm[c] = v; ix[c++] = i; if ( v > tmax ) tmax = v;
  }
  return countSort(tm, ix, c, tmax);
}
