# LETR impact frames (`L.impact`)

The few drawings of full force at the instant of a hit: the scene slammed to hard black and white or to its negative, the struck
figure as a flat silhouette on a black, white or colour field, burst stars, speed and focus lines, smears, the frame torn in two,
halftone, ink splashes, a chromatic split, a hold of the whole scene (hit-stop) and a shove of the frame. The lettering itself is
restrained; this is the brief, violent exception, and it lasts 2 to 12 ticks of the engine's 24-tick clock (83 to 500 ms).

Any effect uses it through one call. Nothing here knows about dice, tokens' tracks or map presets: callers say what kind of blow
it was, how strong, where and from where; the system picks the drawings.

```js
import { letters } from "<rel>/letters/index.mjs";          // or: const L = await MoinenLetters.engine();
const L = await letters(), I = L.impact;

I.play({ kind: "crit", magnitude: 1.7, subject: token, from: attackerToken, seed: `hit:${message.id}`, startAt });
```

Files: `plan.mjs` (pure: frame types, kinds, limits, the guard, the clock), `shapes.mjs` (pure, seeded geometry), `draw.mjs` (the ink
of each frame type on a 2D context), `index.mjs` (the player and the API), `gallery.mjs`, `check-impact.mjs`. The engine is touched in
three marked lines of `index.mjs` (`IMPACT hook 1/3..3/3`: the import, the attach after the engine is created, the registry entry) and
one section of `check.mjs` (8f).

## The call

`I.play(spec)` returns a handle at once: `{ id, plan, mode, alive, ready (Promise<boolean>: the first drawing is up), finished
(Promise<why>), stop() }`. `why` is `"done"`, `"stopped"`, `"replaced"` (a stronger impact took over), `"busy"` (a stronger or equal
one was playing: this one was not shown), `"hidden"` (its token is not visible to this user), `"late"` (its shared time was already
over), `"off"` (switched off on this client).

