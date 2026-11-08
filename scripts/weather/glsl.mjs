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
  return 0.42 * n + 0.22 * fine + 0.26 * flat_ + 0.13 * lum + (hc(c, uSeed + 43) - 0.5) * 0.07;
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
uniform float uK;           // footprint scale (0 = nearest)
uniform float uWet;         // wet ground 0..~1 (accumulated)
uniform float uPuddle;      // puddle threshold (> 1.3: none)
uniform float uSheen;       // glints: fraction of sheen cells lit at a moment
uniform vec3 uSky;
uniform float uAlpha;
uniform vec4 uSnow;         // cover threshold (> 8: none), thick (0 dusting .. 1 full ramp), cold tint (x presence), glints
uniform vec4 uSand;         // streamer threshold, the wave's push, drift threshold (> 8: none), ochre tint (x presence)
uniform vec4 uSandW;        // wind unit x, y; streamer speed (art px / s); presence
uniform vec2 uDust;         // shafts, warm tint (x presence)
uniform vec4 uEmb;          // source share, dim (fire-lit evening), presence, -
uniform float uCps;         // art cells per grid square
uniform int uAny;           // anything to draw (else every cell is "no change")
out vec4 fragColor;
${GLSL_COMMON}

const vec3 OCHRE = vec3(0.82, 0.62, 0.36);
vec3 snowRamp(int i) { return i <= 0 ? vec3(0.64, 0.67, 0.75) : i == 1 ? vec3(0.79, 0.82, 0.88) : i == 2 ? vec3(0.89, 0.91, 0.95) : vec3(0.97, 0.98, 0.99); }
// a colour multiply t applied to (add, k) with one scalar k: the hue goes into add through the map's own colour M (exact on the map)
vec4 tint(vec4 f, vec3 t, vec3 M) {
  float kt = min(1.0, min(t.r, min(t.g, t.b)));
  return vec4(f.rgb * t + (t - kt) * M * f.a, f.a * kt);
}
// a smooth glint: a cell's own cycle; a few cycles hold a glint that rises and falls over 0.4 s (rate = lit share at a moment)
float glint(vec2 c, float rate, int s) {
  float h = hc(c, uSeed + s), P = 1.5 + 1.5 * h;
  float u = (uTime + h * P) / P, cyc = floor(u), ph = (u - cyc) * P;
  float on = hu(int(c.x) * 7 + int(mod(cyc, 4096.0)), int(c.y), uSeed + s + 1) < rate * P / 0.4 ? 1.0 : 0.0;
  return on * sin(3.14159 * clamp(ph / 0.4, 0.0, 1.0)) * step(ph, 0.4);
}

