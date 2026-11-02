// node dev/rim-job.test.mjs: the dark rim of a shell read in the codec worker (destruction/rim-job.mjs, job "rims") is what the display's
// addRim makes from the same pixels (the build reads the cover and the base out of the atlas; the worker out of the chunk's sprites):
//   1. a chunk with two areas (base + shards + cover each): the job's strengths = addRim's on the cover / base cut out as display.build cuts them,
//      for every cause (the colour and lift differ by cause); the buffers are transferred; the position is the base row's place;
//   2. an area with no cover row, or not in the chunk, has no rim (build makes none either).
globalThis.Hooks ??= { on() {}, once() {}, off() {} };
// (no PIXI here, as in the worker: rimsOf puts a stand-in in its place)
const C = await import("../scripts/net/chunks.mjs");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };

const F = 18;
const row = (kind, w, h, hash, x, y) => { const m = new Int16Array(F); m[0] = kind; m[3] = w; m[4] = h; m[5] = x; m[6] = y; m[12] = hash & 0xffff; m[13] = (hash >>> 16) & 0xffff; return m; };
const noise = (i, s) => { let a = (i * 2654435761 + s * 40503) >>> 0; a ^= a >>> 13; a = Math.imul(a, 1274126177) >>> 0; return (a ^ (a >>> 16)) >>> 0; };
function img(w, h, seed, fill = 0.8) { const d = new Uint8Array(w * h * 4); for ( let i = 0; i < w * h; i++ ) { const v = noise(i, seed); if ( (v % 100) / 100 < fill ) { const g = v % 256; d[i * 4] = g; d[i * 4 + 1] = (g * 3) & 255; d[i * 4 + 2] = (g * 5) & 255; d[i * 4 + 3] = 255; if ( v % 17 === 0 ) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 20; } } return d; }
const sprite = (kind, w, h, hash, x, y, seed, fill) => ({ m: row(kind, w, h, hash, x, y), w, h, img: img(w, h, seed, fill) });
const H1 = 4100000123, H2 = 777;
const sprites = [
  sprite(0, 30, 24, H1, 100, 200, 1, 0.9), sprite(1, 6, 6, H1, 0, 0, 2), sprite(1, 5, 7, H1, 0, 0, 3), sprite(2, 22, 16, H1, 104, 206, 4, 0.6),
  sprite(0, 18, 18, H2, 300, 50, 5, 0.9), sprite(1, 4, 4, H2, 0, 0, 6)         // (no cover row)
];
const { rimsOf } = await import("../scripts/destruction/rim-job.mjs");
const Cause = await import("../scripts/destruction/cause-fx.mjs");
const direct = (cause, type, hash, base, cover) => {
  const d = { ap: 1, origin: { x: 0, y: 0 }, causeLights: { layer: { destroyed: false, addChild() {} }, groups: new Set(), attach() {} } };
  const g = { hash, info: { cause, type }, rim: null };
  Cause.addRim(d, g, { w: cover.w, h: cover.h, data: cover.img }, cover.m[5], cover.m[6], { w: base.w, h: base.h, data: base.img }, base.m[5], base.m[6]);
  return g.rim;
};
{
  let bad = 0, n = 0;
  for ( const cause of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] ) for ( const type of ["blast", "gash", "collapse"] ) {
    const got = await rimsOf(sprites, [{ hash: H1, cause, type }]);
    const want = direct(cause, type, H1, sprites[0], sprites[3]);
    n++;
    const r = got[0].rim;
    if ( !r || !want || r.LW !== want.LW || r.LH !== want.LH || r.col.join() !== want.col.join() || r.ox !== 100 || r.oy !== 200 || r.A8.length !== want.A8.length || r.A8.some((v, k) => v !== want.A8[k]) ) bad++;
  }
  ok(bad === 0, `the job's rim = addRim's, 10 causes x 3 kinds (${n} runs, ${bad} differ)`);
}
{
  const r = await rimsOf(sprites, [{ hash: H2, cause: 0, type: "blast" }, { hash: 4242, cause: 0, type: "blast" }]);
  ok(r[0].rim === null && r[1].rim === null, "an area without a cover row, and one that is not in the chunk, have no rim");
}
{
  const p = C.packObject(sprites, F), bytes = await C.wrap(p), id = `d${C.hash64(p)}`;
  const out = await C.work({ kind: "rims", bytes, cid: id, areas: [{ hash: H1, cause: 1, type: "blast" }] });
  ok(out.result.length === 1 && out.result[0].rim?.A8?.length > 0 && out.transfer.length === 1, "the worker job on a real chunk: { hash, rim } per area, the strengths' buffer transferred");
}
if ( fails ) { console.log(`${fails} FAILED`); process.exit(1); }
console.log("PASS");
