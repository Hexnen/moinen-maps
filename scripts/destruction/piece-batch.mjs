/**
 * BATCHED PIECES (PERF). While an area enters, its shards were PIXI sprites: a whole-scene Detonate of 'map' made ~72k of them and
 * the scene graph walked every one each frame (updateTransform + Container.render were ~half of a frame's CPU), plus their batch
 * packing. Here an entering area's pieces are QUADS of ONE geometry drawn in ONE draw call (with the ruin's base quad first when it
 * can be folded in): the pose code (display.place, tear-entry tearPlace, collapse-entry collapsePlace) is unchanged and writes into a
 * PiecePose - an object with the few members of a sprite it uses (position.set, scale.set, rotation, visible, alpha, tint, x, y) -
 * whose numbers live in struct-of-arrays state here; a piece whose pose did not change is not touched (at rest, or not begun).
 *
 * EXACTNESS: the quads are drawn by PIXI's own batch shader program (renderer.plugins.batch) with the same attribute values PIXI's
 * batcher would pack for the sprites: the vertex positions are computed with the same double-precision arithmetic as
 * Transform.updateTransform + Sprite.calculateVertices (anchor 0.5, the parent's world transform at render time), the UVs as
 * TextureUvs.set, the colour as Color.toPremultiplied(tint, min(worldAlpha, 1)) - the same pixels as the sprites (dev harness abBatch).
 *
 * Layout per area (pooled by capacity, no allocation per frame):
 *   dyn  (12 B / vertex, rewritten for changed quads only, uploaded as one bufferSubData range): x, y (f32), colour (u32 RGBA8);
 *   stat (12 B / vertex, written when a quad is made):                                             u, v (f32), texture slot (f32);
 *   index: one shared Uint32 buffer (0 1 2 0 2 3 + 4q).
 *   quad 0 = the base (texture slot 1: the area's ruin, as its base sprite shows it), quads 1..N = the pieces (slot 0: the atlas).
 * State (per piece, Float64 like PIXI's ObservablePoints): px, py, sx, sy, rot, alpha; Uint32 tint; flags (made, visible).
 */

import { batchShader } from "./sharp-batch.mjs";
let ROUND = null;
const RK = [0, 1, 3, 4, 6, 7, 9, 10];
const F_MADE = 1, F_VIS = 2, F_DIRTY = 4, F_ON = 8, F_COL = 16;   // F_ON: its quad is drawn (not empty)
const STRIDE = 3;                 // 32-bit words per vertex in both buffers

let indexBuf = null;              // shared index buffer (Uint32), grown as needed
function sharedIndex(quads) {
  if ( indexBuf && indexBuf.data.length >= quads * 6 ) return indexBuf;
  let n = 1024; while ( n < quads ) n *= 2;
  const a = new Uint32Array(n * 6);
  for ( let q = 0, i = 0, v = 0; q < n; q++, v += 4 ) { a[i++] = v; a[i++] = v + 1; a[i++] = v + 2; a[i++] = v; a[i++] = v + 2; a[i++] = v + 3; }
  if ( indexBuf ) { indexBuf.data = a; indexBuf.update(); } else indexBuf = new PIXI.Buffer(a, true, true);
  return indexBuf;
}

/** Geometries by capacity (quads, a power of two), kept for the next area (no GL buffer churn on a Detonate). */
const pool = new Map();
let pooledBytes = 0;
const POOL_MAX = 48 * 1048576;
export const batchStats = { made: 0, reused: 0, pooledMB: 0, uploads: 0, uploadKB: 0, full: 0, draws: 0, quadsWritten: 0 };

