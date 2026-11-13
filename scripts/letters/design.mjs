/* LETR: from (word, intent) to a plan. Pure and deterministic for a given seed: no DOM, no Foundry.
   The plan says which "hand" letters the word (font, letter treatment, outline, fill, texture, 3D), how the word is laid out and
   warped, and the timeline of pictures (entrance, hold, exit) on a 24 fps clock. paint.mjs turns one picture of a plan into pixels.

   Intent -> shape follows the craft notes in README.md ("How the shape shows the sound"): size = loudness, the loudest part of the
   word is the biggest, jagged = sharp/harsh, round = soft/blunt, long sounds stretch and repeat letters, rising pitch climbs, falling
   pitch sags, the word grows away from where the sound comes from, warm colours for fire, cool for air and water. */
import { rng, hash } from "./rng.mjs";

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
  patrick:  { file: "fonts/patrickhand/PatrickHand-Regular.ttf", weight: 0.25, sharp: 0.05, track: 0.02, slant: 0.06 }
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
    tex: { halftone: 2, none: 2, speckle: 0.6, speed: 0.4 }, in: { slam: 3, pop: 2 }, hold: { shake: 2, boil: 2 }, out: { shatter: 2, pop: 2 }, hold_ms: 900, fx: { burst: 0.7 } },
  crack: { label: "breaking, snapping, cracking", sound: { loud: 0.7, sharp: 1, long: 0.1, pitch: 0, rough: 0.6, peak: 0.05 },
    fonts: { blackops: 2, bangers: 2, anton: 2, bungee: 1 }, treat: { jag: 4, plain: 1 },
    env: { split: 3, slant: 2, persp: 1, fan: 1 }, colors: { ice: 2, bone: 2, punch: 1, stone: 2 },
    tex: { cracks: 4, none: 0.5 }, in: { crackIn: 3, slam: 1 }, hold: { shake: 2, boil: 1 }, out: { shatter: 4 }, hold_ms: 800, fx: { burst: 0.4 } },
  crash: { label: "collapse, rubble, crash", sound: { loud: 0.9, sharp: 0.5, long: 0.6, pitch: -0.6, rough: 0.8, peak: 0.3 },
    fonts: { anton: 2, bungee: 2, blackops: 2, bangers: 1.5, sigmar: 1 }, treat: { rough: 3, jag: 1.5, plain: 1 },
    env: { tumble: 3, stairDown: 2, persp: 1 }, colors: { stone: 3, earth: 3, rust: 2 },
    tex: { speckle: 3, cracks: 1.5, halftone: 1 }, in: { drop: 4, slam: 1 }, hold: { rattle: 3, shake: 1 }, out: { fall: 4 }, hold_ms: 1100, fx: { dust: 0.8 } },
  boom: { label: "explosion, blast", sound: { loud: 1, sharp: 0.4, long: 0.5, pitch: 0, rough: 0.4, peak: 0.5 },
    fonts: { titan: 3, sigmar: 3, bangers: 2, bungee: 1 }, treat: { plain: 3, bubble: 2, rough: 1 },
    env: { fan: 3, bulge: 3, arc: 1 }, colors: { hot: 5, toxic: 1 },
    tex: { halftone: 2, none: 1.5, speckle: 1 }, in: { slam: 3, pop: 1 }, hold: { throb: 2, shake: 2 }, out: { burst: 3, shatter: 1 }, hold_ms: 1000, fx: { burst: 1 } },
  roar: { label: "roar, growl, scream of a beast", sound: { loud: 0.85, sharp: 0.55, long: 0.9, pitch: 0.2, rough: 0.8, peak: 0.9 },
    fonts: { knewave: 3, bangers: 2, anton: 1, blackops: 1 }, treat: { jag: 2.5, rough: 2.5 },
    env: { swell: 4, fan: 1, wave: 1 }, colors: { beast: 3, punch: 1, toxic: 2 },
    tex: { speckle: 2, none: 1, halftone: 1 }, in: { grow: 4 }, hold: { rattle: 2, shake: 2 }, out: { shrink: 2, shatter: 1 }, hold_ms: 1400, fx: {} },
  fire: { label: "flames, burning, whoosh of fire", sound: { loud: 0.55, sharp: 0.35, long: 0.8, pitch: 0.6, rough: 0.5, peak: 0.6 },
    fonts: { knewave: 2.5, bangers: 2, sigmar: 1.5, titan: 1 }, treat: { flame: 4, rough: 1 },
    env: { wave: 3, arc: 2, swell: 1 }, colors: { hot: 4, ember: 3 },
    tex: { none: 2, speckle: 1 }, in: { rise: 4, pop: 1 }, hold: { flicker: 5 }, out: { rise: 4 }, hold_ms: 1400, fx: { embers: 0.8 } },
  whoosh: { label: "fast motion, wind, swing", sound: { loud: 0.5, sharp: 0.2, long: 0.8, pitch: 0, rough: 0.2, peak: 0.85 },
    fonts: { bangers: 3, knewave: 2, anton: 1.5, sigmar: 1 }, treat: { plain: 3, rough: 1 },
    env: { streak: 4, swell: 1.5, shrink: 1.5 }, colors: { air: 4, pop: 1, ice: 1 },
    tex: { speed: 4, none: 1 }, in: { zip: 5 }, hold: { boil: 3 }, out: { zipout: 5 }, hold_ms: 800, fx: { speed: 1 } },
  zap: { label: "electricity, energy blast, laser", sound: { loud: 0.65, sharp: 1, long: 0.35, pitch: 0.3, rough: 0.3, peak: 0.5 },
    fonts: { blackops: 2, bangers: 2, bungee: 2, anton: 1 }, treat: { jag: 4, plain: 1 },
    env: { zig: 4, slant: 1 }, colors: { volt: 4, plasma: 3 },
    tex: { none: 2, halftone: 1 }, in: { pop: 3, slam: 1 }, hold: { buzz: 5 }, out: { dissolve: 3, pop: 1 }, hold_ms: 900, fx: { sparks: 1 } },
  tick: { label: "small sound: click, tap, beep", sound: { loud: 0.12, sharp: 0.6, long: 0, pitch: 0, rough: 0, peak: 0.5 },
    fonts: { bangers: 2, patrick: 2, bungee: 1, titan: 1 }, treat: { plain: 3, bubble: 1 },
    env: { slant: 3, flat: 2 }, colors: { soft: 3, pop: 1 },
    tex: { none: 4 }, in: { pop: 4 }, hold: { boil: 3 }, out: { dissolve: 3, pop: 1 }, hold_ms: 500, fx: {} },
  pain: { label: "hurt, wound, cry of pain", sound: { loud: 0.65, sharp: 0.6, long: 0.45, pitch: -0.5, rough: 0.6, peak: 0.25 },
    fonts: { wetpaint: 2.5, knewave: 2, bangers: 2, anton: 1 }, treat: { drip: 3, jag: 1.5, rough: 1.5 },
    env: { sag: 3, wave: 1.5, tumble: 1 }, colors: { blood: 4, bruise: 2 },
    tex: { speckle: 1.5, none: 2 }, in: { slam: 2, pop: 2 }, hold: { wobble: 3, shake: 1 }, out: { fall: 3, droop: 2 }, hold_ms: 1000, fx: {} },
  powerup: { label: "charging, rising power, transformation", sound: { loud: 0.75, sharp: 0.3, long: 0.8, pitch: 1, rough: 0.2, peak: 1 },
    fonts: { sigmar: 2, titan: 2, bungee: 2, bangers: 2 }, treat: { plain: 3, bubble: 1.5 },
    env: { stairUp: 3, swell: 2, arc: 1.5 }, colors: { plasma: 3, gold: 3, volt: 1 },
    tex: { halftone: 2, rays: 2, none: 1 }, in: { rise: 2, grow: 3 }, hold: { throb: 4 }, out: { rise: 4 }, hold_ms: 1300, fx: { rays: 0.6 } },
  heal: { label: "healing, relief, soft glow", sound: { loud: 0.3, sharp: 0, long: 0.55, pitch: 0.5, rough: 0, peak: 0.5 },
    fonts: { titan: 3, patrick: 3, sigmar: 1 }, treat: { bubble: 4, plain: 1 },
    env: { arc: 3, wave: 2 }, colors: { mint: 4, gold: 1 },
    tex: { none: 3, halftone: 1 }, in: { rise: 3, pop: 2 }, hold: { throb: 2, boil: 2 }, out: { rise: 3, dissolve: 2 }, hold_ms: 1100, fx: {} },
  splash: { label: "water, splash, goo, squelch", sound: { loud: 0.55, sharp: 0.15, long: 0.4, pitch: -0.2, rough: 0.2, peak: 0.4 },
    fonts: { wetpaint: 3, titan: 2, sigmar: 1, patrick: 1 }, treat: { drip: 3, bubble: 2 },
    env: { wave: 3, bulge: 2, fan: 1 }, colors: { water: 4, toxic: 1 },
    tex: { none: 2, halftone: 1 }, in: { pop: 3, slam: 1 }, hold: { wobble: 2, boil: 2 }, out: { fall: 3, dissolve: 1 }, hold_ms: 1000, fx: { droplets: 0.8 } },
  fail: { label: "miss, flop, deflating", sound: { loud: 0.25, sharp: 0.1, long: 0.45, pitch: -1, rough: 0.2, peak: 0 },
    fonts: { patrick: 3, titan: 2, bangers: 1 }, treat: { bubble: 3, rough: 1.5, plain: 1 },
    env: { sag: 3, stairDown: 2, shrink: 2 }, colors: { dull: 4 },
    tex: { none: 3, speckle: 1 }, in: { drop: 2, pop: 2 }, hold: { wobble: 3 }, out: { droop: 3, fall: 2 }, hold_ms: 900, fx: {} }
};
export const MOOD_IDS = Object.keys(MOODS);

