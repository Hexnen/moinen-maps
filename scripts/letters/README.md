# LETR: comic sound-effect lettering engine

Give it a word and an intent; it letters the word the way comic letterers draw sound effects (every word its own shape, size,
colours, outlines, 3D, texture) and animates it frame by frame (pictures on twos and threes of a 24 fps clock): an entrance, a hold
that keeps living (each picture is redrawn, the line "boils"), an exit. Over the interface (HTML) or on the canvas in world space
(PIXI), any number at once within limits, deterministic for a seed so every client sees the same lettering.

- Canonical copy: `moinen-maps/scripts/letters/`. Vendored copy: `invincible-plus-ultra/scripts/letters/`. Same files; `MANIFEST.json`
  holds their hashes and `stamp.mjs` a content hash with the time it last changed (two copies with the same VERSION but different
  content: the more recently synced one serves; bump VERSION anyway). Edit ONLY the canonical copy, then
  `node scripts/letters/sync.mjs <path to plus-ultra>/scripts/letters` (it only copies into an existing LETR copy or a new folder named
  `scripts/letters`, never deletes a folder); `sync.mjs --check <other copy>` also compares the two copies.
- Checks: `node scripts/letters/check.mjs` (maps runs it as `dev/letters.test.mjs`, plus-ultra as `scripts/sweep-checks/letters.mjs`).
- Why here: moinen-maps is system-agnostic and the heaviest user (world space, zoom, a collapse throwing dozens of words), and
  plus-ultra must not need the map for its dice splash; so both carry the folder, and at runtime the copies register in
  `globalThis.MoinenLetters`, the newest VERSION wins, and both modules use ONE engine (one font cache, one limit on words at once,
  one memory of recent hands). A third module (moinen-pixel-vfx) can use `globalThis.MoinenLetters.engine()` or vendor the folder too.

## Calling it

```js
import { letters } from "<relative path>/letters/index.mjs";       // module code, either module
const L = await letters();                                           // fonts loaded
// macros: await game.modules.get("moinen-maps").api.letters()  |  ...("invincible-plus-ultra").api.letters()  |  await MoinenLetters.engine()

const h = L.play("KRAK!", { mood: "crack", space: "world", at: { x: 2100, y: 1400 }, seed: message.id });
await h.finished;                       // "done" | "stopped" | "evicted"
L.play("-3", { mood: "pain", space: "world", at: token });           // above a token, follows it
L.play("KABOOM!", { mood: "boom", size: 96 });                       // over the interface, screen centre
L.burst([{ text: "KRUSZ!", at: p1 }, { text: "ŁUBUDU!", at: p2 }], { mood: "crash", space: "world" });   // different hands guaranteed
const s = L.stream({ text: "RA-TA-TA-TA", space: "world", pixel: true, at: () => muzzle(), to: target, every: 90, duration: 1800 });
const cnv = await L.still("BAM!", { mood: "impact", size: 48 });     // one picture (chat card etc.)
L.gallery({ space: "both" });                                        // the show-off wall
```

The complete option tables (play, stream, handle, limits) are in the contract kept beside this engine's builders
(scratchpad `letr/API-CONTRACT.md`); the summary:

| play option | meaning |
|---|---|
| `mood` | `impact crack crash boom roar fire whoosh zap tick pain powerup heal splash fail` or `auto` (read from the word) |
| `sound` | `{ loud, sharp, long, pitch, rough, peak }`: fine intent over the mood (see "How the shape shows the sound") |
| `space`, `at`, `anchor` | where: screen or world (scene px); `at` = point, token, or a function (moving source) |
| `magnitude`, `span`, `area`, `token`, `size`, `scale`, `fit`, `maxWidth` | how big: see "Size" below. Usually pass only what you know about the event (`magnitude` 0..2 or tiny/small/normal/big/huge/epic, `area` = its footprint, `span`/`token` = the thing making the sound) and let the engine do the rest |
| `from` | direction (deg) or point the sound comes from: the word grows away from it |
| `seed`, `avoid`, `hand` | same look everywhere / look different from these hands / pin an earlier hand |
| `hold`, `tempo`, `loop`, `delay`, `startAt`, `until` | timing: hold ms, speed, until stop(), wait, join an effect's clock, leave when a Promise settles |
| `in`, `out`, `holdKind` | force motions: in `slam pop crackIn drop rise grow zip`; hold `boil shake throb rattle wobble buzz flicker`; out `shatter pop burst fall droop rise shrink zipout dissolve` |
| `pixel` | world only: pixel-art lettering on the 32-art-px-per-square grid (hard edges, nearest-neighbour), or a number = art px in scene px |
| `colors`, `rotation`, `parent`, `zIndex`, `reduced` | palette override, tilt, own container, stacking, reduced motion (default: the OS setting) |

