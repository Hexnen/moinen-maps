// node --cpu-prof coreprof.mjs <core.mjs>: one big area (long thick strokes) to profile
const core = await import(new URL("file:///" + process.argv[2].replace(/\\/g, "/")).href);
const aw = 1334, ah = 1000, K = 2, mw = Math.ceil(aw / K), mh = Math.ceil(ah / K);
const map = { w: aw, h: ah, data: new Uint8ClampedArray(aw * ah * 4) };
for ( let i = 0; i < aw * ah; i++ ) { const x = i % aw, y = (i / aw) | 0; map.data.set([70 + ((x * 7 + y * 3) % 40), 110 + ((x ^ y) % 30), 50 + (y % 20), 255], i * 4); }
const params = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", jagged: false, jag: 0.6 };
const mask = new Uint8Array(mw * mh);
const line = (x0, y0, x1, y1, r) => { for ( let t = 0; t <= 1; t += 0.01 ) { const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t; for ( let y = Math.floor(cy - r); y <= cy + r; y++ ) for ( let x = Math.floor(cx - r); x <= cx + r; x++ ) if ( (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= 0 && y >= 0 && x < mw && y < mh ) mask[y * mw + x] = 3; } };
if ( process.argv[3] === "huge" ) { line(40, 40, 620, 460, 22); line(620, 40, 40, 460, 22); } else { line(100, 100, 500, 300, 17); line(500, 300, 200, 450, 17); line(300, 50, 320, 450, 17); }
const t = performance.now();
const r = core.bake({ mask, mw, mh, K, aw, ah, seed: 4242, params, map, mapKey: "m" }, null);
console.log("big area bake", (performance.now() - t).toFixed(0), "ms", JSON.stringify({ ...r.stats, materials: undefined }));
