/**
 * WEATHER, the pure model (no Foundry, no PIXI: node-tested in dev/weather-model.test.mjs).
 *
 * THE STORED STATE is one scene flag, `flags.moinen-maps.weather`, written by the GM only; nothing is sent per frame:
 *   { v, on, who: "all" | "gm", seed,
 *     keys: [ { t: shared ms, dur: ms, preset, level 1..3, i 0..1, fx: { rain: { l, i }, ... }, wind: { dir, str, gust } } ],  (the timeline)
 *     base: { t, fx: { eff: { p, s } }, wind, wet },     (the state the oldest kept key starts from: older keys are folded into it)
 *     ground: { wetRate, dryRate, puddles },             (seconds to wet / dry the ground; puddles on / off)
 *     lens: { on, level: "auto" | 1 | 2 | 3, strength } }
 *
 * THE STATE AT A MOMENT is a pure function of the flag and the shared clock (`resolve`): every key cross-fades from the state at its
 * start to its target along a smoothstep over its `dur`, so a change of preset, level or wind is a smooth ramp, never a cut, and a
 * client that joins late computes the same thing. Each effect carries
 *   p  its presence 0..1 (fading in / out), and
 *   s  its LEVEL as one continuous value, s = level - 1 + (i - 0.5) x 0.7 (about -0.35 .. 2.35);
 * every gate of the look (slot densities, splash crowns, wet tint, puddle threshold ...) is a piecewise-linear function of s through
 * the research's level tables at s = 0, 1, 2 (`gate`), so moving between levels never pops.
 * WET GROUND (and SNOW COVER) accumulates: it rises toward the rain's ceiling (30 / 65 / 100 % of the full wet tint at levels 1 / 2 / 3) with time
 * constant wetRate and dries with dryRate, integrated in closed form between transitions (1 s steps inside them): deterministic.
 */
import { WIND_DEFAULT } from "../wind.mjs";

export const FLAG = "weather";
export const VERSION = 1;
export const KEEP_KEYS = 8;
export const LEAD_MS = 300;             // a change starts this far ahead, so every client starts it on the same frame
export const DEFAULT_DUR = 20000;       // ms
export const MIN_DUR = 0;

/** The effects drawn by this build, in draw order. */
export const EFFECTS = ["rain", "snow", "sand", "dust", "embers", "wind"];
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
  blizzard: { snow: null, wind: null }
};
export const PRESET_ICONS = { clear: "fa-solid fa-sun", rain: "fa-solid fa-cloud-rain", snow: "fa-solid fa-snowflake", sand: "fa-solid fa-wind",
  dust: "fa-solid fa-sun-haze", embers: "fa-solid fa-fire-flame-curved", wind: "fa-solid fa-leaf", storm: "fa-solid fa-cloud-showers-heavy",
  blizzard: "fa-solid fa-icicles" };

export const LIMITS = { wetRate: [5, 600], dryRate: [10, 3600], snowRate: [5, 1800], meltRate: [10, 7200], strength: [0, 1], str: [0, 1], gust: [0, 1], dur: [0, 600000] };
export const GROUND_DEFAULT = { wetRate: 60, dryRate: 300, puddles: true, snowRate: 120, meltRate: 600 };
export const LENS_DEFAULT = { on: true, level: "auto", strength: 1, heat: false };

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const lvl = (v, d = 2) => { const n = Math.round(Number(v)); return n >= 1 && n <= 3 ? n : d; };
export const levelS = (level, i = 0.5) => lvl(level) - 1 + (num(i, 0, 1, 0.5) - 0.5) * 0.7;

export function cleanWind(w, d = WIND_DEFAULT) {
  return { dir: Math.round(((num(w?.dir, -1e6, 1e6, d.dir) % 360) + 360) % 360), str: num(w?.str, 0, 1, d.str), gust: num(w?.gust, 0, 1, d.gust) };
}

/** A key's effects: { eff: { l, i } } for known effects. */
function cleanFx(fx) {
  const out = {};
  for ( const e of EFFECTS ) {
    const f = fx?.[e]; if ( f === undefined || f === null || f === false ) continue;
    out[e] = typeof f === "number" ? { l: lvl(f), i: 0.5 } : { l: lvl(f.l ?? f.level), i: num(f.i, 0, 1, 0.5) };
  }
  return out;
}

/** The effects of a preset at a level and fine intensity. */
export function presetFx(preset, level = 2, i = 0.5) {
  const p = PRESETS[preset]; if ( !p ) return {};
  return cleanFx(Object.fromEntries(Object.entries(p).map(([e, l]) => [e, { l: l ?? level, i }])));
}

export function cleanKey(k) {
  if ( !k || typeof k !== "object" || !Number.isFinite(Number(k.t)) ) return null;
  const preset = typeof k.preset === "string" && k.preset in PRESETS ? k.preset : "custom";
  const level = lvl(k.level), i = num(k.i, 0, 1, 0.5);
  const fx = k.fx ? cleanFx(k.fx) : presetFx(preset, level, i);
  return { t: Math.round(Number(k.t)), dur: Math.round(num(k.dur, ...LIMITS.dur, DEFAULT_DUR)), preset, level, i, fx, wind: cleanWind(k.wind) };
}

