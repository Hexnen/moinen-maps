// F1 - THE CONTINUOUS FIRE LEVEL (dev/fire-slider-design.md), offline:   node dev/fire-slider.test.mjs
//  1. IDENTITY: whole-level strokes (1 / 2 / 3, mixed, raised over an older stroke, at rest and catching) give the same field bytes,
//     aux, old-level, puff mask, emitters and lights as the model before F1 (git 94659bc, built with dev/lib/baseline.mjs revTree);
//  2. the level code (model.levelCode) and its decode (levelOfCode, art.mjs levelAt's integer maths) round-trip every 0.05 step;
//  3. lightLevel is the old Math.round for whole levels and continuous across fractional ones;
//  4. the level's ramp: levelNow is continuous and ends exactly on lv, rampAt holds it to the tail, areasOf decorates and rebuilds;
//  5. MIGRATION: old strokes (int lv, no l0 / lt / lr, junk values) read as before; ramp keys are cleaned;
//  6. continuity: field heat and flame height are monotonic and continuous in the level (no step anywhere between 1 and 3).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { revTree } from "./lib/baseline.mjs";
import * as M from "../scripts/fire/model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-fire-f1-"));
let O;
try {
  revTree(root, "94659bc", "scripts/fire", tmp);
  O = await import(pathToFileURL(path.join(tmp, "model.mjs")).href);
} finally { /* (removed at the end) */ }

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if ( !c ) { fails++; console.log(`FAIL ${msg}`); } };
const same = (a, b) => { if ( a === b ) return true; if ( !a || !b || a.length !== b.length ) return false; for ( let i = 0; i < a.length; i++ ) if ( a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i])) ) return false; return true; };

/* ---------------- 1. identity at whole levels ---------------- */
const geos = [{ ap: 3, ox: 100, oy: 100, grid: 96 }, { ap: 1, ox: 0, oy: 0, grid: 40 }];
const sets = {
  levels: [1, 2, 3].map((lv, k) => ({ id: `l${lv}`, k: "fire", s: 0.85, r: 50, p: [300 + 500 * k, 300, 380 + 500 * k, 330], wd: 0, ws: 0.3, lv, sm: (lv + 1) % 4, q: 10 + k })),
  mixed: [
    { id: "m1", k: "fire", s: 0.9, r: 60, p: [300, 300, 420, 330], wd: 0, ws: 0.4, lv: 1, sm: 2, q: 1 },
    { id: "m2", k: "fire", s: 0.7, r: 40, p: [360, 320, 380, 300], wd: 90, ws: 0.2, lv: 3, sm: 3, q: 2 },
    { id: "m3", k: "smoke", s: 0.8, r: 40, p: [380, 250, 400, 240], wd: 0, ws: 0.2, lv: 2, sm: 2, q: 3 },
    { id: "m4", k: "erase", s: 1, r: 20, p: [360, 320], q: 4 }
  ],
  // (a level 3 stroke painted over an older level 1 one: the raised-cell blend, auxOld G)
  raised: [
    { id: "r1", k: "fire", s: 0.8, r: 70, p: [300, 300, 500, 300], wd: 0, ws: 0, lv: 1, sm: 1, q: 1, g: 1000 },
    { id: "r2", k: "fire", s: 1, r: 40, p: [380, 300, 420, 310], wd: 0, ws: 0, lv: 3, sm: 2, q: 2, g: 20000 }
  ],
  fireball: [{ id: "f1", k: "fire", s: 0.9, r: 60, p: [300, 300, 400, 320], wd: 0, ws: 0.4, lv: 3, sm: 2, st: "fireball", q: 1 }]
};
const keyOf = (f) => ["data", "aux", "auxOld", "puff", "times"].map((k) => [k, f[k]]);
for ( const geo of geos ) for ( const [name, raw] of Object.entries(sets) ) for ( const now of [undefined, 21000, 60000] ) {
  const P1 = O.cleanParams({}), P2 = M.cleanParams({});
  const A1 = O.areasOf(raw.map(O.cleanStroke), geo, P1, now), A2 = M.areasOf(raw.map(M.cleanStroke), geo, P2, now);
  ok(A1.length === A2.length && A1.every((a, i) => a.key === A2[i].key), `${name} @${now}: the same areas and keys`);
  const items1 = [], items2 = [];
  for ( let i = 0; i < Math.min(A1.length, A2.length); i++ ) {
    const f1 = O.raster(A1[i], geo, P1), f2 = M.raster(A2[i], geo, P2);
    items1.push({ area: A1[i], field: f1 }); items2.push({ area: A2[i], field: f2 });
    for ( const [k, v] of keyOf(f1) ) ok(same(v, f2[k]), `${name} @${now} ${A1[i].id}: ${k} bytes identical`);
    ok(!f2.ramp, `${name}: no ramp texture without a ramp`);
    ok(JSON.stringify(f1.emit) === JSON.stringify(f2.emit), `${name} @${now}: emitters identical`);
    ok(JSON.stringify(f1.puffQ) === JSON.stringify(f2.puffQ) && JSON.stringify(f1.plume) === JSON.stringify(f2.plume), `${name}: puffQ / plume identical`);
  }
  const L1 = O.lightsOf(items1, geo, P1), L2 = M.lightsOf(items2, geo, P2);
  ok(JSON.stringify(L1) === JSON.stringify(L2), `${name} @${now}: lights identical (${L1.length} / ${L2.length})`);
}

