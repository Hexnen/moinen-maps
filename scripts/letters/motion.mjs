/* LETR motion (MOTION2, SPEC-MOTION + SPEC-LOOK P16): the motion of a word in the "invincible" style comes from its SOUND, not from
   dice. Pure: no DOM, no Foundry, no PIXI. The legacy style "expressive" (= "comic") keeps its frozen stepped timeline (design.mjs
   buildTimeline); nothing here is read for it.

   1. The motion table. Every sound kind belongs to a family (sharp dry hits, heavy hits, ringing metal, breaks, booms, fly-bys, wind,
      electric, power, fire, steady hiss, water, engines, sirens, bursts in series, animal voices, human voices, small devices); a row
      says the entrance (how the sound starts), the hold (what lasts: an envelope over the hold), the exit (how it is cut off), how
      long it holds for the sound's duration, the rate its drawings change at, which letters move and the default travel. Plain text
      gets the row of its mood's typical kind. motionOf() is deterministic: the seed only varies small details (phases), never the row.
   2. The track. A word is ONE painted picture (the hold picture, shared by every drawing that looks the same: paint once, transform
      the sprite) moved by a pose (x, y, rotation, scale, squash, alpha, darkening) evaluated on every display frame from the row's
      keys and envelopes. Pictures are painted only where the drawing itself changes: an impact accent on the first tick, a smear
      multiple, the cracked word, letters that vibrate (stepped mode), the broken pieces of a shards / crumble exit.
   3. Two modes for the invincible style (the owner chooses on the A/B film; MOTION2-1):
        smooth   every channel is interpolated per display frame (SPEC-LOOK P16): eased entrance with a small overshoot, a hold that
                 is still or one slow eased motion (a decaying recoil, a slow pulse), an eased exit; no letter vibration.
        stepped  the drawn part (scale, squash, turn, the vibrating letters) changes on ONE shared grid (every word changes on the
                 same instants of performance.now(): SPEC-MOTION 4/5.1): the entrance on ones (contact on ones), hold and exit on twos;
                 translation and alpha stay smooth at the display rate; a smear multiple bridges the contact of a slam / burst-in.
      Entrances keep the scale ratio between neighbouring drawings at or under 1.4 (SPEC-MOTION 5.10) at 60 fps and on ones, except
      the contact tick a flash or smear picture covers.
      Default: smooth (MOTION2-1: the orchestrator's provisional ruling "invincible moves smoothly", and it paints the fewest pictures).

   Units: x, y in cap heights of the word (the engine multiplies by its px per unit), time in ms, angles in radians, dir = +1 / -1 (the
   word's reading direction of travel, plan.dir). */

export const MOTION_MODES = ["smooth", "stepped"];
export const DEFAULT_MOTION = "smooth";
const TICK = 1000 / 24;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, f) => a + (b - a) * f;

/* ---------- 1. the table ---------- */
/* the families: in, hold, out, hold length [ms at long 0, ms at long 1], drawing rate (ticks, stepped), letters that move, flash on
   contact allowed, travel (none | pass | drift | rise | sink) */
