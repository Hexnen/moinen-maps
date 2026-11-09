/**
 * CELL CACHE for a weather pass whose look is a smooth field at ART resolution (the ground, the haze; research 7, cost 2026-11-08).
 *
 * Such a pass ran its whole function for every SCREEN pixel: at zoom 3 and DPR 2 one art cell covers ~56 device px. Instead, while a
 * cell is bigger than CELL_MIN device px across, each frame:
 *   CELL PASS  the function once per art cell (at the cell's CENTRE) over the view (+ a margin) into a render texture (blend off), in the
 *              ticker, before the stage renders;
 *   SHOW PASS  the stage mesh as before, its function replaced by a SMOOTH read of the cached cells (a cubic B-spline: the weather's
 *              fields are smooth, so is their magnification; no cell corner shows), plus what the source draws per screen px on top
 *              (`extra`: the ground's glints). (`smooth: false`, the tornado's ground: one value per cell, a texelFetch.)
 * Zoomed out (a cell smaller than that) the pass draws directly: the same function once per screen px at the px's own point.
 *
 * Since 2026-11-09 the functions are band-limited (soft thresholds, smooth noise instead of per-cell dithers), so a bilinear read of
 * their cell values and the direct pass agree to within the interpolation of a smooth field (no longer bit-exact: the old pixel-art
 * look had one value per cell, now nothing is drawn in cells).
 *
 * The source shader must have: `in vec2 vCell`, a fields function `F(c)` filling globals, a function `vec4 G(c)`, and its direct
 * `main()` after a line `// ---- main` (glsl.mjs GROUND_FRAG, fx-glsl.mjs HAZE_FRAG).
 * CONFIG.moinenMaps.weatherCells: false = always direct (the A/B switch); a number = the CELL_MIN override.
 */
import { bindBack } from "./rt-bind.mjs";

export const CELL_MIN = 1.6;
/** At most this many cells cached (16 bytes each: ~48 MB; a 4K window at DPR 1 zoomed to just over CELL_MIN): more draws directly. */
export const MAX_CELLS = 3e6;

const headOf = (src) => src.slice(0, src.indexOf("// ---- main"));

/** The cell pass: the source's functions and a main that evaluates one cell (at its centre) per fragment. */
export function cellFrag(src, fields, cell) {
  return `${headOf(src)}
uniform vec2 uCellO;         // the art cell of texel (0, 0)
void main() {
  vec2 c = uCellO + floor(gl_FragCoord.xy) + 0.5;
  ${fields}(c);
  fragColor = ${cell}(c);
}`;
}

/** The show pass of a cached source: a smooth (cubic B-spline) read of the cells (texel centres = cell centres; four bilinear taps of
 * the half-float texture), then `extra` (GLSL statements on `vec4 f` at `vec2 c`, the px's art point), then the layer's fade. A bilinear
 * read alone still showed the cells as soft diamonds where a field turns within a cell or two; the B-spline has no such corners. */
export function showFrag(src, extra = "") {
  return `${headOf(src)}
uniform sampler2D uCells;
uniform vec2 uCellO;
uniform vec2 uCellSz;        // the cache texture's size (texels)
${BSP}
void main() {
  vec2 c = vCell;
  vec4 f = bspline(uCells, c - uCellO, uCellSz);
  ${extra}
  fragColor = vec4(f.rgb * uAlpha, 1.0 - uAlpha * (1.0 - f.a));
}`;
}

/** The cell pass's vertex shader; `v` = a varying the source fragment shader declares and statically uses (a helper it never calls
 * still counts), written here so the two link (its value is not used). */
export const cellVert = (v = null) => `#version 300 es
precision highp float;
in vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
${v ? `out vec2 ${v};` : ""}
void main() { gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);${v ? ` ${v} = aVertexPosition;` : ""} }`;
export const CELL_VERT = cellVert();

