/**
 * DUST AND GRIT, the look (dust-model.mjs is the pure part: kinds, levels, the field). One DustArt per dust area, drawn by the fire
 * display exactly like a fire-style area (FireArt's contract: the 12 fps art pass into a W x H texture of art cells, windows, jobs,
 * the next frame drawn ahead, staged adoption, the guard's budget) on the destruction layer's art grid:
 *
 *  0. TONE PASS (once, when the area is built): the map under the area averaged into one texel per 8 x 8 cells (16 taps each, linear
 *     when read): the dust takes THE GROUND'S OWN COLOUR (destruction's rule: dust in the ground's tone, never pale flecks on a dark map)
 *  1. ART PASS (12 fps, the cells near the view): one fragment per art cell, RGBA8 -
 *       R = 1 + the ground row (art px, mod 255) of the puff / chip drawn there (its depth against the tokens, fire's rule), 0 = none
 *       G = a puff cell: 1 + band (0 light, 1 mid, 2 shadow) + 3 x rim + 8 x (level - 1); a flying chip: 32 + tone (0 dark, 1 mid, 2 glint)
 *       B = the ground: aura band (0..2) + 4 x grit tone (0 none, 1 dark, 2 mid, 3 glint) + 16 film + 32 a chip's shadow
 *       A = the ground marks: darkening 0..2 + 4 a light scuff
 *     PUFFS: the tile's emitters (dust-model tile lists), each a BURST puff when the source passes and lazy lingering puffs after; 3
 *     lobes a puff, every lobe of every puff in ONE metaball field (a rolling trail, never a row of balls), shaded from the strongest
 *     lobe's sphere normal (lit top-left: light / mid / shadow), the outline a 2 x 2 dropout rim. A puff bursts out and slows with drag,
 *     rises a little and settles; it grows from a point (eases in) and its body erodes from the rim inwards (eases out).
 *     CHIPS: thrown as the source passes, a parabola with a visible apex, a shadow on the ground under each; GRIT where they land.
 *     AURA: a wide haze in two pixel bands with dithered edges, warped by a drifting noise (organic outline, no area edge); FILM: a
 *     patchy settled dust; MARKS: wheel tracks with a tread rhythm, or a scraped groove with streaks along the drag.
 *  2. GROUND (every frame, under the tokens): marks, film, grit, chip shadows, aura - premultiplied, NORMAL blend
 *  3. DUST (every frame, under the tokens) and FRONT (above them): the puffs and flying chips, split per screen pixel by depth exactly
 *     as the fire's tongues (a puff whose ground point lies in front of a token's feet is drawn over that token)
 * No emission (dust is not a light: it dims with the scene; at night its lit edges keep a pale rim, as the fire's smoke).
 * Everything is a function of (cell, the field, the shared clock): every client draws the same frames.
 */
import { VERT, VERT_B, SHOW_COMMON, FOOTPRINT, blocks, quad, texOf, renderPass } from "./art.mjs";
import { footprintK } from "./shader.mjs";
import { kindTable, LIN_P, LIN_L, TAU, MAX_PER_TILE } from "./dust-model.mjs";
import { sharedNow } from "../shared-clock.mjs";
import { reducedMotion } from "../config.mjs";

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

const ART = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform highp sampler2D uCell;
uniform highp sampler2D uEm;
uniform highp sampler2D uTileH;
uniform highp sampler2D uIdx;
uniform float uNow;       // s since the area's ref (whole 12 fps frames)
uniform vec2 uWind;       // the area's wind drift (cells / s)
uniform vec2 uSWind;      // the scene's wind drift (cells / s)
uniform float uG;         // cells per grid square
uniform float uU;         // cells per art px
uniform int uSeed;
uniform vec4 uK0[16];     // per code: pr, out, back, rise (squares)
uniform vec4 uK1[16];     //           life, lin, chips, chipD
uniform vec4 uK2[16];     //           chipH, chipSz, grit, aura
uniform vec4 uK3[16];     //           auraA, mark, trackW, v
out vec4 oArt;
${HASH}
const float RY = 0.8, TAU = ${TAU.toFixed(1)}, LIN_P = ${LIN_P.toFixed(2)}, LIN_L = ${LIN_L.toFixed(2)};
const float TH = 0.13;    // the metaball body's edge
float F = 0.0, best = 0.0, FA = 0.0; vec3 bn = vec3(0.0), dn0 = vec3(0.0, 0.0, 1.0); float bgy = 0.0; int blv = 1;

