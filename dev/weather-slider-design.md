# Weather strength slider 0..3: design

Status: design only, no module code. Branch `weather-slider` from main 3265691. Written 2026-11-09.

## 0. The ask

The user said (PL): "Pogoda na teraz trzy poziomy. 1, 2, 3. Przebudowa na suwak od 0 do trzy, żeby płynnie przechodziło."

Every weather type gets one continuous strength `v` in 0..3 instead of the level buttons 1 / 2 / 3. At 0 the type is off. Values
between levels blend smoothly. At 1, 2 and 3 exactly, the look stays as it is today.

**The main finding: the engine is already continuous inside.** `model.mjs` turns (level, fine intensity `i`) into one value
`s = level - 1 + (i - 0.5) x 0.7` (about -0.35 .. 2.35). Every look gate is a piecewise-linear function of `s` through the tables at
s = 0 / 1 / 2 (`gate`, `gates`, `lensGates`). Timeline keys blend `s` and the presence `p` along a smoothstep. Densities already reach
the shaders as fractional slot counts, and the last slot is gated by `fract(dens)`. So this is mostly a change to the **data model, the
API and the UI**, plus **five places that are still discrete** (sections 1.9 and 2.3). No new shader programs are needed, and no
program variants exist per level.

Work in parallel: **another agent is adding a lightning flash to rain** (`C:/mmwt-wlight`, uncommitted). It adds
`scripts/weather/storm-model.mjs`, a `storm` field in the weather flag (`cleanParams` in model.mjs), `uFlash` on the rain shader
(display.mjs / glsl.mjs), `uBolt` on the cloud body (clouds.mjs / clouds-glsl.mjs), and it touches `presets/lightning.mjs`. Its
flash chance scales with `ss(p x 1.25)`, where p is the rain's presence. Section 3.6 covers how the two fit together.

---

## 1. Inventory: what depends on the level today

Notation: `[L1, L2, L3]` is a table at s = 0 / 1 / 2. **dens** means a density key: `gate(..., dens=true)` extrapolates it below s = 0
as `a x (1+s)` and above s = 2 as `c x (1+s-2)`. Other keys clamp outside 0..2.

### 1.1 Model and engine (model.mjs, weather.mjs)

| What | How it depends on the level |
|---|---|
| Key `{ preset, level 1..3 (int), i 0..1, fx: { eff: { l int, i } } }` | discrete `l`, continuous `i`; `levelS(l, i)` -> s |
| Base `{ fx: { eff: { p, s } } }` | already continuous |
| `blend(a, b, f)` | `p` and `s` lerped separately; an effect only in `a` fades out **at its own s** (p -> 0), one only in `b` fades in at b's s |
| `TABLES` + `gate` | piecewise linear in s (continuous). Tables whose values look like steps are `[0, 0, 1]` / `[0, 1, 1]`; they are linear ramps in the model, but some consumers branch on them (1.9) |
| Wet / cover ceilings | `p x wetCeil(s)`, `p x coverCeil(s)`, integrated over time: continuous |
| `fireWet` | dim / steam continuous. `outAfter` (s of rain before it puts fire out) is gated at `p >= 0.5`: a threshold for a discrete event, which is fine |
| `clientState` cap | `s <= cap - 1 + 0.35` (client setting `weatherDetail` off/1/2/3; Performance Low caps at 2): continuous clamp |
| `lensS` | `lens.level` "auto" (follows s) or int 1..3 -> `level - 1`; capped at `lensCap - 1 + 0.35` |
| `withKey` | level carried over between presets; `clouds` is a separate int row 0..3 (`clouds: 0` deletes the effect) |
| API `set / level / clouds` | `lvlOf` rounds to int 1..3; `clouds` rounds to int 0..3 |
| `rainAt()` | `p x gate([0.35, 0.7, 1], s)`: continuous |
| Status line | shows `L{(s+1).toFixed(1)}` |

### 1.2 Rain (display.mjs `apply`, glsl.mjs RAIN_VERT / GROUND_FRAG)

| Gate | Table | Consumer | Kind |
|---|---|---|---|
| mid / far / near drops per 64x64 | [14,70,150] / [34,60,110] / [0,0,4] dens | `uDens`, `uPer = ceil(dens)` slots, last slot gated by `fract` | count, already soft (2.3) |
| vMid / vFar fall speed | [150,225,235] / [120,165,170] | `uVF` | uniform, clean |
| exp streak length | [0.55,1,1] | `uExpK` | uniform, clean |
| crown / ripple | [0,1,1] / [0.12,0.4,0.5] | `uSplash`, hash < value per drop | soft per-drop share, clean |
| wet / puddle / sheen | [.3,.65,1] / [1.4,.68,.6] / [.0022,.003,.004] | `uWet` (accumulated), `uPuddle` (>1.3 = none; fbm <= 1 so the edge is soft), `uSheen` | clean |
| near layer | `noNear` (perf != high) | client choice, not level | - |
| lens: bead / big / run / mist / film | [.2,.55,1] dens / [3.4,4.4,5.2] / ... | lens `uRainA`, `uFilm`; beads via `slotOn` with fract | clean |
| fireDim / steam / fireOut | tables | fire layer, steam layer | clean |
| (lightning, in progress) | presence p | flash chance per 1 s slot | clean (3.6) |

### 1.3 Snow

| Gate | Table | Consumer | Kind |
|---|---|---|---|
| mid / far / near flakes | [5,20,40] / [4,16,34] / [0,0,2] dens | particle slots, fract gate | count, soft |
| spindrift | `drift` [0,0,1] x 10.7 as a 4th layer density | slots | count, soft |
| vMid / vFar | [22,27,30] / [16,19,20] | `uVF` | clean |
| cover | [0,.1,.42] accumulated | `snowThr(cover)` = the scene's own score quantile (CPU) | clean |
| thick | [0,0,1] | `uSnow.y`: `mix(dust_, full, thick)` | clean (a mix) |
| cold | [.12,.55,1] x p | `uSnow.z` tint | clean |
| lens frost / wob / crystals | [.075,.13,.2] / [.012,.02,.03] / [6,16,34] dens | `uSnowL`, `slotsOf` + fract | clean |

### 1.4 Sand

| Gate | Table | Consumer | Kind |
|---|---|---|---|
| grit | [16,34,60] dens | slots | soft |
| hop / len | [3.5,3.5,7] / [1.5,1.5,3] | `uVF` | clean |
| rib / ribK | thresholds | ground streamers, soft thresholds | clean |
| drift | [.05,.12,.18] x p | `driftThr` quantile (re-sorted per degree of wind) | clean |
| haze / hazeD | [0,1,1] / [0,.62,1] | `uSandH.x` density | clean |
| **hazeL3** | [0,0,1] | `uSandH.y`: the 3-band look is a `mix` (clean), **but the lit / shadow sides are `uSandH.y > 0.5 ? ... : 0.02`** in `smoothFields` and `cellHaze` (fx-glsl.mjs 408, 432) | **hard step at s = 1.5 (v = 2.5): pops today during a 2 -> 3 ramp** |
| ochre | x p | tint | clean |
| lens deposit / scratch / impacts | | `uSandL` | clean |

### 1.5 Dust

| Gate | Table | Consumer | Kind |
|---|---|---|---|
| motes | [10,26,52] dens | slots (5-10 s lives) | soft (see 2.4) |
| shaft / haze / warm | [0,.8,1] / [0,0,1] / [.25,.6,1] | ground and haze uniforms x p | clean |
| lens specks / discs / glare / smudge | | `uDustL`, `uDustL2` | clean |
| **lens ghosts** | [0,3,5] | `Math.round(G.ghosts)` -> `uDustL.w`; the shader loop `if (j >= uDustL.w) break` | **integer count: a ghost pops in at s = 0.17, 0.5, 0.83, 1.25, 1.75** |
| ghostK | [0,.09,.14] | ghost strength | clean |

### 1.6 Embers

| Gate | Table | Consumer | Kind |
|---|---|---|---|
| spark | [1.8,6,18] dens | slots | soft |
| swarm | [.15,.3,.45] | `uVF.x` swarm floor | clean |
| **big** | [0,1,1] | `uVF.y`; vertex `big = h7 > 0.85 && ... && uVF.y > 0.5` | **hard step at s = 0.5 (v = 1.5): every big spark appears at once** |
| smoke / smokeL3 / dim | [0,1,1] / [0,0,1] / [.15,.6,1] | haze `uSmoke.x` x p, `uSmoke.y` a `mix`, ground tint | clean |
| lens glow / flecks | | `uHeatL` (only with lens heat on) | clean |

### 1.7 Visible wind

| Gate | Table | Consumer | Kind |
|---|---|---|---|
| spd | [.55,.8,1] | carry speed | clean |
| lines / debris | [1.3,3.6,7.1] / [.6,3.2,7.7] dens | slots | soft |
| lineGate / lineLen / bob | | `uVF` | clean |
| comb / ruffle / dim | | ground uniforms | clean |
| cloud | [0,.6,1] x 0.32 | cloud layer cover (`syncClouds` wants it once `s > 0.02`) | clean |
| haze | [0,0,.5] | dust-haze slot | clean |

### 1.8 Clouds (clouds.mjs, clouds-glsl.mjs)

| Gate | Table | Consumer | Kind |
|---|---|---|---|
| cover | [.30,.56,.86] | `coverThr(cover x ss(p x 1.15))` = the field's quantile | clean |
| body / shade / rays | | uniforms | clean |
| mode (sky / shadows), godrays on/off | not levels | own fades on the shared clock (`CLOUD_FADE`) | unaffected |
| `nRays` | from the guard q, not the level | | unaffected |
| level in the key | a separate int row 0..3 in `withKey` (`clouds: n`) | | becomes a slider like the others |

