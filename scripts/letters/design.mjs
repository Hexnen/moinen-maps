/* LETR: from (word, intent) to a plan. Pure and deterministic for a given seed: no DOM, no Foundry.
   The plan says which "hand" letters the word (font, letter treatment, outline, fill, texture, 3D), how the word is laid out and
   warped, and the timeline of pictures (entrance, hold, exit) on a 24 fps clock. paint.mjs turns one picture of a plan into pixels.

   Intent -> shape follows the craft notes in README.md ("How the shape shows the sound"): size = loudness, the loudest part of the
   word is the biggest, jagged = sharp/harsh, round = soft/blunt, long sounds stretch and repeat letters, rising pitch climbs, falling
   pitch sags, the word grows away from where the sound comes from, warm colours for fire, cool for air and water. */
import { rng, hash } from "./rng.mjs";
import { characterOf } from "./words.mjs";
import { onOf, retime } from "./move.mjs";
import { groupsOf, letterScales, choreoEntrance, countFrames } from "./choreo.mjs";
import { motionOf, entranceKeys, exitKeys, keysEnd, letterDrawings, contactKey } from "./motion.mjs";

export const TICK = 1000 / 24;

/* ---------- fonts: ids, files, character ---------- */
export const FONTS = {
  bangers:  { file: "fonts/bangers/Bangers-Regular.ttf", weight: 0.75, sharp: 0.7, track: -0.02, slant: 0 },
  anton:    { file: "fonts/anton/Anton-Regular.ttf", weight: 0.8, sharp: 0.85, track: 0.02, slant: 0.12 },
  titan:    { file: "fonts/titanone/TitanOne-Regular.ttf", weight: 1, sharp: 0.1, track: -0.06, slant: 0.08 },
  bungee:   { file: "fonts/bungee/Bungee-Regular.ttf", weight: 0.9, sharp: 0.55, track: -0.04, slant: 0.1 },
  blackops: { file: "fonts/blackopsone/BlackOpsOne-Regular.ttf", weight: 0.9, sharp: 0.95, track: -0.03, slant: 0.1 },
  sigmar:   { file: "fonts/sigmar/Sigmar-Regular.ttf", weight: 1, sharp: 0.35, track: -0.07, slant: 0.06 },
  knewave:  { file: "fonts/knewave/Knewave-Regular.ttf", weight: 0.8, sharp: 0.5, track: -0.05, slant: 0 },
  wetpaint: { file: "fonts/rubikwetpaint/RubikWetPaint-Regular.ttf", weight: 0.85, sharp: 0.3, track: -0.04, slant: 0.06 },
  patrick:  { file: "fonts/patrickhand/PatrickHand-Regular.ttf", weight: 0.25, sharp: 0.05, track: 0.02, slant: 0.06 },
  /* LOOK: the squared, engineered capitals of the Invincible book's lettering (style "invincible"; no mood picks them otherwise) */
  squada:   { file: "fonts/squadaone/SquadaOne-Regular.ttf", weight: 0.8, sharp: 0.9, track: 0.01, slant: 0, recut: "MN" },   // its M/N look lower case: rebuilt (fontbank recut)
  michroma: { file: "fonts/michroma/Michroma-Regular.ttf", weight: 0.6, sharp: 0.6, track: -0.02, slant: 0 }
};
/* a font without a glyph falls back along this chain, letter by letter (Polish letters are synthesised first where possible) */
export const FALLBACK = ["bangers", "anton"];

/* ---------- moods: the intent vocabulary ----------
   sound: loud 0..1 (size, weight), sharp 0..1 (jagged vs round), long 0..1 (duration, stretch), pitch -1..1 (falling..rising),
   rough 0..1 (grit), peak 0..1 (where the loudest part of the word is), plus colour family, textures, entrances, holds, exits. */
export const MOODS = {
  impact: { label: "hit, punch, slam", sound: { loud: 0.85, sharp: 0.75, long: 0.15, pitch: 0, rough: 0.3, peak: 0.15 },
    fonts: { bangers: 3, sigmar: 2, blackops: 1.5, anton: 1.5, titan: 1, bungee: 1 }, treat: { plain: 4, jag: 1.2, rough: 1 },
    env: { bulge: 2, fan: 2, slant: 2, arc: 1.5, persp: 1.5 }, colors: { hot: 3, primary: 3, punch: 2, pop: 2 },
    tex: { halftone: 2, none: 2, speckle: 0.6, speed: 0.4, brush: 0.8, burstlines: 1 }, in: { slam: 3, pop: 2 }, hold: { shake: 2, boil: 2 }, out: { shatter: 2, pop: 2 }, back: { none: 3, star: 2.5, plate: 1.2, oval: 0.4 }, hold_ms: 900, fx: { burst: 0.7 } },
  crack: { label: "breaking, snapping, cracking", sound: { loud: 0.7, sharp: 1, long: 0.1, pitch: 0, rough: 0.6, peak: 0.05 },
    fonts: { blackops: 2, bangers: 2, anton: 2, bungee: 1 }, treat: { jag: 4, plain: 1 },
    env: { split: 3, slant: 2, persp: 1, fan: 1 }, colors: { ice: 2, bone: 2, punch: 1, stone: 2 },
    tex: { cracks: 4, none: 0.5, burstlines: 1.2 }, in: { crackIn: 3, slam: 1 }, hold: { shake: 2, boil: 1 }, out: { shatter: 4 }, back: { none: 3, star: 2, plate: 1.5 }, hold_ms: 800, fx: { burst: 0.4 } },
  crash: { label: "collapse, rubble, crash", sound: { loud: 0.9, sharp: 0.5, long: 0.6, pitch: -0.6, rough: 0.8, peak: 0.3 },
    fonts: { anton: 2, bungee: 2, blackops: 2, bangers: 1.5, sigmar: 1 }, treat: { rough: 3, jag: 1.5, plain: 1 },
    env: { tumble: 3, stairDown: 2, persp: 1 }, colors: { stone: 3, earth: 3, rust: 2 },
    tex: { speckle: 3, cracks: 1.5, halftone: 1, brush: 1.5 }, in: { drop: 4, slam: 1 }, hold: { rattle: 3, shake: 1 }, out: { fall: 4 }, back: { none: 3, cloud: 2.2, plate: 1 }, hold_ms: 1100, fx: { dust: 0.8 } },
  boom: { label: "explosion, blast", sound: { loud: 1, sharp: 0.4, long: 0.5, pitch: 0, rough: 0.4, peak: 0.5 },
    fonts: { titan: 3, sigmar: 3, bangers: 2, bungee: 1 }, treat: { plain: 3, bubble: 2, rough: 1 },
    env: { fan: 3, bulge: 3, arc: 1 }, colors: { hot: 5, ember: 1.5 },
    tex: { halftone: 2, none: 1.5, speckle: 1, burstlines: 1.5, spots: 0.6 }, in: { slam: 3, pop: 1 }, hold: { throb: 2, shake: 2 }, out: { burst: 3, shatter: 1 }, back: { none: 2.2, cloud: 3, star: 2.5 }, hold_ms: 1000, fx: { burst: 1 } },
  roar: { label: "roar, growl, scream of a beast", sound: { loud: 0.85, sharp: 0.55, long: 0.9, pitch: 0.2, rough: 0.8, peak: 0.9 },
    fonts: { knewave: 3, bangers: 2, anton: 1, blackops: 1 }, treat: { jag: 2.5, rough: 2.5 },
    env: { swell: 4, fan: 1, wave: 1 }, colors: { beast: 3, punch: 1, toxic: 2 },
    tex: { speckle: 2, none: 1, halftone: 1, brush: 1.2, spots: 1 }, in: { grow: 4 }, hold: { rattle: 2, shake: 2 }, out: { shrink: 2, shatter: 1 }, back: { none: 3.5, star: 1, plate: 1 }, hold_ms: 1400, fx: {} },
  fire: { label: "flames, burning, whoosh of fire", sound: { loud: 0.55, sharp: 0.35, long: 0.8, pitch: 0.6, rough: 0.5, peak: 0.6 },
    fonts: { knewave: 2.5, bangers: 2, sigmar: 1.5, titan: 1 }, treat: { plain: 4, rough: 0.6 },
    env: { wave: 3, arc: 2, swell: 1 }, colors: { hot: 4, ember: 3 },
    tex: { none: 2, speckle: 1, brush: 0.8 }, in: { rise: 4, pop: 1 }, hold: { flicker: 5 }, out: { rise: 4 }, back: { none: 4, cloud: 1 }, hold_ms: 1400, fx: { embers: 0.8 } },
  whoosh: { label: "fast motion, wind, swing", sound: { loud: 0.5, sharp: 0.2, long: 0.8, pitch: 0, rough: 0.2, peak: 0.85 },
    fonts: { bangers: 3, knewave: 2, anton: 1.5, sigmar: 1 }, treat: { plain: 3, rough: 1 },
    env: { streak: 4, swell: 1.5, shrink: 1.5 }, colors: { air: 4, pop: 1, ice: 1 },
    tex: { speed: 4, none: 1 }, in: { zip: 5 }, hold: { boil: 3 }, out: { zipout: 5 }, back: { none: 4.5, oval: 1, plate: 0.6 }, hold_ms: 800, fx: { speed: 1 } },
  zap: { label: "electricity, energy blast, laser", sound: { loud: 0.65, sharp: 1, long: 0.35, pitch: 0.3, rough: 0.3, peak: 0.5 },
    fonts: { blackops: 2, bangers: 2, bungee: 2, anton: 1 }, treat: { jag: 4, plain: 1 },
    env: { zig: 4, slant: 1 }, colors: { volt: 4, plasma: 3 },
    tex: { none: 2, halftone: 1, burstlines: 1 }, in: { pop: 3, slam: 1 }, hold: { buzz: 5 }, out: { dissolve: 3, pop: 1 }, back: { none: 3, star: 2.5 }, hold_ms: 900, fx: { sparks: 1 } },
  tick: { label: "small sound: click, tap, beep", sound: { loud: 0.12, sharp: 0.6, long: 0, pitch: 0, rough: 0, peak: 0.5 },
    fonts: { bangers: 2, patrick: 2, bungee: 1, titan: 1 }, treat: { plain: 3, bubble: 1 },
    env: { slant: 3, flat: 2 }, colors: { soft: 3, pop: 1 },
    tex: { none: 4, spots: 0.5 }, in: { pop: 4 }, hold: { boil: 3 }, out: { dissolve: 3, pop: 1 }, back: { none: 3, oval: 2 }, hold_ms: 500, fx: {} },
  pain: { label: "hurt, wound, cry of pain", sound: { loud: 0.65, sharp: 0.6, long: 0.45, pitch: -0.5, rough: 0.6, peak: 0.25 },
    fonts: { knewave: 2.5, bangers: 2, anton: 1.5, blackops: 1 }, treat: { plain: 2.5, jag: 1.5, rough: 1.5 },
    env: { sag: 3, wave: 1.5, tumble: 1 }, colors: { blood: 4, bruise: 2 },
    tex: { speckle: 1.5, none: 2, brush: 1.5 }, in: { slam: 2, pop: 2 }, hold: { wobble: 3, shake: 1 }, out: { fall: 3, droop: 2 }, back: { none: 3, star: 1.2, plate: 1.2 }, hold_ms: 1000, fx: {} },
  powerup: { label: "charging, rising power, transformation", sound: { loud: 0.75, sharp: 0.3, long: 0.8, pitch: 1, rough: 0.2, peak: 1 },
    fonts: { sigmar: 2, titan: 2, bungee: 2, bangers: 2 }, treat: { plain: 3, bubble: 1.5 },
    env: { stairUp: 3, swell: 2, arc: 1.5 }, colors: { plasma: 3, gold: 3, volt: 1 },
    tex: { halftone: 2, rays: 2, none: 1, burstlines: 1.5 }, in: { rise: 2, grow: 3 }, hold: { throb: 4 }, out: { rise: 4 }, back: { none: 3, star: 2, oval: 1 }, hold_ms: 1300, fx: { rays: 0.6 } },
  heal: { label: "healing, relief, soft glow", sound: { loud: 0.3, sharp: 0, long: 0.55, pitch: 0.5, rough: 0, peak: 0.5 },
    fonts: { titan: 3, patrick: 3, sigmar: 1 }, treat: { bubble: 4, plain: 1 },
    env: { arc: 3, wave: 2 }, colors: { mint: 4, gold: 1 },
    tex: { none: 3, halftone: 1, spots: 0.5 }, in: { rise: 3, pop: 2 }, hold: { throb: 2, boil: 2 }, out: { rise: 3, dissolve: 2 }, back: { none: 3, oval: 2, cloud: 1 }, hold_ms: 1100, fx: {} },
  splash: { label: "water, splash, goo, squelch", sound: { loud: 0.55, sharp: 0.15, long: 0.4, pitch: -0.2, rough: 0.2, peak: 0.4 },
    fonts: { titan: 3, sigmar: 1.5, patrick: 1.5, bungee: 0.5 }, treat: { plain: 3, bubble: 2 },
    env: { wave: 3, bulge: 2, fan: 1 }, colors: { water: 4, toxic: 1 },
    tex: { none: 2, halftone: 1, spots: 1.5 }, in: { pop: 3, slam: 1 }, hold: { wobble: 2, boil: 2 }, out: { fall: 3, dissolve: 1 }, back: { none: 3, cloud: 2 }, hold_ms: 1000, fx: { droplets: 0.8 } },
  fail: { label: "miss, flop, deflating", sound: { loud: 0.25, sharp: 0.1, long: 0.45, pitch: -1, rough: 0.2, peak: 0 },
    fonts: { patrick: 3, titan: 2, bangers: 1 }, treat: { bubble: 3, rough: 1.5, plain: 1 },
    env: { sag: 3, stairDown: 2, shrink: 2 }, colors: { dull: 4 },
    tex: { none: 3, speckle: 1, spots: 0.8 }, in: { drop: 2, pop: 2 }, hold: { wobble: 3 }, out: { droop: 3, fall: 2 }, back: { none: 3.5, oval: 1.5, cloud: 0.6 }, hold_ms: 900, fx: {} }
};
export const MOOD_IDS = Object.keys(MOODS);

/* ---------- colour families: [light, mid, dark] fills, extrusion, outline-2 options, ink ---------- */
const C = (fill, ext, out2, ink = "#1b1020") => ({ fill, ext, out2, ink });
/* LOOK: the Invincible book's sound effects: pale flat or two-tone faces, a thin black keyline, a solid block extrusion in one deep
   colour (teal under bone and lime, brown under amber, navy under the suit's yellow) */
/* LOOK2 (SPEC-LOOK P11): flat saturated faces, each with ONE dark duplicate colour (the shadow copy behind the word); the three
   fill stops are the same colour (a flat face). Picked by the sound's character (invPalette), never at random. */
const F3 = (c) => [c, c, c];
const INV = {
  yellow:  C(F3("#ffd31a"), "#b8211b", ["#ffffff"], "#141414"),   // explosions, muzzle flashes
  orange:  C(F3("#ff8a1f"), "#5c170b", ["#ffffff"], "#141414"),   // fire, heat
  red:     C(F3("#ec2a2b"), "#3b0710", ["#ffffff"], "#141414"),   // voice, pain, beasts
  white:   C(F3("#fbfaf3"), "#d0262a", ["#ffffff"], "#141414"),   // blows (red and white)
  steel:   C(F3("#dbe5ee"), "#22344d", ["#ffffff"], "#141414"),   // metal, cuts, machines
  cyan:    C(F3("#41d3ff"), "#0b2e6c", ["#ffffff"], "#141414"),   // electricity, energy
  blue:    C(F3("#2f8bff"), "#0a1e4d", ["#ffffff"], "#141414"),   // water, cold
  air:     C(F3("#eef8ff"), "#2363c8", ["#ffffff"], "#141414"),   // wind, fast motion
  green:   C(F3("#8edb36"), "#18440e", ["#ffffff"], "#141414"),   // healing, relief, slime
  violet:  C(F3("#b36dff"), "#2b0c5a", ["#ffffff"], "#141414"),   // power, mind
  stone:   C(F3("#e7d5b2"), "#5a391b", ["#ffffff"], "#141414")    // rock, timber, rubble
};
/* the character -> colour table (SPEC-LOOK P11: explosions yellow/orange, blows red/white, cuts and metal white/steel, electricity
   cyan/yellow, water blue, voice/pain red). Pure rules over the WORD character (words.mjs characterOf) and the mood. */
