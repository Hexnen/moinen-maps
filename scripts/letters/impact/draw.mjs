/* LETR impact frames: the ink of each frame type, painted on a 2D context (one picture per drawing, painted ahead of time).
   env = { W, H (px), cx, cy (the subject's centre), hx, hy (where the blow lands), R (the subject's radius, px), dir (radians | null),
           mag (0..2), step (0..5, plan.mjs stepOf), kind, tone: { a, b }, sil: { src, sx, sy, sw, sh, w, h, rot } | null,
           local: null | { r }, panel: { r } (a local change of the scene), redOk, makeCanvas, ctx2d }
   Rule of the look: flat colour, hard shapes, and every ink shape carries a keyline of the opposite value, so it reads on any map
   (a dark busy scene as much as a pale one). */
import { INK, PAPER, FRAMES, LIMITS, isRed, safeColor, SAFE_RED, FIG_BRIGHT, FIG_TWIN, isFlash } from "./plan.mjs";
import { rng } from "../rng.mjs";
import * as G from "./shapes.mjs";

const TAU = Math.PI * 2;
const path = (ctx, p) => { ctx.moveTo(p[0], p[1]); for ( let i = 2; i < p.length; i += 2 ) ctx.lineTo(p[i], p[i + 1]); ctx.closePath(); };
function fillPolys(ctx, polys, color, key = null, kw = 0) {
  ctx.beginPath(); for ( const p of polys ) path(ctx, p);
  if ( key && kw > 0 ) { ctx.lineJoin = "round"; ctx.lineWidth = kw * 2; ctx.strokeStyle = key; ctx.stroke(); }
  ctx.fillStyle = color; ctx.fill();
}
function shape(ctx, p, fill, stroke, lw) {
  ctx.beginPath(); path(ctx, p);
  if ( stroke ) { ctx.lineJoin = "miter"; ctx.miterLimit = 3; ctx.lineWidth = lw * 2; ctx.strokeStyle = stroke; ctx.stroke(); }
  if ( fill ) { ctx.fillStyle = fill; ctx.fill(); }
}
function discs(ctx, list, color, grow = 0, dx = 0, dy = 0) {
  ctx.beginPath();
  for ( const [x, y, r] of list ) { ctx.moveTo(x + dx + r + grow, y + dy); ctx.arc(x + dx, y + dy, r + grow, 0, TAU); }
  ctx.fillStyle = color; ctx.fill();
}
const unit = (e) => Math.min(e.W, e.H);
/* how hard the blow is drawn: grows with the strength inside every step too, so a series of blows builds */
const gain = (e) => 0.5 + 0.5 * e.mag;
const stepOfEnv = (e) => (Number.isFinite(e.step) ? e.step : 3);
/* the star of a drawing that is not a full-field frame stays inside a disc of a sixth of the picture, however big the subject (a word, a
   wide blast); the weak steps draw it small, at the rim of the struck figure, so the figure stays in sight */
/* FIN-ENGINE (FXIT-E2, ADVI 16): the floors that keep a drawing legible scale with the SUBJECT's size on screen: a token of 20 px at a far
   zoom gets a star of a few token widths (at least LEGIBLE of the view's short side), not one sized for the viewport that covers its
   neighbours; at an ordinary zoom (a token of ~100 px) the view's floor holds as before. No subject (R 0): the view's floor. */
const LEGIBLE = 0.03;
export const floorOf = (e, k, near) => (e.R > 0 ? Math.min(unit(e) * k, Math.max(e.R * near, unit(e) * LEGIBLE)) : unit(e) * k);
export const burstR = (e) => {
  const st = stepOfEnv(e), cap = Math.sqrt(0.16 * e.W * e.H / Math.PI);
  if ( e.sil && st <= 1 ) return Math.min(Math.max(e.R * 0.5, floorOf(e, 0.04, 1.5)) * gain(e), cap);
  if ( e.sil && st === 2 ) return Math.min(Math.max(e.R * 0.85, floorOf(e, 0.07, 2.5)) * gain(e), cap);
  return Math.min(Math.max(e.R * 1.6, floorOf(e, 0.13, 4)) * gain(e), cap);
};

/* ---------- the struck figure ----------
   The token's picture is read once (our own small software canvas: no read-back of the WebGL board) and turned into:
   - a MASK: the figure's own outline. A picture with a transparent background gives it directly; a ROUND (or square) portrait,
     whose alpha is only a disc, has its background removed by the colour of the ring just inside its rim (flood fill from there),
     so the head and shoulders stand out instead of an inked disc;
   - an ART: the picture inked, hard black and white with ink edges ("bw"), or its negative ("neg").
   Pure helpers (figureMask, inkPixels) work on RGBA arrays; node checks run them on synthetic portraits. */
const lumOf = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
export function figureMask(d, w, h) {
  const n = w * h, mask = new Uint8Array(n);
  let opaque = 0;
  for ( let i = 0; i < n; i++ ) if ( d[i * 4 + 3] > 40 ) { mask[i] = 1; opaque++; }
  if ( !opaque ) return { mask, round: false, kind: "empty" };
  const R = Math.min(w, h) / 2, cx = w / 2, cy = h / 2;
  const at = (x, y) => d[(Math.round(y) * w + Math.round(x)) * 4 + 3] > 40;
  /* the shape of the alpha: a disc (round portrait), the whole square (square portrait) or a figure of its own */
  let ring = 0, ringN = 0, corner = 0;
  for ( let k = 0; k < 64; k++ ) {
    const a = (k / 64) * TAU;
    ringN++; if ( at(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9) ) ring++;
  }
  for ( const [x, y] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]] ) if ( at(x, y) ) corner++;
  const fill = opaque / n;
  const disc = ring / ringN > 0.9 && corner === 0 && fill > Math.PI / 4 * 0.85;
  const square = corner === 4 && fill > 0.92;
  if ( !disc && !square ) return { mask, round: false, kind: "alpha" };
  /* the background: the colours on a ring just inside the rim (upper two thirds: shoulders usually fill the bottom) */
  const rimR = disc ? R * 0.84 : R * 0.96, samples = [];
  for ( let k = 0; k < 96; k++ ) {
    const a = Math.PI * (0.9 + (k / 96) * 1.2) + Math.PI * 0.0;   // from lower left over the top to lower right
    const x = Math.round(cx + Math.cos(a) * rimR), y = Math.round(cy + Math.sin(a) * rimR);
    if ( x < 0 || y < 0 || x >= w || y >= h ) continue;
    const i = (y * w + x) * 4; samples.push([d[i], d[i + 1], d[i + 2], y * w + x]);
  }
  const tol = 58, close = (i, c) => Math.abs(d[i * 4] - c[0]) + Math.abs(d[i * 4 + 1] - c[1]) + Math.abs(d[i * 4 + 2] - c[2]) < tol * 1.6;
  /* flood fill from the rim samples through pixels near ANY rim colour that reached them (gradients follow) */
  const bg = new Uint8Array(n), q = [];
  for ( const s of samples ) if ( mask[s[3]] && !bg[s[3]] ) { bg[s[3]] = 1; q.push(s[3]); }
  /* the rim itself and everything outside it is background too */
  const rimCut = disc ? R * 0.9 : R * 2;
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) { const i = y * w + x; if ( mask[i] && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > rimCut ) bg[i] = 1; }
  while ( q.length ) {
    const i = q.pop(), x = i % w, y = (i - x) / w, ref = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
    for ( const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1] ) {
      if ( j < 0 || bg[j] || !mask[j] ) continue;
      if ( close(j, ref) ) { bg[j] = 1; q.push(j); }
    }
  }
  let fig = 0, inner = 0;
  const out = new Uint8Array(n);
  for ( let i = 0; i < n; i++ ) {
    if ( mask[i] && !bg[i] ) { out[i] = 1; fig++; }
    else if ( mask[i] && bg[i] ) { const x = i % w, y = (i - x) / w; if ( Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rimCut ) inner++; }
  }
  const share = fig / opaque;
  /* a background that could not be told from the figure (a busy painting: the fill did not spread inside the rim): keep the disc,
     the inked art still shows the picture */
  if ( share < 0.1 || share > 0.88 || inner / opaque < 0.12 ) return { mask, round: true, kind: disc ? "disc" : "square", cut: false, share };
  return { mask: out, round: true, kind: disc ? "disc" : "square", cut: true, share };
}
/* the picture inked: ink where it is dark or where an edge runs, paper elsewhere; `neg` swaps them. -> RGBA array */
export function inkPixels(d, w, h, mask, neg = false) {
  const n = w * h, L = new Float32Array(n), out = new Uint8ClampedArray(n * 4);
  const vals = [];
  for ( let i = 0; i < n; i++ ) { L[i] = lumOf(d, i * 4); if ( mask[i] ) vals.push(L[i]); }
  vals.sort((a, b) => a - b);
  const med = vals.length ? vals[vals.length >> 1] : 128;
  const dark = Math.min(med * 0.78, 150);
  const ink = [0x0b, 0x0b, 0x10], paper = [0xff, 0xfd, 0xf2];
  for ( let y = 0; y < h; y++ ) for ( let x = 0; x < w; x++ ) {
    const i = y * w + x;
    if ( !mask[i] ) continue;
    let g = 0;
    if ( x > 0 && y > 0 && x < w - 1 && y < h - 1 ) {
      const gx = L[i + 1 - w] + 2 * L[i + 1] + L[i + 1 + w] - L[i - 1 - w] - 2 * L[i - 1] - L[i - 1 + w];
      const gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1];
      g = Math.hypot(gx, gy);
    }
    /* the outline of the figure itself is inked too */
    const edge = (x > 0 && !mask[i - 1]) || (x < w - 1 && !mask[i + 1]) || (y > 0 && !mask[i - w]) || (y < h - 1 && !mask[i + w]);
    let isInk = L[i] < dark || g > 150 || edge;
    if ( neg ) isInk = !isInk;
    const c = isInk ? ink : paper;
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
  }
  return out;
}
const ctx2d = (e, c) => (e.ctx2d ? e.ctx2d(c) : c.getContext("2d"));
/* FIN-ENGINE: the figure of a token picture (cut-out, inked art, tints) is worked out once per picture and shared by every impact on it
   (before: once per impact; a series of five blows did the cut-out five times) */
