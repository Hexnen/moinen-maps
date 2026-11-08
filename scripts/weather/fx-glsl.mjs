/**
 * GLSL of the PARTICLE passes (snow flakes, sand grit, dust motes, ember sparks) and the HAZE pass (sand haze, dust haze, ember
 * smoke): every instance and every haze cell is a pure function of (art cell or slot, shared time), the same convention as the rain
 * (glsl.mjs): world tiles of slots indexed by gl_InstanceID, whole cycles per hour, hashed birth gates, the oblique lift.
 * Ported from the research mock-ups (snow.py, sand.py, dust.py, embers.py); every pass writes (add, k) for the weather blend.
 */
import { GLSL_COMMON } from "./glsl.mjs";

export const PART_VERT = `#version 300 es
precision highp float;
precision highp int;
in vec2 aVertexPosition;
in vec2 aCorner;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec2 uScreen;
uniform float uTime;
uniform int uKind;           // 1 snow, 2 grit, 3 dust, 4 embers
uniform vec4 uTiles;         // first tile x, y; tiles across, down
uniform float uTileSz;       // art px per tile (embers: the source cell)
uniform vec4 uPer;           // slots per tile per layer (snow: mid, far, near, spindrift)
uniform vec4 uDens;          // live slots per tile per layer (fractional)
uniform vec4 uOrigin;        // scene rect x, y; art px (scene px); art cells per grid square
uniform vec2 uWindDir;       // unit (sand: the sand's direction)
uniform vec2 uWindK;         // art px / s at factor 1 (this kind's speed), gust amount
uniform vec2 uView;          // lift, squash
uniform vec4 uVF;            // snow: fall speeds mid, far, near; grit: hop, length; embers: source share, big sparks
uniform float uI;            // presence x performance
out vec2 vArt;
out vec2 vScr;
flat out vec4 vA;
flat out vec4 vB;
flat out ivec2 vK;
flat out float vFade;
${GLSL_COMMON}

void hide() { gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); vArt = vec2(0.0); vScr = vec2(0.0); vA = vec4(0.0); vB = vec4(0.0); vK = ivec2(0); vFade = 0.0; }
float gateOf(int j, float dens, int key, int ty, int ci, int sd) {
  if ( float(j) >= ceil(dens) ) return 0.0;
  float g = float(j) < floor(dens) ? 1.0 : fract(dens);
  return hu(key, ty * 53 + ci, sd + 8) < g ? 1.0 : 0.0;
}
// one slot's life: kc0 .. kc0 + kcr cycles per hour (whole cycles: seamless at the hour wrap); returns tau, sets life and cycle
float lifeOf(int key, int tx, int ty, int j, int sd, float kc0, float kcr, out float life, out int ci) {
  float kc = kc0 + floor(hu(key, ty, sd) * kcr);
  life = 3600.0 / kc;
  float u = (uTime + hu(tx, ty * 64 + j, sd + 1) * life) / life;
  ci = int(mod(floor(u), kc));
  return fract(u) * life;
}
vec2 windAt(vec2 g, float lag) {
  float G = gustAt(g / uOrigin.w, uWindDir, uTime - lag, uSeed);
  return uWindDir * uWindK.x * windFactor(G, uWindK.y);
}
// ember travel along the wind after tau s (the gust at the middle of the flight: smooth in time)
float emberTravel(vec2 s, float tau, float drag) {
  float G = gustAt(s / uOrigin.w, uWindDir, uTime - tau * 0.5, uSeed);
  return uWindK.x * drag * tau * (0.35 + 0.9 * clamp(G, 0.0, 1.2));
}

void main() {
  int per = int(uPer.x + uPer.y + uPer.z + uPer.w);
  int i = gl_InstanceID, tile = i / per, k = i - tile * per;
  int ntx = int(uTiles.z);
  int tx = int(uTiles.x) + tile % ntx, ty = int(uTiles.y) + tile / ntx;
  int layer = k < int(uPer.x) ? 0 : k < int(uPer.x + uPer.y) ? 1 : k < int(uPer.x + uPer.y + uPer.z) ? 2 : 3;
  int j = layer == 0 ? k : layer == 1 ? k - int(uPer.x) : layer == 2 ? k - int(uPer.x + uPer.y) : k - int(uPer.x + uPer.y + uPer.z);
  float dens = layer == 0 ? uDens.x : layer == 1 ? uDens.y : layer == 2 ? uDens.z : uDens.w;
  int sd = uSeed * 7 + uKind * 101 + layer * 13;
  int key = tx * 64 + j;
  float TS = uTileSz, lift = uView.x;
  float life; int ci;
  vec2 lo, hi;
  vFade = 1.0;
  vK = ivec2(uKind, layer);
  if ( uKind == 1 && layer < 3 ) {
    // SNOW flakes: 2 .. 3.3 s lives, falling with sway and a swirl, carried by the wind (lag 0.6 s)
    float tau = lifeOf(key, tx, ty, j, sd, 1080.0, 721.0, life, ci);
    if ( gateOf(j, dens, key, ty, ci, sd) < 0.5 ) { hide(); return; }
    float h0 = hu(key, ty * 977 + ci, sd + 2), h1 = hu(key, ty * 977 + ci, sd + 3), h2 = hu(key, ty * 977 + ci, sd + 4);
    float h3 = hu(key, ty * 977 + ci, sd + 5), h4 = hu(key, ty * 977 + ci, sd + 6), h5 = hu(key, ty * 977 + ci, sd + 7);
    vec2 g = (vec2(float(tx), float(ty)) + vec2(h0, h1)) * TS;
    if ( g.x < 0.0 || g.y < 0.0 || g.x >= uArtSize.x || g.y >= uArtSize.y || openAt(g, false) < 0.5 ) { hide(); return; }
    float vf = (layer == 0 ? uVF.x : layer == 1 ? uVF.y : uVF.z) * (0.75 + 0.5 * h2);
    float z0 = vf * life * 0.95, z = z0 - vf * tau;
    if ( z <= 0.0 ) { hide(); return; }
    float rem = z / vf;
    float G = gustAt(g / uOrigin.w, uWindDir, uTime - 0.6, uSeed);
    vec2 W = uWindDir * uWindK.x * windFactor(G, uWindK.y);
    float A = 2.0 + 5.0 * h3, fq = 0.3 + 0.5 * h4;
    float sway = A * sin(6.283185 * fq * tau + 6.28 * h5);
    float sw = 5.0 * sin(g.y / 23.0 + 6.283185 * uTime / 5.0 + g.x / 61.0) * (0.4 + clamp(G, 0.0, 1.2));
    float X = g.x - W.x * rem * (0.85 + 0.3 * h3) + sway + sw;
    float Yg = g.y - W.y * rem + 0.35 * sway * cos(6.283185 * fq * tau);
    float Y = Yg - lift * z;
    vFade = min(1.0, tau / 0.3) * min(1.0, rem / 0.25);
    vA = vec4(X, Y, X, Yg); vB = vec4(h4, h5, z, 0.0);
    lo = floor(vec2(X, min(Y, Yg))) - 2.0; hi = floor(vec2(X, max(Y, Yg))) + 4.0;
  } else if ( uKind == 1 ) {
    // SPINDRIFT: snow blown along the ground in strong gusts, thin low runs
    float tau = lifeOf(key, tx, ty, j, sd, 2160.0, 1441.0, life, ci);
    if ( gateOf(j, dens, key, ty, ci, sd) < 0.5 || tau >= 0.9 ) { hide(); return; }
    vec2 g = (vec2(float(tx), float(ty)) + vec2(hu(key, ty * 7 + ci, sd + 2), hu(key, ty * 7 + ci, sd + 3))) * TS;
    float G = gustAt(g / uOrigin.w, uWindDir, uTime - 0.2, uSeed);
    if ( G <= 0.45 || openAt(g, true) < 0.5 ) { hide(); return; }
    vec2 W = uWindDir * uWindK.x * windFactor(G, uWindK.y);
    vec2 p1 = g + W * 2.2 * tau + vec2(0.0, sin(tau * 7.0 + float(j)) * 1.5 - lift);
    float ln = 4.0 + 6.0 * min(G, 1.2);
    vec2 p0 = p1 - uWindDir * ln;
    vFade = min(1.0, tau / 0.15) * min(1.0, (0.9 - tau) / 0.2);
    vA = vec4(p0, p1); vB = vec4(0.0);
    lo = floor(min(p0, p1)) - 1.0; hi = floor(max(p0, p1)) + 2.0;
  } else if ( uKind == 2 ) {
    // GRIT: sand hopping along the ground (saltation), fast, in the waves
    float tau = lifeOf(key, tx, ty, j, sd, 4320.0, 3241.0, life, ci);
    if ( gateOf(j, dens, key, ty, ci, sd) < 0.5 ) { hide(); return; }
    float h0 = hu(key, ty * 977 + ci, sd + 2), h1 = hu(key, ty * 977 + ci, sd + 3), h2 = hu(key, ty * 977 + ci, sd + 4);
    float h3 = hu(key, ty * 977 + ci, sd + 5), h4 = hu(key, ty * 977 + ci, sd + 6);
    vec2 s = (vec2(float(tx), float(ty)) + vec2(h0, h1)) * TS;
    float fr = clamp(gustAt(s / uOrigin.w, uWindDir, uTime - tau, uSeed), 0.0, 1.2);
    if ( h2 >= (0.25 + 0.75 * fr) * min(1.0, uI) ) { hide(); return; }
    float spd = uWindK.x * (1.2 + 0.8 * h3) * (0.5 + 0.8 * fr);
    vec2 X = s + uWindDir * spd * tau;
    if ( X.x < 0.0 || X.y < 0.0 || X.x >= uArtSize.x || X.y >= uArtSize.y || openAt(X, true) < 0.5 ) { hide(); return; }
    float hop = uVF.x * abs(sin(tau * (5.0 + 4.0 * h4) + h3 * 6.28)) * h4;
    vec2 p1 = X - vec2(0.0, lift * (1.0 + hop));
    vec2 p0 = p1 - uWindDir * (2.0 + uVF.y * fr);
    vFade = min(1.0, tau / 0.06) * min(1.0, (life - tau) / 0.06);
    vA = vec4(p0, p1); vB = vec4(0.0);
    lo = floor(min(p0, p1)) - 1.0; hi = floor(max(p0, p1)) + 2.0;
  } else if ( uKind == 3 ) {
    // DUST motes: 5 .. 10 s lives, slow Brownian drift in calm air, glinting in the sun shafts
    float tau = lifeOf(key, tx, ty, j, sd, 360.0, 361.0, life, ci);
    if ( gateOf(j, dens, key, ty, ci, sd) < 0.5 ) { hide(); return; }
    float h[9];
    for ( int q = 0; q < 9; q++ ) h[q] = hu(key, ty * 977 + ci, sd + 2 + q);
    vec2 s = (vec2(float(tx), float(ty)) + vec2(h[0], h[1])) * TS;
    float z = 6.0 + 50.0 * h[2], T6 = tau * 6.28;
    float bx = 4.0 * sin(T6 * (0.07 + 0.06 * h[3]) + h[4] * 6.28) + 2.0 * sin(T6 * (0.19 + 0.12 * h[5]) + h[6] * 6.28) + 0.6 * sin(T6 * (0.5 + 0.2 * h[7]) + h[7] * 6.28);
    float by = 3.0 * sin(T6 * (0.06 + 0.05 * h[5]) + h[7] * 6.28) + 1.6 * sin(T6 * (0.17 + 0.1 * h[3]) + h[8] * 6.28);
    float bz = 3.0 * sin(T6 * (0.08 + 0.06 * h[8]) + h[4] * 6.28);
    vec2 g = s + uWindDir * uWindK.x * tau + vec2(bx, by);
    if ( g.x < 0.0 || g.y < 0.0 || g.x >= uArtSize.x || g.y >= uArtSize.y || openAt(g, true) < 0.5 ) { hide(); return; }
    vec2 P = g - vec2(0.0, lift * (z + bz));
    float age = tau / life;
    vFade = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.8, 1.0, age));
    float lit = smoothstep(0.55, 0.7, shaftAt(P));
    float tw = 0.5 + 0.5 * sin(6.283185 * (0.25 + 0.5 * h[3]) * uTime + 6.28 * h[4]);
    vA = vec4(P, 0.0, 0.0); vB = vec4(lit * smoothstep(0.55, 0.85, tw), h[6] > 0.93 ? 1.0 : 0.0, 0.0, 0.0);
    lo = floor(P) - 1.0; hi = floor(P) + 3.0;
  } else {
    // EMBERS: sparks from the burning spots, rising with decaying buoyancy, carried by the wind, cooling through the ember ramp
    vec2 pos; float rate;
    if ( !srcAt(ivec2(tx, ty), uVF.x, pos, rate) ) { hide(); return; }
    key = tx * 1000 + j;
    float tau = lifeOf(key, tx, ty, j, sd, 720.0, 721.0, life, ci);
    float h[8];
    for ( int q = 0; q < 8; q++ ) h[q] = hu(key, ty * 977 + ci, sd + 2 + q);
    float G0 = gustAt(pos / uOrigin.w, uWindDir, uTime - tau, uSeed);
    if ( gateOf(j, dens, key, ty, ci, sd) < 0.5 || h[0] >= rate * (0.55 + 0.45 * clamp(G0, 0.0, 1.0)) ) { hide(); return; }
    float lf = life * (0.7 + 0.3 * h[1]), age = tau / lf;
    if ( age >= 1.0 ) { hide(); return; }
    if ( hu(key, int(floor(uTime * 15.0)), sd + 21) <= smoothstep(0.7, 1.0, age) ) { hide(); return; }   // dies by pixel dropout
    vec2 s = pos + vec2((h[2] - 0.5) * 30.0, (h[3] - 0.5) * 18.0);
    if ( openAt(s, true) < 0.5 ) { hide(); return; }
    float drag = 0.8 + 0.6 * h[4], zb = 40.0 + 70.0 * h[5], tb = 0.5 + 0.7 * h[6];
    vec2 WN = vec2(-uWindDir.y, uWindDir.x);
    float tp = max(tau - 0.07, 0.0);
    float z = zb * (1.0 - exp(-tau / tb)) + 4.0, zp = zb * (1.0 - exp(-tp / tb)) + 4.0;
    float turb = 7.0 * sin(tau * (2.1 + 2.0 * h[7]) + h[2] * 6.28) + 3.0 * sin(tau * (5.3 + 3.0 * h[1]) + h[3] * 6.28);
    float turbp = 7.0 * sin(tp * (2.1 + 2.0 * h[7]) + h[2] * 6.28) + 3.0 * sin(tp * (5.3 + 3.0 * h[1]) + h[3] * 6.28);
    vec2 Xg = s + uWindDir * emberTravel(s, tau, drag) + WN * turb;
    vec2 Xgp = s + uWindDir * emberTravel(s, tp, drag) + WN * turbp;
    vec2 P = Xg - vec2(0.0, lift * z), Pp = Xgp - vec2(0.0, lift * zp);
    float fl = hu(key, int(floor(uTime * 10.0)), sd + 20);
    float cI = clamp(floor(age * 3.2 + fl * 1.3 - 0.3), 0.0, 4.0);
    float big = h[7] > 0.8 && cI < 2.0 && uVF.y > 0.5 ? 1.0 : 0.0;
    vA = vec4(P, Pp); vB = vec4(Xg, cI, big + (z < 22.0 && cI < 3.0 ? 2.0 : 0.0));
    lo = floor(min(min(P, Pp), Xg)) - 2.0; hi = floor(max(max(P, Pp), Xg)) + 3.0;
  }
  vec2 a = mix(lo, hi, aCorner);
  vArt = a;
  vec2 world = uOrigin.xy + a * uOrigin.z;
  vec3 tp3 = translationMatrix * vec3(world, 1.0);
  vScr = tp3.xy / uScreen;
  gl_Position = vec4((projectionMatrix * tp3).xy, 0.0, 1.0);
}`;

