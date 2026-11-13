/**
 * Zone states read from the map's own layers (pure: the layers are passed in, no Foundry here):
 *  - FIRE layer: fire painted in a zone (a stroke still burning) makes it burn, its Intensity from the stroke's level
 *    (1 smouldering = 6, 2 a steady fire = 8, 3 a blaze = 10: the book's fires are 6-9, a huge one more);
 *  - DESTRUCTION layer: a quarter of a zone broken or cratered makes it wrecked; damage of the type "flood" makes it flooded;
 *  - WATER layer: a quarter of a zone under water (still water, river, fall) gives it water (swimming).
 * Each zone is sampled on a grid a quarter of a square apart (only points inside the zone), worked out once per set of zones.
 */

export const LEVEL_INTENSITY = [0, 6, 8, 10];
export const intensityLevel = (i) => (i <= 6 ? 1 : i <= 8 ? 2 : 3);
const SHARE = 0.25, FIRE_SHARE = 0.05;
/** The x where each edge of ring `p` crosses the row y (the same test and formula as inRing), ascending. */
function rowCrossings(p, y, out) {
  out.length = 0;
  for ( let i = 0, n = p.length, j = n - 2; i < n; j = i, i += 2 ) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ( (yi > y) !== (yj > y) ) out.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Sample points per zone: id -> [x0, y0, x1, y1, ...] (scene px), `step` apart.
 * PERF (arrival, 2026-11-09): one scan line per sample row instead of a point-in-polygon test per sample. inRing(p, x, y) is true when
 * an odd number of the row's crossings lie strictly right of x; with the crossings of the row sorted once, that count is read off by
 * walking the row's samples left to right - the same crossings (same formula), the same strict test, so exactly the same points
 * (dev/zones-link-scan.test.mjs checks it against the per-point test). The street map's 12 zones: ~31 -> ~3 ms in node.
 */
export function samplesOf(Z, zoneAt, step) {
  const out = new Map();
  if ( !Z ) return out;
  const cr = [];                                           // per ring of a part: its sorted crossings of the current row
  for ( const z of Z.zones ) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for ( const part of z.parts ?? [z.rings] ) { const p = part[0]; for ( let i = 0; i < p.length; i += 2 ) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); } }
    const pts = [];
    // zones never overlap: a point inside this zone's own rings is this zone (testing every zone per sample was O(zones^2))
    const parts = z.parts ?? [[z.rings]];
    const xs = []; for ( let x = x0 + step / 2; x < x1; x += step ) xs.push(x);   // (the same x values, row after row, as the old loop)
    const nr = parts.reduce((s, part) => s + part.length, 0);
    while ( cr.length < nr ) cr.push([]);
    const at = new Int32Array(nr);                          // per ring: how many of its crossings are <= the current x
    for ( let y = y0 + step / 2; y < y1; y += step ) {
      let r = 0;
      for ( const part of parts ) for ( const ring of part ) rowCrossings(ring, y, cr[r++]);
      at.fill(0);
      for ( const x of xs ) {
        let mine = false;
        r = 0;
        for ( const part of parts ) {
          let inside = false;
          for ( let h = 0; h < part.length; h++, r++ ) {
            const c = cr[r]; let k = at[r];
            while ( k < c.length && c[k] <= x ) k++;
            at[r] = k;
            const odd = ((c.length - k) & 1) === 1;            // inRing: crossings with x < cross
            if ( h === 0 ) inside = odd; else if ( odd ) inside = false;
          }
          if ( inside ) mine = true;
        }
        if ( mine ) pts.push(x, y);
      }
    }
    if ( !pts.length ) pts.push(z.label.x, z.label.y);
    out.set(z.id, pts);
  }
  return out;
}

function segDist2(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
  const px = ax + dx * t - x, py = ay + dy * t - y;
  return px * px + py * py;
}
/** Does a stroke (path p, radius r) cover a point? */
export function strokeCovers(s, x, y) {
  const p = s.p, r2 = s.r * s.r;
  if ( p.length === 2 ) return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= r2;
  for ( let i = 2; i < p.length; i += 2 ) if ( segDist2(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]) <= r2 ) return true;
  return false;
}
const boxOf = (s) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for ( let i = 0; i < s.p.length; i += 2 ) { x0 = Math.min(x0, s.p[i]); x1 = Math.max(x1, s.p[i]); y0 = Math.min(y0, s.p[i + 1]); y1 = Math.max(y1, s.p[i + 1]); } return [x0 - s.r, y0 - s.r, x1 + s.r, y1 + s.r]; };