function takeGeometry(quads) {
  let cap = 64; while ( cap < quads ) cap *= 2;
  const list = pool.get(cap);
  if ( list?.length ) {
    const g = list.pop(); pooledBytes -= cap * 96; batchStats.reused++;
    g.dynU32.fill(0, 0, quads * 4 * STRIDE); g.statF32.fill(0, 0, quads * 4 * STRIDE);
    g.fullDyn = g.fullStat = true;
    return g;
  }
  const dyn = new ArrayBuffer(cap * 4 * STRIDE * 4), stat = new ArrayBuffer(cap * 4 * STRIDE * 4);
  const bd = new PIXI.Buffer(new Float32Array(dyn), false, false), bs = new PIXI.Buffer(new Float32Array(stat), true, false);
  const geom = new PIXI.Geometry()
    .addAttribute("aVertexPosition", bd, 2, false, PIXI.TYPES.FLOAT, 12, 0)
    .addAttribute("aColor", bd, 4, true, PIXI.TYPES.UNSIGNED_BYTE, 12, 8)
    .addAttribute("aTextureCoord", bs, 2, false, PIXI.TYPES.FLOAT, 12, 0)
    .addAttribute("aTextureId", bs, 1, false, PIXI.TYPES.FLOAT, 12, 8)
    .addIndex(sharedIndex(cap));
  batchStats.made++;
  return { cap, geom, bd, bs, dynF32: bd.data, dynU32: new Uint32Array(dyn), statF32: bs.data, fullDyn: true, fullStat: true };
}
function giveGeometry(g) {
  if ( pooledBytes + g.cap * 96 > POOL_MAX ) { g.geom.destroy(); g.bd.destroy(); g.bs.destroy(); return; }
  pooledBytes += g.cap * 96;
  if ( !pool.has(g.cap) ) pool.set(g.cap, []);
  pool.get(g.cap).push(g);
  batchStats.pooledMB = +(pooledBytes / 1048576).toFixed(1);
}

/* ------------------------------------------------------------------ the pose a piece's code writes (a sprite's few members) */

let CUR = null, CI = 0;
const POS = { set(x = 0, y = x) { const b = CUR, i = CI; if ( b.px[i] !== x || b.py[i] !== y ) { b.px[i] = x; b.py[i] = y; b.mark(i); } } };
const SCL = { set(x = 0, y = x) { const b = CUR, i = CI; if ( b.sx[i] !== x || b.sy[i] !== y ) { b.sx[i] = x; b.sy[i] = y; b.mark(i); } } };

/** A piece's stand-in for its sprite (display.place & co. write it). */
export class PiecePose {
  constructor(b, i) { this.b = b; this.i = i; }
  get position() { CUR = this.b; CI = this.i; return POS; }
  get scale() { CUR = this.b; CI = this.i; return SCL; }
  get x() { return this.b.px[this.i]; }
  get y() { return this.b.py[this.i]; }
  get rotation() { return this.b.rot[this.i]; }
  set rotation(v) { const b = this.b, i = this.i; if ( b.rot[i] !== v ) { b.rot[i] = v; b.mark(i); } }
  get visible() { return (this.b.flags[this.i] & F_VIS) !== 0; }
  set visible(v) { const b = this.b, i = this.i, f = b.flags[i]; if ( !!(f & F_VIS) !== !!v ) { b.flags[i] = v ? f | F_VIS : f & ~F_VIS; b.mark(i); } }
  get alpha() { return this.b.pa[this.i]; }
  set alpha(v) { const b = this.b, i = this.i; if ( b.pa[i] !== v ) { b.pa[i] = v; b.mark(i); } }
  get tint() { return this.b.pt[this.i]; }
  set tint(v) { const b = this.b, i = this.i; if ( b.pt[i] !== v ) { b.pt[i] = v; b.mark(i); } }
  get destroyed() { return this.b.destroyed; }
  get worldVisible() { return this.visible; }
}

/* ------------------------------------------------------------------ one area's pieces */

/**
 * `atlas` { pos: [{x, y}], W, H, sizes: [[w, h]] } (display.build's layout; frame k = piece k - 1), `tex` the atlas BaseTexture,
 * `n` pieces, `base` the area's base sprite (folded into this draw while its container holds nothing else).
 */