export const PART_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vArt;
in vec2 vScr;
flat in vec4 vA;
flat in vec4 vB;
flat in ivec2 vK;
flat in float vFade;
uniform float uAlpha;
uniform sampler2D uDepth;
uniform float uDepthElev;
uniform int uHasDepth;
uniform int uSeed;
out vec4 fragColor;
float hu(int x, int y, int s) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(s) * 1274126177u;
  h = (h ^ (h >> 13u)) * 1103515245u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}
float hc(vec2 c, int s) { return hu(int(floor(c.x)), int(floor(c.y)), s); }
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
const vec3 OCHRE = vec3(0.82, 0.62, 0.36);
const vec3 DUST = vec3(0.93, 0.86, 0.70);
vec3 ember(float i) { return i < 0.5 ? vec3(1.0, 0.96, 0.76) : i < 1.5 ? vec3(1.0, 0.82, 0.29) : i < 2.5 ? vec3(1.0, 0.54, 0.14) : i < 3.5 ? vec3(0.82, 0.25, 0.11) : vec3(0.45, 0.16, 0.10); }
// (add, k) faded in / out by vFade, then the layer's alpha
void out_(float k, vec3 add) {
  float a = uAlpha * vFade;
  fragColor = vec4(add * a, 1.0 - a * (1.0 - k));
}

