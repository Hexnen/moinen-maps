import { MODULE_ID } from "../config.mjs";
import { folder } from "../water/publish.mjs";
import { CORE_VERSION, LIVE_PARAMS } from "./core.mjs";
import { decodePng } from "./png.mjs";

/**
 * Where a bake is kept: as one PNG (the sheet with its placement table in the last rows). The GM's client uploads it to the world
 * folder (`worlds/<world>/moinen-maps/destruction-<scene>.png`) and names it in the scene flag (`baked.key`), so players show it
 * without baking; every client also keeps recent bakes in IndexedDB. The PNG is written and read by png.mjs (exact bytes, no 2D
 * canvas), so the GM's raw bake and everybody's decoded file are the same pixels.
 */
const DB = "moinen-maps-destruction", KEEP = 16;
let dbp = null;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("bakes", { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return dbp;
}
/** A cache that does not answer (an open blocked by another tab, a pending delete) is a miss after a moment, never a hang. */
const timeout = (p, ms = 1500) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
const run = async (mode, fn) => timeout(runInner(mode, fn));
let downUntil = 0;
const runInner = async (mode, fn) => {
  if ( Date.now() < downUntil ) return null;
  const d = await timeout(db(), 1200);
  if ( !d ) { dbp = null; downUntil = Date.now() + 30000; return null; }
  d.onversionchange ??= () => { d.close(); dbp = null; };
  return new Promise((resolve) => {
    try {
      const tx = d.transaction("bakes", mode), r = fn(tx.objectStore("bakes"));
      tx.oncomplete = () => resolve(r?.result ?? null);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
};

const fnv = (a, h = 2166136261) => { for ( let i = 0; i < a.length; i++ ) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };

export function makeKey(scene, S, bgPath) {
  const params = Object.keys(S.params).filter((k) => !LIVE_PARAMS.has(k)).sort().map((k) => `${k}=${JSON.stringify(S.params[k])}`).join("|");
  const paths = S.params.directional ? (S.paths ?? []).map((q) => q.p.filter((v, i) => i % 3 !== 2).join(",")).join(";") : "";
  const extra = fnv(new TextEncoder().encode(`${params}|${bgPath}|${scene.width}x${scene.height}|${S.seed}|${paths}`));
  return `${CORE_VERSION}:${scene.id}:${S.ap}:${S.mw}x${S.mh}:${fnv(S.mask).toString(36)}:${extra.toString(36)}`;
}

export async function getCached(key) {
  const hit = await run("readonly", (s) => s.get(key));
  if ( hit ) run("readwrite", (s) => s.put({ ...hit, at: Date.now() }));
  return hit;
}

export function dropCached(key) { return run("readwrite", (s) => { s.delete(key); return null; }); }

export async function putCached(key, rec) {
  await run("readwrite", (s) => s.put({ key, ...rec, at: Date.now() }));
  const all = await run("readonly", (s) => s.getAll());
  if ( all && all.length > KEEP ) {
    const old = all.sort((a, b) => a.at - b.at).slice(0, all.length - KEEP);
    await run("readwrite", (s) => { for ( const o of old ) s.delete(o.key); return null; });
  }
}

/** PNG blob -> { w, h, rgba } (exact bytes: no canvas, no premultiplied alpha). */
export async function decodeSheet(blob) {
  return decodePng(new Uint8Array(await blob.arrayBuffer()));
}

const picker = () => foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

/** Upload a bake; returns the record for the scene flag. */
export async function publish(sceneId, key, blob, metaRows) {
  const file = new File([blob], `destruction-${sceneId}.png`, { type: "image/png" });
  const FP = picker(), dir = folder();
  try { await FP.createDirectory("data", dir); } catch { /* exists */ }
  const res = await FP.upload("data", dir, file, {}, { notify: false });
  if ( !res?.path && res?.status !== "success" ) throw new Error(res?.message ?? "upload failed");
  return { path: res.path ?? `${dir}/${file.name}`, key, metaRows };
}

/** Download a published bake as a blob, or null. */
export async function fetchPublished(baked) {
  try {
    const res = await fetch(`${foundry.utils.getRoute(baked.path)}?v=${encodeURIComponent(baked.key)}`, { cache: "force-cache" });
    return res.ok ? await res.blob() : null;
  } catch ( err ) { console.warn(`${MODULE_ID} | published destruction`, err); return null; }
}
