/**
 * Flooded holes (scripts/destruction/flood-core.mjs + lib/water-worker.js "bakeFlood"): node dev/flood.test.mjs
 *  1. determinism: the same hole gives the same mask, the same baked frames and the same pixels, twice and in a fresh worker;
 *  2. independence: a hole's frames do not change when other holes or the scene's painted water are baked before it in the same
 *     worker, and the scene's painted-water bake is not disturbed by a hole's bake in between;
 *  3. the key: the area hash and the bake settings only (colours and opacities never change it);
 *  4. the levels: cracked has damp ground and seeping water, broken is see-through, a crater is opaque and darker in the middle.
 */
import assert from "node:assert/strict";
import { nodeWaterWorker } from "./water-worker-node.mjs";
import * as FC from "../scripts/destruction/flood-core.mjs";
import { buildLut, overall } from "../scripts/water/paint.mjs";

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const hash = (a) => FC.fnv(a).toString(16);

function hole(L, { cx = 300, cy = 120, cw = 70, ch = 50, seed = 5, bump = 0 } = {}) {
  const N = cw * ch, cover = new Uint8Array(N), open = new Uint8Array(N), level = new Uint8Array(N);
  for ( let y = 0; y < ch; y++ ) for ( let x = 0; x < cw; x++ ) {
    const r = Math.hypot((x - cw / 2) / (cw / 2 - 2), (y - ch / 2) / (ch / 2 - 2)) + (FC.h2(x >> 2, y >> 2, 9 + bump) - 0.5) * 0.15;
    if ( r >= 1 ) continue;
    const i = y * cw + x; cover[i] = 1; level[i] = L;
    open[i] = L === 1 ? (FC.h2(x >> 3, y, 4) < 0.12 || FC.h2(x, y >> 3, 6) < 0.12 ? 1 : 0) : 1;
  }
  return FC.prepareFlood({ cx, cy, cw, ch, cover, open, level, seed });
}

let w = await nodeWaterWorker();
const defaults = w.info.defaults;
const bakeHole = async (wk, prep, h) => wk.call({ type: "bakeFlood", W: prep.eng.w, H: prep.eng.h, mask: prep.eng.mask, params: { ...defaults, ...FC.floodParams(null, prep, h) } });
const sig = (res) => res.frames.map(hash).join(",");

// 1. determinism
const A1 = hole(3), A2 = hole(3);
assert.ok(same(A1.eng.mask, A2.eng.mask) && same(A1.op, A2.op) && same(A1.water, A2.water), "prepare is deterministic");
const ra = await bakeHole(w, A1, 1234), rb = await bakeHole(w, A2, 1234);
assert.equal(ra.frames.length, defaults.frames, "one frame per loop step");
assert.equal(sig(ra), sig(rb), "the same hole bakes the same frames twice");
const w2 = await nodeWaterWorker();
assert.equal(sig(await bakeHole(w2, A1, 1234)), sig(ra), "a fresh worker bakes the same frames");
console.log("ok 1 determinism", ra.box, `${ra.frames.length} frames`);

// 2. independence: other holes and the painted water in between
const B = hole(2, { cx: 40, cy: 400, cw: 90, ch: 40, bump: 3 });
await bakeHole(w, B, 99);
const W = 120, H = 90, water = new Uint8Array(W * H);
for ( let y = 20; y < 70; y++ ) for ( let x = 10; x < 100; x++ ) water[y * W + x] = 1;
const paintedBake = (wk) => new Promise((resolve, reject) => wk.call({ type: "bake", W, H, masks: { water }, maskKey: "t1", params: defaults }).then(resolve, reject));
const p1 = await paintedBake(w);
const rc = await bakeHole(w, A1, 1234);
assert.equal(sig(rc), sig(ra), "a hole is the same after other holes and the painted water were baked");
const p2 = await paintedBake(w);
assert.deepEqual(p1.box, p2.box, "the painted water's bake is not disturbed by a hole's bake");
console.log("ok 2 independence");