const SHARED = new WeakMap();
const sharedOf = (s) => { if ( !s?.src || typeof s.src !== "object" ) return null; let m = SHARED.get(s.src); if ( !m ) { m = new Map(); SHARED.set(s.src, m); } return m; };
const skey = (s, k) => `${s.sx},${s.sy},${s.sw},${s.sh}|${k}`;
/* the figure of this env (cached): { w, h, mask (canvas, alpha = the figure), art: { bw, neg } (canvases) } or a fallback without pixels */
function figureOf(e) {
  const s = e.sil; if ( !s ) return null;
  e._tints ??= new Map();
  if ( e._tints.has("fig") ) return e._tints.get("fig");
  const sh = sharedOf(s), sk = skey(s, "fig");
  if ( sh?.has(sk) ) { const f0 = sh.get(sk); e._tints.set("fig", f0); return f0; }
  const k = Math.min(1, 256 / Math.max(s.sw, s.sh));
  const w = Math.max(2, Math.round(s.sw * k)), h = Math.max(2, Math.round(s.sh * k));
  let fig = { w, h, pixels: false };
  try {
    const c = e.makeCanvas(w, h), x = ctx2d(e, c);
    x.drawImage(s.src, s.sx, s.sy, s.sw, s.sh, 0, 0, w, h);
    const img = typeof x.getImageData === "function" ? x.getImageData(0, 0, w, h) : null;
    if ( img?.data?.length === w * h * 4 ) {
      const m = figureMask(img.data, w, h);
      const put = (rgba) => { const cv = e.makeCanvas(w, h), cx = ctx2d(e, cv), id = cx.createImageData(w, h); id.data.set(rgba); cx.putImageData(id, 0, 0); return cv; };
      const alpha = new Uint8ClampedArray(w * h * 4);
      for ( let i = 0; i < w * h; i++ ) if ( m.mask[i] ) { alpha[i * 4] = alpha[i * 4 + 1] = alpha[i * 4 + 2] = 255; alpha[i * 4 + 3] = 255; }
      fig = { w, h, pixels: true, round: m.round, cut: !!m.cut, mask: put(alpha), art: { bw: put(inkPixels(img.data, w, h, m.mask, false)), neg: put(inkPixels(img.data, w, h, m.mask, true)) } };
      c.width = 0; c.height = 0;
    } else fig.src = c;
  } catch { fig = { w, h, pixels: false }; }
  e._tints.set("fig", fig); sh?.set(sk, fig);
  return fig;
}
function tint(e, color) {
  const s = e.sil; if ( !s ) return null;
  e._tints ??= new Map();
  let c = e._tints.get(color);
  if ( c ) return c;
  const sh = sharedOf(s), sk = skey(s, `tint:${color}`);
  if ( sh?.has(sk) ) { c = sh.get(sk); e._tints.set(color, c); return c; }
  const f = figureOf(e);
  const k = Math.min(1, 256 / Math.max(s.sw, s.sh));
  c = e.makeCanvas(f?.w ?? Math.max(2, Math.round(s.sw * k)), f?.h ?? Math.max(2, Math.round(s.sh * k)));
  const x = ctx2d(e, c);
  try { if ( f?.mask ) x.drawImage(f.mask, 0, 0, c.width, c.height); else x.drawImage(s.src, s.sx, s.sy, s.sw, s.sh, 0, 0, c.width, c.height); } catch { return null; }
  x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  e._tints.set(color, c); sh?.set(sk, c);
  return c;
}
/* the subject's own picture in hard black and white ("bw") or as its negative ("neg"): the struck figure, inked */
function art(e, mode) {
  const s = e.sil; if ( !s ) return null;
  const f = figureOf(e);
  if ( f?.art ) return f.art[mode] ?? null;
  e._tints ??= new Map();
  const key = `art:${mode}`;
  if ( e._tints.has(key) ) return e._tints.get(key);
  let c = null;
  try {
    const k = Math.min(1, 256 / Math.max(s.sw, s.sh));
    c = e.makeCanvas(Math.max(2, Math.round(s.sw * k)), Math.max(2, Math.round(s.sh * k)));
    const x = ctx2d(e, c);
    if ( !("filter" in x) ) c = null;
    else { x.filter = `grayscale(1) brightness(1.15) contrast(4)${mode === "neg" ? " invert(1)" : ""}`; x.drawImage(s.src, s.sx, s.sy, s.sw, s.sh, 0, 0, c.width, c.height); x.filter = "none"; }
  } catch { c = null; }
  e._tints.set(key, c);
  return c;
}
/* how much the silhouette is enlarged in the frames that show it alone (the struck figure fills its share of the frame at any zoom) */
export function blowUp(e) {
  if ( !e.sil ) return 1;
  const want = unit(e) * (0.2 + 0.09 * e.mag), have = Math.max(e.sil.w, e.sil.h);
  return Math.max(1, Math.min(8, want / Math.max(1, have)));
}
function sil(ctx, e, o) {
  if ( o.own && e.sil ) { const r = ownSil(ctx, e, o); if ( r ) return true; }
  const s = e.sil, t = s && tint(e, o.color);
  if ( !t ) return false;
  const k = o.scale ?? 1, w = s.w * k, h = s.h * k;
  ctx.save();
  ctx.translate(o.x ?? e.cx, o.y ?? e.cy);
  if ( o.stretch && e.dir != null ) { ctx.rotate(e.dir); ctx.scale(o.stretch, 1 / Math.sqrt(o.stretch)); ctx.rotate(-e.dir); }
  ctx.rotate(s.rot ?? 0);
  if ( o.blend ) ctx.globalCompositeOperation = o.blend;
  if ( o.alpha != null ) ctx.globalAlpha = o.alpha;
  if ( o.outline ) {
    const ot = tint(e, o.outline), ow = o.outlineW ?? unit(e) * 0.006;
    if ( ot ) for ( let i = 0; i < 12; i++ ) ctx.drawImage(ot, -w / 2 + Math.cos((i / 12) * TAU) * ow, -h / 2 + Math.sin((i / 12) * TAU) * ow, w, h);
  }
  ctx.drawImage(t, -w / 2, -h / 2, w, h);
  const a = o.art ? art(e, o.art) : null;
  if ( a ) ctx.drawImage(a, -w / 2, -h / 2, w, h);
  ctx.restore();
  return true;
}

/* IMPACT4: the enlarged struck figure of the frames that show it alone (shadow, glare, swap) in its OWN art turned (the colour negative on
   the black frame, posterised on the white one, inked on the colour one): the owner's "colour inversion on the token", big, on the two flash
   drawings where the whole picture changes anyway. A round portrait shows its cut-out figure, a square or cut-out token its whole art.
   -> false when the picture cannot be read (the old inked silhouette then) */
function ownSil(ctx, e, o) {
  const s = e.sil, P = figPix(e, s);
  if ( !P.pixels ) return false;
  const disc = !!P.cut && P.kind === "disc";
  let art = o.own === "inv" ? P.inv : o.own === "ink" ? P.ink : (() => { const lit = e.tone.a, k = `own:post:${lit}`; let a = P.post.get(k); if ( !a ) { a = P.put(postPixels(P.d, P.w, P.h, P.alpha, P.cut, hexRgb(safeColor(lit)))); P.post.set(k, a); } return a; })();
  if ( disc ) { const k = `own:cut:${o.own}`; let c = P.held.get(k); if ( !c ) { c = e.makeCanvas(P.w, P.h); const x = ctx2d(e, c), m = cutTint(e, P, "#ffffff"); if ( m ) { x.drawImage(m, 0, 0); x.globalCompositeOperation = "source-in"; } x.drawImage(art, 0, 0); P.held.set(k, c); } art = c; }
  const shape = disc ? tint(e, o.color) : alphaTint(e, s, o.color), ot = disc ? tint(e, o.outline ?? INK) : alphaTint(e, s, o.outline ?? INK);
  const k = o.scale ?? 1, w = s.w * k, h = s.h * k, ow = o.outlineW ?? unit(e) * 0.006;
  ctx.save();
  ctx.translate(o.x ?? e.cx, o.y ?? e.cy);
  ctx.rotate(s.rot ?? 0);
  if ( ot ) for ( let i = 0; i < 12; i++ ) ctx.drawImage(ot, -w / 2 + Math.cos((i / 12) * TAU) * ow, -h / 2 + Math.sin((i / 12) * TAU) * ow, w, h);
  if ( shape ) for ( let i = 0; i < 12; i++ ) ctx.drawImage(shape, -w / 2 + Math.cos((i / 12) * TAU) * ow * 0.45, -h / 2 + Math.sin((i / 12) * TAU) * ow * 0.45, w, h);
  ctx.drawImage(art, -w / 2, -h / 2, w, h);
  ctx.restore();
  return true;
}

