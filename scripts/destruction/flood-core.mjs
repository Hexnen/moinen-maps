/**
 * Flooded holes: the pure part (no DOM, no Foundry; tested in node by dev/flood.test.mjs).
 *
 * A flooded area of the destruction bake (one stroke's connected part) gets water of the water engine's own look: its own small loop,
 * baked by the WOWe engine from a mask made here, painted here with the scene water's colours and opacities, clipped to the hole.
 * Everything below reads ONE area only: its cover (the torn outline, art px), which of its pixels lie open (the ruin, not a plate
 * that stayed), and the damage level under each pixel. So a hole's water never depends on any other stroke.
 *
 * The level decides the water:
 *   cracked (1)  damp ground over the whole stroke, water seeping up in the cracks between the plates and in a few puddles;
 *   broken  (2)  a shallow pool: see-through near the rim (the bottom, the rubble and the sunk plates show), a little deeper inside;
 *   crater  (3)  a deep pool: opaque toward the middle, and darker there (depth shading in dithered steps).
 * The engine draws the shore foam where the water meets the rim, the waves, sparkles and its own deep zone.
 */
export const FLOOD_VERSION = 1;

/**
 * Waiting for a hole's pixels (a cold player: the area's atlas is freed or its shell not hydrated yet, so the area cannot be read).
 * The delay before try number `n` (0-based) in ms, or null when the tries are used up: 120 ms doubling, capped at 4 s, 12 tries (~30 s).
 */
