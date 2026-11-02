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
  // (0.4.2: an entry carries the version its stroke was baked with; "sig:id" of 0.4.1 takes its manifest base's version, -1 here)
  assert.deepEqual(Store.entryOf(M, "s1"), { sig: "abc", id: "d0123456789abcd", ver: -1 });
  for ( const k of ["s2", "s3", "s4", "s5", "missing"] ) assert.equal(Store.entryOf(M, k), null, k);
  // scene B is a copy of A (its manifest still names A's folder): the GC's references include A's files through B too
  const flags = (dir, c) => ({ flags: { "moinen-maps": { destruction: { v: 3, baked: { v: 2, dir, c } }, destructionObjects: { s1: { id: "s1", v: 2 } } } } });
  const A = flags("worlds/w/moinen-maps/c/A", { s1: "x:d0000000000000a" }), B = flags("worlds/w/moinen-maps/c/A", { s1: "x:d0000000000000b" });
  const ids = [A, B].flatMap((s) => Pub.chunkRecords(s)).flatMap((r) => r.ids.map((id) => `${r.dir}/${id}`));
  assert.deepEqual(ids.sort(), ["worlds/w/moinen-maps/c/A/d0000000000000a", "worlds/w/moinen-maps/c/A/d0000000000000b"]);
});

await test("composite tiles: bit-exact (premultiplied planes, raw fallback), named by content, refused under another name", async () => {
  const r = rnd(21);
  for ( const [w, h] of [[1, 1], [37, 19], [1024, 3], [300, 300]] ) {
    const data = new Uint8Array(w * h * 4);
    for ( let i = 0; i < w * h; i++ ) { const a = r() < 0.4 ? 0 : r() < 0.2 ? Math.floor(r() * 255) : 255; if ( a ) { data[i * 4] = Math.floor(r() * (a + 1)); data[i * 4 + 1] = Math.floor(r() * (a + 1)); data[i * 4 + 2] = Math.floor(r() * (a + 1)); data[i * 4 + 3] = a; } }
    const t = { x: -5 + w, y: 1234, w, h, res: 1, data };
    const p = C.packTile(t);
    assert.equal(p[22], 1);
    const back = C.unpackTile(await C.unwrap(await roundTrip(p)));
    assert.deepEqual({ ...back, data: null }, { ...t, data: null });
    assert.ok(Buffer.from(back.data).equals(Buffer.from(data)), `${w}x${h}`);
    // colour under alpha 0 (not premultiplied): raw, still exact
    const odd = data.slice(); odd[0] = 3; odd[3] = 0;
    const q = C.packTile({ ...t, data: odd });
    assert.equal(q[22], 0);
    assert.ok(Buffer.from(C.unpackTile(q).data).equals(Buffer.from(odd)));
  }
  const res = await C.work({ kind: "tiles", tiles: [{ x: 0, y: 0, w: 2, h: 1, res: 1, data: new Uint8Array([9, 9, 9, 255, 0, 0, 0, 0]) }], index: { a: 1 } });
  const tid = res.result.tiles[0].id, dec = await C.work({ kind: "decode", bytes: res.result.tiles[0].bytes, cid: tid });
  assert.deepEqual(Array.from(dec.result.tile.data), [9, 9, 9, 255, 0, 0, 0, 0]);
  assert.deepEqual((await C.work({ kind: "decode", bytes: res.result.index.bytes, cid: res.result.index.id })).result.index, { a: 1 });
  await assert.rejects(C.work({ kind: "decode", bytes: res.result.tiles[0].bytes, cid: res.result.index.id }), /does not match/);
  // known ids are not encoded again
  const again = await C.work({ kind: "tiles", tiles: [{ x: 0, y: 0, w: 2, h: 1, res: 1, data: new Uint8Array([9, 9, 9, 255, 0, 0, 0, 0]) }], index: { a: 1 }, known: [tid] });
  assert.equal(again.result.tiles[0].id, tid); assert.equal(again.result.tiles[0].bytes, null);
});

