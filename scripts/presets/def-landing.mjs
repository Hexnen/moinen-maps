/**
 * THE SUPERHERO LANDING (built-in preset, set "hero"; dev/presets-design.md section 18). A hero drops out of the sky onto the mark:
 * a streak of torn air comes down screen-down onto a tightening shadow (onto the token, when the click is on one: the token is the
 * hero), then the blow - a white pin, the air thrown out in a broken pale ring, a hard screen shake - a pressed impact crater, cracks
 * running out from it in a ragged star (a stroke per ray, opening from the centre out), and a wave of the ground's own dust rolling
 * out and hanging as a haze. No fire, no smoke, no sound, nothing pushes a token; nothing burns, so there is no aftermath fire
 * (the dust haze thins out by itself, as the blasts' do).
 */
export const LANDING = {
  id: "landing", v: 1, set: "hero", name: "MOINENMAPS.DPreset.landing", hint: "MOINENMAPS.DPreset.landingHint", icon: "fa-solid fa-person-falling-burst",
  gesture: "point", onToken: true, preroll: 1300, aftermath: null,
  layers: [
    { l: "accent", id: "fall", kind: "landing", at: -1300, dur: 1300 },
    { l: "accent", id: "air", kind: "airRing", at: 0, dur: 900, reach: 2.6 },
    { l: "cue", id: "screen", kind: "screen", at: 0, shake: 0.85, flash: 0 },
    { l: "destruction", id: "crater", at: 30, type: "blast", level: 3, cause: "impact", r: [0.62, 0.78], pr: { jagged: true, jag: 0.6 } },
    { l: "destruction", id: "cracks", at: 50, type: "cracks", cause: "impact", lvMix: [0, 0.6, 0.4],
      place: { m: "rays", n: [5, 7], d: [1.6, 3.0], from: 0.45, w: [0.32, 0.14], ms: [380, 560], fwd: 0.45, bend: 0.5 } },
    { l: "dust", id: "shock", dk: "shock", at: 20, lv: 2, r: 2.7, life: 245000 }
  ]
};
