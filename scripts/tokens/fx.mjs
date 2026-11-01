/**
 * TOKEN EFFECTS (runtime): enter, leave, idle and death styles. Purely cosmetic: nothing here writes a document. Every client draws
 * the same from the same hooks; the curves and seeds are pure (tokens/styles.mjs), so all clients agree.
 *
 *  - Rig    one per token that needs it (idle, a running enter / death / revive, a corpse look). It owns the mesh pose the same way
 *           token-drop.mjs's Drop does: the base transform Foundry set is captured part by part, only when Foundry's refresh flags say
 *           it reset that part (never our own offset), and the pose is re-applied in the `refreshToken` hook in the same frame. It
 *           yields while an older effect of token-drop.mjs (drop, hop, lock, combat entry) runs on the token.
 *  - Leave  a cosmetic GHOST of a token that is deleted or hidden (Foundry destroys / stops drawing the real one at once): a copy of
 *           its texture and transform in the primary group, next to where the token was, animated and dropped.
 *  - Wisp / SkullRise   small extras of the death styles.
 * One shared ticker callback; particles are pooled (tokens/pixels.mjs); idle is skipped off screen.
 */
import { MODULE_ID, reducedMotion, dbg } from "../config.mjs";
import { perfMode } from "../perf-mode.mjs";
import { shadowTextures } from "../pin-art.mjs";
import { tokenBusy, restoreExact } from "../token-drop.mjs";
import { Emitter, artPx, cellsOf, paletteOf, greyOf, drainPools } from "./pixels.mjs";
import * as St from "./styles.mjs";
import { fxFor, tokenFxOn, runtime } from "./settings.mjs";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const INK = 0x15110f, BONE = 0xf3e6cc;
const DUST = [0xd8ccb4, 0xb8a990, 0x8f816c, 0xc9bca2];
const EARTH = [0x6b5236, 0x8a6a45, 0x4a3826, 0x9c8f7c];
const BEAM = [0xffffff, 0xd8f4ff, 0x8fd8ff, 0x5ab4ff];
const SPARK = [0xfffbe8, 0xffe08a, 0xffffff];
const PORTAL = [0xc59bff, 0x8a5cff, 0x6fe0ff, 0xffffff];
const SMOKE = [0x9a948c, 0x7d7871, 0xb7b1a8, 0x5f5a54];
const SOUL = 0xcfe8ff;

const RIGS = new Map();        // Token -> Rig
const EXTRAS = new Set();      // Leave, Wisp, SkullRise: { update(dt) -> alive, end() }
const KNOWN = new Map();       // token document id -> dead (on the viewed scene, this client)
const bursts = {};
let ticking = false;
let clock = 0;                 // seconds of this client's effects clock (idle phases)
const view = { x0: 0, y0: 0, x1: 0, y1: 0 };
const P = new PIXI.Point();

/* ================================================================== ticker */

function tick(frames) {
  const dt = Math.min(frames / 60, 0.05);
  clock += dt;
  updateView();
  for ( const r of [...RIGS.values()] ) r.update(dt);
  for ( const x of [...EXTRAS] ) if ( !x.update(dt) ) { x.end(); EXTRAS.delete(x); }
  if ( !RIGS.size && !EXTRAS.size ) stopTicker();
}
function startTicker() { if ( !ticking && canvas.app?.ticker ) { canvas.app.ticker.add(tick); ticking = true; } }
function stopTicker() { if ( ticking ) { canvas.app?.ticker?.remove(tick); ticking = false; } }

/** The visible canvas rectangle (with a margin), for the off-screen cull of idle. */
function updateView() {
  const r = canvas.app?.renderer; if ( !r || !canvas.stage ) return;
  const m = 200;
  canvas.stage.worldTransform.applyInverse({ x: 0, y: 0 }, P); view.x0 = P.x - m; view.y0 = P.y - m;
  canvas.stage.worldTransform.applyInverse({ x: r.screen.width, y: r.screen.height }, P); view.x1 = P.x + m; view.y1 = P.y + m;
}
const onScreen = (t) => { const d = t.document; return d.x + t.w > view.x0 && d.x < view.x1 && d.y + t.h > view.y0 && d.y < view.y1; };

/** Stagger index of the next item in a burst of one kind: null past 25 at once (they are not animated). */
function burstIndex(kind) {
  const now = performance.now(), b = bursts[kind] ??= { t: 0, n: 0 };
  if ( now - b.t > 300 ) b.n = 0;
  b.t = now;
  return b.n++;
}

/** May animated effects play on this client for this token? (kill switch, reduced motion, who / which tokens of the scene settings) */
function mayAnimate(token, c = fxFor(token.document)) {
  if ( !tokenFxOn() ) return false;
  if ( reducedMotion() ) return false;
  if ( c.who === "gm" && !game.user.isGM ) return false;
  const owned = !!token.document.actor?.hasPlayerOwner;
  if ( c.filter === "player" && !owned ) return false;
  if ( c.filter === "npc" && owned ) return false;
  return true;
}
const lowMode = () => perfMode() === "low";
const mediumMode = () => perfMode() === "medium";

/** Put a display object in the primary group next to a token's mesh in the sort order (step -1 under it, +1 over it). */
function sortNextTo(obj, token, step) {
  const m = token.mesh;
  Object.assign(obj, { elevation: m?.elevation ?? token.document.elevation ?? 0, sortLayer: m?.sortLayer ?? 700, sort: (m?.sort ?? 0) + step, _lastSortedIndex: 0 });
  canvas.primary.addChild(obj);
}

/** Offset, scale and tilt a display object about the ground point (gx, gy) from the base transform `b`; x / y of the pose in token units. */
function place(obj, b, p, gx, gy, W, H) {
  const rotated = Math.abs(b.rot) > 0.001;
  const u = Math.sqrt(Math.max(0, p.sx * p.sy)), sx = rotated ? u : p.sx, sy = rotated ? u : p.sy;
  const rx = (b.px - gx) * sx, ry = (b.py - gy) * sy, c = Math.cos(p.rot), s = Math.sin(p.rot);
  obj.position.set(gx + rx * c - ry * s + p.x * W, gy + rx * s + ry * c + p.y * H);
  obj.scale.set(b.sx * sx, b.sy * sy);
  obj.rotation = b.rot + p.rot;
}

/* ================================================================== particles of the styles */

const pick = (arr, seed, i) => arr[Math.floor(St.rand01(seed, i) * arr.length) % arr.length];