// one art cell: (add.rgb, k): the frame under it becomes dst * k + add (custom blend ONE, SRC_ALPHA)
// the smooth fields (scales of 37+ cells) once per pixel, at the cell under it; per-cell terms stay in cellGround
float gWv = 0.0, gFr = 0.0, gSh = 0.0;
void groundFields(vec2 c) {
  if ( uWet > 0.0005 ) gWv = fbm2(c / 70.0 + vec2(3.0, 0.0), uSeed + 9);
  if ( uSandW.w > 0.0 ) {
    vec2 wd = uSandW.xy;
    float pr = dot(c, wd), ac = -c.x * wd.y + c.y * wd.x;
    float rag = 140.0 * (fbm2(vec2(ac / 95.0, pr / 300.0), uSeed + 141) - 0.5);
    gFr = clamp(gustEnv(uTime - (pr + rag) / (uCps * 4.0), uSeed), 0.0, 1.2);
  }
  if ( uDust.x > 0.0 ) gSh = shaftAt(c);
}
vec4 cellGround(vec2 c) {
  if ( uAny == 0 || c.x < 0.0 || c.y < 0.0 || c.x >= uArtSize.x || c.y >= uArtSize.y ) return vec4(0.0, 0.0, 0.0, 1.0);
  bool open = openAt(c, true) > 0.5;
  vec4 inf = infoAt(c);
  vec3 M = inf.rgb;
  float lum = lumOf(M), con = inf.a * 0.25, dz = hc(c, uSeed + 998);
  bool water = waterOf(inf);
  vec4 f = vec4(0.0, 0.0, 0.0, 1.0);
  // ---- RAIN: wet ground, puddles, sheen
  if ( open && uWet > 0.0005 ) {
    float W = min(uWet, 1.2);
    float wv = gWv;
    float band = smoothstep(0.35, 0.65, wv) * 0.28 + 0.72 > 0.86 + (dz - 0.5) * 0.12 ? 1.0 : 0.0;
    float kf = (water ? 0.97 : mix(0.744, 0.80, band)) * 0.95;
    vec3 add = vec3(0.0, 0.012, 0.035) * W;
    float k = 1.0 - W * (1.0 - kf);
    if ( uPuddle < 1.3 && puddleAt(c, inf, uPuddle + (1.0 - min(W, 1.0)) * 0.35) ) {
      k = 1.0 - W * (1.0 - 0.60);
      add = vec3(0.0, 0.02, 0.06) * W;
      if ( !puddleAt(c - vec2(0.0, 1.0), infoAt(c - vec2(0.0, 1.0)), uPuddle + (1.0 - min(W, 1.0)) * 0.35) && hc(c, uSeed + 99) < 0.7 ) { k = 1.0; add = 0.16 * uSky * W; }
    } else if ( !water && lum > 0.5 && con < 0.05 && uSheen > 0.0 ) {
      float e = glint(c, uSheen * min(W, 1.0), 3);
      if ( e > 0.0 ) { k *= 1.0 - 0.6 * e; add = add * (1.0 - 0.6 * e) + 0.6 * e * mix(uSky, vec3(1.0), 0.3); }
    }
    f = vec4(add, k);
  }
  // ---- tints (the light of the weather: everywhere, under roofs too)
  if ( uSnow.z > 0.0 ) f = tint(f, mix(vec3(0.99), water ? vec3(0.82, 0.86, 0.95) : vec3(0.84, 0.88, 0.98), uSnow.z), M);
  if ( uSand.w > 0.0 ) f = tint(f, mix(vec3(1.0), vec3(1.0, 0.88, 0.70) * 0.86, uSand.w), M);
  if ( uDust.y > 0.0 ) f = tint(f, mix(vec3(1.0), vec3(1.04, 1.0, 0.90), uDust.y), M);
  if ( uEmb.z > 0.0 ) {
    // a dim, warm evening: the same light everywhere (the fires are somewhere upwind, not on this map)
    vec3 lit = vec3(0.42, 0.40, 0.48) + 0.5 * vec3(0.55, 0.30, 0.08);
    f = tint(f, mix(vec3(1.0), mix(vec3(1.02, 0.98, 0.94), lit, uEmb.y), uEmb.z), M);
  }
  if ( !open ) return f;
  // ---- SNOW cover: where the score is over the threshold, the snow ramp replaces the map (its lines print through)
  if ( uSnow.x < 8.0 && !water ) {
    float d = snowScore(c, lum, con) - uSnow.x;
    if ( d > (dz - 0.5) * 0.06 ) {
      int idx = int(clamp(floor(lum * 3.2 + 1.2 + (dz - 0.5) * 0.7), 0.0, 3.0));
      if ( con > 0.09 ) idx = max(idx - 2, 0);
      if ( hc(c, uSeed + 45) < 0.14 ) idx = max(idx - 1, 0);
      if ( d < 0.025 ) idx = max(idx - 1, 0);
      vec3 full = snowRamp(idx) * 0.76 + 0.02, dust_ = snowRamp(max(idx - 1, 0)) * 0.55 + 0.03;
      f = vec4(mix(dust_, full, uSnow.y), mix(0.45, 0.24, uSnow.y));
      if ( lum > 0.4 && uSnow.w > 0.0 ) { float e = glint(c, uSnow.w, 46); if ( e > 0.0 ) f = mix(f, vec4(1.0, 1.0, 1.0, 0.0), e); }
    }
  }
  // ---- SAND: drifts in the lee, streamers racing along the ground in the waves
  if ( uSandW.w > 0.0 && !water ) {
    vec2 wd = uSandW.xy;
    if ( uSand.z < 8.0 && driftScore(c, con, wd) - uSand.z > (dz - 0.5) * 0.04 ) f = vec4(OCHRE * 0.72, 0.35);
    float pr = dot(c, wd), ac = -c.x * wd.y + c.y * wd.x, fr = gFr;
    float s1 = drift2a(vec2(pr / 34.0, ac / 3.2), vec2(uSandW.z / 34.0, 0.0), uTime, 40.0, uSeed + 111);
    if ( s1 > uSand.x - uSand.y * fr + (dz - 0.5) * 0.04 ) f = mix(f, vec4(OCHRE * 0.85 + 0.04, 0.3), uSandW.w);
  }
  // ---- DUST: faint sun shafts (additive, flat steps)
  if ( uDust.x > 0.0 ) {
    float sh = gSh;
    f.rgb += ((sh > 0.74 ? 0.05 : 0.0) + (sh > 0.88 ? 0.04 : 0.0)) * uDust.x * vec3(1.0, 0.93, 0.75);
  }
  return f;
}

