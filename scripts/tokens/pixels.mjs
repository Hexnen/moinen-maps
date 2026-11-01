/**
 * Pixel particles for the token effects, in the art-pixel language of scripts/destruction/pixel-fx.mjs: square one-pixel sprites on
 * the art grid (32 art px per grid square), a few flat colours, fading by pixel DROPOUT (a particle vanishes on its own hashed moment)
 * rather than by soft alpha.
 *
 * Everything is pooled: the sprites (one global pool, reparented into the effect that uses them) and the particle records (one global
 * free list), so a running effect allocates nothing per frame. The total of live particles is capped per performance mode.
 */
import { hashU } from "../destruction/pixel-fx.mjs";
import { perfMode } from "../perf-mode.mjs";

const SPRITES = [];          // free sprites (no parent)
const RECORDS = [];          // free particle records
let live = 0;
export const particleCap = () => ({ high: 1400, medium: 700, low: 240 })[perfMode()] ?? 1400;
export const liveParticles = () => live;

/** The art pixel in canvas px (32 per grid square, never below 2). */
export const artPx = () => Math.max(2, Math.round((globalThis.canvas?.grid?.size ?? 100) / 32));

function takeSprite() {
  let s = SPRITES.pop();
  if ( !s || s.destroyed ) { s = new PIXI.Sprite(PIXI.Texture.WHITE); s.eventMode = "none"; s.roundPixels = true; }
  s.visible = true; s.alpha = 1; s.blendMode = 0; s.rotation = 0;
  return s;
}
function giveSprite(s) {
  if ( !s || s.destroyed ) return;
  s.parent?.removeChild(s); s.visible = false; SPRITES.push(s);
}

/** Free every pooled sprite (canvas teardown: the sprites belonged to the old renderer's scene graph). */
export function drainPools() {
  for ( const s of SPRITES ) if ( !s.destroyed ) s.destroy();
  SPRITES.length = 0;
  live = 0;
}

/**
 * The particles of one effect, drawn into its own container (`root`). Coordinates in canvas px; sizes in art px.
 * add() returns false when the global cap is reached (the effect simply has fewer particles).
 */
export class Emitter {
  constructor(root, ap = artPx()) { this.root = root; this.ap = ap; this.ps = []; this.seed = 1; }

  add(x, y, vx, vy, o = {}) {
    if ( live >= particleCap() ) return false;
    const p = RECORDS.pop() ?? {};
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.g = o.g ?? 0; p.drag = o.drag ?? 0; p.life = o.life ?? 0.6; p.age = -(o.delay ?? 0);
    p.color = o.color ?? 0xffffff; p.size = o.size ?? 1; p.drop = o.drop ?? true; p.alpha = o.alpha ?? 1;
    p.ground = o.ground ?? null; p.add = !!o.add; p.id = this.ps.length + 1 + (this.seed * 131);
    p.shrink = o.shrink ?? false; p.s = null;
    // motion: 0 ballistic, 1 seek (x, y) -> (tx, ty) in tt s with an ease-out, then rest; 2 orbit round (cx, cy)
    p.mode = o.mode ?? 0;
    if ( p.mode === 1 ) { p.x0 = x; p.y0 = y; p.tx = o.tx; p.ty = o.ty; p.tt = Math.max(0.01, o.tt ?? 0.5); }
    if ( p.mode === 2 ) { p.cx = o.cx; p.cy = o.cy; p.r = o.r; p.dr = o.dr ?? 0; p.ang = o.ang ?? 0; p.av = o.av ?? 4; p.flat = o.flat ?? 0.5; }
    this.ps.push(p); live++;
    return true;
  }