export function invPalette(mood, c, T) {
  const mat = c.material ?? "";
  if ( T.wet || mat === "water" ) return "blue";
  if ( T.electric || c.electric >= 0.6 ) return c.heat >= 0.5 ? "yellow" : "cyan";
  if ( c.heat >= 0.8 ) return mood === "boom" ? "yellow" : "orange";
  if ( mood === "boom" || (c.metal >= 0.5 && c.heat >= 0.3 && ["impact", "crack", "boom"].includes(mood)) ) return "yellow";   // blasts, gunfire
  if ( T.cold ) return mat === "air" ? "air" : "blue";
  if ( c.heat >= 0.5 ) return "orange";
  if ( mood === "heal" && mat !== "metal" ) return "green";
  if ( ["energy", "mind"].includes(mat) || mood === "powerup" ) return "violet";
  if ( mat === "voice" || mat === "animal" || mood === "pain" || mood === "roar" ) return "red";
  if ( mat === "metal" || mat === "machine" || mat === "glass" ) return "steel";
  if ( mat === "stone" || mat === "wood" ) return "stone";
  if ( mat === "air" ) return "air";
  if ( mat === "rubber" || mood === "fail" ) return "green";
  return "white";
}
export const COLORS = {
  inv:     Object.values(INV),
  hot:     [C(["#fff7b0", "#ffc928", "#f2561d"], "#7a1d10", ["#ffffff", "#1b1020"]), C(["#ffe45c", "#ff8a1a", "#d61f1f"], "#5e130d", ["#fff3c4"]), C(["#fffbe0", "#ffd84a", "#ff7a00"], "#9b2a12", ["#c8102e"])],
  ember:   [C(["#ffe9a0", "#ff9b2a", "#b8231a"], "#3d0d0a", ["#2a0c0a"]), C(["#fff2c0", "#ff6a2a", "#7a1430"], "#2b0a14", ["#ffd25c"])],
  primary: [C(["#ff5a4e", "#e01d24", "#a3101a"], "#3e0710", ["#ffe14a", "#ffffff"]), C(["#5ec8ff", "#1f6fe0", "#173a9c"], "#0d1a4a", ["#ffe14a", "#ffffff"]), C(["#fff27a", "#ffd21a", "#f29a00"], "#8a3d00", ["#e01d24", "#1f6fe0"])],
  punch:   [C(["#ffffff", "#f5f0ff", "#c9c2e8"], "#2a2350", ["#e8322b", "#1f6fe0"]), C(["#ff8ad1", "#ff2e93", "#b0005f"], "#3c0024", ["#ffffff", "#ffe14a"])],
  pop:     [C(["#9df27a", "#3fc23a", "#17802a"], "#0b3311", ["#fff27a", "#ffffff"]), C(["#ffb3f0", "#c56bff", "#6b2fd6"], "#24104e", ["#ffffff", "#7cf0ff"]), C(["#7cf6ff", "#24c0e8", "#1172b8"], "#0a2848", ["#ffffff", "#ff4fa0"])],
  ice:     [C(["#ffffff", "#c9f1ff", "#6cc4ef"], "#123e66", ["#1b1020", "#ffffff"]), C(["#f2fdff", "#8fe3ff", "#2b8fd8"], "#0f2c55", ["#ffffff"])],
  bone:    [C(["#fffdf2", "#efe4c4", "#c4a979"], "#4a3420", ["#ffffff", "#e8322b"])],
  stone:   [C(["#e9e6df", "#a9a39a", "#625d58"], "#2a2622", ["#ffffff", "#e6b34a"]), C(["#d8dbe2", "#8a93a6", "#4b5266"], "#20232e", ["#ffd25c"])],
  earth:   [C(["#f3d39a", "#c98a3c", "#7a4a1c"], "#3a2210", ["#fff0c8", "#1b1020"]), C(["#e8c890", "#a8743a", "#5e3a1a"], "#2a180a", ["#ffffff"])],
  rust:    [C(["#ffc48a", "#d8622a", "#7e2a12"], "#331208", ["#fff0c8"])],
  toxic:   [C(["#f4ff8a", "#a6f03a", "#3c9a1c"], "#13350a", ["#5b1a7a", "#ffffff"])],
  beast:   [C(["#c6f27a", "#6fbf3a", "#2f6e1f"], "#12300c", ["#ffffff", "#f2e14a"]), C(["#d79bff", "#8a3fd6", "#4a1a8a"], "#1d0a3a", ["#ffffff", "#ffd21a"]), C(["#ff8a5e", "#d8342a", "#6e0f18"], "#2a0508", ["#fff2a0", "#ffffff"])],
  air:     [C(["#ffffff", "#bfeeff", "#5fb8f0"], "#173a6a", ["#1b1020"]), C(["#f0fbff", "#a8e8f0", "#3fa8c8"], "#0d3344", ["#ffffff"]), C(["#ffffff", "#e0e6ff", "#8f9cf0"], "#232a66", ["#ffffff"])],
  volt:    [C(["#ffffff", "#fff35c", "#ffc400"], "#3a2a00", ["#1fb8ff", "#1b1020"]), C(["#ffffff", "#9ff6ff", "#1fb8ff"], "#06305a", ["#fff35c"])],
  plasma:  [C(["#ffe6ff", "#ff6ad5", "#8a2be2"], "#2a0a4a", ["#ffffff", "#7cf0ff"]), C(["#e0fbff", "#7cf0ff", "#3a5cff"], "#0c1450", ["#ffffff", "#ff6ad5"])],
  gold:    [C(["#fffbe0", "#ffd84a", "#c88a10"], "#4a2a00", ["#ffffff", "#8a2be2"])],
  soft:    [C(["#ffffff", "#f0f0f6", "#c8c8d8"], "#3a3a50", ["#1b1020"]), C(["#fffbe6", "#ffe9a8", "#e8c36a"], "#4a3a10", ["#ffffff"])],
  blood:   [C(["#ff6a6a", "#d8141f", "#7a0612"], "#2a0206", ["#ffffff", "#ffd8d8"]), C(["#ffd0d0", "#ff3a4a", "#9a0a1e"], "#3a0610", ["#ffffff"])],
  bruise:  [C(["#e4b8ff", "#9a4ad8", "#4e1a7a"], "#1e0a34", ["#ffffff", "#ff3a6a"])],
  mint:    [C(["#f0fff4", "#8ff2b8", "#2fbf7a"], "#0c3a22", ["#ffffff", "#1b1020"]), C(["#ffffff", "#c8ffd8", "#5fd89a"], "#124a2a", ["#ffe98a"])],
  water:   [C(["#e8fbff", "#5fd0ff", "#1a6fd0"], "#082a5a", ["#ffffff", "#1b1020"]), C(["#ffffff", "#8fe8f0", "#1aa0b8"], "#063440", ["#ffffff"])],
  dull:    [C(["#e6e4ee", "#a8a6b8", "#6e6c80"], "#2a2838", ["#ffffff"]), C(["#e8ecf2", "#9aa8b8", "#5a6878"], "#222a36", ["#ffffff"])]
};

/* ---------- the "auto" mood: sound symbolism of the word itself (my own reading, see README) ---------- */
export function guessMood(word) {
  const w = word.toUpperCase().replace(/[^A-ZĄĆĘŁŃÓŚŹŻ0-9!?+-]/g, "");
  const has = (re) => re.test(w);
  if ( /^[+-]?\d+$/.test(w.replace(/!/g, "")) ) return w.startsWith("+") ? "heal" : (w.startsWith("-") ? "pain" : "impact");
  if ( has(/(SPLA|SPLO|PLUS|CHLUP|CHLUS|PLOP|SPLU|SQU|GLUB|BLUB)/) ) return "splash";
  if ( has(/(FWOO|FOOM|FWUM|WHUMF|FFF|FRR|TRZASK.*OGN|BUCH)/) ) return "fire";
  if ( has(/(BZZ|ZZZ|ZAP|ZZT|BZT|KZZ|FZZ|ZIP|ZING|BZYK)/) ) return "zap";
  if ( has(/(KRA|CRA|KRK|TRZA|CRK|SNAP|KRZ|CHRUP|TRACH)/) ) return "crack";
  if ( has(/(RRR|GRR|ROAR|WRR|ARR|RAA)/) ) return "roar";
  if ( has(/(ARGH|AUA|AU!|OUCH|OW!|AJ|ŁAA|UGH|ACK)/) ) return "pain";
  if ( has(/(BOOM|BUM|BOOO|KABOO|BAM|BLAM|KAB|BUUM|DUUM)/) ) return "boom";
  if ( has(/(WHOO|WOOSH|SWOO|SWISH|WSZ|SZU|FIU|ZIUU|WHIS|SWI|WHI|SSS)/) ) return "whoosh";
  if ( has(/(CRASH|CRUNCH|ŁUBUDU|RUMBL|ŁOMOT|TRZASK|KRUSZ|SMASH)/) ) return "crash";
  if ( has(/(CLICK|KLIK|TIK|TAK|TIC|PYK|PIK|BEEP|BIP|TAP|PUK|DING|PING)/) ) return "tick";
  if ( has(/(WHIFF|PFF|OOPS|UPS|MEH|NOPE|FLOP|PSST|FIZZ)/) ) return "fail";
  if ( has(/(VRR|WUMM|HUMM|ZOOM|VROO|WRUM|ŁAŁ|SHING)/) ) return "powerup";
  return "impact";
}

