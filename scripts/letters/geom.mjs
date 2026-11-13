/* LETR: polygon helpers. Contours are flat arrays [x0,y0,x1,y1,...] (closed), y down. Pure. */
import { noise1 } from "./rng.mjs";
import { area } from "./font.mjs";

/* even spacing so warps and edge treatments act everywhere along the outline */
export function resample(c, step) {
  const n = c.length / 2, out = [];
  for ( let i = 0; i < n; i++ ) {
    const ax = c[2 * i], ay = c[2 * i + 1], j = (i + 1) % n, bx = c[2 * j], by = c[2 * j + 1];
    const len = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(len / step));
    for ( let s = 0; s < k; s++ ) out.push(ax + (bx - ax) * s / k, ay + (by - ay) * s / k);
  }
  return out;
}

/* outward normals (outward of the filled region: for a hole they point into the hole) */
export function normals(c) {
  const n = c.length / 2, out = new Float64Array(c.length), sgn = area(c) > 0 ? 1 : -1;
  for ( let i = 0; i < n; i++ ) {
    const p = (i - 1 + n) % n, q = (i + 1) % n;
    let tx = c[2 * q] - c[2 * p], ty = c[2 * q + 1] - c[2 * p + 1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    out[2 * i] = -ty * sgn; out[2 * i + 1] = tx * sgn;
  }
  return out;
}

/* jagged edge: every k-th point is a spike outward, the rest pulled in a little (sharp, cracked letters) */
export function jag(c, amp, period, R) {
  const N = normals(c), n = c.length / 2, out = c.slice();
  let next = R.i(0, period);
  for ( let i = 0; i < n; i++ ) {
    let d = -amp * 0.18;
    if ( i === next ) { d = amp * R.f(0.55, 1.25); next = i + Math.max(2, Math.round(period * R.f(0.6, 1.5))); }
    out[2 * i] += N[2 * i] * d; out[2 * i + 1] += N[2 * i + 1] * d;
  }
  return out;
}

/* low-frequency wobble along the normal (hand-drawn, gritty) */
export function rough(c, amp, freq, seed) {
  const N = normals(c), n = c.length / 2, out = c.slice();
  let s = 0;
  for ( let i = 0; i < n; i++ ) {
    if ( i ) s += Math.hypot(c[2 * i] - c[2 * i - 2], c[2 * i + 1] - c[2 * i - 1]);
    const d = amp * (noise1(s * freq, seed) * 0.75 + noise1(s * freq * 3.1, seed + 7) * 0.25);
    out[2 * i] += N[2 * i] * d; out[2 * i + 1] += N[2 * i + 1] * d;
  }
  return out;
}

/* tiny per-point jitter: "boil", the hand-redrawn line of each picture */
export function boil(c, amp, seed) {
  if ( !amp ) return c;
  const out = c.slice();
  for ( let i = 0; i < out.length; i += 2 ) {
    out[i] += amp * noise1(i * 0.37 + out[i] * 3, seed);
    out[i + 1] += amp * noise1(i * 0.41 + out[i + 1] * 3, seed + 3);
  }
  return out;
}

export function bbox(contours) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const c of contours ) for ( let i = 0; i < c.length; i += 2 ) {
    if ( c[i] < x0 ) x0 = c[i]; if ( c[i] > x1 ) x1 = c[i];
    if ( c[i + 1] < y0 ) y0 = c[i + 1]; if ( c[i + 1] > y1 ) y1 = c[i + 1];
  }
  return x0 === Infinity ? { x0: 0, y0: 0, x1: 0, y1: 0 } : { x0, y0, x1, y1 };
}

export function mapPts(c, f) {
  const out = new Array(c.length);
  for ( let i = 0; i < c.length; i += 2 ) { const p = f(c[i], c[i + 1]); out[i] = p[0]; out[i + 1] = p[1]; }
  return out;
}

/* drips hanging from the lowest edges of a letter (paint, goo, blood): extra contours with the outer winding */
export function drips(contours, R, amount, len) {
  const out = [];
  const outer = contours.filter((c) => Math.abs(area(c)) > 0.02);
  const b = bbox(contours);
  for ( const c of outer ) {
    const N = normals(c), n = c.length / 2, sgn = area(c) > 0 ? 1 : -1;
    const cands = [];
    for ( let i = 0; i < n; i++ ) if ( N[2 * i + 1] > 0.8 && c[2 * i + 1] > b.y1 - 0.12 ) cands.push(i);
    if ( !cands.length ) continue;
    const k = Math.min(cands.length, R.chance(amount) ? R.i(1, 2) : 0);
    for ( let j = 0; j < k; j++ ) {
      const i = cands[R.i(0, cands.length - 1)], x = c[2 * i], y = c[2 * i + 1] - 0.03;
      const w = R.f(0.07, 0.12), L = len * R.f(0.4, 1.1);
      /* teardrop: neck at the edge, round bulb at the end */
      const steps = 14, pts = [];
      pts.push(x - w * 0.55, y);
      pts.push(x - w * 0.42, y + L * 0.55);
      for ( let s = 0; s <= steps; s++ ) { const a = Math.PI + Math.PI * s / steps; pts.push(x + Math.cos(a) * w * 0.6, y + L + Math.sin(a) * -w * 0.6); }
      pts.push(x + w * 0.42, y + L * 0.55);
      pts.push(x + w * 0.55, y);
      if ( (area(pts) > 0 ? 1 : -1) !== sgn ) { const r = []; for ( let q = pts.length - 2; q >= 0; q -= 2 ) r.push(pts[q], pts[q + 1]); out.push(r); } else out.push(pts);
    }
  }
  return out;
}

/* flame licks rising from the top edges (fire): curved tapering tongues, outer winding */
export function flames(contours, R, amount, len, phase = 0) {
  const out = [];
  const b = bbox(contours);
  for ( const c of contours ) {
    if ( Math.abs(area(c)) < 0.02 ) continue;
    const N = normals(c), n = c.length / 2, sgn = area(c) > 0 ? 1 : -1;
    const cands = [];
    for ( let i = 0; i < n; i++ ) if ( N[2 * i + 1] < -0.75 && c[2 * i + 1] < b.y0 + 0.25 ) cands.push(i);
    if ( !cands.length ) continue;
    const k = Math.min(3, Math.max(1, Math.round(cands.length / 18 * amount)));
    for ( let j = 0; j < k; j++ ) {
      const i = cands[Math.floor(((j + 0.5) / k) * cands.length)];
      const x = c[2 * i], y = c[2 * i + 1] + 0.04;
      const w = R.f(0.09, 0.16), L = len * R.f(0.5, 1.15), bend = R.f(-0.18, 0.18) + 0.08 * Math.sin(phase * 2.1 + j);
      const pts = [];
      const steps = 10;
      for ( let s = 0; s <= steps; s++ ) { const t = s / steps; pts.push(x - w * (1 - t) ** 1.3 + bend * t * t * L, y - L * t); }
      for ( let s = steps - 1; s >= 0; s-- ) { const t = s / steps; pts.push(x + w * (1 - t) ** 1.3 + bend * t * t * L + 0.02 * Math.sin(t * 6 + phase), y - L * t); }
      if ( (area(pts) > 0 ? 1 : -1) !== sgn ) { const r = []; for ( let q = pts.length - 2; q >= 0; q -= 2 ) r.push(pts[q], pts[q + 1]); out.push(r); } else out.push(pts);
    }
  }
  return out;
}