/* ---------- IMPACT3 (1.9.20): the figures take part ----------
   The way a hand-animated impact cut reads: the fighters themselves change at the instant of the hit (their colours flip to the
   negative, jump to a flat posterised palette, or stand in their own colours against a negative world), a hard rim of light runs on
   their outline on the side the blow comes from, and the frame shakes and holds while their palette jumps. On a map seen from above
   the fighters are the tokens: every figure (env.figs: the struck token, the attacker, the tokens a caller names in `also`; only those
   this seat may see) is drawn at its own place, size and turn on the screen from its own art, never enlarged, never a box round it.
   Pure pixel helpers (invPixels, postPixels, redSafePixels) work on RGBA arrays; node checks run them. */
const SAFE_RGB = [0xb0, 0x28, 0x40], SAFE_L = 0.299 * SAFE_RGB[0] + 0.587 * SAFE_RGB[1] + 0.114 * SAFE_RGB[2];
/* saturated red (R / (R+G+B) >= 0.7, the guard's rule) becomes the deep crimson SAFE_RED at the pixel's own lightness: a figure's
   negative never shows saturated red (a cyan costume inverts to red), whatever its art */
export function redSafePixels(o) {
  for ( let i = 0; i < o.length; i += 4 ) {
    const r = o[i], g = o[i + 1], b = o[i + 2], s = r + g + b;
    if ( !(o[i + 3] > 0) || s <= 0 || r / s < 0.7 ) continue;
    const k = Math.min(255 / SAFE_RGB[0], (0.299 * r + 0.587 * g + 0.114 * b) / SAFE_L);
    o[i] = Math.round(SAFE_RGB[0] * k); o[i + 1] = Math.round(SAFE_RGB[1] * k); o[i + 2] = Math.round(SAFE_RGB[2] * k);
  }
  return o;
}
/* the art's colour negative (alpha kept) */
export function invPixels(d) {
  const o = new Uint8ClampedArray(d.length);
  for ( let i = 0; i < d.length; i += 4 ) { o[i] = 255 - d[i]; o[i + 1] = 255 - d[i + 1]; o[i + 2] = 255 - d[i + 2]; o[i + 3] = d[i + 3] > 40 ? 255 : 0; }
  return redSafePixels(o);
}
/* the art in its own colours (alpha made hard, red made safe) */
export function origPixels(d) {
  const o = new Uint8ClampedArray(d);
  for ( let i = 3; i < o.length; i += 4 ) o[i] = o[i] > 40 ? 255 : 0;
  return redSafePixels(o);
}
/* the art posterised to three flat tones by its own lightness (ink, the accent, paper; the darkest 38 % ink, the next 34 % accent):
   inside a round portrait the cut-away background goes ink, so the head and shoulders stand out */
export function postPixels(d, w, h, alpha, cut, accent) {
  const n = w * h, o = new Uint8ClampedArray(n * 4), L = new Float32Array(n), vals = [];
  const fig = cut ?? alpha;
  for ( let i = 0; i < n; i++ ) { L[i] = lumOf(d, i * 4); if ( fig[i] ) vals.push(L[i]); }
  vals.sort((a, b) => a - b);
  const q = (p) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] : 128);
  const t1 = q(0.38), t2 = Math.max(t1 + 1, q(0.72));
  const ink = [0x0b, 0x0b, 0x10], paper = [0xff, 0xfd, 0xf2];
  for ( let i = 0; i < n; i++ ) {
    if ( !alpha[i] ) continue;
    const c = !fig[i] ? ink : L[i] < t1 ? ink : L[i] < t2 ? accent : paper;
    o[i * 4] = c[0]; o[i * 4 + 1] = c[1]; o[i * 4 + 2] = c[2]; o[i * 4 + 3] = 255;
  }
  return redSafePixels(o);
}
const hexRgb = (c) => { const m = /^#([0-9a-f]{6})/i.exec(String(c)); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [255, 212, 0]; };

/* ---------- IMPACT4 (1.9.21): colour changes that hold luminance ----------
   WCAG 2.3.1 measures a flash in RELATIVE LUMINANCE (linear sRGB, 0.2126 R + 0.7152 G + 0.0722 B): a change of under a tenth of the maximum
   is no transition at all. So a token's colours may be turned (hue negative, hue cycle, duotone in the accents) on any area, at any zoom,
   on every drawing, as long as every pixel keeps its own luminance: the impact moves ink (hue), not light. Each colour is fitted back to
   the pixel's original luminance exactly (scaled, then mixed with white when a channel would clip), then pushed off saturated red at the
   same luminance (mixed toward the grey of that luminance until R / (R+G+B) < 0.7). The 8-bit rounding leaves under 0.004 of error
   (check-figures measures every pixel). */
const LIN = new Float32Array(256);
for ( let i = 0; i < 256; i++ ) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
/* linear -> 8-bit sRGB, the code whose luminance is NEAREST (a table and the midpoints between codes: no pow per pixel) */
const MIDL = new Float32Array(255); for ( let i = 0; i < 255; i++ ) MIDL[i] = (LIN[i] + LIN[i + 1]) / 2;
const TOS = new Uint8Array(4097); for ( let i = 0, c = 0; i <= 4096; i++ ) { while ( c < 255 && i / 4096 > MIDL[c] ) c++; TOS[i] = c; }
const toS = (v) => { if ( !(v > 0) ) return 0; if ( v >= 1 ) return 255; let c = TOS[Math.round(v * 4096)]; while ( c < 255 && v > MIDL[c] ) c++; while ( c > 0 && v < MIDL[c - 1] ) c--; return c; };
export const relY = (r, g, b) => 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
/* linear rgb -> the same hue and saturation as far as possible, at luminance Y exactly; -> 8-bit [r, g, b], never saturated red */
export function fitY(lr, lg, lb, Y) {
  let r = lr, g = lg, b = lb;
  const yc = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if ( !(yc > 1e-7) ) r = g = b = Y;
  else {
    const k = Y / yc; r *= k; g *= k; b *= k;
    const m = Math.max(r, g, b);
    if ( m > 1 ) { r /= m; g /= m; b /= m; const y1 = Y / m, t = (Y - y1) / Math.max(1e-7, 1 - y1); r += (1 - r) * t; g += (1 - g) * t; b += (1 - b) * t; }
  }
  let o = [toS(r), toS(g), toS(b)];
  for ( let mix = 0.12; mix <= 1.0001 && o[0] / Math.max(1, o[0] + o[1] + o[2]) >= 0.7; mix += 0.12 ) o = [toS(r + (Y - r) * mix), toS(g + (Y - g) * mix), toS(b + (Y - b) * mix)];
  return o;
}
/* rgb (8-bit) -> hsl (0..1) and back */
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if ( d < 1e-6 ) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function rgbOfHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h * 6) % 2) - 1)), m = l - c / 2, k = Math.floor(h * 6) % 6;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
/* the art's colours turned, every pixel at its own luminance. mode "n" = the opposite hue, "h" = turned by `turn` (0..1 of a circle),
   "d" = duotone: the darker half of the figure in accent A, the lighter in accent B (rgb arrays), each at its own luminance. Saturation is
   raised (a dull art still shows the turn); a grey pixel stays grey in n / h. -> RGBA */
export function heldPixels(d, mode, o = {}) {
  const out = new Uint8ClampedArray(d.length), n = d.length / 4;
  let mid = 0.18;
  if ( mode === "d" ) {   // the median luminance of the figure (a histogram of 1024 bins, no sort)
    const hg = new Uint32Array(1025); let cnt = 0;
    for ( let i = 0; i < n; i++ ) if ( d[i * 4 + 3] > 40 ) { hg[Math.round(relY(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) * 1024)]++; cnt++; }
    if ( cnt ) { let acc = 0, k = 0; for ( ; k <= 1024; k++ ) { acc += hg[k]; if ( acc > cnt >> 1 ) break; } mid = Math.min(1024, k) / 1024; }
  }
  const A = o.a ?? [255, 212, 0], B = o.b ?? [25, 168, 255], turn = mode === "n" ? 0.5 : (o.turn ?? 0.33);
  const memo = new Map();   // token art repeats its colours: each colour is turned once
  for ( let i = 0; i < n; i++ ) {
    const j = i * 4, r = d[j], g = d[j + 1], b = d[j + 2];
    if ( !(d[j + 3] > 40) ) continue;
    const key = (r << 16) | (g << 8) | b, hit = memo.get(key);
    if ( hit !== undefined ) { out[j] = hit >>> 16; out[j + 1] = (hit >>> 8) & 255; out[j + 2] = hit & 255; out[j + 3] = 255; continue; }
    const Y = relY(r, g, b);
    let c;
    if ( mode === "d" ) c = Y < mid ? A : B;
    else { const [hh, ss, ll] = hsl(r, g, b); c = ss < 0.04 ? [r, g, b] : rgbOfHsl((hh + turn) % 1, Math.min(1, ss * 1.35 + 0.08), ll); }
    const f = fitY(LIN[Math.round(Math.max(0, Math.min(255, c[0])))], LIN[Math.round(Math.max(0, Math.min(255, c[1])))], LIN[Math.round(Math.max(0, Math.min(255, c[2])))], Y);
    out[j] = f[0]; out[j + 1] = f[1]; out[j + 2] = f[2]; out[j + 3] = 255;
    memo.set(key, (f[0] << 16) | (f[1] << 8) | f[2]);
  }
  return out;
}