/* the word's own sound shifts the mood's sound: repeated letters = long, "!" = loud, K/T/P/CR = sharp, B/M/O/U = round */
export function soundOf(word, mood, over = null) {
  const s = { ...MOODS[mood].sound };
  const w = word.toUpperCase();
  const rep = (w.match(/(.)\1+/g) ?? []).reduce((a, r) => a + r.length - 1, 0);
  s.long = Math.min(1, s.long + rep * 0.06);
  if ( /!/.test(w) ) s.loud = Math.min(1, s.loud + 0.08);
  const sharpL = (w.match(/[KTPCZŚĆ]/g) ?? []).length, roundL = (w.match(/[BMOUW]/g) ?? []).length;
  s.sharp = Math.max(0, Math.min(1, s.sharp + (sharpL - roundL) * 0.03));
  if ( over ) for ( const k of ["loud", "sharp", "long", "pitch", "rough", "peak"] ) if ( Number.isFinite(over[k]) ) s[k] = over[k];
  s.loud = clamp01(s.loud); s.sharp = clamp01(s.sharp); s.long = clamp01(s.long); s.rough = clamp01(s.rough); s.peak = clamp01(s.peak ?? 0.5);
  s.pitch = Math.max(-1, Math.min(1, s.pitch ?? 0));
  return s;
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/* a custom sound without a mood picks the nearest mood for the vocabulary of shapes, colours and motion */
export function nearestMood(sound) {
  let best = "impact", bd = Infinity;
  for ( const [id, m] of Object.entries(MOODS) ) {
    const a = m.sound;
    const d = (a.loud - (sound.loud ?? a.loud)) ** 2 + (a.sharp - (sound.sharp ?? a.sharp)) ** 2 + (a.long - (sound.long ?? a.long)) ** 2
      + 0.5 * (a.pitch - (sound.pitch ?? a.pitch)) ** 2 + 0.5 * (a.rough - (sound.rough ?? a.rough)) ** 2;
    if ( d < bd ) { bd = d; best = id; }
  }
  return best;
}

/* ---------- the hand: every visual decision of one lettering ---------- */
export function chooseHand(mood, sound, R, avoid, R2 = null) {
  const M = MOODS[mood];
  const av = avoid ?? { font: new Set(), env: new Set(), color: new Set(), treat: new Set() };
  const font = R.w(M.fonts, av.font);
  const F = FONTS[font];
  let treat = R.w(M.treat, av.treat.size >= 2 ? av.treat : null);
  if ( font === "patrick" ) treat = "bubble";                       // a thin hand font only reads as SFX when inflated
  if ( font === "wetpaint" && treat === "drip" ) treat = R.chance(0.5) ? "plain" : "drip";   // it drips by itself
  const env = R.w(M.env, av.env);
  const colorFam = R.w(M.colors, av.color.size < Object.keys(M.colors).length ? av.color : null);
  const pal = R.pick(COLORS[colorFam]);
  const tex = R.w(M.tex);
  /* outline scheme: ink only, ink + light sticker outline (the refs' white cut edge), ink + coloured outline, light inner line */
  /* LOOK (user, 2026-11-13): a word is set off more often by its duplicated block (depth) than by a light outline */
  const outline = R.w({ ink: 4, sticker: 1.2, color: pal.out2.some((c) => c !== "#ffffff") ? 1 : 0.3, inner: 1.5 });
  const fill = R.w({ vgrad: 4, split: 1.5, hgrad: 1.5, letters: sound.long > 0.6 ? 2.5 : 1, radial: mood === "boom" ? 3 : 0.8, flat: 0.6, multi: 1.6, hollow: mood === "tick" || mood === "whoosh" ? 1.2 : 0.6, alt: sound.long > 0.6 ? 1.2 : 0.7 });
  const stack = R.w({ stack: F.sharp > 0.6 ? 2 : 3, merge: 2 });
  const depthOn = R.chance(0.6 + 0.35 * sound.loud);
  const loud = sound.loud;
  const hand = {
    font, treat, env, colorFam, tex, outline, fill, stack,
    pal: { ...pal, fill: pal.fill.slice(), out2: R.pick(pal.out2) },
    ink: pal.ink,
    inkW: (0.045 + 0.035 * loud) * (font === "patrick" ? 0.9 : 1) * (sound.loud < 0.2 ? 1.25 : 1),
    out2W: outline === "ink" ? 0 : R.f(0.05, 0.085),
    inflate: treat === "bubble" ? (font === "patrick" ? R.f(0.075, 0.1) : R.f(0.025, 0.05)) : 0,
    depth: depthOn ? R.f(0.08, 0.1 + 0.16 * loud) : 0,
    depthAng: R.pick([Math.PI * 0.3, Math.PI * 0.25, Math.PI * 0.7, Math.PI * 0.6, Math.PI * 0.35]) + (sound.pitch > 0.5 ? -Math.PI * 0.5 : 0) * (R.chance(0.4) ? 1 : 0),
    shadow: R.chance(0.85) ? { d: R.f(0.07, 0.16), ang: R.f(0.2, 0.45) * Math.PI, a: R.f(0.3, 0.5) } : null,
    gloss: R.chance(fill === "flat" ? 0.7 : 0.35),
    shadowStyle: R.w({ flat: 3, dots: 2 }),
    hatch: depthOn && R.chance(0.3),
    bevel: R.chance(0.35),
    shear: (F.slant + R.f(-0.06, 0.16)) * (mood === "whoosh" ? 2.2 : 1),
    track: Math.max(-0.07, F.track + R.f(-0.04, 0.02) - 0.03 * sound.loud),
    hueJitter: R.f(-14, 14)
  };
  if ( R2 ) lookHand(hand, mood, sound, R2);
  if ( mood === "tick" ) { hand.depth = 0; hand.shadow = hand.shadow && { ...hand.shadow, d: 0.06 }; hand.out2W = Math.min(hand.out2W, 0.05); }
  hand.id = [font, treat, env, colorFam, outline, fill].join("/");
  return hand;
}

/* ---------- LOOK: styles: a whole lettering tradition over the hand (opts.look.style, or the engine's default) ----------
   "comic" (the default): the hands as chosen. "invincible": the Invincible comic's own lettering (the primary look reference):
   squared engineered capitals, upright and even (no wobble, no edge treatment, no texture), a thin black keyline, pale flat or
   two-tone faces, a deep solid block extrusion in one dark colour, a small lead-in before a big body, round letters of a run drawn as
   interlocked rings. Decided on its own generator so the comic hand of a seed stays what it was. opts.look still wins over it. */
/* LOOK2 (SPEC-LOOK P17, the owner's ruling): "expressive" is the legacy look from before the Invincible pass, frozen: it is the
   "comic" hand byte for byte (makePlan maps it there; nothing below this line may change what a comic plan draws). */
export const STYLES = ["comic", "invincible", "expressive"];
const RINGS = new Set(["O", "0"]);
const CASELIKE = /[COSUVWXZĆÓŚŹŻ]/u;   // capitals whose lower case is the same shape, smaller
export const RING_W = 0.94;   // a ring's width in cap heights (a circle a little under the cap height wide)
/* LOOK3 (the owner, 2026-11-14: «litery muszą być trochę rozjechane w pionie. Pierwsze do góry drugie w dół», «Trzecie znowu do
   góry»): interlocked O's of the invincible hand stand off their line by `rise` of their own size, the first up, the second down,
   a third up again (a stagger round the baseline: the pair's middle stays on the line). `three` = share of seeds whose run of three
   O interlocks (the owner: rarely, «20 procent», 2026-11-14); `most` = the longest run that interlocks (four and more never). Digits (a number's 00) stay
   level: a number is even. */
export const LINK = { rise: 0.07, three: 0.2, most: 3 };
/* ---------- LOOK: the look says the sound (the user: «napisy pasowały wyglądem do dźwięków które opisują») ----------
   One deliberate mapping from the sound's CHARACTER to the lettering. The character is WORD's (words.mjs characterOf: hard, heavy, wet,
   metal, electric, heat, material, texture, contour per kind; L.word(...).play.character carries it); plain text gets its mood's. The
   plan's own sound (sharp, rough, pitch, long: the caller's overrides and the word's stretch) wins over the kind's base values.
   traitsOf() names the traits; styleHand (invincible) builds the hand from them; fitSound corrects a comic hand that contradicts them.
   Pure rules, no random draws: the same sound always gets the same traits. check-look.mjs L16 checks the table over every kind. */
const COLD = new Set(["ice", "air", "mint", "water"]);
const WARM = new Set(["hot", "ember", "gold", "rust", "blood"]);
const NEON_COLD = new Set(["ice", "air", "mint", "water", "toxic", "volt", "plasma", "pop", "soft"]);
export function characterFor(mood, sound, given = null) {
  const c = given && typeof given === "object" ? { ...characterOf({ mood }), ...given } : characterOf({ mood, loud: sound.loud, long: sound.long });
  if ( !given ) Object.assign(c, { sharp: sound.sharp, rough: sound.rough, pitch: sound.pitch, sustain: sound.long });
  return c;
}
export function traitsOf(mood, sound, character = null) {
  const c = character ?? characterFor(mood, sound);
  const loud = sound.loud;
  return {
    hard: c.hard >= 0.7 && loud >= 0.45,                                   // a blow, a crack: the squared heavy face, cut flat, a deep block
    soft: c.hard <= 0.3,                                                   // a whump, a sigh, a splash: the wide round face, light, no spikes
    heavy: c.heavy >= 0.85,                                                // a falling wall, a blast: a deep block straight down
    light: c.pitch >= 0.5 && c.heavy <= 0.5,                               // high and slight: a shallow block thrown up
    metallic: c.metal >= 0.6,                                              // a clang, a gun, a chime: steel, cut clean
    electric: c.electric >= 0.9 || (c.electric >= 0.6 && ["jagged", "shaky", "gritty"].includes(c.texture)),   // sparks
    hot: c.heat >= 0.8, warm: c.heat >= 0.5, cold: c.heat <= -0.3,         // flames / only warm colours / a cold colour fits
    earthy: ["stone", "wood"].includes(c.material) && c.heat > -0.3,      // rock and timber: stone and bone colours, never ice or neon
    wet: c.wet >= 0.7,                                                     // drips
    gritty: c.texture === "gritty" && c.rough >= 0.5,                      // crumbling, grinding: a rough edge
    sputter: mood === "fail",                                              // a fizzle: sags, sputters
    bubbly: c.texture === "bubbly",                                        // bounces: a wavy line
    sustained: c.sustain >= 0.7, short: c.sustain <= 0.25,                 // spacing: tight for a hit, loose for what lasts
    rising: c.contour === "rise", arc: c.contour === "arc",                // the line: grows to its end / flies by in an arc
    fading: c.contour === "fall" && c.sustain >= 0.5 && c.hard <= 0.4      // dies away: shrinks
  };
}
/* the comic hands: change only what contradicts the sound (no new random draws: a seed keeps everything else) */
export function fitSound(hand, T, sound, avoid = null) {
  /* a swapped font keeps the recent-hands memory: the first fitting face the words on screen do not use */
  const used = avoid?.font ?? new Set();
  const swap = (list) => list.find((f) => !used.has(f)) ?? list[0];
  if ( T.hard ) {
    if ( hand.treat === "bubble" ) hand.treat = "plain";
    if ( ["titan", "patrick", "sigmar"].includes(hand.font) ) hand.font = swap(sound.long < 0.4 ? ["anton", "blackops", "bangers"] : ["bangers", "anton", "bungee"]);
  }
  if ( T.soft ) {
    if ( hand.treat === "jag" ) hand.treat = "plain";
    if ( ["blackops", "anton"].includes(hand.font) ) hand.font = swap(["titan", "sigmar", "patrick"]);
  }
  if ( T.sputter ) { if ( ["swell", "stairUp", "arc", "fan", "bulge"].includes(hand.env) ) hand.env = "sag"; if ( hand.treat === "plain" ) hand.treat = "rough"; }
  if ( !T.wet && hand.treat === "drip" ) hand.treat = "plain";
  const setFam = (fam, i = 0) => { const pal = COLORS[fam][i]; hand.colorFam = fam; hand.pal = { ...pal, fill: pal.fill.slice(), out2: pal.out2[0] }; hand.ink = pal.ink; };
  if ( T.metallic ) {
    if ( ["bubble", "drip"].includes(hand.treat) || hand.treat === "rough" && !T.gritty ) hand.treat = "plain";   // grinding metal keeps its grit
    if ( !T.warm && !["ice", "stone"].includes(hand.colorFam) ) setFam("stone", 1);
  }
  /* colour by matter (advm 10: a lime fireball, an ice-blue stone crack): a warm sound only in fire colours, rock never in ice or neon */
  if ( T.warm && !WARM.has(hand.colorFam) ) setFam(T.hot ? "ember" : "hot");
  if ( (T.warm || T.earthy) && hand.multi === "sweep" ) hand.multi = "sunset";   // a hue sweep runs a fireball into lime (advm 10)
  if ( T.earthy && NEON_COLD.has(hand.colorFam) ) setFam(COLORS.stone ? "stone" : "bone");
  if ( T.wet && !["water", "ice", "toxic"].includes(hand.colorFam) ) setFam("water");   // wet in water colours (toxic: slime)
  if ( T.heavy ) hand.depth = Math.max(hand.depth, 0.12);
  if ( T.light && hand.depth > 0.09 ) hand.depth = 0.09;
  hand.id = [hand.font, hand.treat, hand.env, hand.colorFam, hand.outline, hand.fill].join("/");
  return hand;
}
export function styleHand(hand, style, mood, sound, word, seed, T = traitsOf(mood, sound), character = null) {
  if ( style !== "invincible" ) return hand;
  const ch = character ?? characterFor(mood, sound);
  const R3 = rng((seed ^ 0x1bad5eed) >>> 0);
  /* LOOK2 (SPEC-LOOK P1): ONE tall narrow capital face for the whole style (Anton); the sound is said by size, colour, the duplicate,
     spacing and the line, never by swapping to a wide or rounded face (Michroma and Squada One only on look.font) */
  hand.font = "anton";
  /* LOOK2 (P11): a flat saturated face with one dark duplicate colour, from the sound's character (no random draw) */
  const fam = invPalette(mood, ch, T);
  const pal = INV[fam];
  hand.colorFam = "inv"; hand.invPal = fam;
  hand.pal = { ...pal, fill: pal.fill.slice(), out2: "#ffffff" }; hand.ink = pal.ink;
  /* clean letters, as in the book (the user: flame teeth and drips removed, 2026-11-13): the matter is said by face, colour, block
     and line, never by an edge ornament; look.treat ("flame", "drip", "jag", "rough") stays an explicit opt-in */
  hand.treat = "plain";
  hand.tex = "none"; hand.outline = "ink"; hand.out2W = 0; hand.inflate = 0;
  /* LOOK2 (P2, P3): one thin keyline round the whole word (paint.mjs "union"): outside the word's outline and as a hairline inside
     each letter where another letter overlaps it; never stroked across a neighbour */
  hand.keyline = "union"; hand.inkW = 0.016; hand.join = "line";
  /* LOOK2 (P5): flat faces always; (P6) an open letter for high, slight and airy sounds: white face, a rim in the word's colour */
  hand.fill = T.light || (ch.material === "air" && !T.heavy && sound.loud < 0.75) ? "hollow" : "flat";
  hand.hollowPaper = "#ffffff"; hand.rimW = 0.05;
  /* LOOK2 (P4): ONE flat copy of the letters behind them (the duplicate), down-right; a deep swept block only for heavy sounds,
     straight down, flat (no gradient, no soft shadow); a high sound's duplicate is thrown up */
  hand.block = T.heavy ? "heavy" : "dup";
  hand.depth = T.heavy ? 0.12 + 0.04 * sound.loud : T.light ? 0.07 : 0.07 + 0.025 * sound.loud;
  hand.depthAng = Math.PI * (T.light ? -0.25 : T.heavy ? 0.5 : 0.25);
  hand.shadow = null; hand.shadowStyle = "flat";
  hand.gloss = false; hand.hatch = false; hand.bevel = false; hand.hueJitter = 0;
  hand.shear = 0;
  /* LOOK2 (P18): spacing is optical, pair by pair (shape.mjs kernOptical): the advance-based track is only the first guess;
     short = tight, sustained = a little looser (the sound has room) */
  hand.track = 0;
  hand.kern = { gap: T.short ? 0.04 : T.sustained ? 0.06 : 0.05 };
  hand.stack = "stack"; hand.order = "left";
  hand.tiltKind = "calm"; hand.tilt = 0; hand.bob = 0; hand.upright = true;
  /* loud = a big contrast between the body and its lead-in */
  hand.contrast = 1.2 + 0.6 * sound.loud;
  /* LOOK2 (P7): every hyphen lead-in is a small prefix (about a third of the body), set on the body's top line; a loud body gets an
     open (hollow) prefix against its solid face */
  hand.prefix = 0.32 + 0.06 * Math.min(1, sound.loud);
  hand.hollowPre = hand.fill !== "hollow" && sound.loud >= 0.75;
  /* LOOK2 (P8): a straight baseline: rising = grows to its end, fading or a fizzle = shrinks away, everything else flat */
  hand.env = T.rising ? "swell" : T.fading || T.sputter ? "shrink" : "flat";
  hand.warp2 = null; hand.profile2 = null;
  hand.counters = "none"; hand.capFont = null; hand.multi = "sweep";
  hand.link = true;
  /* LOOK3 (the owner, 2026-11-14: «3 litery powinny być rzadko splecione. A cztery i więcej nigdy»): two O interlock; a run of three
     only rarely (LINK.three of the seeds, decided on this hand's own generator); four or more never */
  hand.link3 = R3.chance(LINK.three);
  hand.backPick = mood === "boom" || mood === "fire" ? "cloud" : mood === "impact" || mood === "crack" ? "star" : "plate";
  hand.style = "invincible";
  hand.id = [hand.font, hand.treat, hand.env, hand.colorFam, hand.outline, hand.fill].join("/");
  return hand;
}

/* ---------- LOOK: the lettering craft of the reference sheets, decided on a second generator (R2) so the older decisions of a seed
   stay where they were ----------
   tilt and baseline bounce, a small prefix before a huge body, a second envelope, letters tucked under the one to their left, a cast
   shadow, counters, inner treatments, a drop-cap font, and the (opt-in) backdrop shape. */
export const BACKDROPS = ["star", "cloud", "oval", "plate"];
export const FILLS = ["vgrad", "split", "hgrad", "letters", "radial", "flat", "multi", "hollow", "alt"];
export const TEXTURES = ["none", "halftone", "speckle", "cracks", "speed", "rays", "brush", "burstlines", "spots"];
const WARP2 = { arc: 2, persp: 2, bulge: 1, fan: 1 };
const SIZE_ENVS = new Set(["swell", "shrink", "streak", "stairUp", "stairDown", "tumble", "split", "slant", "flat", "zig"]);
export function lookHand(hand, mood, sound, R2) {
  const M = MOODS[mood];
  const calm = mood === "tick" || mood === "heal" || mood === "powerup";
  const harsh = ["roar", "crash", "impact", "boom", "pain", "crack"].includes(mood);
  /* tilt: calm 4-7 deg, lively 10-15, wild 16-24 (the reference sheets: 15-30 deg with a bouncing baseline); a letter that stops reading leans less (shape.mjs) */
  hand.tiltKind = R2.w({ calm: calm ? 3 : 1.2, lively: 3, wild: harsh ? 3 : calm ? 0.4 : 1.6 });
  hand.tilt = { calm: R2.f(4, 7), lively: R2.f(10, 15), wild: R2.f(16, 24) }[hand.tiltKind];
  hand.bob = { calm: 0.02, lively: R2.f(0.04, 0.07), wild: R2.f(0.07, 0.12) }[hand.tiltKind];
  /* size contrast between the loud and the quiet part, and a small prefix before a huge body (KA-BOOM, RAKA-BOOM) */
  hand.contrast = R2.f(1.1, 1.7);
  hand.prefix = R2.chance(0.35 + 0.35 * sound.loud) ? R2.f(0.28, 0.46) : 0;
  /* overlap: each letter tucked under the one to its left (the letterer's rule), or the later letter on top */
  const ov = R2.w({ none: 2, some: 2.5, heavy: hand.tiltKind === "wild" ? 0 : harsh ? 1.5 : 0.6 });   // wild leans and deep tucks together hide letters
  hand.track = Math.max(-0.16, hand.track - { none: 0, some: R2.f(0.02, 0.05), heavy: R2.f(0.06, 0.1) }[ov]);
  if ( ov === "heavy" ) hand.stack = "stack";
  hand.order = R2.chance(0.75) ? "left" : "right";
  /* a second envelope: a size profile under a warp (arc + swell) or a warp over a size profile (perspective + arc) */
  hand.warp2 = SIZE_ENVS.has(hand.env) ? (R2.chance(0.55) ? R2.w(WARP2) : null) : (R2.chance(0.4) && hand.env !== "persp" ? "persp" : null);
  hand.profile2 = !SIZE_ENVS.has(hand.env) && R2.chance(0.4) ? R2.w({ swell: sound.peak > 0.5 ? 3 : 1, shrink: sound.peak < 0.5 ? 2 : 0.5 }) : null;
  /* a long cast shadow, separate from the letters (refs about 0.2-0.35 cap height), sometimes swept as a solid long shadow */
  if ( hand.shadow && R2.chance(0.55) ) { hand.shadow.d = R2.f(0.2, 0.34); hand.shadow.cast = true; hand.shadow.long = R2.chance(0.3); hand.shadow.a = R2.f(0.3, 0.45); }
  /* counters: solid black or coloured holes (BOOM's O's) */
  hand.counters = R2.w({ none: 3, ink: harsh ? 1.8 : 1, color: 0.8 });
  hand.counterCol = R2.pick([hand.pal.ext, hand.pal.fill[2], hand.pal.out2 === "#ffffff" ? hand.pal.fill[2] : hand.pal.out2]);
  /* a drop cap in another font of the mood (deliberate per-letter fonts) */
  const others = Object.entries(M.fonts).filter(([k, w]) => w > 0 && k !== hand.font && k !== "patrick");
  hand.capFont = others.length && R2.chance(0.12) ? R2.w(Object.fromEntries(others)) : null;
  /* fills: the multi-stop variant, the hollow rim, and the per-letter colours */
  hand.multi = R2.w({ sunset: 2, sweep: 1.5 });
  hand.rimW = R2.f(0.07, 0.11);
  hand.alt = [hand.pal.fill[1], recolor(hand.pal.fill[1], R2.pick([120, 180, 240]), 0), hand.pal.out2 !== "#ffffff" && hand.pal.out2 !== "#1b1020" ? hand.pal.out2 : recolor(hand.pal.fill[1], 60, 5)];
  hand.brushAng = R2.f(-1.25, -0.85);
  /* the backdrop is opt-in (the lettering is an add-on to the scene): its kind is only decided here, makePlan keeps it off unless asked */
  hand.backPick = R2.w(M.back ?? { star: 1 }, null);
  if ( hand.backPick === "none" ) { const b = { ...(M.back ?? {}) }; delete b.none; hand.backPick = Object.keys(b).length ? R2.w(b) : "star"; }
  hand.backSeed = R2.seed();
  /* a run of round letters (BOOM, WHOOOOM) drawn as interlocked rings, one through the other, of alternating size */
  hand.link = R2.chance(0.45) && hand.out2W < 0.04;   // a thick sticker outline would cut the crossing: those hands set O's side by side
  return hand;
}
/* a hex colour turned round the hue wheel (dh degrees) and lightened (dl), as a hex string again */
export function recolor(hex, dh, dl = 0) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex).trim());
  if ( !m ) return hex;
  let r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let l = (mx + mn) / 2, h = 0, s = 0;
  if ( mx !== mn ) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60; }
  h = (((h + dh) % 360) + 360) % 360; l = Math.max(0, Math.min(1, l + dl / 100));
  const f = (n) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/* ---------- LOOK: accent, how loud each letter of the word is ----------
   The big letters are where the sound peaks, the lead-in is small, a fading tail shrinks (GRRrr, BUMmm). A caller (the vocabulary,
   WORD) may say it exactly: opts.accent = one number 0..1 per character of the text (or a string of digits 0-9, one per character),
   or { peak: [from, to], lead, tail } (character indices of the upper-cased text; lead / tail = how many letters fade in / out).
   Plain text without it gets a guess: the word's syllables, the peak on the syllable with the longest vowel (WHOOOM, BUUUM), after a
   hyphen (KA-BOOM), else on the first syllable of a two-syllable word and the one before last of a longer one (ŁU-BU-DU); the
   letters before it grow into it, the letters after it fade, a run of one repeated letter at the end fades letter by letter. */