export const DRY_TRIES = 12;
export const dryDelay = (n) => n < 0 || n >= DRY_TRIES ? null : Math.min(4000, 120 * 2 ** n);
/** Art pixels per water pixel: the engine bakes at half the destruction's resolution (16 per grid square), painted back at art px. */
export const SCALE = 2;
/** Art pixels of plain ground around the hole in the engine's window, so the shore is seen whole. */
const MARGIN = 4;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export function h2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fnv = (a, h = 2166136261) => { for ( let i = 0; i < a.length; i++ ) h = Math.imul(h ^ a[i], 16777619); return h >>> 0; };
export const fnvStr = (s, h = 2166136261) => { for ( let i = 0; i < s.length; i++ ) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

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

/**
 * One hole, ready to bake and paint. `A`: { cx, cy (absolute art px of the cover's top-left), cw, ch, cover, open, level (Uint8Arrays of
 * cw*ch: inside the torn outline; not a plate that stayed; damage level 1..3), seed }.
 * Returns { cx, cy, cw, ch, water, damp, depth, op, shade, fill, springs, R, eng: { x0, y0, w, h, mask }, level (the most common) },
 * or null when the hole holds no water.
 */
export function prepareFlood(A) {
  const { cx, cy, cw, ch, cover, open, level, seed } = A, N = cw * ch;
  const water = new Uint8Array(N), damp = new Uint8Array(N);
  const count = [0, 0, 0, 0];
  for ( let y = 0; y < ch; y++ ) for ( let x = 0; x < cw; x++ ) {
    const i = y * cw + x; if ( !cover[i] ) continue;
    const L = level[i] || 1; count[L]++;
    if ( L >= 2 ) { water[i] = 1; continue; }
    // cracked: the water seeps up in the open cracks and gathers in a few low spots; the rest is damp ground
    const ax = cx + x, ay = cy + y;
    const puddle = vnoise(ax / 6.5, ay / 6.5, seed + 11) * 0.75 + vnoise(ax / 2.5, ay / 2.5, seed + 12) * 0.25 > 0.64;
    if ( open[i] || puddle ) water[i] = 1; else damp[i] = 1;
  }
  const dominant = count[3] >= count[2] && count[3] >= count[1] ? 3 : count[2] >= count[1] ? 2 : 1;
  // the painted water's grid only for a pool (broken, crater); a cracked stroke's thin seeping cracks stay on the fine grid
  const ratio = A.ratio > 0 && dominant >= 2 ? A.ratio : SCALE;
  let any = false; for ( let i = 0; i < N && !any; i++ ) any = water[i] === 1;
  if ( !any && !damp.some((v) => v) ) return null;
  // depth: the distance to the shore, as a share of the deepest point of the hole
  const din = new Float32Array(N);
  for ( let i = 0; i < N; i++ ) din[i] = water[i] ? 1e6 : 0;
  // the border of the window is shore too (a hole cut by the window edge never reads as deep there)
  chamferPadded(din, cw, ch);
  let maxD = 0; for ( let i = 0; i < N; i++ ) if ( water[i] && din[i] > maxD ) maxD = din[i];
  const depth = new Float32Array(N), op = new Uint8Array(N), shade = new Uint8Array(N), fill = new Float32Array(N);
  const ref = Math.max(2.5, maxD);
  let springs = [];
  for ( let y = 0; y < ch; y++ ) for ( let x = 0; x < cw; x++ ) {
    const i = y * cw + x;
    if ( water[i] ) {
      const L = level[i] || 1, d = clamp(din[i] / ref, 0, 1);
      depth[i] = d;
      // a crater: see-through at the rim (its broken lip and the plates that slid in still show), opaque in the deep middle
      const o = L >= 3 ? 0.5 + 0.5 * Math.min(1, Math.pow(d, 0.7) * 1.15) : L === 2 ? 0.55 + 0.22 * d : 0.8;
      // depth falloff: darker toward the deep middle, the shallows at the rim light (the bottom shows there)
      const s = L >= 3 ? 0.78 * Math.pow(d, 1.1) : L === 2 ? 0.42 * Math.pow(d, 1.1) : 0;
      op[i] = Math.round(o * 255); shade[i] = Math.round(s * 255);
      // the water wells up from the deepest points (and, cracked, from the cracks) and rises to the rim
      let f = 0.9 * (1 - d) + 0.1 * h2(cx + x, cy + y, seed + 21);
      if ( L === 1 && open[i] ) f *= 0.45;
      fill[i] = f;
      springs.push([d + h2(x, y, seed + 22) * 0.02, x, y]);
    } else if ( damp[i] ) fill[i] = 0.25 + 0.6 * vnoise((cx + x) / 4, (cy + y) / 4, seed + 23);
  }
  // up to three springs: the deepest points, apart from each other
  springs.sort((a, b) => b[0] - a[0]);
  const keep = [];
  for ( const s of springs ) { if ( keep.length >= 3 ) break; if ( keep.every((q) => (q[1] - s[1]) ** 2 + (q[2] - s[2]) ** 2 > 64) ) keep.push(s); }
  springs = keep.map((s) => [s[1], s[2]]);
  // the engine's window: whole water pixels on a grid fixed to the scene (`ratio` art px each: SCALE, or the painted water's own grid
  // so a hole beside painted water has its pixels on the same grid), the hole plus a margin
  const k = ratio, M = Math.max(MARGIN, Math.ceil(k * 2));
  const cell = (a) => Math.floor((a + 0.5) / k);
  const ex0 = cell(cx - M), ey0 = cell(cy - M);
  const ew = cell(cx + cw + M) - ex0 + 1, eh = cell(cy + ch + M) - ey0 + 1;
  const mask = new Uint16Array(ew * eh);
  for ( let y = 0; y < ch; y++ ) for ( let x = 0; x < cw; x++ ) {
    if ( !water[y * cw + x] ) continue;
    mask[(cell(cy + y) - ey0) * ew + cell(cx + x) - ex0]++;
  }
  // a water pixel is water when at least half of its art pixels are (thin cracks: one of two still counts on a 2-wide grid)
  const half = Math.max(1, Math.floor((k * k) / 2));
  const m8 = new Uint8Array(ew * eh);
  for ( let i = 0; i < mask.length; i++ ) m8[i] = mask[i] >= half ? 1 : 0;
  return { cx, cy, cw, ch, water, damp, depth, op, shade, fill, springs, R: maxD, ratio: k, eng: { x0: ex0, y0: ey0, w: ew, h: eh, mask: m8 }, level: dominant };
}

function chamferPadded(d, W, H) {
  // pad by one pixel of shore so the window's edge counts as shore
  const PW = W + 2, PH = H + 2, p = new Float32Array(PW * PH);
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) p[(y + 1) * PW + x + 1] = d[y * W + x];
  chamfer(p, PW, PH);
  for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) d[y * W + x] = p[(y + 1) * PW + x + 1];
}

/**
 * The engine's settings for one hole: the scene water's look (or the engine's defaults), still water (no drift, no rods), the scene's
 * frame count and frame time (so the loop runs in step with the painted water), a seed of its own, and the tide only on a cracked
 * hole (the water seeps up and sinks back in the cracks).
 */
