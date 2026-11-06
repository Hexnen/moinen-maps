/**
 * The GPU body of FIRE AND SMOKE: one quad per area, its field (scripts/fire/model.mjs `raster`: R heat, G smoke, B burning ground, A
 * the levels) a small NEAREST texture of one texel per art cell. The fragment shader works on WHOLE ART CELLS: the colour of a cell is
 * a function of (cell, field, time) only - procedural noise quantised to a small palette (flat bands, no gradients), so it is real
 * pixel art on the same art grid as the destruction layer (display.ap / display.origin).
 *
 * TWO STYLES (per area, `uStyle`):
 *  - FIRE (0, the default): fire burning IN PLACE. A fixed BASE on the ground (the painted bed: char, embers and a glow that boils in
 *    place and never moves); flame TONGUES grow up from it, screen-up, leaning with the wind. Each column of tongues has a height that
 *    licks up and down over time and a ragged edge that boils in place (two noise frames cross-faded: nothing scrolls or travels
 *    across the area); pieces split off above the tips and vanish. Hot (white-yellow) at the base and the core, orange, red and dark
 *    red towards the tips. The fire level is a gradation: 1 smouldering (a glowing bed, low sparse tongues), 2 a steady fire, 3 a
 *    blaze (tall, dense, hot). SMOKE rises from the tips: billows (a few octaves of noise carried along the plume) with a lit side and
 *    a shadow side (the billow compared one step towards the light, up-left), flat see-through bands (the map shows through), thinning
 *    with height and distance into separate clumps (the billows' cores) - never a dither ring. Smoke level 1 thin light wisps, 2 a
 *    plume, 3 a thick dark billowing column. Over the flames the smoke is much thinner, so the fire stays readable.
 *  - FIREBALL (1): the layer's first look (a rolling ball of fire, its smoke), kept bit for bit (`cellFireball` is the v1 code).
 *
 * GROWING AND GOING OUT (while the area animates: `uAnim` 1 and the times texture, model.raster): per cell its flames' and its smoke's
 * ignite / out times; the flames grow to full height (the heat scales up), the smoke builds after them; going out the flames sink back
 * into the base, the bed glows on and darkens, the smoke lingers and thins. Only the uniforms uI / uO change per frame. At rest
 * (`uAnim` 0) the times are not even read.
 *
 * CRISP AT ANY ZOOM, the module's way (sharp-sampler.mjs): a screen pixel's colour is the exact BOX average of the cells under its
 * footprint (fwidth of the cell coordinate), at most 3 x 3 cells; `CONFIG.moinenMaps.zoomAA` false / 'mips': nearest.
 *
 * Time is the SHARED clock stepped at 12 frames a second (model.shaderTime): every client shows the same frame.
 */

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

