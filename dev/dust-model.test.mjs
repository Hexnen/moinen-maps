// Dust and grit, the pure part (scripts/fire/dust-model.mjs + its hooks in model.mjs):   node dev/dust-model.test.mjs
//   A. strokes: kind / level cleaned, fire-only fields dropped, the flag round trip
//   B. areas: dust strokes form their own areas (never merged with fire), an eraser joins them, the key ignores the phases (a stroke
//      done kicking up its dust does not rebuild its area) but follows the strokes
//   C. the field: deterministic bytes, kick times follow the path at the kind's speed, out times from a put-out and from an eraser
//      painted after the dust (not one painted before), every emitter inside the area with its whole reach (nothing is ever cut by the
//      rectangle), an undone eraser gives a back time (the dust eases back in), tile lists hold every emitter whose reach touches the tile, the per-tile bound holds (even thinning)
//   D. time: phases grow -> on -> out -> gone, the end after a put-out leaves every puff dead
//   E. the art table: 16 codes, the levels grade (L1 < L2 < L3 puff size, grit, aura)
import * as M from "../scripts/fire/model.mjs";
import * as D from "../scripts/fire/dust-model.mjs";

let fails = 0, n = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const geo = { ap: 3, ox: 100, oy: 100, grid: 96 }, g = geo.grid / geo.ap;
const P = M.cleanParams();
const dust = (id, dk, lv, p, extra = {}) => M.cleanStroke({ id, k: "dust", dk, lv, r: 60, p, q: 1000, wd: 0, ws: 0, ...extra });

/* A */
{
  const s = dust("d1", "heavy", 3, [200, 300, 900, 340], { st: "fireball", c: "#ff0000", e: 1, tn: 0.5, sm: 2 });
  ok(s && s.k === "dust" && s.dk === "heavy" && s.lv === 3, "dust stroke kept with kind and level");
  ok(s.st === undefined && s.c === undefined && s.e === undefined && s.tn === undefined && s.sm === undefined, "fire-only fields dropped");
  ok(M.cleanStroke({ id: "d2", k: "dust", dk: "tank", lv: 9, p: [1, 2] }).dk === "car", "unknown dust kind -> car");
  ok(M.cleanStroke({ id: "d2", k: "dust", lv: 9, p: [1, 2] }).lv === 3, "level clamped");
  const back = M.strokesOf(JSON.parse(JSON.stringify({ d1: s })));
  ok(JSON.stringify(back[0]) === JSON.stringify(s), "flag round trip");
}

/* B */
{
  const f = M.cleanStroke({ id: "f1", k: "fire", s: 0.9, r: 60, p: [300, 300, 340, 310], q: 1000, lv: 2, sm: 2 });
  const d = dust("d1", "car", 2, [250, 320, 700, 330]);
  const A = M.areasOf([f, d], geo, P, 2000);
  ok(A.length === 2 && A.some((a) => a.style === "dust") && A.some((a) => a.style === "fire"), "dust and fire keep separate areas");
  const da = A.find((a) => a.style === "dust");
  ok(da.strokes.every((s) => s.k !== "fire"), "no fire stroke in a dust area");
  const e = M.cleanStroke({ id: "e1", k: "erase", s: 1, r: 40, p: [400, 325], q: 3000 });
  const A2 = M.areasOf([f, d, e], geo, P, 3500);
  ok(A2.find((a) => a.style === "dust").strokes.some((s) => s.id === "e1"), "an eraser joins the dust area it touches");
  const k1 = M.areasOf([d], geo, P, 1100).find((a) => a.style === "dust").key, k2 = M.areasOf([d], geo, P, 60000).find((a) => a.style === "dust").key;
  ok(M.phaseOf(d, 1100, geo, P) === "grow" && M.phaseOf(d, 60000, geo, P) === "on" && k1 === k2, "dust key ignores the phase");
  const k3 = M.areasOf([{ ...d, lv: 3 }], geo, P, 60000)[0].key, k4 = M.areasOf([{ ...d, dk: "bike" }], geo, P, 60000)[0].key;
  ok(k3 !== k2 && k4 !== k2, "dust key follows level and kind");
  const two = M.areasOf([d, dust("d2", "bike", 1, [1500, 1500, 1800, 1500])], geo, P, 2000);
  ok(two.length === 2, "far dust strokes stay apart");
}

