import * as M from "./model.mjs";
import { blendMode } from "./display.mjs";
import { GLSL_WIND, gustEnv, dirVec } from "../wind.mjs";
import { weatherQ } from "./guard.mjs";

/**
 * The LENS: what happens ON the glass (doc 4.2-4.4), never a second copy of the world weather.
 *
 * GRID: the lens's units, fixed in screen space: one lens px = round(3 x DPR) device px (about 3 CSS px), whatever the zoom (drops
 * are on the glass, not on the map). Sizes, cells and densities are in lens px; NOTHING IS DRAWN IN WHOLE LENS PX: every shape (a
 * drop's edge, a wet trail, a speck, a grain, frost, a crystal, a fleck, a glint) is drawn smooth and antialiased per px of the pass,
 * SUB = 3 px per lens px (one per CSS px). In whole lens px they were 3 x 3 squares and stairs (2026-11-08).
 *
 * RENDER: one pass into a target of SUB x SUB px per lens px, only when its 12 Hz step changes, drawn in BANDS over the frames
 * until the next step into a hidden pair of targets, then swapped in; every frame one sprite, a child of the stage drawn last, in
 * screen space (its world transform ignores the stage's), scales it smoothly (LINEAR). Both use the weather's blend (dst x k + add):
 * everything on the glass is the frame under it scaled and lifted, NOTHING IS COPIED at lens resolution: a big drop shows the
 * full-resolution frame under it, refracted per screen px by the sprite (a lift, a lit top edge, a thin darker lower rim, a glint).
 *
 * RAIN (4.3): static beads (one per jittered 8-px cell, lobed, born with a splat, sag, evaporate), runners in two column grids (grow
 * in place, then stick-slip down a wobbly path slanted by the wind, leave a wet streak that beads up and clears the misty film),
 * mist specks, a cool film. Every term is a pure function of (lens px, step time) from integer hashes: every client with the
 * same screen size sees the same glass. Runner cycles are absolute within the hour (no short loop).
 *
 * COST: nothing exists without a lens effect. With one: one ticker listener (a compare), one textured full-screen quad per frame,
 * one lens pass (~2.1 M px at any DPR for a 1080p-sized window: one per CSS px) 12 times a second, a quarter of it per frame, after
 * two tiny pre-passes into float targets: the step's runners per column and beads per cell, worked out once instead of by every
 * px (rain 3, RTX 3070 Ti, 1584 x 805 CSS px: ~0.47 ms per step). The pass keeps no local array of runners: it fetches them (a
 * local array of 12 runners made every px of the pass ~10 x slower, used or not).
 */

const LENS_VERT = `#version 300 es
precision highp float;
in vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform float uVS;
out vec2 vP;
void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vP = aVertexPosition * uVS;   // (the pass's px -> lens px; the pre-passes: their own px)
}`;

