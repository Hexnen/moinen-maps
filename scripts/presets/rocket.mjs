import { sharedNow } from "../shared-clock.mjs";
import { reducedMotion } from "../config.mjs";
import { view } from "../view-angle.mjs";
import { guardQ, guardOff } from "../frame-guard.mjs";
import { geo as fireGeo } from "../fire/fire.mjs";
import * as R from "./rocket-core.mjs";

/**
 * DESTRUCTION PRESETS, the ROCKET / RPG on every client (dev/presets-design.md section 21; the pure rules in rocket-core.mjs). Loaded by
 * rocket-wire.mjs on the first firing record with a "rocket" accent; draws while a rocket's smoke lives, then removes its ticker - a
 * scene without rockets runs nothing of this.
 *  - SMOKE (the trail, the backblast, the hiss, the muzzle puff): one shader evaluates them per ART CELL of the destruction layer's art
 *    grid into a render texture of the firing's box (one texel per art pixel: the cost is cells, never screen pixels), drawn NEAREST
 *    on the art grid - crisp art pixels at every zoom. Lumpy, lit from the top left in three tones and a dark rim, coloured by age
 *    (white-hot / orange behind the motor flame, warm-lit, then white-grey; the backblast's dust grey-tan), thinning by blobby
 *    value-noise dropout (never a soft fade, never a square). In a container of the primary group above the tokens (sortLayer 819).
 *  - NIGHT: a second pass of the shader writes its emission into Foundry's illumination (MAX_COLOR): the hot smoke glows, the warm-lit
 *    at half, the rest as a faint moonlit glow (the trail reads in the dark); smooth ground lights under the motor flame and at the launch.
 *  - PIXELS: the rocket, its motor flame, its shadow, the sparks and flashes (rocket-core pixelsAt), with their emission.
 *  - Reduced motion: nothing is drawn. The frame guard thins the sparks and, below q 0.7, renders the smoke every other frame.
 */
const SORT_LAYER = 819;
const live = new Map();             // fid -> Rocket
let root = null, glowBox = null, pixG = null, pixE = null, shadeG = null, ticking = false, hookL = 0, lightTex = null, lightPool = [], frameN = 0;
const P = R.newPix();

/* ---------------------------------------------------------------- the smoke shader */

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
/** The smoke's tones: [light, mid, shadow, rim] per family - grey-white smoke, the backblast's grey-tan dust, warm-lit (fire inside). */
export const TONES = {
  smoke: [0xe6e3dd, 0xbfbab2, 0x8f8981, 0x645f59],
  dust: [0xe1d4bf, 0xbcab92, 0x8d7c66, 0x5f5342],
  warm: [0xffc27a, 0xe58f4e, 0xb2643a, 0x7a3b25],
  hot: [0xfffbe8, 0xffe27a, 0xffa13a, 0xe0532a]
};
const tone = (k) => `vec3[4](${TONES[k].map(rgb).join(", ")})`;
const FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform vec4 uS[${R.N}];
uniform vec4 uT[${R.N}];
uniform int uN;
uniform vec4 uB[${R.MAX_BILLOWS}];
uniform vec4 uB2[${R.MAX_BILLOWS}];
uniform int uBN;
uniform vec3 uImp;
uniform float uC;        // cells per grid square
uniform int uSeed;
uniform float uEmit;
out vec4 fragColor;
uint pcg(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}
float h3(int a, int b, int c) { return float(pcg(uvec3(ivec3(a, b, c))) & 0xffffffu) / 16777216.0; }
float vn(vec2 p, int s) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  ivec2 I = ivec2(i);
  float a = h3(I.x, I.y, s), b = h3(I.x + 1, I.y, s), c = h3(I.x, I.y + 1, s), d = h3(I.x + 1, I.y + 1, s);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
