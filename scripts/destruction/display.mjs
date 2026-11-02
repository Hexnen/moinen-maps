import { META_FIELDS } from "./core.mjs";
import { pack } from "./atlas-layout.mjs";
import { reducedMotion } from "../config.mjs";
import { tearClock, tearPiece, tearPlace, tearSnap, tearFx, tearEdge } from "./tear-entry.mjs";
import { collapseClock, collapsePlace, collapseFx, collapseEnd, collapseLum } from "./collapse-entry.mjs";
import * as Cause from "./cause-fx.mjs";
import { pxRing, pxFlash, PixelCanvas, pxArcs, tongueCells, pxTongue } from "./pixel-fx.mjs";
import { StaticCache, mipmaps } from "./static-cache.mjs";
import { MaskedPatch } from "./masked-map.mjs";
import { perfMode, particleCap } from "../perf-mode.mjs";
import { Debris } from "./debris.mjs";
import { buildShell } from "./composite.mjs";
import { PieceBatch, RectCanvas, RectLayer, batchStats } from "./piece-batch.mjs";
import { GpuPieceBatch, STUB, gpuPiecesSupported } from "./piece-gpu.mjs";
import { LOOK, hash2, vnoise, latticeNoise, pathTimes, clockOf, plainInfo, countSort, clockUpper, timeBytes } from "./entry-clock.mjs";
import { ClockPool } from "./clock-pool.mjs";
import { ErodeGPU, MAX_STAGES } from "./erode-gpu.mjs";

/** Entering areas draw their pieces as one batched geometry each (piece-batch.mjs); `CONFIG.moinenMaps.noBatchRender = true`: sprites (A/B). */
const batchOn = () => !globalThis.CONFIG?.moinenMaps?.noBatchRender;

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
const ONCE_MS = 5;   // per frame, the entries' one-shot effects (effects)
const enterMs = () => globalThis.CONFIG?.moinenMaps?.enterBudget ?? 4;   // per frame, setting up queued entries (drainEnters, pixelsSlice)
const FX_DRAW_MS = 4;   // per frame, the effects' redraws (effects)
const WAIT_MS = 150;   // how long an entry waits for its pixels (waitPixels) ...
const WAIT_LATE_MS = 700;   // ... or this long past its own start (a Detonate's start lies ahead; the pixels of a whole scene take a while)
const NEAREST = 0, LINEAR = 1;

function layer(sortLayer) {
  const c = new PIXI.Container();
  c.eventMode = "none";
  Object.assign(c, { elevation: 0, sortLayer, sort: 0, _lastSortedIndex: 0 });
  canvas.primary.addChild(c);
  return c;
}

const easeOut = (t) => 1 - (1 - t) ** 3;
/**
 * PERF: a buffer texture that uploads only the rows written since its last upload (an entry's eroding ruin and its covers change a
 * band of rows per frame; the whole texture went up every frame - a Detonate re-sent ~all of its 30 MPx of ruins each frame).
 * `mark(y0, y1)` before `baseTexture.update()`; unmarked updates upload it all.
 */
class RowResource extends PIXI.BufferResource {
  /** `o.blank`: the buffer is all zero now - its first upload allocates the texture empty and sends only the rows marked since. */
  constructor(data, o) { super(data, o); this.y0 = Infinity; this.y1 = -1; this.x0 = Infinity; this.x1 = -1; this.blank = !!o.blank; }
  /** Rows y0..y1 (and, optionally, columns x0..x1 of them) changed. */
  mark(y0, y1, x0 = 0, x1 = Infinity) { if ( y0 < this.y0 ) this.y0 = y0; if ( y1 > this.y1 ) this.y1 = y1; if ( x0 < this.x0 ) this.x0 = x0; if ( x1 > this.x1 ) this.x1 = x1; }
  upload(renderer, bt, gt) {
    const y0 = this.y0, y1 = this.y1, w = bt.realWidth, h = bt.realHeight, gl = renderer.gl;
    const x0 = Math.max(0, this.x0), x1 = Math.min(w - 1, this.x1);
    this.y0 = Infinity; this.y1 = -1; this.x0 = Infinity; this.x1 = -1;
    if ( this.blank && this.data && !(gt.width === w && gt.height === h) ) {
      gt.width = w; gt.height = h; this.blank = false;   // (a later re-upload - a lost context - sends it all)
      gl.texImage2D(bt.target, 0, gt.internalFormat, w, h, 0, bt.format, gt.type, null);
      if ( y1 < y0 ) return true;
    } else if ( !(gt.width === w && gt.height === h && y1 >= y0 && this.data) ) return super.upload(renderer, bt, gt);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, this.unpackAlignment);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, bt.alphaMode === PIXI.ALPHA_MODES.UNPACK);
    if ( x1 - x0 + 1 < w && renderer.context.webGLVersion >= 2 ) {
      // only the changed columns of those rows (WebGL2 reads the rectangle straight out of the full buffer)
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, w); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
      gl.texSubImage2D(bt.target, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1, bt.format, gt.type, this.data.subarray(y0 * w * 4, (y1 + 1) * w * 4));
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    } else gl.texSubImage2D(bt.target, 0, 0, y0, w, y1 - y0 + 1, bt.format, gt.type, this.data.subarray(y0 * w * 4, (y1 + 1) * w * 4));
    return true;
  }
}

/** The pieces' indices by the moment their life begins (t0 - pre), ties in list order (= a stable sort by that moment). */
function startOrderOf(list) {
  const N = list.length, K = new Float64Array(N), o = new Array(N);
  for ( let k = 0; k < N; k++ ) { K[k] = list[k].t0 - list[k].pre; o[k] = k; }
  return o.sort((x, y) => (K[x] - K[y]) || (x - y));
}

const easeIn = (t) => t * t;
const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
const lerpColor = (a, b, t) => {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t), g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t), bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

/**
 * The front's signature per kind: the stages a ruin pixel passes through as the front reaches it (ms after its own moment, at entry
 * speed 1), each a colour from its final colour (r, g, b, pixel index) -> 0xRRGGBB; the last stage (no colour) is the final pixel.
 * Few flat colours, hard steps (pixel art): a burning edge flares and cools to char, water arrives as a foam line, a cave-in
 * darkens as it sinks, a blast scorches pale-hot, a fracture flashes its dust. Tears have their own clock (tear-entry.mjs).
 */
const mixP = (r, g, b, c, t) => (Math.round(r + (((c >> 16) & 255) - r) * t) << 16) | (Math.round(g + (((c >> 8) & 255) - g) * t) << 8) | Math.round(b + ((c & 255) - b) * t);
/**
 * A stage that mixes the final colour towards a constant (mixP): its colour function, and `mix` so erode can use look-up tables
 * (lutOf: per channel, the same rounded value mixP gives - byte for byte - without three closure calls per pixel).
 */
