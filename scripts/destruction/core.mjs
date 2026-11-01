/**
 * The destruction bake: pure code (no DOM, no Foundry), run in a worker. From the painted mask and the map's own pixels it builds
 *
 *   1. ANALYSIS   the ragged outline at art-pixel scale, connected damage areas, a distance field (depth), one or more impact
 *                 epicentres (several along a long stroke), the material under each area (grass, earth, stone, wood, sand, snow,
 *                 water, metal: classified from the map's colours and grain);
 *   2. FRACTURE   a crack network grown from each epicentre: radial spokes and rings that widen with distance (small shards at the
 *                 centre, big plates at the rim), domain-warped so the crack lines are jagged;
 *   3. SHARDS     every cell is a piece of the REAL map (its pixels at its own place), given a fate by the local severity: stays
 *                 (cracked), tilts up / slumps (broken), is thrown out as chips or pulverised (crater). Each kept piece is rendered
 *                 as a rigid slab with the oblique top-down camera of the pixel-vfx standard (sx = x, sy = y - z/2): shaded top
 *                 face, a cross-section side, an inked silhouette, and a flat ground shadow;
 *   4. BENEATH    the pixel-art damage under the torn surface in a ramp derived from the map's own colours, dithered, with the
 *                 far wall's strata, rubble, joists under a wooden deck, water in a flooded hole, char and embers, a pit into
 *                 darkness; plus hairline cracks, scorch and dust halos and an inked lip on the intact map around it.
 *
 * Everything is deterministic from (mask, map pixels, seed, settings). The result is one sprite sheet (RGBA) whose last rows hold
 * the placement table, so a single PNG carries the whole bake.
 */

export const CORE_VERSION = 10;
export const TYPES = ["blast", "collapse", "scorch", "flood", "cracks", "gash"];
const T_BLAST = 0, T_COLLAPSE = 1, T_SCORCH = 2, T_FLOOD = 3, T_CRACKS = 4, T_GASH = 5;
export const MATS = ["grass", "earth", "stone", "wood", "sand", "snow", "water", "metal"];
const M = Object.fromEntries(MATS.map((m, i) => [m, i]));
/** int16 fields per sprite in the placement table. */
export const META_FIELDS = 16;

/* ================================================================ small maths */

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function h2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  const top = a + (b - a) * u, bot = c + (d - c) * u;
  return top + (bot - top) * v;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

/* ================================================================ colour */

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if ( mx === mn ) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if ( s <= 0 ) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
function mixHue(a, b, t) { let d = ((b - a + 540) % 360) - 180; return a + d * t; }
const mul = (c, f) => [clamp(Math.round(c[0] * f), 0, 255), clamp(Math.round(c[1] * f), 0, 255), clamp(Math.round(c[2] * f), 0, 255)];
const mix = (a, b, t) => [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];

/** A five-step ramp (dark -> light): hue-shifted, cool shadows and warm lights. */
function ramp(h, s, ls, shift = 9) {
  return ls.map((l, i) => hsl2rgb(h + (i - 2) * shift * (i < 2 ? -1.4 : 1), clamp(s * (i === 0 ? 0.85 : 1), 0, 1), l));
}

/* ================================================================ material */

/** Classify a set of map pixels: dominant colour, saturation, value, texture and grain direction. */
function classify(map, W, idx) {
  let n = 0, sr = 0, sg = 0, sb = 0, hx = 0, hy = 0, ssat = 0, sl = 0, sl2 = 0, gx = 0, gy = 0;
  const lum = (o) => 0.299 * map[o] + 0.587 * map[o + 1] + 0.114 * map[o + 2];
  const step = Math.max(1, Math.floor(idx.length / 4000));
  for ( let k = 0; k < idx.length; k += step ) {
    const i = idx[k], o = i * 4;
    const r = map[o], g = map[o + 1], b = map[o + 2];
    const [h, s, l] = rgb2hsl(r, g, b);
    sr += r; sg += g; sb += b; ssat += s; sl += l; sl2 += l * l;
    hx += Math.cos(h * Math.PI / 180) * s; hy += Math.sin(h * Math.PI / 180) * s;
    const x = i % W;
    if ( x + 1 < W ) gx += Math.abs(lum(o + 4) - lum(o));
    if ( i + W < map.length / 4 ) gy += Math.abs(lum(o + W * 4) - lum(o));
    n++;
  }
  if ( !n ) return { mat: M.earth, col: [110, 90, 70], hsl: [30, 0.3, 0.4], grainX: true };
  const col = [sr / n, sg / n, sb / n].map(Math.round);
  const hsl = rgb2hsl(...col);
  const hue = ((Math.atan2(hy, hx) * 180 / Math.PI) + 360) % 360, sat = ssat / n, l = sl / n;
  const tex = Math.sqrt(Math.max(0, sl2 / n - l * l));
  const aniso = Math.abs(gx - gy) / Math.max(1, gx + gy);
  let mat;
  if ( hue >= 175 && hue <= 255 && sat > 0.2 && l > 0.12 && l < 0.75 ) mat = M.water;
  else if ( l > 0.74 && sat < 0.16 ) mat = M.snow;
  else if ( sat < 0.13 ) mat = (tex < 0.045 && l < 0.6) ? M.metal : M.stone;
  else if ( hue >= 65 && hue < 175 && sat > 0.15 ) mat = M.grass;
  else if ( hue >= 32 && hue < 65 && sat > 0.2 && l > 0.52 ) mat = M.sand;
  else if ( hue >= 8 && hue < 50 && sat > 0.22 && aniso > 0.16 ) mat = M.wood;
  else if ( sat < 0.2 ) mat = M.stone;
  else mat = M.earth;
  return { mat, col, hsl: [hue, sat, l], tex, aniso, grainX: gx > gy };
}

/** The colours of what lies under a material's surface. */
function palette(cls, type) {
  const [h, s, l] = cls.hsl, P = {};
  const soilH = mixHue(h, 28, 0.8);
  switch ( cls.mat ) {
    case M.grass: P.ramp = ramp(soilH, clamp(0.32 + s * 0.15, 0.25, 0.5), [0.09, 0.15, 0.22, 0.3, 0.39]); P.strata = [ramp(soilH, 0.4, [0.24])[0], ramp(soilH, 0.3, [0.17])[0]]; break;
    case M.stone: P.ramp = ramp(h, Math.min(s, 0.12) * 0.7 + 0.04, [0.1, 0.17, 0.26, 0.36, 0.47], 6); P.strata = [hsl2rgb(h, 0.05, l * 0.62), hsl2rgb(28, 0.22, 0.2)]; break;
    case M.wood: P.ramp = ramp(mixHue(h, 260, 0.35), 0.18, [0.035, 0.06, 0.09, 0.13, 0.19], 5); P.strata = [hsl2rgb(h, s * 0.8, l * 0.55), hsl2rgb(h, s * 0.7, l * 0.4)]; P.beam = hsl2rgb(h, clamp(s * 0.9, 0, 0.6), clamp(l * 0.62, 0.12, 0.42)); break;
    case M.sand: P.ramp = ramp(h, clamp(s * 0.85, 0.15, 0.6), [l * 0.36, l * 0.48, l * 0.6, l * 0.72, l * 0.84].map((v) => clamp(v, 0.06, 0.8)), 5); P.strata = [hsl2rgb(h, s * 0.7, l * 0.62), hsl2rgb(h, s * 0.6, l * 0.5)]; break;
    case M.snow: P.ramp = ramp(25, 0.2, [0.1, 0.17, 0.25, 0.33, 0.43]); P.strata = [hsl2rgb(h, s, clamp(l * 0.82, 0.5, 0.9)), hsl2rgb(205, 0.2, 0.62)]; P.chunk = hsl2rgb(h, s, clamp(l * 1.02, 0.6, 0.95)); break;
    case M.water: P.ramp = ramp(h, clamp(s + 0.12, 0.3, 0.8), [0.07, 0.11, 0.16, 0.22, 0.3], 4); P.strata = [hsl2rgb(h, s, l * 0.7), hsl2rgb(h, s, l * 0.5)]; break;
    case M.metal: P.ramp = ramp(s > 0.03 ? h : 215, 0.09, [0.05, 0.09, 0.15, 0.23, 0.33], 4); P.strata = [hsl2rgb(h, s, l * 0.7), hsl2rgb(h, 0.05, 0.3)]; P.girder = hsl2rgb(25, 0.35, 0.28); break;
    default: P.ramp = ramp(soilH, clamp(0.3 + s * 0.2, 0.2, 0.55), [0.08, 0.14, 0.21, 0.29, 0.38]); P.strata = [hsl2rgb(soilH, 0.35, 0.26), hsl2rgb(soilH, 0.3, 0.18)];
  }
  P.char = ramp(18, 0.22, [0.045, 0.07, 0.1, 0.14, 0.19], 4);
  P.ember = [[255, 154, 60], [255, 211, 107], [214, 82, 38]];
  P.void = hsl2rgb(232, 0.3, 0.035);
  P.waterR = cls.mat === M.water ? ramp(h, clamp(s + 0.1, 0.3, 0.8), [0.1, 0.15, 0.22, 0.3, 0.42], 4) : ramp(203, 0.42, [0.1, 0.15, 0.22, 0.31, 0.44], 5);
  P.dust = hsl2rgb(h, s * 0.35, clamp(l * 1.05 + 0.08, 0.35, 0.8));
  P.ink = mul(P.ramp[0], 0.8);
  if ( type === T_SCORCH ) { P.ramp = P.char; P.strata = [P.char[2], P.char[1]]; }
  return P;
}