void axisW(float t, float w, out float i0, out vec3 a) {
  float lo = t - 0.5 * w, hi = t + 0.5 * w;
  i0 = floor(lo);
  a.x = min(i0 + 1.0, hi) - lo;
  a.y = clamp(min(i0 + 2.0, hi) - (i0 + 1.0), 0.0, 1.0);
  a.z = max(0.0, hi - (i0 + 2.0));
  a /= w;
}
void main() {
  vec2 w = fwidth(vCell) * uK;
  vec4 c;
  if ( uAny != 0 ) groundFields(floor(vCell));
  if ( uK <= 0.0 || max(w.x, w.y) < 0.01 ) c = cellGround(floor(vCell));
  else {
    w = clamp(w, vec2(0.01), vec2(2.0));
    float ix, iy; vec3 ax, ay;
    axisW(vCell.x, w.x, ix, ax); axisW(vCell.y, w.y, iy, ay);
    c = vec4(0.0);
    for ( int j = 0; j < 3; j++ ) {
      float wy = ay[j]; if ( wy <= 0.0 ) continue;
      for ( int i = 0; i < 3; i++ ) {
        float wx = ax[i]; if ( wx <= 0.0 ) continue;
        c += wx * wy * cellGround(vec2(ix + float(i), iy + float(j)));
      }
    }
  }
  // (a fading layer: toward "no change")
  fragColor = vec4(c.rgb * uAlpha, 1.0 - uAlpha * (1.0 - c.a));
}`;

/* ================================================================== RAIN (instanced drops: streaks in the air, splashes on the ground) */

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
out vec2 vArt;
out vec2 vScr;
flat out vec4 vSeg;          // air: tail xy, head xy (art); ground: landing cell xy, time since landing, hash
flat out ivec2 vKind;        // layer, sub-kind (ground: 0 splash, 1 ripple)
flat out float vH;
${GLSL_COMMON}

float intensityAt(vec2 g, float t) {
  float p = drift2(g, uWindDir * uWindK.x * 0.8, t, 30.0, 150.0, uSeed + 31);
  float swell = 0.78 + 0.22 * sin(6.283185 * 108.0 * t / 3600.0 + 0.7);
  float G = gustAt(g / uOrigin.w, uWindDir, t, uSeed);
  return clamp((0.25 + 1.05 * smoothstep(0.25, 0.8, p)) * swell * (0.85 + 0.3 * clamp(G, 0.0, 1.0)), 0.0, 1.15);
}

void hide() { gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); vArt = vec2(0.0); vScr = vec2(0.0); vSeg = vec4(0.0); vKind = ivec2(0); vH = 0.0; }

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
  // the slot is on for this life when its hash is under the intensity at its birth (and the density keeps this slot)
  float birth = uTime - tau;
  float gateD = float(j) < floor(dens) ? 1.0 : fract(dens);
  float on = hu(key, ty * 31 + ci, sd + 6);
  if ( on >= intensityAt(g, birth) * uI * (layer == 2 ? 1.0 : 0.8) || hu(key, ty * 53 + ci, sd + 8) >= gateD ) { hide(); return; }
  vec2 zr = layer == 0 ? vec2(34.0, 62.0) : layer == 1 ? vec2(18.0, 34.0) : vec2(70.0, 110.0);
  float z0 = zr.x + h3 * (zr.y - zr.x), vf = (layer == 0 ? uVF.x : layer == 1 ? uVF.y : uVF.z) * (0.88 + 0.24 * h4), Df = z0 / vf;
  float G = gustAt(g / uOrigin.w, uWindDir, uTime, uSeed);
  vec2 W = uWindDir * uWindK.x * windFactor(G, uWindK.y) * (0.85 + 0.3 * hu(j, ci, sd + 7));
  vH = hu(key, ty * 13 + ci, sd + 9);
  vec2 lo, hi;
  if ( uMode == 0 ) {
    if ( tau >= Df ) { hide(); return; }
    if ( openAt(g, false) < 0.5 ) { hide(); return; }
    float ex = (layer == 0 ? 0.06 : layer == 1 ? 0.045 : 0.07) * uExpK;
    float t1 = tau, t0 = max(tau - ex, 0.0);
    vec2 p1 = g - W * (Df - t1) - vec2(0.0, uView.x * z0 * (1.0 - t1 / Df));
    vec2 p0 = g - W * (Df - t0) - vec2(0.0, uView.x * z0 * (1.0 - t0 / Df));
    vSeg = vec4(p0, p1);
    vKind = ivec2(layer, 0);
    lo = floor(min(p0, p1)) - 1.0; hi = floor(max(p0, p1)) + 2.0 + (layer == 2 ? vec2(1.0, 0.0) : vec2(0.0));
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
      lo = gc - vec2(10.0, 9.0); hi = gc + vec2(11.0, 10.0);
    } else {
      if ( layer == 1 ? ts >= 0.17 : ts >= 0.36 ) { hide(); return; }
      vKind = ivec2(layer, layer == 0 && hu(key, ty * 7 + ci, sd + 10) < uSplash.x ? 2 : 0);
      lo = gc - vec2(6.0, 5.0); hi = gc + vec2(7.0, 4.0);
    }
    vSeg = vec4(gc, ts, 0.0);
  }
  vec2 a = mix(lo, hi, aCorner);
  vArt = a;
  vec2 world = uOrigin.xy + a * uOrigin.z;
  vec3 tp = translationMatrix * vec3(world, 1.0);
  vScr = tp.xy / uScreen;
  gl_Position = vec4((projectionMatrix * tp).xy, 0.0, 1.0);
}`;

