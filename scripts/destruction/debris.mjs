/**
 * DEBRIS of the destruction entries: real CHUNKS of the map, not specks. Every flying piece is a small opaque irregular polygon (3-9 art
 * px across, 3-6 vertices rasterised to the art grid, varied aspect) whose pixels are CUT FROM THE AREA'S OWN ATLAS (its plates are the
 * map under the damage: grass blades, brick, planks, stone grain, with the local colour), lit on its top-left edge and darkened on its
 * bottom-right one (one light for the whole scene). No extra bake bytes: the chunks are cut at runtime from the pixels the area already
 * has, deterministically (seeded by the area's hash), so a chunk lying at rest is the same on every client and after every load.
 *
 * Physics read: each chunk follows a parabola with a visible apex (gravity), spins (90-degree steps when small, 22.5 when large), shrinks a
 * little with height, has a ground shadow that tracks it, lands with a squash, makes one or two decaying hops, skids a pixel or two and
 * rests. At rest it either STAYS (a few per area, near the rim: drawn as part of the settled area, so nothing animates after the entry),
 * FADES (crumbles away within ~450 ms of landing) or goes INTO the pit / water (sinks dark at once).
 *
 * Budget: pooled sprites (two per flying chunk: body and shadow), caps per performance mode (high 600, medium 160, low none: the entry is
 * a fade), nothing simulated for an area off screen, reduced motion: no flight. Pure parts (shape, cut, shading, flight, plan) are
 * node-tested (dev/pixel-fx.test.mjs).
 */

/* ================================================================ pure (node) */

export function hashD(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * An irregular chunk outline of about `size` art px across: 3-6 vertices at jittered angles and radii, the box squashed on one axis
 * (aspect 0.5-1), rasterised (pixel centres inside the polygon), cropped. Returns { w, h, m } (m: Uint8Array w*h, 1 = inside). Tiny
 * sizes (3) are hand-shaped masks (a polygon of 3 px across rasterises to a dot or a line).
 */
const TINY = [[".#.", "###", ".##"], ["##.", "###", ".#."], [".##", "###", "##."], ["##", "##", "#."], ["###", "##."], [".#", "##", "##"]];
export function chunkMask(seed, size) {
  // a degenerate polygon (a sliver) is drawn again with the next seed: a chunk is never a stick
  for ( let k = 0; k < 8; k++ ) {
    const mk = mask0(seed + k * 7919, size);
    const lo = Math.max(2, Math.round(size * 0.45));   // (and never much smaller than asked)
    if ( Math.min(mk.w, mk.h) >= lo && Math.max(mk.w, mk.h) >= size - 1 && maskAspect(mk) <= 2.2 ) return mk;
  }
  return mask0(seed, 3);
}
function mask0(seed, size) {
  if ( size <= 3 ) {
    const rows = TINY[Math.floor(hashD(seed, 1, 801) * TINY.length)], h = rows.length, w = rows[0].length, m = new Uint8Array(w * h);
    rows.forEach((r, y) => [...r].forEach((c, x) => { m[y * w + x] = c === "#" ? 1 : 0; }));
    return { w, h, m };
  }
  // (mostly 3-5 corners and a wide radius jitter: angular shards and clods, not lozenges)
  const n = 3 + Math.floor(Math.pow(hashD(seed, 2, 801), 1.3) * 4), asp = 0.55 + 0.45 * hashD(seed, 3, 801), flip = hashD(seed, 4, 801) < 0.5;
  const rx = size / 2 * (flip ? asp : 1), ry = size / 2 * (flip ? 1 : asp), a0 = hashD(seed, 5, 801) * Math.PI * 2;
  const pts = [];
  for ( let i = 0; i < n; i++ ) {
    const a = a0 + (i + (hashD(seed, i, 802) - 0.5) * 0.55) / n * Math.PI * 2, r = 0.6 + 0.5 * hashD(seed, i, 803);
    pts.push([Math.cos(a) * rx * r * (n === 3 ? 1.4 : 1.2), Math.sin(a) * ry * r * (n === 3 ? 1.4 : 1.2)]);
  }
  const inside = (x, y) => {
    let c = false;
    for ( let i = 0, j = n - 1; i < n; j = i++ ) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ( (yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi ) c = !c;
    }
    return c;
  };
  const B = Math.ceil(size / 2) + 2, cells = [];
  for ( let y = -B; y <= B; y++ ) for ( let x = -B; x <= B; x++ ) if ( inside(x + 0.5 - (size & 1 ? 0.5 : 0), y + 0.5 - (size & 1 ? 0.5 : 0)) ) cells.push([x, y]);
  if ( cells.length < 4 ) return mask0(seed, 3);
  // no one-pixel spurs (a lone pixel hanging off by a corner reads as a fleck): judged on the shape as rasterised
  const has = new Set(cells.map(([x, y]) => `${x},${y}`));
  let keep = cells.filter(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].reduce((a, [dx, dy]) => a + (has.has(`${x + dx},${y + dy}`) ? 1 : 0), 0) >= 2);
  if ( keep.length < 4 ) return mask0(seed, 3);
  // a chipped corner or two: never a neat rectangle of pixels
  const bx0 = Math.min(...keep.map((c) => c[0])), by0 = Math.min(...keep.map((c) => c[1])), bx1 = Math.max(...keep.map((c) => c[0])), by1 = Math.max(...keep.map((c) => c[1]));
  if ( keep.length >= 9 ) for ( const [cx, cy, q] of [[bx0, by0, 1], [bx1, by0, 2], [bx0, by1, 3], [bx1, by1, 4]] ) if ( hashD(seed, q, 804) < 0.45 ) keep = keep.filter(([x, y]) => x !== cx || y !== cy);
  const x0 = Math.min(...keep.map((c) => c[0])), y0 = Math.min(...keep.map((c) => c[1]));
  const w = Math.max(...keep.map((c) => c[0])) - x0 + 1, h = Math.max(...keep.map((c) => c[1])) - y0 + 1, m = new Uint8Array(w * h);
  for ( const [x, y] of keep ) m[(y - y0) * w + (x - x0)] = 1;
  return { w, h, m };
}