function dust(em, gx, gy, W, n, seed, { up = 1, colors = DUST, spread = 1 } = {}) {
  const ap = em.ap;
  for ( let i = 0; i < n; i++ ) {
    const a = (i / n) * St.TAU + St.rand01(seed, i) * 0.6, r = W * (0.25 + 0.12 * St.rand01(seed, i + 50));
    const sp = ap * (10 + 14 * St.rand01(seed, i + 90)) * spread;
    em.add(gx + Math.cos(a) * r, gy + Math.sin(a) * r * 0.35, Math.cos(a) * sp, Math.sin(a) * sp * 0.35 - ap * 6 * up,
      { life: 0.45 + 0.35 * St.rand01(seed, i + 7), drag: 3, g: -ap * 4 * up, color: pick(colors, seed, i + 3), size: 1 + (St.rand01(seed, i + 11) < 0.3 ? 1 : 0) });
  }
}
function sparkles(em, cx, cy, n, R, seed, colors = SPARK, life = 0.4) {
  const ap = em.ap;
  for ( let i = 0; i < n; i++ ) {
    const a = (i / n) * St.TAU + St.rand01(seed, i + 200) * 0.5, sp = ap * (30 + 40 * St.rand01(seed, i + 300));
    em.add(cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.8, Math.cos(a) * sp, Math.sin(a) * sp * 0.8, { life: life * (0.7 + 0.6 * St.rand01(seed, i + 400)), drag: 4, color: pick(colors, seed, i), add: true });
  }
}
function clods(em, gx, gy, W, n, seed) {
  const ap = em.ap;
  for ( let i = 0; i < n; i++ ) {
    const a = St.rand01(seed, i + 500) * St.TAU, sp = ap * (12 + 18 * St.rand01(seed, i + 600));
    em.add(gx + Math.cos(a) * W * 0.3, gy + Math.sin(a) * W * 0.08, Math.cos(a) * sp, -ap * (30 + 30 * St.rand01(seed, i + 700)),
      { life: 0.6 + 0.3 * St.rand01(seed, i), g: ap * 180, ground: gy + Math.sin(a) * W * 0.1, color: pick(EARTH, seed, i), size: St.rand01(seed, i + 800) < 0.35 ? 2 : 1 });
  }
}
/** A flickering vertical column of light from far above down to the ground (one frame's worth). */
function beam(em, cx, gy, W, H, seed, n = 7) {
  const ap = em.ap;
  for ( let i = 0; i < n; i++ ) {
    const k = Math.random();     // a flicker, not part of any shared state
    em.add(cx + (k - 0.5) * W * 0.36, gy - H * 3.2 * Math.random(), 0, ap * 30, { life: 0.1 + 0.08 * k, color: BEAM[(i + (k * 4 | 0)) % BEAM.length], add: true, drop: false, size: k < 0.3 ? 2 : 1 });
  }
}
function smoke(em, cx, cy, W, n, seed) {
  const ap = em.ap;
  for ( let i = 0; i < n; i++ ) {
    const a = St.rand01(seed, i + 900) * St.TAU, r = W * 0.35 * Math.sqrt(St.rand01(seed, i + 950)), sp = ap * (6 + 14 * St.rand01(seed, i + 990));
    em.add(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, Math.cos(a) * sp, Math.sin(a) * sp - ap * 10,
      { life: 0.55 + 0.35 * St.rand01(seed, i + 30), drag: 2.5, g: -ap * 8, color: pick(SMOKE, seed, i), size: 2 + (St.rand01(seed, i + 40) < 0.5 ? 1 : 0), delay: 0.05 * St.rand01(seed, i + 60) });
  }
}

/**
 * The token's own pixels as particles. `geo` = { tex, ax, ay, px, py, sx, sy, rot } (the mesh as it was), `mode`:
 *  dissolve (rows from the top drift up and drop out), confetti (flung out, gravity), ash (blown sideways in grey), gather (fly in
 *  from round about onto the token: materialise), drip (the lower rows run down: melt)
 */
function cellParticles(em, geo, mode, seed, { dur = 0.8, gy = null, k = 1 } = {}) {
  const ap = em.ap, tw = geo.tex.frame?.width ?? geo.tex.width, th = geo.tex.frame?.height ?? geo.tex.height;
  const w = Math.abs(tw * geo.sx), max = mediumMode() ? 16 : 24;
  const cols = clamp(Math.round(w / (ap * 2)), 6, max), rows = clamp(Math.round(cols * (th / tw)), 6, max);
  const cells = cellsOf(geo.tex, cols, rows); if ( !cells ) return null;
  const c = Math.cos(geo.rot), s = Math.sin(geo.rot), size = Math.max(1, Math.round(w / cols / ap));
  for ( let j = 0; j < rows; j++ ) for ( let i = 0; i < cols; i++ ) {
    const col = cells.color[j * cols + i]; if ( col < 0 ) continue;
    const lx = ((i + 0.5) / cols - geo.ax) * tw * geo.sx, ly = ((j + 0.5) / rows - geo.ay) * th * geo.sy;
    const x = geo.px + lx * c - ly * s, y = geo.py + lx * s + ly * c, h = St.rand01(seed, j * 97 + i);
    if ( mode === "dissolve" ) em.add(x, y, (h - 0.5) * ap * 14, -ap * (14 + 20 * St.rand01(seed, i * 31 + j)), { life: 0.55 + 0.25 * h, delay: (j / rows) * dur * 0.35 + h * 0.08, drag: 1.2, g: -ap * 10, color: col, size });
    else if ( mode === "ash" ) em.add(x, y, ap * (10 + 22 * h) * (St.rand01(seed, 3) < 0.5 ? -1 : 1), -ap * (6 + 12 * St.rand01(seed, i + j * 7)), { life: 0.6 + 0.4 * h, delay: (1 - j / rows) * dur * 0.4 * 0 + (j / rows) * dur * 0.25 + h * 0.15, drag: 1, g: -ap * 6, color: greyOf(col, 0.55 + 0.3 * h), size });
    else if ( mode === "confetti" ) {
      const a = Math.atan2(y - geo.py, x - geo.px) + (h - 0.5) * 0.8, sp = ap * (40 + 50 * St.rand01(seed, i * 13 + j)) * k;
      em.add(x, y, Math.cos(a) * sp, Math.sin(a) * sp - ap * 30, { life: 0.5 + 0.35 * h, drag: 1.4, g: ap * 120, color: col, size, ground: gy });
    } else if ( mode === "gather" ) {
      const a = h * St.TAU, r = (0.6 + 0.6 * St.rand01(seed, i + j * 41)) * w;
      em.add(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7 - w * 0.3, 0, 0, { mode: 1, tx: x, ty: y, tt: dur * (0.45 + 0.25 * St.rand01(seed, i * 5 + j)), life: dur * 0.78, color: col, size, drop: false, delay: h * dur * 0.1 });
    } else if ( mode === "drip" ) {
      if ( j < rows * 0.55 || h > 0.35 ) continue;
      em.add(x, y, (h - 0.2) * ap * 4, ap * 4, { life: 0.7 + 0.4 * h, delay: dur * (0.2 + 0.5 * St.rand01(seed, i + j * 3)), g: ap * 60, ground: gy, color: col, size });
    }
  }
  return cells;
}

/* ================================================================== the corpse badge: a pixel skull (and cracks) on the token */

function drawSkull(box, x, y, ap) {
  const S = St.SKULL;
  // an ink outline round the bone, then the bone and its ink details
  for ( let j = -1; j <= S.length; j++ ) for ( let i = -1; i <= S[0].length; i++ ) {
    const at = (a, b) => S[b]?.[a] && S[b][a] !== "0";
    if ( at(i, j) ) continue;
    if ( at(i - 1, j) || at(i + 1, j) || at(i, j - 1) || at(i, j + 1) ) addPx(box, x + i * ap, y + j * ap, ap, INK, 0.9);
  }
  for ( let j = 0; j < S.length; j++ ) for ( let i = 0; i < S[j].length; i++ ) {
    const v = S[j][i]; if ( v === "0" ) continue;
    addPx(box, x + i * ap, y + j * ap, ap, v === "2" ? INK : BONE, 1);
  }
}
function addPx(box, x, y, ap, color, alpha) {
  const s = box.addChild(new PIXI.Sprite(PIXI.Texture.WHITE));
  s.tint = color; s.alpha = alpha; s.position.set(x, y); s.width = s.height = ap; s.eventMode = "none";
  return s;
}
function drawCracks(box, W, H, seed, ap, upto = 1) {
  const lines = St.crackLines(seed, 5);
  for ( const pts of lines ) {
    const n = Math.max(1, Math.round((pts.length - 1) * upto));
    for ( let k = 0; k < n; k++ ) {
      const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
      const steps = Math.max(1, Math.round(Math.hypot((x1 - x0) * W, (y1 - y0) * H) / ap));
      for ( let q = 0; q <= steps; q++ ) addPx(box, Math.round((x0 + (x1 - x0) * q / steps) * W / ap) * ap, Math.round((y0 + (y1 - y0) * q / steps) * H / ap) * ap, ap, 0x2a2622, 0.75);
    }
  }
}

