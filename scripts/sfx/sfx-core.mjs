/* LMAP / FXLM: COMIC SOUND EFFECTS of the map's destruction and fire, the pure part (no Foundry, no PIXI, no DOM: node-tested in
   dev/sfx-letters.test.mjs and dev/sfx-fxlm.test.mjs). sfx.mjs feeds it EVENTS (a damage area entering, a fire catching, flaring up,
   going out, an explosion, ground dust, an eraser dousing fire) and plays the WORD SPECS it plans through the shared lettering
   engine (scripts/letters/, LETR): the engine's own vocabulary (WORD: `L.word(kind, { loud, duration, seed })`) writes the text, its
   look follows the sound (LOOK), its motion the staging asked here (MOVE). This file holds NO words: only which sound KIND an event
   makes, how loud and how long it is, when, where on this client's screen, and how it is staged.

   Why a caller-side table stays (VOICES below): the engine knows sound kinds, not map events. Which kind a collapse, a scorch or an
   acid gash makes, how big it reads against the other sounds of the map (the size hierarchy), and how it is staged against the
   destruction (a cave-in drops onto its rubble, a bomb's word blows the words around it aside) is the map's knowledge. Kinds are
   listed in preference order and resolved against the engine's own kind list at play time, so the vocabulary may grow or rename.

   An EVENT: { key (stable, the same on every client), sid? (the seed id when the key carries this client's own time), voice (VOICES),
               x, y (scene px), r (scene px: how big the thing that makes the sound is), box? ({x0,y0,x1,y1} scene px: what it
               letters, kept visible), t (ms, when it sounds), tPre? (ms: when its anticipation starts, before t), m? (0..1 loudness;
               else from r), ms? (how long the sound lasts), obj? (a stroke id: the areas of one stroke join; a fire's word is checked
               against its stroke when it plays), gate? (a fire stroke id: the word waits until its flames are on screen),
               from? ({x, y}), colors?, path? ([{x, y, ms}]: a sound that travels: a car, a drag; a gun's walk) }
   A CLUSTER: events of one moment (JOIN_MS) close together read as ONE sound: one MAIN word (the loudest voice) and a few smaller
               SATELLITES at its edges, staggered; a big cave-in cracks first (its PRE word, at the anticipation's start).
   PLACEMENT: beside what it letters (never on it if it can sit at its edge), off tokens, off this client's interface panels
               (sidebar, bars, the module's and other modules' panels: their screen rectangles), off other words, inside the view. */

export const JOIN_MS = 500;          // events this close in time can join one cluster
export const SAME_OBJ_MS = 1500;     // ... the areas of one stroke join even when further apart in time
export const GATHER_MS = 70;         // events of one moment are gathered this long (a Detonate's entries come a slice a frame)
/** per perf mode: satellites per cluster, words of this module alive at once, live (non-ambient) fire sounds at once */
export const CAPS = { high: { sec: 4, alive: 12, live: 3 }, medium: { sec: 2, alive: 8, live: 2 }, low: { sec: 0, alive: 4, live: 1 } };
/** a word's moment this far gone (ms past the end of its own sound) is not played any more (its event is over) */
export const LATE_MS = 700;
/** the share of the engine's size ceiling (its `ceilK`) a map word may use: the main word of the biggest cave-in stays under about
    two fifths of the screen width so the destruction it letters and the panels around it stay readable; pre words and satellites
    under a quarter (they are parts of the sound) */
export const CEIL_K = { main: 0.6, pre: 0.38, sec: 0.38 };
/** a fire word waiting for its flames to show waits at most this long (a client whose fire never draws: no word) */
export const GATE_MAX_MS = 6000;

