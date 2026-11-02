// Incremental flags:   node dev/flag-layout.test.mjs
//   1. migration: a layout-2 destruction flag (array `o`, paths inline and in destructionPaths) loads to the same strokes, in the same
//      order, with the same bake key and stroke signatures, before and after the GM's first save writes layout 3 (one key per stroke);
//      loading it twice gives the same objects (deterministic: every client converts the same way);
//   2. a save with nothing changed writes nothing; a new stroke writes its own key (and its path) only; a changed cause one key;
//      an undo one deletion; a setting only that field;
//   3. water: each mask has its own key and only a changed mask is written; nothing changed, nothing written.
// The updates are applied by a small model of Foundry's update (dot keys, ForcedDeletion and "-=" deletions, objects merged).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
class ForcedDeletion {}
globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
globalThis.foundry = { data: { operators: { ForcedDeletion } }, utils: { deepClone: (v) => structuredClone(v) } };
globalThis.canvas = { dimensions: { sceneRect: { x: 0, y: 0, width: 1200, height: 800 } }, grid: { size: 100 } };
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const Model = await imp("scripts/destruction/model.mjs");
const Store = await imp("scripts/destruction/store.mjs");
const Water = await imp("scripts/water/model.mjs");
const MID = "moinen-maps";

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };
const J = (v) => JSON.stringify(v);

/** Foundry's update of a document's data, enough for flags: dot keys, nested objects merged, deletions. */
function apply(doc, upd) {
  for ( const [key, val] of Object.entries(upd) ) {
    const parts = key.split(".");
    let last = parts.pop(), o = doc;
    for ( const p of parts ) { if ( typeof o[p] !== "object" || o[p] === null ) o[p] = {}; o = o[p]; }
    if ( last.startsWith("-=") ) { delete o[last.slice(2)]; continue; }
    if ( val instanceof ForcedDeletion ) { delete o[last]; continue; }
    merge(o, last, structuredClone(val));
  }
  return doc;
}
function merge(o, k, v) {
  if ( v && typeof v === "object" && !Array.isArray(v) && o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ) {
    for ( const [kk, vv] of Object.entries(v) ) { if ( kk.startsWith("-=") ) delete o[k][kk.slice(2)]; else merge(o[k], kk, vv); }
  } else o[k] = v;
}

/* ---------------------------------------------------------------- a layout-2 scene */
const S0 = Model.blank({ width: 1200, height: 800 });
const rnd = ((s) => () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)(7);
const objs = [];
for ( let k = 0; k < 7; k++ ) {
  const buf = new Uint8Array(S0.mw * S0.mh), x0 = 5 + Math.floor(rnd() * 100), y0 = 5 + Math.floor(rnd() * 60), w = 6 + (k % 4), h = 5 + (k % 3);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) if ( rnd() < 0.8 ) buf[(y0 + y) * S0.mw + x0 + x] = 1 + (k + x + y) % 3;
  const o = Model.makeObject(buf, S0.mw, { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 }, { id: `obj${k}x`, type: k % 6, erase: k === 4, cause: k % 3 === 0 ? 0 : k, path: k === 5 ? [1, 2, 0, 9, 9, 40] : null });
  objs.push(o);
}
// stroke 2's path lives in destructionPaths (as the current code stores it), stroke 5 keeps it inline (the first stroke-object build)
const v2 = { v: 2, ap: S0.ap, seed: 4242, enabled: true, params: { ...Model.PARAM_DEFAULTS, directional: true }, m: null, blast: null, entries: [],
  o: objs.map((o) => { const c = structuredClone(o); return c; }), baked: { v: 2, dir: "d", base: "b", key: "k", c: { obj0x: "s:id0" } } };
const scene = { id: "SCN", width: 1200, height: 800, flags: { [MID]: { destruction: v2, destructionPaths: { obj2x: [5, 5, 0, 20, 20, 30] } } } };
const load = (sc) => Store.attachPaths(Model.load(sc), sc);
const sig = (S, sc) => ({ key: Store.makeKey(sc, S, "bg.webp"), sigs: S.objects.map((o) => `${o.id}:${Store.objSig(S, o)}`).join(" ") });
const view = (S) => J(S.objects.map(({ s, ...o }) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a < b ? -1 : 1))));

const A = load(scene), A2 = load(structuredClone(scene));
check(view(A) === view(A2) && J(A.objects.map((o) => o.s)) === J(A2.objects.map((o) => o.s)), "layout 2 loads the same objects and places twice (deterministic)");
check(A.objects.map((o) => o.id).join() === objs.map((o) => o.id).join(), "layout 2: the strokes in their stored order");
const before = sig(A, scene);