/* ================================================================ the bake */

/** Settings that only change playback, not the picture (never part of a bake key). */
export const LIVE_PARAMS = new Set(["anim", "idle", "fxWho", "entry", "entrySpeed", "entryPower"]);
function fnvInts(h, ...vals) { for ( const v of vals ) { h = Math.imul(h ^ (v & 0xffff), 16777619); h = Math.imul(h ^ ((v >>> 16) & 0xffff), 16777619); } return h; }
function fnvStr(s, h = 2166136261) { for ( let i = 0; i < s.length; i++ ) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h; }

/**
 * The whole bake, AREA BY AREA. Every damaged area (a connected part of the ragged field) is baked in its own window (its box plus
 * room for thrown debris, a function of the area alone), from window-local inputs only, and its result is cached by a hash of those
 * inputs. So an area looks exactly the same whatever else is painted elsewhere on the map (no "re-render" of earlier strokes), and
 * a new stroke only bakes the areas it touched.
 *
 * @param {object} I
 *   mask Uint8Array (mw*mh), mw, mh, K (art px per mask px), aw, ah (art grid), seed, params,
 *   map: { w: aw, h: ah, data: RGBA of the WHOLE scene at art resolution }, mapKey (identifies the map pixels), onProgress(p)
 * @param {Map} [cache]  area hash -> area result (kept by the worker between bakes)
 * @returns {{ sheet: {w, h, data: Uint8ClampedArray}, metaRows, meta: Int16Array, count, stats }}
 */
export function bake(I, cache = null) {
  const t0 = Date.now();
  const P = I.params, seed = I.seed | 0, K = I.K, AW = I.aw, AH = I.ah;
  const progress = I.onProgress ?? (() => {});
  const jag = P.jagged ? clamp(P.jag ?? 0.6, 0, 1) : 0;
  const paramStr = Object.keys(P).filter((k) => !LIVE_PARAMS.has(k)).sort().map((k) => `${k}=${JSON.stringify(P[k])}`).join("|");
  const head = fnvStr(`${CORE_VERSION}|${seed}|${paramStr}|${I.mapKey ?? ""}|${AW}x${AH}`);

  /* ---------------------------------------------------------------- 1. the ragged field (absolute art coordinates only) */
  let mx0 = Infinity, my0 = Infinity, mx1 = -1, my1 = -1;
  for ( let i = 0; i < I.mask.length; i++ ) if ( I.mask[i] & 3 ) { const x = i % I.mw, y = (i - x) / I.mw; if ( x < mx0 ) mx0 = x; if ( x > mx1 ) mx1 = x; if ( y < my0 ) my0 = y; if ( y > my1 ) my1 = y; }
  const stats = { areas: 0, shards: 0, chips: 0, pulverised: 0, materials: [], baked: 0, reused: 0 };
  if ( mx1 < 0 ) return assemble([], stats, t0, progress);
  const FM = 4 + (jag ? 22 : 0);
  const FX = Math.max(0, mx0 * K - FM), FY = Math.max(0, my0 * K - FM);
  const FW = Math.min(AW, (mx1 + 1) * K + FM) - FX, FH = Math.min(AH, (my1 + 1) * K + FM) - FY, FN = FW * FH;
  const inside = new Uint8Array(FN), sev = new Float32Array(FN), typ = new Uint8Array(FN), frag = new Int32Array(FN);
  const lv = (mx, my) => (mx < 0 || my < 0 || mx >= I.mw || my >= I.mh) ? 0 : (I.mask[my * I.mw + mx] & 3);
  const edge = clamp(P.edge ?? 0.7, 0, 1);
  for ( let y = 0; y < FH; y++ ) for ( let x = 0; x < FW; x++ ) {
    const ax = FX + x, ay = FY + y;
    // torn: the mask is read through a warp (two octaves, up to ~7 art px), so the outline tears into lobes and inlets
    let wx = 0, wy = 0;
    if ( jag ) {
      const A = 7 * jag;
      wx = (vnoise(ax / 7, ay / 7, seed + 310) - 0.5) * 2 * A + (vnoise(ax / 2.5, ay / 2.5, seed + 312) - 0.5) * 0.7 * A;
      wy = (vnoise(ax / 7, ay / 7, seed + 311) - 0.5) * 2 * A + (vnoise(ax / 2.5, ay / 2.5, seed + 313) - 0.5) * 0.7 * A;
    }
    const mx = (ax + wx + 0.5) / K - 0.5, my = (ay + wy + 0.5) / K - 0.5;
    const ix = Math.floor(mx), iy = Math.floor(my), fx = mx - ix, fy = my - iy;
    const a = lv(ix, iy), b = lv(ix + 1, iy), c = lv(ix, iy + 1), d = lv(ix + 1, iy + 1);
    if ( !(a | b | c | d) ) continue;
    const bil = lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
    let n = (vnoise(ax / 3.1, ay / 3.1, seed) - 0.5) * 1.1 * edge + (h2(ax, ay, seed + 7) - 0.5) * 0.45 * edge;
    if ( jag ) {
      // torn: three octaves of roughness, and bites and teeth in 2 x 2 art-pixel blocks (stepped, chipped lips)
      n += ((vnoise(ax / 1.7, ay / 1.7, seed + 301) - 0.5) * 1.0 + (vnoise(ax / 5.3, ay / 5.3, seed + 302) - 0.5) * 1.5 + (vnoise(ax / 11, ay / 11, seed + 303) - 0.5) * 1.2) * jag;
      const cb = h2(ax >> 1, ay >> 1, seed + 304);
      if ( cb < 0.13 * jag ) n -= 1.3; else if ( cb > 1 - 0.09 * jag ) n += 1;
    }
    const s = bil + n * Math.min(1, bil + 0.3);
    if ( s <= 0.5 ) continue;
    const i = y * FW + x;
    inside[i] = 1; sev[i] = clamp(bil, 1, 3);
    // the type of the strongest mask pixel around
    let best = -1, bt = 0;
    const cx = Math.floor((ax + wx + 0.5) / K), cy = Math.floor((ay + wy + 0.5) / K);
    for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) {
      const X = cx + dx, Y = cy + dy; if ( X < 0 || Y < 0 || X >= I.mw || Y >= I.mh ) continue;
      const v = I.mask[Y * I.mw + X], l = v & 3;
      const w = l * 4 - (dx * dx + dy * dy);
      if ( l && w > best ) { best = w; bt = (v >> 2) & 7; }
    }
    typ[i] = bt;
  }
  // tidy: no single-pixel whiskers, no pin holes
  for ( let pass = 0; pass < 2; pass++ ) for ( let y = 1; y < FH - 1; y++ ) for ( let x = 1; x < FW - 1; x++ ) {
    const i = y * FW + x, nb = inside[i - 1] + inside[i + 1] + inside[i - FW] + inside[i + FW];
    if ( inside[i] && nb <= 1 ) inside[i] = 0;
    else if ( !inside[i] && nb >= 3 ) { inside[i] = 1; sev[i] = Math.max(1, sev[i - 1], sev[i + 1], sev[i - FW], sev[i + FW]); typ[i] = typ[i - 1] || typ[i + 1] || typ[i - FW] || typ[i + FW]; }
  }
  if ( jag ) {
    // torn-off fragments just outside the rim: 2 x 2 blocks a few pixels out, of the type of the damage next to them
    const dist = new Float32Array(FN);
    for ( let i = 0; i < FN; i++ ) dist[i] = inside[i] ? 0 : 1e6;
    chamfer(dist, FW, FH);
    const reach = 2 + 4 * jag;
    for ( let y = 2; y < FH - 2; y++ ) for ( let x = 2; x < FW - 2; x++ ) {
      const i = y * FW + x, d = dist[i];
      if ( d < 2 || d > reach || h2((FX + x) >> 1, (FY + y) >> 1, seed + 305) >= 0.075 * jag ) continue;
      let bt = -1, bd = Infinity;
      for ( let dy = -7; dy <= 7; dy++ ) for ( let dx = -7; dx <= 7; dx++ ) {
        const X = x + dx, Y = y + dy; if ( X < 0 || Y < 0 || X >= FW || Y >= FH ) continue;
        const j = Y * FW + X; if ( !inside[j] || frag[j] ) continue;
        const dd = dx * dx + dy * dy; if ( dd < bd ) { bd = dd; bt = typ[j]; }
      }
      if ( bt < 0 ) continue;
      inside[i] = 1; sev[i] = 1.6; typ[i] = bt; frag[i] = -1;
    }
  }
  progress(0.1);

  /* ---------------------------------------------------------------- 2. connected areas (in scan order: stable anchors) */
  const lab = new Int32Array(FN).fill(-1);
  let comps = [];
  const stack = new Int32Array(FN);
  for ( let s0 = 0; s0 < FN; s0++ ) {
    if ( !inside[s0] || lab[s0] >= 0 ) continue;
    const id = comps.length, px = [];
    let sp = 0; stack[sp++] = s0; lab[s0] = id;
    while ( sp ) {
      const i = stack[--sp]; px.push(i);
      const x = i % FW, y = (i - x) / FW;
      for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) {
        const X = x + dx, Y = y + dy; if ( X < 0 || Y < 0 || X >= FW || Y >= FH ) continue;
        const j = Y * FW + X; if ( inside[j] && lab[j] < 0 ) { lab[j] = id; stack[sp++] = j; }
      }
    }
    comps.push({ id, px, anchor: s0 });
  }
  if ( jag ) {
    // a small piece close to a big area belongs to it (a fragment torn off its rim), as its own little plate
    const big = (c) => c.px.length >= 48;
    for ( const c of comps ) {
      if ( big(c) ) continue;
      let to = -1;
      for ( const i of c.px ) {
        const x = i % FW, y = (i - x) / FW;
        for ( let dy = -8; dy <= 8 && to < 0; dy++ ) for ( let dx = -8; dx <= 8; dx++ ) {
          const X = x + dx, Y = y + dy; if ( X < 0 || Y < 0 || X >= FW || Y >= FH ) continue;
          const l = lab[Y * FW + X]; if ( l >= 0 && l !== c.id && big(comps[l]) ) { to = l; break; }
        }
        if ( to >= 0 ) break;
      }
      if ( to < 0 ) continue;
      for ( const i of c.px ) { lab[i] = to; frag[i] = c.anchor + 1; }
      comps[to].px.push(...c.px); c.merged = true;
    }
    comps = comps.filter((c) => !c.merged);
  }
  comps = comps.filter((c) => {
    if ( c.px.length >= 6 ) return true;
    for ( const i of c.px ) { inside[i] = 0; lab[i] = -2; }
    return false;
  });
  progress(0.2);

  /* ---------------------------------------------------------------- 3. per area: window, hash, cache or bake */
  const scatter = clamp(P.scatter ?? 1, 0.2, 3);
  const results = [];
  comps.forEach((c, k) => {
    let x0 = FW, y0 = FH, x1 = -1, y1 = -1;
    for ( const i of c.px ) { const x = i % FW, y = (i - x) / FW; if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y; }
    const span = Math.max(x1 - x0, y1 - y0);
    const margin = Math.round(Math.min(160, Math.max(14, span * 0.6 * scatter + 10)));
    const RX = Math.max(0, FX + x0 - margin), RY = Math.max(0, FY + y0 - margin);
    const W = Math.min(AW, FX + x1 + 1 + margin) - RX, H = Math.min(AH, FY + y1 + 1 + margin) - RY, N = W * H;
    const ownId = lab[c.px[0]];
    const win = { W, H, RX, RY, inside: new Uint8Array(N), sev: new Float32Array(N), typ: new Uint8Array(N), own: new Uint8Array(N), frag: new Int32Array(N), px: [] };
    let h = fnvInts(head, RX, RY, W, H);
    for ( let y = 0; y < H; y++ ) {
      const fy = RY + y - FY;
      for ( let x = 0; x < W; x++ ) {
        const fx = RX + x - FX, o = y * W + x;
        let v = 0;
        if ( fx >= 0 && fy >= 0 && fx < FW && fy < FH ) {
          const i = fy * FW + fx;
          if ( inside[i] ) {
            const mine = lab[i] === ownId;
            win.inside[o] = 1; win.sev[o] = sev[i]; win.typ[o] = typ[i];
            if ( mine ) { win.own[o] = 1; win.frag[o] = frag[i] > 0 ? frag[i] : 0; win.px.push(o); }
            v = (mine ? 2 : 1) | (typ[i] << 2) | (Math.round(sev[i] * 64) << 5) | (mine && frag[i] > 0 ? 1 << 14 : 0);
          }
        }
        h = Math.imul(h ^ v, 16777619);
      }
    }
    const hash = h >>> 0;
    // the area's own id for its random streams: its first pixel (absolute), the same whatever else is on the map
    const ax = FX + c.anchor % FW, ay = FY + Math.floor(c.anchor / FW);
    let res = cache?.get(hash);
    if ( res ) { cache.delete(hash); cache.set(hash, res); stats.reused++; }
    else {
      win.map = cropMap(I.map, RX, RY, W, H);
      res = bakeArea(win, P, seed, ay * AW + ax, jag);
      res.hash = hash;
      stats.baked++;
      if ( cache ) { cache.set(hash, res); trimCache(cache); }
    }
    results.push(res);
    progress(0.2 + 0.75 * (k + 1) / comps.length);
  });
  return assemble(results, stats, t0, progress);
}

