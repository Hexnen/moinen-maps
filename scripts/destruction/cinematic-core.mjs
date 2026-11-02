/**
 * CINEMATIC MODE, the pure parts (no Foundry, no PIXI; node-testable: dev/cinematic.test.mjs).
 *
 * The scene stores `params.cinematic = { v: 1, mode, preview, preset, over: {...} }` (flat, versioned; read by sanitize()). It is a LIVE
 * setting: never part of a bake key (store.mjs keyParams drops it). A staged stroke carries `cin: { s: "p"|"y"|"d", q, t }` at stroke
 * level (not in objStr / signature / chunk ids; an old client ignores it and shows the stroke at once). The show plays with the settings
 * SNAPSHOT taken at Action time (snapshot()), with the per-player client opt-outs on top (effective()).
 */
export const VERSION = 1;
export const MODES = ["off", "drags", "all"];
export const DRAG_MIN = 12;                // art px of path length that make a stroke a drag
export const PACES = ["painted", "dramatic", "fast"];
export const EASES = ["linear", "out", "inout"];
export const CAM_MODES = ["follow", "frame"];

/** Every numeric value: [default, lo, hi, unit]. */
export const NUM = {
  lbHeight: [12, 0, 30, "%"], lbAlpha: [1, 0, 1, ""], lbIn: [450, 0, 3000, "ms"], lbOut: [450, 0, 3000, "ms"],
  shIntensity: [0.5, 0, 1, ""], shFreq: [18, 2, 40, "Hz"], shDecay: [0.6, 0.05, 1, ""], shBias: [0.3, 0, 1, ""], shMax: [14, 0, 60, "px"],
  vgStrength: [0.45, 0, 1, ""], vgRadius: [0.65, 0.2, 1, ""],
  smFactor: [0.45, 0.1, 1, "x"], smIn: [250, 0, 2000, "ms"], smOut: [500, 0, 3000, "ms"], smThreshold: [40, 0, 400, "art px"],
  flIntensity: [0.5, 0, 1, ""], flDur: [180, 40, 1500, "ms"],
  camZoomMin: [1, 0.3, 3, "x"], camZoomMax: [1.6, 0.3, 3, "x"], camLead: [0.35, 0, 1, ""], camHold: [600, 0, 5000, "ms"], camReturn: [900, 0, 5000, "ms"], camEase: [0.5, 0, 1, ""],
  timeScale: [1, 0.25, 4, "x"], gap: [350, 0, 5000, "ms"], pauseBefore: [500, 0, 5000, "ms"], pauseAfter: [800, 0, 8000, "ms"]
};
export const ENUMS = { lbEase: EASES, pace: PACES, camMode: CAM_MODES };
export const ENUM_DEFAULT = { lbEase: "inout", pace: "dramatic", camMode: "follow" };
/** Toggles: fx = the master "Screen effects" switch; the others one element each. */
export const BOOLS = { fx: true, lbOn: true, shOn: true, vgOn: true, smOn: true, flOn: true, camOn: true };
export const COLORS = { lbColor: "#000000", vgTint: "#000000", flColor: "#ffffff" };
export const KEYS = [...Object.keys(NUM), ...Object.keys(ENUMS), ...Object.keys(BOOLS), ...Object.keys(COLORS)];

export const DEFAULTS = Object.freeze({ ...Object.fromEntries(Object.entries(NUM).map(([k, v]) => [k, v[0]])), ...ENUM_DEFAULT, ...BOOLS, ...COLORS });

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** One value, validated and clamped; undefined when the key is unknown or the value is junk (the caller keeps the lower layer). */
export function cleanValue(k, v) {
  if ( k in NUM ) { const n = Number(v); return v === null || v === "" || typeof v === "boolean" || !Number.isFinite(n) ? undefined : clamp(n, NUM[k][1], NUM[k][2]); }
  if ( k in ENUMS ) return ENUMS[k].includes(v) ? v : undefined;
  if ( k in BOOLS ) return typeof v === "boolean" ? v : undefined;
  if ( k in COLORS ) return typeof v === "string" && HEX.test(v) ? v.toLowerCase() : undefined;
  return undefined;
}
/** A partial settings object reduced to known, valid, clamped keys. */
export function cleanPartial(o) {
  const out = {};
  if ( o && typeof o === "object" ) for ( const k of Object.keys(o) ) { if ( !KEYS.includes(k) ) continue; const v = cleanValue(k, o[k]); if ( v !== undefined ) out[k] = v; }
  return out;
}