/** The elongation of a mask: the ratio of its principal axes (1 = round; a stick is > 3). */
export function maskAspect(mk) {
  let n = 0, sx = 0, sy = 0;
  for ( let y = 0; y < mk.h; y++ ) for ( let x = 0; x < mk.w; x++ ) if ( mk.m[y * mk.w + x] ) { n++; sx += x; sy += y; }
  const cx = sx / n, cy = sy / n; let a = 0, b = 0, c = 0;
  for ( let y = 0; y < mk.h; y++ ) for ( let x = 0; x < mk.w; x++ ) if ( mk.m[y * mk.w + x] ) { const dx = x - cx, dy = y - cy; a += dx * dx; b += dx * dy; c += dy * dy; }
  a /= n; b /= n; c /= n;
  const t = (a + c) / 2, d = Math.sqrt(Math.max(0, ((a - c) / 2) ** 2 + b * b)), l1 = t + d + 1 / 12, l2 = Math.max(1 / 12, t - d + 1 / 12);
  return Math.sqrt(l1 / l2);
}

/**
 * Light the chunk: a pixel whose top or left neighbour lies outside it is its LIT edge (brighter, same hue), one whose bottom or right neighbour
 * lies outside is its SHADED rim (darker); a pixel on both stays as it is. `rgba` w*h*4 in place.
 */
export function shadeChunk(rgba, mk, { lit = 1.24, dark = 0.34 } = {}) {
  const { w, h, m } = mk, out = (x, y) => x < 0 || y < 0 || x >= w || y >= h || !m[y * w + x];
  const src = new Uint8Array(rgba);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    if ( !m[y * w + x] ) continue;
    const L = out(x, y - 1) || out(x - 1, y), D = out(x, y + 1) || out(x + 1, y), q = (y * w + x) * 4;
    // (lit by scaling, keeping the hue: mixing towards white greyed small chunks into pale beetles)
    if ( L && !D ) for ( let c = 0; c < 3; c++ ) rgba[q + c] = Math.min(255, Math.round(src[q + c] * lit + 8));
    else if ( D && !L ) for ( let c = 0; c < 3; c++ ) rgba[q + c] = Math.round(src[q + c] * (1 - dark));
  }
  return rgba;
}

/**
 * Cut a chunk's pixels out of `src` (RGBA, sw wide) at (sx, sy): every pixel of the mask must be opaque there (a cut of the map, never
 * of the transparent gutter); null otherwise.
 */
export function cutChunk(src, sw, sx, sy, mk) {
  const { w, h, m } = mk, out = new Uint8Array(w * h * 4);
  if ( sx < 0 || sy < 0 || sx + w > sw || (sy + h) * sw * 4 > src.length ) return null;
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    if ( !m[y * w + x] ) continue;
    const p = ((sy + y) * sw + sx + x) * 4, q = (y * w + x) * 4;
    if ( src[p + 3] < 250 ) return null;
    out[q] = src[p]; out[q + 1] = src[p + 1]; out[q + 2] = src[p + 2]; out[q + 3] = 255;
  }
  return out;
}

/**
 * A chunk in a PALETTE instead of map pixels (ice, glass, coal): two facets split by a line through it (light / mid), the lit edge
 * the lightest tone, the shaded rim the darkest, a rare glint. pal = [glint, light, mid, dark].
 */
