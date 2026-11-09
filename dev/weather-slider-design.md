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
