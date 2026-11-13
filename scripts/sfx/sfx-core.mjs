/* LMAP: COMIC SOUND EFFECTS of the map's destruction and fire, the pure part (no Foundry, no PIXI: node-tested in
   dev/sfx-letters.test.mjs). sfx.mjs feeds it EVENTS (a damage area entering, a fire catching, spreading, flaring up, going out, an
   explosion, ground dust) and plays the WORDS it plans through the shared lettering engine (scripts/letters/, LETR contract v1).

   An EVENT: { key (stable, the same on every client), voice (words.mjs VOICES), x, y (scene px), r (scene px: how big the thing
               that makes the sound is), t (ms, when it sounds), m? (magnitude 0..1; else from r), obj? (a stroke id: the areas of one
               stroke always join), from? ({x, y}: where the sound comes from), colors? }
   A CLUSTER: events of one moment (JOIN_MS) close together (their reach plus a square and a half) - a big cave-in made of thirty
               areas, a bomb's burst + its shock dust + its crater - read as ONE sound: one MAIN word (the loudest voice, sized by
               everything together) and a few smaller SECONDARY words out at its edges (the comic page's satellites), staggered in
               time. A small anticipation word comes before a big cave-in's crash.
   PLACEMENT: words are laid out in world space but kept readable on this client's screen (a minimum and a maximum size in screen
               px), never over a token if they can move off it, never over another word; secondaries that do not fit are dropped
               (they are a deterministic list, so a client zoomed in shows a prefix of what a client zoomed out shows). */
import { VOICES, wordFor, tierOf } from "./words.mjs";

export const JOIN_MS = 500;          // events this close in time can join one cluster
export const SAME_OBJ_MS = 1500;     // ... the areas of one stroke join even when further apart in time
export const LEAD = { boom: 50, crash: 0, zap: 0, thud: 30, gun: 80, fire: 60, splash: 120, arcane: 40, slash: 40, crack: 0, rumble: 0, decay: 60, hiss: 0, drag: 0, engine: 0, whump: 0, roar: 0, crackle: 0 };
/** the per-perf-mode caps: secondary words per cluster, words of this module alive at once */
export const CAPS = { high: { sec: 4, alive: 9 }, medium: { sec: 2, alive: 6 }, low: { sec: 0, alive: 3 } };
/** screen-size limits (px) and the share of the view's short side a word may take */
export const SCREEN = { minMain: 26, minSec: 18, maxMain: 0.2, maxSec: 0.11 };

/** FNV-1a of a string -> uint32 (the same everywhere). */
export function hashStr(s, h = 2166136261) { s = String(s); for ( let i = 0; i < s.length; i++ ) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
const h01 = (s) => hashStr(s) / 4294967296;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** How big a sound is (0..1) from the size of what makes it, in grid squares (radius): ~0.25 sq -> 0.13, 1 sq -> 0.39, 5 sq -> 1. */
export const VOICE_GAIN = { crack: 0.85, crackle: 0.5, hiss: 0.85, decay: 0.85, whump: 0.8, drag: 0.85, engine: 0.85, gun: 0.9, boom: 1.1, crash: 1.05 };
export function magnitude(rGrid, voice = "boom") {
  const m = Math.log1p(Math.max(0, rGrid)) / Math.log1p(5);
  return clamp(m * (VOICE_GAIN[voice] ?? 1), 0.05, 1);
}

/* ---------------------------------------------------------------- what a damage area sounds like */

export const DESTR_TYPES = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];
export const DESTR_CAUSES = ["none", "fire", "acid", "lightning", "arcane", "impact", "claws", "water", "decay", "frost"];
const TYPE_VOICE = { blast: "boom", collapse: "crash", scorch: "fire", flood: "splash", cracks: "crack", gash: "slash" };
/** palettes (light -> dark) for causes whose look has its own colour; null: the engine's palette for the mood */
export const CAUSE_COLORS = {
  frost: ["#f2fdff", "#8fd6ff", "#2f6ea6"], acid: ["#f6ffb8", "#a7e030", "#3c7412"], arcane: ["#f7e6ff", "#c27cff", "#5b2aa0"],
  decay: ["#ece2b4", "#9c8b48", "#4b3d1c"], lightning: ["#ffffff", "#a8e8ff", "#3a58c8"], water: ["#effcff", "#62c4f0", "#1d5c96"]
};
/** The voice of an entering damage area: its type, coloured by its cause; a gun's pocks rattle. */
export function destrVoice(type, cause = 0, gun = false) {
  if ( gun ) return "gun";
  const c = typeof cause === "number" ? DESTR_CAUSES[cause] ?? "none" : cause;
  switch ( c ) {
    case "lightning": return "zap";
    case "acid": return "hiss";
    case "arcane": return "arcane";
    case "water": return "splash";
    case "decay": return "decay";
    case "claws": return "slash";
    case "frost": return type === "blast" || type === "collapse" ? TYPE_VOICE[type] : "crack";
    case "impact": return type === "blast" ? "thud" : TYPE_VOICE[type] ?? "thud";
    case "fire": return type === "blast" ? "boom" : "fire";
    default: return TYPE_VOICE[type] ?? "crack";
  }
}
export const causeColors = (cause) => CAUSE_COLORS[typeof cause === "number" ? DESTR_CAUSES[cause] : cause] ?? null;

