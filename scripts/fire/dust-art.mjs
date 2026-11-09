/**
 * DUST AND GRIT, the look (dust-model.mjs is the pure part: kinds, levels, the field). One DustArt per dust area, drawn by the fire
 * display exactly like a fire-style area (FireArt's contract: the 12 fps art pass into a W x H texture of art cells, windows, jobs,
 * the next frame drawn ahead, staged adoption, the guard's budget) on the destruction layer's art grid:
 *
 *  0. TONE PASS (once, when the area is built): the map under the area averaged into one texel per 8 x 8 cells (16 taps each, linear
 *     when read): the dust takes THE GROUND'S OWN COLOUR (destruction's rule: dust in the ground's tone, never pale flecks on a dark map)
 *  1. ART PASS (12 fps, the cells near the view): one fragment per art cell, RGBA8 -
 *       R = 1 + the ground row (art px, mod 255) of the puff / chip drawn there (its depth against the tokens, fire's rule), 0 = none
 *       G = a puff cell: 1 + band (0 light, 1 mid, 2 shadow, 3 rim) + 4 x (level - 1) + 12 x fresh (just kicked up: darker, denser)
 *           (+ 24 aged, + 36 old: thinner as it fades); a flying chip: 64 + tone (0 dark, 1 mid, 2 glint)
 *       B = the ground: aura band (0..2) + 4 x grit tone (0 none, 1 dark, 2 mid, 3 glint) + 16 film + 32 a chip's shadow + 64 / 128 the
 *           puffs' ground shadow (light / dense: the cloud's mass over the ground)
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
 * No emission (dust is not a light: it dims with the scene; at night its lit tops and edges turn a pale moonlit value, lifted against
 * Foundry's ambience by FireArt's rule, its cores stay dark - contrast by form). Over water / any cold ground the dust takes the soil
 * tone (no blue dust). An UNDONE eraser over the dust: the dust eases back in from what was left (no pop), lingering puffs resume.
 * Everything is a function of (cell, the field, the shared clock): every client draws the same frames.
 */
import { VERT, VERT_B, SHOW_COMMON, FOOTPRINT, blocks, quad, texOf, renderPass } from "./art.mjs";
import { footprintK } from "./shader.mjs";
import { kindTable, LIN_P, LIN_L, TAU, MAX_PER_TILE, CODES, CODE_N } from "./dust-model.mjs";
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
uniform highp sampler2D uBack;  // (an undone eraser: [back, out2] per cell; uHasBack 0 = none)
uniform int uHasBack;
uniform float uNow;       // s since the area's ref (whole 12 fps frames)
uniform vec2 uWind;       // the area's wind drift (cells / s)
uniform vec2 uSWind;      // the scene's wind drift (cells / s)
uniform float uG;         // cells per grid square
uniform float uU;         // cells per art px
uniform int uSeed;
uniform vec4 uK0[${CODES}];     // per code: pr, out, back, rise (squares)
uniform vec4 uK1[${CODES}];     //           life, lin, chips, chipD
uniform vec4 uK2[${CODES}];     //           chipH, chipSz, grit, aura
uniform vec4 uK3[${CODES}];     //           auraA, mark, trackW, v
uniform vec4 uK4[${CODES}];     //           riseK, jetK, hits, 0
uniform vec4 uK5[${CODES}];     //           linW, haze, haze grow, 0
uniform float uPuffEnd;         // s: after it no puff / chip of the area can live (an area of blasts: the haze's minutes skip the emitters)
out vec4 oArt;
${HASH}
const float RY = 0.8, TAU = ${TAU.toFixed(1)}, LIN_P = ${LIN_P.toFixed(2)}, LIN_L = ${LIN_L.toFixed(2)};
const float TH = 0.13;    // the metaball body's edge
float F = 0.0, best = 0.0, FA = 0.0, FS = 0.0; vec3 bn = vec3(0.0), dn0 = vec3(0.0, 0.0, 1.0); float bgy = 0.0, ba = 9.0; int blv = 1;
// the dust at a cell going out at o (s): 1 -> 0 over 2.8 s
float fadeOut(float o, float t) { return 1.0 - smoothstep(o, o + 2.8, t); }
// ...and with an undone eraser: from bk on it eases back from what was left, then goes out again at o2
float fadeAt(float o, float bk, float o2, float t) { return t < bk ? fadeOut(o, t) : mix(fadeOut(o, bk), 1.0, smoothstep(bk, bk + 1.5, t)) * fadeOut(o2, t); }

