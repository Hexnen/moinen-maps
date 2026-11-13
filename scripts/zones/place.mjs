/**
 * Where small things on the zones go so they stay readable - the pure part (no Foundry, no PIXI):
 *
 *  - a highlight's LABEL takes, of a few spots around its anchor, the one where it covers the least (tokens, the zone's number
 *    badge and icons, passage marks, labels placed before it) and stays inside its zone if it can (highlight-layer.mjs);
 *  - a PASSAGE (a temporary edge: portal, tunnel) gets a mark in each zone it joins, beside the zone's middle on the side of its
 *    other end, several in a row (display.mjs).
 *
 * Boxes are { x0, y0, x1, y1 } in scene pixels.
 */

const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** What a label would cover at a spot, as a number to keep small (0: nothing; 1 ~ a label fully on a block of weight 1). */
export function spotCost(box, blocks, inside = null) {
  const area = Math.max(1e-9, (box.x1 - box.x0) * (box.y1 - box.y0));
  let c = 0;
  // (what counts is how much of the label is covered: far zoomed out a token is a dot on it; any touch still counts a little)
  for ( const b of blocks ) { const o = overlap(box, b); if ( o > 0 ) c += (o / area + 0.1) * (b.w ?? 1); }
  if ( inside ) {
    // out of its zone a label reads as the neighbour's (as bad as being hidden): its middle and its two ends are asked
    const my = (box.y0 + box.y1) / 2, mx = (box.x0 + box.x1) / 2;
    let out = 0;
    for ( const [x, y] of [[mx, my], [box.x0, my], [box.x1, my]] ) if ( !inside(x, y) ) out++;
    c += out;
  }
  return c;
}

/**
 * The spot a label takes: the index into `cands`.
 * @param {{x: number, y: number}} at        the anchor (scene px)
 * @param {{w: number, h: number}} half      the label's half width and height (scene px)
 * @param {Array<{dx: number, dy: number}>} cands   offsets of the label's middle from the anchor (scene px), the preferred first
 * @param {Array<{x0, y0, x1, y1, w?}>} blocks      what it should not cover (`w`: how much it matters)
 * @param {(x: number, y: number) => boolean} [inside]   is a scene point in the label's own zone
 * @param {number|{dx, dy}} [prev]           the spot it has now (its index or its offset; -1: none): kept unless another is clearly
 *                                           better, so a label does not hop about while tokens move
 */
export function pickSpot(at, half, cands, blocks, inside = null, prev = -1) {
  if ( prev && typeof prev === "object" ) prev = cands.findIndex((c) => Math.abs(c.dx - prev.dx) < 0.5 && Math.abs(c.dy - prev.dy) < 0.5);
  let best = 0, bc = Infinity;
  const costs = cands.map((c, i) => {
    const x = at.x + c.dx, y = at.y + c.dy;
    const cost = spotCost({ x0: x - half.w, y0: y - half.h, x1: x + half.w, y1: y + half.h }, blocks, inside) + i * 0.02;
    if ( cost < bc - 1e-9 ) { bc = cost; best = i; }
    return cost;
  });
  if ( prev >= 0 && prev < cands.length && costs[prev] <= bc + 0.2 ) return prev;
  return best;
}

/**
 * The spots a zone's label may take, as offsets from the zone's middle in the label's own units (multiply by its scale).
 * `w`: the label's width; `clear`: half the size of what sits on the zone's middle (its number badge; 0: nothing there);
 * `below`: how far something reaches under the middle (the icons under the badge; 0: nothing).
 */
export function zoneSpots(w, clear = 0, below = 0) {
  const up = clear ? clear + 14 : 0, dn = Math.max(clear, below) + 14, side = clear + 8 + w / 2;
  const out = clear ? [] : [{ dx: 0, dy: 0 }];
  out.push({ dx: 0, dy: -up || -26 }, { dx: 0, dy: dn }, { dx: side, dy: 0 }, { dx: -side, dy: 0 },
    { dx: 0, dy: -(up || 26) - 26 }, { dx: side, dy: -(up || 26) }, { dx: -side, dy: -(up || 26) }, { dx: 0, dy: dn + 26 }, { dx: side, dy: dn }, { dx: -side, dy: dn });
  return out;
}

/**
 * The spots a border's label may take: on the line where it was put, then pushed off the line to either side, then along it.
 * `u`: the line's direction there (a unit vector), `w`: the label's width (label units).
 */
export function borderSpots(w, u = { x: 1, y: 0 }) {
  const n = { x: -u.y, y: u.x }, off = 20, along = w + 10;
  // (a label is wide and low: off a line that runs across the screen it needs less room than off one that runs down it)
  const k = Math.abs(n.x) * (w / 2 + 6) + Math.abs(n.y) * off;
  return [{ dx: 0, dy: 0 }, { dx: n.x * k, dy: n.y * k }, { dx: -n.x * k, dy: -n.y * k }, { dx: u.x * along, dy: u.y * along }, { dx: -u.x * along, dy: -u.y * along },
    { dx: u.x * along + n.x * k, dy: u.y * along + n.y * k }, { dx: -u.x * along - n.x * k, dy: -u.y * along - n.y * k }];
}

/* ---------------------------------------------------------------- passages */

const keyOfSpot = (s) => String(s ?? "").split(":")[0];

/**
 * The marks of the passages on the map as it is now.
 * @param {Array<{id, kind, a, b}>} edges    the stored edges (states.mjs)
 * @param {(key: string) => number} idOf     zone key -> zone id (-1: no such zone now)
 * @param {(id: number) => {x: number, y: number}|null} midOf   a zone's middle
 * @returns {Array<{ id, kind, ends: Array<{ zone: number, side: -1|1, slot: number, far: string|null }>, joined: boolean }>}
 *   `ends`: one per end that lies in a zone of the map (an end in an off-map area or in a zone that is gone has none; both ends in
 *   one zone - two of its levels - give one). `side`: which side of the zone's middle the mark sits on (towards the other end),
 *   `slot`: its place in the row on that side (0: nearest the middle). `far`: the other end's spot. `joined`: a line runs between
 *   its two marks.
 */