function cropMap(map, RX, RY, W, H) {
  const out = new Uint8ClampedArray(W * H * 4);
  for ( let y = 0; y < H; y++ ) out.set(map.data.subarray(((RY + y) * map.w + RX) * 4, ((RY + y) * map.w + RX + W) * 4), y * W * 4);
  return out;
}

const CACHE_BYTES = 160 * 1048576;
function trimCache(cache) {
  let bytes = 0;
  for ( const r of cache.values() ) bytes += r.bytes;
  for ( const [k, r] of cache ) { if ( bytes <= CACHE_BYTES && cache.size <= 600 ) break; cache.delete(k); bytes -= r.bytes; }
}

/** Area results -> one sheet (images packed, placement table in the last rows). */
function assemble(results, stats, t0, progress) {
  const items = [];
  results.forEach((r, a) => {
    stats.areas++; stats.shards += r.stats.shards; stats.chips += r.stats.chips; stats.pulverised += r.stats.pulverised; stats.materials.push(...r.stats.materials);
    for ( const it of r.items ) items.push({ ...it, area: a, hash: r.hash });
  });
  const pack = shelfPack(items.map((it) => ({ w: it.img.w, h: it.img.h })));
  const metaBytes = items.length * META_FIELDS * 2 + 4;
  const SW = pack.W, metaRows = Math.ceil(metaBytes / 3 / SW);
  const SH = pack.H + metaRows;
  const sheet = new Uint8ClampedArray(SW * SH * 4);
  items.forEach((it, k) => {
    const p = pack.pos[k];
    for ( let y = 0; y < it.img.h; y++ ) sheet.set(it.img.data.subarray(y * it.img.w * 4, (y + 1) * it.img.w * 4), ((p.y + y) * SW + p.x) * 4);
  });
  const meta = new Int16Array(items.length * META_FIELDS);
  items.forEach((it, k) => {
    const p = pack.pos[k], o = k * META_FIELDS;
    meta.set(it.m, o);
    meta[o + 1] = p.x; meta[o + 2] = p.y;
    if ( it.m[0] === 0 ) { meta[o + 12] = it.hash & 0xffff; meta[o + 13] = (it.hash >>> 16) & 0xffff; }
    else meta[o + 11] = (it.area << 4) | (it.m[11] & 15);
  });
  // the table in the last rows: a 4-byte count, then the int16s little endian; three bytes per pixel, alpha 255
  const bytes = new Uint8Array(metaRows * SW * 3);
  new DataView(bytes.buffer).setUint32(0, items.length, true);
  bytes.set(new Uint8Array(meta.buffer), 4);
  for ( let k = 0; k < metaRows * SW; k++ ) {
    const o = ((pack.H * SW) + k) * 4;
    sheet[o] = bytes[k * 3]; sheet[o + 1] = bytes[k * 3 + 1]; sheet[o + 2] = bytes[k * 3 + 2]; sheet[o + 3] = 255;
  }
  progress(1);
  stats.ms = Date.now() - t0; stats.sprites = items.length;
  return { sheet: { w: SW, h: SH, data: sheet }, metaRows, meta, count: items.length, stats };
}

/**
 * One area in its window. `A`: W, H, RX, RY (window in absolute art px), map (window RGBA), inside / sev / typ (all damage in the
 * window), own (this area's pixels), frag (fragment blob of a torn-off piece, 0 = body), px (own pixel indices); `uid` its stable id.
 * Returns { items: [{ img, m: Int16Array(META_FIELDS) }], stats, bytes }.
 */
