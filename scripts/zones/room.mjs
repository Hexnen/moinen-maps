/**
 * Room for the map's own floating things - the pure part (no Foundry, no DOM, no PIXI; dev/zones-api.md section 41):
 *  - spreadLabels: the labels the map draws at tokens (the pill of a token mark, a line's pill) laid out together, so no two lie
 *    over each other: a label that would cover another is pushed aside or stacked above it, as little as it can;
 *  - menuSpot: where a menu at a thing goes - beside it, inside the window less the bars other modules declared (uiInset), clear of
 *    the boxes they asked the map to keep clear of (uiAvoid) as far as the room allows;
 *  - chipSpot: where a small chip of the map's own (the director's "My view") goes along the bottom of a stretch, clear of those
 *    boxes and of the labels on the map.
 * A box is { x0, y0, x1, y1 }. Nothing is placed by these functions: they answer where.
 */

/** The area two boxes share (0: none). */
export const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
/** A box as a clean one, or null (what is not four finite numbers with some width and height). */
export function cleanBox(b) {
  if ( !b || typeof b !== "object" ) return null;
  let { x0, y0, x1, y1 } = b;
  if ( x0 == null && Number.isFinite(Number(b.x ?? b.left)) ) {
    x0 = Number(b.x ?? b.left); y0 = Number(b.y ?? b.top);
    x1 = x0 + Number(b.width ?? b.w); y1 = y0 + Number(b.height ?? b.h);
  }
  [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Number);
  if ( ![x0, y0, x1, y1].every(Number.isFinite) || x1 - x0 <= 0 || y1 - y0 <= 0 ) return null;
  return { x0, y0, x1, y1 };
}
const sumOver = (b, list) => { let s = 0; for ( const o of list ) s += overlap(b, o); return s; };

/**
 * Lay labels out together.
 *   items   [{ key, x, y, w, h, prio = 0, was: { dx, dy } | null, over: [box], alt: [{ dy }] }]: each label's middle where it
 *           would stand alone, its size; a higher `prio` keeps its own spot first (the token under the pointer, the one chosen);
 *           `was`: the shift it had before (kept while it is still free, so a label does not hop about while a token walks);
 *           `over`: boxes drawn above this label (it must not lie under them); `alt`: more rows to try (under its own token)
 *   fixed   boxes nothing may cover (other labels of the map that stand where they stand)
 *   o.gap   room left between two labels; o.steps how many rows a label may climb; o.reach how far it may slide sideways
 *           (a share of its own width)
 * -> Map key -> { dx, dy } (0, 0: where it would stand alone). In the units given (scene px for the map).
 */
