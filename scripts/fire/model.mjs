/**
 * FIRE AND SMOKE, the pure part (no Foundry, no PIXI: node-tested in dev/fire-model.test.mjs). A layer of its own drawn OVER the
 * destruction layer. What is stored, in two scene flags (written by the GM, read by every client, nothing is ever uploaded or baked):
 *
 *   flags.moinen-maps.fire          the layer's settings: { v, on, who, smoke, flame, plume, speed, light, lightRadius, lightIntensity,
 *                                   lightColor, lightFlicker }  (PARAM_DEFAULTS)
 *   flags.moinen-maps.fireStrokes   { [id]: stroke }: every brush stroke an object of its own (an add or a delete touches one key, so
 *                                   two edits never overwrite each other)
 *     stroke = { id, k: "fire" | "smoke" | "erase", s: strength 0.1..1, r: radius (scene px), p: [x0, y0, x1, y1, ...] (scene px,
 *                whole numbers), wd: wind direction (degrees, screen: 0 = right, 90 = down), ws: wind 0..1, q: order (ms on the
 *                shared clock when it was made), sd: seed }
 *   The look settings a stroke needs on its own (strength, size, wind) are PINNED on it, as destruction pins its cause; the scene keeps
 *   what is shared (flame height, plume length, how much smoke a fire gives off, the light).
 *
 * From the strokes every client computes the same thing:
 *  1. AREAS: each stroke's reach (its path, the flame tongues above it, its smoke plume downwind) as a rectangle of art cells; strokes
 *     whose reaches overlap form one area (union-find). An eraser belongs to every area it touches. An area's KEY is a hash of its
 *     strokes and the settings: an unchanged area keeps its texture and mesh.
 *  2. THE FIELD of an area (`raster`): one RGBA8 texel per art cell -
 *       R = flame heat (the burning ground and the tongues above it: heat decays row by row upwards, so tongues are as tall as the fire
 *           is strong), G = smoke density (smoke strokes plus what the fire gives off, carried along the plume - up the screen, bent by
 *           the area's wind - fading with distance), B = the burning ground itself, A = anything here.
 *     The GPU draws the flames and the smoke INSIDE these cells (scripts/fire/shader.mjs); the field changes only when a stroke does.
 *  3. LIGHTS (`lightsOf`): the burning cells binned and merged into a few clusters (a light per cluster, never per cell or particle).
 *  4. PARTICLES (`particleAt`): a pure function of (area, slot, time on the shared clock): no state, no spawning, the same embers and
 *     smoke puffs on every client at any frame rate.
 *
 * THE FIELD IS THE CONTRACT: the renderer takes any RGBA field + the area's rectangle, wind and seed. A destruction stroke that should
 * burn later only has to produce a field of its own (e.g. `raster` over a synthetic stroke of kind "fire" made from its outline, or its
 * mask written into R/B directly) - see `fieldFromMask` - and hand it to the same display (scripts/fire/display.mjs `setExtra`).
 */

export const FLAG = "fire";
export const STROKES = "fireStrokes";
export const VERSION = 1;
export const KINDS = ["fire", "smoke", "erase"];

export const PARAM_DEFAULTS = Object.freeze({
  on: true,              // the layer shows
  who: "all",            // "all" | "gm": who sees it
  smoke: 0.5,            // how much smoke a fire gives off on its own (0: none)
  flame: 1,              // flame height (x 0.8 grid squares at full strength)
  plume: 2.5,            // smoke plume length (grid squares at full strength)
  speed: 1,              // animation speed
  light: true,           // fire lights the scene (Foundry's own lighting)
  lightRadius: 1.5,      // the light's reach, a multiple of the burning area's size
  lightIntensity: 0.6,   // 0..1
  lightColor: "#ff8a3c",
  lightFlicker: 0.5      // 0 = steady
});
export const LIMITS = { s: [0.1, 1], r: [4, 4000], ws: [0, 1], smoke: [0, 1], flame: [0.3, 2.5], plume: [0, 8], speed: [0.2, 3],
  lightRadius: [0.5, 4], lightIntensity: [0, 1], lightFlicker: [0, 1] };
