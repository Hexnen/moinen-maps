# Destruction presets: design (I0)

Status: design only, no module code. Branch `presets-design` from main 7b59fbf. Written 2026-11-09.

## 1. The ask

The user (Polish, verbatim): "potem robimy nowy temat, presety. coś jak soundboard ale do zniszczeń. zestaw gotowych ustawień pod
jednym brushem. pierwsze presety to bomba, granat, uzi, klasyczny podwójny ckm z helikoptera. czyli np w przypadku bomby łączymy
najpierw wszystkie efekty tak żeby pasowało. przy ckmie trzeba dodać jakiś spread zniszczeń, wybrać delikatne zniszczenia, trochę
losową ścieżkę. możliwe że brakuje nam jeszcze ognia dedykowanego do samych wybuchów"

In short: a soundboard of destruction. A pad is one ready-made preset under ONE brush, which puts down everything that belongs to
that event at once and in step: damage, fire, smoke, dust, light, screen shake and possibly sound. The first four are a **bomb**, a
**grenade**, an **Uzi** and a **classic twin heavy machine gun from a helicopter**. The guns need a spread, light damage and a
slightly random path. Explosions may need fire of their own.

Quality bar (coordinator): WOW, natural and organic. No squares, rectangles or area edges, a smooth start and end, and the oblique
view. Optimising must cause no visible loss.

## 2. Decisions in one screen

1. **A preset is data plus an expander.**
   - A preset definition is JSON: layers, a timeline and the rules for spread and randomness.
   - On the GM, a pure function (`expand(def, gesture, seed)`) turns one gesture into concrete records for the existing layers.
   - Nothing is simulated per frame and nothing is sent per frame.
2. **One firing is one scene update.**
   - The update holds every record of every layer, plus one *firing record*.
   - Every client plays it from the flags and the shared clock, the way fire, dust and weather already work.
3. **Every firing has a start time T0 on the shared clock.**
   - The impact happens at T0 = click + the preset's pre-roll.
   - The pre-roll is anticipation: the bomb's falling shadow, the grenade's flight, the guns walking in.
   - The pre-roll also hides the one thing that cannot be instant, the destruction bake and chunk download (measured below).
4. **Dedicated explosion fire is needed.**
   - Without it the bomb is a stain plus debris. The current blast entry shows a flat orange disc with a hard round edge, then char.
   - It becomes a new fire-layer stroke kind, `burst`: a fireball that rolls up and darkens into the smoke column. It is drawn in the
     fire's own pixel-art language, colours and lights.
5. **Guns are ONE destruction stroke per lane per firing.**
   - The stroke's mask is the union of the impacts. Its brush path carries the bullets' timestamps, so the existing "follows the
     stroke" entry reveals the impacts in sequence.
   - So a firing costs one bake and one chunk per lane, not one per bullet: 0.5-0.7 s instead of 1.1 s for 24 impacts (measured).
6. **The soundboard lives in the Destruction section.**
   - A *Presets* tool shows the pads in the bar (hotkeys 1-9), with a dock panel for the pad grid, the editor and the list of
     firings.
   - Ctrl+Z undoes a whole firing across all layers.

## 3. What exists that a preset can drive

Read from the code on main 7b59fbf. The "Preset use" column says what a preset gets today and what blocks it.