/** The shipped presets (only what differs from DEFAULTS, which is "Epic"). */
export const PRESETS = Object.freeze({
  subtle: { lbHeight: 6, shIntensity: 0.2, vgStrength: 0.2, smOn: false, flOn: false, camZoomMax: 1.25, pace: "painted", pauseBefore: 150, pauseAfter: 300 },
  epic: {},
  blockbuster: { lbHeight: 15, shIntensity: 0.8, shMax: 24, vgStrength: 0.55, smFactor: 0.3, flIntensity: 0.7, camZoomMax: 2, pauseBefore: 900, pauseAfter: 1200, timeScale: 0.85 },
  anime: { lbHeight: 9, shIntensity: 0.9, shFreq: 30, shDecay: 0.35, vgStrength: 0.6, vgTint: "#1a0a30", smFactor: 0.2, smIn: 80, smOut: 350, flIntensity: 0.9, flDur: 120, camZoomMax: 2.2, camLead: 0.6, gap: 200, pace: "fast" },
  documentary: { lbHeight: 10, lbAlpha: 0.9, shOn: false, vgStrength: 0.25, smOn: false, flOn: false, camZoomMax: 1.3, camMode: "frame", camEase: 0.8, pace: "painted", pauseAfter: 1500 }
});
export const PRESET_IDS = ["subtle", "epic", "blockbuster", "anime", "documentary"];

/** Letterbox bar height (each bar, % of the screen height) that crops a screen of aspect `ar` to the picture aspect `target`; 0 when the screen is already that wide or wider. */
export function ratioHeight(target, ar) {
  const visible = ar >= target ? 1 : ar / target;
  return clamp(50 * (1 - visible), 0, 30);
}
export const RATIOS = { "2.39": 2.39, "1.85": 1.85 };

/**
 * The scene's cinematic block, validated: { v, mode, preview, preset ("custom", a shipped id or a user preset id), over }.
 * Anything unknown is dropped; a missing/old block gives mode OFF (so a scene from before behaves as today).
 */
export function sanitize(c) {
  const out = { v: VERSION, mode: "off", preview: true, preset: "epic", over: {} };
  if ( !c || typeof c !== "object" ) return out;
  if ( MODES.includes(c.mode) ) out.mode = c.mode;
  if ( typeof c.preview === "boolean" ) out.preview = c.preview;
  if ( typeof c.preset === "string" && /^[\w-]{1,40}$/.test(c.preset) ) out.preset = c.preset;
  out.over = cleanPartial(c.over);
  return out;
}

/** Merge: defaults < preset < overrides, every layer clamped; `users` = the GM's saved presets { id: partial }. Zoom max never below min. */
export function resolve(c, users = {}) {
  const s = sanitize(c);
  const base = s.preset === "custom" ? {} : cleanPartial(PRESETS[s.preset] ?? users?.[s.preset]);
  const r = { ...DEFAULTS, ...base, ...s.over };
  if ( r.camZoomMax < r.camZoomMin ) r.camZoomMax = r.camZoomMin;
  return r;
}

/**
 * What one client really plays: the scene toggle AND NOT the player's opt-out. `opt` = { noLetterbox, noShake, noCamera, noFlash,
 * noVignette, noSlow, reduced, allow }. `reduced` (prefers-reduced-motion) turns shake, slow-motion, flash and camera OFF unless the
 * player allowed that one explicitly (opt.allow = ["shake", ...]). The master `fx` off turns every screen effect off (the letterbox is
 * one too); the destruction show itself is never affected.
 */
