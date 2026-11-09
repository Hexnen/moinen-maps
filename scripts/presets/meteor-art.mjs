import { sharedNow } from "../shared-clock.mjs";
import { reducedMotion } from "../config.mjs";
import { view as viewOf } from "../view-angle.mjs";
import { guardQ, guardOff } from "../frame-guard.mjs";
import { StageShaker } from "../director/screen.mjs";
import { clientOpts } from "../director/stage.mjs";
import { geo as fireGeo } from "../fire/fire.mjs";
import { footprintK } from "../fire/shader.mjs";
import { rampOf, NATURAL } from "../fire/look.mjs";
import { warmPrograms } from "../gl-warm.mjs";
import * as M from "./meteor-core.mjs";

/**
 * DESTRUCTION PRESETS, THE METEOR on every client (dev/presets-design.md section 21; the pure rules: meteor-core.mjs). Loaded by
 * meteor-wire.mjs on the first firing record with a meteor accent; draws while one is live, then removes its ticker.
 *  - ONE ART PASS per firing into a render texture of ART CELLS (the destruction layer's art grid: the same pixel size and phase as
 *    the crater, the fire and the dust under it) - the head, its coma and plasma tail, the sparks it sheds, the smoke trail along the
 *    way it came, its shadow (day) and its light (night) on the ground, the pressure ring, the ejecta rocks and pebbles with their
 *    shadows. Only the cells in view are drawn; every frame while something moves fast (the flight, the ejecta), then at the fire's
 *    12 fps for the lingering trail.
 *  - SHOW: the cells drawn crisp at any zoom by the fire's footprint sampler, in the primary group above the tokens (as the accents:
 *    it is in the air, or a flash on the ground); EMISSION: the same cells' glow in Foundry's illumination (MAX_COLOR) - what burns
 *    lights itself, the head's light sweeps the ground at night.
 *  - The approach RUMBLE of the screen (the last 0.9 s; never for a client that opted out of shake or wants reduced motion).
 *  - The colours: the fire's ramp for everything that burns (look.mjs rampOf: the fire's language), sooty to pale greys for the trail,
 *    one dark tone for the shadows; ends by dithered dropout, never a soft fade, never a square.
 *  - Reduced motion: nothing (the crater, the fires and the dust are the result). The frame guard thins the sparks and pebbles only.
 */
const SORT_LAYER = 825;
const live = new Map();   // fid -> Shot
let root = null, glowBox = null, ticking = false, hookL = 0, shaker = null;

const HASH = `
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
}`;

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

