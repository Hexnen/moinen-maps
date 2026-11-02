/**
 * SUPERHERO: a carried token PLOUGHS through the tokens on its way (the pure parts: no PIXI, no canvas, no game; node tests run them).
 *
 * When a carry stroke is committed (pointer-up, the painting GM) the whole plough is computed ONCE from the scene as it is at that moment and
 * stored in the stroke's `tk`, beside `p`:
 *   tk.hit = [{ id, x0, y0: the pushed token's top-left before, x1, y1: where it ends (scene px; snapped / de-overlapped when the carry snaps),
 *               t0: the moment of contact, p: [cx, cy, t, ...] its CENTRE path in scene px, t in ms on the carry clock at factor k = 1 }]
 * Every client plays the same motion from it; nothing is recomputed. `t` is at k = 1 because the entry clock's factor `k` (entry speed, the
 * cause's slowness) can change after the stroke was painted: pathTimes is LINEAR in k (D = clamp(T) * k, tt = q.t / T * D), so playback
 * multiplies every `t` by the `k` it plays with and the pile stays in step with the carrier at any speed.
 * Like `tk` it is not part of the signature (objStr reads fixed fields): baked pixels and chunk ids cannot change; an older client keeps
 * the field in the flag and ignores it.
 *
 * The model: a BULLDOZER. The carried body follows its recorded path (carry-core displacementAt at k = 1). The first time it touches a free
 * token, that token joins the PILE and from then on is pushed ahead: after every small step the pile is relaxed in join order - a body
 * that overlaps one that joined before it is moved out along the pusher's heading, by exactly the overlap, so it keeps its lateral
 * offset to the pusher (a token hit off centre stays on its own line: pushed straight, not squeezed out) and never lags or sinks in. A body
 * that lies beside or behind the heading (a flank touch) is moved out along the centre line instead. A pushed token that touches another free one brings it into the pile (chain reaction). The pile is limited (MAX_PILE).
 */
import { displacementAt, buildTimeline, snapCentre } from "./carry-core.mjs";

export const MAX_PILE = 12;        // pushed tokens at most (further ones are left alone: the carrier passes them)
export const STEP_MS = 6;          // simulation step (ms on the k = 1 clock) ...
export const STEP_PX = 6;          // ... and at most this far (scene px) for the carrier per step
export const MAX_STEPS = 1500;
export const SAMPLE_TOL = 0.8;     // thinning: a sample the straight line misses by more than this (scene px) is kept
const EPS = 0.01;

const clamp = (v, a, b) => v < a ? a : v > b ? b : a > b ? a : v;

/* ------------------------------------------------------------------ bodies */

/** A body: { cx, cy, w, h, round } (centre and footprint in scene px; round = a disc of the smaller side, else an axis-aligned rectangle). */
export const body = (cx, cy, w, h, round = false) => ({ cx, cy, w, h, round: !!round });

/**
 * How deep two bodies overlap (scene px, > 0 when they do, <= 0 when they do not; 0 when they merely touch). `a` / `b` are bodies, optionally
 * moved to (ax, ay) / (bx, by) (their centres).
 */
export function depth(a, ax, ay, b, bx, by) {
  const dx = bx - ax, dy = by - ay;
  if ( a.round && b.round ) return Math.min(a.w, a.h) / 2 + Math.min(b.w, b.h) / 2 - Math.hypot(dx, dy);
  if ( !a.round && !b.round ) {
    const ox = (a.w + b.w) / 2 - Math.abs(dx), oy = (a.h + b.h) / 2 - Math.abs(dy);
    return ox > 0 && oy > 0 ? Math.min(ox, oy) : Math.min(ox, oy, 0);
  }
  // one disc, one rectangle: the disc centre against the rectangle grown by nothing - the distance to the closest point of the rectangle
  const [r, c, rx, ry, rc] = a.round ? [a, b, bx, by, [ax, ay]] : [b, a, ax, ay, [bx, by]];
  const R = Math.min(r.w, r.h) / 2, hx = c.w / 2, hy = c.h / 2;
  const px = rc[0] - rx, py = rc[1] - ry;            // the disc centre relative to the rectangle centre
  const qx = Math.abs(px) - hx, qy = Math.abs(py) - hy;
  if ( qx <= 0 && qy <= 0 ) return R + Math.min(-qx, -qy);   // the centre is inside the rectangle
  return R - Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
}
export const overlaps = (a, ax, ay, b, bx, by, gap = EPS) => depth(a, ax, ay, b, bx, by) > gap;