export class PieceBatch extends PIXI.Container {
  constructor(n, tex, atlas, base = null) {
    super();
    this.eventMode = "none";
    this.n = n; this.tex = tex; this.atlas = atlas; this.base = base;
    this.px = new Float64Array(n); this.py = new Float64Array(n); this.sx = new Float64Array(n); this.sy = new Float64Array(n); this.rot = new Float64Array(n);
    this.pa = new Float64Array(n); this.pt = new Uint32Array(n); this.flags = new Uint8Array(n);
    this.dirty = new Int32Array(n); this.nd = 0; this.nvis = 0;
    this.ct = new Uint32Array(n); this.ca = new Float64Array(n); this.cc = new Uint32Array(n);   // colour cache: tint, alpha, packed
    this.baseBlank = null;          // () => true while the base shows nothing yet (an entry's ruin before its first pixel): not drawn
    this.G = takeGeometry(n + 1);
    this.M = new Float64Array([NaN, 0, 0, 0, 0, 0]); this.wa = -1;    // the world transform / alpha the quads were written for
    this.baseTex = null; this.baseUpd = -1; this.folded = false;
    this.lo = Infinity; this.hi = -1; this.slo = Infinity; this.shi = -1;   // dynamic / static quad ranges to upload
    this.state = PIXI.State.for2d();
  }

  mark(i) { const f = this.flags[i]; if ( !(f & F_DIRTY) ) { this.flags[i] = f | F_DIRTY; this.dirty[this.nd++] = i; } }

  /** Piece `i` exists (as a made sprite would): its pose at rest until its code places it; returns its PiecePose. */
  make(i, x, y, scale) {
    this.px[i] = x; this.py[i] = y; this.sx[i] = scale; this.sy[i] = scale; this.rot[i] = 0; this.pa[i] = 1; this.pt[i] = 0xFFFFFF;
    this.flags[i] = (this.flags[i] & (F_DIRTY | F_ON)) | F_MADE | F_VIS; this.mark(i);
    // its frame's UVs, as TextureUvs.set (a frame of the atlas: frame k + 1)
    const A = this.atlas, p = A.pos[i + 1], [w, h] = A.sizes[i + 1], tw = this.tex.width, th = this.tex.height, S = this.G.statF32, o = (i + 1) * 4 * STRIDE;
    const x0 = p.x / tw, y0 = p.y / th, x1 = (p.x + w) / tw, y2 = (p.y + h) / th;
    S[o] = x0; S[o + 1] = y0; S[o + 2] = 0; S[o + 3] = x1; S[o + 4] = y0; S[o + 5] = 0; S[o + 6] = x1; S[o + 7] = y2; S[o + 8] = 0; S[o + 9] = x0; S[o + 10] = y2; S[o + 11] = 0;
    if ( i + 1 < this.slo ) this.slo = i + 1; if ( i + 1 > this.shi ) this.shi = i + 1;
    return new PiecePose(this, i);
  }

  /** Piece `i` is gone (released): an empty quad. */
  unmake(i) { this.flags[i] &= ~(F_MADE | F_VIS); this.mark(i); }

  /** Write quad q (= piece i + 1) of `this.G` from piece i's state and the world transform s / alpha wa. */
  writePiece(i, s, wa) {
    const D = this.G.dynF32, U = this.G.dynU32, o = (i + 1) * 4 * STRIDE, f = this.flags[i], al = this.pa[i];
    if ( !(f & F_MADE) || !(f & F_VIS) || !(al * wa > 0) ) {
      if ( f & F_ON ) { this.flags[i] = f & ~F_ON; this.nvis--; }
      D[o] = D[o + 1] = D[o + 3] = D[o + 4] = D[o + 6] = D[o + 7] = D[o + 9] = D[o + 10] = 0; return;
    }
    if ( !(f & F_ON) ) { this.flags[i] = f | F_ON; this.nvis++; }
    // Transform.updateSkew / updateTransform (skew 0, pivot 0), then Sprite.calculateVertices (anchor 0.5, no trim): same operations
    const r = this.rot[i], cx = Math.cos(r), sn = Math.sin(r), cy = -Math.sin(r), sy = Math.cos(r);
    const scx = this.sx[i], scy = this.sy[i];
    const la = cx * scx, lb = sn * scx, lc = cy * scy, ld = sy * scy;
    const ltx = this.px[i] - (0 * la + 0 * lc), lty = this.py[i] - (0 * lb + 0 * ld);
    const a = la * s[0] + lb * s[2], b = la * s[1] + lb * s[3], c = lc * s[0] + ld * s[2], d = lc * s[1] + ld * s[3];
    const tx = ltx * s[0] + lty * s[2] + s[4], ty = ltx * s[1] + lty * s[3] + s[5];
    const [w, h] = this.atlas.sizes[i + 1];
    const p0 = -0.5 * w, f0 = p0 + w, g0 = -0.5 * h, m0 = g0 + h;
    D[o] = a * p0 + c * g0 + tx; D[o + 1] = d * g0 + b * p0 + ty;
    D[o + 3] = a * f0 + c * g0 + tx; D[o + 4] = d * g0 + b * f0 + ty;
    D[o + 6] = a * f0 + c * m0 + tx; D[o + 7] = d * m0 + b * f0 + ty;
    D[o + 9] = a * p0 + c * m0 + tx; D[o + 10] = d * m0 + b * p0 + ty;
    if ( this.round ) for ( const k of RK ) D[o + k] = Math.round(D[o + k] * this.round) / this.round;
    // the packed colour, made again only when the piece's tint or alpha changed (Color.setValue costs ~0.5 us)
    const ea = Math.min(al * wa, 1), t = this.pt[i];
    if ( this.ct[i] !== t || this.ca[i] !== ea || !(f & F_COL) ) {
      const C = PIXI.Color.shared;
      this.ct[i] = t; this.ca[i] = ea; this.flags[i] |= F_COL;
      this.cc[i] = C.setValue(C.setValue(t).toLittleEndianNumber()).toPremultiplied(ea, this.tex.alphaMode > 0);
    }
    const col = this.cc[i];
    U[o + 2] = U[o + 5] = U[o + 8] = U[o + 11] = col;
    batchStats.quadsWritten++;
  }

