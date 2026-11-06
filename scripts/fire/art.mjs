/**
 * THE FIRE STYLE's look (the default "fire"; the fireball stays in shader.mjs): research recipe dev/fire-look-research.md, phase A.
 * Swap this file for another look; the mechanics (model.mjs fields, times, levels, colours, lights) stay.
 *
 * Per area, three draws on the destruction layer's art grid:
 *  1. ART PASS (12 fps, only when the shared-clock frame changes and the area is on screen): one fragment per ART CELL into a small
 *     RGBA8 render texture (W x H cells): R = flame (7; 0 none), G = flame band + 8 (level - 1) (1..23)
 *     or a bed ember (24..26), B = smoke band (1 light, 2 mid, 3 shadow, 4 fire-lit underside) + 8 rim + 16 smoke level, A = ground
 *     code: char level (0..3) + 4 heat tint + 8 smoke shadow (0..2).
 *       - FLAMES: emitters on a jittered lattice over the burning ground (rows foreshortened, RY 0.8), kept whole or dropped by a
 *         coverage ramp at the bed's edge x a clumping noise; each emitter has 2 breathing roots and blobs born every life / 5 / rate
 *         seconds (every birth number hashed: no loop) that swell, rise accelerating (pinch-off), lean with the wind and the
 *         travelling gust, shrink and die. ONE BODY: every emitter's roots (wide, fused into a continuous base along the bed) and
 *         blobs add into one field (a metaball union across all rows) - tongues fuse at their bases and mid-height and fork at the
 *         top; the colour is composited front (south) rows first with an opacity per row, so the bands flow across the body and a
 *         row behind shows only where the front is thin. Bands on the merged field: a hot core low (the fused roots), cooling
 *         upwards with each blob's age, broken by rising lick streaks (no slabs, no per-tongue nesting); an erosion noise drifts up
 *         inside. A few emitters are leaders (taller tongues).
 *       - BED: embers that boil in place (3 fps cross-faded), only on the burning ground, in 2x2 blue-noise clusters towards its edge.
 *       - SMOKE: puffs born at the smoke sources (aux B), 3-4 lobes, fast while hot and slowing as they cool, shear with the wind
 *         and the gust, the last lobe torn off; metaball union, each cell shaded from its OWN lobe's sphere normal (lit top-left,
 *         shadow bottom-right: billows inside the mass, not flat blocks), warm underside low over the fire; edges thin by the rim
 *         dropping out in 2x2 clusters as the puff ages, shapes shrink - never cut by a field or the area.
 *       - GROUND: char inside the bed (clustered ragged edge), a heat-tint ring outside it, the smoke's shadow on the ground.
 *  2. GROUND (every frame): a MULTIPLY quad - the map's own colours darkened / warmed (never an opaque ground colour).
 *  3. ART (every frame): flames, embers, smoke from the render texture: a rim on the merged body's OUTER silhouette only (selective: 2 steps
 *     darker on top and on the shadow side, 1 on the lit left side, red not plum on hot flanks, none at the bottom), palette lookup,
 *     flat per-band alpha; the module's exact box-footprint sampler at any zoom.
 *  4. EMISSION (every frame): the flame and ember cells drawn white into Foundry's illumination (canvas.effects.illumination.lights,
 *     MAX blend), so the scene's darkness never dims the flame body; the smoke is not emissive and dims with the scene.
 * Colour: the ramp (uRamp) is derived per area from the fire's base colour (look.mjs rampOf().ramp7). Everything is a function of
 * (cell, area seed, shared clock, field): every client draws the same frames.
 */
import { rampOf, NATURAL, VC16 } from "./look.mjs";
import { footprintK } from "./shader.mjs";

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

/* ======================================================================== pass 1: the art cells */
const ART = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform sampler2D uField;   // model.raster: R heat, G plume, B burning ground, A 1 + (fire level - 1) * 4 + smoke level
uniform sampler2D uAux;     // R distance inside the bed, G outside, B smoke source, A source smoke level (+4: a fire's)
uniform sampler2D uTimes;   // per cell: flame ignite / out, smoke ignite / out (model.raster), only while uAnim
uniform int uAnim;
uniform vec2 uI;            // seconds since the ignite ref, its span
uniform vec2 uO;            // seconds since the out ref, its span
uniform vec3 uDur;          // grow, out, the whole out span (s)
uniform vec4 uArea;         // area: growing (0..1), seconds since the last out (or -1), -, -
uniform vec2 uSize;
uniform float uTime;        // shared clock, 12 fps steps (s)
uniform int uSeed;
uniform float uU;           // art px scale: cells per grid square / 32
uniform int uLvMax;         // the area's highest fire level (the emitter lattice)
uniform float uLean;        // the wind's lean (cells per cell of height)
uniform vec2 uWind;         // the area's wind
uniform float uPlume;       // P.plume (squares)
uniform int uBirths;        // blobs per emitter (Performance: 8 / 6 / 4)
out vec4 oArt;

/* ---------------- the LOOK TABLES (research section 6; index = level 1..3) ---------------- */
const float RY = 0.8;
const float L_DENS[4] = float[4](0.0, 2.5, 6.0, 11.0);     // emitters per square
const float L_R[4]    = float[4](0.0, 3.6, 5.0, 6.4);      // blob radius (art px)
const float L_RISE[4] = float[4](0.0, 10.0, 22.0, 40.0);   // tongue height (art px)
const float L_LIFE[4] = float[4](0.0, 0.9, 0.85, 0.8);     // blob life (s)
const float L_EMB[4]  = float[4](0.0, 0.22, 0.35, 0.5);    // bed embers (share)
const float L_TINT[4] = float[4](0.0, 0.2, 0.3, 0.4);      // heat-tint ring (squares)
const float S_RATE[4] = float[4](0.0, 6.0, 6.0, 9.0);      // puffs a second per 3.6 squares of source
const float S_R0[4]   = float[4](0.0, 4.0, 6.0, 8.0);      // puff radius at birth (art px)
const float S_R1[4]   = float[4](0.0, 11.0, 17.0, 21.0);    // ... at its largest
const float S_LIFE[4] = float[4](0.0, 2.4, 3.6, 4.6);      // puff life (s)
const float S_V0[4]   = float[4](0.0, 16.0, 20.0, 24.0);   // rise speed at birth (art px / s, x plume / 2.5 x 1.5)
const float TAU = 1.3;                                     // the smoke cools: rise speed v0 e^(-age / tau)
const int VC[256] = int[256](${VC16.join(",")});

