/**
 * CELL CACHE for a weather pass whose look is one value per ART CELL (the ground, the haze; research 7, cost 2026-11-08).
 *
 * Such a pass ran its whole cell function for every SCREEN pixel: at zoom 3 and DPR 2 one art cell covers ~56 device px, all of them
 * computing the same value. Instead, while a cell is bigger than CELL_MIN device px across, each frame:
 *   CELL PASS  the cell function once per art cell over the view (+ a margin) into a float render texture (RGBA32F, blend off: the
 *              value stored is the fragment's value exactly), in the ticker, before the stage renders;
 *   SHOW PASS  the stage mesh as before, its cell function replaced by a texel fetch (the same footprint filter at cell edges).
 * Zoomed out (a cell smaller than that) the pass draws directly, as it always did.
 *
 * EXACTNESS: a pixel inside one cell gets exactly the value the direct pass computed (same expression, float storage). A pixel on a
 * cell edge (the footprint filter mixes up to 2 x 2 cells) mixes each neighbour's OWN value; the direct pass evaluated a neighbour
 * with the smooth fields of the pixel's own cell (a shortcut), so the two can differ where a smooth field crosses a threshold
 * exactly between two cells, by part of one band step on that edge pixel (measured: dev/weather-cost.mjs `ab`).
 *
 * The source shader must have: `in vec2 vCell`, a fields function `F(c)` filling globals, a cell function `vec4 G(c)`, and its
 * footprint `main()` starting at `void axisW(` (glsl.mjs GROUND_FRAG, fx-glsl.mjs HAZE_FRAG).
 * CONFIG.moinenMaps.weatherCells: false = always direct (the A/B switch); a number = the CELL_MIN override.
 */
export const CELL_MIN = 1.6;
/** At most this many cells cached (16 bytes each: ~48 MB; a 4K window at DPR 1 zoomed to just over CELL_MIN): more draws directly. */
export const MAX_CELLS = 3e6;

/** The cell pass: the source's prefix (everything before its footprint code) and a main that evaluates one cell per fragment. */
export function cellFrag(src, fields, cell) {
  const head = src.slice(0, src.indexOf("void axisW("));
  return `${head}
uniform vec2 uCellO;         // the art cell of texel (0, 0)
void main() {
  vec2 c = uCellO + floor(gl_FragCoord.xy);
  ${fields}(c);
  fragColor = ${cell}(c);
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

/** The show pass: the footprint filter of the direct pass over the cached cells (the same arithmetic). */
export const SHOW_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vCell;
uniform float uK;
uniform float uAlpha;
uniform sampler2D uCells;
uniform vec2 uCellO;
uniform vec2 uCellN;
out vec4 fragColor;
vec4 cellAt(vec2 c) {
  ivec2 q = clamp(ivec2(c - uCellO), ivec2(0), ivec2(uCellN) - 1);
  return texelFetch(uCells, q, 0);
}
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
  vec4 c;
  if ( uK <= 0.0 || max(w.x, w.y) < 0.01 ) c = cellAt(floor(vCell));
  else {
    w = clamp(w, vec2(0.01), vec2(2.0));
    float ix, iy; vec3 ax, ay;
    axisW(vCell.x, w.x, ix, ax); axisW(vCell.y, w.y, iy, ay);
    c = vec4(0.0);
    for ( int j = 0; j < 3; j++ ) {
      float wy = ay[j]; if ( wy <= 0.0 ) continue;
      for ( int i = 0; i < 3; i++ ) {
        float wx = ax[i]; if ( wx <= 0.0 ) continue;
        c += wx * wy * cellAt(vec2(ix + float(i), iy + float(j)));
      }
    }
  }
  fragColor = vec4(c.rgb * uAlpha, 1.0 - uAlpha * (1.0 - c.a));
}`;

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
  constructor(mesh, cellProg, showProg) {
    this.mesh = mesh; this.direct = mesh.shader;
    const u = this.direct.uniforms;
    u.uCellO = new Float32Array(2); u.uCellN = new Float32Array([1, 1]); u.uCells = PIXI.Texture.WHITE;
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
      this.rt = PIXI.RenderTexture.create({ width: W, height: H, resolution: 1, type: PIXI.TYPES.FLOAT, format: PIXI.FORMATS.RGBA,
        scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF });
    }
    const u = this.direct.uniforms;
    u.uCellO[0] = x0; u.uCellO[1] = y0; u.uCellN[0] = w; u.uCellN[1] = h; u.uCells = this.rt;
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
    RT.bind(cur, sf, df);
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
