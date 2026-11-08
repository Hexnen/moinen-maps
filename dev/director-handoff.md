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

## 2026-11-08 - phase B, rolls and damage (agent director-rolls), branch `director-rolls`

### What it does
- `scripts/director/source-rolls.mjs` (runtime) + `scripts/director/rolls-core.mjs` (pure, `dev/director-rolls.test.mjs`, 48 checks). Invincible system only (`game.system.id === "invincible"`).
- The ROLLER's client (`preCreateChatMessage`) writes `flags.moinen-maps.dr = { a: attacker token, t: targeted tokens, s: scene }` into every Year Zero roll message (targets exist only on the roller's client; a pushed roll, which is a NEW message, keeps the last targets of that speaker when nothing is targeted).
- The LEADER (`createChatMessage`) makes one event per roll:
  - ATTACK (the roll has damage or an attack type): the box frames attacker and target(s), focus = the target. Weight 0.68 (+ extra targets, + 3 or more successes) -> a take-over; without a target 0.42 (soft at the attacker). Setup caption "Attacker -> Target" while the dice roll; result caption (kick = the names, title = "Hit! Damage 4 · stunts: 2" / "Hit! Successes: n" / "Miss!"); the hit (flash, shake) only on a hit. Pushed roll: kick "Push".
  - ROLL (anything else): weight 0.18 (soft; the calm preset's softAt 0.2 hides them): "Name: Agility" -> "... · Successes: 3 / No successes".
  - DAMAGE: the system's "Damage Taken" card (GM's Apply damage). Damage from the card (and from Invincible Plus Ultra's `dmg` flags when present: from/to/max -> Broken at 0); a second paragraph = critical injury. "Kid Omni-Man: -3 Health · Broken! / · critical injury". Weight 0.5..1 by the share of max Health.
- Every roll event is CUED ("dice"): the shot starts as planned on every client, but on each client the hit and the result caption wait until THAT client's Dice So Nice dice have landed (`waitFor3DAnimationByMessageID`, at most 9 s; at once without DSN), never before the camera is there; then the camera holds 2.2 s on the result (the Plus Ultra comic splash pops at the token, which is now on screen) and returns. Nobody reads the result before the dice show it.
- Privacy: the event follows the MESSAGE: public -> all; whispered to a GM or blind -> `who: "gm"` (never sent to a player); self roll / whispered to players only -> nothing. Hidden tokens never enter a public event (hidden attacker = "Someone", hidden target left out); names only via `publicName`. Every roll/damage shot is STRICT: a player gets it only when the focus token is visible to them (Token#visible: vision, detection, invisible status); when another listed token (the attacker in the dark) is not visible, the soft form at the focus.
- Settings: source toggles "Attacks and damage (Invincible rolls)" (`src_attacks`) and "Other rolls (Invincible)" (`src_rolls`) in the Director section. en + pl.

### Shared engine files touched (minimal, generic)
- `core.mjs`: KINDS `attack`, `damage`, `roll` (+ a `fresh` flag), GROUPS/BOOLS `attacks`, `rolls`; `normEvent`/`merged`/`plan` carry `cue`, `after` (a second caption), `strict`; captions may have a `kick` key. Queue: a `fresh` kind (damage, attack, roll: news at a place just shown, e.g. damage or a push right after the attack shot) is not dropped as "just shown" (soft at least; other kinds unchanged). `frameShot`: the whole box stays in the frame (clear of the letterbox) when it fits, zooming out down to half the player's zoom if that is what it takes (before: the frame leaned to the focus and cut the attacker off).
- `director.mjs`: `registerCue(name, fn)` (also in `api.director`), cued take-over (hit + result caption at the cue, early end CUE_AFTER after it, waits for a late cue up to the EXTRA cap) and cued soft shot (label turns into the result), `seeTokens` + strict check in `canSee`/ctx (partial visibility = soft), `captionText(shot, caption)` resolves `target`/`tname` and a caption's `kick` key; soft label "kick · title" when the caption has its own kick.
- `overlay.mjs`: `marker().setText()`.
- `index.mjs` (register), `section.mjs` (two source labels), `lang/en.json`, `lang/pl.json` (20 keys each).

### Verified (lane 5 serving the worktree, headless Chrome on CDP: GM page 127.0.0.55 = Gamemaster, PLAYER page 127.0.0.56 = Test Gracz 1 owning Kid Omni-Man; scene copy `ZZ-dir-rolls`, token vision on)
- Rolls made with the system's own code path (`YearZeroRoll(...).roll().toMessage(..., { rollMode })`, as in the roll dialog), the system's own chat-card Push button and `applyTargetDamage` (Apply damage). The roll dialog UI itself was not clicked.
- GM public attack turret -> Kid: player take-over, setup caption, dice land (DSN) -> result caption + hit, return exactly to the player's view, overlays/timers cleaned. Attacker and target both in frame (screen y 163 and 644 of 805 at zoom 0.189 from 0.35).
- The player's own attack (Kid -> turret): flags written on the player's client, take-over on the player.
- GM private roll and blind roll: NO socket packet reached the player at all (raw socket log on the player page). Player self roll: nothing.
- Hidden attacker: the shot's tokens = the target only, caption "Someone -> Kid Omni-Man".
- Invisible (status) attacker: the player got the SOFT form at its own token, "Someone -> Kid Omni-Man · Hit! Damage 2". Invisible target (the focus): nothing on the player.
- Damage after the attack shot (Apply damage ~3 s after it ended): soft "Kid Omni-Man: -3 Health" (before the `fresh` rule it was dropped). Push via the chat button: soft "Push · Kid Omni-Man -> Concussion Turret" -> "... · Miss!".
- Plain roll: soft edge arrow + label, result swapped in when the dice landed.
- Esc mid cued shot: cut, camera back exactly. `director-check watchShot` none / esc / busy all OK after the engine changes.
- Idle: no director/roll listener on the ticker at rest (idle-bench on the player: on 3.79 / killed 3.61 / on 3.89 ms per frame, noise).
- `node dev/run-all.mjs` 57/57, `node dev/lang-audit.mjs` clean.

### Not verified
- The real roll dialog / sheet buttons (only the dialog's roll code path), the stunts dialog during a shot (its Esc would be eaten by the director's Esc = cut), a damage TAKE-over (damage more than the cooldown after the attack: the ordinary take path), a critical injury card live, two GMs, DPR 2 for the new label text; cinematic-check / cinematic-fx-check not re-run (nothing changed in the show path; frameShot is director-only).

### Videos (PLAYER page, Test Gracz 1)
- `dev/director-rolls-attack.webm` - GM attack turret -> Kid: camera, setup caption, dice, "Hit! Damage 4", splash at the token, return.
- `dev/director-rolls-hit-damage.webm` - attack hit, then Apply damage: soft "-3 Health" arrow.
- `dev/director-rolls-push.webm` - the player's own attack (miss), then Push from the chat card: soft "Push · ..." with the new result.
- `dev/director-rolls-soft-roll.webm` - a plain Agility roll: soft arrow, result swapped in.
- Drive scripts: `dev/rolls-js/*.js` (watch, socket log, attack, hit, damage, push, Esc).

### Open decisions for the user
- Damage within the cooldown of its attack is a soft caption, not a second take-over. Should damage always take the camera (the climax), e.g. merged into the attack shot when it comes within a few seconds?
- Plain (non-attack) rolls: soft in standard/dramatic, hidden in calm. Keep, or off by default?
- A roll a player whispers to the GM gives that player (its author) no shot either (the engine has only "all" / "gm"). Add per-user recipients?
- Long-range attacks that do not fit even at half zoom lean to the target; a pan from attacker to target during the dice would need an explicit path start in the engine.

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

## 2026-11-08 - director OFF by default (agent director-off), branch `director-off`

### What changed
- New world setting `directorOn` (Boolean, default **false**; a world that never touched it is off). `director.mjs`: `isOn()` / `setOn(on)` (GM; switching on also drops an old `over.enabled: false`), on `api.director` too; `status().on`.
- While off: `emit`, `enqueue`, `pump`, `receive`, `start` do nothing (cut to included), so nothing is planned, sent or played; switching off ends shots on screen on every client (`skipHere`). The GM's local test shot (`preview`) still works. The destruction show (staged strokes + Action!) never depends on the switch.
- GM bar: shown to a GM also while off, then only fold + power button and "Off"; power toggles the world switch. Workspace section: the "Director on" checkbox now writes `directorOn` (the old `enabled` value stays in core.mjs, untouched). Lang en+pl: `Dir.bar.stOff`, `Dir.bar.power`, hint `Dir.h.enabled` updated.
- core.mjs untouched (merges with the sources branches).

### Verified (lane 4, headless Chrome on CDP: GM 127.0.0.45 = Gamemaster, PLAYER 127.0.0.46 = Test Gracz 1)
- Fresh world copy: director off. OFF: GM `cutTo` spot, `emit` destruction weight 1 and a real collapse paint -> the player got no shot and **no director socket message at all**; GM bar shows only fold + power + "Off".
- Click on the bar's power -> on (setting true, all bar controls back); GM cut -> the player gets a take-over, camera goes and returns exactly, cleaned up. Switching off mid-shot ends the player's take ("skip"), camera returns, nothing left.
- `cinematic-check` GM scenario 13/13 OFF and 13/13 ON; the player saw the show both times (start, strokes, impacts, end). `cinematic-fx-check` on the PLAYER 29/30 OFF and ON (same known "idle-bench rest" row as phase A). ON, right after the scenario, the director played its own destruction shots on the player (expected while on), so cinematic-fx-check must run with the player idle.
- `node dev/run-all.mjs` 56/56, `node dev/lang-audit.mjs` clean.

### Not verified
- The workspace section checkbox clicked live (the bar's power button was; both call `setOn`). A world that stored `over.enabled: false` (handled in `setOn`, not exercised).

## 2026-11-08 - phase B integration (agent director-int), branch `director-int`

### Merges
- `director-int` = `director-move` (already contained `main` fa42549, fire lighting) + `director-rolls` + `director-scene` + `director-off` (8803153). `main` had not moved past fa42549, so no further main merge was needed.
- Conflicts, all additive: `core.mjs` (KINDS move/turn + attack/damage/roll; normEvent/merged/plan carry both `lane/free/quick/play` and `cue/after/strict`), `director.mjs` (the caption line keeps move's `ph.caption !== false` AND rolls' `shot.after` / cue guard; `directorApi` exports `registerPlay`, `registerCue`, `seeTokens`, `setOn`, `isOn`), `index.mjs` (all three sources registered), `lang/en.json` + `pl.json` (both key blocks; checked with a duplicate-rejecting json load), this log (sections kept in order).

### How the sources combine (designed here)
- **An attack by the active combatant joins its combat's lane** (`source-rolls.mjs` `combatLane`: `lane: cbt-<combat id>`, `free`). So turn -> move -> attack plays as one chain: an attack while the turn/move shot is on replaces it (no return in between); an attack right after it is NOT turned soft by the rest / same-place rules (before: an attack just after a follow became a marker). Plain rolls and damage stay outside the lane (rolls' design: damage after its attack = soft caption).
- **A cued take-over is never relayed** (`core.mjs` Queue: `lastTake.cued`): the next turn / move of the lane during an attack's dice WAITS for the result instead of cutting it off, and such a waiting lane event may wait `CUED_WAIT` (6 s) longer than `stale`.
- **Arrival vs. director** (scene `holds`): a turn starting during an arrival comes soft (marker), never fights the arrival. Move's "already on my screen" check now judges from the arrival's home (the view the player lands in), not from the wide establishing start that is on screen while the arrival plays.
- **The world switch (director-off)**: while `directorOn` is off there are no move/turn events, no turn banner, no roll flags/events, no arrival and no dip. **Choice: the arrival counts as automatic Director output** (off = Foundry's plain scene change); the GM's "Test the arrival here" still plays (like the GM's test shot); switching off cuts an arrival that plays. The destruction show (Action!) stays independent.
- New pure test `dev/director-int.test.mjs` (13 checks: the chain, the cued wait, damage soft, lane supersede).

### Integration bugs found and fixed
1. Attack after the active combatant's move/turn became a soft marker (rest + same-place downgrade) -> lane + free (above).
2. A lane turn/move would have relayed (cut off) an attack still waiting for its dice -> cued shots are not relayed.
3. After a scene change the LEADER's queue still thought the old scene's take-over played (`busyUntil`): the new scene's first turn waited ~4 s and came too late (live: shot arrived after the arrival, form none). `director.mjs` onTearDown now releases `busyUntil` and `lastTake`.
4. Move/turn in-view check during an arrival judged from the wide start (everything "on screen" -> none) -> uses `Screen.home` of any screen owner.
5. A cued take-over (attack) ended at its planned end + 600 ms while its dice had not landed (DSN slow under load): the camera returned on the setup caption and the result was never shown (seen live, reproducible with a slow cue). `director.mjs` now waits for the cue until CUE_MAX lands it and lets the result stay (cap plannedEnd + EXTRA + CUE_AFTER for cued shots). Verified live with a cue that never resolves: result at ~5.5 s, held ~2 s, normal return.

### Verified (lane 4 serving this worktree, own headless Chrome on CDP port 9344: GM 127.0.0.47 = Gamemaster, PLAYER 127.0.0.48 = Test Gracz 1)
- `node dev/run-all.mjs` 60/60 (final code), `node dev/lang-audit.mjs` clean, no duplicate lang keys.
- OFF (fresh state of the lane world: off): GM cutTo, emit, an NPC move, a combat start + next turn, a public attack -> the player got NO director socket message, no banner, no caption; the roll message carried no `dr` flag.
- ON, `director-check watchShot` on the PLAYER (GM cutTo): none / esc / click / wheel / busy all OK.
- Mixed sequence on the PLAYER (`dev/director-int-mixed.webm`): combat start -> camera to Battle Beast (turn, take) -> its 10-square move RELAYS into the follow -> follow ends -> its attack on Atom Eve is a TAKE in the lane (setup caption, dice, "Hit! Damage 3 · stunts: 1", hit) -> Apply damage: soft "Atom Eve: -3 Health" -> next turn = the player's own (Atom Eve): camera goes there and STAYS. (No turn banner of ours: invincible-plus-ultra announces the start and "Your turn", by move's design.)
- Scene switch mid-follow: GM activates another scene 0.9 s into the follow -> the follow ends "scene", the arrival plays ("IB Test Scene"); the new scene's combat starts during the arrival -> the turn reaches the player at once and is SOFT ("Turn: Battle Beast" marker over the arrival); back to the first scene -> its arrival; DOM / holds / screen / ticker listeners / hook counts identical before and after, no errors (only Foundry's own missing note icons on that scene).
- Rolls on the merged code (`dev/rolls-js` with lane-4 tokens): public attack take with cued result; GM roll and blind roll -> nothing on the player's socket; Esc mid cued shot -> cut, camera exactly back, overlays clean; the player's own attack (take) and its Push from the chat card (soft "Push · ..." -> "... · Miss!").
- `cinematic-check` GM scenario 13/13 (director on).
- `cinematic-fx-check` on the PLAYER 29/30 (the known "idle-bench rest" row, ticker +1, as phase A / director-off). It needs a destruction display on the scene (with none, `cameraMoveCheck` throws on `display().fx` and leaves its show on - a check-tool limitation) and an idle player: a director shot still playing when it starts, or two overlapping runs, freeze the page clock (the harness overrides `performance.now`).
- `idle-bench rest` on the PLAYER: director on 2.07 / killed 2.03 / on 2.18 ms per frame (noise); no director, follow or arrival listener among the ticker listeners at rest.
- OFF once more with the player: a scene change -> no dip, no card; a combat start + next turn on that scene -> nothing on the player. ON again: the arrival plays.

### Not verified
- Two player pages at once, a second GM, DPR 2, touch / a real GPU; a damage TAKE-over (always soft after its attack here); the turn banner of ours live (invincible-plus-ultra announces start / "Your turn" on this world, so ours stayed quiet by design); a multi-checkpoint drag; Foundry's own scene transitions.
- The return to a scene: Foundry pans a player onto their owned token when the scene is drawn (Atom Eve here), so the arrival lands there, not on the view remembered at teardown - Foundry's behaviour, not changed.

### Video (PLAYER page, Test Gracz 1)
- `dev/director-int-mixed.webm` - combat start (camera to Battle Beast), its move followed straight on, its attack on Atom Eve (setup caption, dice, "Hit! Damage 3", splash), Apply damage (soft "-3 Health"), then the player's own turn: the camera goes to Atom Eve and stays.

### Lane 4 state
- Lane 4's `moinen-maps` junction was pointed at this worktree for the tests and set back to `C:\mmwt-director` afterwards. World copy: test combats deleted, Battle Beast back at (700,700), Atom Eve healed, the director switch left OFF; a small blast painted at (1350,250) on `director-test`.
