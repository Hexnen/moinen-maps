/**
 * A MAP PATCH without a sprite mask (PERF). A later stroke lays the plain map over older damage under its own pixels: before, the
 * full-map sprite was masked by the stroke's cover sprite (PIXI sprite mask = a filter pass with its own framebuffer per patch: ~150
 * passes per frame on a busy scene, most of the layer's GPU time and a good part of its CPU time). Here one quad over the cover is
 * drawn with a shader that samples the map and the cover together:
 *   colour = map(at this point) * cover.r   (what PIXI's SpriteMaskFilter does for a premultiplied mask: original *= masky.r)
 * with the same textures and their own sampling modes, so the pixels are those of the masked sprite.
 *
 * The container keeps the old shape [map sprite, mask sprite] (callers swap the mask's texture for a dissolve: entries, erase strokes);
 * neither child is drawn itself, `render` reads their current texture and transform each frame.
 */
import { SHARP_SAMPLER_GLSL } from "./sharp-sampler.mjs";
import { sharpBatch } from "./sharp-batch.mjs";

const VERT = `#version 300 es
precision highp float;
in vec2 aVertexPosition;
in vec2 aMaskCoord;
in vec2 aMapCoord;
uniform mat3 projectionMatrix;
out vec2 vMask;
out vec2 vMap;
void main() {
  gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vMask = aMaskCoord;
  vMap = aMapCoord;
}`;
const FRAG = `#version 300 es
precision highp float;
in vec2 vMask;
in vec2 vMap;
uniform sampler2D uMask;
uniform sampler2D uMap;
uniform float uAlpha;
uniform float uSharpMode, uSharpK, uMaskTop;
out vec4 fragColor;
${SHARP_SAMPLER_GLSL}
void main() {
  // (the cover's edge through the one sampler while the display draws to the screen: a texel edge of the rim gets one pixel of anti-aliasing at
  // any scale, as in the bands; the map itself keeps its own filter, like the map around it)
  vec4 m = uSharpMode > 0.5 ? sharpSampleT(uMask, vMask, dFdx(vMask), dFdy(vMask), uSharpK, uMaskTop) : texture(uMask, vMask);
  fragColor = texture(uMap, vMap) * (m.r * uAlpha);
}`;

/** The patch's program (PIXI keeps one per source pair: the one every patch's shader uses) - scripts/load-warm.mjs links it ahead. */
export const maskedProgram = () => PIXI.Program.from(VERT, FRAG);
const shaderFor = () => PIXI.Shader.from(VERT, FRAG, { uMask: PIXI.Texture.EMPTY, uMap: PIXI.Texture.EMPTY, uAlpha: 1, uSharpMode: 0, uSharpK: 1, uSharpB: 0, uMaskTop: 0 });

export class MaskedPatch extends PIXI.Container {
  /** `map`: the plain map sprite; `mask`: the cover sprite (its red channel, premultiplied, is the coverage). */
  constructor(map, mask) {
    super();
    this.eventMode = "none";
    this.addChild(map, mask);
    this.map = map; this.maskSprite = mask;
    map.renderable = false; mask.renderable = false;
    this.pos = new Float32Array(8); this.mUV = new Float32Array(8); this.pUV = new Float32Array(8);
    this.geom = new PIXI.Geometry()
      .addAttribute("aVertexPosition", new PIXI.Buffer(this.pos, false, false), 2)
      .addAttribute("aMaskCoord", new PIXI.Buffer(this.mUV, false, false), 2)
      .addAttribute("aMapCoord", new PIXI.Buffer(this.pUV, false, false), 2)
      .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
    this.shader = shaderFor();
    this.state = PIXI.State.for2d();
    this._pt = new PIXI.Point();
  }

  render(renderer) {
    if ( !this.visible || this.worldAlpha <= 0 || !this.renderable ) return;
    const map = this.map, mask = this.maskSprite, mt = mask.texture, pt = map.texture;
    if ( !mt?.valid || !pt?.valid || map.destroyed || mask.destroyed ) return;
    // the quad: the cover sprite's corners (world), its texture's corners, and the map's texture coordinates at those points
    mask.calculateVertices();
    const v = mask.vertexData, mu = mt._uvs, pu = pt._uvs, pf = pt.frame, wt = map.worldTransform, an = map.anchor;
    const pos = this.pos, mUV = this.mUV, pUV = this.pUV, p = this._pt;
    for ( let k = 0; k < 4; k++ ) {
      pos[k * 2] = v[k * 2]; pos[k * 2 + 1] = v[k * 2 + 1];
      wt.applyInverse({ x: v[k * 2], y: v[k * 2 + 1] }, p);
      const fu = p.x / pf.width + an.x, fv = p.y / pf.height + an.y;           // 0..1 across the map sprite's frame
      // bilinear over the frame's uv corners (x0 y0 top-left, x1 y1 top-right, x2 y2 bottom-right, x3 y3 bottom-left)
      pUV[k * 2] = pu.x0 + (pu.x1 - pu.x0) * fu + (pu.x3 - pu.x0) * fv;
      pUV[k * 2 + 1] = pu.y0 + (pu.y1 - pu.y0) * fu + (pu.y3 - pu.y0) * fv;
    }
    mUV[0] = mu.x0; mUV[1] = mu.y0; mUV[2] = mu.x1; mUV[3] = mu.y1; mUV[4] = mu.x2; mUV[5] = mu.y2; mUV[6] = mu.x3; mUV[7] = mu.y3;
    this.geom.getBuffer("aVertexPosition").update(); this.geom.getBuffer("aMaskCoord").update(); this.geom.getBuffer("aMapCoord").update();
    const u = this.shader.uniforms;
    u.uMask = mt; u.uMap = pt; u.uAlpha = map.worldAlpha * mask.worldAlpha;
    const mb = mt.baseTexture; u.uSharpMode = sharpBatch.on ? 1 : 0; u.uSharpK = sharpBatch.k; u.uSharpB = sharpBatch.b;
    u.uMaskTop = mb.mipmap === PIXI.MIPMAP_MODES.OFF ? 0 : Math.floor(Math.log2(Math.max(mb.realWidth, mb.realHeight)));   // the sprite's own alpha x the filter's (mask) alpha
    renderer.batch.flush();
    renderer.shader.bind(this.shader);
    renderer.state.set(this.state);
    renderer.geometry.bind(this.geom, this.shader);
    renderer.geometry.draw(PIXI.DRAW_MODES.TRIANGLES, 6, 0);
  }

  destroy(options) {
    this.geom?.destroy(); this.geom = null;
    this.shader?.destroy?.(); this.shader = null;
    super.destroy(options);
  }
}
