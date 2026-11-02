// node dev/stable-plain.test.mjs [-v]
// A Rebake all must give the SAME pixels (so the same chunk ids) whatever the batches it runs in. The strokes over a stroke are baked on
// its PLAIN look; a page that keeps the plain looks it has seen (destruction.mjs plainOf / take) must never take for one the FINAL record
// of a stroke that reads others: cut off wholly inside higher damage that record is EMPTY (no cover row to carry the over-a-substrate
// flag) - the strokes over it then read nothing there when baked in a later batch, and something else when baked in the same one. The
// strokes flapped between two chunks at every Rebake all until the breaker paused baking. Simulates the page's two waves (plain looks
// of what a batch reads, then the strokes over them) for random batches and orders, against one bake of everything.
const core = await import(new URL("../scripts/destruction/core.mjs", import.meta.url).href);
const Sub = await import(new URL("../scripts/destruction/substrate.mjs", import.meta.url).href);
const Policy = await import(new URL("../scripts/destruction/bake-policy.mjs", import.meta.url).href);
const F = core.META_FIELDS, K = 2, AW = 300, AH = 200, MW = AW / K;
const V = process.argv.includes("-v");
let fails = 0;
const ok = (cond, msg) => { if ( !cond || V ) console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if ( !cond ) fails++; };
const h2 = (x, y, s) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const map = new Uint8ClampedArray(AW * AH * 4);
for ( let y = 0; y < AH; y++ ) for ( let x = 0; x < AW; x++ ) { const n = h2(x, y, 3) * 24 - 12, c = x < AW / 2 ? [74 + n, 122 + n * 1.2, 52 + n * 0.6] : [128 + n, 124 + n, 118 + n]; map.set([c[0], c[1], c[2], 255], (y * AW + x) * 4); }
function disc(id, t, cx, cy, r, lv = 3, c = 0) {
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r)), x1 = Math.min(MW - 1, Math.ceil(cx + r)), y1 = Math.min(99, Math.ceil(cy + r));
  const w = x1 - x0 + 1, h = y1 - y0 + 1, bytes = new Uint8Array(w * h);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) if ( (x0 + x + 0.5 - cx) ** 2 + (y0 + y + 0.5 - cy) ** 2 <= r * r ) bytes[y * w + x] = lv;
  const path = t === 5 ? [[(cx - r * 0.85) * K, cy * K], [cx * K, (cy - r * 0.15) * K], [(cx + r * 0.85) * K, cy * K]] : undefined;
  return { id, k: 0, t, c, x0, y0, w, h, bytes, path };
}
const P0 = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", jagged: false, jag: 0.6, directional: false };
const MAP = { w: AW, h: AH, data: map };
const bake = (objects, under, plain = false) => core.bake({ objects, K, aw: AW, ah: AH, seed: 7, params: P0, map: MAP, mapKey: "stable", under, plain }, null);
/** Sprites per object index as the page keeps them (pixels in `img`, Chunks.splitSheet's format). */
function records(r) {
  const recs = new Map(); let cur = null;
  for ( let k = 0; k < r.count; k++ ) {
    const o = k * F, m = Int16Array.from(r.meta.subarray(o, o + F));
    if ( m[0] === 0 ) { cur = m[16]; if ( !recs.has(cur) ) recs.set(cur, []); }
    if ( cur === null ) continue;
    const w = m[3], h = m[4], img = new Uint8Array(w * h * 4);
    for ( let y = 0; y < h; y++ ) img.set(r.sheet.data.subarray(((m[2] + y) * r.sheet.w + m[1]) * 4, ((m[2] + y) * r.sheet.w + m[1] + w) * 4), y * w * 4);
    recs.get(cur).push({ m, w, h, img });
  }
  return recs;
}
/** A look's content (not where it sat in a sheet): the same hash whatever job it came out of. */
const hashOf = (list) => { let hh = 2166136261; for ( const s of list ?? [] ) { for ( const [i, v] of s.m.entries() ) if ( i !== 1 && i !== 2 && !(i === 11 && s.m[0] === 1) ) hh = Math.imul(hh ^ (v & 0xffff), 16777619); for ( const v of s.img ) hh = Math.imul(hh ^ v, 16777619); } return (hh >>> 0).toString(36); };
const overSubstrate = (sprites) => sprites.some((s) => s.m[0] === 2 && s.m[7] === 1);

