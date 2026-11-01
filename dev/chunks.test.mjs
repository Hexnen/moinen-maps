/**
 * Node tests of the chunk codec (scripts/net/chunks.mjs): bit-exact round trips on synthetic data and, when present, on the real
 * published bakes of the test world; the GC's safety rules. Run: node dev/chunks.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as C from "../scripts/net/chunks.mjs";
import { decodePng } from "../scripts/destruction/png.mjs";

const F = 18;
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("ok  ", name); } catch ( err ) { console.error("FAIL", name, err); process.exitCode = 1; } };
const rnd = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

async function roundTrip(payload) {
  const png = await C.wrap(payload);
  const back = await C.unwrap(png);
  assert.deepEqual(back, payload);
  return png;
}

function synthWater(box, n, r, { with255 = false } = {}) {
  const frames = Array.from({ length: n }, () => new Uint8Array(box.w * box.h));
  for ( let i = 0; i < box.w * box.h; i++ ) {
    const base = r() < 0.2 ? 3 + Math.floor(r() * 140) : 0, varies = r() < 0.1;
    for ( let f = 0; f < n; f++ ) frames[f][i] = varies ? Math.floor(r() * (with255 ? 256 : 200)) : base;
  }
  if ( with255 ) frames[3][5] = 255;
  return frames;
}

async function waterRoundTrip(frames, box) {
  const out = frames.map(() => new Uint8Array(box.w * box.h));
  let bytes = 0, tiles = 0;
  for ( const t of C.waterTiles(box) ) {
    const p = C.packWaterTile(frames, box, t);
    if ( !p ) continue;
    tiles++;
    const png = await roundTrip(p);
    bytes += png.length;
    C.placeWaterTile(C.unpackWaterTile(await C.unwrap(png)), out, box);
  }
  frames.forEach((f, i) => assert.ok(Buffer.from(f).equals(Buffer.from(out[i])), `frame ${i} differs`));
  return { bytes, tiles };
}

await test("container round trip, sizes 0..9000", async () => {
  for ( const len of [0, 1, 7, 4095, 4096, 4097, 9000] ) {
    const p = new Uint8Array(8 + len); p.set([77, 77, 9, 1]); new DataView(p.buffer).setUint32(4, len, true);
    for ( let i = 8; i < p.length; i++ ) p[i] = (i * 31) & 255;
    await roundTrip(p);
  }
});

await test("a damaged or foreign file is refused", async () => {
  const p = C.packWaterTile(synthWater({ x0: 0, y0: 0, w: 20, h: 20 }, 4, rnd(1)), { x0: 0, y0: 0, w: 20, h: 20 }, { x0: 0, y0: 0, w: 20, h: 20 });
  const png = await C.wrap(p);
  await assert.rejects(C.unwrap(png.subarray(0, png.length - 20)));
  const bad = png.slice(); bad[60] ^= 0xff;
  await assert.rejects(C.unwrap(bad));
  const tomb = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
  await assert.rejects(C.unwrap(tomb));
});

await test("water tiles: bit-exact, unaligned box, sparse and full modes, empty tiles skipped", async () => {
  const box = { x0: 37, y0: 101, w: 300, h: 190 };
  const r = await waterRoundTrip(synthWater(box, 16, rnd(7)), box);
  assert.ok(r.tiles > 0);
  await waterRoundTrip(synthWater(box, 16, rnd(8), { with255: true }), box);
  const neg = { x0: -50, y0: -3, w: 200, h: 140 };
  await waterRoundTrip(synthWater(neg, 5, rnd(9)), neg);
  const empty = Array.from({ length: 4 }, () => new Uint8Array(box.w * box.h));
  for ( const t of C.waterTiles(box) ) assert.equal(C.packWaterTile(empty, box, t), null);
  // tiles cover the box exactly once
  const cover = new Uint8Array(box.w * box.h);
  for ( const t of C.waterTiles(box) ) for ( let y = 0; y < t.h; y++ ) for ( let x = 0; x < t.w; x++ ) cover[(t.y0 + y) * box.w + t.x0 + x]++;
  assert.ok(cover.every((v) => v === 1));
});

await test("water tile ids do not move when the box grows", async () => {
  const big = { x0: 0, y0: 0, w: 400, h: 300 }, frames = synthWater(big, 8, rnd(3));
  const small = { x0: 128, y0: 128, w: 200, h: 150 };
  const crop = frames.map((f) => { const o = new Uint8Array(small.w * small.h); for ( let y = 0; y < small.h; y++ ) o.set(f.subarray((small.y0 + y) * big.w + small.x0, (small.y0 + y) * big.w + small.x0 + small.w), y * small.w); return o; });
  const ids = (fr, box) => new Map(C.waterTiles(box).map((t) => [`${t.tx}_${t.ty}`, t.w === 128 && t.h === 128 ? C.hash64(C.packWaterTile(fr, box, t) ?? new Uint8Array()) : null]));
  const a = ids(frames, big), b = ids(crop, small);
  assert.equal(a.get("1_1"), b.get("1_1"));
  assert.ok(a.get("1_1"));
});

function synthSprites(r, count) {
  const out = [];
  for ( let k = 0; k < count; k++ ) {
    const type = k === 0 ? 0 : k === 1 ? 2 : 1, w = 3 + Math.floor(r() * 40), h = 2 + Math.floor(r() * 30);
    const m = new Int16Array(F); m[0] = type; m[3] = w; m[4] = h; m[5] = Math.floor(r() * 900); m[6] = Math.floor(r() * 900);
    if ( type === 0 ) { m[12] = Math.floor(r() * 65535) - 32768; m[13] = Math.floor(r() * 65535) - 32768; }
    if ( type === 1 ) m[11] = Math.floor(r() * 8);
    const img = new Uint8Array(w * h * 4);
    for ( let i = 0; i < w * h; i++ ) {
      if ( type === 2 ) { if ( r() < 0.6 ) img.fill(255, i * 4, i * 4 + 4); continue; }
      const a = r() < 0.4 ? 0 : r() < 0.1 ? 100 : 255;
      if ( a ) { img[i * 4] = r() * 256; img[i * 4 + 1] = r() * 256; img[i * 4 + 2] = r() * 256; img[i * 4 + 3] = a; }
    }
    out.push({ m, w, h, img });
  }
  return out;
}

await test("destruction object: bit-exact in every sprite mode", async () => {
  const s = synthSprites(rnd(5), 30);
  s[5].img[1] = 9; s[5].img[3] = 0;     // RGB under alpha 0: kept raw
  s[1].img[0] = 7;                       // a cover that is not a pure mask: not packed as bits
  const back = C.unpackObject(await C.unwrap(await roundTrip(C.packObject(s, F))));
  assert.equal(back.F, F);
  back.sprites.forEach((q, k) => { assert.deepEqual(Array.from(q.m), Array.from(s[k].m)); assert.ok(Buffer.from(q.img).equals(Buffer.from(s[k].img)), `sprite ${k}`); });
});

await test("assemble: positions, stroke and area indices, skipped areas", async () => {
  const r = rnd(11), recs = [{ index: 0, sprites: synthSprites(r, 5) }, { index: 2, sprites: [...synthSprites(r, 4), ...synthSprites(r, 3)] }];
  const sh = C.assembleSheet(recs, F);
  const n = sh.meta.length / F;
  let k = 0, area = -1;
  for ( const rec of recs ) for ( const s of rec.sprites ) {
    const m = sh.meta.subarray(k * F, (k + 1) * F); k++;
    if ( s.m[0] === 0 ) { area++; assert.equal(m[16], rec.index); }
    if ( s.m[0] === 1 ) assert.equal(m[11], (area << 4) | (s.m[11] & 15));
    for ( let y = 0; y < s.h; y++ ) assert.ok(Buffer.from(sh.data.subarray(((m[2] + y) * sh.w + m[1]) * 4, ((m[2] + y) * sh.w + m[1] + s.w) * 4)).equals(Buffer.from(s.img.subarray(y * s.w * 4, (y + 1) * s.w * 4))));
  }
  assert.equal(k, n);
  const first = ((recs[0].sprites[0].m[12] & 0xffff) | ((recs[0].sprites[0].m[13] & 0xffff) << 16)) >>> 0;
  const sk = C.assembleSheet(recs, F, (h) => h === first);
  assert.equal(sk.meta.length, sh.meta.length);
  assert.ok(sk.w * sk.h <= sh.w * sh.h);
});

await test("GC: never a referenced file, only after the grace, none when no manifest was read", async () => {
  const seen = new Map(), files = ["a.png", "b.png", "c.png"], ref = new Set(["a.png"]);
  assert.deepEqual(C.gcPick(files, ref, seen, 0), []);                        // first sighting: only remembered
  assert.deepEqual(C.gcPick(files, ref, seen, 60000), []);                    // within the grace
  assert.deepEqual(C.gcPick(files, ref, seen, 16 * 60000), ["b.png", "c.png"]);
  assert.deepEqual(C.gcPick(files, new Set(["a.png", "b.png"]), seen, 17 * 60000), ["c.png"]);   // b used again
  assert.ok(!seen.has("b.png"));
  assert.deepEqual(C.gcPick(files, new Set(), seen, 40 * 60000, { manifests: 0 }), []);          // a failed read deletes nothing
  assert.deepEqual(C.gcPick(files, new Set(), seen, 40 * 60000, { dead: new Set(["c.png"]) }), []);
  assert.deepEqual(C.toUpload(["x", "y", "x", 0, "z"], new Set(["y"])), ["x", "z"]);
});

await test("decode: a chunk whose content does not match its name is refused (partial upload, tombstone, wrong file)", async () => {
  const p = C.packObject([{ m: Int16Array.from({ length: F }, (_, i) => i === 3 || i === 4 ? 2 : 0), w: 2, h: 2, img: new Uint8Array(16).fill(200) }], F);
  const png = await C.wrap(p), id = `d${C.hash64(p)}`;
  const ok = await C.work({ kind: "decode", bytes: png, cid: id });
  assert.equal(ok.result.sprites.length, 1);
  const other = await C.wrap(C.packObject([{ m: Int16Array.from({ length: F }, (_, i) => i === 3 || i === 4 ? 2 : 0), w: 2, h: 2, img: new Uint8Array(16).fill(7) }], F));
  await assert.rejects(C.work({ kind: "decode", bytes: other, cid: id }), /does not match/);   // a valid chunk under another name
  await assert.rejects(C.work({ kind: "decode", bytes: png.subarray(0, png.length >> 1), cid: id }));   // cut off half way
  // a damaged header asking for a huge image is refused before anything is inflated
  const big = png.slice(); const dv = new DataView(big.buffer); dv.setUint32(16, 4096); dv.setUint32(20, 1 << 20);
  await assert.rejects(C.unwrap(big), /too large|not a chunk/);
});

await test("manifest: entries name only codec ids (never a path); copies of a scene keep their files referenced", async () => {
  globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
  const Store = await import("../scripts/destruction/store.mjs"), Pub = await import("../scripts/water/publish.mjs");
  const M = { v: 2, dir: "worlds/w/moinen-maps/c/A", c: { s1: "abc:d0123456789abcd", s2: "abc:../../evil", s3: "nocolon", s4: 5, s5: "x:d0123456789abc" } };
  assert.deepEqual(Store.entryOf(M, "s1"), { sig: "abc", id: "d0123456789abcd" });
  for ( const k of ["s2", "s3", "s4", "s5", "missing"] ) assert.equal(Store.entryOf(M, k), null, k);
  // scene B is a copy of A (its manifest still names A's folder): the GC's references include A's files through B too
  const flags = (dir, c) => ({ flags: { "moinen-maps": { destruction: { v: 3, baked: { v: 2, dir, c } }, destructionObjects: { s1: { id: "s1", v: 2 } } } } });
  const A = flags("worlds/w/moinen-maps/c/A", { s1: "x:d0000000000000a" }), B = flags("worlds/w/moinen-maps/c/A", { s1: "x:d0000000000000b" });
  const ids = [A, B].flatMap((s) => Pub.chunkRecords(s)).flatMap((r) => r.ids.map((id) => `${r.dir}/${id}`));
  assert.deepEqual(ids.sort(), ["worlds/w/moinen-maps/c/A/d0000000000000a", "worlds/w/moinen-maps/c/A/d0000000000000b"]);
});

/* ---------------------------------------------------------------- the real bakes of the test world (when present) */