function cleanBase(b) {
  if ( !b || typeof b !== "object" || !Number.isFinite(Number(b.t)) ) return null;
  const fx = {};
  for ( const e of EFFECTS ) { const f = b.fx?.[e]; if ( f ) fx[e] = { p: num(f.p, 0, 1, 0), s: num(f.s, -0.35, 2.35, 1) }; }
  return { t: Math.round(Number(b.t)), fx, wind: cleanWind(b.wind), wet: num(b.wet, 0, 1.2, 0), cover: num(b.cover, 0, 1.2, 0) };
}

export function cleanParams(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const keys = (Array.isArray(r.keys) ? r.keys : []).map(cleanKey).filter(Boolean).sort((a, b) => a.t - b.t).slice(-KEEP_KEYS);
  const g = r.ground ?? {}, l = r.lens ?? {};
  return {
    v: VERSION, on: r.on !== false, who: r.who === "gm" ? "gm" : "all", seed: Math.round(num(r.seed, 0, 1e6, 1)) || 1,
    keys, base: cleanBase(r.base),
    ground: { wetRate: num(g.wetRate, ...LIMITS.wetRate, GROUND_DEFAULT.wetRate), dryRate: num(g.dryRate, ...LIMITS.dryRate, GROUND_DEFAULT.dryRate), puddles: g.puddles !== false,
      snowRate: num(g.snowRate, ...LIMITS.snowRate, GROUND_DEFAULT.snowRate), meltRate: num(g.meltRate, ...LIMITS.meltRate, GROUND_DEFAULT.meltRate) },
    lens: { on: l.on !== false, level: l.level === "auto" || l.level === undefined ? "auto" : lvl(l.level), strength: num(l.strength, 0, 1, LENS_DEFAULT.strength), heat: l.heat === true }
  };
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
    lens: { bead: [0.2, 0.55, 1], big: [3.4, 4.4, 5.2], run: [0.2, 0.65, 1.25], mist: [0, 0.012, 0.035], film: [0, 0.45, 1] }
  },
  snow: {
    mid: [5, 20, 40], far: [4, 16, 34], near: [0, 0, 2],                        // flakes per 64 x 64 art px
    vMid: [22, 27, 30], vFar: [16, 19, 20],                                     // fall speed, art px / s
    cover: [0, 0.10, 0.42],                                                     // the share of the land snow settles on (accumulated)
    thick: [0, 0, 1],                                                           // 0 a thin dusting (the map shows through), 1 the full ramp
    cold: [0.12, 0.55, 1], drift: [0, 0, 1],                                    // cold overcast tint; spindrift runs in gusts
    lens: { frost: [0.075, 0.13, 0.20], wob: [0.012, 0.02, 0.03], crystals: [6, 16, 34] }
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
  }
};
const DENS = new Set(["mid", "far", "near", "bead", "grit", "motes", "spark", "crystals", "impacts", "flecks", "lines", "debris"]);

/** One gate at level-continuum s: piecewise linear through the table at s = 0, 1, 2. */
export function gate(table, s, dens = false) {
  const [a, b, c] = table;
  if ( s <= 0 ) return dens ? Math.max(0, a * (1 + s)) : a;
  if ( s >= 2 ) return dens ? c * (1 + (s - 2)) : c;
  return s < 1 ? a + (b - a) * s : b + (c - b) * (s - 1);
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

/** The state a key aims at. */
const target = (k) => ({ fx: Object.fromEntries(Object.entries(k.fx).map(([e, f]) => [e, { p: 1, s: levelS(f.l, f.i) }])), wind: k.wind });
const EMPTY = { fx: {}, wind: { ...WIND_DEFAULT } };

/** Blend state `a` toward the target `b` by f (0..1). An effect only in `a` fades out at its own level; only in `b` fades in at b's. */
function blend(a, b, f) {
  const fx = {};
  for ( const e of new Set([...Object.keys(a.fx), ...Object.keys(b.fx)]) ) {
    const x = a.fx[e], y = b.fx[e];
    if ( x && y ) fx[e] = { p: x.p + (1 - x.p) * f, s: x.p > 0.001 ? x.s + (y.s - x.s) * f : y.s };
    else if ( x ) { const p = x.p * (1 - f); if ( p > 0 || f < 1 ) fx[e] = { p, s: x.s }; }
    else fx[e] = { p: f, s: y.s };
  }
  const w = { dir: angLerp(a.wind.dir, b.wind.dir, a.wind.str > 0.001 ? f : 1), str: a.wind.str + (b.wind.str - a.wind.str) * f, gust: a.wind.gust + (b.wind.gust - a.wind.gust) * f };
  return { fx, wind: w };
}

/**
 * The start states of the keys: starts[n] = the state when key n begins (the previous key's ramp evaluated at that moment).
 * Pure in (P.base, P.keys).
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

/** The fx / wind state at shared time `now` (ms), without the accumulations. */
export function stateAt(P, now, _starts = starts(P)) {
  let n = -1;
  for ( let k = 0; k < P.keys.length; k++ ) if ( P.keys[k].t <= now ) n = k;
  if ( n < 0 ) return P.base ? { fx: P.base.fx, wind: P.base.wind } : EMPTY;
  const k = P.keys[n];
  return blend(_starts[n], target(k), k.dur > 0 ? smooth((now - k.t) / k.dur) : 1);
}

/** The ceilings of the accumulations of a state: the rain's wetness, the snow's cover. */
const ACC = {
  wet: { ceil: (st) => { const r = st.fx.rain; return r ? r.p * wetCeil(r.s) : 0; }, up: (P) => P.ground.wetRate, dn: (P) => P.ground.dryRate },
  cover: { ceil: (st) => { const r = st.fx.snow; return r ? r.p * coverCeil(r.s) : 0; }, up: (P) => P.ground.snowRate, dn: (P) => P.ground.meltRate }
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
    const cA = ceilOf(stateAt(P, t + 1, _starts)), cB = ceilOf(stateAt(P, end - 1, _starts));
    if ( Math.abs(cA - cB) < 1e-4 ) w = approach(w, cB, (end - t) / 1000);
    else {
      const steps = Math.min(1200, Math.ceil((end - t) / 1000)), dt = (end - t) / steps;
      for ( let i = 0; i < steps; i++ ) w = approach(w, ceilOf(stateAt(P, t + (i + 0.5) * dt, _starts)), dt / 1000);
    }
    t = end;
    if ( end === m && m < now ) memo.set(m, w);
    if ( t >= now ) break;
  }
  return w;
}
const WET_MEMO = new WeakMap();

