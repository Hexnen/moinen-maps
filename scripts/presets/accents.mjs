import { sharedNow } from "../shared-clock.mjs";
import { reducedMotion } from "../config.mjs";
import { view } from "../view-angle.mjs";
import { guardQ, guardOff } from "../frame-guard.mjs";
import { StageShaker } from "../director/screen.mjs";
import { clientOpts } from "../director/stage.mjs";
import { geo as fireGeo } from "../fire/fire.mjs";
import * as A from "./accents-core.mjs";
import * as X from "./gun-fx.mjs";
import { mapPixels } from "../destruction/source.mjs";
import { sceneRect } from "../destruction/model.mjs";

/**
 * DESTRUCTION PRESETS, the ACCENTS on every client (the pure drawing rules: accents-core.mjs): tracers, hit flashes and sparks,
 * the muzzle flash and bullet streaks, a short ground glow round each hit at night and a rumble of the screen under a heavy gun; a
 * falling bomb and its shadow, a thrown grenade's flight and bounce; the firings' CUES - a screen shake and flash, a light.
 * Loaded by presets.mjs on the first firing record a client takes up that has gun accents; it listens to the firings runtime
 * (runtime.mjs: "firing" / "gone"), draws while one of its firings has anything in flight, then removes its ticker - a scene without
 * gun firings runs nothing of this.
 *  - COLOUR: art pixels (the destruction layer's art grid) in a container of the primary group above the tokens and the smoke
 *    (sortLayer 820): they are in the air or flashing on the ground, never under a token.
 *  - NIGHT: the same pixels, as their emission, in Foundry's illumination (MAX_COLOR, as the fire's glow): they are lit by
 *    themselves, and a short warm glow round each hit lights the ground for a moment; vision and fog apply as to the fire.
 *  - SHADOWS (a bomb's, a grenade's): two dithered steps of a dark tone at low alpha, under the colour pixels.
 *  - RUMBLE / SHAKE: a heavy gun's hits near the view shake the screen a little, a blast's screen cue more (decaying; the stage offset
 *    as the cinematic shake: StageShaker) - weaker the farther from the view, never for a player who opted out of shake (or wants
 *    reduced motion).
 *  - FLASH: a blast's screen cue whitens the screen for a moment (a warm overlay over the board, its alpha by the cue and the
 *    distance from the view), never for a player who opted out of flashes (or wants reduced motion).
 *  - Reduced motion: nothing is drawn (the damage and the settled dust are the result). The client's frame guard thins the sparks.
 */
const SORT_LAYER = 820;
const live = new Map();             // fid -> { t0, items, end, seed }
let root = null, shadeG = null, flashEl = null, colG = null, glowBox = null, glowG = null, glowPool = [], ticking = false, hookL = 0, shaker = null, glowTex = null;
let spurtBox = null, spurtPool = [], addG = null, bloomBox = null, bloomPool = [], bloomTex = null;
const spurtStrip = new Map();   // (kind|S|lift|variant -> a baked strip of all its frames, gun-fx.mjs bakeStrip: one base texture)
const spurtTex = new Map();     // (kind|S|lift|variant|frame -> that frame's texture: a window into its strip)
const bakeQueue = [];           // strips to bake ahead (during a firing's lead-in), a few a frame
let softBox = null, softPool = [], softTex = null;
const F = A.newFrame();

/** Records with gun accents (what this layer draws). */
export const gunItems = (rec) => (rec?.pending?.accent ?? []).filter((a) => a && (a.kind === "tracer" || a.kind === "hitFx" || a.kind === "muzzle"));

