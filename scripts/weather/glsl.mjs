/**
 * GLSL shared by the weather passes (ES 3.00). Everything is a pure function of (art cell, shared time): integer hashes of world
 * cells (the same hash as scripts/wind.mjs and the mock-ups), value noise on an integer lattice, fbm with octaves at irrational
 * ratios each rotated (no grid alignment, nothing repeats), a two-phase drift (patches carried by the wind that never loop), and the
 * ground-info lookups (map colour, local contrast, painted-water guess, puddles) shared by the ground pass and the splashes, so a
 * drop that lands in a puddle ripples exactly where the ground pass drew the puddle.
 */
import { GLSL_WIND } from "../wind.mjs";

export const GLSL_COMMON = `
${GLSL_WIND}
float hc(vec2 c, int s) { return hu(int(floor(c.x)), int(floor(c.y)), s); }
float vnoise(vec2 p, int s) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  int x = int(i.x), y = int(i.y);
  float a = hu(x, y, s), b = hu(x + 1, y, s), c = hu(x, y + 1, s), d = hu(x + 1, y + 1, s);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// octaves at 1 : 2.17 : 4.71, each rotated (0, 17, 41 deg) and offset: no lattice alignment
float fbm2(vec2 p, int s) {
  vec2 q = mat2(0.9563, 0.2924, -0.2924, 0.9563) * p * 2.17 + vec2(17.3, -9.1);
  return (vnoise(p, s) + 0.5 * vnoise(q, s + 1)) / 1.5;
}
float fbm3(vec2 p, int s) {
  vec2 q = mat2(0.9563, 0.2924, -0.2924, 0.9563) * p * 2.17 + vec2(17.3, -9.1);
  vec2 r = mat2(0.7547, 0.6561, -0.6561, 0.7547) * p * 4.71 + vec2(-31.7, 5.3);
  return (vnoise(p, s) + 0.5 * vnoise(q, s + 1) + 0.25 * vnoise(r, s + 2)) / 1.75;
}
float ss01(float a, float b, float x) { return smoothstep(a, b, x); }

// A FIELD CARRIED BY A VELOCITY v (art px / s) that never loops: two phases of period P, each restarting (with a new hashed offset)
// while its weight is 0, cross-faded by triangles. fbm2 at scale sc (art px per noise unit).
float drift2(vec2 c, vec2 v, float t, float P, float sc, int s) {
  float a = t / P, b = a + 0.5;
  float ka = floor(a), kb = floor(b), fa = a - ka, fb = b - kb;
  vec2 oa = vec2(hu(int(ka), 3, s), hu(int(ka), 4, s)) * 97.0, ob = vec2(hu(int(kb), 5, s), hu(int(kb), 6, s)) * 97.0;
  float na = fbm2((c - v * fa * P) / sc + oa, s), nb = fbm2((c - v * fb * P) / sc + ob, s + 7);
  float wa = 1.0 - abs(2.0 * fa - 1.0);
  return mix(nb, na, wa);
}

/* ---- the ground info (map at art resolution: rgb, a = local contrast x 4) and the shelter mask (r roofs, g regions, b scene edge) */
uniform sampler2D uInfo;
uniform vec3 uInfoGeo;      // texels w, h, art cells per texel
uniform int uHasInfo;
uniform sampler2D uShelter;
uniform int uHasShelter;
uniform vec2 uArtSize;      // the scene in art cells
uniform int uSeed;
// tornado vortices (wind.mjs vortices, up to 3): centre x, y (art cells from the scene origin), reach, core radius (art cells); the
// tangential speed at the core and the inflow (art cells / s), presence; how many
uniform vec4 uVortA[3];
uniform vec4 uVortB[3];
uniform int uVortN;
// the wind the tornadoes add at art cell g (art cells / s): a counter-clockwise swirl (on the map) and an inflow, gone beyond the reach
vec2 vortexAt(vec2 g) {
  vec2 w = vec2(0.0);
  for ( int k = 0; k < 3; k++ ) {
    if ( k >= uVortN ) break;
    vec2 d = g - uVortA[k].xy; float r = length(d);
    if ( r >= uVortA[k].z || r < 1e-3 ) continue;
    float fall = 1.0 - smoothstep(uVortA[k].z * 0.45, uVortA[k].z, r);
    float tang = uVortB[k].x * uVortA[k].w / max(r, uVortA[k].w) * fall * uVortB[k].z;
    float inn = uVortB[k].y * fall * uVortB[k].z * min(1.0, r / uVortA[k].w);
    w += vec2(d.y, -d.x) / r * tang - d / r * inn;
  }
  return w;
}

vec4 infoAt(vec2 c) {
  if ( uHasInfo == 0 ) return vec4(0.5, 0.5, 0.5, 0.0);
  ivec2 q = ivec2(clamp(floor(c / uInfoGeo.z), vec2(0.0), uInfoGeo.xy - 1.0));
  return texelFetch(uInfo, q, 0);
}
float lumOf(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
bool waterOf(vec4 i) { return i.b > i.r + 0.04 && lumOf(i.rgb) < 0.36; }
// open sky at a cell (1 = open, 0 = under a roof / in a Suppress Weather region / off the scene), dithered over the fade rim
// roofs: whether roofs count (the ground and the splashes: yes; falling drops: no, they fall onto the roof)
float openAt(vec2 c, bool roofs) {
  vec2 e = min(c + 0.5, uArtSize - c - 0.5);
  float edge = clamp(min(e.x, e.y) / 4.0, 0.0, 1.0);
  float o = edge;
  if ( uHasShelter == 1 ) {
    ivec2 q = ivec2(clamp(floor(c / uInfoGeo.z), vec2(0.0), uInfoGeo.xy - 1.0));
    vec4 m = texelFetch(uShelter, q, 0);
    o = min(o, roofs ? min(m.r, m.g) : m.g);
  }
  return o >= 1.0 ? 1.0 : o > hc(c, uSeed + 999) ? 1.0 : 0.0;
}
// a field in pre-scaled coordinates q moving with velocity v (q units / s) that never loops (as drift2, any scaling of q)
float drift2a(vec2 q, vec2 v, float t, float P, int s) {
  float a = t / P, b = a + 0.5;
  float ka = floor(a), kb = floor(b), fa = a - ka, fb = b - kb;
  vec2 oa = vec2(hu(int(ka), 3, s), hu(int(ka), 4, s)) * 97.0, ob = vec2(hu(int(kb), 5, s), hu(int(kb), 6, s)) * 97.0;
  float na = fbm2(q - v * fa * P + oa, s), nb = fbm2(q - v * fb * P + ob, s + 7);
  return mix(nb, na, 1.0 - abs(2.0 * fa - 1.0));
}
float drift3a(vec2 q, vec2 v, float t, float P, int s) {
  float a = t / P, b = a + 0.5;
  float ka = floor(a), kb = floor(b), fa = a - ka, fb = b - kb;
  vec2 oa = vec2(hu(int(ka), 3, s), hu(int(ka), 4, s)) * 97.0, ob = vec2(hu(int(kb), 5, s), hu(int(kb), 6, s)) * 97.0;
  float na = fbm3(q - v * fa * P + oa, s), nb = fbm3(q - v * fb * P + ob, s + 7);
  return mix(nb, na, 1.0 - abs(2.0 * fa - 1.0));
}
// SNOW settles where this score is over the cover threshold (fields.mjs snowScore: the same formula on the CPU for the quantile)
float snowScore(vec2 c, float lum, float con) {
  float warp = fbm2(c / 31.0, uSeed + 41);
  float n = fbm3(c / 19.0 + vec2(4.0, -3.0) * warp, uSeed + 42);
  float flat_ = 1.0 - smoothstep(0.02, 0.14, con), fine = fbm2(c / 6.3, uSeed + 44);
  return 0.42 * n + 0.22 * fine + 0.26 * flat_ + 0.13 * lum + (vnoise(c / 2.0, uSeed + 43) - 0.5) * 0.1;
}
// SAND settles in the lee where this is over the drift threshold (fields.mjs driftScore); wd = the wind's unit vector
float driftScore(vec2 c, float con, vec2 wd) {
  float pr = dot(c, wd), ac = -c.x * wd.y + c.y * wd.x;
  float n = fbm3(vec2(pr / 30.0 + 2.0 * fbm2(c / 50.0, uSeed + 3), ac / 9.0), uSeed + 101);
  return 0.6 * n + 0.4 * (1.0 - smoothstep(0.02, 0.12, con));
}
// SUN SHAFTS (dust): wide warped diagonal bands where motes catch the light
float shaftAt(vec2 c) { return 0.5 + 0.5 * sin(dot(c, vec2(0.8, 0.6)) / 37.0 + 3.0 * fbm2(c / 60.0, uSeed + 181)); }
// a puddle cell (flat, not dark, not water) at a puddle threshold (> 1.3: none)
bool puddleAt(vec2 c, vec4 inf, float thr) {
  if ( thr > 1.3 || uHasInfo == 0 ) return false;
  float con = inf.a * 0.25;
  if ( con >= 0.035 || lumOf(inf.rgb) <= 0.25 || waterOf(inf) ) return false;
  vec2 p = c / 46.0;
  float w = vnoise(p * 0.37 + 11.0, uSeed + 70);
  return fbm3(p + 0.6 * vec2(w, -w), uSeed + 5) > thr;
}
// SMOOTH, NOT CELLED (2026-11-09): every threshold is a soft step over gW art cells (about a device px when zoomed out, ~1.3 cells
// zoomed in, where the cached cells are magnified bilinearly like the map itself), every per-cell hash dither is a smooth noise,
// the map info is read bilinearly and the roof / region fade is a soft ramp, so no edge is a staircase of cells
float gW = 1.3;
float sst(float x, float w) { float s = clamp(x / max(w * gW, 1e-4) + 0.5, 0.0, 1.0); return s * s * (3.0 - 2.0 * s); }
// the ground info read bilinearly (the map is shown smooth: so is what the weather reads from it)
vec4 infoS(vec2 c) {
  if ( uHasInfo == 0 ) return vec4(0.5, 0.5, 0.5, 0.0);
  return texture(uInfo, c / uInfoGeo.z / uInfoGeo.xy);
}
// open sky 0..1 (1 = open; the roof / region / scene-edge ramp as it is, soft)
float openS(vec2 c, bool roofs) {
  vec2 e = min(c, uArtSize - c);
  float o = clamp(min(e.x, e.y) / 4.0, 0.0, 1.0);
  if ( uHasShelter == 1 ) {
    vec4 m = texture(uShelter, c / uInfoGeo.z / uInfoGeo.xy);
    o = min(o, roofs ? min(m.r, m.g) : m.g);
  }
  return smoothstep(0.0, 1.0, o);
}
float waterS(vec4 i) { return sst(i.b - i.r - 0.04, 0.02) * sst(0.36 - lumOf(i.rgb), 0.02); }
`;