export function paletteChunk(mk, pal, seed) {
  const { w, h, m } = mk, out = new Uint8Array(w * h * 4), a = hashD(seed, 1, 811) * Math.PI, nx = Math.cos(a), ny = Math.sin(a);
  const cx = (w - 1) / 2 + (hashD(seed, 2, 811) - 0.5), cy = (h - 1) / 2 + (hashD(seed, 3, 811) - 0.5);
  const off = (x, y) => x < 0 || y < 0 || x >= w || y >= h || !m[y * w + x];
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    if ( !m[y * w + x] ) continue;
    const L = off(x, y - 1) || off(x - 1, y), D = off(x, y + 1) || off(x + 1, y);
    let c = (x - cx) * nx + (y - cy) * ny < 0 ? pal[1] : pal[2];
    if ( L && !D ) c = hashD(x, y, seed) < 0.18 ? pal[0] : pal[1];
    else if ( D && !L ) c = pal[3];
    const q = (y * w + x) * 4; out[q] = c >> 16; out[q + 1] = (c >> 8) & 255; out[q + 2] = c & 255; out[q + 3] = 255;
  }
  return out;
}

/**
 * A set of chunk variants for an area, packed in one row (1 px gutters): `src` its atlas (RGBA, sw wide), `rects` where map pixels
 * are ({ x, y, w, h }: the plates first, the base last), `n` variants of sizes in `sizes` [min, max], `pal` (optional) a palette instead
 * of map pixels. Returns { w, h, data, frames: [{ x, y, w, h, s }] } (deterministic for the seed).
 */
export function chunkSet(src, sw, rects, { seed = 1, n = 12, sizes = [3, 8], pal = null } = {}) {
  const items = [], local = src && rects?.length ? localTone(src, sw, rects[rects.length - 1], seed) : null;
  const plates = (rects ?? []).slice(0, -1), base = rects?.[rects.length - 1];
  for ( let i = 0; i < n; i++ ) {
    let s = Math.round(sizes[0] + (sizes[1] - sizes[0]) * Math.pow(hashD(seed, i, 821), 1.4));
    let mk = chunkMask(seed * 31 + i, s);
    let px = null;
    const own = pal && (i & 1) === 0;
    if ( own ) px = paletteChunk(mk, pal, seed + i);   // half the cause's own material (ice, glass, coal), half the ground
    else if ( src && rects?.length ) {
      // the inside of a plate big enough (away from its inked edge), else anywhere opaque in the base; smaller if nothing fits
      for ( ; !px && s >= 3; s--, mk = chunkMask(seed * 31 + i, s) ) {
        const fit = plates.filter((r) => r.w >= mk.w + 2 && r.h >= mk.h + 2);
        for ( let t = 0; t < 40 && !px; t++ ) {
          const r = t < 24 && fit.length ? fit[Math.floor(hashD(seed + i, t, 822) * fit.length)] : base;
          if ( !r || r.w < mk.w + 2 || r.h < mk.h + 2 ) continue;
          const ox = r.x + 1 + Math.floor(hashD(seed + i, t, 823) * (r.w - mk.w - 1)), oy = r.y + 1 + Math.floor(hashD(seed + i, t, 824) * (r.h - mk.h - 1));
          px = cutChunk(src, sw, ox, oy, mk);
          if ( px && lumaSpread(px, mk) < 0 ) px = null;
        }
        if ( px ) break;
      }
    }
    // nothing to cut: the local ground's own tone (the base's median opaque colour) in three steps
    if ( !px ) px = paletteChunk(mk, local ?? [0xa89478, 0x8a7660, 0x6e5c48, 0x4e4234], seed + i);
    else if ( !own ) shadeChunk(px, mk);
    // a dark OUTLINE round all but the crumbs: a chunk of grass over grass otherwise reads as a hollow frame (its inside is the ground's)
    if ( s >= 4 ) ({ mk, px } = outlineChunk(mk, px));
    items.push({ mk, px, s });
  }
  const W = items.reduce((a, it) => a + it.mk.w + 1, 1), H = Math.max(...items.map((it) => it.mk.h)) + 2, data = new Uint8Array(W * H * 4), frames = [];
  let x = 1;
  for ( const it of items ) {
    for ( let y = 0; y < it.mk.h; y++ ) data.set(it.px.subarray(y * it.mk.w * 4, (y + 1) * it.mk.w * 4), ((y + 1) * W + x) * 4);
    frames.push({ x, y: 1, w: it.mk.w, h: it.mk.h, s: it.s });
    x += it.mk.w + 1;
  }
  return { w: W, h: H, data, frames, tone: local };
}