| option | meaning |
|---|---|
| `kind` | `hit heavy crit blast slash landing ko shock word` (default `hit`); or let `I.pick(event)` choose |
| `magnitude` | 0..2 like the lettering's (0.5 = an ordinary blow). SIX strengths (1.8.2; the bounds 0.35 / 0.85 / 1.35 of the first build are still bounds): under 0.35 a graze, to 0.6 a scratch (both: a small star on the struck figure's rim, nothing done to the scene, the figure stays in sight), to 0.85 a solid hit (a jagged panel round the figure goes hard black and white), to 1.35 strong (full-field frames and a hit-stop), to 1.7 heavy, above that the whole set. Inside a strength the drawings still grow with the magnitude, so a series of blows builds. `I.steps` = the bounds |
| `subject` | what is struck: a Token / TokenDocument / token id; a point `{ x, y }` (`space: "world"` for scene coordinates, else screen px; `area` = its radius); a rectangle `{ x, y, w, h }`; an HTML element (a panel; a `<canvas>` or `<img>` also gives the silhouette); a LETR word's handle; nothing = the middle of the view |
| `dir` / `from` | where the blow travels: `dir` in degrees (0 right, 90 down), or `from` = the attacker (token or point): the direction is then worked out on each client's own screen. A `from` token this user cannot see gives NO direction there (it would tell where it stands; 1.8.2): the impact is radial on that client (`vision: "none"` overrides, as for `subject`). Without either the impact is radial |
| `seed` | any string or number all clients share: same seed, same drawings |
| `startAt` | this page's `performance.now()` time of the instant of the hit (the LETR convention; an effect's shared time converts to it). Every drawing change then falls on the same instant on every seat; a client that is late joins at the drawing that is up, one that is too late shows nothing. Without it the impact starts when its first drawing is painted (next frame) |
| `over` | `"scene"` (default: over the map, under bars and windows, z 4) or `"ui"` (over every window, one under the lettering's `screen` layer, so a word on that layer stays on top); `z` or `parent` (an element) override |
| `tone` / `colors` | accent pair: `hero fire blood volt toxic void dust`, or `colors: [accent, second]` (a power's own colours). Ink and paper are fixed |
| `frames` | your own sequence instead of the kind's: `["shadow", { type: "slam", ticks: 2, punch: 1, stop: false }, "dots"]` (the limits still apply) |
| `hitstop`, `punch` | `false` turns the hold / the shove off for this call; `punch: 0.5` scales it |
| `vision` | `"none"`: show it even when the subject token is not visible to this user (and take a hidden `from` token's direction) |
| `reduced` | `true`: this caller's own reduced-motion setting. A caller can only LOWER: `true` reduces; `false` (or nothing) leaves the OS reduced-motion switch in charge (1.8.2; before, `false` overruled the OS). Only the client's own Motion setting `full` overrules the OS |
| `gentle` | `true`: the gentle variant for this call (a module's own "fewer effects" setting): no full-field frame, no hit-stop, everything inside a panel round the subject. Can only lower: `false` never raises a client that is set to `local` (1.8.2) |

Other calls: `I.prepare(spec)` paints everything ahead and returns `{ play({ startAt }) }` (use it when you know the blow is coming:
a roll being resolved, a projectile in flight); `I.plan(spec)` = the plan this client would show, without spending flash budget;
`I.pick(event)`; `I.show(type, spec)` holds ONE frame type up to 2 s (gallery, design); `I.gallery(opts)`; `I.stopAll()`;
`I.kinds`, `I.frames`, `I.tones`, `I.limits`, `I.steps`, `I.stats`, `I.busy`, `I.mode()`, `I.setMode("full" | "local" | "off")`.

`I.pick(e)` -> `{ kind, magnitude }` from an event in the caller's terms: `{ type: "damage", share (0..1 of the track lost), crit,
fatal, cut, energy }`, `{ type: "roll", crit }`, `{ type: "blast" | "landing", area (grid squares) }`, `{ type: "word", magnitude }`.

## Frame types

| id | what | full field |
|---|---|---|
| `pop` | burst star (accent, paper core, ink line) with short ticks, where the blow lands | |
| `splat` | ink splash thrown along the blow, small star | |
| `lines` | speed lines along the blow, or focus lines to the subject when there is no direction | |
| `ink` | a jagged PANEL round the blow (at most 20 % of the view) where the scene goes hard black and white, ink lines inside it, a heavy keyline, a star (1.8.2: was the whole view, uncounted). Local, counted by the guard | |
| `slam` | the scene's black-and-white NEGATIVE, lines, an ink star | yes |
| `shadow` | black frame, the subject's picture inked on a paper silhouette, enlarged, on a two-colour star | yes |
| `glare` | paper frame, heavy ink lines, the subject as a black negative | yes |
| `swap` | accent-colour frame, halftone, the subject in ink with a paper line | yes |
| `window` | black frame with a torn star-shaped window on the scene's negative | yes |
| `smear` | the struck figure dragged back along the blow: one continuous swept streak in two colours with an ink keyline, torn by dry-brush gaps, the inked figure at its front (1.8.2: was three separate copies that read as bars) | |
| `tear` | a ragged paper band across the frame; one side of it is the scene's negative | yes |
| `rip` | the band alone, with a splash | |
| `dots` | halftone fan in the accent, star | |
| `shatter` | cracks running out, loose shards, a star; the scene goes hard black and white inside a panel round the blow (local, counted by the guard; 1.8.2: was the whole view) | |
| `chroma` | the scene's colour plates pulled apart along the blow | |
| `ring` | a thick broken shock band in the accent with ink and paper keylines, chunks thrown off its rim, ticks running outward, a halftone rim in the second colour (flattened for `landing`) | |
| `fade` | last drawing: the star's afterimage as a hollow outline, puffs of dust thrown along the blow, thin ticks, accent specks | |
| `rest` | nothing (a wait: the still drawing of reduced motion waits for the blow's instant with it) | |

A drawing may also carry `stop` (hit-stop: the canvas ticker is held, so tokens, weather and effects stand still under the frame) and
`punch` (the board element is shoved along the blow and settles in two steps). Both are undone at the next drawing, at the end, and
by a watchdog timer that fires even when the frame loop is dead (a hidden tab).

The subject: a token gives its live texture (no fetch, no read-back of the WebGL board); the frames that show it alone enlarge it so the
struck figure fills its share of the frame at any zoom. A point or a panel has no silhouette; those frames then draw a star in its place.
The picture is read once into a small software canvas (at most 256 px) and turned into the figure's own outline and an inked copy (dark
parts and edges in ink, the rest paper; the negative for the light frames). A ROUND portrait token (alpha = a disc) or a square one has
its background removed by the colour of the ring just inside its rim (a flood fill from there, following gradients), so the head and
shoulders stand out instead of an inked disc; a busy painting whose background cannot be told from the figure keeps its disc (1.8.2).
A picture that cannot be read (another origin) falls back to its alpha and a filter.

Every ink shape carries a keyline of the opposite value: speed and focus lines too (1.8.2), so they read on a dark busy map.

## Kinds

`hit` (hero yellow), `heavy` (fire; cracks, a shock ring), `crit` (hero; chromatic split after the slam, a colour frame, the torn window at
the top), `blast` (fire; radial, a white frame first), `slash` (blood; smear, the frame torn along the cut), `landing` (dust; lines from
above, flattened rings, cracks), `ko` (blood; the longest hold on the struck figure), `shock` (volt; chromatic split first), `word` (behind
a lettered word). Each has SIX strengths (`KINDS[kind].steps`; `tiers` is kept as a view of four of them); no two strengths of a kind
draw the same, and the strongest are longer and hold longer. `I.gallery()` plays them all.

The ladder the owner named, as `I.pick` gives it (check-impact.mjs pins it: every rung different, each with more force than the last):

| event | pick | what it draws |
|---|---|---|
| a scratch (5 % of the track) | hit 0.36 | a small yellow star on the figure's rim, a splash, residue; the scene untouched, the figure in sight |
| a solid hit (20 %) | hit 0.69 | the panel round the figure goes hard black and white, star, halftone fan, residue |
| a heavy hit (45 %) | heavy 1.24 | black frame with the inked figure, the scene's negative, cracks, a fire shock ring |
| a knock-down | ko 1.6 | speed lines, the figure held three ticks on black, the negative twice as long, colour split, blood splash |
| a critical | crit 1.73+ | lines, the torn black window, the figure, a colour frame, the negative, colour split, halftone |

## Safety (the limits enforced)

Full-screen flashes and inversions can harm photosensitive viewers. The engine's own preferences decide (namespace `moinen-letters`;
`L.prefs`), plus one client setting of this feature, `moinen-letters.impact` = `full | local | off` (`I.setMode`; since 1.8.2 a row
"Impact frames" in the engine's settings window, group Accessibility, for every player).

| limit | value | where |
|---|---|---|
| length of an impact | at most 12 ticks = 500 ms; one drawing at most 4 ticks | `planImpact` (also a caller's own `frames`) |
| hit-stop | at most 4 ticks = 167 ms per impact | `planImpact` |
| flash drawings, guard on (`photosafe`, the default) | a FLASH is a full-field frame OR any drawing that changes the scene's brightness behind it, even inside a panel (`ink`, `shatter`, the gentle variant's panels; `isFlash`). At most 2 per impact AND at most 2 in any rolling second on this client, counted in the SAME log as the words' flash frames; over the budget a full frame becomes its quiet twin (`slam` -> `ink`, `shadow`/`window` -> `pop`, `glare` -> `lines`, `swap` -> `dots`, `tear` -> `rip`) and a twin or panel that would still change the scene keeps its ink and leaves the scene alone. The slam is kept first. Two flashes a second is under the three of WCAG 2.3.1 (1.8.2: before, `ink` and `shatter` turned the WHOLE view black and white uncounted, and the guard's twin for `slam` was that whole-view `ink`) | `safety` |
| scene changed by a drawing that is not full-field | only inside a jagged panel of at most 20 % of the view round the blow (`localPanelR`, `backClip`) | `draw.mjs` |
| saturated red (R / (R+G+B) >= 0.7, stricter than WCAG's 0.8) | under the guard covers at most 1 % of ANY drawing (`LIMITS.redArea`): every red accent (a kind's, a `tone`, a caller's `colors`) is drawn as the deep crimson `SAFE_RED` (#b02840, 0.63); the guard off keeps the red. Measured in check-impact.mjs on every frame type x red tones x subjects (1.8.2: before, the knock-out's shadow frame threw red spikes over the black field: ADVI 18) | `draw.mjs` `guarded` |
| halftone | the `dots` drawing stays inside a disc of a quarter of the picture whatever the size of the subject (`dotsReach`); only the rationed `swap` frame may cover the frame with dots | `draw.mjs` |
| `flashes` off, `motion: gentle`, `impact: local`, or a caller's `gentle: true` | the GENTLE variant: no full-field frame, no inverted scene, no hit-stop; every drawing is clipped to a jagged panel round the subject of at most 20 % of the viewport; the shove is halved (`gentle`: none, and no chromatic split); its black-and-white panels are still counted by the guard | `safety`, `draw.mjs` |
| reduced motion (`motion: reduced`; `auto`/`gentle` with the OS switch, whatever the caller passes; a caller's `reduced: true`) | ONE small still drawing (the star, sized by the strength) for at most 4 ticks, standing at the INSTANT of the full plan's blow (its first star, panel or full frame; a `rest` before it): nothing moves, nothing is done to the scene, and a reduced seat shows the blow when a full seat does (1.8.2) | `safety`, `peakOf` |
| off | `enabled` off (the lettering's master switch) or `impact: off`: nothing is created | `modeFor` |
| frame shove | at most 2.2 % of the viewport, and never past the zoom that covers it | `punchAt` |
| chromatic split | plates at most 1.2 % of the viewport's short side apart | `index.mjs` |
| one at a time | a second impact while one plays is shown only when it is stronger (it then replaces the first) | `play` |
| never outlasts itself | watchdog timer = the plan's length + 300 ms; scene change stops it | `play` |

The timing never differs between clients: a guarded or gentle client shows other drawings for the same ticks.
With the guard switched off by the user (`photosafe` off) the full sequences play: up to 3 full-field frames in about 250 ms and a
red field are then possible. That is the user's own choice on their own client; no caller option turns the guard off.

## Same instant on every seat

Give `seed` and `startAt`. The plan is a pure function of `(kind, magnitude, seed, dir, colours)`; drawing changes are counted in whole
ticks from `startAt`. What differs per client, by design: the guard's result, the subject's place on that client's screen (its own pan
and zoom), a `from` direction (worked out on that screen), and whether a hidden token's impact shows at all. There is no networking
here (and the lettering's `L.net` is GM only): the caller's own event carries kind, magnitude, seed and the shared time.

## Cost (measured)

Method: every drawing is painted once on a software 2D canvas (`paint`, timed in `I.stats.paintMs / paintMax`), the first one in the
frame the impact starts, each next one during the drawing before it (or all of them ahead with `I.prepare` / while waiting for
`startAt`); a drawing change is a style swap (`I.stats.showMax`); `I.stats.frameMax` is the longest animation-frame gap seen while an
impact was up. A picture is at most 2.2 million pixels (a 4K view is painted at about 1080p). The freed canvases are released at each
change; at the end nothing is left in the DOM.

Measured 2026-11-13 on the test machine (GTX 1080 class, 1600x900, one GM seat, a lit scene with tokens and weather, 60 Hz):

| what | number |
|---|---|
| animation-frame gap, idle scene | avg 16.6 ms, max 19.1 ms |
| the same while each of the 17 frame types is held | avg 16.0 to 16.7 ms, max 17.3 to 18.2 ms; no frame over 25 ms |
| the same through 18 whole impacts (9 kinds, weak and strongest) | max 17.2 to 18.4 ms; no frame over 25 ms |
| painting one drawing | 1.6 to 6.9 ms (average 2.5 ms; the dearest are `swap`, `smear`, `glare`, `shadow` with a token) |
| painting a whole impact (4 to 7 drawings, spread over its frames) | 4 to 20 ms in total |
| a drawing change | at most 0.2 ms |
| `I.prepare` of the strongest critical | 15.7 ms once, then 0 ms of painting while it plays |
| left behind | 0 elements, 0 canvases, `#board` style empty, ticker running |

## Integration recipes

- **Dice-roll splash (critical).** `I.play({ kind: "crit", magnitude: 1.7, subject: splashPanelElement, over: "ui", seed: message.id,
  startAt: tSlam })` at the tick the result lands; the result word on the lettering's `screen` layer stays on top. A fumble needs none.
  Know the roll before the slam? `const p = I.prepare({...})` when the roll resolves, `p.play({ startAt })` at the slam.
- **Token Health / Resolve reactions.** `const { kind, magnitude } = I.pick({ type: "damage", share: lost / max, crit, fatal })`, then
  `I.play({ kind, magnitude, subject: token, from: attackerToken, seed: `${token.id}:${newValue}`, startAt: tHit })`. Resolve damage:
  `tone: "void"`. A blow that hits several tokens: ONE impact, on the worst hit (the others are refused as `"busy"` anyway). Do not add
  your own flash or shake on top.
- **Map destruction.** Blast instant: `I.play({ kind: "blast", ...I.pick({ type: "blast", area: radiusInSquares }), subject: { x, y },
  space: "world", area: radiusPx, seed: firing.id, startAt: performance.now() + (plan.t0 - sharedNow()) })`. Meteor / landing: `kind:
  "landing"`, `dir` = the fall's direction on the map (90 = straight down the screen). Fire and debris phases get none.
- **A lettered word.** `const h = L.sfx("boom", { ... }); I.play({ kind: "word", magnitude, subject: h, over: "ui", seed, startAt })`
  (after `await h.ready` when the word's picture should be the silhouette). A world-space word is itself inverted by a slam under it,
  like everything in the scene.
- **Pixel-art power VFX.** At the power's contact frame: `I.play({ kind, magnitude, subject: targetToken, from: casterToken, colors:
  [powerColour, second], seed: castId, startAt: tContact })`; kinds by the power's nature (`shock` energy, `slash` blades, `blast`
  areas, `landing` leaps).

Rules for every caller: one impact per event; never in a loop or on a timer; pass the token (visibility) and a shared `seed` +
`startAt`; check `h.mode` / `await h.finished` only when your own effect must know; test as a player, with the guard on (the default)
and with `motion: reduced`.

## Looking at it

- Live: `(await MoinenLetters.engine()).impact.gallery({ subject: token, dir: 20 })` (`part: "frames" | "kinds"`).
- Offline (no Foundry, one headless browser: take a light slot): `node dev/tools/impact-render.mjs --out <dir>` in moinen-maps
  (every frame type, then every kind at four strengths, one PNG per tick, strips, `film.webm`, `report.json`; `--mode local`,
  `--motion reduced`, `--photosafe 0`, `--bg dark|light|map`, `--spec file.json`).
- Checks: `node scripts/letters/impact/check-impact.mjs` (also section 8f of `check.mjs`).
