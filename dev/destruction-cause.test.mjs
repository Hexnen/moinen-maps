// Destruction causes: checks of the bake outside Foundry.   node dev/destruction-cause.test.mjs
//  1. cause 0 is the look without causes, proved two ways (no frozen copy of the core: it would go stale with every later change):
//     a. history: for every commit that added or changed cause code, the core of that commit with no cause, c = 0 and a scene default
//        of 0 bakes the same bytes (sheet pixels and placement table) as the core of its parent;
//     b. today: the working-tree core with no cause bakes the same bytes as the working-tree core with every cause commit's change
//        taken back out (reverse patch, dev/lib/baseline.mjs) - so later non-cause changes (tears, flooded holes, ...) are in both;
//  2. determinism: every cause x kind bakes to the same bytes twice (fresh caches), and differs from cause 0;
//  3. independence: a stroke's sprites are the same alone and among overlapping strokes of other causes and kinds;
//  4. the scene default only reaches strokes without a cause of their own (c = 0 + default d == c = d; c = e + default d == c = e);
//  5. emissive causes bake a light sprite (kind 3), the others do not; the base row carries the cause (field 17).
// A new commit that changes cause code in scripts/destruction/*.mjs goes into CAUSE_COMMITS.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { revTree, withoutCommits } from "./lib/baseline.mjs";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = "scripts/destruction";
export const CAUSE_COMMITS = ["291ebda", "7cd5dcd"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-cause-"));
const load = (dir) => import(pathToFileURL(path.join(dir, "core.mjs")).href);
// today's baseline: the working tree minus the cause commits (only the files they touched)
const baseDir = path.join(tmp, "today-base");
fs.mkdirSync(baseDir);
for ( const f of fs.readdirSync(path.join(root, DIR)) ) if ( f.endsWith(".mjs") ) {
  const touched = CAUSE_COMMITS.filter((r) => execFileSync("git", ["diff", "--name-only", `${r}^`, r, "--", `${DIR}/${f}`], { cwd: root }).toString().trim());
  fs.writeFileSync(path.join(baseDir, f), touched.length ? withoutCommits(root, `${DIR}/${f}`, touched) : fs.readFileSync(path.join(root, DIR, f)));
}
const Base = await load(baseDir);
const Cur = await import(pathToFileURL(path.join(root, DIR, "core.mjs")).href);
const HIST = [];
for ( const rev of CAUSE_COMMITS ) {
  HIST.push({ rev, Old: await load(revTree(root, `${rev}^`, DIR, path.join(tmp, `${rev}-parent`))), New: await load(revTree(root, rev, DIR, path.join(tmp, rev))) });
}

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const digest = (...arrs) => { const h = createHash("sha1"); for ( const a of arrs ) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); return h.digest("hex").slice(0, 16); };

/* ---------------------------------------------------------------- a synthetic map: grass | paving | planks */
const K = 2, AW = 360, AH = 260, MW = AW / K, MH = AH / K;
const hash = (x, y, s) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const mapData = new Uint8ClampedArray(AW * AH * 4);
for ( let y = 0; y < AH; y++ ) for ( let x = 0; x < AW; x++ ) {
  const n = hash(x, y, 7) * 30 - 15, o = (y * AW + x) * 4;
  let c;
  if ( x < 120 ) c = [70 + n, 120 + n * 1.3, 52 + n * 0.6];                                  // grass
  else if ( x < 240 ) c = (x % 12 === 0 || y % 10 === 0) ? [70 + n, 68 + n, 66 + n] : [150 + n, 146 + n, 140 + n];   // paving
  else c = (y % 7 === 0) ? [70 + n, 44 + n, 26 + n] : [146 + n + (x % 23) * 0.6, 98 + n, 58 + n];                     // planks
  mapData[o] = c[0]; mapData[o + 1] = c[1]; mapData[o + 2] = c[2]; mapData[o + 3] = 255;
}
const MAP = { w: AW, h: AH, data: mapData };