/* ================================================================== Rig: the mesh pose of one token */

const GREY = (() => {
  let f = null;
  return () => {
    if ( f && !f.destroyed ) return f;
    f = new PIXI.ColorMatrixFilter();
    // a cool, darkened greyscale (a dead look, not a photo negative)
    const k = 0.78;
    f.matrix = [0.3 * k, 0.59 * k, 0.11 * k, 0, 0.02, 0.3 * k, 0.59 * k, 0.11 * k, 0, 0.02, 0.3 * k, 0.59 * k, 0.11 * k, 0, 0.04, 0, 0, 0, 1, 0];
    return f;
  };
})();

class Rig {
  constructor(token) {
    this.token = token; this.id = token.document.id;
    this.seed = St.seedOf(this.id); this.tilt = St.tiltOf(this.id); this.phase = St.phaseOf(this.id);
    this.base = null; this.ready = !!token.mesh && !token.renderFlags?.size; this.age = 0;
    this.main = St.pose(); this.idle = St.pose(); this.out = St.pose(); this.last = St.pose({ alpha: -1 });
    this.fx = null; this.corpse = null; this.idleStyle = "none"; this.idleForce = null;
    this.applied = false; this.grey = 0; this.filter = null; this.glowSpr = null; this.shadow = null; this.overlay = null; this.overlayKey = "";
    this.root = null; this.em = null; this.kids = null;
    RIGS.set(token, this);
    startTicker();
  }

  /** Foundry refreshed the token: capture what it reset and re-apply our pose in the same frame (see token-drop.mjs Drop.refreshed). */
  refreshed(flags) {
    this.ready = true;
    const f = flags ?? {}, all = !this.base || !flags || f.refresh || f.redraw || f.refreshTransform;
    this.capture({ pos: all || f.refreshPosition, scale: all || f.refreshMesh || f.refreshSize, rot: all || f.refreshRotation, alpha: all || f.refreshMesh || f.refreshState || f.refreshSize, tint: all || f.refreshMesh });
    if ( this.applied || this.wants() ) this.apply(true);
  }

  capture(parts) {
    const t = this.token, m = t.mesh; if ( !m || m.destroyed ) return;
    const b = this.base ??= { px: 0, py: 0, sx: 1, sy: 1, rot: 0, alpha: 1, tint: 0xffffff };
    if ( parts.pos ) { b.px = m.position.x; b.py = m.position.y; }
    if ( parts.scale ) { b.sx = m.scale.x; b.sy = m.scale.y; }
    if ( parts.rot ) b.rot = m.rotation;
    if ( parts.alpha ) b.alpha = m.alpha;
    if ( parts.tint ) b.tint = m.tint;
  }

