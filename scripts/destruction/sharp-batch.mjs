import { SHARP_SAMPLER_GLSL } from "./sharp-sampler.mjs";

/**
 * The live layer's sprites (ruin, flattened areas, CPU shards) and batched pieces drawn with THE ONE SAMPLER (sharp-sampler.mjs), the
 * same as the cache's band tiles: a copy of PIXI's batch plugin whose fragment shader samples each texture through `sharpSample`
 * (texel size from textureSize(), the footprint from the derivatives of the uv). Used only while the display's own frame is drawn to
 * the screen (`sharpBatch.on`, set around `display.objs.render`); every draw into a render texture (bakes, flattening, composites, the
 * erode targets) keeps PIXI's own shader and the textures' own filter, so no baked pixel changes.
 *
 * The textures must be LINEAR for the fetch (display.tick holds them so while this is active).
 */
export const sharpBatch = { on: false, name: "moinenSharp", k: 1 };

const FRAG_HEAD = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
flat in vec4 vColor;
flat in float vTextureId;
uniform sampler2D uSamplers[%count%];
uniform float uSharpMode;
uniform float uSharpK;
out vec4 fragColor;
${SHARP_SAMPLER_GLSL}
// (the derivatives are taken once, outside the texture-id branches, where every pixel of a 2x2 quad agrees)
vec2 gDx, gDy;
vec4 sharpTex(sampler2D s, vec2 uv) {
  if ( uSharpMode < 0.5 ) return texture(s, uv);
  return sharpSampleG(s, uv, gDx, gDy, uSharpK);
}
#define texture2D(s, uv) sharpTex(s, uv)
void main(void) {
  gDx = dFdx(vTextureCoord); gDy = dFdy(vTextureCoord);
  vec4 color;
  %forloop%
  fragColor = color * vColor;
}`;

/** GLSL for a custom shader of the layer that has the atlas's size in a uniform: the same sampler, `uv` and its two gradients given. */
export function installSharpBatch(renderer) {
  if ( !globalThis.PIXI?.BatchRenderer || !renderer?.plugins ) return null;
  const old = renderer.plugins[sharpBatch.name];
  if ( old && !old.destroyed && old._shader ) return old;
  const base = renderer.plugins.batch;
  const vertex = base?.shaderGenerator?.vertexSrc;
  if ( !vertex ) return null;
  const Cls = class SharpBatchRenderer extends PIXI.BatchRenderer {
    flush() {
      if ( this._shader?.uniforms ) { this._shader.uniforms.uSharpMode = sharpBatch.on ? 1 : 0; this._shader.uniforms.uSharpK = sharpBatch.k; }
      super.flush();
    }
  };
  let p;
  try {
    p = new Cls(renderer);
    p.setShaderGenerator({ vertex, fragment: FRAG_HEAD });
    p.contextChange();
    if ( !p._shader ) return null;
    p._shader.uniforms.uSharpMode = 0; p._shader.uniforms.uSharpK = 1;
  } catch(err) { console.warn("moinen-maps | sharp batch plugin unavailable", err); return null; }
  renderer.plugins[sharpBatch.name] = p;
  return p;
}

/** Route a sprite through the sharp plugin (when it exists). */
export function sharpSprite(s, renderer = globalThis.canvas?.app?.renderer) {
  if ( renderer?.plugins?.[sharpBatch.name] ) s.pluginName = sharpBatch.name;
  return s;
}

/** Wrap `container.render` so that it (and everything it draws) is sampled by the sharp plugin while it draws to the screen. */
export function sharpRender(container, enabled = () => true) {
  if ( container._mmSharp ) return;
  container._mmSharp = true;
  const orig = container.render;
  container.render = function(renderer) {
    if ( !enabled() ) return orig.call(this, renderer);
    renderer.batch.flush();
    const was = sharpBatch.on; sharpBatch.on = true;
    try { return orig.call(this, renderer); } finally { renderer.batch.flush(); sharpBatch.on = was; }
  };
}

/** The batch shader a batched piece draw binds: the sharp one while the display draws to the screen, PIXI's own otherwise. */
export function batchShader(renderer) {
  const S = sharpBatch.on ? renderer.plugins?.[sharpBatch.name] : null;
  if ( S?._shader ) { S._shader.uniforms.uSharpMode = 1; S._shader.uniforms.uSharpK = sharpBatch.k; return S._shader; }
  return renderer.plugins?.batch?._shader;
}