/** The smallest s >= 0 such that `a` moved from (ax, ay) by s along the unit (ux, uy) no longer overlaps `b` (fixed). */
export function clearance(a, ax, ay, ux, uy, b) {
  if ( !overlaps(a, ax, ay, b, b.cx, b.cy, EPS) ) return 0;
  let lo = 0, hi = 2 * (Math.hypot(a.w, a.h) / 2 + Math.hypot(b.w, b.h) / 2) + 2;     // far enough to be through and clear, whichever way it points
  for ( let i = 0; i < 28; i++ ) {
    const m = (lo + hi) / 2;
    if ( overlaps(a, ax + ux * m, ay + uy * m, b, b.cx, b.cy, EPS) ) lo = m; else hi = m;
  }
  return hi;
}

/**
 * The first moment a body moving along `tl` (a carry timeline at k = 1: the body's centre is (cx0, cy0) + displacement) touches a fixed
 * body `b`: { t, x, y } (ms on the carry clock, the centre there) or null when it never does. Swept in small steps, refined by bisection.
 */
export function sweepContact(tl, a, b) {
  const out = { x: 0, y: 0, ux: 0, uy: 0, sp: 0 };
  const at = (t) => { displacementAt(tl, t, out); return [a.cx + out.x, a.cy + out.y]; };
  let prev = at(0);
  if ( overlaps(a, prev[0], prev[1], b, b.cx, b.cy) ) return { t: 0, x: prev[0], y: prev[1] };
  const n = stepsFor(tl);
  for ( let i = 1; i <= n; i++ ) {
    const t = tl.D * i / n, cur = at(t);
    if ( overlaps(a, cur[0], cur[1], b, b.cx, b.cy) ) {
      let lo = tl.D * (i - 1) / n, hi = t;
      for ( let j = 0; j < 30; j++ ) { const m = (lo + hi) / 2, q = at(m); if ( overlaps(a, q[0], q[1], b, b.cx, b.cy) ) hi = m; else lo = m; }
      const q = at(hi); return { t: hi, x: q[0], y: q[1] };
    }
    prev = cur;
  }
  return null;
}

/** How many simulation steps a timeline needs: a step is at most STEP_MS long and the carrier moves at most STEP_PX in one. */
function stepsFor(tl) {
  let len = 0; for ( let i = 1; i < tl.n; i++ ) len += Math.hypot(tl.X[i] - tl.X[i - 1], tl.Y[i] - tl.Y[i - 1]);
  return clamp(Math.ceil(Math.max(tl.D / STEP_MS, len / STEP_PX)), 8, MAX_STEPS);
}

/* ------------------------------------------------------------------ the plough */

/**
 * Simulate the plough. `tl` the carrier's timeline at k = 1 (scene px: carry-core buildTimeline), `carrier` its body at the grab point,
 * `others` the free tokens [{ id, ...body }] in a stable order, `rect` the scene rect (a pushed centre stays inside it).
 * Returns { hits: [{ id, body, t0, samples: [[t, cx, cy], ...], ux, uy }] } in the order the tokens joined the pile; deterministic.
 */