/** FNV-1a of a string -> uint32 (the same everywhere). */
export function hashStr(s, h = 2166136261) { s = String(s); for ( let i = 0; i < s.length; i++ ) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
export const h01 = (s) => hashStr(s) / 4294967296;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sidOf = (e) => e.sid ?? e.key;

/* ---------------------------------------------------------------- voices: what each event sounds like and how it is staged */

/**
 * VOICES: kinds (engine sound kinds, first known wins), prio (a cluster's main word is its loudest voice), w (its weight in the size
 * hierarchy of the map: the engine magnitude is loudness x w; a building coming down and a bomb are the biggest sounds, a hiss of
 * steam the smallest), ms (natural length of the sound), area (share of the event's radius given to the engine's size model), stage
 * (motion asked of the engine on top of the word's own: entrance / hold / exit, frame rate `on`, push, glow; the rest is WORD's
 * per-kind motion), cover (how much a word may cover its own subject: 0 never, 1 does not care).
 */
export const VOICES = {
  boom:    { kinds: ["boom"], prio: 10, w: 1.3, ms: 900, area: 1, cover: 0.35, stage: { in: "slam", out: "burst", push: true, glow: "auto" } },
  thunder: { kinds: ["thunder", "zap"], prio: 9, w: 1.15, ms: 900, area: 1, cover: 0.3, stage: { in: "crackIn", out: "burst", glow: "auto" } },
  crash:   { kinds: ["crash"], prio: 9, w: 1.2, ms: 1500, area: 1, cover: 0.15, stage: { in: "drop", holdKind: "rattle", out: "shards", push: true, on: 3 } },
  zap:     { kinds: ["zap"], prio: 8, w: 0.85, ms: 350, area: 0.8, cover: 0.3, stage: { glow: "auto" } },
  thud:    { kinds: ["thud", "punch"], prio: 7, w: 0.8, ms: 150, area: 0.8, cover: 0.2, stage: { in: "slam" } },
  gun:     { kinds: ["gunfire"], prio: 7, w: 0.75, ms: 600, area: 0.6, cover: 0.3, stream: true },
  // (a gun fired by a token on the map: its REPORT at the muzzle, and where its rounds land the IMPACT, by what they hit)
  muzzle:  { kinds: ["gunshot", "gunfire"], prio: 7, w: 0.7, ms: 600, area: 0.5, cover: 0.3, stream: true },
  gunhit:  { kinds: ["ricochet", "thud"], prio: 7, w: 0.65, ms: 600, area: 0.5, cover: 0.3, stream: true },
  fire:    { kinds: ["fire"], prio: 6, w: 0.8, ms: 1600, area: 0.8, cover: 0.25, stage: { in: "rise", glow: "auto" } },
  flare:   { kinds: ["fire"], prio: 6, w: 0.95, ms: 1300, area: 0.9, cover: 0.25, stage: { in: "grow", glow: "auto" } },
  scorch:  { kinds: ["fire", "crackle"], prio: 6, w: 0.7, ms: 700, area: 0.8, cover: 0.2, stage: { in: "rise", glow: "auto" } },
  splash:  { kinds: ["splash"], prio: 6, w: 0.75, ms: 700, area: 0.8, cover: 0.2, stage: {} },
  arcane:  { kinds: ["powerup", "psychic"], prio: 6, w: 0.75, ms: 1100, area: 0.8, cover: 0.3, stage: { glow: "auto" } },
  slash:   { kinds: ["slash"], prio: 5, w: 0.7, ms: 300, area: 0.7, cover: 0.15, stage: { in: "zip", out: "shards" } },
  crack:   { kinds: ["crack"], prio: 4, w: 0.6, ms: 200, area: 0.6, cover: 0.1, stage: { in: "crackIn", out: "shards" } },
  rumble:  { kinds: ["rumble"], prio: 4, w: 0.8, ms: 2200, area: 0.8, cover: 0.3, stage: { holdKind: "rattle", on: 3 } },
  decay:   { kinds: ["crumble"], prio: 3, w: 0.6, ms: 1300, area: 0.7, cover: 0.2, stage: { out: "fall", on: 3 } },
  acid:    { kinds: ["hiss", "fizzle"], prio: 3, w: 0.55, ms: 1300, area: 0.6, cover: 0.2, stage: { holdKind: "boil", out: "dissolve" } },
  douse:   { kinds: ["hiss"], prio: 3, w: 0.45, ms: 1100, area: 0.45, cover: 0.3, stage: { in: "pop", holdKind: "boil", out: "dissolve" }, drift: true },
  out:     { kinds: ["fizzle", "hiss"], prio: 3, w: 0.4, ms: 3500, area: 0.4, cover: 0.4, stage: { in: "pop", holdKind: "boil", out: "dissolve", on: 3 }, drift: true },
  scrape:  { kinds: ["scrape"], prio: 3, w: 0.7, ms: 1500, area: 0.7, cover: 1, stage: { holdKind: "rattle" }, ride: true },
  engine:  { kinds: ["engine"], prio: 3, w: 0.75, ms: 1500, area: 0.7, cover: 1, stage: { holdKind: "rattle" }, ride: true },
  whump:   { kinds: ["whump"], prio: 2, w: 0.85, ms: 600, area: 0.7, cover: 0.4, stage: { in: "grow", push: { force: 1.2 } } },
  debris:  { kinds: ["crumble", "rumble"], prio: 1, w: 0.55, ms: 800, area: 0.5, cover: 0.25, stage: { in: "pop", out: "fall" } },
  creak:   { kinds: ["creak", "crack"], prio: 0, w: 0.5, ms: 250, area: 0.5, cover: 0.1, stage: { in: "crackIn", holdKind: "shake", out: "shards", on: 1 } }
};
/** The sound kind of a voice: the first of its kinds the engine knows (`known`: a Set / array of the engine's kind ids, or null). */
export function kindOf(voice, known = null, mat = null) {
  const V = VOICES[voice] ?? VOICES.crack, has = known ? (known instanceof Set ? (k) => known.has(k) : (k) => known.includes(k)) : () => true;
  return MAT_KINDS[mat]?.[voice]?.find(has) ?? V.kinds.find(has) ?? V.kinds[0];
}
/** The destruction layer's ground / thing materials (destruction/model.mjs MATERIALS; an area's info.mat is the index minus one). */
export const MATS = ["auto", "grass", "earth", "stone", "wood", "sand", "snow", "water", "metal"];
export const matOf = (i) => MATS[(Number.isInteger(i) ? i : -1) + 1] ?? "auto";
/** What breaks, or what the rounds hit, changes the sound (these kinds first, then the voice's own): metal clangs, water splashes,
    wood snaps, a round whines off stone (ricochet) and is swallowed by soft ground (thud). A building's crash and a bomb's boom stay. */
export const MAT_KINDS = {
  metal: { crack: ["clang", "crack"], thud: ["clang", "thud"], debris: ["clang", "crumble"], slash: ["clang", "slash"], gunhit: ["clang", "ricochet"] },
  stone: { gunhit: ["ricochet", "crack"] },
  wood: { debris: ["crack", "crumble"], crack: ["crack", "creak"], gunhit: ["crack", "thud"] },
  water: { crack: ["splash"], thud: ["splash"], debris: ["splash"], gunhit: ["splash"], whump: ["splash", "whump"] },
  snow: { debris: ["thud", "crumble"], gunhit: ["thud"] },
  earth: { gunhit: ["thud"] },
  grass: { gunhit: ["thud"] },
  sand: { debris: ["crumble", "thud"], gunhit: ["thud"] }
};

/** How big a sound is (0..1) from the size of what makes it, in grid squares (radius): ~0.25 sq -> 0.13, 1 sq -> 0.39, 5 sq -> 1. */
export function magnitude(rGrid) { return clamp(Math.log1p(Math.max(0, rGrid)) / Math.log1p(5), 0.05, 1); }
/**
 * The engine's magnitude (LETR v4: 0..2) of a word: its loudness times its voice's weight in the map's hierarchy. A bomb or a building
 * coming down ~1.4-1.6, a crack ~0.4, a fire going out ~0.25 whatever the fire's size (the hiss is quiet; its LENGTH is the fire's).
 */
export const engineMag = (loud, voice) => Math.round(clamp((0.12 + 1.1 * clamp(loud, 0, 1)) * (VOICES[voice]?.w ?? 0.7), 0.06, 2) * 100) / 100;
/** The engine's `area` (scene px radius) of a word: the subject's radius, shrunk for quiet voices (a hiss over a big fire is small). */
export const engineArea = (r, voice, grid = 100) => Math.max(grid * 0.15, Math.min(r * (VOICES[voice]?.area ?? 0.7), grid * 4 * (VOICES[voice]?.area ?? 0.7)));

/* ---------------------------------------------------------------- what a damage area sounds like */

export const DESTR_TYPES = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];
export const DESTR_CAUSES = ["none", "fire", "acid", "lightning", "arcane", "impact", "claws", "water", "decay", "frost"];
const TYPE_VOICE = { blast: "boom", collapse: "crash", scorch: "scorch", flood: "splash", cracks: "crack", gash: "slash" };
/** how long each damage type's entry sounds (ms at the destruction's speed 1) */
export const TYPE_MS = { blast: 900, collapse: 1500, scorch: 700, flood: 1200, cracks: 220, gash: 320 };
/** palettes (light -> dark) only where the cause IS the colour of the sound (acid, arcane, frost); else the engine's look (LOOK) */
export const CAUSE_COLORS = {
  frost: ["#f2fdff", "#8fd6ff", "#2f6ea6"], acid: ["#f6ffb8", "#a7e030", "#3c7412"], arcane: ["#f7e6ff", "#c27cff", "#5b2aa0"]
};
/** The voice of an entering damage area: its type, coloured by its cause; a gun's pocks rattle. */
export function destrVoice(type, cause = 0, gun = false) {
  if ( gun ) return "gun";
  const c = typeof cause === "number" ? DESTR_CAUSES[cause] ?? "none" : cause;
  switch ( c ) {
    case "lightning": return type === "blast" || type === "collapse" ? "thunder" : "zap";
    case "acid": return "acid";
    case "arcane": return "arcane";
    case "water": return "splash";
    case "decay": return type === "collapse" ? "crash" : "decay";
    case "claws": return "slash";
    case "frost": return type === "blast" || type === "collapse" ? TYPE_VOICE[type] : "crack";
    case "impact": return type === "blast" ? "thud" : TYPE_VOICE[type] ?? "thud";
    case "fire": return type === "blast" ? "boom" : "scorch";
    default: return TYPE_VOICE[type] ?? "crack";
  }
}
export const causeColors = (cause) => CAUSE_COLORS[typeof cause === "number" ? DESTR_CAUSES[cause] : cause] ?? null;

