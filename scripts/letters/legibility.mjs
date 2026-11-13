/* LETR (LOOK): legibility of treated letters. Pure: no DOM, runs in node checks and at plan time.
   A tiny "reader": every letter shape is rasterised in a square frame (its plain glyph's box), thickened a little (the ink line),
   pooled to a coarse grid and compared by correlation with the plain glyphs of the same font. A treated letter (jagged, rough,
   flaming, dripping) still reads when it is clearly closer to its own plain glyph than to any other letter or sign of the font:
   a jagged S must not become a $, a burning F not an I. shape.mjs uses it to tame a treatment that breaks a letter (the edge is
   redrawn weaker until it reads); check.mjs uses it to prove every hand keeps every letter readable. */
import { bbox } from "./geom.mjs";

const N = 32;            // raster side
const P = 16;            // pooled grid side (N / P = 3 px per cell)
export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ĄĆĘŁŃÓŚŹŻ";
/* a Polish letter is its base letter plus a mark (bar, ogonek, acute, dot): it must read as the base AND keep the mark in sight */
const MARKED = { "Ą": "A", "Ć": "C", "Ę": "E", "Ł": "L", "Ń": "N", "Ó": "O", "Ś": "S", "Ź": "Z", "Ż": "Z" };
const MARK_MIN = 0.5;    // part of the mark's pixels that must stay inked (treated, and with what lies in front of it cut away)
const CELL = new Uint16Array(N * N);   // raster pixel -> pooled cell
for ( let r = 0; r < N; r++ ) for ( let c = 0; c < N; c++ ) CELL[r * N + c] = Math.floor(r * P / N) * P + Math.floor(c * P / N);
const DISTRACT = "$&!?#%@";   // signs a broken letter can turn into (S -> $)
/* pairs that are look-alikes in plain type too: the reader does not hold them against a treatment */
const TWINS = new Set([...Object.entries(MARKED).flatMap(([a, b]) => [a + b, b + a]), "ŹŻ", "ŻŹ", "ÓO", "Ó0", "0Ó", "ÓQ", "QÓ", "ÓD", "DÓ","O0", "0O", "I1", "1I", "S5", "5S", "Z2", "2Z", "B8", "8B", "OQ", "QO", "OD", "DO", "0D", "D0", "0Q", "Q0", "G6", "6G"]);
/* thresholds (calibrated on all fonts x treatments, see check.mjs) */
export const READ = { minSelf: 0.75, gap: 0.05 };

/* nonzero scanline fill of closed polygons into an N x N mask over the frame [fx, fx + w] x [fy, fy + h] (h = w by default); every
   edge is put in the rows it crosses once (cost: edges + crossings, not rows x edges) */