export function spreadLabels(items, fixed = [], { gap = 2, steps = 4, reach = 0.8, soft = null, walls = null } = {}) {
  const out = new Map(), placed = (fixed ?? []).map(cleanBox).filter(Boolean);
  // (walls: panels of the interface over the map - uiAvoid boxes, uiInset bars - in the same units: a label under one cannot be seen. They
  //  are as hard as another label, and a label they cover may go round them at any distance: just left, right, under or over the panel)
  const wallList = (walls ?? []).map(cleanBox).filter(Boolean);
  // (soft: what a label had better not lie on - another token's picture - [{ key, x0, y0, x1, y1 }]: never its own token)
  const softs = (soft ?? []).map((b) => { const c = cleanBox(b); return c ? { ...c, key: b.key } : null; }).filter(Boolean);
  const list = (items ?? []).filter((it) => it && Number.isFinite(it.x) && Number.isFinite(it.y) && it.w > 0 && it.h > 0);
  // the first to choose: the higher prio; then from the top down and from the left (the same layout every time for the same labels)
  list.sort((a, b) => (b.prio ?? 0) - (a.prio ?? 0) || a.y - b.y || a.x - b.x || String(a.key).localeCompare(String(b.key)));
  for ( const it of list ) {
    const hw = it.w / 2, hh = it.h / 2;
    const boxAt = (dx, dy) => ({ x0: it.x + dx - hw, y0: it.y + dy - hh, x1: it.x + dx + hw, y1: it.y + dy + hh });
    // (over: what is drawn ABOVE this label - a token whose picture is drawn after this label's token - as hard as another label: a
    //  pill under a picture cannot be read; alt: more spots the caller knows of, e.g. under its own token)
    const over = (it.over ?? []).map(cleanBox).filter(Boolean), hard = [...placed, ...over, ...wallList];
    const cands = [{ dx: 0, dy: 0, cost: 0 }];
    // (the shift it had: a little cheaper than the same shift found anew - it does not hop between two as good - but never cheaper
    //  than standing where it belongs once that is free)
    if ( it.was && Number.isFinite(it.was.dx) && Number.isFinite(it.was.dy) && (it.was.dx || it.was.dy) ) cands.push({ dx: it.was.dx, dy: it.was.dy, cost: (Math.abs(it.was.dx) + Math.abs(it.was.dy) * 1.25) * 0.9 });
    // up a row at a time (a stack over the token), the caller's own spots, and aside by what is in the way (left or right of it)
    const rows = [0];
    for ( let k = 1; k <= steps; k++ ) rows.push(-k * (it.h + gap));
    for ( const a of it.alt ?? [] ) if ( Number.isFinite(a?.dy) && !rows.includes(a.dy) ) rows.push(a.dy);
    for ( const dy of rows ) {
      if ( dy ) cands.push({ dx: 0, dy, cost: Math.abs(dy) * 1.25 });
      for ( const p of hard ) {
        const b = boxAt(0, dy);
        if ( !(Math.min(b.y1, p.y1) - Math.max(b.y0, p.y0) > 0) ) continue;
        for ( const dx of [p.x1 + gap - b.x0, p.x0 - gap - b.x1] ) if ( Math.abs(dx) <= it.w * reach ) cands.push({ dx, dy, cost: Math.abs(dx) + Math.abs(dy) * 1.25 });
      }
    }
    // round a panel that covers where it stands (U125 a): beside it or under / over it, however far that is
    const home = boxAt(0, 0);
    for ( const p of wallList ) {
      if ( !overlap(home, p) ) continue;
      for ( const dy of rows ) for ( const dx of [p.x0 - gap - home.x1, p.x1 + gap - home.x0] ) cands.push({ dx, dy, cost: Math.abs(dx) + Math.abs(dy) * 1.25 });
      for ( const dy of [p.y1 + gap - home.y0, p.y0 - gap - home.y1] ) cands.push({ dx: 0, dy, cost: Math.abs(dy) * 1.25 });
    }
    // a spot on no other label wins; among those the cheapest, a spot on another token's picture costing as much as its own height
    // moved per share covered; with no free spot, the one that covers the least of the other labels
    const mine = softs.filter((b) => b.key !== it.key), area = it.w * it.h;
    let best = null, bestOver = Infinity, bestCost = Infinity;
    for ( const c of cands ) {
      const b = boxAt(c.dx, c.dy), o = sumOver(b, hard), cost = c.cost + (mine.length && (c.dx || c.dy) ? (sumOver(b, mine) / area) * it.h * 2 : 0);
      if ( o < bestOver - 1e-9 || (Math.abs(o - bestOver) <= 1e-9 && cost < bestCost) ) { best = c; bestOver = o; bestCost = cost; }
    }
    const s = best ?? cands[0];
    out.set(it.key, { dx: s.dx, dy: s.dy });
    placed.push(boxAt(s.dx, s.dy));
  }
  return out;
}

/**
 * The stretch a floating thing of the map may stand in: the window less the declared insets ({ top, right, bottom, left }), on each
 * axis given up for the whole window where what is left is smaller than the thing (`w` x `h` plus the pad).
 */
