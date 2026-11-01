import { META_FIELDS } from "./core.mjs";
import { reducedMotion } from "../config.mjs";
import { tearClock, tearPiece, tearPlace, tearFx, tearEdge } from "./tear-entry.mjs";
import * as Cause from "./cause-fx.mjs";
import { pxRing, pxFlash, PixelCanvas } from "./pixel-fx.mjs";
import { StaticCache, mipmaps } from "./static-cache.mjs";
import { MaskedPatch } from "./masked-map.mjs";

/** The plain map under a mask: one shader quad (masked-map.mjs); `CONFIG.moinenMaps.spriteMasks = true`: PIXI's sprite mask (A/B). */
function maskedMap(ms, mask) {
  if ( !globalThis.CONFIG?.moinenMaps?.spriteMasks ) return new MaskedPatch(ms, mask);
  const c = new PIXI.Container(); c.eventMode = "none";
  c.addChild(ms, mask); ms.mask = mask;
  return c;
}

/**
 * Shows a bake, AREA BY AREA: every damaged area is a group (its own small texture atlas, a base sprite with what lies beneath, and
 * its shards) identified by the area's hash. A new bake only adds the groups whose hash is new and removes the ones that are gone;
 * an area that did not change keeps its sprites and its texture (no re-upload, no flash, no replay). Layers in the primary group,
 * between the map and the tiles/tokens: damage 247, shards 248, dust and embers 249.
 *
 * Textures are mipmapped; up close they are sampled NEAREST (crisp pixel art), zoomed out LINEAR + mipmaps (no shimmer while
 * zooming); every frame of an area's atlas has a transparent gutter so mip levels do not bleed between frames.
 *
 * ENTRY: a new area does not just pop in. Its ruin is revealed by a front running from the impact (a growing reveal mask, or a
 * wipe along the stroke for gashes and directional strokes) while its pieces tear loose as the front reaches them, with a
 * type-specific look (blast: flash, shock ring, thrown debris and dust; collapse: tremor, plates drop from the rim inwards, dust from
 * the pit; burn: a fire front with embers and smoke, curling plates; flood: plates sink, water rings; cracks: a fast fracture with
 * hopping plates; gash: a claw swipe with sparks). Cosmetic, timed from a start time the caller gives (shared server time).
 * Reduced motion: a short fade.
 */
const TYPES = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];
const PAD = 4;
const NEAREST = 0, LINEAR = 1;

function layer(sortLayer) {
  const c = new PIXI.Container();
  c.eventMode = "none";
  Object.assign(c, { elevation: 0, sortLayer, sort: 0, _lastSortedIndex: 0 });
  canvas.primary.addChild(c);
  return c;
}

const easeOut = (t) => 1 - (1 - t) ** 3;
/** Deterministic hash (0..1) and smooth value noise, for the entry's per-pixel and per-piece timing. */
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/**
 * vnoise(X / scale, Y / scale, s) over a known box, the same numbers (same lattice hashes, same arithmetic) from a precomputed grid of
 * the lattice hashes: an entry evaluates it for every pixel of its ruin, and the hashes were most of that cost (PERF). Outside the box:
 * vnoise itself.
 */
function latticeNoise(x0, y0, x1, y1, scale, s) {
  const gx0 = Math.floor(x0 / scale) - 1, gy0 = Math.floor(y0 / scale) - 1;
  const GW = Math.floor(x1 / scale) - gx0 + 3, GH = Math.floor(y1 / scale) - gy0 + 3;
  if ( !(GW > 0 && GH > 0) || GW * GH > 4e6 ) return (X, Y) => vnoise(X / scale, Y / scale, s);
  const G = new Float64Array(GW * GH);
  for ( let j = 0; j < GH; j++ ) for ( let i = 0; i < GW; i++ ) G[j * GW + i] = hash2(gx0 + i, gy0 + j, s);
  return (X, Y) => {
    const x = X / scale, y = Y / scale, xi = Math.floor(x), yi = Math.floor(y), i = xi - gx0, j = yi - gy0;
    if ( i < 0 || j < 0 || i + 1 >= GW || j + 1 >= GH ) return vnoise(x, y, s);
    const fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), q = j * GW + i;
    const a = G[q], b = G[q + 1], c = G[q + GW], d = G[q + GW + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
const easeIn = (t) => t * t;
const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
const lerpColor = (a, b, t) => {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t), g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t), bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

/** Per type: reveal delay and duration (ms at speed 1), how the front runs, piece motion. */
const LOOK = {
  blast:    { delay: 70,  reveal: 420, flight: 1,    arc: 1,    order: "out" },
  collapse: { delay: 200, reveal: 560, flight: 1.1,  arc: 0.35, order: "in" },
  scorch:   { delay: 0,   reveal: 950, flight: 1.3,  arc: 0.5,  order: "out" },
  flood:    { delay: 120, reveal: 680, flight: 1.4,  arc: 0.3,  order: "out" },
  cracks:   { delay: 0,   reveal: 430, flight: 0.8,  arc: 0.6,  order: "out" },
  gash:     { delay: 40,  reveal: 460, flight: 0.9,  arc: 0.7,  order: "wipe" }
};

/**
 * The front's signature per kind: the stages a ruin pixel passes through as the front reaches it (ms after its own moment, at entry
 * speed 1), each a colour from its final colour (r, g, b, pixel index) -> 0xRRGGBB; the last stage (no colour) is the final pixel.
 * Few flat colours, hard steps (pixel art): a burning edge flares and cools to char, water arrives as a foam line, a cave-in
 * darkens as it sinks, a blast scorches pale-hot, a fracture flashes its dust. Tears have their own clock (tear-entry.mjs).
 */
const mixP = (r, g, b, c, t) => (Math.round(r + (((c >> 16) & 255) - r) * t) << 16) | (Math.round(g + (((c >> 8) & 255) - g) * t) << 8) | Math.round(b + ((c & 255) - b) * t);
const FRONT = {
  scorch:   [{ dt: 0, col: (r, g, b, i) => (hash2(i, 1, 5) < 0.5 ? 0xffeca0 : 0xffc85a) }, { dt: 70, col: (r, g, b) => mixP(r, g, b, 0xff7a24, 0.78) },
             { dt: 170, col: (r, g, b) => mixP(r, g, b, 0x9a3214, 0.6) }, { dt: 300 }],
  flood:    [{ dt: 0, col: (r, g, b, i) => (hash2(i, 2, 5) < 0.6 ? 0xf2f8ff : 0xcfe6fa) }, { dt: 70, col: (r, g, b) => mixP(r, g, b, 0x8cc0ea, 0.6) }, { dt: 210 }],
  collapse: [{ dt: 0, col: (r, g, b) => mixP(r, g, b, 0x15110e, 0.72) }, { dt: 120, col: (r, g, b) => mixP(r, g, b, 0x15110e, 0.4) }, { dt: 240 }],
  blast:    [{ dt: 0, col: (r, g, b, i) => (hash2(i, 3, 5) < 0.5 ? 0xfff4d6 : 0xffd890) }, { dt: 50, col: (r, g, b) => mixP(r, g, b, 0xff9a48, 0.55) }, { dt: 140 }],
  cracks:   [{ dt: 0, col: (r, g, b) => mixP(r, g, b, 0xf4ecdc, 0.45) }, { dt: 90 }]
};

/** Particle sprites in art pixels (white, tinted per particle): one texture each, made once. */
function makeShapes() {
  const make = (rows) => {
    const h = rows.length, w = rows[0].length, a = new Uint8Array(w * h * 4);
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if ( ch === "." ) return; const v = ch === "#" ? 255 : 170, q = (y * w + x) * 4; a[q] = a[q + 1] = a[q + 2] = v; a[q + 3] = 255; }));
    const t = PIXI.Texture.fromBuffer(a, w, h); t.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST; t.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    return t;
  };
  return { dot: make(["#"]), bar: make(["##"]), sq: make(["##", "#+"]), diag: make(["#.", "+#"]), crumb: make([".#", "##"]),
    plus: make([".#.", "###", ".+."]), chunk: make(["##.", "###", ".++"]), puff: make([".##.", "####", "+##+", ".++."]) };
}