Limits: 16 words at once over the interface, 48 on the canvas (`L.limits`); over a limit the oldest leaves at once ("evicted").
A scene change evicts all world words, also those still waiting for their `delay`, and stops every world stream; `L.stopAll({ space })`
does the same for everything (words waiting included, streams included). `L.count({ space })` counts the words on screen, `L.stats`
(pictures rendered, ms spent, the dearest picture).

### Lifecycle (what a caller can rely on)
- `play()` returns at once and never throws: the word is planned there (`h.hand`, `h.plan` are set unless it has a `delay`); its
  geometry and first picture are made in the next animation frame(s), within a per-frame budget, so a burst of 48 words comes up over a
  few frames instead of blocking the page. Without `startAt` a word's clock starts when its first picture shows (no entrance skipped).
- `h.ready` resolves `true` when the first picture is on screen, `false` when the word ended without ever showing (stopped first,
  evicted, its token not on this scene, its `startAt` long past). `h.finished` always resolves.
- A bad option never throws: an unusable number (NaN, a negative size, tempo or hold, `Infinity`) is ignored with one warning and the
  default is used; an unknown mood is `auto` with one warning; an `at` function that throws keeps the last point. Text is cut at 160
  characters. A character no font has is drawn as "?" with one warning.
- A word on a token (`at` = token / id / document) follows it; when the token goes away the word stays where it was and plays its exit.
  A token id that is not on this scene is skipped.

## How the shape shows the sound

### What letterers and researchers say (digest, with sources)
- **Size is loudness.** Letterers communicate volume mainly with the size and style of an effect; find the loudest part of the word
  and enlarge or reduce letters to match (Comicraft / Balloon Tales tutorial, part 2: balloontales.com/articles/tutorial/part2.html).
  Language Log ("Prosodic lettering", languagelog.ldc.upenn.edu/nll/?p=3131) likewise ties bigger letters to prominence (extra
  loudness, length or pitch) and reads slanted letters as a change of intonation, while warning that much of it is convention.
- **Direction and source.** If a sound comes from a spot in the picture (a punch), the letters can grow as they move away from it
  (Comicraft tutorial); letters can fan out from an impact point and line up with its impact lines, and an effect leads the eye
  along the reading path (Making Comics, "Letters in Action": makingcomics.substack.com/p/letters-in-action).
- **Hand-made variety.** Overlap letters, vary their placement, rotate, scale and (sparingly) skew single letters so the effect
  looks drawn; a thick dark outline, plus a thin light inner stroke on big effects (Comicraft tutorial). Clip Studio's SFX guide
  builds a BOOM letter by letter, angles letters to follow the explosion's expansion, and fills with a colour plus a gradient
  (tips.clip-studio.com/en-us/articles/5157).
- **Letterform mimics the sound.** Typography works iconically: jagged forms for intensity; placement gives motion and cause;
  colour carries emotion, warm for fire and violence, cool for air and earth (Avatar: The Promise study,
  ejournal.iainpalopo.ac.id/index.php/ideas/article/view/8713). A heavy, dissonant letterform reads as jarring; jagged balloons as a
  strained voice, round ones as calm (Making Comics). Electric effects use letters made of many small jagged edges (Lynda course
  "Lettering Comic Books with Illustrator").
- **Sharp vs round is not only comics.** The bouba/kiki effect (Köhler 1929, Ramachandran & Hubbard 2001; en.wikipedia.org/wiki/Bouba/kiki_effect):
  most people match jagged shapes with sharp sounds like "kiki" and round shapes with soft sounds like "bouba", across languages.
- **Stylisation carries function.** In a corpus study of US comics and manga, English sound effects signal their kind partly by the
  presence or absence of font stylisation (Pratha, Avunjian & Cohn 2016, "Pow, Punch, Pika, and Chu", Multimodal Communication 5(2)).