  /** Give the mesh back to Foundry (an older effect takes over, or nothing is left to draw). */
  release() {
    if ( this.applied ) { this.#setGrey(0); this.#kidsAlpha(1, true); restoreExact(this.token); }
    this.applied = false; this.base = null;
    if ( this.glowSpr ) this.glowSpr.visible = false;
    if ( this.shadow ) this.shadow.visible = false;
  }

  wants() { return !!(this.fx || this.corpse || this.activeIdle() !== "none"); }
  activeIdle() { return this.idleForce?.style ?? this.idleStyle; }

  idleAllowed(c) {
    const t = this.token;
    if ( this.corpse || this.token._mmDead ) return false;
    if ( !this.idleForce ) {
      if ( lowMode() || !tokenFxOn() || reducedMotion() || !mayAnimate(t, c) ) return false;
      if ( c.idleWhen !== "always" && (t.animationContexts?.size || t.isDragged) ) return false;
      if ( c.idleWhen === "outOfCombat" && combatHere() ) return false;
    }
    return t.visible && t.mesh?.visible;
  }

  update(dt) {
    const t = this.token;
    if ( t.destroyed || !t.mesh || t.mesh.destroyed ) return this.dispose(false);
    if ( tokenBusy(t) ) { if ( this.applied ) { this.applied = false; this.base = null; } return; }
    if ( !this.ready ) { this.age += dt; if ( this.age < 2 ) return; this.ready = true; }
    if ( !this.base ) this.capture({ pos: true, scale: true, rot: true, alpha: true, tint: true });
    if ( this.idleForce && (this.idleForce.until -= dt) <= 0 ) this.idleForce = null;
    const c = this.cfg ??= fxFor(t.document);
    // the main pose: a running effect, else the corpse look, else nothing
    const main = this.main;
    if ( this.fx ) { if ( this.fx.step(dt, main, this) ) this.#endFx(); }
    else if ( this.corpse ) St.setPose(main, this.corpse.pose);
    else St.setPose(main, St.POSE0);
    // idle on top (not for a corpse, not during an effect, not off screen)
    const style = this.activeIdle();
    let idle = null;
    if ( style !== "none" && !this.fx && this.idleAllowed(c) ) {
      if ( !onScreen(t) && !this.idleForce ) { if ( !this.applied ) return; }
      else {
        const turn = c.idleTurn && isTurn(t), amp = (this.idleForce ? 1 : c.idleAmp) * (turn ? 1.7 : 1);
        idle = St.idlePose(style, clock, this.phase, amp, c.idleSpeed, this.idle, t.hover);
        if ( turn ) idle.glow = Math.max(idle.glow, 0.18 + 0.14 * Math.sin(clock * 4 + this.phase));
      }
    }
    const o = this.out;
    if ( idle ) {
      o.x = main.x + idle.x; o.y = main.y + idle.y; o.sx = main.sx * idle.sx; o.sy = main.sy * idle.sy; o.rot = main.rot + idle.rot;
      o.alpha = main.alpha * idle.alpha; o.grey = main.grey; o.glow = Math.max(main.glow, idle.glow); o.shadow = idle.shadow;
    } else { St.setPose(o, main); o.shadow = 0; }
    if ( this.root && this.em ) { if ( !this.em.update(dt) && !this.fx ) this.#dropRoot(); }
    if ( !this.fx && !this.corpse && style === "none" && St.isIdentity(o) ) return this.dispose(true);
    this.apply(false);
  }

  apply(force) {
    const t = this.token, m = t.mesh, b = this.base, p = this.out;
    if ( !b || !m || m.destroyed || tokenBusy(t) ) return;
    const L = this.last;
    if ( !force && this.applied && L.x === p.x && L.y === p.y && L.sx === p.sx && L.sy === p.sy && L.rot === p.rot && L.alpha === p.alpha && L.grey === p.grey && L.glow === p.glow ) { this.#overlay(); return; }
    St.setPose(L, p);
    const { width: W, height: H } = t.document.getSize();
    const gx = b.px, gy = b.py + H / 2;   // the mesh sits at the token's centre: its ground point is the bottom of the footprint
    place(m, b, p, gx, gy, W, H);
    m.alpha = b.alpha * clamp(p.alpha, 0, 1);
    this.#setGrey(p.grey);
    this.#setGlow(p.glow);
    this.#setShadow(p.shadow ?? 0, gx, gy, W);
    if ( this.kids ) this.#kidsAlpha(clamp(p.alpha, 0, 1));
    this.#overlay();
    this.applied = true;
  }

  #setGrey(g) {
    const m = this.token.mesh; if ( !m || m.destroyed ) return;
    g = clamp(g || 0, 0, 1);
    if ( g < 0.01 ) {
      if ( this.filter ) { m.filters = (m.filters ?? []).filter((f) => f !== this.filter); if ( !m.filters.length ) m.filters = null; this.filter = null; }
      if ( this.grey && this.base ) m.tint = this.base.tint;
      this.grey = 0; return;
    }
    this.grey = g;
    if ( lowMode() ) {
      // no filter in Low mode: a darker tint instead
      const k = 1 - 0.4 * g, tint = this.base?.tint ?? 0xffffff;
      m.tint = (Math.round(((tint >> 16) & 255) * k) << 16) | (Math.round(((tint >> 8) & 255) * k) << 8) | Math.round((tint & 255) * k);
      return;
    }
    if ( g >= 0.999 ) { if ( this.filter !== GREY() ) { this.#setGrey(0); this.filter = GREY(); m.filters = [...(m.filters ?? []), this.filter]; this.grey = 1; } return; }
    if ( !this.filter || this.filter === GREY() ) {
      if ( this.filter ) m.filters = (m.filters ?? []).filter((f) => f !== this.filter);
      this.filter = new PIXI.ColorMatrixFilter(); this.filter.matrix = [...GREY().matrix];
      m.filters = [...(m.filters ?? []), this.filter];
    }
    this.filter.alpha = g;
  }

  #setGlow(a) {
    const t = this.token, m = t.mesh;
    if ( a < 0.01 ) { if ( this.glowSpr ) this.glowSpr.visible = false; return; }
    let g = this.glowSpr;
    if ( !g || g.destroyed ) { g = this.glowSpr = new PIXI.Sprite(m.texture); g.blendMode = PIXI.BLEND_MODES.ADD; g.eventMode = "none"; sortNextTo(g, t, 1); }
    if ( g.texture !== m.texture ) g.texture = m.texture;
    g.anchor.set(m.anchor.x, m.anchor.y); g.position.copyFrom(m.position); g.scale.copyFrom(m.scale); g.rotation = m.rotation;
    g.visible = m.visible && t.visible; g.alpha = clamp(a, 0, 1) * 0.85;
  }

  #setShadow(k, gx, gy, W) {
    if ( !(k > 0) ) { if ( this.shadow ) this.shadow.visible = false; return; }
    let sh = this.shadow;
    if ( !sh || sh.destroyed ) {
      const st = shadowTextures();
      sh = this.shadow = new PIXI.Container(); sh.eventMode = "none";
      const pen = sh.addChild(new PIXI.Sprite(st.pen)); pen.anchor.set(0.5); pen.blendMode = PIXI.BLEND_MODES.MULTIPLY;
      pen.width = W * 0.8; pen.height = W * 0.24;
      sortNextTo(sh, this.token, -1);
    }
    sh.visible = this.token.visible; sh.position.set(gx, gy - W * 0.06); sh.alpha = 0.35 + 0.35 * k; sh.scale.set(0.9 + 0.12 * (1 - k));
  }

  /** Nameplate, bars, effects fade with an entering token (Drop does the same). */
  #kidsAlpha(a, restore = false) {
    if ( !this.kids ) return;
    for ( const [c, a0] of this.kids ) if ( !c.destroyed ) c.alpha = a0 * (restore ? 1 : a);
    if ( restore ) this.kids = null;
  }

  /** The corpse badge (skull) and petrified cracks: children of the token, re-made after a redraw. */
  #overlay() {
    const t = this.token, want = this.corpse && !this.fx ? `${this.corpse.skull ? "s" : ""}${this.corpse.cracks ? "c" : ""}` : "";
    const ok = this.overlay && !this.overlay.destroyed && this.overlay.parent === t;
    if ( want === this.overlayKey && (ok || !want) ) return;
    if ( this.overlay && !this.overlay.destroyed ) this.overlay.destroy({ children: true });
    this.overlay = null; this.overlayKey = want;
    if ( !want ) return;
    const box = this.overlay = new PIXI.Container(); box.eventMode = "none"; box._mmReticle = true;
    const { width: W, height: H } = t.document.getSize(), ap = artPx();
    if ( this.corpse.cracks ) drawCracks(box, W, H, this.seed, ap);
    if ( this.corpse.skull ) drawSkull(box, Math.round((W - 9 * ap) / ap) * ap, ap * 2, ap);
    box.zIndex = 4000;
    t.addChild(box);
  }

  /** Particles of this token's running effect: a container next to it in the primary group. */
  emitter() {
    if ( !this.root || this.root.destroyed ) { this.root = new PIXI.Container(); this.root.eventMode = "none"; sortNextTo(this.root, this.token, 2); this.em = new Emitter(this.root); this.em.seed = this.seed; }
    return this.em;
  }
  #dropRoot() { this.em?.clear(); if ( this.root && !this.root.destroyed ) this.root.destroy({ children: true }); this.root = null; this.em = null; }

  /** Run an effect on the mesh (enter / death / revive / hold). A running one ends first (its end state is kept where it matters). */
  run(fx) {
    if ( this.fx ) this.#endFx(true);
    this.fx = fx;
    if ( fx.kids ) this.kids = this.token.children.filter((c) => !c._mmReticle && !c.destroyed && c !== this.overlay).map((c) => [c, c.alpha]);
    if ( fx.delay > 0 || fx.hideFirst ) { fx.step(0, this.main, this); St.setPose(this.out, this.main); this.apply(true); }
    startTicker();
  }

  #endFx(cut = false) {
    const fx = this.fx; this.fx = null;
    if ( this.kids ) this.#kidsAlpha(1, true);
    fx?.onEnd?.(this, cut);
  }

  dispose(restore) {
    if ( this.disposed ) return;
    this.disposed = true;
    if ( this.fx ) { const fx = this.fx; this.fx = null; fx.onEnd?.(this, true); }
    if ( restore ) this.release(); else if ( this.kids ) this.#kidsAlpha(1, true);
    if ( this.filter ) { const m = this.token.mesh; if ( m && !m.destroyed ) { m.filters = (m.filters ?? []).filter((f) => f !== this.filter); if ( !m.filters.length ) m.filters = null; } this.filter = null; }
    for ( const o of [this.glowSpr, this.shadow, this.overlay] ) if ( o && !o.destroyed ) o.destroy({ children: true });
    this.#dropRoot();
    if ( RIGS.get(this.token) === this ) RIGS.delete(this.token);
  }
}

const rigOf = (token) => { const r = RIGS.get(token); return r && !r.disposed ? r : new Rig(token); };

/* ================================================================== effects that run on a Rig */

