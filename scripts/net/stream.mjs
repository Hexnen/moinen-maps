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

/*
 * A small pool of codec workers (up to 3, never more than the cores minus one): a load decodes dozens of chunks, one worker made them
 * wait in line. Each job goes to the worker with the fewest jobs; the pool is let go after IDLE without work, and started ahead of
 * time (warm) when the game is ready, so the first chunk does not pay for starting a worker.
 */
const IDLE = 30000, WATCHDOG = 30000;
const POOL = Math.max(1, Math.min(3, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
const workers = [];                  // { w, busy }
let broken = false, nextId = 1, idleTimer = 0;
const pending = new Map();           // id -> { resolve, reject, watchdog, slot }

function spawn() {
  let w;
  try { w = new Worker(foundry.utils.getRoute(`modules/${MODULE_ID}/scripts/net/chunk-worker.mjs`), { type: "module" }); }
  catch ( err ) { broken = true; console.warn(`${MODULE_ID} | chunk worker unavailable, decoding on the page`, err); return null; }
  const slot = { w, busy: 0 };
  w.onmessage = (ev) => {
    const m = ev.data, p = pending.get(m.id); if ( !p ) return;
    pending.delete(m.id); clearTimeout(p.watchdog); slot.busy--;
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
    if ( !pending.size ) { clearTimeout(idleTimer); idleTimer = setTimeout(stopWorkers, IDLE); }
  };
  w.onerror = (e) => {
    console.warn(`${MODULE_ID} | chunk worker failed`, e?.message ?? e);
    w.terminate();
    workers.splice(workers.indexOf(slot), 1);
    for ( const [id, p] of pending ) if ( p.slot === slot ) { clearTimeout(p.watchdog); pending.delete(id); p.reject(new Error("chunk worker failed")); }
  };
  workers.push(slot);
  return slot;
}

function pick() {
  if ( broken ) return null;
  const free = workers.find((s) => !s.busy);
  if ( free ) return free;
  if ( workers.length < POOL ) return spawn() ?? workers[0] ?? null;
  return workers.reduce((a, b) => (b.busy < a.busy ? b : a), workers[0]) ?? null;
}

function stopWorkers() {
  if ( pending.size ) return;
  for ( const s of workers.splice(0) ) s.w.terminate();
}

/** Start the pool (and open the cache) before it is needed: the first scene load then decodes at once. */
export function warm(n = POOL) {
  if ( broken ) return;
  while ( workers.length < n && spawn() );
  db();
  clearTimeout(idleTimer); idleTimer = setTimeout(stopWorkers, IDLE * 4);
}

/** Run a codec job in a worker (inline only when no worker can start). */
export function job(msg, transfer = []) {
  clearTimeout(idleTimer);
  const slot = pick();
  if ( !slot ) return work(msg).then((r) => r.result);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const watchdog = setTimeout(() => { if ( pending.delete(id) ) { slot.busy--; reject(new Error("chunk job took too long")); } }, WATCHDOG);
    pending.set(id, { resolve, reject, watchdog, slot });
    slot.busy++;
    slot.w.postMessage({ ...msg, id }, transfer);
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

const LIMIT = 6;
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
// at most this many decoded chunks AND this many bytes of their pixels (a busy scene's decoded strokes were ~230 MB; the destruction
// records let go of theirs once on screen and forget them here, see destruction.mjs dry())
const MEMO_MAX = 600, MEMO_BYTES = 96 * 1048576;
let memoBytes = 0;
const sizeOf = (v) => {
  let n = 0;
  for ( const s of v?.sprites ?? [] ) n += s.img?.byteLength ?? 0;
  for ( const l of v?.levels ?? [] ) n += l?.byteLength ?? 0;
  return n;
};
const drop = (id) => { if ( !memo.has(id) ) return false; memoBytes -= memo.get(id).size; memo.delete(id); return true; };
const remember = (id, v) => {
  drop(id);
  const size = sizeOf(v);
  memo.set(id, { v, size }); memoBytes += size;
  while ( memo.size > 1 && (memo.size > MEMO_MAX || memoBytes > MEMO_BYTES) ) drop(memo.keys().next().value);
};
export const forget = (id) => drop(id);

/** Decode in the pool. `own`: the bytes are not needed here any more, so they move to the worker without a copy. */
async function decode(bytes, id, own = false) {
  const t = performance.now();
  const b = own && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
  const r = await job({ kind: "decode", bytes: b, cid: id }, [b.buffer]);
  stats.decodeMs += performance.now() - t;
  return r;
}

/** Many chunks out of IndexedDB in ONE transaction (a load asks for dozens; one transaction each cost ~10 ms apiece). */
async function idbGetMany(ids) {
  const out = new Map();
  if ( !ids.length ) return out;
  const reqs = [];
  await tx(["chunks"], "readonly", (s) => { for ( const id of ids ) { const r = s.get(id); reqs.push([id, r]); } return null; });
  for ( const [id, r] of reqs ) { const v = r.result; if ( v?.bytes ) out.set(id, new Uint8Array(v.bytes)); }
  if ( out.size ) tx(["lru"], "readwrite", (l) => { const at = Date.now(); for ( const [id, b] of out ) l.put({ id, at, size: b.byteLength }); return null; });
  return out;
}

/** Chunk bytes read ahead from IndexedDB by `prefetch`, waiting for their decode. */
const preloaded = new Map();
/** Chunks on their way (one request and one decode per id, whoever asks). */
const inflight = new Map();

/**
 * Read ahead: every chunk a scene names, before the scene asks for them (canvasInit, while Foundry still loads its textures): one
 * IndexedDB transaction for all, then decode (pool) and download what is missing, nearest first. `list`: [{ dir, id, prio }].
 */
export async function prefetch(list) {
  const todo = list.filter((c) => c.id && !memo.has(c.id) && !inflight.has(c.id) && !preloaded.has(c.id));
  if ( !todo.length ) return;
  const got = await idbGetMany(todo.map((c) => c.id));
  for ( const [id, b] of got ) preloaded.set(id, b);
  await Promise.all(todo.map((c) => getChunk(c.dir, c.id, { prio: c.prio ?? 0 })));
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
  if ( memo.has(id) ) { stats.memHits++; return Promise.resolve(memo.get(id).v); }
  if ( inflight.has(id) ) return inflight.get(id);
  const p = enqueue(prio, async () => {
    if ( memo.has(id) ) return memo.get(id).v;
    if ( signal?.aborted ) return null;
    let bytes = preloaded.get(id) ?? await idbGet(id), from = "idb";
    preloaded.delete(id);
    if ( !bytes ) { bytes = await download(dir, id, false, signal); from = "net"; }
    if ( !bytes ) { stats.failed++; return null; }
    let out = null;
    try { out = await decode(bytes, id, from === "idb"); }
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
  inflight.set(id, p);
  p.finally(() => inflight.delete(id));
  return p;
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
 * past `cap` files shortens the grace to 5 minutes (storage cap). Returns the names tombstoned. A run that leaves unreferenced files
 * behind (more than `max`, or still within their grace) books the next run itself (scheduleGc `follow`): a backlog of old versions
 * (a re-bake of a whole scene leaves hundreds) drains in minutes, not one batch per publish.
 */
export async function collectGarbage(sceneId, { grace = 15 * 60000, cap = 400, max = 160 } = {}) {
  if ( gcRunning || !game.user.isGM || !game.users.activeGM?.isSelf ) return [];
  gcRunning = true;
  try {
    const done = [], left = { more: false, waitUntil: Infinity };
    // the scene's chunk folder (every file), and the module's folder: files of the first format (water-, destruction-, flood-*.png)
    done.push(...await sweep(chunkDir(sceneId), () => true, { grace, cap, max, left }));
    done.push(...await sweep(root(), (name) => /^(water|destruction|flood)-.+\.png$/.test(name), { grace, cap: Infinity, max, left }));
    if ( done.length ) console.log(`${MODULE_ID} | GC: ${done.length} unused bake file(s) emptied`, done);
    // more to do: the next batch soon (a minute), or the files still in their grace when it has passed
    if ( left.more ) followGc(sceneId, 60000);
    else if ( Number.isFinite(left.waitUntil) ) followGc(sceneId, Math.max(60000, left.waitUntil - Date.now() + 5000));
    return done;
  } finally { gcRunning = false; }
}

async function sweep(dir, accept, { grace, cap, max, left = null }) {
  {
    let listing;
    try { listing = await picker().browse("data", dir); } catch { return []; }   // no folder yet
    const files = (listing?.files ?? []).map((f) => decodeURIComponent(f)).filter((f) => f.endsWith(".png") && accept(f.split("/").pop()));
    const { out: refs, manifests } = referenced();
    // per folder: gcPick forgets sightings of files no longer in the folder it is given
    const seen = loadMap(`${SEEN_KEY}:${dir}`), dead = loadMap(`${DEAD_KEY}:${dir}`);
    for ( const f of files ) if ( refs.has(f) ) dead.delete(f);                  // uploaded again since
    const g = files.length > cap ? Math.min(grace, 5 * 60000) : grace;
    const pick = gcPick(files, refs, seen, Date.now(), { grace: g, max, dead: new Set(dead.keys()), manifests });
    if ( left && manifests ) {
      if ( pick.length >= max ) left.more = true;
      // unreferenced files still in their grace: when the earliest of them may go
      for ( const [name, at] of seen ) if ( !pick.includes(name) ) left.waitUntil = Math.min(left.waitUntil, at + g);
    }
    const done = [];
    for ( const f of pick ) {
      const name = f.split("/").pop(), id = name.replace(/\.png$/, "");
      // re-check right before: a manifest written meanwhile may name it again
      if ( referenced().out.has(f) ) continue;
      try {
        const res = await picker().upload("data", dir, new File([TOMB], name, { type: "image/png" }), {}, { notify: false });
        if ( res?.status === "error" ) throw new Error(res.message);
        dead.set(f, Date.now()); seen.delete(f); known(dir).delete(id); drop(id); stats.tombstones++;
        done.push(f);
      } catch ( err ) { console.warn(`${MODULE_ID} | GC could not tombstone ${f}`, err); break; }
    }
    saveMap(`${SEEN_KEY}:${dir}`, seen); saveMap(`${DEAD_KEY}:${dir}`, dead);
    return done;
  }
}

let gcTimer = 0, gcFollow = 0;
/**
 * A GC run a while after a publish or a scene load (2 min), at most one every 10 min: a request inside those 10 min is moved to their
 * end (it was dropped before, so a GM who kept editing never had a run and a re-baked scene kept every old version on the server).
 */
let lastGc = 0;
export function scheduleGc(sceneId, delay = 120000) {
  if ( !game.user.isGM ) return;
  clearTimeout(gcTimer);
  gcTimer = setTimeout(() => {
    const wait = lastGc + 10 * 60000 - Date.now();
    if ( wait > 0 ) { gcTimer = setTimeout(() => scheduleGc(sceneId, 0), wait); return; }
    lastGc = Date.now();
    collectGarbage(sceneId).catch((err) => console.warn(`${MODULE_ID} | GC`, err));
  }, delay);
}
/** The next batch of a run that left files behind (not bound by the 10 min: it only drains what is unreferenced already). */
function followGc(sceneId, ms) {
  clearTimeout(gcFollow);
  gcFollow = setTimeout(() => {
    if ( canvas?.scene?.id !== sceneId ) return;               // another scene now: its own load books its run
    lastGc = Date.now();
    collectGarbage(sceneId).catch((err) => console.warn(`${MODULE_ID} | GC`, err));
  }, ms);
}
// the active GM sweeps the scene's folder a while after it is loaded too (not only after a publish: a scene nobody edits any more
// still has the old versions of its last re-bake on the server)
globalThis.Hooks?.on?.("canvasReady", () => { try { if ( game.user?.isGM && game.users.activeGM?.isSelf && canvas.scene ) scheduleGc(canvas.scene.id); } catch { /* not ready */ } });

/** For the API: the codec worker and the queue (tests). */
export const debug = () => ({ workers: workers.length, busy: workers.map((s) => s.busy), broken, queue: queue.length, running, memo: memo.size, memoMB: Math.round(memoBytes / 1048576), inflight: inflight.size });
