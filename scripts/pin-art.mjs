/**
 * Hand-inked pin artwork, pre-rendered once to canvases (layers), shared by every pin and by the scene-config preview.
 *
 * Unit space: the pin's tip is (0,0), +y is down, the head circle has radius R=0.4 centred at (0,-0.6).
 * A texture covers x in [-0.625,0.625], y in [-1.25,0.125] at 256 px per unit, so a pin at S px tall is
 * sprite.scale = S / 256 and stays crisp up to ~4x canvas zoom (mipmapped for zoom-out).
 *
 * Layers (bottom to top): halo (hover/selection glow, tinted at runtime), fill (white, tinted by pin colour),
 * gloss (soft highlight), ink (brush outline), burst (cream comic star + tick marks).
 */
export const PPU = 256, FW = 320, FH = 352, OX = 160, OY = 320;
export const R = 0.34, CY = -0.67;
const TAU = Math.PI * 2;
const INK = "#15110f", CREAM = "#fff3e2";
export const VARIANTS = 3;
const SEEDS = [11, 47, 93];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCtx() {
  const c = document.createElement("canvas");
  c.width = FW; c.height = FH;
  const ctx = c.getContext("2d");
  ctx.setTransform(PPU, 0, 0, PPU, OX, OY);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  return ctx;
}

/** A wobbly circular path around the head; `drift` makes the radius spiral so a stroke's ends do not meet exactly. */
function ring(rnd, rad, n, a0, sweep, drift = 0) {
  const p = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
  const pts = [];
  for ( let i = 0; i <= n; i++ ) {
    const t = i / n, a = a0 + sweep * t;
    const w = 1 + 0.014 * Math.sin(2 * a + p[0]) + 0.011 * Math.sin(3 * a + p[1]) + 0.006 * Math.sin(5 * a + p[2]);
    const r = rad * w * (1 + drift * (t - 0.5));
    pts.push([Math.cos(a) * r, CY + Math.sin(a) * r * 0.985]);
  }
  return pts;
}

// tip geometry: starts where the head circle meets the taper, concave sides down to the point
const TIP_A = [-0.18, -0.395], TIP_B = [0.18, -0.395], TIP_P = [0, 0.004];
const TIP_C = 0.05, TIP_CY = -0.2;
function taper(rnd, side, n = 24) {
  const A = side < 0 ? TIP_A : TIP_B;
  const C = [side * TIP_C, TIP_CY];
  const pts = [];
  const j = [rnd() * TAU, rnd() * TAU];
  for ( let i = 0; i <= n; i++ ) {
    const t = i / n, u = 1 - t;
    let x = u * u * A[0] + 2 * u * t * C[0] + t * t * TIP_P[0];
    const y = u * u * A[1] + 2 * u * t * C[1] + t * t * TIP_P[1];
    x += 0.011 * Math.sin(t * 7 + j[0]) * Math.sin(t * Math.PI) + 0.006 * Math.sin(t * 17 + j[1]) * Math.sin(t * Math.PI);
    pts.push([x, y]);
  }
  return pts;
}

/** Stroke a polyline as many short round-capped segments of varying width: reads as a chunky brush line. */
function brush(ctx, pts, width, rnd, color = INK, jitter = 0.006) {
  ctx.strokeStyle = color;
  const ph = rnd() * TAU;
  for ( let i = 1; i < pts.length; i++ ) {
    const t = i / pts.length;
    ctx.lineWidth = width * (0.82 + 0.2 * Math.sin(t * 11 + ph) + 0.12 * (rnd() - 0.5));
    ctx.beginPath();
    ctx.moveTo(pts[i - 1][0] + (rnd() - 0.5) * jitter, pts[i - 1][1] + (rnd() - 0.5) * jitter);
    ctx.lineTo(pts[i][0] + (rnd() - 0.5) * jitter, pts[i][1] + (rnd() - 0.5) * jitter);
    ctx.stroke();
  }
}

function silhouette(ctx, rnd) {
  const head = ring(rnd, R * 0.985, 56, 0, TAU);
  ctx.beginPath();
  head.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fill();
  const L = taper(rnd, -1), Rt = taper(rnd, 1);
  ctx.beginPath();
  L.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  Rt.slice().reverse().forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.closePath();
  ctx.fill();
}