export const MAX_POINTS = 2000;
/** Largest field side (cells); the art grid of a scene is at most ~2000 x 2000 (destruction MAX_ART), so this never cuts a real area. */
export const MAX_SIDE = 4096;

const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const COLOR = /^#[0-9a-f]{6}$/i;

/** The layer's settings, cleaned (unknown keys dropped, numbers clamped). */
export function cleanParams(p = {}) {
  const D = PARAM_DEFAULTS, L = LIMITS, o = p && typeof p === "object" ? p : {};
  return {
    on: o.on !== false, who: o.who === "gm" ? "gm" : "all",
    smoke: num(o.smoke, D.smoke, ...L.smoke), flame: num(o.flame, D.flame, ...L.flame), plume: num(o.plume, D.plume, ...L.plume),
    speed: num(o.speed, D.speed, ...L.speed), light: o.light !== false,
    lightRadius: num(o.lightRadius, D.lightRadius, ...L.lightRadius), lightIntensity: num(o.lightIntensity, D.lightIntensity, ...L.lightIntensity),
    lightColor: COLOR.test(String(o.lightColor)) ? String(o.lightColor).toLowerCase() : D.lightColor,
    lightFlicker: num(o.lightFlicker, D.lightFlicker, ...L.lightFlicker)
  };
}

/** One stroke, cleaned; null when it is not a stroke (no id, no points, unknown kind). */
export function cleanStroke(o) {
  if ( !o || typeof o !== "object" || typeof o.id !== "string" || !/^[\w-]{1,32}$/.test(o.id) ) return null;
  const k = KINDS.includes(o.k) ? o.k : null; if ( !k ) return null;
  const raw = Array.isArray(o.p) ? o.p : [];
  const p = [];
  for ( let i = 0; i + 1 < raw.length && p.length < MAX_POINTS * 2; i += 2 ) {
    const x = Number(raw[i]), y = Number(raw[i + 1]);
    if ( Number.isFinite(x) && Number.isFinite(y) ) p.push(Math.round(x), Math.round(y));
  }
  if ( !p.length ) return null;
  return { id: o.id, k, s: Math.round(num(o.s, 0.8, ...LIMITS.s) * 100) / 100, r: Math.round(num(o.r, 50, ...LIMITS.r)), p,
    wd: Math.round(((Number(o.wd) || 0) % 360 + 360) % 360), ws: Math.round(num(o.ws, 0, ...LIMITS.ws) * 100) / 100,
    q: Number.isFinite(Number(o.q)) ? Number(o.q) : 0, sd: (Number(o.sd) >>> 0) || hashStr(o.id) };
}

/** The strokes of a flag value ({ id: stroke }), cleaned and in their order (q, then id). */
export function strokesOf(flag) {
  const out = [];
  for ( const v of Object.values(flag && typeof flag === "object" ? flag : {}) ) { const s = cleanStroke(v); if ( s ) out.push(s); }
  return out.sort(byOrder);
}
export const byOrder = (a, b) => (a.q - b.q) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A path thinned to a point every `step` scene px (the first and the last kept), as the flat list a stroke stores. */
export function thinPath(points, step) {
  const out = [];
  let lx = NaN, ly = NaN;
  for ( let i = 0; i < points.length; i++ ) {
    const [x, y] = points[i];
    if ( i === 0 || i === points.length - 1 || Math.hypot(x - lx, y - ly) >= step ) { out.push(Math.round(x), Math.round(y)); lx = x; ly = y; }
  }
  return out;
}

/* ---------------------------------------------------------------- hashing (deterministic, the same on every client) */

export function hashStr(s, h = 2166136261) { for ( let i = 0; i < s.length; i++ ) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
/** Integer hash of up to four integers -> [0, 1). */
export function hash4(a, b = 0, c = 0, d = 0) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (b | 0) ^ (h >>> 15), 0xc2b2ae35);
  h = Math.imul(h ^ (c | 0) ^ (h >>> 13), 0x27d4eb2f);
  h = Math.imul(h ^ (d | 0) ^ (h >>> 16), 0x165667b1);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* ---------------------------------------------------------------- geometry */