export function simulate({ tl, carrier, others, rect = null, maxPile = MAX_PILE }) {
  const out = { x: 0, y: 0, ux: 0, uy: 0, sp: 0 };
  const free = others.map((o) => ({ ...o }));
  const pile = [];                                                     // { src, body, cx, cy, parent, ux, uy, samples, t0 }
  const n = stepsFor(tl), D = tl.D;
  let px = carrier.cx, py = carrier.cy, hux = 0, huy = 0;
  const lim = (m) => rect ? [clamp(m.cx, rect.x, rect.x + rect.width), clamp(m.cy, rect.y, rect.y + rect.height)] : [m.cx, m.cy];
  // the first sample: displacement 0 (the carrier's first point is where it was grabbed)
  const note = (m, t) => { const s = m.samples; const l = s[s.length - 1]; if ( !l || l[0] < t || l[1] !== m.cx || l[2] !== m.cy ) s.push([t, m.cx, m.cy]); };
  const heading = (m, nx, ny) => { const l = Math.hypot(nx - m.cx, ny - m.cy); return l > 1e-9 ? [(nx - m.cx) / l, (ny - m.cy) / l] : [m.ux, m.uy]; };
  const pushDir = (pu, pusher, q) => {                                  // the unit direction a pusher with heading (hu) pushes q along
    let nx = q.cx - pusher.cx, ny = q.cy - pusher.cy; const l = Math.hypot(nx, ny);
    if ( l > 1e-9 ) { nx /= l; ny /= l; }
    let ux = pu[0], uy = pu[1];
    if ( !(Math.hypot(ux, uy) > 1e-9) ) { ux = l > 1e-9 ? nx : 1; uy = l > 1e-9 ? ny : 0; }
    const m = Math.hypot(ux, uy) || 1; ux /= m; uy /= m;
    // never along a direction that leads through the pusher (a body that lies behind the heading is pushed out along the centre line)
    if ( l > 1e-9 && ux * nx + uy * ny < 0.25 ) { ux = nx; uy = ny; }
    return [ux, uy];
  };
  const cur = { cx: px, cy: py, body: carrier, ux: 0, uy: 0 };
  for ( let i = 1; i <= n; i++ ) {
    const t = D * i / n, tp = D * (i - 1) / n;
    displacementAt(tl, t, out);
    const nx = carrier.cx + out.x, ny = carrier.cy + out.y;
    if ( Math.hypot(nx - px, ny - py) > 1e-9 ) { const l = Math.hypot(nx - px, ny - py); hux = (nx - px) / l; huy = (ny - py) / l; }
    const ox = px, oy = py;
    px = nx; py = ny; cur.cx = px; cur.cy = py; cur.ux = hux; cur.uy = huy;
    const prevPos = pile.map((m) => [m.cx, m.cy]);
    for ( let it = 0; it < 4; it++ ) {
      let changed = false;
      // joiners: a free token a pile member (the carrier first) touches
      for ( let ai = -1; ai < pile.length && pile.length < maxPile; ai++ ) {
        const A = ai < 0 ? cur : pile[ai];
        for ( let f = 0; f < free.length && pile.length < maxPile; f++ ) {
          const F = free[f];
          if ( !overlaps(A.body, A.cx, A.cy, F, F.cx, F.cy) ) continue;
          // the moment of contact: the pusher's step from where it was (ao) to where it is (A), bisected
          const ax0 = ai < 0 ? ox : prevPos[ai]?.[0] ?? A.cx, ay0 = ai < 0 ? oy : prevPos[ai]?.[1] ?? A.cy;
          let lo = 0, hi = 1;
          for ( let j = 0; j < 20; j++ ) { const m = (lo + hi) / 2; if ( overlaps(A.body, ax0 + (A.cx - ax0) * m, ay0 + (A.cy - ay0) * m, F, F.cx, F.cy) ) hi = m; else lo = m; }
          const t0 = tp + (t - tp) * hi;
          free.splice(f, 1); f--;
          const m = { id: F.id, body: F, cx: F.cx, cy: F.cy, ux: A.ux || hux, uy: A.uy || huy, parent: ai, t0, samples: [[t0, F.cx, F.cy]] };
          pile.push(m); prevPos.push([m.cx, m.cy]); changed = true;
        }
      }
      // push: in join order, each member out of everything that joined before it (and the carrier)
      for ( let qi = 0; qi < pile.length; qi++ ) {
        const Q = pile[qi];
        for ( let ai = -1; ai < qi; ai++ ) {
          const A = ai < 0 ? cur : pile[ai];
          if ( !overlaps(Q.body, Q.cx, Q.cy, A.body, A.cx, A.cy) ) continue;
          const [ux, uy] = pushDir([A.ux, A.uy], A, Q);
          const s = clearance(Q.body, Q.cx, Q.cy, ux, uy, { ...A.body, cx: A.cx, cy: A.cy });
          if ( s > 0 ) { Q.cx += ux * (s + EPS); Q.cy += uy * (s + EPS); [Q.cx, Q.cy] = lim(Q); changed = true; }
        }
      }
      if ( !changed ) break;
    }
    // each member's heading is where it actually went this step
    for ( let qi = 0; qi < pile.length; qi++ ) {
      const Q = pile[qi], p0 = prevPos[qi];
      if ( p0 ) { const l = Math.hypot(Q.cx - p0[0], Q.cy - p0[1]); if ( l > 1e-6 ) { Q.ux = (Q.cx - p0[0]) / l; Q.uy = (Q.cy - p0[1]) / l; } }
      note(Q, t);
    }
  }
  return { hits: pile.map((m) => ({ id: m.id, body: m.body, t0: m.t0, samples: m.samples, ux: m.ux, uy: m.uy, end: [m.cx, m.cy] })), D };
}

