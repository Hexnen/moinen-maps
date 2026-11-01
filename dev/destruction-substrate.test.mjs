// node dev/destruction-substrate.test.mjs [-v]     (CORE=<path to another core.mjs> measures an older core: metrics only)
// THE SUBSTRATE (scripts/destruction/substrate.mjs) and THE SEVERITY RULE, outside Foundry:
//  1. one-way: an older stroke's bytes never change because of a newer one; a newer stroke with nothing older under or near it bakes
//     exactly the bytes it bakes alone;
//  2. the digest: changing an older stroke (cause, pixels) or removing it changes the full signature of the newer strokes over it and
//     of nothing else; a new stroke, an erase stroke and an undo change no other stroke's signature (0 re-bakes);
//  3. the pipeline's bake counts: painting B over A bakes only B (A's sprites come in as `under`); a re-cause of A bakes A and the
//     strokes over it only; a lower stroke inside a higher one bakes nothing at all when it lies wholly inside it;
//  4. a tear over older damage lays NO clean ground inside its own pixels: where the older look was damage, the result is the plain
//     map at (almost) no pixel (before substrates: hundreds per pair);
//  5. the severity rule: a lower level over (or under) a higher one never changes the higher one's pixels (cracks over a crater:
//     the crater's pixels as alone, every level pair, several kinds, with and without a cause); paint order of different levels
//     gives the higher one's look over the overlap (commutativity, measured on the higher one's own pixels);
//  6. level gradation: per kind, level 1 < 2 < 3 in ruin area, darkness and (for kinds that throw) debris; a crater (blast 3) is
//     darker than a level-2 cave-in.
const corePath = process.env.CORE ?? new URL("../scripts/destruction/core.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const core = await import(new URL("file:///" + corePath.replace(/\\/g, "/")).href);
const subPath = new URL("../scripts/destruction/substrate.mjs", import.meta.url).href;
const Sub = await import(subPath);
const F = core.META_FIELDS, K = 2, AW = 300, AH = 200, MW = AW / K, MH = AH / K;
const V = process.argv.includes("-v");
let fails = 0;
const ok = (cond, msg) => { if ( !cond || V ) console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if ( !cond ) fails++; };
const info = (msg) => console.log(`     ${msg}`);
const h2 = (x, y, s) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
// a map: grass on the left, paving on the right
const map = new Uint8ClampedArray(AW * AH * 4);
for ( let y = 0; y < AH; y++ ) for ( let x = 0; x < AW; x++ ) {
  const n = h2(x, y, 3) * 24 - 12, o = (y * AW + x) * 4, row = (y / 10) | 0, mortar = (x + (row % 2) * 6) % 12 === 0 || y % 10 === 0;
  const c = x < AW / 2 ? [74 + n, 122 + n * 1.2, 52 + n * 0.6] : mortar ? [70, 68, 66] : [128 + n, 124 + n, 118 + n];
  map.set([c[0], c[1], c[2], 255], o);
}
/** A disc stroke (mask px) of one level; a tear gets a path across it. */
function disc(id, t, cx, cy, r, lv = 3, c = 0) {
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r)), x1 = Math.min(MW - 1, Math.ceil(cx + r)), y1 = Math.min(MH - 1, Math.ceil(cy + r));
  const w = x1 - x0 + 1, h = y1 - y0 + 1, bytes = new Uint8Array(w * h);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) if ( (x0 + x + 0.5 - cx) ** 2 + (y0 + y + 0.5 - cy) ** 2 <= r * r ) bytes[y * w + x] = lv;
  const path = t === 5 ? [[(cx - r * 0.85) * K, cy * K], [cx * K, (cy - r * 0.15) * K], [(cx + r * 0.85) * K, cy * K]] : undefined;
  return { id, k: 0, t, c, x0, y0, w, h, bytes, path };
}
const P0 = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", jagged: false, jag: 0.6, directional: false };
const MAP = { w: AW, h: AH, data: map };
const bake = (objects, cache = null, under = undefined) => core.bake({ objects, K, aw: AW, ah: AH, seed: 7, params: P0, map: MAP, mapKey: "sub", under }, cache);

