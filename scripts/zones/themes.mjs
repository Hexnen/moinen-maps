/**
 * The characters of the zone look presets: everything a line style brings besides the plain lines - its own palette for the zone
 * tints, a "wash" baked once per set of zones (soft colour along the inside of every zone border, paper tones, halftone, gold clouds),
 * its border drawing, its number badge and extras on the hovered zone.
 *
 * Costs: the wash is ONE sprite (a 2D canvas of at most WASH_MAX px, baked when the zones or the look change, never per frame); the
 * borders and badges are plain Graphics drawn again only when the zoom moved by ~8 % (like every other line style).
 */

const TAU = Math.PI * 2;
const WASH_MAX = 1600;

/* ---------------------------------------------------------------- small helpers */

/** A stable pseudo-random number in [0, 1) for an integer-ish seed. */
export function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
const css = (n, a = 1) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
const mix = (a, b, t) => {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t), g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

/** Flat [x, y, ...] -> [[x, y], ...]. */
const pairs = (p) => { const out = []; for ( let i = 0; i + 1 < p.length; i += 2 ) out.push([p[i], p[i + 1]]); return out; };
const lenOf = (P) => { let s = 0; for ( let i = 1; i < P.length; i++ ) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return s; };

/** Catmull-Rom through points [[x, y], ...], `n` samples per span. */
export function spline(P, n = 6, closed = false) {
  const m = P.length;
  if ( m < 3 ) return P.slice();
  const at = (i) => closed ? P[(i + m) % m] : P[Math.max(0, Math.min(m - 1, i))];
  const out = [], last = closed ? m : m - 1;
  for ( let i = 0; i < last; i++ ) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for ( let k = 0; k < n; k++ ) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
    }
  }
  out.push(closed ? P[0] : P[m - 1]);
  return out;
}

/** A polyline [[x, y]] cut into pieces of about `step` length (the last piece takes the rest). Pieces overlap by `over`. */
function pieces(P, step, over = 0) {
  const L = lenOf(P);
  const n = Math.max(1, Math.round(L / step)), each = L / n, out = [];
  for ( let k = 0; k < n; k++ ) out.push(sub(P, Math.max(0, k * each - over), Math.min(L, (k + 1) * each + over)));
  return out.filter((q) => q.length >= 2);
}
/** The part of a polyline between two distances along it. */
function sub(P, a, b) {
  const out = [];
  let s = 0;
  for ( let i = 1; i < P.length; i++ ) {
    const [ax, ay] = P[i - 1], [bx, by] = P[i], L = Math.hypot(bx - ax, by - ay);
    if ( L < 1e-9 ) continue;
    const s0 = s, s1 = s + L;
    if ( s1 >= a && s0 <= b ) {
      const t0 = Math.max(0, (a - s0) / L), t1 = Math.min(1, (b - s0) / L);
      if ( !out.length ) out.push([ax + (bx - ax) * t0, ay + (by - ay) * t0]);
      out.push([ax + (bx - ax) * t1, ay + (by - ay) * t1]);
    }
    s = s1;
    if ( s > b ) break;
  }
  return out;
}
/** Points every `step` along a polyline: [[x, y, nx, ny, s]] (unit normal, distance walked). */
function along(P, step, from = step / 2) {
  const out = [];
  let s = 0, next = from;
  for ( let i = 1; i < P.length; i++ ) {
    const [ax, ay] = P[i - 1], [bx, by] = P[i], L = Math.hypot(bx - ax, by - ay);
    if ( L < 1e-9 ) continue;
    while ( next <= s + L ) {
      const t = (next - s) / L;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t, -(by - ay) / L, (bx - ax) / L, next]);
      next += step;
    }
    s += L;
  }
  return out;
}
/** A polyline moved sideways by d (along its normal). */
function offset(P, d) {
  const n = P.length;
  return P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / L) * d, p[1] + ((b[0] - a[0]) / L) * d];
  });
}
const tracePts = (G, P) => { G.moveTo(P[0][0], P[0][1]); for ( let i = 1; i < P.length; i++ ) G.lineTo(P[i][0], P[i][1]); };

/**
 * A ribbon of varying width along a polyline, filled: wf(t, s) gives the full width at t (0..1 of the length) / s (distance). Drawn as
 * one quad per span (no self-intersecting polygons on tight bends); meant for opaque ink.
 */
export function ribbon(G, P, wf) {
  const n = P.length;
  if ( n < 2 ) return;
  const S = [0];
  for ( let i = 1; i < n; i++ ) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const tot = S[n - 1] || 1, Lp = [], Rp = [];
  for ( let i = 0; i < n; i++ ) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L, h = Math.max(0, wf(S[i] / tot, S[i])) / 2;
    Lp.push([P[i][0] + nx * h, P[i][1] + ny * h]); Rp.push([P[i][0] - nx * h, P[i][1] - ny * h]);
  }
  for ( let i = 1; i < n; i++ ) G.drawPolygon([Lp[i - 1][0], Lp[i - 1][1], Lp[i][0], Lp[i][1], Rp[i][0], Rp[i][1], Rp[i - 1][0], Rp[i - 1][1]]);
}

/**
 * A spacing for decorations along the borders that stays put on the map: `base` scene px, doubled until it is at least `minScreen`
 * screen px apart at this zoom. Zooming within one octave never moves a decoration.
 */
const octave = (base, minScreen, px) => { let s = base; while ( s / px < minScreen ) s *= 2; return s; };

/* ---------------------------------------------------------------- glyphs drawn as strokes */

/** Single-stroke digits, hand-lettered (box 0..0.62 x 0..1). */
const DIGITS = {
  0: [[[0.31, 0], [0.06, 0.18], [0.02, 0.55], [0.12, 0.9], [0.33, 1], [0.54, 0.84], [0.6, 0.45], [0.5, 0.1], [0.3, 0], [0.22, 0.04]]],
  1: [[[0.12, 0.2], [0.34, 0.02], [0.33, 1]], [[0.12, 1], [0.54, 0.99]]],
  2: [[[0.05, 0.22], [0.25, 0.02], [0.5, 0.08], [0.55, 0.32], [0.35, 0.62], [0.04, 0.99], [0.6, 0.97]]],
  3: [[[0.06, 0.12], [0.3, 0], [0.54, 0.14], [0.5, 0.38], [0.24, 0.48], [0.52, 0.6], [0.58, 0.84], [0.32, 1], [0.03, 0.9]]],
  4: [[[0.44, 1], [0.44, 0.02], [0.02, 0.68], [0.62, 0.68]]],
  5: [[[0.56, 0.02], [0.12, 0.03], [0.07, 0.45], [0.32, 0.38], [0.55, 0.55], [0.56, 0.84], [0.3, 1], [0.03, 0.9]]],
  6: [[[0.5, 0.04], [0.2, 0.22], [0.04, 0.6], [0.1, 0.9], [0.3, 1], [0.52, 0.86], [0.53, 0.63], [0.32, 0.5], [0.06, 0.62]]],
  7: [[[0.02, 0.03], [0.6, 0.02], [0.4, 0.45], [0.22, 1]]],
  8: [[[0.31, 0.48], [0.07, 0.3], [0.12, 0.06], [0.31, 0], [0.5, 0.08], [0.52, 0.3], [0.31, 0.48], [0.04, 0.7], [0.09, 0.94], [0.31, 1], [0.55, 0.92], [0.58, 0.7], [0.31, 0.48]]],
  9: [[[0.56, 0.34], [0.36, 0.5], [0.09, 0.42], [0.06, 0.16], [0.3, 0], [0.55, 0.14], [0.56, 0.36], [0.5, 0.74], [0.22, 1]]]
};
export const DIGIT_W = 0.62;