### 1.9 Tornado (tornado-model.mjs, tornado.mjs, tornado-glsl.mjs)

Each tornado is an object with its own `level` (int 1..3), `lv0` (the level before the last change) and `lvT`. `levelS` ramps
s = lv0-1 .. level-1 over `LEVEL_MS` = 5 s. `TABLE` has 28 rows, all piecewise linear (`lv`). Discrete spots:

* `update()` sets `lv0 = round(levelS(T, now) + 1)`: **a change during a running 5 s ramp jumps** to the nearest integer level.
* CPU counts per frame: `nS = round(specks...)`, `nW = round(wisps...)`, `nC = round(clumps...)`, `nI = round(inflow...)`,
  `nF = round(frags)`, `nP = round(planks)`: **one item pops in or out at each 0.5 crossing** while s ramps. (`nS`, `nW`, `nC` and `nI`
  also scale with the guard q and with touch, so these pops happen today under the guard too.)
* `big = !plank && L.frags >= 10 && h < 0.16`: **all big fragments switch on at once at s = 0.56**.
* `flash` [0,0,1], `curtain` [0,.6,1], `feed` [0,.7,1]: multiplied in, clean.
* `looksOf(s)` caches per s (clears above 64 entries): fine with continuous s.
* Programs are split per stage and mode (link-time work, 2026-11-09). None is per level.

### 1.10 Lens (lens.mjs)

* `lens.level` "auto" or int 1..3 (the scene default), `lens.strength` 0..1, `lens.heat`.
* Per effect `lensGates(e, lensS(...))`: all clean except **dust ghosts** (1.5).
* Programs: `lens`, `lens-inline`, `lens-runners`, `lens-beads`, `lens-show`. None is per level.

### 1.11 Steam, fire, other layers

* `steam.mjs` reads `fireWet` (dim, steam): continuous.
* The fire layer reads `fireWet` and the wind: continuous. The fire's own levels 1..3 (`fire/section.mjs`) are **out of scope**.
* The presets (dev/presets-design.md table row "Weather") do not use the weather layer for the four presets; no other module code
  calls `api.weather` (grep). The dev scripts (`weather-rec`, `weather-cost`, `weather-opt` ...) call `set(..., { level })`, which
  stays valid.

### 1.12 UI and keys (section.mjs)

* Bar: preset row (10 presets), level row 1/2/3 (buttons), clouds row 0..3 (buttons) + cloud look + godrays, fine intensity slider
  `wx.i`, 8 wind directions, wind strength, "over N s", lens on/off + lens level select.
* Keys 1-3 (while the section is open, not while typing): level of the current preset.
* Dock: Weather status `L{s+1}`, Tornadoes (next tornado's level 1/2/3, per tornado 1/2/3 buttons), Lens (level select), This client
  (caps off / 1 / 2 / 3).

---

## 2. How each becomes continuous

### 2.1 One strength `v` per effect, and how it maps onto today's engine

The new stored quantity is `v` in [0, 3] per effect. The resolved state keeps the two quantities every consumer already reads:

```
p = clamp(v, 0, 1)            (presence: 0..1 fades the level-1 look in)
s = clamp(v - 1, 0, 2)        (the level continuum: 1..3 runs through the tables)
```

* **v = 1, 2, 3 give p = 1 and s = 0, 1, 2.** That is exactly today's level 1 / 2 / 3 at the default `i` = 0.5, so the steady look at
  the integer values is unchanged **by construction**. No table or shader changes for that.
* **0 < v < 1 is the level-1 look faded in by presence.** That is the same path every effect already uses today when it fades in.
  Every density, tint, haze, wet ceiling and lens term is already multiplied by p. Densities scale with v, the same as the old
  extrapolation `a x (1+s)`. The only difference from the old `i < 0.5` at level 1 is that tints now also scale with v: slightly subtler
  than before at v 0.65..1. This is negligible and is the better behaviour.
* **v = 0 means off.** The effect is dropped from the key, as `clear` drops it today.

**The timeline blends `v`, not (p, s).** A key ramps each effect's v from its start value to its target (smoothstep over `dur`, as
today). An effect missing on one side counts as v = 0. Consequences:

* A ramp passes through **exactly the states the slider would show**. Animating from 3 to 0.5 looks like dragging the slider down
  slowly. That is the "płynnie" the user asked for, and it makes timeline animation and slider moves the same thing.
* **Behaviour change:** today an effect fading out keeps its level while its presence drops (a downpour thins out as a downpour). With
  v-blending a downpour **eases off through level 2 and 1 and then thins out** (rain 3 -> clear passes through steady rain and
  drizzle). This is more natural and has no pop. It is listed as user question Q2 because it changes how preset switches look.
* `blend` gets simpler. The `x.p > 0.001 ? ... : y.s` special cases go, and so does the "fades out at its own level" branch.
* Wind keeps its own blend (dir via `angLerp`, str, gust). It is not a weather type.

### 2.2 What interpolates cleanly (no work beyond feeding v)

Everything marked "clean" in section 1: every TABLES gate in the model; uniform speeds, lengths and thresholds; per-drop shares
(crown, ripple, swarm floor, line gate); accumulations (wet, cover); quantile thresholds (snow cover, sand drift, cloud cover); `mix`
looks (`thick`, `smokeL3`, the 3-band `lv3` mix of `hazeL3`); lens gates other than ghosts; tornado TABLE rows used as values; fire wet;
cloud cover. None of them needs a crossfade between level variants. **There are no level variants: no program, texture or
link-time constant depends on the level.** (Checked: `displayPrograms`, `cloudPrograms`, `tornadoPrograms`, `lensPrograms` build fixed
program lists. Their `#define`s are pre-pass stages, tornado stage and mode, and the deck part. None is a level.)

### 2.3 Discrete steps to hide (small shader / CPU edits)

The rule for each fix: **at the old integer levels the result is bit-identical**. Only the in-between values change.

| # | Where | Today | Fix | At v = 1, 2, 3 |
|---|---|---|---|---|
| D1 | sand haze lit / shadow sides (fx-glsl `smoothFields`, `cellHaze`) | `uSandH.y > 0.5 ? lit : 0.02` | `dd = mix(0.02, ddLit, uSandH.y)`; take the second `drift3a` sample when `uSandH.y > 0.0 && sLitW > 0.0` | y = 0 or 1: identical |
| D2 | ember big sparks (fx-glsl PART_VERT) | `uVF.y > 0.5` | `h[7] > 1.0 - 0.15 * uVF.y` (the share of big sparks ramps 0 -> 15 %) | y = 0: none; y = 1: `h7 > 0.85`: identical |
| D3 | lens dust ghosts (lens.mjs `setState` + `dustLens`) | `Math.round(G.ghosts)`, loop `break` at count | pass the float; loop to `ceil`, weight ghost j by `clamp(uDustL.w - j, 0, 1)` | 0 / 3 / 5: identical |
| D4 | tornado counts (tornado.mjs specks / wisps / clumps / inflow / frags / planks) | `Math.round(n)` | `ceil(n)` items, the last one's alpha x `fract(n)` (or its own hash < `fract`, as the GPU slots do) | integer counts identical, except where n x touch x q is fractional (it was rounded; it now fades). Only during touch-down / rope-out and under the guard, so it is an improvement there |
| D5 | tornado big fragments | `L.frags >= 10` | `hF(kk,12) < 0.16 * ss((L.frags - 6) / 8)` evaluated at the fragment's **birth** level (`levelS(T, birth)`; birth = tm - tau is known in that loop), so a flying fragment never changes size | L1: 0 frags; L2 / L3 (18, 40 frags): 0.16, identical |
| D6 | tornado `update()` | `lv0 = round(s + 1)` | `lv0 = s + 1` (float) | the ramp is continuous from wherever it is |

D1 to D3 add a few tokens to three existing programs (`haze`, `hazeCell`, `hazeShow`, `part`, `lens*`). They stay under the link-test
caps (section 5.1). D4 to D6 are CPU-side.

### 2.3.1 T3 as built (D1-D3, 2026-11-09, branch `weather-slider-t3`)

* **D1** (fx-glsl `smoothFields`, `cellHaze`): the second `drift3a` sample is taken when `uSandH.y > 0.0` (was `> 0.5`), and
  `dd = mix(0.02, x, smoothstep(0.0, 0.008, |lit|) * uSandH.y)` per side. This is `mix(0.02, mix(0.02, x, t), y)` folded into one mix,
  chosen over the suggested outer `mix(0.02, ddLit, y)` because GPU `mix` is often `a + t (b - a)`, which is not exact at t = 1; here
  y = 1 multiplies t by 1.0 and y = 0 makes t 0, so both ends are the old expression bit for bit. The sides grow linearly with y, the
  same ramp the 3-band `m` mix already uses.
* **D2** (fx-glsl PART_VERT): `big = h[7] > 0.85 + 0.15 * (1.0 - uVF.y) && cI < 2.0 && dp > 0.6`. The threshold is exactly 1.0 at
  y = 0 (no hash passes: `hu` can return 1.0, and `1.0 > 1.0` is false) and exactly 0.85 at y = 1, under any rounding or FMA; the
  form `1.0 - 0.15 * y` lands on 0.85f only by a round-to-even tie, so it was not used. The share of big sparks ramps 0 -> 15 %
  linearly. During a ramp a spark whose hash is crossed switches to big mid-life (one spark at a time, the D7 class).