export function passageMarks(edges, idOf, midOf) {
  const out = [], rows = new Map();
  const slot = (zone, side) => { const k = `${zone}|${side}`, n = rows.get(k) ?? 0; rows.set(k, n + 1); return n; };
  for ( const e of edges ?? [] ) {
    const ka = keyOfSpot(e.a), kb = keyOfSpot(e.b);
    const ia = ka && ka[0] !== "@" ? idOf(ka) : -1, ib = kb && kb[0] !== "@" ? idOf(kb) : -1;
    const ends = [];
    if ( ia >= 0 && ib >= 0 && ia !== ib ) {
      const ma = midOf(ia), mb = midOf(ib), sa = ma && mb && mb.x < ma.x ? -1 : 1;
      ends.push({ zone: ia, side: sa, slot: slot(ia, sa), far: e.b }, { zone: ib, side: -sa, slot: slot(ib, -sa), far: e.a });
    }
    else if ( ia >= 0 ) ends.push({ zone: ia, side: 1, slot: slot(ia, 1), far: e.b });
    else if ( ib >= 0 ) ends.push({ zone: ib, side: 1, slot: slot(ib, 1), far: e.a });
    if ( ends.length ) out.push({ id: e.id, kind: e.kind, ends, joined: ends.length === 2 });
  }
  return out;
}

/**
 * Where the marks of one zone sit: the offsets of their middles from the zone's middle along the screen's x (mark units), for the
 * marks' `side` and `slot`. `clear`: half the width of what sits on the zone's middle (0: nothing - the marks take the middle
 * itself, in one row); `r`: a mark's radius; `gap`: between two marks; `oneSide`: all to the right, in the order given (the
 * zone's things sit in its top left corner: to the left is the neighbour).
 * @param {Array<{side: -1|1, slot: number}>} ends   the marks of ONE zone
 * @returns {number[]}   dx per mark, in the order given
 */
export function markOffsets(ends, clear = 0, r = 12, gap = 4, oneSide = false) {
  const step = 2 * r + gap;
  if ( oneSide ) return ends.map((e, i) => (clear > 0 ? clear + 7 + r : 0) + i * step);
  if ( clear > 0 ) return ends.map((e) => e.side * (clear + 7 + r + e.slot * step));
  // nothing in the middle: one row across it, the left side's marks first (the farthest slot outermost)
  const order = ends.map((e, i) => ({ i, k: e.side < 0 ? -1 - e.slot : e.slot })).sort((a, b) => a.k - b.k);
  const out = new Array(ends.length);
  order.forEach((o, n) => { out[o.i] = (n - (ends.length - 1) / 2) * step; });
  return out;
}

/**
 * C14 (the user's answer of 2026-11-12): the marks of one zone's passages stand as ONE mark with a count when their row does not
 * fit in the zone (a small zone, or the map seen from far out), instead of a row running out of it. `dx`: the marks' offsets
 * (markOffsets, in a badge's units), `s`: scene pixels per unit now, `room`: how far the zone reaches from its spot (label.r),
 * `r`: a mark's radius. Returns -1 (each mark its own) or the index of the mark that stands for all (the one nearest the spot).
 */
export function passGroup(dx, s, room, r = 12) {
  if ( !(dx?.length > 1) ) return -1;
  let far = 0, k = 0;
  dx.forEach((d, i) => { far = Math.max(far, Math.abs(d)); if ( Math.abs(d) < Math.abs(dx[k]) ) k = i; });
  return (far + r) * s > room ? k : -1;
}

/** A gentle arc from a to b as a polyline [x, y, ...] (`bow`: how far its middle leaves the straight line, as a share of its length). */
export function arc(a, b, bow = 0.12, n = 20) {
  const dx = b.x - a.x, dy = b.y - a.y, cx = (a.x + b.x) / 2 - dy * bow, cy = (a.y + b.y) / 2 + dx * bow, out = [];
  for ( let i = 0; i <= n; i++ ) { const t = i / n, u = 1 - t; out.push(u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y); }
  return out;
}

/**
 * Spots for a label just outside each thing that hides it and stands near (a token is far bigger than a label's usual steps):
 * above, under, right and left of the thing. `near`: boxes ({ x0, y0, x1, y1 }), `reach`: how far from the anchor a thing counts,
 * `gap`: between the thing and the label. Offsets like `cands` of pickSpot.
 */
export function spotsAround(at, half, near, reach, gap = 4) {
  const out = [];
  for ( const t of near ) {
    if ( t.x1 < at.x - reach || t.x0 > at.x + reach || t.y1 < at.y - reach || t.y0 > at.y + reach ) continue;
    out.push({ dx: 0, dy: t.y0 - gap - half.h - at.y }, { dx: 0, dy: t.y1 + gap + half.h - at.y }, { dx: t.x1 + gap + half.w - at.x, dy: 0 }, { dx: t.x0 - gap - half.w - at.x, dy: 0 });
  }
  return out;
}

/**
 * How much thinner a highlight's band is drawn: by the room its zone has on screen (`rScreen`: 1 at `full` screen px and more) and
 * by how far out the map is seen (`cell`: a grid square in screen px; 1 at `cellFull` and more), never under `min`.
 */
export const thin = (rScreen, cell = Infinity, full = 64, cellFull = 36, min = 0.4) => Math.max(min, Math.min(1, rScreen / full) * Math.max(0.55, Math.min(1, cell / cellFull)));
