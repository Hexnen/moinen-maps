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
