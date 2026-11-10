// Look settings belong to the strokes (stroke-params.mjs):   node dev/destruction-params.test.mjs
//  1. a stroke baked with its own `pr` is byte-identical to the same stroke baked under a scene whose settings are those values (old way);
//  2. in a scene that pins, changing a look setting changes no stroke signature, no bake key and no base key; "apply to existing"
//     (withPin) changes exactly the strokes it names;
//  3. a scene from before (settings on the scene, strokes without `pr`) is converted on load: the same pixels, the settings in the strokes;
//  4. destruction redo and the bake watchdog (source level).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.Hooks ??= { on() {}, once() {}, callAll() {} };
globalThis.foundry ??= { utils: { deepClone: (v) => structuredClone(v) } };
globalThis.canvas = { dimensions: { sceneRect: { x: 0, y: 0, width: 4000, height: 3000 } }, grid: { size: 100 } };
globalThis.game ??= {};
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const Core = await imp("scripts/destruction/core.mjs"), Model = await imp("scripts/destruction/model.mjs"), Store = await imp("scripts/destruction/store.mjs"), Pin = await imp("scripts/destruction/stroke-params.mjs");
let n = 0;
const ok = (c, m) => { if ( !c ) { console.error(`FAIL ${m}`); process.exit(1); } n++; };

const K = 2, AW = 300, AH = 220, MW = AW / K, MH = AH / K;
const hash = (x, y, s) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const data = new Uint8ClampedArray(AW * AH * 4);
for ( let y = 0; y < AH; y++ ) for ( let x = 0; x < AW; x++ ) { const v = hash(x, y, 3) * 30 - 15; data.set([90 + v, 120 + v, 60 + v, 255], (y * AW + x) * 4); }
const MAP = { w: AW, h: AH, data };
function disc(id, t, cx, cy, r, extra = {}) {
  const bx0 = Math.floor(cx - r), by0 = Math.floor(cy - r), w = Math.ceil(cx + r) - bx0 + 1, h = Math.ceil(cy + r) - by0 + 1, bytes = new Uint8Array(w * h);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) { const d = Math.hypot(bx0 + x + 0.5 - cx, by0 + y + 0.5 - cy); if ( d <= r ) bytes[y * w + x] = d < r * 0.6 ? 3 : 2; }
  return { id, k: 0, t, x0: bx0, y0: by0, w, h, bytes, path: null, ...extra };
}
const BASE = { ...Model.PARAM_DEFAULTS };
const bakeOf = (objects, params) => Core.bake({ objects, mw: MW, mh: MH, K, aw: AW, ah: AH, seed: 9, params, map: MAP, mapKey: "p" });
const same = (a, b) => a.sheet.w === b.sheet.w && a.sheet.h === b.sheet.h && Buffer.compare(Buffer.from(a.sheet.data.buffer), Buffer.from(b.sheet.data.buffer)) === 0;

// 1. a stroke's own settings = the scene's settings in the old way
const PR = { jagged: true, jag: 0.9, debris: 1, scatter: 1.6, halo: 0.9 };
const old = bakeOf([disc("a1", 0, 25, 30, 9), disc("b1", 1, 60, 50, 8)], { ...BASE, ...PR });
const pinned = bakeOf([disc("a1", 0, 25, 30, 9, { pr: PR }), disc("b1", 1, 60, 50, 8, { pr: PR })], { ...BASE, pin: true });
ok(same(old, pinned), "pr on the strokes = the same settings on the scene (byte-identical sheet)");
const plain = bakeOf([disc("a1", 0, 25, 30, 9), disc("b1", 1, 60, 50, 8)], { ...BASE });
ok(!same(plain, pinned), "the settings do change the picture");
const ignore = bakeOf([disc("a1", 0, 25, 30, 9, { pr: PR }), disc("b1", 1, 60, 50, 8, { pr: PR })], { ...BASE, pin: true, jagged: false, debris: 0.1, scatter: 0.4 });
ok(same(pinned, ignore), "a scene that pins: its current settings do not reach strokes already painted");
const mixed = bakeOf([disc("a1", 0, 25, 30, 9, { pr: PR }), disc("b1", 1, 60, 50, 8)], { ...BASE, pin: true, jagged: true });
ok(!same(mixed, pinned) && !same(mixed, plain), "strokes with different settings in one bake");

