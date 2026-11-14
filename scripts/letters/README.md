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
L.burst([{ text: "KRUSZ!", at: p1 }, { text: "BRDUMM!", at: p2 }], { mood: "crash", space: "world" });   // different hands guaranteed
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

**1.9.0 MOTION2: the `invincible` style moves by its sound** (`motion.mjs`; everything below in this section is the frozen legacy
timeline of `comic` / `expressive`). A sound-family table (18 families, a row per kind: entrance, hold envelope, exit by cut-off,
hold length from the sound's duration, rate, moving letters, travel) gives each word a pose track; the word is painted once and the
sprite / box is moved every display frame (`look.motion: "smooth"`, default) or its drawn channels step on one shared grid of the
shared clock (`"stepped"`). The default is the GM's table setting `movement` (1.9.2 MODE: world scope, smooth by default, it drives
`L.motionMode(name)`); the stepped grid runs on the world's clock (`L.gridClock`) so every seat strikes on the same instant; a call's
`look.motion` beats the setting, reduced motion beats both. Pictures carry a `key`; same key = one painting. Rules and numbers:
manual 11a; checks: `check-motion2.mjs`.

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
- (v6, MOVE) Holds live: hold drawings move visibly (shake, rattle, wobble, boil, throb), loud hits add a flicker of impact lines,
  and every held word breathes slowly on top (a sway, a swell, a bob over the whole hold, on the drawing grid). The wind-up before a
  slam is a crouch (wider, lower, about 0.8 of the size), not a squeezed blob. `shatter` breaks the real letters into pieces that
  fly, fall and bounce (= `shards`); `burst` swells and blows the word apart from its middle in a puff cloud.
- (v6) The picture clock: a word's drawings run on its own clock. No entrance or exit drawing is ever skipped, and a drawing shown
  late starts from its beginning, so a slow client sees the same drawings for the same beats (it runs a few frames longer) instead
  of a stretched wind-up or an exit that blinks out.
- (v6) Words stay in the view: a word placed near an edge is moved in so that its hold and its entrance motion fit (exits may leave).
  `L.viewInset({ top, right, bottom, left })` (px, or a function `(space) => insets`) reserves edges such as a letterbox; per word
  `keepInView: false` turns it off. Travelling words keep their path.

### Motion: travel (paths, thrown arcs, beams, orbits)
- `path`: `{ from, to, arc, duration, ease, spin, loop, orient }` (a thrown arc: `arc` 0.2-0.5 bulges screen-up whichever way it
  is thrown), `{ points: [...] }` (a smooth curve through them; `smooth: "line"` for straight legs), or `{ fn: (u) => ({x, y}) }`.
  Ends may be points, tokens or functions (a moving target): the word arrives where the target IS. Duration defaults to the word's
  entrance + hold; ease `linear` for arcs, else `inout`; `spin` turns; `orient` `lean` (default: a readable tilt toward the motion,
  never upside down), `tangent`, `none`. Speed lines trail it.
- `orbit`: `{ center, radius, period, dir, phase, turns, squash, breathe, orient }` circles a point, a token or a function (a
  tornado: `center: () => W.tornadoApi.positionAt(id)`) for as long as `until` (a Promise) lasts; the word is bent along its ring
  (`orient: "bend"`, tops outward when clockwise) and trails swirl lines. Radius defaults to the token's size, the `area`, or 2.6 units.
