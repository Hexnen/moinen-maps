/**
 * WEATHER, the pure model (no Foundry, no PIXI: node-tested in dev/weather-model.test.mjs).
 *
 * THE STORED STATE is one scene flag, `flags.moinen-maps.weather`, written by the GM only; nothing is sent per frame (VERSION 2):
 *   { v, on, who: "all" | "gm", seed,
 *     keys: [ { t: shared ms, dur: ms, preset, level: v (the preset strength), fx: { rain: v, ... }, wind: { dir, str, gust } } ],
 *                                                        (the timeline; every v is one continuous STRENGTH 0..V_MAX)
 *     base: { t, fx: { eff: v }, wind, wet, cover, drift? },  (the state the oldest kept key starts from: older keys are folded into it)
 *     ground: { wetRate, dryRate, puddles },             (seconds to wet / dry the ground; puddles on / off)
 *     lens: { on, level: "auto" | v, strength, heat },
 *     tornadoes: [ { id, path, t0, speed, wander, size, level 1..3 (float), ... } ] },  (weather OBJECTS on their own paths: tornado-model.mjs)
 *     fire: { out },                                     (rain puts fire areas out: off by default, research D9)
 *     clouds: { mode: "sky" | "shadows", modeT, rays, raysT },  (the cloud layer's look: bodies + shadows or shadows only, godrays;
 *                                                        each switch fades over CLOUD_FADE ms from its shared time)
 *     storm: { on, rate, power, near, bolts, t, prev } }  (the rain's lightning, storm-model.mjs; absent until the GM first sets it)
 * A VERSION 1 flag (keys with `i` and fx { l, i }, base fx { p, s }) is read the same way and migrated at read time (`cleanParams`):
 * see dev/weather-slider-design.md 3.2. The next GM change writes VERSION 2.
 *
 * STRENGTH v (dev/weather-slider-design.md 2.1): 0 off, 1 / 2 / 3 exactly the old levels 1 / 2 / 3 at the default fine intensity,
 * up to V_MAX = 3.35 (the "overdrive": the old level 3 at fine intensity 1). `strength(v)` is the only place that maps it onto the
 * two quantities every consumer reads:
 *   p  its presence 0..1 = clamp(v, 0, 1) (0..1 fades the level-1 look in), and
 *   s  its LEVEL continuum = clamp(v - 1, 0, V_MAX - 1) (0 / 1 / 2 at the levels; up to 2.35 in the overdrive);
 * every gate of the look (slot densities, splash crowns, wet tint, puddle threshold ...) is a piecewise-linear function of s through
 * the research's level tables at s = 0, 1, 2 (`gate`), so moving between levels never pops.
 *
 * THE STATE AT A MOMENT is a pure function of the flag and the shared clock (`resolve`): every key ramps each effect's v from the
 * state at its start to its target along a smoothstep over its `dur` (an effect missing on one side counts as v = 0), so a change is
 * a smooth ramp through exactly the states the slider would show (rain 3 -> clear passes through 2 and 1), and a client that joins
 * late computes the same thing.
 * WET GROUND (and SNOW COVER) accumulates: it rises toward the rain's ceiling (30 / 65 / 100 % of the full wet tint at levels 1 / 2 / 3) with time
 * constant wetRate and dries with dryRate, integrated in closed form between transitions (1 s steps inside them): deterministic.
 */
import { WIND_DEFAULT, SPEED_SQ, dirVec } from "../wind.mjs";
import { cleanTornadoes } from "./tornado-model.mjs";
import { cleanStorm } from "./storm-model.mjs";

export const FLAG = "weather";
export const VERSION = 2;
export const KEEP_KEYS = 8;
export const LEAD_MS = 300;             // a change starts this far ahead, so every client starts it on the same frame
export const DEFAULT_DUR = 20000;       // ms
export const MIN_DUR = 0;

/** The effects drawn by this build, in draw order. */
export const EFFECTS = ["rain", "snow", "sand", "dust", "embers", "wind", "clouds"];
/** The GM's presets: which effects at which level (null = the chosen level). */
export const PRESETS = {
  clear: {},
  rain: { rain: null },
  snow: { snow: null },
  sand: { sand: null },
  dust: { dust: null },
  embers: { embers: null },
  wind: { wind: null },
  storm: { rain: null, wind: null },
  blizzard: { snow: null, wind: null },
  clouds: { clouds: null }
};
export const PRESET_ICONS = { clear: "fa-solid fa-sun", rain: "fa-solid fa-cloud-rain", snow: "fa-solid fa-snowflake", sand: "fa-solid fa-wind",
  dust: "fa-solid fa-sun-haze", embers: "fa-solid fa-fire-flame-curved", wind: "fa-solid fa-leaf", storm: "fa-solid fa-cloud-showers-heavy",
  blizzard: "fa-solid fa-icicles", clouds: "fa-solid fa-cloud-sun" };