export const RAIN_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vArt;
in vec2 vScr;
flat in vec4 vSeg;
flat in ivec2 vKind;
flat in float vH;
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
float hc(vec2 c, int s) { return hu(int(floor(c.x)), int(floor(c.y)), s); }

// is art cell c on the 1-px line a -> b (rasterised along its major axis)? returns the fraction along it, or -1
float onLine(vec2 c, vec2 a, vec2 b) {
  vec2 d = b - a;
  if ( abs(d.y) >= abs(d.x) ) {
    float y = c.y + 0.5;
    if ( y < min(a.y, b.y) - 0.01 || y > max(a.y, b.y) + 0.99 ) return -1.0;
    float f = abs(d.y) < 1e-4 ? 1.0 : clamp((y - a.y) / d.y, 0.0, 1.0);
    return floor(a.x + d.x * f) == c.x ? f : -1.0;
  }
  float x = c.x + 0.5;
  if ( x < min(a.x, b.x) - 0.01 || x > max(a.x, b.x) + 0.99 ) return -1.0;
  float f = clamp((x - a.x) / d.x, 0.0, 1.0);
  return floor(a.y + d.y * f) == c.y ? f : -1.0;
}

void out_(float k, vec3 add) { fragColor = vec4(add * uAlpha, 1.0 - uAlpha * (1.0 - k)); }

