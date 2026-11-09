/**
 * DESTRUCTION PRESETS, the pure part (no Foundry, no PIXI: node-tested in dev/presets-core.test.mjs). The design is
 * dev/presets-design.md (P1 of its task split). A preset is DATA (a definition, below) plus this EXPANDER: on the GM, one gesture on the
 * map becomes concrete records for the layers - destruction strokes, fire and smoke strokes - and the parts no layer can play yet
 * (the explosion fire "burst", the dust kinds "shock" / "hits", the accents, the screen and light cues) as PENDING data kept in the
 * firing record for the tasks that add them (P3, P4, P5). Every random choice is made here, from the firing's seed, and stored: a
 * client never decides anything again, so every client shows the same firing.
 *
 * THE DEFINITION (version 1):
 *   { id, v: 1, name, hint (i18n keys), icon, set, gesture: "point" | "throw" | "line" | "run", preroll (ms from the click to the
 *     impact T0), aftermath: null (no lasting fire) | { dur: seconds | null (no end: it burns until the GM puts it out) },
 *     walk: { ... } (line / run: how the hits walk, see WALK), layers: [ layer, ... ] }
 *   Lengths are in GRID SQUARES at size 1 (the firing's size scales them), times in ms from T0 (negative: the pre-roll).
 *   layer = { l: kind, id, at: ms | [lo, hi], chance: 0..1, place: PLACE, ... per kind }:
 *     destruction  type (model TYPES), cause (model CAUSES), level 1..3 | lvMix [p1, p2, p3], r: [lo, hi] (a disc's radius), pr: the
 *                  stroke's own look (stroke-params PIN_KEYS), lanes: "each" (a stroke per walk lane) | "all"
 *     fire         lv | lvMix, sm 0..3, s 0.1..1, r, len (a short segment along the rim / at random, sq), life ms | aftermath: true,
 *                  lifeK [lo, hi] (each one's share of the aftermath, so they die out one by one)
 *     smoke        sm 1..3, r, len, life | aftermath, lifeK
 *     burst        lv, r                    (pending: the explosion fire, P3)
 *     dust         dk "shock" | "hits", lv, r (pending: the new dust kinds, P4)
 *     accent       kind (ACCENTS), dur, every (walk hits: each n-th one)   (pending: P5)
 *     cue          kind "screen" (shake, flash) | "light" (peak, radius, decay)   (pending: P5)
 *   PLACE = { m: "centre" } | { m: "ring", n: [lo, hi], d: [lo, hi] } (around the centre, evenly with jitter) | { m: "scatter", n,
 *     d, bias } (around the centre, denser inside for bias > 1) | { m: "walk", pick: share of the hits (0..1, omitted: all) }
 *   Answers of the user (2026-11-09, dev/presets-design.md section 10): no sound, no helicopter shadow, nothing pushes tokens; how
 *   the aftermath fire ends is a preset setting (aftermath.dur: a duration, or null = no end), overridable per firing.
 *
 * THE FIRING (expand()): gesture { a: [x, y], b: [x, y] | null, from: [x, y] | null } in scene px; opts { seed, size 0.5..2, power
 * -1..1 (a level shift), aftermath: seconds | null | undefined (the preset's) }; env { grid (px per square), rect { x, y, width,
 * height } (the scene), now (shared clock ms), wind { dir, speed } }. Returns a PLAN (see expand) or throws on a bad definition.
 */
