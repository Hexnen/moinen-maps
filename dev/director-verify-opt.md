# Director verify: fix3 + opt (branch director-opt @ 9cc7b08), 2026-11-09

Independent verifier (agent director-verify-opt). Not committed.

**Setup**
- Lane 4 (port 30004, world `invincible`, scene `director-test`). Lease taken, then released.
- The lane-4 moinen-maps junction pointed at `C:\mmwt-dir-opt`. It was restored to `C:\mmwt-director`, which is what it was before.
- My own headless Chrome on CDP 9471, with GPU. GM = Gamemaster (127.0.0.91). P1 = Test Gracz 1 (127.0.0.92). P2 = Test Gracz 2 (127.0.0.93). These are real logins, each on its own origin.
- Page size 1600x900 (innerWidth 1584).
- Recordings were made with `dev/tools/cdp-rec.mjs`.
- Every per-frame number comes from the page itself.
- Baseline for A/B: `C:\mmwt-dir-fix3` (68767c2 = fix3 without opt). I swapped it in by flipping the junction and reloading P1, then flipped back.
- Evidence is in `dev/director-verify-opt-ev/`. The scripts I used are in `dev/director-verify-opt-ev/scripts/`.

## Results

| # | Check | Result | Evidence |
|---|---|---|---|
| a1 | Move whose path and destination are hidden under an open window (P1: settings window 720x620 at x 640-1360; free rect x 317-640): the shot now plays | PASS | GM moves TT2 (480,300) to (760,520). P1 got a `take`. Control, same move with no window: `none` (in view). Files: `move-under-window-p1.webm`, `move-nowindow-control-p1.webm` |
| a2 | That move shot frames the token into the free part of the screen | **FAIL** | During the follow, the token's screen x stays at 749-1050 and never enters the free rect (317-640): 0 of 68 frames inside it. A second run (TT0 300,300 to 760,560): 0 of 101 frames. In both runs the token sits behind the window for the whole shot. Files: `move-under-window-p1.webm`, `move-window-follow-p1.webm`, `move-window-follow-strip.png`. Bug 1 below |
| a3 | Combat turn (stage "glide") with the combatant under the window: framed into the free rect | PASS | TT3 was the active combatant. The camera went to pivot (799,435) at scale 1.5, which puts TT3 at screen (478,365) = the centre of the free rect (316-640 x 0-729). The math matches `turnCamera` + `centreFor` exactly. File: `turn-under-window-p1.webm` (the token samples in that file track TT5, not the active one; the camera numbers are from the rerun) |
| b1 | Arrival + Esc, nothing focused, no window: cuts the arrival and eats the Esc | PASS | Trusted key press via CDP `Input.dispatchKeyEvent`. The arrival ended ~650 ms after the Esc (its natural end is ~4.2 s). Esc did not reach the bubble phase. The main menu did not open |
| b2 | Arrival + Esc while typing in chat (prose-mirror contenteditable) | PASS | The arrival was not cut: it ran to its natural end at 4175 ms. The Director did not prevent the Esc (the editor did it itself) |
| b3 | Arrival + Esc while typing in an input inside a window (settings search) | PASS | The arrival was not cut (ended at 4301 ms). Not prevented. The window stayed open and the input kept focus |
| b4 | Arrival + Esc with a window open (focus on body) | PASS | The arrival was cut (ended 10 ms after the Esc) AND Foundry closed the window (open windows 1 -> 0). The menu did not open |
| c1 | Director section: the look dropdown refreshes after a look preset is saved | **FAIL** | Look panel "Duplicate" through the real UI: the preset "ZZ verify UI" was saved (`cinUserPresets` = {u-zz-verify-ui}). The Director "look" `<select>` still listed 5 options after 1.2 s and after 3 s. It updated only after an unrelated director state change (pause on/off). Setting the value directly gave the same result, both for add and for remove. `clientSettingChanged` fired 0 times. Bug 2 below |
| o1 | `contain: strict`: no root collapses, nothing clipped. Covers caption lb 0, caption lb 12, markers (ping + 2 edge arrows), turn banner, arrival card + veil | PASS | At 1600x900 / 1280x800 / 1920x1080 at DPR 1 and 1280x720 / 1024x768 at DPR 2 (CDP deviceScaleFactor), the page was screenshotted twice: with contain, and with contain forced to `none`. The bounding rects of every element in the roots are identical, except two arrival runs at DPR 2, where the card had moved on to `is-out` between the two shots (a timer). The roots are viewport-sized at every size. Pixel diff: captions, banner and markers 0 px > 8 (marker max diff 1/255 on ≤105 px); arrival max 3-5/255, which is the veil fade (outside the contained roots). Files: `contain-pxdiff.txt`, `look-*.json`, `contain-look-grid.png` |
| o2 | Every transition still animates | PASS | `transitionrun` counts per element+property on P1 for: a take-over (preview), 12 impacts back to back, two banners 250 ms apart, 2 markers, a caption in/out, a test arrival. Opt and fix3 match on all 29 element/property pairs (for example cin-flash opacity 13/13, cin-bar transform 8/8, mm-dir-arr-title letter-spacing 2/2). Per-frame values: the bars' translateY goes smoothly from -96.6 to 0, vignette opacity 0 -> 1, title opacity eased, the arrival title and veil eased |
| o3 | Back-to-back restarts of the same element | PASS | The flash restarted 12 times at 70 ms intervals. Each restart jumps to 0.5 and decays (0.5 -> 0.47 -> ... -> 0.21, then 0.5 again), with no missed restart. The second banner (replacement) runs its own transitions from 0 |
| o4 | Stage chip (`restyle(chip)`) | PASS | During a staged combat on P1, the chip's opacity transitionrun fired and its opacity rises from 0 |
| o5 | Idle re-check corrects a caption placed from stale kept answers | PASS | Setup: a non-window interface box was added at the bottom centre after the answers were kept, so the caption is first placed over it. The live re-check then moved it (bottom "" -> 300 px). Time from creation to the move: idle page 12 ms. At 1x with a busy-wait of 3 / 4.2 / 4.5 / 4.6 / 4.9 / 5.0 / 5.1 / 5.2 / 5.3 / 5.6 ms per frame (129-165 fps): 51-97 ms. At 4x CPU with 0 / 3 / 4.5 / 5.2 ms: 28 / 141 / 187 / 198 ms. Under load Chrome gave no idle periods: every slice came through the 16 ms timeout path. No starvation in any run |
| o6 | Esc while the setup caption is still being placed, at 4x CPU (previously not verified) | PASS | Esc at +150 ms: shot ended "cut" at 184 ms, the caption was never revealed and was removed ~450 ms later. Esc at +450 ms: cut at 474 ms, the caption faded out. Both runs: camera back exactly at home (660,400,1.2), no `.mm-dir` / `.mm-cin` left |
| o7 | Idle cost at rest (P1, director on, after the tests) | PASS | In 10 s: 0 requestIdleCallback calls, no overlay root, no canvasPan hook, no take / soft / waiting. Module ticker listeners 22 before = 22 after |
| r1 | `node dev/run-all.mjs` / `node dev/lang-audit.mjs` | PASS | 65/65; lang audit clean |
| r2 | director-check watchShot on P1 (GM cutTo) | PASS (see note) | esc: all OK. click: all OK. none: 2/2 OK. A third "none" run made while recording failed "camera back" by 6.7 scene px (8 screen px) twice. That came from the recorder: it re-applies the device metrics (1584 -> 1600 px width) in the middle of the shot. Without the recorder: OK |
| r3 | A take-over in motion (letterbox, flash, caption over the hotbar, return) | PASS (by eye) | `take-caption-p1.webm` + `take-caption-strip.png`, `take-cutto-p1.webm` + strip |
| r4 | Same shot on both players | PASS | Same shot id. P1 started it 32 ms before P2 (Date.now on one machine). P2 got "soft" because a UserConfig window covered its free screen (`freeRect().covered`), which is by design |