// one puff, a s old: life L, size scale sc, throw scale so, rise scale sr
void puff(vec2 p, float a, float L, float sc, float so, float sr, int s, vec2 P0, vec2 Hd, vec2 N, vec4 k0, int lv) {
  float f = a / L;
  float str = 1.0 - smoothstep(0.3, 1.0, f);
  if ( str <= 0.0 ) return;
  float E = 1.0 - exp(-2.6 * a);                                       // drag (destruction's dust: 2.6 / s)
  float hA = h3(s, 1, 0), hB = h3(s, 2, 0), hC = h3(s, 3, 0), hD = h3(s, 4, 0);
  // (thrown sideways a little or a lot - most stay close behind the source, the densest dust right in its wake)
  vec2 d = (N * k0.y * so * (0.1 + 0.9 * hA * hA) - Hd * k0.z * so * (0.5 + 0.5 * hB)) * uG * E;
  d.y *= RY;                                                           // (the ground plane, foreshortened)
  vec2 g = P0 + d + (uWind + uSWind) * TAU * (1.0 - exp(-a / TAU));   // where it is over the ground (it settles: the drift slows)
  float rise = k0.w * uG * sr * (0.55 + 0.45 * hC) * (1.0 - exp(-1.1 * a));
  vec2 c = g - vec2(0.0, rise);
  // (it grows from a small puff to its size fast, then keeps spreading slowly as it thins)
  float r = k0.x * uG * sc * (0.35 + 0.65 * (1.0 - exp(-2.2 * a)) + 0.35 * f) * (0.6 + 0.8 * hD * hD);
  vec2 q0 = p - c;
  if ( dot(q0, q0) > 3.3 * r * r ) return;                             // (beyond every lobe: offset <= 0.8 r, radius <= r)
  for ( int j = 0; j < 3; j++ ) {
    // (lobe 0 the body; 1 and 2 smaller billows on its upper side: a cauliflower top, never a tube)
    float aj = h3(s, 5, j) * 6.2832, dj = j == 0 ? r * 0.15 * E : r * (0.45 + 0.4 * E) * (0.7 + 0.3 * h3(s, 6, j));
    vec2 o = j == 0 ? vec2(cos(aj), sin(aj)) * dj : vec2(cos(aj), -0.35 - 0.65 * abs(sin(aj))) * dj;
    float rj = r * (j == 0 ? 0.85 + 0.15 * h3(s, 7, j) : 0.5 + 0.25 * h3(s, 7, j));
    vec2 q = p - c - o;
    float w = 1.0 - dot(q, q) / (rj * rj);
    if ( w <= 0.0 ) continue;
    float wv = w * w * str;
    F += wv;
    bn += wv * vec3(q / rj, sqrt(w));                                  // (the body's normal: every lobe's, weighted - one surface...
    FA += wv * f;
    if ( wv > best ) { best = wv; dn0 = vec3(q / rj, sqrt(w)); bgy = g.y + o.y * 0.5; blv = lv; }   // (... with its strongest billow's bump)
  }
}