export const LIMITS = { wetRate: [5, 600], dryRate: [10, 3600], snowRate: [5, 1800], meltRate: [10, 7200], strength: [0, 1], str: [0, 1], gust: [0, 1], dur: [0, 600000] };
export const GROUND_DEFAULT = { wetRate: 60, dryRate: 300, puddles: true, snowRate: 120, meltRate: 600 };
export const LENS_DEFAULT = { on: true, level: "auto", strength: 1, heat: false };
export const CLOUDS_DEFAULT = { mode: "sky", modeT: 0, rays: true, raysT: 0 };
export const CLOUD_MODES = ["sky", "shadows"];
export const CLOUD_FADE = 4000;         // ms: a switch of the cloud mode or the godrays fades in / out over this

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
/** A number given as a number or a numeric string (form values); anything else (null, "", junk) is NaN. */
const numOf = (v) => typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;

/* ---------------------------------------------------------------- strength v (dev/weather-slider-design.md 2.1) */

/** The strength's top: the old level 3 at fine intensity 1 (3 + 0.5 x 0.7), the "overdrive" above 3. */
export const V_MAX = 3.35;
/** Below this a strength counts as off (dropped from the resolved state, the same as the old presence floor). */
export const V_OFF = 0.0005;
/** The fine intensity's old span: v1 `i` 0..1 moved the level continuum by (i - 0.5) x FINE. */
export const FINE = 0.7;
/** A stored strength: finite, clamped to 0..V_MAX, rounded to 1e-4 (the integers and k / 20 slider steps stay exact). */
export const cleanV = (v, d = 0) => { const n = numOf(v); return Number.isFinite(n) ? Math.round(Math.min(V_MAX, Math.max(0, n)) * 1e4) / 1e4 : d; };
/**
 * THE MAPPING of a strength onto what every consumer reads: { v, p: presence 0..1, s: level continuum 0..V_MAX - 1 }.
 * v = 1 / 2 / 3 give p = 1 and s = 0 / 1 / 2 exactly (the old levels 1 / 2 / 3 at i 0.5); 0 < v < 1 is the level-1 look faded in.
 */
export function strength(v) {
  const x = Number.isFinite(v) ? Math.min(V_MAX, Math.max(0, v)) : 0;
  return { v: x, p: Math.min(1, x), s: Math.max(0, x - 1) };
}
/** A v1 (level, fine intensity i) as a strength: level + (i - 0.5) x FINE, clamped (lossless: level 3 at i 1 is V_MAX). */
export const legacyV = (level, i = 0.5) => cleanV(numOf(level) + (num(i, 0, 1, 0.5) - 0.5) * FINE, 2);
/** (v1) the level continuum of a (level, i): kept for old callers; new code reads strength(v).s. */
export const levelS = (level, i = 0.5) => legacyV(level, i) - 1;
/** A strength capped by a client's detail setting (cap 1..3: the old `s <= cap - 1 + 0.35`). */
export const capV = (v, cap = 3) => Math.min(v, cap + 0.35);
/** A resolved fx map capped for a client: { eff: { v, p, s } } with every v <= cap + 0.35 (cap 3: unchanged). */
export function capFx(fx, cap = 3) {
  const out = {};
  // (s as the old clamp computed it, so a capped level is bit-identical to before)
  for ( const [e, f] of Object.entries(fx ?? {}) ) out[e] = f.v > cap + 0.35 ? { v: capV(f.v, cap), p: f.p, s: Math.min(f.s, cap - 1 + 0.35) } : f;
  return out;
}

export function cleanWind(w, d = WIND_DEFAULT) {
  return { dir: Math.round(((num(w?.dir, -1e6, 1e6, d.dir) % 360) + 360) % 360), str: num(w?.str, 0, 1, d.str), gust: num(w?.gust, 0, 1, d.gust) };
}

/**
 * One stored effect strength from any of its forms: a number (v2 v; in v1 a number already meant "level n at i 0.5", the same v),
 * { v } (a resolved state), { l | level, i } (a v1 key), { p, s } (a v1 base: v = s + 1 at full presence, else the presence).
 */
function fxV(f) {
  if ( typeof f === "number" || typeof f === "string" ) return cleanV(f, 0);
  if ( !f || typeof f !== "object" ) return 0;
  if ( "v" in f ) return cleanV(f.v, 0);
  if ( "l" in f || "level" in f ) return legacyV(f.l ?? f.level, f.i);
  if ( "p" in f ) { const p = num(f.p, 0, 1, 0); return cleanV(p >= 0.999 ? num(f.s, -0.35, V_MAX - 1, 1) + 1 : p, 0); }
  return 0;
}
/** An fx map, cleaned: { eff: v } for known effects with v > 0. */
function cleanFx(fx) {
  const out = {};
  for ( const e of EFFECTS ) {
    const f = fx?.[e]; if ( f === undefined || f === null || f === false ) continue;
    const v = fxV(f); if ( v > 0 ) out[e] = v;
  }
  return out;
}

