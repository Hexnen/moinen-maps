// Destruction flag layout 2 -> 3 and every later save: is a stroke ever lost?     node dev/flag-migration-deep.test.mjs
//   Fixtures: dev/fixtures/destruction-flags/*.json (real flags of test worlds: { destruction, destructionObjects, destructionPaths });
//   MM_FLAGS = another folder of such files to round-trip too (e.g. flags read from a copy of a world's LevelDB).
// Every scenario: load -> the exact scene.update payload the GM writes -> applied by a model of Foundry's update (dot keys,
// ForcedDeletion / "-=", objects merged, arrays replaced) -> load again -> same strokes (ids, order, masks, types, causes, paths), same
// bake key and stroke signatures. The OLD module code (before ad0428d, layout 2) is replicated below (load + flagUpdate) for the
// mixed-version scenarios: a browser tab that loaded the module before the change keeps running the old code until it reloads.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dev = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(dev, "..");
class ForcedDeletion {}
globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call() {} };
globalThis.foundry = { data: { operators: { ForcedDeletion } }, utils: { deepClone: (v) => structuredClone(v) } };
globalThis.canvas = { dimensions: { sceneRect: { x: 0, y: 0, width: 4000, height: 3000 } }, grid: { size: 100 } };
globalThis.game ??= {};
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const Model = await imp("scripts/destruction/model.mjs");
const Store = await imp("scripts/destruction/store.mjs");
const { chunkRecords } = await imp("scripts/water/publish.mjs");
const MID = "moinen-maps", P = `flags.${MID}`;
const J = (v) => JSON.stringify(v);

let failed = 0;
const warned = [];
console.warn = (...a) => warned.push(a.map(String).join(" "));         // the snapshot's console warning, counted below (not printed)
const check =(ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if ( !ok ) failed++; };

