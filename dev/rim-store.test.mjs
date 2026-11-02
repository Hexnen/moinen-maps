// node dev/rim-store.test.mjs: the dark rims kept beside the composite (destruction/rim-store.mjs, chunks.mjs kind 6):
//   1. the chunk round trip (rims, areas without a rim), content-addressed ("r" ids), through the worker jobs "rimpack" / "decode";
//   2. what a publish does (plan): first filing, nothing new = "same", a new area = one more chunk, a gone area drops its chunk, all areas
//      known at once consolidate, another folder starts afresh;
//   3. older clients: the composite's manifest is read as before with the new flag next to it (a flag of its own, never part of the
//      composite's manifest), the GC's record finds the rim chunks, and a flag of another version or shape is ignored.
globalThis.Hooks ??= { on() {}, once() {}, off() {}, callAll() {}, call() {} };
const C = await import("../scripts/net/chunks.mjs");
const R = await import("../scripts/destruction/rim-store.mjs");
const Comp = await import("../scripts/destruction/composite.mjs");
const Pub = await import("../scripts/water/publish.mjs");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if ( !c ) fails++; };
const A8 = (n, s) => Uint8Array.from({ length: n }, (_, i) => (i * s) % 251);
const rim = (hash, type = "blast", cause = 1) => ({ hash, cause, type, col: [182.5, 190.25, 204], LW: 7, LH: 5, ox: -12, oy: 340, A8: A8(35, hash % 7 + 1) });
{
  const rims = [rim(900, "gash", 3), rim(5, "blast", 0), rim(4100000123, "collapse", 9)], none = [77, 12, 77];
  const p = C.packRims(rims, none), q = C.packRims([...rims].reverse(), [12, 77]);
  ok(p.length === q.length && p.every((v, i) => v === q[i]), "the same rims make the same payload, whatever the order");
  const back = C.unpackRims(p);
  ok(back.rims.length === 3 && back.none.join() === "12,77" && back.rims[0].hash === 5, "sorted by hash; the areas without a rim listed once");
  const r = back.rims.find((x) => x.hash === 4100000123);
  ok(r.type === "collapse" && r.cause === 9 && r.LW === 7 && r.LH === 5 && r.ox === -12 && r.oy === 340 && r.col[0] === 182.5 && r.col[1] === 190.25 && r.A8.every((v, i) => v === rim(4100000123).A8[i]), "a rim comes back as it went in (colour float32-exact, place, strengths)");
  const job = await C.work({ kind: "rimpack", rims, none });
  ok(/^r[0-9a-z]+$/.test(job.result.id) && job.result.id === `r${C.hash64(p)}`, "the worker job names it by its payload's hash");
  const dec = await C.work({ kind: "decode", bytes: job.result.bytes, cid: job.result.id });
  ok(dec.result.rims.length === 3 && dec.result.none.length === 2 && dec.transfer.length === 3, "decoded in the worker: the rims' buffers are transferred");
  let bad = false; try { await C.work({ kind: "decode", bytes: job.result.bytes, cid: "r0000" }); } catch { bad = true; }
  ok(bad, "a chunk that does not match its name is refused");
  const cut = p.slice(0, p.length - 3); let thrown = false; try { C.unpackRims(cut); } catch { thrown = true; }
  ok(thrown, "a damaged payload is refused");
}
{
  const dir = "worlds/w/moinen-maps/c/S";
  const L = (hs) => new Map(hs.map((h) => [h, rim(h)]));
  const P1 = R.plan({ live: L([1, 2, 3]), none: [4], current: new Set([1, 2, 3, 4, 5]), old: null, dir });
  ok(P1.add && P1.add.hashes.join() === "1,2,3" && P1.add.none.join() === "4" && !P1.same && P1.ids.length === 0, "first filing: one chunk of what is known");
  const man = (ids, h) => ({ v: 2, rv: 1, dir, t: ids, h });
  const old1 = man(["rA"], { rA: [1, 2, 3, 4] });
  const P2 = R.plan({ live: L([1, 2, 3]), none: [4], current: new Set([1, 2, 3, 4, 5]), old: old1, dir });
  ok(P2.add === null && P2.same && P2.ids.join() === "rA", "nothing new: the same manifest");
  const P3 = R.plan({ live: L([1, 2, 3, 5]), none: [4], current: new Set([1, 2, 3, 4, 5]), old: old1, dir });
  ok(P3.add && P3.add.hashes.join() === "5" && P3.ids.join() === "rA" && !P3.same, "a new area: one more chunk, the old one kept");
  const old2 = man(["rA", "rB"], { rA: [1, 2, 3, 4], rB: [5] });
  const P4 = R.plan({ live: L([1, 2, 3, 5]), none: [4], current: new Set([1, 2, 3, 4, 5]), old: old2, dir });
  ok(P4.add && P4.add.hashes.join() === "1,2,3,5" && P4.ids.length === 0, "every area known at once: one chunk replaces the chunks");
  const P5 = R.plan({ live: L([]), none: [], current: new Set([5, 6]), old: man(["rA"], { rA: [1, 2, 3, 4] }), dir });
  ok(P5.ids.length === 0 && P5.add === null && P5.empty, "areas gone: a chunk of none of the areas on screen is dropped");
  const P6 = R.plan({ live: L([5]), none: [], current: new Set([5]), old: { ...old1, dir: "other" }, dir });
  ok(P6.add?.hashes.join() === "5" && P6.ids.length === 0, "a manifest of another folder is not built on");
  const P7 = R.plan({ live: L([1]), none: [], current: new Set([1, 2]), old: old2, dir });
  ok(P7.add === null && P7.ids.join() === "rA" && !P7.same, "a chunk of areas gone drops out while the rest stays (no new chunk: the manifest changes)");
}
{
  const dir = "worlds/w/moinen-maps/c/S", rimsFlag = { v: 2, rv: 1, dir, t: ["rA", "rB"], h: { rA: [1], rB: [2] } };
  const comp = { v: 2, tv: Comp.TILE_VERSION, dir, base: "b", idx: "x1", t: ["x1", "k1"], bands: [], at: 1 };
  const scene = { flags: { "moinen-maps": { destructionComposite: comp, destructionRims: rimsFlag } } };
  ok(Comp.manifestOf(scene) === comp && R.manifestOf(scene) === rimsFlag, "the composite's manifest is the same with the rims' flag beside it; the flag is read on its own");
  ok(!comp.rb && !("rims" in comp) && Object.keys(comp).join() === "v,tv,dir,base,idx,t,bands,at", "nothing about rims is in the composite's manifest");
  const recs = Pub.chunkRecords(scene);
  ok(recs.some((r) => r.ids.includes("rA") && r.ids.includes("rB")) && recs.some((r) => r.ids.includes("k1")), "the GC's record names the rim chunks (an older client's GC too: any { v: 2, dir, t })");
  for ( const bad of [{ ...rimsFlag, rv: 2 }, { ...rimsFlag, v: 1 }, { ...rimsFlag, h: null }, { ...rimsFlag, t: "x" }, null] ) ok(R.manifestOf({ flags: { "moinen-maps": { destructionRims: bad } } }) === null, `a flag of another version or shape is ignored (${JSON.stringify(bad)?.slice(0, 40)})`);
  ok(R.manifestOf({ flags: { "moinen-maps": { destructionComposite: comp } } }) === null && R.idsOf({ flags: {} }).length === 0, "an old scene (no flag): no rims, rim-job lights it as before");
}
if ( fails ) { console.log(`${fails} FAILED`); process.exit(1); }
console.log("PASS");
