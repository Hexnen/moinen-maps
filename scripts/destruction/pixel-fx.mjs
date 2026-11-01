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
  gr.beginFill(core, alpha); for ( let i = 0; i < cells[0].length; i += 2 ) px(gr, v, cells[0][i], cells[0][i + 1]); gr.endFill();
  gr.beginFill(outer, alpha * 0.85); for ( let i = 0; i < cells[1].length; i += 2 ) px(gr, v, cells[1][i], cells[1][i + 1]); gr.endFill();
}

/** A flash of radius r at t (0..1): a ragged disc in three bands (white core, warm, hot rim), a few rays, shrinking and dropping out. */
export function pxFlash(gr, v, cx, cy, r, t, { colors = [0xfffbe8, 0xffe08a, 0xff9a3c], seed = 1, rays = 6 } = {}) {
  const R = r * (t < 0.25 ? 0.6 + 1.6 * t : 1 - 0.55 * (t - 0.25) / 0.75);
  if ( R < 0.6 ) return;
  const R2 = Math.ceil(R + 2), bands = [[], [], []];
  for ( let y = -R2; y <= R2; y++ ) for ( let x = -R2; x <= R2; x++ ) {
    const a = Math.atan2(y, x), lob = 1 + 0.22 * Math.sin(a * 3 + seed) + 0.12 * Math.sin(a * 7 + seed * 2.1);
    const d = Math.hypot(x, y / 0.8) / (R * lob);
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
  bands.forEach((b, i) => { gr.beginFill(colors[i], 1); for ( let k = 0; k < b.length; k += 2 ) px(gr, v, b[k], b[k + 1]); gr.endFill(); });
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