const LENS_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vP;
#if LENS_OUT == 2
layout(location = 0) out vec4 dispColor;   // a big drop's refraction: (its centre - this px) / 32 + 0.5, radius / 16, image share
vec4 fragColor;                            // (ONE output per program: lensFrag)
#else
layout(location = 0) out vec4 fragColor;
vec4 dispColor;
#endif
uniform vec2 uLens;          // lens size in lens px
uniform float uAA;           // one px of this pass in lens px (the pass draws SUB px per lens px: shapes are smooth, never whole lens px)
uniform float uT;            // the step time (s, mod 1 h)
uniform int uSeed;
uniform vec4 uRainA;         // bead density, biggest bead radius, runner rate, mist
uniform float uFilm;
uniform vec3 uWind;          // unit direction (x, y), strength 0..1
uniform float uSlant;        // runner slant (x per y) from the wind
uniform float uG[121];       // the gust envelope over the last 10 s (12 Hz, oldest first): rain intensity, sand waves, fire gusts
uniform vec4 uSnowL;         // frost reach, frost breathing, crystals per lens-area, presence
uniform vec4 uSandL;         // deposit, scratches per area, impacts per area, presence
uniform vec4 uDustL;         // specks share, discs per area, glare, ghosts (a float count: the last ghost fades in by its fraction)
uniform vec4 uDustL2;        // ghost strength, smudge, presence, -
uniform vec4 uHeatL;         // glow, flecks per area, presence, -
uniform float uLight;        // 1 by day, darker at night
uniform highp sampler2D uRun;   // pre-pass 1: the runners of this step, per layer and column 5 texels (a, b, c, d; moving, key, on)
uniform highp sampler2D uBead;  // pre-pass 2: the beads of this step, per 8-px cell 3 texels (b, r, a2; a3, p2, p3, tau; key, on, Rg)
uniform ivec2 uRunC0;           // the first column of each layer in uRun
uniform ivec2 uCell0;           // the first cell in uBead
${GLSL_WIND}
const float PERIOD = 10.0, G = 8.0, PI2 = 6.2831853, SMALL = 2.6;
float vnoise(vec2 p, int s) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  int x = int(i.x), y = int(i.y);
  return mix(mix(hu(x, y, s), hu(x + 1, y, s), u.x), mix(hu(x, y + 1, s), hu(x + 1, y + 1, s), u.x), u.y);
}
float fbm2(vec2 p, int s) {
  vec2 q = mat2(0.9563, 0.2924, -0.2924, 0.9563) * p * 2.17 + vec2(17.3, -9.1);
  return (vnoise(p, s) + 0.5 * vnoise(q, s + 1)) / 1.5;
}
float ss(float a, float b, float x) { return smoothstep(a, b, x); }
// the coverage of a shape at signed distance s (lens px, < 0 inside): antialiased over one px of the pass
float cov(float s) { return clamp(0.5 - s / uAA, 0.0, 1.0); }
// a soft round speck: 1 at its centre, falling smoothly to exactly 0 at radius r
float soft(vec2 e, float r) { float t = clamp(1.0 - dot(e, e) / (r * r), 0.0, 1.0); return t * t; }
// the distance from q to the segment a -> a + d x ln (d a unit direction)
float segD(vec2 q, vec2 a, vec2 d, float ln) { vec2 e = q - a; return length(e - d * clamp(dot(e, d), 0.0, ln)); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// where drops gather: the glass edges, the wind side, low-frequency patches
float dens(vec2 p) {
  float ex = min(p.x, uLens.x - p.x) / (0.20 * uLens.x), ey = min(p.y, uLens.y - p.y) / (0.24 * uLens.y);
  float edge = 1.0 - clamp(min(ex, ey), 0.0, 1.0);
  float side = clamp(1.0 - (dot(p / uLens - 0.5, uWind.xy) + 0.5) / 0.75, 0.0, 1.0);
  side = mix(0.4, side, uWind.z);
  float pat = fbm2(vec2(p.x / 70.0, p.y / 50.0), uSeed + 55);
  return clamp(0.30 + 0.42 * edge + 0.30 * side + 0.9 * (pat - 0.5), 0.04, 1.0);
}
// the gust envelope tau seconds ago, and the rain intensity it gives
float gAgo(float tau) {
  float f = clamp((PERIOD - tau) * 12.0, 0.0, 119.999);
  int i = int(f);
  return mix(uG[i], uG[i + 1], f - float(i));
}
float intensityAgo(float tau) { return 0.7 + 0.35 * (clamp(gAgo(tau), 0.0, 1.1) - 0.4); }
float fbm3(vec2 p, int s) {
  vec2 q = mat2(0.9563, 0.2924, -0.2924, 0.9563) * p * 2.17 + vec2(17.3, -9.1), r = mat2(0.7547, 0.6561, -0.6561, 0.7547) * p * 4.71 + vec2(-31.7, 5.3);
  return (vnoise(p, s) + 0.5 * vnoise(q, s + 1) + 0.25 * vnoise(r, s + 2)) / 1.75;
}
// one life cycle of a hashed thing: k cycles per 10 s, absolute cycle index c (no short loop), age tau
void cycle(int kx, int ky, int s, float kk, out float L, out int c, out float tau) {
  L = PERIOD / kk;
  float u = (uT + hu(kx, ky, s + 1) * L) / L;
  c = int(floor(u)); tau = fract(u) * L;
}
// a lobed blob: signed distance (and its radius at this angle in R)
float blob(vec2 p, vec2 c, float r, float a2, float p2, float a3, float p3, float sag, out float R) {
  vec2 d = p - c;
  float dyy = d.y > 0.0 ? d.y / sag : d.y / 0.93;
  float th = atan(dyy, d.x);
  R = r * (1.0 + a2 * sin(2.0 * th + p2) + a3 * sin(3.0 * th + p3));
  return length(vec2(d.x, dyy)) - R;
}
// the same blob's radius toward the light (the upper left, where its glint sits): one size for the whole glint
float blobRL(float r, float a2, float p2, float a3, float p3) {
  const float TH = -2.2703;   // (atan(-0.42 / 0.93, -0.38): the glint point's angle, as blob measures it)
  return r * (1.0 + a2 * sin(2.0 * TH + p2) + a3 * sin(3.0 * TH + p3));
}

// ---------------------------------------------------------------- runners (at most 12 near a pixel)
const int NR = 12;
struct Run { vec4 a; vec4 b; vec4 c; vec4 d; };   // a: colx y0 V sNow; b: w1 w2 dist slant; c: ph1 ph2 ph3 r0; d: xh yh rh fade
// (the pass keeps only where its runners are in pre-pass 1's texture and fetches them: a local array of 12 runners slowed every px)
#if PRE == 0 && INLINE == 0
#define FETCH 1
ivec2 Rt[NR]; int nR = 0;
Run runOf(int i) {
  ivec2 t = Rt[i]; Run q;
  q.a = texelFetch(uRun, t, 0); q.b = texelFetch(uRun, t + ivec2(0, 1), 0); q.c = texelFetch(uRun, t + ivec2(0, 2), 0); q.d = texelFetch(uRun, t + ivec2(0, 3), 0);
  return q;
}
float movOf(int i) { return texelFetch(uRun, Rt[i] + ivec2(0, 4), 0).x; }
int keyOf(int i) { return int(texelFetch(uRun, Rt[i] + ivec2(0, 4), 0).y); }
#else
#define FETCH 0
Run R_[NR];
float Rmov[NR]; int Rkey[NR]; int nR = 0;
Run runOf(int i) { return R_[i]; }
float movOf(int i) { return Rmov[i]; }
int keyOf(int i) { return Rkey[i]; }
#endif
float yOf(Run q, float s) {
  float y = q.a.y + q.a.z * (s - 0.55 * sin(q.b.x * s) / q.b.x - 0.33 * sin(q.b.y * s) / q.b.y);
  return min(y, q.a.y + q.b.z);
}
float xOf(Run q, float y) {
  return q.a.x + 3.0 * sin(y * 0.045 + q.c.x) + 1.5 * sin(y * 0.13 + q.c.y) + 0.6 * sin(y * 0.41 + q.c.z) + q.b.w * (y - q.a.y);
}
// seconds since the head passed height y (1e9 where it has not)
float ageAt(Run q, float y) {
  if ( y < q.a.y || y > q.d.y ) return 1e9;
  float g = (y - q.a.y) / q.a.z, lo = max(0.0, g - 0.18), hi = min(q.a.w, g + 0.18);
  for ( int i = 0; i < 7; i++ ) { float m = 0.5 * (lo + hi); if ( yOf(q, m) < y ) lo = m; else hi = m; }
  return q.a.w - 0.5 * (lo + hi);
}
#if !FETCH
void runner(int layer, int ci, float Wc, float off, int seed) {
  if ( nR >= NR ) return;
  float hk = hu(ci, layer, seed);
  float kk = hk < 0.6667 ? 1.0 : 2.0, L, tau; int c;
  cycle(ci, layer, seed, kk, L, c, tau);
  int key = ci * 37 + c;
  float h[12];
  for ( int q = 0; q < 12; q++ ) h[q] = hu(key, layer, seed + 10 + q);
  float colx = off + (float(ci) + 0.5) * Wc + (h[0] - 0.5) * Wc * 0.4;
  if ( h[1] > (0.4 + 0.6 * dens(vec2(colx, uLens.y * 0.5)) * intensityAgo(tau)) * uRainA.z ) return;
  float y0 = -4.0 + h[2] * uLens.y * 0.62, r0 = 3.6 + 5.0 * pow(h[3], 0.8), ta = 0.5 + 1.8 * h[4];
  bool stall = h[5] > 0.8;
  float dist = stall ? 22.0 + 70.0 * h[6] : uLens.y + 24.0 - y0;
  float runT = L - ta - 1.3, V = 20.0 + 60.0 * pow(h[7], 1.5);
  if ( !stall ) V = max(V, dist / max(runT, 0.4) * 1.15);
  Run q;
  q.a = vec4(colx, y0, V, max(0.0, tau - ta));
  q.b = vec4(PI2 / (0.35 + 0.5 * h[8]), PI2 / (0.9 + 0.8 * h[9]), dist, uSlant * (0.7 + 0.6 * h[9]));
  q.c = vec4(h[10] * 6.28, h[11] * 6.28, h[8] * 6.28, r0);
  float yh = yOf(q, q.a.w), prog = min(1.0, (yh - y0) / 160.0), grow = 0.4 + 0.6 * ss(0.0, ta, tau), fade = 1.0 - ss(L - 1.2, L, tau);
  q.d = vec4(0.0, yh, r0 * grow * (1.0 - 0.32 * prog) * (0.25 + 0.75 * fade), fade);
  q.d.x = xOf(q, yh);
  R_[nR] = q; Rmov[nR] = (q.a.w > 0.0 && yh < y0 + dist - 0.5) ? 1.0 : 0.0; Rkey[nR] = key * 2 + layer;
  nR++;
}
#endif
// a runner made by pre-pass 1 (the same for every px of the step: made once per column, not per px)
void runnerAt(int layer, int ci) {
  if ( nR >= NR ) return;
  int x = ci - (layer == 0 ? uRunC0.x : uRunC0.y), y = layer * 5;
  if ( x < 0 || x >= textureSize(uRun, 0).x ) return;
  vec4 e = texelFetch(uRun, ivec2(x, y + 4), 0);
  if ( e.z < 0.5 ) return;
#if FETCH
  Rt[nR] = ivec2(x, y); nR++;
#else
  Run q;
  q.a = texelFetch(uRun, ivec2(x, y), 0); q.b = texelFetch(uRun, ivec2(x, y + 1), 0);
  q.c = texelFetch(uRun, ivec2(x, y + 2), 0); q.d = texelFetch(uRun, ivec2(x, y + 3), 0);
  R_[nR] = q; Rmov[nR] = e.x; Rkey[nR] = int(e.y); nR++;
#endif
}
// the runners whose column can reach this pixel (path wobble 5.1 px, slant over the run, 22 px of influence)
void gather(vec2 p) {
  for ( int layer = 0; layer < 2; layer++ ) {
    float Wc = layer == 0 ? 36.0 : 53.0, off = layer == 0 ? 0.0 : 13.0; int seed = layer == 0 ? 700 : 760;
    float a = max(-14.0, p.y - 0.62 * uLens.y + 4.0), b = p.y + 4.0;
    float s1 = uSlant * 0.7, s2 = uSlant * 1.3;
    float lo = min(min(s1 * a, s2 * a), min(s1 * b, s2 * b)), hi = max(max(s1 * a, s2 * a), max(s1 * b, s2 * b));
    float x0 = p.x - 27.1 - hi, x1 = p.x + 27.1 - lo;
    int c0 = int(floor((x0 - off) / Wc - 0.7)), c1 = int(floor((x1 - off) / Wc - 0.3));
#if INLINE
    for ( int ci = c0; ci <= c1 && ci <= c0 + 7; ci++ ) runner(layer, ci, Wc, off, seed);
#else
    for ( int ci = c0; ci <= c1 && ci <= c0 + 7; ci++ ) runnerAt(layer, ci);
#endif
  }
}

// ---------------------------------------------------------------- the drop field at p
float sdf = 1e3, best = 1e3, dR = 1.0;
vec2 dc = vec2(0.0);
// the GLINT (the light caught on a drop of radius R at c): a crescent along its rim toward the light (upper left), its size growing
// with the drop, white-hot at its core and cooler at its soft edge, which reaches exactly zero; the brightest glint at p wins
vec2 P_ = vec2(0.0); float G_ = 0.0; vec3 Gc_ = vec3(0.0);
void glint(vec2 c, float R) {
  vec2 h = -vec2(0.38, 0.42) * R, e = P_ - c - h;
  if ( abs(e.x) > 2.5 || abs(e.y) > 2.5 ) return;   // (its reach: 1.5 x 1.5 lens px)
  // (the size and roundness the glints had when the sprite drew them, each the brightest of the lens px around it: a little larger
  // and rounder than one crescent)
  float rh = length(h), a = 1.15 * clamp(0.4 * R, 0.85, 1.3), b = a * 0.75;
  // along the rim (tt) and across it (rr), bent to a circle of radius Rc: the drop's own curve on a big drop, a gentler one on a
  // small drop (bent to its own small radius the glint would hook)
  vec2 rd = h / rh, td = vec2(-rd.y, rd.x);
  float Rc = max(rh, 2.5 * a), tt = dot(e, td), rr = dot(e, rd) + tt * tt / (2.0 * Rc);
  float s = sqrt((tt / a) * (tt / a) + (rr / b) * (rr / b));
  if ( s >= 1.5 ) return;
  // a hot core (full to 0.45 of the size, soft to 1) and a faint bloom to 1.5 that ends at exactly zero
  float core = 1.0 - smoothstep(0.45, 1.0, s), bloom = (1.0 - s / 1.5) * (1.0 - s / 1.5), g = 0.8 * core + 0.16 * bloom * (1.0 - core);
  if ( g > G_ ) { G_ = g; Gc_ = mix(vec3(0.80, 0.88, 1.0), vec3(1.0, 0.99, 0.95), core); }
}
void put(float s, float R, vec2 c, float Rg) {
  if ( Rg >= 1.25 ) glint(c, Rg);
  if ( s < best ) { best = s; dc = c; dR = R; }
  sdf = smin(sdf, s, 1.3);
}

// ---------------------------------------------------------------- composing on the glass: the frame becomes dst x K + A
vec3 A_ = vec3(0.0); float K_ = 1.0, S_ = 0.0;   // (S_: the share of the refracted frame added by the lens sprite)
void over(float k, vec3 a) { A_ = A_ * k + a; K_ *= k; S_ *= k; }
// the same over a share c of the px (a shape's antialiased coverage)
void overC(float c, float k, vec3 a) { if ( c > 0.0 ) over(1.0 - c * (1.0 - k), a * c); }
// items scattered by cells of C lens px (count per reference lens area 427 x 240: the same density on any screen and DPR)
const float REF = 102480.0;
float slotsOf(float perRef, float C) { return perRef * C * C / REF; }
bool slotOn(int j, float e, ivec2 ce, int sd) {
  if ( float(j) >= ceil(e) ) return false;
  return float(j) < floor(e) || hu(ce.x * 7 + j, ce.y, sd) < fract(e);
}
// one cycle among the given counts per 10 s (absolute cycle index: no short loop)
void cyc4(int kx, int ky, int sd, vec4 ks, out float L, out int c, out float tau) {
  float h = hu(kx, ky, sd);
  float kk = h < 0.25 ? ks.x : h < 0.5 ? ks.y : h < 0.75 ? ks.z : ks.w;
  cycle(kx, ky, sd, kk, L, c, tau);
}
// the wind's along / across coordinates of p (0..1 across the glass along the wind: 0 = the side the wind comes from)
float upwind(vec2 p) { return dot(p / uLens - 0.5, uWind.xy) + 0.5; }
// specks scattered by cells of C lens px (one in a cell with the chance pr, kept inside its cell): the nearest one's offset from p,
// its cell's hash key; false when p's cell has none
bool speck(vec2 p, float C, float pr, int sd, out vec2 e, out ivec2 ce) {
  ce = ivec2(floor(p / C));
  if ( hu(ce.x, ce.y, sd) >= pr ) return false;
  e = p - (vec2(ce) + 0.5 + (vec2(hu(ce.x, ce.y, sd + 1), hu(ce.x, ce.y, sd + 2)) - 0.5) * 0.45) * C;
  return true;
}

// ---------------- SNOW: frost from the edges (cells of a jittered 13-px grid), crystals landing and melting into beads
float frostProg() {
  return (uSnowL.x + uSnowL.y * sin(PI2 * uT / 30.0) + 0.012 * sin(PI2 * uT / 10.0 + 1.0)) * uSnowL.w;
}
// the frost at q: reach - progress (< 0: frosted), the cell hash, the crack measure (the gap to the second-nearest cell: under 1.1 on
// the cells' borders)
float frostAt(vec2 q, float prog, out float fid, out float crack) {
  ivec2 c0 = ivec2(floor(q / 13.0));
  float d1 = 1e9, d2 = 1e9; ivec2 id = c0;
  for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) {
    ivec2 c = c0 + ivec2(i, j);
    vec2 sp = vec2(c) * 13.0 + vec2(hu(c.x * 13, c.y * 13, 401), hu(c.x * 13, c.y * 13 + 1, 402)) * 12.0;
    float d = length(q - sp);
    if ( d < d1 ) { d2 = d1; d1 = d; id = c; } else d2 = min(d2, d);
  }
  fid = hu(id.x, id.y, 403);
  crack = d2 - d1;
  float ex = min(q.x, uLens.x - q.x) / uLens.x, ey = min(q.y, uLens.y - q.y) / uLens.y;
  float reach = 0.55 * min(ex * 1.6, ey) + 0.45 * length(vec2(ex, ey)) + fid * 0.07 + (fbm3(vec2(q.x / 37.0, q.y / 29.0), 777) - 0.5) * 0.09
    + (vnoise(q * 0.9, 404) - 0.5) * 0.016;   // (the frost's edge ragged at the fine scale, smooth: a hash per lens px made steps)
  return reach - prog;
}
void frost(vec2 p) {
  float prog = frostProg();
  if ( prog <= 0.0 ) return;
  float fid, ck;
  float r = frostAt(p, prog, fid, ck), dn = clamp(-r / 0.08, 0.0, 1.0);
  // (every edge antialiased over one px of the pass: the frost's edge, its density steps, the cracks)
  float fw = max(fwidth(r), 1e-6), dw = max(fwidth(dn), 1e-6), cw = max(fwidth(ck), 1e-3);
  float fc = clamp(0.5 - r / fw, 0.0, 1.0), crack = clamp((1.1 - ck) / cw + 0.5, 0.0, 1.0);
  if ( fc > 0.0 ) {
    float tn = floor(hu(int(fid * 1e6), 1, 405) * 3.0);
    vec3 ice = tn < 0.5 ? vec3(0.72, 0.80, 0.90) : tn < 1.5 ? vec3(0.82, 0.88, 0.95) : vec3(0.90, 0.94, 0.99);
    ice = mix(ice, vec3(0.97, 0.99, 1.0), crack);
    float K = 0.32 + 0.2 * clamp((dn - 0.33) / dw + 0.5, 0.0, 1.0) + 0.2 * clamp((dn - 0.66) / dw + 0.5, 0.0, 1.0);
    overC(fc, 1.0 - K, ice * K * uLight);
    // a glint: a soft sparkle on the ice now and then (cells of 3 lens px, at most one each)
    vec2 e; ivec2 ce;
    if ( speck(p, 3.0, 1.0, 900 + int(floor(uT * 5.0)) * 3, e, ce) && hu(ce.x, ce.y, 907 + int(floor(uT * 5.0))) < 0.036 )
      overC(fc * soft(e, 0.75), 0.0, vec3(uLight));
  }
  if ( fc < 1.0 && crack > 0.0 && hu(int(fid * 1e6), 2, 406) < 0.6 )   // feathers ahead
    overC((1.0 - fc) * crack * clamp((0.035 - r) / fw + 0.5, 0.0, 1.0), 0.4, 0.6 * vec3(0.9, 0.95, 1.0) * uLight);
}
// crystals (cells of 64 px, 2 slots), drawn over everything; their melt beads go into the drop field
vec3 star = vec3(0.0);   // the coverage of a crystal's halo, arms, core (antialiased)
void crystals(vec2 p) {
  float e = slotsOf(uSnowL.z * uSnowL.w, 64.0);
  if ( e <= 0.0 ) return;
  ivec2 ce = ivec2(floor(p / 64.0));
  float prog = frostProg();
  for ( int j = 0; j < 3; j++ ) {
    if ( !slotOn(j, e, ce, 420) ) continue;
    int key = (ce.x * 64 + ce.y) * 4 + j;
    float L, tau; int c;
    cyc4(key, 0, 410, vec4(1.0, 2.0, 2.0, 3.0), L, c, tau);
    float h[6];
    for ( int q = 0; q < 6; q++ ) h[q] = hu(key * 31 + c, 1, 411 + q);
    vec2 x = vec2(ce) * 64.0 + vec2(10.0 + 44.0 * h[0], 10.0 + 38.0 * h[1]);
    float R0 = 3.0 + 4.5 * h[2], hold = 0.5 + 1.4 * h[3];
    vec2 d = p - x;
    if ( abs(d.x) > 10.0 || d.y < -10.0 || d.y > 16.0 ) continue;
    float fid, cr;
    bool inf = prog > 0.0 && frostAt(x, prog, fid, cr) < 0.0;
    float melt = inf ? 0.0 : ss(hold, hold + 1.2, tau), gone = ss(L - 0.8, L, tau);
    // lands: grows from a speck over 0.3 s (a little overshoot), then holds; melts or fades by shrinking
    float land = ss(0.0, 0.3, tau) * (1.0 + 0.15 * (1.0 - ss(0.3, 0.6, tau)));
    float R = R0 * land * (1.0 - melt) * (1.0 - gone);
    // the core: a small soft bright point (in whole lens px it was a white square)
    if ( R > 0.4 ) star.z = max(star.z, soft(d, 0.8) * ss(0.4, 0.6, R));
    if ( R > 0.8 ) {
      float m = 9.0;
      for ( int a = 0; a < 6; a++ ) {
        float ang = h[4] * 1.05 + float(a) * 1.0471976;
        vec2 dir = vec2(cos(ang), sin(ang));
        m = min(m, segD(p, x, dir, R));
        if ( R >= 3.0 ) for ( int sd = -1; sd <= 1; sd += 2 )
          m = min(m, segD(p, x + dir * R * 0.55, vec2(cos(ang + float(sd) * 1.05), sin(ang + float(sd) * 1.05)), R * 0.35));
      }
      star.xy = max(star.xy, vec2(cov(m - 1.5), cov(m - 0.55)));
    }
    float rb = (0.9 + 1.6 * h[5]) * melt * (1.0 - gone);
    if ( rb >= 0.35 ) {
      vec2 b = x + vec2(0.0, 0.6 * max(0.0, tau - hold - 1.2) * melt);
      float RR, s = blob(p, b, rb, 0.1, h[4] * 6.0, 0.06, h[3] * 6.0, 1.0, RR);
      put(s, RR, b, blobRL(rb, 0.1, h[4] * 6.0, 0.06, h[3] * 6.0));
    }
  }
}