// 2. keys
const scene = { id: "SC", width: 4000, height: 3000 };
const G = Model.blank({ width: 4000, height: 3000 });
const mk = (params, objs) => ({ ...Model.blank({ width: 4000, height: 3000 }), params: { ...Model.PARAM_DEFAULTS, pin: true, ...params }, seed: 5, objects: objs });
const mkObj = (id, x, pr) => {
  const b = new Uint8Array(G.mw * G.mh);
  for ( let y = 5; y < 12; y++ ) for ( let xx = x; xx < x + 7; xx++ ) b[y * G.mw + xx] = 3;
  return Model.makeObject(b, G.mw, { x0: x, y0: 5, x1: x + 6, y1: 11 }, { id, pr });
};
const objs = [mkObj("o1", 10), mkObj("o2", 40, { jagged: true })];
const S1 = mk({}, objs), S2 = mk({ jagged: true, debris: 1, directional: true, scatter: 2, material: "stone", cause: 3, halo: 0.2 }, objs);
ok(Store.makeKey(scene, S1, "bg") === Store.makeKey(scene, S2, "bg"), "changing look settings: the bake key stays");
ok(Store.baseKey(scene, S1, "bg") === Store.baseKey(scene, S2, "bg"), "changing look settings: the base key stays (records, chunks, manifest)");
ok(JSON.stringify(Store.sigsOf(S1).map((s) => s.sig)) === JSON.stringify(Store.sigsOf(S2).map((s) => s.sig)), "changing look settings: no stroke signature changes");
ok(Store.baseKey(scene, mk({}, []), "bg") === Store.baseKey(scene, { ...mk({}, []), params: { ...Model.PARAM_DEFAULTS } }, "bg"), "a scene at the defaults keeps its base key whether it pins or not");
const diff = Pin.pinDiff(S2.params);
ok(diff.jagged === true && diff.jag === undefined && diff.cause === undefined && diff.material === "stone" && diff.scatter === 2, "pinDiff: what differs from the defaults (torn amount only with torn borders, the cause is the stroke's c)");
const newer = Model.withPin(objs[0], diff, 3);
const S3 = mk({}, [newer, objs[1]]);
const sg1 = Store.sigsOf(S1), sg3 = Store.sigsOf(S3);
ok(sg1[0].own !== sg3[0].own && sg1[1].own === sg3[1].own, "apply to existing: only the stroke given changes signature");
const cleared = Model.withPin(newer, undefined, 0);
ok(cleared.pr === undefined && cleared.c === undefined, "withPin with nothing clears the settings");

// 3. a scene from before pinning
const old1 = { ...Model.blank({ width: 4000, height: 3000 }), params: { ...Model.PARAM_DEFAULTS, pin: false, jagged: true, jag: 0.8, cause: 2 }, objects: [mkObj("p1", 10), mkObj("p2", 40)] };
const stamped = Model.pinStrokes({ ...old1, params: { ...old1.params }, objects: old1.objects.slice() });
ok(stamped.params.pin === true && stamped.objects.every((o) => o.pr?.jagged === true && o.pr.jag === 0.8 && o.c === 2), "a scene from before: its settings become the strokes' own");
const legacyBake = bakeOf(old1.objects.map((o) => disc(o.id, o.t, o.x0 + 3, o.y0 + 3, 4, { c: 2 })), old1.params);
const stampedBake = bakeOf(stamped.objects.map((o) => disc(o.id, o.t, o.x0 + 3, o.y0 + 3, 4, { pr: o.pr, c: o.c })), { ...stamped.params });
ok(same(legacyBake, stampedBake), "converting a scene from before: the same pixels");
ok(Model.pinStrokes(stamped) === stamped, "converting twice changes nothing");

// 4. source level: redo and the watchdog
const D = fs.readFileSync(path.join(root, "scripts/destruction/destruction.mjs"), "utf8"), E = fs.readFileSync(path.join(root, "scripts/destruction/editor.mjs"), "utf8"), B = fs.readFileSync(path.join(root, "scripts/destruction/bake.mjs"), "utf8");
ok(/const redoStack = \[\]/.test(D) && /export function redoLast\(\)/.test(D), "a redo stack and redoLast");
ok(/redoStack\.push\(\{ S, o: gone \}\)/.test(D), "an undo puts the stroke on the redo stack");
ok(/S\.objects = \[\.\.\.\(S\.objects \?\? \[\]\), ob\];\s*redoStack\.length = 0;/.test(D), "a new stroke empties the redo stack");
ok(/export function clearAll\(\) \{\s*if \( !S \) return;\s*redoStack\.length = 0;/.test(D), "Clear all empties the redo stack");
ok(/k === "y" \|\| e\.shiftKey \) redoStroke\(\); else undoStroke\(\)/.test(E) && /redo: redoLast/.test(D), "Ctrl+Shift+Z and Ctrl+Y redo in the editor");
ok(/p\.rearm\?\.\(\)/.test(B) && /m\.progress !== undefined \) \{ (clearTimeout\(timer\)|timer\(\)); timer = arm\(\)/.test(B), "a bake that reports progress re-arms the watchdog (own worker and the pool's lanes)");
ok(/const live = changed\.every\(\(k\) => LIVE_PARAMS\.has\(k\) \|\| \(S\.params\.pin && Pin\.PIN_SET\.has\(k\)\)\)/.test(D), "changing a pinned setting bakes nothing");
console.log(`destruction-params: ${n} checks ok`);