/** Thin a sample list [[t, x, y], ...]: keep the first and the last and every sample the straight line (in time) misses by more than `tol`. Integers. */
export function thin(samples, tol = SAMPLE_TOL) {
  if ( samples.length <= 2 ) return samples.map((s) => [Math.round(s[0]), Math.round(s[1]), Math.round(s[2])]);
  const keep = [0];
  let a = 0;
  for ( let i = 1; i < samples.length - 1; i++ ) {
    // does the line from the last kept sample to the NEXT one stay within tol of every sample between?
    let bad = false;
    const b = i + 1;
    for ( let j = a + 1; j <= i; j++ ) {
      const f = (samples[j][0] - samples[a][0]) / ((samples[b][0] - samples[a][0]) || 1);
      if ( Math.hypot(samples[a][1] + (samples[b][1] - samples[a][1]) * f - samples[j][1], samples[a][2] + (samples[b][2] - samples[a][2]) * f - samples[j][2]) > tol ) { bad = true; break; }
    }
    if ( bad ) { keep.push(i); a = i; }
  }
  keep.push(samples.length - 1);
  const out = [];
  for ( const i of keep ) {
    const s = [Math.round(samples[i][0]), Math.round(samples[i][1]), Math.round(samples[i][2])];
    const l = out[out.length - 1];
    if ( l && s[0] <= l[0] ) s[0] = l[0] + 1;               // times strictly increase (after rounding)
    out.push(s);
  }
  return out;
}

/* ------------------------------------------------------------------ the final places */

/**
 * Where each pushed token ends, so that no two tokens end on the same cell / overlapping. `carrierEnd` the carrier's body at its final place
 * (centre), `members` [{ id, body (with the end centre cx, cy), ux, uy }] in join order, `fixed` the bodies of every token that stays where it
 * is (not carried, not pushed), `snap` { grid, gx, gy, fn? } | null (`fn(x, y, w, h)` -> the snapped top-left, when the grid is not a plain square one), `rect` the scene rect. Returns Map id -> [cx, cy].
 * A member that would end on an occupied place goes along its push direction, a cell (or a quarter of its size) at a time, to the nearest free
 * one; when the whole line is taken, the nearest free place around.
 */
