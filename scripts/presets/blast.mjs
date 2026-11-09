import { sharedNow } from "../shared-clock.mjs";
import { reducedMotion } from "../config.mjs";
import { view } from "../view-angle.mjs";
import { guardQ, guardOff } from "../frame-guard.mjs";
import { geo as fireGeo } from "../fire/fire.mjs";
import { warmPrograms } from "../gl-warm.mjs";
import * as B from "./blast-core.mjs";

/**
 * DESTRUCTION PRESETS, the BLAST on every client (dev/presets-design.md section 24; the pure rules in blast-core.mjs): the first second of
 * a bomb's or a grenade's detonation at the DISPLAY's frame rate - the flash, the air's shock ring, shrapnel streaks, the jets of earth
 * thrown up and their clods. Loaded by blast-wire.mjs on the first firing record with a "blast" accent; draws for about a second and a
 * half after the impact, then removes its ticker - a scene without blasts runs nothing of this.
 *  - ONE SHADER evaluates the frame's bodies per ART CELL of the destruction layer's art grid into a render texture of the blast's box
 *    (one texel per art pixel: the cost is cells, never screen pixels), drawn NEAREST on the art grid - crisp art pixels at every zoom;
 *    each body in a few flat tones with dithered steps and ends by dropout (never a soft fade, never a square). In a container of the
 *    primary group above the tokens (sortLayer 821): it covers a token only for the moment of the detonation.
 *  - NIGHT: a second pass of the same shader writes the emission into Foundry's illumination (MAX_COLOR): the flash, the hot heads and
 *    burning clods glow, the ring and the jets' lit roots faintly; one smooth pool of light lights the ground from the impact's own frame.
 *  - Reduced motion: nothing is drawn. The frame guard thins the streaks and clods (never the flash, ring or jets).
 */
