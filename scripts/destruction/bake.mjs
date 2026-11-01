import { MODULE_ID } from "../config.mjs";

/**
 * Runs the bake in a module worker, never on the page: a big bake must not freeze the client. When the worker cannot start, the bake
 * fails with an error (shown in the Damage panel) instead of running inline. A bake that takes longer than WATCHDOG is abandoned and
 * the worker is replaced. The worker is let go a minute after its last bake.
 */
const WATCHDOG = 30000;
let worker = null, nextId = 1, idleTimer = 0;
const pending = new Map();

function fail(err) {
  worker?.terminate(); worker = null;
  for ( const p of pending.values() ) p.reject(err);
  pending.clear();
}

function start() {
  if ( worker ) return worker;
  worker = new Worker(foundry.utils.getRoute(`modules/${MODULE_ID}/scripts/destruction/worker.mjs`), { type: "module" });
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
  idleTimer = setTimeout(() => { if ( !pending.size ) { worker?.terminate(); worker = null; } }, 60000);
}

/** Bake `input` (see core.mjs) in the worker. Resolves with { sheet, metaRows, meta, count, stats }. */
export function runBake(input, { onProgress } = {}) {
  clearTimeout(idleTimer);
  return new Promise((resolve, reject) => {
    let w;
    try { w = start(); } catch ( err ) { reject(err); return; }
    const id = nextId++;
    const watchdog = setTimeout(() => { if ( pending.has(id) ) fail(new Error("the destruction bake took too long")); }, WATCHDOG);
    pending.set(id, { resolve: (r) => { release(); resolve(r); }, reject: (e) => { release(); reject(e); }, onProgress, watchdog });
    w.postMessage({ id, input });
  });
}

export function disposeBaker() { worker?.terminate(); worker = null; clearTimeout(idleTimer); }