// one puff, a s old: life L, size scale sc, throw scale so, rise scale sr
void puff(vec2 p, float a, float L, float sc, float so, float sr, int s, vec2 P0, vec2 Hd, vec2 N, vec4 k0, vec4 k4, int lv) {
  float f = a / L;
  float str = 1.0 - smoothstep(0.3, 1.0, f);
  if ( str <= 0.0 ) return;
  float E = 1.0 - exp(-2.6 * a);                                       // drag (destruction's dust: 2.6 / s)
  float hA = h3(s, 1, 0), hB = h3(s, 2, 0), hC = h3(s, 3, 0), hD = h3(s, 4, 0);
  // (thrown sideways a little or a lot - most stay close behind the source, the densest dust right in its wake)
  vec2 d = (N * k0.y * so * (0.1 + 0.9 * hA * hA) - Hd * k0.z * so * (0.5 + 0.5 * hB)) * uG * E;
  d.y *= RY;                                                           // (the ground plane, foreshortened)
  vec2 g = P0 + d + (uWind + uSWind) * TAU * (1.0 - exp(-a / TAU));   // where it is over the ground (it settles: the drift slows)
  float rise = k0.w * uG * sr * (0.55 + 0.45 * hC) * (1.0 - exp(-k4.x * a));
  vec2 c = g - vec2(0.0, rise);
  // (it grows from a small puff to its size fast, then keeps spreading slowly as it thins)
  float r = k0.x * uG * sc * (0.35 + 0.65 * (1.0 - exp(-2.2 * a)) + 0.35 * f) * (0.6 + 0.8 * hD * hD);
  // its SHADOW on the ground: the body's footprint under it, cast down-right by the light (top-left) by its height - what gives the
  // cloud its mass over the ground in the oblique view; densest under the young dense body, gone as it thins
  float hgt = rise + r * 0.55;
  vec2 qs = p - g - vec2(0.42, 0.3) * hgt - vec2(0.0, r * 0.1);
  float ws = 1.0 - dot(qs, qs) / (r * r * 1.1);
  if ( ws > 0.0 ) FS += ws * str * (1.0 - smoothstep(0.15, 0.8, f));
  // YOUNG: the body is still a jet from where it was kicked - a capsule from its centre back toward the source (P0), shrinking as it
  // slows: the newest puffs read as one spray streaming off the source (speed), never a row of separate balls
  float yth = exp(-k4.y * a);
  vec2 tl = (P0 - c) * yth;
  // (its depth: the body's BOTTOM - one per puff, as a token's feet: a puff never sinks below its own depth line, so a token's
  // square never cuts it - the whole puff is in front of a token or behind it)
  float dep = max(c.y + 0.85 * r, c.y + tl.y + 0.6 * r);
  vec2 q0 = p - c;
  float hq = clamp(dot(q0, tl) / max(dot(tl, tl), 1e-4), 0.0, 1.0);
  vec2 qt = q0 - tl * hq;
  if ( dot(qt, qt) > 3.3 * r * r ) return;                             // (beyond every lobe: offset <= 0.8 r, radius <= r; and the jet)
  for ( int j = 0; j < 3; j++ ) {
    // (lobe 0 the body; 1 and 2 smaller billows on its upper side: a cauliflower top, never a tube)
    float aj = h3(s, 5, j) * 6.2832, dj = j == 0 ? r * 0.15 * E : r * (0.45 + 0.4 * E) * (0.7 + 0.3 * h3(s, 6, j));
    vec2 o = j == 0 ? vec2(cos(aj), sin(aj)) * dj : vec2(cos(aj), -0.35 - 0.65 * abs(sin(aj))) * dj;
    float rj = r * (j == 0 ? 0.85 + 0.15 * h3(s, 7, j) : 0.5 + 0.25 * h3(s, 7, j));
    vec2 q = p - c - o;
    if ( j == 0 && yth > 0.03 ) { float h = clamp(dot(q, tl) / max(dot(tl, tl), 1e-4), 0.0, 1.0); q -= tl * h; rj *= 1.0 - 0.35 * h; }
    float w = 1.0 - dot(q, q) / (rj * rj);
    if ( w <= 0.0 ) continue;
    float wv = w * w * str;
    F += wv;
    bn += wv * vec3(q / rj, sqrt(w));                                  // (the body's normal: every lobe's, weighted - one surface...
    FA += wv * f;
    if ( wv > best ) { best = wv; dn0 = vec3(q / rj, sqrt(w)); bgy = dep; blv = lv; ba = a; }   // (... with its strongest billow's bump)
  }
}

