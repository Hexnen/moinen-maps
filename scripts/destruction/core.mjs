/**
 * The destruction bake: pure code (no DOM, no Foundry), run in a worker. From the painted mask and the map's own pixels it builds
 *
 *   1. ANALYSIS   the ragged outline at art-pixel scale, connected damage areas, a distance field (depth), one or more impact
 *                 epicentres (several along a long stroke), the material under each area (grass, earth, stone, wood, sand, snow,
 *                 water, metal: classified from the map's colours and grain);
 *   2. FRACTURE   a crack network grown from each epicentre: radial spokes and rings that widen with distance (small shards at the
 *                 centre, big plates at the rim), domain-warped so the crack lines are jagged;
 *   3. SHARDS     every cell is a piece of the REAL map (its pixels at its own place), given a fate by the local severity: stays
 *                 (cracked), tilts up / slumps (broken), is thrown out as chips or pulverised (crater). Each kept piece is rendered
 *                 as a rigid slab with the oblique top-down camera of the pixel-vfx standard (sx = x, sy = y - z/2): shaded top
 *                 face, a cross-section side, an inked silhouette, and a flat ground shadow;
 *   4. BENEATH    the pixel-art damage under the torn surface in a ramp derived from the map's own colours, dithered, with the
 *                 far wall's strata, rubble, joists under a wooden deck, water in a flooded hole, char and embers, a pit into
 *                 darkness; plus hairline cracks, scorch and dust halos and an inked lip on the intact map around it.
 *
 * Everything is deterministic from (mask, map pixels, seed, settings). The result is one sprite sheet (RGBA) whose last rows hold
 * the placement table, so a single PNG carries the whole bake.
 */

import { bakeTear } from "./tear.mjs";
import { SubstrateSource, finishOverSubstrate } from "./substrate.mjs";
import { collapseOutline, collapseSeeds, collapseFate, collapseShade, collapseLip } from "./collapse.mjs";
import { boltTree, lineCells, sigilCells } from "./pixel-fx.mjs";
import { boltTree as boltTreeK, lineCells as lineCellsK } from "./pixel-fx.mjs";   // (crack strokes: kind code, not cause code)

export const CORE_VERSION = 49;   // 49: a cause's speck clusters as tonal patches with a few specks; 48: cracks by propagation (jagged segments with kinks, one dominant fissure and few secondaries of different lengths, thin Y junctions, flakes, a stepped lip, grain and mortar following), sunk cave-in slabs shaded deeper; 47: frost facet edges broken (only along the middle of each facet edge, never a full cross through the centre); 46: cause identities beyond colour - claws cut 3-4 tapering parallel furrows with lit and shaded lips and turf ridges between (no crater), impact a pale compacted crater with a dark core, straight radial fractures and a lit pressed crest, water stands in an eroded pit (a calm blue-green surface, a meniscus, broken ripple arcs, a wet band, sediment along the flow, no stones on it), frost six lit facets on the 30/90/150-degree lines and a few ice shards (no white dots), acid round bubbling pits and a smooth three-band bleed (no swirl pools, no dark specks), rot a sagging slump with moss clumps on the lit slopes (no pale specks), lightning a pale fused core in a scorched band and one continuous fused line (no glint specks), arcane sigils mostly violet, fewer motes; a tear's silhouette per cause (claws three parallel furrows, impact a short slit with a star of radial rips, frost a straight rift with 60-degree crystal spurs, water a meandering channel, acid a ragged eaten slit, rot a sagging frayed split, arcane an angular rift, fire a wide charred split, lightning a zig-zag slit); 45: a cause's specks in a few clusters; 44: crack strokes of varying width cut open (lit far wall, dark interior), one fissure along a followed stroke, no lone specks; darker blast cores with lighter ejecta; a smooth soot gradient round a burn, no stones or embers sprinkled on its floor, its pieces stay in it; 43: a cave-in sags as one bowl at level 1 with a small hole, its lip in tilted shards of mixed size, a clear strata band and a bigger void, no hairlines out into the ground (a cause's are short), rubble on the floor in the pit's own tones, a 1st-harmonic asymmetric outline, a trench that pinches and bulges; 42: cause floors calmer (fewer ember, spark, mote, bubble, spore and glint specks, acid pools in two bands, smaller sigils, moss in patches on lit parts, no 0-degree frost facets, a water halo near the rim), claws cut three gouges, no cause halo or rim hairlines on crack strokes; 41: crack STROKES (tapered branching fissures with a bevel, along the stroke, no cells), smooth lit floor bands with a few bigger stones, a flooded hole's pieces sink into it; 40: a cave-in's outline read from the smoothed occupancy (a level-1 pit stays whole, no straight runs of the brush mask), a finer wobble along its rim, room for its outward lobes; 39: a tear's flap seams short nicks, fibres slanted and short (no sticks across a wide gap), its far wall's strata dithered with a wandering height, turf roots and crumbs in soil tones; 38: a lightning lip scorched with rare glass beads (no white outline); 37: cracks readable at max settings (a milder warp of torn cracks, no wide main fissures there, no knot of tiny plates round the impact); 36: a cave-in shaped as an organic pit or a trench along a followed stroke, plates in rings along its rim (tilted, lit, sinking by band), a layered wall with strata and a void floor, a broken lip; 35: a tear opens asymmetrically (one tip blunt, the other a needle or a fork, pinches and bulges, the lips shifted against each other, its middle off the spine), its lips cut into flaps of varied length that settle, curl back or tear off into the gap, fibres that snap as pieces, curved forking hairlines, dithered diagonal edges, fire veins broken and branching, frost crystals at 60 degrees with a soft rime, acid eats a pitted edge; 33: lightning forks leave at 30-60 degrees off the channel's heading; 32: crack plates a little bigger at the crater level, main fissures wide over half the reach; 31: lightning leaves branching fused bolt trails (no web), arcane inscribes sigils, impact a pressed rim with shock streaks and chips, claws parallel scratches beside it, water erosion wet ground and sediment bands, frost a soft rime lip; 30: cracks as a hierarchy (irregular fan of main fissures, uneven rings, missing segments, impacts further apart), hairlines spaced and branching at 30-60 degrees, flood floor glints in patches; 29: a broken, variable-weight lip ink; short cave-in hairlines; 28: 28: fewer fire specks, a lighter lightning burn, arcane motes without '+' glyphs; 27: 27: at most six hairline fractures per area; 26: 26: flat plates keep the map's tone, moved crack plates inked, smooth soot round a burn, tear floors dithered, curved tear side rips; 25: 25: substrates (a newer stroke over older damage reads it under its own pixels, one way), the severity rule (a lower level never covers a higher one), a tear's cover is what it lays, cracks darken with their level; 24: banded floors (no checkerboard), clustered embers; 23: fire fissures broken, acid pools pitted, frost lip a rime not an outline; 22: lightning as a few bolts, a lobed broken rune ring; 21: lobed rune rings, a wandering crater lip band, throws within reach, fewer rim studs, crack hierarchy, few lightning bolts; 20: a tear in stone shows a quieter fresh-stone rim; 19: a cave-in in layered depth (slope bands, lit pit wall, rubble on its floor); 18: pieces placed as if the scene had no edge, culled past it
export const TYPES = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];
const T_BLAST = 0, T_COLLAPSE = 1, T_SCORCH = 2, T_FLOOD = 3, T_CRACKS = 4, T_GASH = 5;
export const MATS = ["grass", "earth", "stone", "wood", "sand", "snow", "water", "metal"];
const M = Object.fromEntries(MATS.map((m, i) => [m, i]));
/** int16 fields per sprite in the placement table. */
export const META_FIELDS = 18;

/* ================================================================ small maths */

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function h2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  const top = a + (b - a) * u, bot = c + (d - c) * u;
  return top + (bot - top) * v;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

/* ================================================================ colour */

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if ( mx === mn ) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if ( s <= 0 ) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
function mixHue(a, b, t) { let d = ((b - a + 540) % 360) - 180; return a + d * t; }
const mul = (c, f) => [clamp(Math.round(c[0] * f), 0, 255), clamp(Math.round(c[1] * f), 0, 255), clamp(Math.round(c[2] * f), 0, 255)];
const mix = (a, b, t) => [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];

/** A five-step ramp (dark -> light): hue-shifted, cool shadows and warm lights. */
function ramp(h, s, ls, shift = 9) {
  return ls.map((l, i) => hsl2rgb(h + (i - 2) * shift * (i < 2 ? -1.4 : 1), clamp(s * (i === 0 ? 0.85 : 1), 0, 1), l));
}

/* ================================================================ material */

/** Classify a set of map pixels: dominant colour, saturation, value, texture and grain direction. */
function classify(map, W, idx) {
  let n = 0, sr = 0, sg = 0, sb = 0, hx = 0, hy = 0, ssat = 0, sl = 0, sl2 = 0, gx = 0, gy = 0;
  const lum = (o) => 0.299 * map[o] + 0.587 * map[o + 1] + 0.114 * map[o + 2];
  const step = Math.max(1, Math.floor(idx.length / 4000));
  for ( let k = 0; k < idx.length; k += step ) {
    const i = idx[k], o = i * 4;
    const r = map[o], g = map[o + 1], b = map[o + 2];
    const [h, s, l] = rgb2hsl(r, g, b);
    sr += r; sg += g; sb += b; ssat += s; sl += l; sl2 += l * l;
    hx += Math.cos(h * Math.PI / 180) * s; hy += Math.sin(h * Math.PI / 180) * s;
    const x = i % W;
    if ( x + 1 < W ) gx += Math.abs(lum(o + 4) - lum(o));
    if ( i + W < map.length / 4 ) gy += Math.abs(lum(o + W * 4) - lum(o));
    n++;
  }
  if ( !n ) return { mat: M.earth, col: [110, 90, 70], hsl: [30, 0.3, 0.4], grainX: true };
  const col = [sr / n, sg / n, sb / n].map(Math.round);
  const hsl = rgb2hsl(...col);
  const hue = ((Math.atan2(hy, hx) * 180 / Math.PI) + 360) % 360, sat = ssat / n, l = sl / n;
  const tex = Math.sqrt(Math.max(0, sl2 / n - l * l));
  const aniso = Math.abs(gx - gy) / Math.max(1, gx + gy);
  let mat;
  if ( hue >= 175 && hue <= 255 && sat > 0.2 && l > 0.12 && l < 0.75 ) mat = M.water;
  else if ( l > 0.74 && sat < 0.16 ) mat = M.snow;
  else if ( sat < 0.13 ) mat = (tex < 0.045 && l < 0.6) ? M.metal : M.stone;
  else if ( hue >= 65 && hue < 175 && sat > 0.15 ) mat = M.grass;
  else if ( hue >= 32 && hue < 65 && sat > 0.2 && l > 0.52 ) mat = M.sand;
  else if ( hue >= 8 && hue < 50 && sat > 0.22 && aniso > 0.16 ) mat = M.wood;
  else if ( sat < 0.2 ) mat = M.stone;
  else mat = M.earth;
  return { mat, col, hsl: [hue, sat, l], tex, aniso, grainX: gx > gy };
}

/** The colours of what lies under a material's surface. */
function palette(cls, type) {
  const [h, s, l] = cls.hsl, P = {};
  const soilH = mixHue(h, 28, 0.8);
  switch ( cls.mat ) {
    case M.grass: P.ramp = ramp(soilH, clamp(0.32 + s * 0.15, 0.25, 0.5), [0.09, 0.15, 0.22, 0.3, 0.39]); P.strata = [ramp(soilH, 0.4, [0.24])[0], ramp(soilH, 0.3, [0.17])[0]]; break;
    case M.stone: P.ramp = ramp(h, Math.min(s, 0.12) * 0.7 + 0.04, [0.1, 0.17, 0.26, 0.36, 0.47], 6); P.strata = [hsl2rgb(h, 0.05, l * 0.62), hsl2rgb(28, 0.22, 0.2)]; break;
    case M.wood: P.ramp = ramp(mixHue(h, 260, 0.35), 0.18, [0.035, 0.06, 0.09, 0.13, 0.19], 5); P.strata = [hsl2rgb(h, s * 0.8, l * 0.55), hsl2rgb(h, s * 0.7, l * 0.4)]; P.beam = hsl2rgb(h, clamp(s * 0.9, 0, 0.6), clamp(l * 0.62, 0.12, 0.42)); break;
    case M.sand: P.ramp = ramp(h, clamp(s * 0.85, 0.15, 0.6), [l * 0.36, l * 0.48, l * 0.6, l * 0.72, l * 0.84].map((v) => clamp(v, 0.06, 0.8)), 5); P.strata = [hsl2rgb(h, s * 0.7, l * 0.62), hsl2rgb(h, s * 0.6, l * 0.5)]; break;
    case M.snow: P.ramp = ramp(25, 0.2, [0.1, 0.17, 0.25, 0.33, 0.43]); P.strata = [hsl2rgb(h, s, clamp(l * 0.82, 0.5, 0.9)), hsl2rgb(205, 0.2, 0.62)]; P.chunk = hsl2rgb(h, s, clamp(l * 1.02, 0.6, 0.95)); break;
    case M.water: P.ramp = ramp(h, clamp(s + 0.12, 0.3, 0.8), [0.07, 0.11, 0.16, 0.22, 0.3], 4); P.strata = [hsl2rgb(h, s, l * 0.7), hsl2rgb(h, s, l * 0.5)]; break;
    case M.metal: P.ramp = ramp(s > 0.03 ? h : 215, 0.09, [0.05, 0.09, 0.15, 0.23, 0.33], 4); P.strata = [hsl2rgb(h, s, l * 0.7), hsl2rgb(h, 0.05, 0.3)]; P.girder = hsl2rgb(25, 0.35, 0.28); break;
    default: P.ramp = ramp(soilH, clamp(0.3 + s * 0.2, 0.2, 0.55), [0.08, 0.14, 0.21, 0.29, 0.38]); P.strata = [hsl2rgb(soilH, 0.35, 0.26), hsl2rgb(soilH, 0.3, 0.18)];
  }
  P.char = ramp(18, 0.22, [0.045, 0.07, 0.1, 0.14, 0.19], 4);
  P.ember = [[255, 154, 60], [255, 211, 107], [214, 82, 38]];
  P.void = hsl2rgb(232, 0.3, 0.035);
  P.waterR = cls.mat === M.water ? ramp(h, clamp(s + 0.1, 0.3, 0.8), [0.1, 0.15, 0.22, 0.3, 0.42], 4) : ramp(203, 0.42, [0.1, 0.15, 0.22, 0.31, 0.44], 5);
  P.dust = hsl2rgb(h, s * 0.35, clamp(l * 1.05 + 0.08, 0.35, 0.8));
  P.ink = mul(P.ramp[0], 0.8);
  if ( type === T_SCORCH ) { P.ramp = P.char; P.strata = [P.char[2], P.char[1]]; }
  return P;
}

/* ================================================================ causes */

/**
 * CAUSE: what did the damage. A third dimension, orthogonal to the kind (the form: blast, collapse, ...) and the level (how deep).
 * Index 0 is "unspecified": none of the cause code runs, so its bake is bit-identical to the bake from before causes existed. Every
 * other cause is ONE ROW of data that the whole pipeline reads (no per-cause branches scattered through the code):
 *   acc    the cause's accent [hue, sat, light]; the real accent is derived from the map under the area (its hue pulled towards this
 *          one, its lightness following the map's), so the same cause reads differently on grass, stone or snow
 *   ramp   what lies beneath: hue pull towards the accent (k), saturation factor (s) and floor (sa), lightness factor (l)
 *   deb    the pieces' top faces: a wash towards char | acc | wet | ice | moss (k); dissolved rim pixels (holes); a lit rim (rim)
 *   frac   the fracture: spokes (count factor), ring (growth factor, < 1 smaller pieces), swirl (spiral arms), along (strips along the
 *          area's axis, < 1)
 *   fate   pulverised share (gone, added) and throw distance factor (thr)
 *   crack  hairline cracks out into the map: mode radial | branch | spiral | parallel | crystal | root, count (n), length (len),
 *          branching (br), colour (col: ink | ember | bolt | acc | arc | ice | root), always (also at low severity and in water)
 *   halo   the intact ground around: char | stain | burn | motes | pressed | scrape | wet | moss | rime, radius factor (r)
 *   edge   the torn lip: char | pitted | glassy | rune | pressed | scraped | smooth | moss | frost
 *   fill   the exposed layer: char | acid | glass | rune | bowl | groove | silt | moss | ice
 *   fx     baked specks (deterministic): ember | bubble | spark | mote | dust | splinter | drop | spore | glint, density (fxD)
 *   glow   emissive colour, or null: those pixels also go into a soft light sprite that the display lays into the scene's
 *          illumination (like the districts' night lights), so they keep their colour in a dark scene
 */
export const CAUSES = ["none", "fire", "acid", "lightning", "arcane", "impact", "claws", "water", "decay", "frost"];
const CAUSE = [
  null,
  /* fire     */ { acc: [24, 0.92, 0.55], ramp: { k: 0.45, s: 0.7, l: 0.6 }, deb: { to: "char", k: 0.55 }, fate: { gone: 0.1 },
    crack: { mode: "radial", n: 1.1, len: 1, br: 0.02, col: "ember" }, halo: { kind: "char", r: 1.1 }, edge: "char", fill: "char", fx: "ember", fxD: 0.005, glow: [255, 128, 40] },
  /* acid     */ { acc: [80, 0.55, 0.38], ramp: { k: 0.2, s: 0.85, sa: 0.03, l: 0.85 }, deb: { to: "acc", k: 0.2, holes: 0.3 }, frac: { ring: 0.8 }, fate: { gone: 0.22, thr: 0.6 },
    crack: { mode: "radial", n: 0.5, len: 0.7, br: 0, col: "acc" }, halo: { kind: "stain", r: 0.95 }, edge: "pitted", fill: "acid", fx: "bubble", fxD: 0.002, glow: [170, 255, 70], glowK: 0.75 },
  /* lightning*/ { acc: [205, 0.45, 0.7], ramp: { k: 0.15, s: 0.6, l: 0.85 }, deb: { to: "char", k: 0.25 }, frac: { spokes: 0.8, ring: 1.4 }, fate: { thr: 1.2 },
    crack: { mode: "bolt", n: 1, len: 1.25, br: 0, col: "bolt", always: true }, halo: { kind: "burn", r: 0.12 }, edge: "glassy", fill: "glass", fx: "spark", fxD: 0, glow: [175, 220, 255] },
  /* arcane   */ { acc: [280, 0.55, 0.6], ramp: { k: 0.25, s: 0.9, sa: 0.03, l: 0.9 }, deb: { to: "acc", k: 0.14 }, frac: { swirl: 0.13 },
    crack: { mode: "spiral", n: 1.3, len: 1.2, br: 0.03, col: "arc" }, halo: { kind: "motes", r: 0.6 }, edge: "rune", fill: "rune", fx: "mote", fxD: 0.0012, glow: [200, 120, 255] },
  /* impact   */ { acc: [32, 0.22, 0.5], ramp: { k: 0, s: 0.9, l: 0.82 }, frac: { spokes: 1.45, ring: 1.25 }, fate: { gone: -0.1, thr: 1.15 },
    crack: { mode: "radial", n: 2.4, len: 1.6, br: 0, col: "ink", straight: true, always: true }, halo: { kind: "pressed", r: 1.0 }, edge: "pressed", fill: "bowl", fx: "dust", fxD: 0.006, glow: null },
  /* claws    */ { acc: [12, 0.3, 0.42], ramp: null, frac: { along: 0.35 }, fate: { thr: 0.7 },
    crack: { mode: "parallel", n: 1, len: 1.2, br: 0, col: "ink", always: true }, halo: { kind: "scrape", r: 1.1 }, edge: "scraped", fill: "groove", fx: "splinter", fxD: 0.025, glow: null },
  /* water    */ { acc: [205, 0.45, 0.42], ramp: { k: 0.2, s: 0.9, l: 0.8 }, deb: { to: "wet", k: 0.3 }, frac: { ring: 1.2 }, fate: { gone: 0.1, thr: 0.5 },
    crack: { mode: "radial", n: 0.4, len: 0.8, br: 0, col: "ink" }, halo: { kind: "wet", r: 0.5 }, edge: "smooth", fill: "silt", fx: "drop", fxD: 0.01, glow: null },
  /* decay    */ { acc: [96, 0.45, 0.33], ramp: { k: 0.28, s: 0.85, l: 1.0 }, deb: { to: "moss", k: 0.3 }, frac: { ring: 0.85 }, fate: { gone: 0.15, thr: 0.35 },
    crack: { mode: "root", n: 1.4, len: 1.1, br: 0.06, col: "root", always: true }, halo: { kind: "moss", r: 0.75 }, edge: "moss", fill: "moss", fx: "spore", fxD: 0.0015, glow: null },
  /* frost    */ { acc: [203, 0.32, 0.78], ramp: { k: 0.35, s: 0.7, sa: 0.03, l: 1.05 }, deb: { to: "ice", k: 0.22, rim: true }, frac: { spokes: 1.2, ring: 0.9 },
    crack: { mode: "crystal", n: 1.6, len: 1.1, br: 0.14, col: "ice", always: true }, halo: { kind: "rime", r: 0.9 }, edge: "frost", fill: "ice", fx: "glint", fxD: 0.0008, glow: null }
];
/**
 * Claws: the FURROWS of one swipe - 3 parallel gouges (4 when the impact's radius rounds to 10 or more: the entry's streaks count the
 * same way, cause-fx.mjs clawCount), across the area's axis at q (art px from its centre), each with its own length and offset along
 * it and the same half-width at its middle (tapering to its ends).
 */