/** Grow a chunk by a 1 px outline: each new pixel the darkest neighbouring chunk colour at 40 % (a dark rim of its own tone). */
export function outlineChunk(mk, px) {
  const W = mk.w + 2, H = mk.h + 2, m = new Uint8Array(W * H), out = new Uint8Array(W * H * 4);
  for ( let y = 0; y < mk.h; y++ ) for ( let x = 0; x < mk.w; x++ ) if ( mk.m[y * mk.w + x] ) {
    const q = ((y + 1) * W + x + 1); m[q] = 1; for ( let c = 0; c < 4; c++ ) out[q * 4 + c] = px[(y * mk.w + x) * 4 + c];
  }
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    const q = y * W + x; if ( m[q] ) continue;
    let best = -1, bv = 1e9;
    for ( const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) {
      const X = x + dx, Y = y + dy, j = Y * W + X;
      if ( X < 0 || Y < 0 || X >= W || Y >= H || m[j] !== 1 ) continue;
      const v = out[j * 4] + out[j * 4 + 1] + out[j * 4 + 2]; if ( v < bv ) { bv = v; best = j; }
    }
    if ( best < 0 ) continue;
    for ( let c = 0; c < 3; c++ ) out[q * 4 + c] = Math.round(out[best * 4 + c] * 0.5);
    out[q * 4 + 3] = 255; m[q] = 2;
  }
  for ( let i = 0; i < m.length; i++ ) if ( m[i] ) m[i] = 1;
  return { mk: { w: W, h: H, m }, px: out };
}
/** The median colour of opaque, not-black pixels in a rect (seeded sample) as a palette [glint, light, mid, dark]. */
function localTone(src, sw, r, seed) {
  if ( !r ) return null;
  const cs = [];
  for ( let t = 0; t < 400 && cs.length < 60; t++ ) {
    const x = r.x + Math.floor(hashD(seed, t, 826) * r.w), y = r.y + Math.floor(hashD(seed, t, 827) * r.h), p = (y * sw + x) * 4;
    if ( p + 3 < src.length && src[p + 3] >= 250 && src[p] + src[p + 1] + src[p + 2] >= 70 ) cs.push([src[p], src[p + 1], src[p + 2]]);
  }
  if ( cs.length < 5 ) return null;
  cs.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  const [R, G, B] = cs[cs.length >> 1], c = (f) => (Math.min(255, Math.round(R * f)) << 16) | (Math.min(255, Math.round(G * f)) << 8) | Math.min(255, Math.round(B * f));
  return [c(1.45), c(1.18), c(1), c(0.62)];
}
/** (a cut that is all near-black is the pit, not ground: -1) */
function lumaSpread(px, mk) {
  let n = 0, dark = 0;
  for ( let i = 0; i < mk.m.length; i++ ) if ( mk.m[i] ) { n++; if ( px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] < 70 ) dark++; }
  return dark > n * 0.5 ? -1 : 1;
}

/**
 * A chunk's flight from (sx, sy) to its rest at (px, py) (art px on the ground plane): the first arc of apex H carries it most of the
 * way, then `bounces` (0-2) decaying hops, then a short skid; gravity g (art px / s^2). Everything in seconds. Lands EXACTLY at (px, py).
 */
export function hopPlan(sx, sy, px, py, H, bounces = 1, g = 420) {
  const fr = bounces >= 2 ? [0.8, 0.13, 0.04] : bounces === 1 ? [0.85, 0.12] : [0.97], hs = [H, H * 0.17, H * 0.05];
  const segs = []; let t = 0, f = 0;
  fr.forEach((q, i) => { const h = Math.max(0.4, hs[i]), T = Math.max(0.07, 2 * Math.sqrt(2 * h / g)); segs.push({ t0: t, T, f0: f, f1: f + q, h }); t += T; f += q; });
  const air = t, skid = 0.08;
  return { sx, sy, px, py, segs, air, end: air + skid, skid, fEnd: f };
}

/**
 * Where a chunk is at `t` s after it leaves: { x, y (ground), z (height), sq (squash 0.7-1), touch (index of the last touchdown or -1),
 * landed, rest }.
 */