const VOWEL = /[AEIOUYĄĘÓ]/u;
export function accentOf(chars, given = null) {
  const n = chars.length, w = new Array(n).fill(0.6);
  const ink = (c) => /[\p{L}\p{N}]/u.test(c);
  /* the caller's accent */
  if ( given != null ) {
    const arr = typeof given === "string" ? [...given].map((c) => (/\d/.test(c) ? Number(c) / 9 : NaN)) : Array.isArray(given) ? given.map(Number) : null;
    if ( arr && arr.length === n && arr.every(Number.isFinite) ) return arr.map((v) => Math.max(0, Math.min(1, v)));
    if ( given && typeof given === "object" && !Array.isArray(given) && Array.isArray(given.peak) ) {
      const [a, b] = given.peak.map((v) => Math.max(0, Math.min(n - 1, Math.round(Number(v) || 0))));
      return shapeAround(chars, Math.min(a, b), Math.max(a, b), given.lead, given.tail);
    }
  }
  /* the guess, word by word (a space or a line break starts a new word: each has its own peak) */
  let from = 0;
  for ( let i = 0; i <= n; i++ ) {
    if ( i < n && chars[i] !== " " && chars[i] !== "\n" ) continue;
    if ( i > from ) { const part = guess(chars.slice(from, i)); for ( let k = 0; k < part.length; k++ ) w[from + k] = part[k]; }
    from = i + 1;
  }
  for ( let i = 0; i < n; i++ ) if ( !ink(chars[i]) && chars[i] !== "!" && chars[i] !== "?" ) w[i] = Math.min(w[i], 0.5);
  return w;
}
function guess(cs) {
  const n = cs.length;
  /* syllables: onset consonants + a vowel run; trailing consonants belong to the last one */
  const syl = []; let cur = null;
  for ( let i = 0; i < n; i++ ) {
    const c = cs[i], v = VOWEL.test(c);
    if ( !cur ) cur = { from: i, v0: -1, v1: -1 };
    if ( v ) { if ( cur.v0 >= 0 && cur.v1 < i - 1 ) { syl.push(cur); cur = { from: i, v0: -1, v1: -1 }; } if ( cur.v0 < 0 ) cur.v0 = i; cur.v1 = i; }
    else if ( cur.v0 >= 0 && i + 1 < n && VOWEL.test(cs[i + 1]) && /\p{L}/u.test(c) ) { syl.push(cur); cur = { from: i, v0: -1, v1: -1 }; }
    else if ( c === "-" && cur.v0 >= 0 ) { syl.push(cur); cur = { from: i + 1, v0: -1, v1: -1, hy: true }; }
  }
  if ( cur ) syl.push(cur);
  for ( let k = 0; k < syl.length; k++ ) syl[k].to = k + 1 < syl.length ? syl[k + 1].from - 1 : n - 1;
  const voiced = syl.filter((s) => s.v0 >= 0);
  if ( !voiced.length ) {   // no vowel (GRRR, BZZZT, SSSS, HMM): the first letters carry it, a run fades
    return shapeAround(cs, 0, Math.min(n - 1, 0), 0, null);
  }
  const len = (s) => s.v1 - s.v0 + 1, maxLen = Math.max(...voiced.map(len));
  let pk;
  if ( maxLen > 1 && voiced.filter((s) => len(s) === maxLen).length === 1 ) pk = voiced.find((s) => len(s) === maxLen);
  else if ( voiced.some((s) => s.hy) ) pk = voiced.filter((s) => s.hy).at(-1);
  else pk = voiced.length <= 2 ? voiced[0] : voiced[voiced.length - 2];
  /* the peak: the syllable's onset and vowel run, plus the consonant right after it when the word ends there (BOOM, KRAK) */
  let to = pk.v1;
  if ( pk === syl.at(-1) && to + 1 < n && /\p{L}/u.test(cs[to + 1]) ) to += 1;
  return shapeAround(cs, pk.from, to, null, null, pk.v0, pk.v1);
}
/* weights: 1 over the peak, rising into it over the lead-in, fading after it (letter by letter; a "!" stays with the peak) */
/* (v0..v1 = the peak's vowel run when known: its onset consonants climb into it, a closing consonant is a shade smaller) */
function shapeAround(cs, a, b, lead, tail, v0 = a, v1 = b) {
  const n = cs.length, w = new Array(n);
  const L = Number.isFinite(lead) ? Math.max(0, lead) : a;
  for ( let i = 0; i < n; i++ ) {
    if ( i >= a && i <= b ) w[i] = i < v0 ? Math.max(0.7, 1 - 0.12 * (v0 - i)) : i > v1 ? 0.92 : 1;
    else if ( i < a ) { const d = a - i; w[i] = d > L ? 0.3 : Math.max(0.3, 0.75 - 0.15 * (d - 1)); }
    else { const d = i - b; w[i] = Number.isFinite(tail) && d > tail ? 0.3 : Math.max(0.3, 0.85 * 0.8 ** (d - 1)); }
    if ( cs[i] === "!" || cs[i] === "?" ) w[i] = Math.max(w[i], 0.8);
  }
  return w;
}

/* ---------- layout: letters placed and sized; envelope warp params ---------- */
/* LOOK2 (P7): the invincible prefix = the hyphen lead-in before the body (KA-THOOM, RAKA-BOOM, KRA-KA-BOOM, KER-SPLAT): every lead
   segment at most five letters, the whole lead at most eight characters. A word whose segments repeat (BIP-BIP-BIP, BA-DUM-BA-DUM,
   WUP-WUP-WUUUP, THWUP-WOKKA-THWUP, doubled letters ignored) is a rhythm, not a lead-in: no prefix. Returns the prefix length. */
export function invPrefix(chars, accent = null) {
  const w = chars.join("");
  if ( /\s/u.test(w) ) return 0;
  const body = w.replace(/[!?]+$/u, "").replace(/-+$/u, "");
  const segs = body.split("-");
  if ( segs.length < 2 || segs.some((s) => !s) ) return 0;
  const key = (s) => s.replace(/(.)\1+/gu, "$1");
  const keys = segs.map(key);
  if ( new Set(keys).size < keys.length ) return 0;
  const lead = segs.slice(0, -1);
  let m = lead.length;
  if ( lead.some((s) => s.length > 5) || lead.join("-").length > 7 ) m = segs[0].length <= 5 ? 1 : 0;
  if ( !m ) return 0;
  const e = segs.slice(0, m).join("-").length + 1;
  if ( chars.length - e <= 2 ) return 0;
  if ( accent && Math.max(...accent.slice(0, e)) >= 0.95 ) return 0;   // the accent is in it: not a lead-in
  return e;
}

export function layoutPlan(chars, widths, mood, sound, hand, R, R2 = null, accent = null, ls = null) {
  const n = chars.length;
  const look = !!R2 && hand.contrast != null;
  const inv = hand.style === "invincible";   // LOOK2: the book's hand (straight baseline, monotone sizes, small top-set prefix)
  /* size curve: the loudest part of the word is the biggest (Comicraft's rule), peak from the sound; LOOK: a stronger contrast */
  const amp = (0.18 + 0.5 * sound.loud * (hand.env === "flat" ? 0.3 : 1)) * (look ? hand.contrast : 1);
  const sizes = [];
  for ( let i = 0; i < n; i++ ) {
    const u = n > 1 ? i / (n - 1) : 0.5;
    let s = 1 + amp * Math.exp(-((u - sound.peak) ** 2) / 0.09) - amp * 0.35;
    /* LOOK: the letters' own accent (where the sound peaks, the lead-in, the fading tail) sizes them, not one curve over the word */
    if ( look && accent ) s = 1 + amp * 1.5 * (accent[i] - 0.55);
    if ( hand.env === "swell" ) s = look ? (accent ? s * (0.62 + 0.6 * u) : 0.42 + 1.05 * u ** 1.2) : 0.55 + 0.75 * u ** 1.2;
    if ( hand.env === "shrink" ) s = look ? (accent ? s * (1.22 - 0.6 * u) : 1.45 - 1.0 * u ** 0.9) : 1.25 - 0.7 * u ** 0.9;
    if ( hand.env === "streak" ) s = 0.6 + 0.6 * u;
    if ( hand.profile2 === "swell" ) s *= 0.7 + 0.65 * u;
    if ( hand.profile2 === "shrink" ) s *= 1.3 - 0.6 * u;
    if ( hand.number ) s = 1;   // a number is even: a small sign or digit is a misread number (the rng below still advances)
    s *= 1 + R.f(-0.07, 0.07) * (hand.number || inv ? 0 : 0.6 + sound.rough);
    if ( (chars[i] === "!" || chars[i] === "?") && !(look && accent) ) s *= 1.05;
    sizes.push(Math.max(0.25, s));
  }
  /* LOOK: a small prefix before a huge body: the part before the first hyphen, a short first word, or the first syllable */
  let pre = 0;
  const partSized = !!ls && ls.some((v) => Math.abs(v - 1) > 1e-6);   // MOVE's parts size the word themselves
  if ( inv && !partSized && hand.prefix > 0 && !chars.includes("\n") ) {
    pre = invPrefix(chars, accent);
  } else if ( look && !partSized && hand.prefix > 0 && !chars.includes("\n") && sound.peak >= 0.3 ) {
    const w = chars.join(""), hy = w.indexOf("-"), sp = w.indexOf(" ");
    if ( hy >= 1 && hy <= 5 && n - hy > 2 ) pre = hy + 1;
    else if ( sp >= 1 && sp <= 4 && n - sp > 2 ) pre = sp + 1;
    else if ( n >= 6 && !/\s/.test(w) ) {
      /* whole syllables while the rest stays the longer part (RAKA+BOOM, KA+BOOM, KER+ZAK) */
      const syl = w.match(/[^AEIOUYĄĘÓ]*[AEIOUYĄĘÓ]+/g) ?? [];
      let len = 0;
      for ( const sy of syl.slice(0, -1) ) { if ( len + sy.length > 5 || n - (len + sy.length) < Math.max(3, (len + sy.length)) ) break; len += sy.length; }
      if ( len >= 2 ) pre = len;
    }
    if ( pre && accent && Math.max(...accent.slice(0, pre)) >= 0.95 ) pre = 0;   // the accent is in it: not a lead-in (DO-bra)
  }
  if ( pre ) {
    for ( let i = pre; i < n; i++ ) sizes[i] *= 1.12;
    const body = Math.max(...sizes.slice(pre));
    for ( let i = 0; i < pre; i++ ) sizes[i] = body * hand.prefix * (inv ? 1 : 0.92 + 0.16 * i / Math.max(1, pre - 1));   // the prefix a fraction of the body
  }
  /* LOOK: a body letter far smaller than the body's biggest reads as lower case (KA-TRZAamm, DZYYYń: Squada's and most comic faces'
     lower case are small capitals): the accent's tail and lead-in shrink, but never under 0.66 of the body (the prefix is apart) */
  if ( look ) {
    const body = Math.max(...sizes.slice(pre));
    for ( let i = pre; i < n; i++ ) if ( chars[i] !== " " && chars[i] !== "\n" ) sizes[i] = Math.max(sizes[i], 0.66 * body);
  }
  /* LOOK: case look-alikes: a C, O, S, U, V, W, X or Z much smaller than the letter beside it reads as lower case (CRUSH! as cRUsh!),
     so outside a lead-in they keep at least 0.8 of their bigger neighbour; a sign before a digit is as big as the digit (+1, not !1) */
  if ( look ) for ( let pass = 0; pass < 2; pass++ ) for ( let k = 0; k < n; k++ ) {
    const i = pass ? n - 1 - k : k;
    if ( i < pre || !CASELIKE.test(chars[i]) ) continue;
    const inWord = (j) => j >= 0 && j < n && chars[j] !== " " && chars[j] !== "\n";
    const nb = Math.max(inWord(i - 1) ? sizes[i - 1] : 0, inWord(i + 1) ? sizes[i + 1] : 0);
    if ( sizes[i] < 0.8 * nb ) sizes[i] = 0.8 * nb;
    const body = Math.max(...sizes.slice(pre)); if ( sizes[i] < 0.76 * body ) sizes[i] = 0.76 * body;   // CRUNCH! read "cRUNCH!" (advm 12)
  }
  for ( let i = 0; i < n - 1; i++ ) if ( /[+\-−±]/u.test(chars[i]) && /\d/u.test(chars[i + 1]) ) sizes[i] = Math.max(sizes[i], sizes[i + 1]);
  /* MOVE: choreography: a part's own size (a small prefix before the body), applied after LOOK's floors so an explicit part scale wins */
  if ( ls ) for ( let i = 0; i < n; i++ ) sizes[i] *= ls[i];
  /* LOOK: interlocked rings: in a run of the same round letter each one passes through the one before it (paint.mjs draws the
     over-under); sizes alternate so the rings read as two, not as one blot */
  const linkTo = chars.map((c, i) => (look && hand.link && i > 0 && c === chars[i - 1] && RINGS.has(c) && !(i < pre) ? i - 1 : -1));
  /* LOOK3: in the book's hand only short runs interlock (two always, three when the hand says so, four and more never: those O's
     are set as plain letters); `runPos` = a linked ring's place in its run (0 = the first, it stands up) */
  const runPos = chars.map(() => -1);
  if ( inv ) for ( let a = 0; a < n; ) {
    let b = a; while ( b + 1 < n && linkTo[b + 1] >= 0 ) b++;
    const len = b - a + 1;
    if ( len >= 2 ) {
      const keep = len === 2 || (len <= LINK.most && hand.link3);
      for ( let k = a; k <= b; k++ ) { if ( !keep ) linkTo[k] = -1; else runPos[k] = k - a; }
    }
    a = b + 1;
  }
  /* LOOK2 (P10): in the book's hand linked rings are one size (the run's biggest); then (P8) the word's sizes rise to one peak and fall,
     no neighbour under 0.85 of the other; then (P7) the prefix is a fixed share of the body as it finally is */
  if ( inv ) {
    for ( let i = 0; i < n; i++ ) { if ( linkTo[i] < 0 ) continue; let a = i - 1; while ( a > 0 && linkTo[a] >= 0 ) a--; let b = i; while ( b + 1 < n && linkTo[b + 1] >= 0 ) b++; const m = Math.max(...sizes.slice(a, b + 1)); for ( let k = a; k <= b; k++ ) sizes[k] = m; }
    if ( !hand.number && !partSized ) monotoneSizes(chars, sizes, pre, { rise: hand.env === "swell" ? RISE.swell : RISE.flat, fall: hand.env === "shrink" ? 0.85 : RISE.fall, cases: true });
    if ( pre ) { const body = Math.max(...sizes.slice(pre)); for ( let i = 0; i < pre; i++ ) sizes[i] = body * hand.prefix; }
  } else for ( let i = 0, r = 0; i < n; i++ ) { r = linkTo[i] >= 0 ? r + 1 : 0; if ( r % 2 ) sizes[i] = 0.8 * Math.min(sizes[i], sizes[i - 1]); }   // against its neighbour: an accent or a growing line never evens them out
  if ( linkTo.some((v) => v >= 0) && hand.stack === "merge" ) hand.stack = "stack";   // rings need each its own outline
  /* the linked letters are drawn as true rings (shape.mjs): round, whatever the font's O looks like */
  const ring = chars.map((c, i) => linkTo[i] >= 0 || linkTo[i + 1] === i);
  if ( !inv ) widths = widths.map((w, i) => (ring[i] ? RING_W : w));   // LOOK2: the book's rings are the face's own O, widened (shape.mjs)
  const bodyS = pre ? Math.max(...sizes.slice(pre)) : 1;
  let preAlign = pre ? R2.pick(["mid", "top", "base"]) : "mid";
  if ( inv && pre ) preAlign = "top";
  const letters = [];
  let x = 0;
  const split = hand.env === "split" ? Math.max(1, Math.min(n - 1, Math.round(n * R.f(0.35, 0.6)))) : -1;
  let sign = R2 && R2.chance(0.5) ? 1 : -1;
  for ( let i = 0; i < n; i++ ) {
    const s = sizes[i];
    const w = widths[i] * s;
    let rot = (R.f(-1, 1) * (3 + 7 * sound.rough) + (hand.env === "tumble" ? R.f(-1, 1) * 16 : 0)) * Math.PI / 180;
    let dy = R.f(-1, 1) * (0.03 + 0.07 * sound.rough);
    if ( hand.upright ) { rot *= 0.15; dy *= 0.2; }   // a drawn, engineered hand: upright and on its line
    if ( look && chars[i] !== " " && chars[i] !== "\n" ) {
      /* tilt with a bouncing baseline: neighbours lean opposite ways and ride up and down with the lean */
      sign = R2.chance(0.8) ? -sign : sign;
      rot = rot * 0.5 + sign * hand.tilt * R2.f(0.55, 1.15) * Math.PI / 180;
      dy += sign * hand.bob * R2.f(0.5, 1.1);
      if ( i < pre ) dy += preAlign === "base" ? 0.5 * (bodyS - s) : preAlign === "top" ? -0.5 * (bodyS - s) : 0;
    }
    if ( inv ) {
      /* LOOK2 (P8): upright letters standing on one straight baseline; the prefix hangs from the body's top line (P7) */
      rot = 0;
      dy = i < pre ? 0.5 - sizes[pre] + 0.5 * s : 0.5 * (1 - s);   // the prefix top = the first body letter's top
      if ( runPos[i] >= 0 && /\p{L}/u.test(chars[i]) ) dy += (runPos[i] % 2 ? 1 : -1) * LINK.rise * s;   // LOOK3: first up, second down, third up
    }
    if ( hand.env === "stairUp" ) dy -= i * 0.22;
    if ( hand.env === "stairDown" ) dy += i * 0.16;
    if ( hand.env === "tumble" ) dy += R.f(-0.12, 0.12) + i * 0.05;
    let gx = 0;
    if ( i === split ) gx = R.f(0.18, 0.32);
    if ( linkTo[i] >= 0 && !inv ) {
      /* a ring through the one before: pulled into it by half the smaller width, upright, the smaller one a little lower */
      const P = letters[i - 1];
      gx -= 0.5 * Math.min(w, P.w) + hand.track * P.s;   // deep enough that the strokes part at mid height (the over-under switches there)
      rot = 0; P.rot = 0;
      dy = P.dy + 0.18 * (P.s - s);
    }
    x += gx;
    letters.push({ ch: chars[i], x, w, s, rot, link: linkTo[i] >= 0 ? i - 1 : undefined, ring: ring[i] || undefined, dy: dy + (i >= split && split > 0 ? R.f(0.1, 0.22) * (R.chance(0.5) ? 1 : -1) * 0 : 0), splitSide: split > 0 && i >= split ? 1 : 0 });
    x += w + hand.track * s * (chars[i] === " " ? 0 : 1);
  }
  const W = Math.max(0.3, x - hand.track);
  /* envelope warp parameters */
  const E = { kind: hand.env, W };
  switch ( hand.env ) {
    case "arc": E.ang = R.f(0.35, 0.7) * (R.chance(0.8) ? 1 : -1); break;
    case "fan": E.ang = R.f(0.7, 1.15); break;
    case "sag": E.ang = -R.f(0.4, 0.8); break;
    case "bulge": E.b = R.f(0.22, 0.4); break;
    case "wave": E.a = R.f(0.08, 0.16); E.f = R.f(0.8, 1.5); E.ph = R.f(0, 6.28); break;
    case "zig": E.a = R.f(0.1, 0.18); E.f = Math.max(2, Math.round(n / 1.6)); break;
    case "persp": E.k0 = R.f(0.7, 0.85); E.k1 = R.f(1.15, 1.35); if ( R.chance(0.5) ) [E.k0, E.k1] = [E.k1, E.k0]; break;
    case "slant": E.rot = R.f(-0.18, 0.12); break;
    case "split": E.rot = R.f(-0.12, 0.12); E.splitDy = R.f(0.14, 0.26) * R.sign(); E.splitRot = R.f(0.05, 0.14) * R.sign(); break;
    case "streak": E.k0 = 0.75; E.k1 = 1.1; break;
    case "stairUp": E.rot = -R.f(0.05, 0.14); break;
    case "stairDown": E.rot = R.f(0.04, 0.12); break;
    default: break;
  }
  if ( hand.env !== "slant" && hand.env !== "split" ) E.rot = (E.rot ?? 0) + R.f(-0.1, 0.1) + (sound.pitch > 0.6 ? -0.08 : sound.pitch < -0.6 ? 0.08 : 0);
  if ( inv ) E.rot = Math.max(-0.05, Math.min(0.05, E.rot * 0.5));   // LOOK2 (P8): the whole word may lean a little; its letters stay upright on it
  /* LOOK: the second envelope */
  if ( look && hand.warp2 ) {
    const k = hand.warp2, w2 = { kind: k };
    if ( k === "arc" ) w2.ang = R2.f(0.3, 0.6) * (R2.chance(0.75) ? 1 : -1);
    if ( k === "fan" ) w2.ang = R2.f(0.5, 0.9);
    if ( k === "bulge" ) w2.b = R2.f(0.18, 0.32);
    if ( k === "persp" ) { w2.k0 = R2.f(0.68, 0.82); w2.k1 = R2.f(1.15, 1.35); if ( R2.chance(0.5) ) [w2.k0, w2.k1] = [w2.k1, w2.k0]; }
    E.w2 = w2;
  }
  return { letters, E, W, pre };
}