### How the engine uses it (my interpretation, not from the sources)
- `loud` sets the size (0.6x to 1.3x of the caller's size), the weight of the outline and the chance of a 3D block.
- `peak` is where the sound is loudest: those letters are biggest (a sharp attack like KRAK is biggest at the start, a boom in the
  middle, a roar at the end).
- `sharp` picks jagged edges, hard joins and angular fonts; low `sharp` picks fat round fonts and inflated, bubbly letters.
- `long` stretches the word (swell or fade-out warps, letter-by-letter entrances, longer holds); a fading sound shrinks into the
  distance on exit; repeated letters in the word itself count as length.
- `pitch` above 0 climbs (stair-up letters, upward arcs, words rising off screen-up); below 0 sags, drips and falls screen-down.
- `rough` adds grit: wobbling edges, letter jitter, speckle and crack textures, rattling holds.
- `from` turns the size gradient so the word grows away from the source.
- Motion follows the attack and decay of the sound: sharp attacks slam or pop in two or three pictures; soft or long ones grow,
  rise or arrive letter by letter; short sharp sounds shatter or pop out; long ones shrink away or thin into a halftone; heat and
  power rise (screen-up); weight falls (screen-down). Nothing fades smoothly: words leave through a growing halftone or pieces.
- `auto` reads the word with sound symbolism: K/T/P/CR = sharp, B/M/O/U = round, RRR = roar, ZZ = electric, SZ/SH/WH = rushing air.
- Colour families per mood (warm for fire and blasts, cool for wind and water, earth tones for rubble, sickly or bruised for pain).

### The vocabulary
| mood | shape | motion | colours |
|---|---|---|---|
| impact | heavy comic fonts, bulge, fan, slant, perspective; halftone | slam / pop; shake; shatter / pop | hot, primary, punch, pop |
| crack | jagged letters, word split along a crack; crack lines | pieces snap together; shake; shatter | ice, bone, stone |
| crash | rough blocky letters tumbling, stepping down; speckle | letters drop and land with dust; rattle; fall | stone, earth, rust |
| boom | fat round letters, fan and bulge; radial fill | slam with impact lines; throb; burst into puffs | hot |
| roar | brushy jagged letters swelling to the end | grows letter by letter; rattle; shrink away | beast, toxic |
| fire | flame licks rising from the letters, waves | rises from below; flicker (flames redrawn); rises away with embers | hot, ember |
| whoosh | italic streak warp, speed lines | zips in from the side; zips out | air |
| zap | jagged letters on a zigzag baseline | pops with sparks; buzz (edges re-jagged); halftone out | volt, plasma |
| tick | small plain or bubbly letters, no 3D | pops; quick halftone out | soft |
| pain | drips, sag, wobble | slam / pop; wobble; falls or droops | blood, bruise |
| powerup | climbing letters, swell, rays | grows / rises; throb; rises away | plasma, gold |
| heal | bubbly letters on an arc | rises; throb; rises / halftone out | mint |
| splash | dripping or bubbly letters on a wave, droplets | pops; wobble; drips down | water |
| fail | droopy bubbly letters sagging and shrinking | drops in small; wobble; droops and falls | dull |

## Size: how big a word is (and why)

A word's size is not one number. It comes from what makes the sound, how big the event is, where it is seen from and on what screen.
The caller states what it knows about the EVENT; the engine knows the VIEW (zoom, viewport, grid, token sizes, how many words are up)
and combines them, every animation frame. The model is `size.mjs` (pure; checked in node), numbers in `L.sizeModel`.

### What the caller states (all optional)
| option | meaning | example |
|---|---|---|
| `magnitude` | how big the event is, 0..2 (default 0.5) or `tiny small normal big huge epic` | a crit: 1; a scratch: 0.1; a building down: 1-1.5 |
| `area` | the event's footprint: a radius in scene px, `{ radius }`, `{ w, h }` or a placeable/bounds | the destroyed area, a blast radius |
| `span` | the size (scene px) of what makes the sound, when it is not a token | a pixel-vfx effect's width |
| `token` | the token the sound belongs to (when `at` is a token it is used automatically) | a hurt token |
| `size` | an explicit natural size (cap height: screen CSS px / scene px); replaces the derived one, still clamped | a fixed design |
| `scale` | a multiplier on the natural size | a stream's syllables use 0.62 |
| `fit` | `legible` (default): clamp to the legible range; `world`: pure world size, never clamped (it shrinks to nothing far out); `screen`: `size` is CSS px whatever the zoom (a label pinned to the map); `exact`: `size` as given, no model at all (old behaviour) |  |

### What the engine derives
1. **Natural size** (world words, scene px of cap height): 0.55 grid squares; from a source of span S: 0.55 g x (S/g)^0.5 (a 4x4 titan
   gets 2x, not 4x); from a footprint of radius R: 0.55 g x (R / 0.5 g)^0.6 (a 10-square collapse is about 3 squares tall); times the
   magnitude factor (0.7 at 0, 1.1 at 0.5, 1.5 at 1, 2.3 at 2). Screen words: 7.5 % of the viewport height x magnitude factor.
   Then the mood's own factor (a roar is drawn bigger than a click: `plan.sizeK`, 0.62-1.32).
2. **On screen** (CSS px of cap height) = natural x mood factor x zoom (world) or as is (screen).
3. **Legible range**, clamped softly (inside it nothing changes; outside it the size still follows zoom a little as a depth cue, then stops):
   - floor: 2.6 % of the viewport height, 15-30 px (0.8x for quiet sounds like ticks), lowered when more than 12 world words are up
     (sqrt, down to 0.7x) so a hundred far-away crashes do not bury the map; hard stop at 0.8x the floor;
   - ceiling: the cap height stays under (7 % + 8 % x magnitude) of the viewport height and the word's width under (40 % + 25 % x
     magnitude) of the usable width (viewport minus the sidebar); hard stop at 1.15x. With more than 2 world words up the ceiling
     shrinks with sqrt(2 / n), to 0.4x at most: a crowd shares the screen. Big events may fill a lot of the screen, never all.