/** Sprites per object index, with a byte signature per object. */
function split(r) {
  const by = new Map(); let cur = null;
  for ( let k = 0; k < r.count; k++ ) {
    const o = k * F, m = r.meta;
    const s = { kind: m[o], sx: m[o + 1], sy: m[o + 2], w: m[o + 3], h: m[o + 4], x: m[o + 5], y: m[o + 6], flags: m[o + 11] & 15, type: m[o + 10] };
    let hh = 2166136261;
    for ( let y = 0; y < s.h; y++ ) for ( let x = 0; x < s.w; x++ ) { const q = ((s.sy + y) * r.sheet.w + s.sx + x) * 4; for ( let c = 0; c < 4; c++ ) hh = Math.imul(hh ^ r.sheet.data[q + c], 16777619); }
    s.sig = `${s.kind},${s.w},${s.h},${s.x},${s.y},${hh >>> 0}`;
    if ( s.kind === 0 ) { cur = m[o + 16]; if ( !by.has(cur) ) by.set(cur, []); }
    by.get(cur)?.push(s);
  }
  return by;
}
const sigOf = (r, index) => (split(r).get(index) ?? []).map((s) => s.sig).join("|");
/** Records as the main thread keeps them (Chunks.splitSheet's format), per object index. */
function records(r) {
  const recs = new Map(); let cur = null;
  for ( let k = 0; k < r.count; k++ ) {
    const o = k * F, m = Int16Array.from(r.meta.subarray(o, o + F));
    if ( m[0] === 0 ) { cur = m[16]; if ( !recs.has(cur) ) recs.set(cur, []); }
    const w = m[3], h = m[4], img = new Uint8Array(w * h * 4);
    for ( let y = 0; y < h; y++ ) img.set(r.sheet.data.subarray(((m[2] + y) * r.sheet.w + m[1]) * 4, ((m[2] + y) * r.sheet.w + m[1] + w) * 4), y * w * 4);
    recs.get(cur).push({ m, w, h, img });   // (as Chunks.splitSheet gives them: pixels in `img`)
  }
  return recs;
}
/** The display's composition at rest: the plain map, then every object in creation order (its cover lays the map, base, pieces). */
function compose(r) {
  const out = new Float32Array(AW * AH * 3);
  for ( let i = 0; i < AW * AH; i++ ) for ( let c = 0; c < 3; c++ ) out[i * 3 + c] = map[i * 4 + c];
  const d = r.sheet.data, SW = r.sheet.w;
  // per part, in sheet order (parts of a stroke stay together, strokes in creation order)
  const parts = []; let cur = null;
  for ( let k = 0; k < r.count; k++ ) {
    const o = k * F, m = r.meta;
    const s = { kind: m[o], sx: m[o + 1], sy: m[o + 2], w: m[o + 3], h: m[o + 4], x: m[o + 5], y: m[o + 6] };
    if ( s.kind === 0 ) { cur = { index: m[o + 16], k, sp: [] }; parts.push(cur); }
    cur?.sp.push(s);
  }
  parts.sort((a, b) => a.index - b.index || a.k - b.k);
  for ( const p of parts ) {
    for ( const s of p.sp ) if ( s.kind === 2 ) for ( let y = 0; y < s.h; y++ ) for ( let x = 0; x < s.w; x++ ) {
      const X = s.x + x, Y = s.y + y; if ( X < 0 || Y < 0 || X >= AW || Y >= AH || !d[((s.sy + y) * SW + s.sx + x) * 4 + 3] ) continue;
      const i = Y * AW + X; for ( let c = 0; c < 3; c++ ) out[i * 3 + c] = map[i * 4 + c];
    }
    for ( const kind of [0, 1] ) for ( const s of p.sp ) if ( s.kind === kind ) for ( let y = 0; y < s.h; y++ ) for ( let x = 0; x < s.w; x++ ) {
      const X = s.x + x, Y = s.y + y; if ( X < 0 || Y < 0 || X >= AW || Y >= AH ) continue;
      const q = ((s.sy + y) * SW + s.sx + x) * 4, a = d[q + 3] / 255; if ( !a ) continue;
      const i = Y * AW + X; for ( let c = 0; c < 3; c++ ) out[i * 3 + c] = out[i * 3 + c] * (1 - a) + d[q + c] * a;
    }
  }
  return out;
}
/** A stroke's mask pixels at art resolution. */
function maskOf(ob) {
  const m = new Uint8Array(AW * AH);
  for ( let y = 0; y < ob.h; y++ ) for ( let x = 0; x < ob.w; x++ ) if ( ob.bytes[y * ob.w + x] ) for ( let dy = 0; dy < K; dy++ ) for ( let dx = 0; dx < K; dx++ ) m[((ob.y0 + y) * K + dy) * AW + (ob.x0 + x) * K + dx] = 1;
  return m;
}
/** An object's own pixels as baked (its cover sprites: its torn outline, what it lays). */
function coverOf(r, index) {
  const m = new Uint8Array(AW * AH);
  for ( const s of split(r).get(index) ?? [] ) if ( s.kind === 2 ) for ( let y = 0; y < s.h; y++ ) for ( let x = 0; x < s.w; x++ ) {
    const X = s.x + x, Y = s.y + y; if ( X >= 0 && Y >= 0 && X < AW && Y < AH && r.sheet.data[((s.sy + y) * r.sheet.w + s.sx + x) * 4 + 3] ) m[Y * AW + X] = 1;
  }
  return m;
}
/** Where an object's composition differs from the plain map (its damage, at rest), as a mask. */
const diffMask = (c) => { const m = new Uint8Array(AW * AH); for ( let i = 0; i < AW * AH; i++ ) { let d = 0; for ( let k = 0; k < 3; k++ ) d += Math.abs(c[i * 3 + k] - map[i * 4 + k]); if ( d > 18 ) m[i] = 1; } return m; };
const pxDiff = (a, b, i) => Math.abs(a[i * 3] - b[i * 3]) + Math.abs(a[i * 3 + 1] - b[i * 3 + 1]) + Math.abs(a[i * 3 + 2] - b[i * 3 + 2]);
const T = core.TYPES;