/* LOOK2 (P8): the book's sizes inside each word: one peak; the letters before it never shrink toward it and the letters after it
   never grow away from it; no letter under 0.85 of its neighbour (no lower-case look, no step). A mark ("!", "?") stands as tall as
   the letter before it, a hyphen as its smaller neighbour. The prefix (indices < pre) is apart. */
/* LOOK2 (P8): no letter of an invincible word under this share of the word's biggest letter */
export const INV_FLOOR = 0.82;
/* LOOK3 (`o.rise`): the letters BEFORE the peak keep at least this share of the next one, and the word's first letter is as tall as
   its neighbour: a first letter a step smaller reads as lower case ("cRUSH!", "wHAM!", "sKREE-"). The book's attack is as loud as its
   peak: rise 1 (flat up to the peak); a rising sound (swell) still grows, by gentle steps; after the peak the word falls by gentle
   steps too (`o.fall`; a fading sound, shrink, keeps 0.85) and a case look-alike never steps down (`o.cases`). Without `o` the LOOK2 rule (0.85). */
export const RISE = { flat: 1, swell: 0.93, fall: 0.93 };
export function monotoneSizes(chars, sizes, pre = 0, o = null) {
  const n = chars.length, ink = (i) => /[\p{L}\p{N}]/u.test(chars[i]);
  const rise = o?.rise ?? 0.85, fall = o?.fall ?? 0.85, keep = (i) => !!o?.cases && CASELIKE.test(chars[i]);   // LOOK3: a C, O, S, U, V, W, X, Z keeps its neighbour's size (a step smaller reads as lower case: CRUNcH)
  let from = pre;
  for ( let i = pre; i <= n; i++ ) {
    if ( i < n && chars[i] !== " " && chars[i] !== "\n" ) continue;
    const idx = []; for ( let k = from; k < i; k++ ) if ( ink(k) ) idx.push(k);
    if ( idx.length ) {
      let p = 0; for ( let k = 1; k < idx.length; k++ ) if ( sizes[idx[k]] > sizes[idx[p]] + 1e-9 ) p = k;
      for ( let k = p - 1; k >= 0; k-- ) { const a = idx[k], b = idx[k + 1]; sizes[a] = Math.max((keep(a) ? 1 : rise) * sizes[b], Math.min(sizes[a], sizes[b])); }
      if ( o && p > 0 && idx.length > 1 ) sizes[idx[0]] = Math.max(sizes[idx[0]], sizes[idx[1]]);
      for ( let k = p + 1; k < idx.length; k++ ) { const a = idx[k], b = idx[k - 1]; sizes[a] = Math.max((keep(a) ? 1 : fall) * sizes[b], Math.min(sizes[a], sizes[b])); }
      /* a floor under the whole word: a long tail ramped by 0.85 a step reads as lower case (THWApp, HFaaaah); clamping keeps it monotone */
      const top = sizes[idx[p]]; for ( const k of idx ) sizes[k] = Math.max(sizes[k], INV_FLOOR * top);
      for ( let k = from; k < i; k++ ) if ( !ink(k) ) {
        const prev = idx.filter((j) => j < k).at(-1), next = idx.find((j) => j > k);
        sizes[k] = /[!?]/.test(chars[k]) ? sizes[prev ?? next] : Math.min(sizes[prev ?? next], sizes[next ?? prev]);
      }
    }
    from = i + 1;
  }
  return sizes;
}

/* LOOK: lines. "\n" breaks lines; arrange "stack" (centred lines), "stair" (each line stepped sideways), "vertical" (one letter per
   line, a column), "line" (everything on one line); "auto" stacks the lines of a "\n" and three or more repeats of one short word
   ("BLAM BLAM BLAM"). Each line keeps its own letters' sizes and lean; later lines of a repeat echo smaller (or build up when the
   sound peaks late); a short first line over a longer one is a small prefix (RAKA / BOOM). */
export function arrangeLines(lay, chars, hand, sound, R2, mode = "auto") {
  const word = chars.join("");
  const toks = word.split(" ");
  const repeats = toks.length >= 3 && toks.every((t) => t === toks[0]) && toks[0].length <= 6;
  let m = mode;
  if ( m === "auto" ) m = chars.includes("\n") ? (R2.chance(0.35) ? "stair" : "stack") : repeats ? (R2.chance(0.5) ? "stair" : "stack") : "line";
  if ( m === "line" ) return lay;
  if ( m === "vertical" && hand.style === "invincible" ) return verticalInv(lay, chars);
  const breakAt = (i) => chars[i] === "\n" || ((m === "stack" || m === "stair") && !chars.includes("\n") && chars[i] === " ");
  const lines = [[]];
  if ( m === "vertical" ) { for ( let i = 0; i < chars.length; i++ ) { if ( chars[i] === "\n" ) continue; if ( lines.at(-1).length ) lines.push([]); lines.at(-1).push(i); } }
  else for ( let i = 0; i < chars.length; i++ ) { if ( breakAt(i) ) { lines.push([]); continue; } lines.at(-1).push(i); }
  const L = lay.letters;
  for ( let i = 0; i < chars.length; i++ ) if ( chars[i] === "\n" || breakAt(i) ) { L[i].x = 0; L[i].w = 0; }
  const rows = lines.filter((ln) => ln.some((i) => chars[i] !== " " && chars[i] !== "\n"));
  if ( rows.length < 2 ) return lay;
  const nr = rows.length;
  const scale = rows.map(() => 1);
  if ( m !== "vertical" ) {
    const txt = (r) => r.map((i) => chars[i]).join("");
    const same = rows.every((r) => txt(r) === txt(rows[0]));
    if ( same ) { const up = sound.peak > 0.6; for ( let k = 0; k < nr; k++ ) scale[k] = up ? 0.7 + 0.3 * k / (nr - 1) : 1 - 0.32 * k / (nr - 1); }
    else if ( nr === 2 && rows[0].length <= 4 && rows[1].length > rows[0].length ) scale[0] = R2.f(0.5, 0.62);
  }
  let y = 0, W = 0;
  const step = m === "stair" ? R2.f(0.3, 0.55) * R2.sign() : 0;
  const placed = [];
  /* each row keeps its own size curve: the word's curve ran over all rows, so a row is brought back to a full row's size */
  for ( const r of rows ) { const mx = Math.max(...r.map((i) => L[i].s)); for ( const i of r ) { const k1 = 1.25 / mx; L[i].s *= k1; L[i].w *= k1; L[i].x *= k1; } }
  rows.forEach((r, k) => {
    const k0 = scale[k];
    const x0 = L[r[0]].x;
    const maxS = Math.max(...r.map((i) => L[i].s)) * k0;
    if ( k > 0 ) y += 0.5 * placed[k - 1].h + 0.5 * maxS + (m === "vertical" ? -0.06 * maxS : R2.f(0.0, 0.08));
    let w = 0;
    for ( const i of r ) {
      const l = L[i];
      l.x = (l.x - x0) * k0; l.w *= k0; l.s *= k0; l.dy = l.dy * k0 + y;
      if ( m === "vertical" ) { l.rot *= 0.35; l.x += R2.f(-0.08, 0.08); }
      w = Math.max(w, l.x + l.w);
    }
    placed.push({ r, w, h: maxS, y });
    W = Math.max(W, w);
  });
  /* horizontal placement of each row: centred (a column centres every letter), or stepped like stairs */
  const span = step ? Math.abs(step) * (nr - 1) : 0;
  placed.forEach((p, k) => {
    const off = m === "stair" ? (step > 0 ? step * k : span + step * k) : (W - p.w) / 2;
    for ( const i of p.r ) L[i].x += off;
  });
  W += span;
  /* the block envelope warps across the whole block, centred on it; a column only leans */
  const cy = -0.5 + placed.at(-1).y / 2;
  lay.W = Math.max(0.3, W); lay.E.W = lay.W; lay.E.cy = cy;
  if ( m === "vertical" ) lay.E = { kind: "flat", W: lay.W, cy, rot: R2.f(-0.12, 0.12) };
  else if ( ["zig", "wave", "tumble", "split", "stairUp", "stairDown"].includes(lay.E.kind) ) lay.E = { kind: "flat", W: lay.W, cy, rot: lay.E.rot ?? 0, w2: lay.E.w2 };
  lay.lines = placed.map((p) => ({ from: p.r[0], to: p.r.at(-1), y: p.y, w: p.w }));
  lay.arrange = m;
  return lay;
}

/* LOOK2 (SPEC-LOOK P9): the book's vertical setting: a tight column, not a loose ladder. One row per body letter, each row tucked
   0.14 of its height under the row above (the upper letter in front: paint.mjs paints rows bottom first); the letters keep their
   accent sizes and stand centred on one axis (no jitter); a hyphen lead-in becomes a small horizontal line on top (the hyphen is not
   drawn); a "!" or "?" stands beside the letter before it; spaces and line breaks only start rows. */