export function clawLanes(maxD, Rr, seed) {
  const n = clawCount(Rr), wid = Math.max(3, maxD), span = wid * 1.7, step = span / n;
  const q = [], len = [], p0 = [];
  for ( let k = 0; k < n; k++ ) {
    q.push(-span / 2 + (k + 0.5) * step + (h2(k, 1, seed + 591) - 0.5) * step * 0.2);
    len.push(wid * (1.05 + 0.3 * h2(k, 2, seed + 592)) * (k === 0 || k === n - 1 ? 0.82 : 1));
    p0.push((h2(k, 3, seed + 593) - 0.5) * wid * 0.3);
  }
  return { n, q, len, p0, hw: step * 0.3 };
}
export const clawCount = (Rr) => Math.round(Rr) >= 10 ? 4 : 3;
/** A cause by index (null for 0 and anything unknown). */
export const causeRow = (c) => CAUSE[c | 0] ?? null;

/** The cause's colours on this map: accent (+ light and dark), and what lies beneath washed towards it. */
function causePalette(P, cz, cls) {
  const [h, s, l] = cls.hsl, [ah, as, al] = cz.acc;
  const aH = mixHue(h, ah, 0.88), aS = clamp(as * 0.85 + s * 0.15, 0, 1), aL = clamp(al + (l - 0.45) * 0.25, 0.08, 0.92);
  P.acc = hsl2rgb(aH, aS, aL);
  P.accHi = hsl2rgb(aH + 8, clamp(aS * 0.8, 0, 1), clamp(aL + 0.2, 0, 0.97));
  P.accLo = hsl2rgb(aH - 10, clamp(aS * 1.05, 0, 1), clamp(aL * 0.55, 0.04, 0.6));
  const rz = cz.ramp;
  if ( rz ) {
    const tint = (c) => { const [ch, cs, cl] = rgb2hsl(c[0], c[1], c[2]); return hsl2rgb(mixHue(ch, aH, rz.k), clamp(cs * rz.s + (rz.sa ?? 0), 0, 1), clamp(cl * rz.l, 0, 0.97)); };
    P.ramp = P.ramp.map(tint); P.strata = P.strata.map(tint); P.dust = tint(P.dust); P.ink = mul(P.ramp[0], 0.8);
  }
  P.glow = cz.glow ?? null;
}

/**
 * A cause's treatment of an area, shared by every kind (drawBase below) and the tear (tear.mjs): the exposed layer (fill), the torn
 * lip (lip), the halo on the ground around (halo), the hairline cracks (crackLines) and the specks (fx). One row of the CAUSE table
 * drives it all. The caller hands in how to read and write its own pixels:
 *   cz, pal, seed, W, H, mapAt(i) -> [r, g, b] (what lies there before this cause's touch), put(x, y, col[, a]), glow(x, y, col[, a]),
 *   isIn(x, y) (this area's own pixel), inside (Uint8Array: any damage), din (distance inside), maxD, E0 {x, y}, Rr (impact reach),
 *   C { cx, cy, axis, maxD, px, keep (Set), cracks }, haloR (the cause halo's radius)
 */
export function causeKit(K) {
  const { cz, pal, seed, W, H, mapAt, put, glow, isIn, inside, din, maxD, E0, Rr, C, haloR } = K;
  const rp = pal.ramp, rune = {};
  // impact: the radial fracture rays of the compact crater (angles, reach as a share of the impact's radius)
  const nRay = cz.fill === "bowl" ? 7 + Math.floor(h2(1, 2, seed + 533) * 4) : 0;
  const impactRays = Array.from({ length: nRay }, (_, k) => (k + 0.25 + 0.5 * h2(k, 3, seed + 534)) / nRay * Math.PI * 2);
  const impactLen = Array.from({ length: nRay }, (_, k) => 0.7 + 0.4 * h2(k, 4, seed + 535));
  // claws: the furrows (clawLanes, shared with the scratches past the damage and with the entry's streaks)
  const lanes = cz.fill === "groove" ? clawLanes(maxD, Rr, seed) : null;
  const clawAt = (x, y) => {
    const ax = C.axis, q = (x + 0.5 - C.cx) * -ax[1] + (y + 0.5 - C.cy) * ax[0], p = (x + 0.5 - C.cx) * ax[0] + (y + 0.5 - C.cy) * ax[1];
    let k = 0; for ( let j = 1; j < lanes.n; j++ ) if ( Math.abs(q - lanes.q[j]) < Math.abs(q - lanes.q[k]) ) k = j;
    const t = (p - lanes.p0[k]) / lanes.len[k], taper = t * t < 1 ? Math.pow(1 - t * t, 0.6) : 0, hw = lanes.hw * taper, dq = q - lanes.q[k];
    const inF = hw > 0.45 && Math.abs(dq) < hw;
    return { in: inF, dq, hw, lip: !inF && taper > 0.15 && Math.abs(dq) < hw + 1.2 ? (dq < 0 ? -1 : 1) : 0, k, t };
  };
  /** The cause's treatment of the exposed layer at (x, y); null when it drew the pixel itself (emissive). */
  function fill(x, y, col, depth, dn, lit) {
    switch ( cz.fill ) {
      case "char": {   // charred, with glowing fissures deep in the burn
        col = mix(col, pal.char[clamp(Math.floor(1 + lit * 2 + bayer(x, y)), 0, 4)], clamp(0.35 + depth * 1.3 + (vnoise(x / 2.5, y / 2.5, seed + 501) - 0.5) * 0.5, 0, 0.92));
        if ( depth > 0.3 && Math.abs(vnoise(x / 4, y / 4, seed + 502) - 0.5) < 0.014 && vnoise(x / 7, y / 7, seed + 504) > 0.42 ) { glow(x, y, pal.ember[(h2(x, y, seed + 503) * 2) | 0], 230); return null; }
        return col;
      }
      case "acid": {   // round bubbling PITS eaten into the deeper parts (a dark eaten centre, a wet bright meniscus, a bead of light),
        // the rock between them eaten smooth in one even tone (no noise-shaped pools: they read as swirls and glyphs)
        if ( depth > 0.2 ) {
          const cs = 6, gx = Math.floor(x / cs), gy = Math.floor(y / cs);
          for ( let j = -1; j <= 1; j++ ) for ( let i = -1; i <= 1; i++ ) {
            const cx = gx + i, cy = gy + j; if ( h2(cx, cy, seed + 514) > 0.6 ) continue;
            const px = (cx + 0.2 + 0.6 * h2(cx, cy, seed + 515)) * cs, py = (cy + 0.2 + 0.6 * h2(cx, cy, seed + 516)) * cs;
            const r = 1.1 + 1.6 * h2(cx, cy, seed + 517) * Math.min(1, depth * 1.6), d = Math.hypot(x + 0.5 - px, (y + 0.5 - py) * 1.15);
            if ( d >= r ) continue;
            if ( d < r - 1 ) { if ( x + 1 === Math.round(px) && y + 1 === Math.round(py) ) { glow(x, y, pal.accHi, 170); return null; } return mix(pal.accLo, pal.ink, 0.45); }
            glow(x, y, (y + 0.5 > py) ? pal.acc : mix(pal.acc, pal.accLo, 0.4), 140); return null;
          }
        }
        return mix(col, pal.accLo, 0.12 + depth * 0.22);
      }
      case "glass": {  // fused glassy ground towards the strike, specks of light, veins of light near it
        // (a pale fused-glass core at the strike, a scorched dark band round it)
        const fz = clamp(dn * 1.7 - 0.6, 0, 1);
        if ( fz <= 0 ) return mix(col, pal.char[0], 0.4 * clamp(dn * 2.2, 0, 1));
        let c = mix(col, mix(pal.accHi, rp[2], 0.5), fz * 0.72);
        // (a rare glassy glint; no veins of light - those read as a web: the strike's own trail carries the light)
        if ( vnoise(x / 2, y / 2, seed + 521) > 0.8 && h2(x, y, seed + 523) < 0.25 ) c = mix(c, pal.accHi, 0.6);
        return c;
      }
      case "rune": {   // a dashed rune circle round the impact, with ticks pointing in
        const dx = x + 0.5 - E0.x, dy = (y + 0.5 - E0.y) / 0.82, d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) + Math.PI;
        // never a drawn circle: the ring's radius wanders with the angle, some runes are missing
        const sf = ang / (Math.PI * 2) * 18, seg = Math.floor(sf), gone = h2(seg, 5, seed + 571) < 0.3;
        const rr = Rr * 0.58 * (1 + 0.12 * Math.sin(2 * ang + seed % 7) + 0.07 * Math.sin(5 * ang + seed % 11)) + (h2(seg, 6, seed + 572) - 0.5) * 1.2;
        // inscribed SIGILS between short arcs of the ring (pixel-fx sigilStrokes: curved and angular strokes with ticks, never a cross)
        const sig = (rune.sig ??= (() => {
          const S = new Set(); if ( Rr < 5 ) return S;
          const n = clamp(Math.round(Rr * 0.58 * Math.PI * 2 / 10), 4, 9), sz = clamp(Rr * 0.09, 1.5, 3);
          for ( let q = 0; q < n; q++ ) {
            const a = (q + 0.5) / n * Math.PI * 2 + h2(q, 7, seed + 573) * 0.3, r2 = Rr * 0.58 * (0.92 + 0.12 * h2(q, 8, seed + 573));
            for ( const [gx, gy] of sigilCells(seed * 7 + q, E0.x + Math.cos(a) * r2, E0.y + Math.sin(a) * r2 * 0.82, sz) ) S.add(gy * W + gx);
          }
          return S;
        })());
        if ( sig.has(y * W + x) ) { glow(x, y, h2(x, y, seed + 574) < 0.25 ? pal.accHi : pal.acc, 235); return null; }
        if ( gone ) return mix(col, pal.accLo, clamp(depth * 0.3, 0, 0.25));
        if ( Rr >= 5 && Math.abs(d - rr) < 0.55 && seg % 3 === 0 ) { glow(x, y, pal.acc, 190); return null; }
        return mix(col, pal.accLo, clamp(depth * 0.3, 0, 0.25));
      }
      case "bowl": {   // a COMPACT CRATER pressed in hard: a pale compacted dusty bowl (pressed in, not dug out), lit from the top
        // left, a small dark core where the blow landed, straight radial fracture lines from it (a dark line with a lit edge)
        const dx = x + 0.5 - E0.x, dy = (y + 0.5 - E0.y) / 0.85, rr = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
        let c = mul(mix(col, pal.dust, 0.7 * (1 - dn * 0.4)), clamp(1.15 + lit * 0.32 - depth * 0.22, 0.6, 1.4));
        if ( rr < Math.max(1.2, Rr * 0.16) ) return mix(pal.ink, c, 0.25);
        const nr = impactRays.length;
        for ( let k = 0; k < nr; k++ ) {
          let da = ang - impactRays[k]; da = Math.atan2(Math.sin(da), Math.cos(da));
          const off = da * rr;
          if ( rr > Rr * 0.16 && rr < Rr * impactLen[k] ) { if ( Math.abs(off) < 0.55 ) return mix(c, pal.ink, 0.82); if ( off > 0.55 && off < 1.5 ) return mul(c, 1.16); }
        }
        return c;
      }
      case "groove": { // CLAW FURROWS: 3-4 parallel, tapering gouges (clawLanes), each with a lit and a shaded lip; between them the ground
        // stays, torn into turf ridges (the surface a little lifted and broken), not a crater
        const L = clawAt(x, y);
        if ( L.in ) {
          const f = L.dq / L.hw;   // -1..1 across the furrow
          return f < -0.45 ? mix(rp[4], [235, 225, 205], 0.2) : f > 0.5 ? mix(rp[0], pal.ink, 0.3) : mix(rp[0], pal.ink, 0.55 - 0.25 * (1 - Math.abs(f)) * depth);
        }
        const m = mapAt(y * W + x);
        if ( L.lip === -1 ) return mul(m, 1.22);
        if ( L.lip === 1 ) return mix(m, pal.ink, 0.5);
        const lump = vnoise(x / 2.5, y / 2.5, seed + 532);
        return mul(mix(m, col, 0.25), lump > 0.66 ? 1.12 : lump < 0.3 ? 0.84 : 1);
      }
      case "silt": {   // washed out: WATER stands in the pit (a calm blue-green surface, a pale meniscus at its shore, slow ripple
        // arcs), a wet dark band above it, sediment bands on the slope running with the flow (the area's axis)
        const wl = 0.3;
        if ( depth > wl ) {
          if ( depth < wl + 0.045 ) return mix(pal.waterR[4], [226, 240, 240], 0.35);
          const dx = x + 0.5 - E0.x, dy = (y + 0.5 - E0.y) / 0.8, rr = Math.hypot(dx, dy);
          let c = mix(depth > wl + 0.3 ? pal.waterR[1] : pal.waterR[2], [48, 112, 110], 0.28);
          const rip = (rr + (vnoise(x / 6, y / 6, seed + 543) - 0.5) * 2.4) % 5;
          // (a few short broken arcs, never a bullseye of rings)
          if ( rip < 0.75 && h2(Math.floor((Math.atan2(dy, dx) + Math.PI) * 2.2), Math.floor(rr / 5), seed + 544) < 0.3 ) c = mix(c, pal.waterR[4], 0.5);
          return c;
        }
        if ( depth > wl - 0.11 ) return mix(mul(col, 0.5), pal.waterR[1], 0.3);
        const q = (x + 0.5 - C.cx) * C.axis[0] + (y + 0.5 - C.cy) * C.axis[1];
        return ((depth * 6 + q * 0.12 + vnoise(x / 5, y / 5, seed + 542) * 1.2) % 1) < 0.2 ? mix(rp[3], pal.dust, 0.5) : mul(col, 0.88);
      }
      case "moss": {   // a SAGGING rotten slump: the depth shading deepened (lit slopes up-left a step lighter, the floor sunk), moss in
        // clumps on the lit parts only (a lit top, a dark row under it), no pale specks
        const c = mul(col, clamp(1 + lit * 0.38 - depth * 0.42, 0.42, 1.3));
        const n = vnoise(x / 3.5, y / 3.5, seed + 551);
        if ( lit > -0.05 && n > 0.52 ) return n > 0.64 ? pal.acc : mix(pal.acc, pal.accLo, 0.5);
        if ( lit > -0.05 && vnoise(x / 3.5, (y - 1) / 3.5, seed + 551) > 0.52 ) return mix(pal.accLo, pal.ink, 0.4);
        return mix(c, pal.accLo, 0.1);
      }
      case "ice": {    // a FACETED ice sheet: six crystal facets meeting at the impact, their edges on the 30 / 90 / 150 degree lines, each
        // facet lit by how it faces the top-left light; bright hairlines along the facet edges
        if ( depth < 0.15 ) return mix(col, pal.accHi, 0.2);
        const dx = x + 0.5 - E0.x, dy = y + 0.5 - E0.y, rr = Math.hypot(dx, dy), u = (Math.atan2(dy, dx) - Math.PI / 6) / (Math.PI / 3);
        const s = ((Math.floor(u) % 6) + 6) % 6, fu = u - Math.floor(u);
        let c = mul(mix(col, pal.acc, 0.55), [0.74, 0.9, 1.1, 1.26, 1.04, 0.84][s]);
        // (the facet edges broken: only along the middle of each, never a full cross through the centre)
        if ( rr > Rr * 0.28 && rr < Rr * 0.8 && Math.min(fu, 1 - fu) * rr * Math.PI / 3 < 0.5 && h2(Math.floor(rr / 2.5), s, seed + 562) < 0.7 ) c = mix(c, pal.accHi, 0.35);
        return c;
      }
    }
    return col;
  }
  /** The cause's torn lip at (x, y) (s: the severity next to it). */
  function lip(x, y, i, s) {
    const m = mapAt(i), hv = h2(x, y, seed + 621), soft = s < 1.6;
    let c;
    switch ( cz.edge ) {
      case "char": if ( hv < 0.1 && !soft ) return glow(x, y, pal.ember[0], 220); c = pal.char[0]; break;
      case "pitted": c = hv < 0.45 ? pal.ink : hv < 0.75 ? pal.accLo : mix(m, pal.acc, 0.5); break;
      // (fused glass beads now and then on a scorched lip - a white lip all round read as a sticker outline)
      case "glassy": if ( hv < 0.03 && !soft ) return glow(x, y, pal.accHi, 140); c = hv < 0.4 ? mix(m, pal.accHi, 0.3) : mix(m, pal.char[0], 0.55); break;
      case "rune": if ( hv < 0.2 && !soft ) return glow(x, y, pal.acc, 200); c = pal.ink; break;
      // impact: a pressed, heavy rim, a lit chip now and then on it
      // (the crater's crest pressed up and lit, a dark notch now and then: not an inked outline)
      case "pressed": c = hv < 0.15 ? mul(pal.ink, 0.9) : hv < 0.6 ? mul(m, 1.3) : mul(m, 1.12); break;
      case "scraped": c = hv < 0.35 ? mul(m, 1.25) : mix(m, pal.ink, 0.7); break;
      // water: a smooth, scoured, wet lip (dark and blue-washed, no ink)
      case "smooth": c = mix(mix(m, pal.waterR[1], 0.35), pal.ink, 0.3); break;
      case "moss": c = hv < 0.5 ? pal.acc : pal.accLo; break;
      // frost: a soft rime, a rare bright crystal - never a white outline
      case "frost": c = hv < 0.07 ? pal.accHi : hv < 0.5 ? mix(m, pal.accHi, 0.16) : mix(m, pal.ink, 0.4); break;
      default: c = pal.ink;
    }
    put(x, y, soft ? mix(m, c, 0.6) : c);
  }
  /** The cause's halo on the intact ground at (x, y), d from the damage. */
  function halo(x, y, i, d) {
    const k = Math.pow(1 - d / haloR, 1.3), n = vnoise(x / 2.4, y / 2.4, seed + 611) * 0.75 + h2(x, y, seed + 612) * 0.25, hv = h2(x, y, seed + 613), m = mapAt(i);
    switch ( cz.halo.kind ) {
      case "char": if ( n < k * 0.4 && hv < 0.025 ) glow(x, y, pal.ember[1], 200); else if ( n < k * 0.9 ) put(x, y, n < k * 0.4 ? pal.char[0] : mix(m, pal.char[1], 0.65)); break;
      // acid: a green-yellow BLEED fading outward in three smooth bands (no dark specks, no dithered cloud)
      case "stain": { const f = k * (0.65 + 0.35 * vnoise(x / 5, y / 5, seed + 614)), b = Math.floor(f * 3.2); if ( b > 0 ) put(x, y, mix(m, mix(pal.acc, pal.accHi, 0.3), 0.14 * b)); break; }
      case "burn": if ( n < k * 0.4 ) put(x, y, mul(m, 0.62)); break;
      case "motes": if ( n < k * 0.35 ) put(x, y, mix(m, pal.acc, 0.2)); break;
      case "pressed": {
        // impact: the ground pressed down round the rim, shock streaks radiating out, stone chips flung on it (lit top, dark under)
        const ang = Math.atan2(y - E0.y, x - E0.x), streak = h2(Math.floor((ang + Math.PI) * 11), 1, seed + 615) < 0.32;
        // the raised rim: a lit crest right at the lip, its shaded outer foot, then shock streaks out; a rare flung chip
        if ( hv < k * 0.02 ) { put(x, y, mul(m, 1.3)); if ( !inside[i + W] ) put(x, y + 1, mul(m, 0.45)); }
        else if ( d < 2.6 ) put(x, y, mix(mul(m, 1.25), pal.dust, 0.25));
        else if ( d < 3.6 + C.maxD * 0.1 ) put(x, y, mul(m, 0.72));
        else if ( streak && n < k * 0.95 ) put(x, y, mul(m, 0.8));
        break;
      }
      case "scrape": {
        // claws: parallel scratches along the stroke through the ground beside it, a bright gouge with a dark lip under it
        // (the furrows run on past the damage as scratches on their own lanes, a lit lip under a dark groove; nothing between)
        const L = clawAt(x, y), ext = L.t * L.t < 1.6;
        if ( ext && Math.abs(L.dq) < 0.6 ) put(x, y, mix(m, pal.ink, 0.6 * Math.min(1, k * 1.6)));
        else if ( ext && L.dq < -0.6 && L.dq > -1.6 ) put(x, y, mul(m, 1 + 0.25 * Math.min(1, k * 1.6)));
        break;
      }
      case "wet": {
        // water erosion: wet-darkened ground, sediment fanned out in bands, a few standing drops
        const band = ((d * 0.55 + vnoise(x / 6, y / 6, seed + 616) * 1.8) % 1) < 0.18;
        if ( hv < k * 0.03 ) put(x, y, pal.waterR[4]);
        else if ( band && d > 2 && n < k * 1.2 ) put(x, y, mix(m, pal.dust, 0.55));
        else if ( n < k * 0.9 ) put(x, y, mix(mul(m, 0.6), pal.waterR[2], 0.24));
        break;
      }
      case "moss": if ( n < k * 0.5 ) put(x, y, n < k * 0.35 ? pal.acc : mix(m, pal.accLo, 0.55)); break;
      // frost: a soft rime fading out, a few ICE SHARDS (3-px needles at 30 / 90 / 150 degrees) - never a sprinkle of white dots
      case "rime": {
        if ( n < k * 0.85 ) put(x, y, mix(m, pal.accHi, 0.22 + 0.25 * k));
        if ( hv < k * 0.006 ) { const a = (1 + 2 * Math.floor(h2(x, y, seed + 617) * 3)) * Math.PI / 6; for ( let q = 0; q < 3; q++ ) put(Math.round(x + Math.cos(a) * q), Math.round(y + Math.sin(a) * q), q ? mix(pal.accHi, [255, 255, 255], 0.2) : [248, 252, 255]); }
        break;
      }
    }
  }
  /** The cause's hairline cracks: glowing embers, a bolt's burn with a bright root, arcane light, ice, roots. */
  function crackLines(paths) {
    const col = cz.crack?.col ?? "ink";
    for ( const path of paths ) path.forEach((i, k) => {
      const x = i % W, y = (i - x) / W, m = mapAt(i), hv = h2(x, y, seed + 631), root = k < path.length * 0.5;
      switch ( col ) {
        case "ember": if ( root && hv < 0.45 ) glow(x, y, pal.ember[hv < 0.2 ? 1 : 0], 220); else put(x, y, mix(m, pal.char[0], 0.85)); break;
        case "bolt": {
          // the fused trail of a strike: a dark scorched channel with a thin bright residual along the main channel's root half,
          // two pixels thick there (tapering), a faint burn shoulder; the forks thinner and darker, the twigs hairlines
          const dep = path.depth | 0, f = k / path.length;
          // (one continuous fused line along the main channel and the forks' roots: a line of light, never loose glint blobs)
          if ( (!dep && f < 0.75) || (dep === 1 && f < 0.35) ) glow(x, y, !dep && hv < 0.3 ? [235, 245, 255] : pal.accHi, dep ? 150 : 210);
          else put(x, y, mix(m, mix(pal.char[0], pal.accLo, 0.25), dep > 1 ? 0.6 : 0.88));
          if ( !dep && f < 0.6 && y + 1 < H ) put(x, y + 1, mix(mapAt(i + W), pal.char[0], f < 0.3 ? 0.8 : 0.55));
          if ( dep < 2 && y > 0 && !inside[i - W] && h2(x, y, seed + 633) < 0.6 ) put(x, y - 1, mix(mapAt(i - W), pal.char[1], 0.3));
          break;
        }
        case "acc": put(x, y, mix(m, pal.accLo, 0.85)); break;
        case "arc": if ( (k & 1) === 0 ) glow(x, y, pal.acc, 180); else put(x, y, mix(m, pal.accLo, 0.8)); break;
        case "ice": put(x, y, mix(pal.accHi, [255, 255, 255], 0.35)); if ( y + 1 < H && !inside[i + W] ) put(x, y + 1, mix(mapAt(i + W), pal.ink, 0.35)); break;
        case "root": put(x, y, mix(m, mix(pal.accLo, pal.ink, 0.5), 0.85)); break;
        default: put(x, y, mix(m, pal.ink, 0.85));
      }
      if ( col === "ink" || col === "root" || col === "acc" ) { const j = i - W; if ( j >= 0 && !inside[j] && h2(x, y, seed + 81) < 0.5 ) put(x, y - 1, mul(mapAt(j), 1.14)); }
    });
  }
  /** The cause's specks in the ruin (deterministic): embers, bubbles, sparks, motes, dust, splinters, drops, spores, glints. */
  function fx(px, skip) {
    const D = cz.fxD ?? 0.02, plus = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for ( const i of px ) {
      if ( skip?.(i) ) continue;
      const x = i % W, y = (i - x) / W, dn = Math.min(1, din[i] / maxD);
      const cn = vnoise(x / 4, y / 4, seed + 600);
      if ( cn < 0.62 ) continue;
      // the cluster is a tonal patch in the cause's colour; only a handful of specks stay in it (a few larger shapes, no confetti)
      if ( cn > 0.66 ) { const tc = { ember: pal.ember[2], bubble: pal.accLo, spark: pal.accHi, mote: pal.acc, spore: pal.acc, glint: pal.accHi, dust: pal.dust, drop: pal.waterR[2], splinter: rp[3] }[cz.fx]; if ( tc ) put(x, y, tc, Math.round(40 + (cn - 0.66) * 260)); }
      if ( h2(x, y, seed + 601) >= D * 1.4 * (0.4 + dn) ) continue;
      const hv = h2(x, y, seed + 602);
      switch ( cz.fx ) {
        case "ember": glow(x, y, pal.ember[(hv * 3) | 0], 255); break;
        case "bubble": glow(x, y, pal.accHi, 160); if ( isIn(x + 1, y) ) put(x + 1, y, pal.acc); if ( isIn(x, y + 1) ) put(x, y + 1, pal.accLo); break;
        case "spark": glow(x, y, hv < 0.5 ? [255, 255, 255] : pal.accHi, 255); break;
        case "mote": glow(x, y, pal.accHi, 230); if ( hv < 0.3 && isIn(x + 1, y + 1) ) glow(x + 1, y + 1, pal.acc, 140); break;
        case "dust": put(x, y, mix(pal.dust, rp[4], 0.5)); break;
        case "splinter": for ( let k = 0; k < 3; k++ ) { const X = Math.round(x + C.axis[0] * k), Y = Math.round(y + C.axis[1] * k); if ( isIn(X, Y) ) put(X, Y, k ? rp[3] : rp[4]); } break;
        case "drop": put(x, y, pal.waterR[4]); if ( isIn(x, y + 1) ) put(x, y + 1, pal.waterR[1]); break;
        case "spore": put(x, y, mix(pal.accHi, [230, 220, 200], 0.4)); if ( isIn(x + 1, y) ) put(x + 1, y, pal.accHi); if ( isIn(x, y + 1) ) put(x, y + 1, rp[1]); break;
        case "glint": put(x, y, hv < 0.3 ? [255, 255, 255] : pal.accHi); if ( hv < 0.2 ) for ( const [a, b] of plus ) if ( isIn(x + a, y + b) ) put(x + a, y + b, pal.accHi); break;
      }
    }
  }
  return { fill, lip, halo, crackLines, fx };
}