/* C */
{
  const d = dust("d1", "car", 3, [200, 300, 500, 330, 900, 300]);
  const area = M.areasOf([d], geo, P, 2000)[0];
  const f1 = M.raster(area, geo, P), f2 = M.raster(area, geo, P);
  ok(f1.style === "dust" && Buffer.compare(Buffer.from(f1.cell.buffer), Buffer.from(f2.cell.buffer)) === 0 && Buffer.compare(Buffer.from(f1.em.buffer), Buffer.from(f2.em.buffer)) === 0, "field deterministic");
  // kick times along the path at the kind's speed (cells / s = v x g)
  const cellAt = (x, y) => { const cx = Math.floor((x - geo.ox) / geo.ap) - area.rect.x0, cy = Math.floor((y - geo.oy) / geo.ap) - area.rect.y0; return (cy * f1.w + cx) * 4; };
  const k0 = f1.cell[cellAt(200, 300)], k1 = f1.cell[cellAt(500, 330)];
  const len = Math.hypot(300, 30) / geo.ap, want = len / (D.KIND.car.v * g);
  ok(Math.abs(k0 - 0) < 0.05 && Math.abs((k1 - k0) - want) < 0.06, `kick times follow the path (${(k1 - k0).toFixed(3)} vs ${want.toFixed(3)})`);
  ok(f1.cell[cellAt(500, 330) + 1] >= D.NONE, "no out time while it lingers");
  // every emitter's whole reach inside the rectangle
  let inside = true;
  const L = D.look(d), hwC = d.r / geo.ap, laneMax = Math.max(0, ...L.lanes(hwC, g).map(Math.abs));
  for ( let i = 0; i < f1.emN; i++ ) {
    const o = ((i >> 10) * f1.emW + (i & 1023) * 3) * 4, x = f1.em[o], y = f1.em[o + 1], R = D.reachCells(d, geo) - 3 - laneMax;
    if ( x - R < -1 || y - R < -1 || x + R > f1.w + 1 || y + R > f1.h + 1 ) inside = false;
  }
  ok(inside && f1.emN > 20, `every emitter's reach inside the area (${f1.emN} emitters)`);
  // tile lists: each emitter listed in every tile its reach box touches
  const listed = new Map();
  for ( let t = 0; t < f1.tw * f1.th; t++ ) { const s = f1.tileH[t * 4], c = f1.tileH[t * 4 + 1]; for ( let k = 0; k < c; k++ ) { const e = f1.idx[s + k]; (listed.get(e) ?? listed.set(e, new Set()).get(e)).add(t); } }
  let full = true, maxT = 0;
  for ( let t = 0; t < f1.tw * f1.th; t++ ) maxT = Math.max(maxT, f1.tileH[t * 4 + 1]);
  for ( let i = 0; i < f1.emN && full; i++ ) {
    const o = ((i >> 10) * f1.emW + (i & 1023) * 3) * 4, x = f1.em[o], y = f1.em[o + 1];
    const tx = Math.min(f1.tw - 1, Math.max(0, Math.floor(x / D.TILE))), ty = Math.min(f1.th - 1, Math.max(0, Math.floor(y / D.TILE)));
    if ( !listed.get(i)?.has(ty * f1.tw + tx) ) full = false;
  }
  ok(full && maxT <= D.MAX_PER_TILE, `tile lists complete, bounded (${maxT} <= ${D.MAX_PER_TILE})`);
  // put out: o -> out time everywhere it reaches
  const area2 = M.areasOf([{ ...d, o: 5000 }], geo, P, 5100)[0], fo = M.raster(area2, geo, P);
  ok(Math.abs(fo.cell[cellAt(500, 330) + 1] - 4) < 1e-3, "put-out time in the cells (s since ref)");
  // an eraser painted after the dust puts it out there; one painted before does not
  const eA = M.cleanStroke({ id: "eA", k: "erase", s: 1, r: 30, p: [500, 330], q: 4000 });
  const eB = M.cleanStroke({ id: "eB", k: "erase", s: 1, r: 30, p: [500, 330], q: 500 });
  const fa = M.raster(M.areasOf([d, eA], geo, P, 4100).find((a) => a.style === "dust"), geo, P);
  const fb = M.raster(M.areasOf([d, eB], geo, P, 4100).find((a) => a.style === "dust"), geo, P);
  ok(Math.abs(fa.cell[cellAt(500, 330) + 1] - 3) < 1e-3 && fa.cell[cellAt(200, 300) + 1] >= D.NONE, "an eraser after the dust puts out only what it covers");
  ok(fb.cell[cellAt(500, 330) + 1] >= D.NONE, "an eraser painted before the dust does not");
  // an undone eraser (o set): the dust went out at its paint time and eases back at its undo - no out time from it, a back time
  const eU = { ...eA, o: 6000 };
  const fu = M.raster(M.areasOf([d, eU], geo, P, 6100).find((a) => a.style === "dust"), geo, P), iu = cellAt(500, 330);
  ok(fu.back && Math.abs(fu.cell[iu + 1] - 3) < 1e-3 && Math.abs(fu.back[iu] - 5) < 1e-3 && fu.back[iu + 1] >= D.NONE, "an undone eraser: out at its paint, back at its undo, then on");
  ok(fu.cell[cellAt(200, 300) + 1] >= D.NONE && fu.back[cellAt(200, 300)] >= D.NONE, "an undone eraser leaves the dust it never covered alone");
  ok(!fa.back, "no back plane without an undone eraser");
  let eBack = 0;
  for ( let i = 0; i < fu.emN; i++ ) { const o = ((i >> 10) * fu.emW + (i & 1023) * 3) * 4 + 8; if ( Math.abs(fu.em[o + 1] - 5) < 1e-3 ) eBack++; }
  ok(eBack > 0, `emitters under the undone eraser carry its back time (${eBack})`);
  // thinning keeps the bound for a dense heavy drag over itself
  const zig = [];
  for ( let i = 0; i < 40; i++ ) zig.push(300 + (i % 2) * 40, 300 + i * 6);
  const fz = M.raster(M.areasOf([dust("dz", "heavy", 3, zig, { r: 120 })], geo, P, 2000)[0], geo, P);
  let mz = 0; for ( let t = 0; t < fz.tw * fz.th; t++ ) mz = Math.max(mz, fz.tileH[t * 4 + 1]);
  ok(mz <= D.MAX_PER_TILE, `dense strokes thinned evenly to the bound (${mz}, keep ${fz.thin.toFixed(2)})`);
  // a click (one point): a ring of emitters
  const fc = M.raster(M.areasOf([dust("dc", "drag", 2, [400, 400])], geo, P, 2000)[0], geo, P);
  ok(fc.emN >= 4, "a single point gives a ring of emitters");
}