export const VERSION = 1;
export const GESTURES = ["point", "throw", "line", "run"];
export const KINDS = ["destruction", "fire", "smoke", "burst", "dust", "accent", "cue"];
export const PENDING = ["burst", "dust", "accent", "cue"];
export const PLACES = ["centre", "ring", "scatter", "walk"];
export const ACCENTS = ["fallShadow", "throwArc", "bounce", "muzzle", "hitFx", "tracer"];
export const CUES = ["screen", "light"];
export const DUST = ["shock", "hits"];
/** Same order as scripts/destruction/model.mjs TYPES / CAUSES (a stroke stores the index). */
export const D_TYPES = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];
export const D_CAUSES = ["none", "fire", "acid", "lightning", "arcane", "impact", "claws", "water", "decay", "frost"];
/** A stroke's own look settings a preset may pin (scripts/destruction/stroke-params.mjs PIN_KEYS, without cause). */
export const PR_KEYS = { debris: [0, 1], scatter: [0.3, 2], lift: [0, 1.6], rubble: [0, 1], halo: [0, 1], edge: [0, 1], jag: [0.1, 1] };
export const PR_BOOLS = ["jagged", "directional"];
export const MATERIALS = ["auto", "grass", "earth", "stone", "wood", "sand", "snow", "water", "metal"];
/** The aftermath setting: seconds (a duration slider) or null (no end). */
export const AFTERMATH = Object.freeze({ min: 5, max: 600, step: 5, label: "MOINENMAPS.DPreset.aftermath", noEnd: "MOINENMAPS.DPreset.aftermathNoEnd", hint: "MOINENMAPS.DPreset.aftermathHint" });
/** At most this many separate damage areas per firing (dev/presets-design.md 8.1): the walk is capped by WALK.maxHits. */
export const MAX_AREAS = 30;
export const LIMITS = { preroll: [0, 4000], at: [-4000, 120000], r: [0.02, 6], d: [0, 12], n: [0, 64], len: [0, 4], life: [200, 600000],
  size: [0.5, 2], power: [-1, 1] };
/** The walk of a gun (line / run): rate (hits a second per lane), speed (squares a second), dur [min, max] s, lanes (offsets across
 * the line, sq), phase (a lane's shift in shots, per lane), sigma [start, end] (the spread across, sq), drift (muzzle climb to one
 * side over the burst, sq), sway { amp, wave } (the whole line's slow random sway), wobble { amp, wave } (each lane's own), stray
 * { p, k } (share of strays at k x sigma), maxHits (all lanes). */
export const WALK_DEFAULTS = Object.freeze({ rate: 10, speed: 5, dur: [0.6, 2.5], lanes: [0], phase: [0], sigma: [0.25, 0.5], drift: 0,
  sway: { amp: 0, wave: 5 }, wobble: { amp: 0, wave: 2 }, stray: { p: 0, k: 1.5 }, maxHits: 30 });

/* ---------------------------------------------------------------- small helpers */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v, d, lo, hi) => (isNum(v) ? clamp(v, lo, hi) : d);
/** A number or a [lo, hi] range, cleaned (lo <= hi). */
function range(v, d, lo, hi) {
  if ( Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) ) { const a = clamp(v[0], lo, hi), b = clamp(v[1], lo, hi); return [Math.min(a, b), Math.max(a, b)]; }
  if ( isNum(v) ) { const a = clamp(v, lo, hi); return [a, a]; }
  return d;
}
const round = (v, k = 100) => Math.round(v * k) / k;