* **D3** (lens.mjs): `uDustL.w` gets the float `G.ghosts` (no `Math.round`); the loop weighs ghost j by
  `gw = clamp(uDustL.w - j, 0, 1)`, breaks at `gw <= 0`, and scales `inG` by gw. Whole counts draw the old ghosts at weight 1.0.
* **Proof:** a float32 emulation (3 mix forms, FMA, reassociation; 3.1 M cases) and a WebGL2 check on the real compiler path
  (headless Chrome, ANGLE D3D11, RTX 3070 Ti): old vs new snippets bit for bit at y 0 / 1 and counts 0 / 3 / 5, 0 differing words
  of 1 M per case. The snippets were isolated, not the full programs: T6's pixel A/B still checks them in context.
* **Sizes** (fragment chars, cap): haze 12 989 -> 13 230, hazeCell 12 896 -> 13 137, hazeShow 13 721 -> 13 962 (display cap
  23 500); part fragment unchanged 7 741 (vertex 24 304 -> 24 448, uncapped); lens / runners / beads 39 688 -> 39 942 (cap 43 500).
  Most of the growth is comments. No cap moved.
* **Side effects to know:** a client cap (s <= cap - 1 + 0.35) now gives fractional values where the old code rounded or
  stepped: sand 3 on a cap-2 client shows lit sides at y 0.35 and pays the second `drift3a` sample (the frame guard still fades and
  skips it under load); embers at cap 1 pass the big-spark hash at ~5 % (a third of level 2's 15 %; was none); dust lens at cap 2 draws 3.7 ghosts (was 4).

### 2.4 Counts while moving: slots that switch mid-life (optional polish, D7)

Every particle kind already thins out per slot: a slot is drawn when its per-cycle hash is below the fractional density, so
**nothing pops as a group**. But the gate is evaluated **every frame against the current density**. While v ramps, a slot whose hash
falls inside the change flips once, at a random moment of its life, so a particle appears or vanishes in mid-air. For rain this cannot
be seen (streaks show for under 0.3 s). For long lives it can be: dust motes (5-10 s), embers (3.3 s), debris (3 s), snow (2-3.3 s), and
snow is the most visible because flakes are big and slow. It already happens today in every level ramp. The slider makes ramps more
common, and a slider drag with "over 0 s" makes it a burst.

Fix, keeping the steady look identical: evaluate the gate at the slot's **birth** (`birth = uTime - tau`, already computed). The
engine already resolves at 12 Hz. It passes, per layer, the density now (`uDens`) and its rate of change per second (`uDensR`, from a
second resolve 0.5 s earlier). The shader uses `dens(birth) = max(0, uDens - uDensR * tau)`. In a steady state `uDensR` = 0, which is
bit-identical. The frame guard's q stays outside the rate (it is applied now, as today), so guard steps still thin as they do now, which
is allowed ("temporary"). Cost: one vec4 uniform and one multiply-add per slot. A cut with "over 0 s" stays a cut (the rate model
cannot see a step; that is the GM's explicit choice).

This is **optional**. Do it after a live A/B. If snow and motes do not visibly pop during a 20 s ramp at 1080p, skip it.

### 2.5 While the slider moves and while the timeline animates

* The slider writes **one key on release** (`change`), never during the drag. Dragging would cost one scene write per input event;
  `KEEP_KEYS` = 8 folds older keys, so it would work, but it floods the DB and every client re-resolves. The display then ramps over the
  GM's "over" time (default 20 s, 0 allowed). A new key during a running ramp starts from the current blended v (existing `starts`
  logic), so repeated drags never jump.
* While a ramp runs, the slider row shows the **live value** next to the target (2.4 / 4.3). The GM sees where the weather is, not only
  where it is going.
* Keys 0-3 (section 4.3) write one key each, like the buttons today.

---

## 3. Data model, migration, timeline, sync

### 3.1 The stored flag (VERSION 1 -> 2)

```
key:  { t, dur, preset, level: v 0..3.35 (float: the preset's strength), fx: { eff: v (number, 0 < v <= 3.35) }, wind }
base: { t, fx: { eff: v }, wind, wet, cover, drift? }
lens: { on, level: "auto" | v 0..3.35 (float), strength, heat }
tornadoes[n]: { ..., level: v 1..3 (float), lv0: v (float), lvT, ... }
storm: (unchanged, the lightning agent's)
```

* `fx[eff]` becomes a **plain number**. In v1 a numeric `fx.rain: 2` already meant "level 2, i 0.5", which is v = 2: the **same number
  means the same thing** in both versions.
* `i` is dropped. It is folded into v.
* `level` stays as the **preset strength**: the value a preset button applies to its effects. Today the level carries over between
  presets ("rain at 2, click snow: snow at 2"); this keeps that.

### 3.2 Migration (read time, in `cleanParams`, every client, no world script)

| v1 field | v2 |
|---|---|
| `key.fx[e] = { l, i }` | `v = clamp(l + (i - 0.5) x 0.7, 0, 3.35)` (user decision Q1: overdrive kept, so nothing clamps) |
| `key.fx[e] = number` | unchanged (same meaning) |
| `key.level` int + `key.i` | `level = clamp(level + (i - 0.5) x 0.7, 0, 3.35)` |
| `base.fx[e] = { p, s }` | `v = p >= 0.999 ? s + 1 : p` (clamped). The base only matters before its next key; a visible difference needs a ramp running at the moment of the upgrade, and then it is a small step once |
| `lens.level` int / "auto" | unchanged (int 1..3 is a valid v) |
| tornado `level`, `lv0` int | unchanged (valid floats) |

* `cleanParams` returns v2 for both inputs. `save()` writes `v: 2` on the GM's next change. Clients that only read never write, so
  there is no write storm on load.
* **No lossy corner (Q1 decided: "Dodaj nadbieg do ~3,35"):** the strength range is 0..3.35. v1 level 3 with `i > 0.5` migrates to
  v 3..3.35 (s up to 2.35, densities up to 1.35x), exactly as before. Every clamp in the model is 0..`V_MAX` = 3.35.
* All clients load the same module version from the server, so no mixed-version reader exists.
* The `storm` field (lightning) passes through `cleanParams` as the lightning agent wrote it.

### 3.3 The model API (pure, node-tested)

* `strength(v) -> { p, s }` (the mapping in 2.1). It is the only place that knows it.
* `target(k)` = `{ fx: { e: v } }`; `blend` lerps v per effect (missing = 0) and the wind as today; `stateAt` / `starts` / `resolve`
  return `fx: { e: { v, p, s } }` (p and s derived), so **every consumer keeps reading p and s unchanged**.
* `resolve` drops effects with v < 0.0005, as it drops p < 0.0005 today.
* `withKey(P, change, now)`, where `change` is:
  * `{ preset, level? }`: the preset's effects at `level` (default: the last key's level, else 2); other non-cloud effects dropped;
    clouds kept (clear clears them), as today;
  * `{ fx: { e: v } }`: a **patch** on the last key's fx (v = 0 removes e); `preset` becomes `custom` unless the set of non-cloud
    effects still equals a preset's set;
  * `{ level }` alone: every non-cloud effect of the current preset set to `level` (the old level button and the keys 1-3);
  * `{ clouds: v }`: kept as sugar for `{ fx: { clouds: v } }`;
  * `{ wind }`: as today.
* `clientState` cap: `v <= cap + 0.35` (the same as today's `s <= cap - 1 + 0.35`). At cap 3 it is a no-op.
* `lensS(P, s, cap)`: `lens.level` "auto" follows s; a fixed lens v gives `strength(v)`, and the lens's p is multiplied by its p (a lens
  fixed at 0.5 shows the level-1 lens at half presence).
* `levels(preset)` (for UIs and generators): unchanged, the tables at 1 / 2 / 3.

### 3.4 Timeline and keys

* The timeline stays keys + smoothstep ramps + base folding. Only the blended quantity changes (v instead of p and s).
* `wetAt` / `cloudDrift` integrate over `stateAt`. Their cost is unchanged, and they read the derived p and s.
* Keyboard: see 4.3.

### 3.5 Sync to players

Unchanged in principle: **one scene-flag write per GM change**, then every client resolves from the shared clock (`sharedNow`), so a
late joiner computes the same. Slider drags write on release only (2.5). The lead `LEAD_MS` = 300 ms stays. No per-frame traffic,
no sockets.

### 3.6 Lightning (the parallel agent)

* Its flash chance uses the rain's `p` (`ss(p x 1.25)`). With 2.1, rain v 0..1 fades the lightning in with the rain, and above v 1 the
  chance stays full. That is consistent with no change needed. If the user wants storms to grow with rain strength, the agent could
  scale the rate by `gate([0.4, 0.8, 1], s)`. That is a look decision for the lightning work, not this one.
* **Merge order:** lightning first (it is already in flight). Then the T1 model task rebases onto it: `cleanParams` keeps
  `...(r.storm ? { storm } : {})`, and VERSION 2 must not drop it. Conflicts are expected in model.mjs (header and `cleanParams`),
  display.mjs (`ru()` uniforms) and glsl.mjs. They are small and textual.

---

## 4. The UI (section.mjs, lang en / pl, css)

Built only from the workspace's existing pieces (`optRange` / `range-picker`, `mm-ws-toolbtn`, `mm-d-level` dots and colours,
`mm-ws-opt`, `optHint`). No new widget type.

### 4.1 The bar