/**
 * The EVENT of a damage area entering (display.enter): `I` its info (type, cause, rect, w, h, ex, ey), `o` the stroke origin, `ap`
 * art px, `start` the entry's start (this client's clock), `speed` the destruction's speed, `gun` (its walk when the area is a gun's
 * pocks: [{x, y, ms}]), `key`/`sid`. A cave-in's crash lands after its anticipation (collapse-entry.mjs ~230 ms): `tPre` = the
 * anticipation's start (the pre word plays there), `t` = the crash.
 */
export const COLLAPSE_LEAD = 230;
/** A directional stroke's ride: the entry clock's path front (`pf` = entry-clock.mjs pathTimes: pts in art px, tt ms) -> [{ x, y, ms }]
    scene px, ms after the entry's start (`delay` = the clock's own lead before the front sets off); at most 24 points. */
export function rideOf(pf, o, ap = 1, delay = 0) {
  const n = pf?.pts?.length ?? 0; if ( n < 2 ) return null;
  const step = Math.max(1, Math.ceil(n / 24)), out = [];
  for ( let i = 0; i < n; i += step ) out.push({ x: o.x + pf.pts[i][0] * ap, y: o.y + pf.pts[i][1] * ap, ms: Math.round(delay + pf.tt[i]) });
  if ( out.at(-1).ms !== Math.round(delay + pf.tt[n - 1]) ) out.push({ x: o.x + pf.pts[n - 1][0] * ap, y: o.y + pf.pts[n - 1][1] * ap, ms: Math.round(delay + pf.tt[n - 1]) });
  return out;
}
export function entryEvent(I, o, ap, start, { speed = 1, gun = null, ride = null, shot = false, key, sid, objId = null, from = null } = {}) {
  const r = I.rect, k2 = 1 / (speed || 1);
  const cx = Number.isFinite(I.ex) && (I.ex || I.ey) ? I.ex : (r.x0 + r.x1) / 2, cy = Number.isFinite(I.ey) && (I.ex || I.ey) ? I.ey : (r.y0 + r.y1) / 2;
  const w = Math.max(1, (I.w ?? r.x1 - r.x0)), h = Math.max(1, (I.h ?? r.y1 - r.y0));
  // (a gun whose shooter is on the map has its report at the muzzle (muzzleEvent): here, where its rounds land, the impact)
  const voice = gun && shot ? "gunhit" : destrVoice(I.type, I.cause | 0, !!gun);
  const lead = (I.type === "collapse" ? COLLAPSE_LEAD : 0) * k2;
  const box = { x0: o.x + r.x0 * ap, y0: o.y + r.y0 * ap, x1: o.x + r.x1 * ap, y1: o.y + r.y1 * ap };
  return { key, sid, obj: objId, voice, mat: matOf(I.mat), x: o.x + cx * ap, y: o.y + cy * ap, r: 0.5 * Math.sqrt(w * h) * ap, box,
    t: start + lead, ...(lead ? { tPre: start } : {}), ms: (TYPE_MS[I.type] ?? 600) * k2, colors: causeColors(I.cause | 0),
    from: from && (I.type !== "blast" || gun) ? from : null, ...(gun ? { path: gun, t0: start } : ride ? { path: ride, t0: start, ms: Math.max((TYPE_MS[I.type] ?? 600) * k2, ride.at(-1).ms + 300) } : {}) };
}

/* ---------------------------------------------------------------- what fire sounds like */

/** A fire's own colour as a lettering palette (light, the colour, dark); null for the natural fire (the engine's look). */
export function fireColors(c) {
  if ( typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c) ) return null;
  const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const hex = (k, to) => "#" + [r, g, b].map((v) => Math.round(v + (to - v) * k).toString(16).padStart(2, "0")).join("");
  return [hex(0.65, 255), c.toLowerCase(), hex(0.55, 0)];
}
/** natural (orange-red-yellow) fire is lettered in the engine's own fire look; only a fire painted in another colour (a blue, a green
    fire) letters in its colour */
export function ownFireColors(c) {
  if ( typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c) ) return null;
  const n = parseInt(c.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if ( d < 0.15 ) return fireColors(c);                       // (a white / grey fire: its own)
  const h = (mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60, hue = (h + 360) % 360;
  return hue <= 58 || hue >= 345 ? null : fireColors(c);
}
/** Loudness of a fire stroke's sound: its level (1 smouldering .. 3 a blaze) and its width. */
export const fireM = (lv = 2, rGrid = 1) => clamp(0.12 + 0.26 * (lv - 1) + 0.18 * Math.log1p(rGrid), 0.1, 1);
/** Loudness of an explosion: its level (1 grenade, 2 shell, 3 bomb) and its fireball's radius. */
export const burstM = (lv = 2, rGrid = 1) => clamp(0.35 + 0.2 * (lv - 1) + 0.12 * Math.log1p(rGrid), 0.2, 1);
export const DUST_VOICE = { shock: "whump", hits: "thud", heavy: "rumble", drag: "scrape", car: "engine", bike: "engine" };

/** Points along a flat path [x0, y0, x1, y1 ...] at fractions `fs` of its length: [{x, y, f}]. */
export function alongPath(p, fs) {
  const pts = []; for ( let i = 0; i + 1 < p.length; i += 2 ) pts.push([p[i], p[i + 1]]);
  if ( !pts.length ) return [];
  const cum = [0]; for ( let i = 1; i < pts.length; i++ ) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum.at(-1);
  return fs.map((f) => {
    if ( !(L > 0) ) return { x: pts[0][0], y: pts[0][1], f };
    const d = clamp(f, 0, 1) * L; let i = 1; while ( i < cum.length - 1 && cum[i] < d ) i++;
    const s = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
    return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * s, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * s, f };
  });
}
export const pathLength = (p) => { let L = 0; for ( let i = 2; i + 1 < p.length; i += 2 ) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; };
export function pathCentre(p) {
  let x = 0, y = 0, n = 0; for ( let i = 0; i + 1 < p.length; i += 2 ) { x += p[i]; y += p[i + 1]; n++; }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}
/** The box of a stroke's path with its radius (scene px). */
export function pathBox(p, r = 50) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( let i = 0; i + 1 < p.length; i += 2 ) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  if ( !Number.isFinite(x0) ) return null;
  return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
}

/**
 * The SOUND EVENTS of one fire-layer stroke (fire / smoke / dust / burst / erase) between `from` and `to` (shared-clock ms), given
 * its state before (`prev`: the stroke as last seen, or null when new) - pure, the same on every client.
 *   fire: catches (its path start: the word waits until the flames SHOW here: `gate`), flares up (a raised level, at the ramp's
 *         start), goes out (a quiet hiss at its middle at `o`, lasting as long as the flames die: `ms`); while it burns its sound is a
 *         CONTINUOUS one (burnPlan, played by sfx.mjs as the engine's sustain), not a timer of words;
 *   burst: the explosion at q (and, for a bomb, its shock and its debris as satellites); dust: a shock wave's whump, a heavy thing's
 *         rumble riding its path, a drag's scrape, an engine riding its path, hits; erase: a hiss where it puts out burning fire.
 * `ctx` = { grid (scene px), late (ms an event may be late and still play), newLate (a stroke new here), burning(st), outMs (ms the
 * flames take to die), passMs(st) (a dust source's run along its path), lifeMs(st) (a burst's life) }.
 */