export function hopAt(P, t) {
  const L = (f) => [P.sx + (P.px - P.sx) * f, P.sy + (P.py - P.sy) * f];
  if ( t >= P.end ) return { x: P.px, y: P.py, z: 0, sq: 1, touch: P.segs.length - 1, landed: true, rest: true };
  if ( t >= P.air ) {
    const u = (t - P.air) / P.skid, e = 1 - (1 - u) * (1 - u), [x, y] = L(P.fEnd + (1 - P.fEnd) * e), since = t - P.air;
    return { x, y, z: 0, sq: since < 0.07 ? 0.78 + 0.22 * since / 0.07 : 1, touch: P.segs.length - 1, landed: true, rest: false };
  }
  let i = 0; while ( i < P.segs.length - 1 && t >= P.segs[i].t0 + P.segs[i].T ) i++;
  const s = P.segs[i], u = Math.max(0, (t - s.t0) / s.T), [x, y] = L(s.f0 + (s.f1 - s.f0) * u), z = 4 * s.h * u * (1 - u);
  // the squash of the touchdown that started this hop (the first arc has none)
  const since = t - s.t0, sq = i > 0 && since < 0.06 ? 1 - (0.24 / i) * (1 - since / 0.06) : 1;
  return { x, y, z, sq, touch: i - 1, landed: i > 0, rest: false };
}

/**
 * Plan a throw: `count` chunks from `from` (a function (i, h) -> [x, y] or the origin) to rest points; each its size, apex, spin, start,
 * fate. Options: ox, oy (origin), R (damage radius), dir / spread (radians; full circle by default), reach [min, max] in R from the
 * origin (where they come to rest; big chunks at most 1.0 R past the rim, small ones 1.4 R), H [min, max] apex, speed (scales the
 * apex), delay [min, max] ms, landing ('rest' | 'fade' | 'into'), rest (how many may stay), scene (art-px rect: a chunk that would
 * come to rest beyond it is culled), keep (art-px rect the staying ones must lie in), to (optional (i, h) -> [x, y] rest point),
 * sizes [min, max], frames (the set's frames: a chunk takes one of its size class). Deterministic for the seed.
 */
export function planThrow(o) {
  const { seed = 1, count = 10, ox = 0, oy = 0, R = 8, dir = 0, spread = Math.PI * 2, reach = [0.9, 1.6], H = [3, 10], speed = 1, delay = [0, 60],
    landing = "fade", rest = 0, scene = null, keep = null, from = null, to = null, frames = null, gravity = 420, bounces = null } = o;
  const out = []; let kept = 0;
  for ( let i = 0; i < count; i++ ) {
    const h = (q) => hashD(seed, i, 830 + q);
    const fi = frames?.length ? Math.floor(h(1) * frames.length) : 0, s = frames?.[fi]?.s ?? 4, big = s >= 6;
    const [sx, sy] = from ? from(i, h) : [ox + (h(2) - 0.5) * R * 0.5, oy + (h(3) - 0.5) * R * 0.4];
    let px, py;
    if ( to ) [px, py] = to(i, h);
    else {
      const a = dir + (h(4) - 0.5) * spread, lim = 1 + (big ? 1.0 : 1.4);
      // heavier ones land closer; the distance from the ORIGIN, never more than (1 + lim) R
      const d = R * Math.min(lim, reach[0] + (reach[1] - reach[0]) * h(5) * (big ? 0.7 : 1));
      px = ox + Math.cos(a) * d; py = oy + Math.sin(a) * d * 0.8;
    }
    px = Math.round(px); py = Math.round(py);
    if ( scene && (px < scene.x0 + 1 || py < scene.y0 + 1 || px > scene.x1 - 2 || py > scene.y1 - 2) ) continue;   // would rest off the map: culled
    let fate = landing;
    if ( landing === "rest" ) {
      const fits = !keep || (px - s / 2 >= keep.x0 && py - s / 2 >= keep.y0 && px + s / 2 <= keep.x1 && py + s / 2 <= keep.y1);
      const near = Math.hypot(px - ox, (py - oy) / 0.8) <= R * 1.45;
      if ( kept < rest && fits && near && s >= 4 ) kept++; else fate = "fade";
    }
    const apex = (H[0] + (H[1] - H[0]) * h(6)) * speed / (big ? 1.5 : 1);
    const nb = bounces ?? (fate === "into" ? 0 : big ? 1 : 1 + (h(7) < 0.5 ? 1 : 0));
    const P = hopPlan(sx, sy, px, py, Math.max(1, apex), nb, gravity);
    const rq = Math.floor(h(8) * 4), spin = (big ? 5 : 11) * (0.6 + 0.8 * h(9)) * (h(10) < 0.5 ? -1 : 1);
    out.push({ i, fi, s, P, fate, rot: rq * Math.PI / 2, spin, t0: delay[0] + (delay[1] - delay[0]) * h(11) });
  }
  return out;
}

/** The pose of a planned chunk at `t` s after its own start: { x, y, z, sq, rot, sc } (rot ends at its rest rotation). */
export function chunkPose(c, t) {
  const q = hopAt(c.P, t), left = Math.max(0, c.P.air - t);
  let rot = c.rot - c.spin * left;
  const step = c.s >= 7 ? Math.PI / 8 : Math.PI / 2;
  rot = Math.round(rot / step) * step;
  const sc = 1 - Math.min(0.25, Math.round(q.z / 3) * 0.05);    // a little smaller up high, in steps
  return { ...q, rot, sc };
}