/* ================================================================== GROUND (wet tint, puddles, sheen) */

export const GROUND_VERT = `#version 300 es
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

export const GROUND_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform float uTime;        // shared clock, s mod 3600
uniform float uK;           // (the old footprint scale: kept for the cell pass's uniforms; the look no longer uses it)
uniform float uWet;         // wet ground 0..~1 (accumulated)
uniform float uPuddle;      // puddle threshold (> 1.3: none)
uniform float uSheen;       // glints: fraction of sheen spots lit at a moment
uniform vec3 uSky;
uniform float uAlpha;
uniform vec4 uSnow;         // cover threshold (> 8: none), thick (0 dusting .. 1 full ramp), cold tint (x presence), glints
uniform vec4 uSand;         // streamer threshold, the wave's push, drift threshold (> 8: none), ochre tint (x presence)
uniform vec4 uSandW;        // wind unit x, y; streamer speed (art px / s); presence
uniform vec2 uDust;         // shafts, warm tint (x presence)
uniform vec4 uEmb;          // source share, dim (fire-lit evening), presence, -
uniform vec4 uWindG;        // visible wind: presence, grass-combing threshold, - (its cloud shadows: clouds.mjs), overall dim
uniform vec4 uWindV;        // the wind's unit direction x, y; its speed (art px / s); water ruffle (x presence)
uniform float uCps;         // art cells per grid square
uniform int uAny;           // anything to draw (else every cell is "no change")
out vec4 fragColor;
${GLSL_COMMON}

const vec3 OCHRE = vec3(0.82, 0.62, 0.36);
vec3 snowRamp(int i) { return i <= 0 ? vec3(0.64, 0.67, 0.75) : i == 1 ? vec3(0.79, 0.82, 0.88) : i == 2 ? vec3(0.89, 0.91, 0.95) : vec3(0.97, 0.98, 0.99); }
// the ramp at a continuous index (soft steps between its four tones: still banded, never a hard pixel edge)
vec3 snowRampF(float x) {
  x = clamp(x, 0.0, 3.0); int i = int(min(floor(x), 2.0));
  return mix(snowRamp(i), snowRamp(i + 1), smoothstep(0.25, 0.75, x - float(i)));
}
// a colour multiply t applied to (add, k) with one scalar k: the hue goes into add through the map's own colour M (exact on the map)
vec4 tint(vec4 f, vec3 t, vec3 M) {
  float kt = min(1.0, min(t.r, min(t.g, t.b)));
  return vec4(f.rgb * t + (t - kt) * M * f.a, f.a * kt);
}

float puddleField(vec2 c) {
  vec2 p = c / 46.0;
  float w = vnoise(p * 0.37 + 11.0, uSeed + 70);
  return fbm3(p + 0.6 * vec2(w, -w), uSeed + 5);
}

// the smooth fields once per evaluation point (scales of 6+ cells); gPd/gPdY: the puddle field and its slope down the screen
float gWv = 0.0, gFr = 0.0, gSh = 0.0, gWg = 0.0, gComb = 0.0, gRuf = 0.0, gNn = 0.0, gGl = 0.0, gPd = 0.0, gPdY = 0.0;
void groundFields(vec2 c) {
  if ( uWindG.x > 0.0 ) {
    // VISIBLE WIND: the gust at this place (fronts travel along the wind), combing bands carried downwind (crests across the wind,
    // a field that never loops), cat's-paw patches on water (its cloud shadows: the cloud layer, clouds.mjs)
    vec2 wd = uWindV.xy;
    float pr = dot(c, wd), ac = -c.x * wd.y + c.y * wd.x;
    gWg = clamp(gustEnv(uTime - pr / (uCps * 4.0), uSeed), 0.0, 1.2);
    // the surface terms only where the map is grass or water (the rest of the map pays nothing for them)
    vec4 I = infoS(c);
    vec3 M = I.rgb;
    if ( M.g > M.r * 1.02 && M.g > M.b * 1.06 ) {
      gComb = drift2a(vec2(pr / 22.0, ac / 90.0), vec2(uWindV.z * 1.2 / 22.0, 0.0), uTime, 30.0, uSeed + 201);
      gNn = fbm2(vec2(pr / 26.0, ac / 2.6), uSeed + 204);
    }
    if ( uWindV.w > 0.0 && I.b > I.r && lumOf(M) < 0.4 ) {
      gRuf = drift2a(vec2(pr / 16.0, ac / 40.0), vec2(uWindV.z * 1.6 / 16.0, 0.0), uTime, 20.0, uSeed + 205);
      if ( gRuf > 0.5 ) gGl = drift2a(vec2(pr / 3.0, ac / 1.2), vec2(uWindV.z * 2.0 / 3.0, 0.0), uTime, 6.0, uSeed + 207);
    }
  }
  if ( uWet > 0.0005 ) {
    gWv = fbm2(c / 70.0 + vec2(3.0, 0.0), uSeed + 9);
    if ( uPuddle < 1.3 && uHasInfo == 1 ) { gPd = puddleField(c); gPdY = puddleField(c - vec2(0.0, 1.0)); }
  }
  if ( uSandW.w > 0.0 ) {
    vec2 wd = uSandW.xy;
    float pr = dot(c, wd), ac = -c.x * wd.y + c.y * wd.x;
    float rag = 140.0 * (fbm2(vec2(ac / 95.0, pr / 300.0), uSeed + 141) - 0.5);
    gFr = clamp(gustEnv(uTime - (pr + rag) / (uCps * 4.0), uSeed), 0.0, 1.2);
  }
  if ( uDust.x > 0.0 ) gSh = shaftAt(c);
}

// one evaluation point c (continuous art cells): (add.rgb, k): the frame under it becomes dst * k + add (custom blend ONE, SRC_ALPHA)
vec4 cellGround(vec2 c) {
  if ( uAny == 0 || c.x < 0.0 || c.y < 0.0 || c.x >= uArtSize.x || c.y >= uArtSize.y ) return vec4(0.0, 0.0, 0.0, 1.0);
  float op = openS(c, true);
  vec4 inf = infoS(c);
  vec3 M = inf.rgb;
  float lum = lumOf(M), con = inf.a * 0.25;
  float nz = vnoise(c / 2.6, uSeed + 998);           // (the smooth stand-in for the old per-cell dither)
  float water = waterS(inf);
  vec4 f = vec4(0.0, 0.0, 0.0, 1.0);
  // ---- RAIN: wet ground, puddles (their sheen glints are drawn per screen px: groundGlints)
  if ( uWet > 0.0005 ) {
    float W = min(uWet, 1.2);
    float band = sst(smoothstep(0.35, 0.65, gWv) * 0.28 + 0.72 - 0.86 - (nz - 0.5) * 0.12, 0.05);
    float kf = mix(mix(0.744, 0.80, band), 0.97, water) * 0.95;
    vec3 add = vec3(0.0, 0.012, 0.035) * W;
    float k = 1.0 - W * (1.0 - kf);
    if ( uPuddle < 1.3 && uHasInfo == 1 ) {
      float thr = uPuddle + (1.0 - min(W, 1.0)) * 0.35;
      float el = sst(0.035 - con, 0.008) * sst(lum - 0.25, 0.02) * (1.0 - water);
      float pw = el * sst(gPd - thr, 0.025);
      if ( pw > 0.0 ) {
        // the puddle: darker, a cool sheen; its upper rim (where the puddle begins going down the screen) catches the sky
        float rim = pw * (1.0 - sst(gPdY - thr, 0.025)) * smoothstep(0.25, 0.45, vnoise(c / 2.2, uSeed + 99));
        float kp = 1.0 - W * (1.0 - 0.60);
        vec3 ap = vec3(0.0, 0.02, 0.06) * W;
        k = mix(k, kp, pw); add = mix(add, ap, pw);
        k = mix(k, 1.0, rim); add = mix(add, 0.16 * uSky * W, rim);
      }
    }
    f = vec4(add, k);
  }
  f = mix(vec4(0.0, 0.0, 0.0, 1.0), f, op);
  // ---- tints (the light of the weather: everywhere, under roofs too)
  if ( uSnow.z > 0.0 ) f = tint(f, mix(vec3(0.99), mix(vec3(0.84, 0.88, 0.98), vec3(0.82, 0.86, 0.95), water), uSnow.z), M);
  if ( uSand.w > 0.0 ) f = tint(f, mix(vec3(1.0), vec3(1.0, 0.88, 0.70) * 0.86, uSand.w), M);
  if ( uDust.y > 0.0 ) f = tint(f, mix(vec3(1.0), vec3(1.04, 1.0, 0.90), uDust.y), M);
  if ( uEmb.z > 0.0 ) {
    // a dim, warm evening: the same light everywhere (the fires are somewhere upwind, not on this map)
    vec3 lit = vec3(0.42, 0.40, 0.48) + 0.5 * vec3(0.55, 0.30, 0.08);
    f = tint(f, mix(vec3(1.0), mix(vec3(1.02, 0.98, 0.94), lit, uEmb.y), uEmb.z), M);
  }
  if ( uWindG.x > 0.0 ) {
    // wind: an overall dim (its cloud shadows from level 2: the cloud layer, clouds.mjs)
    vec3 mul = vec3(1.0 - (1.0 - uWindG.w) * uWindG.x);
    if ( mul != vec3(1.0) ) f = tint(f, mul, M);
  }
  if ( op <= 0.0 ) return f;
  vec4 f0 = f;
  if ( uWindG.x > 0.0 ) {
    // GRASS combing: gusts sweep over the green as bands of lighter blades (their undersides), broken into blade streaks
    float green = sst(M.g - M.r * 1.08, 0.015) * sst(M.g - M.b * 1.15, 0.015) * (1.0 - water);
    if ( green > 0.0 ) {
      float x = smoothstep(0.35, 0.75, gComb) * gWg * (0.3 + gNn) - uWindG.y - (nz - 0.5) * 0.06;
      f.rgb += (M * 0.18 + 0.05) * uWindG.x * green * sst(x, 0.08);
    }
    // WATER ruffle: darker cat's paws running with the gusts, broken light dashes along the wind inside them
    if ( water > 0.0 && uWindV.w > 0.0 ) {
      float paw = smoothstep(0.5, 0.7, gRuf) * clamp(gWg * 1.1, 0.0, 1.0) * water;
      f = vec4(f.rgb * (1.0 - 0.08 * paw * uWindV.w), f.a * (1.0 - 0.08 * paw * uWindV.w));
      f.rgb += 0.13 * uSky * uWindV.w * sst(paw - 0.2, 0.05) * sst(gGl - (0.80 - 0.10 * paw), 0.08);
    }
  }
  // ---- SNOW cover: where the score is over the threshold, the snow ramp replaces the map (its lines print through)
  if ( uSnow.x < 8.0 ) {
    float d = snowScore(c, lum, con) - uSnow.x;
    float sc = sst(d - (nz - 0.5) * 0.06, 0.03) * (1.0 - water);
    if ( sc > 0.0 ) {
      float ix = lum * 3.2 + 1.2 + (nz - 0.5) * 0.7 - 0.5;
      ix -= 2.0 * smoothstep(0.07, 0.11, con);                                   // the map's lines print through
      ix -= 1.0 - smoothstep(0.18, 0.32, vnoise(c / 2.2, uSeed + 45));                 // a few darker flecks
      ix -= 1.0 - smoothstep(0.0, 0.05, d);                                      // the rim thins out
      vec3 full = snowRampF(ix) * 0.76 + 0.02, dust_ = snowRampF(ix - 1.0) * 0.55 + 0.03;
      f = mix(f, vec4(mix(dust_, full, uSnow.y), mix(0.45, 0.24, uSnow.y)), sc);
    }
  }
  // ---- SAND: drifts in the lee, streamers racing along the ground in the waves
  if ( uSandW.w > 0.0 ) {
    vec2 wd = uSandW.xy;
    float dry = 1.0 - water;
    if ( uSand.z < 8.0 ) f = mix(f, vec4(OCHRE * 0.72, 0.35), dry * sst(driftScore(c, con, wd) - uSand.z - (nz - 0.5) * 0.04, 0.03));
    float pr = dot(c, wd), ac = -c.x * wd.y + c.y * wd.x, fr = gFr;
    float s1 = drift2a(vec2(pr / 34.0, ac / 3.2), vec2(uSandW.z / 34.0, 0.0), uTime, 40.0, uSeed + 111);
    f = mix(f, vec4(OCHRE * 0.85 + 0.04, 0.3), uSandW.w * dry * sst(s1 - (uSand.x - uSand.y * fr) - (nz - 0.5) * 0.04, 0.12));
  }
  // ---- DUST: faint sun shafts (additive, two soft steps)
  if ( uDust.x > 0.0 ) {
    float sh = gSh;
    f.rgb += (0.05 * sst(sh - 0.74, 0.02) + 0.04 * sst(sh - 0.88, 0.02)) * uDust.x * vec3(1.0, 0.93, 0.75);
  }
  return op >= 1.0 ? f : mix(f0, f, op);
}

// GLINTS per screen px (never cached: a glint is smaller than a cell): soft round sparks at jittered spots on a 3-cell lattice, each
// spot with its own cycle (a few cycles hold a glint that rises and falls over 0.4 s; rate = lit share at a moment), shown only
// where the ground there takes a glint (flat bright wet ground; snow cover), a small cross flare at their peak
float glintAt(vec2 c, float aa, float rate, int s, out vec2 at) {
  vec2 id = floor(c / 3.0);
  int ix = int(id.x), iy = int(id.y);
  float h = hu(ix, iy, uSeed + s), P = 1.5 + 1.5 * h;
  float u = (uTime + h * P) / P, cyc = floor(u), ph = (u - cyc) * P;
  at = (id + 0.2 + 0.6 * vec2(hu(ix, iy, uSeed + s + 2), hu(ix, iy, uSeed + s + 3))) * 3.0;
  if ( ph >= 0.4 || hu(ix * 7 + int(mod(cyc, 4096.0)), iy, uSeed + s + 1) >= rate * P / 0.4 ) return 0.0;
  float e = sin(3.14159 * ph / 0.4);
  vec2 d = c - at;
  float r = 0.45 + 0.25 * e;
  float core = clamp(0.5 - (length(d) - r) / max(aa, 0.35), 0.0, 1.0);
  float fl = max(1.0 - abs(d.y) / max(aa, 0.18), 0.0) * max(1.0 - abs(d.x) / (1.6 * e + 0.01), 0.0)
           + max(1.0 - abs(d.x) / max(aa, 0.18), 0.0) * max(1.0 - abs(d.y) / (1.2 * e + 0.01), 0.0);
  return e * max(core, 0.6 * clamp(fl, 0.0, 1.0) * e);
}
vec4 groundGlints(vec2 c, float aa, vec4 f) {
  if ( uAny == 0 ) return f;
  vec2 at;
  if ( uWet > 0.0005 && uSheen > 0.0 ) {
    float e = glintAt(c, aa, uSheen * min(uWet, 1.0), 3, at);
    if ( e > 0.0 ) {
      vec4 inf = infoAt(at);
      float con = inf.a * 0.25, lum = lumOf(inf.rgb);
      bool pud = uPuddle < 1.3 && puddleAt(floor(at), inf, uPuddle + (1.0 - min(uWet, 1.0)) * 0.35);
      if ( !waterOf(inf) && lum > 0.5 && con < 0.05 && !pud && openAt(at, true) > 0.5 ) {
        e *= 0.6; f = vec4(f.rgb * (1.0 - e) + e * mix(uSky, vec3(1.0), 0.3), f.a * (1.0 - e));
      }
    }
  }
  if ( uSnow.x < 8.0 && uSnow.w > 0.0 ) {
    float e = glintAt(c, aa, uSnow.w, 46, at);
    if ( e > 0.0 ) {
      vec4 inf = infoAt(at);
      float lum = lumOf(inf.rgb);
      if ( lum > 0.4 && !waterOf(inf) && snowScore(at, lum, inf.a * 0.25) - uSnow.x > 0.03 && openAt(at, true) > 0.5 ) f = mix(f, vec4(1.0, 1.0, 1.0, 0.0), e);
    }
  }
  return f;
}

// ---- main (the direct pass: one evaluation per screen px; cells.mjs makes the cached cell pass and its show pass from the above)
void main() {
  vec2 c = vCell;
  vec2 fw = fwidth(vCell);
  gW = max(1.3, max(fw.x, fw.y));
  if ( uAny != 0 ) groundFields(c);
  vec4 f = groundGlints(c, max(max(fw.x, fw.y), 1e-3), cellGround(c));
  // (a fading layer: toward "no change")
  fragColor = vec4(f.rgb * uAlpha, 1.0 - uAlpha * (1.0 - f.a));
}`;