| Layer | What it does | How it is driven | Data / sync | Preset use: today / gaps |
|---|---|---|---|---|
| **Destruction** (`scripts/destruction`) | Strokes with kind (blast, collapse, scorch, flood, cracks, gash), level 1-3 and cause (fire, acid, lightning, arcane, impact, claws, water, decay, frost). Each stroke has a type-specific entry: a blast has a flash, a skirt of dust puffs and thrown chunks cut from the map. Torn borders, substrate rules (newer over older), carried tokens. | `api.destruction.paint(x, y, r, {type, level, cause})` stamps ONE disc, with no path and no per-stroke look. The editor's `edited(box, stroke)` takes any mask, a path with ms timestamps and a carry. | One flag key per stroke (`destructionObjects.<id>`, an RLE mask in a box). Baked in workers on the GM, published as chunks (`destruction.baked.c[id]`). Players download chunks and bake nothing. Entries are played at server time (`destruction.entries`). | **Yes**, through `edited()`: any mask, a path, a cause. **Gaps:** <ul><li>no public paint-with-path</li><li>no per-stroke look (`pr` comes from the scene params)</li><li>no scheduled entry start</li><li>no remove-by-id</li><li>the save is debounced by 700 ms</li><li>undo pops the last object with no fade</li></ul> |
| **Cinematic mode** (`destruction/cinematic*.mjs`) | Stages strokes (baked, hidden). A *show record* makes every client reveal them LEAD ms before a start time on the shared clock. Screen effects: bars, shake, flash, vignette, slow motion, camera. | Scene params `cinematic`, Action. | Flag `cinShows`, the shared clock. | It is the **proof** that a timed reveal of baked strokes works in sync. A preset needs only a light version: a start time per stroke, no camera, no bars. |
| **Screen engine** (`director/stage.mjs`, `screen.mjs`) | Shake (one stage offset, never accumulates) and flash, with per-player opt-outs. | `Screen.begin/impact/end`. | Per client. | **Yes**, for the shake and flash at T0. It is independent of the Director's world switch (off by default). |
| **Director** (`director/`) | Events become shots for players (camera take-over, captions). It has sources for destruction and fire strokes. | `api.director.emit(event)`. | The module socket, the leader GM. | One event per firing (weight from the preset). **Gap:** the per-stroke sources would flood it with every sub-stroke, so they must skip preset strokes. |
| **Fire** (`fire/model.mjs`, `art.mjs`, `display.mjs`) | Pixel-art fire on the art grid at 12 fps: levels 1-3, a colour ramp from one base colour (`look.rampOf`), emissive in the dark, Foundry client-side lights (at most 24), torn edges, rain damping, tornado lean. | `api.fire.paint(pts, {level, smoke, color, torn, wind})`, `remove`, `setLevels`, and `add(raw, {undoable})` inside. | One flag key per stroke (`fireStrokes.<id>`). Nothing is baked: every client computes areas and fields from the strokes and the shared clock. A stroke catches at `q` and goes out at `o`. | **Yes, with timing.** Verified on lane 2: one write of a stroke with `q` = now+1.5 s and `o` = now+5 s caught at q, burned and went out at o by itself (frames: `dev/presets-design-fire-timed.png`). **Gaps:**<ul><li>grow (1.6 s), out (2.2 s) and spread are scene-wide, so a 0.1 s flare is impossible</li><li>there is no explosion kind</li></ul> |
| **Smoke** (fire layer, kind `smoke`) | Wisps, a plume or a thick dark column (levels 1-3), carried by the wind, rising up the screen in the oblique view. | Same as fire. | Same as fire. | **Yes**, for the aftermath column and haze, scheduled with q/o. |
| **Dust** (`fire/dust-model.mjs`, `dust-art.mjs`) | Ground dust from a source moving along a path (bike, car, drag, heavy), in three layers (chips/grit, puffs, aura) plus ground marks. Uses the ground's own colour. | `api.fire.paint(pts, {kind: "dust", dust, level, radius})`. | Stored with the fire strokes, computed per client. | **Partly.** It is path-based with a fixed speed per kind. **Gaps:**<ul><li>no radial shock ring</li><li>no point bursts at given times (bullet impacts)</li><li>no per-stroke speed</li></ul> The fire agent is editing these two files now. |
| **Weather** (`weather/`) | Rain, snow, sand, dust, embers, wind, clouds, tornado, lens. | `api.weather.*`. | Scene flag timeline. | Not needed for the four presets. Possibly later: dust or heat on the lens after a near bomb. Burning fire already opens the clouds over it, and rain already damps fire (both work with preset fire as it is). |
| **Tokens** (`tokens/carry*`, `plough*`) | A stroke can carry a token along its path. Superhero ploughs through tokens. | The editor's carry gesture. | Part of the stroke (`tk`). | Not in the first four. Later: knockback for a bomb. |
| **moinen-pixel-vfx** (another module, optional) | Sounds: about 20 explosion oggs and recipes (`sound.play("explosion-big")`), one single gunshot, no autofire loop, no rotor. `playForAll`, `shake`, `react` (token flinch / knock-back). | `game.modules.get("moinen-pixel-vfx").api`. | Its own socket. | **Optional sound source** (a soft dependency, like the carry's visual API). Its sprite explosions are not used for the look: they would be enlarged clips, the wrong language. |
| **Frame guard** (`frame-guard.mjs`) | One per-client guard for weather and fire (q 0.35-1). | `guardQ()`. | Per client. | New preset layers (burst, accents) hook into it. |
| **View angle** (`view-angle.mjs`) | lift / squash per scene. | `flags.view`. | Shared. | Height of the fireball, column, tracers and shadows. |

### Measured live (lane 2 GM page, RTX 3070 Ti, 20 threads, scene 1536 x 1024, grid 40 px; player page not measured)

| Case | Shown on the GM | Stroke in the flag | Chunk named for players |
|---|---|---|---|
| Bomb: blast L3, fire, r 3 sq | 0.36-0.40 s | 0.70 s | 0.70 s |
| Grenade: blast L2, impact, r 1 sq | 0.18 s | 0.49 s | 0.49 s |
| Uzi as ONE stroke (24 discs r 0.22 sq + path) | 0.19-0.34 s | 0.52-0.67 s | 0.52-0.67 s |
| Uzi as 24 strokes | 0.18 s | 0.72 s | 1.13-1.16 s |

- The flag time is mostly the 700 ms save debounce. A firing should save at once.
- The player still has to download the chunk. That is not measured here, and on the user's remote host (behind Cloudflare) it
  will be longer.
- `bake-policy.mjs` records a heavy case: a burst of 18 strokes on a loaded machine took 25-30 s of bake, upload and manifest.
- The existing L3 fire blast entry (frames: `dev/presets-design-blast-l3.png`, frames at 0.26 / 0.78 / 1.0 / 1.2 / 1.5 / 1.8 / 2.6 s of the recording, painted at 0.3 s):
  - At about 0.5 s a **flat orange disc with a hard round edge** appears.
  - Then come the char, chunks and a dust skirt.
  - There is no fireball, no rising column and no shock ring.
  - On its own it fails the bar (an area edge, no volume). In a preset the burst must cover that moment.
- Cracks L1 at r 0.22 sq are barely readable at zoom 1.6. Bullet pocks need the accents (dust, sparks) and a slightly larger or
  L2 core to read.

## 4. The four presets at the table

Times are ms from T0 (the impact). Negative is pre-roll. Sizes are in grid squares (sq) at size 1 (the bar's size slider scales
them). Every random choice comes from the firing's seed, chosen once on the GM and stored. Every client shows the same thing.

### 4.1 Bomb (aerial bomb)

Gesture: click the spot. An optional drag sets the direction the bomb comes in from. Footprint about 2.5 sq.

**How it reads:** a shadow races in and tightens. A white-hot flash. A fireball rolls up and turns into a dark mushroom. A ring of
dust tears outward over the ground. Burning debris arcs out and starts small fires. A charred, torn crater is left, with a smoke
column drifting downwind for a minute while small fires smoulder.

| t (ms) | Layer | What |
|---|---|---|
| -1200 to 0 | accents | Falling shadow: a soft ellipse grows dark and tight on the target, coming in along the drag direction. Optional whistle (sound). The GM's crater bake and the players' chunk download happen in this window. |
| 0 | screen | Flash (short, warm) and shake (strong, decaying 0.8 s). Players' opt-outs apply. |
| 0-120 | burst | Core flash: a small white-yellow lobed core. Light flash at full intensity (night). |
| 60-450 | burst | Fireball: a lobed, rolling cauliflower body grows to about 1.6 sq and rises by the view lift. No disc edge: the outline is billows. |
| 0-600 | destruction | Blast L3, cause fire, torn borders. Its entry starts at T0 under the burst: its flash is hidden, its chunks fly out of the fireball. |
| 30-900 | dust | Shock ring: a ragged front of ground-coloured puffs runs out to about 3.5 sq, slowing with drag. Grit and a low aura are left. |
| 300-2500 | burst | Roll-up: the fireball rises and darkens from the edge in (fire, then brown-black billows). Its base collapses into licking flames and embers. The cap leans downwind. |
| 150-1400 | burst / fire | Flaming debris: 6-12 burning chunks fly parabolas (visible apex, ground shadow). Each spawns a small fire stroke where it lands. |
| 1200 to 60 s | smoke | Smoke column L3 rising from the crater (q = T0+1.2 s, o = T0+60 s). The burst's dark cap hands over to it without a seam. |
| 1000 to 40 s | fire | Crater fires L1-L2 (2-4 strokes along the torn rim) and the landed debris fires L1. Each has its own `o` (20-40 s), so they die out one by one. |
| to 90 s | dust | The aura settles and drifts with the scene wind. |

### 4.2 Grenade

Gesture: drag from the thrower (a token under the cursor at the start) to the landing spot. A click drops it in place. Footprint
about 0.7 sq.

**How it reads:** a small dark dot arcs in, bounces once and rolls. A sharp crack. A dirty grey-brown puff with a short orange heart.
A spray of shrapnel pocks around a small crater. A low dust ring. Light smoke drifts away. Nothing keeps burning (or one smoulder).

| t (ms) | Layer | What |
|---|---|---|
| -1500 to -500 | accents | Thrown arc: a dot with a ground shadow; the apex depends on the distance. |
| -500 to 0 | accents | One bounce and a short roll (squash on landing). An optional tink sound. |
| 0 | screen | Short sharp shake, no flash. |
| 0-350 | burst L1 | Mostly dust and smoke, a small orange core of 80 ms, lobed, about 0.5 sq. |
| 0-500 | destruction | Blast L2, cause impact (a pale compact crater, radial fractures, a lit crest). |
| 0-500 | destruction | Shrapnel: one cracks L1 stroke of 10-18 small pocks scattered out to 2 sq (denser near the centre), revealed by distance from the centre in the same entry. |
| 20-700 | dust | Low shock ring to about 1.5 sq, grit. |
| 300 to 12 s | smoke | Wisps L1, short-lived (`o` = T0+8 s). |
| optional | fire | 30 % chance of one smoulder L1 (o = 10 s). |

### 4.3 Uzi

Gesture: drag from the shooter (a token, or any point) to the end of the burst. The drag's length sets the burst length; a click is a
short burst at the point.

**How it reads:** a ragged stitch of hits walks along the line. Each hit throws a tiny puff of the ground's colour, a few chips and,
on hard ground, a ricochet spark. The line climbs sideways and wobbles (muzzle climb). A fine haze hangs over it. Light damage only.

- **Rate:** about 10 rounds a second, a 1-2.5 s burst (10-25 hits). With a shooter, a muzzle flicker at the start point.
- **Spread:** each hit is offset across the aim line by a Gaussian (sigma 0.25 sq, growing to 0.5 sq along the burst). It also
  drifts along a low-frequency random walk: the "slightly random path". About 15 % of hits are strays at 1.5x sigma.
- **Damage:** one cracks stroke per firing (cause impact):
  - pocks r 0.15-0.25 sq;
  - 80 % L1, 20 % L2 cores (so they read);
  - every hit is in the mask; overlapping hits merge into a short gouge.
- **Timing:** the stroke's path is the walk, with each hit's time, so the follows-the-stroke entry opens each pock when its bullet
  lands.

| t (ms) | Layer | What |
|---|---|---|
| -600 to 0 | accents | Muzzle flicker at the shooter (if given); the first tracer is in flight. |
| 0 to burst end | accents | Per hit: a 2-4 frame spark (on stone, metal or road; none on grass or water), plus a water splash ring on water. |
| per hit | destruction | Its pock opens (entry along the path). |
| per hit | dust | A small burst puff, 3-5 chips with shadows, grit left behind. |
| end + 2-6 s | dust | The aura thins and drifts. |

The bake (about 0.5 s on the dev machine) runs during the pre-roll. If a player's chunk is late, the first pocks enter up to 1.5 s
late (`WAIT_LATE_MS`) under their dust puffs, which have no bake. This must be checked on the remote host.

### 4.4 Classic twin heavy machine gun from a helicopter

Gesture: drag the strafing run (start to end). The helicopter comes in from beyond the start and passes over the end.

**How it reads:** two parallel lines of heavy hits race along the ground, side by side and slightly out of step. Each hit is a tall
dust geyser with chips and sparks. Tracers streak in from above along the run. The ground is chewed into two ragged lanes of
pocks and small craters. A wide band of dust hangs and drifts. Optionally the helicopter's shadow sweeps over.

- **Rate:** two guns, about 8-10 rounds a second each. The run speed is about 6-10 sq/s, so a 10 sq drag is about 1.2 s of fire.
- **Lanes:** ±0.35 sq either side of the run line (scaled by size), each with its own wobble and Gaussian spread (sigma 0.3 sq). The
  run line itself gets a gentle random sway (amplitude 0.3 sq, wavelength 4-6 sq), so the two lanes snake together.
- **Damage:** two cracks strokes (one per lane, cause impact):
  - pocks r 0.2-0.35 sq;
  - 60 % L1, 35 % L2;
  - 5 % broken-L2 mini craters, as one small blast stroke per run holding all of them.
  - Path timing as for the Uzi, offset by half a shot between the guns.
- **Every 4th-5th round is a tracer:** a bright thin streak from above along the run (lifted by the view angle), ending in its hit.

| t (ms) | Layer | What |
|---|---|---|
| -1500 to 0 | accents | Rotor-wash shimmer and (optional) the helicopter's soft shadow approaching. The first tracers arrive at T0. |
| 0 to run end | accents / destruction / dust | As for the Uzi, heavier: tall geysers (puffs thrown up more than out), more chips, sparks on hard ground, splash columns on water. |
| run end + 0.5 s | accents | The shadow passes off the far end. |
| to 20 s | dust | A wide aura along both lanes drifts downwind and settles. |
| optional | fire | Rare (5 %) smoulders where a tracer hits dry grass or wood (material from the destruction substrate: grass or wood only). |

## 5. What is missing

| # | Gap | What it must be | Files (fire/smoke/dust files in bold) |
|---|---|---|---|
| G1 | **Explosion fire** (`burst`) | See 5.1. Without it no explosion reads as one. | **fire/model.mjs**, new **fire/burst-art.mjs**, **fire/display.mjs**, **fire/lights.mjs**, **fire/guard.mjs**, **fire/fire.mjs** (api) |
| G2 | Per-stroke fire timing | Optional `gr` (grow s) and `ot` (out s) on a stroke, overriding the scene's grow / out. Explosion-born fires flare fast; debris fires catch in 0.3 s. Scene defaults are unchanged (identity test). | **fire/model.mjs** (`timing`, `endOf`, `cleanStroke`) |
| G3 | Dust: shock ring | New dust kind `shock`: the source is a ring growing from a centre at a decaying speed. Puffs are thrown outward, then grit and the aura. Levels 1-3 = grenade, shell, bomb. | **fire/dust-model.mjs**, **fire/dust-art.mjs** |
| G4 | Dust: impacts | New dust kind `hits`: emitters only at given points, each with its own kick time (from the stroke's path timestamps). The kind sets the puff shape (light = Uzi, heavy geyser = HMG). Water points give a splash instead. | **fire/dust-model.mjs**, **fire/dust-art.mjs** |
| G5 | Destruction: paint API for presets | `paintStroke({ mask or discs[], type, level, cause, path:[[x,y,ms]], pr, at, ps })`:<ul><li>`pr` per-stroke look (directional true for guns, jagged for the bomb);</li><li>`at` the entry start on the shared clock (every client starts the entry then; LEAD as in cinematic.mjs);</li><li>`ps` the firing id.</li></ul>Plus `removeStrokes(ids)` and `saveNow()`. | destruction/destruction.mjs, model.mjs, display.mjs (entry start) |
| G6 | Destruction: undo with a fade | Undo of preset strokes fades their areas out (about 0.6 s, a dissolve by pixel dropout) instead of popping. Layer undo (`undoLast`) skips `ps` strokes: the preset owns them. | destruction/destruction.mjs, display.mjs |
| G7 | Accents layer | Things that are no layer's own: <ul><li>the falling-bomb shadow, the grenade arc and bounce</li><li>muzzle flicker, tracers, ricochet sparks, water splash at a hit</li><li>helicopter shadow and rotor-wash shimmer</li></ul>Drawn on the art grid in the destruction accents' language (pixel-fx: dropout fades, ground shadows), lifted by the view angle. A pure function of the firing record and the clock, pooled, under the frame guard. | new `scripts/presets/accents.mjs` (+ pure `accents-core.mjs`) |
| G8 | Screen, light, sound | At T0 (and per heavy hit): shake / flash through `Screen` (opt-outs, reduced motion); a flash light (a client-side light like the fire's, a fast attack and 1.5 s decay); sound through pixel-vfx when installed. | new `scripts/presets/cues.mjs`; the light either reuses **fire/lights.mjs** (G1) or is its own |
| G9 | Firing record + cross-layer undo | `flags.moinen-maps.presetFirings.<id>`: what was put down, in which layers, T0, cues. The preset undo / redo stack. Purge after the aftermath. | new `scripts/presets/presets.mjs` |
| G10 | Director: one event | The sources skip strokes with `ps`; the firing emits one event (kind destruction, weight from the preset and size). | director/sources.mjs |
| G11 | Blast entry's flat disc | With a burst on top it is hidden. A plain blast painted with the brush still shows a hard-edged orange disc at L3 fire. Out of scope for presets, but it fails the same bar: a separate destruction look task. | destruction/display.mjs, cause-fx.mjs |

### 5.1 The dedicated explosion fire (`burst`)

Yes, it is needed. Burning-in-place fire grows over 1.6 s and stays. An explosion is a 0.1 s flare that becomes a rising, darkening
volume within 2-3 s. With today's strokes the bomb shows a flat crater disc under a slowly growing campfire.

What it must be:

- **A stroke kind of the fire layer:**

  ```
  { k: "burst", p: [x, y], r, lv: 1..3, q: T0, c?, sd, wd, ws, dir? }
  ```

  It lives in `fireStrokes`, is computed per client, and has no field worker (it is a point event). Each burst is one area
  sized to hold its whole roll-up. It is a pure function of (record, shared clock) on the art grid at 12 fps, the same
  quantisation as the fire, and crisp at any zoom with the sharp sampler.
- **Phases (L3):**
  - **Core:** white-yellow, 0-120 ms.
  - **Fireball:** 60-450 ms, an expanding body made of lobed billows (cauliflower), each lobe lit top-left with the fire's ramp
    bands. The silhouette is ragged and rolling, never a disc.
  - **Roll-up:** 0.3-2.5 s. It rises by the view lift and the billows turn over. The colour sinks from the outside in: hot core,
    mid, outer, then smoke-brown, then the smoke layer's dark tone. The base pinches into a stem (mushroom at L3, a lopsided puff
    at L1-2). The cap leans with the wind (`windAt`, the tornado included).
  - **Hand-over:** 2-4 s. The cap thins by dropout into the smoke column stroke that starts under it at T0+1.2 s. Same tone at the
    joint, no seam.
  - **Embers:** sparks thrown up and out, cooling through the ramp.
- **Ground:** a short heat-tint ring on the ground multiply. The destruction stroke owns the char.
- **Colour:** `look.rampOf(c)`, so a blue-gas, arcane or white-hot bomb works the same way the fire colours do.
- **Light:** joins the fire lights. A burst's light has its own curve: a peak at 50 ms with a big radius, decaying over 1.5 s into
  the light of the fires it leaves.
- **Emissive:** the core and fireball are emissive in the dark (they write into illumination like flames). Smoke is not.
- **Levels:**
  - L1 grenade: dirty, mostly dust-brown with a small heart, 0.4 s, no stem.
  - L2 shell or rocket: a fireball and a short column.
  - L3 bomb: the full mushroom.
  - The size follows `r`.
- **Under the guard:** fewer lobes and embers, never a different silhouette. At q = 1 it is the full look.
- **Reduced motion:** a short fade of the settled smoke, no fireball.
- **Not** the existing `fireball` style. That one is the frozen v1 look of a burning area and stays as it is (identity test).

## 6. UI: the soundboard

**Where:** Moinen Maps Tools, Destruction section. A new tool **Presets** (`mm-d-preset`, fa-bomb) next to the damage brush, the
eraser and the fire / smoke / dust tools. GM only; players see none of it.

**Bar** (while the tool is active):

- **The pads:** one button per preset of the current set (icon, short name, hotkey 1-9; Shift+1-9 for the next 9).
  - The armed pad is lit.
  - A pad shows its gesture as a small glyph: point, throw, line or run.
  - Picking a pad never fires it. The map gesture does, so one brush is one preset.
- **Size** (0.5-2x, `[` `]`), **Power** (level shift -1 / 0 / +1 within the preset's range) and **Variation** (a new seed every
  firing; Alt-held keeps the last seed, to repeat a firing exactly).
- **Aftermath** (short / normal / long): scales the `o` times of fires, smoke and dust.
- **Sound** on / off (only with pixel-vfx installed).

**On the map:**

- A ghost preview follows the cursor before release, drawn in the oblique view (a squashed ellipse for the bomb, the arc and landing
  ring for the grenade, the line with its spread band for the guns, the run with both lanes for the heli).
- Esc cancels. Release fires.
- A token under the cursor at the start of a throw or line is the shooter or thrower (its centre, nothing written to it).
- **Ctrl+Z / Ctrl+Shift+Z** undo / redo the last firing as one step, across all layers.
- Firing again before the last one ends is fine: firings overlap like real ones. The newer damage lies on the older (substrate
  rules).

**Dock panel "Presets":**

- **Pad grid:** built-in and custom presets in sets (Military for the first four; later Magic, Nature...). Drag to reorder, which
  sets the hotkeys.
- **Editor:** pick a pad, then Edit (or Duplicate a built-in).
  - The layers of the preset, each a row with an on/off switch and its few controls:
    - Destruction: kind, level, cause, size, spread;
    - Burst: level, colour;
    - Fire: level, how many, life;
    - Smoke: level, life;
    - Dust: kind, level;
    - Screen: shake, flash;
    - Light;
    - Sound.
  - A timeline strip (layers by time, draggable start / end).
  - **Test fire** plays it locally on the GM only: nothing is written, no bake is published. A dry run of the timeline on a
    temporary local stroke.
  - Built-in presets are read-only; edits go to a copy. Custom presets are a world setting (like the pin presets).
- **Firings:** the last firings of the scene (preset, time, place). Hover outlines the firing. Undo per firing. **Settle**
  makes a firing permanent and drops its record: its strokes become ordinary strokes, listed in the Damage and Fire panels.

## 7. Data format and sync

### 7.1 A preset definition (world setting `destrPresets`; built-ins in code)

```jsonc
{
  "id": "bomb", "v": 1, "name": "MOINENMAPS.Preset.bomb", "icon": "fa-solid fa-bomb", "set": "military",
  "gesture": "point",                     // point | throw | line | run
  "preroll": 1200,                        // ms from the click to T0
  "size": 2.5,                            // footprint radius in grid squares at size 1
  "layers": [
    { "l": "accent", "kind": "fallShadow", "at": -1200, "dur": 1200 },
    { "l": "screen", "at": 0, "shake": 0.9, "flash": 0.6 },
    { "l": "burst", "at": 0, "lv": 3, "r": 1.6 },
    { "l": "destruction", "at": 0, "type": "blast", "level": 3, "cause": "fire", "r": 1.0, "pr": { "jagged": true, "jag": 0.7 } },
    { "l": "dust", "at": 30, "dk": "shock", "lv": 3, "r": 3.5, "life": 90000 },
    { "l": "debrisFire", "at": 150, "n": [6, 12], "reach": [1.2, 3.0], "fire": { "lv": 1, "gr": 0.3, "life": [15000, 30000] } },
    { "l": "fire", "at": 1000, "n": [2, 4], "on": "rim", "lv": [1, 2], "gr": 0.6, "life": [20000, 40000] },
    { "l": "smoke", "at": 1200, "sm": 3, "r": 0.8, "life": 60000 },
    { "l": "light", "at": 0, "peak": 1, "radius": 4, "decay": 1500 },
    { "l": "sound", "at": 0, "pvfx": "explosion-big" }
  ]
}
```

- Ranges (`[a, b]`) are drawn from the firing's seed.
- Lengths are in grid squares (so a preset fits any grid) and times are in ms.
- For guns, the destruction / dust layers carry `walk` rules instead of a centre:

  ```
  { "rate": 10, "lanes": [0], "sigma": [0.25, 0.5], "sway": { "amp": 0.3, "wave": 5 }, "stray": 0.15, "r": [0.15, 0.25], "lvMix": [0.8, 0.2] }
  ```

  The heli has `"lanes": [-0.35, 0.35]`, `"phase": 0.5` and a `"mini"` share of small blasts.

### 7.2 Expanding a firing (GM only)

- `expand(def, gesture, { seed, size, power, aftermath, grid, sceneRect, now })` returns the concrete records. It is pure, has no
  Foundry, and is node-tested: the same input gives the same records, it covers every preset, and it keeps the bounds.
- The expander does all the randomness: positions, the walk, chunk counts, lifetimes. Clients only play stored data.
- Material-dependent choices (sparks on stone, smoulders on grass) read the destruction substrate's material at the GM. The result
  is stored, never re-decided per client.

### 7.3 What is written (one `scene.update`)

| Key | Contents |
|---|---|
| `destructionObjects.<id>` | One per destruction layer or lane. A normal stroke object plus `ps` (firing id), `at` (entry start, shared clock) and `pr` (per-stroke look). Its path carries the hit times for guns. |
| `fireStrokes.<id>` | Burst, fire, smoke and dust strokes, each with `q` = T0 + at, `o` = T0 + at + life, optional `gr` / `ot`, plus `ps`. |
| `presetFirings.<fid>` | The record below. |

```jsonc
{ "id": "fid", "preset": "bomb", "v": 1, "t0": 1794219436270, "seed": 1234,
  "at": [x, y], "end": [x, y] | null, "size": 1, "power": 0,
  "d": ["id", ...], "f": ["id", ...],
  "cues": [ { "k": "screen", "t": 0, "shake": 0.9, "flash": 0.6 }, { "k": "light", "t": 0, ... }, { "k": "sound", "t": 0, "pvfx": "explosion-big" } ],
  "acc": [ { "k": "fallShadow", "t": -1200, "dur": 1200, "from": [dx, dy] }, { "k": "tracer", "t": 120, "a": [..], "b": [..] }, ... ] }
```

- The accents and cues of a gun firing are arrays of hits (positions and times). That is small: 2 lanes x 20 hits is about 2 kB.

### 7.4 How it plays

- **The GM:** the click starts the bake of the destruction strokes at once and `saveNow()` writes everything. The GM's own screen
  waits for T0 like everyone else.
- **Every client:** on the flag change it schedules the cues and accents from the firing record and the shared clock. The fire,
  smoke, dust and burst strokes play by themselves (q / o). The destruction strokes enter at `at`: the display holds a `ps`
  stroke's area until `at - LEAD`, then enters it with a start in the future, as the cinematic show does. A chunk that arrives
  late enters late (up to `WAIT_LATE_MS` 1.5 s past `at`); later than that it is shown settled.
- **A late joiner, or a reload:**
  - a cue whose moment has passed is not played (no shake, flash or sound);
  - accents are a pure function of time, so whatever is still in flight is shown;
  - fires, smoke and dust are in the right phase;
  - destruction older than `ENTRY_WINDOW` shows settled.
- **Purge:** when the last `o` of a firing plus its tail has passed, the GM drops the firing record (one write). The layers purge
  their own put-out strokes as today.
- **Who sees it:** the layers' own `who` settings apply (a fire layer set to GM only hides the preset's fire from players too).
  The destruction strokes follow the destruction rules.

## 8. Risks

### 8.1 Cost on a GTX 1080 (the players' card)

Not measured; these are targets. The dev numbers in this note are from an RTX 3070 Ti. Before tuning, check with the weak-GPU
emulation (`weather-opt.mjs weak(N)`, as in the weather guard work) and DPR 1 and 2.

| Part | Budget at the peak (1080, DPR 1) | Notes |
|---|---|---|
| Burst | ≤ 0.6 ms GPU per burst at L3 while it lives (about 4 s), ≤ 3 bursts at once before the guard thins | One quad per burst on the art grid. Lobes are a loop over a few billows, capped. Its texture never exceeds its roll-up box. |
| Destruction entry | CPU per frame within the existing budgets (`ONCE_MS` 5, `enterMs` 4); chunks capped by the performance mode (high 600) | Bomb: one area. Guns: impacts merged so a firing is ≤ about 30 areas (overlapping pocks join). Many tiny areas cost more one-shot work than a few. |
| Dust | As the dust kinds now; shock ring L3 ≤ the heavy kind at L3 | The fire agent's `dust-cost.mjs` measures it. |
| Fire and smoke | Unchanged per area; fewer, merged fires (2-4 rim fires, not 12) | Fire areas merge by their burning core. Lights are capped at 24 per scene. |
| Accents | ≤ 0.2 ms; pooled sprites, ≤ 300 at once | Tracers and sparks live 2-6 frames each. |
| Lights | One flash light per burst, merged with the fire lights | No refresh of the lighting per frame (as the fire). |

- **The guard:** the burst, accents and shock dust hook into the shared frame guard (`frame-guard.mjs`, through each layer's guard
  API). The degradation must be soft: fewer lobes, embers and puffs, never squares or a different silhouette. Exactly the full
  look at q = 1. This is the same standard as the weather layer: types checked at q 1 / 0.7 / 0.5 / 0.35.
- **Stacking:** a heli run over a burning bomb site is the worst case: fire + smoke + 2 dust strokes + 2 destruction entries + a
  burst + weather. It must be measured as one stack, in the style of stack-bench.
- **"Optimising must cause no visible loss":** every cut is an A/B against the full look (pixel diff at q = 1, a judge on video
  for anything below).

### 8.2 Latency

- **Measured on the dev machine** (the table in section 3): the GM sees the bake in 0.2-0.4 s, and the chunk is named in
  0.5-0.7 s. Most of that is the 700 ms save debounce, which a firing skips.
- **Not measured:**
  - a player's download, especially through the remote host behind Cloudflare;
  - the GTX 1080 machine;
  - a GM machine with fewer cores than 20.
- **The design hides it:**
  - Pre-roll: the bomb's 1.2 s, the grenade's 1.0-1.5 s, the heli's 1.5 s.
  - The guns: the first hits land 0.6 s after the click. Their dust and sparks need no bake; a pock that comes late enters under
    its dust.
- **Must be checked live before the look work:** the first pock of an Uzi firing on a real player on the remote host. If it is
  over 1.5 s, raise the gun pre-roll or let the first hits' pocks fade in.
- **Pre-baking is a possible further step:** bake the mask while the gesture is still being drawn (the preview knows it), as the
  live brush already shows its own stroke.
- **Heavy loads** (18 strokes took 25-30 s on a loaded machine): a firing must stay at 1-3 destruction strokes. The expander
  merges, it never makes one stroke per hit.

### 8.3 Undo and redo

- Undo of a firing:
  - fire, smoke and dust put out with their own going-out;
  - burst and accents stop: anything still in the air fades;
  - destruction fades out (G6, new: today an undo pops).
  The firing record goes.
- Redo writes the same records with a new T0, so it plays again.
- **Risk:** layer-level undo (the damage brush's Ctrl+Z, the fire brush's) could take one piece of a firing. Fix: the layers'
  undo skips `ps` strokes (G6; fire `add(..., { undoable: false })` already exists). Deleting a single piece from the Damage or
  Fire panel stays possible and turns the firing partial (the firing list shows that).
- **Two GMs:** firings are independent records (one key each). Undo is per user, as the layers do now.

### 8.4 Smaller risks

- **Flag growth:** a firing writes 3-10 keys of a few kB. Gun masks are sparse and RLE-small. Settled firings drop their record.
- **Bake versions:** preset strokes are ordinary strokes, so they are pinned with the version they were baked with (the
  bake-policy rules).
- **Director:** without G10 a bomb sends about 10 events. With G10 it sends one.
- **Interplay:** the substrate rules handle damage stacking. Rain damps preset fires as any fire. Fire opens the clouds over it.
  Strong wind bends the smoke and the burst cap.
- **Reduced motion and performance Low:**
  - entries become fades, no particles, no shake;
  - the burst becomes a short fade of its smoke;
  - accents are only the static results.

## 9. Implementation tasks

Ordered. Each task ends with tests and a live check on a lane, and a real player for anything a player sees.

| # | Task | Touches | Fire / smoke / dust files? |
|---|---|---|---|
| P1 | **Preset core (pure):**<ul><li>schema and validation</li><li>the four built-in definitions</li><li>`expand()` with the walk / spread / sway generators</li><li>seeds, size / power / aftermath</li><li>node tests: determinism, bounds, merge into ≤ 30 areas, counts</li></ul> | new `scripts/presets/core.mjs`, `defs.mjs`, `dev/presets-core.test.mjs` | No |
| P2 | **Destruction hooks** (G5, G6, G10):<ul><li>`paintStroke` with path / pr / at / ps</li><li>entry start at `at` on every client (LEAD, held until then)</li><li>`removeStrokes(ids)` with a fade</li><li>`saveNow`; layer undo skips `ps`</li><li>director sources skip `ps`</li><li>tests: an old stroke without these fields is unchanged</li></ul> | destruction/destruction.mjs, model.mjs, display.mjs, director/sources.mjs, dev tests | No |
| P3 | **Explosion fire `burst`** (G1, G2):<ul><li>the kind, its art pass and its light curve</li><li>per-stroke `gr` / `ot`</li><li>guard hook</li><li>fireball identity test kept; scene-default timing unchanged</li></ul> | **fire/model.mjs, fire/burst-art.mjs (new), fire/display.mjs, fire/lights.mjs, fire/guard.mjs, fire/fire.mjs** | **Yes**: the fire agent, or after its dust work is merged |
| P4 | **Dust kinds `shock` and `hits`** (G3, G4): per-stroke speed and kick times from the path. | **fire/dust-model.mjs, fire/dust-art.mjs, fire/model.mjs** (KINDS) | **Yes**: the fire agent is in these files now, so this is its task or comes after it |
| P5 | **Accents and cues** (G7, G8):<ul><li>fall shadow, throw arc, tracers, muzzle, sparks, splash, heli shadow</li><li>Screen shake / flash with opt-outs</li><li>flash light (if not in P3)</li><li>pixel-vfx sound when present</li><li>guard hook</li></ul> | new `scripts/presets/accents.mjs`, `accents-core.mjs`, `cues.mjs` | No (unless the light goes through **fire/lights.mjs**, then coordinate with P3) |
| P6 | **Firings runtime** (G9): <ul><li>the one-update write</li><li>the firing record</li><li>scheduling on every client</li><li>late join / reload</li><li>purge</li><li>cross-layer undo / redo</li><li>`api.presets` (`fire(id, gesture, opts)`, `list`, `undo`, `settle`)</li></ul> | new `scripts/presets/presets.mjs`; calls the layers' APIs only | No (uses `api.fire` as it is) |
| P7 | **UI:**<ul><li>the Presets tool</li><li>the bar pads and controls, hotkeys</li><li>gesture and ghost previews</li><li>the dock panel (pad grid, editor with test fire, firings list)</li><li>en / pl lang, a clean lang audit</li></ul> | new `scripts/presets/section.mjs`, destruction/section.mjs (the tool), lang/*.json, styles | No |
| P8 | **Look and proof:**<ul><li>tune each preset to the WOW bar: a webm per preset, oblique view, day and night, zoom 1 and 3, with a judge</li><li>cost on a GTX 1080 by emulation at DPR 1 / 2, the stacked worst case</li><li>latency on a real player via the remote host</li></ul> | dev tools / videos only, then fixes in the owning files | Fixes may touch fire files (P3 / P4 owners) |

Dependencies:
- P1 first.
- P2, P3 and P4 can run in parallel (P3 and P4 are fire-layer work, sequenced with the fire agent).
- P5 and P6 need P1 and P2.
- P7 needs P6.
- P8 last, but measure the latency on the remote host right after P2 and P6 (it decides the pre-rolls).
- A first playable bomb needs P1 + P2 + P3 + P6 (+ the shock dust from P4 for the full read).
- The guns need P1 + P2 + P4 (`hits`) + P5 (tracers, sparks) + P6.

## 10. The user's answers (2026-11-09)

The four questions asked here were answered by the user; P1 is built on these answers.

1. **Sound: none.** Presets play no sound at all, so there is no sound layer in the format (`sound` is an unknown layer kind). The
   sound rows in sections 4, 5 (G8), 6 and 7 are dropped.
2. **Helicopter shadow: no.** The heli preset shows only the strafing trail: the hits, their dust and the tracers. No helicopter
   shadow and no rotor-wash shimmer accent.
3. **Tokens: not pushed.** Neither the bomb nor the grenade pushes tokens; no preset touches a token.
4. **Aftermath: a preset setting.** How the aftermath fire ends is set per preset as a duration slider (`aftermath.dur`, 5-600 s)
   with a "no end" option (`aftermath.dur: null`: the fires burn until the GM puts them out). A firing may override it
   (`opts.aftermath`). Each aftermath fire gets its own share of the duration (`lifeK`), so they die out one by one; the smoke column
   ends with the duration. Transient parts (the grenade's wisps) always end on their own.

## 11. P1 as built (the preset core)

- `scripts/presets/core.mjs` (pure, node-tested by `dev/presets-core.test.mjs`): the format (`cleanDef`), the seeded streams, the
  gun walk (`walkHits`), `expand()` and `areaCount()`.
- `scripts/presets/defs.mjs`: the four built-ins (bomb, grenade, uzi, heliHmg).
- `scripts/presets/write.mjs` (GM, loaded on the first firing): fire and smoke strokes with their times and the firing record
  `presetFirings.<id>` in ONE scene update; the destruction strokes through the brush's own entry (`edited()`) LEAD ms (350,
  `CONFIG.moinenMaps.presetLead`) before T0, with ids chosen up front so the record names them.
- `scripts/presets/presets.mjs`: `api.presets` (`list`, `get`, `validate`, `expand`, `fire`, `firings`). It registers no hook, no
  setting and no ticker: an unused preset changes nothing.
- `scripts/destruction/destruction.mjs` `edited()`: three opt-in stroke fields, used only by presets: `id`, `pr` (the stroke's own
  look instead of the scene's) and `keepPath` (keep the timed path, so the gun strokes follow the stroke). Without them a stroke is
  made exactly as before.

**Written now:** destruction strokes (blast / cracks with cause, own look, the guns' timed paths) and fire and smoke strokes (q / o).
**Kept as pending in the firing record** (no layer plays them yet): `burst` (P3), dust `shock` / `hits` (P4), accents and cues
(P5).

### Hooks for later (in files P1 does not touch)

- **fire/fire.mjs:** a fire stroke written straight into the flag does not get the scene's torn edges (`fresh()` adds `tn` only
  inside `add`). Presets give their fires the organic edge (`e: 1`) only. A public `addMany(raws, { undoable })` would let presets
  use the layer's own path.
- **fire/model.mjs:** per-stroke `gr` / `ot` (G2); `cleanStroke` drops unknown fields today, so the firing record holds the stroke
  ids, not a tag on the strokes.
- **fire/fire.mjs `list()`:** it shows only strokes without `o`. A timed preset fire is "put out in the future" from its first
  write, so it is not in the Fire panel's list and `clear()` does not reach it (it goes out on its own). P6 should list them through
  the firing record.
- **destruction:** the entry start `at` on the shared clock (P2) replaces the LEAD stand-in. In an unpinned (pre-0.4.2) scene a gun
  stroke's path joins its bake key only when the scene's own "follows the stroke" is on (`store.mjs objStr`). With cinematic mode
  on, preset strokes are staged like brush strokes.

### P1 checks (2026-11-09, lane 2, RTX 3070 Ti)

- `node dev/run-all.mjs` 73/73 (with `dev/presets-core.test.mjs`, 365 checks); `node dev/lang-audit.mjs` clean.
- **Unused = unchanged, hash A/B** against main 67e9d18, two runs per build:
  - scene with nothing painted: the whole frame's hash is identical (`k2c4fq`, all runs and builds); the same 91 module settings
    and 14 ticker listeners; the same scene flags;
  - scene painted through the brush paths (three discs and a timed gash path): the baked records' hash is identical (`cd5i5kb`)
    and so are the stored strokes (ids aside).
  - A pixel grab of the painted scene differs between two runs of the SAME build too (live entries and idle), so it proves nothing
    either way and was not used.
- **Firing on the GM, seen by a real player** (Test Gracz 1): all four built-ins fired at once. The player had every firing
  record, every fire / smoke stroke 1.1-1.4 s before T0, and every destruction stroke on screen 0.2-1.2 s after T0 (the four
  bakes queued behind each other; P2's `at` will start them on time). The gun strokes kept their own ids, `pr.directional` and the
  timed path; the bomb's crater its torn border.
- **Not checked:** the remote host, a GTX 1080 machine, how it looks (P1 writes the parts that exist; the burst, the new dust kinds
  and the accents are still missing, so the presets do not read as finished yet).

## 12. P2 as built (the destruction hooks, G5 / G6 / G10)

- **Timed strokes** (`scripts/destruction/timed-core.mjs`): a stroke may carry `at` (its entry start on the shared clock) and `ps`
  (its firing). Neither is part of any signature, so the bake, the chunks and the bake key are the same as without them.
  - Every client, the GM too, keeps the stroke off the screen until `at` − LEAD (cinematic LEAD, 450 ms). Then it shows it again and
    enters it with a start in the future (`timedEnter`).
  - A late chunk enters from now, up to 1.5 s past `at`. After that it is shown settled (a soft fade).
  - A start more than 60 s ahead is not believed: the stroke is never held for ever.
  - A staged stroke (cinematic mode) is timed by its show, as before.
  - A timed entry is strict: not one pixel of the ruin shows before its start. Its path runs in real time (the path times are the
    hits' own moments, whatever the entry speed and the cause's pace). Every other entry is unchanged.
- **API** (`api.destruction`):
  - `paintStroke({ discs | mask, type, level, cause, path, pr, at, ps, id, a, b })` returns the stroke id;
  - `removeStrokes(ids)`;
  - `saveNow()`.
- **Undo** (G6):
  - The brush's undo skips `ps` strokes. Redo puts a stroke back under preset strokes painted after it, which is the order a reload
    gives.
  - A preset stroke that goes dissolves out on every client in about 0.6 s, art pixel by art pixel: rim first, heart last, broken
    up by noise. Every other area fades as before (260 ms).
  - `api.presets.undo(fid)`:
    - the damage dissolves out;
    - fire and smoke go out from now (`o` = now; one that has not caught yet is dropped);
    - the record goes.
- **Writer:** the LEAD stand-in is gone. The destruction strokes are painted at once with `at` = T0 + offset and `ps` = the firing,
  and saved at once.
- **Walk runs:** the display runs a followed path in at most 2200 ms, so the expander cuts a walk into runs of at most
  `RUN_MS` = 2000 ms. Each run is its own stroke from its first hit; its path times count from 0. The keys are `lanes.0~0`,
  `lanes.0~1`, ...
- **Director** (G10): the sources skip `ps` strokes and the fire / smoke strokes a firing record names. Each new firing record
  emits one `destruction` event, weighted by the preset's size and power, framing its impact and its walk.

### P2 checks (2026-11-09, lane 2, RTX 3070 Ti)

- `node dev/run-all.mjs` 74/74, with the new `dev/presets-timed.test.mjs` (31 checks: phases, old strokes unchanged, signatures
  with and without `at` / `ps`, undo / redo order, the dissolve's timing, walk runs, wiring).
- **Unused = unchanged, hash A/B** against 8b0f9d7, two runs per build:
  - empty scene: the whole frame's hash is identical (`k2c4fq`);
  - 91 settings and 15 ticker listeners on both builds;
  - the brush-painted scene: records `cd5i5kb` and stored strokes `8908yg` on both builds.
- **A real player (Test Gracz 1) against the GM**, entry start minus `at`:
  - one firing at a time: the bomb −1 ms and the uzi +1 ms on the player, 0 ms on the GM;
  - the heli's four runs: 0..1 ms on both;
  - every heli hit is reached by the damage front at its own moment: 0 ms on the player, 0..1 ms on the GM (24 path points);
  - no ruin pixel before the start.
- **Four firings at once:** the GM bakes them one after another. On the player the bomb started +174 ms late and the uzi +753 ms
  late, because the uzi's pre-roll is 600 ms. Each entered late, as designed. The pre-rolls are P8's question.
- **Undo of a firing, on the player:** the crater dissolved in about 0.5 s, art pixel by art pixel with a ragged edge. This held
  alone and next to a plain stroke that stayed.
- **Director:** a bomb plus a heli firing gave 2 events (one each); a brush stroke still gives 1.
- **Not checked:**
  - the remote host;
  - a GTX 1080;
  - the fire layer's going-out after `undo` (written as data, not watched).

## 13. P6 as built (the firings runtime, G9)

- **One-update write:** `D.save(extra)` (destruction.mjs, `saveNow(extra)`) merges the destruction flag update with extra keys.
  `fire()` paints the destruction strokes, then writes destruction + fire strokes + the firing record in ONE `scene.update`.
- **Firing record** `flags.moinen-maps.presetFirings.<fid>`: `{ id, v, preset, t0, seed, size, power, aftermath, at, dir, gesture,
  walk, by, d: [{ id, key, at }], f: [{ id, key }], pending: { burst, dust, accent, cue } }`. `by` = the GM who fired it.
- **Runtime on every client** (`scripts/presets/runtime.mjs`; the pure rules in `runtime-core.mjs`): from the records and the shared
  clock it calls `Hooks.callAll("moinenMapsPresets", kind, data)`:
  - `("firing", { fid, rec, late })` when a record is here (written now, or found on load / late join; `late` = ms past T0);
  - `("impact", { fid, rec, t })` at T0, never after the fact;
  - `("part", { fid, rec, part, i, item, t, late })` for each pending part at its moment; a part still running on a late join comes
    with `late > 0`, a finished one is dropped, past cues are dropped;
  - `("gone", { fid })` when the record goes (undo, settle, purge).
  P3-P5 layers (burst, dust kinds, accents, cues) listen to it. Fire, smoke, dust strokes and timed damage play by their own
  `q` / `o` / `at`, so they need nothing from the runtime.
- **Nothing on an unused scene:** four hooks (`canvasReady`, `canvasTearDown`, `updateScene`, `userConnected`), each returning at
  once without records; no setting, no ticker, no flag.
- **Purge:** a record goes once everything it named is over (`purgeState`): every named fire has an `o` and is past it + 10 s, and
  every part and damage entry is over + 10 s (entry 8 s). A fire without `o` ("no end" aftermath) keeps the record. All finished
  records go in one `scene.update` of `-=fid` keys. The writer is the record's own GM (`by`) while connected, else the active GM
  (a second GM on the lane must not race it). Purged strokes keep their `ps`, so the layers' own undo still skips them.
- **Settle** `api.presets.settle(id)`: deletes the record only; the damage and fires stay as ordinary scene content.
- **Undo / redo** (per user, 50 deep): `undo(id = null)` takes the live record, or the stack copy after a purge, and writes in one
  update: fires not caught yet are deleted, burning ones get `o = now` (the fire layer's own going-out), the destruction strokes
  are removed with the P2 dissolve, and the record goes. `redo()` fires the same definition, gesture and opts with the same seed and
  a new T0. A new `fire()` clears the redo stack.
- **Timed fires through the record:** `api.presets.fires()` lists the burning / waiting preset fires (`{ id, fid, preset, k, o, q }`),
  `clearFires()` puts them out (`o = now`, or deletes those not caught yet), `firings()` gives each record with its state
  (`coming`, `playing`, `burning`, `settled`) and a `partial` flag.
- **API:** `api.presets` = `VERSION, AFTERMATH, HOOK, list, get, validate, expand, fire, undo, redo, settle, clearFires, firings,
  fires` (+ `_status` for tests).

### Hook needed in the fire files (not touched by P6)

- **fire/fire.mjs `clear()` / `list()` and the Fire panel (fire/section.mjs):** they still see only strokes without `o`. A timed
  preset fire has a future `o` from its first write, so the panel's list and its Clear button do not reach it. The panel calls the
  internal functions directly, so wrapping `api.fire` does not help. Ask the fire agent for one of:
  - `list()` / `clear()` also take strokes whose `o` is in the future (put out = `o = now`); or
  - `clear()` calls `Hooks.callAll("moinenMapsFire", "clear")` (and the list asks `Hooks.call("moinenMapsFire", "list", out)`), so
    presets can answer with `clearFires()` / `fires()`.
  Until then the presets' own `fires()` / `clearFires()` (and P7's firings list) are the way to reach them.

### P6 checks (2026-11-09, lane 2, RTX 3070 Ti)

- `node dev/run-all.mjs` 75/75, with the new `dev/presets-runtime.test.mjs` (36 checks: timeline, late join, purge rules, undo
  of fires, burning / state, the runtime simulated with stubbed Hooks / canvas / game incl. the purge owner, the built-in plans).
  The core test checks the four hooks and the early returns.
- **Unused = unchanged, hash A/B** against 7a150de (the baseline build really loaded: no runtime in its API):
  - empty scene: frame hash `k2c4fq` on both, 91 settings, 15 ticker listeners;
  - the brush-painted scene: records `cd5i5kb` and stored strokes `8908yg` on both. (Its pixel hashes `px` / `bm` differ between
    two runs of the same build, so they are not an A/B measure.)
- **A real player (Test Gracz 1) against the GM:**
  - uzi: the player got destruction, paths and the record in ONE update; `impact` at −4 ms; purged about 18 s after T0
    (8 s entry + 10 s tail), the player got `gone`;
  - bomb (aftermath 20 s), player reloaded 0.79 s after T0: `firing` (late 789), `burst` and `dust` late; no impact, no cues; the
    crater entered; 13 fires;
  - player reloaded at T0 + 11.7 s: only `dust` (late); the crater shown settled; the timed fires listed by `fires()`;
  - `settle`: the record went, the player got `gone`, the damage stayed;
  - **undo of a burning bomb (aftermath 60 s), recorded on the player:** the flames shrink and the smoke fades within about 2 s
    (the fire layer's going-out), the crater dissolves; afterwards no records, no damage, and the fire layer purged its strokes.
- **GM:** redo after undo: same seed, same damage keys, new T0 (+7.0 s), stacks `undo: [new fid]`, `redo: []`. `clearFires()` on
  a bomb with aftermath 60: 16 timed fires → `o = now`, `fires()` empty, the record stays `playing` until its dust is over.
- **Not checked:** the remote host; a GTX 1080; the purge of a bomb after its 90 s dust (rule tested in node only); two GMs firing
  at once live.

## 14. P7 as built (the presets UI)

- **Tool:** `mm-d-preset` in the Destruction section (order 7, icon `fa-table-cells-large`, not `fa-bomb` as planned: the bomb
  reads as one preset, the grid as a board of pads). Picking it the first time reveals the `presets` dock panel (registered
  `open:false`) and scrolls it into view.
- **Bar:** pads (icon, name, hotkey, gesture glyph), Size (0.5-2), Power (-1/0/+1), Variation (dice), aftermath range 5-600 s with
  an ∞ "no end" toggle and a reset ("—" for a gun pad), hint. Keys while the tool is active: 1-9 / Shift+1-9 arm a pad, `[` `]`
  size ±0.1, Esc cancels a drag, Alt = repeat the last seed, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y = undo / redo.
- **Gesture:** click = drop, drag = line or throw (from the controlled token when the press starts on it). The release fires
  `api.presets.fire(effective(def), gesture, fireOpts(def, bar, seed))`.
- **Ghost:** the seed is drawn before the release, so the ghost is the exact plan (`expand` with that seed). Soft feathered discs /
  rings / dots in a container with a BlurFilter; no squares, no hard edges; fades in 180 ms, out 220 ms; after a release it stays
  hidden (quiet zone) until the pointer moves 0.75 grid, so it never covers the real explosion. Squashed on the ground, lifted
  for heights (view-angle).
- **Panel:** draggable pad grid (order = hotkeys); the armed fold (Test fire, Duplicate, Edit, Delete with a confirm); the editor
  (name, icon, lead-in, aftermath with ∞, timeline with draggable bars snapping to 50 ms, layers with an on/off switch that writes
  `off:true`, per-layer fields; a draft is saved 350 ms after the last change); the firings fold (rows with age and state, per-row
  undo and settle, Take back / Fire again / Put out fires). The list refreshes after every awaited action and every 2 s.
- **Test fire:** a local dry run at the view centre: the ghost timeline plus the presets hook with `test:true`; nothing is written.
- **Settings:** `destrPresets` (world: custom presets + order) and `presetBar` (client). The CSS lives in styles/maps.css (a new
  manifest stylesheet needs a world restart).
- **Nothing runs for anyone who does not open the tool:** the canvas layer, the 8 listeners and the hook are built only on tool
  activation. Hash A/B vs 3267077 on lane 2: GM frame `eaaw2s` = baseline, player frame `1fdzrlq` = baseline, ticker listeners
  15 = 15, records and objects equal; settings 93 vs 91 (the two new ones).
- **Verified live (lane 2, real CDP input):** the four pads by hotkey and gesture; size keys; vary off repeats the seed; keyboard
  undo/redo with consistent stacks; duplicate / layer off / timeline drag / delete; test fire writes nothing; settle and per-row
  undo; a real player login (Test Gracz 1) gets no tool, no panel, no ghost layer, and `fire` returns null.
- **Seen, not tuned (gun agent's area):** the Uzi hits barely read at play zoom.
- **Not checked:** the remote host; a GTX 1080; two GMs using the board at once.

## 15. P3 as built (the explosion fire `burst`, G1 / G2)

- **Stroke** `{ k: "burst", p: [x, y], r, lv, q, c?, db?: [dx, dy, ms, ...], wd, ws, o? }` in `fireStrokes`. The pure part is
  `fire/burst-model.mjs` (levels `BURST_LV`, the area `burstRect`, the motion `burstAt`, the light `burstLight` / `burstGain`). The
  look is `fire/burst-art.mjs` (`BurstArt`, on FireArt's contract).
  - It is one area of its own: never merged, no erasers.
  - It lives `life` s from q (L1 2.2, L2 5, L3 8.5), then it is gone and the GM purges it.
  - `o` takes it back: it fades in 0.6 s. Reduced motion shows no burst.
  - Its area is every body of its motion at every frame, at the four corner views (lift 0 to 0.8, squash 0.6 to 1), plus the
    wind's drift. Nothing it draws is cut by its rectangle.
- **Motion:** computed on the CPU per 12 fps art frame and sent as uniform arrays: up to 64 billows, 40 sparks and 16 debris.
  - Billows: a white-hot core, a fireball thrown out with drag, a buoyant rise, the cap spreading and rolling, a stem at L2-L3.
  - Ground surge: billows of the ground's own dust.
  - Sparks fly ballistic and cool through the ramp.
  - Debris chunks fly to their landing points.
- **Look:**
  - Each billow is drawn back to front with a lumpy edge and is lit from the top left.
  - A dark crease where a billow overlies another, so it reads as a cauliflower, never a disc.
  - The colour sinks from the outside in: ramp, then fire-lit brown, then the column smoke tones (L3; a dirty dust mix at L1).
  - Late in its life and on a take-back it erodes in blobby holes, the top billows first.
  - Ground: a heat pool and the cloud's shadow (multiply).
  - Emission: the flames, sparks and chunks glow; the fire-lit smoke glows at half.
- **Light:** one light per burst, joined to the fire lights. It has no 700 ms fade-in: a flash peaks at 50 ms and decays (L3 about
  1.3 s). It never takes over a fire's light, and no fire light takes over its light.
- **Guard:** `fire/guard.mjs burstDetail` thins the sparks only (never under a quarter). The billows (the silhouette) never
  change.
- **Per-stroke timing (G2):** fire and smoke may carry `gr` / `ot` (s). Strokes are merged only with strokes timed the same way.
  An area carries `tm`, and FireArt and its lights use it. A stroke without them is byte-identical.
- **Timed fires (fix):** a fire or smoke stroke whose `o` is still to come burns as one without `o` until then: it catches at its
  `q` and grows in. Before this fix a preset's aftermath fire was drawn burning from its first write, up to 1.4 s before the
  impact.
- **Fire panel (section 13 hook):**
  - `list()` / `clear()` and the row edits take strokes whose `o` lies in the future (`model.burningAt`).
  - `remove()` puts burning ones out and deletes the ones not caught yet (`model.putOutPlan`); undo / redo handle that drop.
  - New `prepare` / `addMany`: the torn edges for writers. New `api.fire.burst(x, y, opts)`, and `paint` gains
    `grow / out / at / debris`.
- **Presets (small):**
  - `write.mjs` writes fire / smoke through `fire.prepare` and each pending burst as a burst stroke named in `f`
    (`pending.burst` is then empty).
  - Its debris chunks land where and when the debris fires catch. Their catch times are spread by distance.
  - `core.mjs` passes the layer fields `gr` / `ot`. `defs.mjs` sets `gr` on the bomb's rim / debris and the grenade's wisps /
    smoulder.

## 16. The guns as built (uzi, heliHmg: presets-guns)

The user: the heli strafe was weak ("only two hits"). A strafe must read as a violent, natural run seen from the oblique view: many
distinct hits opening in sequence along the walk, a believable spread, a slightly random path, at zoom 0.6-3, day and night.

- **Walk timing** (`presets/core.mjs walkHits`): the shot interval `dt` is a whole number of `DT_STEP` (2.5 ms); hit `i` of lane `j`
  lands at `(i + phase[j]) x dt`, the run lasts `n x dt`. A shooter given (`gesture.from` within 0.75 squares of the drag's start)
  moves the first hit 1.2 squares out. `plan.walk.dt` is kept.
- **Pocks** (destruction, timed path strokes, one per lane and 2 s run): small jagged blasts (`impact`, low rubble / debris /
  scatter, pinned `pr`), a few small craters (heli `minis`). Gun strokes (`cause-fx.mjs isGun`: a path stroke of a preset) skip the
  area-wide blast look that made the old run read as two blobs: no shock ring, no shadow, no dust skirt, no rolling path flashes
  (`display.pathEffects`). Their chips, the chunks that stay (`debris.throwRest(.., at)`, a short hop from beside the spot) and
  the night rim (`g.glowIn` after the walk) all follow the walk: nothing shows before its bullet lands.
- **Hits dust** (fire layer, `fire/dust-model.mjs` kind `hits`): written at once as fire-layer dust strokes, one per lane and
  unbroken run (`s = dt / HIT_DT`, `q` = the first hit). Each hit kicks its own cells and `per` emitters at `q + k x dt`, thrown
  radially (the heading points back at the hit), rising fast (own `riseK` / `jetK` in a 5th kind table row) and gone in about
  2 s; in the ground's own colour, moonlit at night. The table grew from 16 to 24 codes (`CODE_N` 32 in the cell packing); the
  old kinds are unchanged (tested).
- **Accents** (`presets/accents*.mjs`, every client, only while a gun firing is live): tracers (every 4th round of EACH heli gun,
  from behind and above along the run, some ricochet), hit flashes with sparks, the muzzle flash and pale bullet streaks with a
  shooter (uzi), a short warm ground glow per hit at night (illumination, MAX_COLOR), a small screen rumble for the heli (StageShaker,
  never with noShake / reduced motion). Art pixels in the primary group (sortLayer 820). Reduced motion: no accents.
- Tuned values live in `defs.mjs` (uzi: rate 14, sigma 0.18-0.36, pocks r 0.10-0.14, dust L1; heli: two lanes, rate 9, tracers
  every 4, pocks r 0.18-0.26 + 6 % minis, dust L3, life 6 s).

### Guns checks (2026-11-09, lane 3, RTX 3070 Ti, DPR 2)

- `node dev/run-all.mjs` all pass, with the new `dev/presets-guns.test.mjs` (76 checks: beat, dust strokes and their cleaning, the
  dust field's kicks per hit, accents determinism / spans / both guns' tracers / muzzle only with a shooter, the wiring).
  `dev/destruction-cause.test.mjs` lists the guns commit (`c47949c`) as a cause-code commit (display only; the bake is unchanged).
  `node dev/lang-audit.mjs` clean (no new strings).
- **Unused = unchanged, A/B against 3267077** (lane junction flipped to a detached checkout and back, two runs each, blank test
  scene): frozen-clock frame hash `ogwy91`, 91 settings, 13 ticker listeners; brush discs: records `cd5i5kb`, strokes `323h1f`;
  `dev/dust-hash.mjs` fire / smoke / dust shots identical (`27c3881c`, `db0dd482`, `16b63806`, `ca64e437`).
- **Cost** (`dev/guns-cost.mjs matrix`, at the busiest moment, GPU per frame median / p95 ms, weak 2 = dust and accents drawn twice):
  heli z1: none 1.03 / 2.91, w1 1.21 / 3.29, w2 1.21 / 3.10; z3: none 0.98 / 2.33, w1 1.35 / 3.31, w2 1.62 / 3.61.
  uzi z1: none 1.33 / 3.02, w1 1.03 / 2.66, w2 1.04 / 2.60; z3: none 0.97 / 2.27, w1 1.13 / 2.93, w2 1.50 / 2.96.
  CPU ticker step median 1.2-1.4 ms (heli), 0.7 ms (uzi). The pocks' entry is not weak-emulated.
- Recordings (not committed) in `dev/out/guns/`: each gun at zoom 1 and 3, day and night (heli also at zoom 0.6); before | after against 3267077;
  5x crops; a real player (Test Gracz 1) watching a heli run fired by the GM.
- **Not checked:** a GTX 1080 (only the weak-2 emulation); the remote host; two guns fired at once; a run across a
  scene edge.

## 17. The blasts as built (bomb, grenade: presets-boom)

The bar: the whole firing reads as ONE natural explosion, from the click to the settled ground, and the ground keeps a dust haze
for minutes after it (the user, G2: "a dust haze that stays for a long time, about 5 minutes").

- **Shock dust** (fire layer, `fire/dust-model.mjs` kind `shock`, written by `presets/core.mjs` as one dust stroke at the impact,
  `q` = T0 + its `at`): no path, the stroke's point is the blast's centre and `r` the shock wave's reach. Every cell is kicked when
  the ragged front reaches it (`shockAt`: fast, slowing with drag, the rim at ~2.2 tau); the emitters lie on rings round the centre
  and throw their puffs outward (the heading points back at the centre: the radial flag, as hits); chips skitter out low, grit
  lands, the aura rises. Level 1 a grenade, 3 a bomb.
- **The haze** (shock only, `KIND.shock.haze` s by level: 150 / 240 / 300; core `SHOCK_HAZE` keeps the stroke alive at least that
  long + 5 s): the aura does not stop at a veil - it hangs as a pall of the ground's own dust (by day paler than the soil, so it
  reads on a light ground; moonlit at night), spreads past the rim by up to `HAZE_GROW` x the aura over the first minutes, churns
  and drifts with the wind (the aura's drifting noise), is thinner over the crater (the blast threw its dust out: the ruin stays
  readable), and thins over the second half of its life (its pixel bands shrink and break into patches; grit and film go with
  it) - nothing pops: the stroke's own `o` comes after it has gone. MOTES (the weather dust's approach, `weather/fx-glsl.mjs`
  motes, re-done in the dust art pass - the weather layer is not touched): hashed slots per world tile, 6-10 s lives, a slow
  Brownian sway riding the wind, one art pixel each in the dust's tones, fewer where the haze is thin.
- **Cost of the minutes:** the lazy puffs of a blast stop after `linW` s (10 / 14 / 18), and an area of blasts only (`puffEnd`)
  then skips its emitter loop: for the haze's minutes the art pass is the ground part alone (aura noise, nine mote hashes) at
  12 fps.
- **Accents** (`presets/accents-core.mjs`, drawn by `accents.mjs` - the guns' layer, now loaded for any record with accents or cues):
  - bomb `fallShadow`: a dithered shadow on the mark (hashed 2 x 2 clusters, two dark steps at low alpha) wide and faint while
    the bomb is high, tightening and darkening as it falls; the bomb itself in its last 4.5 squares - a dark finned teardrop
    nose-down with a pale air streak (a glint at night), falling screen-down faster and faster.
  - grenade `throwArc` + `bounce`: an olive egg tumbling along the aim's arc (the ghost's apex: 35 % of the throw), its small
    shadow under it; it lands short of the mark (`BOUNCE_BACK`), squashes, kicks a few grains of dust, hops, rolls onto the mark
    and lies still until it goes off. A click throw (no distance) drops on the mark and hops in place.
  - cues: the screen cue shakes the stage (up to `SHAKE_PX` x shake screen px, easing in, dying away over 250 + 650 x shake ms)
    and flashes a warm overlay (`flash`, 210 ms), both weighed by the distance from the view, never with noShake / noFlash /
    reduced motion; a light cue is a decaying warm ground glow, left out when the firing has a burst (the burst lights itself).
- **Fixes on the way (one natural explosion):** the burst's heat pool was drawn before the impact (`uAge < 0` in the pre-roll made
  `exp(-uAge / 0.45)` grow: an orange disc by day, a lit disc at night, for the whole pre-roll) - now nothing before T0
  (`fire/burst-art.mjs`, one line).
- **Measured** (lane 3, GTX 1080, DPR 2, 3168 x 1584, `dev/boom-cost.mjs` timeline, one firing, n = 150 per row): GPU median
  1.00 - 1.07 ms per frame at every lead (-0.2, 1.6 - 5, 19 - 24, 89 - 94, 239 - 244 s) and zoom (1, 3), weak x 2 included, against
  0.97 - 1.03 ms with nothing fired; CPU median 0.5 - 1.2 ms (none: 0.4 - 1.2); no long frames. The haze minutes (90 s, 240 s) read
  the same as the empty scene. (The timer spans the whole ticker step; a blast's delta stays inside the run-to-run noise.)
- **Checked:** hash A/B against d5bf9ce on a blank ZZ scene (frame, dust-hash series, paint records / strokes) identical - the shader
  changes leave the old kinds untouched; a player (Test Gracz 1) sees the whole firing, a reload at 40 s still shows the haze, the
  GM's undo takes it out on the player within seconds; reduced motion: no burst, no accents, the dust at rest, the haze thins on the
  clock. Not fixed (pre-existing in d5bf9ce): a grenade's white specks ~200 ms before its impact.

## 18. Lightning strike (uderzenie pioruna): design

The user (verbatim): "dodaj nowy uderzenie pioruna". A fifth pad in the board, same bar as the others: WOW, natural and organic, no
squares or area edges, smooth in and out, the oblique top-down view, readable at zoom 0.6-3 by day and by night. No sound, nothing
pushes tokens, the aftermath fire's duration is the preset's setting with "no end".

### 18.1 How it reads at the table

Gesture: a click on the target (a drag sets the side the bolt leans in from). Lead-in 1000 ms.

**In one breath:** the air over the spot starts to crackle with tiny blue sparks; the sky flickers twice; a faint violet stepped
leader feels its way down the screen in jerks, forking, while thin streamers reach up from the ground to meet it; they touch - and a
blinding white channel slams down from above the top of the screen to the ground, branches lit, the whole screen flashes cold white
(at night the whole view is lit for an instant), the ground jolts. The channel flickers: two or three restrikes down the same path,
each a flash. Electric arcs race out over the ground and die in flickers, molten droplets spray and cool from white to red, a puff
of soil and steam. The channel fades violet, top first, by pixel dropout. Left behind: a small fused scar (the planned branching
burnt trails were dropped, 18.4), a glowing molten point that cools, steam and smoke drifting off, and here and there a
small fire catching in the grass.

### 18.2 The timeline (lv 2, size 1; ms from T0)

| t (ms) | Layer | What |
|---|---|---|
| -1000 to -60 | accent `strike` | CRACKLE: single-pixel blue sparks flicker within ~0.5 sq of the target, denser as T0 nears (anticipation; marks the spot). |
| -760, -560 | accent `strike` | SKY FLICKERS: a faint cold screen flicker (and at night a faint lift of the whole view's light). |
| -320 to 0 | accent `strike` | STEPPED LEADER: a dim violet branching channel descends from above the screen in visible steps (each step lands at once), its tips brighter; dead-end branches probe. |
| -220 to 0 | accent `strike` | STREAMERS: 2-4 short, faint upward sparks from the ground near the target; the one under the leader connects. |
| 0 | accent `strike` | RETURN STROKE: the whole channel lights white bottom-up in two frames; branches lit. A blue first ring (normal blend: it reads on a pale map) and stepped additive glow bands. Screen flash (cold, screen blend), at night the view's light and a big local ground light. |
| 0 | cue `screen` | Shake 0.55 (accents layer: opt-outs, distance), no warm flash. |
| 0 to 400 | accent `strike` | SURFACE ARCS: 5-7 jagged forking arcs race out over the ground (110 ms) and flicker out tip-first. PLASMA point: white-hot at the base, then cools to a molten orange point (to ~900 ms). |
| 0 to 900 | accent `strike` | MOLTEN SPRAY: droplets thrown out and up, gravity, cooling white > yellow > orange > red, a short trail. |
| ~80, ~190, (~320) | accent `strike` | RESTRIKES: the main channel again (no branches), weaker each, each with a flash. Between them a dim continuing glow. |
| last + 0-300 | accent `strike` | AFTERGLOW: the channel fades violet, thinning (side pixels first), top first, by dithered dropout. |
| +10 | dust `shock` L1 | Soil thrown out in a low ragged ring (reach ~1.2 sq) and the long thin haze. |
| +40 | destruction | The SCAR: blast L1 cause lightning, r 0.45 (fused core, glass beads). Opened under the flash. (As built: the planned cracks L2 lightning stroke for the branching trails was DROPPED - at night the destruction layer lights a cracks-lightning area as a pale disc with a hard edge; see 18.4.) |
| +250 to 14 s | smoke L1 | Steam and smoke wisps off the scar. |
| +400 to 1200 | fire L1 | 1-3 small grass fires near the scar (aftermath: their share of the preset's duration, default 40 s, or no end). |

### 18.3 How it is built

- **One accent kind `strike`** (core.mjs ACCENTS gets the name; the item is the generic accent `{ id, kind, at, dur, lv }`, its place,
  side and size come from the firing record: `at`, `dir`, `size`, `seed`). Drawn by NEW files: `presets/lightning-core.mjs` (pure,
  node-tested: the timing, the current I(t), the geometry and its data texture) and `presets/lightning.mjs` (every client: the meshes,
  the overlay, the night light), wired by `presets/lightning-wire.mjs` (presets.mjs registers it, like the accents). The accents layer
  ignores the kind (its own kinds only), so nothing there changes.
- **Geometry, once per firing and client:** the channel is a 3D random walk from ~44 sq above the target down to it (a slow wander,
  a mean-reverting zig-zag per step, a fine kink per segment), with branches and twigs that walk down and away (each with the
  leader's arrival time), streamers and ground arcs; projected with the scene's view lift (at least 0.4: a pure top view would
  flatten the bolt into a point). It is rasterised on the destruction art grid into a DATA TEXTURE: per art pixel its class (main
  core, its side pixels, branch, twig, streamer, arc, plasma), its arrival time, the distance to the nearest core (a chamfer
  transform: the glow bands) and a dropout hash.
- **Drawing:** one shader over only the occupied 16 x 16 blocks of that texture: per frame only uniforms change (time, the strokes'
  times and strengths). Crisp art pixels (texelFetch), premultiplied output: the core and first ring opaque, the glow bands
  additive. The same shader in the illumination (MAX_COLOR) is its emission at night. The molten spray and the crackle are a few
  pixels drawn on the CPU (as the gun accents).
- **Cost:** one texture upload per firing (a few hundred kB), a handful of blocks per frame for ~1.6 s; nothing after it.
- **Reduced motion:** no strike accent (the scar, dust, steam and fires are the result). The guard thins the spray only.

### 18.4 As built and checked (branch presets-lightning, 2026-11-09)

- **Files:** NEW `scripts/presets/lightning-core.mjs` (pure), `lightning.mjs` (renderer), `lightning-wire.mjs` (two listeners),
  `dev/presets-lightning.test.mjs` (definition, determinism, timing, frameAt phases, geometry and data texture, spray / crackle,
  wiring), `dev/lightning-cost.mjs` (the cost over the strike's whole life). Edited: core.mjs (ACCENTS + "strike"), presets.mjs
  (registerLightning), defs.mjs (the built-in, set "nature"), lang en / pl (name, hint, accent name), the two preset tests that list
  the built-ins.
- **Night light:** the whole view lifted for the flash frames (a view rect in the illumination, MAX_COLOR) plus a ground pool round the
  strike (7 squares). The pool is a SMOOTH 128 px texture, linear-filtered, soft falloff with a gently lobed rim: a first version
  (48 px, stepped bands, hashed 2 x 2 cells, NEAREST) stretched over 14 squares lit the map in big blocky squares - a light has no
  pixel grid. The bolt's own emission (the shader in the illumination) stays crisp on the art grid.
- **Dropped:** the cracks L2 lightning "trails" layer. At night the destruction layer's cracks-lightning area glows as a pale disc with
  a hard round edge (the destruction cause-fx, not this preset; reported). The scar is blast L1 r 0.45 alone.
- **Reduced motion:** the strike accent is skipped (the scar, dust, steam and fires remain); clients with no flash / reduced get no
  screen overlay. The shake is the preset's screen cue (accents.mjs), so its own opt-outs apply.
- **Checked live (lane, GM DPR 2, ZZ-ltn):** zoom 1 and 3, day and night, click to settled; 5x crops in motion; a real player
  (Test Gracz 1, another origin) sees the leader, the strike, the flash and the fires; the panel's test fire draws the strike and
  writes nothing; the pad sits in the bar and the panel (5th, hotkey 5).
- **Cost (lightning-cost.mjs, lane GM, DPR 2, 3200 x 1800, every frame from T0 - 1000 to T0 + 1600):** CPU median +0.3 ms, p95 ~1.2 ms
  over the empty view's 0.3 / 0.5-0.8 ms; GPU within the empty view's noise (median ~1.5-2.4 ms, p95 ~3.3-4.6 ms for both) at zoom 1
  and 3, weak x1 and x2, day and night; no frame over 16.7 ms except one weak x2 outlier in one of three runs.
- **Unused = unchanged (A/B vs eb85f59 on the lane, ZZ-ltn wiped):** the same blank frame hash, ticker listeners (14), settings (93),
  stage nodes (157) and scene flags; the only difference is one more listener on moinenMapsPresets and on canvasTearDown (the wire,
  returning at once without a strike record). lightning.mjs / lightning-core.mjs are not loaded until a strike firing arrives.

## 19. The shooter (the guns' source token: presets-source)

The user (2026-11-09): for firearms show the muzzle flash at the SOURCE token; the GM picks it; no source, no muzzle flash; the uzi's
pointless flash where the first bullet lands goes.

- **Firearm** = a preset with a walk (`ui-core isFirearm`): the uzi, the heliHmg and any copy of them. The bomb and grenade are not.
- **Choosing**, in the bar (only for a firearm): the "Shooter" block shows the chosen token (its picture and name) or "None";
  the button arms PICK mode (`aim.setPicking`: the next click on a token takes it, hover ring on the candidate, Esc or a click
  off the tokens cancels); the person-check button takes the selected token; the x clears it. On the map: **S over a token**
  makes it the armed gun's shooter (S over the shooter again: none). Each gun remembers its own shooter on each scene
  (`presetBar.src["scene:pad"] = tokenId`, client setting, at most SRC_MAX = 40, the oldest dropped). A deleted token = none.
- **Precedence**: the chosen shooter wins over a token the drag starts on (a target). With none chosen, a LINE dragged out of a
  token makes it the shooter for that burst (the old behaviour); a RUN never takes a token (only a chosen gunship).
- **Shown**: a soft feathered orange ring (#ffb347) round the shooter while the tool is in hand (fades in, follows the token);
  the ghost adds a fainter line of fire from the shooter's edge to the first hit.
- **The look** (`accents-core muzzleOf`): the barrel sits at the shooter's edge toward each hit (0.85 x its radius, never past half
  way); every round flashes (the heli: a heavier, longer star, both barrels side by side, `twin`); the rounds fly from the barrel
  as short streaks (BULLET_MAX 400 ms of flight); the heli's tracers leave the gunship. Without a shooter the heli is an
  off-map gunship as before (tracers from above, no muzzle). The heli's muzzle layer sits AFTER its tracers / hits so their
  per-item seeds are unchanged.
- **The "flash at the first bullet"** was not the muzzle: the destruction stroke's fract starburst (cause-fx, the area's radius,
  centred on the gun stroke's origin = the first pock) and its pale front particles. Both are skipped for gun strokes
  (`isGun`, commits 6457d70, 5b4448d); each pock keeps its own hit flash and chips.
- **Checked:** offline A/B vs eb85f59 (dev/out/src/ab-offline.mjs, not committed): without a shooter every built-in plan, accent
  frame (t -1.2..6 s), ghost and the cleaned bar identical (4729/4729); live hash A/B on a blank ZZ scene (frame, ticker count,
  settings count, scene flags) identical. Live on lane 3: pick mode, S key, the x, the ring, the ghost's line of fire; uzi with
  and without a shooter, heli with the gunship (fired from it even when the drag starts on another token) and without; a real
  player (Test Gracz 1) sees the uzi's muzzle flash at the shooter. Custom copies saved before this keep their own layers (a
  heli copy has no muzzle layer: its tracers still fly from a chosen gunship).

## 20. Rocket / RPG (rakieta): design

The user picked it from a list: "rakieta / RPG: smuga dymu od tokenu źródłowego do celu, potem wybuch". A sixth pad with the same
bar as the others (WOW, natural and organic, no squares or area edges, smooth in and out, the oblique view, readable at zoom 0.6-3
by day and by night, optimise only with no visible loss). No sound, nothing pushes tokens, and the aftermath fire's duration is the
preset's setting with "no end". It is a FIREARM in the sense of section 19: it has a shooter, and with no shooter there is no launch
flash (the user: "jeśli nie ma wybranego źródłowego tokenu, nie wyświetlaj muzzle flash").

### 20.1 How it reads at the table

**In one breath, with a shooter:**
- A hiss at the shooter's back: sputtering sparks and a few thin wisps for a third of a second.
- The launch: a sharp flash at the muzzle and a hot BACKBLAST out of the tube's rear. It turns at once into a big billowing cloud
  of grey-tan smoke and dust thrown backwards.
- The rocket leaves fast and keeps accelerating: a dark dart with a white-hot motor flame flickering behind it, a slight corkscrew
  and a gentle lob, its small shadow running on the ground under it. A short way out its sustainer kicks in with a small flash.
- Behind it a SMOKE TRAIL is laid down where it passes: white-hot and orange right behind the flame, then lumpy white-grey smoke
  that swells, rises a little up the screen, drifts with the wind and wanders into a wavy line.
- It slams into the target. The shell-sized fireball (burst L2) rolls up into a short dark column, the screen jolts and flashes a
  little, a ragged shock ring of the ground's dust runs out, and burning debris arcs out.
- Left behind: a charred, torn crater, small fires at its rim and where the debris fell, a thin smoke column. The trail hangs for a
  few seconds, the shooter's end first, breaking up into blobby patches, and is gone. The backblast cloud settles the same way.

**With no shooter** (none chosen, and the drag did not start on a token) there is no hiss, no launch flash and no backblast. The
rocket comes in from off the map: from 11 squares out, high, along the drag (a drag sets the direction it comes from) or from a side
chosen by the firing's seed (a click). Its trail grows out of nothing (the far end fades in by dropout, never a hard start), and it
hits as above.

### 20.2 The gesture: `shot` (a new gesture, glyph fa-location-crosshairs)

- **A chosen shooter** (the bar's Shooter block, or S over a token, exactly as the guns in section 19): a CLICK is the target, and
  so is a drag's release. The rocket leaves the shooter's edge towards the target at shoulder height (0.32 sq).
- **None chosen, a drag started on a token:** that token is the shooter for this shot; the release is the target.
- **None chosen, a drag from the ground:** no shooter; the release is the target and the drag sets the direction it comes from.
- **None chosen, a click:** no shooter; the click is the target and the direction is the seed's.
- **The ghost:** a dotted, lifted flight line from the launch point (or the far approach) to the target, and the crater, burst and
  shock ring at the target. The shooter's ring is drawn as for the guns.

### 20.3 The timeline (lv 2, size 1; ms from T0, the impact)

| t (ms) | Layer | What |
|---|---|---|
| -1100 to launch | (quiet / bake) | The GM bakes the crater, players fetch the chunk. With a shooter, the last ~320 ms before the launch are the HISS (sparks, wisps at the tube's rear). |
| launch = -F | accent `rocket` | F (the flight) = 200 ms + 45 ms per square, 280-900 ms with a shooter (a point-blank shot is quick, a long one is seen); 950 ms from 11 squares out without one. Launch flash and backblast (shooter only). |
| -F to 0 | accent `rocket` | The flight: body, motor flame and ground shadow. It accelerates (s = 0.35 u + 0.65 u² of the way; nearly even without a shooter), lobs slightly (height peak min(0.5 sq, 0.05 x distance)), bows (seeded, up to 0.6 sq) and corkscrews (0.045 sq). The trail is laid down behind it. A sustainer flash a short way out. At night: a moving warm ground light under the flame; the launch flash lights the shooter's ground. |
| 0 | cue `screen` | Shake 0.6, a short warm flash 0.3 (opt-outs and distance: accents.mjs). |
| 0 | burst L2 r 0.85 | The fireball, its short column and its light. Its debris land where the debris fires catch. |
| 0 | destruction | Blast L2, cause fire, r 0.7, jagged. |
| 20 | dust `shock` L2 r 2.2 | The ground's dust ring and its long haze. |
| 150-900 | fire L1 debris | 3-6 small fires where burning debris fell (aftermath share). |
| 700-1100 | fire L1-2 rim | 1-3 fires on the crater's rim (aftermath share). |
| 1200 | smoke L2 column | A thin column (aftermath: it ends with the duration). |
| 0 to ~4500 | accent `rocket` | The trail and the backblast cloud dissolve by blobby dropout, oldest first. The trail's last stretch is lit warm by the fireball for a moment. |

The aftermath default is 45 s (or no end).

### 20.4 How it is built

- **Data (core.mjs):** `GESTURES` gains `shot` (c = the target, as for a throw); `ACCENTS` gains `rocket`. The expander stores the
  rocket's flight in its accent item:

  ```
  { id, kind: "rocket", at, dur, lv, to: [x, y] (the target), m: [x, y] (the launch point at the shooter's edge, or the far
    approach), z0 (px), fl (ms), shot (a shooter: hiss, flash, backblast), from?, fr? }
  ```

  Without a shooter the approach side comes from the seed (its own stream: no other layer moves). Every client builds the same
  flight from the item.
- **The pure part (`presets/rocket-core.mjs`, node-tested):** the flight geometry (path samples, passage times, heights), the rocket
  at time t, the trail's samples for a frame (each sample's age, swell, rise, wind drift and wander, and its density as it
  dissolves), the backblast and hiss billows, the CPU art pixels (motor flame, body, shadow, sparks, flashes) and the lights.
- **The renderer (`presets/rocket.mjs`, every client; loaded by `rocket-wire.mjs` on the first record with a rocket accent):**
  - SMOKE: one shader evaluates the trail and the billows per ART CELL into a render texture of the trail's box (one texel per art
    pixel, so the cost is cells, not screen pixels). The trail is a lumpy tube round the displaced sample polyline: its radius
    swells with age and wobbles in lobes along the trail, and its edge is ragged by noise. It is lit from the top left in three
    tones and a dark rim, coloured by age (white-hot and orange behind the flame, warm-lit, then white-grey), and dissolves by
    blobby value-noise dropout. The texture is drawn NEAREST on the art grid: crisp art pixels at every zoom, no square, no blur.
  - NIGHT: a second pass of the same shader writes its emission into Foundry's illumination (MAX_COLOR): the hot part strongly, the
    warm-lit part at half, the smoke as a faint moonlit glow so the trail reads in the dark. Smooth ground lights (a linear radial
    texture: a light has no pixel grid) sit under the motor flame and at the launch.
  - PIXELS: the body, the flame, its shadow, the sparks and the flashes are CPU art pixels (the gun accents' way), above the trail.
  - Reduced motion: nothing of the rocket is drawn (the crater, the fire and the dust are the result). The frame guard thins the
    sparks and, below q 0.7, re-renders the smoke every other frame (its silhouette never changes).
- **UI:**
  - `ui-core isFirearm` = a walk OR the `shot` gesture (the shooter block, the S key, the ring);
  - `gestureOf("shot", ...)`;
  - the ghost's flight line (`ghostOf`: an accent `rocket`);
  - `aim.mjs`: a shot started on a token takes it; the test gesture of a shot;
  - `section.mjs`: the bar's hint for a shot pad;
  - lang en / pl: the pad, its hint, the accent's name, the bar hint.