const vec3 SMOKE[4] = ${tone("smoke")};
const vec3 DUST[4] = ${tone("dust")};
const vec3 WARM[4] = ${tone("warm")};
const vec3 HOT[4] = ${tone("hot")};
void main() {
  ivec2 c = ivec2(floor(vCell));
  vec2 p = vec2(c) + 0.5;
  float best = -1.0, age = 0.0, heat = 0.0, warm = 0.0, dens = 0.0, kind = 0.0;
  vec2 nrm = vec2(0.0);
  // THE TRAIL: the nearest stretch of the sample polyline gives the cell its place along the trail (s) and across it (l), the trail's
  // radius, age, heat and density there; the smoke itself is a CAULIFLOWER of puffs laid along the trail (one every PUFF_SQ, each with
  // its own offset across, size and depth): the front-most covering puff owns the cell, a dark crease where its edge lies
  // over another puff - it reads as billows, never a hose
  float bd = 1e9; int kb = -1; float hb = 0.0;
  for ( int k = 0; k < ${R.N - 1}; k++ ) {
    if ( k + 1 >= uN ) break;
    vec4 A = uS[k], B = uS[k + 1];
    vec2 ab = B.xy - A.xy;
    float L2 = dot(ab, ab), h = L2 > 1e-4 ? clamp(dot(p - A.xy, ab) / L2, 0.0, 1.0) : 0.0;
    float sc = length(p - A.xy - ab * h) - mix(A.z, B.z, h) * 1.35;
    if ( sc < bd ) { bd = sc; kb = k; hb = h; }
  }
  bool cover = false; float fo = 0.0, own = -1.0; int cnt = 0;
  if ( kb >= 0 && bd < 2.0 ) {
    vec4 A = uS[kb], B = uS[kb + 1], TA = uT[kb], TB = uT[kb + 1];
    vec2 ab = B.xy - A.xy, q = A.xy + ab * hb;
    vec2 T = length(ab) > 1e-3 ? normalize(ab) : vec2(1.0, 0.0), Nn = vec2(-T.y, T.x);
    float R0 = mix(A.z, B.z, hb), a = mix(TA.x, TB.x, hb);
    float sC = mix(TA.y, TB.y, hb) + dot(p - q, T), l = dot(p - q, Nn);
    float sp = max(1.6, ${R.PUFF_SQ} * uC);
    int i0 = int(floor(sC / sp));
    float edge = (vn((p + vec2(a * 2.0, -a * 3.0)) / max(1.5, 0.08 * uC), uSeed + 1) - 0.5) * min(2.5, 0.35 * R0);
    for ( int di = -5; di <= 5; di++ ) {
      int i = i0 + di;
      float si = (float(i) + 0.5 + (h3(i, uSeed, 1) - 0.5) * 0.7) * sp;
      float Ri = max(1.3, R0 * (0.66 + 0.56 * h3(i, uSeed, 3)));
      float oi = (h3(i, uSeed, 2) - 0.5) * 0.6 * R0;
      vec2 dl = vec2(sC - si, l - oi);
      float f = 1.0 - (length(dl) + edge) / Ri;
      if ( f <= 0.0 ) continue;
      cnt++;
      float dep = h3(i, uSeed, 4);
      if ( dep > own ) { own = dep; fo = f; nrm = (T * dl.x + Nn * dl.y) / Ri; }
    }
    // (a body along the middle joins the puffs: never a string of beads)
    float core = 1.0 - (abs(l) + edge * 0.5) / max(1.0, R0 * 0.58);
    if ( cnt == 0 && core > 0.0 ) { cnt = 1; fo = core * 0.5 + 0.2; nrm = Nn * l / max(1.0, R0); }
    if ( cnt > 0 ) { cover = true; best = fo; age = a; heat = mix(TA.z, TB.z, hb); warm = mix(TA.w, TB.w, hb); dens = mix(A.w, B.w, hb); kind = 0.0; }
  }
  // THE BILLOWS (backblast, hiss, muzzle puff): round billows with a ragged edge, front-most by their own depth order, creased
  for ( int j = 0; j < ${R.MAX_BILLOWS}; j++ ) {
    if ( j >= uBN ) break;
    vec4 Bq = uB[j];
    vec2 d = p - Bq.xy;
    float r = Bq.z, dist = length(d);
    if ( dist > r * 1.6 + 2.0 ) continue;
    vec4 B2 = uB2[j];
    float edge = vn((p + vec2(B2.x * 2.0, -B2.x * 2.5)) / max(1.4, 0.09 * uC), uSeed + 3 + j) - 0.5;
    float f = 1.0 - (dist + edge * min(3.5, 0.5 * r)) / max(r, 0.8);
    if ( f <= 0.0 ) continue;
    cnt++;
    float dep = 2.0 + h3(j, uSeed, 9);
    if ( dep > own ) { own = dep; best = f; fo = f; nrm = d / max(r, 0.8); age = B2.x; heat = B2.y; warm = B2.z; dens = Bq.w; kind = B2.w; cover = true; }
  }
  if ( !cover ) discard;
  bool crease = cnt > 1 && fo < 0.16;
  // the dissolve: blobby holes (value noise a few cells across, drifting up) open as the density falls; the rim goes first
  float blob = vn((p + vec2(0.0, age * 2.5)) / max(2.0, 0.13 * uC), uSeed + 7) * 0.82 + h3(c.x, c.y, uSeed + 9) * 0.18;
  if ( blob > dens * (0.55 + 0.45 * min(1.0, best * 3.0)) ) discard;
  // the fireball lights the trail's last stretch for a moment
  if ( uImp.z > 0.0 ) warm = max(warm, uImp.z * max(0.0, 1.0 - length(p - uImp.xy) / (2.2 * uC)));
  // lit from the top left (sphere normals of the tube / billow), three tones and a dark rim on the shadow side, banded with a 2 x 2
  // dither at each step (no smooth gradient)
  vec3 n3 = vec3(nrm, sqrt(max(0.0, 1.0 - dot(nrm, nrm))));
  float lam = dot(n3, normalize(vec3(-0.55, -0.7, 0.6))) + (h3(c.x >> 1, c.y >> 1, uSeed + 11) - 0.5) * 0.16;
  int t = lam > 0.45 ? 0 : lam > -0.08 ? 1 : 2;
  if ( crease || (best < 0.12 && lam < 0.1) ) t = crease && lam > 0.4 ? 2 : 3;
  vec3 col = kind > 0.5 ? DUST[t] : SMOKE[t];
  float em = kind > 0.5 ? 0.1 : 0.17 * (t < 2 ? 1.0 : 0.7);
  float dz = h3(c.x, c.y, uSeed + 13);
  if ( heat > 0.05 && heat > dz * 0.9 ) { col = HOT[min(3, t + (heat > 0.6 ? 0 : 1))]; em = 1.0; }
  else if ( warm > 0.04 && warm > dz * 0.85 ) { col = WARM[t]; em = 0.32 + 0.4 * warm; }
  if ( uEmit > 0.5 ) { fragColor = vec4(col * em, 1.0); return; }
  float alpha = (t == 3 ? 0.78 : 0.88) * (heat > 0.05 || warm > 0.3 ? 1.0 : 0.92);
  fragColor = vec4(col * alpha, alpha);
}`;
let program = null;
const prog = () => (program ??= PIXI.Program.from(VERT, FRAG, "moinen-maps-presets-rocket-v3"));

/** Compile the smoke shader ahead (a tiny draw into a 1 x 1 texture): the first rocket then draws without a compile hitch. */
let warmed = false;
export function _warm() {
  if ( warmed ) return; warmed = true;
  const rt = PIXI.RenderTexture.create({ width: 1, height: 1 });
  const geom = new PIXI.Geometry().addAttribute("aVertexPosition", [0, 0, 1, 0, 1, 1, 0, 1], 2).addAttribute("aCell", [0, 0, 1, 0, 1, 1, 0, 1], 2).addIndex([0, 1, 2, 0, 2, 3]);
  const m = new PIXI.Mesh(geom, new PIXI.Shader(prog(), { uS: new Float32Array(4 * R.N), uT: new Float32Array(4 * R.N), uN: 0, uB: new Float32Array(4 * R.MAX_BILLOWS),
    uB2: new Float32Array(4 * R.MAX_BILLOWS), uBN: 0, uImp: new Float32Array(3), uC: 32, uSeed: 1, uEmit: 0 }));
  try { canvas.app.renderer.render(m, { renderTexture: rt, clear: true }); } finally { m.destroy(); geom.destroy(); rt.destroy(true); }
}

/* ---------------------------------------------------------------- one rocket */

class Rocket {
  constructor(rec, item) {
    const g = fireGeo(), v = view();
    this.rec = rec; this.item = item; this.t0 = rec.t0; this.g = g;
    this.env = { geo: g, lift: v.lift, squash: v.squash, q: 1 };
    this.F = R.prepare(item, ((Number(rec.seed) | 0) ^ 0x7a3c5) >>> 0, g.grid);
    this.span = R.spanOf(item);
    this.end = this.t0 + this.span[1];
    // the render box: everything the smoke can reach in its life (cells), capped at 2048 texels a side round the target
    let [x0, y0, x1, y1] = R.boxOf(this.F, item, this.env);
    const cap = 2048, cx = Math.floor((item.to[0] - g.ox) / g.ap), cy = Math.floor((item.to[1] - g.oy) / g.ap);
    x0 = Math.max(x0, cx - cap / 2); x1 = Math.min(x1, x0 + cap); y0 = Math.max(y0, cy - cap / 2); y1 = Math.min(y1, y0 + cap);
    this.box = [x0, y0, x1, y1];
    const W = Math.max(1, x1 - x0), H = Math.max(1, y1 - y0);
    const opts = { width: W, height: H, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST };
    this.rt = PIXI.RenderTexture.create(opts); this.rtE = PIXI.RenderTexture.create(opts);
    const geom = new PIXI.Geometry().addAttribute("aVertexPosition", [0, 0, W, 0, W, H, 0, H], 2)
      .addAttribute("aCell", [x0, y0, x1, y0, x1, y1, x0, y1], 2).addIndex([0, 1, 2, 0, 2, 3]);
    const U = (emit) => ({ uS: new Float32Array(4 * R.N), uT: new Float32Array(4 * R.N), uN: 0, uB: new Float32Array(4 * R.MAX_BILLOWS), uB2: new Float32Array(4 * R.MAX_BILLOWS), uBN: 0,
      uImp: new Float32Array(3), uC: g.grid / g.ap, uSeed: (this.F.seedT & 0xffff) | 0, uEmit: emit });
    this.mesh = new PIXI.Mesh(geom, new PIXI.Shader(prog(), U(0)));
    this.meshE = new PIXI.Mesh(geom, new PIXI.Shader(prog(), U(1)));
    this.sprite = new PIXI.Sprite(this.rt); this.spriteE = new PIXI.Sprite(this.rtE);
    for ( const s of [this.sprite, this.spriteE] ) { s.position.set(g.ox + x0 * g.ap, g.oy + y0 * g.ap); s.scale.set(g.ap); s.visible = false; s.eventMode = "none"; }
    this.spriteE.blendMode = PIXI.BLEND_MODES.MAX_COLOR;
    root.addChildAt(this.sprite, 0); glowBox.addChildAt(this.spriteE, 0);
    this.trail = { n: 0, S: new Float32Array(4 * R.N), T: new Float32Array(4 * R.N), imp: [0, 0, 0] };
    this.bil = { n: 0, B: new Float32Array(4 * R.MAX_BILLOWS), B2: new Float32Array(4 * R.MAX_BILLOWS) };
    this.drawn = false;
  }
  /** One frame at shared time `now`: the smoke into its texture (unless the guard skips this frame) and the pixels into P. */
  frame(now, q, skip) {
    const t = now - this.t0;
    this.env.q = q;
    if ( t < this.span[0] ) { this.sprite.visible = this.spriteE.visible = false; return; }
    R.pixelsAt(this.F, this.item, t, this.env, P);
    if ( skip && this.drawn ) return;
    const T = R.trailAt(this.F, t, this.env, this.trail), B = R.billowsAt(this.F, this.item, t, this.env, this.bil);
    const any = T.n > 1 || B.n > 0;
    this.sprite.visible = this.spriteE.visible = any;
    if ( !any ) return;
    const r = canvas.app.renderer;
    for ( const [m, rt] of [[this.mesh, this.rt], [this.meshE, this.rtE]] ) {
      const u = m.shader.uniforms;
      u.uS.set(T.S); u.uT.set(T.T); u.uN = T.n; u.uB.set(B.B); u.uB2.set(B.B2); u.uBN = B.n; u.uImp[0] = T.imp[0]; u.uImp[1] = T.imp[1]; u.uImp[2] = T.imp[2];
      r.render(m, { renderTexture: rt, clear: true });
    }
    this.drawn = true;
  }
  destroy() {
    for ( const s of [this.sprite, this.spriteE] ) { s.parent?.removeChild(s); s.destroy(); }
    for ( const m of [this.mesh, this.meshE] ) m.destroy();
    this.mesh.geometry?.destroy();
    this.rt.destroy(true); this.rtE.destroy(true);
  }
}

/* ---------------------------------------------------------------- the layer */

export const rocketsOf = (rec) => (rec?.pending?.accent ?? []).filter((a) => a?.kind === "rocket" && Array.isArray(a.m) && Array.isArray(a.to));

export function take(rec) {
  const items = rocketsOf(rec);
  if ( !items.length || reducedMotion() ) return;
  if ( canvas?.ready ) { try { _warm(); } catch { /* compiled at the first draw instead */ } }
  items.forEach((item, i) => {
    const key = `${rec.id}#${i}`;
    if ( live.has(key) || !(rec.t0 + R.spanOf(item)[1] > sharedNow()) ) return;
    mount();
    let s;
    try { s = new Rocket(rec, item); } catch ( err ) { console.warn("moinen-maps | presets: rocket", err); return; }
    s.fid = rec.id;
    live.set(key, s);
  });
  arm();
}
export function drop(fid) {
  for ( const [k, s] of live ) if ( s.fid === fid ) { s.destroy(); live.delete(k); }
  if ( !live.size ) stop();
}

