import { MODULE_ID } from "../config.mjs";
import { perfLow } from "../perf-mode.mjs";
import { cachedSetting } from "../setting-cache.mjs";
import { bandKey as bandKeyOf } from "../net/chunks.mjs";
import { SHARP_SAMPLER_GLSL, BLEND0 } from "./sharp-sampler.mjs";

/**
 * STATIC CACHE of the destruction layer (PERF). Every damage object (map patch + ruin + shards, an erase stroke, ...) is a container in
 * `display.live`, in creation order. Drawn live that was ~45k shard sprites and ~150 sprite-mask passes per frame on a busy scene
 * (16-26 ms CPU + 11-18 ms GPU). Instead, what does not move is drawn ONCE into render textures (BANDS) and only what moves is drawn
 * live, in the right order:
 *
 *  - UNITS: every object is one unit, except that a flooded hole's water (an animated loop, flood.mjs) is a unit of its own on top of
 *    its object. A unit is LIVE when it moves: an entry, a cross-fade, a dissolving erase stroke, a fading or held old look, shards
 *    still being made, a visible pulsing cause bloom, the water.
 *  - LEVELS: static units sit on even levels (band 0, band 1, ...), live units on odd ones (run 0, run 1, ...). A unit's level is the
 *    lowest one of its parity that is not below any EARLIER unit it overlaps (strictly above when the parity differs). Two units that
 *    do not overlap commute, so drawing band 0, run 0, band 1, run 1, ... (each in creation order) gives the same pixels as drawing
 *    everything live. Usually: band 0 = nearly everything, run 0 = the moving stroke(s) and the water, band 1 = the few later strokes
 *    lying over the water.
 *  - A band is drawn into render textures covering its own content (sparse tiles: none where no member lies), re-drawn only when
 *    its members change (an entry ends, water arrives, a new bake is shown), on a sampling switch (the atlases' NEAREST/LINEAR, with
 *    the display's own hysteresis), a GL context loss, or a density / window change. A band whose members did not change keeps its
 *    textures (a new stroke entering on top re-draws nothing underneath).
 *  - SCENE mode: 1 texel per scene pixel (mipmapped: zoomed out it is sampled like the live atlases), all bands together capped at
 *    16 MPx (big scenes get less). VIEW mode, zoomed in past 1.4 screen px per texel: the bands only around the view at 1 texel per
 *    screen pixel (the same pixels as live); re-drawn when the view leaves its window or the zoom changes by 15%.
 *  - Off: `CONFIG.moinenMaps.noDestructionCache = true` or the client setting "destructionCache".
 * - Zoom sampling, `CONFIG.moinenMaps.zoomAA`: 'edge' (default; true too) = THE ONE SAMPLER (sharp-sampler.mjs: the exact box filter of the pixel's
 *   footprint, no NEAREST / LINEAR switch, no ramp, no taps) for the band tiles AND the live layer (sharp-batch.mjs: sprites, batched and GPU
 *   pieces, the map patch's cover) so a zoom, a pan or a shaking camera never makes texel edges snap or shimmer; 'mips' = the previous
 *   scale-only 4-tap mip filter + the old resting sampler, `false` = the original time-varying softening. Knobs: `edgeK` (footprint
 *   scale, 1 exact), `edgeBlend` (where in an octave the minified levels start to blend, 0.75).
 * Passes hide objects with `renderable` (never `visible`: the cause lights read `visible`). While the cache shows, `live` itself is not
 * visible (its sprites are not even transformed) and RUN objects update and draw the live units from it, in order.
 */
const MAX_MPX = 16e6;
const LIVE_SHARE = 0.7;        // more than this share of the objects moving (a Detonate): no cache at all, no bake
const MOVE_MARGIN = 48;        // art px around a moving object (flying pieces, shakes)
const SETTLE_MS = 500;         // objects that stopped moving are drawn live this long after the last start/stop, then cached
const WATER_SLOT = { renderable: true, parent: null, destroyed: false };   // a flooded hole's water that is not here yet (draws nothing)

export const cacheEnabled = () => {
  if ( perfLow() ) return true;                                  // performance mode Low: always
  if ( globalThis.CONFIG?.moinenMaps?.noDestructionCache ) return false;
  return cachedSetting("destructionCache", true) !== false;      // (PERF: not a settings read per frame)
};

let CID = 0;
const cidOf = (o) => o._mmCid ?? (o._mmCid = ++CID);

/**
 * Pure: the level of every unit (render order). `units[i]` = { r: {x0,y0,x1,y1}, live: bool, m: margin }. Statics get even levels,
 * live units odd ones; a unit is never below an earlier unit it overlaps (strictly above across parities). O(n^2) rectangle tests.
 */
export function levels(units) {
  const lv = new Array(units.length);
  for ( let i = 0; i < units.length; i++ ) {
    const u = units[i], par = u.live ? 1 : 0;
    let L = par;
    for ( let j = 0; j < i; j++ ) {
      const q = units[j], m = Math.max(u.m ?? 0, q.m ?? 0);
      if ( q.r.x0 >= u.r.x1 + m || q.r.x1 <= u.r.x0 - m || q.r.y0 >= u.r.y1 + m || q.r.y1 <= u.r.y0 - m ) continue;
      const need = lv[j] + ((lv[j] & 1) === par ? 0 : 1);
      if ( need > L ) L = need;
    }
    lv[i] = L;
  }
  return lv;
}

/** Texels per scene pixel for the cache: 1 (zoomed out) or up to 3 (zoomed in), capped so a scene-sized band stays under MAX_MPX. */
export function cacheRes(sceneW, sceneH, zoomedIn = false) {
  const cap = Math.sqrt(MAX_MPX / Math.max(1, sceneW * sceneH));
  if ( zoomedIn ) return Math.max(Math.min(1, cap), Math.min(3, Math.floor(cap * 4) / 4));
  return cap >= 1 ? 1 : Math.max(0.25, Math.floor(cap * 8) / 8);
}

/**
 * Mip levels for a band (or a flattened area): zoomed out the live atlases are sampled with mipmaps; a band without them aliases (5%
 * of the pixels off by more than 60 at zoom 0.5). PIXI 7 does not build them for a render texture by itself after it is drawn into,
 * so: mark it mipmapped and let PIXI re-apply its style (generateMipmap plus the MIN / MAG filters from ITS scaleMode, NEAREST or
 * LINEAR) - no GL filter set behind PIXI's back (a hand-set LINEAR_MIPMAP_LINEAR stayed on the texture whatever its scaleMode).
 */