/** The effects of a preset at a strength (v1 callers may still pass a fine intensity i: folded in). */
export function presetFx(preset, level = 2, i) {
  const p = PRESETS[preset]; if ( !p ) return {};
  const v = i === undefined ? cleanV(level, 2) : legacyV(level, i);
  return cleanFx(Object.fromEntries(Object.entries(p).map(([e, l]) => [e, l ?? v])));
}

export function cleanKey(k) {
  if ( !k || typeof k !== "object" || !Number.isFinite(Number(k.t)) ) return null;
  const preset = typeof k.preset === "string" && k.preset in PRESETS ? k.preset : "custom";
  // (v1: an int level and a fine intensity i, folded into one strength; v2 keys carry no i)
  const level = k.i === undefined ? cleanV(k.level, 2) : legacyV(k.level, k.i);
  const fx = k.fx ? cleanFx(k.fx) : presetFx(preset, level);
  return { t: Math.round(Number(k.t)), dur: Math.round(num(k.dur, ...LIMITS.dur, DEFAULT_DUR)), preset, level, fx, wind: cleanWind(k.wind) };
}

function cleanBase(b) {
  if ( !b || typeof b !== "object" || !Number.isFinite(Number(b.t)) ) return null;
  const fx = cleanFx(b.fx);
  const d = Array.isArray(b.drift) && b.drift.length === 2 && b.drift.every((v) => Number.isFinite(Number(v))) ? [Number(b.drift[0]), Number(b.drift[1])] : null;
  return { t: Math.round(Number(b.t)), fx, wind: cleanWind(b.wind), wet: num(b.wet, 0, 1.2, 0), cover: num(b.cover, 0, 1.2, 0), ...(d ? { drift: d } : {}) };
}
/** The lens's level: "auto" (follows each effect's strength) or a fixed strength 0..V_MAX (v1 ints 1..3 are valid strengths). */
const cleanLensLevel = (l) => l === "auto" || l === undefined || !Number.isFinite(numOf(l)) ? "auto" : cleanV(l);

export function cleanParams(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const keys = (Array.isArray(r.keys) ? r.keys : []).map(cleanKey).filter(Boolean).sort((a, b) => a.t - b.t).slice(-KEEP_KEYS);
  const g = r.ground ?? {}, l = r.lens ?? {};
  return {
    v: VERSION, on: r.on !== false, who: r.who === "gm" ? "gm" : "all", seed: Math.round(num(r.seed, 0, 1e6, 1)) || 1,
    keys, base: cleanBase(r.base),
    ground: { wetRate: num(g.wetRate, ...LIMITS.wetRate, GROUND_DEFAULT.wetRate), dryRate: num(g.dryRate, ...LIMITS.dryRate, GROUND_DEFAULT.dryRate), puddles: g.puddles !== false,
      snowRate: num(g.snowRate, ...LIMITS.snowRate, GROUND_DEFAULT.snowRate), meltRate: num(g.meltRate, ...LIMITS.meltRate, GROUND_DEFAULT.meltRate) },
    lens: { on: l.on !== false, level: cleanLensLevel(l.level), strength: num(l.strength, 0, 1, LENS_DEFAULT.strength), heat: l.heat === true },
    tornadoes: cleanTornadoes(r.tornadoes),
    fire: { out: r.fire?.out === true },
    clouds: cleanClouds(r.clouds),
    // (the rain's lightning, storm-model.mjs: only once the GM has set it, so a scene that never did keeps its flag as it was)
    ...(r.storm && typeof r.storm === "object" ? { storm: cleanStorm(r.storm) } : {})
  };
}

const msT = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
export function cleanClouds(c) {
  const o = c && typeof c === "object" ? c : {};
  return { mode: CLOUD_MODES.includes(o.mode) ? o.mode : CLOUDS_DEFAULT.mode, modeT: msT(o.modeT), rays: o.rays !== false, raysT: msT(o.raysT) };
}
/** A switch's weight at `now` (0..1, smooth): on = the switched-to state, fading from its shared time t over CLOUD_FADE. */
export function cloudSwitch(on, t, now) {
  const x = Math.min(1, Math.max(0, (now - t) / CLOUD_FADE)), f = x * x * (3 - 2 * x);
  return on ? f : 1 - f;
}

/* ---------------------------------------------------------------- level tables (research 3.3 / 4.4) */