/** One effect on the mesh: `poseAt(u, out, rig)` for 0 <= u <= 1, `emit(rig, u, prevU)` for its particles. */
class MeshFx {
  constructor({ kind, style, dur, delay = 0, poseAt, emit = null, onEnd = null, kids = false, hold = 0 }) {
    Object.assign(this, { kind, style, dur: Math.max(0.05, dur), delay, poseAt, emit, onEnd, kids, hold });
    this.t = 0; this.u = 0; this.hideFirst = kind === "enter";
  }
  step(dt, out, rig) {
    if ( this.delay > 0 ) { this.delay -= dt; this.poseAt(0, out, rig); return false; }
    const prev = this.u;
    this.t += dt; this.u = Math.min(1, this.t / this.dur);
    this.poseAt(this.u, out, rig);
    if ( this.emit ) { try { this.emit(rig, this.u, prev, dt); } catch ( err ) { dbg("token fx emit", err); } }
    return this.t >= this.dur + this.hold;
  }
}

/** Geometry of a token for its particles: ground point, size, centre (canvas px). */
function geom(token) {
  const { width: W, height: H } = token.document.getSize(), m = token.mesh;
  const cx = m?.position.x ?? token.center.x, cy = m?.position.y ?? token.center.y;
  return { W, H, cx, cy, gx: cx, gy: cy + H / 2 };
}
function meshGeo(m) {
  return { tex: m.texture, ax: m.anchor.x, ay: m.anchor.y, px: m.position.x, py: m.position.y, sx: m.scale.x, sy: m.scale.y, rot: m.rotation };
}
const crossed = (u, prev, at) => prev < at && u >= at;

/* ---- enter ---- */

function enterFx(token, style, delay, c) {
  const rig = rigOf(token), k = c.intensity ?? 1, sp = c.speed ?? 1;
  if ( lowMode() && style !== "fade" ) style = "fade";
  const dur = lowMode() ? 0.25 : St.durationOf(St.ENTER_STYLES, style, sp);
  const ctx = { k, tilt: rig.tilt, dir: style === "slide" ? edgeDir(token) : null };
  const show = token.visible;
  const emit = !show || lowMode() ? null : (r, u, prev) => {
    const g = geom(token), em = r.emitter(), seed = r.seed;
    if ( style === "fade" && crossed(u, prev, 0.01) ) dust(em, g.gx, g.gy, g.W, 14, seed, { up: 1.4 });
    else if ( style === "pop" && crossed(u, prev, 0.12) ) sparkles(em, g.cx, g.cy, 10, g.W * 0.3, seed);
    else if ( style === "materialise" && crossed(u, prev, 0.001) ) { cellParticles(em, meshGeo(token.mesh), "gather", seed, { dur: dur * 0.85 }); }
    else if ( style === "warp" ) { if ( u < 0.4 ) beam(em, g.cx, g.gy, g.W, g.H, seed); if ( crossed(u, prev, 0.35) ) { sparkles(em, g.cx, g.cy, 16, g.W * 0.2, seed, BEAM, 0.45); dust(em, g.gx, g.gy, g.W, 10, seed, { colors: BEAM }); } }
    else if ( style === "slide" && u < 0.85 && Math.floor(u * 14) !== Math.floor(prev * 14) ) { const p = r.out; dust(em, g.gx + p.x * g.W, g.gy + p.y * g.H, g.W * 0.5, 3, seed + Math.floor(u * 14), { spread: 0.5 }); }
    else if ( style === "rise" && crossed(u, prev, 0.02) ) { clods(em, g.gx, g.gy, g.W, 14, seed); dust(em, g.gx, g.gy, g.W, 10, seed); }
    else if ( style === "portal" && crossed(u, prev, 0.001) ) {
      for ( let i = 0; i < 36; i++ ) em.add(0, 0, 0, 0, { mode: 2, cx: g.cx, cy: g.gy - g.H * 0.15, r: g.W * (0.15 + 0.5 * St.rand01(seed, i)), dr: g.W * 0.25, ang: (i / 36) * St.TAU, av: 7 * rig.tilt, flat: 0.45, life: dur * (0.75 + 0.25 * St.rand01(seed, i + 5)), color: PORTAL[i % 4], add: true });
    }
  };
  rig.run(new MeshFx({ kind: "enter", style, dur, delay, kids: true,
    poseAt: (u, out) => St.enterPose(lowMode() ? "fade" : style, u, ctx, out), emit }));
}

/** The direction from a token to its nearest scene edge (slide in from / off to it). */
function edgeDir(token) {
  const d = canvas.dimensions, r = d.sceneRect ?? { x: d.sceneX, y: d.sceneY, width: d.sceneWidth, height: d.sceneHeight };
  const c = token.center;
  return St.nearestEdge(c.x, c.y, r);
}

/* ---- death and revive ---- */

function deathFx(token, style, delay, c, look) {
  const rig = rigOf(token), sp = c.speed ?? 1, k = c.intensity ?? 1;
  const low = lowMode();
  const dur = low ? 0.35 : St.durationOf(St.DEATH_STYLES, style, sp);
  const ctx = { k, tilt: rig.tilt };
  const show = token.visible;
  let geo0 = null;
  const emit = !show || low ? null : (r, u, prev) => {
    const g = geom(token), em = r.emitter(), seed = r.seed;
    geo0 ??= meshGeo(token.mesh);
    switch ( style ) {
      case "fall": if ( crossed(u, prev, 0.63) ) { const side = g.gx + rig.tilt * g.H * 0.45; dust(em, side, g.gy, g.W * 0.9, 16, seed, { spread: 1.3 }); } break;
      case "collapse": if ( crossed(u, prev, 0.15) ) dust(em, g.gx, g.gy, g.W, 16, seed, { spread: 1.2 }); break;
      case "grey": if ( crossed(u, prev, 0.35) && show ) EXTRAS.add(new SkullRise(token, dur * 0.9)); break;
      case "disintegrate": if ( crossed(u, prev, 0.05) ) cellParticles(em, geo0, "ash", seed, { dur }); break;
      case "explode": if ( crossed(u, prev, 0.3) ) { cellParticles(em, geo0, "confetti", seed, { gy: g.gy, k: 1.2 * k }); sparkles(em, g.cx, g.cy, 18, g.W * 0.15, seed, [BONE, 0xffffff, 0xffe08a], 0.5); smoke(em, g.cx, g.cy, g.W * 0.7, 12, seed); } break;
      case "soul": if ( crossed(u, prev, 0.2) ) EXTRAS.add(new Wisp(token, dur * 0.85)); break;
      case "petrify": if ( Math.floor(u * 6) !== Math.floor(prev * 6) && u < 0.7 ) dust(em, g.gx, g.gy - g.H * 0.4 * St.rand01(seed, Math.floor(u * 6)), g.W * 0.6, 4, seed + Math.floor(u * 6), { colors: [0x9c968c, 0x77736c, 0xbab4aa], up: -0.5 }); break;
      case "ragdoll": if ( crossed(u, prev, 0.4) ) dust(em, g.gx + rig.tilt * g.W * 0.2, g.gy, g.W * 0.7, 10, seed); break;
      case "melt": if ( crossed(u, prev, 0.02) ) cellParticles(em, geo0, "drip", seed, { dur, gy: g.gy + 2 }); break;
      default: break;
    }
  };
  // petrify cracks spread over the body during the animation
  rig.run(new MeshFx({ kind: "death", style, dur, delay, hold: 0,
    poseAt: (u, out) => { if ( low ) { St.setPose(out, St.POSE0); out.grey = look ? u : 0; out.alpha = 1 - (1 - (look?.pose.alpha ?? 1)) * u; return out; } return St.deathPose(style, u, ctx, out); },
    emit,
    onEnd: (r, cut) => { r.corpse = look; dbg(`death of "${token.document.name}" ${cut ? "cut short" : "played"} (${style})`); } }));
}

