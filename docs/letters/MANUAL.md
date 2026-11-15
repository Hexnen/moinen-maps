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
| FONTSEL (the invincible style in two faces: League Gothic, the default, and Anton; the GM's table setting `face`; each face tuned for its own shapes; optical sizes for small pictures) | 1.9.7 | API-CONTRACT 1.9.7 (v14) | `tactics-zones-fontsel` | pending merge (sections 13, 14, 15) |
| KERNEX (punctuation never reads as a diacritic of its neighbour: a mark keeps the hand's gap from every letter beside, under or over it; at least 1.5 px in small pictures; both faces) | 1.9.8 | API-CONTRACT 1.9.8 (v15) | `tactics-zones-kernex` | pending merge (sections 13, 18) |
| KEEPBOX (impact frames: identical calls give identical pictures on every seat, also in a rapid or overlapping series, at other frame rates, with dropped frames and with a seat's private words; a kept word drawn ON the impact with a rim round its letters, no box) | 1.9.9 | API-CONTRACT 1.9.9 | `tactics-zones-keepbox` | pending merge (section 21a) |
| HOLDS (a held invincible word lives as long as it stands, in the manner of its sound: echo, settle, hum, sag, slosh, rumble, breath; inside its placement; every seat alike; still under reduced motion) | 1.9.10 | API-CONTRACT 1.9.10 (v17) | `tactics-zones-holds` | pending merge (section 11a) |
| ENGREG (plumbing: one copy rule on every seat with `L.build` / `L.seats()`; the table's own clock `L.clock` under the stepped grid and `L.net`; `ceil` reaches the size model; `L.measure`; a settle memo and faster mark rows) | 1.9.11 | API-CONTRACT 1.9.11 (v18) | `tactics-zones-engreg` | pending merge (sections 2, 5, 6, 8, 16, 17, 18, 20) |
| ENGWORDS (both deny lists over both languages: `crossRefusal`, `CROSS`; the words that read as a word of the other language replaced, pl KA-DUMP -> KA-DUUM ...) | 1.9.13 | API-CONTRACT 1.9.13 | `tactics-zones-engwords` | pending merge (sections 9, 14, 20) |
| RIMUNDER (an invincible word on the map gets an ink rim UNDER the whole lettering, letters and duplicate block; `look.rim` ink / paper / none; default ink in world space, none on the screen) | 1.9.12 | API-CONTRACT 1.9.12 | `tactics-zones-rimunder` | pending merge (sections 5, 13, 20) |
| SUSTAINGAP (a sustained sound reads as one run: phrases seated by their own measured ink, never piled; echo and shed beyond the run's edge; the run inside the view and a caller's `room`; `startAt` on every seat; stream syllables in staggered lanes; a word drawn in by parts no longer thrown away by decaying holds) | 1.9.15 | API-CONTRACT 1.9.15 | `tactics-zones-sustaingap` | pending merge (sections 10, 12, 18) |
| ENGVIEW (one table picture from the public API: an explicit `view` for sizeOf / measure / play / stream / sustain; `L.measure` stand / inkReach / ink / rim / life; `L.streamUnit`; legacy sustain on `startAt`; `L.impact.tierOf` / `stepOf` / `tiers` / `seriesBoost`; `ceilK` named as unread) | 1.9.18 | API-CONTRACT 1.9.18 (v22) | `tactics-zones-engview` | pending merge (sections 5, 6, 6a, 8, 10, 12, 18, 20) |
| ENGDROP (no bridge to plus-ultra's old mirror, no legacy settings description; migration reads plus-ultra's old copy from its document; an older plus-ultra handled; the settings window redesigned) | 1.9.19 | API-CONTRACT 1.9.19 (v23) | `tactics-zones-engdrop` | pending merge (section 15) |
| IMPACT3 (the tokens take part in the impact frames: negative, posterised, inked, own colours, lit rims on their true outline, echoes, flares; ladders rebuilt in hand-drawn timing inside the guard; `also`, `figures`, per-frame `fig` / `kick`) | 1.9.20 | API-CONTRACT 1.9.20 (v24) | `tactics-zones-impact3` | pending merge (section 21a) |
| IMPACT4 (the tokens' colours turned at their own luminance on every size and zoom: hue negative, hue cycle, duotone; a slice of the true negative along the blow; pops; the enlarged frames in the token's own art; figures follow their tokens; the strongest impacts a one-second cut, hit-stop 8, still 2 flashes) | 1.9.21 | API-CONTRACT 1.9.21 (v25) | `tactics-zones-impact4` | pending merge (section 21a) |
| ENGPINK (no colour the engine picks by itself is pink or magenta: the invincible violet blue-violet, the legacy families' pink members replaced, the colour-blind palette without reddish purple, cyan + yellow colour plates, the impact `void` tone blue-violet, computed shades kept out of the band) | 1.9.22 | API-CONTRACT 1.9.22 | `tactics-zones-engpink` | pending merge (sections 13, 14, 15, 21a) |
| WORD2, OUTL | - | - | - | planned (see "What is about to change") |

Contents
1. What LETR is
2. Getting the engine
3. Quick start
4. `L.play`: options, handle, lifecycle
5. Placing and timing words (lessons from three caller reviews)
6. Size
6a. One table picture from the public API (ENGVIEW 1.9.18)
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
copy)**. Each loaded copy registers in `globalThis.MoinenLetters` and every caller uses ONE engine instance: one font cache, one
limit on words at once, one memory of recent hands, one vocabulary. [C]

**Which copy runs (ENGREG 1.9.11, `registry.mjs`; the same rule on every seat)** [V node]:
1. The choice is made once, after Foundry's `init` (every active module's scripts are in the page then) and after every ACTIVE
   carrier's copy is registered (a missing one is imported from `modules/<id>/scripts/letters/index.mjs` next to the first copy).
   Before 1.9.11 the first caller decided: a call before `init`, or a registry object made by an older copy that loaded first, could
   fix the older engine for the whole session.
2. The highest VERSION wins; equal VERSIONs with different content: the more recently synced (`stamp.mjs` `at`, console warning);
   equal content: the canonical module's copy. Content only, so seats that loaded the same files run the same engine.
3. The page says what it runs: `L.build` (also `MoinenLetters.build`) = `{ version, hash, at, module, why, copies: [{ version, hash,
   module }] }`. At `ready` every seat sends its build to the table (a `hello` on the lettering socket; it carries no word, so a
   player may send it); the GM's seat answers a newcomer. A seat whose build differs from the GM's is named once, on the GM's seat
   and on its own (console + notification: "reload the seat with the older one"). `L.seats()` lists `[{ user, name, gm, version,
   hash, module, same }]` (`same` = the GM's build).
   During an update of ONE module the two copies differ: the newer one runs everywhere once each seat has reloaded; a seat that kept
   the old page (no reload, a cached file) is the one `L.seats()` names.
4. Code that imports single engine files from its own copy (`../letters/impact/plan.mjs`, `../letters/size.mjs`, ...) gets ITS
   copy's numbers, not the running engine's: read them from `L` (`L.sizeModel`, `L.impact.steps`) when they matter at runtime.

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

A copy registered after the engine was already created is used only after a reload (console warning); with the rule above that
happens only when a module is loaded lazily after `setup`. [C]

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

**Measure before you place (ENGREG 1.9.11)** [V node]: `const m = L.measure(text, opts)` with the SAME options you will pass to
`L.play` gives `m.hold` (the rest picture's ink box), `m.reach` (how far the entrance and hold go from the centre) and `m.box` /
`m.reachBox` round the point, in the word's own space (world units for `space: "world"`, CSS px for screen), planned with this
seat's settings. Place by `reachBox` (nothing sweeps outside it), then call `L.play(text, opts)` with the moved `at`: the settle is
reused, so measuring costs nothing extra. `L.planFor` (tools, after `setup`) still gives the raw plan; do not combine `L.sizeOf` with
`planFor` by hand (`sizeOf().size` already contains `scale`: multiplying again doubles it). `null` = lettering off on this seat.
Many words at once: 12 words measured and played in one frame cost ~20-33 ms (node; 1.9.10: 68-77 ms with sizeOf + planFor + play);
spread a crowd over two frames if it must stay under 16 ms.

**One picture for the whole table: plan on shared data, then apply a seat rule** (moinen-maps MAPSFXSEAT, 2026-11-15) [V node +
lane]. A map event (blast, fire, thunder) letters on every seat, and every seat must show the SAME words, at the same size, the same
place on the map and the same instant, and the same again on replay. Every choice made from this seat's own state breaks that. Live,
before the fix, each of these did:
- the seat's view height, zoom, panels or the count of words already alive feeding the size (a GM with panels drew a smaller word);
- placing around the seat's own view, panels and tokens (a hidden token the GM sees pushed his word elsewhere);
- planning on what arrived so far (a page planned before its burst stroke arrived, the ground read from the first entry to land);
- dropping a word that arrives late (a busy seat skipped it: the player got no blast words) or waiting on something only this seat
  sees (the fire catch waited for its flames to show here);
- gathering events by when they arrived, not when they are due (a late seat merged two moments into one).
What works (the map's `sfx-table.mjs` + `sfx-seat.mjs`, pure and tested by `dev/sfx-seat.test.mjs`):
- **plan once, from shared data only**: a reference window (1600 x 900 minus a fixed panel reserve), a reference zoom from the event's
  own size (`refZoom`: about six squares tall, at least the event), tokens whose documents are not hidden, pins every player may see,
  a ledger of the table's own words with lives on the shared clock, the shared clock itself. Size with the engine's size model fed
  that reference view (`sizeFor` from the running copy's `size.mjs`, request E3 below) and play with `fit: "world"`,
  `keepInView: false`: the size is then a world size, the same on every seat;
- **measure in cap heights**: `L.measure` divided by its unit, so this seat's `scale` setting cancels out of the placement;
- **play at the shared instant**: `startAt` = the moment on the perf clock, even in the past: a late seat joins mid-life instead of
  dropping the word; drop only when its life is over;
- **gather by due time**: chunk events from the earliest due instant, as a seat on time would;
- **then the seat layout** (MAPSFXSEAT2, `seatLayout`; it replaced the first rule, see below). The table says WHICH words, WHEN, and
  WHERE each stands against the thing it letters (its side, its gap); the seat says HOW BIG and moves only what it must:
  - *size*: the engine's own size of the word for THIS window and zoom at step 2 (the table's options and words up; a ranked word's
    request the larger of the table's and this view's share), then the step's share of it (step 3 x1.4, step 1 x0.7 over the floor).
    A seat whose window and zoom are the reference's draws the table size (STEP2); a seat zoomed closer never draws a weaker word than
    it drew before the table picture;
  - *place*: each word scaled about its point nearest its subject (it keeps its side and its gap), kept there when its INK (the hold
    box from `L.measure` plus the rim's ~0.08 cap) is off every pin and token, its box whole in the view, at most `SOFT_OK` (6 %) of its
    ink under this seat's panels / the words up with it (an edge under a panel is read; a word made smaller is weaker). Else moved the
    least: away from the thing and along it on its own side ("shift"), then the first side of the table's own order every seat shares
    ("side": two seats that both must leave agree), farther away but clean;
  - *where nothing clean holds it at its size*: smaller, the largest clean size on any side ("small"; its own side first at a size,
    then the shared order: "side"), down to the legibility floor x 1.15 (clean before big). The roomiest side is the one seats short of
    room share: live, "own side first while shrinking" kept the GM's blast word above the bomb at 155 and sent the player's below it;
    largest-on-any-side puts both under the pin, the GM's at 196 (MAPSFXSEAT2-6); a step-3 word that cannot stand clean at 1.15 x its step 2 takes the largest clean size not under
    step 2 ("full"); a step-1 word stays under 1 / 1.15 of what a step-2 word gets on this view ("yield": a seat short of room still
    draws step 1 < step 2); nothing clean at all: the least covered spot at its step's own size, never on a pin ("tight"); off this
    view (place, subject and way): not drawn ("off"). The table may put a word
    on another side at another step (the blast's word below the bomb at step 1, above it at steps 2 and 3): the step order is kept by
    these rules, not by the table;
  - *the pin a map word avoids* is the note's whole drawn box (sharedPins + pinBoxes: on The Warehouse 328 x 411 world px for a 0.6
    square icon), not the icon's size; and a player asking for zoom 0.9 there gets Foundry's largest zoom for the scene, 0.7314;
  - its own needs stay per seat: the engine's `scale` setting, reduced motion (no path), the performance mode's caps, "big only";
  - *cost*: the spots are searched nearest first (a heap, a stop at the first clean one no nearer spot can beat, at most 160 per size,
    obstacles bucketed on a grid), the sizes by a stride of four with the three between refined, and a word with no clean spot even at
    its smallest size skips straight to the least covered spot. A plain blast page (recorded panels, one pin) costs 0.9 / 1.3 / 2.1 ms
    per seat at steps 2 / 3 / 1, as before (0.4 / 1.5 / 2.3); a crowded view (40 tokens over the whole view, 6 pins) 7.7 / 11.1 / 10.8
    ms, once per page (the first rule 0.6 / 1.1 / 1.8 ms, but it covered pins and drew words smaller).
  - *a rider* (MAPRIDE, `rideLayout`: a bomb's fall, a shock wave, debris, a meteor, a crack running out) is laid out per seat too:
    before, it kept the table's way as it was ("ride") and live crossed the pin, the macro bar and the main word. Every sample of its
    way (its box at this seat's size, at the instant it passes there) must stand whole in the view, off pins and tokens (the stretch
    between samples too), at most 6 % under panels and the words up at that instant. Else the cheapest change: a wave turned out of
    the blast (22.5 degree steps; a pressure front leaves every way), the way shortened toward the end it is tied to (a fall keeps its
    end over the impact), the whole way moved the least (exact in move space, at most 8 box heights), then 0.7, 0.4 of its size;
    nothing clean: not drawn on this seat ("noroom": a supporting word, it must not cover what the table must read). Its way is
    passed to the engine as the word's `path` (`oo.path.points`).
  - *a burning fire's run* (MAPRIDE, `burnRoom`): a sustained run is ~7.8 caps tall (its two seats of phrases, one above and one
    below the source; unconstrained its shed fragments drift ~12 caps up) and it does not compress: a room shorter than the run is
    overflowed downward. The map gives every run the engine's `room` (`RUN`: 3.6 up, 4.2 down, 3.5 half-width, in caps) and
    `maxWidth` 5 caps, and keeps clear the block round it (`runReserve`: + 0.1-0.2 cap smooth, + 1.15 across / 0.3 up and down
    stepped: the boil leaves the room by that much), whole in the view, off pins, tokens, this seat's panels (no share: 6 % of a
    tall block is a whole phrase) and the runs laid out before it, at most 6 % on the table's words up and the words this seat drew
    (a run gives way to an event word: the runs are laid out again 60 ms after a word is drawn); else moved the least; else smaller
    on this seat (x0.9 steps down to its legibility floor), laid out from the lower steps up so no run is smaller at a higher step;
    else not lettered on this seat. A seat whose size for a run changes restarts it on the shared clock (`startAt`); a live run joins
    only once the seat's clock error is under 30 ms (at most 20 s after load). Before, the map reserved -3.1 .. +1.1 caps and passed
    no room: live the run stood on the macro bar and the pin and two fires lettered into each other (`dev/sfx-burn.test.mjs`,
    `sfx-seat.test.mjs` BURN).
  - *a clocked run's start*: the engine replays a clocked run's past phrases from `startAt` (at most 10 000, ~3 h, then one timer per
    past phrase): a fire painted two days before never lettered. The map's run clock is its group's start carried forward by whole
    30-minute epochs (`runClock`); every seat restarts the run at the same epoch instant.
  - *a word's life on the table* (`lifeOf`) counts the engine's own hold (`L.measure(...).plan.holdMs`) + 450 ms + 450 ms: the old
    `hold / ms + 450` ended a shock wave's life at 1.25 s while the engine kept it legible 1.9 s, and a debris word was laid onto it
    (`sfx-seat.test.mjs` LIFE). A word STOPPED early (`h.stop()`: the wave at its rim) is not gone at the stop: it plays its exit from
    there (the plan's `timeline.exit` ticks, a shock wave 542 ms, legible ~270 ms of it), so a rider's `stop` in the seat layout is the
    stop + that exit; before, a debris word starting 250 ms after the wave's stop was lettered onto it.
  - *a speed-up must not count more panel than the screen shows* (MAPRIDE): merging interface rectangles into strips over their gaps
    (12 px, up to 1.3x their area) made the seat layout cheaper but drew the player's blast word 7-10 % smaller; standing words count
    the panels exactly (merged only where the union adds nothing), only riders take the strips (`sfx-seat.test.mjs` MAINSIZE).
  - *far thunder after a storm is cleared* (MAPRIDE): the far-flash count is keyed on the storm's previous level too
    (`EV.farIndex`, window `FAR_WIN` 30 s), and a page whose flash the storm no longer holds when it draws (`flashStill`) is skipped
    on every seat; before, a seat that saw the clear first lettered a rumble the others did not.
  - *the same picture on every seat* (MAPSAME; live 2026-11-15 the blast's word stood below-left of the bomb on the GM's seat and right
    of it on the player's, the rising word and the debris words differed too, step 3 drew the size of step 2 (185 / 186 world px), and
    the player's step 1 stood on the notification bar). It supersedes "largest clean size on any side" and "the table may put a word on
    another side at another step" above:
    - the table places a page (and a moment) ONCE, at step 2's sizes (`atStep2`), and draws each word at its group's step by `restep`
      about `shrinkOnSide`: the centre keeps its share of the two half sizes (word + subject) on both axes, so the side reads the same;
      scaling about the point nearest the thing moved a word that overlaps its crater ONTO it;
    - the table chooses its main word's SIDE on shared probe seats (`mainSide`: the reference window centred on the subject at 1, 1.45
      and 2 x the reference zoom (`SIDE_PROBES`), the shared panel zones, pins and tokens): the side whose WORST probe holds the
      largest share of its step-3 size clean, an earlier side of the order within 4 % (`it.side`). The reference view alone has room
      above a blast that a closer seat has not;
    - every seat keeps every word on the table's side (`sideOfBox`; a rider's way measured with the word at its largest size, its way
      moved, turned or shortened only within that side); another side only where its own side holds nothing clean even at its floor
      ("side": 3 % of the spread's word x seat x step in node; live on the take one debris word, PFWOOOOFF, on the player at steps 2-3);
    - ONE layout per seat for all steps: a word's ENVELOPE is the largest size up to its step-3 size (`nom`) standing clean on its
      side, searched from the table's step-2 box (`box2`, `u2`); step 3 draws the envelope, step 2 its own size but at most the
      envelope / 1.15, step 1 its own but at most step 2 / 1.15, none under the floor ("room" when under its own size, "floor"),
      each inside the envelope (`shrinkOnSide` with its ink inside the envelope's ink). The words laid out after it keep off the
      envelope whatever the step. A seat short of room thus draws step 2 under its own size so that step 3 can be bigger (question
      MAPSAME-1);
    - the search: nearest first, plus a grid scan of the moves (0.05 x 0.1 of the box, `SCAN_*`) for the two sizes above the one it
      found: a spot that needs two moves at once - off the hotbar AND off the subject's allowed share - is not reached from the seeds
      (the player's blast word stood 1-2 sizes under its room). `dev/sfx-same.test.mjs` ROOM proves by brute force that no clean spot
      on its side holds a "room" word one size up;
    - cost: the table and this seat's layout are made in an idle moment ~500 ms before a page's first word (`prepPage`), not in the
      frame the word starts in (live one layout took 114 ms there); again at a word only if the view changed. Riders search the moves
      of their 10 cheapest changes (`RIDE_PAIRS`, 30 before). A crowded view (40 tokens, 6 pins) costs ~8 ms per page per seat in node
      (the trunk 9-15 ms), the take's plain views ~3 ms (GM) / ~6 ms (player);
    - a fire whose source is off this seat's view: lettered only when its run's whole block is off it too (`offSpot` "out"); a block
      reaching in ("cut") is not lettered here - live the second of two fires lettered its run in from the player's view edge.
- **what the first rule got wrong** (MAPSFXSEAT, live 2026-11-15): it scaled the whole page as ONE group about the event to fit a
  closer seat's view (`seatGroup`, k 0.6 GM / 0.4 player), then shrank it five more times by 0.9 off its panels, then stepped a word
  off a pin (`groupNudge`). A seat zoomed closer drew every word weaker (the blast's main word 203 -> 159 GM, 120 -> 111 player), step
  3 drew smaller than step 2 (bigger words, more to shrink), the group shift put the main word on the bomb's pin on one seat and on
  the other side of it on the other. Sizing by the seat and placing word by word against shared rules fixed all three; the table
  picture (words, side, instant) stays one.
Unlocated words (thunder) are laid out once in the reference window, then centred into this window and laid out the same way (this
window's own size at step 2 then the step's share, off its panels, its pins and the screen words still up on it).
A seat-rule log (`api.sfx.log()` in the map: `cap`, `rules`, `clean`, `box` per call) lets two seats be compared call by call.

**On the map, let the rim do the contrast (RIMUNDER 1.9.12).** An `invincible` world word gets an ink rim under its lettering by
default (section 13); do not add your own light outline (`look.outline: "sticker"` covers the duplicate block) or a backdrop for
contrast. Pass nothing to get it; `look: { rim: "none" }` only where a picture must stay exactly as before; `look: { rim: "paper" }`
for a word that must also stand off a dark ground; a screen word that sits over the map can ask `look: { rim: "ink" }`. The rim reaches
up to 0.07 cap (at least 2.5 px) past the letters: the hold box from `L.measure` does not include it, so leave that much air.
Since 1.9.18 read it from the engine instead: `L.measure(...).standBox` already holds the rim, keyline, duplicate block and a held
word's life, `inkReachBox` the entrance too, `m.rim` / `m.life` the numbers alone (section 6a); no copy of 0.07 / 2.5 / 16 px / 0.6
needed.

**One picture on every seat (ENGVIEW 1.9.18).** Plan where and how big on shared data, not on this seat's window: pass the table's
reference `view` to `L.sizeOf` / `L.measure` (and to `L.play` / `L.stream` / `L.sustain` when every seat should also draw that size),
`startAt` from the shared clock, and keep away from things by `m.standBox` (standing) and `m.inkReachBox` (arriving). Worked examples
and the list of what each caller may drop: section 6a.

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
  `echo` until the engine places echoes clear (REQUESTS EFFECTS1-6). From 1.9.15 (SUSTAINGAP) echo copies and shed fragments are
  placed beyond the run's edge by their own box, or left out when there is no room (section 12).
- (1.9.15) A sustained run is taller than one phrase: two seats of about 2.2 caps each plus a gap, about 4.8 caps in all (a
  phrase's measured ink, its turn and its exit included), its split line 0.8 cap above the source. A caller that reserves a box for
  the run (the map's burn offsets assume about -2.5..+0.9 em) should pass that box as `room` (extents round the source) so the run
  keeps to it, or reserve the taller box; a run taller than its room overflows downwards, never onto itself.
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

**A caller's size step** (moinen-maps SFXSIZE, 2026-11-15; the table's size sliders of the map lettering) [V node + lane, C]: to make a
group of words smaller or bigger without breaking their hierarchy, step the size the engine DRAWS the word at, not its natural size.
Trap: the engine drops a caller's `ceilK` (engine.mjs `sizeCtx` passes none to the size model, so only `L.stream`'s own share in
size.mjs exists on paper), and its clamp holds a word at its ceiling whatever its natural size: a big blast's main word stood at
0.94 x at a smaller `scale` and 1.0 x at a bigger one (live, lane 5). What works: `z = L.sizeOf(text, opts)` (today's drawn cap
height `z.px`, mood factor `z.sizeK`), step `z.px` yourself, then play with `{ ...opts, fit: "world", size: px / (z.sizeK * zoom * scale) }`
(`fit: "world"` = no second clamp; the size still follows the zoom). Keep a smaller step over the legibility floor
(`L.sizeModel`: floorVh / floorMin / floorMax / quietFloorK) and a bigger one under a cap you read from the engine: ask `L.sizeOf` for a
far too big word (`size: 20 * innerHeight / zoom, magnitude: 2, fit: "legible"`) and divide its `px` by `L.sizeModel.hardHi`: that is the
engine's own ceiling for the loudest word of THIS text on THIS screen (height, width over the word's real shape, a crowd's share).
Measure the box you place with the same options. A `fit: "screen"` word is unclamped: step its `size` and cap it the same way. `L.stream`
takes no `scale` (pass the stepped syllable unit as `size`: the engine's unit is `sizeOf(..., { fit: "world" }).natural * 0.62`) and
`L.sustain` takes `size`; both stay under the engine's clamp. At the default step pass the options untouched (the same object), so
today's words stay byte-identical (SFXSIZE proved it with a play log of every option for a fixed firing, base vs new: 8 of 8 equal).
(Engine wish, not needed for SFXSIZE: honour `ceilK` in `sizeCtx`, or give `L.sizeOf` the word's hold-box width.) Both done in
1.9.11 (below): `ceil` and `L.measure`.

**A caller's ceiling share: `ceil` (ENGREG 1.9.11)** [V node]: `ceil` (0..1] is this word's share of the engine's size ceiling (the
legible clamp's top: height, width over the word's real shape, the crowd's share), e.g. `ceil: 0.6` for a main word that must leave
room round it. It also works on `L.sizeOf`, `L.measure`, `L.stream` (per syllable) and travels with `L.net`. The older name `ceilK`
never reached the size model (`sizeCtx` passed none) and STILL does not: callers that pass it today (the map: `CEIL_K` per role,
ranked words `ceilK: 1`) draw exactly what they drew (432 role/size/zoom calls and the SFXSIZE bomb capture replayed on 1.9.10 and
1.9.11: identical sizes and plans). To make the share real, rename it to `ceil` in the call, and expect smaller words where the
clamp held them.
**ENGREG-1 (1.9.18): `ceilK` says so.** The behaviour stays (sizes as without it), but a caller who passes `ceilK` to `L.play`,
`L.sfx`, `L.sizeOf`, `L.measure`, `L.stream` or `L.sustain` now gets ONE console warning per page ("option ceilK is NOT read ...
pass `ceil`"), and `L.measure` lists it: `m.unread = ["ceilK"]`. A stream still hands its syllables its own unread share
(`ceilK: o.ceilK ?? 0.55`, never read; kept because the map's dev/sfx-size.test.mjs pins that source text) and those syllables do
not warn; a caller's own `ceilK` on `L.stream` warns once. [V node]

## 6a. One table picture from the public API (ENGVIEW 1.9.18)
Status: pending merge (`tactics-zones-engview`). [V node: `check-engview.mjs`, check.mjs section 15; headless two-seat demos]

The owner's standard: every seat sees the same picture at the same moment, and lettering never covers what it describes. A caller
plans that picture ONCE on data every seat shares (a reference window and zoom, the event's clock, the event's tokens) and asks the
engine, never a copy of its tables. 1.9.18 gives the missing pieces; each is a new option or field, so no existing call changes
(plan, draw and frame-by-frame runtime fingerprints of the callers' calls equal before and after).

**1. An explicit view (map E3).** `view: { vw, vh, zoom, alive, dpr }` on `L.sizeOf`, `L.measure`, `L.play` / `L.sfx`, `L.stream`,
`L.sustain`: the size model sizes the word for THAT view instead of this seat's window, zoom and words up. `vw` = usable width and `vh`
= height (CSS px) of the reference window, `zoom` = its canvas scale (world words), `alive` = world words already up in the shared
plan (the crowd's share; default 0), `dpr` = device pixels per CSS px for the keyline's and rim's pixel floors (default 1). A field
left out is this seat's live value, except `alive` and `dpr`. A bad field is ignored with one warning. `L.sizeOf(...).view` and
`L.measure(...).view` echo the view used. A view naming this seat's own values reproduces the call without one.
```js
const TABLE = { vw: 1600, vh: 900, zoom: 0.43, alive: plan.length };      // the map's reference view, the same on every seat
const z = L.sizeOf("KA-BOOM!", { space: "world", at, magnitude: 1.4, area: 300, seed, view: TABLE });  // same z.size on every seat
const m = L.measure("KA-BOOM!", { space: "world", at, magnitude: 1.4, area: 300, seed, view: TABLE }); // same boxes on every seat
L.play("KA-BOOM!", { space: "world", at, magnitude: 1.4, area: 300, seed, view: TABLE });  // drawn at the table's size, also when this seat zooms
```
Played with a view, a world word keeps the table's size in scene px (it no longer follows this seat's zoom for the clamp). A caller
whose rule is "each seat draws its own size" (the map since MAPSFXSEAT2) plans with the view and plays without it. Pass the event's
`area` as given: the engine's reading (a number or `{ radius }` = radius; `{ w, h }`, `{ width, height }` or bounds = half the larger
side) is what sizes the
word; a caller's own area arithmetic may differ (the map's does for `{ w, h }`). [V node: three seats 1600x900 z1 / 1366x768 z0.9 dpr 2
with 14 words up / 2560x1300 z0.25: one size, one hold box, one stand box]

**2. The standing footprint and the entrance reach (plus-ultra CALLERS-E1).** `L.measure` adds, on first read (a caller that does not
read them pays nothing; the old fields are unchanged): `stand` / `standBox` (how far the standing word's INK goes over its whole hold:
hold poses, the life of a held word, keyline, second outline, rim of a world word, duplicate block, a hold picture's backdrop or
effects), `inkReach` / `inkReachBox` (the same from the first entrance drawing on: entrance poses and travel, entrance smear, letters
drawn in from their own offsets), `ink` (cap heights of ink round the letters' box at rest), `rim` (cap heights the rim reaches past
the outline at the drawn size; 0 without one: screen words, `look.rim: "none"`, legacy styles) and `life` (`{ xy, s }` of a held word's
life, null when it has none, e.g. reduced motion). All in the word's space, from its centre, turned by `rotation`; pixel floors count at
unit x zoom x dpr (the view's, else this seat's).
```js
const m = L.measure(text, { ...opts, view: TABLE });
const keepOut = m.standBox;          // what the standing word covers: place it so this misses the token / pin
const arriving = m.inkReachBox;      // what the entrance sweeps over (a slam, a drop-in) before it stands
```
Measured against the ink each painted picture lays down (a recording context's bounds in the sprite's real transform, every frame)
for 76 words (8 texts x both faces x both motion types x world / screen, turned, zoomed, the legacy style): no hold frame's ink
outside `standBox` and no frame's ink outside `inkReachBox` by more than 2 px (the recorder's own over-estimate of mitred strokes);
median air 0.14 cap. The bare hold box `m.box` missed the standing ink for 74 of the 76. [V node]

**3. Streams honour a caller's reference size (map E4).** `L.stream` takes `view` and `scale` like a word; `L.streamUnit(opts)` names
what the syllables are played with: `{ unit, sizeOf(i, loud), fit, view }` (`unit` = `size` when given, else the engine's syllable unit:
the model's natural size x 0.62; syllable i is played with `unit x (0.85 + 0.25 loud) x (1.15 for the first)`, then clamped like a word
unless `fit: "world"`).
```js
const u = L.streamUnit({ kind: "gunfire", space: "world", at, magnitude: 0.6, area: 80, view: TABLE });
const tallest = u.sizeOf(0, 1);      // plan room with the engine's own numbers (no 0.62 / 0.85 / 1.15 copies)
L.stream({ kind: "gunfire", lang, space: "world", at, beats, magnitude: 0.6, area: 80, view: TABLE, seed, startAt });
```
Lanes (staggered syllables) still use this seat's view rect unless `keepInView: false`. [V node: same syllable sizes on three seats;
`scale: 0.5` gives each syllable what `L.sizeOf` gives that word with the same options]

**4. A lasting sound on the event's clock (map E2).** `startAt` (this page's time of the event's start, e.g. `L.clock.toPage(serverMs)`)
now works in every style: the legacy `comic` / `expressive` sustain decides each phrase from the seed at its own instant too (it had
no clock). A seat joining late decides the phrases it missed (the same seeded choices, not drawn) and joins the one still up; from the
first phrase that starts after it joined it shows the same phrases at the same places as a seat on time (with `view`: the same sizes;
positions within a device pixel). A `level` function is called with the phrase's age in ms since `startAt`: read that argument (`level:
(ms) => fire.levelAt(start + ms)`), not "now". In the node runs a level reading "now" gave the same words (the run's timing comes from
the sound's flow, and a missed phrase is not drawn), but only the argument is the same number on every seat.
```js
const startAt = L.clock.toPage(event.serverStart);
const run = L.sustain({ kind: "fire", lang, space: "world", at, seed: event.id, startAt, view: TABLE, level: (ms) => event.levelAt(ms) });
```
The phrase a seat on time is already fading out when the late seat joins is not drawn there (the first ~150 ms after joining may lack
one fading word). [V node: invincible, comic, expressive; two seats, page clocks 2.64 s apart, other windows and zooms]
**Live (lane 5, 2026-11-15)**: GM seat at zoom 0.5 starts an invincible and a comic fire on `startAt` from `L.clock` with the table's
view; a player's page reloads and joins 9.2 s into the event at zoom 0.8 with the same call: 78 of 83 paired instants (250 ms apart,
pairs at most 40 ms apart) showed the same phrases in both runs, every one at the same size, 77 of 78 within 12 scene px (words move
between the paired instants); the 5 others differ only by a word crossing half opacity. **Trap: wait for a settled clock.** Right after
a page load `L.clock.ready()` can be true with `L.clock.error()` ~280 ms (the first pings answered slowly while the page loaded); a
`startAt` taken then keeps that error for the whole run (first live try: the late seat ran 280 ms behind, constant, every phrase
the same otherwise). Take `startAt` when `L.clock.error()` is small (e.g. under 15 ms; it took ~5 s after the load here), or take it
again and restart the run once it is.

**5. The impact's strength ladders (plus-ultra `tierOf`).** `L.impact.tierOf(m)` (0..3 at `L.impact.tiers` = [0.35, 0.85, 1.35]),
`L.impact.stepOf(m)` (0..5 at `L.impact.steps`), `L.impact.seriesBoost(n)`. A plan's tier is `tierOf(min(2, magnitude +
seriesBoost(series)))`, the same as `L.impact.plan(...).tier` for every magnitude 0..2 and series 0 / 1 / 3. [V node]
```js
const tier = L.impact.tierOf(Math.min(2, mag + L.impact.seriesBoost(series)));   // no hand copy of 0.35 / 0.85 / 1.35
```

**6. What each caller may drop or pass (not done in the callers: their own branches).**
| caller | today | with 1.9.18 |
|---|---|---|
| map sfx-seat.mjs / sfx.mjs | imports the running copy's `size.mjs` through `MoinenLetters.copies` (`refSize`, `engineSizeFor`) | `L.sizeOf` / `L.measure` with `view` (drop the import) |
| map sfx-size.mjs | `STREAM_UNIT` 0.62, `STREAM_CEIL` 0.55 mirrors | `L.streamUnit(...)`; drop `STREAM_CEIL` (never read); pass `ceil` for a share |
| map startBurn | `L.sustain` without `startAt`, `level: () => p.level(sharedNow())` | pass `startAt` and `view`; read the level's ms argument |
| map playStream | `L.stream` with `startAt`, `beats` | add `view` (and `scale` if it steps sizes) |
| map ranked / role words | `ceilK` | rename to `ceil` to make the share real (sizes change), or drop it (nothing changes, no warning) |
| plus-ultra tokenreact/pure.mjs `STAND`, `standPad`; splash/letter-plan.mjs `STAND`, `roomOf` | mirrors of LIFE_REACH, INV_RIM, keyline | `m.standBox` / `m.stand`, `m.inkReachBox`, `m.rim`, `m.life`; check-callers sections I / K / W / M then pin nothing |
| plus-ultra splash/impact-plan.mjs `tierOf` | hand copy of the thresholds | `L.impact.tierOf` / `tiers` / `seriesBoost` |
The engine's stand includes the duplicate block and a hold picture's extras, which plus-ultra's mirror leaves out: a caller switching
to `m.standBox` places with slightly larger boxes (a caller's picture change, made on the caller's branch).

**The table's size, not the seat's** (moinen-maps MAPSFXSEAT, 2026-11-15) [V node + lane]: the engine sizes a word for the view it
runs in, so the same call gives different sizes on a 1366 x 768 laptop at zoom 1.35 and a 1920 x 1080 GM screen at zoom 0.62 with
panels. When every seat must show one picture, compute the size once from a reference view (`sizeFor(sizeModel, { ...opts, vw, vh,
zoom, alive })` on 1600 x 900, a reference zoom, the table's alive count) and pass it with `fit: "world"`. Proof that nothing changes
where nothing was wrong: on a seat equal to the reference (1600 x 900, the reference zoom, nothing alive) the table size equals
`L.sizeOf` exactly (`dev/sfx-seat.test.mjs` STEP2). MAPSFXSEAT2: the table size plans the picture; each seat DRAWS the size the
engine gives its own window and zoom at step 2, then the step's share (section 5, the seat layout): a common world size made every
seat zoomed closer than the reference draw weaker words, and step 3 fitted to a small view drew smaller than step 2.
**A bigger step needs no loud ceiling once a layout holds it** (MAPSFXSEAT2): step 3 under the engine's loudest ceiling (sfx-size
`bigPx`) is no bigger for a word already at it (a blast's main word: 282.5 -> 284.2 live); with a layout that keeps it whole and clean
on each view, step 3 = 1.4 x step 2 and the view decides how much of that it can show.
**The reach is measured, not a factor**: since 1.9.10 a held word moves while it stands, so the entrance factors of "A caller's fit"
below went stale (a debris pop reached 1.14 x 1.18 of its box, over its 1.15). Take the reach from `L.measure` and fit
`max(1, reach width / box width, reach height / box height)`; keep a factor only for an engine without `L.measure`.

**A caller's fit: place a word by the box the engine will draw** (moinen-maps THUNDERFIT, 2026-11-15) [V node + lane, C]: a placement
that boxes a word by a share of its text length (`0.8 x chars + 0.6` cap heights) is wrong by up to 2 x for the invincible style (League
Gothic is narrow): live the close strike's KRA-KA-GRRRRRAWOOM!! got a box twice its real width at one moment and ran off the window and
under the panels at another, because the screen word was drawn at its rank's share of the view height (`fit: "screen"`, unclamped)
while its spot was clamped by the box of the WORLD word (engine-clamped). What works:
- the real box: `L.planFor(text, opts).plan` (installed by the tools at setup; absent in node and if the tools did not install: then
  `L._plan` + `L._settle`), `plan._holdBox` {w, h} in drawn cap heights (the engine's size x `plan.sizeK`), times `L.sizeOf(text,
  opts).size x sizeK` = the drawn cap height (`size` already includes the `scale` setting: do not multiply by `L.prefs.scale` again);
- room for the entrance: the engine keeps the word's REACH in the view (`keepInView`, reach = the track's reach + 0.18 units), and the
  reach is wider than the hold box: measured over the map's words, the reach of a slam's contact pose is up to 1.33 x the box (hold box
  x 1.08 + 0.3 cap wide, x 1.12 + 0.25 cap tall), a rise up to 1.37 x its height, the others up to 1.13 x. A word fitted by its box
  alone next to the view edge is pushed back by the engine onto what it was placed off: fit the box x that reach factor into the view;
- a `fit: "screen"` word has no width ceiling: make it smaller yourself when its reach is wider than the view (or the free stretch
  between the panels), and only then.

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
- (1.9.18) A seat-equal plan: size and measure with an explicit `view` (the table's reference window and zoom, the plan's own count of
  words up), time with `startAt` from the shared clock (`L.clock.toPage(serverMs)`), pass a `level` that reads its ms argument. Worked
  examples in section 6a. [V node]
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
- **The table's clock `L.clock` (ENGREG 1.9.11, `clock.mjs`)** [V node]: the engine's own NTP-style clock on Foundry's "time" socket
  (no other module needed): a burst of six pings at `ready`, one every 10 s, a burst again when the tab becomes visible; the offset
  of the FASTEST answer among the last two minutes is kept (half its round trip bounds the error: ~1 ms on a local server). An answer
  that cannot agree with the kept one (server restarted, tab slept, clock jumped) starts the estimate again; a page clock that stood
  still against the wall clock (> 50 ms) is corrected at once. `L.clock.now()` (server ms), `toPage(serverMs)` (this page's
  `performance.now()`: what `startAt` / `blowAt` take), `toServer(pageMs)`, `offset()`, `error()` (ms), `ready()`, `state()`.
  It drives the stepped grid (`L.gridClock`'s default) and `L.net.sharedNow()`. Before it: Foundry's `game.time.serverTime`
  (Cristian's algorithm on `Date.now()`, the mean of the last four pings, every 30 s): one late answer moved a seat by tens of ms for
  30 s (node: a seat with one 60 ms answer was 52 ms off; now every seat within 1 ms). Values are on the server's clock (counted from
  the server's start, like `serverTime`), never epoch ms. plus-ultra's `scripts/shared-clock.mjs` is the same method; a caller that
  drives `L.gridClock` with it keeps working.
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
- Both languages read every word (1.9.13 ENGWORDS): a table reads Polish and English, so a built-in word must not be a word or a
  near-word of the OTHER language either. `crossRefusal(word, lang, { kind })` (exported by `words.mjs`, next to `refusal` and
  `sayable`) reads a word with the other language's deny list: the literal spelling and the Polish SZ read as the English SH (and
  back). It passes the word's own ICONIC / ALLOW syllables (the owner's picks: KA-KROOSH, KLANG, BOOM, KROOM), the reader's ICONIC (and
  VOICE in voice kinds) and `CROSS`, the readings a reviewer read and kept, each with its reason (the owner rules on that list).
  check-words section 22 reads every word the vocabulary makes (banks, variant rows, every tier, stretch, prefix, material, fire row,
  flows, series, stream syllables, chains) [V node]. Callers that letter their own sound words should check them with both `refusal`
  and `crossRefusal`. `L.vocab.add` still runs only the own-language refusal (question ENGWORDS-3).
- Words replaced by ENGWORDS (the only pictures that change; every other kind, tier, seed and material letters the same text, proved
  by a full vocabulary dump and plan + draw fingerprints): pl `thud` (the hero going down) m TUMP, GDUMP -> DUUM, TUUMF and l GDUMMP,
  KA-DUMP -> GDRUUMF, KA-DUUM (the owner's landing word DUUM, like the English THOOM / KA-THOOM); pl `punch` m TWAK -> TWUP, l TWAKK ->
  TWAPP; pl `slash` l SWISZK -> SZNIKKT; pl `bite` s SZNAP -> CZNAP; pl `bounce` m BOINNG -> BOJOINNG; pl `splash` l SPLASZ -> GLOOSZ;
  pl `chime` m TINNG -> DZWINNG; pl `sigh` s HAH… -> FHUU…, m HUUH… -> HUUHF…; pl `cheer` s UUH -> WUUA; pl `meow` s MIII -> MNIII;
  en `rifle` s PTAK -> KPAK; en `impact` stone s PTAK -> KPAK, m PTAKT -> KPAKT, flesh m SHTUK -> SHWUK; en `gunfire` BUDDA -> DAKKA (s, m,
  stream); en `rumble` m GRROMM -> HRROMM, l GRRRROMM -> HRRRROMM; en `storm` l KRA-KA-GRROOMM -> KRA-KA-HRROOMM (and the flows and
  mixes built from them: tornado). The owner may veto any of them (question ENGWORDS-1).

### 9a. Material, fire ladder, tails and chains (1.7.1 KINDS1)
Status: new, on branch `tactics-zones-kinds1` [V node: check-words section 20].
- New kinds: `shockwave` (pressure wave: HWUUUMMF / VWOOOMMF), `sonicboom` (KDAKUUM / KDAKOOM), `concussion` (a blast WITHOUT fire:
  KRUUM / KROOM, the owner's pick; BOOM / BUM only for blasts with fire), `impact` (a bullet or a blow landing; group `impact`),
  `debris` (falling pieces, repeats its last syllable for more pieces), `whizz` (a near miss), `casings` (brass on the floor),
  `dryfire` (an empty click), and `grenade` now has its own dry frag words (KDUMF, PDOOMF) instead of the boom's.
- BOOM / BUM only for a blast with fire (1.9.5 WORDS3) [V]: only the kinds in `FIRE_BLASTS` (today `boom`) may letter BOOM / BUM
  in any spelling (KA-BOOOM, KRA-KA-BUUUM); every other kind, its variant rows, lead-ins and flows never do (check-words section
  21). Thunder (`thunder`, and `storm` sharing its quiet and normal words): en BRRMM / KRMMM -> KRAKOOM / KRAGOOM ->
  KRA-KA-GRRAWOOM / KRA-KA-KRRAWOOM, pl BRRMM / KRRMM -> KRAKUUM / KRAGUUM -> KRA-KA-GRRAWUUM / KRA-KA-KRRAWUUM: the lightning's
  crack, then a low roll whose R stretches with length (KRA-KA-GRRRRRRAWOOM!!). It borrows no other event's fixed word: hero
  landing THOOM / DUUM, cave-in BTHOOM / BDUUM, fireless blast KROOM / KRUUM. Far thunder in the map is the `rumble` kind.
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
  syllables, `s.emitted` counts all [V]. A stream whose source token goes away stops.
- Lanes (1.9.15 SUSTAINGAP, invincible style; the legacy styles unchanged) [V node, check-sustain 7]: syllables up at once never
  pile. Each takes the lowest lane free on the stream's own schedule (a late seat puts it in the same lane); the lanes stand in two
  staggered columns along `dir`, a step apart by the biggest syllable's ink plus its travel (default `travel` 0.45 cap in lanes),
  with no alternating spread or side jitter; with the view kept (default) the rows go forward as far as the view reaches, then on
  behind the source. Before, a gun's rounds piled 95-100 % on each other (all born at one spot, life 340 ms, every 110 ms). `L.stopAll()` and (world) a scene change stop
  it.
- (1.9.18 ENGVIEW) `view` and `scale` are honoured as for a word (every seat's syllables the same size with one `view`); a caller that
  plans room asks `L.streamUnit(opts)` -> `{ unit, sizeOf(i, loud), fit, view }` instead of copying 0.62 / 0.85 / 1.15. `ceil` is passed
  to every syllable; `ceilK` is not read (one warning when a caller passes it). Example in section 6a. [V node]

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
- **A held word lives as long as it stands** (1.9.10 HOLDS, `tactics-zones-holds`; [V] `check-holds.mjs` node + fake browser; seen
  on offline films and a live two-seat take, see the contract). Cause of the dead holds (ADVX 11): a hit's hold envelope (recoil,
  rattle, ring, wobble) is the SOUND's body and decays within the sound's own length (`plan.motion.bodyMs`, 260-1100 ms); the
  engine's old breathing layer skips track words; and callers keep words up far longer to be read (token reactions pass `hold`
  1000-1500 ms and pin rattle / wobble), so the rest of the hold stood still (THROOMF! ~1.3 s unchanged). Now the decaying holds
  (`recoil rattle ring wobble still roll arc sputter`) carry a life chosen by the sound family (`LIFE` in `motion.mjs`):
  | life | families | what it does |
  |---|---|---|
  | `echo` | dry hits, series | small sharp echoes of the hit (30 ms rise) every ~0.66 s over a slow push and give |
  | `settle` | heavy hits, crash, crumble (token knock-down) | dull aftershocks that squash the word onto its base (~0.6 s), a slow list |
  | `hum` | ringing metal, electric | width and height breathe against each other (0.7 s) |
  | `sag` | breaks | the cracked word leans as it gives, creaks round the lean, a piece shifts now and then |
  | `slosh` | water | height and width slosh (0.64 s) |
  | `rumble` | booms (thunder's roll) | a low ~4.5 Hz tremor, swelling and easing |
  | `breath` | the rest | a slow swell and bob (1.2 s) |
  Timing: the life starts at half the body (or when a short hold pinned on a long sound is spent: recoil 220, rattle 340, wobble 520
  ms), shows only partly inside the body (`LIFE_EARLY`, so a hit's envelope still falls) and fully once the body is over; a `still`
  hold gets it at once. Limits [V]: inside `LIFE_REACH` (0.05 cap heights, 4.5 % scale, 0.03 rad) of the rest pose, and
  `trackReach` (keepInView) covers it, so a caller's placement holds; no corner moves over 0.02 cap heights per 60 fps frame; no
  1.5-3 s hold of any kind x pinned hold stands still over 480 ms (1 px at a 150 px cap). Same on every seat: a function of the plan
  and the word's age only (two fake seats at 60 / 144 fps, other clock origins: same poses). Reduced motion: no life (still);
  stream syllables: none; legacy styles: untouched (no track). Stepped: the life's scale / squash / turn are read on the shared grid
  of twos like every hold channel (checked), translation smooth. Cost: 40 standing words 0.01 ms of pose per frame, no painting.

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
- **The run's layout (1.9.15 SUSTAINGAP, invincible style; the legacy styles keep the 1.9.14 sustain)** [V node, `check-sustain.mjs`; live on lane 5: a painted fire on The Warehouse, GM seat, 60 fps]:
  the cause of the piles (THUNDERFIT-E1): 1.9.14 seated the two seats 1.15 em apart (+0.1 / -1.05 em, `em` = the size before the
  cap factor) while a phrase's drawn ink is about 2.2 caps tall (hold box, entrance growth, keyline, rim, duplicate block, a few
  degrees of turn on a wide word); shed fragments of a one-syllable word were whole-word copies piling at the path's end, echo
  copies sat on the phrase, crumble pieces of the upper seat fell through the lower one. Measured: 65-100 % overlap between two
  legible phrases on 1.9.14, at most 4 % on 1.9.15 (both faces, smooth and stepped, 41 / 58 / 82 px, all 58 sustained kinds).
  Now: each phrase is seated by its own measured ink box (engine `inkBoxOf`: entrance, hold and turns over its whole hold, keyline,
  rim, duplicate block, the picture's own margin, and how far its exit moves it while still legible), in two seats round a split
  line 0.8 cap above the source, 0.14 cap apart; in the upper seat a drawn shards / crumble exit becomes a cut. Echo copies and shed
  fragments (one per syllable; a one-syllable word sheds its tail) go beyond the run's edge on the `dir` side, each by its own box,
  and are left out when the room has no space. Options: `room` (extents `{ up, down, left, right }` round the source, a rect, or a
  function) and the view (unless `keepInView: false`) bound the run, moved as one block; `maxWidth` goes to each phrase; `startAt`
  runs the score on the event's clock (a seat joining late shows the same phrase at the same place at the same instant; every draw
  comes from the seed and the phrase index, and the layout reads only the phrases up). Cost: no rise measured (40 sustains + 10
  streams, fake browser, medians equal or lower).
- **`startAt` in the legacy styles and `view` (1.9.18 ENGVIEW)** [V node, check-engview]: the frozen `comic` / `expressive` sustain
  (sustain-legacy.mjs) joins the event's clock too when `startAt` is given: every phrase's choices are drawn at its own instant in
  one fixed order and spaced by the phrase's own size (`size`, else 1.6 units), so a late seat skips the past phrases without
  drawing them and shows the same ones after; without `startAt` it is the 1.9.14 run, unchanged. `view` and `ceil` go to every
  phrase in both runs (sizes equal across seats; without a view a legacy phrase's size follows the words this seat has up). A
  `level` function gets the phrase's age in ms since `startAt`. Example in section 6a.
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
  - **Face** (FONTSEL 1.9.7, the owner: «Niech będą do wyboru ten teraz i jako default Gothic»): ONE tall narrow face for every
    word, chosen for the table: **League Gothic** (default; the League of Moveable Type, static Regular) or **Anton** (the face of
    LOOK2/LOOK3). The GM picks it in the settings window (world setting `face`, section 15); a script uses `L.invFace("league" |
    "anton")`, `L.invFaces`; a call's `look: { face }` wins; `look.font` still wins over both (P1, P14). The legacy styles keep
    their own faces. If a face's file fails to load the other one is used. [V] `check-fontsel.mjs`.
  - **Each face is tuned for its own shapes** (`INV_TUNE` in design.mjs). Anton keeps LOOK2/LOOK3's numbers exactly (its plans
    and drawings are unchanged: 3078 fingerprints of `comic`, `expressive` and `invincible` + `face: "anton"` equal to 1.9.6).
    League Gothic's stem is 0.147 cap (Anton 0.193) and a word comes out about 0.8 as wide, so: optical gap 0.032 / 0.04 / 0.048
    cap (short / other / sustained sound; Anton 0.04 / 0.05 / 0.06, the same gap-to-stem proportion), keyline `inkW` 0.014 (0.016),
    an open letter's rim 0.04 (0.05), lead-in 0.36-0.42 of the body (0.32-0.38; still under P7's 0.42); a number's sign is the face's
    minus U+2212 (its hyphen is a short dash beside a digit; the word stays "-7"); in the vertical column a "!" / "?" stands at the
    optical gap from its letter (the advance boxes left League Gothic's "!" hanging away from a K). All [V] `check-fontsel.mjs`;
    LOOK2's and LOOK3's checks run for BOTH faces.
  - **Optical sizes** (League Gothic, `INV_TUNE.league.small`; `shape.mjs opticalSize`): a picture painted small gets what a
    letterer gives small lettering. Below a stem of 6.5 px a letter's outline grows on every side (up to 0.02 cap: League Gothic at
    24-36 px is then as heavy as Anton), and the letters move apart by what each PAIR lost at its closest row, so no gap closes; a
    lead-in smaller than 14 px is drawn up to 1.5x bigger, grown from the end of its hyphen on the body's top line, so it stays
    tucked. Above about 45 px the picture is exactly the plan (checked at 160 px). Only the drawing changes: the plan, its
    letter sizes and every plan-level check stay as they are. [V] `check-fontsel.mjs` (stems at 18/24/30 px, gaps at 20 px, lead-in
    height, top line and tuck at 14/20/26 px).
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
    violet, stone; `invPalette(mood, character, traits)`); no palette serves more than a quarter of the kinds (P11). Since 1.9.22
    (ENGPINK, the owner: no pink lettering) `violet` (power, mind: psychic, cheer) is blue-violet #7258ff on #1e1258 (was #b36dff on
    #2b0c5a, inside the pink band).
  - **No pink** (1.9.22, ENGPINK): no colour the engine picks by itself lies in the pink band the callers measure (`PINK` in
    design.mjs: OKLCH hue 290..360 or 0..15, chroma >= 0.04, lightness >= 0.3; `isPink(hex)`): the INV and legacy COLORS tables, the
    colour-blind palette (`CVD`: pop / beast / plasma Okabe-Ito bluish green #009e73, bruise blue-violet #8680dc; the set's reddish
    purple is not used) and every shade the painter computes (hue jitter, per-letter colours `recolor`, rainbow and sweep fills, a
    backdrop's opposite hue, the block's shading: `unpinkHsl` turns a colour that would land in the band by the smallest step out of
    it; any other colour is written exactly as before). The legacy colour plates are cyan and yellow (the magenta plate was pink on
    every zap word). A caller's own `colors`, `hand.pal` or registered palette is the caller's and stays as given (shades derived from
    a pink colour the caller chose stay pink). The impact frames' `void` tone (a villain's roll in plus-ultra) is blue-violet #7258ff (was #b04cff) and the chromatic split's guarded red plate #c83a34 (was #d0306a); a token's own art turned by `n` / `h` / `d` keeps whatever hues it gets (section 21a).
    `check-pink.mjs` pins it (the band, every table colour, the computed shades, the replaced families still apart for normal, protan,
    deutan and tritan eyes, and on the fake browser every kind x style x table palette painted on a recording context).
  - **Spacing by letter pair**: `kernOptical` measures each pair's gap row by row over their common height and sets the mean gap to
    `hand.kern.gap` (Anton 0.04-0.06 of the cap, League Gothic 0.032-0.048); no row comes closer than `KERN.touch`; doubles (AA, RR)
    a little tighter; AV / TA / LT end up tighter than HN; vertical layouts are skipped except a row's mark in League Gothic (P18,
    FONTSEL).
  - **Marks never read as diacritics** (KERNEX 1.9.8, `shape.mjs settleMarks`, [V] `check-marks.mjs`): in Polish a mark at a letter
    changes the letter (a dot under E's foot = Ę, a hyphen into an L's stem = Ł, a dot over a Z = Ż). The optical spacing above set
    a mark like a letter: it counted the mark's empty rows (between the bar and the dot of "!") and the letter's open side as air
    and let the closest row touch, and the union keyline then made the touching mark part of the letter ("ZBURZENIE!" read
    "ZBURZENIĘ!"; in 1.9.7 a "!" overlapped about 300 of 855 letter pairs by up to 0.02 cap, in both faces). Now every mark (`! ?
    . , : ;`, the hyphen, the minus) keeps at least the hand's gap (`hand.kern.gap`) from each letter of its word: beside the letter
    row by row (it may still tuck into an open side), above or below it (up to 0.3 cap) from the letter's whole width; measured on
    the hold picture in the letter's own frame (lean included), the mark moves away along the line only as far as needed (every "!"
    then stands exactly at the gap at its closest row). In the vertical column it also clears the letter of the row above (the rows
    tuck). In small pictures a mark stands at least `MARK.px` (1.5 px) clear where it shares rows with its letter (the mark slides
    out, the letters stay; 1.9.7 at 26 px: fused, down to -1 px). Kept as they were: the tucked lead-in's hyphen under the first
    body letter (P7, the owner's prefix) and mark-to-mark pairs ("!!", "?!"). The legacy styles do not run it (frozen).
    Anton's frozen fingerprint changes on purpose (the owner wanted the defect gone in both faces): 624 of 1026 `invincible` +
    `face: "anton"` fingerprints differ, every one a word with a mark (none of the words without one); `comic` / `expressive`: 0 of
    2052 differ. 1.9.7 fails `check-marks.mjs` (22 of 26 checks).
  - **Rim under the lettering on the map** (RIMUNDER 1.9.12, `look.rim`, [V] `check-rim.mjs`, renders and lane 5 live): ADVX 18 found a
    word lettered on the MAP lost among the map's own drawings (low contrast on mid, bright and busy ground, under rain and fire
    glow). The old opt-in light outline (`look.outline: "sticker"`) is stroked OVER the coloured duplicate block, which vanishes
    (MAPSEAT's renders), so it is not the fix. A letterer's answer is the holding line: a rim round the WHOLE lettering, the letters
    and their duplicate block together, painted UNDER them. It follows the outer outlines only (round joins; an O's hole and an A's
    eye keep showing the ground), sweeps along the block's offset in one stroke, and starts where the keyline ends.
    `look.rim: "ink"` (0.07 cap, at least 2.5 px, at most 16 px): an ink rim. It adapts to the ground by itself: on a dark floor ink
    on dark is next to invisible (today's look), on bright, mid, busy or fire-lit ground it is the black edge that separates the word.
    `look.rim: "paper"` (a paper band 0.05 cap, 2-12 px, with an ink line 0.022 cap, 1.25-4 px, round it; the knock-out of the impact
    frames' kept word): opt-in for a word that must also stand off a dark ground; with the style's white or pale faces the letters
    merge into the paper (renders), so it suits dark-faced words better. `look.rim: "none"` (or `false`): today's picture.
    **Default** (`"auto"` or not given): `"ink"` for a word in world space (`space: "world"`, every world layer, the default
    `overlay` included) without a backdrop; `"none"` on the screen layer. Not on a MOVE echo; the legacy styles ignore the option.
    Which calls change: only `invincible` words with `space: "world"` (no `look.rim`, no backdrop): every picture of the word
    (entrance, hold, exit, both faces, both motion types, reduced too) gets the rim, the picture grows by the rim's reach and
    `plan.hand.halo` = `"ink"` is the only plan field added (letters, sizes, layout, timing unchanged). Proof (5610 plan + draw-log
    fingerprints: comic / expressive / invincible league smooth / anton stepped / league stepped x 11 texts x every mood x
    variants incl. `space: "world"`, `"screen"`, none, reduced, plus every vocabulary kind in two languages): 1314 differ, all of
    them `invincible` + `space: "world"`, 0 of 4296 others; `check-rim.mjs` also shows a world word with `rim: "none"` drawing exactly
    the screen word's plan and draw log. Cost: one stroke per band per picture; lane 5, 48 world words standing at once, recorder
    clock off, 3 runs each: no frame over 25 ms with or without the rim (p99 16.8 ms both); a hold picture paints 0.05-0.2 ms slower
    (0.29-0.45 -> 0.34-0.64 ms) and has 8-13 % more pixels.
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
- **Fonts**: twelve SIL OFL 1.1 faces (Bangers, Anton, Patrick Hand, Titan One, Bungee, Black Ops One, Sigmar, Knewave, Rubik Wet
  Paint, Squada One, Michroma, League Gothic); Polish capitals synthesised where a font lacks them. `L.registerFont` adds one
  (section 15). LOOK2 chose Anton from the bundled faces; FONTSEL (1.9.7) added League Gothic after the owner compared candidates
  and allowed downloading free-licence fonts: the static Regular from the upstream repository (the variable Google Fonts file keeps
  overlapping contours, which show as seams under the keyline; checked: no glyph of either face has crossing contours), sha256 and
  source in `scripts/letters/ATTRIBUTION.md`.
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
| 2026-11-13 | A prefix is the sound's own lead-in (KA-BUM, KRA-KA-GRRAWOOM), never another sound's signature (no gun rattle before a bomb) | - | every lead-in comes from `PREFIXES` |
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
| 2026-11-14 | The invincible style's face: two to choose from, the current one (Anton) and League Gothic; League Gothic the default («Niech będą do wyboru ten teraz i jako default Gothic») | nothing; a call may pin `look: { face }` | done (FONTSEL 1.9.7: `INV_FACES`, `DEFAULT_FACE`, own tuning per face). Who sets it was not said: provisionally the GM for the table like the motion type (world setting `face`; question FONTSEL-1) |
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
| 2026-11-13 | BOOM / BUM only for a blast WITH fire; a blast without fire is KROOM / KRUUM; a hero landing THOOM / DUUM; a cave-in BTHOOM / BDUUM | use `concussion` for a fireless blast, `boom` only with fire | keep `FIRE_BLASTS`; check-words section 21 |
| 2026-11-15 | (ENGWORDS, derived from the rulings above, not a new ruling) "No dictionary words, no near-words" holds in BOTH languages: a Polish word must not be an English word (KA-DUMP), an English word not a Polish one (PTAK); the hero going down letters the landing word (THOOM / DUUM) | check your own sound words with `refusal` AND `crossRefusal` | `crossRefusal` over every produced word (check-words section 22); a kept cross reading goes on `CROSS` with its reason for the owner |
| 2026-11-14 | Thunder must not contain BOOM («zmienić») | letter thunder with the `thunder` kind, never a literal word | thunder KRAKOOM / KRA-KA-GRRAWOOM (pl KRAKUUM / KRA-KA-GRRAWUUM), done in 1.9.5 WORDS3 |
| 2026-11-15 | EVERY option is chosen by the GM for the table («wszystko mg wybiera dla stołu. wszystko»): world scope, players read-only, live | a new option is born world-scoped; no client setting of your own (OS reduced motion / photosensitivity still honoured per seat) | the same for engine settings |
| 2026-11-15 | No pink lettering: «Haymaker, to chyba opis z fighting? Jest różowy. Nie chcę żeby najczęstsze napisy były różowe» (I do not want the most common lettering to be pink); the caller side (PALETTE-1, provisional) then took pink out everywhere | keep your own colours out of the band (plus-ultra `letter-colors.mjs` `isPink`, `sweep-checks/palette.mjs`) and ship your own colour-blind variants | no engine table colour or computed shade in the band (`PINK`, `isPink`, `unpinkHsl`, `check-pink.mjs`; ENGPINK 1.9.22) |
| 2026-11-15 | The map's destruction lettering gets a size slider: 0 = none, 1, 2 = today's size (default), 3 («aktualna wielkość to 2. dodaj też 1 i 3», «0 to brak»); fire and weather lettering the same, as separate sliders («też z pogody i ognia. mogą być osobne») | step the size through the engine's own options (section 6, "A caller's size step"); at the default pass the options untouched | nothing (callers step the drawn size: `L.sizeOf` + `fit: "world"`, section 6); done in moinen-maps SFXSIZE (`scripts/sfx/sfx-size.mjs`, settings `sfxSizeDestruction` / `sfxSizeFire` / `sfxSizeWeather`) |

## 15. Tools: settings, authoring, designer, accessibility
Status: stable (TOOL, contract v6). [V] where marked, else [C].

Registered once at `init` by the newest copy, whichever module(s) are active.

**Table settings** (1.9.16 ENGTABLE, owner's ruling «wszystko mg wybiera dla stołu»: every preference is the TABLE's: world scope,
written only by the GM, applied live on every seat on its next word without a reload; namespace `moinen-letters`; the button
"Lettering settings" in the host module's settings tab opens the engine's window; `L.table` = the table's values, `L.seat` = this
screen's own signals, `L.prefs` / `L.settings()` = what THIS seat draws with; `L.setTable(partial)` writes (GM) [V node, check-table]):

| key | stored in | values | effect on every word |
|---|---|---|---|
| `enabled` | `table` | on / off | off: `play` returns a handle already over; streams draw nothing |
| `scale` | `table` | 0.5-2.5 | size multiplier after the legibility clamp |
| `motion` | `table` | auto ("Full") / gentle / reduced | the strongest reduction of caller, table and the seat's OS wins; gentle = moves damped to 45 %, no smears; an old stored `full` reads as `auto` |
| `flashes` | `table` | on / off | the one-tick flash frame; a seat in Foundry's photosensitive mode (`core.photosensitiveMode`) never gets it, whatever the table says |
| `impact` | `table` | full (default) / local / off | impact frames (`L.impact`, section 21a); a photosensitive seat gets them inside a panel only |
| `palette` | `table` | mood / contrast / cvd | contrast: white-yellow letters, black ink; cvd: colours remapped to the Okabe-Ito set without its reddish purple (1.9.22: no pink) |
| `announce` | `table` | on / off | screen readers read each word (or `alt`) through one polite live region |
| `limitScreen`, `limitWorld` | `table` | 1-32, 4-96 | `L.limits` |
| `movement` | own key | smooth (default) / stepped | the invincible style's motion type (`L.motionMode`) |
| `face` | own key | league (default) / anton | the invincible style's face (`L.invFace`); a call's `look.face` wins |

`table` is one world Object setting (so a GM's save is one write and one onChange on every seat); `movement` and `face` keep their
own world keys from 1.9.2 / 1.9.7. **The photosensitivity guard is no setting**: always on, nobody can switch it off (at most 2 flash
frames per second, none on a word taller than 20 % of the viewport, colour plates held still; impact frames counted on a shared log,
red at most 1 % of a drawing). `photosafe: false` reaching the filter or `L.impact` changes nothing [V node]. The window shows it as a
pinned "Always on" row.

What a seat's own system says still wins on that seat (`seatPrefs(table, seat)` in prefs.mjs): a table "Full" never overrides the
OS's reduced motion; a photosensitive seat gets no flash frames. Both are read live (matchMedia change, `clientSettingChanged`).

Who writes: only a GM (`game.user.isGM`). A player's `L.setTable` / `setPrefs` writes nothing and gets one notice ("chosen by the GM
for the whole table"); any player write of a `moinen-letters.*` setting is cancelled quietly in `preCreateSetting` /
`preUpdateSetting` [V node]. A setting deleted from the database falls back to the defaults on every seat (`deleteSetting` hook).

The window (1.9.19 ENGDROP layout) [V live, lane 5, GM and Test Gracz 1, pl and en]: four groups, Words (on/off, typeface, colours,
size, read aloud), Motion (Type = `movement`, Intensity = `motion`), Flashes and impact frames (flash frames, impact frames, the pinned
"Always on" guard), Words at once (over the interface, on the map; one shared hint). Each row is label | control in one fixed column,
the hint under both in a quieter voice; a row inside a group never repeats the group's name. Sizes read as percent on both seats (the
GM's slider shows "160 %", a player reads "160 %"); limits as plain numbers. With lettering off the rest of the window steps back
(dimmed, still editable). A GM sees a banner "You choose for the whole table", "Defaults" (window only), "Try on my screen" (two sample
words with the window's values, this seat only) and "Save for the table". A player opens the same window read-only: the GM's values as
text where the controls would be, a lock banner, "Try". Both see "On this screen": whether this seat's reduced motion and
photosensitive mode are on and what they change here. An open window follows the table live (a GM mid-edit keeps his edits until he
saves or resets).

Migration (once per world, marker world setting `tableMigrated` = 1, run on the first GM seat after `ready`): the table starts from
invincible-plus-ultra's old GMALL copy (`invincible-plus-ultra.lettersTable`) when the world holds that document (read straight from
the world's setting documents: with plus-ultra active or not, registered or not), else from the GM's own old client values
(`moinen-letters.<key>` in that browser's localStorage), else the defaults; the old `photosafe` value is dropped. Players' old client
values stay in their browsers, unused; a player whose old values differ sees one notice saying the settings are now the GM's.
Before 1.9.19 the copy was read only while plus-ultra registered it: a world opened with maps alone fell back to the GM's browser
values and lost the choices made in plus-ultra's window (check-table section 7 "maps alone").

**A caller's own options are the table's too** (moinen-maps GMALLMAPS, 2026-11-15, no engine change) [V node, dev/sfx-prefs*.test.mjs;
lane 5 live, GM + Test Gracz 1]: the map's lettering options (which sounds: all / big only / off; the word set; the canvas layer of
its world words; the size step per group) are world settings of `moinen-maps`, restricted, written by a GM only, live on every seat
(onChange + `deleteSetting`), shown in ONE window of the map ("Comic sound effects on the map", menu in its settings tab, open to
players read-only) whose button "Lettering look and motion" opens this engine window (`L.openSettings()`): the two windows never
repeat each other's rows. A caller's pattern: keep the options out of Foundry's list (`config: false`; a player does not see world
settings there), cancel a player's write in `preCreateSetting` / `preUpdateSetting` with a notice, migrate the GM's old client
values once (`localStorage["<module>.<key>"]`; an old world switch "for everyone" off wins), and keep per seat only what the seat's
machine or system decides (performance caps, reduced motion). Prove "no picture change at the defaults" by evaluating the runtime's
own resolution lines from the base tree and the new one over the same stored values and comparing per-seat plan logs (with a probe).

No bridge (1.9.19 ENGDROP). plus-ultra since UNMIRROR (tag tactics-integrated-136) keeps no copy: it reads `L.table` / `L.seat`, writes
`L.setTable`, and carries its old copy itself where it is newer. The engine writes nothing into plus-ultra's namespace. An OLDER
plus-ultra (132-135, the GMALL mirror) next to this engine: its mirror writes the engine's old client keys, none of which is registered
since 1.9.16 (inert: every seat applies the engine's table); its window still writes its copy, and on the GM's seat that wrote it the
keys that write CHANGED become the table's (a choice made there is not lost; its stale other values do not undo the table). Nothing
is written back, so that older window may show older values: the GM gets one notice per session to update plus-ultra (at once when
the copy is registered after the engine had migrated, else at the older window's first write). Provisional, combat-questions ENGDROP-1 [V live, lane 5, plus-ultra 135 next to 1.9.19: a GM write of 0.8 in its copy reached the table and Test Gracz 1, the GM notice shows at load.]
The legacy description of 1.9.14's client settings (prefs.mjs `SETTINGS`, `WORLD_KEYS`, `scopeOf`, `DEFAULTS`, `clean`, `cleanAll`) is
gone: `TABLE`, `TABLE_DEFAULTS`, `cleanTableValue`, `cleanTable`, `seatPrefs` are the one model.

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
dictionary rule and reviewed syllables), `check-tools.mjs`, `check-look.mjs` (L1-L16, legibility), (1.5.0) `check-move.mjs`,
(1.9.11) `check-engreg.mjs --engine [other letters folder]` (copy rule, seats, the clock on four simulated seats incl. a late answer,
a restarted server and a sleeping tab, `ceil`, `L.measure`, the settle memo equal to a fresh settle; on 1.9.10 15 of its 19 engine
checks fail), (1.9.15) `check-sustain.mjs --engine [other letters folder]` (every sustained kind and stream at three sizes, both
faces, both motion types: no two legible words of a run overlap beyond 4 % of the smaller; the map's burn call, the view edge, a
caller's room, two seats on one clock, a word drawn in by parts; on 1.9.14 234 of its 242 checks fail).
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
   recently synced one, with a warning; do not rely on it). The full rule and how a page reports what it runs: section 2 (`L.build`,
   `L.seats()`).
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

- (1.9.18 ENGVIEW) A run's `startAt` is converted once: a seat whose clock was still settling when it called carries that error for the
  whole run (live: 280 ms right after a reload). No engine re-anchoring yet (question ENGVIEW-1).
- (1.9.18 ENGVIEW) A late seat joins a sustained run at the phrases still up or to come: a phrase the seat on time is already
  fading out is not drawn there (the first ~150 ms after joining). Positions agree within a device pixel (each seat snaps to its own
  pixels). `L.measure`'s `standBox` / `inkReachBox` hold the drawn ink within 2 px in the node runs (the ink recorder over-estimates
  mitred strokes); a caller's own panels and other words are still the caller's to avoid. Streams' lanes still use this seat's view
  rect unless `keepInView: false`. `ceilK` stays unread (named once per page). [V node]
- (1.9.15) THUNDERFIT-E1 (sustain seats overlap) is closed by SUSTAINGAP. A run's room comes from the view and the caller's `room`;
  the engine knows nothing of a caller's panels or of another run next to it (two fires side by side may still touch). A `room`
  smaller than two seats lets the run overflow downwards. Phrases are measured from their first picture: before it the old fixed
  seat is used for that frame. Echo and shed are skipped when the room is full, so a fire in a tight room sheds less.

- (1.9.16) A call's explicit `reduced: false` still beats this seat's reduced motion in `resolveOpts` (as before ENGTABLE); only
  planning calls pass it today (the dice splash stage, token reactions). The table setting itself never overrides the seat. Open
  question for the owner (combat-questions, ENGTABLE).
- (1.9.11) A seat compares its build only with the GM's; two players on different builds without a GM seat are not named. The
  clock needs Foundry's "time" socket answer; until the first answer `L.clock.ready()` is false and the old `serverTime` is used.
  `L.measure` returns this seat's box: a seat with its own reduced motion or another view size gets another box (the seat's own
  picture differs the same way). Since 1.9.18 pass `view` for the table's box (section 6a); a seat's own reduced motion still changes it.

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
- Marks (KERNEX 1.9.8): the clearance is measured on the hold picture; entrance and exit pictures are checked only for "no touch"
  (a moving letter may come closer than the gap for a drawing). The tucked lead-in's hyphen still overlaps the first body letter by
  design (P7); a body that starts with L would put that hyphen into the L's stem at the top (not seen in the vocabulary; question
  KERNEX-1). [V node]
- `L.sustain` seats (fire, crowd lines): the next phrase's seat is spaced by 1.15 x the CURRENT phrase's cap size (`em = cur.size`,
  without the mood's `sizeK`), while a phrase's drawn box is about 1.85 em tall: a phrase entering overlaps the one leaving by 30-49 %
  of its height at every size (moinen-maps THUNDERFIT, node sim over the fire's phrases). Callers cannot fix it (`spread` moves only x,
  `maxWidth` is not passed to the phrases). Engine request THUNDERFIT-E1: space the seats by the drawn phrase box
  (`size x sizeK x holdBox.h` + a gap). [V node]
- One picture on every seat (moinen-maps MAPSFXSEAT): three things a caller cannot do through the engine's API today. Request E2:
  `L.sustain({ startAt })`, so a late seat joins a lasting sound mid-phrase like `L.play` (today the burn's sustain starts when the
  seat gets the event). Request E3: `L.sizeOf` / `L.measure` with an explicit view `{ vw, vh, zoom, alive }`, so a caller sizes for a
  reference view without importing `size.mjs` of the running copy (the map does that through `MoinenLetters.copies`). Request E4:
  streams (`L.stream`) honour a caller's reference size per syllable instead of the seat's view. [C]
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
| callers adopt ENGVIEW (1.9.18) | the map drops its size.mjs import, STREAM_UNIT / STREAM_CEIL and passes `view` / `startAt`; plus-ultra drops STAND / standPad / roomOf / tierOf mirrors and their check-callers pins (section 6a table) | 5, 6a (the "today" column) |
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
| `invFace`, `invFaces`; play option `look.face`; setting `face` | 1.9.7 FONTSEL | pending merge, sections 13, 15 [V node] |
| play option `look.rim` (`"ink"` / `"paper"` / `"none"` / `"auto"`); `plan.hand.halo` | 1.9.12 RIMUNDER | pending merge, sections 5, 13 [V node, renders, live lane 5] |
| `chain`; `vocab.tails`, `vocab.chain`, `vocab.variants`, `vocab.hitMaterials`, `vocab.fireLevels`, `vocab.chains`; word options `material pieces intensity stage` | 1.7.1 KINDS1 | pending merge, section 9a [V node] |
| `impact` (`play prepare plan pick show gallery stopAll mode setMode kinds frames tones limits stats busy`) | 1.7.2 IMPACT | section 21a; `steps` and the opts `gentle` (and the stricter `reduced`) since 1.8.2; `series`, opts `blowAt keep keepPad series`, `plan.peakMs` since 1.9.1 |
| `contactAt(handleOrPlan, startAt?)`, handle getter `h.contactAt`, `plan.contactMs`; play option `flash: false` (also through `L.net`) | 1.9.1 FIN-ENGINE | pending merge; sections 4 and 21a [V node, V live] |
| `gridClock(fn \| null)`; setting `movement` (world); tools `applyPrefs` | 1.9.2 MODE | pending merge; sections 11a and 15 [V node] |
| `build` (also `MoinenLetters.build`), `seats()`, `clock` (`now toPage toServer offset error ready state`), `measure(text, opts)`; play option `ceil` | 1.9.11 ENGREG | pending merge; sections 2, 5, 6, 8 [V node] |
| `crossRefusal`, `CROSS` (exports of `words.mjs`, not on `L`) | 1.9.13 ENGWORDS | pending merge; section 9 [V node] |
| option `view` (`sizeOf measure play sfx stream sustain`); `measure` fields `stand standBox inkReach inkReachBox ink rim life view unread`; `sizeOf` fields `floor ceil ceilBy view`; `streamUnit(opts)`; stream option `scale`; legacy sustain `startAt`; `impact.tierOf stepOf tiers seriesBoost` | 1.9.18 ENGVIEW (v22) | pending merge; sections 6a, 10, 12 [V node] |
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
- 2026-11-14 (WORDS3, 1.9.5, `tactics-zones-words3`): thunder without BOOM / BUM, `FIRE_BLASTS` and the check that keeps BOOM / BUM
  in blasts with fire only (9a), the rulings (14), the prefix example.
- 2026-11-14 (FONTSEL, 1.9.7, `tactics-zones-fontsel`): the invincible style in two faces, League Gothic (default) and Anton:
  face, per-face tuning, optical sizes, minus, the column's mark (13), the owner's ruling (14), the table setting `face` (15), the
  API index (20), the stage table.
- 2026-11-14 (KERNEX, 1.9.8, `tactics-zones-kernex`): marks never read as a diacritic of their letter (13: cause, rule, small
  sizes, what keeps its setting), the trap in limits (18), the stage table; `check-marks.mjs` (16).
- 2026-11-15 (KEEPBOX, 1.9.9, `tactics-zones-keepbox`): section 21a (the kept word drawn on the impact with a rim; one at a time on
  time windows with a timed cut; the same pictures on every seat: the guard on every planned call, words' flashes giving way inside an
  impact's second, no drawing skipped; `check-seats.mjs`; impact-render `--keep`), the stage table.
- 2026-11-15 (SFXSIZE, moinen-maps caller `tactics-zones-sfxsize`, no engine change): rulings "everything is the GM's for the table" and
  the map lettering's size sliders (14); "A caller's size step" (6).
- 2026-11-15 (HOLDS, 1.9.10, `tactics-zones-holds`): held words live as long as they stand (11a: cause, the lives per family,
  timing, limits, seats, reduced, stepped, cost), the stage table; `check-holds.mjs`.
- 2026-11-15 (ENGREG, 1.9.11, `tactics-zones-engreg`): which copy runs and `L.build` / `L.seats()` (2), measuring before placing
  with `L.measure` and the cost of planning many words at once (5), `ceil` (6), the table's clock `L.clock` (8), API index (20),
  stage table; `check-engreg.mjs` (16).
- 2026-11-15 (THUNDERFIT, moinen-maps caller `tactics-zones-thunderfit`, no engine change): "A caller's fit" (6: the real box from
  `L.planFor`, the reach factors, unclamped screen words); the sustain seat overlap (18, request THUNDERFIT-E1).
- 2026-11-15 (MAPSFXSEAT, moinen-maps caller `tactics-zones-mapsfxseat`, no engine change): one picture for the whole table
  (5: plan on shared data, measured reach, `startAt` join, gather by due time, the seat rule off/read/fit/shift), the table's size
  and the measured reach (6); requests E2-E4 (18).
- 2026-11-15 (MAPSFXSEAT2, moinen-maps caller `tactics-zones-mapsfxseat2`, no engine change): the seat layout replaces the group
  rule (5: size by the seat at step 2 then the step's share, place by the table's side moved the least, ink = hold + rim, never on a
  pin, "small" / "side" / "full" / "yield" / "edge", the pin's drawn box, what the first rule got wrong, cost); size by the seat and
  no loud ceiling under a layout (6).
- 2026-11-15 (ENGWORDS, 1.9.13, `tactics-zones-engwords`): both deny lists over both languages and the replaced words (9), the
  derived both-languages row (14), API index (20), stage table.
- 2026-11-15 (SUSTAINGAP, 1.9.15, `tactics-zones-sustaingap`): sustain run layout and its cause (12), stream lanes (10), the run's
  height and `room` for callers (5), limits (18), stage table; `check-sustain.mjs` (16).
- 2026-11-15: RIMUNDER (1.9.12, `tactics-zones-rimunder`): section 13 "Rim under the lettering on the map" (`look.rim`, defaults,
  which calls change, fingerprint proof, cost), section 5 caller note, stage table, API index.
- 2026-11-15: ENGTABLE (1.9.16, `tactics-zones-engtable`): section 15 rewritten: every preference is the table's (world, GM only,
  live on every seat), seat signals (OS reduced motion, Foundry photosensitive mode) still win on their seat, the photosensitivity
  guard always on, the read-only player window, migration and the plus-ultra bridge; section 18 limit on callers' `reduced: false`.
- 2026-11-15: ENGVIEW (1.9.18, `tactics-zones-engview`): section 6a (one table picture from the public API: `view`, the standing
  footprint, `L.streamUnit`, legacy sustain on `startAt`, the impact's ladders, what each caller may drop or pass), the `ceilK`
  warning (6), notes in 8, 10, 12, limits (18), API index (20), stage table; `check-engview.mjs` (check.mjs section 15).
- 2026-11-15: ENGDROP (1.9.19, `tactics-zones-engdrop`): section 15 (no bridge to plus-ultra's old mirror; the migration reads its old
  copy from the world document, also with maps alone; an older plus-ultra next to this engine; the legacy settings description gone;
  the settings window's new layout), stage table; check-table section 7 rewritten, section 8 dropped.
- 2026-11-15 (MAPSAME, moinen-maps caller `tactics-zones-mapsame`, no engine change): section 5 "the same picture on every seat" (one
  table side for every word at every step, the main word's side chosen on shared probe seats, one envelope per seat with the steps
  drawn inside it, the grid scan, the layout made ahead in an idle moment, off-view fire runs); `dev/sfx-same.test.mjs`.
- 2026-11-15: IMPACT3 (1.9.20, `tactics-zones-impact3`): section 21a (the tokens take part in the impact frames: figure treatments,
  `fig` / `cracks`, the rebuilt ladders, the figures' area cap, `also` / `figures` / `fig` / `kick`, caller lessons); impact README
  "The figures" and "Kinds"; `check-figures.mjs`.
- 2026-11-15 (GMALLMAPS, moinen-maps caller `tactics-zones-gmallmaps`, no engine change): section 15 "A caller's own options are the
  table's too" (the map's lettering options world + GM only + live + one window linking this engine's window; migration; the
  per-seat exceptions); `dev/sfx-prefs.test.mjs`, `dev/sfx-prefs-picture.test.mjs`.
- 2026-11-15: IMPACT4 (1.9.21, `tactics-zones-impact4`): section 21a (held colours `n` / `h` / `d`, slices, pops `z`, own-art enlarged
  frames, figures that follow their tokens, one-second cuts, the length and hit-stop limits); impact README "The figures", "Kinds",
  "Safety", "Cost"; `check-figures.mjs` sections 2b-2d and the follow check.
- 2026-11-15: ENGPINK (1.9.22, `tactics-zones-engpink`): section 13 "No pink" (the band, the replaced colours, the computed shades),
  section 14 ruling row, section 15 palette row; `check-pink.mjs` (check.mjs 8g and 16).
- 2026-11-15: IMPACT5 (1.9.23, `tactics-zones-impact5`): section 21a (the cut-in, the open area rule for ordinary seats, the same picture
  on every seat, figures on every drawing, rim by contrast, no pink from turned colours, warm-up and the stall rule, `I.seatMode`,
  `I.warm`, `handle.trace`); impact README "The cut-in", "Safety"; `check-figures.mjs` (area rule, cut-in, pink).

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
- (1.9.9 KEEPBOX) `keep` with a WORD: nothing is cut out any more. The word's own current picture is drawn on top of the impact at
  its exact place, turn and size (followed every frame; still during the hit-stop, like the board), and on every drawing that changes
  the scene it gets a paper rim, a thin ink line and a short ink drop along the blow round its letters (an SVG morphology filter):
  the letterer's knocked-out sound effect, readable on black, white and any map. Before, every drawing had a rectangular hole of
  un-inverted scene round the word (ADVX 7: "a crude dark rectangle"). Elements and rectangles still get the hole. `[V node, V live]`
- (1.9.9 KEEPBOX) The same pictures on every seat (ADVX 6: in a five-hit series the GM saw a star where the player saw nothing, and
  halftone and white frames against debris, from identical calls). Causes and fixes: (1) the GM letters private enemy damage numbers
  whose own flash accent took a slot in the GM's flash log, so the guard thinned the GM's next impacts differently: a word's flash
  inside an impact's second now gives way (takes no slot), and a word too big to flash on one seat still takes its slot; (2) one at
  a time was decided on what was alive on this page (arrival and frame timing): now on the time windows of every planned call, a
  stronger blow cuts the earlier one at its own start; (3) a seat at a low frame rate or with a dropped frame skipped one-tick
  drawings: now every drawing passed by less than 4 ticks shows for one frame; (4) the guard runs also for a call shown late or not
  visible on this seat. `check-seats.mjs`: seats at 60 / 144 / 30 with stalls / 20 fps, different clocks and delays, the GM with
  private numbers, agree on all 16 calls (before: 11 differed). Limits unchanged. `[V node]`
- (1.9.20 IMPACT3) The tokens take part (owner: more like sakuga MAD, colour inversions ON the tokens, accents on their edges, more
  effects, more dynamic). The struck `subject`, the attacker (`from`) and any `also` tokens are drawn by the impact layer at their own
  place, size, turn and flip, from their own art, and each drawing says what happens to them (`fig`): `r` a lit rim on the figure's
  TRUE outline (ink outside, the accent inside, thicker on the side of the blow), `i` its colour negative, `p` posterised to ink /
  accent / paper, `k` inked black and white, `o` its own colours (it stands out in colour on a negative or black frame). Two new frame
  types: `fig` (the figures held, knock-back echoes along the blow, flares from the contact point) and `cracks` (`shatter`'s ink without
  the scene's change). Every ladder except `word` rebuilt in hand-drawn timing: a lead-in tick, the contact, the hit-stop HELD on the
  figures while their palette jumps on ones with the frame shaking (`kick: -1` = a shove back against the blow), the release on twos,
  rims dying out; a seed swaps the order of the palette jumps, so blows of one strength differ. Each ladder has at most 2 flash
  drawings by design (a lone impact is never thinned). The figures' brightness changes (`i p k`) cover together at most 2.5 % of the
  view on any drawing (`LIMITS.figArea`, under WCAG's small safe area of 2.78 %), target first; past that a figure gets the rim: a big
  token at a close zoom shows rims only. The gentle variant and reduced motion draw rims only. A token is drawn on a seat only when
  that seat may see it (a GM-hidden token never on a player's, its outline neither). Caller options: `also: [tokens]`, `figures:
  false | "rim"` (lower only), and in your own `frames` a step's `fig` and `kick`. Tables per step and kind: the impact README
  "The figures" and "Kinds". `[V node, V render, V live]` Live (lane 5, GM + Test Gracz 1, 60 fps): identical drawings on both
  seats frame by frame; no frame over 16.7 ms inside any directly called impact; a photosensitive seat drew `local` with rims while
  the GM drew `full`. Caller notes from the take: a crowd in plus-ultra passes only its heaviest target (the others could be `also`);
  no maps caller plays an impact for a map blast today.
- (1.9.21 IMPACT4) The tokens ARE the picture at every size (owner: «odwrócenia kolorów na tokenach, akcent na ich krawędziach ...
  dynamiczniej» and «jeden rzut i animacja na kilka minut»). In 1.9.20 an ordinary token at the table's zoom (262 px at 0.75 on The
  Warehouse = 4.8 % of a 1600 x 900 view) was over the 2.5 % cap and got rims only; a full-square token (the minion's blue square)
  stayed a blue square. Now: (1) three treatments that turn the colours but keep EVERY pixel's relative luminance (WCAG measures a
  flash in it): `n` hue negative, `h` hue cycle (an angle per drawing), `d` duotone in the impact's accents; they move ink, not light,
  need no area and no flash slot, never give saturated red (measured within 0.004 of luminance on 20 000 pixels); (2) over the cap a
  bright treatment becomes its held twin (`i` -> `n`, `p` / `k` -> `d`) plus a SLICE of the true bright art along the blow with what
  area is left; (3) pops: a drawing's `z` draws the figures bigger at their place (small ones more, at most 2.2 x), counted against
  the cap on non-flash drawings; (4) `shadow` / `glare` / `swap` show the token's own art (negative / posterised / inked) instead of a
  flat silhouette; (5) a portrait's own cut-out figure gets an inner ink + accent edge; (6) the figures follow their tokens while they
  react (full mode: one canvas per figure moved each frame by the token mesh's world transform); (7) the strongest blows are a
  one-second cut: `maxTicks` 24 (was 12), hit-stop up to 8 ticks (was 4), steps 4-5 15-24 ticks, step 3 at most 11 so a rapid series
  still plays; still at most 2 flash drawings. Caller option: `z` per step of your own `frames`, `fig` also `n d h`. Callers that
  capped an impact at 500 ms must read `plan.ms` (plus-ultra tokenreact and splash: reported). `[V node, V render, V live]`
- (1.9.23 IMPACT5) A sakuga cut for its whole length (owner again: «bardziej jak sakuga mad ... Dynamiczniej»; and on the 2.5 % limit
  for ordinary seats: «Poluzuj»). Measured before: after ~200 ms only token-sized changes were left (a few px at a far zoom); a closer
  seat got the luminance-held twin where the far one got the negative; splashes and rings without figures covered the struck token.
  Now: (1) the CUT-IN: every drawing carries `cu` and `kb`; the star (the struck figure, with no target the attacker `from`, else the
  first `also`) is drawn enlarged at its own place to about 34 % of the view's short side (at least 1.3 x, at most `cutMax` 44 %),
  the others up to 16 %; it grows over the lead-in, stands through the hold, eases back over the release, winds up against the blow and
  drifts along it, stays in the view; the ink (stars, rings, flares, panels, echoes) is laid round the cut-in; (2) the NEW RULE for
  ordinary seats: the figures' brightness changes and enlargements share 25 % of min(W, H)^2 per drawing (`figAreaOpen`), each
  figure counted at its cut-in cap, so every seat decides alike at any zoom; photosensitive and reduced-motion seats unchanged (rims
  only / one still); the scene's flash rationing unchanged; (3) every drawing of a ladder carries the figures; (4) the rim's accent
  stands off the art's own edge colour (a yellow-ringed portrait gets blue or paper, not yellow); (5) turned colours (negative, hue
  negative, hue cycle) never land in the pink band; (6) the figures' art is worked out at the call and for visible tokens while idle
  (`I.warm`), two drawings are painted ahead, and a flash or hit-stop drawing shown in a frame that ran long stays one more frame.
  New: `I.seatMode()` (what this seat shows; `I.mode()` stays the table's), `I.warm(tokens?)`, `handle.trace`. `[V node]`

**Frame types** (20): `pop splat lines ink slam shadow glare swap window smear tear rip dots shatter chroma ring fade rest`, and
(1.9.20) `fig cracks`. Full-field:
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
- an impact is at most 24 ticks (1 s; 1.9.21, was 12), one drawing 4 ticks, hit-stop 8 ticks (1.9.21, was 4); a watchdog timer removes
  it even when the frame loop died.
- one impact at a time: an impact whose time window overlaps another's is shown only when stronger than all of them (1.9.9: decided on
  the windows of every planned call, on every seat alike; the stronger one cuts the others at its start).
- Film check (1.9.1): the five-blow ladder on dark, mid-grey and bright scenes gave at most 1.5 whole-picture flashes in any second
  (WCAG limit 3); reduced motion 0.5. `[V live]`
- The user can switch the guard off on their own client (`photosafe`); no caller option can. (1.9.16 ENGTABLE: the guard is no
  setting any more and always on; this line is history.)
- (1.9.20) The figures: brightness-changing art (`i p k`) at most 2.5 % of the view per drawing in all, never a flash by itself;
  rims only on a gentle or reduced seat; red in a figure's art drawn as the safe crimson; the rim's accent never red. `[V node]`
- (1.9.23 IMPACT5, the owner: «Poluzuj») **The rule now:** on an ORDINARY seat the figures' brightness changes and cut-in enlargements
  share at most 25 % of the view's short side squared per drawing (`LIMITS.figAreaOpen`; 14 % of a 16:9 view), each figure counted at
  its largest possible size, so every seat with the token in view shows the same; a PHOTOSENSITIVE seat (gentle variant) still draws
  rims only and a REDUCED-MOTION seat one still drawing, exactly as before; the scene's flashes stay 2 per impact and 2 per second for
  everyone. The 2.5 % line above is history. `[V node]`

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
- (1.9.20) Pass the attacker as `from` (a token) and the other struck tokens as `also` so they take part; pass `figures: "rim"` where
  the art must never change (a portrait in a dialogue panel), `figures: false` where the impact must not draw on tokens at all.

**Looking at it.** Offline: `node dev/tools/impact-render.mjs --out <dir>` (moinen-maps; one headless browser, light slot; `--bg
night|map|bright|dark|light`, `--round 1` = a round portrait token, `--spec`). Live: `L.impact.gallery({ subject: token, dir: 20 })`.
Checks: `node scripts/letters/impact/check-impact.mjs` (section 8f of `check.mjs`).