  /** The base quad from the base sprite (its own vertices and colour, as the batcher would pack them), or empty. */
  writeBase() {
    const D = this.G.dynF32, U = this.G.dynU32, s = this.base;
    const on = this.folded && s.visible && s.worldAlpha > 0 && s._texture?.valid && !this.baseBlank?.();
    this.baseOn = on;
    if ( !on ) { if ( D[0] || D[1] || D[3] || D[6] || D[9] ) { D[0] = D[1] = D[3] = D[4] = D[6] = D[7] = D[9] = D[10] = 0; this.lo = 0; } return; }
    s.calculateVertices();
    const v = s.vertexData;
    if ( D[0] !== v[0] || D[1] !== v[1] || D[3] !== v[2] || D[4] !== v[3] || D[6] !== v[4] || D[7] !== v[5] || D[9] !== v[6] || D[10] !== v[7] ) {
      D[0] = v[0]; D[1] = v[1]; D[3] = v[2]; D[4] = v[3]; D[6] = v[4]; D[7] = v[5]; D[9] = v[6]; D[10] = v[7]; this.lo = 0;
    }
    const col = PIXI.Color.shared.setValue(s._tintRGB).toPremultiplied(Math.min(s.worldAlpha, 1), s._texture.baseTexture.alphaMode > 0);
    if ( U[2] !== col ) { U[2] = U[5] = U[8] = U[11] = col; this.lo = 0; }
    const t = s._texture;
    if ( t !== this.baseTex || t._updateID !== this.baseUpd ) {
      this.baseTex = t; this.baseUpd = t._updateID;
      // (the base drawn from the atlas itself - at rest - samples it through slot 0 like the pieces: two slots side by side split the
      // GPU's 2x2 pixel blocks between two branches of the shader and its mipmap level at their seams came out different)
      const u = t._uvs.uvsFloat32, S = this.G.statF32, id = t.baseTexture === this.tex ? 0 : 1;
      this.baseSlot = id;
      S[0] = u[0]; S[1] = u[1]; S[2] = id; S[3] = u[2]; S[4] = u[3]; S[5] = id; S[6] = u[4]; S[7] = u[5]; S[8] = id; S[9] = u[6]; S[10] = u[7]; S[11] = id;
      this.slo = 0; if ( this.shi < 0 ) this.shi = 0;
    }
  }

  /** Fold the base sprite into this draw (only while its container draws nothing else between it and the pieces). */
  syncFold() {
    const s = this.base, c = s?.parent;
    const want = !globalThis.CONFIG?.moinenMaps?.noFold && !!s && !s.destroyed && !!c && c.children.length === 1 && !c.filters && !c.mask && !s.filters && !s.mask && s.blendMode === PIXI.BLEND_MODES.NORMAL;
    if ( want !== this.folded ) {
      this.folded = want;
      if ( s && !s.destroyed ) s.renderable = !want;
    }
  }

