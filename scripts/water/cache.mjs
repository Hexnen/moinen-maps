/**
 * A browser-side cache of baked water: the level bytes of every frame, kept in IndexedDB under a key made of the scene, the masks and
 * every setting that changes the bake. Opening a scene whose water was baked before then needs no worker and no waiting. Failures
 * (a private window, a full disk) are silent: the water is simply baked again.
 */
const DB = "moinen-maps-water", KEEP = 12;
export const VERSION = 1;     // bump when the engine or the bake changes

let dbp = null;
function db() {
  if ( dbp ) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("bakes", { keyPath: "key" }); req.result.createObjectStore("meta", { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return dbp;
}

const run = async (store, mode, fn) => {
  const d = await db(); if ( !d ) return null;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(store, mode), s = tx.objectStore(store), r = fn(s);
      tx.oncomplete = () => resolve(r?.result ?? null);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
};

const fnv = (a, h = 2166136261) => { for ( let i = 0; i < a.length; i++ ) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };

/** The settings that change the bake (colours, opacity, frame time and the token effects only repaint or play). */
const SKIP = /^(colors|alpha|palBase|palHue|palSat|palRange|ms|fx|reflect|submerge)/;

export function makeKey(sceneId, S) {
  let h = 2166136261;
  for ( const l of ["water", "river", "fall"] ) h = fnv(S.masks[l], h);
  const params = Object.keys(S.params).filter((k) => !SKIP.test(k)).sort().map((k) => `${k}=${JSON.stringify(S.params[k])}`).join("|");
  const p = fnv(new TextEncoder().encode(params));
  return `${VERSION}:${sceneId}:${S.px}:${S.w}x${S.h}:${h.toString(36)}:${p.toString(36)}`;
}

export async function getBake(key) {
  const hit = await run("bakes", "readonly", (s) => s.get(key));
  if ( hit ) run("bakes", "readwrite", (s) => s.put({ ...hit, at: Date.now() }));   // used just now
  return hit;
}

export async function putBake(key, data) {
  await run("bakes", "readwrite", (s) => s.put({ key, ...data, at: Date.now() }));
  // keep the most recent few
  const all = await run("bakes", "readonly", (s) => s.getAll());
  if ( all && all.length > KEEP ) {
    const old = all.sort((a, b) => a.at - b.at).slice(0, all.length - KEEP);
    await run("bakes", "readwrite", (s) => { for ( const o of old ) s.delete(o.key); return null; });
  }
}

/** What a client needs besides the frames to paint them: the code table and the engine's default settings. */
export const getMeta = async () => { const m = await run("meta", "readonly", (s) => s.get("engine")); return m?.version === VERSION ? m : null; };
export const putMeta = (codes, defaults) => run("meta", "readwrite", (s) => s.put({ id: "engine", version: VERSION, codes, defaults }));
