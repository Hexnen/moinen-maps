// node dev/atlas-pack.test.mjs: an area's atlas packed in the codec worker (chunks.mjs packAreaAtlases) is the atlas the display makes
// itself from the decoded sprites (display.restoreAtlas), byte for byte; and the worker job (work: decode + pack) round-trips a chunk.
//   1. one stroke, three areas (base, shards, cover, light): every area's packed atlas = the copy restoreAtlas does;
//   2. an area that is not in the chunk, or whose layout does not match the sprites, comes back with no data (the caller takes the old way);
//   3. the decode job with `pack` gives { atlases } and keeps the sprites in the worker (no `sprites` in its result).
globalThis.Hooks ??= { on() {}, once() {}, off() {} };
const C = await import("../scripts/net/chunks.mjs");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };

const F = 18;
const row = (kind, w, h, hash) => { const m = new Int16Array(F); m[0] = kind; m[3] = w; m[4] = h; m[12] = hash & 0xffff; m[13] = (hash >>> 16) & 0xffff; return m; };
const img = (w, h, seed) => { const d = new Uint8Array(w * h * 4); for ( let i = 0; i < w * h; i++ ) { const v = (i * 7 + seed * 13) % 251; if ( v % 5 ) { d[i * 4] = v; d[i * 4 + 1] = (v * 3) & 255; d[i * 4 + 2] = (v * 5) & 255; d[i * 4 + 3] = 255; } } return d; };
const sprite = (kind, w, h, hash, seed) => ({ m: row(kind, w, h, hash), w, h, img: img(w, h, seed) });

// three areas: 1 has a base, 2 shards, a cover and a light; 2 base + 1 shard; 3 base only
const hashes = [70001, 4000000001, 123];
const sprites = [
  sprite(0, 12, 9, hashes[0], 1), sprite(1, 5, 4, hashes[0], 2), sprite(1, 6, 3, hashes[0], 3), sprite(2, 8, 8, hashes[0], 4), sprite(3, 7, 7, hashes[0], 5),
  sprite(0, 10, 10, hashes[1], 6), sprite(1, 4, 4, hashes[1], 7),
  sprite(0, 3, 3, hashes[2], 8)
];
// the layouts display.build would make (shelf-like: just positions inside a W x H sheet, gutters between)
const layout = (sizes) => { let x = 1, y = 1, rowH = 0; const W = 40, pos = []; for ( const [w, h] of sizes ) { if ( x + w + 1 > W ) { x = 1; y += rowH + 1; rowH = 0; } pos.push({ x, y }); x += w + 1; rowH = Math.max(rowH, h); } return { W, H: y + rowH + 2, pos, sizes }; };
const areas = [[0, 5], [5, 7], [7, 8]].map(([a, b]) => sprites.slice(a, b).map((s) => [s.w, s.h]));
const specs = hashes.map((hash, i) => ({ hash, ...layout(areas[i]) }));

// the display's own copy (restoreAtlas)
const restore = (list, sp) => {
  const buf = new Uint8Array(sp.W * sp.H * 4);
  for ( let i = 0; i < list.length; i++ ) { const s = list[i], [w, h] = sp.sizes[i], p = sp.pos[i]; for ( let y = 0; y < h; y++ ) buf.set(s.img.subarray(y * w * 4, (y + 1) * w * 4), ((p.y + y) * sp.W + p.x) * 4); }
  return buf;
};
{
  const got = C.packAreaAtlases(sprites, specs);
  const want = [sprites.slice(0, 5), sprites.slice(5, 7), sprites.slice(7, 8)].map((l, i) => restore(l, specs[i]));
  ok(got.length === 3 && got.every((g, i) => g.hash === hashes[i] && g.data && g.data.length === want[i].length && g.data.every((v, k) => v === want[i][k])), "the packed atlases of three areas = display.restoreAtlas' copy");
}
{
  const bad = { ...specs[1], sizes: specs[1].sizes.slice(0, 1) }, absent = { ...specs[2], hash: 999 }, wrong = { ...specs[2], sizes: [[4, 3]] };
  const got = C.packAreaAtlases(sprites, [bad, absent, wrong, specs[2]]);
  ok(!got[0].data && !got[1].data && !got[2].data && !!got[3].data, "a missing area / a layout of another length / another size gives no data; the right one does");
}
// the worker job: a chunk (packObject + wrap) through `work`, with and without pack
{
  const p = C.packObject(sprites, F), bytes = await C.wrap(p), id = `d${C.hash64(p)}`;
  const withPack = await C.work({ kind: "decode", bytes: bytes.slice(), cid: id, pack: specs });
  ok(!withPack.result.sprites && withPack.result.atlases?.length === 3 && withPack.result.atlases.every((a) => a.data), "decode + pack: { atlases } only, the sprites stay in the worker");
  ok(withPack.transfer.length === 3, "the atlases' buffers are transferred");
  const direct = C.packAreaAtlases(sprites, specs);
  ok(withPack.result.atlases.every((a, i) => a.data.every((v, k) => v === direct[i].data[k])), "the worker's atlases = packing the sprites here");
  const plain = await C.work({ kind: "decode", bytes: bytes.slice(), cid: id });
  ok(plain.result.sprites?.length === sprites.length, "decode without pack: the sprites, as before");
}
if ( fails ) { console.log(`${fails} FAILED`); process.exit(1); }
console.log("PASS");
