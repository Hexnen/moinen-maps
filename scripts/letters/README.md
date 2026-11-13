# LETR: comic sound-effect lettering engine

Give it a word and an intent; it letters the word the way comic letterers draw sound effects (every word its own shape, size,
colours, outlines, 3D, texture) and animates it frame by frame (pictures on twos and threes of a 24 fps clock): an entrance, a hold
that keeps living (each picture is redrawn, the line "boils"), an exit. Over the interface (HTML) or on the canvas in world space
(PIXI), any number at once within limits, deterministic for a seed so every client sees the same lettering.

- Canonical copy: `moinen-maps/scripts/letters/`. Vendored copy: `invincible-plus-ultra/scripts/letters/`. Same files; `MANIFEST.json`
  holds their hashes. Edit ONLY the canonical copy, then `node scripts/letters/sync.mjs <path to plus-ultra>/scripts/letters`.
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
A scene change evicts all world words. `L.stopAll({ space })`, `L.count({ space })`, `L.stats` (pictures rendered, ms spent).

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
   magnitude factor (0.7 at 0, 1.0 at 0.5, 1.5 at 1, 2.3 at 2). Screen words: 8.5 % of the viewport height x magnitude factor.
   Then the mood's own factor (a roar is drawn bigger than a click: `plan.sizeK`, 0.62-1.32).
2. **On screen** (CSS px of cap height) = natural x mood factor x zoom (world) or as is (screen).
3. **Legible range**, clamped softly (inside it nothing changes; outside it the size still follows zoom a little as a depth cue, then stops):
   - floor: 2.6 % of the viewport height, 15-30 px (0.8x for quiet sounds like ticks), lowered when more than 12 world words are up
     (sqrt, down to 0.7x) so a hundred far-away crashes do not bury the map; hard stop at 0.8x the floor;
   - ceiling: the cap height stays under (9 % + 12 % x magnitude) of the viewport height and the word's width under (45 % + 30 % x
     magnitude) of the usable width (viewport minus the sidebar); hard stop at 1.15x. Big events may fill a lot of the screen, never all.
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
- **A building coming down** (`area` 5-10 squares, `magnitude` 1): seen from far (0.2) about 80-120 px, the biggest thing on screen
  but no wall; from zoom 0.5 on the ceiling (about 160-185 px cap height, width under 75 % of the usable width) stops it from burying
  the scene.
- **A roll result over the interface**: 8.5 % of the viewport height x magnitude: about 72 px on a 768 px laptop, about 100 px on a
  1080 px screen (mood factor 1), the same share of the screen on both; a crit (`magnitude` 1) about 1.5x.
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
For a user setting: `game.settings.register(id, "letteringLayer", { scope: "client", config: true, type: String,
choices: L.layerChoices("world"), default: "overlay" })` and pass `layer: game.settings.get(id, "letteringLayer")` per call
(register in the "ready" hook or with a static copy of the ids: `ground tokens weather overlay top` / `hud ui screen`).
`L.gallery({ part: "layers" })` shows the same word on every layer.

## For the builder of moinen-pixel-vfx (a power's effect carrying its sound)

- Get the engine without depending on plus-ultra: `const L = globalThis.MoinenLetters ? await MoinenLetters.engine() : null`
  (present when moinen-maps or plus-ultra is active), or vendor this folder (the registry shares one instance either way).
- Bind lettering to the effect's timeline, not to an instant: pass `startAt` = the effect's `performance.now()` start (a word
  joins part-way through if it is late), `delay` for an offset, and `until: effectEndPromise` (or call `h.stop()` when the stage
  ends) so the word leaves with the effect. `loop: true` holds until stopped (a lasting fire, a charging aura).
- Sounds that repeat (a gun's "ratatata", a crackling fire, a rumbling quake): `L.stream(...)`. Syllables pop at the source
  (`at`, may be a function for a moving muzzle or projectile), travel along `dir` or toward `to`, one hand for the whole burst;
  timing by `every`, by `beats` (exact ms of each shot on the effect's clock) or by calling `s.beat()` from each shot with
  `manual: true`. `loud: (i) => ...` shapes a swell or fade across the burst.
- Pixel-art surroundings: `pixel: true` letters on the effect grid (1 texel = 1 art px = grid/32 scene px), hard 1-bit edges,
  nearest-neighbour; the same moods and motions apply. Pass `span` (the effect's width in scene px) or `area` and `magnitude` rather than a fixed `size`; pixel words get whole art pixels (at least 7 per cap height) and keep the size they started with while the view zooms.
- Several powers at once: each `play`/`stream` gets its own hand unless seeded alike; words share the limit of 48 on the canvas
  and a render budget of about 4 ms per frame; seed with the cast id so every client sees the same lettering.
- Nothing is networked: run the call on every client from your own socket event, with the same seed and `startAt`.

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