/** Kanji numerals as brush strokes (box 0..1). */
const KANJI = {
  "一": [[[0.06, 0.52], [0.5, 0.49], [0.94, 0.5]]],
  "二": [[[0.2, 0.3], [0.5, 0.28], [0.8, 0.29]], [[0.05, 0.74], [0.5, 0.71], [0.95, 0.73]]],
  "三": [[[0.2, 0.16], [0.5, 0.15], [0.8, 0.16]], [[0.27, 0.48], [0.5, 0.47], [0.74, 0.48]], [[0.05, 0.84], [0.5, 0.81], [0.95, 0.83]]],
  "四": [[[0.1, 0.16], [0.11, 0.88]], [[0.11, 0.16], [0.89, 0.15], [0.88, 0.88]], [[0.4, 0.18], [0.38, 0.52], [0.24, 0.66]], [[0.6, 0.18], [0.6, 0.55], [0.75, 0.6]], [[0.12, 0.84], [0.88, 0.84]]],
  "五": [[[0.14, 0.12], [0.86, 0.11]], [[0.46, 0.12], [0.37, 0.84]], [[0.2, 0.46], [0.74, 0.45], [0.69, 0.85]], [[0.04, 0.87], [0.96, 0.86]]],
  "六": [[[0.46, 0.04], [0.56, 0.2]], [[0.06, 0.36], [0.94, 0.35]], [[0.36, 0.52], [0.16, 0.88]], [[0.62, 0.52], [0.86, 0.84]]],
  "七": [[[0.06, 0.44], [0.94, 0.34]], [[0.4, 0.08], [0.4, 0.78], [0.56, 0.88], [0.88, 0.86], [0.93, 0.7]]],
  "八": [[[0.38, 0.18], [0.32, 0.56], [0.08, 0.88]], [[0.6, 0.18], [0.7, 0.58], [0.94, 0.86]]],
  "九": [[[0.44, 0.06], [0.42, 0.48], [0.1, 0.9]], [[0.14, 0.34], [0.64, 0.33], [0.62, 0.8], [0.72, 0.89], [0.92, 0.87], [0.95, 0.7]]],
  "十": [[[0.06, 0.46], [0.94, 0.45]], [[0.5, 0.06], [0.5, 0.94]]],
  "〇": [[[0.5, 0.08], [0.15, 0.25], [0.12, 0.7], [0.5, 0.92], [0.86, 0.7], [0.84, 0.26], [0.5, 0.08], [0.4, 0.12]]]
};

/** A brush stroke in ink: pressed at the start, a slow swell, a dry lifted tail. */
function brushWidth(w, seed) {
  return (t) => {
    const press = t < 0.1 ? 0.75 + 4.5 * t : 1.2 - 0.25 * Math.min(1, (t - 0.1) / 0.3);
    const tail = t > 0.72 ? Math.max(0.18, 1 - (t - 0.72) * 2.9) : 1;
    return w * press * tail * (0.92 + 0.12 * Math.sin(t * 9 + seed));
  };
}

/** Write a kanji numeral string vertically with the brush (glyph box `s`, centred on 0, 0). Returns its height. */
export function brushKanji(G, text, s, color, gap = 0.12) {
  const chars = [...text], h = chars.length * s + (chars.length - 1) * s * gap;
  let y = -h / 2;
  for ( const [ci, ch] of chars.entries() ) {
    const strokes = KANJI[ch];
    if ( strokes ) {
      G.lineStyle(0); G.beginFill(color, 1);
      for ( const [k, st] of strokes.entries() ) {
        const P = spline(st.map(([x, yy]) => [-s / 2 + x * s, y + yy * s]), 5);
        ribbon(G, P, brushWidth(s * 0.15, ci * 3 + k));
      }
      G.endFill();
    }
    y += s * (1 + gap);
  }
  return h;
}