/* ================================================================ the bake */

/** Settings that only change playback, not the picture (never part of a bake key). */
export const LIVE_PARAMS = new Set(["anim", "idle", "fxWho", "entry", "entrySpeed", "entryPower"]);
function fnvInts(h, ...vals) { for ( const v of vals ) { h = Math.imul(h ^ (v & 0xffff), 16777619); h = Math.imul(h ^ ((v >>> 16) & 0xffff), 16777619); } return h; }
function fnvStr(s, h = 2166136261) { for ( let i = 0; i < s.length; i++ ) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h; }

/**
 * The whole bake, AREA BY AREA. Every damaged area (a connected part of the ragged field) is baked in its own window (its box plus
 * room for thrown debris, a function of the area alone), from window-local inputs only, and its result is cached by a hash of those
 * inputs. So an area looks exactly the same whatever else is painted elsewhere on the map (no "re-render" of earlier strokes), and
 * a new stroke only bakes the areas it touched.
 *
 * @param {object} I
 *   mask Uint8Array (mw*mh), mw, mh, K (art px per mask px), aw, ah (art grid), seed, params,
 *   map: { w: aw, h: ah, data: RGBA of the WHOLE scene at art resolution }, mapKey (identifies the map pixels), onProgress(p),
 *   paths: brush paths [[x, y], ...] in art px (used when params.directional)
 * @param {Map} [cache]  area hash -> area result (kept by the worker between bakes)
 * @returns {{ sheet: {w, h, data: Uint8ClampedArray}, metaRows, meta: Int16Array, count, stats }}
 */
export function bake(I, cache = null) {
  const t0 = Date.now();
  const P = I.params, seed = I.seed | 0, K = I.K, AW = I.aw, AH = I.ah;
  const progress = I.onProgress ?? (() => {});
  const jag = P.jagged ? clamp(P.jag ?? 0.6, 0, 1) : 0;
  // an area's hash holds only the settings that change it: the torn-border amount only when torn borders are on (below), "follows
  // the stroke" only through the brush paths that cross the area's window. Toggling a setting an area does not use is a cache hit.
  // the scene's default cause too: it only counts for strokes without a cause of their own (below, per stroke)
  const OWN = new Set(["jagged", "jag", "directional", "cause"]);
  const paramStr = Object.keys(P).filter((k) => !LIVE_PARAMS.has(k) && !OWN.has(k)).sort().map((k) => `${k}=${JSON.stringify(P[k])}`).join("|");
  const head = fnvInts(fnvStr(`${CORE_VERSION}|${seed}|${paramStr}|${I.mapKey ?? ""}|${AW}x${AH}`), jag ? Math.round(jag * 1000) + 1 : 0);

  /* ---------------------------------------------------------------- 1. damage objects: one per brush stroke */
  // Every stroke is an object of its own (I.objects, in creation order): its field is read from its own pixels only, so it looks the
  // same whatever was painted before or after it, whatever the type. A later stroke covers an earlier one at display time; nothing
  // here ever reads another object. An object's connected parts are baked separately; their random streams come from the stroke's id
  // and their first pixel.
  const stats = { areas: 0, shards: 0, chips: 0, pulverised: 0, culled: 0, materials: [], baked: 0, reused: 0 };
  const edge = clamp(P.edge ?? 0.7, 0, 1);
  const comps = [];
  // (`skip`: a stroke the caller does not want baked this time - its record is elsewhere; `k`: an erase stroke)
  (I.objects ?? []).forEach((ob, index) => { if ( !ob.k && !ob.skip ) for ( const c of partsOf(ob) ) comps.push({ ...c, index, ob }); });
  if ( !comps.length ) return assemble([], stats, t0, progress);
  progress(0.2);

  function partsOf(ob) {
    const T = ob.t & 7, bytes = ob.bytes;
    // this stroke's mask alone
    const lvT = (mx, my) => { const x = mx - ob.x0, y = my - ob.y0; return (x < 0 || y < 0 || x >= ob.w || y >= ob.h) ? 0 : bytes[y * ob.w + x] & 3; };
    // ORGANIC OUTLINE: a brush stamps discs, and a disc (or a row of them, scalloped) reads as a stamp, not as broken ground. Every
    // stroke but a tear (its opening follows its spine) reads its own mask through a domain warp scaled to its brush: big lobes about
    // a brush radius apart (up to ~a fifth of the radius in or out), a finer octave, and chipped bites along the rim. Seeded by the
    // stroke's id, from its own pixels only (the same outline whatever else is painted), and everything after it (the depth, the lip,
    // the halo, the hole's cut-out) follows this one outline.
    let Rb = 0;
    {
      const md = new Float32Array(ob.w * ob.h);
      for ( let i = 0; i < md.length; i++ ) md[i] = bytes[i] ? 1e6 : 0;
      // (the border of the box counts as outside)
      const PW = ob.w + 2, PH = ob.h + 2, pd = new Float32Array(PW * PH);
      for ( let y = 0; y < ob.h; y++ ) for ( let x = 0; x < ob.w; x++ ) pd[(y + 1) * PW + x + 1] = md[y * ob.w + x];
      chamfer(pd, PW, PH);
      for ( const v of pd ) if ( v > Rb && v < 1e5 ) Rb = v;
      Rb *= K;
    }
    const org = T !== T_GASH && Rb >= 3, OA = org ? clamp(Rb * 0.27, 1.2, 12) : 0, OL = Math.max(6, Rb * 0.95), OL2 = Math.max(3, Rb * 0.42);
    const os = (fnvStr(String(ob.id)) & 0xffff) + seed * 7;
    // a cave-in: an organic pit (a tap) or a trench along its followed path, never a disc or a chain of stamps (collapse.mjs)
    const CO = T === T_COLLAPSE && Rb >= 3 ? collapseOutline({ ob, K, Rb, os, directional: !!P.directional, lvT }) : null;
    const FM = 4 + Math.ceil(OA * 1.3) + (jag ? 22 : 0) + (CO?.margin ?? 0);
    const FX = Math.max(0, ob.x0 * K - FM), FY = Math.max(0, ob.y0 * K - FM);
    const FW = Math.min(AW, (ob.x0 + ob.w) * K + FM) - FX, FH = Math.min(AH, (ob.y0 + ob.h) * K + FM) - FY, FN = FW * FH;
    if ( FW <= 0 || FH <= 0 ) return [];
    const inside = new Uint8Array(FN), sev = new Float32Array(FN), frag = new Int32Array(FN);
    for ( let y = 0; y < FH; y++ ) for ( let x = 0; x < FW; x++ ) {
      const ax = FX + x, ay = FY + y;
      // torn: the mask is read through a warp (two octaves, up to ~7 art px), so the outline tears into lobes and inlets
      let wx = 0, wy = 0;
      if ( org ) {
        wx = (vnoise(ax / OL, ay / OL, os + 1) - 0.5) * 2.4 * OA + (vnoise(ax / OL2, ay / OL2, os + 3) - 0.5) * 0.9 * OA;
        wy = (vnoise(ax / OL, ay / OL, os + 2) - 0.5) * 2.4 * OA + (vnoise(ax / OL2, ay / OL2, os + 4) - 0.5) * 0.9 * OA;
      }
      if ( jag ) {
        const A = 7 * jag;
        wx += (vnoise(ax / 7, ay / 7, seed + 310) - 0.5) * 2 * A + (vnoise(ax / 2.5, ay / 2.5, seed + 312) - 0.5) * 0.7 * A;
        wy += (vnoise(ax / 7, ay / 7, seed + 311) - 0.5) * 2 * A + (vnoise(ax / 2.5, ay / 2.5, seed + 313) - 0.5) * 0.7 * A;
      }
      if ( CO?.warp ) { const q = CO.warp(ax, ay); wx += q[0]; wy += q[1]; }
      let bil;
      if ( CO?.field ) { bil = CO.field(ax + wx * 0.6, ay + wy * 0.6); if ( !(bil > 0) ) continue; }
      else if ( CO?.sample ) { bil = CO.sample((ax + wx + 0.5) / K - 0.5, (ay + wy + 0.5) / K - 0.5); if ( !(bil > 0.05) ) continue; }
      else {
        const mx = (ax + wx + 0.5) / K - 0.5, my = (ay + wy + 0.5) / K - 0.5;
        const ix = Math.floor(mx), iy = Math.floor(my), fx = mx - ix, fy = my - iy;
        const a = lvT(ix, iy), b = lvT(ix + 1, iy), c = lvT(ix, iy + 1), d = lvT(ix + 1, iy + 1);
        if ( !(a | b | c | d) ) continue;
        bil = lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
      }
      let n = (vnoise(ax / 3.1, ay / 3.1, seed) - 0.5) * 1.1 * edge + (h2(ax, ay, seed + 7) - 0.5) * 0.45 * edge;
      if ( jag ) {
        // torn: three octaves of roughness, and bites and teeth in 2 x 2 art-pixel blocks (stepped, chipped lips)
        n += ((vnoise(ax / 1.7, ay / 1.7, seed + 301) - 0.5) * 1.0 + (vnoise(ax / 5.3, ay / 5.3, seed + 302) - 0.5) * 1.5 + (vnoise(ax / 11, ay / 11, seed + 303) - 0.5) * 1.2) * jag;
        const cb = h2(ax >> 1, ay >> 1, seed + 304);
        if ( cb < 0.13 * jag ) n -= 1.3; else if ( cb > 1 - 0.09 * jag ) n += 1;
      }
      // chipped bites along the organic rim: where a mid-scale noise peaks, the rim is bitten in (2 x 2 steps)
      if ( org ) { const b = vnoise((ax >> 1) / (OL2 * 0.45), (ay >> 1) / (OL2 * 0.45), os + 5); if ( b > 0.66 ) n -= (b - 0.66) * 5.5; }
      if ( bil + n * Math.min(1, bil + 0.3) <= 0.5 ) continue;
      const i = y * FW + x;
      inside[i] = 1; sev[i] = clamp(bil, 1, 3);
    }
    // tidy: no single-pixel whiskers, no pin holes
    for ( let pass = 0; pass < 2; pass++ ) for ( let y = 1; y < FH - 1; y++ ) for ( let x = 1; x < FW - 1; x++ ) {
      const i = y * FW + x, nb = inside[i - 1] + inside[i + 1] + inside[i - FW] + inside[i + FW];
      if ( inside[i] && nb <= 1 ) inside[i] = 0;
      else if ( !inside[i] && nb >= 3 ) { inside[i] = 1; sev[i] = Math.max(1, sev[i - 1], sev[i + 1], sev[i - FW], sev[i + FW]); }
    }
    if ( jag ) {
      // torn-off fragments just outside the rim: 2 x 2 blocks a few pixels out
      const dist = new Float32Array(FN);
      for ( let i = 0; i < FN; i++ ) dist[i] = inside[i] ? 0 : 1e6;
      chamfer(dist, FW, FH);
      const reach = 2 + 2.5 * jag;
      for ( let y = 2; y < FH - 2; y++ ) for ( let x = 2; x < FW - 2; x++ ) {
        const i = y * FW + x, d = dist[i];
        if ( d < 2 || d > reach || h2((FX + x) >> 1, (FY + y) >> 1, seed + 305 + T) >= 0.03 * jag ) continue;
        inside[i] = 1; sev[i] = 1.6; frag[i] = -1;
      }
    }
    // connected parts (scan order: stable anchors)
    const lab = new Int32Array(FN).fill(-1);
    let cs = [];
    const stack = new Int32Array(FN);
    for ( let s0 = 0; s0 < FN; s0++ ) {
      if ( !inside[s0] || lab[s0] >= 0 ) continue;
      const id = cs.length, px = [];
      let sp = 0; stack[sp++] = s0; lab[s0] = id;
      while ( sp ) {
        const i = stack[--sp]; px.push(i);
        const x = i % FW, y = (i - x) / FW;
        for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) {
          const X = x + dx, Y = y + dy; if ( X < 0 || Y < 0 || X >= FW || Y >= FH ) continue;
          const j = Y * FW + X; if ( inside[j] && lab[j] < 0 ) { lab[j] = id; stack[sp++] = j; }
        }
      }
      cs.push({ id, px, anchor: s0 });
    }
    // a small piece close to a big one belongs to it (a fragment torn off its rim), as its own little plate
    const big = (c) => c.px.length >= 48;
    for ( const c of cs ) {
      if ( big(c) || !jag ) continue;
      let to = -1;
      for ( const i of c.px ) {
        const x = i % FW, y = (i - x) / FW;
        for ( let dy = -8; dy <= 8 && to < 0; dy++ ) for ( let dx = -8; dx <= 8; dx++ ) {
          const X = x + dx, Y = y + dy; if ( X < 0 || Y < 0 || X >= FW || Y >= FH ) continue;
          const l = lab[Y * FW + X]; if ( l >= 0 && l !== c.id && big(cs[l]) ) { to = l; break; }
        }
        if ( to >= 0 ) break;
      }
      if ( to < 0 ) continue;
      for ( const i of c.px ) { lab[i] = to; frag[i] = c.anchor + 1; }
      cs[to].px.push(...c.px); c.merged = true;
    }
    cs = cs.filter((c) => !c.merged && c.px.length >= 6);
    // a cave-in's reshaped outline can pinch off a small island: one pit, no stray speck or crack cluster beside it
    if ( (CO?.warp || CO?.field) && cs.length > 1 ) { const mx = Math.max(...cs.map((c) => c.px.length)); cs = cs.filter((c) => c.px.length >= mx * 0.25); }
    const F = { FX, FY, FW, FH, inside, sev, frag, lab };
    return cs.map((c) => ({ ...c, F, type: T, ax: FX + c.anchor % FW, ay: FY + Math.floor(c.anchor / FW) }));
  }

  /* ---------------------------------------------------------------- 2. per part: window, hash, cache or bake */
  const scatter = clamp(P.scatter ?? 1, 0.2, 3);
  const results = [];
  // THE SUBSTRATE (substrate.mjs): an area reads, inside its own pixels only, the PLAIN look (baked from its own data alone) of the
  // older strokes in its read set; with nothing older there it bakes exactly as before. Older strokes never read newer ones, and no
  // stroke waits for another's bake: the plain looks are baked here as needed (cached), so every stroke can be baked in any order.
  const plainOf = new Map();
  // (I.under: index -> sprites of plain looks the caller already has; I.plain: bake the requested strokes' plain looks only)
  const src = new SubstrateSource(I.objects, I.under, P, K, (j) => {
    if ( !plainOf.has(j) ) { const ob = I.objects[j], out = []; for ( const c of partsOf(ob) ) { const r = areaOf({ ...c, index: j, ob }, false); if ( r ) out.push(r); } plainOf.set(j, out); }
    return plainOf.get(j);
  });
  comps.forEach((c, k) => {
    const res = areaOf(c, !I.plain);
    if ( res ) results.push({ ...res, index: c.index });
    progress(0.2 + 0.75 * (k + 1) / comps.length);
  });
  return assemble(results, stats, t0, progress);

  /** One part in its window: cached or baked; `withSub`: over its substrate (false: its plain look, for newer strokes' substrates). */
  function areaOf(c, withSub) {
    const { FX, FY, FW, FH, sev, frag, lab } = c.F;
    let x0 = FW, y0 = FH, x1 = -1, y1 = -1;
    for ( const i of c.px ) { const x = i % FW, y = (i - x) / FW; if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y; }
    const span = Math.max(x1 - x0, y1 - y0);
    // room for everything that leaves the part at the current settings: thrown chips (throw), the halo, hairline cracks. What would
    // still reach the edge of a capped window is shortened smoothly in bakeArea (never clamped: that piled chips in straight lines and
    // cut halos and cracks along the window's edge)
    const halo = clamp(P.halo ?? 0.6, 0, 1);
    const reach = Math.max(span * 0.6 * scatter + 3 * scatter + 14, span * 0.7 * halo + 10, span * 0.55 + 12);
    const margin = Math.round(Math.min(256, Math.max(14, reach)));
    const RX = Math.max(0, FX + x0 - margin), RY = Math.max(0, FY + y0 - margin);
    const W = Math.min(AW, FX + x1 + 1 + margin) - RX, H = Math.min(AH, FY + y1 + 1 + margin) - RY, N = W * H;
    const ownId = lab[c.px[0]];
    // only this part's own pixels: everything else in its window is intact ground for it
    const win = { W, H, RX, RY, inside: new Uint8Array(N), sev: new Float32Array(N), typ: new Uint8Array(N), own: new Uint8Array(N), frag: new Int32Array(N), px: [] };
    // the window as it would be without the scene's edge (window px; beyond 0..W / 0..H where the scene cuts it): pieces are placed
    // in it, so a stroke at the border throws exactly as anywhere else; what lands beyond the scene is culled when it is packed
    win.vb = [FX + x0 - margin - RX, FY + y0 - margin - RY, FX + x1 + 1 + margin - RX, FY + y1 + 1 + margin - RY];
    win.aw = AW; win.ah = AH;
    let h = fnvInts(fnvStr(String(c.ob.id), head), RX, RY, W, H, c.type === T_FLOOD ? 0xf10d1 : c.type);   // flood: the bottom under the engine's water (flood.mjs)
    // its cause: its own, else the scene's default; part of its hash only when there is one (cause 0 keeps the old hash and bytes)
    const cause = Math.min(CAUSES.length - 1, Math.max(0, (c.ob.c | 0) || (P.cause | 0)));
    win.cause = cause;
    if ( cause ) h = fnvInts(h, 0x5ca0 + cause);
    for ( let y = 0; y < H; y++ ) {
      const fy = RY + y - FY;
      for ( let x = 0; x < W; x++ ) {
        const fx = RX + x - FX, o = y * W + x;
        let v = 0;
        if ( fx >= 0 && fy >= 0 && fx < FW && fy < FH ) {
          const i = fy * FW + fx;
          if ( lab[i] === ownId ) {
            win.inside[o] = 1; win.sev[o] = sev[i]; win.typ[o] = c.type; win.own[o] = 1; win.frag[o] = frag[i] > 0 ? frag[i] : 0; win.px.push(o);
            v = 1 | (Math.round(sev[i] * 64) << 5) | (frag[i] > 0 ? 1 << 14 : 0);
          }
        }
        h = Math.imul(h ^ v, 16777619);
      }
    }
    // follows the stroke: the stroke's own brush path (part of its hash); a tear always runs along its path (its spine)
    win.paths = [];
    if ( (P.directional || c.type === T_GASH) && c.ob.path?.length > 1 ) {
      const loc = c.ob.path.map(([x, y]) => [x - RX, y - RY]);
      win.paths.push(loc);
      for ( const [x, y] of loc ) h = fnvInts(h, Math.round(x * 4) + 65536, Math.round(y * 4) + 65536);
      h = fnvInts(h, 0x7fff);
    }
    // the substrate under its own pixels (null: only the plain map there - hash and bytes as without substrates)
    const sub = withSub ? src.compose(win, c.index, I.map) : null;
    if ( sub ) {
      h = fnvInts(h, 0x5b57, sub.hash);
      // the severity rule: its pixels inside older damage of a higher level are not its own (a lower level never covers a higher)
      if ( sub.exclude(win, I.map.data, I.map.w) ) stats.excluded = (stats.excluded ?? 0) + 1;
      if ( win.px.length < 6 ) { stats.cutOff = (stats.cutOff ?? 0) + 1; return null; }
    }
    const hash = h >>> 0;
    let res = cache?.get(hash);
    if ( res ) { cache.delete(hash); cache.set(hash, res); stats.reused++; }
    else {
      win.map = sub ? sub.rgba : cropMap(I.map, RX, RY, W, H);
      if ( sub ) { win.clean = cropMap(I.map, RX, RY, W, H); win.sub = sub; stats.substrate = (stats.substrate ?? 0) + 1; }
      res = bakeArea(win, P, seed, (fnvStr(String(c.ob.id)) ^ Math.imul(c.ay * AW + c.ax, 31)) >>> 0, jag);
      for ( const it of res.items ) if ( it.m[0] === 0 ) overlayOutside(it.img, win);
      if ( sub ) { finishOverSubstrate(res.items, win, c.type, sub); for ( const it of res.items ) if ( it.m[0] === 2 ) it.m[7] = 1; }   // (cover row field 7: baked over a substrate - not a plain look)
      // the cause rides on the base row: field 11 holds the material in bits 0-3, the cause in bits 4-7 (0: unchanged bytes)
      if ( cause ) for ( const it of res.items ) if ( it.m[0] === 0 ) it.m[11] = (it.m[11] & 15) | (cause << 4);
      res.win = { x: RX, y: RY, w: W, h: H };
      res.hash = hash;
      if ( withSub ) stats.baked++; else stats.plain = (stats.plain ?? 0) + 1;
      if ( cache ) { cache.set(hash, res); trimCache(cache); }
    }
    return res;
  }
}

