/* LETR impact frames, the pure part: what an impact IS (a few drawings on the engine's 24-tick clock), how one is chosen from the
   kind of blow, its strength and a seed, and what this client is allowed to see of it (photosensitivity, reduced motion).
   No DOM, no Foundry: the same call with the same seed gives the same plan on every client; only `safety()` differs per client. */
import { rng, hash } from "../rng.mjs";

export const TICK = 1000 / 24;
export const INK = "#0b0b10", PAPER = "#fffdf2";

/* ---------- the limits (stated in impact/README.md "Safety") ---------- */
export const LIMITS = {
  /* IMPACT4 (1.9.21, the owner: «jeden rzut i animacja na kilka minut»: an impact is a rare show the whole table watches): the strongest
     rungs are a short hand-animated cut of up to a second. Not a photosensitivity limit (those are the flash, area and red rows below,
     unchanged): a longer cut holds drawings and moves ink, it adds no flash */
  maxTicks: 24,          // an impact never lasts longer than this (1000 ms; 1.9.20: 12 = 500 ms), whatever a caller lists
  maxFrameTicks: 4,      // one drawing stays at most this long
  maxStopTicks: 8,       // hit-stop (the scene held still) per impact, in ticks (333 ms; 1.9.20: 4)
  fullPerImpact: 2,      // photosafe: FLASH drawings per impact (full-field frames AND drawings that change the scene's brightness)
  fullPerSec: 2,         // photosafe: flash drawings per rolling second on this client, counted in the SAME log as the words' flash frames
  windowMs: 1000,
  localArea: 0.2,        // the gentle variant (and a local change of the scene) stays inside a panel of at most this share of the viewport
  figArea: 0.025,        // IMPACT3: the figures' own art may change brightness (negative, posterised, inked) only while all of them together
                         // cover at most this share of the view (WCAG 2.3.1's small safe area is 21 824 px of 1024 x 768 = 2.78 %).
                         // IMPACT5 (1.9.23): no longer the rule on any seat (the gentle and still seats show rims only; ordinary seats: figAreaOpen)
  /* IMPACT5 (1.9.23, the owner on the 2.5 % limit for ordinary seats: «Poluzuj»): on an ORDINARY seat the figures (enlarged into a cut-in,
     their art negative / posterised / inked) may change the brightness of at most this share of the short side SQUARED (min(W, H)^2, never
     more than this share of the view) per drawing, counted at their largest possible size so every seat decides alike at any zoom. The
     scene's flash rationing (fullPerImpact, fullPerSec, redArea) is unchanged for everyone; photosensitive (gentle) seats keep the rims
     only and reduced-motion seats one still drawing, exactly as before */
  figAreaOpen: 0.25,
  cutMax: 0.44,          // IMPACT5: the cut-in's star figure is never drawn larger than this share of the view's short side (others: cutMaxOther)
  cutMaxOther: 0.16,
  redArea: 0.01,         // photosafe: saturated red covers at most this share of any drawing (WCAG 2.3.1 "red flash")
  punchMax: 0.022,       // the frame punch moves the scene by at most this share of the viewport (and never past its own zoom margin)
  chromaMax: 0.012,      // chromatic split: plate offset as a share of the viewport's short side
  galleryTicks: 48       // I.show(): a single frame held for looking at, at most this long (2 s)
};

/* ---------- colour pairs (accent, second accent); ink and paper are fixed ---------- */
export const TONES = {
  hero:  { a: "#ffd400", b: "#19a8ff" },   // the comic's yellow and blue
  fire:  { a: "#ff7a1a", b: "#ffd400" },
  blood: { a: "#e3202a", b: "#ffd400" },
  volt:  { a: "#19c3ff", b: "#fff36b" },
  toxic: { a: "#8fe01f", b: "#ffd400" },
  void:  { a: "#7258ff", b: "#19c3ff" },   // ENGPINK 1.9.22: blue-violet (was #b04cff, in the pink band; the lettering violet)
  dust:  { a: "#e9c98a", b: "#ffffff" }
};
/* saturated red (WCAG 2.3.1 counts R / (R + G + B) >= 0.8 as saturated red; the guard is stricter: 0.7, plus the bright reds of the
   first build). Under the guard such a colour is drawn as SAFE_RED, a deep crimson under the line (0.63), so blood stays blood. */
const RED = /^#(e|f)[0-9a-f][0-4][0-9a-f][0-4][0-9a-f]$/i;
export const SAFE_RED = "#b02840";
function rgbOf(c) {
  const s = String(c ?? "").trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if ( m ) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if ( m ) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if ( m ) return [m[1], m[2], m[3]].map(Number);
  return null;
}
export function isRed(c) {
  if ( RED.test(String(c ?? "")) ) return true;
  const v = rgbOf(c);
  if ( !v ) return false;
  const sum = v[0] + v[1] + v[2];
  return sum > 0 && v[0] / sum >= 0.7;
}
export const safeColor = (c) => (isRed(c) ? SAFE_RED : c);

/* ---------- frame types ----------
   full  = the drawing changes most of the picture's brightness (a flash frame for the guard)
   cls   = what it does to the picture: "dark" | "light" | "inv" (the scene inverted) | "scene" (the scene stays, ink over it)
   safe  = the frame shown instead when a full frame is not allowed
   back  = what happens to the scene behind the ink: null | "bw" | "bwinv" | "chroma" | "split" (one side inverted)
   local = the scene's change stays inside a jagged panel round the subject (at most LIMITS.localArea of the view)
   A drawing whose `back` changes the scene's brightness (bw, bwinv, split) is a FLASH for the guard, local or not (isFlash).
   The ink of each type is drawn by draw.mjs (same names). */
