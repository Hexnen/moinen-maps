import * as Water from "./water.mjs";
import * as Model from "./model.mjs";
import { wetAt as wetWorld, wetRegions, anyWet } from "./wet.mjs";
import { perfLow } from "../perf-mode.mjs";
import { kernelOf, blurPixels } from "./blur.mjs";

/**
 * Reflections of tokens in the water: a vertical mirror image under every token, drawn only where there is water, on the water's pixel
 * grid. The effects: reflection or shadow (a black silhouette), offset, opacity, a choice of blur shapes, ripple (waves that grow with
 * distance and loop with the water), scanline shift (rows jittering sideways); plus length, fade with distance and a tint from the
 * water. The set of effects follows Reflecto by Devkidd (https://devkidd.itch.io/reflecto, an Aseprite extension); the code is our own.
 *
 * A light layer over the baked water (no new bake). Settings (per scene, in the water settings): see REFLECT_DEFAULTS.
 */

export const REFLECT_DEFAULTS = {
  reflectOn: false, reflectType: "reflection", reflectOpacity: 50, reflectOffset: 0, reflectBlurType: "none",
  reflectRipple: true, reflectAmp: 30, reflectFreq: 20, reflectSpeed: 1, reflectScan: false, reflectScanValue: 3,
  reflectLength: 100, reflectFade: 5, reflectTint: 3, reflectWho: "all"
};
export const REFLECT_KEYS = Object.keys(REFLECT_DEFAULTS);
export const BLUR_TYPES = ["none", "3x3", "3x3hard", "5x5", "7x7", "9x9", "17x17", "5x3left", "17x3left", "3x17top", "5x5diagback", "5x5diagfwd"];

/** Convolve a canvas in place (premultiplied alpha, so soft edges do not darken). Returns false when the canvas cannot be read. */
let blurOut = null;
function blurCanvas(ctx, W, H, kn) {
  let img;
  try { img = ctx.getImageData(0, 0, W, H); } catch { return false; }
  if ( !blurOut || blurOut.length < img.data.length ) blurOut = new Uint8ClampedArray(img.data.length);
  const out = blurOut.length === img.data.length ? blurOut : blurOut.subarray(0, img.data.length);
  blurPixels(img.data, out, W, H, kn);
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
  return true;
}

const STEP_MS = 90;
const DRAW_BUDGET_MS = 3;      // the redraws of one frame (a reflection takes 0.03-0.5 ms)
const REDUCED = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

let root = null, maskSprite = null, maskCanvas = null, maskTex = null, tick = null, dirty = true, hook = null, lastMask = 0;
const states = new Map();