export function mipmaps(R, rt) {
  if ( !R.gl ) return;
  const bt = rt.baseTexture;
  bt.mipmap = PIXI.MIPMAP_MODES.ON;
  bt.dirtyStyleId++;
  R.renderTexture.bind(null);
  R.texture.bind(bt, 0);                                  // -> updateTextureStyle: mipmaps rebuilt, filters from bt.scaleMode
}

/** The sampling of every texture of the display's areas (atlases, flattened areas, covers): NEAREST 0 / LINEAR 1. */
export function setSampling(d, mode, groups = null) {
  // (PERF: a texture whose sampling changes has its mip levels rebuilt at its next bind - generateMipmap on a whole atlas: a bake that
  // flipped all ~270 areas for a band of one stroke rebuilt ~80 atlases' mips in one frame, ~40 ms of driver time. `groups`: only those)
  for ( const g of groups ?? d.groups.values() ) {
    if ( g.tex && g.tex.scaleMode !== mode ) g.tex.scaleMode = mode;
    if ( g.flatTex && g.flatTex.baseTexture.scaleMode !== mode ) g.flatTex.baseTexture.scaleMode = mode;
    if ( g.coverTex && g.coverTex.baseTexture.scaleMode !== mode ) g.coverTex.baseTexture.scaleMode = mode;
  }
}

/**
 * One band tile drawn with a SHARP-BILINEAR shader: magnified, every texel is a crisp square with one screen pixel of smoothing at its
 * edges (fractional zooms neither blur nor alias the art); minified, the mipmaps as usual. The same texture therefore looks the same
 * at every zoom, apart from its size: no NEAREST / LINEAR switch and no change of the drawing texture with the zoom.
 */
const SHARP_VERT = `#version 300 es
precision highp float;
in vec2 aVertexPosition;
in vec2 aUV;
uniform mat3 projectionMatrix;
out vec2 vUV;
void main() {
  gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;
const SHARP_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uScale;
uniform float uSharp;
uniform float uSoft;
uniform vec2 uSoftK;
uniform float uAA;
uniform float uAlpha;
uniform float uMode;
uniform float uK;
uniform float uTop;
out vec4 fragColor;
${SHARP_SAMPLER_GLSL}
// one filtered sample of the tile at uv (the resting sampler: crisp texel squares with a screen pixel of smoothing when magnified,
// the mipmaps when minified)
vec4 samp(vec2 uv) {
  if ( uScale > 1.0 ) {
    vec2 p = uv * uSize - 0.5;
    vec2 i = floor(p), fr = p - i;
    // uSharp 0: plain bilinear (as the live layer below its NEAREST switch, and as the map); 1: crisp texels with one screen pixel
    // of smoothing at their edges
    vec2 f = mix(fr, clamp((fr - 0.5) * uScale + 0.5, 0.0, 1.0), uSharp);
    return textureLod(uTex, (i + 0.5 + f) / uSize, 0.0);
  }
  return texture(uTex, uv);
}
void main() {
  vec4 c;
  if ( uMode > 0.5 ) {
    // EDGE (default): the one sampler (sharp-sampler.mjs), the exact box filter of the pixel's footprint at every scale: texel edges get
    // one screen pixel of anti-aliasing when magnified, thin lines keep their ink when minified; no taps, no ramp, no per-tile state
    c = sharpSampleT(uTex, vUV, dFdx(vUV), dFdy(vUV), uK, uTop);
  } else if ( uAA > 0.0 ) {
    // ZOOM AA (a fixed spatial filter of the SCALE, the same for every tile and every frame - no time-varying softening, so no tile
    // or band is ever blurred differently from its neighbour): four taps on a rotated grid inside the screen pixel's footprint,
    // each through the mipmaps (the footprint of one screen pixel is the derivative of the uv, so it is right at every scale)
    vec2 dx = dFdx(vUV) * uAA, dy = dFdy(vUV) * uAA;
    c = 0.25 * (samp(vUV + dx * 0.125 + dy * 0.375) + samp(vUV + dx * 0.375 - dy * 0.125)
              + samp(vUV - dx * 0.125 - dy * 0.375) + samp(vUV - dx * 0.375 + dy * 0.125));
  } else if ( uSoft > 0.0 ) {
    // (the old time-varying softening, CONFIG.moinenMaps.zoomAA = false) while the zoom moves: four bilinear taps half a texel apart
    if ( uScale > 1.0 ) {
      c = samp(vUV);
      vec2 h = uSoftK.x / uSize;
      vec4 s = 0.25 * (textureLod(uTex, vUV + vec2(-h.x, -h.y), 0.0) + textureLod(uTex, vUV + vec2(h.x, -h.y), 0.0)
                     + textureLod(uTex, vUV + vec2(-h.x, h.y), 0.0) + textureLod(uTex, vUV + vec2(h.x, h.y), 0.0));
      c = mix(c, s, uSoft);
    } else c = texture(uTex, vUV, uSoft * uSoftK.y);
  } else c = samp(vUV);
  fragColor = c * uAlpha;
}`;
/**
 * ZOOM SOFTENING (0..1), shared by every tile: 1 while the canvas scale changes, back to 0 over SOFT_MS after it stops. Resampled at a
 * scale that drifts, fine pixel art beats against the screen grid - bands of sharp and blurred texels sweep across it (the "waving"
 * in the last phase of a zoom-out); a phase-independent kernel while it moves, crisp again when it stands still.
 */
let zoomSoft = 0;
const SOFT_RATE = 0.35;                                  // css px per frame the farthest screen point must move to count as 'zooming' (CONFIG.moinenMaps.softRate)
const SOFT_MS = 80;                                     // (was 220: the user found the wait after a zoom too long; CONFIG.moinenMaps.softMs to try others)
// the taps' distance (texels) when magnified and the mip bias when minified (CONFIG.moinenMaps.zoomSoftK to try others): measured on
// "map" (wavingCheck beat, 1.3 -> 0.98 / 1.0 -> 0.3): none 0.118 / 0.142, 0.5 & 0.5 0.095 / 0.096, 0.75 & 1 0.038 / 0.061, 1 & 1.5 0.035 / 0.058
const SOFT_TAP = 0.35, SOFT_BIAS = 0.5;
const RAMP0 = 2.0;                                       // screen px per texel where the crisp ramp starts (CONFIG.moinenMaps.sharpFrom: dev knob)
/**
 * Pure: the width (screen pixels x 2.67, 1 = taps +-0.375 px) of the zoom anti-aliasing filter at `scale` screen px per texel. A function
 * of the scale ONLY (never of time or of the tile): full `a` up to `s0`, none from `s1` (smoothstep between, continuous and monotone), so
 * a zoom glides through it without a pop. k = [a, s0, s1].
 */
