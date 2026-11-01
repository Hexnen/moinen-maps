// node dev/chunk-bytes-bench.mjs <flags.json> [map.rgba W H] [workers=6]   (not in run-all: a measurement)
// What the destruction chunks of a scene weigh and where the bytes go. Bakes every stroke of a scene's module flags (the object
// `flags["moinen-maps"]`: destruction, destructionObjects, destructionPaths) in two waves as the client's pool does (plain looks, then
// the strokes over them), on the scene's REAL map pixels when given (raw RGBA, W x H art pixels; else the synthetic map of
// destruction-coldbake-bench.mjs - fine for timing, meaningless for bytes), then reports per stroke and in total:
//   - the chunk bytes today (chunks.mjs packObject + deflate, the same codec the GM uploads),
//   - the deflated size of each plane (base / shard / cover / light; alpha and RGB apart),
//   - what a stronger general coder would give (brotli q11, 16 MB window: an upper bound no browser decodes natively),
//   - how many visible base pixels equal the map pixel under them (a residual-against-the-map coding only pays when many do),
//   - overdraw: visible base pixels vs the art positions they cover (what an occlusion-aware composite could drop).
import fs from "node:fs";
import zlib from "node:zlib";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
const core = await import(new URL("../scripts/destruction/core.mjs", import.meta.url).href);
const C = await import(new URL("../scripts/net/chunks.mjs", import.meta.url).href);