uint hu(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float hf(int a, int b, int c) {
  uint h = hu(uint(a) * 0x9E3779B1u ^ hu(uint(b) * 0x85EBCA77u ^ hu(uint(c) + uint(uSeed) * 0x27d4eb2fu)));
  return float(h >> 8) / 16777216.0;
}
float vn(vec2 p, int k) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  int x = int(i.x), y = int(i.y);
  return mix(mix(hf(x, y, k), hf(x + 1, y, k), f.x), mix(hf(x, y + 1, k), hf(x + 1, y + 1, k), f.x), f.y);
}
// a 2x2-cell blue-noise threshold (0..1)
float rank(vec2 c) { ivec2 q = ivec2(floor(c * 0.5)) & 15; return (float(VC[q.y * 16 + q.x]) + 0.5) / 256.0; }
// the fire BREATHES: three incommensurate slow waves and a stepped random walk (0.65..1.15, no visible period); s = the cluster
float breath(float t, int s) {
  float fs = float(s & 1023) * 0.731;
  float b = 0.9 + 0.12 * sin(t * 1.6982 + fs) + 0.08 * sin(t * 1.0650 + 2.0 * fs) + 0.05 * sin(t * 2.7318);
  float k = floor(t / 0.7), f = t / 0.7 - k; f = f * f * (3.0 - 2.0 * f);
  int ki = int(k);
  return b + 0.16 * ((1.0 - f) * (hf(s, ki, 91) - 0.5) + f * (hf(s, ki + 1, 91) - 0.5));
}
// a GUST travels across the area along the wind every ~4.5 s: lean per cell of height (0.06 .. 0.38)
float gust(float t, float x) {
  float f = fract(t * 0.22 - x / (1.4 * uSize.x) + float(uSeed & 255) * 0.0137);
  return 0.06 + 0.32 * clamp(sin(3.14159 * clamp((f - 0.55) / 0.3, 0.0, 1.0)), 0.0, 1.0);
}
int levelAt(ivec2 p) { int code = int(texelFetch(uField, p, 0).a * 255.0 + 0.5) - 1; return code < 0 ? 2 : clamp(code / 4 + 1, 1, 3); }
bool inArea(ivec2 p) { return p.x >= 0 && p.y >= 0 && p.x < int(uSize.x) && p.y < int(uSize.y); }
// a cell's ignite / out ages (s): flames (x, y), smoke (z, w); 1e4 = long lit, -1e4 = not out
vec4 ages(ivec2 p) {
  vec4 a = vec4(1e4, -1e4, 1e4, -1e4);
  if ( uAnim == 0 ) return a;
  vec4 T = texelFetch(uTimes, p, 0) * 255.0;
  if ( T.r > 0.5 ) a.x = uI.x - (T.r - 1.0) / 254.0 * uI.y;
  if ( T.g < 254.5 ) a.y = uO.x - T.g / 254.0 * uO.y;
  if ( T.b > 0.5 ) a.z = uI.x - (T.b - 1.0) / 254.0 * uI.y;
  if ( T.a < 254.5 ) a.w = uO.x - T.a / 254.0 * uO.y;
  return a;
}

