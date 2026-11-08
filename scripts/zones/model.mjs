import { MODULE_ID } from "../config.mjs";
import { BORDER_KINDS, cleanProps } from "./marks.mjs";

/**
 * The zones of a scene, stored in one scene flag `flags.moinen-maps.zones` (written by the GM, read by everyone):
 *
 *   { v: 1,
 *     s: [[id, [x, y, ...]], ...]       the pencil lines, scene pixels rounded to 0.1 (the zones are worked out from them on every client)
 *     next: id counter,
 *     preset: "invincible" | "none",    the movement rules counted in zones (scripts/zones/presets.mjs)
 *     smooth: 0.3,                      how much the lines are smoothed before the zones are worked out (0..1; the lines stay as drawn)
 *     snap: 0.25,                       an end of a line this close to another line (in grid squares) is joined to it
 *     w: [[x, y, kind], ...]           border marks (a point on the border: door, locked, wall, outer, reinforced; scripts/zones/marks.mjs)
 *     m: [[x, y, props], ...]          zone marks (a point inside the zone: features building/tall/water/terrain, states wrecked/fire/...)
 *     look: { who, fill, ink, numbers, color } }     numbers: "always" | "hover" (only the zone under the cursor) | "never"; place: "center" | "corner" (top left);
 *                                       hoverHi: the zone under the cursor lights its border; hoverFx: none | glow | hatch | crosshatch | dots inside it
 *
 * Arrays replace each other on update, so a save never leaves stale lines behind.
 */
export const FLAG = "zones";
export const VERSION = 1;

export const LOOK_DEFAULTS = Object.freeze({ who: "all", fill: 0.35, ink: 1, lineAlpha: 1, hoverAlpha: 1, hoverLineAlpha: 1, numbers: "always", place: "center", hoverHi: false, hoverFx: "glow", color: "#f3e7c9", lineStyle: "dashed", numColor: "", ringColor: "", numShape: "circle", numFormat: "arabic" });
export const LIMITS = { smooth: [0, 1], snap: [0, 1], fill: [0, 1], ink: [0, 2], lineAlpha: [0, 1], hoverAlpha: [0, 1], hoverLineAlpha: [0, 1] };
export const WHO = ["all", "gm", "none"];
export const NUMBERS = ["always", "hover", "never"];
export const PLACES = ["center", "corner"];
/** How a zone border is drawn. */
/** The zone number: its badge and how it is written. */
export const NUM_SHAPES = ["circle", "square", "hex", "diamond", "caption", "shield", "blossom", "seal", "plain", "counter", "pill", "scribble", "disc", "chip", "tag", "banner", "panel"];
export const NUM_FORMATS = ["arabic", "padded", "roman", "letters", "kanji"];
export const LINE_STYLES = ["dashed", "solid", "dotted", "dashdot", "double", "glow", "sketch", "comic", "ink", "neon", "noir", "sakura", "brush", "hairline", "halftone"];
/** What fills the zone under the cursor when "hoverHi" is on (besides its bright border). */
export const HOVER_FX = ["none", "glow", "hatch", "crosshatch", "dots", "scan", "blinds", "petals"];

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
    hoverLineAlpha: num(l.hoverLineAlpha, D.hoverLineAlpha, ...LIMITS.hoverLineAlpha),
    // older sets stored a boolean
    numbers: NUMBERS.includes(l.numbers) ? l.numbers : l.numbers === false ? "never" : D.numbers,
    place: PLACES.includes(l.place) ? l.place : D.place,
    hoverHi: l.hoverHi === true,
    hoverFx: HOVER_FX.includes(l.hoverFx) ? l.hoverFx : D.hoverFx,
    color: /^#[0-9a-f]{6}$/i.test(l.color ?? "") ? l.color : D.color,
    lineStyle: LINE_STYLES.includes(l.lineStyle) ? l.lineStyle : D.lineStyle,
    // number text and badge ring: "" = the border colour
    numColor: /^#[0-9a-f]{6}$/i.test(l.numColor ?? "") ? l.numColor : "",
    ringColor: /^#[0-9a-f]{6}$/i.test(l.ringColor ?? "") ? l.ringColor : "",
    numShape: NUM_SHAPES.includes(l.numShape) ? l.numShape : D.numShape,
    numFormat: NUM_FORMATS.includes(l.numFormat) ? l.numFormat : D.numFormat
  };
}

// preset null = the world's default movement preset; lookFrom null = the world's default look preset, "custom" = this scene's own look
export const blank = () => ({ strokes: new Map(), next: 1, preset: null, lookFrom: null, snap: 0.25, smooth: 0.3, look: cleanLook(), walls: [], marks: [] });

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
  S.preset = typeof f.preset === "string" && f.preset ? f.preset : null;
  // scenes saved before look presets keep the look they had (their own)
  S.lookFrom = "lookFrom" in f ? (typeof f.lookFrom === "string" && f.lookFrom ? f.lookFrom : null) : "custom";
  S.snap = num(f.snap, 0.25, ...LIMITS.snap);
  S.smooth = num(f.smooth, 0.3, ...LIMITS.smooth);
  S.look = cleanLook(f.look);
  for ( const [x, y, k] of Array.isArray(f.w) ? f.w.filter(Array.isArray) : [] ) if ( Number.isFinite(x) && Number.isFinite(y) && BORDER_KINDS.includes(k) && k !== "open" ) S.walls.push([x, y, k]);
  for ( const [x, y, p] of Array.isArray(f.m) ? f.m.filter(Array.isArray) : [] ) {
    const c = cleanProps(p && typeof p === "object" ? p : {});
    if ( Number.isFinite(x) && Number.isFinite(y) && Object.keys(c).length ) S.marks.push([x, y, c]);
  }
  S.next = Math.max(Number(f.next) || 1, ...[...S.strokes.keys()].map((k) => k + 1), 1);
  return S;
}

export function encode(S) {
  return {
    v: VERSION,
    s: [...S.strokes].map(([id, p]) => [id, p.map(r1)]),
    next: S.next, preset: S.preset, lookFrom: S.lookFrom, snap: S.snap, smooth: S.smooth,
    look: { ...S.look },
    w: S.walls.map(([x, y, k]) => [r1(x), r1(y), k]),
    m: S.marks.map(([x, y, p]) => [r1(x), r1(y), { ...p }])
  };
}

/** A copy that is exactly what every client decodes from the flag. */
export const canonical = (S) => load({ flags: { [MODULE_ID]: { [FLAG]: JSON.parse(JSON.stringify(encode(S))) } } });
