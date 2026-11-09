/**
 * THE EXPLOSION FIRE, the look (burst-model.mjs is the pure part: the levels, the area, the motion of every body per frame). One
 * BurstArt per burst, drawn by the fire display like a fire-style area (FireArt's contract: the 12 fps art pass into a W x H texture of
 * art cells, windows, jobs, the next frame drawn ahead, staged adoption, the guard's budget), on the destruction layer's art grid, in
 * the fire's own pixel-art language and colours (look.mjs rampOf: a blue-gas or arcane bomb works as the fire colours do):
 *
 *  0. TONE PASS (once): the map under the area, one texel per 8 x 8 cells - the ground SURGE takes the ground's own colour (dust's rule)
 *  1. ART PASS (12 fps, the cells near the view): the frame's bodies (burstAt, on the CPU: a few dozen lobes, sparks and debris, sent as
 *     uniform arrays) drawn per art cell, RGBA8 -
 *       R = 1 + the ground row (art px, mod 255) of what is drawn there (its depth against the tokens: the fire's rule)
 *       G = 1..7 a flame cell (ramp step 0..6: the hot body, its colour from its heat), 9 / 10 fire-lit smoke (the brown that glows from
 *           inside), 11..14 smoke (light, mid, shadow, rim) and 15..18 the same thinning, 20..23 the ground surge's dust (light, mid,
 *           shadow, rim) and 24..27 thinning, 32..38 a spark (ramp step), 40 a burning chunk's lit top, 41 its dark body, 42 its trail
 *       B = the ground: 0..3 the heat pool under the flash + 4 / 8 the cloud's shadow + 16 a chunk's shadow
 *     The fireball is ONE metaball body of all its lobes (a rolling cauliflower, never a disc): shaded from the lobes' sphere normals
 *     (lit top-left), its colour from the lobes' heat, hotter inside than at the rim (the colour sinks from the outside in as it cools:
 *     cream, yellow, orange, red, the fire-lit brown, then the smoke column's own tones); its outline a ragged 2 x 2 rim; as it thins
 *     it erodes in blobby holes from the rim inwards (destruction's dropout, never a soft fade, never a square).
 *  2. GROUND (every frame, under the tokens): the heat pool and the cloud's shadow - a MULTIPLY of the map
 *  3. SHOW (under the tokens) and FRONT (above them): split per screen pixel by depth exactly as the fire's tongues
 *  4. EMISSION (into Foundry's illumination): the flames, sparks and burning chunks glow in the dark; the fire-lit smoke at half; the
 *     smoke and dust are not lights (they dim with the scene, the dust's moonlit rule at night)
 * Everything is a function of (cell, the record, the shared clock): every client draws the same frames.
 */
