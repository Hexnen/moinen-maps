import { MODULE_ID } from "../config.mjs";

/**
 * The destruction of a scene: one painted mask on a grid of "mask pixels" (MPX scene pixels each), where every byte holds the damage
 * level (bits 0-1: 0 none, 1 cracked, 2 broken, 3 crater) and the damage type (bits 2-4, see TYPES), plus a seed and a few look
 * settings. Stored in the scene flag `destruction` (run-length encoded bytes), written by the GM, read by everyone.
 *
 * The pixel art is drawn on a grid twice as fine as the mask ("art pixels", AP scene pixels each, about 32 per grid square: the
 * pixel-art standard of moinen-pixel-vfx), so the torn outline can be ragged at art-pixel scale while the mask stays small.
 */
export const FLAG = "destruction";
export const VERSION = 1;
/** Damage types, by index (bits 2-4 of a mask byte). */
export const TYPES = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];
export const MATERIALS = ["auto", "grass", "earth", "stone", "wood", "sand", "snow", "water", "metal"];
export const LEVELS = [1, 2, 3];
/** Mask pixels per art pixel along each axis. */
export const K = 2;
const MAX_ART = 4e6;          // art pixels of the whole scene (2000 x 2000): above that the art pixel grows, so a bake never exceeds ~100 MB

export const PARAM_DEFAULTS = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", anim: true, idle: true, fxWho: "all" };
export const LIMITS = { debris: [0, 1], scatter: [0.3, 2], lift: [0, 1.6], rubble: [0, 1], halo: [0, 1], edge: [0, 1] };

let REV = 0;
export const nextRev = () => ++REV;

export const levelOf = (b) => b & 3;
export const typeOf = (b) => (b >> 2) & 7;
export const byteOf = (level, type) => (level & 3) | ((type & 7) << 2);

/* ---------------------------------------------------------------- run-length codec of bytes */

/** Bytes as base64 of (value, LEB128 run length) pairs. */
export function rleEncode(a) {
  const out = [];
  const put = (n) => { while ( n >= 128 ) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); };
  let i = 0;
  while ( i < a.length ) {
    const v = a[i]; let j = i + 1;
    while ( j < a.length && a[j] === v ) j++;
    out.push(v); put(j - i); i = j;
  }
  let s = "";
  for ( let k = 0; k < out.length; k += 8192 ) s += String.fromCharCode(...out.slice(k, k + 8192));
  return btoa(s);
}

export function rleDecode(str, n) {
  const a = new Uint8Array(n);
  if ( !str ) return a;
  let bin;
  try { bin = atob(str); } catch { return a; }
  let pos = 0, i = 0;
  while ( pos < bin.length && i < n ) {
    const v = bin.charCodeAt(pos++);
    let run = 0, mul = 1, b;
    do { b = bin.charCodeAt(pos++); run += (b & 127) * mul; mul *= 128; } while ( b & 128 && pos < bin.length );
    if ( v ) a.fill(v, i, Math.min(n, i + run));
    i += run;
  }
  return a;
}

/* ---------------------------------------------------------------- geometry */

export const sceneRect = (scene = canvas.scene) => canvas.dimensions?.sceneRect ?? { x: 0, y: 0, width: scene?.width ?? 1000, height: scene?.height ?? 1000 };

/** Art pixel size in scene pixels: about 32 per grid square, larger on huge scenes. */
export function artPx(scene = canvas.scene) {
  const r = sceneRect(scene), grid = canvas.grid?.size ?? scene?.grid?.size ?? 100;
  const least = Math.ceil(Math.sqrt((r.width * r.height) / MAX_ART));
  return Math.max(1, least, Math.round(grid / 32));
}

/** The art grid and the mask grid of a scene for an art pixel size. */
export function grids(ap, r = sceneRect()) {
  const aw = Math.max(1, Math.ceil(r.width / ap)), ah = Math.max(1, Math.ceil(r.height / ap));
  return { aw, ah, mw: Math.ceil(aw / K), mh: Math.ceil(ah / K), mpx: ap * K };
}