// THE ART PASS: one art cell per fragment -> rgb (straight) + a = alpha level (0..15) x 16 + glow level (0..15)
const ART = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform vec2 uO;          // the texture's origin (scene px, on the art grid)
uniform float uAp;        // art px (scene px)
uniform float uT;         // ms from the impact
uniform float uT12;       // the same, in whole 12 fps frames (the trail's churn: the fire's pace)
uniform vec2 uP;          // the impact (scene px)
uniform vec2 uD;          // the way it travels on the ground (unit)
uniform vec4 uWay;        // B (px back), Z (px up), at (ms, < 0), D (flight ms)
uniform float uEase;
uniform float uLift;
uniform float uSq;        // px per square x size (the ground things)
uniform float uSk;        // px per square x size^0.7 (the things in the sky)
uniform float uG;         // px per square
uniform vec2 uDrift;      // the wind's drift in the sky (px / s)
uniform vec4 uHead;       // the head on screen (x, y), its ground point (x, y)
uniform vec4 uHeadK;      // its height (px), on (0 / 1), the tail's length (px), the coma's flicker 0..1
uniform vec4 uBody[${M.MAX_BODIES * 2}];
uniform int uBodyN;
uniform int uSeed;
uniform float uDark;
uniform vec4 uRamp[7];
out vec4 oArt;
${HASH}
const float RING_MAX = ${M.RING_MAX.toFixed(1)}, RING_TAU = ${M.RING_TAU.toFixed(1)}, RING_MS = ${M.RING_MS.toFixed(1)};
vec3 C = vec3(0.0);
int A = 0, GL = 0, GG = 0;
void put(vec3 c, int a, int gl) { C = c; A = a; GL = gl; }
int stepOf(float tmp) { return tmp > 0.74 ? 6 : tmp > 0.57 ? 5 : tmp > 0.42 ? 4 : tmp > 0.29 ? 3 : tmp > 0.17 ? 2 : tmp > 0.08 ? 1 : 0; }
void main() {
  ivec2 c = ivec2(vCell);
  vec2 X = uO + (vec2(c) + 0.5) * uAp;
  int S = uSeed;
  float dq = h3(c.x >> 1, c.y >> 1, S + 3);     // (a 2 x 2 cluster's dither threshold: destruction's dropout grain)
  float dp = h3(c.x, c.y, S + 4);
  // ------------------------------------------------ THE GROUND: the head's shadow (day) and its light (night), the pressure ring
  if ( uHeadK.y > 0.5 ) {
    float prox = 1.0 - uHeadK.x / uWay.y;
    vec2 g = X - uHead.zw;
    float rS = uSk * (0.62 - 0.3 * prox), e = length(g) / rS;
    float v = (0.12 + 0.6 * pow(prox, 1.3)) * smoothstep(0.0, 0.12, prox) * (1.0 - 0.75 * uDark) * (1.0 - smoothstep(0.25, 1.0, e));
    if ( e < 1.0 ) { if ( dq < v ) put(vec3(0.07, 0.055, 0.04), 6, 0); else if ( dq < min(0.97, v * 1.9) ) put(vec3(0.07, 0.055, 0.04), 3, 0); }
    float Rg = uG * (1.4 + 5.6 * prox * prox), I = pow(prox, 2.2), eg = length(g) / Rg;
    float lv = I * pow(max(0.0, 1.0 - eg), 1.5) + (dq - 0.5) * 0.07;
    GG = lv > 0.5 ? 10 : lv > 0.26 ? 7 : lv > 0.1 ? 4 : lv > 0.035 ? 2 : 0;
  }
  if ( uT >= 0.0 && uT < RING_MS ) {
    vec2 q = X - uP; float d = length(q), an = atan(q.y, q.x);
    float R = RING_MAX * uSq * (1.0 - exp(-uT / RING_TAU));
    float Rr = R * (1.0 + 0.055 * (2.0 * vn(vec2(an * 4.0 + 7.0, uT * 0.003), S + 40) - 1.0) + 0.03 * (2.0 * vn(vec2(an * 13.0, 1.0), S + 41) - 1.0));
    float wr = uSq * (0.16 + 0.3 * uT / RING_MS), dens = pow(1.0 - uT / RING_MS, 1.2) * smoothstep(0.25, 0.6, vn(vec2(an * 7.0 + 3.0, uT * 0.002), S + 42));
    float u = (Rr - d) / wr;   // (0 at the front, 1 at the back of the band)
    if ( u > -0.08 && u < 1.0 ) {
      float k = dens * (u < 0.22 ? 0.95 : 0.95 * pow(1.0 - (u - 0.22) / 0.78, 1.6));
      if ( dq < k ) put(u < 0.22 ? vec3(0.97, 0.94, 0.87) : vec3(0.88, 0.83, 0.74), u < 0.22 ? 9 : 6, uT < 220.0 ? (u < 0.22 ? 5 : 2) : 0);
    }
  }
  // ------------------------------------------------ the ROCKS' shadows on the ground (day)
  for ( int i = 0; i < ${M.MAX_BODIES}; i++ ) {
    if ( i >= uBodyN ) break;
    vec4 B0 = uBody[2 * i], B1 = uBody[2 * i + 1];
    if ( B0.w < 0.5 ) continue;
    ivec2 gc = ivec2(floor((B1.xy - uO) / uAp)); int sz = B0.w > 2.5 ? 2 : B0.w > 1.5 ? 4 : 3;
    if ( c.x >= gc.x && c.x < gc.x + sz && c.y >= gc.y && c.y < gc.y + max(1, sz - 1) ) put(vec3(0.07, 0.055, 0.04), int(5.0 * (1.0 - 0.75 * uDark)), 0);
  }
  // ------------------------------------------------ THE SMOKE TRAIL along the way it came (the "smuga")
  vec2 S0 = uP - uD * uWay.x - vec2(0.0, uLift * uWay.y);
  vec2 ax = S0 - uP; float Ls = max(1.0, length(ax)); ax /= Ls;
  vec2 nx = vec2(-ax.y, ax.x);
  float sP = 0.0, age = -1.0;
  vec2 Xd = X;
  for ( int k = 0; k < 2; k++ ) {
    sP = 1.0 - dot(Xd - uP, ax) / Ls;
    float tp = uWay.z + pow(clamp(sP, 0.0, 1.0), 1.0 / uEase) * uWay.w;
    age = (uT - tp) / 1000.0;
    Xd = X - uDrift * max(age, 0.0);
  }
  // (after the impact the blast blows the lowest part of the trail away, its cut ragged: the fireball takes over there)
  float cut = uT > 0.0 ? 0.035 + 0.2 * (1.0 - exp(-uT / 650.0)) : 0.0;
  if ( sP > 0.0 && sP < 1.0 && age > 0.0 && (1.0 - sP) > cut * (0.75 + 0.5 * vn(vec2(c >> 1) / 2.5, S + 56)) ) {
    float l = dot(Xd - uP, ax), cr = dot(Xd - uP, nx);
    float grow = 1.0 - exp(-age / 3.2);
    cr -= uSk * (0.36 * grow * sin(l / (1.8 * uG) + 6.2832 * h3(S, 1, 50)) + 0.15 * (1.0 - exp(-age / 2.0)) * sin(l / (0.75 * uG) + 6.2832 * h3(S, 2, 50)));
    float w = uSk * (0.08 + 0.6 * (1.0 - exp(-age / 2.6)) + 0.03 * age) * mix(0.3, 1.0, smoothstep(0.0, 0.3, sP));
    // a chain of BILLOWS along the way (the fireball's language: each a lit lumpy round, the nearest owns the cell, a crease
    // where two meet, never one smooth band)
    float sp = 0.62 * w + uAp, kb = floor(l / sp);
    float bd = 9.0, bR = 1.0; vec2 bq = vec2(0.0); int cover = 0;
    for ( int j = -3; j <= 3; j++ ) {
      int k = int(kb) + j;
      float hk = h3(S, k, 55), h2 = h3(S, k, 57), h4 = h3(S, k, 58);
      // (two loose rows of billows, uneven in size and place: never a chain of beads)
      vec2 q = vec2(l - (float(k) + 0.5 + 0.9 * (hk - 0.5)) * sp, cr - (h2 - 0.5) * 1.1 * w);
      float rk = w * (0.42 + 0.62 * h4 * h4 + 0.12 * hk) * (0.86 + 0.24 * vn(vec2(c) / 1.6, S + 59 + (k & 7)));
      float d = length(q) / rk;
      if ( d < 1.0 ) { cover++; if ( d < bd ) { bd = d; bR = rk; bq = q; } }
    }
    if ( bd < 1.0 ) {
      float er = smoothstep(5.0, 15.0, age), hole = 0.7 * vn(vec2(c >> 1) / 3.2, S + 53) + 0.3 * dp;
      if ( hole + 0.35 * (1.0 - bd) >= er * 1.15 ) {
        vec3 n3 = vec3(bq.x * dot(ax, vec2(1.0, 0.0)) + bq.y * dot(nx, vec2(1.0, 0.0)), bq.x * ax.y + bq.y * nx.y, 0.0) / bR;
        n3.z = sqrt(max(0.0, 1.0 - dot(n3.xy, n3.xy)));
        float lum = dot(n3, normalize(vec3(-0.55, -0.7, 0.6))) + 0.12 * (dp - 0.5);
        bool rim = bd > 0.88, crease = rim && cover > 1;
        int band = crease ? 2 : lum > 0.5 ? 0 : lum > 0.05 ? 1 : 2;
        float f = smoothstep(0.5, 7.5, age);
        vec3 hi = mix(vec3(0.45, 0.41, 0.37), vec3(0.74, 0.72, 0.70), f), md = mix(vec3(0.30, 0.27, 0.26), vec3(0.56, 0.55, 0.56), f),
             sh = mix(vec3(0.17, 0.15, 0.16), vec3(0.39, 0.38, 0.41), f);
        vec3 col = band == 0 ? hi : band == 1 ? md : sh;
        int gl = 0;
        if ( age < 0.45 ) { float fl = 1.0 - age / 0.45; col = mix(col, band == 0 ? uRamp[3].rgb : band == 1 ? uRamp[2].rgb * 0.8 : uRamp[1].rgb * 0.6, fl * 0.85); gl = int(5.0 * fl); }
        if ( uDark > 0.0 ) col = mix(col, (rim || band == 0) ? mix(col * vec3(0.85, 0.9, 1.05), vec3(0.62, 0.66, 0.76), 0.35) : col * vec3(0.78, 0.83, 0.95), uDark);
        int a = int(mix(14.0, 9.0, f) + 0.5);
        if ( rim && !crease ) { a -= 4; col = mix(col, md, 0.5); }
        put(col, a, gl);
      }
    }
  }
  // ------------------------------------------------ THE HEAD: a white-hot core, a flickering coma, the plasma tail
  if ( uHeadK.y > 0.5 ) {
    vec2 r = X - uHead.xy;
    float lb = dot(r, ax), cb = dot(r, nx);          // (behind the head: lb > 0, up the way it came)
    float rc = uSk * 0.11, cm = uSk * 0.29 * (0.9 + 0.2 * uHeadK.w), Lt = uHeadK.z;
    float e = length(vec2(lb < 0.0 ? lb * 1.6 : lb * 0.75, cb));
    if ( e < rc ) put(mix(uRamp[6].rgb, vec3(1.0), 0.55), 15, 15);
    else if ( e < cm ) {
      float tmp = 1.0 - (e - rc) / (cm - rc) + 0.28 * (vn(vec2(c) / 1.6 + vec2(uT * 0.02), S + 60) - 0.5);
      int st = clamp(stepOf(tmp * 0.85 + 0.25), 2, 6);
      if ( st > 2 || dp < 0.6 ) put(uRamp[st].rgb, st >= 4 ? 15 : 12, 9 + st);
    } else if ( lb > 0.0 && lb < Lt ) {
      float f = lb / Lt, wt = cm * 0.92 * pow(1.0 - f, 0.55) + uAp * 0.5;
      float ns = vn(vec2(lb / (0.32 * uSk) - uT * 0.011, cb / (0.065 * uSk)), S + 61);
      if ( abs(cb) < wt * (0.7 + 0.55 * ns) ) {
        float tmp = pow(1.0 - f, 1.15) * (1.0 - pow(abs(cb) / max(wt, 1.0), 2.0) * 0.6) + 0.42 * (ns - 0.5);
        int st = stepOf(tmp);
        if ( st >= 2 || (st == 1 && dp < 0.55) ) put(uRamp[st].rgb, st >= 3 ? 15 : 11, 4 + 2 * st);
      }
    }
  }
  // ------------------------------------------------ THE BODIES: sparks shed by the tail, the ejecta rocks and pebbles, their trails
  for ( int i = 0; i < ${M.MAX_BODIES}; i++ ) {
    if ( i >= uBodyN ) break;
    vec4 B0 = uBody[2 * i], B1 = uBody[2 * i + 1];
    ivec2 bc = ivec2(floor((B0.xy - uO) / uAp)), pc = ivec2(floor((B1.zw - uO) / uAp));
    int kind = int(B0.w + 0.5); float h = B0.z;
    int sz = kind == 2 ? 4 : kind == 1 ? 3 : kind == 3 ? 2 : 1;
    ivec2 o = c - bc;
    bool body = o.x >= 0 && o.y >= 0 && o.x < sz && o.y < sz && !(sz >= 3 && (o.x == 0 || o.x == sz - 1) && (o.y == 0 || o.y == sz - 1) && o.x + o.y > 0);
    if ( body ) {
      if ( kind == 0 ) { if ( h < 0.2 ) continue; int st = clamp(stepOf(h * 0.9 + 0.12), 2, 6); put(uRamp[st].rgb, 15, 6 + st); }
      else if ( h > 0.62 ) put(uRamp[(o.x + o.y == 0) ? 6 : 5].rgb, 15, 13);
      else if ( h > 0.33 ) put(uRamp[(o.x + o.y == 0) ? 4 : 3].rgb, 15, 8);
      else put((o.x + o.y == 0) ? vec3(0.47, 0.42, 0.37) : vec3(0.23, 0.2, 0.18), 15, h > 0.18 ? 3 : 0);
      continue;
    }
    // its trail: the cells between where it was a moment ago and where it is (dithered, cooler)
    vec2 a = vec2(pc) + 0.5, b = vec2(bc) + 0.5, ab = b - a, pq = vec2(c) + 0.5 - a;
    float L2 = dot(ab, ab);
    if ( L2 < 1.0 ) continue;
    float u = clamp(dot(pq, ab) / L2, 0.0, 1.0);
    if ( length(pq - ab * u) < 0.62 && u < 0.97 && dp < 0.35 + 0.55 * u ) {
      if ( kind == 0 ) { if ( h < 0.3 ) continue; int st = clamp(stepOf(h * 0.75), 2, 5); put(uRamp[st].rgb, 12, 3 + st); }
      else if ( h > 0.45 ) put(uRamp[2].rgb, 11, 5);
      else put(vec3(0.5, 0.46, 0.41), 7, 0);
    }
  }
  oArt = vec4(C, float(A * 16 + min(15, A > 0 ? max(GL, GG / 2) : GG)) / 255.0);
}`;

const SHOW_COMMON = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform sampler2D uArt;
uniform vec2 uSize;
uniform float uK;
uniform float uAlpha;
uniform float uLiftL;
out vec4 fragColor;
void axisW(float t, float w, out float i0, out vec3 a) {
  float lo = t - 0.5 * w, hi = t + 0.5 * w;
  i0 = floor(lo);
  a.x = min(i0 + 1.0, hi) - lo;
  a.y = clamp(min(i0 + 2.0, hi) - (i0 + 1.0), 0.0, 1.0);
  a.z = max(0.0, hi - (i0 + 2.0));
  a /= w;
}
vec4 cellColor(vec2 cf);
void main() {
  vec2 w = fwidth(vCell) * uK;
  if ( uK <= 0.0 || max(w.x, w.y) < 0.01 ) { fragColor = cellColor(floor(vCell)) * uAlpha; return; }
  w = clamp(w, vec2(0.01), vec2(2.0));
  float ix, iy; vec3 ax, ay;
  axisW(vCell.x, w.x, ix, ax); axisW(vCell.y, w.y, iy, ay);
  vec4 c = vec4(0.0);
  for ( int j = 0; j < 3; j++ ) {
    float wy = ay[j]; if ( wy <= 0.0 ) continue;
    for ( int i = 0; i < 3; i++ ) { float wx = ax[i]; if ( wx <= 0.0 ) continue; c += wx * wy * cellColor(vec2(ix + float(i), iy + float(j))); }
  }
  if ( c.a <= 0.0 ) discard;
  fragColor = c * uAlpha;
}
ivec2 cellOf(vec2 cf, out bool ok) { ivec2 p = ivec2(cf); ok = p.x >= 0 && p.y >= 0 && p.x < int(uSize.x) && p.y < int(uSize.y); return p; }
`;
const SHOW = `${SHOW_COMMON}
vec4 cellColor(vec2 cf) {
  bool ok; ivec2 p = cellOf(cf, ok); if ( !ok ) return vec4(0.0);
  vec4 t = texelFetch(uArt, p, 0); int a = int(t.a * 255.0 + 0.5), al = a >> 4, gl = a & 15;
  if ( al == 0 ) return vec4(0.0);
  float f = float(al) / 15.0;
  // (what burns keeps its colour at night: the primary group's ambience dims it - lifted back by the glow's share, as the fire's flames)
  vec3 rgb = min(t.rgb * mix(1.0, uLiftL, float(gl) / 15.0), vec3(1.0));
  return vec4(rgb * f, f);
}`;
const EMIT = `${SHOW_COMMON}
vec4 cellColor(vec2 cf) {
  bool ok; ivec2 p = cellOf(cf, ok); if ( !ok ) return vec4(0.0);
  vec4 t = texelFetch(uArt, p, 0); int a = int(t.a * 255.0 + 0.5), al = a >> 4, gl = a & 15;
  if ( gl == 0 ) return vec4(0.0);
  float g = float(gl) / 15.0;
  // (a burning cell lights itself white - its own colour shows; the head's light on the ground is warm)
  return al > 0 ? vec4(vec3(g), g) : vec4(vec3(1.0, 0.74, 0.48) * g, g);
}`;