/* the pictures of one figure's art (worked out once per picture, shared by every impact on it) */
function figPix(e, s) {
  const sh = sharedOf(s), sk = skey(s, "figpix");
  e._figs ??= new Map();
  if ( e._figs.has(s) ) return e._figs.get(s);
  if ( sh?.has(sk) ) { const v = sh.get(sk); e._figs.set(s, v); return v; }
  const k = Math.min(1, 256 / Math.max(s.sw, s.sh));
  const w = Math.max(2, Math.round(s.sw * k)), h = Math.max(2, Math.round(s.sh * k));
  let P = { w, h, pixels: false, area: 0.8 };
  try {
    const c = e.makeCanvas(w, h), x = ctx2d(e, c);
    x.drawImage(s.src, s.sx, s.sy, s.sw, s.sh, 0, 0, w, h);
    const img = typeof x.getImageData === "function" ? x.getImageData(0, 0, w, h) : null;
    if ( img?.data?.length === w * h * 4 ) {
      const d = img.data, n = w * h, alpha = new Uint8Array(n);
      let on = 0; for ( let i = 0; i < n; i++ ) if ( d[i * 4 + 3] > 40 ) { alpha[i] = 1; on++; }
      const m = figureMask(d, w, h);
      const put = (rgba) => { const cv = e.makeCanvas(w, h), cx = ctx2d(e, cv), id = cx.createImageData(w, h); id.data.set(rgba); cx.putImageData(id, 0, 0); return cv; };
      P = { w, h, pixels: true, area: on / n, d, alpha, cut: m.cut ? m.mask : null, kind: m.kind,
        inv: put(invPixels(d)), orig: put(origPixels(d)), ink: put(inkPixels(d, w, h, alpha, false)), post: new Map(), held: new Map(), proj: new Map(), put };
    }
    c.width = 0; c.height = 0;
  } catch { P = { w, h, pixels: false, area: 0.8 }; }
  e._figs.set(s, P); sh?.set(sk, P);
  return P;
}
/* the held art of a figure (IMPACT4), cached per treatment and parameter */
function heldArt(e, P, t, turn = 0.33) {
  if ( !P.pixels ) return null;
  const A = hexRgb(safeColor(e.tone.a)), B = hexRgb(safeColor(e.tone.b));
  const key = t === "d" ? `d:${A}:${B}` : t === "h" ? `h:${Math.round(turn * 12)}` : "n";
  let c = P.held.get(key);
  if ( !c ) { c = P.put(heldPixels(P.d, t, { a: A, b: B, turn: Math.round(turn * 12) / 12 })); P.held.set(key, c); }
  return c;
}
/* the figure's whole outline (its alpha, not the cut-out) in one flat colour: needs no pixel read */
function alphaTint(e, s, color) {
  const sh = sharedOf(s), sk = skey(s, `atint:${color}`);
  if ( sh?.has(sk) ) return sh.get(sk);
  const k = Math.min(1, 256 / Math.max(s.sw, s.sh));
  const c = e.makeCanvas(Math.max(2, Math.round(s.sw * k)), Math.max(2, Math.round(s.sh * k))), x = ctx2d(e, c);
  try { x.drawImage(s.src, s.sx, s.sy, s.sw, s.sh, 0, 0, c.width, c.height); } catch { return null; }
  x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  sh?.set(sk, c);
  return c;
}
/* IMPACT4: the cut-out figure inside a portrait (a full-square or round token whose background the cut removed) as a flat colour: its
   edge gets the accent too, so a token whose art fills its square still shows WHO is struck, not only a lit square */
function cutTint(e, P, color) {
  if ( !P.cut ) return null;
  const key = `cut:${color}`;
  let c = P.held.get(key);
  if ( !c ) { const rgb = hexRgb(color), a = new Uint8ClampedArray(P.w * P.h * 4); for ( let i = 0; i < P.w * P.h; i++ ) if ( P.cut[i] ) a.set([rgb[0], rgb[1], rgb[2], 255], i * 4); c = P.put(a); P.held.set(key, c); }
  return c;
}
/* the accent that lights the rims (seeded per impact: tone a or b; never saturated red under the guard) */
export const rimColor = (e) => { const c = e.rimTone === "b" ? e.tone.b : e.tone.a; return e.redOk ? c : isRed(c) ? (isRed(e.tone.b) ? PAPER : e.tone.b) : c; };
export const ENLARGED = new Set(["shadow", "glare", "swap"]);
/* how much a figure pops on a drawing with `z` (IMPACT4): the struck figure by z, the others by half as much; a figure small on this screen
   pops more (a token of a few dozen px at a far zoom), at most 2.2 x */
export const popOf = (e, g, z) => {
  if ( !(z > 1) ) return 1;
  const zz = g.role === "target" ? z : 1 + (z - 1) * 0.5, size = Math.max(Math.abs(g.sil.w), Math.abs(g.sil.h)), want = unit(e) * 0.085;
  return Math.min(2.2, zz * Math.max(1, Math.min(1.45, want / Math.max(1, size))));
};
/* which figures and what they show on this drawing, on this seat:
   -> null (no figures' part) | { t, list: [fig], each: [treatment], zs: [pop], slices: [share | 0], area }.
   The guard (IMPACT3 + IMPACT4): on a drawing that is not itself a flash, every change of LUMINANCE the figures make (a bright treatment i
   p k, and a figure popped bigger than its token: the scene round it is covered) is shared out of LIMITS.figArea of the view, the struck
   figure first, then the attacker, then the rest. A figure that does not fit keeps its place size first, then turns to its held twin
   (i -> n, p / k -> d: colours turned, luminance kept, no area taken) and gets a SLICE of the bright one cut along the blow with what area
   is left (a share of its own area, at least 8 %), else none. On a flash drawing (a full-field frame, a scene change that the guard
   counted) the figures take no area: that drawing is already one of the rationed flashes. The gentle variant: rims only, no pop. */
export function figTreat(e, f) {
  if ( !f?.fig || !e.figs?.length ) return null;
  const list = e.figs.filter((g) => g.sil && !(g.role === "target" && ENLARGED.has(f.type)));
  if ( !list.length ) return null;
  const t = e.local ? "r" : f.fig, z = e.local ? 1 : (f.z ?? 1);
  const flash = !e.local && isFlash(f);
  const cap = LIMITS.figArea * e.W * e.H;
  let a = 0;
  const each = [], zs = [], slices = [];
  for ( const g of list ) {
    const base = Math.abs(g.sil.w * g.sil.h) * (g.area ?? figPix(e, g.sil).area), zz = popOf(e, g, z), bright = FIG_BRIGHT.has(t);
    if ( flash ) { each.push(t); zs.push(zz); slices.push(0); continue; }
    const cost = (zz2) => (bright || zz2 > 1 ? base * zz2 * zz2 : 0);
    if ( a + cost(zz) <= cap ) { a += cost(zz); each.push(t); zs.push(zz); slices.push(0); continue; }
    if ( a + cost(1) <= cap ) { a += cost(1); each.push(t); zs.push(1); slices.push(0); continue; }
    const twin = FIG_TWIN[t];
    if ( !twin ) { each.push(t); zs.push(1); slices.push(0); continue; }
    const left = Math.min(base * 0.5, cap - a), share = left >= base * 0.08 ? left / base : 0;
    a += share * base; each.push(twin); zs.push(1); slices.push(share ? +share.toFixed(4) : 0);
  }
  return { t, list, each, zs, slices, area: a, flash };
}
/* the projections of a figure's pixels on a direction (local units), sorted: the slice's cut line for a share of its area */
function cutAt(P, w, h, ang, share) {
  const key = Math.round(((ang % (Math.PI * 2)) + Math.PI * 2) / (Math.PI / 16)) % 32;
  let list = P.proj.get(key);
  if ( !list ) {
    const c = Math.cos((key * Math.PI) / 16), s = Math.sin((key * Math.PI) / 16);
    list = []; for ( let y = 0; y < P.h; y++ ) for ( let x = 0; x < P.w; x++ ) if ( P.alpha[y * P.w + x] ) list.push(((x + 0.5) / P.w - 0.5) * c + ((y + 0.5) / P.h - 0.5) * s);
    list = Float32Array.from(list).sort(); P.proj.set(key, list);
  }
  if ( !list.length ) return null;
  const v = list[Math.max(0, Math.min(list.length - 1, Math.floor(list.length * (1 - share))))];
  return { ang: (key * Math.PI) / 16, at: v };   // the slice = local points whose projection (x / w, y / h, on ang) is above `at`
}
/* one figure: ink line and lit rim round its true outline, then its art in the treatment (IMPACT4: popped by z, a held twin with a slice of
   the bright art, the cut-out figure's own edge lit inside a portrait) */