export function roomOf(vw, vh, insets = null, w = 0, h = 0, pad = 8) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  let x0 = n(insets?.left), x1 = vw - n(insets?.right), y0 = n(insets?.top), y1 = vh - n(insets?.bottom);
  if ( x1 - x0 < w + 2 * pad ) { x0 = 0; x1 = vw; }
  if ( y1 - y0 < h + 2 * pad ) { y0 = 0; y1 = vh; }
  return { x0, y0, x1, y1 };
}

/**
 * Where a menu's box goes (client px): beside its anchor box, right of it, else left; then below or above it. Inside the window
 * less the declared `insets` (a bar declared at the bottom: the menu stands above it), and clear of the `avoid` boxes when some spot
 * is; else the spot that covers the least of them. With no insets and nothing to avoid it is where it always stood.
 *   anchor { x0, y0, x1, y1 }, w x h the menu, vw x vh the window -> { x, y } (the menu's top left corner)
 */
export function menuSpot(anchor, w, h, vw, vh, { gap = 10, pad = 8, insets = null, avoid = null, step = 24, cover = 600 } = {}) {
  const R = roomOf(vw, vh, insets, w, h, pad), boxes = (avoid ?? []).map(cleanBox).filter(Boolean);
  const cx = (x) => Math.max(R.x0 + pad, Math.min(R.x1 - pad - w, x)), cy = (y) => Math.max(R.y0 + pad, Math.min(R.y1 - pad - h, y));
  const mid = (anchor.x0 + anchor.x1) / 2 - w / 2;
  // the spot of old: right of the thing, else left of it, else over its middle; level with its top
  let x = anchor.x1 + gap;
  if ( x + w > R.x1 - pad ) x = anchor.x0 - gap - w;
  if ( x < R.x0 + pad ) x = cx(mid);
  const cands = [{ x, y: cy(anchor.y0) }];
  if ( boxes.length ) {
    const right = anchor.x1 + gap, left = anchor.x0 - gap - w;
    for ( const sx of [right, left] ) if ( sx >= R.x0 + pad && sx + w <= R.x1 - pad ) cands.push({ x: sx, y: cy(anchor.y0) }, { x: sx, y: cy(anchor.y1 - h) });
    cands.push({ x: cx(mid), y: cy(anchor.y1 + gap) }, { x: cx(mid), y: cy(anchor.y0 - gap - h) });
    // beside the boxes in the way: just left of them, just above them (a panel at the side, a strip at the bottom)
    for ( const b of boxes ) cands.push({ x: cx(b.x0 - gap - w), y: cy(anchor.y0) }, { x: cx(right), y: cy(b.y0 - gap - h) }, { x: cx(left), y: cy(b.y0 - gap - h) });
    // U125 (a): and every spot of the room on a grid a step apart, so the free spot NEAREST the thing is found (a menu that jumps
    // across the screen to the first free spot it tries reads as nobody's); a few thousand boxes at most, while a menu is open
    for ( let y = R.y0 + pad; y <= R.y1 - pad - h + 0.5; y += step ) for ( let x = R.x0 + pad; x <= R.x1 - pad - w + 0.5; x += step ) cands.push({ x, y });
    for ( const sx of [right, left] ) for ( let k = -8; k <= 8; k++ ) cands.push({ x: cx(sx), y: cy(anchor.y0 + k * step) });
  }
  // U125 (a): what a spot costs is how far it is from the thing plus how much of the menu lies on the boxes asked for (all of it as much
  // as `cover` px of distance) and on the thing itself (never: five times that). So a free spot beside the thing wins; a free spot
  // across the screen loses to one beside the thing that covers a little of a panel's edge (a menu far from its token reads as
  // nobody's, and it is open for a moment). A spot beside the thing counts as touching it: among those the order of old decides
  // (right, left, then the others); nothing declared: it stands where it always stood.
  const own = cleanBox(anchor), area = Math.max(1, w * h);
  const gapTo = (c) => Math.hypot(Math.max(0, anchor.x0 - (c.x + w), c.x - anchor.x1), Math.max(0, anchor.y0 - (c.y + h), c.y - anchor.y1));
  let best = cands[0], bestCost = Infinity;
  for ( const c of cands ) {
    const b = { x0: c.x, y0: c.y, x1: c.x + w, y1: c.y + h }, g = gapTo(c), d = g <= gap * 1.5 ? 0 : g;
    const cost = d + (cover * sumOver(b, boxes) + (own && boxes.length ? cover * 5 * overlap(b, own) : 0)) / area;
    if ( cost < bestCost - 0.5 ) { best = c; bestCost = cost; }
  }
  return { x: Math.round(best.x), y: Math.round(best.y), far: gapTo(best) > gap * 3 };
}
/**
 * U125 (a): the tie of a menu that could not stand beside its thing - from the menu's edge nearest the thing to the thing's edge
 * nearest the menu (client px): { x0, y0, x1, y1 } or null when they touch.
 */
