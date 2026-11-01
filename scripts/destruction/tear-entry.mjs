/**
 * The TEAR's entry (display side; the bake is tear.mjs). The rip starts as a pinprick and runs along its spine with a fast tearing
 * front: the ruin dissolves in on a soft, narrow band behind the front (the display's per-pixel erosion; its dark slit comes first),
 * the lips, cut into pieces, peel apart from the closed state (they rise out of the map as they go, flutter by a pixel, lift a
 * little, snap one pixel past their rest and settle), fibres stretch and snap at the front (pale flecks flicked apart), crumbs of the material spill sideways, and each
 * tip snaps with a small burst. Without "follows the stroke" the puncture lies on the spine (where the bake put it) and the rip runs
 * both ways; with it the rip starts at the stroke's start and runs at the drawing speed. Reduced motion: the display's fade.
 */

const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Crumb colours (light, dark) by material index (core MATS: grass, earth, stone, wood, sand, snow, water, metal). */
const CRUMB = [[0x7a5a36, 0x5a3e26], [0x8a6844, 0x5a4030], [0xb0aca4, 0x6e6a64], [0xe0b070, 0x7a4e2a], [0xdcc48e, 0xa89060], [0xf6f9ff, 0xb8c6d8], [0xa8d0ec, 0x4a6880], [0xe6ecf2, 0xffd890]];
/** The pale fibre flicked off when a strand snaps. */
const FIBRE = [0xb8a070, 0xd8c8a8, 0xd8d4cc, 0xf0d0a0, 0xf0e2c0, 0xffffff, 0xd8ecff, 0xfff4d8];

/**
 * When the front reaches each point. `pathFront` (follows the stroke) wins; else the stroke's own path (`spine`, art px) with the
 * puncture at the base's epicentre, running both ways; else the area's axis through the puncture.
 */
export function tearClock(info, { pathFront, spine, k }) {
  let msPx = 2.4 * k;
  const delay = 70 * k, px = info.ex, py = info.ey;
  const fin = (D, arrive, heads, tips, punct) => ({ delay, reveal: D, band: Math.max(70 * k, D * 0.16), arrive, heads, tips, punct, msPx });
  if ( pathFront ) {
    const P = pathFront, end = P.pts[P.pts.length - 1];
    return fin(P.D, (x, y) => delay + P.at(x, y), (el) => { const h = P.head(el - delay); return h ? [h] : []; },
      [{ x: end[0], y: end[1], at: delay + P.D }], P.pts[0]);
  }
  const pts = spine?.length > 1 ? spine.map((q) => [q[0], q[1]]) : null;
  let len = 0; const cum = [0];
  if ( pts ) for ( let i = 1; i < pts.length; i++ ) { len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(len); }
  if ( pts && len >= 12 ) {
    const near = (x, y) => {
      let bd = Infinity, bc = 0;
      for ( let i = 1; i < pts.length; i++ ) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], sx = x1 - x0, sy = y1 - y0, l2 = sx * sx + sy * sy || 1;
        const t = clamp01(((x - x0) * sx + (y - y0) * sy) / l2), d = (x - x0 - sx * t) ** 2 + (y - y0 - sy * t) ** 2;
        if ( d < bd ) { bd = d; bc = cum[i - 1] + (cum[i] - cum[i - 1]) * t; }
      }
      return [Math.sqrt(bd), bc];
    };
    const cp = near(px, py)[1];
    // a rip that forms, not one that switches on: its front runs out to the farther tip in about a third of a second, whatever its length
    msPx = Math.min(10, Math.max(2.4, 340 / Math.max(1, cp, len - cp))) * k;
    const pointAt = (c) => {
      for ( let i = 1; i < pts.length; i++ ) if ( cum[i] >= c ) {
        const f = (c - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
        return [pts[i - 1][0] + dx * f, pts[i - 1][1] + dy * f, dx, dy];
      }
      return null;
    };
    const D = Math.max(cp, len - cp) * msPx;
    return fin(D, (x, y) => { const [d, c] = near(x, y); return delay + Math.abs(c - cp) * msPx + d * 2 * k; },
      (el) => { const u = (el - delay) / msPx, out = []; if ( u < 0 ) return out;
        for ( const c of [cp - u, cp + u] ) if ( c >= 0 && c <= len ) { const h = pointAt(c); if ( h ) out.push(c < cp ? [h[0], h[1], -h[2], -h[3]] : h); }
        return out; },
      [{ x: pts[0][0], y: pts[0][1], at: delay + cp * msPx }, { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1], at: delay + (len - cp) * msPx }], [px, py]);
  }
  // no path: along the axis through the puncture, both ways, as far as the area reaches
  const ux = Math.cos(info.axis), uy = Math.sin(info.axis), r = info.rect;
  const proj = [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => (x - px) * ux + (y - py) * uy);
  const half = Math.max(4, info.len / 2), lo = Math.max(Math.min(...proj), -half * 1.6), hi = Math.min(Math.max(...proj), half * 1.6);
  msPx = Math.min(10, Math.max(2.4, 340 / Math.max(1, -lo, hi))) * k;
  const D = Math.max(-lo, hi) * msPx;
  return fin(D, (x, y) => { const t = (x - px) * ux + (y - py) * uy, n = Math.abs((y - py) * ux - (x - px) * uy); return delay + Math.abs(t) * msPx + n * 2 * k; },
    (el) => { const u = (el - delay) / msPx, out = []; if ( u < 0 ) return out;
      if ( u <= hi ) out.push([px + ux * u, py + uy * u, ux, uy]); if ( -u >= lo ) out.push([px - ux * u, py - uy * u, -ux, -uy]); return out; },
    [{ x: px + ux * hi, y: py + uy * hi, at: delay + hi * msPx }, { x: px + ux * lo, y: py + uy * lo, at: delay - lo * msPx }], [px, py]);
}

