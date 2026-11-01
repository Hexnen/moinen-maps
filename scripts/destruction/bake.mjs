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
    const watchdog = setTimeout(() => { if ( pending.has(id) ) fail(new Error("the destruction bake took too long")); }, WATCHDOG);
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

/** RGBA -> PNG bytes, in the worker. */
export function encodeInWorker(w, h, data) {
  const copy = new Uint8ClampedArray(data);
  return call({ kind: "encode", w, h, data: copy }, [copy.buffer]);
}

export function disposeBaker() { worker?.terminate(); worker = null; workerMap = ""; clearTimeout(idleTimer); }
