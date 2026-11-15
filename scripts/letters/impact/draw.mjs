/* LETR impact frames: the ink of each frame type, painted on a 2D context (one picture per drawing, painted ahead of time).
   env = { W, H (px), cx, cy (the subject's centre), hx, hy (where the blow lands), R (the subject's radius, px), dir (radians | null),
           mag (0..2), step (0..5, plan.mjs stepOf), kind, tone: { a, b }, sil: { src, sx, sy, sw, sh, w, h, rot } | null,
           local: null | { r }, panel: { r } (a local change of the scene), redOk, makeCanvas, ctx2d }
   Rule of the look: flat colour, hard shapes, and every ink shape carries a keyline of the opposite value, so it reads on any map
   (a dark busy scene as much as a pale one). */
import { INK, PAPER, FRAMES, LIMITS, isRed, safeColor, SAFE_RED, FIG_BRIGHT } from "./plan.mjs";
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
      P = { w, h, pixels: true, area: on / n, d, alpha, cut: m.cut ? m.mask : null,
        inv: put(invPixels(d)), orig: put(origPixels(d)), ink: put(inkPixels(d, w, h, alpha, false)), post: new Map(), put };
    }
    c.width = 0; c.height = 0;
  } catch { P = { w, h, pixels: false, area: 0.8 }; }
  e._figs.set(s, P); sh?.set(sk, P);
  return P;
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
/* the accent that lights the rims (seeded per impact: tone a or b; never saturated red under the guard) */
export const rimColor = (e) => { const c = e.rimTone === "b" ? e.tone.b : e.tone.a; return e.redOk ? c : isRed(c) ? (isRed(e.tone.b) ? PAPER : e.tone.b) : c; };
/* which figures and what they show on this drawing, on this seat:
   -> null (no figures' part) | { t (r i p k o), list: [fig] }. A treatment that changes the brightness of the figures' own art (i, p, k)
   is drawn only while all of them together cover at most LIMITS.figArea of the view (a seat zoomed close onto a big token gets the
   rim only), only from art this seat can read, and never in the gentle variant (safety() already made those r) */