1. **Preset row** (unchanged look): quick sets. A click applies the preset at the current preset strength. The pressed state is
   "these effects are on" (custom = none pressed).
2. **Strength sliders, one per weather type:** Rain, Snow, Sand, Dust, Embers, Wind, Clouds. Each is an `optRange` 0..3, step 0.05,
   labelled with the type's icon and colour (the `PRESET_COLOR` / `CLOUD_COLOR` dot as in the level buttons). The row behind each slider
   has CSS tick marks at 1 / 2 / 3, and the tooltip names the levels (`lvlHint1..3` texts, reworded: "1 light / 2 medium / 3 heavy").
   * A slider at 0 is dimmed (`aria-pressed=false` style); a slider above 0 shows its colour.
   * While a ramp runs: a small live value after the label ("2.4 / 4.3"). It is updated by the existing `moinenMapsWeather` "state"
     tick (1 Hz) or the 12 Hz step if cheap. It never re-renders the bar while a slider is focused (the existing `isEcho` /
     `writeControl` pattern).
   * Release -> `Wx.change({ fx: { rain: v } }, { over })`.
3. The **level row 1/2/3 and the fine intensity slider `wx.i` are removed.** The clouds button row becomes the Clouds slider; the cloud
   look buttons (sky / shadows, godrays) stay.
4. Wind directions, wind strength, "over N s", lens on/off: unchanged. **Lens level** becomes a select "Auto / Fixed" plus, when Fixed, a
   0..3 slider.

If the seven sliders are too tall for the bar, a compact mode can show only the sliders above 0 plus a "+ type" menu. That is a UI call
for the user (Q4). Default proposal: all seven, so the slider stays where the hand expects it.

### 4.2 The dock

* **Weather status:** `Rain 2.4 · 100 %` per effect (v and, while fading, the presence). The `lvlShort` "L" goes.
* **Tornadoes:** the next tornado's level and each tornado's level become sliders 1..3, step 0.05 (the 5 s `LEVEL_MS` ramp stays,
  from the current continuous value: D6). Rope-out stays a button. (0 = rope out is Q3.)
* **Lens:** the level select becomes "Auto / Fixed" plus a slider (as the bar); strength and heat unchanged.
* **This client:** the caps stay discrete selects (off / up to 1 / 2 / 3). They are a performance choice, not a look, and continuous
  caps add nothing. The texts change "level" to "strength".

### 4.3 Keys

* **0-3** (today 1-3): set the current preset's effects to that strength (0 = clear the preset's effects, clouds kept). Same scope
  rules as today (section open, not typing, no modifiers).
* Optional: `[` / `]` nudge the last-touched slider by 0.25. Only if the user wants it (Q5).

### 4.4 API (back compatible)

* `set(preset, { level, i, over, at })`: `level` may be a float 0..3; when `i` is given, `v = level + (i - 0.5) x 0.7` (old callers
  keep their meaning).
* `level(n, { i, over })`: float.
* New `strength({ rain: 2.4, wind: 1 }, { over, at })`: the per-effect patch.
* `clouds({ level })`: float 0..3, no rounding.
* `tornado.add/update({ level })`: float 1..3.
* `state()` adds `v` per effect, keeping `p` and `s`.

---

## 5. Cost and risk

### 5.1 Shader link times

* **No new program and no program variant** comes out of this. The level is a uniform everywhere. The fixes D1 to D3 add roughly
  100-250 characters to `haze` / `hazeCell` / `hazeShow` (one `mix`), `part` (one compare rewritten) and the lens programs (one loop
  weight). `dev/weather-link.test.mjs` caps each set at "now + ~10 %" (display 23 500, lens 43 500, ...). These additions fit, but the
  task must run the test and, if a cap is crossed, measure with `dev/weather-link-run.mjs` before raising it (FXC link cost is
  superlinear; earlier work split the tornado volume and deck programs for this reason).
* D7 (optional) adds one uniform and a few ops to `rain` and `part`. Same check.
* The pre-warm list (`displayPrograms` + `cloudPrograms` + `tornadoPrograms` + `lensPrograms`) is unchanged.
* After the update every player misses the program cache once, as with any shader edit. Bundle D1 to D3 (and D7) **into one release**
  so players pay that only once.

### 5.2 GPU cost between levels

* Every cost driver (slot counts, the lens's bead / speck counts, haze passes, the tornado's debris counts) is **monotone in v**, so
  between levels it costs between its neighbours. Below v 1 it costs less than level 1.
* The peak is **v = 3 = today's level 3 at i 0.5**. The old reachable peak (level 3 at i 1.0: 1.35x densities) is gone unless Q1 keeps
  an overdrive. So the worst case on a GTX 1080 does not rise; it falls slightly.
* One local increase: D1 takes the sand haze's second sample from v > 2 instead of v > 2.5. That costs one extra `drift3a` per haze
  cell (cached per art cell when zoomed in) for sand at 2..2.5. It is small and inside the cost of sand 3, which is already measured.
* The stacked worst case (storm = rain 3 + wind 3, + clouds 3 + godrays + lens + lightning) is the same stack as today. The lightning
  adds its own cost; that belongs to its agent.

### 5.3 The frame guard

Unchanged. `weatherQ()` still multiplies the densities and thins the fine detail **on top of** v, only under real overload, and
always returns to 1. Nothing in this design reads q into the stored state. D7 keeps q outside the birth-rate so guard steps behave as
today. The guard stays the only thing that may soften the look, and only temporarily.

### 5.4 Risks

| Risk | Mitigation |
|---|---|
| The look at 1 / 2 / 3 drifts | 2.1 makes it identical by construction; D1 to D6 are identical at the integers. **Verify:** pixel A/B (guard off, fixed clock: `weather-cost` shots, `fixedT`) main vs branch at v 1, 2, 3 per type: expect within the A/A noise |
| v-blend changes how preset switches look (eases through levels) | It is intentional (2.1); Q2 lets the user choose the old "fade at its own level" |
| Migration step for an old scene mid-ramp | Read-time only, once, small; node-tested with v1 fixtures |
| Merge conflicts with the lightning work | Lightning merges first; T1 rebases; 3.6 lists the touch points |
| More keys from slider use | One key per release; `KEEP_KEYS` folding is unchanged and tested |
| Sliders flood the bar | Q4 compact mode |

---

## 6. Implementation tasks

Each task fits one agent. Arrows are dependencies. "Live" means it needs a lane server (none is free right now; the user and the
orchestrator schedule that). Every task ends with its node tests green and no edits to the live tree.

| Task | What | Files | Depends on | Live? |
|---|---|---|---|---|
| **T1 Model v2 + migration** | `strength(v)`, v-blend, key / base / lens v2 schema, read-time migration, `withKey` patch semantics, cap as v; tornado `level` / `lv0` floats in `cleanTornado`, `levelS` unchanged. Rewrite the level-shaped asserts in the model tests; add v1 fixtures (`{l,i}`, numeric fx, base `{p,s}`, lens int, tornado int) and continuity tests (v ramps 0->3->0: p, s continuous; at v 1/2/3, gates equal the old level gates exactly) | `scripts/weather/model.mjs`, `scripts/weather/tornado-model.mjs`, `dev/weather-model.test.mjs`, `dev/tornado-model.test.mjs` | lightning merged (rebase) | no |
| **T2 Engine + API** | `clientState` (cap on v), `fireWet` / `rainAt` via p and s, `weatherApi` floats + `strength()`, `tornadoApi.update` float and D6, `syncClouds` / `syncLens` on v, status fields | `scripts/weather/weather.mjs` (and `fireWet` in model.mjs if not done in T1) | T1 | no (node + a quick lane check later in T6) |
| **T3 Shader step fixes D1-D3** | sand-haze lit `mix`, ember big-spark ramp, lens ghosts fractional; link-test caps checked (run `weather-link-run` if a cap moves) | `scripts/weather/fx-glsl.mjs`, `scripts/weather/lens.mjs`, `dev/weather-link.test.mjs` (caps only if measured) | none (parallel to T1; touches display-side GLSL the lightning agent also touches: start after lightning merges) | A/B in T6 |
| **T4 Tornado D4-D5** | fractional last item for the six counts, big fragments by birth level | `scripts/weather/tornado.mjs` | T1 (float level) | A/B in T6 |
| **T5 UI** | bar sliders, preset row as quick set, live value, keys 0-3, lens Auto / Fixed + slider, tornado sliders, status text; i18n EN + PL (new keys, reworded level hints, caps texts); CSS tick marks | `scripts/weather/section.mjs`, `lang/en.json`, `lang/pl.json`, `styles/maps.css` (the `mm-d-levels` area) | T1, T2 | yes (look and keys) |
| **T6 Verification** | lane run: (a) pixel A/B main vs branch at v 1/2/3 per type, guard off, fixed clock; (b) sweep v 0 -> 3 per type, screenshots and a webm of a 20 s ramp per type (no pops: sand 2 -> 3, embers 1 -> 2, dust lens 0 -> 3, tornado 1 -> 3); (c) cost sweep at v 0.5 / 1 / 1.5 / ... / 3 with `weather-cost` at DPR 1 and 2 plus `weak(N)` GTX-1080-class emulation (`weather-opt.mjs`); (d) an old v1 scene loads and looks the same; (e) players in sync (Test Gracz 1 / 2) | `dev/weather-slider-sweep.mjs` (new, small), existing `dev/weather-cost.mjs` / `weather-rec.mjs` | T1-T5 | yes |
| **T7 (optional) D7 birth-time density** | `uDensR` per layer, `dens(birth)` gate for snow, motes, embers, debris (rain optional); identical when steady | `scripts/weather/display.mjs`, `scripts/weather/fx-glsl.mjs`, `scripts/weather/glsl.mjs` | T6's ramp videos show mid-life pops | yes |

