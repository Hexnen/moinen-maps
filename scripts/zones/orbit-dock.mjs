/**
 * fxm2 (U201, FF6): where the GM's orbit strip stands WHILE A FIGHT RUNS on the map (pure: boxes in, a spot out; node-tested in
 * dev/orbit-dock.test.mjs). In a fight the strip folds to one small button (the globe and how many are up there) that sits in the
 * initiative bar's own row - beside the bar, never over the map below it, where the turn camera frames the fight and the GM clicks
 * tokens (FF6: twice a click meant for a token hit the strip and took the GM to the Orbit scene mid-fight).
 *
 * fightSpot(bar, size, avoid, W, H) -> { x, y, where } (client px, the button's top-left corner)
 *   bar    the initiative bar as drawn (the union of its parts) { x0, y0, x1, y1 }, or null when none shows
 *   size   the button { w, h }
 *   avoid  boxes that must stay clear (the sidebar, the scene controls and navigation, the panels other modules declared)
 * The spots tried, in order: right of the bar in its row; left of it; under its right end, tucked to the bar; with no bar, the top
 * right corner of the free top row (left of the sidebar). A spot must lie inside the window and touch no avoid box; when none is
 * clear, the first one (right of the bar) is used, as the least in the way.
 */
const GAP = 8;
const meets = (a, b) => !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);
const okBox = (b) => !!b && [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) && b.x1 > b.x0 && b.y1 > b.y0;

export function fightSpot(bar, size, avoid = [], W = 1600, H = 900) {
  const w = Math.max(1, size?.w || 48), h = Math.max(1, size?.h || 30);
  const boxes = (Array.isArray(avoid) ? avoid : []).filter(okBox);
  const cands = [];
  if ( okBox(bar) ) {
    // (level with the top of the bar: the row under its right end is often where a side panel starts)
    const cy = Math.max(GAP, Math.round(bar.y0 + 6));
    cands.push({ x: Math.round(bar.x1 + GAP), y: cy, where: "right" });
    cands.push({ x: Math.round(bar.x0 - GAP - w), y: cy, where: "left" });
    cands.push({ x: Math.round(bar.x1 - w), y: Math.round(bar.y1 + GAP / 2), where: "under" });
  } else {
    const side = boxes.filter((b) => b.x0 > W * 0.6 && b.y0 < H * 0.5).reduce((m, b) => Math.min(m, b.x0), W);
    cands.push({ x: Math.round(side - GAP - w), y: 16, where: "corner" });
  }
  const clear = (c) => {
    const b = { x0: c.x, y0: c.y, x1: c.x + w, y1: c.y + h };
    return b.x0 >= 0 && b.y0 >= 0 && b.x1 <= W && b.y1 <= H && !boxes.some((a) => meets(a, b));
  };
  return cands.find(clear) ?? cands[0];
}

/**
 * fxn2 (U210, FF7): where the folded button's list opens (pure; client px, the list's top-left corner). Under the button, its right
 * edge level with the button's, when that is clear; else the nearest clear spot to that one (touching no avoid box and not the bar):
 * slid left or right just past what is in the way, lowered under the bar when it would lie on it. FF7: the list lay over the
 * challenges card at the right end of the bar's row.
 * listSpot(head, size, avoid, bar, W, H) -> { x, y, where: "under" | "slid" | "fallback" }
 *   head  the button { x0, y0, x1, y1 };  size  the list { w, h };  avoid  as fightSpot;  bar  the initiative bar box or null
 */
export function listSpot(head, size, avoid = [], bar = null, W = 1600, H = 900) {
  const w = Math.max(1, size?.w || 176), h = Math.max(1, size?.h || 80);
  const boxes = (Array.isArray(avoid) ? avoid : []).filter(okBox);
  const blocks = okBox(bar) ? [...boxes, bar] : boxes;
  const x0 = Math.round(head.x1 - w), y0 = Math.round(head.y1 + GAP / 2 + 2);
  const xs = [x0, Math.round(head.x0)];
  for ( const b of blocks ) xs.push(Math.round(b.x0 - GAP - w), Math.round(b.x1 + GAP));
  const ys = [y0];
  for ( const b of blocks ) if ( b.y1 + GAP / 2 > y0 ) ys.push(Math.round(b.y1 + GAP / 2));
  const clear = (x, y) => {
    const b = { x0: x, y0: y, x1: x + w, y1: y + h };
    return b.x0 >= 0 && b.y0 >= 0 && b.x1 <= W && b.y1 <= H && !blocks.some((a) => meets(a, b));
  };
  let best = null;
  for ( const y of ys ) for ( const x of xs ) {
    if ( !clear(x, y) ) continue;
    const d = Math.abs(x - x0) + 2 * Math.abs(y - y0);   // (going down costs more than sideways: the list stays by the button's row)
    if ( !best || d < best.d ) best = { x, y, d };
  }
  if ( !best ) return { x: x0, y: y0, where: "fallback" };
  return { x: best.x, y: best.y, where: best.x === x0 && best.y === y0 ? "under" : "slid" };
}