/**
 * THE RESOLVED STATE at shared time `now` (ms): { fx: { eff: { p, s } }, wind, wet, steady (no ramp running), until (ms of the end of
 * the running ramp, or null), key (the newest started key) }.
 */
export function resolve(P, now) {
  const st = starts(P), s = stateAt(P, now, st);
  let n = -1;
  for ( let k = 0; k < P.keys.length; k++ ) if ( P.keys[k].t <= now ) n = k;
  const key = n >= 0 ? P.keys[n] : null, nextKey = P.keys[n + 1] ?? null;
  const until = key && now < key.t + key.dur ? key.t + key.dur : nextKey ? nextKey.t : null;
  const fx = {};
  for ( const [e, f] of Object.entries(s.fx) ) if ( f.p > 0.0005 ) fx[e] = f;
  return { fx, wind: s.wind, wet: wetAt(P, now, st), cover: wetAt(P, now, st, "cover"), steady: !(key && now < key.t + key.dur), until, key };
}

/**
 * A NEW KEY appended (the GM's change): returns the new { keys, base } (the oldest keys folded into the base when there are more
 * than KEEP_KEYS). `change` = { preset?, level?, i?, fx?, wind? }: what is not given is kept from the newest key.
 */
export function withKey(P, change, now, { dur = DEFAULT_DUR, lead = LEAD_MS } = {}) {
  const last = P.keys[P.keys.length - 1] ?? null;
  const preset = change.preset ?? last?.preset ?? "clear";
  const level = change.level ?? last?.level ?? 2, i = change.i ?? last?.i ?? 0.5;
  const fx = change.fx ? cleanFx(change.fx) : preset === "custom" && last ? last.fx : presetFx(preset, level, i);
  const wind = cleanWind({ ...(last?.wind ?? WIND_DEFAULT), ...(change.wind ?? {}) });
  const t = Math.round(now + lead);
  // keys that start after the new one are dropped (the newest change wins)
  let keys = P.keys.filter((k) => k.t < t);
  keys.push(cleanKey({ t, dur, preset, level, i, fx, wind }));
  let base = P.base;
  if ( keys.length > KEEP_KEYS ) {
    const drop = keys.length - KEEP_KEYS, at = keys[drop].t, Pt = { ...P, keys: P.keys.filter((k) => k.t < t) };
    const s = stateAt(Pt, at);
    base = { t: at, fx: Object.fromEntries(Object.entries(s.fx).map(([e, f]) => [e, { p: +f.p.toFixed(4), s: +f.s.toFixed(4) }])), wind: s.wind, wet: +wetAt(Pt, at).toFixed(4), cover: +wetAt(Pt, at, undefined, "cover").toFixed(4) };
    keys = keys.slice(drop);
  }
  return { keys, base };
}

/** The level of each effect a GM picked last (for the UI): the newest key's. */
export const current = (P) => P.keys[P.keys.length - 1] ?? null;

/** The lens level to show for an effect at s (lens.level "auto" follows the world level), capped by the player's setting. */
export function lensS(P, s, cap = 3) {
  const want = P.lens.level === "auto" ? s : P.lens.level - 1;
  return Math.min(want, cap - 1 + 0.35);
}

/** The levels table of a preset, for UIs and generators: [{ level, effects: { eff: gates } }]. */
export function levels(preset) {
  return [1, 2, 3].map((level) => ({ level, effects: Object.fromEntries(Object.keys(presetFx(preset, level)).map((e) => [e, gates(e, level - 1)])) }));
}
