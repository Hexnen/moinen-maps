import { MODULE_ID } from "../config.mjs";
import { CORE_VERSION, LIVE_PARAMS } from "./core.mjs";
import { decodePng } from "./png.mjs";
import { fullSigs } from "./substrate.mjs";
import * as Model from "./model.mjs";
import { setChanged, syncMap } from "../flag-diff.mjs";

/**
 * Where a bake is kept and how it travels (see scripts/net): every stroke's sprites are one CHUNK, a small immutable file named by a
 * hash of its content (`worlds/<world>/moinen-maps/c/<scene>/<id>.png`). The scene flag `destruction.baked` is the MANIFEST:
 *   { v: 2, dir, base, key, c: { <stroke id>: "<stroke signature>:<chunk id>" } }
 * `base` is everything every stroke's bake depends on (settings, seed, map, grids, bake version); a stroke's signature is its own
 * inputs (pixels, box, type, cause, path). A client shows a stroke from its chunk when both still match - after a stroke the others
 * are untouched, so only the new chunk travels. The first format (one PNG, `baked.path`) is still read once; the GM's next publish
 * replaces it.
 *
 * The strokes' brush paths live in their own flag key, `destructionPaths` { <stroke id>: [x, y, ms, ...] }, written key by key: a new
 * stroke sends its own path, not every path of the scene again. The strokes themselves too (layout 3): `destructionObjects.<id>`
 * (the object with its path `p` too - a tab still running the module from before layout 3 rewrites destructionPaths but never this -
 * and `s` its place in the order), so a stroke, an undo or a changed cause writes ONE key; the main flag `destruction` keeps the small
 * fields. A save names only what changed (flag-diff.mjs); nothing changed, no write. A save never drops a stroke it has not seen
 * stored or written itself, and one that drops strokes nobody undid keeps a snapshot first (SNAPSHOT, below).
 */