4. **Pixel lettering** (`pixel`): the size is snapped to whole art pixels (7-40 per cap height, 32 art px per grid square) once, at the
   start, and kept: pixel art never scales by fractions.

### While the user zooms or resizes
Every frame the engine recomputes the size with the live zoom and viewport (pixel words excepted) and scales the shown picture by
new size / drawn size. As soon as the wanted texel size drifts up by more than 15 % or down to half, the picture is drawn again at the
new size (the next pictures are drawn ahead within the frame budget): a small bitmap is never stretched into a big one, big lettering
is drawn big. Screen words follow window resizes the same way.

### What it means in the situations that matter (my reading, numbers at 1366x768)
- **A tick on a small token, zoomed out** (0.2): the world size would be about 8 px; the floor holds it at about 15 px (a normal
  word about 19 px) - readable, never bigger than a normal word.
- **A building coming down** (`area` 5-10 squares, `magnitude` 1): seen from far (0.2) about 80-115 px, the biggest thing on screen
  but no wall; from zoom 0.5 on the ceiling (about 115-132 px cap height, width under 65 % of the usable width) stops it from burying
  the scene; a dozen such words at once get about 54 px each.
- **A roll result over the interface**: 7.5 % of the viewport height x magnitude: about 63 px on a 768 px laptop, about 89 px on a
  1080 px screen (magnitude 0.5, mood factor 1), the same share of the screen on both; a crit (`magnitude` 1) about 1.5x.
- **A stream along a shot**: each syllable 62 % of the stream's natural size (from `span`/`area`/`token`/`magnitude`), then clamped
  like any word, so a far-away burst of gunfire is still readable syllable by syllable.
- **Pixel lettering beside pixel art**: whole art pixels from the same model at the start zoom; the floor of 7 art px keeps the
  letters readable as pixel letters.

`L.sizeOf(text, opts)` returns what a word would get now: `{ size, px, natural, clamp: null|"floor"|"ceil"|"width", fit, sizeK }`.
`L.gallery({ part: "sizes" })` shows one word across spans, footprints and magnitudes while the view zooms out, in and back.

## Motion: how the pictures move

### What the sources say (digest, with sources)
- **Stepped, not smooth.** Into the Spider-Verse is mostly animated on twos (each drawing held two frames of 24, about 12 a second),
  with holds stepping down to threes and longer where a pose should land; the team avoided motion that was "too splined"; the
  stepped rate is meant to feel like jumping from comic panel to panel (fxguide, "Spider-Man: Into the Spider-Verse",
  fxguide.com/?p=244678). The rate is a flexible scale, not a rule: in Across the Spider-Verse one character was animated on ones
  to set him apart (vfxvoice.com/?p=5908138; Prolific Studio, blog.prolificstudio.co/blog/spiderman-into-the-spiderverse/).
- **No motion blur: lines and smears.** Motion blur was dropped; speed lines over moving things and smear frames (hand-drawn
  distortions, trailing or stretched shapes on single frames) carry fast motion instead (fxguide; Prolific).
- **Impact frames.** The films recreate the graphic flash frames of older comics on hits (fxguide).
- **Print as texture.** Halftone dots, Ben-Day dots, cross-hatching and a digital four-colour print with misregistered colour
  plates (offsets that read as out-of-focus); Kirby krackle for cosmic energy (fxguide; Stabroek News on the films' print
  imperfections, stabroeknews.com/2023/06/11/sunday/why-the-spider-verse-films-are-the-greatest-comic-book-movies-ever-made).
- **Words as picture.** Sound words like BOOM and POW fill the frame as graphic elements and underline the sound (fxguide).
- **Classic principles.** Squash and stretch, anticipation, follow-through and overlapping action, slow in/out, arcs, secondary
  action, timing, exaggeration (Thomas and Johnston, The Illusion of Life; en.wikipedia.org/wiki/Twelve_basic_principles_of_animation).

### How the engine uses it (my interpretation)
- The clock is 24 ticks a second; drawings stay on twos (about 12 a second), heavy or slow words (crash, fail, deep booms) on
  threes, and only smears, flash frames and snap frames get ones. A key pose (the word just landed) is held 4-6 ticks before
  the hold starts boiling (every hold picture is a fresh drawing: the outline wobbles a little, like redrawn line art).
- Each word gets a set of techniques from its intent, not one recipe with different numbers: sharp loud sounds may get an
  impact frame (one tick: a black star with the word knocked out in white) on contact; fast moves get smear frames (multiples
  of the word trailing it, or a zoom smear toward the reader) and speed or zoom lines; big moves get anticipation (a coiled small
  pose before a slam, a pull-back before zipping off, a lift before falling, a swell before shattering); landings squash and
  stretch back; long sounds settle letter by letter (follow-through, overlapping action); electric and glitchy sounds slip their
  cyan and magenta plates off register; power gets Kirby krackle; some hands print their shadow as halftone dots or hatch the
  3D block.
