# perf-pan (2026-11-09) - cheaper camera pans, nothing visible changes

Branch `perf-pan` (from main 59084ed), worktree `C:/mmwt-perf-pan`. Lane 5 (port 30005, world `invincible`, scene `ZZ-dir-rolls`, one token in orbit so the orbit strip shows, weather + fire on), junction flipped between `C:/mmwt-perf-pan-base` (59084ed, detached) and this worktree and back to what it was (`C:/mmwt-dir-rolls`), lease taken and released. Private headless Chrome on CDP 9533: GM = Gamemaster (127.0.0.151), P1 = Test Gracz 1 (127.0.0.152, a REAL player login), viewport 1584x805, DPR 1. All numbers are P1 with `Emulation.setCPUThrottlingRate` 2 (the i7-7700K-class approximation of `director-handoff.md` "director-opt") or 4 (worst case).

## Changes
1. `scripts/zones/orbit.mjs` strip:
   - the height is no longer read with `offsetHeight` in `place()` (every camera frame, twice: canvasPan + ticker), which forced a synchronous layout each frame. It is measured in `refresh()` right after the content is written (as before: one layout per refresh) and kept current by a `ResizeObserver` (its callback reads `offsetHeight` on a fresh layout, so the read forces nothing). Without `ResizeObserver` the old live read stays.
   - only changed style values are written (left / top every move, the transform only when the scale changes; the same place twice in one frame writes nothing).
2. `scripts/weather/weather.mjs`: `detailCap` / `lensCap` read the client settings `weatherDetail` / `weatherLens` through a small cache (game.settings.get of a client setting = local storage + a Setting document, ~65 us a call at 2x; ~30 ms per 6 s at rest). Dropped by `clientSettingChanged`, by the two settings' own `onChange` (Foundry calls onChange BEFORE that hook, so refresh() sees the new value) and after 1 s anyway (a change written by another tab). Same pattern as view-smooth.mjs.

## Before / after (interleaved base/after/base/after, 2 rounds x 2 reps = n 4 per cell, medians)
Profile attribution = samples whose deepest moinen-maps / LockView frame is that code (200 us sampling). Scenarios: glide = 4 x animatePan 1300 ms (~5 s); drag = 4 right-button drag pans via CDP input (~6 s); take = a Director destruction take-over far from the player (whole shot, 7.5 s window); follow = a Director move follow (9 s window); rest = 6 s idle. Full tables: `dev/perf-pan-ev/table-2x.md`, `table-4x.md`, raw `ab/*.json`.

2x:

| scenario | orbit strip ms (before -> after) | per camera frame | weather setting reads ms | layouts | layout ms |
|---|---|---|---|---|---|
| Director take (per shot) | 63.2 -> 7.3 | 0.80 -> 0.10 | 33.5 -> 2.5 | 296 -> 153 | 65.3 -> 47.1 |
| Director follow (per shot) | 50.9 -> 9.8 | 0.49 -> 0.18 | 31.6 -> 4.5 | 202 -> 88 | 50.4 -> 38.5 |
| glide (per 5 s of pans) | 22.5 -> 11.1 | 0.09 -> 0.04 | 25.4 -> 2.4 | 218 -> 219 | 42.6 -> 41.9 |
| drag (per 6 s of pans) | 46.0 -> 18.9 | 0.10 -> 0.04 | 39.8 -> 4.1 | 448 -> 450 | 89.3 -> 92.8 |
| rest (per 6 s) | 3.6 -> 3.4 | - | 28.2 -> 1.6 | 25 -> 25 | 16.5 -> 13.9 |

4x:

| scenario | orbit strip ms | weather setting reads ms | layouts |
|---|---|---|---|
| Director take | 72.2 -> 16.6 | 49.3 -> 7.7 | 229 -> 130 |
| Director follow | 55.0 -> 14.3 | 58.0 -> 6.5 | 194 -> 129 |
| glide | 20.9 -> 16.9 | 25.1 -> 5.2 | 216 -> 217 |
| drag | 45.3 -> 29.0 | 55.3 -> 6.2 | 455 -> 465 |
| rest | 4.3 -> 7.0 | 31.9 -> 4.5 | 25 -> 25 |

Whole-frame columns (busy ms, frames > 16.7 / 33 ms, style ms) are in the full tables but are dominated by machine drift (other lanes): at 4x the "after" rest run was 30 % busier than "before" though rest runs none of the changed code; no claim is made from them. The orbit residual after the fix is the CSS writes (~8 us each at 2x) and the per-tick compare. Director shots lose about half their layouts because the strip no longer forces one in the middle of each camera frame.

