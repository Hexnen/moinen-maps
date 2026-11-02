// SUPERHERO: a carried token ploughs through the tokens on its way (the pure parts):   node dev/plough.test.mjs
//   1. bodies: overlap depth of rectangles, discs and one of each;
//   2. swept contact: the moment a moving rectangle / disc first touches a fixed one, at different sizes and angles;
//   3. the plough: first contact picks a token up, it stays AHEAD of the carrier along the heading at every sample, a chain reaction brings
//      the next ones in, the pile is limited, a token off the path is left alone, an off-centre hit deflects sideways a little;
//   4. determinism: the same input, the same record, whatever the order of the tokens in the list;
//   5. the final places: nobody ends on an occupied place (snapped to cells or not), the line along the push is searched first;
//   6. the record: it reads back (validHit / hitsOf), playback multiplies the times by k and keeps the pile in step with the carrier at any k,
//      `hit` is in no stroke signature (no re-bake, same chunk ids) and an older reader loads the same stroke.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
class ForcedDeletion {}
globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
globalThis.foundry = { data: { operators: { ForcedDeletion } }, utils: { deepClone: (v) => structuredClone(v) } };
globalThis.canvas = { dimensions: { sceneRect: { x: 0, y: 0, width: 4000, height: 2000 } }, grid: { size: 100 } };
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const C = await imp("scripts/tokens/carry-core.mjs");
const X = await imp("scripts/tokens/plough-core.mjs");
const Model = await imp("scripts/destruction/model.mjs");
const Store = await imp("scripts/destruction/store.mjs");

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const B = X.body;

/* ---- 1. bodies */
{
  const r = B(0, 0, 100, 60), r2 = B(0, 0, 40, 40), c = B(0, 0, 100, 100, true), c2 = B(0, 0, 40, 40, true);
  check(near(X.depth(r, 0, 0, r2, 80, 0), (100 + 40) / 2 - 80) && X.depth(r, 0, 0, r2, 80, 0) < 0, "depth: rectangles that do not touch have no overlap (the gap is negative)");
  check(X.overlaps(r, 0, 0, r2, 60, 0) && !X.overlaps(r, 0, 0, r2, 70, 0) && !X.overlaps(r, 0, 0, r2, 70, 0, 0), "overlap: rectangles 'touch' without overlapping at exactly the sum of the half widths");
  check(X.overlaps(r, 0, 0, r2, 0, 49) && !X.overlaps(r, 0, 0, r2, 0, 50) && !X.overlaps(r, 0, 0, r2, 0, 51), "overlap: the shorter side counts");
  check(X.overlaps(c, 0, 0, c2, 69, 0) && !X.overlaps(c, 0, 0, c2, 70, 0), "overlap: discs at the sum of the radii");
  check(!X.overlaps(c, 0, 0, c2, 50, 50), "overlap: discs on the diagonal need the real distance (70.7 > 70)");
  // a disc (r 20) against a rectangle 100 x 60 : its corner (50, 30)
  check(X.overlaps(c2, 60, 0, r, 0, 0) && !X.overlaps(c2, 71, 0, r, 0, 0), "overlap: disc against a rectangle's side");
  check(!X.overlaps(c2, 66, 46, r, 0, 0) && X.overlaps(c2, 60, 40, r, 0, 0), "overlap: disc against a rectangle's corner (a round corner, not a box)");
  check(X.overlaps(c2, 0, 0, r, 0, 0) && X.depth(c2, 0, 0, r, 0, 0) > 20, "overlap: a disc centred inside a rectangle");
  const a = B(0, 0, 60, 60), b = B(10, 0, 60, 60);
  check(near(X.clearance(a, 0, 0, 1, 0, b), 70, 0.05) && near(X.clearance(a, 0, 0, -1, 0, b), 50, 0.05), "clearance: how far along a direction a body must go to clear another");
  check(X.clearance(a, 300, 0, 1, 0, b) === 0, "clearance: nothing to clear");
}