if ( !isMainThread ) {
  const { objs, P, seed, map, AW, AH, list, under, plain } = workerData;
  const need = new Set(list);
  const r = core.bake({ objects: objs.map((o, i) => need.has(i) || o.k ? o : { ...o, skip: 1 }), K: 2, aw: AW, ah: AH, seed, params: P, map: { w: AW, h: AH, data: map }, mapKey: "bench", plain, under }, new Map());
  parentPort.postMessage([...C.splitSheet(r.sheet.data, r.sheet.w, r.meta, core.META_FIELDS)]);
} else {
  const [flagsF, mapF, wS, hS, nW = "6"] = process.argv.slice(2);
  if ( !flagsF ) { console.log("usage: node dev/chunk-bytes-bench.mjs <flags.json> [map.rgba W H] [workers]"); process.exit(1); }
  const j = JSON.parse(fs.readFileSync(flagsF, "utf8"));
  const rle = (str, n) => { const a = new Uint8Array(n), bin = Buffer.from(str ?? "", "base64").toString("latin1"); let pos = 0, i = 0; while ( pos < bin.length && i < n ) { const v = bin.charCodeAt(pos++); let run = 0, mul = 1, b; do { b = bin.charCodeAt(pos++); run += (b & 127) * mul; mul *= 128; } while ( b & 128 && pos < bin.length ); if ( v ) a.fill(v, i, Math.min(n, i + run)); i += run; } return a; };
  const paths = j.destructionPaths ?? {};
  const unflat = (p) => { const out = []; for ( let i = 0; p && i + 2 < p.length; i += 3 ) out.push([p[i], p[i + 1]]); return out.length > 1 ? out : null; };
  const objs = Object.values(j.destructionObjects).sort((a, b) => a.s - b.s).map((o) => ({ id: o.id, k: o.k, t: o.t, c: o.c | 0, x0: o.x0, y0: o.y0, w: o.w, h: o.h, bytes: rle(o.m, o.w * o.h), path: unflat(paths[o.id] ?? o.p) }));
  const P = j.destruction.params, seed = j.destruction.seed | 0;
  const AW = mapF ? Number(wS) : 1536, AH = mapF ? Number(hS) : 1024;
  let map;
  if ( mapF ) map = new Uint8ClampedArray(fs.readFileSync(mapF));
  else { map = new Uint8ClampedArray(AW * AH * 4); for ( let y = 0; y < AH; y++ ) for ( let x = 0; x < AW; x++ ) { const o = (y * AW + x) * 4, n = ((x * 7 + y * 13) % 17) * 3; map[o] = 90 + n; map[o + 1] = 110 + n; map[o + 2] = 70 + n; map[o + 3] = 255; } }
  const Sub = await import(new URL("../scripts/destruction/substrate.mjs", import.meta.url).href);
  const deps = Sub.depsOf(objs, P, 2);
  const all = objs.map((o, i) => i).filter((i) => !objs[i].k);
  const readSet = new Set(deps.flat().filter((q) => !objs[q].k));
  const wave1 = all.filter((i) => !deps[i].length || readSet.has(i)), wave2 = all.filter((i) => deps[i].length);
  const nw = Number(nW);
  const split = (l) => { const out = Array.from({ length: nw }, () => []); l.forEach((v, k) => out[k % nw].push(v)); return out.filter((x) => x.length); };
  const run = (list, plain, under) => new Promise((res, rej) => { const w = new Worker(new URL(import.meta.url), { workerData: { objs, P, seed, map, AW, AH, list, plain, under } }); w.once("message", res); w.once("error", rej); });
  const t0 = Date.now(), plainLooks = new Map(), final = new Map();
  for ( const res of await Promise.all(split(wave1).map((l) => run(l, true, {}))) ) for ( const [i, sp] of res ) plainLooks.set(i, sp);
  for ( const i of all ) if ( !deps[i].length ) final.set(i, plainLooks.get(i) ?? []);
  const res2 = await Promise.all(split(wave2).map((l) => { const under = {}; for ( const i of l ) for ( const q of deps[i] ) if ( plainLooks.has(q) ) under[q] = plainLooks.get(q); return run(l, false, under); }));
  for ( const res of res2 ) for ( const [i, sp] of res ) final.set(i, sp);
  console.log(`baked ${final.size} strokes in ${((Date.now() - t0) / 1000).toFixed(1)} s (${nw} workers)`);

  const Z = (a) => zlib.deflateSync(a).length;
  const cat = (arrs) => Buffer.concat(arrs.map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)));
  const sum = {}, add = (k, v) => { sum[k] = (sum[k] ?? 0) + v; };
  const sizes = [];
  const AREA = { 0: "base", 1: "shard", 2: "cover", 3: "light" };
  const visCount = new Uint16Array(AW * AH);
  for ( const [, sp] of final ) {
    const sprites = sp.map((s) => ({ ...s, m: Int16Array.from(s.m), img: new Uint8Array(s.img.buffer ?? s.img, s.img.byteOffset ?? 0, s.img.length ?? s.img.byteLength) }));
    const p = C.packObject(sprites, core.META_FIELDS), png = await C.wrap(p);
    sizes.push(png.length); add("chunk", png.length); add("rawPayload", p.length);
    add("brotli11", zlib.brotliCompressSync(p, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } }).length);
    for ( const t of [0, 1, 2, 3] ) {
      const ss = sprites.filter((s) => s.m[0] === t); if ( !ss.length ) continue;
      const A = [], RGB = [];
      for ( const s of ss ) {
        add(`px.${AREA[t]}`, s.w * s.h);
        const a = new Uint8Array(s.w * s.h), rgb = [];
        for ( let i = 0; i < s.w * s.h; i++ ) { a[i] = s.img[i * 4 + 3]; if ( a[i] ) rgb.push(s.img[i * 4], s.img[i * 4 + 1], s.img[i * 4 + 2]); }
        A.push(a); RGB.push(Uint8Array.from(rgb));
        if ( t === 0 ) for ( let y = 0; y < s.h; y++ ) for ( let x = 0; x < s.w; x++ ) {
          const i = (y * s.w + x) * 4; if ( !s.img[i + 3] ) continue;
          const ax = s.m[5] + x, ay = s.m[6] + y; if ( ax < 0 || ay < 0 || ax >= AW || ay >= AH ) continue;
          add("base.visible", 1); visCount[ay * AW + ax]++;
          const mi = (ay * AW + ax) * 4;
          if ( s.img[i + 3] === 255 && s.img[i] === map[mi] && s.img[i + 1] === map[mi + 1] && s.img[i + 2] === map[mi + 2] ) add("base.equalsMap", 1);
        }
      }
      add(`z.${AREA[t]}.alpha`, Z(cat(A))); add(`z.${AREA[t]}.rgb`, Z(cat(RGB)));
    }
  }
  let covered = 0; for ( const v of visCount ) if ( v ) covered++;
  sizes.sort((a, b) => a - b);
  const MB = (v) => (v / 1048576).toFixed(2) + " MB", q = (f) => (sizes[Math.floor(f * (sizes.length - 1))] / 1024).toFixed(0);
  console.log(`chunks: ${MB(sum.chunk)} total, ${(sum.chunk / sizes.length / 1024).toFixed(1)} kB/stroke (p50 ${q(0.5)} kB, p90 ${q(0.9)} kB, max ${q(1)} kB); ${sizes.filter((s) => s < 16384).length} strokes under 16 kB`);
  console.log(`raw payload ${MB(sum.rawPayload)}; brotli q11 (upper bound of a general coder) ${MB(sum.brotli11)} (${(100 * (1 - sum.brotli11 / sum.chunk)).toFixed(0)} % less)`);
  console.log(`sprite area: base ${(sum["px.base"] / 1e6).toFixed(1)} Mpx, shards ${(sum["px.shard"] / 1e6).toFixed(1)}, covers ${((sum["px.cover"] ?? 0) / 1e6).toFixed(1)}, lights ${((sum["px.light"] ?? 0) / 1e6).toFixed(1)}`);
  console.log(`planes deflated alone: ${Object.keys(sum).filter((k) => k.startsWith("z.")).map((k) => `${k.slice(2)} ${MB(sum[k])}`).join(", ")}`);
  console.log(`visible base pixels ${sum["base.visible"]}: ${sum["base.equalsMap"] ?? 0} equal to the map under them; they cover ${covered} art positions (overdraw ${(sum["base.visible"] / covered).toFixed(1)}x)`);
}