const F = (o) => ({ rate: 2, roles: "word", flash: false, travel: "none", ...o });
export const FAMILIES = {
  dry:      F({ label: "sharp dry hit", in: "slam", hold: "recoil", out: "cut", ms: [260, 450], flash: true, why: "instant attack, no body, instant cut-off" }),
  heavy:    F({ label: "heavy hit", in: "drop", hold: "rattle", out: "fall", ms: [420, 820], rate: 3, roles: "word", why: "weight in the attack, short low body, dull cut-off" }),
  ring:     F({ label: "ringing metal", in: "slam", hold: "ring", out: "ringOut", ms: [650, 1200], rate: 1, roles: "run", flash: true, why: "hard attack, long pure decaying body" }),
  break:    F({ label: "break", in: "crackIn", hold: "still", out: "shards", ms: [160, 320], why: "whole, then broken: the body is debris falling" }),
  boom:     F({ label: "boom", in: "burstIn", hold: "throb", out: "smokeOff", ms: [1000, 1600], rate: 3, roles: "vowel", flash: true, why: "loudest at the attack, long falling rumble, soft cut-off" }),
  flyby:    F({ label: "fly-by", in: "zip", hold: "pass", out: "zipout", ms: [260, 700], roles: "word", travel: "pass", why: "an arc contour: it rises, peaks as it passes, falls" }),
  wind:     F({ label: "wind, gust", in: "grow", hold: "sway", out: "blowAway", ms: [1200, 2000], roles: "wave", travel: "drift", why: "no attack, a swelling body, fades out" }),
  electric: F({ label: "electric", in: "pop", hold: "buzz", out: "flickerOut", ms: [320, 900], rate: 1, roles: "run", why: "instant attack, noisy body, abrupt stop" }),
  power:    F({ label: "power", in: "grow", hold: "climb", out: "rise", ms: [900, 1600], roles: "word", travel: "rise", why: "builds over the whole hold" }),
  fire:     F({ label: "fire", in: "ignite", hold: "flicker", out: "rise", ms: [1000, 2000], roles: "tops", travel: "rise", why: "soft attack, restless irregular body, dies upward" }),
  hiss:     F({ label: "steady hiss", in: "grow", hold: "shiver", out: "trailOff", ms: [900, 2200], rate: 1, roles: "run", travel: "drift", why: "no attack, a constant body, fades" }),
  water:    F({ label: "water", in: "pop", hold: "wobble", out: "runDown", ms: [420, 820], roles: "word", why: "soft attack, a sloshing decaying body" }),
  engine:   F({ label: "rumble, engine", in: "grow", hold: "rate", out: "powerDown", ms: [1000, 2200], roles: "run", why: "a swell: builds, holds a rate, winds down" }),
  siren:    F({ label: "siren, beep", in: "grow", hold: "pulse", out: "trailOff", ms: [1400, 2800], roles: "syllable", why: "a pulse contour, two pitches, no attack" }),
  series:   F({ label: "bursts in series", in: "pop", hold: "beat", out: "cut", ms: [380, 700], roles: "syllable", why: "every onset is its own attack" }),
  animal:   F({ label: "animal voice", in: "grow", hold: "growl", out: "shrink", ms: [1100, 2600], rate: 3, roles: "run", why: "a swell: the peak at the end, not at the start" }),
  voice:    F({ label: "human voice", in: "pop", hold: "wobble", out: "droop", ms: [520, 1300], roles: "vowel", why: "follows the breath: where the air is, the letters move" }),
  device:   F({ label: "small device, fail", in: "grow", hold: "bend", out: "trailOff", ms: [520, 1300], rate: 3, roles: "run", why: "slow, rough bodies; the cut-off is the point" })
};
/* every kind of the vocabulary: its family and what differs from the family row (period = the sound's own beat in ms) */
const K = (family, o = {}) => ({ family, ...o });
export const KIND_MOTION = {
  /* sharp dry hits */
  punch: K("dry"), slap: K("dry", { flash: false }), bite: K("dry"), hammer: K("dry", { hold: "beat", period: 420 }),
  pistol: K("dry"), rifle: K("dry", { ms: [320, 520] }), silenced: K("dry", { in: "pop", flash: false, ms: [200, 320] }), impact: K("dry"),
  click: K("dry", { in: "pop", flash: false, ms: [180, 300] }), reload: K("dry", { in: "pop", flash: false, hold: "beat", period: 260 }),
  casings: K("dry", { in: "drop", flash: false, hold: "beat", period: 180, ms: [300, 500] }), dryfire: K("dry", { in: "pop", flash: false, ms: [160, 260] }),
  slash: K("dry", { in: "zip", travel: "pass", why: "a cut: it crosses, then stops dead" }),
  /* heavy hits */
  smash: K("heavy", { in: "slam", flash: true }), thud: K("heavy"), stomp: K("heavy", { in: "slam" }),
  mech: K("heavy", { in: "slam", hold: "walk", period: 600, ms: [1200, 2400], why: "one stomp per step, alternating sides, advancing" }),
  debris: K("heavy", { ms: [300, 560] }),
  /* ringing metal */
  clang: K("ring"), sword: K("ring", { in: "zip" }), ricochet: K("ring", { in: "pop", out: "zipout", travel: "pass", flash: false }),
  chime: K("ring", { in: "pop", flash: false }),
  /* breaks */
  crack: K("break"), shatter: K("break", { ms: [220, 420] }),
  crash: K("break", { in: "drop", hold: "rattle", out: "fall", ms: [600, 1100], rate: 3, why: "the body is debris falling during the hold" }),
  crumble: K("break", { in: "drop", hold: "rattle", out: "crumble", ms: [600, 1100], rate: 3, roles: "word" }),
  /* booms */
  boom: K("boom"), grenade: K("boom"), concussion: K("boom"), shotgun: K("boom", { ms: [520, 900] }), blaster: K("boom", { ms: [420, 800], out: "trailOff" }),
  thunder: K("boom", { hold: "roll", ms: [1300, 2200], why: "rolling: weaker re-shakes at irregular gaps" }), sonicboom: K("boom", { out: "trailOff" }),
  whump: K("boom", { in: "swell", hold: "throb", out: "trailOff", flash: false, why: "grows from the centre, soft, no flash" }),
  shockwave: K("boom", { in: "swell", out: "trailOff", flash: false }),
  /* fly-bys */
  whoosh: K("flyby"), zoom: K("flyby"), arrow: K("flyby", { ms: [200, 420] }), whizz: K("flyby", { ms: [180, 380] }), thrown: K("flyby"),
  fastcar: K("flyby", { ms: [500, 1000] }), rocket: K("flyby", { ms: [500, 1000] }), plane: K("flyby", { ms: [1500, 2500], why: "a long pass" }),
  /* wind */
  wind: K("wind"), tornado: K("wind", { hold: "swirl" }), storm: K("wind", { hold: "roll" }),
  /* electric, power */
  zap: K("electric"), teleport: K("electric", { out: "cut", ms: [240, 420] }), laserpistol: K("electric", { in: "zip", hold: "still", out: "zipout", ms: [200, 380] }),
  beam: K("electric", { in: "stretch", out: "cut", ms: [600, 1400] }),
  powerup: K("power"), psychic: K("power", { hold: "pulse", period: 1600, out: "trailOff" }),
  /* fire */
  fire: K("fire"), crackle: K("fire", { in: "pop", hold: "crackle", out: "trailOff", ms: [500, 1100] }),
  /* steady hiss */
  hiss: K("hiss"), shush: K("hiss"), rain: K("hiss"), snakehiss: K("hiss", { hold: "snake" }),
  cathiss: K("hiss", { in: "pop", out: "cut", ms: [420, 800] }), purr: K("hiss", { hold: "purr", rate: 2 }),
  /* water */
  splash: K("water"), squish: K("water", { in: "squash" }), drip: K("water", { in: "drop", hold: "still", out: "fall", ms: [240, 420] }),
  bounce: K("water", { out: "rise" }),
  /* engines */
  rumble: K("engine", { period: 250, rate: 3 }), engine: K("engine", { period: 160 }), drill: K("engine", { period: 84, rate: 1 }),
  minigun: K("engine", { period: 84, rate: 1 }), helicopter: K("engine", { hold: "chop", period: 125, out: "trailOff" }),
  clunker: K("engine", { in: "falseStart", hold: "rate", period: 210, irregular: true }),
  /* sirens */
  siren: K("siren", { period: 900 }), police: K("siren", { period: 500 }), ambulance: K("siren", { period: 800 }), firetruck: K("siren", { period: 1400 }),
  beep: K("siren", { in: "pop", hold: "beat", period: 500, out: "cut", ms: [500, 1500] }),
  /* bursts in series */
  gunfire: K("series", { period: 110 }), laugh: K("series", { period: 260, irregular: true, ms: [600, 1300] }),
  heartbeat: K("series", { hold: "lubdub", period: 850, ms: [1100, 2200] }), bark: K("series", { period: 340, irregular: true }),
  squeak: K("series", { period: 300 }), hail: K("series", { in: "drop", period: 200 }),
  /* animal voices */
  snarl: K("animal"), roar: K("animal", { in: "roarIn", hold: "roarPeak", out: "trailOff" }), meow: K("animal", { in: "rise", hold: "arc", out: "droop", ms: [700, 1300] }),
  trumpet: K("animal", { in: "rise", hold: "climb", out: "trailOff" }),
  /* human voices */
  pain: K("voice"), effort: K("voice", { in: "squeeze", hold: "tremble", out: "release" }), relief: K("voice", { in: "dropSlow", hold: "deflate", out: "trailOff" }),
  sigh: K("voice", { in: "dropSlow", hold: "deflate", out: "trailOff", rate: 3, ms: [900, 1600] }), cheer: K("voice", { in: "rise", hold: "climb", out: "rise" }),
  /* small devices, fails */
  creak: K("device"), scrape: K("device", { in: "drag", hold: "shudder", travel: "drift" }), fizzle: K("device", { in: "sputterIn", hold: "sputter", out: "sputterOut" }),
  whiff: K("device", { in: "zip", hold: "pass", out: "zipout", travel: "pass", ms: [300, 600] })
};
/* plain text: the row of its mood's typical kind */
export const MOOD_KIND = { impact: "punch", crack: "crack", crash: "crash", boom: "boom", roar: "roar", fire: "fire", whoosh: "whoosh", zap: "zap",
  tick: "click", pain: "pain", powerup: "powerup", heal: "relief", splash: "splash", fail: "fizzle" };

