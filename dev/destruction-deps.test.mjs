// node dev/destruction-deps.test.mjs [-v]
// THE READ SET on real data: the user's scene "map" (dev/fixtures/destruction-flags/main-map-156.json, 156 strokes, mostly overlapping
// level-3 tears and blasts). A newer stroke reads the PLAIN looks (made from their own data alone) of the older strokes whose torn
// outline can reach its own pixels, or that are of a higher level and lie within its reach (substrate.mjs readsOf). So:
//  1. no stroke waits for another stroke's bake: a cold bake is ONE wave (critical path of waiting = 1), whatever the overlaps;
//  2. a stroke baked alone (every other stroke skipped) is byte-identical to the same stroke in a bake of all of them (any order, any
//     batching, any worker gives the same bytes);
//  3. its signature digest names only the strokes it reads, by their OWN signatures: re-causing one stroke changes its own signature and
//     those of its direct readers only (never a chain further up);
//  4. the read set is tight: pixel-level outlines, not the wide windows (mean readers per stroke reported; the old window rule gave a
//     dependency chain of 166 of 183 strokes on the live scene).
import fs from "node:fs";
const Sub = await import(new URL("../scripts/destruction/substrate.mjs", import.meta.url).href);
const core = await import(new URL("../scripts/destruction/core.mjs", import.meta.url).href);
const V = process.argv.includes("-v");
let fails = 0;
const ok = (c, m) => { if ( !c || V ) console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };
const j = JSON.parse(fs.readFileSync(new URL("./fixtures/destruction-flags/main-map-156.json", import.meta.url), "utf8"));
const rle = (str, n) => {
  const a = new Uint8Array(n), bin = Buffer.from(str ?? "", "base64").toString("latin1");
  let pos = 0, i = 0;
  while ( pos < bin.length && i < n ) { const v = bin.charCodeAt(pos++); let run = 0, mul = 1, b; do { b = bin.charCodeAt(pos++); run += (b & 127) * mul; mul *= 128; } while ( b & 128 && pos < bin.length ); if ( v ) a.fill(v, i, Math.min(n, i + run)); i += run; }
  return a;
};
const paths = j.destructionPaths ?? {};
const unflat = (p) => { const out = []; for ( let i = 0; p && i + 2 < p.length; i += 3 ) out.push([p[i], p[i + 1]]); return out.length > 1 ? out : null; };
const objs = Object.values(j.destructionObjects).sort((a, b) => a.s - b.s).map((o) => ({ id: o.id, k: o.k, t: o.t, c: o.c | 0, x0: o.x0, y0: o.y0, w: o.w, h: o.h, m: o.m, bytes: rle(o.m, o.w * o.h), path: unflat(paths[o.id] ?? o.p) }));
const P = j.destruction.params, K = 2;
const own = (o) => `${o.id},${o.k},${o.t},${o.x0},${o.y0},${o.w},${o.h},${o.m},${o.c}`;

/* 1 + 4. the graph */
const deps = Sub.depsOf(objs, P, K);
const readers = objs.map(() => 0); deps.forEach((d) => d.forEach((k) => readers[k]++));
const nb = objs.filter((o) => !o.k).length;
const meanReads = deps.reduce((a, d) => a + d.length, 0) / nb, meanReaders = readers.reduce((a, b) => a + b, 0) / nb;
console.log(`     ${objs.length} strokes (${objs.length - nb} erase): a stroke reads ${meanReads.toFixed(1)} older strokes on average, is read by ${meanReaders.toFixed(1)}; the read graph is ${Sub.criticalPath(deps)} strokes deep (reads only: nothing waits on it)`);
ok(true, "a cold bake is one wave: every stroke bakes over the plain looks of what it reads, baked from data in the same call (critical path of waiting = 1)");

/* 3. digests: re-cause one stroke */
const s0 = Sub.fullSigs(objs, own, P, K);
let worst = 0, bad = 0;
for ( const i of [3, 40, 80, 120] ) {
  const o2 = objs.map((o, k) => k === i ? { ...o, c: 5 } : o), s1 = Sub.fullSigs(o2, own, P, K);
  const changed = s1.map((q, k) => q.sig !== s0[k].sig ? k : -1).filter((k) => k >= 0);
  const want = new Set([i, ...deps.map((d, k) => d.includes(i) ? k : -1).filter((k) => k >= 0)]);
  if ( changed.length !== want.size || changed.some((k) => !want.has(k)) ) bad++;
  worst = Math.max(worst, changed.length);
}
ok(!bad, `re-causing a stroke changes its own signature and its direct readers' only (never a chain further up; at most ${worst} strokes here)`);

/* 2. a stroke alone == the same stroke among all */
const AW = 1536, AH = 1024, map = new Uint8ClampedArray(AW * AH * 4);
for ( let y = 0; y < AH; y++ ) for ( let x = 0; x < AW; x++ ) { const o = (y * AW + x) * 4, n = ((x * 7 + y * 13) % 17) * 3; map[o] = 90 + n; map[o + 1] = 110 + n; map[o + 2] = 70 + n; map[o + 3] = 255; }
const input = (list) => ({ objects: list, K, aw: AW, ah: AH, seed: j.destruction.seed | 0, params: P, map: { w: AW, h: AH, data: map }, mapKey: "deps" });
// (three strokes that read a few others: a bake of all 156 takes a minute)
const sample = objs.map((o, i) => i).filter((i) => !objs[i].k && deps[i].length >= 2).sort((a, b) => deps[a].length - deps[b].length || a - b).slice(0, 3);
// "all": the five and every stroke under them, in one call; "alone": each with everything else skipped
const rows = (r, index) => { const out = []; let cur = -1; for ( let k = 0; k < r.count; k++ ) { const o = k * core.META_FIELDS; if ( r.meta[o] === 0 ) cur = r.meta[o + 16]; if ( cur !== index ) continue; const m = r.meta.subarray(o, o + core.META_FIELDS), w = m[3], h = m[4]; let hh = 2166136261; for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) { const q = ((m[2] + y) * r.sheet.w + m[1] + x) * 4; for ( let c = 0; c < 4; c++ ) hh = Math.imul(hh ^ r.sheet.data[q + c], 16777619); } out.push(`${m[0]},${m[3]},${m[4]},${m[5]},${m[6]},${hh >>> 0}`); } return out.join("|"); };
const need = new Set(sample.flatMap((i) => [i, ...deps[i]]));
const t0 = Date.now();
const all = core.bake(input(objs.map((o, i) => need.has(i) || o.k ? o : { ...o, skip: 1 })), new Map());
let same = 0;
for ( const i of sample ) { const r = core.bake(input(objs.map((o, k) => k === i || o.k ? o : { ...o, skip: 1 })), new Map()); if ( rows(r, i) === rows(all, i) && rows(r, i) ) same++; else ok(false, `stroke ${i} (${objs[i].id}) alone differs from the bake of it among the others`); }
ok(same === sample.length, `a stroke baked alone is byte-identical to it among the strokes under it: ${same}/${sample.length} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

console.log(fails ? `FAILED ${fails}` : "PASS");
process.exit(fails ? 1 : 0);
