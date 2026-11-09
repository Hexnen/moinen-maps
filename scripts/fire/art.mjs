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
 *     RGBA8 render texture (W x H cells): R = flame (0 none; else 1 + its bed row in art px mod 255: depth vs tokens), G = flame band + 8 (level - 1) (1..23)
 *     or a bed ember (24..26) or a spark / hot coal (32 + ramp step 1..6) or the heat shimmer (40 light, 41 dark streak) or a ground
 *     glow pool (42..44), B = smoke band (1 light, 2 mid, 3 shadow, 4 fire-lit underside) + 8 rim + 16 smoke level, A = ground
 *     code: char level (0..3) + 4 heat tint + 8 smoke shadow (0..2) + 32 the smoke's NIGHT shading (a burning fire's smoke lit from below:
 *     1 warm underside, 2 warm-dim, 3 dark top; the smoke layer blends it in with the scene's darkness, the emission makes 1 glow).
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
 * A7 (the look up to "wow"):
 *  - SHEETS: a slow lick wave along the bed (sheetAt) raises and sinks neighbouring tongues together - broad sheets, never a comb of
 *    equal spikes; tongues are flame-shaped (narrowing to a point); LEADERS (a few emitters at levels 2-3: taller, wider, slower) carry
 *    the crests, FORK at the top (two uneven prongs parting with height) and TEAR OFF a small pointed piece that rises and shrinks away.
 *  - PALETTE: the body runs red, orange, amber, yellow by heat and height above its bed (tops red, base yellow), broken by one rising,
 *    swaying lick-streak field; a graded dark-red outline (dark red outside, orange inside it; pinholes get no dark ring); the cream
 *    core only right over the embers; smaller fires burn redder. At night the flames are lifted against Foundry's ambience filter.
 *  - AROUND IT: a heat shimmer over the flames (thin wavy light / dark streaks), SPARK BURSTS from hot spots (a fan thrown up at once),
 *    a GUST that bends a whole stretch at once (broad, fast across; the lean grows with height), ground GLOW POOLS that swell and
 *    wander with the fuel, and CHAR that creeps out from the bed while it burns.
 * Cost: every per-cell random comes from one 32-bit hash split into 4 bytes (hb), and emitters out of reach of the cell are culled
 * before any blob work. A8: two tiny passes before the art pass - EMB (each flame emitter's, smoke source's and puff's box this frame,
 * conservative) and TILE (per 8 x 8 cells, the lattice rows / columns whose boxes touch it, rasterised with MAX blending) - so a cell
 * looks only at what can reach it; the per-emitter code is unchanged, so the art is the same cell for cell (~0.3 x the A7 cost).
 * A9: the every-frame layers (ground, fire, front, smoke, emission) skip what holds nothing: an OCC pass after the art (per 8 x 8 cells,
 * which layers have anything there) culls whole 32 x 32 blocks in the vertex shader and single tiles per pixel - the screen is the same
 * pixel for pixel (~0.15 x the layers' cost); and the art pass draws only the cells near the view (display.windowOf / guard).
 * Colour: the ramp (uRamp) is derived per area from the fire's base colour (look.mjs rampOf().ramp7). Everything is a function of
 * (cell, area seed, shared clock, field): every client draws the same frames.
 */
import { rampOf, NATURAL, VC16 } from "./look.mjs";
/** look.VC16 as the art passes' uVC uniform: four ranks (bytes) an int. */
export const VC_PACKED = Int32Array.from({ length: 64 }, (_, k) => VC16[4 * k] | (VC16[4 * k + 1] << 8) | (VC16[4 * k + 2] << 16) | (VC16[4 * k + 3] << 24));
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

// A9: the every-frame layers are drawn as BLOCKS of 32 x 32 cells, not one quad over the whole rectangle: a block none of whose 16 OCC
// tiles holds anything for the layer is collapsed in its vertex shader (no pixel of it is shaded or blended at all - most of an area's
// rectangle holds only the smoke's possible reach). The corners' positions and cells come from the same JS sums as the old quad's, so
// shared block edges meet exactly and the outer edges are the old quad's edges.
const BLK = 32;
const VERT_B = (ch) => `#version 300 es
precision highp float;
precision highp int;
in vec2 aVertexPosition;
in vec2 aCell;
in vec2 aBlk;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform sampler2D uOcc;
out vec2 vCell;
void main() {
  ivec2 T = textureSize(uOcc, 0), t0 = ivec2(aBlk) * ${BLK / 8}, t1 = min(t0 + ${BLK / 8}, T);
  bool on = false;
  for ( int y = t0.y; y < t1.y && !on; y++ ) for ( int x = t0.x; x < t1.x; x++ ) if ( texelFetch(uOcc, ivec2(x, y), 0)[${ch}] > 0.0 ) { on = true; break; }
  vCell = aCell;
  gl_Position = on ? vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0) : vec4(2.0, 2.0, 0.0, 1.0);
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
const ART_HEAD = `#version 300 es
precision highp float;
precision highp int;
#define LVC 1
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
uniform sampler2D uLvRamp;  // F1 (see FireArt)
uniform int uHasRamp;
uniform vec3 uRampT;
uniform vec4 uLvTop;
uniform sampler2D uLvRamp2;
uniform int uHasRamp2;
uniform vec2 uRampP;
out vec4 oArt;

/* ---------------- the LOOK TABLES (research section 6; index = level 1..3) ---------------- */
const float RY = 0.8;
float L_DENS(int i) { return (i <= 1 ? (i <= 0 ? 0.0 : 2.5) : (i <= 2 ? 6.0 : 9.0)); }      // emitters per square (A7: L3 fewer, wider - its sheets)
float L_R(int i) { return (i <= 1 ? (i <= 0 ? 0.0 : 3.6) : (i <= 2 ? 5.0 : 7.0)); }      // blob radius (art px)
float L_RISE(int i) { return (i <= 1 ? (i <= 0 ? 0.0 : 10.0) : (i <= 2 ? 22.0 : 40.0)); }   // tongue height (art px)
float L_LIFE(int i) { return (i <= 1 ? (i <= 0 ? 0.0 : 0.9) : (i <= 2 ? 0.85 : 0.8)); }     // blob life (s)
float L_EMB(int i) { return (i <= 1 ? (i <= 0 ? 0.0 : 0.28) : (i <= 2 ? 0.45 : 0.6)); }    // bed embers (share)
float L_COAL(int i) { return (i <= 1 ? (i <= 0 ? 0.0 : 0.3) : (i <= 2 ? 0.5 : 0.7)); }   // loose coals between the flames and past the bed's edge (share of 4 px cells)
// SPARK layers (research: binding the fire): 0 small fast specks from inside the flames, 1 slower long-lived specks, 2 a few 2 px
// sparks, 3 pops from the coals (short, low); spacing (art px), rise (art px / s), life (s), birth height (x the level's rise)
float SPK_S(int i) { return (i <= 1 ? (i <= 0 ? 7.0 : 10.0) : (i <= 2 ? 18.0 : 11.0)); }
float SPK_V(int i) { return (i <= 1 ? (i <= 0 ? 34.0 : 20.0) : (i <= 2 ? 15.0 : 10.0)); }
float SPK_L(int i) { return (i <= 1 ? (i <= 0 ? 1.0 : 1.8) : (i <= 2 ? 1.4 : 0.45)); }
float SPK_H(int i) { return (i <= 1 ? (i <= 0 ? 0.7 : 0.4) : (i <= 2 ? 0.3 : 0.0)); }
float SPK_D(int i) { return (i <= 7 ? (i <= 3 ? (i <= 1 ? (i <= 0 ? 0.0 : 0.08) : (i <= 2 ? 0.34 : 0.7)) : (i <= 5 ? (i <= 4 ? 0.0 : 0.07) : (i <= 6 ? 0.28 : 0.55))) : (i <= 11 ? (i <= 9 ? (i <= 8 ? 0.0 : 0.04) : (i <= 10 ? 0.16 : 0.34)) : (i <= 13 ? (i <= 12 ? 0.0 : 0.08) : (i <= 14 ? 0.18 : 0.3)))); }
float L_HEAT(int i) { return i <= 1 ? (i <= 0 ? 0.0 : 0.74) : 1.0; }
float L_TINT(int i) { return (i <= 1 ? (i <= 0 ? 0.0 : 0.2) : (i <= 2 ? 0.3 : 0.4)); }      // heat-tint ring (squares)
float S_RATE(int i) { return (i <= 1 ? (i <= 0 ? 0.0 : 6.0) : (i <= 2 ? 6.0 : 9.0)); }      // puffs a second per 3.6 squares of source
float S_R0(int i) { return (i <= 1 ? (i <= 0 ? 0.0 : 4.0) : (i <= 2 ? 6.0 : 8.0)); }      // puff radius at birth (art px)
float S_R1(int i) { return (i <= 1 ? (i <= 0 ? 0.0 : 11.0) : (i <= 2 ? 17.0 : 21.0)); }    // ... at its largest
float S_LIFE(int i) { return (i <= 1 ? (i <= 0 ? 0.0 : 2.4) : (i <= 2 ? 3.6 : 4.6)); }      // puff life (s)
float S_V0(int i) { return (i <= 1 ? (i <= 0 ? 0.0 : 16.0) : (i <= 2 ? 20.0 : 24.0)); }   // rise speed at birth (art px / s, x plume / 2.5 x 1.5)
// F1: a table at a level 1..3 (exact at a whole one)
// (LVC 0: the WHOLE-LEVEL programs - an area of whole levels, no ramp: every F1 path folds away, the old code's cost; LVC 1 the
// continuous ones - lvcPrograms)
#if LVC
float lvMix(float a, float b, float f) { return f <= 0.0 ? a : mix(a, b, f); }
#define LVF(T, x) lvMix(T(int(floor(x))), T(int(floor(x)) + 1), (x) - floor(x))
float SPK_Df(int L, float x) { int i = int(floor(x)); return lvMix(SPK_D(L * 4 + i), SPK_D(L * 4 + i + 1), x - float(i)); }
int lvDith(float x, float r) { return fract(x) > 0.0 ? clamp(int(floor(x - r)) + 1, 1, 3) : int(x); }
#else
#define LVF(T, x) T(int(x))
float SPK_Df(int L, float x) { return SPK_D(L * 4 + int(x)); }
int lvDith(float x, float r) { return int(x); }
#endif
const bool EXIT = true;
const float TAU = 1.3;                                     // the smoke cools: rise speed v0 e^(-age / tau)
uniform int uVC[64];                                       // the 16 x 16 blue-noise ranks (look.VC16), 4 bytes an int (VC_PACKED)

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
float rank(vec2 c) { ivec2 q = ivec2(floor(c * 0.5)) & 15; return (float((uVC[q.y * 4 + (q.x >> 2)] >> ((q.x & 3) * 8)) & 255) + 0.5) / 256.0; }
// the fire BREATHES: three incommensurate slow waves and a stepped random walk (0.65..1.15, no visible period); s = the cluster
float breath(float t, int s) {
  float fs = float(s & 1023) * 0.731;
  float b = 0.9 + 0.12 * sin(t * 1.6982 + fs) + 0.08 * sin(t * 1.0650 + 2.0 * fs) + 0.05 * sin(t * 2.7318);
  float k = floor(t / 0.7), f = t / 0.7 - k; f = f * f * (3.0 - 2.0 * f);
  int ki = int(k);
  return b + 0.16 * ((1.0 - f) * (h1(s, ki, 91) - 0.5) + f * (h1(s, ki + 1, 91) - 0.5));
}
// a GUST travels across the area along the wind every ~4.5 s: lean per cell of height (0.06 .. 0.38). A7: broad and fast across, so
// it bends a whole stretch of the fire at once (~5 squares within half a second) and rolls on, rather than a ripple tongue by tongue
float gust(float t, float x) {
  float f = fract(t * 0.22 - x / (480.0 * uU) + float(uSeed & 255) * 0.0137);
  return 0.06 + 0.32 * clamp(sin(3.14159 * clamp((f - 0.5) / 0.4, 0.0, 1.0)), 0.0, 1.0);
}
// the SHEETS' lick wave along the bed (0..1): slow, incommensurate, travelling a little - broad crests where neighbouring tongues rise
// together, troughs where they sink (no hash: cheap per emitter)
float sheetAt(float t, float x) {
  float fs = float(uSeed & 1023) * 0.37, X = x / uU;
  float w = 0.5 + 0.3 * sin(X * 0.071 + t * 0.83 + fs + 1.3 * sin(X * 0.023 - t * 0.41)) + 0.2 * sin(X * 0.167 - t * 1.37 + 2.0 * fs);
  return smoothstep(0.15, 0.85, w);
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
float levelAt(ivec2 p) {
  int code = int(fF(p).a * 255.0 + 0.5) - 1;
  if ( code < 12 ) return code < 0 ? 2.0 : float(clamp(code / 4 + 1, 1, 3));
  int q = (code - 12) / 4; return 1.0 + float(q + 1 + q / 19) * 0.05;
}
float wrapS(float a) { return mod(a + 500.0, 1000.0) - 500.0; }
float lvDec(float c) { return 1.0 + (c - 1.0) / 127.0; }
#if LVC
vec4 rampTx(ivec2 p) { return uHasRamp == 1 ? texelFetch(uLvRamp, Lc(p), 0) * 255.0 : vec4(0.0); }
vec4 rampPx(ivec2 p) { return uHasRamp2 == 1 ? texelFetch(uLvRamp2, Lc(p), 0) * 255.0 : vec4(0.0); }
#else
vec4 rampTx(ivec2 p) { return vec4(0.0); }
vec4 rampPx(ivec2 p) { return vec4(0.0); }
#endif
float rampAg(vec4 r, vec2 q, float back) { return wrapS(uTime - back - q.x - r.g / 254.0 * q.y); }
float rampE(vec4 r, float x) { float d = r.a * 0.1 * uRampT.z; x = d > 0.0 ? clamp(x / d, 0.0, 1.0) : step(0.0, x); return x * x * (3.0 - 2.0 * x); }
float rampK(vec4 r, float back) { return rampE(r, rampAg(r, uRampT.xy, back)); }
float lvRamp(float lv, vec4 r, vec4 p, float back) {
  if ( r.r < 0.5 ) return lv;
  float x = rampAg(r, uRampT.xy, back);
  if ( p.r > 0.5 && x < -0.3 * uRampT.z ) return mix(lvDec(p.r), lvDec(p.b), rampE(p, rampAg(p, uRampP, back)));
  float k = rampE(r, x); return k >= 1.0 ? lv : mix(lvDec(r.r), lv, k);
}
float lvAt(ivec2 p, float back) { return lvRamp(levelAt(p), rampTx(p), rampPx(p), back); }
// (now: the history before the ramp never shows - the bed, char, glow and coals)
float lvNow(ivec2 p) { float lv = levelAt(p); vec4 r = rampTx(p); if ( r.r < 0.5 ) return lv; float k = rampK(r, 0.0); return k >= 1.0 ? lv : mix(lvDec(r.r), lv, k); }
float srcAt(float b, vec4 r, vec4 p, float back, float lb) {
  float s = b / 255.0; if ( r.r < 0.5 ) return s;
  float x = rampAg(r, uRampT.xy, back);
  if ( p.r > 0.5 && x < -0.3 * uRampT.z ) return min(1.0, r.b / 255.0 * LVF(L_HEAT, lb) / LVF(L_HEAT, lvDec(r.r)));
  float k = rampE(r, x); return k >= 1.0 ? s : mix(r.b / 255.0, s, k);
}
float lvTopNow() {
  float x = uLvTop.w > uLvTop.z ? clamp(wrapS(uTime - uLvTop.z) / (uLvTop.w - uLvTop.z), 0.0, 1.0) : 1.0;
  return x >= 1.0 ? uLvTop.y : mix(uLvTop.x, uLvTop.y, x * x * (3.0 - 2.0 * x));
}
void emLevel(ivec2 ei, int i, int j, out float lv, out float lvO, out float kL, out int lvI, out int lvH, out float tH) {
  lv = levelAt(ei); lvO = lv; kL = 1.0; lvI = int(lv); lvH = 0; tH = 0.0;
  if ( uHasOld == 1 ) {
    int oc = int(texelFetch(uAuxOld, Lc(ei), 0).g * 255.0 + 0.5); float o = oc <= 3 ? float(oc) : 1.0 + float(oc - 4) / 100.0;
    if ( oc > 0 && o != lv ) { lvO = o; kL = clamp(uI.x / max(uDur.x, 0.01), 0.0, 1.0); kL *= kL * (3.0 - 2.0 * kL); }
  }
#if LVC
  vec4 r = rampTx(ei);
  float l0 = r.r > 0.5 ? lvDec(r.r) : lv;
  if ( fract(lv) <= 0.0 && l0 == lv ) return;
  float h = max(hb(i, j, 3).x, 1e-3), lvT = lv, d = r.a * 0.1 * uRampT.z, ag = 0.0;
  if ( r.r > 0.5 ) {
    ag = rampAg(r, uRampT.xy, 0.0);
    float k = rampE(r, ag); if ( k < 1.0 ) { lv = mix(l0, lvT, k); lvO = lv; kL = 1.0; }
  }
  lvI = clamp(int(floor(lv - h)) + 1, 1, 3);
  int i0 = clamp(int(floor(l0 - h)) + 1, 1, 3);
  if ( l0 != lvT && lvI != i0 ) {
    bool up = lvT > l0; lvH = up ? lvI - 1 : lvI + 1;
    float th = float(up ? lvI - 1 : lvI) + h, xs = clamp((th - l0) / (lvT - l0), 0.0, 1.0);
    tH = uTime - ag + d * (0.5 - sin(asin(1.0 - 2.0 * xs) / 3.0));
  } else if ( r.r > 0.5 ) {
    vec4 p = rampPx(ei); float a0 = lvDec(p.r), a1 = lvDec(p.b);
    if ( p.r > 0.5 && a1 != a0 && clamp(int(floor(a0 - h)) + 1, 1, 3) != i0 ) {
      bool up = l0 > a0; lvH = up ? i0 - 1 : i0 + 1;
      float th = float(up ? i0 - 1 : i0) + h, xs = clamp((th - a0) / (a1 - a0), 0.0, 1.0);
      tH = uTime - rampAg(p, uRampP, 0.0) + p.a * 0.1 * uRampT.z * (0.5 - sin(asin(1.0 - 2.0 * xs) / 3.0));
    }
  }
  if ( lvH != 0 && uTime - tH > 3.0 ) lvH = 0;
#endif
}
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
`;

/* A8 COST: the cells look only at the emitters / smoke sources that can reach them. Two tiny passes before the art pass:
 *  - EMB: one texel per flame emitter and per smoke source (both lattices, side by side): the box its roots, blobs, torn pieces and
 *    puffs cover THIS frame (RGBA8: min x, min y, max x, max y as steps of QF / QS art px from its lattice point, rounded outwards and
 *    widened by one step; 0 / 255 = unbounded on that side; an emitter that draws nothing gets an empty box);
 *  - TILE: per 8 x 8 cells, the range of lattice rows and columns whose boxes touch the tile (flames, then smoke; empty = 255, 0).
 * The cell code itself is unchanged: an emitter outside its box contributes nothing there, so skipping it changes no cell. */
const BOXDEC = `const float QF = 2.0, QS = 4.0;            // box steps (x uU art px): flames reach ~250 art px, smoke ~500
vec4 boxDec(vec4 b, vec2 L, float Q) {
  b = floor(b * 255.0 + 0.5);
  return vec4(b.x < 0.5 ? -1e9 : L.x + (b.x - 128.0) * Q, b.y < 0.5 ? -1e9 : L.y + (b.y - 128.0) * Q,
              b.z > 254.5 ? 1e9 : L.x + (b.z - 128.0) * Q, b.w > 254.5 ? 1e9 : L.y + (b.w - 128.0) * Q);
}`;

/* The art pass is TWO programs over the same cells, ART_S ADDED onto ART_F (blend ADD). Split for the link: on a program-cache miss
 * D3D11's compiler took 10-20 s for the one program it was (its cost grows much faster than the code); the two link in parallel.
 *  - ART_F: the flames, the bed, the sparks, the heat shimmer / glow pools: R, G and A's ground bits 0..2;
 *  - ART_S: the smoke (B, A's bits 5..6) and its shadow on the ground (A's bits 3..4).
 * Neither reads what the other writes (the shadow's test of A bits 3..4 is false with or without the ground bits; its A & 103 keeps
 * bits it did not write), so the sum is bit for bit the one program's cell. */
const ART_TOP = `uniform sampler2D uEmb;    // A8: the EMB pass (each emitter's and smoke source's box this frame)
uniform sampler2D uTile;   // A8: the TILE pass (per 8 x 8 cells: the lattice rows / columns that reach it)
uniform ivec4 uEB;         // the lattices' first indices in uEmb: flame i, j, smoke i, j
uniform ivec4 uEN;         // their sizes: flame W, H, smoke W, H (the smoke's texels follow the flames' in x)
uniform int uTileOn;       // 0: no tile ranges (a lattice wider than 255)

${BOXDEC}
void main() {
  vec2 c = vCell + uOrg;                            // the cell's centre (WORLD cells)
  ivec2 ic = ivec2(floor(c));
  float u = uU, t = uTime, gdir = uWind.x < -0.05 ? -1.0 : 1.0;
  vec4 aux = fA(ic) * 255.0;
  vec4 fld = texelFetch(uPuff, Lc(ic), 0);         // (only the puff mask: the field's own bytes are not needed per cell)
  // (off the puff mask, outside the fire box and beyond the heat ring nothing is drawn; aux.g: the ground chamfer distance to the bed)
  bool inBox = c.x >= uBox.x && c.y >= uBox.y && c.x < uBox.z && c.y < uBox.w;
  if ( EXIT && fld.g == 0.0 && !inBox && aux.g > 0.8 * 32.0 * u / RY + 4.0 ) { oArt = vec4(0.0); return; }
  float rk = rank(c);
  int lvMax = clamp(uLvMax, 1, 3);      // (the culls' bound: whole, the top level a ramp passes)
  float lvT = lvTopNow();
  int R = 0, G = 0, B = 0, A = 0;
`;
const ART_TILES = `  // (A8: this tile's lattice ranges - flame rows, columns; smoke rows, columns - absolute indices; no tile pass: everything)
  ivec4 tlF = ivec4(-1000000, 1000000, -1000000, 1000000), tlS = tlF;
  if ( uTileOn == 1 ) {
    ivec2 tp = Lc(ic) / 8;
    ivec4 a = ivec4(floor(texelFetch(uTile, tp, 0) * 255.0 + 0.5)), b = ivec4(floor(texelFetch(uTile, ivec2(textureSize(uTile, 0).x / 2 + tp.x, tp.y), 0) * 255.0 + 0.5));
    tlF = uEB.yyxx + ivec4(255 - a.x, a.y, 255 - a.z, a.w); tlS = uEB.wwzz + ivec4(255 - b.x, b.y, 255 - b.z, b.w);
  }
`;
const ART_F = `${ART_HEAD}${ART_TOP}

  /* ---------------- FLAMES: blob chains per emitter, merged into one body (colour seen front rows first) ---------------- */
  float sp = 32.0 * u / sqrt(L_DENS(3)), spy = sp * RY;   // (one lattice for every level: a stronger stroke added never reshuffles it)
  float Rm = L_R(lvMax) * u, reachUp = L_RISE(lvMax) * u * 2.8 * 1.15 + Rm * 3.4, reachDn = Rm * 2.2;   // (A7: the sheets' crest x 1.15, a torn-off piece above)
  float lo0 = uLean + min(gdir * 0.036, gdir * 0.38), hi0 = uLean + max(gdir * 0.036, gdir * 0.38);
  float W2 = 2.6 * Rm * 1.3 * 1.2 + 3.2 * u;   // (A7: a leader's wider sheet and its fork)
  // (a cell far from any burning ground below it is skipped: flames only rise)
  bool nearBed = inBox && (aux.r > 0.5 || aux.g < (W2 + abs(hi0) * reachUp) / RY + 2.0);
  for ( int s = 1; s <= 3 && !nearBed && inBox; s++ ) {
    ivec2 p = ivec2(ic.x, ic.y + int(reachUp * float(s) / 3.0));
    if ( Lc(p).y < int(uSize.y) ) { float g = fA(p).g * 255.0; nearBed = fA(p).r > 0.0 || g < (W2 + abs(hi0) * reachUp) / RY + 2.0; }
  }
  // ONE BODY: every emitter's roots and blobs add into one field (a metaball union across all rows), so neighbouring tongues
  // fuse at their bases and often mid-height; the bands are computed on the merged field (they flow across tongue boundaries)
  float F = 0.0, HT = 0.0, BASE = 0.0, WS = 0.0, TR = 1.0, BY = 0.0, BF = -1.0, CT = 0.0, lvL = 1.0;
${ART_TILES}
  if ( nearBed && tlF.x <= tlF.y ) {
    int jHi = int(floor((c.y + reachUp) / spy)), jLo = int(floor((c.y - reachDn) / spy)) - 1;
    for ( int jj = max(0, jHi - tlF.y); jj < 32; jj++ ) {
      int j = jHi - jj; if ( j < jLo || j < tlF.x ) break;
      float dyc = max(0.0, (float(j) + 0.5) * spy - c.y);
      float xlo = c.x - max(0.0, dyc * hi0) - W2, xhi = c.x - min(0.0, dyc * lo0) + W2;
      int i0 = int(floor(xlo / sp)) - 1, i1 = int(floor(xhi / sp));
      float rF = 0.0, rH = 0.0, rB = 0.0, rY = 0.0, tF = 0.0, tY = 0.0;
      for ( int ii = max(0, tlF.z - i0); ii < 12; ii++ ) {
        int i = i0 + ii; if ( i > i1 || i > tlF.w ) break;
        // (A8: this emitter's box this frame - nothing of it reaches a cell outside)
        ivec2 et = ivec2(i, j) - uEB.xy;
        if ( et.x < 0 || et.y < 0 || et.x >= uEN.x || et.y >= uEN.y ) continue;      // (off the lattice texture: never on this area's bed)
        vec4 bx = boxDec(texelFetch(uEmb, et, 0), vec2(float(i) * sp, float(j) * spy), QF * u);
        if ( c.x < bx.x || c.x > bx.z || c.y < bx.y || c.y > bx.w ) continue;
        vec4 E1 = hb(i, j, 1);
        vec2 e = vec2((float(i) + E1.x) * sp, (float(j) + E1.y) * spy);
        ivec2 ei = ivec2(floor(e));
        if ( !inArea(ei) ) continue;
        float d = fA(ei).r * 255.0;
        if ( d < 0.5 ) continue;
        d = dBed(ei, d);                                       // not on the burning ground
        vec4 E2 = hb(i, j, 2);
        float lv, lvO, kL, tH; int lvI, lvH;
        emLevel(ei, i, j, lv, lvO, kL, lvI, lvH, tH);
        // (a cell raised by a stroke added onto it grows while the new ground catches - model.auxOldOf G = its old level)
        if ( E2.y >= max(LVF(L_DENS, lv), LVF(L_DENS, lvO)) / L_DENS(3) * 1.44 ) continue;   // (cheap: this level's density never reaches it)
        float LD = mix(LVF(L_DENS, lvO), LVF(L_DENS, lv), kL), LR = mix(LVF(L_R, lvO), LVF(L_R, lv), kL), LRI = mix(LVF(L_RISE, lvO), LVF(L_RISE, lv), kL);
        float ramp = clamp(d / (0.35 * 32.0 * u), 0.0, 1.0);            // the coverage ramp at the bed's edge (0.35 square)
        // the FUEL decides how hard this stretch burns (merged masses, single tongues, ember gaps); it wanders over seconds
        float r0 = LR * u;
        // (cheap cull before the fuel fetch: even at full fuel this emitter's tallest tongue and its roots must reach the cell)
        float es1 = (0.55 + 0.45 * ramp) * (0.7 + 0.6 * E1.z) * 1.3 * 1.25, hR = clamp(d / (0.9 * 32.0 * u), 0.0, 1.0);
        float eh0 = (0.5 + 0.65 * hR) * (0.55 + 0.95 * pow(E1.w, 1.6)) * (E2.x < 0.12 ? 1.25 : 1.0);
        if ( c.y < e.y - (LRI * u * 2.1 * es1 * eh0 * 1.38 * 1.15 + (E2.x < 0.16 ? 12.3 : 7.0) * r0 * es1) - 1.0 || c.y > e.y + (E2.x < 0.16 ? 7.0 : 5.6) * r0 * es1 + 2.0 * u ) continue;   // (A7: x the sheet's crest, a leader's width and torn piece)
        float fz = max(fuelAt(e).x, 0.07 * (lv - 1.0));   // (higher levels: fewer fully dead patches)
        float thr = LD / L_DENS(3) * (0.25 + 0.75 * ramp) * (0.04 + 1.4 * fz);
        float on = clamp((thr - E2.y) / 0.14, 0.0, 1.0);               // (an emitter fading in or out shrinks: it never pops)
        if ( on <= 0.0 ) continue;
        float es = (0.55 + 0.45 * ramp) * (0.7 + 0.6 * E1.z) * (0.4 + 0.9 * fz) * (on * (2.0 - on)) * (0.92 + 0.6 * (gust(t, e.x) - 0.06));
        // tongue heights vary: taller towards the heart of the fire, a few tall leaders, many short ones (never a picket fence)
        float eh = eh0 * (0.5 + 0.88 * fz) * (0.15 + 0.85 * on);   // (a dying patch's tongues SINK into the bed and thin out, never cut; A7: a weak patch's narrow more than they sink - never round drops)
        // SHEETS (A7): a lick wave along the bed makes neighbours rise and fall TOGETHER (never a comb); LEADERS (taller, wider,
        // slower) carry the crest, fork and tear pieces off
        float lw = sheetAt(t, e.x);
        bool leadN = E2.x < 0.16 && lvI >= 2, leadH = E2.x < 0.16 && lvH >= 2;
        float shHN = lvI >= 2 ? (leadN ? 0.75 + 0.4 * lw : 0.4 + 0.65 * lw) : 0.75 + 0.4 * lw, shWN = (leadN ? 1.3 : 1.0) * (0.9 + 0.3 * lw);
        float shHH = lvH >= 2 ? (leadH ? 0.75 + 0.4 * lw : 0.4 + 0.65 * lw) : 0.75 + 0.4 * lw, shWH = (leadH ? 1.3 : 1.0) * (0.9 + 0.3 * lw);
        // (exact cull: this emitter's tongue - its sheet height, a leader's torn piece - and its roots must reach the cell)
        float shHc = lvH != 0 ? max(shHN, shHH) : shHN, shWc = lvH != 0 ? max(shWN, shWH) : shWN;
        if ( c.y < e.y - (LRI * u * es * eh * shHc * 2.3 + r0 * es * shWc * (leadN || leadH ? 7.8 : 5.8)) - 1.0 || c.y > e.y + 4.5 * r0 * es * shWc + 2.0 * u ) continue;
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
          float dx = (c.x - p.x) / ((0.95 + 0.75 * E1.z) * rr), dy = (c.y - p.y) / (0.9 * rr); if ( dy > 0.0 ) dy *= 1.5;   // (A7: a little lower and narrower - a base, never a lump nor a sideways wing)
          float q = 1.0 - (dx * dx + dy * dy) / 2.2;
          if ( q > 0.0 ) { q *= q; rF += q; rY += q * e.y; rH += q * (0.6 + 0.5 * fz) * (0.5 + 0.5 * q) * (0.3 + 0.7 * outS); rB += q * (0.5 + 0.7 * fz) * outS; lvL = max(lvL, lv); }   // (sinking roots cool)
        }
        // the BLOBS: born every life / 5 / rate s (jittered), uneven lives, accelerating up, leaning, swaying, swelling then shrinking
        float lifeN = L_LIFE(lvI) * (leadN ? 1.3 : 1.0), lifeH = lvH != 0 ? L_LIFE(lvH) * (leadH ? 1.3 : 1.0) : lifeN;

        for ( int kk = 0; kk < 16; kk++ ) {
          if ( kk == 8 && lvH == 0 ) break;
          int k = kk & 7; if ( k >= uBirths ) continue;
          bool hs = kk >= 8, lead = hs ? leadH : leadN; float shH = hs ? shHH : shHN, shW = hs ? shWH : shWN;
          float life0 = hs ? lifeH : lifeN, iv = life0 / 5.0 / rate;
          int n = int(floor(t / iv)) - k;
          vec4 B1 = hb(id, n, 11);
          float tb = (float(n) + 0.6 * B1.x) * iv;
          if ( lvH != 0 && (hs ? tb >= tH : tb < tH) ) continue;
          if ( tb < t - ageI ) continue;                                  // born before the emitter caught
          if ( ageO > -1e3 && tb > t - ageO ) continue;                   // born after it went out: the last ones finish their lives
          float life = life0 * (0.6 + 0.8 * B1.y) * (0.8 + 0.4 * br);
          float a = (t - tb) / life;
          if ( a < 0.0 || a >= 1.0 ) continue;
          float size = es * (0.7 + 0.6 * B1.z) * (0.75 + 0.35 * br) * (0.15 + 0.85 * gE) * outS;
          float z = LRI * u * size * eh * shH * (0.6 + 0.8 * B1.w) * (0.3 + 0.7 * gE) * pow(a, 1.35);
          float r = r0 * size * shW * (a < 0.15 ? 0.3 + 4.667 * a : pow(1.0 - (a - 0.15) / 0.85, 0.8));   // (born small at the bed, swelling)
          if ( r < 0.6 ) continue;
          float y = e.y - z, sy = r * (1.3 + 1.1 * a);
          vec4 B2 = hb(id, n, 12);
          // a GUST bends the whole stretch: the lean grows with height (a curve, not a tilted stick)
          float gb = gust(t, e.x), lean = uLean + gdir * gb * (0.6 + 0.4 * B2.x) * (0.75 + 0.5 * min(1.0, z / (LRI * u)));
          float x = e.x + (B2.y - 0.5) * 3.0 * u + z * lean + 1.6 * u * a * sin(6.2832 * (1.2 * a + B2.z));
          // a leader's late blob TEARS OFF: its top piece rises on alone, a small pointed lick that shrinks away
          if ( lead && a > 0.55 && B2.w < 0.6 ) {
            float ta = (a - 0.55) / 0.45, tr = r * 0.45 * (1.0 - ta * ta), ty = y - sy * (0.55 + 0.9 * ta);
            if ( tr > 0.6 && c.y > ty - 3.0 * tr && c.y < ty + tr ) {
              float tdy = (c.y - ty) / (tr * 2.0), tdx = (c.x - x - z * 0.15 * lean) / (tr * max(0.15, 1.0 + 0.8 * min(tdy, 0.0) - 0.5 * max(tdy, 0.0)));
              if ( tdy > 0.0 ) tdy *= 1.4;
              float tq = 1.0 - (tdx * tdx + tdy * tdy) / 2.2;
              if ( tq > 0.0 ) { tq *= tq; rF += tq; rY += tq * e.y; tF += tq; tY += tq * e.y; rH += tq * 0.12; lvL = max(lvL, lv); }
            }
            sy *= 1.0 - 0.3 * ta;                                         // (what stays below is shorter)
          }
          if ( c.y < y - 1.5 * sy || c.y > y + sy ) continue;
          float dyn = (c.y - y) / sy;
          // FLAME-shaped, not an egg: the width narrows towards the top (a pointed tip on a broad base)
          float wq = r * (1.1 - 0.3 * a) * (1.0 + 0.45 * min(dyn, 0.0));
          float dx0 = c.x - x;
          // a leader FORKS: above its middle it splits into two uneven prongs that part with height (a real Y, never a comb)
          if ( lead && a > 0.3 && dyn < 0.0 ) {
            float sp2 = r * 0.5 * smoothstep(0.3, 0.8, a) * min(1.0, -dyn * 1.3);
            dx0 = abs(abs(dx0 - (B2.z - 0.5) * r * 0.4) - sp2);
            dyn *= 1.0 + 0.35 * (B1.x - 0.5) * sign(c.x - x);
          }
          float dx = dx0 / max(wq, 0.3), dy = dyn; if ( dy > 0.0 ) dy *= 1.5;
          float q = 1.0 - (dx * dx + dy * dy) / 2.2;
          if ( q > 0.0 ) { q *= q; rF += q; rY += q * e.y; tF += q; tY += q * e.y; rH += q * (1.0 - a) * (0.6 + 0.4 * q); lvL = max(lvL, lv); }   // (hot core, cool rim and top)
        }
      }
      // the union (silhouette) is the plain sum; the COLOUR is seen front first: a row further back shows through where the rows in
      // front are thin (between and above their tongues), so the bands flow across the body without per-tongue outlines
      F += rF; HT += TR * rH; BASE += TR * rB; WS += TR * rF; BY += TR * rY; TR *= exp(-2.2 * rF);
      // (DEPTH: the bed row whose TONGUES (not roots) first cover this cell front to back - a test on silhouettes, not a blend)
      CT += tF; if ( BF < 0.0 && CT >= 0.34 ) BF = tY / max(tF, 1e-4);
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
      // (core: how deep inside the un-eroded body; saturating (A7), so blob valleys draw no contour lines - only the silhouette cools)
      float core = smoothstep(0.34, 0.8, F);
      // A7 PALETTE: the body runs through four steps (red, orange, amber, yellow) by heat, depth and HEIGHT above its bed (the tops
      // cool to red, the base glows yellow); the outline (show pass) adds the dark red; the cream-white core only right over the embers
      float bedY = BF >= 0.0 ? BF : BY / max(WS, 1e-4), hAb = max(0.0, bedY - c.y);
      float hgt = clamp(hAb / (LVF(L_RISE, lvL) * u * 1.5), 0.0, 1.0);
      float st = vn(vec2(c.x / (5.0 * u) + 0.35 * sin(t * 0.9 + c.y / (17.0 * u)), (c.y + t * 24.0 * u) / (13.0 * u)), 41);   // (A7: one continuous field rising and swaying - it used to re-seed 3 times a second, a pop)
      // (rising lick streaks, stronger up the body: no flat slab on top; smaller fires burn redder)
      float v = 0.42 * heat + 0.3 * core + 0.2 * base + 0.2 - 0.5 * hgt + (st - 0.5) * (0.16 + 0.36 * hgt) - 0.1 * (3.0 - lvL);
      int band = 2 + int(clamp(v, 0.0, 0.999) * 4.0);                  // 2 red .. 5 yellow
      // (the body's floor is red, step 2: the dark red is the outline's alone)
      int lvLd = lvDith(lvL, rank(c + vec2(9.0, 5.0)));
      if ( lvLd >= 2 && band == 5 && hAb < 5.0 * u && base > 0.6 && core > 0.7 && st > 0.4 ) band = 6;   // (white only over the embers)
      // R: the bed row where this cell's flame STANDS (DEPTH), whole art px, ABSOLUTE mod 255 (+1; 0 = none) so a tongue holds one
      // value; the screen passes unwrap it and sort it against the tokens' feet
      R = 1 + int(mod(floor(((BF >= 0.0 ? BF : BY / max(WS, 1e-4)) - uOrg.y) / max(u, 0.25) + 0.5), 255.0)); G = band + 1 + 8 * (lvLd - 1);   // (R: area-local rows)                             // (one layer: the outline is the merged silhouette only)
    }
  }

  /* ---------------- BED: embers boiling in place; GROUND: char, heat tint ---------------- */
  vec4 ag = ages(ic);
  float dIn = aux.r > 0.5 ? dBed(ic, aux.r) : aux.r, dOut = aux.g;
  // (outside the bed: the clock and level of the NEAREST bed, probed across the gap - never the whole area's, which restarts when
  // any stroke of the area changes)
  vec4 agN = vec4(1e4, -1e4, 1e4, -1e4); float lvN = lvT;
  if ( dIn <= 0.5 && dOut > 0.5 && dOut < 0.8 * 32.0 * u ) {
    bool any = false; int dd = int(dOut + 1.5);
    for ( int k = 0; k < 8; k++ ) {
      float an = float(k) * 0.7854; ivec2 q = ic + ivec2(round(vec2(cos(an), sin(an)) * float(dd) * (k % 2 == 1 ? 1.42 : 1.0)));
      if ( !inArea(q) || fA(q).r <= 0.0 ) continue;
      vec4 aq = ages(q); float lq = lvNow(q);
      if ( !any ) { agN = aq; lvN = lq; any = true; } else { agN.x = max(agN.x, aq.x); agN.y = max(agN.y, aq.y); lvN = max(lvN, lq); }
    }
  }
  // (the beds differ: brighter and fuller in hot patches, broken in weak ones, some spilling wider - the fuel map and its G)
  vec2 fc = dIn > 0.5 || dOut < 0.75 * 32.0 * u ? fuelAt(c) : vec2(0.5);
  if ( dIn > 0.5 ) {
    float lvB = lvNow(ic); int lv = lvDith(lvB, rank(c + vec2(3.0, 11.0)));
    float growC = clamp(ag.x / max(0.3 * uDur.x, 0.01), 0.0, 1.0);    // the scorch spreads first, cluster by cluster
    float outA = ag.y;
    float endFade = outA > -1e3 ? clamp((outA - (uDur.z - 1.4)) / 1.2, 0.0, 1.0) : 0.0;   // the scar goes only at the very end
    float rampC = clamp(dIn / (0.28 * 32.0 * u), 0.0, 1.0);
    if ( rk < 0.15 + 0.85 * rampC && rk < growC * 1.4 && rk >= endFade ) A += lv;
    else if ( growC > 0.0 ) A += 4;                                       // (no char: the heat tint)
    if ( G == 0 ) {
      int cl = int(floor(c.x / (96.0 * u))) * 7 + int(floor(c.y / (96.0 * u))) * 13 + uSeed;
      float br = breath(t, cl);
      float share = LVF(L_EMB, lvB) * br * growC * (0.35 + 0.85 * fc.x + 0.6 * (fc.y - 0.5));
      if ( outA > -1e3 ) {
        share = mix(share, L_EMB(1) * br, clamp(outA / max(uDur.y, 0.01), 0.0, 1.0));          // the bed glows on, dimmer...
        if ( rk < clamp((outA - uDur.y - 0.8) / 1.2, 0.0, 1.0) ) share = 0.0;                 // ...then goes dark, cluster by cluster
      }
      float kf = t * 3.0, k0 = floor(kf), w = kf - k0; w = w * w * (3.0 - 2.0 * w);
      vec2 ep = c / vec2(4.5 * u, 3.6 * u);
      float ev = mix(vn(ep, 200 + (int(k0) & 511)), vn(ep, 200 + ((int(k0) + 1) & 511)), w) * 0.7 + vn(c / vec2(2.0 * u, 1.6 * u), 7) * 0.3;
      if ( dIn > 1.0 && share > 0.0 && ev > 1.0 - share * 0.9 && rk < rampC * (0.7 + fc.y) + 0.1 ) G = ev > 1.0 - share * 0.4 ? 26 : ev > 1.0 - share * 0.7 ? 25 : 24;
    }
  } else if ( dOut > 0.5 ) {
    float wT = LVF(L_TINT, lvN) * 32.0 * u;
    float tk = clamp(agN.x / max(uDur.x, 0.01), 0.0, 1.0) * (agN.y > -1e3 ? 1.0 - clamp((agN.y - 0.7 * uDur.z) / (0.3 * uDur.z), 0.0, 1.0) : 1.0);
    // A7 CREEPING CHAR: the scorch eats outwards from the bed while it burns (to ~0.45 square over ~15 s, a ragged front, slower where
    // the fire is weak), and stays as a scar until the very end of a go-out
    float crp = min(0.45, 0.03 * max(0.0, agN.x - 0.5 * uDur.x) * (0.6 + 0.5 * fc.x)) * 32.0 * u;
    float rag = 0.5 + 0.8 * vn(c / vec2(5.0 * u, 4.0 * u), 9) - 0.25 * vn(c / vec2(1.6 * u, 1.4 * u), 10);
    float endC = agN.y > -1e3 ? clamp((agN.y - (uDur.z - 1.4)) / 1.2, 0.0, 1.0) : 0.0;
    if ( dOut < crp * rag && rk >= endC ) A += dOut < 0.4 * crp * rag ? 2 : 1;
    else if ( dOut < wT && rk < (0.9 - (dOut + 0.6 * (rag - 0.6) * wT) / wT) * tk ) A += 4;   // (A7: its reach broken by the same noise: no dotted ruler line along a straight bed)
  }
  // A7 GROUND GLOW: the fire's light flickering on the ground - soft POOLS (3 steps, a slow drifting noise x the fuel x the breathing)
  // along the bed's rim, inside between the tongues and spilling past its edge; they swell, shrink and wander, never a dotted ring
  int glowL = 0;
  if ( dIn > 0.5 || (dOut > 0.5 && dOut < 0.7 * 32.0 * u) ) {
    int clG = int(floor(c.x / (96.0 * u))) * 7 + int(floor(c.y / (96.0 * u))) * 13 + uSeed;
    float brG = breath(t, clG), lvG = dIn > 0.5 ? lvNow(ic) : lvN;
    float on = dIn > 0.5 ? clamp(ag.x / max(uDur.x, 0.01), 0.0, 1.0) * (ag.y > -1e3 ? 1.0 - clamp(ag.y / max(uDur.y, 0.01), 0.0, 1.0) : 1.0)
                         : clamp(agN.x / max(uDur.x, 0.01), 0.0, 1.0) * (agN.y > -1e3 ? 1.0 - clamp(agN.y / max(uDur.y, 0.01), 0.0, 1.0) : 1.0);
    float kG = on * (0.35 + 0.75 * fc.x) * (0.55 + 0.45 * brG) * (0.6 + 0.2 * lvG);
    float pn = vn(vec2(c.x / (7.0 * u) + t * 0.15, c.y / (5.0 * u) - t * 0.05), 13);
    float wG = (0.15 + 0.35 * kG) * 32.0 * u;
    float gv = kG * (0.45 + 0.8 * pn) * (dIn > 0.5 ? 0.85 * (1.0 - smoothstep(0.0, 0.35 * 32.0 * u, dIn)) : 1.0 - dOut / wG);
    glowL = clamp(int(gv * 4.0), 0, 3);
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
      float lvC = dIn > 0.5 ? lvNow(ic) : lvN;
      float pC = LVF(L_COAL, lvC) * (dIn > 0.5 ? 1.5 - 0.9 * fc.x : 1.0 - dOut / wC) * clamp((dIn > 0.5 ? ag.x : agN.x) / max(0.6 * uDur.x, 0.01), 0.0, 1.0);
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
  // (a rising grid per layer: a cell finds its spark in O(1); its birth place below must be burning ground)
  bool nearSp = nearBed || dIn > 0.5;
  for ( int s = 1; s <= 3 && !nearSp && inBox && t > 0.0; s++ ) {                     // (sparks rise higher than the flames reach)
    ivec2 p = ivec2(floor(c + vec2(-(uLean + 0.6 * uWind.x), 1.0) * float(s) * 22.0 * u));
    if ( inArea(p) ) nearSp = fA(p).r > 0.0;
  }
  int gS = 0;                                                                         // (the spark found: G after the loop - a lighter link)
  if ( t > 0.0 && (G == 0 || (R > 0 && ((G - 1) & 7) <= 2)) && nearSp ) {
    float Wd = uLean + 0.6 * uWind.x;
    for ( int L = 0; L < 4; L++ ) {
      float S = SPK_S(L) * u, V = SPK_V(L) * u, life0 = SPK_L(L), P = life0 * 1.7;
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
      ivec2 sb = ivec2(floor(vec2(c.x - Wd * V * age, c.y + V * age + SPK_H(L) * LVF(L_RISE, lvT) * u)));
      if ( !inArea(sb) ) continue;
      float dB = fA(sb).r * 255.0;
      if ( dB < 0.5 ) continue;
      dB = dBed(sb, dB);
      float lvS = lvAt(sb, age);
      vec4 agS = ages(sb);
      if ( agS.x < age + 0.3 || (agS.y > -1e3 && agS.y > age) ) continue;             // (born while that ground burned)
      float heatK = 0.35 + 0.65 * clamp(dB / (0.6 * 32.0 * u), 0.0, 1.0);
      float gustK = 0.7 + 1.6 * gust(t - age, c.x);
      if ( J.w > SPK_Df(L, lvS) * heatK * gustK * float(uBirths) / 8.0 ) continue;
      float a = age / life, s0 = H.y < 0.25 ? 6.0 : H.y < 0.7 ? 5.0 : 4.0;
      int step = int(floor((s0 + 0.99) * (1.0 - a * a * 0.55 - a * 0.15)));              // (white / yellow, orange, red, dark, gone)
      if ( a < 0.12 ) step = min(step, 1 + int(floor(s0 * a / 0.12)));                    // (it IGNITES: dark red up to its flare)
      if ( step < 1 ) continue;
      gS = 32 + step;
      break;
    }
  }
  if ( gS > 0 ) G = gS;
  // A7 SPARK BURSTS: a HOT SPOT pops a fan of sparks that slow, then ride the heat up; sites on a coarse lattice, uneven slots
  // (~40 % burst, hot ground only); a cell looks at the few sites that could reach it
  if ( t > 0.0 && inBox && nearSp && (G == 0 || (R > 0 && ((G - 1) & 7) <= 2)) ) {
    float SX = 36.0 * u, SY = 28.0 * u, PB = 2.6, Wd = uLean + 0.6 * uWind.x;
    int sx0 = int(floor((c.x - 18.0 * u) / SX)), sx1 = int(floor((c.x + 18.0 * u) / SX));
    int sy0 = int(floor((c.y - 4.0 * u) / SY)), sy1 = int(floor((c.y + 36.0 * u) / SY));
    for ( int sy = sy0; sy <= sy1 && G < 32; sy++ ) for ( int sx = sx0; sx <= sx1 && G < 32; sx++ ) {
      vec4 S0 = hb(sx, sy, 520);
      // (one slot: a burst lives 1.15 s and starts in the slot's first half, so it never reaches into the next slot)
      float k = floor((t - S0.x * PB) / PB);
      {
        vec4 S1 = hb(sx + int(k) * 7919, sy, 521);
        if ( S1.x > 0.4 ) continue;
        float tb = (k + 0.5 * S1.y) * PB + S0.x * PB, age = t - tb;
        if ( age < 0.0 || age > 1.15 ) continue;
        vec2 o = (vec2(float(sx), float(sy)) + 0.15 + 0.7 * S1.zw) * vec2(SX, SY);
        ivec2 oi = ivec2(floor(o));
        if ( !inArea(oi) || fA(oi).r <= 0.0 ) continue;
        vec4 agB = ages(oi);
        if ( agB.x < age + 0.3 || (agB.y > -1e3 && agB.y > age) ) continue;
        if ( fuelAt(o).x < 0.5 ) continue;                               // (hot spots only)
        float lvB2 = lvAt(oi, age); int nS = 7 + int(floor(2.0 * (lvB2 - 1.0) + (fract(lvB2) > 0.0 ? fract(S0.z + float(k) * 0.618) : 0.0)));
        for ( int m = 0; m < 11; m++ ) {
          if ( m >= nS ) break;
          vec4 M1 = hb(sx * 31 + m, sy + int(k) * 131, 522);
          float life = 0.5 + 0.6 * M1.z; if ( age > life ) continue;
          float an = -1.5708 + (M1.x - 0.5) * 1.9, v = (28.0 + 30.0 * M1.y) * u, tau = 0.22;
          float d = v * tau * (1.0 - exp(-age / tau)), rise = 14.0 * u * age * age;
          vec2 sp = o + vec2(cos(an), sin(an)) * d + vec2(Wd * rise, -rise);
          if ( abs(c.x - sp.x) > 0.5 || abs(c.y - sp.y) > 0.5 ) continue;
          float a = age / life;
          int step = int(floor(6.99 * (1.0 - 0.7 * a * a - 0.2 * a)));
          if ( step < 1 ) continue;
          G = 32 + min(step, 6);
          break;
        }
      }
    }
  }
  // A7 HEAT SHIMMER: the air above the flames trembles - thin wavy streaks rising over the burning ground, a light one and a dark one
  // (refraction read as pixel art), strongest just above the tongues, fading upwards and at the sides; only on empty cells
  int shim = 0;
  if ( t > 0.0 && inBox && G == 0 && R == 0 && dIn <= 0.5 ) {
    float Hs = LVF(L_RISE, lvT) * u * 2.6, dyB = -1.0; float Wd = uLean + 0.4 * uWind.x;
    for ( int s = 1; s <= 3 && dyB < 0.0; s++ ) {
      float dy = Hs * float(s) / 3.0;
      ivec2 p = ivec2(floor(c + vec2(-Wd * dy, dy)));
      if ( inArea(p) && fA(p).r > 0.0 ) { vec4 aS = ages(p); if ( aS.x > 1.0 && aS.y < -1e3 ) dyB = dy; }
    }
    if ( dyB > 0.0 ) {
      float h = dyB / Hs, fz = fuelAt(c + vec2(0.0, dyB)).x;
      float k = smoothstep(0.2, 0.45, h) * (1.0 - smoothstep(0.7, 1.0, h)) * (0.4 + 0.6 * fz);
      float xw = c.x + 1.8 * u * sin(c.y / (5.0 * u) + t * 9.0) + 0.9 * u * sin(c.y / (2.3 * u) - t * 13.0);
      float sf = fract(xw / (7.0 * u) + 0.13 * lvT);
      float seg = vn(vec2(c.x / (6.0 * u), (c.y + t * 30.0 * u) / (8.0 * u)), 55);
      if ( seg > 1.0 - 0.75 * k ) shim = sf < 0.16 ? 1 : (sf > 0.5 && sf < 0.6) ? 2 : 0;
    }
  }

  // (A7: the heat shimmer - G 40 light, 41 dark - and the ground glow pools - G 42..44 - only on cells nothing else drew)
  if ( G == 0 && R == 0 ) { if ( shim > 0 ) G = 39 + shim; else if ( glowL > 0 ) G = 41 + glowL; }
  oArt = vec4(float(R), float(G), float(B), float(A)) / 255.0;
}`;
const ART_S = `${ART_HEAD}${ART_TOP}
  if ( fld.g == 0.0 ) discard;                     // (no puff can reach the cell: no smoke, no shadow - ART_F's cell stands)
${ART_TILES}
  /* ---------------- SMOKE: lit puffs from the sources ---------------- */
  // (only near the plume: the model's plume field says where smoke can be, never what its silhouette is)
  float R1m = S_R1(3) * u * 1.25;
  // (the puff mask marks every cell a puff can cover - model.puffMask: its drift cone and its size, conservative - so this cheap gate
  // never cuts the smoke)
  bool smk = fld.g > 0.0;
  if ( smk ) {
    float sps = 22.0 * u, spys = sps * RY, Hk = uPlume / 2.5;
    float zTop = 1.0 * L_RISE(3) * u + S_V0(3) * u * Hk * 1.5 * 1.35 * TAU + R1m;
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
    float F = 0.0, AG = 0.0, QB = -1e9, hzB = 0.0; vec2 nB = vec2(0.0), GR = vec2(0.0); int lsB = 2; bool lowB = false, own = false, frB = false, drB = false, fiB = false;
    // the FLOW: a smooth warp field that rises and drifts with the smoke - every edge rolls and curls over itself, no lobe stays a
    // circle; the same field turns the shading (the rolls inside the mass follow the curls of its silhouette)
    vec2 fp = vec2(c.x - (0.6 * uWind.x + 0.12 * gdir) * 10.0 * u * t, c.y + 10.0 * u * t) / (11.0 * u);
    vec3 fg = vnd(fp, 611);
    vec2 wv = clamp(vec2(fg.z, -fg.y) * 0.33, -0.5, 0.5);           // (CURL of a noise: it swirls, it never bunches up)
    vec2 cw = c + wv * 8.0 * u;
    for ( int jj = max(0, jHi - tlS.y); jj < 40; jj++ ) {
      int j = jHi - jj; if ( j < jLo || j < tlS.x ) break;
      float dyc = max(0.0, float(j) * spys - c.y);
      float xlo = c.x - max(0.0, rMax * dyc) - pad, xhi = c.x - min(0.0, rMin * dyc) + pad;   // (the puffs shear along the wind)
      int i0 = int(floor(max(xlo, xS0) / sps - 0.5)), i1 = int(floor(min(xhi, xS1) / sps - 0.5)) + 1;
      for ( int ii = max(0, tlS.z - i0); ii < 16; ii++ ) {
        int i = i0 + ii; if ( i > i1 || i > tlS.w ) break;
        // (A8: this source's box this frame, in the warped cell's frame - its puffs' cull boxes)
        ivec2 et = ivec2(i - uEB.z, j - uEB.w);
        if ( et.x < 0 || et.y < 0 || et.x >= uEN.z || et.y >= uEN.w ) continue;
        vec4 bx = boxDec(texelFetch(uEmb, ivec2(uEN.x + et.x, et.y), 0), vec2(float(i) * sps, float(j) * spys), QS * u);
        if ( cw.x < bx.x || cw.x > bx.z || cw.y < bx.y || cw.y > bx.w ) continue;
        vec2 e = vec2((float(i) + 0.5) * sps, (float(j) + 0.5) * spys);
        ivec2 ei = ivec2(floor(e));
        if ( !inArea(ei) ) continue;
        vec4 sa = fA(ei) * 255.0;
        if ( sa.b < 5.0 ) continue;
        int code = int(sa.a + 0.5), ls = clamp(code & 3, 1, 3);
        bool fromFire = code >= 4;
        float src = sa.b / 255.0;
        float rate = S_RATE(ls) / 3.6 * (sps * spys) / (1024.0 * u * u), iv = 1.0 / max(rate, 0.05);
        float lvE = levelAt(ei); vec4 rq = rampTx(ei), rpq = rampPx(ei); float l0E = rq.r > 0.5 ? lvDec(rq.r) : lvE, lHi = max(lvE, l0E), lLo = min(lvE, l0E);
        if ( rpq.r > 0.5 ) { lHi = max(lHi, max(lvDec(rpq.r), lvDec(rpq.b))); lLo = min(lLo, min(lvDec(rpq.r), lvDec(rpq.b))); }
        float z0 = fromFire ? 1.0 * LVF(L_RISE, lHi) * u : 2.0 * u, z0m = fromFire ? 1.0 * LVF(L_RISE, lLo) * u : 2.0 * u;
        float lifeS = S_LIFE(ls);
        float v0 = S_V0(ls) * u * Hk * 1.5;
        vec4 ag2 = ages(ei);
        // which births can be at this height now: invert z(age) (the rise only depends on the age)
        float rr1 = S_R1(ls) * u * 1.35 + 4.5 * u, dz = e.y - c.y;
        // (a fire's smoke is not only above its flames: some puffs rise from BETWEEN the tongues, from low over the bed)
        float z0lo = fromFire ? 0.2 * z0m : z0;
        float zl = max(z0lo, dz - rr1 - spys), zh = dz + rr1 + spys;
        float zMax = z0 + v0 * 1.35 * TAU * 0.999;
        if ( zl > zMax ) continue;
        // (the fastest puffs, x 1.35, reach a height soonest; the slowest, x 0.65, latest)
        float aLo = -TAU * log(max(1e-4, 1.0 - max(0.0, zl - z0) / (1.35 * v0 * TAU)));
        float aHi = zh >= z0lo + 0.65 * v0 * TAU * 0.999 ? lifeS * 1.3 : -TAU * log(max(1e-4, 1.0 - (zh - z0lo) / (0.65 * v0 * TAU)));
        aHi = min(aHi, lifeS * 1.3);
        int nLo = int(floor((t - aHi) / iv)) - 1, nHi = int(floor((t - aLo) / iv));
        int eid = i * 977 + j * 3163;
        vec2 Ls = vec2(float(i) * sps, float(j) * spys);
        for ( int kk2 = 0; kk2 < 8; kk2++ ) {
          int n = nHi - kk2; if ( n < nLo ) break;
          // (A8: this puff's cull box this frame - EMB, the source's slot n & 15)
          vec4 pb = boxDec(texelFetch(uEmb, ivec2(uEN.x + uEN.z + et.x * 16 + (n & 15), et.y), 0), Ls, QS * u);
          if ( cw.x < pb.x || cw.x > pb.z || cw.y < pb.y || cw.y > pb.w ) continue;
          vec4 P1 = hb(eid, n, 59);
          float tb = (float(n) + 0.7 * P1.y) * iv, age = t - tb, lB = rq.r > 0.5 ? lvRamp(lvE, rq, rpq, age) : lvE;   // (lB: its level at birth)
          if ( P1.x > (rq.r > 0.5 ? srcAt(sa.b, rq, rpq, age, lB) : src) ) continue;                                    // a weak source: fewer puffs (whole shapes, never holes)
          if ( age < 0.0 ) continue;
          float z0p = rq.r > 0.5 && fromFire ? LVF(L_RISE, lB) * u : z0;
          if ( tb < t - ag2.z ) continue;                                 // before the smoke started
          // after it stopped the last puffs drift off - and the source does not stop all at once: each puff has its own last moment
          // (up to 1.8 s early) and the last ones are smaller, so the column's foot frays out instead of lifting off as a flat line
          float dS = ag2.w > -1e3 ? t - ag2.w - tb : 1e4;
          if ( dS < 1.8 * fract(P1.y * 7.31 + P1.z * 3.17) ) continue;
          float life = lifeS * (0.7 + 0.6 * P1.z), a = age / life;
          if ( a >= 1.0 ) continue;
          float build = clamp((ag2.z - age) / 2.0, 0.0, 1.0);            // the first puffs are wisps, building up over ~2 s
          float vj = v0 * (0.65 + 0.7 * P1.w);                // every puff its own speed: no flat ceiling
          float zb = fromFire && fract(P1.x * 13.7) < 0.4 ? z0p * (0.2 + 0.6 * fract(P1.y * 7.3)) : z0p;   // (low puffs: among the tongues)
          bool front = fract(P1.z * 11.1) < 0.45;                         // (some smoke curls in front of the flames, some behind)
          // (a few of the front puffs are DENSE DRIFTS: they really cover the flames for a moment as they pass, lit from below)
          bool drift = front && fract(P1.w * 17.3) < 0.4;
          float z = zb + vj * TAU * (1.0 - exp(-age / TAU));
          vec4 P2 = hb(eid, n, 62);
          vec2 o0 = e + (P2.xy - 0.5) * vec2(sps, spys);
          float g = gust(t, o0.x);
          float x = o0.x + z * (0.6 * uWind.x + 0.12 * gdir * (1.0 + 0.8 * g)) + 2.5 * u * sin(6.2832 * (0.35 * age + P2.z));
          float y = o0.y - z + 0.5 * uWind.y * z;
          float r = (S_R0(ls) + (S_R1(ls) - S_R0(ls)) * min(1.0, a / 0.55)) * u * (0.45 + 0.55 * build) * (0.8 + 0.4 * P2.w)
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
          bool low = fromFire && z < z0p + 0.8 * L_RISE(2) * u && a < 0.5 && (ag2.y < -1e3 || ag2.y < 0.4 * uDur.y);
          // (AT NIGHT the fire is the light: its smoke is lit from below while the flames under it burn, the more the lower it is)
          bool fLit = fromFire && (ag2.y < -1e3 || ag2.y < 0.6 * uDur.y);
          float hz = fLit ? clamp(1.0 - (z - z0p) / (2.2 * L_RISE(2) * u), 0.0, 1.0) : 0.0;
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
            if ( d2 < min(1.0, 1.5 * env) && dep > QB ) { QB = dep; nB = dd / sqrt(max(min(1.0, 1.5 * env), 0.05)); lsB = ls; lowB = low; frB = front; drB = drift; fiB = fLit; hzB = hz; own = true; }
            if ( q > 0.0 ) { GR += env * sqrt(q) * dd / lr; q *= q * env; F += q; AG += q * a; if ( !own ) { lsB = ls; lowB = low; frB = front; drB = drift; fiB = fLit; hzB = hz; } }
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
        // NIGHT SHADING (A bits 5-6, the smoke layer blends it in with the darkness): a burning fire's smoke lit from BELOW - the
        // side facing the flames and the low puffs warm (1 underside, 2 warm-dim), the tops and the high column dark (3)
        if ( fiB ) {
          float litF = dot(n3, normalize(vec3(0.1, 0.8, 0.55)));
          float w = 0.55 * litF + 0.85 * hzB - 0.3;
          A += 32 * (w > 0.5 ? 1 : w > 0.08 ? 2 : 3);
        }
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
        float src = sa.b / 255.0, rate = S_RATE(ls) / 3.6 * (sps * spys) / (1024.0 * u * u), iv = 1.0 / max(rate, 0.05);
        int eid = i * 977 + j * 3163, nH = int(floor(t / iv));
        vec4 ag2 = ages(ei);
        bool fromFire = int(sa.a + 0.5) >= 4;
        float lvE = levelAt(ei); vec4 rq = rampTx(ei), rpq = rampPx(ei); float l0E = rq.r > 0.5 ? lvDec(rq.r) : lvE, lHi = max(lvE, l0E), lLo = min(lvE, l0E);
        if ( rpq.r > 0.5 ) { lHi = max(lHi, max(lvDec(rpq.r), lvDec(rpq.b))); lLo = min(lLo, min(lvDec(rpq.r), lvDec(rpq.b))); }
        float z0 = fromFire ? 1.0 * LVF(L_RISE, lHi) * u : 2.0 * u, z0m = fromFire ? 1.0 * LVF(L_RISE, lLo) * u : 2.0 * u;
        float v0 = S_V0(ls) * u * Hk * 1.5;
        for ( int k = 0; k < 6; k++ ) {
          int n = nH - k;
          vec4 P1 = hb(eid, n, 59);
          float tb = (float(n) + 0.7 * P1.y) * iv, age = t - tb, lB = rq.r > 0.5 ? lvRamp(lvE, rq, rpq, age) : lvE;   // (lB: its level at birth)
          if ( P1.x > (rq.r > 0.5 ? srcAt(sa.b, rq, rpq, age, lB) : src) ) continue;
          if ( age < 0.0 || tb < t - ag2.z || (ag2.w > -1e3 && t - ag2.w - tb < 1.8 * fract(P1.y * 7.31 + P1.z * 3.17)) ) continue;
          float life = S_LIFE(ls) * (0.7 + 0.6 * P1.z), a = age / life;
          if ( a >= 1.0 ) continue;
          float z = (rq.r > 0.5 && fromFire ? LVF(L_RISE, lB) * u : z0) + v0 * (0.65 + 0.7 * P1.w) * TAU * (1.0 - exp(-age / TAU));
          vec4 P2 = hb(eid, n, 62);
          vec2 o0 = e + (P2.xy - 0.5) * vec2(sps, spys);
          float x = o0.x + z * (0.6 * uWind.x + 0.12 * gdir) + z * 0.25;
          float r = (S_R0(ls) + (S_R1(ls) - S_R0(ls)) * min(1.0, a / 0.55)) * u * 0.9;
          vec2 dd = vec2((c.x - x) / r, (c.y - o0.y - 2.0 * u) / (r * RY));
          float ef = edgeFade(vec2(x, o0.y + 2.0 * u), vec2(r, r * RY) + 2.0, u);
          if ( dot(dd, dd) < 0.8 && rk < 0.55 * ef * smoothstep(0.0, 0.24, a) * (1.0 - 0.55 * smoothstep(0.45, 0.8, a)) * (1.0 - smoothstep(0.8, 1.0, a)) ) { A = (A & 103) + 8 * (ls == 3 ? 2 : 1); }
        }
      }
    }
  }
  if ( B == 0 && A == 0 ) discard;
  oArt = vec4(float(R), float(G), float(B), float(A)) / 255.0;
}`;

/* ======================================================================== A8 pass 1a: EMB, each emitter's / source's box (tiny) */
// One fragment per flame emitter (lattice i, j), per smoke source and per source's puff slot (16: the births n & 15): everything the art pass does per emitter that does not depend on
// the cell (the same lines, kept in step with the art pass), then the box of what it draws this frame - its roots, each live blob
// (with a leader's fork and torn piece), each live puff's lobes. Rounded outwards: a box is never smaller than what is drawn.
const EMB = `${ART_HEAD}
uniform ivec4 uEB;
uniform ivec4 uEN;
const float QF = 2.0, QS = 4.0;
const vec4 NOBOX = vec4(1e9, 1e9, -1e9, -1e9), ANYBOX = vec4(-1e9, -1e9, 1e9, 1e9);
vec4 grow(vec4 b, float x0, float y0, float x1, float y1) { return vec4(min(b.x, x0), min(b.y, y0), max(b.z, x1), max(b.w, y1)); }
vec4 boxEnc(vec4 b, vec2 L, float Q) {
  if ( b.x > b.z ) return vec4(255.0, 255.0, 0.0, 0.0) / 255.0;            // (draws nothing: an empty box)
  return clamp(vec4(floor((b.xy - L) / Q) - 1.0, ceil((b.zw - L) / Q) + 1.0) + 128.0, 0.0, 255.0) / 255.0;
}
vec4 boxFlame(int i, int j) {
  float u = uU, t = uTime, gdir = uWind.x < -0.05 ? -1.0 : 1.0;
  float sp = 32.0 * u / sqrt(L_DENS(3)), spy = sp * RY;
  vec4 E1 = hb(i, j, 1);
  vec2 e = vec2((float(i) + E1.x) * sp, (float(j) + E1.y) * spy);
  ivec2 ei = ivec2(floor(e));
  if ( !inArea(ei) ) return NOBOX;
  float d = fA(ei).r * 255.0;
  if ( d < 0.5 ) return NOBOX;
  d = dBed(ei, d);
  vec4 E2 = hb(i, j, 2);
  float lv, lvO, kL, tH; int lvI, lvH;
  emLevel(ei, i, j, lv, lvO, kL, lvI, lvH, tH);
  if ( E2.y >= max(LVF(L_DENS, lv), LVF(L_DENS, lvO)) / L_DENS(3) * 1.44 ) return NOBOX;
  float LD = mix(LVF(L_DENS, lvO), LVF(L_DENS, lv), kL), LR = mix(LVF(L_R, lvO), LVF(L_R, lv), kL), LRI = mix(LVF(L_RISE, lvO), LVF(L_RISE, lv), kL);
  float ramp = clamp(d / (0.35 * 32.0 * u), 0.0, 1.0);
  float r0 = LR * u;
  float hR = clamp(d / (0.9 * 32.0 * u), 0.0, 1.0);
  float eh0 = (0.5 + 0.65 * hR) * (0.55 + 0.95 * pow(E1.w, 1.6)) * (E2.x < 0.12 ? 1.25 : 1.0);
  float fz = max(fuelAt(e).x, 0.07 * (lv - 1.0));
  float thr = LD / L_DENS(3) * (0.25 + 0.75 * ramp) * (0.04 + 1.4 * fz);
  float on = clamp((thr - E2.y) / 0.14, 0.0, 1.0);
  if ( on <= 0.0 ) return NOBOX;
  float es = (0.55 + 0.45 * ramp) * (0.7 + 0.6 * E1.z) * (0.4 + 0.9 * fz) * (on * (2.0 - on)) * (0.92 + 0.6 * (gust(t, e.x) - 0.06));
  float eh = eh0 * (0.5 + 0.88 * fz) * (0.15 + 0.85 * on);
  float lw = sheetAt(t, e.x);
  bool leadN = E2.x < 0.16 && lvI >= 2, leadH = E2.x < 0.16 && lvH >= 2;
  float shHN = lvI >= 2 ? (leadN ? 0.75 + 0.4 * lw : 0.4 + 0.65 * lw) : 0.75 + 0.4 * lw, shWN = (leadN ? 1.3 : 1.0) * (0.9 + 0.3 * lw);
  float shHH = lvH >= 2 ? (leadH ? 0.75 + 0.4 * lw : 0.4 + 0.65 * lw) : 0.75 + 0.4 * lw, shWH = (leadH ? 1.3 : 1.0) * (0.9 + 0.3 * lw);
  float rate = 0.8 + 0.5 * E2.z;
  int id = i * 131 + j * 7919;
  vec4 ag = ages(ei);
  float ageI = ag.x, ageO = ag.y;
  float outS = 1.0;
  if ( ageO > -1e3 ) {
    float stg = (ramp * 0.6 + 0.2 * E2.w) * uDur.y;
    outS = 1.0 - 0.7 * clamp(ageO / max(stg, 0.25 * uDur.y), 0.0, 1.0);
    ageO -= stg;
  }
  if ( ageI <= 0.0 ) return NOBOX;
  float gE = clamp(ageI / max(uDur.x, 0.01), 0.0, 1.0); gE *= 2.0 - gE;
  int cl = int(floor(e.x / (96.0 * u))) * 7 + int(floor(e.y / (96.0 * u))) * 13 + uSeed;
  float br = breath(t, cl);
  float rootK = ageO > -1e3 ? 1.0 - clamp(ageO / max(0.5 * uDur.y, 0.01), 0.0, 1.0) : 1.0;
  float rb = r0 * es * (0.9 + 0.25 * br + 0.15 * sin(t * 2.1 + float(id))) * rootK * gE;
  vec4 bb = NOBOX;
  for ( int k = 0; k < 2; k++ ) {
    float rr = rb * (0.75 - 0.15 * float(k)); if ( rr < 0.6 ) continue;
    vec2 p = vec2(e.x + (float(k) - 0.5 + (E2.w - 0.5) * 0.8) * rb * 0.9 + 0.8 * u * sin(t * (1.3 + float(k)) + float(id) * 0.7), e.y - rb * 0.1 - float(k) * 1.5 * u);
    float hx = 1.4833 * (0.95 + 0.75 * E1.z) * rr, hy = 1.4833 * 0.9 * rr;      // (q > 0: dx^2 + dy^2 < 2.2; below, dy x 1.5)
    bb = grow(bb, p.x - hx, p.y - hy, p.x + hx, p.y + hy / 1.5);
  }
  float lifeN = L_LIFE(lvI) * (leadN ? 1.3 : 1.0), lifeH = lvH != 0 ? L_LIFE(lvH) * (leadH ? 1.3 : 1.0) : lifeN;

  for ( int kk = 0; kk < 16; kk++ ) {
    if ( kk == 8 && lvH == 0 ) break;
    int k = kk & 7; if ( k >= uBirths ) continue;
    bool hs = kk >= 8, lead = hs ? leadH : leadN; float shH = hs ? shHH : shHN, shW = hs ? shWH : shWN;
    float life0 = hs ? lifeH : lifeN, iv = life0 / 5.0 / rate;
    int n = int(floor(t / iv)) - k;
    vec4 B1 = hb(id, n, 11);
    float tb = (float(n) + 0.6 * B1.x) * iv;
    if ( lvH != 0 && (hs ? tb >= tH : tb < tH) ) continue;
    if ( tb < t - ageI ) continue;
    if ( ageO > -1e3 && tb > t - ageO ) continue;
    float life = life0 * (0.6 + 0.8 * B1.y) * (0.8 + 0.4 * br);
    float a = (t - tb) / life;
    if ( a < 0.0 || a >= 1.0 ) continue;
    float size = es * (0.7 + 0.6 * B1.z) * (0.75 + 0.35 * br) * (0.15 + 0.85 * gE) * outS;
    float z = LRI * u * size * eh * shH * (0.6 + 0.8 * B1.w) * (0.3 + 0.7 * gE) * pow(a, 1.35);
    float r = r0 * size * shW * (a < 0.15 ? 0.3 + 4.667 * a : pow(1.0 - (a - 0.15) / 0.85, 0.8));
    if ( r < 0.6 ) continue;
    float y = e.y - z, sy = r * (1.3 + 1.1 * a);
    vec4 B2 = hb(id, n, 12);
    float gb = gust(t, e.x), lean = uLean + gdir * gb * (0.6 + 0.4 * B2.x) * (0.75 + 0.5 * min(1.0, z / (LRI * u)));
    float x = e.x + (B2.y - 0.5) * 3.0 * u + z * lean + 1.6 * u * a * sin(6.2832 * (1.2 * a + B2.z));
    if ( lead && a > 0.55 && B2.w < 0.6 ) {
      float ta = (a - 0.55) / 0.45, tr = r * 0.45 * (1.0 - ta * ta), ty = y - sy * (0.55 + 0.9 * ta);
      float tx = x + z * 0.15 * lean;
      if ( tr > 0.6 ) bb = grow(bb, tx - 1.4833 * tr, ty - 3.0 * tr, tx + 1.4833 * tr, ty + tr);   // (its width factor is at most 1)
      sy *= 1.0 - 0.3 * ta;
    }
    // (the blob: y - 1.5 sy .. y + sy; across, its width (at most r (1.1 - 0.3 a), at least 0.3) x sqrt(2.2), + a leader's fork)
    float hw = 1.4833 * max(r * (1.1 - 0.3 * a), 0.3) + (lead && a > 0.3 ? abs(B2.z - 0.5) * r * 0.4 + r * 0.5 : 0.0);
    bb = grow(bb, x - hw, y - 1.5 * sy, x + hw, y + sy);
  }
  return bb.x > bb.z ? bb : bb + vec4(-1.0, -1.0, 1.0, 1.0);
}
vec4 boxSmoke(int i, int j, int slot) {
  float u = uU, t = uTime, gdir = uWind.x < -0.05 ? -1.0 : 1.0;
  float sps = 22.0 * u, spys = sps * RY, Hk = uPlume / 2.5;
  vec2 e = vec2((float(i) + 0.5) * sps, (float(j) + 0.5) * spys);
  ivec2 ei = ivec2(floor(e));
  if ( !inArea(ei) ) return NOBOX;
  vec4 sa = fA(ei) * 255.0;
  if ( sa.b < 5.0 ) return NOBOX;
  int code = int(sa.a + 0.5), ls = clamp(code & 3, 1, 3);
  bool fromFire = code >= 4;
  float src = sa.b / 255.0;
  float rate = S_RATE(ls) / 3.6 * (sps * spys) / (1024.0 * u * u), iv = 1.0 / max(rate, 0.05);
  float lvE = levelAt(ei); vec4 rq = rampTx(ei), rpq = rampPx(ei); float l0E = rq.r > 0.5 ? lvDec(rq.r) : lvE, lHi = max(lvE, l0E), lLo = min(lvE, l0E);
  if ( rpq.r > 0.5 ) { lHi = max(lHi, max(lvDec(rpq.r), lvDec(rpq.b))); lLo = min(lLo, min(lvDec(rpq.r), lvDec(rpq.b))); }
  float z0 = fromFire ? 1.0 * LVF(L_RISE, lHi) * u : 2.0 * u, z0m = fromFire ? 1.0 * LVF(L_RISE, lLo) * u : 2.0 * u;
  float lifeS = S_LIFE(ls);
  float v0 = S_V0(ls) * u * Hk * 1.5;
  vec4 ag2 = ages(ei);
  // (every birth the art pass can look at: ages 0 .. 1.3 x the life, + a margin; one SLOT = the births n with n & 15 == slot: the
  // window must hold each slot once, with room for the art pass's own rounding of it)
  int nHi = int(floor(t / iv)) + 1, nLo = int(floor((t - lifeS * 1.3) / iv)) - 2;
  if ( nHi - nLo > (slot < 0 ? 30 : 13) ) return ANYBOX;
  int eid = i * 977 + j * 3163;
  vec4 bb = NOBOX;
  for ( int kk2 = 0; kk2 < 32; kk2++ ) {
    int n = nHi - kk2; if ( n < nLo ) break;
    if ( slot >= 0 && (n & 15) != slot ) continue;
    vec4 P1 = hb(eid, n, 59);
    float tb = (float(n) + 0.7 * P1.y) * iv, age = t - tb, lB = rq.r > 0.5 ? lvRamp(lvE, rq, rpq, age) : lvE;   // (lB: its level at birth)
    if ( P1.x > (rq.r > 0.5 ? srcAt(sa.b, rq, rpq, age, lB) : src) ) continue;
    if ( age < 0.0 ) continue;
    float z0p = rq.r > 0.5 && fromFire ? LVF(L_RISE, lB) * u : z0;
    if ( tb < t - ag2.z ) continue;
    float dS = ag2.w > -1e3 ? t - ag2.w - tb : 1e4;
    if ( dS < 1.8 * fract(P1.y * 7.31 + P1.z * 3.17) ) continue;
    float life = lifeS * (0.7 + 0.6 * P1.z), a = age / life;
    if ( a >= 1.0 ) continue;
    float build = clamp((ag2.z - age) / 2.0, 0.0, 1.0);
    float vj = v0 * (0.65 + 0.7 * P1.w);
    float zb = fromFire && fract(P1.x * 13.7) < 0.4 ? z0p * (0.2 + 0.6 * fract(P1.y * 7.3)) : z0p;
    float z = zb + vj * TAU * (1.0 - exp(-age / TAU));
    vec4 P2 = hb(eid, n, 62);
    vec2 o0 = e + (P2.xy - 0.5) * vec2(sps, spys);
    float g = gust(t, o0.x);
    float x = o0.x + z * (0.6 * uWind.x + 0.12 * gdir * (1.0 + 0.8 * g)) + 2.5 * u * sin(6.2832 * (0.35 * age + P2.z));
    float y = o0.y - z + 0.5 * uWind.y * z;
    float r = (S_R0(ls) + (S_R1(ls) - S_R0(ls)) * min(1.0, a / 0.55)) * u * (0.45 + 0.55 * build) * (0.8 + 0.4 * P2.w)
            * (0.55 + 0.45 * clamp(dS / 1.8, 0.0, 1.0));
    float strx = 1.0 + (0.1 + 0.45 * a) * (0.3 + 2.0 * abs(0.6 * uWind.x + 0.12 * gdir * (1.0 + 0.8 * g)));
    vec2 hb2 = vec2(r * (0.87 + 1.2 * strx), r * 1.85) + 2.0;
    // (what it draws: its lobes - each covers (cw - l) / lr inside sqrt(1.6), x stretched - within its cull box)
    int nl = 3;
    vec4 P3 = hb(eid, n, 70), P4 = hb(eid, n, 75); float p75 = P4.w;
    float env = smoothstep(0.0, 0.24, a) * (1.0 - smoothstep(0.55, 1.0, a));
    env *= edgeFade(vec2(x, y), hb2 + 4.0 * u, u);
    if ( env <= 0.0 ) continue;
    vec4 lb = NOBOX;
    for ( int k = 0; k < 4; k++ ) {
      if ( k >= nl ) break;
      float ang = P3[k] * 6.2832 + a * (1.5 + p75);
      float tear = k == nl - 1 ? 1.0 + 1.0 * max(0.0, a - 0.5) * (0.5 + g) : 1.0;
      vec2 l = vec2(x + cos(ang) * r * 0.6 * tear, y + sin(ang) * r * 0.42 * tear - (k == 3 ? r * 0.45 : 0.0));
      float lr = r * (0.45 + 0.5 * P4[k]) * (1.0 - 0.7 * max(0.0, a - 0.6) / 0.4) * (1.0 - 0.3 * (tear - 1.0));
      if ( lr < 0.8 * u ) continue;
      vec2 h = vec2(1.2650 * lr * strx, 1.2650 * lr) + 0.5;
      lb = grow(lb, l.x - h.x, l.y - h.y, l.x + h.x, l.y + h.y);
    }
    if ( lb.x > lb.z ) continue;
    bb = grow(bb, max(lb.x, x - hb2.x), max(lb.y, y - hb2.y), min(lb.z, x + hb2.x), min(lb.w, y + hb2.y));
  }
  return bb.x > bb.z ? bb : bb + vec4(-1.0, -1.0, 1.0, 1.0);
}
void main() {
  ivec2 px = ivec2(floor(vCell));
  float u = uU;
  if ( px.x < uEN.x ) {
    if ( px.y >= uEN.y ) { oArt = boxEnc(NOBOX, vec2(0.0), 1.0); return; }
    int i = uEB.x + px.x, j = uEB.y + px.y; float sp = 32.0 * u / sqrt(L_DENS(3));
    oArt = boxEnc(boxFlame(i, j), vec2(float(i) * sp, float(j) * sp * RY), QF * u);
  } else if ( px.x < uEN.x + uEN.z ) {
    if ( px.y >= uEN.w ) { oArt = boxEnc(NOBOX, vec2(0.0), 1.0); return; }
    int i = uEB.z + px.x - uEN.x, j = uEB.w + px.y; float sps = 22.0 * u;
    oArt = boxEnc(boxSmoke(i, j, -1), vec2(float(i) * sps, float(j) * sps * RY), QS * u);
  } else {
    // (each source's 16 puff SLOTS: one puff's cull box each)
    int q = px.x - uEN.x - uEN.z;
    if ( px.y >= uEN.w || q >= uEN.z * 16 ) { oArt = boxEnc(NOBOX, vec2(0.0), 1.0); return; }
    int i = uEB.z + q / 16, j = uEB.w + px.y; float sps = 22.0 * u;
    oArt = boxEnc(boxSmoke(i, j, q % 16), vec2(float(i) * sps, float(j) * sps * RY), QS * u);
  }
}`;

/* ======================================================================== A8 pass 1b: TILE, the lattice ranges per 8 x 8 cells */
// Drawn, not searched: one quad per flame emitter and per smoke source, covering the tiles its EMB box touches (the smoke's widened by
// the flow warp, which moves the cell it tests by up to 4 art px), blended MAX into a (2 x tiles wide) target - flames left, smoke
// right: R = 255 - row, G = row, B = 255 - column, A = column, so each tile ends up with the min / max lattice row and column of
// everything that reaches it (cleared 0 = none: rows 255 .. 0). Indices from uEB / uEN; empty boxes draw nothing.
const TILE_V = `#version 300 es
precision highp float;
precision highp int;
in vec2 aIdx;        // the lattice point's texel in uEmb
in vec2 aCorner;     // the quad's corner (0 / 1)
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform sampler2D uEmb;
uniform ivec4 uEB;
uniform ivec4 uEN;
uniform vec2 uOrg;
uniform vec2 uSize;
uniform float uU;
flat out vec4 vRange;
const float RY = 0.8;
${BOXDEC}
void main() {
  ivec2 t = ivec2(aIdx); bool smoke = t.x >= uEN.x;
  float u = uU, sp = smoke ? 22.0 * u : 32.0 * u / 3.0;
  ivec2 ij = smoke ? ivec2(uEB.z + t.x - uEN.x, uEB.w + t.y) : uEB.xy + t;
  vec4 b = boxDec(texelFetch(uEmb, t, 0), vec2(float(ij.x) * sp, float(ij.y) * sp * RY), (smoke ? QS : QF) * u);
  if ( smoke ) b += vec4(-1.0, -1.0, 1.0, 1.0) * (4.0 * u + 0.5);
  // (tile k holds the cell centres uOrg + 8k + 0.5 .. + 7.5: the tiles from t0 to t1 - 1 overlap the box)
  vec2 nT = ceil(uSize / 8.0);
  vec2 t0 = clamp(floor((b.xy - uOrg - 7.5) / 8.0), vec2(0.0), nT), t1 = clamp(floor((b.zw - uOrg - 0.5) / 8.0) + 1.0, vec2(0.0), nT);
  if ( b.x > b.z || b.y > b.w || t0.x >= t1.x || t0.y >= t1.y ) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); vRange = vec4(0.0); return; }
  vec2 p = mix(t0, t1, aCorner) + (smoke ? vec2(nT.x, 0.0) : vec2(0.0));
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(p, 1.0)).xy, 0.0, 1.0);
  ivec2 e = smoke ? ivec2(t.x - uEN.x, t.y) : t;
  vRange = vec4(255.0 - float(e.y), float(e.y), 255.0 - float(e.x), float(e.x)) / 255.0;
}`;
const TILE_F = `#version 300 es
precision highp float;
flat in vec4 vRange;
out vec4 oTile;
void main() { oTile = vRange; }`;

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
uniform float uLift;      // A7: 1 / the scene ambience's luminosity factor (Foundry's PrimaryCanvasGroupAmbienceFilter dims the whole
                          // primary group at night - a -0.25 dark luminosity takes 20 % off the flames): the flames are lifted to keep their colour
uniform vec4 uRamp[12];   // look.mjs ramp7: 7 flame steps, 3 bed, 2 fire-lit undersides
uniform vec4 uSmokeTint;
uniform sampler2D uOcc;   // A9: per 8 x 8 cells, does the tile (grown by a cell) hold anything for this layer (OCC pass)
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
  // A9: nothing for this layer within a cell of this pixel's cell (its footprint never reaches further: w <= 2) - the colour would be
  // exactly 0 (the ground's exactly 1), which the layer's blend leaves the screen untouched by: skip the pixel
  if ( texelFetch(uOcc, min(ivec2(vCell), ivec2(uSize) - 1) >> 3, 0)[OCC] == 0.0 ) discard;
#ifdef SIDE
  // DEPTH: every screen pixel belongs WHOLE to one of the two layers (SIDE 0 = the fire layer under the tokens, 1 = the front layer
  // above them): the front one when any cell of its footprint is a flame in front of a token's feet. Both layers compute the same
  // colour, so the pair draws each pixel exactly once and a split pixel never lets the token show through between them (a seam)
  bool own = false;
  if ( uK <= 0.0 || max(w.x, w.y) < 0.01 ) own = ownCell(floor(vCell));
  else if ( uTokN > 0 ) {
    vec2 ww = clamp(w, vec2(0.01), vec2(2.0));
    float jx, jy; vec3 bx, by;
    axisW(vCell.x, ww.x, jx, bx); axisW(vCell.y, ww.y, jy, by);
    for ( int j = 0; j < 3 && !own; j++ ) { if ( by[j] <= 0.0 ) continue;
      for ( int i = 0; i < 3; i++ ) if ( bx[i] > 0.0 && ownCell(vec2(jx + float(i), jy + float(j))) ) { own = true; break; } }
  }
  if ( own != (SIDE == 1) ) { fragColor = vec4(0.0); return; }
#endif
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
    // the RIM on the merged body's outer silhouette only (the flames are one layer), A7: a graded DARK RED outline - the outer cell
    // above / on the shadow side dark red, on the lit left side red; the cell inside it at most orange (a 2-step edge, never a flat
    // cut-out); none at the bottom
    // (a pinhole inside the body - one or two empty cells - gets only the soft orange step: no dark-red contour lines in the body)
    int up = art(p + ivec2(0, -1)).r, lf = art(p + ivec2(-1, 0)).r, rt = art(p + ivec2(1, 0)).r;
    int up2 = art(p + ivec2(0, -2)).r, rt2 = art(p + ivec2(2, 0)).r;
    if ( (up == 0 && up2 == 0) || (rt == 0 && rt2 == 0) ) band = 1;
    else if ( lf == 0 ) band = min(band, 2);
    else if ( up == 0 || rt == 0 || up2 == 0 || rt2 == 0 ) band = min(band, 3);
    float al = band <= 1 ? OUTER[lv] : 1.0;
    // (A7: at night the cream core cannot be lifted past white - the ambience filter would leave it grey: it leans to the yellow)
    vec3 rgb = band == 6 ? mix(uRamp[6].rgb, uRamp[5].rgb, clamp((uLift - 1.0) * 3.0, 0.0, 0.7)) : uRamp[band].rgb;
    return vec4(rgb * al, al);
  }
  return vec4(0.0);
}`;
// the FIRE layer (under the tokens): flames, bed embers, coals and sparks
// DEPTH against the tokens standing on this area (display.tokensOn: up to 16, set when a token moves): a flame whose bed lies in front
// of a token's feet (lower on screen) is drawn by the FRONT layer above the tokens where it overlaps the token; every other flame
// cell stays in the fire layer under them
const DEPTH = `
uniform vec4 uTok[16];    // x0, y0, x1, feet (cells, area-local; the token's visible rect, its bottom = its feet)
uniform int uTokN;
uniform float uU;         // art px scale (cells per art px): R's step
bool inFront(vec2 cf, int r) {
  if ( r <= 0 || uTokN == 0 ) return false;
  // (R - 1 = the bed row in art px mod 255; a flame's bed lies at most 24 art px above the cell and 230 below it)
  float uq = max(uU, 0.25); vec2 q = cf + 0.5; int lo = int(floor(q.y / uq)) - 24;
  float by = (float(lo) + mod(float(r - 1 - lo), 255.0)) * uq;   // (float mod: never negative)
  for ( int k = 0; k < 16; k++ ) {
    if ( k >= uTokN ) break;
    vec4 T = uTok[k];
    if ( q.x >= T.x && q.x < T.z && q.y >= T.y && q.y < T.w && by > T.w ) return true;
  }
  return false;
}
// a cell the FRONT layer owns: a flame cell (not an ember / spark / coal) in front of a token's feet over that token
bool ownCell(vec2 cf) {
  if ( uTokN == 0 ) return false;
  ivec4 a = art(ivec2(cf));
  return a.g < 24 && inFront(cf, a.r);
}`;
const SHOW = `${SHOW_COMMON}
${FLAME_COLOR}
${DEPTH}
vec4 cellColor(vec2 cf) {
  ivec2 p = ivec2(cf);
  ivec4 a = art(p);
  vec4 col = flameColor(p, a);
  if ( a.g >= 24 && a.g < 32 ) col = vec4(uRamp[7 + min(2, a.g - 24)].rgb, 1.0);
  else if ( a.g >= 32 && a.g < 40 ) col = vec4(uRamp[min(6, a.g - 32)].rgb, 1.0);   // sparks and hot coals
  else if ( a.g == 40 ) col = vec4(vec3(1.0, 0.93, 0.8) * 0.12, 0.12);              // (A7 heat shimmer: a light streak...
  else if ( a.g == 41 ) col = vec4(0.0, 0.0, 0.0, 0.07);                            // ... and a dark one)
  else if ( a.g >= 42 && a.g <= 44 ) { float gl = float(a.g - 41) * mix(0.055, 0.1, uDark); col = vec4(uRamp[4].rgb * gl, gl); }   // (A7 ground glow pools)
  if ( a.g > 0 && a.g < 40 ) col.rgb = min(col.rgb * uLift, vec3(col.a));   // (A7: the flames, embers and sparks keep their colour at night)
  return col;
}
#define OUT(c) ((c) * uAlpha)
#define SIDE 0
#define OCC 0
${FOOTPRINT}`;

