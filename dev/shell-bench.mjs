// Browser-side bench of the composite's SHELLS (paste-free):   const S = await import("/modules/moinen-maps/dev/shell-bench.mjs")
//   S.load({ noJob, noPrefetch, fit })   canvas.draw() from the settled composite and wait until it is quiet (a pane in the background has no
//                                        ticker: frames are stepped by hand); noJob = the page-side way (CONFIG.moinenMaps.noShellJob),
//                                        noPrefetch = no read-ahead after the reveal. -> { shells, onScreenShells, view, zoom }
//   S.detonate({ ms, lead })             load() first, then a whole-scene Detonate (perf-harness detBench): entries played after a wait /
//                                        faded (noPixelEntries), frames over 16.7 / 33 ms, the heap and the atlases held (MB)
//   S.look(a, b)                         two perf-harness grab()s compared: { mean, bad, badPct, max }
//   S.lit({ ms })                        a DARK scene (set the darkness first): how long until every shell in view has its rim (rimsLit), the
//                                        atlas MB / heap, the chunk reads
import * as H from "./perf-harness.mjs";
const API = () => game.modules.get("moinen-maps").api.destruction;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function load({ noJob = false, noPrefetch = false, fit = false, quiet = 10 } = {}) {
  CONFIG.moinenMaps ??= {}; CONFIG.moinenMaps.noShellJob = noJob; CONFIG.moinenMaps.noPrefetch = noPrefetch;
  await canvas.draw();
  const t0 = performance.now(); let d;
  while ( performance.now() - t0 < 40000 ) { d = API().display(); if ( d?.order.length >= 100 ) break; await sleep(200); }
  if ( fit ) H.fit();
  let last = "", still = 0;
  for ( let i = 0; i < 80 && still < quiet; i++ ) { H.step(2); await sleep(250); const k = `${d.shellCount}/${d.swapQ?.length ?? 0}`; if ( k === last ) still++; else { still = 0; last = k; } }
  H.step(30); await sleep(800); H.step(20);
  const vw = d.view();
  return { shells: d.shellCount, swapped: d.stats.swapped ?? 0, areas: d.order.length, view: [vw.x0, vw.y0, vw.x1, vw.y1].map(Math.round), zoom: +canvas.stage.scale.x.toFixed(3), onScreenShells: d.order.filter((g) => g.shell && d.onScreen(g, 0.5)).length };
}

export async function detonate(opts = {}) {
  const start = await load(opts);
  // (lead: the GM's Detonate starts 350 ms ahead of its flag, destruction.mjs: the entries' clock lies in the future, as it does for a player)
  const A = API(), real = A.replay, d = A.display();
  if ( opts.lead ) A.replay = () => { d.askPixelsAhead?.(); return d.detonate(performance.now() + opts.lead); };
  let b; try { b = await H.detBench({ ms: opts.ms ?? 7000, label: opts.noJob ? "old" : "new" }); } finally { A.replay = real; }
  return { start: { shells: start.shells, onScreen: start.onScreenShells }, entries: b.entries, over16: b.over16, over33: b.over33, worst: b.worst, cpu: b.cpu,
    heapMB: [b.mem0.heapMB, b.mem1.heapPeakMB], atlasMB: [b.mem0.atlas.MB, b.mem1.atlasPeakMB], swapped: API().display().stats.swapped ?? 0 };
}

export function look(a, b) {
  let s = 0, bad = 0, max = 0; const n = a.length / 4;
  for ( let i = 0; i < a.length; i += 4 ) { const v = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); s += v; if ( v > max ) max = v; if ( v > 24 ) bad++; }
  return { mean: +(s / n).toFixed(4), bad, badPct: +(bad / n * 100).toFixed(4), max };
}

/** Dark scene: time (ms from the call) until the shells in view all have a rim; sampled every 100 ms with the ticker stepped. */
export async function lit({ ms = 20000 } = {}) {
  const d = API().display(), vw = d.view(), t0 = performance.now(), Net = await import("../scripts/net/stream.mjs"), r0 = Net.stats.requests, i0 = Net.stats.idbHits;
  const inV = (g) => { const r = g.info.rect; return !(r.x0 > vw.x1 || r.y0 > vw.y1 || r.x1 < vw.x0 || r.y1 < vw.y0); };
  const state = () => { const list = d.order.filter(inV); return { n: list.length, rim: list.filter((g) => g.rim).length, shells: list.filter((g) => g.shell).length }; };
  let s = state(), t = null, peak = 0;
  while ( performance.now() - t0 < ms ) {
    H.step(1); await sleep(80); peak = Math.max(peak, H.atlasBytes().MB);
    s = state(); if ( s.rim >= s.n - s.shells * 0 && t === null && s.rim === state().rim && s.rim > 0 && s.rim >= s.n * 0.9 ) t = Math.round(performance.now() - t0);
  }
  return { state: s, tLit90: t, atlasPeakMB: peak, atlas: H.atlasBytes(), heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576), requests: Net.stats.requests - r0, idb: Net.stats.idbHits - i0 };
}
