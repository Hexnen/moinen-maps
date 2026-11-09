# perf-arrival: the first-frame stall when a scene arrives (2026-11-09)

Branch `perf-arrival` (from main 59084ed). Goal: a shorter stall on scene arrival with nothing visible changed, so the Director's arrival card comes on time.

## Method

- Lane 4 server (127.0.0.141 GM, 127.0.0.142 Test Gracz 1), headless Chrome over CDP. The player is moved with `scene.pullUsers` from the GM page, from `map` to `street` (the scene with damage, zones, and the 4320x7680 map).
- `dev/arrival-perf.mjs` measures one arrival. It records rAF frames, ticker frames, GL uploads (texImage2D), program links (getProgramParameter > 3 ms), hook marks, long tasks, and the card insert and card frame. It also takes a CPU profile cut into windows: load, canvasReady dispatch (`by.mm` is moinen-maps' share) and first tick.
- `dev/arrival-ab.mjs` interleaves A/B. It flips the lane junction between `C:\mmwt-perf-arr-base` (A, 59084ed) and this worktree (B), reloads the player page per run, and alternates the order each round. `dev/arrival-ab-table.mjs` gives medians; `dev/arrival-ab-parts.mjs` gives moinen-maps parts.
- CPU throttle 2x and 4x, Director ON and OFF. "Cold" runs are counted apart: a run is cold when the GPU process missed its program cache (a link > 400 ms). Such misses happen randomly, in about 1 in 3 fresh pages.
- `dev/arrival-look.mjs` checks that nothing changed visibly: a webm of the arrival, a screenshot after the settle, and the zone and damage state, for each build.

## What the arrival costs (A, 2x, warm)

1. Texture load (canvasInit to canvasReady), ~0.5-0.7 s. This is mostly waiting.
2. ONE long task: the groups' draw (~80 ms) and the `canvasReady` handlers (1.2-1.6 s). Of the handlers:
   - **moinen-pixel-vfx `engine.js`, ~1.0-1.1 s** (another module);
   - moinen-maps ~0.4 s: zones relink ~0.36 s (of it, `link.mjs inRing` sampling ~0.1 s) and `hasPaint` ~24 ms.
3. The first ticker frame, ~450 ms:
   - the map texture upload (`texImage2D` 4320x7680), ~260-280 ms, Foundry's own;
   - moinen-maps' damage programs linked on first use, ~120 ms (sharp batch, map patch, band tiles). On a program-cache miss this is 2-4.5 s, and frames can stop entirely meanwhile.

The arrival card is inserted 120 ms after `play()`. It can only be painted after (2) and (3).

## Changes (all lossless)

| where | what | effect |
|---|---|---|
| `scripts/zones/link.mjs` `samplesOf` | Point-in-ring per sample replaced by a scanline: per row, every ring's crossings (the same formula), then a pointer walk. The points produced are exactly the same: `dev/zones-link-scan.test.mjs` runs the old code verbatim against the street fixture at 4 steps and 300 random zone sets (holes, multi-part, vertices on sample rows). | street: 29.9 ms to 2.5 ms (node); in the dispatch, zones 360 to 271 ms (2x) |
| `scripts/destruction/model.mjs` `hasPaint` | A 32-bit word scan (`w & 0x03030303`) plus the byte tail; non-Uint8Array keeps `.some`. Equality is checked in `composite-over.test.mjs`. | 24 to 2 ms (2x) |
| `scripts/load-warm.mjs` (new) | From `canvasInit`, on scenes with damage only: links the damage layer's three programs in the background (gl-warm `warmPrograms`, KHR_parallel_shader_compile). These are the same programs that were linked before, just earlier. `CONFIG.moinenMaps.loadWarm = false` turns it off. `masked-map.mjs` / `static-cache.mjs` now export their program factories. | first-frame links 119 ms to 0; on a cache miss, the compile happens while textures load instead of in the first frame |
| `scripts/zones/zones.mjs` `rebuild` | An LRU of 6 built zone sets, keyed by the inputs (grid, step, smooth, snap, edge, strokes). | Only for revisits within one page: no first-visit gain |

A texture upload-ahead (sending the scene's images to the GPU before canvasReady) was tried and dropped. The map image loads last, and the draw and the canvasReady handlers follow it in the same task, so there is no idle gap to use.

## Results (medians; ms; warm runs unless marked)

`frame1` = canvasReady starts to the first frame shown. `card` = canvasReady starts to the first frame with the arrival card. `cardDown` = tearDown to that frame. `stall` = the longest frame gap of the switch.

| case | build | runs | readyMM | tick1 | frame1 | card | cardDown | stall |
|---|---|---|---|---|---|---|---|---|
| 2x, Director ON | A | 5 | 493 | 459 | 1750 | 2236 | 3157 | 1865 |
| | B | 7 | 299 | 361 | 1652 | 2081 | 3060 | 1786 |
| 2x, ON, cold | A | 3 | 443 | 2773 | 5027 | 5266 | 5923 | 5477 |
| | B | 1 | 90 | 471 | 1226 | 1803 | 2674 | 1287 |
| 2x, Director OFF | A | 4 | 331 | 537 | 1723 | - | - | 1784 |
| | B | 3 | 296 | 368 | 1431 | - | - | 1500 |
| 4x, Director ON | A | 5 | 545 | 783 | 3757 | 4140 | 4732 | 3904 |
| | B | 5 | 621 | 659 | 2848 | 4400 | 5022 | 2964 |
| 4x, Director OFF | A | 4 | 794 | 789 | 3480 | - | - | 3638 |
| | B | 4 | 634 | 754 | 3378 | - | - | 3599 |
| 4x, OFF, cold | A | 2 | 482 | 3904 | 11893 | - | - | 12127 |

moinen-maps parts over the warm runs:
- 2x: zones 360 to 271, hasPaint 24 to 2, readyMM 416 to 297, first-frame links 119 to 0, upload 281 to 279 (unchanged, Foundry).
- 4x: zones 630 to 577, hasPaint 42 to 0, readyMM 725 to 621, links 55 to 0, upload 516 to 532.

Reading:
- At 2x, warm, the first frame is ~100-170 ms shorter, and the card comes ~100-150 ms earlier.
- The big gain is the cold case. A program-cache miss used to freeze the first frame for 2-4.5 s at 2x (7-17 s at 4x). Now the compile runs during the load. The one cold B run had a 1.3 s stall against 5.5 s for A.
- 4x is noisy: the run-to-run spread, ±1 s, is larger than the gain. Only the parts table is a clean signal there.
- The card is NOT on time even with B. Most of its lateness is outside moinen-maps (below).

## Lossless evidence

- `dev/perf-arrival-ev/arrival-ab-2x-dir-on.webm`: A | B side by side, 2x, Director ON. It shows the same arrival sequence, with B reaching the map earlier.
- `dev/perf-arrival-ev/look/{A,A2,B,B2}-settle1.png` + `-state.json`: two runs per build, after the settle.
  - State: zones (ids, areas, label points), map states and marks are identical across A and B.
  - Screenshots, pixels differing by > 8, outside the animated token:

    | pair | differing pixels |
    |---|---|
    | A vs A2 (same build, run-to-run) | 2838 |
    | A vs B | 1477 |
    | A2 vs B2 | 2640 |
    | B vs B2 | 11 |

    So A vs B is within the same-build noise floor. The differences that remain are the latency readout and antialiasing along the borders.
- `node dev/run-all.mjs`: 69/69 pass. `node dev/lang-audit.mjs`: clean.

## What remains (not moinen-maps)

- **moinen-pixel-vfx `engine.js` in `canvasReady`, ~1.0-1.1 s at 2x.** This is the biggest single item before the first frame and the card.
- The map texture upload in the first frame, ~270 ms at 2x (Foundry/PIXI; the texture is first drawn by the damage patch).
- Foundry's own load (texture fetch and decode), the groups' draw (~80 ms), and the render.
- `Token#panCanvas`: forced layout through the sidebar's `clientWidth`, ~63 ms (seen once).

## Not verified / open

- The zones relink is still ~270 ms at 2x in the dispatch profile, attributed mostly to `geometry.mjs distToSeg`. In node, all of `buildZones` plus `cornerPoint` for the street zones is ~13 ms, so the profile attribution under CDP throttle is suspect. Not pursued.
- The cold-case gain rests on 1 cold B run at 2x (and 0 at 4x), because cold runs are random. The mechanism is that the compile moves into the load window.
- Only the `street` scene was measured. Scenes without damage get no program warm-up (by design) and still get the zones and hasPaint gains.
- The Director card timing on a real (non-headless, GPU) player browser was not measured.
