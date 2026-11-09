/**
 * DESTRUCTION PRESETS, the pure part of the UI (P7 of dev/presets-design.md; no Foundry, no PIXI: node-tested in
 * dev/presets-ui.test.mjs). The soundboard: pads in an order (the hotkeys follow it), the bar's state (size, power, variation, the
 * aftermath per preset), a map gesture -> the expander's gesture, the GHOST of a plan (soft shapes in the oblique view, with their
 * times for the test fire's dry run), and the custom presets' editor (a copy of a built-in: layers on / off, a few values, the
 * timeline).
 */
import { wayOf, screenOf } from "./meteor-core.mjs";

export const PAD_KEYS = 18;                 // 1-9, then Shift+1-9
export const SIZE = Object.freeze({ min: 0.5, max: 2, step: 0.05 });
export const POWERS = [-1, 0, 1];
export const BAR_DEFAULT = Object.freeze({ pad: "bomb", size: 1, power: 0, vary: true, aft: {} });
export const STORE_DEFAULT = Object.freeze({ v: 1, custom: [], order: [] });
/** The icons a custom preset may take. */
export const ICONS = ["fa-solid fa-bomb", "fa-solid fa-burst", "fa-solid fa-gun", "fa-solid fa-helicopter", "fa-solid fa-explosion", "fa-solid fa-meteor",
  "fa-solid fa-fire-flame-curved", "fa-solid fa-bolt", "fa-solid fa-wand-sparkles", "fa-solid fa-hammer", "fa-solid fa-skull", "fa-solid fa-dragon",
  "fa-solid fa-rocket", "fa-solid fa-person-rifle", "fa-solid fa-tornado", "fa-solid fa-volcano"];
/** The gesture's glyph on a pad. */
export const GESTURE_ICON = { point: "fa-solid fa-crosshairs", throw: "fa-solid fa-share", line: "fa-solid fa-grip-lines", run: "fa-solid fa-angles-right" };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round = (v, k = 100) => Math.round(v * k) / k;

/* ---------------------------------------------------------------- the store (world setting) and the bar (client setting) */

/** The world's custom presets and the pad order, cleaned (bad entries dropped). */
export function cleanStore(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const custom = Array.isArray(s.custom) ? s.custom.filter((d) => d && typeof d === "object" && typeof d.id === "string" && /^[\w-]{1,32}$/.test(d.id) && Array.isArray(d.layers)) : [];
  const seen = new Set(), uniq = custom.filter((d) => (seen.has(d.id) ? false : seen.add(d.id)));
  const order = Array.isArray(s.order) ? [...new Set(s.order.filter((x) => typeof x === "string"))] : [];
  return { v: 1, custom: uniq, order };
}

/** The bar's state, cleaned. */
export function cleanBar(raw) {
  const b = raw && typeof raw === "object" ? raw : {};
  const aft = {};
  if ( b.aft && typeof b.aft === "object" ) for ( const [k, v] of Object.entries(b.aft) ) if ( v === null || isNum(v) ) aft[k] = v === null ? null : clamp(v, 5, 600);
  return { pad: typeof b.pad === "string" ? b.pad : BAR_DEFAULT.pad, size: round(isNum(b.size) ? clamp(b.size, SIZE.min, SIZE.max) : 1),
    power: POWERS.includes(b.power) ? b.power : 0, vary: b.vary !== false, aft };
}

/** Every preset (built-ins first, then the world's own) in the pads' order: ids in `order` first, the rest as listed. */
export function ordered(builtin, store) {
  const all = [...builtin, ...store.custom.filter((d) => !builtin.some((b) => b.id === d.id))];
  const byId = new Map(all.map((d) => [d.id, d]));
  const out = store.order.filter((id) => byId.has(id)).map((id) => byId.get(id));
  for ( const d of all ) if ( !out.includes(d) ) out.push(d);
  return out;
}
/** The pad order after moving `id` before `beforeId` (null: to the end). */
export function reorder(ids, id, beforeId = null) {
  const rest = ids.filter((x) => x !== id);
  if ( !ids.includes(id) ) return ids.slice();
  const i = beforeId === null ? rest.length : rest.indexOf(beforeId);
  rest.splice(i < 0 ? rest.length : i, 0, id);
  return rest;
}
/** A pad's hotkey label (index in the order): "1".."9", "⇧1".."⇧9", "" past 18. */
export const hotkeyOf = (i) => (i < 9 ? String(i + 1) : i < PAD_KEYS ? `⇧${i - 8}` : "");
/** The pad index of a digit key (KeyboardEvent.code "Digit1".."Digit9"), Shift for the second nine; -1 if none. */
export function padOfKey(code, shift) {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(String(code)); if ( !m ) return -1;
  return Number(m[1]) - 1 + (shift ? 9 : 0);
}

