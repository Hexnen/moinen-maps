import { sharedNow } from "../shared-clock.mjs";
import { reducedMotion } from "../config.mjs";
import { view } from "../view-angle.mjs";
import { guardQ, guardOff } from "../frame-guard.mjs";
import { StageShaker } from "../director/screen.mjs";
import { clientOpts } from "../director/stage.mjs";
import { geo as fireGeo } from "../fire/fire.mjs";
import * as A from "./accents-core.mjs";

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
const F = A.newFrame();

/** Records with gun accents (what this layer draws). */
export const gunItems = (rec) => (rec?.pending?.accent ?? []).filter((a) => a && (a.kind === "tracer" || a.kind === "hitFx" || a.kind === "muzzle"));

export function take(rec) {
  const items = A.itemsOf(rec);
  if ( !items.length || reducedMotion() ) return;
  let end = -Infinity;
  for ( const it of items ) { const s = A.spanOf(it); if ( s ) end = Math.max(end, rec.t0 + s[1]); }
  if ( !(end > sharedNow()) ) return;
  live.set(rec.id, { t0: rec.t0, items, end, seed: (Number(rec.seed) | 0) || 1 });
  arm();
}
export function drop(fid) { if ( live.delete(fid) && !live.size ) stop(); }

function mount() {
  if ( root && !root.destroyed && root.parent ) return;
  root = new PIXI.Container();
  root.eventMode = "none"; root.interactiveChildren = false;
  Object.assign(root, { elevation: 0, sortLayer: SORT_LAYER, sort: 0, _lastSortedIndex: 0 });
  shadeG = new PIXI.Graphics(); colG = new PIXI.Graphics(); root.addChild(shadeG, colG);
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
  if ( shadeG && !shadeG.destroyed ) shadeG.clear();
  if ( flashEl ) flashEl.style.opacity = "0";
  if ( glowG && !glowG.destroyed ) glowG.clear();
  for ( const s of glowPool ) s.visible = false;
}
/** The scene goes: everything of this layer goes with it. */
export function reset() {
  stop(); live.clear();
  if ( hookL ) Hooks.off("lightingRefresh", hookL); hookL = 0;
  if ( root && !root.destroyed ) root.destroy({ children: true });
  if ( glowBox && !glowBox.destroyed ) { glowBox.parent?.removeChild(glowBox); glowBox.destroy({ children: true }); }
  flashEl?.remove();
  root = colG = shadeG = glowBox = glowG = flashEl = null; glowPool = [];
}

/** A soft-stepped round glow (pixel-art: 4 flat rings with dithered edges, 32 x 32), white: tinted and scaled per hit. */
function glowTexture() {
  if ( glowTex && !glowTex.baseTexture?.destroyed ) return glowTex;
  const N = 32, a = new Uint8Array(N * N * 4);
  for ( let y = 0; y < N; y++ ) for ( let x = 0; x < N; x++ ) {
    const d = Math.hypot(x + 0.5 - N / 2, (y + 0.5 - N / 2)) / (N / 2), dz = (A.h3(x >> 1, y >> 1, 5) - 0.5) * 0.12, e = d + dz;
    const v = e < 0.3 ? 1 : e < 0.55 ? 0.62 : e < 0.78 ? 0.34 : e < 1 ? 0.14 : 0;
    const o = (y * N + x) * 4; a[o] = a[o + 1] = a[o + 2] = Math.round(255 * v); a[o + 3] = 255;
  }
  glowTex = PIXI.Texture.fromBuffer(a, N, N);
  glowTex.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST; glowTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
  return glowTex;
}
const mul = (c, k) => ((Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k));

function tick() {
  if ( !canvas?.ready || !root || root.destroyed ) { stop(); return; }
  const now = sharedNow(), g = fireGeo(), v = view(), q = guardQ("presets");
  A.clearFrame(F);
  for ( const [fid, f] of live ) {
    if ( now > f.end ) { live.delete(fid); continue; }
    A.draw(f.items, f.t0, now, { ap: g.ap, ox: g.ox, oy: g.oy, grid: g.grid, lift: v.lift, squash: v.squash, q, seed: f.seed }, F);
  }
  if ( !live.size ) { stop(); return; }
  // colour (dim first: a brighter pixel drawn later wins) and its emission
  colG.clear(); glowG.clear(); shadeG.clear();
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