await test("composite manifest: band keys across clients, tile diffing", async () => {
  const k = C.bandKey(0, 1, 0, true, [5, 6, 7]);
  assert.equal(k, C.bandKey(0, 1, 0, true, [5, 6, 7]));
  for ( const o of [C.bandKey(2, 1, 0, true, [5, 6, 7]), C.bandKey(0, 1, 1, true, [5, 6, 7]), C.bandKey(0, 1, 0, false, [5, 6, 7]), C.bandKey(0, 1, 0, true, [5, 7, 6]), C.bandKey(0, 1, 0, true, [5, 6])] ) assert.notEqual(o, k);
  const prev = [{ key: "a", tiles: [{ id: "k1" }, { id: "k2" }] }, { key: "b", tiles: [{ id: "k3" }] }];
  const next = [{ key: "a2", tiles: [{ id: "k1" }, { id: "k4" }] }, { key: "b", tiles: [{ id: "k3" }] }];
  assert.deepEqual(C.diffComposite(prev, next), { upload: ["k4"], kept: ["k1", "k3"], dropped: ["k2"] });
  assert.deepEqual(C.diffComposite(null, next).upload, ["k1", "k4", "k3"]);
  // the GC keeps a composite's files: its record names them like a water record ({ v: 2, dir, t })
  globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
  const Pub = await import("../scripts/water/publish.mjs");
  const recs = Pub.chunkRecords({ flags: { "moinen-maps": { destructionComposite: { v: 2, dir: "worlds/w/moinen-maps/c/A", t: ["k1", "x2"] } } } });
  assert.deepEqual(recs, [{ dir: "worlds/w/moinen-maps/c/A", ids: ["k1", "x2"] }]);
});

await test("composite culling: only texels the bands above hide with a texel of margin, never the top band, never transparent ones", async () => {
  globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
  const { cull } = await import("../scripts/destruction/composite.mjs");
  const tile = (L, x, y, w, h, fill) => { const data = new Uint8Array(w * h * 4); for ( let i = 0; i < w * h; i++ ) data.set(fill(i % w, (i / w) | 0), i * 4); return { L, x, y, w, h, data, fresh: true }; };
  const low = tile(0, 0, 0, 10, 10, () => [10, 20, 30, 200]);
  const top = tile(2, 2, 2, 6, 6, (x, y) => (x === 0 && y === 0 ? [5, 5, 5, 128] : [50, 60, 70, 255]));   // one corner not opaque
  const mid = tile(1, 0, 0, 3, 3, () => [1, 2, 3, 255]);
  const topCopy = top.data.slice();
  cull([low, top, mid], 1);
  assert.ok(Buffer.from(top.data).equals(Buffer.from(topCopy)), "the top band is never cleared");
  const a = (q, x, y) => q.data[(y * q.w + x) * 4 + 3];
  // hidden with a margin: inside the opaque 6x6 at (2..7) less the corner, eroded by one -> (3..6) minus what touches the corner (2,2)
  for ( let y = 0; y < 10; y++ ) for ( let x = 0; x < 10; x++ ) {
    // (and (1,1): the middle band's opaque 3x3 at (0..2) hides it too)
    // ((3,3) stays: the top band's corner (2,2) is half transparent; the middle band covers (2,2) but not the rest of (3,3)'s 3x3 -
    // two bands each covering a part do not hide)
    const inner = (x >= 3 && x <= 6 && y >= 3 && y <= 6 && !(x === 3 && y === 3)) || (x === 1 && y === 1);
    assert.equal(a(low, x, y) === 0, inner, `low ${x},${y}`);
  }
  // without the middle band, the top band's half-transparent corner keeps (3,3)
  const low2 = tile(0, 0, 0, 10, 10, () => [10, 20, 30, 200]), top2 = tile(2, 2, 2, 6, 6, (x, y) => (x === 0 && y === 0 ? [5, 5, 5, 128] : [50, 60, 70, 255]));
  cull([low2, top2], 1);
  assert.ok(a(low2, 3, 3) && !a(low2, 4, 4) && a(low2, 2, 2) && a(low2, 7, 7));
  // the default margin (mip levels down to zoom 1/4): 9 texels of the upper band's opaque area round a cleared texel
  const big = tile(0, 0, 0, 40, 40, () => [9, 9, 9, 255]), over = tile(2, 0, 0, 40, 40, () => [7, 7, 7, 255]);
  cull([big, over]);
  for ( let y = 0; y < 40; y++ ) for ( let x = 0; x < 40; x++ ) assert.equal(a(big, x, y) === 0, x >= 9 && y >= 9 && x <= 30 && y <= 30, `big ${x},${y}`);
  // the middle band is hidden by the top band only where it overlaps it with a margin: nowhere (it lies at its corner)
  assert.ok(mid.data.every((v, i) => v === [1, 2, 3, 255][i % 4]));
});