void main() {
  ivec2 c = ivec2(vCell);
  vec2 p = vec2(c) + 0.5;
  float t = uNow;
  int R = 0, G = 0, B = 0, A = 0;
  // ---------------------------------------------------------------- the ground: aura, film, marks, grit
  vec4 C = texelFetch(uCell, c, 0);
  if ( C.x < 1e8 ) {
    int code = int(mod(C.w, 16.0)), lv = code & 3;
    float hw = floor(C.w / 16.0) * 0.25;
    vec4 k1 = uK1[code], k2 = uK2[code], k3 = uK3[code];
    float a = t - C.x, fo = 1.0 - smoothstep(C.y, C.y + 2.8, t), dn = abs(C.z) / hw;
    if ( a > 0.0 && fo > 0.0 ) {
      // the AURA: a haze that rises as the source passes, thins to a lingering veil, drifts downwind; organic outline from the noise
      vec2 dr = (uWind + uSWind) * 0.35 * t, q = (p - dr) / (0.55 * uG);
      float n = 0.65 * vn(q, uSeed) + 0.35 * vn(q * 2.3 + vec2(t * 0.07, -t * 0.05), uSeed + 1);
      float reach = 1.0 + k2.w * uG / hw * (0.45 + 0.55 * smoothstep(0.0, 2.5, a));
      float edge = dn + (n - 0.5) * 0.7;
      float env = smoothstep(0.0, 1.0, a) * mix(1.0, 0.42, smoothstep(1.5, 8.0, a));
      float dens = (1.0 - smoothstep(0.3 * reach, reach, edge)) * env * fo * k3.x * (0.6 + 0.5 * n);
      float dz = (h3(c.x >> 1, c.y >> 1, 77) - 0.5) * 0.16;
      int band = dens + dz > 0.52 ? 2 : dens + dz > 0.2 ? 1 : 0;
      // the FILM: settled dust in patches over the band
      float fil = smoothstep(0.6, 3.5, a) * fo;
      bool film = edge < 0.95 && h3(c.x >> 1, c.y >> 1, 91) < 0.55 * fil * (0.4 + 0.6 * n);
      // MARKS: wheel tracks (a tread rhythm along the path) / a scraped groove with streaks along the drag
      float along = C.x * k3.w * uG;                                   // (cells along the path: the source's travel)
      int mk = 0; bool scuff = false;
      bool vis = h3(c.x, c.y, 5) < fo;
      if ( k3.y == 1.0 && vis ) {
        float lo = code < 4 ? 0.0 : min(0.32 * uG, 0.75 * hw), tw = max(0.6, k3.z * uG);
        float dl = min(abs(C.z - lo), abs(C.z + lo));
        if ( dl < tw ) { float lane = C.z > 0.0 ? 1.3 : 0.0; mk = mod(along + lane, 3.0) < 1.6 ? 2 : 1; if ( lv == 1 ) mk = min(mk, 1); }
      } else if ( k3.y == 2.0 && vis ) {
        float inner = (code < 12 ? 0.55 : 0.75) * hw;
        float st = vn(vec2(along / (0.35 * uG), C.z / (0.06 * uG)), uSeed + 7), st2 = vn(vec2(along / (0.9 * uG), C.z / (0.3 * uG)), uSeed + 8);
        if ( abs(C.z) < inner * (0.8 + 0.35 * st2) ) mk = st > 0.62 ? 2 : st > 0.34 ? 1 : 0;
        else if ( abs(C.z) < inner * (0.8 + 0.35 * st2) + 0.12 * uG && st > 0.5 ) scuff = true;
        if ( lv == 1 && mk == 2 ) mk = 1;
      }
      // GRIT: grains where the chips landed, denser over the band's middle (drags) - single pixels and a few 2 x 2 clumps
      int gt = 0;
      float gp = k2.z * (k3.y == 2.0 ? 1.25 - dn : 1.1 - 0.6 * dn);
      float land = 0.25 + 0.45 * h3(c.x, c.y, 13);
      if ( a > land && edge < 1.0 ) {
        bool g1 = h3(c.x, c.y, 11) < gp * 0.7, g2 = k2.y > 1.5 && h3(c.x >> 1, c.y >> 1, 12) < gp * 0.18;
        if ( (g1 || g2) && h3(c.x, c.y, 14) < fo ) { float ht = h3(c.x, c.y, 15); gt = ht < 0.5 ? 1 : ht < 0.88 ? 2 : 3; }
      }
      B = band + 4 * gt + (film ? 16 : 0);
      A = mk + (scuff ? 4 : 0);
    }
  }
  // ---------------------------------------------------------------- puffs and chips: the tile's emitters
  vec4 th = texelFetch(uTileH, c >> 4, 0);
  int st = int(th.x), cnt = int(th.y);
  int chip = 0; float chipGy = 0.0; bool shadow = false;
  float uq = max(uU, 0.25);
  for ( int i = 0; i < ${MAX_PER_TILE}; i++ ) {
    if ( i >= cnt ) break;
    int k = st + i;
    int e = int(texelFetch(uIdx, ivec2((k >> 2) & 1023, k >> 12), 0)[k & 3]);
    ivec2 eb = ivec2((e & 1023) * 3, e >> 10);
    vec4 e0 = texelFetch(uEm, eb, 0);
    float ke = e0.z;
    if ( t < ke ) continue;                                            // (the source has not passed here yet)
    vec4 e1 = texelFetch(uEm, eb + ivec2(1, 0), 0), e2 = texelFetch(uEm, eb + ivec2(2, 0), 0);
    int code = int(e1.w), lv = code & 3, es = int(e0.w);
    vec4 k0 = uK0[code], k1 = uK1[code], k2 = uK2[code];
    vec2 P0 = e0.xy, Hd = e1.xy, N = vec2(-Hd.y, Hd.x) * e1.z;
    float eo = e2.x;
    // CHIPS: a few frames of flight right after the kick (none if it was put out before)
    float ac = t - ke;
    if ( ac < 1.0 && ke < eo ) {
      int nC = int(k1.z);
      vec2 thr = normalize(N + (-Hd) * (code < 8 ? 1.2 : 0.3));
      for ( int j = 0; j < 5; j++ ) {
        if ( j >= nC ) break;
        float hj = h3(es, j, 21), hk = h3(es, j, 22), hl = h3(es, j, 23);
        float Tf = 0.3 + 0.35 * hj, a2 = ac - 0.03 * float(j);
        if ( a2 < 0.0 || a2 > Tf ) continue;
        float an = (hk - 0.5) * 1.8, cs = cos(an), sn = sin(an);
        vec2 dir = vec2(thr.x * cs - thr.y * sn, thr.x * sn + thr.y * cs);
        float D = k1.w * uG * (0.4 + 0.6 * hl), Hh = k2.x * uG * (0.5 + 0.5 * hj), f = a2 / Tf;
        vec2 gp = P0 + dir * vec2(1.0, RY) * D * (1.0 - (1.0 - f) * (1.0 - f));
        vec2 cp = gp - vec2(0.0, Hh * 4.0 * f * (1.0 - f));
        int sz = int(k2.y) - (hl < 0.5 ? 1 : 0); sz = max(sz, 1);
        ivec2 ci = ivec2(floor(cp));
        if ( c.x >= ci.x && c.x < ci.x + sz && c.y >= ci.y && c.y < ci.y + sz ) { chip = 1 + int(h3(es, j, 24) * 2.99); chipGy = gp.y; }
        if ( c == ivec2(floor(gp)) && f < 0.92 ) shadow = true;
      }
    }
    // the BURST puff, as the source passes
    float L = k1.x * (0.85 + 0.3 * h3(es, 0, 31));
    if ( ke < eo && ac < L ) puff(p, ac, L, 1.0, 1.0, 1.0, es, P0, Hd, N, k0, lv);
    // the LINGERING ones: a share of the slots, smaller, lazier, never born after the put-out
    float t0 = ke + k1.x * 0.5;
    if ( t > t0 && k1.y > 0.0 ) {
      float m = floor((t - t0) / LIN_P);
      for ( int j = 0; j < 2; j++ ) {
        float kk = m - float(j); if ( kk < 0.0 ) continue;
        int ik = int(kk), sl = es * 7 + ik * 131 + 17;
        if ( h3(es, ik, 41) > k1.y ) continue;
        float b = t0 + kk * LIN_P + h3(es, ik, 42) * LIN_P * 0.5;
        if ( b > eo ) continue;
        float al = t - b, Ll = LIN_L * (0.85 + 0.3 * h3(es, ik, 43));
        if ( al < 0.0 || al > Ll ) continue;
        puff(p, al, Ll, 0.62, 0.4, 0.6, sl, P0, Hd, N, k0, lv);
      }
    }
  }
  if ( chip > 0 ) { G = 32 + chip - 1; R = 1 + int(mod(floor(chipGy / uq), 255.0)); }
  else {
    float dz = (h3(c.x >> 1, c.y >> 1, 61) - 0.5) * 0.12;
    // (old dust breaks up: whole 2 x 2 clusters drop out as the puffs here age - destruction's dropout, never a soft fade)
    float age = FA / max(F, 1e-4);
    // (holes that open and grow as blobs: a coarse noise with a 2 x 2 grain, not a salt-and-pepper sieve)
    float hole = 0.72 * vn(p / (5.0 * uU), uSeed + 21) + 0.28 * h3(c.x >> 1, c.y >> 1, 63);
    bool drop = hole < smoothstep(0.35, 1.0, age) * 0.9;
    if ( F > TH + dz && !drop ) {
      vec3 n = normalize(mix(normalize(bn), dn0, 0.45) * vec3(1.0, 1.0, 1.1));
      float lum = dot(n, normalize(vec3(-0.55, -0.7, 0.6))) + (h3(c.x >> 1, c.y >> 1, 62) - 0.5) * 0.06;
      int band = lum > 0.55 ? 0 : lum > 0.12 ? 1 : 2;
      int rim = F < TH + 0.045 + dz ? 1 : 0;
      G = 1 + band + 3 * rim + 8 * (blv - 1);
      R = 1 + int(mod(floor(bgy / uq), 255.0));
    }
  }
  if ( shadow ) B |= 32;
  oArt = vec4(float(R), float(G), float(B), float(A)) / 255.0;
}`;

// the tone pass: the map under each 8 x 8 cells, 16 taps
const TONE = `#version 300 es
precision highp float;
in vec2 vCell;
uniform sampler2D uMap;
uniform vec4 uMapR;       // the map's rectangle (scene px)
uniform vec4 uMapF;       // its frame in the texture (uv: x, y, w, h)
uniform vec3 uGeo;        // the area's first cell's corner (scene px), scene px per tone texel
out vec4 oTone;
void main() {
  vec2 base = vec2(uGeo.x, uGeo.y) + floor(vCell) * uGeo.z;
  vec3 acc = vec3(0.0);
  for ( int j = 0; j < 4; j++ ) for ( int i = 0; i < 4; i++ ) {
    vec2 uv = clamp((base + (vec2(i, j) + 0.5) * 0.25 * uGeo.z - uMapR.xy) / uMapR.zw, 0.0, 1.0);
    acc += texture(uMap, uMapF.xy + uv * uMapF.zw).rgb;
  }
  oTone = vec4(acc / 16.0, 1.0);
}`;

// the palette from the local ground tone (dust in the ground's own colour)
const PAL = `
uniform sampler2D uTone;
uniform vec2 uToneN;      // tone texels (8 cells each)
const vec3 SOIL = vec3(0.66, 0.58, 0.47);
vec3 toneAt(vec2 cf) { return texture(uTone, (cf + 0.5) / (8.0 * uToneN)).rgb; }
vec3 baseOf(vec3 T) { float l = dot(T, vec3(0.3, 0.59, 0.11)); return mix(mix(T, vec3(l), 0.6), SOIL * (0.75 + 0.5 * l), 0.6); }
const vec3 PA[4] = vec3[4](vec3(0.0), vec3(0.50, 0.58, 0.64), vec3(0.66, 0.75, 0.82), vec3(0.80, 0.88, 0.93));   // puff alpha by level: light, mid, shadow
const float PRIM[4] = float[4](0.0, 0.26, 0.34, 0.44);`;

const DDEPTH = `
uniform vec4 uTok[16];
uniform int uTokN;
uniform float uU;
bool inFront(vec2 cf, int r) {
  if ( r <= 0 || uTokN == 0 ) return false;
  float uq = max(uU, 0.25); vec2 q = cf + 0.5; int lo = int(floor(q.y / uq)) - 24;
  float by = (float(lo) + mod(float(r - 1 - lo), 255.0)) * uq;
  for ( int k = 0; k < 16; k++ ) {
    if ( k >= uTokN ) break;
    vec4 T = uTok[k];
    if ( q.x >= T.x && q.x < T.z && q.y >= T.y && q.y < T.w && by > T.w ) return true;
  }
  return false;
}
bool ownCell(vec2 cf) {
  if ( uTokN == 0 ) return false;
  ivec4 a = art(ivec2(cf));
  return a.g > 0 && inFront(cf, a.r);
}`;

// a puff / chip cell's colour, premultiplied
const PUFF_COLOR = `
vec4 puffColor(vec2 cf) {
  ivec2 p = ivec2(cf);
  ivec4 a = art(p);
  if ( a.g == 0 ) return vec4(0.0);
  vec3 b = baseOf(toneAt(cf));
  if ( a.g >= 32 ) { int k = a.g - 32; vec3 c = k == 0 ? b * 0.45 : k == 1 ? b * 0.7 : mix(b, vec3(1.0), 0.35); return vec4(c, 1.0); }
  int v = a.g - 1, lv = clamp(v / 8 + 1, 1, 3), w = v & 7, band = w % 3, rim = w / 3;
  vec3 rgb = band == 0 ? min(b * 1.24 + 0.05, vec3(1.0)) : band == 1 ? b * 1.0 + 0.02 : b * 0.72;
  float al = rim == 1 ? PRIM[lv] : PA[lv][band];
  if ( uDark > 0.0 ) {
    // at night it keeps its own value, cooled by the ambient; the edges facing the light (top-left) catch a pale rim
    vec3 cool = rgb * vec3(0.9, 0.95, 1.06);
    bool edge = art(p + ivec2(0, -1)).g == 0 || art(p + ivec2(-1, 0)).g == 0;
    if ( edge ) cool = mix(cool, vec3(0.80, 0.83, 0.90), 0.45);
    rgb = mix(rgb, cool, uDark);
  }
  return vec4(rgb * al, al);
}`;

const SHOW = `${SHOW_COMMON}
${PAL}
${DDEPTH}
${PUFF_COLOR}
vec4 cellColor(vec2 cf) { return puffColor(cf); }
#define OUT(c) ((c) * uAlpha)
#define SIDE 0
#define OCC 0
${FOOTPRINT}`;
const FRONT = `${SHOW_COMMON}
${PAL}
${DDEPTH}
${PUFF_COLOR}
vec4 cellColor(vec2 cf) { return puffColor(cf); }
#define OUT(c) ((c) * uAlpha)
#define SIDE 1
#define OCC 0
${FOOTPRINT}`;

// the GROUND under the tokens: marks, film, grit, chip shadows, then the aura over them (premultiplied, composited here)
const GROUND = `${SHOW_COMMON}
${PAL}
const float AURA[3] = float[3](0.0, 0.13, 0.24);
vec4 over(vec4 dst, vec3 c, float a) { return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a)); }
vec4 cellColor(vec2 cf) {
  ivec4 a = art(ivec2(cf));
  if ( a.b == 0 && a.a == 0 ) return vec4(0.0);
  vec3 T = toneAt(cf), b = baseOf(T);
  vec4 o = vec4(0.0);
  int mk = a.a & 3;
  if ( mk > 0 ) o = over(o, T * 0.5, mk == 1 ? 0.16 : 0.3);
  if ( (a.a & 4) != 0 ) o = over(o, min(b * 1.2 + 0.05, vec3(1.0)), 0.2);
  if ( (a.b & 16) != 0 ) o = over(o, min(b * 1.2 + 0.05, vec3(1.0)), 0.1);
  int gt = (a.b >> 2) & 3;
  // (grains in the soil's own dark / mid tone, not black: they read as grit on any ground, never as specks of ink)
  if ( gt > 0 ) o = over(o, gt == 1 ? mix(T * 0.5, b * 0.55, 0.5) : gt == 2 ? mix(T, b, 0.5) * 0.78 : mix(b, vec3(1.0), 0.3), gt == 1 ? 0.8 : 0.7);
  if ( (a.b & 32) != 0 ) o = over(o, T * 0.3, 0.35);
  int au = a.b & 3;
  if ( au > 0 ) o = over(o, min(b * 1.18 + 0.05, vec3(1.0)), AURA[au]);
  return o;
}
#define OUT(c) ((c) * uAlpha)
#define OCC 2
${FOOTPRINT}`;

const OCC_F = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform sampler2D uArt;
uniform vec2 uSize;
out vec4 oOcc;
void main() {
  ivec2 t = ivec2(vCell), S = ivec2(uSize), c0 = max(t * 8 - 1, ivec2(0)), c1 = min(t * 8 + 9, S);
  bool pf = false, gr = false;
  for ( int y = c0.y; y < c1.y; y++ ) for ( int x = c0.x; x < c1.x; x++ ) {
    ivec4 a = ivec4(texelFetch(uArt, ivec2(x, y), 0) * 255.0 + 0.5);
    pf = pf || a.g > 0; gr = gr || a.b > 0 || a.a > 0;
  }
  oOcc = vec4(pf, 0.0, gr, 0.0);
}`;

