// The frame guard's detail reaches every weather pass that can give some back, offline:   node dev/weather-q.test.mjs
// Why: the ground and haze once took the guard's q as a "footprint width" (uK) their look no longer used, so under load they never got
// cheaper (found 2026-11-09 by the live sweep, dev/weather-q.mjs). Here: each knob's shader declares AND reads uQ, the JS sets it from
// weatherQ() every frame and starts it at 1 (an unset uniform is 0 in GLSL: no detail), and every gate is the full look at q = 1.
import assert from "node:assert/strict";
import fs from "node:fs";

class Stub { toArray() { return []; } }
globalThis.PIXI = new Proxy({ Program: { from: (vertexSrc, fragmentSrc, name) => ({ vertexSrc, fragmentSrc, name }) } }, { get: (o, k) => o[k] ?? Stub });
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
const { GROUND_FRAG } = await import("../scripts/weather/glsl.mjs");
const { HAZE_FRAG } = await import("../scripts/weather/fx-glsl.mjs");
const { BODY_FRAG, RAYS_FRAG } = await import("../scripts/weather/clouds-glsl.mjs");
const src = (f) => fs.readFileSync(new URL(`../scripts/weather/${f}`, import.meta.url), "utf8");

// 1. the shaders: uQ declared, read, and each gate is exactly 1 at q = 1 (a branch on uQ >= 1.0, not a smoothstep that only nears 1)
const knobs = { ground: [GROUND_FRAG, /float gq = uQ >= 1\.0 \? 1\.0 :/], groundWind: [GROUND_FRAG, /gWq = uQ >= 1\.0 \? 1\.0 :/],
  haze: [HAZE_FRAG, /sLitW = uQ >= 1\.0 \? 1\.0 :/], hazeDither: [HAZE_FRAG, /float hw = uQ >= 1\.0 \? 1\.0 :/],
  body: [BODY_FRAG, /float w9 = uQ >= 1\.0 \? 1\.0 :/], rays: [RAYS_FRAG, /wq = uQ >= 1\.0 \? 1\.0 :/] };
for ( const [k, [s, gate]] of Object.entries(knobs) ) {
  assert.match(s, /uniform float uQ;/, `${k}: declares uQ`);
  assert.ok((s.match(/\buQ\b/g) ?? []).length >= 2, `${k}: reads uQ`);
  assert.match(s, gate, `${k}: its gate is exactly 1 at q = 1`);
}
// the godrays at full detail keep the six-tap ring as it was; the body keeps its three octaves
assert.match(RAYS_FRAG, /if \( wq >= 1\.0 \) \{ for \( int i = 0; i < 6; i\+\+ \)/);
assert.match(BODY_FRAG, /if \( w9 > 0\.0 \) n \+= 0\.25 \* w9 \* \(oc9\(p\) - 0\.5\);/);

// 2. the JS: uQ starts at 1 and is set from the guard every frame
const D = src("display.mjs"), C = src("clouds.mjs"), L = src("lens.mjs");
assert.equal((D.match(/uK: footprintK\(\), uQ: 1,/g) ?? []).length, 2, "display: ground and haze start at uQ 1");
assert.match(D, /this\.ground\.shader\.uniforms\.uQ = gq;/);
assert.match(D, /this\.haze\.shader\.uniforms\.uQ = gq;/);
assert.match(C, /const common = \(edge, w\) => \(\{ uQ: 1,/, "clouds: the stage passes start at uQ 1");
assert.match(C, /u\.uNight = night; u\.uQ = q;/, "clouds: uQ set every frame");
assert.match(L, /this\.q = weatherQ\(\);/, "lens: reads the guard");
assert.match(L, /\(L\.q \?\? 1\) < 0\.7/, "lens: copies every other frame only under q 0.7");
// 3. the density knobs (drops, particles, tornado) still take it
assert.match(D, /dens\[i\] = \(d0\[i\] \?\? 0\) \* gq;/);
assert.match(D, /dd\[i\] = d0\[i\] \* gq;/);
assert.match(src("tornado.mjs"), /const gq = weatherQ\(\)/);
assert.match(C, /const now = this\.now\?\.\(\) \?\? Date\.now\(\), q = weatherQ\(\);/);

console.log(`weather-q: ok (${Object.keys(knobs).length} shader gates exact at q = 1, uQ set from the guard, density knobs in place)`);
