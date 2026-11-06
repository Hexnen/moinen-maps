// The FIREBALL style is the layer's first look, kept bit for bit: its field bytes (R heat, G smoke, B ground) for level 2 strokes
// (fire 2 / smoke 2, at rest) equal those of the frozen v1 model (dev/fixtures/fire-v1/model.mjs).   node dev/fire-fireball-identity.test.mjs
import * as M from "../scripts/fire/model.mjs";
import * as V1 from "./fixtures/fire-v1/model.mjs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const cases = [
  { geo: { ap: 3, ox: 100, oy: 100, grid: 96 }, P: {} },
  { geo: { ap: 1, ox: 0, oy: 0, grid: 40 }, P: { smoke: 0.8, plume: 3 } },
  { geo: { ap: 2, ox: 10, oy: 20, grid: 64 }, P: { flame: 1.8, smoke: 0 } },
  { geo: { ap: 1, ox: 0, oy: 0, grid: 40 }, P: { plume: 0 } }
];
const strokes = (st) => [
  { id: "a1", k: "fire", s: 0.9, r: 50, p: [300, 300, 360, 310, 420, 330], wd: 0, ws: 0.4, q: 1 },
  { id: "a2", k: "fire", s: 0.6, r: 30, p: [330, 360], wd: 200, ws: 0.8, q: 2 },
  { id: "a3", k: "smoke", s: 0.8, r: 40, p: [380, 250, 400, 240], wd: 0, ws: 0.2, q: 3 },
  { id: "a4", k: "erase", s: 1, r: 20, p: [360, 320], q: 4 },
  { id: "b1", k: "fire", s: 1, r: 70, p: [900, 700, 960, 720], wd: 90, ws: 1, q: 5 }
].map((s) => ({ ...s, ...(s.k !== "erase" ? st : {}) }));
for ( const { geo, P: p } of cases ) {
  const P1 = V1.cleanParams(p), P2 = M.cleanParams(p);
  const A1 = V1.areasOf(strokes({}).map(V1.cleanStroke), geo, P1);
  for ( const a1 of A1 ) {
    const f1 = V1.raster(a1, geo, P1);
    // the same strokes as fireball (plain level-2 strokes), one area of the new model
    const s2 = a1.strokes.map((s) => M.cleanStroke({ ...s, ...(s.k !== "erase" ? { st: "fireball" } : {}) }));
    const a2 = { ...a1, strokes: s2, phases: Object.fromEntries(s2.map((s) => [s.id, "on"])), style: "fireball" };
    const f2 = M.raster(a2, geo, P2);
    let diff = 0, first = -1;
    for ( let i = 0; i < f1.data.length; i++ ) { if ( i % 4 === 3 ) { if ( !f1.data[i] !== !f2.data[i] ) diff++; continue; } if ( f1.data[i] !== f2.data[i] ) { diff++; if ( first < 0 ) first = i; } }
    ok(f1.w === f2.w && f1.h === f2.h && diff === 0, `fireball field identical to v1 (${JSON.stringify(p)}, area ${a1.id}: ${diff} bytes differ, first ${first})`);
    ok(JSON.stringify(f1.emit.fire) === JSON.stringify(f2.emit.fire.map((e) => e.slice(0, 2))) && JSON.stringify(f1.emit.smoke) === JSON.stringify(f2.emit.smoke.map((e) => e.slice(0, 2))), `fireball emitters identical to v1 (${a1.id})`);
    ok(f2.times === null, "at rest: no times texture");
  }
}
console.log(`fire-fireball-identity: ${n - fails}/${n} checks ok`);
if ( fails ) process.exit(1);