/* ================================================================== RAIN (instanced drops: streaks in the air, splashes on the ground) */


/**
 * SHAPES drawn per screen pixel (the rain, the particles, the steam): `AA` = art px per device px at the fragment (set from fwidth
 * before use); `cov(sd, r, soft)` = coverage of a shape of size r at signed distance sd (art px, < 0 inside), its edge soft over a
 * device px or `soft` art px, whichever is wider; a shape smaller than a device px is widened to one and keeps its weight (r / width),
 * so it neither flickers nor vanishes zoomed out. `lay(o, col)` lays a shape (opacity o, colour col) over the ones before it, building
 * the weather blend (dst x K_ + A_). Needs `hu` declared before it.
 */
export const GLSL_SHAPES = `
float n1(float x, int s) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hu(int(i), 7, s), hu(int(i) + 1, 7, s), f); }
float AA = 1.0;
float cov(float sd, float r, float soft) {
  float s = max(AA, soft), we = max(r, 0.5 * AA);
  return clamp(0.5 - (sd - (we - r)) / s, 0.0, 1.0) * min(1.0, r / we);
}
float segT(vec2 p, vec2 a, vec2 b, out float t) {
  vec2 ab = b - a; float L = dot(ab, ab);
  t = L > 1e-6 ? clamp(dot(p - a, ab) / L, 0.0, 1.0) : 1.0;
  return length(p - a - ab * t);
}
vec3 A_ = vec3(0.0); float K_ = 1.0;
void lay(float o, vec3 col) { o = clamp(o, 0.0, 1.0); A_ = A_ * (1.0 - o) + col * o; K_ *= 1.0 - o; }
void glow(vec3 a) { A_ += a; }   // (light added: dst unchanged under it)
`;
//
// Drawn per SCREEN pixel at any zoom: the drop's path and landing point are continuous (art px, not whole cells); a streak is an
// antialiased capsule along its path, a splash soft rings, a crown and droplets. AA = art px per device px (from fwidth): a feature
// thinner than a device px keeps its weight (coverage x width) instead of flickering. uPx (the same, from the CPU) widens the quads.