- Layers of an effect: primary = the word; secondary = lines, sparks, flames redrawn each picture; consequence = what the sound
  leaves behind (debris, dust, puffs, embers, drips) in the exit pictures.
- `L.design(word, opts).timeline.tech` lists what a word got (`flash smear antic follow misreg heavy`), `kinds` the entrance, hold and exit.

## Layers: where a word is drawn
| layer | space | where | notes |
|---|---|---|---|
| `ground` | world | primary group, sortLayer 259: over the map's water, roads, destruction, districts, fire on the ground and zones; under tiles and tokens | in the scene's light (darkness dims it) |
| `tokens` | world | primary, sortLayer 760: over tokens (at a token's elevation when `at` is a token), under the map's smoke (800) and weather (990+) | in the scene's light |
| `weather` | world | primary, elevation Infinity, sortLayer 1100: over core weather (1000) and the map's weather and smoke | in the scene's light |
| `overlay` | world | canvas.interface (DEFAULT) | over everything of the scene and its lighting, under the HTML interface |
| `top` | world | the last child of canvas.stage | over rulers, cursors and other interface drawings |
| `hud` | screen | fixed layer, z-index 5 | over the map, under the sidebar, bars and windows |
| `ui` | screen | z-index 80 | over the sidebar, chat, hotbar (UI 60), under app windows (100) |
| `screen` | screen | z-index 1000 (DEFAULT) | over the whole interface; tooltips and notifications stay on top |
Elevation (primary layers): never under the current v14 level's own background (the level's base elevation); `tokens` follows the
`at` token's (or `token`'s) live elevation, and at a point takes the highest token covering that point; `elevation` overrides. The
`screen` layer keeps above app windows whose z-index climbed past 1000 (under tooltips and notifications). A scene change removes the
engine's layer containers (the `top` one lives on `canvas.stage`, which Foundry keeps).
For a user setting: `game.settings.register(id, "letteringLayer", { scope: "client", config: true, type: String,
choices: L.layerChoices("world"), default: "overlay" })` and pass `layer: game.settings.get(id, "letteringLayer")` per call
(register in the "ready" hook or with a static copy of the ids: `ground tokens weather overlay top` / `hud ui screen`).
`L.gallery({ part: "layers" })` shows the same word on every layer.

## Words: the vocabulary (what to letter for a sound)

The engine letters any text it is handed (`L.play("KRAK!")` is unchanged). On top of that `words.mjs` knows WHAT to letter: give it
a sound kind, a loudness and a language and it gives a fitting onomatopoeia, its mood, sound and motions, seeded and varied.

```js
L.sfx("crack", { loud: 0.8, lang: "pl", space: "world", at: token, seed: msg.id });   // word + lettering in one call
const w = L.word("boom", { magnitude: "huge", lang: "auto", seed });                   // just the word: { text, mood, sound, play, ... }
L.play(w.text, { ...w.play, space: "world", area });                                    // ... lettered by the caller
L.stream({ kind: "gunfire", lang: "pl", at: () => muzzle(), to: target, every: 90 });  // syllables from the vocabulary
L.vocab.series("crack", 4, { seed, lang: "pl" });          // one sound repeated, growing: TRZASK! > TRZAAASK! > TRZAAAASK! > TRZAAAAAASK!
L.vocab.grow("KRAK!", 2);                                  // grow a caller's own text: KRAAAK!
L.number(12500, { lang: "pl" }); L.number(3, { times: true }); L.range(2, 4);   // "12 500", "3×", "2–4"
```

- `L.word(kind, o)` -> `{ text, kind, lang, tier, loud, step, template, prefix, mood, sound, motion, play }`; `play` = `{ mood, sound,
  in, holdKind, out, magnitude }` ready to spread into `L.play`. Options: `lang` (`pl`, `en`, a registered code, or `auto` = the
  game's language), `loud` 0..1 or `magnitude` (0..2 or `tiny`..`epic`: the same input as the size model; default = the normal
  magnitude 0.5), `seed` (same word on every client; unseeded words never repeat the last one of that kind), `avoid` (texts or
  templates to skip: other words of the same moment), `step` (the n-th repeat: louder and longer), `template` (pin the word, only
  its stretch follows loudness), `prefix` (true/false/"KA-"), `stream` (syllables).
- `L.sfx(kind, opts)` = `L.play(word.text, { ...word.play, ...opts })`; every play option works; `opts.sound` keys override per key;
  the handle carries `h.word`.
- Loudness picks the TIER (quiet `s` < 0.34 <= normal `m` < 0.67 <= loud `l`), then STRETCHES the word (templates mark the stretch
  points with `+`: `TRZA+SK` -> TRZASK / TRZAAASK; a word without marks stretches its last vowel, or a vowelless word its
  R/S/Z/H/M/F run), at the very top may add a PREFIX (KA-BUM, TRA-TA-TRACH, KRA-KABOOM), quiet words lose their `!`, the loudest
  gain one. No letter runs longer than 6; a prefix never stretches.