// ---------------- SAND: a deposit film (wind side, lower edge), scratches catching the light, grit impacts (flash -> chipped pit)
void sandLens(vec2 p) {
  float pr = uSandL.w; if ( pr <= 0.0 ) return;
  vec2 wd = uWind.xy, q = p;
  float fr = clamp(gAgo(0.0), 0.0, 1.0);
  float side = 1.0 - clamp(upwind(p) / 0.45, 0.0, 1.0);
  float al = dot(q, wd), ac = -q.x * wd.y + q.y * wd.x;
  float dep = clamp(0.55 * side + 0.65 * ss(0.55, 1.0, p.y / uLens.y) + 0.35 * (fbm3(vec2(al / 18.0, ac / 9.0), 530) - 0.5)
    + 0.25 * (fbm2(vec2(al / 60.0, ac / 30.0), 531) - 0.5), 0.0, 1.0);
  float lvl = dep * (0.30 + 0.25 * clamp(gAgo(1.5), 0.0, 1.0)) * uSandL.x;
  // grains: one per lens-px cell with the chance lvl (darker ones under lvl x 0.55), each a small round grain anywhere in its cell
  // (the 4 cells that can reach p; a grain in a whole lens px was a square)
  if ( lvl > 0.0 ) {
    vec2 gc = floor(p - 0.5); float g1 = 0.0, g2 = 0.0;
    for ( int j = 0; j < 2; j++ ) for ( int i = 0; i < 2; i++ ) {
      ivec2 c = ivec2(gc) + ivec2(i, j);
      float gr = hu(c.x, c.y, 532);
      if ( gr >= lvl ) continue;
      vec2 e = p - vec2(c) - vec2(hu(c.x, c.y, 533), hu(c.x, c.y, 534));
      float a = cov(length(e) - 0.5 - 0.1 * hu(c.x, c.y, 535));
      if ( gr < lvl * 0.55 ) g1 = max(g1, a); else g2 = max(g2, a);
    }
    overC(g2 * (1.0 - g1), 0.72, 0.28 * vec3(0.84, 0.70, 0.48) * uLight);
    overC(g1, 0.45, 0.55 * vec3(0.80, 0.66, 0.44) * uLight);
  }
  // scratches (cells of 64, 2 slots; along the wind)
  float es = slotsOf(uSandL.y, 64.0), wa = atan(wd.y, wd.x);
  ivec2 ce = ivec2(floor(p / 64.0));
  float scr = 0.0;
  for ( int j = 0; j < 3; j++ ) {
    if ( !slotOn(j, es, ce, 506) ) continue;
    int key = (ce.x * 64 + ce.y) * 4 + j;
    if ( hu(key, 5, 505) > (0.3 + 0.6 * fr) ) continue;
    vec2 a = vec2(ce) * 64.0 + 16.0 + 32.0 * vec2(hu(key, 1, 501), hu(key, 2, 502));
    float ln = 4.0 + 12.0 * hu(key, 3, 503), an = wa + (hu(key, 4, 504) - 0.5) * 0.6;
    scr = max(scr, cov(segD(p, a, vec2(cos(an), sin(an)), ln) - 0.5));
  }
  overC(scr, 0.55, 0.45 * vec3(1.0, 0.93, 0.78) * uLight);
  // impacts (cells of 16, interior positions)
  float ei = slotsOf(uSandL.z * pr, 16.0);
  ivec2 ci = ivec2(floor(p / 16.0));
  if ( slotOn(0, ei, ci, 525) ) {
    int key = ci.x * 4096 + ci.y;
    float L, tau; int c;
    cyc4(key, 0, 520, vec4(2.0, 3.0, 4.0, 5.0), L, c, tau);
    int kc = key * 17 + c;
    if ( hu(kc, 1, 521) <= 0.08 + 0.85 * clamp(gAgo(tau), 0.0, 1.0) ) {
      vec2 x = vec2(ci) * 16.0 + 2.5 + 12.0 * vec2(hu(kc, 2, 522), hu(kc, 3, 523));
      vec2 d = p - x, ad = abs(d);
      // the hit: a small four-pointed flash, then a point; then the chipped pit, a faint lit point with a brighter chip at its upper
      // right (soft round shapes: in whole lens px they were a cross of squares and squares)
      if ( tau < 1.0 / 12.0 ) {
        float arm = max((1.0 - ss(1.0, 1.7, ad.x)) * (1.0 - ss(0.2, 0.55, ad.y)), (1.0 - ss(1.0, 1.7, ad.y)) * (1.0 - ss(0.2, 0.55, ad.x)));
        overC(max(soft(d, 1.0), arm), 0.0, vec3(1.0, 0.98, 0.88) * uLight);
      } else if ( tau < 2.0 / 12.0 ) overC(soft(d, 0.85), 0.0, vec3(1.0, 0.92, 0.70) * uLight);
      else if ( tau < L - 0.4 && hu(kc, 4, 524) < 0.6 ) {
        overC(soft(d, 0.8), 0.8, 0.2 * vec3(1.0, 0.95, 0.80) * uLight);   // (the pit catches the light: a dark one read as a hole)
        overC(soft(d - vec2(1.0, -1.0), 0.75), 0.4, 0.6 * vec3(1.0, 0.95, 0.80) * uLight);
      }
    }
  }
}