/**
 * PERF (ultra1-zones, 2026-11-10): a stroke's box and the box of each of its segments (grown by the radius and a hair), kept per
 * stroke while its path and radius stay. A point outside a segment's grown box lies further than r from it (the nearest point of a
 * segment lies in its box), so strokeCovers' answer is the same when only the segments whose box holds the point are measured
 * (the same segDist2, the same <= test). Long strokes over big zones measured every segment for every sample.
 */
const preps = new WeakMap();
function prepOf(s) {
  let q = preps.get(s);
  if ( q && q.p === s.p && q.r === s.r ) return q;
  const p = s.p, r = s.r, m = r + 1e-6 * (1 + Math.abs(r));
  const n = p.length >= 4 ? p.length / 2 - 1 : 0, seg = new Float64Array(n * 4);
  for ( let k = 0, i = 2; i < p.length; i += 2, k += 4 ) {
    const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1];
    seg[k] = Math.min(ax, bx) - m; seg[k + 1] = Math.min(ay, by) - m; seg[k + 2] = Math.max(ax, bx) + m; seg[k + 3] = Math.max(ay, by) + m;
  }
  q = { p, r, box: boxOf(s), seg };
  preps.set(s, q);
  return q;
}
function covers(s, q, x, y) {
  const p = s.p, r2 = s.r * s.r;
  if ( p.length === 2 ) return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= r2;
  const seg = q.seg;
  for ( let i = 2, k = 0; i < p.length; i += 2, k += 4 ) {
    if ( x < seg[k] || y < seg[k + 1] || x > seg[k + 2] || y > seg[k + 3] ) continue;
    if ( segDist2(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]) <= r2 ) return true;
  }
  return false;
}
const burning = (s) => s.k === "fire" && s.o === undefined && !!s.p?.length;
/** An eraser that cuts (not undone): it puts out what was painted before it, where it lies (fire/model.mjs raster). */
const cutting = (s) => s.k === "erase" && s.o === undefined && !!s.p?.length;
/** Is stroke `e` later than `s` in the paint order (fire/model.mjs byOrder: q, then id)? */
const later = (e, s) => ((e.q ?? 0) - (s.q ?? 0) || (e.id < s.id ? -1 : e.id > s.id ? 1 : 0)) > 0;
/** The erasers of a list of strokes that cut (fireIn's third argument). */
export const erasersOf = (strokes) => (strokes ?? []).filter(cutting);
const meet = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

/**
 * The burning fire strokes that cover samples of a zone: [{ s, hits }]. `erasers` (erasersOf): a sample an eraser painted after the
 * stroke lies over is put out there and is not counted (D205: the zones put out ONE zone of a stroke that reaches over several by
 * cutting it there with an eraser - the fire layer's own way - and the zone must read that; the GM's own eraser strokes count the same).
 */
export function fireIn(samples, fire, erasers = null) {
  const out = [];
  const rows = rowSorted(samples);
  for ( const s of fire ?? [] ) {
    if ( !burning(s) ) continue;
    const q = prepOf(s), [x0, y0, x1, y1] = q.box;
    const cut = erasers?.length ? erasers.filter((e) => later(e, s) && meet(prepOf(e).box, q.box)) : null;
    let hits = 0;
    // samples ordered by row (samplesOf): start at the first row inside the box, stop past its last (the rows skipped fail y0 / y1)
    let i = 0, end = samples.length;
    if ( rows ) {
      let lo = 0, hi = samples.length / 2;
      while ( lo < hi ) { const m = (lo + hi) >> 1; if ( samples[2 * m + 1] < y0 ) lo = m + 1; else hi = m; }
      i = 2 * lo;
    }
    for ( ; i < end; i += 2 ) {
      const x = samples[i], y = samples[i + 1];
      if ( y > y1 && rows ) break;
      if ( x < x0 || x > x1 || y < y0 || y > y1 ) continue;
      if ( covers(s, q, x, y) && !(cut?.length && cut.some((e) => covers(e, prepOf(e), x, y))) ) hits++;
    }
    if ( hits ) out.push({ s, hits });
  }
  return out;
}