/* the row for a sound. o = { kind, mood, sound, character, chars, accent, dir, mode, reduced, syllable, seed, opts }; the result is plain
   data stored on the plan (plan.motion) */
export function motionOf(o = {}) {
  const sound = o.sound ?? {}, c = o.character ?? {};
  const kindRow = o.kind && KIND_MOTION[o.kind] ? KIND_MOTION[o.kind] : null;
  let id = kindRow ? o.kind : MOOD_KIND[o.mood] ?? "punch";
  let row = kindRow ?? KIND_MOTION[id];
  /* the matter of an impact (KINDS1 material): water splashes, glass breaks, metal rings */
  if ( (id === "impact" || id === "punch") && c.material ) {
    const m = { water: "splash", glass: "shatter", metal: "clang", stone: "smash", earth: "thud" }[c.material];
    if ( m && o.kind === "impact" ) { id = m; row = KIND_MOTION[m]; }
  }
  /* plain text of the impact mood: a low, dull, loud hit is heavy */
  if ( !kindRow && o.mood === "impact" && (sound.pitch ?? 0) < -0.3 && (sound.sharp ?? 0.7) < 0.6 ) { id = "thud"; row = KIND_MOTION.thud; }
  const fam = FAMILIES[row.family];
  const m = { ...fam, ...row, kind: o.kind ?? null, rowOf: id, family: row.family };
  delete m.label;
  const long = clamp(Number.isFinite(sound.long) ? sound.long : 0.5, 0, 1), loud = clamp(Number.isFinite(sound.loud) ? sound.loud : 0.6, 0, 1);
  m.long = long; m.loud = loud;
  m.holdMs = Math.round(lerp(m.ms[0], m.ms[1], long));
  /* the impact accent on the first tick: only a loud sharp contact (and never under reduced motion) */
  m.flash = !!m.flash && loud > 0.6 && (m.family === "boom" || (sound.sharp ?? 0.5) > 0.55);
  /* a stream syllable / a sustain phrase: its own small entrance on its beat, a short body, a cut */
  if ( o.syllable ) {
    const steady = ["hiss", "wind", "power", "fire"].includes(m.family) || (c.contour === "steady");
    m.in = steady ? "grow" : m.family === "heavy" ? "drop" : "pop";
    m.hold = ["hiss", "wind", "fire", "engine"].includes(m.family) ? m.hold : "still";
    m.out = steady ? "trailOff" : "cut";
    m.flash = false; m.travel = "none"; m.syllable = true;
  }
  if ( o.reduced ) { m.in = "fade"; m.hold = "still"; m.out = "fade"; m.flash = false; m.travel = "none"; m.reduced = true; }
  /* a caller's named motion (ltok, echoes, older callers) still wins: legacy names map onto the track's own */
  const pin = o.pin ?? {};
  if ( !o.reduced ) {
    if ( pin.in ) m.in = IN_ALIAS[pin.in] ?? pin.in;
    if ( pin.holdKind ) m.hold = HOLD_ALIAS[pin.holdKind] ?? pin.holdKind;
    if ( pin.out ) m.out = OUT_ALIAS[pin.out] ?? pin.out;
  }
  m.ground = ["drop", "dropSlow", "squash"].includes(m.in) || m.hold === "deflate";
  m.mode = MOTION_MODES.includes(o.mode) ? o.mode : DEFAULT_MOTION;
  m.dir = o.dir < 0 ? -1 : 1;
  m.phase = ((Number(o.seed) || 0) % 6283) / 1000;
  m.run = roleLetters(o.chars ?? [], o.accent, m.roles);
  delete m.ms;
  return m;
}