const mx = (c, t) => ({ mix: [c, t], col: (r, g, b) => mixP(r, g, b, c, t) });
/** A stage that picks one of two colours by a hash of the pixel (`hash`: the same pick on the GPU, erode-gpu.mjs). */
const hx = (salt, thr, a, b) => ({ hash: [salt, thr, a, b], col: (r, g, bl, i) => (hash2(i, salt, 5) < thr ? a : b) });
const LUTS = new Map();
function lutOf([c, t]) {
  const key = `${c}|${t}`;
  let L = LUTS.get(key);
  if ( !L ) {
    L = [16, 8, 0].map((sh) => { const cc = (c >> sh) & 255, a = new Uint8Array(256); for ( let v = 0; v < 256; v++ ) a[v] = Math.round(v + (cc - v) * t); return a; });
    LUTS.set(key, L);
  }
  return L;
}
const FRONT = {
  // (the burning edge is a coherent glow band, cooling through red to char; the bright flame is the tongues - no per-pixel speckle)
  scorch:   [{ dt: 0, ...mx(0xe8742a, 0.45) }, { dt: 60, ...mx(0x9a3214, 0.42) },
             { dt: 140, ...mx(0x3a1a10, 0.35) }, { dt: 230 }],
  flood:    [{ dt: 0, ...hx(2, 0.6, 0xf2f8ff, 0xcfe6fa) }, { dt: 70, ...mx(0x8cc0ea, 0.6) }, { dt: 210 }],
  collapse: [{ dt: 0, ...mx(0x15110e, 0.72) }, { dt: 120, ...mx(0x15110e, 0.4) }, { dt: 240 }],
  blast:    [{ dt: 0, ...hx(3, 0.5, 0xfff4d6, 0xffd890) }, { dt: 50, ...mx(0xff9a48, 0.55) }, { dt: 140 }],
  // (a crack opens dark - never a pale haze - with a rare grain of dust flashing in it)
  cracks:   [{ dt: 0, ...mx(0xe8e0d0, 0.55) }, { dt: 35, ...mx(0x0e0c0a, 0.3) }, { dt: 90 }]
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

export class DestructionDisplay {
  constructor() {
    // one layer of damage objects in creation order: each object is a container [map patch, base, shards], so a later stroke covers
    // an earlier one (its patch lays the plain map over the older damage where the new stroke lies, then draws itself)
    this.objs = layer(247);
    // the objects themselves live in `live`; what does not move is shown from a cache under it (static-cache.mjs, PERF)
    this.live = this.objs.addChild(new PIXI.Container());
    this.live.eventMode = "none";
    this.fx = layer(249);
    // flying CHUNKS cut from each area's own map pixels (debris.mjs): pooled, under the dust in the fx layer
    this.perf = perfMode;
    this.debris = new Debris(this);
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
    this.batchStats = batchStats;   // (piece-batch.mjs counters)
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
  sync(rgba, w, h, meta, ap, origin, objects = [], shells = null) {
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
    // areas shown from the settled composite only (composite.mjs shells): no rows, no pixels
    for ( const a of shells ?? [] ) rows.push({ hash: a.h, shell: a, index: a.index });
    const next = [], added = [], seen = new Set();
    let replaced = 0;
    for ( const r of rows ) {
      if ( seen.has(r.hash) ) continue;
      seen.add(r.hash);
      let g = this.groups.get(r.hash);
      if ( g?.shell && !r.shell && rgba ) {
        // a shell's pixels came: the area itself takes its place at once (no entry, no fade: the same pixels)
        const full = this.build(r, rgba, w, meta);
        full.reused = true; full.info.water = g.info.water;
        this.adoptRim(g, full);
        if ( full.made < full.pieces.length ) this.materialize(full, Infinity);
        // (an entry waiting for these pixels, or queued by a Detonate, goes on with the area that replaces the shell)
        for ( const M of [this.pending, this.enterQueue] ) if ( M?.has(g) ) { const v = M.get(g); M.delete(g); M.set(full, v); }
        for ( const w of this.pending?.values() ?? [] ) if ( w.opts.under?.includes(g) ) w.opts.under = w.opts.under.map((u) => (u === g ? full : u));
        this.groups.set(r.hash, full); this.kill(g); g = full; replaced++;
        added.push(g);
      } else if ( !g && r.shell ) {
        g = buildShell(this, r.shell);
        this.groups.set(r.hash, g); added.push(g);
      } else if ( !g && this.spare.has(r.hash) ) {
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
    this.shellCount = next.reduce((a, g) => a + (g.shell ? 1 : 0), 0);
    if ( replaced ) this.cache?.invalidate();     // (the bands' members are other containers now; their pixels are the same)
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
    this.patchPass(all);
    this.stats.groups = next.length;
    this.stats.sprites = next.reduce((a, g) => a + g.pieces.length + 1, 0);
    return { added, removed };
  }

  /** The map patches of the objects that lie over older ones (`all`: groups and erasers in creation order; once per object: `patch`). */
  patchPass(all) {
    const rects = [];
    for ( const g of all ) {
      const r = g.info.rect;
      if ( !g.erase && !g.patch && g.coverFrame && rects.some((q) => q.x0 < r.x1 && q.x1 > r.x0 && q.y0 < r.y1 && q.y1 > r.y0) ) this.addPatch(g);
      rects.push(r);
    }
  }

  /**
   * A shell's area built from what the codec worker made of its chunk (chunks.mjs packShellAreas; stream.mjs shellsOf): the atlas and its
   * layout as they are - no sheet assembled, nothing copied - and, when it came with it, the dark rim (the area keeps no atlas for it).
   * Queued (swapQ) and made a few per frame (pixelsSlice); the group replaces the shell in place, as in sync (an entry waiting for it goes
   * on with the new group). `x`: { data, W, H, pos, sizes, meta, rim? }.
   */
  queueSwap(g, x) { (this.swapQ ??= []).push({ g, x }); }

  swapShell(g, x) {
    if ( g.dead || !g.shell || this.groups.get(g.hash) !== g || !x?.data ) return false;
    const F = META_FIELDS, meta = x.meta, r = { hash: g.hash, base: 0, pieces: [], cover: -1, light: -1, index: g.objIndex };
    for ( let k = 1; k < x.sizes.length; k++ ) { const o = k * F; if ( meta[o] === 2 ) r.cover = o; else if ( meta[o] === 3 ) r.light = o; else r.pieces.push(o); }
    const full = this.build(r, null, 0, meta, { pk: { W: x.W, H: x.H, pos: x.pos }, buf: x.data });
    full.reused = true; full.info.water = g.info.water;
    if ( x.rim && !g.rim ) Cause.setRim(this, g, x.rim);
    this.adoptRim(g, full);
    if ( x.rim === false && full.rimArgs ) { full.rimArgs = null; const i = this.rimQueue?.indexOf(full) ?? -1; if ( i >= 0 ) this.rimQueue.splice(i, 1); }   // (the worker found no rim: nothing to read from the atlas)
    if ( x.late ) full.rimLate = true;       // (its rim is read later, off the page: lateRims; not "known without a rim" until then)
    if ( full.made < full.pieces.length ) this.materialize(full, Infinity);
    for ( const M of [this.pending, this.enterQueue] ) if ( M?.has(g) ) { const v = M.get(g); M.delete(g); M.set(full, v); }
    for ( const w of this.pending?.values() ?? [] ) if ( w.opts.under?.includes(g) ) w.opts.under = w.opts.under.map((u) => (u === g ? full : u));
    full.objIndex = g.objIndex; full.objId = g.objId;
    this.groups.set(g.hash, full);
    const at = this.live.children.indexOf(g.cont), k = this.order.indexOf(g);
    if ( k >= 0 ) this.order[k] = full;
    if ( at >= 0 ) this.live.addChildAt(full.cont, at); else this.live.addChild(full.cont);
    this.kill(g);
    this.shellCount = Math.max(0, (this.shellCount ?? 1) - 1);
    this.patchPass([...this.order, ...this.erasers.values()].map((q, i) => ({ q, i })).sort((a, b) => (a.q.objIndex - b.q.objIndex) || (a.i - b.i)).map((p) => p.q));
    this.cache?.invalidate();
    this.stats.swapped = (this.stats.swapped ?? 0) + 1;
    return true;
  }

  /** One area: its own atlas texture, base sprite and shard sprites. */
  build(r, rgba, sw, meta, packed = null) {
    const rects = [r.base, ...r.pieces, ...(r.cover >= 0 ? [r.cover] : []), ...(r.light >= 0 ? [r.light] : [])].map((o) => ({ sx: meta[o + 1], sy: meta[o + 2], w: meta[o + 3], h: meta[o + 4] }));
    const coverIdx = 1 + r.pieces.length, lightIdx = r.light >= 0 ? coverIdx + (r.cover >= 0 ? 1 : 0) : -1;
    // (`packed`: the atlas and its layout, made in the codec worker - a shell's area, swapShell)
    const pk = packed ? packed.pk : pack(rects);
    let buf = packed ? packed.buf : new Uint8Array(pk.W * pk.H * 4);
    if ( !packed ) rects.forEach((q, i) => {
      const p = pk.pos[i];
      for ( let y = 0; y < q.h; y++ ) buf.set(rgba.subarray(((q.sy + y) * sw + q.sx) * 4, ((q.sy + y) * sw + q.sx + q.w) * 4), ((p.y + y) * pk.W + p.x) * 4);
    });
    // MEMORY: `rgba` (the whole assembled sheet) lives in this call's closure context (the copy above reads it from an arrow), which the
    // group's long-lived `frame` closure keeps: every area held on to its sheet (~330 MB on the 'map' scene). Not read below.
    rgba = null;
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
      return { spr: null, frame: k + 1, w, h, fx, fy, sx: meta[o + 7] + w / 2, sy: meta[o + 8] + h / 2, rot: meta[o + 9] / 1000, dist: meta[o + 10] / 4,
        chip: !!(flags & 1), thrown: !!(flags & 2), moved: !!(flags & 4), z0: meta[o + 12] / 10, ptype: TYPES[meta[o + 13]] ?? info.type,
        tk: meta[o + 14], tvx: meta[o + 15] / 16, tvy: meta[o + 16] / 16, tq: meta[o + 17] };   // (a tear piece's part in its entry: tear.mjs / tear-entry.mjs)
    });
    info.rect = rect;
    // culling by a fixed area (no bounds walk over thousands of shards each frame); room for flying pieces
    const m = 48, cull = new PIXI.Rectangle(org.x + (rect.x0 - m) * ap, org.y + (rect.y0 - m) * ap, (rect.x1 - rect.x0 + 2 * m) * ap, (rect.y1 - rect.y0 + 2 * m) * ap);
    cont.cullArea = cull;
    // the cover (this object's own pixels) as a frame of the same atlas: the mask of its map patch
    const coverFrame = r.cover >= 0 ? { tex: frame(coverIdx), x: meta[r.cover + 5], y: meta[r.cover + 6] } : null;
    const g = { hash: r.hash, tex, info, cont, baseCont, shardCont, baseSpr, baseTex: baseSpr.texture, pieces, made: 0, frame, coverFrame, patch: null, anim: null, fade: null, next: 0,
      atlas: { pos: pk.pos, W: pk.W, H: pk.H, sizes: rects.map((q) => [q.w, q.h]) } };   // (its layout: restoreAtlas)
    if ( lightIdx >= 0 ) Cause.addLight(this, g, frame(lightIdx), meta[r.light + 5], meta[r.light + 6]);
    if ( r.cover >= 0 ) {
      // every damage, glowing or not: a rim light on its lips and the lit bevels of its cracks in a dark scene (cause-fx addRim, read
      // from its cover and its base; nothing by day). PERF: not in the build - read from the atlas a few areas per frame (rimSlice;
      // ~10 ms an area: rebuilding the 232 areas of 'map' from their chunks spent ~2 s of one task in it); the atlas is kept until then
      g.rimArgs = { cover: coverIdx, cx: meta[r.cover + 5], cy: meta[r.cover + 6] };
      (this.rimQueue ??= []).push(g);
    }
    // its debris: chunk variants cut from its plates (the map under it) and its base, and the few that stay at rest by its rim
    // (sprites at the end of its shard container: part of its settled look, the same on every client)
    this.debris.makeSet(g, buf, pk.W, [...rects.slice(1, 1 + r.pieces.length).map((q, i) => ({ x: pk.pos[i + 1].x, y: pk.pos[i + 1].y, w: q.w, h: q.h })), { x: pk.pos[0].x, y: pk.pos[0].y, w: rects[0].w, h: rects[0].h }]);
    this.debris.makeRest(g);
    if ( !this.flatten(g) ) this.materialize(g, 300);
    buf = null;     // MEMORY: (the closure context above keeps it otherwise) the atlas lives in its texture only: freeAtlas can let it go
    return g;
  }

  /**
   * MEMORY: a flattened area's atlas lets go of its CPU copy (the GPU copy went at flatten): ~300 MB on a busy scene whose strokes all
   * have their pixels. Only for an area destruction.mjs can give the pixels back (restoreAtlas, from its stroke's chunk); an area
   * without its atlas never enters (enter: shown as it lies) until it has it again.
   */
  freeAtlas(g) {
    const r = g.tex?.resource;
    // (not while its rim light is still to be read from it, nor while it waits to enter: detonate sets the entries up over frames)
    if ( !r?.data || g.atlasFree || g.anim || g.rimArgs || this.enterQueue?.has(g) || this.pending?.has(g) ) return false;
    this.stats.atlasFreed = (this.stats.atlasFreed ?? 0) + r.data.byteLength;
    r.data = null; g.atlasFree = true;
    return true;
  }

  /**
   * The rim lights of built areas (cause-fx addRim), up to `budget` ms: on-screen areas first; an area flattened meanwhile may let go
   * of its atlas afterwards (afterFlatten again).
   */
  rimSlice(budget, vw) {
    const Q = this.rimQueue; if ( !Q?.length ) return;
    const t0 = performance.now(), on = (g) => { const r = g.info.rect; return !(r.x0 > vw.x1 || r.y0 > vw.y1 || r.x1 < vw.x0 || r.y1 < vw.y0); };
    if ( Q.length > 1 && !Q.sorted ) { Q.sort((a, b) => on(b) - on(a)); Q.sorted = true; }
    while ( Q.length && performance.now() - t0 < budget ) {
      const g = Q.shift(), A = g.atlas, data = g.tex?.resource?.data, R = g.rimArgs;
      if ( !R || g.dead || !A || !data ) { g.rimArgs = null; continue; }
      const cut = (i) => { const [w, h] = A.sizes[i], p = A.pos[i], out = new Uint8Array(w * h * 4); for ( let y = 0; y < h; y++ ) out.set(data.subarray(((p.y + y) * A.W + p.x) * 4, ((p.y + y) * A.W + p.x + w) * 4), y * w * 4); return { w, h, data: out }; };
      Cause.addRim(this, g, cut(R.cover), R.cx, R.cy, cut(0), g.info.x, g.info.y);
      g.rimArgs = null;
      this.stats.rims = (this.stats.rims ?? 0) + 1;
      if ( g.flat ) this.afterFlatten?.(g);
    }
    Q.sorted = false;
  }

  /**
   * A shell's dark rim (read in the codec worker, cause-fx setRim) goes on with the area that replaces it: not read again from the new
   * atlas (and not dark for the frames between).
   */
  adoptRim(from, to) {
    if ( !from.rim ) return;
    const L = this.causeLights;
    to.rim = from.rim; from.rim = null;
    L?.groups.delete(from); L?.groups.add(to);
    if ( to.rimArgs ) { to.rimArgs = null; const i = this.rimQueue?.indexOf(to) ?? -1; if ( i >= 0 ) this.rimQueue.splice(i, 1); }
  }

  /** The atlas again as a finished buffer (packed in the codec worker, chunks.mjs packAreaAtlases). */
  restoreAtlasData(g, data) {
    const A = g.atlas; if ( !g.atlasFree || !A || data?.length !== A.W * A.H * 4 ) return false;
    g.tex.resource.data = data; g.tex.update(); g.atlasFree = false;
    return true;
  }

  /** The atlas again from the area's sprites ([base, its shards in order, cover?, light?] as built), exactly as build laid it out. */
  restoreAtlas(g, sprites) {
    const A = g.atlas; if ( !g.atlasFree || !A || sprites.length !== A.sizes.length ) return false;
    const buf = new Uint8Array(A.W * A.H * 4);
    for ( let i = 0; i < sprites.length; i++ ) {
      const s = sprites[i], [w, h] = A.sizes[i], p = A.pos[i];
      if ( !s.img || s.w !== w || s.h !== h ) return false;
      for ( let y = 0; y < h; y++ ) buf.set(s.img.subarray(y * w * 4, (y + 1) * w * 4), ((p.y + y) * A.W + p.x) * 4);
    }
    g.tex.resource.data = buf; g.tex.update(); g.atlasFree = false;
    return true;
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
    this.afterFlatten?.(g);
    return true;
  }

  /** An area's shard sprites back to the pool (it is flattened). */
  release(g) {
    if ( g.batch ) {
      // batched: the poses go, the geometry back to its pool, the base sprite draws itself again
      for ( const p of g.pieces ) p.spr = null;
      if ( !g.batch.destroyed ) { g.batch.parent?.removeChild(g.batch); g.batch.destroy(); }
      g.batch = null; g.bmode = null; g.madeIdx = []; g.sheetCur = 0;
      return;
    }
    g.bmode = null;
    for ( const p of g.pieces ) {
      const s = p.spr; if ( !s ) continue;
      p.spr = null;
      if ( s.destroyed ) continue;
      s.texture?.destroy(false); s.texture = PIXI.Texture.EMPTY;
      s.parent?.removeChild(s);
      if ( this.spritePool.length < 80000 ) this.spritePool.push(s); else s.destroy();
    }
    g.madeIdx = []; g.sheetCur = 0;
  }

  /** Areas whose entry ended a while ago (nothing moves in them, nothing held under them) go back to one sprite each. */
  reflatten(now) {
    const t0 = performance.now();
    for ( const g of this.order ) {
      if ( performance.now() - t0 > 4 ) return;      // a few per frame (after a Detonate they all settle together)
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
    g.flatTex?.destroy(true); g.flatTex = null; g.flat = false; g.made = 0; g.madeIdx = []; g.sheetCur = 0; g.cont._mmv = (g.cont._mmv | 0) + 1;
    this.stats.unflat = (this.stats.unflat ?? 0) + 1;
  }

  /**
   * Make up to `n` more shard sprites of a group; returns how many were made. While the area enters (a flattened area makes its
   * shards only then) the ones whose life begins first are made first; each sprite goes to its sheet position among the made ones,
   * so the drawing order is the sheet's whatever order they are made in.
   */
  materialize(g, n, until = Infinity) {
    const N = g.pieces.length; if ( g.made >= N || n <= 0 ) return 0;
    const a = g.anim, timed = !!(a && !a.tear && a.list?.length === N);
    if ( timed && !a.startOrder ) { a.startOrder = startOrderOf(a.list); a.matCur = 0; }
    let made = 0;
    while ( made < n && g.made < N ) {
      let k;
      if ( timed ) {
        while ( a.matCur < N && g.pieces[a.startOrder[a.matCur]].spr ) a.matCur++;
        if ( a.matCur >= N ) break;
        const it = a.list[a.startOrder[a.matCur]]; if ( it.t0 - it.pre > until ) break;   // (only those due before `until`)
        k = a.startOrder[a.matCur++];
      }
      else { g.sheetCur ??= 0; while ( g.sheetCur < N && g.pieces[g.sheetCur].spr ) g.sheetCur++; if ( g.sheetCur >= N ) break; k = g.sheetCur++; }
      this.makePiece(g, k); made++; g.made++;
    }
    return made;
  }

  makePiece(g, k) {
    const ap = this.ap, org = this.origin, p = g.pieces[k];
    // BATCHED (piece-batch.mjs): the piece is a quad of its area's one geometry, its pose a PiecePose; the mode is chosen when the
    // area makes its first piece and kept until it is released (flattened again)
    g.bmode ??= batchOn() && g.atlas && g.tex ? "batch" : "sprite";
    if ( g.bmode === "batch" ) {
      if ( !g.batch || g.batch.destroyed ) {
        g.batch = new PieceBatch(g.pieces.length, g.tex, g.atlas, g.baseSpr); g.shardCont.addChildAt(g.batch, 0);
        // an entry's ruin before its first pixel shows nothing: its base quad is not drawn (nor its texture uploaded) until then
        g.batch.baseBlank = () => { const R = g.anim?.rev; return !!R && !R.shown && g.baseSpr?._texture?.baseTexture === R.tex; };
      }
      p.spr = g.batch.make(k, org.x + p.fx * ap, org.y + p.fy * ap, ap);
      if ( p.fading ) p.spr.alpha = 0;
      const it = g.anim?.byPiece?.get(p);
      if ( it ) this.place(p, (performance.now() - it.t0) / it.dur, it, g.info.type);
      return;
    }
    // pooled: an area flattened again after its entry gives its shard sprites back (flatten / release)
    const spr = p.spr = this.spritePool.pop() ?? new PIXI.Sprite();
    spr.texture = g.frame(p.frame); spr.visible = true; spr.alpha = 1; spr.tint = 0xFFFFFF; spr.rotation = 0;
    spr.eventMode = "none"; spr.anchor.set(0.5); spr.scale.set(ap);
    spr.position.set(org.x + p.fx * ap, org.y + p.fy * ap);
    if ( p.fading ) spr.alpha = 0;
    // its sheet position among the made ones (binary search over their sheet indices)
    const M = g.madeIdx ??= [];
    let lo = 0, hi = M.length;
    while ( lo < hi ) { const mid = (lo + hi) >> 1; if ( M[mid] < k ) lo = mid + 1; else hi = mid; }
    M.splice(lo, 0, k);
    g.shardCont.addChildAt(spr, lo);
    const it = g.anim?.byPiece?.get(p);
    // a piece made during its area's entry takes the pose of its own moment: hidden before its life begins (enter hid every piece
    // with place(p, -9); a flattened area has no sprites then, so they are hidden here as they are made - livesActive never visits
    // a piece before its start)
    if ( it ) this.place(p, (performance.now() - it.t0) / it.dur, it, g.info.type);
  }

  /**
   * An area that is gone fades out. When a new area took its place and enters (enter with `under`), the old one stays underneath
   * instead: its pieces go as the new front passes them and it is removed when the entry ends, so the change is revealed along the
   * front (before, the unchanged part was cut out by a rectangle and showed as square blocks).
   */
  retire(g) {
    this.endAnim(g);
    this.downGpu(g);       // (its pieces are flung by the front that replaces it: CPU poses)
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
      const tex = new PIXI.BaseTexture(new RowResource(buf, { width: w, height: h, blank: true }), {
        width: w, height: h, scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.UNPACK,
        format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP });
      return { keys: null, next: 0, buf, data, tex, out, end: 0 };
    }
    const tm = new Int32Array(w * h), ix = new Uint32Array(w * h);
    let c = 0, tmax = 0;
    for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
      const i = y * w + x; if ( !data[i * 4 + 3] ) continue;
      const v = Math.max(0, Math.round(timeOf(x0 + x + 0.5, y0 + y + 0.5))); tm[c] = v; ix[c++] = i; if ( v > tmax ) tmax = v;
    }
    const sorted = countSort(tm, ix, c, tmax);
    const buf = out ? new Uint8Array(data) : new Uint8Array(w * h * 4);
    const tex = new PIXI.BaseTexture(new RowResource(buf, { width: w, height: h, blank: !out }), {
      width: w, height: h, scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.UNPACK,
      format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP });
    return { keys: sorted.ix, tms: sorted.tm, next: 0, buf, data, tex, out, end: c ? sorted.tm[c - 1] : 0 };
  }

  /**
   * Build the pending per-pixel clocks (an entry's ruin and its cover) for up to `budget` ms: on-screen areas first, then by their
   * start. The same keys enter() used to make at once: max(0, round(timeOf - (dark pixel ? dark : 0))) << 20 | pixel, sorted.
   */
  clockSlice(budget, vw) {
    const t0 = performance.now();
    const on = (q) => { const r = q.g.info.rect; return !(r.x0 > vw.x1 || r.y0 > vw.y1 || r.x1 < vw.x0 || r.y1 < vw.y0); };
    this.clocks = this.clocks.filter((q) => !q.g.dead && q.g.anim && (q.g.anim.rev === q.R || q.g.anim.crev === q.R));   // ended or replaced
    this.clocks.sort((a, b) => (on(b) - on(a)) || ((a.g.anim?.start ?? 0) - (b.g.anim?.start ?? 0)));
    while ( this.clocks.length ) {
      const q = this.clocks[0], { w, h, x0, y0, data, timeOf, dark } = q;
      if ( !q.g.dead && q.g.anim && !on(q) ) return;   // off screen: built when it comes into view (erode waits for it)
      if ( q.g.dead || !q.g.anim || (q.g.anim.rev !== q.R && q.g.anim.crev !== q.R) ) { this.clocks.shift(); continue; }   // ended or replaced
      // PERF: each pixel's moment (whole ms) and index in pixel order, then a counting sort by moment (stable: ties stay in pixel
      // order) - the same keys as sorting (moment << 20 | pixel), in linear time (the sort was ~40% of building a clock)
      q.tm ??= new Int32Array(w * h); q.ix ??= new Uint32Array(w * h);
      const tm = q.tm, ix = q.ix;
      for ( ; q.y < h; q.y++ ) {
        const y = q.y;
        for ( let x = 0; x < w; x++ ) {
          const i = y * w + x, p = i * 4; if ( !data[p + 3] ) continue;
          let t = timeOf(x0 + x + 0.5, y0 + y + 0.5);
          if ( dark && data[p] + data[p + 1] + data[p + 2] < 150 ) t -= dark;
          const v = Math.max(0, Math.round(t));
          tm[q.c] = v; ix[q.c++] = i; if ( v > (q.tmax ?? 0) ) q.tmax = v;
        }
        if ( (y & 7) === 7 && performance.now() - t0 > budget ) { q.y++; return; }
      }
      const sorted = countSort(tm, ix, q.c, q.tmax ?? 0);
      q.tm = q.ix = null;
      q.R.keys = sorted.ix; q.R.tms = sorted.tm;
      if ( q.R.gpu ) q.R.time = this.gpuErode.timeTexture(timeBytes(sorted.ix, sorted.tm, w, h), w, h);
      if ( q.R.end !== undefined ) q.R.end = q.c ? sorted.tm[q.c - 1] : 0;
      this.clocks.shift();
      this.stats.clocks = (this.stats.clocks ?? 0) + 1;
      if ( performance.now() - t0 > budget ) return;
    }
  }

  /**
   * An entry's clocks (its ruin's and its cover's): to the clock workers when they are there (the same clock code, entry-clock.mjs: the
   * same keys), else - or when a worker fails - built here a slice per frame (clockSlice). `local`: here anyway.
   */
  clockJobs(list, spec, local = false) {
    if ( local || !ClockPool.available() || this.clockPool?.broken ) { this.clocks.push(...list); return; }
    const pool = this.clockPool ??= new ClockPool();
    const jobs = list.map((q) => ({ data: q.data, w: q.w, h: q.h, x0: q.x0, y0: q.y0, dark: q.dark, gpu: q.gpu }));   // (the worker makes the pixel mask: clockMask)
    const t = performance.now();
    pool.run(spec, jobs).then((keys) => {
      list.forEach((q, i) => {
        const a = q.g.anim; if ( q.g.dead || !a || (a.rev !== q.R && a.crev !== q.R) ) return;   // ended or replaced meanwhile
        const k = keys[i]; q.R.keys = k.ix; q.R.tms = k.tm;
        if ( q.R.gpu ) q.R.time = this.gpuErode.timeTexture(k.tx ?? timeBytes(k.ix, k.tm, q.w, q.h), q.w, q.h);
        if ( q.R.end !== undefined ) q.R.end = k.tm.length ? k.tm[k.tm.length - 1] : 0;
        this.stats.clocks = (this.stats.clocks ?? 0) + 1;
      });
      this.stats.clockWorkerMs = Math.round(performance.now() - t);
    }, (err) => {
      console.warn("moinen-maps | destruction: clock worker failed, clocks made on the page", err);
      this.clocks.push(...list.filter((q) => !q.g.dead && q.g.anim && (q.g.anim.rev === q.R || q.g.anim.crev === q.R)));
    });
  }

  /** The cave-in's pit grid and plate tones, ready-made for its entry (see prepCollapse), or nothing. */
  collPrep(g) {
    if ( globalThis.CONFIG?.moinenMaps?.noCollPrep ) return {};
    return { grid: g.collGrid ?? null, lum: g.collLum ?? null };
  }

  /**
   * Ahead of any entry (PERF: the cave-in's clock is ~3.5 ms of page time per area, of which the chamfer distance over its grid is
   * half): the clock worker makes the pit grid of a cave-in from its cover's pixels (g.collGrid; a copy goes over) and its plates' tones
   * are read here (g.collLum), while the area still has its pixels - when it was built (prepSlice, a few per slice) or just before its
   * atlas is let go (destruction.mjs, before it lets the atlas go). The entry then finds both. `CONFIG.moinenMaps.noCollPrep`: made at the entry, as before.
   */
  prepCollapse(g) {
    if ( globalThis.CONFIG?.moinenMaps?.noCollPrep || g.info.type !== "collapse" || g.dead || g.shell || g.atlasFree || !g.coverFrame ) return false;
    const fr = g.coverFrame.tex.frame, data = g.tex?.resource?.data, TW = g.tex?.width; if ( !data || !TW ) return false;
    if ( !g.collLum ) g.collLum = collapseLum(g, data, TW);
    if ( g.collGrid || g.prepBusy || !ClockPool.available() || this.clockPool?.broken ) return !!g.collGrid;
    const cd = new Uint8Array(fr.width * fr.height * 4);
    for ( let y = 0; y < fr.height; y++ ) cd.set(data.subarray(((fr.y + y) * TW + fr.x) * 4, ((fr.y + y) * TW + fr.x + fr.width) * 4), y * fr.width * 4);
    g.prepBusy = true;
    (this.clockPool ??= new ClockPool()).grid({ info: { x: g.info.x, y: g.info.y, w: g.info.w, h: g.info.h }, data: cd, fw: fr.width, fh: fr.height, cx: g.coverFrame.x, cy: g.coverFrame.y })
      .then((grid) => { g.prepBusy = false; if ( !g.collGrid ) g.collGrid = grid; }, () => { g.prepBusy = false; });
    return true;
  }

  prepSlice(now) {
    if ( now < (this.prepAt ?? 0) ) return;
    this.prepAt = now + 150;
    let n = 0;
    for ( const g of this.order ) if ( g.info.type === "collapse" && !(g.collGrid && g.collLum) && !g.prepBusy && this.prepCollapse(g) && ++n >= 2 ) break;
  }

  /** Advance a dissolve to `rel` ms; true while it is not finished. */
  stepDissolve(D, rel) {
    if ( !D.keys ) return true;
    const lim = (Math.max(0, rel) + 1) * 1048576, keys = D.keys, tms = D.tms, buf = D.buf, data = D.data;
    let n = 0;
    let lo = Infinity, hi = -1;
    while ( D.next < keys.length && tms[D.next] * 1048576 + keys[D.next] < lim ) {
      const px = keys[D.next], q = px * 4;
      if ( px < lo ) lo = px; if ( px > hi ) hi = px;
      if ( D.out ) buf[q + 3] = buf[q] = buf[q + 1] = buf[q + 2] = 0;
      else { buf[q] = data[q]; buf[q + 1] = data[q + 1]; buf[q + 2] = data[q + 2]; buf[q + 3] = data[q + 3]; }
      D.next++; n++;
    }
    if ( n ) { const W = D.tex.realWidth; D.tex.resource.mark?.(Math.floor(lo / W), Math.floor(hi / W)); D.tex.update(); D.shown = true; }
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
    if ( !g.batch?.gpu ) for ( const p of g.pieces ) { if ( p.spr && !p.spr.destroyed ) this.place(p, 2, null, g.info.type); }   // back where it lies (a newer front may have flung it)
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
    this.debris?.dropArea(g);
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
    this.enterQueue?.delete(g);
    this.endAnim(g);
    const now = performance.now();
    // an area shown from the composite or without its atlas has no pixels to play an entry with: they are asked for (pixelSource,
    // destruction.mjs) and the entry waits up to WAIT_MS for them (waitPixels); without a source it is shown as it lies
    if ( g.shell || g.atlasFree || under.some((u) => u.shell || u.atlasFree) ) {
      const pm = perfMode(), playable = this.look.entry && !reducedMotion() && pm !== "low" && this.onScreen(g, pm === "medium" ? 0 : 0.5);
      if ( this.pixelSource && playable && !arguments[1]?.noWait ) { this.waitPixels(g, { ...(arguments[1] ?? {}), start }); return; }
      for ( const u of under ) u.heldBy = null; this.stats.noPixelEntries = (this.stats.noPixelEntries ?? 0) + 1; return;
    }
    if ( !this.look.entry ) { for ( const u of under ) u.heldBy = null; return; }
    // an area far off screen is simply there (an entry nobody sees is not simulated: on a Detonate of every area that was most of
    // the cost); the view grown by half of it on every side (strictly the view in performance mode Medium); Low: a short fade
    const perf = perfMode();
    if ( !this.onScreen(g, perf === "medium" ? 0 : 0.5) ) { for ( const u of under ) u.heldBy = null; this.stats.offscreenEntries = (this.stats.offscreenEntries ?? 0) + 1; return; }
    if ( reducedMotion() || perf === "low" ) { g.fade = { start, dur: 300 }; this.applyFade(g, now); return; }
    const PE = this._prof, te0 = PE ? performance.now() : 0, lapE = (k) => { if ( PE ) { const t = performance.now(); PE["e_" + k] = (PE["e_" + k] ?? 0) + t - tl; tl = t; } };
    let tl = te0;
    if ( g.flat ) this.unflatten(g);
    // an older look held under this one: its shards are caught by the front (tick), so they must exist
    for ( const u of under ) { if ( u.flat ) { this.unflatten(u); this.materialize(u, Infinity); } else this.downGpu(u); }
    // the entry's clock (entry-clock.mjs, shared with the clock worker): the kind's, tuned by the cause (rot creeps, lightning
    // strikes, arcane spirals); a tear's and a cave-in's own
    const info = g.info, pw = this.look.power, pathFront = this.pathFront(path, g, (1 / (this.look.speed || 1)) * (Cause.causeLook(info.cause)?.slow ?? 1));
    lapE("unflat");
    const C = clockOf({ info, hash: g.hash, o, dir, path, spine, speed: this.look.speed, pathFront });
    const { CL, L, k, ox, oy, Rmax, tear, seed, noise } = C;
    const r = info.rect;
    // a cave-in has its own clock too (collapse-entry.mjs): anticipation, then the rings slump from the rim inwards
    const coll = info.type === "collapse" && !tear ? collapseClock(this, g, { start, k, pathFront, ...this.collPrep(g) }) : null;
    if ( coll && !globalThis.CONFIG?.moinenMaps?.noCollPrep ) { g.collGrid ??= coll.grid; g.collLum ??= coll.lum; }    // (the same pit again: nothing to make)
    const wipe = C.wipe;
    const delay = coll ? coll.delay : C.delay, reveal = coll ? coll.reveal : C.reveal, band = coll ? coll.band : C.band;
    const arrive = coll ? coll.arrive : C.arrive;
    const pixelTime = coll ? coll.pixelTime : C.pixelTime;
    // what the clock worker needs to make the same clock (clock-worker.mjs)
    const spec = { info: plainInfo(info), hash: g.hash, o, dir, path, spine, speed: this.look.speed, coll: null };
    // 1. the ruin's own clock: one moment per pixel, sorted (time << 20 | pixel)
    // PERF: the clocks are not computed here but a slice per frame (clockSlice: on-screen areas first, then by start), so a Detonate
    // of every area no longer holds the page for ~2 s before its first frame; until its clock is in, nothing of the ruin shows (as at
    // the start of an entry anyway)
    lapE("clockOf");
    let rev = null;
    const clockJobs = [];
    const bd = this.baseOf(g);
    if ( bd ) {
      const bw = info.w, bh = info.h;
      const stages = coll ? coll.stages : (tear ? [{ dt: 0 }] : FRONT[info.type] ?? [{ dt: 0 }]).map((s, si) => (s.col && CL?.stain != null
        ? { dt: s.dt * k, ...mx(CL.stain, si ? 0.3 : 0.6) } : { dt: s.dt * k, col: s.col ?? null, mix: s.mix ?? null, hash: s.hash ?? null }));
      const gs = coll ? null : this.gpuStages(stages);
      if ( gs ) {
        // GPU erode (erode-gpu.mjs): a render texture the pass fills from the atlas and the clock; no CPU buffer
        const T = this.gpuErode.makeTarget(bw, bh, this.filter);
        rev = { keys: null, next: 0, buf: null, data: bd, tex: T.base, rt: T.tex, gpu: gs, w: bw, h: bh, frame: g.baseSpr.texture, stages, cur: new Int32Array(stages.length) };
        g.baseSpr.texture = T.tex;
      } else {
        const buf = new Uint8Array(bw * bh * 4);
        const tex = new PIXI.BaseTexture(new RowResource(buf, { width: bw, height: bh, blank: true }), {
          width: bw, height: bh, scaleMode: this.filter, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.UNPACK,
          format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP });
        rev = { keys: null, next: 0, buf, data: bd, tex, w: bw, frame: g.baseSpr.texture, stages, cur: new Int32Array(stages.length) };
        g.baseSpr.texture = new PIXI.Texture(tex);
      }
      // PERF: a blank ruin draws nothing - not drawn (its texture not even allocated on the GPU) until its first pixel (erode)
      if ( !g.batch?.folded ) g.baseSpr.renderable = false;
      // (dark: cracks and inked lips first)
      clockJobs.push({ g, R: rev, w: bw, h: bh, x0: info.x, y0: info.y, data: bd, timeOf: pixelTime, dark: band * 0.4, y: 0, c: 0, keys: null, gpu: !!rev.gpu });
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
        const gs = this.gpuStages([{ dt: 0 }]);
        if ( gs ) {
          const T = this.gpuErode.makeTarget(fr.width, fr.height, PIXI.SCALE_MODES.NEAREST);
          crev = { keys: null, next: 0, buf: null, data: cd, tex: T.base, rt: T.tex, gpu: gs, out: false, end: 0, w: fr.width, h: fr.height, stages: [{ dt: 0 }], cur: new Int32Array(1), fr };
          crev.frame = pm.texture; pm.texture = T.tex;
        } else {
          crev = this.makeDissolve(cd, fr.width, fr.height, g.coverFrame.x, g.coverFrame.y, pixelTime, false, true);
          crev.frame = pm.texture; pm.texture = new PIXI.Texture(crev.tex);
        }
        g.patch.renderable = false;      // (blank: nothing to draw until its first pixel, see erode)
        clockJobs.push({ g, R: crev, w: fr.width, h: fr.height, x0: g.coverFrame.x, y0: g.coverFrame.y, data: cd, timeOf: pixelTime, dark: 0, y: 0, c: 0, keys: null, gpu: !!crev.gpu });
      }
    }
    lapE("rev+crev");
    // the clocks: made by the clock workers (clock-pool.mjs, the same code) or here, a slice per frame (clockSlice)
    if ( clockJobs.length ) {
      if ( coll ) { const G = coll.grid; spec.coll = { mask: G.mask, fw: G.fw, fh: G.fh, cx: G.cx, cy: G.cy }; }
      this.clockJobs(clockJobs, spec, !!coll && !spec.coll);
    }
    lapE("clockJobs");
    // 2. the pieces' lives
    // (GPU pieces, piece-gpu.mjs: a plain entry's pieces move in the vertex shader - no pose is placed here or per frame)
    // (a cave-in without its cover frame has no clock of its own - coll null - and plays the generic entry: display.place's motion, which the plain shader knows for type "collapse" too)
    const gmode = tear ? "tear" : coll ? "coll" : "plain", gpu = this.gpuPieces(g, gmode !== "plain");
    if ( !gpu ) this.downGpu(g);
    const list = [], byPiece = new Map();
    g.pieces.forEach((p, n) => {
      if ( tear ) { const it = tearPiece(p, n, seed, tear, start, k); list.push(it); byPiece.set(p, it); if ( !gpu ) this.place(p, -9, it, info.type); return; }
      if ( coll ) { const it = coll.piece(p, n); list.push(it); byPiece.set(p, it); if ( !gpu ) this.place(p, -9, it, info.type); return; }
      const dx = p.fx - p.sx, dy = p.fy - p.sy, dd = Math.hypot(dx, dy);
      const hA = hash2(n, 1, seed), hB = hash2(n, 2, seed), hC = hash2(n, 3, seed);
      // its frame's size (p.w x p.h): a flattened area has no sprites when it enters, and a default here changed every piece's timing
      const size = p.w ? Math.sqrt(p.w * p.h) : p.spr ? Math.sqrt(p.spr.texture.frame.width * p.spr.texture.frame.height) : 6;
      const t0 = start + arrive(p.sx, p.sy) + (noise(p.sx, p.sy) - 0.5) * band * 0.8 + (hA - 0.5) * 90 * k;
      const dur = (p.thrown ? 380 + Math.min(460, dd * 14) : 260 + Math.min(220, dd * 30)) * L.flight * k * (0.8 + 0.45 * hB) * (0.85 + Math.min(0.5, size / 40));
      const arc = (p.thrown ? Math.max(4, dd * 0.55) : 1.5 + dd * 0.4) * L.arc * pw * (0.7 + 0.6 * hC) + (info.type === "cracks" ? 1.5 : 0);
      const it = { p, t0, dur, arc, spin: 0.6 + 0.9 * hA, bounces: p.chip ? 2 : 1, pre: (60 + 60 * hB) * k, dusted: false, seed: n };
      list.push(it); byPiece.set(p, it);
      if ( !gpu ) this.place(p, -9, it, info.type);
    });
    lapE("list");
    g.anim = { start, delay, reveal, band, ox, oy, Rmax, wipe: pathFront || tear ? null : wipe, tear, list, byPiece, fx: [], rev, crev,
      path: pathFront, end: start + delay + reveal + band + 1600 * k, fired: new Set(), type: info.type, k, pw,
      reach: (x, y) => start + arrive(x, y), seed };
    g.anim.cl = CL; g.glowIn = 0;
    if ( coll ) { g.anim.coll = coll; g.anim.end = Math.max(g.anim.end, coll.endBy + 200 * k); }
    if ( gpu ) this.gpuEnter(g, g.anim, gmode);
    lapE("gpuEnter");
    // the chunks that stay by the rim are hidden and thrown from the damage: each shows where it lies when it lands
    this.debris.hideRest(g);
    this.debris.throwRest(g, start + (info.type === "blast" ? 40 * k : delay + reveal * 0.7), k);
    // a flattened area has no shards yet: the ones due in its first 150 ms at once, the rest a slice per frame, earliest first (tick)
    if ( g.made < g.pieces.length && !tear && !gpu ) this.materialize(g, Infinity, start + 150);
    lapE("debris");
    for ( const u of under ) u.heldBy = g;
    this.stats.entries++;
    { const late = Math.max(0, now - start); this.stats.lateSum = (this.stats.lateSum ?? 0) + late; this.stats.lateN = (this.stats.lateN ?? 0) + 1; if ( late > (this.stats.lateMax ?? 0) ) this.stats.lateMax = late; }
  }

  /**
   * PIXELS BEFORE AN ENTRY: an area (or an older look held under it) without its pixels - a shell of the settled composite, an atlas
   * let go after flatten - waits up to WAIT_MS for them: they are asked for in one batch per frame (`pixelSource(groups)` ->
   * Promise<Map(group -> its sprites as display.build laid them out)>, destruction.mjs; a shell is refilled in place, its group
   * replaced by sync), atlases are rebuilt a few per frame (restoreSlice), and the entry starts as soon as everything is there, on its
   * original clock (what was due meanwhile is shown in its pose of now). Not in time: the area fades in where it lies (a short fade).
   */
  waitPixels(g, opts) {
    const P = this.pending ??= new Map();
    const now = performance.now();
    if ( !P.has(g) ) P.set(g, { opts, deadline: Math.max(now + WAIT_MS, Math.min(opts.start ?? now, now + 800) + WAIT_LATE_MS) });
    const ask = this.pixelAsks ??= new Set();
    for ( const x of [g, ...(opts.under ?? [])] ) if ( x.shell || x.atlasFree ) ask.add(x);
    this.stats.waits = (this.stats.waits ?? 0) + 1;
  }

  /**
   * A Detonate is on its way (its flag arrived; the entries start a moment later): the pixels of the areas that will play are asked
   * for NOW - nearest to the view centre first - instead of when each entry is set up (a slice per frame, some of them a second late).
   */
  askPixelsAhead() {
    if ( !this.pixelSource || !this.look.entry || reducedMotion() ) return;
    const pm = perfMode(); if ( pm === "low" ) return;
    const vw = this.view(), cx = (vw.x0 + vw.x1) / 2, cy = (vw.y0 + vw.y1) / 2, ask = this.pixelAsks ??= new Set();
    const list = this.order.filter((g) => (g.shell || g.atlasFree) && this.onScreen(g, pm === "medium" ? 0 : 0.5))
      .map((g) => ({ g, d: Math.hypot((g.info.rect.x0 + g.info.rect.x1) / 2 - cx, (g.info.rect.y0 + g.info.rect.y1) / 2 - cy) })).sort((a, b) => a.d - b.d);
    for ( const q of list ) ask.add(q.g);
    this.stats.askedAhead = (this.stats.askedAhead ?? 0) + list.length;
  }

  /** Asks for the pixels waited for (once per frame), rebuilds atlases (~`budget` ms), starts or gives up the waiting entries. */
  pixelsSlice(now, budget) {
    const A = this.pixelAsks;
    if ( A?.size && this.pixelSource ) {
      const list = [...A].filter((x) => !x.dead && !x.asked); A.clear();
      for ( const x of list ) x.asked = true;
      const given = new Set(), give = (x, px) => {
        if ( given.has(x) || x.dead || !x.atlasFree || !px?.length ) return;
        given.add(x); (this.restoreQ ??= []).push(ArrayBuffer.isView(px) ? { g: x, data: px } : { g: x, sprites: px });
      };
      if ( list.length ) Promise.resolve(this.pixelSource(list, give)).then((got) => {
        for ( const [x, px] of got ?? [] ) give(x, px);
      }, (err) => console.warn("moinen-maps | destruction: pixels for an entry", err)).finally(() => { for ( const x of list ) x.asked = false; });
    }
    // shells' areas from the worker: the ones an entry waits for first
    const SQ = this.swapQ, tS = performance.now();
    if ( SQ?.length ) {
      if ( this.pending?.size && SQ.length > 1 ) SQ.sort((a, b) => (this.pending.has(b.g) ? 1 : 0) - (this.pending.has(a.g) ? 1 : 0));
      while ( SQ.length && performance.now() - tS < (this.pending?.size ? budget * 3 : budget) ) { const { g, x } = SQ.shift(); g.swapAsked = false; this.swapShell(g, x); }
    }
    const Q = this.restoreQ, t0 = performance.now();
    while ( Q?.length && performance.now() - t0 < budget ) {
      const { g, sprites, data } = Q.shift();
      if ( !g.dead && (data ? this.restoreAtlasData(g, data) : this.restoreAtlas(g, sprites)) ) this.stats.restored = (this.stats.restored ?? 0) + 1;
    }
    const P = this.pending; if ( !P?.size ) return;
    let entered = 0;
    for ( const [g, w] of P ) {
      const under = w.opts.under ?? [], all = [g, ...under];
      if ( g.dead || this.groups.get(g.hash) !== g ) { P.delete(g); continue; }
      // (an entry is set up in ~1 ms: the ones whose pixels arrived together go in over the next frames - with what drainEnters took, 8 ms of
      // the tick for all entry set-ups - not all at once; at least one a frame)
      if ( all.every((x) => !x.shell && !x.atlasFree) ) {
        if ( entered && performance.now() - now > enterMs() ) continue;
        entered++; P.delete(g); this.enter(g, { ...w.opts, noWait: true }); this.stats.waitedIn = (this.stats.waitedIn ?? 0) + 1; continue;
      }
      if ( now < w.deadline ) continue;
      // not in time: shown where it lies, fading in (the older look under it goes as usual)
      P.delete(g);
      for ( const u of under ) u.heldBy = null;
      if ( this.look.entry ) { g.fade = { start: now, dur: 280 }; this.applyFade(g, now); }
      this.stats.noPixelEntries = (this.stats.noPixelEntries ?? 0) + 1;
    }
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
    const P = pathTimes(path, k); if ( !P ) return null;
    let wr = 6, cover = 0;
    for ( const p of g.pieces ) { const [d] = P.near(p.sx, p.sy); if ( d + 6 > wr ) wr = Math.min(d + 6, 80); }
    // how far the ruin reaches from the path at most (halo, torn lobes): after the run the discs grow to it, never a square pop
    const r = g.info.rect;
    for ( let x = r.x0; x <= r.x1; x += 6 ) for ( const y of [r.y0, r.y1] ) cover = Math.max(cover, P.near(x, y)[0]);
    for ( let y = r.y0; y <= r.y1; y += 6 ) for ( const x of [r.x0, r.x1] ) cover = Math.max(cover, P.near(x, y)[0]);
    return Object.assign(P, { wr, cover: Math.max(wr, cover + 4) });
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
      // clods of the ground thrown off each rolling explosion, landing close beside the path
      const n = (a.chunkN = (a.chunkN ?? 0) + 1);
      this.chunks(g, a, { count: Math.round(3 * pw), H: [4, 10], seed: n, from: () => [x, y],
        to: (i, h) => { const an = h(4) * 6.283, d = P.wr * (0.5 + 0.9 * h(5)); return [x + Math.cos(an) * d, y + Math.sin(an) * d * 0.8]; } });
    } else if ( type === "scorch" ) {
      // a fire front along the stroke: a few flame tongues spring up at the head and burn down behind it (no ember confetti)
      // (a line of fire behind the head: each tongue burns ~0.8 s, so a dozen stand along the fresh burn)
      {
        const s = side() * 0.7, bx = x - uy * s - ux * 2, by = y + ux * s - uy * 2, gr = this.pixelCanvas(), v = { ap: this.ap, ox: this.origin.x, oy: this.origin.y };
        const h0 = 3 + P.wr * 0.3 * (0.5 + Math.random() * 0.9), w = 3 + ((Math.random() * 3) | 0), ph = Math.random() * 6;
        a.fx.push({ g: gr, kind: "flames", t0: now, dur: 800 * a.k, draw: (t) => { const st = Math.floor(t * 6); pxTongue(gr, v, bx, by, tongueCells(h0 * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) * 0.9), w, ph + st, w)); } });
      }
      if ( Math.random() < 0.15 ) this.spawn({ x, y, vx: 0, vy: 0, rise: -6 - Math.random() * 4, life: 500 + Math.random() * 400, color: Math.random() < 0.5 ? 0xffd04a : 0xff8a24 });
      if ( Math.random() < 0.15 ) this.spawn({ x, y, vx: 0.8, vy: 0, rise: -4, life: 1100, color: 0x4a4440, alpha: 0.55, size: 2 });
    } else if ( type === "flood" ) {
      if ( Math.random() < 0.4 ) { const s = side() * 0.4; this.spawn({ x: x - ux * 4 - uy * s, y: y - uy * 4 + ux * s, vx: ux * 4, vy: uy * 4, life: 300, color: 0xa8d0e8, alpha: 0.8, drag: 3 }); }
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
    // (the old look is gone at the next tick, before the cache looks: its levels and flags are then the ones it last drew, so nothing
    // told it that a band's members are other areas now - it kept drawing the old look, for the GM only: the bands are re-drawn)
    if ( !dur ) { g.cont.alpha = 1; g.fade = null; for ( const u of under ) u.heldBy = g; this.stats.silentSwaps = (this.stats.silentSwaps ?? 0) + 1; this.cache?.invalidate(); return; }
    g.fade = { start: performance.now(), dur };
    this.applyFade(g, performance.now());
    for ( const u of under ) u.heldBy = g;
  }

  /**
   * Everything enters again (Detonate), from each area's own impact. PERF: the entries are set up a slice per frame (~8 ms: areas on
   * screen first), not all in the call - 258 areas of 'map' took ~300 ms before the first frame; each keeps the shared start (one set
   * up a few frames late catches up: its first ~70-200 ms show nothing anyway). `CONFIG.moinenMaps.enterAtOnce = true`: all at once.
   */
  detonate(start) {
    if ( globalThis.CONFIG?.moinenMaps?.enterAtOnce ) { for ( const g of this.order ) this.enter(g, { start }); return; }
    const vw = this.view(), on = (g) => { const r = g.info.rect; return !(r.x0 > vw.x1 || r.y0 > vw.y1 || r.x1 < vw.x0 || r.y1 < vw.y0); };
    const list = this.order.map((g, i) => ({ g, i, on: on(g) })).sort((a, b) => (b.on - a.on) || (a.i - b.i));
    this.enterQueue = new Map(list.map((q) => [q.g, { start }]));
    this.drainEnters(performance.now(), 8);
  }

  /** Set up queued entries (detonate) for up to `budget` ms. */
  drainEnters(t0, budget) {
    const Q = this.enterQueue; if ( !Q?.size ) return;
    budget = Math.min(budget, enterMs());      // (the per-frame budget for entry set-ups: CONFIG.moinenMaps.enterBudget, default 4)
    for ( const [g, o] of Q ) {
      if ( performance.now() - t0 > budget ) return;
      Q.delete(g);
      if ( g.dead || this.groups.get(g.hash) !== g ) continue;
      this.enter(g, o);
    }
  }

  endAnim(g) {
    const a = g.anim; if ( !a ) return;
    g.anim = null;
    collapseEnd(this, g, a);
    // nothing of the entry floats on: its chunks are down (the staying ones shown), its particles end within 300 ms
    this.debris?.endArea(g);
    { const t = performance.now(); for ( const q of this.particles ) if ( q.g === g ) q.life = Math.min(q.life, t - q.born + 300); }
    if ( !g.dead ) g.reflatAt = performance.now() + 900;    // back to one sprite after the cache has settled (static-cache SETTLE_MS)
    if ( a.rev ) {
      // the ruin in full: back to its frame of the atlas
      if ( g.baseSpr && !g.baseSpr.destroyed ) { const t = g.baseSpr.texture; g.baseSpr.texture = a.rev.frame; if ( !a.rev.rt ) t.destroy(false); if ( !g.batch?.folded ) g.baseSpr.renderable = true; }
      if ( a.rev.rt ) this.gpuErode?.release(a.rev.rt); else a.rev.tex.destroy();
      a.rev.time?.destroy(); a.rev.time = null;
    }
    if ( a.crev ) {
      const pm = g.patch?.children?.[1];
      if ( pm && !pm.destroyed ) { const t = pm.texture; pm.texture = a.crev.frame; if ( !a.crev.rt ) t.destroy(false); }
      if ( g.patch && !g.patch.destroyed ) g.patch.renderable = true;
      if ( a.crev.rt ) this.gpuErode?.release(a.crev.rt); else a.crev.tex.destroy();
      a.crev.time?.destroy(); a.crev.time = null;
    }
    for ( const f of a.fx ) if ( !f.g.destroyed ) f.g.destroy();
    if ( g.batch?.gpu ) g.batch.setRest();      // (GPU pieces: all at rest)
    else for ( const p of g.pieces ) { p.fading = false; if ( !p.spr || p.spr.destroyed ) continue; this.place(p, 2, null, g.info.type); p.spr.alpha = 1; p.spr.tint = 0xFFFFFF; }
    if ( g.baseCont && !g.baseCont.destroyed ) g.baseCont.position.set(0, 0);
    g.shardCont.position.set(0, 0);
  }

  /**
   * Erode the ruin up to `now`: every pixel whose moment has come is copied in; a few of them shed the type's particles, so the
   * dissolving edge itself carries the dust, embers, spray or sparks. One upload per frame, only while something changed.
   */
  erode(g, a, now, onScreen, maxPx = Infinity) {
    if ( a.crev?.gpu ) this.coverGpu(g, a, now);
    else if ( a.crev ) { this.stepDissolve(a.crev, now - a.start); if ( a.crev.shown && g.patch && !g.patch.renderable ) g.patch.renderable = true; }
    const R = a.rev;
    if ( R?.gpu ) return this.erodeGpu(g, a, R, now, onScreen);
    if ( !R || !R.keys || R.next >= R.keys.length ) return;
    // the FRONT's signature: a pixel passes through the kind's stages before it settles (FRONT below): burning pixels flare
    // yellow, glow orange and cool to char; water arrives as foam; a cave-in darkens as it sinks; a blast scorches pale-hot. Every
    // stage is a cursor over the same sorted clock, so the stages trail the front as bands of a fixed width in time
    const S = R.stages, keys = R.keys, buf = R.buf, data = R.data, el = now - a.start, last = S.length - 1;
    const every = Math.max(9, Math.round(keys.length / 140)), shedMax = a.type === "scorch" ? 2 : a.type === "flood" ? 1 : 4;
    // PERF: every stage's new cursor first (binary search), then each pixel written ONCE with the colour of the latest stage it
    // reached - the last stage first, an earlier stage only for pixels a later one did not reach this frame (a clock that comes in
    // late caught up through every stage of every pixel; same pixels as stage by stage)
    let n = 0, shed = 0, lo = Infinity, hi = -1, cx0 = Infinity, cx1 = -1;
    const nc = R.nc ??= new Float64Array(S.length), N = keys.length, W = R.w;
    // PERF: at most `maxPx` pixels newly reached this frame (the display's per-frame budget, shared by the eroding areas): when more
    // are due - a whole-scene Detonate, a clock that came in late - the ruin is shown as it was a few ms earlier and catches up over
    // the next frames instead of one long frame
    let elE = el;
    const tms = R.tms, CK = { ix: keys, tm: tms };
    if ( R.cur[0] + maxPx < N && tms[R.cur[0] + maxPx] * 1048576 + keys[R.cur[0] + maxPx] < (Math.max(0, el - S[0].dt) + 1) * 1048576 ) {
      elE = Math.min(el, Math.max((R.elDone ?? -1) + 1, tms[R.cur[0] + maxPx] - 1 + S[0].dt));
      this.stats.erodeLag = (this.stats.erodeLag ?? 0) + 1;
    }
    R.elDone = elE;
    for ( let s = 0; s <= last; s++ ) {
      const lim = (Math.max(0, elE - S[s].dt) + 1) * 1048576;
      nc[s] = clockUpper(CK, R.cur[s], lim);
    }
    for ( let s = last; s >= 0; s-- ) {
      const st = S[s].col, L = S[s].mix ? (S[s].lut ??= lutOf(S[s].mix)) : null, to = nc[s], from = s < last ? Math.max(R.cur[s], nc[s + 1]) : R.cur[s];
      if ( L ) {
        // (a constant mix: the three channels out of look-up tables - the values mixP gives, without the closure calls)
        const L0 = L[0], L1 = L[1], L2 = L[2];
        for ( let j = from; j < to; j++ ) {
          const i = keys[j], q = i * 4, cx = i % W;
          if ( i < lo ) lo = i; if ( i > hi ) hi = i; if ( cx < cx0 ) cx0 = cx; if ( cx > cx1 ) cx1 = cx;
          if ( data[q + 3] === 255 ) { buf[q] = L0[data[q]]; buf[q + 1] = L1[data[q + 1]]; buf[q + 2] = L2[data[q + 2]]; buf[q + 3] = 255; }
          else { buf[q] = data[q]; buf[q + 1] = data[q + 1]; buf[q + 2] = data[q + 2]; buf[q + 3] = data[q + 3]; }
        }
        n += to - from > 0 ? to - from : 0;
        continue;
      }
      if ( !st && !(data.byteOffset & 3) && !(buf.byteOffset & 3) ) {
        // (the settled colour: a pixel is one 32-bit copy)
        const d32 = R.d32 ??= new Uint32Array(data.buffer, data.byteOffset, data.length >> 2), b32 = R.b32 ??= new Uint32Array(buf.buffer, buf.byteOffset, buf.length >> 2);
        for ( let j = from; j < to; j++ ) {
          const i = keys[j], cx = i % W;
          if ( i < lo ) lo = i; if ( i > hi ) hi = i; if ( cx < cx0 ) cx0 = cx; if ( cx > cx1 ) cx1 = cx;
          b32[i] = d32[i];
        }
        n += to - from > 0 ? to - from : 0;
        continue;
      }
      for ( let j = from; j < to; j++ ) {
        const i = keys[j], q = i * 4, cx = i % W;
        if ( i < lo ) lo = i; if ( i > hi ) hi = i; if ( cx < cx0 ) cx0 = cx; if ( cx > cx1 ) cx1 = cx;
        if ( st && data[q + 3] === 255 ) { const c = st(data[q], data[q + 1], data[q + 2], i); buf[q] = c >> 16; buf[q + 1] = (c >> 8) & 255; buf[q + 2] = c & 255; buf[q + 3] = 255; }
        else { buf[q] = data[q]; buf[q + 1] = data[q + 1]; buf[q + 2] = data[q + 2]; buf[q + 3] = data[q + 3]; }
        n++;
      }
    }
    // the edge's particles: pixels passing the first stage at every `every`-th place of the clock (as before)
    if ( onScreen ) for ( let j = Math.ceil(R.cur[0] / every) * every; j < nc[0] && shed < shedMax; j += every ) {
      shed++; const i = keys[j]; this.edgeParticle(g, a, g.info.x + (i % R.w), g.info.y + Math.floor(i / R.w), now);
    }
    for ( let s = 0; s <= last; s++ ) R.cur[s] = nc[s];
    R.next = R.cur[last];
    // (the upload of the pixels just written: a1e829c returned before it - the ruin was never drawn while it eroded, it appeared whole at the end)
    if ( n ) {
      R.tex.resource.mark?.(Math.floor(lo / W), Math.floor(hi / W), cx0, cx1); R.tex.update();
      if ( !R.shown ) { R.shown = true; if ( g.baseSpr && !g.batch?.folded ) g.baseSpr.renderable = true; }
    }
    return n;
  }

  /** The GPU erode's stage tables (erode-gpu.mjs) for a stage list, or null: the entry takes the CPU path. */
  gpuStages(stages) {
    if ( !ErodeGPU.supported(canvas.app?.renderer) || stages.length > MAX_STAGES ) return null;
    const E = this.gpuErode ??= new ErodeGPU(), n = stages.length;
    const H = new Int32Array(MAX_STAGES * 4), A = new Float32Array(MAX_STAGES * 4), B = new Float32Array(MAX_STAGES * 4);
    for ( let s = 0; s < n; s++ ) {
      const st = stages[s], o = s * 4;
      if ( s === n - 1 ) { if ( st.col || st.mix ) return null; continue; }      // (the last stage is the pixel's own colour)
      if ( st.mix ) { const row = E.rowOf(st.mix, lutOf); if ( row < 0 ) return null; H[o] = 0; H[o + 1] = row; }
      else if ( st.hash ) {
        const [salt, thr, a, b] = st.hash;
        H[o] = 1; H[o + 2] = salt; H[o + 3] = Math.ceil(thr * 4294967296) | 0;
        A[o] = (a >> 16) & 255; A[o + 1] = (a >> 8) & 255; A[o + 2] = a & 255; B[o] = (b >> 16) & 255; B[o + 1] = (b >> 8) & 255; B[o + 2] = b & 255;
      } else return null;
    }
    return { n, H, A, B };
  }

  /**
   * One GPU erode pass for a ruin (or a cover): its render texture filled for the stages at R.el. Not before the area's atlas is on the
   * GPU (uploadAhead sends them a few a frame; a pass would upload it all at once) - true when it drew.
   */
  gpuFill(g, R, fr) {
    const rd = canvas.app?.renderer, tex = g.tex;
    if ( !rd || !R.time || !tex || tex.destroyed || !R.rt || R.rt.destroyed ) return false;
    if ( tex._glTextures?.[rd.CONTEXT_UID]?.dirtyId !== tex.dirtyId && g.batch && !g.batch.destroyed && (R.waitN = (R.waitN | 0) + 1) < 90 ) return false;
    const S = R.stages, lim = R.lim ??= new Float32Array(MAX_STAGES * 4);
    for ( let s = 0; s < S.length; s++ ) {
      // the CPU's test: sort key (moment * 2^20 + pixel) below (max(0, el - dt) + 1) * 2^20, as a whole moment and a fraction of a moment
      const Y = Math.max(0, R.el - S[s].dt) + 1, T = Math.floor(Y);
      lim[s * 4] = T; lim[s * 4 + 1] = (Y - T) * 1048576;
    }
    this.gpuErode.pass(rd, R.rt, R.gpu, lim, tex, fr, R.time);
    this.stats.gpuErodes = (this.stats.gpuErodes ?? 0) + 1;
    return true;
  }

  /** The cover's dissolve on the GPU (the same clock and pass as the ruin's, one stage). */
  coverGpu(g, a, now) {
    const D = a.crev;
    if ( D.epoch !== this.gpuErode.epoch ) { D.epoch = this.gpuErode.epoch; if ( D.next ) { D.dirty = true; D.el = now - a.start; } }
    if ( D.keys && D.next < D.keys.length ) {
      const rel = now - a.start, nx = clockUpper({ ix: D.keys, tm: D.tms }, D.next, (Math.max(0, rel) + 1) * 1048576);
      D.el = rel;
      if ( nx !== D.next ) { D.next = nx; D.dirty = true; }
    }
    if ( D.dirty && this.gpuFill(g, D, D.fr) ) { D.dirty = false; D.shown = true; }
    if ( D.shown && g.patch && !g.patch.renderable ) g.patch.renderable = true;
  }

  /**
   * Erode the ruin on the GPU: only the cursors move here (binary searches over the sorted clock: the edge's particles and the entry's
   * end need them); the pixels are the pass's (gpuFill). Pixels are shown at the moment they are due - there is no catching-up budget.
   */
  erodeGpu(g, a, R, now, onScreen) {
    if ( !R.keys ) return 0;
    if ( R.epoch !== this.gpuErode.epoch ) { R.epoch = this.gpuErode.epoch; if ( R.next ) R.dirty = true; }     // (a lost context: filled again)
    const S = R.stages, last = S.length - 1, N = R.keys.length, el = now - a.start;
    if ( R.next < N ) {
      const keys = R.keys, nc = R.nc ??= new Float64Array(S.length), CK = { ix: keys, tm: R.tms };
      const every = Math.max(9, Math.round(N / 140)), shedMax = a.type === "scorch" ? 2 : a.type === "flood" ? 1 : 4;
      let moved = false, shed = 0;
      for ( let s = 0; s <= last; s++ ) { nc[s] = clockUpper(CK, R.cur[s], (Math.max(0, el - S[s].dt) + 1) * 1048576); if ( nc[s] !== R.cur[s] ) moved = true; }
      // the edge's particles: pixels passing the first stage at every `every`-th place of the clock (as the CPU path)
      if ( onScreen ) for ( let j = Math.ceil(R.cur[0] / every) * every; j < nc[0] && shed < shedMax; j += every ) {
        shed++; const i = keys[j]; this.edgeParticle(g, a, g.info.x + (i % R.w), g.info.y + Math.floor(i / R.w), now);
      }
      for ( let s = 0; s <= last; s++ ) R.cur[s] = nc[s];
      R.next = R.cur[last];
      if ( moved ) R.dirty = true;
    }
    if ( R.dirty ) {
      R.el = el;
      if ( this.gpuFill(g, R, R.frame.frame) ) {
        R.dirty = false;
        if ( !R.shown ) { R.shown = true; if ( g.baseSpr && !g.batch?.folded ) g.baseSpr.renderable = true; }
      }
    }
    return 0;
  }

  /** What the dissolving edge sheds, by type. */
  edgeParticle(g, a, x, y, now) {
    if ( a.cl && Math.random() < a.cl.share ) return Cause.causeParticle(this, a.cl, x, y, a.k);   // the cause's share of the edge
    const t = a.type, j = () => (Math.random() - 0.5);
    if ( t === "scorch" ) this.spawn({ x, y, vx: j() * 2, vy: 0, rise: -4 - Math.random() * 4, life: 350 + Math.random() * 300, color: Math.random() < 0.5 ? 0xd2401c : 0xff8a24 });
    else if ( t === "flood" ) this.spawn({ x, y, vx: j() * 2, vy: -0.5, life: 260, color: 0xb8d8f0, alpha: 0.75, drag: 3 });
    else if ( t === "gash" ) tearEdge(this, g, x, y);
    else if ( t === "cracks" ) { /* (no floating specks) */ }
    else if ( t === "collapse" ) this.spawn({ x, y, vx: j() * 2, vy: 0, rise: -7, life: 700, color: 0xb9ae9e, alpha: 0.75, size: Math.random() < 0.3 ? 2 : 1 });
    else this.spawn({ x, y, vx: j() * 8, vy: -2 - Math.random() * 3, rise: -4, life: 520, color: Math.random() < 0.5 ? this.tone(g, 2, 0xa8977c) : this.tone(g, 3, 0x7c6c58), alpha: 0.8, drag: 2.4, size: 2 });   // grains of the ground, no pale flecks
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
    if ( a.coll ) { collapsePlace(this, p, t, a); if ( s.visible && !this.inScene(s.x, s.y) ) s.visible = false; return; }
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
  pixelCanvas() {
    // batched (piece-batch.mjs RectLayer: one geometry for every accent's art pixels); `noBatchRender`: pooled sprites (A/B)
    const c = batchOn() ? new RectCanvas(this.rects ??= this.fx.addChild(new RectLayer())) : new PixelCanvas(this.fx, this.pxPool ??= []);
    c.clip = this.sceneRect(); c.stats = this.stats; return c;
  }

  /**
   * The sprite path's pooled pixel sprites (noBatchRender) stay children of the fx layer; a whole-scene Detonate left ~0.8 M of them
   * there, walked by the scene graph every frame at rest. Once nothing enters, the pool is cut to 4096 (one O(n) rebuild of the list).
   */
  trimPixelPool() {
    const P = this.pxPool; if ( !P || P.length <= 4096 || this.order.some((g) => g.anim) ) return;
    const drop = new Set(P.splice(4096));
    const keep = this.fx.children.filter((c) => !drop.has(c));
    this.fx.removeChildren();
    for ( const s of drop ) if ( !s.destroyed ) s.destroy();
    if ( keep.length ) this.fx.addChild(...keep);
  }

  /** The scene's rectangle (canvas px): nothing runtime is drawn past it (debris may leave the map, it is not rendered there). */
  sceneRect() { const r = canvas.dimensions?.sceneRect; return r ? { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height } : null; }
  inScene(x, y) { const r = this._sr ??= this.sceneRect(); return !r || (x >= r.x0 && y >= r.y0 && x < r.x1 && y < r.y1); }

  /** Is an area (with room for its debris) in the current view, grown by `m` of its size on every side? */
  onScreen(g, m = 0) {
    const vw = this.view(), r = g.info.rect, mx = (vw.x1 - vw.x0) * m, my = (vw.y1 - vw.y0) * m;
    return !(r.x0 > vw.x1 + mx || r.y0 > vw.y1 + my || r.x1 < vw.x0 - mx || r.y1 < vw.y0 - my);
  }

  spawn(q) {
    if ( this.particles.length > particleCap() ) return;
    this.stats.spawned = (this.stats.spawned ?? 0) + 1;
    if ( !this.inScene(this.origin.x + q.x * this.ap, this.origin.y + q.y * this.ap) ) { this.stats.culled = (this.stats.culled ?? 0) + 1; return; }
    let s = this.pool.pop();
    if ( !s || s.destroyed ) { s = new PIXI.Sprite(PIXI.Texture.WHITE); s.eventMode = "none"; this.fx.addChild(s); }
    s.visible = true; s.tint = q.color; s.alpha = q.alpha ?? 1;
    // a few pixel sprites instead of one square: specks, grains, crumbs, puffs (art pixels, nearest)
    const sh = this.shapes ??= makeShapes(), size = q.size ?? 1, r = Math.random();
    s.texture = q.shape ? sh[q.shape] : size >= 3 ? (r < 0.5 ? sh.puff : sh.chunk) : size === 2 ? (r < 0.4 ? sh.sq : r < 0.7 ? sh.crumb : sh.diag) : (r < 0.8 ? sh.dot : sh.crumb);
    s.anchor.set(0); s.scale.set(this.ap);
    q.spr = s; q.born ??= performance.now(); q.g ??= this._owner;
    this.particles.push(q);
  }

  burst(x, y, R, start, { n = 14 + Math.min(18, R), color = 0xcfc6b8, rise = -6, speed = 1 } = {}) {
    for ( let k = 0; k < n; k++ ) {
      // uneven: random directions and a wide spread of speeds, so the dust is a cloud with a ragged front, never a neat ring of specks
      const a = Math.random() * Math.PI * 2, sp = (R * 0.6 + 4) * (0.25 + Math.random() * 1.05) * speed;
      this.spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 - 2, life: 650 + Math.random() * 300, color, alpha: 0.85, size: 2, born: start, drag: 2.6, rise });   // puffs, never 1-px flecks
    }
  }

  /** Throw chunks of an area during its entry (debris.mjs spawnChunks): from its impact unless `from` says otherwise, scaled by power. */
  chunks(g, a, o = {}) {
    if ( !g.chunks ) return 0;
    return this.debris.spawnChunks({ area: g, origin: [a.ox, a.oy], start: performance.now(), speed: Math.sqrt(a.pw || 1), ...o, delay: o.delay ?? [0, 40 * a.k], seed: (o.seed ?? 0) * 977 + (a.seed | 0) });
  }

  /** A tone of the area's own ground (its chunk set's palette: 0 glint, 1 light, 2 mid, 3 dark), else `def`. */
  tone(g, i, def) { return g.chunks?.tone?.[i] ?? def; }

  /** Up to `n` points on the area's fissures (dark pixels of its ruin), seeded. */
  fissures(g, a, n, seed) {
    const d = a.rev?.data, w = g.info.w, h = g.info.h, out = [];
    if ( !d || !n ) return out;
    for ( let t = 0; t < n * 40 && out.length < n; t++ ) {
      const x = (hash2(seed | 0, t, 41) * w) | 0, y = (hash2(seed | 0, t, 42) * h) | 0, q = (y * w + x) * 4;
      if ( d[q + 3] === 255 && d[q] + d[q + 1] + d[q + 2] < 150 ) out.push([g.info.x + x, g.info.y + y]);
    }
    return out;
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
    this._fxSpent = 0;       // ms the entries' one-shot effects have taken in this frame (effects: once)
    this._fxDrawn = 0; this._frameNo = (this._frameNo | 0) + 1;   // ms the effects' redraws have taken in this frame (effects: FX_DRAW_MS)
    // sampling: crisp when an art pixel covers 3+ screen pixels; below that NEAREST shimmers while zooming and panning (an art pixel
    // flips between 1 and 2 screen pixels), so it is LINEAR + mipmaps there
    // (SCREEN pixels: device pixels, the renderer's resolution included - the cache's tiles (static-cache.mjs) count them that way, and a
    // live layer that counted CSS pixels stayed LINEAR-blurred where the cache already drew crisp texels: 6-11 % crisper at 125-200 % DPR)
    const z = canvas.stage.scale.x * this.ap * (canvas.app.renderer.resolution || 1);
    const want = this.filter === NEAREST ? (z < 2.6 ? LINEAR : NEAREST) : (z > 3 ? NEAREST : LINEAR);
    if ( want !== this.filter ) { this.filter = want; for ( const g of this.groups.values() ) { g.tex.scaleMode = want; if ( g.flatTex ) g.flatTex.baseTexture.scaleMode = want; if ( g.coverTex ) g.coverTex.baseTexture.scaleMode = want; } }
    const vw = this.view();
    if ( this.swapQ?.length && !(this.pending?.size || this.pixelAsks?.size || this.restoreQ?.length) ) this.pixelsSlice(t0, 4);   // (shells' areas from the worker, swapShell)
    const T = this.stats.parts ??= {}; let tp = performance.now();
    const lap = (k) => { const t = performance.now(); T[k] = t - tp; tp = t; };   // (the tick's parts, ms: stats.parts)
    lap("pre");
    // entering areas first and faster (a flattened area makes its shards when it enters: they must exist before the front reaches them)
    // (batched pieces cost a few array writes each: many more per frame)
    const bat = batchOn();
    let budget = bat ? 4000 : 350;
    const need = this.order.filter((g) => g.anim && g.made < g.pieces.length);
    if ( need.length ) {
      budget = bat ? 30000 : 2500;
      const share = Math.max(40, Math.floor(budget / need.length));     // every entering area its earliest pieces first
      for ( const g of need ) if ( budget > 0 ) budget -= this.materialize(g, Math.min(share, budget));
      for ( const g of need ) if ( budget > 0 ) budget -= this.materialize(g, budget);
    }
    for ( const g of this.order ) if ( budget > 0 && g.made < g.pieces.length ) budget -= this.materialize(g, budget);
    lap("materialize");
    if ( this.enterQueue?.size ) this.drainEnters(t0, 8);
    if ( this.pending?.size || this.pixelAsks?.size || this.restoreQ?.length ) this.pixelsSlice(t0, 4);
    lap("enter");
    if ( bat ) this.uploadAhead(t0, vw);
    if ( this.clocks.length ) this.clockSlice(6, vw);
    lap("clocks");
    // rim lights: a little per frame by day, more in a dark scene (where they show)
    if ( this.rimQueue?.length ) this.rimSlice((canvas.environment?.darknessLevel ?? 0) >= 0.45 ? 8 : 3, vw);
    this.reflatten(t0);
    lap("reflatten");
    this._erodeLeft = globalThis.CONFIG?.moinenMaps?.erodeBudget ?? 50000;   // pixels the eroding ruins may take in this frame
    for ( const g of this.order ) {
      if ( g.fade ) this.applyFade(g, t0);
      if ( g.anim ) this.animate(g, t0, vw);
    }
    lap("animate");
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
    lap("erase+dying");
    this.trimPixelPool();
    this.idleTick(t0, vw);
    this.prepSlice(t0);
    lap("idle");
    Cause.tickLights(this, t0);
    lap("lights");
    this.debris.tick(t0, vw);
    lap("debris");
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
    lap("particles");
    const tc = performance.now();
    this.cache?.update();
    this.stats.cacheMs = performance.now() - tc;
    this.stats.frameMs = performance.now() - t0;
  }

  /**
   * PERF: the atlases of entering areas go to the GPU a few per frame (~3 ms; at least one), on-screen areas and the earliest pieces
   * first - drawn on demand, a Detonate uploaded every atlas (~65 MPx) in its first frame. A piece whose atlas is not there yet waits
   * (piece-batch.mjs); a single entry's atlas goes up in its first frame. `CONFIG.moinenMaps.atlasNow = true`: on demand (A/B).
   */
  uploadAhead(t0, vw) {
    const R = canvas.app?.renderer; if ( !R?.texture ) return;
    let list = null;
    for ( const g of this.order ) {
      const b = g.batch; if ( !g.anim || !b || b.destroyed || b.atlasReady(R) ) continue;
      (list ??= []).push(g);
    }
    if ( !list ) return;
    const on = (g) => { const r = g.info.rect; return !(r.x0 > vw.x1 || r.y0 > vw.y1 || r.x1 < vw.x0 || r.y1 < vw.y0); };
    const first = (g) => { const a = g.anim, it = a.startOrder ? a.list[a.startOrder[0]] : null; return it ? it.t0 - it.pre : a.start; };
    list.sort((a, b) => (on(b) - on(a)) || (first(a) - first(b)));
    const ts = performance.now(), rate = this._upRate ??= 0.9;     // (ms per MB of atlas, learned: one upload cannot be cut, so none is begun that would pass the budget)
    let n = 0;
    for ( const g of list ) {
      const spent = performance.now() - ts, mb = g.tex.width * g.tex.height * 4 / 1048576;
      if ( spent > 3 || (n && spent + mb * this._upRate > 3 && !globalThis.CONFIG?.moinenMaps?.noUploadModel) ) break;
      R.texture.bind(g.tex, 0); n++;
      const dt = performance.now() - ts - spent;
      if ( mb > 0.5 ) this._upRate = Math.max(0.2, Math.min(3, this._upRate * 0.7 + (dt / mb) * 0.3));
      this.stats.atlasAhead = (this.stats.atlasAhead ?? 0) + 1;
    }
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
    const el = now - a.start, ap = this.ap, PR = this._prof, tq = PR ? performance.now() : 0;
    this._owner = g;
    if ( onScreen ) {
      this._erodeLeft = Math.max(0, this._erodeLeft - (this.erode(g, a, now, onScreen, Math.max(4000, this._erodeLeft)) ?? 0));
    }   // off screen nothing is uploaded; back on screen it catches up, or endAnim shows it whole
    // collapse: the ground trembles before it gives
    if ( type === "collapse" ) {
      const j = el < a.delay ? (((Math.floor(el / 45) & 1) ? 1 : -1) * ap) : 0;
      g.shardCont.position.set(j, 0); g.baseCont.position.set(j, 0);
    }
    this._owner = g;    // what the entry spawns is its own (endAnim ends it)
    if ( a.gpu && g.batch?.gpu ) g.batch.setClock(now);
    const t1 = PR ? performance.now() : 0;
    const busy = a.gpu ? this.livesGpu(a, now, onScreen, type) : a.tear && globalThis.CONFIG?.moinenMaps?.noTearWindow ? this.livesAll(a, now, onScreen, type) : this.livesActive(a, now, onScreen, type);
    const t2 = PR ? performance.now() : 0;
    if ( onScreen ) this.effects(g, a, now, el);
    const t3 = PR ? performance.now() : 0;
    if ( a.cl ) Cause.causeEffects(this, g, a, now, el);
    if ( PR ) { const t4 = performance.now(); PR.erode += t1 - tq; PR.lives += t2 - t1; PR.effects += t3 - t2; PR.cause += t4 - t3; }
    this._owner = null;
    if ( !busy && (!a.rev || (a.rev.keys && a.rev.next >= a.rev.keys.length)) && (!a.crev || (a.crev.keys && a.crev.next >= a.crev.keys.length)) && !a.fx.length && !this.debris.busy(g) ) this.endAnim(g);
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

  /**
   * A burn's flame tongues at `el` ms of their life `life`: the outer ring rides the front out to the burn's reach and stands there,
   * the inner ring burns behind it and dies first; each tongue's height flickers in steps (a new pose every ~70 ms), the whole fire
   * dies down after the front. Embers leave the hottest tips (varied size and colour, short lives that end before the settle), wisps of
   * smoke the dying ones.
   */
  /**
   * Heat shimmer: a few one-row strips of the scene's own background map just above the burnt area (above its whole rectangle, so
   * nothing of the soot is covered), each copied 1 art px off its place in a slow wave of its own; on for ~1.2 s and fading. Cheap: four
   * sprites sharing the background texture, made once per burn; none in Low performance or with reduced motion.
   */
  shimmer(a, g, R) {
    if ( reducedMotion() || perfMode() === "low" ) return;
    const tex = canvas.primary?.background?.texture, sr = canvas.dimensions?.sceneRect;
    if ( !tex?.valid || !sr ) return;
    const ap = this.ap, o = this.origin, top = g.info.rect.y0 - 1, w = Math.round(R * 1.3), x0 = Math.round(a.ox - w / 2), rows = [];
    for ( let k = 0; k < 4; k++ ) {
      const y = top - k * 2, cx = o.x + x0 * ap, cy = o.y + y * ap;
      const tx = (cx - sr.x) * tex.width / sr.width, ty = (cy - sr.y) * tex.height / sr.height, tw = w * ap * tex.width / sr.width, th = ap * tex.height / sr.height;
      if ( tx < 0 || ty < 0 || tx + tw > tex.width || ty + th > tex.height ) continue;
      const s = new PIXI.Sprite(new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle(tx, ty, tw, th)));
      s.eventMode = "none"; s.position.set(cx, cy); s.width = w * ap; s.height = ap; s.visible = false;
      this.fx.addChild(s); rows.push({ s, cx, k });
    }
    if ( !rows.length ) return;
    const holder = { destroyed: false, clear() {}, destroy() { if ( this.destroyed ) return; this.destroyed = true; for ( const r of rows ) if ( !r.s.destroyed ) r.s.destroy({ texture: true }); } };
    a.fx.push({ g: holder, kind: "shimmer", t0: a.start + a.delay + 120 * a.k, dur: 1200 * a.k, draw: (t) => {
      const step = Math.floor(t * 1200 / 90);
      for ( const r of rows ) {
        // one art pixel left or right, a wave rising through the rows; thinning out as it fades
        const dx = Math.round(Math.sin(step * 0.9 - r.k * 1.3)) * ap;
        r.s.visible = dx !== 0 && (t < 0.7 || ((step + r.k) & 1) === 0);
        r.s.x = r.cx + dx;
      }
    } });
  }

  flames(gr, a, T, el, life, R) {
    const v = { ap: this.ap, ox: this.origin.x, oy: this.origin.y }, k = a.k, now = a.start + a.delay + el;
    // (the tongues stand inside the charred disc: past ~0.7 of the reach they burnt on the unburnt grass)
    const reach = Math.max(4, R * 0.7);
    const fadeOut = el < a.reveal ? 1 : clamp01(1 - (el - a.reveal) / Math.max(1, life - a.reveal));
    for ( const tg of T ) {
      const lag = tg.lag * 140 * k, tf = clamp01((el - lag) / a.reveal);
      if ( el < lag ) continue;
      let rr = Math.min(reach, a.Rmax * easeOut(tf)), s = fadeOut;
      if ( tg.inner ) { rr *= 0.55; s *= clamp01(1.4 - tf * 1.2); }
      s *= clamp01(el / (90 * k));
      if ( s < 0.08 ) continue;
      const step = Math.floor((el + (tg.off ?? 0)) / (70 * k));
      const fl = 0.8 + 0.35 * hash2(step, tg.ang * 100, 7), h = (3 + R * 0.2) * tg.h * s * fl * (tg.inner ? 0.65 : 1), w = Math.max(2, Math.round(tg.w * Math.sqrt(s)));
      if ( h < 1.5 ) continue;
      const bx = a.ox + Math.cos(tg.ang) * rr, by = a.oy + Math.sin(tg.ang) * rr * 0.85;
      // (step: this tongue's own pose clock; each one mirrored or not and leaning its own way - never twenty stamps of one sprite)
      const tc = tongueCells(h, w, tg.ph + step * 0.9, tg.w).map(([x, y, q]) => [(tg.flip ? -x : x) + Math.round(-y * tg.lean), y, tg.h < 0.9 ? Math.max(q, 1) : q]);
      pxTongue(gr, v, bx, by, tc);
      // embers from the hot tips, smoke from the dying tongues (none that would outlive the entry)
      const left = a.end - now - 80;
      if ( left > 200 && s > 0.45 && Math.random() < 0.05 ) {
        const big = Math.random() < 0.18, c = [0xfff0a0, 0xffd04a, 0xff8a24, 0xd2401c][(Math.random() * 4) | 0];
        this.spawn({ x: bx + (Math.random() - 0.5) * 2, y: by - h, vx: (Math.random() - 0.5) * 3, vy: 0, rise: -6 - Math.random() * 6, life: Math.min(left, 350 + Math.random() * 550), color: c, size: big ? 2 : 1, flicker: big });
      }
      if ( left > 400 && s < 0.6 && Math.random() < 0.03 ) this.spawn({ x: bx, y: by - h - 1, vx: 1 + Math.random(), vy: 0, rise: -4 - Math.random() * 2, life: Math.min(left, 900), color: 0x4a4440, alpha: 0.55, size: 2 });
    }
  }

  dust(it, type) {
    it.dusted = true;
    if ( it.p.thrown ) for ( let q = 0; q < 2; q++ ) this.spawn({ x: it.p.fx + (Math.random() - 0.5) * 3, y: it.p.fy + 1, vx: (Math.random() - 0.5) * 6, vy: -1 - Math.random() * 2, life: 380, color: 0xb0a28a, alpha: 0.7, drag: 3, size: 2 });   // a puff where it lands
    else if ( type === "cracks" && Math.random() < 0.3 ) this.spawn({ x: it.p.fx, y: it.p.fy, vx: (Math.random() - 0.5) * 4, vy: -1, rise: -3, life: 500, color: 0xc8beb0, alpha: 0.7 });
  }

  /** Every piece, every frame (the tear's former way: `CONFIG.moinenMaps.noTearWindow`). True while some piece still moves. */
  livesAll(a, now, onScreen, type) {
    let busy = false;
    for ( const it of a.list ) {
      const t = (now - it.t0) / it.dur;
      this.life(it, a, t, onScreen, type);
      if ( t < 1 + 400 / it.dur ) busy = true;
      if ( onScreen && t >= 1 && !it.dusted ) this.dust(it, type);
    }
    if ( this.snapQ?.length ) this.flushSnaps();
    return busy;
  }

  /** The flecks of the tear's fibres that snapped while the area was posed (tearPlace), spawned in the order of the pieces. */
  flushSnaps() {
    const Q = this.snapQ; this.snapQ = null;
    if ( Q.length > 1 ) Q.sort((x, y) => x.seed - y.seed);
    for ( const it of Q ) tearSnap(this, it.p, it);
  }

  /** Can an entry's pieces move on the GPU (piece-gpu.mjs)? */
  gpuPieces(g, own = false) {
    if ( own && globalThis.CONFIG?.moinenMaps?.noGpuTearColl ) return false;      // (a tear's and a cave-in's pieces: the CPU poses)
    return batchOn() && !globalThis.CONFIG?.moinenMaps?.noGpuPieces && !!g.atlas && !!g.tex && gpuPiecesSupported(canvas.app?.renderer);
  }

  /** The area's pieces become instances of a GPU batch (their numbers uploaded once); the entry's clock drives them. */
  gpuEnter(g, a, mode = "plain") {
    const N = g.pieces.length;
    let b = g.batch;
    if ( b && !b.destroyed && (!b.gpu || b.mode !== mode) ) { this.release(g); b = null; }
    if ( !b || b.destroyed ) {
      b = g.batch = new GpuPieceBatch(N, g.tex, g.atlas, g.baseSpr, mode); g.bmode = "batch"; g.shardCont.addChildAt(b, 0);
      b.baseBlank = () => { const R = g.anim?.rev; return !!R && !R.shown && g.baseSpr?._texture?.baseTexture === R.tex; };
    }
    b.load(this, g, a);
    for ( const p of g.pieces ) p.spr = STUB;
    g.made = N; g.madeIdx = []; a.gpu = true;
    b.setClock(performance.now());
  }

  /** Back to CPU-posed pieces (an older look caught by a newer front, or an entry that is not a plain one): made again, at rest. */
  downGpu(g) {
    if ( !g.batch?.gpu ) return;
    const a = g.anim;
    this.release(g);
    g.made = 0; g.sheetCur = 0; g.madeIdx = [];
    if ( a ) { a.gpu = false; a.matCur = 0; a.byStart = null; }
    this.materialize(g, Infinity);
  }

  /**
   * GPU pieces: nothing to pose. Only what the CPU still does when a piece lands: its puff of dust (thrown pieces; cracks' specks), in
   * the order livesActive would have called it (by the moment a piece's life begins).
   */
  livesGpu(a, now, onScreen, type) {
    if ( !a.gl ) {
      const L = a.list, idx = [];
      for ( let k = 0; k < L.length; k++ ) if ( L[k].p.thrown || type === "cracks" ) idx.push(k);
      idx.sort((x, y) => (L[x].t0 + L[x].dur) - (L[y].t0 + L[y].dur));
      a.startOrder ??= startOrderOf(L);
      const rank = new Int32Array(L.length); a.startOrder.forEach((k, r) => { rank[k] = r; });
      a.gl = { idx, ptr: 0, rank, snaps: null, sp: 0 };
      // a tear's fibres snap at their moment (the pose code spawned the flecks as it posed them: here a time-sorted list)
      if ( a.tear ) { const sn = []; for ( let k = 0; k < L.length; k++ ) if ( L[k].kind === 4 ) sn.push(k); sn.sort((x, y) => (L[x].t0 + L[x].hold) - (L[y].t0 + L[y].hold) || x - y); a.gl.snaps = sn; }
      a.busyUntil = L.reduce((m, it) => Math.max(m, it.t0 + it.dur + 400), -Infinity);
    }
    const G = a.gl, L = a.list;
    if ( G.snaps && G.sp < G.snaps.length ) this.tearSnaps(a, G, now, onScreen);
    if ( onScreen && G.ptr < G.idx.length ) {
      const due = [];
      while ( G.ptr < G.idx.length ) {
        const it = L[G.idx[G.ptr]];
        if ( it.dusted ) { G.ptr++; continue; }
        if ( !((now - it.t0) / it.dur >= 1) ) break;
        due.push(G.idx[G.ptr++]);
      }
      if ( due.length > 1 ) due.sort((x, y) => G.rank[x] - G.rank[y]);
      for ( const k of due ) this.dust(L[k], type);
    }
    return now < a.busyUntil;
  }

  /**
   * A tear's fibres that snap now: the pose code's own rule (a fibre snaps in the first frame its time into its life is past its hold,
   * when it is posed: on screen, or once it has landed), the flecks flicked in the order of the pieces.
   */
  tearSnaps(a, G, now, onScreen) {
    const sn = G.snaps, L = a.list;
    let due = null;
    for ( let q = G.sp; q < sn.length; q++ ) {
      const k = sn[q], it = L[k];
      if ( it.snapped ) { if ( q === G.sp ) G.sp++; continue; }
      if ( it.t0 + it.hold > now + 1 ) break;
      const t = (now - it.t0) / it.dur;
      if ( !(t * it.dur >= it.hold && (onScreen || t >= 1)) ) continue;
      it.snapped = true; (due ??= []).push(k);
      if ( q === G.sp ) G.sp++;
    }
    if ( due ) { if ( due.length > 1 ) due.sort((x, y) => x - y); for ( const k of due ) tearSnap(this, L[k].p, L[k]); }
  }

  /**
   * PERF: the same lives, visiting only the pieces whose life has begun (by the moment they appear: before it a piece is hidden, as
   * enter left it) and not placing again a piece at rest in its final pose and colour (a Detonate visited ~50k pieces every frame).
   */
  livesActive(a, now, onScreen, type) {
    if ( !a.byStart ) {
      a.startOrder ??= startOrderOf(a.list);
      a.byStart = a.startOrder.map((k) => a.list[k]); a.nextStart = 0; a.act = [];
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
        // (a tear's piece: its own settle, tear-entry.mjs tearPiece)
        if ( it.p.spr && t >= 1 && (t - 1) * it.dur >= (it.settle ?? Math.max(70, it.bounces * 150)) && (!a.cl?.tint || t >= 1.5) ) it.fin = true;
      }
      if ( onScreen && t >= 1 && !it.dusted ) this.dust(it, type);
      if ( !(it.fin && it.dusted) ) act[w++] = it;
    }
    act.length = w;
    if ( this.snapQ?.length ) this.flushSnaps();
    return now < a.busyUntil;
  }

  /** The type's own effects: one-shots at fixed moments, and what rides on the front. */
  effects(g, a, now, el) {
    const type = a.type, ap = this.ap, o = this.origin, pw = a.pw, k = a.k;
    // PERF: the one-shot effects (a skirt of dust, the thrown clods, flashes) of every area fall in the same ~100 ms of a Detonate (~86 particles
    // and chunks an area, 265 areas: 38-50 ms in one frame); past ONCE_MS of them in a frame the rest wait for the next one (a few ms late)
    const once = (key, at, fn) => {
      if ( el < at || a.fired.has(key) || this._fxSpent > ONCE_MS ) return;
      a.fired.add(key); const t = performance.now(); fn(); this._fxSpent += performance.now() - t;
    };
    const X = (x) => o.x + x * ap, Y = (y) => o.y + y * ap;
    const R = Math.max(4, g.info.R);
    const tFront = clamp01((el - a.delay) / a.reveal);
    const frontR = a.Rmax * easeOut(tFront);
    const ring = (key, at, color, maxR, dur, width, extra = {}) => once(key, at, () => {
      const gr = this.pixelCanvas();
      a.fx.push({ g: gr, kind: "ring", t0: a.start + at, dur, color, maxR, width, ...extra });
    });
    if ( a.tear ) tearFx(this, g, a, now, el);
    else if ( a.coll ) collapseFx(this, g, a, now, el);
    else if ( a.path ) this.pathEffects(g, a, now, el);
    else if ( type === "blast" ) {
      once("flash", 0, () => {
        const gr = this.pixelCanvas();
        // the cause's own anticipation: frost blooms white-blue, acid green, arcane violet; a blow, claws, water and rot have no flash
        if ( a.cl && a.cl.hot === null ) { gr.destroy(); return; }
        a.fx.push({ g: gr, kind: "flash", t0: a.start, dur: 140 * k, color: 0xfff1c4, colors: a.cl?.hot ?? undefined, maxR: Math.min(R * 0.45, 16) * pw });
      });
      // (dust in the ground's own tone: no pale flecks over a dark map)
      once("ring", 30 * k, () => this.burst(a.ox, a.oy, R * 1.3 * pw, now, { n: 22, color: this.tone(g, 1, 0xb8ab94), rise: -2, speed: 1.4 }));   // a skirt of dust puffs, not a drawn ring
      once("dust", 60 * k, () => this.burst(a.ox, a.oy, R * pw, now, { color: this.tone(g, 3, 0x8a7a62) }));
      // the THROW: clods of the ground itself (chunks cut from this area's plates), radiating at varied speeds, the heavy ones lower and
      // shorter, a second smaller wave as the crater opens; they land, hop, skid and crumble (the few that stay: makeRest)
      once("chunks", 25 * k, () => this.chunks(g, a, { count: Math.min(36, Math.round((8 + R * 0.45) * pw)), reach: [0.75, 2.2], H: [5, 15], delay: [0, 70 * k] }));
      once("chunks2", 150 * k, () => this.chunks(g, a, { count: Math.min(14, Math.round((3 + R * 0.2) * pw)), reach: [0.6, 1.5], H: [3, 8], sizes: [3, 5], seed: 2 }));
    } else if ( type === "collapse" ) {
      once("crack", 0, () => { for ( let q = 0; q < 6; q++ ) this.spawn({ x: a.ox + (Math.random() - 0.5) * R, y: a.oy + (Math.random() - 0.5) * R * 0.8, vx: 0, vy: 0, rise: -2, life: 300, color: 0x8a7d6a, alpha: 0.6, size: 2 }); });
      once("billow", a.delay + a.reveal * 0.75, () => this.burst(a.ox, a.oy, R * 0.6 * pw, now, { rise: -10, speed: 0.6, color: 0xb9ae9e }));
      // RUBBLE: slabs of the rim break off and drop INTO the pit in three waves (they sink dark where they land)
      for ( const [key, f, n] of [["rub1", 0.2, 0.3], ["rub2", 0.5, 0.25], ["rub3", 0.85, 0.15]] ) once(key, a.delay + a.reveal * f, () => this.chunks(g, a, {
        count: Math.min(14, Math.round((3 + R * n) * pw)), landing: "into", H: [1.5, 4], seed: key.length + f * 10,
        from: (i, h) => { const an = h(4) * 6.283, d = R * (0.85 + 0.25 * h(5)); return [a.ox + Math.cos(an) * d, a.oy + Math.sin(an) * d * 0.8]; },
        to: (i, h) => { const an = h(4) * 6.283 + (h(12) - 0.5) * 0.4, d = R * (0.15 + 0.4 * h(13)); return [a.ox + Math.cos(an) * d, a.oy + Math.sin(an) * d * 0.8]; } }));
    } else if ( type === "scorch" ) {
      // FLAME TONGUES ride the front (pixel-fx tongueCells: curved licking shapes in four tone bands, flickering frame by frame), die
      // down at the rim; embers rise in clusters from the hottest tongue tips, smoke wisps from the dying ones
      once("flames", a.delay, () => {
        const gr = this.pixelCanvas(), n = Math.max(5, Math.min(12, Math.round(4 + R * 0.25))), life = a.reveal + a.band * 0.8;
        const nc = 3 + Math.floor(hash2(9, 1, a.seed) * 2), cl = Array.from({ length: nc }, (_, c) => (c + hash2(c, 8, a.seed) * 0.6) / nc * 6.283);
        const T = Array.from({ length: n + Math.ceil(n / 2) }, (_, q) => ({ inner: q >= n, ang: cl[q % nc] + (hash2(q, 1, a.seed) - 0.5) * 1.4 + (q >= n ? 0.4 : 0), lag: hash2(q, 2, a.seed),
          off: hash2(q, 6, a.seed) * 70, h: 0.3 + 1.6 * hash2(q, 3, a.seed) ** 2.6, w: 2 + Math.round(3.5 * hash2(q, 4, a.seed)), flip: hash2(q, 7, a.seed) < 0.5, lean: (hash2(q, 9, a.seed) - 0.5) * 0.45, ph: hash2(q, 5, a.seed) * 6.28 }));
        a.fx.push({ g: gr, kind: "flames", t0: a.start + a.delay, dur: life, draw: (t) => this.flames(gr, a, T, t * life, life, R) });
        this.shimmer(a, g, R);
      });
      // smoke: a few dark puffs from the burnt ground behind the front
      once("smoke", a.reveal * 0.5, () => {
        for ( let q = 0; q < 4; q++ ) this.spawn({ x: a.ox + (Math.random() - 0.5) * R, y: a.oy + (Math.random() - 0.5) * R * 0.6, vx: 0.6 + Math.random(), vy: 0, rise: -3 - Math.random() * 3, life: 1300 + Math.random() * 500, color: 0x4a4440, alpha: 0.6, size: Math.random() < 0.6 ? 3 : 2 });
      });
      // charred CLODS popping off the burnt ground behind the front (the map's own pixels, charred dark)
      for ( const [key, f] of [["clod1", 0.3], ["clod2", 0.65]] ) once(key, a.delay + a.reveal * f, () => this.chunks(g, a, {
        count: Math.min(10, Math.round((2 + R * 0.15) * pw)), reach: [0.3, 1.2], H: [3, 8], tint: 0x6a5244, seed: f * 10,
        from: (i, h) => { const an = h(4) * 6.283, d = R * f * (0.6 + 0.6 * h(5)); return [a.ox + Math.cos(an) * d, a.oy + Math.sin(an) * d * 0.8]; } }));
    } else if ( type === "flood" ) {
      // ripples: broken arcs of varied radius and speed (pixel-fx arcCells), never closed rings
      for ( const [key, f, rr, dur] of [["r1", 0.3, 0.9, 700], ["r2", 0.6, 0.7, 620], ["r3", 0.9, 0.55, 560]] ) once(key, a.delay + a.reveal * f, () => {
        const gr = this.pixelCanvas(), v = { ap, ox: o.x, oy: o.y }, sd = a.seed + key.length * 31 + Math.round(f * 100), cx = a.ox + (hash2(sd, 1, 3) - 0.5) * R * 0.4, cy = a.oy + (hash2(sd, 2, 3) - 0.5) * R * 0.3;
        a.fx.push({ g: gr, kind: "arcs", t0: a.start + a.delay + a.reveal * f, dur: dur * k, draw: (t) => pxArcs(gr, v, cx, cy, R * rr * pw * easeOut(t), t, { seed: sd, core: t < 0.5 ? 0xd8eef8 : 0xa8d0e8 }) });
      });
      // planks and stones of the bank break off and splash INTO the water (they sink blue), a few are thrown up onto the bank
      once("splash", a.delay + a.reveal * 0.25, () => {
        const rim = (i, h) => { const an = h(4) * 6.283, d = R * (0.8 + 0.3 * h(5)); return [a.ox + Math.cos(an) * d, a.oy + Math.sin(an) * d * 0.8]; };
        this.chunks(g, a, { count: Math.min(12, Math.round((3 + R * 0.2) * pw)), landing: "into", sink: 0x6f9cc8, H: [2, 6], from: rim,
          to: (i, h) => { const an = h(4) * 6.283 + (h(12) - 0.5) * 0.5, d = R * (0.2 + 0.45 * h(13)); return [a.ox + Math.cos(an) * d, a.oy + Math.sin(an) * d * 0.8]; } });
        this.chunks(g, a, { count: Math.min(5, Math.round((1 + R * 0.08) * pw)), reach: [1.05, 1.5], H: [3, 7], sizes: [3, 5], seed: 3, from: rim });
      });
    } else if ( type === "cracks" ) {
      // CHIPS pop off the plates along the fissures as they open and after (chunks of the ground cut where a crack runs: they hop a
      // few pixels sideways and crumble), a little dust lifts and settles over ~1.5 s
      for ( const [key, at, n] of [["chip0", 0.4, 4], ["chip1", 0.85, 3], ["chip2", 1.25, 2], ["chip3", 1.8, 2]] ) once(key, a.delay + a.reveal * at, () => {
        const pts = this.fissures(g, a, Math.round(n * pw), a.seed + key.length * 7 + at * 100);
        // (a flake of the surface beside the crack: its lit lip's own tone, two pixels, an irregular diagonal or crumb shape; it hops off
        // and is gone - never a chunk cut from the dark crack itself, which read as a round dark blob)
        const bd = a.rev?.data, bw = g.info.w;
        for ( const [x, y] of pts ) {
          const lx = x - g.info.x, ly = y - g.info.y + 1, q = (ly * bw + lx) * 4;
          const c = bd && bd[q + 3] ? (Math.min(255, bd[q] * 1.08) << 16) | (Math.min(255, bd[q + 1] * 1.08) << 8) | Math.min(255, bd[q + 2] * 1.08) : 0xb8ad9c;
          this.spawn({ x, y: y - 1, vx: (Math.random() - 0.5) * 6, vy: -4 - Math.random() * 3, fall: 34, life: 420, color: c, size: 2, shape: Math.random() < 0.5 ? "diag" : "crumb" });
        }
        for ( const [x, y] of pts.slice(0, 1) ) this.spawn({ x: x + 1, y, vx: (Math.random() - 0.5) * 2, vy: 0, rise: -1.2, life: 700 + Math.random() * 300, color: this.tone(g, 2, 0xa89c8a), alpha: 0.5, drag: 2, size: 1, shape: Math.random() < 0.5 ? "crumb" : "dot" });
      });
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
    if ( !a.tear && !a.coll && (type === "blast" || type === "collapse" || type === "scorch" || type === "cracks") ) once("settle", a.delay + a.reveal + a.band * 0.4, () => {
      const ck = type === "cracks", n = Math.round(Math.min(10, 4 + R / 4) * pw * (ck ? 0.3 : 1)), col = type === "scorch" ? 0x5a524c : this.tone(g, ck ? 2 : 1, 0xc9bfae);
      for ( let q = 0; q < n; q++ ) { const an = (q / n) * 6.28 + Math.random() * 0.5, d = R * (0.85 + Math.random() * 0.3); this.spawn({ x: a.ox + Math.cos(an) * d, y: a.oy + Math.sin(an) * d * 0.8, vx: Math.cos(an) * 3, vy: Math.sin(an) * 2, rise: -2, life: 650 + Math.random() * 300, color: col, alpha: 0.6, drag: 3, ...(ck ? { size: Math.random() < 0.6 ? 1 : 2, shape: Math.random() < 0.5 ? "crumb" : "diag" } : { size: Math.random() < 0.5 ? 3 : 2 }) }); }
    });
    // rings and flashes
    for ( let i = a.fx.length - 1; i >= 0; i-- ) {
      const f = a.fx[i], t = (now - f.t0) / f.dur;
      if ( t >= 1 ) { f.g.destroy(); a.fx.splice(i, 1); continue; }
      if ( t < 0 ) continue;
      // PERF: every ring / flash / accent is redrawn each frame (its pixels worked out again: ~0.1-0.5 ms each; a Detonate has ~100 at
      // once). Past FX_DRAW_MS of redraws in a frame, one that was drawn in the last frame keeps that picture for this one (a frame
      // late, never two in a row). `noFxBudget`: always redrawn (A/B).
      if ( this._fxDrawn > FX_DRAW_MS && f.drawnAt === this._frameNo - 1 && !globalThis.CONFIG?.moinenMaps?.noFxBudget ) continue;
      f.drawnAt = this._frameNo; const tf = performance.now();
      f.g.clear();
      if ( f.draw ) { f.draw(t); this._fxDrawn += performance.now() - tf; continue; }   // a cause's accent draws itself (cause-fx.mjs)
      const v = { ap, ox: o.x, oy: o.y };
      if ( f.kind === "flash" ) {
        // a pixel-art flash: a ragged disc in three hard bands and a few rays, art pixels on the art grid
        pxFlash(f.g, v, f.x ?? a.ox, f.y ?? a.oy, f.maxR, t, { seed: a.seed + i, colors: f.colors });
      } else {
        // a pixel-art ring: broken arcs of art pixels that open up and drop out as the ring spreads (no vector ellipse)
        pxRing(f.g, v, a.ox, a.oy, f.maxR * easeOut(t), t, { core: f.color, outer: f.outer ?? lerpColor(f.color, 0x3a3028, 0.45), seed: a.seed + i * 7, thick: f.width > 1 ? 2 : 1, dash: f.dash ?? 9 });
      }
      this._fxDrawn += performance.now() - tf;
    }
  }

  idleTick(now, vw) {
    if ( !this.idle.on || reducedMotion() || perfMode() === "low" || (this.idle.who === "gm" && !game.user.isGM) || !this.order.length ) return;
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
    this.enterQueue?.clear(); this.pending?.clear(); this.pixelAsks?.clear(); if ( this.restoreQ ) this.restoreQ.length = 0; if ( this.swapQ ) this.swapQ.length = 0;
    for ( const g of [...this.groups.values(), ...this.dying, ...this.spare.values()] ) this.kill(g);
    for ( const e of this.erasers.values() ) this.killEraser(e);
    this.groups.clear(); this.spare.clear(); this.erasers.clear(); this.order = []; this.dying = [];
    for ( const q of this.particles ) { q.spr.visible = false; this.pool.push(q.spr); }
    this.particles = [];
    this.debris?.clear();
    this.stats.groups = this.stats.sprites = 0;
    this.cache?.invalidate();
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick);
    this.clockPool?.destroy(); this.clockPool = null;
    Cause.disposeLights(this);
    this.clear();
    this.gpuErode?.destroy(); this.gpuErode = null;
    this.debris?.destroy(); this.debris = null;
    this.cache?.destroy(); this.cache = null;
    for ( const sp of [...this.spritePool, ...(this._flatPool ?? []), this._flatBase] ) if ( sp && !sp.destroyed ) sp.destroy();
    this.spritePool = []; this._flatPool = null; this._flatBase = null; this._flatTmp?.destroy(); this._flatTmp = null;
    for ( const c of [this.objs, this.fx] ) if ( !c.destroyed ) c.destroy({ children: true });
  }
}
