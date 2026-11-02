import { MODULE_ID } from "../config.mjs";
import * as Net from "./stream.mjs";
import { bundleBuckets } from "./chunks.mjs";
import { chunkRecords } from "../water/publish.mjs";
import { floodIds } from "./preload.mjs";

/**
 * BUNDLES (PERF, round 2: requests). A scene's load asks for dozens of tiny files - 37 water tiles of 0.1-8 kB, the composite's index and
 * small tiles, strokes of a few kB. The active GM packs the small chunks the scene's manifests name into a handful of bundle files
 * (chunks.mjs kind 5) and writes the scene flag
 *
 *   chunkBundle { v: 2, dir, t: [bundle ids: GC], b: [[bundle id, [chunk ids]], ...], at }
 *
 * (shaped like a water record - `v: 2`, `dir`, `t` - so the garbage collector keeps the bundles' files without knowing about them).
 * A client registers it (stream.mjs setBundles) and then takes every member from its bundle: one request for ~100 chunks. Nothing else
 * changes: the chunks keep their ids and their single files (a bundle that is missing costs only the requests it would have saved),
 * manifests are untouched, a stale bundle list only names chunks that are no longer asked for. Members go to buckets by a hash of
 * their id (chunks.mjs bundleBuckets): a changed chunk changes ONE bundle. Off: `CONFIG.moinenMaps.noBundles = true` or localStorage
 * "mm-bundles" = "off" (the GM does not publish, a client does not read them).
 */
export const KEY = "chunkBundle";
/** Largest single file (bytes) that goes into a bundle, by the kind of chunk. */
export const LIMIT = { w: 65536, d: 32768, k: 131072, x: 131072 };
/** The flooded strokes' chunks (every load fetches them) go into one bundle of their own, whatever their size (up to this). */
export const FLOOD_LIMIT = 262144;

const off = () => { try { if ( localStorage.getItem("mm-bundles") === "off" ) return true; } catch { /* blocked */ } return !!globalThis.CONFIG?.moinenMaps?.noBundles; };   // (localStorage "mm-bundles" = "off": before a reload)

/** The scene's bundle record, or null. */
export function manifestOf(scene) {
  const c = scene?.flags?.[MODULE_ID]?.[KEY];
  return c?.v === 2 && typeof c.dir === "string" && Array.isArray(c.t) && Array.isArray(c.b) ? c : null;
}

/** A client: tell the stream which bundles a scene has. */
export function register(scene) {
  if ( !scene ) return;
  Net.setBundles(scene.id, off() ? null : manifestOf(scene));
}

const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The GM: pack what the scene's manifests name. Only chunks whose bytes this client holds (IndexedDB: it published or downloaded them)
 * and that are small go in; a bucket with fewer than two members makes no bundle. Bundles whose members did not change keep their ids
 * (no job, no upload). -> "published" | "same" | a reason it did nothing.
 */
export async function publish(scene) {
  if ( off() || !game.user?.isGM || !game.users.activeGM?.isSelf || !scene ) return "not-gm";
  const dir = Net.chunkDir(scene.id), old = manifestOf(scene);
  const ids = [...new Set(chunkRecords(scene).filter((r) => r.dir === dir).flatMap((r) => r.ids))].filter((id) => /^[wdkx]/.test(id));
  if ( ids.length < 2 ) return "nothing";
  const raw = await Net.rawMany(ids), t0 = performance.now();
  // what each bucket holds: the chunks whose bytes this client has and that are small, plus the ones the scene's CURRENT bundles already
  // hold (a client that read them from a bundle never kept their single files: their size was judged when that bundle was made)
  const oldOf = new Map();
  if ( old?.dir === dir ) for ( const [bid, m] of old.b ) for ( const id of m ) oldOf.set(id, bid);
  const next = [], fresh = [];
  const wet = new Set(floodIds(scene).filter((id) => ids.includes(id)));
  const buckets = [...bundleBuckets(ids.filter((id) => !wet.has(id))).values()];
  if ( wet.size ) buckets.push([...wet].sort());                 // (the flooded strokes: one bundle, read at every load)
  for ( const list of buckets ) {
    const members = list.filter((id) => (raw.has(id) ? raw.get(id).length <= (wet.has(id) ? FLOOD_LIMIT : LIMIT[id[0]]) : oldOf.has(id)));
    if ( members.length < 2 ) continue;
    const prev = old?.dir === dir ? old.b.find(([, m]) => sameSet(m, members)) : null;
    if ( prev ) { next.push([prev[0], prev[1]]); continue; }
    // (a changed bucket: the members whose bytes are not here are fetched as the files they still are on the server)
    const bytes = new Map();
    for ( const id of members ) {
      const b = raw.get(id) ?? await Net.fetchRaw(dir, id).catch(() => null);
      if ( b ) bytes.set(id, b);
    }
    if ( bytes.size < 2 ) continue;
    const res = await Net.job({ kind: "bundle", members: [...bytes].map(([id, b]) => ({ id, bytes: b })) });
    if ( res.ids.length < 2 ) continue;
    next.push([res.id, res.ids]); fresh.push({ id: res.id, bytes: res.bytes });
  }
  next.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const rec = { v: 2, dir, t: next.map((e) => e[0]), b: next, at: Date.now() };
  if ( old && old.dir === dir && JSON.stringify(old.b) === JSON.stringify(rec.b) ) return "same";
  if ( !next.length && !old ) return "nothing";
  if ( fresh.length ) {
    await Net.upload(dir, fresh);
    for ( const c of fresh ) Net.keep(c.id, c.bytes);
  }
  await scene.update({ [`flags.${MODULE_ID}.${KEY}`]: rec });
  console.log(`${MODULE_ID} | bundles: ${next.length} for ${next.reduce((a, e) => a + e[1].length, 0)} chunks (${fresh.length} new, ${Math.round(fresh.reduce((a, c) => a + c.bytes.length, 0) / 1024)} kB, ${Math.round(performance.now() - t0)} ms)`);
  return "published";
}

let timer = 0;
/** The GM: pack the scene a while after its manifests changed (one run at a time, at most every few seconds). */
export function schedule(sceneId, ms = 8000) {
  if ( !game.user?.isGM || off() ) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = 0;
    const scene = game.scenes.get(sceneId);
    if ( !scene || canvas.scene?.id !== sceneId ) return;
    try { await publish(scene); } catch ( err ) { console.warn(`${MODULE_ID} | bundles not published`, err); }
  }, ms);
}

Hooks.once("setup", () => { for ( const s of game.scenes ) register(s); });
Hooks.on("canvasInit", () => register(canvas.scene));
Hooks.on("createScene", (scene) => register(scene));
Hooks.on("deleteScene", (scene) => Net.setBundles(scene.id, null));
Hooks.on("updateScene", (scene, changed) => {
  const f = changed?.flags?.[MODULE_ID];
  if ( !f ) return;
  if ( KEY in f ) register(scene);
  // the manifests changed (a bake, a composite, water): the GM packs again a moment later (our own flag alone is no reason)
  if ( Object.keys(f).some((k) => k !== KEY) && scene.id === canvas.scene?.id ) schedule(scene.id);
});
// a scene opened: the GM checks that the bundles match its manifests (once the load has settled)
Hooks.on("canvasReady", () => { if ( canvas.scene ) schedule(canvas.scene.id, 20000); });
