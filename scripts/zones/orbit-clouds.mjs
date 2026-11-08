/**
 * The Orbit planet's clouds drift very slowly (planet-clouds.mjs paints them; this puts them on the canvas).
 *
 * - One small texture at ART resolution (the visible part of the planet's disc, ~500 x 120 texels), drawn as one quad over the
 *   picture's planet with the module's sampler (sharp-sampler.mjs: crisp art pixels at any zoom and DPR, edges like the picture's).
 *   Under the ambience's Graphics (aurora, satellites) and under the tokens.
 * - The cloud phase comes from the wall clock, so every client sees the clouds in the same place and a scene opened again goes on where
 *   it was. It is repainted only when the fastest cloud on screen has moved a quarter of an art pixel (about every 0.5 s by default,
 *   ~1.5 ms + an upload of ~0.25 MB); every other frame costs one number compare. A hidden tab does nothing (the ticker stops) and
 *   comes back with one repaint.
 * - An older Orbit scene (flag v < 2) gets the layer only when its picture is proven to be this painter's: the planet's place agrees
 *   with the seed's, and the picture's pixels under the disc agree with an exact paint of the clouds at phase 0. Otherwise nothing
 *   changes on it (its baked clouds stay still).
 * `CONFIG.moinenMaps.orbitClouds = false` turns it off; `CONFIG.moinenMaps.orbitCloudSpeed` = art px per second of the fastest point.
 */
import { paintSpace, lastLayout } from "./space.mjs";
import { cloudLayer } from "./planet-clouds.mjs";
import { SHARP_SAMPLER_GLSL, BLEND0 } from "../destruction/sharp-sampler.mjs";

export const CLOUD_SPEED = 0.5;       // art px per second where the clouds move fastest (the middle of the visible cap)
const STEPS_PER_PX = 4;               // repaint every quarter art pixel of that motion
const PERIOD = 2 ** 20;               // the wall clock wraps every ~12 days (one jump then), keeping the phase small

const VERT = `#version 300 es
precision highp float;
in vec2 aVertexPosition;
in vec2 aTextureCoord;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
out vec2 vUv;
void main(void) {
  vUv = aTextureCoord;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;
const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
out vec4 fragColor;
${SHARP_SAMPLER_GLSL}
void main(void) { fragColor = sharpSample(uTex, vUv, 1.0) * uAlpha; }`;

const cfg = () => globalThis.CONFIG?.moinenMaps ?? {};

/** Is the scene's picture this painter's planet? (old scenes only) */
function provenPicture(seed, aw, ah, flagPlanet, layer, ART) {
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const p = lastLayout.planet;
  if ( flagPlanet && !(near(flagPlanet.cx, p.cx) && near(flagPlanet.cy, p.cy) && near(flagPlanet.R, p.R)) ) return false;
  // the picture itself, when its pixels are at hand (an ImageBitmap / image behind the background sprite)
  const src = canvas.primary?.background?.texture?.baseTexture?.resource?.source;
  if ( !src?.width || !src?.height ) return !!flagPlanet;
  try {
    const { x0, y0, cw, ch } = layer, kx = src.width / (aw * ART), ky = src.height / (ah * ART);
    const cv = document.createElement("canvas");
    cv.width = cw; cv.height = ch;
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    // one source pixel from the middle of each art pixel's block (every pixel of a block is the same colour)
    for ( let y = 0; y < ch; y++ ) g.drawImage(src, 0, Math.floor((y0 + y + 0.5) * ART * ky), src.width, 1, -x0, y, aw, 1);
    const pic = g.getImageData(0, 0, cw, ch).data;
    layer.paint(0, true);
    let same = 0, n = 0;
    for ( let i = 0; i < cw * ch; i++ ) {
      const o = i * 4; if ( !layer.data[o + 3] ) continue;
      n++;
      if ( Math.abs(pic[o] - layer.data[o]) + Math.abs(pic[o + 1] - layer.data[o + 1]) + Math.abs(pic[o + 2] - layer.data[o + 2]) < 6 ) same++;
    }
    return n > 0 && same / n > 0.97;
  } catch ( err ) { return !!flagPlanet; }   // (a tainted / unreadable picture: trust a scene that saved its layout)
}