/** The most chunks in flight per performance mode. */
export const CHUNK_CAP = { high: 600, medium: 160, low: 0 };

/* ================================================================ runtime (PIXI) */

const MAT_ICE = [0xffffff, 0xe2f1fc, 0xb4d4ee, 0x7d9fc2], MAT_GLASS = [0xffffff, 0xd6ebff, 0x96c0e8, 0x4e6e98], MAT_COAL = [0xfff0b0, 0xffa040, 0xc8461c, 0x3a1c12];
/** Cause (core CAUSES index) -> how its chunks look: pal (own material), tint (over map pixels), glow (coal: hot -> char), dissolve. */
// (core CAUSES: none, fire, acid, lightning, arcane, impact, claws, water, decay, frost)
const CAUSE_CHUNK = [null, { pal: MAT_COAL, coal: true }, { tint: 0xc8f07a, dissolve: true }, { pal: MAT_GLASS }, null, null, null, null, { tint: 0xc0d0b0 }, { pal: MAT_ICE }];

/**
 * The pool and the chunks in flight. One per display; `display.debris`. Areas own their chunk set (`g.chunks`, made once: from its
 * atlas) and their staying chunks (`g.rest`: sprites at the end of its shard container, shown when they land, part of its settled look).
 */
export class Debris {
  constructor(d) {
    this.d = d; this.live = []; this.pool = [];
    this.shadows = new PIXI.Container(); this.bodies = new PIXI.Container();
    this.shadows.eventMode = this.bodies.eventMode = "none";
    d.fx.addChildAt(this.bodies, 0); d.fx.addChildAt(this.shadows, 0);
  }
  get stats() { return this.d.stats ?? {}; }

  /** The chunk variants of an area (cut from its atlas `buf`, W wide; `rects` its plates then its base), and its texture. */
  makeSet(g, buf, W, rects) {
    const cz = CAUSE_CHUNK[g.info.cause | 0];
    const set = chunkSet(buf, W, rects, { seed: (g.hash % 99991) + 7, n: 12, sizes: [3, Math.min(7, 4 + Math.round(g.info.R / 10))], pal: cz?.pal ?? null });   // (+2 for the outline: 3-9 across)
    const bt = new PIXI.BaseTexture(new PIXI.BufferResource(set.data, { width: set.w, height: set.h }), {
      width: set.w, height: set.h, scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.UNPACK,
      format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP });
    set.tex = set.frames.map((f) => new PIXI.Texture(bt, new PIXI.Rectangle(f.x, f.y, f.w, f.h)));
    set.base = bt; set.cz = cz;
    g.chunks = set;
    return set;
  }

  /**
   * The area's STAYING chunks: a few thrown from the damage that come to rest near its rim, the same on every client (seeded by the
   * hash, independent of the look settings); their sprites are made now, at the end of its shard container (after its shards in the
   * drawing order; nothing else is ever inserted after them), shown at rest. Only for blasts and cracks.
   */
  makeRest(g) {
    const info = g.info, t = info.type, set = g.chunks;
    g.rest = [];
    // (blasts only - a crack strokes area keeps no chunk at rest - and 2-4 of them lying against the rim, nothing out in the open)
    if ( !set || t !== "blast" || info.cause === 1 || info.cause === 2 ) return;
    const R = Math.max(4, info.R), r = info.rect, keep = { x0: r.x0 + 1, y0: r.y0 + 1, x1: r.x1 - 1, y1: r.y1 - 1 };
    const n = Math.min(4, 2 + Math.round(R / 18));
    const plan = planThrow({ seed: (g.hash % 99991) + 13, count: n * 3, ox: info.ex, oy: info.ey, R, reach: [0.88, 1.06],
      H: [6, 12], landing: "rest", rest: n, keep, frames: set.frames, scene: this.sceneArt() });
    for ( const c of plan ) {
      if ( c.fate !== "rest" ) continue;
      const sh = this.restSprite(set.tex[c.fi], 0x000000, 0.34), body = this.restSprite(set.tex[c.fi], 0xffffff, 1);
      this.pose(sh, c.P.px + 1, c.P.py + 1, c.rot, 1, 1, set.frames[c.fi]); this.pose(body, c.P.px, c.P.py, c.rot, 1, 1, set.frames[c.fi]);
      g.shardCont.addChild(sh, body);
      g.rest.push({ c, sh, body });
    }
  }

  restSprite(tex, tint, alpha) { const s = new PIXI.Sprite(tex); s.eventMode = "none"; s.anchor.set(0.5); s.tint = tint; s.alpha = alpha; return s; }

