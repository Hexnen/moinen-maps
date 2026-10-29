import * as Water from "./water.mjs";
import * as Model from "./model.mjs";

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

/**
 * Blur shapes as sampling windows: width, height, the anchor (which window cell sits on the output pixel) and which cells count.
 * "left" shapes smear toward the left, "top" toward the top, the diagonals along a diagonal; "hard" weighs the centre more.
 */
function kernel(name) {
  const box = (w, h, ax = (w - 1) >> 1, ay = (h - 1) >> 1) => ({ w, h, ax, ay, k: new Float32Array(w * h).fill(1) });
  switch ( name ) {
    case "3x3": return box(3, 3);
    case "3x3hard": { const o = box(3, 3); o.k.set([0, 1, 0, 1, 3, 1, 0, 1, 0]); return o; }
    case "5x5": return box(5, 5);
    case "7x7": return box(7, 7);
    case "9x9": return box(9, 9);
    case "17x17": return box(17, 17);
    case "5x3left": return box(5, 3, 4, 1);
    case "17x3left": return box(17, 3, 16, 1);
    case "3x17top": return box(3, 17, 1, 16);
    case "5x5diagback": { const o = box(5, 5); o.k.fill(0); for ( let i = 0; i < 5; i++ ) o.k[i * 5 + i] = 1; return o; }
    case "5x5diagfwd": { const o = box(5, 5); o.k.fill(0); for ( let i = 0; i < 5; i++ ) o.k[i * 5 + (4 - i)] = 1; return o; }
    default: return null;
  }
}
const kernelCache = new Map();
const kernelOf = (name) => { if ( !kernelCache.has(name) ) kernelCache.set(name, kernel(name)); return kernelCache.get(name); };

/** Convolve a canvas in place (premultiplied alpha, so soft edges do not darken). Returns false when the canvas cannot be read. */
function blurCanvas(ctx, W, H, kn) {
  let img;
  try { img = ctx.getImageData(0, 0, W, H); } catch { return false; }
  const src = img.data, out = new Uint8ClampedArray(src.length), total = kn.k.reduce((a, b) => a + b, 0) || 1;
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    let r = 0, g = 0, b = 0, a = 0;
    for ( let j = 0; j < kn.h; j++ ) {
      const yy = y + j - kn.ay; if ( yy < 0 || yy >= H ) continue;
      for ( let i = 0; i < kn.w; i++ ) {
        const wgt = kn.k[j * kn.w + i]; if ( !wgt ) continue;
        const xx = x + i - kn.ax; if ( xx < 0 || xx >= W ) continue;
        const o = (yy * W + xx) * 4, al = src[o + 3] * wgt;
        r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += al;
      }
    }
    const o = (y * W + x) * 4;
    if ( a > 0 ) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a / (total * 255) * 255 / 1; }
  }
  ctx.putImageData(new ImageData(out, W, H), 0, 0);
  return true;
}

const STEP_MS = 90;
const REDUCED = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

let root = null, maskSprite = null, maskCanvas = null, maskTex = null, tick = null, dirty = true, hook = null, lastMask = 0;
const states = new Map();