function drawFig(ctx, e, f, g, t, R, z = 1, slice = 0) {
  const s = g.sil, P = figPix(e, s), u = unit(e);
  const step = Number.isFinite(e.step) ? e.step : 3;
  const w = s.w, h = s.h;
  if ( t !== "r" && !P.pixels ) t = "r";
  /* the rim boils: its width and the angle of its copies change with every drawing (seeded); a small figure keeps a rim that reads */
  const rw = Math.max(2.2, Math.min(u * 0.016, Math.min(w, h) * 0.05 * (1 + 0.16 * step))) * R.f(0.85, 1.15), iw = Math.max(1.4, rw * 0.5);
  const lit = rimColor(e), inkT = alphaTint(e, s, INK), litT = alphaTint(e, s, lit);
  const turn = R.f(0.17, 0.83);   // the hue cycle's angle on this drawing
  ctx.save();
  ctx.translate(g.cx, g.cy);
  /* the pop: bigger at its own place, stretched a little along the blow (the contact of a hand-drawn hit) */
  if ( z > 1 ) { if ( e.dir != null ) { ctx.rotate(e.dir); ctx.scale(z * 1.07, z / 1.07); ctx.rotate(-e.dir); } else ctx.scale(z, z); }
  ctx.rotate(s.rot ?? 0);
  if ( g.flipX || g.flipY ) ctx.scale(g.flipX ? -1 : 1, g.flipY ? -1 : 1);
  /* the side the blow comes from, in the figure's own frame */
  const da = e.dir != null ? e.dir + Math.PI - (s.rot ?? 0) : null;
  const lx = da != null ? Math.cos(da) * (g.flipX ? -1 : 1) : 0, ly = da != null ? Math.sin(da) * (g.flipY ? -1 : 1) : 0;
  const a0 = R.f(0, Math.PI * 2), rz = 1 / z;
  const ring = (img, r, sx = 0, sy = 0, iw0 = w, ih0 = h, n = 12) => { if ( !img ) return; for ( let i = 0; i < n; i++ ) { const a = a0 + (i / n) * Math.PI * 2; ctx.drawImage(img, -iw0 / 2 + Math.cos(a) * r + sx, -ih0 / 2 + Math.sin(a) * r + sy, iw0, ih0); } };
  ring(inkT, (rw + iw) * rz, lx * rw * 0.7 * rz, ly * rw * 0.7 * rz);
  ring(litT, rw * rz, lx * rw * 0.9 * rz, ly * rw * 0.9 * rz);
  const artOf = (tt) => {
    if ( tt === "i" ) return P.inv;
    if ( tt === "k" ) return P.ink;
    if ( tt === "p" ) { let a = P.post.get(lit); if ( !a && P.pixels ) { a = P.put(postPixels(P.d, P.w, P.h, P.alpha, P.cut, hexRgb(safeColor(lit === PAPER ? e.tone.a : lit)))); P.post.set(lit, a); } return a; }
    if ( tt === "n" || tt === "d" || tt === "h" ) return heldArt(e, P, tt, turn);
    return P.pixels ? P.orig : null;
  };
  const art = artOf(t);
  if ( art ) ctx.drawImage(art, -w / 2, -h / 2, w, h);
  else { try { ctx.drawImage(s.src, s.sx, s.sy, s.sw, s.sh, -w / 2, -h / 2, w, h); } catch {} }
  /* the slice: the bright treatment on the struck side of a line along the blow, as much as the area left allows */
  if ( slice > 0 && P.pixels ) {
    const bt = FIG_BRIGHT.has(f.fig) ? f.fig : "i";
    const ang = da != null ? Math.atan2(ly, lx) : R.f(0, Math.PI * 2), cut = cutAt(P, w, h, ang, slice), b = artOf(bt);
    if ( cut && b ) {
      const c = Math.cos(cut.ang), sn = Math.sin(cut.ang), D = Math.hypot(w, h);
      /* the line in local px: points p with (p.x / w) c + (p.y / h) sn = at; the slice is beyond it */
      const n0 = [c / w, sn / h], nl = Math.hypot(n0[0], n0[1]), nx = n0[0] / nl, ny = n0[1] / nl, d0 = cut.at / nl;
      const ox = nx * d0, oy = ny * d0, tx = -ny, ty = nx;
      ctx.save(); ctx.beginPath();
      ctx.moveTo(ox + tx * D, oy + ty * D); ctx.lineTo(ox - tx * D, oy - ty * D); ctx.lineTo(ox - tx * D + nx * D, oy - ty * D + ny * D); ctx.lineTo(ox + tx * D + nx * D, oy + ty * D + ny * D); ctx.closePath();
      ctx.clip(); ctx.drawImage(b, -w / 2, -h / 2, w, h); ctx.restore();
      /* the cut line itself: paper with an ink edge, inside the figure */
      ctx.save(); ctx.globalCompositeOperation = "source-atop"; ctx.lineCap = "butt";
      ctx.beginPath(); ctx.moveTo(ox + tx * D, oy + ty * D); ctx.lineTo(ox - tx * D, oy - ty * D);
      ctx.lineWidth = Math.max(2, rw * 0.9) * rz; ctx.strokeStyle = INK; ctx.stroke(); ctx.lineWidth = Math.max(1, rw * 0.4) * rz; ctx.strokeStyle = PAPER; ctx.stroke();
      ctx.restore();
    }
  }
  /* a portrait's own figure (the cut-out) gets an ink and accent edge inside the token: its edge is lit, not only the token's square */
  if ( P.cut && t !== "r" && t !== "p" ) {
    const ci = cutTint(e, P, INK), cl = cutTint(e, P, lit), ew = Math.max(1.2, rw * 0.45) * rz;
    if ( ci && cl ) { ctx.save(); ring(ci, ew * 1.9, 0, 0, w, h, 8); ring(cl, ew, lx * ew * 0.6, ly * ew * 0.6, w, h, 8); ctx.restore();
      const a2 = t === "o" ? P.orig : art; if ( a2 ) { ctx.save(); ctx.globalCompositeOperation = "source-over"; const m = cutTint(e, P, "#ffffff");
        /* the figure itself over its edge again: drawn through its own cut (a copy of the art masked by the cut) */
        const key = `cutart:${t}:${t === "h" ? Math.round(turn * 12) : ""}:${lit}`; let ca = P.held.get(key);
        if ( !ca && m ) { ca = e.makeCanvas(P.w, P.h); const x = ctx2d(e, ca); x.drawImage(m, 0, 0); x.globalCompositeOperation = "source-in"; x.drawImage(a2, 0, 0, P.w, P.h); P.held.set(key, ca); }
        if ( ca ) ctx.drawImage(ca, -w / 2, -h / 2, w, h); ctx.restore(); } }
  }
  ctx.restore();
}
/* the figures' part of a drawing (painted last, over the drawing's own ink). With e.figLayers (the player) the figures are not painted here
   but each on its own small canvas that follows its token (paintFigLayers) */
function paintFigs(ctx, e, f) {
  if ( e.figLayers ) return;
  const tr = figTreat(e, f);
  if ( !tr ) return;
  const R = rng((f.seed ^ 0x5bd1e995) >>> 0);
  tr.list.forEach((g, i) => drawFig(ctx, e, f, g, tr.each[i], R, tr.zs[i], tr.slices[i]));
}
/* IMPACT4: the figures of a drawing each on its own canvas, so the player can move it with its token (a knock-back, a fall, a shake the
   token's own reaction plays during the impact). -> [{ g, canvas, x, y, size (css px) }]; the same seeded draws as paintFigs */