export function aaWeight(scale, k = null) {
  const a = k?.[0] ?? AA_K[0], s0 = k?.[1] ?? AA_K[1], s1 = k?.[2] ?? AA_K[2];
  if ( !(scale > 0) || a <= 0 ) return 0;
  if ( scale <= s0 ) return a;
  if ( scale >= s1 ) return 0;
  const t = (scale - s0) / (s1 - s0);
  return a * (1 - t * t * (3 - 2 * t));
}
const AA_K = [1.5, 0.8, 1.0];
let sharpProgram = null;
/** The band tiles' program (one for all; scripts/load-warm.mjs links it ahead). */
export const sharpTileProgram = () => (sharpProgram ??= PIXI.Program.from(SHARP_VERT, SHARP_FRAG, "moinen-sharp-tile"));

export class SharpTile extends PIXI.Container {
  constructor(rt, w, h, res) {
    super();
    this.eventMode = "none";
    this.rt = rt; this.w = w; this.h = h; this.res = res;
    this.texture = rt;                                  // (for code that reads a tile's texture)
    this.pos = new Float32Array(8); this.uv = new Float32Array(8);
    this.geom = new PIXI.Geometry()
      .addAttribute("aVertexPosition", new PIXI.Buffer(this.pos, false, false), 2)
      .addAttribute("aUV", new PIXI.Buffer(this.uv, false, false), 2)
      .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
    this.shader = new PIXI.Shader(sharpTileProgram(), { uTex: rt, uSize: new Float32Array(2), uScale: 1, uSharp: 0, uSoft: 0, uSoftK: new Float32Array([0.5, 0.5]), uAA: 0, uAlpha: 1, uMode: 0, uK: 1, uTop: 0, uSharpB: 0 });
    this.state = PIXI.State.for2d();
  }

  render(renderer) {
    if ( !this.visible || this.worldAlpha <= 0 || !this.renderable || !this.rt?.valid ) return;
    const M = this.worldTransform, w = this.w, h = this.h, p = this.pos, uv = this.uv, u = this.rt._uvs;
    const xs = [0, w, w, 0], ys = [0, 0, h, h];
    for ( let k = 0; k < 4; k++ ) { p[k * 2] = M.a * xs[k] + M.c * ys[k] + M.tx; p[k * 2 + 1] = M.b * xs[k] + M.d * ys[k] + M.ty; }
    uv[0] = u.x0; uv[1] = u.y0; uv[2] = u.x1; uv[3] = u.y1; uv[4] = u.x2; uv[5] = u.y2; uv[6] = u.x3; uv[7] = u.y3;
    this.geom.getBuffer("aVertexPosition").update(); this.geom.getBuffer("aUV").update();
    const b = this.rt.baseTexture, un = this.shader.uniforms;
    un.uTex = this.rt; un.uSize[0] = b.realWidth; un.uSize[1] = b.realHeight;
    // screen pixels per texel (the canvas's own resolution included)
    // (`nearest`: the live layer samples NEAREST now - zoomed in past 3 screen px per art pixel - so the tile does too, a hard step at
    // every texel edge, the same pixels as the shards in an entry frame; else one screen pixel of smoothing at each texel edge)
    // (the scale of the VIEW: the canvas's own transform - the same as M's when drawn to the screen, and right when the harness draws the layer
    // into a texture with a transform of its own, where M is local)
    const P = canvas.primary?.worldTransform, sc = (P ? Math.hypot(P.a, P.b) : Math.hypot(M.a, M.b)) * (renderer.resolution || 1) / this.res;
    un.uScale = this.nearest ? 1e4 : sc; un.uAlpha = this.worldAlpha;
    // WAVING (v0.4.1, "zniszczenia falują" in the last phase of a zoom-out): sharpened at 1-2.5 screen px per texel, every texel was
    // drawn one or two pixels wide by turns and the pattern crawled with every step of a gliding zoom (the cache shimmered 1.7x the
    // live layer: dev/perf-harness wavingCheck) and the clamped edge of a tile showed as a line. So: plain bilinear up to 1.5 screen
    // px per texel (like the live layer and the map), crisp from 3 (where the live layer turns NEAREST), a smooth ramp between
    // (the ramp starts at 2.0, not 1.5: the live layer is plain LINEAR until it turns NEAREST at 3 screen px per texel - the resting
    // cache was 5-11 % crisper than it at 2-3 ("map" at 200 % DPR, crispCheck 1.113 / 1.048 / 1.075 -> 0.99); wavingCheck unchanged)
    const r0 = globalThis.CONFIG?.moinenMaps?.sharpFrom ?? RAMP0;
    un.uSharp = this.nearest ? 1 : Math.min(1, Math.max(0, (un.uScale - r0) / (3 - r0)));
    const cm = globalThis.CONFIG?.moinenMaps, aaOn = cm?.zoomAA !== false, edge = aaOn && cm?.zoomAA !== "mips";
    un.uMode = edge ? 1 : 0; un.uK = cm?.edgeK ?? 1; un.uSharpB = cm?.edgeBlend ?? BLEND0;
    un.uTop = b.mipmap === PIXI.MIPMAP_MODES.OFF ? 0 : Math.floor(Math.log2(Math.max(b.realWidth, b.realHeight)));   // (mip levels there are only when the tile has them)
    un.uSoft = aaOn || cm?.noZoomSoft ? 0 : zoomSoft;   // (dev knob for comparison; with zoomAA there is no time-varying softening at all)
    un.uAA = aaOn ? aaWeight(sc, cm?.aaK) : 0;
    const sk = globalThis.CONFIG?.moinenMaps?.zoomSoftK; un.uSoftK[0] = sk?.[0] ?? SOFT_TAP; un.uSoftK[1] = sk?.[1] ?? SOFT_BIAS;
    renderer.batch.flush();
    renderer.shader.bind(this.shader);
    renderer.state.set(this.state);
    renderer.geometry.bind(this.geom, this.shader);
    renderer.geometry.draw(PIXI.DRAW_MODES.TRIANGLES, 6, 0);
  }