/* ---------------------------------------------------------------- the aftermath and the options of a firing */

/** The aftermath control of a preset: { has (does it leave lasting fire), dur (seconds | null = no end), own (overridden on this client) }. */
export function aftermathOf(def, bar) {
  if ( !def?.aftermath ) return { has: false, dur: null, own: false };
  const own = Object.prototype.hasOwnProperty.call(bar.aft, def.id);
  return { has: true, dur: own ? bar.aft[def.id] : (def.aftermath.dur ?? null), own };
}
/** The options of a firing from the bar (the seed is the caller's). */
export function fireOpts(def, bar, seed) {
  const o = { seed: seed >>> 0, size: bar.size, power: bar.power };
  const a = aftermathOf(def, bar);
  if ( a.has && a.own ) o.aftermath = a.dur;
  return o;
}

/* ---------------------------------------------------------------- the gesture */

/**
 * A map gesture -> the expander's gesture { a, b, from } (scene px): `down` / `up` [x, y], `grid` px per square, `token` the token
 * under the pointer at the start ({ x, y, r } its centre and radius) or null. Below `grid * 0.25` of movement there is no drag.
 *   point  a = the click; a drag sets the direction it falls from (b)
 *   throw  from = the token (or the click), b = where it lands (a click: in place)
 *   line   the burst walks a -> b; started on a token: it is the shooter (from), the hits start just past its edge
 *   run    the strafing run a -> b
 */
export function gestureOf(kind, down, up, grid, token = null) {
  const dx = up[0] - down[0], dy = up[1] - down[1], len = Math.hypot(dx, dy), drag = len > grid * 0.25;
  const P = (p) => [Math.round(p[0]), Math.round(p[1])];
  if ( kind === "throw" ) {
    const from = token ? [token.x, token.y] : down;
    return { a: P(from), b: drag ? P(up) : null, from: token ? P(from) : null };
  }
  if ( kind === "line" && token && drag ) {
    const ux = dx / len, uy = dy / len, start = Math.min(len * 0.5, token.r + grid * 0.5);
    return { a: P([token.x + ux * start, token.y + uy * start]), b: P(up), from: P([token.x, token.y]) };
  }
  return { a: P(down), b: drag ? P(up) : null, from: null };
}

/* ---------------------------------------------------------------- the ghost */

export const INK = { destruction: [0xb8433a, 0xa8261f, 0x8f1712], rim: 0xff5a3c, fire: 0xff8a24, smoke: 0xa8a29a, burst: 0xffd27a, dust: 0xc8b48c, aim: 0xfff3e2 };

/**
 * The ghost of a plan (core.mjs expand): soft shapes in scene px, each with its time `t` (ms from T0) and how long it is shown
 * `d`, for the test fire's dry run (the live ghost shows all at once). `view` { lift, squash } (view-angle.mjs).
 *   { k: "disc", x, y, r, sq (y / x), z (height px), c, a, t, d }   a soft ellipse (sq 1: round on the map; a ground decal: squashed)
 *   { k: "ring", x, y, r, sq, z, w (width px), c, a, t, d }          a soft ring (a crater's rim, the reach of a shock wave)
 *   { k: "dots", pts: [[x, y]], r, c, a, t, d }                       a dotted line (aim, the throw's arc)
 */