## Same look (lossless)
- Per-frame shadow check (`tools/eqcheck-start.js`): a copy of the ORIGINAL place() (live offsetHeight, writes every call) runs right after the strip's own canvasPan hook and ticker listener with the same key rule; after each, the strip's real style must equal it. After build, 2x: 0 mismatches in 2,529 checks (glide over the map's top edge with 94 different scales, wheel zoom, drag, Director take, Director follow), clamp and edge branches both hit; 4x: 0 in 2,650. The same check on the before build: 0 in 2,775 (`eq-*.json/log`).
- webm P1 before | after side by side: `dev/perf-pan-ev/video/take-ab.webm` (Director take-over), `glide-ab.webm` (camera over the top edge, strip on and off its clamp); stills `take-ab-small.png`. Same strip, size and place; shot phases differ by timing only.
- The strip's height stayed 48 px in every frame of every run (no content change during pans).

## LockView (third-party, not edited)
Measured: its `Canvas.pan` libWrapper runs on EVERY camera frame (Foundry's own animatePan and drag too, not only moinen-maps): bounding box (when on) + `viewbox.emit()` = `getUserSetting('viewbox')` (game.settings.get of the world setting `userSettings`, ~155 us at 2x) + a socket emit (~80 us). Micro at 2x: `viewbox.emit()` 235 us, a whole `canvas.pan({})` 334 us. Per scenario at 2x (before / after, unchanged by this branch): Director take 53 / 45 ms per shot, follow 78 / 46, glide 178 / 185 per 5 s, drag 320 / 333 per 6 s (~0.7 ms per camera frame).
Not changed, because it cannot be avoided from moinen-maps without changing behaviour: the emit IS the GM's live viewbox of this player (skipping or throttling it during Director shots / follow / glides would freeze or step the GM's rectangle), and every limit (bounding box, pan / zoom lock) lives in the same wrapper, so a camera move that bypasses `canvas.pan` would also bypass the limits. Reading LockView's setting through a cache would mean patching LockView / Foundry settings at runtime. The cost is the same one Foundry's own pans pay.
Limits still hold (`lv-base.json` / `lv-after.json`, `tools/lv-check.js`, a temporary 3500 px bounding-box drawing + `locks.boundingBox` on the lane scene, removed after): pan / animatePan / zoom-out moves far outside the box -> 0 frames with the view outside it, same end positions on both builds (2084/4250, 2416/4250, 2250/4250 at 0.4526); viewbox emits ran during the moves. A Director move toward the box corner came out "soft" on both builds (no camera), 0 frames outside.

## Other per-pan / at-rest costs seen (not changed)
- zones hover (`zones.mjs` onIconMove rAF: `canvas.app.view.getBoundingClientRect()` + `iconAt` getBounds per icon, and the hover zoneAt): 13-86 ms per scenario at 2x, highest in drag. Pointermove events reach the canvas during every pan (Chrome's synthetic moves as the content under the cursor moves), so it runs per camera frame. A cached canvas rect is not provably lossless (the rect read is also how it follows any move of the board), so left; candidate for a later pass.
- frame-guard / view-smooth pacing (~35-50 ms per 6 s), weather cells draw, fire art passes, destruction static cache: real per-frame work of the look, not losslessly removable here.
- Pre-existing (NOT fixed, it would change the look): the strip uses `clientCoordinatesFromCanvas` (the stage's worldTransform) from the ticker BEFORE the render updates that transform, so a camera change seen only by the tick (no canvasPan, e.g. a jump) places it one frame stale, and it stays there until the next camera change: after a Director shot's cut back home the strip sat ~700 px off (at 926-941 px instead of 1650 px) until the player moved the camera. Fix idea: `canvas.stage.updateTransform()` or computing from pivot/scale in place(); a visible behaviour change, so for the user to decide.

## Regression
- `node dev/run-all.mjs` 68/68 passed, `node dev/lang-audit.mjs` clean (worktree, final code).

## Not verified
- A real GTX 1080 / i7-7700K / 60 Hz display (CDP throttle only; the headless page runs at ~165 Hz, so per-6-s numbers are ~2.7x what a 60 Hz client pays per second for per-frame costs).
- DPR 2, Firefox, a browser zoom / font change while the strip is up (the ResizeObserver path, not exercised: the height never changed in the runs).
- The GM side of LockView's viewbox (the receiving cost of the per-frame messages).

## State restored
- Director OFF (setOn false after every run), Scientists token back at 700/1050, LockView test drawing deleted and `locks` back to {pan: false, zoom: false, boundingBox: false}; `splashOthers` untouched (true). Lane 5 junction back to `C:/mmwt-dir-rolls`, lease released, my Chrome closed.