export const FRAMES = {
  pop:     { full: false, cls: "scene", back: null,     pl: "Błysk-gwiazda w miejscu ciosu", en: "Burst star at the point of the blow" },
  splat:   { full: false, cls: "scene", back: null,     pl: "Rozbryzg tuszu", en: "Ink splash" },
  lines:   { full: false, cls: "scene", back: null,     pl: "Linie pędu / skupienia", en: "Speed / focus lines" },
  ink:     { full: false, cls: "scene", back: "bw",     local: true, pl: "Kadr czarno-biały wokół ciosu", en: "A black-and-white panel round the blow" },
  slam:    { full: true,  cls: "inv",   back: "bwinv",  safe: "ink",   pl: "Negatyw czarno-biały", en: "Inverted black-and-white slam" },
  shadow:  { full: true,  cls: "dark",  back: null,     safe: "pop",   pl: "Czarny kadr, jasna sylwetka", en: "Black frame, light silhouette" },
  glare:   { full: true,  cls: "light", back: null,     safe: "lines", pl: "Biały kadr, czarna sylwetka", en: "White frame, black silhouette" },
  swap:    { full: true,  cls: "light", back: null,     safe: "dots",  pl: "Kadr w kolorze, sylwetka w tuszu", en: "Colour frame, ink silhouette" },
  window:  { full: true,  cls: "dark",  back: "bwinv",  safe: "pop",   pl: "Czarny kadr z wyrwą na scenę", en: "Black frame with a torn window on the scene" },
  smear:   { full: false, cls: "scene", back: null,     pl: "Smuga sylwetki", en: "Smear of the silhouette" },
  tear:    { full: true,  cls: "inv",   back: "split",  safe: "rip",   pl: "Rozdarcie kadru", en: "The frame torn in two" },
  rip:     { full: false, cls: "scene", back: null,     pl: "Cięcie przez kadr", en: "A cut across the frame" },
  dots:    { full: false, cls: "scene", back: null,     pl: "Raster i gwiazda", en: "Halftone and star" },
  shatter: { full: false, cls: "scene", back: "bw",     local: true, pl: "Pęknięcia i odłamki", en: "Cracks and shards" },
  chroma:  { full: false, cls: "scene", back: "chroma", pl: "Rozszczepienie barw", en: "Chromatic split" },
  ring:    { full: false, cls: "scene", back: null,     pl: "Pierścień uderzenia", en: "Shock ring" },
  /* IMPACT3 (1.9.20): the figures themselves in the impact frame (their own art inverted / posterised / inked / in its own colours,
     a rim of light on their true outline, flares thrown off the contact, the struck one's knock-back echoes); the scene untouched */
  fig:     { full: false, cls: "scene", back: null,     pl: "Postacie w klatce uderzenia", en: "The figures in the impact frame" },
  cracks:  { full: false, cls: "scene", back: null,     pl: "Pęknięcia (bez zmiany sceny)", en: "Cracks (the scene untouched)" },
  fade:    { full: false, cls: "scene", back: null,     pl: "Ślad (ostatnia klatka)", en: "Residue (last drawing)" },
  rest:    { full: false, cls: "scene", back: null,     pl: "Pauza (nic)", en: "A beat of nothing" }
};
export const FRAME_IDS = Object.keys(FRAMES);
/* a drawing the guard counts: a full-field frame, or any drawing that changes the scene's brightness behind it (even in a panel) */
export const isFlash = (f) => !!f && (!!f.full || f.back === "bw" || f.back === "bwinv" || f.back === "split");
/* which flash drawing is kept first when the guard allows fewer (and which drawing is an impact's peak) */
const KEEP = { slam: 6, shadow: 5, tear: 5, window: 4, swap: 3, glare: 2, ink: 1.5, shatter: 1 };
const PEAK = { ...KEEP, pop: 0.8, chroma: 0.6, dots: 0.5, splat: 0.5, smear: 0.5, rip: 0.5, ring: 0.4, fig: 0.45, cracks: 0.45, lines: 0.1, fade: 0, rest: -1 };

/* ---------- IMPACT3 (1.9.20): the figures take part ----------
   Each drawing may carry `fig`, what happens to the FIGURES (the struck token, the attacker a `from` names, the tokens `also` names) at
   their own place, size and turn on the screen, drawn from their own art: never a box round them, never enlarged.
     r = rim: a rim of light on the figure's true outline (lit on the side the blow comes from) and an ink line round it; the art untouched
     i = the art's colour negative, with the rim
     p = the art posterised to three flat tones (ink, the accent, paper), with the rim
     k = the art inked hard black and white, with the rim
     o = the art in its own colours, with the rim (over a negative or black-and-white scene the figure stands out in colour)
   i / p / k change the brightness of the figure's own area only. Together they stay under LIMITS.figArea of the view on every drawing
   (draw.mjs figTreat: over it a seat draws the rim only); the gentle variant and reduced motion get the rim only (safety). */
export const FIG = { r: "rim", i: "inv", p: "post", k: "ink", o: "orig", n: "hueneg", d: "duo", h: "hue" };
export const FIG_BRIGHT = new Set(["i", "p", "k"]);
/* IMPACT4 (1.9.21): treatments that change the COLOUR of a figure's art but hold every pixel's relative luminance (WCAG 2.3.1 measures a
   flash in relative luminance: a change of under a tenth is none), so they need no share of the figures' area and read on a token of any
   size at any zoom: the art "moves ink, not luminance".
     n = hue negative: every colour turned to its opposite hue at its own luminance (a blue square goes orange, white stays white)
     d = duotone: the art in the impact's two accents by its own light and dark, each pixel at its own luminance
     h = hue cycle: every colour turned by a seeded angle (another per drawing), at its own luminance
   A bright treatment over the area cap becomes its held twin (i -> n, p / k -> d) instead of a bare rim, plus a slice of the true one cut
   along the blow with the area that is left (draw.mjs figTreat). */
export const FIG_HELD = new Set(["n", "d", "h"]);
export const FIG_TWIN = { i: "n", p: "d", k: "d" };