/* ---------------------------------------------------------------- 1. one-way, and bit-identical without anything older */
{
  let older = 0, alone = 0, n = 0;
  for ( let a = 0; a < 6; a++ ) for ( let b = 0; b < 6; b++ ) for ( const c of [0, 1] ) {
    n++;
    const A = disc(`A${a}`, a, 50, 50, 11, 3), B = disc(`B${b}${c}`, b, 60, 52, 9, 3, c), Far = disc(`F${b}${c}`, b, 120, 50, 9, 3, c);
    const rAB = bake([A, B, Far]);
    if ( sigOf(bake([A]), 0) === sigOf(rAB, 0) ) older++; else ok(false, `${T[a]} <- ${T[b]} (cause ${c}): the older stroke changed`);
    if ( sigOf(bake([Far]), 0) === sigOf(rAB, 2) ) alone++; else ok(false, `${T[b]} far from ${T[a]} (cause ${c}): not the bytes it bakes alone`);
  }
  ok(older === n, `one-way: an older stroke's bytes never change because of a newer one over it: ${older}/${n}`);
  ok(alone === n, `with nothing older under or near it a stroke bakes the bytes it bakes alone: ${alone}/${n}`);
}

/* ---------------------------------------------------------------- 2. the digest */
{
  const own = (o) => `${o.id},${o.k},${o.t},${o.x0},${o.y0},${o.w},${o.h},${o.c | 0},${[...o.bytes].join("")}`;
  const A = disc("A", 1, 50, 50, 11, 3), B = disc("B", 5, 58, 52, 10, 3), C = disc("C", 0, 136, 80, 8, 3), D = disc("D", 4, 64, 54, 6, 1);
  const s0 = Sub.fullSigs([A, B, C, D], own, P0, K).map((q) => q.sig);
  const s1 = Sub.fullSigs([{ ...A, c: 1 }, B, C, D], own, P0, K).map((q) => q.sig);
  ok(s0[0] !== s1[0] && s0[1] !== s1[1] && s0[2] === s1[2] && s0[3] !== s1[3], `re-causing A changes A and the strokes over it (B, D), not C far away: ${[0, 1, 2, 3].map((i) => s0[i] === s1[i] ? "same" : "new").join(" ")}`);
  const s2 = Sub.fullSigs([A, B, C], own, P0, K).map((q) => q.sig);
  ok(s2.every((v, i) => v === s0[i]), "undoing the newest stroke changes no other stroke's signature");
  const E = { id: "E", k: 1, t: 0, x0: 20, y0: 20, w: 50, h: 50, bytes: new Uint8Array(2500).fill(1) };
  const s3 = Sub.fullSigs([A, B, C, D, E], own, P0, K).map((q) => q.sig);
  ok(s0.every((v, i) => v === s3[i]), "an erase stroke over everything changes no stroke's signature (display only, 0 re-bakes)");
  const s4 = Sub.fullSigs([B, C], own, P0, K).map((q) => q.sig);
  ok(s4[1] === s0[2] && s4[0] === own(B), "without the older A under it, B's signature is its own (no digest): bit for bit the old signature");
  const s5 = Sub.fullSigs([A, B, C, D, disc("N", 2, 140, 20, 5, 2)], own, P0, K).map((q) => q.sig);
  ok(s0.every((v, i) => v === s5[i]), "painting a new stroke changes no older stroke's signature");
}