- Escalation (the seam with MOVE's growing word): `L.vocab.series(kind, n, { seed, lang, loud, grow })`: `grow: "stretch"` (default)
  keeps one word and makes it longer each step (a prefix from step 2, then `!`, `!!`); repeating sounds (gunfire, laughter, siren,
  heartbeat, drip, stomp, beep) add a syllable instead (TRA-TA > TRA-TA-TA > TRA-TA-TA-TA); `grow: "vary"` gives a different word
  each step at rising loudness. Never the same text twice in a row; never shorter in stretch mode. For a caller's plain text:
  `L.vocab.grow(text, step)`.
- Adding and overriding (callers, moinen-pixel-vfx, world macros) on the shared engine: `L.vocab.add(lang, kind, words, { replace })`
  (an array spread over tiers by length, or `{ s, m, l, st }`; `+` marks allowed; words the fonts cannot letter or longer than 22
  are refused with one warning), `L.vocab.define(kind, { group, label: { pl, en }, mood, sound, motion, stretch, pre, alias, repeat })`
  (a new kind or a change), `L.vocab.remove(lang, kind, words)`, `L.vocab.reset()`. Pickers: `L.vocab.list(lang)` (id, label,
  group, mood, counts), `L.vocab.choices(lang)` (`{ id: label }` for `game.settings` choices), `L.vocab.all(kind, lang)`.
- Numbers: `L.number(n, { lang, sign: "auto"|"always"|"never", digits, group, compact, times: true|"before", percent })`: Polish
  `12 500` (a space from 10 000), `2,5`, `1,2 MLN`, `12 TYS.`; English `12,500`, `2.5`, `1.2M`, `12K`; `3×` / `×3`; minus is `-`
  so the auto mood still reads pain / heal. `L.range(2, 4)` -> `2–4`. Every sign used has a glyph in every font (checked).

### The sound kinds (52; PL and EN words for each, 3 tiers + stream syllables)
| group | kinds |
|---|---|
| hits | punch (cios), smash (miażdżenie), slap (klaps), thud (łomot), stomp (tupnięcie), clang (brzęk), slash (cięcie), bite (ugryzienie) |
| breaking | crack (trzask), shatter (stłuczenie), crash (łoskot), crumble (kruszenie), rumble (dudnienie), creak (skrzypienie), scrape (zgrzyt) |
| blasts | boom (wybuch), whump (podmuch), thunder (grzmot), zap (porażenie), beam (promień), gunshot (strzał), gunfire (seria), ricochet (rykoszet) |
| motion | whoosh (świst), zoom (pęd), bounce (skok), teleport (teleport), wind (wiatr) |
| elements | fire (ogień), crackle (trzaskanie), hiss (syk), splash (plusk), squish (plaśnięcie), drip (kapanie) |
| powers | power-up (ładowanie), psychic (telepatia), chime (dzwonienie), fizzle (zgaśnięcie), whiff (pudło) |
| devices | click (kliknięcie), beep (pikanie), engine (silnik), siren (syrena) |
| voices | roar (ryk), pain (ból), effort (wysiłek), relief (ulga), sigh (westchnienie), cheer (wiwat), laugh (śmiech), shush (uciszenie), heartbeat (puls) |
Aliases (`explosion` -> boom, `laser` -> beam, `machinegun` -> gunfire, `hit` -> punch, `heal` -> relief, ...): `L.vocab.aliases`.
An unknown kind letters as `punch` with one warning.

### How the words were written
Our own lists, nothing copied wholesale. English follows the American comic idiom (POW, THWACK, KRAKOOM, BLAM, FWOOSH, SPLOOSH).
Polish follows how Polish comics and everyday speech write sounds rather than translating the English: hard Polish spellings
(ŁUP, BĘC, TRACH, PRASK, BUCH, CHLAST, CIACH, ŚWIST, BRZDĘK, DZYŃ, CHRUP, KŁAP, PLUSK, CHLUP, SKRZYP, ZGRZYT, SZUR, SYK, PSST, CIII),
its own idioms (ŁUBUDU for a tumble, SZAST-PRAST for a quick cut, HOP-SA for a jump, IJO-IJO for a siren, TRA-TA-TA for a gun,
PIF-PAF for shots, AUĆ / AŁA for pain, UFF for relief, HURA / JEST! for a cheer, CHA-CHA / HI-HI for laughter). Comic conventions
used: letters repeated for length, size for loudness, hyphenated syllables for a sound made of parts (KA-BUM), a prefix for the
biggest version. Sources read: Polish-English onomatopoeia tables (earlystage.pl blog), SDSU "The Sound of Comics" notes on
lettering conventions, Wikipedia lists of onomatopoeia, Polish Wikipedia "Onomatopeja", the existing word sets of the three callers
(maps sfx/words.mjs, dice splash SAYS, token reactions) for which sounds are needed.

## For the builder of moinen-pixel-vfx (a power's effect carrying its sound)

- Get the engine without depending on plus-ultra: `const L = globalThis.MoinenLetters ? await MoinenLetters.engine() : null`
  (present when moinen-maps or plus-ultra is active), or vendor this folder (the registry shares one instance either way).
- Bind lettering to the effect's timeline, not to an instant: pass `startAt` = the effect's `performance.now()` start (a word
  joins part-way through if it is late), `delay` for an offset, and `until: effectEndPromise` (or call `h.stop()` when the stage
  ends) so the word leaves with the effect. `loop: true` holds until stopped (a lasting fire, a charging aura).
- The words for a power's sound: `L.word(kind, { magnitude, lang: "auto", seed: castId })` or `L.sfx(kind, ...)` (see "Words"), e.g.
  a shooting power: `L.stream({ kind: "gunfire", lang: "auto", ... })` rattles TRA-TA-TA for Polish players, RAT-TAT-TAT for English.
- Sounds that repeat (a gun's "ratatata", a crackling fire, a rumbling quake): `L.stream(...)`. Syllables pop at the source
  (`at`, may be a function for a moving muzzle or projectile), travel along `dir` or toward `to`, one hand for the whole burst;
  timing by `every`, by `beats` (exact ms of each shot on the effect's clock) or by calling `s.beat()` from each shot with
  `manual: true`. `loud: (i) => ...` shapes a swell or fade across the burst.
  A stream keeps the effect's clock: with `startAt` in the past it skips the syllables whose life is already over and every syllable
  joins its own due time (a duration counts from `startAt`); its hand is the first syllable's whenever it joins. `s.handles` holds the
  syllables still alive, `s.emitted` counts all; `loud: 0` is the quietest syllable; `every` is at least 20 ms.
- Pixel-art surroundings: `pixel: true` letters on the effect grid (1 texel = 1 art px = grid/32 scene px), hard 1-bit edges,
  nearest-neighbour; the same moods and motions apply. Pass `span` (the effect's width in scene px) or `area` and `magnitude` rather than a fixed `size`; pixel words get whole art pixels (at least 7 per cap height) and keep the size they started with while the view zooms.
- Several powers at once: each `play`/`stream` gets its own hand unless seeded alike; words share the limit of 48 on the canvas
  and a render budget of about 4 ms per frame; seed with the cast id so every client sees the same lettering.
- Every client in step with one call: `L.net.play` / `L.net.stream` (README "Tools"). With your own socket, run the call on every
  client with the same seed. `startAt` is THIS page's
  `performance.now()` clock and differs on every client (each page counts from its own load): never send it as is. See "Several clients".

## Several clients
- The same `seed` gives the same hand, layout and timeline on every client (the per-client memory of recent hands and the reduced-motion
  setting do not change a seeded hand). Pass `from` as an angle (degrees) to keep the look identical: a `from` point is turned into an
  angle with this client's own pixels, so different window layouts may pick a different warp.
- To start a word part-way on every client (an effect that began earlier), send a wall-clock time with your event, e.g.
  `sentAt: Date.now()` at the effect's start, and on each client pass `startAt: performance.now() - (Date.now() - sentAt)` (clock skew
  between machines remains). A `startAt` more than 60 s ahead of this page's clock is ignored with a warning.
- Without clock skew: `L.net.play` / `L.net.burst` / `L.net.stream` do all of this (README "Tools"); with your own socket send
  `L.net.sharedNow()` (Foundry's ping-synced server clock) and pass `L.net.local(sentShared)` (`{ delay }` or `{ startAt }`) to `L.play`.

## Who sees a word (hidden and unseen tokens)
A word that belongs to a token (`at` is a token, a TokenDocument or an id, or `token` is given) is shown only while that token is
visible to this user: a hidden token's word is never shown to players, and neither is the word of a token this user cannot see (vision,
fog of war). The GM sees what the GM sees on the canvas. `vision: "point"` also hides a world word whose point this user cannot see (an
event in the dark or behind walls); `vision: "none"` always shows it. Streams pass `token` (or a token `at`) and `vision` to their
syllables. A word at a plain point is shown by default even on the `overlay` layer (over fog): pass `token` or `vision: "point"`
when the point must not give away where something happened.

## Tools: settings, authoring, networking, accessibility, windows (contract v6, tools.mjs)
One set for every caller, registered once by the newest copy at `init` (whichever module(s) are active).

Settings, client (this computer), namespace `moinen-letters` (stable whichever module is active; the button "Lettering settings" in
the host module's settings tab opens the engine's own window; host = moinen-maps when active, else invincible-plus-ultra):
| key | values | what it does to every word |
|---|---|---|
| `enabled` | on / off | off: `play` returns a handle that is already over (`alive` false, `off` true, `finished` -> "evicted"); streams draw nothing |
| `scale` | 0.5-2.5 | multiplies the size AFTER the legibility clamp (so words held at the floor grow too) |
| `motion` | auto / full / gentle / reduced | the strongest reduction wins: the caller's `reduced: true`, this setting, the OS (auto, gentle); full = the caller decides; gentle = moves damped to 45 %, no smear frames |
| `flashes` | on / off | the one-tick black/white impact frame (off: an ordinary drawing of the same length) |
| `photosafe` | on (default) / off | at most 2 flash frames per second on this client, none on a word taller than 20 % of the viewport, colour plates (misregistration) held still across drawings |
| `palette` | mood / contrast / cvd | contrast: white-yellow letters, black ink and extrusion, black outer line, no texture (a caller's own `colors` stay, ink turns black); cvd: every colour family remapped to the Okabe-Ito set, no green, no red-green pair (a caller's own `colors` stay) |
| `announce` | on / off | each word (or `alt`) is read by screen readers through one polite live region (`#moinen-letters-say`); the layers stay aria-hidden |
| `limitScreen`, `limitWorld` | 1-32, 4-96 | `L.limits` |
World setting `styles` (GM): the saved named styles. Read the values: `L.prefs` / `L.settings()`.

Authoring (any client, this session; `L.saveStyle` also stores a style in the world):
```js
L.registerMood("frost", { extends: "crack", label: "ice", sound: { pitch: 0.3 }, colors: { ice: 4 }, in: { crackIn: 2, pop: 1 } });
L.registerPalette("venom", [["#e8ffb0", "#9be22a", "#2f6e1f"]]);                   // or [{ fill, ext, out2: [...], ink }]
await L.registerFont("grit", { url: "modules/x/fonts/Grit.ttf", sharp: 0.8 });     // Polish capitals synthesised when missing
L.registerStyle("thor-hammer", { mood: "zap", palette: "volt", font: "bangers", in: "pop", magnitude: 0.9 });
await L.saveStyle("Młot Thora", { ...style });   // GM: world-wide; L.deleteStyle(name); L.styles(); L.style(name)
L.play("KRAKA-THOOM!", { style: "thor-hammer", space: "world", at: token });         // the call's own options win over the style's
```
Ids: a-z 0-9 _ -, starting with a letter; `toString`, `constructor`, `__proto__`, `auto` and other prototype names are refused.
New play options: `style` (a name or a style object), `palette` (a colour family by name, the same palette on every client),
`font` (a font id), `hand` as the handle's id string (`hand: h.hand`, F18) or a partial hand object, `alt` (the text read to
screen readers instead of the word), `force` (play even when the master switch is off: tools only).

Networking: `L.net.play(text, opts)`, `L.net.burst(items, common)`, `L.net.stream(opts)` play on every client in step (seed made
once, start stamped on Foundry's ping-synced server clock `game.time.serverTime`, `lead` 120 ms so nobody joins late; tokens travel
as ids, a word for a token not on a client's scene is skipped there; functions, Promises and elements do not travel, `reduced` is
each client's own). Each returns the local handle(s) with `netId`; `L.net.stop(netId, { quick })` stops it everywhere.
`L.net.sharedNow()`, `L.net.local(sharedT)` -> `{ delay }` | `{ startAt }` for callers with their own socket.

GM: `L.letterNow(text, opts)` shows a word to everyone at the selected tokens (one each, different hands) or at a point (`point`,
default the cursor); the keybinding "Letter this now" (Shift+L) opens a small box at the cursor for it. `L.designer({ text })`
opens the designer window (also: the burst button in the token controls); `L.openSettings()` the settings window.
`L.planFor(text, opts)` -> `{ plan, opts }`: the plan this client would show (style, settings and filters applied).

## Look and performance notes
- Every picture is painted from font outlines (TrueType parsed by `font.mjs`) at the pixel size it is shown at; world words re-render
  when the zoom changes a lot (x1.35 in, x0.45 out) so nothing is a small bitmap blown up. Pictures over 2048 px on a side are capped.
- A picture costs about 1-6 ms to paint (size, 3D depth and texture decide); the scheduler paints the next pictures ahead within its
  budget and paints the current one at once only when it is missing. Textures and canvases are freed when a word ends.
- Reduced motion (OS setting or `reduced: true`): one entrance picture, no shake, a two-step halftone exit.

## Fonts
Nine SIL OFL 1.1 fonts (Bangers, Anton, Patrick Hand, Titan One, Bungee, Black Ops One, Sigmar, Knewave, Rubik Wet Paint): files,
holders, sources and sizes in ATTRIBUTION.md. Knewave has no Polish letters of its own: the engine builds Ą Ć Ę Ł Ń Ś Ź Ż in memory
from its own outlines plus accents (its own Ó acute and period, a drawn Ł bar, the ogonek from a fallback font). Every font's
Polish capitals were checked by rendering them (letr gallery stills), not only by the character map.
