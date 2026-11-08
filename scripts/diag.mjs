/**
 * Two cheap guards for "Foundry hangs when I switch maps, not every time":
 *
 * 1. CODE CHANGED ON DISK. A running client keeps the module code it loaded, but workers and lazy `import()`s started later (scene
 *    loads start several) read the files as they are NOW - a mix of two versions can break or stall a scene load. The live dev tree
 *    writes `build.json` (git hooks: post-commit / post-merge / post-checkout; not in the release); this client remembers the one it
 *    started with, looks again at each scene change (at most every 20 s) and, when it differs, asks once for a reload (F5).
 *    No build.json (a release install): nothing happens.
 *
 * 2. A SCENE-SWITCH LOG in localStorage ("mm-switch-log", the last 20 loads): when it started, how long canvasInit -> canvasReady
 *    took, the long tasks (> 200 ms) of that load and the errors in it. An entry is written at canvasInit already, so a load that
 *    never finished is there after a reload too. `game.modules.get("moinen-maps").api.diag.switchLog()` reads it.
 */
import { MODULE_ID } from "./config.mjs";
import { api as moduleApi } from "./attrs.mjs";

const KEY = "mm-switch-log", KEEP = 20, WATCH_MS = 4000;
let bootBuild = undefined, lastCheck = 0, warned = false;

async function readBuild() {
  try {
    const r = await fetch(`modules/${MODULE_ID}/build.json`, { cache: "no-store" });
    if ( !r.ok ) return null;
    const j = await r.json();
    return j?.commit ? String(j.commit) : null;
  } catch { return null; }
}

async function checkBuild() {
  if ( warned || bootBuild === null ) return;
  const now = Date.now();
  if ( now - lastCheck < 20000 ) return;
  lastCheck = now;
  const b = await readBuild();
  if ( bootBuild === undefined ) { bootBuild = b; return; }
  if ( b && b !== bootBuild ) {
    warned = true;
    ui.notifications?.warn(game.i18n.format("MOINENMAPS.Diag.codeChanged", { from: bootBuild.slice(0, 7), to: b.slice(0, 7) }), { permanent: true });
  }
}

/* ---------------------------------------------------------------- the switch log */

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } };
const save = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-KEEP))); } catch { /* full or blocked */ } };
let cur = null, t0 = 0, watchTimer = 0;

function write() {
  if ( !cur ) return;
  const list = load(), i = list.findIndex((e) => e.id === cur.id);
  if ( i >= 0 ) list[i] = cur; else list.push(cur);
  save(list);
}
const rel = () => Math.round(performance.now() - t0);

const longs = (() => {
  try {
    const po = new PerformanceObserver((l) => {
      if ( !cur || cur.closed ) return;
      for ( const e of l.getEntries() ) if ( e.duration > 200 ) cur.long.push([Math.round(e.startTime - t0), Math.round(e.duration)]);
      write();
    });
    po.observe({ type: "longtask", buffered: false });
    return po;
  } catch { return null; }
})();

function onError(msg) {
  if ( !cur || cur.closed ) return;
  if ( cur.err.length < 10 ) cur.err.push([rel(), String(msg).slice(0, 300)]);
  write();
}
window.addEventListener("error", (e) => onError(e.message ?? e.error));
window.addEventListener("unhandledrejection", (e) => onError(e.reason?.stack ?? e.reason?.message ?? e.reason));

Hooks.on("canvasInit", (c) => {
  clearTimeout(watchTimer);
  t0 = performance.now();
  cur = { id: `${Date.now().toString(36)}`, at: new Date().toISOString(), scene: c.scene?.name ?? "?", sceneId: c.scene?.id ?? null,
    ready: null, long: [], err: [], heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576) || null, closed: false };
  write();
  checkBuild();
});
Hooks.on("canvasReady", () => {
  if ( !cur ) return;
  cur.ready = rel();
  write();
  // long tasks and errors right after the load still belong to it
  watchTimer = setTimeout(() => { if ( cur ) { cur.closed = true; write(); } }, WATCH_MS);
});
Hooks.once("ready", () => { checkBuild(); });

export const diagApi = {
  /** The last scene loads, oldest first: { at, scene, ready (ms, null = never reached), long [[at, ms]], err [[at, text]] }. */
  switchLog: () => load(),
  clearSwitchLog: () => save([]),
  /** The build this client started with and the one on disk now. */
  async build() { return { boot: bootBuild ?? null, disk: await readBuild() }; }
};
moduleApi.diag = diagApi;