const S = () => Water.state();
const cfg = () => ({ ...REFLECT_DEFAULTS, ...(S()?.params ?? {}) });
const hexRGB = (c) => { const n = parseInt(String(c).replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/* ---------------------------------------------------------------- the water mask */

/**
 * Where reflections may show: water and river, not the falls; plus the water of wet.mjs (the flooded holes). With holes the mask is
 * drawn on their finer grid (the painted water's pixels as blocks of it), so a hole's ragged outline clips the reflection exactly.
 */
function rebuildMask() {
  const s = S(); dirty = false;
  if ( !s ) return;
  const regions = wetRegions(), r = Model.sceneRect();
  const mpx = regions.length ? Math.min(s.px, ...regions.map((q) => q.px)) : s.px;
  const MW = regions.length ? Math.ceil(r.width / mpx) : s.w, MH = regions.length ? Math.ceil(r.height / mpx) : s.h;
  if ( !maskCanvas || maskCanvas.width !== MW || maskCanvas.height !== MH ) {
    maskCanvas = document.createElement("canvas"); maskCanvas.width = MW; maskCanvas.height = MH;
    maskTex?.destroy(true);
    maskTex = PIXI.Texture.from(maskCanvas, { scaleMode: PIXI.SCALE_MODES.NEAREST });
    maskTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    maskSprite.texture = maskTex;
  }
  const img = new ImageData(MW, MH), d = img.data, m = s.masks;
  const set = (i) => { d[i * 4 + 3] = 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; };
  if ( mpx === s.px ) {
    for ( let i = 0, n = s.w * s.h; i < n; i++ ) if ( (m.water[i] || m.river[i]) && !m.fall[i] ) set(i);
  } else {
    for ( let y = 0; y < MH; y++ ) {
      const sy = Math.floor((y + 0.5) * mpx / s.px); if ( sy >= s.h ) break;
      for ( let x = 0; x < MW; x++ ) {
        const sx = Math.floor((x + 0.5) * mpx / s.px); if ( sx >= s.w ) break;
        const i = sy * s.w + sx;
        if ( (m.water[i] || m.river[i]) && !m.fall[i] ) set(y * MW + x);
      }
    }
  }
  for ( const q of regions ) {
    const k = q.px / mpx, ox = Math.round((q.x - r.x) / mpx), oy = Math.round((q.y - r.y) / mpx);
    for ( let y = 0; y < q.h; y++ ) for ( let x = 0; x < q.w; x++ ) {
      if ( !q.a[y * q.w + x] ) continue;
      for ( let yy = 0; yy < k; yy++ ) for ( let xx = 0; xx < k; xx++ ) {
        const X = ox + Math.floor(x * k) + xx, Y = oy + Math.floor(y * k) + yy;
        if ( X >= 0 && Y >= 0 && X < MW && Y < MH ) set(Y * MW + X);
      }
    }
  }
  maskCanvas.getContext("2d").putImageData(img, 0, 0);
  maskTex.baseTexture.update();
  maskSprite.position.set(r.x, r.y); maskSprite.scale.set(mpx);
}

/** Water at an art pixel of the painted water's grid: painted, or (its centre) in the water of wet.mjs. */
const wetAt = (x, y) => {
  const s = S();
  if ( x >= 0 && y >= 0 && x < s.w && y < s.h ) {
    const i = y * s.w + x;
    if ( (s.masks.water[i] === 1 || s.masks.river[i] === 1) && !s.masks.fall[i] ) return true;
  }
  if ( !anyWet() ) return false;
  const r = Model.sceneRect();
  return !!wetWorld(r.x + (x + 0.5) * s.px, r.y + (y + 0.5) * s.px);
};

/* ---------------------------------------------------------------- one token's reflection */

function make(t) {
  const out = document.createElement("canvas"), mid = document.createElement("canvas"), fin = document.createElement("canvas"), tmp = document.createElement("canvas");
  fin.width = fin.height = 2;
  const tex = PIXI.Texture.from(fin, { scaleMode: PIXI.SCALE_MODES.NEAREST });
  tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
  const sprite = new PIXI.Sprite(tex); sprite.eventMode = "none"; sprite.visible = false;
  root.addChild(sprite);
  return { out, mid, fin, tmp, tex, sprite, seed: Math.floor(Math.random() * 1000), last: performance.now() - Math.random() * STEP_MS, dims: "" };
}

function destroyState(st) { st.sprite.destroy(); st.tex.destroy(true); }

/**
 * Steps 2-5 for a blurred reflection on typed arrays instead of canvases (the blur needs the pixels on the CPU anyway: reading a GPU
 * canvas back after its 30 draw calls cost ~1 ms per reflection, ten times the blur). The downscaled token is read back once per
 * picture (st.tdata); rows slide, jump (scan), the shadow blackens and the blur runs in straight-alpha bytes - the same numbers as
 * the canvas path (dev/perf-harness.mjs reflectHash, run on both builds: 0 bytes differ). Returns false when the picture cannot be read.
 */
function cpuReflect(st, fctx, kn, P, tw, th, W, H, mx, amp, freq, turn, scan) {
  let src = st.tdata;
  if ( !src || src.key !== st.tkey ) {
    try { src = st.tdata = st.tmp.getContext("2d").getImageData(0, 0, tw, th); } catch { return false; }
    src.key = st.tkey;
  }
  const n = W * H * 4;
  if ( st.bufDims !== `${W}x${H}` ) { st.bufDims = `${W}x${H}`; st.bufA = new Uint8ClampedArray(n); st.bufB = new Uint8ClampedArray(n); st.bufC = new Uint8ClampedArray(n); st.img = new ImageData(st.bufC, W, H); }
  const S = src.data;
  let cur = st.bufA; cur.fill(0);
  // 2. ripple (rows that slide by the same amount are copied together)
  for ( let y = 0, rows = Math.min(th, H); y < rows; ) {
    const dx = Math.round(amp * (y / th) * Math.sin(turn - y * freq));
    let y1 = y + 1;
    while ( y1 < rows && Math.round(amp * (y1 / th) * Math.sin(turn - y1 * freq)) === dx ) y1++;
    const x0 = mx + dx, i0 = Math.max(0, -x0), i1 = Math.min(tw, W - x0);
    if ( i1 > i0 ) for ( let r = y; r < y1; r++ ) cur.set(S.subarray((r * tw + i0) * 4, (r * tw + i1) * 4), (r * W + x0 + i0) * 4);
    y = y1;
  }
  // 3. scanline shift
  if ( scan > 0 ) {
    const out = st.bufB; out.fill(0);
    for ( let y = 0; y < H; y++ ) {
      const dx = Math.floor(Math.random() * (scan * 2 + 1)) - scan, i0 = Math.max(0, -dx), i1 = Math.min(W, W - dx);
      if ( i1 > i0 ) out.set(cur.subarray((y * W + i0) * 4, (y * W + i1) * 4), (y * W + dx + i0) * 4);
    }
    cur = out;
  }
  // 4. shadow: the silhouette in black
  if ( P.reflectType === "shadow" ) for ( let i = 0; i < n; i += 4 ) cur[i] = cur[i + 1] = cur[i + 2] = 0;
  // 5. blur
  blurPixels(cur, st.bufC, W, H, kn);
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.putImageData(st.img, 0, 0);
  return true;
}

function draw(t, st, P, now, dl) {
  const s = S(), px = s.px, rect = Model.sceneRect();
  const tw = Math.max(2, Math.round(t.w / px)), th = Math.max(2, Math.round(t.h / px));
  const amp = P.reflectRipple ? P.reflectAmp / 10 : 0, scan = P.reflectScan ? Math.round(P.reflectScanValue) : 0;
  const kn = kernelOf(P.reflectBlurType);
  const mx = Math.ceil(amp) + scan + (kn ? kn.w : 0) + 1, my = kn ? kn.h : 0;
  const H = Math.max(2, Math.round(th * P.reflectLength / 100)) + my, W = tw + mx * 2;
  const doc = t.document;
  // a token above the water (elevation) is reflected further down
  const lift = Math.max(0, doc.elevation ?? 0) / (canvas.scene?.grid?.distance || 5) * (canvas.grid?.size ?? 100) * 0.25 / px;
  const ax0 = Math.round((t.x - rect.x) / px) - mx, ay0 = Math.round((t.y + t.h - rect.y) / px) + Math.round(P.reflectOffset + lift);
  // nothing to do where no water lies under the reflection
  let wet = false;
  for ( let gy = 0; gy < 3 && !wet; gy++ ) for ( let gx = 0; gx < 3 && !wet; gx++ ) wet = wetAt(ax0 + Math.floor((W - 1) * gx / 2), ay0 + Math.floor((H - 1) * gy / 2));
  st.sprite.visible = wet;
  if ( !wet ) return;
  st.sprite.position.set(rect.x + ax0 * px, rect.y + ay0 * px); st.sprite.scale.set(px);
  if ( now - st.last < STEP_MS ) return;
  // the time budget of this frame is spent: this one stays due and is the first to draw in the next frame (after a stall of more than
  // one step every reflection was due at once, drew in one frame - 48 of them took 25-30 ms - and stayed in step ever after)
  if ( performance.now() > dl.t ) return;
  st.last = now;

  const tex = t.mesh?.texture ?? t.texture, src = tex?.baseTexture?.resource?.source, fr = tex?.frame;
  if ( !src || !fr || (src.readyState !== undefined && src.readyState < 2) || (src.complete === false) ) { st.sprite.visible = false; return; }
  const dims = `${W}x${H}x${tw}x${th}`;
  if ( dims !== st.dims ) {
    st.dims = dims;
    for ( const c of [st.out, st.mid, st.fin] ) { c.width = W; c.height = H; }
    st.tmp.width = tw; st.tmp.height = th; st.tkey = null;
    // a canvas that changed size needs a texture of its own
    st.tex.destroy(true);
    st.tex = PIXI.Texture.from(st.fin, { scaleMode: PIXI.SCALE_MODES.NEAREST });
    st.tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    st.sprite.texture = st.tex;
  }
  const octx = st.out.getContext("2d"), mctx = st.mid.getContext("2d"), fctx = st.fin.getContext("2d");
  // 1. the token upside down, on the water's pixel grid (the downscale is what makes it pixel art). It only changes with the picture
  //    (a video token: every step): the downscaled copy is kept - reading the token's picture (an ImageBitmap or a canvas on the GPU)
  //    into this CPU canvas was most of a step's cost (~1 ms)
  const tkey = `${tex.baseTexture.uid}|${fr.x},${fr.y},${fr.width},${fr.height}|${tw}x${th}`;
  if ( st.tkey !== tkey || st.tsrc !== src || src instanceof HTMLVideoElement ) {
    const tctx = st.tmp.getContext("2d");
    tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, tw, th);
    tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = "high";
    tctx.save(); tctx.translate(0, th); tctx.scale(1, -1);
    try { tctx.drawImage(src, fr.x, fr.y, fr.width, fr.height, 0, 0, tw, th); } catch { tctx.restore(); st.tkey = null; return; }
    tctx.restore();
    st.tkey = tkey; st.tsrc = src;
  }
  // 2. ripple: every row slides sideways on a travelling wave that grows toward the bottom; the wave comes back to where it
  //    started once per loop of the water, `speed` times over
  const loop = Math.max(400, (s.params.frames ?? 16) * (s.params.ms ?? 90)), turn = ((now % loop) / loop) * P.reflectSpeed * Math.PI * 2;
  const freq = P.reflectFreq / 100;
  if ( !(kn && !st.noCpu && !globalThis.CONFIG?.moinenMaps?.noCpuReflect && cpuReflect(st, fctx, kn, P, tw, th, W, H, mx, amp, freq, turn, scan)) ) {
    if ( kn && !globalThis.CONFIG?.moinenMaps?.noCpuReflect ) st.noCpu = true;   // (a picture that cannot be read: the canvas path from now on)
    octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, W, H);
    // (rows that slide by the same amount are copied together: the same pixels in a third of the drawImage calls)
    for ( let y = 0, rows = Math.min(th, H); y < rows; ) {
      const dx = Math.round(amp * (y / th) * Math.sin(turn - y * freq));
      let y1 = y + 1;
      while ( y1 < rows && Math.round(amp * (y1 / th) * Math.sin(turn - y1 * freq)) === dx ) y1++;
      octx.drawImage(st.tmp, 0, y, tw, y1 - y, mx + dx, y, tw, y1 - y);
      y = y1;
    }
    // 3. scanline shift: every row jumps by its own random amount (a new throw every step)
    let cur = st.out;
    if ( scan > 0 ) {
      mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, W, H);
      for ( let y = 0; y < H; y++ ) {
        const dx = Math.floor(Math.random() * (scan * 2 + 1)) - scan;
        mctx.drawImage(st.out, 0, y, W, 1, dx, y, W, 1);
      }
      cur = st.mid;
    }
    fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, W, H);
    fctx.drawImage(cur, 0, 0);
    // 4. shadow: the silhouette in black
    if ( P.reflectType === "shadow" ) { fctx.globalCompositeOperation = "source-in"; fctx.fillStyle = "#000"; fctx.fillRect(0, 0, W, H); fctx.globalCompositeOperation = "source-over"; }
    // 5. blur
    if ( kn && !blurCanvas(fctx, W, H, kn) ) {
      // a picture the browser will not let us read: a smooth blur of about the same reach
      mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, W, H); mctx.drawImage(st.fin, 0, 0);
      fctx.clearRect(0, 0, W, H); fctx.filter = `blur(${Math.max(kn.w, kn.h) / 6}px)`; fctx.drawImage(st.mid, 0, 0); fctx.filter = "none";
    }
  }
  // 6. fade with distance from the token
  if ( P.reflectFade > 0 ) {
    const g = fctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, `rgba(0,0,0,${Math.max(0, 1 - P.reflectFade / 8)})`);
    fctx.globalCompositeOperation = "destination-in"; fctx.fillStyle = g; fctx.fillRect(0, 0, W, H); fctx.globalCompositeOperation = "source-over";
  }
  st.tex.baseTexture.update();
  // a reflection takes a little of the water's colour
  const cols = (s.params.colors ?? []).map(hexRGB), tint = P.reflectType === "shadow" || !cols[3] ? [255, 255, 255] : cols[3];
  const k = P.reflectTint / 10, mixc = (v) => Math.round(255 + (v - 255) * k);
  st.sprite.tint = (mixc(tint[0]) << 16) | (mixc(tint[1]) << 8) | mixc(tint[2]);
  st.sprite.alpha = P.reflectOpacity / 100;
}