/* ---------------------------------------------------------------- Foundry's update, enough for flags */
function apply(doc, upd) {
  for ( const [key, val] of Object.entries(upd) ) {
    const parts = key.split(".");
    const last = parts.pop();
    let o = doc;
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

/* ---------------------------------------------------------------- the OLD code (d179204), in substance */
const Old = {
  load(scene) {
    const f = scene?.flags?.[MID]?.destruction;
    if ( !f || !f.ap ) return null;
    const g = Model.grids(f.ap);
    const S = { ap: f.ap, ...g, mask: new Uint8Array(g.mw * g.mh), seed: Number(f.seed) || 1, params: Model.cleanParams(f.params), enabled: f.enabled !== false,
      blast: f.blast ?? null, baked: f.baked ?? null, rev: 0, entries: Array.isArray(f.entries) ? f.entries : [] };
    S.objects = Array.isArray(f.o) ? f.o.filter((o) => o && o.id && o.w > 0 && o.h > 0) : (f.m ? Model.objectsFromMask(Model.rleDecode(f.m, g.mw * g.mh), g.mw, g.mh) : []);
    Model.composite(S);
    const PP = scene?.flags?.[MID]?.destructionPaths;
    if ( PP && typeof PP === "object" ) S.objects = S.objects.map((o) => (o.p || !Array.isArray(PP[o.id])) ? o : { ...o, p: PP[o.id] });
    return S;
  },
  flagUpdate(S, scene) {
    const data = { v: 2, ap: S.ap, seed: S.seed, enabled: S.enabled, params: S.params, o: S.objects ?? [], m: null, blast: S.blast ?? null, entries: S.entries ?? [], paths: null };
    const paths = {};
    data.o = (data.o ?? []).map((o) => { if ( !o.p ) return o; paths[o.id] = o.p; const { p, ...rest } = o; void p; return rest; });
    const old = scene?.flags?.[MID]?.destructionPaths;
    if ( old && typeof old === "object" ) for ( const id of Object.keys(old) ) if ( !(id in paths) ) paths[`-=${id}`] = null;
    return { [`${P}.destruction`]: data, [`${P}.destructionPaths`]: paths };
  }
};

/* ---------------------------------------------------------------- helpers */
const loadNew = (sc) => Store.attachPaths(Model.load(sc), sc);
const strip = (o) => ({ id: o.id, k: o.k, t: o.t, x0: o.x0, y0: o.y0, w: o.w, h: o.h, m: o.m, c: o.c ?? null, p: o.p ?? null });
const view = (S) => (S?.objects ?? []).map(strip);
const byId = (a) => [...a].sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
const sigs = (S, sc) => ({ key: Store.makeKey(sc, S, "bg.webp"), sigs: S.objects.map((o) => `${o.id}:${Store.objSig(S, o)}`).join(" ") });
const rnd = ((s) => () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)(11);
const G = Model.blank({ width: 4000, height: 3000 });

/** A stroke object like the editor makes (random box of levels; optional path / cause / erase). */
function stroke(id, { erase = false, type = 0, cause = 0, path = null, w = 4 + Math.floor(rnd() * 20), h = 4 + Math.floor(rnd() * 20) } = {}) {
  const buf = new Uint8Array(G.mw * G.mh), x0 = Math.floor(rnd() * (G.mw - w)), y0 = Math.floor(rnd() * (G.mh - h));
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) if ( rnd() < 0.85 ) buf[(y0 + y) * G.mw + x0 + x] = 1 + Math.floor(rnd() * 3);
  return Model.makeObject(buf, G.mw, { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 }, { id, erase, type, cause, path });
}
const rid = () => Array.from({ length: 10 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(rnd() * 62)]).join("");
const chunk = (i) => `d${String(i).padStart(14, "0")}`;
/** A layout-2 scene as the old code saved it (paths in destructionPaths, array `o`), with a manifest naming a chunk per stroke. */
function v2Scene(objs) {
  const S = { ...Model.blank({ width: 4000, height: 3000 }), seed: 777, objects: objs, entries: [], params: { ...Model.PARAM_DEFAULTS, directional: true } };
  const sc = { id: "SCN", width: 4000, height: 3000, flags: { [MID]: {} } };
  apply(sc, Old.flagUpdate(S, sc));
  sc.flags[MID].destruction.baked = { v: 2, dir: "c/SCN", base: "b", key: "k", c: Object.fromEntries(objs.filter((o) => !o.k).map((o, i) => [o.id, `s:${chunk(i)}`])) };
  return sc;
}
/** The full migration round trip: load (new), GM save, apply, load again. */
function migrate(sc) {
  const before = loadNew(sc), k0 = before && sigs(before, sc);
  const upd = Store.flagUpdate(before, sc);
  apply(sc, upd);
  const after = loadNew(sc), k1 = after && sigs(after, sc);
  return { before, after, upd, k0, k1, again: Store.flagUpdate(after, sc) };
}
/** Chunk ids the GC counts as referenced by the scene (the same walk as the GC's). */
const gcRefs = (sc) => new Set(chunkRecords(sc).flatMap((r) => r.ids));
/** Add a stroke the way edited() does. */
const paint = (S, id, opts) => { S.objects = [...S.objects, Object.assign(stroke(id, opts), { s: Model.nextSeq(S) })]; };

/* ================================================================= 1. real flags (fixtures + MM_FLAGS) */
for ( const dir of [path.join(dev, "fixtures", "destruction-flags"), process.env.MM_FLAGS].filter((d) => d && fs.existsSync(d)) ) {
  for ( const n of fs.readdirSync(dir).filter((f) => f.endsWith(".json")) ) {
    const F = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"));
    const sc = { id: "REAL", width: 4000, height: 3000, flags: { [MID]: structuredClone({ destruction: F.destruction, ...(F.destructionObjects ? { destructionObjects: F.destructionObjects } : {}), ...(F.destructionPaths ? { destructionPaths: F.destructionPaths } : {}) }) } };
    const v0 = F.destruction?.v, oldView = (v0 | 0) < 3 ? Old.load(structuredClone(sc)) : null;
    const r = migrate(sc);
    if ( !r.before ) { check(true, `real ${n}: no destruction`); continue; }
    const want = oldView ? J(view(oldView)) : J(view(r.before));
    check(J(view(r.after)) === want, `real ${n}: v${v0} -> v${sc.flags[MID].destruction.v}, ${r.after.objects.length} strokes (${oldView ? oldView.objects.length + " in the old code's view" : r.before.objects.length + " before"}): same ids/order/masks/types/causes/paths`);
    check(r.k0.key === r.k1.key && r.k0.sigs === r.k1.sigs, `real ${n}: the same bake key and stroke signatures`);
    check(Object.keys(r.again).length === 0, `real ${n}: a second save writes nothing`);
    if ( oldView ) check(sc.flags[MID].destructionBackupV2?.n === F.destruction.o.length, `real ${n}: the layout-2 array is kept once (${sc.flags[MID].destructionBackupV2?.n})`);
  }
}

/* ================================================================= 2. synthetic layout-2 scenes */
{
  const objs = [];
  for ( let i = 0; i < 400; i++ ) objs.push(stroke(i % 7 === 0 ? `c${(i * 977).toString(36)}` : rid(), { erase: i % 9 === 4, type: i % 6, cause: i % 10, path: i % 3 === 0 ? [i, i + 1, 0, i + 9, i + 9, 40] : null }));
  objs.push(stroke(rid(), { w: 600, h: 400 }));
  const sc = v2Scene(objs), oldS = Old.load(structuredClone(sc)), r = migrate(sc);
  check(r.after.objects.length === 401 && J(view(r.after)) === J(view(oldS)), `401 strokes (400 + one 600x400 box) migrate whole (${r.after.objects.length})`);
  check(r.k0.key === r.k1.key && r.k0.sigs === r.k1.sigs, "401 strokes: same bake key and signatures");
  check(r.upd[`${P}.destruction.o`] === null && sc.flags[MID].destruction.o === null && sc.flags[MID].destruction.v === 3, "the old array goes in the SAME update as the strokes (one document update: no half-written state)");
  check(Object.keys(r.again).length === 0, "401 strokes: a second save writes nothing");
  console.log(`     (the migration update: ${Object.keys(r.upd).length} keys, ${(J(r.upd).length / 1024).toFixed(0)} KiB with the backup)`);
}

/* ================================================================= 3. ids */
for ( const id of ["123", "0abc", "o", "v", "s", "constructor", "toString", "a_b", "dot.ted", "-=x", "sp ace", "ü", "__proto__", "hasOwnProperty"] ) {
  const sc = v2Scene([stroke("keepMe0001"), stroke(id), stroke("keepMe0002")]);
  const r = migrate(sc);
  check(r.after.objects.length === 3 && Object.keys(r.again).length === 0, `id ${J(id)}: ${r.after.objects.length}/3 strokes after migration${r.after.objects[1]?.id !== id ? ` (stored as ${r.after.objects[1]?.id})` : ""}`);
}
{
  const sc = v2Scene([stroke("dupId00001"), stroke("other00001"), stroke("dupId00001")]), oldS = Old.load(structuredClone(sc)), r = migrate(sc);
  check(r.after.objects.length === oldS.objects.length, `duplicated id: the old code shows ${oldS.objects.length}, after migration ${r.after.objects.length}`);
  const sc2 = v2Scene([stroke("fine000001"), { ...stroke("x"), id: 12345 }]), oldS2 = Old.load(structuredClone(sc2)), r2 = migrate(sc2);
  check(r2.after.objects.length === oldS2.objects.length, `numeric (non-string) id: the old code shows ${oldS2.objects.length}, after migration ${r2.after.objects.length}`);
  const sc3 = v2Scene([stroke("pathOk0001", { path: [1, 1, 0, 5, 5, 9] }), stroke("bad.path01", { path: [2, 2, 0, 7, 7, 9] })]);
  sc3.flags[MID].destructionPaths = { pathOk0001: [1, 1, 0, 5, 5, 9], "bad.path01": [2, 2, 0, 7, 7, 9] };
  for ( const o of sc3.flags[MID].destruction.o ) delete o.p;
  const r3 = migrate(sc3);
  check(J(r3.after.objects.map((o) => o.p)) === J([[1, 1, 0, 5, 5, 9], [2, 2, 0, 7, 7, 9]]), "a renamed stroke keeps the path filed under its old id");
}

/* ================================================================= 4. undo / erase / clear / order */
{
  const sc = v2Scene([stroke("aaaaaaaaa1"), stroke("bbbbbbbbb2", { erase: true }), stroke("ccccccccc3", { cause: 3 })]), r = migrate(sc);
  check(r.after.objects.map((o) => o.id + ":" + o.s).join() === "aaaaaaaaa1:0,bbbbbbbbb2:1,ccccccccc3:2", "order kept (s = old index); the erase stroke kept");
  const S = r.after;
  S.dropOk.add(S.objects.at(-1).id); S.objects = S.objects.slice(0, -1);
  const u = Store.flagUpdate(S, sc); apply(sc, u);
  check(loadNew(sc).objects.length === 2 && !Store.snapshotIn(u), "undo after migration removes exactly one, no snapshot");
  for ( const o of S.objects ) S.dropOk.add(o.id);
  S.objects = [];
  const u2 = Store.flagUpdate(S, sc); apply(sc, u2);
  check(loadNew(sc).objects.length === 0 && !Store.snapshotIn(u2), "Clear on purpose removes all, no snapshot");
}

/* ================================================================= 5. both an array and per-stroke keys */
{
  const sc = v2Scene([stroke("p1pppppppp"), stroke("p2pppppppp")]); migrate(sc);
  sc.flags[MID].destruction.o = [strip(stroke("arrOnly001"))];
  const S = loadNew(sc);
  check(S.objects.map((o) => o.id).join() === "p1pppppppp,p2pppppppp,arrOnly001", `v3 + a stray array: the union, keyed first (${S.objects.map((o) => o.id).join()})`);
  apply(sc, Store.flagUpdate(S, sc));
  check(loadNew(sc).objects.length === 3 && sc.flags[MID].destruction.o === null, "the next save writes the union as layout 3");
}

/* ================================================================= 6. MIXED VERSIONS: a tab still running the old code */
function mixed(label, oldAction, extra = 0) {
  const objs = Array.from({ length: 12 }, (_, i) => stroke(`flood${String(i).padStart(5, "0")}`, { type: 3, path: i % 2 ? [i, i, 0, i + 5, i + 5, 30] : null }));
  const sc = v2Scene(objs);
  migrate(sc);                                                          // a new-code GM: layout 3, 12 keys
  const refs0 = gcRefs(sc);
  const oldS = Old.load(sc), oldSees = oldS.objects.length;             // the old tab: the migration echo reloads it (0 strokes)
  oldAction(oldS);
  apply(sc, Old.flagUpdate(oldS, sc));                                  // the old GM tab saves: whole flag, v 2, array o, paths deleted
  const seen = loadNew(sc);                                             // every new-code client reloads on the echo
  // the active new-code GM: a bake completes, persistOnce() saves the strokes, then writes the manifest (every stroke: a chunk)
  const upd = Store.flagUpdate(seen, sc); apply(sc, upd);
  const c = Object.fromEntries(seen.objects.filter((o) => !o.k).map((o) => [o.id, sc.flags[MID].destruction.baked.c[o.id] ?? `s:${chunk(900)}`]));
  const mu = {}; for ( const id of Object.keys(sc.flags[MID].destruction.baked.c) ) if ( !(id in c) ) mu[`${P}.destruction.baked.c.${id}`] = new ForcedDeletion();
  for ( const [id, v] of Object.entries(c) ) mu[`${P}.destruction.baked.c.${id}`] = v;
  apply(sc, mu);
  const final = loadNew(sc), refs1 = gcRefs(sc);
  check(oldSees === 0 && final.objects.length === 12 + extra && [...refs0].every((r) => refs1.has(r)),
    `${label}: the old tab sees ${oldSees}; new clients then show ${seen.objects.length}, after the new GM's save and publish ${final.objects.length} (want ${12 + extra}); every chunk still referenced for the GC: ${[...refs0].every((r) => refs1.has(r))}`);
  check(final.objects.every((o, i) => i < 12 ? o.id === objs[i].id : true) && final.objects.filter((o) => o.p).length === 6, `${label}: the 12 keep their order and their 6 paths`);
  check(!Store.snapshotIn(upd), `${label}: no snapshot needed (nothing dropped)`);
}
mixed("old tab paints one stroke", (S) => { S.objects = [...S.objects, stroke("oldTab0001", { type: 3 })]; }, 1);
mixed("old tab only changes a setting", (S) => { S.params = { ...S.params, debris: 0.2 }; });
mixed("old tab presses Detonate", (S) => { S.blast = { id: "b", t: 1, box: null }; });
mixed("old tab presses Clear", (S) => { S.objects = []; });

/* ================================================================= 7. same version, two GM clients */
{
  const sc = v2Scene([stroke("base000001"), stroke("base000002")]); migrate(sc);
  const A = loadNew(sc), B = loadNew(sc);
  paint(A, "fromA00001"); paint(B, "fromB00001");
  apply(sc, Store.flagUpdate(A, sc));
  apply(sc, Store.flagUpdate(B, sc));                                   // B ignored A's echo (a save of its own was pending)
  const ids = loadNew(sc).objects.map((o) => o.id);
  check(ids.includes("fromA00001") && ids.includes("fromB00001") && ids.length === 4, `two GMs painting within 0.7 s: ${ids.join(",")}`);
  // B clears on purpose: only what B has seen goes; A's stroke B never saw stays
  for ( const o of B.objects ) B.dropOk.add(o.id);
  B.objects = []; apply(sc, Store.flagUpdate(B, sc));
  check(loadNew(sc).objects.map((o) => o.id).join() === "fromA00001", "B's Clear deletes only the strokes B has seen");
}

/* ================================================================= 8. echo semantics */
{
  const sc = v2Scene([stroke("e000000001"), stroke("e000000002")]); migrate(sc);
  const S = loadNew(sc); paint(S, "e000000003");
  const upd = Store.flagUpdate(S, sc);
  check(Object.keys(upd).length === 1, "a new stroke's update names one key (the hook's `changed` holds only it)");
  apply(sc, upd);
  check(loadNew(sc).objects.length === 3, "a reload from the merged document sees all 3");
}

/* ================================================================= 9. the layout-2 backup (V2) */
{
  const objs = Array.from({ length: 30 }, (_, i) => stroke(`bk${String(i).padStart(8, "0")}`, { path: i % 4 ? null : [i, i, 0, 3, 3, 9] }));
  const sc = v2Scene(objs), r = migrate(sc), B = sc.flags[MID].destructionBackupV2;
  check(!!B && B.n === 30 && B.o?.length === 30 && Object.keys(B.baked?.c ?? {}).length === 30, `the first layout-3 save keeps the layout-2 array and its manifest once (${B ? B.n : "NO BACKUP"})`);
  const at = B.at, S = loadNew(sc);
  for ( const o of S.objects.slice(5) ) S.dropOk.add(o.id);              // 25 strokes undone on purpose (no snapshot)
  S.objects = S.objects.slice(0, 5); apply(sc, Store.flagUpdate(S, sc));
  check(sc.flags[MID].destructionBackupV2?.at === at && !sc.flags[MID].destructionBackupV3, "later saves never touch the V2 backup");
  check([...Array(30).keys()].every((i) => gcRefs(sc).has(chunk(i))), "the GC still counts the backed-up strokes' chunks as referenced");
  const back = Store.backupObjects(sc, S, "v2"), L = loadNew(sc), have = new Set(L.objects.map((o) => o.id));
  const add = back.filter((o) => !have.has(o.id)); let next = Model.nextSeq(L); for ( const o of add ) o.s = next++;
  L.objects = [...L.objects, ...add]; apply(sc, Store.flagUpdate(L, sc));                          // what restoreBackup() saves
  check(J(byId(view(loadNew(sc)))) === J(byId(view(r.before))), `restore from V2 (merge) brings back the 25 with masks and paths (${loadNew(sc).objects.length}/30)`);
}

/* ================================================================= 10. the rolling snapshot (V3) */
{
  const sc = v2Scene(Array.from({ length: 20 }, (_, i) => stroke(`sn${String(i).padStart(8, "0")}`, { path: i % 5 ? null : [i, 0, 0, 4, 4, 9] }))); migrate(sc);
  const full = loadNew(sc);
  // a drop nobody asked for: 8 strokes vanish from S (a bug, a stale state, anything but undo / Clear)
  const S = loadNew(sc); S.objects = S.objects.slice(0, 12);
  const upd = Store.flagUpdate(S, sc), snap = Store.snapshotIn(upd);
  check(warned.some((w) => w.includes("drops 8 stroke")), "the drop is said in the console");
  check(!!snap && snap.gone.length === 8 && Object.keys(snap.objs).length === 20 && Object.keys(snap.baked?.c ?? {}).length === 20, `a save dropping 8 strokes nobody undid writes a snapshot first (${snap ? snap.gone.length + " gone, " + Object.keys(snap.objs).length + " kept" : "NONE"})`);
  apply(sc, upd);
  check(loadNew(sc).objects.length === 12 && [...Array(20).keys()].every((i) => gcRefs(sc).has(chunk(i))), "after the drop the GC still keeps all 20 chunks (the snapshot's manifest)");
  const back = Store.backupObjects(sc, S, "auto"), L = loadNew(sc), have = new Set(L.objects.map((o) => o.id));
  const add = back.filter((o) => !have.has(o.id)); let next = Model.nextSeq(L); for ( const o of add ) o.s = next++;
  L.objects = [...L.objects, ...add]; apply(sc, Store.flagUpdate(L, sc));
  check(J(byId(view(loadNew(sc)))) === J(byId(view(full))), `restore from V3 (merge) brings back the 8 (${loadNew(sc).objects.length}/20)`);
  // one stroke gone without an undo: no snapshot (the rule is "more than one, or the last ones")
  const S1 = loadNew(sc); S1.objects = S1.objects.slice(1);
  check(!Store.snapshotIn(Store.flagUpdate(S1, sc)), "a single stroke gone (not the last one): no snapshot");
  // the last stroke gone without an undo: snapshot
  const sc2 = v2Scene([stroke("lastOne001")]); migrate(sc2);
  const S2 = loadNew(sc2); S2.objects = [];
  check(!!Store.snapshotIn(Store.flagUpdate(S2, sc2)), "the last stroke gone without an undo: snapshot");
  // several undos within one save pause: no snapshot
  const S3 = loadNew(sc); for ( let i = 0; i < 4; i++ ) { S3.dropOk.add(S3.objects.at(-1).id); S3.objects = S3.objects.slice(0, -1); }
  check(!Store.snapshotIn(Store.flagUpdate(S3, sc)), "four undos inside one save pause: no snapshot");
}

/* ================================================================= 11. layout 3 as first written: paths only in destructionPaths */
{
  // the main world's scenes were converted before a stroke kept its path in its own key: an old-code tab would delete those paths
  const sc = v2Scene(Array.from({ length: 10 }, (_, i) => stroke(`pa${String(i).padStart(8, "0")}`, { type: 5, path: [i, i, 0, i + 9, i + 2, 40] }))); migrate(sc);
  for ( const o of Object.values(sc.flags[MID].destructionObjects) ) delete o.p;              // as ad0428d stored them
  check(Store.pathsOnlyApart(sc) === 10, `paths only in destructionPaths found (${Store.pathsOnlyApart(sc)})`);
  const u = Store.flagUpdate(loadNew(sc), sc); apply(sc, u);                                 // what the active GM's load does once
  check(Store.pathsOnlyApart(sc) === 0 && Object.keys(u).length === 10, `one save copies them into the stroke keys (${Object.keys(u).length} keys)`);
  const oldS = Old.load(sc); oldS.objects = [...oldS.objects, stroke("oldTab0002")]; apply(sc, Old.flagUpdate(oldS, sc));
  const after = loadNew(sc);
  check(after.objects.length === 11 && after.objects.filter((o) => o.p?.length).length === 10, "an old-code tab's write afterwards: all strokes and all 10 paths stay");
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