// the FRONT layer (above the tokens, under the smoke): only the flame cells in front of a token's feet, over that token
const FRONT = `${SHOW_COMMON}
${FLAME_COLOR}
${DEPTH}
vec4 cellColor(vec2 cf) {
  ivec2 p = ivec2(cf);
  ivec4 a = art(p);
  vec4 col = flameColor(p, a);
  if ( a.g >= 24 && a.g < 32 ) col = vec4(uRamp[7 + min(2, a.g - 24)].rgb, 1.0);
  else if ( a.g >= 32 && a.g < 40 ) col = vec4(uRamp[min(6, a.g - 32)].rgb, 1.0);   // sparks and hot coals
  else if ( a.g == 40 ) col = vec4(vec3(1.0, 0.93, 0.8) * 0.12, 0.12);              // (A7 heat shimmer: a light streak...
  else if ( a.g == 41 ) col = vec4(0.0, 0.0, 0.0, 0.07);                            // ... and a dark one)
  else if ( a.g >= 42 && a.g <= 44 ) { float gl = float(a.g - 41) * mix(0.055, 0.1, uDark); col = vec4(uRamp[4].rgb * gl, gl); }   // (A7 ground glow pools)
  if ( a.g > 0 && a.g < 40 ) col.rgb = min(col.rgb * uLift, vec3(col.a));   // (A7: the flames, embers and sparks keep their colour at night)
  return col;
}
#define OUT(c) ((c) * uAlpha)
#define SIDE 1
#define OCC 0
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
  if ( a.g >= 32 && a.g < 40 ) return vec4(uRamp[min(6, a.g - 32)].rgb, 1.0);
  int band = a.b & 7, rim = (a.b >> 3) & 1, ls = clamp((a.b >> 4) & 3, 1, 3);
  bool front = (a.b & 64) != 0, drift = (a.b & 128) != 0;
  vec3 rgb = band == 4 ? uRamp[11].rgb : tintSmoke(SMK[(ls - 1) * 3 + band - 1]);
  float al = rim == 1 ? S_RIM[ls] : S_A[ls][min(band, 3) - 1];
  // AT NIGHT the scene's darkness already dims the smoke with the map (it is not emissive): darkening it again made a black smudge.
  // It keeps its own value, cooled a little by the ambient, and reads by its form: the lit tops and the outer edge facing the light
  // (top-left) catch a pale rim, the dense cores stay dark - contrast against the dimmed map, never a glow (nothing goes above the
  // day colours)
  int NL = (a.a >> 5) & 3;
  if ( uDark > 0.0 && NL > 0 ) {
    // a burning fire's smoke AT NIGHT is lit by the fire, from below: a warm underside, warm-dim flanks, dark tops (never the pale
    // moonlit rims: under the fire's light they turned pink); the scene's darkness and the fire light do the rest
    vec3 dk = tintSmoke(SMK[(ls - 1) * 3 + 2]) * vec3(0.8, 0.82, 0.9);
    vec3 nc = NL == 1 ? mix(dk, uRamp[11].rgb, 0.8) : NL == 2 ? mix(dk, uRamp[10].rgb, 0.35) : dk * 0.78;
    rgb = mix(rgb, nc, uDark);
  } else if ( uDark > 0.0 && band != 4 ) {
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
#define OCC 1
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
#define OCC 2
${FOOTPRINT}`;

