/**
 * Runs lib/water-worker.js in node (for the tests): the worker script itself, with importScripts, fetch of the engine files and
 * postMessage shimmed. `const w = await nodeWaterWorker(); const r = await w.call({ type: "bakeFlood", ... });`
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const LIB = fileURLToPath(new URL("../lib/", import.meta.url)).replace(/\\/g, "/");
const require = createRequire(import.meta.url);

export async function nodeWaterWorker() {
  const pending = new Map();
  let nextId = 1;
  const ctx = {
    console, setTimeout, clearTimeout, Promise, Uint8Array, TextEncoder, TextDecoder, Error,
    importScripts: (url) => { ctx.wasmoon = require(url); },
    fetch: async (url) => { const b = readFileSync(url); return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; },
    postMessage: (m) => {
      const p = pending.get(m.id); if ( !p ) return;
      if ( m.ok === undefined ) return;
      pending.delete(m.id);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
    }
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(`${LIB}water-worker.js`, "utf8"), ctx, { filename: "water-worker.js" });
  const call = (msg) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ctx.self.onmessage({ data: { ...msg, id } }); });
  const info = await call({ type: "init", base: LIB });
  return { call, info };
}
