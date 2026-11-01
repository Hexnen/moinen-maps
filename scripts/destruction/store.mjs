import { MODULE_ID } from "../config.mjs";
import { folder } from "../water/publish.mjs";
import { CORE_VERSION } from "./core.mjs";

/**
 * Where a bake is kept: as one PNG (the sheet with its placement table in the last rows). The GM's client uploads it to the world
 * folder (`worlds/<world>/moinen-maps/destruction-<scene>.png`) and names it in the scene flag (`baked.key`), so players show it
 * without baking; every client also keeps recent bakes in IndexedDB. Everyone, the GM included, shows the DECODED PNG, so all
 * clients paint exactly the same pixels.
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
const run = async (mode, fn) => {
  const d = await db(); if ( !d ) return null;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction("bakes", mode), r = fn(tx.objectStore("bakes"));
      tx.oncomplete = () => resolve(r?.result ?? null);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
};

const fnv = (a, h = 2166136261) => { for ( let i = 0; i < a.length; i++ ) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
/** Settings that only change playback, not the picture. */
const LIVE = new Set(["anim", "idle", "fxWho"]);

export function makeKey(scene, S, bgPath) {
  const params = Object.keys(S.params).filter((k) => !LIVE.has(k)).sort().map((k) => `${k}=${JSON.stringify(S.params[k])}`).join("|");
  const extra = fnv(new TextEncoder().encode(`${params}|${bgPath}|${scene.width}x${scene.height}|${S.seed}`));
  return `${CORE_VERSION}:${scene.id}:${S.ap}:${S.mw}x${S.mh}:${fnv(S.mask).toString(36)}:${extra.toString(36)}`;
}

export async function getCached(key) {
  const hit = await run("readonly", (s) => s.get(key));
  if ( hit ) run("readwrite", (s) => s.put({ ...hit, at: Date.now() }));
  return hit;
}

export async function putCached(key, rec) {
  await run("readwrite", (s) => s.put({ key, ...rec, at: Date.now() }));
  const all = await run("readonly", (s) => s.getAll());
  if ( all && all.length > KEEP ) {
    const old = all.sort((a, b) => a.at - b.at).slice(0, all.length - KEEP);
    await run("readwrite", (s) => { for ( const o of old ) s.delete(o.key); return null; });
  }
}

/** RGBA sheet -> PNG blob. */
export async function encodePng(sheet) {
  const c = new OffscreenCanvas(sheet.w, sheet.h);
  c.getContext("2d").putImageData(new ImageData(sheet.data, sheet.w, sheet.h), 0, 0);
  return c.convertToBlob({ type: "image/png" });
}

/** PNG blob -> { canvas (for the texture), rgba (exact pixels), w, h }. */
export async function decodePng(blob) {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0); bmp.close?.();
  return { canvas: c, rgba: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
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
