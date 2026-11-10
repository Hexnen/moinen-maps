/**
 * The part of the screen where the map can be seen and clicked - the pure part (no Foundry, no DOM): the insets other interface
 * parts declare (a bar at the bottom, a tracker at the top), the largest stretch of the screen nothing covers, where a point lies
 * against that stretch and how far the view has to move to bring it in. The measuring and the moving are interact.mjs.
 *
 * Everything here is in screen pixels (client coordinates): x to the right, y down.
 */

export const SIDES = ["top", "right", "bottom", "left"];
const LIMIT = 8000;
const px = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(n, LIMIT) : 0; };

/** Insets as numbers: { top, right, bottom, left } (what is not a positive number counts 0). null: nothing was given. */
export function cleanInsets(o) {
  if ( !o || typeof o !== "object" ) return null;
  return { top: px(o.top), right: px(o.right), bottom: px(o.bottom), left: px(o.left) };
}
/** Several insets as one: on every side the largest (bars on one side lie over each other or beside each other, never in a row). */
export function sumInsets(list) {
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  for ( const i of list ?? [] ) if ( i ) for ( const s of SIDES ) out[s] = Math.max(out[s], px(i[s]));
  return out;
}

/**
 * The largest rectangle of free cells in a grid: { c0, r0, c1, r1 } (first and last column and row, inclusive) or null when no
 * cell is free. `free[r * cols + c]` is truthy for a free cell. Ties: the one found first (top, then left).
 */
export function largestRect(free, cols, rows) {
  const h = new Int32Array(cols + 1), stack = new Int32Array(cols + 1);
  let best = null, area = 0;
  for ( let r = 0; r < rows; r++ ) {
    for ( let c = 0; c < cols; c++ ) h[c] = free[r * cols + c] ? h[c] + 1 : 0;
    let top = 0;
    for ( let c = 0; c <= cols; c++ ) {
      const cur = c < cols ? h[c] : 0;
      while ( top > 0 && h[stack[top - 1]] >= cur ) {
        const i = stack[--top], left = top > 0 ? stack[top - 1] + 1 : 0, a = h[i] * (c - left);
        if ( a > area ) { area = a; best = { c0: left, r0: r - h[i] + 1, c1: c - 1, r1: r }; }
      }
      if ( c < cols ) stack[top++] = c;
    }
  }
  return best;
}

/**
 * The stretch of the screen the map is free on: { x, y, w, h }.
 *   vw, vh    the window
 *   insets    what the bars declared ({ top, right, bottom, left })
 *   measured  the largest rectangle found free by looking ({ x, y, w, h }), or null when nobody looked
 * The declared insets always count. What was measured narrows it further, unless that would leave less than `min` of the declared
 * stretch in either direction (windows lying all over the map: then the declared stretch stands).
 */
export function safeRect(vw, vh, insets = null, measured = null, { min = 0.15 } = {}) {
  const i = sumInsets([insets]);
  const x0 = Math.min(i.left, vw), y0 = Math.min(i.top, vh), x1 = Math.max(x0, vw - i.right), y1 = Math.max(y0, vh - i.bottom);
  const base = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if ( !measured ) return base;
  const mx0 = Math.max(x0, measured.x), my0 = Math.max(y0, measured.y), mx1 = Math.min(x1, measured.x + measured.w), my1 = Math.min(y1, measured.y + measured.h);
  if ( mx1 - mx0 < base.w * min || my1 - my0 < base.h * min ) return base;
  return { x: mx0, y: my0, w: mx1 - mx0, h: my1 - my0 };
}

export const inRect = (p, r, m = 0) => p.x >= r.x + m && p.x <= r.x + r.w - m && p.y >= r.y + m && p.y <= r.y + r.h - m;

/**
 * How far a point has to be moved on the screen to lie inside a rectangle, `margin` away from its edges (the margin is never more
 * than a third of the rectangle): { dx, dy }, both 0 when it is there already.
 */
export function nudge(p, r, margin = 0) {
  const mx = Math.min(margin, r.w / 3), my = Math.min(margin, r.h / 3);
  const dx = p.x < r.x + mx ? r.x + mx - p.x : p.x > r.x + r.w - mx ? r.x + r.w - mx - p.x : 0;
  const dy = p.y < r.y + my ? r.y + my - p.y : p.y > r.y + r.h - my ? r.y + r.h - my - p.y : 0;
  return { dx, dy };
}

/**
 * How far a box of points ({ x0, y0, x1, y1 }) has to be moved to lie inside a rectangle, and how much smaller it has to get to
 * fit at all: { dx, dy, k } - k 1 when it fits as it is, else the factor (< 1) to scale the view by around the rectangle's middle
 * before moving (dx, dy are then for the box as it is after scaling).
 */
export function fitBox(b, r, margin = 0) {
  const mx = Math.min(margin, r.w / 3), my = Math.min(margin, r.h / 3), w = r.w - 2 * mx, h = r.h - 2 * my;
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const k = Math.min(1, bw > 0 ? w / bw : 1, bh > 0 ? h / bh : 1);
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const s = (v, c) => c + (v - c) * k;
  const x0 = s(b.x0, cx), x1 = s(b.x1, cx), y0 = s(b.y0, cy), y1 = s(b.y1, cy);
  const dx = x0 < r.x + mx ? r.x + mx - x0 : x1 > r.x + r.w - mx ? r.x + r.w - mx - x1 : 0;
  const dy = y0 < r.y + my ? r.y + my - y0 : y1 > r.y + r.h - my ? r.y + r.h - my - y1 : 0;
  return { dx, dy, k };
}

/**
 * The side of a rectangle a point lies beyond: "top" | "right" | "bottom" | "left", the side it is farther beyond when it is
 * beyond two; inside: null, or with `nearest` the side whose edge it is closest to.
 */
export function sideOf(p, r, nearest = false) {
  const l = r.x - p.x, t = r.y - p.y, rt = p.x - (r.x + r.w), b = p.y - (r.y + r.h);
  const over = Math.max(l, t, rt, b);
  if ( !(over > 0) && !nearest ) return null;
  return over === b ? "bottom" : over === t ? "top" : over === rt ? "right" : "left";
}

/**
 * The sides a pointer pushes against: it is within `band` of an edge of the rectangle (or beyond it). -> { x: -1 | 0 | 1, y: -1 | 0 | 1 }
 * (the direction on the screen the pointer pushes in).
 */
export function pushOf(p, r, band = 44) {
  return { x: p.x < r.x + band ? -1 : p.x > r.x + r.w - band ? 1 : 0, y: p.y < r.y + band ? -1 : p.y > r.y + r.h - band ? 1 : 0 };
}

/**
 * Where something of height `h` can sit at or below `y` without lying on any of the boxes it would cover ({ top, bottom } of what
 * is in its column): the nearest free height, never lower than `maxY`. `gap`: kept between it and a box.
 */
export function clearY(y, h, boxes, gap = 8, maxY = Infinity) {
  let at = y;
  for ( let i = 0; i < 12; i++ ) {
    let next = at;
    for ( const b of boxes ) if ( b.top < at + h + gap && b.bottom > at - gap ) next = Math.max(next, b.bottom + gap);
    if ( next === at ) return at;
    if ( next + h > maxY ) return at;
    at = next;
  }
  return at;
}