export const TUCK = 0.14;
function verticalInv(lay, chars) {
  const L = lay.letters, n = chars.length, pre = lay.pre ?? 0;
  const ink = (i) => /[\p{L}\p{N}]/u.test(chars[i]);
  const rows = [];
  if ( pre ) rows.push([...Array(pre).keys()].filter((i) => chars[i] !== "-" && chars[i] !== " "));
  for ( let i = pre; i < n; i++ ) {
    if ( ink(i) ) rows.push([i]);
    else if ( /[!?]/.test(chars[i]) && rows.length ) rows.at(-1).push(i);
  }
  const used = new Set(rows.flat());
  for ( let i = 0; i < n; i++ ) if ( !used.has(i) ) { L[i].skip = true; L[i].w = 0; L[i].x = 0; }
  const live = rows.filter((r) => r.length);
  if ( live.length < 2 ) return lay;
  const mx = Math.max(...live.flat().map((i) => L[i].s)), k1 = 1.25 / mx;
  for ( const i of live.flat() ) { L[i].s *= k1; L[i].w *= k1; L[i].rot = 0; }
  let y = 0, W = 0; const placed = [];
  live.forEach((r, k) => {
    const h = Math.max(...r.map((i) => L[i].s));
    if ( k > 0 ) { const hp = placed[k - 1].h; y += 0.5 * hp + 0.5 * h - TUCK * 0.5 * (hp + h); }
    let x = 0;
    for ( const i of r ) { L[i].x = x; L[i].dy = y + 0.5 * (h - L[i].s); L[i].row = k; x += L[i].w + (/[!?]/.test(chars[i]) ? 0 : 0.02 * L[i].s); }
    const w = Math.max(0.05, x);
    placed.push({ r, w, h, y });
    W = Math.max(W, w);
  });
  /* centre the rows on one axis; a row's mark hangs to the right of the axis (the letter stays centred) */
  for ( const p of placed ) {
    const body = p.r.filter((i) => !/[!?]/.test(chars[i])), bw = body.length ? body.reduce((a, i) => a + L[i].w, 0) : p.w;
    const off = (W - bw) / 2;
    for ( const i of p.r ) L[i].x += off;
  }
  const cy = -0.5 + (placed[0].y + placed.at(-1).y) / 2;
  lay.W = Math.max(0.3, W); lay.E = { kind: "flat", W: lay.W, cy, rot: 0 };
  lay.lines = placed.map((p) => ({ from: p.r[0], to: p.r.at(-1), y: p.y, w: p.w }));
  lay.arrange = "vertical";
  return lay;
}

/* point warp of the envelope, in word space (x along the word in [0, W], baseline y = 0, cap top y = -1) */
export function envelope(E) {
  const W = E.W, cy = E.cy ?? -0.5;
  const f = warpOf(E, W, cy), f2 = E.w2 ? warpOf(E.w2, W, cy) : null;
  const rot = E.rot ?? 0, c = Math.cos(rot), s = Math.sin(rot);
  return (x, y) => {
    let p = f ? f(x, y) : [x, y];
    if ( f2 ) p = f2(p[0], p[1]);
    const dx = p[0] - W / 2, dy = p[1] - cy;
    return [W / 2 + dx * c - dy * s, cy + dx * s + dy * c];
  };
}
function warpOf(E, W, cy) {
  const polar = (ang) => {
    const R0 = W / ang;
    return (x, y) => {
      const th = (x - W / 2) / R0, d = -(y - cy), rho = R0 + d;
      return [W / 2 + rho * Math.sin(th), cy + R0 - rho * Math.cos(th)];
    };
  };
  switch ( E.kind ) {
    case "arc": case "fan": case "sag": return Math.abs(E.ang) > 0.01 ? polar(E.ang) : null;
    case "bulge": return (x, y) => { const u = x / W, k = 1 + E.b * Math.sin(Math.PI * Math.max(0, Math.min(1, u))); return [x, cy + (y - cy) * k]; };
    case "wave": return (x, y) => [x, y + E.a * Math.sin(6.283 * (E.f * x / W) + E.ph)];
    case "zig": return (x, y) => { const t = (E.f * x / W) % 1; return [x, y + E.a * (Math.abs(t * 4 - 2) - 1)]; };
    case "persp": case "streak": return (x, y) => { const u = x / W, k = E.k0 + (E.k1 - E.k0) * u; return [x, cy + (y - cy) * k]; };
    default: return null;
  }
}

/* ---------- timeline: entrance, hold, exit pictures ---------- */
const L0 = () => ({ v: 1, x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 });
function pic(n, ticks, g = {}, per = null) {
  const letters = []; for ( let i = 0; i < n; i++ ) letters.push({ ...L0(), ...(per ? per(i) : {}) });
  return { ticks, g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1, ...g }, letters, boil: 0, fx: [], dissolve: 0, misreg: 0, smear: null, impact: false };
}

/* Techniques (README "Motion"): stepped timing on twos (12 drawings/s) with ones only for smears and flash frames and threes for
   weight; held key poses; anticipation before a big move; squash and stretch; smear frames with multiples; an impact (flash) frame on
   contact; overlapping action / follow-through letter by letter; misregistered colour separations; line boil on every drawing;
   primary (the word) / secondary (lines, sparks) / consequence (debris, dust, puffs, embers) layers. The mood and the sound pick which
   techniques a word gets and how they are combined; the hand's randomness varies them. */
export function buildTimeline(n, mood, sound, hand, R, o = {}) {
  const M = MOODS[mood];
  const reduced = !!o.reduced;
  const ein = o.in ?? R.w(M.in), ehold = o.holdKind ?? R.w(M.hold), eout = o.out ?? R.w(M.out);
  const T = (t) => Math.max(1, Math.round(t * (o.tempo ? 1 / o.tempo : 1)));
  const ent = [], hold = [], exit = [];
  const seeds = () => R.seed();
  const stag = (k) => Math.max(1, Math.ceil(n / k));
  const dir = o.dir ?? 1;
  /* which techniques this word gets */
  const tech = {
    flash: !reduced && sound.sharp > 0.55 && sound.loud > 0.6 && R.chance(0.35 + 0.5 * sound.loud),   // impact frame on contact
    smear: !reduced && R.chance(0.55 + 0.4 * (1 - sound.long)),                                        // smear frames on fast moves
    antic: !reduced && R.chance(0.45 + 0.4 * sound.loud),                                              // anticipation before a big move
    follow: !reduced && n > 2 && R.chance(0.4 + 0.5 * sound.long),                                     // letters settle one after another
    misreg: R.chance(mood === "zap" ? 0.9 : 0.22) ? R.f(0.02, 0.045) : 0,                              // colour separations off register
    heavy: (sound.loud > 0.8 && sound.sharp < 0.7) || mood === "crash" || mood === "fail"             // threes, longer holds
  };
  const beat = tech.heavy ? 3 : 2;
  const P = (ticks, g = {}, per = null) => { const p = pic(n, T(ticks), g, per); p.misreg = tech.misreg; return p; };
  const flashFrame = (g = {}) => { const p = P(1, g); p.impact = true; p.misreg = 0; return p; };
  const settle = (k) => (i) => (tech.follow ? { x: -dir * 0.06 * Math.max(0, 1 - k) * (1 - i / n), y: 0.04 * Math.sin(i * 1.7) * Math.max(0, 1 - k), r: 0.05 * Math.max(0, 1 - k) * ((i % 2) ? 1 : -1) } : {});

  /* ---------- entrances ---------- */
  if ( reduced ) ent.push(P(3, { s: 0.94 }));
  else switch ( ein ) {
    case "slam": {
      if ( tech.antic ) ent.push(P(beat, { s: 0.82, sx: 1.18, sy: 0.78, y: 0.08 }, (i) => ({ r: (i % 2 ? 1 : -1) * 0.04 })));   // a crouch: the blow winds up (still readable)
      if ( tech.flash ) ent.push(flashFrame({ s: 1.12 }));
      /* ADVM 7: the smear's overshoot follows the loudness (a quiet satellite word never slams in bigger than the main word) */
      const sm = P(1, { s: 1.12 + 0.48 * Math.max(0, Math.min(1, Number.isFinite(o.magnitude) ? o.magnitude : (sound.loud ?? 0.5))), sx: 1.08 });
      if ( tech.smear ) sm.smear = { dx: 0, dy: 0, zoom: 0.35, n: 3 };
      sm.fx.push({ k: "speed", a: 0.6, radial: true, seed: seeds() });
      ent.push(sm);
      ent.push(P(2, { s: 0.86, sx: 1.14, sy: 0.84 }, settle(0)));                               // squash on contact
      ent[ent.length - 1].fx.push({ k: "burst", a: 1, seed: seeds() });
      ent.push(P(2, { s: 1.05, sx: 0.95, sy: 1.07 }, settle(0.5)));                             // stretch back
      ent.push(P(beat + 2, {}, settle(1)));                                                      // held key pose
      break;
    }
    case "pop": {
      ent.push(P(2, { s: 0.38, r: R.f(-0.15, 0.15) }));
      ent.push(P(1, { s: 1.2, sx: 0.9, sy: 1.14 }));
      if ( tech.flash ) ent.push(flashFrame({ s: 1.1 }));
      ent.push(P(2, { s: 0.95, sx: 1.08, sy: 0.92 }, settle(0.3)));
      ent.push(P(2, { s: 1.02 }, settle(0.8)));
      if ( M.fx?.burst || M.fx?.sparks ) ent[1].fx.push({ k: M.fx.sparks ? "sparks" : "burst", a: 0.7, seed: seeds() });
      if ( M.fx?.droplets ) ent[ent.length - 1].fx.push({ k: "droplets", a: 1, seed: seeds() });
      break;
    }
    case "crackIn": {
      const off = []; for ( let i = 0; i < n; i++ ) off.push({ x: R.f(-0.35, 0.35), y: R.f(-0.3, 0.3), r: R.f(-0.4, 0.4) });
      ent.push(P(beat, { s: 1.12 }, (i) => ({ x: off[i].x, y: off[i].y, r: off[i].r })));        // held: the pieces hang apart
      ent.push(P(1, { s: 1.08 }, (i) => ({ x: off[i].x * 0.35, y: off[i].y * 0.35, r: off[i].r * 0.3 })));
      if ( tech.flash || R.chance(0.6) ) ent.push(flashFrame({ s: 1.04 }));
      ent.push(P(2, { s: 1.02, x: 0.03 }, settle(0.4)));
      ent[ent.length - 1].fx.push({ k: "burst", a: 0.8, seed: seeds() });
      break;
    }
    case "drop": {
      /* ADVM 7: the word falls as ONE word (every letter visible in every drawing, the same line), the letters only a little behind
         each other (a ripple of at most 1.2 drawings across the word), from 1.4 em above: no fragments, no stair, no jump */
      const POSE = [{ y: -1.4, sy: 1.2, sx: 0.88 }, { y: -0.55, sy: 1.12, sx: 0.92 }, { y: 0.07, sy: 0.76, sx: 1.2 }, { y: -0.1, sy: 1.05, sx: 0.97 }, { y: 0.02, sy: 0.98, sx: 1 }, { y: 0, sy: 1, sx: 1 }];
      const at = (t) => { const c = Math.max(0, Math.min(POSE.length - 1, t)), a = Math.floor(c), b = Math.min(POSE.length - 1, a + 1), f = c - a;
        return { y: POSE[a].y + (POSE[b].y - POSE[a].y) * f, sy: POSE[a].sy + (POSE[b].sy - POSE[a].sy) * f, sx: POSE[a].sx + (POSE[b].sx - POSE[a].sx) * f }; };
      const lag = (i) => (n > 1 ? (i / (n - 1)) * 1.2 : 0);
      for ( let s = 0; s < 6; s++ ) ent.push(P(2, {}, (i) => at(s - lag(i))));
      ent[Math.min(ent.length - 1, 2)].fx.push({ k: "dust", a: 0.8, seed: seeds() });
      ent.push(P(beat + 1));
      break;
    }
    case "rise": {
      const k = stag(5), steps = Math.ceil(n / k) + 3;
      for ( let s = 0; s < steps; s++ ) ent.push(P(2, {}, (i) => {
        const t = s - Math.floor(i / k);
        if ( t < 0 ) return { v: 0 };
        return [{ y: 1.1, s: 0.55, sy: 1.3, sx: 0.8 }, { y: 0.3, s: 0.92, sy: 1.12, sx: 0.92 }, { y: -0.1, s: 1.04, sy: 0.96 }, { y: 0.02 }][Math.min(3, t)] ?? {};
      }));
      break;
    }
    case "grow": {
      const k = stag(5), steps = Math.ceil(n / k) + 3;
      for ( let s = 0; s < steps; s++ ) ent.push(P(2, { x: R.f(-0.04, 0.04), y: R.f(-0.04, 0.04) }, (i) => {
        const t = s - Math.floor(i / k);
        if ( t < 0 ) return { v: 0 };
        return [{ s: 0.4, sy: 0.8 }, { s: 1.25, sy: 1.1 }, { s: 0.95 }, { s: 1 }][Math.min(3, t)];
      }));
      if ( tech.flash ) ent.splice(Math.min(ent.length - 1, 3), 0, flashFrame());
      break;
    }
    case "zip": {
      if ( tech.antic ) ent.push(P(2, { x: -3 * dir, sx: 0.7, sy: 1.1, s: 0.8 }));                // off to the side, gathered
      const a = P(1, { x: -1.6 * dir, sx: 1.9, sy: 0.78 }); a.smear = { dx: -dir * 1.2, dy: 0, n: 4 }; a.fx.push({ k: "speed", a: 1, dir, seed: seeds() });
      const b = P(1, { x: 0.32 * dir, sx: 1.3, sy: 0.9 }, (i) => ({ x: -dir * 0.15 * (1 - i / n) })); b.smear = tech.smear ? { dx: -dir * 0.6, dy: 0, n: 3 } : null; b.fx.push({ k: "speed", a: 0.7, dir, seed: seeds() });
      ent.push(a, b);
      ent.push(P(2, { x: -0.08 * dir, sx: 0.92, sy: 1.04 }, (i) => ({ x: dir * 0.1 * (i / n) })));   // the tail catches up: follow-through
      ent.push(P(2, {}, settle(0.5)));
      break;
    }
    default: ent.push(P(2, { s: 0.9 }));
  }

  /* ---------- hold: redrawn pictures cycled (line boil), with the hold's own motion ---------- */
  const holdN = ehold === "flicker" || ehold === "buzz" ? 4 : 3;
  for ( let i = 0; i < holdN; i++ ) {
    const p = P(ehold === "buzz" ? 2 : beat + 1);
    p.boil = seeds();
    if ( !reduced ) switch ( ehold ) {
      /* ADVT 8: a hold has to live (a held word is still being shouted): visible shakes, letters that keep moving */
      case "shake": p.g.x = R.f(-0.09, 0.09) * (1 + sound.loud); p.g.y = R.f(-0.07, 0.07) * (1 + sound.loud); p.g.r = R.f(-0.03, 0.03); p.letters.forEach((l) => { l.y = R.f(-0.035, 0.035); }); break;
      case "throb": p.g.s = [1, 1.08, 0.98, 1.05][i]; p.g.sy = [1, 1.05, 0.98, 1.01][i]; break;
      case "rattle": p.letters.forEach((l) => { l.x = R.f(-0.05, 0.05); l.y = R.f(-0.07, 0.07); l.r = R.f(-0.09, 0.09); }); break;
      case "wobble": p.letters.forEach((l, j) => { l.r = 0.1 * Math.sin(i * 2.1 + j); l.y = 0.05 * Math.cos(i * 2.1 + j); }); break;
      case "boil": p.letters.forEach((l, j) => { l.y = 0.07 * Math.sin(i * 2.4 + j * 1.3); l.r = 0.06 * Math.cos(i * 1.9 + j); }); p.g.s = [1, 1.04, 0.99][i]; break;
      case "buzz": p.g.x = R.f(-0.03, 0.03); p.reseed = true; p.misreg = [0.05, 0, 0.03, 0][i]; p.fx.push({ k: i % 2 ? "krackle" : "sparks", a: 0.7, seed: seeds() }); break;
      case "flicker": p.reseed = true; p.g.y = -0.03 * i; p.g.s = [1, 1.04, 0.98, 1.02][i]; break;   // no ember specks over held letters (LOOK, the user: clean letters); MOVE's swell kept
      default: break;
    }
    if ( !reduced && M.fx?.rays && i % 2 === 0 ) p.fx.push({ k: "krackle", a: 0.6, seed: seeds() });
    /* secondary layer that flickers on the hold's drawings: impact lines around loud hits, sparks around sharp ones */
    if ( !reduced && i % 2 === 0 && sound.loud > 0.6 && (M.fx?.burst || M.fx?.dust) && ehold !== "buzz" ) p.fx.push({ k: "burst", a: 0.45, seed: seeds() });
    if ( ehold !== "buzz" && ehold !== "flicker" && M.fx?.speed && i === 0 ) p.fx.push({ k: "speed", a: 0.35, dir, seed: seeds() });
    hold.push(p);
  }

  /* ---------- exits ---------- */
  const fly = []; for ( let i = 0; i < n; i++ ) { const u = n > 1 ? i / (n - 1) - 0.5 : R.f(-0.5, 0.5); fly.push({ x: u * R.f(1.2, 2.2) + R.f(-0.3, 0.3), y: R.f(-1, 0.4), r: R.f(-1, 1) }); }
  if ( reduced ) { exit.push(P(3), P(2)); exit[0].dissolve = 0.5; exit[1].dissolve = 0.85; }
  else switch ( eout ) {
    case "shatter":   /* ADVT 9: the letters themselves break and fly (shards.mjs); "shards" is the same exit */
    case "shards": {
      /* the actual letters break: cracks run through the word (held), then its fragments fly, fall and bounce (paint: shards.mjs) */
      const sd = seeds(), from = Number.isFinite(o.from) ? o.from : null;
      if ( o.pixelArt ) { [0.25, 0.6, 1].forEach((t, j) => { const p = P(2, {}, (i) => ({ x: fly[i].x * t, y: fly[i].y * t + 0.5 * t * t, r: fly[i].r * t, s: 1 - 0.35 * t, sx: 1 + 0.2 * t })); p.dissolve = [0, 0.3, 0.7][j]; p.fx.push({ k: "debris", a: 1 - 0.3 * j, t, seed: seeds() }); exit.push(p); }); break; }
      if ( tech.antic ) exit.push(P(2, { s: 1.035 }));
      const c = P(beat + 1); c.shards = { t: 0, seed: sd, from }; exit.push(c);
      if ( tech.flash ) { const f = flashFrame({ s: 1.04 }); exit.push(f); }
      let tt = 0;
      for ( let j = 0; j < 6; j++ ) { tt += 2 * TICK / 1000 / (o.tempo || 1); const p = P(2); p.shards = { t: tt, seed: sd, from, last: j === 5 }; p.dissolve = j >= 4 ? (j === 4 ? 0.35 : 0.7) : 0; exit.push(p); }
      break;
    }
    case "pop":
      exit.push(P(2, { s: 0.9, sx: 1.06, sy: 0.9 }), P(1, { s: 1.18, sy: 1.08 }));                   // anticipation squash, then out
      exit[1].dissolve = 0.55; exit[1].fx.push({ k: "burst", a: 0.9, seed: seeds() });
      exit.push(P(2, { s: 1.24 })); exit[2].dissolve = 0.85; exit[2].fx.push({ k: "puff", a: 0.6, t: 0.6, seed: seeds() });
      break;
    case "burst": {
      /* ADVT 9: it swells, then blows apart from its middle: its own pieces fly out radially in a puff cloud */
      exit.push(P(2, { s: 0.94, sy: 0.92 }), P(2, { s: 1.12, sx: 1.06 }));
      if ( o.pixelArt ) { exit.push(P(2, { s: 1.38 })); exit[2].fx.push({ k: "puff", a: 0.6, t: 0.8, seed: seeds() }); exit[2].dissolve = 0.8; break; }
      const sd = seeds(); let tt = 0;
      for ( let j = 0; j < 6; j++ ) { tt += 2 * TICK / 1000 / (o.tempo || 1); const p = P(2); p.shards = { t: tt, seed: sd, mode: "burst", last: j === 5 }; if ( j < 3 ) p.fx.push({ k: "puff", a: 0.85 - 0.2 * j, t: 0.3 + 0.2 * j, seed: seeds() }); p.dissolve = j >= 4 ? (j === 4 ? 0.35 : 0.7) : 0; exit.push(p); }
      break;
    }
    case "fall": {
      exit.push(P(2, {}, () => ({ y: -0.08, sy: 1.04 })));                                              // a small lift before the drop
      const k = stag(4), steps = Math.ceil(n / k) + 3;
      for ( let s = 0; s < steps; s++ ) { const p = P(2, {}, (i) => { const t = s - Math.floor(i / k); if ( t < 0 ) return {}; return { y: 0.25 * t * t + 0.1 * t, r: fly[i].r * 0.25 * t, x: fly[i].x * 0.08 * t, sy: 1 + 0.06 * t, sx: 1 - 0.03 * t }; }); p.dissolve = Math.max(0, (s - steps + 2) * 0.4); exit.push(p); }
      break;
    }
    case "droop":
      exit.push(P(3, { r: 0.04 }, (i) => ({ y: 0.06 * i / n, r: 0.08, sy: 0.96 }))); exit.push(P(3, { r: 0.08, y: 0.25 }, (i) => ({ y: 0.25 * i / n, r: 0.18, sy: 0.9 })));
      exit.push(P(2, { r: 0.1, y: 0.8, sy: 1.15 }, () => ({ r: 0.25 }))); exit[2].dissolve = 0.6;
      break;
    case "rise":
      [0.3, 0.7, 1.15].forEach((t, j) => { const p = P(2, { y: -0.45 * t, sy: 1 + 0.08 * t }, (i) => ({ y: -0.15 * t * Math.sin(i * 1.7), x: 0.04 * Math.sin(i + t * 3) })); p.dissolve = [0.2, 0.5, 0.8][j]; if ( M.fx?.embers ) p.fx.push({ k: "embers", a: 0.6, seed: seeds() }); exit.push(p); });
      break;
    case "shrink":
      [0.75, 0.5, 0.3].forEach((s, j) => { const p = P(2, { s, y: -0.15 * (j + 1) }); p.dissolve = j === 2 ? 0.5 : 0; exit.push(p); });
      break;
    case "zipout": {
      exit.push(P(2, { x: -0.18 * dir, sx: 0.9, sy: 1.06 }));                                            // anticipation: pulled back
      const a = P(1, { x: 1.2 * dir, sx: 1.6, sy: 0.84 }); a.smear = { dx: -dir * 1, dy: 0, n: 3 }; a.fx.push({ k: "speed", a: 1, dir: -dir, seed: seeds() });
      const b = P(1, { x: 3.4 * dir, sx: 2, sy: 0.72 }); b.smear = { dx: -dir * 1.6, dy: 0, n: 4 }; b.fx.push({ k: "speed", a: 0.7, dir: -dir, seed: seeds() }); b.dissolve = 0.5;
      exit.push(a, b);
      break;
    }
    default:
      [0.35, 0.65, 0.9].forEach((d) => { const p = P(2); p.dissolve = d; exit.push(p); });
  }
  for ( const p of [...ent, ...exit] ) p.boil = seeds();
  return { ent, hold, exit, kinds: { in: ein, hold: ehold, out: eout }, tech };
}