/** Hand-lettered digits in pencil (height `h`, centred). Non-digits are skipped: callers fall back to text for those. */
export function handDigits(G, text, h, color, width, seed = 0) {
  const ds = [...text], adv = h * (DIGIT_W + 0.16), W = ds.length * adv - h * 0.16;
  let x = -W / 2;
  for ( const [i, d] of ds.entries() ) {
    for ( const [k, st] of (DIGITS[d] ?? []).entries() ) {
      const P = spline(st.map(([px, py]) => [x + px * h, -h / 2 + py * h]), 6);
      for ( const pass of [0, 1] ) {
        const j = (pass ? 0.035 : -0.02) * h, sd = seed * 7 + i * 3 + k + pass;
        G.lineStyle({ width: width * (pass ? 0.7 : 1), color, alpha: pass ? 0.75 : 1, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
        tracePts(G, P.map(([qx, qy], q) => [qx + j * Math.sin(q * 0.7 + sd), qy + j * Math.cos(q * 0.9 + sd)]));
      }
    }
    x += adv;
  }
}
export const isDigits = (t) => /^\d+$/.test(t);

/** A cherry blossom: five notched petals, a darker heart and stamens. */
const PETAL = [[0, 0], [0.34, -0.24], [0.43, -0.6], [0.31, -0.92], [0.13, -1], [0, -0.86], [-0.13, -1], [-0.31, -0.92], [-0.43, -0.6], [-0.34, -0.24]];
export function blossom(G, x, y, r, rot, { petal = 0xffe3ee, edge = 0xe07aa0, heart = 0xc2386b, stamen = 0xffd27a, alpha = 1, open = 1 } = {}) {
  G.lineStyle({ width: Math.max(0.6, r * 0.09), color: edge, alpha: 0.9 * alpha, join: PIXI.LINE_JOIN.ROUND });
  G.beginFill(petal, alpha);
  for ( let i = 0; i < 5; i++ ) {
    const a = rot + (i * TAU) / 5, c = Math.cos(a), s = Math.sin(a), k = r * open;
    G.drawPolygon(PETAL.flatMap(([px, py]) => [x + (px * c - py * s) * k, y + (px * s + py * c) * k]));
  }
  G.endFill();
  G.lineStyle(0);
  G.beginFill(heart, 0.85 * alpha).drawCircle(x, y, r * 0.3).endFill();
  if ( r >= 4 ) {
    G.beginFill(stamen, alpha);
    for ( let i = 0; i < 5; i++ ) { const a = rot + TAU / 10 + (i * TAU) / 5; G.drawCircle(x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.42, Math.max(0.6, r * 0.08)); }
    G.endFill();
  }
}

/* ---------------------------------------------------------------- the baked wash */

/** The zones as one Path2D each (holes cut out by the even-odd rule). */
const pathOf = (z) => { const p = new Path2D(); for ( const part of z.parts ) for ( const r of part ) { p.moveTo(r[0], r[1]); for ( let i = 2; i < r.length; i += 2 ) p.lineTo(r[i], r[i + 1]); p.closePath(); } return p; };

/** Soft colour along the inside of the zone border: layered strokes (the clip keeps their inner half). */
function band(c, path, color, width, alpha, steps = 7) {
  const a = 1 - Math.pow(1 - Math.min(0.98, alpha), 1 / steps);
  c.strokeStyle = css(color); c.lineJoin = "round";
  for ( let i = 0; i < steps; i++ ) { c.globalAlpha = a; c.lineWidth = 2 * width * (1 - i / steps) ** 1.35; c.stroke(path); }
  c.globalAlpha = 1;
}

/**
 * Bake a theme's wash for these zones: a canvas over the zones' bounding box. Returns { tex, x, y, scale } or null.
 * u = scene px per "unit" (a 50 px grid's pixel), so sizes follow the grid of the map.
 */
export function bakeWash(Z, W, colorOf, look, g) {
  if ( !W || !Z?.zones.length ) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for ( const z of Z.zones ) for ( const part of z.parts ) { const r = part[0]; for ( let i = 0; i < r.length; i += 2 ) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); } }
  const w = x1 - x0, h = y1 - y0;
  if ( !(w > 1 && h > 1) ) return null;
  const k = Math.min(W.sharp ? 1.5 : 1, (W.max ?? WASH_MAX) / Math.max(w, h));
  const cw = Math.max(2, Math.ceil(w * k) + 2), ch = Math.max(2, Math.ceil(h * k) + 2);
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
  const c = cv.getContext("2d", { willReadFrequently: !!W.pixels });
  c.setTransform(k, 0, 0, k, 1 - x0 * k, 1 - y0 * k);
  const u = g / 50, fill = look.fill, ink = Math.min(1.4, look.ink);
  const zs = Z.zones.map((z) => ({ z, path: pathOf(z), color: colorOf(z.id) }));
  for ( const it of zs ) {
    c.save(); c.clip(it.path, "evenodd");
    W.zone?.(c, { ...it, u, fill, ink, look, g });
    c.restore();
  }
  W.after?.(c, { zs, u, fill, ink, look, g, k, x0, y0, cv });
  if ( W.pixels ) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    const img = c.getImageData(0, 0, cw, ch);
    W.pixels(img.data, cw, ch, { k, u, x0, y0 });
    c.putImageData(img, 0, 0);
  }
  return { canvas: cv, x: x0 - 1 / k, y: y0 - 1 / k, scale: 1 / k };
}

/* ---------------------------------------------------------------- the themes */