import { VERT, VERT_B, SHOW_COMMON, FOOTPRINT, blocks, quad, texOf, renderPass } from "./art.mjs";
import { footprintK } from "./shader.mjs";
import { rampOf, NATURAL } from "./look.mjs";
import { burstAt, surgeAt, BURST_LV, MAX_LOBES, MAX_SPARKS, MAX_DEBRIS } from "./burst-model.mjs";
import { view as viewOf } from "../view-angle.mjs";
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
uniform vec4 uLob[${MAX_LOBES * 2}];   // per lobe: [x, y, r, heat], [foot y, kind, weight, life share]
uniform int uLobN;
uniform vec4 uSpk[${MAX_SPARKS}];       // [x, y, temperature, ground y]
uniform int uSpkN;
uniform vec4 uDbr[${MAX_DEBRIS * 2}];   // [x, y, ground x, ground y], [state, heat, trail dx, trail dy]
uniform int uDbrN;
uniform vec2 uC;          // the ground point (cells, area-local)
uniform float uR;         // the fireball's radius (cells)
uniform float uAge;       // s since the impact (whole 12 fps frames)
uniform float uOutA;      // s since the impact it was taken back (1e9: never)
uniform float uU;         // cells per art px
uniform int uSeed;
uniform int uV3;         // 1: look 3 (burst-model BURST_V3)
uniform vec4 uSurge;     // look 3: the ground surge (burst-model surgeAt) [front radius, wall half-width, settled, shown]
uniform float uSq;       // the view's squash
out vec4 oArt;
${HASH}
const float TH = 0.13;
void main() {
  ivec2 c = ivec2(vCell);
  vec2 p = vec2(c) + 0.5;
  float uq = max(uU, 0.25);
  int R = 0, G = 0, B = 0;
  float FS = 0.0;
  vec3 L = normalize(vec3(-0.55, -0.7, 0.6));
  float put = uOutA < 1e8 ? smoothstep(uOutA, uOutA + 0.6, uAge) : 0.0;
  // THE BILLOWS: every lobe its own round billow with a lumpy edge, drawn back to front (the CPU sorts them: fill) - the front-most
  // billow covering a cell owns it (a cauliflower of overlapping billows, each lit, never one smooth blob); where a billow's edge lies
  // over another billow behind it a dark crease is drawn (the billows read one by one); a billow eroding (its age) opens blobby holes
  // that show the billows behind it
  if ( uV3 == 1 ) {
    // LOOK 3: ONE DENSITY FIELD over every billow (metaball kernels, no billow is ever a disc of its own) broken by a churning billow
    // noise; shaded by its own self-shadow (the density a step towards the light: the lit side is where it thins towards the sun);
    // the heat of the billows blended through it, hotter in the deep parts; cooling soot shows glowing VEINS (ridges of a noise that
    // drift up), never a flat brown slab; late in its life the threshold rises through big blobby holes - it thins into wisps.
    // The ground surge (kind 2) its own field in the ground's dust.
    vec2 lo = normalize(vec2(-0.55, -0.7)) * max(1.5, 0.08 * uR);
    float D = 0.0, D2 = 0.0, Hs = 0.0, Es = 0.0, Ds = 0.0, Ds2 = 0.0, Ea = 0.0, Fy = 0.0, Fw = 0.0, Kq = 0.0, Km = 0.0;
    vec3 Nn = vec3(0.0);
    for ( int i = 0; i < ${MAX_LOBES}; i++ ) {
      if ( i >= uLobN ) break;
      vec4 A = uLob[2 * i], Bq = uLob[2 * i + 1];
      bool gnd = Bq.y > 1.5;
      if ( !gnd ) {
        float hh = max(0.0, Bq.x - A.y);
        vec2 qs = p - vec2(A.x + 0.42 * hh, Bq.x + 0.08 * hh);
        float ws2 = 1.0 - dot(qs, qs) / (A.z * A.z * 1.15);
        if ( ws2 > 0.0 ) FS += ws2 * (1.0 - smoothstep(0.0, 3.5 * uR, hh));
      }
      float ri = A.z * 1.22;
      vec2 q = p - A.xy, q2 = q + lo;
      if ( gnd ) { q.y /= 0.6; q2.y /= 0.6; }
      float d = dot(q, q) / (ri * ri), d2 = dot(q2, q2) / (ri * ri);
      if ( d >= 1.0 && d2 >= 1.0 ) continue;
      float eri = smoothstep(0.45, 1.0, Bq.w) * 1.05 + put;
      float wi = Bq.z * (1.0 - 0.5 * min(1.0, eri));
      float k = d < 1.0 ? (1.0 - d) * (1.0 - d) * wi : 0.0, k2 = d2 < 1.0 ? (1.0 - d2) * (1.0 - d2) * wi : 0.0;
      if ( gnd ) { Ds += k; Ds2 += k2; Ea += k * min(1.0, Bq.w); }
      else {
        D += k; D2 += k2; Hs += k * A.w; Es += k * eri; Fy += k * Bq.x;
        // (each billow a lit SPHERE: its normal weighted by its share squared - the dominant billow decides, creases where two meet)
        if ( d < 1.0 ) { float kk = k * k; Nn += kk * vec3(q / ri, sqrt(1.0 - d) * 0.9); Kq += kk; Km = max(Km, k); }
      }
    }
    // (the billows' churn: two octaves riding up with the cloud; the same at the light's step, so the bumps shade themselves)
    vec2 dr = vec2(0.0, uAge * 1.3);
    float sc = max(6.0, 0.15 * uR) * uq;
    float nz = 0.72 * vn(p / sc + dr, uSeed + 41) + 0.28 * vn(p / (0.45 * sc) + dr * 1.6, uSeed + 42);
    float nz2 = 0.72 * vn((p + lo) / sc + dr, uSeed + 41) + 0.28 * vn((p + lo) / (0.45 * sc) + dr * 1.6, uSeed + 42);
    // (the density saturates inside, so the churn tears the OUTLINE into billows - a sum of many kernels alone grew a smooth slab
    // with straight sides)
    float Dn = 1.0 - exp(-2.2 * D) + (nz - 0.5) * 0.62, D2n = 1.0 - exp(-2.2 * D2) + (nz2 - 0.5) * 0.62;
    float E = Es / max(D, 1e-4);
    float holes = vn(p / (6.5 * uq) + vec2(0.0, uAge * 0.45), uSeed + 51);
    float th = 0.3 + E * (0.2 + 0.75 * holes);
    float bay = float((c.x & 1) * 2 + ((c.x ^ c.y) & 1)) / 4.0 - 0.375;   // (a 2 x 2 ordered dither at every tone step)
    if ( Dn > th && D > 0.02 ) {
      // (the light: the billow spheres' normals against the sun up-left, a crease where two billows share a cell, a little churn;
      // the density step towards the light only darkens the cloud's own far side - no noise-on-noise camouflage)
      vec3 nn = Kq > 0.0 ? normalize(Nn / Kq) : vec3(0.0, 0.0, 1.0);
      float crease = smoothstep(0.62, 0.35, Km / max(D, 1e-4));
      float lum = clamp(1.6 * dot(nn, L) - 0.55, -1.0, 1.0) - 0.45 * crease + clamp((Dn - D2n) * 1.2, -0.4, 0.2) + (nz - 0.5) * 0.22;
      float deep = smoothstep(th, th + 0.45, Dn), H = Hs / max(D, 1e-4);
      bool rim = Dn < th + 0.035;
      // (heat: the hot heart low and inside, the lit tops a step brighter, the shadow side and creases a step redder)
      float big = vn(p / (2.2 * sc) + dr * 0.5, uSeed + 61);
      float temp = H * (0.45 + 0.55 * deep) + (0.3 * lum - 0.1 * crease) * min(1.0, H * 3.0) + (big - 0.5) * 0.08 * min(1.0, H * 2.0);
      if ( temp > 0.34 ) {
        int st = temp > 0.86 ? 6 : temp > 0.72 ? 5 : temp > 0.6 ? 4 : temp > 0.47 ? 3 : 2;
        if ( rim ) st = max(2, st - 1);
        G = 1 + st;
      } else if ( temp > 0.1 ) {
        // cooling soot: the dark shell rolls over the fire - the glow lingers in the deep shadowed creases and the heart, in a few
        // broad patches that close up as it cools (never a network of veins)
        float gl = deep * (0.55 + 0.45 * big) + 0.35 * crease + 0.2 * max(0.0, -lum);
        float tv = 1.0 - (temp - 0.1) * 3.2;
        if ( !rim && gl > tv + 0.12 ) G = 1 + (temp > 0.25 ? 3 : 2);
        else if ( !rim && gl > tv ) G = 10;
        else { float lv2 = lum + bay * 0.14; G = 11 + (lv2 > 0.3 ? 0 : lv2 > -0.1 ? 1 : 2); }
      } else {
        float lv2 = lum + bay * 0.14;
        int band = lv2 > 0.35 ? 0 : lv2 > 0.0 ? 1 : lv2 > -0.45 ? 2 : 3;
        if ( rim && lum < 0.1 ) band = 3;
        G = 11 + band + (E > 0.35 || deep < 0.12 ? 4 : 0);
      }
      // (depth against the tokens: the fireball's moment only - the cloud that stands for minutes never covers a token)
      R = uAge < 1.4 ? 1 + int(mod(floor((Fy / max(D, 1e-4)) / uq), 255.0)) : 0;
    } else if ( uSurge.w > 0.0 ) {
      // THE GROUND SURGE: one ragged ring of dust rolling out over the ground (its front torn by an angular noise, a thinner veil
      // inside), lit by its own self-shadow, eroding in blobs as it settles - never single lens-shaped billows
      vec2 dv = p - uC; dv.y /= max(0.45, uSq);
      float rr = length(dv);
      // (a thick ROLL of billows, not a rope: the front gently scalloped, the wall broken into lumps by a big noise riding outward)
      vec2 cs = rr > 1e-3 ? dv / rr : vec2(1.0, 0.0);   // (noise round the ring sampled on a circle: no seam where the angle wraps)
      float tear = (vn(cs * 2.2 + vec2(3.0, uAge * 0.5), uSeed + 71) - 0.5) * 0.28;
      float Rs = uSurge.x * (1.0 + tear), W = uSurge.y * 1.35 * (0.85 + 0.4 * vn(cs * 1.6 + 7.0, uSeed + 73));
      vec2 bq = (dv - cs * uSurge.x * 0.6) / (0.9 * sc);
      float lump = 0.6 * vn(bq, uSeed + 74) + 0.4 * vn(bq * 2.3 + 5.0, uSeed + 75);
      float x1 = (rr - Rs * (1.0 + 0.1 * (lump - 0.5))) / W;
      float wall = max(0.0, 1.0 - x1 * x1);
      float veil = 0.22 * smoothstep(0.2, -2.2, x1) * (1.0 - uSurge.z);
      float Dsn = (max(wall * (0.1 + 1.35 * lump), veil) + (lump - 0.5) * 0.4) * uSurge.w;
      float ths = 0.48 + uSurge.z * (0.25 + 0.9 * holes);
      if ( Dsn > ths ) {
        // (lit as a torus: its section's normal - out and up - against the sun, the lumps shading themselves)
        vec2 dir = cs;
        float xc = clamp(x1, -1.0, 1.0);
        vec3 tn = normalize(vec3(dir * xc * vec2(1.0, uSq), sqrt(max(0.05, 1.0 - xc * xc))));
        float lum = clamp(1.5 * dot(tn, L) - 0.5, -1.0, 1.0) + (lump - 0.5) * 0.5 + bay * 0.12;
        int band = lum > 0.3 ? 0 : lum > -0.05 ? 1 : 2;
        if ( Dsn < ths + 0.03 && lum < 0.1 ) band = 3;
        G = 20 + band + (uSurge.z > 0.4 || wall < 0.05 ? 4 : 0);
        R = uAge < 1.0 ? 1 + int(mod(floor(p.y / uq), 255.0)) : 0;
      }
    }
  } else {
    int top = -1, cover = 0;
    float tD = 0.0, tR = 1.0;
    vec2 tq = vec2(0.0);
    // (the fire's HEAT as one field over the whole cloud: the billows' heats blended by their cover - the colour runs across the
    // billows in organic patches, never a ring per billow or single billows gone grey on a hot ball)
    float hs = 0.0, ws = 0.0;
    for ( int i = 0; i < ${MAX_LOBES}; i++ ) {
      if ( i >= uLobN ) break;
      vec4 A = uLob[2 * i], Bq = uLob[2 * i + 1];
      // the cloud's SHADOW on the ground: each billow's footprint cast down-right by its height
      if ( Bq.y < 1.5 ) {
        float hh = max(0.0, Bq.x - A.y);
        vec2 qs = p - vec2(A.x + 0.42 * hh, Bq.x + 0.08 * hh);
        float ws2 = 1.0 - dot(qs, qs) / (A.z * A.z * 1.15);
        if ( ws2 > 0.0 ) FS += ws2 * (1.0 - smoothstep(0.0, 3.5 * uR, hh));
      }
      // erosion (late in its life, or taken back): the billow shrinks, thins and opens a few big blobby holes from its rim - it
      // dissolves, never in square specks
      float er = smoothstep(0.45, 1.0, Bq.w) * 1.05 + put;
      vec2 q = p - A.xy;
      if ( Bq.y > 1.5 ) q.y /= 0.62;   // (the ground surge: low, wide billows)
      // (a lumpy edge in two octaves - a billow is a clump of small bulges, never a clean circle)
      vec2 lp = vec2(c >> 1) * 2.0 + 0.5;
      float rr = A.z * min(1.0, Bq.z * 2.5) * (0.76 + 0.24 * vn(lp / max(1.5, 0.3 * A.z), uSeed + 7 * i) + 0.16 * vn(lp / max(1.2, 0.13 * A.z), uSeed + 7 * i + 3));
      rr *= 1.0 - 0.3 * smoothstep(0.2, 1.0, er);
      float d2 = dot(q, q);
      if ( d2 >= rr * rr ) continue;
      float d = sqrt(d2) / rr;
      if ( er > 0.3 ) {
        float hole = 0.75 * vn(p / (6.0 * uq), uSeed + 21 + i) + 0.25 * vn(p / (3.2 * uq), uSeed + 22);
        if ( hole + 0.45 * (1.0 - d) < er - 0.2 ) continue;
      }
      if ( Bq.y < 1.5 ) { float w = 1.0 - d * d; w *= w; hs += w * A.w; ws += w; }
      cover++;
      top = i; tD = d; tR = rr; tq = q;
    }
    if ( top >= 0 ) {
      vec4 A = uLob[2 * top], Bq = uLob[2 * top + 1];
      vec3 n = vec3(tq / tR, sqrt(max(0.0, 1.0 - tD * tD)));
      // (a churning texture over the cloud: two octaves drifting with its age - the tone bands' edges wander organically)
      float tz = 0.75 * vn(p / (4.0 * uq) + vec2(0.0, uAge * 1.6), uSeed + 41) + 0.25 * vn(p / (2.2 * uq) - vec2(uAge * 0.9, 0.0), uSeed + 42);
      float lum = dot(n, L) + (tz - 0.5) * 0.4;
      // (an edge: the outline of the cloud, or a crease where this billow lies over another one behind it)
      // (the outline only on the cloud's outside; where a billow lies over another, a broken crease - the billows read one by one
      // without each being ringed)
      bool rim = tD > 0.9;
      bool crease = rim && cover > 1;
      if ( crease && (tD < 0.95 || h3(c.x >> 1, c.y >> 1, 63) < 0.35) ) { rim = false; crease = false; }
      float age = Bq.w;
      float er = smoothstep(0.45, 1.0, age) * 1.05 + put;
      if ( Bq.y < 1.5 ) {
        // fire and smoke: the cloud's heat field, hotter where it is deep (the overlaps) than at its outside edge - the colour sinks
        // from the outside in; the churn and a fine dither break the bands into ragged patches
        float H = hs / max(ws, 1e-4), deep = min(1.0, ws * 2.2);
        // (each billow keeps its form: lit top left, its lower right a step darker, a dark crease where it lies over another - the
        // cloud reads as a cauliflower of billows in one fire, never a flat slab)
        float temp = H * (0.62 + 0.38 * deep) + 0.16 * (lum - 0.15) + (tz - 0.5) * 0.18 * min(1.0, H * 2.0);
        bool fold = tD > 0.8 && cover > 1 && lum < 0.15 && h3(c.x >> 1, c.y >> 1, 65) < 0.8;
        int fG = 0;
        if ( temp > 0.33 ) {
          int st = temp > 0.88 ? 6 : temp > 0.74 ? 5 : temp > 0.6 ? 4 : temp > 0.47 ? 3 : temp > 0.39 ? 2 : 1;
          st = max(st, 2);                                  // (inside: never the plum / dark red - they are the outline's)
          if ( (lum < -0.1 || fold) && st > 2 && st < 6 ) st--;
          if ( rim && !crease ) st = max(1, min(st - 1, temp > 0.6 ? 3 : 2));
          fG = 1 + st;
        } else if ( temp > 0.17 ) fG = (rim && !crease) || lum < -0.12 || fold ? 10 : 9;
        else {
          // (smoke: three tones by its light and churn, the outline broken and the outer edge thinning - a billowing column, never
          // stacked clay discs)
          int band = rim && !crease ? (h3(c.x >> 1, c.y >> 1, 66) < 0.55 ? 3 : 1) : lum > 0.38 ? 0 : lum > -0.02 && !fold ? 1 : 2;
          bool edgeThin = tD > 0.82 && !(cover > 1) && h3(c.x >> 1, c.y >> 1, 68) < 0.6;
          fG = 11 + band + (age > 0.78 || er > 0.3 || edgeThin ? 4 : 0);
        }
        G = fG;
      } else {
        int band = lum > 0.5 ? 0 : lum > 0.05 ? 1 : 2;
        if ( rim && !crease ) band = 3;
        G = 20 + band + (age > 0.7 ? 4 : 0);
      }
      R = 1 + int(mod(floor(max(Bq.x, A.y) / uq), 255.0));
    }
  }
  // ---------------------------------------------------------------- sparks: one art px, cooling through the ramp
  int sz = max(1, int(uU + 0.5));
  for ( int i = 0; i < ${MAX_SPARKS}; i++ ) {
    if ( i >= uSpkN ) break;
    vec4 S = uSpk[i];
    ivec2 ci = ivec2(floor(S.xy));
    if ( c.x >= ci.x && c.x < ci.x + sz && c.y >= ci.y && c.y < ci.y + sz ) {
      int st = S.z > 0.8 ? 6 : S.z > 0.6 ? 5 : S.z > 0.42 ? 4 : S.z > 0.25 ? 3 : 2;
      G = 32 + st; R = 1 + int(mod(floor(S.w / uq), 255.0));
    }
  }
  // ---------------------------------------------------------------- debris: burning chunks on their arcs, a trail, a shadow
  int s2 = max(2, int(2.0 * uU + 0.5));
  for ( int i = 0; i < ${MAX_DEBRIS}; i++ ) {
    if ( i >= uDbrN ) break;
    vec4 D0 = uDbr[2 * i], D1 = uDbr[2 * i + 1];
    if ( D1.x < 1.5 ) {
      ivec2 ci = ivec2(floor(D0.xy)) - ivec2(s2 / 2);
      // (a chunk inside the fireball is hidden in it - dark specks in the white core read as holes; its corners knocked off: a lump,
      // never a square)
      bool inFire = G >= 1 && G <= 10;
      ivec2 cc = c - ci;
      bool corner = (cc.x == 0 || cc.x == s2 - 1) && (cc.y == 0 || cc.y == s2 - 1) && h3(i, cc.x + 4 * cc.y, 71) < 0.7;
      if ( !inFire && !corner && c.x >= ci.x && c.x < ci.x + s2 && c.y >= ci.y && c.y < ci.y + s2 ) { G = c.y < ci.y + max(1, s2 / 2) ? 40 : 41; R = 1 + int(mod(floor(D0.w / uq), 255.0)); }
      else {
        for ( int k = 1; k <= 3; k++ ) {
          ivec2 ct = ivec2(floor(D0.xy + D1.zw * float(k) * 0.9));
          if ( c == ct && h3(i, k, int(uAge * 12.0)) < 0.85 - 0.2 * float(k) && G == 0 ) { G = 42; R = 1 + int(mod(floor(D0.w / uq), 255.0)); }
        }
      }
      if ( c == ivec2(floor(D0.zw)) ) B |= 16;
    } else if ( D1.y > 0.0 ) {
      // just landed: a little flare where its fire will catch
      // (look 3: a few scattered sparks, never a round yellow blot that breaks up like a firework)
      vec2 q = (p - D0.zw) / (uq * (1.0 + (uV3 == 1 ? 0.9 : 2.0) * D1.y));
      if ( dot(q, q) < 1.2 && h3(c.x, c.y, int(uAge * 12.0)) < (uV3 == 1 ? 0.5 * D1.y : D1.y + 0.2) ) { G = 32 + (D1.y > 0.6 ? 5 : D1.y > 0.3 ? 4 : 3); R = 1 + int(mod(floor(D0.w / uq), 255.0)); }
    }
  }
  // ---------------------------------------------------------------- the ground: a heat pool under the flash, the cloud's shadow
  vec2 g = (p - uC) / vec2(uR * 1.5, uR * 1.2);
  // (nothing before the impact: uAge < 0 in the pre-roll - exp() of it grew the pool over the map before the bomb had landed)
  float pool = uAge < 0.0 ? -1.0 : (1.0 - dot(g, g)) * exp(-uAge / 0.45) * (1.0 - put);
  // (the steps' edges in a smooth blobby noise - a hashed 2 x 2 grain read as square blocks round the shadow)
  float gz = vn(p / (3.0 * uq), uSeed + 67) - 0.5;
  pool += gz * 0.16;
  if ( pool > 0.55 ) B |= 3; else if ( pool > 0.3 ) B |= 2; else if ( pool > 0.12 ) B |= 1;
  float sh = FS + gz * 0.22;
  if ( sh > 0.6 ) B |= 8; else if ( sh > 0.25 ) B |= 4;
  oArt = vec4(float(R), float(G), float(B), 0.0) / 255.0;
}`;

// the tone pass: the map under each 8 x 8 cells, 16 taps (dust-art.mjs's)
const TONE = `#version 300 es
precision highp float;
in vec2 vCell;
uniform sampler2D uMap;
uniform vec4 uMapR;
uniform vec4 uMapF;
uniform vec3 uGeo;
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

