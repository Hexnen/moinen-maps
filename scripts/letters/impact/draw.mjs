/* LETR impact frames: the ink of each frame type, painted on a 2D context (one picture per drawing, painted ahead of time).
   env = { W, H (px), cx, cy (the subject's centre), hx, hy (where the blow lands), R (the subject's radius, px), dir (radians | null),
           mag (0..2), tone: { a, b }, sil: { src, sx, sy, sw, sh, w, h, rot } | null, local: null | { r }, redOk, makeCanvas }
   Rule of the look: flat colour, hard shapes, and every ink shape carries a keyline of the opposite value, so it reads on any map. */
import { INK, PAPER, FRAMES, isRed } from "./plan.mjs";
import * as G from "./shapes.mjs";

const TAU = Math.PI * 2;
const path = (ctx, p) => { ctx.moveTo(p[0], p[1]); for ( let i = 2; i < p.length; i += 2 ) ctx.lineTo(p[i], p[i + 1]); ctx.closePath(); };
function fillPolys(ctx, polys, color) { ctx.beginPath(); for ( const p of polys ) path(ctx, p); ctx.fillStyle = color; ctx.fill(); }
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
const gain = (e) => 0.6 + 0.4 * e.mag;
/* the star of a drawing that is not a full-field frame stays inside a disc of a sixth of the picture, however big the subject (a word, a wide blast) */
export const burstR = (e) => Math.min(Math.max(e.R * 1.6, unit(e) * 0.13) * gain(e), Math.sqrt(0.16 * e.W * e.H / Math.PI));