/* ---------------------------------------------------------------- stroke objects (mask px; levels per pixel) */
function capsule(id, t, x0, y0, x1, y1, r, extra = {}) {
  const bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - r)), by0 = Math.max(0, Math.floor(Math.min(y0, y1) - r));
  const bx1 = Math.min(MW - 1, Math.ceil(Math.max(x0, x1) + r)), by1 = Math.min(MH - 1, Math.ceil(Math.max(y0, y1) + r));
  const w = bx1 - bx0 + 1, h = by1 - by0 + 1, bytes = new Uint8Array(w * h);
  const sx = x1 - x0, sy = y1 - y0, l2 = sx * sx + sy * sy || 1;
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    const px = bx0 + x + 0.5, py = by0 + y + 0.5, tt = Math.max(0, Math.min(1, ((px - x0) * sx + (py - y0) * sy) / l2));
    const d = Math.hypot(px - x0 - sx * tt, py - y0 - sy * tt);
    if ( d <= r ) bytes[y * w + x] = d < r * 0.45 ? 3 : d < r * 0.75 ? 2 : 1;
  }
  const path = (x0 !== x1 || y0 !== y1) ? [[x0 * K, y0 * K], [(x0 + x1) * K / 2, (y0 + y1) * K / 2], [x1 * K, y1 * K]] : null;
  return { id, k: 0, t, x0: bx0, y0: by0, w, h, bytes, path, ...extra };
}
const PARAMS = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", jagged: false, jag: 0.6, directional: false, anim: true, idle: true, fxWho: "all", entry: true, entrySpeed: 1, entryPower: 1 };
const input = (objects, params = {}, seed = 4242) => ({ objects, mw: MW, mh: MH, K, aw: AW, ah: AH, seed, params: { ...PARAMS, ...params }, map: MAP, mapKey: "test-map" });
const bytesOf = (res) => digest(res.sheet.data, res.meta);

/** Per area of a bake: a digest of its rows (minus packing fields) and its sprites' pixels, keyed by the area's hash. */
function areasOf(res) {
  const F = Cur.META_FIELDS, m = res.meta, n = m.length / F, out = new Map();
  let cur = null;
  for ( let k = 0; k < n; k++ ) {
    const o = k * F, row = Int16Array.from(m.subarray(o, o + F));
    if ( row[0] === 0 ) { cur = { hash: ((row[12] & 0xffff) | ((row[13] & 0xffff) << 16)) >>> 0, parts: [] }; out.set(cur.hash, cur); row[16] = 0; }
    if ( row[0] === 1 ) row[11] &= 15;
    const sx = row[1], sy = row[2], w = row[3], h = row[4];
    row[1] = row[2] = 0;
    const px = new Uint8Array(w * h * 4);
    for ( let y = 0; y < h; y++ ) px.set(res.sheet.data.subarray(((sy + y) * res.sheet.w + sx) * 4, ((sy + y) * res.sheet.w + sx + w) * 4), y * w * 4);
    cur.parts.push(digest(row, px));
  }
  for ( const a of out.values() ) a.d = a.parts.join("");
  return out;
}

/* ---------------------------------------------------------------- the strokes */
const strokes = [];
let sid = 0;
for ( let t = 0; t < 6; t++ ) {
  const cx = [60, 180, 300][t % 3], cy = t < 3 ? 70 : 190;
  strokes.push({ ob: capsule(`s${sid++}`, t, cx / K, cy / K, cx / K, cy / K, 11), p: {} });                               // a disc
  strokes.push({ ob: capsule(`s${sid++}`, t, (cx - 40) / K, (cy + 20) / K, (cx + 30) / K, (cy - 10) / K, 6), p: { jagged: true } });   // a torn stroke
  strokes.push({ ob: capsule(`s${sid++}`, t, (cx - 40) / K, (cy - 20) / K, (cx + 40) / K, (cy + 15) / K, 5), p: { directional: true } }); // a followed stroke
}

/* 1. cause 0 = the look without causes */
function sameAsBase(Old, New, label) {
  let same = 0;
  for ( const { ob, p } of strokes ) {
    const b = Old.bake(input([ob], p)), c0 = New.bake(input([ob], p)), c1 = New.bake(input([{ ...ob, c: 0 }], { ...p, cause: 0 }));
    const ok = bytesOf(b) === bytesOf(c0) && bytesOf(b) === bytesOf(c1);
    if ( ok ) same++; else check(false, `${label}: stroke ${ob.id} (kind ${New.TYPES[ob.t]}${p.jagged ? ", torn" : ""}${p.directional ? ", followed" : ""}) differs with cause 0`);
  }
  check(same === strokes.length, `${label}: cause 0 is bit-identical, ${same}/${strokes.length} strokes (every kind, plain, torn, followed)`);
  const several = strokes.slice(0, 6).map((s) => s.ob).concat(strokes.slice(15, 18).map((s) => s.ob));
  check(bytesOf(Old.bake(input(several))) === bytesOf(New.bake(input(several))), `${label}: a bake of several overlapping strokes is bit-identical too`);
}
for ( const { rev, Old, New } of HIST ) sameAsBase(Old, New, `commit ${rev} vs its parent`);
sameAsBase(Base, Cur, "working tree vs working tree without the cause commits");

