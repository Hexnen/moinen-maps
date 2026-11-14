/* LETR impact frames, the pure part: what an impact IS (a few drawings on the engine's 24-tick clock), how one is chosen from the
   kind of blow, its strength and a seed, and what this client is allowed to see of it (photosensitivity, reduced motion).
   No DOM, no Foundry: the same call with the same seed gives the same plan on every client; only `safety()` differs per client. */
import { rng, hash } from "../rng.mjs";

export const TICK = 1000 / 24;
export const INK = "#0b0b10", PAPER = "#fffdf2";

/* ---------- the limits (stated in impact/README.md "Safety") ---------- */
export const LIMITS = {
  maxTicks: 12,          // an impact never lasts longer than this (500 ms), whatever a caller lists
  maxFrameTicks: 4,      // one drawing stays at most this long
  maxStopTicks: 4,       // hit-stop (the scene held still) per impact, in ticks (167 ms)
  fullPerImpact: 2,      // photosafe: FLASH drawings per impact (full-field frames AND drawings that change the scene's brightness)
  fullPerSec: 2,         // photosafe: flash drawings per rolling second on this client, counted in the SAME log as the words' flash frames
  windowMs: 1000,
  localArea: 0.2,        // the gentle variant (and a local change of the scene) stays inside a panel of at most this share of the viewport
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
  void:  { a: "#b04cff", b: "#19c3ff" },
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
  fade:    { full: false, cls: "scene", back: null,     pl: "Ślad (ostatnia klatka)", en: "Residue (last drawing)" },
  rest:    { full: false, cls: "scene", back: null,     pl: "Pauza (nic)", en: "A beat of nothing" }
};
export const FRAME_IDS = Object.keys(FRAMES);
/* a drawing the guard counts: a full-field frame, or any drawing that changes the scene's brightness behind it (even in a panel) */
export const isFlash = (f) => !!f && (!!f.full || f.back === "bw" || f.back === "bwinv" || f.back === "split");
/* which flash drawing is kept first when the guard allows fewer (and which drawing is an impact's peak) */
const KEEP = { slam: 6, shadow: 5, tear: 5, window: 4, swap: 3, glare: 2, ink: 1.5, shatter: 1 };
const PEAK = { ...KEEP, pop: 0.8, chroma: 0.6, dots: 0.5, splat: 0.5, smear: 0.5, rip: 0.5, ring: 0.4, lines: 0.1, fade: 0, rest: -1 };

/* ---------- kinds of impact: SIX strengths each (step 0..5, stepOf). A step = [type, ticks, flags]: s = hit-stop, p = frame punch,
   q = half a punch. The ladder the owner asked for (a scratch, a solid hit, a heavy hit, a knock-down, a critical must each look
   different and escalate): steps 0-1 never change the scene and keep the struck figure in sight (a small star at its rim), step 2
   turns a panel round it hard black and white, steps 3-5 are the full-field frames, longer and more of them as the blow grows. ---------- */
