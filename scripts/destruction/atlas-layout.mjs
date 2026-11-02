/**
 * The layout of an area's atlas (display.build): its sprites [base, shards, cover?, light?] shelf-packed into one texture. Pure (no
 * Foundry, no PIXI): the codec worker lays out a shell's area with the very same function (chunks.mjs packShellAreas), so the page
 * takes the finished atlas and its layout as they are.
 */
export const PAD = 4;

/** Shelf-pack rectangles (tallest first) with a gutter; returns { W, H, pos }. */
export function pack(rects, square = !!globalThis.CONFIG?.moinenMaps?.squareAtlas) {
  // PERF: the first rect (an area's base, by far the largest) alone at the top, the rest in shelves under it, as wide as the base or a
  // square of their own area: shelves the base's height beside it left ~2/3 of every atlas empty (76 Mpx of atlases for 24 Mpx of
  // bases on the "map" scene, in the JS heap and on the GPU)
  if ( rects.length > 1 && !square ) {
    const b = rects[0], rest = rects.slice(1);
    const area = rest.reduce((a, r) => a + (r.w + PAD) * (r.h + PAD), 0);
    const W = Math.max(b.w + PAD * 2, Math.ceil(Math.sqrt(area * 1.15)), ...rest.map((r) => r.w + PAD * 2));
    const sub = shelves(rest, W, b.h + PAD * 2);
    return { W, H: Math.max(b.h + PAD * 2, sub.H), pos: [{ x: PAD, y: PAD }, ...sub.pos] };
  }
  const area = rects.reduce((a, r) => a + (r.w + PAD) * (r.h + PAD), 0);
  let W = 64; while ( W * W < area * 1.3 && W < 4096 ) W *= 2;
  W = Math.max(W, ...rects.map((r) => r.w + PAD * 2));
  return shelves(rects, W, PAD);
}

/** Shelf-pack rectangles (tallest first) in width W from y0. */
function shelves(rects, W, y0) {
  const order = rects.map((r, i) => i).sort((a, b) => rects[b].h - rects[a].h || rects[b].w - rects[a].w);
  const pos = new Array(rects.length);
  let x = PAD, y = y0, rowH = 0;
  for ( const i of order ) {
    const r = rects[i];
    if ( x + r.w + PAD > W ) { x = PAD; y += rowH + PAD; rowH = 0; }
    pos[i] = { x, y }; x += r.w + PAD; rowH = Math.max(rowH, r.h);
  }
  return { W, H: y + rowH + PAD, pos };
}