/* the legacy motion names (design.mjs buildTimeline, ltok, echoes) -> the track's */
export const IN_ALIAS = { slam: "slam", pop: "pop", drop: "drop", grow: "grow", rise: "rise", crackIn: "crackIn", zip: "zip" };
export const HOLD_ALIAS = { shake: "rattle", rattle: "rattle", wobble: "wobble", throb: "throb", boil: "still", buzz: "buzz", flicker: "flicker" };
export const OUT_ALIAS = { shatter: "shards", shards: "shards", pop: "release", burst: "release", fall: "fall", droop: "droop", rise: "rise", dissolve: "trailOff", shrink: "shrink", zipout: "zipout" };
export const TRACK_IN = ["slam", "pop", "burstIn", "swell", "drop", "dropSlow", "squash", "grow", "roarIn", "rise", "ignite", "zip", "drag", "stretch", "crackIn", "falseStart", "squeeze", "sputterIn", "fade", "choreo"];
export const TRACK_HOLD = ["still", "recoil", "rattle", "ring", "throb", "roll", "pass", "sway", "swirl", "buzz", "climb", "flicker", "crackle", "shiver", "snake", "purr", "wobble", "rate", "chop", "pulse", "beat", "lubdub", "walk", "growl", "roarPeak", "arc", "deflate", "tremble", "bend", "shudder", "sputter"];
export const TRACK_OUT = ["cut", "ringOut", "trailOff", "smokeOff", "blowAway", "runDown", "powerDown", "sputterOut", "flickerOut", "fall", "droop", "rise", "shrink", "zipout", "release", "fade", "shards", "crumble"];

/* which letters move (SPEC-MOTION 3.4: only the sustained run vibrates in a hiss, a growl, an engine, a ring): the longest run of one
   repeated letter (RRRR, SSSS, OOO), else the peak's vowels, else the whole word. Returns character indices. */
export function roleLetters(chars, accent, roles = "word") {
  const n = chars.length, all = [], ink = (ch) => /[\p{L}\p{N}]/u.test(ch);
  for ( let i = 0; i < n; i++ ) if ( ink(chars[i]) ) all.push(i);
  if ( roles === "word" || roles === "wave" || roles === "tops" || roles === "syllable" ) return all;
  let best = null;
  for ( let i = 0; i < n; ) { let j = i; while ( j + 1 < n && chars[j + 1] === chars[i] ) j++; if ( ink(chars[i]) && j > i && (!best || j - i > best[1] - best[0]) ) best = [i, j]; i = j + 1; }
  if ( roles === "run" && best ) return range(best[0], best[1]);
  const V = /[AEIOUYĄĘÓ]/u;
  const pk = Array.isArray(accent) ? accent.map((a, i) => [a, i]).filter(([a, i]) => a >= 0.95 && V.test(chars[i])).map(([, i]) => i) : [];
  if ( pk.length ) return pk;
  if ( best ) return range(best[0], best[1]);
  const v = all.filter((i) => V.test(chars[i]));
  return v.length ? v : all;
}
const range = (a, b) => { const o = []; for ( let i = a; i <= b; i++ ) o.push(i); return o; };

/* L.sfx / L.word: the vocabulary's picks of in / hold / out are random among the kind's lists (words.mjs pickMotion). The invincible
   style replaces them with the table; the legacy style keeps them (vocabMotion), so its words stay what they were. */
export function playOpts(w) {
  const p = { ...(w?.play ?? {}) };
  const vm = { in: p.in, holdKind: p.holdKind, out: p.out };
  delete p.in; delete p.holdKind; delete p.out;
  if ( w?.kind ) p.kind = w.kind;
  if ( vm.in || vm.holdKind || vm.out ) p.vocabMotion = vm;
  return p;
}

/* ---------- 2. keys: entrances and exits as poses over time ----------
   a key: [ms, pose, ease] (ease = how the motion INTO this key runs: "out" fast then settle, "in" accelerating, "io", "lin");
   a pose: any of x, y, r, s, sx, sy, a (alpha), d (darkening 0..1); missing = rest (0 / 1). */
