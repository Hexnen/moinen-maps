/**
 * Pixel-art accents for the destruction entries (display.mjs, cause-fx.mjs): everything drawn at ART-PIXEL scale, square pixels on
 * the art grid, a few flat colours, fading by pixel dropout rather than by soft alpha. No vector circles, no anti-aliased lines.
 *   pxRing   a shock / ripple ring: a broken ellipse of art pixels (dashed arcs whose gaps open as it spreads), a bright core and a
 *            dimmer outer pixel, dust specks shed behind it
 *   pxFlash  a blast flash: a ragged disc in three hard tone bands with a few short rays, shrinking to a core
 *   pxLine   a line of art pixels (Bresenham), optionally jittered: bolts, slashes, rune strokes
 * Coordinates in art px; `v` = { ap, ox, oy } (art pixel size and the scene origin in canvas px). Deterministic for a seed.
 */
/**
 * Where the accents are drawn: a pooled set of one-pixel sprites with the few calls the drawing code needs (beginFill, drawRect,
 * endFill, clear, destroy), instead of a PIXI.Graphics (sprites batch with the particles, never rebuild geometry, and render where
 * a Graphics in the primary group did not). Each accent owns the sprites it drew this frame; clear() hides them for reuse.
 */
export class PixelCanvas {
  constructor(parent, pool) { this.parent = parent; this.pool = pool; this.sprites = []; this.n = 0; this.c = 0xffffff; this.a = 1; this.destroyed = false; this.blendMode = 0; this.eventMode = "none"; }
  clear() { for ( let i = 0; i < this.n; i++ ) this.sprites[i].visible = false; this.n = 0; return this; }
  beginFill(c, a = 1) { this.c = c; this.a = a; return this; }
  endFill() { return this; }
  drawRect(x, y, w, h) {
    const r = this.clip; if ( r && (x < r.x0 || y < r.y0 || x >= r.x1 || y >= r.y1) ) { if ( this.stats ) this.stats.culledPx = (this.stats.culledPx ?? 0) + 1; return this; }
    let s = this.sprites[this.n];
    if ( !s ) {
      s = this.pool.pop();
      if ( !s || s.destroyed ) { s = new PIXI.Sprite(PIXI.Texture.WHITE); s.eventMode = "none"; this.parent.addChild(s); }
      this.sprites.push(s);
    }
    s.visible = true; s.tint = this.c; s.alpha = this.a; s.blendMode = this.blendMode; s.position.set(x, y); s.width = w; s.height = h;
    this.n++;
    return this;
  }
  destroy() {
    if ( this.destroyed ) return;
    for ( const s of this.sprites ) { if ( s.destroyed ) continue; s.visible = false; s.blendMode = 0; this.pool.push(s); }
    this.sprites = []; this.n = 0; this.destroyed = true;
  }
}