/** Does a zone read fire from these hits (derive's rule: a twentieth of its samples, or two of them)? */
const readsFire = (hit, n) => hit / n >= FIRE_SHARE || hit >= 2;

/**
 * PUTTING OUT THE FIRE OF ONE ZONE (D205, the fire roll is per zone [B2927]): what to do on the fire layer so that zone `id` reads no
 * fire and every other zone keeps what it reads. -> { remove: [ids of strokes to put out whole], erase: [{ p, r }] erasers to paint }.
 *  - a stroke that burns in this zone and makes no other zone burn goes out whole (as before);
 *  - a stroke that also makes another zone burn is CUT: erasers over the samples of this zone it covers, so the rest burns on. (Before,
 *    a stroke went out whole when half of it lay in the zone - putting one zone out put out its neighbours too - and not at all
 *    when less did - the zone burned on.)
 * The erasers run along the zone's sample rows (`step` apart, the same grid as samplesOf): one path per run of covered samples,
 * runs of the next row joined where a sample lies right below the run's end (a straight step down, inside the zone), radius
 * 0.65 x step - it closes the gap between rows yet stays short of the next zone's samples (a step away).
 */
export function putOutPlan(samplesById, id, strokes, step) {
  const pts = samplesById.get(id);
  if ( !pts?.length ) return { remove: [], erase: [] };
  const erasers = erasersOf(strokes), fire = (strokes ?? []).filter(burning);
  const here = fireIn(pts, fire, erasers);
  if ( !here.length ) return { remove: [], erase: [] };
  const remove = [], cut = [];
  for ( const h of here ) {
    let elsewhere = false;
    for ( const [zid, zp] of samplesById ) {
      if ( zid === id ) continue;
      const f = fireIn(zp, [h.s], erasers);
      if ( f.length && readsFire(f[0].hits, zp.length / 2) ) { elsewhere = true; break; }
    }
    (elsewhere ? cut : remove).push(h.s);
  }
  return { remove: remove.map((s) => s.id), erase: cut.length ? erasePaths(pts, cut, erasers, step) : [] };
}
/** The eraser paths over the samples of a zone that the strokes `cut` cover (see putOutPlan). */
function erasePaths(pts, cut, erasers, step) {
  const r = Math.max(4, Math.round(step * 0.65)), eps = step * 0.01, rowsBy = new Map();
  for ( let i = 0; i < pts.length; i += 2 ) {
    const x = pts[i], y = pts[i + 1];
    if ( !fireIn([x, y], cut, erasers).length ) continue;
    if ( !rowsBy.has(y) ) rowsBy.set(y, []);
    rowsBy.get(y).push(x);
  }
  const ys = [...rowsBy.keys()].sort((a, b) => a - b), runs = [];
  for ( const y of ys ) {
    const xs = rowsBy.get(y).sort((a, b) => a - b), row = [];
    let a = xs[0], b = xs[0];
    for ( let k = 1; k < xs.length; k++ ) { if ( xs[k] - b > step + eps ) { row.push({ y, a, b }); a = xs[k]; } b = xs[k]; }
    row.push({ y, a, b });
    runs.push(row);
  }
  const out = [];
  for ( let ri = 0; ri < runs.length; ri++ ) for ( const start of runs[ri] ) {
    if ( start.used ) continue;
    start.used = true;
    const p = [start.a, start.y, start.b, start.y];
    let end = start.b, row = ri;
    while ( row + 1 < runs.length && Math.abs(ys[row + 1] - ys[row] - step) <= eps && p.length < 1990 ) {
      const next = runs[row + 1].find((n) => !n.used && n.a - eps <= end && end <= n.b + eps);
      if ( !next ) break;
      next.used = true;
      const near = Math.abs(end - next.a) <= Math.abs(next.b - end) ? next.a : next.b, far = near === next.a ? next.b : next.a;
      p.push(end, next.y, near, next.y, far, next.y);
      end = far; row++;
    }
    const q = [];
    for ( let k = 0; k < p.length; k += 2 ) if ( !q.length || q[q.length - 2] !== p[k] || q[q.length - 1] !== p[k + 1] ) q.push(p[k], p[k + 1]);
    out.push({ p: q, r });
  }
  return out;
}
/** Are the samples' y never decreasing (row after row, as samplesOf lays them)? Kept per samples array. */
const sorted = new WeakMap();
function rowSorted(pts) {
  let v = sorted.get(pts);
  if ( v === undefined ) { v = true; for ( let i = 3; i < pts.length; i += 2 ) if ( !(pts[i] >= pts[i - 2]) ) { v = false; break; } sorted.set(pts, v); }
  return v;
}
/** The box of a zone's samples [x0, y0, x1, y1] (kept per samples array). */
const sboxes = new WeakMap();
function samplesBox(pts) {
  let b = sboxes.get(pts);
  if ( b ) return b;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( let i = 0; i < pts.length; i += 2 ) { const x = pts[i], y = pts[i + 1]; if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y; }
  sboxes.set(pts, b = [x0, y0, x1, y1]);
  return b;
}

