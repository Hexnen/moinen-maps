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

## 2026-11-08 - adversary fixes (agent director-fix), branch `director-fix` (from main b4f7cf5)

Scope: every finding of `C:/mmwt-adv1/director-adversary-1.md` and `C:/mmwt-adv2/director-adversary-2.md` EXCEPT the combat camera ping-pong (a separate "combat stage mode" agent). The turn/move sources and the queue's lane rules were not touched, apart from one line in `source-move.mjs` (the banner).

### Fixes (finding -> what changed)
- **Shots from a non-leader cut to 600 ms** (adv2):
  - Cause: an event that crossed the socket had `dur: null`, which became 0.
  - Fix: `core.mjs` `num()` now treats null / "" / booleans as missing. The same guard covers x, y, weight and t.
- **Players could force take-overs, skip shots, or play past the pause** (adv1, adv2):
  - The socket handler now uses the sender id that the server appends.
  - An event from a player is a request (`core.fromPlayer`): no force / lane / free / quick, weight at most 0.85. The GM's pause and the cooldowns apply. At most 8 per 10 s per player.
  - `skip` is accepted only from a GM.
  - A `shot` record is accepted only from a GM or the leader.
  - The public API and the "emit" hook on a player's client send the same request form (`apiEmit`). The module's own sources keep their full events.
- **Leader choice; GM on another scene; GM tab in the background** (adv1, adv2):
  - `core.pickLeader` ranks clients in this order:
    1. on the players' (active) scene;
    2. tab visible;
    3. GM before player;
    4. online the longest (each client announces `{vis, since}`; a new client leads only after 1.5 s);
    5. user id.
  - So when the GM prepares another scene, another GM on the players' scene leads; if there is none, a player client on that scene stands in.
  - A lead change hands the queue over (op "handover"): pending events, cooldown/rest history, lastTake/busyUntil, and the last events for "cut to last". The old leader then forgets them.
  - A handover from a non-GM is clamped and its events become requests, unless that client was the leader before.
- **A take-over could show a place in fog** (adv1):
  - `canSee` now requires the FOCUS to be in sight; a box corner is no longer enough.
  - Moves keep the box rule, because their play handler checks the token itself.
- **Names a player should not know** (adv1, adv2):
  - `tokenName` shows a name only when this player can already read it:
    - their own token;
    - a visible token with name display on hover or always;
    - a user's assigned character;
    - a non-hidden combatant of a started combat on this scene (the tracker name);
    - the speaker of the roll's chat message.
  - Hidden tokens are never named.
- **Clicks and drags were swallowed during a shot** (adv2):
  - A left press on the board freezes the camera and goes on to Foundry.
  - On release, a click (short, under 6 px) cuts the shot and returns to the player's view.
  - A drag ends the shot as `taken`, and the view stays where the player put it.
  - The follow drive pauses while the button is pressed.
- **Esc** (adv1, adv2):
  - In a text field it is left alone.
  - With a menu, context menu, tour or window open, it cuts the shot and passes on, so Foundry closes them.
  - Otherwise it cuts the shot and is eaten (the game menu does not open).
- **LockView and Hot Pan** (adv2, adv1):
  - `cameraHeld()` is true when LockView locks panning or Hot Pan is on. Take-overs then come as soft markers; this includes the scene arrival.
  - A LockView zoom-only lock keeps the player's zoom.
  - If Hot Pan is switched on mid-shot, the shot ends as `taken` with no return.
- **sketch-reveal** (adv1):
  - If a sketch-reveal transition overlay is present at canvasReady, the director plays no arrival; sketch-reveal owns the opening.
  - While a sketch-reveal overlay is on screen, the director counts as busy (soft).
- **Open windows and the hotbar** (adv1, adv2):
  - `overlay.freeRect()` is the safe rect minus open windows (the biggest free piece). `frameShot` frames the place into that rect.
  - If windows leave no usable free piece, the shot comes soft.
  - The lower-third caption is centred over the free rect and lifted above any interface element under it.
- **Plus Ultra already shows the result** (adv2):
  - When Invincible Plus Ultra's splash shows this roll on this client, the dice cue returns `quiet`. The caption keeps only the setup line ("Omni-Man -> Kid Omni-Man").
- **Double caption** (adv2): a take-over ends the soft markers at the same place.
- **Heavy news dropped** (adv1): an event that is downgraded by cooldown or rest is never dropped as "just shown"; it comes soft at least.
- **Banner for a hidden token** (adv1): players get no turn banner when the combatant's token is hidden. The GM sees the banner with a "hidden" tag.
- **Merged count included GM-only events** (adv2): `merged()` counts and lists kinds from public events only.
- `dev/director-check.mjs`: the synthetic click now sends pointerup at the press position, so it counts as a click under the new rule.

### Not bugs
- **Roll result and move path reach players early** (adv2): Foundry already sends the same data at the same time.
  - The public roll's ChatMessage, with the full roll, reaches every client before the dice land; Dice So Nice only hides it.
  - `moveToken` fires on every client with the full waypoints.
  - Moves of hidden tokens are GM-only events and are never sent to players.
- **Raw scene name on the arrival card** (adv1): this is by design. It matches what the navigation bar shows; it is an existing open decision.
- **Damage marker next to the "Damage taken" card** (adv2): kept, because the marker shows where it happened. The duplicate result caption is now quiet.

### Verified
Lane 5 served this worktree. Tool: headless Chrome CDP (port 9371). Logins:
- Gamemaster (GM);
- Test Gracz 1 (player, owns Kid Omni-Man);
- Test Gracz 2 (player, temporarily owner of Omni-Man);
- claude (second GM).

Test scene: ZZ-dir-rolls, token vision on.

- **Tests:** `node dev/run-all.mjs` passes, including the new `dev/director-fix.test.mjs` (32 checks). `node dev/lang-audit.mjs` is clean.
- **Shot timing:** an orbit started by the non-leader GM claude played on TG2 with hold 2040 ms (len 3790); claude's cut to a place played with hold 2160 (len 3910). Before the fix: hold 600.
- **Player requests:**
  - With the GM's pause on, TG1's forced emit (API and hook) reached TG2 as nothing.
  - A forged shot from TG1 was ignored. The same record replayed locally on TG2 did play, so the forged record itself was valid.
  - TG1's skip during a GM cut was ignored; TG2's shot ended "done".
- **Leader:**
  - claude logging in: the leader stayed Gamemaster on all pages.
  - GM tab hidden (simulated): claude took the lead with the history (3 entries), and claude's cut to the last event played. GM tab visible again: Gamemaster led again.
  - Both GMs viewing another scene: TG2 led. TG1 moved Kid (the active combatant); TG2 got the take and returned exactly to its view. Before the fix: no shot.
- **Fog:** the focus was out of TG1's sight while the box corners were in sight → TG1 got nothing.
- **Names:**
  - TG1 read "Omni-Man -> Kid Omni-Man" both in combat and out of combat.
  - TG2 read the same in combat, and "Omni-Man -> Someone" out of combat (no rule reveals Kid to TG2).