/* ---------- MOTION2: the invincible style's timeline (motion.mjs) ----------
   Few pictures, each with a `key`: pictures that look the same share one painting (the engine paints a key once and moves the sprite);
   the motion itself is plan.motion, a pose per display frame. ent: [impact accent (1 tick)] [smear (stepped slam)] the word (whole;
   a break: whole, then cracked); hold: the hold picture, then (stepped) the drawings of the letters that move; exit: the word under the
   exit's pose, or the drawn pieces of a shards / crumble exit. */
function trackTimeline(n, m, R, o = {}) {
  const tempo = o.tempo || 1;
  const sc = (keys) => keys.map(([t, p, e]) => [t / tempo, p, e]);
  m.entKeys = sc(entranceKeys(m)); m.exitKeys = sc(exitKeys(m));
  /* FIN-ENGINE (FXIS-E4): under reduced motion the fade-in ends on the FULL entrance's contact (o.contact), so a reduced seat sees the
     word land on the same instant as a full one (before: a 140 ms fade, the word ~0.1-0.4 s early) */
  if ( o.reduced && m.in === "fade" && Number.isFinite(o.contact) ) {
    const c = Math.max(0, o.contact), f = Math.min(140 / tempo, c);
    m.entKeys = c > f ? [[0, { a: 0 }], [c - f, { a: 0 }, "lin"], [c, {}, "lin"]] : [[0, { a: 0 }], [Math.max(1, c), {}, "lin"]];
  }
  /* the impact accent covers the first tick: the entrance's contact pose starts when the word shows (else the slam's big contact is
     spent under the accent and the word appears already settled: seen on the MOTION2 film) */
  const shifted = m.flash && !o.reduced && m.in !== "choreo";
  if ( shifted ) { const d = TICK / tempo; m.entKeys = [[0, m.entKeys[0][1]], ...m.entKeys.map(([t, p, e]) => [t + d, p, e])]; }
  /* FIN-ENGINE (FXIS-E1 / FXIT-E3): the word's contact, ms from its start (an impact frame a caller plays on the word belongs here) */
  m.contactMs = m.in === "choreo" ? null : m.in === "fade" ? keysEnd(m.entKeys) : m.entKeys[contactKey(m, m.entKeys) + (shifted ? 1 : 0)][0];
  const ticks = (ms) => Math.max(1, Math.ceil(ms / TICK - 1e-6));
  const P = (t, key, extra = {}) => { const p = pic(n, t); p.key = key; p.boil = R.seed(); return Object.assign(p, extra); };
  const ent = [], hold = [], exit = [];
  const entT = ticks(keysEnd(m.entKeys));
  let used = 0;
  if ( m.in !== "choreo" ) {
    if ( m.flash && !o.reduced ) { ent.push(P(1, "impact", { impact: true })); used++; }
    if ( m.mode === "stepped" && (m.in === "slam" || m.in === "burstIn") && !o.reduced ) { ent.push(P(1, "smear", { smear: { dx: 0, dy: 0, zoom: 0.3, n: 3 } })); used++; }
    if ( m.in === "crackIn" ) { const k = Math.max(1, ticks(55 / tempo) - used); ent.push(P(k, "base")); used += k; }
    const rest = Math.max(entT - used, ent.length ? 0 : 1);
    if ( rest > 0 ) ent.push(P(rest, m.in === "crackIn" ? "crack" : "base", m.in === "crackIn" ? { shards: { t: 0, seed: m.shardSeed ??= R.seed(), from: o.from ?? null } } : {}));
  }
  const cracked = m.family === "break" && m.out === "shards" && m.in === "crackIn";
  hold.push(cracked ? P(2, "crack", { shards: { t: 0, seed: m.shardSeed, from: o.from ?? null } }) : P(2, "base"));
  letterDrawings(m, n).forEach((letters, k) => {
    /* LOOK3: interlocked rings shake as ONE piece (each its own jitter pulled the strokes of a crossing together or apart) */
    if ( o.links ) for ( let i = 0; i < n; i++ ) { let h = i; while ( o.links[h] != null ) h = o.links[h]; if ( h !== i && letters[h] && letters[i] ) letters[i] = { ...letters[h] }; }
    const p = P(m.rate, `L${k}`); p.letters = letters; hold.push(p);
  });
  if ( m.out === "shards" && !o.reduced ) {
    const sd = m.shardSeed ??= R.seed(); let tt = 0;
    for ( let j = 0; j < 6; j++ ) { tt += 2 * TICK / 1000 / tempo; const p = P(2, `x${j}`, { shards: { t: tt, seed: sd, from: o.from ?? null, last: j === 5 } }); p.dissolve = j >= 4 ? (j === 4 ? 0.35 : 0.7) : 0; exit.push(p); }
  } else if ( m.out === "crumble" && !o.reduced ) {
    /* letters drop off one after another, from the right, eroding the word from its bottom */
    const steps = 6;
    for ( let s = 0; s < steps; s++ ) {
      const p = P(2, `x${s}`);
      p.letters = p.letters.map((l, i) => { const t = s - (n - 1 - i) * (4 / Math.max(1, n)); return t <= 0 ? l : { ...l, y: 0.22 * t * t, r: (i % 2 ? 1 : -1) * 0.12 * t, sy: Math.max(0.5, 1 - 0.08 * t) }; });
      p.dissolve = s >= steps - 2 ? (s === steps - 2 ? 0.35 : 0.7) : 0;
      exit.push(p);
    }
  } else exit.push(P(ticks(keysEnd(m.exitKeys)), "base"));
  return { ent, hold, exit, kinds: { in: m.in, hold: m.hold, out: m.out }, tech: { flash: !!m.flash, smear: ent.some((p) => p.smear), antic: false, follow: false, misreg: 0, heavy: m.rate === 3 }, track: true };
}

/* FIN-ENGINE (FXIS-E1 / FXIT-E3): the contact instant of a word, ms from its start. A track word (invincible): its entrance's contact key
   (motion.contactMs). A drawn entrance (legacy style, choreography): the first picture with a burst or dust (the squash on contact), else
   the first impact accent, else the biggest pose. Stepped motion shows it on the next 24 Hz grid instant (L.contactAt). */
export function contactOf(tl, motion) {
  if ( motion && Number.isFinite(motion.contactMs) ) return Math.round(motion.contactMs * 100) / 100;
  let a = 0, big = -1, bigAt = 0, flashAt = null;
  for ( const p of tl.ent ) {
    if ( p.fx?.some((f) => f.k === "burst" || f.k === "dust") ) return Math.round(a * TICK * 100) / 100;
    if ( p.impact && flashAt == null ) flashAt = a;
    const g = p.g ?? {}, s = (g.s ?? 1) * Math.max(g.sx ?? 1, g.sy ?? 1);
    if ( s > big + 1e-9 ) { big = s; bigAt = a; }
    a += p.ticks;
  }
  return Math.round((flashAt ?? bigAt) * TICK * 100) / 100;
}