// ---------------- DUST (ambient): veiling glare + flare ghosts from a low sun, dust discs and specks on the glass, a smudge
void dustLens(vec2 p) {
  float pr = uDustL2.z; if ( pr <= 0.0 ) return;
  float sc = uLens.x / 427.0, w = PI2 / 40.0;
  float glare = (0.55 + 0.3 * sin(w * uT - 1.0) + 0.1 * sin(2.0 * w * uT + 0.7)) * pr;
  vec2 sun = (vec2(-40.0, -30.0) + vec2(6.0 * sin(w * uT), 4.0 * sin(w * uT + 1.2))) * sc;
  float d = length(vec2(p.x - sun.x, (p.y - sun.y) * 1.1)) / (260.0 * sc) + 0.06 * (fbm2(p / (40.0 * sc), 607) - 0.5);
  // (the glare's steps, antialiased over one px of the pass: in whole lens px their edges were stairs)
  float dw = max(fwidth(d), 1e-6);
  float lv = 0.05 * clamp((0.45 * glare + 0.1 - d) / dw + 0.5, 0.0, 1.0) + 0.05 * clamp((0.30 * glare + 0.05 - d) / dw + 0.5, 0.0, 1.0)
    + 0.06 * clamp((0.16 * glare - d) / dw + 0.5, 0.0, 1.0);
  vec3 add = lv * uDustL.z * vec3(1.0, 0.92, 0.72);
  // ghosts along the axis sun -> centre -> beyond; ghost j weighs clamp(count - j, 0, 1), so a whole count draws the old ghosts at
  // weight 1.0 exactly and a fractional one fades the next ghost in
  vec2 ax = uLens * 0.5 - sun;
  for ( int j = 0; j < 5; j++ ) {
    float gw = clamp(uDustL.w - float(j), 0.0, 1.0);
    if ( gw <= 0.0 ) break;
    float f = j == 0 ? 0.55 : j == 1 ? 1.15 : j == 2 ? 1.45 : j == 3 ? 1.9 : 2.2;
    float rad = (j == 0 ? 9.0 : j == 1 ? 16.0 : j == 2 ? 6.0 : j == 3 ? 24.0 : 4.0) * sc;
    vec3 col = j == 0 ? vec3(0.9, 0.8, 0.5) : j == 1 ? vec3(0.55, 0.9, 0.6) : j == 2 ? vec3(0.8, 0.6, 1.0) : j == 3 ? vec3(0.9, 0.7, 0.5) : vec3(1.0, 0.95, 0.8);
    vec2 e = p - (sun + ax * f);
    float r = length(e);
    if ( j == 1 || j == 3 ) { float a = mod(abs(atan(e.y, e.x)), 1.0471976) - 0.5235988; r = r * cos(a) / 0.8660254; }
    float inG = cov(r - rad) * gw;
    if ( inG > 0.0 ) add += col * uDustL2.x * glare * inG * (1.0 + 1.2 * cov(rad - 1.0 - r));
  }
  over(1.0, add * uLight);
  // out-of-focus dust discs (cells of 48)
  float ed = slotsOf(uDustL.y * pr, 48.0);
  ivec2 ce = ivec2(floor(p / 48.0));
  for ( int j = 0; j < 2; j++ ) {
    if ( !slotOn(j, ed, ce, 615) ) continue;
    int key = (ce.x * 64 + ce.y) * 4 + j;
    float r = (3.0 + 6.0 * pow(hu(key, 3, 603), 2.0)) * sc;
    vec2 x = vec2(ce) * 48.0 + 10.0 + 28.0 * vec2(hu(key, 1, 601), hu(key, 2, 602));
    float dd = length(p - x);
    float ci = cov(dd - (r - 1.0));
    over(1.0, vec3(0.04) * uLight * ci); overC(cov(dd - r) - ci, 0.9, vec3(0.0));
  }
  // specks: sharp, glinting with the glare where the sun is close
  // (cells of 3 lens px, at most one speck each: a small soft point; in a whole lens px it was a square)
  vec2 se; ivec2 sk;
  if ( speck(p, 3.0, 0.036, 604, se, sk) && hu(sk.x, sk.y, 609) < uDustL.x * pr ) {
    float lit = clamp(1.0 - length(p - sun) / (420.0 * sc), 0.0, 1.0) * glare, sp = soft(se, 0.85);
    if ( hu(sk.x, sk.y, 900 + int(floor(uT * 3.0 + hu(sk.x, sk.y, 608) * 3.0))) < lit * 0.8 ) overC(sp, 0.0, vec3(1.0, 0.97, 0.86) * uLight);
    else overC(sp, 0.9, vec3(0.1) * uLight);   // (a dull speck: lighter, never a dark one)
  }
  // a smudge (fingerprint): only where the glare falls on it, ridges light up
  // (its edges soft: the oval, the patches and the ridges)
  float sm = uDustL2.y > 0.0 ? cov(length(vec2(p.x - 0.70 * uLens.x, (p.y - 0.29 * uLens.y) * 1.4)) - 70.0 * sc) : 0.0;
  if ( sm > 0.0 ) sm *= ss(0.59, 0.61, fbm3(vec2(p.x / 22.0, p.y / 16.0), 605));
  if ( sm > 0.0 ) {
    float ph = (p.x * 0.8 + p.y * 0.6) / 1.6 + 4.0 * fbm2(p / 30.0, 606), sv = sin(ph), sw = max(abs(cos(ph)) * 0.625 * uAA, 1e-3);
    sm *= clamp((sv - 0.55) / sw + 0.5, 0.0, 1.0);
    over(1.0, 0.10 * glare * uDustL2.y * sm * vec3(1.0, 0.95, 0.85) * uLight);
  }
}

// ---------------- HEAT (embers, optional): heat glow from the fire side, hot flecks that hit the glass and cool to ash
void heatLens(vec2 p) {
  float pr = uHeatL.z; if ( pr <= 0.0 ) return;
  float g = clamp(gAgo(0.0), 0.0, 1.2), uw = upwind(p);
  float f = (1.0 - uw / 0.5) * (0.7 + 0.35 * g) + 0.12 * (fbm2(vec2(p.x / 25.0 - mod(uT, 600.0) * 0.4, p.y / 25.0), 701) - 0.5);
  float fw = max(fwidth(f), 1e-6);   // (the glow's steps antialiased over one px of the pass)
  float lv = 0.05 * clamp((f - 0.25) / fw + 0.5, 0.0, 1.0) + 0.05 * clamp((f - 0.5) / fw + 0.5, 0.0, 1.0) + 0.06 * clamp((f - 0.75) / fw + 0.5, 0.0, 1.0);
  over(1.0, lv * uHeatL.x * vec3(1.0, 0.55, 0.2) * uLight);
  float ef = slotsOf(uHeatL.y * pr, 48.0);
  ivec2 ce = ivec2(floor(p / 48.0));
  if ( upwind((vec2(ce) + 0.5) * 48.0) > 0.7 || !slotOn(0, ef / 0.7, ce, 730) ) return;
  int key = ce.x * 4096 + ce.y;
  float L, tau; int c;
  cyc4(key, 0, 720, vec4(1.0, 2.0, 1.0, 2.0), L, c, tau);
  int kc = key * 11 + c;
  if ( hu(kc, 1, 721) > 0.45 + 0.4 * clamp(gAgo(tau), 0.0, 1.2) || tau > L - 0.5 ) return;
  vec2 x = vec2(ce) * 48.0 + 4.0 + 36.0 * vec2(hu(kc, 1, 722), hu(kc, 1, 723));
  vec2 d = p - x;
  // the hit: a soft hot flash; then a small round fleck that cools (yellow, orange, red, ash), some sliding down a little, with a
  // faint warm glow around it while hot (round and soft: in whole lens px the flash was a block, the fleck and its glow squares)
  if ( tau < 1.0 / 12.0 ) { overC(1.0 - ss(0.9, 2.1, length(d)), 0.0, vec3(1.0, 0.97, 0.80) * uLight); return; }
  float ci = 1.0 + min(3.0, floor(tau / 0.5));
  float sl = hu(kc, 1, 725) > 0.6 ? min(1.5, tau * 1.5) : 0.0;   // (a smooth slide that stays: stepped, it jumped back up)
  vec2 e = d - vec2(0.0, sl);
  vec3 E = ci < 1.5 ? vec3(1.0, 0.82, 0.30) : ci < 2.5 ? vec3(1.0, 0.54, 0.14) : ci < 3.5 ? vec3(0.80, 0.26, 0.10) : vec3(0.30, 0.22, 0.20);
  float fl = soft(e, 0.85);
  if ( ci <= 2.0 ) over(1.0, 0.10 * (1.0 - ss(1.2, 3.8, length(e))) * (1.0 - fl) * vec3(1.0, 0.5, 0.15) * uLight);
  overC(fl, 0.0, E * uLight);
}

