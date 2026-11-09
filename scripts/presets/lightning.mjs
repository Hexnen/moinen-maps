import { sharedNow } from "../shared-clock.mjs";
import { reducedMotion } from "../config.mjs";
import { view } from "../view-angle.mjs";
import { guardQ, guardOff } from "../frame-guard.mjs";
import { clientOpts } from "../director/stage.mjs";
import { geo as fireGeo } from "../fire/fire.mjs";
import * as L from "./lightning-core.mjs";

/**
 * DESTRUCTION PRESETS, the LIGHTNING STRIKE on every client (dev/presets-design.md section 18; the pure rules in lightning-core.mjs).
 * Loaded by lightning-wire.mjs on the first firing record with a "strike" accent; draws while a strike is in flight, then removes its
 * ticker - a scene without strikes runs nothing of this.
 *  - THE BOLT: the strike's data texture (lightning-core strikeData: built once per firing on this client, with this scene's view)
 *    drawn by one shader over its occupied blocks only; per frame only uniforms change (lightning-core frameAt). Crisp art pixels
 *    of the destruction art grid; premultiplied output: the core and its first blue ring opaque (it reads on a pale map), the glow
 *    bands additive. In a container of the primary group above the tokens (sortLayer 821).
 *  - NIGHT: the same shader as emission in Foundry's illumination (MAX_COLOR, as the fire's and the gun accents' glow): the bolt
 *    lights itself; a big ground light round the strike and, for an instant, the whole view (the flash lighting the land).
 *  - SPRAY / CRACKLE: a few CPU art pixels (molten droplets, the charge's sparks), with their emission.
 *  - FLASH: a cold overlay over the board (screen blend), by the strike's flash and the distance from the view; never for a client
 *    that opted out of flashes (or wants reduced motion). The SHAKE is the firing's screen cue (accents.mjs).
 *  - Reduced motion: nothing is drawn (the scar, the dust, the steam and the fires are the result). The frame guard thins the spray.
 */
const SORT_LAYER = 821;
const live = new Map();             // fid -> Strike
let root = null, glowBox = null, sprayG = null, sprayE = null, viewG = null, groundS = null, flashEl = null, ticking = false, hookL = 0, groundTex = null;

/* ---------------------------------------------------------------- the shader */

