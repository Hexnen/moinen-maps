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
  fullPerImpact: 2,      // photosafe: full-field frames per impact
  fullPerSec: 2,         // photosafe: full-field frames per rolling second on this client, counted in the SAME log as the words' flash frames
  windowMs: 1000,
  localArea: 0.2,        // the gentle variant is drawn inside a panel covering at most this share of the viewport
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
const RED = /^#(e|f)[0-9a-f][0-4][0-9a-f][0-4][0-9a-f]$/i;   // saturated reds: never a full field under the photosensitivity guard
export const isRed = (c) => RED.test(String(c ?? ""));

/* ---------- frame types ----------
   full  = the drawing changes most of the picture's brightness (a flash frame for the guard)
   cls   = what it does to the picture: "dark" | "light" | "inv" (the scene inverted) | "scene" (the scene stays, ink over it)
   safe  = the frame shown instead when a full frame is not allowed
   back  = what happens to the scene behind the ink: null | "bw" | "bwinv" | "chroma" | "split" (one side inverted)
   The ink of each type is drawn by draw.mjs (same names). */
export const FRAMES = {
  pop:     { full: false, cls: "scene", back: null,     pl: "Błysk-gwiazda w miejscu ciosu", en: "Burst star at the point of the blow" },
  splat:   { full: false, cls: "scene", back: null,     pl: "Rozbryzg tuszu", en: "Ink splash" },
  lines:   { full: false, cls: "scene", back: null,     pl: "Linie pędu / skupienia", en: "Speed / focus lines" },
  ink:     { full: false, cls: "scene", back: "bw",     pl: "Scena na czarno-biało, linie", en: "The scene in hard black and white, lines" },
  slam:    { full: true,  cls: "inv",   back: "bwinv",  safe: "ink",   pl: "Negatyw czarno-biały", en: "Inverted black-and-white slam" },
  shadow:  { full: true,  cls: "dark",  back: null,     safe: "pop",   pl: "Czarny kadr, jasna sylwetka", en: "Black frame, light silhouette" },
  glare:   { full: true,  cls: "light", back: null,     safe: "lines", pl: "Biały kadr, czarna sylwetka", en: "White frame, black silhouette" },
  swap:    { full: true,  cls: "light", back: null,     safe: "ink",   pl: "Kadr w kolorze, sylwetka w tuszu", en: "Colour frame, ink silhouette" },
  window:  { full: true,  cls: "dark",  back: "bwinv",  safe: "pop",   pl: "Czarny kadr z wyrwą na scenę", en: "Black frame with a torn window on the scene" },
  smear:   { full: false, cls: "scene", back: null,     pl: "Smuga sylwetki", en: "Smear of the silhouette" },
  tear:    { full: true,  cls: "inv",   back: "split",  safe: "rip",   pl: "Rozdarcie kadru", en: "The frame torn in two" },
  rip:     { full: false, cls: "scene", back: null,     pl: "Cięcie przez kadr", en: "A cut across the frame" },
  dots:    { full: false, cls: "scene", back: null,     pl: "Raster i gwiazda", en: "Halftone and star" },
  shatter: { full: false, cls: "scene", back: "bw",     pl: "Pęknięcia i odłamki", en: "Cracks and shards" },
  chroma:  { full: false, cls: "scene", back: "chroma", pl: "Rozszczepienie barw", en: "Chromatic split" },
  ring:    { full: false, cls: "scene", back: null,     pl: "Pierścień uderzenia", en: "Shock ring" },
  fade:    { full: false, cls: "scene", back: null,     pl: "Ślad (ostatnia klatka)", en: "Residue (last drawing)" }
};
export const FRAME_IDS = Object.keys(FRAMES);
/* which full frame is kept first when the guard allows fewer */
const KEEP = { slam: 5, shadow: 4, tear: 4, window: 3, swap: 2, glare: 1 };

