import * as Water from "./water.mjs";
import * as Model from "./model.mjs";

/**
 * Reflections of tokens in the water: a vertical mirror image under every token, drawn only where there is water, in the water's own
 * pixel grid, with blur, opacity, offset, ripple, distortion, a fade with distance and a tint from the water. A "shadow" type draws a
 * dark silhouette instead of the mirror image. A light layer over the baked water (no new bake).
 *
 * The idea follows Reflecto (Devkidd, an Aseprite extension, https://devkidd.itch.io/reflecto); no code of it is used.
 *
 * Settings (per scene, in the water settings): see REFLECT_DEFAULTS.
 */

export const REFLECT_DEFAULTS = {
  reflectOn: false, reflectType: "reflection", reflectOpacity: 45, reflectBlur: 1, reflectOffset: 0, reflectRipple: 3,
  reflectDistort: 2, reflectLength: 100, reflectFade: 5, reflectTint: 3, reflectWho: "all"
};
export const REFLECT_KEYS = Object.keys(REFLECT_DEFAULTS);

const STEP_MS = 90;
const REDUCED = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

let root = null, maskSprite = null, maskCanvas = null, maskTex = null, tick = null, dirty = true, hook = null, lastMask = 0;
const states = new Map();

const S = () => Water.state();
const cfg = () => ({ ...REFLECT_DEFAULTS, ...(S()?.params ?? {}) });
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
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
  const out = document.createElement("canvas"), fin = document.createElement("canvas"), tmp = document.createElement("canvas");
  fin.width = fin.height = 2;
  const tex = PIXI.Texture.from(fin, { scaleMode: PIXI.SCALE_MODES.NEAREST });
  tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
  const sprite = new PIXI.Sprite(tex); sprite.eventMode = "none"; sprite.visible = false;
  root.addChild(sprite);
  return { out, fin, tmp, tex, sprite, seed: Math.floor(Math.random() * 1000), last: -1e9, dims: "" };
}

function destroyState(st) { st.sprite.destroy(); st.tex.destroy(true); }

function draw(t, st, P, now) {
  const s = S(), px = s.px, rect = Model.sceneRect();
  const tw = Math.max(2, Math.round(t.w / px)), th = Math.max(2, Math.round(t.h / px));
  const mx = Math.ceil(P.reflectRipple * 0.5) + 2, H = Math.max(2, Math.round(th * P.reflectLength / 100));
  const W = tw + mx * 2;
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
    for ( const c of [st.out, st.fin] ) { c.width = W; c.height = H; }
    st.tmp.width = tw; st.tmp.height = th;
    // a canvas that changed size needs a texture of its own
    st.tex.destroy(true);
    st.tex = PIXI.Texture.from(st.fin, { scaleMode: PIXI.SCALE_MODES.NEAREST });
    st.tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    st.sprite.texture = st.tex;
  }
  const tctx = st.tmp.getContext("2d"), octx = st.out.getContext("2d"), fctx = st.fin.getContext("2d");
  // 1. the token, upside down, on the water's pixel grid (the downscale is what makes it pixel art)
  tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, tw, th);
  tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = "high";
  tctx.save(); tctx.translate(0, th); tctx.scale(1, -1);
  try { tctx.drawImage(src, fr.x, fr.y, fr.width, fr.height, 0, 0, tw, th); } catch { tctx.restore(); return; }
  tctx.restore();
  // 2. row by row, shifted sideways: ripple (a travelling wave, stronger with distance) and distortion (a slower wobble and jitter)
  octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, W, H);
  const phase = now / 600, A = P.reflectRipple * 0.4, D = P.reflectDistort * 0.25, step = Math.floor(now / 180);
  for ( let y = 0; y < Math.min(H, th); y++ ) {
    const depth = 0.35 + 0.65 * (y / H);
    const dx = Math.round(A * depth * Math.sin(y * 0.95 + phase) + D * Math.sin(y * 0.37 - phase * 0.6) + (hash(y + st.seed, step) - 0.5) * D * 0.8);
    octx.drawImage(st.tmp, 0, y, tw, 1, mx + dx, y, tw, 1);
  }
  // 3. blur, a silhouette for the shadow type, the fade with distance
  fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, W, H);
  fctx.filter = P.reflectBlur > 0 ? `blur(${(P.reflectBlur * 0.5).toFixed(2)}px)` : "none";
  fctx.drawImage(st.out, 0, 0);
  fctx.filter = "none";
  if ( P.reflectType === "shadow" ) {
    fctx.globalCompositeOperation = "source-in"; fctx.fillStyle = "#0a1220"; fctx.fillRect(0, 0, W, H);
  }
  if ( P.reflectFade > 0 ) {
    const g = fctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, `rgba(0,0,0,${Math.max(0, 1 - P.reflectFade / 8)})`);
    fctx.globalCompositeOperation = "destination-in"; fctx.fillStyle = g; fctx.fillRect(0, 0, W, H);
  }
  fctx.globalCompositeOperation = "source-over";
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