export function raster(cs, fx, fy, w, n = N, h = w) {
  const m = new Uint8Array(n * n), kx = n / w, k = n / h;
  const rows = new Array(n);
  for ( const c of cs ) {
    const q = c.length / 2;
    for ( let i = 0; i < q; i++ ) {
      const j = i + 1 === q ? 0 : i + 1, ay = (c[2 * i + 1] - fy) * k - 0.5, by = (c[2 * j + 1] - fy) * k - 0.5;
      if ( ay === by ) continue;
      const lo = Math.max(0, Math.ceil(Math.min(ay, by))), hi = Math.min(n - 1, Math.ceil(Math.max(ay, by)) - 1);
      if ( lo > hi ) continue;
      const ax = (c[2 * i] - fx) * kx - 0.5, bx = (c[2 * j] - fx) * kx - 0.5, dir = by > ay ? 1 : -1, sl = (bx - ax) / (by - ay);
      for ( let r = lo; r <= hi; r++ ) (rows[r] ??= []).push(ax + (r - ay) * sl, dir);
    }
  }
  for ( let r = 0; r < n; r++ ) {
    const xs = rows[r]; if ( !xs || xs.length < 4 ) continue;
    const idx = []; for ( let t = 0; t < xs.length; t += 2 ) idx.push(t);
    idx.sort((a, b) => xs[a] - xs[b]);
    let w = 0;
    for ( let t = 0; t < idx.length - 1; t++ ) {
      w += xs[idx[t] + 1];
      if ( w === 0 ) continue;
      const c0 = Math.max(0, Math.ceil(xs[idx[t]])), c1 = Math.min(n - 1, Math.floor(xs[idx[t + 1]]));
      for ( let cc = c0; cc <= c1; cc++ ) m[r * n + cc] = 1;
    }
  }
  return m;
}
function dilate(m, n = N) {
  const o = new Uint8Array(m.length);
  for ( let r = 0; r < n; r++ ) for ( let c = 0; c < n; c++ ) {
    if ( m[r * n + c] ) { o[r * n + c] = 1; continue; }
    if ( (c > 0 && m[r * n + c - 1]) || (c < n - 1 && m[r * n + c + 1]) || (r > 0 && m[(r - 1) * n + c]) || (r < n - 1 && m[(r + 1) * n + c]) ) o[r * n + c] = 1;
  }
  return o;
}
/* the feature: pooled coverage, centred and unit length (so a dot product is a correlation) */
function feature(cs, frame, cut = null) {
  /* the frame is stretched to the square raster (an OCR habit: a narrow and a wide letter fill the same grid) */
  const m = raster(cs, frame.x, frame.y, frame.w, N, frame.h);
  /* what covers the letter (the letters in front of it with their outlines, ink cracks across it) is cut out of it */
  /* cut = [{ cs, grow }]: each group rasterised on its own (windings of two groups never cancel), thickened, then removed */
  for ( const g of cut ?? [] ) {
    if ( !g.cs?.length ) continue;
    let c = raster(g.cs, frame.x, frame.y, frame.w, N, frame.h);
    for ( let k = Math.round((g.grow ?? 0) * N / Math.min(frame.w, frame.h)); k > 0; k-- ) c = dilate(c);
    for ( let i = 0; i < m.length; i++ ) if ( c[i] ) m[i] = 0;
  }
  const f = new Float64Array(P * P), g = new Float64Array(P * P);
  for ( let i = 0; i < N * N; i++ ) if ( m[i] ) f[CELL[i]] += 1;
  /* a soft blur over the cells (weights 1/2, 1, 1/2 across and down, renormalised at the border): a wobbling edge moves ink into the
     neighbouring cell, a missing stroke empties a region */
  for ( let r = 0; r < P; r++ ) for ( let c = 0; c < P; c++ ) { const i = r * P + c; g[i] = (f[i] + 0.5 * ((c > 0 ? f[i - 1] : 0) + (c < P - 1 ? f[i + 1] : 0))) / BW[c]; }
  let mean = 0;
  for ( let r = 0; r < P; r++ ) for ( let c = 0; c < P; c++ ) { const i = r * P + c; const v = (g[i] + 0.5 * ((r > 0 ? g[i - P] : 0) + (r < P - 1 ? g[i + P] : 0))) / BW[r]; f[i] = v; mean += v; }
  mean /= P * P;
  let l = 0; for ( let i = 0; i < P * P; i++ ) { f[i] -= mean; l += f[i] * f[i]; }
  l = Math.sqrt(l) || 1; for ( let i = 0; i < P * P; i++ ) f[i] /= l;
  return { f, mask: m };
}
const BW = Array.from({ length: P }, (_, i) => 1 + (i > 0 ? 0.5 : 0) + (i < P - 1 ? 0.5 : 0));
const dot = (a, b) => { let s = 0; for ( let i = 0; i < a.length; i++ ) s += a[i] * b[i]; return s; };
function frameOf(cs) {
  const b = bbox(cs), w = Math.max(0.05, b.x1 - b.x0), h = Math.max(0.05, b.y1 - b.y0);
  return { x: b.x0 - w * 0.06, y: b.y0 - h * 0.06, w: w * 1.12, h: h * 1.12 };
}

