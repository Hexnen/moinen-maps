/**
 * GPU ERODE (PERF). An entering area's ruin used to be written pixel by pixel into a CPU buffer as the front passed (display.erode) and
 * the changed rows went to the GPU every frame: a whole-scene Detonate of 'map' sent ~470 MB of texSubImage2D in 2.4 s (~110 ms of
 * every second in the driver, and the long frames of its first 1.5 s). Here the ruin is a render texture (the same size, sampled the
 * same way) that a one-quad shader fills from three inputs, all of which already exist:
 *   - the area's atlas (its ruin's final pixels, premultiplied as the browser stored them) - nothing new is sent;
 *   - the clock: one RG8 texel a pixel, `moment + 1` in two bytes (R low, G high; 0 = the pixel never comes), made once from the
 *     sorted clock (the clock worker makes the bytes, clock-worker.mjs);
 *   - the stages' limits for this frame (a few uniforms).
 * A pixel's colour is the one erode gave it: the latest STAGE it has reached - a constant mix of its final colour (a look-up row, the
 * very table display.lutOf makes, byte for byte), a hash-picked pair of colours (hash2 ported to unsigned 32-bit maths, same bits), or
 * its final colour (the last stage; also every pixel that is not fully opaque). "Reached" is the CPU's own test: the sort key
 * moment * 2^20 + pixel below (max(0, el - dt) + 1) * 2^20, split into an integer moment and a fraction so single precision is exact.
 * Nothing is ever read back; the CPU keeps only the cursors (binary searches) for the edge particles and the entry's end.
 * `CONFIG.moinenMaps.noGpuErode = true`: the CPU path (A/B). A cave-in's stages (collapse-entry.mjs) are closures over a per-pixel mask:
 * those entries stay on the CPU path.
 */
export const MAX_STAGES = 6;
const LUT_ROWS = 256;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uAtlas;
uniform sampler2D uTime;
uniform sampler2D uLut;
uniform vec4 uFrame;          // the ruin's frame of the atlas: x, y, w, h (texels)
uniform int uN;               // stages (the last one is the pixel's own colour)
uniform vec4 uLim[${MAX_STAGES}];       // per stage: whole part of its limit moment, its fraction in key units (2^20)
uniform ivec4 uH[${MAX_STAGES}];        // per stage: kind (0 look-up row, 1 hash pair), row / salt, hash limit (bits of an unsigned)
uniform vec4 uA[${MAX_STAGES}];         // colour A (bytes)
uniform vec4 uB[${MAX_STAGES}];         // colour B (bytes)
out vec4 o;

