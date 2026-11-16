/* MAPBURN: the SCORE of a burning fire (pure: no Foundry, no PIXI, no DOM; node-tested in dev/sfx-burnscore.test.mjs).
   MAPBURN2 (2026-11-16): the score is no longer lettered as an unbroken run - a fire speaks it in LINES, an area of the map at most
   one a turn, the word beside its flames, clearly smaller: see "MAPBURN2" below and dev/sfx-burn.test.mjs.
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
  1: { scale: 0.7, ms: 1000, level: 0.22, treat: "split", face: "#ffc530" },     // embers ticking: amber
  2: { scale: 0.76, ms: 1100, level: 0.34, treat: "breath", face: "#ffd83a" },   // a flame's puff: yellow
  3: { scale: 0.84, ms: 1200, level: 0.5, treat: "split", face: "#ffe566" },     // crackling: the crack lands on its beat
  4: { scale: 0.92, ms: 1350, level: 0.68, treat: "stretch", face: "#fff0a0" },  // a blaze's gust: swells
  5: { scale: 1, ms: 1500, level: 0.86, treat: "stretch", face: "#fff9dc" }      // an inferno's roar: white-hot
};
/** how the stanzas of an arc grow: size, and the word's tier (the vocabulary's loudness: short -> long words, the last with "!") */
export const GROW = [{ k: 0.9, loud: 0.15 }, { k: 0.95, loud: 0.5 }, { k: 1, loud: 0.9 }];
/** the arc's last peak is slammed in (the engine's accent: slam + shake) and stands longer */
export const ROAR = { treat: "accent", ms: 1.2 };
/** the biggest size share a fire of this top rung letters (its roar): what its room is laid out for */
export const topScale = (top) => RUNGS[peakOf(ARC - 1, top)].scale;
/** the run's width: no phrase wider than WIDE of the run's sizes x its top share (a long word is lettered smaller, never squeezed by
    the engine: a letter of the fire words is at most about CHAR of its size wide - measured on the engine, League Gothic: the ladder's
    longest words, 14-17 letters, draw 9.4-10.1 sizes of ink) */