// 3. the key
const kp = FC.floodParams({ style: "pond", colors: ["000000"], alpha: { all: 50 }, fxOn: true, reflectOn: true }, A1, 77);
const kq = FC.floodParams({ style: "pond", colors: ["ffffff"], alpha: { all: 90 }, fxOn: false, reflectOn: false }, A1, 77);
assert.equal(FC.floodKey(77, kp), FC.floodKey(77, kq), "colours, opacities and token effects never change the key");
assert.notEqual(FC.floodKey(77, kp), FC.floodKey(78, kp), "another area, another key");
assert.notEqual(FC.floodKey(77, kp), FC.floodKey(77, FC.floodParams({ style: "lava" }, A1, 77)), "another look, another key");
console.log("ok 3 key");

// 4. the levels
const lut = buildLut(w.info.codes, defaults.colors, defaults.alpha), kit = FC.paintKit(lut, defaults.colors, overall(defaults.alpha));
const meanA = (prep, res, sel) => { const px = FC.paintFlood(prep, res.frames[0], res.box, kit); let s = 0, n = 0; for ( let i = 0; i < prep.cw * prep.ch; i++ ) if ( sel(i) ) { s += px[i * 4 + 3]; n++; } return n ? s / n : 0; };
const L1 = hole(1), L2 = hole(2), L3 = hole(3);
const r1 = await bakeHole(w, L1, 5), r2 = await bakeHole(w, L2, 5), r3 = r1 && await bakeHole(w, L3, 5);
assert.ok(L1.damp.some((v) => v) && L1.water.some((v) => v), "cracked: damp ground and seeping water");
assert.ok(!L2.damp.some((v) => v) && !L3.damp.some((v) => v), "broken and crater: all water");
const deep = (P) => (i) => P.water[i] && P.depth[i] > 0.7, rim = (P) => (i) => P.water[i] && P.depth[i] < 0.2;
const a2 = meanA(L2, r2, deep(L2)), a3 = meanA(L3, r3, deep(L3));
assert.ok(a2 < 200, `broken is see-through in the middle (${a2.toFixed(0)})`);
assert.ok(a3 > 235, `a crater is opaque in the middle (${a3.toFixed(0)})`);
assert.ok(meanA(L3, r3, rim(L3)) < a3, "a crater is clearer at the rim than in the middle");
// the entry: nothing at the start, the deepest first, everything at the end
const at = (u) => { const px = FC.paintFlood(L3, r3.frames[0], r3.box, kit, u); let n = 0; for ( let i = 3; i < px.length; i += 4 ) if ( px[i] ) n++; return n; };
assert.ok(at(0) < at(0.5) && at(0.5) < at(1.2), "the water rises");
console.log("ok 4 levels", { broken: a2.toFixed(0), crater: a3.toFixed(0), fill: [at(0), at(0.5), at(1.2)] });

// 5. the painted water's grid (13 scene px over 3 px art pixels): the hole's water pixels sit on that grid
const G = (() => { const h0 = hole(3); return FC.prepareFlood({ ...h0, cover: h0.water, open: h0.water, level: new Uint8Array(h0.cw * h0.ch).fill(3), seed: 5, ratio: 13 / 3 }); })();
const rg = await bakeHole(w, G, 5), pg = FC.paintFlood(G, rg.frames[3], rg.box, kit);
let bad = 0;
for ( let y = 0; y < G.ch; y++ ) for ( let x = 1; x < G.cw; x++ ) {
  // two art pixels in the same 13-px cell, both water and not on the rising line: the same colour
  const a = (y * G.cw + x - 1) * 4, b = a + 4, sameCell = Math.floor((G.cx + x - 0.5) * 3 / 13) === Math.floor((G.cx + x + 0.5) * 3 / 13);
  if ( sameCell && G.water[y * G.cw + x] && G.water[y * G.cw + x - 1] && G.shade[y * G.cw + x] === 0 && G.shade[y * G.cw + x - 1] === 0 && (pg[a] !== pg[b] || pg[a + 1] !== pg[b + 1])) bad++;
}
assert.equal(bad, 0, "one colour per painted-water pixel (outside the depth bands)");
console.log("ok 5 painted-water grid", `${G.eng.w}x${G.eng.h}`);
console.log("all flood tests passed");