export function hashU(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const px = (gr, v, x, y, w = 1, h = 1) => gr.drawRect(v.ox + x * v.ap, v.oy + y * v.ap, v.ap * w, v.ap * h);
/**
 * PERF: the cells [x, y, x, y ...] as rectangles, neighbours along a row (x + 1, same y, in list order) joined into one rect - the same
 * pixels with a fraction of the shapes Graphics has to build and tessellate each frame. `CONFIG.moinenMaps.noFxMerge`: one rect a cell (A/B).
 */
function pxCells(gr, v, c) {
  if ( globalThis.CONFIG?.moinenMaps?.noFxMerge ) { for ( let k = 0; k < c.length; k += 2 ) px(gr, v, c[k], c[k + 1]); return; }
  for ( let k = 0; k < c.length; ) {
    const x = c[k], y = c[k + 1]; let n = 1;
    while ( k + 2 * n < c.length && c[k + 2 * n + 1] === y && c[k + 2 * n] === x + n ) n++;
    px(gr, v, x, y, n, 1); k += 2 * n;
  }
}

/**
 * A ring of radius r (art px; the y radius is 0.8 r, the oblique camera) at t (0..1 of its life): dashed arcs (about 6-10 of them,
 * their gaps opening with t), each pixel kept while its own hash is above t (dropout), a bright core colour and a dim outer pixel.
 */
export function pxRing(gr, v, cx, cy, r, t, { core = 0xf3e6cc, outer = 0x9c8f7c, seed = 1, dash = 8, thick = 1, alpha = 1 } = {}) {
  if ( r < 1 ) return;
  // never a circle: the radius wanders with the angle (three slow lobes, phases from the seed) and per arc, whole arcs are missing
  // (a partial, torn front, more of it gone as it spreads), the arcs differ in length
  const n = Math.max(12, Math.round(r * 2 * Math.PI * 1.2)), seen = new Set(), gap = 0.3 + 0.45 * t;
  const p1 = hashU(seed, 1, 21) * 6.28, p2 = hashU(seed, 2, 21) * 6.28, p3 = hashU(seed, 3, 21) * 6.28;
  const cells = [[], []];
  for ( let i = 0; i < n; i++ ) {
    const a = (i / n) * Math.PI * 2, arc = (a / (Math.PI * 2)) * dash + hashU(seed, 3, 7) * dash;
    const ai = Math.floor(arc), ph = arc - ai, g = gap * (0.6 + 0.8 * hashU(ai, seed, 11));
    if ( ph < g || hashU(ai, seed, 17) < 0.28 ) continue;
    const lob = 1 + 0.16 * Math.sin(2 * a + p1) + 0.1 * Math.sin(3 * a + p2) + 0.06 * Math.sin(5 * a + p3);
    const wob = (hashU(ai, seed, 13) - 0.5) * (1.2 + r * 0.08) + (ph - 0.5) * (hashU(ai, seed, 19) - 0.5) * r * 0.12;
    for ( let k = 0; k < thick + 1; k++ ) {
      const rr = r * lob + wob + k, x = Math.round(cx + Math.cos(a) * rr), y = Math.round(cy + Math.sin(a) * rr * 0.8), key = (y << 16) ^ x;
      if ( seen.has(key) ) continue; seen.add(key);
      if ( hashU(x, y, seed) < t * 0.9 ) continue;              // dropout as it fades
      cells[k < thick ? 0 : 1].push(x, y);
    }
  }
  gr.beginFill(core, alpha); pxCells(gr, v, cells[0]); gr.endFill();
  gr.beginFill(outer, alpha * 0.85); pxCells(gr, v, cells[1]); gr.endFill();
}

/** A flash of radius r at t (0..1): a ragged disc in three bands (white core, warm, hot rim), a few rays, shrinking and dropping out. */
export function pxFlash(gr, v, cx, cy, r, t, { colors = [0xfffbe8, 0xffe08a, 0xff9a3c], seed = 1, rays = 6 } = {}) {
  const R = r * (t < 0.25 ? 0.6 + 1.6 * t : 1 - 0.55 * (t - 0.25) / 0.75);
  if ( R < 0.6 ) return;
  const R2 = Math.ceil(R + 2), bands = [[], [], []], R2lim = (R * 1.34) * (R * 1.34) + 1e-6;
  for ( let y = -R2; y <= R2; y++ ) for ( let x = -R2; x <= R2; x++ ) {
    const yy = y / 0.8; if ( x * x + yy * yy > R2lim ) continue;   // (the ragged edge reaches 1.34 R at most: nothing farther is in)
    const a = Math.atan2(y, x), lob = 1 + 0.22 * Math.sin(a * 3 + seed) + 0.12 * Math.sin(a * 7 + seed * 2.1);
    const d = Math.hypot(x, yy) / (R * lob);
    if ( d > 1 ) continue;
    const X = Math.round(cx) + x, Y = Math.round(cy) + y;
    if ( hashU(X, Y, seed + 5) < t * t * 0.8 ) continue;
    bands[d < 0.38 ? 0 : d < 0.72 ? 1 : 2].push(X, Y);
  }
  // rays: short pixel lines out of the disc, only early
  if ( t < 0.5 ) for ( let k = 0; k < rays; k++ ) {
    const a = (k / rays) * Math.PI * 2 + hashU(k, seed, 9) * 0.6, L = R * (1.3 + 0.6 * hashU(k, seed, 10)) * (1 - t);
    for ( let s = Math.floor(R * 0.8); s < L; s++ ) bands[s < R * 1.1 ? 1 : 2].push(Math.round(cx + Math.cos(a) * s), Math.round(cy + Math.sin(a) * s * 0.8));
  }
  bands.forEach((b, i) => { gr.beginFill(colors[i], 1); pxCells(gr, v, b); gr.endFill(); });
}

/* ================================================================ pure geometry (node-tested: dev/lightning.test.mjs, dev/pixel-fx.test.mjs) */

/** The art pixels of a Bresenham line (x0, y0) -> (x1, y1), rounded ends, as [x, y] pairs (pushed onto `out`). */
export function lineCells(x0, y0, x1, y1, out = []) {
  let x = Math.round(x0), y = Math.round(y0);
  const X1 = Math.round(x1), Y1 = Math.round(y1), dx = Math.abs(X1 - x), dy = -Math.abs(Y1 - y), sx = x < X1 ? 1 : -1, sy = y < Y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  while ( n++ < 4000 ) {
    out.push([x, y]);
    if ( x === X1 && y === Y1 ) break;
    const e2 = 2 * err;
    if ( e2 >= dy ) { err += dy; x += sx; }
    if ( e2 <= dx ) { err += dx; y += sy; }
  }
  return out;
}

/** A jagged polyline from a to b by midpoint displacement (`it` halvings, displacement `rough` of the length, shrinking by 0.55). */
function jag(ax, ay, bx, by, seed, it = 5, rough = 0.2) {
  let pts = [[ax, ay], [bx, by]];
  const L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L;
  for ( let k = 0, d = L * rough; k < it; k++, d *= 0.55 ) {
    const out = [pts[0]];
    for ( let i = 1; i < pts.length; i++ ) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], o = (hashU(k * 97 + i, pts.length, seed) - 0.5) * 2 * d;
      out.push([(x0 + x1) / 2 + nx * o, (y0 + y1) / 2 + ny * o], pts[i]);
    }
    pts = out;
  }
  return pts;
}

