# Director handoff log

Each agent appends: date, branch, what was done, verified vs not.

## 2026-11-08 - phase A (agent director-a), branch `director`

### What exists
- `scripts/director/core.mjs` (pure, 84 unit checks in `dev/director.test.mjs`): event model (`normEvent`), queue (merge by time+distance, rank by weight, cooldown, rest, no ping-pong, stale drop, pause, force), shot planner (`plan`, `frameShot`, `lookFor`, `shotEnd`), per-client `decide()` (take / soft / none), presets calm/standard/dramatic/documentary.
- `scripts/director/director.mjs`: the leader (active GM, else the first active user) plans; shots go over the module socket (`"socket": true` in module.json) with a start time on the shared clock; every client plays them itself. GM-only shots/events are sent with `{recipients}` to GMs / the leader only (a player never receives them). Shot ids come from event ids (two GM sessions dedupe). Take-over = `Screen.begin` (the absorbed cinematic engine) + camera to the framed box + return to the player's own view; Esc/click cut short and return; wheel = the player takes the camera (no return). Busy player (button held on the board, wheel < 1.2 s, pan keys, ruler) gets the soft form. Hidden tokens / GM-only / outside vision (token-vision scenes: `testVisibility` on the focus and box) -> nothing. Token names only when the token's displayName is public and it is not hidden.
- `scripts/director/screen.mjs` + `stage.mjs`: the cinematic screen engine moved here (old `destruction/cinematic-fx*.mjs` re-export). `cameraMove` replays `animatePan` with our own easing (EZGlide replaces animatePan's easing globally: the camera snapped then crawled).
- `scripts/director/overlay.mjs`: soft form = ping (rings + reticle) on the spot, or an edge arrow (chevron toward it) inside the safe rect (#ui-middle less navigation/hotbar), with a caption chip; take-over caption = a lower-third in the letterbox bar. Markers follow the camera through `canvasPan` (no ticker).
- `scripts/director/sources.mjs` (leader only): destruction (+carry/plough, flood) from the flag diff and at paint time ("edited"), fire strokes, zones (quake, zone fire, flood, dark/ice/lowgrav), orbit up/down, altitude, floors.
- `scripts/director/bar.mjs`: GM bar (status, pause, skip, cut to token / spot / last, intensity %, fold) above the hotbar, left.
- `scripts/director/section.mjs`: workspace section "Director" (preset, look, captions, soft shots, sources, weights and timing, test shot, reset, my options) + the cinematic "looks" panel. en + pl.
- API `api.director`: `emit(e)`, `cutTo`, `skip`, `setPaused`, `setGmIntensity`, `status`, `preview`; hook `moinenMapsDirector` (`event` / `shot` / `end` / `state`; other modules may call `Hooks.call("moinenMapsDirector", "emit", e)`). Kill switch `CONFIG.moinenMaps.noDirector = true`. Client settings: `dirMode` (auto/full/soft/off; auto = bar only for a GM, full for a player), `dirIntensity`, reduced motion (`cinReduced`).

### Verified (lane 4, headless Chrome on CDP: GM page 127.0.0.43 = Gamemaster, PLAYER page 127.0.0.44 = Test Gracz 1, both visible)
- `dev/director-check.mjs watchShot` on the PLAYER: take-over goes to the place and returns exactly to the player's view, ends on time, cleans up (overlays, screen engine, pan hook); Esc and click cut at ~1.1 s and return; wheel leaves the camera with the player; busy player -> soft, camera untouched; reduced motion -> no zoom change, no shake/flash; `dirMode` off -> nothing.
- Token-vision copy `director-vision`: a spot in the player's vision -> take; out of vision -> none; a hidden token cut -> nothing on the player's socket at all (GM only); a visible token out of vision -> none, name "Someone".
- GM page closed 0.4 s into a shot: the player finished the shot and returned; the player became leader and plays its own emits.
- Sources live (GM paints/updates, player receives): destruction collapse/blast (take, caption in the letterbox), fire stroke (take), zone quake (take "Zone 1 collapses"), zone fire (soft, merged with its fire stroke), orbit up (take), altitude sky/ground/sky again and floor (soft).
- Cinematic regression: `cinematic-check` GM scenario 13/13 OK; `cinematic-fx-check` on the PLAYER 29/30 OK - the failing row "idle-bench rest unchanged" counts one more ticker listener at the end, which is moinen-pixel-vfx's sustained effect tick (player.mjs:527) appearing with the view (mean idle cost was lower after than before). A show staged with the cinematic mode and played with Action! through the director: staged strokes invisible to the player, the show played, the director planned no shot during it, the camera came back exactly.
- Idle: no director ticker listener, timer or pan hook at rest; idle-bench rest with the director on vs killed: player 2.16 vs 2.19 ms/frame, GM 1.88 vs 1.88 (noise).
- DPR 2 (CDP device scale 2, renderer resolution 2): the soft marker sits exactly on `canvas.clientCoordinatesFromCanvas` of the spot.
- `node dev/run-all.mjs` pass, `node dev/lang-audit.mjs` clean.

### Not verified
- Orbit landing (down), flood, carry/plough through the director live (code paths share the verified destruction/orbit ones).
- A real GPU/touch device; a second GM session at the same time (dedupe is by design, not exercised live); a scene change mid-shot.
- Finding outside the director: idle-bench's listener wrapping makes `lights.mjs` (`sleep()` -> `ticker.remove(tick)`) miss its own listener while the bench runs, so repeated benches pile up light ticks until the next wake/sleep cycle. Bench artefact only.

### Videos (PLAYER page, Test Gracz 1)
- `dev/director-take-over.webm` - destruction painted by the GM off-screen: camera goes, letterbox + caption, returns.
- `dev/director-soft.webm` - player in soft mode: a blast in view (ping + caption), then a collapse off-screen (edge arrow left of the chat column).
- `dev/director-show.webm` - three strokes staged in the cinematic mode, Action! by the GM, the show on the player.

### Open decisions for the user
- The director is ON by default for players (`dirMode` auto = full for players, GM sees only the bar). Keep?
- `"socket": true` was added to module.json: the live server needs a restart after the merge.
- The camera now ignores EZGlide's easing for director and cinematic moves (uses the look's own `camEase`). The cinematic show's camera feels different from before (smoother start).
- Picture-in-picture inset not built: an inset would need a second render of the map where the fog/vision filter must be re-applied per player (leak risk); the soft form is the marker + caption instead.
- Wheel during a take = the player takes the camera (no return); Esc/click = cut with return.

## 2026-11-08 - phase B, scene transitions (agent director-scene), branch `director-scene`

### What exists
- `scripts/director/scene-core.mjs` (pure, 45 checks in `dev/director-scene.test.mjs`): settings (`dirArrival` world: on, dip, card, shot, login, names nav|navOnly, cardMs, glideMs, holdMs), the scene flag `dirScene` ({ title, sub, off }), `titleOf` (GM's card title > navigation name > name; never more than Foundry's navigation bar already shows a player viewing that scene; Orbit's name always), `decideArrival` (full / soft / none), `dipOnTearDown`, `startView` (establish / rise / descend; a wide start is kept on the map so no empty canvas shows), `glideMs`, `timeline`.
- `scripts/director/source-scene.mjs` (per client, no socket, no leader): an ARRIVAL when this tab shows a scene it did not show last (sessionStorage; a reload or redraw of the same scene plays nothing):
  - DIP: at `canvasTearDown` with `options.nextScene` another scene, a DOM veil fades to dark over Foundry's frozen old-scene picture. Scenes with Foundry's own transition keep theirs (no dip). A 20 s safety removes a veil a failed load would leave.
  - At `canvasReady`: camera put on the start (behind the veil / before Foundry's transition captures), bars + vignette of the director's look via `Screen.begin({ owner: "arrival" })` (home = the view Foundry gave the player), the title card (kicker, title, gold rule, line under it) over the dark; the veil lifts when the module's `net/reveal.mjs` reveal is done (min 380 ms, cap `holdMs`) and after Foundry's own transition (`canvas.root.visible`); the camera glides into the player's view (own CanvasAnimation named `canvas.animatePan`, zoom on a log scale); bars go.
  - Wide start: no token vision = the scene; token vision = the union of this player's vision source shapes (after `perception.applyRenderFlags`, as Foundry does before its transitions); fog and vision are drawn by Foundry over every frame.
  - Orbit: a player who FOLLOWS their character up (orbit.mjs `mmOrbit` createToken, `game.user.character`) starts close on it and pulls back (kicker "Launch"); a landing starts high and comes down onto it ("Landing"); the Orbit scene opened by hand pulls back too.
  - Control: Esc / left click on the board = cut (camera in the player's view at once, all out); wheel / other button / pan keys = the player takes the camera. Busy player, `dirMode` soft or intensity < 0.15 = soft form (short dip, small title at the top, no camera); reduced motion = no camera move; `dirMode` off / GM "bar" = nothing; kill switch = nothing. Game paused: the card sits above Foundry's pause badge.
  - While an arrival plays, director take-overs come soft (`holds`); a destruction show or a take that still gets the screen ends the arrival.
  - Hook `moinenMapsDirector`: `arrival` ({ scene, form, title, move, native }) and `arrivalEnd` ({ scene, why }). API `api.director.arrival` (test, settings, cut, status, _debug).
- `scripts/director/scene-panel.mjs`: panel "Scene transitions" in the Director section via `extendSection` (world settings, this scene's card title / line / off, "Test the arrival here"). en + pl.
- `dev/director-scene-check.mjs`: `watchArrival`, `sample`, `leaks`, `switchLoop`, `errors`.

### Shared files touched (minimal)
- `scripts/director/director.mjs`: `export const holds = new Set()`; `busy({ ignoreHolds })` is true while a hold is set.
- `scripts/director/stage.mjs`: the canvasTearDown handler first writes `Screen.home` (the player's own view) into the old scene's `_viewPosition`, then aborts: a scene change mid-shot no longer leaves the shot's camera as that scene's remembered view.
- `scripts/director/index.mjs`: imports + `registerSceneSource()`.
- `lang/en.json`, `lang/pl.json`: 31 keys `MOINENMAPS.Dir.arr.*` appended at the end.

### Verified (lane 3, restarted for the module socket; headless Chrome CDP: GM page 127.0.0.31 = Gamemaster, PLAYER page 127.0.0.32 = Test Gracz 1)
- PLAYER, GM activates a scene: dip at tearDown, veil opaque at ready, card "Old Street" (the navName of the copy "street (dir-scene test)": its real name never shown) + line, wide start -> the player's own view exactly, bars out, everything removed (`watchArrival`, video).
- PLAYER follows own character to Orbit (`sendToOrbit`): "Launch / Orbit" + pull-back; back (`bringBack`): "Landing / Old Street" + descent onto the token (videos).
- Token vision on (sight 15): start framed from the vision shape; the video shows only the lit vision area, the rest black through the whole move.
- Load not slowed: view() -> canvasReady, arrival off vs on, balanced per scene: 81/95 vs 92/87 ms and 103/110 vs 105/103 ms; long tasks after the switch not higher with it on.
- Scene change in the middle of a director take-over (GM cutTo, player switches at 1.3 s): the new scene's arrival took the screen, no caption / bars left; the old scene remembered the player's own view (2500,4000,0.6) and going back landed there exactly. (Closes phase A's open item.)
- Director cutTo during an arrival -> soft on the player; Esc during the arrival -> camera at home within 0.7 s, veil / card / bars gone.
- Soft mode: no camera move, no bars. Reduced motion: no camera move, card + bars.
- 12 scene switches on the PLAYER (4 scenes, arrivals interrupted after 0.6-0.7 s, 4 cut at 0.9 s): no errors; DOM, holds, screen, ticker listener count and hook counts identical before and after.
- Idle: no arrival listener at rest (`idle-bench rest` on the player). GM (auto = bar): no dip, no card. Panel renders and writes the scene flag.
- `node dev/run-all.mjs` 57/57, `node dev/lang-audit.mjs` clean.

### Not verified
- Scenes with Foundry's own transition (fade, swirl...): the no-dip path and the wait on `canvas.root.visible` were not exercised live.
- Two player pages at once, DPR 2, a slow machine / touch device; the login arrival ran (state checked) but was not recorded.
- A cold first visit of a heavy scene showed a ~4 s main-thread long task after canvasReady (the module's own load work, arrival off or on); the veil stays dark through it and the card comes after it (timers cannot run on a frozen main thread).

### Videos (PLAYER page, Test Gracz 1)
- `dev/director-scene-arrival.webm` - GM activates a scene: dip, title card + line, establishing glide.
- `dev/director-scene-orbit-up.webm` - the player's character sent to orbit: follow, "Launch / Orbit", pull-back.
- `dev/director-scene-landing.webm` - back from orbit: "Landing / Old Street", descent onto the token.
- `dev/director-scene-vision.webm` - token-vision scene: the wide start shows only what the token sees.
- `dev/director-scene-paused.webm` - arrival while the game is paused (card above the pause badge).

### Open decisions for the user
- The card shows the navigation name, else the scene's name (what Foundry's navigation bar already shows a player viewing it). "Map 03 v2"-style names land on the card: switch "Name on the card" to "Navigation name only" or set a card title per scene.
- Arrival also on login / a new tab (`login` on by default); a reload of the same scene never replays.
- Each client plays its arrival when its own load is done, not on the shared clock (syncing would hold fast clients for slow ones).
- Lane 3 test world: a scene copy "street (dir-scene test)" with a "Denizen" token; Test Gracz 1's character set to that Denizen for the orbit test.