const REST = { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1, a: 1, d: 0 };
const EASE = { lin: (u) => u, out: (u) => 1 - (1 - u) ** 2, in: (u) => u * u, io: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) ** 2), out3: (u) => 1 - (1 - u) ** 3 };
/* the entrance keys (they end at rest); W = word width (units), H = height, dir, loud */
export function entranceKeys(m, W = 3, H = 1) {
  const d = m.dir, L = m.loud ?? 0.6;
  switch ( m.in ) {
    /* contact on the first frame: the word arrives big and fast and squashes on the surface; no wind-up showing the word */
    case "slam": { const s0 = 1.24 + 0.16 * L; return [[0, { s: s0, sx: 0.97, sy: 1.03 }], [62, { s: 0.94, sx: 1.12, sy: 0.88 }, "io"], [130, { s: 1.04, sx: 0.97, sy: 1.03 }, "io"], [220, {}, "io"]]; }
    /* a small word that pops open: it grows at once (never stands small), overshoots, settles */
    case "pop": return [[0, { s: 0.62 }], [90, { s: 1.14, sx: 0.95, sy: 1.06 }, "io"], [160, { s: 0.97, sx: 1.02, sy: 0.98 }, "io"], [240, {}, "io"]];
    /* a boom: the word expands from the centre (the flash, when allowed, is the first tick's picture) */
    case "burstIn": return [[0, { s: 0.55 }], [60, { s: 0.8 }, "lin"], [140, { s: 1.22 }, "io"], [230, { s: 0.96 }, "io"], [320, {}, "io"]];
    case "swell": return [[0, { s: 0.55, a: 0.35 }], [200, { s: 1.07, a: 1 }, "out"], [340, {}, "io"]];
    /* a real fall: from above, accelerating, squash on landing (the bottom stays planted), a small rebound */
    case "drop": return [[0, { y: -1.5, sy: 1.12, sx: 0.92 }], [170, { y: 0, sy: 0.76, sx: 1.2 }, "in"], [240, { y: -0.07, sy: 1.05, sx: 0.97 }, "out"], [330, {}, "io"]];
    case "dropSlow": return [[0, { y: -0.7, a: 0.2 }], [320, { y: 0.03, sy: 0.94, sx: 1.04, a: 1 }, "out"], [480, {}, "io"]];
    case "squash": return [[0, { s: 1.22, sy: 0.9 }], [60, { sx: 1.3, sy: 0.7 }, "in"], [170, { sx: 0.95, sy: 1.06 }, "out"], [280, {}, "io"]];
    /* soft: from small, leaning in from the upwind side */
    case "grow": return [[0, { s: 0.6, x: -0.35 * d, a: 0.15 }], [230, { s: 1.03, a: 1 }, "out"], [360, {}, "io"]];
    case "roarIn": return [[0, { s: 0.55, sx: 0.85, a: 0.3 }], [200, { s: 0.95, sx: 0.95, a: 1 }, "out"], [330, { s: 1.06, sx: 1.12, sy: 0.96 }, "out"], [470, {}, "io"]];
    case "rise": return [[0, { y: 0.8, s: 0.82, a: 0 }], [240, { y: -0.06, s: 1.02, a: 1 }, "out"], [360, {}, "io"]];
    case "ignite": return [[0, { s: 0.6, y: 0.35 }], [100, { s: 0.92, y: 0.25 }, "io"], [270, { y: -0.06, sy: 1.06 }, "out"], [390, {}, "io"]];
    /* a fly-by arrives along its direction, stretched, and the tail catches up */
    case "zip": return [[0, { x: -2.4 * d, sx: 1.5, sy: 0.84, a: 0.6 }], [130, { x: 0.14 * d, sx: 1.08, sy: 0.96, a: 1 }, "out"], [230, {}, "io"]];
    case "drag": return [[0, { x: -0.9 * d, sx: 1.08, a: 0.3 }], [420, { x: 0.03 * d, a: 1 }, "out"], [540, {}, "io"]];
    /* a beam stretches out from its muzzle side */
    case "stretch": return [[0, { sx: 0.4, x: -W * 0.3 * d }], [240, { sx: 1.05, x: 0.02 * d }, "io"], [320, {}, "io"]];
    /* a break: it lands whole; the cracked drawing takes over at the contact (pictures) */
    case "crackIn": return [[0, { s: 1.18 }], [55, { s: 0.95, sx: 1.06, sy: 0.95 }, "in"], [140, {}, "out"]];
    case "falseStart": return [[0, { s: 0.6 }], [70, { s: 0.75 }, "out"], [150, { s: 0.5, a: 0.5 }, "in"], [250, { s: 0.74, a: 1 }, "io"], [340, { s: 0.58, a: 0.6 }, "in"], [520, { s: 1.06 }, "io"], [620, {}, "io"]];
    case "squeeze": return [[0, { sx: 0.82, sy: 1.08, s: 0.85 }], [380, { sx: 0.96, sy: 1.02, s: 1 }, "io"], [460, {}, "io"]];
    case "sputterIn": return [[0, { s: 0.62 }], [100, { s: 1.1 }, "io"], [170, { s: 0.88, r: -0.05 * d }, "io"], [270, { s: 0.94, y: 0.04, r: -0.03 * d }, "io"]];
    case "fade": return [[0, { a: 0 }], [140, {}, "lin"]];
    case "choreo": return [[0, {}]];   // the entrance is drawn (parts, count-in): no transform on top
    default: return [[0, { s: 0.42 }], [70, { s: 1.12 }, "out"], [180, {}, "io"]];
  }
}
/* the exit keys (they start at rest; the word is gone at the last key) */
export function exitKeys(m) {
  const d = m.dir;
  switch ( m.out ) {
    case "cut": return [[0, {}], [42, { s: 0.92, a: 0.55 }, "lin"], [84, { s: 0.8, a: 0 }, "lin"]];
    case "ringOut": return [[0, {}], [420, { sx: 1.04, sy: 0.96, a: 0 }, "io"]];
    case "trailOff": return [[0, {}], [520, { x: 0.32 * d, sx: 1.05, sy: 0.88, a: 0 }, "io"]];
    /* a boom dies as smoke: it darkens and sags, then lifts and thins away (never a second explosion) */
    case "smokeOff": return [[0, {}], [260, { d: 0.45, y: 0.05, s: 0.99 }, "out"], [700, { d: 0.7, y: -0.4, s: 1.07, sy: 1.08, a: 0 }, "io"]];
    case "blowAway": return [[0, {}], [560, { x: 1.3 * d, r: 0.12 * d, sx: 1.12, sy: 0.9, a: 0 }, "in"]];
    case "runDown": return [[0, {}], [460, { y: 0.55, sy: 1.22, sx: 0.9, a: 0 }, "in"]];
    case "powerDown": return [[0, {}], [620, { s: 0.86, y: 0.12, r: 0.04 * d, d: 0.25, a: 0 }, "io"]];
    case "sputterOut": return [[0, {}], [70, { a: 0.25 }, "lin"], [130, { a: 0.9 }, "lin"], [210, { a: 0.15, y: 0.04 }, "lin"], [270, { a: 0.6, y: 0.06, r: 0.03 * d }, "lin"], [420, { a: 0, y: 0.16, r: 0.06 * d }, "in"]];
    case "flickerOut": return [[0, {}], [42, { a: 0.3 }, "lin"], [84, { a: 1 }, "lin"], [168, { a: 0.1, sx: 1.03 }, "lin"], [210, { a: 0 }, "lin"]];
    case "fall": return [[0, {}], [90, { y: -0.06, sy: 1.03 }, "out"], [480, { y: 1.3, r: 0.22 * d, a: 0 }, "in"]];
    case "droop": return [[0, {}], [520, { y: 0.32, r: 0.12 * d, sy: 0.9, a: 0 }, "io"]];
    case "rise": return [[0, {}], [600, { y: -0.75, sy: 1.06, sx: 0.96, a: 0 }, "out"]];
    case "shrink": return [[0, {}], [320, { s: 0.35, a: 0 }, "in"]];
    case "zipout": return [[0, {}], [70, { x: -0.12 * d, sx: 0.94 }, "out"], [230, { x: 3.2 * d, sx: 1.7, sy: 0.82, a: 0 }, "in"]];
    case "release": return [[0, {}], [70, { s: 1.08, sx: 1.06 }, "out"], [170, { s: 1.22, a: 0 }, "in"]];
    case "fade": return [[0, {}], [350, { a: 0 }, "lin"]];   // reduced motion: a plain fade, no motion (REQUESTS FXLT2-4)
    case "shards": case "crumble": return [[0, {}], [500, {}, "lin"]];   // drawn: the pieces are pictures
    default: return [[0, {}], [300, { a: 0 }, "io"]];
  }
}
export const keysEnd = (keys) => keys[keys.length - 1][0];
function sampleKeys(keys, t) {
  if ( t <= keys[0][0] ) return { ...REST, ...keys[0][1] };
  for ( let i = 1; i < keys.length; i++ ) {
    const [t1, p1, e] = keys[i];
    if ( t <= t1 ) {
      const [t0, p0] = keys[i - 1], u = (EASE[e] ?? EASE.io)((t - t0) / Math.max(1e-6, t1 - t0)), a = { ...REST, ...p0 }, b = { ...REST, ...p1 }, o = {};
      for ( const k of Object.keys(REST) ) o[k] = lerp(a[k], b[k], u);
      return o;
    }
  }
  return { ...REST, ...keys[keys.length - 1][1] };
}