/**
 * A lightning bolt as a tree (deterministic for a seed): one jagged MAIN channel from (x0, y0) to (x1, y1) and `forks` (2-4 by the
 * seed when not given) short side channels leaving the main one between 20 % and 75 % of its length at 30-60 degrees, each 20-42 % of
 * the main length, jagged on their own; one fork may carry a twig. Returns { main, forks: [{ pts, at, depth }], len }.
 */
export function boltTree(seed, x0, y0, x1, y1, { forks = null, rough = 0.2 } = {}) {
  const main = jag(x0, y0, x1, y1, seed, 5, rough), len = Math.hypot(x1 - x0, y1 - y0);
  const nf = forks ?? 2 + Math.floor(hashU(seed, 1, 301) * 3), out = [];
  for ( let f = 0; f < nf; f++ ) {
    const at = 0.2 + 0.55 * ((f + hashU(seed, f, 302)) / nf), k = Math.min(main.length - 2, Math.max(1, Math.round(at * (main.length - 1))));
    // (measured from the channel's overall heading: a fork off a local zig would run back along the main channel)
    const [px, py] = main[k], dir = Math.atan2(y1 - y0, x1 - x0);
    const side = (f & 1 ? 1 : -1) * (hashU(seed, f, 303) < 0.25 ? -1 : 1);
    const ang = dir + side * (Math.PI / 6 + hashU(seed, f, 304) * Math.PI / 6), fl = len * (0.2 + 0.22 * hashU(seed, f, 305));
    const pts = jag(px, py, px + Math.cos(ang) * fl, py + Math.sin(ang) * fl, seed + 17 * (f + 1), 3, 0.18);
    out.push({ pts, at, depth: 1 });
    if ( f === 0 && fl > 8 ) {   // a twig off the first fork
      const m = pts[Math.floor(pts.length * 0.5)], a2 = ang - side * (Math.PI / 5), tl = fl * 0.45;
      out.push({ pts: jag(m[0], m[1], m[0] + Math.cos(a2) * tl, m[1] + Math.sin(a2) * tl, seed + 211, 2, 0.15), at, depth: 2 });
    }
  }
  return { main, forks: out, len };
}

