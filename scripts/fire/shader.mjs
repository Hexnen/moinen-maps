/**
 * The GPU body of FIRE AND SMOKE: one quad per area, its field (scripts/fire/model.mjs `raster`: R heat, G smoke, B burning ground, A
 * the levels) a small NEAREST texture of one texel per art cell. The fragment shader works on WHOLE ART CELLS: the colour of a cell is
 * a function of (cell, field, time) only - procedural noise quantised to a small palette (flat bands, no gradients), so it is real
 * pixel art on the same art grid as the destruction layer (display.ap / display.origin).
 *
 * THE FIREBALL STYLE: the layer's first look (a rolling ball of fire, its smoke), kept bit for bit (`cellFireball` is the v1 code).
 * The default FIRE style moved to its own art-resolution renderer (art.mjs, research recipe phase A); this file keeps the fireball,
 * the footprint sampler and the shared helpers.
 *
 * COLOUR: the palette (CORE .. CHAR, the smoke's lit underside) is the uniform array uPal, derived per area from its fire's base colour
 * on the CPU by look.mjs (rampOf: the swappable rule; the natural orange gives the old constants exactly, so the fireball's default
 * output is unchanged). The smoke stays neutral unless the scene's smoke tint (uSmokeTint) mixes it towards the fire's hue.
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

import { rampOf, NATURAL } from "./look.mjs";

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
uniform vec4 uPal[9];    // THE FIRE'S PALETTE, derived on the CPU from its base colour (look.mjs rampOf: core, yellow, orange, red,
                         // tip, glow, ember, char, smoke underside); the natural fire's are the old constants exactly
uniform vec4 uSmokeTint; // rgb: the fire's hue for the smoke, a: how much (0 = neutral smoke, bit for bit)
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

// the palette (uPal: natural = 1.000 0.957 0.722 | 1.000 0.816 0.251 | 1.000 0.541 0.141 | 0.824 0.251 0.110 | 0.353 0.118 0.078 |
// 1.000 0.416 0.102 | 0.520 0.140 0.070 | 0.150 0.085 0.065)
#define CORE   uPal[0]
#define YELLOW uPal[1]
#define ORANGE uPal[2]
#define RED    uPal[3]
#define TIP    uPal[4]
#define GLOW   uPal[5]
#define EMBER  uPal[6].rgb
#define CHAR   uPal[7].rgb
#define S_UNDER uPal[8].rgb   // a billow's underside lit by the fire (natural 0.62 0.27 0.12)
// smoke tinted towards the fire's hue (its luminance kept); amount 0 returns the colour untouched
vec3 tintSmoke(vec3 c) {
  if ( uSmokeTint.a <= 0.0 ) return c;
  float L = dot(c, vec3(0.3, 0.59, 0.11)), tl = max(0.05, dot(uSmokeTint.rgb, vec3(0.3, 0.59, 0.11)));
  return mix(c, min(vec3(1.0), L * uSmokeTint.rgb / tl), uSmokeTint.a);
}
vec4 tintSmokeP(vec4 p) { return uSmokeTint.a <= 0.0 ? p : vec4(tintSmoke(p.rgb / p.a) * p.a, p.a); }   // (premultiplied)
#define SMOKE0 tintSmokeP(vec4(0.180, 0.169, 0.165, 1.0) * 0.96)   // (fireball) premultiplied: dense, mid, thin (one flat alpha per band)
#define SMOKE1 tintSmokeP(vec4(0.290, 0.278, 0.267, 1.0) * 0.92)
#define SMOKE2 tintSmokeP(vec4(0.420, 0.408, 0.396, 1.0) * 0.86)

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

/* (the FIRE style's look lives in art.mjs: this shader draws only the fireball) */

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
  return cellFireball(c, f);
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
  constructor(field, rect, geo, { flow = [0, -4], seed = 1, grid = 32, lean = 0, flameH = 25, dur = [1.6, 2.2], map = null, smokeTint = 0 } = {}) {
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
      uPal: new Float32Array(rampOf(field.color ?? NATURAL).uniforms), uSmokeTint: new Float32Array([...rampOf(field.color ?? NATURAL).tint, smokeTint]),
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