  /** The scene's rectangle in art px. */
  sceneArt() {
    const r = this.d.sceneRect(), ap = this.d.ap, o = this.d.origin;
    return r ? { x0: (r.x0 - o.x) / ap, y0: (r.y0 - o.y) / ap, x1: (r.x1 - o.x) / ap, y1: (r.y1 - o.y) / ap } : null;
  }

  /** Place a chunk sprite with its top-left on the art grid (a rotated odd-sized chunk would sit half a pixel off). */
  pose(s, x, y, rot, sc, sq, f) {
    const ap = this.d.ap, o = this.d.origin, q = Math.round(rot / (Math.PI / 2)) & 1, w = q ? f.h : f.w, h = q ? f.w : f.h;
    const X = Math.round(x - w / 2) + w / 2, Y = Math.round(y - h / 2) + h / 2;
    s.position.set(o.x + X * ap, o.y + Y * ap); s.rotation = rot;
    s.scale.set(ap * sc * (sq < 1 ? 1 + (1 - sq) * 0.6 : 1), ap * sc * sq);
  }

  /** An entry begins: its staying chunks are hidden until they land. */
  hideRest(g) { for ( const r of g.rest ?? [] ) { r.sh.visible = r.body.visible = false; r.shown = false; } }
  showRest(g) { for ( const r of g.rest ?? [] ) { r.sh.visible = r.body.visible = true; r.shown = true; } }

  cap() { return CHUNK_CAP[this.d.perf?.() ?? "high"] ?? 600; }

  /**
   * THE API: throw chunks of an area. { area (group), origin [x, y], count, speed, spread, dir, gravity, landing ('rest' | 'fade' |
   * 'into'), from ((i, h) -> [x, y]), to ((i, h) -> [x, y]), reach, H, delay, start (performance.now() time), tint, seed }. 'rest' here
   * only fades (the staying chunks are the area's own, planned at build: makeRest); use it for the rest of the throw. Returns how many.
   */
  spawnChunks({ area: g, origin, count = 10, speed = 1, spread = Math.PI * 2, dir = 0, gravity = 420, landing = "fade", from = null, to = null,
    reach = [0.9, 1.6], H = [3, 10], delay = [0, 60], start = performance.now(), tint = null, seed = 0, sizes = null, sink = 0x40362e } = {}) {
    const set = g?.chunks; if ( !set || !count ) return 0;
    const room = this.cap() - this.live.length; if ( room <= 0 ) return 0;
    const info = g.info, [ox, oy] = origin ?? [info.ex, info.ey];
    let frames = set.frames;
    if ( sizes ) { const f = frames.filter((q) => q.s >= sizes[0] && q.s <= sizes[1]); if ( f.length ) frames = f; }
    const plan = planThrow({ seed: (g.hash % 99991) * 7 + (seed | 0) + 101, count: Math.min(count, room), ox, oy, R: Math.max(4, info.R), dir, spread, reach, H, speed,
      delay, landing: landing === "rest" ? "fade" : landing, scene: this.sceneArt(), from, to, frames, gravity });
    const cz = set.cz;
    for ( const c of plan ) { const q = this.launch(g, c, set.tex[set.frames.indexOf(frames[c.fi])], frames[c.fi], start + c.t0, tint ?? cz?.tint ?? null, !!cz?.coal, !!cz?.dissolve); q.sink = sink; }
    this.stats.chunks = (this.stats.chunks ?? 0) + plan.length;
    return plan.length;
  }

  /**
   * The staying chunks fly in from the damage when their area enters (the same plan as their rest). `at` (optional, (x, y) -> time):
   * a walked entry (a gun's pocks) - each one a short hop from beside its rest spot, thrown when the walk reaches that spot.
   */
  throwRest(g, start, k = 1, at = null) {
    for ( const r of g.rest ?? [] ) {
      let c = r.c, t = start + c.t0 * k;
      if ( at ) {
        const px = c.P.px, py = c.P.py, h = (q) => hashD(g.hash | 0, c.i, 870 + q), an = h(1) * 6.283, d = 2 + 3 * h(2);
        c = { ...c, P: hopPlan(px - Math.cos(an) * d, py - Math.sin(an) * d * 0.8, px, py, 3 + 3 * h(3), 1) };
        t = at(px, py) + 20 + 40 * h(4);
      }
      this.launch(g, c, r.body.texture, g.chunks.frames[c.fi], t, null, false, false, r);
    }
  }