  /** Advance and draw. Returns the number still alive. */
  update(dt) {
    const ap = this.ap, ps = this.ps;
    let w = 0;
    for ( let i = 0; i < ps.length; i++ ) {
      const p = ps[i];
      p.age += dt;
      if ( p.age >= p.life ) { this.#free(p); continue; }
      ps[w++] = p;
      if ( p.age < 0 ) { if ( p.s ) p.s.visible = false; continue; }
      if ( p.mode === 1 ) {
        const k = Math.min(1, p.age / p.tt), e = 1 - (1 - k) ** 3;
        p.x = p.x0 + (p.tx - p.x0) * e; p.y = p.y0 + (p.ty - p.y0) * e;
      } else if ( p.mode === 2 ) {
        p.ang += p.av * dt; p.r = Math.max(0, p.r + p.dr * dt);
        p.x = p.cx + Math.cos(p.ang) * p.r; p.y = p.cy + Math.sin(p.ang) * p.r * p.flat;
      } else {
        const d = p.drag ? Math.max(0, 1 - p.drag * dt) : 1;
        p.vx *= d; p.vy = p.vy * d + p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if ( p.ground !== null && p.y > p.ground ) { p.y = p.ground; p.vy *= -0.25; p.vx *= 0.6; }
      }
      const u = p.age / p.life;
      // dropout: each particle has its own moment to vanish in the last part of its life
      const gone = p.drop && hashU(p.id, 7, this.seed) < (u - 0.35) / 0.65;
      if ( gone ) { if ( p.s ) p.s.visible = false; continue; }
      if ( !p.s ) { p.s = takeSprite(); this.root.addChild(p.s); }
      const s = p.s, size = p.shrink ? Math.max(1, Math.round(p.size * (1 - u))) : p.size;
      s.visible = true; s.tint = p.color; s.alpha = p.alpha; s.blendMode = p.add ? PIXI.BLEND_MODES.ADD : 0;
      // snapped to the art grid: square pixels, no sub-pixel shimmer
      s.position.set(Math.round(p.x / ap) * ap, Math.round(p.y / ap) * ap);
      s.width = s.height = ap * size;
    }
    ps.length = w;
    return w;
  }

  #free(p) { if ( p.s ) { giveSprite(p.s); p.s = null; } live--; RECORDS.push(p); }

  clear() { for ( const p of this.ps ) this.#free(p); this.ps.length = 0; }
}

/* ================================================================== the token's own pixels */

const CELLS = new WeakMap();   // baseTexture -> Map(key -> cells)

/**
 * The token's image as a grid of art cells: { cols, rows, color: Int32Array (0xRRGGBB, -1 = transparent) }, sampled once per texture
 * and size (rendered small and read back). Null when the texture cannot be read (not loaded, a cross-origin video...).
 */
export function cellsOf(texture, cols, rows) {
  try {
    if ( !texture?.valid || !canvas?.app?.renderer ) return null;
    const base = texture.baseTexture, key = `${texture.frame.x},${texture.frame.y},${texture.frame.width},${texture.frame.height}|${cols}x${rows}`;
    let m = CELLS.get(base); if ( !m ) CELLS.set(base, m = new Map());
    if ( m.has(key) ) return m.get(key);
    const rt = PIXI.RenderTexture.create({ width: cols, height: rows });
    const spr = new PIXI.Sprite(texture); spr.width = cols; spr.height = rows;
    canvas.app.renderer.render(spr, { renderTexture: rt, clear: true });
    const px = canvas.app.renderer.extract.pixels(rt);
    spr.destroy(); rt.destroy(true);
    const color = new Int32Array(cols * rows);
    for ( let i = 0; i < cols * rows; i++ ) {
      const a = px[i * 4 + 3];
      if ( a < 110 ) { color[i] = -1; continue; }
      const k = 255 / a;   // premultiplied -> straight
      color[i] = (Math.min(255, Math.round(px[i * 4] * k)) << 16) | (Math.min(255, Math.round(px[i * 4 + 1] * k)) << 8) | Math.min(255, Math.round(px[i * 4 + 2] * k));
    }
    const out = { cols, rows, color };
    m.set(key, out);
    return out;
  } catch ( err ) { return null; }
}

/** A few representative colours of a token (for confetti / embers), most saturated first. */
export function paletteOf(cells, n = 5) {
  if ( !cells ) return [0xf3e6cc, 0xffd04a, 0xff8a24, 0x9c8f7c];
  const seen = new Map();
  for ( const c of cells.color ) {
    if ( c < 0 ) continue;
    const q = c & 0xe0e0e0; seen.set(q, (seen.get(q) ?? 0) + 1);
  }
  const sat = (c) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return Math.max(r, g, b) - Math.min(r, g, b); };
  const list = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c | 0x101010).sort((a, b) => sat(b) - sat(a));
  return list.length ? list.slice(0, n) : [0xf3e6cc];
}

/** Grey of a colour (for ash). */
export function greyOf(c, k = 0.7) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, l = Math.round((0.3 * r + 0.59 * g + 0.11 * b) * k);
  return (l << 16) | (l << 8) | l;
}