/** Gate tables per effect: [level 1, level 2, level 3]. DENS keys scale x (1 + s) below level 1 and x (1 + s - 2) above level 3. */
export const TABLES = {
  rain: {
    mid: [14, 70, 150], far: [34, 60, 110], near: [0, 0, 4],                    // drops per 64 x 64 art px
    vMid: [150, 225, 235], vFar: [120, 165, 170],                              // fall speed, art px / s
    exp: [0.55, 1, 1],                                                          // streak length (exposure) factor
    crown: [0, 1, 1], ripple: [0.12, 0.4, 0.5],                                 // splash crowns on / ripples on water hits
    wet: [0.3, 0.65, 1.0], puddle: [1.4, 0.68, 0.6], sheen: [0.0022, 0.003, 0.004],
    lens: { bead: [0.2, 0.55, 1], big: [3.4, 4.4, 5.2], run: [0.2, 0.65, 1.25], mist: [0, 0.012, 0.035], film: [0, 0.45, 1] },
    fireDim: [0.3, 0.55, 0.8], steam: [0.4, 0.7, 1], fireOut: [90, 45, 20]          // fire under it: damping, steam, s to put out (opt-in)
  },
  snow: {
    mid: [5, 20, 40], far: [4, 16, 34], near: [0, 0, 2],                        // flakes per 64 x 64 art px
    vMid: [22, 27, 30], vFar: [16, 19, 20],                                     // fall speed, art px / s
    cover: [0, 0.10, 0.42],                                                     // the share of the land snow settles on (accumulated)
    thick: [0, 0, 1],                                                           // 0 a thin dusting (the map shows through), 1 the full ramp
    cold: [0.12, 0.55, 1], drift: [0, 0, 1],                                    // cold overcast tint; spindrift runs in gusts
    lens: { frost: [0.075, 0.13, 0.20], wob: [0.012, 0.02, 0.03], crystals: [6, 16, 34] },
    fireDim: [0.12, 0.25, 0.4], steam: [0.2, 0.4, 0.6]                             // fire under it: damping, steam (it never puts fire out)
  },
  sand: {
    grit: [16, 34, 60], hop: [3.5, 3.5, 7], len: [1.5, 1.5, 3],                 // grit per 64 x 64; saltation hop; streak growth in a wave
    rib: [0.80, 0.78, 0.75], ribK: [0.05, 0.08, 0.12],                          // ground streamers: threshold, the wave's push
    drift: [0.05, 0.12, 0.18],                                                  // settled sand in the lee: share of the land
    haze: [0, 1, 1], hazeD: [0, 0.62, 1], hazeL3: [0, 0, 1],                    // the haze pass: on, density, 3-band look (lit / shadow)
    ochre: [0.18, 0.55, 1],
    lens: { deposit: [0.30, 0.65, 1], scratch: [8, 22, 40], impacts: [30, 100, 220] }
  },
  dust: {
    motes: [10, 26, 52], shaft: [0, 0.8, 1], haze: [0, 0, 1], warm: [0.25, 0.6, 1],
    lens: { specks: [0.35, 0.65, 1.01], discs: [6, 14, 26], glare: [0.45, 0.7, 1], ghosts: [0, 3, 5], ghostK: [0, 0.09, 0.14], smudge: [0, 1, 1] }
  },
  embers: {
    spark: [1.8, 6, 18], big: [0, 1, 1],                                        // spark slots per 64 x 64 (wind-borne, gated by swarms); 2-px big sparks
    swarm: [0.15, 0.3, 0.45],                                                   // the swarm floor: share of sparks that fly outside the gust swarms
    smoke: [0, 1, 1], smokeL3: [0, 0, 1], dim: [0.15, 0.6, 1],                  // smoke haze on, its 2-band look; the dim, warm evening
    lens: { glow: [0.4, 0.7, 1], flecks: [5, 10, 18] }
  },
  wind: {                                                                       // visible wind (no lens part: air is invisible on glass)
    spd: [0.55, 0.8, 1],                                                        // everything carried slower in a breeze
    lines: [1.3, 3.6, 7.1], lineGate: [0.12, 0.04, 0], lineLen: [0.75, 1, 1],   // wind lines per 64 x 64, extra gust gate, length
    debris: [0.6, 3.2, 7.7], bob: [2.5, 3.5, 6],                                // leaves and bits per 64 x 64, their bounce (art px)
    comb: [0.80, 0.72, 0.66],                                                   // grass combing: threshold (lower = more combed)
    ruffle: [0.35, 0.65, 1],                                                    // cat's paws and glints on water
    cloud: [0, 0.6, 1], dim: [1, 0.985, 0.97],                                  // cloud shadows (share of the full look); overall dim
    haze: [0, 0, 0.5]                                                           // blown dust drifting along the wind
  },
  clouds: {                                                                     // the cloud layer (clouds.mjs): scattered, broken, overcast
    cover: [0.30, 0.56, 0.86],                                                  // the share of the sky covered (the field's quantile)
    body: [0.92, 0.86, 0.68],                                                   // a thick cloud's opacity (overcast: a thinner sheet, the map stays readable)
    shade: [0.36, 0.36, 0.30],                                                  // how much a cloud's shadow darkens the ground
    rays: [0.75, 1, 1]                                                          // godrays through the gaps
  }
};
/** The wind's cloud shadows as cover of the one cloud field (shadows only, no bodies): its TABLES.wind.cloud share x this. */
export const WIND_CLOUD_COVER = 0.32;
const DENS = new Set(["mid", "far", "near", "bead", "grit", "motes", "spark", "crystals", "impacts", "flecks", "lines", "debris"]);