/* ---------- the whole plan ---------- */
export function makePlan(text, opts, fonts, memory) {
  const raw = String(text ?? "").normalize("NFC");
  /* FXLE F12: "\n" stacks lines (other white space folds to one space, empty lines go) */
  const word = raw.toLocaleUpperCase("pl").split(/\r\n|\r|\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n") || "?";
  let mood = opts.mood && opts.mood !== "auto" ? opts.mood : null;
  if ( mood && !Object.hasOwn(MOODS, mood) ) mood = null;   // FXLE F15: "toString", "__proto__" ... are no moods
  if ( !mood ) mood = opts.sound && !opts.mood ? nearestMood(opts.sound) : guessMood(word);
  const sound = soundOf(word, mood, opts.sound);
  const seed = opts.seed != null ? hash(`${opts.seed}`) : (Math.random() * 4294967296) >>> 0;
  const R = rng(seed), R2 = rng((seed ^ 0x5bd1e995) >>> 0);
  const avoid = { font: new Set(), env: new Set(), color: new Set(), treat: new Set() };
  for ( const h of [...(memory ?? []), ...(opts.avoid ?? [])] ) {
    const [f, t, e, c] = String(h).split("/");
    if ( f ) avoid.font.add(f); if ( e ) avoid.env.add(e); if ( c ) avoid.color.add(c); if ( t ) avoid.treat.add(t);
  }
  /* a caller may pin the hand of an earlier plan (a stream of syllables lettered by one hand); the rng still advances the same way */
  /* LOOK2 (P17): "expressive" IS the comic hand (frozen legacy look): same plan, byte for byte */
  const lstyle = STYLES.includes(opts.look?.style) ? (opts.look.style === "expressive" ? "comic" : opts.look.style) : "comic";
  const character = characterFor(mood, sound, opts.character), traits = traitsOf(mood, sound, character);
  const chosen = styleHand(lstyle === "comic" ? fitSound(chooseHand(mood, sound, R, avoid, R2), traits, sound, avoid) : chooseHand(mood, sound, R, avoid, R2), lstyle, mood, sound, word, seed, traits, character);
  const hand = opts.hand && typeof opts.hand === "object" ? { ...chosen, ...JSON.parse(JSON.stringify(opts.hand)) }
    : typeof opts.hand === "string" ? handFromId(opts.hand, chosen) : chosen;
  if ( Array.isArray(opts.colors) && opts.colors.length ) {
    const cs = opts.colors.map(String);
    hand.pal.fill = [cs[0], cs[1] ?? cs[0], cs[2] ?? cs[1] ?? cs[0]];
  }
  /* where the sound comes from: the word grows away from it (Comicraft: letters grow as they move away from the source) */
  if ( Number.isFinite(opts.from) ) {
    const a = opts.from * Math.PI / 180, cx = Math.cos(a), sy = Math.sin(a);
    /* LOOK3: the book's hand keeps its straight baseline (LOOK2 P8): a source to the side still grows or shrinks the word, one above
       or below no longer bends it into a fan or a sag (live, the dice splash's from: 90 fanned CRUSH!: its letters leaned, the reader
       straightened and parted them, "CRUS H!") */
    hand.env = cx < -0.35 ? "swell" : cx > 0.35 ? "shrink" : hand.style === "invincible" ? hand.env : (sy > 0 ? "fan" : "sag");
    hand.id = [hand.font, hand.treat, hand.env, hand.colorFam, hand.outline, hand.fill].join("/");
  }
  applyLook(hand, opts);
  if ( NUMBER_RE.test(word) ) numberHand(hand, opts.look ?? {});
  const chars = [...word];
  const capAt = hand.capFont ? chars.findIndex((c) => /[\p{L}\p{N}]/u.test(c)) : -1;
  const fontAt = (i) => (i === capAt ? hand.capFont : hand.font);
  const widths = chars.map((ch, i) => (ch === " " ? 0.32 : ch === "\n" ? 0 : fonts.adv(fontAt(i), ch)));
  /* a caller's sound with an explicit peak (0 = the attack, 1 = the end) places the accent there when no accent is given */
  const pk = Number.isFinite(opts.sound?.peak) ? Math.round(clamp01(opts.sound.peak) * (chars.length - 1)) : null;
  const accent = accentOf(chars, opts.accent ?? (pk != null ? { peak: [pk, pk] } : null));
  /* choreography (choreo.mjs): parts of the word on their own beats, typed on, counted in; reduced motion = all at once */
  const groups = opts.reduced ? null : groupsOf(chars, opts, syllablesOf);
  const lay = arrangeLines(layoutPlan(chars, widths, mood, sound, hand, R, R2, accent, letterScales(chars.length, groups)), chars, hand, sound, R2, opts.arrange ?? opts.look?.arrange ?? "auto");
  if ( capAt >= 0 ) lay.letters[capAt].font = hand.capFont;
  const dir = opts.dir ?? (R.chance(0.75) ? 1 : -1);
  const fromDeg = Number.isFinite(opts.from) ? opts.from : null;
  /* MOTION2: the vocabulary's own picks (L.sfx / L.word: vocabMotion) drive only the legacy style; the invincible style reads its table */
  const vm = hand.style === "invincible" ? {} : (opts.vocabMotion ?? {});
  const topts = { reduced: opts.reduced, tempo: opts.tempo, dir, in: opts.in ?? vm.in, out: opts.out ?? vm.out, holdKind: opts.holdKind ?? vm.holdKind, from: fromDeg, pixelArt: !!opts.pixel, magnitude: opts.magnitude };
  /* MOTION2: the invincible style moves by the sound's motion table (motion.mjs); the legacy style keeps its frozen timeline */
  const track = hand.style === "invincible";
  const choreoOn = !!groups || (!opts.reduced && !!opts.countIn);
  const motion = track ? motionOf({ kind: opts.kind, mood: MOODS[mood]?.base ?? mood, sound, character, chars, accent, dir, seed, reduced: opts.reduced, syllable: !!opts._stream,
    mode: opts.look?.motion, pin: { in: opts.in, holdKind: opts.holdKind, out: opts.out } }) : null;
  if ( motion && choreoOn ) { motion.in = "choreo"; motion.flash = false; }
  /* FIN-ENGINE (FXIS-E2 / FXIT-E4): flash: false = a caller plays its own impact frame on this word's contact: no accent of its own */
  if ( motion && opts.flash === false ) motion.flash = false;
  /* FIN-ENGINE (FXIS-E4): a reduced word lands on the contact a full seat would see (same table row, same accent rule) */
  if ( motion && opts.reduced ) {
    const full = !groupsOf(chars, { ...opts, reduced: false }, syllablesOf) && !opts.countIn ? motionOf({ kind: opts.kind, mood: MOODS[mood]?.base ?? mood, sound, character, chars, accent, dir, seed, syllable: !!opts._stream,
      mode: opts.look?.motion, pin: { in: opts.in, holdKind: opts.holdKind, out: opts.out } }) : null;
    if ( full ) {
      if ( opts.flash === false ) full.flash = false;
      const tp = opts.tempo || 1, k = entranceKeys(full).map(([t, p, e]) => [t / tp, p, e]);
      topts.contact = k[contactKey(full, k)][0] + (full.flash && full.in !== "choreo" ? TICK / tp : 0);
    }
  }
  if ( track && lay.letters.some((l) => l.link != null) ) topts.links = lay.letters.map((l) => l.link ?? null);   // LOOK3
  const tl = track ? trackTimeline(chars.length, motion, R, topts) : buildTimeline(chars.length, mood, sound, hand, R, topts);
  /* legacy style: flash: false keeps the timing, the accent picture shows the word (like the photosensitivity guard's unflash) */
  if ( !track && opts.flash === false ) for ( const p of [...tl.ent, ...tl.hold, ...tl.exit] ) if ( p.impact ) p.impact = false;
  const holdMs = Math.max(0, (opts.hold ?? (track ? motion.holdMs : MOODS[mood].hold_ms * (0.85 + 0.4 * sound.long))) / (opts.tempo || 1));
  /* frame rate (move.mjs): ones / twos / threes for this word; motion of a travelling word steps on the same grid */
  const on = opts.reduced ? 0 : onOf(opts);
  const Rm = rng((seed ^ 0x68e31da4) >>> 0), seed2 = () => Rm.seed();   // MOVE's generator (named apart from LOOK's R2)
  if ( on && !track ) retime(tl, on, seed2);   // MOTION2: a track word's grid is `on` ticks (the engine), its pictures stay few
  const mk = (ticks) => { const p = pic(chars.length, ticks); p.misreg = tl.tech.misreg; p.boil = seed2(); return p; };
  if ( groups ) {
    tl.ent = choreoEntrance(groups, lay, seed, (n, Rg, kind) => buildTimeline(n, mood, sound, hand, Rg, { ...topts, in: kind ?? opts.in ?? (track ? "pop" : tl.kinds.in) }), mk, { on });
    tl.kinds.choreo = groups[0].type ? "typeOn" : "parts";
  }
  const counted = !opts.reduced && opts.countIn ? countFrames(chars, opts, seed, mk, on || 2) : null;
  if ( counted ) { tl.ent = [...counted, ...tl.ent]; tl.kinds.choreo = "countIn"; }
  /* LOOK2 (P5): the book prints clean: no colour plates off register in the Invincible hand (kept in expressive) */
  if ( hand.style === "invincible" ) { tl.tech.misreg = 0; for ( const q of [...tl.ent, ...tl.hold, ...tl.exit] ) q.misreg = 0; }
  /* the backdrop (opt-in) comes in with the word and leaves before it: its scale per picture (after MOVE's retiming / choreography,
     which replace pictures) */
  for ( const [j, q] of tl.ent.entries() ) q.backS = j === 0 && tl.ent.length > 2 ? 0.55 : 1;
  for ( const q of tl.hold ) q.backS = 1;
  for ( const [j, q] of tl.exit.entries() ) q.backS = Math.max(0, 1 - (j + 1) / tl.exit.length) * (j === 0 ? 1.06 : 1);
  /* stacked lines and columns: the cap height shrinks so the block, not one line, gets the word's size */
  const nl = lay.lines?.length ?? 1;
  const blockK = lay.arrange === "vertical" ? 0.62 : 1 / (1 + 0.3 * (nl - 1));
  const plan = { v: 1, word, chars, mood, sound, seed, hand, layout: lay, timeline: tl, holdMs, dir, loud: sound.loud, accent, character, traits,
    sizeK: (0.62 + 0.7 * sound.loud) * blockK };
  if ( on && on !== 2 ) plan.on = on;   // twos = the default timing (no change to the plan)
  if ( motion ) plan.motion = motion;
  plan.contactMs = contactOf(tl, motion);
  if ( groups ) plan.groups = groups.map((g) => ({ from: g.from, to: g.to, at: g.at, scale: g.scale, body: !!g.body }));
  if ( opts.hollow ) plan.hollow = true;
  return plan;
}

/* LOOK: a number (a damage count, "-1", "+4", "x3") is read, not felt: a misread digit is a wrong number. It keeps the hand's font,
   colours and outline, but stands upright-ish (calm tilt), whole (no edge treatment, no texture over the strokes, no prefix shrink,
   no tucked overlap) and even in size. Whatever the caller pinned in opts.look still wins. */
export const NUMBER_RE = /^[+\-−±xX×]?\s?\d[\d\s.,]*[%!]*$/u;
function numberHand(hand, look) {
  if ( look.treat == null && hand.treat !== "bubble" ) hand.treat = "plain";
  if ( look.env == null && ["tumble", "zig", "split", "stairUp", "stairDown"].includes(hand.env) ) hand.env = "flat";
  if ( look.tex == null ) hand.tex = "none";
  if ( look.tilt == null ) { hand.tiltKind = "calm"; hand.tilt = Math.min(hand.tilt ?? 4, 4); hand.bob = 0.015; }
  if ( look.prefix == null ) hand.prefix = 0;
  if ( look.overlap == null ) { hand.track = Math.max(hand.track, 0.02); if ( hand.stack === "merge" ) hand.stack = "stack"; }
  if ( look.counters == null ) hand.counters = "none";
  hand.contrast = 1;
  hand.number = true;
  hand.id = [hand.font, hand.treat, hand.env, hand.colorFam, hand.outline, hand.fill].join("/");
}

/* LOOK: the caller's choices of look (opts.look, opts.backdrop): each wins over the seed's pick; unknown values are ignored.
   The backdrop is OFF unless asked for: backdrop true / "auto" = the mood's pick for this seed, or a kind by name. */
const LOOK_KEYS = {
  fill: FILLS, tex: TEXTURES, counters: ["none", "ink", "color"], order: ["left", "right"], treat: ["plain", "jag", "rough", "bubble", "drip", "flame"],
  env: ["arc", "fan", "sag", "bulge", "wave", "zig", "persp", "slant", "split", "streak", "stairUp", "stairDown", "swell", "shrink", "tumble", "flat"],
  warp2: ["arc", "persp", "bulge", "fan", "none"], stack: ["stack", "merge"], outline: ["ink", "sticker", "color", "inner"]
};
const TILTS = { calm: [4.5, 0.02], lively: [12, 0.055], wild: [21, 0.095] };
export function applyLook(hand, opts = {}) {
  const L = opts.look && typeof opts.look === "object" ? opts.look : {};
  for ( const [k, vals] of Object.entries(LOOK_KEYS) ) if ( typeof L[k] === "string" && vals.includes(L[k]) ) hand[k] = L[k];
  if ( hand.warp2 === "none" ) hand.warp2 = null;
  if ( L.outline === "ink" ) hand.out2W = 0; else if ( L.outline && !hand.out2W ) hand.out2W = 0.065;
  if ( typeof L.font === "string" && Object.hasOwn(FONTS, L.font) ) hand.font = L.font;
  if ( L.capFont === false ) hand.capFont = null; else if ( typeof L.capFont === "string" && Object.hasOwn(FONTS, L.capFont) ) hand.capFont = L.capFont;
  if ( Number.isFinite(L.tilt) ) { hand.tilt = Math.max(0, Math.min(40, L.tilt)); hand.bob = 0.004 * hand.tilt; }
  else if ( Object.hasOwn(TILTS, String(L.tilt)) ) { hand.tiltKind = L.tilt; [hand.tilt, hand.bob] = TILTS[L.tilt]; }
  if ( L.prefix === false ) hand.prefix = 0; else if ( Number.isFinite(L.prefix) ) hand.prefix = Math.max(0.25, Math.min(1, L.prefix));
  if ( Number.isFinite(L.overlap) ) { hand.track = Math.max(-0.18, Math.min(0.1, -L.overlap)); if ( L.overlap > 0.08 ) hand.stack = "stack"; }
  if ( L.shadow === "none" ) hand.shadow = null;
  else if ( ["drop", "cast", "long"].includes(L.shadow) ) {
    hand.shadow = { ang: hand.shadow?.ang ?? 0.3 * Math.PI, a: hand.shadow?.a ?? 0.4, d: L.shadow === "drop" ? 0.1 : (hand.shadow?.cast ? hand.shadow.d : 0.27) };
    if ( L.shadow !== "drop" ) { hand.shadow.cast = true; hand.shadow.long = L.shadow === "long"; }
  }
  const b = opts.backdrop ?? L.backdrop;
  hand.back = b === true || b === "auto" ? hand.backPick ?? "star" : (typeof b === "string" && BACKDROPS.includes(b) ? b : null);
  if ( opts.legible === false || L.legible === false ) hand.legible = false;
  if ( typeof L.link === "boolean" ) hand.link = L.link;
  /* on the map (busy ground, no backdrop by default) an ink-only outline gets a thin light keyline outside it, so the word separates
     from dark and light ground alike */
  if ( opts.space === "world" && !hand.back && hand.outline === "ink" && !hand.out2W && hand.style !== "invincible" ) { hand.out2W = 0.035; hand.pal = { ...hand.pal, out2: "#fffaf0" }; hand.keyline = true; }
  hand.id = [hand.font, hand.treat, hand.env, hand.colorFam, hand.outline, hand.fill].join("/");
  return hand;
}

/* FXLE F12: lines of a word with "\n": each line is laid out by the hand like a word of its own, centred under the widest line, one
   line height (the biggest letter of the line above, plus a little lead) further down; the envelope warps the whole block */
export function stackLines(lay, chars, hand) {
  if ( !chars.includes("\n") ) return lay;
  const lines = [[]];
  lay.letters.forEach((l, i) => { if ( chars[i] === "\n" ) lines.push([]); else lines.at(-1).push(l); });
  const widthOf = (ls) => (ls.length ? ls.at(-1).x + ls.at(-1).w - ls[0].x : 0);
  const W = Math.max(0.3, ...lines.map(widthOf));
  let dy = 0;
  lines.forEach((ls, k) => {
    if ( k > 0 ) dy += 1.12 * Math.max(1, ...lines[k - 1].map((l) => l.s)) + 0.08;
    const x0 = ls[0]?.x ?? 0, off = (W - widthOf(ls)) / 2;
    for ( const l of ls ) { l.x = l.x - x0 + off; l.dy += dy; }
  });
  /* the "\n" itself: no glyph, kept in place so per-letter animation stays aligned */
  lay.letters.forEach((l, i) => { if ( chars[i] === "\n" ) { l.x = 0; l.w = 0; } });
  lay.W = W; lay.E.W = W;
  void hand;
  return lay;
}

/* FXLE F18: a hand given as its id string ("font/treat/env/colorFam/outline/fill", a handle's `hand`): the known fields of the id
   replace the chosen hand's (a palette of the id's colour family when it differs) */
function handFromId(id, chosen) {
  const [font, treat, env, colorFam, outline, fill] = String(id).split("/");
  const known = (v, set) => v && set.has(v);
  const all = (k) => new Set(Object.values(MOODS).flatMap((m) => Object.keys(m[k] ?? {})));
  const h = { ...chosen, pal: { ...chosen.pal, fill: chosen.pal.fill.slice() } };
  if ( known(font, new Set(Object.keys(FONTS))) ) h.font = font;
  if ( known(treat, all("treat")) ) h.treat = treat;
  if ( known(env, all("env")) ) h.env = env;
  if ( known(outline, new Set(["ink", "sticker", "color", "inner"])) ) h.outline = outline;
  if ( known(fill, new Set(["vgrad", "split", "hgrad", "letters", "radial", "flat"])) ) h.fill = fill;
  if ( colorFam !== chosen.colorFam && Object.hasOwn(COLORS, colorFam ?? "") ) {
    const R = rng(hash(String(id))), pal = R.pick(COLORS[colorFam]);
    h.colorFam = colorFam; h.pal = { ...pal, fill: pal.fill.slice(), out2: R.pick(pal.out2) }; h.ink = pal.ink;
  }
  if ( h.outline === "ink" ) h.out2W = 0; else if ( !h.out2W ) h.out2W = 0.065;
  h.id = [h.font, h.treat, h.env, h.colorFam, h.outline, h.fill].join("/");
  return h;
}

/* a stream's syllables: "RA-TA-TA" splits on - and spaces; "RATATATA" splits after each vowel run */
export function syllablesOf(text) {
  const t = String(text ?? "").toLocaleUpperCase("pl").trim();
  if ( /[-\s]/.test(t) ) return t.split(/[-\s]+/).filter(Boolean);
  const m = t.match(/[^AEIOUYĄĘÓ!?…]*[AEIOUYĄĘÓ]+[!?…]*/g);
  if ( !m?.length ) return [t];
  const rest = t.slice(m.join("").length);   // trailing consonants (BZZT) stay on the last syllable
  if ( rest ) m[m.length - 1] += rest;
  return m;
}