/* ---- helpers: a straight carry along +x */
const tkOf = (pts, o = {}) => ({ id: "car", x0: 0, y0: 0, x1: 0, y1: 0, e: 0, p: pts.flatMap((q) => q), ...o });
const GEO = { ap: 1, ox: 0, oy: 0 };
const tlOf = (tk, k = 1) => C.buildTimeline(tk, { ...GEO, k });
const tokenAt = (id, cx, cy, w = 100, h = 100, round = false) => ({ id, x: cx - w / 2, y: cy - h / 2, w, h, round });

/* ---- 2. swept contact */
{
  const tk = tkOf([[0, 0, 0], [600, 0, 600]]);     // 1 px per ms
  const tl = tlOf(tk);
  const a = B(0, 0, 100, 100), b = B(400, 0, 60, 60);
  const r = X.sweepContact(tl, a, b);
  check(r && near(r.t, 320, 0.05) && near(r.x, 320, 0.05), `sweep: rectangle 100 meets rectangle 60 at x = 320 (t ${r?.t?.toFixed(2)})`);
  const r2 = X.sweepContact(tl, B(0, 0, 100, 100, true), B(400, 0, 40, 40, true));
  check(r2 && near(r2.t, 330, 0.05), `sweep: disc r 50 meets disc r 20 at x = 330 (t ${r2?.t?.toFixed(2)})`);
  const r3 = X.sweepContact(tl, B(0, 0, 100, 100, true), B(400, 0, 60, 60));
  check(r3 && near(r3.t, 320, 0.05), `sweep: disc r 50 meets a rectangle 60 at its side, x = 320 (t ${r3?.t?.toFixed(2)})`);
  check(X.sweepContact(tl, a, B(400, 200, 60, 60)) === null, "sweep: a body off the path is never touched");
  check(X.sweepContact(tl, a, B(400, 79, 60, 60)) !== null && X.sweepContact(tl, a, B(400, 81, 60, 60)) === null, "sweep: the miss distance is the sum of the half heights (80)");
  const r4 = X.sweepContact(tl, a, B(20, 0, 60, 60));
  check(r4 && r4.t === 0, "sweep: a body already touching is met at t = 0");
  // a diagonal path: the rectangle's corner meets the other's corner
  const dtk = tkOf([[0, 0, 0], [500, 500, 700]]), dtl = tlOf(dtk);
  const rd = X.sweepContact(dtl, B(0, 0, 100, 100), B(400, 400, 100, 100));
  check(rd && near(rd.x, 300, 0.1) && near(rd.y, 300, 0.1), `sweep: diagonal approach meets at (300, 300) (got ${rd?.x?.toFixed(1)}, ${rd?.y?.toFixed(1)})`);
  // size dependence: bigger bodies meet sooner, linearly
  const ts = [40, 80, 160, 320].map((w) => X.sweepContact(tl, B(0, 0, w, w), B(500, 0, w, w)).t);
  check(ts.every((t, i) => near(t, 500 - [40, 80, 160, 320][i], 0.05)), `sweep: contact time falls by the body size (${ts.map((t) => t.toFixed(0)).join(", ")})`);
  // a fast flick over a thin body does not tunnel
  const ftk = tkOf([[0, 0, 0], [3000, 0, 400]]), ftl = tlOf(ftk);
  check(X.sweepContact(ftl, B(0, 0, 20, 20), B(1500, 0, 6, 6)) !== null, "sweep: a fast flick over a thin token does not tunnel through it");
}

