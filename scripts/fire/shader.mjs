/**
 * The GPU body of FIRE AND SMOKE: one quad per area, its field (scripts/fire/model.mjs `raster`: R heat, G smoke, B burning ground) a
 * small NEAREST texture of one texel per art cell. The fragment shader works on WHOLE ART CELLS: the colour of a cell is a function of
 * (cell, field, time) only - procedural value noise rising up the screen, quantised to a small palette (flat bands, no gradients, no
 * soft alpha), so it is real pixel art on the same art grid as the destruction layer (display.ap / display.origin).
 *
 * CRISP AT ANY ZOOM, the module's way (sharp-sampler.mjs): a screen pixel's colour is the exact BOX average of the cells under its
 * footprint (fwidth of the cell coordinate): magnified, a cell's edge gets one pixel of anti-aliasing and its inside stays flat; at
 * an integer ratio it IS nearest; minified up to 2 cells per pixel the box is exact (at most 3 x 3 cells evaluated), beyond that the
 * footprint is clamped (the flames shimmer a little when zoomed far out; they move anyway). `CONFIG.moinenMaps.zoomAA` false / 'mips':
 * one evaluation at the pixel's cell (nearest), as the old sampling. `CONFIG.moinenMaps.edgeK` scales the footprint as for the sampler.
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
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uFlow;      // the smoke's drift (cells per second): along the plume
uniform float uSeed;
uniform float uGrid;     // cells per grid square: the noise is sized in squares, the art in cells
uniform float uK;        // footprint scale: 0 = nearest, 1 = the exact box
uniform float uAlpha;
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
const vec4 SMOKE0 = vec4(0.180, 0.169, 0.165, 1.0) * 0.96;   // premultiplied: dense, mid, thin (one flat alpha per band)
const vec4 SMOKE1 = vec4(0.290, 0.278, 0.267, 1.0) * 0.92;
const vec4 SMOKE2 = vec4(0.420, 0.408, 0.396, 1.0) * 0.86;

// one art cell's colour (premultiplied)
vec4 cellColor(vec2 c) {
  if ( c.x < 0.0 || c.y < 0.0 || c.x >= uSize.x || c.y >= uSize.y ) return vec4(0.0);
  vec4 f = texelFetch(uField, ivec2(c), 0);
  if ( f.a == 0.0 ) return vec4(0.0);
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
const programOf = () => program ??= PIXI.Program.from(VERT, FRAG, "moinen-maps-fire");

/** Is the edge sampler wanted (CONFIG.moinenMaps.zoomAA 'edge', the default)? -> the footprint scale. */
export function footprintK() {
  const cm = globalThis.CONFIG?.moinenMaps, m = cm?.zoomAA;
  return m === false || m === "mips" ? 0 : (cm?.edgeK ?? 1);
}

/**
 * One area's quad: a PIXI.Mesh in scene coordinates (its rectangle of cells times the art pixel, from the art grid's origin), drawn
 * with the fire shader. `field` = { w, h, data } (model.raster). `setTime(t)` per frame (a uniform), nothing else changes until the
 * area does (then the owner makes a new one).
 */
export class FireMesh extends PIXI.Mesh {
  constructor(field, rect, geo, { flow = [0, -4], seed = 1, grid = 32 } = {}) {
    const { ap, ox, oy } = geo, W = field.w, H = field.h;
    const x0 = ox + rect.x0 * ap, y0 = oy + rect.y0 * ap, x1 = x0 + W * ap, y1 = y0 + H * ap;
    const geom = new PIXI.Geometry()
      .addAttribute("aVertexPosition", [x0, y0, x1, y0, x1, y1, x0, y1], 2)
      .addAttribute("aCell", [0, 0, W, 0, W, H, 0, H], 2)
      .addIndex([0, 1, 2, 0, 2, 3]);
    const tex = PIXI.Texture.fromBuffer(field.data, W, H, { scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.NO_PREMULTIPLIED_ALPHA });
    const shader = new PIXI.Shader(programOf(), { uField: tex, uSize: new Float32Array([W, H]), uTime: 0, uFlow: new Float32Array(flow), uSeed: (seed % 997) + 0.5, uGrid: grid, uK: footprintK(), uAlpha: 1, translationMatrix: new PIXI.Matrix().toArray(true) });
    super(geom, shader);
    this.eventMode = "none";
    this.fieldTex = tex;
    this.state.blendMode = PIXI.BLEND_MODES.NORMAL;   // premultiplied output
  }
  setTime(t) { this.shader.uniforms.uTime = t; }
  _render(renderer) {
    const u = this.shader.uniforms;
    u.uAlpha = this.worldAlpha; u.uK = footprintK();
    super._render(renderer);
  }
  destroy(o) {
    const t = this.fieldTex; this.fieldTex = null;
    this.geometry?.destroy();
    super.destroy(o);
    t?.destroy(true);
  }
}