/** Wind as a unit vector times its strength (screen: +y down). */
export function windVec(wd, ws) { const a = (wd || 0) * Math.PI / 180; return [Math.cos(a) * (ws || 0), Math.sin(a) * (ws || 0)]; }
/** The direction smoke travels: up the screen, bent by the wind (strong wind can lay it flat or even push it down). Unit vector. */
export function plumeDir(wx, wy) {
  const x = wx * 1.6, y = -1 + wy * 1.6, l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

/** Grid-relative sizes (cells) for a geometry `geo` = { ap, ox, oy, grid } and the settings. */
export function sizes(geo, P) {
  const g = geo.grid / geo.ap;
  return { flameH: Math.max(3, g * 0.8 * P.flame), plumeL: Math.max(2, g * P.plume), cellsPerGrid: g };
}

/** A stroke's path in cells: [[x, y], ...] and its radius in cells. */
function cellPath(st, geo) {
  const pts = [];
  for ( let i = 0; i + 1 < st.p.length; i += 2 ) pts.push([(st.p[i] - geo.ox) / geo.ap, (st.p[i + 1] - geo.oy) / geo.ap]);
  return { pts, R: Math.max(0.75, st.r / geo.ap) };
}

/** What a stroke can reach (cells, integers, x1/y1 exclusive): its path, its flame tongues and its smoke plume. */
export function reachOf(st, geo, P) {
  const { pts, R } = cellPath(st, geo), Z = sizes(geo, P);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const [x, y] of pts ) { x0 = Math.min(x0, x - R); y0 = Math.min(y0, y - R); x1 = Math.max(x1, x + R); y1 = Math.max(y1, y + R); }
  const r = { x0, y0, x1, y1 };
  if ( st.k === "fire" ) r.y0 -= Z.flameH * st.s + 2;
  const smokes = st.k === "smoke" || (st.k === "fire" && P.smoke > 0);
  if ( smokes && P.plume > 0 ) {
    const [wx, wy] = windVec(st.wd, st.ws), [ux, uy] = plumeDir(wx, wy), E = Z.plumeL * (0.4 + 0.6 * st.s) * 2.4 + (st.k === "fire" ? Z.flameH * st.s : 0);
    const ex = ux * E, ey = uy * E;
    r.x0 = Math.min(r.x0, x0 + ex); r.x1 = Math.max(r.x1, x1 + ex); r.y0 = Math.min(r.y0, y0 + ey); r.y1 = Math.max(r.y1, y1 + ey);
    const spread = E * 0.15; r.x0 -= spread; r.x1 += spread;
  }
  return { x0: Math.floor(r.x0) - 2, y0: Math.floor(r.y0) - 2, x1: Math.ceil(r.x1) + 2, y1: Math.ceil(r.y1) + 2 };
}

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * The AREAS of a set of strokes: [{ id, key, rect (cells), strokes (in order, erasers included), wind: [wx, wy], seed }]. Strokes
 * whose reaches overlap share an area; an eraser joins every area it touches (and makes none of its own). Deterministic.
 */