export function take(rec) {
  const items = A.itemsOf(rec);
  if ( !items.length || reducedMotion() ) return;
  // (a gun's hits: the ground's colour under each - its spurt is that ground's soil; the same map, the same tones on every client)
  // (its rounds - gun-fx.mjs roundsOf: the walk hits and the rounds between - each with its own tone: water splashes)
  for ( const it of items ) if ( it.kind === "hitFx" && Array.isArray(it.hits) && !it.tones ) { try { it.tones = groundTones(X.roundsOf(it)); } catch { it.tones = null; } }
  // (the spurt strips this firing will show, baked ahead in the lead-in - a few a frame - so its first hits never pay a bake)
  try {
    const g = fireGeo(), S = Math.max(8, Math.round(g.grid / g.ap)), lift = Math.round(view().lift * 20) / 20;
    for ( const it of items ) if ( it.kind === "hitFx" ) {
      const heavy = (it.lv ?? 1) >= 3, wet = (it.tones ?? []).some((c) => X.wetOf(c));
      const kinds = [X.kindOf(1), ...(heavy ? [X.kindOf(3)] : []), ...(wet ? [X.kindOf(1, true), ...(heavy ? [X.kindOf(3, true)] : [])] : [])];
      for ( const k of kinds ) for ( let v = 0; v < X.SPURT_VARIANTS; v++ ) bakeQueue.push([k, S, lift, v]);
    }
  } catch { /* baked when first shown */ }
  let end = -Infinity;
  for ( const it of items ) { const s = A.spanOf(it); if ( s ) end = Math.max(end, rec.t0 + s[1]); }
  if ( !(end > sharedNow()) ) return;
  live.set(rec.id, { t0: rec.t0, items, end, seed: (Number(rec.seed) | 0) || 1 });
  arm();
}
export function drop(fid) { if ( live.delete(fid) && !live.size ) stop(); }

/** The map's colour round each hit (packed rgb; the art pixels within ~0.1 square, averaged), read once from one box over the run. */
function groundTones(hits) {
  if ( !hits.length ) return [];
  const g = fireGeo(), ap = g.ap, r = sceneRect(), k = Math.max(1, Math.round(0.1 * g.grid / ap));
  const cx = hits.map((h) => Math.floor((h[0] - r.x) / ap)), cy = hits.map((h) => Math.floor((h[1] - r.y) / ap));
  const x0 = Math.min(...cx) - k, y0 = Math.min(...cy) - k, w = Math.max(...cx) + k + 1 - x0, h = Math.max(...cy) + k + 1 - y0;
  if ( w * h > 4e6 ) return hits.map(() => -1);
  const px = mapPixels(ap, { x0, y0, w, h });
  return hits.map((_, i) => {
    let R = 0, G = 0, B = 0, n = 0;
    for ( let y = cy[i] - k; y <= cy[i] + k; y++ ) for ( let x = cx[i] - k; x <= cx[i] + k; x++ ) {
      const o = ((y - y0) * w + (x - x0)) * 4; R += px[o]; G += px[o + 1]; B += px[o + 2]; n++;
    }
    return n ? (Math.round(R / n) << 16) | (Math.round(G / n) << 8) | Math.round(B / n) : -1;
  });
}

/** A baked strip of a spurt's frames as one base texture (NEAREST: one texel an art pixel), made ahead or the first time it is shown. */
function stripOf(kind, S, lift, v) {
  const key = `${kind}|${S}|${lift}|${v}`;
  let b = spurtStrip.get(key);
  if ( b && !b.base.destroyed ) return b;
  const s = X.bakeStrip(kind, S, lift, v);
  const base = PIXI.BaseTexture.fromBuffer(s.data, s.w * s.n, s.h, { scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.PMA });
  b = { base, box: s };
  spurtStrip.set(key, b);
  return b;
}
/** A spurt frame's texture: its window in the strip. */
function spurtTexture(kind, S, lift, v, f) {
  const key = `${kind}|${S}|${lift}|${v}|${f}`;
  let t = spurtTex.get(key);
  if ( t && !t.baseTexture?.destroyed ) return t;
  const { base, box } = stripOf(kind, S, lift, v);
  t = new PIXI.Texture(base, new PIXI.Rectangle(f * box.w, 0, box.w, box.h));
  t.mmBox = box;
  spurtTex.set(key, t);
  return t;
}
/** Bake queued strips within a small budget a frame (the lead-in of a firing). */
function bakeAhead(ms = 2.5) {
  const end = performance.now() + ms;
  while ( bakeQueue.length && performance.now() < end ) { const [k, S, lift, v] = bakeQueue.shift(); try { stripOf(k, S, lift, v); } catch { /* shown later */ } }
}