const BSP = `vec4 bsp(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v, s = n * n * n;
  float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) / 6.0;
}
// a cubic B-spline read of texture t at texel-space point u (texel i's centre at i + 0.5), size sz: four bilinear taps
vec4 bspline(sampler2D t, vec2 u, vec2 sz) {
  vec2 g = u - 0.5, i = floor(g), w = g - i;
  vec4 xc = bsp(w.x), yc = bsp(w.y);
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (i.xxyy + vec2(-0.5, 1.5).xyxy + vec4(xc.yw, yc.yw) / s) / sz.xxyy;
  float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
  return mix(mix(texture(t, o.yw), texture(t, o.xw), sx), mix(texture(t, o.yz), texture(t, o.xz), sx), sy);
}`;
export const GLSL_BSPLINE = BSP;

/** The smooth show pass of a pass whose cached value is its final colour (the tornado's ground): a B-spline read of the cells. */
export function showSmooth(v) {
  return `#version 300 es
precision highp float;
precision highp int;
in vec2 ${v};
uniform sampler2D uCells;
uniform vec2 uCellO;
uniform vec2 uCellSz;
out vec4 fragColor;
${BSP}
void main() { fragColor = bspline(uCells, ${v} - uCellO, uCellSz); }`;
}

/** The show pass of a pass with NO footprint filter (one value per cell, e.g. the tornado's ground): a fetch of the cell under the
 * pixel (`v` = the source's cell varying). The cached value is the source's final colour. */
export function showNearest(v) {
  return `#version 300 es
precision highp float;
precision highp int;
in vec2 ${v};
uniform sampler2D uCells;
uniform vec2 uCellO;
uniform vec2 uCellN;
out vec4 fragColor;
void main() {
  ivec2 q = clamp(ivec2(floor(${v}) - uCellO), ivec2(0), ivec2(uCellN) - 1);
  fragColor = texelFetch(uCells, q, 0);
}`;
}

const MARGIN = 3;
const IDENT = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);    // cells around the view (the footprint reaches one; the rest is slack)
const STEP = 128;    // the texture grows in steps of this (never shrinks while the pass lives)

/**
 * One cached pass. `mesh` is the stage mesh (its shader = the direct pass); `cellProg` / `showProg` the two programs made from it.
 * The three shaders share ONE uniforms object (the mesh's): whatever the display sets reaches all of them.
 */
export class CellCache {
  constructor(mesh, cellProg, showProg, { smooth = false } = {}) {
    this.smooth = smooth;   // (a smooth show pass: a half-float texture read LINEAR; else float32 read by texelFetch)
    this.mesh = mesh; this.direct = mesh.shader;
    const u = this.direct.uniforms;
    u.uCellO = new Float32Array(2); u.uCellN = new Float32Array([1, 1]); u.uCellSz = new Float32Array([1, 1]); u.uCells = PIXI.Texture.WHITE;
    this.cellShader = new PIXI.Shader(cellProg, u);
    this.showShader = new PIXI.Shader(showProg, u);
    this.quad = new PIXI.Geometry().addAttribute("aVertexPosition", new Float32Array(8), 2).addIndex([0, 1, 2, 0, 2, 3]);
    const st = PIXI.State.for2d(); st.blend = false; st.depthTest = false; st.culling = false;
    this.pass = new PIXI.Mesh(this.quad, this.cellShader, st);
    this.rt = null; this.on = false;
    const gl = canvas.app.renderer.gl;
    this.ok = !!gl?.getExtension("EXT_color_buffer_float");
    this.stats = { on: false, cells: 0, w: 0, h: 0 };
    // (both programs compiled now, with the pass's other programs, not on the first frame the view zooms in: a hitch otherwise)
    if ( this.ok ) try { const r = canvas.app.renderer; r.shader.bind(this.cellShader, true); r.shader.bind(this.showShader, true); r.shader.reset(); } catch { /* compiled on first use */ }
  }

  /** The device px across one art cell now. */
  static pxPerCell(ap) { return Math.abs(canvas.stage.worldTransform.a) * ap * (canvas.app.renderer.resolution || 1); }