export const NEW_LATE = 6000;
/** A shock wave's word sets off this long after the blast and rides out for this long (ms). */
export const SHOCK_MS = [90, 520];
/** Debris words land no earlier than this after the blast (the blast and its wave have the stage first). */
export const DEBRIS_MIN_MS = 380;
/** Where and when a burst's thrown debris lands (st.db = flat [dx, dy, ms, ...] from its centre): the first and the last landing,
    scene px and ms after the blast. */
export function debrisLandings(st, n = 2) {
  const d = st.db ?? [], p = st.p ?? [0, 0], out = [];
  for ( let i = 0; i + 2 < d.length; i += 3 ) if ( Number.isFinite(d[i + 2]) ) out.push({ x: p[0] + d[i], y: p[1] + d[i + 1], ms: d[i + 2] });
  out.sort((a, b) => a.ms - b.ms);
  return out.length <= n ? out : n === 1 ? [out[0]] : [out[0], out.at(-1)];
}
/**
 * A shooter's MUZZLE REPORT (a gun preset fired from a token on the map: presets accent item "muzzle", `from` the shooter, `hits`
 * [[x, y, t, lane]...] ms after the firing's t0): one stream at the barrel, a syllable per round as it LEAVES (its hit time minus its
 * flight). `muzzleOf(it, h, grid)` -> {x, y, L} (presets/accents-core.mjs), `flight(L)` the round's flight over L px (ms). -> event | null
 */
export function muzzleEvent(it, { t0 = 0, grid = 100, muzzleOf, flight, key, sid }) {
  if ( !Array.isArray(it?.from) || !(it.hits?.length) ) return null;
  const shots = it.hits.map((h) => { const q = muzzleOf(it, h, grid); return { x: q.x, y: q.y, ms: h[2] - flight(q.L), hx: h[0], hy: h[1] }; }).sort((a, b) => a.ms - b.ms);
  const s0 = shots[0].ms, walk = shots.map((q) => ({ x: q.x, y: q.y, ms: Math.round(q.ms - s0) }));
  // (the report kicks back from the aim, away from where the rounds fly, so it never sits on the impact words)
  const ax = shots[0].hx - shots[0].x, ay = shots[0].hy - shots[0].y;
  const dir = Math.round((Math.atan2(-ay, -ax) * 180) / Math.PI);
  const b = grid * 0.4, x = shots[0].x, y = shots[0].y;
  return { key, sid, obj: key, voice: "muzzle", x, y, r: grid * 0.45, t: t0 + s0, t0: t0 + s0, path: walk, dir, m: 0.45,
    ms: Math.max(300, walk.at(-1).ms + 300), box: { x0: x - b, y0: y - b, x1: x + b, y1: y + b } };
}
export function strokeEvents(st, prev, from, to, ctx) {
  const out = [], grid = ctx.grid || 100, late = ctx.late ?? 1500;
  const inWin = (t, lateMs = late) => t >= from - lateMs && t < to;
  const k = st.k, p = st.p ?? [], rG = (st.r ?? 50) / grid;
  const push = (e) => out.push({ obj: st.id, ...e });
  if ( k === "burst" ) {
    if ( prev || st.o !== undefined ) return out;
    const lv = st.lv ?? 2, m = burstM(lv, rG), r = st.r ?? 100;
    if ( inWin(st.q, ctx.newLate ?? NEW_LATE) ) {
      push({ key: `${st.id}|burst`, voice: "boom", x: p[0], y: p[1], r, t: st.q, m, ms: 600 + 350 * lv, colors: ownFireColors(st.c),
        box: { x0: p[0] - r, y0: p[1] - r, x1: p[0] + r, y1: p[1] + r } });
      // a shell or a bomb: its shock wave rolls out and its debris comes down: satellites of the same moment (one sound, one page)
      if ( lv >= 2 ) {
        // the SHOCK WAVE: its own word rides out with the wave (from the fireball's rim outwards as the ring grows), not a 2nd boom
        const sa = Math.PI * (-0.15 - 0.2 * h01(`${st.id}|sh`)), ux = Math.cos(sa), uy = Math.sin(sa);
        push({ key: `${st.id}|shock`, voice: "whump", x: p[0] + ux * r * 0.8, y: p[1] + uy * r * 0.8, r: r * 0.55, t: st.q + SHOCK_MS[0], m: m * 0.6, ms: SHOCK_MS[1] + 200,
          path: [{ x: p[0] + ux * r * 0.8, y: p[1] + uy * r * 0.8, ms: 0 }, { x: p[0] + ux * r * 2.1, y: p[1] + uy * r * 2.1, ms: SHOCK_MS[1] }] });
        // the DEBRIS coming down after it: where and when the burst's thrown chunks land (st.db [dx, dy, ms]...), else two falls
        const land = debrisLandings(st, 2), n = land.length || (lv >= 2.5 ? 2 : 1);
        for ( let i = 0; i < n; i++ ) {
          const a = Math.PI * (0.15 + 0.7 * h01(`${st.id}|deb${i}`)) + (i ? Math.PI : 0);
          const q = land[i] ?? { x: p[0] + Math.cos(a) * r * 1.05, y: p[1] + Math.sin(a) * r * 0.9, ms: 420 + 260 * i };
          push({ key: `${st.id}|debris${i}`, voice: "debris", x: q.x, y: q.y, r: r * 0.4, t: st.q + Math.max(DEBRIS_MIN_MS + 200 * i, q.ms), m: m * 0.5, ms: 800 });
        }
      }
    }
    return out;
  }
  if ( k === "dust" ) {
    if ( prev || st.o !== undefined ) return out;
    const v = DUST_VOICE[st.dk] ?? "rumble", len = pathLength(p) / grid;
    const at = st.dk === "shock" || st.dk === "hits" || p.length < 4 ? { x: p[0], y: p[1] } : alongPath(p, [0.5])[0];
    const pass = Math.max(400, ctx.passMs?.(st) ?? len * 400);
    const r = (st.r ?? 50) * (st.dk === "shock" ? 1 : 1 + 0.15 * len);
    if ( inWin(st.q, ctx.newLate ?? NEW_LATE) ) {
      const e = { key: `${st.id}|dust`, voice: v, x: at.x, y: at.y, r, t: st.q, ms: st.dk === "shock" ? 700 : pass,
        m: clamp(0.15 + 0.2 * (st.lv ?? 2) + 0.06 * len, 0.1, st.dk === "shock" ? 0.8 : 0.75), from: p.length >= 4 ? { x: p[0], y: p[1] } : null, box: pathBox(p, st.r ?? 50) };
      // a thing that travels (a car, a bike, a drag, a heavy thing pushed along): its word rides the path with it
      if ( VOICES[v]?.ride || v === "rumble" ) if ( p.length >= 4 ) e.path = alongPath(p, Array.from({ length: 9 }, (_, i) => i / 8)).map((q) => ({ x: q.x, y: q.y, ms: q.f * pass }));
      push(e);
    }
    return out;
  }
  if ( k === "erase" ) {
    if ( prev || st.o !== undefined || !ctx.burning?.(st) ) return out;
    if ( inWin(st.g ?? st.q) ) push({ key: `${st.id}|douse`, voice: "douse", x: p[0], y: p[1], r: st.r ?? 50, t: Math.max(st.g ?? st.q, from),
      m: clamp(0.25 + 0.2 * Math.log1p(rG), 0.15, 0.6), ms: 1100, box: pathBox(p, st.r ?? 50) });
    return out;
  }
  if ( k !== "fire" ) return out;                 // (smoke makes no sound of its own)
  const lit = st.g ?? st.q, lv = st.lv ?? 2, m = fireM(lv, rG), colors = ownFireColors(st.c), box = pathBox(p, st.r ?? 50);
  const relit = !prev || (prev.g ?? prev.q) !== lit;
  // the catch: when its flames show here (gate), played late too when the stroke is new here (it reached this client on release)
  if ( relit && (st.o === undefined || st.o > lit + 400) && inWin(lit, prev ? late : ctx.newLate ?? NEW_LATE) )
    push({ key: `${st.id}|catch|${lit}`, voice: "fire", x: p[0], y: p[1], r: st.r ?? 50, t: Math.max(lit, from), m, ms: 1400, colors, gate: st.id, box });
  // a level raised: the fire flares up (at the ramp's start)
  if ( prev && st.lt !== undefined && st.lt !== prev.lt && (st.lv ?? 2) > (st.l0 ?? prev.lv ?? 2) + 0.2 && inWin(st.lt) ) {
    const c = pathCentre(p);
    push({ key: `${st.id}|flare|${st.lt}`, voice: "flare", x: c.x, y: c.y, r: st.r ?? 50, t: st.lt, m: fireM(st.lv, rG), ms: 1300, colors, box });
  }
  // put out (or a preset's fire whose out time comes): a quiet hiss at its middle, as long as its flames take to die
  if ( st.o !== undefined && (!prev || prev.o !== st.o) && inWin(st.o) ) {
    const c = pathCentre(p);
    push({ key: `${st.id}|out|${st.o}`, voice: "out", x: c.x, y: c.y, r: st.r ?? 50, t: Math.max(st.o, from), ms: Math.max(1200, ctx.outMs ?? 3500),
      m: clamp(0.18 + 0.06 * lv, 0.15, 0.4), box });
  }
  return out;
}

