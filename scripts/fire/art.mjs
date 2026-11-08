/**
 * THE FIRE STYLE's look (the default "fire"; the fireball stays in shader.mjs): research recipe dev/fire-look-research.md, phase A.
 * Swap this file for another look; the mechanics (model.mjs fields, times, levels, colours, lights) stay.
 *
 * Per area, three draws on the destruction layer's art grid (plus a tiny FUEL pass):
 *  0. FUEL PASS (4 fps on a quantised clock): a low-frequency fuel / intensity map seeded per area (1 texel per 8 cells, linear),
 *     two morphing value-noise octaves that drift and slowly re-shape (cross-faded keyframes, 7-10 s), so hot and weak patches
 *     wander and the map itself evolves; G = a second, finer field for the beds' variety. It decides the CLUSTERS: big merged
 *     masses where it is hot, single tongues and gaps with only embers where it is weak, and each base's width, offset,
 *     brightness and coal spill - no regular rhythm and no relation to the brush stamp spacing.
 *  1. ART PASS (12 fps, only when the shared-clock frame changes and the area is on screen): one fragment per ART CELL into a small
 *     RGBA8 render texture (W x H cells): R = flame (7; 0 none), G = flame band + 8 (level - 1) (1..23)
 *     or a bed ember (24..26) or a spark / hot coal (32 + ramp step 1..6), B = smoke band (1 light, 2 mid, 3 shadow, 4 fire-lit underside) + 8 rim + 16 smoke level, A = ground
 *     code: char level (0..3) + 4 heat tint + 8 smoke shadow (0..2).
 *       - FLAMES: emitters on a jittered lattice over the burning ground (rows foreshortened, RY 0.8), kept whole or dropped by a
 *         coverage ramp at the bed's edge x the FUEL (which also scales their size and height); each emitter has 2 breathing roots and blobs born every life / 5 / rate
 *         seconds (every birth number hashed: no loop) that swell, rise accelerating (pinch-off), lean with the wind and the
 *         travelling gust, shrink and die. ONE BODY: every emitter's roots (wide, fused into a continuous base along the bed) and
 *         blobs add into one field (a metaball union across all rows) - tongues fuse at their bases and mid-height and fork at the
 *         top; the colour is composited front (south) rows first with an opacity per row, so the bands flow across the body and a
 *         row behind shows only where the front is thin. Bands on the merged field: a hot core low (the fused roots), cooling
 *         upwards with each blob's age, broken by rising lick streaks (no slabs, no per-tongue nesting); an erosion noise drifts up
 *         inside. A few emitters are leaders (taller tongues).
 *         Bands: heat + a fused-core term (from the body's own field: the erosion frays only the silhouette) + base, broken by broad
 *         slow licks, so the inside reads as a few large clean planes with clear value breaks; blobs are narrow and tall.
 *       - BED: embers that boil in place (3 fps cross-faded), only on the burning ground, in 2x2 blue-noise clusters towards its edge.
 *       - COALS: loose 1-2 px coals between the tongues and a little past the bed's edge (fading into the map), share by level;
 *         they pulse slowly, some flicker out for a while, the hottest flash white-yellow; they outlast the flames on go-out.
 *       - SPARKS: 4 rising-frame layers (each spark owns one cell of a grid that moves up with it: O(1) per cell, no state): born
 *         over burning ground (denser over its heart, by level, in gusts, x Performance births), ride up with the wind and a little
 *         swirl, flare and cool through the ramp (white / yellow, orange, red, dark), 1 px with a few 2 px. Time 0 (reduced
 *         motion): none. Near the area's top each spark burns out at its own height (never cut off by the edge). The pooled sprite particles (display.mjs, capped per Performance mode) stay for the few bigger sparks.
 *       - SMOKE: puffs born at the smoke sources (aux B), 3-4 lobes, fast while hot and slowing as they cool, shear with the wind
 *         and the gust, the last lobe torn off; metaball union, each cell shaded from its OWN lobe's sphere normal (lit top-left,
 *         shadow bottom-right: billows inside the mass, not flat blocks), warm underside low over the fire; edges thin by the rim
 *         dropping out in 2x2 clusters as the puff ages, shapes shrink - never cut by a field or the area. Old smoke dissolves (wider dropping rim, faster shrinking lobes, never the
 *         darkest band; the torn-off last lobe stays close and small), so the column's top never grows dark round balloons.
 *         SMOKE AND FLAMES MIX: 40 % of a fire's puffs are born low, between the tongues; 45 % curl IN FRONT of the flames (a thin
 *         warm veil lit from below), the rest pass behind them (hidden by the tongues); 40 % of the front ones are DENSE DRIFTS that
 *         really cover part of the flames for a moment (lit from below, the flame's colour glowing through). Sparks glow through.
 *         NEVER CUT: the area's rectangle holds every puff's whole reach (model.puffReach: highest rise, drift, shear, gust, size)
 *         and the smoke is only looked for where a puff can be (the PUFF mask, model.puffMask: each source's drift cone grown by the
 *         puff's extent, with the source rows to search); a puff whose extent would still near the rectangle (a clamped or mixed-wind
 *         area) thins out as a whole first. The source's end is frayed (each puff its own last moment, the last ones smaller).
 *       - GROUND: char inside the bed (clustered ragged edge), a heat-tint ring outside it, the smoke's shadow on the ground.
 *  2. GROUND (every frame): a MULTIPLY quad - the map's own colours darkened / warmed (never an opaque ground colour).
 *  3. ART (every frame): flames, embers and sparks (the FIRE layer, under the tokens), and the SMOKE layer (a second quad in the
 *     display's `above` container, sortLayer 800: over the tokens, so smoke drifting over a token veils it), from the render texture: a rim on the merged body's OUTER silhouette only (selective: 2 steps
 *     darker on top and on the shadow side, 1 on the lit left side, red not plum on hot flanks, none at the bottom), palette lookup,
 *     flat per-band alpha; the module's exact box-footprint sampler at any zoom.
 *  4. EMISSION (every frame): the flame and ember cells drawn white into Foundry's illumination (canvas.effects.illumination.lights,
 *     MAX blend), so the scene's darkness never dims the flame body; the smoke is not emissive and dims with the scene.
 * Cost: every per-cell random comes from one 32-bit hash split into 4 bytes (hb), and emitters out of reach of the cell are culled
 * before any blob work.
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

/* ======================================================================== pass 0: the FUEL map (12 fps, tiny) */
// One texel per FUEL_K x FUEL_K art cells, read bilinear by the art pass: how hard the fire burns where (0..1). Low-frequency noise
// seeded per area, in two octaves, that WANDERS (its sampling point drifts on slow, incommensurate curves, a little downwind) and
// EVOLVES (each octave cross-fades to a new pattern every 5-7 s, contrast kept): hot patches swell, die back, creep and wander; no
// stretch of a stroke burns like the next. G: a second, faster map for the beds (width, brightness).
const FUEL_K = 8;
const FUEL = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform float uTime;
uniform int uSeed;
uniform float uU;
uniform vec2 uWind;
uniform vec2 uOrg;
out vec4 oFuel;
uint hu(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float h1(int a, int b, int c) {
  return float(hu(uint(a) * 0x9E3779B1u ^ uint(b) * 0x85EBCA77u ^ (uint(c) * 0x2545F491u + uint(uSeed) * 0x27d4eb2fu)) >> 8) / 16777216.0;
}
float vn(vec2 p, int k) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  int x = int(i.x), y = int(i.y);
  return mix(mix(h1(x, y, k), h1(x + 1, y, k), f.x), mix(h1(x, y + 1, k), h1(x + 1, y + 1, k), f.x), f.y);
}
// a noise that cross-fades to a new pattern every \`per\` s (contrast kept through the fade)
float morph(vec2 p, float t, float per, int k) {
  float kk = t / per, k0 = floor(kk), w = kk - k0; w = w * w * (3.0 - 2.0 * w);
  float a = vn(p, k + int(k0) * 17), b = vn(p, k + int(k0 + 1.0) * 17);   // (the same point: keyframe n+1 here = keyframe n of the next span, no jump)
  return 0.5 + (mix(a, b, w) - 0.5) / sqrt((1.0 - w) * (1.0 - w) + w * w);
}
vec2 fuel(vec2 c, float t) {
  float S = 32.0 * uU, fs = float(uSeed & 1023);
  // the sampling point wanders (the patches drift and come back, never in step) and creeps a little downwind
  vec2 w1 = S * vec2(1.4 * sin(t * 0.083 + fs) + 0.6 * sin(t * 0.191 + 2.0 * fs), 0.7 * sin(t * 0.067 + 0.5 * fs)) + vec2(uWind.x, 0.0) * S * 0.12 * t;
  vec2 w2 = S * vec2(0.9 * sin(t * 0.137 + 3.0 * fs), 0.5 * sin(t * 0.113 + fs)) - vec2(0.0, 0.05) * S * t;
  float big = morph((c + w1) / (2.1 * S), t, 10.3, 501), mid = morph((c + w2) / (0.85 * S), t, 7.1, 503);
  float f = 0.62 * big + 0.38 * mid;
  float bed = morph((c - w2) / (0.55 * S), t, 6.1, 505);
  return clamp(vec2(f, bed), 0.0, 1.0);
}
// two keyframes 1/4 s apart (the art pass blends them: the fuel never steps)
void main() {
  vec2 c = (vCell - 0.5) * ${FUEL_K}.0 + uOrg;           // the texel's art cell, WORLD cells (texel centres hold the samples)
  vec2 a = fuel(c, uTime), b = fuel(c, uTime + 0.25);
  oFuel = vec4(a.x, b.x, a.y, b.y);
}`;

/* ======================================================================== pass 1: the art cells */
const ART = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform sampler2D uField;   // model.raster: R heat, G plume, B burning ground, A 1 + (fire level - 1) * 4 + smoke level
uniform sampler2D uAux;     // R distance inside the bed, G outside, B smoke source, A source smoke level (+4: a fire's)
uniform sampler2D uAuxOld;  // the long-burning bed's own inside distance while new ground catches next to it (R; model.auxOldOf)
uniform int uHasOld;
uniform sampler2D uTimes;   // per cell: flame ignite / out, smoke ignite / out (model.raster), only while uAnim
uniform int uAnim;
uniform vec2 uI;            // seconds since the ignite ref, its span
uniform vec2 uO;            // seconds since the out ref, its span
uniform vec3 uDur;          // grow, out, the whole out span (s)
uniform vec2 uSize;
uniform vec2 uOrg;           // the area's origin in WORLD cells: every lattice, hash and noise is world-anchored, so an area that is
                             // rebuilt with another rect (a stroke added, merged, erased) draws the same fire where nothing changed
uniform float uTime;        // shared clock, 12 fps steps (s)
uniform int uSeed;
uniform float uU;           // art px scale: cells per grid square / 32
uniform int uLvMax;         // the area's highest fire level (the emitter lattice)
uniform float uLean;        // the wind's lean (cells per cell of height)
uniform vec2 uWind;         // the area's wind
uniform float uPlume;       // P.plume (squares)
uniform sampler2D uPuff;    // model.raster's puff mask: G = 0 no puff can reach the cell, else the nearest source row's distance code; R the farthest's
uniform vec4 uBox;          // the FIRE BOX (world cells x0, y0, x1, y1): the tongues and sparks are only looked for inside it (model.reachOf
                            // without the puffs - the rectangle's extra room for the smoke costs them nothing)
uniform vec4 uPuffQ;        // ... their step and offset (rows), then B / A (the sources' columns): step, offset; 0 = no puff texture
uniform int uBirths;        // blobs per emitter (Performance: 8 / 6 / 4)
uniform sampler2D uFuel;    // pass 0: R fuel (how hard the fire burns here), G the beds' variety (bilinear, one texel per FUEL_K cells)
uniform vec2 uFuelSize;
out vec4 oArt;

/* ---------------- the LOOK TABLES (research section 6; index = level 1..3) ---------------- */
const float RY = 0.8;
const float L_DENS[4] = float[4](0.0, 2.5, 6.0, 11.0);     // emitters per square
const float L_R[4]    = float[4](0.0, 3.6, 5.0, 6.4);      // blob radius (art px)
const float L_RISE[4] = float[4](0.0, 10.0, 22.0, 40.0);   // tongue height (art px)
const float L_LIFE[4] = float[4](0.0, 0.9, 0.85, 0.8);     // blob life (s)
const float L_EMB[4]  = float[4](0.0, 0.28, 0.45, 0.6);    // bed embers (share)
const float L_COAL[4] = float[4](0.0, 0.3, 0.5, 0.7);   // loose coals between the flames and past the bed's edge (share of 4 px cells)
// SPARK layers (research: binding the fire): 0 small fast specks from inside the flames, 1 slower long-lived specks, 2 a few 2 px
// sparks, 3 pops from the coals (short, low); spacing (art px), rise (art px / s), life (s), birth height (x the level's rise)
const float SPK_S[4]  = float[4](7.0, 10.0, 18.0, 11.0);
const float SPK_V[4]  = float[4](34.0, 20.0, 15.0, 10.0);
const float SPK_L[4]  = float[4](1.0, 1.8, 1.4, 0.45);
const float SPK_H[4]  = float[4](0.7, 0.4, 0.3, 0.0);
const float SPK_D[16] = float[16](0.0, 0.08, 0.34, 0.7,  0.0, 0.07, 0.28, 0.55,  0.0, 0.04, 0.16, 0.34,  0.0, 0.08, 0.18, 0.3);
const float L_TINT[4] = float[4](0.0, 0.2, 0.3, 0.4);      // heat-tint ring (squares)
const float S_RATE[4] = float[4](0.0, 6.0, 6.0, 9.0);      // puffs a second per 3.6 squares of source
const float S_R0[4]   = float[4](0.0, 4.0, 6.0, 8.0);      // puff radius at birth (art px)
const float S_R1[4]   = float[4](0.0, 11.0, 17.0, 21.0);    // ... at its largest
const float S_LIFE[4] = float[4](0.0, 2.4, 3.6, 4.6);      // puff life (s)
const float S_V0[4]   = float[4](0.0, 16.0, 20.0, 24.0);   // rise speed at birth (art px / s, x plume / 2.5 x 1.5)
const bool EXIT = true;
const float TAU = 1.3;                                     // the smoke cools: rise speed v0 e^(-age / tau)
const int VC[256] = int[256](${VC16.join(",")});

uint hu(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float hf(int a, int b, int c) {
  uint h = hu(uint(a) * 0x9E3779B1u ^ hu(uint(b) * 0x85EBCA77u ^ (uint(c) * 0x2545F491u + uint(uSeed) * 0x27d4eb2fu)));
  return float(h >> 8) / 16777216.0;
}
// one round: the value-noise lattice (smooth noise hides the weaker mixing)
float h1(int a, int b, int c) {
  return float(hu(uint(a) * 0x9E3779B1u ^ uint(b) * 0x85EBCA77u ^ (uint(c) * 0x2545F491u + uint(uSeed) * 0x27d4eb2fu)) >> 8) / 16777216.0;
}
// four uniform values (8 bits each) from ONE hash (2 rounds instead of 3 per value): the hot loops' randoms
vec4 hb(int a, int b, int c) {
  uint h = hu(uint(a) * 0x9E3779B1u ^ hu(uint(b) * 0x85EBCA77u ^ (uint(c) * 0x2545F491u + uint(uSeed) * 0x27d4eb2fu)));
  return (vec4(float(h & 255u), float((h >> 8) & 255u), float((h >> 16) & 255u), float(h >> 24)) + 0.5) / 256.0;
}
float vn(vec2 p, int k) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  int x = int(i.x), y = int(i.y);
  return mix(mix(h1(x, y, k), h1(x + 1, y, k), f.x), mix(h1(x, y + 1, k), h1(x + 1, y + 1, k), f.x), f.y);
}
// value noise with its gradient (d/dp): the smoke's billows are shaded from it
vec3 vnd(vec2 p, int k) {
  vec2 i = floor(p), f = fract(p), s = f * f * (3.0 - 2.0 * f), ds = 6.0 * f * (1.0 - f);
  int x = int(i.x), y = int(i.y);
  float a = h1(x, y, k), b = h1(x + 1, y, k), c = h1(x, y + 1, k), d = h1(x + 1, y + 1, k);
  return vec3(mix(mix(a, b, s.x), mix(c, d, s.x), s.y), ds.x * mix(b - a, d - c, s.y), ds.y * mix(c - a, d - b, s.x));
}
// a 2x2-cell blue-noise threshold (0..1)
float rank(vec2 c) { ivec2 q = ivec2(floor(c * 0.5)) & 15; return (float(VC[q.y * 16 + q.x]) + 0.5) / 256.0; }
// the fire BREATHES: three incommensurate slow waves and a stepped random walk (0.65..1.15, no visible period); s = the cluster
float breath(float t, int s) {
  float fs = float(s & 1023) * 0.731;
  float b = 0.9 + 0.12 * sin(t * 1.6982 + fs) + 0.08 * sin(t * 1.0650 + 2.0 * fs) + 0.05 * sin(t * 2.7318);
  float k = floor(t / 0.7), f = t / 0.7 - k; f = f * f * (3.0 - 2.0 * f);
  int ki = int(k);
  return b + 0.16 * ((1.0 - f) * (h1(s, ki, 91) - 0.5) + f * (h1(s, ki + 1, 91) - 0.5));
}
// a GUST travels across the area along the wind every ~4.5 s: lean per cell of height (0.06 .. 0.38)
float gust(float t, float x) {
  float f = fract(t * 0.22 - x / (160.0 * uU) + float(uSeed & 255) * 0.0137);
  return 0.06 + 0.32 * clamp(sin(3.14159 * clamp((f - 0.55) / 0.3, 0.0, 1.0)), 0.0, 1.0);
}
// the FUEL here (0..1, contrast-shaped: hot patches, weak patches, gaps) and the beds' variety
vec2 fuelAt(vec2 p) {
  vec4 k = texture(uFuel, ((p - uOrg) / ${FUEL_K}.0 + 0.5) / uFuelSize); float w = fract(uTime * 4.0);
  return vec2(smoothstep(0.34, 0.66, mix(k.r, k.g, w)), mix(k.b, k.a, w));
}
ivec2 Lc(ivec2 p) { return p - ivec2(uOrg); }
vec4 fA(ivec2 p) { return texelFetch(uAux, Lc(p), 0); }
vec4 fF(ivec2 p) { return texelFetch(uField, Lc(p), 0); }
// the bed's inside distance at p (d = the new one): a long-burning cell moves from its old distance to the new one while the added
// ground catches (the area's first new ignite + the grow time), so its tongues, char and sparks never jump when a stroke is added
float dBed(ivec2 p, float d) {
  if ( uHasOld == 0 ) return d;
  float dO = texelFetch(uAuxOld, Lc(p), 0).r * 255.0;
  if ( dO < 0.5 || dO >= d ) return d;
  float g = clamp(uI.x / max(uDur.x, 0.01), 0.0, 1.0);
  return mix(dO, d, g * g * (3.0 - 2.0 * g));
}
int levelAt(ivec2 p) { int code = int(fF(p).a * 255.0 + 0.5) - 1; return code < 0 ? 2 : clamp(code / 4 + 1, 1, 3); }
// a puff centred at q (WORLD cells) reaching h either way: 1 well inside the area, 0 once its extent touches the rectangle
float edgeFade(vec2 q, vec2 h, float u) {
  vec2 l = q - uOrg, d2 = min(l - h, uSize - l - h);
  return smoothstep(0.0, 6.0 * u + 2.0, min(d2.x, d2.y));
}
bool inArea(ivec2 p) { p = Lc(p); return p.x >= 0 && p.y >= 0 && p.x < int(uSize.x) && p.y < int(uSize.y); }
// a cell's ignite / out ages (s): flames (x, y), smoke (z, w); 1e4 = long lit, -1e4 = not out
vec4 ages(ivec2 p) {
  vec4 a = vec4(1e4, -1e4, 1e4, -1e4);
  if ( uAnim == 0 ) return a;
  vec4 T = texelFetch(uTimes, Lc(p), 0) * 255.0;
  if ( T.r > 0.5 ) a.x = uI.x - (T.r - 1.0) / 254.0 * uI.y;
  if ( T.g < 254.5 ) a.y = uO.x - T.g / 254.0 * uO.y;
  if ( T.b > 0.5 ) a.z = uI.x - (T.b - 1.0) / 254.0 * uI.y;
  if ( T.a < 254.5 ) a.w = uO.x - T.a / 254.0 * uO.y;
  return a;
}

void main() {
  vec2 c = vCell + uOrg;                            // the cell's centre (WORLD cells)
  ivec2 ic = ivec2(floor(c));
  float u = uU, t = uTime, gdir = uWind.x < -0.05 ? -1.0 : 1.0;
  vec4 aux = fA(ic) * 255.0;
  vec4 fld = texelFetch(uPuff, Lc(ic), 0);         // (only the puff mask: the field's own bytes are not needed per cell)
  // (off the puff mask, outside the fire box (no tongue, no spark) and beyond the heat ring, nothing is drawn: the room the rectangle
  // keeps for the smoke costs two fetches a cell there. aux.g: the ground-plane chamfer distance to the bed, at least the true one)
  bool inBox = c.x >= uBox.x && c.y >= uBox.y && c.x < uBox.z && c.y < uBox.w;
  if ( EXIT && fld.g == 0.0 && !inBox && aux.g > 0.8 * 32.0 * u / RY + 4.0 ) { oArt = vec4(0.0); return; }
  float rk = rank(c);
  int lvMax = clamp(uLvMax, 1, 3);
  int R = 0, G = 0, B = 0, A = 0;

  /* ---------------- FLAMES: blob chains per emitter, merged into one body (colour seen front rows first) ---------------- */
  float sp = 32.0 * u / sqrt(L_DENS[3]), spy = sp * RY;   // (one lattice for every level: a stronger stroke added never reshuffles it)
  float Rm = L_R[lvMax] * u, reachUp = L_RISE[lvMax] * u * 2.8 + Rm * 2.2, reachDn = Rm * 2.2;
  float lo0 = uLean + min(gdir * 0.036, gdir * 0.38), hi0 = uLean + max(gdir * 0.036, gdir * 0.38);
  float W2 = 2.6 * Rm * 1.3 + 3.2 * u;
  // (a cell far from any burning ground below it is skipped: flames only rise)
  bool nearBed = inBox && (aux.r > 0.5 || aux.g < (W2 + abs(hi0) * reachUp) / RY + 2.0);
  for ( int s = 1; s <= 3 && !nearBed && inBox; s++ ) {
    ivec2 p = ivec2(ic.x, ic.y + int(reachUp * float(s) / 3.0));
    if ( Lc(p).y < int(uSize.y) ) { float g = fA(p).g * 255.0; nearBed = fA(p).r > 0.0 || g < (W2 + abs(hi0) * reachUp) / RY + 2.0; }
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
        vec4 E1 = hb(i, j, 1);
        vec2 e = vec2((float(i) + E1.x) * sp, (float(j) + E1.y) * spy);
        ivec2 ei = ivec2(floor(e));
        if ( !inArea(ei) ) continue;
        float d = fA(ei).r * 255.0;
        if ( d < 0.5 ) continue;
        d = dBed(ei, d);                                       // not on the burning ground
        vec4 E2 = hb(i, j, 2);
        int lv = levelAt(ei), lvO = lv;
        // (a long-burning cell raised to a higher level by a stroke added onto it: its tongues move to the new size while the new
        // ground catches, never at once - model.auxOldOf G = its old level)
        float kL = 1.0;
        if ( uHasOld == 1 ) {
          int o = int(texelFetch(uAuxOld, Lc(ei), 0).g * 255.0 + 0.5);
          if ( o > 0 && o != lv ) { lvO = o; kL = clamp(uI.x / max(uDur.x, 0.01), 0.0, 1.0); kL *= kL * (3.0 - 2.0 * kL); }
        }
        if ( E2.y >= max(L_DENS[lv], L_DENS[lvO]) / L_DENS[3] * 1.44 ) continue;   // (cheap: this level's density never reaches it)
        float LD = mix(L_DENS[lvO], L_DENS[lv], kL), LR = mix(L_R[lvO], L_R[lv], kL), LRI = mix(L_RISE[lvO], L_RISE[lv], kL);
        float ramp = clamp(d / (0.35 * 32.0 * u), 0.0, 1.0);            // the coverage ramp at the bed's edge (0.35 square)
        // the FUEL here decides how hard this stretch burns: big merged masses in hot patches, single tongues in weak ones, gaps
        // with only embers between; it wanders and evolves, so the clumps swell, die back, creep and merge over seconds
        float r0 = LR * u;
        // (cheap cull before the fuel fetch: even at full fuel this emitter's tallest tongue and its roots must reach the cell)
        float es1 = (0.55 + 0.45 * ramp) * (0.7 + 0.6 * E1.z) * 1.3 * 1.25, hR = clamp(d / (0.9 * 32.0 * u), 0.0, 1.0);
        float eh0 = (0.5 + 0.65 * hR) * (0.55 + 0.95 * pow(E1.w, 1.6)) * (E2.x < 0.12 ? 1.25 : 1.0);
        if ( c.y < e.y - (LRI * u * 2.1 * es1 * eh0 * 1.38 + 6.6 * r0 * es1) - 1.0 || c.y > e.y + 4.5 * r0 * es1 + 2.0 * u ) continue;
        float fz = max(fuelAt(e).x, 0.07 * float(lv - 1));   // (higher levels: fewer fully dead patches)
        float thr = LD / L_DENS[3] * (0.25 + 0.75 * ramp) * (0.04 + 1.4 * fz);
        float on = clamp((thr - E2.y) / 0.14, 0.0, 1.0);               // (an emitter fading in or out shrinks: it never pops)
        if ( on <= 0.0 ) continue;
        float es = (0.55 + 0.45 * ramp) * (0.7 + 0.6 * E1.z) * (0.55 + 0.75 * fz) * (on * (2.0 - on)) * (0.92 + 0.6 * (gust(t, e.x) - 0.06));
        // tongue heights vary: taller towards the heart of the fire, a few tall leaders, many short ones (never a picket fence)
        float eh = eh0 * (0.38 + 1.0 * fz) * (0.15 + 0.85 * on);   // (a dying patch's tongues SINK into the bed and thin out, never cut)
        // (exact cull: this emitter's tongue and its roots must reach the cell)
        if ( c.y < e.y - (LRI * u * 2.1 * es * eh + 6.6 * r0 * es) - 1.0 || c.y > e.y + 4.5 * r0 * es + 2.0 * u ) continue;
        float rate = 0.8 + 0.5 * E2.z;
        int id = i * 131 + j * 7919;
        vec4 ag = ages(ei);
        float ageI = ag.x, ageO = ag.y;
        float outS = 1.0;
        if ( ageO > -1e3 ) {
          float stg = (ramp * 0.6 + 0.2 * E2.w) * uDur.y;
          // (going out, the new tongues come smaller and smaller until this emitter stops: the flames SINK, they are never cut)
          outS = 1.0 - 0.7 * clamp(ageO / max(stg, 0.25 * uDur.y), 0.0, 1.0);
          ageO -= stg;                                                  // going out: the edge first, the heart up to 0.8 x P.out later (never retroactive: no pop)
        }
        if ( ageI <= 0.0 ) continue;                                    // not caught yet
        float gE = clamp(ageI / max(uDur.x, 0.01), 0.0, 1.0); gE *= 2.0 - gE;
        int cl = int(floor(e.x / (96.0 * u))) * 7 + int(floor(e.y / (96.0 * u))) * 13 + uSeed;
        float br = breath(t, cl);
        // the ROOTS: two wide, foreshortened blobs that never leave the bed (they sink when the fire goes out)
        float rootK = ageO > -1e3 ? 1.0 - clamp(ageO / max(0.5 * uDur.y, 0.01), 0.0, 1.0) : 1.0;
        float rb = r0 * es * (0.9 + 0.25 * br + 0.15 * sin(t * 2.1 + float(id))) * rootK * gE;                    // (a catching emitter's roots grow from nothing)
        for ( int k = 0; k < 2; k++ ) {
          // (every base its own: wider or narrower, offset, hotter in hot patches - no two alike)
          float rr = rb * (0.75 - 0.15 * float(k)); if ( rr < 0.6 ) continue;
          vec2 p = vec2(e.x + (float(k) - 0.5 + (E2.w - 0.5) * 0.8) * rb * 0.9 + 0.8 * u * sin(t * (1.3 + float(k)) + float(id) * 0.7), e.y - rb * 0.1 - float(k) * 1.5 * u);
          float dx = (c.x - p.x) / ((1.1 + 0.9 * E1.z) * rr), dy = (c.y - p.y) / (1.0 * rr); if ( dy > 0.0 ) dy *= 1.5;
          float q = 1.0 - (dx * dx + dy * dy) / 2.2;
          if ( q > 0.0 ) { q *= q; rF += q; rH += q * (0.6 + 0.5 * fz) * (0.5 + 0.5 * q) * (0.3 + 0.7 * outS); rB += q * (0.5 + 0.7 * fz) * outS; lvL = max(lvL, lv); }   // (sinking roots cool)
        }
        // the BLOBS: born every life / 5 / rate s (jittered), uneven lives, accelerating up, leaning, swaying, swelling then shrinking
        float life0 = L_LIFE[lv], iv = life0 / 5.0 / rate;
        int n0 = int(floor(t / iv));
        for ( int k = 0; k < 8; k++ ) {
          if ( k >= uBirths ) break;
          int n = n0 - k;
          vec4 B1 = hb(id, n, 11);
          float tb = (float(n) + 0.6 * B1.x) * iv;
          if ( tb < t - ageI ) continue;                                  // born before the emitter caught
          if ( ageO > -1e3 && tb > t - ageO ) continue;                   // born after it went out: the last ones finish their lives
          float life = life0 * (0.6 + 0.8 * B1.y) * (0.8 + 0.4 * br);
          float a = (t - tb) / life;
          if ( a < 0.0 || a >= 1.0 ) continue;
          float size = es * (0.7 + 0.6 * B1.z) * (0.75 + 0.35 * br) * (0.15 + 0.85 * gE) * outS;
          float z = LRI * u * size * eh * (0.6 + 0.8 * B1.w) * (0.3 + 0.7 * gE) * pow(a, 1.35);
          float r = r0 * size * (a < 0.15 ? 0.3 + 4.667 * a : pow(1.0 - (a - 0.15) / 0.85, 0.8));   // (born small at the bed, swelling)
          if ( r < 0.6 ) continue;
          float y = e.y - z, sy = r * (1.4 + 1.5 * a);
          if ( c.y < y - 1.5 * sy || c.y > y + sy ) continue;
          vec4 B2 = hb(id, n, 12);
          float lean = uLean + gdir * gust(t, e.x) * (0.6 + 0.4 * B2.x);
          float x = e.x + (B2.y - 0.5) * 3.0 * u + z * lean + 1.6 * u * a * sin(6.2832 * (1.2 * a + B2.z));
          float dx = (c.x - x) / (r * (1.05 - 0.45 * a)), dy = (c.y - y) / sy; if ( dy > 0.0 ) dy *= 1.5;   // (wide low, thin tips)
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
      // (core: how deep inside the merged body - the tongues' own cores and the fused base are hot, the silhouette cools: the
      // value breaks follow the tongue shapes, without outlines)
      // (from the body's own field, not the eroded one: the erosion only frays the silhouette, the inside stays in clean planes)
      float core = clamp((F - 0.34) / 0.85, 0.0, 1.0);
      float v = 0.5 * heat + 0.34 * core + 0.18 * base;
      float st = vn(vec2(c.x / (5.0 * u), (c.y + t * 20.0 * u) / (13.0 * u)), 41 + (int(t * 3.0) & 7));
      v += (st - 0.5) * 0.1;
      int nb = lvL == 3 ? 7 : 6;
      int band = clamp(int(v * (float(nb) + 0.4)), 1, nb - 1);
      if ( band == 6 && st < 0.4 ) band = 5;                           // the cream core only in licks, never a slab
      if ( core > 0.5 && band < 3 ) band = 3;                          // (deep inside the body: no dark-red mottling)
      R = 7; G = band + 1 + 8 * (lvL - 1);                             // (one layer: the outline is the merged silhouette only)
    }
  }

  /* ---------------- BED: embers boiling in place; GROUND: char, heat tint ---------------- */
  vec4 ag = ages(ic);
  float dIn = aux.r > 0.5 ? dBed(ic, aux.r) : aux.r, dOut = aux.g;
  // (outside the bed: the clock and level of the NEAREST bed, probed across the gap - never the whole area's, which restarts when
  // any stroke of the area changes)
  vec4 agN = vec4(1e4, -1e4, 1e4, -1e4); int lvN = lvMax;
  if ( dIn <= 0.5 && dOut > 0.5 && dOut < 0.8 * 32.0 * u ) {
    bool any = false; int dd = int(dOut + 1.5);
    for ( int k = 0; k < 8; k++ ) {
      float an = float(k) * 0.7854; ivec2 q = ic + ivec2(round(vec2(cos(an), sin(an)) * float(dd) * (k % 2 == 1 ? 1.42 : 1.0)));
      if ( !inArea(q) || fA(q).r <= 0.0 ) continue;
      vec4 aq = ages(q); int lq = levelAt(q);
      if ( !any ) { agN = aq; lvN = lq; any = true; } else { agN.x = max(agN.x, aq.x); agN.y = max(agN.y, aq.y); lvN = max(lvN, lq); }
    }
  }
  // (the beds differ: brighter and fuller in hot patches, broken in weak ones, some spilling wider - the fuel map and its G)
  vec2 fc = dIn > 0.5 || dOut < 0.75 * 32.0 * u ? fuelAt(c) : vec2(0.5);
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
      float share = L_EMB[lv] * br * growC * (0.35 + 0.85 * fc.x + 0.6 * (fc.y - 0.5));
      if ( outA > -1e3 ) {
        share = mix(share, L_EMB[1] * br, clamp(outA / max(uDur.y, 0.01), 0.0, 1.0));          // the bed glows on, dimmer...
        if ( rk < clamp((outA - uDur.y - 0.8) / 1.2, 0.0, 1.0) ) share = 0.0;                 // ...then goes dark, cluster by cluster
      }
      float kf = t * 3.0, k0 = floor(kf), w = kf - k0; w = w * w * (3.0 - 2.0 * w);
      vec2 ep = c / vec2(4.5 * u, 3.6 * u);
      float ev = mix(vn(ep, 200 + (int(k0) & 511)), vn(ep, 200 + ((int(k0) + 1) & 511)), w) * 0.7 + vn(c / vec2(2.0 * u, 1.6 * u), 7) * 0.3;
      if ( dIn > 1.0 && share > 0.0 && ev > 1.0 - share * 0.9 && rk < rampC * (0.7 + fc.y) + 0.1 ) G = ev > 1.0 - share * 0.4 ? 26 : ev > 1.0 - share * 0.7 ? 25 : 24;
    }
  } else if ( dOut > 0.5 ) {
    float wT = L_TINT[lvN] * 32.0 * u;
    float tk = clamp(agN.x / max(uDur.x, 0.01), 0.0, 1.0) * (agN.y > -1e3 ? 1.0 - clamp((agN.y - 0.7 * uDur.z) / (0.3 * uDur.z), 0.0, 1.0) : 1.0);
    if ( dOut < wT && rk < (0.9 - dOut / wT) * tk ) A += 4;
  }
  // COALS: loose glowing coals between the flames and a little past the bed's edge (fading out into the map); they pulse slowly,
  // some flicker out for a while, and they outlast the flames when the fire goes out
  float wC = (0.25 + 0.5 * fc.y) * 32.0 * u;                       // (some beds spill coals wider than others)
  if ( G == 0 && (dIn > 0.5 || (dOut > 0.5 && dOut < wC)) ) {
    float Sc = 4.0 * u;
    ivec2 gc = ivec2(floor(c / Sc));
    vec4 C1 = hb(gc.x, gc.y, 400);
    vec2 cp = (vec2(gc) + 0.2 + 0.6 * C1.xy) * Sc;
    bool big = C1.z < 0.22;
    if ( abs(c.x - cp.x) <= (big ? 1.0 : 0.5) && abs(c.y - cp.y) <= 0.5 ) {
      int lvC = dIn > 0.5 ? levelAt(ic) : lvN;
      float pC = L_COAL[lvC] * (dIn > 0.5 ? 1.5 - 0.9 * fc.x : 1.0 - dOut / wC) * clamp((dIn > 0.5 ? ag.x : agN.x) / max(0.6 * uDur.x, 0.01), 0.0, 1.0);
      vec4 C2 = hb(gc.x, gc.y, 401);
      float outC = dIn > 0.5 ? ag.y : agN.y;
      bool alive = C1.w < pC && fract(t * 0.07 + C2.w) < 0.86;                       // (some flicker out for a while)
      if ( outC > -1e3 && outC > uDur.y + 1.5 + 3.5 * C2.x ) alive = false;           // (they outlast the flames, then go one by one)
      if ( alive ) {
        float pulse = 0.5 + 0.5 * sin(t * (0.9 + 1.6 * C2.y) + C2.z * 6.2832);
        bool hot = dIn > 2.0 && outC < -1e3;
        G = hot && pulse > 0.82 ? 37 : pulse > 0.55 ? 26 : pulse > 0.2 ? 25 : 24;
        // (a coal never pops: it glows up from its darkest step as it catches and dims to it before it goes out or flickers off)
        float fl = fract(t * 0.07 + C2.w);
        if ( C1.w > pC - 0.06 || fl > 0.8 || fl < 0.03 || (outC > -1e3 && outC > uDur.y + 0.9 + 3.5 * C2.x) ) G = 24;
      }
    }
  }

  /* ---------------- SPARKS in the air: specks that ride the heat up, drift and swirl, and cool through the ramp ---------------- */
  // (a rising frame per layer: each spark sits in one cell of a grid that moves up with it, so a cell finds its spark in O(1); its
  // birth place, below along its path, must be burning ground - denser over the heart of the fire and in gusts)
  bool nearSp = nearBed || dIn > 0.5;
  for ( int s = 1; s <= 3 && !nearSp && inBox && t > 0.0; s++ ) {                     // (sparks rise higher than the flames reach)
    ivec2 p = ivec2(floor(c + vec2(-(uLean + 0.6 * uWind.x), 1.0) * float(s) * 22.0 * u));
    if ( inArea(p) ) nearSp = fA(p).r > 0.0;
  }
  if ( t > 0.0 && (G == 0 || (R > 0 && ((G - 1) & 7) <= 2)) && nearSp ) {
    float Wd = uLean + 0.6 * uWind.x;
    for ( int L = 0; L < 4; L++ ) {
      float S = SPK_S[L] * u, V = SPK_V[L] * u, life0 = SPK_L[L], P = life0 * 1.7;
      float yq = c.y + V * t, xq = c.x - Wd * V * t;
      xq -= 1.6 * u * sin(yq / (9.0 * u) + t * 1.3 + floor(xq / (40.0 * u)) * 1.7);       // (a little swirl)
      ivec2 g = ivec2(floor(vec2(xq, yq) / S));
      vec4 H = hb(g.x, g.y, 300 + L);
      float ph = H.x * P, k = floor((t + ph) / P), age = t + ph - k * P;
      vec4 J = hb(g.x + int(k) * 7919, g.y, 310 + L);
      float life = life0 * (0.6 + 0.8 * J.z);
      if ( age > life ) continue;
      // (near the fire box's top each spark burns out at its own height, 2-16 art px below it: sparks die at scattered heights, never
      // cut off by the box's edge - no bigger box, no extra cost)
      if ( c.y - uBox.y < (2.0 + 14.0 * H.z) * max(1.0, u) ) continue;
      vec2 q = (vec2(g) + 0.15 + 0.7 * J.xy) * S;
      float hs = (L == 2 || (L == 0 && J.z > 0.8)) ? 1.0 : 0.5;                          // (a few 2 px sparks)
      if ( abs(xq - q.x) > hs || abs(yq - q.y) > hs ) continue;
      ivec2 sb = ivec2(floor(vec2(c.x - Wd * V * age, c.y + V * age + SPK_H[L] * L_RISE[lvMax] * u)));
      if ( !inArea(sb) ) continue;
      float dB = fA(sb).r * 255.0;
      if ( dB < 0.5 ) continue;
      dB = dBed(sb, dB);
      int lvS = levelAt(sb);
      vec4 agS = ages(sb);
      if ( agS.x < age + 0.3 || (agS.y > -1e3 && agS.y > age) ) continue;             // (born while that ground burned)
      float heatK = 0.35 + 0.65 * clamp(dB / (0.6 * 32.0 * u), 0.0, 1.0);
      float gustK = 0.7 + 1.6 * gust(t - age, c.x);
      if ( J.w > SPK_D[L * 4 + lvS] * heatK * gustK * float(uBirths) / 8.0 ) continue;
      float a = age / life, s0 = H.y < 0.25 ? 6.0 : H.y < 0.7 ? 5.0 : 4.0;
      int step = int(floor((s0 + 0.99) * (1.0 - a * a * 0.55 - a * 0.15)));              // (white / yellow, orange, red, dark, gone)
      if ( a < 0.12 ) step = min(step, 1 + int(floor(s0 * a / 0.12)));                    // (it IGNITES: dark red up to its flare)
      if ( step < 1 ) continue;
      G = 32 + step;
      break;
    }
  }

  /* ---------------- SMOKE: lit puffs from the sources ---------------- */
  // (only near the plume: the model's plume field says where smoke can be, never what its silhouette is)
  float R1m = S_R1[3] * u * 1.25;
  // (the puff mask marks every cell a puff can cover - model.puffMask: its drift cone and its size, conservative - so this cheap gate
  // never cuts the smoke)
  bool smk = fld.g > 0.0;
  if ( smk ) {
    float sps = 22.0 * u, spys = sps * RY, Hk = uPlume / 2.5;
    float zTop = 1.0 * L_RISE[3] * u + S_V0[3] * u * Hk * 1.5 * 1.35 * TAU + R1m;
    float rA = 0.6 * uWind.x + 0.12 * gdir, rB = 0.6 * uWind.x + 0.216 * gdir, rMin = min(rA, rB), rMax = max(rA, rB);
    float strM = 1.0 + 0.55 * (0.3 + 2.0 * (abs(0.6 * uWind.x) + 0.216));   // (the widest shear stretch; + the flow warp below)
    float pad = R1m * (0.83 + 1.15 * strM) + sps * 0.5 + 2.5 * u + 4.0 * u;
    int jHi = int(floor((c.y + zTop * (1.0 + max(0.0, -0.5 * uWind.y)) + R1m + 4.5 * u) / spys)) + 1, jLo = int(floor((c.y - R1m - 4.5 * u - max(0.0, 0.5 * uWind.y) * zTop) / spys)) - 1;
    // (only the rows where a source that can reach this cell lies: model.puffMask's nearest / farthest, conservative)
    if ( uPuffQ.x > 0.0 ) {
      float dLo = (fld.g * 255.0 - 1.0) * uPuffQ.x - uPuffQ.y, dHi = fld.r * 255.0 * uPuffQ.x - uPuffQ.y;
      jHi = min(jHi, int(floor((c.y + dHi + 1.0) / spys)) + 1); jLo = max(jLo, int(floor((c.y + dLo - 1.0) / spys)) - 1);
    }
    float xS0 = uPuffQ.x > 0.0 ? c.x + (fld.b * 255.0 - 1.0) * uPuffQ.z - uPuffQ.w - 1.0 : -1e9;
    float xS1 = uPuffQ.x > 0.0 ? c.x + fld.a * 255.0 * uPuffQ.z - uPuffQ.w + 1.0 : 1e9;
    float F = 0.0, AG = 0.0, QB = -1e9; vec2 nB = vec2(0.0), GR = vec2(0.0); int lsB = 2; bool lowB = false, own = false, frB = false, drB = false;
    // the FLOW: a smooth warp field that rises and drifts with the smoke - every edge rolls and curls over itself, no lobe stays a
    // circle; the same field turns the shading (the rolls inside the mass follow the curls of its silhouette)
    vec2 fp = vec2(c.x - (0.6 * uWind.x + 0.12 * gdir) * 10.0 * u * t, c.y + 10.0 * u * t) / (11.0 * u);
    vec3 fg = vnd(fp, 611);
    vec2 wv = clamp(vec2(fg.z, -fg.y) * 0.33, -0.5, 0.5);           // (CURL of a noise: it swirls, it never bunches up)
    vec2 cw = c + wv * 8.0 * u;
    for ( int jj = 0; jj < 40; jj++ ) {
      int j = jHi - jj; if ( j < jLo ) break;
      float dyc = max(0.0, float(j) * spys - c.y);
      float xlo = c.x - max(0.0, rMax * dyc) - pad, xhi = c.x - min(0.0, rMin * dyc) + pad;   // (the puffs shear along the wind)
      int i0 = int(floor(max(xlo, xS0) / sps - 0.5)), i1 = int(floor(min(xhi, xS1) / sps - 0.5)) + 1;
      for ( int ii = 0; ii < 16; ii++ ) {
        int i = i0 + ii; if ( i > i1 ) break;
        vec2 e = vec2((float(i) + 0.5) * sps, (float(j) + 0.5) * spys);
        ivec2 ei = ivec2(floor(e));
        if ( !inArea(ei) ) continue;
        vec4 sa = fA(ei) * 255.0;
        if ( sa.b < 5.0 ) continue;
        int code = int(sa.a + 0.5), ls = clamp(code & 3, 1, 3);
        bool fromFire = code >= 4;
        float src = sa.b / 255.0;
        float rate = S_RATE[ls] / 3.6 * (sps * spys) / (1024.0 * u * u), iv = 1.0 / max(rate, 0.05);
        float z0 = fromFire ? 1.0 * L_RISE[levelAt(ei)] * u : 2.0 * u;
        float lifeS = S_LIFE[ls];
        float v0 = S_V0[ls] * u * Hk * 1.5;
        vec4 ag2 = ages(ei);
        // which births can be at this height now: invert z(age) (the rise only depends on the age)
        float rr1 = S_R1[ls] * u * 1.35 + 4.5 * u, dz = e.y - c.y;
        // (a fire's smoke is not only above its flames: some puffs rise from BETWEEN the tongues, from low over the bed)
        float z0lo = fromFire ? 0.2 * z0 : z0;
        float zl = max(z0lo, dz - rr1 - spys), zh = dz + rr1 + spys;
        float zMax = z0 + v0 * 1.35 * TAU * 0.999;
        if ( zl > zMax ) continue;
        // (the fastest puffs, x 1.35, reach a height soonest; the slowest, x 0.65, latest)
        float aLo = -TAU * log(max(1e-4, 1.0 - max(0.0, zl - z0) / (1.35 * v0 * TAU)));
        float aHi = zh >= z0lo + 0.65 * v0 * TAU * 0.999 ? lifeS * 1.3 : -TAU * log(max(1e-4, 1.0 - (zh - z0lo) / (0.65 * v0 * TAU)));
        aHi = min(aHi, lifeS * 1.3);
        int nLo = int(floor((t - aHi) / iv)) - 1, nHi = int(floor((t - aLo) / iv));
        int eid = i * 977 + j * 3163;
        for ( int kk2 = 0; kk2 < 8; kk2++ ) {
          int n = nHi - kk2; if ( n < nLo ) break;
          vec4 P1 = hb(eid, n, 59);
          if ( P1.x > src ) continue;                                    // a weak source: fewer puffs (whole shapes, never holes)
          float tb = (float(n) + 0.7 * P1.y) * iv, age = t - tb;
          if ( age < 0.0 ) continue;
          if ( tb < t - ag2.z ) continue;                                 // before the smoke started
          // after it stopped the last puffs drift off - and the source does not stop all at once: each puff has its own last moment
          // (up to 1.8 s early) and the last ones are smaller, so the column's foot frays out instead of lifting off as a flat line
          float dS = ag2.w > -1e3 ? t - ag2.w - tb : 1e4;
          if ( dS < 1.8 * fract(P1.y * 7.31 + P1.z * 3.17) ) continue;
          float life = lifeS * (0.7 + 0.6 * P1.z), a = age / life;
          if ( a >= 1.0 ) continue;
          float build = clamp((ag2.z - age) / 2.0, 0.0, 1.0);            // the first puffs are wisps, building up over ~2 s
          float vj = v0 * (0.65 + 0.7 * P1.w);                // every puff its own speed: no flat ceiling
          float zb = fromFire && fract(P1.x * 13.7) < 0.4 ? z0 * (0.2 + 0.6 * fract(P1.y * 7.3)) : z0;   // (low puffs: among the tongues)
          bool front = fract(P1.z * 11.1) < 0.45;                         // (some smoke curls in front of the flames, some behind)
          // (a few of the front puffs are DENSE DRIFTS: they really cover the flames for a moment as they pass, lit from below)
          bool drift = front && fract(P1.w * 17.3) < 0.4;
          float z = zb + vj * TAU * (1.0 - exp(-age / TAU));
          vec4 P2 = hb(eid, n, 62);
          vec2 o0 = e + (P2.xy - 0.5) * vec2(sps, spys);
          float g = gust(t, o0.x);
          float x = o0.x + z * (0.6 * uWind.x + 0.12 * gdir * (1.0 + 0.8 * g)) + 2.5 * u * sin(6.2832 * (0.35 * age + P2.z));
          float y = o0.y - z + 0.5 * uWind.y * z;
          float r = (S_R0[ls] + (S_R1[ls] - S_R0[ls]) * min(1.0, a / 0.55)) * u * (0.45 + 0.55 * build) * (0.8 + 0.4 * P2.w)
                  * (0.55 + 0.45 * clamp(dS / 1.8, 0.0, 1.0));
          // (wisps stretch along the wind and the gust as they age: shear, not round puffs)
          float strx = 1.0 + (0.1 + 0.45 * a) * (0.3 + 2.0 * abs(0.6 * uWind.x + 0.12 * gdir * (1.0 + 0.8 * g)));
          // (the cull box: a lobe sits at most 0.6 r x tear 1.44 across / 0.42 r x 1.44 down from the centre and covers sqrt(1.6) x its
          // radius 0.95 r (x strx across): nothing beyond the box is drawn - model.puffReach mirrors it)
          vec2 hb2 = vec2(r * (0.87 + 1.2 * strx), r * 1.85) + 2.0;
          if ( abs(cw.x - x) > hb2.x || abs(cw.y - y) > hb2.y ) continue;
          int nl = 3;
          vec4 P3 = hb(eid, n, 70), P4 = hb(eid, n, 75); float p75 = P4.w;
          // every puff CONDENSES from nothing (thin first, then dense) and DISSIPATES by thinning: no puff ever pops in or out
          float env = smoothstep(0.0, 0.24, a) * (1.0 - smoothstep(0.55, 1.0, a));
          // ... and a puff whose whole extent (the cull box above + the flow warp) comes near the area's rectangle thins out AS A WHOLE
          // before it could touch it: no smoke silhouette ever meets a straight edge (model.reachOf makes room, so this rarely acts)
          env *= edgeFade(vec2(x, y), hb2 + 4.0 * u, u);
          if ( env <= 0.0 ) continue;
          // (wisps stretch along the wind and the gust as they age: shear, not round puffs)

          // (lit warm from below only while the flames under it still burn: a dead fire lights nothing)
          bool low = fromFire && z < z0 + 0.8 * L_RISE[2] * u && a < 0.5 && (ag2.y < -1e3 || ag2.y < 0.4 * uDur.y);
          for ( int k = 0; k < 4; k++ ) {
            if ( k >= nl ) break;
            float ang = P3[k] * 6.2832 + a * (1.5 + p75);
            // (the last lobe tears off a little and shrinks as it goes: never a round balloon floating off the column)
            float tear = k == nl - 1 ? 1.0 + 1.0 * max(0.0, a - 0.5) * (0.5 + g) : 1.0;
            vec2 l = vec2(x + cos(ang) * r * 0.6 * tear, y + sin(ang) * r * 0.42 * tear - (k == 3 ? r * 0.45 : 0.0));
            float lr = r * (0.45 + 0.5 * P4[k]) * (1.0 - 0.7 * max(0.0, a - 0.6) / 0.4) * (1.0 - 0.3 * (tear - 1.0));   // (uneven lobes)
            if ( lr < 0.8 * u ) continue;
            vec2 dd = (cw - l) / lr; dd.x /= strx;
            float q = 1.0 - dot(dd, dd) / 1.6;
            // the cell's billow is the NEAREST lobe whose sphere covers it (oblique depth: further south and higher = nearer)
            float d2 = dot(dd, dd), dep = o0.y + 0.5 * z + float(k) * 0.7;
            if ( d2 < min(1.0, 1.5 * env) && dep > QB ) { QB = dep; nB = dd / sqrt(max(min(1.0, 1.5 * env), 0.05)); lsB = ls; lowB = low; frB = front; drB = drift; own = true; }
            if ( q > 0.0 ) { GR += env * sqrt(q) * dd / lr; q *= q * env; F += q; AG += q * a; if ( !own ) { lsB = ls; lowB = low; frB = front; drB = drift; } }
          }
        }
      }
    }
    if ( F > 0.12 ) {
      float age = AG / F;
      float fade = clamp((age - 0.5) / 0.5, 0.0, 1.0);
      // TATTERS: a finer noise riding up with the smoke erodes the density - the dense rolls hold, the thin parts tear into wisps,
      // and old smoke (the column's top) thins and tears apart instead of lingering as round lobes
      vec3 bl = vnd(vec2(cw.x / (6.0 * u), (cw.y + 12.0 * u * t) / (5.0 * u)), 617);   // (the billows: they ride up with the smoke)
      float er = bl.x;
      float D = F * (0.6 + 0.8 * er) - fade * (0.55 - 0.45 * er);
      if ( D > 0.22 ) {
        // VEILS: thin smoke between the rolls lets the map through (the rim alpha); the dense rolls are shaded as one volume
        bool rim = D < 0.36;
        vec2 nU = GR / (length(GR) + 0.35 / (R1m * 0.5));
        // (the whole mass's gradient: lit top, shadowed underside; + the billows' own: each roll gets its lit crescent and shadow)
        vec2 nM = (own ? nB * 0.9 + nU * 0.25 : nU) - vec2(bl.y, bl.z) * 0.12; if ( length(nM) > 0.98 ) nM *= 0.98 / length(nM);
        vec3 n3 = vec3(nM, sqrt(max(0.0, 1.0 - dot(nM, nM))));
        float lit = dot(n3, normalize(vec3(-0.6, -0.72, 0.3)));   // (a low light from the top-left: lit tops, shadowed undersides)
        int band = lit > 0.4 ? 1 : lit > -0.12 ? 2 : 3;
        if ( fade > 0.45 && band == 3 ) band = 2;                       // thinning old smoke is never in the darkest band
        if ( lowB && band == 3 ) band = 4;                             // the underside low over the fire is lit warm from below
        B = band + (rim ? 8 : 0) + 16 * lsB + (frB ? 64 : 0) + (frB && drB ? 128 : 0);
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
        vec4 sa = fA(ei) * 255.0;
        int ls = clamp(int(sa.a + 0.5) & 3, 1, 3);
        if ( sa.b < 5.0 || ls < 2 ) continue;
        float src = sa.b / 255.0, rate = S_RATE[ls] / 3.6 * (sps * spys) / (1024.0 * u * u), iv = 1.0 / max(rate, 0.05);
        int eid = i * 977 + j * 3163, nH = int(floor(t / iv));
        vec4 ag2 = ages(ei);
        bool fromFire = int(sa.a + 0.5) >= 4;
        float z0 = fromFire ? 1.0 * L_RISE[levelAt(ei)] * u : 2.0 * u;
        float v0 = S_V0[ls] * u * Hk * 1.5;
        for ( int k = 0; k < 6; k++ ) {
          int n = nH - k;
          vec4 P1 = hb(eid, n, 59);
          if ( P1.x > src ) continue;
          float tb = (float(n) + 0.7 * P1.y) * iv, age = t - tb;
          if ( age < 0.0 || tb < t - ag2.z || (ag2.w > -1e3 && t - ag2.w - tb < 1.8 * fract(P1.y * 7.31 + P1.z * 3.17)) ) continue;
          float life = S_LIFE[ls] * (0.7 + 0.6 * P1.z), a = age / life;
          if ( a >= 1.0 ) continue;
          float z = z0 + v0 * (0.65 + 0.7 * P1.w) * TAU * (1.0 - exp(-age / TAU));
          vec4 P2 = hb(eid, n, 62);
          vec2 o0 = e + (P2.xy - 0.5) * vec2(sps, spys);
          float x = o0.x + z * (0.6 * uWind.x + 0.12 * gdir) + z * 0.25;
          float r = (S_R0[ls] + (S_R1[ls] - S_R0[ls]) * min(1.0, a / 0.55)) * u * 0.9;
          vec2 dd = vec2((c.x - x) / r, (c.y - o0.y - 2.0 * u) / (r * RY));
          float ef = edgeFade(vec2(x, o0.y + 2.0 * u), vec2(r, r * RY) + 2.0, u);
          if ( dot(dd, dd) < 0.8 && rk < 0.55 * ef * smoothstep(0.0, 0.24, a) * (1.0 - 0.55 * smoothstep(0.45, 0.8, a)) * (1.0 - smoothstep(0.8, 1.0, a)) ) { A = (A & 7) + 8 * (ls == 3 ? 2 : 1); }
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

// the smoke's palette (the smoke layer)
const SMOKE_PAL = `
const vec3 SMK[9] = vec3[9](vec3(0.741, 0.718, 0.678), vec3(0.557, 0.537, 0.506), vec3(0.384, 0.369, 0.408),
                            vec3(0.788, 0.765, 0.722), vec3(0.545, 0.525, 0.494), vec3(0.310, 0.294, 0.341),
                            vec3(0.561, 0.537, 0.498), vec3(0.349, 0.333, 0.369), vec3(0.173, 0.165, 0.196));   // wisps / plume / column: light, mid, shadow