let progs = null;
const programs = () => progs ??= {
  art: PIXI.Program.from(VERT, ART, "moinen-maps-meteor-art-v1"),
  show: PIXI.Program.from(VERT, SHOW, "moinen-maps-meteor-show-v1"),
  emit: PIXI.Program.from(VERT, EMIT, "moinen-maps-meteor-emit-v1")
};
/**
 * The programs LINKED IN THE BACKGROUND (gl-warm.mjs: KHR_parallel_shader_compile, then PIXI's own compile, a cache hit): on a
 * program-cache miss the art pass alone froze the click's frame for 0.4-0.75 s. A firing is drawn once they are ready - the head is
 * still far up the sky (off screen at zoom 1 for its first second), so nothing is seen later than before. The GM's client starts this
 * when the meteor pad is armed (meteor-wire.mjs), every client on the firing record.
 */
let warm = false, warming = null;
const isWarm = () => warm || (warm = !!progs && Object.values(progs).every((p) => p.glPrograms?.[canvas.app.renderer.CONTEXT_UID]));
export function warmUp() {
  if ( !canvas?.ready || !canvas.app?.renderer?.gl ) return Promise.resolve(false);
  programs();
  if ( isWarm() ) return Promise.resolve(true);
  return warming ??= warmPrograms(Object.values(progs), () => !!canvas?.ready).catch(() => {}).then(() => { warming = null; return isWarm(); });
}
const quad = (x0, y0, x1, y1, W, H) => new PIXI.Geometry()
  .addAttribute("aVertexPosition", [x0, y0, x1, y0, x1, y1, x0, y1], 2)
  .addAttribute("aCell", [0, 0, W, 0, W, H, 0, H], 2)
  .addIndex([0, 1, 2, 0, 2, 3]);