export function areasOf(strokes, geo, P) {
  const list = strokes.filter((s) => s.k !== "erase"), erasers = strokes.filter((s) => s.k === "erase");
  const R = list.map((s) => reachOf(s, geo, P));
  const parent = list.map((_, i) => i);
  const find = (i) => { while ( parent[i] !== i ) i = parent[i] = parent[parent[i]]; return i; };
  // (merge until no two groups' rectangles overlap: a merged rectangle can reach a third stroke)
  let rects = R.map((r) => ({ ...r })), changed = true;
  while ( changed ) {
    changed = false;
    for ( let i = 0; i < list.length; i++ ) for ( let j = i + 1; j < list.length; j++ ) {
      const a = find(i), b = find(j); if ( a === b ) continue;
      if ( overlaps(rects[a], rects[b]) ) {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        parent[hi] = lo;
        rects[lo] = { x0: Math.min(rects[a].x0, rects[b].x0), y0: Math.min(rects[a].y0, rects[b].y0), x1: Math.max(rects[a].x1, rects[b].x1), y1: Math.max(rects[a].y1, rects[b].y1) };
        changed = true;
      }
    }
  }
  const groups = new Map();
  for ( let i = 0; i < list.length; i++ ) { const g = find(i); if ( !groups.has(g) ) groups.set(g, []); groups.get(g).push(list[i]); }
  const pkey = JSON.stringify([P.smoke, P.flame, P.plume, geo.ap, geo.ox, geo.oy, geo.grid]);
  const out = [];
  for ( const [g, members] of groups ) {
    const rect = rects[g];
    rect.x1 = Math.min(rect.x1, rect.x0 + MAX_SIDE); rect.y1 = Math.min(rect.y1, rect.y0 + MAX_SIDE);
    const er = erasers.filter((e) => overlaps(reachOf(e, geo, P), rect));
    const all = [...members, ...er].sort(byOrder);
    // the area's wind: the strength-weighted mean of its strokes' (an area is one plume direction)
    let wx = 0, wy = 0, wsum = 0;
    for ( const s of members ) { const [x, y] = windVec(s.wd, s.ws); wx += x * s.s; wy += y * s.s; wsum += s.s; }
    wx /= wsum || 1; wy /= wsum || 1;
    const id = members.map((s) => s.id).sort()[0];
    const key = `${id}:${hashStr(pkey + JSON.stringify(all.map((s) => [s.id, s.k, s.s, s.r, s.wd, s.ws, s.q, s.p.length, hashStr(s.p.join(","))])))}`;
    out.push({ id, key, rect, strokes: all, wind: [wx, wy], seed: hashStr(id) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/* ---------------------------------------------------------------- the field */

/** Stamp a stroke into `buf` (W x H floats, area origin x0, y0 in cells): op "max" (value v) or "erase". */
function stamp(buf, W, H, x0, y0, st, geo, op) {
  const { pts, R } = cellPath(st, geo), soft = Math.max(1, R * 0.35);
  const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((b, i) => [pts[i], b]);
  for ( const [a, b] of segs ) {
    const ax = a[0] - x0, ay = a[1] - y0, bx = b[0] - x0, by = b[1] - y0, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const cx0 = Math.max(0, Math.floor(Math.min(ax, bx) - R)), cx1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + R));
    const cy0 = Math.max(0, Math.floor(Math.min(ay, by) - R)), cy1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + R));
    for ( let y = cy0; y <= cy1; y++ ) for ( let x = cx0; x <= cx1; x++ ) {
      const px = x + 0.5 - ax, py = y + 0.5 - ay;
      const t = L2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / L2)) : 0;
      const d = Math.hypot(px - dx * t, py - dy * t);
      if ( d > R ) continue;
      const i = y * W + x;
      if ( op === "erase" ) { buf.F[i] = 0; buf.S[i] = 0; continue; }
      const e = Math.min(1, (R - d) / soft), v = st.s * (0.35 + 0.65 * e);
      const B = op === "fire" ? buf.F : buf.S;
      if ( v > B[i] ) B[i] = v;
    }
  }
}

/**
 * An area's FIELD: { w, h, data: Uint8Array RGBA (w * h * 4), emit: { fire: [[x, y], ...], smoke: [...] } (cells, area-local),
 * mass } - see the file header for the channels. Pure and deterministic (the same bytes on every client).
 */
export function raster(area, geo, P) {
  const { rect } = area, W = Math.max(1, rect.x1 - rect.x0), H = Math.max(1, rect.y1 - rect.y0), N = W * H;
  const buf = { F: new Float32Array(N), S: new Float32Array(N) };
  for ( const st of area.strokes ) stamp(buf, W, H, rect.x0, rect.y0, st, geo, st.k);
  return fieldFrom(buf.F, buf.S, W, H, area.wind, geo, P, area.seed);
}

/**
 * The field of burning ground `F` and smoke sources `S0` (W x H, 0..1 each): tongues, the smoke the fire gives off, the plume. The
 * entry point for any other source of fire (a destruction stroke's mask: `fieldFromMask`).
 */