function mount() {
  if ( root && !root.destroyed && root.parent ) return;
  root = new PIXI.Container();
  root.eventMode = "none"; root.interactiveChildren = false;
  Object.assign(root, { elevation: 0, sortLayer: SORT_LAYER, sort: 0, _lastSortedIndex: 0 });
  shadeG = new PIXI.Graphics(); colG = new PIXI.Graphics(); softBox = new PIXI.Container(); softBox.eventMode = "none"; softPool = [];
  spurtBox = new PIXI.Container(); spurtBox.eventMode = "none"; spurtPool = [];
  addG = new PIXI.Graphics(); addG.blendMode = PIXI.BLEND_MODES.ADD;
  bloomBox = new PIXI.Container(); bloomBox.eventMode = "none"; bloomPool = [];
  // (soft shadows under everything; the guns' spurts over the shade, under the colour pixels; the additive halo pixels and the soft
  // blooms of light last: they light what is under them, a shooter's token too)
  root.addChild(softBox, shadeG, spurtBox, colG, addG, bloomBox);
  canvas.primary.addChild(root);
  glowBox = new PIXI.Container(); glowBox.eventMode = "none";
  glowG = new PIXI.Graphics(); glowG.blendMode = PIXI.BLEND_MODES.MAX_COLOR; glowBox.addChild(glowG);
  attachGlow();
  hookL = Hooks.on("lightingRefresh", attachGlow);
}
/** The emission container into the illumination (each lighting refresh empties it: put it back, as the fire does). */
function attachGlow() { const box = canvas.effects?.illumination?.lights; if ( box && glowBox && !glowBox.destroyed && glowBox.parent !== box ) box.addChild(glowBox); }

function arm() {
  if ( ticking || !live.size ) return;
  mount();
  ticking = true;
  canvas.app.ticker.add(tick, null, PIXI.UPDATE_PRIORITY.LOW);
}
function stop() {
  if ( ticking ) canvas.app?.ticker?.remove(tick);
  ticking = false;
  shaker?.restore(); shaker = null;
  guardOff("presets");
  if ( colG && !colG.destroyed ) colG.clear();
  if ( addG && !addG.destroyed ) addG.clear();
  for ( const s of bloomPool ) s.visible = false;
  bakeQueue.length = 0;
  if ( shadeG && !shadeG.destroyed ) shadeG.clear();
  if ( flashEl ) flashEl.style.opacity = "0";
  if ( glowG && !glowG.destroyed ) glowG.clear();
  for ( const s of glowPool ) s.visible = false;
  for ( const s of spurtPool ) s.visible = false;
  for ( const s of softPool ) s.visible = false;
}
/** The scene goes: everything of this layer goes with it. */
export function reset() {
  stop(); live.clear();
  if ( hookL ) Hooks.off("lightingRefresh", hookL); hookL = 0;
  if ( root && !root.destroyed ) root.destroy({ children: true });
  if ( glowBox && !glowBox.destroyed ) { glowBox.parent?.removeChild(glowBox); glowBox.destroy({ children: true }); }
  flashEl?.remove();
  root = colG = shadeG = glowBox = glowG = flashEl = softBox = spurtBox = addG = bloomBox = null; glowPool = []; softPool = []; spurtPool = []; bloomPool = [];
  for ( const t of spurtTex.values() ) t.destroy(false);
  for ( const b of spurtStrip.values() ) b.base.destroy();
  spurtTex.clear(); spurtStrip.clear();
}