// the bead of 8-px cell (CX, CY) at this step: its centre, radius, lobes, age, cycle key, radius toward the light; false: none (or
// wiped by a runner that passed after it formed, or merged into a head). Made once per cell by pre-pass 2.
// (own: the runners near the bead itself; else those already gathered for this px)
bool beadOf(int CX, int CY, bool own, out vec2 b, out vec4 sh, out float tau, out int key, out float Rg) {
  float hk = hu(CX, CY, 300), kk = hk < 0.2 ? 1.0 : hk < 0.6 ? 2.0 : hk < 0.8 ? 3.0 : 4.0, L; int c;
  cycle(CX, CY, 300, kk, L, c, tau);
  key = CX * 131 + c;
  if ( hu(key, CY, 312) >= uRainA.x * 1.3 ) return false;                       // (cheap pre-test: dens x I <= 1)
  b = (vec2(CX, CY) + 0.5 + (vec2(hu(key, CY, 310), hu(key, CY, 311)) - 0.5) * 0.9) * G;
  if ( hu(key, CY, 312) >= dens(b) * intensityAgo(tau) * 1.3 * uRainA.x ) return false;
  float big = kk <= 2.0 ? uRainA.y : 1.2;
  float r = 0.5 + big * pow(hu(key, CY, 313), 2.6);
  r *= (0.6 + 0.4 * ss(0.0, 0.6, tau)) * (1.0 - ss(L - 0.7, L, tau));
  if ( r > 2.4 ) b.y += 0.5 * tau;
  bool splat = tau < 0.2 && r > 1.0;
  float a2 = 0.05 + 0.16 * hu(key, CY, 314) + (splat ? 0.25 : 0.0), a3 = 0.04 + 0.12 * hu(key, CY, 315) + (splat ? 0.15 : 0.0);
  if ( splat ) r *= 1.35;
  if ( r <= 0.35 ) return false;
  if ( own ) { nR = 0; if ( uRainA.z > 0.0 ) gather(b); }
  for ( int i = 0; i < NR; i++ ) {
    if ( i >= nR ) break;
    Run q = runOf(i);
    if ( abs(b.x - xOf(q, b.y)) < q.c.w * 0.85 + r * 0.5 && ageAt(q, b.y) < tau ) return false;
    if ( length(b - q.d.xy) < q.d.z + r * 0.6 ) return false;
  }
  sh = vec4(r, a2, a3, 0.0);
  Rg = blobRL(r, a2, hu(key, CY, 316) * 6.28, a3, hu(key, CY, 317) * 6.28);
  return true;
}

// the bead of a cell for the pass: made by pre-pass 2 (or here, without float targets)
bool beadAt(int CX, int CY, out vec2 b, out vec4 sh, out float tau, out int key, out float Rg) {
#if INLINE
  return beadOf(CX, CY, false, b, sh, tau, key, Rg);
#else
  ivec2 t = ivec2(CX - uCell0.x, (CY - uCell0.y) * 3), bs = textureSize(uBead, 0);
  if ( t.x < 0 || t.y < 0 || t.x >= bs.x || t.y + 2 >= bs.y ) return false;
  vec4 e = texelFetch(uBead, t + ivec2(0, 2), 0);
  if ( e.y < 0.5 ) return false;
  vec4 A = texelFetch(uBead, t, 0), B = texelFetch(uBead, t + ivec2(0, 1), 0);
  b = A.xy; sh = vec4(A.z, A.w, B.x, 0.0); tau = B.w; key = int(e.x); Rg = e.z;
  return true;
#endif
}