export function floodParams(base, prep, hash) {
  const p = { ...(base ?? {}) };
  for ( const k of Object.keys(p) ) if ( /^(fx|reflect|submerge)/.test(k) ) delete p[k];
  delete p.colors; delete p.alpha; delete p.palBase;
  Object.assign(p, { guides: [], guideOn: false, drift: 0, seed: ((Number(base?.seed) || 1) * 31 + (hash % 99991)) % 999983 + 1 });
  if ( prep.level === 1 ) Object.assign(p, { tide: true, tideAmp: 1, tideCycles: 1, tideUneven: 6, tideWet: 6 });
  else p.tide = false;
  p.grid = Math.round((prep.ratio ?? SCALE) * 1000) / 1000;     // the water grid (part of the key; the engine ignores it)
  return p;
}

/** What changes the bake of a hole (never its colours or opacities: those only repaint). */
export function floodKey(areaHash, params) {
  const s = Object.keys(params).sort().map((k) => `${k}=${JSON.stringify(params[k])}`).join("|");
  return `${FLOOD_VERSION}:${(areaHash >>> 0).toString(36)}:${fnvStr(s).toString(36)}`;
}

const rgbOf = (hex) => { const n = parseInt(String(hex ?? "").replace("#", ""), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/**
 * The colours to paint with: `lut` (256 packed RGBA from water/paint.mjs buildLut, the scene's colours and opacities, master included),
 * the six colours as RGB, and the master opacity.
 */
export function paintKit(lut, colors, master) {
  return { lut, cols: (colors ?? []).map(rgbOf), master };
}

/**
 * One frame of a hole at art resolution (cw x ch RGBA), clipped to the hole. `frame` the engine's level bytes of its box (`box`, in the
 * engine window), `kit` from paintKit. While the water is coming in (`u` < 1 + BAND: the level rising from 0 to 1), only the pixels the
 * water has reached show, a line of foam rides the rising edge and rings spread from the springs.
 */
export const BAND = 0.07;
export function paintFlood(prep, frame, box, kit, u = 2, out = null) {
  const { cx, cy, cw, ch, water, damp, op, shade, fill, eng } = prep, N = cw * ch;
  const px = out ?? new Uint8ClampedArray(N * 4);
  const P32 = new Uint32Array(px.buffer, px.byteOffset, N);
  const { lut, cols, master } = kit, LB = new Uint8Array(lut.buffer);
  const shadow = cols[0] ?? [28, 53, 88], baseC = cols[2] ?? [63, 108, 154], ringC = cols[4] ?? [124, 196, 212], foamC = cols[5] ?? [214, 243, 242];
  // a pixel the engine left empty (the thin end of a crack below its grid): plain water
  const fallbackA = Math.round(255 * master * 0.9);
  const coming = u < 1 + BAND;
  const rings = coming ? prep.springs.map(([sx, sy]) => [sx, sy, u * (prep.R * 1.6 + 6)]) : null;
  for ( let y = 0; y < ch; y++ ) for ( let x = 0; x < cw; x++ ) {
    const i = y * cw + x, o = i * 4;
    if ( !water[i] ) {
      if ( damp[i] && (!coming || u >= fill[i]) ) {
        // damp ground: the shadow colour laid thin, with a few darker wet specks (no checkerboard)
        const a = (h2(cx + x, cy + y, 31) < 0.12 ? 0.34 : 0.2) * master * (coming ? clamp((u - fill[i]) / 0.3, 0, 1) : 1);
        px[o] = shadow[0]; px[o + 1] = shadow[1]; px[o + 2] = shadow[2]; px[o + 3] = Math.round(a * 255);
      } else P32[i] = 0;
      continue;
    }
    if ( coming && u < fill[i] ) { P32[i] = 0; continue; }
    const ex = Math.floor((cx + x + 0.5) / prep.ratio) - eng.x0 - box.x0, ey = Math.floor((cy + y + 0.5) / prep.ratio) - eng.y0 - box.y0;
    const b = ex >= 0 && ey >= 0 && ex < box.w && ey < box.h ? frame[ey * box.w + ex] : 0;
    // the water's TONE is ours, not the engine's per-cell tones (big squares in four or five tones read as a checkerboard): two or
    // three clean depth bands - light shallows at the rim, the mid tone, a dark deep middle - with an ordered dither only along the
    // band seams; the engine only adds its highlights, in a few drifting patches
    const ax = cx + x, ay = cy + y, dep = prep.depth[i], L = prep.level;
    const ev = b ? LB[b * 4 + 3] : 0;
    if ( dep < 0.16 && vnoise(ax / 3, ay / 3, 57) * 0.7 + vnoise(ax / 1.4, ay / 1.4, 58) * 0.3 < 0.2 + dep * 1.6 - 0.05 ) { P32[i] = 0; continue; }   // (an organic, eaten edge: no facets)
    const dw = dep + (vnoise(ax / 6, ay / 6, 45) - 0.5) * 0.14, seam = () => 0;
    // a soft wet gradient (no contour bands): light shallows at the edge, the mid tone, a dark deep middle in a crater
    const tt = L <= 1 ? 0.5 : clamp(dw / 0.55, 0, 1), lerp3 = (A, B, s) => [A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s, A[2] + (B[2] - A[2]) * s];
    const sh = lerp3(baseC, ringC, 0.12), dp = lerp3(baseC, shadow, 0.62), C3 = tt < 0.4 ? lerp3(sh, baseC, tt / 0.4) : L >= 3 ? lerp3(baseC, dp, (tt - 0.4) / 0.6) : baseC;
    const band = tt > 0.7 && L >= 3 ? 2 : 1;
    let r = C3[0], g = C3[1], bl = C3[2];
    let a = 255 * master * (band === 2 ? 1 : 0.92);
    // highlights: the engine's bright wave / sparkle cells in a few patches, and a few short light streaks of sky on the deeper water
    if ( b ) { const q = b * 4; if ( LB[q] + LB[q + 1] + LB[q + 2] > baseC[0] + baseC[1] + baseC[2] + 90 && vnoise(ax / 7, ay / 4.5, 47) > 0.72 && h2(ax, ay, 49) < 0.45 + 0.3 * vnoise(ax / 2, ay / 2, 48) - 0.25 ) { r += (LB[q] - r) * 0.65; g += (LB[q + 1] - g) * 0.65; bl += (LB[q + 2] - bl) * 0.65; } }
    a = a * op[i] / 255;
    // foam: broken blobs of varying width where the water meets the shore (0-2.5 px, gaps), never a constant offset outline
    if ( L >= 2 ) {
      // a few irregular wet highlights near the edge (no outline)
      const dpx = dep * Math.max(2.5, prep.R);
      // the edge wet and dark, irregular (no light rim)
      if ( dpx < 1.2 + 1.6 * vnoise(ax / 3, ay / 3, 54) ) { r += (shadow[0] - r) * 0.35; g += (shadow[1] - g) * 0.35; bl += (shadow[2] - bl) * 0.35; }
    }
    if ( coming ) {
      // the rising front: a soft wet edge (the water there thin and dark, fading in) - no pale line
      if ( u - fill[i] < BAND ) { const f = (u - fill[i]) / BAND; r += (shadow[0] - r) * 0.3; g += (shadow[1] - g) * 0.3; bl += (shadow[2] - bl) * 0.3; a *= 0.35 + 0.65 * f; }
      else if ( rings ) for ( let k = 0; k < rings.length; k++ ) {
        // broken ARCS: each spring's ring its own speed, a wobbling radius and whole segments missing
        const [sx, sy, rr0] = rings[k], ang = Math.atan2((y - sy) * 1.15, x - sx), rr = rr0 * (0.75 + 0.45 * h2(k, 5, 61)) * (1 + 0.08 * Math.sin(ang * 3 + k));
        const seg = Math.floor((ang + Math.PI) / (Math.PI * 2) * 7);
        if ( h2(seg, k, 62) < 0.4 ) continue;
        const d = Math.hypot(x - sx, (y - sy) * 1.15);
        if ( rr > 1 && Math.abs(d - rr) < 0.55 ) { r = ringC[0]; g = ringC[1]; bl = ringC[2]; a = Math.max(a, 200 * master * clamp(1.4 - u, 0.3, 1)); break; }
      }
    }
    px[o] = r; px[o + 1] = g; px[o + 2] = bl; px[o + 3] = Math.round(a);
  }
  return px;
}

/** Is there water at a cover-local art pixel of a prepared hole? Returns its depth (0..1) or -1. */
export function waterAt(prep, x, y) {
  if ( x < 0 || y < 0 || x >= prep.cw || y >= prep.ch ) return -1;
  const i = y * prep.cw + x;
  return prep.water[i] ? prep.depth[i] : -1;
}