/**
 * A round glow, white (tinted and scaled per hit): a LIGHT on the ground - a smooth falloff to nothing, linear filtered (a light has
 * no pixel grid: a dithered / stepped one lit the map in a disc with a rim, round every hit), 128 x 128.
 */
function glowTexture() {
  if ( glowTex && !glowTex.baseTexture?.destroyed ) return glowTex;
  const N = 128, a = new Uint8Array(N * N * 4);
  for ( let y = 0; y < N; y++ ) for ( let x = 0; x < N; x++ ) {
    const d = Math.hypot(x + 0.5 - N / 2, (y + 0.5 - N / 2)) / (N / 2), f = Math.max(0, 1 - d);
    const v = d >= 1 ? 0 : Math.exp(-4.2 * d * d) * f * (2 - f);   // (a bright core, a long soft tail that reaches 0 exactly at the rim)
    const o = (y * N + x) * 4; a[o] = a[o + 1] = a[o + 2] = Math.round(255 * Math.min(1, v * 1.15)); a[o + 3] = 255;
  }
  glowTex = PIXI.Texture.fromBuffer(a, N, N);
  glowTex.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR; glowTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
  return glowTex;
}
/** The bloom: a smooth warm light over what is lit (a shooter's flash lights its own token), additive, premultiplied. */
function bloomTexture() {
  if ( bloomTex && !bloomTex.baseTexture?.destroyed ) return bloomTex;
  const N = 64, a = new Uint8Array(N * N * 4);
  for ( let y = 0; y < N; y++ ) for ( let x = 0; x < N; x++ ) {
    const d = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2), v = d >= 1 ? 0 : Math.exp(-5 * d * d) * (1 - d);
    const o = (y * N + x) * 4; a[o] = a[o + 1] = a[o + 2] = Math.round(255 * v); a[o + 3] = 0;   // (additive: no coverage)
  }
  bloomTex = PIXI.Texture.fromBuffer(a, N, N);
  bloomTex.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR; bloomTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF; bloomTex.baseTexture.alphaMode = PIXI.ALPHA_MODES.PMA;
  return bloomTex;
}
/** The soft shadow: a smooth feathered disc (64 x 64, linear filtered: a shadow is light, it has no pixel grid), white alpha. */
function softTexture() {
  if ( softTex && !softTex.baseTexture?.destroyed ) return softTex;
  const N = 64, a = new Uint8Array(N * N * 4);
  for ( let y = 0; y < N; y++ ) for ( let x = 0; x < N; x++ ) {
    const d = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2), v = d >= 1 ? 0 : Math.pow(1 - d * d, 1.6);
    const o = (y * N + x) * 4; a[o] = a[o + 1] = a[o + 2] = a[o + 3] = Math.round(255 * v);
  }
  softTex = PIXI.Texture.fromBuffer(a, N, N);
  softTex.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR; softTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
  softTex.baseTexture.alphaMode = PIXI.ALPHA_MODES.PMA;
  return softTex;
}
const mul = (c, k) => ((Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k));