const FRAG = `#version 300 es
precision highp float;
in vec2 vCell;
uniform sampler2D uField;
uniform sampler2D uTimes;
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uFlow;      // the smoke's drift (cells per second): along the plume
uniform float uSeed;
uniform float uGrid;     // cells per grid square: the noise is sized in squares, the art in cells
uniform float uK;        // footprint scale: 0 = nearest, 1 = the exact box
uniform float uAlpha;
uniform int uStyle;      // 0 fire, 1 fireball
uniform float uLean;     // fire: cells the tongues lean per cell of height (the wind)
uniform float uFlameH;   // fire: cells a tongue reaches at full heat, level 2
uniform int uAnim;       // 1 while something in the area grows or goes out
uniform vec2 uI;         // seconds since the ignite ref, ignite span (s)
uniform vec2 uO;         // seconds since the out ref, out span (s)
uniform vec2 uDur;       // grow, out (s)
uniform sampler2D uMap;  // the scene's background map (already on the GPU), for blending into it
uniform vec4 uMapRect;   // its scene rectangle (x, y, w, h)
uniform int uHasMap;     // 0 when the scene has no background image
uniform vec3 uCellGeo;   // the area's cell (0, 0) in scene px (x, y) and the art pixel (z)
out vec4 fragColor;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h21(i), b = h21(i + vec2(1.0, 0.0)), c = h21(i + vec2(0.0, 1.0)), d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float bayer4(vec2 c) {
  ivec2 q = ivec2(mod(c, 4.0));
  int i = q.x + q.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}

const vec4 CORE   = vec4(1.000, 0.957, 0.722, 1.0);
const vec4 YELLOW = vec4(1.000, 0.816, 0.251, 1.0);
const vec4 ORANGE = vec4(1.000, 0.541, 0.141, 1.0);
const vec4 RED    = vec4(0.824, 0.251, 0.110, 1.0);
const vec4 TIP    = vec4(0.353, 0.118, 0.078, 1.0);
const vec4 GLOW   = vec4(1.000, 0.416, 0.102, 1.0);
const vec4 SMOKE0 = vec4(0.180, 0.169, 0.165, 1.0) * 0.96;   // (fireball) premultiplied: dense, mid, thin (one flat alpha per band)
const vec4 SMOKE1 = vec4(0.290, 0.278, 0.267, 1.0) * 0.92;
const vec4 SMOKE2 = vec4(0.420, 0.408, 0.396, 1.0) * 0.86;
const vec3 EMBER  = vec3(0.520, 0.140, 0.070);
const vec3 CHAR   = vec3(0.150, 0.085, 0.065);

// FIREBALL: the v1 look, bit for bit (one art cell's colour, premultiplied)
vec4 cellFireball(vec2 c, vec4 f) {
  vec2 p = (c + vec2(uSeed, uSeed * 0.61)) / uGrid;   // grid squares
  float t = uTime;
  vec4 col = vec4(0.0);
  int band = 0;   // 5 core .. 1 tip
  if ( f.r > 0.0 ) {
    // tongues: narrow columns stretched upwards, rising ~1.6 squares a second; a finer noise rags their edges; a per-column flicker
    float n1 = vnoise(vec2(p.x * 3.2, p.y * 1.5 + t * 1.6));
    float n2 = vnoise(vec2(p.x * 9.0 + t * 0.5, p.y * 6.0 + t * 4.5));
    float fl = vnoise(vec2(p.x * 4.0, t * 3.0));
    float v = f.r * (0.35 + 0.85 * n1) + (n2 - 0.5) * 0.32 + (fl - 0.5) * 0.12;
    if ( v > 0.93 ) { col = CORE; band = 5; }
    else if ( v > 0.8 ) { col = YELLOW; band = 4; }
    else if ( v > 0.62 ) { col = ORANGE; band = 3; }
    else if ( v > 0.46 ) { col = RED; band = 2; }
    else if ( v > 0.38 ) { col = TIP; band = 1; }
    else if ( f.b > 0.25 && h21(c + floor(t * 2.0) * 3.1) > 0.96 ) { col = GLOW; band = 2; }   // a glowing speck on the burning ground
  }
  if ( f.g > 0.0 && band < 3 ) {
    // smoke: a slow noise carried along the plume; thin smoke dissolves by ordered-dither dropout, never by alpha
    vec2 q = (c - uFlow * t) / uGrid + vec2(uSeed * 0.37);
    float m = vnoise(q * 1.6) * 0.6 + vnoise(q * 4.2 + 7.0) * 0.4;
    float d = f.g * (0.5 + 0.9 * m);
    float th = bayer4(c);
    vec4 s = d > 0.68 ? SMOKE0 : d > 0.48 ? SMOKE1 : d > 0.24 + 0.24 * th ? SMOKE2 : vec4(0.0);
    if ( s.a > 0.0 && (band == 0 || (band == 1 && d > 0.7)) ) col = s;
  }
  return col;
}

// THE MAP under a cell (one texture fetch; vec4(0) without a background): for looks that blend into the map
vec4 mapColor(vec2 c) {
  if ( uHasMap == 0 ) return vec4(0.0);
  vec2 s = uCellGeo.xy + (floor(c) + 0.5) * uCellGeo.z;
  return texture(uMap, clamp((s - uMapRect.xy) / uMapRect.zw, 0.0, 1.0));
}
// how far a cell lies inside its area's rectangle, in grid squares (0 at the border): room for an edge ramp
float edgeIn(vec2 c) { return min(min(c.x, c.y), min(uSize.x - c.x, uSize.y - c.y)) / uGrid; }

// two noise frames of a "boiling" pattern cross-faded: it changes in place, nothing travels
float boil(vec2 p, float rate, float salt) {
  float tk = uTime * rate, k0 = floor(tk), kf = tk - k0;
  vec2 o0 = vec2(h21(vec2(k0, uSeed + salt)), h21(vec2(uSeed - salt, k0))) * 61.0;
  vec2 o1 = vec2(h21(vec2(k0 + 1.0, uSeed + salt)), h21(vec2(uSeed - salt, k0 + 1.0))) * 61.0;
  return mix(vnoise(p + o0), vnoise(p + o1), kf * kf * (3.0 - 2.0 * kf));
}

/* ======== FIRE STYLE: the look, in one place (swap this block for another look; the mechanics above / below stay) ========
 * LOOK PARAMETERS (per level: x = level 1, y = level 2, z = level 3) */
const float F_ROW = 0.16;                          // root rows, grid squares
const float F_COL = 0.22;                          // root columns, grid squares (~4.5 tongues a square)
const float F_RATE = 2.6;                          // licks a second
const vec3  F_SKIP = vec3(0.6, 0.12, 0.0);         // share of roots without a tongue (smouldering is sparse)
const vec3  F_WIDTH = vec3(0.4, 0.55, 0.72);       // tongue half-width, x a root column
const vec3  F_LEN = vec3(0.5, 1.0, 1.6);           // tongue length, x uFlameH
const vec3  F_HOT = vec3(-0.1, 0.0, 0.1);          // colour shift towards the core
const vec4  F_BANDS = vec4(0.2, 0.42, 0.66, 0.88); // core | yellow | orange | red | tip, by height + distance from the axis
const vec3  F_BED = vec3(0.82, 0.62, 0.44);        // bed glow thresholds: orange, red, ember (else char)
const vec3  F_ALPHA = vec3(0.7, 0.92, 1.0);        // flame opacity (level 1 delicate: the ground shows through)
const vec3  F_BED_ALPHA = vec3(0.45, 0.7, 0.88);   // bed (char, embers) opacity
const vec3  F_EDGE = vec3(0.35, 0.25, 0.2);        // bed edge ramp: where the bed is thinner than this, no char (a soft rim)
const vec3  S_EDGE = vec3(1.0, 0.8, 0.6);          // smoke edge ramp at the area's rectangle (grid squares)
const vec3  S_COVER = vec3(0.7, 0.66, 0.6);        // smoke coverage threshold (higher = sparser clumps, more map showing)
// smoke (x wisps, y plume, z column)
const vec3  S_SIZE = vec3(1.8, 1.3, 0.95);         // billow frequency (1 / squares)
const vec3  S_DENS = vec3(0.6, 0.8, 1.05);
const vec3  S_ALPHA_CORE = vec3(0.46, 0.68, 0.88), S_ALPHA_MID = vec3(0.34, 0.54, 0.76), S_ALPHA_EDGE = vec3(0.22, 0.4, 0.6);
const vec3  S_LIT1 = vec3(0.74, 0.73, 0.70), S_LIT2 = vec3(0.60, 0.58, 0.55), S_LIT3 = vec3(0.38, 0.36, 0.35);
const vec3  S_MID1 = vec3(0.60, 0.59, 0.57), S_MID2 = vec3(0.42, 0.41, 0.40), S_MID3 = vec3(0.22, 0.21, 0.21);
const vec3  S_SHD1 = vec3(0.46, 0.45, 0.44), S_SHD2 = vec3(0.25, 0.24, 0.24), S_SHD3 = vec3(0.10, 0.09, 0.09);
const vec3  S_UNDER = vec3(0.62, 0.27, 0.12);      // a billow's underside lit by the fire
float lv3(vec3 v, int l) { return l == 1 ? v.x : l == 3 ? v.z : v.y; }
vec3 lvC(vec3 a, vec3 b, vec3 c, int l) { return l == 1 ? a : l == 3 ? c : b; }

// the growth of the flames rooted at cell b (1 at rest): grown in, or sinking back into the base
float flameAt(ivec2 b) {
  if ( uAnim == 0 ) return 1.0;
  vec4 T = texelFetch(uTimes, b, 0) * 255.0;
  float g = 1.0, o = 1.0;
  if ( T.r > 0.5 ) { float a = uI.x - (T.r - 1.0) / 254.0 * uI.y; g = clamp(a / max(uDur.x, 0.01), 0.0, 1.0); g *= 2.0 - g; }
  if ( T.g < 254.5 ) { float a = uO.x - T.g / 254.0 * uO.y; o = 1.0 - clamp(a / max(uDur.y, 0.01), 0.0, 1.0); o *= o; }
  return g * o;
}

// FIRE: burning in place. Tongues are ROOTED on the burning ground: a fixed lattice of roots (rows and columns, each row shifted,
// each root jittered - hashes of its index: the roots never move). A root on the bed grows a tongue screen-up (leaning with the
// wind): its length licks up and down in place (two noise frames cross-faded), its width tapers to the tip, its edge wobbles, pieces
// split off above the tip and vanish. Nearer roots (lower on the screen) are drawn over farther ones. Under the tongues: the bed
// (f.b), char with embers that glow and boil in place. lvS the smoke level; bedA the char's opacity (going out); bed0 the bed before
// the going-out glow.
vec4 cellFire(vec2 c, vec4 f, int lvS, float bedA, float bed0) {
  vec4 col = vec4(0.0);
  int band = 0;
  float TH = max(2.0, floor(uGrid * F_ROW)), TW = max(2.0, floor(uGrid * F_COL));
  int K = min(14, int(ceil(uFlameH * F_LEN.z * 1.3 / TH)) + 1);
  bool hit = false;
  for ( int k = 14; k >= 0; k-- ) {
    if ( k > K || hit ) continue;
    float r = floor(c.y / TH) + float(k);
    float ro = h21(vec2(r, uSeed));
    float j0 = floor(c.x / TW + ro);
    for ( int dj = -1; dj <= 1; dj++ ) {
      float j = j0 + float(dj);
      float h1 = h21(vec2(j, r) + uSeed * 0.13), h2 = h21(vec2(r, j) + 7.1), h3 = h21(vec2(j * 1.7, r * 0.3) + 3.3);
      vec2 b = vec2((j - ro + 0.5 + (h1 - 0.5) * 0.7) * TW, (r + 0.15 + h2 * 0.7) * TH);
      float t = b.y - c.y;                                     // cells above the root
      if ( t < -1.5 ) continue;
      ivec2 bi = ivec2(floor(b));
      if ( bi.x < 0 || bi.y < 0 || bi.x >= int(uSize.x) || bi.y >= int(uSize.y) ) continue;
      vec4 fb = texelFetch(uField, bi, 0);
      if ( fb.b < 0.12 ) continue;
      int lv = (int(fb.a * 255.0 + 0.5) - 1) / 4 + 1;
      if ( h3 < lv3(F_SKIP, lv) ) continue;
      float heat = min(1.0, fb.b / (lv == 1 ? 0.74 : 1.0));
      float w = TW * lv3(F_WIDTH, lv) * (0.75 + 0.5 * h2);
      float dx0 = c.x - (b.x + uLean * max(t, 0.0));
      if ( abs(dx0) > w + TW * 0.6 ) continue;
      float lick = boil(vec2(j * 1.31 + r * 0.71, 0.5), F_RATE, 1.0);
      float len = uFlameH * lv3(F_LEN, lv) * heat * (0.45 + 0.8 * lick) * flameAt(bi);
      if ( len < 1.5 ) continue;
      float tt = t / len;
      if ( tt > 1.35 ) continue;
      float wob = (boil(vec2(j * 2.1 + r, tt * 2.2), F_RATE * 1.4, 2.0) - 0.5) * TW * 0.55 * max(tt, 0.0);
      float dx = abs(dx0 - wob);
      if ( tt <= 1.0 ) {
        float half_ = t < 0.0 ? w * 0.85 : w * pow(1.0 - tt, 0.65);
        if ( dx <= half_ ) {
          float e = max(tt, 0.0) + 0.45 * dx / max(half_, 0.5) - lv3(F_HOT, lv);
          if ( e < F_BANDS.x && lv > 1 ) { col = CORE; band = 5; }
          else if ( e < F_BANDS.y ) { col = YELLOW; band = 4; }
          else if ( e < F_BANDS.z ) { col = ORANGE; band = 3; }
          else if ( e < F_BANDS.w ) { col = RED; band = 2; }
          else { col = TIP; band = 1; }
          col *= lv3(F_ALPHA, lv);
          hit = true; break;
        }
      } else {
        // a piece split off above the tip: it shows for a frame or two and is gone
        float bit = h21(vec2(j, r) + floor(uTime * F_RATE * 1.5) * 1.7), at = 1.06 + 0.18 * bit;
        if ( bit > 0.45 && dx < max(0.8, w * 0.3) && abs(tt - at) < 0.05 ) { col = tt < 1.15 ? RED : TIP; band = 1; hit = true; break; }
      }
    }
  }
  // the BASE: the burning ground itself - char, dull embers and a glow that boils in place (it never moves)
  if ( band < 2 && bed0 > 0.02 ) {
    int lvB = (int(f.a * 255.0 + 0.5) - 1) / 4 + 1;
    float ba = lv3(F_BED_ALPHA, lvB);
    float eb = boil(c / uGrid * 5.0, 0.8, 4.0);
    float glow = f.b * (0.2 + 0.9 * eb);
    if ( glow > F_BED.x ) { col = ORANGE * ba; band = 2; }
    else if ( glow > F_BED.y ) { col = RED * ba; band = 2; }
    else if ( glow > F_BED.z && band == 0 ) col = vec4(EMBER, 1.0) * ba;
    else if ( band == 0 && bedA > 0.0 && bed0 > lv3(F_EDGE, lvB) ) col = vec4(CHAR, 1.0) * (ba * bedA);
  }
  // SMOKE: billows with a lit and a shadow side, see-through, thinning into clumps
  if ( f.g > 0.0 && band < 3 ) {
    float sc = lv3(S_SIZE, lvS);
    vec2 q = (c - uFlow * uTime) / uGrid + vec2(uSeed * 0.37, 0.0);
    vec2 q2 = (c - uFlow * uTime * 1.3) / uGrid + vec2(5.2, uSeed * 0.11);   // inner billows rise a little faster: they roll
    float lo = vnoise(q * sc), mi = vnoise(q2 * sc * 2.2 + 3.0), hi = vnoise(q2 * sc * 4.8 + 11.0);
    float bb = lo * 0.55 + mi * 0.3 + hi * 0.15;
    // (the field ends at the area's rectangle: the smoke thins to nothing over its last square, never a cut edge)
    float edge = clamp(edgeIn(c) / lv3(S_EDGE, lvS), 0.0, 1.0);
    float cover = bb + f.g * edge * lv3(S_DENS, lvS) * 0.8 - lv3(S_COVER, lvS);
    if ( cover > 0.0 && (band == 0 || cover > 0.2) ) {
      vec2 Ld = vec2(-0.12, -0.16) / sc;
      float sh = (vnoise((q + Ld) * sc) * 0.55 + vnoise((q2 + Ld) * sc * 2.2 + 3.0) * 0.3) - (lo * 0.55 + mi * 0.3);
      vec3 rgb = sh > 0.018 ? lvC(S_LIT1, S_LIT2, S_LIT3, lvS) : sh < -0.018 ? lvC(S_SHD1, S_SHD2, S_SHD3, lvS) : lvC(S_MID1, S_MID2, S_MID3, lvS);
      if ( sh < 0.0 && f.r > 0.05 ) rgb = mix(rgb, S_UNDER, 0.5);
      float a = cover > 0.2 ? lv3(S_ALPHA_CORE, lvS) : cover > 0.09 ? lv3(S_ALPHA_MID, lvS) : lv3(S_ALPHA_EDGE, lvS);
      if ( band > 0 ) a *= 0.45;                                // over the flames: thin, the fire stays readable
      col = vec4(rgb * a, a) + col * (1.0 - a);
    }
  }
  return col;
}
/* ======== end of the FIRE STYLE block ======== */

// one art cell's colour (premultiplied): the field, grown / going out, then the style
vec4 cellColor(vec2 c) {
  if ( c.x < 0.0 || c.y < 0.0 || c.x >= uSize.x || c.y >= uSize.y ) return vec4(0.0);
  vec4 f = texelFetch(uField, ivec2(c), 0);
  if ( f.a == 0.0 ) return vec4(0.0);
  float bedA = 1.0, bed0 = f.b;
  if ( uAnim == 1 ) {
    vec4 T = texelFetch(uTimes, ivec2(c), 0) * 255.0;
    float gF = 1.0, fo = 1.0, gS = 1.0, so = 1.0, glow = 1.0;
    if ( T.r > 0.5 ) { float a = uI.x - (T.r - 1.0) / 254.0 * uI.y; gF = clamp(a / max(uDur.x, 0.01), 0.0, 1.0); gF *= 2.0 - gF; glow = clamp(a * 3.0 / max(uDur.x, 0.01), 0.0, 1.0); bedA = glow; }
    if ( T.g < 254.5 ) {
      float a = uO.x - T.g / 254.0 * uO.y, O = max(uDur.y, 0.01);
      fo = 1.0 - clamp(a / O, 0.0, 1.0); fo *= fo;                     // the flames sink back into the base
      glow *= 1.0 - clamp((a - 0.3 * O) / (0.8 * O), 0.0, 1.0);        // the embers glow on a moment, then darken
      bedA *= 1.0 - clamp((a - 1.0 * O) / (0.5 * O), 0.0, 1.0);        // the char goes last
    }
    if ( T.b > 0.5 ) { float a = uI.x - (T.b - 1.0) / 254.0 * uI.y; gS = clamp(a / max(uDur.x, 0.01), 0.0, 1.0); }
    if ( T.a < 254.5 ) { float a = uO.x - T.a / 254.0 * uO.y; so = 1.0 - clamp(a / max(1.2 * uDur.y, 0.01), 0.0, 1.0); }   // the smoke lingers, thins
    f.r *= gF * fo; f.b *= glow; f.g *= gS * so;
    if ( f.r <= 0.0 && f.g <= 0.004 && bedA <= 0.0 ) return vec4(0.0);
  }
  if ( uStyle == 1 ) return cellFireball(c, f);
  int code = int(f.a * 255.0 + 0.5) - 1;
  return cellFire(c, f, code - (code / 4) * 4, bedA, bed0);
}

// the cells under the pixel's footprint, box-weighted (as sharpAxis of sharp-sampler.mjs, but each "texel" is a computed cell)
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
  if ( uK <= 0.0 || max(w.x, w.y) < 0.01 ) { fragColor = cellColor(floor(vCell)) * uAlpha; return; }
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
  fragColor = c * uAlpha;
}`;

