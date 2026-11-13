/**
 * A composite that is missing a chunk, or whose chunk is damaged, must degrade gracefully (round 2): Composite.load answers null (the
 * destruction then loads the scene from the strokes' own chunks, as it did before there was a composite) and never throws, hangs or
 * half-builds; a bundle that is missing or damaged only costs the requests it saved (every member is read from its own file instead).
 * With minimal Foundry / PIXI stubs and a fake server. Run: node dev/composite-missing.test.mjs
 */
import assert from "node:assert/strict";
import * as C from "../scripts/net/chunks.mjs";

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("ok  ", name); } catch ( err ) { console.error("FAIL", name, err); process.exitCode = 1; } };

/* ---------------------------------------------------------------- stubs: a server of files, the bits of Foundry / PIXI the loaders touch */

const server = new Map();                 // "dir/id.png" -> bytes
const asked = [];                         // every request, in order
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {}, call() {} };
globalThis.foundry = { utils: { getRoute: (p) => p } };
globalThis.game = { world: { id: "w" }, user: { isGM: false }, users: { activeGM: null }, scenes: [], settings: { get: () => true } };
globalThis.CONFIG = {};
globalThis.fetch = async (url) => {
  const p = String(url).split("?")[0]; asked.push(p);
  return server.has(p) ? new Response(server.get(p), { status: 200 }) : new Response("", { status: 404 });
};
globalThis.PIXI = {
  SCALE_MODES: { LINEAR: 1, NEAREST: 0 }, MIPMAP_MODES: { ON: 1 }, ALPHA_MODES: { PMA: 2 }, FORMATS: { RGBA: 6408 }, TYPES: { UNSIGNED_BYTE: 5121 }, WRAP_MODES: { CLAMP: 33071 },
  BufferResource: class { constructor(data) { this.data = data; } },
  BaseTexture: class { constructor(resource, o) { this.resource = resource; Object.assign(this, o); this.realWidth = o.width; this.realHeight = o.height; } destroy() { this.destroyed = true; } },
  Texture: class { constructor(b) { this.baseTexture = b; } destroy() { this.baseTexture.destroy(); } },
  Container: class { removeChildren() { return []; } destroy() {} }
};

const Net = await import("../scripts/net/stream.mjs");
const Comp = await import("../scripts/destruction/composite.mjs");
const Trace = await import("../scripts/net/trace.mjs");
const DIR = "worlds/w/moinen-maps/c/S";
const warned = []; console.warn = (...a) => { warned.push(a.join(" ")); };      // (the loaders warn about what they could not use: kept, not printed)

/** A chunk file on the fake server; returns its id. */
async function serve(payload, kind, { as = null } = {}) {
  const id = `${kind}${C.hash64(payload)}`, bytes = await C.wrap(payload);
  server.set(`${DIR}/${as ?? id}.png`, bytes);
  return id;
}
const tilePayload = (seed) => C.packTile({ x: seed, y: 0, w: 4, h: 4, res: 1, data: Uint8Array.from({ length: 64 }, (_, i) => ((i * 7 + seed) & 3 ? 200 : 0)) });
const TOMB = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

/** A composite manifest of `n` one-tile bands whose files are on the server (the files listed in `omit` are not, `tomb` hold a GC tombstone). */
async function composite(seed, n, { omit = [], tomb = [], noIndex = false } = {}) {
  const ids = [];
  for ( let i = 0; i < n; i++ ) ids.push(await serve(tilePayload(seed * 100 + i), "k"));
  const ip = C.packIndex({ v: 1, base: "b", areas: {}, strokes: {}, bands: ids.map((_, i) => ({ key: `band${seed}-${i}`, hashes: [i] })) });
  const idx = await serve(ip, "x");
  for ( const i of omit ) server.delete(`${DIR}/${ids[i]}.png`);
  for ( const i of tomb ) server.set(`${DIR}/${ids[i]}.png`, TOMB);
  if ( noIndex ) server.delete(`${DIR}/${idx}.png`);
  return { v: 2, tv: Comp.TILE_VERSION, dir: DIR, base: "b", idx, t: [idx, ...ids], at: 1,
    bands: ids.map((id, i) => ({ key: `band${seed}-${i}`, L: i, eff: 1, smp: 1, mips: 0, rect: [i, 0, i + 4, 4], tiles: [[i, 0, 4, 4, id]] })) };
}