/** Is a fire event still worth lettering at `now` (shared clock): its stroke still there and (for a catch / flare) still burning. */
export function fireEventLive(e, st, now) {
  if ( !e.obj || !/^(fire|flare)$/.test(e.voice) ) return true;
  if ( !st ) return false;
  return st.o === undefined || st.o > now;
}

/**
 * A burning fire's CONTINUOUS sound (sfx.mjs plays it with the engine's sustain for as long as it burns): `group` = fire strokes
 * burning together (overlapping), `now` shared ms. -> { key, seed id, kind, points (a few fixed spots along the biggest stroke where
 * its phrases sound; the first rides the flame front while it still catches), level(now) 0..1 (from the fires' levels), live
 * (a blaze: a phrase score; a smoulder: the engine's quiet ambient mode), r, colors, prio }.
 */
export function burnPlan(group, { grid = 100, catchMs = () => 0, levelNow = (s) => s.lv ?? 2 } = {}) {
  const list = group.slice().sort((a, b) => ((b.r ?? 50) * (b.lv ?? 2) - (a.r ?? 50) * (a.lv ?? 2)) || (a.id < b.id ? -1 : 1));
  const st = list[0], p = st.p ?? [], L = pathLength(p) / grid, lit = st.g ?? st.q;
  const parts = Math.max(1, Math.min(3, Math.round(L / 6) + (list.length > 2 ? 1 : 0)));
  const T = catchMs(st);
  const points = Array.from({ length: parts }, (_, i) => {
    // (spot 0 rides the flame front and rests where its part of the path ends: the farthest spot; the others wait along the path)
    const f = parts === 1 ? 0.45 + 0.2 * h01(`${st.id}|bp`) : (i === 0 ? parts - 0.5 : i - 0.5) / parts;
    const at = alongPath(p, [f])[0] ?? { x: p[0], y: p[1] };
    return { f, x: at.x, y: at.y };
  });
  const lvOf = (now) => Math.max(...list.map((s) => levelNow(s, now)));
  const level = (now) => clamp(0.12 + 0.3 * (lvOf(now) - 1) + 0.04 * Math.min(3, list.length - 1), 0.08, 0.9);
  const r = Math.max(...list.map((s) => s.r ?? 50));
  return { key: list.map((s) => s.id).sort().join("+"), seedId: list.map((s) => s.id).sort()[0], kind: "fire", st, lit, catchMs: T, points, level,
    live: lvOf(Infinity) >= 1.6, r, colors: ownFireColors(st.c), prio: r * lvOf(Infinity) * (1 + 0.3 * (list.length - 1)),
    /** where phrase spot `i` is at shared time `now`: the first rides the flame front while the fire still runs along its path */
    at: (i, now) => {
      const q = points[i] ?? points[0];
      if ( i === 0 && T > 300 && now - lit < T ) { const f = clamp((now - lit) / T, 0, 1); if ( f < q.f ) { const a = alongPath(p, [f])[0]; if ( a ) return { x: a.x, y: a.y }; } }
      return { x: q.x, y: q.y };
    } };
}
/** Fire strokes that burn together (paths within their radii plus a square): groups (deterministic order). */
export function burnGroups(fires, grid = 100) {
  const list = fires.slice().sort((a, b) => (a.id < b.id ? -1 : 1)), parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const near = (a, b) => { const A = a.p ?? [], B = b.p ?? [], d = (a.r ?? 50) + (b.r ?? 50) + grid;
    for ( let i = 0; i + 1 < A.length; i += 2 ) for ( let j = 0; j + 1 < B.length; j += 2 ) if ( Math.hypot(A[i] - B[j], A[i + 1] - B[j + 1]) < d ) return true; return false; };
  for ( let i = 0; i < list.length; i++ ) for ( let j = i + 1; j < list.length; j++ ) if ( find(i) !== find(j) && near(list[i], list[j]) ) parent[find(j)] = find(i);
  const groups = new Map(); list.forEach((s, i) => { const r = find(i); if ( !groups.has(r) ) groups.set(r, []); groups.get(r).push(s); });
  return [...groups.values()];
}

/* ---------------------------------------------------------------- clusters */

/** Events -> clusters { members (loudest first), main, x, y (centre), rEq (combined size), span (reach), t, box (all subjects) }. */
export function cluster(events, grid = 100) {
  const ev = events.slice().sort((a, b) => ((VOICES[b.voice]?.prio ?? 0) - (VOICES[a.voice]?.prio ?? 0)) || (b.r - a.r) || (sidOf(a) < sidOf(b) ? -1 : 1));
  const groups = [];
  for ( const e of ev ) {
    let best = null;
    for ( const g of groups ) {
      const dt = Math.abs(e.t - g.t);
      if ( e.obj && g.objs.has(e.obj) && dt <= SAME_OBJ_MS ) { best = g; break; }
      if ( dt > JOIN_MS || e.path || g.main.path ) continue;
      const d = Math.hypot(e.x - g.x, e.y - g.y);
      if ( d <= g.span + e.r + grid * 1.5 ) { best = g; break; }
    }
    const eb = e.box ?? { x0: e.x - e.r, y0: e.y - e.r, x1: e.x + e.r, y1: e.y + e.r };
    if ( !best ) { groups.push({ members: [e], main: e, objs: new Set(e.obj ? [e.obj] : []), x: e.x, y: e.y, w: e.r * e.r, rEq: e.r, span: e.r, t: e.t, box: { ...eb } }); continue; }
    best.members.push(e); if ( e.obj ) best.objs.add(e.obj);
    const w = e.r * e.r, W = best.w + w;
    best.x = (best.x * best.w + e.x * w) / W; best.y = (best.y * best.w + e.y * w) / W; best.w = W;
    best.rEq = Math.sqrt(W);
    best.span = Math.max(...best.members.map((q) => Math.hypot(q.x - best.x, q.y - best.y) + q.r));
    best.box = { x0: Math.min(best.box.x0, eb.x0), y0: Math.min(best.box.y0, eb.y0), x1: Math.max(best.box.x1, eb.x1), y1: Math.max(best.box.y1, eb.y1) };
  }
  return groups;
}