void main() {
  if ( uHasDepth == 1 && step(uDepthElev, (254.5 / 255.0) - texture(uDepth, vScr).b) < 0.5 ) discard;
  vec2 c = floor(vArt);
  int kind = vK.x, layer = vK.y;
  if ( kind == 1 && layer < 3 ) {
    vec2 P = floor(vA.xy), d = c - P;
    if ( layer == 1 ) { if ( d == vec2(0.0) && hc(c, uSeed + 410) < 0.75 ) { out_(0.0, vec3(0.80, 0.85, 0.93)); return; } discard; }
    if ( layer == 0 ) {
      bool big = vB.x > 0.72;
      if ( d == vec2(0.0) ) { out_(0.0, vec3(0.98, 0.99, 1.0)); return; }
      if ( big && d == vec2(1.0, 0.0) ) { out_(0.0, vec3(0.86, 0.90, 0.97)); return; }
      if ( d == vec2(0.0, 1.0) ) { if ( big ) { out_(0.0, vec3(0.80, 0.85, 0.94)); return; } if ( vB.y > 0.45 ) { out_(0.0, vec3(0.62, 0.68, 0.80)); return; } }
      if ( vB.z < 26.0 && c == floor(vA.zw) ) { out_(0.72, vec3(0.0)); return; }       // its shadow on the ground: shows the height
      discard;
    }
    // near: a 2x2 flake close to the camera with a dithered halo
    if ( d.x >= 0.0 && d.x <= 1.0 && d.y >= 0.0 && d.y <= 1.0 ) {
      float cc = d == vec2(0.0) ? 1.0 : d == vec2(1.0, 0.0) ? 0.95 : d == vec2(0.0, 1.0) ? 0.9 : 0.85;
      out_(0.0, vec3(cc, cc, 1.0) * 0.97); return;
    }
    if ( (d == vec2(-1.0, 0.0) || d == vec2(2.0, 0.0) || d == vec2(0.0, -1.0) || d == vec2(1.0, 2.0)) && hc(c, uSeed + 411) < 0.4 ) { out_(0.0, vec3(0.85, 0.89, 0.97)); return; }
    discard;
  }
  if ( kind == 1 ) {
    float f = onLine(c, floor(vA.xy) + 0.5, floor(vA.zw) + 0.5);
    if ( f < 0.0 || hc(c, uSeed + 412) >= 0.25 + 0.6 * f ) discard;
    out_(0.0, vec3(0.93, 0.95, 1.0)); return;
  }
  if ( kind == 2 ) {
    float f = onLine(c, floor(vA.xy) + 0.5, floor(vA.zw) + 0.5);
    if ( f < 0.0 ) discard;
    out_(0.25, min(vec3(1.0), OCHRE * (0.9 + 0.35 * f))); return;
  }
  if ( kind == 3 ) {
    vec2 d = c - floor(vA.xy);
    float e = vB.x;
    vec3 dullA = DUST * 0.55, brA = vec3(1.0, 0.97, 0.85);
    if ( vB.y > 0.5 ) {
      if ( d.x < 0.0 || d.y < 0.0 || d.x > 1.0 || d.y > 1.0 ) discard;
      out_(0.7, mix(dullA, brA, e) * 0.6); return;                       // near: out of focus, a dimmer 2x2
    }
    if ( d != vec2(0.0) ) discard;
    out_(mix(0.5, 0.0, e), mix(dullA, brA, e) + 0.08 * e); return;
  }
  // embers
  vec2 P = floor(vA.xy), d = c - P;
  float ci = vB.z, fl = vB.w;
  if ( d == vec2(0.0) ) { out_(0.0, ember(ci)); return; }
  if ( mod(fl, 2.0) > 0.5 && d == vec2(1.0, 0.0) ) { out_(0.0, ember(ci) * 0.9); return; }
  float f = onLine(c, floor(vA.zw) + 0.5, P + 0.5);
  if ( f >= 0.0 && f < 0.99 ) { out_(0.0, ember(min(ci + 1.0, 4.0)) * 0.85); return; }
  if ( ci < 3.0 && abs(d.x) + abs(d.y) == 1.0 ) { out_(1.0, vec3(0.22, 0.09, 0.02)); return; }
  if ( fl >= 2.0 && c == floor(vB.xy) ) { out_(1.0, vec3(0.10, 0.04, 0.0)); return; }
  discard;
}`;

/* ================================================================== HAZE (sand haze, dust haze, ember smoke): above tokens */

export const HAZE_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform float uTime;
uniform float uK;
uniform float uAlpha;
uniform vec4 uSandH;        // presence x density, 3-band look (lit / shadow), -, -
uniform vec4 uSandW;        // sand direction x, y; speed (art px / s); -
uniform vec4 uDustH;        // presence, wind x, y (art px / s), -
uniform vec4 uSmoke;        // presence, 2-band look, wind x, y (art px / s)
uniform vec3 uAvg;          // the map's average colour
uniform float uCps;
out vec4 fragColor;
${GLSL_COMMON}
const vec3 OCHRE = vec3(0.82, 0.62, 0.36);
const vec3 DUST = vec3(0.93, 0.86, 0.70);
vec4 mixTo(vec4 f, vec3 col, float m) { return vec4(f.rgb * (1.0 - m) + col * m, f.a * (1.0 - m)); }

// the smooth fields (scales of 30+ cells) once per pixel, at its centre; only the bands' dither and the shelter are per cell
float sDens = 0.0, sLit = 0.0, dH = 0.0, mH = 0.0;
void smoothFields(vec2 c) {
  if ( uSandH.x > 0.0 ) {
    // sand billows in flat see-through bands, the waves passing; a lit side and a shadow side (one step toward the light)
    vec2 v = uSandW.xy * uSandW.z * 0.8 / 58.0;
    float bil = drift3a(c / 58.0, v, uTime, 40.0, uSeed + 121);
    sLit = uSandH.y > 0.5 ? bil - drift3a((c + 3.0) / 58.0, v, uTime, 40.0, uSeed + 121) : 0.0;
    float pr = dot(c, uSandW.xy), ac = -c.x * uSandW.y + c.y * uSandW.x;
    float rag = 140.0 * (fbm2(vec2(ac / 95.0, pr / 300.0), uSeed + 141) - 0.5);
    float fr = clamp(gustEnv(uTime - (pr + rag) / (uCps * 4.0), uSeed), 0.0, 1.2);
    sDens = clamp(0.05 + 0.85 * fr * (0.25 + bil) + 0.15 * bil - 0.08, 0.0, 1.0) * uSandH.x;
  }
  if ( uDustH.x > 0.0 ) dH = drift3a(vec2(c.x / 80.0, c.y / 55.0), uDustH.yz * 1.2 / vec2(80.0, 55.0), uTime, 60.0, uSeed + 182);
  if ( uSmoke.x > 0.0 ) mH = drift3a(vec2(c.x / 48.0, c.y / 30.0), uSmoke.zw * 0.9 / vec2(48.0, 30.0), uTime, 40.0, uSeed + 151);
}
vec4 cellHaze(vec2 c) {
  vec4 f = vec4(0.0, 0.0, 0.0, 1.0);
  if ( c.x < 0.0 || c.y < 0.0 || c.x >= uArtSize.x || c.y >= uArtSize.y || openAt(c, true) < 0.5 ) return f;
  float dz = hc(c, uSeed + 997);
  if ( uSandH.x > 0.0 ) {
    float dens = sDens, lit = sLit;
    int lv = int(clamp(floor(dens * 3.2 + (dz - 0.5) * 0.2), 0.0, 3.0));
    float m3 = lv == 0 ? 0.0 : lv == 1 ? 0.32 : lv == 2 ? 0.55 : 0.78, m2 = lv == 0 ? 0.0 : lv == 1 ? 0.20 : 0.34;
    float dd = uSandH.y > 0.5 ? (lit > 0.004 ? 0.09 : lit < -0.004 ? -0.06 : 0.02) : 0.02;
    if ( lv > 0 ) f = mixTo(f, clamp(uAvg * 0.35 + OCHRE * 0.75 + dd, 0.0, 1.0), mix(m2, m3, uSandH.y));
  }
  if ( uDustH.x > 0.0 ) {
    float h = dH;
    int lv = int(clamp(floor((h - 0.44) * 7.0 + (dz - 0.5) * 0.2), 0.0, 2.0));
    if ( lv > 0 ) f = mixTo(f, clamp(uAvg * 0.4 + DUST * 0.7, 0.0, 1.0), (lv == 1 ? 0.09 : 0.17) * uDustH.x);
  }
  if ( uSmoke.x > 0.0 ) {
    float h = mH;
    int lv = int(clamp(floor((h - 0.42) * 6.0 + (dz - 0.5) * 0.2), 0.0, 2.0));
    float m = lv == 0 ? 0.0 : lv == 1 ? mix(0.13, 0.22, uSmoke.y) : mix(0.13, 0.40, uSmoke.y);
    if ( lv > 0 ) f = mixTo(f, vec3(0.20, 0.17, 0.16), m * uSmoke.x);
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
  smoothFields(floor(vCell));
  if ( uK <= 0.0 || max(w.x, w.y) < 0.01 ) c = cellHaze(floor(vCell));
  else {
    w = clamp(w, vec2(0.01), vec2(2.0));
    float ix, iy; vec3 ax, ay;
    axisW(vCell.x, w.x, ix, ax); axisW(vCell.y, w.y, iy, ay);
    c = vec4(0.0);
    for ( int j = 0; j < 3; j++ ) {
      float wy = ay[j]; if ( wy <= 0.0 ) continue;
      for ( int i = 0; i < 3; i++ ) {
        float wx = ax[i]; if ( wx <= 0.0 ) continue;
        c += wx * wy * cellHaze(vec2(ix + float(i), iy + float(j)));
      }
    }
  }
  fragColor = vec4(c.rgb * uAlpha, 1.0 - uAlpha * (1.0 - c.a));
}`;