export function paintFigLayers(e, f, q = 1) {
  const tr = figTreat(e, f);
  if ( !tr ) return [];
  const R = rng((f.seed ^ 0x5bd1e995) >>> 0), u = unit(e), out = [];
  tr.list.forEach((g, i) => {
    if ( e.local && Math.hypot(g.cx - e.cx, g.cy - e.cy) > e.local.r ) { drawFig(skipCtx, e, f, g, tr.each[i], R, 1, 0); return; }   // outside the gentle panel: nothing (the draws keep the seeded order)
    const zz = tr.zs[i], size = Math.ceil(Math.hypot(g.sil.w, g.sil.h) * zz * 1.12 + u * 0.08 + 8);
    const c = e.makeCanvas(Math.max(2, Math.round(size * q)), Math.max(2, Math.round(size * q))), x = ctx2d(e, c);
    x.setTransform?.(q, 0, 0, q, 0, 0);
    drawFig(x, e, f, { ...g, cx: size / 2, cy: size / 2 }, tr.each[i], R, zz, tr.slices[i]);
    out.push({ g, canvas: c, x: g.cx - size / 2, y: g.cy - size / 2, size });
  });
  return out;
}
/* a context that draws nothing (keeps the seeded order of a figure that is not shown) */
const skipCtx = new Proxy({}, { get: () => () => {} });
/* the outline of a figure as a ring (for the knock-back echoes), cached per figure, colour and width */
function ringOf(e, s, color, wpx) {
  const key = `ring:${color}:${wpx.toFixed(1)}:${s.w.toFixed(0)}x${s.h.toFixed(0)}`, sh = sharedOf(s), sk = skey(s, key);
  if ( sh?.has(sk) ) return sh.get(sk);
  const m = Math.ceil(wpx + 2), c = e.makeCanvas(Math.max(2, Math.round(s.w + 2 * m)), Math.max(2, Math.round(s.h + 2 * m))), x = ctx2d(e, c);
  const tint = alphaTint(e, s, color); if ( !tint ) return null;
  for ( let i = 0; i < 10; i++ ) { const a = (i / 10) * Math.PI * 2; x.drawImage(tint, m + Math.cos(a) * wpx, m + Math.sin(a) * wpx, s.w, s.h); }
  x.globalCompositeOperation = "destination-out"; x.drawImage(tint, m, m, s.w, s.h);
  const out = { c, m }; sh?.set(sk, out);
  return out;
}

/* ---------- parts shared by several frames ---------- */
/* speed lines along the blow, or focus lines to the subject. Every ink line has a paper keyline and every paper line an ink one, so
   they read on a dark busy scene as on a pale one */
function lines(ctx, e, seed, o = {}) {
  const u = unit(e), D = Math.hypot(e.W, e.H), kw = u * 0.0022;
  const cx = o.cx ?? e.cx, cy = o.cy ?? e.cy;
  const col = o.color ?? INK, key = o.key ?? (col === INK ? PAPER : INK);
  const sec = o.second === null ? null : (o.second ?? PAPER), skey = sec === INK ? PAPER : INK;
  if ( e.dir != null && !o.radial ) {
    const gap = Math.max(e.R * 1.3, u * 0.08) * (o.gap ?? 1);
    fillPolys(ctx, G.speedLines(seed, { cx, cy, ang: e.dir, W: e.W, H: e.H, n: Math.round((o.n ?? 40) * 0.8), gap, fat: (o.fat ?? 1) * 1.35 }), col, key, kw);
    if ( sec ) fillPolys(ctx, G.speedLines(seed + 7, { cx, cy, ang: e.dir, W: e.W, H: e.H, n: Math.round((o.n ?? 40) * 0.4), gap: gap * 1.2, fat: (o.fat ?? 1) * 0.9 }), sec, skey, kw * 0.8);
  } else {
    const rIn = Math.max(e.R * 1.7, u * 0.2) * (o.gap ?? 1);
    fillPolys(ctx, G.focusLines(seed, { cx, cy, rIn, rOut: D * 1.05, n: o.n ?? 60, fat: (o.fat ?? 1) * 1.25 }), col, key, kw);
    if ( sec ) fillPolys(ctx, G.focusLines(seed + 7, { cx, cy, rIn: rIn * 1.15, rOut: D * 1.05, n: Math.round((o.n ?? 60) * 0.45), fat: (o.fat ?? 1) * 0.75 }), sec, skey, kw * 0.8);
  }
}
function burst(ctx, e, seed, o = {}) {
  const u = unit(e), r = (o.r ?? burstR(e));
  const p = G.star(seed, { cx: o.cx ?? e.hx, cy: o.cy ?? e.hy, r, spikes: o.spikes ?? 15, inner: o.inner ?? 0.52, jitter: 0.24, stretch: e.dir != null ? (o.stretch ?? 1.25) : 1, ang: e.dir ?? 0, long: o.long ?? 3 });
  const lw = o.lw ?? Math.max(1.2, Math.min(u * 0.006, r * 0.06));
  if ( o.key ) shape(ctx, p, null, o.key, lw + Math.min(u * 0.011, r * 0.1));
  shape(ctx, p, o.fill ?? PAPER, o.stroke ?? INK, lw);
  if ( o.core ) {
    const q = G.star(seed + 3, { cx: o.cx ?? e.hx, cy: o.cy ?? e.hy, r: r * 0.58, spikes: (o.spikes ?? 15) - 3, inner: 0.55, jitter: 0.2, stretch: e.dir != null ? (o.stretch ?? 1.25) : 1, ang: e.dir ?? 0, long: 1 });
    shape(ctx, q, o.core, null, 0);
  }
  return p;
}
function splash(ctx, e, seed, o = {}) {
  const u = unit(e);
  const s = G.splat(seed, { cx: o.cx ?? e.hx, cy: o.cy ?? e.hy, r: o.r ?? burstR(e) * 1.5, n: o.n ?? 24, ang: e.dir, spread: 0.8 });
  const key = o.key ?? PAPER, kw = u * 0.004;
  discs(ctx, s.blobs, key, kw);
  ctx.beginPath(); for ( const p of s.drops ) path(ctx, p); ctx.lineJoin = "round"; ctx.lineWidth = kw * 2; ctx.strokeStyle = key; ctx.stroke();
  discs(ctx, s.blobs, o.color ?? INK);
  fillPolys(ctx, s.drops, o.color ?? INK);
}
/* the halftone never fills the frame: its outer radius stays inside a disc of a quarter of the picture (a big subject, e.g. a word, would otherwise
   turn the whole frame into the accent colour: a full-field frame the guard does not count) */
export const dotsReach = (e, want) => Math.min(want, Math.sqrt(0.25 * e.W * e.H / Math.PI));
function halftone(ctx, e, seed, o = {}) {
  const u = unit(e);
  const r1 = o.whole ? o.r1 : dotsReach(e, o.r1 ?? burstR(e) * 3.2), r0 = o.whole ? o.r0 : Math.min(o.r0 ?? e.R * 0.9, r1 * 0.45);   // whole: only the (rationed) swap frame
  const d = G.dots(seed, { cx: o.cx ?? e.cx, cy: o.cy ?? e.cy, r0, r1, pitch: o.pitch ?? Math.max(9, u * 0.021), ang: o.all ? null : e.dir, fan: o.fan ?? 1.15 });
  if ( o.under !== null ) discs(ctx, d, o.under ?? INK, 0, u * 0.004, u * 0.004);
  discs(ctx, d, o.color ?? e.tone.a);
}
/* a shock ring: a thick broken band in the accent with ink keylines, chunks thrown off its rim and short ticks running outward */
function ringsOf(ctx, e, seed, o = {}) {
  const u = unit(e), cx = o.cx ?? e.cx, cy = o.cy ?? e.cy, flat = o.flat ?? 1;
  const r = Math.min(o.r ?? burstR(e) * 1.9, Math.sqrt(0.25 * e.W * e.H / Math.PI));
  const list = G.rings(seed, { r, w: o.w ?? u * 0.026 * gain(e), n: o.n ?? 2 });
  const arc = (extra, color) => { ctx.strokeStyle = color; ctx.lineCap = "butt"; for ( const a of list ) { ctx.beginPath(); ctx.lineWidth = Math.max(1, a.w + extra); ctx.ellipse(cx, cy, a.r, a.r * flat, 0, a.a0, a.a1); ctx.stroke(); } };
  arc(u * 0.014, INK); arc(u * 0.005, PAPER); arc(0, o.color ?? e.tone.a);
  const ch = G.chunks(seed + 5, { cx, cy, r: r * 1.08, flat, n: Math.round(10 + 8 * gain(e)), size: u * 0.012 * gain(e) });
  for ( const p of ch.chunks ) shape(ctx, p, INK, PAPER, u * 0.0025);
  fillPolys(ctx, ch.ticks, INK, PAPER, u * 0.002);
}
/* the big burst of a frame-filling drawing: under the guard a saturated red accent moves to the small core, the wide star takes the second colour */
export const bigTone = (e) => (!e.redOk && isRed(e.tone.a) && !isRed(e.tone.b) ? [e.tone.b, e.tone.a] : [e.tone.a, e.tone.b]);
const fieldColor = (e, c) => (!e.redOk && isRed(c) ? (isRed(e.tone.b) ? PAPER : e.tone.b) : c);