// the colours: the fire's ramp for the flames, the smoke column's tones for the cap (the joint with the column stroke has one tone),
// the ground's own colour for the surge
const PAL = `
uniform sampler2D uTone;
uniform vec2 uToneN;
uniform int uLv;
const vec3 SOIL = vec3(0.66, 0.58, 0.47);
const vec3 SMK[9] = vec3[9](vec3(0.741, 0.718, 0.678), vec3(0.557, 0.537, 0.506), vec3(0.384, 0.369, 0.408),
                            vec3(0.788, 0.765, 0.722), vec3(0.545, 0.525, 0.494), vec3(0.310, 0.294, 0.341),
                            vec3(0.561, 0.537, 0.498), vec3(0.349, 0.333, 0.369), vec3(0.173, 0.165, 0.196));
const vec3 S_A[4] = vec3[4](vec3(0.0), vec3(0.8, 0.86, 0.9), vec3(0.88, 0.93, 0.96), vec3(0.92, 0.96, 0.98));
const vec4 PA = vec4(0.78, 0.84, 0.88, 0.55);
vec3 toneAt(vec2 cf) { return texture(uTone, (cf + 0.5) / (8.0 * uToneN)).rgb; }
float coldOf(vec3 T) { return clamp(smoothstep(0.02, 0.12, T.b - max(T.r, 0.85 * T.g)) + smoothstep(0.04, 0.16, min(T.g, T.b) - T.r) * 0.8, 0.0, 1.0); }
vec3 baseOf(vec3 T) {
  float l = dot(T, vec3(0.3, 0.59, 0.11));
  vec3 b = mix(mix(T, vec3(l), 0.6), SOIL * (0.75 + 0.5 * l), 0.6);
  b = mix(b, SOIL * (0.78 + 0.35 * l), coldOf(T));
  return max(b, SOIL * 0.5);
}
// a body cell's colour, premultiplied
vec4 burstColor(ivec2 p, ivec4 a) {
  int g = a.g;
  if ( g == 0 ) return vec4(0.0);
  if ( g >= 1 && g <= 7 ) { float al = g <= 2 ? 0.92 : 1.0; vec3 c = min(uRamp[g - 1].rgb * uLift, vec3(1.0)); return vec4(c * al, al); }
  if ( g == 9 || g == 10 ) { float al = g == 9 ? 0.95 : 0.9; vec3 c = min(uRamp[g == 9 ? 10 : 11].rgb * mix(1.0, uLift, 0.6), vec3(1.0)); return vec4(c * al, al); }
  if ( g >= 32 && g <= 38 ) return vec4(min(uRamp[g - 32].rgb * uLift, vec3(1.0)), 1.0);
  if ( g == 40 ) return vec4(min(uRamp[4].rgb * uLift, vec3(1.0)), 1.0);
  if ( g == 41 ) return vec4(vec3(0.13, 0.1, 0.09), 1.0);
  if ( g == 42 ) return vec4(SMK[7] * 0.6, 0.6);
  bool edge = false;
  if ( uDark > 0.0 ) edge = art(p + ivec2(0, -1)).g == 0 || art(p + ivec2(-1, 0)).g == 0;
  if ( g >= 11 && g <= 18 ) {
    int k = g - 11, band = k & 3, ls = clamp(uLv, 1, 3);
    bool thin = k >= 4;
    vec3 rgb = SMK[(ls - 1) * 3 + min(band, 2)];
    // (a grenade's puff is dirty: the ground's dust mixed into it)
    if ( uLv == 1 ) rgb = mix(rgb, baseOf(toneAt(vec2(p))) * (band == 0 ? 1.05 : band == 1 ? 0.85 : 0.62), 0.5);
    float al = band == 3 ? 0.42 + 0.08 * float(ls) : S_A[ls][min(band, 2)];
    if ( thin ) { rgb = mix(rgb, SMK[(ls - 1) * 3 + 1], 0.4); al *= 0.75; }
    if ( uDark > 0.0 ) {
      vec3 cool = rgb * vec3(0.9, 0.95, 1.06);
      // (moonlit tops only a little: a bright rim read as a pale disc with a white outline at night)
      if ( band == 0 || edge ) cool = mix(cool, vec3(0.8, 0.83, 0.9), edge ? 0.18 : 0.14);
      rgb = mix(rgb, cool, uDark);
    }
    return vec4(rgb * al, al);
  }
  if ( g >= 20 && g <= 27 ) {
    int k = g - 20, band = k & 3; bool thin = k >= 4;
    vec3 b = baseOf(toneAt(vec2(p)));
    vec3 rgb = band == 0 ? min(b * 1.22 + 0.05, vec3(1.0)) : band == 1 ? b + 0.02 : band == 2 ? b * 0.7 : min(b * 1.12 + 0.04, vec3(1.0));
    float al = PA[band];
    if ( thin ) { rgb = mix(b * 1.05 + 0.02, rgb, 0.6); al *= 0.6; }
    if ( uDark > 0.0 ) {
      vec3 moon = vec3(0.78, 0.82, 0.92);
      vec3 nc = band == 2 ? rgb * vec3(0.82, 0.86, 0.95) : mix(rgb * 1.15, moon, edge || band == 3 ? 0.5 : 0.25);
      rgb = mix(rgb, min(nc * mix(1.0, uLift, 0.7), vec3(1.0)), uDark);
    }
    return vec4(rgb * al, al);
  }
  return vec4(0.0);
}`;

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

