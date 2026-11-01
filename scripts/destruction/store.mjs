import { MODULE_ID } from "../config.mjs";
import { CORE_VERSION, LIVE_PARAMS } from "./core.mjs";
import { decodePng } from "./png.mjs";
import * as Model from "./model.mjs";

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
 * stroke sends its own path, not every path of the scene again.
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

/** What every stroke's bake depends on besides the stroke itself. */
export function baseKey(scene, S, bgPath) {
  return `${CORE_VERSION}:${S.ap}:${S.mw}x${S.mh}:${fnv(enc(`${paramStr(S)}|${bgPath}|${scene.width}x${scene.height}|${S.seed}`)).toString(36)}`;
}

/** One stroke's signature. */
export const objSig = (S, o) => fnv(enc(objStr(S, o))).toString(36);

/** The manifest of the scene (null for none, or the first format). */
export const manifestOf = (S) => S?.baked?.v === 2 && S.baked.c && typeof S.baked.dir === "string" ? S.baked : null;
/** A stroke's manifest entry: { sig, id } or null. */
export function entryOf(M, objId) {
  const v = M?.c?.[objId];
  if ( typeof v !== "string" ) return null;
  const i = v.indexOf(":");
  return i > 0 ? { sig: v.slice(0, i), id: v.slice(i + 1) } : null;
}

/* ---------------------------------------------------------------- the strokes' paths, in their own flag key */

export const PATHS = "destructionPaths";

/** The paths stored apart joined back to their strokes (a stroke of the first format keeps its own `p`). Copies, never the flag's objects. */
export function attachPaths(S, scene) {
  const P = scene?.flags?.[MODULE_ID]?.[PATHS];
  if ( !S || !P || typeof P !== "object" ) return S;
  S.objects = (S.objects ?? []).map((o) => (o.p || !Array.isArray(P[o.id])) ? o : { ...o, p: P[o.id] });
  return S;
}

/** The scene update that saves `S`: the destruction flag without the paths, and the paths key by key (gone strokes deleted). */
export function flagUpdate(S, scene) {
  const data = Model.encode(S), paths = {};
  data.o = (data.o ?? []).map((o) => { if ( !o.p ) return o; paths[o.id] = o.p; const { p, ...rest } = o; void p; return rest; });
  const old = scene?.flags?.[MODULE_ID]?.[PATHS];
  if ( old && typeof old === "object" ) for ( const id of Object.keys(old) ) if ( !(id in paths) ) paths[`-=${id}`] = null;
  return { [`flags.${MODULE_ID}.${Model.FLAG}`]: data, [`flags.${MODULE_ID}.${PATHS}`]: paths };
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