void main() {
  vec2 c = vCell;                                   // the cell's centre (area cells)
  ivec2 ic = ivec2(floor(c));
  float u = uU, t = uTime, gdir = uWind.x < -0.05 ? -1.0 : 1.0;
  vec4 aux = texelFetch(uAux, ic, 0) * 255.0;
  vec4 fld = texelFetch(uField, ic, 0);
  float rk = rank(c);
  int lvMax = clamp(uLvMax, 1, 3);
  int R = 0, G = 0, B = 0, A = 0;

  /* ---------------- FLAMES: blob chains per emitter, merged into one body (colour seen front rows first) ---------------- */
  float sp = 32.0 * u / sqrt(L_DENS[lvMax]), spy = sp * RY;
  float Rm = L_R[lvMax] * u, reachUp = L_RISE[lvMax] * u * 2.6 + Rm * 2.2, reachDn = Rm * 2.2;
  float lo0 = uLean + min(gdir * 0.036, gdir * 0.38), hi0 = uLean + max(gdir * 0.036, gdir * 0.38);
  float W2 = 2.6 * Rm * 1.3 + 3.2 * u;
  // (a cell far from any burning ground below it is skipped: flames only rise)
  bool nearBed = aux.r > 0.5 || aux.g < (W2 + abs(hi0) * reachUp) / RY + 2.0;
  for ( int s = 1; s <= 3 && !nearBed; s++ ) {
    ivec2 p = ivec2(ic.x, ic.y + int(reachUp * float(s) / 3.0));
    if ( p.y < int(uSize.y) ) { float g = texelFetch(uAux, p, 0).g * 255.0; nearBed = texelFetch(uAux, p, 0).r > 0.0 || g < (W2 + abs(hi0) * reachUp) / RY + 2.0; }
  }
  // ONE BODY: every emitter's roots and blobs add into one field (a metaball union across all rows), so neighbouring tongues
  // fuse at their bases and often mid-height; the bands are computed on the merged field (they flow across tongue boundaries)
  float F = 0.0, HT = 0.0, BASE = 0.0, WS = 0.0, TR = 1.0; int lvL = 1;
  if ( nearBed ) {
    int jHi = int(floor((c.y + reachUp) / spy)), jLo = int(floor((c.y - reachDn) / spy)) - 1;
    for ( int jj = 0; jj < 32; jj++ ) {
      int j = jHi - jj; if ( j < jLo ) break;
      float dyc = max(0.0, (float(j) + 0.5) * spy - c.y);
      float xlo = c.x - max(0.0, dyc * hi0) - W2, xhi = c.x - min(0.0, dyc * lo0) + W2;
      int i0 = int(floor(xlo / sp)) - 1, i1 = int(floor(xhi / sp));
      float rF = 0.0, rH = 0.0, rB = 0.0;
      for ( int ii = 0; ii < 12; ii++ ) {
        int i = i0 + ii; if ( i > i1 ) break;
        vec2 e = vec2((float(i) + hf(i, j, 1)) * sp, (float(j) + hf(i, j, 2)) * spy);
        ivec2 ei = ivec2(floor(e));
        if ( !inArea(ei) ) continue;
        float d = texelFetch(uAux, ei, 0).r * 255.0;
        if ( d < 0.5 ) continue;                                       // not on the burning ground
        int lv = levelAt(ei);
        float ramp = clamp(d / (0.35 * 32.0 * u), 0.0, 1.0);            // the coverage ramp at the bed's edge (0.35 square)
        float clump = vn(e / (80.0 * u), 3);                            // tongues gather in irregular groups
        if ( hf(i, j, 3) > L_DENS[lv] / L_DENS[lvMax] * (0.25 + 0.75 * ramp) * (0.55 + 0.6 * clump) ) continue;
        float es = (0.55 + 0.45 * ramp) * (0.7 + 0.6 * hf(i, j, 4)), rate = 0.8 + 0.5 * hf(i, j, 5);
        // tongue heights vary: taller towards the heart of the fire, a few tall leaders, many short ones (never a picket fence)
        float hR = clamp(d / (0.9 * 32.0 * u), 0.0, 1.0), eh = (0.5 + 0.65 * hR) * (0.55 + 0.95 * pow(hf(i, j, 6), 1.6)) * (hf(i, j, 9) < 0.12 ? 1.25 : 1.0);
        int id = i * 131 + j * 7919;
        vec4 ag = ages(ei);
        float ageI = ag.x, ageO = ag.y;
        if ( ageO > -1e3 ) ageO -= (ramp * 0.6 + 0.2 * hf(i, j, 8)) * uDur.y;   // going out: the edge first, the heart up to 0.8 x P.out later (never retroactive: no pop)
        if ( ageI <= 0.0 ) continue;                                    // not caught yet
        float gE = clamp(ageI / max(uDur.x, 0.01), 0.0, 1.0); gE *= 2.0 - gE;
        int cl = int(floor(e.x / (96.0 * u))) * 7 + int(floor(e.y / (96.0 * u))) * 13 + uSeed;
        float br = breath(t, cl);
        float r0 = L_R[lv] * u;
        // the ROOTS: two wide, foreshortened blobs that never leave the bed (they sink when the fire goes out)
        float rootK = ageO > -1e3 ? 1.0 - clamp(ageO / max(0.5 * uDur.y, 0.01), 0.0, 1.0) : 1.0;
        float rb = r0 * es * (0.9 + 0.25 * br + 0.15 * sin(t * 2.1 + float(id))) * rootK * (0.45 + 0.55 * gE);
        for ( int k = 0; k < 2; k++ ) {
          float rr = rb * (0.75 - 0.15 * float(k)); if ( rr < 0.6 ) continue;
          vec2 p = vec2(e.x + (float(k) - 0.5) * rb * 0.9 + 0.8 * u * sin(t * (1.3 + float(k)) + float(id) * 0.7), e.y - rb * 0.1 - float(k) * 1.5 * u);
          float dx = (c.x - p.x) / (1.5 * rr), dy = (c.y - p.y) / (1.0 * rr); if ( dy > 0.0 ) dy *= 1.5;
          float q = 1.0 - (dx * dx + dy * dy) / 2.2;
          if ( q > 0.0 ) { q *= q; rF += q; rH += q * 0.95 * (0.5 + 0.5 * q); rB += q; lvL = max(lvL, lv); }
        }
        // the BLOBS: born every life / 5 / rate s (jittered), uneven lives, accelerating up, leaning, swaying, swelling then shrinking
        float life0 = L_LIFE[lv], iv = life0 / 5.0 / rate;
        int n0 = int(floor(t / iv));
        for ( int k = 0; k < 8; k++ ) {
          if ( k >= uBirths ) break;
          int n = n0 - k;
          float tb = (float(n) + 0.6 * hf(id, n, 11)) * iv;
          if ( tb < t - ageI ) continue;                                  // born before the emitter caught
          if ( ageO > -1e3 && tb > t - ageO ) continue;                   // born after it went out: the last ones finish their lives
          float life = life0 * (0.6 + 0.8 * hf(id, n, 12)) * (0.8 + 0.4 * br);
          float a = (t - tb) / life;
          if ( a < 0.0 || a >= 1.0 ) continue;
          float size = es * (0.7 + 0.6 * hf(id, n, 13)) * (0.75 + 0.35 * br) * (0.4 + 0.6 * gE);
          float z = L_RISE[lv] * u * size * eh * (0.6 + 0.8 * hf(id, n, 14)) * (0.3 + 0.7 * gE) * pow(a, 1.35);
          float r = r0 * size * (a < 0.15 ? 0.55 + 3.0 * a : pow(1.0 - (a - 0.15) / 0.85, 0.8));
          if ( r < 0.6 ) continue;
          float y = e.y - z, sy = r * (1.2 + 1.3 * a);
          if ( c.y < y - 1.5 * sy || c.y > y + sy ) continue;
          float lean = uLean + gdir * gust(t, e.x) * (0.6 + 0.4 * hf(id, n, 16));
          float x = e.x + (hf(id, n, 15) - 0.5) * 3.0 * u + z * lean + 1.6 * u * a * sin(6.2832 * (1.2 * a + hf(id, n, 17)));
          float dx = (c.x - x) / (r * (1.2 - 0.5 * a)), dy = (c.y - y) / sy; if ( dy > 0.0 ) dy *= 1.5;   // (wide low, thin tips)
          float q = 1.0 - (dx * dx + dy * dy) / 2.2;
          if ( q > 0.0 ) { q *= q; rF += q; rH += q * (1.0 - a) * (0.6 + 0.4 * q); lvL = max(lvL, lv); }   // (hot core, cool rim and top)
        }
      }
      // the union (silhouette) is the plain sum; the COLOUR is seen front first: a row further back shows through where the rows in
      // front are thin (between and above their tongues), so the bands flow across the body without per-tongue outlines
      F += rF; HT += TR * rH; BASE += TR * rB; WS += TR * rF; TR *= exp(-2.2 * rF);
      if ( TR < 0.25 ) break;                                         // (opaque: the rows further back change nothing)
    }
  }
  if ( F > 0.0 ) {
    // erosion: a fine noise that boils in place and drifts up INSIDE the body (edges flicker and tear, tips break off)
    float kk = t * 6.0, k0 = floor(kk), w = kk - k0;
    vec2 np = vec2(c.x / (2.2 * u), (c.y + t * 14.0 * u) / (3.0 * u));
    float nz = mix(vn(np, int(k0) & 1023), vn(np, (int(k0) + 1) & 1023), w);
    float Fe = F * (0.7 + 0.6 * nz);
    if ( Fe > 0.34 ) {
      // BANDS on the merged field: the hot core is a continuous band low in the body (the fused roots: BASE), cooling upwards (the
      // blobs' heat falls with age = height); rising lick streaks break the values so no band is a smooth slab
      float heat = HT / max(WS, 1e-4), base = clamp(BASE / max(WS, 1e-4), 0.0, 1.0);
      float dens = clamp((Fe - 0.34) / 2.4, 0.0, 1.0);
      float v = 0.76 * heat + 0.22 * base + 0.14 * pow(dens, 0.6);
      float st = vn(vec2(c.x / (3.0 * u), (c.y + t * 22.0 * u) / (8.0 * u)), 41 + (int(t * 4.0) & 7));
      v += (st - 0.5) * 0.2;
      int nb = lvL == 3 ? 7 : 6;
      int band = clamp(int(v * (float(nb) + 0.4)), 1, nb - 1);
      if ( band == 6 && st < 0.4 ) band = 5;                           // the cream core only in licks, never a slab
      if ( dens > 0.35 && band < 2 ) band = 2;                         // (deep inside the body: never the tips' darkest red)
      R = 7; G = band + 1 + 8 * (lvL - 1);                             // (one layer: the outline is the merged silhouette only)
    }
  }

  /* ---------------- BED: embers boiling in place; GROUND: char, heat tint ---------------- */
  vec4 ag = ages(ic);
  float dIn = aux.r, dOut = aux.g;
  if ( dIn > 0.5 ) {
    int lv = levelAt(ic);
    float growC = clamp(ag.x / max(0.3 * uDur.x, 0.01), 0.0, 1.0);    // the scorch spreads first, cluster by cluster
    float outA = ag.y;
    float endFade = outA > -1e3 ? clamp((outA - (uDur.z - 1.4)) / 1.2, 0.0, 1.0) : 0.0;   // the scar goes only at the very end
    float rampC = clamp(dIn / (0.28 * 32.0 * u), 0.0, 1.0);
    if ( rk < 0.15 + 0.85 * rampC && rk < growC * 1.4 && rk >= endFade ) A += lv;
    else if ( growC > 0.0 ) A += 4;                                       // (no char: the heat tint)
    if ( G == 0 ) {
      int cl = int(floor(c.x / (96.0 * u))) * 7 + int(floor(c.y / (96.0 * u))) * 13 + uSeed;
      float br = breath(t, cl);
      float share = L_EMB[lv] * br * growC;
      if ( outA > -1e3 ) {
        share = mix(share, L_EMB[1] * br, clamp(outA / max(uDur.y, 0.01), 0.0, 1.0));          // the bed glows on, dimmer...
        if ( rk < clamp((outA - uDur.y - 0.8) / 1.2, 0.0, 1.0) ) share = 0.0;                 // ...then goes dark, cluster by cluster
      }
      float kf = t * 3.0, k0 = floor(kf), w = kf - k0; w = w * w * (3.0 - 2.0 * w);
      vec2 ep = c / vec2(4.5 * u, 3.6 * u);
      float ev = mix(vn(ep, 200 + (int(k0) & 511)), vn(ep, 200 + ((int(k0) + 1) & 511)), w) * 0.7 + vn(c / vec2(2.0 * u, 1.6 * u), 7) * 0.3;
      if ( dIn > 1.0 && share > 0.0 && ev > 1.0 - share * 0.9 && rk < rampC * 1.2 + 0.1 ) G = ev > 1.0 - share * 0.4 ? 26 : ev > 1.0 - share * 0.7 ? 25 : 24;
    }
  } else if ( dOut > 0.5 ) {
    float wT = L_TINT[lvMax] * 32.0 * u;
    float tk = uArea.x * (uArea.y >= 0.0 ? 1.0 - clamp((uArea.y - 0.7 * uDur.z) / (0.3 * uDur.z), 0.0, 1.0) : 1.0);
    if ( dOut < wT && rk < (0.9 - dOut / wT) * tk ) A += 4;
  }

  /* ---------------- SMOKE: lit puffs from the sources ---------------- */
  // (only near the plume: the model's plume field says where smoke can be, never what its silhouette is)
  float R1m = S_R1[3] * u * 1.25;
  bool smk = fld.g > 0.0;
  for ( int s = 0; s < 8 && !smk; s++ ) {
    vec2 o = vec2(cos(float(s) * 0.7854), sin(float(s) * 0.7854)) * R1m * 1.6;
    ivec2 p = ivec2(floor(c + o));
    if ( inArea(p) ) smk = texelFetch(uField, p, 0).g > 0.0;
  }
  if ( smk ) {
    float sps = 22.0 * u, spys = sps * RY, Hk = uPlume / 2.5;
    float zTop = 0.7 * L_RISE[3] * u + S_V0[3] * u * Hk * 1.5 * 1.35 * TAU + R1m;
    float rA = 0.6 * uWind.x + 0.12 * gdir, rB = 0.6 * uWind.x + 0.216 * gdir, rMin = min(rA, rB), rMax = max(rA, rB);
    float pad = R1m * 2.2 + sps * 0.5 + 2.5 * u;
    int jHi = int(floor((c.y + zTop * (1.0 + max(0.0, -0.5 * uWind.y)) + R1m) / spys)) + 1, jLo = int(floor((c.y - R1m - max(0.0, 0.5 * uWind.y) * zTop) / spys)) - 1;
    float F = 0.0, AG = 0.0, QB = -1e9; vec2 nB = vec2(0.0), GR = vec2(0.0); int lsB = 2; bool lowB = false, own = false;
    for ( int jj = 0; jj < 40; jj++ ) {
      int j = jHi - jj; if ( j < jLo ) break;
      float dyc = max(0.0, float(j) * spys - c.y);
      float xlo = c.x - max(0.0, rMax * dyc) - pad, xhi = c.x - min(0.0, rMin * dyc) + pad;   // (the puffs shear along the wind)
      int i0 = int(floor(xlo / sps - 0.5)), i1 = int(floor(xhi / sps - 0.5)) + 1;
      for ( int ii = 0; ii < 16; ii++ ) {
        int i = i0 + ii; if ( i > i1 ) break;
        vec2 e = vec2((float(i) + 0.5) * sps, (float(j) + 0.5) * spys);
        ivec2 ei = ivec2(floor(e));
        if ( !inArea(ei) ) continue;
        vec4 sa = texelFetch(uAux, ei, 0) * 255.0;
        if ( sa.b < 5.0 ) continue;
        int code = int(sa.a + 0.5), ls = clamp(code & 3, 1, 3);
        bool fromFire = code >= 4;
        float src = sa.b / 255.0;
        float rate = S_RATE[ls] / 3.6 * (sps * spys) / (1024.0 * u * u), iv = 1.0 / max(rate, 0.05);
        float z0 = fromFire ? 0.7 * L_RISE[levelAt(ei)] * u : 2.0 * u;
        float lifeS = S_LIFE[ls];
        float v0 = S_V0[ls] * u * Hk * 1.5;
        vec4 ag2 = ages(ei);
        // which births can be at this height now: invert z(age) (the rise only depends on the age)
        float rr1 = S_R1[ls] * u * 1.25, dz = e.y - c.y;
        float zl = max(z0, dz - rr1 - spys), zh = dz + rr1 + spys;
        float zMax = z0 + v0 * 1.35 * TAU * 0.999;
        if ( zl > zMax ) continue;
        // (the fastest puffs, x 1.35, reach a height soonest; the slowest, x 0.65, latest)
        float aLo = -TAU * log(max(1e-4, 1.0 - (zl - z0) / (1.35 * v0 * TAU)));
        float aHi = zh >= z0 + 0.65 * v0 * TAU * 0.999 ? lifeS * 1.3 : -TAU * log(max(1e-4, 1.0 - (zh - z0) / (0.65 * v0 * TAU)));
        aHi = min(aHi, lifeS * 1.3);
        int nLo = int(floor((t - aHi) / iv)) - 1, nHi = int(floor((t - aLo) / iv));
        int eid = i * 977 + j * 3163;
        for ( int kk2 = 0; kk2 < 8; kk2++ ) {
          int n = nHi - kk2; if ( n < nLo ) break;
          if ( hf(eid, n, 59) > src ) continue;                          // a weak source: fewer puffs (whole shapes, never holes)
          float tb = (float(n) + 0.7 * hf(eid, n, 60)) * iv, age = t - tb;
          if ( age < 0.0 ) continue;
          if ( tb < t - ag2.z ) continue;                                 // before the smoke started
          if ( ag2.w > -1e3 && tb > t - ag2.w ) continue;                // after it stopped: the last puffs drift off
          float life = lifeS * (0.7 + 0.6 * hf(eid, n, 61)), a = age / life;
          if ( a >= 1.0 ) continue;
          float build = clamp((ag2.z - age) / 2.0, 0.0, 1.0);            // the first puffs are wisps, building up over ~2 s
          float vj = v0 * (0.65 + 0.7 * hf(eid, n, 66));                // every puff its own speed: no flat ceiling
          float z = z0 + vj * TAU * (1.0 - exp(-age / TAU));
          vec2 o0 = e + (vec2(hf(eid, n, 62), hf(eid, n, 63)) - 0.5) * vec2(sps, spys);
          float g = gust(t, o0.x);
          float x = o0.x + z * (0.6 * uWind.x + 0.12 * gdir * (1.0 + 0.8 * g)) + 2.5 * u * sin(6.2832 * (0.35 * age + hf(eid, n, 64)));
          float y = o0.y - z + 0.5 * uWind.y * z;
          float r = (S_R0[ls] + (S_R1[ls] - S_R0[ls]) * min(1.0, a / 0.55)) * u * (0.45 + 0.55 * build) * (0.8 + 0.4 * hf(eid, n, 65));
          if ( abs(c.x - x) > r * 2.2 + 2.0 || abs(c.y - y) > r * 2.0 + 2.0 ) continue;
          int nl = ls == 3 ? 4 : 3;
          bool low = fromFire && z < 1.6 * L_RISE[2] * u && a < 0.5;
          for ( int k = 0; k < 4; k++ ) {
            if ( k >= nl ) break;
            float ang = hf(eid, n, 70 + k) * 6.2832 + a * (1.5 + hf(eid, n, 75));
            float tear = k == nl - 1 ? 1.0 + 1.8 * max(0.0, a - 0.5) * (0.5 + g) : 1.0;
            vec2 l = vec2(x + cos(ang) * r * 0.6 * tear, y + sin(ang) * r * 0.42 * tear - (k == 3 ? r * 0.45 : 0.0));
            float lr = r * (0.82 - 0.12 * float(k)) * (1.0 - 0.5 * max(0.0, a - 0.6) / 0.4);
            if ( lr < 0.8 * u ) continue;
            vec2 dd = (c - floor(l) - 0.5) / lr;
            float q = 1.0 - dot(dd, dd) / 1.6;
            // the cell's billow is the NEAREST lobe whose sphere covers it (oblique depth: further south and higher = nearer)
            float d2 = dot(dd, dd), dep = o0.y + 0.5 * z + float(k) * 0.7;
            if ( d2 < 1.0 && dep > QB ) { QB = dep; nB = dd; lsB = ls; lowB = low; own = true; }
            if ( q > 0.0 ) { GR += sqrt(q) * dd / lr; q *= q; F += q; AG += q * a; if ( !own ) { lsB = ls; lowB = low; } }
          }
        }
      }
    }
    if ( F > 0.22 ) {
      float age = AG / F;
      bool rim = F < 0.42;
      float fade = clamp((age - 0.55) / 0.45, 0.0, 1.0);
      if ( !(rim && rk < fade * 1.1) ) {
        // the cell's OWN lobe is a sphere lit from the top-left: billows with a lit crescent and a shadow side inside the mass
        // (mixed with the whole mass's outward normal - its density gradient - so the billows also shade as one rolling cloud)
        vec2 nU = GR / (length(GR) + 0.35 / (R1m * 0.5));
        vec2 nM = own ? nB * 0.85 + nU * 0.2 : nU; if ( length(nM) > 0.98 ) nM *= 0.98 / length(nM);
        vec3 n3 = vec3(nM, sqrt(max(0.0, 1.0 - dot(nM, nM))));
        float lit = dot(n3, normalize(vec3(-0.6, -0.72, 0.3)));   // (a low light: flat interiors are mid, the top-left faces lit)
        int band = lit > 0.42 ? 1 : lit > -0.1 ? 2 : 3;
        if ( F > 1.2 && band == 3 ) band = 2;                            // dense cores are never in the darkest band
        if ( lowB && band == 3 ) band = 4;                               // lit from below by the fire
        B = band + (rim ? 8 : 0) + 16 * lsB;
      }
    }
  }
  // the smoke's SHADOW on the ground (levels 2-3): each puff's footprint straight below it, a little right (light top-left)
  if ( smk && (A & 24) == 0 ) {
    float sps = 22.0 * u, spys = sps * RY, Hk = uPlume / 2.5;
    int j0 = int(floor(c.y / spys));
    for ( int j = j0 - 1; j <= j0 + 1; j++ ) {
      for ( int ii = -2; ii <= 1; ii++ ) {
        int i = int(floor(c.x / sps)) + ii;
        vec2 e = vec2((float(i) + 0.5) * sps, (float(j) + 0.5) * spys);
        ivec2 ei = ivec2(floor(e));
        if ( !inArea(ei) ) continue;
        vec4 sa = texelFetch(uAux, ei, 0) * 255.0;
        int ls = clamp(int(sa.a + 0.5) & 3, 1, 3);
        if ( sa.b < 5.0 || ls < 2 ) continue;
        float src = sa.b / 255.0, rate = S_RATE[ls] / 3.6 * (sps * spys) / (1024.0 * u * u), iv = 1.0 / max(rate, 0.05);
        int eid = i * 977 + j * 3163, nH = int(floor(t / iv));
        vec4 ag2 = ages(ei);
        bool fromFire = int(sa.a + 0.5) >= 4;
        float z0 = fromFire ? 0.7 * L_RISE[levelAt(ei)] * u : 2.0 * u;
        float v0 = S_V0[ls] * u * Hk * 1.5;
        for ( int k = 0; k < 6; k++ ) {
          int n = nH - k;
          if ( hf(eid, n, 59) > src ) continue;
          float tb = (float(n) + 0.7 * hf(eid, n, 60)) * iv, age = t - tb;
          if ( age < 0.0 || tb < t - ag2.z || (ag2.w > -1e3 && tb > t - ag2.w) ) continue;
          float life = S_LIFE[ls] * (0.7 + 0.6 * hf(eid, n, 61)), a = age / life;
          if ( a >= 1.0 ) continue;
          float z = z0 + v0 * (0.65 + 0.7 * hf(eid, n, 66)) * TAU * (1.0 - exp(-age / TAU));
          vec2 o0 = e + (vec2(hf(eid, n, 62), hf(eid, n, 63)) - 0.5) * vec2(sps, spys);
          float x = o0.x + z * (0.6 * uWind.x + 0.12 * gdir) + z * 0.25;
          float r = (S_R0[ls] + (S_R1[ls] - S_R0[ls]) * min(1.0, a / 0.55)) * u * 0.9;
          vec2 dd = vec2((c.x - x) / r, (c.y - o0.y - 2.0 * u) / (r * RY));
          if ( dot(dd, dd) < 0.8 && rk < (a < 0.6 ? 0.55 : 0.25) ) { A = (A & 7) + 8 * (ls == 3 ? 2 : 1); }
        }
      }
    }
  }
  oArt = vec4(float(R), float(G), float(B), float(A)) / 255.0;
}`;

/* ======================================================================== pass 2: the art on screen; pass 3: the ground */
const SHOW_COMMON = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform sampler2D uArt;
uniform vec2 uSize;
uniform float uK;
uniform float uAlpha;
uniform float uDark;      // the scene's darkness (0..1): the smoke is not emissive
uniform vec4 uRamp[12];   // look.mjs ramp7: 7 flame steps, 3 bed, 2 fire-lit undersides
uniform vec4 uSmokeTint;
out vec4 fragColor;
ivec4 art(ivec2 p) {
  if ( p.x < 0 || p.y < 0 || p.x >= int(uSize.x) || p.y >= int(uSize.y) ) return ivec4(0);
  return ivec4(texelFetch(uArt, p, 0) * 255.0 + 0.5);
}
void axisW(float t, float w, out float i0, out vec3 a) {
  float lo = t - 0.5 * w, hi = t + 0.5 * w;
  i0 = floor(lo);
  a.x = min(i0 + 1.0, hi) - lo;
  a.y = clamp(min(i0 + 2.0, hi) - (i0 + 1.0), 0.0, 1.0);
  a.z = max(0.0, hi - (i0 + 2.0));
  a /= w;
}
`;
const FOOTPRINT = `
void main() {
  vec2 w = fwidth(vCell) * uK;
  if ( uK <= 0.0 || max(w.x, w.y) < 0.01 ) { fragColor = OUT(cellColor(floor(vCell))); return; }
  w = clamp(w, vec2(0.01), vec2(2.0));
  float ix, iy; vec3 ax, ay;
  axisW(vCell.x, w.x, ix, ax); axisW(vCell.y, w.y, iy, ay);
  vec4 c = vec4(0.0);
  for ( int j = 0; j < 3; j++ ) {
    float wy = ay[j]; if ( wy <= 0.0 ) continue;
    for ( int i = 0; i < 3; i++ ) {
      float wx = ax[i]; if ( wx <= 0.0 ) continue;
      c += wx * wy * cellColor(vec2(ix + float(i), iy + float(j)));
    }
  }
  fragColor = OUT(c);
}`;