await test("composite: settled after a Rebake all (the frames of one, in order) - a publish is due once nothing moves", async () => {
  globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
  const { unsettled } = await import("../scripts/destruction/composite.mjs");
  const band = { meta: true, ok: true };
  // a Rebake all: the loaded scene (shells, bands from the composite), the records swapped in (the cache waits for shells' pixels,
  // cross-fades), the last swap, the water back: only the last frame is settled
  const frames = [
    { mode: "scene+live", dirty: false, waiting: false, bands: [band] },                                          // loaded: settled
    { mode: "scene+live", dirty: true, waiting: false, bands: [band] },                                           // a swap landed
    { mode: "scene+live", dirty: false, waiting: true, bands: [band] },                                           // bands wait for shells
    { mode: "busy", dirty: false, waiting: false, moving: 200, bands: [band] },                                   // the swaps cross-fade
    { mode: "scene+live", dirty: false, waiting: false, moving: 3, dying: 2, bands: [band] },                     // the last ones
    { mode: "scene+live", dirty: false, waiting: false, holes: ["ready", "baking"], bands: [band] },               // a hole's water
    { mode: "scene+live", dirty: false, waiting: false, holes: ["ready", "none"], bands: [band, { meta: true, ok: false }] },
    { mode: "scene+live", dirty: false, waiting: false, holes: ["ready", "none"], bands: [band, band] }];        // settled
  const got = frames.map((f) => unsettled(f));
  assert.equal(got[0], null);
  assert.deepEqual(got.slice(1, 7).map((w) => w.split(":")[0]), ["cache-not-settled", "cache-not-settled", "cache-not-settled", "moving", "water-not-ready", "bands"]);
  assert.equal(got[7], null);
  assert.equal(unsettled({ mode: "live" }), "cache-not-settled:live");
  assert.equal(unsettled({ mode: "scene", bands: [] }), "bands");
});

/* ---------------------------------------------------------------- bundles and the worker's cull (round 2) */

await test("bundle: small chunks of every kind in one file, each member verified against its own name, `only` decodes one", async () => {
  const r = rnd(7), box = { x0: 0, y0: 0, w: 128, h: 100 }, frames = synthWater(box, 4, r);
  const members = [];
  for ( const t of C.waterTiles(box) ) { const p = C.packWaterTile(frames, box, t); if ( p ) members.push({ id: `w${C.hash64(p)}`, bytes: await C.wrap(p), p }); }
  const spr = [{ m: Int16Array.from({ length: F }, (_, i) => (i === 3 ? 4 : i === 4 ? 3 : 0)), w: 4, h: 3, img: new Uint8Array(4 * 3 * 4).map((_, i) => (i * 7) & 255) }];
  { const q = C.packObject(spr, F); members.push({ id: `d${C.hash64(q)}`, bytes: await C.wrap(q), p: q }); }
  { const q = C.packIndex({ v: 1, areas: { a: 1 } }); members.push({ id: `x${C.hash64(q)}`, bytes: await C.wrap(q), p: q }); }
  { const q = C.packTile({ x: 3, y: 4, w: 2, h: 2, res: 1, data: Uint8Array.from([1, 2, 3, 255, 0, 0, 0, 0, 9, 8, 7, 128, 4, 5, 6, 255]) }); members.push({ id: `k${C.hash64(q)}`, bytes: await C.wrap(q), p: q }); }
  assert.ok(members.length >= 4);
  const job = await C.work({ kind: "bundle", members: members.map((q) => ({ id: q.id, bytes: q.bytes })).reverse() });
  const b = job.result;
  assert.deepEqual(b.ids, [...members.map((q) => q.id)].sort(), "members sorted by id, whatever the order they came in");
  const again = await C.work({ kind: "bundle", members: members.map((q) => ({ id: q.id, bytes: q.bytes })) });
  assert.equal(again.result.id, b.id, "the same members make the same bundle (same id) on every client");
  assert.equal(b.id, `b${C.hash64(await C.unwrap(b.bytes))}`);
  // decode: every member, bit-exact against its own decoder
  const all = (await C.work({ kind: "decode", bytes: b.bytes, cid: b.id })).result.bundle;
  assert.equal(all.length, members.length);
  for ( const q of members ) {
    const got = all.find((x) => x.id === q.id).result, one = (await C.work({ kind: "decode", bytes: q.bytes, cid: q.id })).result;
    assert.deepEqual(got, one, `member ${q.id} decodes as its single file does`);
  }
  const only = (await C.work({ kind: "decode", bytes: b.bytes, cid: b.id, only: [members[0].id] })).result.bundle;
  assert.deepEqual(only.map((x) => x.id), [members[0].id]);
  // a bundle under another name is refused; a damaged member is left out (its single file is used), the rest still decode
  await assert.rejects(C.work({ kind: "decode", bytes: b.bytes, cid: `b${C.hash64(new Uint8Array(3))}` }));
  const bad = members.map((q) => ({ id: q.id, bytes: q.bytes }));
  bad[0] = { id: members[1].id, bytes: members[0].bytes };                   // a file under the wrong name never goes in
  const part = (await C.work({ kind: "bundle", members: bad })).result;
  assert.ok(!part.ids.includes(members[1].id) || part.ids.filter((x) => x === members[1].id).length === 1);
  assert.equal(part.ids.length, members.length - 1 + (0), "the mismatched file is dropped, the duplicate name is kept once");
  // container checks
  const raw = C.packBundle([{ id: "wabc", payload: members[0].p }]);
  assert.throws(() => C.unpackBundle(raw.subarray(0, raw.length - 3)));
  assert.equal(C.unpackBundle(raw)[0].id, "wabc");
});