function drawFill(seed) {
  const ctx = makeCtx();
  ctx.fillStyle = "#fff";
  ctx.translate(0.008, -0.006); // slight mis-registration against the ink, like a printed/inked drawing
  silhouette(ctx, rng(seed + 1));
  return ctx.canvas;
}

function drawGloss(seed) {
  const ctx = makeCtx();
  const rnd = rng(seed + 2);
  ctx.strokeStyle = "rgba(255,255,255,0.34)";
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  const a0 = Math.PI * 1.08, a1 = Math.PI * 1.42;
  for ( let i = 0; i <= 16; i++ ) {
    const a = a0 + (a1 - a0) * i / 16, r = 0.26 + (rnd() - 0.5) * 0.006;
    const x = Math.cos(a) * r, y = CY + Math.sin(a) * r;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.lineWidth = 0.03;
  ctx.beginPath(); ctx.arc(0, CY, 0.26, Math.PI * 1.5, Math.PI * 1.58); ctx.stroke();
  return ctx.canvas;
}

function drawInk(seed) {
  const ctx = makeCtx();
  const rnd = rng(seed + 3);
  // tapered tip, both sides
  brush(ctx, taper(rnd, -1), 0.058, rnd);
  brush(ctx, taper(rnd, 1), 0.058, rnd);
  brush(ctx, taper(rnd, -1).map(([x, y]) => [x * 0.96 + 0.006, y]), 0.03, rnd);
  // head ring: two overlapping passes with a spiralling radius so it feels drawn, not stamped
  const a0 = rnd() * TAU;
  brush(ctx, ring(rnd, R, 72, a0, TAU + 0.28, 0.03), 0.064, rnd);
  brush(ctx, ring(rnd, R * 0.992, 64, a0 + 2.4, TAU * 0.8, -0.03), 0.034, rnd);
  // stray bristle flicks just outside the ring
  ctx.strokeStyle = INK;
  for ( let i = 0; i < 9; i++ ) {
    const a = rnd() * TAU, r = R * (1.06 + rnd() * 0.07), len = 0.04 + rnd() * 0.07;
    const x = Math.cos(a) * r, y = CY + Math.sin(a) * r;
    const tx = -Math.sin(a), ty = Math.cos(a);
    ctx.lineWidth = 0.012 + rnd() * 0.01;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + tx * len, y + ty * len); ctx.stroke();
  }
  return ctx.canvas;
}

function drawBurst(seed) {
  const ctx = makeCtx();
  const rnd = rng(seed + 4);
  const n = 8, rot = rnd() * TAU, ro = 0.2, ri = 0.092;
  const pts = [];
  for ( let i = 0; i < n * 2; i++ ) {
    const a = rot + (i / (n * 2)) * TAU, r = (i % 2 ? ri : ro) * (0.88 + rnd() * 0.22);
    pts.push([Math.cos(a) * r, CY + Math.sin(a) * r]);
  }
  ctx.fillStyle = CREAM;
  ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill();
  ctx.lineJoin = "miter"; ctx.miterLimit = 2.2;
  const closed = pts.concat([pts[0], pts[1]]);
  brush(ctx, closed, 0.032, rnd, INK, 0.004);
  ctx.lineJoin = "round";
  // tick marks in the gaps, like the reference
  const base = rnd() * TAU;
  for ( let i = 0; i < 5; i++ ) {
    const a = base + (i / 5) * TAU + (rnd() - 0.5) * 0.3, r0 = 0.235, r1 = 0.272 + rnd() * 0.01;
    ctx.strokeStyle = INK; ctx.lineWidth = 0.021;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, CY + Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, CY + Math.sin(a) * r1); ctx.stroke();
  }
  return ctx.canvas;
}