const SHOW = `${SHOW_COMMON}
${PAL}
${DDEPTH}
vec4 cellColor(vec2 cf) { ivec2 p = ivec2(cf); return burstColor(p, art(p)); }
#define OUT(c) ((c) * uAlpha)
#define SIDE 0
#define OCC 0
${FOOTPRINT}`;
const FRONT = `${SHOW_COMMON}
${PAL}
${DDEPTH}
vec4 cellColor(vec2 cf) { ivec2 p = ivec2(cf); return burstColor(p, art(p)); }
#define OUT(c) ((c) * uAlpha)
#define SIDE 1
#define OCC 0
${FOOTPRINT}`;
// the ground: a MULTIPLY of the map (rgb = factor; 1 = untouched)
const GROUND = `${SHOW_COMMON}
vec4 cellColor(vec2 cf) {
  int b = art(ivec2(cf)).b;
  vec3 m = vec3(1.0);
  int pl = b & 3;
  if ( pl > 0 ) m *= 1.0 - float(pl) * 0.16 * (1.0 - mix(vec3(1.0, 0.86, 0.70), vec3(1.0, 0.92, 0.82), uDark));
  int sh = (b >> 2) & 3;
  if ( sh > 0 ) m *= 1.0 - (sh == 2 ? 0.22 : 0.12) * (1.0 - 0.6 * uDark);
  if ( (b & 16) != 0 ) m *= 0.72;
  return vec4(m, 1.0);
}
#define OUT(c) vec4(mix(vec3(1.0), (c).rgb, uAlpha), 1.0)
#define OCC 2
${FOOTPRINT}`;
// the EMISSION (Foundry's illumination, MAX): what burns glows in the dark - the flames, sparks, burning chunks; the fire-lit smoke at
// half; the heat pool a little
const EMIT = `${SHOW_COMMON}
vec4 cellColor(vec2 cf) {
  ivec4 a = art(ivec2(cf));
  if ( a.g >= 1 && a.g <= 7 ) return vec4(a.g <= 2 ? 0.92 : 1.0);
  if ( a.g == 9 || a.g == 10 ) return vec4(0.45);
  if ( (a.g >= 32 && a.g <= 38) || a.g == 40 ) return vec4(1.0);
  int pl = a.b & 3;
  if ( pl > 0 ) return vec4(0.08 * float(pl));
  return vec4(0.0);
}
#define OUT(c) ((c) * uAlpha)
#define OCC 3
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
  bool fl = false, gr = false, em = false;
  for ( int y = c0.y; y < c1.y; y++ ) for ( int x = c0.x; x < c1.x; x++ ) {
    ivec4 a = ivec4(texelFetch(uArt, ivec2(x, y), 0) * 255.0 + 0.5);
    fl = fl || a.g > 0; gr = gr || a.b > 0;
    em = em || (a.g >= 1 && a.g <= 10) || (a.g >= 32 && a.g <= 40) || (a.b & 3) > 0;
  }
  oOcc = vec4(fl, 0.0, gr, em);
}`;