/* ---------- kinds of impact: SIX strengths each (step 0..5, stepOf). A step = [type, ticks, flags, fig]: s = hit-stop, p = frame punch,
   q = half a punch, b = a kick BACK against the blow (the frame recoils: with the punch before it the frame shakes); fig = what the
   figures do in that drawing (FIG above). The ladder the owner asked for (a scratch, a solid hit, a heavy hit, a knock-down, a critical
   must each look different and escalate): steps 0-1 never change the scene and keep the struck figure in sight (a small star at its rim,
   the figure itself flipped to its negative for a tick), step 2 turns a panel round it hard black and white with the figure in its own
   colours on it, steps 3-5 are the full-field frames.
   IMPACT3 (1.9.20, the owner after watching them in play: «bardziej jak sakuga MAD ... odwrócenia kolorów na tokenach, akcent na ich
   krawędziach, więcej efektów, dynamiczniej»): every rung from 3 up is cut like a hand-animated impact: a lead-in tick (speed lines, the
   figures inked), the contact (a black frame with the figure, then the scene's negative with the figures standing out in their own
   colours), the hit-stop HELD on the figures while their palette jumps (negative, posterised) on ones with the frame shaking (punch,
   kick back), then the release on twos (colour split, halftone, ring, residue) with the rims dying out. Each ladder is designed inside
   the guard: at most two flash drawings per impact, so nothing the table sees is thinned at random. ---------- */
const S = (type, ticks = 1, flags = "", fig = "") => {
  const s = { type, ticks, stop: flags.includes("s"), punch: flags.includes("p") ? 1 : flags.includes("q") ? 0.5 : flags.includes("b") ? 0.7 : 0 };
  if ( flags.includes("b") ) s.kick = -1;
  if ( fig && FIG[fig] ) s.fig = fig;
  /* IMPACT4: Z / z = the figures POP (drawn bigger at their own place, stretched along the blow): the contact of a hand-drawn impact */
  if ( flags.includes("Z") ) s.z = 1.55; else if ( flags.includes("z") ) s.z = 1.25;
  return s;
};
/* IMPACT4 (1.9.21) ladders: steps 0-2 as short as before (the scene untouched in 0-1; a token's palette flips and the figure pops), steps 3-5
   cut like a hand-animated impact of 13 / 16-18 / 21-24 ticks: anticipation (speed lines, the figures inked, their hue flipped), the contact
   (the black frame with the struck figure ENLARGED in its own colour negative; the scene's negative with the figures popped in their own
   colours: the two flash drawings), the hold (hit-stop up to 8 ticks) with the figures shaking and their palette jumping on ones (negative,
   posterised, hue cycle, duotone: the bright ones where the area allows, else their luminance-held twins), the release on twos (colour split,
   cracks, halftone, rings: ink only), the settle (the figure back in its own colours, rims dying). Every ladder lists at most two flash
   drawings, so the guard never thins a lone impact. */