/**
 * Start the drifting clouds for an Orbit scene. Returns { tick(now), destroy(), stats } or null (off, or an old picture not proven).
 * @param {Scene} scene
 * @param {object} flag    the scene's orbit flag ({seed, v, layout})
 * @param {number} ART     scene px per art px
 */
export function startClouds(scene, flag, ART) {
  const c = cfg();
  if ( c.orbitClouds === false || !canvas?.primary ) return null;
  const t0 = performance.now();
  const seed = flag?.seed ?? 1, aw = Math.round(scene.width / ART), ah = Math.round(scene.height / ART);
  const flagPlanet = flag?.layout?.planet ?? null, fresh = (flag?.v ?? 1) >= 2 && Number.isFinite(flagPlanet?.lo);
  let planet = flagPlanet;
  if ( !fresh ) { paintSpace(seed, aw, ah, { layoutOnly: true }); planet = { ...lastLayout.planet }; }
  if ( !planet ) return null;
  const layer = cloudLayer(seed, aw, ah, planet);
  if ( !layer.pixels ) return null;
  if ( !fresh && !provenPicture(seed, aw, ah, flagPlanet, layer, ART) ) {
    console.info("moinen-maps | orbit: the picture is not this painter's planet (an older Orbit scene) - its clouds stay still; regenerate the sky to make them move");
    return null;
  }

  const base = PIXI.BaseTexture.fromBuffer(layer.data, layer.cw, layer.ch, {
    scaleMode: PIXI.SCALE_MODES.LINEAR, mipmap: PIXI.MIPMAP_MODES.ON, alphaMode: PIXI.ALPHA_MODES.PMA, wrapMode: PIXI.WRAP_MODES.CLAMP
  });
  const tex = new PIXI.Texture(base);
  const X0 = layer.x0 * ART, Y0 = layer.y0 * ART, X1 = X0 + layer.cw * ART, Y1 = Y0 + layer.ch * ART;
  const geom = new PIXI.Geometry()
    .addAttribute("aVertexPosition", [X0, Y0, X1, Y0, X1, Y1, X0, Y1], 2)
    .addAttribute("aTextureCoord", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addIndex([0, 1, 2, 0, 2, 3]);
  const shader = PIXI.Shader.from(VERT, FRAG, { uTex: tex, uAlpha: 1, uSharpB: BLEND0 });
  const mesh = new PIXI.Mesh(geom, shader);
  mesh.eventMode = "none";
  Object.assign(mesh, { elevation: 0, sortLayer: 100, sort: -1, _lastSortedIndex: 0 });
  canvas.primary.addChild(mesh);

  const stats = { buildMs: 0, repaints: 0, paintMs: 0, maxPaintMs: 0, changed: 0, pixels: layer.pixels, size: [layer.cw, layer.ch] };
  let lastStep = NaN;
  const tick = () => {
    if ( mesh.destroyed ) return;
    const speed = Number(cfg().orbitCloudSpeed ?? CLOUD_SPEED) || 0;
    const steps = ((Date.now() / 1000) % PERIOD) * speed * STEPS_PER_PX, step = Math.floor(steps);
    if ( step === lastStep ) return;
    lastStep = step;
    const t = performance.now();
    // the phase in u: STEPS_PER_PX steps per art px of the fastest point
    const changed = layer.paint(step / (STEPS_PER_PX * layer.pxPerPhase));
    if ( changed ) base.update();
    const dt = performance.now() - t;
    stats.repaints++; stats.paintMs += dt; stats.maxPaintMs = Math.max(stats.maxPaintMs, dt); stats.changed += changed;
  };
  tick();
  stats.buildMs = performance.now() - t0;
  const destroy = () => {
    if ( !mesh.destroyed ) { mesh.parent?.removeChild(mesh); mesh.destroy(); }
    geom.destroy(); shader.destroy?.(); tex.destroy(true);
  };
  return { tick, destroy, stats, mesh, layer };
}
