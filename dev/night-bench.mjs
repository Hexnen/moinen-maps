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