const WORLD = new URL("../../../worlds/invincible/moinen-maps/", import.meta.url);
// (the GC empties these once the GM's publish has converted the scene to chunks: then the two tests are skipped)
const wf = new URL("water-v83pU5UG6nIrsDFT.png", WORLD), df = new URL("destruction-v83pU5UG6nIrsDFT.png", WORLD);

if ( fs.existsSync(wf) && fs.statSync(wf).size > 1000 ) await test("real water (16 frames): bit-exact through tiles", async () => {
  const d = await decodePng(fs.readFileSync(wf)), bw = d.w / 4, bh = d.h / 4, box = { x0: 13, y0: 5, w: bw, h: bh };
  const frames = Array.from({ length: 16 }, (_, f) => { const a = new Uint8Array(bw * bh), ox = (f % 4) * bw, oy = Math.floor(f / 4) * bh; for ( let y = 0; y < bh; y++ ) for ( let x = 0; x < bw; x++ ) a[y * bw + x] = d.rgba[((oy + y) * d.w + ox + x) * 4]; return a; });
  const r = await waterRoundTrip(frames, box);
  console.log(`      water ${bw}x${bh}x16: ${r.tiles} tiles, ${r.bytes} bytes (file today ${fs.statSync(wf).size})`);
});

if ( fs.existsSync(df) && fs.statSync(df).size > 1000 ) await test("real destruction sheet: split, chunk, assemble, bit-exact sprites and rows", async () => {
  const { readMeta } = await import("../scripts/destruction/core.mjs");
  const d = await decodePng(fs.readFileSync(df));
  let meta = null;
  for ( let r = 1; r < 64 && !meta; r++ ) { try { const m = readMeta(d.rgba, d.w, d.h, r); if ( Math.ceil((m.length * 2 + 4) / 3 / d.w) === r ) meta = m; } catch { /* next */ } }
  const parts = C.splitSheet(d.rgba, d.w, meta, F);
  let bytes = 0;
  const recs = [];
  for ( const [index, sprites] of parts ) {
    const png = await roundTrip(C.packObject(sprites, F));
    bytes += png.length;
    recs.push({ index, sprites: C.unpackObject(await C.unwrap(png)).sprites });
  }
  const sh = C.assembleSheet(recs, F);
  assert.equal(sh.meta.length, meta.length);
  for ( let k = 0; k < meta.length / F; k++ ) {
    const a = meta.subarray(k * F, (k + 1) * F), b = sh.meta.subarray(k * F, (k + 1) * F);
    for ( let f = 0; f < F; f++ ) if ( f !== 1 && f !== 2 ) assert.equal(b[f], a[f], `row ${k} field ${f}`);
    for ( let y = 0; y < a[4]; y++ ) assert.ok(Buffer.from(sh.data.subarray(((b[2] + y) * sh.w + b[1]) * 4, ((b[2] + y) * sh.w + b[1] + a[3]) * 4)).equals(Buffer.from(d.rgba.subarray(((a[2] + y) * d.w + a[1]) * 4, ((a[2] + y) * d.w + a[1] + a[3]) * 4))), `sprite ${k}`);
  }
  console.log(`      destruction: ${parts.size} strokes, ${meta.length / F} sprites, ${bytes} bytes in chunks (file today ${fs.statSync(df).size})`);
});

console.log(`${passed} passed${process.exitCode ? ", SOME FAILED" : ""}`);
