import { MODULE_ID } from "../config.mjs";
import { work, gcPick } from "./chunks.mjs";

/**
 * Streaming baked chunks between the GM and the players (the Foundry side of chunks.mjs).
 *
 *   FILES     worlds/<world>/moinen-maps/c/<scene>/<id>.png, named by a hash of their content: never overwritten with other content,
 *             so a player never reads a half-written file and the browser may cache them for good (`force-cache`).
 *   GM        encodes only the chunks the scene's manifest does not name yet (codec worker), uploads only the ones this server does not
 *             have (a few at a time), then writes the manifest (a small list of ids) into the scene flag.
 *   PLAYERS   take each chunk from memory, else IndexedDB, else download it (at most 4 at a time, nearest to the view first), check
 *             its hash, decode it in the worker and keep it in IndexedDB: a later session needs no request for a known chunk.
 *   GC        the active GM overwrites chunk files no manifest of any scene names any more with a tiny tombstone (Foundry has no file
 *             delete), only after they were seen unreferenced for 15 minutes; a player who still gets one bakes that part himself.
 * Counters for tests and the panel: `stats` (requests, bytes down / up, IndexedDB hits, uploads, tombstones).
 */

export const stats = { requests: 0, bytesDown: 0, idbHits: 0, memHits: 0, uploads: 0, bytesUp: 0, skippedUploads: 0, failed: 0, tombstones: 0, decodeMs: 0 };
export const resetStats = () => { for ( const k of Object.keys(stats) ) stats[k] = 0; };

const picker = () => foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
const root = () => `worlds/${game.world.id}/${MODULE_ID}`;
/** The folder of a scene's chunks. */
export const chunkDir = (sceneId) => `${root()}/c/${sceneId}`;
const fileOf = (dir, id) => `${dir}/${id}.png`;

/* ---------------------------------------------------------------- the codec worker */

const IDLE = 20000, WATCHDOG = 30000;
let worker = null, broken = false, nextId = 1, idleTimer = 0;
const pending = new Map();

function startWorker() {
  if ( worker || broken ) return worker;
  try {
    worker = new Worker(foundry.utils.getRoute(`modules/${MODULE_ID}/scripts/net/chunk-worker.mjs`), { type: "module" });
  } catch ( err ) { broken = true; console.warn(`${MODULE_ID} | chunk worker unavailable, decoding on the page`, err); return null; }
  worker.onmessage = (ev) => {
    const m = ev.data, p = pending.get(m.id); if ( !p ) return;
    pending.delete(m.id); clearTimeout(p.watchdog);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
    if ( !pending.size ) { clearTimeout(idleTimer); idleTimer = setTimeout(stopWorker, IDLE); }
  };
  worker.onerror = (e) => {
    console.warn(`${MODULE_ID} | chunk worker failed`, e?.message ?? e);
    const w = worker; worker = null; w?.terminate();
    for ( const p of pending.values() ) { clearTimeout(p.watchdog); p.reject(new Error("chunk worker failed")); }
    pending.clear();
  };
  return worker;
}

function stopWorker() {
  if ( pending.size ) return;
  worker?.terminate(); worker = null;
}

/** Run a codec job in the worker (inline only when no worker can start). */
export function job(msg, transfer = []) {
  clearTimeout(idleTimer);
  const w = startWorker();
  if ( !w ) return work(msg).then((r) => r.result);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const watchdog = setTimeout(() => { if ( pending.delete(id) ) reject(new Error("chunk job took too long")); }, WATCHDOG);
    pending.set(id, { resolve, reject, watchdog });
    w.postMessage({ ...msg, id }, transfer);
  });
}

/* ---------------------------------------------------------------- IndexedDB: chunk bytes by id */