function reviveFx(token, c) {
  const rig = rigOf(token), from = St.setPose(St.pose(), rig.fx ? rig.out : (rig.corpse?.pose ?? St.POSE0));
  if ( rig.fx?.kind === "death" ) rig.fx.onEnd = null;   // cut short: it must not leave its corpse behind
  rig.corpse = null;
  const dur = lowMode() ? 0.25 : 0.55 / (c.speed ?? 1);
  rig.run(new MeshFx({ kind: "revive", style: "stand", dur,
    poseAt: (u, out) => St.revivePose(from, u, out),
    emit: lowMode() || !token.visible ? null : (r, u, prev) => { if ( crossed(u, prev, 0.6) ) { const g = geom(token); sparkles(r.emitter(), g.cx, g.cy, 10, g.W * 0.35, r.seed, [0xffffff, 0xd8ffe0, 0xfff3c0]); } } }));
}

/* ================================================================== Leave: the ghost of a token that is gone */

class Leave {
  constructor(token, style, c, delay, cause) {
    const m = token.mesh, doc = token.document, { width: W, height: H } = doc.getSize();
    this.style = lowMode() ? "fade" : style; this.cause = cause; this.delay = delay; this.t = 0;
    this.dur = lowMode() ? 0.25 : St.durationOf(St.LEAVE_STYLES, this.style, c.speed ?? 1);
    this.W = W; this.H = H; this.seed = St.seedOf(doc.id); this.k = c.intensity ?? 1;
    this.b = { px: m.position.x, py: m.position.y, sx: m.scale.x, sy: m.scale.y, rot: m.rotation };
    this.gx = this.b.px; this.gy = this.b.py + H / 2;
    this.ctx = { k: this.k, tilt: St.tiltOf(doc.id), dir: this.style === "slide" ? edgeDir(token) : null };
    const root = this.root = new PIXI.Container(); root.eventMode = "none";
    const spr = this.spr = root.addChild(new PIXI.Sprite(m.texture));
    spr.anchor.set(m.anchor.x, m.anchor.y); spr.tint = m.tint; this.alpha0 = clamp(m.alpha || 1, 0.05, 1);
    this.geo = meshGeo(m);
    this.glow = null;
    this.em = new Emitter(root); this.em.seed = this.seed;
    this.pose = St.pose(); this.u = 0;
    sortNextTo(root, token, 1);
    this.update(0);
  }

  update(dt) {
    if ( this.root.destroyed ) return false;
    if ( this.delay > 0 ) { this.delay -= dt; St.setPose(this.pose, St.POSE0); this.#draw(); return true; }
    const prev = this.u;
    this.t += dt; const u = this.u = Math.min(1, this.t / this.dur);
    St.leavePose(this.style, u, this.ctx, this.pose);
    if ( !lowMode() ) this.#emit(u, prev);
    this.#draw();
    const alive = this.em.update(dt);
    return u < 1 || alive > 0;
  }

  #draw() {
    const p = this.pose;
    place(this.spr, this.b, p, this.gx, this.gy, this.W, this.H);
    this.spr.alpha = this.alpha0 * clamp(p.alpha, 0, 1);
    this.spr.visible = p.alpha > 0.001;
    if ( p.glow > 0.01 ) {
      const g = this.glow ??= (() => { const s = this.root.addChildAt(new PIXI.Sprite(this.spr.texture), 1); s.blendMode = PIXI.BLEND_MODES.ADD; s.anchor.copyFrom(this.spr.anchor); return s; })();
      g.position.copyFrom(this.spr.position); g.scale.copyFrom(this.spr.scale); g.rotation = this.spr.rotation; g.alpha = clamp(p.glow, 0, 1) * 0.8; g.visible = this.spr.visible;
    } else if ( this.glow ) this.glow.visible = false;
  }

  #emit(u, prev) {
    const em = this.em, s = this.seed, W = this.W, H = this.H, cx = this.b.px, cy = this.b.py, gx = this.gx, gy = this.gy;
    switch ( this.style ) {
      case "dissolve": if ( crossed(u, prev, 0.001) ) cellParticles(em, this.geo, "dissolve", s, { dur: this.dur }); break;
      case "fade": if ( crossed(u, prev, 0.001) ) dust(em, gx, gy, W, 14, s); break;
      case "shrink": if ( crossed(u, prev, 0.88) ) sparkles(em, cx, gy - H * 0.1, 12, 2, s); break;
      case "warp": if ( u < 0.6 ) { const k = em.ap; for ( let i = 0; i < 6; i++ ) em.add(cx + (Math.random() - 0.5) * W * 0.4, gy - H * Math.random(), 0, -k * 160, { life: 0.35, color: BEAM[i % 4], add: true }); } if ( crossed(u, prev, 0.58) ) sparkles(em, cx, gy - H * 0.6, 12, W * 0.1, s, BEAM); break;
      case "sink": if ( crossed(u, prev, 0.001) || crossed(u, prev, 0.5) ) { clods(em, gx, gy, W, 8, s + (u > 0.4 ? 9 : 0)); dust(em, gx, gy, W, 8, s); } break;
      case "burst": if ( crossed(u, prev, 0.17) ) { const cells = cellParticles(em, this.geo, "confetti", s, { gy: gy + H * 0.05, k: this.k }); sparkles(em, cx, cy, 10, W * 0.2, s, [...paletteOf(cells, 3), 0xffd04a, 0xff8a24], 0.5); } break;
      case "smoke": if ( crossed(u, prev, 0.001) ) smoke(em, cx, cy + H * 0.1, W, 26, s); break;
      case "slide": if ( u > 0.1 && Math.floor(u * 12) !== Math.floor(prev * 12) ) { const p = this.pose; dust(em, gx + p.x * W, gy + p.y * H, W * 0.5, 3, s + Math.floor(u * 12), { spread: 0.5 }); } break;
      default: break;
    }
  }

  end() { this.em.clear(); if ( !this.root.destroyed ) this.root.destroy({ children: true }); }
}

/** The soul of a dying token: a pale copy that rises and fades. */
class Wisp {
  constructor(token, dur) {
    const m = token.mesh, { height: H } = token.document.getSize();
    this.dur = dur; this.t = 0; this.H = H;
    this.root = new PIXI.Container(); this.root.eventMode = "none";
    const s = this.s = this.root.addChild(new PIXI.Sprite(m.texture));
    s.anchor.copyFrom(m.anchor); s.position.copyFrom(m.position); s.scale.copyFrom(m.scale); s.rotation = m.rotation;
    s.tint = SOUL; s.blendMode = PIXI.BLEND_MODES.ADD; s.alpha = 0;
    this.x0 = m.position.x; this.y0 = m.position.y; this.sx = m.scale.x; this.sy = m.scale.y;
    this.em = new Emitter(this.root); this.em.seed = St.seedOf(token.document.id) + 3;
    sortNextTo(this.root, token, 3);
  }
  update(dt) {
    if ( this.root.destroyed ) return false;
    const u = Math.min(1, (this.t += dt) / this.dur), e = 1 - (1 - u) ** 2;
    this.s.alpha = 0.55 * Math.sin(Math.PI * Math.min(1, u * 1.15));
    this.s.position.set(this.x0 + Math.sin(u * 7) * this.H * 0.05, this.y0 - e * this.H * 0.9);
    this.s.scale.set(this.sx * (1 - 0.35 * u), this.sy * (1 + 0.15 * u));
    if ( Math.floor(u * 10) !== Math.floor((u - dt / this.dur) * 10) ) this.em.add(this.s.position.x + (Math.random() - 0.5) * this.H * 0.4, this.s.position.y + this.H * 0.2, 0, -this.em.ap * 12, { life: 0.5, color: SOUL, add: true });
    const alive = this.em.update(dt);
    return u < 1 || alive > 0;
  }
  end() { this.em.clear(); if ( !this.root.destroyed ) this.root.destroy({ children: true }); }
}

