// DROPSVIS (2026-11-15): the water drops on the glass are SEEN on a real scene at night, offline:   node dev/lens-vis.test.mjs
// Found live (The Warehouse, darkness 0.9, rain 2, the scene's lens fixed at level 1, lossless shots): the lens drew, but every light
// cue of a drop (glint, lit rim, a small drop's lift) was scaled by 1 - 0.7 x darkness = 0.37 while the world's rain streaks stay at
// full light, and a drop's body is clear water refracting a dark, even frame: a table saw no drops in either look on either seat.
//   A. the night rule (lens-look.mjs lensLight): full light by day, at least 0.7 at darkness 0.9, never above 1, never brightening
//   B. the drop cues in BOTH looks' pass programs: a small drop lifts the frame by at least 0.10 (and never darkens it below 0.97), a
//      big drop's top rim at least 0.12, the light it focuses low inside it is there; the dark side stays where the night-squares fix
//      (B6, 244ba32) left it (no lower rim below 0.72, no contact shadow line); more mid-size drops: at least a fifth of the beads of a
//      big-drop cell reach the big-drop shading at level 1, level 1 has more and bigger beads (bead 0.2 -> 0.35, big 3.4 -> 4.2), none
//      cut at a cell edge
//   C. the REAL WeatherLens on a fake PIXI at darkness 0.9: the pass gets uLight = lensLight(0.9) (both looks)
import assert from "node:assert/strict";

let n = 0;
const ok = (c, msg) => { n++; assert.ok(c, msg); };

/* ---------------------------------------------------------------- A: the night rule */
const LL = await import("../scripts/weather/lens-look.mjs");
ok(LL.lensLight(0) === 1 && LL.lensLight(undefined) === 1 && LL.lensLight(-1) === 1, "full light by day");
ok(LL.lensLight(0.9) >= 0.7, `at The Warehouse's darkness 0.9 the drops keep ${LL.lensLight(0.9).toFixed(2)} of their light (was 0.37)`);
ok(LL.lensLight(1) >= 0.65 && LL.lensLight(2) === LL.lensLight(1), "full night: at least 0.65, clamped");
for ( let d = 0; d < 1; d += 0.05 ) ok(LL.lensLight(d + 0.05) <= LL.lensLight(d) + 1e-12 && LL.lensLight(d) <= 1, `darker never brighter (${d.toFixed(2)})`);

/* ---------------------------------------------------------------- B: the drop cues in both looks */
class Stub { toArray() { return []; } }
globalThis.PIXI = new Proxy({ Program: { from: (vertexSrc, fragmentSrc, name) => ({ vertexSrc, fragmentSrc, name }) } }, { get: (o, k) => o[k] ?? Stub });
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
const { lensPrograms } = await import("../scripts/weather/lens.mjs");
const M0 = await import("../scripts/weather/model.mjs");
ok(M0.TABLES.rain.lens.bead[0] >= 0.3 && M0.TABLES.rain.lens.big[0] >= 4, "level 1 (a scene's lens fixed at 1, as The Warehouse): enough beads, big enough to see");
const num = (re, src, what) => { const m = src.match(re); ok(!!m, `${what}: found`); return m ? Number(m[1]) : NaN; };
for ( const look of ["pixel", "smooth"] ) {
  const [pass, disp] = lensPrograms(look), src = pass.fragmentSrc;
  ok(src === disp.fragmentSrc.replace("#define LENS_OUT 2", "#define LENS_OUT 1"), `${look}: shade and refraction programs share the drop code`);
  const m = src.match(/if \( dR < 1\.25 \) \{ bAdd = vec3\(([\d.]+)\) \* uLight; bK = ([\d.]+); \} else \{ bAdd = vec3\(([\d.]+)\) \* uLight; bK = ([\d.]+); \}/);
  ok(!!m, `${look}: the small-drop shading line`);
  ok(+m[1] >= 0.10 && +m[3] >= 0.08, `${look}: a small drop lifts the frame (${m[1]} / ${m[3]}, was 0.07 / 0.04)`);
  ok(+m[2] >= 0.97 && +m[4] >= 0.97, `${look}: a small drop never darkens the frame below 0.97`);
  const top = num(/bAdd = vec3\(([\d.]+)\) \* uLight \* rim \* \(1\.0 - low\);/, src, `${look} top rim`);
  ok(top >= 0.12, `${look}: a big drop's lit top rim ${top} (was ${look === "pixel" ? 0.10 : 0.05})`);
  ok(/bAdd \+= vec3\(0\.\d+\) \* uLight \* ss\(0\.2, 0\.8, n\.y\) \* \(1\.0 - rim\);/.test(src), `${look}: the light a big drop focuses low inside it`);
  const low = num(/srcK = mix\(srcK, mix\(0\.9, ([\d.]+), low\), rim\);/, src, `${look} lower rim`);
  ok(low >= 0.72, `${look}: the lower rim no darker than the night-squares fix allows (${low})`);
  ok(!/shadow\s*=|uShadow|contact\s*\*/.test(src.replace(/\/\/.*$/gm, "")), `${look}: no contact shadow under a drop`);
  const e = num(/float r = 0\.5 \+ big \* pow\(hu\(key, CY, 313\), ([\d.]+)\);/, src, `${look} bead sizes`);
  // the share of a big-drop cell's beads (radius 0.5 + big x h^e, h uniform) that reach the big-drop shading (radius >= SMALL 2.6)
  const SMALL = num(/SMALL = ([\d.]+);/, src, `${look} SMALL`), share = (big) => 1 - Math.pow((SMALL - 0.5) / big, 1 / e);
  const T = M0.TABLES.rain.lens;
  ok(share(T.big[0]) >= 0.28 && share(T.big[1]) >= 0.33, `${look}: big drops at level 1 ${(share(T.big[0]) * 100).toFixed(1)} %, level 2 ${(share(T.big[1]) * 100).toFixed(1)} % of the beads (was 16.9 / 26.1)`);
  // a bead is drawn from its own 8-lens-px cell and the 8 around it: its whole lobed body (radius x up to 1.37) must stay within the
  // reach of those cells (8.4 lens px from its centre at the worst jitter), or it would be cut flat at a cell edge
  for ( const big of T.big ) ok((0.5 + big) * 1.37 <= 8.4, `${look}: the biggest bead (big ${big}) is never cut at a cell edge`);
}

