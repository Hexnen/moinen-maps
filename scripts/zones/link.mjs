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

/** Sample points per zone: id -> [x0, y0, x1, y1, ...] (scene px), `step` apart. */
export function samplesOf(Z, zoneAt, step) {
  const out = new Map();
  if ( !Z ) return out;
  for ( const z of Z.zones ) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for ( const part of z.parts ?? [z.rings] ) { const p = part[0]; for ( let i = 0; i < p.length; i += 2 ) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); } }
    const pts = [];
    for ( let y = y0 + step / 2; y < y1; y += step ) for ( let x = x0 + step / 2; x < x1; x += step ) if ( zoneAt(x, y) === z.id ) pts.push(x, y);
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

/** The burning fire strokes that cover samples of a zone: [{ s, hits }] (erasers ignored: the fire layer keeps them as strokes of their own). */
export function fireIn(samples, fire) {
  const out = [];
  for ( const s of fire ?? [] ) {
    if ( s.k !== "fire" || s.o !== undefined || !s.p?.length ) continue;
    const [x0, y0, x1, y1] = boxOf(s);
    let hits = 0;
    for ( let i = 0; i < samples.length; i += 2 ) {
      const x = samples[i], y = samples[i + 1];
      if ( x < x0 || x > x1 || y < y0 || y > y1 ) continue;
      if ( strokeCovers(s, x, y) ) hits++;
    }
    if ( hits ) out.push({ s, hits });
  }
  return out;
}

/**
 * The states each zone gets from the layers: id -> { fire?, wrecked?, flooded?, water? }.
 *  fire  = [{ k, p, r, lv, o }]  the fire layer's strokes
 *  water = { px, w, h, masks: { water, river, fall }, rect }   (rect: the scene rectangle the masks start at)
 *  dest  = { mask, mw, mh, mpx, rect }                          (mask byte: bits 0-1 level, bits 2-4 type; type 3 = flood)
 */
export function derive(samplesById, { fire = null, water = null, dest = null } = {}) {
  const out = new Map();
  for ( const [id, pts] of samplesById ) {
    const n = pts.length / 2, o = {};
    if ( fire?.length ) {
      const f = fireIn(pts, fire);
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