#if PRE == 1
// PRE-PASS 1: one runner per texel column (layer, column index), 5 rows each
void main() {
  ivec2 ip = ivec2(floor(vP));
  int layer = ip.y / 5, k = ip.y - layer * 5, ci = ip.x + (layer == 0 ? uRunC0.x : uRunC0.y);
  nR = 0;
  runner(layer, ci, layer == 0 ? 36.0 : 53.0, layer == 0 ? 0.0 : 13.0, layer == 0 ? 700 : 760);
  Run q = R_[0];
  fragColor = nR == 0 ? vec4(0.0) : k == 0 ? q.a : k == 1 ? q.b : k == 2 ? q.c : k == 3 ? q.d : vec4(Rmov[0], float(Rkey[0]), 1.0, 0.0);
  dispColor = vec4(0.0);
}
#elif PRE == 2
// PRE-PASS 2: one bead per texel column (the cell's x), 3 rows per cell
void main() {
  ivec2 ip = ivec2(floor(vP));
  int cy = ip.y / 3, k = ip.y - cy * 3;
  vec2 b; vec4 sh; float tau, Rg; int key;
  bool on = beadOf(ip.x + uCell0.x, cy + uCell0.y, true, b, sh, tau, key, Rg);
  fragColor = !on ? vec4(0.0) : k == 0 ? vec4(b, sh.x, sh.y) : k == 1 ? vec4(sh.z, 0.0, 0.0, tau) : vec4(float(key), 1.0, Rg, 0.0);
  dispColor = vec4(0.0);
}
#else
void main() {
  vec2 p = vP;   // (continuous: every shape is drawn per px of this pass, never in whole lens px)
  P_ = p;
  if ( uSnowL.w > 0.0 ) { frost(p); crystals(p); }
  vec3 A0 = A_; float K0 = K_;
  A_ = vec3(0.0); K_ = 1.0;
  if ( uRainA.z > 0.0 ) gather(p);
  // static beads (pre-pass 2): this cell and the 8 around it
  float sat = 0.0;
  ivec2 cp = ivec2(floor(p / G));
  for ( int dy = -1; dy <= 1; dy++ ) for ( int dx = -1; dx <= 1; dx++ ) {
    int CX = cp.x + dx, CY = cp.y + dy;
    vec2 b; vec4 sh; float tau, Rg; int key;
    if ( !beadAt(CX, CY, b, sh, tau, key, Rg) ) continue;
    float r = sh.x, R, s = blob(p, b, r, sh.y, hu(key, CY, 316) * 6.28, sh.z, hu(key, CY, 317) * 6.28, 1.14, R);
    put(s, R, b, Rg);
    // satellites of a fresh splat: 3-5 small soft specks thrown around, gone after 0.35 s
    if ( tau < 0.35 && r > 1.2 ) {
      float ns = 3.0 + 2.0 * hu(key, CY, 318);
      for ( int j = 0; j < 5; j++ ) {
        if ( float(j) >= ns ) break;
        float ang = hu(key * 7 + j, CY, 330) * 6.28, dd = (1.7 + 1.3 * hu(key * 7 + j, CY, 331)) * r;
        sat = max(sat, soft(p - b - vec2(cos(ang), sin(ang) * 0.9) * dd, 0.8));
      }
    }
  }
  // runners: head (teardrop), the wet trail + its lit edge, trail beads, the cleared film
  float wet = 0.0, lit = 0.0, clear = 0.0;
  for ( int i = 0; i < NR; i++ ) {
    if ( i >= nR ) break;
    Run q = runOf(i);
    float r0 = q.c.w, rh = q.d.z, fade = q.d.w; bool mv = movOf(i) > 0.5;
    int rk = keyOf(i);
    if ( rh > 0.4 && q.d.y > -10.0 && q.d.y < uLens.y + 10.0 && abs(p.y - q.d.y) < rh * 3.2 + 2.0 ) {
      float st = mv ? 1.22 : 1.0, R1, R2;
      float s1 = blob(p, q.d.xy, rh, 0.06, q.c.x, 0.05, q.c.y, 1.05 * st, R1);
      float yn = q.d.y - rh * 0.95;
      float s2 = blob(p, vec2(xOf(q, yn), yn), rh * (mv ? 0.55 : 0.75), 0.05, 0.0, 0.0, 0.0, 1.14, R2);
      put(smin(s1, s2, 1.6), rh, q.d.xy, rh);
    }
    float px = xOf(q, p.y), dxp = p.x - px;
    if ( abs(dxp) > r0 + 6.0 ) continue;
    float age = ageAt(q, p.y);
    bool fresh = age < 1e8 && p.y < q.d.y - rh * 0.6;
    float wide = 0.55 + 0.10 * r0, br = clamp((age - 0.7) / 1.6, 0.0, 1.0);
    if ( fresh && fade > 0.3 ) {
      // THE WET TRAIL: a thin film of water left down the runner's path. Its width wavers along it; as it ages it pulls apart into
      // pieces (where a smooth noise along the path falls under the age); its edge toward the light catches a thin line of light,
      // broken here and there. All along the path, never per lens px (a hash per lens px made it a stair of 3 x 3 blocks).
      float ky = float(rk % 4096) * 5.0;
      float w = wide * (0.8 + 0.4 * vnoise(vec2(p.y / 2.6, ky), 341));
      float on = ss(br - 0.06, br + 0.06, 0.04 + 0.92 * vnoise(vec2(p.y / 1.9, ky), 340));
      wet = max(wet, cov(abs(dxp) - w) * on);
      float le = abs(dxp + w + 0.4);
      lit = max(lit, (1.0 - ss(0.12, 0.5, le)) * on * ss(0.36, 0.5, vnoise(vec2(p.y / 3.0, ky), 345)));
    }
    // (the cleared path fades out to its sides, so it never shows a straight-edged band)
    if ( fresh && abs(dxp) < r0 * 0.9 + 1.0 ) clear = max(clear, (1.0 - clamp(age / 4.0, 0.0, 1.0)) * fade * (1.0 - ss(r0 * 0.3, r0 * 0.9 + 1.0, abs(dxp))));
    // trail beads at jittered spacing (4.5-9 px) behind the head
    float j0 = floor((p.y - q.a.y) / 6.75);
    for ( int dj = -1; dj <= 1; dj++ ) {
      float j = j0 + float(dj);
      if ( j < 0.0 ) continue;
      int ij = int(j), k = rk;
      float yj = q.a.y + (j + 0.5) * 6.75 + (hu(ij, k, 354) - 0.5) * 2.2;
      if ( yj >= q.d.y - rh - 1.0 ) continue;
      float hj = hu(ij, k, 351);
      if ( hj < 0.12 ) continue;
      float a = ageAt(q, yj);
      if ( a < 0.25 + 0.45 * hj || a > 1e8 ) continue;
      float rj = (0.7 + 1.6 * pow(hu(ij, k, 352), 1.5)) * ss(0.3, 0.9, a - 0.3 * hj) * fade;
      if ( rj < 0.35 ) continue;
      vec2 cj = vec2(xOf(q, yj) + (hu(ij, k, 353) - 0.5) * 1.4, yj);
      float R, s = blob(p, cj, rj, 0.08, hj * 6.0, 0.05, hj * 3.0, 1.14, R);
      put(s, R, cj, blobRL(rj, 0.08, hj * 6.0, 0.05, hj * 3.0));
    }
  }
  // mist specks: fine droplets that come and go, each a small soft point (cells of 3 lens px, at most one each; one per lens px
  // made single squares)
  float mist = 0.0;
  if ( uRainA.w > 0.0 ) {
    ivec2 mc = ivec2(floor(p / 3.0));
    float hk = hu(mc.x, mc.y, 360), kk = hk < 0.3333 ? 1.0 : hk < 0.6667 ? 2.0 : 3.0, L, tau; int c;
    cycle(mc.x, mc.y, 360, kk, L, c, tau);
    vec2 mx = (vec2(mc) + 0.5 + (vec2(hu(mc.x * 13 + c, mc.y, 363), hu(mc.x * 13 + c, mc.y, 364)) - 0.5) * 0.45) * 3.0;
    if ( hu(mc.x * 13 + c, mc.y, 362) < 9.0 * uRainA.w * dens(mx) * intensityAgo(tau) )
      mist = soft(p - mx, 0.8) * (1.0 - ss(0.2, 0.4, clear));
  }

  // ---------------- shading: (add, k) -> the frame under this px becomes dst x k + add
  float ex = min(p.x, uLens.x - p.x) / (0.2 * uLens.x), ey = min(p.y, uLens.y - p.y) / (0.24 * uLens.y);
  float film = (0.09 + 0.13 * (1.0 - clamp(min(ex, ey), 0.0, 1.0))) * (1.0 - clear) * uFilm;
  vec3 add = film * vec3(0.78, 0.82, 0.88) * uLight; float k = 1.0 - film;
  // (each over the share of the px it covers)
  add = mix(add, vec3(0.03) * uLight, wet); k = mix(k, 0.86, wet);   // (the wet trail: a little darker)
  float lw = lit * (1.0 - wet);
  add = mix(add, vec3(0.12) * uLight, lw); k = mix(k, 0.92, lw);
  add = mix(add, vec3(0.12) * uLight, mist); k = mix(k, 1.0, mist);
  add = mix(add, vec3(0.16) * uLight, sat); k = mix(k, 0.9, sat);
  // A DROP is clear water over the frame: a BIG drop shows the frame under it magnified a little at the centre and pulled at the
  // edge (barrel-like), nudged up, with a thin darker rim on the lower / side edge, a faint lit top edge and a glint. The image is
  // not made here: this pass writes where it samples (dispColor) and the lens sprite fetches the FULL-RESOLUTION frame there. A SMALL
  // drop (radius under SMALL lens px) is only a faint soft lift and a glint over the frame. Every edge is antialiased over one px
  // of this pass (in whole lens px a drop's edge, a small drop's lift and a tiny drop were squares and stairs).
  float srcK = 0.0;
  // (no contact shadow under a drop: it read as a dark block)
  if ( sdf < uAA ) {
    vec2 n = (p - dc) / max(dR, 0.5);
    vec3 bAdd = vec3(0.0); float bK = 0.0, inC = cov(sdf);
    if ( dR < SMALL ) {
      // a small drop: a faint lift, fullest at its middle and fading out softly to its edge
      inC = 1.0 - ss(-0.45 * max(dR, 0.8), 0.5 * uAA, sdf);
      if ( dR < 1.25 ) { bAdd = vec3(0.07) * uLight; bK = 0.97; } else { bAdd = vec3(0.04) * uLight; bK = 1.0; }
    } else {
      float rim = 1.0 - cov(sdf + 1.0), low = clamp((n.y - 0.3) * dR / uAA + 0.5, 0.0, 1.0);
      srcK = 0.97 + 0.07 * ss(0.1, 0.8, n.y) * step(2.2, dR);                                   // a touch brighter low in the drop
      srcK = mix(srcK, mix(0.9, 0.86, low), rim);                // the rim: the thin darker lower crescent, the faint lit top edge
      bAdd = vec3(0.05) * uLight * rim * (1.0 - low);
    }
    add = mix(add, bAdd, inC); k = mix(k, bK, inC); srcK *= inC;
  }
  A_ = A0 * k + add; K_ = K0 * k; S_ = srcK;
  // a crystal: light arms with a faint frosty glow around them (a dark halo read as dark squares between the arms)
  overC(star.x * (1.0 - star.y) * (1.0 - star.z), 0.94, vec3(0.05, 0.055, 0.06) * uLight);
  overC(star.y * (1.0 - star.z), 0.25, 0.7 * vec3(0.93, 0.97, 1.0) * uLight);
  overC(star.z, 0.15, 0.85 * vec3(uLight));
  sandLens(p);
  dustLens(p);
  heatLens(p);
  // the glints, over everything
  if ( G_ > 0.0 ) over(1.0 - G_, Gc_ * G_ * uLight);
  fragColor = vec4(clamp(A_, 0.0, 1.0), clamp(K_, 0.0, 1.0));
  dispColor = S_ > 0.0 ? vec4(clamp((dc - p) / 32.0 + 0.5, 0.0, 1.0), min(dR, 16.0) / 16.0, clamp(S_, 0.0, 1.0)) : vec4(0.5, 0.5, 0.0, 0.0);
}
#endif`;

let lensProg = null, dispProg = null, runProg = null, beadProg = null;
// the pass (PRE 0) and its two pre-passes (1: the runners per column, 2: the beads per cell), one source
// (INLINE 1: no float targets; the pass makes each px's runners and beads itself, as before the pre-passes: ~2-3 x its cost)
// ONE OUTPUT PER PROGRAM (`out` 1: the shade, 2: the refraction; 2026-11-09, scene-entry stall): on D3D11 (ANGLE) a program that
// writes two targets has its real pixel shader compiled at its FIRST DRAW, on the GPU process's main thread - the link (and with it
// the background pre-warm) only builds a one-target variant. That draw-time compile of the 44 kB pass froze every frame for 2.4-2.8 s
// on the first rainy scene of a session (Electron 146, warehouse). Two one-target programs link completely in the background; the
// pass draws each band twice (shade, then refraction) with the same uniforms: the same two textures, the same pixels.
const lensFrag = (n, inl = 0, out = 1) => LENS_FRAG.replace("#version 300 es", `#version 300 es
#define PRE ${n}
#define INLINE ${inl}
#define LENS_OUT ${out}`);
let inlineProg = null, inlineDisp = null;
function makeLensProgs() {
  lensProg ??= PIXI.Program.from(LENS_VERT, lensFrag(0), "moinen-maps-weather-lens");
  dispProg ??= PIXI.Program.from(LENS_VERT, lensFrag(0, 0, 2), "moinen-maps-weather-lens-disp");
  inlineProg ??= PIXI.Program.from(LENS_VERT, lensFrag(0, 1), "moinen-maps-weather-lens-inline");
  inlineDisp ??= PIXI.Program.from(LENS_VERT, lensFrag(0, 1, 2), "moinen-maps-weather-lens-inline-disp");
  runProg ??= PIXI.Program.from(LENS_VERT, lensFrag(1), "moinen-maps-weather-lens-runners");
  beadProg ??= PIXI.Program.from(LENS_VERT, lensFrag(2), "moinen-maps-weather-lens-beads");
}
const SUB = 3, BANDS = 4;   // px of the pass per lens px (one per CSS px); the bands a step is drawn in

const SHOW_VERT = `#version 300 es
precision highp float;
in vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
out vec2 vP;
void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vP = aVertexPosition;
}`;

/**
 * The glass on screen: the lens pass's (add, k), smoothly scaled (LINEAR: the pass is drawn at SUB px per lens px, one per CSS px;
 * at DPR 2 it is interpolated, never blown up in blocks); a big drop adds the full-resolution frame copy, refracted per screen px,
 * over the share of the px it covers (interpolated as well, so its edge stays as smooth as the rest).
 */