export const RAIN_VERT = `#version 300 es
precision highp float;
precision highp int;
in vec2 aVertexPosition;     // (only for the mesh's bounds)
in vec2 aCorner;             // 0..1 corner of the instance's quad
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec2 uScreen;        // canvas screen dimensions (CSS px): the depth mask's coordinates
uniform float uTime;
uniform vec4 uTiles;         // first tile x, y; tiles across, down (64 art px each)
uniform vec3 uPer;           // slots per tile per layer (mid, far, near) in this draw
uniform vec3 uDens;          // live drops per tile per layer (fractional)
uniform vec4 uOrigin;        // scene rect x, y; art px (scene px); art cells per grid square
uniform vec2 uWindDir;
uniform vec2 uWindK;         // art px / s at factor 1, gust amount
uniform vec2 uView;          // lift, squash
uniform vec3 uVF;            // fall speeds mid, far, near (art px / s)
uniform float uExpK;         // streak length factor
uniform vec2 uSplash;        // crown fraction, ripple fraction (water hits)
uniform float uPuddle;
uniform float uWetP;         // wetness for the puddle threshold
uniform float uI;            // intensity scale (presence x performance)
uniform int uMode;           // 0 air (streaks), 1 ground (splashes, ripples)
uniform float uPx;           // art px per device px now (the quads' antialiasing margin)
out vec2 vArt;
out vec2 vScr;
flat out vec4 vSeg;          // air: tail xy, head xy (art); ground: landing point xy, time since landing, -
flat out ivec2 vKind;        // layer, sub-kind (ground: 0 splash, 1 ripple, 2 crown)
flat out float vH;
flat out vec4 vDa;           // crown: the rim droplets' angles 0-3; droplet 4's angle, the two arc droplets' hashes, droplet 4's height
flat out vec4 vDb;
flat out vec4 vDc;           // crown: the rim droplets' heights 0-3
${GLSL_COMMON}

float intensityAt(vec2 g, float t) {
  float p = drift2(g, uWindDir * uWindK.x * 0.8, t, 30.0, 150.0, uSeed + 31);
  float swell = 0.78 + 0.22 * sin(6.283185 * 108.0 * t / 3600.0 + 0.7);
  float G = gustAt(g / uOrigin.w, uWindDir, t, uSeed);
  return clamp((0.25 + 1.05 * smoothstep(0.25, 0.8, p)) * swell * (0.85 + 0.3 * clamp(G, 0.0, 1.0)), 0.0, 1.15);
}

void hide() { gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); vArt = vec2(0.0); vScr = vec2(0.0); vSeg = vec4(0.0); vKind = ivec2(0); vH = 0.0; vDa = vDb = vDc = vec4(0.0); }
// the corner at art point a
void place(vec2 a) {
  vArt = a;
  vec2 world = uOrigin.xy + a * uOrigin.z;
  vec3 tp = translationMatrix * vec3(world, 1.0);
  vScr = tp.xy / uScreen;
  gl_Position = vec4((projectionMatrix * tp).xy, 0.0, 1.0);
}

void main() {
  int per = int(uPer.x + uPer.y + uPer.z);
  int i = gl_InstanceID, tile = i / per, k = i - tile * per;
  int ntx = int(uTiles.z);
  int tx = int(uTiles.x) + tile % ntx, ty = int(uTiles.y) + tile / ntx;
  int layer = k < int(uPer.x) ? 0 : k < int(uPer.x + uPer.y) ? 1 : 2;
  int j = layer == 0 ? k : layer == 1 ? k - int(uPer.x) : k - int(uPer.x + uPer.y);
  float dens = layer == 0 ? uDens.x : layer == 1 ? uDens.y : uDens.z;
  if ( float(j) >= ceil(dens) ) { hide(); return; }
  int sd = uSeed * 7 + (layer == 0 ? 11 : layer == 1 ? 23 : 37);
  int key = tx * 64 + j;
  // the slot's life: a whole number of cycles per hour (0.67 .. 1.43 s): seamless at the hour wrap, never in step with others
  float kc = 2520.0 + floor(hu(key, ty, sd) * 2881.0), life = 3600.0 / kc;
  float u = (uTime + hu(tx, ty * 64 + j, sd + 1) * life) / life;
  float cyc = mod(floor(u), kc), tau = fract(u) * life;
  int ci = int(cyc);
  float h1 = hu(key, ty * 977 + ci, sd + 2), h2 = hu(key, ty * 977 + ci, sd + 3), h3 = hu(key, ty * 977 + ci, sd + 4), h4 = hu(key, ty * 977 + ci, sd + 5);
  vec2 g = vec2(float(tx) + h1, float(ty) + h2) * 64.0;        // the ground point (art cells from the scene origin)
  if ( g.x < 0.0 || g.y < 0.0 || g.x >= uArtSize.x || g.y >= uArtSize.y ) { hide(); return; }
  // the phase first (a few hashes): the air draws a drop only while it falls, the ground only in the 0.62 s after it lands (every
  // splash, crown and ripple is over by then), so most slots are hidden before the intensity and gust fields are evaluated
  vec2 zr = layer == 0 ? vec2(34.0, 62.0) : layer == 1 ? vec2(18.0, 34.0) : vec2(70.0, 110.0);
  float z0 = zr.x + h3 * (zr.y - zr.x), vf = (layer == 0 ? uVF.x : layer == 1 ? uVF.y : uVF.z) * (0.88 + 0.24 * h4), Df = z0 / vf;
  if ( uMode == 0 ? tau >= Df : (layer == 2 || tau < Df || tau - Df >= 0.62) ) { hide(); return; }
  // the slot is on for this life when its hash is under the intensity at its birth (and the density keeps this slot)
  float birth = uTime - tau;
  float gateD = float(j) < floor(dens) ? 1.0 : fract(dens);
  float on = hu(key, ty * 31 + ci, sd + 6);
  if ( hu(key, ty * 53 + ci, sd + 8) >= gateD || on >= intensityAt(g, birth) * uI * (layer == 2 ? 1.0 : 0.8) ) { hide(); return; }
  vH = hu(key, ty * 13 + ci, sd + 9);
  vDa = vDb = vDc = vec4(0.0);
  vec2 lo, hi;
  float m = 0.2 + 1.2 * uPx;                                 // (the antialiasing margin: a shape reaches at most a device px past its edge)
  if ( uMode == 0 ) {
    if ( openAt(g, false) < 0.5 ) { hide(); return; }
    float G = gustAt(g / uOrigin.w, uWindDir, uTime, uSeed);   // (the wind moves a drop in the air only)
    vec2 W = uWindDir * uWindK.x * windFactor(G, uWindK.y) * (0.85 + 0.3 * hu(j, ci, sd + 7))
      + 0.6 * vortexAt(g);
    float ex = (layer == 0 ? 0.06 : layer == 1 ? 0.045 : 0.07) * uExpK;
    float t1 = tau, t0 = max(tau - ex, 0.0);
    vec2 p1 = g - W * (Df - t1) - vec2(0.0, uView.x * z0 * (1.0 - t1 / Df));
    vec2 p0 = g - W * (Df - t0) - vec2(0.0, uView.x * z0 * (1.0 - t0 / Df));
    vSeg = vec4(p0, p1);
    vKind = ivec2(layer, 0);
    float mm = m + (layer == 2 ? 1.3 : 0.65);                 // (the streak's half width and soft edge)
    // the quad along the streak (a slanted streak's bounding box would be mostly empty)
    vec2 ax = p1 - p0; float L = length(ax); ax = L > 1e-4 ? ax / L : vec2(0.0, 1.0);
    lo = vec2(-mm); hi = vec2(L + mm, mm);
    vec2 q = mix(lo, hi, aCorner), a = p0 + ax * q.x + vec2(-ax.y, ax.x) * q.y;
    place(a);
    return;
  } else {
    if ( layer == 2 || tau < Df ) { hide(); return; }
    float ts = tau - Df;
    vec2 gc = floor(g);
    if ( openAt(gc, true) < 0.5 ) { hide(); return; }
    vec4 inf = infoAt(gc);
    bool wat = waterOf(inf) || puddleAt(gc, inf, uPuddle + (1.0 - min(uWetP, 1.0)) * 0.35);
    if ( wat ) {
      if ( layer != 0 || ts >= 0.62 || vH >= uSplash.y ) { hide(); return; }
      vKind = ivec2(layer, 1);
      float R = 3.3 + ts * 10.0;                             // (the ring's reach now: it grows)
      lo = g - vec2(R, R * uView.y) - m; hi = g + vec2(R, R * uView.y) + m;
    } else {
      bool crown = layer == 0 && hu(key, ty * 7 + ci, sd + 10) < uSplash.x;
      // (each kind's quad only as large as what it draws: a far hit for 0.17 s, a plain splash 0.16 s, a crown and its droplets 0.36 s)
      if ( layer == 1 ? ts >= 0.17 : ts >= (crown ? 0.36 : 0.16) ) { hide(); return; }
      vKind = ivec2(layer, crown ? 2 : 0);
      vec2 r0 = layer == 1 ? vec2(0.9) : vec2(2.0, 1.2), r1 = r0;
      if ( crown ) {
        // the crown's droplets, once per drop (not per pixel): angles round the rim, heights, the arc droplets' lives
        int hv = int(vH * 4093.0), hw = int(vH * 997.0);
        float A[5], Hh[5];
        for ( int q = 0; q < 5; q++ ) { A[q] = (float(q) + 0.5 * hu(q, hv, uSeed + 408)) * 1.2566 + vH * 6.283; Hh[q] = 0.6 + 0.6 * hu(q, hw, uSeed + 409); }
        vDa = vec4(A[0], A[1], A[2], A[3]); vDb = vec4(A[4], hu(0, hv, uSeed + 405), hu(1, hv, uSeed + 405), Hh[4]); vDc = vec4(Hh[0], Hh[1], Hh[2], Hh[3]);
        // its reach now: the ring and rim droplets (radius 1.3 .. 3.3), the arc droplets (out to 2.8 + 3.5 x their flight)
        float f = clamp((ts - 0.04) / 0.24, 0.0, 1.0), sa = clamp((ts - 0.08) / 0.28, 0.0, 1.0);
        float rx = max(2.1 + 2.0 * f, ts >= 0.08 ? 3.5 + 3.5 * sa : 0.0);
        r0 = vec2(rx, 5.5); r1 = vec2(rx, 3.0);
      }
      lo = g - r0 - m; hi = g + r1 + m;
    }
    vSeg = vec4(g, ts, 0.0);
  }
  place(mix(lo, hi, aCorner));
}`;