let progs = null;
const programs = () => progs ??= {
  art: PIXI.Program.from(VERT, ART, "moinen-maps-dust-art-v1"),
  tone: PIXI.Program.from(VERT, TONE, "moinen-maps-dust-tone-v1"),
  occ: PIXI.Program.from(VERT, OCC_F, "moinen-maps-dust-occ-v1"),
  ground: PIXI.Program.from(VERT_B(2), GROUND, "moinen-maps-dust-ground-v1"),
  show: PIXI.Program.from(VERT_B(0), SHOW, "moinen-maps-dust-show-v1"),
  front: PIXI.Program.from(VERT_B(0), FRONT, "moinen-maps-dust-front-v1")
};
/** Every dust program (the pre-warm links them in the background: fire.mjs). */
export const dustPrograms = () => Object.values(programs());

const fTex = (data, W, H) => PIXI.Texture.fromBuffer(data, W, H, { format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.FLOAT, scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA });
const rtOf = (W, H, lin = false) => { const r = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: lin ? PIXI.SCALE_MODES.LINEAR : PIXI.SCALE_MODES.NEAREST }); r.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF; return r; };
let KT = null;
const SOIL_TEX = () => texOf(new Uint8Array([168, 148, 120, 255]), 1, 1);

/**
 * One dust area (FireArt's contract for the display: isArt, W, H, artT, artWin, anim, setTime, setPhase, setDark, setTokens,
 * renderArt, extendArt, startJob, startPre, stepJob, swapJob, clocksAt, jobLeft, covers, uploadStep, uploaded, glow (none), destroy).
 * Its frame clock: `setTime(T)` (the display's 12 fps shader time) picks the absolute art frame of the shared clock it stands for.
 */