const VERT = `#version 300 es
precision highp float;
in vec2 aVertexPosition;
in vec2 aCell;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
out vec2 vCell;
void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vCell = aCell;
}`;
const rgb = (c) => `vec3(${(((c >> 16) & 255) / 255).toFixed(4)}, ${(((c >> 8) & 255) / 255).toFixed(4)}, ${((c & 255) / 255).toFixed(4)})`;
const C = L.COL;
const FRAG = `#version 300 es
precision highp float;
in vec2 vCell;
uniform sampler2D uData;
uniform float uLead, uStream, uStreamB, uMain, uBranch, uWipe, uCut, uArc, uArcB, uArcCut, uPlasma, uHeat, uEmit, uFlk;
out vec4 fragColor;
const float GR[8] = float[8](0.0, ${L.GLOW_R.map((v) => v.toFixed(1)).slice(1).join(", ")});
float bright(int c, float arr, float h) {
  if ( c >= 1 && c <= 4 ) {
    if ( uLead >= 0.0 ) {
      if ( arr > uLead || c == 2 ) return 0.0;
      float tip = uLead - arr < 0.035 ? 0.5 : 0.0;
      return (c == 4 ? 0.22 : c == 3 ? 0.28 : 0.38) + tip;
    }
    if ( 1.0 - arr > uWipe ) return 0.0;
    if ( arr + h * 0.12 < uCut ) return 0.0;
    if ( c <= 2 ) return uMain;
    return c == 3 ? uBranch : uBranch * 0.6;
  }
  if ( c == 5 ) { if ( uStream < 0.0 || arr > uStream ) return 0.0; return uStreamB + (uStream - arr < 0.2 ? 0.25 : 0.0) * step(0.01, uStreamB); }
  if ( c == 6 ) { if ( uArc < 0.0 || arr > uArc || arr > uArcCut + h * 0.12 ) return 0.0; return uArcB * (fract(h * 7.31 + uFlk) < 0.22 ? 0.4 : 1.0); }
  if ( c == 7 ) return max(uPlasma, uHeat * 0.9);
  return 0.0;
}
vec3 coreCol(int c, float b) {
  if ( uLead >= 0.0 && c <= 4 ) return b > 0.6 ? ${rgb(C.lead[1])} : ${rgb(C.lead[0])};
  if ( c == 6 ) return b > 0.5 ? ${rgb(C.core[0])} : ${rgb(C.core[2])};
  if ( c == 7 && uPlasma < 0.5 ) return uHeat > 0.75 ? ${rgb(C.heat[1])} : uHeat > 0.5 ? ${rgb(C.heat[2])} : uHeat > 0.25 ? ${rgb(C.heat[3])} : ${rgb(C.heat[4])};
  return b > 0.62 ? ${rgb(C.core[0])} : b > 0.4 ? ${rgb(C.core[1])} : b > 0.22 ? ${rgb(C.core[2])} : ${rgb(C.core[3])};
}
void main() {
  vec4 d = texelFetch(uData, ivec2(floor(vCell)), 0);
  int g = int(d.g * 255.0 + 0.5);
  if ( g == 0 ) discard;
  float arr = d.r * 255.0 / 254.0, h = d.a;
  bool core = g < 16;
  int c = core ? g : g - 16;
  float b = bright(c, arr, h);
  if ( b <= 0.02 ) discard;
  if ( core ) {
    if ( c == 2 && (b < 0.5 || h > (b - 0.5) * 4.0) ) discard;
    if ( c == 7 && uPlasma < 0.5 && h > uHeat * 2.2 ) discard;
    if ( c != 7 && h > b * 2.4 ) discard;
    vec3 col = coreCol(c, b);
    if ( uEmit > 0.5 ) { fragColor = vec4(col * min(1.0, b * 1.3), 1.0); return; }
    float a = uLead >= 0.0 ? 0.88 : 1.0;
    fragColor = vec4(col * a, a);
    return;
  }
  // a glow pixel: stepped bands out to the reach of its core (the reach grows with the brightness), dithered at each step
  if ( uLead >= 0.0 && c <= 4 ) b *= 0.5;
  float R = GR[c] * 3.0 * (0.35 + 0.65 * min(1.0, b));
  float dist = d.b * 255.0;
  if ( dist > R ) discard;
  float u = dist / R + (h - 0.5) * 0.12, bb = min(1.0, b);
  if ( c == 7 && uPlasma < 0.5 ) bb *= 0.5;
  vec3 col; float k;
  if ( dist <= 4.0 && u < 0.3 ) {
    // the first ring: one pale blue pixel, nearly opaque (so the white core reads on a pale map)
    float a = min(0.75, 0.8 * bb);
    if ( uEmit > 0.5 ) { fragColor = vec4(${rgb(C.glow[0])} * a, 1.0); return; }
    fragColor = vec4(${rgb(C.glow[0])} * a, a);
    return;
  }
  if ( u < 0.3 ) { col = ${rgb(C.glow[1])}; k = 0.55; } else if ( u < 0.5 ) { col = ${rgb(C.glow[2])}; k = 0.32; } else if ( u < 0.75 ) { col = ${rgb(C.glow[3])}; k = 0.14; } else { col = ${rgb(C.glow[4])}; k = 0.07; }
  if ( uEmit > 0.5 ) { fragColor = vec4(col * k * bb * 1.8, 1.0); return; }
  fragColor = vec4(col * k * bb, 0.0);
}`;
let program = null;
const prog = () => (program ??= PIXI.Program.from(VERT, FRAG, "moinen-maps-presets-strike-v3"));

/* ---------------------------------------------------------------- one strike */