/** One meteor firing: its texture of art cells, the art pass, the show and the emission meshes. */
class Shot {
  constructor(rec, item, geo, lift) {
    this.t0 = rec.t0; this.item = item; this.seed = (Number(rec.seed) | 0) || 1; this.lift = lift; this.end = rec.t0 + M.endOf(item);
    this.W = M.wayOf(item, geo.grid); this.geo = geo; this.body = new Float32Array(M.MAX_BODIES * 8); this.last = null;
    const { ap, ox, oy } = geo, R = M.rectOf(item, geo.grid, lift);
    const cx0 = Math.floor((R.x0 - ox) / ap), cy0 = Math.floor((R.y0 - oy) / ap);
    this.cw = Math.min(4096, Math.ceil((R.x1 - ox) / ap) - cx0); this.ch = Math.min(4096, Math.ceil((R.y1 - oy) / ap) - cy0);
    this.O = [ox + cx0 * ap, oy + cy0 * ap];
    this.rt = PIXI.RenderTexture.create({ width: this.cw, height: this.ch, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST });
    this.rt.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    const P = programs(), g = geo.grid, sz = Math.max(0.5, Math.min(2, Number(item.sz) || 1)), [dx, dy] = M.driftOf(item, g);
    this.dpass = new PIXI.Mesh(quad(0, 0, this.cw, this.ch, this.cw, this.ch), new PIXI.Shader(P.art, {
      uO: new Float32Array(this.O), uAp: ap, uT: -1e6, uT12: 0, uP: new Float32Array(this.W.P), uD: new Float32Array(this.W.d),
      uWay: new Float32Array([this.W.B, this.W.Z, this.W.at, this.W.D]), uEase: M.EASE, uLift: lift, uSq: g * sz, uSk: g * Math.pow(sz, 0.7), uG: g,
      uDrift: new Float32Array([dx, dy]), uHead: new Float32Array(4), uHeadK: new Float32Array(4), uBody: new Float32Array(M.MAX_BODIES * 8), uBodyN: 0,
      uSeed: this.seed % 65536, uDark: 0, uRamp: new Float32Array(rampOf(NATURAL).ramp7.slice(0, 28)), translationMatrix: new PIXI.Matrix().toArray(true) }));
    const x1 = this.O[0] + this.cw * ap, y1 = this.O[1] + this.ch * ap, geom = quad(this.O[0], this.O[1], x1, y1, this.cw, this.ch);
    const common = () => ({ uArt: this.rt, uSize: new Float32Array([this.cw, this.ch]), uK: footprintK(), uAlpha: 1, uLiftL: 1 });
    this.show = new PIXI.Mesh(geom, new PIXI.Shader(P.show, common())); this.show.eventMode = "none";
    this.glow = new PIXI.Mesh(geom, new PIXI.Shader(P.emit, common())); this.glow.eventMode = "none"; this.glow.blendMode = PIXI.BLEND_MODES.MAX_COLOR;
    this.show.state.blendMode = PIXI.BLEND_MODES.NORMAL;
    this.show.visible = this.glow.visible = false;   // (until its programs are linked: tick)
    root.addChild(this.show); glowBox.addChild(this.glow);
  }
  /** Draw the art pass for shared time `now` into the cells of the window `win` (cells [x0, y0, x1, y1]) - if anything changed. */
  draw(renderer, now, win, q, dark, liftL) {
    const t = now - this.t0, fast = t < 2300, t12 = Math.floor(t / 83.333);
    const key = `${fast ? Math.round(t) : t12}|${win.join()}|${q.toFixed(2)}|${dark.toFixed(2)}`;
    for ( const m of [this.show, this.glow] ) { const u = m.shader.uniforms; u.uK = footprintK(); u.uLiftL = liftL; }
    if ( key === this.last ) return false;
    this.last = key;
    const u = this.dpass.shader.uniforms, W = this.W, it = this.item, g = this.geo.grid;
    const tt = fast ? t : t12 * 83.333;
    u.uT = tt; u.uT12 = t12; u.uDark = dark;
    // the head (before the impact) on screen and on the ground, its height, its tail's length by its screen speed, the coma's flicker
    if ( t >= W.at && t < 0 ) {
      const H = M.headAt(W, t), ss = Math.hypot(W.d[0] * W.B, W.d[1] * W.B + this.lift * W.Z) * H.vs;
      u.uHead.set([H.gx, H.gy - this.lift * H.z, H.gx, H.gy]);
      u.uHeadK.set([H.z, 1, Math.max(0.55 * g, Math.min(4.6 * g, ss * 230)), M.h3(this.seed, Math.floor(t / 50), 70)]);
    } else u.uHeadK[1] = 0;
    u.uBodyN = M.bodies(it, tt, { grid: g, lift: this.lift, q }, this.seed, this.body);
    u.uBody.set(this.body);
    const gl = renderer.gl;
    renderer.renderTexture.bind(this.rt);
    renderer.renderTexture.clear();
    const x0 = Math.max(0, win[0]), y0 = Math.max(0, win[1]), x1 = Math.min(this.cw, win[2]), y1 = Math.min(this.ch, win[3]);
    if ( x1 > x0 && y1 > y0 ) {
      gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, y0, x1 - x0, y1 - y0);
      this.dpass.render(renderer); renderer.batch.flush();
      gl.disable(gl.SCISSOR_TEST);
    }
    renderer.renderTexture.bind(null);
    return true;
  }
  /** The cells of the texture in view (with a margin). */
  windowOf() {
    const st = canvas.stage, sc = st.scale.x, vw = canvas.app.screen.width / sc, vh = canvas.app.screen.height / sc, ap = this.geo.ap, m = 4;
    return [Math.floor((st.pivot.x - vw / 2 - this.O[0]) / ap) - m, Math.floor((st.pivot.y - vh / 2 - this.O[1]) / ap) - m,
      Math.ceil((st.pivot.x + vw / 2 - this.O[0]) / ap) + m, Math.ceil((st.pivot.y + vh / 2 - this.O[1]) / ap) + m];
  }
  destroy() {
    for ( const m of [this.show, this.glow] ) { m.parent?.removeChild(m); }
    this.show.geometry.destroy(); this.dpass.geometry.destroy();
    this.show.destroy(); this.glow.destroy(); this.dpass.destroy();
    this.rt.destroy(true);
  }
}

