import { MODULE_ID } from "../config.mjs";
import * as Trace from "../net/trace.mjs";
import { packLook } from "./look-pack.mjs";

/**
 * Runs the bake in a module worker, never on the page: a big bake must not freeze the client. When the worker cannot start, the bake
 * fails with an error (shown in the Damage panel) instead of running inline. A bake that makes no progress for WATCHDOG (the worker
 * reports after each stroke) is abandoned and the worker is replaced - the time is per stretch of work, not for the whole call (a re-cause
 * of an old stroke bakes the 138 strokes over it in one call: ~40 s on one worker). The worker keeps the scene's map pixels and the baked areas, so it stays while a scene with damage is open
 * and is let go ten minutes after its last job (or when the scene closes: disposeBaker).
 */
const WATCHDOG = 30000, IDLE = 600000;
/** The extra workers of running bake pools: let go with the main one (a scene that closes stops its pool), each failing its pending call. */
const extraLanes = new Set();
let worker = null, nextId = 1, idleTimer = 0, workerMap = "";
const pending = new Map();

function fail(err) {
  worker?.terminate(); worker = null; workerMap = "";
  for ( const p of pending.values() ) { clearTimeout(p.watchdog); p.reject(err); }
  pending.clear();
}

function start() {
  if ( worker ) return worker;
  worker = new Worker(foundry.utils.getRoute(`modules/${MODULE_ID}/scripts/destruction/worker.mjs`), { type: "module" });
  workerMap = "";
  worker.onmessage = (ev) => {
    const m = ev.data, p = pending.get(m.id); if ( !p ) return;
    if ( m.progress !== undefined ) { p.rearm?.(); return p.onProgress?.(m.progress); }
    pending.delete(m.id); clearTimeout(p.watchdog);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
  };
  worker.onerror = (e) => { console.error(`${MODULE_ID} | destruction worker`, e); fail(new Error("the destruction worker failed")); };
  return worker;
}

function release() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if ( !pending.size ) disposeBaker(); }, IDLE);
}

function call(msg, transfer = [], onProgress = null) {
  clearTimeout(idleTimer);
  return new Promise((resolve, reject) => {
    let w;
    try { w = start(); } catch ( err ) { reject(err); return; }
    const id = nextId++;
    const arm = () => setTimeout(() => { if ( pending.has(id) && worker === w ) fail(new Error("the destruction bake took too long")); }, WATCHDOG);
    const entry = { resolve: (r) => { release(); resolve(r); }, reject: (e) => { release(); reject(e); }, onProgress, watchdog: arm(), rearm: () => { clearTimeout(entry.watchdog); entry.watchdog = arm(); } };
    pending.set(id, entry);
    w.postMessage({ id, ...msg }, transfer);
  });
}

/**
 * Bake `input` (see core.mjs) in the worker. `getMap()` gives { key, map } (the scene's pixels at art resolution); they are sent only
 * when the worker does not hold them yet. Resolves with { sheet, metaRows, meta, count, stats }.
 */
export async function runBake(input, getMap, { onProgress, retried = false } = {}) {
  const m = getMap();
  if ( workerMap !== m.wkey || !worker ) {
    start();
    const copy = new Uint8ClampedArray(m.map.data);
    await call({ kind: "map", mapKey: m.key, map: { w: m.map.w, h: m.map.h, data: copy } }, [copy.buffer]);
    workerMap = m.wkey;
  }
  try {
    return await call({ kind: "bake", input: { ...input, mapKey: m.key } }, [], onProgress);
  } catch ( err ) {
    if ( err?.message !== "NOMAP" || retried ) throw err;
    workerMap = "";
    return runBake(input, getMap, { onProgress, retried: true });
  }
}

/**
 * A big bake (a scene opened with nothing cached for this bake version: dozens of strokes) on several workers at once. `jobs` are
 * inputs (each a subset of the strokes, nearest to the view first); every job resolves `onDone(i, result)` as soon as it is baked, so
 * the visible strokes come first. Lane 0 is the usual worker (it keeps what it baked for the GM's next edit); the other lanes are
 * extra workers made for this bake (no area cache: up to 8 of them must not each hold ~160 MB) and let go after it. `n` lanes at most
 * (never more than the cores minus one).
 */
