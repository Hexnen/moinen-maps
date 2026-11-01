// Crack strokes (core.mjs crackStrokes): the generator's own measures over a corpus of taps and followed strokes on paving, planks
// and grass at every level.   node dev/cracks.test.mjs
//  1. width profile: the dominant fissure's root is >= 3 px at the crater level, every tip ends at about one pixel (<= 1.05);
//  2. no blob nodes: no disc of radius 2 lies wholly inside a crack (junctions are thin Ys);
//  3. propagation, not a smooth tree: sharp 60-90 degree kinks occur (on average >= 0.5 per area);
//  4. secondaries of clearly different lengths: the coefficient of variation of their lengths over the corpus > 0.4, and an area at
//     level 3 has 1-4 of them (few side thorns);
//  5. deterministic: the same input bakes the same measures.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = await import(pathToFileURL(path.join(root, "scripts/destruction/core.mjs")).href);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) failed++; };
const K = 2, AW = 300, AH = 200, MW = AW / K, MH = AH / K;
const h = (x, y, s) => { let v = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0; v = Math.imul(v ^ (v >>> 13), 1103515245); v ^= v >>> 16; return (v >>> 0) / 4294967296; };
const map = new Uint8ClampedArray(AW * AH * 4);
for ( let y = 0; y < AH; y++ ) for ( let x = 0; x < AW; x++ ) {
  const n = h(x, y, 3) * 24 - 12, o = (y * AW + x) * 4, third = (x / 100) | 0, row = (y / 10) | 0;
  const c = third === 0 ? ((x + (row % 2) * 6) % 12 === 0 || y % 10 === 0 ? [70, 68, 66] : [128 + n, 124 + n, 118 + n])
    : third === 1 ? (y % 7 === 0 ? [70, 44, 26] : [146 + n, 98 + n, 58 + n]) : [74 + n, 122 + n * 1.2, 52 + n * 0.6];
  map.set([c[0], c[1], c[2], 255], o);
}
function stroke(id, cx, cy, r, lv, path = null) {
  const x0 = Math.max(0, Math.floor(cx - r - 40)), y0 = Math.max(0, Math.floor(cy - r - 10)), x1 = Math.min(MW - 1, Math.ceil(cx + r + 40)), y1 = Math.min(MH - 1, Math.ceil(cy + r + 10));
  const w = x1 - x0 + 1, hh = y1 - y0 + 1, bytes = new Uint8Array(w * hh);
  for ( let y = 0; y < hh; y++ ) for ( let x = 0; x < w; x++ ) {
    const px = x0 + x + 0.5, py = y0 + y + 0.5;
    const d = path ? Math.min(...path.map(([a, b], i) => i ? (() => { const [c, e] = path[i - 1]; const sx = a / K - c / K, sy = b / K - e / K, l2 = sx * sx + sy * sy || 1, t = Math.max(0, Math.min(1, ((px - c / K) * sx + (py - e / K) * sy) / l2)); return Math.hypot(px - c / K - sx * t, py - e / K - sy * t); })() : Infinity)) : Math.hypot(px - cx, py - cy);
    if ( d <= r ) bytes[y * w + x] = lv;
  }
  return { id, k: 0, t: 4, x0, y0, w, h: hh, bytes, path };
}
const P0 = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", jagged: false, jag: 0.6, directional: true };
const bake = (ob) => core.bake({ objects: [ob], K, aw: AW, ah: AH, seed: 11, params: P0, map: { w: AW, h: AH, data: map }, mapKey: "cr" }, null).stats.cracks ?? [];
const all = [];
for ( const cx of [25, 75, 125] ) for ( const lv of [1, 2, 3] ) for ( let s = 0; s < 3; s++ ) {
  all.push(...bake(stroke(`t${cx}${lv}${s}`, cx, 50 + s * 3, 12 + s * 2, lv)));
  const P = [[(cx - 18) * K, (50 + s * 4) * K], [cx * K, (44 - s) * K], [(cx + 18) * K, (54 + s) * K]];
  all.push(...bake(stroke(`p${cx}${lv}${s}`, cx, 50, 6, lv, P)));
}
const l3 = all.filter((q) => q.level > 2.4);
ok(l3.length > 0 && l3.every((q) => q.root >= 3), `the dominant fissure's root is >= 3 px at the crater level (${l3.map((q) => q.root.toFixed(1)).slice(0, 6).join(", ")}...)`);
const tips = all.flatMap((q) => q.tips);
ok(tips.every((w) => w <= 1.05), `every tip ends at about one pixel (max ${Math.max(...tips).toFixed(2)})`);
ok(all.every((q) => q.blobs === 0), `no blob nodes (a radius-2 disc wholly in a crack): ${all.reduce((s, q) => s + q.blobs, 0)}`);
const kinks = all.reduce((s, q) => s + q.kinks, 0) / all.length;
ok(kinks >= 0.5, `sharp kinks occur: ${kinks.toFixed(2)} per area`);
const sec = all.flatMap((q) => q.sec), mean = sec.reduce((s, v) => s + v, 0) / sec.length, cv = Math.sqrt(sec.reduce((s, v) => s + (v - mean) ** 2, 0) / sec.length) / mean;
ok(sec.length > 0 && cv > 0.4, `secondaries of different lengths: CV ${cv.toFixed(2)} over ${sec.length}`);
ok(l3.every((q) => q.sec.length >= 1 && q.sec.length <= 4), `a crater-level area has 1-4 secondaries (${l3.map((q) => q.sec.length).join(",")})`);
const again = bake(stroke("t7531", 75, 53, 14, 3));
ok(JSON.stringify(again) === JSON.stringify(bake(stroke("t7531", 75, 53, 14, 3))), "deterministic");
console.log(failed ? `FAILED ${failed}` : "PASS");
process.exit(failed ? 1 : 0);