await test("bundle buckets: a changed chunk changes one bundle, the others keep their members", () => {
  const ids = Array.from({ length: 200 }, (_, i) => `d${(i * 2654435761 >>> 0).toString(36).padStart(14, "0")}`);
  const a = C.bundleBuckets(ids), b = C.bundleBuckets(ids.slice(1).concat("dnewchunk0000000"));
  const nb = Math.ceil(200 / C.BUNDLE_PER.d);
  assert.equal(a.size, nb);
  assert.equal([...a.values()].reduce((s, l) => s + l.length, 0), 200);
  let changed = 0; for ( const [k, l] of a ) if ( JSON.stringify(b.get(k)) !== JSON.stringify(l) ) changed++;
  assert.ok(changed <= 2, `one removed + one added chunk touch at most two bundles (${changed})`);
  assert.deepEqual([...C.bundleBuckets(["wa", "wb", "k1", "x1", "zzz", "d1"]).keys()].sort(), ["d0", "k0", "w0"], "x rides with k; unknown kinds are not bundled");
  assert.deepEqual(C.bundleBuckets([]).size, 0);
});

await test("large bundles: strokes of ~180 kB pack into files of about the cap, a changed one touches few bundles", () => {
  const sizes = new Map(Array.from({ length: 143 }, (_, i) => [`d${(i * 2654435761 >>> 0).toString(36).padStart(14, "0")}`, 120000 + (i * 7919) % 120000]));
  const a = C.largeBuckets(sizes, 655360), total = [...sizes.values()].reduce((x, y) => x + y, 0);
  assert.equal(a.size, Math.ceil(total / 655360));
  assert.equal([...a.values()].reduce((x, l) => x + l.length, 0), 143);
  assert.ok(a.size < 45, `143 strokes in ${a.size} files`);
  const b = new Map(sizes); b.delete([...sizes.keys()][0]); b.set("dnewchunk0000000", 150000);
  let changed = 0; const bb = C.largeBuckets(b, 655360); for ( const [k, l] of a ) if ( JSON.stringify(bb.get(k)) !== JSON.stringify(l) ) changed++;
  assert.ok(changed <= 2 || bb.size !== a.size, `one removed + one added chunk touch at most two bundles (${changed})`);
  assert.equal(C.largeBuckets(new Map()).size, 0);
});

await test("cull in the worker job: the same texels cleared as cull() on the page, tiles named by their culled content", async () => {
  const tile = (L, x, y, w, h, fill) => { const data = new Uint8Array(w * h * 4); for ( let i = 0; i < w * h; i++ ) data.set(fill(i % w, (i / w) | 0), i * 4); return { L, x, y, w, h, res: 1, data }; };
  const mk = () => [tile(0, 0, 0, 40, 40, () => [9, 9, 9, 255]), tile(2, 0, 0, 40, 40, () => [7, 7, 7, 255]), tile(1, 5, 5, 20, 20, (x) => [x, 1, 1, x ? 255 : 0])];
  const a = mk(), b = mk();
  const cleared = C.cull(a.map((q) => ({ ...q, fresh: true })));
  // (one fresh tile, two only hiding: the middle and top bands as they are in the composite already)
  const fresh = [b[0]], hide = [b[1], b[2]];
  const r = (await C.work({ kind: "tiles", tiles: fresh, hide, cull: true, index: { v: 1 }, known: [] })).result;
  assert.ok(r.cleared > 0 && r.cleared <= cleared);
  const direct = a[0].data;
  assert.equal(r.cleared, (() => { let n = 0; for ( let i = 3; i < direct.length; i += 4 ) if ( !direct[i] ) n++; return n; })(), "the worker cleared exactly the texels the page's cull clears");
  const id = `k${C.hash64(C.packTile(a[0]))}`;
  assert.equal(r.tiles[0].id, id, "the tile is named by its content after the cull");
  const none = (await C.work({ kind: "tiles", tiles: [mk()[0]], hide: [], cull: false, index: { v: 1 }, known: [] })).result;
  assert.equal(none.cleared, -1);
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