const events = () => Trace.report().events.map((e) => e.reason);

/* ---------------------------------------------------------------- composites with a missing or damaged chunk */

await test("a composite whose files are all there loads (the control)", async () => {
  const m = await composite(1, 3);
  const c = await Comp.load(m);
  assert.ok(c, "loaded");
  assert.equal(c.list.length, 3);
  assert.equal(c.bands.get("band1-1").tiles[0].tex.baseTexture.realWidth, 4);
  c.destroy();
});

await test("a missing tile (404): load answers null, once, without throwing; the other tiles' downloads are not left hanging", async () => {
  const m = await composite(2, 4, { omit: [2] });
  const before = events().filter((e) => e === "composite-unusable").length;
  const c = await Promise.race([Comp.load(m), new Promise((r) => setTimeout(() => r("hung"), 4000))]);
  assert.equal(c, null);
  assert.equal(events().filter((e) => e === "composite-unusable").length, before + 1, "reported once");
  assert.equal(Net.debug().inflight, 0, "no request left in flight");
});

await test("a missing index: null as well", async () => {
  const m = await composite(3, 2, { noIndex: true });
  assert.equal(await Comp.load(m), null);
});

await test("a tile the GC emptied (tombstone in its place): null, not a half-built composite", async () => {
  const m = await composite(4, 3, { tomb: [0] });
  assert.equal(await Comp.load(m), null);
});

await test("a tile whose file holds another chunk's content (wrong name): refused by its hash, null", async () => {
  const m = await composite(5, 3);
  const other = tilePayload(99999), wrong = m.bands[1].tiles[0][4];
  server.set(`${DIR}/${wrong}.png`, await C.wrap(other));
  assert.equal(await Comp.load(m), null);
});

await test("the next try after the file is back succeeds (nothing is remembered as bad for ever)", async () => {
  const m = await composite(6, 3, { omit: [1] });
  assert.equal(await Comp.load(m), null);
  const id = m.bands[1].tiles[0][4];
  server.set(`${DIR}/${id}.png`, await C.wrap(tilePayload(600 + 1)));
  const c = await Comp.load(m);
  assert.ok(c && c.list.length === 3, "loads once the file exists");
  c?.destroy();
});

await test("the manifest of a composite with a damaged shape is not a manifest", () => {
  const m = { v: 2, tv: Comp.TILE_VERSION, dir: DIR, idx: "x1", t: ["x1"], bands: [] };
  const scene = (c) => ({ flags: { "moinen-maps": { destructionComposite: c } } });
  assert.ok(Comp.manifestOf(scene(m)));
  for ( const bad of [{ ...m, t: null }, { ...m, idx: 5 }, { ...m, bands: "x" }, { ...m, tv: 1 }, { ...m, dir: null }, null] ) assert.equal(Comp.manifestOf(scene(bad)), null);
});

/* ---------------------------------------------------------------- U232: a stale composite is judged by its index, tiles never fetched */

await test("U232 indexStale: a stroke gone, a changed signature, another chunk; a fitting index and an unbaked stroke are not stale", () => {
  const index = { strokes: { a: { sig: "s1", cid: "d1", hashes: [] }, b: { sig: "s2", hashes: [] } } };
  const M = { a: { sig: "s1", id: "d1" }, b: { sig: "s2", id: "d2" } };
  const entry = (m) => (id) => m[id] ?? null, all = () => true;
  assert.equal(Comp.indexStale(index, entry(M), all), null);
  assert.deepEqual(Comp.indexStale(index, entry(M), (id) => id !== "b"), { stroke: "b", why: "gone" });
  assert.deepEqual(Comp.indexStale(index, entry({ ...M, a: { sig: "s9", id: "d1" } }), all), { stroke: "a", why: "signature" });
  assert.deepEqual(Comp.indexStale(index, entry({ ...M, a: { sig: "s1", id: "d7" } }), all), { stroke: "a", why: "chunk" });
  assert.equal(Comp.indexStale(index, entry({ a: M.a }), all), null, "b not baked yet (no entry, no cid): the loader decides");
  assert.equal(Comp.indexStale(null, entry(M), all), null);
});