function tick() {
  if ( !canvas?.ready || !root || root.destroyed ) { stop(); return; }
  const now = sharedNow(), g = fireGeo(), v = view(), q = guardQ("presets");
  A.clearFrame(F);
  if ( F.spurts ) F.spurts.length = 0;
  for ( const [fid, f] of live ) {
    if ( now > f.end ) { live.delete(fid); continue; }
    A.draw(f.items, f.t0, now, { ap: g.ap, ox: g.ox, oy: g.oy, grid: g.grid, lift: v.lift, squash: v.squash, q, seed: f.seed }, F);
  }
  if ( !live.size ) { stop(); return; }
  // the soft shadows (a falling bomb's, a thrown grenade's): pooled feathered sprites under everything else
  const SF = F.soft, st = softTexture();
  let ns = 0;
  for ( let i = 0; i < SF.length; i += 5, ns++ ) {
    let s = softPool[ns];
    if ( !s ) { s = softPool[ns] = new PIXI.Sprite(st); s.anchor.set(0.5); s.eventMode = "none"; s.tint = A.SHADE; softBox.addChild(s); }
    s.position.set(SF[i], SF[i + 1]); s.width = 2 * SF[i + 2]; s.height = 2 * SF[i + 3]; s.alpha = SF[i + 4]; s.visible = true;
  }
  for ( let k = ns; k < softPool.length; k++ ) softPool[k].visible = false;
  // colour (dim first: a brighter pixel drawn later wins) and its emission
  colG.clear(); glowG.clear(); shadeG.clear(); addG.clear();
  const ap = g.ap;
  F.shade.forEach((L, k) => {
    if ( !L.length ) return;
    shadeG.beginFill(A.SHADE, A.SHADE_A[k]);
    for ( let i = 0; i < L.length; i += 2 ) shadeG.drawRect(g.ox + L[i] * ap, g.oy + L[i + 1] * ap, ap, ap);
    shadeG.endFill();
  });
  for ( let c = A.PAL.length - 1; c >= 0; c-- ) {
    const L = F.px[c]; if ( !L.length ) continue;
    const em = A.GLOW[c] > 0;
    colG.beginFill(A.PAL[c], 1); if ( em ) glowG.beginFill(mul(0xffffff, A.GLOW[c]), 1);
    for ( let i = 0; i < L.length; i += 2 ) { const x = g.ox + L[i] * ap, y = g.oy + L[i + 1] * ap; colG.drawRect(x, y, ap, ap); if ( em ) glowG.drawRect(x, y, ap, ap); }
    colG.endFill(); if ( em ) glowG.endFill();
  }
  // the HALO pixels (additive, part strength: a tracer's / a flame's glow), and their emission at night
  const AD = F.add;
  if ( AD.length ) {
    for ( let c = 1; c <= 3; c++ ) {
      addG.beginFill(A.PAL[c], c === 1 ? 0.5 : c === 2 ? 0.4 : 0.28); glowG.beginFill(mul(0xffffff, A.GLOW[c] * 0.6), 1);
      for ( let i = 0; i < AD.length; i += 3 ) if ( AD[i + 2] === c ) { const x = g.ox + AD[i] * ap, y = g.oy + AD[i + 1] * ap; addG.drawRect(x, y, ap, ap); glowG.drawRect(x, y, ap, ap); }
      addG.endFill(); glowG.endFill();
    }
  }
  spurtSprites(g, v);
  // the BLOOMS: a soft light over a shooter's flash (it lights the token too: the ground light under it is hidden by the token),
  // stronger in the dark
  const BL = F.blooms, bt = bloomTexture(), darkB = Math.min(1, Math.max(0, canvas.environment?.darknessLevel ?? 0));
  let nb = 0;
  for ( let i = 0; i < BL.length; i += 5, nb++ ) {
    let s = bloomPool[nb];
    if ( !s ) { s = bloomPool[nb] = new PIXI.Sprite(bt); s.anchor.set(0.5); s.blendMode = PIXI.BLEND_MODES.ADD; s.eventMode = "none"; bloomBox.addChild(s); }
    s.position.set(BL[i], BL[i + 1]); s.width = 2 * BL[i + 2]; s.height = 2 * BL[i + 2] * v.squash;
    s.tint = A.PAL[BL[i + 4]]; s.alpha = Math.min(1, BL[i + 3] * (0.18 + 0.72 * darkB)); s.visible = true;
  }
  for ( let k = nb; k < bloomPool.length; k++ ) bloomPool[k].visible = false;
  bakeAhead();
  // the ground glows (night light round the hits / the muzzle): pooled sprites in the emission container
  const G = F.glows, tex = glowTexture();
  let n = 0;
  for ( let i = 0; i < G.length; i += 5, n++ ) {
    let s = glowPool[n];
    if ( !s ) { s = glowPool[n] = new PIXI.Sprite(tex); s.anchor.set(0.5); s.blendMode = PIXI.BLEND_MODES.MAX_COLOR; s.eventMode = "none"; glowBox.addChild(s); }
    const r = G[i + 2];
    s.position.set(G[i], G[i + 1]); s.width = 2 * r; s.height = 2 * r * v.squash;
    s.tint = mul(A.PAL[G[i + 4]], Math.min(1, G[i + 3])); s.visible = true;
  }
  for ( let k = n; k < glowPool.length; k++ ) glowPool[k].visible = false;
  rumble(F.kicks, F.shakes, now);
  flash(F.flashes);
}

