import { MODULE_ID } from "../config.mjs";

/**
 * Runs the bake in a module worker, never on the page: a big bake must not freeze the client. When the worker cannot start, the bake
 * fails with an error (shown in the Damage panel) instead of running inline. A bake that takes longer than WATCHDOG is abandoned and
 * the worker is replaced. The worker keeps the scene's map pixels and the baked areas, so it stays while a scene with damage is open
 * and is let go ten minutes after its last job (or when the scene closes: disposeBaker).
 */
const WATCHDOG = 30000, IDLE = 600000;
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
    if ( m.progress !== undefined ) return p.onProgress?.(m.progress);
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
    const watchdog = setTimeout(() => { if ( pending.has(id) && worker === w ) fail(new Error("the destruction bake took too long")); }, WATCHDOG);
    pending.set(id, { resolve: (r) => { release(); resolve(r); }, reject: (e) => { release(); reject(e); }, onProgress, watchdog });
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
 * extra workers made for this bake and let go after it. `n` lanes at most (never more than the cores minus one, at most 4).
 */
export async function runBakePool(jobs, getMap, { n = 4, onDone = null } = {}) {
  const lanes = Math.max(1, Math.min(n, jobs.length, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
  let next = 0, error = null;
  const retry = [];                  // jobs an extra lane took and could not finish: the main lane does them
  const take = () => (error || next >= jobs.length ? -1 : next++);
  const extra = [];
  const laneMain = async () => {
    for ( let i = take(); i >= 0; i = take() ) { const r = await runBake(jobs[i], getMap); onDone?.(i, r); }
    while ( retry.length && !error ) { const i = retry.shift(); onDone?.(i, await runBake(jobs[i], getMap)); }
  };
  const laneExtra = async () => {
    const w = new Worker(foundry.utils.getRoute(`modules/${MODULE_ID}/scripts/destruction/worker.mjs`), { type: "module" });
    extra.push(w);
    let id = 0;
    const ask = (msg, transfer = []) => new Promise((resolve, reject) => {
      const my = ++id, timer = setTimeout(() => reject(new Error("the destruction bake took too long")), WATCHDOG);
      const on = (ev) => { const m = ev.data; if ( m.id !== my || m.progress !== undefined ) return; w.removeEventListener("message", on); clearTimeout(timer); m.ok ? resolve(m.result) : reject(new Error(m.error)); };
      w.addEventListener("message", on);
      w.postMessage({ id: my, ...msg }, transfer);
    });
    const m = getMap(), copy = new Uint8ClampedArray(m.map.data);
    await ask({ kind: "map", mapKey: m.key, map: { w: m.map.w, h: m.map.h, data: copy } }, [copy.buffer]);
    for ( let i = take(); i >= 0; i = take() ) {
      let r;
      try { r = await ask({ kind: "bake", input: { ...jobs[i], mapKey: m.key } }); }
      catch ( err ) { retry.push(i); throw err; }
      onDone?.(i, r);
    }
  };
  // an extra lane that fails only stops itself (its job goes to the main lane); the main lane failing fails the bake
  const extraLane = () => laneExtra().catch((err) => console.warn(`${MODULE_ID} | destruction: an extra bake worker stopped`, err));
  try {
    const others = Array.from({ length: lanes - 1 }, extraLane);
    await laneMain().catch((err) => { error ??= err; });
    await Promise.all(others);
    if ( !error ) while ( retry.length ) { const i = retry.shift(); onDone?.(i, await runBake(jobs[i], getMap)); }
  }
  finally { for ( const w of extra ) w.terminate(); }
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
  for ( const p of pending.values() ) { clearTimeout(p.watchdog); p.reject(new Error("the destruction worker was let go")); }
  pending.clear();
}
