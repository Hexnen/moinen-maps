import { MODULE_ID } from "../config.mjs";

/**
 * The water of a scene: three painted masks (still water, river, fall) on a grid of "art pixels" (PX scene pixels each), plus the
 * engine's settings. Stored in the scene flag `water`; masks are run-length encoded.
 */
export const FLAG = "water";
export const LAYERS = ["water", "river", "fall"];
const MAX_PIXELS = 262144;     // 512 x 512 art pixels: about 5 s to bake and 170 MB in the worker; the cost grows faster than the area
let REV = 0;
/** A revision number no other set has had: the worker keys its cached masks by it. */
export const nextRev = () => ++REV;

/* ---------------------------------------------------------------- run-length codec */

/** A 0/1 array as base64 of LEB128 run lengths, alternating zeros and ones, starting with zeros. */
export function rleEncode(a) {
  const out = [];
  const put = (n) => { while ( n >= 128 ) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); };
  let cur = 0, run = 0;
  for ( let i = 0; i < a.length; i++ ) {
    const v = a[i] ? 1 : 0;
    if ( v === cur ) run++; else { put(run); cur = v; run = 1; }
  }
  put(run);
  let s = "";
  for ( let i = 0; i < out.length; i += 8192 ) s += String.fromCharCode(...out.slice(i, i + 8192));
  return btoa(s);
}

export function rleDecode(str, n) {
  const a = new Uint8Array(n);
  if ( !str ) return a;
  let bin;
  try { bin = atob(str); } catch { return a; }
  let pos = 0, cur = 0, i = 0;
  while ( pos < bin.length ) {
    let run = 0, mul = 1, b;
    do { b = bin.charCodeAt(pos++); run += (b & 127) * mul; mul *= 128; } while ( b & 128 && pos < bin.length );
    if ( cur ) a.fill(1, i, Math.min(n, i + run));
    i += run; cur ^= 1;
    if ( i >= n ) break;
  }
  return a;
}

/* ---------------------------------------------------------------- geometry */

/** The part of the scene the masks cover, in scene pixels. */
export const sceneRect = (scene = canvas.scene) => canvas.dimensions?.sceneRect ?? { x: 0, y: 0, width: scene?.width ?? 1000, height: scene?.height ?? 1000 };

/** A sensible art-pixel size for this scene: about an eighth of a grid square, and never more than MAX_PIXELS art pixels. */
export function defaultPx(scene = canvas.scene) {
  const r = sceneRect(scene), grid = canvas.grid?.size ?? scene?.grid?.size ?? 100;
  return clampPx(Math.round(grid / 8), r);
}
export function clampPx(px, r = sceneRect()) {
  const least = Math.ceil(Math.sqrt((r.width * r.height) / MAX_PIXELS));
  return Math.max(1, least, Math.round(px));
}
export const gridOf = (px, r = sceneRect()) => ({ w: Math.max(1, Math.ceil(r.width / px)), h: Math.max(1, Math.ceil(r.height / px)) });

/* ---------------------------------------------------------------- the scene's water */

/** A fresh, empty water set for a scene. `defaults` are the engine's default settings (from the worker). */
export function blank(defaults, scene = canvas.scene) {
  const px = defaultPx(scene), { w, h } = gridOf(px);
  return { px, w, h, masks: Object.fromEntries(LAYERS.map((l) => [l, new Uint8Array(w * h)])), params: foundry.utils.deepClone(defaults ?? {}), enabled: true, rev: nextRev() };
}

/** The scene's stored water, decoded, or null when nothing is stored. */
export function load(scene = canvas.scene) {
  const f = scene?.flags?.[MODULE_ID]?.[FLAG];
  if ( !f || !f.px ) return null;
  const { w, h } = gridOf(f.px);
  const masks = {};
  for ( const l of LAYERS ) masks[l] = rleDecode(f.m?.[l], w * h);
  return { px: f.px, w, h, masks, params: foundry.utils.deepClone(f.params ?? {}), enabled: f.enabled !== false, rev: nextRev(), baked: f.baked ?? null };
}

/** The flag payload of a water set. */
export function encode(S) {
  return { v: 1, px: S.px, enabled: S.enabled, params: S.params, m: Object.fromEntries(LAYERS.map((l) => [l, rleEncode(S.masks[l])])) };
}

export const hasPaint = (S) => LAYERS.some((l) => S.masks[l].some((v) => v));

/** The masks on a new art-pixel size (nearest neighbour), keeping what is painted where it is. */
export function resample(S, px) {
  const r = sceneRect(), np = clampPx(px, r), { w, h } = gridOf(np, r);
  const masks = {};
  for ( const l of LAYERS ) {
    const out = new Uint8Array(w * h), src = S.masks[l];
    for ( let y = 0; y < h; y++ ) {
      const sy = Math.min(S.h - 1, Math.floor(((y + 0.5) * np) / S.px));
      for ( let x = 0; x < w; x++ ) out[y * w + x] = src[sy * S.w + Math.min(S.w - 1, Math.floor(((x + 0.5) * np) / S.px))];
    }
    masks[l] = out;
  }
  return { ...S, px: np, w, h, masks, rev: nextRev() };
}

/** Stamp a disc (centre and radius in scene pixels) into one mask. Returns the box of art pixels it touched, or null. */
export function stamp(S, layer, cx, cy, radius, value) {
  const r = sceneRect(), m = S.masks[layer];
  const ax = (cx - r.x) / S.px, ay = (cy - r.y) / S.px, ar = Math.max(0.5, radius / S.px);
  const x0 = Math.max(0, Math.floor(ax - ar)), x1 = Math.min(S.w - 1, Math.ceil(ax + ar));
  const y0 = Math.max(0, Math.floor(ay - ar)), y1 = Math.min(S.h - 1, Math.ceil(ay + ar));
  if ( x1 < x0 || y1 < y0 ) return null;
  const v = value ? 1 : 0, r2 = ar * ar;
  let changed = false;
  for ( let y = y0; y <= y1; y++ ) for ( let x = x0; x <= x1; x++ ) {
    const dx = x + 0.5 - ax, dy = y + 0.5 - ay;
    if ( dx * dx + dy * dy <= r2 && m[y * S.w + x] !== v ) { m[y * S.w + x] = v; changed = true; }
  }
  return changed ? { x0, y0, x1, y1 } : null;
}