void main() {
  vec2 c = floor(vArt);
  int layer = vKind.x;
  if ( uMode == 0 ) {
    if ( uHasDepth == 1 && step(uDepthElev, (254.5 / 255.0) - texture(uDepth, vScr).b) < 0.5 ) discard;
    vec2 a = floor(vSeg.xy) + 0.5, b = floor(vSeg.zw) + 0.5;
    float f = onLine(c, a, b);
    float f2 = layer == 2 ? onLine(c - vec2(1.0, 0.0), a, b) : -1.0;
    if ( f < 0.0 && f2 < 0.0 ) discard;
    if ( layer == 0 ) { if ( f > 0.55 ) out_(0.35, 0.75 * uSky); else out_(0.6, 0.45 * uSky); return; }
    if ( layer == 1 ) { if ( hc(c, uSeed + 401) >= 0.6 ) discard; out_(0.7, 0.32 * uSky); return; }
    float hh = hc(c, uSeed + 402);
    if ( (f >= 0.0 && hh < 0.5) || (f < 0.0 && hh < 0.35) ) { out_(0.45, 0.6 * uSky); return; }
    discard;
  }
  // ground: the splash at the landing cell, continuous in time (pixels come and go by a hashed dropout, never by a frame step)
  vec2 d = c - vSeg.xy;
  float ts = vSeg.z, sq = uView.y;
  float drop = hc(c + vec2(vH * 61.0, 0.0), uSeed + 403);
  if ( vKind.y == 1 ) {
    // a ripple on water or a puddle: a squashed broken ring growing for 0.62 s, thinning by dropout
    float r = 3.0 + ts * 10.0;
    float e = length(vec2(d.x + 0.5, (d.y + 0.5) / sq));
    if ( abs(e - r) > 0.55 ) discard;
    float ang = atan(d.y + 0.5, d.x + 0.5) / 6.283185 + 0.5;
    float seg = floor(ang * 28.0);
    if ( hu(int(seg), int(vH * 997.0), uSeed + 404) < 0.15 + ts / 0.62 * 0.8 ) discard;
    if ( mod(seg + floor(vH * 7.0), 7.0) <= 1.0 ) discard;
    out_(0.9, 0.3 * uSky); return;
  }
  if ( layer == 1 ) {
    // far drops: a 1-px hit for a moment
    if ( d != vec2(0.0) || drop < ts / 0.17 ) discard;
    out_(0.8, 0.3 * uSky); return;
  }
  // the first moment: a 2-px dash where it hits
  if ( ts < 0.08 && d.y == 0.0 && (d.x == 0.0 || d.x == 1.0) ) { out_(0.75, 0.42 * uSky); return; }
  if ( vKind.y != 2 ) {
    if ( ts < 0.12 && d == vec2(0.0) && drop > ts / 0.12 ) { out_(0.8, 0.3 * uSky); return; }
    discard;
  }
  // the crown: a hollow squashed ellipse that widens, then breaks up
  if ( ts >= 0.05 && ts < 0.26 ) {
    float r = 1.4 + (ts - 0.05) / 0.21 * 1.8;
    float e = length(vec2(d.x, d.y / sq));
    if ( abs(e - r) < 0.5 && d.y <= 1.0 && drop > smoothstep(0.14, 0.26, ts) ) { out_(0.75, 0.42 * uSky); return; }
  }
  // two droplets thrown out on arcs, falling back
  if ( ts >= 0.08 && ts < 0.36 ) {
    float s = (ts - 0.08) / 0.28;
    float dx = 2.0 + 3.5 * s + step(0.5, vH), dy = -3.2 * 4.0 * s * (1.0 - s);
    for ( int q = 0; q < 2; q++ ) {
      float sx = q == 0 ? -1.0 : 1.0;
      if ( floor(sx * dx) == d.x && floor(dy) == d.y && s < 0.7 + 0.3 * hu(q, int(vH * 4093.0), uSeed + 405) ) { out_(0.9, 0.2 * uSky); return; }
    }
  }
  discard;
}`;