export function ghostOf(plan, view = { lift: 0.5, squash: 0.8 }) {
  const out = [], T0 = plan.t0, sq = clamp(view.squash ?? 0.8, 0.5, 1), lift = clamp(view.lift ?? 0.5, 0, 1);
  // the aim: where the gesture went (a line / run: its walk; a throw: its arc, lifted in the oblique view)
  const g = plan.gesture;
  if ( g?.b && plan.walk ) out.push({ k: "dots", pts: lineDots(g.a, g.b, 14), r: 4.5, c: INK.aim, a: 0.7, t: -800, d: 800 + plan.walk.dur });
  for ( const ac of plan.pending?.accent ?? [] ) {
    if ( ac.kind === "throwArc" && ac.from && ac.to ) out.push({ k: "dots", pts: arcDots(ac.from, ac.to, lift, 22), r: 5, c: INK.aim, a: 0.75, t: ac.at, d: ac.dur });
    // (the meteor: its way down the sky, the last part of it - where it comes in from)
    if ( ac.kind === "meteor" && ac.g > 0 ) { const W = wayOf(ac, ac.g); out.push({ k: "dots", pts: Array.from({ length: 19 }, (_, i) => screenOf(W, 0.45 + 0.55 * i / 18, lift).map((v) => round(v, 10))), r: 5, c: INK.aim, a: 0.7, t: ac.at, d: -ac.at }); }
  }
  for ( const rec of plan.destruction ?? [] ) {
    rec.discs.forEach((dc, i) => {
      const t = (rec.at ?? 0) + (rec.path?.[i]?.[2] ?? 0);
      out.push({ k: "disc", x: dc[0], y: dc[1], r: dc[2], sq: 1, z: 0, c: INK.destruction[clamp((dc[3] ?? 2) - 1, 0, 2)], a: rec.path ? 0.6 : 0.5, t, d: 2600 });
      // a crater (not a gun's hit): its rim glows, so its size reads at a glance
      if ( !rec.path ) out.push({ k: "ring", x: dc[0], y: dc[1], r: dc[2], sq: 1, z: 0, w: Math.max(3, dc[2] * 0.16), c: INK.rim, a: 0.55, t, d: 2600 });
    });
  }
  for ( const s of plan.pending?.dust ?? [] ) {
    if ( s.pts ) for ( const p of s.pts ) out.push({ k: "disc", x: p[0], y: p[1], r: s.r * 1.4, sq, z: 0, c: INK.dust, a: 0.18, t: s.at + (p[2] ?? 0), d: 2200 });
    else out.push({ k: "ring", x: s.x, y: s.y, r: s.r, sq, z: 0, w: Math.max(4, s.r * 0.22), c: INK.dust, a: 0.32, t: s.at, d: 3000 });
  }
  for ( const b of plan.pending?.burst ?? [] ) out.push({ k: "disc", x: b.x, y: b.y, r: b.r, sq, z: b.r * 0.35 * lift, c: INK.burst, a: 0.5, t: b.at, d: 900 });
  for ( const s of plan.fire ?? [] ) {
    const pts = s.p.length > 2 ? [[s.p[0], s.p[1]], [(s.p[0] + s.p[2]) / 2, (s.p[1] + s.p[3]) / 2], [s.p[2], s.p[3]]] : [[s.p[0], s.p[1]]];
    const smoke = s.k === "smoke", t = s.q - T0, d = s.o ? Math.min(6000, s.o - s.q) : 6000;
    for ( const p of pts ) out.push({ k: "disc", x: p[0], y: p[1], r: s.r * (smoke ? 1.3 : 0.85), sq: smoke ? sq : 1, z: smoke ? s.r * lift : 0, c: smoke ? INK.smoke : INK.fire, a: smoke ? 0.3 : 0.55, t, d });
  }
  return out;
}
export function lineDots(a, b, step) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.min(80, Math.round(L / step)));
  return Array.from({ length: n + 1 }, (_, i) => [round(a[0] + (b[0] - a[0]) * i / n, 10), round(a[1] + (b[1] - a[1]) * i / n, 10)]);
}
/** A throw's arc: a parabola of height 0.35 x its length, drawn `lift` px up the screen per px of height. */
export function arcDots(a, b, lift, n) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), h = L * 0.35;
  return Array.from({ length: n + 1 }, (_, i) => { const u = i / n; return [round(a[0] + (b[0] - a[0]) * u, 10), round(a[1] + (b[1] - a[1]) * u - lift * h * 4 * u * (1 - u), 10)]; });
}
/**
 * The dry run at time `now` (ms from T0) of a ghost: each shape's alpha factor 0..1 (0 = not shown): it swells in over 220 ms,
 * holds and fades over its last 40 %. Smooth (smoothstep), never a pop.
 */
export function dryAlpha(s, now) {
  const u = now - s.t; if ( u < 0 || u > s.d ) return 0;
  const sm = (x) => { const c = clamp(x, 0, 1); return c * c * (3 - 2 * c); };
  return Math.min(sm(u / 220), sm((s.d - u) / (s.d * 0.4)));
}
/** How long a dry run lasts (ms after T0, capped). */
export const dryEnd = (ghost) => Math.min(9000, Math.max(0, ...ghost.map((s) => s.t + s.d)));
/** The soft rings that make one feathered shape: [scale, alpha share] from the outside in (no hard edge). */
export const FEATHER = [[1.3, 0.12], [1.15, 0.18], [1.0, 0.22], [0.82, 0.24], [0.6, 0.24]];
/** The same for a ring: [width scale, alpha share], widest and faintest first. */
export const RING_FEATHER = [[2.2, 0.2], [1.4, 0.3], [0.7, 0.5]];

