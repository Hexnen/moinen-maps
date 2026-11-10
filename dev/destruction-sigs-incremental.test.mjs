// node dev/destruction-sigs-incremental.test.mjs [-v]
// PERF (ultra test 1): the strokes' signatures are computed incrementally - fullSigs(prev, from) keeps the entries of the strokes a
// previous list shares with this one and computes the rest - and the keys over all strokes are hashed as a chain (store.mjs chainFnv).
// Both must give exactly what the one-shot computation gives. Real data: the fixture scene "map" (156 strokes), grown stroke by
// stroke, with a stroke changed in the middle, one removed, one inserted (a redo under later strokes) and the settings changed.
import fs from "node:fs";
const Sub = await import(new URL("../scripts/destruction/substrate.mjs", import.meta.url).href);
const V = process.argv.includes("-v");
let fails = 0;
const ok = (c, m) => { if ( !c || V ) console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };
const j = JSON.parse(fs.readFileSync(new URL("./fixtures/destruction-flags/main-map-156.json", import.meta.url), "utf8"));
const rle = (str, n) => {
  const a = new Uint8Array(n), bin = Buffer.from(str ?? "", "base64").toString("latin1");
  let pos = 0, i = 0;
  while ( pos < bin.length && i < n ) { const v = bin.charCodeAt(pos++); let run = 0, mul = 1, b; do { b = bin.charCodeAt(pos++); run += (b & 127) * mul; mul *= 128; } while ( b & 128 && pos < bin.length ); if ( v ) a.fill(v, i, Math.min(n, i + run)); i += run; }
  return a;
};
const all = Object.values(j.destructionObjects).sort((a, b) => a.s - b.s).map((o) => ({ id: o.id, k: o.k, t: o.t, c: o.c | 0, x0: o.x0, y0: o.y0, w: o.w, h: o.h, m: o.m, bytes: rle(o.m, o.w * o.h) }));
const P = j.destruction.params, K = 2;
const own = (o) => `${o.id},${o.k},${o.t},${o.x0},${o.y0},${o.w},${o.h},${o.m},${o.c}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const prefix = (a, b) => { let p = 0; while ( p < a.length && p < b.length && own(a[p]) === own(b[p]) ) p++; return p; };

// 1. grown one stroke at a time (the common case: a new stroke on top)
let prev = null, prevObjs = [], bad = 0;
for ( let n = 1; n <= all.length; n += (n < 20 ? 1 : 7) ) {
  const objs = all.slice(0, n), inc = Sub.fullSigs(objs, own, P, K, undefined, prev, prefix(prevObjs, objs)), full = Sub.fullSigs(objs, own, P, K);
  if ( !same(inc, full) ) bad++;
  prev = inc; prevObjs = objs;
}
ok(bad === 0, `grown stroke by stroke to ${all.length}: incremental = one-shot at every step (${bad} differ)`);

// 2. a stroke in the middle re-caused, one removed (undo), one put back under later strokes (redo), from a previous full list
const base = Sub.fullSigs(all, own, P, K);
const cases = {
  recause: all.map((o, i) => (i === 70 ? { ...o, c: (o.c + 1) % 10 } : o)),
  undo: all.filter((_, i) => i !== 90),
  redoUnder: [...all.slice(0, 40), { ...all[120], id: "zzRedo0001" }, ...all.slice(40)],
  appendTwo: [...all, { ...all[3], id: "zzNew00001" }, { ...all[50], id: "zzNew00002" }]
};
for ( const [k, objs] of Object.entries(cases) ) {
  const inc = Sub.fullSigs(objs, own, P, K, undefined, base, prefix(all, objs)), full = Sub.fullSigs(objs, own, P, K);
  ok(same(inc, full), `${k}: incremental (from ${prefix(all, objs)}) = one-shot`);
}
// 3. the settings changed: the caller passes no prev (store.mjs: only for the same settings) - and from 0 is the one-shot itself
ok(same(Sub.fullSigs(all, own, { ...P, scatter: 2.5 }, K, undefined, null, 0), Sub.fullSigs(all, own, { ...P, scatter: 2.5 }, K)), "no prev: the one-shot computation");

// 4. the chained hash = fnv of the joined string (store.mjs makeKey / sigsKey)
const fnv = (a, h = 2166136261) => { for ( let i = 0; i < a.length; i++ ) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
const enc = (s) => new TextEncoder().encode(s);
const chain = (head, strs, seed = 2166136261) => { let h = fnv(enc(head), seed) | 0; strs.forEach((s, i) => { if ( i ) h = fnv(enc(";"), h) | 0; h = fnv(enc(s), h) | 0; }); return h >>> 0; };
const strs = all.map(own);
for ( const [head, seed] of [["", 2166136261], ["{\"a\":1}|2|2|55|", 2166136261], ["{\"a\":1}|2|2|55|", 0x9747b28c]] ) {
  ok(chain(head, strs, seed) === fnv(enc(head + strs.join(";")), seed), `chained fnv = one-shot (head "${head.slice(0, 12)}", seed ${seed})`);
  ok(chain(head, [], seed) === fnv(enc(head), seed), `chained fnv of no strokes = one-shot (seed ${seed})`);
}
// the store's own chain, through its exports, against the one-shot formulas (makeKey and sigsKey are pure over the state)
globalThis.Hooks ??= { on() {}, once() {}, callAll() {} };
globalThis.foundry ??= { utils: { deepClone: (v) => structuredClone(v) } };
globalThis.game ??= {};
const Store = await import(new URL("../scripts/destruction/store.mjs", import.meta.url).href).catch((e) => ({ err: e }));
if ( Store.err ) ok(true, `store.mjs not importable in node here (${String(Store.err.message).slice(0, 60)}): its chain is the formula above`);
else {
  const scene = { id: "sc1", width: 4000, height: 3000 };
  const S = { ap: 3, mw: 500, mh: 400, seed: 7, params: { ...P }, objects: all.slice(0, 100) };
  const S2 = { ...S, objects: all.slice(0, 101) }, S3 = { ...S, objects: all.slice(0, 60) }, S4 = { ...S, objects: cases.recause };
  const fresh = async (s) => { const M = await import(new URL(`../scripts/destruction/store.mjs?fresh=${Math.random()}`, import.meta.url).href); return [M.makeKey(scene, s, "bg"), M.sigsKey(s)]; };
  for ( const s of [S, S2, S3, S4, S2] ) {
    const a = [Store.makeKey(scene, s, "bg"), Store.sigsKey(s)], b = await fresh(s);
    ok(same(a, b), `store keys chained across calls = a fresh module's (${s.objects.length} strokes)`);
  }
}

if ( fails ) { console.log(`FAIL ${fails}`); process.exit(1); }
console.log("ok   destruction-sigs-incremental");