/* ---------- colour families: [light, mid, dark] fills, extrusion, outline-2 options, ink ---------- */
const C = (fill, ext, out2, ink = "#1b1020") => ({ fill, ext, out2, ink });
export const COLORS = {
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
export function chooseHand(mood, sound, R, avoid) {
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
  const outline = R.w({ ink: 2, sticker: 3, color: pal.out2.some((c) => c !== "#ffffff") ? 2 : 0.5, inner: 1.5 });
  const fill = R.w({ vgrad: 4, split: 1.5, hgrad: 1.5, letters: sound.long > 0.6 ? 2.5 : 1, radial: mood === "boom" ? 3 : 0.8, flat: 0.6 });
  const stack = R.w({ stack: F.sharp > 0.6 ? 2 : 3, merge: 2 });
  const depthOn = R.chance(0.35 + 0.5 * sound.loud);
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
    bevel: R.chance(0.35),
    shear: (F.slant + R.f(-0.06, 0.16)) * (mood === "whoosh" ? 2.2 : 1),
    track: F.track + R.f(-0.05, 0.02) - 0.04 * sound.loud,
    hueJitter: R.f(-14, 14)
  };
  if ( mood === "tick" ) { hand.depth = 0; hand.shadow = hand.shadow && { ...hand.shadow, d: 0.06 }; hand.out2W = Math.min(hand.out2W, 0.05); }
  hand.id = [font, treat, env, colorFam, outline, fill].join("/");
  return hand;
}