/* ---------------------------------------------------------------- the editor (custom presets) */

/** The values the editor shows per layer kind: [field, min, max, step]. */
export const FIELDS = {
  destruction: [["level", 1, 3, 1], ["r", 0.05, 4, 0.05]],
  fire: [["lv", 1, 3, 1], ["r", 0.05, 2, 0.05]],
  smoke: [["sm", 1, 3, 1], ["r", 0.05, 3, 0.05]],
  burst: [["lv", 1, 3, 1], ["r", 0.1, 4, 0.05]],
  dust: [["lv", 1, 3, 1], ["r", 0.1, 6, 0.1]],
  accent: [["dur", 100, 4000, 50]],
  cue: [["shake", 0, 1, 0.05], ["flash", 0, 1, 0.05]],
  light: [["peak", 0, 1.5, 0.05], ["radius", 0.5, 10, 0.5]]
};
export const fieldsOf = (L) => (L.l === "cue" && L.kind === "light" ? FIELDS.light : FIELDS[L.l] ?? []);
/** A field's value (a range shows its middle). */
export function getField(L, k) {
  const v = L[k];
  if ( Array.isArray(v) ) return round((v[0] + v[1]) / 2, 1000);
  return isNum(v) ? v : (fieldsOf(L).find((f) => f[0] === k)?.[1] ?? 0);
}
/** Set a field (a range is scaled so its middle is `v`, keeping its spread); returns the new layer. */
export function setField(L, k, v) {
  const f = fieldsOf(L).find((x) => x[0] === k); if ( !f ) return L;
  const val = clamp(Math.round(v / f[3]) * f[3], f[1], f[2]);
  const old = L[k];
  if ( Array.isArray(old) ) { const m = (old[0] + old[1]) / 2 || 1, s = val / m; return { ...L, [k]: [round(old[0] * s, 1000), round(old[1] * s, 1000)] }; }
  return { ...L, [k]: round(val, 1000) };
}
/** The definition a firing uses: the layers switched off are left out. */
export const effective = (def) => ({ ...def, layers: def.layers.filter((L) => !L.off) });
/** A copy of a definition as a new custom preset (`name` its plain name). */
export function duplicate(def, name, ids) {
  const base = def.id.slice(0, 24);
  let id = `${base}-copy`, n = 2;
  while ( ids.includes(id) ) id = `${base}-copy${n++}`;
  const copy = JSON.parse(JSON.stringify(def));
  return { ...copy, id, name, hint: "", set: "custom", custom: true };
}

/**
 * The timeline of a definition: a row per layer { i, id, l, kind, off, start, end, long } (ms from T0; `long`: it lasts past the
 * strip), and the strip's span { from, to } (the pre-roll .. at most 8 s).
 */
export function timelineOf(def) {
  const rows = def.layers.map((L, i) => {
    const at = Array.isArray(L.at) ? L.at : [isNum(L.at) ? L.at : 0, isNum(L.at) ? L.at : 0];
    const life = Array.isArray(L.life) ? L.life[1] : isNum(L.life) ? L.life : null;
    const len = isNum(L.dur) ? L.dur : L.kind === "light" && isNum(L.decay) ? L.decay : life ?? (L.aftermath ? (def.aftermath?.dur ?? 600) * 1000 : L.l === "destruction" ? 1200 : 500);
    return { i, id: L.id ?? `${L.l}${i}`, l: L.l, kind: L.kind ?? L.dk ?? null, off: !!L.off, start: at[0], end: at[1] + len, long: false };
  });
  const from = Math.min(0, -(def.preroll ?? 0), ...rows.map((r) => r.start)), to = Math.min(8000, Math.max(1500, ...rows.map((r) => Math.min(r.end, 8000))));
  for ( const r of rows ) { r.long = r.end > to; r.end = Math.min(r.end, to); }
  return { rows, from, to };
}
/** Move a layer's start by `dms` (both ends of a range), snapped to 50 ms, kept within the expander's limits. */
export function shiftAt(L, dms) {
  const s = (v) => clamp(Math.round((v + dms) / 50) * 50, -4000, 120000);
  return { ...L, at: Array.isArray(L.at) ? [s(L.at[0]), s(L.at[1])] : s(isNum(L.at) ? L.at : 0) };
}