export const KINDS = {
  hit: { tone: "hero", pl: "Cios", en: "Hit", steps: [
    [S("pop", 1, "qz", "n"), S("fade", 1, "", "r")],
    [S("pop", 1, "qz", "i"), S("fig", 1, "", "n"), S("splat"), S("fade", 1, "", "r")],
    [S("ink", 1, "pZ", "o"), S("fig", 1, "z", "i"), S("fig", 1, "bz", "p"), S("fig", 1, "", "h"), S("dots", 1, "", "r"), S("fade")],
    [S("lines", 1, "", "k"), S("shadow", 2, "s"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbz", "p"), S("fig", 1, "", "h"), S("dots", 1, "", "n"), S("ring", 1, "", "d"), S("fade", 2, "", "r")],
    [S("lines", 1, "", "k"), S("smear", 1, "", "n"), S("shadow", 2, "s"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbz", "p"), S("fig", 1, "spz", "h"), S("chroma", 1, "b", "i"), S("cracks", 2, "", "d"), S("dots", 2, "", "p"), S("ring", 2, "", "n"), S("fade", 2, "", "r")],
    [S("lines", 1, "", "k"), S("lines", 1, "", "n"), S("shadow", 2, "s"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbZ", "p"), S("fig", 1, "spz", "h"), S("fig", 1, "sbz", "i"), S("fig", 1, "s", "d"), S("chroma", 1, "p", "i"), S("cracks", 2, "b", "p"), S("dots", 2, "", "h"), S("ring", 2, "", "n"), S("fig", 2, "", "o"), S("splat", 1, "", "d"), S("fade", 2, "", "r"), S("fade", 2, "", "r")] ] },
  heavy: { tone: "fire", pl: "Ciężki cios", en: "Heavy blow", steps: [
    [S("pop", 1, "qz", "n"), S("splat"), S("fade", 1, "", "r")],
    [S("pop", 1, "pz", "i"), S("fig", 1, "", "n"), S("splat"), S("ring"), S("fade")],
    [S("ink", 1, "pZ", "o"), S("fig", 1, "z", "i"), S("shatter", 1, "bz", "p"), S("fig", 1, "", "h"), S("ring", 1, "", "r"), S("fade")],
    [S("lines", 1, "", "k"), S("shadow", 2, "s"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sb", "p"), S("cracks", 2, "", "h"), S("ring", 1, "", "d"), S("fade", 2, "", "r")],
    [S("lines", 1, "", "k"), S("shadow", 2, "s"), S("slam", 2, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbz", "p"), S("fig", 1, "sp", "n"), S("cracks", 1, "b", "i"), S("ring", 2, "", "d"), S("cracks", 2, "", "h"), S("dots", 1, "", "p"), S("fade", 2, "", "r")],
    [S("lines", 1, "", "k"), S("smear", 1, "", "n"), S("shadow", 2, "s"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbZ", "p"), S("fig", 1, "spz", "h"), S("fig", 1, "sbz", "i"), S("fig", 1, "s", "d"), S("cracks", 1, "p", "i"), S("ring", 2, "", "p"), S("cracks", 2, "b", "h"), S("dots", 2, "", "n"), S("ring", 2, "", "r"), S("splat", 1, "", "d"), S("fade", 2, "", "r"), S("fade", 2)] ] },
  crit: { tone: "hero", pl: "Trafienie krytyczne", en: "Critical", steps: [
    [S("ink", 1, "pz", "o"), S("fig", 1, "z", "i"), S("dots", 1, "", "n"), S("fade")],
    [S("lines", 1, "", "r"), S("ink", 1, "pZ", "o"), S("fig", 1, "z", "i"), S("fig", 1, "", "h"), S("dots", 1, "", "p"), S("fade")],
    [S("lines", 1, "", "r"), S("slam", 1, "pZ", "o"), S("fig", 2, "bz", "i"), S("fig", 1, "", "h"), S("dots", 1, "", "p"), S("fade", 1, "", "r")],
    [S("lines", 1, "", "k"), S("shadow", 2, "s"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sb", "h"), S("chroma", 1, "b", "p"), S("dots", 1, "", "n"), S("ring", 1, "", "d"), S("fade", 2, "", "r")],
    [S("lines", 1, "", "k"), S("lines", 1, "", "n"), S("shadow", 2, "s"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbZ", "p"), S("fig", 1, "spz", "h"), S("chroma", 1, "p", "i"), S("dots", 2, "", "p"), S("ring", 2, "", "d"), S("fig", 1, "", "o"), S("splat", 1, "", "n"), S("fade", 2, "", "r"), S("fade")],
    [S("lines", 1, "", "k"), S("lines", 1, "", "n"), S("window", 2, "s", "o"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbZ", "p"), S("fig", 1, "spZ", "h"), S("fig", 1, "sbz", "i"), S("fig", 1, "s", "d"), S("chroma", 1, "p", "i"), S("fig", 1, "qz", "o"), S("dots", 1, "", "p"), S("cracks", 1, "b", "h"), S("ring", 2, "", "n"), S("dots", 1, "", "d"), S("splat", 1, "", "i"), S("fig", 2, "", "o"), S("fade", 2, "", "r"), S("fade", 2)] ] },
  blast: { tone: "fire", pl: "Wybuch", en: "Blast", steps: [
    [S("pop", 1, "qz", "n"), S("ring"), S("fade")],
    [S("pop", 1, "p", "i"), S("ring", 1, "", "n"), S("dots"), S("fade")],
    [S("ink", 1, "pZ", "o"), S("ring", 1, "", "i"), S("shatter", 1, "b"), S("fig", 1, "", "h"), S("fade", 1, "", "r")],
    [S("glare"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sb", "p"), S("cracks", 2, "b", "h"), S("ring", 2, "", "d"), S("fade", 2, "", "r"), S("fade")],
    [S("window"), S("slam", 2, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbz", "p"), S("cracks", 1, "b", "h"), S("ring", 2, "", "r"), S("chroma", 1, "", "n"), S("dots", 2, "", "d"), S("ring", 2), S("fade", 2)],
    [S("lines", 1, "", "k"), S("window", 2, "s"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbZ", "p"), S("fig", 1, "spz", "h"), S("cracks", 1, "", "i"), S("ring", 2, "", "r"), S("chroma", 1, "", "n"), S("cracks", 2, "b", "d"), S("ring", 2, "", "h"), S("dots", 2, "", "p"), S("splat"), S("fade", 2, "", "r"), S("fade", 2)] ] },
  slash: { tone: "blood", pl: "Cięcie", en: "Slash", steps: [
    [S("smear", 1, "", "n"), S("splat")],
    [S("smear", 1, "", "i"), S("rip", 1, "q", "r"), S("splat"), S("fade")],
    [S("smear", 1, "", "i"), S("rip", 1, "pz", "p"), S("fig", 1, "b", "o"), S("fig", 1, "", "h"), S("splat", 2, "", "r"), S("fade")],
    [S("smear", 1, "", "k"), S("tear", 2, "spZ", "o"), S("fig", 2, "sz", "i"), S("fig", 1, "", "h"), S("splat", 1, "b", "p"), S("rip", 1, "", "n"), S("splat", 1, "", "d"), S("fade", 2, "", "r")],
    [S("smear", 1, "", "n"), S("lines", 1, "", "k"), S("shadow", 1, "s"), S("tear", 2, "spZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbz", "h"), S("chroma", 1, "b", "p"), S("splat", 2, "", "n"), S("rip", 1, "", "d"), S("splat", 2), S("fade", 2, "", "r")],
    [S("lines", 1, "", "k"), S("smear", 1, "", "n"), S("shadow", 2, "s"), S("tear", 2, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbZ", "p"), S("fig", 1, "spz", "h"), S("fig", 1, "sbz", "i"), S("chroma", 1, "", "d"), S("splat", 2, "", "r"), S("rip", 1, "", "n"), S("splat", 2, "", "p"), S("fig", 2, "", "o"), S("fade", 2, "", "r"), S("fade", 2)] ] },
  landing: { tone: "dust", pl: "Lądowanie / uderzenie z góry", en: "Landing / strike from above", steps: [
    [S("pop", 1, "qz", "n"), S("ring")],
    [S("lines"), S("pop", 1, "p", "i"), S("ring", 1, "", "n"), S("fade")],
    [S("lines"), S("ink", 1, "pZ", "o"), S("ring", 1, "", "i"), S("cracks", 1, "b", "h"), S("fade", 1, "", "r")],
    [S("lines", 1, "", "k"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "s", "h"), S("ring"), S("cracks", 2, "b", "p"), S("ring", 1, "", "d"), S("dots", 1, "", "n"), S("fade", 2, "", "r")],
    [S("window"), S("slam", 2, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbz", "h"), S("cracks", 2, "b", "p"), S("ring", 1, "", "r"), S("dots", 1, "", "i"), S("ring", 2, "", "n"), S("cracks", 2, "", "d"), S("fade", 2)],
    [S("lines", 1, "", "k"), S("window", 1, "s"), S("slam", 2, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbZ", "p"), S("fig", 1, "spz", "h"), S("cracks", 1, "", "n"), S("ring", 2, "", "r"), S("dots", 1, "", "d"), S("cracks", 2, "b", "i"), S("ring", 2, "", "h"), S("dots", 2), S("fade", 2, "", "r"), S("fade", 2)] ] },
  ko: { tone: "blood", pl: "Powalenie", en: "Knock-out", steps: [
    [S("ink", 1, "pz", "o"), S("pop", 1, "z", "i"), S("splat"), S("fade")],
    [S("ink", 1, "pZ", "o"), S("pop", 1, "z", "i"), S("fig", 1, "", "h"), S("splat", 2, "", "p"), S("fade")],
    [S("lines", 1, "", "r"), S("ink", 1, "pZ", "o"), S("fig", 1, "z", "i"), S("fig", 1, "", "h"), S("splat", 2, "b", "p"), S("fade", 1, "", "r")],
    [S("shadow", 3, "s"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "s", "h"), S("splat", 2, "b", "p"), S("fig", 1, "", "n"), S("fade", 2, "", "r")],
    [S("lines", 1, "", "k"), S("shadow", 3, "s"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbz", "h"), S("chroma", 1, "b", "p"), S("splat", 2, "", "i"), S("fig", 2, "", "d"), S("splat", 1, "", "n"), S("fade", 2, "", "r"), S("fade", 2)],
    [S("lines", 1, "", "k"), S("lines", 1, "", "n"), S("shadow", 3, "s"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbZ", "p"), S("fig", 1, "spz", "h"), S("fig", 1, "sbz", "i"), S("chroma", 1, "", "d"), S("splat", 2, "", "p"), S("fig", 2, "", "h"), S("splat", 2, "", "n"), S("fig", 2, "", "o"), S("splat", 1), S("fade", 2, "", "r"), S("fade", 2, "", "r")] ] },
  shock: { tone: "volt", pl: "Wyładowanie / energia", en: "Shock / energy", steps: [
    [S("chroma", 1, "", "n"), S("pop")],
    [S("chroma"), S("pop", 1, "qz", "i"), S("ring", 1, "", "r"), S("fade")],
    [S("chroma", 1, "", "i"), S("ink", 1, "qZ", "o"), S("ring", 1, "", "p"), S("fig", 1, "", "h"), S("fade", 1, "", "r")],
    [S("chroma", 1, "", "k"), S("slam", 1, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "s", "h"), S("chroma", 1, "b", "p"), S("ring", 1, "", "n"), S("dots", 2, "", "d"), S("fade", 2, "", "r")],
    [S("lines", 1, "", "k"), S("glare"), S("slam", 2, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbz", "h"), S("chroma", 1, "b", "p"), S("ring", 1, "", "r"), S("dots", 2, "", "n"), S("chroma", 1, "", "d"), S("ring", 2), S("fade", 2)],
    [S("lines", 1, "", "k"), S("glare", 1, "s"), S("slam", 2, "pZ", "o"), S("fig", 1, "sZ", "i"), S("fig", 1, "sbZ", "p"), S("fig", 1, "spz", "h"), S("chroma", 2, "", "i"), S("ring", 1, "", "r"), S("fig", 1, "", "n"), S("chroma", 1, "b", "d"), S("dots", 2, "", "h"), S("ring", 2, "", "n"), S("dots"), S("fade", 2, "", "r"), S("fade", 2)] ] },
  word: { tone: "hero", pl: "Pod napisem", en: "Behind a word", steps: [
    [S("lines"), S("fade")],
    [S("lines", 2), S("fade")],
    [S("ink", 2, "q"), S("fade")],
    [S("slam", 2, "q"), S("dots"), S("fade")],
    [S("shadow"), S("slam", 2, "p"), S("dots", 2), S("fade")],
    [S("lines"), S("shadow"), S("slam", 2, "p"), S("dots", 2), S("ring"), S("fade")] ] }
};
/* the four strengths of the first build (contract v10: callers aimed at their bounds 0.35 / 0.85 / 1.35): kept as a view of the six */
for ( const K of Object.values(KINDS) ) Object.defineProperty(K, "tiers", { enumerable: false, get: () => [K.steps[0], K.steps[2], K.steps[3], K.steps[4]] });
export const KIND_IDS = Object.keys(KINDS);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/* strength 0..2 (0.5 = an ordinary blow, like the lettering's magnitude) -> step 0..5. The bounds of the first build stay bounds
   (under 0.85 never a full-field frame, from 1.35 the whole set): 0.35 a scratch, 0.6 a solid hit, 0.85 strong, 1.35 heavy, 1.7 the most */
export const STEP_AT = [0.35, 0.6, 0.85, 1.35, 1.7];
export const stepOf = (m) => { let i = 0; while ( i < STEP_AT.length && m >= STEP_AT[i] ) i++; return i; };
/* the old four tiers (plan.tier, for callers that read it); ENGVIEW: their bounds as a table too (L.impact.tiers) */
export const TIER_AT = [0.35, 0.85, 1.35];
export const tierOf = (m) => (m < 0.35 ? 0 : m < 0.85 ? 1 : m < 1.35 ? 2 : 3);

/* an event in a caller's own terms -> { kind, magnitude } (callers may also name both themselves)
   e = { type: "damage" | "roll" | "blast" | "landing" | "word", share (0..1 of the track lost), crit, fatal, cut, energy, area (in grid squares) } */
export function pick(e = {}) {
  const share = clamp(Number(e.share) || 0, 0, 1);
  if ( e.type === "blast" ) return { kind: "blast", magnitude: clamp(0.3 + (Number(e.area) || 1) * 0.28, 0, 2) };
  if ( e.type === "landing" ) return { kind: "landing", magnitude: clamp(0.4 + (Number(e.area) || 1) * 0.3, 0, 2) };
  if ( e.type === "word" ) return { kind: "word", magnitude: clamp(Number(e.magnitude) || 0.6, 0, 2) };
  if ( e.type === "roll" ) return { kind: e.crit ? "crit" : "hit", magnitude: e.crit ? 1.6 : clamp(Number(e.magnitude) || 0.5, 0, 2) };
  if ( e.fatal ) return { kind: "ko", magnitude: clamp(1.2 + share, 0, 2) };
  const kind = e.crit ? "crit" : e.energy ? "shock" : e.cut ? "slash" : share >= 0.34 ? "heavy" : "hit";
  return { kind, magnitude: clamp(0.25 + share * 2.2 + (e.crit ? 0.6 : 0), 0, 2) };
}

/* FIN-ENGINE (FXIT-E1 c): a blow's place in a series (0 = the first, up to SERIES_MAX) raises its strength by SERIES_STEP per place, so
   every caller builds a series alike (a third blow on the same figure is drawn harder than the first) */
export const SERIES_STEP = 0.15, SERIES_MAX = 4;
export const seriesBoost = (n) => SERIES_STEP * clamp(Math.floor(Number(n) || 0), 0, SERIES_MAX);
/* ---------- the plan ---------- */
/* spec = { kind, magnitude, series (0..4), seed, dir (degrees the blow travels: 0 right, 90 down; null = no direction), tone | colors: [a, b],
            frames: [type | { type, ticks, stop, punch }] (a caller's own sequence instead of the kind's), hitstop, punch }
   -> { kind, tier, step, magnitude, seed, dir (radians | null), tone: { a, b }, frames: [{ type, ticks, stop, punch, seed, full, cls, back, local }], ticks, ms } */
export function planImpact(spec = {}) {
  const kind = Object.hasOwn(KINDS, spec.kind) ? spec.kind : "hit";
  const magnitude = clamp((Number.isFinite(spec.magnitude) ? spec.magnitude : 0.5) + seriesBoost(spec.series), 0, 2);
  const tier = tierOf(magnitude), step = stepOf(magnitude);
  const seed = spec.seed == null ? 1 : (typeof spec.seed === "number" ? spec.seed >>> 0 : hash(spec.seed));
  const R = rng(seed);
  const K = KINDS[kind];
  let steps;
  if ( Array.isArray(spec.frames) && spec.frames.length ) {
    steps = spec.frames.map((f) => (typeof f === "string" ? S(f) : { type: f?.type, ticks: f?.ticks ?? 1, stop: !!f?.stop, punch: f?.punch === true ? 1 : Number(f?.punch) || 0,
      ...(f?.kick < 0 ? { kick: -1 } : {}), ...(typeof f?.fig === "string" && FIG[f.fig] ? { fig: f.fig } : {}), ...(Number(f?.z) > 1 ? { z: Math.min(1.8, Number(f.z)) } : {}) }))
      .filter((f) => Object.hasOwn(FRAMES, f.type));
    /* IMPACT3: a caller's own sequence without any `fig` gets the figures' part by the same rule as the kinds: the rim before the blow,
       the figure in its own colours on the blow, then its negative, posterised, and the rim dying out (callers may set `fig` per drawing) */
    if ( steps.length && !steps.some((f) => f.fig) ) autoFigs(steps);
  } else steps = K.steps[step].map((s) => ({ ...s }));
  if ( !steps.length ) steps = [S("pop")];
  /* IMPACT3: the figures' palette differs from blow to blow (seeded, the same on every seat): every other seed jumps posterised first,
     negative second */
  const seedN = spec.seed == null ? 1 : (typeof spec.seed === "number" ? spec.seed >>> 0 : hash(spec.seed));
  if ( (seedN >>> 5) & 1 ) for ( const s of steps ) if ( s.fig === "i" ) s.fig = "p"; else if ( s.fig === "p" ) s.fig = "i";
  /* IMPACT4: more from blow to blow (seeded, every seat alike): the held palettes swap (hue cycle <-> duotone), and on the long cuts (a kind's
     steps 3-5) the release after the hold is played in another order */
  if ( (seedN >>> 6) & 1 ) for ( const s of steps ) if ( s.fig === "h" ) s.fig = "d"; else if ( s.fig === "d" ) s.fig = "h";
  if ( !spec.frames && step >= 3 && (seedN >>> 9) & 1 ) {
    const last = steps.reduce((a, s, i) => (s.stop ? i : a), -1), rel = steps.slice(last + 1, steps.length - 2);
    if ( last >= 0 && rel.length >= 2 ) steps.splice(last + 1, rel.length, ...rel.slice(1), rel[0]);
  }
  /* IMPACT5 (item 9): every drawing of a kind's ladder carries the figures (a splash, a ring, a residue without them covered the struck
     token on the seats where they were drawn big): the rim before the blow, the figure in its own colours after it */
  if ( !spec.frames && kind !== "word" ) {
    let pk = steps.findIndex((s) => (PEAK[s.type] ?? 0) >= 0.8); if ( pk < 0 ) pk = 0;
    steps.forEach((s, i) => { if ( !s.fig && s.type !== "rest" ) s.fig = i < pk ? "r" : "o"; });
  }
  /* a caller can only lower the figures' part: figures: false = none, "rim" = the rims only */
  if ( spec.figures === false ) for ( const s of steps ) delete s.fig;
  else if ( spec.figures === "rim" ) for ( const s of steps ) if ( s.fig ) { s.fig = "r"; delete s.z; }
  /* the limits: each drawing, the hit-stop, the whole impact */
  let total = 0, stops = 0;
  const frames = [];
  const cap = spec.demo ? LIMITS.galleryTicks : LIMITS.maxFrameTicks, capAll = spec.demo ? LIMITS.galleryTicks : LIMITS.maxTicks;   // demo: I.show() only
  for ( const s of steps ) {
    let ticks = clamp(Math.round(Number(s.ticks) || 1), 1, cap);
    if ( total + ticks > capAll ) ticks = capAll - total;
    if ( ticks < 1 ) break;
    let stop = !!s.stop && spec.hitstop !== false;
    if ( stop ) { if ( stops + ticks > LIMITS.maxStopTicks ) stop = false; else stops += ticks; }
    const def = FRAMES[s.type];
    const punch = spec.punch === false ? 0 : clamp((s.punch || 0) * (Number.isFinite(spec.punch) ? spec.punch : 1), 0, 1.5);
    const fr = { type: s.type, ticks, stop, punch, seed: R.seed(), full: def.full, cls: def.cls, back: def.back, local: !!def.local };
    if ( s.fig ) fr.fig = s.fig;
    if ( s.fig && s.z > 1 ) fr.z = s.z;
    if ( s.kick < 0 && punch > 0 ) fr.kick = -1;
    frames.push(fr);
    total += ticks;
  }
  if ( spec.figures !== "rim" ) cutIn(frames, step);
  const t = Array.isArray(spec.colors) && spec.colors.length ? { a: String(spec.colors[0]), b: String(spec.colors[1] ?? spec.colors[0]) } : (TONES[spec.tone] ?? TONES[K.tone]);
  const dir = Number.isFinite(spec.dir) ? (spec.dir * Math.PI) / 180 : null;
  const plan = { kind, tier, step, magnitude, seed, dir, tone: { a: t.a, b: t.b }, frames, ticks: total, ms: total * TICK, mode: "full",
    /* IMPACT3: which accent lights the figures' rims (seeded: the same on every seat) */
    rimTone: (seed >>> 7) & 1 ? "b" : "a" };
  /* FIN-ENGINE: when the blow itself shows, ms after the impact's start (the lead-ins before it: lines, a black frame); a caller that knows
     the instant of the blow passes it as `blowAt` and the impact starts peakMs earlier */
  plan.peakMs = peakOf(plan).tick * TICK;
  return plan;
}
/* the drawing of a plan that IS the blow: the first one with the weight of a hit (a star, a panel, a full-field frame) after the
   lead-ins (lines, a colour split); without one, the strongest. -> its index and the tick it starts at */
export function peakOf(plan) {
  let best = 0, a = 0, bestAt = 0;
  for ( let i = 0; i < plan.frames.length; i++ ) {
    const v = PEAK[plan.frames[i].type] ?? 0;
    if ( v >= 0.8 ) return { index: i, tick: a };
    if ( v > (PEAK[plan.frames[best].type] ?? 0) ) { best = i; bestAt = a; }
    a += plan.frames[i].ticks;
  }
  return { index: best, tick: bestAt };
}

/* ---------- IMPACT5 (1.9.23): the cut-in ----------
   The owner (IMPACT3, again after IMPACT4): «bardziej jak sakuga MAD ... dynamiczniej». In a sakuga impact the camera cuts IN on the
   fighters and stays on them for the whole cut; before, after ~200 ms only token-sized changes were left (at a far zoom: a few pixels).
   Every drawing now carries `cu` (0..1: how far the cut-in has gone; the star figure, the struck token or else the attacker, is drawn up
   to LIMITS.cutMax of the view's short side at its own place) and `kb` (-0.2..1: where it is along the blow: a wind-up against it before the
   contact, a shove on it, a drift on through the release). The cut-in grows over the lead-in, stands full from the contact through the
   hold, and eases back over the release, so the last drawing is still moving. The strength sets how far it goes (CU_TOP by step). */
const CU_TOP = [0.5, 0.6, 0.8, 1, 1, 1];
function cutIn(frames, step) {
  if ( !frames.length ) return;
  const top = CU_TOP[step] ?? 1, pk = peakOf({ frames }).index;
  const hold = Math.max(pk, frames.reduce((a, f, i) => (f.stop ? i : a), -1));
  const at = []; let a = 0; for ( const f of frames ) { at.push(a); a += f.ticks; }
  const relA = at[hold] + frames[hold].ticks, relN = frames.length - hold;
  frames.forEach((f, i) => {
    if ( f.type === "rest" ) return;
    let cu, kb;
    if ( i < pk ) { cu = top * 0.35 * (i + 1) / pk; kb = -0.2 * (i + 1) / pk; }
    else if ( i <= hold ) { cu = top; kb = 0.08; }
    else { cu = top * (1 - (i - hold) / relN); kb = 0.08 + 0.92 * Math.min(1, (at[i] + f.ticks - relA) / Math.max(1, a - relA)); }
    f.cu = +cu.toFixed(3); f.kb = +kb.toFixed(3);
  });
}
/* IMPACT3: the figures' part for a caller's own sequence (steps = [{ type, ticks, ... }], changed in place) */
function autoFigs(steps) {
  let pk = steps.findIndex((s) => (PEAK[s.type] ?? 0) >= 0.8);
  if ( pk < 0 ) { pk = 0; steps.forEach((s, i) => { if ( (PEAK[s.type] ?? 0) > (PEAK[steps[pk].type] ?? 0) ) pk = i; }); }
  const after = ["i", "p"];
  steps.forEach((s, i) => { if ( s.type === "rest" ) return; s.fig = i < pk ? "r" : i === pk ? "o" : after[i - pk - 1] ?? "r"; });
}
/* ---------- what this client may see ----------
   prefs = the engine's preferences (prefs.mjs: enabled, motion, flashes, photosafe) + impact ("full" | "local" | "off")
   env   = { osReduced, callerReduced, callerGentle, flashLog (the engine's shared log of flash times, ms), now, t0 }
   Modes: "off" (nothing), "static" (reduced motion: ONE small drawing, no movement), "local" (the gentle variant: no full-field
   frame, everything inside a panel of at most LIMITS.localArea of the viewport, no hit-stop), "full".
   A caller can only LOWER: `reduced: true` reduces, `gentle: true` gives the gentle variant; `reduced: false` does not overrule the
   OS switch (only this client's own Motion setting "full" does). The timing never changes (same ticks on every client, and a still
   drawing stands at the instant of the full plan's peak); only what is drawn does. Returns the plan (changed in place). */
export function modeFor(prefs = {}, env = {}) {
  if ( prefs.enabled === false || prefs.impact === "off" ) return "off";
  const reduced = prefs.motion === "reduced" || env.callerReduced === true || (prefs.motion !== "full" && !!env.osReduced);
  if ( reduced ) return "static";
  if ( prefs.flashes === false || prefs.motion === "gentle" || prefs.impact === "local" || env.callerGentle === true ) return "local";
  return "full";
}
const setType = (f, t) => { const d = FRAMES[t]; f.was ??= f.type; f.type = t; f.full = d.full; f.cls = d.cls; f.back = d.back; f.local = !!d.local; };
const toSafe = (f) => { const t = FRAMES[f.type].safe; if ( t ) setType(f, t); };
/* a flash drawing over the budget: a full frame becomes its quiet twin; a twin (or a panel) that still changes the scene keeps its ink
   and leaves the scene alone */
const quiet = (f) => { if ( f.full ) toSafe(f); if ( isFlash(f) ) { f.was ??= f.type; f.back = null; f.quieted = true; } };
export function safety(plan, prefs = {}, env = {}) {
  const mode = modeFor(prefs, env);
  plan.mode = mode;
  if ( mode === "off" ) { plan.frames = []; plan.ticks = 0; plan.ms = 0; return plan; }
  if ( mode === "static" ) {
    /* one quiet drawing (at most 4 ticks), standing at the instant of the full plan's peak: no movement, no change of the scene */
    const pk = peakOf(plan);
    const ticks = Math.min(LIMITS.maxFrameTicks, Math.max(2, plan.ticks - pk.tick));
    const lead = Math.max(0, Math.min(pk.tick, LIMITS.maxTicks - ticks));
    const seed = plan.frames[pk.index]?.seed ?? plan.seed;
    const rim = plan.frames.some((f) => f.fig);   // IMPACT3: the still drawing keeps the figures' rim (no change of their art)
    plan.frames = [];
    if ( lead > 0 ) plan.frames.push({ type: "rest", ticks: lead, stop: false, punch: 0, seed, full: false, cls: "scene", back: null, local: false });
    plan.frames.push({ type: "pop", ticks, stop: false, punch: 0, seed, full: false, cls: "scene", back: null, local: false, still: true, ...(rim ? { fig: "r" } : {}) });
    plan.ticks = lead + ticks; plan.ms = plan.ticks * TICK;
    return plan;
  }
  /* ENGTABLE (1.9.16): the guard is always on; a `photosafe: false` (no setting carries one any more) changes nothing */
  if ( mode === "local" ) {
    const gentle = prefs.motion === "gentle";
    /* IMPACT3: the gentle variant (also a photosensitive seat): the figures keep their rim only, their art never changes brightness */
    for ( const f of plan.frames ) { if ( f.full ) toSafe(f); f.stop = false; if ( gentle ) f.punch = 0; else f.punch *= 0.5; if ( f.back === "chroma" && gentle ) f.back = null; if ( f.fig ) f.fig = "r"; delete f.z; delete f.cu; delete f.kb; if ( !f.punch ) delete f.kick; }
  }
  /* the guard: flash drawings (full-field frames AND drawings that change the scene's brightness, even inside a panel) are rationed,
     per impact and per rolling second (shared with the words' flash frames) */
  const log = env.flashLog ?? [], now = env.now ?? 0, t0 = env.t0 ?? now;
  for ( let i = log.length - 1; i >= 0; i-- ) if ( log[i] < now - LIMITS.windowMs * 2 ) log.splice(i, 1);
  const flash = [];
  let t = 0;
  for ( const f of plan.frames ) { if ( isFlash(f) ) flash.push({ f, at: t0 + t * TICK }); t += f.ticks; }
  flash.sort((x, y) => (KEEP[y.f.type] ?? 0) - (KEEP[x.f.type] ?? 0));
  let kept = 0;
  const mine = [];
  for ( const x of flash ) {
    const near = log.filter((v) => Math.abs(v - x.at) < LIMITS.windowMs).length + mine.filter((v) => Math.abs(v - x.at) < LIMITS.windowMs).length;
    if ( kept >= LIMITS.fullPerImpact || near >= LIMITS.fullPerSec ) { quiet(x.f); continue; }
    kept++; mine.push(x.at);
  }
  if ( !env.preview ) log.push(...mine);
  /* KEEPBOX: `at` = the shared instants this impact took in the log (the player gives back those of a blow cut short before they show) */
  plan.guard = { kept, dropped: flash.length - kept, at: mine };
  return plan;
}

/* ---------- the clock ---------- */
/* which drawing is up `t` ms after the start: its index, or -1 when the impact is over (or has not begun) */
export function frameAt(plan, t) {
  if ( !(t >= 0) ) return -1;
  const k = t / TICK;   // counted in whole ticks: no drift between clients
  let a = 0;
  for ( let i = 0; i < plan.frames.length; i++ ) { a += plan.frames[i].ticks; if ( k < a ) return i; }
  return -1;
}
/* the frame punch of drawing i: a kick along the blow that dies over the drawing's own ticks (stepped, one value per tick).
   -> { x, y (shares of the viewport), s (zoom) }; never beyond LIMITS.punchMax, and the zoom always covers the shift */
export function punchAt(plan, i, tickInFrame = 0) {
  const f = plan.frames[i];
  if ( !f || !(f.punch > 0) ) return null;
  /* IMPACT3: a drawing with kick -1 recoils AGAINST the blow (after a punch along it the frame shakes) */
  const k = clamp(f.punch, 0, 1.5) / 1.5 * (0.45 + 0.55 * plan.magnitude / 2) * (tickInFrame === 0 ? 1 : tickInFrame === 1 ? -0.45 : 0.2) * (f.kick < 0 ? -1 : 1);
  const amp = LIMITS.punchMax * k;
  const a = plan.dir ?? ((f.seed % 360) * Math.PI) / 180;
  return { x: Math.cos(a) * amp, y: Math.sin(a) * amp, s: 1 + Math.abs(amp) * 2.4 };
}
/* the gentle variant's panel: the radius (px) of a disc of LIMITS.localArea of the viewport */
export const localRadius = (W, H) => Math.sqrt((LIMITS.localArea * W * H) / Math.PI);
