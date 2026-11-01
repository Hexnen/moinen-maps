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
export const VERSION = 2;
/** Damage types, by index (bits 2-4 of a mask byte). */
export const TYPES = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];
export const MATERIALS = ["auto", "grass", "earth", "stone", "wood", "sand", "snow", "water", "metal"];
export const LEVELS = [1, 2, 3];
/**
 * Causes (what did the damage), by index: a stroke object's `c` (missing / 0: unspecified, it takes the scene default
 * `params.cause`; both 0: the look from before causes, bit for bit). Same order as core.mjs CAUSES.
 */
export const CAUSES = ["none", "fire", "acid", "lightning", "arcane", "impact", "claws", "water", "decay", "frost"];
/** Mask pixels per art pixel along each axis. */
export const K = 2;
const MAX_ART = 4e6;          // art pixels of the whole scene (2000 x 2000): above that the art pixel grows, so a bake never exceeds ~100 MB

export const PARAM_DEFAULTS = { debris: 0.7, scatter: 1, lift: 1, rubble: 0.6, halo: 0.6, edge: 0.7, material: "auto", jagged: false, jag: 0.6, directional: false,
  anim: true, idle: true, fxWho: "all", entry: true, entrySpeed: 1, entryPower: 1, cause: 0 };
export const LIMITS = { debris: [0, 1], scatter: [0.3, 2], lift: [0, 1.6], rubble: [0, 1], halo: [0, 1], edge: [0, 1], jag: [0.1, 1], entrySpeed: [0.4, 2.5], entryPower: [0.3, 1.6] };

let REV = 0;
export const nextRev = () => ++REV;

/** A cause index from anything (a number, a numeric string, a cause's name); unknown -> 0. */
export const causeOf = (v) => {
  if ( typeof v === "string" && CAUSES.includes(v) ) return CAUSES.indexOf(v);
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n < CAUSES.length ? n : 0;
};
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

/*
 * DAMAGE OBJECTS (flag v2). Every brush stroke is an object of its own, in creation order:
 *   { id, k (0 damage, 1 erase), t (type), x0, y0, w, h (its box in mask pixels), m (run-length bytes of the box: level per pixel),
 *     p (its brush path, flat [x, y, ms, ...] in art px, when it follows the stroke), c (its cause, see CAUSES; absent = unspecified) }
 * An object is baked from its own pixels only and never changes when later strokes are painted: a later stroke is drawn over it and
 * covers it where it lies (at display time), an erase stroke is a cover of plain map. `S.mask` is the composite (later strokes win,
 * erase clears), used for the painting overlay, the bake key and "is anything painted".
 * Flags of the first format (one merged mask `m`) convert on load: every connected region of one type (8-connected, in scan order)
 * becomes one object, the same on every client.
 */
const boxBytes = new WeakMap();
/** An object's level bytes (w * h), decoded once. */
export function objBytes(o) {
  let b = boxBytes.get(o);
  if ( !b ) { b = rleDecode(o.m, o.w * o.h); boxBytes.set(o, b); }
  return b;
}

/** A new object from a full-grid buffer of levels (0 = not painted) inside `box` (mask px). */
export function makeObject(buf, mw, box, { id, erase = false, type = 0, path = null, cause = 0 } = {}) {
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1, b = new Uint8Array(w * h);
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) b[y * w + x] = buf[(box.y0 + y) * mw + box.x0 + x] & 3;
  const o = { id, k: erase ? 1 : 0, t: type & 7, x0: box.x0, y0: box.y0, w, h, m: rleEncode(b) };
  // its cause, only when it has one (an unspecified stroke stays as it was stored before causes existed)
  const c = causeOf(cause);
  if ( c && !erase ) o.c = c;
  if ( path?.length ) o.p = path;
  boxBytes.set(o, b);
  return o;
}

/** A copy of a stroke object with another cause (0: unspecified, the field goes); its decoded bytes come along. */
export function withCause(o, cause) {
  const c = causeOf(cause), n = { ...o };
  delete n.c;
  if ( c && !o.k ) n.c = c;
  const b = boxBytes.get(o); if ( b ) boxBytes.set(n, b);
  return n;
}

