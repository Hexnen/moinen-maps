# Fire level slider 1..3: design (task F1)

Status: design, then built on branch `fire-slider` (from main 94659bc). Written 2026-11-09. The "as built" notes are in section 8.

## 0. The ask

The weather was rebuilt from levels 1 / 2 / 3 into one continuous strength per type (dev/weather-slider-design.md). The user's words
were "Przebudowa na suwak od 0 do trzy, żeby płynnie przechodziło". Asked whether the fire should follow, the user said "Tak, później
osobno". This task does the fire in the same spirit. The bar:

* identical at the old levels;
* smooth in between, with no pops by day or at night;
* natural and organic;
* "responsywność ponad wszystko";
* old data loads;
* players stay in sync;
* EN and PL text.

## 1. What "fire level" is today

It is **per stroke**, not global. This is the main difference from the weather, which has one timeline for the whole scene.

| Where | What |
|---|---|
| Stroke (`fireStrokes.<id>`, model.mjs `cleanStroke`) | `lv`: an integer 1..3, **fire strokes only** (1 smoulder, 2 fire, 3 blaze). `sm` is a separate smoke level (0..3 on a fire stroke, 1..3 on a smoke stroke). Dust and burst strokes have their own integer `lv` with other meanings (a grenade, a shell or a bomb). |
| Brush (editor.mjs) | The client setting `fireLevel` (1..3, keys 1 2 3), pinned on each new stroke at the pointer-up. |
| Dock (section.mjs) | The stroke list shows "F2". A click cycles 1 -> 2 -> 3 -> 1 through `Fire.setLevels`. That rebuilds the area **at once, with no animation**: a pop. |
| API | `fire.paint(pts, { level })`, `fire.setLevels(id, { level })`. |
| Presets (dev/presets-design.md) | Crater, rim and debris fires write integer `lv` values (`levelOf`, with `lvMix`, and `power` shifts), plus their own `gr` / `ot` timing. Bursts and dust keep their own `lv`. |
| Next to it | `s` is the stroke's strength, 0.1..1: a fine control *within* a level (flame height x s, heat x s). It is the fire's analogue of the weather's old `i`. |

**How the level reaches the screen:**

* **CPU (model.mjs):**
  * `FIRE_LV` per level holds heat, flame height, spark share, light radius and light intensity.
  * `P_RISE` sets the puff reach.
  * The field's A byte is `1 + (lv - 1) x 4 + sm`.
  * `auxOldOf` G holds the old level of a burning cell that a newer stroke raised.
  * The light clusters take `round(mean level)`.
* **GPU (art.mjs):**
  * `levelAt()` decodes an int, and every look table (`L_DENS`, `L_R`, `L_RISE`, `L_LIFE`, `L_EMB`, `L_COAL`, `L_TINT`, `SPK_D`) is indexed by it.
  * There are discrete branches: leaders (`lv >= 2`), the non-leader sheet height, the white core (`lvL >= 2`), the out-of-bed `lvN`, the burst spark count `5 + 2 lv`, and the char level written into the ground code (`A += lv`).
  * The art texture's G holds `band + 8 (lvL - 1)`, and the composite takes the outer bands' alpha `OUTER[lv]` = 0.55 / 0.85 / 1.0 from it.
  * The smoke's birth height is `L_RISE(level)`.

## 2. Decisions (and what carries over from the weather)

| Weather decision | Fire | Why |
|---|---|---|
| One strength 0..3 per type | **Fire level 1..3, continuous**, per stroke (step 0.05) | Fire is per stroke, so the slider is per stroke and on the brush. **There is no 0**, because a fire at 0 is no fire: a brush at 0 would paint nothing. Putting a fire out already has its own animation (the eraser, delete, clear). Below the smoulder, the existing Strength slider (0.1..1) already thins the fire. |
| Overdrive to 3.35 | **Not carried over** | The weather needed it so that old data stayed lossless (level 3 with a fine intensity above the middle). Fire data has no such values: `lv` was an integer and `s` stays separate. Going above 3 would also mean taller tongues, bigger boxes and a bigger rectangle, which is new GPU cost on the GTX 1080 for an undesigned look. |
| Ease down through the levels (v-blend) | **Carried over** | A level change (dock slider, keys, API) now animates from the level shown at that moment to the new one, along a smoothstep over 4 s (API `over`). It passes through every in-between look, so 3 -> 1 eases through 2. Today the change is instant. |
| All sliders always visible | **Carried over where it fits** | The brush bar shows the fire level as one slider in place of the three buttons, always shown with the fire brush. In the dock, each stroke's level chip opens that stroke's slider under its row. A long list cannot hold a 10 rem slider per row. |
| Keys 0-3, `[` / `]` fine steps | **Keys 1-3 kept; fine steps on Shift+[ / Shift+]** | Fire has no 0. Plain `[ ]` is already the fire brush's size (the user's muscle memory), so the fine step (+-0.25 on the 0.25 grid) moves to Shift. |
| Smoke / dust / burst levels | **Stay discrete** | The ask is the fire level. The smoke level is another control with its own encodings (the aux A source level, puff tables). Dust and burst are point or path events whose integer levels are kinds (grenade, shell, bomb). A smoke slider can follow later on the same pattern if wanted. |