  _render(renderer) {
    const n = this.n, M = this.worldTransform, s = this.M, wa = this.worldAlpha;
    // (a sprite rounds its vertices when it was made with ROUND_PIXELS on: the same here)
    this.round = (ROUND ??= !!new PIXI.Sprite()._roundPixels) ? PIXI.settings.RESOLUTION : 0;
    this.syncFold();
    const moved = s[0] !== M.a || s[1] !== M.b || s[2] !== M.c || s[3] !== M.d || s[4] !== M.tx || s[5] !== M.ty || wa !== this.wa;
    if ( moved ) {
      s[0] = M.a; s[1] = M.b; s[2] = M.c; s[3] = M.d; s[4] = M.tx; s[5] = M.ty; this.wa = wa;
      for ( let i = 0; i < n; i++ ) { this.flags[i] &= ~F_DIRTY; if ( this.flags[i] & F_MADE ) this.writePiece(i, s, wa); }
      this.nd = 0; this.lo = 0; this.hi = n;
    } else if ( this.nd ) {
      const dl = this.dirty;
      for ( let k = 0; k < this.nd; k++ ) {
        const i = dl[k]; this.flags[i] &= ~F_DIRTY; this.writePiece(i, s, wa);
        if ( i + 1 < this.lo ) this.lo = i + 1; if ( i + 1 > this.hi ) this.hi = i + 1;
      }
      this.nd = 0;
    }
    if ( this.base ) this.writeBase();
    const sh = batchShader(renderer);
    if ( !sh || !this.tex.valid ) return;
    // nothing to draw yet (no piece shown, no base pixel): no draw, no upload of the atlas (an area's atlas goes to the GPU when its
    // first piece shows or the display's uploader gets to it - not all of a Detonate's atlases in its first frame)
    // (and while its atlas is not on the GPU yet - the display's uploader sends a few per frame - its pieces wait a frame or two
    // instead of every atlas of a whole-scene Detonate going up in its first frame: ~65 MPx, ~200 ms)
    let pieces = this.nvis > 0;
    if ( pieces && !this.atlasReady(renderer) && !globalThis.CONFIG?.moinenMaps?.atlasNow ) { pieces = false; batchStats.deferred = (batchStats.deferred ?? 0) + 1; }
    if ( !pieces && !this.baseOn ) { this.flushUploads(renderer); return; }
    renderer.batch.flush();
    // textures: the atlas in slot 0, the base's in slot 1 (the batch shader's samplers are the units 0..max-1)
    renderer.texture.bind(pieces ? this.tex : PIXI.Texture.WHITE.baseTexture, 0);
    if ( this.baseOn && this.baseTex?.baseTexture && this.baseSlot === 1 ) renderer.texture.bind(this.baseTex.baseTexture, 1);
    if ( this.baseOn && this.baseSlot === 0 && !pieces ) renderer.texture.bind(this.tex, 0);
    renderer.shader.bind(sh);
    this.state.blendMode = PIXI.BLEND_MODES.NORMAL;
    renderer.state.set(this.state);
    const G = this.G;
    if ( G.fullDyn ) { G.bd.update(); G.fullDyn = false; this.lo = Infinity; this.hi = -1; batchStats.full++; }
    if ( G.fullStat ) { G.bs.update(); G.fullStat = false; this.slo = Infinity; this.shi = -1; }
    renderer.geometry.bind(G.geom, sh);
    const gl = renderer.gl;
    if ( this.hi >= this.lo ) { this.upload(renderer, gl, G.bd, G.dynF32, this.lo, this.hi); this.lo = Infinity; this.hi = -1; }
    if ( this.shi >= this.slo ) { this.upload(renderer, gl, G.bs, G.statF32, this.slo, this.shi); this.slo = Infinity; this.shi = -1; }
    // (no piece shown: the base quad alone)
    renderer.geometry.draw(PIXI.DRAW_MODES.TRIANGLES, pieces ? (n + 1) * 6 : 6, 0);
    batchStats.draws++;
  }

  /** Not drawn this frame: the written quads still go to the GPU later (kept as dirty ranges). */
  flushUploads() { /* the ranges stay pending until the next draw */ }