const SORT_LAYER = 821;
const live = new Map();             // key -> Blast
let root = null, glowBox = null, ticking = false, hookL = 0, lightTex = null;

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
const FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform vec4 uFl;
uniform vec4 uFl2;
uniform vec4 uRay[${B.MAX_RAYS}];
uniform int uRayN;
uniform vec4 uRing;
uniform vec4 uRing2;
uniform vec4 uSt[${B.MAX_STREAKS}];
uniform vec4 uSt2[${B.MAX_STREAKS}];
uniform int uStN;
uniform vec4 uJet[${B.MAX_JETS}];
uniform vec4 uJet2[${B.MAX_JETS}];
uniform int uJetN;
uniform vec4 uCl[${B.MAX_CLODS}];
uniform int uClN;
uniform float uDark;
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
const vec3 PAL[12] = vec3[12](${B.PAL.map(rgb).join(", ")});
const float GLOW[12] = float[12](1.0, 1.0, 0.95, 0.8, 0.55, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
// (a segment: its place along it 0..1 and the distance across)
vec2 seg(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a; float L2 = dot(ab, ab);
  float h = L2 > 1e-4 ? clamp(dot(p - a, ab) / L2, 0.0, 1.0) : 0.0;
  return vec2(h, length(p - a - ab * h));
}
void main() {
  ivec2 c = ivec2(floor(vCell));
  vec2 p = vec2(c) + 0.5;
  int col = -1; float al = 1.0, em = -1.0;
  float dz = h3(c.x, c.y, uSeed + 3);
  // THE RING (on the ground, back-most): a thin pale ragged ring, its inside edge a step darker, broken into arcs as it ages
  if ( uRing.z > 0.0 ) {
    vec2 d = p - uRing.xy; d.y /= max(0.4, uRing2.y);
    float r = length(d), u = uRing2.x, ang = atan(d.y, d.x);
    float rag = (vn(vec2(ang * 7.0 + 31.0, r * 0.08), uSeed + 5) - 0.5) * 1.6;
    float e = r - uRing.z + rag;
    if ( abs(e) < uRing.w * 0.5 ) {
      float arc = vn(vec2(ang * 4.2 + 11.0, 0.5), uSeed + 6);
      if ( arc > 0.2 + 0.75 * u * u && dz > u * 0.85 ) { col = e > -uRing.w * 0.1 ? 6 : 7; al = (col == 6 ? 0.8 : 0.5) * (1.0 - 0.45 * u); em = 0.3 * (1.0 - u); }
    }
  }
  // THE JETS of earth: tapered, ragged; they crumble from the tip and pale into dust as they age; their roots lit by the flash for a moment
  for ( int i = 0; i < ${B.MAX_JETS}; i++ ) {
    if ( i >= uJetN ) break;
    vec4 J = uJet[i], J2 = uJet2[i];
    vec2 s = seg(p, J.xy, J.zw);
    // (a PLUME, not a spike: narrow at the root, fanning out to a lumpy crown that breaks into dust - never a straight cone)
    float w = J2.x * (0.5 + 0.8 * sqrt(s.x)) + 0.55;
    w *= 0.6 + 0.8 * vn(p / 2.0 + vec2(float(i) * 7.3, 0.0), uSeed + 9 + i);
    if ( s.y > w ) continue;
    float eat = 1.0 - J2.y * 1.15 + (vn(p / 2.6, uSeed + 30 + i) - 0.5) * 0.45;
    if ( s.x > eat ) continue;
    if ( J2.y > 0.0 && dz < J2.y * 0.55 * s.x ) continue;
    vec2 ab = normalize(J.zw - J.xy + vec2(1e-4)), nn = vec2(-ab.y, ab.x);
    float side = dot(p - J.xy, nn) * sign(dot(nn, vec2(-0.6, -0.8)));
    int t = side > w * 0.25 ? 11 : side > -w * 0.35 ? 10 : 9;
    if ( J2.z > dz * 0.9 + 0.05 * s.x ) t = t == 9 ? 10 : 11;
    col = t; al = 1.0; em = 0.0;
    if ( J2.w > 0.05 && s.x < 0.55 && J2.w > dz * 0.8 ) { col = J2.w > 0.6 ? 3 : 5; em = 0.55 * J2.w; }
  }
  // THE CLODS: earth (or a burning lump), one or two art px, its lower right a step darker
  for ( int i = 0; i < ${B.MAX_CLODS}; i++ ) {
    if ( i >= uClN ) break;
    vec4 C = uCl[i];
    ivec2 ci = ivec2(floor(C.xy)); int sz = int(C.z);
    if ( c.x < ci.x || c.y < ci.y || c.x >= ci.x + sz || c.y >= ci.y + sz ) continue;
    if ( C.w > 0.0 ) { col = C.w > 0.7 ? 2 : C.w > 0.4 ? 3 : C.w > 0.15 ? 4 : 5; em = GLOW[col]; }
    else { col = (c.x > ci.x || c.y > ci.y) && sz > 1 ? 8 : 9; em = 0.0; }
    al = 1.0;
  }
  // THE STREAKS: shrapnel and burning fragments - white-hot head, cooling tail dropping out
  for ( int i = 0; i < ${B.MAX_STREAKS}; i++ ) {
    if ( i >= uStN ) break;
    vec4 S = uSt[i], S2 = uSt2[i];
    vec2 s = seg(p, S.zw, S.xy);
    if ( s.y > 0.5 * S2.y + 0.2 ) continue;
    float hh = S2.x * (0.35 + 0.65 * s.x);
    if ( s.x < 0.45 && dz > 0.35 + hh ) continue;
    col = hh > 0.75 ? 0 : hh > 0.55 ? 2 : hh > 0.35 ? 3 : hh > 0.18 ? 4 : 5; al = 1.0; em = GLOW[col];
  }
  // THE FLASH (front-most): a ragged ball with tongues of flame, white-hot, cooling from the outside in, breaking up by dropout
  if ( uFl.z > 0.0 ) {
    vec2 d = p - uFl.xy; d.y /= 0.86 + 0.14 * uFl2.x;
    float r = length(d), ang = atan(d.y, d.x);
    float tong = 0.0;
    for ( int i = 0; i < ${B.MAX_RAYS}; i++ ) {
      if ( i >= uRayN ) break;
      vec4 Rq = uRay[i];
      float k = max(0.0, cos(ang - Rq.x));
      tong = max(tong, Rq.y * pow(k, Rq.z));
    }
    float lump = (vn(vec2(ang * 2.6 + 5.0, uFl2.z * 0.012), uSeed + 12) - 0.5) * 0.42 + (vn(p / 1.8 + uFl2.z * 0.02, uSeed + 13) - 0.5) * 0.18;
    float Rb = uFl.z * (1.0 + lump) + tong * uFl2.y;
    float v = 1.0 - r / max(Rb, 0.5);
    if ( v > 0.0 ) {
      float br = uFl2.w, hole = vn(p / 2.4 + vec2(0.0, uFl2.z * 0.015), uSeed + 14) * 0.8 + dz * 0.2;
      if ( !(br > 0.0 && hole < br * 1.25 - v * 0.55) ) {
        float T = uFl.w * (0.42 + 0.8 * v) + (vn(p / 2.0, uSeed + 15) - 0.5) * 0.18 + (dz - 0.5) * 0.06;
        col = T > 0.86 ? 0 : T > 0.7 ? 1 : T > 0.54 ? 2 : T > 0.38 ? 3 : T > 0.22 ? 4 : 5; al = 1.0; em = GLOW[col];
      }
    }
  }
  if ( col < 0 ) discard;
  vec3 rgb = PAL[col];
  if ( uEmit > 0.5 ) { fragColor = vec4(rgb * max(0.0, em), 1.0); return; }
  // (the earth and the ring dim with the night; what burns keeps its own colour)
  if ( col >= 6 ) rgb *= mix(1.0, col >= 8 ? 0.55 : 0.5, uDark);
  fragColor = vec4(rgb * al, al);
}`;
let progs = null;
const programs = () => (progs ??= { blast: PIXI.Program.from(VERT, FRAG, "moinen-maps-presets-blast-v1") });
/**
 * The program LINKED IN THE BACKGROUND (gl-warm.mjs), started when a firing record with a blast arrives - the bomb's fall / the
 * grenade's throw is 1.2-1.5 s of pre-roll, so it is linked long before the impact; never compiled by the impact's frame.
 */
let warming = null;
const isWarm = () => !!progs && Object.values(progs).every((p) => p.glPrograms?.[canvas.app.renderer.CONTEXT_UID]);
export function warmUp() {
  if ( !canvas?.ready || !canvas.app?.renderer?.gl ) return Promise.resolve(false);
  programs();
  if ( isWarm() ) return Promise.resolve(true);
  return warming ??= warmPrograms(Object.values(progs), () => !!canvas?.ready).catch(() => {}).then(() => { warming = null; return isWarm(); });
}

/* ---------------------------------------------------------------- one blast */

class Blast {
  constructor(rec, item) {
    const g = fireGeo(), v = view();
    this.t0 = rec.t0 + (Number(item.at) || 0); this.g = g;
    this.env = { lift: v.lift, squash: v.squash, q: 1 };
    this.B = B.prepare(item, ((Number(rec.seed) | 0) ^ 0x5b1a7) >>> 0, g);
    this.end = rec.t0 + B.spanOf(item)[1];
    const [x0, y0, x1, y1] = B.boxOf(this.B);
    this.box = [x0, y0, x1, y1];
    const W = Math.max(1, Math.min(2048, x1 - x0)), H = Math.max(1, Math.min(2048, y1 - y0));
    const opts = { width: W, height: H, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST };
    this.rt = PIXI.RenderTexture.create(opts); this.rtE = PIXI.RenderTexture.create(opts);
    const geom = new PIXI.Geometry().addAttribute("aVertexPosition", [0, 0, W, 0, W, H, 0, H], 2)
      .addAttribute("aCell", [0, 0, W, 0, W, H, 0, H], 2).addIndex([0, 1, 2, 0, 2, 3]);
    const U = (emit) => ({ uFl: new Float32Array(4), uFl2: new Float32Array(4), uRay: new Float32Array(4 * B.MAX_RAYS), uRayN: 0, uRing: new Float32Array(4), uRing2: new Float32Array(4),
      uSt: new Float32Array(4 * B.MAX_STREAKS), uSt2: new Float32Array(4 * B.MAX_STREAKS), uStN: 0, uJet: new Float32Array(4 * B.MAX_JETS), uJet2: new Float32Array(4 * B.MAX_JETS), uJetN: 0,
      uCl: new Float32Array(4 * B.MAX_CLODS), uClN: 0, uDark: 0, uSeed: (this.B.seed & 0xffff) | 0, uEmit: emit });
    this.mesh = new PIXI.Mesh(geom, new PIXI.Shader(programs().blast, U(0)));
    this.meshE = new PIXI.Mesh(geom, new PIXI.Shader(programs().blast, U(1)));
    this.sprite = new PIXI.Sprite(this.rt); this.spriteE = new PIXI.Sprite(this.rtE);
    for ( const s of [this.sprite, this.spriteE] ) { s.position.set(g.ox + x0 * g.ap, g.oy + y0 * g.ap); s.scale.set(g.ap); s.visible = false; s.eventMode = "none"; }
    this.spriteE.blendMode = PIXI.BLEND_MODES.MAX_COLOR;
    this.light = new PIXI.Sprite(lightTexture()); this.light.anchor.set(0.5); this.light.blendMode = PIXI.BLEND_MODES.MAX_COLOR; this.light.visible = false; this.light.eventMode = "none";
    root.addChild(this.sprite); glowBox.addChild(this.light, this.spriteE);
    this.F = B.newFrame();
  }
  /** One frame at shared time `now`. */
  frame(now, q, dark) {
    const t = now - this.t0;
    this.env.q = q;
    const F = B.frameAt(this.B, t, this.env, this.box[0], this.box[1], this.F);
    this.sprite.visible = this.spriteE.visible = F.any && t >= 0;
    const L = F.light;
    this.light.visible = L[3] > 0.01;
    if ( this.light.visible ) {
      const g = this.g, r = L[2] * g.ap;
      this.light.position.set(g.ox + L[0] * g.ap, g.oy + L[1] * g.ap); this.light.width = 2 * r; this.light.height = 2 * r * this.env.squash;
      const k = Math.min(1, L[3]), c = (a) => Math.round(a * k);
      this.light.tint = (c(255) << 16) | (c(214) << 8) | c(160);
    }
    if ( !this.sprite.visible ) return;
    // (never linked by a frame: until the background link is done the light alone shows - in practice it is done in the pre-roll)
    if ( !isWarm() ) { this.sprite.visible = this.spriteE.visible = false; warmUp(); return; }
    const r = canvas.app.renderer;
    for ( const [m, rt] of [[this.mesh, this.rt], [this.meshE, this.rtE]] ) {
      const u = m.shader.uniforms;
      u.uFl.set(F.fl); u.uFl2.set(F.fl2); u.uRay.set(F.ray); u.uRayN = F.nRay; u.uRing.set(F.ring); u.uRing2.set(F.ring2);
      u.uSt.set(F.st); u.uSt2.set(F.st2); u.uStN = F.nSt; u.uJet.set(F.jet); u.uJet2.set(F.jet2); u.uJetN = F.nJet; u.uCl.set(F.cl); u.uClN = F.nCl; u.uDark = dark;
      r.render(m, { renderTexture: rt, clear: true });
    }
  }
  destroy() {
    for ( const s of [this.sprite, this.spriteE, this.light] ) { s.parent?.removeChild(s); s.destroy(); }
    for ( const m of [this.mesh, this.meshE] ) m.destroy();
    this.mesh.geometry?.destroy();
    this.rt.destroy(true); this.rtE.destroy(true);
  }
}

/* ---------------------------------------------------------------- the layer */

export const blastsOf = (rec) => (rec?.pending?.accent ?? []).filter((a) => a?.kind === "blast" && Number.isFinite(a.x) && Number.isFinite(a.y));

export function take(rec) {
  const items = blastsOf(rec);
  if ( !items.length || reducedMotion() ) return;
  warmUp();
  items.forEach((item, i) => {
    const key = `${rec.id}#${i}`;
    if ( live.has(key) || !(rec.t0 + B.spanOf(item)[1] > sharedNow()) ) return;
    mount();
    let s;
    try { s = new Blast(rec, item); } catch ( err ) { console.warn("moinen-maps | presets: blast", err); return; }
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
  canvas.primary.addChild(root);
  glowBox = new PIXI.Container(); glowBox.eventMode = "none";
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
  guardOff("presets-blast");
}
/** The scene goes: everything of this layer goes with it. */
export function reset() {
  stop();
  for ( const s of live.values() ) { try { s.destroy(); } catch { /* the canvas is going */ } }
  live.clear();
  if ( hookL ) Hooks.off("lightingRefresh", hookL); hookL = 0;
  if ( root && !root.destroyed ) root.destroy({ children: true });
  if ( glowBox && !glowBox.destroyed ) { glowBox.parent?.removeChild(glowBox); glowBox.destroy({ children: true }); }
  root = glowBox = null;
}