/** A 32-bit hash of a string (FNV-1a). */
export function hashStr(s) { let h = 2166136261; for ( let i = 0; i < s.length; i++ ) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
/** A seeded generator in [0, 1) (mulberry32): the same seed, the same sequence on every machine. */
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (r) => r[0] + (r[1] - r[0]) * f();
  f.int = (r) => Math.floor(r[0] + (r[1] - r[0] + 1) * f());
  f.gauss = () => { const u = Math.max(1e-9, f()), v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return f;
}
/** The generator of one part of a firing (a layer, the walk): its own stream, so adding a layer never moves the others. */
export const stream = (seed, tag) => rng((Math.imul(seed >>> 0, 0x9e3779b1) ^ hashStr(String(tag))) >>> 0);

/* ---------------------------------------------------------------- the definition */

const LEVELS3 = (v, d) => (Array.isArray(v) && v.length === 3 && v.every((x) => isNum(x) && x >= 0) && v.some((x) => x > 0) ? v.map((x) => round(x, 1000)) : d);
const intLv = (v, d, lo = 1, hi = 3) => (isNum(v) ? clamp(Math.round(v), lo, hi) : d);

function cleanPlace(p, kind, errors, where) {
  const m = PLACES.includes(p?.m) ? p.m : "centre";
  if ( p && p.m !== undefined && !PLACES.includes(p.m) ) errors.push(`${where}: unknown place "${p.m}"`);
  const out = { m };
  if ( m === "ring" || m === "scatter" ) { out.n = range(p.n, [1, 1], ...LIMITS.n).map(Math.round); out.d = range(p.d, [0, 1], ...LIMITS.d); }
  if ( m === "scatter" ) out.bias = num(p.bias, 1, 0.2, 5);
  if ( m === "walk" && p.pick !== undefined ) out.pick = num(p.pick, 1, 0, 1);
  return out;
}

function cleanPr(pr) {
  if ( !pr || typeof pr !== "object" ) return undefined;
  const out = {};
  for ( const [k, [lo, hi]] of Object.entries(PR_KEYS) ) if ( isNum(pr[k]) ) out[k] = clamp(pr[k], lo, hi);
  for ( const k of PR_BOOLS ) if ( typeof pr[k] === "boolean" ) out[k] = pr[k];
  if ( MATERIALS.includes(pr.material) ) out.material = pr.material;
  return Object.keys(out).length ? out : undefined;
}

function cleanLayer(L, i, errors) {
  const where = `layer ${i}${L?.id ? ` (${L.id})` : ""}`;
  if ( !L || typeof L !== "object" || !KINDS.includes(L.l) ) { errors.push(`${where}: unknown kind "${L?.l}"`); return null; }
  const out = { l: L.l, id: typeof L.id === "string" && /^[\w-]{1,24}$/.test(L.id) ? L.id : `${L.l}${i}`, at: range(L.at, [0, 0], ...LIMITS.at),
    chance: num(L.chance, 1, 0, 1), place: cleanPlace(L.place, L.l, errors, where) };
  switch ( L.l ) {
    case "destruction":
      out.type = D_TYPES.includes(L.type) ? L.type : (errors.push(`${where}: unknown type "${L.type}"`), "blast");
      out.cause = L.cause === undefined ? "none" : D_CAUSES.includes(L.cause) ? L.cause : (errors.push(`${where}: unknown cause "${L.cause}"`), "none");
      out.lvMix = L.lvMix ? LEVELS3(L.lvMix, null) : null;
      if ( L.lvMix && !out.lvMix ) errors.push(`${where}: bad lvMix`);
      out.level = intLv(L.level, 2);
      out.r = range(L.r, [0.5, 0.5], ...LIMITS.r);
      out.pr = cleanPr(L.pr);
      out.lanes = L.lanes === "all" ? "all" : "each";
      break;
    case "fire": case "smoke":
      if ( L.l === "fire" ) { out.lvMix = L.lvMix ? LEVELS3(L.lvMix, null) : null; out.lv = intLv(L.lv, 1); out.sm = intLv(L.sm, 1, 0, 3); }
      else out.sm = intLv(L.sm, 2);
      out.s = num(L.s, 0.8, 0.1, 1);
      out.r = range(L.r, [0.3, 0.3], ...LIMITS.r);
      out.len = range(L.len, [0, 0], ...LIMITS.len);
      out.aftermath = L.aftermath === true;
      out.life = out.aftermath ? null : range(L.life, null, ...LIMITS.life);
      out.lifeK = range(L.lifeK, [1, 1], 0.05, 1);
      break;
    case "burst":
      out.lv = intLv(L.lv, 2); out.r = range(L.r, [1, 1], ...LIMITS.r);
      break;
    case "dust":
      out.dk = DUST.includes(L.dk) ? L.dk : (errors.push(`${where}: unknown dust kind "${L.dk}"`), "shock");
      out.lv = intLv(L.lv, 2); out.r = range(L.r, [1, 1], ...LIMITS.r);
      out.life = range(L.life, null, ...LIMITS.life);
      break;
    case "accent":
      out.kind = ACCENTS.includes(L.kind) ? L.kind : (errors.push(`${where}: unknown accent "${L.kind}"`), "hitFx");
      out.dur = num(L.dur, 500, 0, 8000);
      if ( L.every !== undefined ) out.every = Math.round(num(L.every, 1, 1, 20));
      break;
    case "cue":
      out.kind = CUES.includes(L.kind) ? L.kind : (errors.push(`${where}: unknown cue "${L.kind}"`), "screen");
      if ( out.kind === "screen" ) { out.shake = num(L.shake, 0.5, 0, 1); out.flash = num(L.flash, 0, 0, 1); }
      else { out.peak = num(L.peak, 1, 0, 1); out.radius = num(L.radius, 2, 0.5, 12); out.decay = num(L.decay, 1000, 50, 10000); }
      break;
  }
  return out;
}

function cleanWalk(w, errors) {
  const D = WALK_DEFAULTS;
  if ( !w || typeof w !== "object" ) { errors.push("line / run gesture without a walk"); w = {}; }
  const lanes = Array.isArray(w.lanes) && w.lanes.length && w.lanes.length <= 4 && w.lanes.every(isNum) ? w.lanes.map((v) => clamp(v, -3, 3)) : [...D.lanes];
  const phase = lanes.map((_, i) => num(Array.isArray(w.phase) ? w.phase[i] : undefined, 0, 0, 1));
  const sub = (o, d) => ({ amp: num(o?.amp, d.amp, 0, 3), wave: num(o?.wave, d.wave, 0.5, 40) });
  return { rate: num(w.rate, D.rate, 1, 30), speed: num(w.speed, D.speed, 0.5, 40), dur: range(w.dur, [...D.dur], 0.1, 8), lanes, phase,
    sigma: range(w.sigma, [...D.sigma], 0, 3), drift: num(w.drift, D.drift, -3, 3), sway: sub(w.sway, D.sway), wobble: sub(w.wobble, D.wobble),
    stray: { p: num(w.stray?.p, D.stray.p, 0, 1), k: num(w.stray?.k, D.stray.k, 1, 4) }, maxHits: Math.round(num(w.maxHits, D.maxHits, 1, MAX_AREAS)) };
}

/**
 * A definition, cleaned: known keys only, numbers clamped, junk named in `errors` (a definition with errors is still returned with
 * safe values; `ok` says whether it was clean). Never throws.
 */
export function cleanDef(raw) {
  const errors = [];
  if ( !raw || typeof raw !== "object" ) return { ok: false, def: null, errors: ["not an object"] };
  const id = typeof raw.id === "string" && /^[\w-]{1,32}$/.test(raw.id) ? raw.id : (errors.push("bad id"), "preset");
  if ( raw.v !== undefined && raw.v !== VERSION ) errors.push(`unknown version ${raw.v}`);
  const gesture = GESTURES.includes(raw.gesture) ? raw.gesture : (errors.push(`unknown gesture "${raw.gesture}"`), "point");
  const str = (v) => (typeof v === "string" && v.length <= 120 ? v : "");
  let aftermath = null;
  if ( raw.aftermath && typeof raw.aftermath === "object" ) aftermath = { dur: raw.aftermath.dur === null ? null : num(raw.aftermath.dur, 60, AFTERMATH.min, AFTERMATH.max) };
  else if ( raw.aftermath !== undefined && raw.aftermath !== null ) errors.push("bad aftermath");
  const layers = (Array.isArray(raw.layers) ? raw.layers : (errors.push("no layers"), [])).slice(0, 32).map((L, i) => cleanLayer(L, i, errors)).filter(Boolean);
  const walk = gesture === "line" || gesture === "run" ? cleanWalk(raw.walk, errors) : null;
  if ( !walk && layers.some((L) => L.place.m === "walk") ) errors.push("a walk place without a line / run gesture");
  if ( !aftermath && layers.some((L) => L.aftermath) ) errors.push("an aftermath layer in a preset without aftermath");
  const ids = new Set();
  for ( const L of layers ) { if ( ids.has(L.id) ) errors.push(`layer id "${L.id}" twice`); ids.add(L.id); }
  const def = { id, v: VERSION, name: str(raw.name), hint: str(raw.hint), icon: str(raw.icon) || "fa-solid fa-burst", set: str(raw.set),
    gesture, preroll: Math.round(num(raw.preroll, 0, ...LIMITS.preroll)), aftermath, walk, layers };
  return { ok: !errors.length, def, errors };
}

/* ---------------------------------------------------------------- the walk of a gun */

/** A smooth, never-repeating sway: two sines with random wavelengths around `wave` and random phases (sq -> sq). */
function swayFn(r, amp, wave) {
  if ( !amp ) return () => 0;
  const w1 = wave * (0.75 + 0.5 * r()), w2 = wave * (0.4 + 0.3 * r()), p1 = r() * 6.2832, p2 = r() * 6.2832;
  return (s) => amp * (0.65 * Math.sin(6.2832 * s / w1 + p1) + 0.35 * Math.sin(6.2832 * s / w2 + p2));
}

/**
 * The hits of a gun along a -> b (px): per lane, evenly in time over the burst, each offset across the line by the line's sway, the
 * lane's own wobble, the muzzle drift and a Gaussian spread that widens along the burst (strays wider), and jittered along it.
 * Returns { hits: [{ x, y, t (ms from T0), lane, i }], dur (ms), dir: [ux, uy], len (px) }. A click (a ~ b): a short burst round a.
 */
export function walkHits(W, a, b, { seed, grid, size }) {
  const r = stream(seed, "walk"), u2 = (s) => s * grid * size;
  let dx = (b?.[0] ?? a[0]) - a[0], dy = (b?.[1] ?? a[1]) - a[1];
  const len = Math.hypot(dx, dy), L = len / grid;                                  // squares (the walk's speed is not scaled by size)
  const click = len < grid * 0.1;
  if ( click ) { const ang = r() * 6.2832; dx = Math.cos(ang); dy = Math.sin(ang); } else { dx /= len; dy /= len; }
  const dur = click ? W.dur[0] : clamp(L / W.speed, W.dur[0], W.dur[1]);
  const lanes = W.lanes.length, n = Math.max(1, Math.min(Math.round(W.rate * dur), Math.floor(W.maxHits / lanes)));
  const sway = swayFn(r, W.sway.amp, W.sway.wave), side = r() < 0.5 ? -1 : 1;
  const hits = [];
  for ( let j = 0; j < lanes; j++ ) {
    const wob = swayFn(stream(seed, `wobble${j}`), W.wobble.amp, W.wobble.wave), rj = stream(seed, `lane${j}`);
    for ( let i = 0; i < n; i++ ) {
      const f = n > 1 ? (i + W.phase[j]) / n : 0.5, s = click ? 0 : f * L;
      const sig = W.sigma[0] + (W.sigma[1] - W.sigma[0]) * f, k = rj() < W.stray.p ? W.stray.k : 1;
      const across = W.lanes[j] + sway(s) + wob(s) + side * W.drift * f + rj.gauss() * sig * k;
      const along = rj.gauss() * sig * 0.5 * k;
      const x = a[0] + dx * (u2(along) + s * grid) - dy * u2(across), y = a[1] + dy * (u2(along) + s * grid) + dx * u2(across);
      hits.push({ x: round(x, 10), y: round(y, 10), t: Math.round(f * dur * 1000), lane: j, i });
    }
  }
  hits.sort((p, q) => p.t - q.t || p.lane - q.lane);
  return { hits, dur: Math.round(dur * 1000), dir: [round(dx, 1e4), round(dy, 1e4)], len };
}

/* ---------------------------------------------------------------- placing and expanding */

/** The points a layer is put at: [{ x, y, t, tan? (a unit tangent, for a segment), lane? }] (px, ms from T0 before `at`). */
function placeOf(L, P, r, ctx) {
  const { c, grid, size, hits } = ctx, sq = grid * size;
  switch ( L.place.m ) {
    case "centre": return [{ x: c[0], y: c[1], t: 0 }];
    case "ring": case "scatter": {
      const n = r.int(L.place.n), out = [], a0 = r() * 6.2832;
      for ( let i = 0; i < n; i++ ) {
        const ang = L.place.m === "ring" ? a0 + (i + (r() - 0.5) * 0.6) * 6.2832 / n : r() * 6.2832;
        const u = L.place.m === "scatter" ? Math.pow(r(), L.place.bias) : r();
        const d = (L.place.d[0] + (L.place.d[1] - L.place.d[0]) * u) * sq;
        out.push({ x: c[0] + Math.cos(ang) * d, y: c[1] + Math.sin(ang) * d, t: 0, tan: [-Math.sin(ang), Math.cos(ang)], d });
      }
      return out;
    }
    case "walk": {
      const pick = L.place.pick ?? 1;
      return (hits ?? []).filter(() => pick >= 1 || r() < pick).map((h) => ({ x: h.x, y: h.y, t: h.t, lane: h.lane }));
    }
  }
  return [];
}

const inRect = (p, R) => p.x >= R.x && p.y >= R.y && p.x < R.x + R.width && p.y < R.y + R.height;
const levelOf = (L, r, shift) => {
  let lv = L.lvMix ? (() => { const s = L.lvMix.reduce((a, b) => a + b, 0); let u = r() * s; for ( let i = 0; i < 3; i++ ) { u -= L.lvMix[i]; if ( u < 0 ) return i + 1; } return 3; })() : L.level ?? L.lv;
  return clamp(lv + shift, 1, 3);
};

/**
 * Expand one firing. Returns the PLAN:
 *   { v, preset, seed, size, power, aftermath (s | null), t0 (shared clock ms of the impact), at: [x, y] (the impact), dir: [ux, uy]
 *     | null, gesture { a, b, from }, walk: { dur, len, hits } | null,
 *     destruction: [{ key, type, cause, discs: [[x, y, r, level], ...] (px), path: [[x, y, ms], ...] | null, a: [x, y], b, pr, at (ms) }],
 *     fire: [{ key, k: "fire" | "smoke", p: [x, y, ...], r, s, lv?, sm, q, o? (shared clock), wd, ws, e: 1 }],
 *     pending: { burst: [...], dust: [...], accent: [...], cue: [...] } }   (each with its layer id and time, positions in px)
 * The fire records are complete fire-layer strokes but for their id (the writer gives it); a destruction record is a set of discs
 * the writer stamps into one stroke (scripts/destruction/model.mjs stamp).
 */
export function expand(defIn, gesture, opts = {}, env = {}) {
  const { def, ok, errors } = cleanDef(defIn);
  if ( !def ) throw new Error(`presets: bad definition (${errors.join("; ")})`);
  if ( !ok ) throw new Error(`presets: bad definition "${def.id}" (${errors.join("; ")})`);
  const a = gesture?.a, b = gesture?.b ?? null, from = gesture?.from ?? null;
  if ( !Array.isArray(a) || !isNum(a[0]) || !isNum(a[1]) ) throw new Error("presets: the gesture needs a point a: [x, y]");
  const seed = (isNum(opts.seed) ? opts.seed : 1) >>> 0, size = num(opts.size, 1, ...LIMITS.size), power = Math.round(num(opts.power, 0, ...LIMITS.power));
  const grid = num(env.grid, 100, 4, 2000), R = env.rect ?? { x: -1e9, y: -1e9, width: 2e9, height: 2e9 }, now = isNum(env.now) ? env.now : 0;
  const wind = { dir: Math.round(((num(env.wind?.dir, 0, -1e6, 1e6) % 360) + 360) % 360), speed: round(num(env.wind?.speed, 0, 0, 1)) };
  // the aftermath's duration: the firing's (seconds; null = no end), else the preset's
  const aft = !def.aftermath ? null : opts.aftermath === null ? null : isNum(opts.aftermath) ? clamp(opts.aftermath, AFTERMATH.min, AFTERMATH.max) : def.aftermath.dur;
  const t0 = Math.round(now + def.preroll);
  const sq = grid * size;
  const hasB = Array.isArray(b) && isNum(b[0]) && isNum(b[1]) && Math.hypot(b[0] - a[0], b[1] - a[1]) > grid * 0.1;
  const walk = def.walk ? walkHits(def.walk, a, hasB ? b : null, { seed, grid, size }) : null;
  const c = def.gesture === "throw" && hasB ? b : a;
  const dir = def.gesture === "point" ? (hasB ? unit(b[0] - a[0], b[1] - a[1]) : null) : walk ? walk.dir : hasB ? unit(b[0] - a[0], b[1] - a[1]) : null;
  const plan = { v: VERSION, preset: def.id, seed, size, power, aftermath: aft, t0, at: [round(c[0], 10), round(c[1], 10)], dir,
    gesture: { a, b: hasB ? b : null, from }, walk: walk ? { dur: walk.dur, len: Math.round(walk.len), hits: walk.hits.map((h) => [h.x, h.y, h.t, h.lane]) } : null,
    destruction: [], fire: [], pending: { burst: [], dust: [], accent: [], cue: [] } };
  const ctx = { c, grid, size, hits: walk?.hits };
  for ( const L of def.layers ) {
    const r = stream(seed, `layer:${L.id}`);
    if ( r() >= L.chance ) continue;
    const at = Math.round(r.range(L.at)), pts = placeOf(L, def, r, ctx).filter((p) => inRect(p, R));
    if ( !pts.length && L.l !== "cue" && L.l !== "accent" ) continue;
    switch ( L.l ) {
      case "destruction": {
        const groups = L.place.m === "walk" && L.lanes === "each" ? def.walk.lanes.map((_, j) => pts.filter((p) => p.lane === j)) : [pts];
        groups.forEach((g, j) => {
          if ( !g.length ) return;
          const discs = g.map((p) => [round(p.x, 10), round(p.y, 10), round(r.range(L.r) * sq, 10), levelOf(L, r, power)]);
          const path = L.place.m === "walk" && g.length > 1 ? g.map((p) => [round(p.x, 10), round(p.y, 10), p.t]) : null;
          const first = path ? path[0] : [c[0], c[1]], last = path ? path.at(-1) : null;
          plan.destruction.push({ key: groups.length > 1 ? `${L.id}.${j}` : L.id, type: L.type, cause: L.cause, discs, path,
            a: [round(first[0], 10), round(first[1], 10)], b: last ? [round(last[0], 10), round(last[1], 10)] : null,
            pr: L.place.m === "walk" ? { ...(L.pr ?? {}), directional: L.pr?.directional ?? true } : L.pr ?? null, at: at + (g[0].t ?? 0) });
        });
        break;
      }
      case "fire": case "smoke":
        pts.forEach((p, i) => {
          const rad = Math.max(4, Math.round(r.range(L.r) * sq)), seg = r.range(L.len) * sq, tan = p.tan ?? unit(r() - 0.5, r() - 0.5) ?? [1, 0];
          let pp = seg > 1 ? [p.x - tan[0] * seg / 2, p.y - tan[1] * seg / 2, p.x + tan[0] * seg / 2, p.y + tan[1] * seg / 2] : [p.x, p.y];
          if ( pp.length > 2 && !(inRect({ x: pp[0], y: pp[1] }, R) && inRect({ x: pp[2], y: pp[3] }, R)) ) pp = [p.x, p.y];   // (a segment that would leave the scene: its centre only)
          const q = t0 + at + (p.t ?? 0);
          const life = L.aftermath ? (aft === null ? null : aft * 1000 * r.range(L.lifeK)) : L.life ? r.range(L.life) : null;
          const st = { key: `${L.id}.${i}`, k: L.l, p: pp.map((v) => Math.round(v)), r: rad, s: L.s, sm: L.l === "fire" ? clamp(L.sm, 0, 3) : clamp(L.sm + power, 1, 3),
            q: Math.round(q), wd: wind.dir, ws: wind.speed, e: 1 };
          if ( L.l === "fire" ) st.lv = levelOf(L, r, power);
          if ( life !== null ) st.o = Math.round(q + life);
          plan.fire.push(st);
        });
        break;
      case "burst":
        for ( const p of pts ) plan.pending.burst.push({ id: L.id, x: round(p.x, 10), y: round(p.y, 10), lv: clamp(L.lv + power, 1, 3), r: round(r.range(L.r) * sq, 10), at: at + (p.t ?? 0) });
        break;
      case "dust":
        if ( L.place.m === "walk" ) plan.pending.dust.push({ id: L.id, dk: L.dk, lv: clamp(L.lv + power, 1, 3), r: round(r.range(L.r) * sq, 10), at, pts: pts.map((p) => [round(p.x, 10), round(p.y, 10), p.t]),
          life: L.life ? Math.round(r.range(L.life)) : null });
        else for ( const p of pts ) plan.pending.dust.push({ id: L.id, dk: L.dk, lv: clamp(L.lv + power, 1, 3), r: round(r.range(L.r) * sq, 10), at, x: round(p.x, 10), y: round(p.y, 10),
          life: L.life ? Math.round(r.range(L.life)) : null });
        break;
      case "accent": plan.pending.accent.push(accentOf(L, at, { plan, hits: (walk?.hits ?? []).filter((h) => inRect(h, R)), from })); break;
      case "cue": plan.pending.cue.push(L.kind === "screen" ? { id: L.id, kind: "screen", at, shake: L.shake, flash: L.flash }
        : { id: L.id, kind: "light", at, x: round(c[0], 10), y: round(c[1], 10), peak: L.peak, radius: round(L.radius * sq, 10), decay: L.decay });
        break;
    }
  }
  return plan;
}

function unit(x, y) { const l = Math.hypot(x, y); return l > 1e-9 ? [round(x / l, 1e4), round(y / l, 1e4)] : null; }

/** An accent's data: where and when (pending: the accents layer, P5, plays it). */
function accentOf(L, at, { plan, hits, from }) {
  const base = { id: L.id, kind: L.kind, at, dur: L.dur };
  switch ( L.kind ) {
    case "fallShadow": return { ...base, x: plan.at[0], y: plan.at[1], from: plan.dir };
    case "throwArc": return { ...base, from: plan.gesture.a, to: plan.at };
    case "bounce": return { ...base, x: plan.at[0], y: plan.at[1] };
    case "muzzle": return { ...base, from: from ?? null };
    case "hitFx": case "tracer": {
      const every = L.every ?? 1;
      return { ...base, hits: hits.filter((_, i) => i % every === every - 1).map((p) => [p.x, p.y, p.t, p.lane]), dir: plan.dir };
    }
  }
  return base;
}

/* ---------------------------------------------------------------- checks the tests and the writer share */

/** How many separate damage areas a plan's discs make (discs that touch join; per destruction record, as the bake sees them). */
export function areaCount(plan) {
  let n = 0;
  for ( const d of plan.destruction ) {
    const D = d.discs, par = D.map((_, i) => i);
    const find = (i) => { while ( par[i] !== i ) i = par[i] = par[par[i]]; return i; };
    for ( let i = 0; i < D.length; i++ ) for ( let j = i + 1; j < D.length; j++ ) {
      if ( Math.hypot(D[i][0] - D[j][0], D[i][1] - D[j][1]) <= D[i][2] + D[j][2] ) par[find(i)] = find(j);
    }
    n += new Set(D.map((_, i) => find(i))).size;
  }
  return n;
}