export function menuTie(anchor, m) {
  const a = cleanBox(anchor), b = cleanBox(m);
  if ( !a || !b ) return null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const acx = (a.x0 + a.x1) / 2, acy = (a.y0 + a.y1) / 2;
  const px = clamp(acx, b.x0, b.x1), py = clamp(acy, b.y0, b.y1);                 // the menu's point nearest the thing's middle
  const qx = clamp(px, a.x0, a.x1), qy = clamp(py, a.y0, a.y1);                     // the thing's point nearest that
  return Math.hypot(px - qx, py - qy) < 4 ? null : { x0: px, y0: py, x1: qx, y1: qy };
}

/**
 * Where a chip goes along the bottom of a stretch (client px): its middle at the bottom centre `lift` px up from the bottom edge
 * first, then sideways along that edge, then a row higher (twice), then the top centre; the first spot clear of `avoid`, else the
 * one that covers the least of it.
 *   rect { x, y, w, h } the stretch; w x h the chip -> { x, y } (the chip's top left corner)
 */
export function chipSpot(rect, w, h, avoid = null, { lift = 40, pad = 8, step = 48 } = {}) {
  const boxes = (avoid ?? []).map(cleanBox).filter(Boolean);
  const x0 = rect.x + pad, x1 = rect.x + rect.w - pad - w, mid = rect.x + rect.w / 2 - w / 2;
  const clampX = (x) => Math.max(x0, Math.min(Math.max(x0, x1), x));
  const base = rect.y + rect.h - lift, cands = [];
  for ( const row of [0, 1, 2] ) {
    const y = base - row * (h + 10);
    cands.push({ x: clampX(mid), y });
    for ( let k = 1; k * step <= rect.w / 2; k++ ) cands.push({ x: clampX(mid - k * step), y }, { x: clampX(mid + k * step), y });
  }
  cands.push({ x: clampX(mid), y: rect.y + pad });
  let best = cands[0], bestOver = Infinity;
  for ( const c of cands ) {
    const o = sumOver({ x0: c.x, y0: c.y, x1: c.x + w, y1: c.y + h }, boxes);
    if ( o < bestOver - 1e-9 ) { best = c; bestOver = o; if ( o === 0 ) break; }
  }
  return { x: Math.round(best.x), y: Math.round(best.y) };
}

/** Foundry's ways a token is moved (TokenMovementMethod) that are a user's own hand on the map, not a script: a drag, the keys,
 *  the token HUD, the token's sheet. "api" (a macro, another module), "paste" and "undo" are not. */
export const HAND_METHODS = Object.freeze(["dragging", "keyboard", "hud", "config"]);
/** How an update moved a token: Foundry's word for it (null when the update says none: then it was a plain update, a script's). */
export function methodOf(options, id) {
  const m = options?._movement?.[id]?.method ?? options?.movement?.[id]?.method ?? options?.method ?? null;
  return typeof m === "string" && m ? m : null;
}
export const byHandOf = (method) => HAND_METHODS.includes(method);