/* ---------- kinds of impact: four strengths each (tier 0..3). A step = [type, ticks, flags]: s = hit-stop, p = frame punch ---------- */
const S = (type, ticks = 1, flags = "") => ({ type, ticks, stop: flags.includes("s"), punch: flags.includes("p") ? 1 : flags.includes("q") ? 0.5 : 0 });
export const KINDS = {
  hit: { tone: "hero", pl: "Cios", en: "Hit", tiers: [
    [S("pop", 1, "q"), S("splat")],
    [S("ink", 1, "p"), S("pop"), S("dots"), S("fade")],
    [S("shadow", 2, "s"), S("slam", 1, "p"), S("dots", 2), S("fade")],
    [S("lines"), S("shadow", 2, "s"), S("glare"), S("slam", 1, "p"), S("dots", 2), S("fade")] ] },
  heavy: { tone: "fire", pl: "Ciężki cios", en: "Heavy blow", tiers: [
    [S("pop", 1, "q"), S("splat"), S("fade")],
    [S("ink", 1, "p"), S("pop"), S("shatter"), S("fade")],
    [S("shadow", 2, "s"), S("slam", 1, "p"), S("shatter", 2), S("fade")],
    [S("lines"), S("shadow", 2, "s"), S("swap"), S("slam", 2, "p"), S("shatter", 2), S("ring"), S("fade")] ] },
  crit: { tone: "hero", pl: "Trafienie krytyczne", en: "Critical", tiers: [
    [S("ink", 1, "p"), S("pop"), S("dots"), S("fade")],
    [S("lines"), S("slam", 1, "p"), S("dots", 2), S("fade")],
    [S("lines"), S("shadow", 2, "s"), S("slam", 2, "p"), S("chroma"), S("dots", 2), S("fade")],
    [S("lines"), S("shadow", 2, "s"), S("swap"), S("slam", 2, "p"), S("chroma"), S("dots", 2), S("fade")] ] },
  blast: { tone: "fire", pl: "Wybuch", en: "Blast", tiers: [
    [S("pop", 1, "q"), S("ring"), S("fade")],
    [S("pop", 1, "p"), S("ring"), S("dots"), S("fade")],
    [S("glare"), S("slam", 1, "p"), S("shatter", 2), S("ring"), S("fade")],
    [S("window"), S("glare"), S("slam", 2, "p"), S("shatter", 2), S("ring"), S("chroma"), S("fade")] ] },
  slash: { tone: "blood", pl: "Cięcie", en: "Slash", tiers: [
    [S("smear"), S("splat")],
    [S("smear"), S("rip", 1, "q"), S("splat"), S("fade")],
    [S("smear"), S("tear", 2, "sp"), S("splat"), S("fade")],
    [S("lines"), S("shadow"), S("tear", 2, "sp"), S("chroma"), S("splat", 2), S("fade")] ] },
  landing: { tone: "dust", pl: "Lądowanie / uderzenie z góry", en: "Landing / strike from above", tiers: [
    [S("pop", 1, "q"), S("ring")],
    [S("lines"), S("pop", 1, "p"), S("ring"), S("fade")],
    [S("lines"), S("slam", 1, "p"), S("ring"), S("shatter", 2), S("fade")],
    [S("window"), S("slam", 2, "p"), S("shatter", 2), S("ring"), S("dots"), S("fade")] ] },
  ko: { tone: "blood", pl: "Powalenie", en: "Knock-out", tiers: [
    [S("ink", 1, "p"), S("pop"), S("splat"), S("fade")],
    [S("shadow", 2, "s"), S("slam", 1, "p"), S("splat", 2), S("fade")],
    [S("lines"), S("shadow", 3, "s"), S("slam", 2, "p"), S("chroma"), S("splat", 2), S("fade")],
    [S("lines"), S("shadow", 3, "s"), S("swap"), S("slam", 2, "p"), S("chroma"), S("splat", 2), S("fade")] ] },
  shock: { tone: "volt", pl: "Wyładowanie / energia", en: "Shock / energy", tiers: [
    [S("chroma"), S("pop")],
    [S("chroma"), S("ink", 1, "q"), S("ring"), S("fade")],
    [S("chroma"), S("slam", 1, "p"), S("chroma"), S("ring"), S("fade")],
    [S("lines"), S("glare"), S("slam", 2, "p"), S("chroma"), S("ring"), S("dots"), S("fade")] ] },
  word: { tone: "hero", pl: "Pod napisem", en: "Behind a word", tiers: [
    [S("lines"), S("fade")],
    [S("ink", 2, "q"), S("fade")],
    [S("slam", 2, "q"), S("dots"), S("fade")],
    [S("shadow"), S("slam", 2, "p"), S("dots", 2), S("fade")] ] }
};
export const KIND_IDS = Object.keys(KINDS);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/* strength 0..2 (0.5 = an ordinary blow, like the lettering's magnitude) -> tier 0..3 */
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

/* ---------- the plan ---------- */
/* spec = { kind, magnitude, seed, dir (degrees the blow travels: 0 right, 90 down; null = no direction), tone | colors: [a, b],
            frames: [type | { type, ticks, stop, punch }] (a caller's own sequence instead of the kind's), hitstop, punch }
   -> { kind, tier, magnitude, seed, dir (radians | null), tone: { a, b }, frames: [{ type, ticks, stop, punch, seed, full, cls, back }], ticks, ms } */