/**
 * THE FOOTPRINT RULE. An object owns its own pixels (its mask, as torn): there it may lay anything (the display first lays the plain
 * map there, then the object). Outside its mask it only TOUCHES the ground: its halo (scorch, dust, the cause's stain, rime, moss...),
 * the inked lip, the hairline cracks and the ground shadows of its pieces. Those were baked as finished colours over the plain map,
 * which laid a patch of clean map over any older damage next to it. Here every such pixel becomes the least opaque overlay that gives
 * exactly the same colour over the plain map (per channel: darkening towards black, lightening towards white, the smallest alpha that
 * reaches the colour), so over the plain map the look is unchanged (to a level of rounding) and over older damage it only darkens,
 * stains or inks it, never clears it. Declared footprint per kind: the mask, plus up to the halo radius around it (blast ~0.9 maxD,
 * scorch ~1.4 maxD + 4, collapse ~0.5 maxD, a cause's halo its own r; hairlines up to ~maxD); thrown chips land on top as pieces.
 */
function overlayOutside(img, win) {
  // (over a substrate the area's own pixels read it; outside them it still touches only the plain map)
  const { W, own } = win, map = win.clean ?? win.map, d = img.data;
  for ( let y = 0; y < img.h; y++ ) for ( let x = 0; x < img.w; x++ ) {
    const q = (y * img.w + x) * 4; if ( d[q + 3] !== 255 ) continue;
    const wi = (img.y + y) * W + img.x + x; if ( own[wi] ) continue;
    const mo = wi * 4;
    let a = 0;
    for ( let k = 0; k < 3; k++ ) {
      const c = d[q + k], m = map[mo + k];
      const ak = c > m ? (c - m) / (255 - m || 1) : c < m ? (m - c) / (m || 1) : 0;
      if ( ak > a ) a = ak;
    }
    if ( a <= 0.004 ) { d[q] = d[q + 1] = d[q + 2] = d[q + 3] = 0; continue; }
    const A = Math.min(255, Math.ceil(a * 255)), af = A / 255;
    for ( let k = 0; k < 3; k++ ) d[q + k] = clamp(Math.round((d[q + k] - map[mo + k] * (1 - af)) / af), 0, 255);
    d[q + 3] = A;
  }
}

function cropMap(map, RX, RY, W, H) {
  const out = new Uint8ClampedArray(W * H * 4);
  for ( let y = 0; y < H; y++ ) out.set(map.data.subarray(((RY + y) * map.w + RX) * 4, ((RY + y) * map.w + RX + W) * 4), y * W * 4);
  return out;
}

const CACHE_BYTES = 160 * 1048576;
function trimCache(cache) {
  let bytes = 0;
  for ( const r of cache.values() ) bytes += r.bytes;
  for ( const [k, r] of cache ) { if ( bytes <= CACHE_BYTES && cache.size <= 600 ) break; cache.delete(k); bytes -= r.bytes; }
}

/** Area results -> one sheet (images packed, placement table in the last rows). */
function assemble(results, stats, t0, progress) {
  const items = [];
  results.forEach((r, a) => {
    stats.areas++; stats.shards += r.stats.shards; stats.chips += r.stats.chips; stats.pulverised += r.stats.pulverised; stats.culled += r.stats.culled ?? 0; stats.materials.push(...r.stats.materials);
    if ( r.stats.cracks ) (stats.cracks ??= []).push(...r.stats.cracks);   // (the crack generator's measures, for dev/cracks.test.mjs)
    for ( const it of r.items ) items.push({ ...it, area: a, hash: r.hash, index: r.index ?? 0 });
  });
  const pack = shelfPack(items.map((it) => ({ w: it.img.w, h: it.img.h })));
  const metaBytes = items.length * META_FIELDS * 2 + 4;
  const SW = pack.W, metaRows = Math.ceil(metaBytes / 3 / SW);
  const SH = pack.H + metaRows;
  const sheet = new Uint8ClampedArray(SW * SH * 4);
  items.forEach((it, k) => {
    const p = pack.pos[k];
    for ( let y = 0; y < it.img.h; y++ ) sheet.set(it.img.data.subarray(y * it.img.w * 4, (y + 1) * it.img.w * 4), ((p.y + y) * SW + p.x) * 4);
  });
  const meta = new Int16Array(items.length * META_FIELDS);
  items.forEach((it, k) => {
    const p = pack.pos[k], o = k * META_FIELDS;
    meta.set(it.m, o);
    meta[o + 1] = p.x; meta[o + 2] = p.y;
    if ( it.m[0] === 0 ) { meta[o + 12] = it.hash & 0xffff; meta[o + 13] = (it.hash >>> 16) & 0xffff; meta[o + 16] = Math.min(32767, it.index); }
    else if ( it.m[0] === 1 ) meta[o + 11] = ((Math.min(it.area, 2047)) << 4) | (it.m[11] & 15);   // int16: area indices past 2047 share the last one (only a stagger hint)
  });
  // the table in the last rows: a 4-byte count, then the int16s little endian; three bytes per pixel, alpha 255
  const bytes = new Uint8Array(metaRows * SW * 3);
  new DataView(bytes.buffer).setUint32(0, items.length, true);
  bytes.set(new Uint8Array(meta.buffer), 4);
  for ( let k = 0; k < metaRows * SW; k++ ) {
    const o = ((pack.H * SW) + k) * 4;
    sheet[o] = bytes[k * 3]; sheet[o + 1] = bytes[k * 3 + 1]; sheet[o + 2] = bytes[k * 3 + 2]; sheet[o + 3] = 255;
  }
  progress(1);
  stats.ms = Date.now() - t0; stats.sprites = items.length;
  return { sheet: { w: SW, h: SH, data: sheet }, metaRows, meta, count: items.length, stats };
}

/**
 * One area in its window. `A`: W, H, RX, RY (window in absolute art px), map (window RGBA), inside / sev / typ (all damage in the
 * window), own (this area's pixels), frag (fragment blob of a torn-off piece, 0 = body), px (own pixel indices); `uid` its stable id.
 * Returns { items: [{ img, m: Int16Array(META_FIELDS) }], stats, bytes }.
 */