/* ---------- the hold: an envelope over the hold (t ms since the hold began, H = its length) ---------- */
const decay = (t, tau) => Math.exp(-t / tau);
const kickAt = (t, period, pattern = [0], irregular = false, phase = 0) => {
  /* time since the last onset of a repeating pattern (fractions of the period); irregular = the gaps vary deterministically */
  const p = irregular ? period * (0.8 + 0.4 * ((Math.sin(phase * 7 + Math.floor(t / period) * 2.3) + 1) / 2)) : period;
  const k = Math.floor(t / p), r = t - k * p;
  let best = Infinity, j = -1;
  pattern.forEach((f, i) => { const dt = r - f * p; if ( dt >= 0 && dt < best ) { best = dt; j = i; } });
  return { dt: best === Infinity ? r : best, j, k };
};
export function holdPose(m, t, H) {
  const o = { ...REST }, d = m.dir, ph = m.phase ?? 0, u = H > 0 ? clamp(t / H, 0, 1) : 0, P = m.period ?? 600;
  switch ( m.hold ) {
    case "still": break;
    case "recoil": o.s = 1 + 0.07 * decay(t, 110) * Math.sin(TAU * t / 180); o.x = 0.05 * d * (1 - decay(t, 70)) * decay(t, 260); break;
    case "rattle": { const e = 0.06 * decay(t, 170); o.x = e * Math.sin(TAU * 8.5 * t / 1000 + ph); o.y = e * 0.7 * Math.sin(TAU * 6.5 * t / 1000 + ph * 2); o.r = e * 0.4 * Math.sin(TAU * 5 * t / 1000 + ph); break; }
    case "ring": { const e = decay(t, Math.max(200, H / 3)); o.x = 0.028 * e * Math.sin(TAU * 13 * t / 1000); o.sx = 1 - 0.015 * e; break; }
    /* a boom: the throb falls off over ~400 ms, then a slow low shudder stays for the rumble (SPEC-MOTION table; ADVM 8: no static hold) */
    case "throb": { const e = decay(t, 230), g = (1 - e) * (1 - 0.5 * u); o.s = 1 + 0.06 * e * Math.sin(TAU * t / 280) + 0.012 * g * Math.sin(TAU * t / 610 + ph); o.x = 0.02 * g * Math.sin(TAU * 5.5 * t / 1000 + ph); o.y = 0.014 * g * Math.sin(TAU * 4.1 * t / 1000 + 2 * ph) + 0.01 * (1 - e) * Math.sin(TAU * t / 760 + ph); break; }
    case "roll": { o.s = 1 + 0.05 * decay(t, 230) * Math.sin(TAU * t / 280); for ( const [f, a] of [[0.33, 0.6], [0.6, 0.38], [0.8, 0.22]] ) { const dt = t - f * H; if ( dt > 0 ) { const e = a * 0.05 * decay(dt, 130); o.x += e * Math.sin(TAU * dt / 95 + ph); o.y += e * 0.6 * Math.sin(TAU * dt / 120); } } break; }
    case "pass": o.x = 0.7 * d * u; o.s = 1 + 0.06 * Math.sin(Math.PI * u); break;
    case "sway": { const g = Math.sin(Math.PI * u); o.r = 0.05 * g * Math.sin(TAU * t / 1300 + ph) * d; o.x = 0.25 * d * u; o.sx = 1 + 0.03 * g; break; }
    case "swirl": { const a = TAU * t / 1500 + ph; o.x = 0.18 * Math.cos(a); o.y = 0.1 * Math.sin(a); o.r = 0.04 * Math.sin(a); break; }
    case "buzz": o.x = 0.016 * Math.sin(TAU * 17 * t / 1000) * (0.6 + 0.4 * Math.sin(TAU * 3.1 * t / 1000 + ph)); break;
    case "climb": { const e = EASE.io(u); o.s = 1 + 0.13 * e; o.y = -0.14 * e; break; }
    case "flicker": o.sy = 1 + 0.03 * Math.sin(TAU * t / 430 + ph) + 0.02 * Math.sin(TAU * t / 170 + 2 * ph); o.y = -0.06 * u; break;
    case "crackle": { const k = kickAt(t, 190, [0], true, ph); o.s = 1 + 0.05 * decay(k.dt, 50) * (k.k % 3 === 1 ? 0.3 : 1); break; }
    case "shiver": o.x = 0.08 * d * u; break;
    case "snake": o.x = 0.1 * d * u; o.y = 0.035 * Math.sin(TAU * t / 900 + ph); break;
    case "purr": o.s = 1 + 0.025 * Math.sin(TAU * t / 1500 + ph); break;
    case "wobble": { const e = decay(t, 260), w = Math.sin(TAU * t / 320); o.sy = 1 + 0.07 * e * w; o.sx = 1 - 0.05 * e * w; break; }
    case "rate": {
      const A = P >= 240 ? 0.035 : P >= 150 ? 0.025 : 0.014;
      o.y = A * Math.sin(TAU * t / P + ph); o.x = A * 0.4 * Math.sin(TAU * t / (P * 1.37));
      if ( m.irregular ) { const k = kickAt(t, P * 3.1, [0], true, ph); o.y += 0.05 * decay(k.dt, 70) * (k.k % 2 ? 1 : -0.6); }
      break;
    }
    case "chop": { const k = kickAt(t, P); o.y = -0.022 * decay(k.dt, 40) + 0.02 * Math.sin(TAU * t / 900 + ph); break; }
    case "pulse": { const w = Math.sin(TAU * t / P + ph); o.s = 1 + 0.06 * w; o.y = -0.05 * w; o.r = 0.015 * w * d; break; }
    case "beat": { const k = kickAt(t, P, [0], !!m.irregular, ph); o.s = 1 + 0.09 * decay(k.dt, 70); break; }
    case "lubdub": { const k = kickAt(t, P, [0, 0.28]); o.s = 1 + [0.06, 0.1][Math.max(0, k.j)] * decay(k.dt, 90); break; }
    case "walk": { const k = kickAt(t, P); const side = k.k % 2 ? 1 : -1; o.y = 0.05 * decay(k.dt, 90); o.x = d * 0.18 * (k.k + EASE.out(clamp(k.dt / 200, 0, 1))) * 0.6 + side * 0.04; o.r = side * 0.02; break; }
    case "growl": { const e = EASE.io(u); o.s = 1 + 0.11 * e; const a = 0.008 + 0.012 * e; o.x = a * Math.sin(TAU * 4.2 * t / 1000 + ph); o.y = a * Math.sin(TAU * 3.3 * t / 1000); break; }
    case "roarPeak": { const g = u < 0.7 ? EASE.io(u / 0.7) : 1 - 0.6 * EASE.io((u - 0.7) / 0.3); o.s = 1 + 0.09 * g; const a = 0.03 * g; o.x = a * Math.sin(TAU * 7 * t / 1000 + ph); o.y = a * 0.7 * Math.sin(TAU * 5.5 * t / 1000); break; }
    case "arc": o.y = -0.15 * Math.sin(Math.PI * u); o.s = 1 + 0.06 * Math.sin(Math.PI * u); break;
    case "deflate": o.sy = 1 - 0.1 * EASE.out(u); o.y = 0.08 * EASE.out(u); o.sx = 1 + 0.03 * u; break;
    case "tremble": o.x = (0.004 + 0.026 * u) * Math.sin(TAU * 16 * t / 1000 + ph); o.sx = 1 - 0.04 * u; o.sy = 1 + 0.03 * u; break;
    case "bend": o.r = 0.07 * d * EASE.io(u); o.sx = 1 - 0.02 * u; break;
    case "shudder": o.x = 0.12 * d * u + 0.012 * Math.sin(TAU * 11 * t / 1000 + ph); o.y = 0.008 * Math.sin(TAU * 9 * t / 1000); break;
    case "sputter": { const k = kickAt(t, 230, [0], true, ph); o.a = k.k % 3 === 2 && k.dt < 70 ? 0.25 : 1; o.y = 0.04 * u; break; }
    default: break;
  }
  return o;
}
/* how strong the hold's own motion still is at t (1 = full, 0 = settled): stepped mode stops cycling letter drawings below 0.25 */
export function holdEnergy(m, t, H) {
  const u = H > 0 ? clamp(t / H, 0, 1) : 0;
  switch ( m.hold ) {
    case "recoil": return decay(t, 110);
    case "rattle": return decay(t, 170);
    case "ring": return decay(t, Math.max(200, H / 3));
    case "throb": return 0.3 + 0.7 * decay(t, 230);
    case "wobble": return decay(t, 260);
    case "climb": case "growl": case "tremble": return u;
    case "still": case "pass": case "deflate": case "bend": case "arc": return 0;
    default: return 1;
  }
}