/**
 * A tear piece's life (its part from the bake, field 14 of the sheet: p.tk). Every motion ends at t = 1 in the pose the bake drew
 * (nothing moves after ~2 s, the area can be flattened again):
 *   0 a lip flap: shown closed just before the front (the gap under it never flashes), it peels open lifting by its own height,
 *     flutters by 1-2 px, foreshortened while it is up, drops back with a snap one pixel past its rest; flaps staggered along the front
 *   2 a curled fold: once its flap is open it flips over from the gap edge onto its lip (small at the hinge, overshoots, flutters)
 *   3 a strip that tears off: peels open with its lip, hangs there fluttering, then drops into the gap
 *   4 a snapping fibre: held taut across the gap after the front passes, it snaps (one by one) and flicks back to hang
 */
export function tearPiece(p, n, seed, clock, start, k) {
  const hA = hash2(n, 1, seed), hB = hash2(n, 2, seed), hC = hash2(n, 3, seed), kind = p.tk | 0, q = p.tq | 0;
  const arr = start + clock.arrive(p.sx, p.sy);
  const it = { p, pre: clock.band + 60 * k, arc: 0, seed: n, tear: true, k, kind, dusted: false };
  if ( kind === 4 ) {
    const snapAt = Math.floor(q / 1000) / 9, hold = (40 + 260 * (0.6 * snapAt + 0.4 * hA)) * k;
    return Object.assign(it, { t0: arr - 20 * k, dur: hold + 180 * k, hold, reach: Math.min(1.6, Math.max(1, (q % 1000) / 100)), snapped: false });
  }
  if ( kind === 2 ) return Object.assign(it, { t0: arr + (120 + 130 * hA) * k, dur: (210 + 90 * hB) * k });
  if ( kind === 3 ) return Object.assign(it, { t0: arr - clock.band * 0.1 + (hA - 0.5) * 20 * k, dur: (440 + 180 * hB) * k });
  const dd = Math.hypot(p.fx - p.sx, p.fy - p.sy), lift = Math.min(3.5, (q & 1023) / 10 || 0.5 + dd * 0.3);
  const t0 = arr - clock.band * 0.1 + (hA - 0.5) * 30 * k + hC * 40 * k;
  const dur = (170 + Math.min(160, dd * 22) + lift * 35) * k * (0.85 + 0.35 * hB);
  return Object.assign(it, { t0, dur, lift, flut: hC < 0.4 ? 2 : 1 });
}