  destroy(options) { this.geom?.destroy(); this.geom = null; this.shader?.destroy?.(); this.shader = null; super.destroy(options); }
}

/** Draws given display objects (living elsewhere in the tree, their transforms kept current there) at its place in the order. */
class Run extends PIXI.Container {
  constructor(live) { super(); this.live = live; this.items = []; this.eventMode = "none"; }
  render(renderer) {
    if ( !this.visible || !this.items.length ) return;
    // `live` is not visible while the cache shows (so its ~45k sprites are not even transformed): bring what this run draws up to date
    const live = this.live, p = live.parent; if ( !p ) return;
    live.transform.updateTransform(p.transform); live.worldAlpha = live.alpha * p.worldAlpha;
    for ( const o of this.items ) {
      if ( o.destroyed || !o.parent ) continue;
      if ( o.parent !== live ) { const c = o.parent; c.transform.updateTransform(live.transform); c.worldAlpha = c.alpha * live.worldAlpha; }
      o.updateTransform();
      o.render(renderer);
    }
  }
}

export class StaticCache {
  constructor(display) {
    this.d = display;
    this.show = new PIXI.Container(); this.show.eventMode = "none"; this.show.visible = false;
    display.objs.addChild(this.show);                   // over `live`, which is not drawn while this shows
    this.bands = [];                                     // [{ tiles: [{ rt, spr, x, y, w, h }] }]
    this.dirty = true; this.sig = ""; this.liveAll = true; this.mode = "live"; this.runs = [];
    // REST (PERF): when nothing the units / levels / signature depend on changed since the last full pass (`fingerprint`), update() only
    // keeps the tiles aligned; the full pass (units, O(n^2) levels, signature string) is ~0.6 ms of CPU and ~70 KB of garbage on 300 units
    this.fast = false; this.fpA = 0; this.fpB = 0; this.fpA2 = 0; this.fpB2 = 0; this.kidsSnap = []; this.settleOn = false;
    this.ids = new WeakMap(); this.nextId = 1; this.sticky = new Set(); this.act = ""; this.changedAt = 0;
    this.stats = { bakes: 0, bakeMs: 0, units: 0, live: 0, bands: 0, mode: "live", res: 0, tiles: 0, mpx: 0 };
    this._ctx = { contextChange: () => { this.dirty = true; } };
    canvas.app.renderer.runners?.contextChange?.add(this._ctx);
  }

  /** Re-draw every band at the next frame (a lost GL context, a cleared display). Membership changes are found by themselves. */
  invalidate() { this.dirty = true; }

  /** The units of the layer, in render order: [{ obj (what to draw live), cont, r, live, m, water?: sprite, owner?: unit }]. */
  units() {
    const d = this.d, kids = d.live.children;
    const ent = new Map(), dying = new Set(d.dying);
    for ( const g of d.groups.values() ) ent.set(g.cont, g);
    for ( const g of d.dying ) ent.set(g.cont, g);
    for ( const e of d.erasers.values() ) ent.set(e.cont, e);
    const out = [];
    for ( const k of kids ) {
      const g = ent.get(k);
      // something in the layer the cache does not know: live, over everything
      if ( !g ) { out.push({ obj: k, cont: k, r: { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 }, live: true, m: 0 }); continue; }
      if ( g.erase ) { const mv = !!(g.dis || g.leaving); out.push({ obj: k, cont: k, r: g.info.rect, live: mv, m: mv ? 4 : 0, g }); continue; }
      // (an area queued to enter - display.detonate sets them up a slice per frame - counts as moving already)
      const mv = dying.has(g) || !!g.anim || !!g.fade || g.made < g.pieces.length || k.alpha < 1 || !!d.enterQueue?.has(g);
      const bloom = g.light?.bloom, glow = !!(bloom && !bloom.destroyed && bloom.alpha > 0.003) || (!!g.shell && !!d.composite?.liveHashes?.has(g.hash));
      let extras = k.children.filter((ch) => ch !== g.patch && ch !== g.baseCont && ch !== g.shardCont);
      // (a flooded hole whose water had arrived when the settled composite was made - composite.mjs - keeps a water unit while its own
      // water is not here yet: the bands stay those of the composite instead of folding together for a moment)
      if ( !extras.length && g.info?.water ) extras = [WATER_SLOT];
      const self = { obj: k, cont: k, r: g.info.rect, live: mv || glow, m: mv ? MOVE_MARGIN : 0, extras, g, gl: glow && !mv };      // (gl: live only for its cause light's glow - at rest, so a composite can be published meanwhile)
      out.push(self);
      // the water of a flooded hole: its own live unit on top of its (static) object
      if ( !self.live ) for ( const w of extras ) out.push({ obj: w, cont: k, r: g.info.rect, live: true, m: 0, water: w, owner: self });
    }
    return out;
  }

