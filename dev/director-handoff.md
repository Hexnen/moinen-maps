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

## 2026-11-08 - phase B, source "token movement + combat turns" (agent director-move), branch `director-move`

### What exists
- `scripts/director/move-core.mjs` (pure; `dev/director-move.test.mjs`, 57 checks incl. the new queue rules) + `scripts/director/source-move.mjs` (Foundry side, imported from `index.mjs`).
- **Moves** (leader, Foundry's `moveToken`): weight by `moveWeight` - the active combatant's move always takes (0.75); otherwise a move of `moveSq` squares (default 8) takes, shorter ones become a marker; a push (`displace` action, or a player's token moved by someone else in combat) and a teleport weigh more; the party exploring (players moving their own tokens outside combat) = setting `party`: off / soft (a long move = marker, never the camera; capped under the director's `takeAt`) / full.
- **Follow camera**: a take-over of a move is driven per frame from the token's own animation on every client: a critically damped spring with a little look-ahead in the direction of travel (max 1.5 squares), blended from the current view over the lead; zoom about 16x10 squares but within 0.8x .. part of `zoomIn` of the player's own zoom (unchanged with reduced motion). It lets go about 0.7 s (x holdK) after the token stops, then the normal return. One ticker listener only while it plays.
- **Combat turns**: from `updateCombat`, NOT `combatTurnChange` (the active GM gets that only after awaiting the turn events: the Year Zero card dialog held it for seconds). Every client shows the **turn banner** at once (round, the combatant's name as the tracker shows it, "Your turn"); it sits below anything across the top centre (e.g. the plus-ultra initiative bar). The leader emits a `turn` event: the camera goes to the active combatant and returns; on the player's OWN turn it stays on their token (setting `ownStay`). Combat over -> a closing banner.
- **No duplicate announcements**: when `invincible-plus-ultra` is active and its own banners are on for that client (`combatBannerEnabled` start / rounds / end, `turnMessage` "Your turn"), ours leaves those moments to it (turns of other combatants mid-round still get ours).
- Turns and the active combatant's moves share one LANE per combat (`cbt-<id>`): a newer turn supersedes a waiting one; the active combatant's move continues from the turn shot on screen with no return in between; the lane is `free` (no cooldown / rest / ping-pong downgrades: the GM's clicks pace it). Other tokens: lane `mv-<token>` (its next drag continues the follow).
- Per client (play handler "move"): nothing for the user who moved it; nothing when the path / the combatant is already fully on this player's screen (safe rect, judged from the view the player returns to); nothing when the token is hidden or not visible to this player; the follow freezes where the token leaves the player's sight and ends 0.35 s later; a soft marker of a move only when the player sees its destination. No lower third for these kinds (the banner / the motion says it); soft markers keep their label.
- Settings: world `dirMove` {move, turns, banner, ownStay, party, moveSq}; panel "Movement & turns" added to the Director section through `extendSection` (section.mjs untouched). en + pl. API: `api.directorMove` { settings, showBanner, _debug }.

### Shared files touched (small, on purpose)
- `core.mjs`: KINDS `move`, `turn`; event fields `lane` / `free` / `quick` / `play` (normEvent, merged, plan; `cleanPlay` keeps plain values only); Queue: a lane event drops the lane's pending buckets and may relay (replace) the lane's take-over that plays; `free` skips the downgrades; `quick` = 120 ms merge window. The 84 phase-A checks pass unchanged.
- `director.mjs`: `registerPlay(id, { check, drive, stay, caption })` - per-client downgrade, a driven camera instead of the one framed move, no return at the natural end, no lower third. Also on `api.director.registerPlay` (other sources may use it, e.g. an attacker -> target camera).
- `screen.mjs`: when a take-over replaces another whose bars are in, the new bars / vignette appear at once (`showNow`) instead of sliding out and in again.
- `overlay.mjs`: `safeRect` exported. `index.mjs`: one import line. `lang/en.json`, `lang/pl.json`: `Dir.kind.move/turn` + `DirMove.*`.

### Verified (lane 4, junction -> C:/mmwt-dir-move; headless Chrome over CDP: GM 127.0.0.43 = Gamemaster, PLAYER 127.0.0.44 = Test Gracz 1)
- Player page, camera sampled every 100 ms: an NPC 10-square move -> follow from ~0.6 s after the move started, settles, returns exactly; combat start -> camera to the first combatant and back; own turn (Atom Eve, owned by Test Gracz 1 in the lane copy) -> camera to the token and STAYS; the next combatant's turn -> camera there, and its move 1.5 s later RELAYS into the follow (no return in between), then back to the player's view.
- The mover gets nothing (player moving their own token: `none`); a move fully on the player's screen -> `none`; a 5-square move off screen -> soft edge arrow + label; a non-public token name shows as "Someone".
- Token-vision scene `director-vision`, PLAYER: a hidden token's move never reached the player's socket; a visible token out of vision -> `none`; a token walking out of the player's vision: the camera followed it to the last visible spot (x 501) and returned - it never went toward the destination (x 1100).
- `director-check watchShot` on the PLAYER: GM cut (none / esc) OK; esc and wheel DURING a follow: cut + return / the camera stays with the player; everything cleaned up, ticker back to its idle count.
- DPR 2 (`H.setDPR(2)`): in-view skip and follow behave the same.
- Idle: `idle-bench rest` on the player has no listener of this source; nothing left after shots (no root, banner, lane, ticker listener).
- Banner placement checked on screenshots with the plus-ultra initiative bar (below it).
- `node dev/run-all.mjs` 57/57, `node dev/lang-audit.mjs` clean.

### Not verified
- A second real player watching another player's party move (the `party` soft path is unit-tested only); touch / real GPU devices; two GMs at once; a scene change mid-follow (teardown shared with phase A); multi-checkpoint drags (the lane relay covers them by design, not exercised); an unlinked combat whose tokens are on another scene.
- `cinematic-check` / `cinematic-fx-check` were not re-run live; the screen change (`showNow`) is covered by `cinematic-fx.test` and the director-check runs above only.

### Videos (PLAYER page, Test Gracz 1)
- `dev/director-move-follow.webm` - Battle Beast walks ~17 squares off the player's screen: the camera follows, settles, returns.
- `dev/director-turns.webm` - combat start (plus-ultra's "Combat begins", our camera to the first combatant), the player's own turn (plus-ultra's "Your turn", the camera stays), Battle Beast's turn (our banner) and its move followed straight on, back to the player's view.

### Open decisions for the user
- Own turn: the camera STAYS on the player's token (no return) - a deliberate exception to "always return" (setting `ownStay`, default on).
- The turn camera returns after ~1.5 s even though the active combatant will act there; the relay only helps when it moves while the turn shot is still on. Alternative: keep the camera on the active combatant for the whole turn.
- Our banner gives way to invincible-plus-ultra's own combat banners / "Your turn" when those are on. Keep, or only one of the two systems?
- The GM (dirMode auto = bar) also sees the banner. Keep?
- Party moves default "soft" (a long exploring move = a marker for the other players, never the camera).
- Lane 4 world copy: Atom Eve's actor is owned by Test Gracz 1 there; tokens moved; test combats deleted.
