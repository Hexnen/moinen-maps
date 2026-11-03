// Static cache levels:   node dev/static-cache.test.mjs
//   The destruction layer is drawn as band 0, run 0, band 1, run 1, ... (static units in bands on even levels, live units in runs on
//   odd ones, each in creation order). That equals drawing everything in creation order exactly when every pair of OVERLAPPING units
//   keeps its order. Checked on random layouts (fuzz, 3000 cases) against that rule; plus: statics never share a level with live
//   units, an all-static layer is one band, a moving last stroke is one run over one band, levels are deterministic, cacheRes caps.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.PIXI ??= { Container: class {} };
globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
const C = await import(pathToFileURL(path.join(root, "scripts/destruction/static-cache.mjs")).href);
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };
let seed = 12345;
const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2654435761) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;

const over = (a, b, m) => !(a.r.x0 >= b.r.x1 + m || a.r.x1 <= b.r.x0 - m || a.r.y0 >= b.r.y1 + m || a.r.y1 <= b.r.y0 - m);
for ( let t = 0; t < 3000; t++ ) {
  const N = 1 + Math.floor(rnd() * 40), units = [];
  for ( let i = 0; i < N; i++ ) {
    const x = rnd() * 300, y = rnd() * 300, w = 4 + rnd() * 80, h = 4 + rnd() * 80, live = rnd() < 0.25;
    units.push({ r: { x0: x, y0: y, x1: x + w, y1: y + h }, live, m: live && rnd() < 0.5 ? 10 : 0 });
  }
  const lv = C.levels(units);
  ok(lv.every((v, i) => (v & 1) === (units[i].live ? 1 : 0)), "parity: statics even, live odd");
  for ( let i = 0; i < N; i++ ) for ( let j = i + 1; j < N; j++ ) {
    if ( !over(units[i], units[j], Math.max(units[i].m, units[j].m)) ) continue;
    // final order: level first, then creation order
    ok(lv[i] < lv[j] || (lv[i] === lv[j] && i < j), `overlapping pair keeps its order (case ${t}: ${i} L${lv[i]} before ${j} L${lv[j]})`);
  }
  ok(JSON.stringify(C.levels(units)) === JSON.stringify(lv), "deterministic");
}
// shapes that matter
const R = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
ok(C.levels([{ r: R(0, 0, 9, 9) }, { r: R(5, 5, 20, 20) }, { r: R(0, 0, 50, 50) }]).every((v) => v === 0), "all static: one band");
const last = C.levels([{ r: R(0, 0, 9, 9) }, { r: R(5, 5, 20, 20) }, { r: R(0, 0, 50, 50), live: true, m: 48 }]);
ok(last.join() === "0,0,1", "a new stroke entering on top: one band under one run");
const water = C.levels([{ r: R(0, 0, 30, 30) }, { r: R(0, 0, 30, 30), live: true }, { r: R(100, 100, 120, 120) }, { r: R(20, 20, 40, 40) }]);
ok(water.join() === "0,1,0,2", "water: a later stroke away from it stays in band 0, one over it goes to band 1");
ok(C.cacheRes(1536, 1024) === 1 && C.cacheRes(8000, 8000) < 1 && C.cacheRes(8000, 8000) >= 0.25, "cacheRes: 1, capped on huge scenes");
// zoom AA weight: a function of the scale only; bounded, continuous, monotone non-increasing; full below s0, none from s1; same for any tile
{
  const K = [[1.5, 0.8, 1.0], [1, 0.7, 1.2], [2, 0.5, 2.5], undefined];
  for ( const k of K ) {
    const a = k?.[0] ?? 1.5, s0 = k?.[1] ?? 0.8, s1 = k?.[2] ?? 1.0;
    let prev = Infinity;
    for ( let s = 0.05; s < 10; s += 0.001 ) {
      const w = C.aaWeight(s, k);
      ok(w >= 0 && w <= a + 1e-12, `aaWeight bounded (${s})`);
      ok(w <= prev + 1e-12, `aaWeight monotone non-increasing (${s})`);
      ok(prev === Infinity || Math.abs(w - prev) < a * 0.06, `aaWeight continuous: no pop between scale steps of 0.001 (${s}: ${prev} -> ${w})`);
      if ( s <= s0 ) ok(w === a, "aaWeight full below s0");
      if ( s >= s1 ) ok(w === 0, "aaWeight zero from s1: the resting look at and above it is untouched");
      prev = w;
    }
  }
  ok(C.aaWeight(0, null) === 0 && C.aaWeight(NaN, null) === 0 && C.aaWeight(-1, null) === 0, "aaWeight: no scale, no filter");
  ok(C.aaWeight(1.0, null) === 0 && C.aaWeight(3.4, null) === 0 && C.aaWeight(6, null) === 0, "default: zoom 1 and above is the resting sampler exactly");
  // DPR: the weight is asked with screen px per texel (css scale x dpr / texel density) - the same scene zoom at a higher DPR is just a larger scale
  for ( const dpr of [1, 1.25, 1.5, 2] ) ok(C.aaWeight(0.6 * dpr) >= C.aaWeight(0.6 * dpr * 1.1), "aaWeight monotone across DPR");
}
console.log(`static-cache: ${n} checks ok`);