let progs = null;
const programs = () => progs ??= {
  art: PIXI.Program.from(VERT, ART, "moinen-maps-burst-art-v3"),
  tone: PIXI.Program.from(VERT, TONE, "moinen-maps-burst-tone-v1"),
  occ: PIXI.Program.from(VERT, OCC_F, "moinen-maps-burst-occ-v1"),
  ground: PIXI.Program.from(VERT_B(2), GROUND, "moinen-maps-burst-ground-v1"),
  show: PIXI.Program.from(VERT_B(0), SHOW, "moinen-maps-burst-show-v1"),
  front: PIXI.Program.from(VERT_B(0), FRONT, "moinen-maps-burst-front-v1"),
  emit: PIXI.Program.from(VERT_B(3), EMIT, "moinen-maps-burst-emit-v1")
};
/** Every burst program (the pre-warm links them in the background: fire.mjs). */
export const burstPrograms = () => Object.values(programs());

const rtOf = (W, H, lin = false) => { const r = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: lin ? PIXI.SCALE_MODES.LINEAR : PIXI.SCALE_MODES.NEAREST }); r.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF; return r; };
const SOIL_TEX = () => texOf(new Uint8Array([168, 148, 120, 255]), 1, 1);

/**
 * One burst (FireArt's contract for the display: isArt, W, H, artT, artWin, anim, setTime, setPhase, setDark, setTokens, renderArt,
 * extendArt, startJob, startPre, stepJob, swapJob, clocksAt, jobLeft, covers, uploadStep, uploaded, glow, destroy) + setDetail (the
 * guard: the sparks' share) and setSceneWind.
 */
