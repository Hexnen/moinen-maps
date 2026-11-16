/* MAPBURN: the SCORE of a burning fire (pure: no Foundry, no PIXI, no DOM; node-tested in dev/sfx-burnscore.test.mjs).
   ADVM r2 item 8: a burning fire lettered the same three or four words for 20+ s with nothing that builds (the engine's run picked a
   treatment at random and never asked the vocabulary for the fire's own ladder), a smouldering fire - the scene's standing fire -
   only a small hollow word every 5-11 s (the engine's ambient mode), dark orange on orange flames with a soft glow box behind.
   Now every fire is told as a story that builds, phrase by phrase, from shared data only (the fire's id, the phrase's index, the fire's
   level at the phrase's own instant on the run's shared clock), so every seat - one joining late too - letters the same phrase at the
   same instant:
     - the vocabulary's FIRE LADDER (words.mjs: 1 ember ticks, 2 flame, 3 crackling fire, 4 a blaze's gust, 5 an inferno's roar);
     - a STANZA climbs it in four phrases (two rising, the peak, the fall back to the embers), an ARC of three stanzas grows from one to
       the next (longer words, bigger letters, a higher peak) and ends on the arc's roar, slammed in; then the fire draws breath and
       the next arc begins with other words;
     - how high the ladder goes is the fire's own HEAT now (a smoulder plays on rungs 1-3, a fire to 4, a blaze to 5): a fire that
       grows climbs, one that dies down sinks;
     - each rung has its size (the peak the biggest: the run's own size), its treatment (ember ticks pop in one by one, a gust
       stretches, the roar slams), its length, and its colour on a heat ramp from amber to white-hot: light faces on the engine's ink
       rim and deep red-brown block read on orange flames, grey smoke and a red-lit floor (a fire painted in its own colour keeps it). */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** the heat classes: a fire's level 0..1 (sfx-core burnPlan `level`: 0.12 at fire level 1, 0.42 at 2, 0.72 at 3) -> the top rung */
export const HEAT = [{ id: "smoulder", under: 0.3, top: 3 }, { id: "fire", under: 0.6, top: 4 }, { id: "blaze", under: Infinity, top: 5 }];
export const heatOf = (level) => HEAT.find((h) => (Number.isFinite(level) ? level : 0) < h.under) ?? HEAT[HEAT.length - 1];

/** a stanza: the rungs under the stanza's peak for its four phrases (rise, rise, PEAK, fall), and the arc: three stanzas whose peak
    climbs to the fire's top rung; the fall is the embers, after the arc's roar the flame (the fire draws breath) */
export const STANZA = 4, ARC = 3;
/** the peak of stanza `s` of an arc for a fire whose top rung is `top`: one under the top, then the top twice (the last the arc's roar) */
export const peakOf = (s, top) => clamp(s === 0 ? top - 1 : top, 2, 5);
/** the rung of phrase position `q` (0..3) in stanza `s` */
export function rungOf(q, s, top) {
  const pk = peakOf(s, top);
  if ( q === 2 ) return pk;
  if ( q === 3 ) return s === ARC - 1 ? Math.min(2, pk - 1) : 1;
  return clamp(pk - 2 + q, 1, pk - 1);
}
/** each rung: its size as a share of the run's size (the roar = the run's size), how long it is the current phrase (ms), its loudness
    for the engine (0..1: how alive it stands), its treatment (the engine's sustain treatments) and its face on the heat ramp */