  /**
   * Per frame, while the mesh is visible: cache (render the cell pass over the view) or draw directly. `geo` the art grid, `v` the
   * view rect (scene px); `clip` = [x0, y0, x1, y1] art cells the mesh covers (default: the whole scene). Returns whether the cache is on.
   */
  update(geo, v, clip = null) {
    const cfg = globalThis.CONFIG?.moinenMaps?.weatherCells, min = typeof cfg === "number" ? cfg : CELL_MIN;
    const want = this.ok && cfg !== false && this.mesh.visible && CellCache.pxPerCell(geo.ap) >= min;
    if ( !want ) { this.use(false); return false; }
    const ap = geo.ap;
    let x0 = Math.max(-MARGIN, Math.floor((v.x0 - geo.ox) / ap) - MARGIN), y0 = Math.max(-MARGIN, Math.floor((v.y0 - geo.oy) / ap) - MARGIN);
    let x1 = Math.min(geo.aw + MARGIN, Math.ceil((v.x1 - geo.ox) / ap) + MARGIN), y1 = Math.min(geo.ah + MARGIN, Math.ceil((v.y1 - geo.oy) / ap) + MARGIN);
    if ( clip ) { x0 = Math.max(x0, Math.floor(clip[0]) - 1); y0 = Math.max(y0, Math.floor(clip[1]) - 1); x1 = Math.min(x1, Math.ceil(clip[2]) + 1); y1 = Math.min(y1, Math.ceil(clip[3]) + 1); }
    const w = x1 - x0, h = y1 - y0;
    if ( w <= 0 || h <= 0 || w * h > MAX_CELLS ) { this.use(false); return false; }
    if ( !this.rt || this.rt.width < w || this.rt.height < h ) {
      const W = Math.max(this.rt?.width ?? 0, Math.ceil(w / STEP) * STEP), H = Math.max(this.rt?.height ?? 0, Math.ceil(h / STEP) * STEP);
      this.rt?.destroy(true);
      this.rt = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1, type: this.smooth ? PIXI.TYPES.HALF_FLOAT : PIXI.TYPES.FLOAT,
        format: PIXI.FORMATS.RGBA, scaleMode: this.smooth ? PIXI.SCALE_MODES.LINEAR : PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF });
    }
    const u = this.direct.uniforms;
    u.uCellO[0] = x0; u.uCellO[1] = y0; u.uCellN[0] = w; u.uCellN[1] = h; u.uCellSz[0] = this.rt.width; u.uCellSz[1] = this.rt.height; u.uCells = this.rt;
    const qb = this.quad.getBuffer("aVertexPosition"), b = qb.data;
    b[0] = 0; b[1] = 0; b[2] = w; b[3] = 0; b[4] = w; b[5] = h; b[6] = 0; b[7] = h; qb.update();
    this.draw();
    this.use(true);
    this.stats.cells = w * h; this.stats.w = w; this.stats.h = h;
    return true;
  }

  /**
   * The cell pass into the texture with PIXI's systems directly (renderer.render would also run the render runners, a transform
   * update and a projection for a one-quad draw: most of this pass's CPU): bind the target, draw the quad, bind back what was bound.
   */
  draw() {
    const r = canvas.app.renderer, RT = r.renderTexture, u = this.direct.uniforms;
    r.batch.flush();
    const cur = RT.current, sf = (this._sf ??= new PIXI.Rectangle()).copyFrom(RT.sourceFrame), df = (this._df ??= new PIXI.Rectangle()).copyFrom(RT.destinationFrame);
    RT.bind(this.rt);
    u.translationMatrix = IDENT;
    r.shader.bind(this.cellShader);
    r.state.set(this.pass.state);
    r.geometry.bind(this.quad, this.cellShader);
    r.geometry.draw(PIXI.DRAW_MODES.TRIANGLES, 6, 0);
    bindBack(RT, cur, sf, df);
  }

  use(on) {
    if ( on === this.on ) return;
    this.on = on; this.stats.on = on;
    this.mesh.shader = on ? this.showShader : this.direct;
  }

  destroy() {
    this.use(false);
    this.pass.destroy(); this.quad.destroy();
    this.rt?.destroy(true); this.rt = null;
  }
}