/* ---------------------------------------------------------------- the loop */

function onTick() {
  const s = S(), P = cfg();
  const on = s && s.enabled && P.reflectOn && !REDUCED?.matches && (P.reflectWho === "all" || game.user.isGM) && !perfLow();   // (performance mode Low: none)
  if ( !on ) { if ( states.size ) clear(); if ( root ) root.visible = false; return; }
  const now = performance.now();
  // the first mask at once (and after a clock that went back: a frozen or replayed clock), later ones at most four times a second
  if ( dirty && (!maskTex || Math.abs(now - lastMask) > 250) ) { lastMask = now; rebuildMask(); }
  // NEVER draw the layer with a mask that has no texture: PIXI's sprite mask over Texture.EMPTY breaks the frame from there on, and
  // everything sorted above the reflections (the destruction's dust and entries, the districts, lights, roads, the token rings) is
  // not drawn at all
  root.visible = !!(maskTex?.valid && maskSprite?.texture === maskTex);
  if ( !root.visible ) return;
  const seen = new Set(), dl = { t: performance.now() + (globalThis.CONFIG?.moinenMaps?.reflectBudgetMs ?? DRAW_BUDGET_MS) };
  for ( const t of canvas.tokens?.placeables ?? [] ) {
    const doc = t.document;
    if ( !t.visible || (doc.hidden && !game.user.isGM) ) continue;
    seen.add(t.id);
    let st = states.get(t.id);
    if ( !st ) { st = make(t); states.set(t.id, st); }
    draw(t, st, P, now, dl);
  }
  for ( const [id, st] of states ) if ( !seen.has(id) ) { destroyState(st); states.delete(id); }
}