/** The meteor items of a record. */
export const itemsOf = (rec) => (rec?.pending?.accent ?? []).filter((a) => a?.kind === "meteor");

export function take(rec) {
  if ( reducedMotion() || !canvas?.ready ) return;
  const items = itemsOf(rec); if ( !items.length ) return;
  const now = sharedNow();
  if ( !(rec.t0 + Math.max(...items.map(M.endOf)) > now) ) return;
  drop(rec.id);
  mount();
  const g = fireGeo(), v = viewOf();
  warmUp();
  live.set(rec.id, items.map((it) => new Shot(rec, it, g, v.lift)));
  arm();
}
export function drop(fid) {
  const s = live.get(fid); if ( !s ) return;
  for ( const x of s ) x.destroy();
  live.delete(fid);
  if ( !live.size ) stop();
}

function mount() {
  if ( root && !root.destroyed && root.parent ) return;
  root = new PIXI.Container(); root.eventMode = "none"; root.interactiveChildren = false;
  Object.assign(root, { elevation: 0, sortLayer: SORT_LAYER, sort: 0, _lastSortedIndex: 0 });
  canvas.primary.addChild(root);
  glowBox = new PIXI.Container(); glowBox.eventMode = "none";
  attachGlow();
  hookL = Hooks.on("lightingRefresh", attachGlow);
}
function attachGlow() { const box = canvas.effects?.illumination?.lights; if ( box && glowBox && !glowBox.destroyed && glowBox.parent !== box ) box.addChild(glowBox); }
function arm() {
  if ( ticking || !live.size ) return;
  ticking = true;
  canvas.app.ticker.add(tick, null, PIXI.UPDATE_PRIORITY.LOW);
}
function stop() {
  if ( ticking ) canvas.app?.ticker?.remove(tick);
  ticking = false;
  shaker?.restore(); shaker = null;
  guardOff("meteor");
}
/** The scene goes: everything of this layer goes with it. */
export function reset() {
  for ( const fid of [...live.keys()] ) drop(fid);
  stop();
  if ( hookL ) Hooks.off("lightingRefresh", hookL); hookL = 0;
  if ( root && !root.destroyed ) root.destroy({ children: true });
  if ( glowBox && !glowBox.destroyed ) { glowBox.parent?.removeChild(glowBox); glowBox.destroy({ children: true }); }
  root = glowBox = null;
}