export const RUNGS = {
  1: { scale: 0.56, ms: 900, level: 0.22, treat: "split", face: "#ffc530" },     // embers ticking: amber
  2: { scale: 0.66, ms: 1050, level: 0.34, treat: "breath", face: "#ffd83a" },   // a flame's puff: yellow
  3: { scale: 0.76, ms: 1150, level: 0.5, treat: "split", face: "#ffe566" },     // crackling: the crack lands on its beat
  4: { scale: 0.88, ms: 1300, level: 0.68, treat: "stretch", face: "#fff0a0" },  // a blaze's gust: swells
  5: { scale: 1, ms: 1500, level: 0.86, treat: "stretch", face: "#fff9dc" }      // an inferno's roar: white-hot
};
/** how the stanzas of an arc grow: size, and the word's tier (the vocabulary's loudness: short -> long words, the last with "!") */
export const GROW = [{ k: 0.82, loud: 0.15 }, { k: 0.91, loud: 0.5 }, { k: 1, loud: 0.9 }];
/** the arc's last peak is slammed in (the engine's accent: slam + shake) and stands longer */
export const ROAR = { treat: "accent", ms: 1.25 };
/** the biggest size share a fire of this top rung letters (its roar): what its room is laid out for */
export const topScale = (top) => RUNGS[peakOf(ARC - 1, top)].scale;
/** the run's width: no phrase wider than WIDE of the run's sizes x its top share (a long word is lettered smaller, never squeezed by
    the engine: a letter of the fire words is at most about CHAR of its size wide - measured on the engine, League Gothic: the ladder's
    longest words, 14-17 letters, draw 9.4-10.1 sizes of ink) */
export const WIDE = 13, CHAR = 0.72;
/** the size share a word of `len` letters may have at most in a run whose top rung is `top` */
export const fitScale = (len, top) => (WIDE * topScale(top)) / (Math.max(1, len) * CHAR);

/**
 * The score of one burning spot. `seed` (shared: scene | fire id | spot), `heat(ms)` -> the fire's level 0..1 at `ms` of the run's clock
 * (shared data), `word(opts)` -> the vocabulary's word for { intensity, loud, seed } (the engine's L.word("fire", ...): its text, or { text, mood }),
 * `colors` (a fire painted in its own colour: every phrase keeps it), `reduced` (this seat's reduced motion: no slam), `spot` (which
 * of the fire's spots: the second and third start SPOT_SHIFT phrases on in the arc and stay a rung under the first).
 * -> phrase(i, ms) = { text, mood, treat, level, scale, ms, colors, rung, top, stanza, pos, arc } for the engine's `words` function: the
 * same for the same (seed, i, heat) on every seat.
 */
export function burnScore({ seed = "", heat = () => 0.5, word, colors = null, reduced = false, spot = 0 } = {}) {
  const sp = Math.max(0, spot | 0);
  const raw = (i, ms, salt = 0) => {
    const n = Math.max(0, i | 0) + sp * SPOT_SHIFT, arc = Math.floor(n / (STANZA * ARC)), s = Math.floor(n / STANZA) % ARC, q = n % STANZA;
    const top = Math.max(2, heatOf(heat(ms)).top - (sp ? 1 : 0)), rung = rungOf(q, s, top), R = RUNGS[rung], G = GROW[s];
    const roar = q === 2 && s === ARC - 1;
    // (the word: the rung's row at the stanza's tier; arcs differ by their seed, a fall is always the quiet tier)
    // (asked again for another word - `salt` - the tier moves too: a rung's row at one tier is two or three words)
    const loud0 = q === 3 ? 0.15 : q === 2 ? G.loud : Math.min(G.loud, 0.5), loud = salt ? [0.5, 0.15, 0.9][(salt + (loud0 >= 0.5 ? 0 : 2)) % 3] : loud0;
    // (the word and its mood - the vocabulary's own for the kind: left to the engine, a phrase's mood was read from its letters and its
    // design from the words this seat had drawn before, so a seat that joined late lettered the same phrase another height)
    let text = "", mood;
    try { const w = word({ intensity: rung, loud, seed: `${seed}|${arc}|${s}|${q}|${salt}` }); text = String((w && typeof w === "object" ? w.text : w) ?? ""); mood = w && typeof w === "object" ? w.mood : undefined; } catch { text = ""; }
    return { text, ...(mood ? { mood } : {}), treat: roar && !reduced ? ROAR.treat : R.treat, level: R.level, scale: R.scale * G.k, ms: Math.round(R.ms * (roar ? ROAR.ms : 1)),
      colors: colors ?? [R.face], rung, top, stanza: s, pos: q, arc };
  };
  // (the words as lettered, by index: the engine asks for them in order from the run's first phrase on every seat - a late one replays
  // the run's past -, so the memo is the same everywhere; asked out of order, the plain word of the phrase before stands in)
  const said = new Map();
  return (i, ms = 0) => {
    const p = raw(i, ms);
    if ( i > 0 ) {
      // (never the word just lettered: another seed of the same rung and tier)
      const before = said.get(i - 1) ?? raw(i - 1, ms).text;
      for ( let salt = 1; salt <= 6 && p.text === before; salt++ ) { const r = raw(i, ms, salt); p.text = r.text; if ( r.mood ) p.mood = r.mood; }
    }
    said.set(i, p.text); if ( said.size > 64 ) said.delete(said.keys().next().value);
    p.scale = +Math.min(p.scale, fitScale(p.text.length, p.top)).toFixed(3);
    return p.text ? p : null;
  };
}
/** when phrase `i` begins (ms of the run's clock) for a constant heat: the score's own clock (tests, the designer) */
export function scoreClock(score, n, reducedK = 1) {
  const out = []; let t = 0;
  for ( let i = 0; i < n; i++ ) { const p = score(i, t); out.push({ i, t, ...p }); t += (p?.ms ?? 1000) * reducedK; }
  return out;
}