export const RAIN_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vArt;
in vec2 vScr;
flat in vec4 vSeg;
flat in ivec2 vKind;
flat in float vH;
flat in vec4 vDa;
flat in vec4 vDb;
flat in vec4 vDc;
uniform vec3 uSky;
uniform float uAlpha;
uniform vec2 uView;
uniform sampler2D uDepth;     // Foundry's depth mask (roofs that hide the weather)
uniform float uDepthElev;
uniform int uHasDepth;
uniform int uMode;
uniform int uSeed;
out vec4 fragColor;
float hu(int x, int y, int s) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(s) * 1274126177u;
  h = (h ^ (h >> 13u)) * 1103515245u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}
${GLSL_SHAPES}
void out_() { if ( K_ > 0.9995 ) discard; fragColor = vec4(A_ * uAlpha, 1.0 - uAlpha * (1.0 - K_)); }

void main() {
  vec2 p = vArt;
  vec2 fw = fwidth(vArt);
  AA = max(max(fw.x, fw.y), 1e-3);
  int layer = vKind.x;
  if ( uMode == 0 ) {
    if ( uHasDepth == 1 && step(uDepthElev, (254.5 / 255.0) - texture(uDepth, vScr).b) < 0.5 ) discard;
    // a falling streak: a capsule from its tail to its head, thinner and fainter toward the tail (the drop is at the head)
    float t, d = segT(p, vSeg.xy, vSeg.zw, t);
    float hd = smoothstep(0.15, 0.85, t);
    if ( layer == 0 ) {
      float w = mix(0.36, 0.5, hd);
      lay(cov(d - w, w, 0.25) * mix(0.42, 0.68, hd), 1.12 * uSky);
    } else if ( layer == 1 ) {
      float w = mix(0.26, 0.34, hd);
      lay(cov(d - w, w, 0.25) * mix(0.16, 0.24, hd), 1.05 * uSky);
    } else {
      // near the camera: wider, out of focus, see-through
      float w = mix(0.7, 0.95, hd);
      lay(cov(d - w, w, 0.7) * mix(0.30, 0.46, hd), 1.12 * uSky);
    }
    out_(); return;
  }
  // ground: the hit at its landing point, continuous in time (shapes grow, thin and fade; nothing pops on a frame step)
  vec2 d = p - vSeg.xy;
  float ts = vSeg.z, sq = uView.y;
  float e = length(vec2(d.x, d.y / sq));                     // distance on the ground (the view squashes y)
  if ( vKind.y == 1 ) {
    // a ripple on water or a puddle: a squashed ring growing for 0.62 s, thinning and breaking up along its round; a second,
    // fainter ring inside it once the first has spread
    float f = ts / 0.62, fade = (1.0 - f) * (1.0 - f);
    float r = 2.6 + ts * 10.0, w = mix(0.42, 0.22, f);
    // (most of the quad is off both rings: nothing to draw there, no noise to evaluate)
    float r2_ = 1.2 + (ts - 0.14) * 7.0;
    if ( abs(e - r) - w > 0.3 + AA && (ts <= 0.14 || abs(e - r2_) - 0.25 > 0.3 + AA) ) discard;
    float ang = atan(d.y / sq, d.x);
    float brk = smoothstep(0.18 + 0.55 * f, 0.38 + 0.55 * f, n1(ang * 4.456 + vH * 40.0, uSeed + 404));
    lay(cov(abs(e - r) - w, w, 0.3) * 0.34 * fade * brk, uSky);
    if ( ts > 0.14 ) {
      float r2 = 1.2 + (ts - 0.14) * 7.0, f2 = (ts - 0.14) / 0.48;
      float brk2 = smoothstep(0.3 + 0.5 * f2, 0.5 + 0.5 * f2, n1(ang * 3.18 + vH * 71.0, uSeed + 406));
      lay(cov(abs(e - r2) - 0.25, 0.25, 0.3) * 0.2 * (1.0 - f2) * brk2, uSky);
    }
    out_(); return;
  }
  if ( layer == 1 ) {
    // far drops: a small soft hit for a moment
    float f = ts / 0.17;
    lay(cov(e - 0.45, 0.45, 0.4) * 0.24 * (1.0 - f) * (1.0 - f), 1.4 * uSky);
    out_(); return;
  }
  // the first moment: a bright little smear where it hits, spreading sideways as it fades
  if ( ts < 0.1 ) {
    float f = ts / 0.1;
    vec2 q = vec2(d.x / (0.8 + 0.9 * f), d.y / (0.45 + 0.2 * f));
    lay(cov((length(q) - 1.0) * (0.45 + 0.2 * f), 0.45, 0.4) * 0.5 * (1.0 - f * f), 1.3 * uSky);
  }
  if ( vKind.y != 2 ) {
    // a plain splash: a faint wet dot that fades
    if ( ts < 0.16 ) lay(cov(e - 0.6, 0.6, 0.5) * 0.22 * (1.0 - ts / 0.16), 1.2 * uSky);
    out_(); return;
  }
  // the CROWN: a thin squashed ring that widens and breaks up (its near rim brighter), droplets standing on the rim, lifted and
  // falling back
  if ( ts >= 0.04 && ts < 0.28 ) {
    float f = (ts - 0.04) / 0.24;
    float r = 1.3 + f * 2.0, w = mix(0.38, 0.2, f);
    if ( abs(e - r) - w < 0.3 + AA ) {
      float ang = atan(d.y / sq, d.x);
      float nearRim = mix(0.55, 1.0, smoothstep(-0.6, 0.6, d.y));
      float brk = smoothstep(0.1 + 0.7 * f, 0.3 + 0.7 * f, n1(ang * 2.546 + vH * 33.0, uSeed + 407));
      lay(cov(abs(e - r) - w, w, 0.3) * 0.5 * nearRim * brk * (1.0 - f * f), 1.25 * uSky);
    }
    float top = 8.8 * 0.25 * 1.2 * uView.x, rch = r + 0.55 + 0.32 + 0.3 + AA;     // (where the rim droplets can be)
    if ( abs(d.x) < rch && d.y < rch * sq && d.y > -(rch * sq + top) ) for ( int q = 0; q < 5; q++ ) {
      float a = q < 4 ? vDa[q] : vDb.x;
      float hgt = 8.8 * f * (1.0 - f) * (q < 4 ? vDc[q] : vDb.w) * uView.x;
      vec2 c = vec2(cos(a), sin(a) * sq) * (r + 0.2) - vec2(0.0, hgt);
      lay(cov(length(d - c) - 0.32, 0.32, 0.3) * 0.55 * (1.0 - f), 1.3 * uSky);
    }
  }
  // two droplets thrown out on arcs, falling back
  if ( ts >= 0.08 && ts < 0.36 ) {
    float s = (ts - 0.08) / 0.28;
    for ( int q = 0; q < 2; q++ ) {
      float sx = q == 0 ? -1.0 : 1.0, k = q == 0 ? vDb.y : vDb.z;
      if ( s >= 0.7 + 0.3 * k ) continue;
      vec2 c = vec2(sx * (2.0 + 3.5 * s + 0.8 * step(0.5, vH)), -3.2 * 4.0 * s * (1.0 - s));
      lay(cov(length(d - c) - 0.36, 0.36, 0.3) * 0.5 * (1.0 - smoothstep(0.5, 1.0, s / (0.7 + 0.3 * k))), 1.2 * uSky);
    }
  }
  out_();
}`;