let program = null;
const programOf = () => program ??= PIXI.Program.from(VERT, FRAG, "moinen-maps-fire-v2");

/** Is the edge sampler wanted (CONFIG.moinenMaps.zoomAA 'edge', the default)? -> the footprint scale. */
export function footprintK() {
  const cm = globalThis.CONFIG?.moinenMaps, m = cm?.zoomAA;
  return m === false || m === "mips" ? 0 : (cm?.edgeK ?? 1);
}

const texOf = (data, W, H) => PIXI.Texture.fromBuffer(data, W, H, { scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA });

/**
 * One area's quad: a PIXI.Mesh in scene coordinates (its rectangle of cells times the art pixel, from the art grid's origin), drawn
 * with the fire shader. `field` = model.raster's. `setTime(t)` per frame (a uniform); `setPhase(now)` while the area animates (two
 * uniforms); nothing else changes until the area does (then the owner makes a new one).
 */
export class FireMesh extends PIXI.Mesh {
  constructor(field, rect, geo, { flow = [0, -4], seed = 1, grid = 32, lean = 0, flameH = 25, dur = [1.6, 2.2], map = null } = {}) {
    const { ap, ox, oy } = geo, W = field.w, H = field.h;
    const x0 = ox + rect.x0 * ap, y0 = oy + rect.y0 * ap, x1 = x0 + W * ap, y1 = y0 + H * ap;
    const geom = new PIXI.Geometry()
      .addAttribute("aVertexPosition", [x0, y0, x1, y0, x1, y1, x0, y1], 2)
      .addAttribute("aCell", [0, 0, W, 0, W, H, 0, H], 2)
      .addIndex([0, 1, 2, 0, 2, 3]);
    const tex = texOf(field.data, W, H), times = field.times ? texOf(field.times, W, H) : null;
    const shader = new PIXI.Shader(programOf(), { uField: tex, uTimes: times ?? tex, uSize: new Float32Array([W, H]), uTime: 0, uFlow: new Float32Array(flow),
      uSeed: (seed % 997) + 0.5, uGrid: grid, uK: footprintK(), uAlpha: 1, uStyle: field.style === "fireball" ? 1 : 0, uLean: lean, uFlameH: flameH,
      uMap: map?.texture ?? tex, uMapRect: new Float32Array(map?.rect ?? [0, 0, 1, 1]), uHasMap: map ? 1 : 0, uCellGeo: new Float32Array([x0, y0, ap]),
      uAnim: times ? 1 : 0, uI: new Float32Array([0, 1]), uO: new Float32Array([0, 1]), uDur: new Float32Array(dur),
      translationMatrix: new PIXI.Matrix().toArray(true) });
    super(geom, shader);
    this.eventMode = "none";
    this.fieldTex = tex; this.timesTex = times; this.anim = field.anim;
    this.state.blendMode = PIXI.BLEND_MODES.NORMAL;   // premultiplied output
  }
  setTime(t) { this.shader.uniforms.uTime = t; }
  /** The area's grow / out clocks at shared time `now` (ms). */
  setPhase(now) {
    const a = this.anim; if ( !a ) return;
    const u = this.shader.uniforms;
    u.uI[0] = (now - a.iRef) / 1000; u.uI[1] = a.iSpan / 1000; u.uO[0] = (now - a.oRef) / 1000; u.uO[1] = a.oSpan / 1000;
  }
  _render(renderer) {
    const u = this.shader.uniforms;
    u.uAlpha = this.worldAlpha; u.uK = footprintK();
    super._render(renderer);
  }
  destroy(o) {
    const t = this.fieldTex, s = this.timesTex; this.fieldTex = this.timesTex = null;
    this.geometry?.destroy();
    super.destroy(o);
    t?.destroy(true); s?.destroy(true);
  }
}