/* D */
{
  const d = dust("d1", "drag", 2, [200, 300, 900, 300]);
  const pass = D.passMs(d, geo);
  ok(Math.abs(pass - 1000 * (700 / geo.ap) / (D.KIND.drag.v * g)) < 1, "pass time from the kind's speed");
  ok(M.phaseOf(d, 1000 + pass * 0.5, geo, P) === "grow" && M.phaseOf(d, 1000 + pass + 5000, geo, P) === "on", "grow while kicking, then on");
  const o = { ...d, o: 20000 }, end = D.dustEnd(o, geo);
  ok(M.phaseOf(o, 20100, geo, P) === "out" && M.phaseOf(o, end + 1, geo, P) === "gone", "out, then gone");
  ok(end - 20000 >= 1000 * D.LIN_L * 1.15 && end - 20000 >= 1000 * D.KIND.drag.life[2] * 1.15 && end - 20000 >= 2800, "gone only after the last puff, haze and marks are over");
  ok(M.goneAt([o], end + 1, geo, P).length === 1, "the GM removes it then");
}

/* E */
{
  const T = D.kindTable();
  ok(T.length === 6 && T.every((a) => a.length === D.CODES * 4) && D.CODES >= D.DUST_KINDS.length * 4, `${D.CODES} codes x 6 vec4`);
  // (the kinds that travel keep their old rise / jet rates: their look is unchanged by the hits kind)
  ok(["bike", "car", "drag", "heavy"].every((dk, ki) => [1, 2, 3].every((lv) => T[4][(ki * 4 + lv) * 4] === Math.fround(1.1) && T[4][(ki * 4 + lv) * 4 + 1] === 4 && T[4][(ki * 4 + lv) * 4 + 2] === 0)), "old kinds: rise 1.1, jet 4, not hits");
  ok(T[4][(4 * 4 + 3) * 4 + 2] === 1, "hits flagged in the table");
  for ( const dk of D.DUST_KINDS ) {
    const L = [1, 2, 3].map((lv) => D.look({ dk, lv }));
    ok(L[0].pr < L[1].pr && L[1].pr < L[2].pr && L[0].grit < L[2].grit && L[0].aura < L[2].aura && L[0].auraA <= L[2].auraA, `${dk}: levels grade`);
  }
  ok(D.look({ dk: "bike", lv: 2 }).v > D.look({ dk: "drag", lv: 2 }).v && D.look({ dk: "heavy", lv: 2 }).pr > D.look({ dk: "drag", lv: 2 }).pr, "kinds differ as described");
}

console.log(fails ? `FAILED ${fails}/${n}` : `ok dust model: ${n}/${n} checks`);
process.exit(fails ? 1 : 0);