/* 2. determinism, and every cause changes the look */
let det = 0, diff = 0, total = 0, lights = 0;
const EMISSIVE = new Set(["fire", "acid", "lightning", "arcane"]);
const discs = strokes.filter((_, i) => i % 3 === 0);
for ( let c = 1; c < Cur.CAUSES.length; c++ ) for ( const { ob } of discs ) {
  total++;
  const a = Cur.bake(input([{ ...ob, c }])), b = Cur.bake(input([{ ...ob, c }]), new Map());
  if ( bytesOf(a) === bytesOf(b) ) det++; else check(false, `cause ${Cur.CAUSES[c]} x ${Cur.TYPES[ob.t]} is not deterministic`);
  const z = Cur.bake(input([ob]));
  if ( bytesOf(a) !== bytesOf(z) ) diff++; else check(false, `cause ${Cur.CAUSES[c]} x ${Cur.TYPES[ob.t]} looks like cause 0`);
  let hasLight = false, base17 = -1;
  for ( let k = 0; k < a.meta.length; k += Cur.META_FIELDS ) { if ( a.meta[k] === 3 ) hasLight = true; if ( a.meta[k] === 0 ) base17 = a.meta[k + 11] >> 4; }
  // the tear (gash) is baked by tear.mjs: it takes the cause's palette but not its emissive specks
  const wantLight = EMISSIVE.has(Cur.CAUSES[c]) && Cur.TYPES[ob.t] !== "gash";
  if ( hasLight === wantLight && base17 === c ) lights++;
  else check(false, `cause ${Cur.CAUSES[c]} x ${Cur.TYPES[ob.t]}: light sprite ${hasLight}, cause on the base row = ${base17}`);
}
check(det === total, `every cause x kind is deterministic: ${det}/${total}`);
check(diff === total, `every cause x kind differs from cause 0: ${diff}/${total}`);
check(lights === total, `light sprites only for emissive causes, cause on the base row: ${lights}/${total}`);

/* 3. independence: a stroke alone == the same stroke among others (other causes and kinds over it, a fresh cache) */
const A = { ...capsule("A", 0, 90, 35, 90, 35, 12), c: 1 };
const B = { ...capsule("B", 1, 100, 40, 125, 55, 8), c: 8 };
const Cc = { ...capsule("C", 4, 30, 100, 60, 110, 5), c: 3 };
const Dd = { ...capsule("D", 5, 70, 30, 110, 40, 4), c: 6 };
const alone = areasOf(Cur.bake(input([A])));
let indep = 0;
for ( const order of [[A, B, Cc, Dd], [Dd, A, Cc, B], [B, Cc, Dd, A]] ) {
  const together = areasOf(Cur.bake(input(order), new Map()));
  const ok = [...alone.values()].every((a) => together.get(a.hash)?.d === a.d);
  if ( ok ) indep++;
}
check(indep === 3, `a stroke's sprites are the same alone and among overlapping strokes of other causes (3 orders): ${indep}/3`);
const warm = new Map();
Cur.bake(input([A, B]), warm);
const before = warm.size;
const r2 = Cur.bake(input([A, B, Cc]), warm);
check(r2.stats.reused === before && r2.stats.baked >= 1, `adding a stroke bakes only it (reused ${r2.stats.reused}, baked ${r2.stats.baked})`);
const B2 = { ...B, c: 9 };
const r3 = Cur.bake(input([A, B2, Cc]), warm);
check(r3.stats.baked >= 1 && r3.stats.reused >= 2, `changing one stroke's cause re-bakes only that stroke (reused ${r3.stats.reused}, baked ${r3.stats.baked})`);

/* 4. the scene default */
const ob0 = strokes[0].ob;
check(bytesOf(Cur.bake(input([ob0], { cause: 4 }))) === bytesOf(Cur.bake(input([{ ...ob0, c: 4 }]))), "a stroke without a cause takes the scene default");
check(bytesOf(Cur.bake(input([{ ...ob0, c: 2 }], { cause: 4 }))) === bytesOf(Cur.bake(input([{ ...ob0, c: 2 }]))), "a stroke with its own cause ignores the scene default");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