/** One gate at level-continuum s: piecewise linear through the table at s = 0, 1, 2. */
export function gate(table, s, dens = false) {
  const [a, b, c] = table;
  if ( s <= 0 ) return dens ? Math.max(0, a * (1 + s)) : a;
  if ( s >= 2 ) return dens ? c * (1 + (s - 2)) : c;
  return s < 1 ? a + (b - a) * s : b + (c - b) * (s - 1);
}
/**
 * RAIN AND SNOW OVER FIRE (research D9, visual by default): { dim 0..1 (lower, fewer tongues, weaker light), steam 0..1, outAfter
 * (s of this rain that put a fire out; Infinity when it never does) } for a resolved state - the strongest of rain and snow, by
 * their presence and level, so it follows every transition smoothly.
 */
export function fireWet(st) {
  let dim = 0, steam = 0, outAfter = Infinity;
  for ( const e of ["rain", "snow"] ) {
    const f = st?.fx?.[e]; if ( !f || !(f.p > 0) ) continue;
    const T = TABLES[e], s = Math.max(0, Math.min(2, f.s));
    dim = Math.max(dim, f.p * gate(T.fireDim, s)); steam = Math.max(steam, f.p * gate(T.steam, s));
    if ( T.fireOut && f.p >= 0.5 ) outAfter = Math.min(outAfter, gate(T.fireOut, s));
  }
  return { dim, steam, outAfter };
}
/** All gates of an effect at s: { name: value }. */
export function gates(effect, s) {
  const T = TABLES[effect] ?? {}, out = {};
  for ( const [k, v] of Object.entries(T) ) if ( Array.isArray(v) ) out[k] = gate(v, s, DENS.has(k));
  return out;
}
export function lensGates(effect, s) {
  const T = TABLES[effect]?.lens ?? {}, out = {};
  for ( const [k, v] of Object.entries(T) ) out[k] = gate(v, s, DENS.has(k));
  return out;
}
/** The wet ceiling of rain at s (0..~1.1). */
export const wetCeil = (s) => gate(TABLES.rain.wet, s);

/* ---------------------------------------------------------------- the timeline */

const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const angLerp = (a, b, f) => { const d = ((b - a + 540) % 360) - 180; return ((a + d * f) % 360 + 360) % 360; };

/** The strengths a key aims at: { fx: { eff: v }, wind }. */
const target = (k) => ({ fx: k.fx, wind: k.wind });
const EMPTY = { fx: {}, wind: { ...WIND_DEFAULT } };

/**
 * Blend state `a` toward the target `b` by f (0..1): each effect's STRENGTH v is lerped (missing on one side = 0), so an effect
 * fading out eases down through the levels (3 -> 2 -> 1) and then thins out, and one fading in rises through them; the ramp passes
 * through exactly the states the slider would show. At f = 1 it is exactly b (bit for bit).
 */
function blend(a, b, f) {
  const fx = {};
  for ( const e of new Set([...Object.keys(a.fx), ...Object.keys(b.fx)]) ) {
    const x = a.fx[e] ?? 0, y = b.fx[e] ?? 0, v = f >= 1 ? y : f <= 0 ? x : x + (y - x) * f;
    if ( v > 0 ) fx[e] = v;
  }
  const w = { dir: angLerp(a.wind.dir, b.wind.dir, a.wind.str > 0.001 ? f : 1), str: a.wind.str + (b.wind.str - a.wind.str) * f, gust: a.wind.gust + (b.wind.gust - a.wind.gust) * f };
  return { fx, wind: w };
}

/**
 * The start states of the keys: starts[n] = the state when key n begins (the previous key's ramp evaluated at that moment).
 * Pure in (P.base, P.keys). States here carry strengths: { fx: { eff: v }, wind }.
 */
function starts(P) {
  const out = [];
  let from = P.base ? { fx: P.base.fx, wind: P.base.wind } : EMPTY;
  for ( let n = 0; n < P.keys.length; n++ ) {
    if ( n > 0 ) { const k = P.keys[n - 1]; from = blend(out[n - 1], target(k), k.dur > 0 ? smooth((P.keys[n].t - k.t) / k.dur) : 1); }
    out.push(from);
  }
  return out;
}

/** The strengths at shared time `now`: { fx: { eff: v }, wind } (internal; stateAt adds p and s). */
function stateV(P, now, _starts = starts(P)) {
  let n = -1;
  for ( let k = 0; k < P.keys.length; k++ ) if ( P.keys[k].t <= now ) n = k;
  if ( n < 0 ) return P.base ? { fx: P.base.fx, wind: P.base.wind } : EMPTY;
  const k = P.keys[n];
  return blend(_starts[n], target(k), k.dur > 0 ? smooth((now - k.t) / k.dur) : 1);
}
const derive = (sv) => ({ fx: Object.fromEntries(Object.entries(sv.fx).map(([e, v]) => [e, strength(v)])), wind: sv.wind });