const R = () => ({ cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
const INK = 0x15110f;

/** Junction points of the border network (ends of the chains), deduplicated. */
function junctions(Z) {
  const out = [], seen = new Set();
  for ( const p of Z.core ) for ( const i of [0, p.length - 2] ) {
    const key = `${Math.round(p[i] / 4)},${Math.round(p[i + 1] / 4)}`;
    if ( seen.has(key) ) continue;
    seen.add(key); out.push([p[i], p[i + 1]]);
  }
  return out;
}

/** A soft drop shadow under a badge (badge units). */
function shadow(G, draw, dy = 2.2, a = 0.32) {
  G.lineStyle(0);
  G.beginFill(0x000000, a * 0.45); draw(dy * 1.8, 2.2); G.endFill();
  G.beginFill(0x000000, a); draw(dy, 0.6); G.endFill();
}

const text = (s, style, res) => { const t = new PIXI.Text(s, style); t.resolution = res; t.anchor.set(0.5, 0.5); return t; };

export const THEMES = {

  /* ---- classic: a printed field map - tinted zones with a darker ribbon inside each border, cream dashes on a dark casing, board-game counters */
  dashed: {
    keepFill: true,
    palette: [0xd9a441, 0x5aa9c9, 0x9bc46b, 0xc97b9b, 0x8c7bd1, 0xd47a4a, 0x6fc2b0],
    wash: { zone(c, o) { band(c, o.path, mix(o.color, 0x000000, 0.35), 20 * o.u, 0.8 * Math.min(1, o.fill * 2.4)); band(c, o.path, mix(o.color, 0x000000, 0.5), 4 * o.u, 0.7 * Math.min(1, o.ink), 3); } },
    lines(D) {
      const { Ln, px, w, col, a, stroke } = D;
      stroke(w * 1.35, INK, 0.8 * a, (p) => D.trace(Ln, p));
      stroke(w * 0.55, col, a, (p) => D.pattern(Ln, p, [13 * px, 6 * px]));
    },
    hoverTint: 0xfff2c8
  },

  /* ---- subtle: a fine light hairline over a soft shadow, a soft shade inside each zone, a small pill on hover */
  hairline: {
    // no wash: the zones keep the map as it is, under the faintest milky veil (pale tints); the line carries the preset
    palette: [0xf4efe4, 0xe8eef2, 0xeef2e8, 0xf2e8ec, 0xece8f4, 0xf4ece2],
    lines(D) {
      const { Ln, Z, px, w, col, a, stroke } = D;
      // a thin, soft shadow under a fine light line: lifted off the map, never heavy
      // a soft shadow line with a string of fine light beads on it: the map's own roads are lines, the zone borders are beads
      stroke(w * 2.4, col, 0.08 * a, (p) => D.trace(Ln, p));
      stroke(w * 1.0, 0x000000, 0.18 * a, (p) => D.trace(Ln, p));
      stroke(w * 0.55, 0x000000, 0.34 * a, (p) => D.trace(Ln, p));
      stroke(Math.max(3.2 * px, w * 0.62), col, a, (p) => D.pattern(Ln, p, [0.01 * px, 8 * px]));
      // a small light bead where borders meet
      for ( const [x, y] of junctions(Z) ) {
        Ln.lineStyle({ width: 1.2 * px, color: 0x000000, alpha: 0.35 * a }); Ln.beginFill(col, a).drawCircle(x, y, 4 * px).endFill();
      }
    },
    hoverTint: 0xfffaf0
  },

  /* ---- sketch: graphite on the map - pencil shading hatched along every border, wandering passes that overshoot the corners, hand-lettered numbers */
  sketch: {
    palette: [0xf2efe6, 0xe9eef2, 0xeef2e6, 0xf2e8ec],
    wash: {
      sharp: true, max: 2048,
      zone(c, o) { band(c, o.path, 0xffffff, 24 * o.u, 0.98 * Math.min(1, o.ink), 6); },
      // the band becomes pencil hatching (architect's shading), drawn once over the whole box and kept to the band
      after(c, { u, k, x0, y0, cv }) {
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "source-in";
        const gap = 5 * u * k, W = cv.width, H = cv.height;
        c.strokeStyle = "rgba(30,30,38,1)"; c.lineWidth = Math.max(0.9, 1.4 * u * k); c.beginPath();
        for ( let s = -H; s < W; s += gap ) { c.moveTo(s, H); c.lineTo(s + H * 0.8, 0); }
        c.stroke(); c.restore();
      }
    },
    lines(D) {
      const { Ln, Z, px, w, a } = D, lead = 0x24242c;
      const overs = Z.core.map((p) => { const P = pairs(p); return P.length < 2 ? P : extend(P, 11 * px); });
      // paper under the pencil so it reads on dark water
      Ln.lineStyle({ width: w * 1.5, color: 0xfffdf6, alpha: 0.6 * a, ...R() }); for ( const P of overs ) tracePts(Ln, P);
      for ( const [k, [wd, al, amp]] of [[0.62, 0.95, 1.2], [0.4, 0.75, 2.4], [0.28, 0.6, 3.4]].entries() ) {
        Ln.lineStyle({ width: Math.max(1.1 * px, w * wd), color: lead, alpha: al * a, ...R() });
        for ( const [i, P] of overs.entries() ) tracePts(Ln, wob(P, amp * px, k * 3 + i * 0.37, px));
      }
    },
    hoverColor: 0x24242c
  },

  /* ---- bold: a transit map - thick white lines on a black casing, saturated zones with a strong rim, big solid discs in each zone's own colour */
  solid: {
    keepFill: true,
    palette: [0xffb000, 0x00a6d6, 0x6cc24a, 0xe5367e, 0x7a5cff, 0xff6a2b, 0x13c3a6],
    wash: { zone(c, o) { band(c, o.path, o.color, 16 * o.u, 0.95 * Math.min(1, o.fill * 2), 4); } },
    lines(D) {
      const { Ln, w, col, a, stroke } = D;
      stroke(w * 2.1, INK, 0.95 * a, (p) => D.trace(Ln, p));
      stroke(w * 1.1, col, a, (p) => D.trace(Ln, p));
    }
  },

  /* ---- comic 2: halftone dots thick along every panel edge and thinning inwards, paper gutters, big caption boxes */
  halftone: {
    palette: [0xffd400, 0x00a0e9, 0xe4007f, 0x4cb848, 0xf15a24, 0x8e44ad],
    wash: {
      sharp: true, max: 2048,
      zone(c, o) { band(c, o.path, o.color, 34 * o.u, 0.95 * Math.min(1, o.fill * 4), 8); },
      // the band's strength becomes the SIZE of halftone dots (a real halftone screen, 15 degrees)
      pixels(d, W, H, { k, u }) {
        const step = 7.5 * u * k, cs = Math.cos(0.26), sn = Math.sin(0.26), e = 1.2 / step;
        for ( let y = 0; y < H; y++ ) for ( let x = 0; x < W; x++ ) {
          const i = (y * W + x) * 4, a = d[i + 3] / 255;
          if ( a < 0.02 ) { d[i + 3] = 0; continue; }
          const U = (x * cs + y * sn) / step, V = (-x * sn + y * cs) / step;
          const fx = U - Math.floor(U) - 0.5, fy = V - Math.floor(V) - 0.5, dist = Math.sqrt(fx * fx + fy * fy) * 1.414;
          d[i + 3] = Math.round(Math.max(0, Math.min(1, (Math.sqrt(a) * 0.98 - dist) / e + 0.5)) * 235);
        }
      }
    }
  },

  /* ---- fantasy: a cartographer's map - the land in the zones paled to parchment, each realm edged with a watercolour ribbon, sepia dash-dot frontiers */
  ink: {
    palette: [0xb4533c, 0x4f7a54, 0x3d6283, 0xc28f2c, 0x7a4f80, 0x9c6b3f],
    wash: [
      { zone(c, o) { c.fillStyle = css(0xf3e4c0, Math.min(0.55, o.fill * 1.5)); c.fillRect(-1e6, -1e6, 2e6, 2e6); } },
      { blend: "multiply", zone(c, o) {
        band(c, o.path, mix(o.color, 0xffffff, 0.1), 30 * o.u, 0.85 * Math.min(1, o.ink));
        band(c, o.path, mix(o.color, 0x000000, 0.25), 5 * o.u, 0.8 * Math.min(1, o.ink), 3);
      } }
    ],
    lines(D) {
      const { Ln, px, w, a, col, stroke } = D;
      stroke(w * 1.8, 0xf1e2bf, 0.5 * a, (p) => D.trace(Ln, p));
      stroke(w * 0.75, col, a, (p) => D.pattern(Ln, D.wobble(p, 0.9 * px, 3, px), [17 * px, 5 * px, 0.01 * px, 5 * px]));
      stroke(w * 0.24, col, 0.6 * a, (p) => D.trace(Ln, D.wobble(p, 1.4 * px, 5, px)));
    },
    hoverColor: 0x5a3a1c
  },

  /* ---- cyberpunk: night city HUD - zones sunk in shadow with a neon rim each, light-tube borders with chromatic split and circuit traces, chamfered tags */
  neon: {
    palette: [0x00f0ff, 0xff2a6d, 0xfcee0a, 0x05ffa1, 0xb026ff, 0xff8a00],
    wash: {
      zone(c, o) {
        c.fillStyle = css(0x07021a, Math.min(0.75, o.fill * 1.6)); c.fillRect(-1e6, -1e6, 2e6, 2e6);
        band(c, o.path, o.color, 30 * o.u, 0.45 * Math.min(1, o.ink));
        band(c, o.path, o.color, 5 * o.u, 0.6 * Math.min(1, o.ink), 3);
      }
    },
    lines(D) {
      const { Ln, Gw, Z, px, w, a, col } = D, hot = D.look.ringColor ? D.hex(D.look.ringColor) : 0xff2a6d;
      const P = Z.core.map(pairs);
      // the glow, added on top of the map
      for ( const [wd, al, c] of [[w * 4.4, 0.08, hot], [w * 2.5, 0.15, hot], [w * 1.4, 0.25, col]] ) { Gw.lineStyle({ width: wd, color: c, alpha: al * a, ...R() }); for ( const q of P ) tracePts(Gw, q); }
      // chromatic split: a magenta ghost a little off the tube
      Gw.lineStyle({ width: Math.max(1.3 * px, w * 0.24), color: hot, alpha: 0.75 * a, ...R() });
      for ( const q of P ) tracePts(Gw, q.map(([x, y]) => [x + 2.4 * px, y + 1.6 * px]));
      // a dark bed, the tube and its white-hot core
      Ln.lineStyle({ width: w * 1.0, color: 0x05010f, alpha: 0.7 * a, ...R() }); for ( const q of P ) tracePts(Ln, q);
      Ln.lineStyle({ width: w * 0.52, color: col, alpha: a, ...R() }); for ( const q of P ) tracePts(Ln, q);
      Ln.lineStyle({ width: Math.max(0.9 * px, w * 0.17), color: 0xffffff, alpha: 0.9 * a, ...R() }); for ( const q of P ) tracePts(Ln, q);
      // circuit traces: a broken thin rail beside each border, with a via at the end of each run
      const step = octave(D.g * 1.1, 46, px);
      for ( const [i, q] of P.entries() ) {
        if ( lenOf(q) < step * 1.2 ) continue;
        const side = i % 2 ? 1 : -1, rail = offset(q, side * 8 * px);
        for ( const [j, piece] of pieces(rail, step).entries() ) {
          if ( hash(i * 31 + j) < 0.3 ) continue;
          const seg = sub(piece, step * 0.12, lenOf(piece) * (0.55 + 0.35 * hash(i * 7 + j * 13)));
          if ( seg.length < 2 ) continue;
          Ln.lineStyle({ width: 1.6 * px, color: col, alpha: 0.85 * a, ...R() }); tracePts(Ln, seg);
          const e = seg[seg.length - 1];
          Ln.lineStyle({ width: 1.4 * px, color: col, alpha: a }); Ln.beginFill(0x05010f, 1).drawCircle(e[0], e[1], 2.8 * px).endFill();
        }
      }
      // junction nodes: a square chip where borders meet
      for ( const [x, y] of junctions(Z) ) {
        const s = 6.5 * px;
        Ln.lineStyle({ width: 1.8 * px, color: col, alpha: a, join: PIXI.LINE_JOIN.MITER });
        Ln.beginFill(0x05010f, 1).drawRect(x - s, y - s, 2 * s, 2 * s).endFill();
        Ln.lineStyle(0); Ln.beginFill(hot, a).drawRect(x - s * 0.4, y - s * 0.4, s * 0.8, s * 0.8).endFill();
      }
    },
    hoverColor: 0x00f0ff,
    hover(H) {
      // a target lock: four corner brackets round the zone
      const { L, px, bbox: [x0, y0, x1, y1] } = H, m = 6 * px, arm = Math.min(26 * px, (x1 - x0) / 3, (y1 - y0) / 3);
      for ( const [wd, c, al] of [[7 * px, 0x05010f, 0.7], [3 * px, 0xfcee0a, 1]] ) {
        L.lineStyle({ width: wd, color: c, alpha: al, cap: PIXI.LINE_CAP.SQUARE, join: PIXI.LINE_JOIN.MITER });
        for ( const [x, y, sx, sy] of [[x0 - m, y0 - m, 1, 1], [x1 + m, y0 - m, -1, 1], [x1 + m, y1 + m, -1, -1], [x0 - m, y1 + m, 1, -1]] ) {
          L.moveTo(x + sx * arm, y); L.lineTo(x, y); L.lineTo(x, y + sy * arm);
        }
      }
    }
  },

  /* ---- noir: the colour drained, every zone a pool of light in the dark, hard white lines with a long black shadow, typed evidence tags */
  noir: {
    palette: [0xd8d8d8, 0xbdbdbd, 0xe8e8e8, 0xcacaca],
    wash: {
      zone(c, o) {
        // a grey veil takes most of the colour out; a black vignette from every border
        c.fillStyle = css(0x2b2b2b, Math.min(0.7, o.fill * 2)); c.fillRect(-1e6, -1e6, 2e6, 2e6);
        band(c, o.path, 0x000000, 50 * o.u, 0.8 * Math.min(1, o.ink), 9);
      }
    },
    lines(D) {
      const { Ln, px, w, a, col, stroke } = D;
      stroke(w * 1.2, 0x000000, 0.8 * a, (p) => D.trace(Ln, p.map((v) => v + 5 * px)));
      stroke(w * 1.05, 0x000000, 0.95 * a, (p) => D.trace(Ln, p));
      stroke(w * 0.62, col, a, (p) => D.trace(Ln, p));
    },
    hoverColor: 0xffffff
  },

  /* ---- sakura: cherry branches for borders, blossoms and buds along them, a pink haze inside each zone, blossom badges */
  sakura: {
    palette: [0xf7a8c4, 0xf9c6d6, 0xe88aab, 0xfbd3e1, 0xf3b0c8],
    wash: {
      zone(c, o) {
        c.fillStyle = css(0xfff2f6, Math.min(0.45, o.fill * 1.6)); c.fillRect(-1e6, -1e6, 2e6, 2e6);
        band(c, o.path, o.color, 30 * o.u, 0.65 * Math.min(1, o.ink));
      }
    },
    lines(D) {
      const { Ln, Z, px, w, a, col, stroke } = D;
      // a calm line in plum ink inside a pink haze; the blossoms mark only the places where borders meet
      stroke(w * 2.6, col, 0.22 * a, (p) => D.trace(Ln, p));
      stroke(w * 0.85, 0xfff1f6, 0.55 * a, (p) => D.trace(Ln, p));
      stroke(Math.max(1.6 * px, w * 0.4), 0x5a2338, a, (p) => D.trace(Ln, p));
      for ( const [i, [x, y]] of junctions(Z).entries() ) {
        const h = hash(i * 17 + 3);
        blossom(Ln, x, y, 12 * px, h * 6, { alpha: a });
        // a bud or two beside it
        for ( let q = 0; q < 1 + (h > 0.5); q++ ) {
          const an = h * 9 + q * 2.4, d = 13 * px;
          Ln.lineStyle({ width: 0.9 * px, color: 0x9c2f55, alpha: a }); Ln.beginFill(0xf08aae, a).drawCircle(x + Math.cos(an) * d, y + Math.sin(an) * d, 3 * px).endFill();
        }
      }
    },
    hoverColor: 0xff9cc2
  },

  /* ---- sengoku: a gold-leaf folding screen - the map warmed to washi, gold clouds drifting in from the borders, sumi brush strokes, war banners */
  brush: {
    palette: [0xd8a73a, 0xc99a30, 0xe0b448, 0xcf9f3a],
    wash: [
      { blend: "multiply", zone(c, o) { c.fillStyle = css(0xf2dfb4, Math.min(1, o.fill * 3)); c.fillRect(-1e6, -1e6, 2e6, 2e6); } },
      // gold leaf framing every zone like the cloud bands of a folding screen: a scalloped band hugging the border (lobes of
      // varying size), outlined in dark gold, with a sheen across the leaf, its square seams and gold dust (sunago) beyond it
      { after(c0, { zs, u, ink, g, cv, k, x0, y0 }) {
        if ( ink <= 0 ) return;
        const lay = document.createElement("canvas"); lay.width = cv.width; lay.height = cv.height;
        const c = lay.getContext("2d"); c.setTransform(k, 0, 0, k, 1 - x0 * k, 1 - y0 * k);
        const dust = [];
        for ( const [zi, it] of zs.entries() ) {
          const lobes = [];
          let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
          for ( const part of it.z.parts ) {
            const P = pairs(part[0]); P.push(P[0]);
            for ( const [j, [x, y, nx, ny]] of along(P, g * 0.42).entries() ) {
              const h = hash(zi * 131 + j * 7.3), h2 = hash(zi * 17 + j * 3.1);
              // the band swells into cloud heads now and then, and thins between them
              const swell = Math.max(0, Math.sin(j * 0.38 + zi * 1.7)) ** 6;
              const rr = g * (0.14 + 0.04 * h + 0.34 * swell * (0.7 + 0.3 * h2));
              lobes.push([x, y, rr]);
              bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
              for ( let q = 0; q < 3; q++ ) { const hq = hash(zi * 7 + j * 11 + q * 5.7), an = hq * TAU, dd = rr + (2 + 9 * hash(hq * 3)) * u; dust.push([zi, x + Math.cos(an) * dd, y + Math.sin(an) * dd, (0.5 + 1.1 * hash(hq * 9)) * u]); }
            }
          }
          c.save(); c.clip(it.path, "evenodd");
          const blob = (grow, fill) => { c.fillStyle = fill; c.beginPath(); for ( const [x, y, rr] of lobes ) { c.moveTo(x + rr + grow, y); c.arc(x, y, rr + grow, 0, TAU); } c.fill(); };
          c.globalAlpha = Math.min(1, ink);
          blob(1.8 * u, "#5c3a0c");
          const gr = c.createLinearGradient(bx0, by0, bx1, by1);
          [[0, "#d9a83c"], [0.22, "#f6d985"], [0.38, "#dcac44"], [0.6, "#f1cf72"], [0.8, "#cf9c33"], [1, "#eccb6c"]].forEach(([t, col]) => gr.addColorStop(t, col));
          blob(0, gr);
          c.restore();
        }
        // the leaf's square seams, kept to the gold
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = "source-atop"; c.globalAlpha = 0.35;
        c.strokeStyle = "#8a5c14"; c.lineWidth = Math.max(0.6, 0.7 * u * k);
        const s = g * 0.45 * k; c.beginPath();
        for ( let x = 0; x <= lay.width; x += s ) { c.moveTo(x, 0); c.lineTo(x, lay.height); }
        for ( let y = 0; y <= lay.height; y += s ) { c.moveTo(0, y); c.lineTo(lay.width, y); }
        c.stroke();
        // gold dust beyond the band, inside its own zone
        c.globalCompositeOperation = "source-over"; c.globalAlpha = 0.9;
        c.setTransform(k, 0, 0, k, 1 - x0 * k, 1 - y0 * k);
        for ( const [zi, it] of zs.entries() ) {
          c.save(); c.clip(it.path, "evenodd"); c.fillStyle = "#e9c463"; c.beginPath();
          for ( const [di, x, y, r] of dust ) if ( di === zi ) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
          c.fill(); c.restore();
        }
        c0.save(); c0.setTransform(1, 0, 0, 1, 0, 0); c0.globalAlpha = 0.95; c0.drawImage(lay, 0, 0); c0.restore();
      } }
    ],
    lines(D) {
      const { Ln, Z, px, w, a, col } = D, P = Z.core.map(pairs);
      const sm = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
      // a washi edge under the ink so it reads on dark water and on the gold
      Ln.lineStyle({ width: w * 2.3, color: 0xf6ead0, alpha: 0.4 * a, ...R() }); for ( const q of P ) tracePts(Ln, q);
      // sumi strokes: every border painted in long overlapping strokes - the brush lands round, swells, and lifts off into
      // separate bristle trails (kasure); sizes on screen, stroke breaks fixed on the map
      const step = Math.max(D.g * 3.2, 150 * px), bw = w * 1.45;
      for ( const [i, q] of P.entries() ) {
        for ( const [j, piece] of pieces(q, step, 16 * px).entries() ) {
          const seed = i * 13 + j * 5, s0 = spline(pairs(D.wobble(piece.flat(), 0.7 * px, seed, px)), 3), L = lenOf(s0);
          if ( L < 4 * px ) continue;
          const body = sub(s0, 0, L * 0.74), prof = (t) => bw * (0.6 + 0.4 * sm(0, 0.1, t)) * (1 + 0.14 * Math.sin(Math.PI * t)) * (1 - 0.55 * sm(0.72, 1, t));
          // the ink bleeds a little at the edge: a soft wider pass, then the stroke
          for ( const [k, al] of [[1.25, 0.28], [1, 0.95]] ) {
            Ln.lineStyle(0); Ln.beginFill(col, al * a);
            ribbon(Ln, body, (t) => prof(t) * k);
            const [x, y] = s0[0]; Ln.drawCircle(x, y, (prof(0) * k) / 2);
            Ln.endFill();
          }
          // bristle trails: the tail splits into a few thinning lines of different length
          const tail = sub(s0, L * 0.6, L);
          if ( tail.length < 2 ) continue;
          for ( let m = 0; m < 4; m++ ) {
            const off = (m - 1.5) * bw * 0.24, reach = 0.7 + 0.3 * hash(seed * 3 + m), line = sub(offset(tail, off), 0, lenOf(tail) * reach);
            if ( line.length < 2 ) continue;
            Ln.lineStyle(0); Ln.beginFill(col, 0.9 * a);
            ribbon(Ln, line, (t) => bw * 0.26 * (1 - 0.85 * t) * (0.8 + 0.4 * hash(seed + m)));
            Ln.endFill();
          }
        }
      }
      // gilt fittings where the borders meet keep the junctions readable
      for ( const [x, y] of junctions(Z) ) {
        const s2 = 5.5 * px;
        Ln.lineStyle({ width: 1.3 * px, color: 0x4a2e08, alpha: a, join: PIXI.LINE_JOIN.MITER });
        Ln.beginFill(0xe9c25a, a).drawPolygon([x, y - s2, x + s2, y, x, y + s2, x - s2, y]).endFill();
      }
    },
    hoverColor: 0xe9c25a,
    hoverTint: 0xf0c14a
  }
};

/* ---------------------------------------------------------------- badges */

/** A comic caption box, big: yellow (or the distance colour), a black frame and a hard offset shadow, the number in comic lettering. */
function panelBadge(B) {
  const { G, r } = B, n = B.label.length, hw = r * (0.75 + 0.33 * Math.max(1, n)), hh = r * 0.72;
  G.lineStyle(0); G.beginFill(INK, 1).drawPolygon([-hw + r * 0.22, -hh + r * 0.22, hw + r * 0.22, -hh + r * 0.22, hw + r * 0.22, hh + r * 0.22, -hw + r * 0.22, hh + r * 0.22]).endFill();
  G.lineStyle({ width: r * 0.12, color: INK, alpha: 1, join: PIXI.LINE_JOIN.MITER });
  G.beginFill(B.band?.color ?? 0xffe14a, 1).drawPolygon([-hw, -hh, hw, -hh * 1.06, hw * 1.02, hh, -hw * 0.98, hh * 1.04]).endFill();
  B.add(B.label, { fontFamily: "'Bangers', 'Comic', 'Comic Sans MS', Signika, sans-serif", fontWeight: "700", fill: INK, letterSpacing: 1, size: 1.0, dy: 0.02 });
  return 0.95;
}

export const BADGES = {
  counter(B) {
    const { G, r } = B, ring = B.band?.color ?? INK;
    shadow(G, (dy, e) => G.drawCircle(0, dy, r + e));
    G.lineStyle({ width: r * 0.13, color: ring, alpha: 1 }); G.beginFill(B.band ? INK : 0xf3e7c9, 1).drawCircle(0, 0, r).endFill();
    G.lineStyle({ width: r * 0.05, color: B.band ? B.band.color : 0x8a6a3a, alpha: 0.8 }); G.drawCircle(0, 0, r * 0.78);
    B.add(B.label, { fontFamily: "Signika, sans-serif", fontWeight: "700", fill: B.band ? B.band.color : INK });
    return 1;
  },
  pill(B) {
    const { G, r } = B, wid = r * (0.9 + 0.42 * Math.max(1, B.label.length));
    shadow(G, (dy, e) => G.drawRoundedRect(-wid / 2 - e, -r * 0.62 + dy - e, wid + 2 * e, r * 1.24 + 2 * e, r * 0.62 + e), 1.6, 0.25);
    G.lineStyle({ width: r * 0.06, color: B.band?.color ?? 0xffffff, alpha: 0.55 });
    G.beginFill(0x111016, 0.85).drawRoundedRect(-wid / 2, -r * 0.62, wid, r * 1.24, r * 0.62).endFill();
    B.add(B.label, { fontFamily: "Signika, sans-serif", fontWeight: "600", fill: B.band?.color ?? 0xf6f1e6, size: 0.82 });
    return 0.7;
  },
  scribble(B) {
    const { G, r } = B, lead = B.band?.color ?? 0x24242c;
    // a paper scrap under the number, then a scribbled ring drawn one and a bit times round
    G.lineStyle(0); G.beginFill(0xfffdf6, 0.9).drawCircle(0, 0, r * 0.98).endFill();
    const ring = [];
    for ( let i = 0; i <= 40; i++ ) { const t = i / 40, an = -2.2 + t * TAU * 1.12, rr = r * (1.02 + 0.07 * Math.sin(t * 9 + B.id) - 0.06 * t); ring.push([Math.cos(an) * rr, Math.sin(an) * rr * 0.94]); }
    G.lineStyle({ width: r * 0.1, color: lead, alpha: 0.9, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND }); tracePts(G, ring);
    if ( isDigits(B.label) && B.label.length <= 3 ) handDigits(G, B.label, r * (B.label.length > 2 ? 0.72 : B.label.length > 1 ? 0.9 : 1.08), lead, r * 0.12, B.id);
    else B.add(B.label, { fontFamily: "Signika, sans-serif", fontWeight: "600", fill: lead });
    return 1.05;
  },
  disc(B) {
    const { G, r } = B, c = B.band?.color ?? B.tint;
    shadow(G, (dy, e) => G.drawCircle(0, dy, r * 1.08 + e), 2.6, 0.4);
    G.lineStyle({ width: r * 0.2, color: 0xffffff, alpha: 1 }); G.beginFill(c, 1).drawCircle(0, 0, r * 1.02).endFill();
    G.lineStyle({ width: r * 0.06, color: INK, alpha: 0.9 }); G.drawCircle(0, 0, r * 1.14);
    B.add(B.label, { fontFamily: "Signika, sans-serif", fontWeight: "700", fill: 0xffffff, stroke: INK, strokeThickness: Math.round(r * 0.16), lineJoin: "round", size: 1.08 });
    return 1.15;
  },
  panel: panelBadge,
  shield(B) {
    const { G, r } = B, field = B.band?.color ?? B.tint, sh = [-r, -r * 0.98, r, -r * 0.98, r, -r * 0.12, r * 0.82, r * 0.55, 0, r * 1.2, -r * 0.82, r * 0.55, -r, -r * 0.12];
    shadow(G, (dy) => G.drawPolygon(sh.map((v, i) => (i % 2 ? v + dy : v))), 2, 0.35);
    G.lineStyle({ width: r * 0.16, color: 0x3b2414, alpha: 1, join: PIXI.LINE_JOIN.MITER }); G.beginFill(field, 1).drawPolygon(sh).endFill();
    G.lineStyle(0); G.beginFill(0xf1e2bf, 1).drawPolygon([-r * 0.86, -r * 0.84, r * 0.86, -r * 0.84, r * 0.86, -r * 0.36, -r * 0.86, -r * 0.36]).endFill();
    G.lineStyle({ width: r * 0.06, color: 0xd9b45a, alpha: 0.95 }); G.drawPolygon(sh.map((v) => v * 0.8));
    B.add(B.label, { fontFamily: "Amiri, 'Times New Roman', serif", fontWeight: "700", fill: 0xfbf1dc, stroke: 0x3b2414, strokeThickness: Math.round(r * 0.14), lineJoin: "round", size: 0.92, dy: 0.2 });
    return 1.2;
  },
  chip(B) {
    const { G, r } = B, acc = B.band?.color ?? 0xfcee0a, side = B.band?.color ?? B.tint;
    const n = B.label.length, hw = r * (0.95 + 0.38 * Math.max(2, n)), hh = r * 0.72, cut = r * 0.42;
    const plate = [-hw + cut, -hh, hw, -hh, hw, hh - cut, hw - cut, hh, -hw, hh, -hw, -hh + cut];
    shadow(G, (dy) => G.drawPolygon(plate.map((v, i) => (i % 2 ? v + dy : v))), 2.4, 0.5);
    G.lineStyle({ width: r * 0.09, color: acc, alpha: 1, join: PIXI.LINE_JOIN.MITER }); G.beginFill(0x0b0614, 0.94).drawPolygon(plate).endFill();
    // the zone's own neon as a side bar, a barcode tick strip, a corner pip
    G.lineStyle(0); G.beginFill(side, 1).drawPolygon([-hw + r * 0.14, -hh + cut + r * 0.08, -hw + r * 0.36, -hh + cut - r * 0.14, -hw + r * 0.36, hh - r * 0.16, -hw + r * 0.14, hh - r * 0.16]).endFill();
    G.beginFill(acc, 0.85);
    for ( let i = 0, x = -hw + r * 0.62; x < hw - cut - r * 0.1; i++ ) { const bw = r * (0.04 + 0.07 * hash(B.id * 11 + i)); G.drawRect(x, hh - r * 0.27, bw, r * 0.13); x += bw + r * 0.06; }
    G.endFill();
    G.beginFill(acc, 1).drawPolygon([hw - r * 0.08, -hh + r * 0.08, hw - r * 0.08, -hh + r * 0.38, hw - r * 0.38, -hh + r * 0.08]).endFill();
    B.add(B.label, { fontFamily: "'Bruno Ace', 'Bruno Ace SC', Signika, sans-serif", fontWeight: "400", fill: acc, size: 0.95, dx: 0.1, dy: -0.06,
      dropShadow: true, dropShadowColor: acc, dropShadowBlur: 6, dropShadowDistance: 0, dropShadowAlpha: 0.75 });
    return 0.85;
  },
  tag(B) {
    const { G, r } = B, n = B.label.length, hw = r * (0.95 + 0.34 * Math.max(1, n)), hh = r * 0.66, rot = (hash(B.id * 5 + 1) - 0.5) * 0.16;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const rotP = (P) => { const out = []; for ( let i = 0; i < P.length; i += 2 ) out.push(P[i] * cs - P[i + 1] * sn, P[i] * sn + P[i + 1] * cs); return out; };
    const card = rotP([-hw + r * 0.42, -hh, hw, -hh, hw, hh, -hw + r * 0.42, hh, -hw, hh * 0.4, -hw, -hh * 0.4]);
    shadow(G, (dy) => G.drawPolygon(card.map((v, i) => (i % 2 ? v + dy * 1.6 : v + dy * 1.2))), 2.4, 0.6);
    G.lineStyle({ width: r * 0.05, color: 0x000000, alpha: 0.9 }); G.beginFill(0xf4f1ea, 1).drawPolygon(card).endFill();
    // the eyelet, its string, and one red mark: the only colour on the map
    const [ex, ey] = rotP([-hw + r * 0.38, 0]);
    G.lineStyle({ width: r * 0.05, color: 0x000000, alpha: 1 }); G.beginFill(0x1a1a1a, 1).drawCircle(ex, ey, r * 0.13).endFill();
    G.lineStyle({ width: r * 0.05, color: 0xf4f1ea, alpha: 0.85, cap: PIXI.LINE_CAP.ROUND }); G.moveTo(ex, ey); G.bezierCurveTo(ex - r * 0.5, ey - r * 0.2, ex - r * 0.6, ey + r * 0.6, ex - r * 1.05, ey + r * 0.55);
    G.lineStyle(0); G.beginFill(B.band?.color ?? 0xd0121b, 1).drawPolygon(rotP([hw - r * 0.32, -hh, hw, -hh, hw, hh, hw - r * 0.32, hh])).endFill();
    B.add(B.label, { fontFamily: "'Courier New', Courier, monospace", fontWeight: "700", fill: 0x111111, size: 1.3, dx: 0.04, rot });
    return 0.8;
  },
  blossom(B) {
    const { G, r } = B;
    shadow(G, (dy, e) => G.drawCircle(0, dy, r * 1.1 + e), 1.8, 0.22);
    blossom(G, 0, 0, r * 1.22, -Math.PI / 2 + 0.1 * B.id, { petal: B.band?.color ?? 0xffe9f1, edge: 0xd9618d, heart: 0xf7b3cb, stamen: 0xe9a23b });
    G.lineStyle({ width: r * 0.05, color: 0xd9618d, alpha: 0.8 }); G.beginFill(0xfff7fa, 1).drawCircle(0, 0, r * 0.62).endFill();
    B.add(B.label, { fontFamily: "Amiri, Georgia, serif", fontWeight: "700", fill: 0x6b2346, size: 0.82, dy: 0.06 });
    return 1.15;
  },
  banner(B) {
    // a lacquered plaque: black lacquer, a double gold rim, the number large in gold; a small vermilion seal with the brushed numeral
    const { G, r } = B, n = B.label.length, ring = B.band?.color ?? 0xe3b84f;
    const hw = r * (0.78 + 0.26 * Math.max(1, Math.min(3, B.arabic.length))), hh = r * 0.86;
    shadow(G, (dy) => G.drawRoundedRect(-hw, -hh + dy, hw * 2, hh * 2, r * 0.22), 2.4, 0.45);
    G.lineStyle({ width: r * 0.12, color: ring, alpha: 1 }); G.beginFill(0x161210, 0.96).drawRoundedRect(-hw, -hh, hw * 2, hh * 2, r * 0.22).endFill();
    G.lineStyle({ width: r * 0.04, color: ring, alpha: 0.8 }); G.drawRoundedRect(-hw + r * 0.16, -hh + r * 0.16, hw * 2 - r * 0.32, hh * 2 - r * 0.32, r * 0.12);
    const num = B.dist || B.blocked ? B.label : B.arabic;
    B.add(num, { fontFamily: "Amiri, Georgia, serif", fontWeight: "700", fill: B.band?.color ?? 0xf3dc9a, size: num.length > 1 ? 0.95 : 1.1, dy: 0.06 });
    if ( B.kanji && !B.dist && !B.blocked ) {
      const k = [...B.kanji], ss = r * 0.55, sw = ss * 1.25, sh = k.length * ss * 1.1 + ss * 0.25, sx = hw - sw * 0.35, sy = -hh - sh * 0.45;
      G.lineStyle(0); G.beginFill(0xb3261e, 1).drawRoundedRect(sx - sw / 2, sy, sw, sh, ss * 0.12).endFill();
      const kc = new PIXI.Graphics(); brushKanji(kc, B.kanji, ss, 0xfbf1dc); kc.position.set(sx, sy + sh / 2); B.b.addChild(kc);
    }
    return 1;
  }
};
/** How big each badge is drawn (multiples of the base badge radius). */
export const BADGE_SCALE = { counter: 1.2, pill: 1.5, scribble: 1.3, disc: 1.45, panel: 1.35, shield: 1.35, chip: 1.3, tag: 1.35, blossom: 1.35, banner: 1.5 };

/** Make a polyline a little longer at both ends (pencil lines overshoot their corners). */
function extend(P, d) {
  const n = P.length, a = P[0], b = P[1], y = P[n - 1], z = P[n - 2];
  const L1 = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, L2 = Math.hypot(y[0] - z[0], y[1] - z[1]) || 1;
  return [[a[0] + ((a[0] - b[0]) / L1) * d, a[1] + ((a[1] - b[1]) / L1) * d], ...P, [y[0] + ((y[0] - z[0]) / L2) * d, y[1] + ((y[1] - z[1]) / L2) * d]];
}
/** Pencil wander for point lists. */
function wob(P, amp, seed, px) {
  let s = 0;
  return P.map((p, i) => {
    if ( i ) s += Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]);
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, u = s / px;
    const off = amp * (Math.sin(u / 5.1 + seed * 2.1) * 0.6 + Math.sin(u / 1.9 + seed * 5.3) * 0.4);
    return [p[0] - ((b[1] - a[1]) / L) * off, p[1] + ((b[0] - a[0]) / L) * off];
  });
}

