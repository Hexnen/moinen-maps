/**
 * The built-in destruction presets (set "military"): the bomb, the grenade, the Uzi and the classic twin heavy machine gun from a
 * helicopter. Pure data in the format of core.mjs (dev/presets-design.md section 4). Read-only: a GM's own presets will be copies
 * (the editor, P7). Layers marked pending in core.mjs (burst, dust, accent, cue) are carried in the firing record until their
 * layers exist (P3, P4, P5); the rest is written now.
 * The user's answers (design note, section 10): no sound, no helicopter shadow, nothing pushes tokens; the aftermath fire ends after
 * the preset's aftermath duration, or burns until the GM puts it out (aftermath.dur null) - a preset setting, per firing too.
 */
import { LANDING } from "./def-landing.mjs";

export const BUILTIN = Object.freeze([
  {
    id: "bomb", v: 1, set: "military", name: "MOINENMAPS.DPreset.bomb", hint: "MOINENMAPS.DPreset.bombHint", icon: "fa-solid fa-bomb",
    gesture: "point", preroll: 1200, aftermath: { dur: 60 },
    layers: [
      { l: "accent", id: "fall", kind: "fallShadow", at: -1200, dur: 1200 },
      { l: "cue", id: "screen", kind: "screen", at: 0, shake: 0.9, flash: 0.6 },
      { l: "cue", id: "light", kind: "light", at: 0, peak: 1, radius: 4, decay: 1500 },
      { l: "burst", id: "burst", at: 0, lv: 3, r: 1.6 },
      { l: "destruction", id: "crater", at: 200, type: "blast", level: 3, cause: "fire", r: 1.2, pr: { jagged: true, jag: 0.7 } },
      // (two or three smaller blasts torn out of its rim: one round crater read as a stamped disc)
      { l: "destruction", id: "lobes", at: 240, type: "blast", level: 2, cause: "fire", place: { m: "scatter", n: [2, 3], d: [0.6, 0.9] }, r: [0.42, 0.62], pr: { jagged: true, jag: 0.8 } },
      { l: "dust", id: "shock", dk: "shock", at: 30, lv: 3, r: 2.7, life: 305000 },   // (3.5 read as a huge flat oval over the whole view at zoom 3)
      { l: "fire", id: "rim", at: [900, 1300], place: { m: "ring", n: [2, 4], d: [0.95, 1.3] }, lv: 2, lvMix: [0.5, 0.5, 0], sm: 1, r: [0.3, 0.45], len: [0.3, 0.7], aftermath: true, lifeK: [0.5, 1], gr: 0.6 },
      { l: "fire", id: "debris", at: [150, 1400], place: { m: "scatter", n: [6, 12], d: [1.5, 3.5], bias: 1.4 }, lv: 1, sm: 1, r: [0.15, 0.25], aftermath: true, lifeK: [0.3, 0.8], gr: 0.3 },
      { l: "smoke", id: "column", at: 1200, sm: 3, r: 0.8, aftermath: true }
    ]
  },
  {
    id: "grenade", v: 1, set: "military", name: "MOINENMAPS.DPreset.grenade", hint: "MOINENMAPS.DPreset.grenadeHint", icon: "fa-solid fa-burst",
    gesture: "throw", preroll: 1500, aftermath: { dur: 20 },
    layers: [
      { l: "accent", id: "arc", kind: "throwArc", at: -1500, dur: 1000 },
      { l: "accent", id: "bounce", kind: "bounce", at: -500, dur: 500 },
      { l: "cue", id: "screen", kind: "screen", at: 0, shake: 0.5, flash: 0 },
      { l: "cue", id: "light", kind: "light", at: 0, peak: 0.5, radius: 2, decay: 600 },
      { l: "burst", id: "burst", at: 0, lv: 1, r: 0.55 },
      { l: "destruction", id: "crater", at: 200, type: "blast", level: 2, cause: "fire", r: 0.35, pr: { jagged: true, jag: 0.6 } },   // (under the fireball: its white core alone shows ~T+120, the crater must not open round it first)
      { l: "destruction", id: "shrapnel", at: 150, type: "cracks", level: 1, cause: "none", place: { m: "scatter", n: [10, 18], d: [0.3, 1.4], bias: 1.6 }, r: [0.08, 0.14] },
      { l: "dust", id: "shock", dk: "shock", at: 20, lv: 1, r: 0.85, life: 155000 },   // (a grenade's dust ring stays low and close)
      { l: "smoke", id: "wisps", at: 300, sm: 1, r: 0.5, life: 8000, gr: 0.6 },
      { l: "fire", id: "smoulder", at: 400, chance: 0.3, place: { m: "scatter", n: [1, 1], d: [0, 0.3] }, lv: 1, sm: 1, r: 0.25, aftermath: true, gr: 0.4 }
    ]
  },
  {
    // UZI: a ragged stitch of small hits walking along the line - each a sharp pock with chips (the damage), a quick spit of the
    // ground's own dust (dust "hits" L1), a spark star and sparks; the shooter's muzzle flash and pale bullet streaks when a shooter
    // is given (gesture.from: the GM's chosen source token; with none chosen, a drag started on a token makes it the shooter for
    // that burst - it then starts a little way out from them); no shooter, no muzzle flash
    id: "uzi", v: 1, set: "military", name: "MOINENMAPS.DPreset.uzi", hint: "MOINENMAPS.DPreset.uziHint", icon: "fa-solid fa-gun",
    gesture: "line", preroll: 600, aftermath: null,
    walk: { rate: 14, speed: 5, dur: [0.6, 2.5], lanes: [0], sigma: [0.18, 0.36], drift: 0.3, sway: { amp: 0.15, wave: 3 }, stray: { p: 0.15, k: 1.5 }, maxHits: 25 },
    layers: [
      { l: "accent", id: "muzzle", kind: "muzzle", at: -600, dur: 600 },
      { l: "accent", id: "hits", kind: "hitFx", at: 0, dur: 250, lv: 1 },
      { l: "destruction", id: "pocks", at: 0, type: "blast", cause: "impact", lvMix: [0.6, 0.4, 0], place: { m: "walk" }, r: [0.14, 0.2],
        pr: { rubble: 0.1, debris: 0.2, scatter: 0.3, halo: 0.15, edge: 0.5, jagged: true, jag: 0.3 } },
      { l: "dust", id: "puffs", dk: "hits", at: 0, lv: 1, r: 0.22, place: { m: "walk" }, life: 6000 }
    ]
  },
  {
    // THE CLASSIC TWIN HEAVY MACHINE GUN FROM A HELICOPTER: two lanes of heavy hits racing along the run side by side, out of step -
    // each a chewed pock (now and then a small crater), a tall geyser of the ground's dust with chips flying high (dust "hits" L3), a
    // flash and a spray of sparks, every 4th round of each gun a tracer streaking in from above along the run; the screen rumbles.
    // With a SHOOTER (a gunship token the GM chose; a run started on a token never makes it one): both barrels flash at its edge with every round and
    // the tracers fly out of them; without one the gunship is off the map - no muzzle flash, the tracers come in from above
    id: "heliHmg", v: 1, set: "military", name: "MOINENMAPS.DPreset.heliHmg", hint: "MOINENMAPS.DPreset.heliHmgHint", icon: "fa-solid fa-helicopter",
    gesture: "run", preroll: 1500, aftermath: null,
    walk: { rate: 9, speed: 8, dur: [0.6, 3], lanes: [-0.55, 0.55], phase: [0, 0.5], sigma: [0.16, 0.22], sway: { amp: 0.3, wave: 5 }, wobble: { amp: 0.1, wave: 2 },
      stray: { p: 0.1, k: 1.5 }, maxHits: 24 },
    layers: [
      { l: "accent", id: "tracers", kind: "tracer", at: -250, dur: 200, every: 4, lv: 3 },
      { l: "accent", id: "hits", kind: "hitFx", at: 0, dur: 300, lv: 3, shake: 0.6 },
      // (after the tracers and hits: their accents keep their order, so without a shooter the heli draws exactly as before)
      { l: "accent", id: "muzzle", kind: "muzzle", at: -300, dur: 300, lv: 3 },
      { l: "destruction", id: "lanes", at: 0, type: "blast", cause: "impact", lvMix: [0.7, 0.3, 0], place: { m: "walk" }, lanes: "each", r: [0.18, 0.26],
        pr: { rubble: 0.15, debris: 0.25, scatter: 0.3, halo: 0.2, edge: 0.55, jagged: true, jag: 0.35 } },
      { l: "destruction", id: "minis", at: 0, type: "blast", level: 2, cause: "impact", place: { m: "walk", pick: 0.06 }, lanes: "all", r: [0.3, 0.36],
        pr: { rubble: 0.3, debris: 0.4, scatter: 0.5, halo: 0.25, jagged: true, jag: 0.6 } },
      { l: "dust", id: "geysers", dk: "hits", at: 0, lv: 3, r: 0.22, place: { m: "walk" }, life: 6000 }
    ]
  },
  {
    // LIGHTNING STRIKE (dev/presets-design.md section 18): the charge crackles over the spot, the sky flickers, a stepped leader feels
    // its way down and streamers reach up; the return stroke slams a white channel down from above the screen with a cold flash, two
    // or three restrikes, arcs racing over the ground, a molten spray - then a small fused, burnt scar, steam
    // and smoke, and small grass fires catching (the accent "strike" is drawn by presets/lightning.mjs)
    id: "lightning", v: 1, set: "nature", name: "MOINENMAPS.DPreset.lightning", hint: "MOINENMAPS.DPreset.lightningHint", icon: "fa-solid fa-bolt-lightning",
    gesture: "point", preroll: 1000, aftermath: { dur: 40 },
    layers: [
      { l: "accent", id: "strike", kind: "strike", at: -1000, dur: 2600, lv: 2 },
      { l: "cue", id: "screen", kind: "screen", at: 0, shake: 0.55, flash: 0 },
      { l: "destruction", id: "scar", at: 40, type: "blast", level: 1, cause: "lightning", r: 0.45 },
      { l: "dust", id: "shock", dk: "shock", at: 10, lv: 1, r: 1.2, life: 155000 },
      { l: "smoke", id: "steam", at: 250, sm: 1, r: 0.4, life: 14000, gr: 0.4 },
      { l: "fire", id: "grass", at: [400, 1200], place: { m: "ring", n: [1, 3], d: [0.35, 0.9] }, lv: 1, sm: 1, r: [0.18, 0.28], aftermath: true, lifeK: [0.4, 1], gr: 0.5 }
    ]
  },
  LANDING,
  {
    // ROCKET / RPG (dev/presets-design.md section 21): with a SHOOTER (a token the GM chose, or a shot dragged out of a token) a hiss at
    // the tube's rear, the launch flash and a billowing backblast; the rocket flies to the target with its motor flame, laying a smoke
    // trail that swells, rises, wanders and dissolves; a shell's fireball, a crater, the dust ring, small fires. No shooter: no hiss,
    // no flash, no backblast - it comes in from off the map (the accent "rocket" is drawn by presets/rocket.mjs)
    id: "rocket", v: 1, set: "military", name: "MOINENMAPS.DPreset.rocket", hint: "MOINENMAPS.DPreset.rocketHint", icon: "fa-solid fa-rocket",
    gesture: "shot", preroll: 1100, aftermath: { dur: 45 },
    layers: [
      { l: "accent", id: "rocket", kind: "rocket", at: -1100, dur: 6400, lv: 2 },
      { l: "cue", id: "screen", kind: "screen", at: 0, shake: 0.6, flash: 0.3 },
      { l: "burst", id: "burst", at: 0, lv: 2, r: 0.85 },
      { l: "destruction", id: "crater", at: 0, type: "blast", level: 2, cause: "fire", r: 0.7, pr: { jagged: true, jag: 0.6 } },
      { l: "dust", id: "shock", dk: "shock", at: 20, lv: 2, r: 2.2, life: 245000 },
      { l: "fire", id: "debris", at: [150, 900], place: { m: "scatter", n: [3, 6], d: [1, 2.4], bias: 1.3 }, lv: 1, sm: 1, r: [0.14, 0.22], aftermath: true, lifeK: [0.3, 0.8], gr: 0.3 },
      { l: "fire", id: "rim", at: [700, 1100], place: { m: "ring", n: [1, 3], d: [0.6, 0.9] }, lv: 1, lvMix: [0.7, 0.3, 0], sm: 1, r: [0.22, 0.32], len: [0.2, 0.5], aftermath: true, lifeK: [0.5, 1], gr: 0.5 },
      { l: "smoke", id: "column", at: 1200, sm: 2, r: 0.55, aftermath: true }
    ]
  },
  {
    // THE METEOR (dev/presets-design.md section 22): a white-hot head rushing down the sky at an angle with a plasma tail, shedding
    // sparks, a dark smoke trail hanging along the way it came, its shadow / its light running in over the ground; then the biggest
    // blast of the set - a pressure ring racing out, a huge fireball, a big torn crater, the shock dust and its five-minute haze, rocks
    // thrown out on arcs that land one by one (each a pock and a geyser of dust), burning chunks, fires round the rim and in the
    // heart, the smoke column; the sky trail lingers, drifts and breaks up
    id: "meteor", v: 1, set: "nature", name: "MOINENMAPS.DPreset.meteor", hint: "MOINENMAPS.DPreset.meteorHint", icon: "fa-solid fa-meteor",
    gesture: "point", preroll: 2600, aftermath: { dur: 90 },
    ejecta: { n: [13, 16], d: [2.3, 6.5], t: [420, 1500], gap: 70, bias: 1.3 },
    layers: [
      { l: "accent", id: "meteor", kind: "meteor", at: -2600, dur: 18600 },
      { l: "cue", id: "screen", kind: "screen", at: 0, shake: 1, flash: 1 },
      { l: "burst", id: "burst", at: 0, lv: 3, r: 2.4 },
      { l: "destruction", id: "crater", at: 0, type: "blast", level: 3, cause: "fire", r: 2.0, pr: { jagged: true, jag: 0.75, rubble: 0.7, debris: 0.8 } },
      { l: "destruction", id: "ejecta", at: 0, type: "blast", cause: "impact", lvMix: [0.5, 0.5, 0], place: { m: "ejecta" }, r: [0.2, 0.32],
        pr: { rubble: 0.3, debris: 0.4, scatter: 0.5, halo: 0.25, edge: 0.55, jagged: true, jag: 0.6 } },
      { l: "dust", id: "shock", dk: "shock", at: 30, lv: 3, r: 6.5, life: 305000 },
      { l: "dust", id: "landings", dk: "hits", at: 0, lv: 3, r: 0.3, place: { m: "ejecta" }, life: 7000 },
      { l: "fire", id: "heart", at: 1000, lv: 2, sm: 1, r: 0.55, aftermath: true, lifeK: [0.85, 1], gr: 0.5 },
      { l: "fire", id: "rim", at: [900, 1300], place: { m: "ring", n: [3, 5], d: [1.6, 2.1] }, lv: 2, lvMix: [0.4, 0.6, 0], sm: 1, r: [0.35, 0.5], len: [0.4, 0.9], aftermath: true, lifeK: [0.45, 1], gr: 0.6 },
      { l: "fire", id: "debris", at: [150, 1400], place: { m: "scatter", n: [8, 14], d: [2.4, 5.5], bias: 1.2 }, lv: 1, sm: 1, r: [0.15, 0.28], aftermath: true, lifeK: [0.3, 0.8], gr: 0.3 },
      { l: "smoke", id: "column", at: 1200, sm: 3, r: 1.1, aftermath: true }
    ]
  }
]);

export const builtinIds = () => BUILTIN.map((d) => d.id);