export class BurstArt extends PIXI.Container {
  constructor(field, rect, geo, { front = null, grid = 32, speed = 1, map = null, color = null } = {}) {
    super();
    this.eventMode = "none"; this.interactiveChildren = false;
    const { ap, ox, oy } = geo, W = field.w, H = field.h, P = programs();
    const x0 = ox + rect.x0 * ap, y0 = oy + rect.y0 * ap;
    this.W = W; this.H = H; this.rect = rect; this.geo = geo; this.speed = speed || 1; this.ref = field.ref ?? 0; this.field = field;
    this.anim = true; this.artT = null; this.job = null; this.pass = null; this.det = 1; this.sw = [0, 0]; this.view = viewOf();
    this.bodies = burstAt(field, -1, this.view);
    this.rt = rtOf(W, H);
    const g = grid;
    this.dpass = new PIXI.Mesh(quad(0, 0, W, H, W, H), new PIXI.Shader(P.art, {
      uLob: new Float32Array(MAX_LOBES * 8), uLobN: 0, uSpk: new Float32Array(MAX_SPARKS * 4), uSpkN: 0, uDbr: new Float32Array(MAX_DEBRIS * 8), uDbrN: 0,
      uC: new Float32Array(field.c ?? [0, 0]), uR: field.R ?? 1, uAge: -1, uOutA: field.out ?? 1e9, uU: g / 32, uSeed: (field.seed ?? 1) | 0, uV3: field.v3 ? 1 : 0, uSurge: new Float32Array(4), uSq: 0.8,
      translationMatrix: new PIXI.Matrix().toArray(true) }));
    const TW = Math.ceil(W / 8), TH = Math.ceil(H / 8);
    this.toneRt = map ? rtOf(TW, TH, true) : null;
    if ( map ) {
      const t = map.texture, b = t.baseTexture, f = t.frame;
      this.tonePass = new PIXI.Mesh(quad(0, 0, TW, TH, TW, TH), new PIXI.Shader(P.tone, { uMap: t, uMapR: new Float32Array(map.rect),
        uMapF: new Float32Array([f.x / b.width, f.y / b.height, f.width / b.width, f.height / b.height]), uGeo: new Float32Array([x0, y0, 8 * ap]),
        translationMatrix: new PIXI.Matrix().toArray(true) }));
    } else this.soil = SOIL_TEX();
    this.toneDone = !map;
    this.occRt = rtOf(TW, TH);
    this.occPass = new PIXI.Mesh(quad(0, 0, TW, TH, TW, TH), new PIXI.Shader(P.occ, { uArt: this.rt, uSize: new Float32Array([W, H]), translationMatrix: new PIXI.Matrix().toArray(true) }));
    this.tok = new Float32Array(64);
    const ramp = rampOf(color ?? field.color ?? NATURAL);
    const common = () => ({ uArt: this.rt, uOcc: this.occRt, uSize: new Float32Array([W, H]), uK: footprintK(), uAlpha: 1, uDark: 0, uTok: this.tok, uTokN: 0, uU: g / 32,
      uTone: this.toneRt ?? this.soil, uToneN: new Float32Array([TW, TH]), uLift: 1, uRamp: new Float32Array(ramp.ramp7), uSmokeTint: new Float32Array(4), uLv: field.lv ?? 2,
      translationMatrix: new PIXI.Matrix().toArray(true) });
    const bg = blocks(x0, ap, y0, W, H);
    const live = (m, own = true) => { m.eventMode = "none"; const r0 = m._render.bind(m); m._render = (renderer) => { if ( own && (!this.worldVisible || !this.parent) ) return; if ( !own && (!this.worldVisible || !this.parent) ) return; const u = m.shader.uniforms; u.uAlpha = this.worldAlpha; u.uK = footprintK(); r0(renderer); }; };
    this.ground = new PIXI.Mesh(bg, new PIXI.Shader(P.ground, common())); this.ground.state.blendMode = PIXI.BLEND_MODES.MULTIPLY;
    this.show = new PIXI.Mesh(bg, new PIXI.Shader(P.show, common())); this.show.state.blendMode = PIXI.BLEND_MODES.NORMAL;
    for ( const m of [this.ground, this.show] ) live(m);
    this.addChild(this.ground, this.show);
    this.front = new PIXI.Mesh(bg, new PIXI.Shader(P.front, common())); this.front.state.blendMode = PIXI.BLEND_MODES.NORMAL; this.front.visible = false;
    // (over the other areas - the dust's ground puffs - in both containers: the display sorts by zIndex, insertion order otherwise;
    // the front's particles stay on top at zIndex 1)
    this.zIndex = 1; this.front.zIndex = 0.5;
    live(this.front, false);
    (front ?? this).addChild(this.front);
    // the emission lives in the illumination layer: it follows this area's visibility and alpha
    this.glow = new PIXI.Mesh(bg, new PIXI.Shader(P.emit, common()));
    this.glow.state.blendMode = PIXI.BLEND_MODES.MAX_COLOR;
    live(this.glow, false);
    canvas.effects?.illumination?.lights?.addChild(this.glow);
  }
  get isArt() { return true; }