export function resolveFinals({ carrierEnd, members, fixed = [], snap = null, rect = null }) {
  const placed = [carrierEnd, ...fixed];
  const res = new Map();
  const snapC = (m, cx, cy) => {
    if ( !snap ) return [Math.round(cx), Math.round(cy)];
    const [x, y] = snap.fn ? snap.fn(cx - m.w / 2, cy - m.h / 2, m.w, m.h) : snapCentre(cx - m.w / 2, cy - m.h / 2, m.w, m.h, snap.grid, snap.gx, snap.gy);
    return [x + m.w / 2, y + m.h / 2];
  };
  const inside = (c) => rect ? [clamp(c[0], rect.x, rect.x + rect.width), clamp(c[1], rect.y, rect.y + rect.height)] : c;
  const free = (m, c) => placed.every((o) => !overlaps(m, c[0], c[1], o, o.cx, o.cy, 0.5));
  for ( const q of members ) {
    const m = q.body, step = snap ? snap.grid : Math.max(2, Math.min(m.w, m.h) / 4);
    let c = snapC(m, q.cx ?? q.end[0], q.cy ?? q.end[1]);
    c = snap ? c : inside(c);
    if ( !free(m, c) ) {
      const base = c, L = Math.hypot(q.ux, q.uy) || 1, ux = q.ux / L || 1, uy = q.uy / L;
      let found = null;
      for ( let j = 1; j <= 40 && !found; j++ ) { const t = inside(snapC(m, base[0] + ux * step * j, base[1] + uy * step * j)); if ( free(m, t) ) found = t; }
      if ( !found ) {          // nearest free place around: rings of the step
        let best = null, bd = Infinity;
        for ( let r = 1; r <= 8; r++ ) for ( let a = 0; a < 16 * Math.min(r, 2); a++ ) {
          const ang = a / (16 * Math.min(r, 2)) * Math.PI * 2, t = inside(snapC(m, base[0] + Math.cos(ang) * step * r, base[1] + Math.sin(ang) * step * r));
          if ( free(m, t) ) { const d = Math.hypot(t[0] - base[0], t[1] - base[1]); if ( d < bd ) { bd = d; best = t; } }
        }
        found = best;
      }
      if ( found ) c = found;
    }
    res.set(q.id, c);
    placed.push({ ...m, cx: c[0], cy: c[1] });
  }
  return res;
}

/* ------------------------------------------------------------------ the record */

/**
 * The `tk.hit` of a stroke. `tk` the carry record (as makeTk made it: x0, y0, x1, y1 the carrier's top-left start and end, p the path in
 * ART px), `geo` { ap, ox, oy }, `carrier` { w, h, round }, `others` [{ id, x, y (top-left), w, h, round }], `rect` the scene rect,
 * `snap` { grid, gx, gy } | null. Returns the array (possibly empty); the order of the tokens in `others` does not matter (sorted by id).
 */
