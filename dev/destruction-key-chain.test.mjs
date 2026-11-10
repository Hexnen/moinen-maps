// node dev/destruction-key-chain.test.mjs [-v]
// PERF (ultra test 1): store.mjs makeKey hashes the strokes as a chain (keyChainFnv), keeping the state after each stroke, so a list that
// grew hashes only its new strokes. It must give exactly the one-shot fnv of the joined strings: checked through the module against a
// fresh copy of it (no chain state), and the chain formula against the one-shot hash.
import fs from "node:fs";
globalThis.Hooks ??= { on() {}, once() {}, callAll() {} };
globalThis.foundry ??= { utils: { deepClone: (v) => structuredClone(v) } };
globalThis.game ??= {};
const V = process.argv.includes("-v");
let fails = 0;
const ok = (c, m) => { if ( !c || V ) console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };
const j = JSON.parse(fs.readFileSync(new URL("./fixtures/destruction-flags/main-map-156.json", import.meta.url), "utf8"));
const all = Object.values(j.destructionObjects).sort((a, b) => a.s - b.s);
const fnv = (a, h = 2166136261) => { for ( let i = 0; i < a.length; i++ ) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
const enc = (s) => new TextEncoder().encode(s);
const chain = (strs) => { let h = 2166136261 | 0; strs.forEach((s, i) => { if ( i ) h = fnv(enc(";"), h) | 0; h = fnv(enc(s), h) | 0; }); return h >>> 0; };
const strs = all.map((o) => `${o.id},${o.m}`);
ok(chain(strs) === fnv(enc(strs.join(";"))), "chained fnv = one-shot fnv of the joined strings");
ok(chain([]) === fnv(enc("")), "no strokes: the same");
const Store = await import(new URL("../scripts/destruction/store.mjs", import.meta.url).href);
const scene = { id: "sc1", width: 4000, height: 3000 }, P = j.destruction.params;
const st = (objects) => ({ ap: 3, mw: 500, mh: 400, seed: 7, params: { ...P }, objects });
const recause = all.map((o, i) => (i === 70 ? { ...o, c: ((o.c | 0) + 1) % 10 } : o));
for ( const [name, objs] of [["100", all.slice(0, 100)], ["101 (grew)", all.slice(0, 101)], ["60 (undone)", all.slice(0, 60)], ["156 re-caused in the middle", recause], ["156", all], ["0", []]] ) {
  const M = await import(new URL(`../scripts/destruction/store.mjs?fresh=${Math.random()}`, import.meta.url).href);
  ok(Store.makeKey(scene, st(objs), "bg") === M.makeKey(scene, st(objs), "bg"), `makeKey chained across calls = a fresh module's (${name})`);
}
console.log(fails ? `FAILED ${fails}` : "ok   destruction-key-chain");
process.exit(fails ? 1 : 0);