const S = (type, ticks = 1, flags = "") => ({ type, ticks, stop: flags.includes("s"), punch: flags.includes("p") ? 1 : flags.includes("q") ? 0.5 : 0 });
export const KINDS = {
  hit: { tone: "hero", pl: "Cios", en: "Hit", steps: [
    [S("pop", 1, "q"), S("fade")],
    [S("pop", 1, "q"), S("splat"), S("fade")],
    [S("ink", 1, "p"), S("pop"), S("dots"), S("fade")],
    [S("shadow", 2, "s"), S("slam", 1, "p"), S("dots", 2), S("fade")],
    [S("lines"), S("shadow", 2, "s"), S("glare"), S("slam", 1, "p"), S("dots", 2), S("fade")],
    [S("lines"), S("shadow", 2, "s"), S("glare"), S("slam", 2, "p"), S("dots", 2), S("ring"), S("fade")] ] },
  heavy: { tone: "fire", pl: "Ciężki cios", en: "Heavy blow", steps: [
    [S("pop", 1, "q"), S("splat"), S("fade")],
    [S("pop", 1, "p"), S("splat"), S("ring"), S("fade")],
    [S("ink", 1, "p"), S("pop"), S("shatter"), S("fade")],
    [S("shadow", 2, "s"), S("slam", 1, "p"), S("shatter", 2), S("ring"), S("fade")],
    [S("lines"), S("shadow", 2, "s"), S("swap"), S("slam", 2, "p"), S("shatter", 2), S("ring"), S("fade")],
    [S("lines"), S("shadow", 2, "s"), S("swap"), S("slam", 2, "p"), S("shatter", 2), S("ring", 2), S("fade")] ] },
  crit: { tone: "hero", pl: "Trafienie krytyczne", en: "Critical", steps: [
    [S("ink", 1, "p"), S("pop"), S("dots"), S("fade")],
    [S("lines"), S("ink", 1, "p"), S("pop"), S("dots"), S("fade")],
    [S("lines"), S("slam", 1, "p"), S("dots", 2), S("fade")],
    [S("lines"), S("shadow", 2, "s"), S("slam", 2, "p"), S("chroma"), S("dots", 2), S("fade")],
    [S("lines"), S("shadow", 2, "s"), S("swap"), S("slam", 2, "p"), S("chroma"), S("dots", 2), S("fade")],
    [S("lines"), S("window"), S("shadow", 2, "s"), S("swap"), S("slam", 2, "p"), S("chroma"), S("dots", 2), S("fade")] ] },
  blast: { tone: "fire", pl: "Wybuch", en: "Blast", steps: [
    [S("pop", 1, "q"), S("ring"), S("fade")],
    [S("pop", 1, "p"), S("ring"), S("dots"), S("fade")],
    [S("ink", 1, "p"), S("ring"), S("shatter"), S("fade")],
    [S("glare"), S("slam", 1, "p"), S("shatter", 2), S("ring"), S("fade")],
    [S("window"), S("glare"), S("slam", 2, "p"), S("shatter", 2), S("ring"), S("chroma"), S("fade")],
    [S("window"), S("glare"), S("slam", 2, "p"), S("shatter", 2), S("ring", 2), S("chroma"), S("fade")] ] },
  slash: { tone: "blood", pl: "Cięcie", en: "Slash", steps: [
    [S("smear"), S("splat")],
    [S("smear"), S("rip", 1, "q"), S("splat"), S("fade")],
    [S("smear"), S("rip", 1, "p"), S("splat", 2), S("fade")],
    [S("smear"), S("tear", 2, "sp"), S("splat"), S("fade")],
    [S("lines"), S("shadow"), S("tear", 2, "sp"), S("chroma"), S("splat", 2), S("fade")],
    [S("lines"), S("shadow", 2, "s"), S("tear", 2, "p"), S("chroma"), S("splat", 2), S("fade")] ] },
  landing: { tone: "dust", pl: "Lądowanie / uderzenie z góry", en: "Landing / strike from above", steps: [
    [S("pop", 1, "q"), S("ring")],
    [S("lines"), S("pop", 1, "p"), S("ring"), S("fade")],
    [S("lines"), S("ink", 1, "p"), S("ring"), S("shatter"), S("fade")],
    [S("lines"), S("slam", 1, "p"), S("ring"), S("shatter", 2), S("fade")],
    [S("window"), S("slam", 2, "p"), S("shatter", 2), S("ring"), S("dots"), S("fade")],
    [S("lines"), S("window"), S("slam", 2, "p"), S("shatter", 2), S("ring", 2), S("dots"), S("fade")] ] },
  ko: { tone: "blood", pl: "Powalenie", en: "Knock-out", steps: [
    [S("ink", 1, "p"), S("pop"), S("splat"), S("fade")],
    [S("ink", 1, "p"), S("pop"), S("splat", 2), S("fade")],
    [S("lines"), S("ink", 1, "p"), S("pop"), S("splat", 2), S("fade")],
    [S("shadow", 3, "s"), S("slam", 1, "p"), S("splat", 2), S("fade")],
    [S("lines"), S("shadow", 3, "s"), S("slam", 2, "p"), S("chroma"), S("splat", 2), S("fade")],
    [S("lines"), S("shadow", 3, "s"), S("swap"), S("slam", 2, "p"), S("chroma"), S("splat", 2), S("fade")] ] },
  shock: { tone: "volt", pl: "Wyładowanie / energia", en: "Shock / energy", steps: [
    [S("chroma"), S("pop")],
    [S("chroma"), S("pop", 1, "q"), S("ring"), S("fade")],
    [S("chroma"), S("ink", 1, "q"), S("ring"), S("fade")],
    [S("chroma"), S("slam", 1, "p"), S("chroma"), S("ring"), S("fade")],
    [S("lines"), S("glare"), S("slam", 2, "p"), S("chroma"), S("ring"), S("dots"), S("fade")],
    [S("lines"), S("glare"), S("slam", 2, "p"), S("chroma", 2), S("ring"), S("dots"), S("fade")] ] },
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
/* the old four tiers (plan.tier, for callers that read it) */
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
    steps = spec.frames.map((f) => (typeof f === "string" ? S(f) : { type: f?.type, ticks: f?.ticks ?? 1, stop: !!f?.stop, punch: f?.punch === true ? 1 : Number(f?.punch) || 0 }))
      .filter((f) => Object.hasOwn(FRAMES, f.type));
  } else steps = K.steps[step].map((s) => ({ ...s }));
  if ( !steps.length ) steps = [S("pop")];
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
    frames.push({ type: s.type, ticks, stop, punch, seed: R.seed(), full: def.full, cls: def.cls, back: def.back, local: !!def.local });
    total += ticks;
  }
  const t = Array.isArray(spec.colors) && spec.colors.length ? { a: String(spec.colors[0]), b: String(spec.colors[1] ?? spec.colors[0]) } : (TONES[spec.tone] ?? TONES[K.tone]);
  const dir = Number.isFinite(spec.dir) ? (spec.dir * Math.PI) / 180 : null;
  const plan = { kind, tier, step, magnitude, seed, dir, tone: { a: t.a, b: t.b }, frames, ticks: total, ms: total * TICK, mode: "full" };
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
    plan.frames = [];
    if ( lead > 0 ) plan.frames.push({ type: "rest", ticks: lead, stop: false, punch: 0, seed, full: false, cls: "scene", back: null, local: false });
    plan.frames.push({ type: "pop", ticks, stop: false, punch: 0, seed, full: false, cls: "scene", back: null, local: false, still: true });
    plan.ticks = lead + ticks; plan.ms = plan.ticks * TICK;
    return plan;
  }
  const photosafe = prefs.photosafe !== false;
  if ( mode === "local" ) {
    const gentle = prefs.motion === "gentle";
    for ( const f of plan.frames ) { if ( f.full ) toSafe(f); f.stop = false; if ( gentle ) f.punch = 0; else f.punch *= 0.5; if ( f.back === "chroma" && gentle ) f.back = null; }
  }
  if ( !photosafe ) return plan;
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
  plan.guard = { kept, dropped: flash.length - kept };
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
  const k = clamp(f.punch, 0, 1.5) / 1.5 * (0.45 + 0.55 * plan.magnitude / 2) * (tickInFrame === 0 ? 1 : tickInFrame === 1 ? -0.45 : 0.2);
  const amp = LIMITS.punchMax * k;
  const a = plan.dir ?? ((f.seed % 360) * Math.PI) / 180;
  return { x: Math.cos(a) * amp, y: Math.sin(a) * amp, s: 1 + Math.abs(amp) * 2.4 };
}
/* the gentle variant's panel: the radius (px) of a disc of LIMITS.localArea of the viewport */
export const localRadius = (W, H) => Math.sqrt((LIMITS.localArea * W * H) / Math.PI);