/**
 * The hits' SPURTS (gun-fx.mjs): one pooled sprite each, its baked frame at the art grid (anchored at the hit's ground point, snapped
 * to the art grid), tinted with that ground's dust colour - a moonlit one at night (lifted against the ambience, as the fire's) -
 * the nearer ones drawn over the farther.
 */
function spurtSprites(g, v) {
  const L = F.spurts ?? [], N = L.length / X.SPURT_STRIDE, ap = g.ap, S = Math.max(8, Math.round(g.grid / ap)), lift = Math.round(v.lift * 20) / 20;
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => L[a * X.SPURT_STRIDE + 1] - L[b * X.SPURT_STRIDE + 1]);
  const dark = Math.min(1, Math.max(0, canvas.environment?.darknessLevel ?? 0));
  let amb = 1;
  if ( dark > 0 ) {
    const env = canvas.scene?.environment, cyc = env?.cycle !== false, bl = env?.base?.luminosity ?? 0, dl = env?.dark?.luminosity ?? 0;
    const lb = cyc ? bl + (dl - bl) * dark : bl, lum = lb * (lb >= 0 ? 1.2 : 0.8); amb = 1 / Math.max(0.2, 1 + lum);
  }
  let n = 0;
  for ( const i of order ) {
    const o = i * X.SPURT_STRIDE, kind = X.SPURT_KINDS[L[o + 2]], tex = spurtTexture(kind, S, lift, L[o + 3], L[o + 4]), b = tex.mmBox, flip = L[o + 6] === 1;
    let s = spurtPool[n];
    if ( !s ) { s = spurtPool[n] = new PIXI.Sprite(tex); s.eventMode = "none"; spurtBox.addChild(s); }
    s.texture = tex; s.scale.set(flip ? -ap : ap, ap);
    // (mirrored: its ground texel stays on the hit - the sprite's left edge moves to the right of it)
    const gx = Math.floor((L[o] - g.ox) / ap);
    s.position.set(g.ox + (flip ? gx + b.cx + 1 : gx - b.cx) * ap, g.oy + (Math.floor((L[o + 1] - g.oy) / ap) - b.gy) * ap);
    const T = L[o + 5] >= 0 ? X.unpackRgb(L[o + 5]) : [0.6, 0.53, 0.43];
    s.tint = X.packRgb(X.dustNight(X.SPURT[kind].wet ? X.splashLit(T) : X.dustLit(T), dark, amb));
    s.zIndex = n; s.visible = true; n++;
  }
  for ( let k = n; k < spurtPool.length; k++ ) spurtPool[k].visible = false;
}

/** How much of a cue at (x, y) reaches this client's view: 1 on screen, falling off past it (NaN: everywhere). */
function nearView(x, y) {
  if ( !Number.isFinite(x) || !Number.isFinite(y) ) return 1;
  const st = canvas.stage, sc = st.scale.x, vw = canvas.app.screen.width / sc, vh = canvas.app.screen.height / sc;
  const d = Math.hypot((x - st.pivot.x) / (vw / 2), (y - st.pivot.y) / (vh / 2));
  return d <= 1 ? 1 : Math.max(0, 1 - (d - 1) / 1.5);
}