export class DustArt extends PIXI.Container {
  constructor(field, rect, geo, { front = null, seed = 1, grid = 32, speed = 1, map = null } = {}) {
    super();
    this.eventMode = "none"; this.interactiveChildren = false;
    const { ap, ox, oy } = geo, W = field.w, H = field.h, P = programs();
    const x0 = ox + rect.x0 * ap, y0 = oy + rect.y0 * ap;
    this.W = W; this.H = H; this.rect = rect; this.geo = geo; this.speed = speed || 1; this.ref = field.ref; this.maxKick = field.maxKick;
    this.anim = true; this.glow = null; this.artT = null; this.job = null;
    this.cellTex = fTex(field.cell, W, H);
    this.emTex = fTex(field.em, field.emW, field.emH);
    this.tileTex = fTex(field.tileH, field.tw, field.th);
    this.idxTex = fTex(field.idx, 1024, field.idxH);
    this.rt = rtOf(W, H);
    KT ??= kindTable();
    const wind = field.wind ?? [0, 0], g = grid;
    this.pass = null;   // (no fire `pass`: the tornado lean and the rain damper leave dust alone)
    this.dpass = new PIXI.Mesh(quad(0, 0, W, H, W, H), new PIXI.Shader(P.art, {
      uCell: this.cellTex, uEm: this.emTex, uTileH: this.tileTex, uIdx: this.idxTex, uNow: 0,
      uWind: new Float32Array([wind[0] * 0.25 * g, wind[1] * 0.25 * g]), uSWind: new Float32Array(2), uG: g, uU: g / 32, uSeed: (seed % 65536) | 0,
      uK0: KT[0], uK1: KT[1], uK2: KT[2], uK3: KT[3], translationMatrix: new PIXI.Matrix().toArray(true) }));
    // the tone map (pass 0): one texel per 8 x 8 cells, from the scene's map (none: a plain soil tone)
    const TW = Math.ceil(W / 8), TH = Math.ceil(H / 8);
    this.toneRt = map ? rtOf(TW, TH, true) : null; this.toneN = [TW, TH];
    if ( map ) {
      const t = map.texture, b = t.baseTexture, f = t.frame;
      this.tonePass = new PIXI.Mesh(quad(0, 0, TW, TH, TW, TH), new PIXI.Shader(P.tone, { uMap: t, uMapR: new Float32Array(map.rect),
        uMapF: new Float32Array([f.x / b.width, f.y / b.height, f.width / b.width, f.height / b.height]), uGeo: new Float32Array([x0, y0, 8 * ap]),
        translationMatrix: new PIXI.Matrix().toArray(true) }));
    } else this.soil = SOIL_TEX();
    this.toneDone = !map;
    // OCC (per 8 x 8 cells: puffs / ground)
    this.occRt = rtOf(TW, TH);
    this.occPass = new PIXI.Mesh(quad(0, 0, TW, TH, TW, TH), new PIXI.Shader(P.occ, { uArt: this.rt, uSize: new Float32Array([W, H]), translationMatrix: new PIXI.Matrix().toArray(true) }));
    this.tok = new Float32Array(64);
    const common = () => ({ uArt: this.rt, uOcc: this.occRt, uSize: new Float32Array([W, H]), uK: footprintK(), uAlpha: 1, uDark: 0, uTok: this.tok, uTokN: 0, uU: g / 32,
      uTone: this.toneRt ?? this.soil, uToneN: new Float32Array([TW, TH]), uLift: 1, uRamp: new Float32Array(48), uSmokeTint: new Float32Array(4),
      translationMatrix: new PIXI.Matrix().toArray(true) });
    const bg = blocks(x0, ap, y0, W, H);
    const live = (m) => { m.eventMode = "none"; const r0 = m._render.bind(m); m._render = (renderer) => { if ( !this.worldVisible || !this.parent ) return; const u = m.shader.uniforms; u.uAlpha = this.worldAlpha; u.uK = footprintK(); r0(renderer); }; };
    this.ground = new PIXI.Mesh(bg, new PIXI.Shader(P.ground, common())); this.ground.state.blendMode = PIXI.BLEND_MODES.NORMAL;
    this.show = new PIXI.Mesh(bg, new PIXI.Shader(P.show, common())); this.show.state.blendMode = PIXI.BLEND_MODES.NORMAL;
    for ( const m of [this.ground, this.show] ) live(m);
    this.addChild(this.ground, this.show);
    this.front = new PIXI.Mesh(bg, new PIXI.Shader(P.front, common())); this.front.state.blendMode = PIXI.BLEND_MODES.NORMAL; this.front.visible = false;
    live(this.front);
    (front ?? this).addChild(this.front);
    this.sw = new Float32Array(2);
  }
  get isArt() { return true; }