export function planImpact(spec = {}) {
  const kind = Object.hasOwn(KINDS, spec.kind) ? spec.kind : "hit";
  const magnitude = clamp(Number.isFinite(spec.magnitude) ? spec.magnitude : 0.5, 0, 2);
  const tier = tierOf(magnitude);
  const seed = spec.seed == null ? 1 : (typeof spec.seed === "number" ? spec.seed >>> 0 : hash(spec.seed));
  const R = rng(seed);
  const K = KINDS[kind];
  let steps;
  if ( Array.isArray(spec.frames) && spec.frames.length ) {
    steps = spec.frames.map((f) => (typeof f === "string" ? S(f) : { type: f?.type, ticks: f?.ticks ?? 1, stop: !!f?.stop, punch: f?.punch === true ? 1 : Number(f?.punch) || 0 }))
      .filter((f) => Object.hasOwn(FRAMES, f.type));
  } else steps = K.tiers[tier].map((s) => ({ ...s }));
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
    frames.push({ type: s.type, ticks, stop, punch, seed: R.seed(), full: def.full, cls: def.cls, back: def.back });
    total += ticks;
  }
  const t = Array.isArray(spec.colors) && spec.colors.length ? { a: String(spec.colors[0]), b: String(spec.colors[1] ?? spec.colors[0]) } : (TONES[spec.tone] ?? TONES[K.tone]);
  const dir = Number.isFinite(spec.dir) ? (spec.dir * Math.PI) / 180 : null;
  return { kind, tier, magnitude, seed, dir, tone: { a: t.a, b: t.b }, frames, ticks: total, ms: total * TICK, mode: "full" };
}

/* ---------- what this client may see ----------
   prefs = the engine's preferences (prefs.mjs: enabled, motion, flashes, photosafe) + impact ("full" | "local" | "off")
   env   = { osReduced, callerReduced, flashLog (the engine's shared log of flash times, ms), now, t0 }
   Modes: "off" (nothing), "static" (reduced motion: ONE small drawing, no movement), "local" (the gentle variant: no full-field
   frame, everything inside a panel of at most LIMITS.localArea of the viewport, no hit-stop), "full".
   The timing never changes (same ticks on every client); only what is drawn does. Returns the plan (changed in place). */
export function modeFor(prefs = {}, env = {}) {
  if ( prefs.enabled === false || prefs.impact === "off" ) return "off";
  const reduced = prefs.motion === "reduced" || env.callerReduced === true || (prefs.motion !== "full" && env.callerReduced == null && !!env.osReduced);
  if ( reduced ) return "static";
  if ( prefs.flashes === false || prefs.motion === "gentle" || prefs.impact === "local" ) return "local";
  return "full";
}
const toSafe = (f) => { const t = FRAMES[f.type].safe; if ( !t ) return; const d = FRAMES[t]; f.was = f.type; f.type = t; f.full = d.full; f.cls = d.cls; f.back = d.back; };
export function safety(plan, prefs = {}, env = {}) {
  const mode = modeFor(prefs, env);
  plan.mode = mode;
  if ( mode === "off" ) { plan.frames = []; plan.ticks = 0; plan.ms = 0; return plan; }
  if ( mode === "static" ) {
    /* one quiet drawing for the length of the impact (at most 4 ticks): no movement, no change of the scene */
    const ticks = Math.min(LIMITS.maxFrameTicks, Math.max(2, plan.ticks));
    plan.frames = [{ type: "pop", ticks, stop: false, punch: 0, seed: plan.frames[0]?.seed ?? plan.seed, full: false, cls: "scene", back: null }];
    plan.ticks = ticks; plan.ms = ticks * TICK;
    return plan;
  }
  const photosafe = prefs.photosafe !== false;
  if ( mode === "local" ) {
    for ( const f of plan.frames ) { if ( f.full ) toSafe(f); f.stop = false; if ( prefs.motion === "gentle" ) f.punch = 0; else f.punch *= 0.5; if ( f.back === "chroma" && prefs.motion === "gentle" ) f.back = null; }
    return plan;
  }
  if ( !photosafe ) return plan;
  /* the guard: full-field frames are rationed, per impact and per rolling second (shared with the words' flash frames) */
  const log = env.flashLog ?? [], now = env.now ?? 0, t0 = env.t0 ?? now;
  for ( let i = log.length - 1; i >= 0; i-- ) if ( log[i] < now - LIMITS.windowMs * 2 ) log.splice(i, 1);
  const full = [];
  let t = 0;
  for ( const f of plan.frames ) { if ( f.full ) full.push({ f, at: t0 + t * TICK }); t += f.ticks; }
  full.sort((x, y) => (KEEP[y.f.type] ?? 0) - (KEEP[x.f.type] ?? 0));
  let kept = 0;
  const mine = [];
  for ( const x of full ) {
    const near = log.filter((v) => Math.abs(v - x.at) < LIMITS.windowMs).length + mine.filter((v) => Math.abs(v - x.at) < LIMITS.windowMs).length;
    if ( kept >= LIMITS.fullPerImpact || near >= LIMITS.fullPerSec ) { toSafe(x.f); continue; }
    kept++; mine.push(x.at);
  }
  if ( !env.preview ) log.push(...mine);
  plan.guard = { kept, dropped: full.length - kept };
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