  /** Is the atlas on the GPU (uploaded and current)? */
  atlasReady(renderer) { const t = this.tex._glTextures?.[renderer.CONTEXT_UID]; return !!t && t.dirtyId === this.tex.dirtyId; }

  /** Quads lo..hi of a buffer to the GPU (one bufferSubData), or the whole buffer when it is not there yet. */
  upload(renderer, gl, buf, view, lo, hi) {
    const glb = buf._glBuffers?.[renderer.CONTEXT_UID];
    const a = lo * 4 * STRIDE, len = (hi - lo + 1) * 4 * STRIDE;
    if ( !glb?.buffer || glb.updateID !== buf._updateID || renderer.context.webGLVersion < 2 ) { buf.update(); renderer.buffer.update(buf); return; }
    gl.bindBuffer(gl.ARRAY_BUFFER, glb.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, a * 4, view, a, len);
    batchStats.uploads++; batchStats.uploadKB += len * 4 / 1024;
  }

  /** Back to the pool (the area flattened again, or gone); the base sprite draws itself again. */
  destroy(options) {
    if ( this.base && !this.base.destroyed && this.folded ) this.base.renderable = true;
    this.folded = false; this.base = null;
    if ( this.G ) { giveGeometry(this.G); this.G = null; }
    this.px = this.py = this.sx = this.sy = this.rot = this.pa = this.pt = this.flags = this.dirty = this.ct = this.ca = this.cc = null;
    super.destroy(options);
  }
}

/* ------------------------------------------------------------------ pixel-art accents as one batched layer */

/**
 * The entries' pixel-art accents (flash, rings, flames, cracks, bolts... pixel-fx.mjs drawing into a canvas) were one pooled
 * one-pixel sprite each, children of the fx layer: the pool only grew (its high-water mark: ~0.8 M sprites after a few whole-scene
 * Detonates of 'map') and the scene graph walked every one of them every frame, at rest too. A RectCanvas has the same calls
 * (beginFill, drawRect, endFill, clear, destroy, blendMode, clip, stats) and keeps its rects in a typed array; the RectLayer draws
 * every live canvas's rects in creation order as quads of one geometry, one draw per run of canvases with the same blend mode.
 */
export class RectCanvas {
  constructor(layer) { this.layer = layer; this.d = new Float64Array(64 * 5); this.n = 0; this.c = 0xffffff; this.a = 1; this.blendMode = 0; this.destroyed = false; this.eventMode = "none"; layer.canvases.push(this); }
  clear() { this.n = 0; return this; }
  beginFill(c, a = 1) { this.c = c; this.a = a; return this; }
  endFill() { return this; }
  drawRect(x, y, w, h) {
    const r = this.clip; if ( r && (x < r.x0 || y < r.y0 || x >= r.x1 || y >= r.y1) ) { if ( this.stats ) this.stats.culledPx = (this.stats.culledPx ?? 0) + 1; return this; }
    if ( !(this.a > 0) ) return this;
    if ( (this.n + 1) * 5 > this.d.length ) { const g = new Float64Array(this.d.length * 2); g.set(this.d); this.d = g; }
    const o = this.n * 5;
    if ( this.c !== this.lc || this.a !== this.la ) {      // (the packed colour of the current fill, made once per fill)
      const C = PIXI.Color.shared; this.lc = this.c; this.la = this.a;
      this.col = C.setValue(C.setValue(this.c).toLittleEndianNumber()).toPremultiplied(Math.min(this.a, 1), true);
    }
    this.d[o] = x; this.d[o + 1] = y; this.d[o + 2] = w; this.d[o + 3] = h; this.d[o + 4] = this.col;
    this.n++;
    return this;
  }
  destroy() { this.destroyed = true; this.n = 0; }
}