/* ---------- the frame types ---------- */
const PAINT = {
  pop(ctx, e, f) {
    const rb = burstR(e), u = unit(e);
    burst(ctx, e, f.seed, { fill: e.tone.a, core: PAPER, key: PAPER });
    fillPolys(ctx, G.focusLines(f.seed + 1, { cx: e.hx, cy: e.hy, rIn: rb * 1.25, rOut: rb * 2.1, n: 18, fat: 0.8 }), INK, PAPER, u * 0.002);
  },
  splat(ctx, e, f) {
    splash(ctx, e, f.seed);
    burst(ctx, e, f.seed + 2, { r: burstR(e) * 0.5, fill: e.tone.a, long: 1 });
  },
  lines(ctx, e, f) { lines(ctx, e, f.seed, { n: 84, fat: 0.8 }); },
  /* the scene in a jagged panel round the blow goes hard black and white (back "bw", clipped by backClip); ink lines inside it and a
     heavy keyline round it: a comic insert panel, local, counted by the guard */
  ink(ctx, e, f) {
    const p = panelPoly(e, f), u = unit(e);
    ctx.save(); ctx.beginPath(); path(ctx, p); ctx.clip();
    lines(ctx, e, f.seed, { n: 40, fat: 1, cx: e.hx, cy: e.hy });
    ctx.restore();
    ctx.beginPath(); path(ctx, p); ctx.lineJoin = "miter"; ctx.miterLimit = 3;
    ctx.lineWidth = u * 0.012; ctx.strokeStyle = PAPER; ctx.stroke();
    ctx.lineWidth = u * 0.006; ctx.strokeStyle = INK; ctx.stroke();
    burst(ctx, e, f.seed + 2, { r: burstR(e) * 0.8, fill: PAPER, key: PAPER, core: e.tone.a });
  },
  slam(ctx, e, f) {
    lines(ctx, e, f.seed, { n: 50, fat: 1.1, color: INK, second: PAPER });
    burst(ctx, e, f.seed + 2, { r: burstR(e) * (e.sil ? 0.55 : 0.9), fill: INK, stroke: PAPER, long: 4 });   // the scene's own negative is the picture: no silhouette over it
  },
  shadow(ctx, e, f) {
    ctx.fillStyle = INK; ctx.fillRect(0, 0, e.W, e.H);
    const k = blowUp(e), u = unit(e);
    const [big, small] = bigTone(e);
    lines(ctx, e, f.seed, { n: 30, fat: 0.7, color: small, key: INK, second: null, radial: true, gap: 1.5 * Math.max(1, k * 0.6) });
    const r = Math.max(burstR(e) * 2.1, (e.sil ? Math.max(e.sil.w, e.sil.h) * k * 0.78 : 0));
    burst(ctx, e, f.seed + 1, { cx: e.cx, cy: e.cy, r, fill: big, stroke: PAPER, lw: u * 0.005, core: e.sil ? small : PAPER, spikes: 19, long: 5, stretch: 1.4 });
    sil(ctx, e, { color: PAPER, outline: INK, outlineW: u * 0.008, scale: k, art: "bw", own: "inv" });
  },
  glare(ctx, e, f) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, e.W, e.H);
    const k = blowUp(e), u = unit(e);
    lines(ctx, e, f.seed, { n: 78, fat: 1.8, color: INK, key: PAPER, second: null, gap: Math.max(1, k * 0.7) });
    if ( !sil(ctx, e, { color: INK, outline: e.tone.a, outlineW: u * 0.007, scale: k, art: "neg", own: "post" }) ) burst(ctx, e, f.seed + 1, { cx: e.cx, cy: e.cy, r: burstR(e) * 1.2, fill: INK, stroke: e.tone.a, long: 4 });
    burst(ctx, e, f.seed + 2, { r: burstR(e) * 0.5, fill: e.tone.a, long: 2 });
  },
  swap(ctx, e, f) {
    const k = blowUp(e), u = unit(e), bg = fieldColor(e, e.tone.a);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, e.W, e.H);
    halftone(ctx, e, f.seed, { color: INK, under: null, all: e.dir == null, whole: true, r0: 0, r1: Math.hypot(e.W, e.H) * 0.62, pitch: Math.max(12, u * 0.03), fan: 1.25 });
    lines(ctx, e, f.seed + 1, { n: 34, fat: 1.1, color: PAPER, key: INK, second: null, gap: Math.max(1, k * 0.7) });
    if ( !sil(ctx, e, { color: INK, outline: PAPER, outlineW: u * 0.008, scale: k, art: "neg", own: "ink" }) ) burst(ctx, e, f.seed + 2, { cx: e.cx, cy: e.cy, r: burstR(e) * 1.3, fill: INK, stroke: PAPER, long: 4 });
  },
  window(ctx, e, f) {
    const u = unit(e), r = Math.max(burstR(e) * 2.3, u * 0.3);
    ctx.fillStyle = INK; ctx.fillRect(0, 0, e.W, e.H);
    const p = G.star(f.seed, { cx: e.cx, cy: e.cy, r, spikes: 17, inner: 0.6, jitter: 0.25, stretch: e.dir != null ? 1.3 : 1, ang: e.dir ?? 0, long: 4 });
    ctx.save(); ctx.globalCompositeOperation = "destination-out"; ctx.beginPath(); path(ctx, p); ctx.fill(); ctx.restore();
    ctx.beginPath(); path(ctx, p); ctx.lineJoin = "miter"; ctx.miterLimit = 3;
    ctx.lineWidth = u * 0.022; ctx.strokeStyle = e.tone.a; ctx.stroke();
    ctx.lineWidth = u * 0.007; ctx.strokeStyle = PAPER; ctx.stroke();
  },
  /* the figure dragged back along the blow: a swept streak (many close copies make ONE continuous shape, not bars) in two colours with
     an ink keyline, torn by thin dry-brush gaps, the figure itself on its front end */
  smear(ctx, e, f) {
    const u = unit(e), g = gain(e);
    const a = e.dir ?? (((f.seed % 360) * Math.PI) / 180);
    const len = Math.max(e.R * 2.2, u * 0.07) * g;
    const back = (k) => ({ x: e.cx - Math.cos(a) * len * k, y: e.cy - Math.sin(a) * len * k });
    const N = 14;
    if ( e.sil ) {
      const sweep = (color, from, to, grow) => { for ( let i = N; i >= 0; i-- ) { const t = from + (to - from) * (i / N), p = back(t); sil(ctx, e, { color, x: p.x, y: p.y, scale: 1 + grow * (1 - t) }); } };
      const kw = u * 0.006;
      ctx.save();
      for ( const [dx, dy] of [[kw, 0], [-kw, 0], [0, kw], [0, -kw]] ) { ctx.save(); ctx.translate(dx, dy); sweep(INK, 1, 0, 0.04); ctx.restore(); }
      ctx.restore();
      sweep(e.tone.b, 1, 0.35, 0.04);
      sweep(e.tone.a, 0.55, 0.05, 0.04);
      /* dry-brush gaps along the streak */
      const gaps = G.speedLines(f.seed + 3, { cx: back(0.55).x, cy: back(0.55).y, ang: a, W: len * 1.1, H: e.R * 2.4, n: 9, gap: 0, fat: 0.45 });
      ctx.save(); ctx.globalCompositeOperation = "destination-out"; fillPolys(ctx, gaps, "#000"); ctx.restore();
      sil(ctx, e, { color: PAPER, outline: INK, outlineW: u * 0.005, art: "bw" });
    } else {
      /* no picture: a tapered streak of ink with an accent core */
      const w = Math.max(e.R, u * 0.03) * g, s = G.streak(f.seed, { x0: back(1).x, y0: back(1).y, x1: e.cx, y1: e.cy, w });
      shape(ctx, s.outer, e.tone.b, INK, u * 0.004); shape(ctx, s.inner, e.tone.a, null, 0);
    }
    lines(ctx, e, f.seed, { n: 18, fat: 0.9, gap: 0.8 });
  },
  tear(ctx, e, f) { PAINT.rip(ctx, e, f); },
  rip(ctx, e, f) {
    const u = unit(e), t = G.tear(f.seed, { cx: e.hx, cy: e.hy, ang: tearAngle(e, f), W: e.W, H: e.H, w: u * 0.04 * gain(e) });
    shape(ctx, t.band, PAPER, INK, u * 0.008);
    splash(ctx, e, f.seed + 1, { r: burstR(e) * 1.2, n: 16 });
  },
  dots(ctx, e, f) {
    halftone(ctx, e, f.seed, { all: e.dir == null });
    burst(ctx, e, f.seed + 2, { r: burstR(e) * 0.9, fill: e.tone.b, core: PAPER, key: PAPER });
  },
  shatter(ctx, e, f) {
    const u = unit(e), c = G.cracks(f.seed, { cx: e.hx, cy: e.hy, r: floorOf(e, 0.5, 9) * gain(e), w: Math.min(u * 0.022, Math.max(e.R > 0 ? e.R * 0.4 : u, u * 0.008)) * gain(e), n: 10 });
    for ( const p of c.cracks ) shape(ctx, p, PAPER, INK, u * 0.004);
    for ( const p of c.shards ) shape(ctx, p, INK, PAPER, u * 0.004);
    burst(ctx, e, f.seed + 2, { r: burstR(e) * 0.7, fill: e.tone.a, core: PAPER });
  },
  chroma(ctx, e, f) {
    const u = unit(e), d = u * 0.012 * gain(e), a = e.dir ?? 0;
    if ( e.sil && e.chromaBack === false ) {   // only when the scene itself cannot be split (no SVG backdrop filter)
      sil(ctx, e, { color: e.redOk ? "#ff2a4a" : "#c83a34",   /* ENGPINK 1.9.22: a red under the guard line, not pink (was #d0306a) */ x: e.cx - Math.cos(a) * d * 1.6, y: e.cy - Math.sin(a) * d * 1.6, blend: "screen", alpha: 0.85 });
      sil(ctx, e, { color: "#19e0ff", x: e.cx + Math.cos(a) * d * 1.6, y: e.cy + Math.sin(a) * d * 1.6, blend: "screen", alpha: 0.85 });
    }
    lines(ctx, e, f.seed, { n: 30, fat: 0.35, color: PAPER, second: null, gap: 1.3 });
  },
  ring(ctx, e, f) {
    const flat = e.kind === "landing" ? 0.62 : 1;
    ringsOf(ctx, e, f.seed, { flat });
    halftone(ctx, e, f.seed + 1, { all: true, r0: burstR(e) * 2.2, r1: burstR(e) * 3, color: e.tone.b });
  },
  /* what is left when the blow is over: the star's afterimage as a hollow outline, puffs of dust thrown along the blow, specks */
  fade(ctx, e, f) {
    const rb = burstR(e), u = unit(e);
    const star = G.star(f.seed + 4, { cx: e.hx, cy: e.hy, r: rb * 1.2, spikes: 13, inner: 0.6, jitter: 0.22, stretch: e.dir != null ? 1.2 : 1, ang: e.dir ?? 0, long: 2 });
    ctx.beginPath(); path(ctx, star); ctx.lineJoin = "miter"; ctx.miterLimit = 3;
    ctx.lineWidth = Math.max(2, u * 0.007); ctx.strokeStyle = PAPER; ctx.stroke();
    ctx.lineWidth = Math.max(1, u * 0.003); ctx.strokeStyle = INK; ctx.stroke();
    const pf = G.puffs(f.seed + 2, { cx: e.hx, cy: e.hy, r: rb * 1.9, ang: e.dir, n: 7, size: rb * 0.26 });
    discs(ctx, pf.flat(), INK, Math.max(1.2, u * 0.003)); discs(ctx, pf.flat(), PAPER);
    fillPolys(ctx, G.focusLines(f.seed, { cx: e.hx, cy: e.hy, rIn: rb * 1.6, rOut: rb * 3, n: 10, fat: 0.25, thin: true }), INK, PAPER, u * 0.0015);
    const s = G.splat(f.seed + 1, { cx: e.hx, cy: e.hy, r: rb * 2.4, n: 9, ang: e.dir, spread: 1.1 });
    const small = s.blobs.slice(0, -2).map(([x, y, r]) => [x, y, r * 0.5]);
    discs(ctx, small, PAPER, u * 0.003); discs(ctx, small, e.tone.a);
  },
  rest() { /* a beat of nothing (the still drawing of reduced motion waits for the blow's instant) */ },
  /* IMPACT3: the held drawing of the hit: the figures (painted after, by paintFigs) with the struck one's knock-back echoes behind it
     along the blow and flares thrown off the point of contact; the scene untouched */
  fig(ctx, e, f) {
    const u = unit(e), g = gain(e), R = rng(f.seed);
    const tgt = e.figs?.find((x) => x.role === "target" && x.sil);
    const tr = figTreat(e, f);
    /* knock-back echoes: the struck figure's outline twice behind it along the blow, fading (thin outlines in the accent and in ink;
       not in the gentle panel) */
    if ( tgt && e.dir != null && tr && !e.local ) {
      const s = tgt.sil, wpx = Math.max(1.5, Math.min(s.w, s.h) * 0.03), d = Math.max(s.w, s.h) * 0.28 * g;
      const ra = ringOf(e, s, rimColor(e), wpx), rk = ringOf(e, s, INK, wpx * 1.8);
      for ( const [k, al] of [[2, 0.45], [1, 0.8]] ) {
        const x = tgt.cx + Math.cos(e.dir) * d * k, y = tgt.cy + Math.sin(e.dir) * d * k;
        ctx.save(); ctx.globalAlpha = al; ctx.translate(x, y); ctx.rotate(s.rot ?? 0);
        if ( rk ) ctx.drawImage(rk.c, -s.w / 2 - rk.m, -s.h / 2 - rk.m);
        if ( ra ) ctx.drawImage(ra.c, -s.w / 2 - ra.m, -s.h / 2 - ra.m);
        ctx.restore();
      }
    }
    /* flares: wedges thrown off the point of contact, outward from the figure (ink with a paper keyline, an accent core) */
    const R0 = Math.max(e.R, u * 0.03);
    const out = Math.hypot(e.hx - e.cx, e.hy - e.cy) > 1 ? Math.atan2(e.hy - e.cy, e.hx - e.cx) : e.dir != null ? e.dir + Math.PI : R.f(0, Math.PI * 2);
    const n = 6 + Math.min(6, Math.round((Number.isFinite(e.step) ? e.step : 3) * 1.2));
    const ink = [], acc = [];
    for ( let i = 0; i < n; i++ ) {
      const a = out + R.f(-1.25, 1.25), len = R0 * R.f(0.7, 1.9) * g, wd = R0 * R.f(0.06, 0.14);
      const x0 = e.hx + Math.cos(a) * R0 * 0.1, y0 = e.hy + Math.sin(a) * R0 * 0.1, px = -Math.sin(a), py = Math.cos(a);
      const tri = [x0 + px * wd, y0 + py * wd, x0 - px * wd, y0 - py * wd, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len];
      ink.push(tri);
      if ( i % 2 === 0 ) acc.push([x0 + px * wd * 0.45, y0 + py * wd * 0.45, x0 - px * wd * 0.45, y0 - py * wd * 0.45, x0 + Math.cos(a) * len * 0.62, y0 + Math.sin(a) * len * 0.62]);
    }
    fillPolys(ctx, ink, INK, PAPER, u * 0.0028);
    fillPolys(ctx, acc, rimColor(e));
    burst(ctx, e, f.seed + 2, { r: burstR(e) * 0.42, fill: PAPER, stroke: INK, spikes: 11, long: 2 });
  },
  /* the cracks and shards of `shatter` with the scene left alone (a later drawing of a hit, after the flashes are spent) */
  cracks(ctx, e, f) {
    const u = unit(e), c = G.cracks(f.seed, { cx: e.hx, cy: e.hy, r: floorOf(e, 0.5, 9) * gain(e), w: Math.min(u * 0.022, Math.max(e.R > 0 ? e.R * 0.4 : u, u * 0.008)) * gain(e), n: 10 });
    for ( const p of c.cracks ) shape(ctx, p, PAPER, INK, u * 0.004);
    for ( const p of c.shards ) shape(ctx, p, INK, PAPER, u * 0.004);
  }
};
const tearAngle = (e, f) => e.dir ?? ((f.seed % 180) * Math.PI) / 180;