const SHOW = `${SHOW_COMMON}
const float OUTER[4] = float[4](0.0, 0.55, 0.85, 1.0);                 // outer bands' alpha per fire level (flat)
const vec3 SMK[9] = vec3[9](vec3(0.741, 0.718, 0.678), vec3(0.557, 0.537, 0.506), vec3(0.384, 0.369, 0.408),
                            vec3(0.788, 0.765, 0.722), vec3(0.545, 0.525, 0.494), vec3(0.310, 0.294, 0.341),
                            vec3(0.561, 0.537, 0.498), vec3(0.349, 0.333, 0.369), vec3(0.173, 0.165, 0.196));   // wisps / plume / column: light, mid, shadow
const vec3 S_A[4] = vec3[4](vec3(0.0), vec3(0.50, 0.60, 0.68), vec3(0.62, 0.74, 0.86), vec3(0.82, 0.90, 0.96));    // their alphas (flat)
const float S_RIM[4] = float[4](0.0, 0.24, 0.32, 0.45);
vec3 tintSmoke(vec3 c) {
  if ( uSmokeTint.a <= 0.0 ) return c;
  float L = dot(c, vec3(0.3, 0.59, 0.11)), tl = max(0.05, dot(uSmokeTint.rgb, vec3(0.3, 0.59, 0.11)));
  return mix(c, min(vec3(1.0), L * uSmokeTint.rgb / tl), uSmokeTint.a);
}
vec4 cellColor(vec2 cf) {
  ivec2 p = ivec2(cf);
  ivec4 a = art(p);
  vec4 col = vec4(0.0);
  if ( a.r > 0 && a.g > 0 && a.g < 24 ) {
    int band = (a.g - 1) & 7, lv = clamp((a.g - 1) / 8 + 1, 1, 3);
    // the RIM on the merged body's outer silhouette only (the flames are one layer), selective: nothing above / on the shadow side
    // -> 2 steps darker, the lit left side -> 1 step; hot flanks get red, never plum; none at the bottom
    int up = art(p + ivec2(0, -1)).r, lf = art(p + ivec2(-1, 0)).r, rt = art(p + ivec2(1, 0)).r;
    bool outer = up == 0 || rt == 0 || lf == 0;
    if ( up < a.r || rt < a.r ) band = max(band - (outer ? 2 : 1), band >= 4 ? 1 : 0);
    else if ( lf < a.r ) band = max(band - 1, 1);
    float al = band <= 1 ? OUTER[lv] : 1.0;
    col = vec4(uRamp[band].rgb * al, al);
  } else if ( a.g >= 24 ) col = vec4(uRamp[7 + min(2, a.g - 24)].rgb, 1.0);
  if ( a.b > 0 ) {
    int band = a.b & 7, rim = (a.b >> 3) & 1, ls = clamp(a.b >> 4, 1, 3);
    vec3 rgb = band == 4 ? uRamp[11].rgb * (1.0 - 0.3 * uDark) : tintSmoke(SMK[(ls - 1) * 3 + band - 1]) * (1.0 - 0.62 * uDark);
    float al = rim == 1 ? S_RIM[ls] : S_A[ls][min(band, 3) - 1];
    if ( a.r > 0 ) al *= 0.3;                                      // over the flames: thin, the fire stays readable
    col = vec4(rgb * al, al) + col * (1.0 - al);
  }
  return col;
}
#define OUT(c) ((c) * uAlpha)
${FOOTPRINT}`;