function mount() {
  if ( root && !root.destroyed && root.parent ) return;
  root = new PIXI.Container();
  root.eventMode = "none"; root.interactiveChildren = false;
  Object.assign(root, { elevation: 0, sortLayer: SORT_LAYER, sort: 0, _lastSortedIndex: 0 });
  shadeG = new PIXI.Graphics(); pixG = new PIXI.Graphics(); root.addChild(shadeG, pixG);
  canvas.primary.addChild(root);
  glowBox = new PIXI.Container(); glowBox.eventMode = "none";
  pixE = new PIXI.Graphics(); pixE.blendMode = PIXI.BLEND_MODES.MAX_COLOR; glowBox.addChild(pixE);
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
  guardOff("presets-rocket");
  for ( const G of [pixG, pixE, shadeG] ) if ( G && !G.destroyed ) G.clear();
  for ( const s of lightPool ) s.visible = false;
}
/** The scene goes: everything of this layer goes with it. */
export function reset() {
  stop();
  for ( const s of live.values() ) { try { s.destroy(); } catch { /* the canvas is going */ } }
  live.clear();
  if ( hookL ) Hooks.off("lightingRefresh", hookL); hookL = 0;
  if ( root && !root.destroyed ) root.destroy({ children: true });
  if ( glowBox && !glowBox.destroyed ) { glowBox.parent?.removeChild(glowBox); glowBox.destroy({ children: true }); }
  root = glowBox = pixG = pixE = shadeG = null; lightPool = [];
}

