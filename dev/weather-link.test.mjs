// The weather programs stay small enough to link fast on a program-cache miss, offline:   node dev/weather-link.test.mjs
// Why: D3D11's compiler (FXC) links every program when its first draw needs it, and after any shader update every player misses the
// cache. Its cost grows much faster than the code: the tornado's one volume program (both modes, debris and wall cloud) took 8.7-8.9 s
// on a 3070 Ti (2026-11-09); split per mode (uMode a constant: one density function a program) and per stage it is 2.4-3.4 s, the
// deck split per part 3.0-3.3 s -> 0.65 + 1.3 s. The split programs draw what the one program drew on the same uniforms (pixel A/B in
// the guard-off weather-cost shots: within the A/A noise). Live link times: dev/weather-link-run.mjs.
import assert from "node:assert/strict";

class Stub { toArray() { return []; } }
globalThis.PIXI = new Proxy({ Program: { from: (vertexSrc, fragmentSrc, name) => ({ vertexSrc, fragmentSrc, name }) } }, { get: (o, k) => o[k] ?? Stub });
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
const G = await import("../scripts/weather/tornado-glsl.mjs");
const sets = {
  tornado: (await import("../scripts/weather/tornado.mjs")).tornadoPrograms(),
  display: (await import("../scripts/weather/display.mjs")).displayPrograms(),
  clouds: (await import("../scripts/weather/clouds.mjs")).cloudPrograms(),
  lens: (await import("../scripts/weather/lens.mjs")).lensPrograms()
};
const T = Object.fromEntries(sets.tornado.map((p) => [p.name.replace("moinen-maps-tornado-", ""), p]));

// 1. the tornado's volume: one program per stage and mode, the mode a constant (no uniform branch left to compile both densities)
for ( const s of [0, 1, 2] ) for ( const m of [0, 1] ) {
  const p = T[`vol${s}-${m}`];
  assert.ok(p, `vol${s}-${m} is in tornadoPrograms (so the pre-warm links it)`);
  assert.ok(!/uniform\s+int\s+uMode\b/.test(p.fragmentSrc), `vol${s}-${m}: uMode is not a uniform`);
  assert.match(p.fragmentSrc, new RegExp(`const int uMode = ${m};`), `vol${s}-${m}: uMode is the constant ${m}`);
  assert.match(p.fragmentSrc, new RegExp(`#define VSTAGE ${s}\\b`), `vol${s}-${m}: stage ${s}`);
}
assert.ok(!sets.tornado.some((p) => /uniform\s+int\s+uMode\b/.test(p.fragmentSrc) && /#define VSTAGE/.test(p.fragmentSrc)), "no volume program with both modes");
// the replace targets still exist in the source (a renamed line would silently leave the one big program)
assert.equal(G.volFrag(2, 0).includes("uniform int uMode;"), false);
assert.equal(G.deckFrag("curtain").includes("if ( uMode == 0 || uMode == 2 ) {"), false, "deckFrag found the curtain branch");
// 2. the deck: the curtain (modes 0, 2) and the deck (mode 1) are two programs, each without the other's branch
assert.match(T["deck-curtain"].fragmentSrc, /if \( true \) \{/);
assert.match(T["deck-deck"].fragmentSrc, /if \( false \) \{/);
// 3. no constant arrays (ANGLE makes each one an indexable temp FXC fills per pixel) in any weather program
for ( const [k, ps] of Object.entries(sets) ) for ( const p of ps ) assert.ok(!/const\s+(float|int|vec\d|ivec\d)\s+\w+\s*\[/.test(p.fragmentSrc), `${k} ${p.name}: no const arrays`);
// 4. no program grows (GLSL length now + ~10%: above that, measure the link with dev/weather-link-run.mjs, then raise the cap or split)
const CAP = { tornado: 27500, display: 23500, clouds: 7000, lens: 43500 };
for ( const [k, ps] of Object.entries(sets) ) for ( const p of ps ) {
  assert.ok(p.fragmentSrc.length < CAP[k], `${k} ${p.name}: ${p.fragmentSrc.length} chars (cap ${CAP[k]}) - measure the link (dev/weather-link-run.mjs) or split it`);
}
console.log(`weather-link: ok (${Object.values(sets).flat().length} programs; tornado volume 6 + deck 2 split, no const arrays, sizes capped)`);