export function ploughRecord({ tk, geo, carrier, others, rect = null, snap = null, maxPile = MAX_PILE }) {
  const tl = buildTimeline(tk, { ...geo, k: 1 });
  if ( !tl || !others?.length ) return [];
  const cb = body(tk.x0 + carrier.w / 2, tk.y0 + carrier.h / 2, carrier.w, carrier.h, carrier.round);
  const list = others.filter((o) => o && o.id !== tk.id).map((o) => ({ id: o.id, ...body(o.x + o.w / 2, o.y + o.h / 2, o.w, o.h, o.round) }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sim = simulate({ tl, carrier: cb, others: list, rect, maxPile });
  if ( !sim.hits.length ) return [];
  const pile = new Set(sim.hits.map((h) => h.id));
  const carrierEnd = body(tk.x1 + carrier.w / 2, tk.y1 + carrier.h / 2, carrier.w, carrier.h, carrier.round);
  const members = sim.hits.map((h) => ({ id: h.id, body: h.body, cx: h.end[0], cy: h.end[1], ux: h.ux, uy: h.uy }));
  const fixed = list.filter((o) => !pile.has(o.id));
  const fin = resolveFinals({ carrierEnd, members, fixed, snap, rect });
  const hits = [];
  for ( const h of sim.hits ) {
    const [fx, fy] = fin.get(h.id), s0 = h.samples;
    const p = thin(s0).flatMap(([t, x, y]) => [x, y, t]);
    hits.push({ id: h.id, x0: Math.round(h.body.cx - h.body.w / 2), y0: Math.round(h.body.cy - h.body.h / 2),
      x1: Math.round(fx - h.body.w / 2), y1: Math.round(fy - h.body.h / 2), t0: Math.round(h.t0), p });
  }
  return hits;
}

/* ------------------------------------------------------------------ reading a record */

/** Is `h` a usable hit record? */
export function validHit(h) {
  if ( !h || typeof h !== "object" || typeof h.id !== "string" || !h.id ) return false;
  if ( ![h.x0, h.y0, h.x1, h.y1].every(Number.isFinite) ) return false;
  const p = h.p;
  if ( !Array.isArray(p) || p.length < 6 || p.length % 3 || !p.every(Number.isFinite) ) return false;
  for ( let i = 5; i < p.length; i += 3 ) if ( p[i] < p[i - 3] ) return false;
  return true;
}

/** The usable hits of a carry record (an older or damaged one: none), at most MAX_PILE, each id once, never the carried token. */
export function hitsOf(tk) {
  const a = tk?.hit; if ( !Array.isArray(a) ) return [];
  const seen = new Set([tk.id]), out = [];
  for ( const h of a ) { if ( out.length >= MAX_PILE ) break; if ( validHit(h) && !seen.has(h.id) ) { seen.add(h.id); out.push(h); } }
  return out;
}

/**
 * The timeline of a pushed token (the shape carry-core displacementAt reads): its centre path in scene px, the times multiplied by the
 * entry clock's factor `k`. The token's centre at the first point; `D` is the time of the last point.
 */
export function buildHitTimeline(h, { k = 1 } = {}) {
  if ( !validHit(h) ) return null;
  const n = h.p.length / 3, X = new Float64Array(n), Y = new Float64Array(n), tt = new Float64Array(n);
  for ( let i = 0; i < n; i++ ) { X[i] = h.p[3 * i]; Y[i] = h.p[3 * i + 1]; tt[i] = h.p[3 * i + 2] * k; }
  return { n, X, Y, tt, D: tt[n - 1], x0: X[0], y0: Y[0], dx: X[n - 1] - X[0], dy: Y[n - 1] - Y[0], i: 0 };
}

/* ------------------------------------------------------------------ the pile head is the destruction's front */

export const FRONT_RATE = 1;       // px / ms: how fast the head's lead over the carrier may grow or shrink (a token joining does not make the front jump)
export const MAX_FRONT_PTS = 400;

/**
 * THE PILE HEAD LEADS THE ENTRY. With tokens ploughed, the destruction's front is not the carrier but the head of the pile: at every moment the
 * point on the carried token's heading that lies as far ahead as the farthest pushed token (its lead over the carrier along the heading, rate
 * limited and never taking the head back). The result is the path the entry runs along instead of the carrier's: [[x, y, ms], ...] in ART px
 * with ms on the stroke's own (hand) clock, so entry-clock pathTimes gives it the very same run D as the carrier's (first point 0, last point the
 * same T) and a carrier's own pose is untouched (it keeps tk.p). Null when nobody is pushed (the entry then runs along tk.p exactly as before).
 * Deterministic from the record: the same on every client, for a live entry and a replay.
 */
export function frontPath(tk, geo, { rate = FRONT_RATE } = {}) {
  const hits = hitsOf(tk); if ( !hits.length ) return null;
  const tl = buildTimeline(tk, { ...geo, k: 1 }); if ( !tl ) return null;
  const T = tk.p[tk.p.length - 1] || 0, D1 = tl.D; if ( !(T > 0) || !(D1 > 0) ) return null;
  const scale = T / D1, { ap = 1, ox = 0, oy = 0 } = geo;
  // the moments: the carrier's own samples and every pushed token's
  let ts = new Set([0, D1]); for ( let i = 0; i < tl.n; i++ ) ts.add(tl.tt[i]);
  for ( const h of hits ) { for ( let i = 2; i < h.p.length; i += 3 ) ts.add(Math.min(D1, h.p[i])); ts.add(Math.max(0, h.p[2] - 1)); }    // (and just before a contact: the head stays on the carrier until then)
  for ( let t = 25; t < D1; t += 25 ) ts.add(t);                                  // (a sample at least every 25 ms: the lead ramps, it does not interpolate across a gap)
  ts = [...ts].filter((t) => t >= 0 && t <= D1).sort((a, b) => a - b);
  if ( ts.length > MAX_FRONT_PTS ) { const s = (ts.length - 1) / (MAX_FRONT_PTS - 1); ts = Array.from({ length: MAX_FRONT_PTS }, (_, i) => ts[Math.round(i * s)]); }
  const ht = hits.map((h) => ({ h, n: h.p.length / 3, i: 1 }));
  const at = (e, t, out) => {       // a hit's centre at t (linear on its samples), false before its contact
    const p = e.h.p; if ( t < p[2] ) return false;
    while ( e.i < e.n - 1 && p[e.i * 3 + 2] < t ) e.i++;
    while ( e.i > 1 && p[(e.i - 1) * 3 + 2] >= t ) e.i--;
    const a = (e.i - 1) * 3, b = e.i * 3, f = p[b + 2] > p[a + 2] ? Math.min(1, (t - p[a + 2]) / (p[b + 2] - p[a + 2])) : 1;
    out[0] = p[a] + (p[b] - p[a]) * f; out[1] = p[a + 1] + (p[b + 1] - p[a + 1]) * f; return true;
  };
  const o = { x: 0, y: 0, ux: 0, uy: 0, sp: 0 }, q = [0, 0], out = [];
  let ux = 1, uy = 0, eff = 0, pt = 0, ppx = tl.X[0], ppy = tl.Y[0];
  for ( let j = 0; j < ts.length; j++ ) {
    const t = ts[j];
    displacementAt(tl, t, o);
    const px = tl.X[0] + o.x, py = tl.Y[0] + o.y;
    if ( o.ux || o.uy ) { ux = o.ux; uy = o.uy; }
    let raw = 0;
    for ( const e of ht ) if ( at(e, t, q) ) raw = Math.max(raw, (q[0] - px) * ux + (q[1] - py) * uy);
    const dt = t - pt, step = Math.hypot(px - ppx, py - ppy);
    eff = clamp(raw, Math.max(0, eff - step), eff + rate * dt);     // (never back: the head only falls behind as far as the carrier has moved)
    pt = t; ppx = px; ppy = py;
    const ms = j === 0 ? 0 : j === ts.length - 1 ? T : t * scale;
    out.push([Math.round(((px + ux * eff - ox) / ap) * 100) / 100, Math.round(((py + uy * eff - oy) / ap) * 100) / 100, ms]);
  }
  return out;
}

/**
 * Where tokens are once the carries that are COMMITTED BUT NOT YET PLAYED have moved them: a stroke drawn while an earlier one is still waiting
 * for its bake must see (and grab, and plough) the tokens where that one is about to put them, not where their documents still are. `pending`
 * the not yet applied real carries in commit order [{ tk }]; returns { x, y } (top-left) for the token or null (untouched).
 */
export function pendingPosition(pending, id) {
  let pos = null;
  for ( const p of pending ?? [] ) {
    const tk = p?.tk; if ( !tk || tk.e ) continue;
    if ( tk.id === id ) pos = { x: tk.x1, y: tk.y1 };
    for ( const h of hitsOf(tk) ) if ( h.id === id ) pos = { x: h.x1, y: h.y1 };
  }
  return pos;
}