/** The fx / wind state at shared time `now` (ms), without the accumulations: { fx: { eff: { v, p, s } }, wind }. */
export function stateAt(P, now, _starts = starts(P)) {
  return derive(stateV(P, now, _starts));
}

/** The ceilings of the accumulations of a state of strengths (stateV): the rain's wetness, the snow's cover. */
const ACC = {
  wet: { ceil: (st) => { const r = st.fx.rain; if ( !r ) return 0; const f = strength(r); return f.p * wetCeil(f.s); }, up: (P) => P.ground.wetRate, dn: (P) => P.ground.dryRate },
  cover: { ceil: (st) => { const r = st.fx.snow; if ( !r ) return 0; const f = strength(r); return f.p * coverCeil(f.s); }, up: (P) => P.ground.snowRate, dn: (P) => P.ground.meltRate }
};
/** The snow's cover ceiling at s (share of the land). */
export const coverCeil = (s) => gate(TABLES.snow.cover, s);

/**
 * WET GROUND at `now`: from the base's wetness, toward each moment's ceiling (time constant wetRate rising, dryRate falling).
 * Inside a transition the ceiling changes: 1 s steps; between transitions it is constant: closed form. SNOW COVER the same
 * (`kind` "cover": snowRate settling, meltRate melting).
 */
export function wetAt(P, now, _starts = starts(P), kind = "wet") {
  const A = ACC[kind], ceilOf = A.ceil;
  let w = P.base?.[kind] ?? 0, t = P.base?.t ?? (P.keys[0]?.t ?? now);
  const up = A.up(P), dn = A.dn(P);
  const approach = (w, c, dt) => { if ( dt <= 0 ) return w; const tau = c > w ? up : dn; return c + (w - c) * Math.exp(-dt / tau); };
  // segments: [t .. key0.t), then each key's ramp [k.t .. k.t + dur) and its rest [.. next key)
  const marks = [];
  for ( let n = 0; n < P.keys.length; n++ ) { const k = P.keys[n]; marks.push([k.t, false], [k.t + k.dur, true]); }
  marks.sort((a, b) => a[0] - b[0]);
  // (the value at every mark already passed is remembered per stored state: a resolve at 12 Hz only integrates the open segment)
  let memos = WET_MEMO.get(P); if ( !memos ) WET_MEMO.set(P, memos = {});
  const memo = memos[kind] ??= new Map();
  for ( const [m] of marks ) if ( m <= now && memo.has(m) && m > t ) { t = m; w = memo.get(m); }
  marks.push([now, false]);
  marks.sort((a, b) => a[0] - b[0]);
  for ( const [m] of marks ) {
    const end = Math.min(m, now);
    if ( end <= t ) continue;
    // inside a ramp (the state changes between t and end)? step it; else closed form at the segment's (constant) ceiling
    const cA = ceilOf(stateV(P, t + 1, _starts)), cB = ceilOf(stateV(P, end - 1, _starts));
    if ( Math.abs(cA - cB) < 1e-4 ) w = approach(w, cB, (end - t) / 1000);
    else {
      const steps = Math.min(1200, Math.ceil((end - t) / 1000)), dt = (end - t) / steps;
      for ( let i = 0; i < steps; i++ ) w = approach(w, ceilOf(stateV(P, t + (i + 0.5) * dt, _starts)), dt / 1000);
    }
    t = end;
    if ( end === m && m < now ) memo.set(m, w);
    if ( t >= now ) break;
  }
  return w;
}
const WET_MEMO = new WeakMap();

/**
 * THE RESOLVED STATE at shared time `now` (ms): { fx: { eff: { v, p, s } }, wind, wet, cover, steady (no ramp running), until (ms of
 * the end of the running ramp, or null), key (the newest started key) }. Effects below V_OFF are dropped. Every consumer reads p
 * and s as before; v is the strength they come from.
 */
export function resolve(P, now) {
  const st = starts(P), sv = stateV(P, now, st);
  let n = -1;
  for ( let k = 0; k < P.keys.length; k++ ) if ( P.keys[k].t <= now ) n = k;
  const key = n >= 0 ? P.keys[n] : null, nextKey = P.keys[n + 1] ?? null;
  const until = key && now < key.t + key.dur ? key.t + key.dur : nextKey ? nextKey.t : null;
  const fx = {};
  for ( const [e, v] of Object.entries(sv.fx) ) if ( v >= V_OFF ) fx[e] = strength(v);
  return { fx, wind: sv.wind, wet: wetAt(P, now, st), cover: wetAt(P, now, st, "cover"), steady: !(key && now < key.t + key.dur), until, key };
}