const vec3 S_A[4] = vec3[4](vec3(0.0), vec3(0.50, 0.60, 0.68), vec3(0.62, 0.74, 0.86), vec3(0.82, 0.90, 0.96));    // their alphas (flat)
const float S_RIM[4] = float[4](0.0, 0.24, 0.32, 0.45);
vec3 tintSmoke(vec3 c) {
  if ( uSmokeTint.a <= 0.0 ) return c;
  float L = dot(c, vec3(0.3, 0.59, 0.11)), tl = max(0.05, dot(uSmokeTint.rgb, vec3(0.3, 0.59, 0.11)));
  return mix(c, min(vec3(1.0), L * uSmokeTint.rgb / tl), uSmokeTint.a);
}`;
const FLAME_COLOR = `
const float OUTER[4] = float[4](0.0, 0.55, 0.85, 1.0);                 // outer bands' alpha per fire level (flat)
// a flame cell's colour, premultiplied (0 = no flame)
vec4 flameColor(ivec2 p, ivec4 a) {
  if ( a.r > 0 && a.g > 0 && a.g < 24 ) {
    int band = (a.g - 1) & 7, lv = clamp((a.g - 1) / 8 + 1, 1, 3);
    // the RIM on the merged body's outer silhouette only (the flames are one layer), selective: nothing above / on the shadow side
    // -> 2 steps darker, the lit left side -> 1 step; hot flanks get red, never plum; none at the bottom
    int up = art(p + ivec2(0, -1)).r, lf = art(p + ivec2(-1, 0)).r, rt = art(p + ivec2(1, 0)).r;
    bool outer = up == 0 || rt == 0 || lf == 0;
    if ( up < a.r || rt < a.r ) band = max(band - (outer ? 2 : 1), band >= 4 ? 1 : 0);
    else if ( lf < a.r ) band = max(band - 1, 1);
    float al = band <= 1 ? OUTER[lv] : 1.0;
    return vec4(uRamp[band].rgb * al, al);
  }
  return vec4(0.0);
}`;
// the FIRE layer (under the tokens): flames, bed embers, coals and sparks
const SHOW = `${SHOW_COMMON}
${FLAME_COLOR}
vec4 cellColor(vec2 cf) {
  ivec2 p = ivec2(cf);
  ivec4 a = art(p);
  vec4 col = flameColor(p, a);
  if ( a.g >= 24 && a.g < 32 ) col = vec4(uRamp[7 + min(2, a.g - 24)].rgb, 1.0);
  if ( a.g >= 32 ) col = vec4(uRamp[min(6, a.g - 32)].rgb, 1.0);   // sparks and hot coals
  return col;
}
#define OUT(c) ((c) * uAlpha)
${FOOTPRINT}`;

// the SMOKE layer (ABOVE the tokens: smoke drifting over a token veils it, thinly at level 1, more at 3). It is composited over the
// fire layer, so the interleave is decided here: smoke behind a tongue is hidden by it (nothing drawn on a flame cell); smoke in front
// of it is a thin veil lit warm from below - and a DENSE DRIFT (a few of the front puffs) really covers the flames for a moment, lit
// from below with the flame's own colour glowing through; smoke just above a flame glows where the tongue pokes into it; a spark in
// the smoke glows through it (drawn here again, on top)
const SMOKE = `${SHOW_COMMON}
${SMOKE_PAL}
${FLAME_COLOR}
vec4 cellColor(vec2 cf) {
  ivec2 p = ivec2(cf);
  ivec4 a = art(p);
  if ( a.b == 0 ) return vec4(0.0);
  if ( a.g >= 32 ) return vec4(uRamp[min(6, a.g - 32)].rgb, 1.0);
  int band = a.b & 7, rim = (a.b >> 3) & 1, ls = clamp((a.b >> 4) & 3, 1, 3);
  bool front = (a.b & 64) != 0, drift = (a.b & 128) != 0;
  vec3 rgb = band == 4 ? uRamp[11].rgb : tintSmoke(SMK[(ls - 1) * 3 + band - 1]);
  float al = rim == 1 ? S_RIM[ls] : S_A[ls][min(band, 3) - 1];
  // AT NIGHT the scene's darkness already dims the smoke with the map (it is not emissive): darkening it again made a black smudge.
  // It keeps its own value, cooled a little by the ambient, and reads by its form: the lit tops and the outer edge facing the light
  // (top-left) catch a pale rim, the dense cores stay dark - contrast against the dimmed map, never a glow (nothing goes above the
  // day colours)
  if ( uDark > 0.0 && band != 4 ) {
    vec3 cool = rgb * vec3(0.90, 0.95, 1.06);
    bool edge = art(p + ivec2(0, -1)).b == 0 || art(p + ivec2(-1, 0)).b == 0 || art(p + ivec2(-1, -1)).b == 0;
    if ( band == 1 || edge ) cool = mix(cool, vec3(0.80, 0.83, 0.90), edge ? 0.55 : 0.3);
    else if ( band == 3 ) cool *= 0.85;
    rgb = mix(rgb, cool, uDark);
    if ( edge ) al = mix(al, max(al, 0.7 * S_A[ls].x), uDark);
  }
  vec4 fl = flameColor(p, a);
  if ( fl.a > 0.0 ) {
    if ( !front ) return vec4(0.0);
    if ( drift ) {
      al = min(0.82, al) * (rim == 1 ? 0.7 : 1.0);
      rgb = mix(mix(rgb, uRamp[10].rgb, 0.4), fl.rgb / max(fl.a, 0.01), 0.22);
    } else { al *= 0.3; rgb = mix(rgb, uRamp[10].rgb, 0.6); }
  } else if ( band != 1 && (art(p + ivec2(0, 1)).r > 0 || art(p + ivec2(0, 2)).r > 0) ) rgb = mix(rgb, uRamp[10].rgb, 0.55);
  return vec4(rgb * al, al);
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
  art: PIXI.Program.from(VERT, ART, "moinen-maps-fire-art-v6"),
  fuel: PIXI.Program.from(VERT, FUEL, "moinen-maps-fire-fuel-v3"),
  show: PIXI.Program.from(VERT, SHOW, "moinen-maps-fire-show-v3"),
  smoke: PIXI.Program.from(VERT, SMOKE, "moinen-maps-fire-smoke-v2"),
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
  constructor(field, rect, geo, { above = null, box = null, seed = 1, grid = 32, lean = 0, wind = [0, 0], dur = [1.6, 2.2, 10], plume = 2.5, lvMax = 2, smokeTint = 0, births = 8 } = {}) {
    super();
    this.eventMode = "none"; this.interactiveChildren = false;
    const { ap, ox, oy } = geo, W = field.w, H = field.h, P = programs();
    const x0 = ox + rect.x0 * ap, y0 = oy + rect.y0 * ap, x1 = x0 + W * ap, y1 = y0 + H * ap;
    this.fieldTex = texOf(field.data, W, H);
    this.auxTex = texOf(field.aux ?? new Uint8Array(W * H * 4), W, H);
    this.timesTex = field.times ? texOf(field.times, W, H) : null;
    this.auxOldTex = field.auxOld && field.times ? texOf(field.auxOld, W, H) : null;
    this.puffTex = field.puff ? texOf(field.puff, W, H) : null;
    this.rt = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST });
    this.rt.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    this.anim = field.anim; this.W = W; this.H = H;
    // the fuel map (pass 0): a few hundred texels, bilinear
    const FW = Math.ceil(W / FUEL_K) + 1, FH = Math.ceil(H / FUEL_K) + 1;
    this.fuelRt = PIXI.RenderTexture.create({ width: FW, height: FH, resolution: 1, scaleMode: PIXI.SCALE_MODES.LINEAR });
    this.fuelRt.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    this.fuelPass = new PIXI.Mesh(quad(0, 0, FW, FH, FW, FH), new PIXI.Shader(P.fuel, { uTime: 0, uSeed: seed % 65536, uU: grid / 32,
      uWind: new Float32Array(wind), uOrg: new Float32Array([rect.x0, rect.y0]), translationMatrix: new PIXI.Matrix().toArray(true) }));
    this.artT = null;
    const ramp = rampOf(field.color ?? NATURAL);
    this.pass = new PIXI.Mesh(quad(0, 0, W, H, W, H), new PIXI.Shader(P.art, {
      uField: this.fieldTex, uAux: this.auxTex, uAuxOld: this.auxOldTex ?? this.auxTex, uHasOld: this.auxOldTex ? 1 : 0, uPuff: this.puffTex ?? this.fieldTex, uTimes: this.timesTex ?? this.fieldTex, uAnim: this.timesTex ? 1 : 0,
      uI: new Float32Array([0, 1]), uO: new Float32Array([0, 1]), uDur: new Float32Array(dur),
      uSize: new Float32Array([W, H]), uTime: 0, uSeed: seed % 65536, uU: grid / 32, uLvMax: lvMax, uLean: lean,
      uWind: new Float32Array(wind), uPlume: plume, uPuffQ: new Float32Array(field.puff ? field.puffQ : [0, 0, 0, 0]),
      uBox: new Float32Array(box ? [box.x0, box.y0, box.x1, box.y1] : [rect.x0, rect.y0, rect.x1, rect.y1]), uBirths: births, uFuel: this.fuelRt, uFuelSize: new Float32Array([FW, FH]), uOrg: new Float32Array([rect.x0, rect.y0]),
      translationMatrix: new PIXI.Matrix().toArray(true) }));
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
    // the SMOKE lives in a layer above the tokens (`above`, the display's; else on top of this container): it follows this area's
    // visibility and alpha
    this.smoke = new PIXI.Mesh(quad(x0, y0, x1, y1, W, H), new PIXI.Shader(P.smoke, common()));
    this.smoke.state.blendMode = PIXI.BLEND_MODES.NORMAL; this.smoke.eventMode = "none";
    const s0 = this.smoke._render.bind(this.smoke);
    this.smoke._render = (renderer) => {
      if ( !this.worldVisible || !this.parent ) return;
      const u = this.smoke.shader.uniforms; u.uAlpha = this.worldAlpha; u.uK = footprintK(); s0(renderer);
    };
    (above ?? this).addChild(this.smoke);
    // KNOWN RISKS for "the area's rectangle shows" (each quad covers the whole area rect; checked by diffing frames with each pass
    // hidden, dev/out bbox probe: clean at zoom 1-3, day and dark, DPR 1 - the one real case was the outside distance, model.chamfer):
    //   - the ground pass is a MULTIPLY quad writing alpha 1 over the whole rect (exact 1.0 colour outside the marks: invisible on an
    //     opaque primary texture; a transparent one would show the rect);
    //   - the glow quad is drawn into Foundry's illumination, which renders at HALF resolution below Performance MAX and is upscaled
    //     bilinearly (a soft halo around emissive cells, never past the cells' own neighbourhood);
    //   - the box-filter footprint reads past the art texture at the quad's edge: art() returns 0 there (bounds-checked, no undefined
    //     texelFetch).
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
  // (the fuel map evolves over seconds: it is re-rendered at 4 fps on a quantised clock - deterministic, and its pass costs a
  // render-target switch per area, so it must not run with every 12 fps art frame)
  setTime(t) { this.pass.shader.uniforms.uTime = t; this.fuelPass.shader.uniforms.uTime = Math.floor(t * 4) / 4; }
  setDark(d) { this.show.shader.uniforms.uDark = d; this.ground.shader.uniforms.uDark = d; this.smoke.shader.uniforms.uDark = d; }
  setBirths(n) { this.pass.shader.uniforms.uBirths = n; }
  /** The area's grow / out clocks at shared time `now` (ms). */
  setPhase(now) {
    const a = this.anim; if ( !a ) return;
    const u = this.pass.shader.uniforms;
    u.uI[0] = (now - a.iRef) / 1000; u.uI[1] = a.iSpan / 1000; u.uO[0] = (now - a.oRef) / 1000; u.uO[1] = a.oSpan / 1000;
  }
  /** Draw the art cells for the current time (the 12 fps pass). */
  renderArt(renderer) {
    const tf = this.fuelPass.shader.uniforms.uTime;
    if ( tf !== this.fuelT ) { this.fuelT = tf; renderer.render(this.fuelPass, { renderTexture: this.fuelRt, clear: true }); }
    renderer.render(this.pass, { renderTexture: this.rt, clear: true });
    this.artT = this.pass.shader.uniforms.uTime;
  }
  destroy() {
    const tx = [this.fieldTex, this.auxTex, this.timesTex, this.auxOldTex, this.puffTex];
    this.fieldTex = this.auxTex = this.timesTex = this.auxOldTex = this.puffTex = null;
    this.glow.parent?.removeChild(this.glow);
    const own = this.smoke.parent === this;
    if ( !own ) this.smoke.parent?.removeChild(this.smoke);
    for ( const m of [this.pass, this.fuelPass, this.ground, this.show, this.glow, this.smoke] ) m.geometry?.destroy();
    this.pass.destroy(); this.fuelPass.destroy(); this.glow.destroy();
    if ( !own ) this.smoke.destroy();
    super.destroy({ children: true });
    for ( const t of tx ) t?.destroy(true);
    this.rt.destroy(true); this.fuelRt.destroy(true);
  }
}