  frameMs(T, now) {
    const sp = this.speed, kNow = Math.floor(now * sp / 83.333), kk = Math.round(T * 12);
    const k = kNow - (((kNow - kk) % 12000) + 12000) % 12000;
    return k * 83.333 / sp;
  }
  /** The burst's age (s since the impact) at the frame `T` stands for (reduced motion: none - the display never shows it then). */
  timeOf(T, now) { return reducedMotion() ? -1 : (this.frameMs(T, now) - this.ref) / 1000; }
  /** The bodies of age `a` (burstAt) into the art pass's uniforms. */
  fill(a, sw = this.sw) {
    const u = this.dpass.shader.uniforms, b = burstAt(this.field, a, this.view, sw, this.det, this.bodies);
    // (the billows back to front: the nearer the camera - its ground row, and its height a little - the later; the art pass lets the
    // last billow over a cell own it)
    const n = b.n[0], ord = this._ord ??= [], key = this._key ??= new Float32Array(64), L = b.lob, U = u.uLob;
    ord.length = n;
    for ( let i = 0; i < n; i++ ) { ord[i] = i; key[i] = L[i * 8 + 4] + (L[i * 8 + 4] - L[i * 8 + 1]) * 0.5 + i * 1e-4; }
    ord.sort((x, y) => key[x] - key[y]);
    for ( let k = 0; k < n; k++ ) { const j = ord[k] * 8; for ( let m = 0; m < 8; m++ ) U[k * 8 + m] = L[j + m]; }
    u.uSpk.set(b.spk); u.uDbr.set(b.dbr);
    u.uLobN = b.n[0]; u.uSpkN = b.n[1]; u.uDbrN = b.n[2]; u.uAge = a;
    if ( this.field.v3 ) { surgeAt(this.field, a, this._sg ??= [0, 0, 0, 0]); u.uSurge.set(this._sg); u.uSq = this.view?.squash ?? 0.8; }
    this.fa = a; this.fsw = [sw[0], sw[1]];
  }
  setTime(T) { this.T = T; this.tNow = this.timeOf(T, sharedNow()); }
  setPhase() {}
  setBirths() {}
  /** The guard's level (fire/guard.mjs parts, 0..1): the share of the sparks (never the fireball's lobes: its silhouette stays). */
  setDetail(d) { this.det = Math.max(0.25, Math.min(1, d)); }
  setSceneWind(x, y) { this.sw = [x, y]; }
  setDark(d) {
    const env = canvas.scene?.environment, cyc = env?.cycle !== false, bl = env?.base?.luminosity ?? 0, dl = env?.dark?.luminosity ?? 0;
    const lb = cyc ? bl + (dl - bl) * d : bl, lum = lb * (lb >= 0 ? 1.2 : 0.8), lift = 1 / Math.max(0.2, 1 + lum);
    for ( const m of [this.show, this.front, this.ground, this.glow] ) { m.shader.uniforms.uDark = d; m.shader.uniforms.uLift = lift; }
  }
  setTokens(list) {
    const { ap, ox, oy } = this.geo, r = this.rect, n = Math.min(16, list.length);
    for ( let k = 0; k < n; k++ ) { const [a, b, c, d] = list[k]; this.tok.set([(a - ox) / ap - r.x0, (b - oy) / ap - r.y0, (c - ox) / ap - r.x0, (d - oy) / ap - r.y0], k * 4); }
    this.show.shader.uniforms.uTokN = n; this.front.shader.uniforms.uTokN = n; this.front.visible = n > 0;
  }
  clocksAt(now, out) { out[0] = now; out[1] = this.sw[0]; out[2] = this.sw[1]; out[3] = 0; out[4] = 0; return out; }