  /** The absolute art frame (ms on the shared clock) that the display's shader time `T` stands for, at shared time `now`. */
  frameMs(T, now) {
    const sp = this.speed, kNow = Math.floor(now * sp / 83.333), kk = Math.round(T * 12);
    const k = kNow - (((kNow - kk) % 12000) + 12000) % 12000;
    return k * 83.333 / sp;
  }
  /** The art time (s since the area's ref) of the frame `T` (reduced motion: the dust at rest, after its last kick). */
  timeOf(T, now) { return reducedMotion() ? this.maxKick + 30 : (this.frameMs(T, now) - this.ref) / 1000; }
  setTime(T) { this.T = T; this.dpass.shader.uniforms.uNow = this.timeOf(T, sharedNow()); }
  setPhase() { /* (the frame's time comes with setTime) */ }
  setBirths() {}
  /** The scene's wind (weather): the puffs and the haze drift with it too (cells / s). */
  setSceneWind(x, y) { const u = this.dpass.shader.uniforms.uSWind; u[0] = x; u[1] = y; }
  setDark(d) { this.show.shader.uniforms.uDark = d; this.front.shader.uniforms.uDark = d; this.ground.shader.uniforms.uDark = d; }
  setTokens(list) {
    const { ap, ox, oy } = this.geo, r = this.rect, n = Math.min(16, list.length);
    for ( let k = 0; k < n; k++ ) { const [a, b, c, d] = list[k]; this.tok.set([(a - ox) / ap - r.x0, (b - oy) / ap - r.y0, (c - ox) / ap - r.x0, (d - oy) / ap - r.y0], k * 4); }
    this.show.shader.uniforms.uTokN = n; this.front.shader.uniforms.uTokN = n; this.front.visible = n > 0;
  }
  /** The frame state a job / pre-draw carries: [shared ms of the moment, scene wind x, y]. */
  clocksAt(now, out) { const u = this.dpass.shader.uniforms.uSWind; out[0] = now; out[1] = u[0]; out[2] = u[1]; out[3] = 0; out[4] = 0; return out; }