const DB = "moinen-maps-chunks", CAP = 128 * 1048576;
let dbp = null, downUntil = 0, puts = 0;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("chunks", { keyPath: "id" }); req.result.createObjectStore("lru", { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return dbp;
}
const timeout = (p, ms = 1500) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
async function tx(stores, mode, fn) {
  if ( Date.now() < downUntil ) return null;
  const d = await timeout(db(), 1200);
  if ( !d ) { dbp = null; downUntil = Date.now() + 30000; return null; }
  d.onversionchange ??= () => { d.close(); dbp = null; };
  return timeout(new Promise((resolve) => {
    try {
      const t = d.transaction(stores, mode), r = fn(...stores.map((s) => t.objectStore(s)));
      t.oncomplete = () => resolve(r?.result ?? null);
      t.onerror = t.onabort = () => resolve(null);
    } catch { resolve(null); }
  }), 3000);
}

async function idbGet(id) {
  const hit = await tx(["chunks"], "readonly", (s) => s.get(id));
  if ( hit?.bytes ) tx(["lru"], "readwrite", (l) => l.put({ id, at: Date.now(), size: hit.bytes.byteLength }));
  return hit?.bytes ? new Uint8Array(hit.bytes) : null;
}

async function idbPut(id, bytes) {
  await tx(["chunks", "lru"], "readwrite", (s, l) => { s.put({ id, bytes }); l.put({ id, at: Date.now(), size: bytes.byteLength }); return null; });
  if ( ++puts % 40 === 1 ) trimIdb();
}

/** Keep the cache under CAP bytes: the chunks not used for the longest go first. */
async function trimIdb() {
  const all = await tx(["lru"], "readonly", (l) => l.getAll());
  if ( !all ) return;
  let total = all.reduce((a, r) => a + (r.size ?? 0), 0);
  if ( total <= CAP ) return;
  const old = [];
  for ( const r of all.sort((a, b) => a.at - b.at) ) { if ( total <= CAP * 0.8 ) break; old.push(r.id); total -= r.size ?? 0; }
  await tx(["chunks", "lru"], "readwrite", (s, l) => { for ( const id of old ) { s.delete(id); l.delete(id); } return null; });
}

/* ---------------------------------------------------------------- downloading */

const LIMIT = 4;
let running = 0;
const queue = [];        // { prio, run }

function pump() {
  while ( running < LIMIT && queue.length ) {
    queue.sort((a, b) => a.prio - b.prio);
    const q = queue.shift();
    running++;
    q.run().finally(() => { running--; pump(); });
  }
}
const enqueue = (prio, fn) => new Promise((resolve) => { queue.push({ prio, run: () => fn().then(resolve, () => resolve(null)) }); pump(); });

/** Decoded chunks of this session, by id (a scene switch keeps them: going back costs nothing). */
const memo = new Map();
const MEMO_MAX = 600;
const remember = (id, v) => { memo.delete(id); memo.set(id, v); while ( memo.size > MEMO_MAX ) memo.delete(memo.keys().next().value); };
export const forget = (id) => memo.delete(id);

async function decode(bytes, id) {
  const t = performance.now();
  const copy = bytes.slice();
  const r = await job({ kind: "decode", bytes: copy, cid: id }, [copy.buffer]);
  stats.decodeMs += performance.now() - t;
  return r;
}

async function download(dir, id, reload = false, signal = null) {
  stats.requests++;
  const res = await fetch(foundry.utils.getRoute(fileOf(dir, id)), { cache: reload ? "reload" : "force-cache", signal });
  if ( !res.ok ) return null;
  const b = new Uint8Array(await res.arrayBuffer());
  stats.bytesDown += b.length;
  return b;
}

/**
 * One chunk, decoded: memory, IndexedDB, else the server (once more past the browser cache when the cached file does not match:
 * a tombstone from the GC). -> the decoded payload, or null when it cannot be had.
 */
export function getChunk(dir, id, { prio = 0, signal = null } = {}) {
  if ( memo.has(id) ) { stats.memHits++; return Promise.resolve(memo.get(id)); }
  return enqueue(prio, async () => {
    if ( memo.has(id) ) return memo.get(id);
    if ( signal?.aborted ) return null;
    let bytes = await idbGet(id), from = "idb";
    if ( !bytes ) { bytes = await download(dir, id, false, signal); from = "net"; }
    if ( !bytes ) { stats.failed++; return null; }
    let out = null;
    try { out = await decode(bytes, id); }
    catch ( err ) {
      if ( from === "idb" ) tx(["chunks", "lru"], "readwrite", (s, l) => { s.delete(id); l.delete(id); return null; });
      bytes = await download(dir, id, true, signal).catch(() => null);
      try { out = bytes ? await decode(bytes, id) : null; } catch { out = null; }
      if ( !out ) { stats.failed++; console.warn(`${MODULE_ID} | chunk ${id} unusable (${err.message})`); return null; }
      from = "net";
    }
    if ( from === "idb" ) stats.idbHits++; else idbPut(id, bytes);
    remember(id, out);
    return out;
  });
}

/** A chunk the GM made here: straight into memory and IndexedDB (no request later). */
export function keep(id, bytes, decoded = null) {
  if ( decoded ) remember(id, decoded);
  return idbPut(id, bytes);
}

/* ---------------------------------------------------------------- uploading (GM) */

/** Ids each folder is known to hold (from manifests and uploads this session; a tombstoned id is taken out). */
const onServer = new Map();
export const known = (dir) => { if ( !onServer.has(dir) ) onServer.set(dir, new Set()); return onServer.get(dir); };
const madeDirs = new Set();

async function ensureDir(dir) {
  if ( madeDirs.has(dir) ) return;
  const FP = picker(), parts = dir.split("/");
  for ( let i = 3; i <= parts.length; i++ ) {
    const d = parts.slice(0, i).join("/");
    if ( madeDirs.has(d) ) continue;
    try { await FP.createDirectory("data", d, {}); } catch { /* it exists already */ }
    madeDirs.add(d);
  }
}

async function uploadOne(dir, id, bytes) {
  const FP = picker();
  const file = new File([bytes], `${id}.png`, { type: "image/png" });
  const res = await FP.upload("data", dir, file, {}, { notify: false });
  if ( !res || res.status === "error" || (!res.path && res.status !== "success") ) throw new Error(res?.message ?? "upload failed");
  stats.uploads++; stats.bytesUp += bytes.length;
  known(dir).add(id);
}

/** Upload the chunks the folder does not hold yet, three at a time. Throws when any fails (the caller retries with backoff). */
export async function upload(dir, list) {
  await ensureDir(dir);
  const set = known(dir), todo = list.filter((c) => c.bytes && !set.has(c.id));
  stats.skippedUploads += list.length - todo.length;
  let i = 0, error = null;
  const lane = async () => { while ( i < todo.length && !error ) { const c = todo[i++]; try { await uploadOne(dir, c.id, c.bytes); } catch ( err ) { error = err; } } };
  await Promise.all([lane(), lane(), lane()]);
  if ( error ) throw error;
  return todo.length;
}

/* ---------------------------------------------------------------- garbage collection (active GM) */

const TOMB = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const SEEN_KEY = `${MODULE_ID}.gcSeen`, DEAD_KEY = `${MODULE_ID}.gcDead`;
const loadMap = (k) => { try { return new Map(JSON.parse(localStorage.getItem(k) ?? "[]")); } catch { return new Map(); } };
const saveMap = (k, m) => { try { localStorage.setItem(k, JSON.stringify([...m].slice(-4000))); } catch { /* full or blocked */ } };

/** Every chunk file named by any scene's manifests (water and destruction), as full paths. `refsOf(scene)` -> [path ...]. */
const refHooks = [];
export const registerRefs = (fn) => refHooks.push(fn);
function referenced() {
  const out = new Set();
  let manifests = 0;
  for ( const scene of game.scenes ) for ( const fn of refHooks ) {
    const paths = fn(scene);
    if ( paths?.length ) { manifests++; for ( const p of paths ) out.add(p); }
  }
  return { out, manifests };
}
export const pathOf = fileOf;

let gcRunning = false;
/**
 * Tombstone what no manifest names (see gcPick). Only the active GM, one run at a time, at most `max` files a run. A scene's folder
 * past `cap` files shortens the grace to 5 minutes (storage cap). Returns the names tombstoned.
 */
export async function collectGarbage(sceneId, { grace = 15 * 60000, cap = 400, max = 64 } = {}) {
  if ( gcRunning || !game.user.isGM || !game.users.activeGM?.isSelf ) return [];
  gcRunning = true;
  try {
    const done = [];
    // the scene's chunk folder (every file), and the module's folder: files of the first format (water-, destruction-, flood-*.png)
    done.push(...await sweep(chunkDir(sceneId), () => true, { grace, cap, max }));
    done.push(...await sweep(root(), (name) => /^(water|destruction|flood)-.+\.png$/.test(name), { grace, cap: Infinity, max }));
    if ( done.length ) console.log(`${MODULE_ID} | GC: ${done.length} unused bake file(s) emptied`, done);
    return done;
  } finally { gcRunning = false; }
}

async function sweep(dir, accept, { grace, cap, max }) {
  {
    let listing;
    try { listing = await picker().browse("data", dir); } catch { return []; }   // no folder yet
    const files = (listing?.files ?? []).map((f) => decodeURIComponent(f)).filter((f) => f.endsWith(".png") && accept(f.split("/").pop()));
    const { out: refs, manifests } = referenced();
    // per folder: gcPick forgets sightings of files no longer in the folder it is given
    const seen = loadMap(`${SEEN_KEY}:${dir}`), dead = loadMap(`${DEAD_KEY}:${dir}`);
    for ( const f of files ) if ( refs.has(f) ) dead.delete(f);                  // uploaded again since
    const pick = gcPick(files, refs, seen, Date.now(), { grace: files.length > cap ? Math.min(grace, 5 * 60000) : grace, max, dead: new Set(dead.keys()), manifests });
    const done = [];
    for ( const f of pick ) {
      const name = f.split("/").pop(), id = name.replace(/\.png$/, "");
      // re-check right before: a manifest written meanwhile may name it again
      if ( referenced().out.has(f) ) continue;
      try {
        const res = await picker().upload("data", dir, new File([TOMB], name, { type: "image/png" }), {}, { notify: false });
        if ( res?.status === "error" ) throw new Error(res.message);
        dead.set(f, Date.now()); seen.delete(f); known(dir).delete(id); memo.delete(id); stats.tombstones++;
        done.push(f);
      } catch ( err ) { console.warn(`${MODULE_ID} | GC could not tombstone ${f}`, err); break; }
    }
    saveMap(`${SEEN_KEY}:${dir}`, seen); saveMap(`${DEAD_KEY}:${dir}`, dead);
    return done;
  }
}

let gcTimer = 0;
/** A GC run a while after a publish (2 min), never more often than every 10 min. */
let lastGc = 0;
export function scheduleGc(sceneId) {
  if ( !game.user.isGM ) return;
  clearTimeout(gcTimer);
  gcTimer = setTimeout(() => {
    if ( Date.now() - lastGc < 10 * 60000 ) return;
    lastGc = Date.now();
    collectGarbage(sceneId).catch((err) => console.warn(`${MODULE_ID} | GC`, err));
  }, 120000);
}

/** For the API: the codec worker and the queue (tests). */
export const debug = () => ({ worker: !!worker, broken, queue: queue.length, running, memo: memo.size });
