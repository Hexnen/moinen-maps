import * as M from "./model.mjs";
import { blendMode } from "./display.mjs";
import { GLSL_WIND, gustEnv, dirVec } from "../wind.mjs";

/**
 * The LENS: what happens ON the glass (doc 4.2-4.4), never a second copy of the world weather.
 *
 * GRID: a pixel grid of its own, fixed in screen space: one lens px = round(3 x DPR) device px (about 3 CSS px), whatever the zoom
 * (drops are on the glass, not on the map).
 *
 * RENDER: one low-res pass into a lens-size RenderTexture, only when its 12 Hz step changes (or the view moves: the drops refract
 * the map under them); every frame one NEAREST-upscaled sprite, a child of the stage drawn last, in screen space (its world transform
 * ignores the stage's). Both use the weather's blend (dst x k + add): wet film, streaks, mist and rims are the frame under them
 * scaled (no capture), only a drop's body fetches the map (refraction-lite, way (a): the scene background at the world point under
 * the drop centre + offset, magnified in medium drops, inverted in big ones).
 *
 * RAIN (4.3): static beads (one per jittered 8-px cell, lobed, born with a splat, sag, evaporate), runners in two column grids (grow
 * in place, then stick-slip down a wobbly path slanted by the wind, leave a wet streak that beads up and clears the misty film),
 * single-px mist, a cool film. Every term is a pure function of (lens px, step time) from integer hashes: every client with the
 * same screen size sees the same glass. Runner cycles are absolute within the hour (no short loop).
 *
 * COST: nothing exists without a lens effect. With one: one ticker listener (a compare), one textured full-screen quad per frame,
 * one lens pass (~0.23 M lens px at any DPR for a 1080p-sized window) 12 times a second.
 */

const LENS_VERT = `#version 300 es
precision highp float;
in vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec2 uLens;
out vec2 vP;
void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vP = aVertexPosition;
}`;

const LENS_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vP;
out vec4 fragColor;
uniform vec2 uLens;          // lens size in lens px
uniform float uT;            // the step time (s, mod 1 h)
uniform int uSeed;
uniform vec4 uRainA;         // bead density, biggest bead radius, runner rate, mist
uniform float uFilm;
uniform vec3 uWind;          // unit direction (x, y), strength 0..1
uniform float uSlant;        // runner slant (x per y) from the wind
uniform float uG[121];       // the gust envelope over the last 10 s (12 Hz, oldest first): rain intensity, sand waves, fire gusts
uniform vec4 uSnowL;         // frost reach, frost breathing, crystals per lens-area, presence
uniform vec4 uSandL;         // deposit, scratches per area, impacts per area, presence
uniform vec4 uDustL;         // specks share, discs per area, glare, ghosts
uniform vec4 uDustL2;        // ghost strength, smudge, presence, -
uniform vec4 uHeatL;         // glow, flecks per area, presence, -
uniform sampler2D uBg;
uniform vec4 uMap;           // lens px -> scene background uv: uv = p * uMap.xy + uMap.zw
uniform float uHasBg;
uniform float uLight;        // 1 by day, darker at night
uniform float uWet;          // the wet ground under the glass (the map sample is the dry map)
${GLSL_WIND}
const float PERIOD = 10.0, G = 8.0, PI2 = 6.2831853;
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