/* ---------------------------------------------------------------- the GM's first save: layout 3 */
const up1 = Store.flagUpdate(A, scene);
apply(scene, up1);
const F = scene.flags[MID];
check(F.destruction.v === 3 && F.destruction.o == null, `the first save writes layout 3 (v ${F.destruction.v}, o ${J(F.destruction.o)})`);
check(Object.keys(F.destructionObjects ?? {}).length === objs.length && J(F.destructionObjects.obj5x.p) === J([1, 2, 0, 9, 9, 40]) && J(F.destructionObjects.obj2x.p) === J([5, 5, 0, 20, 20, 30]), "every stroke under its own key, its path with it (an old-code tab rewrites destructionPaths, never these)");
check(J(F.destructionPaths.obj5x) === J([1, 2, 0, 9, 9, 40]) && J(F.destructionPaths.obj2x) === J([5, 5, 0, 20, 20, 30]), "the paths in destructionPaths (inline one moved there)");
check(F.destruction.baked?.c?.obj0x === "s:id0", "the manifest is left alone by a save");
const B = load(scene), after = sig(B, scene);
check(view(B) === view(A), "layout 3 loads the same objects in the same order");
check(after.key === before.key && after.sigs === before.sigs, "the same bake key and stroke signatures before and after the migration");
check(Object.keys(Store.flagUpdate(B, scene)).length === 0, "a save with nothing changed writes nothing");

/* ---------------------------------------------------------------- incremental writes */
const buf = new Uint8Array(B.mw * B.mh); buf[40 * B.mw + 40] = 3; buf[40 * B.mw + 41] = 2;
const n = Model.makeObject(buf, B.mw, { x0: 40, y0: 40, x1: 41, y1: 40 }, { id: "newOne1", type: 1, path: [3, 3, 0, 8, 8, 20] });
n.s = Model.nextSeq(B);
B.objects = [...B.objects, n];
const up2 = Store.flagUpdate(B, scene);
check(J(Object.keys(up2).sort()) === J([`flags.${MID}.destructionObjects.newOne1`, `flags.${MID}.destructionPaths.newOne1`]), `a new stroke writes its own key and path only (${Object.keys(up2).length} keys)`);
apply(scene, up2);
check(load(scene).objects.at(-1).id === "newOne1", "the new stroke loads last");
B.objects = B.objects.map((o) => o.id === "obj1x" ? Model.withCause(o, 9) : o);
const up3 = Store.flagUpdate(B, scene);
check(J(Object.keys(up3)) === J([`flags.${MID}.destructionObjects.obj1x`]), "a changed cause writes one key");
apply(scene, up3);
B.objects = B.objects.slice(0, -1);
const up4 = Store.flagUpdate(B, scene);
const k4 = Object.keys(up4).sort();
check(k4.length === 2 && k4.every((k) => up4[k] instanceof ForcedDeletion), `an undo deletes its key and its path (${k4.join(", ")})`);
apply(scene, up4);
check(!("newOne1" in scene.flags[MID].destructionObjects) && view(load(scene)) === view(B), "after the undo the scene loads what the GM has");
B.params = { ...B.params, debris: 0.3 };
const up5 = Store.flagUpdate(B, scene);
check(J(Object.keys(up5)) === J([`flags.${MID}.destruction.params`]), "a setting writes only the settings");
// strokes painted after an undo take the next place; ties (two GMs) fall back to the id
const C = load(apply(structuredClone(scene), { [`flags.${MID}.destructionObjects.zz`]: { ...structuredClone(scene.flags[MID].destructionObjects.obj6x), id: "zz" }, [`flags.${MID}.destructionObjects.aa`]: { ...structuredClone(scene.flags[MID].destructionObjects.obj6x), id: "aa" } }));
check(C.objects.slice(-3).map((o) => o.id).join() === "aa,obj6x,zz", "equal places sort by id (the same on every client)");
// a broken entry is skipped, not fatal
const D = load(apply(structuredClone(scene), { [`flags.${MID}.destructionObjects.bad`]: { id: "bad", w: 0 } }));
check(D.objects.length === load(scene).objects.length, "a broken stroke entry is left out");

/* ---------------------------------------------------------------- water */
const ws = { id: "W", flags: {} };
const W0 = Water.blank({ seed: 1 }, { width: 1200, height: 800, grid: { size: 100 } });
W0.masks.water[5] = 1; W0.masks.river[9] = 1;
const w1 = Water.flagUpdate(W0, ws); apply(ws, w1);
check(["water", "river", "fall"].every((l) => typeof ws.flags[MID].water.m[l] === "string"), "water: the first save writes all three masks");
check(Object.keys(Water.flagUpdate(W0, ws)).length === 0, "water: nothing changed, nothing written");
W0.masks.river[11] = 1;
const w2 = Water.flagUpdate(W0, ws);
check(J(Object.keys(w2)) === J([`flags.${MID}.water.m.river`]), `water: painting the river writes only the river mask (${Object.keys(w2).join(", ")})`);
apply(ws, w2);
const WL = Water.load(ws);
check(WL.masks.river[11] === 1 && WL.masks.water[5] === 1, "water: loads back what was painted");

console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