/* ---------------------------------------------------------------- C: the real lens at night */
{
  class Obj { destroy() { this.destroyed = true; } }
  class RT extends Obj { constructor(o) { super(); this.o = o; this.width = o.width; this.height = o.height; this.framebuffer = { glFramebuffers: {} }; } }
  class Geometry extends Obj { addAttribute() { return this; } addIndex() { return this; } }
  class UniformGroup { constructor(u) { this.uniforms = u; } }
  class Shader { constructor(program, u) { this.program = program; this.uniforms = u instanceof UniformGroup ? u.uniforms : u; } }
  class Mesh extends Obj { constructor(g, s, st) { super(); this.geometry = g; this.shader = s; this.state = st ?? {}; this.transform = { worldTransform: { set() {} } }; } }
  class Container extends Obj {}
  globalThis.PIXI = {
    Program: { from: (vertexSrc, fragmentSrc, name) => ({ vertexSrc, fragmentSrc, name }) },
    RenderTexture: { create: (o) => new RT(o) }, Geometry, UniformGroup, Shader, Mesh, Container,
    State: { for2d: () => ({}) }, Texture: { WHITE: {} }, Matrix: class { toArray() { return []; } },
    utils: { premultiplyBlendMode: [[], []] }, SCALE_MODES: { NEAREST: 0, LINEAR: 1 }, TYPES: { FLOAT: 5126 }, FORMATS: { RGBA: 6408 }, MIPMAP_MODES: { OFF: 0 }, BLEND_MODES: {}
  };
  globalThis.WebGL2RenderingContext = { ONE: 1, SRC_ALPHA: 770, ZERO: 0, FUNC_ADD: 32774 };
  const stage = { children: [], addChild(...c) { for ( const x of c ) { const i = this.children.indexOf(x); if ( i >= 0 ) this.children.splice(i, 1); this.children.push(x); x.parent = this; } }, removeChild(x) { this.children.splice(this.children.indexOf(x), 1); x.parent = null; } };
  const renderer = { resolution: 1, screen: { width: 1600, height: 900 }, gl: { getExtension: () => ({}) }, state: { blendModes: [] }, render() {} };
  globalThis.canvas = { app: { renderer, ticker: { add() {}, remove() {}, FPS: 60 } }, stage, environment: { darknessLevel: 0.9 } };
  globalThis.CONFIG = { moinenMaps: { weatherGuard: false } };
  const M = await import("../scripts/weather/model.mjs");
  const { WeatherLens } = await import("../scripts/weather/lens.mjs?night");
  // The Warehouse as the reviewer played it: rain 2, the scene's lens fixed at level 1, darkness 0.9
  const P = M.cleanParams({ on: true, lens: { on: true, level: 1 } }), st = { fx: { rain: { v: 2, p: 1, s: 1 } }, lensCap: 3, wind: { dir: 230, str: 1 }, seed: 1 };
  for ( const look of ["pixel", "smooth"] ) {
    const L = new WeatherLens(); L.now = () => 1794150006000; L.look = look; L.setState(st, P); L.tick();
    const lights = L.shaders.map((s) => s.uniforms.uLight);
    ok(lights.length >= 3 && lights.every((v) => Math.abs(v - LL.lensLight(0.9)) < 1e-9), `${look}: every lens pass draws at night with uLight ${LL.lensLight(0.9).toFixed(2)} (${lights.length} shaders)`);
    ok(L.gates[0] > 0 && L.gates[1] >= 3.4, `${look}: the scene's level-1 lens still makes beads (density ${L.gates[0]}, biggest radius ${L.gates[1]} lens px)`);
    L.destroy();
  }
}
console.log(`lens-vis: ok (${n} checks: drops keep their light at night, brighter drop cues in both looks, no darker terms)`);