export function effective(r, opt = {}) {
  const allow = new Set(opt.allow ?? []), calm = (k) => !!opt.reduced && !allow.has(k);
  const m = !!r.fx;
  return {
    letterbox: m && r.lbOn && !opt.noLetterbox && r.lbHeight > 0,
    shake: m && r.shOn && !opt.noShake && !calm("shake") && r.shIntensity > 0,
    vignette: m && r.vgOn && !opt.noVignette && r.vgStrength > 0,
    slowmo: m && r.smOn && !opt.noSlow && !calm("slowmo") && r.smFactor < 1,
    flash: m && r.flOn && !opt.noFlash && !calm("flash") && r.flIntensity > 0,
    camera: m && r.camOn && !opt.noCamera && !calm("camera")
  };
}

/** JSON for copy/paste: a user preset { name, values } (only valid keys), and back; import never throws, returns null when unusable. */
export const exportPreset = (name, values) => JSON.stringify({ moinenMapsCinematic: VERSION, name: String(name ?? "").slice(0, 60), values: cleanPartial(values) });
export function importPreset(text) {
  try {
    const j = JSON.parse(text);
    if ( !j || typeof j !== "object" || !(j.moinenMapsCinematic >= 1) ) return null;
    const values = cleanPartial(j.values), name = String(j.name ?? "").trim().slice(0, 60);
    return name && Object.keys(values).length ? { name, values } : null;
  } catch { return null; }
}
/** A user preset id from a name, unique among `taken` and never a shipped id. */
export function presetId(name, taken = []) {
  const base = ("u-" + String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).slice(0, 36) || "u-preset", set = new Set(taken);
  let id = base, n = 2; while ( set.has(id) || PRESETS[id] ) id = `${base}-${n++}`;
  return id;
}

/* ---------------------------------------------------------------- strokes: scope and the staging state machine */

