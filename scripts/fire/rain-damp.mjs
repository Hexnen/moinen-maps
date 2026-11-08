/**
 * RAIN AND SNOW OVER FIRE (research D9, visual by default; owned by the weather layer, kept out of the fire style's own files): the
 * weather's `fireWet()` (wind.mjs: { dim, steam }, already eased by the weather's transitions) drives the fire area's EXISTING
 * uniforms and lights only - no re-raster, no per-cell CPU work:
 *   - FEWER, LOWER TONGUES: a tiny multiply quad drawn right after the area's fuel pass (a child of `fuelPass`, so it rides the same
 *     render) scales the fuel map's two keyframes by 1 - 0.3 dim: the art pass grows fewer and lower tongues from weaker fuel;
 *   - WEAKER FLAMES: the flame ramp (and the fire-lit undersides) darkens a little - the emission in the illumination layer with it;
 *   - STEAMY SMOKE: the smoke tint turns toward a cool white-grey with the steam share (the weather's own steam puffs add the white);
 *   - WEAKER LIGHT: after the lights' 12 fps update, their tint and reach are scaled down.
 * Restored exactly once the weather has gone (the saved originals); nothing at all while there is no rain or snow.
 */

const STEAM = [0.86, 0.89, 0.93];
let fuelProg = null;
const VERT = `#version 300 es
precision highp float;
in vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
void main() { gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0); }`;
const FRAG = `#version 300 es
precision highp float;
uniform float uK;
out vec4 o;
void main() { o = vec4(uK, uK, 1.0, 1.0); }`;

/** The fuel damper of an art area (made once, on first rain): a quad over its fuel texture, MULTIPLY (dst x src). */
function damper(m) {
  if ( m.wxDamper && !m.wxDamper.destroyed ) return m.wxDamper;
  const FW = m.fuelRt.width, FH = m.fuelRt.height;
  const g = new PIXI.Geometry().addAttribute("aVertexPosition", [0, 0, FW, 0, FW, FH, 0, FH], 2).addIndex([0, 1, 2, 0, 2, 3]);
  fuelProg ??= PIXI.Program.from(VERT, FRAG, "moinen-maps-fire-rain-damp");
  const d = new PIXI.Mesh(g, new PIXI.Shader(fuelProg, { uK: 1, translationMatrix: new PIXI.Matrix().toArray(true) }));
  d.state.blendMode = PIXI.BLEND_MODES.MULTIPLY;
  m.fuelPass.addChild(d);
  return m.wxDamper = d;
}

/** One art area (`a` = the display's { mesh, ... }) under `wet` ({ dim, steam }): uniforms only. */
export function dampArea(a, wet) {
  const m = a.mesh; if ( !m?.isArt || !m.fuelPass || !m.show ) return;
  const dim = wet.dim, steam = wet.steam;
  if ( !(dim > 0.001 || steam > 0.001) && !a.wxOn ) return;
  const meshes = [m.show, m.front, m.smoke, m.glow].filter((x) => x?.shader?.uniforms?.uRamp);
  if ( !a.wx ) a.wx = { ramp: Float32Array.from(m.show.shader.uniforms.uRamp), tint: Float32Array.from(m.show.shader.uniforms.uSmokeTint) };
  const R = a.wx.ramp, T0 = a.wx.tint;
  // the fuel: weaker (the next fuel render, at most 1/4 s away)
  const k = 1 - 0.3 * dim;
  if ( dim > 0.001 || m.wxDamper ) {
    const d = damper(m);
    if ( d.shader.uniforms.uK !== k ) { d.shader.uniforms.uK = k; m.fuelT = null; }   // (the fuel map is redrawn on its next art frame)
  }
  // the flame steps (0-6) and the fire-lit undersides (10, 11) darken; the bed (7-9) keeps its embers
  const fk = 1 - 0.3 * dim, uk = 1 - 0.45 * dim;
  // the smoke tint: toward a cool white-grey with the steam
  const ta = T0[3] + (Math.max(T0[3], 0.75) - T0[3]) * steam;
  const tint = [0, 1, 2].map((i) => T0[3] > 0 ? T0[i] + (STEAM[i] - T0[i]) * steam : STEAM[i]);
  for ( const x of meshes ) {
    const u = x.shader.uniforms, r = u.uRamp;
    for ( let i = 0; i < 12; i++ ) {
      const f = i <= 6 ? fk : i >= 10 ? uk : 1;
      r[i * 4] = R[i * 4] * f; r[i * 4 + 1] = R[i * 4 + 1] * f; r[i * 4 + 2] = R[i * 4 + 2] * f;
    }
    const t = u.uSmokeTint;
    if ( t ) { t[0] = tint[0]; t[1] = tint[1]; t[2] = tint[2]; t[3] = ta; }
  }
  a.wxOn = dim > 0.001 || steam > 0.001;
}

/**
 * The fire's lights under `wet`: call right after FireLights.update with `fresh` = it wrote new uniforms this frame (it writes them only
 * on a new 12 fps frame: scaling them every frame would compound). Their tint and reach go down with the damping.
 */
export function dampLights(lights, wet, fresh) {
  if ( !fresh || !(wet.dim > 0.001) ) return;
  const k = 1 - 0.6 * wet.dim, kr = 1 - 0.2 * wet.dim;
  for ( const s of lights.slots ) {
    if ( s.gone ) continue;
    const uu = (s.mesh?.shader ?? s.src?.layers?.illumination?.shader)?.uniforms; if ( !uu?.mmTint ) continue;
    uu.mmTint[0] *= k; uu.mmTint[1] *= k; uu.mmTint[2] *= k; uu.mmReach *= kr;
  }
}
