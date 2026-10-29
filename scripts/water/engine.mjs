import { MODULE_ID } from "../config.mjs";

/**
 * The client of the water worker (lib/water-worker.js): one worker for the session, started on first use.
 */
let worker = null, ready = null, info = null, nextId = 1;
const pending = new Map();

const route = (path) => foundry.utils.getRoute(`modules/${MODULE_ID}/lib/${path}`);

function post(msg) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onFrame: msg.onFrame, onProgress: msg.onProgress, onBegin: msg.onBegin });
    const { onFrame, onProgress, onBegin, ...data } = msg;
    worker.postMessage({ ...data, id });
  });
}

function onMessage(ev) {
  const m = ev.data, p = pending.get(m.id);
  if ( !p ) return;
  if ( m.begin ) return p.onBegin?.(m.begin);
  if ( m.frame ) return p.onFrame?.(m.frame, m.levels);
  if ( m.progress !== undefined ) return p.onProgress?.(m.progress);
  pending.delete(m.id);
  m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
}

/** Starts the worker and loads the engine once. Resolves with the engine's tables: looks, ranges, defaults, code table. */
export function engineInfo() {
  if ( ready ) return ready;
  ready = (async () => {
    worker = new Worker(route("water-worker.js"));
    worker.onmessage = onMessage;
    worker.onerror = (e) => { console.error(`${MODULE_ID} | water worker`, e); for ( const p of pending.values() ) p.reject(new Error("water worker failed")); pending.clear(); };
    const base = new URL(route(""), location.href).href;
    info = await post({ type: "init", base });
    return info;
  })().catch((err) => { ready = null; worker?.terminate(); worker = null; throw err; });
  return ready;
}

/**
 * Bakes the loop. `req`: { W, H, masks, maskKey, params }. `onBegin({ box, frames, ms })` comes once the box is known, then
 * `onFrame(i, levels)` for every frame (1-based, a Uint8Array of the box).
 * Resolves with { box, frames, ms }, { empty: true } (nothing painted) or { superseded: true } (a newer bake took over).
 */
export async function bake(req, { onBegin, onFrame, onProgress } = {}) {
  await engineInfo();
  return post({ type: "bake", W: req.W, H: req.H, masks: req.masks, maskKey: req.maskKey, params: req.params, onBegin, onFrame, onProgress });
}

/** The six colours made from one (shadow .. foam). */
export async function ramp(hex, hue, sat, range) {
  await engineInfo();
  return post({ type: "palette", hex, hue, sat, range });
}

export const cachedInfo = () => info;

export function disposeEngine() {
  worker?.terminate(); worker = null; ready = null; info = null; pending.clear();
}
