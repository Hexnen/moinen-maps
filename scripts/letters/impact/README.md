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
| `magnitude` | 0..2 like the lettering's (0.5 = an ordinary blow). Four strengths: under 0.35 two small local drawings; to 0.85 the scene goes hard black and white for a tick; to 1.35 full-field frames and a hit-stop; above that the whole set |
| `subject` | what is struck: a Token / TokenDocument / token id; a point `{ x, y }` (`space: "world"` for scene coordinates, else screen px; `area` = its radius); a rectangle `{ x, y, w, h }`; an HTML element (a panel; a `<canvas>` or `<img>` also gives the silhouette); a LETR word's handle; nothing = the middle of the view |
| `dir` / `from` | where the blow travels: `dir` in degrees (0 right, 90 down), or `from` = the attacker (token or point): the direction is then worked out on each client's own screen. Without either the impact is radial |
| `seed` | any string or number all clients share: same seed, same drawings |
| `startAt` | this page's `performance.now()` time of the instant of the hit (the LETR convention; an effect's shared time converts to it). Every drawing change then falls on the same instant on every seat; a client that is late joins at the drawing that is up, one that is too late shows nothing. Without it the impact starts when its first drawing is painted (next frame) |
| `over` | `"scene"` (default: over the map, under bars and windows, z 4) or `"ui"` (over every window, one under the lettering's `screen` layer, so a word on that layer stays on top); `z` or `parent` (an element) override |
| `tone` / `colors` | accent pair: `hero fire blood volt toxic void dust`, or `colors: [accent, second]` (a power's own colours). Ink and paper are fixed |
| `frames` | your own sequence instead of the kind's: `["shadow", { type: "slam", ticks: 2, punch: 1, stop: false }, "dots"]` (the limits still apply) |
| `hitstop`, `punch` | `false` turns the hold / the shove off for this call; `punch: 0.5` scales it |
| `vision` | `"none"`: show it even when the subject token is not visible to this user |
| `reduced` | `true`: this caller's own reduced-motion setting (the strongest reduction wins, as for words) |

Other calls: `I.prepare(spec)` paints everything ahead and returns `{ play({ startAt }) }` (use it when you know the blow is coming:
a roll being resolved, a projectile in flight); `I.plan(spec)` = the plan this client would show, without spending flash budget;
`I.pick(event)`; `I.show(type, spec)` holds ONE frame type up to 2 s (gallery, design); `I.gallery(opts)`; `I.stopAll()`;
`I.kinds`, `I.frames`, `I.tones`, `I.limits`, `I.stats`, `I.busy`, `I.mode()`, `I.setMode("full" | "local" | "off")`.

`I.pick(e)` -> `{ kind, magnitude }` from an event in the caller's terms: `{ type: "damage", share (0..1 of the track lost), crit,
fatal, cut, energy }`, `{ type: "roll", crit }`, `{ type: "blast" | "landing", area (grid squares) }`, `{ type: "word", magnitude }`.

## Frame types

| id | what | full field |
|---|---|---|
| `pop` | burst star (accent, paper core, ink line) with short ticks, where the blow lands | |
| `splat` | ink splash thrown along the blow, small star | |
| `lines` | speed lines along the blow, or focus lines to the subject when there is no direction | |
| `ink` | the scene in hard black and white, lines, a star | |
| `slam` | the scene's black-and-white NEGATIVE, lines, an ink star | yes |
| `shadow` | black frame, the subject's picture inked on a paper silhouette, enlarged, on a two-colour star | yes |
| `glare` | paper frame, heavy ink lines, the subject as a black negative | yes |
| `swap` | accent-colour frame, halftone, the subject in ink with a paper line | yes |
| `window` | black frame with a torn star-shaped window on the scene's negative | yes |
| `smear` | the subject's silhouette smeared back along the blow in three flat colours | |
| `tear` | a ragged paper band across the frame; one side of it is the scene's negative | yes |
| `rip` | the band alone, with a splash | |
| `dots` | halftone fan in the accent, star | |
| `shatter` | the scene in black and white, cracks running out, loose shards | |
| `chroma` | the scene's colour plates pulled apart along the blow | |
| `ring` | broken shock rings, halftone rim | |
| `fade` | last drawing: a few thin ticks and specks | |

A drawing may also carry `stop` (hit-stop: the canvas ticker is held, so tokens, weather and effects stand still under the frame) and
`punch` (the board element is shoved along the blow and settles in two steps). Both are undone at the next drawing, at the end, and
by a watchdog timer that fires even when the frame loop is dead (a hidden tab).

The subject: a token gives its live texture (no fetch, no pixel read-back); the frames that show it alone enlarge it so the struck
figure fills its share of the frame at any zoom. A point or a panel has no silhouette; those frames then draw a star in its place.

## Kinds

`hit` (hero yellow), `heavy` (fire; cracks), `crit` (hero; chromatic split after the slam), `blast` (fire; radial, a white frame first),
`slash` (blood; smear, the frame torn along the cut), `landing` (dust; lines from above, rings, cracks), `ko` (blood; the longest hold),
`shock` (volt; chromatic split first), `word` (behind a lettered word). Each has four strengths; the sequences are the `KINDS` table in
`plan.mjs`. `I.gallery()` plays them all.

## Safety (the limits enforced)

Full-screen flashes and inversions can harm photosensitive viewers. The engine's own preferences decide (namespace `moinen-letters`;
`L.prefs`), plus one client setting of this feature, `moinen-letters.impact` = `full | local | off` (`I.setMode`).

| limit | value | where |
|---|---|---|
| length of an impact | at most 12 ticks = 500 ms; one drawing at most 4 ticks | `planImpact` (also a caller's own `frames`) |
| hit-stop | at most 4 ticks = 167 ms per impact | `planImpact` |
| full-field frames, guard on (`photosafe`, the default) | at most 2 per impact AND at most 2 in any rolling second on this client, counted in the SAME log as the words' flash frames; a full frame over the budget becomes its quiet twin (`slam` -> `ink`, `shadow`/`window` -> `pop`, `glare` -> `lines`, `swap` -> `ink`, `tear` -> `rip`). The slam is kept first. Two full frames a second is at most two flashes a second: under the three of WCAG 2.3.1 | `safety` |
| saturated red | never fills the frame while the guard is on (the `swap` frame takes the second accent or paper) | `draw.mjs` |
| `flashes` off, `motion: gentle`, or `impact: local` | the GENTLE variant: no full-field frame, no inverted scene, no hit-stop; every drawing is clipped to a jagged panel round the subject of at most 20 % of the viewport; the shove is halved (`gentle`: none, and no chromatic split) | `safety`, `draw.mjs` |
| reduced motion (`motion: reduced`; `auto`/`gentle` with the OS switch; a caller's `reduced: true`) | ONE small still drawing (the star) for at most 4 ticks: nothing moves, nothing is done to the scene | `safety` |
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

See the report of the build for the numbers on the test machine; the method: every drawing is painted once on a software 2D canvas
(`paint`, timed in `I.stats.paintMs / paintMax`), the first one in the frame the impact starts, each next one during the drawing
before it (or all of them ahead with `I.prepare` / while waiting for `startAt`); a drawing change is a style swap (`I.stats.showMax`);
`I.stats.frameMax` is the longest animation-frame gap seen while an impact was up. A picture is at most 2.2 million pixels (a 4K view
is painted at about 1080p). The freed canvases are released at each change; at the end nothing is left in the DOM.

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