  launch(g, c, tex, f, t0, tint, coal, dissolve, rest = null) {
    const take = () => { let s = this.pool.pop(); if ( !s || s.destroyed ) { s = new PIXI.Sprite(); s.eventMode = "none"; s.anchor.set(0.5); } return s; };
    const body = take(), sh = take();
    body.texture = sh.texture = tex; body.visible = sh.visible = false; body.alpha = 1; sh.tint = 0x000000;
    this.bodies.addChild(body); this.shadows.addChild(sh);
    const q = { g, c, f, t0, body, sh, tint, coal, dissolve, rest, sink: 0x40362e };
    this.live.push(q);
    return q;
  }

  release(q) {
    for ( const s of [q.body, q.sh] ) { if ( s.destroyed ) continue; s.visible = false; s.parent?.removeChild(s); this.pool.push(s); }
  }

  /** Chunks of an area still moving at `now`. */
  busy(g, now) { return this.live.some((q) => q.g === g); }

  /** An area's entry ended (or it was killed): its chunks go, its staying ones are shown where they lie. */
  endArea(g) {
    for ( let i = this.live.length - 1; i >= 0; i-- ) if ( this.live[i].g === g ) { this.release(this.live[i]); this.live.splice(i, 1); }
    if ( !g.dead ) this.showRest(g);
  }

  tick(now, vw) {
    const L = this.live;
    for ( let i = L.length - 1; i >= 0; i-- ) {
      const q = L[i], c = q.c, t = (now - q.t0) / 1000, g = q.g;
      if ( g.dead ) { this.release(q); L.splice(i, 1); continue; }
      if ( t < 0 ) { q.body.visible = q.sh.visible = false; continue; }
      const pz = chunkPose(c, t), after = t - c.P.end;
      // done: a staying chunk hands over to its sprite in the area; a fading one crumbles within ~450 ms; one going in sinks at once
      const life = c.fate === "into" ? 0.16 : c.fate === "fade" ? (q.dissolve ? 0.45 : 0.42) : 0;
      if ( after >= life ) {
        if ( q.rest ) { q.rest.sh.visible = q.rest.body.visible = true; q.rest.shown = true; }
        this.release(q); L.splice(i, 1); continue;
      }
      const r = g.info.rect, m = 40;
      if ( pz.x < vw.x0 - m || pz.x > vw.x1 + m || pz.y < vw.y0 - m || pz.y > vw.y1 + m ) { q.body.visible = q.sh.visible = false; continue; }
      let sc = pz.sc, alpha = 1, tint = 0xffffff;
      if ( after > 0 ) {
        const u = after / Math.max(0.01, life);
        if ( c.fate === "into" ) { tint = q.sink; alpha = u < 0.5 ? 1 : 0.55; sc *= u < 0.5 ? 0.85 : 0.6; }
        else { sc *= u < 0.34 ? 1 : u < 0.67 ? 0.72 : 0.45; alpha = u < 0.67 ? 1 : 0.7; }       // crumbles in steps, not a soft fade
      }
      if ( q.coal ) tint = lerp(0xffffff, 0x6a4a3c, clamp01(t / (c.P.end + 0.3)));            // a glowing coal cools to char
      else if ( q.tint ) tint = mul(tint, q.tint);
      if ( q.dissolve && pz.landed ) sc *= 0.8;
      q.body.visible = true; q.body.alpha = alpha; q.body.tint = tint;
      this.pose(q.body, pz.x, pz.y - pz.z, pz.rot, sc, pz.sq, q.f);
      // the shadow on the ground: down-right of the chunk (top-left light), smaller and fainter the higher it is
      const hs = 1 / (1 + pz.z * 0.06);
      q.sh.visible = true; q.sh.alpha = 0.34 * hs * alpha;
      this.pose(q.sh, pz.x + 1, pz.y + 1, pz.rot, Math.max(0.5, sc * hs), 1, q.f);
      if ( !this.d.inScene(q.body.x, q.body.y) ) q.body.visible = q.sh.visible = false;
    }
    this.stats.chunksLive = L.length;
  }

  /** An area is destroyed: its set and staying sprites go with it. */
  dropArea(g) {
    this.endArea(g);
    for ( const r of g.rest ?? [] ) { r.sh.destroy(); r.body.destroy(); }
    g.rest = [];
    if ( g.chunks ) { for ( const t of g.chunks.tex ) t.destroy(false); g.chunks.base.destroy(); g.chunks = null; }
  }

  clear() { for ( const q of this.live ) this.release(q); this.live = []; }
  destroy() { this.clear(); for ( const s of this.pool ) if ( !s.destroyed ) s.destroy(); this.pool = []; }
}

const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
function lerp(a, b, t) {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t), g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t), bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
function mul(a, b) {
  return ((((a >> 16) & 255) * ((b >> 16) & 255) / 255) << 16) | ((((a >> 8) & 255) * ((b >> 8) & 255) / 255) << 8) | (((a & 255) * (b & 255) / 255) | 0);
}
