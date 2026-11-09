import { sharedNow } from "../shared-clock.mjs";
import { reducedMotion } from "../config.mjs";
import { view } from "../view-angle.mjs";
import { guardQ, guardOff } from "../frame-guard.mjs";
import { StageShaker } from "../director/screen.mjs";
import { clientOpts } from "../director/stage.mjs";
import { geo as fireGeo } from "../fire/fire.mjs";
import * as A from "./accents-core.mjs";

/**
 * DESTRUCTION PRESETS, the gun ACCENTS on every client (the pure drawing rules: accents-core.mjs): tracers, hit flashes and sparks,
 * the muzzle flash and bullet streaks, a short ground glow round each hit at night and a rumble of the screen under a heavy gun.
 * Loaded by presets.mjs on the first firing record a client takes up that has gun accents; it listens to the firings runtime
 * (runtime.mjs: "firing" / "gone"), draws while one of its firings has anything in flight, then removes its ticker - a scene without
 * gun firings runs nothing of this.
 *  - COLOUR: art pixels (the destruction layer's art grid) in a container of the primary group above the tokens and the smoke
 *    (sortLayer 820): they are in the air or flashing on the ground, never under a token.
 *  - NIGHT: the same pixels, as their emission, in Foundry's illumination (MAX_COLOR, as the fire's glow): they are lit by
 *    themselves, and a short warm glow round each hit lights the ground for a moment; vision and fog apply as to the fire.
 *  - RUMBLE: a heavy gun's hits near the view shake the screen a little (the stage offset as the cinematic shake: StageShaker),
 *    never for a player who opted out of shake (or wants reduced motion).
 *  - Reduced motion: nothing is drawn (the damage and the settled dust are the result). The client's frame guard thins the sparks.
 */
const SORT_LAYER = 820;
const live = new Map();             // fid -> { t0, items, end, seed }
let root = null, colG = null, glowBox = null, glowG = null, glowPool = [], ticking = false, hookL = 0, shaker = null, glowTex = null;
const F = A.newFrame();

/** Records with gun accents (what this layer draws). */
export const gunItems = (rec) => (rec?.pending?.accent ?? []).filter((a) => a && (a.kind === "tracer" || a.kind === "hitFx" || a.kind === "muzzle"));

export function take(rec) {
  const items = gunItems(rec);
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
  colG = new PIXI.Graphics(); root.addChild(colG);
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
  if ( glowG && !glowG.destroyed ) glowG.clear();
  for ( const s of glowPool ) s.visible = false;
}
/** The scene goes: everything of this layer goes with it. */
export function reset() {
  stop(); live.clear();
  if ( hookL ) Hooks.off("lightingRefresh", hookL); hookL = 0;
  if ( root && !root.destroyed ) root.destroy({ children: true });
  if ( glowBox && !glowBox.destroyed ) { glowBox.parent?.removeChild(glowBox); glowBox.destroy({ children: true }); }
  root = colG = glowBox = glowG = null; glowPool = [];
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
  colG.clear(); glowG.clear();
  const ap = g.ap;
  for ( let c = A.PAL.length - 1; c >= 0; c-- ) {
    const L = F.px[c]; if ( !L.length ) continue;
    colG.beginFill(A.PAL[c], 1); glowG.beginFill(mul(0xffffff, A.GLOW[c]), 1);
    for ( let i = 0; i < L.length; i += 2 ) { const x = g.ox + L[i] * ap, y = g.oy + L[i + 1] * ap; colG.drawRect(x, y, ap, ap); glowG.drawRect(x, y, ap, ap); }
    colG.endFill(); glowG.endFill();
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
  rumble(F.kicks, now);
}

/** The screen shake of the heavy hits near the view: a small jitter, at most a few screen px, never for an opted-out client. */
function rumble(K, now) {
  if ( !K.length && !shaker ) return;
  let opts = null; try { opts = clientOpts(); } catch { /* not ready */ }
  if ( opts?.noShake || opts?.reduced ) return;
  const st = canvas.stage, sc = st.scale.x, vw = canvas.app.screen.width / sc, vh = canvas.app.screen.height / sc;
  const cx = st.pivot.x, cy = st.pivot.y, R = 0.6 * Math.hypot(vw, vh);
  let e = 0;
  for ( let i = 0; i < K.length; i += 3 ) { const d = Math.hypot(K[i] - cx, K[i + 1] - cy); e += K[i + 2] * Math.max(0, 1 - d / R); }
  const amp = Math.min(3.2, 2.2 * e);
  if ( amp < 0.05 ) { shaker?.restore(); shaker = null; return; }
  shaker ??= new StageShaker(st);
  const k = Math.floor(now / 33);
  shaker.apply(Math.round((A.h3(k, 1, 77) - 0.5) * 2 * amp), Math.round((A.h3(k, 2, 77) - 0.5) * 2 * amp));
}

/** Tools (dev/guns-cost.mjs): the drawing containers, for a weak-GPU emulation that draws them more than once. */
export const roots = () => ({ root, glowBox });
/** Tests / tools: what is live and drawn. */
export const status = () => ({ live: [...live.keys()], ticking, px: F.px.reduce((a, l) => a + l.length / 2, 0), glows: F.glows.length / 5 });
