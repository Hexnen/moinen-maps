import * as Water from "./water.mjs";
import * as Model from "./model.mjs";

/**
 * Tokens under the water: a token whose elevation is below zero and that stands in water is veiled by the water. A silhouette of the
 * token in the water's colour (darker the deeper it is) lies over it, wavering sideways, and bubbles rise from it. The token itself is
 * not touched: the veil is a sprite over it, on the water's pixel grid, so nothing is baked and Foundry's own token drawing is left alone.
 *
 * Settings (per scene, in the water settings): see SUBMERGE_DEFAULTS. Depth is the token's elevation in scene units.
 */

export const SUBMERGE_DEFAULTS = { submergeOn: true, submergeStrength: 6, submergeDepth: 10, submergeBubbles: true, submergeWho: "all" };
export const SUBMERGE_KEYS = Object.keys(SUBMERGE_DEFAULTS);

const STEP_MS = 90;
const REDUCED = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

let root = null, tick = null, dotTex = null;
const states = new Map();
let bubbles = [];
const ringTex = new Map();

const S = () => Water.state();
const cfg = () => ({ ...SUBMERGE_DEFAULTS, ...(S()?.params ?? {}) });
const hexRGB = (c) => { const n = parseInt(String(c).replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

function inWater(p) {
  const s = S(); if ( !s ) return false;
  const r = Model.sceneRect(), x = Math.floor((p.x - r.x) / s.px), y = Math.floor((p.y - r.y) / s.px);
  if ( x < 0 || y < 0 || x >= s.w || y >= s.h ) return false;
  const i = y * s.w + x;
  return !s.masks.fall[i] && (s.masks.water[i] === 1 || s.masks.river[i] === 1);
}

function pixelTexture(canvas) {
  const t = PIXI.Texture.from(canvas, { scaleMode: PIXI.SCALE_MODES.NEAREST });
  t.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
  return t;
}

function dot() {
  if ( dotTex && !dotTex.destroyed ) return dotTex;
  const c = document.createElement("canvas"); c.width = c.height = 1;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 1, 1);
  return (dotTex = pixelTexture(c));
}

/** A small one-pixel ring (a bubble). */
function ring(r, color) {
  const key = `${r}|${color}`;
  if ( ringTex.has(key) ) return ringTex.get(key);
  const d = r * 2 + 1, c = document.createElement("canvas"); c.width = c.height = d;
  const g = c.getContext("2d"); g.fillStyle = `#${color}`;
  for ( let a = 0; a < 32; a++ ) g.fillRect(r + Math.round(Math.cos(a / 32 * 6.2832) * r), r + Math.round(Math.sin(a / 32 * 6.2832) * r), 1, 1);
  const t = pixelTexture(c); ringTex.set(key, t); return t;
}

/* ---------------------------------------------------------------- one token's veil */

function make() {
  const out = document.createElement("canvas"), tmp = document.createElement("canvas");
  out.width = out.height = 2;
  const tex = pixelTexture(out);
  const sprite = new PIXI.Sprite(tex); sprite.eventMode = "none"; sprite.visible = false;
  root.addChild(sprite);
  return { out, tmp, tex, sprite, last: -1e9, dims: "", nextBubble: 0 };
}

function destroyState(st) { st.sprite.destroy(); st.tex.destroy(true); }

function drawVeil(t, st, P, depth, now) {
  const s = S(), px = s.px, rect = Model.sceneRect();
  const tw = Math.max(2, Math.round(t.w / px)), th = Math.max(2, Math.round(t.h / px));
  const amp = 0.8 + depth * 1.6, mx = Math.ceil(amp) + 1;
  const W = tw + mx * 2;
  const ax0 = Math.round((t.x - rect.x) / px) - mx, ay0 = Math.round((t.y - rect.y) / px);
  st.sprite.position.set(rect.x + ax0 * px, rect.y + ay0 * px); st.sprite.scale.set(px);
  st.sprite.visible = true;
  if ( now - st.last < STEP_MS ) return;
  st.last = now;
  const tex = t.mesh?.texture ?? t.texture, src = tex?.baseTexture?.resource?.source, fr = tex?.frame;
  if ( !src || !fr || (src.readyState !== undefined && src.readyState < 2) || (src.complete === false) ) { st.sprite.visible = false; return; }
  const dims = `${W}x${th}`;
  if ( dims !== st.dims ) {
    st.dims = dims;
    st.out.width = W; st.out.height = th; st.tmp.width = tw; st.tmp.height = th;
    st.tex.destroy(true); st.tex = pixelTexture(st.out); st.sprite.texture = st.tex;
  }
  const cols = (s.params.colors ?? []).map(hexRGB);
  const base = cols[2] ?? [63, 108, 154], deep = cols[1] ?? [43, 84, 128];
  const [r, g, b] = mix(base, deep, Math.min(1, depth * 0.8));
  const tctx = st.tmp.getContext("2d"), octx = st.out.getContext("2d");
  // the token's silhouette on the pixel grid, filled with the water's colour
  tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, tw, th);
  tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = "high";
  try { tctx.drawImage(src, fr.x, fr.y, fr.width, fr.height, 0, 0, tw, th); } catch { st.sprite.visible = false; return; }
  tctx.globalCompositeOperation = "source-in"; tctx.fillStyle = `rgb(${r},${g},${b})`; tctx.fillRect(0, 0, tw, th);
  tctx.globalCompositeOperation = "source-over";
  // rows waver sideways, a little more toward the bottom
  octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, W, th);
  const phase = now / 650;
  for ( let y = 0; y < th; y++ ) octx.drawImage(st.tmp, 0, y, tw, 1, mx + Math.round(amp * Math.sin(phase + y * 0.55) * (0.5 + 0.5 * y / th)), y, tw, 1);
  st.tex.baseTexture.update();
  st.sprite.alpha = Math.min(0.92, (0.22 + 0.7 * depth) * (P.submergeStrength / 6));
}