/* ---------------------------------------------------------------- the scene's destruction */

export function blank(scene = canvas.scene) {
  const ap = artPx(scene), g = grids(ap);
  return { ap, ...g, mask: new Uint8Array(g.mw * g.mh), seed: 1 + Math.floor(Math.random() * 99998), params: { ...PARAM_DEFAULTS }, enabled: true, blast: null, baked: null, rev: nextRev() };
}

export function load(scene = canvas.scene) {
  const f = scene?.flags?.[MODULE_ID]?.[FLAG];
  if ( !f || !f.ap ) return null;
  const g = grids(f.ap);
  return {
    ap: f.ap, ...g, mask: rleDecode(f.m, g.mw * g.mh), seed: Number(f.seed) || 1,
    params: cleanParams(f.params), enabled: f.enabled !== false, blast: f.blast ?? null, baked: f.baked ?? null, rev: nextRev()
  };
}

export function encode(S) {
  return { v: VERSION, ap: S.ap, seed: S.seed, enabled: S.enabled, params: S.params, m: rleEncode(S.mask), blast: S.blast ?? null };
}

export function cleanParams(p = {}) {
  const out = { ...PARAM_DEFAULTS };
  for ( const [k, [lo, hi]] of Object.entries(LIMITS) ) if ( Number.isFinite(Number(p[k])) ) out[k] = Math.min(hi, Math.max(lo, Number(p[k])));
  if ( MATERIALS.includes(p.material) ) out.material = p.material;
  for ( const k of ["anim", "idle"] ) if ( typeof p[k] === "boolean" ) out[k] = p[k];
  if ( p.fxWho === "gm" || p.fxWho === "all" ) out.fxWho = p.fxWho;
  return out;
}

export const hasPaint = (S) => !!S && S.mask.some((v) => v & 3);

/**
 * Stamp a disc (centre and radius in scene pixels). `mode`: "raise" (level up to `level`, the type follows), "deepen" (one level up,
 * at most 3) or "erase". Returns the box of mask pixels it touched, or null.
 */
export function stamp(S, cx, cy, radius, { mode = "raise", level = 2, type = 0, touched = null } = {}) {
  const r = sceneRect(), m = S.mask;
  const ax = (cx - r.x) / S.mpx, ay = (cy - r.y) / S.mpx, ar = Math.max(0.5, radius / S.mpx);
  const x0 = Math.max(0, Math.floor(ax - ar)), x1 = Math.min(S.mw - 1, Math.ceil(ax + ar));
  const y0 = Math.max(0, Math.floor(ay - ar)), y1 = Math.min(S.mh - 1, Math.ceil(ay + ar));
  if ( x1 < x0 || y1 < y0 ) return null;
  const r2 = ar * ar;
  let changed = false;
  for ( let y = y0; y <= y1; y++ ) for ( let x = x0; x <= x1; x++ ) {
    const dx = x + 0.5 - ax, dy = y + 0.5 - ay;
    if ( dx * dx + dy * dy > r2 ) continue;
    const i = y * S.mw + x, old = m[i];
    let v = old;
    if ( mode === "erase" ) v = 0;
    else if ( mode === "deepen" ) {
      // one level per stroke: a pixel already deepened in this stroke is left alone
      if ( touched?.has(i) ) continue;
      touched?.add(i);
      v = byteOf(Math.min(3, levelOf(old) + 1), levelOf(old) ? typeOf(old) : type);
    } else if ( levelOf(old) <= level ) v = byteOf(level, type);
    if ( v !== old ) { m[i] = v; changed = true; }
  }
  return changed ? { x0, y0, x1, y1 } : null;
}

/** The box (mask pixels) where two masks differ, or null. */
export function diffBox(a, b, mw) {
  if ( !a || !b || a.length !== b.length ) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for ( let i = 0; i < a.length; i++ ) if ( a[i] !== b[i] ) {
    const x = i % mw, y = (i - x) / mw;
    if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