await test("U232 load(m, check): a stale index answers null after ONE small request; no tile is downloaded or decoded", async () => {
  const ids = [await serve(tilePayload(7001), "k"), await serve(tilePayload(7002), "k")];
  const idx = await serve(C.packIndex({ v: 1, base: "b", areas: {}, strokes: { gone1: { sig: "s", hashes: [0] } }, bands: ids.map((_, i) => ({ key: `u232-${i}`, hashes: [i] })) }), "x");
  const m = { v: 2, tv: Comp.TILE_VERSION, dir: DIR, base: "b", idx, t: [idx, ...ids], at: 1,
    bands: ids.map((id, i) => ({ key: `u232-${i}`, L: i, eff: 1, smp: 1, mips: 0, rect: [i, 0, i + 4, 4], tiles: [[i, 0, 4, 4, id]] })) };
  const n0 = asked.length;
  let seen = null;
  const c = await Comp.load(m, (ix) => { seen = ix; return Comp.indexStale(ix, () => null, () => false); });
  assert.equal(c, null);
  assert.ok(seen?.strokes?.gone1, "the check got the decoded index");
  const got = asked.slice(n0);
  assert.deepEqual(got, [`${DIR}/${idx}.png`], `only the index was asked for, got ${JSON.stringify(got)}`);
  // the same composite with a check that passes loads whole (the index from memory, the tiles now)
  const ok = await Comp.load(m, () => null);
  assert.ok(ok && ok.list.length === 2, "a fitting index: the tiles follow");
  assert.ok(asked.slice(n0).includes(`${DIR}/${ids[0]}.png`) && !asked.slice(n0 + 1).includes(`${DIR}/${idx}.png`), "tiles fetched, the index not again");
  ok.destroy();
});

await test("U232 readAhead: a stale composite is not read ahead (its index only); the strokes' own chunks are", async () => {
  const Pre = await import("../scripts/net/preload.mjs");
  const ids = [await serve(tilePayload(7101), "k"), await serve(tilePayload(7102), "k")];
  const idx = await serve(C.packIndex({ v: 1, base: "b", areas: {}, strokes: { old: { sig: "s1", hashes: [0] } }, bands: ids.map((_, i) => ({ key: `ra-${i}`, hashes: [i] })) }), "x");
  const comp = { v: 2, tv: Comp.TILE_VERSION, dir: DIR, base: "b", idx, t: [idx, ...ids], at: 1,
    bands: ids.map((id, i) => ({ key: `ra-${i}`, L: i, eff: 1, smp: 1, mips: 0, rect: [i, 0, i + 4, 4], tiles: [[i, 0, 4, 4, id]] })) };
  const stroke = "d0123456789abcd";
  const scene = (strokes) => ({ id: "S", width: 100, height: 100, flags: { "moinen-maps": {
    destruction: { ap: 1, baked: { v: 2, base: "b", dir: DIR, c: Object.fromEntries(strokes.map((s) => [s, `s1:${stroke}:55`])) } },
    destructionObjects: Object.fromEntries(strokes.map((s) => [s, { t: 0, x0: 1, y0: 1, w: 2, h: 2 }])),
    destructionComposite: comp } } });
  let n0 = asked.length;
  await Pre.readAhead(scene(["fresh"]));
  let got = asked.slice(n0);
  assert.ok(got.includes(`${DIR}/${idx}.png`) && got.includes(`${DIR}/${stroke}.png`), `index then the stroke's chunk: ${JSON.stringify(got)}`);
  assert.ok(!ids.some((id) => got.includes(`${DIR}/${id}.png`)), `no tile of the stale composite: ${JSON.stringify(got)}`);
  // the control: a composite whose strokes are all there is read ahead whole (its tiles), the strokes' own chunks not
  n0 = asked.length;
  await Pre.readAhead(scene(["old"]));
  got = asked.slice(n0);
  assert.ok(ids.every((id) => got.includes(`${DIR}/${id}.png`)), `a fitting composite: its tiles: ${JSON.stringify(got)}`);
});

/* ---------------------------------------------------------------- bundles that are missing or damaged */