const fnv = (a, h = 2166136261) => { for ( let i = 0; i < a.length; i++ ) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
const enc = (s) => new TextEncoder().encode(s);

/** The settings that change a bake (the scene's default cause only when it is set: a scene from before causes keeps its keys). */
const paramStr = (S) => Object.keys(S.params).filter((k) => !LIVE_PARAMS.has(k) && !(k === "cause" && !S.params.cause)).sort().map((k) => `${k}=${JSON.stringify(S.params[k])}`).join("|");
/** One stroke's own inputs (its path when the damage follows the stroke, or when it is a tear: the path is its spine). */
const objStr = (S, o) => `${o.id},${o.k},${o.t},${o.x0},${o.y0},${o.w},${o.h},${o.m}${(S.params.directional || Model.TYPES[o.t] === "gash") && o.p ? "," + o.p.filter((v, i) => i % 3 !== 2).join(".") : ""}${o.c ? ",c" + o.c : ""}`;

export function makeKey(scene, S, bgPath) {
  // the stroke objects (id, kind, type, box, pixels; their paths only when the damage follows the stroke; their cause when they have one)
  const objs = (S.objects ?? []).map((o) => objStr(S, o)).join(";");
  const extra = fnv(enc(`${paramStr(S)}|${bgPath}|${scene.width}x${scene.height}|${S.seed}`));
  return `${CORE_VERSION}:${scene.id}:${S.ap}:${S.mw}x${S.mh}:${fnv(enc(objs)).toString(36)}:${extra.toString(36)}`;
}

/**
 * What every stroke's bake depends on besides the stroke itself - WITHOUT the bake version (0.4.2, version pinning, bake-policy.mjs):
 * "p:<art px>:<grid>:<settings, map, size, seed>". A setting still at its default does not count (a new setting added by an update,
 * at its default, does not change any key). Records, chunks, the manifest and the composite are keyed by it.
 */
export function baseKey(scene, S, bgPath) {
  const defs = Model.PARAM_DEFAULTS ?? {};
  const ps = Object.keys(S.params).filter((k) => !LIVE_PARAMS.has(k) && !(k === "cause" && !S.params.cause) && !(k in defs && JSON.stringify(S.params[k]) === JSON.stringify(defs[k])))
    .sort().map((k) => `${k}=${JSON.stringify(S.params[k])}`).join("|");
  return `p:${S.ap}:${S.mw}x${S.mh}:${fnv(enc(`${ps}|${bgPath}|${scene.width}x${scene.height}|${S.seed}`)).toString(36)}`;
}

/** The base key of 0.4.1 and before ("<bake version>:<rest>"): a manifest or composite made then still counts (migration). */
export function legacyBaseKey(scene, S, bgPath) {
  return `${CORE_VERSION}:${S.ap}:${S.mw}x${S.mh}:${fnv(enc(`${paramStr(S)}|${bgPath}|${scene.width}x${scene.height}|${S.seed}`)).toString(36)}`;
}

/** Is a stored base (a manifest's, a composite's) the same as this scene's now - pinned, or of 0.4.1 with the same settings? */
export function sameBase(stored, base, legacy) {
  if ( !stored ) return false;
  if ( stored === base ) return true;
  const a = String(stored).split(":"), b = String(legacy ?? "").split(":");
  return a[0] !== "p" && /^\d+$/.test(a[0]) && a.length === b.length && a.slice(1).join(":") === b.slice(1).join(":");
}

/** The bake version a 0.4.1 manifest's entries were made with (its base's first field), else -1. */
export const legacyVersion = (stored) => { const v = String(stored ?? "").split(":")[0]; return /^\d+$/.test(v) ? Number(v) : -1; };

/**
 * Stale while revalidate: may the chunks of a manifest made by an OLDER bake version stand in (shown at once, replaced stroke by stroke
 * as the new bake lands)? Only when everything but the version is the same (settings, map, grids, seed: the same strokes, drawn by
 * an earlier look) and that version is not listed as unfaithful. Bake versions so far changed the look only, never what is damaged
 * where; a bump that changes the shape of the damage (or the chunk layout) goes into STALE_UNFAITHFUL.
 */
export const STALE_UNFAITHFUL = new Set([]);
const STALE_MIN = 15;              // older chunks are not read as an older look (the chunk format starts at 14/15)
export function staleOk(oldBase, base) {
  const a = String(oldBase ?? "").split(":"), b = String(base).split(":");
  if ( a.length !== b.length || a[0] === b[0] ) return false;
  const v = Number(a[0]);
  if ( !Number.isFinite(v) || v < STALE_MIN || v > Number(b[0]) || STALE_UNFAITHFUL.has(v) ) return false;
  return a.slice(1).join(":") === b.slice(1).join(":");
}

/** One stroke's signature: its own inputs only. */
export const objSig = (S, o) => fnv(enc(objStr(S, o))).toString(36);

/**
 * Every stroke's FULL signature, in stroke order ([{ own, sig, deps }]): its own, plus a digest of the older strokes that may lie
 * under or right round it (substrate.mjs: a newer stroke is baked over them; an older one never depends on a newer one). A stroke
 * with nothing older near it keeps its own signature exactly. Records, chunks and the manifest are keyed by the full signature, so a
 * change of an older stroke re-bakes only the strokes over it, on every client alike.
 */
export function sigsOf(S) {
  return fullSigs(S.objects ?? [], (o) => objSig(S, o), S.params, Model.K, (o) => o.bytes ?? Model.objBytes(o));
}

/** The manifest of the scene (null for none, or the first format). */
export const manifestOf = (S) => S?.baked?.v === 2 && S.baked.c && typeof S.baked.dir === "string" ? S.baked : null;
/** A stroke's manifest entry: { sig, id } or null. */
export function entryOf(M, objId) {
  const v = M?.c?.[objId];
  if ( typeof v !== "string" ) return null;
  // "sig:id" (0.4.1: baked at the manifest's version) or "sig:id:ver" (0.4.2: the version this stroke was baked with)
  const [sig, id, ver] = v.split(":");
  // the id names a file: only what the codec makes ("d" + 14 base-36), never a path
  if ( !sig || !/^d[0-9a-z]{14}$/.test(id ?? "") ) return null;
  const n = ver !== undefined && ver !== "" ? Number(ver) : NaN;
  return { sig, id, ver: Number.isFinite(n) ? n : legacyVersion(M.base) };
}

/* ---------------------------------------------------------------- the strokes' paths, in their own flag key */

export const PATHS = "destructionPaths";

/** The paths stored apart joined back to their strokes (a stroke of the first format keeps its own `p`). Copies, never the flag's objects. */
export function attachPaths(S, scene) {
  const P = scene?.flags?.[MODULE_ID]?.[PATHS];
  if ( !S || !P || typeof P !== "object" ) return S;
  // (in place: the objects are load()'s own copies, and their decoded bytes stay with them)
  for ( const o of S.objects ?? [] ) {
    if ( o.p ) continue;
    const p = P[o.id] ?? P[Model.formerId.get(o)];     // a stroke renamed to a safe key keeps the path filed under its old id
    if ( Array.isArray(p) ) o.p = p;
  }
  return S;
}

/* ---------------------------------------------------------------- safety net: copies of the strokes, kept in the scene */

/**
 * V2: one copy of the scene's layout-2 strokes (array `o`, the paths, the chunk manifest), written ONCE with the first layout-3 save,
 * never changed. V3: a rolling one-slot snapshot of the stored strokes (the per-stroke map, the paths, the manifest), written right
 * before a save that would drop more than one stroke (or the last ones) that were not undone or cleared on purpose here.
 * Both keep a copy of the manifest ({ v: 2, dir, c }), so the chunk GC (water/publish.mjs chunkRecords walks every flag of the
 * module) keeps the backed-up strokes' files too.
 */
export const BACKUP = "destructionBackupV2";
export const SNAPSHOT = "destructionBackupV3";
const BACKUP_MAX = 24 * 1024 * 1024;                  // characters of JSON; a bigger copy is not written (console error)
const manifestCopy = (b) => b?.v === 2 && typeof b.dir === "string" && b.c && typeof b.c === "object" ? { v: 2, dir: b.dir, c: { ...b.c } } : null;
/** A deep copy (never the scene's own objects: the same update deletes from them), or null when it is too big. */
const capped = (o, what) => {
  const s = JSON.stringify(o), size = s.length;
  if ( size <= BACKUP_MAX ) return JSON.parse(s);
  console.error(`${MODULE_ID} | destruction: ${what} not written (${size} characters)`);
  return null;
};

/**
 * A backup's strokes as objects, with their paths; null when there is none. `which`: "v3" (the snapshot), "v2" (the layout-2 copy) or
 * "auto" (the snapshot when there is one, else the layout-2 copy).
 */
export function backupObjects(scene, g, which = "auto") {
  const F = scene?.flags?.[MODULE_ID] ?? {};
  const B3 = F[SNAPSHOT], B2 = F[BACKUP];
  const use = which === "auto" ? (B3?.objs ? "v3" : "v2") : which;
  let S;
  if ( use === "v3" && B3?.objs && typeof B3.objs === "object" ) S = { objects: Model.objectsOf({ v: 3 }, B3.objs, g) };
  else if ( use === "v2" && Array.isArray(B2?.o) ) S = { objects: Model.objectsOf({ v: 2, o: B2.o }, null, g) };
  else return null;
  return attachPaths(S, { flags: { [MODULE_ID]: { [PATHS]: (use === "v3" ? B3.paths : B2.paths) ?? {} } } }).objects;
}

/** The snapshot an update writes (flagUpdate adds one before a suspicious drop), or null. */
export const snapshotIn = (upd) => upd?.[`flags.${MODULE_ID}.${SNAPSHOT}`] ?? null;

/**
 * Strokes stored before their path went into their own key (layout 3 as first written): their path is only in destructionPaths,
 * which a tab still running the module from before layout 3 rewrites with the paths it knows. The active GM copies them over once.
 */
export function pathsOnlyApart(scene) {
  const F = scene?.flags?.[MODULE_ID] ?? {}, O = F[Model.OBJS], PP = F[PATHS];
  if ( !O || typeof O !== "object" || !PP || typeof PP !== "object" ) return 0;
  return Object.entries(O).filter(([id, o]) => o && !Array.isArray(o.p) && Array.isArray(PP[id]) && PP[id].length).length;
}

/**
 * The scene update that saves `S` against what the scene holds now: only the main flag's fields that changed, one key per new or
 * changed stroke and path, a deletion per gone one. A scene of layout 2 (array `o`) is written as layout 3 in full the first time
 * (the stored OBJS is empty then). Empty when nothing changed.
 */
export function flagUpdate(S, scene) {
  const F = scene?.flags?.[MODULE_ID] ?? {}, P = `flags.${MODULE_ID}`, upd = {};
  const objs = {}, paths = {};
  // a stroke that cannot be stored under its own key is never left out silently: nothing is written (load() renames such ids)
  const unsafe = (S.objects ?? []).filter((o) => !Model.safeId(o.id));
  if ( unsafe.length ) { console.error(`${MODULE_ID} | destruction: not saved, stroke ids not usable as flag keys`, unsafe.map((o) => o.id)); return {}; }
  (S.objects ?? []).forEach((o, i) => {
    // the path stays in the stroke's own key too: a tab still running the module from before layout 3 rewrites destructionPaths
    // with only the paths it knows (it deleted every other one), but never touches destructionObjects
    const { p, ...rest } = o;
    if ( Array.isArray(p) && p.length ) rest.p = p;
    rest.s = Number.isFinite(o.s) ? o.s : i;
    objs[o.id] = rest;
    if ( Array.isArray(p) && p.length ) paths[o.id] = p;
    S.seen?.add(o.id);                               // written now: a later undo may delete it
  });
  // deletions only of strokes this client has seen stored or written itself: a stroke another GM added meanwhile stays
  const seen = S.seen ?? null, only = (map) => !seen || !map ? map : Object.fromEntries(Object.entries(map).filter(([id]) => seen.has(id) || id in objs));
  const storedObjs = F[Model.OBJS] && typeof F[Model.OBJS] === "object" ? F[Model.OBJS] : {}, deletable = only(storedObjs);
  syncMap(upd, `${P}.${Model.OBJS}`, deletable, objs);
  syncMap(upd, `${P}.${PATHS}`, only(F[PATHS]), paths);
  const main = Model.encodeMain(S), old = F[Model.FLAG] ?? {};
  // a drop nobody asked for (more than one stroke, or the last ones, not undone / cleared here): the stored strokes are kept first
  const dropped = Object.keys(deletable).filter((id) => deletable[id] != null && !(id in objs));     // what syncMap deletes
  const unasked = dropped.filter((id) => !S.dropOk?.has(id));
  if ( unasked.length > 1 || (unasked.length && !Object.keys(objs).length) ) {
    const snap = capped({ at: Date.now(), why: "drop", n: Object.keys(storedObjs).length, gone: unasked, objs: storedObjs, paths: F[PATHS] ?? null, baked: manifestCopy(old.baked) }, "snapshot");
    if ( snap ) upd[`${P}.${SNAPSHOT}`] = snap;
    console.warn(`${MODULE_ID} | destruction: a save drops ${unasked.length} stroke(s) not undone here - snapshot kept in ${SNAPSHOT}`, unasked);
  }
  S.dropOk?.clear();
  // layout 2 -> 3: the old array goes with the same update that writes the strokes key by key, and is kept ONCE as a backup
  setChanged(upd, `${P}.${Model.FLAG}`, old, main, ["v", "ap", "seed", "enabled", "params", "blast", "entries", "m", "paths"]);
  if ( old.o != null ) {
    upd[`${P}.${Model.FLAG}.o`] = null;
    if ( Array.isArray(old.o) && old.o.length && !F[BACKUP] ) {
      const backup = capped({ at: Date.now(), n: old.o.length, o: old.o, paths: F[PATHS] ?? null, baked: manifestCopy(old.baked),
        keyed: Model.mixedLayout(old, storedObjs) ? Object.keys(storedObjs) : null }, "layout-2 backup");
      if ( backup ) upd[`${P}.${BACKUP}`] = backup;
    }
  }
  return upd;
}

/* ---------------------------------------------------------------- the first format (read only) */

/** Download a published bake of the first format and decode it: { w, h, rgba } (png.mjs: exact bytes, no canvas), or null. */
export async function fetchLegacy(baked) {
  try {
    const res = await fetch(`${foundry.utils.getRoute(baked.path)}?v=${encodeURIComponent(baked.key)}`, { cache: "force-cache" });
    return res.ok ? await decodePng(new Uint8Array(await res.arrayBuffer())) : null;
  } catch ( err ) { console.warn(`${MODULE_ID} | published destruction`, err); return null; }
}

/** The whole-bake cache of the first version is no longer used: let the browser drop it. */
export function dropOldCache() {
  try { indexedDB.deleteDatabase("moinen-maps-destruction"); } catch { /* blocked or unavailable */ }
}