/* ---------------- 2. the level code ---------------- */
const seen = new Set();
for ( let n20 = 0; n20 <= 40; n20++ ) for ( let sm = 0; sm <= 3; sm++ ) {
  const lv = M.cleanLv(1 + n20 * 0.05), c = M.levelCode(lv, sm);
  ok(c >= 1 && c <= 254 && !seen.has(c), `code ${lv}/${sm} = ${c} unique, a byte`);
  seen.add(c);
  ok(Math.abs(M.levelOfCode(c) - lv) < 1e-9, `decode ${c} -> ${M.levelOfCode(c)} (${lv})`);
  // art.mjs levelAt: code - 1 < 12: clamp(code / 4 + 1); else q = (code - 13) / 4, 1 + (q + 1 + q / 19) x 0.05 (int maths)
  const cc = c - 1, q = Math.trunc((cc - 12) / 4), g = cc < 12 ? Math.min(3, Math.max(1, Math.trunc(cc / 4) + 1)) : 1 + (q + 1 + Math.trunc(q / 19)) * 0.05;
  ok(Math.abs(g - lv) < 1e-6, `GLSL decode ${c} -> ${g} (${lv})`);
  if ( Number.isInteger(lv) ) ok(c === 1 + (lv - 1) * 4 + sm, `whole level ${lv}: the old code`);
}
ok(M.levelOfCode(0) === 2, "code 0 reads as level 2 (as before)");

/* ---------------- 3. lightLevel ---------------- */
for ( const [sum, m] of [[2, 1], [5, 2], [7, 3], [3, 2], [9, 4]] ) ok(M.lightLevel(sum, m) === Math.min(3, Math.max(1, Math.round(sum / m))), `lightLevel(${sum}, ${m}) = old round`);
{
  let prev = M.lightLevel(1, 1, null), mono = true, maxStep = 0;
  for ( let k = 1; k <= 40; k++ ) { const lv = M.cleanLv(1 + k * 0.05), v = M.lightLevel(lv, 1, Number.isInteger(lv) ? null : { [lv]: 1 }); if ( v < prev - 1e-9 ) mono = false; maxStep = Math.max(maxStep, v - prev); prev = v; }
  ok(mono && maxStep <= 0.051 && Math.abs(prev - 3) < 1e-9, `lightLevel continuous and monotonic over 1..3 (max step ${maxStep.toFixed(3)})`);
}

/* ---------------- 4. ramps ---------------- */
{
  const st = M.cleanStroke({ id: "x", k: "fire", s: 1, r: 40, p: [0, 0], lv: 3, l0: 1, lt: 10000 });
  ok(st.l0 === 1 && st.lt === 10000 && st.lr === undefined, "a ramp's keys kept (default length dropped)");
  ok(M.levelNow(st, 9000) === 1 && M.levelNow(st, 10000) === 1 && M.levelNow(st, 14000) === 3 && M.levelNow(st, 99999) === 3, "levelNow: l0 before, lv after");
  let prev = 1, maxStep = 0;
  for ( let t = 10000; t <= 14000; t += 20 ) { const v = M.levelNow(st, t); maxStep = Math.max(maxStep, Math.abs(v - prev)); prev = v; }
  ok(maxStep < 0.016, `levelNow continuous along the ramp (max step ${maxStep.toFixed(4)} per 20 ms)`);
  ok(M.rampAt(st, 12000) && M.rampAt(st, 14000 + M.LV_TAIL_MS - 1) && !M.rampAt(st, 14000 + M.LV_TAIL_MS + 1), "rampAt holds the ramp through its tail, then not");
  const geo = geos[1], P = M.cleanParams({});
  const a1 = M.areasOf([st], geo, P, 12000), a2 = M.areasOf([st], geo, P, 30000);
  ok(a1[0].strokes[0].rl && !a2[0].strokes[0].rl && a1[0].key !== a2[0].key, "areasOf: a ramping stroke is decorated (rl) and the area rebuilds after the tail");
  ok(M.nextChange([st], 12000, geos[1], M.cleanParams({})) <= 14000 + M.LV_TAIL_MS, "nextChange wakes the layer for the ramp's end");
  const f1 = M.raster(a1[0], geo, P), f2 = M.raster(a2[0], geo, P);
  ok(f1.ramp && f1.rampQ && !f2.ramp, "the ramp texture exists only while the ramp runs");
  ok(same(f1.data, f2.data), "the field during the ramp is the steady one at lv (the ramp is the GPU's)");
  let cells = 0, okR = true;
  for ( let i = 0; i < f1.ramp.length; i += 4 ) if ( f1.ramp[i] ) { cells++; okR &&= f1.ramp[i] === 1 && f1.ramp[i + 3] === 40; }
  ok(cells > 0 && okR, `ramp texels: from-level 1, length 4.0 s (${cells} cells)`);
  // (the lights carry the ramp: from l0's radius to lv's)
  const L = M.lightsOf([{ area: a1[0], field: f1 }], geo, P);
  ok(L.length && L.every((l) => l.ramp && l.ramp.l0 === 1 && l.level === 3 && l.ramp.r0 < l.radius), "lights carry the ramp (l0, start, length, the smaller radius)");
}