class Strike {
  constructor(rec, item) {
    const g = fireGeo(), v = view();
    this.rec = rec; this.t0 = rec.t0; this.seed = ((Number(rec.seed) | 0) ^ 0x51f15e) >>> 0; this.lv = item.lv ?? 2; this.size = Number(rec.size) || 1;
    this.at = rec.at; this.T = L.timing(this.seed, this.lv);
    this.span = L.spanOf(item, this.T);
    this.end = this.t0 + this.span[1];
    this.g = g; this.v = v;
    const S = g.grid / g.ap;
    const D = L.strikeData(this.seed, { lv: this.lv, size: this.size, dir: rec.dir ?? null, S, lift: v.lift, squash: v.squash });
    this.D = D;
    // the texture (one upload) and the occupied blocks as quads in scene px
    this.tex = PIXI.Texture.fromBuffer(D.data, D.W, D.H, { scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA });
    const cx = Math.floor((this.at[0] - g.ox) / g.ap), cy = Math.floor((this.at[1] - g.oy) / g.ap);
    const X0 = g.ox + (cx - D.cx) * g.ap, Y0 = g.oy + (cy - D.cy) * g.ap, B = L.BLOCK, pos = [], cell = [], ind = [];
    for ( const [bx, by] of D.blocks ) {
      const k = pos.length / 2, c0 = bx * B, r0 = by * B, c1 = Math.min(D.W, c0 + B), r1 = Math.min(D.H, r0 + B);
      for ( const [cc, rr] of [[c0, r0], [c1, r0], [c1, r1], [c0, r1]] ) { pos.push(X0 + cc * g.ap, Y0 + rr * g.ap); cell.push(cc, rr); }
      ind.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    const geom = new PIXI.Geometry().addAttribute("aVertexPosition", pos, 2).addAttribute("aCell", cell, 2).addIndex(new Uint32Array(ind));
    const U = (emit) => ({ uData: this.tex, uLead: -1, uStream: -1, uStreamB: 0, uMain: 0, uBranch: 0, uWipe: 0, uCut: 0, uArc: -1, uArcB: 0, uArcCut: 1, uPlasma: 0, uHeat: 0, uEmit: emit, uFlk: 0 });
    this.mesh = new PIXI.Mesh(geom, new PIXI.Shader(prog(), U(0)));
    this.emit = new PIXI.Mesh(geom, new PIXI.Shader(prog(), U(1)));
    this.emit.blendMode = PIXI.BLEND_MODES.MAX_COLOR;
    this.mesh.visible = this.emit.visible = false;
    root.addChild(this.mesh); glowBox.addChild(this.emit);
  }
  /** One frame at shared time `now`: the shader's uniforms; the CPU pixels pushed into `px` ([x, y, colour] scene px); returns the
   * frame state (flash / light). */
  frame(now, q, px) {
    const t = now - this.t0, F = L.frameAt(this.T, t), u1 = this.mesh.shader.uniforms, u2 = this.emit.shader.uniforms;
    const any = F.lead >= 0 || F.stream >= 0 || F.main > 0.02 || F.branch > 0.02 || F.arcB > 0.02 || F.plasma > 0.02 || F.heat > 0.02;
    this.mesh.visible = this.emit.visible = any;
    if ( any ) {
      const flk = Math.floor(t / 40) * 0.618;
      for ( const u of [u1, u2] ) Object.assign(u, { uLead: F.lead, uStream: F.stream, uStreamB: F.streamB, uMain: F.main, uBranch: F.branch, uWipe: F.wipe, uCut: F.cut,
        uArc: F.arc, uArcB: F.arcB, uArcCut: F.arcCut, uPlasma: F.plasma, uHeat: F.heat, uFlk: flk % 1 });
    }
    // the CPU pixels: the molten spray, the crackle before the strike
    const g = this.g, lift = this.v.lift, sq = this.v.squash, G = g.grid, [ax, ay] = this.at;
    for ( const [x, y, z, c] of L.spray(this.seed, this.T, t, { lv: this.lv, size: this.size, q }) ) px.push(ax + x * G, ay + y * G * sq - lift * z * G, c);
    for ( const [x, y, z, c, dx, dy] of L.crackle(this.seed, t, { size: this.size, q }) ) {
      const X = ax + x * G, Y = ay + y * G * sq - lift * z * G;
      px.push(X, Y, c);
      if ( dx || dy ) { px.push(X + Math.sign(dx) * g.ap, Y - g.ap, 6); if ( Math.abs(dx) > 1 ) px.push(X + dx * g.ap, Y + dy * g.ap, 6); }
    }
    return F;
  }
  destroy() {
    for ( const m of [this.mesh, this.emit] ) { m.parent?.removeChild(m); m.destroy(); }
    this.mesh.geometry?.destroy();
    this.tex.destroy(true);
  }
}

/* ---------------------------------------------------------------- the layer */

/** The record's strike item (or null). */
export const strikeOf = (rec) => (rec?.pending?.accent ?? []).find((a) => a?.kind === L.KIND) ?? null;

export function take(rec) {
  const item = strikeOf(rec);
  if ( !item || reducedMotion() || live.has(rec.id) || !Array.isArray(rec.at) ) return;
  if ( !(rec.t0 + L.spanOf(item, L.timing(1, item.lv ?? 2))[1] + 600 > sharedNow()) ) return;
  mount();
  let s;
  try { s = new Strike(rec, item); } catch ( err ) { console.warn("moinen-maps | presets: lightning strike", err); return; }
  if ( !(s.end > sharedNow()) ) { s.destroy(); return; }
  live.set(rec.id, s);
  arm();
}
export function drop(fid) { const s = live.get(fid); if ( s ) { s.destroy(); live.delete(fid); } if ( !live.size ) stop(); }

function mount() {
  if ( root && !root.destroyed && root.parent ) return;
  root = new PIXI.Container();
  root.eventMode = "none"; root.interactiveChildren = false;
  Object.assign(root, { elevation: 0, sortLayer: SORT_LAYER, sort: 0, _lastSortedIndex: 0 });
  sprayG = new PIXI.Graphics(); root.addChild(sprayG);
  canvas.primary.addChild(root);
  glowBox = new PIXI.Container(); glowBox.eventMode = "none";
  viewG = new PIXI.Graphics(); viewG.blendMode = PIXI.BLEND_MODES.MAX_COLOR;
  groundS = new PIXI.Sprite(groundTexture()); groundS.anchor.set(0.5); groundS.blendMode = PIXI.BLEND_MODES.MAX_COLOR; groundS.visible = false;
  sprayE = new PIXI.Graphics(); sprayE.blendMode = PIXI.BLEND_MODES.MAX_COLOR;
  glowBox.addChild(viewG, groundS, sprayE);
  attachGlow();
  hookL = Hooks.on("lightingRefresh", attachGlow);
}
/** The emission container into the illumination (each lighting refresh empties it: put it back, as the fire does). */
function attachGlow() { const box = canvas.effects?.illumination?.lights; if ( box && glowBox && !glowBox.destroyed && glowBox.parent !== box ) box.addChild(glowBox); }

function arm() {
  if ( ticking || !live.size ) return;
  ticking = true;
  canvas.app.ticker.add(tick, null, PIXI.UPDATE_PRIORITY.LOW);
}
function stop() {
  if ( ticking ) canvas.app?.ticker?.remove(tick);
  ticking = false;
  guardOff("presets-strike");
  if ( sprayG && !sprayG.destroyed ) sprayG.clear();
  if ( sprayE && !sprayE.destroyed ) sprayE.clear();
  if ( viewG && !viewG.destroyed ) viewG.clear();
  if ( groundS && !groundS.destroyed ) groundS.visible = false;
  if ( flashEl ) flashEl.style.opacity = "0";
}
/** The scene goes: everything of this layer goes with it. */
export function reset() {
  stop();
  for ( const s of live.values() ) { try { s.destroy(); } catch { /* the canvas is going */ } }
  live.clear();
  if ( hookL ) Hooks.off("lightingRefresh", hookL); hookL = 0;
  if ( root && !root.destroyed ) root.destroy({ children: true });
  if ( glowBox && !glowBox.destroyed ) { glowBox.parent?.removeChild(glowBox); glowBox.destroy({ children: true }); }
  flashEl?.remove();
  root = glowBox = sprayG = sprayE = viewG = groundS = flashEl = null;
}

/** The ground light: a round light in flat steps with dithered edges (pixel-art, 48 x 48), white; tinted and scaled per frame. */
function groundTexture() {
  if ( groundTex && !groundTex.baseTexture?.destroyed ) return groundTex;
  // a smooth, organic pool of light: soft falloff, a gently lobed rim (a few low angular waves), no steps or cells - a light has
  // no pixel grid (a stepped/hashed texture stretched over 14 squares read as big lit squares at night)
  const N = 128, a = new Uint8Array(N * N * 4), ph = [L.hash3(1, 2, 3), L.hash3(4, 5, 6), L.hash3(7, 8, 9)].map((h) => h * 6.283);
  for ( let y = 0; y < N; y++ ) for ( let x = 0; x < N; x++ ) {
    const dx = x + 0.5 - N / 2, dy = y + 0.5 - N / 2, an = Math.atan2(dy, dx);
    const rim = 1 + 0.07 * Math.sin(3 * an + ph[0]) + 0.05 * Math.sin(5 * an + ph[1]) + 0.03 * Math.sin(8 * an + ph[2]);
    const d = Math.min(1, Math.hypot(dx, dy) / (N / 2) / rim), f = 1 - d * d * (3 - 2 * d);
    const v = Math.pow(f, 1.6) * (0.55 + 0.45 * Math.exp(-d * d * 9));
    const o = (y * N + x) * 4; a[o] = a[o + 1] = a[o + 2] = Math.round(255 * v); a[o + 3] = 255;
  }
  groundTex = PIXI.Texture.fromBuffer(a, N, N);
  groundTex.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR; groundTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
  return groundTex;
}
const mul = (c, k) => ((Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k));
/** How much of a flash at (x, y) reaches this client's view: 1 on screen, falling off past it. */
function nearView(x, y) {
  const st = canvas.stage, sc = st.scale.x, vw = canvas.app.screen.width / sc, vh = canvas.app.screen.height / sc;
  const d = Math.hypot((x - st.pivot.x) / (vw / 2), (y - st.pivot.y) / (vh / 2));
  return d <= 1 ? 1 : Math.max(0, 1 - (d - 1) / 1.5);
}

const PX = [];
function tick() {
  if ( !canvas?.ready || !root || root.destroyed ) { stop(); return; }
  const now = sharedNow(), q = guardQ("presets-strike"), g = fireGeo(), ap = g.ap;
  PX.length = 0;
  let flash = 0, viewL = 0, ground = null;
  for ( const [fid, s] of live ) {
    if ( now > s.end ) { s.destroy(); live.delete(fid); continue; }
    if ( now < s.t0 + s.span[0] ) { s.mesh.visible = s.emit.visible = false; continue; }
    const F = s.frame(now, q, PX), near = nearView(s.at[0], s.at[1]);
    flash = Math.max(flash, F.flash * near); viewL = Math.max(viewL, F.view * near);
    if ( F.ground > 0.02 && (!ground || F.ground > ground[2]) ) ground = [s.at[0], s.at[1], F.ground, s.size];
  }
  if ( !live.size ) { stop(); return; }
  // the spray and crackle pixels (and their emission), snapped to the art grid
  sprayG.clear(); sprayE.clear();
  for ( let c = 0; c < L.COL.spark.length; c++ ) {
    let open = false;
    for ( let i = 0; i < PX.length; i += 3 ) {
      if ( PX[i + 2] !== c ) continue;
      if ( !open ) { sprayG.beginFill(L.COL.spark[c], 1); sprayE.beginFill(mul(L.COL.spark[c], c >= 4 ? 0.35 : 0.9), 1); open = true; }
      const x = g.ox + Math.floor((PX[i] - g.ox) / ap) * ap, y = g.oy + Math.floor((PX[i + 1] - g.oy) / ap) * ap;
      sprayG.drawRect(x, y, ap, ap); sprayE.drawRect(x, y, ap, ap);
    }
    if ( open ) { sprayG.endFill(); sprayE.endFill(); }
  }
  // the night: the whole view lit for an instant, a big ground light round the strike
  viewG.clear();
  if ( viewL > 0.01 ) {
    const st = canvas.stage, sc = st.scale.x, vw = canvas.app.screen.width / sc, vh = canvas.app.screen.height / sc;
    viewG.beginFill(mul(0xc6d6ff, Math.min(0.85, viewL)), 1).drawRect(st.pivot.x - vw, st.pivot.y - vh, vw * 2, vh * 2).endFill();
  }
  if ( ground ) {
    const r = 7 * g.grid * ground[3], v = view();
    groundS.position.set(ground[0], ground[1]); groundS.width = 2 * r; groundS.height = 2 * r * v.squash;
    groundS.tint = mul(0xd8e6ff, Math.min(1, ground[2])); groundS.visible = true;
  } else groundS.visible = false;
  overlay(flash);
}

/** The strike's FLASH: a cold overlay over the board for an instant (never for an opted-out client). */
function overlay(a) {
  let opts = null; try { opts = clientOpts(); } catch { /* not ready */ }
  if ( opts?.noFlash || opts?.reduced ) a = 0;
  if ( !flashEl ) {
    if ( a < 0.005 ) return;
    flashEl = document.createElement("div");
    Object.assign(flashEl.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "1", background: "#e4ecff", opacity: "0", mixBlendMode: "screen" });
    flashEl.className = "mm-preset-strike-flash";
    document.body.appendChild(flashEl);
  }
  flashEl.style.opacity = String(Math.round(Math.min(0.42, 0.36 * a) * 1000) / 1000);
}

/** Tools (dev/ltn-cost.mjs): the drawing containers, for a weak-GPU emulation that draws them more than once. */
export const roots = () => ({ root, glowBox });
/** Tests / tools: what is live. */
export const status = () => ({ live: [...live.keys()], ticking, strikes: [...live.values()].map((s) => ({ W: s.D.W, H: s.D.H, blocks: s.D.blocks.length, cores: s.D.cores })) });