/** A smooth, organic pool of light (a light has no pixel grid): soft falloff, linear-filtered, white - tinted and scaled per light. */
function lightTexture() {
  if ( lightTex && !lightTex.baseTexture?.destroyed ) return lightTex;
  const N = 64, a = new Uint8Array(N * N * 4);
  for ( let y = 0; y < N; y++ ) for ( let x = 0; x < N; x++ ) {
    const d = Math.min(1, Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2)), f = 1 - d * d * (3 - 2 * d);
    const v = Math.pow(f, 1.5) * (0.6 + 0.4 * Math.exp(-d * d * 10));
    const o = (y * N + x) * 4; a[o] = a[o + 1] = a[o + 2] = Math.round(255 * v); a[o + 3] = 255;
  }
  lightTex = PIXI.Texture.fromBuffer(a, N, N);
  lightTex.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR; lightTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
  return lightTex;
}
const mul = (c, k) => ((Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k));

function tick() {
  if ( !canvas?.ready || !root || root.destroyed ) { stop(); return; }
  const now = sharedNow(), q = guardQ("presets-rocket"), g = fireGeo(), ap = g.ap, v = view();
  frameN++;
  const skip = q < 0.7 && (frameN & 1) === 1;
  R.clearPix(P);
  for ( const [k, s] of live ) {
    if ( now > s.end ) { s.destroy(); live.delete(k); continue; }
    s.env.lift = v.lift; s.env.squash = v.squash; s.env.geo = g;
    s.frame(now, q, skip);
  }
  if ( !live.size ) { stop(); return; }
  // the pixels: shadows (two dithered steps), colour (dim first: a brighter pixel drawn later wins) and its emission
  shadeG.clear(); pixG.clear(); pixE.clear();
  P.shade.forEach((L, k) => {
    if ( !L.length ) return;
    shadeG.beginFill(R.SHADE, R.SHADE_A[k]);
    for ( let i = 0; i < L.length; i += 2 ) shadeG.drawRect(g.ox + L[i] * ap, g.oy + L[i + 1] * ap, ap, ap);
    shadeG.endFill();
  });
  for ( let c = R.PAL.length - 1; c >= 0; c-- ) {
    const L = P.px[c]; if ( !L.length ) continue;
    const em = R.GLOW[c] > 0;
    pixG.beginFill(R.PAL[c], 1); if ( em ) pixE.beginFill(mul(0xffffff, R.GLOW[c]), 1);
    for ( let i = 0; i < L.length; i += 2 ) { const x = g.ox + L[i] * ap, y = g.oy + L[i + 1] * ap; pixG.drawRect(x, y, ap, ap); if ( em ) pixE.drawRect(x, y, ap, ap); }
    pixG.endFill(); if ( em ) pixE.endFill();
  }
  // the lights (night): pooled smooth sprites in the emission container
  const G = P.glows, tex = lightTexture();
  let n = 0;
  for ( let i = 0; i < G.length; i += 5, n++ ) {
    let s = lightPool[n];
    if ( !s ) { s = lightPool[n] = new PIXI.Sprite(tex); s.anchor.set(0.5); s.blendMode = PIXI.BLEND_MODES.MAX_COLOR; s.eventMode = "none"; glowBox.addChild(s); }
    const r = G[i + 2];
    s.position.set(G[i], G[i + 1]); s.width = 2 * r; s.height = 2 * r * v.squash;
    s.tint = mul(R.PAL[G[i + 4]], Math.min(1, G[i + 3])); s.visible = true;
  }
  for ( let k = n; k < lightPool.length; k++ ) lightPool[k].visible = false;
}

/** Tools (dev/rocket-cost.mjs): the drawing containers, for a weak-GPU emulation that draws them more than once. */
export const roots = () => ({ root, glowBox });
/** Tests / tools: what is live. */
export const status = () => ({ live: [...live.keys()], ticking, boxes: [...live.values()].map((s) => s.box), px: P.px.reduce((a, l) => a + l.length / 2, 0) });