export class RectLayer extends PIXI.Container {
  constructor() {
    super();
    this.eventMode = "none"; this.canvases = []; this.cap = 0; this.G = null; this.states = new Map();
  }
  grow(q) {
    let cap = Math.max(1024, this.cap); while ( cap < q ) cap *= 2;
    if ( cap === this.cap ) return;
    if ( this.G ) { this.G.geom.destroy(); this.G.bd.destroy(); this.G.bs.destroy(); }
    const dyn = new ArrayBuffer(cap * 4 * STRIDE * 4), stat = new Float32Array(cap * 4 * STRIDE);
    for ( let i = 0; i < cap * 4; i++ ) { stat[i * 3] = 0.5; stat[i * 3 + 1] = 0.5; stat[i * 3 + 2] = 0; }   // the middle of WHITE, slot 0
    const bd = new PIXI.Buffer(new Float32Array(dyn), false, false), bs = new PIXI.Buffer(stat, true, false);
    const geom = new PIXI.Geometry()
      .addAttribute("aVertexPosition", bd, 2, false, PIXI.TYPES.FLOAT, 12, 0)
      .addAttribute("aColor", bd, 4, true, PIXI.TYPES.UNSIGNED_BYTE, 12, 8)
      .addAttribute("aTextureCoord", bs, 2, false, PIXI.TYPES.FLOAT, 12, 0)
      .addAttribute("aTextureId", bs, 1, false, PIXI.TYPES.FLOAT, 12, 8)
      .addIndex(sharedIndex(cap));
    this.cap = cap; this.G = { geom, bd, bs, F: bd.data, U: new Uint32Array(dyn) };
  }
  stateFor(mode) { let s = this.states.get(mode); if ( !s ) { s = PIXI.State.for2d(); s.blendMode = mode; this.states.set(mode, s); } return s; }
  _render(renderer) {
    let q = 0, w = 0;
    const cs = this.canvases;
    for ( let i = 0; i < cs.length; i++ ) { const c = cs[i]; if ( c.destroyed ) continue; cs[w++] = c; q += c.n; }
    cs.length = w;
    if ( !q ) return;
    this.grow(q);
    const M = this.worldTransform, { F, U } = this.G, runs = [];
    let k = 0;
    for ( const c of cs ) {
      if ( !c.n ) continue;
      const bm = c.blendMode | 0, last = runs[runs.length - 1];
      if ( last && last.bm === bm ) last.n += c.n; else runs.push({ bm, at: k, n: c.n });
      const d = c.d;
      for ( let j = 0; j < c.n; j++, k++ ) {
        const o = j * 5, x0 = d[o], y0 = d[o + 1], x1 = x0 + d[o + 2], y1 = y0 + d[o + 3], v = k * 4 * STRIDE, col = d[o + 4];
        F[v] = M.a * x0 + M.c * y0 + M.tx; F[v + 1] = M.b * x0 + M.d * y0 + M.ty;
        F[v + 3] = M.a * x1 + M.c * y0 + M.tx; F[v + 4] = M.b * x1 + M.d * y0 + M.ty;
        F[v + 6] = M.a * x1 + M.c * y1 + M.tx; F[v + 7] = M.b * x1 + M.d * y1 + M.ty;
        F[v + 9] = M.a * x0 + M.c * y1 + M.tx; F[v + 10] = M.b * x0 + M.d * y1 + M.ty;
        U[v + 2] = U[v + 5] = U[v + 8] = U[v + 11] = col;
      }
    }
    const sh = renderer.plugins.batch?._shader; if ( !sh ) return;
    renderer.batch.flush();
    renderer.texture.bind(PIXI.Texture.WHITE.baseTexture, 0);
    renderer.shader.bind(sh);
    renderer.geometry.bind(this.G.geom, sh);
    const glb = this.G.bd._glBuffers?.[renderer.CONTEXT_UID];
    if ( glb?.buffer && glb.updateID === this.G.bd._updateID && renderer.context.webGLVersion >= 2 ) {
      const gl = renderer.gl; gl.bindBuffer(gl.ARRAY_BUFFER, glb.buffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, F, 0, k * 4 * STRIDE);
    } else { this.G.bd.update(); renderer.buffer.update(this.G.bd); }
    for ( const r of runs ) { renderer.state.set(this.stateFor(r.bm)); renderer.geometry.draw(PIXI.DRAW_MODES.TRIANGLES, r.n * 6, r.at * 6); }
    batchStats.rects = k;
  }
  destroy(o) { if ( this.G ) { this.G.geom.destroy(); this.G.bd.destroy(); this.G.bs.destroy(); this.G = null; } this.canvases = []; super.destroy(o); }
}