- **Plus Ultra:** only the setup line showed; Plus Ultra's splash and card showed the result. The caption sat above the hotbar and Plus Ultra's buttons (`dev/director-fix-attack-names.webm`).
- **Input** (real CDP mouse and keys on TG1):
  - drag of Kid during a shot → the token moved, the shot ended "taken", the camera stayed (`dev/director-fix-drag-during-shot.webm`);
  - click on the empty board → cut, camera back exactly;
  - click on Kid → Kid selected, cut, camera back;
  - Esc with nothing open → cut, game menu not opened;
  - Esc with the sheet open → cut and the sheet closed;
  - Esc while typing in chat → the shot played to the end;
  - `director-check watchShot` none / esc / click / wheel / busy: all OK.
- **Windows:**
  - Sheet open on the right → the token landed in the centre of the free left part, with the caption centred there (`dev/director-fix-window-framing.webm`).
  - Full-size sheet → soft marker.
- **LockView, Hot Pan:**
  - LockView pan lock → soft marker.
  - Hot Pan on → soft marker.
  - Hot Pan switched on during a take → the shot ended "taken" with no return.
- **sketch-reveal:** activating a scene with a sketch transition → no director arrival on TG1/TG2. Control: a scene without one played the arrival.
- **Soft marker then take at the same place:** the marker ended when the take started; one caption.
- **Heavy event after a cooldown:** a 0.95 event at a just-shown place → soft marker. Before the fix: nothing.
- **Hidden turret's turn:** no banner on TG1/TG2. Control: Omni-Man's turn showed the banner.
- **Merged events:** a public event plus 2 GM-only events → TG1 shot with n=1, kinds [custom].

### Not verified
- Real browser timer throttling of a hidden leader tab (only simulated).
- The player rate limit live.
- LockView zoom-only and bounding-box locks.
- DPR 2; touch input.
- `cinematic-check`, `cinematic-fx-check` and `idle-bench` were not re-run. The screen engine and the show are untouched, and no ticker work was added. TG1 at rest: no overlay, no pan hook.

### Shared files touched (small, for the merge with the combat-stage branch)
- **`core.mjs`:**
  - `num()`;
  - `merged()` (n / kinds);
  - `Queue.pump`: one `wanted` constant and the soft-drop condition;
  - `frameShot` (`view.rect`);
  - new `pickLeader` and `fromPlayer`.
  - No lane or combat rule changed.
- **`director.mjs`:**
  - leader election and handover (replaces `leaderId` / `isLeader`);
  - `emit` / `apiEmit`, `onSocket`, `canSee`;
  - `busy`, `cameraHeld`, `zoomHeld`, `ctxOf`;
  - `tokenName`, `playTake`, `endTake`;
  - ready wiring.
- **`overlay.mjs`:** `windowRects`, `freeRect`, caption placement.
- **`source-rolls.mjs`:** `withMsg`, `announcedHere`.
- **`source-scene.mjs`:** sketch-reveal check and `cameraHeld`.
- **`source-move.mjs`:** one line (banner visibility and the GM tag).

### Open decisions for the user
- **Player as stand-in leader.** When no GM views the players' scene, a player's client may lead and plan shots for everyone. Alternative: the director pauses while the GM is away.
- **Hidden GM tab.** It hands the lead to a visible client on the scene, which can be a player. Keep, or hand it only to another GM?
- **Player API events.** They stay allowed as requests (weight at most 0.85, no force). Stricter option: soft markers only.
- **Covering window.** A window covering the whole free screen makes take-overs soft.
- **Hidden names.** A fellow PC that is not a user's assigned character, outside combat, with token names off, still reads "Someone".

### Lane 5 state
- Director OFF and not paused.
- Ownership and token position, sight and lights restored. The turret unhidden for the test is unhidden again; the three turrets that were hidden before stay hidden.
- Test combats deleted.
- Sketch flag off; Hot Pan off; active scene ZZ-dir-rolls.
- Test attack chat messages remain in the world.
- Junction back to `C:\mmwt-dir-rolls`; lease released; headless Chrome closed.

## Combat stage mode (branch `director-stage`, 2026-11-08)

The user's choice: in combat the camera stays on the active combatant for its whole turn (turn, move, attack and result are one piece of staging), then carries straight on to the next combatant. It goes home only when combat ends or on the player's own turn. The letterbox is only for the big beats (hits).

### What it does (client-side, per player; `scripts/director/stage-core.mjs` pure + `source-stage.mjs`)
- A stager restyles the take-overs of the combat lane `cbt-<id>` (registered via `registerStager` in `director.mjs`).
  - A turn is a calm glide with no bars. If the combatant is already comfortable on screen (the safe rect less 16%, at the stage zoom), nothing moves.
  - A move is followed.
  - An attack plays in place when both tokens are comfortable. Otherwise it is framed, with the push-in capped at 1.25 x home.
- Bars: setting `hits` (default) shows them only on a hit; `attacks` or `never` are the alternatives.
- After a beat the camera stays parked with the action. The next combatant's turn carries on from there. Home is not overwritten on a relay.
- Home is restored:
  - on the player's own turn (deferred until a beat ends; home shifts to bring the player's own token on screen);
  - when combat ends;
  - when the director is switched off;
  - on Esc, or on the "My view" chip shown while parked.
- Esc is ignored in text fields and while a framed window is open (the window gets it first).
- Player control:
  - Any own pan or zoom (wheel, drag, Esc during a beat) makes the camera the player's.
  - The rest of that turn, and at least `back` s (default 5), stay soft (markers only).
  - Canvas.pan calls that do not change the view do not count as own pans; some code on this world makes them.
  - Own beats (own turn, move, attack) never move the player's camera. An own attack whose tokens are off screen is soft.
- Hidden or unseen combatants never move the camera (`seenTok`).
- World setting `dirStage` {on, bars, back}, panel "Combat stage" in the director section. Status, debug and trace are at `api.directorStage`.
- Shared files: small edits in `director.mjs` (stager hook in start/playTake, `taken` on the end hook) and `screen.mjs` (`barsLater` + `revealBars`). `index.mjs` has one import line, and the lang files gained the `DirStage.*` keys. `core.mjs` is untouched.

### Numbers (lane 4, adversaries' scenario: 5 combatants, normal GM pace, ~47 s; real players Test Gracz 1 = P1 owning Atom Eve, Test Gracz 2 = P2 owning nothing)
| run | P1 moves / away / bars / trips | P2 moves / away / bars / trips |
|---|---|---|
| before (main b4f7cf5) | 13 / 28.2 s / 23.4 s / 6 | 15 / 32.4 s / 26.8 s / 8 |
| stage off | 13 / 27.7 s / 23.0 s / 6 | 15 / 32.2 s / 26.1 s / 7 |
| stage on, final | 8 / 30.6 s / 0 s / 2 | 9 / 42.3 s / 0 s / 1 |

- Time away from home rises by design, because the camera stays with the action.
- Camera moves and round trips to home drop: P1's 2 trips are its own turn and the combat end.
- All final attacks missed, so there were no bars. An earlier "after" run with hits showed 2.2 s (P1) and 4.4 s (P2) of bars.

### Verified (headless Chrome CDP 9377; GM 127.0.0.81 Gamemaster, P1 127.0.0.82 Test Gracz 1, P2 127.0.0.83 Test Gracz 2)
- `node dev/run-all.mjs` 62/62 (`dev/director-stage.test.mjs`, 40 checks). `node dev/lang-audit.mjs` is clean.
- `dev/stage-js/control.mjs`: 16/16 with real CDP key, click and wheel input on P2 (`out/control.txt`):
  - Esc while parked: home, and out for the turn.
  - The chip click: home.
  - Esc with a window open: the window closes first.
  - Wheel during a beat: the camera is the player's, the same turn's move does not move it, and a later turn is on stage again.
  - Wheel while parked: the player's view.
  - GM skip and director off: home.
  - Combat end: home.
  - Nothing is left on screen afterwards.