function bakeArea(A, P, seed, uid, jag) {
  const { W, H, RX, RY, map, inside, sev, typ, own } = A;
  const N = W * H;
  // inner distance (to the outside) and outer distance (to the nearest damage), chamfer 1 / 1.4142
  const din = new Float32Array(N), dout = new Float32Array(N);
  for ( let i = 0; i < N; i++ ) { din[i] = inside[i] ? 1e6 : 0; dout[i] = inside[i] ? 0 : 1e6; }
  chamfer(din, W, H); chamfer(dout, W, H);
  const occ = new Uint8Array(N);
  const stats = { shards: 0, chips: 0, pulverised: 0, materials: [] };
  const C = { id: 0, uid, px: A.px };
  analyse(C);
  fracture(C);
  fates(C);
  drawBase(C);

  /* ---------------------------------------------------------------- analysis */
  function analyse(C) {
    let x0 = W, y0 = H, x1 = 0, y1 = 0, sx = 0, sy = 0, maxD = 0, sumS = 0;
    const tcount = new Array(6).fill(0);
    for ( const i of C.px ) {
      const x = i % W, y = (i - x) / W;
      if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x; if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y;
      sx += x; sy += y; sumS += sev[i]; tcount[typ[i]]++;
      if ( din[i] > maxD ) maxD = din[i];
    }
    const n = C.px.length;
    // a crater is never torn out right up to its edge: a band of heaved, broken plates (the lip) rings it, wider in a bigger crater
    const rimW = clamp(maxD * 0.34, 1.8, 7);
    for ( const i of C.px ) if ( sev[i] > 2.4 && din[i] < rimW + (h2(i, 3, seed) - 0.5) * 1.5 ) sev[i] = Math.min(sev[i], 2.15);
    sumS = 0; for ( const i of C.px ) sumS += sev[i];
    Object.assign(C, { x0, y0, x1, y1, cx: sx / n, cy: sy / n, maxD, meanSev: sumS / n, maxSev: 0, rimW });
    for ( const i of C.px ) if ( sev[i] > C.maxSev ) C.maxSev = sev[i];
    C.type = tcount.indexOf(Math.max(...tcount));
    // principal axis: a long stroke gets several impacts along it
    let cxx = 0, cyy = 0, cxy = 0;
    for ( const i of C.px ) { const x = i % W - C.cx, y = (i - (i % W)) / W - C.cy; cxx += x * x; cyy += y * y; cxy += x * y; }
    cxx /= n; cyy /= n; cxy /= n;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(0.01, tr / 2 - disc);
    const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    C.axis = [Math.cos(ang), Math.sin(ang)]; C.elong = Math.sqrt(l1 / l2); C.len = 4 * Math.sqrt(l1);
    // epicentres: the deepest, most severe point; along a long stroke one every few widths
    const R = rng(seed * 31 + C.uid * 977 + 13);
    const score = (i) => din[i] * (0.6 + sev[i] * 0.15) + h2(i, C.uid, seed) * 0.05;
    const ne = C.elong > 2.2 && C.type !== T_GASH ? clamp(Math.round(C.len / (2.6 * maxD + 6)), 2, 7) : 1;
    C.epi = [];
    if ( ne === 1 ) {
      let bi = C.px[0], bs = -1;
      for ( const i of C.px ) { const s = score(i); if ( s > bs ) { bs = s; bi = i; } }
      C.epi.push({ x: bi % W, y: Math.floor(bi / W), R: 1 });
    } else {
      const span = C.len * 0.9, step = span / ne;
      for ( let k = 0; k < ne; k++ ) {
        const t = -span / 2 + step * (k + 0.5) + (R() - 0.5) * step * 0.3;
        let bi = -1, bs = -1;
        for ( const i of C.px ) {
          const x = i % W - C.cx, y = (i - (i % W)) / W - C.cy, pr = x * C.axis[0] + y * C.axis[1];
          if ( Math.abs(pr - t) > step / 2 ) continue;
          const s = score(i); if ( s > bs ) { bs = s; bi = i; }
        }
        if ( bi >= 0 ) C.epi.push({ x: bi % W, y: Math.floor(bi / W), R: 1 });
      }
      if ( !C.epi.length ) C.epi.push({ x: Math.round(C.cx), y: Math.round(C.cy), R: 1 });
    }
    // each pixel belongs to its nearest epicentre; R = that impact's reach
    C.owner = new Uint8Array(n);
    C.px.forEach((i, k) => {
      const x = i % W, y = (i - x) / W;
      let best = 0, bd = Infinity;
      C.epi.forEach((e, j) => { const d = (x - e.x) ** 2 + (y - e.y) ** 2; if ( d < bd ) { bd = d; best = j; } });
      C.owner[k] = best;
      const e = C.epi[best], d = Math.sqrt(bd); if ( d > e.R ) e.R = d;
    });
    // what is being torn up: the map under the area
    const forced = MATS.indexOf(P.material);
    C.cls = classify(map, W, C.px);
    if ( forced >= 0 ) C.cls.mat = forced;
    C.pal = palette(C.cls, C.type);
    stats.materials.push(MATS[C.cls.mat]);
  }

  /* ---------------------------------------------------------------- fracture */
  function fracture(C) {
    const R = rng(seed * 17 + C.uid * 7919 + 1);
    const seeds = [], fragOf = A.frag;
    if ( C.type === T_GASH ) {
      // claw / blade gashes: parallel grooves along the stroke; the surface between them stays in strips, cut across now and then
      const ax = C.axis, nx = -ax[1], ny = ax[0], wid = Math.max(2, C.maxD), g = clamp(Math.round(wid / 4.5), 2, 4);
      const grooves = Array.from({ length: g }, (_, k) => -wid * 0.8 + (k + 0.5) * (wid * 1.6) / g);
      const cells = new Map();
      C.cellAt = new Map();
      for ( const i of C.px ) {
        const x = i % W, y = (i - x) / W, dx = x + 0.5 - C.cx, dy = y + 0.5 - C.cy;
        const t = dx * ax[0] + dy * ax[1], q = dx * nx + dy * ny + (vnoise(t / 3, 1.5, seed + 91) - 0.5) * 1.4;
        const taper = 1 - Math.pow(Math.min(1, Math.abs(t) / (C.len / 2 + 1)), 3);
        let strip = 0, groove = false;
        for ( let k = 0; k < g; k++ ) { if ( Math.abs(q - grooves[k]) < (0.75 + 0.9 * (sev[i] - 1) / 2) * taper ) groove = true; if ( q > grooves[k] ) strip = k + 1; }
        if ( groove ) continue;
        const key = fragOf[i] ? -fragOf[i] : strip * 4096 + Math.floor((t + 4096 + (vnoise(q, t / 4, seed + 93) - 0.5) * 3) / 22);
        (cells.get(key) ?? cells.set(key, { seed: { x: C.cx, y: C.cy, e: 0 }, px: [] }).get(key)).px.push(i);
      }
      C.cells = [...cells.values()];
      C.cells.forEach((c, id) => { c.id = id; for ( const i of c.px ) C.cellAt.set(i, id); });
      return;
    }
    for ( let ei = 0; ei < C.epi.length; ei++ ) {
      const e = C.epi[ei];
      seeds.push({ x: e.x + (R() - 0.5), y: e.y + (R() - 0.5), e: ei });
      const m = 6 + Math.floor(R() * 5), a0 = R() * Math.PI * 2;
      const spokes = Array.from({ length: m + 1 }, (_, j) => a0 + (j + (j < m ? (R() - 0.5) * 0.45 : 0)) / m * Math.PI * 2);
      spokes[m] = spokes[0] + Math.PI * 2;
      const rings = [0];
      let r = 1.4 + R() * 1.2;
      while ( r < e.R + 3 ) { rings.push(r); r = r * (1.34 + R() * 0.18) + 1.1; }
      rings.push(r);
      for ( let k = 0; k + 1 < rings.length; k++ ) {
        const rin = rings[k], rout = rings[k + 1], rm = (rin + rout) / 2;
        if ( k === 0 && rm < 1.2 ) continue;
        const w = 2.2 + rm * 0.55;
        for ( let j = 0; j < m; j++ ) {
          const span = spokes[j + 1] - spokes[j], f = Math.max(1, Math.round((span * rm) / w));
          for ( let s = 0; s < f; s++ ) {
            const a = spokes[j] + span * (s + 0.5 + (R() - 0.5) * 0.35) / f;
            const rr = rm + (R() - 0.5) * (rout - rin) * 0.35;
            seeds.push({ x: e.x + Math.cos(a) * rr, y: e.y + Math.sin(a) * rr, e: ei });
          }
        }
      }
    }
    // nearest seed (domain-warped, so cracks are jagged), through a bucket grid
    // a flat bucket grid (linked lists), searched ring by ring outwards until no closer seed can exist: the true nearest seed, and
    // each bucket visited once (the old search re-scanned every inner ring and could look at hundreds of buckets per pixel)
    const B = 6, gw = Math.ceil(W / B) + 2, gh = Math.ceil(H / B) + 2, ns = seeds.length;
    const head = new Int32Array(gw * gh).fill(-1), nxt = new Int32Array(ns), sxs = new Float64Array(ns), sys = new Float64Array(ns);
    seeds.forEach((s, k) => {
      sxs[k] = s.x; sys[k] = s.y;
      const bx = clamp(Math.floor(s.x / B) + 1, 0, gw - 1), by = clamp(Math.floor(s.y / B) + 1, 0, gh - 1), key = by * gw + bx;
      nxt[k] = head[key]; head[key] = k;
    });
    const cellOf = new Int32Array(C.px.length);
    // wood splits along its grain: distance across the grain counts more, so cells grow into long splinters
    const wood = C.cls.mat === M.wood, kx = wood && !C.cls.grainX ? 0.3 : 1, ky = wood && C.cls.grainX ? 0.3 : 1, kmin = Math.min(kx, ky);
    const maxRad = Math.max(gw, gh);
    C.px.forEach((i, k) => {
      const x = i % W, y = (i - x) / W;
      // torn (jagged): a stronger, finer warp makes angular, chipped cuts instead of smooth cell edges
      const wa = 2.6 + 2.4 * jag;
      const qx = x + 0.5 + (vnoise(x / 2.3, y / 2.3, seed + 101) - 0.5) * wa + (jag ? (vnoise(x / 0.9, y / 0.9, seed + 103) - 0.5) * 1.8 * jag : 0);
      const qy = y + 0.5 + (vnoise(x / 2.3, y / 2.3, seed + 202) - 0.5) * wa + (jag ? (vnoise(x / 0.9, y / 0.9, seed + 204) - 0.5) * 1.8 * jag : 0);
      let best = -1, bd = Infinity;
      const bx = Math.floor(qx / B) + 1, by = Math.floor(qy / B) + 1;
      const visit = (X, Y) => {
        if ( X < 0 || Y < 0 || X >= gw || Y >= gh ) return;
        for ( let s = head[Y * gw + X]; s >= 0; s = nxt[s] ) { const d = ((sxs[s] - qx) * kx) ** 2 + ((sys[s] - qy) * ky) ** 2; if ( d < bd ) { bd = d; best = s; } }
      };
      for ( let rad = 0; rad <= maxRad; rad++ ) {
        if ( best >= 0 && ((rad - 1) * B * kmin) ** 2 > bd ) break;
        if ( rad === 0 ) { visit(bx, by); continue; }
        for ( let d = -rad; d <= rad; d++ ) { visit(bx + d, by - rad); visit(bx + d, by + rad); }
        for ( let d = -rad + 1; d < rad; d++ ) { visit(bx - rad, by + d); visit(bx + rad, by + d); }
      }
      cellOf[k] = best;
    });
    // cells
    const cells = new Map();
    C.px.forEach((i, k) => { const s = cellOf[k], key = fragOf[i] ? -fragOf[i] : s; (cells.get(key) ?? cells.set(key, { seed: seeds[s], px: [] }).get(key)).px.push(i); });
    C.cellAt = new Map(); // pixel -> cell id (for crack gaps)
    C.cells = [...cells.values()];
    C.cells.forEach((c, id) => { c.id = id; for ( const i of c.px ) C.cellAt.set(i, id); });
  }

  /* ---------------------------------------------------------------- fates and shard rendering */
  function fates(C) {
    const R = rng(seed * 101 + C.uid * 104729 + 3);
    const debris = clamp(P.debris ?? 0.7, 0, 1), scatter = clamp(P.scatter ?? 1, 0.2, 3), liftK = clamp(P.lift ?? 1, 0, 2);
    C.shards = []; C.cracks = []; C.rect = { x0: C.x0, y0: C.y0, x1: C.x1, y1: C.y1 };
    for ( const cell of C.cells ) {
      let n = 0, sx = 0, sy = 0, ss = 0;
      const tc = new Array(6).fill(0);
      for ( const i of cell.px ) { const x = i % W; sx += x; sy += (i - x) / W; ss += sev[i]; tc[typ[i]]++; n++; }
      const cx = sx / n, cy = sy / n, sv = ss / n, type = tc.indexOf(Math.max(...tc));
      const e = C.epi[cell.seed.e] ?? C.epi[0];
      let ox = cx - e.x, oy = cy - e.y; const dl = Math.hypot(ox, oy) || 1; ox /= dl; oy /= dl;
      if ( type === T_GASH ) { const nx = -C.axis[1], ny = C.axis[0], q = (cx - C.cx) * nx + (cy - C.cy) * ny; ox = nx * Math.sign(q || 1); oy = ny * Math.sign(q || 1); }
      const u = clamp(dl / Math.max(2, e.R), 0, 1.2);
      // pixels of the plate: one-pixel cracks on its right and bottom borders (towards other plates), a ragged rim when broken
      const keep = [];
      for ( const i of cell.px ) {
        const x = i % W;
        const cr = C.cellAt.get(i + 1), cb = C.cellAt.get(i + W);
        const right = x + 1 < W && inside[i + 1] && cr !== undefined && cr !== cell.id;
        const below = i + W < N && inside[i + W] && cb !== undefined && cb !== cell.id;
        if ( right || below ) continue;
        if ( (sv >= 1.8 || jag) && type !== T_CRACKS ) {
          const rim = !(inside[i - 1] && inside[i + 1] && inside[i - W] && inside[i + W]) || C.cellAt.get(i - 1) !== cell.id || C.cellAt.get(i - W) !== cell.id;
          // torn: chipped teeth along every plate's rim, in 2 x 2 bites
          if ( rim && (h2(i, 5, seed) < 0.22 * Math.max(0, sv - 1.5) || (jag && h2((i % W) >> 1, Math.floor(i / W) >> 1, seed + 6) < 0.32 * jag)) ) continue;
        }
        keep.push(i);
      }
      if ( keep.length < 2 ) continue;
      const base = { px: keep, cx, cy, sv, type, e, ox, oy, u };
      if ( type === T_CRACKS || sv < 1.5 ) {
        // cracked: the plate stays; now and then a hair's breadth out or sunk a little
        const nudge = R() < 0.3 ? 1 : 0;
        C.shards.push({ ...base, dx: Math.round(ox * nudge), dy: Math.round(oy * nudge), th: 0, tx: 0, ty: 0, z0: (type === T_CRACKS && sv > 2.2 && R() < 0.4) ? -1 : 0, T: 0 });
        continue;
      }
      if ( sv < 2.45 || type === T_GASH ) {
        const slope = (0.22 + R() * 0.4) * liftK, th = (R() - 0.5) * 0.32;
        if ( type === T_COLLAPSE ) {      // slumps into the hole: inner edge down
          const d = 0.6 + R() * 1.6;
          C.shards.push({ ...base, dx: -ox * d, dy: -oy * d, th, tx: ox * slope, ty: oy * slope, z0: -1.5, T: 1 });
        } else if ( type === T_FLOOD ) {   // sinks, tips into the water
          C.shards.push({ ...base, dx: ox * 0.5, dy: oy * 0.5, th: th * 0.5, tx: ox * slope * 0.5, ty: oy * slope * 0.5, z0: -1, T: 1, wet: 1 });
        } else if ( type === T_SCORCH ) {  // burnt plates curl a little
          C.shards.push({ ...base, dx: ox * 0.5, dy: oy * 0.5, th: th * 0.4, tx: -ox * slope * 0.45, ty: -oy * slope * 0.45, z0: 0.5, T: 1 });
        } else if ( type === T_GASH ) {    // the surface between the grooves stays where it is: the grooves carry the read
          C.shards.push({ ...base, dx: 0, dy: 0, th: 0, tx: 0, ty: 0, z0: 0, T: 0 });
        } else {                            // heaved: pushed out, inner edge lifted (the lip of a crater)
          const d = 1.1 + R() * 2.4, slope2 = slope * 1.25;
          C.shards.push({ ...base, dx: ox * d, dy: oy * d, th: th * 1.3, tx: -ox * slope2, ty: -oy * slope2, z0: (0.5 + R() * 1.4) * liftK, T: n > 18 ? 2 : 1 });
        }
        continue;
      }
      // crater: pulverised, sunk, or thrown out as chips
      const gone = type === T_FLOOD ? 0.85 : type === T_COLLAPSE ? 0.75 : type === T_SCORCH ? 0.85 : 0.35 + (1 - debris) * 0.55;
      if ( u < 0.35 && R() < gone + 0.25 ) { stats.pulverised++; continue; }
      if ( R() < gone * 0.6 ) { stats.pulverised++; continue; }
      const chipMax = Math.round(10 + 30 * u);
      for ( const chip of split(keep, chipMax, R) ) {
        let ccx = 0, ccy = 0; for ( const i of chip ) { const x = i % W; ccx += x; ccy += (i - x) / W; }
        ccx /= chip.length; ccy /= chip.length;
        const a = Math.atan2(oy, ox) + (R() - 0.5) * 0.7;
        let dist;
        if ( type === T_COLLAPSE ) dist = -(dl * (0.3 + R() * 0.5));                         // falls in
        else if ( R() < 0.45 ) dist = (e.R - dl) * (0.15 + R() * 0.6);                       // comes to rest on the slope, leaning
        else dist = ((e.R - dl) + 1 + Math.pow(R(), 1.6) * (e.R * 0.6 + 3)) * scatter;        // thrown out past the rim, most land close
        let lx = ccx + Math.cos(a) * dist, ly = ccy + Math.sin(a) * dist;
        lx = clamp(lx, 2, W - 3); ly = clamp(ly, 2, H - 3);
        const li = Math.round(ly) * W + Math.round(lx);
        const stackUp = occ[li] ?? 0;
        const tiltA = R() * Math.PI * 2, slope = R() * 0.55 * liftK;
        C.shards.push({ ...base, px: chip, cx: ccx, cy: ccy, dx: lx - ccx, dy: ly - ccy, th: (R() - 0.5) * Math.PI * 2,
          tx: Math.cos(tiltA) * slope, ty: Math.sin(tiltA) * slope, z0: (type === T_COLLAPSE ? -2 : R() * 1.2 + stackUp * 1.3) * Math.max(0.4, liftK), T: chip.length > 14 ? 2 : 1, chip: 1, thrown: dist > 0 });
        for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) { const j = li + dy * W + dx; if ( j >= 0 && j < N && occ[j] < 6 ) occ[j]++; }
        stats.chips++;
      }
    }
    // order: what lies lower on screen is drawn later; stacked chips over plates
    C.shards.sort((a, b) => (a.cy + a.dy + (a.chip ? 0.5 + a.z0 * 0.1 : 0)) - (b.cy + b.dy + (b.chip ? 0.5 + b.z0 * 0.1 : 0)));
    // a plate that did not move is not drawn at all: the real map shows there, at full resolution
    C.keep = new Set();
    for ( const s of C.shards ) {
      s.static = !s.chip && !s.dx && !s.dy && !s.th && !s.tx && !s.ty && !s.z0;
      if ( s.static ) { s.skip = true; for ( const i of s.px ) C.keep.add(i); }
      else renderShard(C, s);
    }
    stats.shards += C.shards.length;
    // hairline cracks out into the intact map
    if ( C.maxSev >= 1.8 && C.type !== T_FLOOD ) growCracks(C, R);
  }

  /** Split a pixel set into chips of about `max` pixels (nearest of k random seeds). */
  function split(px, max, R) {
    const k = Math.ceil(px.length / max);
    if ( k <= 1 ) return [px];
    const seeds = Array.from({ length: k }, () => px[Math.floor(R() * px.length)]);
    const out = seeds.map(() => []);
    const ssx = Int32Array.from(seeds, (s) => s % W), ssy = Int32Array.from(seeds, (s) => (s - (s % W)) / W);
    for ( const i of px ) {
      const x = i % W, y = (i - x) / W;
      let best = 0, bd = Infinity;
      for ( let j = 0; j < k; j++ ) {
        const base = (ssx[j] - x) ** 2 + (ssy[j] - y) ** 2;
        if ( base >= bd ) continue;                       // the noise only adds: it cannot win (same result, far less hashing)
        const d = base + h2(i, j, seed) * 3;
        if ( d < bd ) { bd = d; best = j; }
      }
      out[best].push(i);
    }
    return out.filter((c) => c.length >= 2);
  }

  /**
   * One rigid slab: top face = the map's own pixels (rotated, tilted, lifted), seen with the oblique camera; side = a cross-section
   * of the material; silhouette inked; a flat shadow on the ground when it is lifted or thrown.
   */
  function renderShard(C, s) {
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for ( const i of s.px ) { const x = i % W, y = (i - x) / W; if ( x < bx0 ) bx0 = x; if ( x > bx1 ) bx1 = x; if ( y < by0 ) by0 = y; if ( y > by1 ) by1 = y; }
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    const own = new Uint8Array(bw * bh);
    for ( const i of s.px ) { const x = i % W, y = (i - x) / W; own[(y - by0) * bw + (x - bx0)] = 1; }
    const pcx = s.cx + 0.5, pcy = s.cy + 0.5;
    const c = Math.cos(s.th), sn = Math.sin(s.th);
    // screen = M (p - centre) + centre + offset - (0, z0/2);   M = [[1,0],[-tx/2, 1-ty/2]] * Rot
    let ty = s.ty; if ( 1 - ty / 2 < 0.35 ) ty = 1.3;
    const r00 = c, r01 = -sn, r10 = sn, r11 = c;
    const m00 = r00, m01 = r01, m10 = -s.tx / 2 * r00 + (1 - ty / 2) * r10, m11 = -s.tx / 2 * r01 + (1 - ty / 2) * r11;
    const det = m00 * m11 - m01 * m10;
    const i00 = m11 / det, i01 = -m01 / det, i10 = -m10 / det, i11 = m00 / det;
    const ocx = pcx + s.dx, ocy = pcy + s.dy - s.z0 / 2;
    // screen bbox of the top face
    let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
    for ( const [qx, qy] of [[bx0, by0], [bx1 + 1, by0], [bx0, by1 + 1], [bx1 + 1, by1 + 1]] ) {
      const px = qx - pcx, py = qy - pcy, X = m00 * px + m01 * py + ocx, Y = m10 * px + m11 * py + ocy;
      sx0 = Math.min(sx0, X); sx1 = Math.max(sx1, X); sy0 = Math.min(sy0, Y); sy1 = Math.max(sy1, Y);
    }
    const T = s.T | 0;
    const tx0 = Math.floor(sx0) - 1, ty0 = Math.floor(sy0) - 1, tw = Math.ceil(sx1) - tx0 + 2, th = Math.ceil(sy1) - ty0 + 2 + T;
    if ( tw <= 0 || th <= 0 || tw > 400 || th > 400 ) { s.skip = true; return; }
    const top = new Int32Array(tw * th).fill(-1);   // source map index of each top pixel
    for ( let y = 0; y < th; y++ ) for ( let x = 0; x < tw; x++ ) {
      const X = tx0 + x + 0.5 - ocx, Y = ty0 + y + 0.5 - ocy;
      const u = i00 * X + i01 * Y + pcx, v = i10 * X + i11 * Y + pcy;
      const ux = Math.floor(u), vy = Math.floor(v);
      if ( ux < bx0 || vy < by0 || ux > bx1 || vy > by1 || !own[(vy - by0) * bw + (ux - bx0)] ) continue;
      top[y * tw + x] = vy * W + ux;
    }
    // shading of the top face: normal (-tx, -ty, 1), light from the top left, high
    const nl = Math.hypot(s.tx, ty, 1), L = [-0.5, -0.55, 0.67];
    let f = ((-s.tx * L[0] - ty * L[1] + L[2]) / nl) / L[2];
    if ( s.z0 < 0 ) f *= 0.82;
    // a piece of the map must still read as the map: tilt shades it, it never glows
    f = Math.round(clamp(f, 0.6, 1.12) / 0.06) * 0.06;
    const rgba = new Uint8ClampedArray(tw * th * 4);
    const isTop = (x, y) => x >= 0 && y >= 0 && x < tw && y < th && top[y * tw + x] >= 0;
    // side: the slab's thickness below its top face
    const sideCol = mix(C.pal.strata[0], C.pal.ramp[1], 0.35);
    for ( let y = 0; y < th; y++ ) for ( let x = 0; x < tw; x++ ) {
      if ( isTop(x, y) ) continue;
      for ( let k = 1; k <= T; k++ ) if ( isTop(x, y - k) ) {
        const src = top[(y - k) * tw + x], o = (y * tw + x) * 4;
        const mc = [map[src * 4], map[src * 4 + 1], map[src * 4 + 2]];
        const col = k === 1 ? mix(mul(mc, 0.5), sideCol, 0.55) : mul(sideCol, 0.78);
        rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
        break;
      }
    }
    const scorch = s.type === T_SCORCH, wet = s.wet;
    for ( let y = 0; y < th; y++ ) for ( let x = 0; x < tw; x++ ) {
      const src = top[y * tw + x]; if ( src < 0 ) continue;
      const o = (y * tw + x) * 4;
      let col = [map[src * 4], map[src * 4 + 1], map[src * 4 + 2]];
      let g = f;
      if ( !isTop(x - 1, y) || !isTop(x, y - 1) ) g *= 1.12;               // the lit edge
      if ( !isTop(x + 1, y) && rgba[o + 4 + 3] === 0 ) g *= 0.8;          // the shaded edge
      col = mul(col, g);
      if ( scorch ) { const k = clamp(0.2 + (s.sv - 1) * 0.3 + (vnoise(x / 2, y / 2, seed + src) - 0.5) * 0.5, 0, 0.85); col = mix(col, C.pal.char[1], k); }
      if ( wet ) col = mix(col, C.pal.waterR[1], 0.25);
      rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = 255;
    }
    // ink the silhouette where it is lifted (resting plates join the map seamlessly)
    if ( T > 0 || s.chip ) {
      const ink = C.pal.ink;
      const filled = (x, y) => x >= 0 && y >= 0 && x < tw && y < th && rgba[(y * tw + x) * 4 + 3] > 0;
      const out = [];
      for ( let y = 0; y < th; y++ ) for ( let x = 0; x < tw; x++ ) {
        if ( !filled(x, y) ) continue;
        const bottomOrRight = !filled(x + 1, y) || !filled(x, y + 1);
        const leftOrTop = !filled(x - 1, y) || !filled(x, y - 1);
        if ( bottomOrRight || (leftOrTop && !isTop(x, y)) ) out.push((y * tw + x) * 4);
      }
      for ( const o of out ) { const col = mix([rgba[o], rgba[o + 1], rgba[o + 2]], ink, 0.75); rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; }
    }
    // trim empty borders
    let ax0 = tw, ay0 = th, ax1 = -1, ay1 = -1;
    for ( let y = 0; y < th; y++ ) for ( let x = 0; x < tw; x++ ) if ( rgba[(y * tw + x) * 4 + 3] ) { if ( x < ax0 ) ax0 = x; if ( x > ax1 ) ax1 = x; if ( y < ay0 ) ay0 = y; if ( y > ay1 ) ay1 = y; }
    if ( ax1 < 0 ) { s.skip = true; return; }
    const fw = ax1 - ax0 + 1, fh = ay1 - ay0 + 1, img = new Uint8ClampedArray(fw * fh * 4);
    for ( let y = 0; y < fh; y++ ) img.set(rgba.subarray(((y + ay0) * tw + ax0) * 4, ((y + ay0) * tw + ax1 + 1) * 4), y * fw * 4);
    s.img = { w: fw, h: fh, data: img, x: tx0 + ax0, y: ty0 + ay0 };
    s.src = { x: bx0, y: by0 };
    // the ground shadow: the footprint at z = 0, falling down and right, only for what stands off the ground
    const lifted = s.chip || s.z0 > 0.4 || Math.hypot(s.tx, s.ty) > 0.3;
    if ( lifted && s.z0 >= 0 ) {
      const off = 1 + Math.round(Math.max(0, s.z0) * 0.6 + Math.hypot(s.tx, s.ty) * 2);
      s.shadow = [];
      for ( let y = 0; y < th; y++ ) for ( let x = 0; x < tw; x++ ) if ( top[y * tw + x] >= 0 ) {
        // the same point on the ground: undo the lift (z) of this pixel
        const src = top[y * tw + x], ux = src % W, vy = (src - ux) / W;
        const px = ux + 0.5 - pcx, py = vy + 0.5 - pcy;
        const gx = c * px - sn * py + pcx + s.dx, gy = sn * px + c * py + pcy + s.dy;
        s.shadow.push(Math.round(gx) + Math.ceil(off * 0.5), Math.round(gy) + off);
      }
    }
    // grow the area's rectangle to hold the shard and its shadow
    const r = C.rect;
    r.x0 = Math.min(r.x0, s.img.x - 2); r.y0 = Math.min(r.y0, s.img.y - 2); r.x1 = Math.max(r.x1, s.img.x + fw + 3); r.y1 = Math.max(r.y1, s.img.y + fh + 4);
    if ( s.shadow ) for ( let k = 0; k < s.shadow.length; k += 2 ) {
      r.x0 = Math.min(r.x0, s.shadow[k]); r.x1 = Math.max(r.x1, s.shadow[k]); r.y0 = Math.min(r.y0, s.shadow[k + 1]); r.y1 = Math.max(r.y1, s.shadow[k + 1]);
    }
  }

  /** Hairline cracks running from the rim out into the intact map, roughly away from the impact, branching now and then. */
  function growCracks(C, R) {
    const rim = [];
    for ( const i of C.px ) if ( din[i] <= 1.01 ) rim.push(i);
    if ( !rim.length ) return;
    const lum = (i) => 0.299 * map[i * 4] + 0.587 * map[i * 4 + 1] + 0.114 * map[i * 4 + 2];
    const count = Math.round((2 + R() * 3 + C.maxD * 0.18) * (C.maxSev >= 2.5 ? 1 : 0.6) * (1 + jag));
    const wood = C.cls.mat === M.wood, grain = C.cls.grainX ? [0, 1] : [1, 0];
    // a crack runs on, but prefers the map's own weak lines: mortar joints, plank seams, the dark side of things
    const walk = (x, y, dx, dy, len, depth) => {
      const path = [];
      for ( let k = 0; k < len; k++ ) {
        let a = Math.atan2(dy, dx);
        if ( wood ) { const g = Math.atan2(grain[1] * Math.sign(dy * grain[1] + dx * grain[0] || 1), grain[0] * Math.sign(dx * grain[0] + dy * grain[1] || 1)); a = a + ((((g - a) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 0.35; }
        let best = a, bl = Infinity;
        for ( const da of [-0.6, 0, 0.6] ) {
          const b = a + da + (R() - 0.5) * 0.3, X = Math.round(x + Math.cos(b)), Y = Math.round(y + Math.sin(b));
          if ( X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1 ) continue;
          const l = lum(Y * W + X) + Math.abs(da) * 18 + R() * 14;
          if ( l < bl ) { bl = l; best = b; }
        }
        dx = Math.cos(best); dy = Math.sin(best);
        x += dx; y += dy;
        const X = Math.round(x), Y = Math.round(y);
        if ( X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1 ) break;
        const i = Y * W + X;
        if ( inside[i] ) { if ( k > 1 ) break; continue; }
        if ( path[path.length - 1] !== i ) path.push(i);
        if ( depth < (jag > 0.4 ? 2 : 1) && R() < 0.035 + 0.09 * jag ) walk(x, y, dx + (R() - 0.5) * 1.4, dy + (R() - 0.5) * 1.4, (len - k) * 0.45, depth + 1);
      }
      if ( path.length ) C.cracks.push(path);
    };
    for ( let k = 0; k < count; k++ ) {
      const i = rim[Math.floor(R() * rim.length)], x = i % W, y = (i - x) / W;
      let e = C.epi[0], bd = Infinity;
      for ( const q of C.epi ) { const d = (q.x - x) ** 2 + (q.y - y) ** 2; if ( d < bd ) { bd = d; e = q; } }
      const dx = x - e.x, dy = y - e.y, dl = Math.hypot(dx, dy) || 1;
      walk(x, y, dx / dl, dy / dl, 3 + R() * (C.maxD * 0.9 + 4) * (C.maxSev / 3), 0);
    }
    for ( const path of C.cracks ) for ( const i of path ) {
      const x = i % W, y = (i - x) / W, r = C.rect;
      r.x0 = Math.min(r.x0, x - 1); r.y0 = Math.min(r.y0, y - 1); r.x1 = Math.max(r.x1, x + 1); r.y1 = Math.max(r.y1, y + 1);
    }
  }

  /* ---------------------------------------------------------------- what lies beneath, the halos, the lip, the shadows */
  function drawBase(C) {
    const pal = C.pal, rp = pal.ramp, type = C.type;
    const haloR = (type === T_SCORCH ? 4 + C.maxD * 1.4 : type === T_BLAST ? 2 + C.maxD * 0.9 : type === T_COLLAPSE ? 2 + C.maxD * 0.5 : 0) * clamp(P.halo ?? 0.6, 0, 1) * (C.maxSev / 3);
    const r = C.rect;
    r.x0 = clamp(Math.floor(Math.min(r.x0, C.x0 - haloR - 2)), 0, W - 1); r.y0 = clamp(Math.floor(Math.min(r.y0, C.y0 - haloR - 2)), 0, H - 1);
    r.x1 = clamp(Math.ceil(Math.max(r.x1, C.x1 + haloR + 2)), 0, W - 1); r.y1 = clamp(Math.ceil(Math.max(r.y1, C.y1 + haloR + 2)), 0, H - 1);
    const bw = r.x1 - r.x0 + 1, bh = r.y1 - r.y0 + 1;
    const img = new Uint8ClampedArray(bw * bh * 4);
    const put = (x, y, col, a = 255) => {
      if ( x < r.x0 || y < r.y0 || x > r.x1 || y > r.y1 ) return;
      const o = ((y - r.y0) * bw + (x - r.x0)) * 4;
      if ( a < 255 && img[o + 3] === 255 ) { const m = mix([img[o], img[o + 1], img[o + 2]], col, a / 255); img[o] = m[0]; img[o + 1] = m[1]; img[o + 2] = m[2]; return; }
      img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; img[o + 3] = a;
    };
    const mapAt = (i) => [map[i * 4], map[i * 4 + 1], map[i * 4 + 2]];
    const isIn = (x, y) => x >= 0 && y >= 0 && x < W && y < H && own[y * W + x] === 1;
    const maxD = Math.max(2.5, C.maxD);
    const rubble = clamp(P.rubble ?? 0.6, 0, 1);
    // 1. the exposed layer
    for ( const i of C.px ) {
      if ( C.keep.has(i) ) continue;
      const x = i % W, y = (i - x) / W, sv = sev[i], t = typ[i];
      const dn = Math.min(1, din[i] / maxD);
      const depth = Math.pow(dn, 0.75) * (sv - 0.6) / 2.4;
      // the far (north) wall, seen face-on by the oblique camera
      const wallH = t === T_CRACKS ? 1 : Math.round(clamp(sv * 1.2 + (t === T_COLLAPSE ? 1.5 : 0), 1, 4));
      let wall = 0;
      for ( let k = 1; k <= wallH; k++ ) if ( !isIn(x, y - k) ) { wall = k; break; }
      let col;
      if ( wall ) {
        const above = (y - wall) * W + x;
        col = wall === 1 ? mul(above >= 0 ? mapAt(Math.max(0, above)) : rp[2], 0.6) : wall === 2 ? pal.strata[0] : (x + y) & 1 ? pal.strata[1] : mul(pal.strata[1], 0.86);
        put(x, y, col); continue;
      }
      // a bowl lit from the top left: the gradient of the depth decides
      const gx = (din[i + 1] ?? 0) - (din[i - 1] ?? 0), gy = (din[i + W] ?? 0) - (din[i - W] ?? 0), gl = Math.hypot(gx, gy) || 1;
      const lit = ((gx / gl) * -0.7071 + (gy / gl) * -0.7071) * Math.min(1, depth * 3 + 0.2);
      let v = (sv < 1.5 ? 1.1 : 3.4) - depth * (t === T_COLLAPSE ? 2.9 : 2.1) + lit * 1.3 + (h2(x, y, seed + 11) - 0.5) * 0.8 + (vnoise(x / 3, y / 3, seed + 12) - 0.5) * 0.7;
      let idx = clamp(Math.floor(v + bayer(x, y) - 0.5), 0, 4);
      col = rp[idx];
      // materials
      if ( C.cls.mat === M.wood && t !== T_SCORCH && t !== T_FLOOD ) {
        const q = C.cls.grainX ? y : x;      // joists run across the planks
        const j = ((q % 15) + 15) % 15; if ( j < 4 && depth > 0.06 ) col = j === 0 ? mul(pal.beam, 1.18) : j === 3 ? mul(pal.beam, 0.6) : pal.beam;
      }
      if ( C.cls.mat === M.metal && (x % 8 === 0 || y % 8 === 0) && depth > 0.1 ) col = mix(pal.girder, rp[2], 0.3);
      if ( C.cls.mat === M.snow && h2(x, y, seed + 31) < 0.06 ) col = pal.chunk;
      if ( C.cls.mat === M.grass && dn < 0.25 && h2(x, y, seed + 33) < 0.05 ) col = rp[0];   // roots
      if ( t === T_COLLAPSE && depth > 0.35 ) { const k = clamp((depth - 0.35) / 0.4, 0, 1), th = h2(x, y, seed + 44) * 0.55 + vnoise(x / 2, y / 2, seed + 45) * 0.45; if ( th < k ) col = pal.void; else if ( th < k + 0.2 ) col = rp[0]; }
      if ( t === T_FLOOD && depth > 0.18 ) {
        const k = clamp(4 - (depth - 0.18) * 7 + (vnoise(x / 4, y / 2, seed + 41) - 0.5) * 1.2, 0, 4);
        col = pal.waterR[clamp(Math.floor(k + bayer(x, y) - 0.5), 1, 3)];
        if ( h2(Math.floor(x / 3), y, seed + 43) < 0.04 ) col = pal.waterR[4];                 // glints in dashes
      }
      if ( t === T_SCORCH && depth > 0.4 && h2(x, y, seed + 51) < 0.035 ) col = pal.ember[Math.floor(h2(x, y, seed + 52) * 3)];
      put(x, y, col);
    }
    // 2. rubble: chips of the surface and stones, thicker towards the rim
    if ( type !== T_FLOOD && type !== T_CRACKS ) for ( const i of C.px ) {
      if ( C.keep.has(i) ) continue;
      const x = i % W, y = (i - x) / W, dn = din[i] / maxD;
      const dens =rubble * (0.035 + 0.09 * Math.exp(-((dn - 0.35) ** 2) / 0.05)) * (sev[i] / 3);
      if ( h2(x, y, seed + 61) >= dens || !isIn(x + 1, y + 1) ) continue;
      const fromMap = h2(x, y, seed + 62) < 0.3;
      const sx = clamp(x + Math.round((h2(x, y, seed + 63) - 0.5) * 8), 0, W - 1), sy = clamp(y + Math.round((h2(x, y, seed + 64) - 0.5) * 8), 0, H - 1);
      const light = fromMap ? mul(mapAt(sy * W + sx), 0.9) : rp[3 + (h2(x, y, seed + 66) < 0.4 ? 1 : 0)];
      // a stone of 1, 2 or 4 pixels: lit top-left, shaded bottom-right, a dark pixel of shadow under it
      const sz = h2(x, y, seed + 65), wide = sz > 0.55, tall = sz > 0.85;
      put(x, y, light);
      if ( wide && isIn(x + 1, y) ) put(x + 1, y, mul(light, 0.78));
      if ( tall && isIn(x, y + 1) ) { put(x, y + 1, mul(light, 0.82)); if ( isIn(x + 1, y + 1) ) put(x + 1, y + 1, mul(light, 0.66)); }
      const sy2 = y + (tall ? 2 : 1);
      if ( isIn(x, sy2) ) put(x, sy2, rp[0]);
      if ( wide && isIn(x + 1, sy2) ) put(x + 1, sy2, rp[0]);
    }
    // 3. halos on the intact map: scorch (1-bit dither of char), dust
    if ( haloR > 0.5 ) for ( let y = r.y0; y <= r.y1; y++ ) for ( let x = r.x0; x <= r.x1; x++ ) {
      const i = y * W + x; if ( inside[i] ) continue;
      const d = dout[i]; if ( d > haloR || d < 1.5 ) continue;
      const k = Math.pow(1 - d / haloR, 1.4), n = vnoise(x / 2.2, y / 2.2, seed + 71) * 0.75 + h2(x, y, seed + 72) * 0.25;
      if ( type === T_SCORCH ) { if ( n < k * 0.95 ) put(x, y, n < k * 0.45 ? pal.char[0] : mix(mapAt(i), pal.char[1], 0.7)); }
      else if ( type === T_BLAST ) { if ( n < k * 0.75 ) put(x, y, mul(mapAt(i), n < k * 0.35 ? 0.5 : 0.7)); }
      else if ( n < k * 0.4 ) put(x, y, pal.dust);
    }
    // 4. the torn lip: an inked line around the hole on the intact side, a light lip above-left of it
    for ( let y = r.y0; y <= r.y1; y++ ) for ( let x = r.x0; x <= r.x1; x++ ) {
      const i = y * W + x; if ( inside[i] || dout[i] > 1.01 ) continue;
      let near = -1, s = 0;
      // only where the surface is really torn open next to it: never along plates that stayed
      for ( const j of [i - 1, i + 1, i - W, i + W] ) if ( j >= 0 && j < N && own[j] === 1 && !C.keep.has(j) ) { near = j; s = Math.max(s, sev[j]); }
      if ( near < 0 ) continue;
      if ( s >= 1.6 ) put(x, y, pal.ink);
      else put(x, y, mix(mapAt(i), pal.ink, 0.55));
    }
    // 5. hairline cracks: one ink pixel, with a lighter lip of the map's own colour up-left of it
    for ( const path of C.cracks ) for ( const i of path ) {
      const x = i % W, y = (i - x) / W;
      put(x, y, mix(mapAt(i), pal.ink, 0.85));
      const j = i - W; if ( j >= 0 && !inside[j] && h2(x, y, seed + 81) < 0.5 ) put(x, y - 1, mul(mapAt(j), 1.14));
    }
    // 6. shard shadows: one flat colour, alpha ~100
    const shadowCol = mul(pal.ramp[0], 0.7);
    const shadowSeen = new Set();
    for ( const s of C.shards ) if ( s.shadow ) for ( let k = 0; k < s.shadow.length; k += 2 ) {
      const x = s.shadow[k], y = s.shadow[k + 1], key = y * 65536 + x;
      if ( shadowSeen.has(key) ) continue; shadowSeen.add(key);
      put(x, y, shadowCol, 100);
    }
    C.base = { x: r.x0, y: r.y0, w: bw, h: bh, data: img };
  }

  /* ---------------------------------------------------------------- this area's sprites (absolute art coordinates) */
  const items = [];
  const row = () => new Int16Array(META_FIELDS);
  {
    const m = row(), e = C.epi[0];
    m[0] = 0; m[3] = C.base.w; m[4] = C.base.h; m[5] = RX + C.base.x; m[6] = RY + C.base.y;
    m[7] = RX + e.x; m[8] = RY + e.y; m[9] = Math.round(Math.max(...C.epi.map((q) => q.R))); m[10] = C.type; m[11] = C.cls.mat;
    m[14] = Math.round(Math.atan2(C.axis[1], C.axis[0]) * 1000); m[15] = Math.round(Math.min(3000, C.len * 10));
    items.push({ img: C.base, m });
  }
  let bytes = C.base.data.length;
  for ( const s of C.shards ) {
    if ( s.skip || !s.img ) continue;
    const m = row();
    m[0] = 1; m[3] = s.img.w; m[4] = s.img.h; m[5] = RX + s.img.x; m[6] = RY + s.img.y;
    m[7] = RX + s.src.x; m[8] = RY + s.src.y;                    // where the piece came from
    m[9] = Math.round(-s.th * 1000);                              // spin to undo while it flies
    m[10] = Math.round(Math.hypot(s.cx - s.e.x, s.cy - s.e.y) * 4); // distance from the impact (stagger)
    m[11] = (s.chip ? 1 : 0) | (s.thrown ? 2 : 0) | ((s.dx || s.dy) ? 4 : 0);   // the area index is added when the sheet is packed
    m[12] = Math.round(clamp(s.z0, -20, 20) * 10); m[13] = s.type;
    items.push({ img: s.img, m });
    bytes += s.img.data.length;
  }
  return { items, stats, bytes };
}

/** Two-pass chamfer distance (1, sqrt 2) in place: 0 = source, large = to fill. */
function chamfer(d, W, H) {
  const D = 1.4142;
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
    const i = y * W + x; let v = d[i]; if ( !v ) continue;
    if ( x > 0 ) v = Math.min(v, d[i - 1] + 1);
    if ( y > 0 ) { v = Math.min(v, d[i - W] + 1); if ( x > 0 ) v = Math.min(v, d[i - W - 1] + D); if ( x < W - 1 ) v = Math.min(v, d[i - W + 1] + D); }
    d[i] = v;
  }
  for ( let y = H - 1; y >= 0; y-- ) for ( let x = W - 1; x >= 0; x-- ) {
    const i = y * W + x; let v = d[i]; if ( !v ) continue;
    if ( x < W - 1 ) v = Math.min(v, d[i + 1] + 1);
    if ( y < H - 1 ) { v = Math.min(v, d[i + W] + 1); if ( x < W - 1 ) v = Math.min(v, d[i + W + 1] + D); if ( x > 0 ) v = Math.min(v, d[i + W - 1] + D); }
    d[i] = v;
  }
}

/** Shelf packing, tallest first, one pixel of gutter. */
function shelfPack(rects) {
  const area = rects.reduce((a, r) => a + (r.w + 1) * (r.h + 1), 0);
  let W = 256; while ( W * W < area * 1.25 && W < 4096 ) W *= 2;
  W = Math.max(W, ...rects.map((r) => r.w + 1));
  const order = rects.map((r, i) => i).sort((a, b) => rects[b].h - rects[a].h || rects[b].w - rects[a].w);
  const pos = new Array(rects.length);
  let x = 0, y = 0, rowH = 0;
  for ( const i of order ) {
    const r = rects[i];
    if ( x + r.w > W ) { x = 0; y += rowH + 1; rowH = 0; }
    pos[i] = { x, y }; x += r.w + 1; rowH = Math.max(rowH, r.h);
  }
  return { W, H: Math.max(1, y + rowH + 1), pos };
}

/** Read the placement table back from a decoded sheet (RGBA of the last `metaRows` rows). */
export function readMeta(rgba, W, H, metaRows) {
  const n = metaRows * W, bytes = new Uint8Array(n * 3);
  for ( let k = 0; k < n; k++ ) { const o = ((H - metaRows) * W + k) * 4; bytes[k * 3] = rgba[o]; bytes[k * 3 + 1] = rgba[o + 1]; bytes[k * 3 + 2] = rgba[o + 2]; }
  const count = new DataView(bytes.buffer).getUint32(0, true);
  const meta = new Int16Array(count * META_FIELDS);
  new Uint8Array(meta.buffer).set(bytes.subarray(4, 4 + count * META_FIELDS * 2));
  return meta;
}