/**
 * The WORD SPECS of a cluster (before the engine writes the text and before placement): [{ role: "pre" | "main" | "sec", voice, kind,
 * loud 0..1, ms (how long the sound is: the engine's `duration`, which alone stretches the word), x, y (where it sounds), t (when),
 * seed, from, rotation, colors, magnitude (engine), area (engine), stage (motion), subject (box it letters), cover, path?, stream? }].
 * `o` = { grid, sec (max satellites), seed (scene id), big (only main words of big sounds), known (the engine's kind ids) }.
 */
export function planCluster(g, o = {}) {
  const grid = o.grid || 100, main = g.main;
  const single = g.members.length === 1;
  const m = main.m !== undefined ? Math.max(main.m, single ? 0 : magnitude(g.rEq / grid)) : magnitude(g.rEq / grid);
  if ( o.big && m < 0.34 ) return [];
  const seed = `${o.seed ?? ""}|${sidOf(main)}`;
  const words = [];
  const loud = clamp(0.2 + 0.8 * m, 0, 1);
  const centre = single ? { x: main.x, y: main.y } : { x: g.x, y: g.y };
  // a big cave-in: the ground cracks first (its anticipation, from tPre), then it comes down
  if ( main.voice === "crash" && m >= 0.5 && !o.big ) {
    const tPre = main.tPre ?? main.t - COLLAPSE_LEAD;
    words.push(spec("pre", "creak", clamp(0.25 + 0.3 * m, 0, 0.6), Math.max(150, main.t - tPre), { x: centre.x, y: g.box.y0 + (g.box.y1 - g.box.y0) * 0.25 }, tPre, seed + "|pre", null,
      h01(seed + "|pr") * 16 - 8, main.colors, o, { area: g.span * 0.3, subject: g.box }));
  }
  const mw = spec("main", main.voice, loud, main.ms ?? VOICES[main.voice]?.ms ?? 600, centre, main.t, seed, main.from ?? null,
    (h01(seed + "|rot") - 0.5) * 10, main.colors, o, { area: single ? main.r : Math.max(main.r, g.span * 0.75), subject: g.box, mat: main.mat });
  // a gun's rounds rattle along their walk (the engine's stream of its sound kind, one syllable a round) instead of one word
  if ( VOICES[main.voice]?.stream && main.path?.length ) mw.stream = { walk: main.path, t0: main.t0 ?? main.t, ...(Number.isFinite(main.dir) ? { dir: main.dir } : {}) };
  // a thing that travels: its word rides its path
  else if ( main.path?.length > 1 ) mw.path = main.path;
  // (the WORD is written from the main sound alone - how loud it is, how long: the same on every seat even when the rest of its
  // cluster reaches one seat a bake later; the cluster only makes it bigger)
  mw.textLoud = clamp(0.2 + 0.8 * (main.m ?? magnitude(main.r / grid)), 0, 1);
  words.push(mw);
  if ( o.big || !(o.sec > 0) || single ) return words;
  // satellites: the biggest other members out at the edge, each its own voice, quieter, staggered
  const nSec = Math.min(o.sec, g.members.length - 1, Math.max(1, Math.round(m * 3.4)));
  const minD = Math.max(grid * 0.6, Math.min(g.span * 0.35, grid * 2));
  const cand = g.members.filter((e) => e !== main && (Math.hypot(e.x - centre.x, e.y - centre.y) > minD || /^(whump|debris)$/.test(e.voice)))
    .sort((a, b) => ((VOICES[b.voice]?.prio ?? 0) === (VOICES[a.voice]?.prio ?? 0) ? 0 : /^(whump|debris)$/.test(a.voice) ? -1 : /^(whump|debris)$/.test(b.voice) ? 1 : 0) || (b.r - a.r) || (sidOf(a) < sidOf(b) ? -1 : 1));
  const used = [];
  for ( const e of cand ) {
    if ( used.length >= nSec ) break;
    if ( used.some((u) => Math.hypot(u.x - e.x, u.y - e.y) < minD) ) continue;    // (two satellites close together are one sound)
    used.push(e);
  }
  used.forEach((e, i) => {
    // a cave-in's satellites are its debris landing; a bomb's are its shock and debris: one size down from the main word
    const v = main.voice === "crash" && e.voice === "crash" ? "debris" : e.voice === main.voice ? "debris" : e.voice;
    const m2 = Math.min(m * 0.55, e.m ?? magnitude(e.r / grid));
    const dx = e.x - centre.x, dy = e.y - centre.y, d = Math.hypot(dx, dy) || 1;
    const at = { x: e.x + (dx / d) * e.r * 0.3, y: e.y + (dy / d) * e.r * 0.3 };
    const sd = `${o.seed ?? ""}|${sidOf(e)}`;
    // (a satellite sounds when its own thing happens - debris as it lands, a wave as it rolls - else just after the main word)
    const ts = e.t > main.t + 50 ? e.t : Math.max(e.t, main.t) + 160 + i * 140;
    const sw = spec("sec", v, clamp(0.15 + 0.7 * m2, 0, 0.7), e.ms ?? VOICES[v]?.ms ?? 600, e.path?.length > 1 ? e.path[0] : at, ts, sd, centre,
      Math.sign(dx || 1) * (5 + 9 * h01(sd + "|rot")), e.colors, o, { area: e.r * 0.7, subject: e.box ?? null, mat: e.mat ?? main.mat });
    if ( e.path?.length > 1 ) sw.path = e.path;
    words.push(sw);
  });
  return words;
}

function spec(role, voice, loud, ms, at, t, seed, from, rotation, colors, o, extra = {}) {
  const V = VOICES[voice] ?? VOICES.crack, grid = o.grid || 100;
  const stage = { ...(V.stage ?? {}) };
  // a small crash is a thud (it slams in); satellites and pre words do not shove the main word
  if ( voice === "crash" && loud < 0.45 ) stage.in = "slam";
  if ( role !== "main" ) delete stage.push;
  return { role, voice, kind: kindOf(voice, o.known, extra.mat ?? null), mat: extra.mat ?? null, loud, ms: Math.round(ms), x: at.x, y: at.y, t, seed, from: from ?? null, rotation, colors: colors ?? null,
    magnitude: engineMag(loud, voice) * (role === "sec" ? 0.85 : 1), area: Math.round(engineArea(extra.area ?? grid * 0.5, voice, grid)),
    stage, cover: V.cover ?? 0.25, subject: extra.subject ?? null, drift: !!V.drift };
}