// a crater with cracks wholly inside it (cut off: bake nothing), a tear over both, strokes over the tear, one far away
const objs = [
  disc("Z", 1, 60, 50, 14, 3), disc("Cr", 0, 56, 52, 13, 3, 2), disc("Ck", 4, 56, 52, 4, 1, 3), disc("T", 5, 60, 54, 11, 2, 1),
  disc("U", 0, 63, 56, 9, 2), disc("W", 1, 66, 52, 8, 3, 5), disc("X", 2, 120, 40, 8, 2), disc("Y", 0, 62, 50, 10, 3, 5)
];
const deps = Sub.depsOf(objs, P0, K);
const full = records(bake(objs));
const want = objs.map((o, i) => hashOf(full.get(i)));
ok(!full.has(2) || full.get(2).length === 0, `the cracks wholly inside the crater bake nothing (cut off): ${full.get(2)?.length ?? 0} sprites`);
ok(deps[3].includes(2) && deps[4].includes(2), `the strokes over them read the cut-off cracks (deps of T ${JSON.stringify(deps[3])}, of U ${JSON.stringify(deps[4])})`);
// the pitfall itself: handing the cut-off stroke's EMPTY final record in as its plain look changes what the strokes over it come out as
{
  const only = (i) => objs.map((o, j) => j === i ? o : { ...o, skip: 1 });
  const empty = records(bake(only(3), { 2: [] })).get(3), right = records(bake(only(3))).get(3);
  ok(hashOf(empty) !== hashOf(right), "T baked over an empty plain look of the cut-off cracks differs from T baked over their real plain look");
}

/** The page's Rebake all in batches: `canLend(i)` decides whether a stroke's FINAL record may stand in as its plain look. */
function rebake(batches, canLend) {
  const plainRecs = new Map(), recs = new Map();
  const plainFor = (j) => plainRecs.get(j) ?? (recs.has(j) && canLend(j) && !overSubstrate(recs.get(j)) ? recs.get(j) : null);
  for ( const batch of batches ) {
    const inB = new Set(batch);
    // wave 0: the plain looks of what the batch reads and of its strokes that read nothing
    const need = new Set();
    for ( const i of batch ) { if ( !deps[i].length ) need.add(i); for ( const j of deps[i] ) if ( !plainFor(j) && !objs[j].k ) need.add(j); }
    if ( need.size ) {
      const r = records(bake(objs.map((o, j) => need.has(j) ? o : { ...o, skip: 1 }), undefined, true));
      for ( const i of need ) {
        const sp = r.get(i) ?? [];
        plainRecs.set(i, sp);
        if ( inB.has(i) && !deps[i].length ) recs.set(i, sp);
      }
    }
    // wave 1: the strokes that read others, over those plain looks
    const over = batch.filter((i) => deps[i].length);
    if ( over.length ) {
      const under = {};
      for ( const i of over ) for ( const j of deps[i] ) if ( !inB.has(j) && !objs[j].k ) { const p = plainFor(j); if ( p ) under[j] = p; }
      const r = records(bake(objs.map((o, j) => inB.has(j) && deps[j].length ? o : { ...o, skip: 1 }), under));
      for ( const i of over ) {
        const sp = r.get(i) ?? [];
        recs.set(i, sp);
        if ( canLend(i) && !overSubstrate(sp) ) plainRecs.set(i, sp);      // (the page's take(): a final look that is no substrate bake is kept as a plain one)
      }
    }
  }
  return objs.map((o, i) => hashOf(recs.get(i)));
}
// seeded shuffles into batches of 1-4
let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
function batchesOf() {
  const order = objs.map((o, i) => i); for ( let i = order.length - 1; i > 0; i-- ) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const out = []; for ( let i = 0; i < order.length; ) { const n = 1 + Math.floor(rnd() * 4); out.push(order.slice(i, i + n)); i += n; }
  return out;
}
const TRIALS = 40, fixed = (j) => Policy.finalIsPlain(deps[j].length);
let badLegacy = 0, badFixed = 0;
for ( let t = 0; t < TRIALS; t++ ) {
  const b = batchesOf();
  if ( rebake(b, () => true).some((h, i) => h !== want[i]) ) badLegacy++;
  if ( rebake(b, fixed).some((h, i) => h !== want[i]) ) badFixed++;
}
ok(badLegacy > 0, `(the test sees the pitfall: a final record lent as a plain look gives other pixels in ${badLegacy} of ${TRIALS} random batchings)`);
ok(badFixed === 0, `with the policy (a stroke that reads others never lends its final record) all ${TRIALS} random batchings bake exactly what one bake of everything gives (${badFixed} differ)`);
// a second Rebake all over the first one's state gives the same again
{
  const a1 = rebake(batchesOf(), fixed), a2 = rebake(batchesOf(), fixed);
  ok(a1.every((h, i) => h === a2[i]), "two Rebake alls in different batches give the same pixels for every stroke");
}
ok(Policy.finalIsPlain(0) && !Policy.finalIsPlain(1) && !Policy.finalIsPlain(43), "finalIsPlain: only a stroke that reads nothing");
console.log(fails ? `${fails} FAILED` : "stable-plain: ok");
process.exit(fails ? 1 : 0);