export const pathLength = (p) => { let L = 0; for ( let i = 3; p && i + 1 < p.length; i += 3 ) L += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2]); return L; };
/** Is a stroke (its flat path `p`, its carry `tk`, `k` erase) a drag? A carry always is; the path must be at least `min` art px. */
export const isDrag = (o, min = DRAG_MIN) => !!o && !o.k && (!!o.tk || pathLength(o.p) >= min);
/** Is this new stroke staged under `mode`? Erase strokes never are (they remove damage). */
export function staged(mode, o, min = DRAG_MIN) {
  if ( !o || o.k ) return false;
  return mode === "all" ? true : mode === "drags" ? isDrag(o, min) : false;
}
/** The stroke-level field of a freshly staged stroke. */
export const stage = (q, t) => ({ s: "p", q: q | 0, t: Number(t) || 0 });
/** Legal transitions: pending (p) -> playing (y) -> done (d); p -> d (Skip / reveal now); nothing goes back (undo removes the stroke). */
const NEXT = { p: ["y", "d"], y: ["d"], d: [] };
export function advance(cin, to) {
  if ( !cin || !NEXT[cin.s]?.includes(to) ) return cin;
  return { ...cin, s: to };
}
/** Reads a stroke's cin defensively: undefined = a normal stroke. */
export const cinOf = (o) => { const c = o?.cin; return c && typeof c === "object" && (c.s === "p" || c.s === "y" || c.s === "d") ? c : undefined; };
/** Hidden from the players: pending only. A reload settles played ones. */
export const hidden = (o) => cinOf(o)?.s === "p";
/** The pending strokes in painting order (q, then stage time, then id). */
export const queue = (objs) => (objs ?? []).filter(hidden).sort((a, b) => ((a.cin.q | 0) - (b.cin.q | 0)) || ((a.cin.t | 0) - (b.cin.t | 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/* ---------------------------------------------------------------- the show: pace schedule, slow-motion, camera path */

/**
 * Start offsets (ms from the show's start, non-decreasing) of the queued strokes ({ cin: { t }, big }). `painted`: the gaps the GM
 * painted with (stage times, capped at 4 s each); `dramatic`: fixed gap r.gap, doubled after a big hit; `fast`: half the gap. All
 * divided by timeScale.
 */
export function schedule(strokes, r) {
  const out = [], scale = 1 / Math.max(0.05, r.timeScale);
  let t = r.pauseBefore * scale, prev = null;
  for ( const s of strokes ) {
    if ( prev ) {
      const gap = r.pace === "painted" ? Math.min(4000, Math.max(0, (s.cin?.t ?? 0) - (prev.cin?.t ?? 0))) : r.pace === "fast" ? r.gap / 2 : r.gap * (prev.big ? 2 : 1);
      t += gap * scale;
    }
    out.push(Math.round(t)); prev = s;
  }
  return out;
}
/** The whole show's length: the last start + that stroke's entry `dur` + the pause after. */
export const showLength = (offs, r, dur = 1500) => (offs.length ? offs.at(-1) + dur : 0) + r.pauseAfter / Math.max(0.05, r.timeScale);

/** The entrySpeed multiplier at time `t` around an impact at `t0` held for `hold` ms (ramp in, hold, ramp out); 1 outside or when not `big`. */
export function slowAt(t, t0, hold, r, big = true) {
  if ( !big || !(r.smFactor < 1) ) return 1;
  const a = t0 - r.smIn, b = t0 + hold, c = b + r.smOut;
  if ( t <= a || t >= c ) return 1;
  if ( t < t0 ) return 1 + (r.smFactor - 1) * ((t - a) / Math.max(1, r.smIn));
  if ( t <= b ) return r.smFactor;
  return r.smFactor + (1 - r.smFactor) * ((t - b) / Math.max(1, r.smOut));
}
/** Does this stroke (mask-px box w x h) count as a big hit for the slow-motion threshold (art px; K = 2)? */
export const isBig = (o, r) => Math.max(o?.w ?? 0, o?.h ?? 0) * 2 >= r.smThreshold;

/** Camera stops along a stroke path (flat [x,y,ms,...] art px): `n` stops evenly spaced by arc length, pushed ahead by `lead` (0..1 of the path). */
export function cameraPath(p, n, lead = 0) {
  if ( !p || p.length < 3 || n < 1 ) return [];
  const pts = [], cum = [0];
  for ( let i = 0; i + 2 < p.length; i += 3 ) { pts.push([p[i], p[i + 1]]); if ( i ) cum.push(cum.at(-1) + Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2])); }
  const L = cum.at(-1), out = [];
  for ( let k = 0; k < n; k++ ) {
    const u = clamp((n === 1 ? 0.5 : k / (n - 1)) + lead / Math.max(1, n), 0, 1), d = u * L;
    let j = 1; while ( j < cum.length - 1 && cum[j] < d ) j++;
    if ( pts.length === 1 ) { out.push([...pts[0]]); continue; }
    const seg = cum[j] - cum[j - 1] || 1, f = clamp((d - cum[j - 1]) / seg, 0, 1), a = pts[j - 1], b = pts[j];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}
/** Frame-the-whole-stroke camera: the centre and the zoom (kept inside the zoom range) for an art box on a view of vw x vh art px at zoom 1. */
export function frameBox(box, vw, vh, r) {
  const w = Math.max(1, box.x1 - box.x0), h = Math.max(1, box.y1 - box.y0);
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, zoom: clamp(Math.min(vw / (w * 1.4), vh / (h * 1.4)), r.camZoomMin, r.camZoomMax) };
}

/** The settings SNAPSHOT a show plays with: resolved values + the stroke ids, frozen at Action time. */
export const snapshot = (c, users, queued, at) => ({ at: Number(at) || 0, r: resolve(c, users), ids: (queued ?? []).map((o) => o.id) });
/** Two GMs: the first Action wins (the lower `at`, then the lower user id). */
export const firstWins = (a, b) => (a.at - b.at) || (a.by < b.by ? -1 : a.by > b.by ? 1 : 0);

/* ---------------------------------------------------------------- camera safety (the director drives canvas.animatePan only) */

export const ZOOM_BAND = [0.5, 4];
/** A target zoom kept inside the band around the zoom the show started at (never a jump outside 0.5x-4x of it). */
export const clampZoom = (z, start) => clamp(Number.isFinite(z) ? z : start, start * ZOOM_BAND[0], start * ZOOM_BAND[1]);
/**
 * Camera quality safety: the move's duration for the next leg given the slowest recent frame (ms). Above 25 ms the move is SHORTENED
 * (never frames dropped to keep the length): the duration shrinks in proportion to how far over the budget the frames are, down to 35%.
 */
export const moveDuration = (ms, frameMs, budget = 25) => !(frameMs > budget) ? ms : Math.max(ms * 0.35, ms * (budget / frameMs));
/**
 * The screen shake as ONE offset of the whole stage (px, applied by a single transform, never per layer): a decaying oscillation at
 * `shFreq`, biased toward the direction `dir` (unit vector, the front's heading) by shBias, max amplitude shMax, deterministic in t.
 * `t` = ms since the impact. Whole pixels when `whole` (no sub-pixel shimmering on a settled scene).
 */
export function shakeAt(t, r, dir = [0, 0], whole = true) {
  if ( t < 0 || !(r.shIntensity > 0) ) return [0, 0];
  const life = 200 + 1800 * (1 - r.shDecay), env = Math.max(0, 1 - t / life) ** 2;
  if ( env <= 0 ) return [0, 0];
  const amp = Math.min(r.shMax, r.shMax * r.shIntensity) * env, ph = (t / 1000) * r.shFreq * Math.PI * 2;
  const along = Math.sin(ph), across = Math.sin(ph * 1.37 + 1.3), b = r.shBias, dl = Math.hypot(dir[0], dir[1]) || 1, ux = dir[0] / dl, uy = dir[1] / dl;
  let x = amp * ((1 - b) * across * 0.7 + b * along * ux), y = amp * ((1 - b) * along * 0.7 + b * along * uy);
  if ( !dir[0] && !dir[1] ) { x = amp * across; y = amp * along; }
  return whole ? [Math.round(x), Math.round(y)] : [x, y];
}

/* ---------------------------------------------------------------- the show controller's pure parts (cinematic.mjs) */

export const LEAD = 450;                   // ms before a stroke's start that its areas are put on screen (built, entry set up with a start in the future)
export const START_SLACK = 900;            // ms between the Action click and the show's shared t0 (the flag has to reach everyone)
export const ENTRY_GUESS = 2000;           // the length of a stroke's entry as the schedule assumes (the show ends once the last entry has stopped, or a little after)
export const GRACE = 12000;                // a show whose flag is older than its length + this is over for good (a GM who comes back settles it)
/** The next place in the queue: after every stroke staged so far. */
export const nextQ = (objs) => (objs ?? []).reduce((m, o) => { const c = cinOf(o); return c ? Math.max(m, c.q | 0) : m; }, -1) + 1;
/** The art-px path of a brush stroke (scene points [x, y, ms]) as a flat [x, y, ms, ...] for isDrag; `toArt` maps a scene point to art px. */
export const flatPath = (pts, toArt) => { const out = []; for ( const q of pts ?? [] ) { const [x, y] = toArt({ x: q[0], y: q[1] }); out.push(x, y, q[2] ?? 0); } return out; };
/** Is a new stroke staged right now? `killed`: the kill switch (CONFIG.moinenMaps.noCinematic). */
export const stagedNow = (c, o, killed = false) => !killed && staged(sanitize(c).mode, o);
/** The `cin` of a freshly staged stroke: the queue place, the painting moment (shared clock ms), and where it started (art px, for the entry's origin) and its heading. */
export function stampOf(objs, t, o = null, d = null) {
  const c = stage(nextQ(objs), t);
  if ( Array.isArray(o) && o.length === 2 ) c.o = [Math.round(o[0]), Math.round(o[1])];
  if ( Array.isArray(d) && d.length === 2 ) c.d = [Math.round(d[0] * 100) / 100, Math.round(d[1] * 100) / 100];
  return c;
}
/** How many strokes are staged (pending). */
export const stagedCount = (objs) => (objs ?? []).reduce((n, o) => n + (hidden(o) ? 1 : 0), 0);

/**
 * A show record (the flag value): { id, by, at, t0, snap: { at, r, ids }, offs }. `offs[i]` = start of ids[i] in ms after t0.
 * Built once, by the GM who clicked Action, so every client plays the same timeline whatever it knows about the strokes.
 */
export function makeShow({ id, by, at, objs, c, users = {} }) {
  const q = queue(objs), snap = snapshot(c, users, q, at), r = snap.r;
  const offs = schedule(q.map((o) => ({ cin: o.cin, big: isBig(o, r) })), r);
  return { id, by, at, t0: at + START_SLACK, snap, offs };
}
export const validShow = (s) => !!s && typeof s === "object" && typeof s.id === "string" && typeof s.by === "string" && Number.isFinite(s.t0) && Array.isArray(s.offs) && Array.isArray(s.snap?.ids) && s.snap.ids.length === s.offs.length && !!s.snap.r;
/** The shared-clock end of a show: the last start + ENTRY_GUESS + the pause after. */
export const showEnd = (s) => s.t0 + showLength(s.offs, s.snap.r, ENTRY_GUESS);
/** Is the show still on (or just about to start) at `now`? Past its end + GRACE it is over for good. */
export const showLive = (s, now) => validShow(s) && now < showEnd(s) + GRACE;
/** The winning show among the flag's map { userId: show }: live ones only, the first Action (firstWins). Null when none. */
export function pickShow(map, now) {
  let best = null;
  for ( const [uid, s] of Object.entries(map && typeof map === "object" ? map : {}) ) {
    if ( !validShow(s) || !showLive(s, now) ) continue;
    const c = { ...s, by: s.by || uid };
    if ( !best || firstWins({ at: c.at, by: c.by }, { at: best.at, by: best.by }) < 0 ) best = c;
  }
  return best;
}
/**
 * Where each stroke of a show stands at `now` (shared ms): `startAt` its start, `revealAt` when it goes on screen (LEAD before),
 * `phase` "later" | "lead" (on screen soon, hidden) | "now" (started) .
 */
export function timeline(s, now) {
  return s.snap.ids.map((id, i) => {
    const startAt = s.t0 + s.offs[i], revealAt = startAt - LEAD;
    return { id, i, startAt, revealAt, phase: now >= startAt ? "now" : now >= revealAt ? "lead" : "later" };
  });
}
/** The id of the user who writes the flags of a show: its GM while they are connected, else the active GM. `active(uid)` tells who is connected. */
export const ownerOf = (s, active, activeGM) => (active(s.by) ? s.by : activeGM ?? null);
/** Hidden from the display on this client: staged ("p") and not revealed here, or scheduled in a show and not revealed yet. Everything is shown when `killed`. */
export function holdsStroke(o, { killed = false, revealed, scheduled, gmPreview = false } = {}) {
  if ( killed ) return false;
  const c = cinOf(o);
  if ( !c ) return false;
  if ( revealed?.has(o.id) ) return false;
  if ( scheduled?.has(o.id) ) return true;
  return c.s === "p" && !gmPreview;
}
/** The pending `cin` after the show moved a stroke on: p -> y at its start, y -> d once played (never backwards, see advance). */
export const flipped = (o, to) => (o?.cin ? { ...o, cin: advance(o.cin, to) } : o);