void main() {
  ivec2 c = ivec2(vCell);
  vec2 p = vec2(c) + 0.5;
  float t = uNow;
  int R = 0, G = 0, B = 0, A = 0;
  float mD = 0.0;                                                      // (a blast's haze here: its motes' density)
  // ---------------------------------------------------------------- the ground: aura, film, marks, grit
  vec4 C = texelFetch(uCell, c, 0);
  if ( C.x < 1e8 ) {
    int code = int(mod(C.w, ${CODE_N.toFixed(1)})), lv = code & 3;
    float hw = floor(C.w / ${CODE_N.toFixed(1)}) * 0.25;
    vec4 k1 = uK1[code], k2 = uK2[code], k3 = uK3[code], k5 = uK5[code];
    vec4 Bk = uHasBack == 1 ? texelFetch(uBack, c, 0) : vec4(1e9);
    float a = t - C.x, fo = fadeAt(C.y, Bk.x, Bk.y, t), dn = abs(C.z) / hw;
    if ( a > 0.0 && fo > 0.0 ) {
      // the AURA: a haze that rises as the source passes, thins to a lingering veil, drifts downwind; organic outline from the noise
      vec2 dr = (uWind + uSWind) * 0.35 * t, q = (p - dr) / (0.55 * uG);
      float n = 0.65 * vn(q, uSeed) + 0.35 * vn(q * 2.3 + vec2(t * 0.07, -t * 0.05), uSeed + 1);
      // (a blast's HAZE, k5.y s: it spreads over the first minutes, holds as a pall, then thins over the second half of its life)
      float hz = k5.y > 0.0 ? 1.0 : 0.0, hl = 1.0;
      if ( hz > 0.0 ) hl = 1.0 - smoothstep(0.42 * k5.y, k5.y, a);
      float reach = 1.0 + k2.w * uG / hw * (0.45 + 0.55 * smoothstep(0.0, 2.5, a) + k5.z * smoothstep(2.0, 0.4 * k5.y + 1.0, a));
      float edge = dn + (n - 0.5) * 0.7;
      float env = smoothstep(0.0, 1.0, a) * mix(1.0, hz > 0.0 ? 0.62 : 0.42, smoothstep(1.5, hz > 0.0 ? 20.0 : 8.0, a)) * hl;
      float dens = (1.0 - smoothstep(0.3 * reach, reach, edge)) * env * fo * k3.x * (0.6 + 0.5 * n);
      if ( hz > 0.0 ) { mD = dens * smoothstep(1.5, 6.0, a); dens *= 1.45; }   // (a blast's haze: a fuller pall, its own veil - A bit 8)
      // (the bands' edges: a small-scale smooth noise - blobby pixel contours, never a salt-and-pepper dither over a big fading area)
      float dz = 0.0;
      if ( dens > 0.05 && dens < 0.8 ) dz = (vn(p / (2.0 * max(uU, 0.25)), uSeed + 31) - 0.5) * 0.3;
      int band = dens + dz > 0.52 ? 2 : dens + dz > 0.2 ? 1 : 0;
      // the FILM: settled dust in patches over the band
      float fil = smoothstep(0.6, 3.5, a) * fo * (hz > 0.0 ? smoothstep(0.0, 0.5, hl) : 1.0);
      bool film = false;
      if ( edge < 0.95 && fil > 0.0 ) film = vn(p / (2.5 * max(uU, 0.25)), uSeed + 33) < 0.62 * fil * (0.4 + 0.6 * n);   // (in patches, not specks)
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
        if ( (g1 || g2) && h3(c.x, c.y, 14) < fo * (hz > 0.0 ? smoothstep(0.0, 0.35, hl) : 1.0) ) { float ht = h3(c.x, c.y, 15); gt = ht < 0.5 ? 1 : ht < 0.88 ? 2 : 3; }
      }
      B = band + 4 * gt + (film ? 16 : 0);
      A = mk + (scuff ? 4 : 0) + (hz > 0.0 && band > 0 ? 8 : 0);
    }
  }
  // ---------------------------------------------------------------- puffs and chips: the tile's emitters
  vec4 th = texelFetch(uTileH, c >> 4, 0);
  int st = int(th.x), cnt = t > uPuffEnd ? 0 : int(th.y);
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
    vec4 k0 = uK0[code], k1 = uK1[code], k2 = uK2[code], k4 = uK4[code], k5 = uK5[code];
    vec2 P0 = e0.xy, Hd = e1.xy, N = vec2(-Hd.y, Hd.x) * e1.z;
    float eo = e2.x, ebk = e2.y, eo2 = e2.z;
    // CHIPS: a few frames of flight right after the kick (none if it was put out before)
    float ac = t - ke;
    if ( ac < 1.0 && ke < eo ) {
      int nC = int(k1.z);
      // (hits: out from the impact in every direction - the heading points back at it)
      vec2 thr = k4.z > 0.5 ? normalize(-Hd + N * 0.2 + vec2(1e-4)) : normalize(N + (-Hd) * (code < 8 ? 1.2 : 0.3));
      for ( int j = 0; j < 8; j++ ) {
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
    if ( ke < eo && ac < L ) puff(p, ac, L, 1.0, 1.0, 1.0, es, P0, Hd, N, k0, k4, lv);
    // the LINGERING ones: a share of the slots, smaller, lazier, never born after the put-out
    float t0 = ke + k1.x * 0.5;
    if ( t > t0 && k1.y > 0.0 ) {
      float m = floor((t - t0) / LIN_P);
      for ( int j = 0; j < 2; j++ ) {
        float kk = m - float(j); if ( kk < 0.0 ) continue;
        int ik = int(kk), sl = es * 7 + ik * 131 + 17;
        if ( h3(es, ik, 41) > k1.y ) continue;
        float b = t0 + kk * LIN_P + h3(es, ik, 42) * LIN_P * 0.5;
        if ( b > eo && !(b > ebk && b < eo2) ) continue;
        if ( k5.x > 0.0 && b > ke + k5.x ) continue;                  // (a blast's lazy puffs stop after linW s: its haze hangs on alone)            // (none after the put-out - or again after an undone eraser)
        float al = t - b, Ll = LIN_L * (0.85 + 0.3 * h3(es, ik, 43));
        if ( al < 0.0 || al > Ll ) continue;
        puff(p, al, Ll, 0.62, 0.4, 0.6, sl, P0, Hd, N, k0, k4, lv);
      }
    }
  }
  if ( chip > 0 ) { G = 64 + chip - 1; R = 1 + int(mod(floor(chipGy / uq), 255.0)); }
  else {
    float dz = (h3(c.x >> 1, c.y >> 1, 61) - 0.5) * 0.12;
    // (old dust breaks up: whole 2 x 2 clusters drop out as the puffs here age - destruction's dropout, never a soft fade)
    float age = FA / max(F, 1e-4);
    // (holes that open and grow as blobs: a coarse noise with a 2 x 2 grain, not a salt-and-pepper sieve)
    // (only where there is a body: the noises cost nothing elsewhere)
    float hole = 1.0, er = 0.0;
    if ( F > TH + dz ) { hole = 0.72 * vn(p / (5.0 * uU), uSeed + 21) + 0.28 * vn(p / (1.7 * max(uU, 0.25)), uSeed + 22); er = smoothstep(0.35, 1.0, age) * 0.9; }
    if ( F > TH + dz && hole >= er ) {
      vec3 n = normalize(mix(normalize(bn), dn0, 0.45) * vec3(1.0, 1.0, 1.1));
      float lum = dot(n, normalize(vec3(-0.55, -0.7, 0.6))) + (h3(c.x >> 1, c.y >> 1, 62) - 0.5) * 0.06;
      int band = lum > 0.55 ? 0 : lum > 0.12 ? 1 : 2;
      if ( F < TH + 0.045 + dz || (er > 0.0 && hole < er + 0.09) ) band = 3;   // (the rim - and round the holes that open as it ages: they erode, never punch)
      // FRESH: a puff in its first moments is the soil just kicked up - darker, denser; it pales as it spreads and dries
      // ...and as it ages it THINS in two steps before its holes open (aged, old): a fading cloud is a calm veil, never a busy
      // high-contrast camo over a dark ground (the steps' edges in the same blobby noise as the holes)
      float hv = hole * 0.16;
      int cls = ba < 0.55 + 0.25 * h3(c.x >> 1, c.y >> 1, 64) ? 1 : age > 0.62 + hv ? 3 : age > 0.4 + hv ? 2 : 0;
      G = 1 + band + 4 * (blv - 1) + 12 * cls;
      R = 1 + int(mod(floor(bgy / uq), 255.0));
    }
  }
  // MOTES of a blast's HAZE (the weather dust's way - weather/fx-glsl.mjs motes: hashed slots per world tile, whole-cycle lives of
  // 6 .. 10 s, a slow Brownian sway of a few sines, riding the wind - here one art pixel each, in the dust's own tones): specks of
  // the dust that hang in the air over the swept ground, lit (glint) in their prime and mid-tone as they come and go, fewer as the
  // haze thins; a slot looks at its 3 x 3 tiles only (the sway < a tile), so the cost is nine hashes a haze cell
  if ( mD > 0.03 && G == 0 && chip == 0 ) {
    const float MT = 10.0;
    vec2 q = p - (uWind + uSWind) * 0.5 * t;
    ivec2 tq = ivec2(floor(q / MT)), cq = ivec2(floor(q));
    for ( int j = -1; j <= 1 && G == 0; j++ ) for ( int i = -1; i <= 1; i++ ) {
      ivec2 tt = tq + ivec2(i, j);
      float L = 6.0 + 4.0 * h3(tt.x, tt.y, 71), ph = h3(tt.x, tt.y, 72) * L, cyc = floor((t + ph) / L), age = (t + ph - cyc * L) / L;
      int ci = int(cyc);
      float hk = h3(tt.x * 7 + ci, tt.y, 73);
      if ( hk > 1.3 * mD ) continue;                                  // (fewer where the haze is thin, none past it)
      float ha = h3(tt.x, tt.y * 3 + ci, 76), hb = h3(tt.x + ci * 5, tt.y, 77);
      if ( age < 0.04 + 0.12 * ha || age > 0.96 - 0.12 * hb ) continue;
      vec2 b = (vec2(tt) + vec2(h3(tt.x, tt.y + ci * 13, 74), h3(tt.x + ci * 17, tt.y, 75))) * MT;
      float T6 = t * 6.283, hs = h3(tt.x, tt.y, 78);
      vec2 sw = vec2(2.6 * sin(T6 * (0.05 + 0.04 * hs) + 6.28 * ha) + 1.1 * sin(T6 * (0.17 + 0.1 * hb) + 6.28 * hs),
                     1.8 * sin(T6 * (0.06 + 0.05 * hb) + 6.28 * hs) + 0.8 * sin(T6 * (0.19 + 0.08 * ha) + 6.28 * hb));
      float z = (2.0 + 6.0 * hb + 1.2 * sin(T6 * (0.08 + 0.05 * ha) + 6.28 * hk)) * uU;
      vec2 gp = b + sw;                                               // (its ground point; drawn lifted by its height)
      if ( ivec2(floor(gp - vec2(0.0, z * RY))) != cq ) continue;
      bool prime = age > 0.16 + 0.12 * ha && age < 0.84 - 0.12 * hb;
      G = 64 + (prime ? 2 : 1); R = 1 + int(mod(floor((gp.y + (p.y - q.y)) / uq), 255.0));
      break;
    }
  }
  if ( shadow ) B |= 32;
  // the puffs' ground SHADOW (two steps, a dithered 2 x 2 edge): under the ground layer's haze, over its marks
  float sz = FS + (h3(c.x >> 1, c.y >> 1, 66) - 0.5) * 0.1;
  if ( sz > 0.55 ) B |= 128; else if ( sz > 0.22 ) B |= 64;
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
// the dust's own colour from the ground's: desaturated toward soil; WATER (and any cold blue / teal ground) gives no blue dust - what
// rises over a bridge, a quay or a flooded street is the soil and grime of the road, so a cool tone hands over to the soil tone; a very
// dark ground still makes a dust a little lighter than it (dust scatters light: it reads lighter than dark earth)
float coldOf(vec3 T) { return clamp(smoothstep(0.02, 0.12, T.b - max(T.r, 0.85 * T.g)) + smoothstep(0.04, 0.16, min(T.g, T.b) - T.r) * 0.8, 0.0, 1.0); }
vec3 baseOf(vec3 T) {
  float l = dot(T, vec3(0.3, 0.59, 0.11));
  float cold = coldOf(T);
  vec3 b = mix(mix(T, vec3(l), 0.6), SOIL * (0.75 + 0.5 * l), 0.6);
  b = mix(b, SOIL * (0.78 + 0.35 * l), clamp(cold, 0.0, 1.0));
  return max(b, SOIL * 0.5);
}
// AT NIGHT (dust is not a light: the scene's darkness dims it with the map) it is a pale MOONLIT haze: its lit tops and the edges facing
// the light lift toward a cool pale value against the dimmed map, the cores and the shadow side stay dark - contrast by form, not glow
vec3 nightOf(vec3 rgb, int band, bool edge) {
  vec3 moon = vec3(0.78, 0.82, 0.92);
  vec3 c = band == 2 ? rgb * vec3(0.82, 0.86, 0.95) : band == 0 || band == 3 || edge ? mix(rgb * 1.2, moon, edge || band == 3 ? 0.6 : 0.42) : mix(rgb * 1.1, moon, 0.18);
  return min(c * mix(1.0, uLift, band == 2 ? 0.3 : 0.8), vec3(1.0));
}
// puff alpha by level (light, mid, shadow, rim) - and a fresh puff denser
const vec4 PA[4] = vec4[4](vec4(0.0), vec4(0.52, 0.60, 0.66, 0.28), vec4(0.68, 0.77, 0.84, 0.36), vec4(0.82, 0.89, 0.94, 0.46));`;

const DDEPTH = `
uniform vec4 uTok[16];
uniform int uTokN;
uniform float uU;
${HASH}
bool inFront(vec2 cf, int r) {
  if ( r <= 0 || uTokN == 0 ) return false;
  float uq = max(uU, 0.25); vec2 q = cf + 0.5; int lo = int(floor(q.y / uq)) - 24;
  float by = (float(lo) + mod(float(r - 1 - lo), 255.0)) * uq;
  for ( int k = 0; k < 16; k++ ) {
    if ( k >= uTokN ) break;
    vec4 T = uTok[k];
    if ( q.x < T.x || q.x >= T.z || q.y < T.y || q.y >= T.w ) continue;
    if ( by > T.w ) return true;
    // (dust just behind a token curls round its edges: along its sides and top, a ragged blobby band of the dust behind is drawn over
    // it - an opaque square token image never cuts the cloud with a straight square edge; its feet stay the depth line)
    float tw = T.z - T.x, de = min(min(q.x - T.x, T.z - q.x), q.y - T.y);
    if ( de < 0.17 * tw && de < 0.17 * tw * vn(q / max(1.0, 0.08 * tw), 57) ) return true;
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
  if ( a.g >= 64 ) {
    int k = a.g - 64; vec3 c = k == 0 ? b * 0.42 : k == 1 ? b * 0.68 : mix(b, vec3(1.0), 0.35);
    if ( uDark > 0.0 ) c = mix(c, k == 2 ? mix(c, vec3(0.85, 0.88, 0.95), 0.5) * uLift : c * 0.9, uDark);
    return vec4(min(c, vec3(1.0)), 1.0);
  }
  int v = a.g - 1, cls = v / 12, w = v - 12 * cls, lv = clamp(w / 4 + 1, 1, 3), band = w & 3;
  // light / mid / shadow / rim; a FRESH puff (just kicked up) richer and darker, an older one paler and thinner
  vec3 rgb = band == 0 ? min(b * 1.22 + 0.05, vec3(1.0)) : band == 1 ? b + 0.02 : band == 2 ? b * 0.7 : min(b * 1.12 + 0.04, vec3(1.0));
  float al = PA[lv][band];
  if ( cls == 1 ) { rgb *= band == 0 ? 0.95 : 0.9; al = min(0.97, al * 1.08 + 0.03); }
  else if ( band != 2 ) rgb = min(rgb * 1.04 + 0.01, vec3(1.0));
  // (aged / old: thinner, and its light / shadow closer together - the form softens as it spreads)
  if ( cls >= 2 ) { float k = cls == 2 ? 0.72 : 0.48; rgb = mix(b * 1.05 + 0.02, rgb, cls == 2 ? 0.7 : 0.45); al *= k; }
  if ( uDark > 0.0 ) {
    bool edge = art(p + ivec2(0, -1)).g == 0 || art(p + ivec2(-1, 0)).g == 0 || art(p + ivec2(-1, -1)).g == 0;
    rgb = mix(rgb, nightOf(rgb, band, edge), uDark);
    al = mix(al, min(0.97, al * (edge ? 1.18 : 1.08)), uDark);
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

// the GROUND under the tokens: marks, film, grit, chip shadows, the puffs' shadows, then the aura over them (premultiplied)
const GROUND = `${SHOW_COMMON}
${PAL}
const float AURA[3] = float[3](0.0, 0.15, 0.27);
// a blast's HAZE (A bit 8): a denser veil, a little paler and greyer than the soil - hanging dust that softens the map under it
const float HAZE[3] = float[3](0.0, 0.24, 0.42);
vec4 over(vec4 dst, vec3 c, float a) { return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a)); }
vec4 cellColor(vec2 cf) {
  ivec4 a = art(ivec2(cf));
  if ( a.b == 0 && a.a == 0 ) return vec4(0.0);
  vec3 T = toneAt(cf), b = baseOf(T), lit = min(b * 1.2 + 0.05, vec3(1.0));
  if ( uDark > 0.0 ) lit = mix(lit, nightOf(lit, 0, false), uDark);
  vec4 o = vec4(0.0);
  // (over WATER nothing is scraped and grit sinks: the marks and grains go, the film floats thin - a fading cloud over water leaves a
  // calm veil, not a field of specks)
  float wet = 1.0 - coldOf(T);
  int mk = a.a & 3;
  if ( mk > 0 ) o = over(o, T * 0.45, (mk == 1 ? 0.18 : 0.34) * wet);
  if ( (a.a & 4) != 0 ) o = over(o, lit, 0.24 * wet);
  // the settled FILM: a dust coat that dulls the ground under it
  if ( (a.b & 16) != 0 ) o = over(o, lit, 0.17 * (0.45 + 0.55 * wet));
  int gt = wet < 0.5 ? 0 : (a.b >> 2) & 3;
  // (grains in the soil's own dark / mid tone, not black: they read as grit on any ground, never as specks of ink)
  if ( gt > 0 ) o = over(o, gt == 1 ? mix(T * 0.5, b * 0.55, 0.5) : gt == 2 ? mix(T, b, 0.5) * 0.78 : mix(lit, vec3(1.0), 0.25), gt == 1 ? 0.8 : 0.72);
  if ( (a.b & 32) != 0 ) o = over(o, T * 0.3, 0.35);
  // the puffs' SHADOW: the cloud sits over the ground (weaker at night: no sun to cast it)
  int sh = (a.b >> 6) & 3;
  if ( sh > 0 ) o = over(o, T * 0.32, (sh == 2 ? 0.3 : 0.16) * (1.0 - 0.6 * uDark));
  int au = a.b & 3;
  // (by day a pale dust over the soil's own tone - it reads on a light ground as on a dark one; at night the moonlit soil tone)
  if ( au > 0 && (a.a & 8) != 0 ) o = over(o, mix(mix(lit, vec3(0.88, 0.85, 0.79), 0.5), lit, 0.8 * uDark), HAZE[au] * (1.0 + 0.25 * uDark));
  else if ( au > 0 ) o = over(o, lit, AURA[au] * (1.0 + 0.25 * uDark));
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
  art: PIXI.Program.from(VERT, ART, "moinen-maps-dust-art-v2"),
  tone: PIXI.Program.from(VERT, TONE, "moinen-maps-dust-tone-v2"),
  occ: PIXI.Program.from(VERT, OCC_F, "moinen-maps-dust-occ-v2"),
  ground: PIXI.Program.from(VERT_B(2), GROUND, "moinen-maps-dust-ground-v2"),
  show: PIXI.Program.from(VERT_B(0), SHOW, "moinen-maps-dust-show-v2"),
  front: PIXI.Program.from(VERT_B(0), FRONT, "moinen-maps-dust-front-v2")
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
    this.W = W; this.H = H; this.rect = rect; this.geo = geo; this.speed = speed || 1; this.ref = field.ref; this.maxKick = field.maxKick; this.puffEnd = field.puffEnd ?? 1e9;
    this.anim = true; this.glow = null; this.artT = null; this.job = null;
    this.cellTex = fTex(field.cell, W, H);
    this.emTex = fTex(field.em, field.emW, field.emH);
    this.tileTex = fTex(field.tileH, field.tw, field.th);
    this.idxTex = fTex(field.idx, 1024, field.idxH);
    // (an undone eraser over the dust: when it comes back per cell; none: a 1 x 1 stand-in, never read)
    this.backTex = field.back ? fTex(field.back, W, H) : fTex(new Float32Array([1e9, 1e9, 0, 0]), 1, 1);
    this.rt = rtOf(W, H);
    KT ??= kindTable();
    const wind = field.wind ?? [0, 0], g = grid;
    this.pass = null;   // (no fire `pass`: the tornado lean and the rain damper leave dust alone)
    this.dpass = new PIXI.Mesh(quad(0, 0, W, H, W, H), new PIXI.Shader(P.art, {
      uCell: this.cellTex, uEm: this.emTex, uTileH: this.tileTex, uIdx: this.idxTex, uBack: this.backTex, uHasBack: field.back ? 1 : 0, uNow: 0,
      uWind: new Float32Array([wind[0] * 0.25 * g, wind[1] * 0.25 * g]), uSWind: new Float32Array(2), uG: g, uU: g / 32, uSeed: (seed % 65536) | 0,
      uK0: KT[0], uK1: KT[1], uK2: KT[2], uK3: KT[3], uK4: KT[4], uK5: KT[5], uPuffEnd: field.puffEnd ?? 1e9, translationMatrix: new PIXI.Matrix().toArray(true) }));
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
  timeOf(T, now) {
    if ( !reducedMotion() ) return (this.frameMs(T, now) - this.ref) / 1000;
    // (an area of blasts: at rest after its last kick, then its haze thins on the clock - no pop when its minutes are over)
    return this.puffEnd < 1e8 ? Math.max(this.maxKick + 30, (this.frameMs(T, now) - this.ref) / 1000) : this.maxKick + 30;
  }
  setTime(T) { this.T = T; this.dpass.shader.uniforms.uNow = this.timeOf(T, sharedNow()); }
  setPhase() { /* (the frame's time comes with setTime) */ }
  setBirths() {}
  /** The scene's wind (weather): the puffs and the haze drift with it too (cells / s). */
  setSceneWind(x, y) { const u = this.dpass.shader.uniforms.uSWind; u[0] = x; u[1] = y; }
  setDark(d) {
    // (the lift: the inverse of Foundry's ambience filter luminosity at this darkness - FireArt.setDark's A7 rule - so the moonlit tops
    // of the dust keep their value against the dimmed map)
    const env = canvas.scene?.environment, cyc = env?.cycle !== false, bl = env?.base?.luminosity ?? 0, dl = env?.dark?.luminosity ?? 0;
    const lb = cyc ? bl + (dl - bl) * d : bl, lum = lb * (lb >= 0 ? 1.2 : 0.8), lift = 1 / Math.max(0.2, 1 + lum);
    for ( const m of [this.show, this.front, this.ground] ) { m.shader.uniforms.uDark = d; m.shader.uniforms.uLift = lift; }
  }
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
    const q = this._up ??= [this.cellTex, this.emTex, this.tileTex, this.idxTex, this.backTex];
    let sent = 0;
    while ( q.length && (sent === 0 || sent + q[0].baseTexture.width * q[0].baseTexture.height * 16 <= maxBytes) ) {
      const b = q.shift().baseTexture; renderer.texture.bind(b, 0); sent += b.width * b.height * 16;
    }
    return sent;
  }
  get uploaded() { return !!this._up && !this._up.length; }
  covers(w) { const a = this.artWin; return !!a && w[0] >= a[0] && w[1] >= a[1] && w[2] <= a[2] && w[3] <= a[3]; }
  destroy() {
    const tx = [this.cellTex, this.emTex, this.tileTex, this.idxTex, this.backTex, this.soil];
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