async function smallChunks(seed, n) {
  const out = [];
  for ( let i = 0; i < n; i++ ) {
    const box = { x0: 0, y0: 0, w: 8, h: 8 }, frames = [new Uint8Array(64).fill(1 + ((seed * 10 + i) % 200)), new Uint8Array(64).fill(2)];
    const p = C.packWaterTile(frames, box, { x0: 0, y0: 0, w: 8, h: 8 }), id = await serve(p, "w");
    out.push({ id, bytes: server.get(`${DIR}/${id}.png`) });
  }
  return out;
}
async function bundleOf(members, { drop = true } = {}) {
  const res = (await C.work({ kind: "bundle", members })).result;
  server.set(`${DIR}/${res.id}.png`, res.bytes);
  if ( !drop ) return res;
  return res;
}
const fresh = () => { Net.resetStats(); asked.length = 0; };

await test("bundle: ten chunks, ONE request; the chunks decode exactly as their single files do", async () => {
  const ms = await smallChunks(1, 10), b = await bundleOf(ms);
  Net.setBundles("S", { dir: DIR, b: [[b.id, b.ids]] });
  fresh();
  const got = await Promise.all(ms.map((m) => Net.getChunk(DIR, m.id)));
  assert.equal(Net.stats.requests, 1, "one download for the ten chunks");
  assert.deepEqual(asked, [`${DIR}/${b.id}.png`]);
  got.forEach((g, i) => { assert.equal(g.w, 8); assert.equal(g.n, 2); assert.equal(g.levels[1][0], 2, `chunk ${i}`); });
  // (and again: from memory, no request)
  assert.ok(await Net.getChunk(DIR, ms[3].id));
  assert.equal(Net.stats.requests, 1);
});

await test("bundle missing on the server (404): every chunk is read from its own file, nothing fails", async () => {
  const ms = await smallChunks(2, 6), b = await bundleOf(ms);
  server.delete(`${DIR}/${b.id}.png`);
  Net.setBundles("S", { dir: DIR, b: [[b.id, b.ids]] });
  fresh();
  const got = await Promise.all(ms.map((m) => Net.getChunk(DIR, m.id)));
  assert.ok(got.every((g) => g?.levels), "all six decoded");
  assert.equal(Net.stats.failed, 0);
  assert.equal(Net.stats.requests, 1 + 6, "the missing bundle (once) and the six single files");
});

await test("bundle emptied by the GC (tombstone): the same", async () => {
  const ms = await smallChunks(3, 4), b = await bundleOf(ms);
  server.set(`${DIR}/${b.id}.png`, TOMB);
  Net.setBundles("S", { dir: DIR, b: [[b.id, b.ids]] });
  fresh();
  const got = await Promise.all(ms.map((m) => Net.getChunk(DIR, m.id)));
  assert.ok(got.every((g) => g?.levels));
  assert.equal(Net.stats.failed, 0);
});

await test("bundle with a damaged member: that member comes from its own file, the others from the bundle", async () => {
  const ms = await smallChunks(4, 5);
  // a bundle whose last member's payload was altered after it was named (a bit flip): rebuilt by hand
  const parts = [];
  for ( const m of ms ) parts.push({ id: m.id, payload: await C.unwrap(m.bytes) });
  parts.sort((a, b) => (a.id < b.id ? -1 : 1));
  const bad = parts.at(-1).payload.slice(); bad[bad.length - 1] ^= 0x55; parts.at(-1).payload = bad;
  const bp = C.packBundle(parts), bid = `b${C.hash64(bp)}`;
  server.set(`${DIR}/${bid}.png`, await C.wrap(bp));
  Net.setBundles("S", { dir: DIR, b: [[bid, parts.map((q) => q.id)]] });
  fresh();
  const got = await Promise.all(ms.map((m) => Net.getChunk(DIR, m.id)));
  assert.ok(got.every((g) => g?.levels), "all five decoded");
  assert.equal(Net.stats.failed, 0);
  assert.equal(Net.stats.requests, 1 + 1, "the bundle and the one damaged member's own file");
});

await test("no bundles registered (a scene from before, or the flag gone): single files, as ever", async () => {
  const ms = await smallChunks(5, 3);
  Net.setBundles("S", null);
  fresh();
  await Promise.all(ms.map((m) => Net.getChunk(DIR, m.id)));
  assert.equal(Net.stats.requests, 3);
});

console.log(`(${warned.length} warnings about unusable chunks, as expected)`);
console.log(`${passed} passed${process.exitCode ? ", SOME FAILED" : ""}`);