/** A gun's rattle: the beats (ms from its first round) of its stream's syllables - 3 to 8, spread evenly over its walk. */
export function streamBeats(walk) {
  const T = Math.max(1, walk?.at?.(-1)?.ms || 1), n = Math.min(8, Math.max(3, walk?.length ?? 0));
  return [...new Set(Array.from({ length: n }, (_, i) => Math.round((T * i) / (n - 1))))];
}

/** The words a client keeps when it has room for `room` more: the main word first, then the pre word, then satellites (by time). */
export function capWords(words, room) {
  if ( !(room > 0) ) return [];
  const rank = (w) => (w.role === "main" ? 0 : w.role === "pre" ? 1 : 2);
  return words.slice().sort((a, b) => rank(a) - rank(b) || a.t - b.t).slice(0, room).sort((a, b) => a.t - b.t);
}

/** When an event must be handed to the gathering so that its EARLIEST word (a cave-in's pre word at tPre) is played on time. */
export const dueAt = (e) => Math.min(e.t, e.tPre ?? e.t) - GATHER_MS;
/** Is a word too late to play at `now` (its sound, `ms` long, is over)? */
export const tooLate = (w, now) => now - w.t > Math.max(LATE_MS, (w.ms ?? 0) * 0.6);

/* ---------------------------------------------------------------- placement on this client's screen */

/** A word's box (scene px) centred at (x, y): its measured width / height (sfx.mjs: the engine's hold picture), else an estimate. */
export function boxOf(w, x = w.x, y = w.y) {
  const W = w.bw ?? (w.size ?? 60) * (0.75 * (w.chars ?? 6) + 0.6), H = w.bh ?? (w.size ?? 60) * 1.6;
  // (a word that rises off its place - steam off what was put out - needs its whole way up free: `rise` scene px, `riseX` sideways)
  const R = w.rise > 0 ? w.rise : 0, RX = w.riseX ?? 0;
  return { x0: x - W / 2 + Math.min(0, RX), y0: y - H / 2 - R, x1: x + W / 2 + Math.max(0, RX), y1: y + H / 2 };
}
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inter = (a, b) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
/** where a word may go around its subject (unit offsets from the subject box's centre; the word box is added): above first (screen-up
    reads as the sound rising off it), then the upper corners, the sides, below; the subject's own centre last */
const AROUND = [[0, -1], [0.55, -1], [-0.55, -1], [1, -0.35], [-1, -0.35], [1, 0.3], [-1, 0.3], [0, 1], [0, 0]];
/** a word slightly overlaps the edge of its subject (the comic's sound word touches what makes it): share of the word height */
export const TOUCH = 0.18;
/** the penalties of a place: interface panel, token, other word, subject covered (beyond its voice's `cover`), outside the view,
    distance from where it sounds (in word sizes) */
export const PEN = { ui: 8, tok: 4, word: 3, subject: 2.5, off: 2, dist: 0.18 };

/**
 * Places kept readable on this screen: beside what each word letters, off tokens, off this client's interface panels, off other words,
 * inside the view. `ctx` = { view ({x0, y0, x1, y1} scene px), ui ([box] scene px: interface panels over the canvas), tokens ([box]),
 * alive ([box]: words already up) }. Each word needs its box size (bw, bh scene px). -> the words to play with x, y, box set; a
 * satellite or pre word that cannot find a free place is dropped; the main word always plays (the least bad place) unless its whole
 * place is off this screen.
 */
export function place(words, ctx) {
  const v = ctx.view, ui = ctx.ui ?? [], tokens = ctx.tokens ?? [];
  const taken = [...(ctx.alive ?? [])], out = [];
  const rank = (w) => (w.role === "main" ? 0 : w.role === "pre" ? 1 : 2);
  for ( const w0 of words.slice().sort((a, b) => rank(a) - rank(b)) ) {
    const w = { ...w0 }, main = w.role === "main";
    if ( w.path || w.stream ) { if ( !v || inter(boxOf(w), v) > 0 || pathInView(w, v) ) { w.box = boxOf(w); out.push(w); } else if ( main ) return []; continue; }
    const b0 = boxOf(w), bw = b0.x1 - b0.x0, bh = b0.y1 - b0.y0;
    const S = w.subject;
    const cands = [];
    if ( S ) {
      const cx = (S.x0 + S.x1) / 2, cy = (S.y0 + S.y1) / 2, hw = (S.x1 - S.x0) / 2, hh = (S.y1 - S.y0) / 2;
      for ( const [ox, oy] of AROUND ) cands.push([cx + ox * (hw + bw / 2 - TOUCH * bh), cy + oy * (hh + bh / 2 - TOUCH * bh)]);
    }
    cands.push([w.x, w.y], [w.x, w.y - bh * 0.8], [w.x + bw * 0.6, w.y - bh * 0.5], [w.x - bw * 0.6, w.y - bh * 0.5]);
    // just clear of a panel / token it would cover: above, beside, below it
    for ( const t of [...ui, ...tokens] ) if ( inter(b0, t) > 0 ) cands.push([w.x, t.y0 - bh / 2 - 6], [t.x1 + bw / 2 + 6, w.y], [t.x0 - bw / 2 - 6, w.y], [w.x, t.y1 + bh / 2 + 6]);
    let best = null;
    for ( let [x, y] of cands ) {
      // (inside the view where it fits: a word half off the screen edge is not read)
      if ( v ) {
        const m = 0.02 * Math.min(v.x1 - v.x0, v.y1 - v.y0);
        if ( bw < v.x1 - v.x0 - 2 * m ) x = clamp(x, v.x0 + m + bw / 2, v.x1 - m - bw / 2);
        if ( bh < v.y1 - v.y0 - 2 * m ) y = clamp(y, v.y0 + m + bh / 2, v.y1 - m - bh / 2);
      }
      const b = boxOf(w, x, y), A = area(b) || 1;
      const pui = ui.reduce((s, t) => s + inter(b, t), 0) / A;
      const tok = tokens.reduce((s, t) => s + inter(b, t), 0) / A;
      const wrd = taken.reduce((s, t) => s + inter(b, t), 0) / A;
      const sub = S ? Math.max(0, inter(b, S) / Math.max(1, area(S)) - (w.cover ?? 0.25)) : 0;   // (the share of the subject it hides)
      const off = v ? 1 - inter(b, v) / A : 0;
      const dist = Math.hypot(x - w.x, y - w.y) / Math.max(1, bh);
      const pen = pui * PEN.ui + tok * PEN.tok + wrd * PEN.word + sub * PEN.subject + off * PEN.off + dist * PEN.dist;
      if ( !best || pen < best.pen ) best = { x, y, b, pen, pui, tok, wrd, off, sub };
    }
    // (what it letters is entirely off this screen: nobody here sees it - a main word off screen takes its cluster with it)
    if ( v && inter(S ?? boxOf(w), v) === 0 && inter(boxOf(w), v) === 0 ) { if ( main ) return []; continue; }
    if ( !main && (best.pui > 0.02 || best.tok > 0 || best.wrd > 0.05 || best.off > 0.15) ) continue;
    w.x = best.x; w.y = best.y; w.box = best.b; w.pen = best;
    taken.push(best.b); out.push(w);
  }
  return out.sort((a, b) => a.t - b.t);
}
/**
 * The smallest shift (scene px) that takes `box` off every interface panel in `ui` and inside the view `v` (a fire's continuous words
 * hover over its flames: when the flames lie under a panel, the words move just clear of it). Tries the shifts that clear each panel
 * it touches (and combinations, three passes), keeps the shortest one that is free, else the one that covers least. -> { dx, dy }
 * ({ 0, 0 } when it is free already).
 */