function drawHalo(seed) {
  const ctx = makeCtx();
  const rnd = rng(seed + 1);
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 0.13;
  try { ctx.filter = "blur(5px)"; } catch {}
  for ( let i = 0; i < 2; i++ ) {
    const r = rng(seed + 1);
    // stroke + fill of the silhouette
    ctx.beginPath(); ctx.arc(0, CY, R, 0, TAU); ctx.stroke(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(...TIP_A); ctx.quadraticCurveTo(-TIP_C, TIP_CY, ...TIP_P);
    ctx.quadraticCurveTo(TIP_C, TIP_CY, ...TIP_B); ctx.closePath(); ctx.stroke(); ctx.fill();
  }
  void rnd;
  return ctx.canvas;
}

const cache = new Map();

/** The raw canvases of a variant: {halo, fill, gloss, ink, burst}. */
export function pinCanvases(variant = 0) {
  const v = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
  let c = cache.get(v);
  if ( !c ) {
    const s = SEEDS[v];
    c = { halo: drawHalo(s), fill: drawFill(s), gloss: drawGloss(s), ink: drawInk(s), burst: drawBurst(s) };
    cache.set(v, c);
  }
  return c;
}

/** PIXI textures of a variant (mipmapped, linear). */
export function pinTextures(variant = 0) {
  const c = pinCanvases(variant);
  if ( !c.tex ) {
    c.tex = {};
    for ( const k of ["halo", "fill", "gloss", "ink", "burst"] ) {
      const t = c.tex[k] = PIXI.Texture.from(c[k], { scaleMode: PIXI.SCALE_MODES.LINEAR });
      t.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
    }
  }
  return c.tex;
}

/** Composite a finished pin (tinted) to a fresh canvas; used for the scene-config preview. */
export function compositePin(variant, cssColor, glyph) {
  const c = pinCanvases(variant);
  const out = document.createElement("canvas");
  out.width = FW; out.height = FH;
  const ctx = out.getContext("2d");
  const tinted = document.createElement("canvas");
  tinted.width = FW; tinted.height = FH;
  const t = tinted.getContext("2d");
  t.drawImage(c.fill, 0, 0);
  t.globalCompositeOperation = "multiply"; t.fillStyle = cssColor; t.fillRect(0, 0, FW, FH);
  t.globalCompositeOperation = "destination-in"; t.drawImage(c.fill, 0, 0);
  ctx.drawImage(tinted, 0, 0);
  ctx.drawImage(c.gloss, 0, 0);
  ctx.drawImage(c.ink, 0, 0);
  ctx.drawImage(glyph && glyph !== "star" ? burstCanvas(glyph, variant) : c.burst, 0, 0);
  return out;
}

let shadowTex;
/** Soft ground-shadow textures (rendered once): a wide faint penumbra and a tight dark contact core, no hard edge. */
export function shadowTextures() {
  if ( shadowTex ) return shadowTex;
  const make = (w, h, stops) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.translate(w / 2, h / 2); ctx.scale(1, h / w);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w / 2);
    for ( const [o, a] of stops ) g.addColorStop(o, `rgba(24,14,30,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, -w / 2, w, w);
    return PIXI.Texture.from(c, { scaleMode: PIXI.SCALE_MODES.LINEAR });
  };
  shadowTex = {
    pen: make(256, 128, [[0, 0.34], [0.35, 0.24], [0.7, 0.09], [1, 0]]),
    core: make(128, 64, [[0, 0.85], [0.3, 0.6], [0.65, 0.2], [1, 0]])
  };
  return shadowTex;
}

/* ---------- typed pins: a cream burst carrying a hand-inked glyph ---------- */
const arcPts = (cx, cy, r, a0, a1, n = 14, ry = r) => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * ry];
});
const GLYPHS = {
  star: null, // the default burst, drawn by drawBurst
  skull(ctx, rnd) {
    brush(ctx, arcPts(0, CY - 0.012, 0.105, Math.PI * 0.82, Math.PI * 2.18, 22), 0.03, rnd, INK, 0.004);
    brush(ctx, [[-0.07, CY + 0.06], [-0.06, CY + 0.12], [0.06, CY + 0.12], [0.07, CY + 0.06]], 0.028, rnd, INK, 0.004);
    ctx.fillStyle = INK;
    for ( const sx of [-1, 1] ) { ctx.beginPath(); ctx.ellipse(sx * 0.046, CY - 0.005, 0.03, 0.036, 0, 0, TAU); ctx.fill(); }
    brush(ctx, [[0, CY + 0.045], [-0.012, CY + 0.07], [0.012, CY + 0.07], [0, CY + 0.045]], 0.016, rnd, INK, 0.002);
    brush(ctx, [[-0.025, CY + 0.12], [-0.025, CY + 0.085]], 0.016, rnd);
    brush(ctx, [[0.025, CY + 0.12], [0.025, CY + 0.085]], 0.016, rnd);
  },
  gem(ctx, rnd) {
    const P = [[-0.115, CY - 0.045], [-0.065, CY - 0.11], [0.065, CY - 0.11], [0.115, CY - 0.045], [0, CY + 0.12], [-0.115, CY - 0.045]];
    brush(ctx, P, 0.03, rnd, INK, 0.004);
    brush(ctx, [[-0.115, CY - 0.045], [0.115, CY - 0.045]], 0.02, rnd);
    brush(ctx, [[-0.03, CY - 0.045], [0, CY + 0.12], [0.03, CY - 0.045]].slice(0, 2), 0.016, rnd);
    brush(ctx, [[0.03, CY - 0.045], [0, CY + 0.12]], 0.016, rnd);
    brush(ctx, [[-0.03, CY - 0.045], [-0.065, CY - 0.11]], 0.016, rnd);
    brush(ctx, [[0.03, CY - 0.045], [0.065, CY - 0.11]], 0.016, rnd);
  },
  bang(ctx, rnd) {
    brush(ctx, [[0, CY - 0.125], [-0.004, CY + 0.03]], 0.058, rnd, INK, 0.003);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(0, CY + 0.098, 0.036, 0, TAU); ctx.fill();
  },
  question(ctx, rnd) {
    brush(ctx, arcPts(0, CY - 0.052, 0.07, Math.PI * 1.05, Math.PI * 2.35, 16, 0.065).concat([[0.012, CY + 0.045]]), 0.044, rnd, INK, 0.004);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(0.004, CY + 0.108, 0.03, 0, TAU); ctx.fill();
  },
  tent(ctx, rnd) {
    brush(ctx, [[-0.125, CY + 0.1], [0, CY - 0.115], [0.125, CY + 0.1], [-0.125, CY + 0.1]], 0.032, rnd, INK, 0.004);
    brush(ctx, [[0, CY - 0.115], [-0.004, CY + 0.1]], 0.022, rnd);
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.moveTo(-0.03, CY + 0.1); ctx.lineTo(0, CY + 0.03); ctx.lineTo(0.03, CY + 0.1); ctx.closePath(); ctx.fill();
  },
  door(ctx, rnd) {
    const P = [[-0.085, CY + 0.12], [-0.085, CY - 0.04]].concat(arcPts(0, CY - 0.04, 0.085, Math.PI, Math.PI * 2, 12)).concat([[0.085, CY + 0.12], [-0.085, CY + 0.12]]);
    brush(ctx, P, 0.03, rnd, INK, 0.004);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(0.04, CY + 0.045, 0.018, 0, TAU); ctx.fill();
  }
};

const burstCache = new Map();
/** Canvas of the cream burst for a glyph + variant (rendered once). */
export function burstCanvas(glyph, variant = 0) {
  const v = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
  if ( !glyph || glyph === "star" || !GLYPHS[glyph] ) return pinCanvases(v).burst;
  const key = `${glyph}:${v}`;
  let entry = burstCache.get(key);
  if ( !entry ) {
    const ctx = makeCtx(), rnd = rng(SEEDS[v] + 7);
    // a scalloped cream disc, a softer burst so the glyph stays legible at small sizes
    const n = 14, pts = [];
    for ( let i = 0; i < n * 2; i++ ) {
      const a = (i / (n * 2)) * TAU + rnd() * 0.04, r = (i % 2 ? 0.205 : 0.238) * (0.97 + rnd() * 0.06);
      pts.push([Math.cos(a) * r, CY + Math.sin(a) * r]);
    }
    ctx.fillStyle = CREAM;
    ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill();
    brush(ctx, pts.concat([pts[0], pts[1]]), 0.03, rnd, INK, 0.004);
    GLYPHS[glyph](ctx, rnd);
    entry = { canvas: ctx.canvas };
    burstCache.set(key, entry);
  }
  return entry.canvas;
}

/** PIXI texture of the burst for a glyph + variant. */
export function burstTexture(glyph, variant = 0) {
  const v = ((variant % VARIANTS) + VARIANTS) % VARIANTS;
  if ( !glyph || glyph === "star" || !GLYPHS[glyph] ) return pinTextures(v).burst;
  const entry = burstCache.get(`${glyph}:${v}`) ?? (burstCanvas(glyph, v), burstCache.get(`${glyph}:${v}`));
  if ( !entry.tex ) {
    entry.tex = PIXI.Texture.from(entry.canvas, { scaleMode: PIXI.SCALE_MODES.LINEAR });
    entry.tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
  }
  return entry.tex;
}