export function fieldFrom(F, S0, W, H, wind, geo, P, seed = 1) {
  const N = W * H, Z = sizes(geo, P), Ht = new Float32Array(N), Sm = new Float32Array(N);
  // flame tongues: per column from the bottom up, the heat carried upwards loses 1 / flameH per row (tongues as tall as the fire is strong)
  const dec = 1 / Z.flameH;
  for ( let x = 0; x < W; x++ ) {
    let carry = 0;
    for ( let y = H - 1; y >= 0; y-- ) { const i = y * W + x; carry = Math.max(F[i], carry - dec); Ht[i] = carry; }
  }
  // smoke sources: the strokes' own and what the fire gives off (its tongues' upper half most)
  for ( let i = 0; i < N; i++ ) {
    const h = Ht[i], fs = P.smoke > 0 && h > 0 ? Math.min(1, P.smoke * 2.4 * h) : 0;
    Sm[i] = Math.max(S0[i], fs);
  }
  // the plume: carried along the plume direction one step of the dominant axis at a time (semi-Lagrangian, linear across), fading
  const [ux, uy] = plumeDir(wind[0], wind[1]), Pl = new Float32Array(N);
  if ( P.plume > 0 ) {
    const rows = Math.abs(uy) >= Math.abs(ux), stepLen = rows ? 1 / Math.abs(uy) : 1 / Math.abs(ux), keep = Math.exp(-stepLen / Z.plumeL);
    if ( rows ) {
      const dy = Math.sign(uy) || -1, dx = ux / Math.abs(uy);
      for ( let k = 0; k < H; k++ ) {
        const y = dy < 0 ? H - 1 - k : k, py = y - dy;
        for ( let x = 0; x < W; x++ ) {
          const i = y * W + x; let v = Sm[i];
          if ( py >= 0 && py < H ) {
            const sx = x - dx, x0 = Math.floor(sx), f = sx - x0;
            const a = x0 >= 0 && x0 < W ? Pl[py * W + x0] : 0, b = x0 + 1 >= 0 && x0 + 1 < W ? Pl[py * W + x0 + 1] : 0;
            v = Math.max(v, (a * (1 - f) + b * f) * keep);
          }
          Pl[i] = v;
        }
      }
    } else {
      const dx = Math.sign(ux), dy = uy / Math.abs(ux);
      for ( let k = 0; k < W; k++ ) {
        const x = dx < 0 ? W - 1 - k : k, px = x - dx;
        for ( let y = 0; y < H; y++ ) {
          const i = y * W + x; let v = Sm[i];
          if ( px >= 0 && px < W ) {
            const sy = y - dy, y0 = Math.floor(sy), f = sy - y0;
            const a = y0 >= 0 && y0 < H ? Pl[y0 * W + px] : 0, b = y0 + 1 >= 0 && y0 + 1 < H ? Pl[(y0 + 1) * W + px] : 0;
            v = Math.max(v, (a * (1 - f) + b * f) * keep);
          }
          Pl[i] = v;
        }
      }
    }
  } else Pl.set(S0);
  const data = new Uint8Array(N * 4), emitF = [], emitS = [];
  let mass = 0;
  for ( let i = 0; i < N; i++ ) {
    const r = Math.round(Math.min(1, Ht[i]) * 255), g = Math.round(Math.min(1, Pl[i]) * 255), b = Math.round(Math.min(1, F[i]) * 255);
    const o = i * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = r || g ? 255 : 0;
    mass += F[i];
  }
  // emitters: burning cells (embers) and smoke sources (puffs), evenly thinned to at most 240 / 160, deterministic
  for ( let i = 0; i < N; i++ ) {
    if ( F[i] >= 0.45 ) emitF.push(i);
    else if ( S0[i] >= 0.3 || (Ht[i] > 0.12 && Ht[i] < 0.3 && P.smoke > 0) ) emitS.push(i);
  }
  const thin = (L, n) => { if ( L.length <= n ) return L; const out = []; for ( let k = 0; k < n; k++ ) out.push(L[Math.floor((k + hash4(seed, k, 7) * 0.999) * L.length / n)]); return out; };
  const xy = (i) => [i % W, Math.floor(i / W)];
  return { w: W, h: H, data, mass, emit: { fire: thin(emitF, 240).map(xy), smoke: thin(emitS, 160).map(xy) }, plume: [ux, uy], burn: F };
}