// the flames' EMISSION: drawn into Foundry's illumination (MAX), so darkness never dims the flame body (research 2g); smoke is not
// emissive (it stays in the dimmed scene) except a burning fire's warm underside at half; white where a flame or ember cell is, scaled by its flat alpha
const EMIT = `${SHOW_COMMON}
const float OUTER[4] = float[4](0.0, 0.55, 0.85, 1.0);
vec4 cellColor(vec2 cf) {
  ivec4 a = art(ivec2(cf));
  if ( a.r > 0 && a.g > 0 && a.g < 24 ) { int band = (a.g - 1) & 7, lv = clamp((a.g - 1) / 8 + 1, 1, 3); float al = band <= 1 ? OUTER[lv] : 1.0; return vec4(al); }
  if ( a.g >= 24 && a.g < 40 ) return vec4(1.0);
  if ( a.g >= 42 && a.g <= 44 ) return vec4(0.08 * float(a.g - 41));   // (A7: the ground glow pools, a little at night)
  if ( a.b > 0 && ((a.a >> 5) & 3) == 1 ) return vec4(0.45);   // (the smoke's fire-lit underside: half emissive, it glows at night)
  return vec4(0.0);
}
#define OUT(c) ((c) * uAlpha)
#define OCC 3
${FOOTPRINT}`;