- Travel steps on the word's drawing grid (twos by default), like everything else; reduced motion keeps the word still at its place.
- Streams take `orbit` (every syllable joins one ring where the stream's head is) and `path` (each syllable rides it), and
  `orient` for plain streams (syllables lean toward where they fly).

### Motion: one word on several beats (choreography)
- `parts: "prefix"` (KA- arrives small before the body), `"syllables"` (each on its own beat; `beat` ms, default 170), or a list
  `["RAKA", "BOOM!"]` / `[{ text, at, scale, in }]` (`at: -1` = already there). A part landing knocks the parts before it.
- `typeOn: true | ms` letters appear one by one; `countIn: true | { from, steps }` a number counts up into its value.
- `echo: n | { n, every, gap, shrink, dir, hollow }` smaller hollow copies answer the word after it lands.

### Motion: frame rate per call
- `on: 1 | 2 | 3` (or `"ones" | "twos" | "threes"`, or `fps: 24 | 12 | 8`): ones redraw every tick (new drawings, not tweens),
  threes hold each drawing 3 or 6 ticks; flash and smear frames stay one tick; entrance and exit keep their length. Default twos.

### Motion: escalation, push, shards, glow
- `escalate: true | key | { key, n, window, max, mode }`: the same word on the same source (a token, a spot, or your `key`/`source`)
  within `window` ms (1600) grows, merges ("BAM! BAM!") up to `max` (3), then counts ("BAM! ×5"); the new word replaces the old one
  in the same hand. Memory per client: pass `n` for a level decided by the caller (the same on every client). `L.escalation`.
- `push: true | { radius, force }`: at its contact the word shoves the words around it aside (they swing out and settle);
  `pushable: false` keeps a word in place; `L.push(at, { space, radius, force })`.
- `out: "shards"` (or `shatter`): the real letters crack, break, fly, fall and bounce.
- `glow: true | "auto" | { color, strength, light }`: a self-lit word (world: a light in the scene's illumination, so it shows in the
  dark, plus a bloom; screen: a CSS glow). `"auto"` lights fire, zap and powerup words when the scene is dark (darkness >= 0.25).

### Motion: continuous sounds (`L.sustain`)
A sound that lasts an unknown time is lettered as a phrase score, not one still word and not one word replayed on a timer:
overlapping phrases, each a different treatment of the same sound (breath, stretch: the word longer, split into its syllables on
their beats, shed: fragments drift off along `dir`, accent: a bigger slam, echo), seeded and never the same twice in a row. When it
stops, the words up play their exits and a small tail trails off.
- `L.sustain({ text | kind, at, space, mood, level, until, seed, dir, orbit, path, words, treatments, mode, gap, max, ... })` ->
  `{ stop({ quick }), level(v), alive, phrases, history, finished, handles }`. `level` 0..1 (or a function of ms) sets size, how
  often and how busy; change it live with `s.level(v)`. `kind` takes its words from the vocabulary (WORD); `words(k, ms, level)`
  supplies your own. Ends on `until`, `s.stop()`, `L.stopAll()` and (world) a scene change.
- `mode: "ambient"`: the quiet, permanent case (the steady hiss of a pipe on a map). One small hollow word now and then (`gap`
  [min, max] ms, default 4.5-11 s), only while its spot is in view, at most `L.ambientMax` (3 world, 2 screen) up at once for all
  sources of a scene, slow and on threes. Hundreds of sources cost nothing while off view.

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
L.vocab.series("crack", 4, { seed, lang: "pl" });          // one sound repeated, one notch more each time: KRAKT! > KRRAKT! > KA-KRRAKT! > ...
L.flow("hiss", { lang: "pl", seed }).take(8000);            // a CONTINUOUS sound: onset, changing body words, tail (see below)
L.vocab.grow("KRAK!", 2);                                  // grow a caller's own text: KRAAAK!
L.number(12500, { lang: "pl" }); L.number(3, { times: true }); L.range(2, 4);   // "12 500", "3×", "2–4"
```

- `L.word(kind, o)` -> `{ text, kind, lang, tier, loud, long, bangs, step, template, prefix, mood, sound, motion, play, accent, peak,
  env }`; `play` = `{ mood, sound, in, holdKind, out, magnitude, accent }` ready to spread into `L.play`. Options: `lang` (`pl`, `en`,
  a registered code, or `auto` = the game's language), `loud` 0..1 or `magnitude` (0..2 or `tiny`..`epic`: the same input as the
  size model; default = the normal magnitude 0.5), `long` 0..1 or `duration` (ms) = HOW LONG the sound lasts, separate from how
  loud; `bangs` 0..2 (force the "!" count), `seed` (same word on every client; unseeded words never repeat the last one of that
  kind), `avoid`, `step` (the n-th repeat: louder and longer), `template` (pin the word), `prefix` (true/false/"KA-"), `stream`.
- `L.sfx(kind, opts)` = `L.play(word.text, { ...word.play, ...opts })`; `kind loud lang step template prefix long duration bangs` are
  vocabulary options, every other play option works; `opts.sound` keys override per key; the handle carries `h.word`.

#### Only onomatopoeia (the owner's rules, and the vocabulary review of 2026-11-13)
Every word imitates the sound; none NAMES it (`CHRZĘST`, `SYK`, `ŁOMOT`, `GROWL`, `CREAK`, `ROAR` are names of sounds, not sounds).
No dictionary words at all ("ciach to słowo"): not even an imitative interjection from the dictionary (CIACH, TRZASK, PLUSK,
SKRZYP, CHRUP, MLASK, PSTRYK, SZUR, CHLAST, PRASK, TRACH, BACH, CHLUP; CRASH, SPLASH, SLAP, CRACK, CLICK, WHIRR, PEW) and no
ordinary word that happens to look like a sound (BRAM, GROCH, PTAK, KRY, DOOM, BROOM, GROOM). A sound word is BUILT from the sound:
an attack, a lasting part, a cut-off (a blade SZSZT, FSZSZT; a blow TWOOM, WRAMM). Since the review:
- **No Polish diacritics** in any sound word, prefix, stream syllable or flow segment, in either language (Ą Ć Ę Ł Ń Ó Ś Ź Ż never;
  the Polish set is also written without V, Q, X). The deny list may hold diacritic words; they are compared with the marks stripped.
- **English is the master**; Polish follows it in Polish spelling (OO -> UU, EE -> II, SH -> SZ, CH -> CZ, V -> W, TH -> T) plus a
  short native list (PAF, IJO-IJO, SZSZT, DZING). 2-4 good words per tier, never padded.
- **The refusal** (`refusal(word, lang, { kind })` in words.mjs, also behind `naming()` and `L.vocab.add`): every syllable and the
  whole word are compared in a canonical spelling (diacritics stripped; English respellings folded CK -> K, C -> K, QU -> KW,
  WH -> HW, PH -> F, so KREEK = CREAK and HWOOSH = WHOOSH). EXACT: equal to a denied word, repeated letters collapsed (CIAAACH ->
  CIACH); a denied word written with a double letter (BAA, BOOM, GRR, SHH) matches only its doubled spelling, so BA-DUM and HRRO are
  no longer caught by accident. NEAR: one letter from a denied word of 4+ letters as a reader sees it (a vowel for a vowel, in a
  4-letter word only I/Y or O/U; R for L; a voiced for a voiceless twin; a letter dropped or added inside or at the end; an S in
  front: PLOSK ~ PLUSK, TRZAK ~ TRZASK, KLYK ~ KLIK, SZWUM ~ SZUM, BWEEP ~ BEEP, THUM ~ THUMP, DLIP ~ DRIP), or a denied 3-letter
  word with K or T stuck on. A changed or added FIRST letter is not near (WRAM is not TRAM, CZUM is not SZUM). The final text
  (prefix + stretched word) goes through the same refusal, so a prefix cannot make a word (KA-POW = KAPOW is dropped).
- **The exception lists**, each entry with its reason, for the owner to rule on: `ICONIC` (at most 16; pl BUM, BAM, PAF, SZSZ, HA,
  BANG; en POW, THUD, BAM, BOOM, BANG, ZAP, WHAM, SHH, PLOP, PLUNK, SPLOOSH, BLAM, BEEP, VROOM, HA, GRR) pass everywhere, also with a
  cut-off added at their end (SZSZT), but a letter changed or put inside one is near (BWEEP, BRANG); `VOICE` (pl HE, HI, CHE, OCH,
  UCH; en HE, HEH, HO, ARGH, UGH, OOF) pass only in the voice kinds; `ALLOW` holds the comic's K-respellings and the few built words
  that are one letter from a word (KRAK, KLANK, KRUNCZ, GLUP, PLUP, PLUMP, DZING, BLAM; KRAK, FWOOSH, KROOSH, KRUNCH, KLANK, KLANG,
  SKREE, SKROOM, CHOOM, GLUB, SPLUMP, THWIP...). TRACH, BACH and CHLUP are not exceptions.
- **Sayable** (`sayable(word, lang)`): no consonant pile of 5+, no plosive-R/L-plosive (KRKAK), no three plosives in a row, a doubled
  letter opens a syllable only when it lasts (SSST, MMM, never VVRT), English never writes II (a long i is EE); a syllable without a
  vowel is one clear lasting sound (BZZT, PSST, HMM, GRRMM) or a tick or throat sound (TK, THK, SNF, CHK, PFT).
- **Each kind its own words**: a word (repeated letters collapsed) used by two kinds must be on `SHARED` with both kinds and a reason
  (SKRAKT is a crack and an impact, a storm's word is its thunder, a mech walks with DUM-DUM stomps); any other sharing fails the checks,
  so a punch word on a plane cannot come back.
- **The water family** is fixed by the owner: pl small PLUP BLUP PLOP GLUP, heavy PLUMP BLUMP SPLUMP, big SPLOOSZ SPLASZ, bubbles
  GLUB BLUB BULP; en PLOP PLOOP PLUNK SPLOOSH, bubbles GLUB BLUB. The laser pistol is ZAT, TZAT, ZARK, TZAK, FZAT, SKZARK, KTZAK,
  ZZARKT, ZAT-ZAT-ZAT (never PIU PIU). `gunshot` is merged into `pistol` (an alias).
- **Playing with letters** where it fits the sound: muffled B-/G- onsets (BTHOOM, GDOOMF, BWUMF), hard K-/SK- (KTHOOM, SKROOMM),
  airy F-/H- (FWOOSH, HWAAAH), wet SH-/SP- (SHPLAK, SPLORCH); the stretch goes to the letter that lasts (crack on R: KRRRRAK, boom on
  OO and M, hiss on S).
`DICT` is the deny list (`NAMING` its old name). The checks run every rule over every bank word, prefix, stream syllable, flow
segment, series and the generated text in both languages; `words-reviewed.mjs` holds every syllable of the built-in banks as read
against the rules, so nothing slips in unreviewed.

#### Prefixes: the sound's own lead-in (the owner: "Tra ta przed bombą?")
A prefix is what is heard just before the main sound and belongs to it: the detonator's crack before the boom (KA-BUM,
KA-THOOM), the surface tearing before a collapse (KRA-KROOSH), the lightning's double crack before the thunder (KRA-KA-GRRAWOOM; BOOM / BUM only for a blast with fire: `FIRE_BLASTS`, WORDS3).
It is never another sound's signature (no gun rattle TRA-TA- before a blast). `PREFIXES` in words.mjs lists each prefix with its
reason and the only kinds it may lead; every bank word with a lead-in and every kind's prefix must be on it, and a prefix is dropped
when the final text would be a dictionary word. pl and en alike: KA- (punch, smash, clang, boom, crack, crash, thud, mech, blaster,
splash), KRA- (smash, crash), KRA-KA- (thunder, storm); pl CZAK-CZAK- / en CHK-CHK- (shotgun: the pump), pl PTYK-KA- / en PTIK-KA-
(grenade: the pin and the spoon).

#### The comic's manner (examples the owner gave from the Invincible comic)
TWOOM!! WRAMM!! BATOOWWW! POW! FWOOOSH!! CHOOM!! SKROOMM!! THUD! KA-THOOM! KRAK!! SKREE- KA-KROOSH!: an invented consonant cluster
at the attack (TW-, WR-, FW-, SKR-, CH-, THW-, BR-), the lasting letters doubled or tripled, consonants too (MM, WWW), not only
vowels; one or two "!"; short sounds left short. All of them pass the refusal (checked).

#### How loud, how long, and WHERE a word stretches
- LOUDNESS picks the tier (quiet `s` < 0.34 <= normal `m` < 0.67 <= loud `l`), the "!" count, a prefix at the very top and the size.
  DURATION alone decides how much the word stretches: a long quiet sound is long without "!" (`{ loud: 0.15, long: 1 }`: PSSSSSSS,
  WZMMMMMMM), a short loud one is short with "!!" (`{ loud: 1, long: 0 }`: KRAK!!, POW!!). Default duration = the kind's natural
  length (a crack is short, wind is long), a little longer when louder.
- The "!" scale is 0..2: 0 below 0.25 loud; 1 ordinary; "!!" only from 0.85 loud with a sharp onset (or from 0.95); one less for a
  soft onset that is not loud or a long sound that is not loud. Kinds that are never loud are capped (`maxBangs`: sigh, relief, purr
  0; fizzle, silenced, drip, shush, whiff, hiss, snake hiss, psychic, meow, squeak, click, beep, rain, heartbeat, creak, reload,
  crackle 1). A word written ending in "…" trails off (a sigh, a fade) and keeps "…" unless it is said loud.
- WHERE it stretches: a sound has an attack (K of KRAK), a sustain (what lasts) and a cutoff (K of KRAK, T of BZZT). Only the
  sustain repeats. Letter classes: V vowels (ringing, voice, the open boom; English I never: it is clipped, a long one is EE), R
  (rolling, growl, engine), Z (buzz, the Z of RZ), S (hiss; Polish SZ lengthens as an S run with one SZ at its end, SSSSZ, never
  SZSZSZ; English SH as SHHH), M (hum: M N, the N of NG), F (air: F; W only at a syllable's end after a vowel, POOWW, never THWWWIT),
  H (breath). English PH is no lasting sound. Each kind lists its sustain classes in order (`hold`): boom `V M`, crack `R V`, hiss
  `S Z F V`, engine `R V M`, sword `M V S` (the ring), laser pistol `V R`. The stretch goes to the LAST run of the first listed class
  in the LAST syllable; a ringing vowel followed by a continuant of the kind shares the stretch with it (TWOOOMM, BATOOOWW,
  SKROOOOOMMM); the overflow goes only forward. Plosives, affricates (CZ DZ) and a prefix never repeat.
- PERCUSSIVE kinds (click, drip, hammer, reload, heartbeat, gunfire, hail, stomp, helicopter, clunker, mech, pistol, rifle,
  silenced, crackle, squeak, bark, laugh, beep) never stretch a letter: a long one repeats whole hits (TOK-TOK -> TOK-TOK-TOK-TOK)
  up to 22 letters. No run is longer than 6, except the steady hisses, hums and drones (hiss, shush, snake hiss, rain, purr, psychic,
  rumble, engine, minigun, drill, power-up, wind, snarl) whose words and flows may run to 10.
  Examples: POW > POOOWW, KRAK > KRRRRAK, BUM > BUUUMM, BZZT > BZZZZZT, FWOOSH > FWOOOOSH, PSST > PSSSSSST, SZUM > SSSZUM (pl).

#### Accent: where the sound is loud inside the word (the seam with LOOK's per-letter size)
`word.accent` = one weight 0..1 per character of the word as the engine normalises it (`plan.chars`: NFC, Polish upper case, single
spaces); `word.peak` = where the loudest letters sit (0..1), also put in `sound.peak`, so today's layout already makes those
letters biggest; `play.accent` hands the weights to the layout. The shape follows the kind's envelope (`env`): `hit` (attack loud,
the stretched ring decays: KRAAAK), `swell` (quiet attack, the sustain grows to the end: GRRRAAH, WRRRUM), `fade` (loud start,
fading tail: UUUFFF…), `arc` (rises to the middle and falls: a fly-by WHOOOOSH), `beat` (every syllable has its own onset: TA-TA-TA).
A prefix and earlier syllables are a quieter lead-in (~0.55); "!" carries the peak weight, "…" a tail weight, spaces 0. Plain text
gets one too: `L.vocab.accent(text, { kind | mood })` (the mood decides the envelope).

#### Character: what the sound is like (so the look can fit it)
`word.character` (also `play.character` and on every flow segment) = `{ hard, sharp, heavy, wet, metal, electric, heat, sustain, rough,
pitch, contour, material, texture }`: hard/soft, sharp/dull, heavy/light, wet/dry, metallic, electric, hot/cold (-1..1),
short/sustained (this word's duration), clean/gritty, low/high, how it moves (fall rise arc pulse steady), what makes it (stone wood
glass metal water fire air flesh energy mind machine voice rubber) and its surface (crisp jagged gritty smooth ringing billowy bubbly
shaky). Each kind has its own (`CHAR` in words.mjs); plain text gets its mood's: `L.vocab.character({ kind | mood })`. LOOK draws
from it (API-CONTRACT v5).

#### Continuous sounds (a fire, an engine, a siren, a held beam, wind, a hum, a hail of bullets, a pipe hissing)
`L.flow(kind, { lang, seed, loud, style })` -> `{ style, onset, at(i), tail, take(ms) }`: the onset word (the attack), body
segments for as long as the sound lasts (`at(i)` forever, deterministic per seed, never the same text twice in a row, never one
endless run of a letter) and a trailing tail word. Each segment: `{ phase, i, t, ms, text, loud, long, bangs, accent, peak, env, play }`.
Styles: `steady` (a pipe hissing, a hum: long quiet words of the sustain whose length breathes slowly, SSSS TSSSSS FSSS…, no "!",
a small sputter now and then), `drone` (engine, beam, power: one family of words whose sustain swells and sinks on a slow wave,
the crest may get one "!"), `crackle` (fire, sparks, grinding: a quiet stretched bed word, then 1-3 irregular pops), `gust` (wind:
long rising word at a crest, short trailing one at a trough), `cycle` (siren, gunfire, heartbeat, laughter: the kind's syllable in
groups of 2-4 that vary in count and accent), `mix` (a composite sound made of several sounds over time: a storm = rain as the
bed, wind and thunder coming in; a tornado = wind, rumble, crash; each segment carries `of` (the composite kind) and `part` (the
part sound, `MIX` in words.mjs)). The vocabulary says WHAT is lettered WHEN; how segments move, overlap and hand over
is MOVE's (see API-CONTRACT v5).

- Escalation (the seam with MOVE's growing word): `L.vocab.series(kind, n, { seed, lang, loud, grow })`: `grow: "stretch"` (default)
  keeps one word and makes it ONE notch more each step: one more sustain letter; when full, one more "!" (up to 2); the prefix from
  step 2; then an echo in front (KRAK-KRAAAAAK!!). Repeating sounds (gunfire, laughter, siren, heartbeat, drip, stomp, beep) add a
  syllable instead (TA-TA > TA-TA-TAA > TA-TA-TA-TAAA); `grow: "vary"` gives a different word each step at rising loudness. Never
  the same text twice in a row; never shorter in stretch mode. For a caller's plain text: `L.vocab.grow(text, step, { kind })`.
- Adding and overriding (callers, moinen-pixel-vfx, world macros) on the shared engine: `L.vocab.add(lang, kind, words, { replace })`
  (an array spread over tiers by length, or `{ s, m, l, st }`; `+` marks allowed; words the fonts cannot letter, longer than 22, or that name a sound
  are refused with one warning), `L.vocab.define(kind, { group, label: { pl, en }, mood, sound, motion, stretch, pre, alias, repeat })`
  (a new kind or a change), `L.vocab.remove(lang, kind, words)`, `L.vocab.reset()`. Pickers: `L.vocab.list(lang)` (id, label,
  group, mood, counts), `L.vocab.choices(lang)` (`{ id: label }` for `game.settings` choices), `L.vocab.all(kind, lang)`.
- Numbers: `L.number(n, { lang, sign: "auto"|"always"|"never", digits, group, compact, times: true|"before", percent })`: Polish
  `12 500` (a space from 10 000), `2,5`, `1,2 MLN`, `12 TYS.`; English `12,500`, `2.5`, `1.2M`, `12K`; `3×` / `×3`; minus is `-`
  so the auto mood still reads pain / heal. `L.range(2, 4)` -> `2–4`. Every sign used has a glyph in every font (checked).

### The sound kinds (94; PL and EN words for each, 3 tiers + stream syllables)
| group | kinds |
|---|---|
| hits | punch (cios), smash (miażdżenie), slap (klaps), thud (łomot), stomp (tupnięcie), clang (brzęk), slash (cięcie), bite (ugryzienie) |
| breaking | crack (trzask), shatter (stłuczenie), crash (łoskot), crumble (kruszenie), rumble (dudnienie), creak (skrzypienie), scrape (zgrzyt) |
| blasts | boom (wybuch), whump (podmuch), thunder (grzmot), zap (porażenie), beam (promień), gunfire (seria), ricochet (rykoszet), shock wave (fala uderzeniowa), sonic boom (grom dźwiękowy), dry blast (suchy wybuch: `concussion`, a blast without fire, KROOM / KRUUM) |
| motion | whoosh (świst), zoom (pęd), bounce (skok), teleport (teleport), wind (wiatr) |
| elements | fire (ogień), crackle (trzaskanie), hiss (syk), splash (plusk), squish (plaśnięcie), drip (kapanie) |
| powers | power-up (ładowanie), psychic (telepatia), chime (dzwonienie), fizzle (zgaśnięcie), whiff (pudło) |
| devices | click (kliknięcie), beep (pikanie), engine (silnik), siren (syrena) |
| voices | roar (ryk), pain (ból), effort (wysiłek), relief (ulga), sigh (westchnienie), cheer (wiwat), laugh (śmiech), shush (uciszenie), heartbeat (puls) |
| animals | bark (szczekanie), snarl (warczenie), meow (miauczenie), purr (mruczenie), cat hiss (prychanie), squeak (pisk: rat, mouse), snake hiss (syczenie), trumpet (trąbienie: elephant) |
| vehicles | plane (samolot), helicopter (helikopter), fast car (wyścigówka), old clunker (gruchot), walking machine (maszyna krocząca) |
| weapons | pistol (pistolet; `gunshot`, `shot`, `gun` are its aliases since the review), rifle (karabin), shotgun (strzelba), minigun (działko), laser pistol (pistolet laserowy: short, high, electric, hard start, brief fizz: ZAT, TZAK, ZARK, ZZARKT; never PIU PIU or PEW), heavy blaster (ciężki blaster: low, thick energy blast), silenced (tłumik), sword (miecz), arrow (strzała), thrown (rzut), grenade (granat), rocket (rakieta), reload (przeładowanie) |
| devices (more) | ambulance (karetka), police (policja), fire engine (straż pożarna): three different sirens; drill (wiertarka), hammer (młotek) |
| weather | hail (grad), rain (deszcz), storm (burza, mix), tornado (tornado, mix) |
| impacts | impact (trafienie: a bullet or blow landing), debris (odłamki: falling pieces) |
| weapons (more) | whizz (świst kuli: a near miss), casings (łuski), dry fire (suchy strzał: an empty click) |
Aliases (`explosion` -> boom, `laser` -> beam, `machinegun` -> gunfire, `hit` -> punch, `heal` -> relief, ...): `L.vocab.aliases`.
An unknown kind letters as `punch` with one warning.

### Material, fire ladder, tails and chains (1.7.1 KINDS1)
Word options `material` (stone wood metal earth water glass flesh shield), `pieces` (debris size), `intensity` (fire 1..5) and
`stage` (fire `ignite` / `out`) pick a row of `VARIANTS[lang][table]` (`VARY` names which kinds read which table; a string row
borrows another kind's bank, e.g. glass -> `shatter`); `VARIANT_META` gives a fire row its own flow style, envelope, sustain and
"!" cap; `MAT_CHAR` sets the word's character material. `TAILS` lists the sounds that follow a sound by themselves (the twin of
`PREFIXES`, each with a reason); `CHAINS` are named events told in order (`build peak develop resolve`, places `source target
ring around feet bounce behind`). `vocab.chain(spec, o)` makes the words, `L.chain(spec, o)` plays them (local, not networked).
Manual section 9a.

### How the words were written
Our own lists, nothing copied wholesale. Since the vocabulary review (2026-11-13, WORD2) the banks are written per kind with English
as the master and Polish following in Polish spelling, every word built from attack + lasting part + cut-off, then run through the
refusal, the sayable test, the lead-in table and the sharing list, and read by hand for accidental words (GROCH, PTAK, BRAM, DUH,
PUTA, HUMF were caught). Comic conventions used: letters repeated for length, size for loudness, hyphenated syllables for a sound
made of parts (KA-BUM), a prefix for the biggest version. Sources read: Polish-English onomatopoeia tables (earlystage.pl blog),
SDSU "The Sound of Comics" notes on lettering conventions, Wikipedia lists of onomatopoeia, Polish Wikipedia "Onomatopeja", the
existing word sets of the three callers (maps sfx/words.mjs, dice splash SAYS, token reactions) for which sounds are needed.

Adding a kind (the material impacts, debris, shock wave, fire ladder and sequences planned next plug in here): a `K()` row in
`KINDS`, its `HOLD` classes, `CHAR`, `KIND_ENV`, a `FLOW` style if it lasts, a `BANK` row in both languages (2-4 words per tier),
its lead-in on `PREFIXES`, any shared word on `SHARED` with its reason, the `perc` / `repeat` / `maxBangs` / `run` lists if they
apply; then the syllables into `words-reviewed.mjs` and `node scripts/letters/check.mjs` (section 19 of check-words.mjs runs every
rule above on the new words and on the text the engine makes from them).

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
- Every client in step with one call (GM clients only): `L.net.play` / `L.net.stream` (README "Tools"). With your own socket, run the call on every
  client with the same seed. `startAt` is THIS page's
  `performance.now()` clock and differs on every client (each page counts from its own load): never send it as is. See "Several clients".

## Several clients
- The same `seed` gives the same hand, layout and timeline on every client (the per-client memory of recent hands and the reduced-motion
  setting do not change a seeded hand). Pass `from` as an angle (degrees) to keep the look identical: a `from` point is turned into an
  angle with this client's own pixels, so different window layouts may pick a different warp.
- To start a word part-way on every client (an effect that began earlier), send a wall-clock time with your event, e.g.
  `sentAt: Date.now()` at the effect's start, and on each client pass `startAt: performance.now() - (Date.now() - sentAt)` (clock skew
  between machines remains). A `startAt` more than 60 s ahead of this page's clock is ignored with a warning.
- Without clock skew: `L.net.play` / `L.net.burst` / `L.net.stream` do all of this from a GM's client (README "Tools"); with your own socket send
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
| `movement` (WORLD, the GM's) | smooth / stepped | the invincible style's motion type on every seat (1.9.2 MODE); a player sees it as text |
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
GM only (user ruling TOOL-8): only a GM sends. On a player's client `L.net.play` / `L.net.stream` return a handle that is already
over (`refused: "gm-only"`, `alive` false), `L.net.burst` returns `[]`, `L.net.stop` only stops local words; nothing is sent, nothing
throws, one console line per call kind says why. Every receiving client drops a message whose sender (stamped by Foundry's server) is
not a GM user. A player can still letter on their own screen: `L.play` / `L.burst` / `L.stream` / `L.sfx` are unchanged (module code
that letters game events runs them on every client itself and does not need `L.net`). The designer, "Letter this now", its key and
the token-controls button are GM only.

GM: `L.letterNow(text, opts)` shows a word to everyone at the selected tokens (one each, different hands) or at a point (`point`,
default the cursor); the keybinding "Letter this now" (Shift+L) opens a small box at the cursor for it. `L.designer({ text })`
opens the designer window (also: the burst button in the token controls); `L.openSettings()` the settings window.
`L.planFor(text, opts)` -> `{ plan, opts }`: the plan this client would show (style, settings and filters applied).

## Look (contract v8, LOOK; v9, LOOK2 1.8.0): styles, sound -> look, lines, backdrops, accent, legibility
**Styles.** Three whole hands, `L.lookStyles` = `["comic", "invincible", "expressive"]`.
- `invincible` (the book's manner, rebuilt in LOOK2 after the owner's review): tall, tight, flat lettering. Anton for every word;
  ONE ink keyline round the whole word (`hand.keyline: "union"`), each letter clipped to itself with a thin inner line where it meets
  a neighbour (no outline lies on a neighbour); a flat duplicate block down-right in one dark colour, or a straight-down solid block
  for heavy sounds; flat fills (no gradient, no soft shadow, no misregistration, no boil); hollow letters for light or airy sounds;
  11 flat palettes chosen from the sound (`invPalette`); upright letters, one size peak per word, neighbour ratio at least 0.85;
  the hyphen lead-in (KA-, RAKA-, KRA-KA-; not a rhythm like BIP-BIP-BIP, `invPrefix`) small, on the top line, tucked into the
  body; no letter under 0.82 of the word's biggest (`INV_FLOOR`); doubled O as linked ovals made from Anton's own O;
  letter spacing by pair (`kernOptical`, below). **It is the default when `game.system.id === "invincible"`.**
- `comic` (the earlier mixed hand): the default elsewhere.
- `expressive`: the look from before the Invincible pass, kept for the owner. It is the `comic` hand under its own name: the same
  plan and the same drawing for the same options (check-look2.mjs P17). If `comic` ever changes, `expressive` must keep today's look.
- Select per call with `look: { style: "invincible" }` or `style: "invincible"` (also a TOOL style name); for every later call
  `L.lookStyle("invincible" | "comic" | "expressive")`. `look` keys still win over the style (`look: { style: "invincible", font:
  "bangers" }`).

**Spacing by letter pair (invincible).** `kernOptical` (shape.mjs) runs in the settle step: for each neighbour pair it scans 40 rows
over the height both letters share, measures the horizontal gap of each row (an open row counts at most `KERN.open` = 0.12 of the
cap), and slides the right letter until the mean gap equals `hand.kern.gap` (0.04 short, 0.05, 0.06 sustained) while no row comes
closer than `KERN.touch` (-0.02: a hair of overlap under the keyline). Doubles (RR, AA) use 0.85 of the gap; a prefix overlaps the
body by `KERN.preOverlap`; linked rings keep their link distance. So AV, TA, LT, FW tuck in and HN, MN stay apart, as a letterer
spaces by eye. Vertical layouts set their own rows (`TUCK` 0.14).

**The look says the sound.** `plan.traits` names what the sound is like, read from WORD's character (`L.word(...).play.character`:
hard, heavy, wet, metal, electric, heat, texture, contour) and the plan's sound (sharp, rough, pitch, long); plain text gets its mood's.
The mapping (`traitsOf` in design.mjs, no random draws, checked over every vocabulary kind in check-look.mjs L16):

| the sound | the look | why |
|---|---|---|
| hard (crack, smash, punch, a gun) | squared heavy face, flat cut fill, deeper block; never bubble or a round face | a blow has corners |
| soft (whump, sigh, splash, whoosh) | the wide round face, two-tone, no spikes | nothing in it cuts |
| heavy (crash, boom, rumble, stomp) | a deep block straight down; perspective line in the book's hand | weight falls |
| high and slight (chime, bounce, beep) | a shallow block thrown up | it lifts off |
| metal (clang, ricochet, gun, chime) | steel blue, one flat colour, a clean edge (grinding metal keeps grit) | a hard bright ring |
| electric (zap, crackling energy) | cyan, or yellow when hot (invincible), the squared face, a straight hit line (comic hand: a jagged edge) | sparks |
| fire (fire, crackle) | amber, the line rising with the sound; warm sounds never get a cold colour | heat |
| cold (wind, chime, fizzle) | a cold colour | cold |
| wet (splash, squish, drip) | the round face, a cold colour, a wavy or shrinking line | water |
| grinding (stomp, crumble, scrape, roar) | the squared face, a deep block (comic hand: a rough edge) | grit |
| a fizzle | a sagging line, a cold colour | it fails |
| rising (power-up, roar, engine, rumble) | the line grows toward its end | it builds |
| dies away (sigh, whiff, relief, hiss) | the line shrinks | it fades |
| a fly-by (whoosh, zoom, ricochet, wind) | an arc, or a streak when it lasts | it passes |
| bouncy (bounce, laugh, splash) | a wavy line, round face | it bounces |
| short / sustained | tight / loose letter spacing | the sound's length |

Letters stay clean (the user, 2026-11-13: the flame teeth and the drips were removed): no edge ornament is chosen by default in
either style, no ember specks over held letters, Rubik Wet Paint is no longer a mood default; `look.treat: "flame" | "drip" | "jag" |
"rough"` and `look.font: "wetpaint"` remain explicit opt-ins. In the comic hand the mapping only corrects what contradicts the
sound (a swapped face keeps the recent-hands memory). A body letter never shrinks under 0.66 of the body (it would read as
lower case); the small lead-in carries the size contrast. Squada One's M and N (drawn with the arched tops of m and n) are rebuilt
in memory with square shoulders.

**Lines.** `
` stacks lines; `arrange: "line" | "stack" | "stair" | "vertical" | "auto"` (auto, the default, stacks or stairs repeated words); `plan.layout.lines`.
**Backdrops.** Opt-in per call (`backdrop: "star" | "cloud" | "oval" | "plate"`, or `true` / `"auto"` for the mood's pick); the default is none (the user's decision).
**Accent.** Letter sizes follow the sound: a small lead-in, the biggest letters where the sound peaks, a shrinking tail. WORD's
`play.accent` (one weight per character) wins; plain text gets a guess (the longest vowel run, else the last hyphen syllable, else
the penultimate syllable). `plan.accent` reports it.
**Interlocked rings.** A run of O / 0 links as true rings, each passing through the one before it (`look.link`): circles of
alternating size in `comic` / `expressive`; in `invincible` ovals of one size made from the face's own O (`ovalRing`), the block's counters kept open.
In `invincible` (LOOK3 1.9.3, the owner's rulings) linked O's stand off the line by `LINK.rise` (0.07 of the size) each: the first up,
the second down, a third up again. Two O always interlock; three only on 20 % of the seeds (the owner's ruling) (`LINK.three`, `hand.link3`);
four or more never (plain O's). A number's zeros stay level; in stepped motion linked rings shake as one piece.
**First letter, tail, holes (LOOK3).** In `invincible` the letters before the peak are as tall as the peak (`RISE`; a rising
sound keeps steps of 0.93 with the first letter as tall as the second), the tail falls 0.93 a letter, a C O S U V W X Z never steps
under its neighbour (no "cRUSH", "CRUNcH"). A source above or below (`from` 90 / -90) no longer fans or sags an invincible word, and
a union-keyline pair the reader cannot read parts by at most 0.04 cap (`UNION_PART`), so no hole opens before the last letter
("CRUS H!"). check-look3.mjs holds all three.
**Numbers.** `-1`, `+4`, `x2`, `12%` get a calm, even, untreated hand so digits and signs always read.
**Outline.** The light outer outline goes around the whole word only, never between overlapping letters; a duplicated block
(extrusion) is used more often than the outline; the outline stays a style (`look.outline: "sticker"`).
**Legibility.** legibility.mjs reads every treated letter against the font's plain letters (Polish marks and digits included:
Ł keeps its bar, Ę its ogonek, a covered 1 is caught, $ is not S, lower-case look-alikes are caught); the settle step turns,
pushes or opens letters until each reads. check-look.mjs L1-L17 hold this (ADVT and dice-review cases among them); check-look2.mjs
holds LOOK2's points (SPEC-LOOK P1-P18 as measured rules).

## Look and performance notes
- Every picture is painted from font outlines (TrueType parsed by `font.mjs`) at the pixel size it is shown at; world words re-render
  when the zoom changes a lot (x1.35 in, x0.45 out) so nothing is a small bitmap blown up. Pictures over 2048 px on a side are capped.
- A picture costs about 1-6 ms to paint (size, 3D depth and texture decide); the scheduler paints the next pictures ahead within its
  budget and paints the current one at once only when it is missing. Textures and canvases are freed when a word ends.
- Reduced motion (OS setting or `reduced: true`): one entrance picture, no shake, a two-step halftone exit.

## Fonts
Eleven SIL OFL 1.1 fonts (Bangers, Anton, Patrick Hand, Titan One, Bungee, Black Ops One, Sigmar, Knewave, Rubik Wet Paint,
Squada One, Michroma; Anton is the Invincible style's face since 1.8.0): files,
holders, sources and sizes in ATTRIBUTION.md. Knewave has no Polish letters of its own: the engine builds Ą Ć Ę Ł Ń Ś Ź Ż in memory
from its own outlines plus accents (its own Ó acute and period, a drawn Ł bar, the ogonek from a fallback font). Every font's
Polish capitals were checked by rendering them (letr gallery stills), not only by the character map.
