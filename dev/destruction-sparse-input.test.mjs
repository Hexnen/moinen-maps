// node dev/destruction-sparse-input.test.mjs [-v]
// PERF (ultra test 1): a bake job carries only the strokes it bakes and the strokes they read (substrate.mjs depsOf), the others as
// holes (null) - not every stroke of the scene with its pixels (megabytes cloned into the worker on every stroke of a grown scene).
// The bake must give exactly the same bytes: the fixture scene "map", a few strokes that read others, baked with the full list
// (the others skipped, the erase strokes in) and with the sparse list.
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
const deps = Sub.depsOf(objs, P, K);
const AW = 1536, AH = 1024, map = new Uint8ClampedArray(AW * AH * 4);
for ( let y = 0; y < AH; y++ ) for ( let x = 0; x < AW; x++ ) { const o = (y * AW + x) * 4, n = ((x * 7 + y * 13) % 17) * 3; map[o] = 90 + n; map[o + 1] = 110 + n; map[o + 2] = 70 + n; map[o + 3] = 255; }
const input = (list) => ({ objects: list, K, aw: AW, ah: AH, seed: j.destruction.seed | 0, params: P, map: { w: AW, h: AH, data: map }, mapKey: "sparse" });
const dump = (r) => { const out = []; for ( let k = 0; k < r.count; k++ ) { const o = k * core.META_FIELDS, m = r.meta.subarray(o, o + core.META_FIELDS), w = m[3], h = m[4]; let hh = 2166136261; for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) { const q = ((m[2] + y) * r.sheet.w + m[1] + x) * 4; for ( let c = 0; c < 4; c++ ) hh = Math.imul(hh ^ r.sheet.data[q + c], 16777619); } out.push(`${[...m].join(",")}#${hh >>> 0}`); } return out.join("|"); };
// strokes that read others (an erase stroke among them where there is one), and a pair baked together
const readers = objs.map((o, i) => i).filter((i) => !objs[i].k && deps[i].length >= 1);
const withErase = readers.filter((i) => deps[i].some((d) => objs[d].k));
const pick = [...readers.slice(0, 2), ...withErase.slice(0, 1), readers[readers.length - 1]].filter((v, k, a) => v !== undefined && a.indexOf(v) === k);
const sets = [...pick.map((i) => [i]), pick.slice(0, 2)];
for ( const set of sets ) {
  const need = new Set(set), keep = new Set([...set, ...set.flatMap((i) => deps[i])]);
  const full = core.bake(input(objs.map((o, i) => need.has(i) || o.k ? o : { ...o, skip: 1 })), new Map());
  const sparse = core.bake(input(objs.map((o, i) => need.has(i) ? o : keep.has(i) ? (o.k ? o : { ...o, skip: 1 }) : null)), new Map());
  const a = dump(full), b = dump(sparse);
  ok(a === b && a.length > 0, `strokes ${set.join("+")} (reading ${set.map((i) => deps[i].length).join("+")}${set.some((i) => withErase.includes(i)) ? ", an erase stroke among them" : ""}): sparse input = full input, ${full.count} rows`);
}
console.log(fails ? `FAILED ${fails}` : "ok   destruction-sparse-input");
process.exit(fails ? 1 : 0);