export function clearOf(box, ui = [], v = null, maxShift = Infinity) {
  const hits = (b) => ui.reduce((s, t) => s + inter(b, t), 0) + (v ? area(b) - inter(b, v) : 0);
  const mv = (b, dx, dy) => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
  if ( !(hits(box) > 0) ) return { dx: 0, dy: 0 };
  let frontier = [{ dx: 0, dy: 0 }], best = null, part = { dx: 0, dy: 0, d: 0, h: hits(box) };
  for ( let pass = 0; pass < 3 && !best; pass++ ) {
    const next = [];
    for ( const s of frontier ) {
      const b = mv(box, s.dx, s.dy), opts = [];
      for ( const t of ui ) if ( inter(b, t) > 0 ) opts.push([t.x0 - b.x1 - 4, 0], [t.x1 - b.x0 + 4, 0], [0, t.y0 - b.y1 - 4], [0, t.y1 - b.y0 + 4]);
      if ( v ) { if ( b.x0 < v.x0 ) opts.push([v.x0 - b.x0, 0]); if ( b.x1 > v.x1 ) opts.push([v.x1 - b.x1, 0]); if ( b.y0 < v.y0 ) opts.push([0, v.y0 - b.y0]); if ( b.y1 > v.y1 ) opts.push([0, v.y1 - b.y1]); }
      for ( const [ox, oy] of opts ) {
        const c = { dx: s.dx + ox, dy: s.dy + oy }, d = Math.hypot(c.dx, c.dy);
        if ( d > maxShift ) continue;
        const hc = hits(mv(box, c.dx, c.dy));
        if ( hc <= 0 ) { if ( !best || d < best.d ) best = { ...c, d }; } else { next.push(c); if ( !part || hc < part.h - 1e-6 || (Math.abs(hc - part.h) < 1e-6 && d < part.d) ) part = { ...c, d, h: hc }; }
      }
    }
    frontier = next.sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy)).slice(0, 12);
  }
  // (nowhere fully free within reach: the place that covers the least)
  return best ? { dx: best.dx, dy: best.dy } : { dx: part.dx, dy: part.dy };
}
const pathInView = (w, v) => (w.path ?? w.stream?.walk ?? []).some((q) => q.x >= v.x0 && q.x <= v.x1 && q.y >= v.y0 && q.y <= v.y1);

/* ---------------------------------------------------------------- the interface over the canvas (pure over a DOM-like tree) */

/**
 * The screen rectangles of this client's interface panels that cover the canvas: Foundry's sidebar, bars, controls, windows, and any
 * module's panel (a pins list, a challenge HUD, party portraits). Walks the page from `roots`: a PAINTED element (a background, a
 * border, an image, its own text) smaller than half the screen is a panel (its whole rectangle); a transparent container (a full-screen
 * layer, #interface, #ui-middle) is looked into. `env` = { style(el) -> computed style, vw, vh, skip(el) -> true to leave it out (the
 * canvas, the lettering's own layers), max (elements visited) }. -> [{ x0, y0, x1, y1 }] client px.
 */
export function uiRects(roots, env) {
  const out = [], vw = env.vw, vh = env.vh, max = env.max ?? 900;
  let n = 0;
  const painted = (el, cs) => {
    const tag = String(el.tagName ?? "").toUpperCase();
    if ( /^(IMG|CANVAS|VIDEO|SVG|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(tag) ) return true;
    const bg = String(cs.backgroundColor ?? "");
    if ( bg && !/^(transparent|rgba\([^)]*,\s*0\))$/.test(bg.replace(/\s+/g, " ")) && !/rgba\([^)]*,\s*0(\.0+)?\)$/.test(bg) ) return true;
    if ( cs.backgroundImage && cs.backgroundImage !== "none" ) return true;
    if ( parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none" && !/rgba\([^)]*,\s*0\)$/.test(String(cs.borderTopColor ?? "")) ) return true;
    for ( const c of el.childNodes ?? [] ) if ( c.nodeType === 3 && /\S/.test(c.textContent ?? "") ) return true;
    return false;
  };
  const visit = (el, depth) => {
    if ( n++ > max || !el || el.nodeType !== 1 || env.skip?.(el) ) return;
    const cs = env.style(el);
    if ( !cs || cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse" || Number(cs.opacity) === 0 ) return;
    const r = el.getBoundingClientRect?.();
    const box = r && r.width > 0 && r.height > 0 ? { x0: Math.max(0, r.left), y0: Math.max(0, r.top), x1: Math.min(vw, r.right), y1: Math.min(vh, r.bottom) } : null;
    const onScreen = box && box.x1 > box.x0 + 2 && box.y1 > box.y0 + 2;
    if ( onScreen && painted(el, cs) && area(box) < 0.5 * vw * vh ) { out.push(box); return; }
    if ( depth >= 9 ) return;
    for ( const c of el.children ?? [] ) visit(c, depth + 1);
  };
  for ( const r of roots ) visit(r, 0);
  return merge(out);
}
/** rectangles inside another one are dropped (a panel's own painted children) */
function merge(list) {
  const s = list.slice().sort((a, b) => area(b) - area(a)), out = [];
  for ( const r of s ) if ( !out.some((o) => r.x0 >= o.x0 - 1 && r.y0 >= o.y0 - 1 && r.x1 <= o.x1 + 1 && r.y1 <= o.y1 + 1) ) out.push(r);
  return out;
}
/** Client-px rectangles -> scene px (the canvas transform: `toScene({x, y})`). */
export const toSceneBoxes = (rects, toScene) => rects.map((r) => { const a = toScene({ x: r.x0, y: r.y0 }), b = toScene({ x: r.x1, y: r.y1 }); return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }; });

/* ---------------------------------------------------------------- echoes */

/**
 * An ECHO: a cluster that comes a moment after another one of the same family (a bomb's fireball, then its crater's entry a few
 * hundred ms later; a collapse whose areas reach the screen in two bakes) inside its reach is part of that sound: not a second main
 * word. `recent` = [{ x, y, reach, t, prio }] of main words played lately. -> true when `g` is such an echo.
 */
export const ECHO_MS = 1600;
export function isEcho(g, recent, grid = 100) {
  const p = VOICES[g.main.voice]?.prio ?? 0;
  // (fires going out one after another - a bomb's burning debris dying patch by patch - hiss once: the next hiss waits OUT_GAP_MS)
  if ( g.main.voice === "out" && recent.some((r) => r.voice === "out" && Math.abs(g.t - r.t) < OUT_GAP_MS) ) return true;
  return recent.some((r) => g.t - r.t >= -50 && g.t - r.t < ECHO_MS && r.prio >= p && Math.hypot(g.x - r.x, g.y - r.y) < r.reach + g.span * 0.5 + grid);
}
/** ms between two fire-out hisses anywhere on the scene */
export const OUT_GAP_MS = 2600;

/** The word set for a language setting: "en" / "pl", or "auto" (the game's language: Polish -> "pl", any other -> "en"). */
export const langOf = (setting, gameLang = "en") => (setting === "en" || setting === "pl" ? setting : String(gameLang).toLowerCase().startsWith("pl") ? "pl" : "en");