/* ---- 3. the plough */
const along = (h, t) => { // the pushed centre at time t (linear on the samples)
  const p = h.p; if ( t <= p[2] ) return [p[0], p[1]];
  for ( let i = 3; i < p.length; i += 3 ) if ( p[i + 2] >= t ) { const f = (t - p[i - 1]) / ((p[i + 2] - p[i - 1]) || 1); return [p[i - 3] + (p[i] - p[i - 3]) * f, p[i - 2] + (p[i + 1] - p[i - 2]) * f]; }
  return [p[p.length - 3], p[p.length - 2]];
};
const carrierAt = (tk, t, k = 1) => { const tl = tlOf(tk, k), o = { x: 0, y: 0, ux: 0, uy: 0, sp: 0 }; C.displacementAt(tl, t, o); return [tk.x0 + 50 + o.x, tk.y0 + 50 + o.y]; };
const rec = (tk, others, extra = {}) => X.ploughRecord({ tk, geo: GEO, carrier: { w: 100, h: 100, round: false }, others, rect: { x: 0, y: 0, width: 4000, height: 2000 }, ...extra });
{
  const tk = tkOf([[50, 50, 0], [450, 50, 400], [900, 50, 900]], { x1: 850, y1: 0 });
  const A = tokenAt("A", 400, 50), Bn = tokenAt("B", 530, 50), Cn = tokenAt("C", 1500, 50), Dn = tokenAt("D", 600, 600);
  const hits = rec(tk, [A, Bn, Cn, Dn]);
  check(hits.length === 2 && hits[0].id === "A" && hits[1].id === "B", `plough: A is hit, B joins by the chain, C (beyond the end) and D (off the path) are left (${hits.map((h) => h.id)})`);
  const hA = hits[0], hB = hits[1];
  check(hA.t0 > 150 && hA.t0 < 260, `plough: A is met when the gap closes (~200 ms; got ${hA.t0})`);
  check(hB.t0 >= hA.t0, `plough: B joins after A (${hB.t0} >= ${hA.t0})`);
  let ahead = true, worst = 1e9, orderOk = true;
  for ( let t = hA.t0; t <= 900; t += 7 ) {
    const c = carrierAt(tk, t), a = along(hA, t);
    if ( a[0] - c[0] < 100 - 2 ) ahead = false;                         // A's centre is at least a body's width ahead (touching)
    worst = Math.min(worst, a[0] - c[0]);
    if ( t >= hB.t0 ) { const b = along(hB, t); if ( b[0] - a[0] < 100 - 0.6 ) orderOk = false; }
  }
  check(ahead, `plough: the pushed token stays ahead of the carrier along the path all the time (closest ${worst.toFixed(1)} >= 98)`);
  check(orderOk, "plough: B stays ahead of A (the pile keeps its order)");
  const last = (h) => h.p.slice(-3);
  check(last(hA)[2] === 900 && last(hB)[2] === 900, "plough: every pushed path lasts to the end of the carrier's run");
  const ends = hits.map((h) => [h.x1 + 50, h.y1 + 50]);
  check(hits.every((h) => Math.abs(h.y0 - 0) < 1 && Math.abs(h.y1) < 40), "plough: a head-on hit stays on the line (no big sideways drift)");
  check(ends[0][0] > 850 && ends[1][0] > ends[0][0] + 99, `plough: the finals are ahead of the carrier's end, in order (${ends.map((e) => Math.round(e[0]))})`);
  check(hA.x0 === 350 && hA.y0 === 0 && hB.x0 === 480, "plough: x0, y0 are the pushed token's top-left before");
  // smoothness: no jump of the pushed centre between samples bigger than the carrier's travel + a body
  let jump = 0; for ( const h of hits ) for ( let i = 3; i < h.p.length; i += 3 ) jump = Math.max(jump, Math.hypot(h.p[i] - h.p[i - 3], h.p[i + 1] - h.p[i - 2]) / ((h.p[i + 2] - h.p[i - 1]) || 1));
  check(jump < 3, `plough: a pushed token never moves faster than the carrier's top speed would (${jump.toFixed(2)} px/ms)`);
}
{ // off centre: the pushed token keeps its own line (pushed straight ahead, never squeezed out of the blade)
  const tk = tkOf([[50, 50, 0], [800, 50, 700]], { x1: 750, y1: 0 });
  const above = rec(tk, [tokenAt("A", 400, 30)]), below = rec(tk, [tokenAt("A", 400, 70)]);
  check(above.length === 1 && below.length === 1 && above[0].y1 === above[0].y0 && below[0].y1 === below[0].y0 && above[0].x1 > 700 && below[0].x1 > 700, `plough: a token hit off centre is pushed straight ahead on its own line to the end (${above[0]?.x1}, ${below[0]?.x1})`);
}
{ // limit
  const tk = tkOf([[50, 50, 0], [1500, 50, 1400]], { x1: 1450, y1: 0 });
  const row = Array.from({ length: 20 }, (_, i) => tokenAt("t" + String(i).padStart(2, "0"), 250 + i * 100, 50));
  const hits = rec(tk, row);
  check(hits.length === X.MAX_PILE, `plough: the pile is limited to ${X.MAX_PILE} (got ${hits.length})`);
  check(rec(tk, row, { maxPile: 3 }).length === 3, "plough: the limit is a parameter");
}
{ // discs and mixed sizes
  const tk = tkOf([[50, 50, 0], [900, 50, 800]], { x1: 850, y1: 0 });
  const hits = rec(tk, [tokenAt("big", 400, 50, 200, 200, true), tokenAt("small", 520, 60, 40, 40)]);
  check(hits.length === 2 && hits[0].id === "big", "plough: a big round token and a small one: both are pushed");
  let ok = true;
  for ( let t = hits[0].t0; t <= 800; t += 9 ) {
    const c = carrierAt(tk, t), a = along(hits[0], t);
    if ( X.overlaps(B(c[0], c[1], 100, 100), c[0], c[1], B(a[0], a[1], 200, 200, true), a[0], a[1], 1.5) ) ok = false;
    if ( t >= hits[1].t0 ) { const s = along(hits[1], t); if ( X.overlaps(B(s[0], s[1], 40, 40), s[0], s[1], B(a[0], a[1], 200, 200, true), a[0], a[1], 1.5) ) ok = false; }
  }
  check(ok, "plough: pushed bodies never sink into the carrier or the pile (discs and rectangles)");
}
{ // nothing in the way / locked tokens are not offered / the carrier itself is not a hit
  const tk = tkOf([[50, 50, 0], [800, 50, 700]], { x1: 750, y1: 0 });
  check(rec(tk, []).length === 0 && rec(tk, [tokenAt("car", 400, 50)]).length === 0, "plough: no tokens, or only the carrier itself: no hits");
  check(rec(tk, [tokenAt("A", 400, 400)]).length === 0, "plough: a token off the path is not hit");
}