const GROUND = `${SHOW_COMMON}
const float CHAR[4] = float[4](0.0, 0.35, 0.55, 0.75);
// the ground as a MULTIPLY of the map's own colour: char, heat tint, smoke shadow (rgb = factor; 1 = untouched)
vec4 cellColor(vec2 cf) {
  int g = art(ivec2(cf)).a;
  vec3 m = vec3(1.0);
  int ch = g & 3;
  if ( ch > 0 ) m *= 1.0 - CHAR[ch] * (1.0 - vec3(0.30, 0.24, 0.22));
  if ( (g & 4) != 0 ) m *= 1.0 - 0.6 * (1.0 - mix(vec3(1.0, 0.86, 0.70), vec3(1.0, 0.9, 0.8), uDark));
  int sh = (g >> 3) & 3;
  if ( sh == 1 ) m *= 0.9; else if ( sh == 2 ) m *= 0.8;
  return vec4(m, 1.0);
}
#define OUT(c) vec4(mix(vec3(1.0), (c).rgb, uAlpha), 1.0)
${FOOTPRINT}`;

// the flames' EMISSION: drawn into Foundry's illumination (MAX), so darkness never dims the flame body (research 2g); smoke is not
// emissive (it stays in the dimmed scene); white where a flame or ember cell is, scaled by its flat alpha
const EMIT = `${SHOW_COMMON}
const float OUTER[4] = float[4](0.0, 0.55, 0.85, 1.0);
vec4 cellColor(vec2 cf) {
  ivec4 a = art(ivec2(cf));
  if ( a.r > 0 && a.g > 0 && a.g < 24 ) { int band = (a.g - 1) & 7, lv = clamp((a.g - 1) / 8 + 1, 1, 3); float al = band <= 1 ? OUTER[lv] : 1.0; return vec4(al); }
  if ( a.g >= 24 ) return vec4(1.0);
  return vec4(0.0);
}
#define OUT(c) ((c) * uAlpha)
${FOOTPRINT}`;