/* ---------------------------------------------------------------- 3. the pipeline: what each change bakes */
{
  const A = disc("A", 1, 50, 50, 11, 3), B = disc("B", 5, 58, 52, 10, 3);
  const cache = new Map();
  const rA = bake([A], cache), recA = records(rA).get(0);
  // painting B: only B is baked, A's sprites come as its record (as destruction.mjs sends them)
  const rB = bake([{ ...A, skip: 1 }, B], new Map(), { 0: recA });
  ok(rB.stats.baked === 1 && (rB.stats.substrate ?? 0) === 1, `painting B over A bakes only B, over its substrate (baked ${rB.stats.baked}, over a substrate ${rB.stats.substrate ?? 0})`);
  ok(sigOf(rB, 1) === sigOf(bake([A, B]), 1), "B baked from A's record is byte-identical to B baked together with A (the same on every client)");
  // re-cause A: A and B bake again (B silently), nothing else
  const A2 = { ...A, c: 1 }, rC = bake([A2, B], cache);
  ok(rC.stats.baked === 2, `re-causing A bakes A and the stroke over it (baked ${rC.stats.baked})`);
  // cracks wholly inside a crater: nothing at all to bake
  const Cr = disc("Cr", 0, 50, 50, 12, 3), Ck = disc("Ck", 4, 50, 50, 4, 1);
  const rCk = bake([Cr, Ck]);
  ok(!split(rCk).has(1), `cracks wholly inside a crater bake nothing (cut off: ${rCk.stats.cutOff ?? 0})`);
}

/* ---------------------------------------------------------------- 4. a tear lays no clean ground inside its own pixels */
{
  let total = 0, worst = 0, before = 0;
  const rows = [];
  for ( const a of [0, 1, 2, 3, 4] ) for ( const lv of [2, 3] ) for ( const c of [0, 1] ) {
    const A = disc(`A${a}${lv}`, a, 55, 50, 12, lv), Tr = disc(`T${a}${lv}${c}`, 5, 62, 50, 11, lv, c);
    const cA = compose(bake([A])), cAT = compose(bake([A, Tr])), mT = maskOf(Tr), dA = diffMask(cA);
    let cleared = 0, inA = 0;
    for ( let i = 0; i < AW * AH; i++ ) {
      if ( !mT[i] || !dA[i] ) continue;
      inA++;
      let d = 0; for ( let k = 0; k < 3; k++ ) d += Math.abs(cAT[i * 3 + k] - map[i * 4 + k]);
      if ( d <= 6 ) cleared++;
    }
    total += cleared; worst = Math.max(worst, cleared / Math.max(1, inA)); before += inA;
    rows.push(`${T[a]} L${lv} c${c}: ${cleared}/${inA}`);
    ok(cleared <= Math.max(3, inA * 0.02), `tear L${lv} over ${T[a]} L${lv} (cause ${c}): ${cleared} of ${inA} pixels of older damage under the tear show clean ground`);
  }
  info(`tear over older damage: ${total} clean-ground pixels in all (worst ${(worst * 100).toFixed(1)}% of the older damage under a tear)`);
  if ( V ) info(rows.join("; "));
}