/* ---- 4. determinism */
{
  const tk = tkOf([[50, 50, 0], [450, 80, 400], [900, 30, 900]], { x1: 850, y1: -20 });
  const L = [tokenAt("A", 400, 70), tokenAt("B", 530, 40), tokenAt("C", 700, 60), tokenAt("D", 560, 160)];
  const a = JSON.stringify(rec(tk, L)), b = JSON.stringify(rec(tk, L)), c = JSON.stringify(rec(tk, [...L].reverse()));
  check(a === b && a.length > 40, "determinism: the same input gives the same record");
  check(a === c, "determinism: the order of the tokens in the list does not matter");
}

/* ---- 5. the final places */
{
  const snap = { grid: 100, gx: 0, gy: 0 };
  const tk = tkOf([[50, 50, 0], [750, 50, 700]], { x1: 700, y1: 0 });
  const L = [tokenAt("A", 350, 50), tokenAt("B", 450, 50), tokenAt("Z", 880, 50)];
  const hits = rec(tk, L, { snap });
  const cells = [[tk.x1 / 100, tk.y1 / 100], ...hits.map((h) => [h.x1 / 100, h.y1 / 100])];
  const keys = cells.map((c) => c.map((v) => Math.round(v)).join(","));
  check(hits.length === 3 || hits.length === 2, `final: pushed ${hits.map((h) => h.id)}`);
  check(new Set(keys).size === keys.length, `final: nobody ends on the same cell as another (${keys.join(" | ")})`);
  check(hits.every((h) => h.x1 % 100 === 0 && h.y1 % 100 === 0), "final: snapped tokens end centred on cells");
  // an unmoved token that sits in the way of a final place
  const taken = X.resolveFinals({ carrierEnd: B(750, 50, 100, 100), members: [{ id: "m", body: B(0, 0, 100, 100), cx: 850, cy: 50, ux: 1, uy: 0 }], fixed: [B(850, 50, 100, 100)], snap, rect: null });
  check(taken.get("m")[0] === 950 && taken.get("m")[1] === 50, `final: a place taken by a token that is not moved is not used (${taken.get("m")})`);
  // unsnapped: no overlaps either, at any size
  const big = rec(tk, [tokenAt("A", 360, 50, 150, 150), tokenAt("B", 500, 50, 80, 80), tokenAt("F", 880, 50, 120, 120)]);
  const bodies = [B(tk.x1 + 50, tk.y1 + 50, 100, 100)];
  const sz = { A: 150, B: 80, F: 120 };
  for ( const h of big ) bodies.push(B(h.x1 + sz[h.id] / 2, h.y1 + sz[h.id] / 2, sz[h.id], sz[h.id]));
  let clash = false; for ( let i = 0; i < bodies.length; i++ ) for ( let j = i + 1; j < bodies.length; j++ ) if ( X.overlaps(bodies[i], bodies[i].cx, bodies[i].cy, bodies[j], bodies[j].cx, bodies[j].cy, 0.6) ) clash = true;
  check(!clash && big.length === 3, "final: unsnapped, at different sizes, no two bodies overlap at the end");
  // a free line first: the displaced token stays on the push line
  const placed = X.resolveFinals({ carrierEnd: B(800, 50, 100, 100), members: [{ id: "m", body: B(0, 0, 100, 100), cx: 800, cy: 50, ux: 1, uy: 0 }], fixed: [], snap, rect: null });
  check(placed.get("m")[0] === 950 && placed.get("m")[1] === 50, `final: on the carrier's own place it moves one cell along the push line (${placed.get("m")})`);
  const boxed = X.resolveFinals({ carrierEnd: B(850, 50, 100, 100), members: [{ id: "m", body: B(0, 0, 100, 100), cx: 850, cy: 50, ux: 1, uy: 0 }], fixed: [B(950, 50, 100, 100), B(1050, 50, 100, 100), B(1150, 50, 100, 100)], snap, rect: null });
  check(boxed.get("m")[0] !== undefined && !X.overlaps(B(0, 0, 100, 100), boxed.get("m")[0], boxed.get("m")[1], B(850, 50, 100, 100), 850, 50, 0.5), "final: a blocked line falls back to the nearest free place around");
}