function clear() { for ( const st of states.values() ) destroyState(st); states.clear(); }

/* ---------------------------------------------------------------- lifecycle */

export function onCanvasReady() {
  teardown();
  root = new PIXI.Container(); root.eventMode = "none"; root.visible = false;     // shown once its mask has a texture (onTick)
  // over the water (240) and the destruction's strokes (247: the flooded holes' water lies in them), under its dust (249), the
  // districts (250), the rings (255), tiles and tokens
  Object.assign(root, { elevation: 0, sortLayer: 248, sort: 0, _lastSortedIndex: 0 });
  maskSprite = new PIXI.Sprite(PIXI.Texture.EMPTY); maskSprite.eventMode = "none";
  root.addChild(maskSprite);
  root.mask = maskSprite;
  canvas.primary.addChild(root);
  dirty = true;
  hook = (kind) => { if ( kind === "loaded" || kind === "edited" || kind === "wet" ) dirty = true; };
  Hooks.on("moinenMapsWater", hook);
  tick = () => onTick();
  canvas.app.ticker.add(tick);
}

export function teardown() {
  if ( tick ) canvas.app?.ticker?.remove(tick);
  tick = null;
  if ( hook ) Hooks.off("moinenMapsWater", hook);
  hook = null;
  clear();
  if ( root && !root.destroyed ) root.destroy({ children: true });
  maskTex?.destroy(true);
  root = maskSprite = maskCanvas = maskTex = null;
}