const SHOW_FRAG = `#version 300 es
precision highp float;
in vec2 vP;                  // lens px (continuous)
out vec4 fragColor;
uniform sampler2D uShade;    // the lens pass: (add, k)
uniform sampler2D uDisp;     // the lens pass: a big drop's centre offset, radius, image share
uniform sampler2D uFrame;    // the frame drawn under the glass, full resolution, top row first
uniform vec2 uLens;          // lens px
uniform float uSub;          // px of the pass per lens px
uniform vec2 uFrameK;        // frame uv per lens px
uniform float uHasFrame;
void main() {
  vec4 c = texture(uShade, vP / uLens);
  vec3 add = c.rgb; float k = c.a;
  // the image share from the 4 nearest px of the pass (bilinear, as the shade), the drop from the one with the largest share
  vec2 u = vP * uSub - 0.5, f = fract(u);
  ivec2 i0 = ivec2(floor(u)), mx = textureSize(uDisp, 0) - 1, bi = i0;
  float S = 0.0, best = 0.0; vec4 d = vec4(0.0);
  for ( int j = 0; j < 2; j++ ) for ( int i = 0; i < 2; i++ ) {
    ivec2 ii = clamp(i0 + ivec2(i, j), ivec2(0), mx);
    vec4 t = texelFetch(uDisp, ii, 0);
    S += t.a * (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    if ( t.a > best ) { best = t.a; d = t; bi = ii; }
  }
  if ( S > 0.0 ) {
    if ( uHasFrame > 0.5 ) {
      vec2 dc = (vec2(bi) + 0.5) / uSub + (d.xy - 0.5) * 32.0;
      float dR = d.z * 16.0;
      vec2 n = (vP - dc) / max(dR, 0.5);
      float m = 0.68 + 0.22 * min(dot(n, n), 1.0);
      vec2 sp = dc + (vP - dc) * m - vec2(0.0, 0.18 * dR);
      add += texture(uFrame, clamp(sp * uFrameK, vec2(0.0), vec2(1.0))).rgb * S;
    } else k = min(1.0, k + S);   // (no copy of the frame: the drop is clear, the frame shows as it is)
  }
  fragColor = vec4(add, k);
}`;
let showProg = null;
/** The lens's programs (made here, compiled by their first draw, or earlier by the idle pre-warm in weather.mjs). */
export function lensPrograms() {
  makeLensProgs();
  showProg ??= PIXI.Program.from(SHOW_VERT, SHOW_FRAG, "moinen-maps-weather-lens-show");
  return [lensProg, dispProg, runProg, beadProg, showProg];
}

/**
 * The lens on screen: a quad over the screen in screen space whatever its parent's transform (the stage pans and zooms; the glass
 * does not). Before it draws it copies the frame drawn so far (everything under the glass: map, tokens, fire, weather) into a
 * full-resolution texture with one blit, while lens drops exist, so a big drop refracts the frame itself at full resolution.
 */
class LensShow extends PIXI.Mesh {
  updateTransform() {
    const t = this.transform;
    t.worldTransform.set(this.px, 0, 0, this.px, 0, 0);
    t._worldID++;
    this.worldAlpha = this.alpha;
  }

  render(r) {
    const L = this.lens, u = this.shader.uniforms;
    u.uHasFrame = 0;
    // (the frame guard: under q 0.7 the frame under the glass is copied every other frame, the drops read the last copy between:
    // a frame's lag in what a big drop refracts, nothing else changes; the copy is half this pass's cost at DPR 2)
    if ( L?.copyWanted && L.frameRT && (L.q ?? 1) < 0.7 && this.copied === L.frameRT && !(this.skip = !this.skip) ) { u.uHasFrame = 1; super.render(r); return; }
    this.copied = null;
    if ( L?.copyWanted && L.frameRT ) {
      const gl = r.gl, cur = r.renderTexture.current, ctx = r.CONTEXT_UID;
      try {
        r.batch.flush();
        const srcFB = cur ? cur.framebuffer?.glFramebuffers?.[ctx]?.framebuffer ?? null : null;
        const ok = cur ? !!srcFB && !(cur.framebuffer.multisample > 1) : !gl.getContextAttributes()?.antialias;
        if ( ok ) {
          const sf0 = (this._sf ??= new PIXI.Rectangle()).copyFrom(r.renderTexture.sourceFrame), df0 = (this._df ??= new PIXI.Rectangle()).copyFrom(r.renderTexture.destinationFrame);
          const res = cur ? cur.baseTexture.resolution : r.resolution;
          const H = Math.floor((cur ? cur.height : r.screen.height) * res);
          const w = L.frameRT.width, h = L.frameRT.height;
          r.renderTexture.bind(L.frameRT);
          const dstFB = L.frameRT.framebuffer.glFramebuffers[ctx].framebuffer;
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFB);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFB);
          // a render texture holds its top row first, the screen its bottom row: flip only from the screen
          if ( cur ) gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
          else gl.blitFramebuffer(0, H - h, w, H, 0, h, w, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
          gl.bindFramebuffer(gl.FRAMEBUFFER, dstFB);
          r.renderTexture.bind(cur, sf0, df0);
          u.uHasFrame = 1; L.stats.copies++; this.copied = L.frameRT;
        }
      } catch ( err ) { u.uHasFrame = 0; try { r.renderTexture.bind(r.renderTexture.current); } catch {} }
    }
    super.render(r);
  }
}

export class WeatherLens {
  constructor() {
    this.stats = { lw: 0, lh: 0, lpx: 0, renders: 0, passMs: 0, copies: 0 };
    this.copyWanted = false;
    this.now = null; this.state = null; this.P = null;
    this.key = ""; this.int = new Float32Array(121);
    this.fx = { snow: [0, 0, 0, 0], sand: [0, 0, 0, 0], dust: [0, 0, 0, 0], dust2: [0, 0, 0, 0], heat: [0, 0, 0, 0] };
    this._tick = () => this.tick();
    canvas.app.ticker.add(this._tick);
  }

  /** The state (engine, <= 12 Hz). */
  setState(st, P) {
    this.state = st; this.P = P;
    // the lens's own presence: x its strength, x M.lensP (a lens fixed at a strength below 1 fades the level-1 lens in; auto and
    // fixed >= 1: x 1, exact)
    const str = (P?.lens?.strength ?? 1) * (P?.lens ? M.lensP(P) : 1), cap = st?.lensCap ?? 0;
    const rain = st?.fx?.rain, s = M.lensS(P, rain?.s ?? 0, cap), p = (rain?.p ?? 0) * str;
    const G = rain ? M.lensGates("rain", s) : { bead: 0, big: 0, run: 0, mist: 0, film: 0 };
    this.gates = [G.bead * p, G.big, G.run * p, G.mist * p, G.film * p];
    // the other effects: each at its own lens level (auto: the effect's level), presence x strength
    const at = (e) => { const f = st?.fx?.[e]; if ( !f ) return null; return { G: M.lensGates(e, M.lensS(P, f.s, cap)), p: f.p * str }; };
    const sn = at("snow"), sa = at("sand"), du = at("dust"), em = P?.lens?.heat ? at("embers") : null;
    this.fx.snow = sn ? [sn.G.frost, sn.G.wob, sn.G.crystals, sn.p] : [0, 0, 0, 0];
    this.fx.sand = sa ? [sa.G.deposit * sa.p, sa.G.scratch * sa.p, sa.G.impacts, sa.p] : [0, 0, 0, 0];
    this.fx.dust = du ? [du.G.specks, du.G.discs, du.G.glare, du.G.ghosts] : [0, 0, 0, 0];
    this.fx.dust2 = du ? [du.G.ghostK, du.G.smudge, du.p, 0] : [0, 0, 0, 0];
    this.fx.heat = em ? [em.G.glow * em.p, em.G.flecks, em.p, 0] : [0, 0, 0, 0];
    this.wind = st?.wind ?? null; this.seed = st?.seed ?? 0;
    this.key = "";   // (re-render on the next frame)
  }