/* ---- 6. the record */
{
  const tk = tkOf([[50, 50, 0], [450, 50, 400], [900, 50, 900]], { x1: 850, y1: 0 });
  const hits = rec(tk, [tokenAt("A", 400, 50), tokenAt("B", 530, 50)]);
  const withHit = { ...tk, hit: hits };
  check(X.hitsOf(withHit).length === 2 && X.validHit(hits[0]), "record: a record reads back");
  check(X.hitsOf(tk).length === 0 && X.hitsOf({ ...tk, hit: "x" }).length === 0 && X.hitsOf({ ...tk, hit: [null, { id: "a" }, { ...hits[0], p: [1, 2] }, { ...hits[0], p: [0, 0, 5, 0, 0, 1] }, { ...hits[0], x1: NaN }] }).length === 0, "record: an older or damaged `hit` gives none");
  check(X.hitsOf({ ...tk, hit: [{ ...hits[0], id: "car" }] }).length === 0 && X.hitsOf({ ...tk, hit: [hits[0], hits[0]] }).length === 1, "record: the carried token and a repeated id are skipped");
  check(X.hitsOf({ ...tk, hit: Array.from({ length: 30 }, (_, i) => ({ ...hits[0], id: "q" + i })) }).length === X.MAX_PILE, "record: at most the pile limit are read");
  check(C.validTk(withHit), "record: a carry record with `hit` is still a valid `tk`");
  // playback at another k: times are multiplied; the pile stays ahead of the carrier
  for ( const k of [0.5, 1, 1.9] ) {
    const tl = tlOf(tk, k), htl = X.buildHitTimeline(hits[0], { k });
    const o = { x: 0, y: 0, ux: 0, uy: 0, sp: 0 }, q = { x: 0, y: 0, ux: 0, uy: 0, sp: 0 };
    let ok = htl && near(htl.D, tl.D, 1.5);
    let worst = 1e9;
    for ( let el = htl.tt[0]; el <= tl.D; el += tl.D / 83 ) {
      C.displacementAt(tl, el, o); C.displacementAt(htl, el, q);
      const gap = (htl.x0 + q.x) - (tk.x0 + 50 + o.x);
      worst = Math.min(worst, gap);
    }
    check(ok && worst > 99, `playback k ${k}: the timeline ends with the carrier's (${htl?.D.toFixed(1)} vs ${tl.D.toFixed(1)}) and the pushed token stays ahead (closest ${worst.toFixed(1)})`);
  }
  check(X.buildHitTimeline({ ...hits[0], p: [1] }) === null, "playback: a damaged record has no timeline");
  const htl = X.buildHitTimeline(hits[0]), o = { x: 0, y: 0, ux: 0, uy: 0, sp: 0 };
  C.displacementAt(htl, -50, o);
  check(o.x === 0 && o.y === 0, "playback: before the contact the pushed token is where it was");
  C.displacementAt(htl, 1e6, o);
  check(near(o.x, htl.dx) && near(o.y, htl.dy), "playback: after the run it is at the path's end");
}
{ // flag format
  const S = { params: { ...Model.PARAM_DEFAULTS, pin: true }, objects: [] };
  const buf = new Uint8Array(40 * 30).fill(3);
  const tk = tkOf([[10, 10, 0], [60, 10, 400]], { x1: 50, y1: 0 });
  const hit = [{ id: "A", x0: 10, y0: 0, x1: 70, y1: 0, t0: 100, p: [60, 50, 100, 120, 50, 400] }];
  const mk = (id, extra = {}) => Object.assign(Model.makeObject(buf, 40, { x0: 2, y0: 2, x1: 12, y1: 9 }, { id, type: 0, path: [[1, 1, 0], [50, 40, 300]] }), extra);
  const plain = mk("s1"), carried = mk("s1", { tk }), plough = mk("s1", { tk: { ...tk, hit } });
  const sig = (o) => Store.objSig({ params: { ...S.params, directional: true }, objects: [o] }, o);
  check(sig(plain) === sig(plough) && sig(carried) === sig(plough), "format: `tk.hit` is in no stroke signature (no re-bake, same chunk ids)");
  const S2 = { ...S, ap: 4, seed: 1, enabled: true, objects: [plough], entries: [], seen: new Set() };
  const upd = Store.flagUpdate(S2, { flags: { "moinen-maps": {} } });
  const stored = upd["flags.moinen-maps.destructionObjects"]?.s1 ?? upd["flags.moinen-maps.destructionObjects.s1"];
  check(stored?.tk?.hit?.length === 1 && stored.tk.hit[0].p.length === 6, "format: the stroke's own flag key holds `tk.hit`");
  const back = Model.objectsOf({ v: 3 }, { s1: stored }, { mw: 40, mh: 30 });
  check(back.length === 1 && X.hitsOf(back[0].tk).length === 1 && C.validTk(back[0].tk), "format: a load keeps `tk.hit`");
  const cp = Model.withCause(back[0], 2), pp = Model.withPin(back[0], { debris: 0.2 }, 1);
  check(X.hitsOf(cp.tk).length === 1 && X.hitsOf(pp.tk).length === 1, "format: a cause or a pinned setting changed on the stroke keeps `tk.hit`");
  const readOld = (o) => ({ id: o.id, k: o.k, t: o.t, x0: o.x0, y0: o.y0, w: o.w, h: o.h, m: o.m, p: o.p, c: o.c, pr: o.pr });
  check(JSON.stringify(readOld(stored)) === JSON.stringify(readOld(plain)) || JSON.stringify(readOld({ ...stored, s: undefined })) === JSON.stringify(readOld(plain)), "format: a reader that does not know `tk` / `hit` reads the same stroke");
  // an older reader of tk: it reads id, x0.. and p only: the same carry
  const oldTk = { id: stored.tk.id, x0: stored.tk.x0, y0: stored.tk.y0, x1: stored.tk.x1, y1: stored.tk.y1, e: stored.tk.e, p: stored.tk.p };
  const t1 = C.buildTimeline(oldTk, { ...GEO }), t2 = C.buildTimeline(stored.tk, { ...GEO });
  check(C.validTk(oldTk) && t1.D === t2.D && t1.dx === t2.dx, "format: an older carry reader plays the same carry without `hit`");
}

console.log(failed ? `${failed} FAILED` : "plough: all ok");
process.exit(failed ? 1 : 0);
