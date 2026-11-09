/**
 * The PATTERN of a zone's hover highlight (look.hoverFx dots / petals), drawn into the 2D context of the highlight's canvas
 * (display.mjs #edgePattern, which then keeps it only along the border and in the corners).
 *
 * BOUNDED WORK, whatever the zone's size (street hang, 2026-11-09): the dots used to be one path with an arc per dot over the zone's whole
 * bounding box - a zone the size of the map (4320 x 7680 px, grid 100) is 320 x 180 = 57,600 arcs per tone, filled as ONE path. In the
 * Foundry desktop app (Electron 146) that fill froze the main thread for 35-40 s on the first hover, and the first hover comes right
 * after a scene loads (Foundry replays the last pointer position), so entering the scene "hung at 100 %". Now:
 *  - dots: ONE period of the staggered grid (gap wide, 2 gaps high) is drawn on a small tile and the box is filled with it as a pattern
 *    (placed in map units by the pattern's own transform, so the dots sit exactly where the per-dot loop put them): a constant number of
 *    draw calls for any zone;
 *  - petals (random per cell): drawn cell by cell up to PETAL_CELLS cells, beyond that a tile of PETAL_TILE x PETAL_TILE cells (the
 *    same petals as the zone's first cells) repeats - the work stops growing with the zone.
 * `ops(fx, box, u)` is the number of shapes the old loops drew (the node test checks the bound against it).
 */

export const PETAL_CELLS = 2500;
export const PETAL_TILE = 24;

const css = (n, a) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
const defaultCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

/** How many shapes (dots per tone, petal cells) the per-cell loops visit for this box: rows x columns of the staggered grid. */
export function cells([x0, y0, x1, y1], gap) {
  if ( !(gap > 0) || !(x1 >= x0) || !(y1 >= y0) ) return 0;
  const rows = Math.floor((y1 - y0) / gap) + 1;
  let n = 0;
  for ( const odd of [0, 1] ) {
    const r = Math.floor((rows + 1 - odd) / 2), start = odd ? gap / 2 : 0;
    n += r * (x1 - x0 >= start ? Math.floor((x1 - x0 - start) / gap) + 1 : 0);
  }
  return n;
}

/** The dots' geometry: gap and the two radii (dark under-dot, light dot), in map units. */
export const dotsGeom = (u) => ({ gap: 12 * u, r: 1.7 * u, rDark: 1.7 * u + 1.1 * u });

/**
 * The tile of the dots: one period of the staggered grid, `gap` x `2 gap` map units, rendered at `T` x `2T` pixels. Dots at the
 * corners (wrapped, so the four quarter-dots make whole ones when the tile repeats) and in the middle (the odd row, half a gap in).
 * Returns { tile, T, scale } with scale = map units per tile pixel.
 */
export function dotsTile(u, k, light, mkCanvas = defaultCanvas) {
  const { gap, r, rDark } = dotsGeom(u);
  // about two tile pixels per canvas pixel (the pattern is then drawn slightly minified: smooth dots, no blur), at least 8
  const T = Math.max(8, Math.min(512, Math.round(gap * k * 2))), s = T / gap;
  const tile = mkCanvas(T, 2 * T), t = tile.getContext("2d");
  const centres = [[0, 0], [T, 0], [0, 2 * T], [T, 2 * T], [T / 2, T]];
  const tone = (rad, fill) => {
    t.fillStyle = fill; t.beginPath();
    for ( const [x, y] of centres ) { t.moveTo(x + rad * s, y); t.arc(x, y, rad * s, 0, 2 * Math.PI); }
    t.fill();
  };
  tone(rDark, css(0x15110f, 0.42));
  tone(r, css(light, 0.9));
  return { tile, T, scale: gap / T };
}

/**
 * Fill the box [x0, y0, x1, y1] (map units; `c` already transformed map -> canvas) with the dots pattern: the dot of row 0 / column 0
 * at (x0, y0), rows `gap` apart, odd rows shifted by half a gap - the grid of the old per-dot loop.
 */
