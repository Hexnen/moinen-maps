// node coretest.mjs <path to core.mjs>: per-area stability + cache reuse + timing
// (node dev/tools/core-stability.mjs <core.mjs> [jag] compares per-area stability across core versions; <core.mjs> may be a git-extracted old copy)
const core = await import(new URL("file:///" + process.argv[2].replace(/\\/g, "/")).href);
const aw = 1334, ah = 1000, K = 2, mw = Math.ceil(aw / K), mh = Math.ceil(ah / K);
const map = { w: aw, h: ah, data: new Uint8ClampedArray(aw * ah * 4) };
for ( let i = 0; i < aw * ah; i++ ) { const x = i % aw, y = (i / aw) | 0; map.data.set([70 + ((x * 7 + y * 3) % 40), 110 + ((x ^ y) % 30), 50 + (y % 20), 255], i * 4); }
const params = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", jagged: process.argv[3] === "jag", jag: 0.8 };
const disc = (mask, cx, cy, r, level, type) => { for ( let y = cy - r; y <= cy + r; y++ ) for ( let x = cx - r; x <= cx + r; x++ ) if ( (x - cx) ** 2 + (y - cy) ** 2 <= r * r ) mask[y * mw + x] = level | (type << 2); };
const run = (mask, cache) => { const t = performance.now(); const r = core.bake({ mask, mw, mh, K, aw, ah, seed: 4242, params, map, mapKey: "m" }, cache); r.t = performance.now() - t; return r; };
const areas = (r) => { const out = new Map(), F = core.META_FIELDS; const W = r.sheet.w;
  let cur = null;
  for ( let k = 0; k < r.count; k++ ) { const o = k * F, m = r.meta;
    const px = []; for ( let y = 0; y < m[o + 4]; y++ ) for ( let x = 0; x < m[o + 3]; x++ ) { const q = ((m[o + 2] + y) * W + m[o + 1] + x) * 4; px.push(r.sheet.data[q], r.sheet.data[q + 1], r.sheet.data[q + 2], r.sheet.data[q + 3]); }
    let h = 2166136261; for ( const v of px ) h = Math.imul(h ^ v, 16777619);
    const sig = [...m.slice(o + 3, o + 11), h >>> 0].join(",");
    if ( m[o] === 0 ) { cur = `${(m[o + 12] & 0xffff) | ((m[o + 13] & 0xffff) << 16)}`; out.set(cur, [sig]); } else out.get(cur).push(sig);
  }
  return out; };
const A = new Uint8Array(mw * mh); disc(A, 150, 150, 20, 3, 0); disc(A, 400, 300, 14, 2, 5);
const AB = A.slice(); disc(AB, 60, 420, 25, 3, 2); disc(AB, 600, 40, 10, 3, 3);
const r1 = run(A, null), r2 = run(AB, null);
const a1 = areas(r1), a2 = areas(r2);
let same = 0; for ( const [h, s] of a1 ) if ( a2.has(h) && a2.get(h).join("|") === s.join("|") ) same++;
console.log("areas", a1.size, a2.size, "A areas identical after adding B:", same, "/", a1.size, "t", r1.t.toFixed(0), r2.t.toFixed(0));
const cache = new Map(); const c1 = run(A, cache), c2 = run(AB, cache), c3 = run(AB, cache);
console.log("cached: first", c1.t.toFixed(0), "ms baked", c1.stats.baked, "| add B", c2.t.toFixed(0), "ms baked", c2.stats.baked, "reused", c2.stats.reused, "| again", c3.t.toFixed(0), "ms reused", c3.stats.reused);
let h1 = 2166136261, h2 = 2166136261; for ( const v of r2.sheet.data ) h1 = Math.imul(h1 ^ v, 16777619); for ( const v of c3.sheet.data ) h2 = Math.imul(h2 ^ v, 16777619);
console.log("fresh vs cached sheet identical:", h1 === h2, "stats", JSON.stringify(c3.stats));