const S = () => Water.state();
const cfg = () => ({ ...REFLECT_DEFAULTS, ...(S()?.params ?? {}) });
const hexRGB = (c) => { const n = parseInt(String(c).replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/* ---------------------------------------------------------------- the water mask */

/** Where reflections may show: water and river, not the falls. */
function rebuildMask() {
  const s = S(); dirty = false;
  if ( !s ) return;
  if ( !maskCanvas || maskCanvas.width !== s.w || maskCanvas.height !== s.h ) {
    maskCanvas = document.createElement("canvas"); maskCanvas.width = s.w; maskCanvas.height = s.h;
    maskTex?.destroy(true);
    maskTex = PIXI.Texture.from(maskCanvas, { scaleMode: PIXI.SCALE_MODES.NEAREST });
    maskTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    maskSprite.texture = maskTex;
  }
  const img = new ImageData(s.w, s.h), d = img.data, m = s.masks;
  for ( let i = 0, n = s.w * s.h; i < n; i++ ) {
    if ( (m.water[i] || m.river[i]) && !m.fall[i] ) { d[i * 4 + 3] = 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; }
  }
  maskCanvas.getContext("2d").putImageData(img, 0, 0);
  maskTex.baseTexture.update();
  const r = Model.sceneRect();
  maskSprite.position.set(r.x, r.y); maskSprite.scale.set(s.px);
}

const wetAt = (x, y) => {
  const s = S(); if ( x < 0 || y < 0 || x >= s.w || y >= s.h ) return false;
  const i = y * s.w + x;
  return (s.masks.water[i] === 1 || s.masks.river[i] === 1) && !s.masks.fall[i];
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

function draw(t, st, P, now) {
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
  st.last = now;

  const tex = t.mesh?.texture ?? t.texture, src = tex?.baseTexture?.resource?.source, fr = tex?.frame;
  if ( !src || !fr || (src.readyState !== undefined && src.readyState < 2) || (src.complete === false) ) { st.sprite.visible = false; return; }
  const dims = `${W}x${H}x${tw}x${th}`;
  if ( dims !== st.dims ) {
    st.dims = dims;
    for ( const c of [st.out, st.mid, st.fin] ) { c.width = W; c.height = H; }
    st.tmp.width = tw; st.tmp.height = th;
    // a canvas that changed size needs a texture of its own
    st.tex.destroy(true);
    st.tex = PIXI.Texture.from(st.fin, { scaleMode: PIXI.SCALE_MODES.NEAREST });
    st.tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    st.sprite.texture = st.tex;
  }
  const tctx = st.tmp.getContext("2d"), octx = st.out.getContext("2d"), mctx = st.mid.getContext("2d"), fctx = st.fin.getContext("2d");
  // 1. the token upside down, on the water's pixel grid (the downscale is what makes it pixel art)
  tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, tw, th);
  tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = "high";
  tctx.save(); tctx.translate(0, th); tctx.scale(1, -1);
  try { tctx.drawImage(src, fr.x, fr.y, fr.width, fr.height, 0, 0, tw, th); } catch { tctx.restore(); return; }
  tctx.restore();
  // 2. ripple: every row slides sideways on a travelling wave that grows toward the bottom; the wave comes back to where it
  //    started once per loop of the water, `speed` times over
  const loop = Math.max(400, (s.params.frames ?? 16) * (s.params.ms ?? 90)), turn = ((now % loop) / loop) * P.reflectSpeed * Math.PI * 2;
  const freq = P.reflectFreq / 100;
  octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, W, H);
  for ( let y = 0; y < th && y < H; y++ ) {
    const dx = Math.round(amp * (y / th) * Math.sin(turn - y * freq));
    octx.drawImage(st.tmp, 0, y, tw, 1, mx + dx, y, tw, 1);
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
  const on = s && s.enabled && P.reflectOn && !REDUCED?.matches && (P.reflectWho === "all" || game.user.isGM);
  if ( !on ) { if ( states.size ) clear(); if ( root ) root.visible = false; return; }
  root.visible = true;
  const now = performance.now();
  if ( dirty && now - lastMask > 250 ) { lastMask = now; rebuildMask(); }
  const seen = new Set();
  for ( const t of canvas.tokens?.placeables ?? [] ) {
    const doc = t.document;
    if ( !t.visible || (doc.hidden && !game.user.isGM) ) continue;
    seen.add(t.id);
    let st = states.get(t.id);
    if ( !st ) { st = make(t); states.set(t.id, st); }
    draw(t, st, P, now);
  }
  for ( const [id, st] of states ) if ( !seen.has(id) ) { destroyState(st); states.delete(id); }
}

function clear() { for ( const st of states.values() ) destroyState(st); states.clear(); }

/* ---------------------------------------------------------------- lifecycle */

export function onCanvasReady() {
  teardown();
  root = new PIXI.Container(); root.eventMode = "none";
  // over the water (240), under the districts (250), the rings (255), tiles and tokens
  Object.assign(root, { elevation: 0, sortLayer: 245, sort: 0, _lastSortedIndex: 0 });
  maskSprite = new PIXI.Sprite(PIXI.Texture.EMPTY); maskSprite.eventMode = "none";
  root.addChild(maskSprite);
  root.mask = maskSprite;
  canvas.primary.addChild(root);
  dirty = true;
  hook = (kind) => { if ( kind === "loaded" || kind === "edited" ) dirty = true; };
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