/** The scene's darkness and the flames' lift against the primary group's night ambience (as burst-art setDark). */
function darkness() {
  const env = canvas.scene?.environment, d = canvas.environment?.darknessLevel ?? env?.darknessLevel ?? 0;
  const cyc = env?.cycle !== false, bl = env?.base?.luminosity ?? 0, dl = env?.dark?.luminosity ?? 0;
  const lb = cyc ? bl + (dl - bl) * d : bl, lum = lb * (lb >= 0 ? 1.2 : 0.8);
  return [d, 1 / Math.max(0.2, 1 + lum)];
}

function tick() {
  if ( !canvas?.ready || !root || root.destroyed ) { stop(); return; }
  const now = sharedNow(), renderer = canvas.app.renderer, q = guardQ("meteor"), [dark, liftL] = darkness();
  let rum = 0;
  const ready = isWarm();
  for ( const [fid, shots] of live ) {
    if ( shots.every((s) => now > s.end) ) { drop(fid); continue; }
    for ( const s of shots ) {
      if ( now > s.end ) { s.show.visible = s.glow.visible = false; continue; }
      if ( !ready ) continue;
      s.show.visible = s.glow.visible = true;
      s.draw(renderer, now, s.windowOf(), q, dark, liftL);
      rum = Math.max(rum, M.rumbleAt(now - s.t0) * nearView(s.W.P[0], s.W.P[1]));
    }
  }
  if ( !live.size ) return;
  rumble(rum, now);
}

