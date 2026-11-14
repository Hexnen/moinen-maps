# LETR manual: the comic sound-effect lettering engine

For game masters, module authors and coding agents who call the engine or change it.
The engine's own `scripts/letters/README.md` stays the design notebook (sources, reasoning, full option tables); this manual is the
user's guide: how to call it, how to place and time words well, what is binding, how to test, what is about to change.

## How to read and keep this manual

**Stages.** The engine grows in named stages. Each section says which stage owns it and its status:

| status | meaning |
|---|---|
| `stable` | on `tactics-zones` and not scheduled to change |
| `changing` | on `tactics-zones`, but an ordered review (SPEC-LOOK / SPEC-MOTION / vocabulary review) will change it next; the section lists which points |
| `pending merge` | written on its own branch, not on `tactics-zones` yet; the merge may still move details |
| `planned` | ordered, not built |

**Marks on statements.** `[V]` checked for this manual by running the code under node (the engine's fake Foundry, `testenv.mjs`);
`[C]` read in the code; `[R]` carried over from the engine README or contract and not re-checked. A statement without a mark
belongs to the paragraph's mark.

**Updating.** One stage = one edit of this file in the same commit (or the same day) as the engine change:
1. update the stage table below (version, branch, status);
2. edit only the sections the stage owns; flip their status lines; re-mark statements you re-checked;
3. move points out of "What is about to change" when they land;
4. add a line to the change log at the bottom.
**Lessons and rulings too:** whoever learns something about the engine (a trap, a wrong assumption, a bug) or receives a ruling from
the owner updates this manual (and the agent skill `moinen-letters`) in the same turn: rulings go to section 14, traps for callers
to section 5, limits and bugs to section 18, planned work to section 19.
Keep the section titles stable: other documents and the agent skill link to them.

| stage | engine VERSION | contract | where | status |
|---|---|---|---|---|
| LETR core (renderer, layers, motion techniques, size model) | 1.2.0 | v1-v4 | `tactics-zones` | stable |
| FXLE (lifecycle and safety fixes) | 1.2.1 | (fixes) | `tactics-zones` | stable |
| WORD (vocabulary, 87 kinds, flows) | 1.3.1 | v5 | `tactics-zones` | changing (SPEC-WORDS, SPEC-KINDS: WORD2) |
| KINDS1 (material, impact, debris, shock wave, fire ladder, chains + TAILS; 94 kinds) | 1.7.1 | - | `tactics-zones-kinds1` | pending merge |
| TOOL (settings, authoring, designer, GM-only networking) | 1.4.1 | v6 | `tactics-zones` | stable |
| MOVE (travel, choreography, rates, escalation, shards, push, glow, sustain, ambient) | 1.5.0 | v7 | `tactics-zones-move` | pending merge; then changing (SPEC-MOTION) |
| LOOK (styles, sound -> look, lines, backdrops, accent, legibility, rings) | 1.6.0 | v8 | `tactics-zones` | changing (SPEC-LOOK P1-P17) |
| LM (MOVE + LOOK merged) | 1.7.0 | v7+v8 | `tactics-zones-lm` (in progress, not on origin yet) | pending merge |
| LOOK2 (invincible rebuilt: SPEC-LOOK P1-P15, P17, P18; legacy look frozen as `expressive`) | 1.8.0 | v9 | `tactics-zones-look2` | pending merge |
| IMPACT (impact frames, `L.impact`, folder `scripts/letters/impact/`) | 1.7.2 (in 1.8.1) | - | `tactics-zones` | stable (fixes below) |
| FXI-ENGINE (impact frames: guard counts every scene change, six strengths, red-safe, `gentle`, settings row, drawings) | 1.8.2 | API-CONTRACT 1.8.2 | `tactics-zones-fxi-engine` | pending merge |
| MOTION2 | 1.9.0 | `tactics-zones-motion2` | - | pending merge (section 11a) |
| FIN-ENGINE (FXI-ENGINE merged onto MOTION2; `plan.contactMs` / `L.contactAt`, per-word `flash: false`, impact `blowAt` / `keep` / `series`, sizes from the subject, series scheduled ahead all play) | 1.9.1 | API-CONTRACT 1.9.1 | `tactics-zones-fin-engine` | pending merge (sections 4, 21a) |
| MODE (the invincible motion type as the GM's table setting `movement`; stepped grid on the shared clock, `L.gridClock`) | 1.9.2 | API-CONTRACT 1.9.2 (v12) | `tactics-zones-mode` | pending merge (sections 11a, 15) |
| LOOK3 (invincible: staggered interlocked O, two always / three rarely / four never; first letter as tall as its neighbour; no hole before the last letter; a source above or below no longer bends the word) | 1.9.4 | API-CONTRACT 1.9.4 (v13) | `tactics-zones-look3` | pending merge (section 13) |
| WORD2, OUTL | - | - | - | planned (see "What is about to change") |

Contents
1. What LETR is
2. Getting the engine
3. Quick start
4. `L.play`: options, handle, lifecycle
5. Placing and timing words (lessons from three caller reviews)
6. Size
7. Layers and who sees a word
8. Several clients and networking
9. The vocabulary: `L.word`, `L.sfx`, flows, numbers
10. Streams: repeating sounds
11. Motion (core)
12. Motion 1.5.0: travel, choreography, rates, escalation, sustain
13. Look
14. The owner's binding rulings
15. Tools: settings, authoring, designer, accessibility
16. Testing and rendering offline
17. Changing the engine: the two copies, VERSION, sync, merges
18. Known limits
19. What is about to change
20. API index
21. Change log of this manual
21a. Impact frames: `L.impact`

---

## 1. What LETR is
Status: stable.

LETR letters a sound word the way comic letterers draw sound effects (own shape, size, colours, outline, 3D block per word) and
animates it frame by frame on a 24-tick clock: an entrance, a hold that keeps living, an exit. It draws over the interface (HTML,
`space: "screen"`) or on the canvas in scene coordinates (PIXI, `space: "world"`). The look of a word (its "hand") is
deterministic for a `seed`, so every client can show the same lettering.

Parts (all in `scripts/letters/`):

| file | what |
|---|---|
| `index.mjs` | entry: registers this copy in `globalThis.MoinenLetters`, picks the newest copy, `letters()` |
| `engine.mjs` | the runtime: play, stream, burst, still, scheduling, layers, visibility, size every frame, `VERSION` |
| `design.mjs` | the plan: moods, hands, layout, timeline (pure) |
| `paint.mjs`, `shape.mjs`, `geom.mjs`, `font.mjs`, `fontbank.mjs`, `legibility.mjs` | drawing from font outlines; letter readability |
| `size.mjs` | the size model (pure) |
| `words.mjs`, `words-reviewed.mjs` | the vocabulary (pure) and the list of reviewed syllables |
| `tools.mjs`, `prefs.mjs`, `author.mjs`, `net.mjs`, `ui.mjs`, `strings.mjs`, `tools.css` | settings, authoring, networking, windows, texts |
| `gallery.mjs` | the show-off wall |
| `check*.mjs`, `testenv.mjs` | node checks and the fake Foundry they run in |
| `sync.mjs`, `MANIFEST.json`, `stamp.mjs` | keeping the two copies identical |
| `fonts/`, `ATTRIBUTION.md` | eleven SIL OFL 1.1 fonts and their notices |
| (1.5.0, pending merge) `move.mjs`, `choreo.mjs`, `shards.mjs`, `sustain.mjs`, `check-move.mjs` | motion layer |

The engine makes no sound. Audio is deferred by the owner: default silent; a later opt-in may attach a sound to a word's clock.

## 2. Getting the engine
Status: stable.

The same folder `scripts/letters/` ships in two modules: **moinen-maps (canonical copy)** and **invincible-plus-ultra (vendored
copy)**. Each loaded copy registers in `globalThis.MoinenLetters`; the highest VERSION wins (ties: the more recently synced content,
from `stamp.mjs`, with a console warning) and every caller uses that ONE engine instance: one font cache, one limit on words at
once, one memory of recent hands, one vocabulary. [C]

```js
// module code (either module): path relative to your file
import { letters } from "../letters/index.mjs";
const L = await letters();                                    // fonts loaded

// macros, console, other modules
const L = await game.modules.get("moinen-maps").api.letters();
const L = await game.modules.get("invincible-plus-ultra").api.letters();   // attached just after "ready" [C]
const L = await globalThis.MoinenLetters.engine();

// a third module that must not depend on either: check first, skip lettering when absent
const L = globalThis.MoinenLetters ? await MoinenLetters.engine() : null;
```

A copy registered after the engine was already created is used only after a reload (console warning). [C]

## 3. Quick start
Status: stable.

```js
const L = await MoinenLetters.engine();
L.play("KRAK!", { mood: "crack", space: "world", at: { x: 2100, y: 1400 }, seed: message.id });   // on the map
L.sfx("boom", { magnitude: "huge", lang: "auto", space: "world", at: token, seed: message.id });   // a word from the vocabulary
L.play("-3", { mood: "pain", space: "world", at: token });                                         // above a token, follows it
L.play("KABOOM!", { mood: "boom", magnitude: 1 });                                                  // over the interface, centre
const cnv = await L.still("BAM!", { mood: "impact", size: 48 });                                   // one picture (chat card)
L.gallery({ space: "both" });                                                                       // the show-off wall
```

Rules of thumb (sections 5, 6 and 9 explain them): state the EVENT (`magnitude`, `area`, `span`, `token`), not a pixel size; take
the word from the vocabulary; seed with an id every client knows; give token-bound words their token; tie the word to the event's
clock.

## 4. `L.play`: options, handle, lifecycle
Status: stable (option names); motion and look values: see sections 11-13.

`L.play(text, opts) -> handle`, synchronous, never throws. [V]

**Text.** Any string, upper-cased with Polish rules; Polish letters, digits, `! ? - + ' .` and spaces; `\n` stacks lines; cut at 160
characters [V]; a character no font has is drawn as "?" with one warning [R].

**Options** (all optional; full table in the engine README "Calling it"):

| group | options |
|---|---|
| what it sounds like | `mood` (`impact crack crash boom roar fire whoosh zap tick pain powerup heal splash fail`, or `auto` = guessed from the letters) [V]; `sound` `{ loud, sharp, long, pitch, rough, peak }` fine intent; `character`, `accent` (given by the vocabulary, section 9) |
| where | `space` (`screen` default, `world`); `at` (point; world: token, TokenDocument or id, or a function returning `{x, y}` called every frame); `anchor` (`center`, `bottom`; bottom on a token); `from` (angle in degrees or a point: letters grow away from the source); `layer` (section 7); `zIndex`; `parent`; `rotation`; `elevation`; `vision` |
| how big | `magnitude`, `area`, `span`, `token`, `size`, `scale`, `fit`, `maxWidth` (section 6) |
| when | `delay` (ms), `startAt` (this page's `performance.now()`), `until` (a Promise: the word leaves when it settles), `hold` (ms), `tempo`, `loop` (hold until `stop()`) |
| which motion | `in`, `holdKind`, `out` (names: `L.motionNames()`), `reduced`, `pixel` (world only: pixel-art lettering) |
| which look | `seed`, `avoid` (hand ids to differ from), `hand` (pin a hand: `h.hand` string or a partial hand object), `colors`, `palette`, `font`, `style`, `look`, `arrange`, `backdrop` (section 13) |
| tools | `alt` (screen-reader text), `force` (play even when the master switch is off; tools only) |
| impact pairing (1.9.1) | `flash: false` drops this word's own flash accent (the invincible style's white flash drawing; legacy: its impact pictures turn plain, timing unchanged): use it when an impact frame is the flash |

**Handle.** `id`, `hand` (string, set at once unless `delay`), `plan` (set at once unless `delay`) [V], `ready` (Promise: `true` when
the first picture is on screen, `false` when the word ended without showing) [V], `finished` (Promise: `"done"`, `"stopped"` or
`"evicted"`; always settles) [V], `alive`, `stop({ quick })` (quick false: play the exit now; true: remove at once) [V],
`moveTo(at)`, `contactAt` (1.9.1: this page's instant of the word's contact pose, or null; also `L.contactAt(h | plan, startAt?)`;
`plan.contactMs` = ms from the word's start, on the TICK grid in stepped motion) [V]. Words from the vocabulary also carry `h.word` [V]; from the network `h.netId`; with the master switch off `h.off` [C].

**Lifecycle you can rely on** [V unless marked]
- The word is planned inside `play`; its geometry and first picture come in the next animation frame(s) within a per-frame budget
  (about 6 ms for new words), so a burst of 48 comes up over a few frames. [C] Without `startAt` the clock starts when the first
  picture shows.
- Bad options never throw: an unusable number (NaN, Infinity, size or tempo <= 0, hold < 0) is ignored with one warning and the
  default used; an unknown mood becomes `auto` with one warning; an `at` function that throws keeps the last point [C].
- Limits: 16 words at once over the interface, 48 on the canvas (`L.limits`, settings `limitScreen`, `limitWorld`); over a limit the
  oldest leaves at once (`"evicted"`).
- A word on a token follows it; when the token goes away the word stays where it was and plays its exit. A token id not on this
  scene: skipped (`ready` false, `finished` "evicted").
- A scene change evicts every world word, also those waiting for their `delay`, and stops every world stream. `L.stopAll({ space,
  quick })` does the same for everything. `L.count({ space })` counts words on screen.
- `startAt` more than 60 s in the future is ignored with a warning (it must be this page's clock).
- With the master switch (setting `enabled`) off, `play` returns a handle that is already over (`alive` false, `off` true,
  `ready` false, `finished` "evicted") [C]: callers that hide their own fallback when a word is "playing" must check `h.off`.

**Other calls.** `L.burst(items, common)` several words in one moment, every one a different hand; a `seed` in `common` becomes
`<seed>:<index>` per item [V]. `L.still(text, opts)` -> Promise<canvas> of the hold drawing at `size` (default 72) [V].
`L.design(text, opts)` -> the deterministic plan as plain data (`hand`, `layout`, `timeline` with `kinds` and `tech`, `mood`,
`sound`, `character`, `traits`, `accent`, `sizeK` ...) [V]. `L.stats` = `{ rendered, ms, maxMs }` [V]. `L.version` [V].

## 5. Placing and timing words (lessons from three caller reviews)
Status: stable as advice; items marked (engine) change when MOVE merges.

Three blind reviews watched the first callers (token reactions, the dice-roll splash, map destruction and fire) on recordings. Every
mistake below happened. Avoid them in any new caller.

**Stay in view and off the interface.**
- On 1.6.0 the engine does NOT keep words inside the view [C]: a word placed at a token near the edge is cut. Clamp your own `at`
  so the word's box fits. (engine) MOVE 1.5.0 adds keep-in-view (`keepInView`, default on) and `L.viewInset(...)` for edges such as
  a letterbox; pending merge.
- The engine knows only the viewport. Your module's panels (pins, combat HUD, portraits, hotbar, chat input, replay pills) are yours
  to avoid: test placement against them, on the GM's and a player's screen (they differ).
- A cinematic letterbox or caption must be checked when it starts, not only when the word starts.

**Do not cover what you letter.** Put the word beside the event, not on its centre (a collapse word hid the rubble; a crack word hid
the crack). On a token, letter above it; keep numbers off the token's face. Never put one token's word on another token.

**Make the important thing the biggest.** Map severity onto `magnitude` across its whole range (0..2, normal 0.5, a crit 1, a
building down 1-1.5). One caller sent every event at 0.1-0.4 and the legibility clamp flattened the rest, so a knock-down was
smaller than a scratch. Quiet tails (a fire going out, a hiss) must be quieter than the event they follow. Let the size model work:
no fixed pixel sizes.

**Use sound words, not action names or dictionary words.** HAYMAKER!, TRY AGAIN, CRASH, SPLASH, TRZASK are not allowed (section
14). Take words from the vocabulary (`L.word` / `L.sfx`), with loudness and duration set separately.

**Bind timing to the event, not to timers.**
- Pass `startAt` / `delay` / `until` from the effect's own clock. Pre-scheduled `setTimeout` words played after the fire was out.
  Cancel your pending words when the event ends or is erased.
- A lead-in word (the creak before a cave-in) must be computed from the moment the event arrives, or it plays together with the
  main word and is hidden.
- A number that should follow its word: start it after the word's entrance (await `h.ready`, or offset by the entrance length from
  `h.plan.timeline`), not a fixed 110 ms.
- A sound that lasts (fire, engine, hiss): `L.sustain` / `L.flow` (sections 9, 12), not one word on a slot timer.

**One moment, one composition.**
- Two changes on one token in one moment: do not let the lighter one stop the heavier one; merge them (one word, a number beside
  it) or stack them.
- An area attack: letter every visibly hit target the same way; numbers of one blast in one hand (pin `hand` or use one seed),
  not confetti of fonts and tilts.
- A room cap must keep the main word: sort by importance before you cut, not by time.
- Word, number, sentence and odds of one roll are one composition: measure their boxes together; do not scatter labels around
  the screen at fixed percentages.

**Every client the same; nothing secret in a seed.**
- Seeds and every input of the look must be identical on all clients: no per-client "last word", "seen", quiet windows or arrival
  times in the seed.
- Never derive a seed or a choice from hidden data (hidden Health, a hidden token): a player could read it back.
- Give token-bound words their token (`at` = token or `token`), so hidden or unseen tokens are not revealed (section 7).

**One language per world, not per client.** `lang: "auto"` follows each client's own interface language [C], so a GM in Polish and
a player in English get different words from the same seed. When every client must see the same word, pass one language (a world
setting of your module, or the GM's language sent with the event). English is first-class (section 14).

**Destruction and effects: letter the phases, not one moment** (owner's rulings, section 14).
- Order: the blast, then debris falling, then fire whose intensity changes; a shock wave is its own lettered event.
- What is hit decides the sound: stone, wood, glass, metal, earth sound different; pass the material through the kind you pick.
- A shot has two ends: the muzzle at the shooting token and the impact where the bullets land; letter both.
- Cover every way the effect can start (presets, combinations, brush painting, directional, all at once) and test each one.
- Analyse each effect on its own; one word for a bomb is too little, one recipe for all effects is wrong.
- Words may repeat or be shared when it makes sense; do not force a new word for every event.
- Phases arrive on their own clock: a caller that drops "echoes" (a sound right after a louder one nearby) must let the phases
  through, or the wave and the debris vanish behind the boom; the same for a shot's muzzle report against its impacts (seen live
  on the map, 2026-11-14; the map's node tests fed all events at once and missed it).
- A lasting sound for a subject off this client's screen (a fire's sustain) needs `keepInView: false` on 1.7.0, else the engine
  pulls it to the screen edge.
- 1.7.0 has the guns' own kinds (`pistol`, `rifle`, `gunfire`, `minigun`, `shotgun`, ...) and `grenade` / `rocket`; there is no
  `gunshot`. Pick from the event (the map picks the gun by the rate of its rounds).

**An event told as a page (EFFECTS1, the map's presets, 2026-11-14).** One event (a bomb, a meteor, a rocket) is planned ONCE, by a
pure function from data every client shares, as a page of roles: `pre` (the fall, the flight, the charge), `main` (one word, once:
"one explosion = one word"), `wave`, `fall` (debris landing), `catch` (the fire taking), `out` (the hisses of dying fires). Lessons
from the films:
- The page OWNS its parts: the destruction entries, the burst and dust strokes and the fires it lit must not ALSO be lettered by
  the general per-stroke path, or the bomb says BOOM twice and every fire hisses on its own.
- Write each word before this screen picks its spot, in page order, and never repeat a word of the same page (try the next seed):
  without it four meteor pages in five repeated a debris word. Then every client writes the same words even when one screen drops
  some of them.
- A spot chosen from the data (the farthest debris landing) is often off screen at a close zoom: give the planner several
  candidate spots and let each client take the first one in its view, else the debris words are silently dropped.
- A word riding a path (a bomb's whistle, a rocket's flight) must be gone before the main word's flash frame: stop it about a fifth of
  a second before (`h.stop()` at a timer).
- A wave word on a fixed angle rode under the interface panels and through the main word: choose its direction per screen (away
  from the main word as placed there, off the panels, inside the view, screen-up preferred).
- A fire's lasting word with the sustain's `echo` treatment sat stacked on itself (FOOOFF three times): pass `treatments` without
  `echo` until the engine places echoes clear (REQUESTS EFFECTS1-6).
- An unlocated sound (a gun with no shooter on the map, a shooter or a page word this player cannot see) goes to a free spot on
  the screen (`space: "screen"`, layer `hud`), never at the hidden place.
- A gun's report: start its syllables outside the shooter's token circle plus about a third of a square, screen-up of the barrel.

**More stories, and sizes by rank (EFFECTS2, the map, 2026-11-14).**
- Size a story's words by RANK as a share of the view height (R1 4 %, R2 5.5 %, R3 7.5 %, R4 11 %, R5 15.5 %; pass `size` in scene px =
  share x view height / zoom, and `ceilK: 1` so the engine's ceiling share does not cut the hierarchy again). With magnitude alone the
  small words of a wide event (a meteor seen at the zoom its ring needs) sat on the legible floor and the story could not be read.
- A word that must GROW along a ride (the meteor's descent) cannot (REQUESTS EFFECTS1-3): hand over from a small word to a bigger
  one (a thin high whine far up, then the deep roar of the last rush); the first leaves when its own way ends.
- A plough (a carried token shoving others) is three different words that build: a short knock at the first contact, a long scrape
  riding beside the head of the pile, louder the more it pushes, then the biggest word where the pile stops. Never on the pile:
  the screen-up side of its way.
- Lightning: steady weather is silent; a far flash rumbles small at the screen edge on its side 1.2-2 s after the light (every
  second one, counted from the storm's switch-on so every client counts the same), a mid one louder 0.5-1 s after, a close strike
  thunders beside its foot on the stroke. Read the flashes from the storm the client SHOWS (who: gm = players get none).
- Detonate: hear it whole (one call before the areas go off), group the areas into explosions (one stroke, or strokes that touch,
  are one), letter the biggest few, largest first, 120 ms apart, and keep each area's own entry silent; mark the composed events so
  an echo filter does not swallow the second and third.
- A cause never replaces the ground's big sound: a burning, clawed or acid cave-in still comes down as a cave-in; the cause colours
  the smaller damage. A big brush blast or cave-in drops debris words after it, by the ground's material (the engine's `debris`
  rows: rock on stone, timber on wood, plinks in water), as phases of the same stroke.

**What the live films of EFFECTS2 taught (lane 5, 60 fps, GM and Test Gracz 1, 2026-11-14).**
- Bigger, readable story words take room: at a close zoom the meteor's main word and wave covered every landing, and four debris
  words were dropped. A debris / catch word now tries the next landings in view, then waits up to a second for room
  (`FALL_WAIT_MS`); the debris keeps coming down, so a late word still tells it.
- A standing PRE word (the rumble) must yield when the main word lands, or it stands under the blast and crowds the wave.
- Every ride that comes from beyond the screen (meteor whine, hero's fall, rocket without a shooter) or goes past it (the plough's
  grind) is clamped into the view with room for the word: it enters at the edge, whole.
- Detonate: entry areas have a generous r (about twice the painted radius) and an even bigger box; comparing boxes chained five
  separate explosions into one word. Compare centres against about half the two r plus a square.
- Words placed but not started yet (a cluster flushed ahead of its moment) are not in `alive`: keep their boxes until they start,
  or the next cluster is placed over them. A cave-in word sinks as it holds: its box must reach half its height lower.
- A storm strikes anywhere on the scene: a close strike off the view is still the big word, at the edge toward it; a word at a
  fixed screen spot is clamped so it is whole (a rank-5 word at 16 % of the height stood half off the top).
- Find a shooter as the NEAREST token at its muzzle, not the first in the list: a visible token beside a hidden turret was taken
  for it and the turret's launch word was drawn at the hidden turret on the player's screen.
- Frame time (GM, meteor then bomb 2 s later, chs 60 Hz): lettering on mean 16.82-16.84 ms, 2-3 frames over 33 ms (max 50-67 ms)
  at the impacts; off mean 16.67 ms, none over 33 ms.

**Changing one trait of a vocabulary word.** `L.sfx(kind, { character: { material: "wood" } })` replaces the word's whole
`character`, and the gaps are then filled from the mood's defaults, not the kind's [C]. To change one trait, take the word and merge:
`const w = L.word("crash", o); L.play(w.text, { ...w.play, character: { ...w.play.character, material: "wood" }, ...placement })`.

**Numbers.** Format with `L.number` / `L.range` in the client's language (`2,5` in Polish, not `2.5`) [V]. The engine draws plain
numbers (`-1`, `+4`, `x2`, `12%`) in a calm, even hand [R]; keep them big enough to read and attach them to the token (`at` =
token) so they follow it.

**Clean up.** On a scene change clear your own state (recent words, pending events) too; the engine clears only its own words.

**Settings stack.** The engine's own `scale`, `motion`, `photosafe`, `palette` settings apply on top of a caller's settings; test both
together.

## 6. Size
Status: stable. [R] unless marked; numbers in `L.sizeModel` [V].

A word's size comes from the EVENT (stated by the caller) and the VIEW (known to the engine), recomputed every frame.

| option | meaning |
|---|---|
| `magnitude` | 0..2 (default 0.5) or `tiny small normal big huge epic` |
| `area` | the event's footprint: radius in scene px, `{ radius }`, `{ w, h }`, or a placeable/bounds |
| `span` | size in scene px of what makes the sound, when it is not a token (a pixel-vfx effect's width) |
| `token` | the token the sound belongs to (automatic when `at` is a token) |
| `size` | an explicit NATURAL size (cap height: screen CSS px / scene px); still clamped |
| `scale` | a multiplier |
| `fit` | `legible` (default: soft clamp to a readable range), `world` (never clamped), `screen` (`size` = CSS px whatever the zoom), `exact` (no model at all) |

- World words: 0.55 grid squares, grown by the token's span (power 0.5), the footprint (power 0.6) and the magnitude factor (0.7 at 0,
  1.1 at 0.5, 1.5 at 1, 2.3 at 2), times the mood's factor (`plan.sizeK`, about 0.62-1.32). Screen words: 7.5 % of the viewport
  height x magnitude factor.
- Legible range: floor about 2.6 % of the viewport height (15-30 px; lower when many world words are up); ceiling grows with
  magnitude (cap height 7 % + 8 % x magnitude of the viewport height; width 40 % + 25 % x magnitude of the usable width) and shrinks
  when more than 2 world words are up.
- Zoom and window resizes are followed live; a picture is redrawn when it would be shown much bigger than drawn.
- `pixel` words snap to whole art pixels (7-40 per cap height) once and keep that size.
- `L.sizeOf(text, opts)` -> `{ size, px, natural, clamp: null|"floor"|"ceil"|"width", fit, sizeK }` tells what a word would get now
  [V]. `L.gallery({ part: "sizes" })` shows the model live.
- The setting `scale` multiplies AFTER the clamp.

What each kind of caller should pass: dice splash (screen) `magnitude` from the roll; token reactions `at: token` + `magnitude` from
the damage relative to the track; map destruction and fire `area` + `magnitude`; pixel-vfx `span` or `area` + `magnitude` from the
power level.

## 7. Layers and who sees a word
Status: stable. [R] for the draw order, [V] for the ids.

| layer | space | where |
|---|---|---|
| `ground` | world | on the floor: over map water, roads, destruction, zones; under tiles and tokens; in the scene's light |
| `tokens` | world | just over tokens (at a token's elevation when `at` is a token), under the map's smoke and weather |
| `weather` | world | over core and map weather and smoke, still in the scene's light |
| `overlay` | world | DEFAULT: over the whole scene and its lighting, under the HTML interface |
| `top` | world | over everything on the canvas, rulers and cursors too |
| `hud` | screen | over the map, under sidebar, bars and windows |
| `ui` | screen | over sidebar, chat, hotbar; under app windows |
| `screen` | screen | DEFAULT: over the whole interface (tooltips and notifications stay on top) |

`L.layers`, `L.defaults` (`{ world: "overlay", screen: "screen" }`) [V], `L.layerChoices(space, lang)` -> `{ id: label }` for a
`game.settings.register` `choices` [V]. Keep your own client setting and pass `layer` per call. An unknown or wrong-space layer falls
back to the default with a warning.

**Visibility.** A word that belongs to a token (`at` is a token, document or id, or `token` is given) is shown only while that token
is visible to this user: hidden tokens never to players, tokens out of sight neither. `vision: "point"` also hides a world word whose
point this user cannot see; `vision: "none"` always shows it. Plain point words are shown by default, even over fog on `overlay`:
pass `token` or `vision: "point"` when the spot must not give away where something happened. [C]

## 8. Several clients and networking
Status: stable.

- The same `seed` gives the same hand, layout and timeline on every client; the per-client memory of recent hands and the
  reduced-motion setting do not change a seeded hand. [R] Pass `from` as an angle, not a point (a point is converted with this
  client's pixels). [R]
- `startAt` is THIS page's `performance.now()`; it differs per client: never send it. Send a shared time instead.
- **`L.net` (GM only, binding owner ruling).** `L.net.play(text, opts)`, `L.net.burst(items, common)`, `L.net.stream(opts)` play on
  every client in step: one seed, start stamped on Foundry's ping-synced server clock with a 120 ms lead, tokens travel as ids, a
  client without that token skips the world word; functions, Promises, elements and `reduced` do not travel. Handles carry `netId`;
  `L.net.stop(netId, { quick })` stops everywhere. [C]
- On a player's client: `L.net.play` / `L.net.stream` return a handle already over (`refused: "gm-only"`, `alive` false),
  `L.net.burst` returns `[]`, nothing is sent, nothing throws, one console line per call kind [V]. Every receiving client drops a
  message whose sender is not a GM [C]. Players keep `L.play` / `burst` / `stream` / `sfx` on their own screen.
- Module code that letters game events (a roll, a hit) usually runs on every client already and does not need `L.net`: call `L.play`
  on each client with the same seed.
- Own socket: send `L.net.sharedNow()` and pass `L.net.local(sentShared)` (`{ delay }` or `{ startAt }`) to `L.play`. [C]
- Transport: socket `module.<host>` (host = moinen-maps when active, else invincible-plus-ultra), messages `{ t: "letr", v: 1, op }`. [C]

## 9. The vocabulary: `L.word`, `L.sfx`, flows, numbers
Status: changing: vocabulary review WORD2 (SPEC-WORDS), missing kinds (SPEC-KINDS); the rules in section 14 already bind.

The engine letters any text, but `words.mjs` knows WHAT to letter: a sound kind + loudness + duration + language -> a fitting
onomatopoeia with its mood, sound, motions, accent and character, seeded.

```js
L.sfx("crack", { loud: 0.8, lang: "pl", space: "world", at: token, seed: msg.id });   // word + lettering in one call
const w = L.word("boom", { magnitude: "huge", lang: "auto", seed });                   // just the word
L.play(w.text, { ...w.play, space: "world", area });                                    // lettered by the caller
L.stream({ kind: "gunfire", lang: "auto", at: () => muzzle(), to: target, every: 90 }); // syllables from the vocabulary
```

- `L.word(kind, o)` -> `{ text, kind, lang, tier, loud, long, bangs, step, template, prefix, mood, sound, motion, play, accent, peak,
  env, character }`; `play` = `{ mood, sound, in, holdKind, out, magnitude, accent, character }`, ready to spread into `L.play` [V].
  Options: `lang` (`pl`, `en`, a registered code, `auto` = the game's language); `loud` 0..1 or `magnitude`; `long` 0..1 or
  `duration` (ms) = how long the sound lasts, separate from loudness; `bangs` 0..2; `seed`; `avoid`; `step`; `template`; `prefix`.
- `L.sfx(kind, opts)` = `L.play(word.text, { ...word.play, ...opts })`; vocabulary keys (`kind loud lang step template prefix long
  duration bangs`) are not passed to `play`; `opts.sound` overrides per key; `h.word` is the word [V].
- Loudness picks the tier, the "!" count (0..2, never 3), a prefix at the top and the size; duration alone decides the stretch:
  `{ loud: 0.15, long: 1 }` -> a long quiet word without "!" (e.g. `TSSSSSS`); `{ loud: 1, long: 0 }` -> short with "!!" (e.g.
  `KRRACK!!`) [V, example words are seed-dependent].
- Only the sustain of a sound stretches (the R of a crack, the vowel and M of a boom, the S of a hiss); plosives, affricates and
  prefixes never repeat; no run over 6 letters. A caller's own word may mark stretch points with `+`. [R]
- 94 kinds in 13 groups (hits, breaking, blasts, motion, elements, powers, devices, voices, animals, vehicles, weapons, weather,
  impacts) [V on 1.7.1 KINDS1]; aliases (`explosion` -> boom, `laser` -> beam, ...) in `L.vocab.aliases`; an unknown kind letters as
  `punch` with one warning [V]. Kind list with labels: `L.vocab.list(lang)`; `L.vocab.choices(lang)` for settings [V].
- Escalation of one sound: `L.vocab.series(kind, n, { seed, lang, grow: "stretch" | "vary" })` (one notch more each step; never
  the same text twice running, never shorter) [V]; `L.word(kind, { step: n, template: first.template, seed })` for the n-th repeat
  [V]; `L.vocab.grow(text, n)` for your own text [V].
- Continuous sounds: `L.flow(kind, { lang, seed, loud, style })` -> `{ kind, lang, style, onset, at(i), tail, take(ms) }`; segments
  carry `phase`, `t`, `ms`, `text`, `play` ...; styles `steady drone crackle gust cycle mix` [V members]. The flow says WHAT and WHEN;
  how segments move is MOVE's `L.sustain` (section 12).
- `word.accent` (one weight per character), `word.peak`, `word.env` (`hit swell fade arc beat`) and `word.character` (hard, sharp,
  heavy, wet, metal, electric, heat, sustain, rough, pitch, contour, material, texture) feed the look [V]; for plain text
  `L.vocab.accent(text, { kind | mood })` and `L.vocab.character({ kind | mood })`.
- Numbers: `L.number(n, { lang, sign, digits, group, compact, times, percent })`: `12 500` / `12,500`, `2,5`, `1,2 MLN` / `12K`,
  `3×` / `×3`, `+2`, minus stays `-` so the auto mood reads pain/heal; `L.range(2, 4)` -> `2–4` [V].
- Adding (shared by every module using the engine): `L.vocab.add(lang, kind, words, { replace })` refuses dictionary words, words
  the fonts cannot letter and words over 22 letters (returned in `refused`, one warning) [V]; `L.vocab.define(kind, def)` adds or
  changes a kind [V]; namespace new ids (e.g. `pvfx-webshot`); `L.vocab.remove`, `L.vocab.reset`.

### 9a. Material, fire ladder, tails and chains (1.7.1 KINDS1)
Status: new, on branch `tactics-zones-kinds1` [V node: check-words section 20].
- New kinds: `shockwave` (pressure wave: HWUUUMMF / VWOOOMMF), `sonicboom` (KDAKUUM / KDAKOOM), `concussion` (a blast WITHOUT fire:
  KRUUM / KROOM, the owner's pick; BOOM / BUM only for blasts with fire), `impact` (a bullet or a blow landing; group `impact`),
  `debris` (falling pieces, repeats its last syllable for more pieces), `whizz` (a near miss), `casings` (brass on the floor),
  `dryfire` (an empty click), and `grenade` now has its own dry frag words (KDUMF, PDOOMF) instead of the boom's.
- Call-time word options (vocabulary keys, never passed to `L.play`): `material` (`stone wood metal earth water glass flesh
  shield`; aliases such as `concrete`, `steel`, `forcefield`; unknown = the kind's own words) picks the material's row for
  `impact`, `punch smash slap thud`, `debris`, `boom`, `crack crash crumble` (glass -> the `shatter` words, earth -> `crumble`) and
  sets `word.character.material`; `pieces` (`small medium large` or 0..1) picks the debris tier instead of loudness; `intensity`
  (1..5 or `ember flame burning blaze inferno`) and `stage` (`ignite`, `out`; wins over intensity) pick the fire row, each with its
  own flow style, envelope, sustain and "!" cap (an ember never shouts). The muzzle word of a gun never changes with material.
  ```js
  L.sfx("impact", { material: "metal", loud: 0.9, at: target, seed });          // KTRANNG-like, metal character
  L.sfx("debris", { material: "wood", pieces: "large", at: wall, seed });
  L.flow("fire", { intensity: "blaze", seed }); L.word("fire", { stage: "out" });
  ```
- `L.vocab.tails(kind, { material })`: the sounds that follow a sound by themselves (a blast -> shock wave + debris, a shot ->
  casings at the shooter's feet, an impact -> small debris unless water / flesh / shield), each `{ kind, t, rel, place, why }`.
- `L.vocab.chain(spec, { lang, seed, magnitude | loud, tempo, material, tails })`: an event told in order (build, peak, develop,
  resolve). `spec` = a named chain (`L.vocab.chains`: `explosion grenade collapse sonicboom shot miss burst ignite fireout`), an
  array of steps `{ kind, t, rel, role, place, material, pieces, intensity, stage, ...play options }`, or one kind (= that kind
  plus its tails). Returns steps sorted by `t` (ms, divided by `tempo`) with `word` and `play`; loudness = base x `rel`; two steps
  in a row never letter the same word; deterministic for a seed [V].
- `L.chain(spec, { ...the above, places: { source, target, ring, around, feet, bounce, behind }, at, startAt | delay, ...play
  options })` plays it: each step at `places[step.place]` (else `at`), seed `${seed}|${i}`; returns `{ steps, handles, stop() }`.
  It is local, not networked: each client calls it from the shared event (or use `L.net` per word). The engine does not yet
  have an "unlocated" placement for sounds whose source is hidden (requested in REQUESTS.md); pass a screen point until it does.
- Pickers and sheets: `L.vocab.variants(kind, lang)` -> `{ table, rows }`, `L.vocab.hitMaterials`, `L.vocab.fireLevels`.

The rules the words obey (only onomatopoeia, no dictionary words, prefixes, the comic's manner) are the owner's: section 14.

## 10. Streams: repeating sounds
Status: stable (1.2-1.4); changing: MOVE adds `orbit`/`path`/`orient`/`on`/`glow`, MOTION2 takes stream motion from the kind.

`L.stream(opts)` -> `{ beat(text?), stop({ quick }), finished, handles, emitted, alive }` [V]: syllables popping at a (moving) source,
travelling along `dir` or toward `to`, one hand for the whole stream.
- Text: `text` ("RA-TA-TA", split on hyphens/spaces), `syllables` (array), or `kind` + `lang` from the vocabulary.
- Timing: `every` ms (default 110; a value under 20 is ignored with a warning and the default used [C]), `beats` (exact ms of each
  syllable), `manual: true` + `s.beat()` from each shot, `count` (default 6), `duration`, `until`, `startAt`, `delay`, `swing`.
- `life` (ms per syllable, 340), `travel`, `spread`, `loud` (number or `(i) => 0..1`), and the play options for size, look, layer.
- On an effect's clock: with `startAt` in the past the syllables whose life is over are skipped; `s.handles` holds only the living
  syllables, `s.emitted` counts all [V]. A stream whose source token goes away stops. `L.stopAll()` and (world) a scene change stop
  it.

## 11. Motion (core): the legacy styles `comic` / `expressive`
Status: stable and frozen for `comic` / `expressive` (their plans and drawings are proved unchanged by MOTION2: 2052 fingerprints).
The `invincible` style moves differently from 1.9.0: section 11a. [R] unless marked.

- One clock of 24 ticks a second; drawings on twos (about 12 a second), heavy words on threes; smears, flash and snap frames on
  ones; a landed key pose is held 4-6 ticks. Every hold picture is a fresh drawing (the line "boils").
- Techniques picked per word from its intent: impact flash frame, smear frames, speed/zoom lines, anticipation, squash and stretch,
  follow-through, misregistered colour plates, Kirby krackle, halftone shadows. `L.design(...).timeline.tech` lists them (`flash
  smear antic follow misreg heavy`), `timeline.kinds` the entrance, hold and exit [V].
- Motion names (`L.motionNames()` [V]): in `crackIn drop grow pop rise slam zip`; hold `boil buzz flicker rattle shake throb wobble`;
  out `burst dissolve droop fall pop rise shatter shrink zipout` (1.5.0 adds `shards`). Force them with `in`, `holdKind`, `out`.
- Rising moods (fire, powerup, heal) leave screen-up; heavy ones (crash, pain, fail) fall screen-down. Nothing fades smoothly: words
  leave through halftone or pieces.
- Reduced motion (OS setting, setting `motion`, or `reduced: true`; the strongest wins): one entrance picture, no shake, a two-step
  halftone exit.

Known faults this section will lose (SPEC-MOTION, seen in frames): motions are random picks per word, not chosen from the sound;
`buzz` adds sparks to non-electric sounds; `crackIn` assembles pieces (breaking played backwards); impact lines re-flash through the
whole hold; a boom leaves by a second explosion; the wind-up shows the finished word before the sound; holds are 3 ticks (not on
twos) and words do not share a beat, which reads as judder; the hold amplitude is constant. These stay in `comic` / `expressive`
(frozen); the `invincible` style lost them in 1.9.0 (section 11a).

### 11a. Motion of the `invincible` style (1.9.0 MOTION2)
Status: pending merge (`tactics-zones-motion2`). [V] = node checks (`check-motion2.mjs`) and seen on 60 fps films of lane 5.

- **From the sound, not dice** [V]. `motion.mjs` holds 18 families (sharp dry hit, heavy hit, ringing metal, break, boom, fly-by,
  wind, electric, power, fire, steady hiss, water, engine, siren, bursts in series, animal voice, human voice, small device) and a
  row for every vocabulary kind (`KIND_MOTION`): entrance, hold envelope, exit, hold length from the sound's duration, drawing rate,
  which letters move, travel. Pass `kind` (`L.sfx` does it for you); plain text uses its mood's typical kind; a registered mood moves
  like the mood it extends. The seed varies only phases, never the row. `in` / `holdKind` / `out` still win when named; legacy names
  map (shake -> rattle, shatter -> shards, dissolve -> trailOff, exit pop/burst -> release).
- **Names.** Entrances `slam pop burstIn swell drop dropSlow squash grow roarIn rise ignite zip drag stretch crackIn falseStart
  squeeze sputterIn fade`; holds `still recoil rattle ring throb roll pass sway swirl buzz climb flicker crackle shiver snake purr
  wobble rate chop pulse beat lubdub walk growl roarPeak arc deflate tremble bend shudder sputter`; exits `cut ringOut trailOff
  smokeOff blowAway runDown powerDown sputterOut flickerOut fall droop rise shrink zipout release fade shards crumble`.
- **One painting, moved** [V]. The word is painted once (its hold picture) and the sprite / box is moved, turned, scaled, squashed,
  faded and darkened every display frame. New pictures only where the drawing changes: the impact accent (first tick of a loud sharp
  contact or a loud boom), a smear (stepped slam / burst-in), the cracked word, the vibrating letters (stepped), the pieces of a
  shards / crumble exit. A word paints 1-3 pictures (fake browser), so big world words no longer upload a texture per drawing:
  lane 5, magnitude-2 boom, worst frame 76-130 ms on 1.8.1 against 27-37 ms on 1.9.0 (34-50 paintings against 5-9; the rest are
  size-drift repaints, see 18).
- **Two modes** `look.motion: "smooth" | "stepped"`, default `L.motionMode()`. Since 1.9.2 (MODE) the default is the GM's table
  setting `movement` (section 15; owner: keep both types to choose from, the GM sets it for the table; default smooth); the setting
  drives `L.motionMode`, so a script's own `L.motionMode(x)` holds only until the setting changes. smooth: every channel
  interpolated. stepped: scale, squash, turn and the moving letters change on ONE grid (entrance on ones, hold and exit on twos; a
  word without `startAt` starts on the grid, up to 83 ms after the call), translation and alpha stay smooth; slams and booms get a
  smear at contact.
- **Who wins** (1.9.2) [V node]: reduced motion on a seat (OS, the client's `motion` setting, `reduced: true`: a fade that lands on
  the full contact) > a call's `look.motion` > the table setting > smooth. The legacy styles `expressive` / `comic` ignore all of it
  (own frozen timeline, section 11).
- **Same instant on every seat** (1.9.2) [V node]: the stepped grid runs on the world's shared clock (`L.gridClock`, set by the
  tools to `game.time.serverTime - performance.now()`). Before, each page used its own grid and two stepped seats sharing a `startAt`
  struck 0..41.7 ms apart (25.4 ms measured for two page phases 25.4 ms apart; 0.000 ms after). For one start, a stepped contact
  (`L.contactAt`) lands 0..41.7 ms (mean 20.7, 4800 starts x 12 kinds) after the smooth one: one table setting keeps every seat on
  the same mode, so callers that share a start (dice splash, token reactions, impact frames with `blowAt: L.contactAt(h)`) strike
  together. A reduced seat on a stepped table still lands on the unrounded (smooth) contact: up to 41.7 ms before the others
  (section 18).
- **Rules the checks hold** [V]: slam biggest on its first shown frame (no wind-up showing the word); pop at least half size at once
  and 0.8 by 50 ms (it never stands small, then jumps); neighbouring frames differ in scale by 1.4x at most outside a contact picture;
  a crack lands whole, then cracks; a boom leaves as smoke (darkens, lifts, thins), never a second burst; hits decay, swells rise,
  steady sounds stay within 15 %; a rumble holds 3x+ a punch; siren, heartbeat, rotor repeat at their own period; in hiss / growl /
  engine / ring only the sustained run moves (others under 20 %); reduced motion = fade in, still, 350 ms fade out; no sparks,
  krackle, impact or speed lines, no misregistration drawn into an invincible picture.
- **Streams and sustain** [V]: an invincible stream's syllables take the kind's row (a hiss grows, never slams; syllables never
  flash); `L.sustain({ kind })` picks treatments by flow style (steady: breath / stretch only; cycle: split; crackle may accent).
- **`L.word`**: `w.play` now carries `kind` and `vocabMotion` (the vocabulary's random picks, used only by the legacy styles), not
  `in` / `holdKind` / `out`. `L.play(w.text, w.play)` moves like `L.sfx`.
- Not done: scatter emitters (rain, hail), orbit travel for the tornado (it swirls in place), doppler on a pass, the throttled-CPU
  entrance timing run (SPEC-MOTION 6.10).

## 12. Motion 1.5.0: travel, choreography, rates, escalation, sustain
Status: pending merge (`tactics-zones-move`, engine 1.5.0, contract v7), then changing (SPEC-MOTION).
[V] = exercised under node on that branch; else [R].

- **Keep in view**: words near an edge are moved in so their hold and entrance fit (exits may leave); `keepInView: false` per word;
  `L.viewInset({ top, right, bottom, left } | (space) => insets | null)` reserves edges (default 8 px; a director's letterbox
  should set it while shown) [V exists].
- **Travel**: `path` (`{ from, to, arc, duration, ease, spin, loop, orient }`, `{ points }`, `{ fn }`; ends may be tokens or
  functions); `orbit` (`{ center, radius, period, dir, phase, turns, squash, breathe, orient }`; with `until` it lasts as long as
  the Promise); `orient` `lean | tangent | bend | none`.
- **Choreography**: `parts` (`"prefix"`, `"syllables"`, or a list), `beat`, `typeOn`, `countIn`, `echo`.
- **Frame rate per call**: `on: 1 | 2 | 3` or `fps: 24 | 12 | 8`.
- **Escalation**: `escalate: true | key | { key, n, window, max, mode }` (the same word on the same source within `window` ms grows,
  merges "BAM! BAM!", then counts "BAM! ×5"); `h.escalation` = `{ key, n, mode }` [V]; `L.escalation`.
- **Push**: `push: true | { radius, force }`; `pushable: false`; `L.push(at, { space, radius, force, except })` -> how many words
  moved [V].
- **Shards and glow**: `out: "shards"` (or `shatter`) breaks the real letters into flying pieces; `glow: true | "auto" | { color,
  strength, light }` makes a self-lit word (a scene light in world space).
- **Continuous sounds**: `L.sustain({ text | kind, at, space, mood, level, until, seed, dir, orbit, path, words, treatments, mode, gap,
  max, style, lang, delay, ... })` -> `{ stop({ quick }), level(v), alive, phrases, history, finished, handles, mode }` [V members].
  Overlapping phrases, each a different treatment of the sound; `level` 0..1 (or a function of ms) live with `s.level(v)`.
  `mode: "ambient"`: one small hollow word now and then while its spot is in view, at most `L.ambientMax` (`{ world: 3, screen: 2 }`)
  up at once [V].
- Gallery parts `move orbit path choreo rate escalate shards glow sustain ambient` [C].

**Merge watch (checked for this manual).** The MOVE branch predates two things on `tactics-zones`; the merge must keep both:
- GM-only networking: on the MOVE branch a player's `L.net.play` still sends and returns a live handle [V]. After the merge it must
  be refused as in section 8.
- The vocabulary: the MOVE branch has 52 kinds and older words (its `L.sustain({ kind: "hiss" })` letters `HISSSSS`, a word that
  names the sound) [V]; `tactics-zones` has 87 kinds and the dictionary rule. Take `words.mjs` from `tactics-zones`.
- Found by a dry-run merge read (`git merge-tree`, not built) [R]: conflicts in `design.mjs`, `engine.mjs`, `paint.mjs`, `shape.mjs`,
  `check.mjs` (+ `MANIFEST.json`, `stamp.mjs`: regenerate); both sides declare `const R2` in `makePlan` (the merged file would not
  load); MOVE brings back ember specks on held fire words (the clean-letters ruling removes them); LOOK's prefix sizing and MOVE's
  `parts` scales must not shrink a prefix twice; LOOK's backdrop scale runs after MOVE's retiming.

## 13. Look
Status: pending merge (LOOK2, 1.8.0, `tactics-zones-look2`); SPEC-LOOK P16 (smooth motion) belongs to MOTION2. [V] where marked,
else [R].

**Styles.** `L.lookStyles` = `["comic", "invincible", "expressive"]` [V]. `invincible` is the default when
`game.system.id === "invincible"`, else `comic` [C]. Per call: `look: { style }` or `style: "invincible" | "comic" | "expressive"`;
for later calls `L.lookStyle(name)` [V]. `look` keys still win over the style.
- `expressive` is the look from before the Invincible pass, frozen. For the same text and options it gives the same plan and the
  same drawing as `comic`. Proof: 336 fixed-seed fingerprints (plan JSON + every draw call) identical before and after LOOK2, and
  `check-look2.mjs` P17 compares the two styles on every run [V]. `comic` stays the general default and is unchanged.
- `invincible` (LOOK2, SPEC-LOOK P1-P18; [V] by `check-look2.mjs` unless marked):
  - **Face**: Anton for every word (tall, heavy, narrow; Polish letters present); `look.font` still wins (P1, P14).
  - **One outline round the word** (owner): the word's union gets one ink keyline (`hand.keyline: "union"`); each letter is clipped
    to itself and gets only a thin inner ink line where it meets a neighbour, so no outline lies on a neighbouring letter (P2). Even
    weight, round joins, no boil (P3).
  - **Block**: a flat duplicate down-right in one dark colour (`hand.block: "dup"`, offset 0.06-0.10 of the cap), or for heavy
    sounds a straight-down solid block (`"heavy"`); the counters of linked rings are cut out of it; no soft shadow (P4).
  - **Fills**: flat, one colour per word, no gradients, no misregistration (P5). Light or airy sounds get hollow letters (white face,
    coloured rim; `hand.fill: "hollow"`); a loud solid body may get a hollow prefix (P6).
  - **Prefix**: the hyphen lead-in before the body (KA-, RAKA-, KER-, KRA-KA-; each part at most five letters, the whole lead at
    most eight characters; `invPrefix`) is small (0.32-0.38 of the body), on the top line and tucked into the first body letter. A
    word whose parts repeat (BIP-BIP-BIP, BA-DUM-BA-DUM, THWUP-WOKKA-THWUP) is a rhythm and gets no prefix (P7).
  - **Accent**: upright letters (word tilt at most 0.05 rad), one baseline, one size peak per word, neighbour ratio at least 0.85,
    no letter under `INV_FLOOR` (0.82) of the word's biggest (a long tail would read as lower case), "!" as tall as the letter
    before it (P8).
  - **First letter and case look-alikes** (LOOK3 1.9.3, `check-look3.mjs`): the letters before the peak are as tall as the peak
    (`RISE.flat` = 1: the attack is as loud as the peak; before, "cRUSH!", "wHAM!", "sKREE-" read as mixed case); a rising sound
    (`swell`) still grows by steps of at most `RISE.swell` (0.93) with its first letter as tall as the second; after the peak the
    word falls by `RISE.fall` (0.93) a letter (a fading sound, `shrink`, keeps 0.85); a C, O, S, U, V, W, X or Z never steps
    under its bigger neighbour (CRUNcH). Measured over the vocabulary and the dice splash's words: first/second ratio 1.00 in every
    word (1.9.1: down to 0.85), no case look-alike a step under its neighbour (1.9.1: 612 of 1919).
  - **No hole before the last letter** (LOOK3): two causes, both fixed. (1) A source above or below (`from` 90 / -90, which the dice
    splash sends) turned the invincible baseline into a fan or a sag; its leaning letters failed the reader, which straightened them
    and pushed the pair apart ("CRUS H!", "SMAS H!", 0.09-0.18 cap). The invincible hand now keeps its straight baseline for those
    directions (a source to the side still swells or shrinks the word). (2) In the union-keyline hand a pair the reader cannot read
    (a W's arm touching an H's stem reads N) parts in steps of at most 0.008 cap and never more than 0.04 cap in all
    (`UNION_PART`; 1.9.1: steps of 0.03, up to 0.2 cap). Measured: the space the reader pass opens in the last pair over the word's
    median is at most 0.03 cap (1.9.1: up to 0.18); in a caller's own curve (`hand: { env: "fan" }`) no pair parts more than
    0.04 cap (1.9.1: 0.18).
  - **Vertical**: `arrange: "vertical"` stacks one letter per row, rows tucked by `TUCK` (0.14 of a row), the hyphen dropped, marks
    beside the last letter (P9).
  - **Joined OO**: a run of O / 0 becomes linked ovals made from the face's own O (`ovalRing`), all the same size, overlapping by one
    stroke plus a gap, drawn over-under so each ring passes over and under its neighbour; the block keeps the counters open (P10).
    LOOK3 (1.9.3, the owner's rulings of 2026-11-14): linked O's stand off the line by `LINK.rise` (0.07) of their size each, the
    first up, the second down, a third up again (0.14 cap between neighbours; the pair's middle stays on the word's line, the block
    and keyline follow the letters); the over/under switch lies half way between the two rings' middles. Two O always interlock;
    a run of three only on `LINK.three` (20 %, the owner's «20 procent», 1.9.4) of the seeds (the hand's own generator, the same on every client); four or more
    never (plain O's in the word's pair spacing). A number's zeros stay level. In stepped motion linked rings shake as one piece;
    in the vertical column the rings stay on the column's axis (no stagger).
  - **Colour**: 11 flat palettes chosen from the sound (`hand.invPal`: yellow, orange, red, white, steel, cyan, blue, air, green,
    violet, stone; `invPalette(mood, character, traits)`); no palette serves more than a quarter of the kinds (P11).
  - **Spacing by letter pair**: `kernOptical` measures each pair's gap row by row over their common height and sets the mean gap to
    `hand.kern.gap` (0.04-0.06 of the cap); no row comes closer than `KERN.touch`; doubles (AA, RR) a little tighter; AV / TA / LT
    end up tighter than HN; vertical layouts are skipped (P18).
  - **Smear**: outline echoes only, no pale filled copies (P15).
  - **Words** (P12, P13): "!!" on under a quarter of the vocabulary's words and never below loud 0.85; no diacritics; both checked.

**The look says the sound.** `plan.traits` (`hard soft heavy light metallic electric hot warm cold earthy wet gritty sputter bubbly
sustained short rising arc fading`) [V] is read from the word's `character` and sound; it picks face, edge, fill, block depth and
direction, colour, line and spacing (`traitsOf` in design.mjs; table in the engine README "Look"). In the comic style it only
corrects a hand that contradicts the sound.

**Per-call look keys** (`look: { ... }`, all optional, unknown values ignored): `style font tilt env warp2 overlap order outline fill
tex counters capFont shadow prefix link arrange backdrop treat`. [R]

- **Lines**: `\n` stacks lines; `arrange: "line" | "stack" | "stair" | "vertical" | "auto"`; `plan.layout.lines`,
  `plan.layout.arrange` [V].
- **Backdrops**: off by default (owner); `backdrop: "star" | "cloud" | "oval" | "plate" | true | "auto"` turns one on
  (`plan.hand.back`) [V].
- **Accent**: letter sizes follow the sound (small lead-in, biggest at the peak, shrinking tail); `opts.accent` from the vocabulary
  wins; plain text gets a guess; `plan.accent` [V].
- **Interlocked rings**: a run of O / 0 is drawn as linked rings (`look.link`): circles in `comic` / `expressive`, the face's own oval
  in `invincible`.
- **Numbers**: `-1`, `+4`, `x2`, `12%` get a calm, even hand.
- **Legibility**: every treated letter is read against the font's plain letters (Polish marks and digits included) and turned,
  pushed or opened until it reads (`legibility.mjs`, checks in `check-look.mjs`; LOOK2's in `check-look2.mjs`).
- **Clean letters** (owner): no flame teeth, drips or ember specks by default; `look.treat: "flame" | "drip" | "jag" | "rough"` and
  `look.font: "wetpaint"` are explicit opt-ins.
- **Fonts**: eleven SIL OFL 1.1 faces (Bangers, Anton, Patrick Hand, Titan One, Bungee, Black Ops One, Sigmar, Knewave, Rubik Wet
  Paint, Squada One, Michroma); Polish capitals synthesised where a font lacks them. `L.registerFont` adds one (section 15). LOOK2
  added no font: Anton was chosen from the bundled faces (nothing downloaded); the runners-up are in the owner's question list.
- **Palettes**: `L.palettes()` [V]; `palette: "<name>"` per call (same on every client); `colors` overrides.

Not done in LOOK2: joining other doubles (EE, UU) like OO; smooth interpolated motion in the invincible style (P16, MOTION2).
LOOK3 open questions (owner): how a run of three or more that does not interlock is set (today: plain O's), and whether a source above or below should still curve an invincible word (combat-questions LOOK3-2..7; LOOK3-1 ruled: 20 %).

## 14. The owner's binding rulings
Status: stable list, append-only. Every new ruling is added here with its date in the same turn it is given (and to the agent skill's
"Owner's rulings"). The owner's words were Polish; they are given in English. A ruling beats a review's recommendation: where a review
(SPEC-*) says otherwise, the ruling wins and the conflict is noted.

**For callers** (anyone who letters game events) and **for engine changers** alike:

| date | ruling | callers must | engine changers must |
|---|---|---|---|
| 2026-11-13 | Only onomatopoeia: a word imitates the sound, never names it (no "growl", "creak", "roar") | take words from the vocabulary; no action names (HAYMAKER!, TRY AGAIN) | keep `naming()` / `DICT` checks over every bank word, prefix, syllable and flow segment |
| 2026-11-13 | No dictionary words, not even imitative interjections from the dictionary (CIACH, TRZASK, PLUSK; CRASH, SPLASH, CRACK), and no near-words (a dictionary word with one letter changed, dropped, stuck on, or respelled: PLOSK, BLOSK, SPLAASK, WHOOSHK) | not hand-write sound words | build words from attack + lasting part + cut-off; extend the check to near-words (WORD2) |
| 2026-11-13 | The ICONIC exception list (pl BUM BAM PAF; en POW THUD BAM BOOM BANG ZAP WHAM SHH) awaits the owner; nothing else is exempt | - | add an exception only with the owner's ruling and its reason |
| 2026-11-13 | A prefix is the sound's own lead-in (KA-BUM, KRA-KA-BROOM), never another sound's signature (no gun rattle before a bomb) | - | every lead-in comes from `PREFIXES` |
| 2026-11-13 | The comic's manner: an invented attack cluster, the lasting letters doubled or tripled (consonants too), one or two "!", short sounds short; loudness and duration separate; "!" 0..2 | pass `loud` and `long`/`duration` separately | keep the stretch rule (only the sustain repeats) |
| 2026-11-13 | Letter play fits the event: an expressive onset and the lasting letter stretched (BTHOOM for a cave-in, KRRRRAK for a crack) | say what the event is (kind, material, phase) | let the kind and event choose the onset and which letter lasts |
| 2026-11-13 | English is first-class and may become the default language; the laser pistol's "piu piu" is weak | do not assume Polish; pick one language per world (see section 5) | English is the master spelling (WORD2) |
| 2026-11-13 | No Polish diacritic letters in sound words, above all doubled or word-initial | - | no Ą Ć Ę Ł Ń Ó Ś Ź Ż in banks or stretch classes; a check fails on them (WORD2) |
| 2026-11-13 | Several variants per tier; words may repeat or be shared between kinds when that makes sense; no forced uniqueness | do not demand a different word for every event | do not add uniqueness rules for their own sake (overrides SPEC-WORDS rule 11 "do not share words") |
| 2026-11-13 | Water words: pl PLUP, PLUMP, SPLOOSZ, GLUB (long PLUUUP, SPLOOOSZ, GLU-GLU-GLUP); en PLOP, PLOOP, PLUNK, SPLOOSH, GLUB; PLUSK, CHLAP, TRZASK out; CHLUP not an exception | - | use these pools |
| 2026-11-13 | Clean letters: no flame teeth, drips or ember specks by default | - | keep `look.treat` / `wetpaint` opt-in only |
| 2026-11-13 | Backdrops are opt-in; default none | pass `backdrop` only when wanted | keep the default off |
| 2026-11-13 | The light/white outline never covers neighbouring letters inside a word; only around the whole word | - | one keyline round the word's union, letters clipped: done in `invincible` (LOOK2 1.8.0); `expressive` / `comic` keep per-letter outlines by the freeze (OUTL) |
| 2026-11-13 | Keep the look from before the Invincible pass (today's `comic`) as the legacy style `expressive` | may pick `style: "expressive"` (1.8.0) | keep it identical to `comic` for the same options (`check-look2.mjs` P17) |
| 2026-11-13 | Interlocked OO must meet properly and look artistically joined | - | done in `invincible` (LOOK2 P10: linked ovals from the face's own O) |
| 2026-11-14 | The OO joins: the two letters are shifted apart vertically a little, the first one up, the second one down; a third O goes up again | - | done in `invincible` (LOOK3 1.9.3: `LINK.rise` 0.07 of the size each; `check-look3.mjs`) |
| 2026-11-14 | Three O should interlock only rarely; four and more never | write the word as it sounds: the engine decides the join | done (LOOK3: three on 20 % of the seeds, four+ plain) |
| 2026-11-14 | How rare a linked three is: «20 procent» | - | done (LOOK3 1.9.4: `LINK.three` 0.2; `check-look3.mjs` measures 1000 seeds) |
| 2026-11-13 | Letter spacing in `invincible` is too loose and must depend on the letter pair | - | optical kerning by pair: done (LOOK2 P18, `kernOptical`) |
| 2026-11-13 | Animation must fit the sound: a motion table from the sound, not random picks | - | MOTION2 (SPEC-MOTION) |
| 2026-11-13 | Recordings must be smooth and frame the subject (find out recorder vs engine) | record at 24/60 fps, words big enough, framed | one shared drawing grid; A/B film stepped vs smooth for the owner |
| 2026-11-13 | Provisional (orchestrator, the owner may overrule): the invincible style moves smoothly (interpolated), stepped motion stays in `expressive` | - | LOOK2 P16 |
| 2026-11-13 | Implement every point of SPEC-LOOK and SPEC-MOTION, plus the vocabulary review | - | section 19 |
| 2026-11-14 | After the A/B film: keep both motion types of the invincible style, to choose from; the GM sets it for the table (one choice for every seat, no player override); default smooth | leave `look.motion` out unless the event needs one type (the table's choice then applies on every seat) | setting `movement` (world scope), section 15; MODE 1.9.2 |
| 2026-11-13 | Destruction lettering covers presets, combinations, painting (brush), directional and all-at-once destruction | letter every path; test each | - |
| 2026-11-13 | Effects have phases; lettering follows them: blast -> debris falling -> fire of varying intensity; shock waves are lettered; the ground or material changes the sound | one word per phase, timed to the phase, kind/material chosen from what is hit | kinds by material, shock wave, debris (WORD2 / SPEC-KINDS) |
| 2026-11-13 | Shots have two sources: the muzzle at the shooting token AND the impact where the bullets land | letter both ends | - |
| 2026-11-13 | Analyse each effect separately and sensibly; no one recipe for all | design per effect | - |
| TOOL-8 | Networking is GM only | players letter locally only | keep the refusal on send and receive |
| 2026-11-13 | Audio: default silent; later only an opt-in way to attach a sound to a word's clock | - | build no sound content |
| 2026-11-13 | Impact frames are the exception to the restraint: they may go all out and must be spectacular; a system other effects use (`L.impact`) | one `L.impact.play` per event, at its instant | keep it one call for every caller; section 21a |
| 2026-11-14 | Impact frames must BUILD with the event: a scratch, a solid hit, a heavy hit, a knock-down and a critical each look different and escalate; they never bury the action longer than the instant; photosensitivity safety is not negotiable and no caller option may switch the guard off | say what the blow is (`I.pick` or kind + magnitude); never add your own flash | six strengths per kind, the ladder pinned in `check-impact.mjs`; every scene change counted by the guard (FXI-ENGINE 1.8.2) |

## 15. Tools: settings, authoring, designer, accessibility
Status: stable (TOOL, contract v6). [V] where marked, else [C].

Registered once at `init` by the newest copy, whichever module(s) are active.

**Client settings** (namespace `moinen-letters`; the button "Lettering settings" in the host module's settings tab opens the engine's
window; `L.prefs` / `L.settings()` read them [V]):

| key | values | effect on every word |
|---|---|---|
| `enabled` | on / off | off: `play` returns a handle already over; streams draw nothing |
| `scale` | 0.5-2.5 | size multiplier after the legibility clamp |
| `motion` | auto / full / gentle / reduced | the strongest reduction of caller, setting and OS wins; gentle = moves damped to 45 %, no smears |
| `flashes` | on / off | the one-tick impact frame |
| `photosafe` | on (default) / off | at most 2 flash frames per second, none on a word taller than 20 % of the viewport, colour plates held still; impact frames: every drawing that changes the scene counted, shared log, red at most 1 % of a drawing |
| `impact` | full (default) / local / off | impact frames (`L.impact`, section 21a): all, only inside a panel round what is struck, or none; row "Impact frames" in the window since 1.8.2 [V node] |
| `palette` | mood / contrast / cvd | contrast: white-yellow letters, black ink; cvd: colours remapped to the Okabe-Ito set |
| `announce` | on / off | screen readers read each word (or `alt`) through one polite live region |
| `limitScreen`, `limitWorld` | 1-32, 4-96 | `L.limits` |

**Table setting** (1.9.2 MODE; scope WORLD, written by the GM, same on every seat; group "Table (GM)" / "Stół (MG)" in the window):

| key | values | effect |
|---|---|---|
| `movement` | smooth (default) / stepped | the invincible style's motion type ("Motion type" / "Rodzaj ruchu": "Smooth" / "Płynny", "Stepped" / "Skokowy"); the next word on every seat follows it without a reload (onChange -> `applyPrefs` -> `L.motionMode`), words already playing keep theirs; a player's window shows the GM's choice as text with "Set by the GM for the table", and a player's Save / Defaults never write it [V node] |

World setting `styles` (GM): saved named styles; hook `moinenLettersStyles` when they change.

**Authoring** (this session; shared by every caller):
```js
L.registerMood("frost", { extends: "crack", label: "ice", sound: { pitch: 0.3 } });            // [V]
L.registerPalette("venom", [["#e8ffb0", "#9be22a", "#2f6e1f"]]);                                 // [V]
await L.registerFont("grit", { url: "modules/x/fonts/Grit.ttf", sharp: 0.8 });                   // [C]
L.registerStyle("thor-hammer", { mood: "zap", palette: "volt", in: "pop", magnitude: 0.9 });     // [V]
L.play("KRAKA-THOOM!", { style: "thor-hammer", space: "world", at: token });                     // call options win [V]
await L.saveStyle("Thor's hammer", style);   // GM only: world-wide; a player gets an error [V]
```
Ids: `a-z 0-9 _ -`, starting with a letter; prototype names (`toString`, `__proto__` ...) and `auto` are refused [V]. Also
`L.unregisterStyle`, `L.styles()`, `L.style(name)`, `L.deleteStyle(name)`, `L.palettes()`, `L.motionNames()`.

**GM tools**: `L.letterNow(text, opts)` (selected tokens, else `point`, else the cursor; shown to everyone); keybinding "Letter this
now" (Shift+L) opens a small box at the cursor; `L.designer({ text })` (also a button in the token controls) previews words, kinds
from the vocabulary, styles; `L.openSettings()`; `L.planFor(text, opts)` -> `{ plan, opts }` = what this client would show [V].

## 16. Testing and rendering offline
Status: stable.

**Node checks** (no browser, no Foundry):
```
node scripts/letters/check.mjs            # every suite; prints "letters: N checks, F failed" (about 15 000 checks, about a minute) [V]
node scripts/letters/sync.mjs --check     # this copy matches MANIFEST.json and stamp.mjs [V]
node scripts/letters/sync.mjs --check <other module>/scripts/letters    # and both copies are equal
```
Suites: `check.mjs` (core), `check-life.mjs` (lifecycle on a simulated clock), `check-words.mjs` (vocabulary rules incl. the
dictionary rule and reviewed syllables), `check-tools.mjs`, `check-look.mjs` (L1-L16, legibility), (1.5.0) `check-move.mjs`.
moinen-maps runs them as `dev/letters.test.mjs`, invincible-plus-ultra as `scripts/sweep-checks/letters.mjs` [C]. Never weaken a check
to make it pass; add one for every behaviour you add.

**Scripting the engine in node.** `testenv.mjs` builds a fake document, PIXI and Foundry canvas on a simulated clock around the real
engine:
```js
import { setup, settled } from "./scripts/letters/testenv.mjs";
const E = await setup({ gm: false });         // E.engine = a fresh engine, fonts loaded
const h = E.engine.play("KRAK!", { space: "world", at: { x: 2100, y: 1400 } });
await E.tick(200);                             // advance the clock: timers and animation frames run
E.addToken("t1", 1000, 1000); E.delToken("t1"); E.warns;   // tokens, collected warnings
```
`L.design(...)` and `L.sizeOf(...)` work there too; pictures are painted into a stub canvas (no pixels). [V]

**Looking at the result (real pixels).** Rendering needs a browser canvas, not Foundry: serve the `scripts/letters/` folder over
HTTP, open a page that does `const { createEngine } = await import("<served>/engine.mjs"); const L = createEngine(<served base>);
await L.ready();` and then
- a still: `await L.still(text, { size, ...opts })` (the hold drawing) appended to the page;
- a strip of every drawing: `const p = L._plan(text, opts); L._settle(p); for (const pic of [...p.timeline.ent, ...p.timeline.hold,
  ...p.timeline.exit]) page.append(L._paint(p, pic, size * p.sizeK).canvas);` (`pic.ticks` = how long each is shown);
- a film: replace `performance.now`, `setTimeout` and `requestAnimationFrame` with a clock you step 1000/24 ms per frame, screenshot
  each frame from a headless browser, encode at 24 fps. This shows the engine's ideal timing; a real-time 30 fps screen recording
  adds its own judder (a drawing on twos becomes 2 or 3 captured frames).
Judge motion on a film, not on stills; record at 24 or 60 fps with words at least 150 px tall.

**Live check in Foundry.** In a test world with either module active, from the console: `const L = await MoinenLetters.engine();
L.gallery({ space: "both" })`, then the calls you changed, as the GM and as a real player login (visibility, GM-only networking and
layers differ per user). Use a test world, never a world with real data.

## 17. Changing the engine: the two copies, VERSION, sync, merges
Status: stable.

1. Edit ONLY the canonical copy: `moinen-maps/scripts/letters/`. Never edit the vendored copy in invincible-plus-ultra by hand.
2. Bump `VERSION` in `engine.mjs` for every engine change (copies with the same VERSION but different content fall back to the more
   recently synced one, with a warning; do not rely on it).
3. Update the engine README (option tables), the API contract's change list, this manual (section map at the top), and add node
   checks.
4. `node scripts/letters/check.mjs` -> 0 failed.
5. `node scripts/letters/sync.mjs` rewrites `stamp.mjs` (only when the content changed) and `MANIFEST.json`.
6. `node scripts/letters/sync.mjs <invincible-plus-ultra>/scripts/letters` copies every file there (it refuses any target that is not
   a LETR copy or a new `<module>/scripts/letters` folder, never deletes a folder, removes files that no longer exist) [C]; then
   `sync.mjs --check <that folder>`.
7. Run each module's full test runner; commit both repos.

**Merging two engine branches.** Resolve the code files by hand (keep both sides' features, take the higher VERSION or a new one);
never hand-merge `MANIFEST.json` or `stamp.mjs`: take either side, then run `node scripts/letters/sync.mjs` to regenerate them, then
sync to the vendored copy. `sync.mjs --check` fails until you do.

**Seams between stages** (who owns what): the vocabulary (`words.mjs`) owns WHAT is lettered and WHEN (text, loudness, duration,
accent, character, flow segments); the look (`design.mjs` hand/layout, `paint.mjs`) owns how letters are drawn; motion (`move.mjs`,
`choreo.mjs`, `sustain.mjs`, the timeline) owns how they move; tools (`tools.mjs`, `prefs.mjs`) filter every plan. A stage changes
another stage's files only through the documented seam (e.g. `opts.accent`, `opts.character`).
Impact frames live in `scripts/letters/impact/` and touch the engine in three lines of `index.mjs` marked `IMPACT hook 1/3..3/3`, one
section (8f) of `check.mjs`, the VERSION line and (1.8.2) one settings row: `SETTINGS.impact` in `prefs.mjs`, its words in
`strings.mjs`, its place in the Access group of `ui.mjs`. A merge keeps those lines and takes the folder whole.

Adding a sound kind: `KINDS` entry in `words.mjs` (group, labels pl/en closest translation, mood, sound, motion, hold classes, env,
`CHAR`, flow style where it lasts, banks per language and tier, stream syllables), every new syllable reviewed into
`words-reviewed.mjs`, no `DICT` hit, prefixes only from `PREFIXES`; `check-words.mjs` holds the rules. From another module at runtime:
`L.vocab.define` + `L.vocab.add` with a namespaced id.

## 18. Known limits
Status: stable list; edit as items close.

- Size drift repaints: a world word's size follows zoom and the number of world words alive (`alive` in the size model); a drift
  over 15 % repaints its pictures. On lane 5 this was most of a 1.9.0 word's 5-9 paintings. [V live]
- Performance: a burst of 48 words still gives some 50-170 ms frames from cost outside the engine's paint budget (likely GPU upload of
  new pictures; unverified). Queued (PERF).
- No sound (deferred by the owner).
- On 1.6.0 no keep-in-view (MOVE adds it); the engine knows nothing of a caller's UI panels.
- Visibility needs the canvas; `vision: "point"` uses this client's sight only.
- `from` as a point differs per client layout; use an angle.
- `startAt` is per page; clock skew between machines remains even with `L.net`.
- The vocabulary is shared by every caller: `L.vocab.add` / `define` from one module changes words for all.
- `L.still` paints at `size` x the device pixel ratio, capped; pictures over 2048 px a side are capped.
- BUG (verified under node, 2026-11-13, engine 1.6.0): a word on a HIDDEN token is not drawn for a player, but its text is still
  read to screen readers (setting `announce`, default on): the announcement fires when the first picture counts as shown, before the
  visibility check. A hidden token's damage number can leak this way. Until fixed: callers skip lettering for tokens this user cannot
  see (`token.visible` / `document.hidden` on a player's client) before calling `play`, or pass `alt: " "` (an empty announcement is
  skipped) [C].
- 1.6.0 word banks still contain near-words and Polish diacritics in some kinds (e.g. en `creak` SKWEEK, `crumble` SKRRUNCH; pl
  `thud`, `ricochet` with Ł / Ń) [R: skill test reading]; WORD2 removes them. `check-words.mjs` still requires Polish letters in the
  set, against the no-diacritics ruling; WORD2 inverts that check.
- `L.net` sends only its known option keys: MOVE's `path`, `orbit`, `orient` and choreography options, and `L.sustain`, do not travel
  over the network [R: from a merge-plan read of `net.mjs` `OP_KEYS`, not run].
- Frame time (EFFECTS1, lane 5, 60 Hz headless, 2026-11-14): a meteor plus a bomb with their fires gave one or two ~50 ms frames
  with lettering on at the meteor's main word, none with lettering off (mean 16.8 vs 16.7 ms). A big word's first draw on the
  impact frame is the likely cost; no `L.prepare` for words yet (REQUESTS EFFECTS1-8).
- No falling-pitch kind (a whistle), no size growth along a path ride, no Polish cave-in (BDUUM), no thunder restrike grammar
  (REQUESTS EFFECTS1-1..5).
- Impact frames: no networking of their own (the caller's event carries the call); the hit-stop holds the whole canvas ticker (every
  animation on the canvas, also other modules'); only the photosensitivity measures named in section 21a are enforced (a star or ring
  of at most a sixth / a quarter of the picture appearing for a tick is not counted as a flash).
- Frame time (FIN-ENGINE, lane 5, film clock off, 2026-11-14): five invincible words planned in one call (each with its own
  `startAt`, 1.7 s apart) gave one 62 ms frame about 0.35 s before the first word and 33-35 ms frames at the two loudest words; the
  impacts of the same ladder alone stay under 18.5 ms. Word side, not fixed (FINE-6).
- Stepped table, reduced seat (1.9.2): the reduced fade ends on the unrounded contact, the stepped seats strike on the next shared
  grid instant: up to 41.7 ms apart (MODE-4). Two stepped seats agree only as well as `game.time.serverTime` agrees between machines;
  near a grid instant a clock error of a few ms can move one seat's contact by a whole tick (41.7 ms).
- `plan.contactMs` of the legacy styles under reduced motion is the legacy reduced entrance's own (frozen look): a reduced legacy
  seat's contact is not aligned with a full one (FINE-3).
- Not exercised by this manual's node runs: layer draw order, elevation, fog/vision on a real canvas, the designer window, the
  Shift+L box, socket transport between real clients, `L.registerFont` with a real file.

## 19. What is about to change
Status: planned (the owner ordered all of it on 2026-11-13). Sections that will be invalid when each lands:

| work | what | sections it invalidates |
|---|---|---|
| LM merge (1.7.0) | MOVE 1.5.0 into `tactics-zones`; GM-only and 87 kinds kept | 1 (files), 4 (options), 11, 12 (status -> stable/changing), 10 (stream options), 20, stage table |
| LOOK2 rest / OUTL | LOOK2 1.8.0 did P1-P15, P17, P18 (section 13). Left: joining other doubles (EE, UU) like OO; OUTL (one keyline round the word in `comic`); P16 smooth motion in the invincible style goes to MOTION2 | 13 |
| MOTION2 (done in 1.9.0, pending merge: 11a) | one shared drawing grid on twos; a deterministic motion table per sound family (no dice); hold envelopes (decay, rise, arc, pulse, steady); contradictions removed; exits by cut-off (cut, ring-out, trail-off, smoke-off, blow-away, power-down, sputter, crumble); a rhythm primitive (siren, heartbeat, rotor, beeps, mech steps); letter roles (only the sustained run moves); default travel per kind, scatter and walk emitters; streams and sustain take motion from the kind; boom burst-in entrance | 11 (all), 12, 10, 4 (`in`/`holdKind`/`out` names), 5 (timing advice may simplify) |
| WORD2 (SPEC-WORDS) | dictionary leaks and near-words removed (PTAAK, PLOSK, DOIING, BRUUNCH ...); near-word check (one letter off, stuck-on letter, K respelling); no Polish diacritics (a check that fails on them); English as the master spelling, Polish derived; PH stretch bug; W not a lasting letter in English; percussive kinds lengthen by hits or echo, not vowels; "!" capped per kind; every lead-in from `PREFIXES`; sayable words; longer runs for steady sounds; roar stretches the vowel; siren as one morphing word; laser pistol attack-led (ZARK, TZAK); ICONIC ruling (candidates BLAM, BEEP, VROOM, HA, GRR, SZSZ). Owner's ruling overrides the review's "never share words" | 9, 14 |
| SPEC-KINDS (being written) | missing kinds and dimensions: material of what is hit, phase (what follows what), source and impact of shots, distance, space/echo, approach-pass-recede, medium, wet/dry, size of source, cause-then-result combinations, tempo, silence, number of sources; kinds to split or merge | 9, 5 |
| SPEC-EFFECTS (being written) | each map effect analysed separately: which words, which phases, which motion | 5 |
| later queue | SCENE (occlusion, ground perspective), CROWD (placement solver, aggregation), TOKN (word + number as one lettering, stacking hits), HERO (panel freeze, full-frame flash), EXPO (frame strip / webm export, pause/seek), GOLD (golden-render checks), PERF, wiring into map weather/tornado and moinen-pixel-vfx | 5, 16, 18 |

## 20. API index
`since` = the contract version that added it (engine VERSION in brackets); status as in the stage table.

| member | since | notes |
|---|---|---|
| `play`, `burst`, `still`, `design`, `stopAll`, `count`, `limits`, `stats`, `moods`, `version`, `ready`, `base`, `gallery` | v1 | |
| `stream` | v2 | |
| `layers`, `defaults`, `layerChoices` | v3 | |
| `sizeOf`, `sizeModel` | v4 (1.2.0) | |
| `word`, `sfx`, `number`, `range`, `vocab` | v5 (1.3.0) | `vocab`: `accent add aliases all bangs character choices classes define envs expand flow groups grow kindOf kinds langs list materials naming number range remove renderable reset series stretch syllables textures word` [V] |
| `flow` | v5 corrections (1.3.1) | |
| `prefs`, `settings`, `registerMood`, `registerPalette`, `registerFont`, `registerStyle`, `unregisterStyle`, `styles`, `style`, `saveStyle`, `deleteStyle`, `palettes`, `motionNames`, `net` (`play burst stream stop sharedNow local lead`), `letterNow`, `designer`, `openSettings`, `planFor` | v6 (1.4.x) | added by `tools.mjs` at setup; absent if the tools did not install [V] |
| `push`, `escalation`, `viewInset`, `sustain`, `ambientMax` | v7 (1.5.0) | pending merge [V on its branch] |
| `lookStyle`, `lookStyles` | v8 (1.6.0) | style `expressive` added in v9 (1.8.0) |
| `motionMode`, `motionModes`; play options `kind`, `look.motion`; `w.play.vocabMotion` | 1.9.0 MOTION2 | pending merge, section 11a [V node] |
| `chain`; `vocab.tails`, `vocab.chain`, `vocab.variants`, `vocab.hitMaterials`, `vocab.fireLevels`, `vocab.chains`; word options `material pieces intensity stage` | 1.7.1 KINDS1 | pending merge, section 9a [V node] |
| `impact` (`play prepare plan pick show gallery stopAll mode setMode kinds frames tones limits stats busy`) | 1.7.2 IMPACT | section 21a; `steps` and the opts `gentle` (and the stricter `reduced`) since 1.8.2; `series`, opts `blowAt keep keepPad series`, `plan.peakMs` since 1.9.1 |
| `contactAt(handleOrPlan, startAt?)`, handle getter `h.contactAt`, `plan.contactMs`; play option `flash: false` (also through `L.net`) | 1.9.1 FIN-ENGINE | pending merge; sections 4 and 21a [V node, V live] |
| `gridClock(fn \| null)`; setting `movement` (world); tools `applyPrefs` | 1.9.2 MODE | pending merge; sections 11a and 15 [V node] |
| `_plan`, `_paint`, `_settle`, `_bank`, `_ext` | - | internal, for tests, the gallery and tools; may change without notice |

## 21. Change log of this manual
- 2026-11-13: first version, written against `tactics-zones` @ aec4e4a (engine 1.6.0) and `tactics-zones-move` @ d299f61 (1.5.0,
  pending merge). API statements marked [V] were run under node on both; GM-only networking found missing on the MOVE branch.
- 2026-11-13 (later): owner's rulings folded in as a dated table for callers and engine changers (section 14: English first-class,
  no diacritics, no near-words, shared words allowed, letter play, expressive, outline, OO, motion table, smooth recordings,
  destruction phases, material, two-ended shots, per-effect analysis); one language per world (section 5); destruction and effect
  lettering advice (section 5); screen-reader leak of hidden tokens' words found and verified under node (section 18); L.net does not
  carry MOVE options (section 18); WORD2 / SPEC-KINDS / SPEC-EFFECTS scope (section 19); LM merge branch noted (stage table); the
  rule to update this manual in the same turn as any lesson or ruling.
- 2026-11-13 (later): changing one trait of a vocabulary word (section 5); `alt: " "` workaround for the announce leak and the
  remaining near-words / diacritics in the 1.6.0 banks (section 18).
- 2026-11-14: KINDS1 (engine 1.7.1, branch `tactics-zones-kinds1`): section 9a (material, pieces, fire intensity and stage,
  tails, chains, `L.chain`), kind count 94 in 13 groups, API index row.
- 2026-11-14: LOOK2 (1.8.0, `tactics-zones-look2`): section 13 rewritten for the rebuilt `invincible` style and the frozen
  `expressive`; rulings on outline, expressive, OO and pair spacing marked done (section 14); stage table, section 19, API index.
- 2026-11-14: EFFECTS1 (map effects as a page per event, `tactics-zones-effects1`): section 5 "An event told as a page" (owned
  parts, unrepeated words, candidate spots, path words stopped before the flash, wave direction per screen, no sustain echo,
  unlocated sounds, muzzle clearance); section 18 frame time and the missing kinds.
- 2026-11-14 (FXLM2): section 5 - phases vs a caller's echo filter, `keepInView: false` for off-screen sustains, the 1.7.0 gun /
  grenade / rocket kinds (no `gunshot`).
- 2026-11-14 (MOTION2, 1.9.0, `tactics-zones-motion2`): section 11 limited to the frozen legacy styles; new 11a (invincible motion
  from the sound table, one painting moved per frame, smooth / stepped switch, rules the checks hold, streams and sustain, what is
  not done); size-drift repaints (18); stage table, 19, API index.
- 2026-11-14 (FIN-ENGINE, 1.9.1, `tactics-zones-fin-engine`): FXI-ENGINE merged onto MOTION2; section 4 (contact instant, `flash:
  false`), 21a (word + blow recipe, `blowAt`, `keep`, `series`, sizes, series scheduled ahead, cost, film-verified guard), stage
  table, API index, lessons (18).
- 2026-11-14 (MODE, 1.9.2, `tactics-zones-mode`): the motion type as the GM's table setting `movement` (15), who wins and the
  same-instant shared grid (11a), the owner's ruling (14), reduced-on-stepped limit (18), API index, stage table.
- 2026-11-14 (LOOK3 1.9.4): a linked three on 20 % of the seeds (owner's ruling), section 13 and 14.
- 2026-11-14 (LOOK3, 1.9.3, `tactics-zones-look3`): section 13 (staggered interlocked O, the 2/3/4+ rule, first letter and case
  look-alikes, the hole before the last letter and its two causes), owner's rulings on the OO joins (14), stage table, API index.
- 2026-11-14 (FXI-ENGINE, 1.8.2): section 21a (impact frames; the IMPACT builder's patch folded in and corrected to 1.8.2), stage
  table rows, owner's rulings on impact frames (14), settings row `impact` (15), seams (17), limits (18), API index (20).

## 21a. Impact frames: `L.impact`
Status: IMPACT 1.7.2 on `tactics-zones` (inside 1.8.1); FXI-ENGINE 1.8.2 and FIN-ENGINE 1.9.1 `pending merge` (`tactics-zones-fin-engine` holds both). The reference is
`scripts/letters/impact/README.md`; this section is the short guide. `[V]` = node (`check-impact.mjs`), `[V live]` = lane 5.

**What it is.** The few drawings of full force at the instant of a hit, 2 to 12 ticks long (83 to 500 ms): the scene slammed to its
black-and-white negative, a panel round the blow in hard black and white, the struck figure inked on a flat silhouette on a black,
white or colour field, burst stars, speed and focus lines, a swept smear, the frame torn in two, halftone, ink splashes, a chromatic
split, shock rings, a hold of the whole scene (hit-stop) and a shove of the frame. The lettering is restrained by ruling (section 14);
the impact frame is the stated exception (owner: spectacular; it must BUILD with the event and never bury the action).

**The call.** `[V]`
```js
const I = (await letters()).impact;
const { kind, magnitude } = I.pick({ type: "damage", share: lost / max, crit, fatal });
I.play({ kind, magnitude, subject: token, from: attackerToken, seed: `${token.id}:${newValue}`, startAt: tHit });
```
- `kind`: `hit heavy crit blast slash landing ko shock word`; `magnitude` 0..2 picks one of SIX strengths (bounds 0.35, 0.6, 0.85,
  1.35, 1.7; the first build's 0.35 / 0.85 / 1.35 are still bounds: under 0.85 no full-field frame except a critical, from 1.35 the
  whole set). A scratch puts a small star on the struck figure's rim and leaves the scene alone; 0.6-0.85 turns a panel round it
  black and white; above that the full-field frames, longer and held longer as the blow grows.
- The ladder (pinned in `check-impact.mjs`): scratch hit 0.36 -> solid hit 0.69 -> heavy 1.24 -> knock-down ko 1.6 -> critical 1.73+;
  every rung different, each with more force than the one before.
- `subject`: a token (its live picture becomes the silhouette; a round portrait is cut out by its rim colour), a point
  (`space: "world"`, `area`), a rectangle, an HTML element, a word's handle; `from` (attacker) or `dir` (degrees) gives the
  direction, none = radial. A `from` token this user cannot see gives no direction on that client (1.8.2).
- `seed` + `startAt` (this page's `performance.now()`): the same drawings change on the same instants on every seat.
- `over: "scene"` (default: over the map, under the interface) or `"ui"` (over every window, one under the `screen` word layer).
- A caller can only lower: `reduced: true`, `gentle: true` (1.8.2), `hitstop: false`, `punch: false`. `reduced: false` does not
  overrule the OS switch (1.8.2).
- `I.prepare(spec).play({ startAt })` paints ahead; `I.plan(spec)` previews; `I.show(type)` holds one frame type; `I.gallery()`.
- The handle: `{ plan, mode, ready, finished, stop() }`; `finished` resolves `done | stopped | replaced | busy | hidden | late | off`.
- (1.9.1) `blowAt`: the instant of the blow itself; the impact starts `plan.peakMs` earlier so its strongest drawing lands there.
  `keep`: a word handle, element or rectangle (or an array) cut out of every drawing and of the scene's change, followed while it
  moves. `series: n`: the n-th blow of a series is drawn 0.15 magnitude stronger per step (at most 4 steps; `I.series`). Star,
  panel and cracks are sized from the subject's size ON SCREEN, floor 3 % of the view. `[V node, V live]`
- (1.9.1) A word and its blow: `const h = L.sfx("punch", { ..., startAt, flash: false }); I.play({ kind, magnitude, subject: token,
  from, seed, blowAt: L.contactAt(h), keep: h })`. `L.contactAt(h)` = the instant the word reaches its contact pose (a slam's squash,
  a drop's landing, a burst's biggest drawing); in stepped motion it is on the drawing grid; a reduced-motion seat's word fades in to
  end on the SAME instant, so every seat gets the same `blowAt` from the same `startAt`. Legacy styles (`comic`, `expressive`): the
  burst picture; their reduced motion is not aligned (frozen). `[V node, V live]`
- (1.9.1) A series planned ahead: call every blow at once with its own time; windows apart all play (before: only the last, strongest
  one did); overlapping windows keep the old rule (stronger replaces, weaker is `busy`).

**Frame types** (18): `pop splat lines ink slam shadow glare swap window smear tear rip dots shatter chroma ring fade rest`. Full-field:
`slam shadow glare swap window` and `tear` (half the frame inverted). `ink` and `shatter` change the scene only inside a jagged panel
of at most 20 % of the view round the blow (1.8.2; before, the whole view).

**Safety (enforced, not optional).** `[V]`
- `photosafe` on (default): a FLASH is a full-field frame or any drawing that changes the scene's brightness, even in a panel. At most
  2 per impact and 2 per rolling second on a client, in the same log as the words' flash frames; the others become quiet twins (a
  twin that would still change the scene keeps its ink only). Under the guard saturated red (R/(R+G+B) >= 0.7) covers at most 1 % of
  any drawing: red accents are drawn deep crimson. (Before 1.8.2 `ink` and `shatter` turned the whole view black and white uncounted on
  every hit, and the knock-out threw red spikes over its black frame: ADVI 9 and 18.)
- `flashes` off, `motion: gentle`, the client setting `moinen-letters.impact = local` or a caller's `gentle: true`: the gentle variant
  (no full frame, no inverted scene, no hit-stop, everything inside a panel of at most 20 % of the viewport; its panels still counted).
- reduced motion (setting, OS switch, a caller's `true`): one still drawing, at most 4 ticks, at the instant of the full plan's blow.
  `enabled` off or `impact = off`: nothing.
- an impact is at most 12 ticks, one drawing 4 ticks, hit-stop 4 ticks; a watchdog timer removes it even when the frame loop died.
- one impact at a time: an impact whose time window overlaps one playing or scheduled is shown only when stronger than all of them.
- Film check (1.9.1): the five-blow ladder on dark, mid-grey and bright scenes gave at most 1.5 whole-picture flashes in any second
  (WCAG limit 3); reduced motion 0.5. `[V live]`
- The user can switch the guard off on their own client (`photosafe`); no caller option can.

**Cost.** IMPACT measured live 2026-11-13 (1600x900, GM seat): no animation frame over 25 ms through any frame type or whole impact;
one drawing paints in 1.6 to 6.9 ms; two seats on the shared clock changed drawings within 6 ms `[V live]`. 1.9.1 (film clock off):
a five-blow ladder of impacts called at once, max frame 18.5 ms (painting ahead is shared out per frame); the same ladder's five
WORDS give one 62 ms frame when planned together (open, section 18). Numbers: the impact README "Cost".

**For callers (lessons).**
- A map preset: `plan.t0` of `presets.fire` is the instant of the hit; convert with `performance.now() + (t0 - sharedNow())`.
- `startAt` is the instant of the BLOW, the same on every seat; do not derive it from this seat's own word entrance (a reduced-motion
  seat's word lands earlier: ADVI 14), or seats disagree by hundreds of ms.
- One impact per event, on the worst hit; never in a loop; no flash or shake of your own on top.
- Pass the token itself (visibility: a token this user cannot see gives no impact; a hidden attacker gives no direction), the shared
  seed and the shared time.
- The guard decides per client what is drawn; the timing is the same everywhere. Do not offer a setting that skips it; for a module's
  own "fewer effects" pass `gentle: true`.
- A world-space word under a slam is inverted with the scene; a word on the `screen` layer stays on top of an `over: "ui"` impact.

**Looking at it.** Offline: `node dev/tools/impact-render.mjs --out <dir>` (moinen-maps; one headless browser, light slot; `--bg
night|map|bright|dark|light`, `--round 1` = a round portrait token, `--spec`). Live: `L.impact.gallery({ subject: token, dir: 20 })`.
Checks: `node scripts/letters/impact/check-impact.mjs` (section 8f of `check.mjs`).