/**
 * The art pixels of a bolt tree: { core: [[x, y, w]], glow: [[x, y]] }, w the channel weight (2 = the main channel's thick root, 1 its
 * thin far part and the forks, 0 a twig's hairline). The main channel is two pixels wide over its first 45 % and tapers to one; the glow
 * is the ring of pixels round the core (never the core itself).
 */
export function boltCells(tree) {
  const core = new Map(), key = (x, y) => (y + 32768) * 65536 + (x + 32768);
  const add = (x, y, w) => { const k = key(x, y), o = core.get(k); if ( !o || o[2] < w ) core.set(k, [x, y, w]); };
  const trace = (pts, wAt) => {
    let L = 0; const seg = [];
    for ( let i = 1; i < pts.length; i++ ) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); L += l; }
    let run = 0;
    for ( let i = 1; i < pts.length; i++ ) {
      const cells = lineCells(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      cells.forEach(([x, y], j) => { const f = (run + seg[i - 1] * (j / Math.max(1, cells.length))) / (L || 1); const w = wAt(f); add(x, y, w); if ( w >= 2 ) add(x + 1, y, 1); });
      run += seg[i - 1];
    }
  };
  trace(tree.main, (f) => (f < 0.45 ? 2 : 1));
  for ( const fk of tree.forks ) trace(fk.pts, () => (fk.depth > 1 ? 0 : 1));
  const glow = new Map();
  for ( const [, [x, y]] of core ) for ( const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) { const k = key(x + a, y + b); if ( !core.has(k) && !glow.has(k) ) glow.set(k, [x + a, y + b]); }
  return { core: [...core.values()], glow: [...glow.values()] };
}

/**
 * Draw a bolt's cells at t (0..1 of its flash): a hard white core over a coloured glow; it flickers (on, a gap, on again) and dies by
 * pixel dropout from the tips (forks and twigs first).
 */
export function pxBolt(gr, v, cells, t, { core = 0xffffff, glow = 0x8fc8ff, seed = 1 } = {}) {
  if ( t > 0.34 && t < 0.44 ) return;                         // the flicker gap
  const fade = t < 0.5 ? 0 : (t - 0.5) / 0.5;
  gr.beginFill(glow, 0.85);
  for ( const [x, y] of cells.glow ) if ( hashU(x, y, seed + 3) >= fade * 1.2 ) px(gr, v, x, y);
  gr.endFill();
  gr.beginFill(core, 1);
  for ( const [x, y, w] of cells.core ) if ( hashU(x, y, seed) >= fade * (w === 2 ? 0.7 : w === 1 ? 1 : 1.4) ) px(gr, v, x, y);
  gr.endFill();
}

/**
 * A flame tongue: the cells of one licking flame `h` art px tall and `w` wide at its base, its tip swaying with `phase`, rising
 * SCREEN-UP from (0, 0) (y negative). Each cell [dx, dy, band]: 0 white-yellow core, 1 yellow, 2 orange, 3 red, 4 the dark tip.
 * One connected shape that narrows upwards (tested): no speckle.
 */