function bakeArea(A, P, seed, uid, jag) {
  const { W, H, RX, RY, map, inside, sev, typ, own } = A;
  const N = W * H;
  // inner distance (to the outside) and outer distance (to the nearest damage), chamfer 1 / 1.4142
  const din = new Float32Array(N), dout = new Float32Array(N);
  for ( let i = 0; i < N; i++ ) { din[i] = inside[i] ? 1e6 : 0; dout[i] = inside[i] ? 0 : 1e6; }
  chamfer(din, W, H); chamfer(dout, W, H);
  const occ = new Uint8Array(N);
  const stats = { shards: 0, chips: 0, pulverised: 0, culled: 0, materials: [] };
  const C = { id: 0, uid, px: A.px, path: pickPath(A.paths) };
  analyse(C);
  C.sub = A.sub ?? null; C.clean = A.clean ?? null;   // the older damage under its own pixels (substrate.mjs), for the tear too
  // a tear is its own bake (tear.mjs): an opening ripped along the stroke, not a fracture into plates
  if ( C.type === T_GASH ) return bakeTear({ W, H, RX, RY, map, own, sev, px: C.px, C, P, seed, uid, jag, mat: MATS[C.cls.mat], matIndex: C.cls.mat, type: T_GASH, stats, metaFields: META_FIELDS, din, cz: C.cz, cause: C.cause, causeKit, softLight, chamfer });
  fracture(C);
  fates(C);
  drawBase(C);

  /* ---------------------------------------------------------------- the brush path (follows the stroke) */
  /** The stroke that made this area: the path with most points on it (window coordinates), when it is long enough to matter. */
  function pickPath(paths) {
    let best = null, bn = 0;
    for ( const pts of paths ?? [] ) {
      let n = 0, len = 0;
      for ( let k = 0; k < pts.length; k++ ) {
        const x = Math.round(pts[k][0]), y = Math.round(pts[k][1]);
        if ( x >= 0 && y >= 0 && x < W && y < H && own[y * W + x] ) n++;
        if ( k ) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      }
      if ( n >= 3 && n > bn && len >= 10 ) { bn = n; best = { pts, length: len }; }
    }
    return best;
  }
  /** pixel -> cell id, a typed array (a Map of millions of entries was slow and huge); get() is undefined where no cell is. */
  function cellMap(n) {
    const a = new Int32Array(n).fill(-1);
    return { get: (i) => (i >= 0 && i < n && a[i] >= 0 ? a[i] : undefined), set: (i, v) => { a[i] = v; } };
  }
  /** The path direction near (x, y), looked up on a 4 px grid (the fracture asks for every pixel). */
  function pathDir(x, y) {
    const G = 4, gx = (x / G) | 0, gy = (y / G) | 0, gw = Math.ceil(W / G) + 1;
    const dirGrid = C.dirGrid ??= new Map();
    const key = gy * gw + gx;
    let f = dirGrid.get(key);
    if ( !f ) { f = pathFrame(gx * G + G / 2, gy * G + G / 2); dirGrid.set(key, f); }
    return f;
  }
  /** How far the area can reach out before the window ends (art px). */
  function roomOf(C) { return Math.min(C.x0, C.y0, W - 1 - C.x1, H - 1 - C.y1); }
  /** At (x, y): the path's direction at its nearest point (ux, uy) and the side of the path the point lies on (+1 / -1). */
  function pathFrame(x, y) {
    const pts = C.path.pts;
    let bd = Infinity, ux = 1, uy = 0, side = 1;
    for ( let k = 1; k < pts.length; k++ ) {
      const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], sx = x1 - x0, sy = y1 - y0, l2 = sx * sx + sy * sy || 1;
      const t = clamp(((x - x0) * sx + (y - y0) * sy) / l2, 0, 1), px = x0 + sx * t, py = y0 + sy * t, d = (x - px) ** 2 + (y - py) ** 2;
      if ( d < bd ) { bd = d; const l = Math.sqrt(l2); ux = sx / l; uy = sy / l; side = Math.sign(ux * (y - py) - uy * (x - px)) || 1; }
    }
    return { ux, uy, side };
  }

  /* ---------------------------------------------------------------- analysis */
  function analyse(C) {
    let x0 = W, y0 = H, x1 = 0, y1 = 0, sx = 0, sy = 0, maxD = 0, sumS = 0;
    const tcount = new Array(6).fill(0);
    for ( const i of C.px ) {
      const x = i % W, y = (i - x) / W;
      if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y;
      sx += x; sy += y; sumS += sev[i]; tcount[typ[i]]++;
      if ( din[i] > maxD ) maxD = din[i];
    }
    const n = C.px.length;
    // a crater is never torn out right up to its edge: a band of heaved, broken plates (the lip) rings it, wider in a bigger crater
    const rimW = clamp(maxD * 0.34, 1.8, 7);
    for ( const i of C.px ) { const x = i % W, y = (i - x) / W; if ( sev[i] > 2.4 && din[i] < rimW * (0.45 + 1.1 * vnoise(x / 9, y / 9, seed + 77)) + (h2(i, 3, seed) - 0.5) * 1.5 ) sev[i] = Math.min(sev[i], 2.15); }
    sumS = 0; for ( const i of C.px ) sumS += sev[i];
    Object.assign(C, { x0, y0, x1, y1, cx: sx / n, cy: sy / n, maxD, meanSev: sumS / n, maxSev: 0, rimW });
    for ( const i of C.px ) if ( sev[i] > C.maxSev ) C.maxSev = sev[i];
    C.type = tcount.indexOf(Math.max(...tcount));
    // principal axis: a long stroke gets several impacts along it
    let cxx = 0, cyy = 0, cxy = 0;
    for ( const i of C.px ) { const x = i % W - C.cx, y = (i - (i % W)) / W - C.cy; cxx += x * x; cyy += y * y; cxy += x * y; }
    cxx /= n; cyy /= n; cxy /= n;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(0.01, tr / 2 - disc);
    const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    C.axis = [Math.cos(ang), Math.sin(ang)]; C.elong = Math.sqrt(l1 / l2); C.len = 4 * Math.sqrt(l1);
    // epicentres: the deepest, most severe point; along a long stroke one every few widths
    const R = rng(seed * 31 + C.uid * 977 + 13);
    const score = (i) => din[i] * (0.6 + sev[i] * 0.15) + h2(i, C.uid, seed) * 0.05;
    // (cracks: impacts further apart - each one's fan of fissures needs room, or a long stroke becomes a tangle)
    const epiStep = C.type === T_CRACKS ? 4.5 * maxD + 10 : 2.6 * maxD + 6;
    const ne = C.elong > 2.2 && C.type !== T_GASH ? clamp(Math.round(C.len / epiStep), C.type === T_CRACKS ? 1 : 2, 7) : 1;
    C.epi = [];
    if ( ne === 1 ) {
      let bi = C.px[0], bs = -1;
      for ( const i of C.px ) { const s = score(i); if ( s > bs ) { bs = s; bi = i; } }
      C.epi.push({ x: bi % W, y: Math.floor(bi / W), R: 1 });
    } else {
      const span = C.len * 0.9, step = span / ne;
      for ( let k = 0; k < ne; k++ ) {
        const t = -span / 2 + step * (k + 0.5) + (R() - 0.5) * step * 0.3;
        let bi = -1, bs = -1;
        for ( const i of C.px ) {
          const x = i % W - C.cx, y = (i - (i % W)) / W - C.cy, pr = x * C.axis[0] + y * C.axis[1];
          if ( Math.abs(pr - t) > step / 2 ) continue;
          const s = score(i); if ( s > bs ) { bs = s; bi = i; }
        }
        if ( bi >= 0 ) C.epi.push({ x: bi % W, y: Math.floor(bi / W), R: 1 });
      }
      if ( !C.epi.length ) C.epi.push({ x: Math.round(C.cx), y: Math.round(C.cy), R: 1 });
    }
    // follows the stroke: the impacts lie along the brush path, in the order it was drawn, and the axis is the path's own
    if ( C.path ) {
      const pts = C.path.pts, step = C.type === T_GASH ? Infinity : epiStep;
      const a0 = pts[0], a1 = pts[pts.length - 1], dl = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
      C.axis = [(a1[0] - a0[0]) / dl, (a1[1] - a0[1]) / dl]; C.len = Math.max(C.len, C.path.length); C.elong = Math.max(C.elong, 3);
      if ( C.type !== T_GASH ) {
        C.epi = [];
        let acc = step / 2;
        for ( let k = 1; k < pts.length && C.epi.length < 12; k++ ) {
          const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], sl = Math.hypot(x1 - x0, y1 - y0);
          for ( let s = 0; s < sl && C.epi.length < 12; s += 1 ) {
            if ( (acc += 1) < step ) continue;
            acc = 0;
            const px = x0 + (x1 - x0) * s / sl, py = y0 + (y1 - y0) * s / sl;
            let bi = -1, bs = -1;
            for ( const i of C.px ) { const x = i % W, y = (i - x) / W; if ( (x - px) ** 2 + (y - py) ** 2 > (step / 2) ** 2 ) continue; const sc = score(i); if ( sc > bs ) { bs = sc; bi = i; } }
            if ( bi >= 0 && C.epi.length < 12 ) C.epi.push({ x: bi % W, y: Math.floor(bi / W), R: 1 });
          }
        }
        if ( !C.epi.length ) C.epi.push({ x: Math.round(pts[0][0]), y: Math.round(pts[0][1]), R: 1 });
      }
    }
    // each pixel belongs to its nearest epicentre; R = that impact's reach
    C.owner = new Uint8Array(n);
    C.px.forEach((i, k) => {
      const x = i % W, y = (i - x) / W;
      let best = 0, bd = Infinity;
      C.epi.forEach((e, j) => { const d = (x - e.x) ** 2 + (y - e.y) ** 2; if ( d < bd ) { bd = d; best = j; } });
      C.owner[k] = best;
      const e = C.epi[best], d = Math.sqrt(bd); if ( d > e.R ) e.R = d;
    });
    // what is being torn up: the map under the area
    const forced = MATS.indexOf(P.material);
    C.cls = classify(A.clean ?? map, W, C.px);   // (the material of the ground itself, not of older damage on it)
    if ( forced >= 0 ) C.cls.mat = forced;
    C.pal = palette(C.cls, C.type);
    // the cause (null = unspecified: nothing below changes)
    C.cause = A.cause | 0; C.cz = causeRow(C.cause);
    if ( C.cz ) causePalette(C.pal, C.cz, C.cls);
    stats.materials.push(MATS[C.cls.mat]);
  }

  /* ---------------------------------------------------------------- fracture */
  function fracture(C) {
    const R = rng(seed * 17 + C.uid * 7919 + 1);
    const seeds = [], fragOf = A.frag;
    if ( C.type === T_GASH ) {
      // claw / blade gashes: parallel grooves along the stroke; the surface between them stays in strips, cut across now and then
      const ax = C.axis, nx = -ax[1], ny = ax[0], wid = Math.max(2, C.maxD), g = clamp(Math.round(wid / 4.5), 2, 4);
      const grooves = Array.from({ length: g }, (_, k) => -wid * 0.8 + (k + 0.5) * (wid * 1.6) / g);
      const cells = new Map();
      C.cellAt = cellMap(N);
      for ( const i of C.px ) {
        const x = i % W, y = (i - x) / W, dx = x + 0.5 - C.cx, dy = y + 0.5 - C.cy;
        const t = dx * ax[0] + dy * ax[1], q = dx * nx + dy * ny + (vnoise(t / 3, 1.5, seed + 91) - 0.5) * 1.4;
        const taper = 1 - Math.pow(Math.min(1, Math.abs(t) / (C.len / 2 + 1)), 3);
        let strip = 0, groove = false;
        for ( let k = 0; k < g; k++ ) { if ( Math.abs(q - grooves[k]) < (0.75 + 0.9 * (sev[i] - 1) / 2) * taper ) groove = true; if ( q > grooves[k] ) strip = k + 1; }
        if ( groove ) continue;
        const key = fragOf[i] ? -fragOf[i] : strip * 4096 + Math.floor((t + 4096 + (vnoise(q, t / 4, seed + 93) - 0.5) * 3) / 22);
        (cells.get(key) ?? cells.set(key, { seed: { x: C.cx, y: C.cy, e: 0 }, px: [] }).get(key)).px.push(i);
      }
      C.cells = [...cells.values()];
      C.cells.forEach((c, id) => { c.id = id; for ( const i of c.px ) C.cellAt.set(i, id); });
      return;
    }
    /**
     * CRACKS by PROPAGATION, not a tree stamp: one DOMINANT fissure runs from the impact both ways (or along a followed stroke) in
     * jagged straight segments of 3-9 px, each turned 15-40 degrees off the heading, now and then a sharp 60-90 degree kink that the
     * crack then bends back from; on wood it is pulled along the grain, on brick and paving it prefers the darker mortar. Width is
     * greatest at the origin and tapers to a one-pixel tip. Side cracks are FEW (one to three secondaries of clearly different lengths,
     * their chance falling off with the distance from the impact, a couple of stub hairlines), each leaving as a thin Y that is never
     * wider than its parent there (no blob nodes). Some tips end in a popped flake; along stretches of the dominant fissure one lip is
     * stepped up (C.crackLip: 1 its raised lit edge, 2 the shadow it casts) - the crack reads as material that broke, not as ink.
     * C.crackAt: 3 the open heart of a wide fissure, 2 an open crack, 1 a hairline.
     */
    const group = [];
    const crackStrokes = () => {
      const ownA = new Uint8Array(N); for ( const i of C.px ) ownA[i] = 1;
      const crackAt = C.crackAt = new Uint8Array(N), crackW = new Float32Array(N), lip = C.crackLip = new Uint8Array(N);
      const lv = C.maxSev, lv1 = lv < 1.5, lv3 = lv > 2.4;
      const ST = { kinks: 0, segs: 0, tips: [], sec: [], root: 0 };   // (measures for dev/cracks.test.mjs)
      const wood = C.cls.mat === M.wood, grainA = C.cls.grainX ? Math.PI / 2 : 0;
      const lum = (i) => 0.299 * map[i * 4] + 0.587 * map[i * 4 + 1] + 0.114 * map[i * 4 + 2];
      const wrap = (a) => ((a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const put = (X, Y, w) => { if ( X < 0 || Y < 0 || X >= W || Y >= H ) return false; const i = Y * W + X; if ( !ownA[i] ) return false; if ( crackW[i] < w ) crackW[i] = w; return true; };
      // one crack: segments of 3-9 px from (x, y) on heading a0, length L, width w0 at its root -> 1 at its tip; returns its points with widths
      const walk = (x, y, a0, L, w0, heading = null) => {
        const pts = [[x, y, w0]];
        let a = a0, run = 0, guard = 0;
        while ( run < L && guard++ < 80 ) {
          const want = heading ? heading(x, y) : a0;
          let turn = (R() < 0.5 ? -1 : 1) * (15 + R() * 25) * Math.PI / 180;
          if ( R() < 0.12 ) { turn = (R() < 0.5 ? -1 : 1) * (60 + R() * 30) * Math.PI / 180; ST.kinks++; }      // a sharp kink
          let b = a + turn + wrap(want - a) * 0.45;                                              // bending back towards the heading
          if ( wood ) { let g = grainA; if ( Math.cos(b - g) < 0 ) g += Math.PI; b += wrap(g - b) * 0.5; }
          const sl = Math.min(3 + R() * 6, L - run + 1);
          // brick / paving: of three candidate headings the one over the darkest pixels (the mortar) wins now and then
          if ( !wood && R() < 0.5 ) {
            let best = b, bl = Infinity;
            for ( const d of [-0.35, 0, 0.35] ) {
              const c = b + d, X = Math.round(x + Math.cos(c) * sl), Y = Math.round(y + Math.sin(c) * sl * 0.85);
              if ( X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1 ) continue;
              const l = lum(Y * W + X) + Math.abs(d) * 30; if ( l < bl ) { bl = l; best = c; }
            }
            b = best;
          }
          a = b; x += Math.cos(a) * sl; y += Math.sin(a) * sl * 0.85; run += sl;
          pts.push([x, y, Math.max(0.6, w0 * Math.pow(Math.max(0, 1 - run / L), 0.8))]); ST.segs++;
        }
        ST.tips.push(pts[pts.length - 1][2]); ST.root = Math.max(ST.root, w0);
        return pts;
      };
      // rasterize: widened across each segment's own direction
      const paint = (pts) => {
        for ( let q = 1; q < pts.length; q++ ) {
          const [x0, y0, w0] = pts[q - 1], [x1, y1, w1] = pts[q], cells = lineCellsK(x0, y0, x1, y1), dx = x1 - x0, dy = y1 - y0;
          const nx = Math.abs(dx) > Math.abs(dy) ? 0 : 1, ny = 1 - nx;
          cells.forEach(([x, y], j) => { const w = w0 + (w1 - w0) * j / Math.max(1, cells.length - 1); for ( let k = 0; k < Math.max(1, Math.min(3, Math.round(w))); k++ ) put(x + nx * k, y + ny * k, w); });   // (at most 3 px across: never a blob)
        }
      };
      const widthAt = (pts, k) => pts[Math.min(pts.length - 1, k)][2];
      // a secondary leaves at k of its parent, at 30-70 degrees, thin (at most the parent's width there minus one)
      const branchOff = (pts, k, L, sideSign) => {
        const [px, py] = pts[k], nx2 = pts[Math.min(pts.length - 1, k + 1)], dir = Math.atan2(nx2[1] - py, nx2[0] - px);
        const a = dir + sideSign * (30 + R() * 40) * Math.PI / 180, w = Math.max(0.8, Math.min(widthAt(pts, k) - 1, 2));
        const b = walk(px, py, a, L, w); paint(b); ST.sec.push(L); return b;
      };
      const w0 = lv1 ? 1.6 : lv3 ? 3.6 : 2.6, reach = (e) => Math.max(5, e.R) + 2;
      const doms = [];
      if ( C.path && C.path.pts.length > 1 ) {
        // a followed stroke: the dominant fissure follows the path (heading = towards the next path point), widest where it starts
        const P0 = C.path.pts; let k = 1;
        const heading = (x, y) => { while ( k < P0.length - 1 && Math.hypot(P0[k][0] - x, P0[k][1] - y) < 6 ) k++; return Math.atan2(P0[k][1] - y, P0[k][0] - x); };
        const d = walk(P0[0][0], P0[0][1], Math.atan2(P0[1][1] - P0[0][1], P0[1][0] - P0[0][0]), C.path.length + 4, w0, heading);
        paint(d); doms.push(d);
      } else C.epi.forEach((e) => {
        // a tap: one dominant fissure through the impact, its two halves of different lengths, both widest at the impact
        const a = R() * Math.PI * 2, L = reach(e);
        for ( const [aa, f] of [[a, 0.7 + R() * 0.5], [a + Math.PI + (R() - 0.5) * 0.6, 0.45 + R() * 0.4]] ) { const d = walk(e.x, e.y, aa, L * f, w0); paint(d); doms.push(d); }
      });
      // secondaries: one to three of clearly different lengths, more likely near the origin; then a few stub hairlines
      const nSec = lv1 ? 0 : lv3 ? 2 + (R() < 0.5 ? 1 : 0) : 1 + (R() < 0.5 ? 1 : 0), lens = [1, 0.55, 0.3].sort(() => R() - 0.5);
      const R0 = Math.max(5, ...C.epi.map((q) => q.R));
      for ( let s = 0; s < nSec; s++ ) {
        const d = doms[s % doms.length]; if ( d.length < 3 ) continue;
        let k = 1; for ( let t = 0; t < 8; t++ ) { const c = 1 + Math.floor(R() * (d.length - 2)); if ( R() < Math.exp(-c / (d.length * 0.45)) ) { k = c; break; } }
        const b = branchOff(d, k, R0 * (0.35 + 0.75 * lens[s % 3]), R() < 0.5 ? -1 : 1);
        if ( lv3 && s === 0 && nSec < 3 && b.length > 3 && R() < 0.6 ) branchOff(b, Math.floor(b.length / 2), R0 * 0.25, R() < 0.5 ? -1 : 1);   // (one twig at most)
      }
      for ( let s = 0, n = lv1 ? 1 : 2 + (R() < 0.5 ? 1 : 0); s < n; s++ ) {
        const d = doms[Math.floor(R() * doms.length)]; if ( d.length < 3 ) continue;
        const k = 1 + Math.floor(R() * (d.length - 2)), [px, py] = d[k], a = R() * Math.PI * 2;
        paint(walk(px, py, a, 2 + R() * 4, 0.8));
      }
      // flakes popped out at a few tips of a broken crack (a small chip of the surface gone)
      if ( !lv1 ) for ( const d of doms ) if ( R() < (lv3 ? 0.7 : 0.4) ) {
        const [fx, fy] = d[Math.max(0, d.length - 2)], r = 0.9 + R() * (lv3 ? 0.6 : 0.4);   // (a small flake: never a blob)
        for ( let y = Math.floor(fy - r); y <= fy + r; y++ ) for ( let x = Math.floor(fx - r); x <= fx + r; x++ ) if ( Math.hypot(x - fx, (y - fy) / 0.85) <= r + (h2(x, y, seed + 707) - 0.5) * 0.8 ) put(x, y, 1.6);
      }
      for ( const i of C.px ) if ( crackW[i] > 0 ) crackAt[i] = crackW[i] >= 2.6 ? 3 : crackW[i] >= 1.4 ? 2 : 1;
      // no blob at a corner: where a radius-2 disc would lie wholly in the crack, its two far ends on the minor side are trimmed
      const fullDisc = (i) => { for ( let dy = -2; dy <= 2; dy++ ) for ( let dx = -2; dx <= 2; dx++ ) { if ( dx * dx + dy * dy > 4 ) continue; const j = i + dy * W + dx; if ( j < 0 || j >= N || !crackAt[j] ) return false; } return true; };
      for ( const i of C.px ) if ( crackAt[i] && fullDisc(i) ) for ( const j of [i - 2 * W, i + 2] ) if ( j >= 0 && j < N ) crackAt[j] = 0;
      for ( const i of C.px ) {
        if ( !crackAt[i] ) continue;
        let nb = 0; for ( const j of [i - 1, i + 1, i - W, i + W, i - W - 1, i - W + 1, i + W - 1, i + W + 1] ) if ( j >= 0 && j < N && crackAt[j] ) nb++;
        if ( !nb ) crackAt[i] = 0;
      }
      // a stepped lip along stretches of the dominant fissure: the surface on one side raised a pixel (lit edge, its shadow beyond)
      if ( !lv1 ) for ( const d of doms ) for ( let q = 1; q < d.length; q++ ) {
        if ( h2(q, C.uid, seed + 711) > 0.45 ) continue;
        const [x0, y0] = d[q - 1], [x1, y1] = d[q], dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, sx = Math.round(-dy / l * 2), sy = Math.round(dx / l * 2);
        for ( const [x, y] of lineCellsK(x0, y0, x1, y1) ) {
          const a = (y + sy) * W + x + sx, b = (y + Math.sign(sy) * 3) * W + x + Math.sign(sx) * 3;
          if ( a >= 0 && a < N && ownA[a] && !crackAt[a] ) lip[a] = 1;
          if ( b >= 0 && b < N && ownA[b] && !crackAt[b] && !lip[b] ) lip[b] = 2;
        }
      }
      // blob nodes: a disc of radius 2 wholly inside the crack
      let blobs = 0;
      for ( const i of C.px ) { if ( !crackAt[i] ) continue; let full = true; for ( let dy = -2; dy <= 2 && full; dy++ ) for ( let dx = -2; dx <= 2; dx++ ) { if ( dx * dx + dy * dy > 4 ) continue; const j = i + dy * W + dx; if ( j < 0 || j >= N || !crackAt[j] ) { full = false; break; } } if ( full ) blobs++; }
      (stats.cracks ??= []).push({ ...ST, blobs, level: lv });
      // the rest is one whole plate (never moved)
      const plate = { seed: { x: C.epi[0].x, y: C.epi[0].y, e: 0 }, px: [], whole: true };
      for ( const i of C.px ) if ( !crackAt[i] ) plate.px.push(i);
      C.cells = plate.px.length ? [plate] : [];
      C.cellAt = cellMap(N);
      C.cells.forEach((c, id) => { c.id = id; for ( const i of c.px ) C.cellAt.set(i, id); });
    };
    if ( C.type === T_CRACKS ) { crackStrokes(); return; }
    // a cave-in: rings of plates along its own outline (collapse.mjs)
    if ( C.type === T_COLLAPSE ) { const cs = collapseSeeds(C, din, W, seed + C.uid, R); C.collBand = cs.bw; for ( const s of cs.seeds ) { if ( s.merge >= 0 ) group[seeds.length] = s.merge; seeds.push(s); } }
    else for ( let ei = 0; ei < C.epi.length; ei++ ) {
      const e = C.epi[ei];
      seeds.push({ x: e.x + (R() - 0.5), y: e.y + (R() - 0.5), e: ei });
      const m0 = 6 + Math.floor(R() * 5), a0 = R() * Math.PI * 2, fz = C.cz?.frac;
      const m = fz?.spokes ? Math.max(4, Math.round(m0 * fz.spokes)) : m0;
      const spokes = Array.from({ length: m + 1 }, (_, j) => a0 + (j + (j < m ? (R() - 0.5) * 0.45 : 0)) / m * Math.PI * 2);
      spokes[m] = spokes[0] + Math.PI * 2;
      const rings = [0];
      let r = 1.4 + R() * 1.2;
      while ( r < e.R + 3 ) { rings.push(r); r = fz?.ring ? r * (1 + (0.34 + R() * 0.18) * fz.ring) + 1.1 * fz.ring : r * (1.34 + R() * 0.18) + 1.1; }
      rings.push(r);
      for ( let k = 0; k + 1 < rings.length; k++ ) {
        const rin = rings[k], rout = rings[k + 1], rm = (rin + rout) / 2;
        if ( k === 0 && rm < 1.2 ) continue;
        const w = 2.2 + rm * 0.55;
        for ( let j = 0; j < m; j++ ) {
          const span = spokes[j + 1] - spokes[j], f = Math.max(1, Math.round((span * rm) / w));
          for ( let s = 0; s < f; s++ ) {
            const a = spokes[j] + span * (s + 0.5 + (R() - 0.5) * 0.35) / f;
            const rr = rm + (R() - 0.5) * (rout - rin) * 0.35;
            // a spiralling cause (arcane) turns the spokes with the distance: the plates curl round the centre
            const aa = fz?.swirl ? a + rr * fz.swirl : a;
            seeds.push({ x: e.x + Math.cos(aa) * rr, y: e.y + Math.sin(aa) * rr, e: ei });
          }
        }
      }
    }
    // nearest seed (domain-warped, so cracks are jagged), through a bucket grid
    // a flat bucket grid (linked lists), searched ring by ring outwards until no closer seed can exist: the true nearest seed, and
    // each bucket visited once (the old search re-scanned every inner ring and could look at hundreds of buckets per pixel)
    const B = 6, gw = Math.ceil(W / B) + 2, gh = Math.ceil(H / B) + 2, ns = seeds.length;
    const head = new Int32Array(gw * gh).fill(-1), nxt = new Int32Array(ns), sxs = new Float64Array(ns), sys = new Float64Array(ns);
    seeds.forEach((s, k) => {
      sxs[k] = s.x; sys[k] = s.y;
      const bx = clamp(Math.floor(s.x / B) + 1, 0, gw - 1), by = clamp(Math.floor(s.y / B) + 1, 0, gh - 1), key = by * gw + bx;
      nxt[k] = head[key]; head[key] = k;
    });
    const cellOf = new Int32Array(C.px.length);
    // wood splits along its grain: distance across the grain counts more, so cells grow into long splinters
    const wood = C.cls.mat === M.wood, kx = wood && !C.cls.grainX ? 0.3 : 1, ky = wood && C.cls.grainX ? 0.3 : 1;
    // follows the stroke: distance across the path counts less, so plates grow long across it and tear like a furrow
    // a cause that tears in strips (claws): distance along the area's axis counts less, so the plates grow long along it
    const ALONG = C.path ? 0 : C.cz?.frac?.along ?? 0, AX = C.axis;
    const ACROSS = 0.45, kmin = C.path ? Math.min(kx, ky, ACROSS) : ALONG ? Math.min(kx, ky, ALONG) : Math.min(kx, ky);
    const maxRad = Math.max(gw, gh);
    C.px.forEach((i, k) => {
      const x = i % W, y = (i - x) / W;
      // torn (jagged): a stronger, finer warp makes angular, chipped cuts instead of smooth cell edges
      // (cracks: torn edges stay readable lines - a full-strength warp folded them into a tangle at max settings)
      const wa = 2.6 + 2.4 * jag * (C.type === T_CRACKS ? 0.35 : 1);
      const qx = x + 0.5 + (vnoise(x / 2.3, y / 2.3, seed + 101) - 0.5) * wa + (jag ? (vnoise(x / 0.9, y / 0.9, seed + 103) - 0.5) * 1.8 * jag : 0);
      const qy = y + 0.5 + (vnoise(x / 2.3, y / 2.3, seed + 202) - 0.5) * wa + (jag ? (vnoise(x / 0.9, y / 0.9, seed + 204) - 0.5) * 1.8 * jag : 0);
      let best = -1, bd = Infinity;
      const bx = Math.floor(qx / B) + 1, by = Math.floor(qy / B) + 1;
      const f = C.path && !C.collBand ? pathDir(x, y) : null;
      const visit = (X, Y) => {
        if ( X < 0 || Y < 0 || X >= gw || Y >= gh ) return;
        for ( let s = head[Y * gw + X]; s >= 0; s = nxt[s] ) {
          const dx = sxs[s] - qx, dy = sys[s] - qy;
          const d = f ? (dx * f.ux + dy * f.uy) ** 2 + (ACROSS * (dy * f.ux - dx * f.uy)) ** 2
            : ALONG ? (ALONG * (dx * AX[0] + dy * AX[1])) ** 2 + (dy * AX[0] - dx * AX[1]) ** 2 : (dx * kx) ** 2 + (dy * ky) ** 2;
          if ( d < bd ) { bd = d; best = s; }
        }
      };
      for ( let rad = 0; rad <= maxRad; rad++ ) {
        if ( best >= 0 && ((rad - 1) * B * kmin) ** 2 > bd ) break;
        if ( rad === 0 ) { visit(bx, by); continue; }
        for ( let d = -rad; d <= rad; d++ ) { visit(bx + d, by - rad); visit(bx + d, by + rad); }
        for ( let d = -rad + 1; d < rad; d++ ) { visit(bx - rad, by + d); visit(bx + rad, by + d); }
      }
      cellOf[k] = best;
    });
    // cells
    const cells = new Map();
    C.px.forEach((i, k) => { const s = cellOf[k], key = fragOf[i] ? -fragOf[i] : (group[s] ?? s); (cells.get(key) ?? cells.set(key, { seed: seeds[s], px: [] }).get(key)).px.push(i); });
    C.cellAt = cellMap(N); // pixel -> cell id (for crack gaps)
    C.cells = [...cells.values()];
    C.cells.forEach((c, id) => { c.id = id; for ( const i of c.px ) C.cellAt.set(i, id); });
  }

  /* ---------------------------------------------------------------- fates and shard rendering */
  function fates(C) {
    const R = rng(seed * 101 + C.uid * 104729 + 3);
    const debris = clamp(P.debris ?? 0.7, 0, 1), scatter = clamp(P.scatter ?? 1, 0.2, 3), liftK = clamp(P.lift ?? 1, 0, 2);
    C.shards = []; C.cracks = []; C.rect = { x0: C.x0, y0: C.y0, x1: C.x1, y1: C.y1 };
    const CX = C.collBand ? { W, din, maxD: Math.max(2.5, C.maxD), bw: C.collBand, liftK, split, stats, R } : null;
    for ( const cell of C.cells ) {
      let n = 0, sx = 0, sy = 0, ss = 0;
      const tc = new Array(6).fill(0);
      for ( const i of cell.px ) { const x = i % W; sx += x; sy += (i - x) / W; ss += sev[i]; tc[typ[i]]++; n++; }
      const cx = sx / n, cy = sy / n, sv = ss / n, type = tc.indexOf(Math.max(...tc));
      const e = C.epi[cell.seed.e] ?? C.epi[0];
      let ox = cx - e.x, oy = cy - e.y; const dl = Math.hypot(ox, oy) || 1; ox /= dl; oy /= dl;
      if ( type === T_GASH ) { const nx = -C.axis[1], ny = C.axis[0], q = (cx - C.cx) * nx + (cy - C.cy) * ny; ox = nx * Math.sign(q || 1); oy = ny * Math.sign(q || 1); }
      else if ( C.path ) {
        // a furrow: the spoil goes out to both sides of the path, a little behind the plough
        const f = pathFrame(cx, cy), side = f.side || 1;
        ox = -f.uy * side - f.ux * 0.35; oy = f.ux * side - f.uy * 0.35; const l = Math.hypot(ox, oy) || 1; ox /= l; oy /= l;
      }
      const u = clamp(dl / Math.max(2, e.R), 0, 1.2);
      // pixels of the plate: one-pixel cracks on its right and bottom borders (towards other plates), a ragged rim when broken
      const keep = [];
      for ( const i of cell.px ) {
        const x = i % W;
        const cr = C.cellAt.get(i + 1), cb = C.cellAt.get(i + W);
        const right = x + 1 < W && inside[i + 1] && cr !== undefined && cr !== cell.id;
        const below = i + W < N && inside[i + W] && cb !== undefined && cb !== cell.id;
        if ( right || below ) continue;
        // cracks: a MAIN fissure (between two main sectors) is two pixels wide near its impact and tapers to one further out
        if ( cell.seed.sec !== undefined && C.maxSev >= 1.5 && !jag ) {   // (a level-1 crack stays a hairline; torn edges are wide enough)
          const cl = C.cellAt.get(i - 1), ca = C.cellAt.get(i - W), sec = cell.seed.sec, y = (i - x) / W;
          const main = (q) => q !== undefined && q !== cell.id && C.cells[q].seed.sec !== sec;
          if ( (main(cl) || main(ca) || main(cr) || main(cb)) && Math.hypot(x - e.x, y - e.y) < e.R * (0.5 + 0.2 * (C.maxSev - 1.5)) + 2 ) continue;
        }
        if ( (sv >= 1.8 || jag) && type !== T_CRACKS ) {
          const rim = !(inside[i - 1] && inside[i + 1] && inside[i - W] && inside[i + W]) || C.cellAt.get(i - 1) !== cell.id || C.cellAt.get(i - W) !== cell.id;
          // torn: chipped teeth along every plate's rim, in 2 x 2 bites
          if ( rim && (h2(i, 5, seed) < 0.22 * Math.max(0, sv - 1.5) || (jag && h2((i % W) >> 1, Math.floor(i / W) >> 1, seed + 6) < 0.32 * jag)) ) continue;
        }
        keep.push(i);
      }
      if ( keep.length < 2 ) continue;
      const base = { px: keep, cx, cy, sv, type, e, ox, oy, u };
      if ( CX && type === T_COLLAPSE ) { for ( const s of collapseFate(CX, base, cell) ) C.shards.push(s); continue; }
      if ( type === T_CRACKS || sv < 1.5 ) {
        // cracked: the plate stays; now and then a hair's breadth out or sunk a little
        const nudge = R() < 0.3 && !cell.whole ? 1 : 0;   // (the whole plate round crack strokes never moves)
        C.shards.push({ ...base, dx: Math.round(ox * nudge), dy: Math.round(oy * nudge), th: 0, tx: 0, ty: 0, z0: (type === T_CRACKS && sv > 2.2 && R() < 0.4 && !cell.whole) ? -1 : 0, T: 0 });
        continue;
      }
      if ( sv < 2.45 || type === T_GASH ) {
        const slope = (0.22 + R() * 0.4) * liftK, th = (R() - 0.5) * 0.32;
        if ( type === T_COLLAPSE ) {      // slumps into the hole: inner edge down
          const d = 0.6 + R() * 1.6;
          C.shards.push({ ...base, dx: -ox * d, dy: -oy * d, th, tx: ox * slope, ty: oy * slope, z0: -1.5, T: 1 });
        } else if ( type === T_FLOOD ) {   // sinks, tips into the water
          C.shards.push({ ...base, dx: ox * 0.5, dy: oy * 0.5, th: th * 0.5, tx: ox * slope * 0.5, ty: oy * slope * 0.5, z0: -1, T: 1, wet: 1 });
        } else if ( type === T_SCORCH ) {  // burnt plates curl a little
          C.shards.push({ ...base, dx: ox * 0.5, dy: oy * 0.5, th: th * 0.4, tx: -ox * slope * 0.45, ty: -oy * slope * 0.45, z0: 0.5, T: 1 });
        } else if ( type === T_GASH ) {    // the surface between the grooves stays where it is: the grooves carry the read
          C.shards.push({ ...base, dx: 0, dy: 0, th: 0, tx: 0, ty: 0, z0: 0, T: 0 });
        } else {                            // heaved: pushed out, inner edge lifted (the lip of a crater)
          const d = 1.1 + R() * 2.4, slope2 = slope * 1.25;
          C.shards.push({ ...base, dx: ox * d, dy: oy * d, th: th * 1.3, tx: -ox * slope2, ty: -oy * slope2, z0: (0.5 + R() * 1.4) * liftK, T: n > 18 ? 2 : 1 });
        }
        continue;
      }
      // crater: pulverised, sunk, or thrown out as chips
      let gone = type === T_FLOOD ? 0.85 : type === T_COLLAPSE ? 0.75 : type === T_SCORCH ? 0.85 : 0.35 + (1 - debris) * 0.55;
      if ( C.cz?.fate?.gone ) gone = clamp(gone + C.cz.fate.gone, 0.05, 0.95);   // acid dissolves, rot crumbles, a fist leaves pieces
      const goneF = gone - (type === T_FLOOD ? 0.35 : 0);   // (a flooded hole keeps more of its pieces: they sink into it rather than vanish)
      if ( u < 0.35 && R() < goneF + 0.25 ) { stats.pulverised++; continue; }
      if ( R() < goneF * 0.6 ) { stats.pulverised++; continue; }
      const chipMax = Math.round(10 + 30 * u);
      for ( const chip of split(keep, chipMax, R) ) {
        let ccx = 0, ccy = 0; for ( const i of chip ) { const x = i % W; ccx += x; ccy += (i - x) / W; }
        ccx /= chip.length; ccy /= chip.length;
        const a = Math.atan2(oy, ox) + (R() - 0.5) * 0.7;
        let dist;
        if ( type === T_COLLAPSE || type === T_FLOOD || type === T_SCORCH ) dist = -(dl * (0.3 + R() * 0.5));   // (a burn's pieces stay in it: none lie out on the grass)   // (a flooded hole's pieces sink into it, none float off)                         // falls in
        else if ( R() < 0.45 ) dist = (e.R - dl) * (0.15 + R() * 0.6);                       // comes to rest on the slope, leaning
        else dist = Math.min(((e.R - dl) + 1 + Math.pow(R(), 1.6) * (e.R * 0.6 + 3)) * scatter, (e.R - dl) + 2 + e.R * 0.55 * scatter);   // thrown out past the rim, most land close; never further than about half the crater's reach past it
        if ( dist > 0 && C.cz?.fate?.thr ) dist *= C.cz.fate.thr;
        let lx = ccx + Math.cos(a) * dist, ly = ccy + Math.sin(a) * dist;
        if ( dist > 0 ) {
          // the room left in that direction, in the window as it would be without the scene's edge (A.vb): a long throw is shortened
          // smoothly so it lands well inside that window. At the border nothing is squeezed or bounced: a chip may land past the
          // map's edge (it is culled when packed - never drawn, never in the sheet), so no pile ever forms along the border.
          const ca = Math.cos(a), sa = Math.sin(a), [vx0, vy0, vx1, vy1] = A.vb ?? [0, 0, W, H];
          const rx = ca > 1e-6 ? (vx1 - 10 - ccx) / ca : ca < -1e-6 ? (vx0 + 9 - ccx) / ca : Infinity;
          const ry = sa > 1e-6 ? (vy1 - 10 - ccy) / sa : sa < -1e-6 ? (vy0 + 9 - ccy) / sa : Infinity;
          const room = Math.max(1, Math.min(rx, ry));
          if ( dist > room * 0.5 ) dist = room * 0.5 + room * 0.5 * Math.tanh((dist - room * 0.5) / (room * 0.5));
          lx = ccx + ca * dist; ly = ccy + sa * dist;
        }
        if ( !A.vb ) { lx = clamp(lx, 2, W - 3); ly = clamp(ly, 2, H - 3); }
        const li = clamp(Math.round(ly), 0, H - 1) * W + clamp(Math.round(lx), 0, W - 1);   // (stacking only: a chip past the edge is culled)
        const stackUp = occ[li] ?? 0;
        const tiltA = R() * Math.PI * 2, slope = R() * 0.55 * liftK;
        C.shards.push({ ...base, px: chip, cx: ccx, cy: ccy, dx: lx - ccx, dy: ly - ccy, th: (R() - 0.5) * Math.PI * 2,
          tx: Math.cos(tiltA) * slope, ty: Math.sin(tiltA) * slope, z0: (type === T_COLLAPSE || type === T_FLOOD ? -2 : R() * 1.2 + stackUp * 1.3) * Math.max(0.4, liftK), T: chip.length > 14 ? 2 : 1, chip: 1, thrown: dist > 0 });
        for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) { const j = li + dy * W + dx; if ( j >= 0 && j < N && occ[j] < 6 ) occ[j]++; }
        stats.chips++;
      }
    }
    // order: what lies lower on screen is drawn later; stacked chips over plates
    C.shards.sort((a, b) => (a.cy + a.dy + (a.chip ? 0.5 + a.z0 * 0.1 : 0)) - (b.cy + b.dy + (b.chip ? 0.5 + b.z0 * 0.1 : 0)));
    // a plate that did not move is not drawn at all: the real map shows there, at full resolution
    C.keep = new Set();
    for ( const s of C.shards ) {
      s.static = !s.chip && !s.dx && !s.dy && !s.th && !s.tx && !s.ty && !s.z0;
      if ( s.static ) { s.skip = true; for ( const i of s.px ) C.keep.add(i); }
      else renderShard(C, s);
    }
    stats.shards += C.shards.length;
    // hairline cracks out into the intact map
    // (a cause's hairlines neither on crack strokes - a strike's bolt trail still crosses them)
    if ( C.cz ) { if ( ((C.maxSev >= 1.8 && C.type !== T_FLOOD) || C.cz.crack?.always) && (C.type !== T_CRACKS || C.cz.crack?.mode === "bolt") ) causeCracks(C, R, C.cz.crack); }
    else if ( C.maxSev >= 1.8 && C.type !== T_FLOOD ) growCracks(C, R);
    // a cave-in's cracks are its own, at the pit: no hairlines out into the ground, a cause's only short stubs (no vines over the map)
    if ( C.collBand ) { if ( !C.cz ) C.cracks.length = 0; else C.cracks = C.cracks.map((q) => q.slice(0, Math.ceil(q.length * 0.4))).filter((q) => q.length >= 3); }
  }

  /** Split a pixel set into chips of about `max` pixels (nearest of k random seeds). */
  function split(px, max, R) {
    const k = Math.ceil(px.length / max);
    if ( k <= 1 ) return [px];
    const seeds = Array.from({ length: k }, () => px[Math.floor(R() * px.length)]);
    const out = seeds.map(() => []);
    const ssx = Int32Array.from(seeds, (s) => s % W), ssy = Int32Array.from(seeds, (s) => (s - (s % W)) / W);
    for ( const i of px ) {
      const x = i % W, y = (i - x) / W;
      let best = 0, bd = Infinity;
      for ( let j = 0; j < k; j++ ) {
        const base = (ssx[j] - x) ** 2 + (ssy[j] - y) ** 2;
        if ( base >= bd ) continue;                       // the noise only adds: it cannot win (same result, far less hashing)
        const d = base + h2(i, j, seed) * 3;
        if ( d < bd ) { bd = d; best = j; }
      }
      out[best].push(i);
    }
    return out.filter((c) => c.length >= 2);
  }

  /**
   * One rigid slab: top face = the map's own pixels (rotated, tilted, lifted), seen with the oblique camera; side = a cross-section
   * of the material; silhouette inked; a flat shadow on the ground when it is lifted or thrown.
   */
  function renderShard(C, s) {
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for ( const i of s.px ) { const x = i % W, y = (i - x) / W; if ( x < bx0 ) bx0 = x; if ( x > bx1 ) bx1 = x; if ( y < by0 ) by0 = y; if ( y > by1 ) by1 = y; }
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    const own = new Uint8Array(bw * bh);
    for ( const i of s.px ) { const x = i % W, y = (i - x) / W; own[(y - by0) * bw + (x - bx0)] = 1; }
    const pcx = s.cx + 0.5, pcy = s.cy + 0.5;
    const c = Math.cos(s.th), sn = Math.sin(s.th);
    // screen = M (p - centre) + centre + offset - (0, z0/2);   M = [[1,0],[-tx/2, 1-ty/2]] * Rot
    let ty = s.ty; if ( 1 - ty / 2 < 0.35 ) ty = 1.3;
    const r00 = c, r01 = -sn, r10 = sn, r11 = c;
    const m00 = r00, m01 = r01, m10 = -s.tx / 2 * r00 + (1 - ty / 2) * r10, m11 = -s.tx / 2 * r01 + (1 - ty / 2) * r11;
    const det = m00 * m11 - m01 * m10;
    const i00 = m11 / det, i01 = -m01 / det, i10 = -m10 / det, i11 = m00 / det;
    const ocx = pcx + s.dx, ocy = pcy + s.dy - s.z0 / 2;
    // screen bbox of the top face
    let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
    for ( const [qx, qy] of [[bx0, by0], [bx1 + 1, by0], [bx0, by1 + 1], [bx1 + 1, by1 + 1]] ) {
      const px = qx - pcx, py = qy - pcy, X = m00 * px + m01 * py + ocx, Y = m10 * px + m11 * py + ocy;
      sx0 = Math.min(sx0, X); sx1 = Math.max(sx1, X); sy0 = Math.min(sy0, Y); sy1 = Math.max(sy1, Y);
    }
    const T = s.T | 0;
    // a cave-in's slab: lit and shaded harder, darker the deeper it sank; its edge along the pit's rim is neither inked nor thick (it
    // stays at ground level there: no inked lasso round the hole)
    const cv = s.type === T_COLLAPSE && !!C.collBand, rimOut = (q) => !inside[q + 1] || !inside[q + W] || !inside[q - 1] || !inside[q - W];
    const tx0 = Math.floor(sx0) - 1, ty0 = Math.floor(sy0) - 1, tw = Math.ceil(sx1) - tx0 + 2, th = Math.ceil(sy1) - ty0 + 2 + T;
    if ( tw <= 0 || th <= 0 || tw > 1600 || th > 1600 ) { s.skip = true; stats.dropped = (stats.dropped ?? 0) + 1; return; }   // (was 400: big heaved plates of huge areas went missing)
    const top = new Int32Array(tw * th).fill(-1);   // source map index of each top pixel
    for ( let y = 0; y < th; y++ ) for ( let x = 0; x < tw; x++ ) {
      const X = tx0 + x + 0.5 - ocx, Y = ty0 + y + 0.5 - ocy;
      const u = i00 * X + i01 * Y + pcx, v = i10 * X + i11 * Y + pcy;
      const ux = Math.floor(u), vy = Math.floor(v);
      if ( ux < bx0 || vy < by0 || ux > bx1 || vy > by1 || !own[(vy - by0) * bw + (ux - bx0)] ) continue;
      top[y * tw + x] = vy * W + ux;
    }
    // shading of the top face: normal (-tx, -ty, 1), light from the top left, high
    const nl = Math.hypot(s.tx, ty, 1), L = [-0.5, -0.55, 0.67];
    let f = ((-s.tx * L[0] - ty * L[1] + L[2]) / nl) / L[2];
    if ( s.z0 < 0 ) f *= cv ? 1 - Math.min(0.4, -s.z0 * 0.075) : 0.82;
    // a piece of the map must still read as the map: tilt shades it, it never glows
    f = 1 + Math.round((clamp(f, cv ? 0.5 : 0.6, cv ? 1.16 : 1.12) - 1) / 0.06) * 0.06;
    const rgba = new Uint8ClampedArray(tw * th * 4);
    const isTop = (x, y) => x >= 0 && y >= 0 && x < tw && y < th && top[y * tw + x] >= 0;
    // side: the slab's thickness below its top face
    const sideCol = mix(C.pal.strata[0], C.pal.ramp[1], 0.35);
    for ( let y = 0; y < th; y++ ) for ( let x = 0; x < tw; x++ ) {
      if ( isTop(x, y) ) continue;
      for ( let k = 1; k <= T; k++ ) if ( isTop(x, y - k) ) {
        const src = top[(y - k) * tw + x], o = (y * tw + x) * 4;
        if ( cv && rimOut(src) ) break;
        const mc = [map[src * 4], map[src * 4 + 1], map[src * 4 + 2]];
        const col = k === 1 ? mix(mul(mc, 0.5), sideCol, 0.55) : mul(sideCol, 0.78);
        rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
        break;
      }
    }
    const scorch = s.type === T_SCORCH, wet = s.wet, dz = C.cz?.deb;
    for ( let y = 0; y < th; y++ ) for ( let x = 0; x < tw; x++ ) {
      const src = top[y * tw + x]; if ( src < 0 ) continue;
      const o = (y * tw + x) * 4;
      let col = [map[src * 4], map[src * 4 + 1], map[src * 4 + 2]];
      let g = f;
      if ( !isTop(x - 1, y) || !isTop(x, y - 1) ) g *= 1.12;               // the lit edge
      if ( !isTop(x + 1, y) && rgba[o + 4 + 3] === 0 ) g *= 0.8;          // the shaded edge
      col = mul(col, g);
      if ( scorch ) { const k = clamp(0.2 + (s.sv - 1) * 0.3 + (vnoise(x / 2, y / 2, seed + src) - 0.5) * 0.5, 0, 0.85); col = mix(col, C.pal.char[1], k); }
      if ( wet ) col = mix(col, C.pal.waterR[1], 0.25);
      if ( dz ) {
        // the cause on the piece's top: charred, stained, wet, iced or mossy (the pattern sticks to the piece's own surface); acid
        // eats pixels off its rim
        const litE = !isTop(x - 1, y) || !isTop(x, y - 1), edgeP = litE || !isTop(x + 1, y) || !isTop(x, y + 1);
        if ( dz.holes && edgeP && h2(src, 9, seed + 641) < dz.holes ) continue;
        const sx = src % W, n = vnoise(sx / 2.5, (src - sx) / W / 2.5, seed + 642);
        const to = dz.to === "char" ? C.pal.char[1] : dz.to === "wet" ? C.pal.waterR[1] : dz.to === "ice" ? C.pal.accHi : C.pal.acc;
        if ( dz.to === "moss" ) { if ( (litE && n > 0.42) || n > 0.68 ) col = mix(col, to, 0.7); }
        else col = mix(col, to, clamp(dz.k + (n - 0.5) * 0.5, 0, 0.9));
        if ( dz.rim && litE ) col = mix(col, [255, 255, 255], 0.35);
      }
      rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
    }
    // ink the silhouette where it is lifted (resting plates join the map seamlessly)
    if ( T > 0 || s.chip || s.type === T_CRACKS ) {
      const ink = C.pal.ink;
      const filled = (x, y) => x >= 0 && y >= 0 && x < tw && y < th && rgba[(y * tw + x) * 4 + 3] > 0;
      const out = [];
      for ( let y = 0; y < th; y++ ) for ( let x = 0; x < tw; x++ ) {
        if ( !filled(x, y) ) continue;
        if ( cv && top[y * tw + x] >= 0 && rimOut(top[y * tw + x]) ) continue;
        const bottomOrRight = !filled(x + 1, y) || !filled(x, y + 1);
        const leftOrTop = !filled(x - 1, y) || !filled(x, y - 1);
        if ( bottomOrRight || (leftOrTop && !isTop(x, y)) ) out.push((y * tw + x) * 4);
      }
      for ( const o of out ) { const col = mix([rgba[o], rgba[o + 1], rgba[o + 2]], ink, cv ? 0.55 : 0.75); rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; }
    }
    // trim empty borders
    let ax0 = tw, ay0 = th, ax1 = -1, ay1 = -1;
    for ( let y = 0; y < th; y++ ) for ( let x = 0; x < tw; x++ ) if ( rgba[(y * tw + x) * 4 + 3] ) { if ( x < ax0 ) ax0 = x; if ( x > ax1 ) ax1 = x; if ( y < ay0 ) ay0 = y; if ( y > ay1 ) ay1 = y; }
    if ( ax1 < 0 ) { s.skip = true; return; }
    const fw = ax1 - ax0 + 1, fh = ay1 - ay0 + 1, img = new Uint8ClampedArray(fw * fh * 4);
    for ( let y = 0; y < fh; y++ ) img.set(rgba.subarray(((y + ay0) * tw + ax0) * 4, ((y + ay0) * tw + ax1 + 1) * 4), y * fw * 4);
    s.img = { w: fw, h: fh, data: img, x: tx0 + ax0, y: ty0 + ay0 };
    s.src = { x: bx0, y: by0 };
    // the ground shadow: the footprint at z = 0, falling down and right, only for what stands off the ground
    const lifted = s.chip || s.z0 > 0.4 || Math.hypot(s.tx, s.ty) > 0.3;
    if ( lifted && s.z0 >= 0 ) {
      const off = 1 + Math.round(Math.max(0, s.z0) * 0.6 + Math.hypot(s.tx, s.ty) * 2);
      s.shadow = [];
      for ( let y = 0; y < th; y++ ) for ( let x = 0; x < tw; x++ ) if ( top[y * tw + x] >= 0 ) {
        // the same point on the ground: undo the lift (z) of this pixel
        const src = top[y * tw + x], ux = src % W, vy = (src - ux) / W;
        const px = ux + 0.5 - pcx, py = vy + 0.5 - pcy;
        const gx = c * px - sn * py + pcx + s.dx, gy = sn * px + c * py + pcy + s.dy;
        s.shadow.push(Math.round(gx) + Math.ceil(off * 0.5), Math.round(gy) + off);
      }
    }
    // grow the area's rectangle to hold the shard and its shadow
    const r = C.rect;
    r.x0 = Math.min(r.x0, s.img.x - 2); r.y0 = Math.min(r.y0, s.img.y - 2); r.x1 = Math.max(r.x1, s.img.x + fw + 3); r.y1 = Math.max(r.y1, s.img.y + fh + 4);
    if ( s.shadow ) for ( let k = 0; k < s.shadow.length; k += 2 ) {
      r.x0 = Math.min(r.x0, s.shadow[k]); r.x1 = Math.max(r.x1, s.shadow[k]); r.y0 = Math.min(r.y0, s.shadow[k + 1]); r.y1 = Math.max(r.y1, s.shadow[k + 1]);
    }
  }

  /** Hairline cracks running from the rim out into the intact map, roughly away from the impact, branching now and then. */
  function growCracks(C, R) {
    if ( C.type === T_CRACKS ) return;   // (crack strokes are their own cracks: hairlines from the mask's rim would start in intact ground)
    const rim = [];
    for ( const i of C.px ) if ( din[i] <= 1.01 ) rim.push(i);
    if ( !rim.length ) return;
    const lum = (i) => 0.299 * map[i * 4] + 0.587 * map[i * 4 + 1] + 0.114 * map[i * 4 + 2];
    const count = Math.min(6, Math.round((2 + R() * 3 + C.maxD * 0.12) * (C.maxSev >= 2.5 ? 1 : 0.6) * (1 + 0.35 * jag)));   // a few dominant fractures, never a tangle
    const wood = C.cls.mat === M.wood, grain = C.cls.grainX ? [0, 1] : [1, 0];
    // a crack runs on, but prefers the map's own weak lines: mortar joints, plank seams, the dark side of things
    const walk = (x, y, dx, dy, len, depth) => {
      const path = [];
      for ( let k = 0; k < len; k++ ) {
        let a = Math.atan2(dy, dx);
        if ( wood ) { const g = Math.atan2(grain[1] * Math.sign(dy * grain[1] + dx * grain[0] || 1), grain[0] * Math.sign(dx * grain[0] + dy * grain[1] || 1)); a = a + ((((g - a) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 0.35; }
        let best = a, bl = Infinity;
        for ( const da of [-0.6, 0, 0.6] ) {
          const b = a + da + (R() - 0.5) * 0.3, X = Math.round(x + Math.cos(b)), Y = Math.round(y + Math.sin(b));
          if ( X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1 ) continue;
          const l = lum(Y * W + X) + Math.abs(da) * 18 + R() * 14;
          if ( l < bl ) { bl = l; best = b; }
        }
        dx = Math.cos(best); dy = Math.sin(best);
        x += dx; y += dy;
        const X = Math.round(x), Y = Math.round(y);
        if ( X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1 ) break;
        const i = Y * W + X;
        if ( inside[i] ) { if ( k > 1 ) break; continue; }
        if ( path[path.length - 1] !== i ) path.push(i);
        // a branch leaves at 30-60 degrees, not before a few pixels of its parent, shorter than what is left of it
        if ( k > 3 && depth < (jag > 0.4 ? 2 : 1) && R() < 0.035 + 0.09 * jag ) {
          const fa = Math.atan2(dy, dx) + (R() < 0.5 ? -1 : 1) * (Math.PI / 6 + R() * Math.PI / 6);
          walk(x, y, Math.cos(fa), Math.sin(fa), (len - k) * 0.45, depth + 1);
        }
      }
      if ( path.length >= 5 ) { path.depth = depth; C.cracks.push(path); }   // (a stub of a few pixels reads as a stray dash)
    };
    // the fractures start apart from each other round the rim (a minimum spacing: never two leaving from the same spot)
    const starts = [], gap = Math.max(5, C.maxD * 0.9);
    for ( let k = 0; k < count; k++ ) {
      let i = rim[Math.floor(R() * rim.length)];
      for ( let tries = 0; tries < 6 && starts.some((q) => ((q % W) - (i % W)) ** 2 + (((q - (q % W)) / W) - ((i - (i % W)) / W)) ** 2 < gap * gap); tries++ ) i = rim[Math.floor(R() * rim.length)];
      starts.push(i);
      const x = i % W, y = (i - x) / W;
      let e = C.epi[0], bd = Infinity;
      for ( const q of C.epi ) { const d = (q.x - x) ** 2 + (q.y - y) ** 2; if ( d < bd ) { bd = d; e = q; } }
      const dx = x - e.x, dy = y - e.y, dl = Math.hypot(dx, dy) || 1;
      // never as far as the window's edge (a crack cut off there reads as a straight line)
      walk(x, y, dx / dl, dy / dl, Math.min((3 + R() * (C.maxD * 0.9 + 4) * (C.maxSev / 3)) * (C.type === T_COLLAPSE ? 0.45 : 1), Math.max(2, roomOf(C) - 2)), 0);
    }
    for ( const path of C.cracks ) for ( const i of path ) {
      const x = i % W, y = (i - x) / W, r = C.rect;
      r.x0 = Math.min(r.x0, x - 1); r.y0 = Math.min(r.y0, y - 1); r.x1 = Math.max(r.x1, x + 1); r.y1 = Math.max(r.y1, y + 1);
    }
  }

  /**
   * A cause's hairline cracks (only with a cause; growCracks stays the unspecified look): the walk of growCracks under the cause's own
   * rules. Lightning branches wildly and ignores the map's weak lines, arcane cracks curl, frost runs in straight crystal facets at
   * 60 degrees, roots wander and fork, claws leave parallel scratches running on past the damage along its axis.
   */
  function causeCracks(C, R, cr) {
    if ( !cr ) return;
    const rim = [];
    for ( const i of C.px ) if ( din[i] <= 1.01 ) rim.push(i);
    if ( !rim.length ) return;
    const lum = (i) => 0.299 * map[i * 4] + 0.587 * map[i * 4 + 1] + 0.114 * map[i * 4 + 2];
    const mode = cr.mode, room = Math.max(2, roomOf(C) - 2), sixth = Math.PI / 3;
    const straight = cr.straight || mode === "branch" || mode === "crystal" || mode === "parallel";
    const TURN = mode === "branch" ? [-0.9, -0.45, 0, 0.45, 0.9] : mode === "crystal" ? [0] : mode === "parallel" ? [-0.1, 0, 0.1] : [-0.6, 0, 0.6];
    const maxDepth = mode === "branch" ? 3 : (mode === "crystal" || mode === "root") ? 2 : jag > 0.4 ? 2 : 1;
    const walk = (x, y, dx, dy, len, depth) => {
      const path = [];
      for ( let k = 0; k < len; k++ ) {
        let a = Math.atan2(dy, dx);
        if ( mode === "spiral" ) a += 0.17 * (depth & 1 ? -1 : 1);
        else if ( mode === "root" ) a += (vnoise(k / 3.5, depth * 5.3, seed + 521) - 0.5) * 1.1;
        else if ( mode === "crystal" ) { a = Math.round((a - sixth / 2) / sixth) * sixth + sixth / 2; if ( R() < 0.12 ) a += (R() < 0.5 ? -1 : 1) * sixth; }
        let best = a, bl = Infinity;
        for ( const da of TURN ) {
          const b = a + da + (R() - 0.5) * (mode === "crystal" || mode === "parallel" ? 0.04 : 0.3), X = Math.round(x + Math.cos(b)), Y = Math.round(y + Math.sin(b));
          if ( X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1 ) continue;
          const l = (straight ? 0 : lum(Y * W + X)) + Math.abs(da) * (mode === "branch" ? 5 : 18) + R() * 14;
          if ( l < bl ) { bl = l; best = b; }
        }
        dx = Math.cos(best); dy = Math.sin(best);
        x += dx; y += dy;
        const X = Math.round(x), Y = Math.round(y);
        if ( X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1 ) break;
        const i = Y * W + X;
        if ( inside[i] ) { if ( k > 1 ) break; continue; }
        if ( path[path.length - 1] !== i ) path.push(i);
        if ( depth < maxDepth && R() < 0.035 + cr.br + 0.09 * jag ) {
          const fork = mode === "crystal" ? (R() < 0.5 ? -1 : 1) * sixth : (R() - 0.5) * (mode === "branch" ? 2 : 1.4);
          const fa = Math.atan2(dy, dx) + fork;
          walk(x, y, Math.cos(fa), Math.sin(fa), (len - k) * (mode === "branch" ? 0.62 : 0.45), depth + 1);
        }
      }
      if ( path.length ) C.cracks.push(path);
    };
    const reach = (k = 1) => Math.min((3 + R() * (C.maxD * 0.9 + 4) * (Math.max(1.5, C.maxSev) / 3)) * cr.len * k, room);
    if ( mode === "bolt" ) {
      // lightning: one strike (two on a big or long area) - a branching channel from the impact out across the damage and past its rim
      // (pixel-fx boltTree: a jagged main channel, 2-4 forks at 30-60 degrees, a twig), never an area-filling web
      const nb = C.maxD > 9 || C.epi.length > 1 ? 2 : 1, a0 = R() * Math.PI * 2;
      for ( let b = 0; b < nb; b++ ) {
        // the second channel leaves the other way (one strike through the damage, never a star from its centre)
        const e = C.epi[(b * Math.max(1, C.epi.length - 1)) % C.epi.length], a = a0 + b * (Math.PI + (R() - 0.5));
        const L = Math.min((C.maxD * 1.1 + 6) * cr.len * (0.8 + R() * 0.4), room + e.R * 0.5);
        const tree = boltTree(seed * 13 + C.uid * 7 + b, e.x, e.y, e.x + Math.cos(a) * L, e.y + Math.sin(a) * L * 0.85, { forks: 2 + Math.floor(R() * 3) });
        const toPath = (pts, depth) => {
          const p = [];
          for ( let q = 1; q < pts.length; q++ ) for ( const [x, y] of lineCells(pts[q - 1][0], pts[q - 1][1], pts[q][0], pts[q][1]) ) {
            if ( x < 1 || y < 1 || x >= W - 1 || y >= H - 1 ) continue;
            const i = y * W + x; if ( p[p.length - 1] !== i ) p.push(i);
          }
          p.depth = depth; if ( p.length ) C.cracks.push(p);
        };
        toPath(tree.main, 0); for ( const f of tree.forks ) toPath(f.pts, f.depth);
      }
    } else if ( mode === "parallel" ) {
      // scratches: three or four lines along the axis, each running out of both ends of the damage
      // (on the furrows' own lanes: 3-4 gouges, the entry's streaks - clawLanes)
      const ax = C.axis, nx = -ax[1], ny = ax[0], lanes = clawLanes(Math.max(2.5, C.maxD), Math.max(3, ...C.epi.map((q) => q.R)), seed), g = lanes.n;
      for ( let k = 0; k < g; k++ ) {
        const q = lanes.q[k];
        for ( const sgn of [1, -1] ) {
          let bi = -1, bp = -Infinity;
          for ( const i of rim ) {
            const x = i % W, y = (i - x) / W, dx = x - C.cx, dy = y - C.cy;
            if ( Math.abs(dx * nx + dy * ny - q) > 1.2 ) continue;
            const p = (dx * ax[0] + dy * ax[1]) * sgn; if ( p > bp ) { bp = p; bi = i; }
          }
          if ( bi < 0 ) continue;
          walk(bi % W, Math.floor(bi / W), ax[0] * sgn, ax[1] * sgn, Math.min((C.maxD * 0.9 + 6) * cr.len * (0.6 + R() * 0.6), room), 1);
        }
      }
    } else {
      const count = Math.max(1, Math.round((2 + R() * 3 + C.maxD * 0.18) * (C.maxSev >= 2.5 ? 1 : 0.6) * (1 + jag) * cr.n));
      for ( let k = 0; k < count; k++ ) {
        const i = rim[Math.floor(R() * rim.length)], x = i % W, y = (i - x) / W;
        let e = C.epi[0], bd = Infinity;
        for ( const q of C.epi ) { const d = (q.x - x) ** 2 + (q.y - y) ** 2; if ( d < bd ) { bd = d; e = q; } }
        let a = Math.atan2(y - e.y, x - e.x);
        if ( mode === "spiral" ) a += 0.9;
        walk(x, y, Math.cos(a), Math.sin(a), reach(), 0);
      }
    }
    for ( const path of C.cracks ) for ( const i of path ) {
      const x = i % W, y = (i - x) / W, r = C.rect;
      r.x0 = Math.min(r.x0, x - 1); r.y0 = Math.min(r.y0, y - 1); r.x1 = Math.max(r.x1, x + 1); r.y1 = Math.max(r.y1, y + 1);
    }
  }

  /* ---------------------------------------------------------------- what lies beneath, the halos, the lip, the shadows */
  function drawBase(C) {
    const pal = C.pal, rp = pal.ramp, type = C.type;
    const haloR = Math.min(roomOf(C) - 2, (type === T_SCORCH ? 4 + C.maxD * 1.4 : type === T_BLAST ? 2 + C.maxD * 0.9 : type === T_COLLAPSE ? 2 + C.maxD * 0.5 : 0) * clamp(P.halo ?? 0.6, 0, 1) * (C.maxSev / 3));
    // the cause's own halo (its own radius, on top of the kind's)
    const cz = C.cz;
    // (cracks: no cause halo - round the stroke's mask it drew a ring, a lasso round thin crack strokes)
    const cHaloR = cz?.halo && type !== T_CRACKS ? Math.min(roomOf(C) - 2, (3 + C.maxD * cz.halo.r) * clamp(P.halo ?? 0.6, 0.15, 1) * (0.35 + C.maxSev / 3)) : 0;
    const outR = cz ? Math.max(haloR, cHaloR) : haloR;
    const r = C.rect;
    r.x0 = clamp(Math.floor(Math.min(r.x0, C.x0 - outR - 2)), 0, W - 1); r.y0 = clamp(Math.floor(Math.min(r.y0, C.y0 - outR - 2)), 0, H - 1);
    r.x1 = clamp(Math.ceil(Math.max(r.x1, C.x1 + outR + 2)), 0, W - 1); r.y1 = clamp(Math.ceil(Math.max(r.y1, C.y1 + outR + 2)), 0, H - 1);
    const bw = r.x1 - r.x0 + 1, bh = r.y1 - r.y0 + 1;
    const img = new Uint8ClampedArray(bw * bh * 4);
    const put = (x, y, col, a = 255) => {
      if ( x < r.x0 || y < r.y0 || x > r.x1 || y > r.y1 ) return;
      const o = ((y - r.y0) * bw + (x - r.x0)) * 4;
      if ( a < 255 && img[o + 3] === 255 ) { const m = mix([img[o], img[o + 1], img[o + 2]], col, a / 255); img[o] = m[0]; img[o + 1] = m[1]; img[o + 2] = m[2]; return; }
      img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; img[o + 3] = a;
    };
    const mapAt = (i) => [map[i * 4], map[i * 4 + 1], map[i * 4 + 2]];
    const isIn = (x, y) => x >= 0 && y >= 0 && x < W && y < H && own[y * W + x] === 1;
    const maxD = Math.max(2.5, C.maxD);
    const rubble = clamp(P.rubble ?? 0.6, 0, 1);
    // a cause's emissive pixels (fire, acid, lightning, arcane) are also kept apart: they become the area's light sprite, which the
    // display lays into the scene's illumination so they keep their colour in the dark. Without a glow, glow() is put().
    const glowA = cz?.glow ? new Uint8Array(bw * bh) : null, glowC = glowA ? new Uint8Array(bw * bh * 3) : null;
    const glow = (x, y, col, a = 255) => {
      put(x, y, col);
      if ( !glowA || x < r.x0 || y < r.y0 || x > r.x1 || y > r.y1 ) return;
      const q = (y - r.y0) * bw + (x - r.x0); if ( a <= glowA[q] ) return;
      glowA[q] = a; glowC[q * 3] = col[0]; glowC[q * 3 + 1] = col[1]; glowC[q * 3 + 2] = col[2];
    };
    const E0 = C.epi[0], Rr = Math.max(3, ...C.epi.map((q) => q.R));
    const kit = cz ? causeKit({ cz, pal, seed, W, H, mapAt, put, glow, isIn, inside, din, maxD, E0, Rr, C, haloR: cHaloR }) : null;
    // 1. the exposed layer
    for ( const i of C.px ) {
      if ( C.keep.has(i) ) continue;
      const x = i % W, y = (i - x) / W, sv = sev[i], t = typ[i];
      const dn = Math.min(1, din[i] / maxD);
      const depth = Math.pow(dn, 0.75) * (sv - 0.6) / 2.4;
      // the far (north) wall, seen face-on by the oblique camera
      const wallH = t === T_CRACKS ? 1 : Math.round(clamp(sv * 1.2 + (t === T_COLLAPSE ? 1.5 : 0), 1, 4));
      let wall = 0;
      for ( let k = 1; k <= wallH; k++ ) if ( !isIn(x, y - k) ) { wall = k; break; }
      let col;
      if ( wall ) {
        const above = (y - wall) * W + x;
        col = wall === 1 ? mul(above >= 0 ? mapAt(Math.max(0, above)) : rp[2], 0.6) : wall === 2 ? pal.strata[0] : (x + y) & 1 ? pal.strata[1] : mul(pal.strata[1], 0.86);
        if ( A.sub ) { col = A.sub.fx(i, col, type, A.clean); if ( !col ) continue; if ( col.a ) { put(x, y, col, col.a); continue; } }
        put(x, y, col); continue;
      }
      // a bowl lit from the top left: the gradient of the depth decides
      const gx = (din[i + 1] ?? 0) - (din[i - 1] ?? 0), gy = (din[i + W] ?? 0) - (din[i - W] ?? 0), gl = Math.hypot(gx, gy) || 1;
      const lit = ((gx / gl) * -0.7071 + (gy / gl) * -0.7071) * Math.min(1, depth * 3 + 0.2);
      // (cracks keep their plates: the gaps between them only go darker with the level - a broken crack is never lighter than a hairline)
      let v = (sv < 1.5 ? 1.1 : t === T_CRACKS ? 1.1 - (sv - 1.5) * 0.6 : t === T_BLAST ? 3.6 + (dn < 0.3 ? (0.3 - dn) * 1.5 : 0) : 3.4) - depth * (t === T_COLLAPSE ? 2.9 : t === T_BLAST ? 2.7 : 2.1) + lit * 1.7 + (h2(x, y, seed + 11) - 0.5) * 0.22 + (vnoise(x / 4, y / 4, seed + 12) - 0.5) * 0.6;   // (smooth bands lit from the top left: no per-pixel speckle)
      // banded shading: flat tone bands with a narrow dithered seam between them (not a field of checkerboard)
      let idx = clamp(Math.floor(v + (bayer(x, y) - 0.5) * 0.45), 0, 4);
      col = rp[idx];
      // materials
      if ( C.cls.mat === M.wood && t !== T_SCORCH && t !== T_FLOOD ) {
        const q = C.cls.grainX ? y : x;      // joists run across the planks
        const j = ((q % 15) + 15) % 15; if ( j < 4 && depth > 0.06 ) col = j === 0 ? mul(pal.beam, 1.18) : j === 3 ? mul(pal.beam, 0.6) : pal.beam;
      }
      if ( C.cls.mat === M.metal && (x % 8 === 0 || y % 8 === 0) && depth > 0.1 ) col = mix(pal.girder, rp[2], 0.3);
      if ( C.cls.mat === M.snow && h2(x, y, seed + 31) < 0.06 ) col = pal.chunk;
      if ( C.cls.mat === M.grass && dn < 0.25 && h2(x, y, seed + 33) < 0.05 ) col = rp[0];   // roots
      // a cave-in in layered depth: the wall in lit / shaded tone bands with strata, then the void with a faint floor (collapse.mjs)
      if ( t === T_COLLAPSE && C.collBand ) col = collapseShade(pal, seed, x, y, din[i], depth, lit, col, sv, dn);
      // cracks: the stroke's own tone - a main fissure's root near black, the branches dark, hairlines the map inked (drawBase bevels them)
      if ( t === T_CRACKS && C.crackAt?.[i] ) {
        const q = C.crackAt[i], top = i >= W && !C.crackAt[i - W];
        col = q === 1 ? mix(mapAt(i), pal.ink, 0.72) : top ? mix(mul(mapAt(i), 0.62), pal.strata[0], 0.5) : q >= 3 ? mul(rp[0], 0.5) : mix(rp[0], pal.ink, 0.3);
      }
      // flooded: the water itself is the water engine's (flood.mjs) laid over this; under a shallow pool (broken) the wet bottom shows,
      // under a deep one (crater) the dark of the deep water
      if ( t === T_FLOOD && sv <= 2.45 ) col = mul(col, 0.8);
      else if ( t === T_FLOOD && depth > 0.18 ) {
        const k = clamp(4 - (depth - 0.18) * 7 + (vnoise(x / 4, y / 2, seed + 41) - 0.5) * 1.2, 0, 4);
        col = pal.waterR[clamp(Math.floor(k + bayer(x, y) - 0.5), 1, 3)];
        if ( vnoise(x / 5, y / 3, seed + 43) > 0.74 && h2(x, y, seed + 44) < 0.1 ) col = pal.waterR[4];   // a few glints in patches (no even dashes)
      }
      // embers in clusters along the hottest seams, a few bright, most dull (no even confetti)
      if ( t === T_SCORCH && depth > 0.4 && h2(x, y, seed + 51) < 0.012 * clamp((vnoise(x / 5, y / 5, seed + 53) - 0.55) * 4, 0, 1) ) { const e = h2(x, y, seed + 52); col = e < 0.2 ? pal.ember[1] : e < 0.55 ? pal.ember[0] : mix(pal.ember[2], pal.char[1], 0.4); }
      if ( cz ) { col = kit.fill(x, y, col, depth, dn, lit); if ( !col ) continue; }
      // over older damage (substrate.mjs INTERACT): deeper, charred, or left to the older look
      if ( A.sub ) { col = A.sub.fx(i, col, type, A.clean); if ( !col ) continue; if ( col.a ) { put(x, y, col, col.a); continue; } }
      put(x, y, col);
    }
    // crack strokes cut in: a lit edge on the side facing the light (below / right of the groove), a shaded one on the other
    if ( type === T_CRACKS && C.crackAt ) for ( const i of C.px ) {
      if ( !C.crackAt[i] ) continue;
      const x = i % W, y = (i - x) / W;
      for ( const [j, lit] of [[i + W, 1], [i + 1, 1], [i - W, 0], [i - 1, 0]] ) {
        if ( j < 0 || j >= N || !C.keep.has(j) || C.crackAt[j] ) continue;
        if ( lit && h2(j, 3, seed + 85) < 0.75 ) put(j % W, (j - (j % W)) / W, mul(mapAt(j), 1.16));
        else if ( !lit ) put(j % W, (j - (j % W)) / W, mix(mapAt(j), pal.ink, C.crackAt[i] >= 2 ? 0.42 : 0.25));
      }
    }
    // a stepped lip: the raised side's lit edge and the shadow it casts on the lower side
    if ( type === T_CRACKS && C.crackLip ) for ( const i of C.px ) {
      const q = C.crackLip[i]; if ( !q || !C.keep.has(i) ) continue;
      put(i % W, (i - (i % W)) / W, q === 1 ? mul(mapAt(i), 1.12) : mix(mapAt(i), pal.ink, 0.3));
    }
    // plates it left in place over older damage: a char over them where its rule chars (nothing drawn otherwise: the older look stays)
    if ( A.sub ) for ( const i of C.keep ) { const c = A.sub.keepFx(i, type, pal.char?.[0] ?? rp[0]); if ( c ) put(i % W, (i - (i % W)) / W, c, c.a); }
    // 2. rubble: chips of the surface and stones, thicker towards the rim
    if ( type !== T_CRACKS && type !== T_SCORCH ) for ( const i of C.px ) {     // (flooded too: the rubble lies under the water; a burn has none: no specks on its floor)
      if ( C.keep.has(i) || A.sub?.yields(i, type) ) continue;
      const x = i % W, y = (i - x) / W, dn = din[i] / maxD;
      // (a handful of bigger, readable stones - not a field of single light squares)
      const dens =rubble * 0.4 * (0.035 + 0.09 * Math.exp(-((dn - 0.35) ** 2) / 0.05)) * (sev[i] / 3) * (type === T_COLLAPSE && dn > 0.55 ? 1.7 : 1);
      if ( h2(x, y, seed + 61) >= dens || !isIn(x + 1, y + 1) ) continue;
      if ( (cz?.fill === "silt" || cz?.fill === "ice") && din[i] / maxD > 0.25 ) continue;   // (no stones on the water standing in an eroded pit, on an ice sheet)
      const fromMap = h2(x, y, seed + 62) < (type === T_COLLAPSE ? 0.65 : 0.3);
      const sx = clamp(x + Math.round((h2(x, y, seed + 63) - 0.5) * 8), 0, W - 1), sy = clamp(y + Math.round((h2(x, y, seed + 64) - 0.5) * 8), 0, H - 1);
      const light = fromMap && type === T_BLAST ? mul(mapAt(sy * W + sx), 1.06) : fromMap ? (type === T_COLLAPSE ? mix(mul(mapAt(sy * W + sx), 0.75), rp[1], clamp(dn * 1.2 - 0.2, 0.2, 0.85)) : mul(mapAt(sy * W + sx), 0.9)) : rp[3 + (h2(x, y, seed + 66) < 0.4 ? 1 : 0)];
      // a stone of 1, 2 or 4 pixels: lit top-left, shaded bottom-right, a dark pixel of shadow under it
      const sz = h2(x, y, seed + 65), wide = sz > 0.25, tall = sz > 0.55;
      put(x, y, light);
      if ( wide && isIn(x + 1, y) ) put(x + 1, y, mul(light, 0.78));
      if ( tall && isIn(x, y + 1) ) { put(x, y + 1, mul(light, 0.82)); if ( isIn(x + 1, y + 1) ) put(x + 1, y + 1, mul(light, 0.66)); }
      const sy2 = y + (tall ? 2 : 1);
      if ( isIn(x, sy2) ) put(x, sy2, rp[0]);
      if ( wide && isIn(x + 1, sy2) ) put(x + 1, sy2, rp[0]);
    }
    // 3. halos on the intact map: scorch (1-bit dither of char), dust
    if ( haloR > 0.5 ) for ( let y = r.y0; y <= r.y1; y++ ) for ( let x = r.x0; x <= r.x1; x++ ) {
      const i = y * W + x; if ( inside[i] ) continue;
      const d = dout[i]; if ( d > haloR || d < 1.5 ) continue;
      const k = Math.pow(1 - d / haloR, 1.4), n = vnoise(x / 2.2, y / 2.2, seed + 71) * 0.75 + h2(x, y, seed + 72) * 0.25;
      if ( type === T_SCORCH ) { const s = k * 1.15 - (vnoise(x / 5, y / 5, seed + 73) - 0.5) * 0.5, lvS = Math.floor(s * 3 + (bayer(x, y) - 0.5) * 0.25); if ( lvS >= 1 ) put(x, y, mix(mapAt(i), lvS >= 3 ? pal.char[0] : pal.char[1], lvS >= 3 ? 0.85 : lvS === 2 ? 0.55 : 0.3)); }
      else if ( type === T_BLAST ) { if ( n < k * 0.75 ) put(x, y, mul(mapAt(i), n < k * 0.35 ? 0.5 : 0.7)); }
      else if ( n < k * 0.22 && (x + y) % 3 ) put(x, y, mix(mapAt(i), pal.dust, 0.45));
    }
    // 3b. the cause's halo over the kind's
    if ( cHaloR > 0.5 ) for ( let y = r.y0; y <= r.y1; y++ ) for ( let x = r.x0; x <= r.x1; x++ ) {
      const i = y * W + x; if ( inside[i] ) continue;
      const d = dout[i]; if ( d > cHaloR || d < 1.5 ) continue;
      kit.halo(x, y, i, d);
    }
    // 4. the torn lip: an inked line around the hole on the intact side, a light lip above-left of it
    for ( let y = r.y0; y <= r.y1; y++ ) for ( let x = r.x0; x <= r.x1; x++ ) {
      const i = y * W + x; if ( inside[i] || dout[i] > 1.01 ) continue;
      let near = -1, s = 0;
      // only where the surface is really torn open next to it: never along plates that stayed
      for ( const j of [i - 1, i + 1, i - W, i + W] ) if ( j >= 0 && j < N && own[j] === 1 && !C.keep.has(j) ) { near = j; s = Math.max(s, sev[j]); }
      if ( near < 0 || (type === T_CRACKS && C.crackAt) ) continue;   // (crack strokes carry their own bevel, no lip)
      if ( cz ) { kit.lip(x, y, i, s); continue; }
      if ( s >= 1.6 ) put(x, y, pal.ink);
      else put(x, y, mix(mapAt(i), pal.ink, 0.55));
    }
    // 5. hairline cracks: one ink pixel, with a lighter lip of the map's own colour up-left of it (a cause draws its own), then the
    // cause's specks
    if ( cz ) { kit.crackLines(C.cracks); if ( cz.fx ) kit.fx(C.px, (i) => C.keep.has(i)); }
    else for ( const path of C.cracks ) for ( const i of path ) {
      // a hierarchy: a main fissure is two pixels wide at its root and tapers to one, branches are dark, the far ends of
      // branches fade to hairlines
      const x = i % W, y = (i - x) / W, f = path.indexOf(i) / path.length, dep = path.depth | 0;
      const ink = dep ? (f < 0.6 ? 0.8 : 0.55) : f < 0.75 ? 0.9 : 0.7;
      put(x, y, mix(mapAt(i), pal.ink, ink));
      if ( !dep && f < 0.4 ) { const q = i + W; if ( y + 1 < H && !inside[q] ) put(x, y + 1, mix(mapAt(q), pal.ink, f < 0.2 ? 0.75 : 0.5)); }
      const j = i - W; if ( j >= 0 && !inside[j] && h2(x, y, seed + 81) < 0.5 ) put(x, y - 1, mul(mapAt(j), 1.14));
    }
    // 6. shard shadows: one flat colour, alpha ~100
    const shadowCol = mul(pal.ramp[0], 0.7);
    const shadowSeen = new Set();
    for ( const s of C.shards ) if ( s.shadow ) for ( let k = 0; k < s.shadow.length; k += 2 ) {
      const x = s.shadow[k], y = s.shadow[k + 1], key = y * 65536 + x;
      if ( shadowSeen.has(key) ) continue; shadowSeen.add(key);
      put(x, y, shadowCol, 100);
    }
    // 7. the torn lip's ink, broken and of varying weight (never an even inked lasso round the hole); cracks keep their full ink
    if ( !C.cz && type !== T_CRACKS ) for ( let y = r.y0; y <= r.y1; y++ ) for ( let x = r.x0; x <= r.x1; x++ ) {
      const i = y * W + x; if ( inside[i] || dout[i] > 1.01 ) continue;
      let s = 0;
      for ( const j of [i - 1, i + 1, i - W, i + W] ) if ( j >= 0 && j < N && own[j] === 1 && !C.keep.has(j) ) s = Math.max(s, sev[j]);
      if ( type === T_COLLAPSE ) {   // a cave-in's lip: long gaps, light and mid stretches, short full-ink runs (collapse.mjs)
        const k = collapseLip(x, y, seed);
        if ( k < 1 ) { const o = ((y - r.y0) * bw + (x - r.x0)) * 4; if ( k > 0 ) { const c = mix(mapAt(i), pal.ink, k * (s < 1.6 ? 0.3 : 1)); img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; } else img[o + 3] = 0; }
        continue;
      }
      if ( s < 1.6 ) continue;
      const w = vnoise(x / 4.5, y / 4.5, seed + 91) + (h2(x, y, seed + 92) - 0.5) * 0.25;
      if ( w <= 0.62 ) { const o = ((y - r.y0) * bw + (x - r.x0)) * 4; if ( w > 0.34 ) { const c = mix(mapAt(i), pal.ink, 0.6); img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; } else if ( w > 0.2 ) { const c = mix(mapAt(i), pal.ink, 0.3); img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; } else img[o + 3] = 0; }
    }
    C.base = { x: r.x0, y: r.y0, w: bw, h: bh, data: img };
    if ( glowA && glowA.some((a) => a) ) C.light = softLight(glowA, glowC, bw, bh, r.x0, r.y0, cz.glowK ?? 1);
  }

  /* ---------------------------------------------------------------- this area's sprites (absolute art coordinates) */
  const items = [];
  const row = () => new Int16Array(META_FIELDS);
  {
    const m = row(), e = C.epi[0];
    m[0] = 0; m[3] = C.base.w; m[4] = C.base.h; m[5] = RX + C.base.x; m[6] = RY + C.base.y;
    m[7] = RX + e.x; m[8] = RY + e.y; m[9] = Math.round(Math.max(...C.epi.map((q) => q.R))); m[10] = C.type; m[11] = C.cls.mat;
    m[14] = Math.round(Math.atan2(C.axis[1], C.axis[0]) * 1000); m[15] = Math.round(Math.min(3000, C.len * 10));
    items.push({ img: C.base, m });
    // the cover: this part's own pixels, opaque (the display lays the plain map over older strokes there, then this part on top)
    let cx0 = W, cy0 = H, cx1 = -1, cy1 = -1;
    for ( const i of C.px ) { const x = i % W, y = (i - x) / W; if ( x < cx0 ) cx0 = x; if ( x > cx1 ) cx1 = x; if ( y < cy0 ) cy0 = y; if ( y > cy1 ) cy1 = y; }
    const cw = cx1 - cx0 + 1, chh = cy1 - cy0 + 1, cov = new Uint8ClampedArray(cw * chh * 4);
    for ( const i of C.px ) { const x = i % W - cx0, y = (i - (i % W)) / W - cy0, q = (y * cw + x) * 4; cov[q] = cov[q + 1] = cov[q + 2] = cov[q + 3] = 255; }
    const mc = row(); mc[0] = 2; mc[3] = cw; mc[4] = chh; mc[5] = RX + cx0; mc[6] = RY + cy0;
    items.push({ img: { w: cw, h: chh, data: cov, x: cx0, y: cy0 }, m: mc });
    // the cause's light (its emissive pixels, soft) as a sprite of kind 3 (the cause itself goes on the base row in bake())
    if ( C.light ) { const ml = row(); ml[0] = 3; ml[3] = C.light.w; ml[4] = C.light.h; ml[5] = RX + C.light.x; ml[6] = RY + C.light.y; ml[7] = C.cause; items.push({ img: C.light, m: ml }); }
  }
  let bytes = C.base.data.length + (C.light?.data.length ?? 0);
  for ( const s of C.shards ) {
    if ( s.skip || !s.img ) continue;
    // cut by the scene's edge: a piece that lies wholly past it is culled (no sprite, no bytes), one across it is clipped
    if ( A.aw ) {
      const im = s.img, ax = RX + im.x, ay = RY + im.y;
      const cx0 = Math.max(0, -ax), cy0 = Math.max(0, -ay), cx1 = Math.min(im.w, A.aw - ax), cy1 = Math.min(im.h, A.ah - ay);
      if ( cx1 <= cx0 || cy1 <= cy0 ) { stats.culled++; continue; }
      if ( cx0 || cy0 || cx1 < im.w || cy1 < im.h ) {
        const w = cx1 - cx0, h = cy1 - cy0, data = new Uint8ClampedArray(w * h * 4);
        for ( let y = 0; y < h; y++ ) data.set(im.data.subarray(((y + cy0) * im.w + cx0) * 4, ((y + cy0) * im.w + cx1) * 4), y * w * 4);
        s.img = { w, h, data, x: im.x + cx0, y: im.y + cy0 };
        s.src = { x: s.src.x + cx0, y: s.src.y + cy0 };
      }
    }
    const m = row();
    m[0] = 1; m[3] = s.img.w; m[4] = s.img.h; m[5] = RX + s.img.x; m[6] = RY + s.img.y;
    m[7] = RX + s.src.x; m[8] = RY + s.src.y;                    // where the piece came from
    m[9] = Math.round(-s.th * 1000);                              // spin to undo while it flies
    m[10] = Math.round(Math.hypot(s.cx - s.e.x, s.cy - s.e.y) * 4); // distance from the impact (stagger)
    m[11] = (s.chip ? 1 : 0) | (s.thrown ? 2 : 0) | ((s.dx || s.dy) ? 4 : 0);   // the area index is added when the sheet is packed
    m[12] = Math.round(clamp(s.z0, -20, 20) * 10); m[13] = s.type;
    items.push({ img: s.img, m });
    bytes += s.img.data.length;
  }
  return { items, stats, bytes };
}

/**
 * A cause's light: its emissive pixels (alpha a, colour c, w x h at x0, y0) spread into a soft glow (two box blurs of radius 3, a
 * margin of 6), the crisp cores kept at full strength, the colour whitened towards the middle like a lamp's pool. RGBA image.
 */
function softLight(a, c, w, h, x0, y0, gain = 1) {
  const B = 6, LW = w + 2 * B, LH = h + 2 * B, n = LW * LH;
  let A = new Float32Array(n), Rc = new Float32Array(n), Gc = new Float32Array(n), Bc = new Float32Array(n);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    const q = y * w + x; if ( !a[q] ) continue;
    const o = (y + B) * LW + x + B, al = a[q] / 255;
    A[o] = al; Rc[o] = c[q * 3] * al; Gc[o] = c[q * 3 + 1] * al; Bc[o] = c[q * 3 + 2] * al;
  }
  const core = A.slice();
  const blur = (src, horiz) => {
    const out = new Float32Array(n), R = 3, k = 1 / (2 * R + 1);
    for ( let y = 0; y < LH; y++ ) for ( let x = 0; x < LW; x++ ) {
      let s = 0;
      for ( let d = -R; d <= R; d++ ) { const X = horiz ? x + d : x, Y = horiz ? y : y + d; if ( X >= 0 && Y >= 0 && X < LW && Y < LH ) s += src[Y * LW + X]; }
      out[y * LW + x] = s * k;
    }
    return out;
  };
  for ( let pass = 0; pass < 2; pass++ ) { A = blur(blur(A, true), false); Rc = blur(blur(Rc, true), false); Gc = blur(blur(Gc, true), false); Bc = blur(blur(Bc, true), false); }
  const data = new Uint8ClampedArray(n * 4);
  for ( let o = 0; o < n; o++ ) {
    const al = A[o]; if ( al < 0.004 && !core[o] ) continue;
    // the soft margin never lights more than half (a dense network of glowing cracks must not flood the dark), the cores do
    const s = Math.max(core[o], Math.min(0.5, al * 2.4 * gain)), inv = al > 1e-6 ? 1 / al : 0;
    const wht = 0.25 + 0.4 * s;
    data[o * 4] = Math.round(lerp(Rc[o] * inv, 255, wht)); data[o * 4 + 1] = Math.round(lerp(Gc[o] * inv, 255, wht)); data[o * 4 + 2] = Math.round(lerp(Bc[o] * inv, 255, wht));
    data[o * 4 + 3] = Math.round(s * 255);
  }
  return { x: x0 - B, y: y0 - B, w: LW, h: LH, data };
}

/** Two-pass chamfer distance (1, sqrt 2) in place: 0 = source, large = to fill. */
function chamfer(d, W, H) {
  const D = 1.4142;
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    const i = y * W + x; let v = d[i]; if ( !v ) continue;
    if ( x > 0 ) v = Math.min(v, d[i - 1] + 1);
    if ( y > 0 ) { v = Math.min(v, d[i - W] + 1); if ( x > 0 ) v = Math.min(v, d[i - W - 1] + D); if ( x < W - 1 ) v = Math.min(v, d[i - W + 1] + D); }
    d[i] = v;
  }
  for ( let y = H - 1; y >= 0; y-- ) for ( let x = W - 1; x >= 0; x-- ) {
    const i = y * W + x; let v = d[i]; if ( !v ) continue;
    if ( x < W - 1 ) v = Math.min(v, d[i + 1] + 1);
    if ( y < H - 1 ) { v = Math.min(v, d[i + W] + 1); if ( x < W - 1 ) v = Math.min(v, d[i + W + 1] + D); if ( x > 0 ) v = Math.min(v, d[i + W - 1] + D); }
    d[i] = v;
  }
}

/** Shelf packing, tallest first, one pixel of gutter. */
function shelfPack(rects) {
  const area = rects.reduce((a, r) => a + (r.w + 1) * (r.h + 1), 0);
  let W = 256; while ( W * W < area * 1.25 && W < 4096 ) W *= 2;
  W = Math.max(W, ...rects.map((r) => r.w + 1));
  const order = rects.map((r, i) => i).sort((a, b) => rects[b].h - rects[a].h || rects[b].w - rects[a].w);
  const pos = new Array(rects.length);
  let x = 0, y = 0, rowH = 0;
  for ( const i of order ) {
    const r = rects[i];
    if ( x + r.w > W ) { x = 0; y += rowH + 1; rowH = 0; }
    pos[i] = { x, y }; x += r.w + 1; rowH = Math.max(rowH, r.h);
  }
  return { W, H: Math.max(1, y + rowH + 1), pos };
}

/** Read the placement table back from a decoded sheet (RGBA of the last `metaRows` rows). */
export function readMeta(rgba, W, H, metaRows) {
  const n = metaRows * W, bytes = new Uint8Array(n * 3);
  for ( let k = 0; k < n; k++ ) { const o = ((H - metaRows) * W + k) * 4; bytes[k * 3] = rgba[o]; bytes[k * 3 + 1] = rgba[o + 1]; bytes[k * 3 + 2] = rgba[o + 2]; }
  const count = new DataView(bytes.buffer).getUint32(0, true);
  // a file that does not hold what it says (truncated, foreign, an older format) is refused, never read past its end
  if ( !Number.isFinite(count) || count * META_FIELDS * 2 + 4 > bytes.length || metaRows <= 0 || metaRows > H ) throw new Error("bad destruction sheet (${count} sprites in ${metaRows} rows)");
  const meta = new Int16Array(count * META_FIELDS);
  new Uint8Array(meta.buffer).set(bytes.subarray(4, 4 + count * META_FIELDS * 2));
  return meta;
}