uint hash2u(int x, int y, int s) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(s) * 1274126177u;
  h = (h ^ (h >> 13u)) * 1103515245u;
  h ^= h >> 16u;
  return h;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 tt = texelFetch(uTime, p, 0);
  float tv = floor(tt.r * 255.0 + 0.5) + floor(tt.g * 255.0 + 0.5) * 256.0;
  if (tv < 0.5) { o = vec4(0.0); return; }
  int w = int(uFrame.z);
  int i = p.y * w + p.x;
  float fi = float(i);
  float hi = floor(fi / 1048576.0);
  float kHi = tv - 1.0 + hi, kLo = fi - hi * 1048576.0;
  int s = -1;
  for (int j = 0; j < ${MAX_STAGES}; j++) {
    if (j >= uN) break;
    if (kHi < uLim[j].x || (kHi == uLim[j].x && kLo < uLim[j].y)) s = j; else break;
  }
  if (s < 0) { o = vec4(0.0); return; }
  vec4 px = texelFetch(uAtlas, ivec2(uFrame.xy) + p, 0);
  if (s >= uN - 1 || px.a < 0.999) { o = px; return; }
  if (uH[s].x == 1) {
    uint h = hash2u(i, uH[s].z, 5);
    o = vec4((h < uint(uH[s].w) ? uA[s].rgb : uB[s].rgb) / 255.0, 1.0);
    return;
  }
  vec3 v = floor(px.rgb * 255.0 + 0.5);
  int row = uH[s].y;
  o = vec4(texelFetch(uLut, ivec2(int(v.r), row), 0).r, texelFetch(uLut, ivec2(int(v.g), row), 0).g, texelFetch(uLut, ivec2(int(v.b), row), 0).b, 1.0);
}`;

export class ErodeGPU {
  static supported(renderer) {
    return !!renderer?.gl && renderer.context?.webGLVersion >= 2 && !globalThis.CONFIG?.moinenMaps?.noGpuErode;
  }

  constructor() {
    this.rows = new Map();              // "c|t" -> LUT row
    this.lut = new Uint8Array(256 * LUT_ROWS * 4);
    this.lutTex = null;
    this.shader = null; this.geom = null; this.state = null;
    this.passes = 0; this.ms = 0;
  }

  /** The look-up row of a constant mix [c, t]: the same three tables as display.lutOf; -1 when the rows are used up. */
  rowOf(mix, lutOf) {
    const key = `${mix[0]}|${mix[1]}`;
    let r = this.rows.get(key);
    if ( r !== undefined ) return r;
    if ( this.rows.size >= LUT_ROWS ) return -1;
    r = this.rows.size; this.rows.set(key, r);
    const L = lutOf(mix);
    for ( let v = 0; v < 256; v++ ) { const q = (r * 256 + v) * 4; this.lut[q] = L[0][v]; this.lut[q + 1] = L[1][v]; this.lut[q + 2] = L[2][v]; this.lut[q + 3] = 255; }
    if ( this.lutTex ) this.lutTex.update();
    return r;
  }

  init() {
    if ( this.shader ) return;
    this.lutTex = new PIXI.BaseTexture(new PIXI.BufferResource(this.lut, { width: 256, height: LUT_ROWS }), {
      width: 256, height: LUT_ROWS, scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.NPM,
      format: PIXI.FORMATS.RGBA, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP });
    this.geom = new PIXI.Geometry().addAttribute("aPos", new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2);
    this.state = new PIXI.State(); this.state.blend = false; this.state.depthTest = false; this.state.culling = false;
    this.shader = PIXI.Shader.from(VERT, FRAG, {
      uAtlas: PIXI.Texture.WHITE.baseTexture, uTime: PIXI.Texture.WHITE.baseTexture, uLut: this.lutTex,
      uFrame: new Float32Array(4), uN: 0, uLim: new Float32Array(MAX_STAGES * 4), uH: new Int32Array(MAX_STAGES * 4),
      uA: new Float32Array(MAX_STAGES * 4), uB: new Float32Array(MAX_STAGES * 4) });
  }

  /** A render texture the size of the ruin, sampled like the buffer texture it replaces (`filter`). */
  makeTarget(w, h, filter) {
    const base = new PIXI.BaseRenderTexture({ width: w, height: h, scaleMode: filter, mipmap: PIXI.MIPMAP_MODES.OFF, resolution: 1 });
    base.alphaMode = PIXI.ALPHA_MODES.PMA;
    return { base, tex: new PIXI.RenderTexture(base) };
  }

  /** The clock as a texture from entry-clock timeBytes (RG8, moment + 1 in two bytes, rows padded to an even width). */
  timeTexture(u8, w, h) {
    const tw = w + (w & 1);
    return new PIXI.BaseTexture(new PIXI.BufferResource(u8, { width: tw, height: h }), {
      width: tw, height: h, scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF, alphaMode: PIXI.ALPHA_MODES.NPM,
      format: PIXI.FORMATS.RG, type: PIXI.TYPES.UNSIGNED_BYTE, wrapMode: PIXI.WRAP_MODES.CLAMP });
  }

  /**
   * Fill `target` (a makeTarget().tex) for the stages at `el` ms: `gs` { n, H, A, B } from display (stage tables), `lim` Float32Array
   * (the limits), `atlas` the area's atlas BaseTexture, `fr` the ruin's frame in it, `time` the clock texture.
   */
  pass(renderer, target, gs, lim, atlas, fr, time) {
    this.init();
    const t0 = performance.now();
    const u = this.shader.uniforms;
    u.uAtlas = atlas; u.uTime = time; u.uN = gs.n;
    u.uFrame[0] = fr.x; u.uFrame[1] = fr.y; u.uFrame[2] = fr.width; u.uFrame[3] = fr.height;
    u.uLim = lim; u.uH = gs.H; u.uA = gs.A; u.uB = gs.B;
    renderer.batch.flush();
    renderer.renderTexture.bind(target);
    renderer.state.set(this.state);
    renderer.shader.bind(this.shader);
    renderer.geometry.bind(this.geom, this.shader);
    renderer.geometry.draw(PIXI.DRAW_MODES.TRIANGLE_STRIP, 4, 0);
    this.passes++; this.ms += performance.now() - t0;
  }

  destroy() {
    this.shader?.destroy(); this.geom?.destroy(); this.lutTex?.destroy(); this.shader = this.geom = this.lutTex = null;
  }
}