/* ---------------------------------------------------------------- bubbles */

function emitBubble(t, depth) {
  const s = S(), cols = (s.params.colors ?? []).map((c) => String(c).replace("#", ""));
  const wx = t.x + Math.random() * t.w, wy = t.y + t.h * (0.3 + Math.random() * 0.6);
  const big = Math.random() < 0.35;
  const sp = new PIXI.Sprite(big ? ring(2, cols[5] ?? "ffffff") : dot());
  sp.anchor.set(0.5); sp.eventMode = "none"; sp.scale.set(s.px);
  if ( !big ) sp.tint = parseInt(cols[5] ?? "ffffff", 16);
  root.addChild(sp);
  bubbles.push({ sp, born: performance.now(), ms: 1100 + Math.random() * 700, wx, wy, drift: (Math.random() - 0.5) * 5 });
}

function stepBubbles(now) {
  const s = S(), r = Model.sceneRect();
  bubbles = bubbles.filter((b) => {
    const t = (now - b.born) / b.ms;
    if ( t >= 1 || !s ) { b.sp.destroy(); return false; }
    const q = Math.floor(t * (b.ms / STEP_MS)) / (b.ms / STEP_MS);
    const ax = (b.wx - r.x) / s.px + b.drift * q + Math.sin(q * 9 + b.born) * 0.8, ay = (b.wy - r.y) / s.px - q * 14;
    b.sp.position.set(r.x + Math.round(ax) * s.px, r.y + Math.round(ay) * s.px);
    b.sp.alpha = q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3;
    return true;
  });
}

/* ---------------------------------------------------------------- the loop */

function onTick() {
  const s = S(), P = cfg();
  const on = s && s.enabled && P.submergeOn && !REDUCED?.matches && (P.submergeWho === "all" || game.user.isGM);
  if ( !on ) { if ( states.size || bubbles.length ) clear(); return; }
  const now = performance.now(), seen = new Set();
  for ( const t of canvas.tokens?.placeables ?? [] ) {
    const doc = t.document, elev = doc.elevation ?? 0;
    if ( elev >= 0 || !t.visible || (doc.hidden && !game.user.isGM) || !inWater(t.center) ) continue;
    seen.add(t.id);
    const depth = Math.min(1, Math.max(0.15, -elev / Math.max(1, P.submergeDepth)));
    let st = states.get(t.id);
    if ( !st ) { st = make(); states.set(t.id, st); }
    drawVeil(t, st, P, depth, now);
    if ( P.submergeBubbles && now >= st.nextBubble ) { emitBubble(t, depth); st.nextBubble = now + 260 / (0.5 + depth); }
  }
  for ( const [id, st] of states ) if ( !seen.has(id) ) { destroyState(st); states.delete(id); }
  stepBubbles(now);
}

function clear() {
  for ( const st of states.values() ) destroyState(st);
  states.clear();
  for ( const b of bubbles ) b.sp.destroy();
  bubbles = [];
}

/* ---------------------------------------------------------------- lifecycle */

export function onCanvasReady() {
  teardown();
  root = new PIXI.Container(); root.eventMode = "none";
  // just over the tokens (700): the veil lies on the token it belongs to
  Object.assign(root, { elevation: 0, sortLayer: 705, sort: 0, _lastSortedIndex: 0 });
  canvas.primary.addChild(root);
  tick = () => onTick();
  canvas.app.ticker.add(tick);
}

export function teardown() {
  if ( tick ) canvas.app?.ticker?.remove(tick);
  tick = null;
  clear();
  if ( root && !root.destroyed ) root.destroy({ children: true });
  root = null;
  for ( const t of ringTex.values() ) t.destroy(true);
  ringTex.clear();
  dotTex?.destroy(true); dotTex = null;
}