  /** Make (or re-make) the lens targets, sprite and pass for this screen size and DPR. */
  ensure() {
    const r = canvas.app.renderer, dpr = r.resolution || 1, lpx = Math.max(1, Math.round(3 * dpr)), css = lpx / dpr;
    const lw = Math.ceil(r.screen.width / css), lh = Math.ceil(r.screen.height / css);
    if ( this.bufs && this.stats.lw === lw && this.stats.lh === lh && this.stats.lpx === lpx ) return;
    this.free();
    this.stats.lw = lw; this.stats.lh = lh; this.stats.lpx = lpx;
    const W = lw * SUB, H = lh * SUB;
    // two sets of targets (shown / being drawn): the pass draws a step in bands over a few frames into the hidden set, then they swap
    this.bufs = [0, 1].map(() => {
      const rt = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: PIXI.SCALE_MODES.LINEAR });
      // the pass's refraction target (its own one-target program, lensFrag): where a big drop samples the frame (read px by px: NEAREST)
      const disp = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST });
      return { rt, disp, dispTex: disp, dispClear: true };   // (a new texture is all zero)
    });
    this.front = 0; this.pend = null; this.fresh = true;
    // the full-resolution copy of the frame under the glass (device px)
    const fw = Math.floor(r.screen.width * dpr), fh = Math.floor(r.screen.height * dpr);
    this.frameRT = PIXI.RenderTexture.create({ width: fw, height: fh, resolution: 1, scaleMode: PIXI.SCALE_MODES.LINEAR });
    makeLensProgs();
    const U = {
      uLens: new Float32Array([lw, lh]), uAA: 1 / SUB, uVS: 1 / SUB, uT: 0, uSeed: 0, uRainA: new Float32Array(4), uFilm: 0, uWind: new Float32Array([1, 0, 0]), uSlant: 0,
      uG: this.int, uSnowL: new Float32Array(4), uSandL: new Float32Array(4), uDustL: new Float32Array(4), uDustL2: new Float32Array(4), uHeatL: new Float32Array(4),
      uLight: 1, uRun: PIXI.Texture.WHITE, uBead: PIXI.Texture.WHITE, uRunC0: new Int32Array(2), uCell0: new Int32Array(2), translationMatrix: new PIXI.Matrix().toArray(true)
    };
    const state = PIXI.State.for2d(); state.blend = false;
    // the PRE-PASSES (float targets): the runners of the step per column and its beads per 8-px cell, made once per step instead of by
    // every px of the pass (the same values: a few hundred texels instead of ~2 M px each working them out)
    this.pre = CONFIG.moinenMaps?.weatherLensPre !== false && !!r.gl.getExtension("EXT_color_buffer_float");   // (false: off, dev A/B)
    this.shaders = [];
    if ( this.pre ) {
      const cols = [[36, 0], [53, 13]].map(([Wc, off]) => [Math.floor((-30 - 0.2 * lh - off) / Wc) - 2, Math.ceil((lw + 30 + 0.2 * lh - off) / Wc) + 2]);
      const RW = Math.max(...cols.map(([a, b]) => b - a + 1)), CW = Math.floor(lw / 8) + 5, CH = Math.floor(lh / 8) + 5;
      U.uRunC0[0] = cols[0][0]; U.uRunC0[1] = cols[1][0]; U.uCell0[0] = -2; U.uCell0[1] = -2;
      const frt = (w, h) => PIXI.RenderTexture.create({ width: w, height: h, resolution: 1, type: PIXI.TYPES.FLOAT, format: PIXI.FORMATS.RGBA,
        scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF });
      this.runRT = frt(RW, 10); this.beadRT = frt(CW, CH * 3);
      U.uRun = this.runRT; U.uBead = this.beadRT;
      const quad = (w, h) => new PIXI.Geometry().addAttribute("aVertexPosition", [0, 0, w, 0, w, h, 0, h], 2).addIndex([0, 1, 2, 0, 2, 3]);
      const rs = new PIXI.Shader(runProg, { ...U, uVS: 1 }), bs = new PIXI.Shader(beadProg, { ...U, uVS: 1 });
      this.runMesh = new PIXI.Mesh(quad(RW, 10), rs, state); this.beadMesh = new PIXI.Mesh(quad(CW, CH * 3), bs, state);
      this.shaders.push(rs, bs);
    }
    // (the shade and the refraction programs share ONE uniform group: every value set on one is the other's)
    const UG = new PIXI.UniformGroup(U), shader = new PIXI.Shader(this.pre ? lensProg : inlineProg, UG), dshader = new PIXI.Shader(this.pre ? dispProg : inlineDisp, UG);
    this.shaders.push(shader);
    // the pass in BANDS of rows (each a quad of its own; a band overwrites its rows whole)
    this.slices = []; this.dslices = [];
    for ( let b = 0; b < BANDS; b++ ) {
      const y0 = Math.round(H * b / BANDS), y1 = Math.round(H * (b + 1) / BANDS);
      const g = new PIXI.Geometry().addAttribute("aVertexPosition", [0, y0, W, y0, W, y1, 0, y1], 2).addIndex([0, 1, 2, 0, 2, 3]);
      this.slices.push(new PIXI.Mesh(g, shader, state));
      this.dslices.push(new PIXI.Mesh(g, dshader, state));
    }
    showProg ??= PIXI.Program.from(SHOW_VERT, SHOW_FRAG, "moinen-maps-weather-lens-show");
    const sg = new PIXI.Geometry().addAttribute("aVertexPosition", [0, 0, lw, 0, lw, lh, 0, lh], 2).addIndex([0, 1, 2, 0, 2, 3]);
    this.sprite = new LensShow(sg, new PIXI.Shader(showProg, {
      uShade: this.bufs[0].rt, uDisp: this.bufs[0].dispTex, uFrame: this.frameRT, uLens: new Float32Array([lw, lh]), uSub: SUB,
      uFrameK: new Float32Array([css * dpr / fw, css * dpr / fh]), uHasFrame: 0, translationMatrix: new PIXI.Matrix().toArray(true)
    }));
    this.sprite.lens = this; this.sprite.px = css;
    this.sprite.state.blendMode = blendMode(); this.sprite.state.depthTest = false; this.sprite.state.culling = false;
    this.sprite.eventMode = "none";
    canvas.stage.addChild(this.sprite);
  }

  /**
   * Every frame: a new 12 Hz step starts the pass on the hidden targets (setState clears the key); the bands of a step are spread
   * over the frames until the next step (4 at 48+ fps, 2 at 24+, else all at once: never more than one step behind), then shown.
   * `CONFIG.moinenMaps.weatherLensBands` (1, 2, 4) fixes the count.
   */
  tick() {
    const st = this.state; if ( !st || !canvas.stage ) return;
    this.ensure();
    const ch = canvas.stage.children;
    if ( this.sprite.parent !== canvas.stage || ch.at(-1) !== this.sprite ) canvas.stage.addChild(this.sprite);   // (drawn last)
    const T = ((this.now?.() ?? Date.now()) / 1000) % 3600, q = Math.floor(T * 12);
    this.q = weatherQ();
    this.copyWanted = this.bigDrops();
    const fix = CONFIG.moinenMaps?.weatherLensBands, fps = canvas.app.ticker.FPS || 60;
    const k = [1, 2, 4].includes(fix) ? fix : fps >= 48 ? 4 : fps >= 24 ? 2 : 1, per = BANDS / k;
    if ( q !== this.key ) {
      if ( this.pend ) this.draw(BANDS);   // (the last step's bands not done yet: finish them, show it)
      this.key = q;
      this.begin(q / 12);
      this.draw(this.fresh ? BANDS : per);
      this.fresh = false;
    } else if ( this.pend ) this.draw(per);
  }

  /** Can this state make big drops (rain beads and runners, melted crystals)? Without them the refraction is empty everywhere. */
  bigDrops() { return (this.gates?.[0] ?? 0) > 0 || (this.fx.snow[2] ?? 0) > 0; }

  /** The uniforms of the step at time t (s); its bands follow. */
  begin(t) {
    const t0 = performance.now(), u = this.slices[0].shader.uniforms, [bead, big, run, mist, film] = this.gates ?? [0, 0, 0, 0, 0];
    // (the arrays are shared by the pass and its pre-passes; the numbers are set on each)
    const w = this.wind, [dx, dy] = dirVec(w?.dir ?? 0), ws = Math.min(1, Math.max(0, (w?.str ?? 0) * 2));
    const light = 1 - 0.7 * Math.min(1, Math.max(0, canvas.environment?.darknessLevel ?? 0));
    for ( const s of this.shaders ) { const v = s.uniforms; v.uT = t; v.uSeed = this.seed | 0; v.uFilm = film; v.uSlant = 0.14 * dx * ws; v.uLight = light; }
    u.uRainA[0] = bead; u.uRainA[1] = big; u.uRainA[2] = run; u.uRainA[3] = mist;
    u.uWind[0] = dx; u.uWind[1] = dy; u.uWind[2] = ws;
    // the gust envelope over the last 10 s on the 12 Hz grid (the same on every client): on the next step only the newest value is
    // new (the rest shift down one; every value is at a whole step k / 12, so a shifted one is the one a full refill would give)
    const k = Math.round(t * 12), sd = this.seed | 0;
    if ( Math.abs(t * 12 - k) > 1e-6 ) { for ( let i = 0; i <= 120; i++ ) this.int[i] = gustEnv(t - 10 + i / 12, sd); this.gk = null; }
    else if ( this.gk === k - 1 && this.gs === sd ) { this.int.copyWithin(0, 1); this.int[120] = gustEnv(k / 12, sd); this.gk = k; }
    else if ( this.gk !== k || this.gs !== sd ) { for ( let i = 0; i <= 120; i++ ) this.int[i] = gustEnv((k - 120 + i) / 12, sd); this.gk = k; this.gs = sd; }
    u.uSnowL.set(this.fx.snow); u.uSandL.set(this.fx.sand); u.uDustL.set(this.fx.dust); u.uDustL2.set(this.fx.dust2); u.uHeatL.set(this.fx.heat);
    if ( this.pre ) {   // (the runners first: the beads read them; tiny, so every step, never stale)
      const R = canvas.app.renderer;
      R.render(this.runMesh, { renderTexture: this.runRT, clear: false });
      R.render(this.beadMesh, { renderTexture: this.beadRT, clear: false });
    }
    this.pend = { next: 0, ms: performance.now() - t0, disp: this.bigDrops() };
  }

  /** Draw up to n more bands of the pending step into the hidden targets; when all are drawn, show them. */
  draw(n) {
    const P = this.pend; if ( !P ) return;
    const t0 = performance.now(), R = canvas.app.renderer, back = this.bufs[1 - this.front];
    // (the refraction half only while big drops can exist; without them it is empty: cleared once, the show reads no drop - as the
    // two-target pass, which wrote a zero share there)
    if ( !P.disp && !back.dispClear ) { R.render(this.none ??= new PIXI.Container(), { renderTexture: back.disp, clear: true }); back.dispClear = true; }
    for ( let i = 0; i < n && P.next < BANDS; i++ ) {
      R.render(this.slices[P.next], { renderTexture: back.rt, clear: false });
      if ( P.disp ) { R.render(this.dslices[P.next], { renderTexture: back.disp, clear: false }); back.dispClear = false; }
      P.next++;
    }
    P.ms += performance.now() - t0;
    if ( P.next < BANDS ) return;
    this.front = 1 - this.front;
    const su = this.sprite.shader.uniforms; su.uShade = back.rt; su.uDisp = back.dispTex;
    this.pend = null; this.stats.renders++; this.stats.passMs = P.ms;
  }

  /** The whole pass at time t (s), at once (dev tools). */
  render(t) { this.ensure(); this.begin(t); this.draw(BANDS); }

  free() {
    this.sprite?.parent?.removeChild(this.sprite); this.sprite?.geometry?.destroy(); this.sprite?.destroy(); this.sprite = null;
    this.frameRT?.destroy(true); this.frameRT = null;
    for ( const m of [...this.slices ?? [], this.runMesh, this.beadMesh] ) { m?.geometry?.destroy(); m?.destroy(); }
    for ( const m of this.dslices ?? [] ) m.destroy();   // (their geometry is the band's, gone above)
    this.slices = null; this.dslices = null; this.runMesh = null; this.beadMesh = null; this.shaders = null;
    this.runRT?.destroy(true); this.beadRT?.destroy(true); this.runRT = null; this.beadRT = null;
    for ( const b of this.bufs ?? [] ) { b.disp.destroy(true); b.rt.destroy(true); }
    this.bufs = null; this.pend = null; this.none?.destroy(); this.none = null;
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick);
    this.free();
    this.state = null;
  }
}