/* the gentle variant's panel: a jagged star of at most LIMITS.localArea of the viewport round the subject */
export const panelOf = (e, f) => G.star(f.seed + 11, { cx: e.cx, cy: e.cy, r: e.local.r, spikes: 14, inner: 0.72, jitter: 0.12, stretch: 1, ang: 0, long: 0 });
/* the panel of a drawing that changes the scene only round the blow (`local` frames: ink, shatter): never more than localArea */
export const localPanelR = (e) => Math.min(Math.sqrt((LIMITS.localArea * e.W * e.H) / Math.PI), Math.max(e.R * 2.4, floorOf(e, 0.17, 5)) * gain(e));
export const panelPoly = (e, f) => (e.local ? panelOf(e, f) : G.star(f.seed + 13, { cx: e.cx, cy: e.cy, r: localPanelR(e), spikes: 13, inner: 0.74, jitter: 0.14, stretch: e.dir != null ? 1.12 : 1, ang: e.dir ?? 0, long: 0 }));

/* the part of the picture whose scene is changed by the drawing's `back` (a polygon for the player's clip, null = all of it) */
export function backClip(e, f) {
  if ( !f.back ) return null;
  if ( e.local ) return panelOf(e, f);
  if ( f.back === "split" ) return G.tear(f.seed, { cx: e.hx, cy: e.hy, ang: tearAngle(e, f), W: e.W, H: e.H, w: unit(e) * 0.04 * gain(e) }).sideA;
  if ( FRAMES[f.type]?.local ) return panelPoly(e, f);
  return null;
}

/* under the guard every colour a drawing uses is red-safe: a saturated red accent is drawn as a deep crimson (LIMITS.redArea) */
function guarded(e) {
  if ( e.redOk ) return e;
  if ( !isRed(e.tone?.a) && !isRed(e.tone?.b) ) return e;
  e._tints ??= new Map();
  return (e._safe ??= Object.assign(Object.create(e), { tone: { a: safeColor(e.tone.a), b: safeColor(e.tone.b) } }));
}
/* paint one drawing; returns false when the type is unknown */
export function paintFrame(ctx, e0, f) {
  const fn = PAINT[f.type];
  if ( !fn || !FRAMES[f.type] ) return false;
  const e = guarded(e0);
  ctx.save();
  if ( e.local ) {
    const p = panelOf(e, f);
    ctx.beginPath(); path(ctx, p); ctx.clip();
    fn(ctx, e, f);
    paintFigs(ctx, e, f);
    ctx.restore(); ctx.save();
    if ( f.back ) { ctx.beginPath(); path(ctx, p); ctx.lineJoin = "miter"; ctx.miterLimit = 3; ctx.lineWidth = unit(e) * 0.008; ctx.strokeStyle = INK; ctx.stroke(); }
  } else { fn(ctx, e, f); paintFigs(ctx, e, f); }
  ctx.restore();
  return true;
}
export const PAINTERS = Object.keys(PAINT);