// ---------------------------------------------------------------- runners (at most 12 near a pixel)
const int NR = 12;
struct Run { vec4 a; vec4 b; vec4 c; vec4 d; };   // a: colx y0 V sNow; b: w1 w2 dist slant; c: ph1 ph2 ph3 r0; d: xh yh rh fade
Run R_[NR];
float Rmov[NR]; int Rkey[NR]; int nR = 0;
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
void runner(int layer, int ci, float Wc, float off, int seed) {
  if ( nR >= NR ) return;
  float hk = hu(ci, layer, seed);
  float kk = hk < 0.6667 ? 1.0 : 2.0, L, tau; int c;
  cycle(ci, layer, seed, kk, L, c, tau);
  int key = ci * 37 + c;
  float h[12];
  for ( int q = 0; q < 12; q++ ) h[q] = hu(key, layer, seed + 10 + q);
  float colx = off + (float(ci) + 0.5) * Wc + (h[0] - 0.5) * Wc * 0.4;
  if ( h[1] > (0.25 + 0.6 * dens(vec2(colx, uLens.y * 0.5)) * intensityAgo(tau)) * uRainA.z ) return;
  float y0 = -4.0 + h[2] * uLens.y * 0.62, r0 = 3.6 + 5.0 * pow(h[3], 0.8), ta = 0.5 + 1.8 * h[4];
  bool stall = h[5] > 0.72;
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
// the runners whose column can reach this pixel (path wobble 5.1 px, slant over the run, 22 px of influence)
void gather(vec2 p) {
  for ( int layer = 0; layer < 2; layer++ ) {
    float Wc = layer == 0 ? 36.0 : 53.0, off = layer == 0 ? 0.0 : 13.0; int seed = layer == 0 ? 700 : 760;
    float a = max(-14.0, p.y - 0.62 * uLens.y + 4.0), b = p.y + 4.0;
    float s1 = uSlant * 0.7, s2 = uSlant * 1.3;
    float lo = min(min(s1 * a, s2 * a), min(s1 * b, s2 * b)), hi = max(max(s1 * a, s2 * a), max(s1 * b, s2 * b));
    float x0 = p.x - 27.1 - hi, x1 = p.x + 27.1 - lo;
    int c0 = int(floor((x0 - off) / Wc - 0.7)), c1 = int(floor((x1 - off) / Wc - 0.3));
    for ( int ci = c0; ci <= c1 && ci <= c0 + 7; ci++ ) runner(layer, ci, Wc, off, seed);
  }
}

// ---------------------------------------------------------------- the drop field at p
float sdf = 1e3, best = 1e3, dR = 1.0;
vec2 dc = vec2(0.0);
void put(float s, float R, vec2 c) {
  if ( s < best ) { best = s; dc = c; dR = R; }
  sdf = smin(sdf, s, 1.3);
}

// ---------------------------------------------------------------- composing on the glass: the frame becomes dst x K + A
vec3 A_ = vec3(0.0); float K_ = 1.0;
void over(float k, vec3 a) { A_ = A_ * k + a; K_ *= k; }
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
bool onSeg(vec2 q, vec2 a, vec2 d, float ln, float w) {
  vec2 e = q - a; float t = dot(e, d);
  return t >= -0.5 && t <= ln + 0.5 && abs(e.x * d.y - e.y * d.x) < w;
}

// ---------------- SNOW: frost from the edges (cells of a jittered 13-px grid), crystals landing and melting into beads
float frostProg() {
  return (uSnowL.x + uSnowL.y * sin(PI2 * uT / 30.0) + 0.012 * sin(PI2 * uT / 10.0 + 1.0)) * uSnowL.w;
}
// the frost at q: reach - progress (< 0: frosted), the cell hash, the crack (the cells' borders)
float frostAt(vec2 q, float prog, out float fid, out bool crack) {
  ivec2 c0 = ivec2(floor(q / 13.0));
  float d1 = 1e9, d2 = 1e9; ivec2 id = c0;
  for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) {
    ivec2 c = c0 + ivec2(i, j);
    vec2 sp = vec2(c) * 13.0 + vec2(hu(c.x * 13, c.y * 13, 401), hu(c.x * 13, c.y * 13 + 1, 402)) * 12.0;
    float d = length(q - sp);
    if ( d < d1 ) { d2 = d1; d1 = d; id = c; } else d2 = min(d2, d);
  }
  fid = hu(id.x, id.y, 403);
  crack = d2 - d1 < 1.1;
  float ex = min(q.x, uLens.x - q.x) / uLens.x, ey = min(q.y, uLens.y - q.y) / uLens.y;
  float reach = 0.55 * min(ex * 1.6, ey) + 0.45 * length(vec2(ex, ey)) + fid * 0.07 + (fbm3(vec2(q.x / 37.0, q.y / 29.0), 777) - 0.5) * 0.09
    + (hu(int(floor(q.x)), int(floor(q.y)), 404) - 0.5) * 0.012;
  return reach - prog;
}
void frost(vec2 p) {
  float prog = frostProg();
  if ( prog <= 0.0 ) return;
  float fid; bool crack;
  float r = frostAt(p, prog, fid, crack);
  if ( r < 0.0 ) {
    float tn = floor(hu(int(fid * 1e6), 1, 405) * 3.0);
    vec3 ice = tn < 0.5 ? vec3(0.72, 0.80, 0.90) : tn < 1.5 ? vec3(0.82, 0.88, 0.95) : vec3(0.90, 0.94, 0.99);
    if ( crack ) ice = vec3(0.97, 0.99, 1.0);
    float dn = clamp(-r / 0.08, 0.0, 1.0), K = dn > 0.66 ? 0.72 : dn > 0.33 ? 0.52 : 0.32;
    over(1.0 - K, ice * K * uLight);
    if ( hu(int(floor(p.x)), int(floor(p.y)), 900 + int(floor(uT * 5.0))) < 0.004 ) over(0.0, vec3(uLight));   // a glint
  } else if ( crack && r < 0.035 && hu(int(fid * 1e6), 2, 406) < 0.6 ) over(0.4, 0.6 * vec3(0.9, 0.95, 1.0) * uLight);   // feathers ahead
}
// crystals (cells of 64 px, 2 slots), drawn over everything; their melt beads go into the drop field
int starHit = 0;   // 0 none, 1 halo, 2 arm, 3 core
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
    float fid; bool cr;
    bool inf = prog > 0.0 && frostAt(x, prog, fid, cr) < 0.0;
    float melt = inf ? 0.0 : ss(hold, hold + 1.2, tau), gone = ss(L - 0.8, L, tau);
    // lands: grows from a speck over 0.3 s (a little overshoot), then holds; melts or fades by shrinking
    float land = ss(0.0, 0.3, tau) * (1.0 + 0.15 * (1.0 - ss(0.3, 0.6, tau)));
    float R = R0 * land * (1.0 - melt) * (1.0 - gone);
    if ( R > 0.4 && floor(p) - floor(x) == clamp(floor(p) - floor(x), 0.0, 1.0) ) { starHit = 3; continue; }
    if ( R > 0.8 ) {
      float m = 9.0;
      for ( int a = 0; a < 6; a++ ) {
        float ang = h[4] * 1.05 + float(a) * 1.0471976;
        vec2 dir = vec2(cos(ang), sin(ang));
        float t = dot(d, dir);
        if ( t >= -0.5 && t <= R + 0.5 ) m = min(m, abs(d.x * dir.y - d.y * dir.x));
        if ( R >= 3.0 ) for ( int sd = -1; sd <= 1; sd += 2 ) {
          vec2 b0 = x + dir * R * 0.55, bd = vec2(cos(ang + float(sd) * 1.05), sin(ang + float(sd) * 1.05));
          vec2 e2 = p - b0; float t2 = dot(e2, bd);
          if ( t2 >= -0.5 && t2 <= R * 0.35 + 0.5 ) m = min(m, abs(e2.x * bd.y - e2.y * bd.x));
        }
      }
      if ( m < 0.55 ) starHit = max(starHit, 2); else if ( m < 1.5 ) starHit = max(starHit, 1);
    }
    float rb = (0.9 + 1.6 * h[5]) * melt * (1.0 - gone);
    if ( rb >= 0.35 ) {
      vec2 b = x + vec2(0.0, 0.6 * max(0.0, tau - hold - 1.2) * melt);
      if ( rb < 1.2 ) b = floor(b) + 0.5;
      float RR, s = blob(p, b, rb, 0.1, h[4] * 6.0, 0.06, h[3] * 6.0, 1.0, RR);
      put(s, RR, b);
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
  float lvl = dep * (0.30 + 0.25 * clamp(gAgo(1.5), 0.0, 1.0)) * uSandL.x, gr = hu(int(floor(p.x)), int(floor(p.y)), 532);
  if ( gr < lvl * 0.55 ) over(0.45, 0.55 * vec3(0.80, 0.66, 0.44) * uLight);
  else if ( gr < lvl ) over(0.72, 0.28 * vec3(0.84, 0.70, 0.48) * uLight);
  // scratches (cells of 64, 2 slots; along the wind)
  float es = slotsOf(uSandL.y, 64.0), wa = atan(wd.y, wd.x);
  ivec2 ce = ivec2(floor(p / 64.0));
  for ( int j = 0; j < 3; j++ ) {
    if ( !slotOn(j, es, ce, 506) ) continue;
    int key = (ce.x * 64 + ce.y) * 4 + j;
    if ( hu(key, 5, 505) > (0.3 + 0.6 * fr) ) continue;
    vec2 a = vec2(ce) * 64.0 + 16.0 + 32.0 * vec2(hu(key, 1, 501), hu(key, 2, 502));
    float ln = 4.0 + 12.0 * hu(key, 3, 503), an = wa + (hu(key, 4, 504) - 0.5) * 0.6;
    if ( onSeg(p, a, vec2(cos(an), sin(an)), ln, 0.5) ) { over(0.55, 0.45 * vec3(1.0, 0.93, 0.78) * uLight); break; }
  }
  // impacts (cells of 16, interior positions)
  float ei = slotsOf(uSandL.z * pr, 16.0);
  ivec2 ci = ivec2(floor(p / 16.0));
  if ( slotOn(0, ei, ci, 525) ) {
    int key = ci.x * 4096 + ci.y;
    float L, tau; int c;
    cyc4(key, 0, 520, vec4(2.0, 3.0, 4.0, 5.0), L, c, tau);
    int kc = key * 17 + c;
    if ( hu(kc, 1, 521) <= 0.08 + 0.85 * clamp(gAgo(tau), 0.0, 1.0) ) {
      vec2 x = vec2(ci) * 16.0 + 2.0 + floor(12.0 * vec2(hu(kc, 2, 522), hu(kc, 3, 523)));
      vec2 d = floor(p) - x;
      if ( tau < 1.0 / 12.0 ) { if ( (d.x == 0.0 && abs(d.y) <= 1.0) || (d.y == 0.0 && abs(d.x) <= 1.0) ) over(0.0, vec3(1.0, 0.98, 0.88) * uLight); }
      else if ( tau < 2.0 / 12.0 ) { if ( d == vec2(0.0) ) over(0.0, vec3(1.0, 0.92, 0.70) * uLight); }
      else if ( tau < L - 0.4 && hu(kc, 4, 524) < 0.6 ) {
        if ( d == vec2(0.0) ) over(0.5, vec3(0.0));
        else if ( d == vec2(1.0, -1.0) ) over(0.4, 0.6 * vec3(1.0, 0.95, 0.80) * uLight);
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
  float lv = (d < 0.45 * glare + 0.1 ? 1.0 : 0.0) + (d < 0.30 * glare + 0.05 ? 1.0 : 0.0) + (d < 0.16 * glare ? 1.0 : 0.0);
  vec3 add = (lv < 0.5 ? 0.0 : lv < 1.5 ? 0.05 : lv < 2.5 ? 0.10 : 0.16) * uDustL.z * vec3(1.0, 0.92, 0.72);
  // ghosts along the axis sun -> centre -> beyond
  vec2 ax = uLens * 0.5 - sun;
  for ( int j = 0; j < 5; j++ ) {
    if ( float(j) >= uDustL.w ) break;
    float f = j == 0 ? 0.55 : j == 1 ? 1.15 : j == 2 ? 1.45 : j == 3 ? 1.9 : 2.2;
    float rad = (j == 0 ? 9.0 : j == 1 ? 16.0 : j == 2 ? 6.0 : j == 3 ? 24.0 : 4.0) * sc;
    vec3 col = j == 0 ? vec3(0.9, 0.8, 0.5) : j == 1 ? vec3(0.55, 0.9, 0.6) : j == 2 ? vec3(0.8, 0.6, 1.0) : j == 3 ? vec3(0.9, 0.7, 0.5) : vec3(1.0, 0.95, 0.8);
    vec2 e = p - (sun + ax * f);
    float r = length(e);
    if ( j == 1 || j == 3 ) { float a = mod(abs(atan(e.y, e.x)), 1.0471976) - 0.5235988; r = r * cos(a) / 0.8660254; }
    if ( r < rad ) { float k = uDustL2.x * glare; add += col * k * (r > rad - 1.0 ? 2.2 : 1.0); }
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
    if ( dd < r - 1.0 ) over(1.0, vec3(0.04) * uLight); else if ( dd < r ) over(0.9, vec3(0.0));
  }
  // specks: sharp, glinting with the glare where the sun is close
  int ix = int(floor(p.x)), iy = int(floor(p.y));
  if ( hu(ix, iy, 604) < 0.004 && hu(ix, iy, 609) < uDustL.x * pr ) {
    float lit = clamp(1.0 - length(p - sun) / (420.0 * sc), 0.0, 1.0) * glare;
    if ( hu(ix, iy, 900 + int(floor(uT * 3.0 + hu(ix, iy, 608) * 3.0))) < lit * 0.8 ) over(0.0, vec3(1.0, 0.97, 0.86) * uLight);
    else over(0.7, vec3(0.08) * uLight);
  }
  // a smudge (fingerprint): only where the glare falls on it, ridges light up
  if ( uDustL2.y > 0.0 && length(vec2(p.x - 0.70 * uLens.x, (p.y - 0.29 * uLens.y) * 1.4)) < 70.0 * sc && fbm3(vec2(p.x / 22.0, p.y / 16.0), 605) > 0.6
       && sin((p.x * 0.8 + p.y * 0.6) / 1.6 + 4.0 * fbm2(p / 30.0, 606)) > 0.55 ) over(1.0, 0.10 * glare * uDustL2.y * vec3(1.0, 0.95, 0.85) * uLight);
}

// ---------------- HEAT (embers, optional): heat glow from the fire side, hot flecks that hit the glass and cool to ash
void heatLens(vec2 p) {
  float pr = uHeatL.z; if ( pr <= 0.0 ) return;
  float g = clamp(gAgo(0.0), 0.0, 1.2), uw = upwind(p);
  float f = (1.0 - uw / 0.5) * (0.7 + 0.35 * g) + 0.12 * (fbm2(vec2(p.x / 25.0 - mod(uT, 600.0) * 0.4, p.y / 25.0), 701) - 0.5);
  float lv = (f > 0.25 ? 1.0 : 0.0) + (f > 0.5 ? 1.0 : 0.0) + (f > 0.75 ? 1.0 : 0.0);
  over(1.0, (lv < 0.5 ? 0.0 : lv < 1.5 ? 0.05 : lv < 2.5 ? 0.10 : 0.16) * uHeatL.x * vec3(1.0, 0.55, 0.2) * uLight);
  float ef = slotsOf(uHeatL.y * pr, 48.0);
  ivec2 ce = ivec2(floor(p / 48.0));
  if ( upwind((vec2(ce) + 0.5) * 48.0) > 0.7 || !slotOn(0, ef / 0.7, ce, 730) ) return;
  int key = ce.x * 4096 + ce.y;
  float L, tau; int c;
  cyc4(key, 0, 720, vec4(1.0, 2.0, 1.0, 2.0), L, c, tau);
  int kc = key * 11 + c;
  if ( hu(kc, 1, 721) > 0.45 + 0.4 * clamp(gAgo(tau), 0.0, 1.2) || tau > L - 0.5 ) return;
  vec2 x = vec2(ce) * 48.0 + 4.0 + floor(36.0 * vec2(hu(kc, 1, 722), hu(kc, 1, 723)));
  vec2 d = floor(p) - x;
  if ( tau < 1.0 / 12.0 ) { if ( abs(d.x + 0.5) < 2.0 && abs(d.y + 0.5) < 2.0 ) over(0.0, vec3(1.0, 0.97, 0.80) * uLight); return; }
  float ci = 1.0 + min(3.0, floor(tau / 0.5)), sz = ci < 4.0 ? 2.0 : 1.0;
  float sl = hu(kc, 1, 725) > 0.6 && ci < 3.0 ? min(3.0, floor(tau * 2.0)) : 0.0;
  vec2 e = d - vec2(0.0, sl);
  vec3 E = ci < 1.5 ? vec3(1.0, 0.82, 0.30) : ci < 2.5 ? vec3(1.0, 0.54, 0.14) : ci < 3.5 ? vec3(0.80, 0.26, 0.10) : vec3(0.30, 0.22, 0.20);
  if ( e.x >= 0.0 && e.y >= 0.0 && e.x < sz && e.y < sz ) { over(0.0, E * uLight); return; }
  if ( ci <= 2.0 && abs(e.x - 0.5) < 3.5 && abs(e.y - 0.5) < 3.5 ) over(1.0, 0.10 * vec3(1.0, 0.5, 0.15) * uLight);
}

void main() {
  vec2 p = floor(vP) + 0.5;
  if ( uSnowL.w > 0.0 ) { frost(p); crystals(p); }
  vec3 A0 = A_; float K0 = K_;
  A_ = vec3(0.0); K_ = 1.0;
  if ( uRainA.z > 0.0 ) gather(p);
  // static beads: this cell and the 8 around it
  bool sat = false;
  ivec2 cp = ivec2(floor(p / G));
  for ( int dy = -1; dy <= 1; dy++ ) for ( int dx = -1; dx <= 1; dx++ ) {
    int CX = cp.x + dx, CY = cp.y + dy;
    float hk = hu(CX, CY, 300), kk = hk < 0.2 ? 1.0 : hk < 0.6 ? 2.0 : hk < 0.8 ? 3.0 : 4.0, L, tau; int c;
    cycle(CX, CY, 300, kk, L, c, tau);
    int key = CX * 131 + c;
    if ( hu(key, CY, 312) >= uRainA.x * 1.3 ) continue;                       // (cheap pre-test: dens x I <= 1)
    vec2 b = (vec2(CX, CY) + 0.5 + (vec2(hu(key, CY, 310), hu(key, CY, 311)) - 0.5) * 0.9) * G;
    if ( hu(key, CY, 312) >= dens(b) * intensityAgo(tau) * 1.3 * uRainA.x ) continue;
    float big = kk <= 2.0 ? uRainA.y : 1.2;
    float r = 0.5 + big * pow(hu(key, CY, 313), 2.6);
    r *= (0.6 + 0.4 * ss(0.0, 0.6, tau)) * (1.0 - ss(L - 0.7, L, tau));
    if ( r > 2.4 ) b.y += 0.5 * tau;
    bool splat = tau < 0.2 && r > 1.0;
    float a2 = 0.05 + 0.16 * hu(key, CY, 314) + (splat ? 0.25 : 0.0), a3 = 0.04 + 0.12 * hu(key, CY, 315) + (splat ? 0.15 : 0.0);
    if ( splat ) r *= 1.35;
    if ( r < 1.2 ) b = floor(b) + 0.5;
    // wiped by a runner that passed after it formed, or merged into a head
    bool gone = r <= 0.35;
    for ( int i = 0; i < NR; i++ ) {
      if ( i >= nR || gone ) break;
      Run q = R_[i];
      if ( abs(b.x - xOf(q, b.y)) < q.c.w * 0.85 + r * 0.5 && ageAt(q, b.y) < tau ) gone = true;
      if ( length(b - q.d.xy) < q.d.z + r * 0.6 ) gone = true;
    }
    if ( gone ) continue;
    float R, s = blob(p, b, r, a2, hu(key, CY, 316) * 6.28, a3, hu(key, CY, 317) * 6.28, 1.14, R);
    put(s, R, b);
    // satellites of a fresh splat: 3-5 specks thrown around, gone after 0.35 s
    if ( tau < 0.35 && r > 1.2 ) {
      float ns = 3.0 + 2.0 * hu(key, CY, 318);
      for ( int j = 0; j < 5; j++ ) {
        if ( float(j) >= ns ) break;
        float ang = hu(key * 7 + j, CY, 330) * 6.28, dd = (1.7 + 1.3 * hu(key * 7 + j, CY, 331)) * r;
        if ( floor(b + vec2(cos(ang), sin(ang) * 0.9) * dd) == floor(p) ) sat = true;
      }
    }
  }
  // runners: head (teardrop), streak + its lit edge, trail beads, the cleared film
  bool streak = false, lit = false; float clear = 0.0;
  for ( int i = 0; i < NR; i++ ) {
    if ( i >= nR ) break;
    Run q = R_[i];
    float r0 = q.c.w, rh = q.d.z, fade = q.d.w; bool mv = Rmov[i] > 0.5;
    if ( rh > 0.4 && q.d.y > -10.0 && q.d.y < uLens.y + 10.0 && abs(p.y - q.d.y) < rh * 3.2 + 2.0 ) {
      float st = mv ? 1.22 : 1.0, R1, R2;
      float s1 = blob(p, q.d.xy, rh, 0.06, q.c.x, 0.05, q.c.y, 1.05 * st, R1);
      float yn = q.d.y - rh * 0.95;
      float s2 = blob(p, vec2(xOf(q, yn), yn), rh * (mv ? 0.55 : 0.75), 0.05, 0.0, 0.0, 0.0, 1.14, R2);
      put(smin(s1, s2, 1.6), rh, q.d.xy);
    }
    float px = xOf(q, p.y), dxp = p.x - px;
    if ( abs(dxp) > r0 + 6.0 ) continue;
    float age = ageAt(q, p.y);
    bool fresh = age < 1e8 && p.y < q.d.y - rh * 0.6;
    float wide = 0.55 + 0.10 * r0, br = clamp((age - 0.7) / 1.6, 0.0, 1.0);
    if ( fresh && fade > 0.3 ) {
      bool here = abs(dxp) < wide && hu(int(floor(p.x)), int(floor(p.y)), 340) > br;
      bool right = abs(dxp + 1.0) < wide && hu(int(floor(p.x)) + 1, int(floor(p.y)), 340) > br;
      streak = streak || here;
      lit = lit || (right && !here);
    }
    if ( fresh && abs(dxp) < r0 * 0.9 ) clear = max(clear, (1.0 - clamp(age / 4.0, 0.0, 1.0)) * fade);
    // trail beads at jittered spacing (4.5-9 px) behind the head
    float j0 = floor((p.y - q.a.y) / 6.75);
    for ( int dj = -1; dj <= 1; dj++ ) {
      float j = j0 + float(dj);
      if ( j < 0.0 ) continue;
      int ij = int(j), k = Rkey[i];
      float yj = q.a.y + (j + 0.5) * 6.75 + (hu(ij, k, 354) - 0.5) * 2.2;
      if ( yj >= q.d.y - rh - 1.0 ) continue;
      float hj = hu(ij, k, 351);
      if ( hj < 0.12 ) continue;
      float a = ageAt(q, yj);
      if ( a < 0.25 + 0.45 * hj || a > 1e8 ) continue;
      float rj = (0.7 + 1.6 * pow(hu(ij, k, 352), 1.5)) * ss(0.3, 0.9, a - 0.3 * hj) * fade;
      if ( rj < 0.35 ) continue;
      vec2 cj = vec2(xOf(q, yj) + (hu(ij, k, 353) - 0.5) * 1.4, yj);
      if ( rj < 1.2 ) cj = floor(cj) + 0.5;
      float R, s = blob(p, cj, rj, 0.08, hj * 6.0, 0.05, hj * 3.0, 1.14, R);
      put(s, R, cj);
    }
  }
  // mist specks
  bool mist = false;
  if ( uRainA.w > 0.0 ) {
    int ix = int(floor(p.x)), iy = int(floor(p.y));
    float hk = hu(ix, iy, 360), kk = hk < 0.3333 ? 1.0 : hk < 0.6667 ? 2.0 : 3.0, L, tau; int c;
    cycle(ix, iy, 360, kk, L, c, tau);
    mist = clear < 0.3 && hu(ix * 13 + c, iy, 362) < uRainA.w * dens(p) * intensityAgo(tau);
  }

  // ---------------- shading: (add, k) -> the frame under the lens px becomes dst x k + add
  float ex = min(p.x, uLens.x - p.x) / (0.2 * uLens.x), ey = min(p.y, uLens.y - p.y) / (0.24 * uLens.y);
  float film = (0.09 + 0.13 * (1.0 - clamp(min(ex, ey), 0.0, 1.0))) * (1.0 - clear) * uFilm;
  vec3 add = film * vec3(0.78, 0.82, 0.88) * uLight; float k = 1.0 - film;
  bool inside = sdf < 0.0;
  if ( streak && !inside ) { add = vec3(0.04) * uLight; k = 0.6; }
  if ( lit && !inside && hu(int(floor(p.x)), int(floor(p.y / 3.0)), 345) < 0.6 ) { add = vec3(0.2) * uLight; k = 0.85; }
  if ( mist && !inside ) { add = vec3(0.12) * uLight; k = 1.0; }
  if ( sat && !inside ) { add = vec3(0.16) * uLight; k = 0.9; }
  if ( !inside && sdf < 1.0 && p.y - dc.y > 0.45 * dR ) { add = vec3(0.0); k = 0.78; }     // contact shadow under the drop
  if ( inside ) {
    vec2 n = (p - dc) / max(dR, 0.5);
    bool big = dR >= 3.0;
    float km = big ? -0.42 : 0.5;
    vec2 sp = floor(dc + (p - dc) * km - vec2(0.0, big ? dR * 0.25 : 0.0)) + 0.5;
    vec2 uv = sp * uMap.xy + uMap.zw;
    bool onMap = uHasBg > 0.5 && all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
    vec3 src = onMap ? (texture(uBg, uv).rgb * (1.0 - 0.29 * uWet) + vec3(0.0, 0.012, 0.035) * uWet) * uLight : vec3(0.0);
    // body: the refracted map; off the map, the frame itself (k form)
    vec3 bAdd = onMap ? src * 0.86 + 0.11 * vec3(0.86, 0.91, 1.0) * uLight : 0.11 * vec3(0.86, 0.91, 1.0) * uLight; float bK = onMap ? 0.0 : 0.86;
    bool rim = sdf > -1.0, low = rim && n.y > -0.35;
    if ( low ) { bAdd = onMap ? src * 0.42 : vec3(0.0); bK = onMap ? 0.0 : 0.42; }
    else if ( rim ) { bAdd = (onMap ? src * 0.74 : vec3(0.0)) + 0.05 * uLight; bK = onMap ? 0.0 : 0.74; }
    if ( !rim && dR >= 2.2 && n.y > 0.25 && length(n) > 0.35 ) bAdd += 0.17 * uLight;          // the lower caustic crescent
    if ( dR < 1.25 ) { bAdd = vec3(0.13) * uLight; bK = 1.0; }                                 // tiny: one lighter px
    else if ( length(p - (dc - vec2(0.38, 0.42) * dR)) < max(0.72, 0.26 * dR) ) { bAdd = vec3(0.97, 0.98, 1.0) * uLight; bK = 0.0; }
    add = bAdd; k = bK;
  }
  A_ = A0 * k + add; K_ = K0 * k;
  if ( starHit == 1 ) over(0.72, vec3(0.0));
  else if ( starHit == 2 ) over(0.0, vec3(0.93, 0.97, 1.0) * uLight);
  else if ( starHit == 3 ) over(0.0, vec3(uLight));
  sandLens(p);
  dustLens(p);
  heatLens(p);
  fragColor = vec4(clamp(A_, 0.0, 1.0), clamp(K_, 0.0, 1.0));
}`;

let lensProg = null;

/** A sprite drawn in screen space whatever its parent's transform (the stage pans and zooms; the glass does not). */
class ScreenSprite extends PIXI.Sprite {
  updateTransform() {
    const t = this.transform;
    t.worldTransform.set(this.px, 0, 0, this.px, 0, 0);
    t._worldID++;
    this.worldAlpha = this.alpha;
  }
}

export class WeatherLens {
  constructor() {
    this.stats = { lw: 0, lh: 0, lpx: 0, renders: 0, passMs: 0 };
    this.now = null; this.state = null; this.P = null;
    this.key = ""; this.int = new Float32Array(121);
    this.fx = { snow: [0, 0, 0, 0], sand: [0, 0, 0, 0], dust: [0, 0, 0, 0], dust2: [0, 0, 0, 0], heat: [0, 0, 0, 0] };
    this._tick = () => this.tick();
    canvas.app.ticker.add(this._tick);
  }

  /** The state (engine, <= 12 Hz). */
  setState(st, P) {
    this.state = st; this.P = P;
    const rain = st?.fx?.rain, s = M.lensS(P, rain?.s ?? 0, st?.lensCap ?? 0), p = (rain?.p ?? 0) * (P?.lens?.strength ?? 1);
    const G = rain ? M.lensGates("rain", s) : { bead: 0, big: 0, run: 0, mist: 0, film: 0 };
    this.gates = [G.bead * p, G.big, G.run * p, G.mist * p, G.film * p];
    // the other effects: each at its own lens level (auto: the effect's level), presence x strength
    const str = P?.lens?.strength ?? 1, cap = st?.lensCap ?? 0;
    const at = (e) => { const f = st?.fx?.[e]; if ( !f ) return null; return { G: M.lensGates(e, M.lensS(P, f.s, cap)), p: f.p * str }; };
    const sn = at("snow"), sa = at("sand"), du = at("dust"), em = P?.lens?.heat ? at("embers") : null;
    this.fx.snow = sn ? [sn.G.frost, sn.G.wob, sn.G.crystals, sn.p] : [0, 0, 0, 0];
    this.fx.sand = sa ? [sa.G.deposit * sa.p, sa.G.scratch * sa.p, sa.G.impacts, sa.p] : [0, 0, 0, 0];
    this.fx.dust = du ? [du.G.specks, du.G.discs, du.G.glare, Math.round(du.G.ghosts)] : [0, 0, 0, 0];
    this.fx.dust2 = du ? [du.G.ghostK, du.G.smudge, du.p, 0] : [0, 0, 0, 0];
    this.fx.heat = em ? [em.G.glow * em.p, em.G.flecks, em.p, 0] : [0, 0, 0, 0];
    this.wind = st?.wind ?? null; this.seed = st?.seed ?? 0;
    this.key = "";   // (re-render on the next frame)
  }

  /** Make (or re-make) the lens target, sprite and pass for this screen size and DPR. */
  ensure() {
    const r = canvas.app.renderer, dpr = r.resolution || 1, lpx = Math.max(1, Math.round(3 * dpr)), css = lpx / dpr;
    const lw = Math.ceil(r.screen.width / css), lh = Math.ceil(r.screen.height / css);
    if ( this.rt && this.stats.lw === lw && this.stats.lh === lh && this.stats.lpx === lpx ) return;
    this.free();
    this.stats.lw = lw; this.stats.lh = lh; this.stats.lpx = lpx;
    this.rt = PIXI.RenderTexture.create({ width: lw, height: lh, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST });
    lensProg ??= PIXI.Program.from(LENS_VERT, LENS_FRAG, "moinen-maps-weather-lens");
    const g = new PIXI.Geometry().addAttribute("aVertexPosition", [0, 0, lw, 0, lw, lh, 0, lh], 2).addIndex([0, 1, 2, 0, 2, 3]);
    const state = PIXI.State.for2d(); state.blend = false;
    this.pass = new PIXI.Mesh(g, new PIXI.Shader(lensProg, {
      uLens: new Float32Array([lw, lh]), uT: 0, uSeed: 0, uRainA: new Float32Array(4), uFilm: 0, uWind: new Float32Array([1, 0, 0]), uSlant: 0,
      uG: this.int, uSnowL: new Float32Array(4), uSandL: new Float32Array(4), uDustL: new Float32Array(4), uDustL2: new Float32Array(4), uHeatL: new Float32Array(4),
      uBg: PIXI.Texture.WHITE, uMap: new Float32Array(4), uHasBg: 0, uLight: 1, uWet: 0, translationMatrix: new PIXI.Matrix().toArray(true)
    }), state);
    this.sprite = new ScreenSprite(this.rt);
    this.sprite.px = css;
    this.sprite.blendMode = blendMode();
    this.sprite.eventMode = "none";
    canvas.stage.addChild(this.sprite);
  }

  /** Every frame: re-render the lens when its step, the view or the state changed (a compare otherwise). */
  tick() {
    const st = this.state; if ( !st || !canvas.stage ) return;
    this.ensure();
    if ( this.sprite.parent !== canvas.stage || canvas.stage.children.at(-1) !== this.sprite ) canvas.stage.addChild(this.sprite);   // (drawn last)
    const T = ((this.now?.() ?? Date.now()) / 1000) % 3600, q = Math.floor(T * 12), wt = canvas.stage.worldTransform;
    const key = `${q}|${wt.a}|${wt.d}|${wt.tx}|${wt.ty}`;
    if ( key === this.key ) return;
    this.key = key;
    this.render(q / 12, wt);
  }

  render(t, wt) {
    const t0 = performance.now(), u = this.pass.shader.uniforms, [bead, big, run, mist, film] = this.gates ?? [0, 0, 0, 0, 0];
    const css = this.sprite.px;
    u.uT = t; u.uSeed = this.seed | 0;
    u.uRainA[0] = bead; u.uRainA[1] = big; u.uRainA[2] = run; u.uRainA[3] = mist; u.uFilm = film;
    const w = this.wind, [dx, dy] = dirVec(w?.dir ?? 0), ws = Math.min(1, Math.max(0, (w?.str ?? 0) * 2));
    u.uWind[0] = dx; u.uWind[1] = dy; u.uWind[2] = ws;
    u.uSlant = 0.14 * dx * ws;
    // the gust envelope over the last 10 s on the 12 Hz grid (the same on every client)
    for ( let i = 0; i <= 120; i++ ) this.int[i] = gustEnv(t - 10 + i / 12, this.seed | 0);
    u.uSnowL.set(this.fx.snow); u.uSandL.set(this.fx.sand); u.uDustL.set(this.fx.dust); u.uDustL2.set(this.fx.dust2); u.uHeatL.set(this.fx.heat);
    // refraction-lite: lens px -> scene background uv
    const bg = canvas.primary?.background, tex = bg?.texture, R = canvas.dimensions?.sceneRect;
    if ( tex?.valid && R && wt.a ) {
      u.uBg = tex; u.uHasBg = 1;
      u.uMap[0] = css / wt.a / R.width; u.uMap[1] = css / wt.d / R.height;
      u.uMap[2] = (-wt.tx / wt.a - R.x) / R.width; u.uMap[3] = (-wt.ty / wt.d - R.y) / R.height;
    } else u.uHasBg = 0;
    u.uWet = Math.min(1, this.state?.wet ?? 0);
    u.uLight = 1 - 0.7 * Math.min(1, Math.max(0, canvas.environment?.darknessLevel ?? 0));
    canvas.app.renderer.render(this.pass, { renderTexture: this.rt, clear: true });
    this.stats.renders++; this.stats.passMs = performance.now() - t0;
  }

  free() {
    this.sprite?.parent?.removeChild(this.sprite); this.sprite?.destroy(); this.sprite = null;
    this.pass?.geometry?.destroy(); this.pass?.destroy(); this.pass = null;
    this.rt?.destroy(true); this.rt = null;
  }

  destroy() {
    canvas.app?.ticker?.remove(this._tick);
    this.free();
    this.state = null;
  }
}