/**
 * The effects a preset's strength drives (what the old level buttons and keys 1-3 set): a named preset's own effects (the clouds
 * preset: clouds; clear: none); "custom": every non-cloud effect of `fx`.
 */
export function drivenFx(preset, fx = {}) {
  if ( preset === "custom" ) return Object.keys(fx).filter((e) => e !== "clouds");
  return Object.keys(PRESETS[preset] ?? {});
}
const setKey = (fx) => Object.keys(fx).filter((e) => e !== "clouds").sort().join();
const PRESET_SETS = Object.entries(PRESETS).filter(([n]) => n !== "clear" && n !== "clouds").map(([n, p]) => [setKey(p), n]);
/**
 * The preset an fx set shows as (the pressed preset button): the preset whose non-cloud effects are exactly these; none of them:
 * "clouds" when clouds are on, else "clear"; no preset has this set: "custom". The strengths do not matter.
 */
export function presetOf(fx) {
  const k = setKey(fx ?? {});
  if ( !k ) return fx?.clouds ? "clouds" : "clear";
  return PRESET_SETS.find(([s]) => s === k)?.[1] ?? "custom";
}

/**
 * A NEW KEY appended (the GM's change): returns the new { keys, base } (the oldest keys folded into the base when there are more
 * than KEEP_KEYS). What is not given is kept from the newest key. `change`:
 *   { preset, level? }  the preset's effects at strength `level` (default: the newest key's level, else 2); other non-cloud effects
 *                       dropped; clouds kept, except by "clear" (clear sky clears them) and by the clouds preset (its own strength).
 *                       preset "custom": the newest key's effects (with `fx`: exactly `fx`, nothing kept).
 *   { level }           every effect the current preset drives (drivenFx) set to `level`; 0 removes them (clouds kept).
 *   { fx: { eff: v } }  a PATCH on the newest key's effects (or on the preset's, with `preset`): v 0 removes eff.
 *   { clouds: v }       sugar for { fx: { clouds: v } }.
 *   { wind }            the wind (a partial { dir, str, gust }).
 *   v1 callers: `i` (fine intensity 0..1) folds into the level: level + (i - 0.5) x 0.7; `i` alone uses the newest key's level
 *   rounded to 1..3 as that level.
 * The key's `preset` is then presetOf(fx) (a patch that leaves a preset's set of effects keeps its name; else "custom"), and its
 * `level` (the preset strength, carried to the next preset click) is the given level when > 0 (0: the newest key's is kept), else
 * the one strength all of the preset's driven effects share, else the newest key's.
 */
export function withKey(P, change, now, { dur = DEFAULT_DUR, lead = LEAD_MS } = {}) {
  const last = current(P), lastFx = last?.fx ?? {}, lastLevel = last && last.level > 0 ? last.level : 2;
  const named = typeof change.preset === "string" && (change.preset in PRESETS || change.preset === "custom") ? change.preset : null;
  const lv = change.i !== undefined ? legacyV(change.level ?? Math.min(3, Math.max(1, Math.round(lastLevel))), change.i)
    : change.level !== undefined ? cleanV(change.level, lastLevel) : undefined;
  let fx;
  if ( named === "custom" ) fx = change.fx ? {} : { ...lastFx };
  else if ( named ) {
    fx = presetFx(named, lv ?? lastLevel);
    // CLOUDS are a layer of their own: a preset keeps them (clear sky clears them; the clouds preset sets its own)
    if ( named !== "clear" && !("clouds" in PRESETS[named]) && lastFx.clouds ) fx.clouds = lastFx.clouds;
  } else {
    fx = { ...lastFx };
    if ( lv !== undefined ) for ( const e of drivenFx(last?.preset ?? "clear", lastFx) ) { if ( lv > 0 ) fx[e] = lv; else delete fx[e]; }
  }
  const patch = { ...(change.fx ?? {}), ...(change.clouds !== undefined ? { clouds: change.clouds } : {}) };
  for ( const [e, f] of Object.entries(patch) ) { if ( !EFFECTS.includes(e) ) continue; const v = fxV(f); if ( v > 0 ) fx[e] = v; else delete fx[e]; }
  const preset = presetOf(fx);
  const vs = drivenFx(preset, fx).map((e) => fx[e]);
  const level = lv > 0 ? lv : lv === 0 ? lastLevel : vs.length && vs.every((v) => v === vs[0]) ? vs[0] : lastLevel;
  const wind = cleanWind({ ...(last?.wind ?? WIND_DEFAULT), ...(change.wind ?? {}) });
  const t = Math.round(now + lead);
  // keys that start after the new one are dropped (the newest change wins)
  let keys = P.keys.filter((k) => k.t < t);
  keys.push(cleanKey({ t, dur, preset, level, fx, wind }));
  let base = P.base;
  if ( keys.length > KEEP_KEYS ) {
    const drop = keys.length - KEEP_KEYS, at = keys[drop].t, Pt = { ...P, keys: P.keys.filter((k) => k.t < t) };
    const s = stateV(Pt, at);
    base = { t: at, fx: Object.fromEntries(Object.entries(s.fx).map(([e, v]) => [e, +v.toFixed(4)])), wind: s.wind, wet: +wetAt(Pt, at).toFixed(4), cover: +wetAt(Pt, at, undefined, "cover").toFixed(4),
      drift: cloudDrift(Pt, at) };
    keys = keys.slice(drop);
  }
  return { keys, base };
}

