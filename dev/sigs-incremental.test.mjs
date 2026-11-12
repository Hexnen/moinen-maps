// node dev/sigs-incremental.test.mjs [-v]
// substrate.mjs fullSigsFrom (the strokes' full signatures from an earlier result) gives EXACTLY what fullSigs gives, on the user's scene
// "map" (dev/fixtures/destruction-flags/main-map-156.json): strokes painted on top, strokes undone (first, middle, last), a stroke re-caused,
// strokes reordered, a key twice, no earlier result. And it tests only what it must: a stroke painted on top tests that stroke alone.
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
const key = (o) => `${o.id},${o.k},${o.t},${o.x0},${o.y0},${o.w},${o.h},${o.m},${o.c}`;
const own = (o) => key(o);
const full = (list) => Sub.fullSigs(list, own, P, K);
const same = (a, b) => a.length === b.length && a.every((q, i) => q.own === b[i].own && q.sig === b[i].sig && q.deps.join(",") === b[i].deps.join(","));
const from = (prevList, list) => {
  const prev = { keys: prevList.map(key), out: full(prevList) }, fresh = {};
  const got = Sub.fullSigsFrom(prev, list.map(key), list, own, P, K, undefined, fresh);
  return { got, fresh: fresh.n, pairs: fresh.pairs ?? 0, want: full(list) };
};
const check = (name, prevList, list, maxFresh = Infinity) => {
  const r = from(prevList, list);
  ok(same(r.got, r.want), `${name}: same signatures as the full test (${r.fresh} of ${list.length} strokes, ${r.pairs} pairs tested)`);
  if ( Number.isFinite(maxFresh) ) ok(r.fresh <= maxFresh, `${name}: tests at most ${maxFresh} stroke(s) (${r.fresh})`);
};
const n = all.length;
check("the same strokes", all, all, 0);
check("one stroke painted on top", all.slice(0, n - 1), all, 1);
check("ten strokes painted on top", all.slice(0, n - 10), all, 10);
check("the newest stroke undone", all, all.slice(0, n - 1), 0);
check("the first stroke undone", all, all.slice(1), 0);
check("a middle stroke undone", all, all.filter((o, i) => i !== 70), 0);
check("several strokes undone", all, all.filter((o, i) => i % 7 !== 3), 0);
check("a middle stroke re-caused", all, all.map((o, i) => i === 60 ? { ...o, c: 5 } : o));
{ const r = from(all, all.map((o, i) => i === 60 ? { ...o, c: 5 } : o)); ok(r.pairs <= 60 + (n - 61), `a middle stroke re-caused: tests itself against the older strokes and each newer stroke against it only (${r.pairs} pairs; the full test ${n * (n - 1) / 2})`); }
check("an undo plus a new stroke on top", all.slice(0, n - 1), [...all.slice(0, n - 1).filter((o, i) => i !== 40), all[n - 1]], 1);
const sw = [...all]; [sw[30], sw[90]] = [sw[90], sw[30]];
check("two strokes swapped in the order", all, sw);
check("a stroke moved to the top", all, [...all.filter((o, i) => i !== 20), all[20]]);
// (a key twice and no earlier result: the full test)
{ const fresh = {}; const got = Sub.fullSigsFrom(null, all.map(key), all, own, P, K, undefined, fresh); ok(same(got, full(all)) && fresh.n === n, "no earlier result: the full test"); }
{ const dup = [...all, all[5]], fresh = {}; const got = Sub.fullSigsFrom({ keys: all.map(key), out: full(all) }, dup.map(key), dup, own, P, K, undefined, fresh); ok(same(got, full(dup)) && fresh.n === dup.length, "a key twice: the full test"); }
// random edits against a chain of earlier results (each result feeds the next)
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
let cur = all.slice(0, 100), prev = { keys: cur.map(key), out: full(cur) }, bad = 0, steps = 0;
for ( let s = 0; s < 40; s++ ) {
  const r = rnd();
  let next;
  if ( r < 0.5 ) next = [...cur, all[100 + Math.floor(rnd() * (n - 100))]].filter((o, i, a) => a.findIndex((q) => q.id === o.id) === i);
  else if ( r < 0.8 ) next = cur.filter((o, i) => i !== Math.floor(rnd() * cur.length));
  else { const i = Math.floor(rnd() * cur.length); next = cur.map((o, k) => k === i ? { ...o, c: (o.c + 1) % 9 } : o); }
  const got = Sub.fullSigsFrom(prev, next.map(key), next, own, P, K);
  if ( !same(got, full(next)) ) bad++;
  steps++; cur = next; prev = { keys: next.map(key), out: got };
}
ok(!bad, `${steps} random edits (paint, undo, re-cause), each from the result before: every one the same as the full test`);
console.log(fails ? `FAILED ${fails}` : "PASS");
process.exit(fails ? 1 : 0);