/* ---------------------------------------------------------------- 5. the severity rule */
{
  let exact = 0, n = 0, commSum = 0, commN = 0;
  const kinds = [0, 1, 4, 5, 2];
  for ( const hk of [0, 1] ) for ( const lk of kinds ) for ( const hl of [2, 3] ) for ( const ll of [1, 2] ) for ( const c of [0, 1] ) {
    if ( ll >= hl ) continue;
    const Hi = disc(`H${hk}${hl}`, hk, 60, 50, 12, hl, c), Lo = disc(`L${lk}${ll}${c}`, lk, 64, 52, 13, ll, c);
    const rH = bake([Hi]), cH = compose(rH), mH = diffMask(cH), cov = coverOf(rH, 0);
    // lower over higher: the higher one's damage exactly as alone
    const cHL = compose(bake([Hi, Lo]));
    let changed = 0;
    for ( let i = 0; i < AW * AH; i++ ) if ( mH[i] && cov[i] && pxDiff(cHL, cH, i) > 3 ) changed++;
    n++; if ( changed <= 2 ) exact++; else ok(false, `${T[lk]} L${ll} over ${T[hk]} L${hl} (cause ${c}): ${changed} of the higher damage's pixels changed`);
    // higher over lower: over the higher one's own pixels the look is the higher one's (the other paint order)
    const cLH = compose(bake([Lo, Hi]));
    let diff = 0, m = 0;
    for ( let i = 0; i < AW * AH; i++ ) if ( mH[i] && cov[i] ) { m++; if ( pxDiff(cLH, cHL, i) > 24 ) diff++; }
    if ( lk !== 5 ) { commSum += diff / Math.max(1, m); commN++; if ( process.env.COMM ) info(`comm ${T[lk]} L${ll} / ${T[hk]} L${hl} c${c}: ${diff}/${m}`); }
  }
  ok(exact === n, `a lower level over a higher one never changes it (every level pair, kinds ${kinds.map((k) => T[k]).join("/")} over blast/collapse, causes none/fire): ${exact}/${n}`);
  const comm = commSum / commN;
  ok(comm < 0.01, `paint order of different levels: the higher one's own pixels differ in ${(comm * 100).toFixed(2)}% on average between the two orders (a tear under a higher level keeps its lips from what lay there: not counted)`);
}

/* ---------------------------------------------------------------- 6. level gradation */
{
  const metrics = (t, lv, c) => {
    const ob = disc(`G${t}${lv}${c}`, t, 75, 50, 14, lv, c), r = bake([ob]), cm = compose(r), mask = maskOf(ob);
    let area = 0, dark = 0, n = 0, debris = 0;
    for ( let i = 0; i < AW * AH; i++ ) {
      if ( !mask[i] ) continue;
      n++;
      const lm = 0.299 * map[i * 4] + 0.587 * map[i * 4 + 1] + 0.114 * map[i * 4 + 2], lc = 0.299 * cm[i * 3] + 0.587 * cm[i * 3 + 1] + 0.114 * cm[i * 3 + 2];
      let d = 0; for ( let k = 0; k < 3; k++ ) d += Math.abs(cm[i * 3 + k] - map[i * 4 + k]); if ( d > 18 ) area++;
      dark += Math.max(0, (lm - lc) / Math.max(lm, 40));
    }
    for ( const s of split(r).get(0) ?? [] ) if ( s.kind === 1 ) debris++;
    return { area: area / n, dark: dark / n, debris };
  };
  let mono = 0, total = 0;
  const table = [];
  for ( let t = 0; t < 6; t++ ) for ( const c of [0, 1, 8] ) {
    const m = [1, 2, 3].map((lv) => metrics(t, lv, c));
    table.push(`${T[t].padEnd(8)} c${c}: area ${m.map((q) => q.area.toFixed(2)).join(" < ")}, dark ${m.map((q) => q.dark.toFixed(2)).join(" < ")}, debris ${m.map((q) => q.debris).join(" / ")}`);
    total++;
    // darkness strictly by level (2 % slack); the ruined area may dip a little at level 2 (cracks keep their plates) but grows overall
    const up = (k, e) => m[0][k] <= m[1][k] + e && m[1][k] <= m[2][k] + e && m[2][k] > m[0][k];
    if ( up("dark", 0.02) && up("area", 0.08) ) mono++; else ok(false, `level gradation ${T[t]} cause ${c}: not monotone (${table[table.length - 1]})`);
  }
  ok(mono === total, `every kind x cause grows darker and wider with its level 1 < 2 < 3: ${mono}/${total}`);
  if ( V || fails ) for ( const l of table ) info(l);
  const crater = metrics(0, 3, 0), pit2 = metrics(1, 2, 0);
  ok(crater.dark > pit2.dark, `a crater (blast 3) is darker than a level-2 cave-in: ${crater.dark.toFixed(2)} > ${pit2.dark.toFixed(2)}`);
}

console.log(fails ? `FAILED ${fails}` : "PASS");
process.exit(fails ? 1 : 0);