Parallel plan: T1 and T3 together (T3 after the lightning merge), then T2 and T4, then T5, then T6, then T7 only if T6 shows a need.

---

## 7. Questions only the user can answer

* **Q1 Overdrive:** old scenes that pushed fine intensity above the middle at level 3 clamp to 3 (up to 26 % fewer drops at the top).
  Keep the slider at 0..3 as asked (proposed), or allow 3..3.35 ("3+")?
* **Q2 Easing through levels:** with the slider, rain 3 -> clear passes through 2 and 1 (proposed). Today it fades out as a downpour.
  Which should it be?
* **Q3 Tornado at 0:** a tornado's slider 1..3 plus the rope-out button (proposed), or 0..3 where 0 means rope out?
* **Q4 Bar layout:** all seven sliders always (proposed), or only the active ones plus "+ type"?
* **Q5 Keys:** 0-3 for the preset (proposed). Also `[` / `]` to nudge?
* **Q6 Fire:** the fire layer also has levels 1 / 2 / 3. Same slider there, later? (Out of scope here.)

---

## 8. T1 as built (branch `weather-slider-t1`, 2026-11-09)

User decisions applied: Q1 overdrive to 3.35 (`V_MAX`), Q2 v-blend (eases through the levels), Q3 tornado level a float 1..3 with
rope-out separate (0 clamps to 1, never ropes out).

**Model (`scripts/weather/model.mjs`, VERSION 2).** `strength(v) -> { v, p: clamp(v, 0, 1), s: clamp(v - 1, 0, 2.35) }` is the only
mapping. Stored strengths go through `cleanV` (0..3.35, rounded to 1e-4). `fxV` reads every form (number, `{ v }`, v1 `{ l | level, i }`,
v1 base `{ p, s }`); `cleanKey` folds a v1 key `i` into `level` and drops `i`. The timeline blends v (missing = 0; exactly the target at
f = 1); `stateAt` / `resolve` return `fx: { e: { v, p, s } }` (dropped below `V_OFF` = 0.0005). Folding writes `base.fx` as numbers.
New exports: `V_MAX`, `V_OFF`, `FINE`, `cleanV`, `strength`, `legacyV`, `capV`, `capFx`, `lensP`, `presetOf`, `drivenFx`. `levelS` is
kept as a v1 helper (`legacyV - 1`).

**`withKey` semantics (3.3, with these details decided while building):**
* `{ preset, level? }`: the preset's effects at `level` (default the newest key's level; a stored level 0 falls back to 2). Clouds kept
  except by `clear` and by the clouds preset. `{ preset: "custom", fx }` = exactly `fx` (the old `set({ fx })` meaning); `custom`
  without fx keeps the effects.