## Bugs

### Bug 1: a follow take-over of a move keeps the token behind the window (fix3 item 5 / task point a)

**What happens**
- fix3 made `handler.check` use `freeRect()`, so a move under an open window now plays as a take-over. Before, it was "none".
- But the follow camera (`source-move.mjs` `handler.drive` -> `move-core.followStep` -> `canvas.pan(v)`) centres the token on the WHOLE screen.
- It never uses `api.target` (which `playTake` framed into the free rect) or `freeRect()`.
- When the window covers the screen centre, the camera moves but the token stays behind the window for the whole shot. The player gets a camera jolt and does not see the subject.
- Turn shots and stage beats (`Screen.panTo` / `turnCamera` with `stageRect()`) are fine.

**Steps to reproduce** (lane, Director ON, P1 = Test Gracz 1):
1. On P1, pan to (500,500) at scale 1.5.
2. On P1, open Game Settings and run `game.settings.sheet.setPosition({left:640, top:60, width:720, height:620})`. `freeRect()` is then x 317-640.
3. On the GM page, move TT2 from (480,300) to (760,520) with `doc.update({x:760, y:520})`.
4. On P1 the result is a `take` (kind move). Sample `toScreen(token.center)` each frame: x stays at 750-1050, inside the window, for the whole shot.