/**
 * The states each zone gets from the layers: id -> { fire?, wrecked?, flooded?, water? }.
 *  fire  = [{ k, p, r, lv, o }]  the fire layer's strokes
 *  water = { px, w, h, masks: { water, river, fall }, rect }   (rect: the scene rectangle the masks start at)
 *  dest  = { mask, mw, mh, mpx, rect }                          (mask byte: bits 0-1 level, bits 2-4 type; type 3 = flood)
 */
export function derive(samplesById, { fire = null, water = null, dest = null } = {}) {
  const out = new Map();
  // only the burning strokes, and per zone only those whose box meets the box of its samples (the others cover none of them)
  const live = fire?.length ? fire.filter(burning) : null, cuts = fire?.length ? erasersOf(fire) : null;
  for ( const [id, pts] of samplesById ) {
    const n = pts.length / 2, o = {};
    if ( fire?.length ) {
      const [zx0, zy0, zx1, zy1] = samplesBox(pts);
      const near = live.filter((s) => { const b = prepOf(s).box; return !(b[2] < zx0 || b[0] > zx1 || b[3] < zy0 || b[1] > zy1); });
      const f = fireIn(pts, near, cuts);
      const hit = f.reduce((m, x) => Math.max(m, x.hits), 0);
      if ( f.length && (hit / n >= FIRE_SHARE || hit >= 2) ) o.fire = Math.max(...f.map((x) => LEVEL_INTENSITY[x.s.lv ?? 2] ?? 8));
    }
    if ( water?.masks ) {
      let wet = 0;
      const { px, w, h, masks, rect } = water;
      for ( let i = 0; i < pts.length; i += 2 ) {
        const ax = Math.floor((pts[i] - rect.x) / px), ay = Math.floor((pts[i + 1] - rect.y) / px);
        if ( ax < 0 || ay < 0 || ax >= w || ay >= h ) continue;
        const k = ay * w + ax;
        if ( masks.water?.[k] || masks.river?.[k] || masks.fall?.[k] ) wet++;
      }
      if ( wet / n >= SHARE ) o.water = true;
    }
    if ( dest?.mask ) {
      let broken = 0, flood = 0;
      const { mask, mw, mh, mpx, rect } = dest;
      for ( let i = 0; i < pts.length; i += 2 ) {
        const ax = Math.floor((pts[i] - rect.x) / mpx), ay = Math.floor((pts[i + 1] - rect.y) / mpx);
        if ( ax < 0 || ay < 0 || ax >= mw || ay >= mh ) continue;
        const b = mask[ay * mw + ax], lv = b & 3;
        if ( lv >= 2 ) broken++;
        if ( lv >= 1 && ((b >> 2) & 7) === 3 ) flood++;
      }
      if ( broken / n >= SHARE ) o.wrecked = true;
      if ( flood / n >= SHARE ) o.flooded = true;
    }
    if ( Object.keys(o).length ) out.set(id, o);
  }
  return out;
}

/** A zone's props with what the layers say on top: flags OR-ed, fire the higher of the two. */
export function merge(own = {}, map = {}) {
  const o = { ...own };
  for ( const k of ["wrecked", "flooded", "water"] ) if ( map[k] ) o[k] = true;
  if ( map.fire ) o.fire = Math.max(own.fire ?? 0, map.fire);
  return o;
}