/** A smooth pool of light (a light has no pixel grid): soft falloff, linear-filtered, white - tinted and scaled per blast. */
function lightTexture() {
  if ( lightTex && !lightTex.baseTexture?.destroyed ) return lightTex;
  const N = 64, a = new Uint8Array(N * N * 4);
  for ( let y = 0; y < N; y++ ) for ( let x = 0; x < N; x++ ) {
    const d = Math.min(1, Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2)), f = 1 - d * d * (3 - 2 * d);
    const v = Math.pow(f, 1.4) * (0.55 + 0.45 * Math.exp(-d * d * 8));
    const o = (y * N + x) * 4; a[o] = a[o + 1] = a[o + 2] = Math.round(255 * v); a[o + 3] = 255;
  }
  lightTex = PIXI.Texture.fromBuffer(a, N, N);
  lightTex.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR; lightTex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
  return lightTex;
}

function tick() {
  if ( !canvas?.ready || !root || root.destroyed ) { stop(); return; }
  const now = sharedNow(), q = guardQ("presets-blast"), dark = Math.min(1, Math.max(0, canvas.environment?.darknessLevel ?? 0));
  for ( const [k, s] of live ) {
    if ( now > s.end ) { s.destroy(); live.delete(k); continue; }
    s.frame(now, q, dark);
  }
  if ( !live.size ) stop();
}

/** Tools (dev/boom3-cost.mjs): the drawing containers, for a weak-GPU emulation that draws them more than once. */
export const roots = () => ({ root, glowBox });
/** Tests / tools: what is live. */
export const status = () => ({ live: [...live.keys()], ticking, boxes: [...live.values()].map((s) => s.box) });