/* ======================================================================== A9 pass 1c: OCC, which layers each 8 x 8 tile shows (12 fps) */
// After the art pass: per tile, whether any cell of it - grown by one cell, the furthest a screen pixel's footprint reaches - holds
// something for the fire / front layer (G > 0), the smoke (B > 0), the ground (char, heat, shadow bits) or the emission (G > 0, or a
// fire-lit smoke underside). Everything else gives exactly nothing there, so the every-frame quads skip those pixels (most of an
// area's rectangle: it holds the smoke's whole reach) at the cost of one fetch.
const OCC_F = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform sampler2D uArt;
uniform vec2 uSize;
out vec4 oOcc;
void main() {
  ivec2 t = ivec2(vCell), S = ivec2(uSize), c0 = max(t * 8 - 1, ivec2(0)), c1 = min(t * 8 + 9, S);
  bool fl = false, sm = false, gr = false, em = false;
  for ( int y = c0.y; y < c1.y; y++ ) for ( int x = c0.x; x < c1.x; x++ ) {
    ivec4 a = ivec4(texelFetch(uArt, ivec2(x, y), 0) * 255.0 + 0.5);
    fl = fl || a.g > 0; sm = sm || a.b > 0; gr = gr || (a.a & 31) != 0; em = em || (a.b > 0 && ((a.a >> 5) & 3) == 1);
  }
  oOcc = vec4(fl, sm, gr, fl || em);
}`;

let progs = null, progsC = null;
const whole = (src) => src.replace("#define LVC 1\n", "#define LVC 0\n");
const programs = () => progs ??= {
  art: PIXI.Program.from(VERT, whole(ART_F), "moinen-maps-fire-art-v15"),
  artS: PIXI.Program.from(VERT, whole(ART_S), "moinen-maps-fire-art-smoke-v1"),
  emb: PIXI.Program.from(VERT, whole(EMB), "moinen-maps-fire-emb-v1"),
  tile: PIXI.Program.from(TILE_V, TILE_F, "moinen-maps-fire-tile-v2"),
  fuel: PIXI.Program.from(VERT, FUEL, "moinen-maps-fire-fuel-v3"),
  show: PIXI.Program.from(VERT_B(0), SHOW, "moinen-maps-fire-show-v9"),
  front: PIXI.Program.from(VERT_B(0), FRONT, "moinen-maps-fire-front-v6"),
  smoke: PIXI.Program.from(VERT_B(1), SMOKE, "moinen-maps-fire-smoke-v6"),
  ground: PIXI.Program.from(VERT_B(2), GROUND, "moinen-maps-fire-ground-v3"),
  emit: PIXI.Program.from(VERT_B(3), EMIT, "moinen-maps-fire-emit-v5"),
  occ: PIXI.Program.from(VERT, OCC_F, "moinen-maps-fire-occ-v1")
};
/**
 * F1: the CONTINUOUS-LEVEL art programs (LVC 1: fractional levels, ramps) - only an area that has one draws with them; the whole-level
 * ones above link as fast as before F1 (a cache-miss link of these is ~1.6x theirs, so they are warmed after them: fire.mjs).
 */
const lvcPrograms = () => progsC ??= {
  art: PIXI.Program.from(VERT, ART_F, "moinen-maps-fire-lvc-art-v1"),
  artS: PIXI.Program.from(VERT, ART_S, "moinen-maps-fire-lvc-art-smoke-v1"),
  emb: PIXI.Program.from(VERT, EMB, "moinen-maps-fire-lvc-emb-v1")
};
export const lvcArtPrograms = () => Object.values(lvcPrograms());
/** Every art-style program (the pre-warm compiles them in the background after a scene with fire opens: fire.mjs). */
export const artPrograms = () => Object.values(programs());
/** Their keys, in the same order (art, artS, emb, ...: dev/fire-art-link-run.mjs). */
export const artProgramKeys = () => Object.keys(programs());
/** A small pass into its target, cleared: bound and drawn directly (A12: renderer.render's per-call overhead is most of a tiny pass's CPU). */
function renderPass(renderer, mesh, rt) { renderer.renderTexture.bind(rt); renderer.renderTexture.clear(); mesh.render(renderer); renderer.batch.flush(); }
const texOf = (data, W, H) => PIXI.Texture.fromBuffer(data, W, H, { scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA });
/** The every-frame layers' geometry: one quad per BLK x BLK cells (aBlk = its block), corners as the whole quad's would be. */
const blocks = (x0, ap, y0, W, H) => {
  const BX = Math.ceil(W / BLK), BY = Math.ceil(H / BLK), pos = [], cell = [], blk = [], ind = [];
  const px = (c, n, o) => (c >= n ? o + n * ap : o + c * ap);   // (the far edge exactly as the whole quad's x1 / y1)
  for ( let by = 0; by < BY; by++ ) for ( let bx = 0; bx < BX; bx++ ) {
    const k = pos.length / 2, cx0 = bx * BLK, cy0 = by * BLK, cx1 = Math.min(W, cx0 + BLK), cy1 = Math.min(H, cy0 + BLK);
    for ( const [cx, cy] of [[cx0, cy0], [cx1, cy0], [cx1, cy1], [cx0, cy1]] ) { pos.push(cx === 0 ? x0 : px(cx, W, x0), cy === 0 ? y0 : px(cy, H, y0)); cell.push(cx, cy); blk.push(bx, by); }
    ind.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  return new PIXI.Geometry().addAttribute("aVertexPosition", pos, 2).addAttribute("aCell", cell, 2).addAttribute("aBlk", blk, 2).addIndex(new Uint32Array(ind));
};
const quad = (x0, y0, x1, y1, W, H) => new PIXI.Geometry()
  .addAttribute("aVertexPosition", [x0, y0, x1, y0, x1, y1, x0, y1], 2)
  .addAttribute("aCell", [0, 0, W, 0, W, H, 0, H], 2)
  .addIndex([0, 1, 2, 0, 2, 3]);

/** Blobs per emitter by Performance mode (research 13: 7 -> 5 -> 3, here 8 / 6 / 4). */
/*
 * F1 - A CONTINUOUS FIRE LEVEL in the art programs (dev/fire-slider-design.md). levelAt() decodes model.levelCode (a whole level's
 * old code, a fractional one 13 + 4 q + smoke) to a float; every look table goes through LVF (linear between, the entry itself at a
 * whole level: the old look bit for bit). What cannot be continuous stays whole and changes cell by cell or blob by blob:
 *   - the blob SCHEDULE (its birth interval, a leader, the sheet height): emLevel gives each emitter a whole schedule level
 *     floor(lv - h) + 1 by its own hash h; while a ramp has moved it, the blobs of the schedule before (born before tH, the moment the
 *     eased ramp crossed lv = level + h) finish their lives in a second loop - a hand-off, never a re-seed;
 *   - the char code, the white core and the outer bands' alpha: lvDith, a static blue-noise dither (rank at offset cells);
 *   - sparks, bursts and puffs take the level of their BIRTH (lvAt(p, age)): a live one never changes mid-life.
 * A RAMP (a level change over `over` ms, model.rampAt): uLvRamp per cell R = 1 + (from-level - 1) x 127, G its start (steps of
 * uRampT.y from uRampT.x, shader s mod 1000), B the smoke source at the from-level, A its length (0.1 s; x uRampT.z the speed); the
 * level eases along a smoothstep (rampK). uLvTop is the area's top level (from, to, over shader s z .. w): the spark search, the
 * shimmer, the tint ring. uLvMax stays the culls' whole bound (the top level a ramp passes).
 */
export const BIRTHS = { high: 8, medium: 6, low: 4 };

/**
 * One fire-style area: a container of the ground quad (multiply) and the art quad, plus the art pass (a mesh rendered into a W x H
 * render texture, not on the stage). `setTime(t)`, `setPhase(now)`, `setDark(d)`, then `renderArt(renderer)` at most once per 12 fps
 * frame. Same contract as shader.mjs FireMesh for the display (anim, visible, destroy).
 */
export class FireArt extends PIXI.Container {
  constructor(field, rect, geo, { above = null, front = null, box = null, seed = 1, grid = 32, lean = 0, wind = [0, 0], dur = [1.6, 2.2, 10], plume = 2.5, lvMax = 2, lvTop = null, rampT = null, rampP = null, lvc = false, smokeTint = 0, births = 8 } = {}) {
    super();
    this.eventMode = "none"; this.interactiveChildren = false;
    const { ap, ox, oy } = geo, W = field.w, H = field.h, P0 = programs(), P = lvc ? { ...P0, ...lvcPrograms() } : P0;
    const x0 = ox + rect.x0 * ap, y0 = oy + rect.y0 * ap, x1 = x0 + W * ap, y1 = y0 + H * ap;
    this.fieldTex = texOf(field.data, W, H);
    this.auxTex = texOf(field.aux ?? new Uint8Array(W * H * 4), W, H);
    this.timesTex = field.times ? texOf(field.times, W, H) : null;
    this.auxOldTex = field.auxOld && field.times ? texOf(field.auxOld, W, H) : null;
    this.puffTex = field.puff ? texOf(field.puff, W, H) : null;
    this.rampTex = field.ramp ? texOf(field.ramp, W, H) : null;      // (F1: a level ramp's cells; model.rampTex)
    this.ramp2Tex = field.ramp2 ? texOf(field.ramp2, W, H) : null;   // (the ramps they interrupted)
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
      uSize: new Float32Array([W, H]), uTime: 0, uSeed: seed % 65536, uU: grid / 32, uLvMax: Math.ceil(lvMax), uLean: lean,
      uLvRamp: this.rampTex ?? this.fieldTex, uHasRamp: this.rampTex ? 1 : 0, uRampT: new Float32Array(rampT ?? [0, 1, 1]), uLvTop: new Float32Array(lvTop ?? [lvMax, lvMax, 0, 0]),
      uLvRamp2: this.ramp2Tex ?? this.fieldTex, uHasRamp2: this.ramp2Tex ? 1 : 0, uRampP: new Float32Array(rampP ?? [0, 1]),
      uWind: new Float32Array(wind), uPlume: plume, uPuffQ: new Float32Array(field.puff ? field.puffQ : [0, 0, 0, 0]),
      uBox: new Float32Array(box ? [box.x0, box.y0, box.x1, box.y1] : [rect.x0, rect.y0, rect.x1, rect.y1]), uBirths: births, uVC: VC_PACKED, uFuel: this.fuelRt, uFuelSize: new Float32Array([FW, FH]), uOrg: new Float32Array([rect.x0, rect.y0]),
      translationMatrix: new PIXI.Matrix().toArray(true) }));
    // A8: the EMB pass (each flame emitter's and smoke source's box this frame, both lattices side by side) and the TILE pass (per
    // 8 x 8 cells, the lattice ranges that reach it): two tiny render targets, drawn before the art pass with the same uniforms
    {
      const u = grid / 32, sp = 32 * u / 3, spy = sp * 0.8, sps = 22 * u, spys = sps * 0.8;
      const EW = Math.ceil(W / sp) + 5, EH = Math.ceil(H / spy) + 5, SW = Math.ceil(W / sps) + 5, SH = Math.ceil(H / spys) + 5;
      const BW = EW + 17 * SW, BH = Math.max(EH, SH), TW = Math.ceil(W / 8), TH = Math.ceil(H / 8);
      this.embRt = PIXI.RenderTexture.create({ width: BW, height: BH, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST });
      this.tileRt = PIXI.RenderTexture.create({ width: 2 * TW, height: TH, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST });
      for ( const t of [this.embRt, this.tileRt] ) t.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
      const U = this.pass.shader.uniforms;
      Object.assign(U, { uEmb: this.embRt, uTile: this.tileRt, uTileOn: Math.max(EW, EH, SW, SH) <= 255 ? 1 : 0,
        uEB: new Int32Array([Math.floor(rect.x0 / sp) - 2, Math.floor(rect.y0 / spy) - 2, Math.floor(rect.x0 / sps) - 2, Math.floor(rect.y0 / spys) - 2]),
        uEN: new Int32Array([EW, EH, SW, SH]) });
      this.embPass = new PIXI.Mesh(quad(0, 0, BW, BH, BW, BH), new PIXI.Shader(P.emb, U));
      // (the art pass's second program, ART_S, added onto ART_F's cells: the same quad and uniforms)
      this.passS = new PIXI.Mesh(this.pass.geometry, new PIXI.Shader(P.artS, U));
      this.passS.state.blendMode = PIXI.BLEND_MODES.ADD;
      // (an area where no cell's puff mask is set - ART_S's uPuff G, the very gate it discards on - never draws smoke: no second pass)
      const pm = field.puff ?? field.data; let sm = false;
      for ( let i = 1; i < pm.length; i += 4 ) if ( pm[i] !== 0 ) { sm = true; break; }
      this.passS.renderable = sm;
      // (one quad per flame emitter and smoke source: TILE_V places it over the tiles its box touches, blended MAX)
      const idx = [], cor = [], ind = [];
      const add = (x, y) => { const k = idx.length / 2; idx.push(x, y, x, y, x, y, x, y); cor.push(0, 0, 1, 0, 1, 1, 0, 1); ind.push(k, k + 1, k + 2, k, k + 2, k + 3); };
      for ( let y = 0; y < EH; y++ ) for ( let x = 0; x < EW; x++ ) add(x, y);
      for ( let y = 0; y < SH; y++ ) for ( let x = 0; x < SW; x++ ) add(EW + x, y);
      const g = new PIXI.Geometry().addAttribute("aIdx", idx, 2).addAttribute("aCorner", cor, 2).addIndex(new Uint32Array(ind));
      this.tilePass = new PIXI.Mesh(g, new PIXI.Shader(P.tile, U));
      this.tilePass.state.blendMode = PIXI.BLEND_MODES.MAX_COLOR;
      // A9: the OCC pass (per 8 x 8 cells, which every-frame layers have anything there)
      this.occRt = PIXI.RenderTexture.create({ width: TW, height: TH, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST });
      this.occRt.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
      this.occPass = new PIXI.Mesh(quad(0, 0, TW, TH, TW, TH), new PIXI.Shader(P.occ, { uArt: this.rt, uSize: new Float32Array([W, H]), translationMatrix: new PIXI.Matrix().toArray(true) }));
    }
    this.tok = new Float32Array(64);    // (shared by the fire and front layers: setTokens)
    const common = () => ({ uArt: this.rt, uOcc: this.occRt, uSize: new Float32Array([W, H]), uK: footprintK(), uAlpha: 1, uDark: 0, uTok: this.tok, uTokN: 0, uU: grid / 32,
      uLift: 1, uRamp: new Float32Array(ramp.ramp7), uSmokeTint: new Float32Array([...ramp.tint, smokeTint]), translationMatrix: new PIXI.Matrix().toArray(true) });
    // (A13: ONE block geometry for the five every-frame layers - the same vertices each built alone, uploaded once)
    const bg = blocks(x0, ap, y0, W, H);
    this.ground = new PIXI.Mesh(bg, new PIXI.Shader(P.ground, common()));
    this.ground.state.blendMode = PIXI.BLEND_MODES.MULTIPLY;
    this.show = new PIXI.Mesh(bg, new PIXI.Shader(P.show, common()));
    this.show.state.blendMode = PIXI.BLEND_MODES.NORMAL;   // premultiplied output
    for ( const m of [this.ground, this.show] ) {
      m.eventMode = "none";
      const r0 = m._render.bind(m);
      m._render = (renderer) => { const u = m.shader.uniforms; u.uAlpha = this.worldAlpha; u.uK = footprintK(); r0(renderer); };
    }
    this.addChild(this.ground, this.show);
    // the SMOKE lives in a layer above the tokens (`above`, the display's; else on top of this container): it follows this area's
    // visibility and alpha
    this.smoke = new PIXI.Mesh(bg, new PIXI.Shader(P.smoke, common()));
    this.smoke.state.blendMode = PIXI.BLEND_MODES.NORMAL; this.smoke.eventMode = "none";
    const s0 = this.smoke._render.bind(this.smoke);
    this.smoke._render = (renderer) => {
      if ( !this.worldVisible || !this.parent ) return;
      const u = this.smoke.shader.uniforms; u.uAlpha = this.worldAlpha; u.uK = footprintK(); s0(renderer);
    };
    (above ?? this).addChild(this.smoke);
    // the FRONT flames live in a layer between the tokens and the smoke (`front`, the display's): drawn only while a token stands here
    this.front = new PIXI.Mesh(bg, new PIXI.Shader(P.front, common()));
    this.front.state.blendMode = PIXI.BLEND_MODES.NORMAL; this.front.eventMode = "none"; this.front.visible = false;
    const f0 = this.front._render.bind(this.front);
    this.front._render = (renderer) => {
      if ( !this.worldVisible || !this.parent ) return;
      const u = this.front.shader.uniforms; u.uAlpha = this.worldAlpha; u.uK = footprintK(); f0(renderer);
    };
    (front ?? this).addChild(this.front);
    this.rect = rect; this.geo = geo;
    // KNOWN RISKS for "the area's rectangle shows" (each quad covers the whole area rect; checked by diffing frames with each pass
    // hidden, dev/out bbox probe: clean at zoom 1-3, day and dark, DPR 1 - the one real case was the outside distance, model.chamfer):
    //   - the ground pass is a MULTIPLY quad writing alpha 1 over the whole rect (exact 1.0 colour outside the marks: invisible on an
    //     opaque primary texture; a transparent one would show the rect);
    //   - the glow quad is drawn into Foundry's illumination, which renders at HALF resolution below Performance MAX and is upscaled
    //     bilinearly (a soft halo around emissive cells, never past the cells' own neighbourhood);
    //   - the box-filter footprint reads past the art texture at the quad's edge: art() returns 0 there (bounds-checked, no undefined
    //     texelFetch).
    // the emission lives in the illumination layer (not in this container): it follows this area's visibility and alpha
    this.glow = new PIXI.Mesh(bg, new PIXI.Shader(P.emit, common()));
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
  setDark(d) {
    this.front.shader.uniforms.uDark = d; this.show.shader.uniforms.uDark = d; this.ground.shader.uniforms.uDark = d; this.smoke.shader.uniforms.uDark = d;
    // (A7: the inverse of the ambience filter's luminosity at this darkness - Foundry's PrimaryCanvasGroupAmbienceFilter: mix(base, dark,
    // darkness) x 1.2 when brighter, x 0.8 when darker; the flame colours are divided by it so they come out as painted; clipped colours
    // stay a little dimmer)
    const env = canvas.scene?.environment, cyc = env?.cycle !== false, bl = env?.base?.luminosity ?? 0, dl = env?.dark?.luminosity ?? 0;
    const lb = cyc ? bl + (dl - bl) * d : bl, lum = lb * (lb >= 0 ? 1.2 : 0.8), lift = 1 / Math.max(0.2, 1 + lum);
    this.show.shader.uniforms.uLift = lift; this.front.shader.uniforms.uLift = lift;
  }
  setBirths(n) { this.pass.shader.uniforms.uBirths = n; }
  /** The tokens standing on this area: [[x0, y0, x1, feet], ...] in scene px (their visible rects), at most 16. */
  setTokens(list) {
    const { ap, ox, oy } = this.geo, r = this.rect, n = Math.min(16, list.length);
    for ( let k = 0; k < n; k++ ) {
      const [a, b, c, d] = list[k];
      this.tok.set([(a - ox) / ap - r.x0, (b - oy) / ap - r.y0, (c - ox) / ap - r.x0, (d - oy) / ap - r.y0], k * 4);
    }
    this.show.shader.uniforms.uTokN = n; this.front.shader.uniforms.uTokN = n; this.front.visible = n > 0;
  }
  /** The area's grow / out clocks at shared time `now` (ms). */
  setPhase(now) {
    const a = this.anim; if ( !a ) return;
    const u = this.pass.shader.uniforms;
    u.uI[0] = (now - a.iRef) / 1000; u.uI[1] = a.iSpan / 1000; u.uO[0] = (now - a.oRef) / 1000; u.uO[1] = a.oSpan / 1000;
  }
  /**
   * Draw the art cells for the current time (the 12 fps pass). A9: `win` = [x0, y0, x1, y1] (cells) draws only those cells (a scissor
   * on the same full quad: every drawn cell is exactly what the whole pass gives it); the others keep an older frame - the display
   * asks only for cells off screen to be left out (display.windowOf) and redraws at once when the view leaves the drawn window.
   */
  renderArt(renderer, win = null) {
    const u = this.pass.shader.uniforms, tf = this.fuelPass.shader.uniforms.uTime, W = this.W, H = this.H;
    if ( !(this.job?.pre && this.job.t !== u.uTime) ) this.job = null;   // (a frame drawn now supersedes one being drawn in steps; A12: not the next one drawn ahead)
    if ( tf !== this.fuelT ) { this.fuelT = tf; renderPass(renderer, this.fuelPass, this.fuelRt); }
    renderPass(renderer, this.embPass, this.embRt);
    if ( u.uTileOn ) renderPass(renderer, this.tilePass, this.tileRt);
    const aw = this._win ??= [0, 0, 0, 0];   // (one array per area, rewritten: no garbage per pass)
    if ( !win || (win[0] <= 0 && win[1] <= 0 && win[2] >= W && win[3] >= H) ) {
      this.scissorPass(renderer, this.rt, 0, 0, W, H);
      aw[0] = 0; aw[1] = 0; aw[2] = W; aw[3] = H;
    } else {
      const x0 = Math.max(0, win[0]), y0 = Math.max(0, win[1]), x1 = Math.min(W, win[2]), y1 = Math.min(H, win[3]);
      this.scissorPass(renderer, this.rt, x0, y0, x1, y1);
      aw[0] = x0; aw[1] = y0; aw[2] = x1; aw[3] = y1;
    }
    renderPass(renderer, this.occPass, this.occRt);
    this.artT = u.uTime;
    this.artWin = aw;
    // (the art pass's other per-frame uniforms at this frame - the grow / go-out clocks and the lean: extendArt draws more cells of it)
    const s = this.artU ??= new Float64Array(5);
    s[0] = u.uI[0]; s[1] = u.uI[1]; s[2] = u.uO[0]; s[3] = u.uO[1]; s[4] = u.uLean;
  }
  /**
   * The art pass over cells [x0, x1) x [y0, y1) of `target` only (A9: a scissor - exactly the whole pass's cells there), cleared
   * there first: ART_F, then ART_S added on top where this area can have smoke.
   */
  scissorPass(renderer, target, x0, y0, x1, y1) {
    if ( x1 <= x0 || y1 <= y0 ) return;
    const gl = renderer.gl;
    renderer.renderTexture.bind(target);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, y0, x1 - x0, y1 - y0);
    renderer.renderTexture.clear();
    this.pass.render(renderer); renderer.batch.flush();
    if ( this.passS.renderable ) { this.passS.render(renderer); renderer.batch.flush(); }
    gl.disable(gl.SCISSOR_TEST);
  }
  /**
   * A11: grow the drawn window so it holds `need` (cells) with more cells OF THE FRAME IT SHOWS (artT, with that frame's grow / go-out
   * clocks and lean): only the new strips around the old window are drawn, so a camera move costs the cells it uncovers, not a window.
   * Every drawn cell is still of one art frame (the same full-quad pass under a scissor, A9). Returns the cells drawn.
   */
  extendArt(renderer, need) {
    const o = this.artWin, s = this.artU, W = this.W, H = this.H; if ( !o || !s || this.artT === null ) return 0;
    const x0 = Math.max(0, Math.min(o[0], need[0])), y0 = Math.max(0, Math.min(o[1], need[1]));
    const x1 = Math.min(W, Math.max(o[2], need[2])), y1 = Math.min(H, Math.max(o[3], need[3]));
    const cells = (x1 - x0) * (y1 - y0) - (o[2] - o[0]) * (o[3] - o[1]); if ( cells <= 0 ) return 0;
    const k = this.frameOn(renderer, this.artT, s);
    try {
      this.scissorPass(renderer, this.rt, x0, y0, x1, o[1]);          // (above the old window, the new full width)
      this.scissorPass(renderer, this.rt, x0, o[3], x1, y1);          // (below it)
      this.scissorPass(renderer, this.rt, x0, o[1], o[0], o[3]);      // (left of it)
      this.scissorPass(renderer, this.rt, o[2], o[1], x1, o[3]);      // (right of it)
      renderPass(renderer, this.occPass, this.occRt);
    } finally { this.frameOff(k); }
    o[0] = x0; o[1] = y0; o[2] = x1; o[3] = y1;
    return cells;
  }
  /**
   * The art pass's uniforms set to frame `t` with clocks / lean `s` (saved: frameOff puts the current ones back), and its small maps
   * drawn for it (the fuel map when its quantised time differs from the one it holds; the emitter and tile maps always - a few hundred
   * texels: another frame may have been drawn in between).
   */
  frameOn(renderer, t, s) {
    const u = this.pass.shader.uniforms, k = this._saved ??= new Float64Array(6);
    k[0] = u.uTime; k[1] = u.uI[0]; k[2] = u.uI[1]; k[3] = u.uO[0]; k[4] = u.uO[1]; k[5] = u.uLean;
    this.setTime(t); u.uI[0] = s[0]; u.uI[1] = s[1]; u.uO[0] = s[2]; u.uO[1] = s[3]; u.uLean = s[4];
    const tf = this.fuelPass.shader.uniforms.uTime;
    if ( tf !== this.fuelT ) { this.fuelT = tf; renderPass(renderer, this.fuelPass, this.fuelRt); }
    renderPass(renderer, this.embPass, this.embRt);
    if ( u.uTileOn ) renderPass(renderer, this.tilePass, this.tileRt);
    return k;
  }
  frameOff(k) { const u = this.pass.shader.uniforms; this.setTime(k[0]); u.uI[0] = k[1]; u.uI[1] = k[2]; u.uO[0] = k[3]; u.uO[1] = k[4]; u.uLean = k[5]; }
  /**
   * A11: a NEW FRAME TOO BIG FOR ONE DISPLAY FRAME (a large area at a far zoom), drawn in steps: `startJob(win, t)` takes the frame (its
   * time and the clocks / lean as they are now); each `stepJob(renderer, maxCells)` draws the next rows of it into a BACK texture; the
   * area keeps showing the frame it has meanwhile, and when the last rows are in, the two textures swap: the new frame shows at once,
   * whole. Returns the cells drawn this step.
   */
  startJob(win, t) {
    const u = this.pass.shader.uniforms, W = this.W, H = this.H;
    const j = this.job = { t, x0: Math.max(0, win[0]), y0: Math.max(0, win[1]), x1: Math.min(W, win[2]), y1: Math.min(H, win[3]), y: 0, s: new Float64Array(5) };
    j.y = j.y0; j.s[0] = u.uI[0]; j.s[1] = u.uI[1]; j.s[2] = u.uO[0]; j.s[3] = u.uO[1]; j.s[4] = u.uLean;
    return j;
  }
  /**
   * A12 - THE NEXT FRAME DRAWN AHEAD: the art frame `t` that is not due yet (the shared clock reaches it later), with the grow / go-out
   * clocks and lean `s` it will have then, drawn in steps into the back texture over the display frames before it is due - so a new
   * 12 fps frame no longer lands as one burst of art passes in one display frame. Its small maps (fuel, emitter boxes, tiles) are drawn
   * once now into the job's own textures (no redraw per step); the steps change nothing the area shows; when the last rows are in the
   * job waits (done) until the clock reaches `t`, then `swapJob` shows it - the very cells the frame drawn at `t` would have.
   */
  startPre(renderer, win, t, s) {
    const u = this.pass.shader.uniforms, W = this.W, H = this.H;
    const j = this.job = { t, x0: Math.max(0, win[0]), y0: Math.max(0, win[1]), x1: Math.min(W, win[2]), y1: Math.min(H, win[3]), y: 0, s: this._preS ??= new Float64Array(5), pre: true, done: false };
    j.y = j.y0; j.s.set(s);
    const mk = (src, lin) => { const r = PIXI.RenderTexture.create({ width: src.width, height: src.height, resolution: 1, scaleMode: lin ? PIXI.SCALE_MODES.LINEAR : PIXI.SCALE_MODES.NEAREST }); r.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF; return r; };
    this.preFuel ??= mk(this.fuelRt, true); this.preEmb ??= mk(this.embRt, false); this.preTile ??= mk(this.tileRt, false);
    const k = this.preOn(t, s);
    try {
      renderPass(renderer, this.fuelPass, this.preFuel);
      u.uFuel = this.preFuel; renderPass(renderer, this.embPass, this.preEmb);
      u.uEmb = this.preEmb; if ( u.uTileOn ) renderPass(renderer, this.tilePass, this.preTile);
    } finally { this.preOff(k); }
    return j;
  }
  /** The art pass's uniforms set to frame `t`, clocks / lean `s` (the main small maps untouched); preOff puts them back. */
  preOn(t, s) {
    const u = this.pass.shader.uniforms, k = this._saved ??= new Float64Array(6);
    k[0] = u.uTime; k[1] = u.uI[0]; k[2] = u.uI[1]; k[3] = u.uO[0]; k[4] = u.uO[1]; k[5] = u.uLean;
    u.uTime = t; this.fuelPass.shader.uniforms.uTime = Math.floor(t * 4) / 4;
    u.uI[0] = s[0]; u.uI[1] = s[1]; u.uO[0] = s[2]; u.uO[1] = s[3]; u.uLean = s[4];
    return k;
  }
  preOff(k) {
    const u = this.pass.shader.uniforms;
    u.uTime = k[0]; u.uI[0] = k[1]; u.uI[1] = k[2]; u.uO[0] = k[3]; u.uO[1] = k[4]; u.uLean = k[5];
    this.fuelPass.shader.uniforms.uTime = Math.floor(k[0] * 4) / 4;   // (as setTime keeps it)
    u.uFuel = this.fuelRt; u.uEmb = this.embRt; u.uTile = this.tileRt;
  }
  /** The grow / go-out clocks and lean this area's art pass would get at shared time `now` (ms), into `out` (5). */
  clocksAt(now, out) {
    const u = this.pass.shader.uniforms, a = this.anim;
    out[0] = a ? (now - a.iRef) / 1000 : u.uI[0]; out[1] = a ? a.iSpan / 1000 : u.uI[1];
    out[2] = a ? (now - a.oRef) / 1000 : u.uO[0]; out[3] = a ? a.oSpan / 1000 : u.uO[1]; out[4] = u.uLean;
    return out;
  }
  /** Cells still to draw of the job (0: none, or done). */
  get jobLeft() { const j = this.job; return !j || j.done ? 0 : Math.max(0, (j.x1 - j.x0) * (j.y1 - j.y)); }
  stepJob(renderer, maxCells, tNow = Infinity) {
    const j = this.job; if ( !j || j.done ) return 0;
    const w = j.x1 - j.x0; if ( w <= 0 || j.y >= j.y1 ) { this.job = null; return 0; }
    const rows = Math.max(1, Math.min(j.y1 - j.y, Math.floor(maxCells / w)));
    if ( !this.back ) { this.back = PIXI.RenderTexture.create({ width: this.W, height: this.H, resolution: 1, scaleMode: PIXI.SCALE_MODES.NEAREST }); this.back.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF; }
    if ( j.pre ) {
      const u = this.pass.shader.uniforms, k = this.preOn(j.t, j.s);
      u.uFuel = this.preFuel; u.uEmb = this.preEmb; u.uTile = this.preTile;
      try { this.scissorPass(renderer, this.back, j.x0, j.y, j.x1, j.y + rows); } finally { this.preOff(k); }
    } else {
      const k = this.frameOn(renderer, j.t, j.s);
      try { this.scissorPass(renderer, this.back, j.x0, j.y, j.x1, j.y + rows); } finally { this.frameOff(k); }
    }
    j.y += rows;
    if ( j.y >= j.y1 ) { if ( j.pre && j.t > tNow ) j.done = true; else this.swapJob(renderer); }
    return rows * w;
  }
  /** The job's frame, whole in the back texture, shown: the two textures swap (and the area's OCC tiles follow). */
  swapJob(renderer) {
    const j = this.job; if ( !j ) return;
    const f = this.rt; this.rt = this.back; this.back = f;
    for ( const m of [this.occPass, this.ground, this.show, this.smoke, this.front, this.glow] ) m.shader.uniforms.uArt = this.rt;
    renderPass(renderer, this.occPass, this.occRt);
    const aw = this._win ??= [0, 0, 0, 0]; aw[0] = j.x0; aw[1] = j.y0; aw[2] = j.x1; aw[3] = j.y1;
    this.artT = j.t; this.artWin = aw; (this.artU ??= new Float64Array(5)).set(j.s);
    this.job = null;
  }
  /**
   * A13: the area's data textures sent to the GPU ahead of its first draw, at most `maxBytes` a call (always one texture): a large new
   * area's ~15 MB no longer lands in the frame that first draws it. The very texels the first draw would upload. Returns the bytes sent.
   */
  uploadStep(renderer, maxBytes) {
    const q = this._up ??= [this.fieldTex, this.auxTex, this.timesTex, this.auxOldTex, this.puffTex, this.rampTex, this.ramp2Tex].filter(Boolean);
    let sent = 0;
    while ( q.length && (sent === 0 || sent + q[0].baseTexture.width * q[0].baseTexture.height * 4 <= maxBytes) ) {
      const b = q.shift().baseTexture; renderer.texture.bind(b, 0); sent += b.width * b.height * 4;
    }
    return sent;
  }
  get uploaded() { return !!this._up && !this._up.length; }
  /** Do the drawn cells (this art frame) hold the window `w` (cells)? */
  covers(w) { const a = this.artWin; return !!a && w[0] >= a[0] && w[1] >= a[1] && w[2] <= a[2] && w[3] <= a[3]; }
  destroy() {
    const tx = [this.fieldTex, this.auxTex, this.timesTex, this.auxOldTex, this.puffTex, this.rampTex, this.ramp2Tex];
    this.fieldTex = this.auxTex = this.timesTex = this.auxOldTex = this.puffTex = this.rampTex = this.ramp2Tex = null;
    this.glow.parent?.removeChild(this.glow);
    const own = this.smoke.parent === this, ownF = this.front.parent === this;
    if ( !own ) this.smoke.parent?.removeChild(this.smoke);
    if ( !ownF ) this.front.parent?.removeChild(this.front);
    for ( const g of new Set([this.pass, this.fuelPass, this.embPass, this.tilePass, this.occPass, this.ground, this.show, this.glow, this.smoke, this.front].map((m) => m.geometry)) ) g?.destroy();
    this.passS.destroy(); this.pass.destroy(); this.fuelPass.destroy(); this.embPass.destroy(); this.tilePass.destroy(); this.occPass.destroy(); this.glow.destroy();
    if ( !own ) this.smoke.destroy();
    if ( !ownF ) this.front.destroy();
    super.destroy({ children: true });
    for ( const t of tx ) t?.destroy(true);
    this.back?.destroy(true); this.back = null; this.job = null;
    for ( const t of [this.preFuel, this.preEmb, this.preTile] ) t?.destroy(true);
    this.preFuel = this.preEmb = this.preTile = null;
    this.rt.destroy(true); this.fuelRt.destroy(true); this.embRt.destroy(true); this.tileRt.destroy(true); this.occRt.destroy(true);
  }
}

/** Shared with the dust layer (dust-art.mjs): the art-grid vertex shaders, the every-frame layers' common head and footprint sampler, the
 * block / quad geometry, the data textures and the small-pass helper - the fire's own programs are unchanged. */
export { VERT, VERT_B, BLK, SHOW_COMMON, FOOTPRINT, DEPTH, blocks, quad, texOf, renderPass };