## 3. Data model and migration

```
fire stroke: { ..., lv: 1..3 (float, step 0.05), l0?: the level the last change started from (1..3, 0.01),
               lt?: when it started (ms, shared clock), lr?: its length (s, absent = 4) }
```

* **Read-time migration (`cleanStroke`, every client, no world script):**
  * An old integer `lv` is a valid level as it stands.
  * A missing `lv` is still 2.
  * Junk clamps to 1..3.
  * No VERSION bump is needed: the stroke format grows only by the optional `l0` / `lt` / `lr`, which old data never has.
  * Old scenes are never rewritten on load. Only a GM edit writes.
* **Effective level** `levelNow(st, now)` = `l0 + (lv - l0) x ss((now - lt) / lr)`. It is the only mapping, and it is pure. A new change starts from `levelNow` of the old record, so repeated drags never jump.
* **Sync:**
  * One scene-flag write per change, on slider release only.
  * `lt` = now + 300 ms (the weather's lead), so players get the record before the ramp starts.
  * Every client computes the same frames from the shared clock.
  * There is no per-frame traffic.

## 4. Rendering a continuous level

The rule for every change: **at a whole level the code takes the old path, value for value.** Only fractional levels and running
ramps use the new paths.

**CPU (model.mjs):**

* `FIRE_LV` and `P_RISE` are read through `lvLerp(table, lv)`. At a whole level this is the table entry itself, not a computed mix.
* **Field A byte.**
  * Whole levels keep their old codes (1..12).
  * Fractional levels use the codes `13 + 4 x q + sm` (q = the 0.05 step - 1), up to 168.
  * Old fields and bytes are identical for old data.
* **auxOld G.** The old level of a raised cell keeps 1..3. Fractional values use `4 + round((l - 1) x 100)`.
* **Ramps.**
  * While a stroke ramps (from `lt` to `lt + lr`, plus a TAIL so the last old-schedule blobs, sparks and puffs finish), its area carries a RAMP texture: R = the from-level, G = the start time byte (floored, relative to the area's ramp ref), B = the smoke-source strength at the from-level.
  * The rectangle and the puff reach use the higher of the two levels.
  * The area key holds the ramp only while it runs, so after the tail the area is rebuilt to the steady field, byte for byte the field of a stroke that never ramped.
* **Lights.**
  * A cluster's level is `E[round(mean)]` over the fractional levels taken as Bernoulli(fract) roundings. That is exactly `round(mean)` whenever all levels are whole (the old rule), and continuous in every level.
  * During a ramp the light gets `{ l0, t0, ms }`. Its intensity and visible reach follow the ramp at every 12 Hz update. The polygon stays at the larger radius until the ramp ends; then it is moved once to the target, with an identical look.

**GPU (art.mjs):**

* **Levels.** `levelAt()` returns a float, and `lvAt(p, back)` gives the ramped level at a cell, at "now minus back".
* **Tables.** `L_xF(float)` takes the exact table entry at whole values and interpolates in between.
* **Per flame emitter:**
  * The look level `lvE` drives the density, blob radius and tongue height (`LD`, `LR`, `LRI`) and the fuel floor.
  * Leaders become a weight `wL = clamp(lvE - 1, 0, 1)` on the leader candidates (`E2.x < 0.16`). It applies to their sheet height and width, the torn-off piece and the fork. The non-leaders' sheet height blends from the level-1 to the level-2 form.
  * The blob **schedule** (life, and so the birth interval) cannot be continuous, because `floor(t / iv)` would re-hash every blob each frame. Each emitter therefore takes a whole schedule level, `floor(lvE - h) + 1` with its own hash h (this equals the level at whole values).
  * When a ramp crosses an emitter's threshold, its old-schedule blobs born before the crossing finish their lives, and new ones follow the new schedule: a **hand-off**, never a re-seed. The crossing time comes from the inverse smoothstep.
* **lvL** (the strongest contributor) is a float:
  * The colour terms take it continuously.
  * The white core's threshold grows with it.
  * The **art G level** (the outer bands' alpha in the composite) is dithered per cell with a blue-noise rank. The composite is unchanged.
* **The ground's char level** is dithered the same way.
* **Born-at events** use the level at their birth, so nothing pops mid-life during a ramp:
  * sparks (`SPK_D`);
  * burst spark counts (the last one by its own hash);
  * smoke puffs (their source strength gate).
* **lvTop** is a float uniform pair for the area's top level now. It eases from the top at the ramp's start to the top at its end, and drives the spark search height, the shimmer and the out-of-bed tint default. `uLvMax` stays the integer culling bound (the ceiling of every level the area holds).
* **The fireball style** (shader.mjs, the frozen v1 look) takes the fractional level on the CPU only (heights, heat). A ramp on a fireball stroke changes at once, as any level change did before.

## 5. UI

* **Bar (fire brush).** "Fire level" is a range-picker from 1 to 3, step 0.05, with notches at 1 / 2 / 3. It uses the weather's `.mm-wx-str` row, with the fire icon in the level colour. The tooltip names the three levels.
  * Release writes the client setting.
  * Keys 1 2 3 work as before.
  * Shift+[ / Shift+] nudge by 0.25.
* **Dock.** The level chip shows `F2.35`. A click opens that stroke's slider under its row (one open at a time).
  * Release calls `Fire.setLevels(id, { lv })`, which starts a ramp.
  * While the stroke ramps, a live value ("now 1.84") and a marker on the track update at 4 Hz.
  * The list is never rebuilt under the pointer (the existing focus rule).
* **API.** `fire.setLevels(id, { level, over })` (over in ms, default 4000, max 25 000, 0 = at once), and `fire.paint(..., { level })` takes a float. `list()` gives `lv` and `lvNow`.
* **i18n.** EN and PL: the new slider texts and the live value. The level names stay.

## 6. Proof plan (binding bar)

1. **Node.**
   * At lv 1 / 2 / 3, the raster bytes (field, aux, auxOld, puff), emitters, lights and keys equal the old main code's, by an A/B against `git show 94659bc:scripts/fire/model.mjs`.
   * The encode and decode round-trip.
   * Continuity of the CPU tables and lights along 1 -> 3.
   * Bernoulli light level = round at whole configurations.
   * The ramp record: interrupted ramps stay continuous.
   * Migration fixtures.
   * The GLSL table functions at whole values equal the old tables.
   * `fire-art-split` caps.
2. **Live pixel A/B.**
   * Main vs branch on lane 1, same scene, guard off, fixed clock.
   * Strokes at levels 1, 2 and 3 (and a preset firing), day and night, at zoom 1 and 3.
   * Expect 0 differing pixels.
3. **Ramp webms.**
   * 1 -> 3, 3 -> 1, 1 -> 2 -> 1.5 interrupted, and a slow 20 s 1 -> 3.
   * Day and night, zoom 1 and 3.
   * Judged in motion.
4. **Cost.**
   * CPU and GPU frame time per area at levels 1, 1.5, 2, 2.5 and 3, and during a ramp.
   * Zoom 1 and 3, the weak-GPU emulation, and the first fire (link / cold start).
   * The ART_F size and link time.
5. **Migration.** An old scene (integer `lv`) loads and looks the same, and is not rewritten.
6. **Sync.** A real player (Test Gracz 1) sees the same level and the same ramp as the GM.

## 7. Risks

| Risk | Mitigation |
|---|---|
| ART_F grows past the link budget | The additions are small (one shared emitter-state function, interpolated tables). The size test cap is 46 000. `fire-art-link-run` measures the link on the lane. |
| 1-ulp FMA differences at whole levels | Whole levels take the old expressions. Verified by the pixel A/B, not assumed. |
| Blob re-seed at a schedule switch | The hand-off (section 4); judged in the ramp webms. |
| Pop at the end of a ramp | The area keeps the ramp texture for a tail (puffs up to 6 s / speed). After that it is rebuilt with k = 1, identical. |
| Lights radius jump | The polygon at the max radius during the ramp, reach scaled; one move at the end with the same look. |
| Low-strength strokes (s < 0.2) at level 1 have a smaller bed (heat 0.74 x s x 0.35 < 0.05 at the rim) | A ramp across level 1 changes the bed's edge cells at the start: known, small, only at s < 0.2. |

## 8. As built (2026-11-09/10, branch `fire-slider`)

What differs from, or adds to, sections 2-5:

* **`over` is in ms** (API `setLevels(id, { level, over })`, default `LV_RAMP_MS` 4000, clamped 0..25 000). The record's `lr` is in s.
* **The ramp starts `LV_LEAD_MS` = 300 ms after the write**, so players have the record before anything moves. After the ramp the area keeps its ramp texture for a tail of `LV_TAIL_MS` = 6500 / speed (the puffs and blobs born on the old schedule finish), then it is rebuilt to the steady field.
* **Level codes.** Whole levels keep the old A-byte codes; fractional levels use `13 + 4q + sm`. The ramp texture: R = from-code, G = start byte, B = smoke source at the from-level, A = length.
* **An interrupted ramp keeps its history.** A change during a ramp starts from `levelNow`, and the stroke also keeps the ramp it cut short (`p0 / pv / pt / pr`). The area gets a second ramp texture (`ramp2`, uniforms `uLvRamp2`, `uHasRamp2`, `uRampP`): a puff, spark or blob born before the new ramp takes its level from the old ramp, so nothing in flight changes its look at the interruption. Without this, the interrupt webm showed a pop at the cut.
* **Lights.** The hand-over bridge's start ratio is solved by bisection on the tint magnitude. The old a/b ratio overshot by 10-15 %, which made a visible +1.7..+4 luminance step at night when a change started. A light that is moved or made now forces its update.
* **Two program variants.** The art programs (ART_F, ART_S, EMB) are built twice from one source: `#define LVC 0` (whole levels; every continuous-level path folds away, so the whole-level programs are the old code) and `LVC 1` (continuous). An area uses LVC 1 only while it has a fractional level or a ramp (`model.areaLvc`). Reason: one program carrying both paths linked ~1.7x slower on D3D11 (the first fire after a shader update). The LVC 1 set is linked in the background after the whole-level pre-warm (`fire.mjs warmLvc`, KHR_parallel_shader_compile); an LVC area drawn before that waits (the old picture stays) instead of stalling the frame. Dev switch: `CONFIG.moinenMaps.fireLvcAll = true` puts every area on LVC 1 (used for the A/B below).
* **The emitter blob loop keeps its old form** (`kk < 16`, the second half the hand-off schedule). A uniform loop bound changed float results (10-20k px off in the A/B), so it was reverted.

### Results (lane 1, RTX 3070 Ti, D3D11 ANGLE)

* **Identical at the old levels.** `dev/fire-slider.test.mjs` 884/884 checks. Live pixel A/B, 16 stills (day and night, zoom 1 and 3, two virtual times, strokes at levels 1/2/3 and a preset fire), fresh reload each: 0 differing px against main 2a59411 with the whole-level programs, and 0 with the continuous programs forced on every area.
* **Smooth in between.** Seven ramp webms (dev/out/f1, uncommitted): 1->3 and 3->1 by day and at night, an interrupted ramp by day and at night, a slow 20 s ramp at night. The largest frame-to-frame change against its neighbours is at most 1.19x in every video (a pop scores several x); mean luminance moves at most 1.3 / 255 per art frame at night.
* **Cost** (dev/fire-slider-cost.mjs, 5 strokes, median of interleaved runs, art frames): see the table in the F1 report. Whole levels: GPU 1.59 vs 1.44 ms at zoom 1 (1.45 vs 1.38 at zoom 3), within the run-to-run noise (single runs ranged 1.24-2.11 on main); with the art passes drawn 4x (weak-GPU emulation) 2.26 vs 2.34 ms. Fractional levels 1.80 / 2.81 ms (x1 / x4), a running ramp 1.73 / 2.63 ms. CPU unchanged (~1.3-1.4 ms a frame).
* **First fire (link, cache miss, all at once):** whole-level set 4.73 / 5.70 / 4.79 s vs main 4.40 / 4.87 / 4.78 s; the LVC set 7.2-9.6 s more, in the background.
* **Migration:** an old scene with raw strokes (`lv` 1, "3", missing, 7 with junk `l0`/`lt`, a smoke stroke) loads with levels 1 / 3 / 2 / 2 / 3, no errors, and the scene flag is not rewritten.
* **Sync:** GM and Test Gracz 1 (a real player login) read the same record, the same `levelNow` at five shared times through a 20 s ramp, the same area keys, ramp-texture hash and uniforms; a still at the same shared time mid-ramp differs only in a 38x32 px UI corner.
