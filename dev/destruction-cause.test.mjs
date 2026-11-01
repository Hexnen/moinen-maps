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
import { revTree, withoutCommits, onlyFeature } from "./lib/baseline.mjs";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = "scripts/destruction";
// { rev, other }: a commit that also carries a change of another kind; `other` matches those hunks (left in both baselines)
export const CAUSE_COMMITS = ["291ebda", "7cd5dcd", "c3ea9fe", "7115e86", { rev: "6c9c1c7", other: /CORE_VERSION/ }, { rev: "f0e1afe", other: /CORE_VERSION/ }, { rev: "301412e", other: /CORE_VERSION/ }, "9297084", "007d3a0",
  // the tear's own cause treatments (fire veins, frost crystals, acid edge) came with its reshaping: only the hunks that call the kit are cause code
  { rev: "9a52b7c", other: /^(?![\s\S]*(kit\.|glowHook|frostLines|fireVeins|kglow|causeKit))/ }, { rev: "8163962", other: /CORE_VERSION/ }];   // (50458de was reverted in e5714bb and redone as 7115e86)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mm-cause-"));
const load = (dir) => import(pathToFileURL(path.join(dir, "core.mjs")).href);
// today's baseline: the working tree minus the cause commits (only the files they touched)
const baseDir = path.join(tmp, "today-base");
fs.mkdirSync(baseDir);
for ( const f of fs.readdirSync(path.join(root, DIR)) ) if ( f.endsWith(".mjs") ) {
  const touched = CAUSE_COMMITS.filter((r) => execFileSync("git", ["diff", "--name-only", `${r.rev ?? r}^`, r.rev ?? r, "--", `${DIR}/${f}`], { cwd: root }).toString().trim());
  fs.writeFileSync(path.join(baseDir, f), touched.length ? withoutCommits(root, `${DIR}/${f}`, touched) : fs.readFileSync(path.join(root, DIR, f)));
}
const Base = await load(baseDir);
const Cur = await import(pathToFileURL(path.join(root, DIR, "core.mjs")).href);
const HIST = [];
for ( const r of CAUSE_COMMITS ) {
  const rev = r.rev ?? r, dir = revTree(root, rev, DIR, path.join(tmp, rev));
  // a commit with other changes too: those are taken back out of its tree, so only its cause change is compared with the parent
  if ( r.other ) for ( const f of fs.readdirSync(dir) ) fs.writeFileSync(path.join(dir, f), onlyFeature(root, `${DIR}/${f}`, rev, r.other, fs.readFileSync(path.join(dir, f), "utf8")));
  HIST.push({ rev, Old: await load(revTree(root, `${rev}^`, DIR, path.join(tmp, `${rev}-parent`))), New: await load(dir) });
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
  // the tear (gash, tear.mjs) takes the cause like every kind since 7115e86, its light sprite too
  const wantLight = EMISSIVE.has(Cur.CAUSES[c]);
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
// one-way (substrate.mjs): a stroke never changes because of a NEWER one - it is the same as in a bake of it and the strokes before it
let indep = 0;
for ( const order of [[A, B, Cc, Dd], [Dd, A, Cc, B], [B, Cc, Dd, A]] ) {
  const together = areasOf(Cur.bake(input(order), new Map()));
  let ok = true;
  for ( let k = 0; k < order.length; k++ ) for ( const a of areasOf(Cur.bake(input(order.slice(0, k + 1)), new Map())).values() ) if ( together.get(a.hash)?.d !== a.d ) ok = false;
  if ( ok ) indep++;
}
check(indep === 3, `a stroke's sprites are the same with or without the newer overlapping strokes of other causes (3 orders): ${indep}/3`);
const warm = new Map();
Cur.bake(input([A, B]), warm);
const before = warm.size;
const r2 = Cur.bake(input([A, B, Cc]), warm);
check(r2.stats.reused === before && r2.stats.baked >= 1, `adding a stroke bakes only it (reused ${r2.stats.reused}, baked ${r2.stats.baked})`);
const B2 = { ...B, c: 9 };
const r3 = Cur.bake(input([A, B2, Cc]), warm);
check(r3.stats.baked >= 1 && r3.stats.reused >= 2, `changing one stroke's cause re-bakes only that stroke (reused ${r3.stats.reused}, baked ${r3.stats.baked})`);

/* 3b. tears (gash along a path) x every cause: deterministic, unlike cause 0, and the same alone and under other strokes */
const tear = strokes.find((s) => Cur.TYPES[s.ob.t] === "gash" && s.ob.path).ob;
let tDet = 0, tInd = 0;
const others = [{ ...capsule("O1", 0, tear.x0 + 4, tear.y0 + 3, tear.x0 + 4, tear.y0 + 3, 7), c: 2 }, { ...capsule("O2", 2, tear.x0 + tear.w - 3, tear.y0 + 2, tear.x0 + tear.w + 6, tear.y0 + 8, 5), c: 9 }];
for ( let c = 1; c < Cur.CAUSES.length; c++ ) {
  const ob = { ...tear, c }, a = Cur.bake(input([ob])), b = Cur.bake(input([ob]), new Map());
  if ( bytesOf(a) === bytesOf(b) && bytesOf(a) !== bytesOf(Cur.bake(input([tear]))) ) tDet++; else check(false, `tear x ${Cur.CAUSES[c]}: not deterministic or like cause 0`);
  // newer strokes over it never change it; an older one under it is its substrate (the tear over O1 = the bake of O1 and the tear)
  const alone = areasOf(a), mixed = areasOf(Cur.bake(input([ob, others[1], others[0]]), new Map()));
  const under = areasOf(Cur.bake(input([others[0], ob]), new Map())), mixed2 = areasOf(Cur.bake(input([others[0], ob, others[1]]), new Map()));
  if ( [...alone.values()].every((x) => mixed.get(x.hash)?.d === x.d) && [...under.values()].every((x) => mixed2.get(x.hash)?.d === x.d) ) tInd++; else check(false, `tear x ${Cur.CAUSES[c]}: its sprites change because of newer strokes`);
}
check(tDet === Cur.CAUSES.length - 1, `tear x every cause is deterministic and differs from cause 0: ${tDet}/${Cur.CAUSES.length - 1}`);
check(tInd === Cur.CAUSES.length - 1, `tear x every cause bakes the same sprites whatever newer strokes lie over it: ${tInd}/${Cur.CAUSES.length - 1}`);

/* 4. the scene default */
const ob0 = strokes[0].ob;
check(bytesOf(Cur.bake(input([ob0], { cause: 4 }))) === bytesOf(Cur.bake(input([{ ...ob0, c: 4 }]))), "a stroke without a cause takes the scene default");
check(bytesOf(Cur.bake(input([{ ...ob0, c: 2 }], { cause: 4 }))) === bytesOf(Cur.bake(input([{ ...ob0, c: 2 }]))), "a stroke with its own cause ignores the scene default");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