/* ---------------- 5. migration ---------------- */
{
  const old = { id: "o", k: "fire", s: 0.8, r: 40, p: [0, 0, 10, 10], wd: 0, ws: 0, lv: 2, sm: 2, q: 5 };
  ok(JSON.stringify(M.cleanStroke(old)) === JSON.stringify(O.cleanStroke(old)), "an old fire stroke reads exactly as before");
  for ( const lv of [1, 2, 3, "2", null, undefined, 0, 7, "x", 2.4999, 1.97] ) {
    const a = M.cleanStroke({ ...old, lv }), b = O.cleanStroke({ ...old, lv });
    const want = Number.isInteger(b.lv) && (lv === null || lv === undefined || lv === "x" || Number.isInteger(Number(lv)) || Number(lv) < 1 || Number(lv) > 3) ? b.lv : Math.round(Number(lv) * 20) / 20;
    ok(a.lv === want, `lv ${JSON.stringify(lv)} -> ${a.lv} (old ${b.lv})`);
  }
  for ( const k of ["smoke", "dust", "burst"] ) {
    const s = { id: "o", k, s: 0.8, r: 40, p: [0, 0], wd: 0, ws: 0, lv: 2, sm: 2, q: 5, ...(k === "dust" ? { dk: "car" } : {}) };
    ok(JSON.stringify(M.cleanStroke(s)) === JSON.stringify(O.cleanStroke(s)), `an old ${k} stroke reads exactly as before`);
  }
  const j = M.cleanStroke({ ...old, lv: 2.5, l0: "junk", lt: 5, lr: 99 });
  ok(j.lv === 2.5 && j.l0 === undefined && j.lt === undefined && j.lr === undefined, "junk ramp keys dropped");
  const r = M.cleanStroke({ ...old, lv: 2.5, l0: 2.5, lt: 5 });
  ok(r.l0 === undefined, "a ramp to the same level is no ramp");
}

/* ---------------- 6. continuity in the level ---------------- */
{
  const geo = geos[1], P = M.cleanParams({});
  let prevH = -1, prevF = -1, monoH = true, monoF = true, stepH = 0, stepF = 0;
  for ( let k = 0; k <= 40; k++ ) {
    const lv = M.cleanLv(1 + k * 0.05), st = M.cleanStroke({ id: "c", k: "fire", s: 0.8, r: 60, p: [300, 300, 420, 300], wd: 0, ws: 0, lv, sm: 2, q: 1 });
    const a = M.areasOf([st], geo, P)[0], f = M.raster(a, geo, P);
    let F = 0; for ( let i = 0; i < f.data.length; i += 4 ) F += f.data[i];
    const H = M.reachOf ? a.rect.y1 - a.rect.y0 : 0;
    if ( prevF >= 0 ) { if ( F < prevF ) monoF = false; stepF = Math.max(stepF, (F - prevF) / Math.max(1, prevF)); if ( H < prevH ) monoH = false; }
    prevF = F; prevH = H;
  }
  ok(monoF && stepF < 0.05, `field heat grows smoothly with the level (max step ${(stepF * 100).toFixed(1)} %)`);
  ok(monoH, "the area grows (never shrinks) with the level");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`fire-slider: ${n - fails}/${n} checks ok`);
if ( fails ) process.exit(1);