/** A blast's FLASH: a warm overlay over the board for a moment (never for an opted-out client). */
function flash(L) {
  if ( !L.length && !flashEl ) return;
  let a = 0, at = null;
  if ( L.length ) {
    let opts = null; try { opts = clientOpts(); } catch { /* not ready */ }
    if ( !opts?.noFlash && !opts?.reduced ) for ( let i = 0; i < L.length; i += 3 ) { const v = L[i + 2] * nearView(L[i], L[i + 1]); if ( v > a ) { a = v; at = [L[i], L[i + 1]]; } }
  }
  if ( !flashEl ) {
    if ( a < 0.005 ) return;
    flashEl = document.createElement("div");
    Object.assign(flashEl.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "1", background: "#fff3dc", opacity: "0", mixBlendMode: "screen" });
    flashEl.className = "mm-preset-flash";
    document.body.appendChild(flashEl);
  }
  // (a pool of light round the blast, not a wash of the whole screen: brightest over it, gone towards the edges; in the dark it is
  // weaker - the burst's own light lights the ground there, a screen-wide lift read as a grey veil)
  if ( a >= 0.005 && at ) {
    let cx = 50, cy = 50, R = 70;
    try {
      const st = canvas.stage, p = st.worldTransform.apply({ x: at[0], y: at[1] }), r = canvas.app.renderer.resolution || 1;
      const w = canvas.app.screen.width, h = canvas.app.screen.height;
      cx = Math.round(p.x / (canvas.app.renderer.width / r) * 100); cy = Math.round(p.y / (canvas.app.renderer.height / r) * 100);
      R = Math.round(Math.max(45, Math.min(110, 0.75 * Math.hypot(w, h) / Math.max(w, h) * 100)));
    } catch { /* keep the centre */ }
    flashEl.style.background = `radial-gradient(ellipse ${R}% ${Math.round(R * 1.15)}% at ${cx}% ${cy}%, #fff6e2 0%, rgba(255,236,204,0.75) 30%, rgba(255,228,190,0.25) 65%, rgba(255,224,184,0) 100%)`;
  }
  const dark = Math.min(1, Math.max(0, canvas.environment?.darknessLevel ?? 0));
  flashEl.style.opacity = String(Math.round(Math.min(0.6, 0.55 * a) * (1 - 0.55 * dark) * 1000) / 1000);
}

/** The screen shake of the heavy hits near the view (a small jitter, at most a few screen px) and of a blast's screen cue (up to
 * SHAKE_PX, decaying), never for an opted-out client. */
function rumble(K, S, now) {
  if ( !K.length && !S.length && !shaker ) return;
  let opts = null; try { opts = clientOpts(); } catch { /* not ready */ }
  if ( opts?.noShake || opts?.reduced ) return;
  const st = canvas.stage, sc = st.scale.x, vw = canvas.app.screen.width / sc, vh = canvas.app.screen.height / sc;
  const cx = st.pivot.x, cy = st.pivot.y, R = 0.6 * Math.hypot(vw, vh);
  let e = 0;
  for ( let i = 0; i < K.length; i += 3 ) { const d = Math.hypot(K[i] - cx, K[i + 1] - cy); e += K[i + 2] * Math.max(0, 1 - d / R); }
  let b = 0;
  for ( let i = 0; i < S.length; i += 3 ) b = Math.max(b, S[i + 2] * (0.35 + 0.65 * nearView(S[i], S[i + 1])));
  const amp = Math.min(3.2, 2.2 * e) + Math.min(A.SHAKE_PX, b);
  if ( amp < 0.05 ) { shaker?.restore(); shaker = null; return; }
  shaker ??= new StageShaker(st);
  const k = Math.floor(now / 33);
  shaker.apply(Math.round((A.h3(k, 1, 77) - 0.5) * 2 * amp), Math.round((A.h3(k, 2, 77) - 0.5) * 2 * amp));
}

/** Tools (dev/guns-cost.mjs): the drawing containers, for a weak-GPU emulation that draws them more than once. */
export const roots = () => ({ root, glowBox });
/** Tests / tools: what is live and drawn. */
export const status = () => ({ live: [...live.keys()], ticking, px: F.px.reduce((a, l) => a + l.length / 2, 0), glows: F.glows.length / 5 });