/** Shelf-pack rectangles (tallest first) with a gutter; returns { W, H, pos }. */
function pack(rects) {
  // PERF: the first rect (an area's base, by far the largest) alone at the top, the rest in shelves under it, as wide as the base or a
  // square of their own area: shelves the base's height beside it left ~2/3 of every atlas empty (76 Mpx of atlases for 24 Mpx of
  // bases on the "map" scene, in the JS heap and on the GPU)
  if ( rects.length > 1 && !globalThis.CONFIG?.moinenMaps?.squareAtlas ) {
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

export class DestructionDisplay {
  constructor() {
    // one layer of damage objects in creation order: each object is a container [map patch, base, shards], so a later stroke covers
    // an earlier one (its patch lays the plain map over the older damage where the new stroke lies, then draws itself)
    this.objs = layer(247);
    // the objects themselves live in `live`; what does not move is shown from a cache under it (static-cache.mjs, PERF)
    this.live = this.objs.addChild(new PIXI.Container());
    this.live.eventMode = "none";
    this.fx = layer(249);
    this.erasers = new Map();      // object id -> eraser group (a patch of plain map, no bake)
    this.groups = new Map();       // hash -> group
    this.spare = new Map();        // hash -> group no longer shown, kept for a quick return (stash)
    this.order = [];               // groups in sheet order
    this.dying = [];               // groups fading out
    this.particles = [];           // live particles
    this.pool = [];                // spare particle sprites
    this.idle = { on: true, who: "all" };
    this.clocks = [];              // per-pixel entry clocks still to build (clockSlice)
    this.spritePool = [];          // shard sprites given back by areas flattened again (materialize takes them first)
    this.look = { entry: true, speed: 1, power: 1 };
    this.filter = NEAREST;
    this.stats = { frameMs: 0, sprites: 0, groups: 0, uploads: 0, entries: 0 };
    this.ap = 1; this.origin = { x: 0, y: 0 };
    this._tick = () => this.tick();
    canvas.app.ticker.add(this._tick);
    this.cache = new StaticCache(this);
  }

  /** Every area shown, in order: { type, mat, hash, ... }. */
  get areas() { return this.order.map((g) => g.info); }

  /* ---------------------------------------------------------------- bakes in */

  /**
   * Show a bake: `rgba` (the sheet, w x h), `meta` (placement table), art pixel size and the scene origin. Keeps the groups whose hash
   * is still there; returns { added: [group], removed: [group] }.
   */
  sync(rgba, w, h, meta, ap, origin, objects = []) {
    this.ap = ap; this.origin = origin;
    const F = META_FIELDS, n = meta.length / F;
    const rows = [];
    let cur = null;
    for ( let k = 0; k < n; k++ ) {
      const o = k * F;
      if ( meta[o] === 0 ) { cur = { hash: ((meta[o + 12] & 0xffff) | ((meta[o + 13] & 0xffff) << 16)) >>> 0, base: o, cover: -1, pieces: [], index: meta[o + 16] }; rows.push(cur); }
      else if ( meta[o] === 2 ) { if ( cur ) cur.cover = o; }
      else if ( meta[o] === 3 ) { if ( cur ) cur.light = o; }   // the cause's light (cause-fx.mjs)
      else cur?.pieces.push(o);
    }
    const next = [], added = [], seen = new Set();
    for ( const r of rows ) {
      if ( seen.has(r.hash) ) continue;
      seen.add(r.hash);
      let g = this.groups.get(r.hash);
      if ( !g && this.spare.has(r.hash) ) {
        // shown before (a toggle switched back, an undo): the same sprites and texture, no rebuild, no upload
        g = this.spare.get(r.hash); this.spare.delete(r.hash);
        g.tex.scaleMode = this.filter; g.reused = true;
        this.groups.set(r.hash, g); added.push(g);
      } else if ( !g ) {
        const i = this.dying.findIndex((q) => q.hash === r.hash);
        if ( i >= 0 ) { g = this.dying[i]; this.dying.splice(i, 1); g.heldBy = null; g.cont.alpha = 1; for ( const p of g.pieces ) if ( p.spr ) p.spr.visible = true; g.reused = true; }
        else { g = this.build(r, rgba, w, meta); g.reused = false; }
        this.groups.set(r.hash, g); added.push(g);
      }
      g.objIndex = r.index; g.objId = objects[r.index]?.id ?? null;
      next.push(g);
    }
    const removed = [];
    for ( const [hash, g] of this.groups ) if ( !seen.has(hash) ) { this.groups.delete(hash); removed.push(g); }
    for ( const g of removed ) this.retire(g);
    // erase strokes: plain map laid over everything painted before them (no bake)
    const keepErase = new Set();
    objects.forEach((o, index) => {
      if ( !o.k ) return;
      keepErase.add(o.id);
      let e = this.erasers.get(o.id);
      if ( !e ) {
        e = this.buildEraser(o);
        if ( e ) { this.erasers.set(o.id, e); if ( this.synced ) this.eraseMotion(e, false); }   // a new erase stroke dissolves the damage out
      }
      if ( e ) e.objIndex = index;
    });
    for ( const [id, e] of this.erasers ) if ( !keepErase.has(id) && !e.leaving ) { e.leaving = true; this.eraseMotion(e, true); }   // undone: the damage dissolves back
    this.synced = true;
    // creation order (stroke index, then the sheet's order inside a stroke), on top of whatever is fading out
    const all = [...next, ...this.erasers.values()].map((g, k) => ({ g, k })).sort((a, b) => (a.g.objIndex - b.g.objIndex) || (a.k - b.k)).map((q) => q.g);
    this.order = next;
    for ( const g of all ) this.live.addChild(g.cont);
    // an object that lies over older ones gets its map patch (once: unchanged objects never change)
    const rects = [];
    for ( const g of all ) {
      const r = g.info.rect;
      if ( !g.erase && !g.patch && g.coverFrame && rects.some((q) => q.x0 < r.x1 && q.x1 > r.x0 && q.y0 < r.y1 && q.y1 > r.y0) ) this.addPatch(g);
      rects.push(r);
    }
    this.stats.groups = next.length;
    this.stats.sprites = next.reduce((a, g) => a + g.pieces.length + 1, 0);
    return { added, removed };
  }

  /** One area: its own atlas texture, base sprite and shard sprites. */
  build(r, rgba, sw, meta) {
    const rects = [r.base, ...r.pieces, ...(r.cover >= 0 ? [r.cover] : []), ...(r.light >= 0 ? [r.light] : [])].map((o) => ({ sx: meta[o + 1], sy: meta[o + 2], w: meta[o + 3], h: meta[o + 4] }));
    const coverIdx = 1 + r.pieces.length, lightIdx = r.light >= 0 ? coverIdx + (r.cover >= 0 ? 1 : 0) : -1;
    const pk = pack(rects);
    const buf = new Uint8Array(pk.W * pk.H * 4);
    rects.forEach((q, i) => {
      const p = pk.pos[i];
      for ( let y = 0; y < q.h; y++ ) buf.set(rgba.subarray(((q.sy + y) * sw + q.sx) * 4, ((q.sy + y) * sw + q.sx + q.w) * 4), ((p.y + y) * pk.W + p.x) * 4);
    });
    const tex = new PIXI.BaseTexture(new PIXI.BufferResource(buf, { width: pk.W, height: pk.H }), {
      width: pk.W, height: pk.H, scaleMode: this.filter, mipmap: PIXI.MIPMAP_MODES.ON, alphaMode: PIXI.ALPHA_MODES.UNPACK,
      format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP
    });
    this.stats.uploads++;
    const ap = this.ap, org = this.origin;
    const frame = (i) => new PIXI.Texture(tex, new PIXI.Rectangle(pk.pos[i].x, pk.pos[i].y, rects[i].w, rects[i].h));
    const b = r.base;
    const info = { hash: r.hash, x: meta[b + 5], y: meta[b + 6], w: meta[b + 3], h: meta[b + 4], ex: meta[b + 7], ey: meta[b + 8], R: meta[b + 9],
      type: TYPES[meta[b + 10]] ?? "blast", mat: meta[b + 11] & 15, cause: (meta[b + 11] >> 4) & 15, axis: meta[b + 14] / 1000, len: meta[b + 15] / 10 };
    const cont = new PIXI.Container(), baseCont = new PIXI.Container(), shardCont = new PIXI.Container();
    cont.eventMode = baseCont.eventMode = shardCont.eventMode = "none";
    cont.cullable = true;   // off-screen objects are not drawn at all
    cont.addChild(baseCont, shardCont);
    const baseSpr = new PIXI.Sprite(frame(0));
    baseSpr.eventMode = "none"; baseSpr.scale.set(ap);
    baseSpr.position.set(org.x + info.x * ap, org.y + info.y * ap);
    baseCont.addChild(baseSpr);
    const rect = { x0: info.x, y0: info.y, x1: info.x + info.w, y1: info.y + info.h };
    // the shard sprites are made a few hundred per frame (tick -> materialize): a big area has thousands, and making them all at
    // once held the page for ~50 ms
    const pieces = r.pieces.map((o, k) => {
      const w = meta[o + 3], h = meta[o + 4];
      const fx = meta[o + 5] + w / 2, fy = meta[o + 6] + h / 2;
      const flags = meta[o + 11];
      rect.x0 = Math.min(rect.x0, meta[o + 5], meta[o + 7]); rect.y0 = Math.min(rect.y0, meta[o + 6], meta[o + 8]);
      rect.x1 = Math.max(rect.x1, meta[o + 5] + w, meta[o + 7] + w); rect.y1 = Math.max(rect.y1, meta[o + 6] + h, meta[o + 8] + h);
      return { spr: null, frame: k + 1, fx, fy, sx: meta[o + 7] + w / 2, sy: meta[o + 8] + h / 2, rot: meta[o + 9] / 1000, dist: meta[o + 10] / 4,
        chip: !!(flags & 1), thrown: !!(flags & 2), moved: !!(flags & 4), z0: meta[o + 12] / 10, ptype: TYPES[meta[o + 13]] ?? info.type };
    });
    info.rect = rect;
    // culling by a fixed area (no bounds walk over thousands of shards each frame); room for flying pieces
    const m = 48, cull = new PIXI.Rectangle(org.x + (rect.x0 - m) * ap, org.y + (rect.y0 - m) * ap, (rect.x1 - rect.x0 + 2 * m) * ap, (rect.y1 - rect.y0 + 2 * m) * ap);
    cont.cullArea = cull;
    // the cover (this object's own pixels) as a frame of the same atlas: the mask of its map patch
    const coverFrame = r.cover >= 0 ? { tex: frame(coverIdx), x: meta[r.cover + 5], y: meta[r.cover + 6] } : null;
    const g = { hash: r.hash, tex, info, cont, baseCont, shardCont, baseSpr, baseTex: baseSpr.texture, pieces, made: 0, frame, coverFrame, patch: null, anim: null, fade: null, next: 0 };
    if ( lightIdx >= 0 ) Cause.addLight(this, g, frame(lightIdx), meta[r.light + 5], meta[r.light + 6]);
    if ( !this.flatten(g) ) this.materialize(g, 300);
    return g;
  }

  /**
   * PERF: a settled area as ONE sprite. Its shards never move once settled, so instead of making a sprite per shard (60k on a busy
   * scene: ~3 s of a load, ~60 MB of objects, and every live frame walked them) the base and the shards at rest are drawn once, by
   * the GPU in their own order and sampling, into a texture of the area's rectangle at its art resolution; the atlas is then dropped
   * from the GPU (kept in memory: an entry, a patch's cover read it again). The shard sprites are made only when the area enters
   * (unflatten). Not for an area with a cause light (its bloom lies between the ruin and the shards).
   * `CONFIG.moinenMaps.noFlatten = true`: shards as sprites (A/B).
   */
  flatten(g) {
    const R = canvas.app?.renderer;
    if ( !R || g.flat || g.light || globalThis.CONFIG?.moinenMaps?.noFlatten ) return false;
    const ap = this.ap, o = this.origin, r = g.info.rect, w = Math.max(1, r.x1 - r.x0), h = Math.max(1, r.y1 - r.y0);
    if ( w * h > 16e6 || !g.frame ) return false;
    const tmp = this._flatTmp ??= new PIXI.Container(), pool = this._flatPool ??= [];
    const base = this._flatBase ??= new PIXI.Sprite();
    base.texture = g.baseTex; base.anchor.set(0); base.scale.set(ap); base.position.set(o.x + g.info.x * ap, o.y + g.info.y * ap);
    tmp.addChild(base);
    const texs = [];
    for ( let k = 0; k < g.pieces.length; k++ ) {
      const p = g.pieces[k], s = pool[k] ??= new PIXI.Sprite(), t = g.frame(p.frame);
      texs.push(t); s.texture = t; s.anchor.set(0.5); s.scale.set(ap); s.rotation = 0; s.alpha = 1; s.tint = 0xFFFFFF; s.visible = true;
      s.position.set(o.x + p.fx * ap, o.y + p.fy * ap);                      // place(p, 2, null): at rest
      tmp.addChild(s);
    }
    const rt = PIXI.RenderTexture.create({ width: w * ap, height: h * ap, resolution: 1 / ap, scaleMode: this.filter === NEAREST ? PIXI.SCALE_MODES.NEAREST : PIXI.SCALE_MODES.LINEAR });
    R.render(tmp, { renderTexture: rt, transform: new PIXI.Matrix(1, 0, 0, 1, -(o.x + r.x0 * ap), -(o.y + r.y0 * ap)), clear: true });
    mipmaps(R, rt);
    tmp.removeChildren();
    for ( const t of texs ) t.destroy(false);
    this.release(g);
    g.flatTex = rt; g.flat = true; g.made = g.pieces.length; g.cont._mmv = (g.cont._mmv | 0) + 1;
    g.baseSpr.texture = rt; g.baseSpr.scale.set(1); g.baseSpr.position.set(o.x + r.x0 * ap, o.y + r.y0 * ap);
    g.tex.dispose();                                                          // off the GPU until an entry needs it
    this.stats.flat = (this.stats.flat ?? 0) + 1;
    return true;
  }

  /** An area's shard sprites back to the pool (it is flattened). */
  release(g) {
    for ( const p of g.pieces ) {
      const s = p.spr; if ( !s ) continue;
      p.spr = null;
      if ( s.destroyed ) continue;
      s.texture?.destroy(false); s.texture = PIXI.Texture.EMPTY;
      s.parent?.removeChild(s);
      if ( this.spritePool.length < 80000 ) this.spritePool.push(s); else s.destroy();
    }
  }

  /** Areas whose entry ended a while ago (nothing moves in them, nothing held under them) go back to one sprite each. */
  reflatten(now) {
    for ( const g of this.order ) {
      if ( !g.reflatAt || now < g.reflatAt ) continue;
      if ( g.anim || g.fade || g.made < g.pieces.length || g.cont.alpha < 1 ) { g.reflatAt = now + 300; continue; }
      g.reflatAt = 0;
      if ( this.dying.some((u) => u.heldBy === g) ) { g.reflatAt = now + 300; continue; }
      this.flatten(g);
    }
  }

  /** The base textures a group draws now (a flattened one: its flat texture and cover; else its atlas and cover), for an upload ahead. */
  texturesOf(g) {
    return [g.flat ? g.flatTex?.baseTexture : g.tex, g.coverTex?.baseTexture].filter(Boolean);
  }

  /** Back to base + shard sprites (an entry): the shards are made a few hundred per frame, as on a load. */
  unflatten(g) {
    if ( !g.flat ) return;
    const ap = this.ap, o = this.origin;
    g.baseSpr.texture = g.baseTex; g.baseSpr.scale.set(ap); g.baseSpr.position.set(o.x + g.info.x * ap, o.y + g.info.y * ap);
    g.flatTex?.destroy(true); g.flatTex = null; g.flat = false; g.made = 0; g.cont._mmv = (g.cont._mmv | 0) + 1;
    this.stats.unflat = (this.stats.unflat ?? 0) + 1;
  }

  /** Make up to `n` more shard sprites of a group (in order, so the drawing order stays); returns how many were made. */
  materialize(g, n) {
    const ap = this.ap, org = this.origin, end = Math.min(g.pieces.length, g.made + n), start = g.made;
    for ( ; g.made < end; g.made++ ) {
      const p = g.pieces[g.made];
      // pooled: an area flattened again after its entry gives its shard sprites back (flatten / release)
      const spr = p.spr = this.spritePool.pop() ?? new PIXI.Sprite();
      spr.texture = g.frame(p.frame); spr.visible = true; spr.alpha = 1; spr.tint = 0xFFFFFF; spr.rotation = 0;
      spr.eventMode = "none"; spr.anchor.set(0.5); spr.scale.set(ap);
      spr.position.set(org.x + p.fx * ap, org.y + p.fy * ap);
      if ( p.fading ) spr.alpha = 0;
      g.shardCont.addChild(spr);
      const it = g.anim?.byPiece?.get(p);
      if ( it ) this.place(p, Math.max(0, (performance.now() - it.t0) / it.dur), it, g.info.type);
    }
    return g.made - start;
  }

  /**
   * An area that is gone fades out. When a new area took its place and enters (enter with `under`), the old one stays underneath
   * instead: its pieces go as the new front passes them and it is removed when the entry ends, so the change is revealed along the
   * front (before, the unchanged part was cut out by a rectangle and showed as square blocks).
   */
  retire(g) {
    this.endAnim(g);
    g.dieStart = performance.now();
    this.dying.push(g);
  }

  /** The plain map, as the scene draws it (same texture and placement as the background), for patches. */
  mapSprite() {
    const bg = canvas.primary?.background, tex = bg?.texture;
    if ( !tex?.valid || tex === PIXI.Texture.WHITE || tex === PIXI.Texture.EMPTY ) return null;
    const s = new PIXI.Sprite(tex);
    s.eventMode = "none";
    s.anchor.copyFrom(bg.anchor); s.pivot.copyFrom(bg.pivot); s.position.set(bg.x, bg.y); s.scale.set(bg.scale.x, bg.scale.y); s.rotation = bg.rotation ?? 0;
    return s;
  }

  /** A later object covers what lies under it: the plain map, masked by the object's own pixels, drawn first in its container. */
  addPatch(g) {
    const ms = this.mapSprite(); if ( !ms ) return;
    const c = g.coverFrame, ap = this.ap, o = this.origin;
    const mask = new PIXI.Sprite(this.coverTexture(g));
    mask.eventMode = "none"; mask.scale.set(ap); mask.position.set(o.x + c.x * ap, o.y + c.y * ap);
    const patch = maskedMap(ms, mask);
    g.patch = patch;
    g.cont.addChildAt(patch, 0);
  }

  /**
   * The cover as its own small texture (a copy of its frame of the atlas, same sampling): a patch drawn from the atlas frame kept the
   * whole atlas on the GPU for a few pixels of mask (PERF, see flatten).
   */
  coverTexture(g) {
    const fr = g.coverFrame.tex.frame, data = g.tex?.resource?.data, TW = g.tex?.width;
    if ( !data || !TW ) return g.coverFrame.tex;
    const w = fr.width, h = fr.height, buf = new Uint8Array(w * h * 4);
    for ( let y = 0; y < h; y++ ) buf.set(data.subarray(((fr.y + y) * TW + fr.x) * 4, ((fr.y + y) * TW + fr.x + w) * 4), y * w * 4);
    const bt = new PIXI.BaseTexture(new PIXI.BufferResource(buf, { width: w, height: h }), {
      width: w, height: h, scaleMode: this.filter, mipmap: PIXI.MIPMAP_MODES.ON, alphaMode: PIXI.ALPHA_MODES.UNPACK,
      format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP });
    return g.coverTex = new PIXI.Texture(bt);
  }

  /** An erase stroke: the plain map over its pixels (art-pixel steps of its mask), no bake. */
  buildEraser(ob) {
    const K = 2, ap = this.ap, org = this.origin, bytes = ob.bytes;
    if ( !bytes ) return null;
    const W = ob.w * K, H = ob.h * K, a = new Uint8Array(W * H * 4);
    for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) if ( bytes[(y >> 1) * ob.w + (x >> 1)] ) { const q = (y * W + x) * 4; a[q] = a[q + 1] = a[q + 2] = a[q + 3] = 255; }
    const tex = PIXI.Texture.fromBuffer(a, W, H);
    const ms = this.mapSprite(); if ( !ms ) { tex.destroy(true); return null; }
    const mask = new PIXI.Sprite(tex); mask.eventMode = "none"; mask.scale.set(ap); mask.position.set(org.x + ob.x0 * K * ap, org.y + ob.y0 * K * ap);
    const cont = maskedMap(ms, mask);
    const rect = { x0: ob.x0 * K, y0: ob.y0 * K, x1: (ob.x0 + ob.w) * K, y1: (ob.y0 + ob.h) * K };
    return { erase: true, id: ob.id, cont, tex, info: { rect }, objIndex: 0, data: a, w: W, h: H, frame: mask.texture };
  }

  killEraser(e) {
    if ( e.dis ) { e.dis.tex.destroy(true); e.dis = null; }
    if ( !e.cont.destroyed ) e.cont.destroy({ children: true });
    e.tex.destroy(true);
  }

  /**
   * A mask that dissolves in (or out) pixel by pixel: `data` the full mask (RGBA, w x h), `x0, y0` its place (art px), `timeOf(ax, ay)`
   * the moment of each pixel (ms after the start). The covers of strokes painted over older damage and the erase strokes use it, with
   * the same per-pixel clock as the ruin they belong to, so at every pixel the old look turns into the new one directly.
   */
  makeDissolve(data, w, h, x0, y0, timeOf, out = false, lazy = false) {
    if ( lazy ) {   // the clock comes later (clockSlice); nothing shows until then
      const buf = new Uint8Array(w * h * 4);
      const tex = new PIXI.BaseTexture(new PIXI.BufferResource(buf, { width: w, height: h }), {
        width: w, height: h, scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.UNPACK,
        format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP });
      return { keys: null, next: 0, buf, data, tex, out, end: 0 };
    }
    const keys = new Float64Array(w * h);
    let c = 0;
    for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
      const i = y * w + x; if ( !data[i * 4 + 3] ) continue;
      keys[c++] = Math.max(0, Math.round(timeOf(x0 + x + 0.5, y0 + y + 0.5))) * 1048576 + i;
    }
    const sorted = keys.subarray(0, c).sort();
    const buf = out ? new Uint8Array(data) : new Uint8Array(w * h * 4);
    const tex = new PIXI.BaseTexture(new PIXI.BufferResource(buf, { width: w, height: h }), {
      width: w, height: h, scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.UNPACK,
      format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP });
    return { keys: sorted, next: 0, buf, data, tex, out, end: sorted.length ? Math.floor(sorted[sorted.length - 1] / 1048576) : 0 };
  }

  /**
   * Build the pending per-pixel clocks (an entry's ruin and its cover) for up to `budget` ms: on-screen areas first, then by their
   * start. The same keys enter() used to make at once: max(0, round(timeOf - (dark pixel ? dark : 0))) << 20 | pixel, sorted.
   */
  clockSlice(budget, vw) {
    const t0 = performance.now();
    const on = (q) => { const r = q.g.info.rect; return !(r.x0 > vw.x1 || r.y0 > vw.y1 || r.x1 < vw.x0 || r.y1 < vw.y0); };
    this.clocks.sort((a, b) => (on(b) - on(a)) || ((a.g.anim?.start ?? 0) - (b.g.anim?.start ?? 0)));
    while ( this.clocks.length ) {
      const q = this.clocks[0], { w, h, x0, y0, data, timeOf, dark } = q;
      if ( q.g.dead || !q.g.anim || (q.g.anim.rev !== q.R && q.g.anim.crev !== q.R) ) { this.clocks.shift(); continue; }   // ended or replaced
      q.keys ??= new Float64Array(w * h);
      const keys = q.keys;
      for ( ; q.y < h; q.y++ ) {
        const y = q.y;
        for ( let x = 0; x < w; x++ ) {
          const i = y * w + x, p = i * 4; if ( !data[p + 3] ) continue;
          let t = timeOf(x0 + x + 0.5, y0 + y + 0.5);
          if ( dark && data[p] + data[p + 1] + data[p + 2] < 150 ) t -= dark;
          keys[q.c++] = Math.max(0, Math.round(t)) * 1048576 + i;
        }
        if ( (y & 7) === 7 && performance.now() - t0 > budget ) { q.y++; return; }
      }
      const sorted = keys.subarray(0, q.c).sort();
      q.R.keys = sorted;
      if ( q.R.end !== undefined ) q.R.end = sorted.length ? Math.floor(sorted[sorted.length - 1] / 1048576) : 0;
      this.clocks.shift();
      this.stats.clocks = (this.stats.clocks ?? 0) + 1;
      if ( performance.now() - t0 > budget ) return;
    }
  }

  /** Advance a dissolve to `rel` ms; true while it is not finished. */
  stepDissolve(D, rel) {
    if ( !D.keys ) return true;
    const lim = (Math.max(0, rel) + 1) * 1048576, keys = D.keys, buf = D.buf, data = D.data;
    let n = 0;
    while ( D.next < keys.length && keys[D.next] < lim ) {
      const q = (keys[D.next] % 1048576) * 4;
      if ( D.out ) buf[q + 3] = buf[q] = buf[q + 1] = buf[q + 2] = 0;
      else { buf[q] = data[q]; buf[q + 1] = data[q + 1]; buf[q + 2] = data[q + 2]; buf[q + 3] = data[q + 3]; }
      D.next++; n++;
    }
    if ( n ) D.tex.update();
    return D.next < keys.length;
  }

  /** An erase stroke dissolves in (the damage under it dissolves out), or out again (undo), in ~0.3 s with a soft, noisy edge. */
  eraseMotion(e, out) {
    const mask = e.cont.children[1]; if ( !mask ) return;
    if ( reducedMotion() || !this.look.entry ) { if ( out ) e.gone = true; return; }
    const r = e.info.rect, cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, R = Math.max(4, Math.hypot(r.x1 - r.x0, r.y1 - r.y0) / 2);
    const seed = (e.id.length * 131 + e.id.charCodeAt(0)) | 0;
    const timeOf = (x, y) => 260 * Math.min(1, Math.hypot(x - cx, y - cy) / R) + (vnoise(x / 6, y / 6, seed) - 0.5) * 150 + (hash2(x | 0, y | 0, seed) - 0.5) * 40 + 75;
    if ( e.dis ) { e.dis.tex.destroy(true); e.dis = null; }
    e.dis = this.makeDissolve(e.data, e.w, e.h, r.x0, r.y0, timeOf, out);
    e.disStart = performance.now(); e.disOut = out;
    mask.texture = new PIXI.Texture(e.dis.tex);
  }

  /**
   * A group that left the screen is kept a while, detached (its texture stays on the GPU): switching a look toggle back, or an undo,
   * shows it again at once instead of building and uploading it again. The oldest beyond SPARE are destroyed.
   */
  stash(g) {
    g.heldBy = null; g.fade = null;
    for ( const p of g.pieces ) { if ( p.spr && !p.spr.destroyed ) this.place(p, 2, null, g.info.type); }   // back where it lies (a newer front may have flung it)
    g.cont.alpha = 1;
    g.cont.parent?.removeChild(g.cont);
    this.spare.delete(g.hash); this.spare.set(g.hash, g);
    while ( this.spare.size > 24 ) { const [h0, old] = this.spare.entries().next().value; this.spare.delete(h0); this.kill(old); }
  }

  kill(g) {
    g.dead = true;
    this.endAnim(g);
    for ( const p of g.pieces ) p.spr?.texture?.destroy(false);
    if ( g.flatTex ) { g.flatTex.destroy(true); g.flatTex = null; }
    if ( g.coverTex ) { g.coverTex.destroy(true); g.coverTex = null; }
    g.baseTex?.destroy(false);
    g.coverFrame?.tex.destroy(false);
    Cause.dropLight(this, g);
    if ( g.patch && !g.patch.destroyed ) g.patch.destroy({ children: true });
    if ( !g.cont.destroyed ) g.cont.destroy({ children: true });
    g.tex.destroy();
  }

  /* ---------------------------------------------------------------- entry */

  /**
   * The entry of a stroke object: the damage FORMS, it does not switch on.
   *  - The ruin is ERODED in pixel by pixel: every pixel of the object's base has its own moment, the front's arrival plus value
   *    noise across a wide band (a third of the run) plus a little grain, so the leading edge is a ragged, dissolving zone at
   *    art-pixel scale, never a line; dark pixels (cracks, inked lips) come a little earlier, so cracks race ahead of the break.
   *  - Every piece has a life: it fades in at its place and trembles (anticipation), tears loose when the ruin under it opens, flies on
   *    its own arc with its own spin and timing (size and a per-piece hash), lands with a squash and one or two small bounces, settles.
   *  - Along the dissolving edge the type sheds its own particles (dust, embers, spray, sparks), plus the one-shot accents (flash,
   *    shock ring, smoke) and the trailing dust.
   * `start` (performance.now() time; may lie in the past), `o` the impact (art px; default the epicentre), `dir` the stroke direction
   * (follows the stroke only), `under` older looks of the same stroke kept underneath until it is in, `path` [[x, y, ms], ...]: the
   * front runs along the brush path at the drawing speed.
   */
  enter(g, { start = performance.now(), o = null, dir = null, under = [], path = null, spine = null } = {}) {
    this.endAnim(g);
    const now = performance.now();
    if ( !this.look.entry ) { for ( const u of under ) u.heldBy = null; return; }
    if ( reducedMotion() ) { g.fade = { start, dur: 300 }; this.applyFade(g, now); return; }
    if ( g.flat ) this.unflatten(g);
    // an older look held under this one: its shards are caught by the front (tick), so they must exist
    for ( const u of under ) if ( u.flat ) { this.unflatten(u); this.materialize(u, Infinity); }
    // the cause tunes the clock on top of the kind's (cause-fx.mjs): rot creeps, lightning strikes, arcane spirals
    const CL = Cause.causeLook(g.info.cause);
    const info = g.info, L = LOOK[info.type] ?? LOOK.blast, k = (1 / (this.look.speed || 1)) * (CL?.slow ?? 1), pw = this.look.power;
    const ox = o?.[0] ?? info.ex, oy = o?.[1] ?? info.ey;
    const r = info.rect;
    let wipe = null;
    const d = dir && Math.hypot(dir[0], dir[1]) > 0.1 ? [dir[0] / Math.hypot(dir[0], dir[1]), dir[1] / Math.hypot(dir[0], dir[1])] : null;
    if ( d ) {
      const proj = [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => (x - ox) * d[0] + (y - oy) * d[1]);
      wipe = { u: d, p0: Math.min(...proj, 0) - 2, p1: Math.max(...proj) + 2 };
    }
    const Rmax = Math.max(...[[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].map(([x, y]) => Math.hypot(x - ox, y - oy))) + 2;
    const pathFront = this.pathFront(path, g, k);
    // a tear has its own clock (tear-entry.mjs): a pinprick, then a fast front both ways along its spine on a narrow band
    const tear = info.type === "gash" ? tearClock(info, { pathFront, spine, k }) : null;
    const delay = tear ? tear.delay : pathFront ? 40 * k : L.delay * k;
    const reveal = tear ? tear.reveal : pathFront ? pathFront.D : L.reveal * k * (0.6 + 0.4 * Math.min(2, Rmax / 40));
    const band = tear ? tear.band : Math.max(160 * k, reveal * 0.38);
    const front = (x, y) => {   // 0..1: when the front reaches (x, y)
      if ( wipe ) return clamp01((((x - ox) * wipe.u[0] + (y - oy) * wipe.u[1]) - wipe.p0) / (wipe.p1 - wipe.p0));
      // a cave-in runs from the rim of the hole (the impact's reach), not from the corners of the halo
      if ( L.order === "in" ) return 1 - clamp01(Math.hypot(x - ox, y - oy) / (Math.max(6, info.R) + 3));
      return clamp01(Math.hypot(x - ox, y - oy) / Rmax);
    };
    // the front's arrival at a point (ms after start)
    const arrive = tear ? tear.arrive : pathFront ? (x, y) => delay + pathFront.at(x, y)
      : CL ? (x, y) => delay + reveal * CL.curve(front(x, y), Math.atan2(y - oy, x - ox)) * 0.85
      : (x, y) => delay + reveal * Math.sqrt(front(x, y)) * 0.85;
    const seed = g.hash % 9973;
    // 0..1, smooth: vnoise(x / 7, y / 7, seed) * 0.65 + vnoise(x / 2.6, y / 2.6, seed + 17) * 0.35, from lattice grids over the area
    const n7 = latticeNoise(r.x0, r.y0, r.x1, r.y1, 7, seed), n26 = latticeNoise(r.x0, r.y0, r.x1, r.y1, 2.6, seed + 17);
    const noise = (x, y) => n7(x, y) * 0.65 + n26(x, y) * 0.35;
    // every pixel's moment (ms after start): the front's arrival, a wide band of smooth noise, a little grain (absolute coordinates,
    // so the ruin and the cover of the same pixel share it)
    const pixelTime = (ax, ay) => arrive(ax, ay) + (noise(ax, ay) - 0.5) * band + (hash2(ax | 0, ay | 0, seed) - 0.5) * band * 0.22;
    // 1. the ruin's own clock: one moment per pixel, sorted (time << 20 | pixel)
    // PERF: the clocks are not computed here but a slice per frame (clockSlice: on-screen areas first, then by start), so a Detonate
    // of every area no longer holds the page for ~2 s before its first frame; until its clock is in, nothing of the ruin shows (as at
    // the start of an entry anyway)
    let rev = null;
    const bd = this.baseOf(g);
    if ( bd ) {
      const bw = info.w, bh = info.h;
      const buf = new Uint8Array(bw * bh * 4);
      const tex = new PIXI.BaseTexture(new PIXI.BufferResource(buf, { width: bw, height: bh }), {
        width: bw, height: bh, scaleMode: this.filter, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.UNPACK,
        format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP });
      const stages = (tear ? [{ dt: 0 }] : FRONT[info.type] ?? [{ dt: 0 }]).map((s) => ({ dt: s.dt * k, col: s.col ?? null }));
      rev = { keys: null, next: 0, buf, data: bd, tex, w: bw, frame: g.baseSpr.texture, stages, cur: new Int32Array(stages.length) };
      g.baseSpr.texture = new PIXI.Texture(tex);
      // (dark: cracks and inked lips first)
      this.clocks.push({ g, R: rev, w: bw, h: bh, x0: info.x, y0: info.y, data: bd, timeOf: pixelTime, dark: band * 0.4, y: 0, c: 0, keys: null });
    }
    // the cover over older strokes (the plain map under this stroke's own pixels) dissolves in on the same clock: at every pixel the
    // older damage stays until this stroke's ruin takes its place, never old -> clean map -> new
    let crev = null;
    const pm = g.patch?.children?.[1];
    if ( pm && g.coverFrame ) {
      const fr = g.coverFrame.tex.frame, data = g.tex?.resource?.data, TW = g.tex?.width;
      if ( data && TW ) {
        const cd = new Uint8Array(fr.width * fr.height * 4);
        for ( let y = 0; y < fr.height; y++ ) cd.set(data.subarray(((fr.y + y) * TW + fr.x) * 4, ((fr.y + y) * TW + fr.x + fr.width) * 4), y * fr.width * 4);
        crev = this.makeDissolve(cd, fr.width, fr.height, g.coverFrame.x, g.coverFrame.y, pixelTime, false, true);
        crev.frame = pm.texture; pm.texture = new PIXI.Texture(crev.tex);
        this.clocks.push({ g, R: crev, w: fr.width, h: fr.height, x0: g.coverFrame.x, y0: g.coverFrame.y, data: cd, timeOf: pixelTime, dark: 0, y: 0, c: 0, keys: null });
      }
    }
    // 2. the pieces' lives
    const list = [], byPiece = new Map();
    g.pieces.forEach((p, n) => {
      if ( tear ) { const it = tearPiece(p, n, seed, tear, start, k); list.push(it); byPiece.set(p, it); this.place(p, -9, it, info.type); return; }
      const dx = p.fx - p.sx, dy = p.fy - p.sy, dd = Math.hypot(dx, dy);
      const hA = hash2(n, 1, seed), hB = hash2(n, 2, seed), hC = hash2(n, 3, seed);
      const size = p.spr ? Math.sqrt(p.spr.texture.frame.width * p.spr.texture.frame.height) : 6;
      const t0 = start + arrive(p.sx, p.sy) + (noise(p.sx, p.sy) - 0.5) * band * 0.8 + (hA - 0.5) * 90 * k;
      const dur = (p.thrown ? 380 + Math.min(460, dd * 14) : 260 + Math.min(220, dd * 30)) * L.flight * k * (0.8 + 0.45 * hB) * (0.85 + Math.min(0.5, size / 40));
      const arc = (p.thrown ? Math.max(4, dd * 0.55) : 1.5 + dd * 0.4) * L.arc * pw * (0.7 + 0.6 * hC) + (info.type === "cracks" ? 1.5 : 0);
      const it = { p, t0, dur, arc, spin: 0.6 + 0.9 * hA, bounces: p.chip ? 2 : 1, pre: (60 + 60 * hB) * k, dusted: false, seed: n };
      list.push(it); byPiece.set(p, it);
      this.place(p, -9, it, info.type);
    });
    g.anim = { start, delay, reveal, band, ox, oy, Rmax, wipe: pathFront || tear ? null : wipe, tear, list, byPiece, fx: [], rev, crev,
      path: pathFront, end: start + delay + reveal + band + 1600 * k, fired: new Set(), type: info.type, k, pw,
      reach: (x, y) => start + arrive(x, y), seed };
    g.anim.cl = CL; g.glowIn = 0;
    for ( const u of under ) u.heldBy = g;
    this.stats.entries++;
  }

  /** The ruin's own pixels (its frame of the group's atlas buffer). */
  baseOf(g) {
    const data = g.tex?.resource?.data, fr = (g.anim?.rev?.frame ?? g.baseTex ?? g.baseSpr?.texture)?.frame, W = g.tex?.width;
    if ( !data || !fr || !W ) return null;
    const out = new Uint8Array(fr.width * fr.height * 4);
    for ( let y = 0; y < fr.height; y++ ) out.set(data.subarray(((fr.y + y) * W + fr.x) * 4, ((fr.y + y) * W + fr.x + fr.width) * 4), y * fr.width * 4);
    return out;
  }

  /** A ragged disc (a polygon whose radius wobbles with the angle, the same every frame) instead of a perfect circle. */
  blob(m, x, y, r, seed) {
    if ( r < 3 ) { m.drawCircle(x, y, Math.max(0.01, r)); return; }
    const n = 28, pts = new Array(n * 2);
    for ( let i = 0; i < n; i++ ) {
      const a = (i / n) * Math.PI * 2, w = Math.sin(a * 3 + seed) * 0.06 + Math.sin(a * 7 + seed * 1.7) * 0.05 + Math.sin(a * 13 + seed * 2.3) * 0.03;
      pts[i * 2] = x + Math.cos(a) * r * (1.14 + w); pts[i * 2 + 1] = y + Math.sin(a) * r * (1.14 + w);   // never inside r
    }
    m.drawPolygon(pts);
  }

  /**
   * The front of a stroke that is followed: per path point the time it is reached (the drawing speed; the whole run clamped to
   * 0.35 .. 2.2 s and divided by the entry speed), the head at a time, and when the front reaches any point (its nearest path point
   * plus a little per pixel away from the path). Short taps return null (radial entry).
   */
  pathFront(path, g, k) {
    if ( !path || path.length < 2 ) return null;
    const pts = path.map((q) => [q[0], q[1]]);
    let len = 0; const cum = [0];
    for ( let i = 1; i < pts.length; i++ ) { len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(len); }
    if ( len < 12 ) return null;   // a tap: radial
    const T = path[path.length - 1][2] || 0;
    const D = Math.min(2200, Math.max(350, T || len * 6)) * k;
    const tt = path.map((q, i) => T > 0 ? (q[2] || 0) / T * D : cum[i] / len * D);
    const near = (x, y) => {
      let bd = Infinity, bt = 0;
      for ( let i = 1; i < pts.length; i++ ) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], sx = x1 - x0, sy = y1 - y0, l2 = sx * sx + sy * sy || 1;
        const t = clamp01(((x - x0) * sx + (y - y0) * sy) / l2), d = (x - x0 - sx * t) ** 2 + (y - y0 - sy * t) ** 2;
        if ( d < bd ) { bd = d; bt = tt[i - 1] + (tt[i] - tt[i - 1]) * t; }
      }
      return [Math.sqrt(bd), bt];
    };
    let wr = 6, cover = 0;
    for ( const p of g.pieces ) { const [d] = near(p.sx, p.sy); if ( d + 6 > wr ) wr = Math.min(d + 6, 80); }
    // how far the ruin reaches from the path at most (halo, torn lobes): after the run the discs grow to it, never a square pop
    const r = g.info.rect;
    for ( let x = r.x0; x <= r.x1; x += 6 ) for ( const y of [r.y0, r.y1] ) cover = Math.max(cover, near(x, y)[0]);
    for ( let y = r.y0; y <= r.y1; y += 6 ) for ( const x of [r.x0, r.x1] ) cover = Math.max(cover, near(x, y)[0]);
    const head = (el) => {
      for ( let i = 1; i < pts.length; i++ ) if ( tt[i] >= el ) {
        const f = (el - tt[i - 1]) / ((tt[i] - tt[i - 1]) || 1);
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f, pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
      }
      return null;
    };
    return { pts, tt, D, wr, cover: Math.max(wr, cover + 4), head, at: (x, y) => { const [d, t] = near(x, y); return t + d * 4 * k; } };
  }

  /** What rides on the head of a followed stroke: rolling explosions, a fire front, water surging in behind, a cave-in, a racing fracture, a claw. */
  pathEffects(g, a, now, el) {
    const P = a.path, h = P.head(el - a.delay); if ( !h ) return;
    const [x, y, dx, dy] = h, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, type = a.type, pw = a.pw;
    if ( now < (a.nextFx ?? 0) ) return;
    a.nextFx = now + (type === "blast" ? 110 : 45) * a.k;
    const side = () => (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.7) * P.wr;
    if ( type === "blast" ) {
      const gr = this.pixelCanvas();
      a.fx.push({ g: gr, kind: "flash", t0: now, dur: 120 * a.k, color: 0xfff1c4, maxR: Math.min(P.wr * 0.5, 12) * pw, x, y });
      this.burst(x, y, P.wr * 0.5 * pw, now, { n: 8 });
    } else if ( type === "scorch" ) {
      for ( let q = 0; q < 3; q++ ) { const s = side(); this.spawn({ x: x - uy * s, y: y + ux * s, vx: -ux * 4, vy: -uy * 4, rise: -6 - Math.random() * 4, life: 700 + Math.random() * 500, color: 0xff9a3c, flicker: true }); }
      if ( Math.random() < 0.4 ) this.spawn({ x, y, vx: 0, vy: 0, rise: -4, life: 1300, color: 0x5a524c, alpha: 0.7, size: 2 });
    } else if ( type === "flood" ) {
      for ( let q = 0; q < 2; q++ ) { const s = side() * 0.6; this.spawn({ x: x - ux * 6 - uy * s, y: y - uy * 6 + ux * s, vx: ux * 10, vy: uy * 10, life: 500, color: 0xe6f4ff, alpha: 0.9, drag: 3 }); }
    } else if ( type === "collapse" ) {
      const s = side(); this.spawn({ x: x - uy * s, y: y + ux * s, vx: 0, vy: 0, rise: -7, life: 800, color: 0xb9ae9e, alpha: 0.8, size: 2 });
    } else if ( type === "cracks" ) {
      this.spawn({ x, y, vx: ux * 6, vy: uy * 6, rise: -3, life: 380, color: 0xc8beb0, alpha: 0.7 });
    } else {
      for ( let q = 0; q < 2; q++ ) { const s = side() * 0.8; this.spawn({ x: x - uy * s, y: y + ux * s, vx: ux * 22 + (Math.random() - 0.5) * 8, vy: uy * 22 - 6, fall: 30, life: 280, color: Math.random() < 0.5 ? 0xfff0b0 : 0xffc860, drag: 2 }); }
    }
    // dust trailing behind the head
    if ( type !== "flood" && Math.random() < 0.6 ) this.spawn({ x: x - ux * 4, y: y - uy * 4, vx: -ux * 3, vy: -uy * 3, rise: -2, life: 700, color: 0xcfc6b8, alpha: 0.7, drag: 2 });
  }

  /**
   * Nothing is left to show (everything erased or cleared): the damage fades out instead of vanishing; erase strokes stay over it
   * until it has gone, so nothing old flashes back.
   */
  fadeAll() {
    for ( const g of this.groups.values() ) this.retire(g);
    this.groups.clear(); this.order = [];
    const t = performance.now() + 320;
    for ( const e of this.erasers.values() ) { e.leaving = true; e.killAt = t; }
    this.stats.groups = this.stats.sprites = 0;
  }

  /**
   * No entry (a look setting changed, a returning area): the new look fades in over the old one, which stays whole underneath until
   * it is covered, so there is no blank frame and no flash.
   */
  swap(g, under = [], dur = 220) {
    if ( !under.length ) return;
    // dur 0: in one frame (a stroke baked again only because older damage under it changed: the old look goes at the next tick,
    // before anything is drawn - no fade through a half-transparent cover, no blank frame)
    if ( !dur ) { g.cont.alpha = 1; g.fade = null; for ( const u of under ) u.heldBy = g; this.stats.silentSwaps = (this.stats.silentSwaps ?? 0) + 1; return; }
    g.fade = { start: performance.now(), dur };
    this.applyFade(g, performance.now());
    for ( const u of under ) u.heldBy = g;
  }

  /** Everything enters again (Detonate), from each area's own impact. */
  detonate(start) { for ( const g of this.order ) this.enter(g, { start }); }

  endAnim(g) {
    const a = g.anim; if ( !a ) return;
    g.anim = null;
    if ( !g.dead ) g.reflatAt = performance.now() + 900;    // back to one sprite after the cache has settled (static-cache SETTLE_MS)
    if ( a.rev ) {
      // the ruin in full: back to its frame of the atlas
      if ( g.baseSpr && !g.baseSpr.destroyed ) { const t = g.baseSpr.texture; g.baseSpr.texture = a.rev.frame; t.destroy(false); }
      a.rev.tex.destroy();
    }
    if ( a.crev ) {
      const pm = g.patch?.children?.[1];
      if ( pm && !pm.destroyed ) { const t = pm.texture; pm.texture = a.crev.frame; t.destroy(false); }
      a.crev.tex.destroy();
    }
    for ( const f of a.fx ) if ( !f.g.destroyed ) f.g.destroy();
    for ( const p of g.pieces ) { p.fading = false; if ( !p.spr || p.spr.destroyed ) continue; this.place(p, 2, null, g.info.type); p.spr.alpha = 1; p.spr.tint = 0xFFFFFF; }
    if ( g.baseCont && !g.baseCont.destroyed ) g.baseCont.position.set(0, 0);
    g.shardCont.position.set(0, 0);
  }

  /**
   * Erode the ruin up to `now`: every pixel whose moment has come is copied in; a few of them shed the type's particles, so the
   * dissolving edge itself carries the dust, embers, spray or sparks. One upload per frame, only while something changed.
   */
  erode(g, a, now, onScreen) {
    if ( a.crev ) this.stepDissolve(a.crev, now - a.start);
    const R = a.rev; if ( !R || !R.keys || R.next >= R.keys.length ) return;
    // the FRONT's signature: a pixel passes through the kind's stages before it settles (FRONT below): burning pixels flare
    // yellow, glow orange and cool to char; water arrives as foam; a cave-in darkens as it sinks; a blast scorches pale-hot. Every
    // stage is a cursor over the same sorted clock, so the stages trail the front as bands of a fixed width in time
    const S = R.stages, keys = R.keys, buf = R.buf, data = R.data, el = now - a.start, last = S.length - 1;
    const every = Math.max(9, Math.round(keys.length / 140)), shedMax = a.type === "scorch" ? 8 : 4;
    let n = 0, shed = 0;
    for ( let s = 0; s <= last; s++ ) {
      const lim = (Math.max(0, el - S[s].dt) + 1) * 1048576, st = S[s].col;
      while ( R.cur[s] < keys.length && keys[R.cur[s]] < lim ) {
        const i = keys[R.cur[s]] % 1048576, q = i * 4;
        if ( st && data[q + 3] === 255 ) { const c = st(data[q], data[q + 1], data[q + 2], i); buf[q] = c >> 16; buf[q + 1] = (c >> 8) & 255; buf[q + 2] = c & 255; buf[q + 3] = 255; }
        else { buf[q] = data[q]; buf[q + 1] = data[q + 1]; buf[q + 2] = data[q + 2]; buf[q + 3] = data[q + 3]; }
        if ( s === 0 && onScreen && (R.cur[0] % every) === 0 && shed < shedMax ) { shed++; this.edgeParticle(g, a, g.info.x + (i % R.w), g.info.y + Math.floor(i / R.w), now); }
        R.cur[s]++; n++;
      }
    }
    R.next = R.cur[last];
    if ( n ) R.tex.update();
  }

  /** What the dissolving edge sheds, by type. */
  edgeParticle(g, a, x, y, now) {
    if ( a.cl && Math.random() < a.cl.share ) return Cause.causeParticle(this, a.cl, x, y, a.k);   // the cause's share of the edge
    const t = a.type, j = () => (Math.random() - 0.5);
    if ( t === "scorch" ) this.spawn({ x, y, vx: j() * 3, vy: 0, rise: -6 - Math.random() * 5, life: 500 + Math.random() * 500, color: 0xff9a3c, flicker: true });
    else if ( t === "flood" ) this.spawn({ x, y, vx: j() * 6, vy: -1, life: 380, color: 0xe6f4ff, alpha: 0.9, drag: 3 });
    else if ( t === "gash" ) tearEdge(this, g, x, y);
    else if ( t === "cracks" ) this.spawn({ x, y, vx: j() * 4, vy: -1, rise: -2, life: 420, color: 0xc8beb0, alpha: 0.7 });
    else if ( t === "collapse" ) this.spawn({ x, y, vx: j() * 2, vy: 0, rise: -7, life: 700, color: 0xb9ae9e, alpha: 0.75, size: Math.random() < 0.3 ? 2 : 1 });
    else this.spawn({ x, y, vx: j() * 8, vy: -2 - Math.random() * 3, rise: -4, life: 520, color: 0xcfc6b8, alpha: 0.8, drag: 2.4, size: Math.random() < 0.25 ? 2 : 1 });
  }

  /**
   * A piece at flight time t (ms-normalised: 0 = tears loose at its source, 1 = lands, > 1 settles). Before 0 it fades in where it lies
   * and trembles (`a.pre` ms); far before, it is not drawn (the map below looks whole).
   */
  place(p, t, a, type) {
    const ap = this.ap, o = this.origin, s = p.spr;
    if ( !s ) return;
    if ( !a ) {
      s.visible = true; s.alpha = 1;
      s.position.set(o.x + p.fx * ap, o.y + p.fy * ap); s.rotation = 0; s.scale.set(ap);
      return;
    }
    if ( a.tear ) { tearPlace(this, p, t, a); if ( s.visible && !this.inScene(s.x, s.y) ) s.visible = false; return; }
    const tm = t * a.dur;
    if ( tm < 0 ) {
      // anticipation: it appears where it lies and shivers before it gives
      if ( tm < -a.pre ) { s.visible = false; return; }
      const f = 1 + tm / a.pre;
      // opaque from its first frame (a piece is a cut of the map: half see-through it read as a ghost of a polygon)
      s.visible = true; s.alpha = 1;
      const shiver = f > 0.45 ? ((Math.floor(tm / 45 + a.seed) & 1) ? 1 : -1) * (type === "collapse" ? 1 : 0.5) : 0;
      s.position.set(o.x + Math.round(p.sx + shiver) * ap, o.y + p.sy * ap);
      s.rotation = 0; s.scale.set(ap);
      return;
    }
    s.visible = true; s.alpha = 1;
    if ( t >= 1 ) {
      // landing: a squash, then one or two shrinking hops, then still
      const st = (t - 1) * a.dur, hops = a.bounces, hopMs = 150 * (a.k ?? 1);
      let hop = 0, squash = 1;
      if ( st < 70 ) squash = 0.82 + 0.18 * (st / 70);
      const hi = Math.floor(st / hopMs);
      if ( hi < hops ) { const ph = (st % hopMs) / hopMs, h = Math.min(2.5, a.arc * 0.18) / (hi + 1); hop = Math.sin(ph * Math.PI) * h; }
      s.position.set(o.x + p.fx * ap, o.y + Math.round(p.fy - hop) * ap);
      s.rotation = 0;
      s.scale.set(ap, ap * squash);
      return;
    }
    // flight: out on its own arc, spinning back to rest, a slight stretch while fast
    const e = 1 - (1 - t) ** 3;
    let x = p.sx + (p.fx - p.sx) * e, y = p.sy + (p.fy - p.sy) * e - a.arc * 4 * t * (1 - t);
    if ( type === "collapse" ) y -= 1.2 * Math.sin(Math.min(1, t * 2) * Math.PI) * (t < 0.5 ? 1 : 0);   // a small lift, then the drop
    s.position.set(o.x + Math.round(x) * ap, o.y + Math.round(y) * ap);
    if ( !this.inScene(s.x, s.y) ) s.visible = false;   // a flight is shown only while it is over the scene
    s.rotation = p.rot * (1 - e) * a.spin;
    let sc = 1 + 0.1 * Math.sin(Math.min(1, t) * Math.PI);
    if ( type === "flood" ) sc = 1.06 - 0.06 * e;
    s.scale.set(ap * sc, ap * sc * (1 - 0.08 * Math.sin(t * Math.PI)));
  }

  /* ---------------------------------------------------------------- particles (pooled) */

  /** A pooled pixel canvas for an accent (ring, flash, bolt...): art pixels as sprites in the fx layer (pixel-fx.mjs). */
  pixelCanvas() { const c = new PixelCanvas(this.fx, this.pxPool ??= []); c.clip = this.sceneRect(); c.stats = this.stats; return c; }

  /** The scene's rectangle (canvas px): nothing runtime is drawn past it (debris may leave the map, it is not rendered there). */
  sceneRect() { const r = canvas.dimensions?.sceneRect; return r ? { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height } : null; }
  inScene(x, y) { const r = this._sr ??= this.sceneRect(); return !r || (x >= r.x0 && y >= r.y0 && x < r.x1 && y < r.y1); }

  spawn(q) {
    if ( this.particles.length > 260 ) return;
    this.stats.spawned = (this.stats.spawned ?? 0) + 1;
    if ( !this.inScene(this.origin.x + q.x * this.ap, this.origin.y + q.y * this.ap) ) { this.stats.culled = (this.stats.culled ?? 0) + 1; return; }
    let s = this.pool.pop();
    if ( !s || s.destroyed ) { s = new PIXI.Sprite(PIXI.Texture.WHITE); s.eventMode = "none"; this.fx.addChild(s); }
    s.visible = true; s.tint = q.color; s.alpha = q.alpha ?? 1;
    // a few pixel sprites instead of one square: specks, grains, crumbs, puffs (art pixels, nearest)
    const sh = this.shapes ??= makeShapes(), size = q.size ?? 1, r = Math.random();
    s.texture = q.shape ? sh[q.shape] : size >= 3 ? (r < 0.5 ? sh.puff : sh.chunk) : size === 2 ? (r < 0.4 ? sh.sq : r < 0.7 ? sh.crumb : sh.diag) : (r < 0.72 ? sh.dot : sh.bar);
    s.anchor.set(0); s.scale.set(this.ap);
    q.spr = s; q.born ??= performance.now();
    this.particles.push(q);
  }

  burst(x, y, R, start, { n = 14 + Math.min(18, R), color = 0xcfc6b8, rise = -6, speed = 1 } = {}) {
    for ( let k = 0; k < n; k++ ) {
      // uneven: random directions and a wide spread of speeds, so the dust is a cloud with a ragged front, never a neat ring of specks
      const a = Math.random() * Math.PI * 2, sp = (R * 0.6 + 4) * (0.25 + Math.random() * 1.05) * speed;
      this.spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 - 2, life: 650 + Math.random() * 300, color, alpha: 0.85, size: Math.random() < 0.3 ? 2 : 1, born: start, drag: 2.6, rise });
    }
  }

  setIdle(on, who) { this.idle = { on, who }; }
  setLook({ entry, speed, power } = {}) {
    if ( entry !== undefined ) this.look.entry = !!entry;
    if ( speed !== undefined ) this.look.speed = speed;
    if ( power !== undefined ) this.look.power = power;
  }

  /* ---------------------------------------------------------------- frame */

  view() {
    const v = canvas.app.renderer.screen;
    const tl = canvas.stage.toLocal({ x: 0, y: 0 }), br = canvas.stage.toLocal({ x: v.width, y: v.height });
    const ap = this.ap, o = this.origin, m = 24;
    return { x0: (tl.x - o.x) / ap - m, y0: (tl.y - o.y) / ap - m, x1: (br.x - o.x) / ap + m, y1: (br.y - o.y) / ap + m };
  }

  tick() {
    const t0 = performance.now();
    if ( !canvas.stage ) return;
    this._sr = this.sceneRect();
    // sampling: crisp when an art pixel covers 3+ screen pixels; below that NEAREST shimmers while zooming and panning (an art pixel
    // flips between 1 and 2 screen pixels), so it is LINEAR + mipmaps there
    const z = canvas.stage.scale.x * this.ap;
    const want = this.filter === NEAREST ? (z < 2.6 ? LINEAR : NEAREST) : (z > 3 ? NEAREST : LINEAR);
    if ( want !== this.filter ) { this.filter = want; for ( const g of this.groups.values() ) { g.tex.scaleMode = want; if ( g.flatTex ) g.flatTex.baseTexture.scaleMode = want; if ( g.coverTex ) g.coverTex.baseTexture.scaleMode = want; } }
    const vw = this.view();
    let budget = 350;
    for ( const g of this.order ) if ( budget > 0 && g.made < g.pieces.length ) budget -= this.materialize(g, budget);
    if ( this.clocks.length ) this.clockSlice(6, vw);
    this.reflatten(t0);
    for ( const g of this.order ) {
      if ( g.fade ) this.applyFade(g, t0);
      if ( g.anim ) this.animate(g, t0, vw);
    }
    // erase strokes dissolving in or out
    for ( const [id, e] of this.erasers ) {
      if ( e.dis && !this.stepDissolve(e.dis, t0 - e.disStart) ) {
        const mask = e.cont.children[1];
        if ( e.disOut ) e.gone = true;
        else if ( mask && !mask.destroyed ) { const t = mask.texture; mask.texture = e.frame; t.destroy(false); }
        if ( !e.gone ) { e.dis.tex.destroy(true); e.dis = null; }
      }
      if ( e.gone || (e.leaving && !e.dis && (!e.killAt || t0 >= e.killAt)) ) { this.erasers.delete(id); this.killEraser(e); }
    }
    for ( let i = this.dying.length - 1; i >= 0; i-- ) {
      const g = this.dying[i], h = g.heldBy;
      if ( h && !h.dead && (h.anim || h.fade) ) {
        // under the area that replaced it: whole until the new front (or the cross-fade) has passed; its pieces go with the front
        g.dieStart = t0;
        const a = h.anim;
        // the older pieces are caught by the new front: they shiver as it nears, tear loose and are flung out with the new debris
        // (a short hop away from the new impact, spinning, dropping out pixel-art style), instead of just vanishing
        if ( a ) for ( const p of g.pieces ) {
          const s = p.spr; if ( !s?.visible || s.destroyed ) continue;
          const u = t0 - a.reach(p.fx, p.fy), ap = this.ap, o = this.origin;
          if ( u < -90 ) continue;
          if ( u < 0 ) { s.position.set(o.x + (p.fx + ((Math.floor(t0 / 40) & 1) ? 0.5 : -0.5)) * ap, o.y + p.fy * ap); continue; }
          if ( u > 340 ) { s.visible = false; continue; }
          const f = u / 340, e = 1 - (1 - f) ** 3, dx = p.fx - a.ox, dy = p.fy - a.oy, dl = Math.hypot(dx, dy) || 1, d = 3 + 7 * hash2(p.frame, 7, a.seed);
          s.position.set(o.x + Math.round(p.fx + dx / dl * d * e) * ap, o.y + Math.round(p.fy + dy / dl * d * e - 10 * f * (1 - f)) * ap);
          s.rotation = (hash2(p.frame, 8, a.seed) - 0.5) * 1.6 * e;
          s.visible = f < 0.55 || ((Math.floor(t0 / 50) + p.frame) & 1) === 0;
        }
        continue;
      }
      const f = h && !h.dead ? 1 : clamp01((t0 - g.dieStart) / 260);
      g.cont.alpha = 1 - f;
      if ( f >= 1 ) { this.dying.splice(i, 1); this.stash(g); }
    }
    this.idleTick(t0, vw);
    Cause.tickLights(this, t0);
    // particles: crisp art-pixel steps, fading by pixel dropout rather than soft alpha
    const ap = this.ap, o = this.origin;
    for ( let i = this.particles.length - 1; i >= 0; i-- ) {
      const q = this.particles[i], age = (t0 - q.born) / 1000;
      if ( age < 0 ) { q.spr.visible = false; continue; }
      if ( age * 1000 > q.life ) { q.spr.visible = false; this.pool.push(q.spr); this.particles[i] = this.particles[this.particles.length - 1]; this.particles.pop(); continue; }
      const k = q.drag ? (1 - Math.exp(-q.drag * age)) / q.drag : age;
      const x = q.x + q.vx * k, y = q.y + q.vy * k + (q.rise ?? 0) * age + (q.fall ?? 0) * age * age;
      q.spr.visible = (age * 1000) / q.life < 0.6 || ((Math.floor(t0 / 60) + (q.seed ??= (Math.random() * 7) | 0)) & 1) === 0;
      if ( q.flicker ) q.spr.tint = Math.floor(t0 / 90 + q.seed) % 3 ? q.color : 0xffd36b;
      const X = o.x + Math.round(x) * ap, Y = o.y + Math.round(y) * ap;
      if ( !this.inScene(X, Y) ) { this.stats.culled = (this.stats.culled ?? 0) + 1; q.spr.visible = false; this.pool.push(q.spr); this.particles[i] = this.particles[this.particles.length - 1]; this.particles.pop(); continue; }
      q.spr.position.set(X, Y);
    }
    const tc = performance.now();
    this.cache?.update();
    this.stats.cacheMs = performance.now() - tc;
    this.stats.frameMs = performance.now() - t0;
  }

  applyFade(g, now) {
    const f = clamp01((now - g.fade.start) / g.fade.dur);
    g.cont.alpha = f;
    if ( f >= 1 ) g.fade = null;
  }

  animate(g, now, vw) {
    const a = g.anim, info = g.info, type = a.type, r = info.rect;
    const onScreen = !(r.x0 > vw.x1 || r.y0 > vw.y1 || r.x1 < vw.x0 || r.y1 < vw.y0);
    if ( now > a.end ) { this.endAnim(g); return; }
    const el = now - a.start, ap = this.ap;
    this.erode(g, a, now, onScreen);
    // collapse: the ground trembles before it gives
    if ( type === "collapse" ) {
      const j = el < a.delay ? (((Math.floor(el / 45) & 1) ? 1 : -1) * ap) : 0;
      g.shardCont.position.set(j, 0); g.baseCont.position.set(j, 0);
    }
    const busy = a.tear ? this.livesAll(a, now, onScreen, type) : this.livesActive(a, now, onScreen, type);
    if ( onScreen ) this.effects(g, a, now, el);
    if ( a.cl ) Cause.causeEffects(this, g, a, now, el);
    if ( !busy && (!a.rev || (a.rev.keys && a.rev.next >= a.rev.keys.length)) && (!a.crev || (a.crev.keys && a.crev.next >= a.crev.keys.length)) && !a.fx.length ) this.endAnim(g);
  }

  /** One piece's frame: its pose and colour; `fin`: after this it never changes again (at rest, final colour). */
  life(it, a, t, onScreen, type) {
    if ( onScreen || t >= 1 ) this.place(it.p, t, it, type);
    if ( it.p.spr ) {
      // a burning plate glows as it curls, then cools back to the map's colours
      if ( type === "scorch" ) it.p.spr.tint = t <= 0 ? 0xFFFFFF : lerpColor(0xffa060, 0xffffff, clamp01(t));
      else if ( type === "flood" ) it.p.spr.tint = lerpColor(0xffffff, 0xb8d4ff, clamp01(t) * 0.7);
      if ( a.cl?.tint ) it.p.spr.tint = t <= 0 || t >= 1.5 ? 0xFFFFFF : lerpColor(a.cl.tint, 0xffffff, clamp01(t / 1.5));   // the cause's tint while it moves
    }
  }

  dust(it, type) {
    it.dusted = true;
    if ( it.p.thrown ) for ( let q = 0; q < 3; q++ ) this.spawn({ x: it.p.fx + (Math.random() - 0.5) * 3, y: it.p.fy + 1, vx: (Math.random() - 0.5) * 8, vy: -2 - Math.random() * 3, life: 420, color: 0xd8d0c2, alpha: 0.8, drag: 3 });
    else if ( type === "cracks" && Math.random() < 0.3 ) this.spawn({ x: it.p.fx, y: it.p.fy, vx: (Math.random() - 0.5) * 4, vy: -1, rise: -3, life: 500, color: 0xc8beb0, alpha: 0.7 });
  }

  /** Every piece, every frame (a tear: its own clock in tear-entry.mjs). True while some piece still moves. */
  livesAll(a, now, onScreen, type) {
    let busy = false;
    for ( const it of a.list ) {
      const t = (now - it.t0) / it.dur;
      this.life(it, a, t, onScreen, type);
      if ( t < 1 + 400 / it.dur ) busy = true;
      if ( onScreen && t >= 1 && !it.dusted ) this.dust(it, type);
    }
    return busy;
  }

  /**
   * PERF: the same lives, visiting only the pieces whose life has begun (by the moment they appear: before it a piece is hidden, as
   * enter left it) and not placing again a piece at rest in its final pose and colour (a Detonate visited ~50k pieces every frame).
   */
  livesActive(a, now, onScreen, type) {
    if ( !a.byStart ) {
      a.byStart = a.list.slice().sort((p, q) => (p.t0 - p.pre) - (q.t0 - q.pre)); a.nextStart = 0; a.act = [];
      a.busyUntil = a.list.reduce((m, it) => Math.max(m, it.t0 + it.dur + 400), -Infinity);   // = some piece has t < 1 + 400 / dur
    }
    const B = a.byStart, act = a.act;
    while ( a.nextStart < B.length && B[a.nextStart].t0 - B[a.nextStart].pre <= now ) act.push(B[a.nextStart++]);
    let w = 0;
    for ( let i = 0; i < act.length; i++ ) {
      const it = act[i], t = (now - it.t0) / it.dur;
      if ( !it.fin ) {
        this.life(it, a, t, onScreen, type);
        // at rest: past the landing squash and hops (place), past the cause's tint (1.5), the scorch / flood colours constant from 1
        if ( it.p.spr && t >= 1 && (t - 1) * it.dur >= Math.max(70, it.bounces * 150) && (!a.cl?.tint || t >= 1.5) ) it.fin = true;
      }
      if ( onScreen && t >= 1 && !it.dusted ) this.dust(it, type);
      if ( !(it.fin && it.dusted) ) act[w++] = it;
    }
    act.length = w;
    return now < a.busyUntil;
  }

  /** The type's own effects: one-shots at fixed moments, and what rides on the front. */
  effects(g, a, now, el) {
    const type = a.type, ap = this.ap, o = this.origin, pw = a.pw, k = a.k;
    const once = (key, at, fn) => { if ( el >= at && !a.fired.has(key) ) { a.fired.add(key); fn(); } };
    const X = (x) => o.x + x * ap, Y = (y) => o.y + y * ap;
    const R = Math.max(4, g.info.R);
    const tFront = clamp01((el - a.delay) / a.reveal);
    const frontR = a.Rmax * easeOut(tFront);
    const ring = (key, at, color, maxR, dur, width, extra = {}) => once(key, at, () => {
      const gr = this.pixelCanvas();
      a.fx.push({ g: gr, kind: "ring", t0: a.start + at, dur, color, maxR, width, ...extra });
    });
    if ( a.tear ) tearFx(this, g, a, now, el);
    else if ( a.path ) this.pathEffects(g, a, now, el);
    else if ( type === "blast" ) {
      once("flash", 0, () => {
        const gr = this.pixelCanvas();
        a.fx.push({ g: gr, kind: "flash", t0: a.start, dur: 140 * k, color: 0xfff1c4, maxR: Math.min(R * 0.45, 16) * pw });
      });
      once("ring", 30 * k, () => this.burst(a.ox, a.oy, R * 1.3 * pw, now, { n: 22, color: 0xd8cdb8, rise: -2, speed: 1.4 }));   // a skirt of dust puffs, not a drawn ring
      once("dust", 60 * k, () => this.burst(a.ox, a.oy, R * pw, now));
      once("rain", 260 * k, () => { for ( let q = 0; q < Math.round(10 * pw); q++ ) { const ang = Math.random() * 6.28, d = R * (0.5 + Math.random()); this.spawn({ x: a.ox + Math.cos(ang) * d, y: a.oy + Math.sin(ang) * d * 0.8 - 6, vx: 0, vy: 0, fall: 40, life: 380, color: 0x4a3f36, size: Math.random() < 0.4 ? 2 : 1 }); } });
    } else if ( type === "collapse" ) {
      once("crack", 0, () => { for ( let q = 0; q < 8; q++ ) this.spawn({ x: a.ox + (Math.random() - 0.5) * R, y: a.oy + (Math.random() - 0.5) * R * 0.8, vx: 0, vy: 0, rise: -2, life: 300, color: 0xbdb3a4, alpha: 0.6 }); });
      once("billow", a.delay + a.reveal * 0.75, () => this.burst(a.ox, a.oy, R * 0.6 * pw, now, { rise: -10, speed: 0.6, color: 0xb9ae9e }));
    } else if ( type === "scorch" ) {
      if ( tFront < 1 && Math.random() < 0.9 ) for ( let q = 0; q < 2; q++ ) {
        const ang = Math.random() * 6.28;
        this.spawn({ x: a.ox + Math.cos(ang) * frontR, y: a.oy + Math.sin(ang) * frontR * 0.85, vx: (Math.random() - 0.5) * 3, vy: 0, rise: -5 - Math.random() * 5, life: 600 + Math.random() * 500, color: 0xff9a3c, flicker: true });
      }
      // smoke: dark puffs rising from the burnt ground behind the front, a second, thinner wave as it cools
      for ( const [key, at, n, col] of [["smoke", 0.4, 6, 0x4a4440], ["smoke2", 0.85, 4, 0x6a625c]] ) once(key, a.reveal * at, () => {
        for ( let q = 0; q < n; q++ ) this.spawn({ x: a.ox + (Math.random() - 0.5) * R * 1.2, y: a.oy + (Math.random() - 0.5) * R * 0.7, vx: 0.6 + Math.random(), vy: 0, rise: -3 - Math.random() * 3, life: 1400 + Math.random() * 600, color: col, alpha: 0.7, size: Math.random() < 0.6 ? 3 : 2 });
      });
    } else if ( type === "flood" ) {
      ring("r1", a.delay + a.reveal * 0.3, 0xe6f4ff, R * 0.9 * pw, 650 * k, 1, { outer: 0x5f8fbf, dash: 7 });
      ring("r2", a.delay + a.reveal * 0.6, 0xe6f4ff, R * 0.7 * pw, 600 * k, 1, { outer: 0x5f8fbf, dash: 6 });
      ring("r3", a.delay + a.reveal * 0.9, 0xcfe8ff, R * 0.5 * pw, 550 * k, 1, { outer: 0x4f7fae, dash: 5 });
      if ( tFront < 1 && Math.random() < 0.5 ) { const ang = Math.random() * 6.28; this.spawn({ x: a.ox + Math.cos(ang) * frontR * 0.8, y: a.oy + Math.sin(ang) * frontR * 0.6, vx: 0, vy: 0, rise: -2, life: 400, color: 0xe6f4ff, alpha: 0.9 }); }
    } else if ( type === "cracks" ) {
      if ( tFront < 1 && Math.random() < 0.6 ) { const ang = Math.random() * 6.28; this.spawn({ x: a.ox + Math.cos(ang) * frontR, y: a.oy + Math.sin(ang) * frontR * 0.85, vx: 0, vy: 0, rise: -3, life: 380, color: 0xc8beb0, alpha: 0.7 }); }
    } else if ( type === "gash" && a.wipe ) {
      // sparks and splinters on the claw's leading edge
      if ( tFront < 1 ) {
        const { u, p0, p1 } = a.wipe, f = p0 + (p1 - p0) * easeOut(tFront), n = [-u[1], u[0]];
        for ( let q = 0; q < 2; q++ ) {
          const off = (Math.random() - 0.5) * Math.max(6, g.info.R * 1.4);
          const x = a.ox + u[0] * f + n[0] * off, y = a.oy + u[1] * f + n[1] * off;
          this.spawn({ x, y, vx: u[0] * 18 + (Math.random() - 0.5) * 10, vy: u[1] * 18 - 6 + (Math.random() - 0.5) * 6, fall: 30, life: 260 + Math.random() * 200, color: Math.random() < 0.5 ? 0xfff0b0 : 0xffc860, drag: 2 });
        }
      }
    }
    // the settle beat: when the ruin is in, a last soft puff of dust round the rim (the debris landing), then stillness
    if ( !a.tear && (type === "blast" || type === "collapse" || type === "scorch") ) once("settle", a.delay + a.reveal + a.band * 0.4, () => {
      const n = Math.round(Math.min(10, 4 + R / 4) * pw), col = type === "scorch" ? 0x5a524c : 0xc9bfae;
      for ( let q = 0; q < n; q++ ) { const an = (q / n) * 6.28 + Math.random() * 0.5, d = R * (0.85 + Math.random() * 0.3); this.spawn({ x: a.ox + Math.cos(an) * d, y: a.oy + Math.sin(an) * d * 0.8, vx: Math.cos(an) * 3, vy: Math.sin(an) * 2, rise: -2, life: 650 + Math.random() * 300, color: col, alpha: 0.6, drag: 3, size: Math.random() < 0.5 ? 3 : 2 }); }
    });
    // rings and flashes
    for ( let i = a.fx.length - 1; i >= 0; i-- ) {
      const f = a.fx[i], t = (now - f.t0) / f.dur;
      if ( t >= 1 ) { f.g.destroy(); a.fx.splice(i, 1); continue; }
      if ( t < 0 ) continue;
      f.g.clear();
      if ( f.draw ) { f.draw(t); continue; }   // a cause's accent draws itself (cause-fx.mjs)
      const v = { ap, ox: o.x, oy: o.y };
      if ( f.kind === "flash" ) {
        // a pixel-art flash: a ragged disc in three hard bands and a few rays, art pixels on the art grid
        pxFlash(f.g, v, f.x ?? a.ox, f.y ?? a.oy, f.maxR, t, { seed: a.seed + i, colors: f.colors });
      } else {
        // a pixel-art ring: broken arcs of art pixels that open up and drop out as the ring spreads (no vector ellipse)
        pxRing(f.g, v, a.ox, a.oy, f.maxR * easeOut(t), t, { core: f.color, outer: f.outer ?? lerpColor(f.color, 0x3a3028, 0.45), seed: a.seed + i * 7, thick: f.width > 1 ? 2 : 1, dash: f.dash ?? 9 });
      }
    }
  }

  idleTick(now, vw) {
    if ( !this.idle.on || reducedMotion() || (this.idle.who === "gm" && !game.user.isGM) || !this.order.length ) return;
    for ( const g of this.order ) {
      const ar = g.info;
      if ( g.anim || ar.x > vw.x1 || ar.y > vw.y1 || ar.x + ar.w < vw.x0 || ar.y + ar.h < vw.y0 ) continue;
      if ( now < g.next ) continue;
      const rate = ar.type === "scorch" ? 700 : ar.type === "blast" ? 1800 : ar.type === "collapse" ? 1500 : 3500;
      g.next = now + rate * (0.6 + Math.random() * 0.8);
      const a = Math.random() * Math.PI * 2, r = ar.R * (0.4 + Math.random() * 0.6);
      const x = ar.ex + Math.cos(a) * r, y = ar.ey + Math.sin(a) * r * 0.8;
      if ( ar.cause && Cause.causeIdle(this, g, x, y) ) continue;
      if ( ar.type === "scorch" || (ar.type === "blast" && Math.random() < 0.5) ) {
        this.spawn({ x, y, vx: (Math.random() - 0.5) * 3, vy: 0, rise: -6 - Math.random() * 5, life: 1300 + Math.random() * 900, color: 0xff9a3c, flicker: true });
        if ( Math.random() < 0.5 ) this.spawn({ x: x + 1, y, vx: 0, vy: 0, rise: -3, life: 1600, color: 0x5a524c, alpha: 0.7, size: 2 });
      } else if ( ar.type === "collapse" ) {
        const sx = ar.ex + Math.cos(a) * ar.R * 0.9, sy = ar.ey + Math.sin(a) * ar.R * 0.7;
        this.spawn({ x: sx, y: sy, vx: (ar.ex - sx) * 0.15, vy: 0, fall: 14, life: 700, color: 0x3a3028 });
      } else if ( ar.type === "flood" ) {
        this.spawn({ x: ar.ex + Math.cos(a) * r * 0.5, y: ar.ey + Math.sin(a) * r * 0.4, vx: 1.5, vy: 0, life: 900, color: 0xcfe8ff, alpha: 0.9 });
      } else {
        for ( let k = 0; k < 3; k++ ) this.spawn({ x: x + k, y, vx: (Math.random() - 0.5) * 2, vy: 0, rise: -2.5, life: 1100, color: 0xc8beb0, alpha: 0.7 });
      }
    }
  }

  clear() {
    for ( const g of [...this.groups.values(), ...this.dying, ...this.spare.values()] ) this.kill(g);
    for ( const e of this.erasers.values() ) this.killEraser(e);
    this.groups.clear(); this.spare.clear(); this.erasers.clear(); this.order = []; this.dying = [];
    for ( const q of this.particles ) { q.spr.visible = false; this.pool.push(q.spr); }
    this.particles = [];
    this.stats.groups = this.stats.sprites = 0;
    this.cache?.invalidate();
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick);
    Cause.disposeLights(this);
    this.clear();
    this.cache?.destroy(); this.cache = null;
    for ( const sp of [...this.spritePool, ...(this._flatPool ?? []), this._flatBase] ) if ( sp && !sp.destroyed ) sp.destroy();
    this.spritePool = []; this._flatPool = null; this._flatBase = null; this._flatTmp?.destroy(); this._flatTmp = null;
    for ( const c of [this.objs, this.fx] ) if ( !c.destroyed ) c.destroy({ children: true });
  }
}