  /**
   * A fingerprint of everything units() / levels() / the signature read: the objects in the layer (identity and order), each area's
   * moving flags (anim, fade, pieces still being made, cont alpha, queued to enter, cause glow, dying), its children (the water),
   * each erase stroke's dissolve / leaving flags and the scene size. No allocation: two numbers (this.fpA2/fpB2) and a kids check.
   */
  fingerprint(kids, sr) {
    const d = this.d, eq = d.enterQueue, lh = d.composite?.liveHashes;
    let a = kids.length | 0, b = 0, v;
    for ( const g of d.groups.values() ) {
      const k = g.cont, bloom = g.light?.bloom;
      v = Math.imul(cidOf(k), 0x9E3779B1) ^ ((g.anim ? 1 : 0) | (g.fade ? 2 : 0) | (g.made < g.pieces.length ? 4 : 0) | (k.alpha < 1 ? 8 : 0) | (eq?.has(g) ? 16 : 0)
        | ((bloom && !bloom.destroyed && bloom.alpha > 0.003) || (g.shell && lh?.has(g.hash)) ? 32 : 0) | (g.info.water ? 64 : 0));
      const ch = k.children;
      for ( let i = 0; i < ch.length; i++ ) v = Math.imul(v ^ cidOf(ch[i]), 0x85EBCA6B);
      a = (a + v) | 0; b ^= (v << 11) | (v >>> 21);
    }
    for ( const g of d.dying ) {
      const k = g.cont, bloom = g.light?.bloom;
      v = Math.imul(cidOf(k) + 0x1234567, 0x9E3779B1) ^ ((g.anim ? 1 : 0) | (g.fade ? 2 : 0) | (g.made < g.pieces.length ? 4 : 0) | (k.alpha < 1 ? 8 : 0) | (eq?.has(g) ? 16 : 0)
        | ((bloom && !bloom.destroyed && bloom.alpha > 0.003) || (g.shell && lh?.has(g.hash)) ? 32 : 0) | (g.info.water ? 64 : 0) | 128);
      const ch = k.children;
      for ( let i = 0; i < ch.length; i++ ) v = Math.imul(v ^ cidOf(ch[i]), 0x85EBCA6B);
      a = (a + v) | 0; b ^= (v << 11) | (v >>> 21);
    }
    for ( const e of d.erasers.values() ) {
      v = Math.imul(cidOf(e.cont) + 0x7654321, 0x9E3779B1) ^ ((e.dis ? 1 : 0) | (e.leaving ? 2 : 0));
      a = (a + v) | 0; b ^= (v << 11) | (v >>> 21);
    }
    a = (a + Math.imul((sr.width | 0) + 31 * (sr.height | 0) + 977 * ((globalThis.CONFIG?.moinenMaps?.destructionCacheRes * 100) | 0), 0x2545F491)) | 0;
    this.fpA2 = a; this.fpB2 = b;
    const snap = this.kidsSnap;
    if ( snap.length !== kids.length ) return false;
    for ( let i = 0; i < kids.length; i++ ) if ( snap[i] !== kids[i] ) return false;
    return a === this.fpA && b === this.fpB;
  }

  /** Once per frame, after the display's tick. */
  update() {
    // the zoom softening: is the scale moving?
    if ( globalThis.CONFIG?.moinenMaps?.zoomAA !== false ) zoomSoft = 0;
    else { const sc = canvas.stage?.scale?.x ?? 0, t = performance.now();
      // (the view eases into its final scale for a long, tiny tail: only a scale change that still moves the screen's farthest point by more
      // than `softRate` css px in a frame counts as moving, so the softening is gone as soon as the zoom is visibly slow; was any change > 1e-5)
      if ( this.lastScale ) {
        const s = canvas.app?.screen, edge = s ? 0.5 * Math.hypot(s.width, s.height) : 800, rate = globalThis.CONFIG?.moinenMaps?.softRate ?? SOFT_RATE;
        if ( Math.abs(sc / this.lastScale - 1) * edge > rate ) this.movedAt = t;
      }
      this.lastScale = sc;
      zoomSoft = this.movedAt ? Math.max(0, 1 - (t - this.movedAt) / (globalThis.CONFIG?.moinenMaps?.softMs ?? SOFT_MS)) : 0; }
    const d = this.d, kids = d.live.children, sr = canvas.dimensions?.sceneRect, R = canvas.app?.renderer;
    if ( !cacheEnabled() || !kids.length || !sr || !R ) return this.allLive("off");
    const same = this.fingerprint(kids, sr);
    if ( same && this.fast && !this.dirty && !this.tilesLost() && !globalThis.CONFIG?.moinenMaps?.noFastRest ) {   // (noFastRest: dev knob, A/B)            // REST: nothing the bands / runs depend on changed
      this.align(canvas.stage.scale.x * (R.resolution || 1));
      d.live.visible = false; this.show.visible = true;
      return;
    }
    this.fast = false;
    const U = this.units();
    const moving = U.reduce((a, u) => a + (u.live && !u.water ? 1 : 0), 0);
    if ( moving > kids.length * LIVE_SHARE ) { this.sticky.clear(); return this.allLive("busy"); }
    // STICKY: an object that stops moving stays live until nothing has started or stopped for SETTLE_MS, so the end of a Detonate
    // (areas settling one after another) re-draws the bands once, not once per area (drawing a still object live is still exact)
    const now = performance.now(), act = U.map((u) => (u.live ? 1 : 0)).join("");
    if ( act !== this.act ) { this.act = act; this.changedAt = now; }
    if ( this.sticky.size && now - this.changedAt < SETTLE_MS ) for ( const u of U ) if ( !u.live && this.sticky.has(u.obj) ) { u.live = true; u.m = MOVE_MARGIN; }
    // (an object held live that way draws its own water inside its container: a water unit of its own would draw it a second time, over it,
    // until the object settles into the bands - the flood's blue came out doubled for SETTLE_MS after its entry ended, then dropped: endPopCheck)
    for ( let i = U.length - 1; i >= 0; i-- ) if ( U[i].water && U[i].owner.live ) { U[i].water.renderable = true; U.splice(i, 1); }
    const z = canvas.stage.scale.x * (R.resolution || 1);
    const zoomedIn = d.filter === 0;                     // the atlases are sampled NEAREST
    let res = globalThis.CONFIG?.moinenMaps?.destructionCacheRes ?? cacheRes(sr.width, sr.height, false);   // (dev knob)
    const eff = Math.min(res, this.capRes ?? res);       // what the memory cap allowed at the last scene-wide bake
    // zoomed in further than the scene-wide bands can show sharply (more than 1.4 screen px per texel): VIEW mode, the bands only
    // around the view (half a view of margin each side), 1 texel per screen pixel (exact); kept while the view stays inside the window
    // and the zoom within 15%, then drawn again (hysteresis both ways: back to scene-wide below 1.2)
    const inView = !!this.win;
    // (VIEW mode is off: the bands are drawn sharp at any magnification by SharpTile, so the look no longer changes at a switch and a
    // pan never re-draws them; `CONFIG.moinenMaps.cacheViewMode = true` brings it back for comparison)
    const needView = !!globalThis.CONFIG?.moinenMaps?.cacheViewMode && z > eff * (inView ? 1.2 : 1.4);
    if ( needView ) {
      const v = this.viewRect(), w = this.win;
      if ( !w || v.x0 < w.x0 || v.y0 < w.y0 || v.x1 > w.x1 || v.y1 > w.y1 || z / w.res > 1.15 || w.res / z > 1.15 ) {
        const mx = (v.x1 - v.x0) * 0.5, my = (v.y1 - v.y0) * 0.5;
        this.win = { x0: Math.floor(v.x0 - mx), y0: Math.floor(v.y0 - my), x1: Math.ceil(v.x1 + mx), y1: Math.ceil(v.y1 + my), res: Math.round(z * 100) / 100 };
        this.stats.windows = (this.stats.windows ?? 0) + 1;
      }
      res = this.win.res;
    } else this.win = null;
    const W = this.win;
    const lv = levels(U);
    // (no sampling flag: the bands are drawn one texel per scene pixel, where the live layer's NEAREST and LINEAR give the same texels
    // - measured equal on "map" - so a zoom across that switch re-draws nothing)
    const sig = `${U.length}|${res}|${W ? `${W.x0},${W.y0},${W.x1},${W.y1}` : "scene"}|${U.map((u, i) => (u.live ? "L" : "") + lv[i]).join(",")}`;
    if ( this.dirty || sig !== this.sig || this.tilesLost() ) {
      this.bake(U, lv, sr, res, !W, W);
      this.sig = sig; this.dirty = false;
      this.sticky = new Set(U.filter((u) => u.live && !u.water).map((u) => u.obj));
    }
    // the runs: the live units of each odd level, in order
    for ( const run of this.runs ) run.items.length = 0;
    for ( let i = 0; i < U.length; i++ ) if ( lv[i] & 1 ) this.runs[lv[i] >> 1]?.items.push(U[i].obj);
    for ( const k of kids ) k.renderable = true;
    for ( const u of U ) if ( u.water ) u.water.renderable = true;
    this.align(z);
    d.live.visible = false;
    this.show.visible = true;
    this.liveAll = false; this.mode = this.stats.mode = (W ? "view" : "scene") + (moving || U.some((u) => u.water) ? "+live" : "");
    this.stats.units = U.length; this.stats.live = U.filter((u) => u.live).length;
    // the fast path may take over once the units are not being held live by SETTLE_MS (the sticky set), nor in the dev view mode
    this.fast = !(this.sticky.size && now - this.changedAt < SETTLE_MS) && !W && !globalThis.CONFIG?.moinenMaps?.cacheViewMode;
    this.fpA = this.fpA2; this.fpB = this.fpB2; this.kidsSnap.length = 0; for ( const k of kids ) this.kidsSnap.push(k);
  }