export function tongueCells(h, w, phase, seed = 1) {
  const out = [], H = Math.max(2, Math.round(h));
  let prev = null;
  for ( let j = 0; j < H; j++ ) {
    const f = j / H, sway = Math.sin(f * 2.4 + phase) * f * Math.max(1, w * 0.55) + Math.sin(phase * 1.7 + seed) * f * f * 1.2;
    const hw = Math.max(0.5, (w / 2) * Math.pow(1 - f, 0.85) * (f < 0.18 ? 0.8 + f * 1.1 : 1));
    let x0 = Math.round(sway - hw), x1 = Math.round(sway + hw);
    // connected: each row overlaps the row below it
    if ( prev ) { if ( x0 > prev[1] ) x0 = prev[1]; if ( x1 < prev[0] ) x1 = prev[0]; }
    if ( x1 < x0 ) x1 = x0;
    for ( let x = x0; x <= x1; x++ ) {
      const rel = Math.abs(x - sway) / Math.max(0.6, hw), b = f * 0.95 + rel * 0.45;
      out.push([x, -j, f > 0.86 ? 4 : b < 0.22 ? 0 : b < 0.48 ? 1 : b < 0.76 ? 2 : 3]);
    }
    prev = [x0, x1];
  }
  return out;
}

/** Flame colours, core to tip. */
export const FLAME = [0xfff4c2, 0xffd04a, 0xff8a24, 0xd2401c, 0x3a2420];

/** Draw tongue cells at (bx, by) (art px). */
export function pxTongue(gr, v, bx, by, cells, alpha = 1) {
  for ( let b = 4; b >= 0; b-- ) {
    gr.beginFill(FLAME[b], b === 4 ? alpha * 0.75 : alpha);
    for ( const [x, y, q] of cells ) if ( q === b ) px(gr, v, Math.round(bx) + x, Math.round(by) + y);
    gr.endFill();
  }
}

/**
 * Ripples: 3-5 separate broken ARCS round (cx, cy), each its own radius share, angular span (35-110 degrees), start angle and speed
 * (an arc ahead of the others, one behind), fading by dropout. Never a closed ring. `r` the leading radius at t (0..1).
 */
export function arcCells(cx, cy, r, t, seed = 1) {
  const n = 3 + Math.floor(hashU(seed, 1, 401) * 3), out = [];
  for ( let k = 0; k < n; k++ ) {
    const sp = 0.7 + 0.45 * hashU(seed, k, 402), rr = r * sp * (0.85 + 0.15 * hashU(seed, k, 403));
    if ( rr < 1.5 ) continue;
    const a0 = hashU(seed, k, 404) * Math.PI * 2, span = (30 + (n > 4 ? 25 : 40) * hashU(seed, k, 405)) * Math.PI / 180, steps = Math.max(4, Math.round(rr * span * 1.2));
    const seen = new Set();
    for ( let s = 0; s <= steps; s++ ) {
      const a = a0 + span * s / steps, wob = Math.sin(a * 3 + seed) * rr * 0.06, x = Math.round(cx + Math.cos(a) * (rr + wob)), y = Math.round(cy + Math.sin(a) * (rr + wob) * 0.8);
      const key = y * 65536 + x; if ( seen.has(key) ) continue; seen.add(key);
      // the ends of an arc thin out first; the whole arc drops out as it fades
      const edge = Math.min(s, steps - s) / steps;
      if ( hashU(x, y, seed + k) < t * 0.95 + (edge < 0.12 ? 0.35 : 0) ) continue;
      out.push([x, y, k]);
    }
  }
  return out;
}

/** Draw ripple arcs (a light core). */
export function pxArcs(gr, v, cx, cy, r, t, { core = 0xe6f4ff, alpha = 0.9, seed = 1 } = {}) {
  gr.beginFill(core, alpha);
  for ( const [x, y] of arcCells(cx, cy, r, t, seed) ) px(gr, v, x, y);
  gr.endFill();
}

/**
 * An arcane SIGIL: 2-4 strokes in a unit box (-1..1): curved arcs and angular bends of varied length, with 1-3 short ticks at stroke
 * ends - an inscribed glyph, never a cross. Returns polylines [[x, y], ...] (deterministic for a seed).
 */
