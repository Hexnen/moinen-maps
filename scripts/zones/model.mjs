import { MODULE_ID } from "../config.mjs";

/**
 * The zones of a scene, stored in one scene flag `flags.moinen-maps.zones` (written by the GM, read by everyone):
 *
 *   { v: 1,
 *     s: [[id, [x, y, ...]], ...]       the pencil lines, scene pixels rounded to 0.1 (the zones are worked out from them on every client)
 *     next: id counter,
 *     preset: "invincible" | "none",    the movement rules counted in zones (scripts/zones/presets.mjs)
 *     smooth: 0.3,                      how much the lines are smoothed before the zones are worked out (0..1; the lines stay as drawn)
 *     snap: 0.25,                       an end of a line this close to another line (in grid squares) is joined to it
 *     look: { who, fill, ink, numbers, color } }     numbers: "always" | "hover" (only the zone under the cursor) | "never"; place: "center" | "corner" (top left);
 *                                       hoverHi: the zone under the cursor lights its border; hoverFx: none | glow | hatch | crosshatch | dots inside it
 *
 * Arrays replace each other on update, so a save never leaves stale lines behind.
 */
export const FLAG = "zones";
export const VERSION = 1;

export const LOOK_DEFAULTS = Object.freeze({ who: "all", fill: 0.35, ink: 1, lineAlpha: 1, hoverAlpha: 1, numbers: "always", place: "center", hoverHi: false, hoverFx: "glow", color: "#f3e7c9" });
export const LIMITS = { smooth: [0, 1], snap: [0, 1], fill: [0, 1], ink: [0, 2], lineAlpha: [0, 1], hoverAlpha: [0, 1] };
export const WHO = ["all", "gm", "none"];
export const NUMBERS = ["always", "hover", "never"];
export const PLACES = ["center", "corner"];
/** What fills the zone under the cursor when "hoverHi" is on (besides its bright border). */
export const HOVER_FX = ["none", "glow", "hatch", "crosshatch", "dots"];

const r1 = (v) => Math.round(v * 10) / 10;
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export function cleanLook(l = {}) {
  const D = LOOK_DEFAULTS;
  return {
    who: WHO.includes(l.who) ? l.who : D.who,
    fill: num(l.fill, D.fill, ...LIMITS.fill),
    ink: num(l.ink, D.ink, ...LIMITS.ink),
    lineAlpha: num(l.lineAlpha, D.lineAlpha, ...LIMITS.lineAlpha),
    hoverAlpha: num(l.hoverAlpha, D.hoverAlpha, ...LIMITS.hoverAlpha),
    // older sets stored a boolean
    numbers: NUMBERS.includes(l.numbers) ? l.numbers : l.numbers === false ? "never" : D.numbers,
    place: PLACES.includes(l.place) ? l.place : D.place,
    hoverHi: l.hoverHi === true,
    hoverFx: HOVER_FX.includes(l.hoverFx) ? l.hoverFx : D.hoverFx,
    color: /^#[0-9a-f]{6}$/i.test(l.color ?? "") ? l.color : D.color
  };
}

export const blank = () => ({ strokes: new Map(), next: 1, preset: "invincible", snap: 0.25, smooth: 0.3, look: cleanLook() });

/** The scene's stored zones, decoded (an empty set when nothing is stored). */
export function load(scene) {
  const f = scene?.flags?.[MODULE_ID]?.[FLAG];
  const S = blank();
  if ( !f || typeof f !== "object" ) return S;
  for ( const row of Array.isArray(f.s) ? f.s : [] ) {
    const [id, p] = row ?? [];
    if ( !Number.isFinite(id) || !Array.isArray(p) ) continue;
    const pts = p.filter(Number.isFinite);
    if ( pts.length >= 4 ) S.strokes.set(id, pts.slice(0, pts.length & ~1));
  }
  S.preset = typeof f.preset === "string" ? f.preset : "invincible";
  S.snap = num(f.snap, 0.25, ...LIMITS.snap);
  S.smooth = num(f.smooth, 0.3, ...LIMITS.smooth);
  S.look = cleanLook(f.look);
  S.next = Math.max(Number(f.next) || 1, ...[...S.strokes.keys()].map((k) => k + 1), 1);
  return S;
}

export function encode(S) {
  return {
    v: VERSION,
    s: [...S.strokes].map(([id, p]) => [id, p.map(r1)]),
    next: S.next, preset: S.preset, snap: S.snap, smooth: S.smooth,
    look: { ...S.look }
  };
}

/** A copy that is exactly what every client decodes from the flag. */
export const canonical = (S) => load({ flags: { [MODULE_ID]: { [FLAG]: JSON.parse(JSON.stringify(encode(S))) } } });