/** How much of something at (x, y) reaches this client's view: 1 on screen, falling off past it. */
function nearView(x, y) {
  const st = canvas.stage, sc = st.scale.x, vw = canvas.app.screen.width / sc, vh = canvas.app.screen.height / sc;
  const d = Math.hypot((x - st.pivot.x) / (vw / 2), (y - st.pivot.y) / (vh / 2));
  return d <= 1 ? 1 : Math.max(0, 1 - (d - 1) / 1.5);
}
/** The approach rumble (the accents' screen cue shakes from the impact on: this one hands over to it at T0). */
function rumble(amp, now) {
  if ( amp < 0.05 ) { if ( shaker ) { shaker.restore(); shaker = null; } return; }
  let opts = null; try { opts = clientOpts(); } catch { /* not ready */ }
  if ( opts?.noShake || opts?.reduced ) return;
  shaker ??= new StageShaker(canvas.stage);
  const k = Math.floor(now / 33);
  shaker.apply(Math.round((M.h3(k, 1, 79) - 0.5) * 2 * amp), Math.round((M.h3(k, 2, 79) - 0.5) * 2 * amp));
}

/** Tools (dev/meteor-cost.mjs): the drawing containers (a weak-GPU emulation draws them more than once); tests: what is live. */
export const roots = () => ({ root, glowBox });
export const status = () => ({ live: [...live.keys()], ticking, shots: [...live.values()].flat().map((s) => ({ w: s.cw, h: s.ch, last: s.last })) });