export function drawDots(c, box, u, k, light, mkCanvas = defaultCanvas) {
  const [x0, y0, x1, y1] = box;
  const { gap, rDark } = dotsGeom(u);
  const { tile, scale } = dotsTile(u, k, light, mkCanvas);
  const pat = c.createPattern(tile, "repeat");
  if ( !pat ) return 0;
  // pattern space = map units (the context's transform applies on top): tile pixel (0, 0) is the dot at (x0, y0)
  pat.setTransform?.(new DOMMatrix([scale, 0, 0, scale, x0, y0]));
  c.fillStyle = pat;
  // (the last row/column of dots reaches past the box by up to a radius)
  c.fillRect(x0 - rDark, y0 - rDark, x1 - x0 + 2 * rDark + gap, y1 - y0 + 2 * rDark + gap);
  return 1;
}

/** The petal of the grid cell (x, y) - the old loop's hash, jitter, size and turn - or null (about a third of the cells have none). */
function petalAt(x, y, gap, u) {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453, r1 = h - Math.floor(h), r2 = (h * 7.13) - Math.floor(h * 7.13);
  if ( r1 < 0.35 ) return null;
  return { px: x + (r2 - 0.5) * gap * 0.8, py: y + (r1 - 0.5) * gap * 0.8, sz: (3 + 2.5 * r2) * u, r1, r2 };
}

/** Draw one petal (notched cherry petal, one of two pinks) at its spot moved by (ox, oy). */
function drawPetal(c, p, u, ox = 0, oy = 0) {
  const { sz, r1, r2 } = p;
  c.save(); c.translate(p.px + ox, p.py + oy); c.rotate(r1 * 6.28);
  c.beginPath(); c.moveTo(0, sz); c.bezierCurveTo(sz * 0.9, sz * 0.4, sz * 0.7, -sz * 0.8, sz * 0.15, -sz); c.lineTo(0, -sz * 0.75); c.lineTo(-sz * 0.15, -sz);
  c.bezierCurveTo(-sz * 0.7, -sz * 0.8, -sz * 0.9, sz * 0.4, 0, sz); c.closePath();
  c.fillStyle = r2 > 0.5 ? "rgba(255,228,238,0.95)" : "rgba(247,168,196,0.95)"; c.fill();
  c.strokeStyle = "rgba(205,90,135,0.7)"; c.lineWidth = 0.6 * u; c.stroke();
  c.restore();
}

/**
 * Petals over the box: cell by cell (the old petals exactly) while the box holds at most PETAL_CELLS cells; beyond that the petals of
 * the box's first PETAL_TILE x PETAL_TILE cells on a tile that repeats (a petal crossing the tile's edge is drawn on the other side
 * too). Returns the number of petals drawn.
 */
export function drawPetals(c, box, u, k, mkCanvas = defaultCanvas) {
  const [x0, y0, x1, y1] = box, gap = 16 * u;
  const each = (X0, Y0, X1, Y1, fn) => { for ( let y = Y0, row = 0; y <= Y1; y += gap, row++ ) for ( let x = X0 + (row % 2 ? gap / 2 : 0); x <= X1; x += gap ) { const p = petalAt(x, y, gap, u); if ( p ) fn(p); } };
  let n = 0;
  if ( cells(box, gap) <= PETAL_CELLS ) { each(x0, y0, x1, y1, (p) => { drawPetal(c, p, u); n++; }); return n; }
  // the tile: PETAL_TILE x PETAL_TILE cells (an even number of rows keeps the stagger), about two tile pixels per canvas pixel
  const P = PETAL_TILE, span = P * gap, T = Math.max(16, Math.min(2048, Math.round(span * Math.max(k, 0.25) * 2))), s = T / span;
  const tile = mkCanvas(T, T), t = tile.getContext("2d");
  t.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
  const ext = 0.8 * gap;                                            // a petal's reach from its cell (jitter 0.4 gap + size <= 0.35 gap)
  each(x0, y0, x0 + span - 1e-6, y0 + span - 1e-6, (p) => {
    const lx = p.px - x0, ly = p.py - y0;
    const xs = [0, ...(lx < ext ? [span] : []), ...(lx > span - ext ? [-span] : [])], ys = [0, ...(ly < ext ? [span] : []), ...(ly > span - ext ? [-span] : [])];
    for ( const oy of ys ) for ( const ox of xs ) { drawPetal(t, p, u, ox, oy); n++; }
  });
  const pat = c.createPattern(tile, "repeat");
  if ( !pat ) return n;
  pat.setTransform?.(new DOMMatrix([1 / s, 0, 0, 1 / s, x0, y0]));
  c.fillStyle = pat;
  c.fillRect(x0 - gap, y0 - gap, x1 - x0 + 2 * gap, y1 - y0 + 2 * gap);
  return n;
}