export function tearPlace(display, p, t, it) {
  const ap = display.ap, o = display.origin, s = p.spr;
  if ( !s ) return;
  const tm = t * it.dur, kind = it.kind | 0;
  s.rotation = 0;
  // offsets from the rest pose are whole art pixels (the sprite's centre may sit on a half pixel)
  const pose = (dx, dy, sx = 1, sy = sx) => { s.position.set(o.x + (p.fx + Math.round(dx)) * ap, o.y + (p.fy + Math.round(dy)) * ap); s.scale.set(ap * sx, ap * sy); };
  // closed, the lips still meet: that is the plain map under it, so the piece is not drawn (a piece shown shifted onto the spine
  // doubled a band of the map at its outer edge)
  if ( tm < 0 ) { s.visible = false; return; }
  s.visible = true; s.alpha = 1;   // opaque from its first frame (no ghost)
  const flick = (n, per) => ((Math.floor(tm / (per * it.k) + it.seed) & 1) ? 1 : -1) * n;
  if ( kind === 4 ) {
    // the fibre: taut (stretched about its root to the far lip), then it snaps and flicks back, swinging, to hang
    const rx = p.tvx, ry = p.tvy;
    let f = it.reach, sw = 0;
    if ( tm >= it.hold ) {
      const q = Math.min(1, (tm - it.hold) / (it.dur - it.hold));
      if ( !it.snapped ) {
        it.snapped = true;
        const tx = p.fx + rx - rx * 2 * it.reach, ty = p.fy + ry - ry * 2 * it.reach;
        for ( const sg of [-1, 1] ) display.spawn({ x: tx, y: ty, vx: sg * 10 - rx * 3, vy: -4 - ry * 3, fall: 22, life: 220, color: 0xd6c6a0, drag: 4 });
      }
      f = t >= 1 ? 1 : Math.max(0.75, 1 + (it.reach - 1) * Math.exp(-5 * q) * Math.cos(9 * q));
      sw = t >= 1 ? 0 : Math.sin(14 * q) * Math.exp(-4 * q) * 1.2;
    }
    const l = Math.hypot(rx, ry) || 1;
    pose(rx - rx * f - ry / l * sw, ry - ry * f + rx / l * sw, f);
    return;
  }
  if ( kind === 2 ) {
    // the fold flips over from the hinge: small at the gap edge, it opens out onto its lip, overshoots a little, flutters, lies still
    if ( t >= 1 ) { pose(0, 0); return; }
    const e = 1 - (1 - t) ** 3, sc = 0.3 + 0.7 * e + 0.14 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.5) / 0.5)));
    const fl = t > 0.55 && t < 0.9 ? flick(1, 30) : 0, l = Math.hypot(p.tvx, p.tvy) || 1;
    pose(p.tvx * (1 - e) + p.tvx / l * fl * 0.6, p.tvy * (1 - e) + p.tvy / l * fl * 0.6, sc);
    return;
  }
  const dx = p.sx - p.fx, dy = p.sy - p.fy;   // to the closed pose
  if ( kind === 3 ) {
    // torn off: peels open with its lip, hangs there fluttering, then drops into the gap (a little hop, falling faster)
    if ( t >= 1 ) { pose(0, 0); return; }
    const lx = p.tvx, ly = p.tvy;   // its lip pose (from the rest in the gap)
    if ( t < 0.3 ) { const e = 1 - (1 - t / 0.3) ** 3; pose(dx + (lx - dx) * e, dy + (ly - dy) * e - Math.sin(Math.PI * t / 0.3) * 1.5, 1, 0.92); return; }
    if ( t < 0.55 ) { pose(lx + flick(1, 28), ly - 1, 1, 0.9); return; }
    const q = (t - 0.55) / 0.45;
    pose(lx * (1 - q * q), ly * (1 - q * q) - Math.sin(Math.PI * q) * 1.5, 1, 0.9 + 0.1 * q);
    return;
  }
  // a lip flap
  const l = Math.hypot(dx, dy) || 1, ux = -dx / l, uy = -dy / l;   // outwards (its way open)
  if ( t >= 1 ) {
    // the snap: one pixel past its rest, then still
    const snap = (t - 1) * it.dur < 55 * it.k ? 1 : 0;
    pose(ux * snap, uy * snap);
    return;
  }
  const e = 1 - (1 - t) ** 4, up = Math.sin(Math.PI * t) * it.lift;
  const fl = t < 0.55 ? flick(it.flut * (1 - t / 0.55), 28) : 0;
  pose(dx * (1 - e) + ux * fl, dy * (1 - e) + uy * fl - up, 1, 1 - 0.14 * Math.sin(Math.PI * t));
}