/* ---------- 3. the pose of a track word at age t ----------
   tr = plan.motion; ent = entrance length, hold = hold length, exitAt = when the exit began (ms of age; null = natural end);
   ctx = { W, H (the hold box, units) }. Stepped mode: the drawn channels (s, sx, sy, r) are read at the grid time tq. */
export function trackPose(tr, t, ent, hold, exitAt = null, ctx = {}, tq = t) {
  const pose = (tt) => {
    const xStart = exitAt ?? ent + hold;
    if ( tt < ent && tr.in !== "choreo" ) return sampleKeys(tr.entKeys, tt);
    if ( tt < xStart ) return holdPose(tr, tt - ent, hold);
    const h = tt - xStart, base = holdPose(tr, Math.max(0, xStart - ent), hold), x = sampleKeys(tr.exitKeys, h);
    /* the exit runs from where the hold was (its motion fades out over the first 120 ms of the exit) */
    const f = clamp(1 - h / 120, 0, 1);
    return { x: x.x + base.x * f, y: x.y + base.y * f, r: x.r + base.r * f, s: x.s * (1 + (base.s - 1) * f), sx: x.sx * (1 + (base.sx - 1) * f), sy: x.sy * (1 + (base.sy - 1) * f), a: x.a * (1 + (base.a - 1) * f), d: x.d };
  };
  let p = pose(t);
  if ( tr.mode === "stepped" && tq !== t ) { const q = pose(tq); p = { ...p, s: q.s, sx: q.sx, sy: q.sy, r: q.r }; }
  const k = Number.isFinite(tr.damp) ? tr.damp : 1;
  if ( k !== 1 ) { p.x *= k; p.y *= k; p.r *= k; p.s = 1 + (p.s - 1) * k; p.sx = 1 + (p.sx - 1) * k; p.sy = 1 + (p.sy - 1) * k; }
  /* a squash keeps the bottom planted (landing, a sigh): shift down by half of the height it lost */
  if ( tr.ground && ctx.H ) p.y += (1 - p.s * p.sy) * ctx.H * 0.5;
  return p;
}
/* the reach of a track's poses around the word's rest box (units): how far its entrance moves and how big it gets (ADVT 1 / FXLD2-4:
   the first entrance frame inside the view) */