export function sigilStrokes(seed) {
  const n = 2 + Math.floor(hashU(seed, 1, 501) * 3), out = [];
  for ( let k = 0; k < n; k++ ) {
    const h = (q) => hashU(seed, k, 510 + q);
    if ( h(0) < 0.55 ) {   // an arc
      const cx = (h(1) - 0.5) * 0.8, cy = (h(2) - 0.5) * 0.8, r = 0.35 + 0.5 * h(3), a0 = h(4) * Math.PI * 2, span = (0.6 + 1.2 * h(5)) * Math.PI, pts = [];
      for ( let s = 0; s <= 8; s++ ) { const a = a0 + span * s / 8; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      out.push(pts);
    } else {               // an angular bend
      const p0 = [(h(1) - 0.5) * 1.8, (h(2) - 0.5) * 1.8], p1 = [(h(3) - 0.5) * 1.2, (h(4) - 0.5) * 1.2], p2 = [(h(5) - 0.5) * 1.8, (h(6) - 0.5) * 1.8];
      out.push(h(7) < 0.5 ? [p0, p1] : [p0, p1, p2]);
    }
  }
  // ticks: short strokes across the ends of some strokes
  const ticks = 1 + Math.floor(hashU(seed, 9, 520) * 3);
  for ( let t = 0; t < ticks; t++ ) {
    const s = out[t % out.length], end = t & 1 ? s[s.length - 1] : s[0], nb = t & 1 ? s[s.length - 2] : s[1];
    const dx = end[0] - nb[0], dy = end[1] - nb[1], l = Math.hypot(dx, dy) || 1, tl = 0.28;
    out.push([[end[0] - dy / l * tl, end[1] + dx / l * tl], [end[0] + dy / l * tl, end[1] - dx / l * tl]]);
  }
  return out;
}

/** The art pixels of a sigil of half-size `s` at (cx, cy): [[x, y]] (unique). */
export function sigilCells(seed, cx, cy, s) {
  const seen = new Map();
  for ( const pl of sigilStrokes(seed) ) for ( let i = 1; i < pl.length; i++ ) for ( const [x, y] of lineCells(cx + pl[i - 1][0] * s, cy + pl[i - 1][1] * s * 0.82, cx + pl[i][0] * s, cy + pl[i][1] * s * 0.82) ) seen.set(y * 65536 + x, [x, y]);
  return [...seen.values()];
}

/** A soft additive flash as per-row runs (few sprites): a ragged disc of radius r at alpha a. */
export function pxRunDisc(gr, v, cx, cy, r, color, a, seed = 1) {
  if ( r < 1 || a <= 0.01 ) return;
  gr.beginFill(color, a);
  const R = Math.ceil(r);
  for ( let y = -R; y <= R; y++ ) {
    const yy = y / 0.8; if ( Math.abs(yy) > r ) continue;
    const hw = Math.sqrt(r * r - yy * yy) * (0.88 + 0.24 * hashU(y, seed, 601));
    const x0 = Math.round(cx - hw), x1 = Math.round(cx + hw);
    if ( x1 >= x0 ) gr.drawRect(v.ox + x0 * v.ap, v.oy + (Math.round(cy) + y) * v.ap, v.ap * (x1 - x0 + 1), v.ap);
  }
  gr.endFill();
}

/** A line of art pixels from (x0, y0) to (x1, y1), in one colour; `drop` drops a share of them (0..1) by their hash. */
export function pxLine(gr, v, x0, y0, x1, y1, color, { alpha = 1, drop = 0, seed = 1 } = {}) {
  let x = Math.round(x0), y = Math.round(y0);
  const X1 = Math.round(x1), Y1 = Math.round(y1), dx = Math.abs(X1 - x), dy = -Math.abs(Y1 - y), sx = x < X1 ? 1 : -1, sy = y < Y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  gr.beginFill(color, alpha);
  while ( n++ < 4000 ) {
    if ( !drop || hashU(x, y, seed) >= drop ) px(gr, v, x, y);
    if ( x === X1 && y === Y1 ) break;
    const e2 = 2 * err;
    if ( e2 >= dy ) { err += dy; x += sx; }
    if ( e2 <= dx ) { err += dx; y += sy; }
  }
  gr.endFill();
}
