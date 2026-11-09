/**
 * The built-in destruction presets (set "military"): the bomb, the grenade, the Uzi and the classic twin heavy machine gun from a
 * helicopter. Pure data in the format of core.mjs (dev/presets-design.md section 4). Read-only: a GM's own presets will be copies
 * (the editor, P7). Layers marked pending in core.mjs (burst, dust, accent, cue) are carried in the firing record until their
 * layers exist (P3, P4, P5); the rest is written now.
 * The user's answers (design note, section 10): no sound, no helicopter shadow, nothing pushes tokens; the aftermath fire ends after
 * the preset's aftermath duration, or burns until the GM puts it out (aftermath.dur null) - a preset setting, per firing too.
 */
export const BUILTIN = Object.freeze([
  {
    id: "bomb", v: 1, set: "military", name: "MOINENMAPS.DPreset.bomb", hint: "MOINENMAPS.DPreset.bombHint", icon: "fa-solid fa-bomb",
    gesture: "point", preroll: 1200, aftermath: { dur: 60 },
    layers: [
      { l: "accent", id: "fall", kind: "fallShadow", at: -1200, dur: 1200 },
      { l: "cue", id: "screen", kind: "screen", at: 0, shake: 0.9, flash: 0.6 },
      { l: "cue", id: "light", kind: "light", at: 0, peak: 1, radius: 4, decay: 1500 },
      { l: "burst", id: "burst", at: 0, lv: 3, r: 1.6 },
      { l: "destruction", id: "crater", at: 0, type: "blast", level: 3, cause: "fire", r: 1.2, pr: { jagged: true, jag: 0.7 } },
      { l: "dust", id: "shock", dk: "shock", at: 30, lv: 3, r: 3.5, life: 90000 },
      { l: "fire", id: "rim", at: [900, 1300], place: { m: "ring", n: [2, 4], d: [0.95, 1.3] }, lv: 2, lvMix: [0.5, 0.5, 0], sm: 1, r: [0.3, 0.45], len: [0.3, 0.7], aftermath: true, lifeK: [0.5, 1] },
      { l: "fire", id: "debris", at: [150, 1400], place: { m: "scatter", n: [6, 12], d: [1.5, 3.5], bias: 1.4 }, lv: 1, sm: 1, r: [0.15, 0.25], aftermath: true, lifeK: [0.3, 0.8] },
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
      { l: "burst", id: "burst", at: 0, lv: 1, r: 0.5 },
      { l: "destruction", id: "crater", at: 0, type: "blast", level: 2, cause: "impact", r: 0.35 },
      { l: "destruction", id: "shrapnel", at: 0, type: "cracks", level: 1, cause: "impact", place: { m: "scatter", n: [10, 18], d: [0.3, 2], bias: 1.6 }, r: [0.08, 0.14] },
      { l: "dust", id: "shock", dk: "shock", at: 20, lv: 1, r: 1.5, life: 20000 },
      { l: "smoke", id: "wisps", at: 300, sm: 1, r: 0.5, life: 8000 },
      { l: "fire", id: "smoulder", at: 400, chance: 0.3, place: { m: "scatter", n: [1, 1], d: [0, 0.3] }, lv: 1, sm: 1, r: 0.25, aftermath: true }
    ]
  },
  {
    id: "uzi", v: 1, set: "military", name: "MOINENMAPS.DPreset.uzi", hint: "MOINENMAPS.DPreset.uziHint", icon: "fa-solid fa-gun",
    gesture: "line", preroll: 600, aftermath: null,
    walk: { rate: 10, speed: 5, dur: [0.6, 2.5], lanes: [0], sigma: [0.25, 0.5], drift: 0.3, sway: { amp: 0.15, wave: 3 }, stray: { p: 0.15, k: 1.5 }, maxHits: 25 },
    layers: [
      { l: "accent", id: "muzzle", kind: "muzzle", at: -600, dur: 600 },
      { l: "accent", id: "hits", kind: "hitFx", at: 0, dur: 250 },
      { l: "destruction", id: "pocks", at: 0, type: "cracks", cause: "impact", lvMix: [0.8, 0.2, 0], place: { m: "walk" }, r: [0.15, 0.25] },
      { l: "dust", id: "puffs", dk: "hits", at: 0, lv: 1, r: 0.2, place: { m: "walk" }, life: 6000 }
    ]
  },
  {
    id: "heliHmg", v: 1, set: "military", name: "MOINENMAPS.DPreset.heliHmg", hint: "MOINENMAPS.DPreset.heliHmgHint", icon: "fa-solid fa-helicopter",
    gesture: "run", preroll: 1500, aftermath: null,
    walk: { rate: 9, speed: 8, dur: [0.6, 3], lanes: [-0.35, 0.35], phase: [0, 0.5], sigma: [0.3, 0.3], sway: { amp: 0.3, wave: 5 }, wobble: { amp: 0.1, wave: 2 },
      stray: { p: 0.1, k: 1.5 }, maxHits: 24 },
    layers: [
      { l: "accent", id: "tracers", kind: "tracer", at: 0, dur: 200, every: 4 },
      { l: "accent", id: "hits", kind: "hitFx", at: 0, dur: 300 },
      { l: "destruction", id: "lanes", at: 0, type: "cracks", cause: "impact", lvMix: [0.6, 0.4, 0], place: { m: "walk" }, lanes: "each", r: [0.2, 0.35] },
      { l: "destruction", id: "minis", at: 0, type: "blast", level: 2, cause: "impact", place: { m: "walk", pick: 0.05 }, lanes: "all", r: [0.25, 0.32] },
      { l: "dust", id: "geysers", dk: "hits", at: 0, lv: 3, r: 0.3, place: { m: "walk" }, life: 20000 }
    ]
  }
]);

export const builtinIds = () => BUILTIN.map((d) => d.id);