  /** A band texture lost (context loss, destroyed): the bands are drawn again. */
  tilesLost() {
    for ( const b of this.bands ) for ( const t of b.tiles ) if ( !t.rt.valid || t.rt.baseTexture.destroyed ) return true;
    return false;
  }

  /**
   * When a texel is a screen pixel (a view window at its own zoom, the scene bands at zoom 1), put every tile on whole screen pixels:
   * a pan leaves the canvas at fractional offsets and the cache would be resampled half a pixel off (blurred). The shift is under half
   * a screen pixel.
   */
  align(z) {
    const M = this.show.parent?.worldTransform, res = this.stats.res; if ( !M ) return;
    const one = Math.abs(z / res - 1) < 0.01, a = M.a, dpr = canvas.app.renderer.resolution || 1, nearest = this.d.filter === 0;
    for ( const b of this.bands ) for ( const t of b.tiles ) {
      // magnified: the live layer's sampling (an entry frame and the rest look alike). An art pixel of 2+ texels is copied as a block at ANY
      // magnification too: its texels are one colour, so only the art pixels' own edges move (by under half a screen pixel, as in the live
      // layer's NEAREST), and the rim no longer comes out as a half-transparent LINEAR ramp where the live layer is crisp (gapCheck, zoom 1-1.5)
      t.spr.nearest = nearest && (z / res > 1.5 || (res * this.d.ap >= 2 && !globalThis.CONFIG?.moinenMaps?.cacheLinearRim));   // (cacheLinearRim: dev knob, the old look)
      // (pixel-aligned tiles are crisper than the live layer, which sits at the pan's fractional offset like the map: 1.3x the gradient at
      // zoom 1 on "map" - off unless `CONFIG.moinenMaps.cacheAlign` is set; the resting look is the live look)
      if ( !one || !globalThis.CONFIG?.moinenMaps?.cacheAlign ) { t.spr.position.set(t.x, t.y); continue; }
      const sx = (a * t.x + M.tx) * dpr, sy = (M.d * t.y + M.ty) * dpr;
      t.spr.position.set(t.x + (Math.round(sx) - sx) / (a * dpr), t.y + (Math.round(sy) - sy) / (M.d * dpr));
    }
  }

  /** The visible part of the canvas (canvas px). */
  viewRect() {
    const v = canvas.app.renderer.screen, tl = canvas.stage.toLocal({ x: 0, y: 0 }), br = canvas.stage.toLocal({ x: v.width, y: v.height });
    return { x0: Math.min(tl.x, br.x), y0: Math.min(tl.y, br.y), x1: Math.max(tl.x, br.x), y1: Math.max(tl.y, br.y) };
  }

  allLive(why) {
    this.fast = false;
    // drawn live, shells (areas shown from the settled composite only) would be missing: their pixels are asked for
    if ( this.d.shellCount ) this.d.needPixels?.([...this.d.groups.values()].filter((g) => g.shell));
    if ( !this.liveAll ) {
      this.d.live.visible = true;
      for ( const k of this.d.live.children ) k.renderable = true;
      this.show.visible = false;
      this.liveAll = true;
    }
    if ( why === "off" && this.bands.length ) this.freeBands();   // nothing to cache: keep no textures
    this.mode = this.stats.mode = why; this.stats.live = this.d.live.children.length;
  }

  freeBands(bands = this.bands) {
    for ( const b of bands ) for ( const t of b.tiles ) { t.spr.destroy(); if ( !t.shared ) t.rt.destroy(true); }   // (a composite tile's texture is the composite's)
    if ( bands === this.bands ) {
      this.bands = []; this.show.removeChildren(); this.runs = []; this.sig = "";
      Object.assign(this.stats, { bands: 0, tiles: 0, mpx: 0 });
    }
  }

