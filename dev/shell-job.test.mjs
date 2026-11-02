// node dev/shell-job.test.mjs: a shell's area built in the codec worker (chunks.mjs packShellAreas, job "decode" with `shells`):
//   1. the layout is the display's own (atlas-layout.mjs pack of [base, shards, cover, light] sizes) and the atlas holds each sprite at
//      its place - the same bytes packAreaAtlases makes for that layout (what restoreAtlas puts back later);
//   2. the area's rows come back with the sheet position = the layout and the stroke index on the base row (display.build reads them);
//   3. an area not in the chunk, or a sprite without pixels, gives data null;
//   4. the worker job on a real chunk: shells + (dark) rims in one pass, the buffers transferred; the rims = rim-job's.
globalThis.Hooks ??= { on() {}, once() {}, off() {} };
const C = await import("../scripts/net/chunks.mjs");
const { pack } = await import("../scripts/destruction/atlas-layout.mjs");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };

const F = 18;
const row = (kind, w, h, hash, x, y) => { const m = new Int16Array(F); m[0] = kind; m[3] = w; m[4] = h; m[5] = x; m[6] = y; m[12] = hash & 0xffff; m[13] = (hash >>> 16) & 0xffff; m[1] = 77; m[2] = 88; return m; };
const noise = (i, s) => { let a = (i * 2654435761 + s * 40503) >>> 0; a ^= a >>> 13; a = Math.imul(a, 1274126177) >>> 0; return (a ^ (a >>> 16)) >>> 0; };
function img(w, h, seed, fill = 0.8) { const d = new Uint8Array(w * h * 4); for ( let i = 0; i < w * h; i++ ) { const v = noise(i, seed); if ( (v % 100) / 100 < fill ) { const g = v % 256; d[i * 4] = g; d[i * 4 + 1] = (g * 3) & 255; d[i * 4 + 2] = (g * 5) & 255; d[i * 4 + 3] = 255; } } return d; }
const sprite = (kind, w, h, hash, x, y, seed, fill) => ({ m: row(kind, w, h, hash, x, y), w, h, img: img(w, h, seed, fill) });
const H1 = 4100000123, H2 = 777;
const sprites = [
  sprite(0, 30, 24, H1, 100, 200, 1, 0.9), sprite(1, 6, 6, H1, 0, 0, 2), sprite(1, 5, 7, H1, 0, 0, 3), sprite(2, 22, 16, H1, 104, 206, 4, 0.6), sprite(3, 9, 9, H1, 98, 198, 7),
  sprite(0, 18, 18, H2, 300, 50, 5, 0.9), sprite(1, 4, 4, H2, 0, 0, 6)         // (no cover row)
];
{
  const got = C.packShellAreas(sprites, [{ hash: H1, index: 5 }, { hash: H2, index: 9 }]);
  const want = pack(sprites.slice(0, 5).map((s) => ({ w: s.w, h: s.h })));
  const a = got[0];
  ok(a.W === want.W && a.H === want.H && a.pos.every((p, i) => p.x === want.pos[i].x && p.y === want.pos[i].y), "the layout is the display's own pack()");
  ok(a.data.length === a.W * a.H * 4 && a.sizes.length === 5, "the atlas is W x H RGBA, one size per sprite");
  const via = C.packAreaAtlases(sprites, [{ hash: H1, W: a.W, H: a.H, pos: a.pos, sizes: a.sizes }])[0].data;
  ok(via && via.length === a.data.length && via.every((v, i) => v === a.data[i]), "the atlas = packAreaAtlases' for that layout (restoreAtlas puts back the same)");
  const F2 = a.meta.length / 5;
  ok(F2 === F && a.meta[1] === a.pos[0].x && a.meta[2] === a.pos[0].y && a.meta[F + 1] === a.pos[1].x && a.meta[4 * F + 2] === a.pos[4].y, "the rows carry the sheet position = the layout");
  ok(a.meta[16] === 5 && got[1].meta[16] === 9 && a.meta[0] === 0 && a.meta[3 * F] === 2 && a.meta[4 * F] === 3, "the base row carries the stroke index; rows in order base, shards, cover, light");
  ok(sprites[0].m[1] === 77 && sprites[0].m[16] === 0, "the chunk's own rows are not touched");
  const b = got[1];
  ok(b.sizes.length === 2 && b.W === pack([{ w: 18, h: 18 }, { w: 4, h: 4 }]).W, "an area with no cover and no light: base + its shards only");
}
{
  const got = C.packShellAreas(sprites, [{ hash: 4242, index: 0 }]);
  const lean = sprites.map((s) => ({ ...s })); lean[1] = { ...lean[1], img: null };
  const g2 = C.packShellAreas(lean, [{ hash: H1, index: 0 }]);
  ok(got[0].data === null && g2[0].data === null, "an area not in the chunk, or with a sprite without pixels, gives no data");
  const sq = C.packShellAreas(sprites, [{ hash: H1, index: 0 }], true)[0];
  ok(sq.W === pack(sprites.slice(0, 5).map((s) => ({ w: s.w, h: s.h })), true).W, "squareAtlas is passed through to the layout");
}
{
  const p = C.packObject(sprites, F), bytes = await C.wrap(p), id = `d${C.hash64(p)}`;
  const out = await C.work({ kind: "decode", bytes, cid: id, shells: [{ hash: H1, index: 3 }, { hash: H2, index: 4 }], rims: [{ hash: H1, cause: 1, type: "blast" }, { hash: H2, cause: 0, type: "blast" }] });
  const r = out.result;
  const { rimsOf } = await import("../scripts/destruction/rim-job.mjs");
  const want = (await rimsOf(sprites, [{ hash: H1, cause: 1, type: "blast" }]))[0].rim;
  ok(r.shells.length === 2 && r.shells.every((s) => s.data?.length > 0), "the worker job: both areas built");
  ok(r.rims.length === 2 && r.rims[0].rim?.A8?.length === want.A8.length && r.rims[0].rim.A8.every((v, i) => v === want.A8[i]) && r.rims[1].rim === null, "the rims come in the same pass (= rim-job's; no cover: none)");
  ok(out.transfer.length === 2 * 2 + 1, "the atlases', rows' and rim buffers are transferred");
  const none = await C.work({ kind: "decode", bytes: await C.wrap(p), cid: id, shells: [{ hash: H2, index: 0 }] });
  ok(none.result.rims === null, "no rims asked: none made");
}
if ( fails ) { console.log(`${fails} FAILED`); process.exit(1); }
console.log("PASS");