/* ---------- layout: letters placed and sized; envelope warp params ---------- */
export function layoutPlan(chars, widths, mood, sound, hand, R) {
  const n = chars.length;
  /* size curve: the loudest part of the word is the biggest (Comicraft's rule), peak from the sound */
  const amp = 0.18 + 0.5 * sound.loud * (hand.env === "flat" ? 0.3 : 1);
  const sizes = [];
  for ( let i = 0; i < n; i++ ) {
    const u = n > 1 ? i / (n - 1) : 0.5;
    let s = 1 + amp * Math.exp(-((u - sound.peak) ** 2) / 0.09) - amp * 0.35;
    if ( hand.env === "swell" ) s = 0.55 + 0.75 * u ** 1.2;
    if ( hand.env === "shrink" ) s = 1.25 - 0.7 * u ** 0.9;
    if ( hand.env === "streak" ) s = 0.6 + 0.6 * u;
    s *= 1 + R.f(-0.07, 0.07) * (0.6 + sound.rough);
    if ( chars[i] === "!" || chars[i] === "?" ) s *= 1.05;
    sizes.push(s);
  }
  const letters = [];
  let x = 0;
  const split = hand.env === "split" ? Math.max(1, Math.min(n - 1, Math.round(n * R.f(0.35, 0.6)))) : -1;
  for ( let i = 0; i < n; i++ ) {
    const s = sizes[i];
    const w = widths[i] * s;
    const rot = (R.f(-1, 1) * (3 + 7 * sound.rough) + (hand.env === "tumble" ? R.f(-1, 1) * 16 : 0)) * Math.PI / 180;
    let dy = R.f(-1, 1) * (0.03 + 0.07 * sound.rough);
    if ( hand.env === "stairUp" ) dy -= i * 0.22;
    if ( hand.env === "stairDown" ) dy += i * 0.16;
    if ( hand.env === "tumble" ) dy += R.f(-0.12, 0.12) + i * 0.05;
    let gx = 0;
    if ( i === split ) gx = R.f(0.18, 0.32);
    x += gx;
    letters.push({ ch: chars[i], x, w, s, rot, dy: dy + (i >= split && split > 0 ? R.f(0.1, 0.22) * (R.chance(0.5) ? 1 : -1) * 0 : 0), splitSide: split > 0 && i >= split ? 1 : 0 });
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
  return { letters, E, W };
}

/* point warp of the envelope, in word space (x along the word in [0, W], baseline y = 0, cap top y = -1) */
export function envelope(E) {
  const W = E.W, cy = -0.5;
  const polar = (ang) => {
    const R0 = W / ang;
    return (x, y) => {
      const th = (x - W / 2) / R0, d = -(y - cy), rho = R0 + d;
      return [W / 2 + rho * Math.sin(th), cy + R0 - rho * Math.cos(th)];
    };
  };
  let f;
  switch ( E.kind ) {
    case "arc": case "fan": case "sag": f = Math.abs(E.ang) > 0.01 ? polar(E.ang) : null; break;
    case "bulge": f = (x, y) => { const u = x / W, k = 1 + E.b * Math.sin(Math.PI * Math.max(0, Math.min(1, u))); return [x, cy + (y - cy) * k]; }; break;
    case "wave": f = (x, y) => [x, y + E.a * Math.sin(6.283 * (E.f * x / W) + E.ph)]; break;
    case "zig": f = (x, y) => { const t = (E.f * x / W) % 1; return [x, y + E.a * (Math.abs(t * 4 - 2) - 1)]; }; break;
    case "persp": case "streak": f = (x, y) => { const u = x / W, k = E.k0 + (E.k1 - E.k0) * u; return [x, cy + (y - cy) * k]; }; break;
    default: f = null;
  }
  const rot = E.rot ?? 0, c = Math.cos(rot), s = Math.sin(rot);
  return (x, y) => {
    let p = f ? f(x, y) : [x, y];
    const dx = p[0] - W / 2, dy = p[1] - cy;
    return [W / 2 + dx * c - dy * s, cy + dx * s + dy * c];
  };
}

/* ---------- timeline: entrance, hold, exit pictures ---------- */
const L0 = () => ({ v: 1, x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1 });
function pic(n, ticks, g = {}, per = null) {
  const letters = []; for ( let i = 0; i < n; i++ ) letters.push({ ...L0(), ...(per ? per(i) : {}) });
  return { ticks, g: { x: 0, y: 0, r: 0, s: 1, sx: 1, sy: 1, ...g }, letters, boil: 0, fx: [], dissolve: 0 };
}

export function buildTimeline(n, mood, sound, hand, R, o = {}) {
  const M = MOODS[mood];
  const reduced = !!o.reduced;
  const ein = o.in ?? R.w(M.in), ehold = o.holdKind ?? R.w(M.hold), eout = o.out ?? R.w(M.out);
  const T = (t) => Math.max(1, Math.round(t * (o.tempo ? 1 / o.tempo : 1)));
  const ent = [], hold = [], exit = [];
  const seeds = () => R.seed();
  const stag = (k) => Math.max(1, Math.ceil(n / k));
  /* entrances */
  if ( reduced ) ent.push(pic(n, T(3), { s: 0.92 }));
  else switch ( ein ) {
    case "slam":
      ent.push(pic(n, T(2), { s: 1.55, sx: 1.05 }, () => ({})));
      ent.push(pic(n, T(2), { s: 0.88, x: 0.05 }));
      ent.push(pic(n, T(2), { s: 1.06, x: -0.04 }));
      ent[0].fx.push({ k: "speed", a: 0.6, seed: seeds() });
      ent[1].fx.push({ k: "burst", a: 1, seed: seeds() });
      ent[2].fx.push({ k: "burst", a: 0.6, seed: seeds() });
      break;
    case "pop":
      ent.push(pic(n, T(2), { s: 0.4, r: R.f(-0.15, 0.15) }));
      ent.push(pic(n, T(2), { s: 1.18 }));
      ent.push(pic(n, T(2), { s: 0.95 }));
      if ( M.fx?.burst || M.fx?.sparks ) ent[1].fx.push({ k: M.fx.sparks ? "sparks" : "burst", a: 0.7, seed: seeds() });
      break;
    case "crackIn": {
      const off = []; for ( let i = 0; i < n; i++ ) off.push({ x: R.f(-0.35, 0.35), y: R.f(-0.3, 0.3), r: R.f(-0.4, 0.4) });
      ent.push(pic(n, T(2), { s: 1.12 }, (i) => ({ x: off[i].x, y: off[i].y, r: off[i].r })));
      ent.push(pic(n, T(2), { s: 1.04 }, (i) => ({ x: off[i].x * 0.3, y: off[i].y * 0.3, r: off[i].r * 0.3 })));
      ent[1].fx.push({ k: "burst", a: 0.8, seed: seeds() });
      break;
    }
    case "drop": {
      const k = stag(4), steps = Math.ceil(n / k) + 3;
      for ( let s = 0; s < steps; s++ ) ent.push(pic(n, T(2), {}, (i) => {
        const t = s - Math.floor(i / k);
        if ( t < 0 ) return { v: 0 };
        return [{ y: -2.4, sy: 1.15, sx: 0.9 }, { y: -0.9, sy: 1.1, sx: 0.92 }, { y: 0.06, sy: 0.78, sx: 1.18 }, { y: -0.12, sy: 1.04 }][Math.min(3, t)] ?? {};
      }));
      ent[ent.length - 2].fx.push({ k: "dust", a: 0.8, seed: seeds() });
      break;
    }
    case "rise": {
      const k = stag(5), steps = Math.ceil(n / k) + 2;
      for ( let s = 0; s < steps; s++ ) ent.push(pic(n, T(2), {}, (i) => {
        const t = s - Math.floor(i / k);
        if ( t < 0 ) return { v: 0 };
        return [{ y: 1.1, s: 0.6 }, { y: 0.35, s: 0.9 }, { y: -0.08, s: 1.05 }][Math.min(2, t)] ?? {};
      }));
      break;
    }
    case "grow": {
      const k = stag(5), steps = Math.ceil(n / k) + 2;
      for ( let s = 0; s < steps; s++ ) ent.push(pic(n, T(2), { x: R.f(-0.04, 0.04), y: R.f(-0.04, 0.04) }, (i) => {
        const t = s - Math.floor(i / k);
        if ( t < 0 ) return { v: 0 };
        return [{ s: 0.45 }, { s: 1.2 }, { s: 1 }][Math.min(2, t)];
      }));
      break;
    }
    case "zip": {
      const dir = o.dir ?? 1;
      ent.push(pic(n, T(2), { x: -2.6 * dir, sx: 1.7, sy: 0.82 }));
      ent.push(pic(n, T(2), { x: 0.35 * dir, sx: 1.25, sy: 0.92 }));
      ent.push(pic(n, T(2), { x: -0.08 * dir, sx: 0.94 }));
      ent[0].fx.push({ k: "speed", a: 1, dir, seed: seeds() });
      ent[1].fx.push({ k: "speed", a: 0.7, dir, seed: seeds() });
      break;
    }
    default: ent.push(pic(n, T(2), { s: 0.9 }));
  }
  /* hold: 3 or 4 redrawn pictures on threes, cycled */
  const holdN = ehold === "flicker" || ehold === "buzz" ? 4 : 3;
  for ( let i = 0; i < holdN; i++ ) {
    const p = pic(n, T(ehold === "buzz" ? 2 : 3));
    p.boil = seeds();
    if ( !reduced ) switch ( ehold ) {
      case "shake": p.g.x = R.f(-0.05, 0.05) * (1 + sound.loud); p.g.y = R.f(-0.04, 0.04) * (1 + sound.loud); break;
      case "throb": p.g.s = [1, 1.045, 0.99, 1.02][i]; break;
      case "rattle": p.letters.forEach((l) => { l.x = R.f(-0.03, 0.03); l.y = R.f(-0.04, 0.04); l.r = R.f(-0.05, 0.05); }); break;
      case "wobble": p.letters.forEach((l, j) => { l.r = 0.06 * Math.sin(i * 2.1 + j); l.y = 0.03 * Math.cos(i * 2.1 + j); }); break;
      case "buzz": p.g.x = R.f(-0.03, 0.03); p.reseed = true; p.fx.push({ k: "sparks", a: 0.6, seed: seeds() }); break;
      case "flicker": p.reseed = true; p.g.y = -0.02 * i; if ( M.fx?.embers ) p.fx.push({ k: "embers", a: 0.7, seed: seeds() }); break;
      default: break;
    }
    if ( ehold !== "buzz" && ehold !== "flicker" && M.fx?.speed && i === 0 ) p.fx.push({ k: "speed", a: 0.35, dir: o.dir ?? 1, seed: seeds() });
    hold.push(p);
  }
  /* exits */
  const fly = []; for ( let i = 0; i < n; i++ ) { const u = n > 1 ? i / (n - 1) - 0.5 : R.f(-0.5, 0.5); fly.push({ x: u * R.f(1.2, 2.2) + R.f(-0.3, 0.3), y: R.f(-1, 0.4), r: R.f(-1, 1) }); }
  if ( reduced ) exit.push(pic(n, T(3), {}, () => ({})), pic(n, T(2))), exit[0].dissolve = 0.5, exit[1].dissolve = 0.85;
  else switch ( eout ) {
    case "shatter":
      [0.25, 0.6, 1].forEach((t, j) => { const p = pic(n, T(2), {}, (i) => ({ x: fly[i].x * t, y: fly[i].y * t + 0.5 * t * t, r: fly[i].r * t, s: 1 - 0.35 * t })); p.dissolve = [0, 0.3, 0.7][j]; p.fx.push({ k: "debris", a: 1 - 0.3 * j, t, seed: seeds() }); exit.push(p); });
      break;
    case "pop":
      exit.push(pic(n, T(2), { s: 1.1 }), pic(n, T(2), { s: 1.18 }));
      exit[1].dissolve = 0.6; exit[1].fx.push({ k: "burst", a: 0.9, seed: seeds() });
      break;
    case "burst":
      exit.push(pic(n, T(2), { s: 1.1 }), pic(n, T(2), { s: 1.28 }), pic(n, T(2), { s: 1.35 }));
      exit[1].fx.push({ k: "puff", a: 0.9, t: 0.4, seed: seeds() }); exit[2].fx.push({ k: "puff", a: 0.6, t: 0.8, seed: seeds() });
      exit[1].dissolve = 0.35; exit[2].dissolve = 0.8;
      break;
    case "fall": {
      const k = stag(4), steps = Math.ceil(n / k) + 3;
      for ( let s = 0; s < steps; s++ ) { const p = pic(n, T(2), {}, (i) => { const t = s - Math.floor(i / k); if ( t < 0 ) return {}; return { y: 0.25 * t * t + 0.1 * t, r: fly[i].r * 0.25 * t, x: fly[i].x * 0.08 * t }; }); p.dissolve = Math.max(0, (s - steps + 2) * 0.4); exit.push(p); }
      break;
    }
    case "droop":
      exit.push(pic(n, T(3), { r: 0.04 }, (i) => ({ y: 0.06 * i / n, r: 0.08 }))); exit.push(pic(n, T(3), { r: 0.08, y: 0.25 }, (i) => ({ y: 0.25 * i / n, r: 0.18 })));
      exit.push(pic(n, T(2), { r: 0.1, y: 0.8 }, () => ({ r: 0.25 }))); exit[2].dissolve = 0.6;
      break;
    case "rise":
      [0.3, 0.7, 1.15].forEach((t, j) => { const p = pic(n, T(2), { y: -0.45 * t, sy: 1 + 0.08 * t }, (i) => ({ y: -0.15 * t * Math.sin(i * 1.7), x: 0.04 * Math.sin(i + t * 3) })); p.dissolve = [0.2, 0.5, 0.8][j]; if ( M.fx?.embers ) p.fx.push({ k: "embers", a: 0.6, seed: seeds() }); exit.push(p); });
      break;
    case "shrink":
      [0.75, 0.5, 0.3].forEach((s, j) => { const p = pic(n, T(2), { s, y: -0.15 * (j + 1) }); p.dissolve = j === 2 ? 0.5 : 0; exit.push(p); });
      break;
    case "zipout": {
      const dir = o.dir ?? 1;
      exit.push(pic(n, T(2), { x: -0.15 * dir, sx: 0.92 }), pic(n, T(2), { x: 1.2 * dir, sx: 1.5, sy: 0.85 }), pic(n, T(2), { x: 3.4 * dir, sx: 1.9, sy: 0.75 }));
      exit[1].fx.push({ k: "speed", a: 1, dir: -dir, seed: seeds() }); exit[2].fx.push({ k: "speed", a: 0.7, dir: -dir, seed: seeds() }); exit[2].dissolve = 0.55;
      break;
    }
    default:
      [0.35, 0.65, 0.9].forEach((d) => { const p = pic(n, T(2)); p.dissolve = d; exit.push(p); });
  }
  /* the hold pictures carry the boil; entrance and exit pictures each get their own (every picture is a new drawing) */
  for ( const p of [...ent, ...exit] ) p.boil = seeds();
  return { ent, hold, exit, kinds: { in: ein, hold: ehold, out: eout } };
}

/* ---------- the whole plan ---------- */
export function makePlan(text, opts, fonts, memory) {
  const raw = String(text ?? "").normalize("NFC");
  const word = raw.toLocaleUpperCase("pl").replace(/\s+/g, " ").trim() || "?";
  let mood = opts.mood && opts.mood !== "auto" ? opts.mood : null;
  if ( mood && !MOODS[mood] ) mood = null;
  if ( !mood ) mood = opts.sound && !opts.mood ? nearestMood(opts.sound) : guessMood(word);
  const sound = soundOf(word, mood, opts.sound);
  const seed = opts.seed != null ? hash(`${opts.seed}`) : (Math.random() * 4294967296) >>> 0;
  const R = rng(seed);
  const avoid = { font: new Set(), env: new Set(), color: new Set(), treat: new Set() };
  for ( const h of [...(memory ?? []), ...(opts.avoid ?? [])] ) {
    const [f, t, e, c] = String(h).split("/");
    if ( f ) avoid.font.add(f); if ( e ) avoid.env.add(e); if ( c ) avoid.color.add(c); if ( t ) avoid.treat.add(t);
  }
  /* a caller may pin the hand of an earlier plan (a stream of syllables lettered by one hand); the rng still advances the same way */
  const chosen = chooseHand(mood, sound, R, avoid);
  const hand = opts.hand ? { ...chosen, ...JSON.parse(JSON.stringify(opts.hand)) } : chosen;
  if ( Array.isArray(opts.colors) && opts.colors.length ) {
    const cs = opts.colors.map(String);
    hand.pal.fill = [cs[0], cs[1] ?? cs[0], cs[2] ?? cs[1] ?? cs[0]];
  }
  /* where the sound comes from: the word grows away from it (Comicraft: letters grow as they move away from the source) */
  if ( Number.isFinite(opts.from) ) {
    const a = opts.from * Math.PI / 180, cx = Math.cos(a), sy = Math.sin(a);
    hand.env = cx < -0.35 ? "swell" : cx > 0.35 ? "shrink" : (sy > 0 ? "fan" : "sag");
    hand.id = [hand.font, hand.treat, hand.env, hand.colorFam, hand.outline, hand.fill].join("/");
  }
  const chars = [...word];
  const widths = chars.map((ch) => (ch === " " ? 0.32 : fonts.adv(hand.font, ch)));
  const lay = layoutPlan(chars, widths, mood, sound, hand, R);
  const dir = opts.dir ?? (R.chance(0.75) ? 1 : -1);
  const tl = buildTimeline(chars.length, mood, sound, hand, R, { reduced: opts.reduced, tempo: opts.tempo, dir, in: opts.in, out: opts.out, holdKind: opts.holdKind });
  const holdMs = Math.max(0, (opts.hold ?? MOODS[mood].hold_ms * (0.85 + 0.4 * sound.long)) / (opts.tempo || 1));
  return { v: 1, word, chars, mood, sound, seed, hand, layout: lay, timeline: tl, holdMs, dir, loud: sound.loud,
    sizeK: 0.62 + 0.7 * sound.loud };
}