let progs = null;
const programs = () => progs ??= {
  art: PIXI.Program.from(VERT, ART, "moinen-maps-fire-art-v1"),
  show: PIXI.Program.from(VERT, SHOW, "moinen-maps-fire-show-v1"),
  ground: PIXI.Program.from(VERT, GROUND, "moinen-maps-fire-ground-v1"),
  emit: PIXI.Program.from(VERT, EMIT, "moinen-maps-fire-emit-v1")
};
const texOf = (data, W, H) => PIXI.Texture.fromBuffer(data, W, H, { scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA });
const quad = (x0, y0, x1, y1, W, H) => new PIXI.Geometry()
  .addAttribute("aVertexPosition", [x0, y0, x1, y0, x1, y1, x0, y1], 2)
  .addAttribute("aCell", [0, 0, W, 0, W, H, 0, H], 2)
  .addIndex([0, 1, 2, 0, 2, 3]);

/** Blobs per emitter by Performance mode (research 13: 7 -> 5 -> 3, here 8 / 6 / 4). */
export const BIRTHS = { high: 8, medium: 6, low: 4 };

/**
 * One fire-style area: a container of the ground quad (multiply) and the art quad, plus the art pass (a mesh rendered into a W x H
 * render texture, not on the stage). `setTime(t)`, `setPhase(now)`, `setDark(d)`, then `renderArt(renderer)` at most once per 12 fps
 * frame. Same contract as shader.mjs FireMesh for the display (anim, visible, destroy).
 */