/**
 * A field from a MASK of burning ground (any source, e.g. a destruction stroke later on): `mask` W x H bytes (0 = not burning, 255 =
 * full strength), optional smoke mask. The hook for "a destruction stroke carries fire": no strokes of this layer needed.
 */
export function fieldFromMask(mask, W, H, { smoke = null, wind = [0, 0], geo, P, seed = 1 } = {}) {
  const N = W * H, F = new Float32Array(N), S = new Float32Array(N);
  for ( let i = 0; i < N; i++ ) { F[i] = mask[i] / 255; if ( smoke ) S[i] = smoke[i] / 255; }
  return fieldFrom(F, S, W, H, wind, geo, cleanParams(P), seed);
}

/* ---------------------------------------------------------------- lights */

/**
 * The LIGHTS of the burning ground of some areas: the burning cells binned (bins of `bin` grid squares), the bins merged greedily
 * (closest centroids first) while they lie within a bin of each other or while there are more than `max`. One light per cluster:
 * { x, y (scene px), radius (scene px: lightRadius x the cluster's half-diagonal + half a square), strength 0..1, seed }.
 * `items`: [{ area, field }]. Deterministic (ties by input order).
 */
export function lightsOf(items, geo, P, { bin = 3, max = 24 } = {}) {
  const B = Math.max(2, Math.round(bin * geo.grid / geo.ap)), cl = [];
  for ( const { area, field } of items ) {
    const F = field.burn, W = field.w, H = field.h, bins = new Map();
    for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
      const v = F[y * W + x]; if ( v < 0.05 ) continue;
      const k = Math.floor(x / B) + Math.floor(y / B) * 65536;
      let c = bins.get(k); if ( !c ) bins.set(k, c = { m: 0, sx: 0, sy: 0, x0: x, y0: y, x1: x, y1: y, n: 0 });
      c.m += v; c.sx += x * v; c.sy += y * v; c.n++;
      if ( x < c.x0 ) c.x0 = x; if ( x > c.x1 ) c.x1 = x; if ( y < c.y0 ) c.y0 = y; if ( y > c.y1 ) c.y1 = y;
    }
    for ( const c of [...bins.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]) ) {
      cl.push({ m: c.m, n: c.n, cx: area.rect.x0 + c.sx / c.m, cy: area.rect.y0 + c.sy / c.m,
        x0: area.rect.x0 + c.x0, y0: area.rect.y0 + c.y0, x1: area.rect.x0 + c.x1 + 1, y1: area.rect.y0 + c.y1 + 1, seed: area.seed });
    }
  }
  const merge = (a, b) => {
    const m = a.m + b.m;
    return { m, n: a.n + b.n, cx: (a.cx * a.m + b.cx * b.m) / m, cy: (a.cy * a.m + b.cy * b.m) / m,
      x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), seed: (a.seed ^ b.seed) >>> 0 };
  };
  for ( ;; ) {
    let bi = -1, bj = -1, bd = Infinity;
    for ( let i = 0; i < cl.length; i++ ) for ( let j = i + 1; j < cl.length; j++ ) {
      const d = Math.hypot(cl[i].cx - cl[j].cx, cl[i].cy - cl[j].cy);
      if ( d < bd ) { bd = d; bi = i; bj = j; }
    }
    if ( bi < 0 || (bd > B * 1.25 && cl.length <= max) ) break;
    cl[bi] = merge(cl[bi], cl[bj]); cl.splice(bj, 1);
  }
  return cl.map((c, i) => {
    const half = Math.hypot(c.x1 - c.x0, c.y1 - c.y0) / 2 * geo.ap;
    return { x: geo.ox + c.cx * geo.ap, y: geo.oy + c.cy * geo.ap, radius: Math.round(P.lightRadius * (half + geo.grid / 2)),
      strength: Math.min(1, c.m / c.n), seed: (c.seed + i * 7919) >>> 0 };
  });
}

/** The light's flicker at shared time `now` (ms): stepped at 12 Hz (pixel-art pace), smooth noise between steps, 1 = full. Pure. */
export function flickerAt(now, seed, strength) {
  if ( !(strength > 0) ) return 1;
  const t = Math.floor(now / 83.333) / 12 * 3 + (seed % 1000) * 0.137, i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f);
  const a = hash4(seed, i), b = hash4(seed, i + 1), n = a + (b - a) * s;     // 0..1
  return 1 - strength * 0.45 * n;
}