/** A pixel skull that rises from a dying token and fades (the "grey" death). */
class SkullRise {
  constructor(token, dur) {
    const { width: W, height: H } = token.document.getSize(), ap = Math.max(artPx(), Math.round(W / 24));
    this.dur = dur; this.t = 0; this.H = H;
    const box = this.root = new PIXI.Container(); box.eventMode = "none";
    drawSkull(box, -3.5 * ap, -3.5 * ap, ap);
    const m = token.mesh; this.x = m.position.x; this.y = m.position.y - H * 0.1;
    box.position.set(this.x, this.y); box.alpha = 0;
    sortNextTo(box, token, 3);
  }
  update(dt) {
    if ( this.root.destroyed ) return false;
    const u = Math.min(1, (this.t += dt) / this.dur), e = 1 - (1 - u) ** 3;
    this.root.position.set(this.x, Math.round(this.y - e * this.H * 0.7));
    this.root.alpha = u < 0.2 ? u / 0.2 : u > 0.7 ? Math.max(0, 1 - (u - 0.7) / 0.3) : 1;
    return u < 1;
  }
  end() { if ( !this.root.destroyed ) this.root.destroy({ children: true }); }
}

/* ================================================================== the hand-over from token-drop.mjs */

/** A new style of enter (token-drop.mjs handles drop and classic). `ready`: Foundry has refreshed the token already. */
runtime.enter = (token, style, delay = 0, ready = false) => {
  if ( !token?.mesh || token.destroyed ) return false;
  const c = fxFor(token.document);
  const rig = rigOf(token);
  if ( ready ) rig.refreshed();
  enterFx(token, style, delay, c);
  return true;
};

/** A new style of leave on a token that is being deleted or hidden (token-drop.mjs handles the puff). */
runtime.leave = (token, style, delay = 0, cause = "delete") => {
  const m = token?.mesh;
  if ( !m || m.destroyed || !token.visible || !m.visible || !m.renderable ) return false;
  EXTRAS.add(new Leave(token, style, fxFor(token.document), delay, cause));
  startTicker();
  return true;
};

/** Is one of our effects running on this token (enter / death / revive)? token-drop.mjs then leaves it alone. */
runtime.busy = (token) => !!RIGS.get(token)?.fx;

/** token-drop.mjs starts an older effect on a token: give it the mesh as Foundry draws it. */
Hooks.on("moinenMapsTokenFxBusy", (token) => { const r = RIGS.get(token); if ( r?.applied ) r.release(); });

/* ================================================================== death: detection and state */

const DEFEATED = () => CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
/** A combat counts for the viewed scene when linked to it or to no scene (see token-drop.mjs combatApplies). */
const combatApplies = (combat) => !!combat && (!combat.scene || combat.scene.id === canvas.scene?.id);
function combatHere() { return game.combats?.some?.((c) => c.started && combatApplies(c)) ?? false; }
function isTurn(token) {
  const c = game.combat; if ( !c?.started || !combatApplies(c) ) return false;
  return c.combatant?.tokenId === token.document.id;
}

/** The facts about one token that the death rule looks at. */
export function deathFacts(doc, c = fxFor(doc)) {
  let defeated = false;
  for ( const combat of game.combats ?? [] ) {
    if ( !combatApplies(combat) && combat.scene?.id !== doc.parent?.id ) continue;
    for ( const cb of combat.combatants ) if ( cb.tokenId === doc.id && (cb.sceneId ?? combat.scene?.id ?? doc.parent?.id) === doc.parent?.id && cb.defeated ) defeated = true;
  }
  const actor = doc.actor, id = DEFEATED();
  const status = !!(actor?.statuses?.has?.(id) || doc.hasStatusEffect?.(id));
  const hpPath = St.hpPathFor(game.system?.id, c.hpPath);
  const hp = c.deathHp && hpPath && actor ? foundry.utils.getProperty(actor, hpPath) : undefined;
  return { defeated, status, hp, hpPath };
}
export const isDeadDoc = (doc, c = fxFor(doc)) => !!c.death && St.deadFrom(deathFacts(doc, c), c);

/** Bring a token's death look in line with its state. `animate` false: the settled look only (first sight, reload, scene switch). */
function syncDeath(token, animate, delay = 0) {
  const doc = token.document, c = fxFor(doc), dead = isDeadDoc(doc, c);
  const prev = KNOWN.get(doc.id);
  KNOWN.set(doc.id, dead);
  token._mmDead = dead;
  const change = St.deathTransition(prev, dead);
  const rig = RIGS.get(token);
  if ( dead ) {
    const style = c.deathStyle, look = St.corpseLook(style, c.corpse, St.tiltOf(doc.id), game.user.isGM);
    const nothing = c.corpse === "none" || (St.isIdentity(look.pose) && !look.skull && !look.cracks);
    if ( change === "die" && animate && style !== "none" && token.visible && mayAnimate(token, c) ) {
      const i = burstIndex("death"), d = St.burstDelay(i);
      if ( d !== null ) { deathFx(token, style, delay + d, c, nothing ? null : look); return; }
    }
    // static: the settled look straight away (or nothing)
    if ( nothing ) { if ( rig && !rig.fx ) rig.corpse = null; return; }
    const r = rigOf(token); if ( r.fx?.kind === "death" ) return;
    r.corpse = look; startTicker();
    return;
  }
  // alive
  if ( !rig ) return;
  if ( change === "revive" && animate && c.revive === "stand" && (rig.corpse || rig.fx?.kind === "death") && mayAnimate(token, c) ) return reviveFx(token, c);
  if ( rig.fx?.kind === "death" ) rig.fx = null;
  rig.corpse = null;
}

let pending = null;
/** Re-check the death of some tokens on the next frame (several hooks of one change come together). */
function schedule(tokens) {
  if ( !canvas?.ready ) return;
  pending ??= new Set();
  for ( const t of tokens ) if ( t && !t.destroyed ) pending.add(t);
  if ( pending.size && !pending.frame ) {
    pending.frame = requestAnimationFrame(() => {
      const list = [...(pending ?? [])].filter((t) => !t.destroyed && t.document?.parent?.id === canvas.scene?.id);
      pending = null;
      for ( const t of list ) { try { syncDeath(t, true); } catch ( err ) { console.error(`${MODULE_ID} | token death`, err); } }
    });
  }
}
const tokensOfActor = (actor) => actor ? (actor.isToken ? [actor.token?.object] : actor.getActiveTokens?.(false, false) ?? []).filter(Boolean) : [];
const tokenOfCombatant = (cb) => cb?.token?.object ?? (cb?.tokenId ? canvas.tokens?.get(cb.tokenId) : null);