/** The newest key (for the UI: its preset, its level = the preset strength, its fx = each effect's strength v). */
export function current(P) { return P.keys[P.keys.length - 1] ?? null; }

/**
 * The lens level continuum for an effect at s, capped by the player's setting (cap 1..3): lens.level "auto" follows the effect's s;
 * a fixed lens strength v gives strength(v).s (its presence is lensP).
 */
export function lensS(P, s, cap = 3) {
  const want = P.lens.level === "auto" ? s : strength(P.lens.level).s;
  return Math.min(want, cap - 1 + 0.35);
}
/** The lens's own presence factor: 1 for "auto"; a fixed lens strength below 1 fades the level-1 lens in (strength(v).p). */
export function lensP(P) { return P.lens.level === "auto" ? 1 : strength(P.lens.level).p; }

/** The levels table of a preset, for UIs and generators: [{ level, effects: { eff: gates } }]. */
export function levels(preset) {
  return [1, 2, 3].map((level) => ({ level, effects: Object.fromEntries(Object.keys(presetFx(preset, level)).map((e) => [e, gates(e, level - 1)])) }));
}

/* ---------------------------------------------------------------- the cloud drift */

/** Clouds drift with the scene wind at this share of its speed, at least a light breeze (as wind str). */
export const CLOUD_SPEED = 0.55, CLOUD_BREEZE = 0.35;
/** The clouds' velocity (squares / s) in a state. */
export function cloudVel(st) {
  const w = st.wind ?? WIND_DEFAULT, v = Math.max(w.str ?? 0, CLOUD_BREEZE) * SPEED_SQ * CLOUD_SPEED, d = dirVec(w.dir ?? 0);
  return [d[0] * v, d[1] * v];
}
const DRIFT_MEMO = new WeakMap();
/**
 * THE CLOUD DRIFT at shared ms `now`: how far (squares) the cloud field has moved, the wind's velocity integrated along the timeline
 * from the base (its stored drift; or from shared time 0) - so the clouds follow every change of the wind smoothly, never loop and
 * never jump, and every client computes the same. Between ramps the velocity is constant (closed form); inside a ramp Simpson's rule
 * with a fixed 32 steps (a smooth function of `now`). Folding keys into the base stores the drift there (continuous).
 */
export function cloudDrift(P, now, _starts = starts(P)) {
  let x = P.base?.drift?.[0] ?? 0, y = P.base?.drift?.[1] ?? 0, t = P.base?.t ?? 0;
  if ( now <= t ) { const v = cloudVel(stateV(P, now, _starts)); return [x - v[0] * (t - now) / 1000, y - v[1] * (t - now) / 1000]; }
  const marks = [];
  for ( const k of P.keys ) marks.push(k.t, k.t + k.dur);
  const ms = [...new Set(marks)].filter((m) => m > t).sort((a, b) => a - b);
  let memo = DRIFT_MEMO.get(P); if ( !memo ) DRIFT_MEMO.set(P, memo = new Map());
  for ( const m of ms ) if ( m <= now && memo.has(m) ) { t = m; [x, y] = memo.get(m); }
  const seg = (a, b) => {
    const va = cloudVel(stateV(P, a + 0.5, _starts)), vb = cloudVel(stateV(P, b - 0.5, _starts));
    if ( Math.abs(va[0] - vb[0]) + Math.abs(va[1] - vb[1]) < 1e-9 ) { const dt = (b - a) / 1000; return [va[0] * dt, va[1] * dt]; }
    const N = 32, h = (b - a) / N; let sx = 0, sy = 0;
    for ( let i = 0; i <= N; i++ ) {
      const w = i === 0 || i === N ? 1 : i % 2 ? 4 : 2, v = cloudVel(stateV(P, Math.min(b - 0.5, Math.max(a + 0.5, a + i * h)), _starts));
      sx += w * v[0]; sy += w * v[1];
    }
    return [sx * h / 3000, sy * h / 3000];
  };
  for ( const m of [...ms, Infinity] ) {
    const end = Math.min(m, now);
    if ( end <= t ) continue;
    const d = seg(t, end); x += d[0]; y += d[1]; t = end;
    if ( end === m && m < now ) memo.set(m, [x, y]);
    if ( t >= now ) break;
  }
  return [x, y];
}