/* ---------------------------------------------------------------- particles (pure) */

export const EMBER = [0xfff0a0, 0xffb030, 0xe0501c, 0x7a2a14];
export const PUFF = [0x4a4541, 0x5d5853, 0x77716b];

/**
 * Slot `k` of an area at shared time `now` (ms): null (resting between lives) or { x, y (cells, area-local, whole numbers: the art
 * grid), color, size (1 | 2), kind }. A pure function of its inputs: every client draws the same particle at the same moment, at any
 * frame rate, with no state kept between frames. `speed` the layer's animation speed, `wind` the area's [wx, wy].
 */
export function particleAt(field, seed, k, now, speed = 1, wind = [0, 0], g = 32) {
  const u = g / 32;   // (speeds below are for 32 cells per grid square: the module's art grid)
  const em = field.emit, puff = em.smoke.length && (k % 4 === 3 || !em.fire.length);
  const list = puff ? em.smoke : em.fire; if ( !list.length ) return null;
  const life = puff ? 1500 + hash4(seed, k, 1) * 1100 : 600 + hash4(seed, k, 1) * 800, period = life + hash4(seed, k, 2) * 900;
  const tt = now * speed + hash4(seed, k, 3) * period, cyc = Math.floor(tt / period), age = tt - cyc * period;
  if ( age >= life ) return null;
  const f = age / life, src = list[Math.floor(hash4(seed, k, cyc, 4) * list.length)], j = hash4(seed, k, cyc, 5), sec = age / 1000;
  if ( puff ) {
    if ( f > 0.8 && hash4(seed, k, cyc, Math.floor(age / 120)) < (f - 0.8) * 4 ) return null;     // dissolving: pixel dropout, no fade
    const rise = (5 + j * 4) * u, ux = wind[0] * 9 * u, uy = wind[1] * 9 * u;
    return { x: Math.round(src[0] + ux * sec + Math.sin(sec * 1.7 + j * 6) * 1.2 * u), y: Math.round(src[1] - rise * sec + uy * sec), color: PUFF[Math.min(2, Math.floor(f * 3))], size: 2, kind: "puff" };
  }
  const rise = (12 + j * 16) * u, sway = (0.8 + hash4(seed, k, cyc, 6) * 2) * u;
  return { x: Math.round(src[0] + wind[0] * 8 * u * sec + Math.sin(sec * 5 + j * 9) * sway), y: Math.round(src[1] - rise * sec), color: EMBER[Math.min(3, Math.floor(f * 4))], size: 1, kind: "ember" };
}

/** Particle slots an area gets out of `cap` shared by the visible areas (by their emitters), at least 2 when it has any. */
export function shareSlots(fields, cap) {
  const w = fields.map((f) => f ? Math.min(60, f.emit.fire.length + f.emit.smoke.length * 0.5) : 0), sum = w.reduce((a, b) => a + b, 0);
  if ( !cap || !sum ) return fields.map(() => 0);
  return w.map((x) => x ? Math.max(2, Math.floor(cap * x / sum)) : 0);
}

/* ---------------------------------------------------------------- culling */

/** Is an area's rectangle (cells) inside the view (scene px rectangle { x0, y0, x1, y1 }), grown by `margin` scene px? */
export function inView(rect, geo, view, margin = 0) {
  const x0 = geo.ox + rect.x0 * geo.ap, y0 = geo.oy + rect.y0 * geo.ap, x1 = geo.ox + rect.x1 * geo.ap, y1 = geo.oy + rect.y1 * geo.ap;
  return !(x0 > view.x1 + margin || y0 > view.y1 + margin || x1 < view.x0 - margin || y1 < view.y0 - margin);
}

/** The shader's time (seconds) at shared time `now` (ms): stepped at 12 frames a second, wrapped every 1000 s (float precision). */
export function shaderTime(now, speed = 1) { return (Math.floor(now * speed / 83.333) / 12) % 1000; }