export const WIDE = 10.5, CHAR = 0.72;
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
  // (never the word just lettered: asked again with another seed of the same rung and tier. MAPBURN2: worked out from the phrase
  // alone - back to the start of its arc at most - and not from what this seat lettered before: a fire speaks in lines now, and a
  // seat that joins late has lettered none of the lines before this one, yet must letter the same word)
  const memo = new Map();
  // (an arc's first phrase looks back at the arc before it once - `deep` -, no further: a seat asking for line 10 000 works it out in
  // two arcs at most, and every seat asking for the same line gets the same word)
  const resolve = (i, ms, deep = 0) => {
    const p = raw(i, ms), first = (i + sp * SPOT_SHIFT) % (STANZA * ARC) === 0, key = `${i}|${p.top}|${deep}`;
    if ( memo.has(key) ) return { ...p, ...memo.get(key) };
    if ( i > 0 && !(first && deep) ) {
      const before = resolve(i - 1, ms, first ? 1 : deep).text;
      for ( let salt = 1; salt <= 6 && p.text === before; salt++ ) { const r = raw(i, ms, salt); p.text = r.text; if ( r.mood ) p.mood = r.mood; }
    }
    memo.set(key, { text: p.text, ...(p.mood ? { mood: p.mood } : {}) }); if ( memo.size > 128 ) memo.delete(memo.keys().next().value);
    return p;
  };
  return (i, ms = 0) => {
    const p = resolve(Math.max(0, i | 0), ms);
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

/** the roar's cap height as a share of the reference view's height at the reference zoom (the table's size of a fire's words).
    MAPBURN2: 2.8 % (25 px at a 900 px view) - it was 6.4 %; the lower rungs are shares of it, floored at the window's legibility
    floor (23 px): a fire's words are captions beside the flames, its heat told by the word, its colour and its motion */
export const ROAR_REF = 0.028;
/** this seat's bounds for it: close in, the roar's caps no taller than ROAR_VH of the window; far out, no smaller than FAR_K of the
    window's legibility floor (the lower rungs are then floored at the floor itself - floorScale: the ladder flattens, it stays readable) */
export const ROAR_VH = 0.045, FAR_K = 1.1;
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

/* ---------------------------------------------------------------- MAPBURN2: a fire speaks in LINES, bounded per area, beside its flames
   The owner on the fire lettering as the table saw it (2026-11-16): too often and too big, the words must not hide the fire much (a
   little is fine), and their amount should be bounded per area. MAPBURN told a fire as an unbroken run (a phrase every 0.9-1.5 s,
   two up at once, on the flames, for every spot of every fire). Now:
     - a fire is not lettered without a break: it speaks a LINE - one word of its score - and is silent until its next turn;
     - the map is cut into AREAS (squares one reference view height a side, fixed to the scene: the same on every seat). Time runs
       in SLOTS on the shared clock; the areas are coloured four ways (a 2 x 2 pattern) and a slot belongs to one colour, so two
       areas that touch never speak in the same slot: any window the size of an area sees at most one line begin per slot, a whole
       reference view (it touches at most 3 x 2 areas) at most two. An area speaks at most once a TURN (four slots), whatever burns
       in it: a fire that spreads through an area does not fill it with words, a fire that spreads into the next area gets that
       area's turns too;
     - how often an area takes its turn is its heat (a blaze every turn, a fire two turns in three, a smoulder every other turn);
       which of its (at most CELL_VOICES) voices speaks goes round; the line's word is the next of the score (the ladder climbed
       line by line: the story is told slower, not dropped);
     - the word stands at the RIM of its fire, on the side its sparks go (downwind; still air: up), as near as it can with at most
       COVER.fire of the fire's area under it: the flames stay the picture.
   All of it from shared data (the fires, the shared clock, the scene's grid): every seat letters the same line at the same instant. */

const hash32 = (s) => { let h = 2166136261; for ( let i = 0; i < s.length; i++ ) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const h01 = (s) => hash32(String(s)) / 4294967296;
const mod = (a, n) => ((a % n) + n) % n;

/** a slot (ms), the colours a turn goes through, how long before its instant a line is handed to the engine, and the share of a line's
    standing time after which a seat that comes late no longer letters it (it would only show its exit) */
export const LINE = { slot: 1800, colours: 4, lead: 150, join: 0.5 };
export const TURN_MS = LINE.slot * LINE.colours;
/** which turns an area takes, by the hottest fire in it (1 = speaks): a blaze every turn, a fire two in three, a smoulder every other */
export const SPEAK = { smoulder: [1, 0], fire: [1, 1, 0], blaze: [1] };
/** an area's side in reference view heights (scene px: AREA_VH x the reference window's height / the reference zoom) */
export const AREA_VH = 1;
/** the voices (lettered spots) an area keeps: the table's first ones there; more fire in the area is heard in them */
export const CELL_VOICES = 2;
export const cellOf = (q, cell) => ({ cx: Math.floor(q.x / cell), cy: Math.floor(q.y / cell) });
/** (side by side two slots apart, one above the other one slot: a wide view does not hear its two halves one straight after the other) */
export const colourOf = (cx, cy) => 2 * mod(cx, 2) + mod(cy, 2);
/** the slot at `now` (shared ms): its number, its turn, the colour it belongs to, its start */
export const slotAt = (now) => { const slot = Math.floor(now / LINE.slot); return { slot, turn: Math.floor(slot / LINE.colours), colour: mod(slot, LINE.colours), t0: slot * LINE.slot }; };
/** the table's voices `[{ key, i, x, y, level }]` (in the table's order: the biggest fire first) by area -> Map id -> { id, cx, cy, colour, voices } */
export function areasOf(voices, cell) {
  const out = new Map();
  for ( const v of voices ) {
    const { cx, cy } = cellOf(v, cell), id = `${cx},${cy}`;
    let a = out.get(id); if ( !a ) out.set(id, (a = { id, cx, cy, colour: colourOf(cx, cy), voices: [] }));
    if ( a.voices.length < CELL_VOICES ) a.voices.push(v);
  }
  return out;
}
/** how many lines an area of heat class `heat` (a SPEAK id) has spoken before `turn` (counted from turn 0 of the shared clock), and
    whether it speaks in `turn` */
export function ordinal(areaId, heat, turn) {
  const pat = SPEAK[heat] ?? SPEAK.fire, n = turn + (hash32(`area|${areaId}`) % 12), len = pat.length, r = mod(n, len);
  return { n: Math.floor(n / len) * pat.reduce((a, b) => a + b, 0) + pat.slice(0, r).reduce((a, b) => a + b, 0), speaks: !!pat[r] };
}
/** the turn a shared instant falls in */
export const turnOf = (t) => Math.floor(t / TURN_MS);
/** the line an area speaks in `turn` (null: it is silent this turn) -> { area, voice, heat (its class), index (the area's line number
    on the shared clock), turn, t0 (shared ms) }; `lineNo` gives the line's number in its fire's own story */
export function lineOf(area, turn) {
  if ( !area?.voices?.length ) return null;
  const top = area.voices.reduce((m, v) => Math.max(m, heatOf(v.level).top), 0), heat = (HEAT.find((h) => h.top === top) ?? HEAT[0]).id;
  const o = ordinal(area.id, heat, turn);
  if ( !o.speaks ) return null;
  // (the area's second voice has every third line)
  const which = area.voices.length > 1 && o.n % 3 === 1 ? 1 : 0;
  return { area: area.id, voice: area.voices[which], heat, index: o.n, turn, t0: (turn * LINE.colours + area.colour) * LINE.slot };
}
/** which phrase of its score a line is for a fire burning since `start` (shared ms): the lines its area has had since then - a fire
    begins on its embers and climbs from there, on every seat alike (a seat that joins late counts the same turns) */
export const lineNo = (line, start) => Math.max(0, line.index - ordinal(line.area, line.heat, Number.isFinite(start) ? Math.max(0, turnOf(start)) : line.turn).n);
/** every line that begins in [from, to) (shared ms), in time order */
export function linesIn(areas, from, to) {
  const out = [], t0 = Math.floor(from / TURN_MS) - 1, t1 = Math.floor(to / TURN_MS);
  for ( const a of areas.values() ) for ( let t = t0; t <= t1; t++ ) { const l = lineOf(a, t); if ( l && l.t0 >= from && l.t0 < to ) out.push(l); }
  return out.sort((a, b) => a.t0 - b.t0 || (a.area < b.area ? -1 : 1));
}

/* ---- the rim */
/** how much of a fire may stand under its word (share of the fire's area), and how much of the word's box may stand on flames */
export const COVER = { fire: 0.15, word: 0.35 };
const seg2 = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); const qx = ax + t * dx - px, qy = ay + t * dy - py; return qx * qx + qy * qy; };
/** fire strokes ({ p: [x, y, ...], r }) readied for point tests: -> { list, box, on(x, y), area (scene px2) } */
export function fireShape(strokes) {
  const list = (strokes ?? []).filter((s) => (s?.p?.length ?? 0) >= 2).map((s) => {
    const p = s.p, r = s.r ?? 50; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for ( let i = 0; i + 1 < p.length; i += 2 ) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
    return { p, r, r2: r * r, x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
  });
  const box = list.reduce((b, s) => ({ x0: Math.min(b.x0, s.x0), y0: Math.min(b.y0, s.y0), x1: Math.max(b.x1, s.x1), y1: Math.max(b.y1, s.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const on = (x, y) => {
    for ( const s of list ) {
      if ( x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1 ) continue;
      const p = s.p;
      if ( p.length < 4 ) { if ( seg2(x, y, p[0], p[1], p[0], p[1]) <= s.r2 ) return true; continue; }
      for ( let i = 0; i + 3 < p.length; i += 2 ) if ( seg2(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= s.r2 ) return true;
    }
    return false;
  };
  // (the fire's area: counted on a grid of at most 40 x 40 over its box)
  let area = 0;
  if ( list.length ) {
    const w = box.x1 - box.x0, h = box.y1 - box.y0, st = Math.max(Math.min(...list.map((s) => s.r)) / 2, Math.max(w, h) / 40, 1);
    let c = 0; for ( let y = box.y0 + st / 2; y < box.y1; y += st ) for ( let x = box.x0 + st / 2; x < box.x1; x += st ) if ( on(x, y) ) c++;
    area = c * st * st;
  }
  return { list, box, on, area };
}
/** what a word's box (centre c, half sizes hw / hh) covers: `word` the share of the box on flames, `fire` the share of the fire under it */
export function coverOf(c, hw, hh, shape, nx = 9, ny = 3) {
  let n = 0;
  for ( let j = 0; j < ny; j++ ) for ( let i = 0; i < nx; i++ ) if ( shape.on(c.x - hw + ((i + 0.5) * 2 * hw) / nx, c.y - hh + ((j + 0.5) * 2 * hh) / ny) ) n++;
  const word = n / (nx * ny);
  return { word, fire: shape.area > 0 ? Math.min(1, (word * 4 * hw * hh) / shape.area) : 0 };
}
/** the sides a word tries, from the side the fire's sparks go (`dir`, degrees, screen: -90 = up) */
const SIDES = [0, -35, 35, -70, 70, -110, 110, 180];
/**
 * Where a fire's word stands: from its spot `q` out along a side until at most COVER.fire of the fire and COVER.word of the word's box
 * are under each other; the nearest such place, an earlier side (nearer the sparks' way) preferred by `hh` a step.
 * -> { x, y, d, deg, word, fire, clean } (pure: the same on every seat)
 */
export function rimSpot(q, shape, { hw, hh, dir = -90, cover = COVER } = {}) {
  if ( !shape?.list?.length ) return { x: q.x, y: q.y, d: 0, deg: dir, word: 0, fire: 0, clean: true };
  const step = Math.max(1, hh * 0.5), dMax = Math.hypot(shape.box.x1 - shape.box.x0, shape.box.y1 - shape.box.y0) + 2 * (hw + hh);
  let best = null, least = null;
  SIDES.forEach((off, rank) => {
    const a = ((dir + off) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
    for ( let d = 0; d <= dMax; d += step ) {
      if ( best && d + rank * hh * 0.6 >= best.cost ) break;
      const c = { x: q.x + ux * d, y: q.y + uy * d }, m = coverOf(c, hw, hh, shape);
      if ( !least || m.fire < least.fire ) least = { ...c, d, deg: dir + off, ...m, clean: false };
      if ( m.fire <= cover.fire && m.word <= cover.word ) { best = { ...c, d, deg: dir + off, ...m, clean: true, cost: d + rank * hh * 0.6 }; break; }
    }
  });
  const r = { ...(best ?? least) }; delete r.cost;
  return r;
}

/* ---- the call */
/** the block a line keeps clear on a seat, as a share of the run block of the same size (sfx-seat RUN: 15.2 x 9.1 sizes): the whole of
    it - a word's entrance, its lean and (stepped motion) its drawn exit reach 12-17 sizes across, dev/sfx-burnscore.test.mjs LINE
    holds its ink inside; the block is smaller than a run's was because the fire's size is */
export const BLOCK = 1;
/** the half sizes of a line's word (in sizes of the fire's biggest word) the rim is found with: a usual word (five or six letters) and its caps with their rim */
export const WORD_BOX = { hw: 3, hh: 0.9 };
/**
 * The engine call of one line: `ph` a phrase of the score (burnScore), `size` the run's size on this seat (scene units), `at` its
 * place, `startAt` its instant on this page's clock. -> { text, opts } for L.play: one word, sized exactly, in the kind's own motion
 * (embers tick in syllable by syllable, the roar is slammed in), never pulled into view, never pushed.
 */
export function lineCall(ph, { kind = "fire", seed = "", size, at, startAt, reduced = false, glow = false, extra = {} } = {}) {
  const lv = clamp(Number.isFinite(ph.level) ? ph.level : 0.5, 0, 1), mag = 0.12 + 0.7 * lv;
  const rot = (hash32(`${seed}|side`) % 2 ? 1 : -1) * (1 + 4 * h01(`${seed}|deg`));
  const o = { space: "world", fit: "world", kind, size, scale: ph.scale, colors: ph.colors, seed, at, rotation: +rot.toFixed(2), hold: ph.ms, magnitude: +mag.toFixed(3),
    keepInView: false, pushable: false, glow, reduced, ...(ph.mood ? { mood: ph.mood } : {}), ...(Number.isFinite(startAt) ? { startAt } : {}), ...extra };
  const treat = reduced && ph.treat !== "stretch" ? "breath" : ph.treat;
  if ( treat === "stretch" ) { o.magnitude = +(mag * 1.1).toFixed(3); o.tempo = 0.9; }
  else if ( treat === "split" ) { o.parts = "syllables"; o.beat = Math.round(130 + 120 * (1 - lv)); }
  else if ( treat === "accent" ) { o.magnitude = +(mag * 1.45).toFixed(3); o.in = "slam"; o.holdKind = "shake"; o.out = hash32(`${seed}|out`) % 2 ? "burst" : "pop"; }
  return { text: ph.text, opts: o };
}