  tone(renderer) { if ( this.toneDone ) return; this.toneDone = true; renderPass(renderer, this.tonePass, this.toneRt); }
  renderArt(renderer, win = null) {
    const W = this.W, H = this.H;
    this.tone(renderer);
    if ( !(this.job?.pre && this.job.t !== this.T) ) this.job = null;
    this.fill(this.tNow ?? -1);
    const aw = this._win ??= [0, 0, 0, 0];
    if ( !win || (win[0] <= 0 && win[1] <= 0 && win[2] >= W && win[3] >= H) ) { this.scissorPass(renderer, this.rt, 0, 0, W, H); aw[0] = 0; aw[1] = 0; aw[2] = W; aw[3] = H; }
    else {
      const x0 = Math.max(0, win[0]), y0 = Math.max(0, win[1]), x1 = Math.min(W, win[2]), y1 = Math.min(H, win[3]);
      this.scissorPass(renderer, this.rt, x0, y0, x1, y1); aw[0] = x0; aw[1] = y0; aw[2] = x1; aw[3] = y1;
    }
    renderPass(renderer, this.occPass, this.occRt);
    this.artT = this.T; this.artWin = aw;
    const s = this.artU ??= new Float64Array(5); s[0] = this.fa; s[1] = this.fsw[0]; s[2] = this.fsw[1];
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
  /** The art pass set to age `a` with scene wind of `s` (frameOff puts back what was there). */
  frameOn(a, s) { const k = [this.fa ?? -1, ...(this.fsw ?? [0, 0])]; this.fill(a, [s[1], s[2]]); return k; }
  frameOff(k) { this.fill(k[0], [k[1], k[2]]); }
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
    const W = this.W, H = this.H;
    const j = this.job = { t, x0: Math.max(0, win[0]), y0: Math.max(0, win[1]), x1: Math.min(W, win[2]), y1: Math.min(H, win[3]), y: 0, s: new Float64Array(5) };
    j.y = j.y0; j.tNow = this.tNow ?? -1; j.s[1] = this.sw[0]; j.s[2] = this.sw[1];
    return j;
  }
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
    for ( const m of [this.occPass, this.ground, this.show, this.front, this.glow] ) m.shader.uniforms.uArt = this.rt;
    renderPass(renderer, this.occPass, this.occRt);
    const aw = this._win ??= [0, 0, 0, 0]; aw[0] = j.x0; aw[1] = j.y0; aw[2] = j.x1; aw[3] = j.y1;
    this.artT = j.t; this.artWin = aw;
    const s = this.artU ??= new Float64Array(5); s[0] = j.tNow; s[1] = j.s[1]; s[2] = j.s[2];
    this.job = null;
  }
  uploadStep() { this._up = true; return 0; }
  get uploaded() { return true; }
  covers(w) { const a = this.artWin; return !!a && w[0] >= a[0] && w[1] >= a[1] && w[2] <= a[2] && w[3] <= a[3]; }
  destroy() {
    const ownF = this.front.parent === this;
    if ( !ownF ) this.front.parent?.removeChild(this.front);
    this.glow.parent?.removeChild(this.glow);
    for ( const g of new Set([this.dpass, this.tonePass, this.occPass, this.ground].filter(Boolean).map((m) => m.geometry)) ) g?.destroy();
    this.dpass.destroy(); this.tonePass?.destroy(); this.occPass.destroy(); this.glow.destroy();
    if ( !ownF ) this.front.destroy();
    super.destroy({ children: true });
    this.soil?.destroy(true);
    this.back?.destroy(true); this.back = null; this.job = null;
    this.rt.destroy(true); this.occRt.destroy(true); this.toneRt?.destroy(true);
  }
}
export { BURST_LV };
