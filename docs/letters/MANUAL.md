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
| TOOL (settings, authoring, designer, GM-only networking) | 1.4.1 | v6 | `tactics-zones` | stable |
| MOVE (travel, choreography, rates, escalation, shards, push, glow, sustain, ambient) | 1.5.0 | v7 | `tactics-zones-move` | pending merge; then changing (SPEC-MOTION) |
| LOOK (styles, sound -> look, lines, backdrops, accent, legibility, rings) | 1.6.0 | v8 | `tactics-zones` | changing (SPEC-LOOK P1-P17) |
| LM (MOVE + LOOK merged) | 1.7.0 | v7+v8 | `tactics-zones-lm` (in progress, not on origin yet) | pending merge |
| LOOK2 (invincible rebuilt: SPEC-LOOK P1-P15, P17, P18; legacy look frozen as `expressive`) | 1.8.0 | v9 | `tactics-zones-look2` | pending merge |
| MOTION2, WORD2, OUTL | - | - | - | planned (see "What is about to change") |

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

**Handle.** `id`, `hand` (string, set at once unless `delay`), `plan` (set at once unless `delay`) [V], `ready` (Promise: `true` when
the first picture is on screen, `false` when the word ended without showing) [V], `finished` (Promise: `"done"`, `"stopped"` or
`"evicted"`; always settles) [V], `alive`, `stop({ quick })` (quick false: play the exit now; true: remove at once) [V],
`moveTo(at)`. Words from the vocabulary also carry `h.word` [V]; from the network `h.netId`; with the master switch off `h.off` [C].

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
- 87 kinds in 12 groups (hits, breaking, blasts, motion, elements, powers, devices, voices, animals, vehicles, weapons, weather)
  [V]; aliases (`explosion` -> boom, `laser` -> beam, ...) in `L.vocab.aliases`; an unknown kind letters as
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

## 11. Motion (core)
Status: changing (SPEC-MOTION, ordered: MOTION2). [R] unless marked.

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
twos) and words do not share a beat, which reads as judder; the hold amplitude is constant. See section 19.

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
  - **Vertical**: `arrange: "vertical"` stacks one letter per row, rows tucked by `TUCK` (0.14 of a row), the hyphen dropped, marks
    beside the last letter (P9).
  - **Joined OO**: a run of O / 0 becomes linked ovals made from the face's own O (`ovalRing`), all the same size, overlapping by one
    stroke plus a gap, drawn over-under so each ring passes over and under its neighbour; the block keeps the counters open (P10).
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
| 2026-11-13 | Letter spacing in `invincible` is too loose and must depend on the letter pair | - | optical kerning by pair: done (LOOK2 P18, `kernOptical`) |
| 2026-11-13 | Animation must fit the sound: a motion table from the sound, not random picks | - | MOTION2 (SPEC-MOTION) |
| 2026-11-13 | Recordings must be smooth and frame the subject (find out recorder vs engine) | record at 24/60 fps, words big enough, framed | one shared drawing grid; A/B film stepped vs smooth for the owner |
| 2026-11-13 | Provisional (orchestrator, the owner may overrule): the invincible style moves smoothly (interpolated), stepped motion stays in `expressive` | - | LOOK2 P16 |
| 2026-11-13 | Implement every point of SPEC-LOOK and SPEC-MOTION, plus the vocabulary review | - | section 19 |
| 2026-11-13 | Destruction lettering covers presets, combinations, painting (brush), directional and all-at-once destruction | letter every path; test each | - |
| 2026-11-13 | Effects have phases; lettering follows them: blast -> debris falling -> fire of varying intensity; shock waves are lettered; the ground or material changes the sound | one word per phase, timed to the phase, kind/material chosen from what is hit | kinds by material, shock wave, debris (WORD2 / SPEC-KINDS) |
| 2026-11-13 | Shots have two sources: the muzzle at the shooting token AND the impact where the bullets land | letter both ends | - |
| 2026-11-13 | Analyse each effect separately and sensibly; no one recipe for all | design per effect | - |
| TOOL-8 | Networking is GM only | players letter locally only | keep the refusal on send and receive |
| 2026-11-13 | Audio: default silent; later only an opt-in way to attach a sound to a word's clock | - | build no sound content |

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
| `photosafe` | on (default) / off | at most 2 flash frames per second, none on a word taller than 20 % of the viewport, colour plates held still |
| `palette` | mood / contrast / cvd | contrast: white-yellow letters, black ink; cvd: colours remapped to the Okabe-Ito set |
| `announce` | on / off | screen readers read each word (or `alt`) through one polite live region |
| `limitScreen`, `limitWorld` | 1-32, 4-96 | `L.limits` |

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

Adding a sound kind: `KINDS` entry in `words.mjs` (group, labels pl/en closest translation, mood, sound, motion, hold classes, env,
`CHAR`, flow style where it lasts, banks per language and tier, stream syllables), every new syllable reviewed into
`words-reviewed.mjs`, no `DICT` hit, prefixes only from `PREFIXES`; `check-words.mjs` holds the rules. From another module at runtime:
`L.vocab.define` + `L.vocab.add` with a namespaced id.

## 18. Known limits
Status: stable list; edit as items close.

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
- Not exercised by this manual's node runs: layer draw order, elevation, fog/vision on a real canvas, the designer window, the
  Shift+L box, socket transport between real clients, `L.registerFont` with a real file.

## 19. What is about to change
Status: planned (the owner ordered all of it on 2026-11-13). Sections that will be invalid when each lands:

| work | what | sections it invalidates |
|---|---|---|
| LM merge (1.7.0) | MOVE 1.5.0 into `tactics-zones`; GM-only and 87 kinds kept | 1 (files), 4 (options), 11, 12 (status -> stable/changing), 10 (stream options), 20, stage table |
| LOOK2 rest / OUTL | LOOK2 1.8.0 did P1-P15, P17, P18 (section 13). Left: joining other doubles (EE, UU) like OO; OUTL (one keyline round the word in `comic`); P16 smooth motion in the invincible style goes to MOTION2 | 13 |
| MOTION2 | one shared drawing grid on twos; a deterministic motion table per sound family (no dice); hold envelopes (decay, rise, arc, pulse, steady); contradictions removed; exits by cut-off (cut, ring-out, trail-off, smoke-off, blow-away, power-down, sputter, crumble); a rhythm primitive (siren, heartbeat, rotor, beeps, mech steps); letter roles (only the sustained run moves); default travel per kind, scatter and walk emitters; streams and sustain take motion from the kind; boom burst-in entrance | 11 (all), 12, 10, 4 (`in`/`holdKind`/`out` names), 5 (timing advice may simplify) |
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
- 2026-11-14: LOOK2 (1.8.0, `tactics-zones-look2`): section 13 rewritten for the rebuilt `invincible` style and the frozen
  `expressive`; rulings on outline, expressive, OO and pair spacing marked done (section 14); stage table, section 19, API index.