  /**
   * Draw the bands (statics of each even level, in order) into textures covering their content and build the show list. A band whose
   * members and density are unchanged keeps its textures (a new stroke entering on top re-draws nothing underneath).
   */
  bake(U, lv, sr, res, mips, win = null) {
    // A band is drawn ONCE and kept, so it must be drawn complete: a batched area whose atlas is not on the GPU yet (a warm refresh's
    // swapped-in area, a re-opened one) defers its pieces to a later frame (piece-batch / piece-gpu atlasReady) and the band was drawn
    // with the ruin only - and stayed so, nothing re-drew it when the pieces came: the warm player's cache short of the GM's by those
    // areas' shards (shown.max 67-96 against live 1; "warm player stuck", 2026-11-02). Uploaded now, in the draw.
    const cm = (globalThis.CONFIG.moinenMaps ??= {}), nowWas = cm.atlasNow; if ( !cm.noBandAtlasNow ) cm.atlasNow = true;   // (noBandAtlasNow: dev knob, A/B)
    try { return this.bakeBands(U, lv, sr, res, mips, win); } finally { cm.atlasNow = nowWas; }
  }

  bakeBands(U, lv, sr, res, mips, win = null) {
    const t0 = performance.now(), R = canvas.app.renderer, d = this.d, ap = d.ap, o = d.origin, live = d.live;
    const force = this.dirty;
    this.waiting = false;              // (a band of shells without a composite for them: kept stale, re-drawn when their pixels come)
    const top = lv.reduce((a, v) => Math.max(a, v), 0);
    let sx0 = Math.floor(sr.x), sy0 = Math.floor(sr.y), sx1 = Math.ceil(sr.x + sr.width), sy1 = Math.ceil(sr.y + sr.height);
    if ( win ) { sx0 = Math.max(sx0, win.x0); sy0 = Math.max(sy0, win.y0); sx1 = Math.min(sx1, win.x1); sy1 = Math.min(sy1, win.y1); }
    // 1. the bands: members, their box on the scene
    const plan = [];
    let area = 0;
    for ( let L = 0; L <= top + 1; L += 2 ) {
      const members = [], rects = [], groups = [];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for ( let i = 0; i < U.length; i++ ) if ( lv[i] === L && !U[i].live ) {
        members.push(U[i].cont); groups.push(U[i].g ?? null); const r = U[i].r;
        rects.push({ x0: o.x + r.x0 * ap - 2, y0: o.y + r.y0 * ap - 2, x1: o.x + r.x1 * ap + 2, y1: o.y + r.y1 * ap + 2 });
        x0 = Math.min(x0, o.x + r.x0 * ap); y0 = Math.min(y0, o.y + r.y0 * ap); x1 = Math.max(x1, o.x + r.x1 * ap); y1 = Math.max(y1, o.y + r.y1 * ap);
      }
      x0 = Math.max(sx0, Math.floor(x0) - 2); y0 = Math.max(sy0, Math.floor(y0) - 2); x1 = Math.min(sx1, Math.ceil(x1) + 2); y1 = Math.min(sy1, Math.ceil(y1) + 2);
      const ok = members.length && x1 > x0 && y1 > y0;
      plan.push(ok ? { L, members, rects, groups, x0, y0, x1, y1 } : null);
      if ( ok ) area += (x1 - x0) * (y1 - y0);
    }
    // 2. the density: what was asked, within the memory cap for all bands together (a view window is small anyway)
    const cap = Math.sqrt(MAX_MPX / Math.max(1, area));
    const eff = win || res <= cap ? res : Math.max(0.25, Math.floor(cap * 4) / 4);
    if ( !win ) this.capRes = cap;
    const maxTex = Math.min(8192, R.gl?.getParameter?.(R.gl.MAX_TEXTURE_SIZE) || 4096);
    // tile size in scene px: a band in ONE texture whenever it fits (up to 4096 texels a side). Sparse tiles of 1024 texels saved a
    // little memory but every tile edge was a line where the filter could not read across (clamped): "rysy od tili" in a zoom-out
    // (dev/perf-harness wavingCheck seams); only a band bigger than that is cut, at 4096-texel steps
    const T = Math.max(128, Math.floor(Math.min(maxTex, 4096) / eff));
    const old = new Map(force ? [] : this.bands.map((b) => [b.key, b]));
    const keep = new Set();
    this.show.removeChildren();
    // the bands are drawn with the sampling that is right for pixel art at THEIR density, whatever the live layer uses at the moment:
    // an art pixel covering a texel or more is copied as a whole block (NEAREST), a denser art grid is averaged (LINEAR + mipmaps).
    // (Drawn with the live layer's sampling of the moment, a band made zoomed out kept LINEAR-blurred art pixels when zoomed in.)
    const smp = eff * ap >= 0.999 ? 0 : 1, liveSmp = d.filter;
    const bands = [], runs = [];
    const waters = U.filter((u) => u.water);
    const flipped = new Set();
    const wasVis = live.visible;
    let drawn = 0, px = 0;
    // (the composite learns every band of this drawing first: a band of it may be used only while the bands above it still are)
    d.composite?.plan?.(plan.filter(Boolean).map((p) => { const hashes = p.groups.map((g) => g?.hash ?? 0); return { L: p.L, hashes, key: !win && Number.isInteger(1 / eff) ? bandKeyOf(p.L, eff, smp, mips, hashes) : "" }; }));
    for ( let k = 0; k < plan.length; k++ ) {
      const p = plan[k];
      if ( p ) {
        const key = `${p.L}|${eff}|${mips}|${smp}|${p.x0},${p.y0},${p.x1},${p.y1}|${p.members.map((c) => `${this.idOf(c)}.${c.children.length}.${c._mmv | 0}`).join(",")}`;
        // SETTLED COMPOSITE (composite.mjs): the band as the GM's client drew it, keyed by its members' area hashes - its tiles are used
        // as they are; areas shown as shells (no pixels of their own) can only be drawn from it
        const hashes = p.groups.map((g) => g?.hash ?? 0), shells = p.groups.filter((g) => g?.shell);
        const ckey = !win && Number.isInteger(1 / eff) ? bandKeyOf(p.L, eff, smp, mips, hashes) : "";
        const comp = d.composite, exact = ckey ? comp?.band(ckey, p) : null;
        let band = old.get(key);
        if ( band && band.tiles.every((t) => t.rt.valid && !t.rt.baseTexture.destroyed) ) keep.add(band);
        else if ( exact ) {
          const bw = p.x1 - p.x0, bh = p.y1 - p.y0;
          if ( exact.length > 1 && bw * eff <= 4096 && bh * eff <= 4096 ) {
            // a composite published in several tiles (older clients cut bands at 1024 texels): its tiles drawn texel for texel into ONE
            // texture here, so no tile edge is left for the filter to stop at (the seams of a zoom-out)
            const rt = PIXI.RenderTexture.create({ width: bw, height: bh, resolution: eff, scaleMode: PIXI.SCALE_MODES.LINEAR });
            const c = new PIXI.Container(), was = exact.map((t) => t.tex.baseTexture.scaleMode);
            for ( const t of exact ) { t.tex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST; const s = new PIXI.Sprite(t.tex); s.position.set(t.x - p.x0, t.y - p.y0); c.addChild(s); }
            R.render(c, { renderTexture: rt, clear: true });
            exact.forEach((t, i) => { t.tex.baseTexture.scaleMode = was[i]; });
            c.destroy({ children: true });
            if ( mips && globalThis.CONFIG?.moinenMaps?.destructionCacheMips !== false ) mipmaps(R, rt);
            const spr = new SharpTile(rt, bw, bh, eff); spr.position.set(p.x0, p.y0);
            band = { key, level: p.L, tiles: [{ rt, spr, x: p.x0, y: p.y0, w: bw, h: bh }] };
            this.stats.joinedComposite = (this.stats.joinedComposite ?? 0) + 1;
          } else band = { key, level: p.L, tiles: exact.map((t) => { const spr = new SharpTile(t.tex, t.w, t.h, eff); spr.position.set(t.x, t.y); return { rt: t.tex, spr, x: t.x, y: t.y, w: t.w, h: t.h, shared: true, id: t.id }; }) };
          this.stats.fromComposite = (this.stats.fromComposite ?? 0) + 1;
        } else if ( shells.length && !(ckey && comp?.prefix(p.L, eff, smp, mips, hashes, shells)) ) {
          // shells and no composite for them: their pixels are asked for (destruction.mjs hydrates their strokes); meanwhile the band
          // keeps what it showed (a stale band of the same level), or nothing is drawn for it this frame
          d.needPixels?.(shells);
          const prev = this.bands.find((b) => b.level === p.L);
          this.waiting = true;
          if ( prev ) { keep.add(prev); band = prev; }
          else band = { key: `${key}|wait`, level: p.L, tiles: [] };
          this.dirty = true;
        }
        else {
          const delta = shells.length && ckey ? comp?.prefix(p.L, eff, smp, mips, hashes, shells) : null;
          band = { key, level: p.L, tiles: [] };
          if ( smp !== liveSmp ) { const gs = globalThis.CONFIG?.moinenMaps?.flipAllSampling ? null : p.groups.filter(Boolean); setSampling(d, smp, gs); if ( gs ) for ( const g of gs ) flipped.add(g); else flipped.all = true; d.filter = smp; }   // (only this band's areas: the rest are not drawn now; CONFIG.moinenMaps.flipAllSampling: all, as before)
          live.visible = true;
          // (a band that only GREW past a composite of its first members: the composite's texels first, then only the newer members)
          const set = new Set(delta ? p.members.slice(delta.n) : p.members);
          for ( const c of live.children ) c.renderable = set.has(c);
          for ( const u of waters ) u.water.renderable = false;          // the water is never in a band
          for ( let ty = p.y0; ty < p.y1; ty += T ) for ( let tx = p.x0; tx < p.x1; tx += T ) {
            // whole texels (a view window is drawn 1:1 with the screen: no fractional texel at its edge)
            const tw = Math.ceil(Math.min(T, p.x1 - tx) * eff) / eff, th = Math.ceil(Math.min(T, p.y1 - ty) * eff) / eff;
            // sparse: no texture for a tile none of the band's objects touches
            if ( !p.rects.some((r) => r.x0 < tx + tw && r.x1 > tx && r.y0 < ty + th && r.y1 > ty) ) continue;
            const rt = PIXI.RenderTexture.create({ width: tw, height: th, resolution: eff, scaleMode: PIXI.SCALE_MODES.LINEAR });
            const m = new PIXI.Matrix(1, 0, 0, 1, -tx, -ty);
            if ( delta ) { R.render(delta.under(tx, ty, tw, th), { renderTexture: rt, transform: m, clear: true }); R.render(live, { renderTexture: rt, transform: m, clear: false }); }
            else R.render(live, { renderTexture: rt, transform: m, clear: true });
            if ( mips && globalThis.CONFIG?.moinenMaps?.destructionCacheMips !== false ) mipmaps(R, rt);   // (dev knob)
            const spr = new SharpTile(rt, tw, th, eff); spr.position.set(tx, ty);
            band.tiles.push({ rt, spr, x: tx, y: ty, w: tw, h: th });
          }
          drawn++;
        }
        band.ckey ??= ckey; band.hashes ??= hashes; band.meta ??= { L: p.L, eff, smp, mips: !!mips, rect: [p.x0, p.y0, p.x1, p.y1] };   // (what composite.mjs publishes from)
        for ( const t of band.tiles ) { this.show.addChild(t.spr); px += t.w * t.h * eff * eff; }
        bands.push(band);
      }
      const run = new Run(live); this.show.addChild(run); runs.push(run);    // run k: level 2k + 1
    }
    for ( const c of live.children ) c.renderable = true;
    for ( const u of waters ) u.water.renderable = true;
    live.visible = wasVis;
    if ( d.filter !== liveSmp ) { setSampling(d, liveSmp, flipped.all ? null : flipped); d.filter = liveSmp; }
    this.freeBands(this.bands.filter((b) => !keep.has(b)));
    this.bands = bands; this.runs = runs;
    d.composite?.restore?.();
    const ms = performance.now() - t0;
    Object.assign(this.stats, { bakes: this.stats.bakes + 1, bakeMs: Math.round(ms * 10) / 10, drawn, res: eff, bands: bands.length,
      tiles: bands.reduce((a, b) => a + b.tiles.length, 0), mpx: Math.round(px / 1e5) / 10 });
  }

  idOf(c) { let id = this.ids.get(c); if ( id === undefined ) { id = this.nextId++; this.ids.set(c, id); } return id; }

  destroy() {
    canvas.app?.renderer?.runners?.contextChange?.remove(this._ctx);
    this.freeBands();
    if ( !this.show.destroyed ) this.show.destroy({ children: true });
  }
}