export async function runBakePool(jobs, getMap, { n = 4, onDone = null, keepCache = false, prime = null } = {}) {
  const lanes = Math.max(1, Math.min(n, jobs.length, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
  let next = 0, error = null;
  const retry = [];                  // jobs an extra lane took and could not finish: the main lane does them
  const take = () => (error || next >= jobs.length ? -1 : next++);
  const extra = [];
  // PRIME (a Rebake all): the jobs only name the plain looks they read (`underKeys`) instead of carrying them (copying them into every
  // job held the page). A lane gets a look right before its first job that reads it, ONE message per look (a small copy on the page,
  // between frames), and every lane lets it go as soon as no job left reads it - each lane held every look of the scene before
  // (~250 MB per lane on "map"), the main lane even after the Rebake.
  const looks = new Map((prime ?? []).map((p) => [p.key, p.sprites]));
  const keysOf = (i) => [...new Set(Object.values(jobs[i]?.underKeys ?? {}))].filter((k) => looks.has(k));
  const refs = new Map(), LANE_PX = Number.isFinite(globalThis.CONFIG?.moinenMaps?.lanePx) ? globalThis.CONFIG.moinenMaps.lanePx : 24e6;
  if ( looks.size ) for ( let i = 0; i < jobs.length; i++ ) for ( const k of keysOf(i) ) refs.set(k, (refs.get(k) ?? 0) + 1);
  const laneSets = [];               // { have: Set, send }
  const lane = (send) => { const l = { have: new Set(), send, px: 0, peak: 0, sent: 0 }; laneSets.push(l); allLanes.push(l); return l; };
  const allLanes = [], pxOf = (k) => (looks.get(k) ?? []).reduce((a, s) => a + s.w * s.h, 0), pxKey = new Map();
  const ensure = async (l, i) => {
    // a lane keeps the looks of the jobs it ran while they fit LANE_PX (the oldest not read by this job go first), not only those of the job it
    // runs: a Rebake all of "map" sent 3665 looks (4.4 GB) to its four lanes, each one again whenever a later job of the lane read it
    const need = new Set(keysOf(i)), off = [];
    for ( const k of need ) if ( l.have.has(k) ) { l.have.delete(k); l.have.add(k); }          // (read again: the youngest)
    let over = l.px + [...need].filter((k) => !l.have.has(k) && refs.get(k)).reduce((a, k) => a + pxOf(k), 0) - LANE_PX;
    for ( const k of l.have ) { if ( over <= 0 ) break; if ( need.has(k) ) continue; off.push(k); over -= pxKey.get(k) ?? 0; }
    if ( off.length ) { for ( const k of off ) { l.have.delete(k); l.px -= pxKey.get(k) ?? 0; } l.send({ kind: "dropPlain", keys: off }).catch(() => {}); }
    for ( const k of need ) {
      if ( l.have.has(k) || !refs.get(k) ) continue;
      // (PERF: a look is thousands of small typed arrays - cloned one by one that held the page 60-400 ms a message; packed into three buffers
      // it is one memcpy, and the lane unpacks it, see packLook / unpackLook)
      const t0 = performance.now(), pk = packLook(looks.get(k)), sent = l.send(pk ? { kind: "plain", key: k, pack: pk } : { kind: "plain", key: k, sprites: looks.get(k) });
      const ms = performance.now() - t0; if ( ms > 20 ) Trace.event("slow", { name: "prime:post", ms: Math.round(ms) });
      l.have.add(k);
      const px = pxOf(k); pxKey.set(k, px); l.px += px; l.sent++; l.peak = Math.max(l.peak, l.px);
      await sent; await new Promise((r) => setTimeout(r, 0));
    }
  };
  const doneWith = (i) => {
    const gone = [];
    for ( const k of keysOf(i) ) { const n = (refs.get(k) ?? 1) - 1; refs.set(k, n); if ( n <= 0 ) { gone.push(k); looks.delete(k); } }
    if ( !gone.length ) return;
    for ( const l of laneSets ) {
      const keys = gone.filter((k) => l.have.has(k));
      if ( !keys.length ) continue;
      for ( const k of keys ) { l.have.delete(k); l.px -= pxKey.get(k) ?? 0; }
      l.send({ kind: "dropPlain", keys }).catch(() => {});
    }
  };
  const finish = (i, r) => { onDone?.(i, r); if ( refs.size ) doneWith(i); };
  // the main lane: its worker stays after the pool (a new one, after a failure, holds none of the looks)
  let mainLane = null, mainWorker = null;
  const runMain = async (i) => {
    if ( refs.size ) {
      start();
      mainLane ??= lane((msg) => call(msg));
      if ( mainWorker !== worker ) { mainWorker = worker; mainLane.have.clear(); }
      await ensure(mainLane, i);
    }
    return runBake(jobs[i], getMap);
  };
  const laneMain = async () => {
    for ( let i = take(); i >= 0; i = take() ) finish(i, await runMain(i));
    while ( retry.length && !error ) { const i = retry.shift(); finish(i, await runMain(i)); }
  };
  const laneExtra = async () => {
    const w = new Worker(foundry.utils.getRoute(`modules/${MODULE_ID}/scripts/destruction/worker.mjs`), { type: "module" });
    extra.push(w);
    let id = 0, dead = null;
    const fails = new Set();
    const ln = { w, fail: (err) => { dead ??= err; for ( const f of [...fails] ) f(dead); } };
    extraLanes.add(ln);
    // a worker script that does not load fails at once (it waited for the 30 s watchdog before)
    w.onerror = (e) => { e.preventDefault?.(); ln.fail(new Error(`an extra bake worker failed (${e.message ?? "load"})`)); };
    const ask = (msg, transfer = []) => new Promise((resolve, reject) => {
      if ( dead ) return reject(dead);
      const my = ++id, arm = () => setTimeout(() => stop(new Error("the destruction bake took too long")), WATCHDOG);
      let timer = arm();
      const stop = (err) => { clearTimeout(timer); fails.delete(stop); w.removeEventListener("message", on); reject(err); };
      const on = (ev) => { const m = ev.data; if ( m.id !== my ) return; if ( m.progress !== undefined ) { clearTimeout(timer); timer = arm(); return; } w.removeEventListener("message", on); clearTimeout(timer); fails.delete(stop); m.ok ? resolve(m.result) : reject(new Error(m.error)); };
      fails.add(stop);
      w.addEventListener("message", on);
      w.postMessage({ id: my, ...msg }, transfer);
    });
    const m = getMap(), copy = new Uint8ClampedArray(m.map.data);
    await ask({ kind: "map", mapKey: m.key, map: { w: m.map.w, h: m.map.h, data: copy } }, [copy.buffer]);
    const l = refs.size ? lane((msg) => ask(msg)) : null;
    for ( let i = take(); i >= 0; i = take() ) {
      let r;
      try {
        if ( l ) await ensure(l, i);
        r = await ask({ kind: "bake", input: { ...jobs[i], mapKey: m.key, noCache: !keepCache } });   // (an extra lane keeps no area cache - it goes after this bake - unless asked: a Rebake all's lanes keep the plain looks they baked for their next jobs)
      } catch ( err ) { retry.push(i); throw err; }
      finish(i, r);
    }
    // (this lane's worker goes with the pool: its looks with it)
    if ( l ) { laneSets.splice(laneSets.indexOf(l), 1); l.have.clear(); }
  };
  // an extra lane that fails only stops itself (its job goes to the main lane); the main lane failing fails the bake
  const extraLane = () => laneExtra().catch((err) => console.warn(`${MODULE_ID} | destruction: an extra bake worker stopped`, err));
  try {
    const others = Array.from({ length: lanes - 1 }, extraLane);
    await laneMain().catch((err) => { error ??= err; });
    await Promise.all(others);
    if ( !error ) while ( retry.length ) { const i = retry.shift(); finish(i, await runMain(i)); }
  }
  finally {
    for ( const w of extra ) w.terminate();
    for ( const ln of [...extraLanes] ) if ( extra.includes(ln.w) ) extraLanes.delete(ln);
    // the main worker keeps none of the Rebake's looks after it (a failed job left some behind)
    if ( mainLane && mainWorker === worker && worker ) call({ kind: "dropPlain", keys: null }).catch(() => {});
    // (what each lane held at most of the looks, Mpx of RGBA: x4 bytes)
    if ( allLanes.length ) Trace.event("prime-lanes", { looks: prime.length, lanes: allLanes.map((l) => ({ sent: l.sent, peakMpx: Math.round(l.peak / 1e5) / 10 })) });
  }
  if ( error ) throw error;
}

/** RGBA -> PNG bytes, in the worker. */
export function encodeInWorker(w, h, data) {
  const copy = new Uint8ClampedArray(data);
  return call({ kind: "encode", w, h, data: copy }, [copy.buffer]);
}

/** Let the worker go: every pending call is rejected and its watchdog cleared (an old watchdog must never kill a newer worker). */
export function disposeBaker() {
  worker?.terminate(); worker = null; workerMap = ""; clearTimeout(idleTimer);
  for ( const ln of [...extraLanes] ) { ln.w.terminate(); ln.fail(new Error("the destruction worker was let go")); }
  extraLanes.clear();
  for ( const p of pending.values() ) { clearTimeout(p.watchdog); p.reject(new Error("the destruction worker was let go")); }
  pending.clear();
}