/** The composite mask: objects in order, a later one wins where it is painted, an erase clears. */
export function composite(S) {
  const m = S.mask ?? new Uint8Array(S.mw * S.mh);
  m.fill(0);
  for ( const o of S.objects ?? [] ) {
    const b = objBytes(o);
    for ( let y = 0; y < o.h; y++ ) {
      const Y = o.y0 + y; if ( Y < 0 || Y >= S.mh ) continue;
      for ( let x = 0; x < o.w; x++ ) {
        const l = b[y * o.w + x]; if ( !l ) continue;
        const X = o.x0 + x; if ( X < 0 || X >= S.mw ) continue;
        m[Y * S.mw + X] = o.k ? 0 : byteOf(l, o.t);
      }
    }
  }
  S.mask = m;
  return m;
}

/** First-format mask -> objects: each connected region of one type (8-connected, scan order) is one object. */
export function objectsFromMask(mask, mw, mh) {
  const seen = new Uint8Array(mask.length), out = [], stack = [];
  for ( let s0 = 0; s0 < mask.length; s0++ ) {
    if ( !(mask[s0] & 3) || seen[s0] ) continue;
    const T = typeOf(mask[s0]), px = [];
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    seen[s0] = 1; stack.push(s0);
    while ( stack.length ) {
      const i = stack.pop(); px.push(i);
      const x = i % mw, y = (i - x) / mw;
      if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y;
      for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) {
        const X = x + dx, Y = y + dy; if ( X < 0 || Y < 0 || X >= mw || Y >= mh ) continue;
        const j = Y * mw + X; if ( !seen[j] && (mask[j] & 3) && typeOf(mask[j]) === T ) { seen[j] = 1; stack.push(j); }
      }
    }
    const buf = new Uint8Array(mask.length);
    for ( const i of px ) buf[i] = mask[i] & 3;
    out.push(makeObject(buf, mw, { x0, y0, x1, y1 }, { id: `c${s0.toString(36)}`, type: T }));
  }
  return out;
}

export function blank(scene = canvas.scene) {
  const ap = artPx(scene), g = grids(ap);
  return { ap, ...g, mask: new Uint8Array(g.mw * g.mh), objects: [], seed: 1 + Math.floor(Math.random() * 99998), params: { ...PARAM_DEFAULTS }, enabled: true, blast: null, baked: null, rev: nextRev(), entries: [] };
}

export function load(scene = canvas.scene) {
  const f = scene?.flags?.[MODULE_ID]?.[FLAG];
  if ( !f || !f.ap ) return null;
  const g = grids(f.ap);
  const S = {
    ap: f.ap, ...g, mask: new Uint8Array(g.mw * g.mh), seed: Number(f.seed) || 1,
    params: cleanParams(f.params), enabled: f.enabled !== false, blast: f.blast ?? null, baked: f.baked ?? null, rev: nextRev(),
    entries: Array.isArray(f.entries) ? f.entries : []
  };
  S.objects = Array.isArray(f.o) ? f.o.filter((o) => o && o.id && o.w > 0 && o.h > 0) : (f.m ? objectsFromMask(rleDecode(f.m, g.mw * g.mh), g.mw, g.mh) : []);
  composite(S);
  return S;
}

export function encode(S) {
  return { v: VERSION, ap: S.ap, seed: S.seed, enabled: S.enabled, params: S.params, o: S.objects ?? [], m: null, blast: S.blast ?? null, entries: S.entries ?? [], paths: null };
}

export function cleanParams(p = {}) {
  const out = { ...PARAM_DEFAULTS };
  for ( const [k, [lo, hi]] of Object.entries(LIMITS) ) if ( Number.isFinite(Number(p[k])) ) out[k] = Math.min(hi, Math.max(lo, Number(p[k])));
  if ( MATERIALS.includes(p.material) ) out.material = p.material;
  for ( const k of ["anim", "idle", "entry", "jagged", "directional"] ) if ( typeof p[k] === "boolean" ) out[k] = p[k];
  if ( p.fxWho === "gm" || p.fxWho === "all" ) out.fxWho = p.fxWho;
  out.cause = causeOf(p.cause);
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