export class FireArt extends PIXI.Container {
  constructor(field, rect, geo, { seed = 1, grid = 32, lean = 0, wind = [0, 0], dur = [1.6, 2.2, 10], plume = 2.5, lvMax = 2, smokeTint = 0, births = 8 } = {}) {
    super();
    this.eventMode = "none"; this.interactiveChildren = false;
    const { ap, ox, oy } = geo, W = field.w, H = field.h, P = programs();
    const x0 = ox + rect.x0 * ap, y0 = oy + rect.y0 * ap, x1 = x0 + W * ap, y1 = y0 + H * ap;
    this.fieldTex = texOf(field.data, W, H);
    this.auxTex = texOf(field.aux ?? new Uint8Array(W * H * 4), W, H);
    this.timesTex = field.times ? texOf(field.times, W, H) : null;
    this.rt = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST });
    this.rt.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    this.anim = field.anim; this.W = W; this.H = H;
    this.artT = null;
    const ramp = rampOf(field.color ?? NATURAL);
    this.pass = new PIXI.Mesh(quad(0, 0, W, H, W, H), new PIXI.Shader(P.art, {
      uField: this.fieldTex, uAux: this.auxTex, uTimes: this.timesTex ?? this.fieldTex, uAnim: this.timesTex ? 1 : 0,
      uI: new Float32Array([0, 1]), uO: new Float32Array([0, 1]), uDur: new Float32Array(dur), uArea: new Float32Array([1, -1, 0, 0]),
      uSize: new Float32Array([W, H]), uTime: 0, uSeed: seed % 65536, uU: grid / 32, uLvMax: lvMax, uLean: lean,
      uWind: new Float32Array(wind), uPlume: plume, uBirths: births, translationMatrix: new PIXI.Matrix().toArray(true) }));
    const common = () => ({ uArt: this.rt, uSize: new Float32Array([W, H]), uK: footprintK(), uAlpha: 1, uDark: 0,
      uRamp: new Float32Array(ramp.ramp7), uSmokeTint: new Float32Array([...ramp.tint, smokeTint]), translationMatrix: new PIXI.Matrix().toArray(true) });
    this.ground = new PIXI.Mesh(quad(x0, y0, x1, y1, W, H), new PIXI.Shader(P.ground, common()));
    this.ground.state.blendMode = PIXI.BLEND_MODES.MULTIPLY;
    this.show = new PIXI.Mesh(quad(x0, y0, x1, y1, W, H), new PIXI.Shader(P.show, common()));
    this.show.state.blendMode = PIXI.BLEND_MODES.NORMAL;   // premultiplied output
    for ( const m of [this.ground, this.show] ) {
      m.eventMode = "none";
      const r0 = m._render.bind(m);
      m._render = (renderer) => { const u = m.shader.uniforms; u.uAlpha = this.worldAlpha; u.uK = footprintK(); r0(renderer); };
    }
    this.addChild(this.ground, this.show);
    // the emission lives in the illumination layer (not in this container): it follows this area's visibility and alpha
    this.glow = new PIXI.Mesh(quad(x0, y0, x1, y1, W, H), new PIXI.Shader(P.emit, common()));
    this.glow.state.blendMode = PIXI.BLEND_MODES.MAX_COLOR; this.glow.eventMode = "none";
    const e0 = this.glow._render.bind(this.glow);
    this.glow._render = (renderer) => {
      if ( !this.worldVisible || !this.parent ) return;
      const u = this.glow.shader.uniforms; u.uAlpha = this.worldAlpha; u.uK = footprintK(); e0(renderer);
    };
    canvas.effects?.illumination?.lights?.addChild(this.glow);
  }
  get isArt() { return true; }
  setTime(t) { this.pass.shader.uniforms.uTime = t; }
  setDark(d) { this.show.shader.uniforms.uDark = d; this.ground.shader.uniforms.uDark = d; }
  setBirths(n) { this.pass.shader.uniforms.uBirths = n; }
  /** The area's grow / out clocks at shared time `now` (ms). */
  setPhase(now) {
    const a = this.anim; if ( !a ) return;
    const u = this.pass.shader.uniforms;
    u.uI[0] = (now - a.iRef) / 1000; u.uI[1] = a.iSpan / 1000; u.uO[0] = (now - a.oRef) / 1000; u.uO[1] = a.oSpan / 1000;
    u.uArea[0] = a.hasIgnite ? Math.max(0, Math.min(1, (now - a.iRef) / 1000 / Math.max(0.01, u.uDur[0]))) : 1;
    u.uArea[1] = a.hasOut ? (now - (a.oRef + a.oSpan)) / 1000 : -1;
  }
  /** Draw the art cells for the current time (the 12 fps pass). */
  renderArt(renderer) {
    renderer.render(this.pass, { renderTexture: this.rt, clear: true });
    this.artT = this.pass.shader.uniforms.uTime;
  }
  destroy() {
    const tx = [this.fieldTex, this.auxTex, this.timesTex];
    this.fieldTex = this.auxTex = this.timesTex = null;
    this.glow.parent?.removeChild(this.glow);
    for ( const m of [this.pass, this.ground, this.show, this.glow] ) m.geometry?.destroy();
    this.pass.destroy(); this.glow.destroy();
    super.destroy({ children: true });
    for ( const t of tx ) t?.destroy(true);
    this.rt.destroy(true);
  }
}