/* the reader of one font bank: plain features per font are built once, on first use */
export function makeReader(bank) {
  const fonts = new Map();
  const plainOf = (font) => {
    let F = fonts.get(font);
    if ( F ) return F;
    F = new Map();
    for ( const ch of ALPHABET + DISTRACT ) {
      /* Polish letters a font lacks are built by the bank from its own outlines (fontbank.mjs synth): read those */
      const g = MARKED[ch] ? (bank.raw?.(font, ch) ?? (bank.glyph?.(font, ch)?.font === font ? bank.glyph(font, ch) : null)) : bank.raw?.(font, ch);
      if ( !g?.contours?.length ) continue;
      const fr = frameOf(g.contours);
      const t = feature(g.contours, fr); F.set(ch, { f: t.f, mask: t.mask, fr, cs: g.contours });
    }
    /* the mark of a Polish letter: its pixels that the base letter (same font, same origin) does not cover even thickened */
    for ( const [ch, e] of F ) {
      const b = MARKED[ch] && F.get(MARKED[ch]); if ( !b ) continue;
      const own = e.mask, bm = dilate(dilate(raster(b.cs, e.fr.x, e.fr.y, e.fr.w, N, e.fr.h)));
      const idx = []; for ( let i = 0; i < N * N; i++ ) if ( own[i] && !bm[i] ) idx.push(i);
      if ( idx.length >= 4 ) e.mark = Int32Array.from(idx);
    }
    /* each letter's plain margin to its nearest non-twin neighbour: how distinct it is in this font to begin with */
    for ( const [ch, e] of F ) {
      let best = -1; for ( const [c2, e2] of F ) if ( c2 !== ch && !TWINS.has(ch + c2) ) best = Math.max(best, dot(e.f, e2.f));
      e.margin = 1 - best;
    }
    fonts.set(font, F);
    return F;
  };
  /* how a treated outline reads: { self, other, as, ok } (ok = still reads as `ch`); letters outside the alphabet always pass */
  function read(font, ch, cs, cut = null, own = false) {
    const F = plainOf(font), e = F.get(ch);
    if ( !e ) return { self: 1, other: 0, as: ch, ok: true };
    /* read in two frames: the plain letter's box (where the letter was meant) and the treated shape's own box (what a reader sees
       when flames or drips stretch it); every candidate gets the better of the two */
    /* own = true: the shape is placed in a word (scaled, leaning): it is only read in its own box */
    const T2 = feature(cs, frameOf(cs), cut), T1 = own ? T2 : feature(cs, e.fr, cut), t1 = T1.f, t2 = T2.f;
    /* a Polish mark must still be there: the treated letter (minus what covers it) inks most of the mark's pixels, in the plain
       letter's box, give or take a pixel */
    let mark = 1;
    if ( e.mark ) { const m = dilate(own ? feature(cs, e.fr, cut).mask : T1.mask); let hit = 0; for ( const i of e.mark ) hit += m[i]; mark = hit / e.mark.length; }
    const self = Math.max(dot(t1, e.f), dot(t2, e.f));
    let other = -1, as = ch;
    for ( const [c2, e2] of F ) {
      if ( c2 === ch || TWINS.has(ch + c2) ) continue;
      const d = Math.max(dot(t1, e2.f), dot(t2, e2.f));
      if ( d > other ) { other = d; as = c2; }
    }
    const shapeOk = self >= READ.minSelf && self - other >= Math.min(READ.gap, 0.5 * e.margin);   // look-alikes in this font (H/N in Titan) need less
    const ok = shapeOk && mark >= MARK_MIN;
    return { self, other, as: ok ? ch : shapeOk ? MARKED[ch] : as, ok, mark };
  }
  /* letters the reader has a plain glyph for in some font it was asked about (the alphabet, digits, Polish letters) */
  const knows = (ch) => ALPHABET.includes(ch);
  return { read, plainOf, knows };
}