**Fix idea (not applied):** offset the follow aim by the free-rect centre (as `frameShot` / `centreFor` do), i.e. aim = token + ((vw/2 - (rc.x + rc.w/2)) / scale, …).

### Bug 2: the Director section's look dropdown does not refresh when a look preset is saved or deleted (fix3 item 7 / task point c)

**What happens**
- `section.mjs` refreshes on `onSetting(["cinUserPresets"])`, which listens to `clientSettingChanged`.
- `cinUserPresets` is a WORLD setting, and in v14 that hook did not fire for it (0 calls measured).
- Nothing else calls `tell("state")` when it changes (the look panel's commit writes the scene's destruction params, not the director setting).
- So the new rebuild code is correct but only runs at the next unrelated director state change (verified: pause on -> the option appears).

**Steps to reproduce** (GM):
1. Open the workspace, Director section, and unfold "Screen effects (looks)".
2. Click "Duplicate", enter a name, OK.
3. The Director panel's "Look" select still lacks the new preset. Toggle pause in the GM bar and it appears.
4. Deleting a preset has the same problem: the deleted id stays listed.

**Fix idea (not applied):** register `cinUserPresets` with `onChange: () => tell("state")` (or a hook on `updateSetting` / `createSetting` for that key) instead of `clientSettingChanged`.

## Notes
- **Idle-scheduling starvation, theory only.** In `idleSliced`, a slice is skipped when `timeRemaining() - probeMs <= 0.5`. The skip re-registers with a fresh 16 ms timeout. A browser that delivered tiny idle periods more often than every 16 ms (a high-refresh display with short idle slivers) could therefore defer the re-check and the warm-up indefinitely while busy.
  - Chrome 156 did not do this here: under every load tried it gave no idle periods and the 16 ms timeout fired.
  - Not seen; not tested in Firefox.
  - Worst case if it happens: the caption stays where the kept answers put it until the page calms down.
- On a page with continuous PIXI frames, idle periods are shorter than one frame, so the "up to 50 ms idle slice" case is not reachable while the canvas is up (code reading).

## State restored
- Director OFF; directorGm paused false, k 1; director block = standard.
- `splashOthers` = true (never changed).
- `cinUserPresets` = {}.
- The scene's cinematic block restored to its exact previous value (`epic` plus the previous `over`).
- Combats deleted; TT0-TT6 back in their positions.
- P1 back on director-test.
- Junction back to `C:\mmwt-director`, lease released, my Chrome (9471) closed.
- Lane 4 server left running, as I found it.

## Not covered
- Firefox, Safari, a real slow machine, a real 60 Hz display, touch. Only CDP throttling (4x) on this machine, at 165 Hz headless.
- DPR 2 was only CDP `deviceScaleFactor` for the DOM / contain check. `H.setDPR` (renderer resolution) was not used. Captions placed at DPR 2 were not compared between builds.
- A Plus Ultra attack with the result caption; the turn banner in a window (fix3 verified it); the late GM skip and the GM bar states (fix3 verified them; not re-run).
- Vision / fog / hidden-token leak checks (`director-vision`, stage vision.mjs), the GM leaving mid-shot, two GMs.
- `cinematic-check` / `cinematic-fx-check`.
- The warm-up completion time after a resize was not re-measured (the opt agent measured it).
- Arrival Esc with a context menu or a tour open.
- Whether main 7c0dc44 also played the follow move under the window. In case a1 main would give "none" by the code (safeRect in view). Not run on main.