export const ENLARGED = new Set(["shadow", "glare", "swap"]);
export function figTreat(e, f) {
  if ( !f?.fig || !e.figs?.length ) return null;
  const list = e.figs.filter((g) => g.sil && !(g.role === "target" && ENLARGED.has(f.type)));
  if ( !list.length ) return null;
  const t = e.local ? "r" : f.fig;
  /* the area is shared out in order (the struck figure first, then the attacker, then the others): a figure whose art would take the
     figures' area over the cap keeps the rim only */
  let a = 0;
  const each = list.map((g) => {
    if ( !FIG_BRIGHT.has(t) ) return t;
    const ga = Math.abs(g.sil.w * g.sil.h) * (g.area ?? figPix(e, g.sil).area);
    if ( a + ga > LIMITS.figArea * e.W * e.H ) return "r";
    a += ga; return t;
  });
  return { t, list, each, area: a };
}
/* one figure: ink line and lit rim round its true outline, then its art in the treatment */
function drawFig(ctx, e, f, g, t, R) {
  const s = g.sil, P = figPix(e, s), u = unit(e);
  const step = Number.isFinite(e.step) ? e.step : 3;
  const w = s.w, h = s.h;
  if ( (t === "i" || t === "p" || t === "k" || t === "o") && !P.pixels ) t = "r";
  /* the rim boils: its width and the angle of its copies change with every drawing (seeded) */
  const rw = Math.max(1.5, Math.min(u * 0.016, Math.min(w, h) * 0.045 * (1 + 0.16 * step))) * R.f(0.85, 1.15), iw = Math.max(1.2, rw * 0.5);
  const lit = rimColor(e), inkT = alphaTint(e, s, INK), litT = alphaTint(e, s, lit);
  ctx.save();
  ctx.translate(g.cx, g.cy);
  ctx.rotate(s.rot ?? 0);
  if ( g.flipX || g.flipY ) ctx.scale(g.flipX ? -1 : 1, g.flipY ? -1 : 1);
  /* the side the blow comes from, in the figure's own frame */
  const da = e.dir != null ? e.dir + Math.PI - (s.rot ?? 0) : null;
  const lx = da != null ? Math.cos(da) * (g.flipX ? -1 : 1) : 0, ly = da != null ? Math.sin(da) * (g.flipY ? -1 : 1) : 0;
  const a0 = R.f(0, Math.PI * 2);
  const ring = (img, r, sx = 0, sy = 0) => { if ( !img ) return; for ( let i = 0; i < 12; i++ ) { const a = a0 + (i / 12) * Math.PI * 2; ctx.drawImage(img, -w / 2 + Math.cos(a) * r + sx, -h / 2 + Math.sin(a) * r + sy, w, h); } };
  ring(inkT, rw + iw, lx * rw * 0.7, ly * rw * 0.7);
  ring(litT, rw, lx * rw * 0.9, ly * rw * 0.9);
  let art = null;
  if ( t === "i" ) art = P.inv;
  else if ( t === "k" ) art = P.ink;
  else if ( t === "p" ) { art = P.post.get(lit); if ( !art && P.pixels ) { art = P.put(postPixels(P.d, P.w, P.h, P.alpha, P.cut, hexRgb(safeColor(lit === PAPER ? e.tone.a : lit)))); P.post.set(lit, art); } }
  else if ( P.pixels ) art = P.orig;
  if ( art ) ctx.drawImage(art, -w / 2, -h / 2, w, h);
  else { try { ctx.drawImage(s.src, s.sx, s.sy, s.sw, s.sh, -w / 2, -h / 2, w, h); } catch {} }
  ctx.restore();
}
/* the figures' part of a drawing (painted last, over the drawing's own ink) */
function paintFigs(ctx, e, f) {
  const tr = figTreat(e, f);
  if ( !tr ) return;
  const R = rng((f.seed ^ 0x5bd1e995) >>> 0);
  tr.list.forEach((g, i) => drawFig(ctx, e, f, g, tr.each[i], R));
}
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
    sil(ctx, e, { color: PAPER, outline: INK, outlineW: u * 0.008, scale: k, art: "bw" });
  },
  glare(ctx, e, f) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, e.W, e.H);
    const k = blowUp(e), u = unit(e);
    lines(ctx, e, f.seed, { n: 78, fat: 1.8, color: INK, key: PAPER, second: null, gap: Math.max(1, k * 0.7) });
    if ( !sil(ctx, e, { color: INK, outline: e.tone.a, outlineW: u * 0.007, scale: k, art: "neg" }) ) burst(ctx, e, f.seed + 1, { cx: e.cx, cy: e.cy, r: burstR(e) * 1.2, fill: INK, stroke: e.tone.a, long: 4 });
    burst(ctx, e, f.seed + 2, { r: burstR(e) * 0.5, fill: e.tone.a, long: 2 });
  },
  swap(ctx, e, f) {
    const k = blowUp(e), u = unit(e), bg = fieldColor(e, e.tone.a);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, e.W, e.H);
    halftone(ctx, e, f.seed, { color: INK, under: null, all: e.dir == null, whole: true, r0: 0, r1: Math.hypot(e.W, e.H) * 0.62, pitch: Math.max(12, u * 0.03), fan: 1.25 });
    lines(ctx, e, f.seed + 1, { n: 34, fat: 1.1, color: PAPER, key: INK, second: null, gap: Math.max(1, k * 0.7) });
    if ( !sil(ctx, e, { color: INK, outline: PAPER, outlineW: u * 0.008, scale: k, art: "neg" }) ) burst(ctx, e, f.seed + 2, { cx: e.cx, cy: e.cy, r: burstR(e) * 1.3, fill: INK, stroke: PAPER, long: 4 });
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
      sil(ctx, e, { color: e.redOk ? "#ff2a4a" : "#d0306a", x: e.cx - Math.cos(a) * d * 1.6, y: e.cy - Math.sin(a) * d * 1.6, blend: "screen", alpha: 0.85 });
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