  tone(renderer) { if ( this.toneDone ) return; this.toneDone = true; renderPass(renderer, this.tonePass, this.toneRt); }
  renderArt(renderer, win = null) {
    const W = this.W, H = this.H;
    this.tone(renderer);
    if ( !(this.job?.pre && this.job.t !== this.T) ) this.job = null;
    const aw = this._win ??= [0, 0, 0, 0];
    if ( !win || (win[0] <= 0 && win[1] <= 0 && win[2] >= W && win[3] >= H) ) { this.scissorPass(renderer, this.rt, 0, 0, W, H); aw[0] = 0; aw[1] = 0; aw[2] = W; aw[3] = H; }
    else {
      const x0 = Math.max(0, win[0]), y0 = Math.max(0, win[1]), x1 = Math.min(W, win[2]), y1 = Math.min(H, win[3]);
      this.scissorPass(renderer, this.rt, x0, y0, x1, y1); aw[0] = x0; aw[1] = y0; aw[2] = x1; aw[3] = y1;
    }
    renderPass(renderer, this.occPass, this.occRt);
    this.artT = this.T; this.artWin = aw;
    const u = this.dpass.shader.uniforms, s = this.artU ??= new Float64Array(5);
    s[0] = u.uNow; s[1] = u.uSWind[0]; s[2] = u.uSWind[1];
  }
  scissorPass(renderer, target, x0, y0, x1, y1) {
    if ( x1 <= x0 || y1 <= y0 ) return;
    const gl = renderer.gl;
    renderer.renderTexture.bind(target);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, y0, x1 - x0, y1 - y0);
    renderer.renderTexture.clear();
    this.dpass.render(renderer); renderer.batch.flush();
    gl.disable(gl.SCISSOR_TEST);
  }
  /** The art pass's per-frame uniforms set to the art time `now` (s) and scene wind of `s` (saved: frameOff puts them back). */
  frameOn(tNow, s) {
    const u = this.dpass.shader.uniforms, k = this._saved ??= new Float64Array(3);
    k[0] = u.uNow; k[1] = u.uSWind[0]; k[2] = u.uSWind[1];
    u.uNow = tNow; u.uSWind[0] = s[1]; u.uSWind[1] = s[2];
    return k;
  }
  frameOff(k) { const u = this.dpass.shader.uniforms; u.uNow = k[0]; u.uSWind[0] = k[1]; u.uSWind[1] = k[2]; }
  extendArt(renderer, need) {
    const o = this.artWin, s = this.artU, W = this.W, H = this.H; if ( !o || !s || this.artT === null ) return 0;
    const x0 = Math.max(0, Math.min(o[0], need[0])), y0 = Math.max(0, Math.min(o[1], need[1]));
    const x1 = Math.min(W, Math.max(o[2], need[2])), y1 = Math.min(H, Math.max(o[3], need[3]));
    const cells = (x1 - x0) * (y1 - y0) - (o[2] - o[0]) * (o[3] - o[1]); if ( cells <= 0 ) return 0;
    const k = this.frameOn(s[0], s);
    try {
      this.scissorPass(renderer, this.rt, x0, y0, x1, o[1]); this.scissorPass(renderer, this.rt, x0, o[3], x1, y1);
      this.scissorPass(renderer, this.rt, x0, o[1], o[0], o[3]); this.scissorPass(renderer, this.rt, o[2], o[1], x1, o[3]);
      renderPass(renderer, this.occPass, this.occRt);
    } finally { this.frameOff(k); }
    o[0] = x0; o[1] = y0; o[2] = x1; o[3] = y1;
    return cells;
  }
  startJob(win, t) {
    const u = this.dpass.shader.uniforms, W = this.W, H = this.H;
    const j = this.job = { t, x0: Math.max(0, win[0]), y0: Math.max(0, win[1]), x1: Math.min(W, win[2]), y1: Math.min(H, win[3]), y: 0, s: new Float64Array(5) };
    j.y = j.y0; j.tNow = u.uNow; j.s[1] = u.uSWind[0]; j.s[2] = u.uSWind[1];
    return j;
  }
  /** A12: the next art frame `t` drawn ahead in steps; `s` = clocksAt(the shared ms it is due). */
  startPre(renderer, win, t, s) {
    const W = this.W, H = this.H;
    const j = this.job = { t, x0: Math.max(0, win[0]), y0: Math.max(0, win[1]), x1: Math.min(W, win[2]), y1: Math.min(H, win[3]), y: 0, s: this._preS ??= new Float64Array(5), pre: true, done: false };
    j.y = j.y0; j.s.set(s); j.tNow = this.timeOf(t, s[0]);
    this.tone(renderer);
    return j;
  }
  get jobLeft() { const j = this.job; return !j || j.done ? 0 : Math.max(0, (j.x1 - j.x0) * (j.y1 - j.y)); }
  stepJob(renderer, maxCells, tNow = Infinity) {
    const j = this.job; if ( !j || j.done ) return 0;
    const w = j.x1 - j.x0; if ( w <= 0 || j.y >= j.y1 ) { this.job = null; return 0; }
    const rows = Math.max(1, Math.min(j.y1 - j.y, Math.floor(maxCells / w)));
    this.back ??= rtOf(this.W, this.H);
    this.tone(renderer);
    const k = this.frameOn(j.tNow, j.s);
    try { this.scissorPass(renderer, this.back, j.x0, j.y, j.x1, j.y + rows); } finally { this.frameOff(k); }
    j.y += rows;
    if ( j.y >= j.y1 ) { if ( j.pre && j.t > tNow ) j.done = true; else this.swapJob(renderer); }
    return rows * w;
  }
  swapJob(renderer) {
    const j = this.job; if ( !j ) return;
    const f = this.rt; this.rt = this.back; this.back = f;
    for ( const m of [this.occPass, this.ground, this.show, this.front] ) m.shader.uniforms.uArt = this.rt;
    renderPass(renderer, this.occPass, this.occRt);
    const aw = this._win ??= [0, 0, 0, 0]; aw[0] = j.x0; aw[1] = j.y0; aw[2] = j.x1; aw[3] = j.y1;
    this.artT = j.t; this.artWin = aw;
    const s = this.artU ??= new Float64Array(5); s[0] = j.tNow; s[1] = j.s[1]; s[2] = j.s[2];
    this.job = null;
  }
  uploadStep(renderer, maxBytes) {
    const q = this._up ??= [this.cellTex, this.emTex, this.tileTex, this.idxTex];
    let sent = 0;
    while ( q.length && (sent === 0 || sent + q[0].baseTexture.width * q[0].baseTexture.height * 16 <= maxBytes) ) {
      const b = q.shift().baseTexture; renderer.texture.bind(b, 0); sent += b.width * b.height * 16;
    }
    return sent;
  }
  get uploaded() { return !!this._up && !this._up.length; }
  covers(w) { const a = this.artWin; return !!a && w[0] >= a[0] && w[1] >= a[1] && w[2] <= a[2] && w[3] <= a[3]; }
  destroy() {
    const tx = [this.cellTex, this.emTex, this.tileTex, this.idxTex, this.soil];
    const ownF = this.front.parent === this;
    if ( !ownF ) this.front.parent?.removeChild(this.front);
    for ( const g of new Set([this.dpass, this.tonePass, this.occPass, this.ground].filter(Boolean).map((m) => m.geometry)) ) g?.destroy();
    this.dpass.destroy(); this.tonePass?.destroy(); this.occPass.destroy();
    if ( !ownF ) this.front.destroy();
    super.destroy({ children: true });
    for ( const t of tx ) t?.destroy(true);
    this.back?.destroy(true); this.back = null; this.job = null;
    this.rt.destroy(true); this.occRt.destroy(true); this.toneRt?.destroy(true);
  }
}