/* ---------------------------------------------------------------- a scored run's size on a seat */

/** the roar's cap height as a share of the reference view's height at the reference zoom (the table's size of a scored run) */
export const ROAR_REF = 0.064;
/** this seat's bounds for it: close in, the roar's caps no taller than ROAR_VH of the window; far out, no smaller than FAR_K of the
    window's legibility floor (the lower rungs are then floored at the floor itself - floorScale: the ladder flattens, it stays readable) */
export const ROAR_VH = 0.1, FAR_K = 1.6;
/** the zoom a seat's bounds are worked out at: this seat's, snapped to quarter octaves (a run is not re-seated at every wheel notch) */
export const snapZoom = (z) => 2 ** (Math.round(Math.log2(Math.max(1e-4, z)) * 4) / 4);
/** the roar's size (scene units) at the window's legibility floor */
export const minSize = ({ zoom = 1, capK = 1.27, floorPx = 23 } = {}) => floorPx / (snapZoom(zoom) * capK);
/** this seat's size for a scored run whose table size is `k`: the table's inside the seat's bounds */
export function seatSize(k, { zoom = 1, vh = 900, capK = 1.27, floorPx = 23 } = {}) {
  const z = snapZoom(zoom), lo = (FAR_K * floorPx) / (z * capK), hi = Math.max(lo, (ROAR_VH * vh) / (z * capK));
  return clamp(k, lo, hi);
}
/** the least size share a phrase is lettered at on a seat whose run has `size` (scene units, the seat's lettering scale in): its caps
    at the window's legibility floor - never over 1 (the roar stays the biggest) */
export const floorScale = (size, { zoom = 1, capK = 1.27, floorPx = 23 } = {}) => Math.min(1, floorPx / Math.max(1e-6, zoom * capK * size));

/** the layers that stand over the scene's lighting: a word there is not darkened by the scene, so it takes no glow - the glow was a
    soft orange box behind a fire's words that outlived their letters (ADVM r2 item 8) */
export const OVER_LIGHT = new Set(["overlay", "top"]);
export const glowFor = (layer, glow = "auto") => (OVER_LIGHT.has(layer) ? false : glow);

/** the second and third spot of one fire: further on in the arc (not in step with the first) and a rung under it - the first owns the roar */
export const SPOT_SHIFT = 5;