/* ---------- the subject's silhouette ---------- */
function tint(e, color) {
  const s = e.sil; if ( !s ) return null;
  e._tints ??= new Map();
  let c = e._tints.get(color);
  if ( c ) return c;
  const k = Math.min(1, 384 / Math.max(s.sw, s.sh));
  c = e.makeCanvas(Math.max(2, Math.round(s.sw * k)), Math.max(2, Math.round(s.sh * k)));
  const x = ctx2d(e, c);
  try { x.drawImage(s.src, s.sx, s.sy, s.sw, s.sh, 0, 0, c.width, c.height); } catch { return null; }
  x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  e._tints.set(color, c);
  return c;
}
const ctx2d = (e, c) => (e.ctx2d ? e.ctx2d(c) : c.getContext("2d"));
/* the subject's own picture in hard black and white ("bw") or as its negative ("neg"): the struck figure, inked */
function art(e, mode) {
  const s = e.sil; if ( !s ) return null;
  e._tints ??= new Map();
  const key = `art:${mode}`;
  if ( e._tints.has(key) ) return e._tints.get(key);
  let c = null;
  try {
    const k = Math.min(1, 384 / Math.max(s.sw, s.sh));
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

/* ---------- parts shared by several frames ---------- */
function lines(ctx, e, seed, o = {}) {
  const u = unit(e), D = Math.hypot(e.W, e.H);
  const cx = o.cx ?? e.cx, cy = o.cy ?? e.cy;
  if ( e.dir != null && !o.radial ) {
    const gap = Math.max(e.R * 1.3, u * 0.08) * (o.gap ?? 1);
    fillPolys(ctx, G.speedLines(seed, { cx, cy, ang: e.dir, W: e.W, H: e.H, n: Math.round((o.n ?? 40) * 0.8), gap, fat: o.fat ?? 1 }), o.color ?? INK);
    if ( o.second !== null ) fillPolys(ctx, G.speedLines(seed + 7, { cx, cy, ang: e.dir, W: e.W, H: e.H, n: Math.round((o.n ?? 40) * 0.4), gap: gap * 1.2, fat: (o.fat ?? 1) * 0.7 }), o.second ?? PAPER);
  } else {
    const rIn = Math.max(e.R * 1.7, u * 0.2) * (o.gap ?? 1);
    fillPolys(ctx, G.focusLines(seed, { cx, cy, rIn, rOut: D * 1.05, n: o.n ?? 60, fat: o.fat ?? 1 }), o.color ?? INK);
    if ( o.second !== null ) fillPolys(ctx, G.focusLines(seed + 7, { cx, cy, rIn: rIn * 1.15, rOut: D * 1.05, n: Math.round((o.n ?? 60) * 0.45), fat: (o.fat ?? 1) * 0.6 }), o.second ?? PAPER);
  }
}
function burst(ctx, e, seed, o = {}) {
  const u = unit(e), r = (o.r ?? burstR(e));
  const p = G.star(seed, { cx: o.cx ?? e.hx, cy: o.cy ?? e.hy, r, spikes: o.spikes ?? 15, inner: o.inner ?? 0.52, jitter: 0.24, stretch: e.dir != null ? (o.stretch ?? 1.25) : 1, ang: e.dir ?? 0, long: o.long ?? 3 });
  if ( o.key ) shape(ctx, p, null, o.key, u * 0.011 + (o.lw ?? u * 0.006));
  shape(ctx, p, o.fill ?? PAPER, o.stroke ?? INK, o.lw ?? u * 0.006);
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
function ringsOf(ctx, e, seed, o = {}) {
  const u = unit(e);
  const list = G.rings(seed, { r: o.r ?? burstR(e) * 1.9, w: o.w ?? u * 0.02 * gain(e), n: o.n ?? 2 });
  const arc = (extra, color) => { ctx.strokeStyle = color; ctx.lineCap = "butt"; for ( const a of list ) { ctx.beginPath(); ctx.lineWidth = a.w + extra; ctx.ellipse(e.cx, e.cy, a.r, a.r * (o.flat ?? 1), 0, a.a0, a.a1); ctx.stroke(); } };
  arc(u * 0.01, o.key ?? PAPER); arc(0, o.color ?? INK);
}
/* the big burst of a frame-filling drawing: under the guard a saturated red accent moves to the small core, the wide star takes the second colour */
export const bigTone = (e) => (!e.redOk && isRed(e.tone.a) && !isRed(e.tone.b) ? [e.tone.b, e.tone.a] : [e.tone.a, e.tone.b]);
const fieldColor = (e, c) => (!e.redOk && isRed(c) ? (isRed(e.tone.b) ? PAPER : e.tone.b) : c);

/* ---------- the frame types ---------- */
const PAINT = {
  pop(ctx, e, f) {
    burst(ctx, e, f.seed, { fill: e.tone.a, core: PAPER, key: PAPER });
    const rb = burstR(e);
    fillPolys(ctx, G.focusLines(f.seed + 1, { cx: e.hx, cy: e.hy, rIn: rb * 1.25, rOut: rb * 2.1, n: 18, fat: 0.8 }), INK);
  },
  splat(ctx, e, f) {
    splash(ctx, e, f.seed);
    burst(ctx, e, f.seed + 2, { r: burstR(e) * 0.5, fill: e.tone.a, long: 1 });
  },
  lines(ctx, e, f) { lines(ctx, e, f.seed, { n: 84, fat: 0.8 }); },
  ink(ctx, e, f) {
    lines(ctx, e, f.seed, { n: 46, fat: 1 });
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
    lines(ctx, e, f.seed, { n: 30, fat: 0.7, color: small, second: null, radial: true, gap: 1.5 * Math.max(1, k * 0.6) });
    const r = Math.max(burstR(e) * 2.1, (e.sil ? Math.max(e.sil.w, e.sil.h) * k * 0.78 : 0));
    burst(ctx, e, f.seed + 1, { cx: e.cx, cy: e.cy, r, fill: big, stroke: PAPER, lw: u * 0.005, core: e.sil ? small : PAPER, spikes: 19, long: 5, stretch: 1.4 });
    sil(ctx, e, { color: PAPER, outline: INK, outlineW: u * 0.008, scale: k, art: "bw" });
  },
  glare(ctx, e, f) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, e.W, e.H);
    const k = blowUp(e), u = unit(e);
    lines(ctx, e, f.seed, { n: 78, fat: 1.8, color: INK, second: null, gap: Math.max(1, k * 0.7) });
    if ( !sil(ctx, e, { color: INK, outline: e.tone.a, outlineW: u * 0.007, scale: k, art: "neg" }) ) burst(ctx, e, f.seed + 1, { cx: e.cx, cy: e.cy, r: burstR(e) * 1.2, fill: INK, stroke: e.tone.a, long: 4 });
    burst(ctx, e, f.seed + 2, { r: burstR(e) * 0.5, fill: e.tone.a, long: 2 });
  },
  swap(ctx, e, f) {
    const k = blowUp(e), u = unit(e), bg = fieldColor(e, e.tone.a);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, e.W, e.H);
    halftone(ctx, e, f.seed, { color: INK, under: null, all: e.dir == null, whole: true, r0: 0, r1: Math.hypot(e.W, e.H) * 0.62, pitch: Math.max(12, u * 0.03), fan: 1.25 });
    lines(ctx, e, f.seed + 1, { n: 34, fat: 1.1, color: PAPER, second: null, gap: Math.max(1, k * 0.7) });
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
  smear(ctx, e, f) {
    const cols = [e.tone.b, e.tone.a, PAPER];
    if ( e.sil && e.dir != null ) {
      const step = Math.max(e.R * 0.7, unit(e) * 0.03) * gain(e);
      for ( let k = 3; k >= 1; k-- ) sil(ctx, e, { color: cols[3 - k], outline: k === 1 ? INK : null, x: e.cx - Math.cos(e.dir) * step * k, y: e.cy - Math.sin(e.dir) * step * k, stretch: 1 + 0.35 * k });
    } else if ( e.sil ) {
      for ( let k = 3; k >= 1; k-- ) sil(ctx, e, { color: cols[3 - k], outline: k === 1 ? INK : null, scale: 1 + 0.22 * k });
    }
    lines(ctx, e, f.seed, { n: 26, fat: 1.2, gap: 0.6 });
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
    const u = unit(e), c = G.cracks(f.seed, { cx: e.hx, cy: e.hy, r: u * 0.5 * gain(e), w: u * 0.022 * gain(e), n: 10 });
    for ( const p of c.cracks ) shape(ctx, p, PAPER, INK, u * 0.004);
    for ( const p of c.shards ) shape(ctx, p, INK, PAPER, u * 0.004);
    burst(ctx, e, f.seed + 2, { r: burstR(e) * 0.7, fill: e.tone.a, core: PAPER });
  },
  chroma(ctx, e, f) {
    const u = unit(e), d = u * 0.012 * gain(e), a = e.dir ?? 0;
    if ( e.sil && e.chromaBack === false ) {   // only when the scene itself cannot be split (no SVG backdrop filter)
      sil(ctx, e, { color: "#ff2a4a", x: e.cx - Math.cos(a) * d * 1.6, y: e.cy - Math.sin(a) * d * 1.6, blend: "screen", alpha: 0.85 });
      sil(ctx, e, { color: "#19e0ff", x: e.cx + Math.cos(a) * d * 1.6, y: e.cy + Math.sin(a) * d * 1.6, blend: "screen", alpha: 0.85 });
    }
    lines(ctx, e, f.seed, { n: 30, fat: 0.35, color: PAPER, second: null, gap: 1.3 });
  },
  ring(ctx, e, f) {
    ringsOf(ctx, e, f.seed, {});
    halftone(ctx, e, f.seed + 1, { all: true, r0: burstR(e) * 1.9, r1: burstR(e) * 2.8, color: e.tone.a });
  },
  fade(ctx, e, f) {
    const rb = burstR(e);
    fillPolys(ctx, G.focusLines(f.seed, { cx: e.hx, cy: e.hy, rIn: rb * 1.7, rOut: rb * 3.4, n: 10, fat: 0.2, thin: true }), INK);
    const s = G.splat(f.seed + 1, { cx: e.hx, cy: e.hy, r: rb * 2.2, n: 9, ang: e.dir, spread: 1.1 });
    const small = s.blobs.slice(0, -2).map(([x, y, r]) => [x, y, r * 0.55]);
    discs(ctx, small, PAPER, unit(e) * 0.003); discs(ctx, small, INK);
  }
};
const tearAngle = (e, f) => e.dir ?? ((f.seed % 180) * Math.PI) / 180;

/* the gentle variant's panel: a jagged star of at most LIMITS.localArea of the viewport round the subject */
export const panelOf = (e, f) => G.star(f.seed + 11, { cx: e.cx, cy: e.cy, r: e.local.r, spikes: 14, inner: 0.72, jitter: 0.12, stretch: 1, ang: 0, long: 0 });

/* the part of the picture whose scene is changed by the drawing's `back` (a polygon for the player's clip, null = all of it) */
export function backClip(e, f) {
  if ( !f.back ) return null;
  if ( e.local ) return panelOf(e, f);
  if ( f.back === "split" ) return G.tear(f.seed, { cx: e.hx, cy: e.hy, ang: tearAngle(e, f), W: e.W, H: e.H, w: unit(e) * 0.04 * gain(e) }).sideA;
  return null;
}

/* paint one drawing; returns false when the type draws no ink at all */
export function paintFrame(ctx, e, f) {
  const fn = PAINT[f.type];
  if ( !fn || !FRAMES[f.type] ) return false;
  ctx.save();
  if ( e.local ) {
    const p = panelOf(e, f);
    ctx.beginPath(); path(ctx, p); ctx.clip();
    fn(ctx, e, f);
    ctx.restore(); ctx.save();
    if ( f.back ) { ctx.beginPath(); path(ctx, p); ctx.lineJoin = "miter"; ctx.miterLimit = 3; ctx.lineWidth = unit(e) * 0.008; ctx.strokeStyle = INK; ctx.stroke(); }
  } else fn(ctx, e, f);
  ctx.restore();
  return true;
}
export const PAINTERS = Object.keys(PAINT);