- `dev/stage-js/vision.mjs` on `director-vision` (P1): the turns and moves of the unseen Daleki and the hidden Ukryty left the camera unmoved, with no take. Daleki walking into the light produced no shot (the move source's rule).
- `director-check watchShot` none/esc/click/wheel/busy OK on P1. `cinematicCheck` GM 13/13.
- The final trace on P1 shows: own turn -> none, own move -> none, own attack -> soft (offscreen).

### Not verified
- DPR 2 or touch.
- Two GMs at once.
- Pixel-vfx effects during beats.
- A full `idle-bench rest` (only the ticker count, 23, unchanged after a combat).
- `cinematic-fx-check` on a player.
- Reduced motion.
- A long session.
- Bars on a hit in the final recording (only seen in an earlier run).

### Videos
- `dev/director-stage-before-p1.webm`, `dev/director-stage-before-p2.webm` (main)
- `dev/director-stage-after-p1.webm`, `dev/director-stage-after-p2.webm` (stage on)
- Evidence is in `dev/stage-js/out/`. Re-run with `dev/stage-js/rec.sh <label>` (setup.js, scenario.mjs, home.js, dump.js).

### Open decisions for the user
- Stage on by default (`dirStage.on`, inside the director that is off by default)?
- Are `hits` the right default for the bars?
- Keep the "My view" chip and Esc while parked?
- Is `back` = 5 s right?
- Should the own-turn home shift to bring the own token on screen?
- A token walking into vision is not followed (the move source's rule).
- The move source's own-stay rule is superseded while the stage is on.

### Lane 4 state
- The junction is set back to `C:\mmwt-director`.
- The director is OFF.
- Test combats are deleted and token positions restored by setup.js.
- The scene is `director-test`.

## 2026-11-08 - adversary-3 fixes (agent director-fix2), branch `director-fix2` (from main cdae76d)

Scope: the findings N1-N6 of `C:/mmwt-adv3/director-adversary-3.md`, the two broken dev tools, and the lights tick side finding.
Another agent optimizes the camera engine, overlays and handlers in parallel, so the changes stay local. `screen.mjs`, `stage.mjs`, `overlay.mjs` and `core.mjs` are not changed.

### Fixes
- **N1 (stage turns frame combatants under open windows):** `source-stage.mjs` now frames with `freeRect()` (the safe rect less the open windows) everywhere it used `safeRect()`:
  - the turn camera and its dead zone;
  - the own-beat check;
  - the attack framing;
  - the own-turn home;
  - the chip.
  A window that covers the whole free rect already makes the director's context busy, so the shot comes soft.
- **N2 (wheel or pan right after a beat was ignored):** `onPan` no longer ignores pans just because `Screen.owner` is set. It ignores them only in three cases:
  - a stage beat plays;
  - the stage moves home;
  - the screen engine's camera is still on (a return is in progress).
  After a beat that stays, the engine's camera is stopped and only the bars fade out. A pan in that moment is now the player's at once. This also covers a scripted pan, so no stale home is left.
- **N3 (chip and Esc stay active while the camera is held):**
  - While `cameraHeld()` is true (Hot Pan on, LockView pan lock), `sync()` shows no chip and does not listen for the parked Esc.
  - `goHome`, `backHome` and Esc do nothing then; they only forget the parked state.
  - `updateSetting`, `clientSettingChanged` and `updateScene` re-run `sync()` while the camera is parked.
- **N4 (a stand-in player leader may send any shot):** a new pure module `scripts/director/standin-core.mjs` (`standInShot`). `director.mjs onSocket` calls it (through `fromStandIn`) for every `op: "shot"` from a NON-GM leader. Each receiving client plays such a shot only in the form a GM-less table needs:
  - Dropped: anything while the GM's pause is on, anything GM-only, and anything planned more than 3 s ahead.
  - Never forced.
  - Timing: lead and back 200-3000 ms; a take-over at most `maxShot`; a soft shot at most 1.5 x `softMs`.
  - Captions: only director keys (`Dir.*`, `DirMove.*`, `DirStage.*`) with short plain data. A free text or a foreign key makes the shot soft and short.
  - Lanes: kept only when the lane names a started combat or a token of this scene.
  - Pace: at most 10 shots in 10 s. Take-overs outside a combat lane: at most 3 in 10 s, and `rest` apart. Combat-lane beats keep the GM's pace.
  - Weight at most 0.85. The intensity is the GM's (`gmState().k`), not the sender's.
  GM shots and the stand-in's own screen are unchanged.
- **N5 (zoom pumping on attacks):** in `stage-core.mjs`:
  - `ZOOM_BAND` = [0.85, 1.12] x the player's zoom.
  - `attackCamera` keeps the zoom on screen when attacker and target fit at it; otherwise it uses the nearest zoom inside the band. A pair that does not fit even at 0.85 keeps the target whole and leans toward the attacker. There is no more pull-out to half the zoom.
  - `stageZoom`: a turn keeps the zoom on screen while it is inside the band, so there is no re-zoom after an attack.
- **N6 (the player never sees their own hit; own token at the bottom edge):**
  - The player's own ATTACK whose tokens are off screen is now a take-over. The camera goes to the hit and RETURNS to the player's view after the result: style `stay` is false and home is the player's view. Other own beats off screen stay markers.
  - `ownHome` now uses the comfort zone (20 % in from every side) and the smallest shift. Before, it used a 4 % margin and re-centred the token.
  - On their own turn the player may move their own token near the edge. The move source shows the mover nothing, so `keepOwnInFrame` now reframes it calmly after the move ends. It uses the smallest shift into the 20 % zone. It does nothing when the player is busy, the camera is held, a beat plays or the turn has moved on. The trace shows `move reframe`.
- **Dev tools:**
  - `perf-harness.cameraMoveCheck`:
    - On a client with no destruction display it returns `{ ok: true, skipped }`, because it measures that layer.
    - All its patches (performance.now, the ticker stop, the GL hooks) are now inside the try, so a throw can no longer leave the page with a FROZEN `performance.now`.
    - That frozen clock was why `idle-bench rest` then read 0 and returned an empty listener list.
  - `idle-bench rest`:
    - It refuses a frozen clock with a clear error.
    - During the bench, `ticker.remove(fn)` first unwraps the listener.
    - The cause of the lights tick copies: the bench's wrapper made `lights.mjs sleep()` miss its own `tick`. Every bench left one lights tick on the ticker while `_lightsDbg().ticking` was false (the 3 copies on P1 after two benches).
    - `lights.mjs` itself is fine and was not changed.
  - `cinematic-fx-check`: it now ends its show in a `finally` around `cameraMoveCheck`.

### Verified
Setup: lane 4 served this worktree. My own headless Chrome on CDP port 9391. Logins:
- GM `127.0.0.91` = Gamemaster;
- P1 `127.0.0.92` = Test Gracz 1 (owns Atom Eve);
- P2 `127.0.0.93` = Test Gracz 2.

Evidence is in `dev/director-fix2-ev/`.

- **Tests:** `node dev/run-all.mjs` 64/64, with the new `dev/director-fix2.test.mjs` (25 checks). One expectation in `director-stage.test` changed for the smallest-shift own home. `node dev/lang-audit.mjs` is clean.
- **N1:** the adversary's seam D on P2 (a 720x620 window on the right, 3 turns). Every combatant landed at screen (538,365), left of the window [760..1480]. Video: `dev/director-fix2-window-p2.webm`.
- **N2:** real CDP wheel on P2, 0 ms and 150 ms after a beat ended, while the screen was still "director":
  - the parked state was cleared and P2 was out for that turn;
  - the next turn came SOFT ("player moved the camera");
  - the zoom stayed at 2.464.
  A scripted pan 0 ms after the beat gave the same result and the camera stayed (`late-wheel.txt`).
- **N3:** Hot Pan switched on while parked, and a LockView pan lock while parked:
  - chip false, Esc listener off;
  - the next turn and the combat end did not move the camera (`held-*.txt`).
  The chip CLICK in that state was not exercised, because no chip is shown.
- **N4:** the GM viewed "map", so Test Gracz 1 led. Its forged shots, as seen on Test Gracz 2:

  | forged shot | what Test Gracz 2 played |
  |---|---|
  | forced take-over, free caption | soft |
  | forced take-over, `Dir.cap.collapse`, len 20000 | take-over, capped at ~5.6 s |
  | a second one 0.3 s later | soft |
  | during the GM's pause | nothing |

  The stand-in's real combat turns still played as take-overs. When the GM came back, Gamemaster led again (`forge.txt`, script `forge.mjs`).
- **N5:** the adversaries' scenario with 5 combatants. P2's zoom over the fight: 2.2 -> 1.87 -> 1.87 -> 2.013 (the move follow, the move source's zoom) -> 2.2 at home. That is 3 zoom changes; before there were 6 (2.2 -> 1.33 -> 2.2 -> 1.54 -> 2.2 -> 2.01 -> 2.2). Video: `dev/director-fix2-stage-p2.webm`.
- **N6:**
  - P1's own attack on an off-screen Battle Beast: trace "own attack, there and back"; the camera went to the hit (bars, result) and back to P1's view. Video: `dev/director-fix2-own-attack-p1.webm`, ~16-21 s.
  - P1 moved Atom Eve to the bottom edge on its own turn: trace "move reframe"; the camera shifted 80 px down and the token sat at ~60 % of the height. Video: `dev/director-fix2-own-turn-p1.webm`, ~22-24 s.
- **Regressions:**
  - `director-check watchShot` none / esc / click / wheel / busy: all OK on P1.
  - `dev/stage-js/control.mjs`: 16/16. The first run had 1 FAIL ("GM skip during a beat": the camera stayed parked at the turn). A dedicated skip repro (`skip.mjs`) returned home 2 times out of 2, and the rerun was 16/16. I count it as a timing flake; it did not reproduce.
  - Seam A/B/C: OK.
- **Dev tools on P1** (no destruction display):
  - `cinematic-fx-check`: 30/30 (before: 28/30);
  - `idle-bench rest`, 4 runs: 13-17 listeners each;
  - a ticker listener that removes itself is gone after a bench, and `ticker.remove` is restored.

### Not verified
- The lights tick copies were not re-created with the OLD bench. The cause comes from the code plus a probe with a self-removing listener; this scene had no ticking lights on P1.
- `cameraMoveCheck` on a client WITH a destruction display (the lane GM had none on director-test). The try/finally change is mechanical.
- A second GM, DPR 2, touch.
- Reduced motion with the new attack and reframe cameras (by code, reduced motion keeps the zoom on attacks).
- The stand-in rules against a REAL GM-less burst of events. The rate limits were hit only by forged bursts.

### Shared files touched
- `scripts/director/director.mjs`: one import, the `onSocket` shot branch, and the new `fromStandIn` + `standInLog` (above the play handlers). No other line.
- `scripts/director/source-stage.mjs` and `scripts/director/stage-core.mjs` (stage only).
- New: `scripts/director/standin-core.mjs`.
- dev:
  - `perf-harness.mjs` (`cameraMoveCheck` only);
  - `idle-bench.mjs` (`rest` only);
  - `cinematic-fx-check.mjs` (3 lines);
  - `director-stage.test.mjs` (1 line);
  - new `director-fix2.test.mjs`.

### Open decisions for the user
- **Stand-in captions:** on a player-led table a free-text caption is never a take-over, only soft. This also applies when a GM's hidden tab relays a GM cut with a free caption. Alternatives: stricter (a stand-in plays only soft shots) or looser.
- **Own attack:** an own attack off screen now takes the camera there and back. This is an exception to the stage rule "own beats never move the camera".
- **Own-turn reframe:** after the player's own move, the camera reframes with the smallest shift, only when the token ends in the outer 8 % of the free rect. Keep it, or leave the camera alone on the own turn?
- **Zoom band 0.85-1.12** of the player's zoom: for long-range pairs the frame shows the target and leans toward the attacker; the attacker may be out of frame.

### Lane 4 state
- Director OFF, not paused, intensity 1; Hot Pan off.
- Combats and roll messages deleted; token positions reset by `setup.js`; scene director-test.
- Junction back to `C:\mmwt-director`; lease released.
- My Chrome (CDP 9391) also had the lane-5 agent's pages open (127.0.0.57-59:30005). I closed only my three tabs and left the browser running.


## 2026-11-08 - cost pass (agent director-perf), branch `director-perf` (from main cdae76d)

### Measuring first (`dev/director-perf.mjs`, new)
- This is a Node driver over CDP. It runs a GM page and REAL player pages (Test Gracz 1 and 2, each on its own origin) in headless Chrome on the GPU.
- Per scenario, on all pages at once, it records:
  - rAF intervals, PIXI ticker ms, and long animation frames;
  - a CPU profile: Director JS self, Director INCLUSIVE (every sample with a `scripts/director/` frame on the stack), the longest unbroken Director task and its parts;
  - layouts and style recalcs, GC, heap, module socket frames and bytes, and scene load (tearDown -> canvasReady).
- Flags: `--throttle 4` (slow client), `--dpr 2`.
- Scenarios: rest, pan, take, soft, follow, attack, combat, busy, arrival / arrivalOff.
- Where the Director cost was, before this pass:
  1. **Caption placement** (`overlay.clearOfUi`). It ran 21-63 `elementsFromPoint` hit tests in ONE task. On this world each hit test costs ~0.3 ms because of the long chat log; with the sidebar hidden it is ~35 us. So every take-over's lower third was a 15-25 ms task in the middle of the camera move. On a 4x throttled client the frame grew to 115-160 ms.
  2. **Turn banner placement** (`source-move.bannerTop`). 24+ `elementFromPoint` calls in one task, on every client, at every turn: 8-37 ms, and 60-90 ms frames at 4x.
  3. **Soft marker following a pan** (`overlay.marker.place` on every canvasPan). `safeRect` (3 rects) plus reading the label width after the writes forced two style/layout passes per marker per frame. That was ~100 ms of Director JS per 4 s of panning, ~340 ms at 4x.
  4. Smaller items:
     - `safeRect` layouts in the stage and move checks.
     - Client settings were read through `game.settings.get`, which builds a Setting document on every read (~35 us). A shot start makes ~20 such reads.
- Costs that are not the Director's:
  - The camera itself (`canvas.pan` every frame) and other canvasPan listeners. Among them are moinen-maps `orbit.mjs place` (~0.05-0.1 ms per pan) and fxbus `emitViewbox`.
  - Dice So Nice: a ~400-2300 ms ticker stall on a roll.
  - The forced layout when the overlays are inserted. This is the page's own layout cost and would land in the next frame anyway.
- Fine as it was:
  - At rest: 0 ms and no ticker listener.
  - Pan at rest: 0-0.5 ms per 6 s.
  - Busy events (20 all-token flag updates + 30 chat messages + 20 combatant updates): 0.3-3 ms on any client.
  - Socket: one message per shot to each client. Take ~560 B, follow ~800 B, attack ~990 B, a whole combat ~6 messages / ~4.2 KB. Nothing at rest or on busy events.
  - Heap: deltas within noise.
  - Arrival: does not slow the scene load (below).

### What changed (look and behaviour are the same)
- `overlay.mjs`:
  - `caption()`: the same probes run in slices of at most 4 ms, one slice per drawn frame. `later` uses rAF and then a timeout, with a 120 ms fallback for a hidden tab. The caption gets `is-in` once its place is known; it is fully transparent before that. Same passes, same result. The caption shows ~1-3 frames later (~25 ms at 165 Hz).
  - `marker.place()`: writes only the values that changed. The label width is measured once per text and reset on `setText` or on a ping <-> arrow switch. Nothing reads layout after a write any more.
  - `safeRect()`: the measured rect is kept for 200 ms (`SAFE_MS`) and dropped on window resize.
- `source-move.mjs` `showBanner` / `bannerTop`: the same probes, sliced one per frame. The banner goes into the page with its place already set and then slides in (~10 ms later). Its hide timer starts at the slide-in, so it stays on screen as long as before.
- `stage.mjs`: new `clientGet(k)` reads a client setting through a cache keyed by its raw localStorage text. Foundry writes storage BEFORE onChange and the hooks, so the cache is never stale. `clientOpts` uses it.
- `director.mjs`: `setting()` uses `clientGet` (2 lines). World settings are unchanged and still use a plain get.

### Numbers
Lane 5, 165 Hz, interleaved A/B: the same pages, with the junction flipped between main cdae76d and this branch, plus a reload.

**Bench, player TG1** (`F-*` runs):
- Whole-frame rAF stays at the 6.1 ms vsync median and 6.2-24 ms p95 in both builds; it moves with machine load.
- incl = Director JS inclusive. run = the longest Director task.

| scenario | rAF p50/p95 | over 33 ms | incl | run | layouts | style recalcs |
|---|---|---|---|---|---|---|
| soft + 4 s pan | 6.1/6.2 -> 6.1/6.2 | 0 -> 0 | 97.7 -> 21.3 ms | 12 -> 19.7 (*) | 316 -> 190 | 1180 -> 911 |
| soft, 4x CPU | 6.1/24.2 -> 6.1/12.1 | 3 -> 0 | 342.9 -> 32.9 | 24.3 -> 12.5 | 307 -> 192 | 789 -> 845 |
| soft, DPR 2 | 6.1/6.2 -> 6.1/6.2 | 0 -> 1 | 113.6 -> 8.7 | 14.3 -> 1.5 | 316 -> 188 | 1178 -> 989 |
| take (letterbox/flash/caption) | 6.1/6.2 -> 6.1/6.8 | 0 -> 0 | 79.7 -> 89.6 | 23.5 -> 26.5 (*) | 374 -> 370 | 740 -> 740 |
| take, 4x CPU | 6.1/12.2 -> 6.1/18.2 | 8 -> 15 (**) | 244 -> 295 | **156.6 -> 13** | 300 -> 296 | 592 -> 676 |
| take, DPR 2 | 6.1/6.2 -> 6.1/6.2 | 2 -> 3 | 64.9 -> 74.1 | 17.1 -> 14 | 347 -> 355 | 789 -> 801 |
| follow | 6.1/6.2 -> 6.1/6.2 | 0 -> 1 | 76 -> 108 (P2 88 -> 84) | 3.6 -> 36.5 (P2 8.3 -> 8.3) | 276 -> 273 | 529 -> 525 |
| follow, 4x CPU | 6.1/18.1 -> 6.1/24.2 | 5 -> 9 (**) | 264 -> 271 | 34 -> 8 | 273 -> 246 | 528 -> 390 |
| attack with dice | 6.1/6.1 -> 6.1/6.2 | 3 -> 12 (**) | 80.4 -> 81.3 | 17.5 -> 11 | 414 -> 423 | 1336 -> 1511 |
| combat (~46 s, banners) | 6.1/6.2 -> 6.1/6.8 | 9 -> 43 (**) | 298.8 -> 206.1 (P2 333 -> 246) | 15 -> 29.5 (*) | 1098 -> 849 | 3541 -> 3127 |
| busy events | 6.1/6.2 -> 6.1/7.1 | 1 -> 7 (**) | 0.55 -> 0.55 | 0.6 -> 0.6 | 491 -> 488 | 1643 -> 1616 |
| rest | 6.1/6.1 -> 6.1/8.0 | 2 -> 2 | 0 -> 0 | 0 | 27 -> 27 | 77 -> 77 |

- (*) At 1x, the longest Director "task" is now the forced layout of inserting the overlay or banner (17-50 ms on this page). It was there before too, and the next frame would do it anyway. It is no longer the hit tests.
- (**) The whole-frame counts went up on the GM page and on every player page at the same time, including rest and busy, where the Director does nothing. That is machine load from other agents on the GPU, not this change. One run each.
- The in-page spike test below is the frame-level proof.

**Worst frame around one caption or one banner** (in-page test, median of 5; frame base 6 ms at 165 Hz, 12-18 ms at 4x):

| | before | after |
|---|---|---|
| caption, idle / during a pan | 12 / 12 ms (1 dropped frame) | 6 / 6 ms |
| banner, idle / during a pan | 12 / 12 ms | 6 / 6 ms |
| caption at 4x CPU, idle / pan | 133 / 115 ms | 18 / 24 ms |
| banner at 4x CPU, idle / pan | 61 / 67 ms | 18 / 24 ms |

**Other numbers:**
- Socket (both builds the same): take 1 message 539 B sent -> 558 B to each player; follow 777/796 B; attack ~975/995 B; combat 6 / ~4.2 KB. Nothing at rest or on busy events.
- Scene arrival vs arrival off (perf build), load from tearDown to ready: P1 148 vs 156 ms, P2 166 vs 149 ms, GM 154 vs 178 ms. The arrival's longest Director task is 2-7 ms, so the arrival does not slow the load.

### Look A/B
- The take-over camera code is untouched.
- Recordings of the same take: `dev/director-perf-take-before.webm` / `-after.webm` (player TG1). The caption, letterbox and flash land the same.
- Placement was compared numerically on the same page state and is identical:
  - caption, 3 texts: left 792 px, bottom 185 px, `is-low`;
  - banner top: 38 px;
  - edge marker: translate(953 px, 58 px).

### Verified
- `node dev/run-all.mjs`: 63/63. `node dev/lang-audit.mjs`: clean.
- `director-check watchShot` none / esc / busy on TG1 with the new code: all OK.
- Everything above ran on the real player pages (TG1, TG2) and on the GM page, at 4x CPU and at DPR 2 (device scale 2 + renderer resolution 2).

### Not verified
- A real slow machine or a touch device (only CDP CPU throttling). Headless Chrome only; no Firefox.
- Two GMs.
- An Esc cut while a caption is still being placed on a slow client. The code handles it (`gone` stops the slices), but esc was only exercised at full speed.
- A banner-only recording of a real combat as video. Combat placement was checked by numbers only.
- `cinematic-check` / `cinematic-fx-check` were not re-run.
- Long sessions (memory over hours).

### Shared files touched (for the merge with the bugfix branch)
- `scripts/director/overlay.mjs`: `safeRect` (+ `measureSafe`), `caption`, `clearOfUi`, `marker` place / setText.
- `scripts/director/source-move.mjs`: `bannerTop` and `showBanner` only.
- `scripts/director/stage.mjs`: new `clientGet`, and the first line of `clientOpts`.
- `scripts/director/director.mjs`: the import line and the `setting` line.
- New files: `dev/director-perf.mjs`, `dev/director-perf-take-before.webm`, `dev/director-perf-take-after.webm`.

### Findings outside the Director (not changed)
- `elementFromPoint` costs ~0.3 ms per call on a world with a long chat log. Anything that probes the page every frame pays that.
- `scripts/orbit/orbit.mjs` `place` runs on every canvasPan (~0.05-0.1 ms), even with no orbit on screen.
- fxbus `emitViewbox` runs on every pan.

### Lane 5 state
- Junction back to `C:\mmwt-dir-rolls`. Director OFF.
- ZZ-dir-rolls: token vision on, combats deleted, test tokens back in place, bench chat messages deleted.
- Lease released.

## director-fix3 (2026-11-09) - bugfix pass after verify ver3

Lane 4 (port 30004), headless Chrome CDP 9481; GM = Gamemaster (127.0.0.84), P1 = Test Gracz 1 (.85), P2 = Test Gracz 2 (.86). A/B against a clean main build by flipping the lane junction.

1. Slow client caption late (~1 s at 4x CPU). Cause: sliced placement did one `elementsFromPoint` per candidate point; each costs 2-16 ms at 4x, so with a window open the caption slid in 1381-1919 ms after shot start. Fix (overlay.mjs): per-point hit memo (4 px grid, dropped on resize / when a window rect changes), numeric placement from the default box, live revalidation afterwards (may move the caption with a 260 ms bottom transition if the kept answer was stale), idle warm-up of the memo (`warmCaptions`, director.mjs `warmSoon`), and the setup caption is created hidden one frame after shot start and revealed at lead*0.45. Verified (captime + LoAF, P2, 4x, settings window 720x620 on the right): shown 388-426 ms after shot start (main 1381-1919), no director long frames.
2. Turn banner with a window in the centre column. Cause: banner top scan only looked at x = innerWidth/2 and fell back to top 24, under the combat carousel; x stayed centred on the screen. Fix (source-move.mjs): `bannerX()` = centre of the free rect the stage frames into; `bannerTop()` scans with hitAt, skips blocked columns, falls back below the bars. Verified (banner.mjs, P2, 1x and 4x, with/without window): with window banners centred at ~538 in free rect 317-760, top 80-86, never under carousel, name never over the window; delay 0-279 ms at 4x. webm: dev/director-fix3-banner-window-4x.webm (P2, 4x, window open).
3. Late GM skip leaves players parked. Cause: skip only ended a running shot; a skip arriving after the beat ended "done" found nothing to end, the player's camera stayed parked. Fix: `skipHere` fires the "skip" hook on every client; source-stage sends a parked player home on GM skip. Verified (skiprace.mjs, P1, skip 300 ms after beat end): main 0/2 home, fix 3/3 home.
Other bugs found and fixed:
4. GM bar: skip disabled / wrong state in combat between beats (bar mode does not run shots). Fix: bar watches shots (`watched`, +4 s after combat-lane shots), skip enabled while staged combat runs. Verified (barcheck.mjs, GM).
5. Move handler in-view check used the whole screen, not the free rect (target hidden by a window counted as visible). Fixed with `freeRect()`. Verified by code + banner/move runs only.
6. Scene-arrival Esc: fired while typing in an input and always preventDefault'ed (ate Esc that closes windows). Fix: ignore when typing, preventDefault only if no one else takes Esc. Not separately verified live (control.mjs Esc rows pass).
7. Settings section: "look" select options not rebuilt when the look list changed. Fixed in section.mjs refresh. Not verified live.
Regression: run-all 65/65, lang-audit clean, director-check watchShot (P1: none/esc/click/wheel/busy) all rows OK, stage-js/control.mjs 16/16.
Open decisions: with no window narrowing the free rect the banner stays screen-centred (as designed); GM skip in combat now also sends players home (that is what we think a GM expects); bar keeps "take" state 4 s after a combat-lane shot; warm-up costs a short idle burst after settings change/resize/canvas ready; revalidation can visibly nudge a caption once.

## director-opt (2026-11-09) - lossless cost pass for a GTX 1080 / i7-7700K-class client

Branch `director-opt` (from `director-fix3`), worktree `C:/mmwt-dir-opt`. Only `scripts/director/` changed. Lanes 4 (director-test) and 5 (ZZ-dir-rolls); my headless Chrome on CDP 9491; GM / Test Gracz 1 (P1) / Test Gracz 2 (P2), each on its own origin. Before = `C:\mmwt-dir-fix3`, after = this worktree, swapped by flipping the lane junction and reloading every page.

### The approximation
- CPU: CDP `Emulation.setCPUThrottlingRate` 2. Calibrated here (i5-13600KF) on P1: script 1.9-2.15x, 40 hit tests 11 -> 28 ms, layout 1.9-2.2x. Single-thread i7-7700K is ~1.5-1.8x slower than this machine, Ryzen 5 1600 ~2.0-2.2x, so 2x is the middle; 4x is the worst-case re-check.
- GPU: PIXI GPU ms per canvas frame (EXT_disjoint_timer_query_webgl2) and composited layer area (LayerTree), x2 for a GTX 1080 vs this RTX 3070 Ti (Time Spy ~7.3k vs ~14.5k, fill 111 vs 170 GPix/s, bandwidth 320 vs 608 GB/s).
- Limits: only the renderer main thread is slowed (compositor, raster, GPU process run at full speed, 20 threads vs 8); hybrid P/E cores; the headless page runs at 165 Hz, not 60; other agents' lanes load the same machine. Whole-scenario numbers drift by 30-90 % between rounds (the camera's share, which nothing here touches, moved as much), so decisions rest on the micro A/B (one isolated thing per case, A-B-A-B) and on interleaved rounds.

### What costs what (2x, P1, before)
- GPU: PIXI p50 2-3 ms / p95 5-7 ms here (~4-6 / 10-14 ms on a 1080); a Director shot does not raise it measurably (it only moves the camera). Overlay layers: rest ~3.9 screens of layer area, take-over 5.1, arrival 6.5 -> ~0.05-0.2 ms per frame of compositing on a 1080. Not a problem.
- CPU (Director inclusive per scenario): take 188 ms (camera 42, elementsFromPoint ~80), attack 193, combat 414, arrival 177, follow 141 (mostly camera), soft 21. Hit tests cost ~0.27 ms each at 1x because of the long chat log (4800 elements).
- Running CSS animations (marker rings, arrow nudge) cost one style recalc per frame (~0.1 ms at 2x). Left as is (they are the look).

### Changes (all in scripts/director, nothing visible changes)
1. `screen.mjs restyle(el)`: the "start the transition from here" read is `getComputedStyle(el).opacity` (style only) instead of `offsetWidth` (style + layout). Used by the take-over screen (show / showNow / flash), caption, marker, chip (source-stage), banner (source-move), arrival veil and card (source-scene).
2. `contain: strict` on the three fixed full-screen overlay roots (`.mm-dir`, `.mm-dmv`, `.mm-dir-arr`): their layout no longer touches the rest of the page. Arrival card (2.6 s of letter-spacing / rule-width transitions): layout ms 132/137 -> 89/100 in the micro A/B.
3. `overlay.idleSliced`: the live re-check of a caption placed from kept answers and the idle warm-up of the hit memo run in requestIdleCallback time, each slice capped at the idle time left minus one hit test (`probeMs`, measured), with a SLICE_MS slice at least every 16 ms when the page has no idle time (the cadence sliced() had at 60 Hz). Warm-up: the next lb's box is made in its own idle period. The first version (250 ms fallback) made the warm-up finish up to 18 s late; fixed before commit (numbers below are the final code).

### Before / after
Micro A/B, P1, 2x, median of 3, two runs per build (A-B-A-B): `dev/director-micro-ab.mjs`, `dev/director-opt-ev/micro-*.json`

| case | layouts | layout ms | style ms | frames > 16.7 ms | worst frame ms |
|---|---|---|---|---|---|
| pan (control) | 278/277 -> 275/276 | 41.6/47 -> 43.3/43 | 24.7/30.5 -> 25/28 | 1/1 -> 1/1 | 60.5/66.7 -> 60.5/60.6 |
| take-over screen + 12 impacts | 337/337 -> 337/337 | 51.7/52.3 -> 54/52.8 | 64.7/52.9 -> 72.7/55.4 | 0/0 -> 0/0 | 12.1/12.1 -> 6.3/6.2 |
| 3 captions during a pan | 1003/1008 -> 1015/1011 | 202.7/193.4 -> 170/179.3 | 282.9/240 -> 315.4/329.3 | 1/0 -> 0/0 | 18.2/12.2 -> 12.2/12.2 |
| arrival card 3 s | 430/427 -> 436/434 | 132.3/137.2 -> 88.7/100.4 | 76.9/90.4 -> 75.6/90 | 0/1 -> 0/0 | 12.2/18.2 -> 6.2/12.1 |

(The micro runs were on the 250 ms-fallback version; the captions case is the only one idleSliced touches.)

Idle warm-up after a resize (`warmcost`, P1, 180 hit tests; `dev/director-opt-ev/warmcost2.txt`, final code = "after3"):

| | done after first probe | Director ms | longest Director run |
|---|---|---|---|
| 2x before | 0.6 / 1.1 s | 180 / 254 | 9.6 / 9.2 ms |
| 2x after | 1.1 / 1.1 s | 197 / 214 | 5.9 / 5.6 ms |
| 4x before | 1.8 / 0.4 s (2nd: 135 probes) | 549 / 176 | 15.1 / 17.3 ms |
| 4x after | 3.0 / 1.4 s (2nd: 135 probes) | 620 / 127 | 8.6 / 11.6 ms |

Interleaved scenario A/B (2 rounds x 2 reps, P1 + P2, `ab-x2-*.json`, table by `dev/director-perf-table.mjs`): the Director's own saturated 60 Hz bins without the camera go down or stay (take P1 9.5 -> 6, attack 18.3 -> 10.3 / 10.5 -> 8.5, combat 21.3 -> 19.8 / 16 -> 15.3, soft ~0), layouts down (arrival 560 -> 474 / 563 -> 488, soft 185 -> 154); the whole-frame columns are dominated by machine drift (round 1 "after" ran under a load spike: camera share +35-80 %; in round 2 after <= before almost everywhere). No scenario-level claim beyond "not worse" is made from them.

Setup caption at 4x, real attack (P1, Plus Ultra "splash for others" off so the Director's own result caption shows; restored after): slid in 374-400 ms after shot start (before 398-433 ms), result caption ("Hit! Damage 3" / "Miss!") made and slid in 0-82 ms after the dice cue, clear of the hotbar (`regress/attack-*.txt`). With the splash on (default) the result caption is quiet by design and only the setup caption shows.

### Same look
- `dev/director-look-ab.js` (+ scratch driver): captions (3 texts, with / without bars), markers (ping, edge arrow), turn banner, arrival card, on P1 over a black backdrop, both builds. Geometry JSON identical except the card's `contain` value; screenshots pixel-identical for the 3 captions, the banner and the card; marker ping/arrow differ only in the running ring / nudge animation phase (arrow: no pixel > 8). Files `dev/director-opt-ev/look/`. (A first after run differed because an Invincible Plus Ultra "end-of-session review" toast was on screen and the caption correctly sat above it; rerun with the toast removed.)
- Transitions verified running after the change (bars / vignette, flash at impact, caption slide-in, marker, banner).
- webm (P1, 1920x1080) before | after side by side: `dev/director-opt-ev/video/take-ab.webm`, `arrival-ab.webm` (+ strips). Same shot, letterbox, marker, caption, title card; the red pulsing is the scene's own lighting, its phase differs.

### Regression
- run-all 65/65, lang-audit clean (final code).
- director-check watchShot on P1 (lane 4): none / esc / click / wheel / busy all OK (`regress/director-check-p1.txt`; before and after the IDLE_WAIT fix; in the final run the first "none" right after the page reload came as a soft shot (rows still OK), the repeat was a full take-over).
- stage-js/vision.mjs 4/4, stage-js/control.mjs on P2 16/16 (pre-IDLE_WAIT-fix code; the fix touches only warm-up / re-check scheduling).
- cinematic-check GM 13/13. cinematic-fx-check on P1: first run 28/30 because a Director take-over (from the GM check's destruction, director ON) was still on screen when it started; rerun 3 s later 29/30, and with the director OFF 29/30; the one failing row is "idle-bench rest unchanged (mean within +0.15 ms)" (8.0 -> 9.4, 9.4 -> 17.9 ms with p95 65 ms: machine load; listener count unchanged). cinematic(-fx).mjs are not touched by this branch.

### Not verified
- A real GTX 1080 / i7-7700K / 60 Hz display (all of it is the approximation above). The 16 ms idle fallback is tuned for 60 Hz; at 165 Hz headless the 4x warm-up finished up to ~1.2 s later than before in one of two runs (a shot in that window places live, as before).
- DPR 2, Firefox, two GMs.

### Big costs outside the Director (not changed)
- `scripts/zones/orbit.mjs` strip `place()` on every canvasPan reads `this.el.offsetHeight` after writes: a forced layout per camera frame, 21-93 ms per shot at 2x. Fix idea: cache the height (it changes only on content / resize).
- LockView `socket.js emitViewbox` (socket emit per pan) and `helpers.js getUserSetting` (game.settings.get through the DataModel per pan).
- At rest moinen-maps costs ~1560 ms per 6 s on a 2x player (~26 % of a core), mostly outside the Director.
- Arrival: the establishing frame is a 1.1 s ticker stall at 2x (texture uploads 359 ms, Foundry panCanvas 181 ms, zones onCanvasReady / relink 144 ms), behind the veil; on a slow client the title card comes ~1 s later.
- Dice So Nice stalls during rolls.

### New dev tools
`dev/director-perf.mjs` (--gpu, --layers, sat60 / sat60own, camera share), `dev/director-perf-table.mjs`, `dev/director-perf-merge.mjs`, `dev/director-micro-ab.mjs`, `dev/director-look-ab.js`; evidence in `dev/director-opt-ev/`.

## director-fix-opt2 (2026-11-09) - the two bugs of verify-opt (dev/director-verify-opt.md)

Branch `director-opt`, worktree `C:/mmwt-dir-opt`. Lane 4 (port 30004, world `invincible`, scene `director-test`), junction flipped to this worktree and back to `C:\mmwt-director`, lease taken and released. My headless Chrome on CDP 9511 (1600x900): GM = Gamemaster (127.0.0.101), P1 = Test Gracz 1 (.102), P2 = Test Gracz 2 (.103), second GM = `claude` (.104). Before = HEAD 9cc7b08 (changes stashed, P1/GM reloaded on it, stash popped; the page keeps the old modules until its next reload). Evidence: `dev/director-fix-opt2-ev/`. The opt pass (restyle via getComputedStyle, `contain: strict`, `idleSliced`) is untouched.

### Bug 1: the move follow camera ignored the free part of the screen
- Cause: `source-move.mjs handler.drive` -> `move-core.followStep` centred the token on the whole screen; `freeRect()` was only used by `check`.
- Fix:
  - `followStep` takes `ox` / `oy` (screen px: screen centre - free rect centre); the camera centre is shifted by them / the zoom of THAT frame (the same shift `frameShot` / `centreFor` use). Default 0: unchanged.
  - `drive` uses the free rect only when an open window narrows it (freeRect differs from safeRect and is not `covered`); no window = exactly the old math (ox = oy = 0, look-ahead g*1.5, same zoom).
  - With a window the look-ahead is capped so the token stays inside the rect (half the rect's short side - the token's half size - 16 px).
  - `canvas.pan({ ...v })`: LockView's libWrapper writes its bounded view INTO the object passed to `canvas.pan`, so the old code could not see that the camera was held back.
  - LockView `boundingBox` (on in director-test) keeps the map edge off screen: near the right edge the camera cannot put the token on the left of the screen at the follow zoom. When the camera is held back and the token is outside the rect, the zoom pushes in gently (0.6 x per s, 0.3 with reduced motion; at most 1.6 x the follow zoom, never past the canvas limit), and stops when zooming in does not bring the token closer (a token at the very edge of the map).
- Numbers (P1, Game Settings 720x620 at x 640-1360, free rect x 317-640, home (500,500) at 1.5, GM `doc.update`), per frame of the shot (`toScreen(token.center)` each ticker frame, `p-watch-move.js` / `p-res.js` of the verifier):

| case | before (9cc7b08) | after |
|---|---|---|
| TT2 (480,300) -> (760,520) | 0 / 96 in the free rect (verifier: 0 / 68) | 61 / 96; first frame inside at +624 ms, then 61 / 61 (no frame out after it); last half 48 / 48 |
| TT0 (300,300) -> (760,560) | verifier: 0 / 101 | 121 / 146; first inside at +509 ms, then 121 / 121; last half 73 / 73 |
| TT2 -> (760,520), no recorder | - | 54 / 86, last half 43 / 43; camera back exactly at home (528,500,1.5), Screen owner null |
| TT2 -> (1080,520) (held back by the bounding box) | - | push-in to 1.127 x; 117 / 152, last half 76 / 76 |
| TT2 -> (1480,520) (map edge, 56 px from it) | - | push-in stopped at 1.12 x (no progress); 85 / 278: the token runs out of the rect toward the edge - the bounding box makes it impossible |

  The frames before the first one inside are the lead: the token starts behind the window and the camera blends from the player's view (no cut).
  The two LockView rows ran with temporary logging lines (removed before the commit; no logic in them); the first three rows ran on the final code.
- No window (home (300,300) at 2, TT2 -> (1080,520), a follow take-over): before / after camera at +300 / 700 / 1200 / 2000 ms = 479/324/2.072 vs 478/324/2.071, 746/411/2.231 vs 740/409/2.228, 887/462/2.25 vs 888/462/2.25, 1067/528 vs 1069/529; last frame 1113/545/2.25 both; shot 2782 vs 2787 ms; home 400/300/2 both. Same math, the differences are frame timing. The no-window repro move stays `none` (in view), as before.
- Soft form: not touched by the change. Two runs inside the cooldown played `soft` with the new code (form soft, ended done).
- webm (P1): `after-A-TT2.webm` (fixed), `before-win-TT2.webm` (bug), `after-C-TT0.webm`, `after-E-push.webm` (push-in), strips `*-strip.png`, single frames `after-A-mid.png` / `before-mid.png`.
- Unit: `dev/director-move.test.mjs` +4 checks for the offset (61 checks).

### Bug 2: the Director look dropdown did not refresh
- Cause: `section.mjs` listened with `onSetting` = `clientSettingChanged`, which Foundry fires only for CLIENT settings (`#setClient`); `cinUserPresets` is a world Setting document.
- Fix: `workspace/ui.mjs onWorldSetting(keys, fn)` (create / update / deleteSetting hooks, which run on every connected client); `section.mjs` uses it for `cinUserPresets`. `onSetting` itself is unchanged (its other callers are client settings).
- Check (GM page, the real look panel "Duplicate" button + name dialog, then the real "Delete" button + confirm; `fx2/js/sec-ui.js`):
  - before: the new option never appeared in 3 s (setting written, hook 8 ms after OK).
  - after: shown 34-41 ms after OK (25 ms polling; the rebuild runs inside the setting hook, 3-12 ms after OK), gone 25-29 ms after the confirm.
  - second GM page (`claude`, Director section open): its look `<select>` changed in the same hook dispatch as the setting, for both saves and both deletes (MutationObserver log).

### Regression
- `node dev/run-all.mjs` 65/65, `node dev/lang-audit.mjs` clean.

### Not verified
- Reduced motion with a window (the slower push-in, the 0.6 s spring) was not run live.
- A window opened / moved / closed DURING a follow (the free rect is measured once, at the start of the shot).
- Turn glide / stage beats near a LockView bounding-box edge (same physical limit, not touched).
- DPR 2, Firefox, a real 60 Hz display; the push-in heuristic on maps without LockView (Foundry's own pan clamp is loose, it should never trigger there).
- director-check watchShot / cinematic checks were not re-run (the take-over code outside the move drive is unchanged).

### State restored
- Director OFF (paused false, k 1, mode bar); `splashOthers` true; `cinUserPresets` {}; the scene's cinematic block back to its exact earlier value (epic + the previous `over`; Duplicate/Delete change it); no combats; TT0-TT6 at their places; tokenVision false as found. Junction back to `C:\mmwt-director`, lease released, my Chrome closed.
