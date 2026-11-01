// node dev/destruction-coldbake-bench.mjs [jobs=4]   (not in run-all: a timing bench)
// A cold bake of the user's scene "map" (dev/fixtures/destruction-flags/main-map-156.json) on a synthetic map of its size: every
// stroke in `jobs` batches (nearest strokes together, as destruction.mjs's pool does), each batch in its own worker with its own cache.
// Prints each batch's time; the pool's wall time is the slowest batch (the batches run in parallel), plus the one-call total for comparison.
import fs from "node:fs";
const core = await import(new URL("../scripts/destruction/core.mjs", import.meta.url).href);
const jobsN = Number(process.argv[2] ?? 4);
const j = JSON.parse(fs.readFileSync(new URL("./fixtures/destruction-flags/main-map-156.json", import.meta.url), "utf8"));
const rle = (str, n) => { const a = new Uint8Array(n), bin = Buffer.from(str ?? "", "base64").toString("latin1"); let pos = 0, i = 0; while ( pos < bin.length && i < n ) { const v = bin.charCodeAt(pos++); let run = 0, mul = 1, b; do { b = bin.charCodeAt(pos++); run += (b & 127) * mul; mul *= 128; } while ( b & 128 && pos < bin.length ); if ( v ) a.fill(v, i, Math.min(n, i + run)); i += run; } return a; };
const paths = j.destructionPaths ?? {};
const unflat = (p) => { const out = []; for ( let i = 0; p && i + 2 < p.length; i += 3 ) out.push([p[i], p[i + 1]]); return out.length > 1 ? out : null; };
const objs = Object.values(j.destructionObjects).sort((a, b) => a.s - b.s).map((o) => ({ id: o.id, k: o.k, t: o.t, c: o.c | 0, x0: o.x0, y0: o.y0, w: o.w, h: o.h, bytes: rle(o.m, o.w * o.h), path: unflat(paths[o.id] ?? o.p) }));
const P = j.destruction.params, K = 2, AW = 1536, AH = 1024, map = new Uint8ClampedArray(AW * AH * 4);
for ( let y = 0; y < AH; y++ ) for ( let x = 0; x < AW; x++ ) { const o = (y * AW + x) * 4, n = ((x * 7 + y * 13) % 17) * 3; map[o] = 90 + n; map[o + 1] = 110 + n; map[o + 2] = 70 + n; map[o + 3] = 255; }
const input = (list) => ({ objects: list, K, aw: AW, ah: AH, seed: j.destruction.seed | 0, params: P, map: { w: AW, h: AH, data: map }, mapKey: "bench" });
const Sub = await import(new URL("../scripts/destruction/substrate.mjs", import.meta.url).href);
const deps = Sub.depsOf(objs, P, K);
const center = (i) => objs[i].x0 + objs[i].w / 2;
const batches = (list) => { const l = [...list].sort((a, b) => center(a) - center(b)), size = Math.ceil(l.length / jobsN), out = []; for ( let b = 0; b < l.length; b += size ) out.push(l.slice(b, b + size)); return out; };
const run = (list, plain, under) => { const need = new Set(list), t = Date.now(); const r = core.bake({ ...input(objs.map((o, i) => need.has(i) || o.k ? o : { ...o, skip: 1 })), plain, under }, new Map()); return { r, s: (Date.now() - t) / 1000 }; };
// sprites per index from a result (as Chunks.splitSheet gives them)
const spritesOf = (r) => { const out = new Map(); let cur = -1; for ( let k = 0; k < r.count; k++ ) { const o = k * core.META_FIELDS, m = Int16Array.from(r.meta.subarray(o, o + core.META_FIELDS)); if ( m[0] === 0 ) cur = m[16]; const w = m[3], h = m[4], img = new Uint8Array(w * h * 4); for ( let y = 0; y < h; y++ ) img.set(r.sheet.data.subarray(((m[2] + y) * r.sheet.w + m[1]) * 4, ((m[2] + y) * r.sheet.w + m[1] + w) * 4), y * w * 4); if ( !out.has(cur) ) out.set(cur, []); out.get(cur).push({ m, w, h, img }); } return out; };
const all = objs.map((o, i) => i).filter((i) => !objs[i].k);
const readSet = new Set(deps.flat().filter((j) => !objs[j].k));
const wave1 = all.filter((i) => !deps[i].length || readSet.has(i)), wave2 = all.filter((i) => deps[i].length);
const plain = new Map(); let w1 = 0, w2 = 0, cpu = 0;
for ( const b of batches(wave1) ) { const { r, s } = run(b, true); w1 = Math.max(w1, s); cpu += s; for ( const [i, sp] of spritesOf(r) ) plain.set(i, sp); }
for ( const b of batches(wave2) ) { const under = {}; for ( const i of b ) for ( const j of deps[i] ) if ( plain.has(j) && !b.includes(j) ) under[j] = plain.get(j); const { r, s } = run(b, false, under); w2 = Math.max(w2, s); cpu += s; }
console.log(`two waves, pool of ${jobsN}: plain looks ${wave1.length} strokes in ${w1.toFixed(1)} s, then ${wave2.length} strokes over them in ${w2.toFixed(1)} s: wall ~${(w1 + w2).toFixed(1)} s, cpu ${cpu.toFixed(1)} s`);
