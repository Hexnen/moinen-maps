// Browser-side: a COLD player's load of the (dark) scene, frames stepped by hand (a pane without rAF):
//   const N = await import("/modules/moinen-maps/dev/night-bench.mjs");  await N.cold();   (reloads: IndexedDB emptied)
//   after the reload:  await N.run({ s: 25 })  -> bytes by kind, when the shells in view had their rim, bands waiting, swaps, heap.
import * as H from "./perf-harness.mjs";
import * as S from "./shell-bench.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const cold = () => H.coldReload();
export async function run({ s = 25 } = {}) {
  const t0 = performance.now();
  while ( !(canvas?.ready && game.modules.get("moinen-maps")?.api?.destruction?.display()) && performance.now() - t0 < 30000 ) await sleep(100);
  const T = performance.now(); let waitingMax = 0;
  while ( performance.now() - T < s * 1000 ) { H.step(2); await sleep(60); }
  const n = await H.netCheck(), dk = await S.dark(), d = game.modules.get("moinen-maps").api.destruction.display();
  return { user: game.user.name, dark: dk.dark, MB: +(n.bytesDown / 1048576).toFixed(1), req: n.requests, kinds: n.kinds, loadMB: +(n.load.kb / 1024).toFixed(1), lit: dk.lit, rimsFrom: dk.rimsFrom,
    shells: d.shellCount, swapped: d.stats.swapped ?? 0, waiting: d.cache.waiting, mode: d.cache.mode, atlasMB: dk.atlasMB, heapMB: dk.heapMB, noPixelEntries: d.stats.noPixelEntries ?? 0 };
}

/**
 * GM: Rebake all of every stroke under H.rebakeBench, started in the background (a call of the browser tool is short): poll `await N.rebakeResult()`.
 * `cfg`: CONFIG.moinenMaps flags for the run (e.g. { rebakeBatch: 48 }). The scene is drawn again first (a fresh heap: no leftovers of the last run).
 */
export async function rebakeStart(cfg = {}) {
  CONFIG.moinenMaps ??= {}; Object.assign(CONFIG.moinenMaps, cfg);
  const t0 = performance.now(); while ( !(canvas?.ready && game.modules.get("moinen-maps")?.api?.destruction?.display()) && performance.now() - t0 < 30000 ) await sleep(200);
  await sleep(6000);
  const A = game.modules.get("moinen-maps").api.destruction, ids = A.state().o.filter((o) => !o.k).map((o) => o.id);
  window.__rb = null; window.__rbDone = false; window.__heap = []; const h0 = performance.now(); clearInterval(window.__hi); window.__hi = setInterval(() => { const st = A.status({ fast: true }).rebake; window.__heap.push([Math.round((performance.now() - h0) / 100) / 10, Math.round(performance.memory.usedJSHeapSize / 1048576), st ? st.done + "+" + st.live : "-"]); }, 1000);
  H.rebakeBench({ ids, maxS: 300, tailS: 10 }).then((r) => { window.__rb = r; window.__rbDone = true; clearInterval(window.__hi); }, (e) => { window.__rb = { err: String(e) }; window.__rbDone = true; });
  return { ids: ids.length, cfg };
}
export async function rebakeResult(maxMs = 38000) {
  const t0 = performance.now(); while ( !window.__rbDone && performance.now() - t0 < maxMs ) await sleep(1000);
  const A = game.modules.get("moinen-maps").api.destruction;
  if ( !window.__rbDone ) return { done: false, rebake: A.status({ fast: true }).rebake, vis: document.visibilityState };
  const r = window.__rb; return { done: true, seconds: r.seconds, hiddenGaps: r.hiddenGaps, gaps: { n: r.gaps?.n, max: r.gaps?.max, over100: r.gaps?.over100, top: r.gaps?.top?.slice(0, 8) }, tail: r.tail && { max: r.tail.max, over100: r.tail.over100 }, heapMB: r.heapMB, loaf: r.loaf?.slice(0, 5), err: r.err };
}
/** The trace's slow events (>= ms) by name after a run: { name: { n, max, sum } }. */
export function slowBy(ms = 40) {
  const tr = game.modules.get("moinen-maps").api.destruction.net.trace(), by = {};
  for ( const e of tr.events ) if ( e.reason === "slow" && e.data.ms >= ms ) { const q = by[e.data.name] ??= { n: 0, max: 0, sum: 0 }; q.n++; q.max = Math.max(q.max, e.data.ms); q.sum += e.data.ms; }
  return by;
}