export function trackReach(tr, W = 3, H = 1) {
  let l = 0, r = 0, u = 0, d = 0, s = 1;
  for ( const [, p] of tr.entKeys ) {
    const q = { ...REST, ...p }, k = Math.min(1.6, q.s * Math.max(q.sx, q.sy));
    s = Math.max(s, k);
    l = Math.max(l, -q.x); r = Math.max(r, q.x); u = Math.max(u, -q.y); d = Math.max(d, q.y);
  }
  return { l: W / 2 * s + Math.min(1.6, l), r: W / 2 * s + Math.min(1.6, r), u: H / 2 * s + Math.min(1.6, u), d: H / 2 * s + Math.min(1.6, d) };
}
/* the global drawing grid (stepped mode): every word's drawn channels change on the same instants of the page clock */
export const gridQ = (on = 2) => Math.max(1, Math.round(on)) * TICK;
export function gridAge(t0, age, q) {
  const off = ((t0 % q) + q) % q;
  return Math.floor((age + off) / q) * q - off;
}
export const gridCeil = (t, q) => Math.ceil(t / q) * q;

/* ---------- 4. the per-letter drawings of stepped mode (the letters that move: run, vowels, tops, a wave) ----------
   n drawings, each a letters[] of offsets for the plan's letters; [] = no letter drawings (the hold picture alone) */
export function letterDrawings(m, n, chars) {
  if ( m.mode !== "stepped" || m.reduced || m.syllable ) return [];
  const run = new Set(m.run ?? []);
  const mk = (f) => { const out = []; for ( let i = 0; i < n; i++ ) out.push(run.has(i) ? { v: 1, x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1, ...f(i) } : { v: 1, x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 }); return out; };
  const hz = (i, k) => Math.sin(i * 12.9898 + k * 78.233 + (m.phase ?? 0) * 3) * 43758.5453 % 1;
  switch ( m.hold ) {
    case "ring": case "buzz": case "shiver": case "tremble":
      return [0, 1].map((k) => mk((i) => ({ x: (k ? 1 : -1) * 0.022 * (i % 2 ? 1 : -1), y: (k ? -1 : 1) * 0.014 })));
    case "rate": case "growl": case "rattle": case "roarPeak":
      return [0, 1, 2].map((k) => mk((i) => ({ x: 0.03 * hz(i, k), y: 0.035 * hz(i + 7, k), r: 0.05 * hz(i + 3, k) })));
    case "sway":
      return [0, 1, 2, 3].map((k) => mk((i) => ({ y: 0.06 * Math.sin(TAU * (k / 4 - i / 6)), r: 0.05 * Math.cos(TAU * (k / 4 - i / 6)) * m.dir })));
    case "flicker": case "crackle":
      return [0, 1, 2, 3].map((k) => mk((i) => { const v = Math.abs(hz(i, k)); return { sy: 1 + 0.08 * v, y: -0.04 * v }; }));
    case "wobble": case "throb":
      return [0, 1, 2].map((k) => mk((i) => ({ r: 0.05 * Math.sin(k * 2.1 + i), y: 0.03 * Math.cos(k * 2.1 + i) })));
    default: return [];
  }
}