/* ---------------------------------------------------------------- what fire sounds like */

/** A fire's own colour as a lettering palette (light, the colour, dark); null for the natural fire (the engine's fire palette). */
export function fireColors(c) {
  if ( typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c) ) return null;
  const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const hex = (k, to) => "#" + [r, g, b].map((v) => Math.round(v + (to - v) * k).toString(16).padStart(2, "0")).join("");
  return [hex(0.65, 255), c.toLowerCase(), hex(0.55, 0)];
}
/** Magnitude of a fire stroke's sound: its level (1 smouldering .. 3 a blaze) and its width. */
export const fireM = (lv = 2, rGrid = 1) => clamp(0.12 + 0.26 * (lv - 1) + 0.18 * Math.log1p(rGrid), 0.1, 1);
/** Magnitude of an explosion: its level (1 grenade, 2 shell, 3 bomb) and its fireball's radius. */
export const burstM = (lv = 2, rGrid = 1) => clamp(0.3 + 0.2 * (lv - 1) + 0.12 * Math.log1p(rGrid), 0.2, 1);
export const DUST_VOICE = { shock: "whump", hits: "thud", heavy: "rumble", drag: "drag", car: "engine", bike: "engine" };

/** Points along a flat path [x0, y0, x1, y1 ...] at fractions `fs` of its length: [{x, y, f}]. */
export function alongPath(p, fs) {
  const pts = []; for ( let i = 0; i + 1 < p.length; i += 2 ) pts.push([p[i], p[i + 1]]);
  if ( !pts.length ) return [];
  const cum = [0]; for ( let i = 1; i < pts.length; i++ ) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum.at(-1);
  return fs.map((f) => {
    if ( !(L > 0) ) return { x: pts[0][0], y: pts[0][1], f };
    const d = f * L; let i = 1; while ( i < cum.length - 1 && cum[i] < d ) i++;
    const s = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
    return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * s, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * s, f };
  });
}
export const pathLength = (p) => { let L = 0; for ( let i = 2; i + 1 < p.length; i += 2 ) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; };
export function pathCentre(p) {
  let x = 0, y = 0, n = 0; for ( let i = 0; i + 1 < p.length; i += 2 ) { x += p[i]; y += p[i + 1]; n++; }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

/**
 * The SOUND EVENTS of one fire-layer stroke (fire / smoke / dust / burst / erase) between `from` and `to` (shared-clock ms), given
 * its state before (`prev`: the stroke as last seen, or null when new) - pure, the same on every client.
 *   fire: catches (its path start, at its lit time), spreads (a few crackles along a long path as the fire reaches them), flares up (a
 *         raised level, at the ramp's start), goes out (a hiss at its middle, at `o`);
 *   burst: the explosion at q; dust: a shock wave's whump, a heavy thing's rumble, a drag's scrape, an engine, hits;
 *   erase: a hiss where it puts out burning fire (`burning(stroke)` tells; the caller knows the other strokes).
 * `ctx` = { grid (scene px), catchMs(st) (how long the fire takes to run its path), late (ms an event may be late and still play:
 * a stroke seen for the first time plays its catch up to NEW_LATE late), burning(st) }.
 */
export const NEW_LATE = 6000;
export const SPREAD_GAP = 700;
export function strokeEvents(st, prev, from, to, ctx) {
  const out = [], grid = ctx.grid || 100, late = ctx.late ?? 1500;
  const inWin = (t, lateMs = late) => t >= from - lateMs && t < to;
  const k = st.k, p = st.p ?? [], rG = (st.r ?? 50) / grid;
  const push = (e) => out.push({ obj: st.id, ...e });
  if ( k === "burst" ) {
    if ( prev || st.o !== undefined ) return out;
    if ( inWin(st.q, ctx.newLate ?? NEW_LATE) ) push({ key: `${st.id}|burst`, voice: "boom", x: p[0], y: p[1], r: st.r ?? 100, t: st.q, m: burstM(st.lv ?? 2, rG), colors: fireColors(st.c) });
    return out;
  }
  if ( k === "dust" ) {
    if ( prev || st.o !== undefined ) return out;
    const v = DUST_VOICE[st.dk] ?? "rumble", at = st.dk === "shock" || p.length < 4 ? { x: p[0], y: p[1] } : alongPath(p, [0.5])[0];
    const len = pathLength(p) / grid;
    if ( inWin(st.q, ctx.newLate ?? NEW_LATE) ) push({ key: `${st.id}|dust`, voice: v, x: at.x, y: at.y, r: (st.r ?? 50) * (st.dk === "shock" ? 1 : 1 + 0.15 * len), t: st.q,
      m: clamp(0.15 + 0.2 * (st.lv ?? 2) + 0.06 * len, 0.1, st.dk === "shock" ? 0.8 : 0.75), from: p.length >= 4 ? { x: p[0], y: p[1] } : null });
    return out;
  }
  if ( k === "erase" ) {
    if ( prev || st.o !== undefined || !ctx.burning?.(st) ) return out;
    if ( inWin(st.g ?? st.q) ) push({ key: `${st.id}|douse`, voice: "hiss", x: p[0], y: p[1], r: st.r ?? 50, t: Math.max(st.g ?? st.q, from), m: clamp(0.2 + 0.25 * Math.log1p(rG), 0.15, 0.7) });
    return out;
  }
  if ( k !== "fire" ) return out;                 // (smoke makes no sound of its own)
  const lit = st.g ?? st.q, lv = st.lv ?? 2, m = fireM(lv, rG), colors = fireColors(st.c);
  const relit = !prev || (prev.g ?? prev.q) !== lit;
  if ( relit ) {
    // the catch: played late too when the stroke is new here (it reached this client after its painter released it)
    if ( inWin(lit, prev ? late : ctx.newLate ?? NEW_LATE) ) push({ key: `${st.id}|catch|${lit}`, voice: "fire", x: p[0], y: p[1], r: st.r ?? 50, t: Math.max(lit, from), m, colors });
    // the spread: a crackle every ~3 squares of a long path (at most 3), when the fire reaches it
    // (crackles closer than SPREAD_GAP ms in time are one: a fire racing along its path in a moment letters its catch alone)
    const L = pathLength(p), T = ctx.catchMs?.(st) ?? 0, n = Math.min(3, Math.floor(L / (grid * 3)), Math.floor(T / SPREAD_GAP));
    if ( n > 0 ) {
      for ( const q of alongPath(p, Array.from({ length: n }, (_, i) => (i + 1) / (n + 0.4))) ) {
        const t = lit + q.f * T;
        if ( inWin(t) ) push({ key: `${st.id}|spread|${lit}|${q.f.toFixed(2)}`, voice: q.f > 0.9 && lv >= 2.5 ? "roar" : "crackle", x: q.x, y: q.y, r: (st.r ?? 50) * 0.6, t, m: m * 0.7, colors, from: { x: p[0], y: p[1] } });
      }
    }
  }
  // a level raised: the fire flares up (at the ramp's start)
  if ( prev && st.lt !== undefined && st.lt !== prev.lt && (st.lv ?? 2) > (st.l0 ?? prev.lv ?? 2) + 0.2 && inWin(st.lt) ) {
    const c = pathCentre(p);
    push({ key: `${st.id}|flare|${st.lt}`, voice: (st.lv ?? 2) >= 2.5 ? "roar" : "fire", x: c.x, y: c.y, r: st.r ?? 50, t: st.lt, m: fireM(st.lv, rG), colors });
  }
  // put out (or a preset's fire whose out time comes): a hiss at its middle
  if ( st.o !== undefined && (!prev || prev.o !== st.o) && inWin(st.o) ) {
    const c = pathCentre(p), L = pathLength(p) / grid;
    push({ key: `${st.id}|out|${st.o}`, voice: "hiss", x: c.x, y: c.y, r: (st.r ?? 50) * (1 + 0.25 * L), t: Math.max(st.o, from), m: clamp(0.18 + 0.15 * lv + 0.05 * L, 0.15, 0.8) });
  }
  return out;
}

/**
 * The AMBIENT crackle of burning fires: one slot every `every` ms of the shared clock; in each slot one of the burning fires (a hash
 * of the slot picks it, the same everywhere; fires of level >= 1.5, lit at least `settle` ms before) crackles at a point of its path.
 * -> event or null.
 */
export function ambientEvent(slot, fires, { every = 6000, settle = 5000, grid = 100 } = {}) {
  const t = slot * every + Math.floor(h01(`amb|${slot}`) * every * 0.8);
  const list = fires.filter((s) => s.k === "fire" && (s.lv ?? 2) >= 1.5 && (s.o === undefined || s.o > t) && t - (s.g ?? s.q) >= settle).sort((a, b) => (a.id < b.id ? -1 : 1));
  if ( !list.length ) return null;
  const st = list[hashStr(`amb|${slot}|pick`) % list.length], p = st.p ?? [];
  const at = alongPath(p, [h01(`amb|${slot}|at`)])[0] ?? { x: p[0], y: p[1] };
  return { key: `amb|${slot}`, obj: st.id, voice: (st.lv ?? 2) >= 2.6 && h01(`amb|${slot}|roar`) < 0.35 ? "roar" : "crackle", x: at.x, y: at.y, r: (st.r ?? 50) * 0.5, t,
    m: fireM(st.lv ?? 2, (st.r ?? 50) / grid) * 0.55, colors: fireColors(st.c), ambient: true };
}

/* ---------------------------------------------------------------- clusters */

/** Events -> clusters { members (loudest first), main, x, y (centre), rEq (combined size), span (reach from the centre), t }. */
export function cluster(events, grid = 100) {
  const ev = events.slice().sort((a, b) => ((VOICES[b.voice]?.prio ?? 0) - (VOICES[a.voice]?.prio ?? 0)) || (b.r - a.r) || (a.key < b.key ? -1 : 1));
  const groups = [];
  for ( const e of ev ) {
    let best = null;
    for ( const g of groups ) {
      const dt = Math.abs(e.t - g.t);
      if ( e.obj && g.objs.has(e.obj) && dt <= SAME_OBJ_MS ) { best = g; break; }
      if ( dt > JOIN_MS || e.ambient || g.ambient ) continue;
      const d = Math.hypot(e.x - g.x, e.y - g.y);
      if ( d <= g.span + e.r + grid * 1.5 ) { best = g; break; }
    }
    if ( !best ) { groups.push({ members: [e], main: e, objs: new Set(e.obj ? [e.obj] : []), x: e.x, y: e.y, w: e.r * e.r, rEq: e.r, span: e.r, t: e.t, ambient: !!e.ambient }); continue; }
    best.members.push(e); if ( e.obj ) best.objs.add(e.obj);
    const w = e.r * e.r, W = best.w + w;
    best.x = (best.x * best.w + e.x * w) / W; best.y = (best.y * best.w + e.y * w) / W; best.w = W;
    best.rEq = Math.sqrt(W);
    best.span = Math.max(...best.members.map((q) => Math.hypot(q.x - best.x, q.y - best.y) + q.r));
  }
  return groups;
}

/**
 * The WORDS of a cluster (before placement): [{ role: "pre" | "main" | "sec", text, voice, mood, sound, x, y, size (scene px), t,
 * seed, from, rotation, colors, hold, maxWidth }]. `o` = { lang, grid, sec (max secondaries), seed (scene id), big (only main words
 * of medium or bigger sounds: the "big" setting) }.
 */
export function planCluster(g, o = {}) {
  const grid = o.grid || 100, lang = o.lang ?? "en", main = g.main, V = VOICES[main.voice] ?? VOICES.crack;
  const single = g.members.length === 1;
  const m = single && main.m !== undefined ? main.m : Math.max(main.m ?? 0, magnitude(g.rEq / grid, main.voice));
  if ( o.big && (m < 0.34 || g.ambient) ) return [];
  const seed = `${o.seed ?? ""}|${main.key}`, h = hashStr(seed), taken = new Set();
  const words = [];
  const loud = clamp(0.25 + 0.75 * m, 0, 1);
  const size = grid * (0.26 + 0.62 * m);
  const centre = single ? { x: main.x, y: main.y } : { x: g.x, y: g.y };
  // a big cave-in: the ground cracks first (its anticipation), then it comes down
  if ( main.voice === "crash" && m >= 0.55 && !o.big ) {
    const text = wordFor("crack", 0.2, hashStr(seed + "|pre"), lang, taken); taken.add(text);
    words.push(word("pre", text, "crack", 0.3, { x: centre.x, y: centre.y - size * 0.15 }, size * 0.42, main.t - 200, seed + "|pre", null, h01(seed + "|pr") * 16 - 8, main.colors, o));
  }
  const text = wordFor(main.voice, m, h, lang, taken); taken.add(text);
  words.push(word("main", text, main.voice, loud, centre, size, main.t + (LEAD[main.voice] ?? 0) + (words.length ? 60 : 0), seed, main.from ?? null,
    (h01(seed + "|rot") - 0.5) * 10, main.colors, o, { long: V.sound.long + (main.ambient ? 0 : 0.25 * m), maxWidth: Math.max(g.span * 2.2, size * 4.5) }));
  // a gun's rounds rattle along their walk (a LETR stream, one syllable a round) instead of one word
  if ( main.voice === "gun" && main.walk?.length > 1 ) words.at(-1).stream = { walk: main.walk, t0: main.t0 ?? main.t };
  if ( o.big || !(o.sec > 0) || single ) return words;
  // secondaries: the biggest other members out at the edge, each its own voice, quieter, staggered
  const nSec = Math.min(o.sec, g.members.length - 1, Math.round(m * 3.4));
  const cand = g.members.filter((e) => e !== main && Math.hypot(e.x - centre.x, e.y - centre.y) > size * 0.6)
    .sort((a, b) => (b.r - a.r) || (a.key < b.key ? -1 : 1));
  const used = [];
  for ( const e of cand ) {
    if ( used.length >= nSec ) break;
    // (two secondaries close together are one sound)
    if ( used.some((u) => Math.hypot(u.x - e.x, u.y - e.y) < size * 0.9) ) continue;
    used.push(e);
  }
  used.forEach((e, i) => {
    // (one size down from the main word: a satellite never competes with it, and its word is a shorter one of its voice)
    const m2 = Math.min(m * 0.55, Math.max(e.m ?? 0, magnitude(e.r / grid, e.voice)));
    const dx = e.x - centre.x, dy = e.y - centre.y, d = Math.hypot(dx, dy) || 1;
    const at = { x: e.x + (dx / d) * e.r * 0.3, y: e.y + (dy / d) * e.r * 0.3 };
    const s2 = Math.min(size * 0.58, grid * (0.26 + 0.5 * m2));
    const sd = `${o.seed ?? ""}|${e.key}`;
    const tx = wordFor(e.voice, m2, hashStr(sd), lang, taken); taken.add(tx);
    words.push(word("sec", tx, e.voice, clamp(0.2 + 0.7 * m2, 0, 0.9), at, s2, Math.max(e.t, main.t) + (LEAD[e.voice] ?? 0) + 140 + i * 130, sd, centre,
      Math.sign(dx || 1) * (5 + 9 * h01(sd + "|rot")), e.colors, o));
  });
  return words;
}

function word(role, text, voice, loud, at, size, t, seed, from, rotation, colors, o, extra = {}) {
  const V = VOICES[voice] ?? VOICES.crack;
  const lines = text.split("\n"), longest = Math.max(...lines.map((l) => l.length));
  // the motion fits the sound: the voice's own; a small crash is a thud (slams in), a long hiss or roar keeps its slow grow
  const motion = { ...(V.motion ?? {}) };
  if ( voice === "crash" && loud < 0.45 ) motion.in = "slam";
  if ( role === "pre" ) Object.assign(motion, { in: "crackIn", hold: "shake", out: "shatter" });
  return { role, text, voice, mood: V.mood, motion, sound: { ...V.sound, loud, ...(extra.long !== undefined ? { long: clamp(extra.long, 0, 1) } : {}) },
    x: at.x, y: at.y, size, t, seed, from: from ?? null, rotation, colors: colors ?? null, lines: lines.length, chars: longest,
    maxWidth: extra.maxWidth ?? null, hold: voice === "roar" || voice === "rumble" ? 1500 : undefined };
}

/* ---------------------------------------------------------------- placement on this client's screen */

/** The engine's loudness scale of the nominal size (contract: about 0.6x for a tick to 1.3x for a boom). */
export const loudScale = (loud) => 0.6 + 0.7 * clamp(loud, 0, 1);
/** A word's box (scene px) centred at (x, y): the size it will be drawn at, a letter about 0.62 of the cap height wide. */
export function boxOf(w, x = w.x, y = w.y) {
  // the engine's own layout when it was asked (sfx.mjs measure: L.design -> width in cap heights, its loudness scale, its warp);
  // else an estimate (letters with their outline and extrusion ~0.8 of the cap height wide). + the outline / extrusion / shake room
  const s = w.size * (w.sizeK ?? loudScale(w.sound.loud));
  const tall = w.warp && /arc|fan|tumble|stair|wave|swell|zig|bulge/.test(w.warp) ? 1.85 : 1.55;
  let W = w.wUnits ? s * (w.wUnits + 0.7) : s * 0.8 * w.chars + s * 0.5, H = s * tall * w.lines;
  if ( w.maxWidth && W > w.maxWidth ) { const k = w.maxWidth / W; W *= k; H *= k; }
  return { x0: x - W / 2, y0: y - H / 2, x1: x + W / 2, y1: y + H / 2 };
}
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inter = (a, b) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
/** where a word may move to get off a token or another word (box widths / heights): up first (screen-up reads as the sound rising) */
const OFFSETS = [[0, 0], [0, -0.75], [0.55, -0.6], [-0.55, -0.6], [0.7, 0], [-0.7, 0], [0, 0.75], [0, -1.3]];

/**
 * Sizes kept readable on this screen and positions kept off tokens and other words. `ctx` = { scale (screen px per scene px),
 * view ({x0, y0, x1, y1} scene px), tokens ([box]), alive ([box]: words already up) }. -> the words to play, with x, y, size and
 * box final; secondaries / pre-words that cannot find a free place are dropped, the main word always plays (the least covering
 * place), unless it is entirely off this screen.
 */
export function place(words, ctx) {
  const sc = ctx.scale || 1, v = ctx.view, short = v ? Math.min(v.x1 - v.x0, v.y1 - v.y0) : Infinity;
  const taken = [...(ctx.alive ?? [])], out = [];
  const order = words.slice().sort((a, b) => (a.role === "main" ? -1 : b.role === "main" ? 1 : 0));
  for ( const w0 of order ) {
    const w = { ...w0 }, main = w.role === "main";
    // readable: at least minMain / minSec screen px tall, at most a share of the view
    const ls = w.sizeK ?? loudScale(w.sound.loud), px = w.size * ls * sc;
    const min = main ? SCREEN.minMain : SCREEN.minSec, max = (main ? SCREEN.maxMain : SCREEN.maxSec) * short * sc;
    if ( px < min ) w.size = min / (ls * sc);
    if ( w.size * ls * sc > max ) w.size = max / (ls * sc);
    if ( w.maxWidth && v ) w.maxWidth = Math.min(w.maxWidth, (v.x1 - v.x0) * 0.7);
    let best = null;
    const b0 = boxOf(w), bw = b0.x1 - b0.x0, bh = b0.y1 - b0.y0;
    const cands = OFFSETS.map(([ox, oy]) => [w.x + ox * bw, w.y + oy * bh]);
    // just clear of a token it would cover: above it first, then beside it, then below
    for ( const t of ctx.tokens ?? [] ) if ( inter(b0, t) > 0 ) cands.push([w.x, t.y0 - bh / 2 - 6], [t.x1 + bw / 2 + 6, w.y], [t.x0 - bw / 2 - 6, w.y], [w.x, t.y1 + bh / 2 + 6]);
    for ( const [x, y] of cands ) {
      const ox = (x - w.x) / bw, oy = (y - w.y) / bh, b = boxOf(w, x, y), A = area(b) || 1;
      const tok = (ctx.tokens ?? []).reduce((s, t) => s + inter(b, t), 0) / A;
      const wrd = taken.reduce((s, t) => s + inter(b, t), 0) / A;
      const off = v ? 1 - inter(b, v) / A : 0;
      const pen = tok * 4 + wrd * 3 + off * 1.5 + Math.hypot(ox, oy) * 0.25;
      if ( !best || pen < best.pen ) best = { x, y, b, pen, tok, wrd, off };
      if ( tok === 0 && wrd === 0 && off < 0.05 ) break;
    }
    // (entirely off this screen: nobody here sees it - a main word off screen takes its cluster with it)
    if ( v && inter(boxOf(w), v) === 0 ) { if ( main ) return []; continue; }
    if ( !main && (best.tok > 0 || best.wrd > 0.03 || best.off > 0.3) ) continue;
    // (kept inside the view where it fits: a word half off the screen edge is not read)
    if ( v ) {
      const m = 0.02 * short, b = best.b, dx = b.x0 < v.x0 + m ? v.x0 + m - b.x0 : b.x1 > v.x1 - m ? v.x1 - m - b.x1 : 0, dy = b.y0 < v.y0 + m ? v.y0 + m - b.y0 : b.y1 > v.y1 - m ? v.y1 - m - b.y1 : 0;
      if ( (dx || dy) && b.x1 - b.x0 < v.x1 - v.x0 - 2 * m && b.y1 - b.y0 < v.y1 - v.y0 - 2 * m ) {
        const nb = boxOf(w, best.x + dx, best.y + dy), A = area(nb) || 1;
        const tok = (ctx.tokens ?? []).reduce((s2, t) => s2 + inter(nb, t), 0) / A, wrd = taken.reduce((s2, t) => s2 + inter(nb, t), 0) / A;
        if ( tok <= best.tok && wrd <= Math.max(best.wrd, 0.03) ) Object.assign(best, { x: best.x + dx, y: best.y + dy, b: nb, off: 0 });
      }
    }
    if ( !main && best.off > 0.15 ) continue;
    w.x = best.x; w.y = best.y; w.box = best.b;
    taken.push(best.b); out.push(w);
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * An ECHO: a cluster that comes a moment after another one of the same family (a bomb's fireball, then its crater's entry a few
 * hundred ms later; a collapse whose areas reach the screen in two bakes) inside its reach is part of that sound: not a second main
 * word. `recent` = [{ x, y, reach, t, prio }] of main words played lately. -> true when `g` is such an echo.
 */
export const ECHO_MS = 1600;
export function isEcho(g, recent, grid = 100) {
  const p = VOICES[g.main.voice]?.prio ?? 0;
  return recent.some((r) => g.t - r.t >= -50 && g.t - r.t < ECHO_MS && r.prio >= p && Math.hypot(g.x - r.x, g.y - r.y) < r.reach + g.span * 0.5 + grid);
}

export { tierOf };