* `{ level }` alone: every effect the current preset drives (`drivenFx`: a named preset's own effects, the clouds preset's clouds,
  custom's non-cloud effects); 0 removes them.
* `{ fx }`: a patch (v 0 removes); `{ clouds: v }` is sugar for it.
* v1 callers: `i` with `level` folds in; `i` alone uses round(newest level) as the level (the old fine slider; T5 removes it).
* The key's `preset` is always derived, `presetOf(fx)`: the preset whose non-cloud set equals fx's; none: "clouds" if clouds are on,
  else "clear"; else "custom". The key's `level` (carried to the next preset click) = the given level when > 0; a given 0 keeps the
  newest key's; otherwise the one strength all driven effects share; else the newest key's.

**Lens.** `lens.level` is "auto" or a strength 0..3.35 (junk / null -> "auto"; was -> 2). `lensS(P, s, cap)` keeps its signature
(fixed: `strength(v).s`); the new `lensP(P)` is the fixed lens's presence (1 for auto and for v >= 1). **lens.mjs does not multiply by
`lensP` yet** (T3's file): a lens fixed below 1 shows the level-1 lens at full presence until T2 / T3 wire it.

**Tornado (`tornado-model.mjs`).** `level` / `lv0` are floats clamped to 1..3, rounded to 1e-4 (an out-of-range number now clamps; it
used to fall back to 2); `cleanLevel` exported. `levelS` returns exactly `level - 1` once the ramp is over (bit-identical for ints).

**Tests.** weather-model: new sections J (mapping; at v 1 / 2 / 3 every resolved p, s, gate, lens gate, client cap, fireWet / rainAt
and the wet closed form equal the old formulas bit for bit, also through v1 `{ l, i }` keys and a chain of interrupted ramps;
overdrive; continuity of p, s and every gate x p along 0 -> 3.35 -> 0 and along a timeline), K (v1 fixtures: `{ l, i }`, numeric fx,
key level + i incl. 3 + i 1 -> 3.35, base `{ p, s }`, lens int, tornado int, storm passed through, idempotent, v1 and its v2 resolve the
same, v1 fine intensity), L (withKey patch semantics, presetOf, drivenFx, folding). Rewritten: the "fading effect keeps its level"
asserts (now eases through 2 and 1), `.l` reads, the continuity bounds (now the smoothstep's analytic slope 1.5 x dv / dur, since a
v ramp moves further than an s ramp). tornado-model: float levels, clamps, 0 is not rope-out, the int ramp bit for bit vs the old
formula. A throwaway A/B also ran the old main model against the new one on 576 integer-level cases (resolve, gates, lens, caps,
fireWet, drift; wet / cover for cut keys): all identical.

**Not covered by T1 (left for T2 / T4 / T5):**
* `weather.mjs` still reads the v1 shapes in a few places: `clouds()` returns `current(P).fx.clouds.l` (now undefined -> 0),
  `clientState` caps s itself (equivalent; T2 should use `capFx`), `tornadoApi.update` still rounds `level` / `lv0` (D6), `set()` /
  `level()` / `clouds()` still round to ints (`lvlOf`). `section.mjs` reads `fx.clouds.l` and `cur().i` (the clouds row and the fine
  slider show wrong values until T5). Nothing else breaks: `resolve` keeps p and s, `withKey` still accepts `{ level, i, clouds }`.
* Behaviour change by design (2.1, Q2): ramps blend v, so wet / cover accumulated during a ramp differ slightly from before (a fade-in
  of rain 2 is drizzle first). Steady states are identical.
* v1 level 1 with `i < 0.5` now maps to v 0.65..1 (presence): densities identical, tints scale with p (2.1, "negligible").
* Not verified live: no Foundry run, no pixel A/B (T6).

## 9. T2 as built (branch `weather-slider-t2`, 2026-11-09)

**Engine (`weather.mjs`).** `clientState` caps with `M.capFx(st.fx, detailCap())`: every fx entry is `{ v, p, s }`, p / s bit for bit
the old `s <= cap - 1 + 0.35` (a 1-ulp miss of T1's `capFx` at exactly v = cap + 0.35 was fixed: it now also tests s). `fireWet`,
`rainAt`, `syncClouds` and the storm already read p / s only: unchanged (fireWet is not level-shaped). `syncLens` makes no lens while
a fixed lens strength is 0. `lens.mjs` multiplies every lens presence (rain gates and each effect's p) by `M.lensP(P)` (x 1 exactly
for auto and fixed >= 1). `status().state` and `state()` carry v per effect.

**API (4.4).** The argument handling is pure and lives in model.mjs (`setChange`, `levelChange`, `cloudsChange`, `strengthChange`,
`strengthsOf`); weather.mjs only wraps them:
* `set(what, { level, i, over, at })`: `level` a float 0..3.35 (no rounding; junk -> 2; 0 = the preset's effects off); with `i`:
  `level + (i - 0.5) x 0.7`. Ints 1..3 with or without `i` give the same key as before (tested against the old code).
* `level(n, { i, over })`: float; 0 removes the driven effects (clouds kept).
* `strength(patch?, { over, at })` (new): `{ eff: v }` patch on the newest key (0 / null / false removes, unknown effects and junk
  ignored, nothing valid = no write). Always returns `{ preset, level, target: { eff: v }, live: { eff: v }, steady, until }`
  (world state, no client cap); without a patch it only reads.
* `clouds({ level, mode, rays }, { over })`: float, no rounding; returns `{ level: the target clouds v (0 = off), mode, rays, ... }`.
* `lens({ level: "auto" | v })`: a fixed float strength (below 1 fades the level-1 lens in).
* `tornado.add({ level })` float 1..3; `tornado.update(id, { level })` = `TM.retarget` (D6: `lv0` = the level now as a float,
  `level` = `TM.cleanLevel`, 0 clamps to 1, junk keeps it; steady int changes identical to before); `tornado.list()` adds `v = s + 1`.

**Back-compat notes.** Old `set(..., { level: 0 })` / `level(0)` meant "level 2" (lvlOf fallback); it now means off (design 4.4,
float 0..3). No caller in the module or dev scripts passes 0. Old `tornado.update({ level: 0 })` kept the level; now it clamps to 1.

**Tests.** New `dev/weather-api.test.mjs` (284 checks): A the helpers vs the old set() for every preset x level 1..3 x i (keys and
resolved states identical), floats, patches, `strengthsOf` mid-ramp; B `capFx` vs the old cap for v 0..3.35 step 0.01 x caps 1..3
bit for bit; C `retarget` vs the old update for steady 1..3 -> 1..3 (record and 6 s of `levelS` bit for bit), mid-ramp continuity
(old jumped > 0.1), floats / clamps; D the REAL `weatherApi` imported under small Foundry stubs (canvas not ready, so no display
runs): what set / level / clouds / strength / lens / tornado.* write to the flag, `state()` v mid-ramp, `rainAt`, and source checks
(no `lvlOf` / `.l` / rounded tornado level in weather.mjs; capFx and lensP wired).

**For T5 (section.mjs).** Read `Wx.strength()` (or `M.strengthsOf(P, now)`) for each slider: `target[e] ?? 0` is the slider value,
`live[e]` the live value while `!steady`. Write `Wx.strength({ [e]: v }, { over })` on release (clouds too: `{ clouds: v }`; or
`Wx.clouds({ level: v })`). Preset buttons: `Wx.set(preset, { over })` (the preset strength `level` carries over) and keys 0-3:
`Wx.level(n, { over })`. Replace `cur().fx.clouds.l` with `cur().fx.clouds ?? 0` and drop `cur().i` / the fine slider. The dock's
status: `state.fx[e].v` (and p while fading). Lens: `Wx.lens({ level: "auto" | v })`. Tornado sliders: `tornado.update(id, { level })`
float 1..3, `tornado.list()[n].v` for the live level; rope-out stays `tornado.remove(id)`.

**For T6 (live, not verified here).** No Foundry run: the display, lens and tornado paths were not drawn. Check live: a lens fixed at
0.5 shows at half presence and a fixed 0 creates no lens; clients with caps 1 / 2 see the same as before; tornado slider changes
mid-ramp glide; the dev scripts that call `set(..., { level })` still give the old looks (pixel A/B).

## 10. T5 as built (branch `weather-slider-t5`, 2026-11-09)

**Bar (`section.mjs`).** Preset row unchanged (quick sets: `weatherApi.set(preset, { over })`, the preset strength carries over;
pressed = `presetOf`). Below it **seven strength sliders, always shown** (Rain, Snow, Sand, Dust, Embers, Wind, Clouds; `strRow`): the
workspace's `optRange` markup (a `<range-picker>` 0..3.35 step 0.05 in an `mm-ws-opt mm-ws-range` row), the label the type's
`PRESET_ICONS` icon in its `PRESET_COLOR`, fixed label width so they line up in columns (4 + 3 at 1600 px). CSS (`.mm-wx-str`) draws
notches at 1 / 2 / 3 on the range input, tints the track above 3 (overdrive) in the type's colour, tints the thumb, dims a slider at 0
and underlines the one `[ ]` nudge. The cloud look buttons (sky / shadows, godrays) sit after the Clouds slider. Removed: the level
row, the clouds 0..3 row, the fine `wx.i` slider and every `lvl*` / `cl.*` / `intensity` key.
* **Write on release:** `change` of a range-picker (it fires only on release; arrows / the number field also commit) ->
  `weatherApi.strength({ [e]: v }, { over })`, skipped when v equals the target. One scene write per release (verified live: a 25-step
  drag wrote 1 key).
* **Live value:** while `strengthsOf` is not steady **or a key is still ahead** (`until !== null`: a change starts `LEAD_MS` later, and
  during the lead the state reads steady at the old values) a 4 Hz timer writes only `now 1.45` under the name and a marker on the track
  (`--mm-livef`, class `mm-wx-moving`); it stops when the ramp arrives. No re-render.
* **No re-render under the hand:** the existing rule (focus in the bar -> `sync()` only). `sync` writes every control except one the
  pointer holds (`held`, pointerdown until pointerup) or whose number field is being typed in; focus alone does not block it, because a
  slider keeps the focus after release and keys 0-3 must still move it.
* **Keys** (window capture, section open, no modifiers; typing = text / number inputs, select, textarea, contenteditable; a focused
  range input does NOT count as typing): **0-3** `weatherApi.level(n, { over })` on the preset's driven effects (`drivenFx`), no write
  when all already equal n; after 0 nothing is driven, so 1-3 bring back the effects 0 turned off (this client remembers them).
  **`[` / `]`** nudge the last-touched slider (default: the preset's first effect, else rain) along the 0.25 grid (1.3 ] -> 1.5, top
  3.35); the slider moves at once and ONE key is written 450 ms after the last press (a held key = one write).
* **Lens:** select Auto / Fixed strength + (when fixed) a 0..3.35 slider (`lensLevelHtml`, bar and dock; hidden, not removed, so a
  select change needs no re-render); writes `weatherApi.lens({ level })`. Fixed again restores the slider's last value.

**Dock.** Status line: `Storm, strength 2.21. Now: Rain 2.21, Wind 3, Clouds 1.` (v per effect, 2 decimals in the client's
language; presence is not shown, it equals v below 1). Tornadoes: "Next tornado" slider 1..3 (client), each tornado a slider 1..3
(`g.tlv.<id>`, release -> `tornadoApi.update(id, { level })`) with the live value / marker while its 5 s ramp runs (`list()[n].v`), the
rope-out button after it; the row label is "Tornado n" (+ "roping out"), its end in the tooltip. Lens panel as the bar. This client:
caps stay selects, texts say "strength".

**i18n.** New: `strength`, `strHint`, `sh.<type>` (per-type 1/2/3 meaning), `liveNow`, `lensFixed`, `lensFixedAt`, `lensFixedHint`,
`tornadoLevelHint`, `tornadoNewHint`. Reworded "level" -> "strength" / "siła": `ph.*`, `barHint`, `overHint`, `status`, `cap.*`,
`set.*Hint`, `lens*`, `tornadoHint`, `tornadoN` ("Tornado {n}"). Removed: `level`, `lvl1-3`, `lvlHint1-3`, `lvlShort`, `intensity*`,
`clouds`, `cl.*`, `clh.*`. `lang-audit` clean.

**Verified live** (lane 5, own headless Chrome, scene `ZZ-t5-weather`, GM + real player Test Gracz 1): the bar in EN and PL; a drag
writes one key and the weather ramps with the live value; keys 0-3 (incl. no-op repeat, 0 then 1), `[ ]` (3 presses = 1 write);
presets as quick sets incl. clouds; a custom mix (rain + snow) and key 2; clouds slider + look buttons; lens Auto / Fixed in bar and
dock; tornado slider (one write, live 1.78 -> 3 over 5 s) and rope-out; a v1 flag (`{ l, i }`, key `i` 0.8, lens 3) shows rain 2.21
(the range-picker displays 2.2: step 0.05), wind 3, clouds 1, lens Fixed 3, and is not rewritten on load; the player resolves the same
and follows a GM change mid-ramp; no new console error. Pre-existing (also on the T2 base, not T5): `CloudDisplay.draw` throws
"Cannot read properties of null (reading 'resolution')" (clouds.mjs:243, rt null) twice while a scene with clouds loads, GM and player.

**For T6.** Slider ramps per type at 1080p (the D7 question); a 1920 px bar (columns); the light theme; keyboard-only use of a slider
(arrows write one key per press); a 2-GM table (two GMs dragging at once: last write wins, as before).

## 11. T4 as built (D4, D5; branch `weather-slider-t4`, 2026-11-09)

**Counts (D4).** New pure module `scripts/weather/tornado-debris.mjs`: `whole(n)` (snaps float noise to a whole number), `share(n, i)`
= clamp(n - i, 0, 1). `nS`, `nW`, `nC`, `nI` are no longer rounded: the loops visit ceil(n) slots and each slot's alpha is x its
share, so the last item fades in / out. **Wisps**: the first half are dust wisps, the rest grey (`i < nW / 2`); the slot on the half's
fractional edge is drawn as both kinds crossfaded (dust x `share(nW / 2, i)`, grey x the rest), so no wisp switches kind.
**Fragments / planks (`nF`, `nP`) never fade** (no half-transparent map pieces) and never change mid-life: each slot's life is decided
once, from the level (and touch) at its **birth** t0, and memoised per slot (`this.frags[i]`, keyed by cycle and birth): kind
(`fragKind`: fragments fill [0, nF), planks [nF, nF + nP); a slot cut by a fractional boundary picks its kind with its own hash
`hF(kk, 17)` in proportion), big or not, `fragSz`, and the skirt radius where it is torn out (the scar no longer slides during a ramp).
The memo is what keeps a fragment intact when a **second change interrupts a running ramp**: the record only knows the newest ramp, so
the pure birth level of an older slot would move at that moment (shown by a mutation run of the test: without the memo, 390 / 1296
kind / size / vanish faults in the two interrupted scenarios). While the level has been still for a whole life (`now - lvT >= LEVEL_MS
+ 8 s + 50 ms`) only today's slots are visited; else all 50 (`FRAG_SLOTS`), a few dozen cheap rejects.

**Big fragments (D5).** `big = kind is fragment && hF(kk, 12) < 0.16 x bigShare(sB)`, `bigShare = smoothstep(0.3, 0.8, s)` at the
birth level (centred near the old step at s 0.56). Exactly 0 at level 1 (no fragments anyway) and exactly 1 (0.16) at levels 2 and 3.

**Also changed (touch / rope-out only):** the "torn out only while on the ground" hash gate `hF(kk, 11) > 0.3 + 0.7 x touch` now uses
the touch at birth (the other half of that gate already did). Before, a fragment in flight vanished when the touch dropped (rope-out);
now it finishes its flight and dissolves. Same at touch 1.

**Identity.** At levels 1 / 2 / 3, steady (touch, reach 1 and rope 0 for the last 9 s, any earlier ramp over by 13.1 s), guard q 1,
the output is identical: a throwaway A/B ran the old (127a873) and the new `TornadoView.debris()` with stubs on 42 498 frames (3
levels x 3 sizes x loop / ropeOut x ramps from each level, 0-260 s, ~11.7 M pushes): every push's float64 arguments and the float32
instance buffers equal. **Differences by design**, all outside that state: fractional counts under the guard (q < 1) and during
touch-down / rope-out now fade one item instead of rounding; fragments born during touch-down / a ramp keep their birth decisions for
their (8 s) life, so the first 8 s after the ramp ends differ from the old code too.

**Tests.** `dev/tornado-debris.test.mjs`: A whole / share (exact 0 / 1 at whole n, the integer levels' steady counts are whole and even
for wisps, shares sum to n and are continuous), B fragKind / bigShare (the old split at 1 / 2 / 3 for every slot and hash, expected
counts follow the table between levels, big share 0 / 0.16 / 0.16 and smooth), C the real `debris()` with stubs over 5 ramps (1 -> 3,
3 -> 1, 1.4 -> 2.6 and two interrupted by a second change): every fragment / plank keeps kind and size and is drawn every frame of its
life; at a settled level the fast path draws exactly what the full path draws.

**Not verified (T6, live):** the look of the fades (a speck / wisp / clump / streak fading over a 5 s ramp, day and night), that the big
fragments' share ramp reads naturally on 1 -> 2, the rope-out with fragments finishing their flight, and the CPU time of the 50-slot
path during a ramp (expected: microseconds).

## 12. T6 verification (branch `weather-slider-t6`, 2026-11-09)

Live on lane 5 (port 30005), own headless Chrome, scene `ZZ-t6-plain` of the test world, GM tab plus the real player Test Gracz 1.
Recorder: fixed virtual clock (`Date.now` = virtual time, the shared clock held, the ticker stepped), 60 fps, VP9 CBR 10M. Proof
videos, logs and tools: `dev/out/t6/` (not committed). Detectors (`dev/out/t6/tools`): `steps.mjs` (a 12 x 8 block's brightness
jumping in one frame, > 4 grey and > 6 x its local median), `persist.mjs` (px that pop in and STAY for 6 frames: a mid-life gate
flip, not motion), `cuts.mjs` (rain-lens runner vanish events).

**Scratchpad loss.** Another agent cleared the shared session scratchpad mid-run: every T6 script and the first A/B JSONs (the 120 / 120
identical hashes of 12602f2 vs 0a1dbf7) were lost. The tools were rebuilt in `dev/out/t6/tools` and every A/B re-run (below). The first
set of "pre-merge" ramp videos (`dev/out/t6/pre/`) is NOT evidence: orphaned recorder processes drove the same tab in parallel then
(e.g. the dust 0 -> 3 video already shows a full dust field at 0.5 s), so no before/after numbers below use it.

### 12.1 Fixes made in T6 (all on the branch)

1. **Rain lens runner trails (user report: "the trails end with a hard cut")** — 5ef5f86, merged into the one-output split (c4e9e26). A
   runner's trail was cut where its fade passed 0.3 and its head was a hard-edged disc: now a soft gate (`gon`) instead of the cut, the
   head shrinks with the fade, the trail's top is rounded and its pieces fade with the runner, so a trail thins out at the head, along
   the tail and at the end of its life, day and night. Same program sizes (weather-link caps hold), same passes (no new texture or
   pass; the disp pass still only while big drops fall). Lens-only day video, 16 s steady rain 3: tall vanish groups 94 -> 70, vanish
   events 37 -> 26 (the rest: drops that merge or leave the glass). See 12.4 for the re-record on the merged head.
2. **Bar layout**: the preset row was clipped at 1280 px and below (pre-existing) -> it wraps inside the bar (5ef5f86, css only).
   **Light theme**: the near-white type tints (snow, clouds, dust) on the preset buttons and slider icons were unreadable -> darkened
   (4fc6062).
3. **Lens snow crystals popped** (seen in the snow ramps): (a) slots flipping on / off during a ramp -> gated by the count at their
   birth (36ae2d2); (b) a frost edge moving over a melted crystal brought it back at full size in one step, steady weather too ->
   the frost brings it back gradually (8d15992).
4. **D7 done** (ee943fa): flakes, grit, motes, sparks and wind lines / debris turned on mid-life during a ramp (persistent pop-ins in
   the dust ramp well above the steady rate; snow similar). Now every particle slot is gated by the density at its BIRTH
   (`uDensR`: per kind and layer the density then / now, `display.densHist()` from the client state `stAt` = `weather.clientState`),
   and one born denser than now fades with the ratio, so a falling strength thins the air smoothly; the embers' big-spark share is
   also taken at birth. Steady: every ratio is exactly 1 and the history is not computed (identity: 12.2).
5. **Birth samples at fixed whole seconds** (5c8154d): the history was sampled at "now - age", so a slot's interpolated birth
   density moved from step to step; at the onset of a layer (0 -> something) a crystal born half a second earlier switched on at full
   size (one step left in the snow 0 -> 3 ramp at 9.12 s). Now the 12 samples sit at the whole seconds A - i of the clock (A = the next
   one: the planned state) and the shader adds A - clock to the age, so a slot's birth density is the same for its whole life. Both
   the D7 particles and the lens crystals.
6. **Wind cloud shadows popped** (3fcfb25): in a wind ramp the cloud display is born as the wind passes strength ~1.02 with cover
   0.006, and the cover threshold falls fastest at a thin cover (0.044 in one 12 Hz step, more than the 0.035 soft edge): a shadow
   patch appeared within one or two steps (measured live: display born 8.2 s after the ramp began, thr 0.901 -> 0.858 on the next step).
   Now the wind's shadows darken in with their cover (x smoothstep(cover / 0.06)); full from cover 0.06, so levels 2 and 3 unchanged.

### 12.2 Ramps (20 s, `W.strength({type: v}, {over: 20000})` at 1 s; day and night; `dev/out/t6/ramp-*.webm`)

Every final ramp video: **0 steps** (`steps.mjs`), day and night: rain 0 -> 3, snow 0 -> 3 and 3 -> 0 (also at zoom 2), sand 2 -> 3,
dust 0 -> 3 (also zoom 2), embers 1 -> 2, wind 0 -> 3, tornado 1 -> 3 -> 1, tornado rope-out, rain 0 -> 3 re-released to 1 at 9 s
(over 10 s); clouds 0 -> 3 (day) shows a fast but continuous condensation around 6 s (block changes of 4-6 grey over many frames,
no one-frame jump). Persistent pop-ins (`persist.mjs`, per s) follow the density: dust 0 -> 3 passes v 1.5 at ~11 s with 205-225 /s
against 155-240 /s in the steady dust 1.5 video; snow 0 -> 3 at v 1.5 ~226-270 /s against 70-250 /s steady 1.5 (the flakes' own
motion); embers 0-4 /s throughout (they are born and die by pixel dropout). Sand 2 -> 3 thickens smoothly on the lit and shadow sides
(sheet checked day and night). Tornado: debris counts grow and shrink without a jump, big fragments finish their flight; rope-out
dissolves. The day rain, clouds, tornado and re-release videos were recorded on 8d15992 (their paths are unchanged since); all others
on 5c8154d.
### 12.4 The runner-trail fix on the merged head (one-output lens split)

Re-recorded after merging main's lens split (`lensonly-head-{day,night}.webm`: the lens alone, display meshes hidden, 16 s of steady
rain 3): every piece of the fix is in the shared lens source and both programs (shade, disp) compile from it (gl-one-output ok).
`cuts.mjs` now also classifies the vanish groups: a "revert" is a tall thin group that went back to what was there 2 s before (a trail
gone at once); the rest are runners starting or sliding within one 12 Hz lens step. Day: reverts 21 before -> 11 on the merged head
(15 on the pre-merge fix). The 11 left were inspected frame by frame: drops merging into a bigger drop, the refraction moving under
a passing drop, and a drop at the map's edge; none is a trail ending in a cut. Night: 7 reverts, the same kinds. Side by side:
`runner-trails-ab-head-day-crop.webm` (before | merged head), `runner-trails-ab-{day,night}-crop.webm` (before | pre-merge fix).

### 12.5 Layout

Shots in `dev/out/t6/layout/` at 1024, 1280, 1600 and 1920 px, dark and light theme. Before: the preset row (11 buttons) ran out
of the bar at 1280 px and below; now it wraps inside the bar (two rows at 1024 and 1280). The light theme's near-white tints (snow,
clouds, dust) were unreadable on the light buttons; now darkened toward the ink colour. Not this module: another module's HUD (ORBIT /
Kid Thor) floats over the tool row at the top.
### 12.3 Pixel A/B (`dev/out/t6/ab/`, hashes of the whole canvas at T0 + 5000 and T0 + 5900, guard off, fixed clock)

Every case is written as a steady key 60 s old, so it is steady weather at v 1, 2 and 3. Lane 5 was switched between builds by its
junction, and every run printed a build fingerprint (`partDensOf` exists only with D7, `W.strength` only from the slider on), so each
run is proven to be the build it is labelled. The lens runs pin `CONFIG.moinenMaps.weatherLensBands = 1`: with the default, the band
count follows the measured fps, and two runs of the same build differed (4 / 36 snow rows).

**Reproducibility first (the same build twice).** Lens on: 35 / 36 identical (night snow 3 differs: not reproducible). Lens off: the
cloud layer is not reproducible when the case order changes (clouds 1 / 3, tornado 3, wind 3 night, storm 3 day differ between runs
of one build: its render targets only grow, so their size depends on the earlier cases). Those rows are inconclusive below.

| build A vs build B | lens | identical | the rows that differ |
|---|---|---|---|
| 12602f2 (pre-slider) vs 0a1dbf7 (T1-T5) | off, 10 types x 1/2/3, day + night | 58 / 60 | clouds 1, tornado 3 (day): the non-reproducible set |
| 0a1dbf7 vs 2a59411 (main) | off, wind / storm / blizzard | 17 / 18 | blizzard 3 day (cloud set) |
| 2a59411 vs head (same case order) | off, wind / storm / blizzard | 12 / 18 | wind / storm / blizzard 3, day and night: first shot only, 4 px by 1 / 255 (below) |
| 2a59411 vs head | on, rain / snow / sand / dust / storm / blizzard | 16 / 36 | rain 1-3, storm 1-3 (runner trails), snow 2-3, blizzard 2-3 (frost-edge crystals): by design |
| 12602f2 vs 0a1dbf7 | on, the same 6 types | 32 / 36 | blizzard 2 day, rain / snow / storm 3 night |
| 12602f2 vs 2a59411 | on | 31 / 36 | snow 2-3, sand 3 (day), rain / storm 3 (night) |

**Steady identity of D7: not to the bit.** Bisected by commit (c4e9e26 = main's hash, ee943fa = head's), the wind 3 first shot differs
in 4 px by 1 / 255 (max channel 1; saved PNGs, `ab/main-wind3-0.png` vs `ab/head-wind3-0.png`); the second shot is identical. Every
history ratio is exactly 1 while steady and b95047c makes the shader take the pre-D7 arithmetic then (no history reads), yet the hash
stays: the cause is the changed program text (ANGLE / D3D11 compiles the unchanged arithmetic around it differently), not the D7 math.
Invisible, but not identical; stated as such.

**The lens rows that differ between the three older builds** (12602f2, 0a1dbf7, main) with the bands pinned are not explained by any
T6 change; they may be T1-T5 / main lens changes or residual non-reproducibility (one run each). Not resolved in T6.
### 12.6 Players, v1 scenes, lens settings

**Sync (real player).** Test Gracz 1 (PLAYER) on its own origin (127.0.0.45) and the GM on 127.0.0.35, scene activated for both:
rain 3 + snow 1.5 + wind 2 over 20 s, then rain changed to 1 over 6 s mid-ramp. At 6 shared times (3.5 s apart, across the
ramp, the mid-ramp change and the settled state) `W.state(T)` was identical on both clients (`logs/sync.json`); no error or weather
warning on either (`logs/sync-*-errors.json`, the clouds:243 "null resolution" included: not seen in this run).

**Old v1 scene.** A raw version-1 flag (storm keys with `{l, i}`, lens level 3, an integer tornado level) written on 12602f2 and on
head: both resolve the same state at T0 + 5 s (rain / wind p 1, s 1.4864; clouds p 1, s 0; head adds `v`), and neither rewrites
the flag on load (`ab/v1-*.json`). Pixel hashes differ, as expected for this storm: rain lens (runner fix), clouds and a tornado
(the non-reproducible set).
### 12.7 Cost (`dev/out/t6/cost/`, weather-opt costStart: GPU ms per frame by timer queries, CPU ms per frame; 60 frames, one rep)

GPU ms / frame (the weather's passes), DPR 1 and 2, weak 1 and weak 2 (`weak 2`: the GTX 1080 emulation, every pass drawn twice):

| case | DPR 1 | DPR 1 weak 2 | DPR 2 | DPR 2 weak 2 |
|---|---|---|---|---|
| rain 0.5 / 1 / 1.5 / 2 / 2.5 / 3 / 3.35 | 0.49 / 0.51 / 0.45 / 0.80 / 0.68 / 1.21 / 1.41 | 0.94 / 0.67 / 0.92 / 1.09 / 1.38 / 1.66 / 2.02 | 0.54 / 0.58 / 0.97 / 0.98 / 0.88 / 1.04 / 1.16 | 0.80 / 0.85 / 1.23 / 1.45 / 1.76 / 2.03 / 2.44 |
| snow | 0.21 / 0.46 / 0.32 / 0.32 / 0.68 / 0.38 / 0.65 | 0.43 / 0.41 / 0.61 / 0.70 / 0.67 / 0.70 / 0.74 | 0.57 / 0.64 / 0.75 / 0.50 / 0.52 / 0.54 / 1.00 | 0.67 / 0.68 / 0.85 / 0.89 / 1.04 / 1.05 / 1.10 |
| sand (+ 2.25 between 2 and 2.5) | 0.26 / 0.48 / 0.65 / 0.45 / 0.47 / 0.56 / 0.71; 2.25: 0.78 | 0.59 / 0.74 / 1.82 / 0.80 / 0.91 / 1.10 / 0.99; 0.96 | 0.55 / 0.39 / 0.78 / 0.87 / 0.60 / 0.62 / 0.60; 0.68 | 0.70 / 0.71 / 1.08 / 1.01 / 1.15 / 1.10 / 1.35; 1.25 |
| dust | 0.13 / 0.23 / 0.19 / 0.32 / 0.44 / 0.30 / 0.48 | 0.27 / 0.30 / 0.46 / 0.53 / 0.79 / 0.55 / 0.59 | 0.30 / 0.35 / 0.50 / 0.52 / 0.79 / 0.67 / 0.73 | 0.46 / 0.46 / 0.53 / 0.53 / 0.86 / 0.78 / 0.80 |
| embers | 0.06 / 0.06 / 0.24 / 0.35 / 0.32 / 0.16 / 0.37 | 0.21 / 0.12 / 0.50 / 0.56 / 0.31 / 0.33 / 0.44 | 0.26 / 0.16 / 0.30 / 0.32 / 0.56 / 0.56 / 0.39 | 0.24 / 0.46 / 0.55 / 0.57 / 0.59 / 0.68 / 0.70 |
| wind | 0.44 / 0.13 / 0.25 / 0.18 / 0.55 / 0.29 / 0.30 | 0.27 / 0.34 / 0.46 / 0.39 / 0.52 / 0.56 / 0.70 | 0.20 / 0.38 / 0.63 / 0.48 / 0.46 / 0.62 / 0.60 | 0.41 / 0.41 / 0.53 / 0.54 / 0.89 / 0.93 / 1.15 |
| clouds | 0.21 / 0.21 / 0.27 / 0.25 / 0.26 / 0.27 / 0.19 | 0.35 / 0.27 / 0.58 / 0.29 / 0.40 / 0.52 / 0.42 | 0.25 / 0.47 / 0.31 / 0.52 / 0.50 / 0.59 / 0.38 | 0.50 / 0.55 / 0.62 / 0.65 / 0.65 / 0.67 / 0.69 |
| storm | 0.34 / 0.60 / 0.57 / 1.00 / 0.87 / 0.95 / 1.16 | 0.72 / 0.80 / 1.05 / 1.23 / 1.70 / 1.91 / 2.39 | 0.53 / 0.53 / 0.74 / 0.88 / 1.33 / 1.46 / 1.63 | 1.03 / 1.11 / 1.53 / 1.64 / 2.36 / 2.49 / 2.91 |
| tornado 1 / 1.5 / 2 / 2.5 / 3 | 0.47 / 0.64 / 0.77 / 0.77 / 0.61 | 0.50 / 0.70 / 0.75 / 0.77 / 1.28 | 0.53 / 0.57 / 1.12 / 0.80 / 1.02 | 0.47 / 0.78 / 1.05 / 1.42 / 1.85 |

One rep, so +-0.3 ms of noise between neighbours (the weak-2 column is the steadier trend); the costs grow with v and none jumps
between whole levels. CPU ~0.1-0.2 ms per frame (tornado ~1 ms); single spikes in one view only (sand 1.5 17 ms, storm 3.35 8 ms,
tornado 1.5 6 ms, embers 1.5 4 ms; the other three views of the same case 0.1-0.4 ms): first-use compiles / GC, not the steady cost.
**Clients capped** (`weatherDetail` 1 / 2, restored to 3 after): sand 2.25 / 3 and storm 3 at detail 1: 0.43 / 0.42 / 0.80 ms (DPR 1),
1.14 / 1.06 / 1.39 (DPR 2 weak 2); detail 2: 0.92 / 0.49 / 1.15 and 1.18 / 1.28 / 2.11; detail 3 (above): 0.78 / 0.56 / 0.95 and
1.25 / 1.10 / 2.49. **D7 histories during a ramp** (snow, dust, wind and sand ramping together, 300 calls): `display.densHist()`
0.158 ms per 12 Hz step, `lens.crystalHist()` 0.081 ms per lens step; nothing while steady.

**Lens settings.** Fixed lens 0: no lens display at all, the frame identical to lens off (0 px). Fixed 0.5: the lens is made, at
`lensP` 0.5; against lens off it changes 32 % of the px and 30 % of the mean that fixed 1 changes (rain 3, two shots).

### 12.8 Verified / not verified

Verified (a tool exercised it): every item in 12.1-12.7 as stated, on lane 5 with the headless Chrome (ANGLE D3D11) of this machine.
Not verified: the look on a real GTX 1080 (only the weak-2 emulation); other browsers / GPUs; the lens rows that differ between the
three older builds (12.3, last paragraph); a player at DPR 2; the clouds:243 "null resolution" error (not reproduced in T6, not
fixed here: main's f64d681 bindBack covers it); tornado debris counts were judged from the videos, not counted.