/* ================================================================== idle bookkeeping */

/** Give every token of the scene the idle its settings ask for (a Rig is made only where something moves). */
function syncIdle() {
  if ( !canvas?.ready ) return;
  for ( const t of canvas.tokens?.placeables ?? [] ) {
    const c = fxFor(t.document), r = RIGS.get(t);
    if ( r ) r.cfg = c;
    const style = c.idleStyle;
    if ( style === "none" ) { if ( r ) r.idleStyle = "none"; continue; }
    const rig = r ?? rigOf(t); rig.idleStyle = style; rig.cfg = c;
  }
  startTicker();
}
let idleQueued = false;
function queueIdle() { if ( idleQueued ) return; idleQueued = true; requestAnimationFrame(() => { idleQueued = false; syncIdle(); }); }

/* ================================================================== hooks */

function onDrawToken(token) {
  const r = RIGS.get(token);
  if ( r ) { r.base = null; r.ready = false; }
  // first sight (scene load, a token drawn again): the settled look, never an animation
  if ( !KNOWN.has(token.document.id) ) syncDeath(token, false);
  else if ( KNOWN.get(token.document.id) ) syncDeath(token, false);
  queueIdle();
}
function onRefreshToken(token, flags) {
  const r = RIGS.get(token);
  if ( r && !r.disposed && !tokenBusy(token) && flags && (flags.refreshMesh || flags.refreshPosition || flags.refreshSize || flags.refreshRotation || flags.refreshState || flags.refreshTransform || flags.refresh || flags.redraw) ) r.refreshed(flags);
}
function onDeleteToken(doc) {
  KNOWN.delete(doc.id);
  for ( const [t, r] of [...RIGS] ) if ( t.document === doc ) r.dispose(false);
}
function teardown() {
  for ( const r of [...RIGS.values()] ) r.dispose(false);
  for ( const x of [...EXTRAS] ) x.end();
  EXTRAS.clear(); RIGS.clear(); KNOWN.clear(); stopTicker();
  for ( const k of Object.keys(bursts) ) delete bursts[k];
  if ( pending?.frame ) cancelAnimationFrame(pending.frame);
  pending = null;
  drainPools();
}

export function registerTokenFx() {
  Hooks.on("drawToken", onDrawToken);
  Hooks.on("refreshToken", onRefreshToken);
  Hooks.on("deleteToken", onDeleteToken);
  Hooks.on("canvasTearDown", teardown);
  Hooks.on("canvasReady", () => { for ( const t of canvas.tokens?.placeables ?? [] ) if ( !KNOWN.has(t.document.id) ) syncDeath(t, false); queueIdle(); });
  // what can make a token dead or alive again (all clients get these)
  Hooks.on("updateCombatant", (cb) => schedule([tokenOfCombatant(cb)]));
  Hooks.on("createCombatant", (cb) => schedule([tokenOfCombatant(cb)]));
  Hooks.on("deleteCombatant", (cb) => schedule([tokenOfCombatant(cb)]));
  Hooks.on("deleteCombat", (combat) => schedule([...(combat.combatants ?? [])].map(tokenOfCombatant)));
  Hooks.on("updateActor", (actor) => schedule(tokensOfActor(actor)));
  for ( const h of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"] ) Hooks.on(h, (eff) => { const a = eff.parent instanceof Actor ? eff.parent : eff.parent?.parent; schedule(tokensOfActor(a)); });
  Hooks.on("updateToken", (doc, changes) => {
    const t = doc.object; if ( !t ) return;
    if ( foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) || "delta" in changes || "actorData" in changes || "actorId" in changes ) { schedule([t]); queueIdle(); }
  });
  Hooks.on("createToken", () => queueIdle());
  Hooks.on("updateScene", (scene, changes) => { if ( scene.id === canvas.scene?.id && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) ) { schedule(canvas.tokens.placeables); queueIdle(); } });
  for ( const h of ["moinenMapsSceneDraft", "moinenMapsPerfMode", "moinenMapsTokenFxSettings"] ) Hooks.on(h, () => queueIdle());
  Hooks.on("updateCombat", () => { for ( const r of RIGS.values() ) r.cfg = null; });
}

/* ================================================================== previews and API (the workspace's Play buttons, macros) */

/**
 * Play an effect on a token on THIS client only, for testing: nothing is stored, the token ends as it was.
 * kind: enter | leave | death | idle; style: a style of that set (default: the token's own setting).
 */
export function preview(token, kind, style = null, delay = 0) {
  if ( !token?.mesh || token.destroyed ) return false;
  const c = fxFor(token.document);
  const rig = rigOf(token);
  if ( !rig.base ) rig.refreshed();
  if ( kind === "enter" ) {
    style ??= c.enterStyle;
    if ( St.ENTER_STYLES[style]?.legacy || style === "none" ) style = "pop";
    enterFx(token, style, delay, c);
  } else if ( kind === "leave" ) {
    style ??= c.leaveStyle;
    if ( St.LEAVE_STYLES[style]?.legacy || style === "none" ) style = "smoke";
    runtime.leave(token, style, delay, "preview");
    // the real token is hidden while its ghost leaves, then fades back
    const dur = St.durationOf(St.LEAVE_STYLES, style, c.speed) + 0.4;
    rig.run(new MeshFx({ kind: "hold", style: "hold", dur: dur + 0.3, delay, poseAt: (u, out) => { St.setPose(out, St.POSE0); const back = (u * (dur + 0.3) - dur) / 0.3; out.alpha = back > 0 ? clamp(back, 0, 1) : 0; return out; } }));
  } else if ( kind === "death" ) {
    style ??= c.deathStyle;
    if ( style === "none" ) style = "fall";
    if ( token._mmDead ) return false;
    const look = St.corpseLook(style, c.corpse === "none" ? "body" : c.corpse, rig.tilt, game.user.isGM);
    deathFx(token, style, delay, c, look);
    // ...and stands up again after a moment (only a preview)
    const fx = rig.fx, end = fx.onEnd;
    fx.onEnd = (r, cut) => { end(r, cut); if ( !cut ) setTimeout(() => { if ( !token.destroyed && !token._mmDead && RIGS.get(token) === r ) reviveFx(token, c); }, 900); };
  } else if ( kind === "idle" ) {
    style ??= c.idleStyle === "none" ? "breathe" : c.idleStyle;
    rig.idleForce = { style, until: 4 };
  } else return false;
  startTicker();
  return true;
}

/** Re-read the settings of every token (after the workspace wrote some). */
export function refreshTokenFx() { for ( const r of RIGS.values() ) r.cfg = null; queueIdle(); if ( canvas?.ready ) for ( const t of canvas.tokens.placeables ) syncDeath(t, false); }

export const _tokenFx = () => ({ rigs: RIGS.size, extras: EXTRAS.size, ticking, known: Object.fromEntries(KNOWN), applied: [...RIGS.values()].filter((r) => r.applied).length });
/** Test helper: step the effects by `n` ticks of `frames` frames (a hidden tab pauses the ticker). */
export const _stepTokenFx = (n = 1, frames = 3) => { for ( let i = 0; i < n; i++ ) tick(frames); };
export const _rigOf = (token) => RIGS.get(token) ?? null;