/** The front: the pinprick, crumbs and snapping fibres at every running head, the snap at each tip, a short settle. */
export function tearFx(display, g, a, now, el) {
  const T = a.tear, mat = g.info.mat | 0, [lite, dark] = CRUMB[mat] ?? CRUMB[1], fib = FIBRE[mat] ?? FIBRE[1], k = a.k, pw = a.pw;
  const once = (key, at, fn) => { if ( el >= at && !a.fired.has(key) ) { a.fired.add(key); fn(); } };
  const [px, py] = T.punct;
  once("prick", 0, () => {
    display.spawn({ x: px, y: py, vx: 0, vy: 0, life: 260 * k, color: 0x1a1410, alpha: 1 });
    for ( let q = 0; q < 3; q++ ) display.spawn({ x: px, y: py, vx: (Math.random() - 0.5) * 10, vy: -3 - Math.random() * 4, fall: 26, life: 300, color: q ? lite : dark, drag: 2 });
  });
  if ( now >= (a.nextFx ?? 0) ) {
    a.nextFx = now + 32 * k;
    for ( const [x, y, dx, dy] of T.heads(el) ) {
      const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux, sd = Math.random() < 0.5 ? -1 : 1;
      // crumbs spill out sideways and fall
      display.spawn({ x: x + nx * sd, y: y + ny * sd, vx: nx * sd * (6 + Math.random() * 8) * pw + ux * 4, vy: ny * sd * 6 * pw - 4, fall: 28, life: 320 + Math.random() * 160, color: Math.random() < 0.6 ? lite : dark, drag: 2.4, size: 2 });
      // a fibre stretched across snaps: two pale flecks flicked apart (rarely: many read as confetti)
      if ( Math.random() < 0.15 ) for ( const s of [-1, 1] ) display.spawn({ x: x + nx * s, y: y + ny * s, vx: nx * s * 12 * pw, vy: ny * s * 12 * pw - 2, fall: 18, life: 200, color: fib, drag: 4 });
      // now and then a CLOD of the surface is flung off the lip: a chunk cut from the lips' own pixels (debris.mjs), on an arc to a
      // few pixels beside the rip, where it hops and crumbles
      if ( Math.random() < 0.18 ) {
        const n = (a.chunkN = (a.chunkN ?? 0) + 1), bx = x + nx * sd * 2, by = y + ny * sd * 2;
        display.chunks(g, a, { count: 1, H: [3, 7], seed: n, from: () => [bx, by],
          to: (i, h) => { const d = 3 + 7 * h(5) * pw; return [bx + nx * sd * d + ux * (h(6) - 0.3) * 4, by + ny * sd * d + uy * (h(6) - 0.3) * 4]; } });
      }
    }
  }
  T.tips.forEach((tp, i) => once(`tip${i}`, tp.at, () => {
    // the tip snaps: a few crumbs and a burst of clods (chunks of the lips) landing round it
    for ( let q = 0; q < Math.round(5 * pw); q++ ) { const an = Math.random() * 6.28, sp = 6 + Math.random() * 10; display.spawn({ x: tp.x, y: tp.y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp * 0.8 - 4, fall: 32, life: 320 + Math.random() * 180, color: q & 1 ? lite : dark, drag: 2.4, size: 2 }); }
    display.chunks(g, a, { count: Math.round(5 * pw), H: [4, 9], seed: 50 + i, from: () => [tp.x, tp.y],
      to: (j, h) => { const an = h(4) * 6.283, d = 3 + 8 * h(5); return [tp.x + Math.cos(an) * d, tp.y + Math.sin(an) * d * 0.8]; } });
    display.spawn({ x: tp.x, y: tp.y, vx: 0, vy: 0, rise: -3, life: 600, color: 0xcfc6b8, alpha: 0.6, size: 2 });
  }));
  // the settle: a little dust lifts off the opened rip
  once("settle", a.delay + a.reveal + a.band * 0.5, () => {
    for ( let q = 0; q < 7; q++ ) { const h = T.heads(a.delay + Math.random() * (el - a.delay))[0]; if ( h ) display.spawn({ x: h[0], y: h[1], vx: (Math.random() - 0.5) * 3, vy: 0, rise: -2.5, life: 650 + Math.random() * 250, color: 0xcfc6b8, alpha: 0.5, size: Math.random() < 0.5 ? 3 : 2 }); }
  });
}

/** What the tear's dissolving band sheds: a crumb of the material. */
export function tearEdge(display, g, x, y) {
  const [lite, dark] = CRUMB[g.info.mat | 0] ?? CRUMB[1];
  display.spawn({ x, y, vx: (Math.random() - 0.5) * 8, vy: -2 - Math.random() * 3, fall: 24, life: 260, color: Math.random() < 0.6 ? lite : dark, drag: 2.4 });
}
