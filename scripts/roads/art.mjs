import { edgeCurve, graphBounds, bbox, overlap, lengths, pointAtS } from "./graph.mjs";
import { KINDS } from "./model.mjs";
import { BODY, PALETTE_SIZE } from "./traffic.mjs";

/**
 * The look of roads and cars, drawn on 2D canvases and handed to PIXI as textures.
 *
 * Roads are inked like the districts: a soft ground shadow, one ink outline under the whole network (so junctions merge with no
 * line across them), kerbs, the surface of each kind (asphalt with worn tyre tracks, cobbles stone by stone, dirt with ruts and
 * pebbles, a sandy footpath with dashed edges), then markings: a dashed centre line, one-way chevrons and zebra crossings at
 * junctions. The network is baked into tiles once per change.
 *
 * Cars are small top-down sprites (compact, sedan, van, pickup, truck, bus, taxi in nine colours), inked with a dark outline,
 * a lighter roof and glass, or the same shapes as crisp pixel art.
 */

const INK = "#15110f";
export const PALETTE = ["#c8473b", "#2f6f8f", "#e0b04a", "#efe6d2", "#34466b", "#6f8a4a", "#2b2a2e", "#9aa3a8", "#d77a3a"];
const TAXI = "#f2c230";

export const KIND_LOOK = {
  asphalt: { kerb: "#b7ae9c", kerbW: 0.09, surface: "#4a4c52", wear: "rgba(255,255,255,0.07)", mark: "#efe3bf" },
  cobble: { kerb: "#665d51", kerbW: 0.07, surface: "#8a8172", stone: "#a3998a", stone2: "#958b7b", joint: "#5d554a" },
  dirt: { kerb: "#7a5d3d", kerbW: 0.07, surface: "#a8855b", rut: "#866740", pebble: "#c7a97f" },
  path: { kerb: null, kerbW: 0, surface: "#d2bf97", edge: "rgba(21,17,15,0.75)" },
  // never baked: only the GM's editor draws it (a thin dashed trace), the map's own road shows through
  guide: { kerb: null, kerbW: 0, surface: "#46d0d0", line: "#46d0d0" }
};

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------------------------------------------------------------- road geometry helpers (display only) */

function offsetLine(c, off) {
  const n = c.length >> 1, out = new Array(n * 2);
  for ( let i = 0; i < n; i++ ) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let dx = c[i1 * 2] - c[i0 * 2], dy = c[i1 * 2 + 1] - c[i0 * 2 + 1];
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    out[i * 2] = c[i * 2] - dy * off; out[i * 2 + 1] = c[i * 2 + 1] + dx * off;
  }
  return out;
}

/** The centre line with a slight hand-drawn waver (for the ink only). */
function waver(c, amp, seed) {
  const n = c.length >> 1, out = c.slice(), ss = lengths(c);
  const ph = (seed % 97) * 0.37;
  for ( let i = 1; i < n - 1; i++ ) {
    const i0 = i - 1, i1 = i + 1;
    let dx = c[i1 * 2] - c[i0 * 2], dy = c[i1 * 2 + 1] - c[i0 * 2 + 1];
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const j = amp * (Math.sin(ss[i] * 0.013 + ph) * 0.7 + Math.sin(ss[i] * 0.041 + ph * 2.1) * 0.3);
    out[i * 2] -= dy * j; out[i * 2 + 1] += dx * j;
  }
  return out;
}

function trace(ctx, p) {
  ctx.moveTo(p[0], p[1]);
  for ( let i = 2; i < p.length; i += 2 ) ctx.lineTo(p[i], p[i + 1]);
}

function strokeLine(ctx, p, width, style, dash) {
  ctx.beginPath(); trace(ctx, p);
  ctx.lineWidth = width; ctx.strokeStyle = style;
  ctx.setLineDash(dash ?? []);
  ctx.stroke();
}

/* ---------------------------------------------------------------- road baking */

export const TILE = 1024;

/**
 * Bake the network into tiles: [{ x, y, w, h, canvas, res }]. Only tiles the roads touch are made. `budget` caps the texels
 * of all tiles together (the resolution drops on very large networks).
 */
export function bakeRoads(R, g, { budget = 40e6, maxRes = 2 } = {}) {
  const G = R.G, look = R.look;
  const bounds = graphBounds(G, g, (e) => e.k !== "guide");
  if ( !bounds ) return [];
  const items = [];
  const degree = new Map();
  for ( const e of G.edges.values() ) { degree.set(e.a, (degree.get(e.a) ?? 0) + 1); degree.set(e.b, (degree.get(e.b) ?? 0) + 1); }
  const nodeTrim = new Map();
  for ( const e of G.edges.values() ) for ( const id of [e.a, e.b] ) nodeTrim.set(id, Math.max(nodeTrim.get(id) ?? 0, (e.w * g) / 2));
  for ( const e of G.edges.values() ) {
    if ( e.k === "guide" ) continue;           // guide lines follow a road drawn in the map: nothing to paint
    const c = edgeCurve(e, g);
    const W = e.w * g;
    items.push({ e, p: c.p, ss: c.ss, W, bb: bbox(c.p, W / 2 + g * 0.3), ink: waver(c.p, g * 0.012, e.id * 7919) });
  }
  // tiles
  const tx0 = Math.floor(bounds.x0 / TILE), ty0 = Math.floor(bounds.y0 / TILE), tx1 = Math.floor(bounds.x1 / TILE), ty1 = Math.floor(bounds.y1 / TILE);
  const tiles = [];
  for ( let ty = ty0; ty <= ty1; ty++ ) for ( let tx = tx0; tx <= tx1; tx++ ) {
    const tb = { x0: tx * TILE, y0: ty * TILE, x1: (tx + 1) * TILE, y1: (ty + 1) * TILE };
    const its = items.filter((it) => overlap(it.bb, tb));
    if ( its.length ) tiles.push({ tb, its });
  }
  const res = Math.min(maxRes, Math.sqrt(budget / Math.max(1, tiles.length * TILE * TILE)));
  const ctxInfo = { g, look, degree, nodeTrim, G };
  return tiles.map(({ tb, its }) => {
    const c = document.createElement("canvas");
    c.width = c.height = Math.max(8, Math.round(TILE * res));
    const ctx = c.getContext("2d");
    ctx.setTransform(res, 0, 0, res, -tb.x0 * res, -tb.y0 * res);
    ctx.lineCap = ctx.lineJoin = "round";
    drawNetwork(ctx, its, ctxInfo, tb);
    return { x: tb.x0, y: tb.y0, w: TILE, h: TILE, canvas: c, res };
  });
}

function byKind(its) {
  const order = new Map(KINDS.map((k, i) => [k, i]));
  return its.slice().sort((a, b) => (order.get(a.e.k) - order.get(b.e.k)) || (a.e.id - b.e.id));
}

function drawNetwork(ctx, its, info, tb) {
  const { g, look } = info;
  const sorted = byKind(its);
  // ground shadow
  if ( look.shadow > 0 ) {
    ctx.save();
    try { ctx.filter = `blur(${(g * 0.07 * ctx.getTransform().a).toFixed(1)}px)`; } catch {}
    ctx.translate(g * 0.05, g * 0.075);
    for ( const it of sorted ) strokeLine(ctx, it.p, it.W + Math.min(g * 0.1, it.W * 0.6), `rgba(18,12,6,${(0.55 * look.shadow).toFixed(3)})`);
    ctx.restore();
  }
  // ink outline under the whole network
  const inkW = g * 0.032 * look.ink;
  // the ink never outweighs a narrow road: at most a quarter of its width a side
  if ( inkW > 0 ) for ( const it of sorted ) if ( it.e.k !== "path" ) strokeLine(ctx, it.ink, it.W + Math.min(inkW, it.W * 0.25) * 2, INK);
  // kerbs, then each kind's surface and texture, lowest kind first
  for ( const it of sorted ) { const L = KIND_LOOK[it.e.k]; if ( L.kerb ) strokeLine(ctx, it.p, it.W, L.kerb); }
  for ( const k of KINDS ) {
    const group = sorted.filter((it) => it.e.k === k);
    if ( !group.length ) continue;
    const L = KIND_LOOK[k];
    for ( const it of group ) strokeLine(ctx, it.p, it.W * (1 - L.kerbW * 2), L.surface);
    for ( const it of group ) texture(ctx, it, L, g, tb);
  }
  // markings
  // markings only where they can be read: a centre line from 0.3 square, crossings from 0.4
  if ( look.marks ) for ( const it of sorted ) if ( it.e.k === "asphalt" && it.W >= g * 0.3 ) markings(ctx, it, info);
  if ( look.crossings ) for ( const it of sorted ) if ( it.e.k === "asphalt" && it.W >= g * 0.4 ) zebras(ctx, it, info);
}

function texture(ctx, it, L, g, tb) {
  const { e, p, ss, W } = it;
  const total = ss[ss.length - 1];
  if ( e.k === "asphalt" ) {
    // worn tyre tracks
    for ( const o of [-0.3, -0.18, 0.18, 0.3] ) strokeLine(ctx, offsetLine(p, W * o), W * 0.07, L.wear);
  } else if ( e.k === "cobble" ) {
    const inner = W * (1 - L.kerbW * 2), rows = Math.max(2, Math.round(inner / (g * 0.11))), sw = inner / rows;
    const step = g * 0.11, r = rng(e.id * 131);
    ctx.save();
    ctx.setLineDash([]);
    for ( let s = step * 0.5, row = 0; s < total; s += step, row++ ) {
      const [x, y, i] = pointAtS(p, ss, s);
      if ( x < tb.x0 - W || x > tb.x1 + W || y < tb.y0 - W || y > tb.y1 + W ) continue;
      const j = Math.min(i + 1, (p.length >> 1) - 1);
      let dx = p[j * 2] - p[i * 2], dy = p[j * 2 + 1] - p[i * 2 + 1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const stagger = (row & 1) ? sw * 0.5 : 0;
      for ( let k = 0; k < rows + 1; k++ ) {
        const lat = -inner / 2 + sw * 0.5 + k * sw - stagger;
        if ( lat < -inner / 2 + sw * 0.3 || lat > inner / 2 - sw * 0.3 ) continue;
        const cx = x - dy * lat, cy = y + dx * lat;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = r() < 0.5 ? L.stone : L.stone2;
        ctx.strokeStyle = L.joint; ctx.lineWidth = g * 0.012;
        const a = step * 0.42 * (0.9 + r() * 0.2), b = sw * 0.4 * (0.9 + r() * 0.2);
        ctx.beginPath(); ctx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  } else if ( e.k === "dirt" ) {
    for ( const o of [-0.2, 0.2] ) strokeLine(ctx, offsetLine(p, W * o), W * 0.075, L.rut, [g * 0.35, g * 0.06, g * 0.12, g * 0.05]);
    const r = rng(e.id * 977);
    ctx.fillStyle = L.pebble;
    const n = Math.round(total / (g * 0.18));
    for ( let i = 0; i < n; i++ ) {
      const [x, y] = pointAtS(p, ss, r() * total);
      const ox = (r() - 0.5) * W * 0.8, oy = (r() - 0.5) * W * 0.8;
      if ( Math.hypot(ox, oy) > W * 0.42 ) continue;
      ctx.beginPath(); ctx.arc(x + ox, y + oy, Math.min(g * (0.012 + r() * 0.014), W * 0.06), 0, Math.PI * 2); ctx.fill();
    }
    // a frayed edge: little tufts of the rim colour biting into the surface
    ctx.fillStyle = L.kerb;
    for ( let i = 0; i < n; i++ ) {
      const [x, y, k] = pointAtS(p, ss, r() * total);
      const j = Math.min(k + 1, (p.length >> 1) - 1);
      let dx = p[j * 2] - p[k * 2], dy = p[j * 2 + 1] - p[k * 2 + 1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const side = r() < 0.5 ? -1 : 1, lat = side * W * (0.4 + r() * 0.06);
      ctx.beginPath(); ctx.arc(x - dy * lat, y + dx * lat, Math.min(g * (0.015 + r() * 0.02), W * 0.08), 0, Math.PI * 2); ctx.fill();
    }
  } else if ( e.k === "path" ) {
    for ( const o of [-0.5, 0.5] ) strokeLine(ctx, offsetLine(p, W * o), Math.min(g * 0.018, W * 0.15), L.edge, [g * 0.08, g * 0.06]);
  }
  ctx.setLineDash([]);
}

/** How far from a node a marking stops (the junction box). */
function trimFor(info, id) { return (info.degree.get(id) ?? 0) >= 3 ? info.nodeTrim.get(id) + info.g * 0.08 : 0; }

function markings(ctx, it, info) {
  const { e, p, ss, W } = it, g = info.g, L = KIND_LOOK.asphalt;
  const total = ss[ss.length - 1];
  const s0 = trimFor(info, e.a) + (info.look.crossings && trimFor(info, e.a) ? g * 0.3 : 0);
  const s1 = total - trimFor(info, e.b) - (info.look.crossings && trimFor(info, e.b) ? g * 0.3 : 0);
  if ( s1 - s0 < g * 0.3 ) return;
  const part = sliceLine(p, ss, s0, s1);
  if ( !e.o && e.l === 2 ) strokeLine(ctx, part, Math.max(g * 0.022, W * 0.03), L.mark, [g * 0.17, g * 0.13]);
  if ( e.o ) {
    // chevrons pointing the way the road runs
    ctx.setLineDash([]); ctx.strokeStyle = L.mark; ctx.lineWidth = Math.max(g * 0.022, W * 0.035);
    const step = g * 1.6, size = Math.min(W * 0.22, g * 0.16);
    for ( let s = s0 + step * 0.5; s < s1 - size; s += step ) {
      const [x, y, i] = pointAtS(p, ss, s);
      const j = Math.min(i + 1, (p.length >> 1) - 1);
      let dx = p[j * 2] - p[i * 2], dy = p[j * 2 + 1] - p[i * 2 + 1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      for ( const lat of e.l === 2 ? [-W * 0.22, W * 0.22] : [0] ) {
        const cx = x - dy * lat, cy = y + dx * lat;
        ctx.beginPath();
        ctx.moveTo(cx - dx * size - dy * size, cy - dy * size + dx * size);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx - dx * size + dy * size, cy - dy * size - dx * size);
        ctx.stroke();
      }
    }
    if ( e.l === 2 ) strokeLine(ctx, part, Math.max(g * 0.016, W * 0.022), "rgba(239,227,191,0.75)", [g * 0.1, g * 0.16]);
  }
}

function sliceLine(p, ss, s0, s1) {
  const out = [];
  const a = pointAtS(p, ss, s0), b = pointAtS(p, ss, s1);
  out.push(a[0], a[1]);
  for ( let i = 0; i < ss.length; i++ ) if ( ss[i] > s0 && ss[i] < s1 ) out.push(p[i * 2], p[i * 2 + 1]);
  out.push(b[0], b[1]);
  return out;
}

function zebras(ctx, it, info) {
  const { e, p, ss, W } = it, g = info.g;
  const total = ss[ss.length - 1];
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(242,236,220,0.88)";
  for ( const [id, fromStart] of [[e.a, true], [e.b, false]] ) {
    const t = trimFor(info, id);
    if ( !t ) continue;
    const s = fromStart ? t + g * 0.14 : total - t - g * 0.14;
    if ( s < 0 || s > total ) continue;
    const [x, y, i] = pointAtS(p, ss, s);
    const j = Math.min(i + 1, (p.length >> 1) - 1);
    let dx = p[j * 2] - p[i * 2], dy = p[j * 2 + 1] - p[i * 2 + 1];
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const inner = W * 0.8, bars = Math.max(3, Math.round(inner / (g * 0.1))), bw = inner / bars;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx));
    for ( let k = 0; k < bars; k++ ) ctx.fillRect(-g * 0.09, -inner / 2 + k * bw + bw * 0.2, g * 0.18, bw * 0.6);
    ctx.restore();
  }
}

/* ---------------------------------------------------------------- cars */

const TEX = new Map();
const isLive = (t) => t && !t.destroyed && t.baseTexture && !t.baseTexture.destroyed;

function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const shade = (hex, t) => {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};

/** Draw a car facing +x, centred on 0,0, L long and W wide (canvas units). */
function drawCar(ctx, type, color, L, W, px) {
  const ink = INK, lw = Math.max(px ? 1 : 1.2, W * 0.075);
  const glass = "#24303c", glassHi = "rgba(200,225,240,0.55)";
  const x0 = -L / 2, y0 = -W / 2;
  // wheels peeking out
  ctx.fillStyle = "#191614";
  const wl = Math.min(L * 0.17, W * 0.42), ww = W * 0.15;
  const axles = type === "bus" ? [0.32, -0.3] : type === "truck" ? [0.33, -0.12, -0.34] : [0.29, -0.29];
  for ( const a of axles ) for ( const s of [-1, 1] ) { rr(ctx, a * L - wl / 2, s * (W / 2) - ww / 2 - s * W * 0.03, wl, ww, ww * 0.4); ctx.fill(); }
  const body = (bx, bw, col, r = W * 0.3) => {
    rr(ctx, bx, y0, bw, W, r); ctx.fillStyle = col; ctx.fill();
    // light from the top-left: the far side darker
    ctx.save(); rr(ctx, bx, y0, bw, W, r); ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(bx, W * 0.18, bw, W);
    ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fillRect(bx, y0, bw, W * 0.16);
    ctx.restore();
    rr(ctx, bx, y0, bw, W, r); ctx.lineWidth = lw; ctx.strokeStyle = ink; ctx.stroke();
  };
  const pane = (a, b, inset, col = glass) => { rr(ctx, a * L, y0 + W * inset, (b - a) * L, W * (1 - inset * 2), W * 0.12); ctx.fillStyle = col; ctx.fill(); };
  const roof = (a, b, col) => { rr(ctx, a * L, y0 + W * 0.17, (b - a) * L, W * 0.66, W * 0.16); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = lw * 0.6; ctx.strokeStyle = "rgba(21,17,15,0.55)"; ctx.stroke(); };
  const c = type === "taxi" ? TAXI : color;
  if ( type === "truck" ) {
    body(x0 + L * 0.66, L * 0.34, c, W * 0.28);
    pane(0.36, 0.43, 0.14); roof(0.2, 0.36, shade(c, 0.22));
    // cargo box
    rr(ctx, x0, y0 - W * 0.02, L * 0.66, W * 1.04, W * 0.08); ctx.fillStyle = "#e6dfcf"; ctx.fill();
    ctx.save(); rr(ctx, x0, y0 - W * 0.02, L * 0.66, W * 1.04, W * 0.08); ctx.clip(); ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(x0, W * 0.2, L, W); ctx.restore();
    ctx.lineWidth = lw; ctx.strokeStyle = ink; rr(ctx, x0, y0 - W * 0.02, L * 0.66, W * 1.04, W * 0.08); ctx.stroke();
    ctx.lineWidth = lw * 0.5; ctx.strokeStyle = "rgba(21,17,15,0.4)";
    for ( let k = 1; k < 5; k++ ) { const x = x0 + (L * 0.66 * k) / 5; ctx.beginPath(); ctx.moveTo(x, y0 + W * 0.1); ctx.lineTo(x, -y0 - W * 0.1); ctx.stroke(); }
  } else if ( type === "bus" ) {
    body(x0, L, c, W * 0.22);
    roof(-0.44, 0.4, shade(c, 0.3));
    pane(0.43, 0.48, 0.12);
    ctx.fillStyle = glass;
    for ( let k = 0; k < 6; k++ ) { const a = -0.4 + k * 0.13; rr(ctx, a * L, y0 + W * 0.05, L * 0.1, W * 0.1, W * 0.04); ctx.fill(); rr(ctx, a * L, -y0 - W * 0.15, L * 0.1, W * 0.1, W * 0.04); ctx.fill(); }
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for ( const a of [-0.25, 0.1] ) { rr(ctx, a * L, -W * 0.12, L * 0.1, W * 0.24, W * 0.05); ctx.fill(); }
  } else {
    body(x0, L, c);
    const spec = {
      compact: { ws: [0.06, 0.2], roof: [-0.2, 0.06], rear: [-0.33, -0.2] },
      sedan: { ws: [0.1, 0.24], roof: [-0.18, 0.1], rear: [-0.3, -0.18] },
      taxi: { ws: [0.1, 0.24], roof: [-0.18, 0.1], rear: [-0.3, -0.18] },
      van: { ws: [0.27, 0.37], roof: [-0.46, 0.27], rear: null },
      pickup: { ws: [0.15, 0.27], roof: [-0.04, 0.15], rear: [-0.08, -0.04] }
    }[type] ?? { ws: [0.1, 0.24], roof: [-0.18, 0.1], rear: [-0.3, -0.18] };
    pane(spec.ws[0], spec.ws[1], 0.13);
    if ( spec.rear ) pane(spec.rear[0], spec.rear[1], 0.16);
    roof(spec.roof[0], spec.roof[1], shade(c, 0.24));
    // glint on the windscreen
    ctx.strokeStyle = glassHi; ctx.lineWidth = lw * 0.6;
    ctx.beginPath(); ctx.moveTo(spec.ws[0] * L + L * 0.02, y0 + W * 0.26); ctx.lineTo(spec.ws[1] * L - L * 0.01, y0 + W * 0.36); ctx.stroke();
    if ( type === "pickup" ) {
      // the open bed with ribs
      rr(ctx, -0.45 * L, y0 + W * 0.14, L * 0.36, W * 0.72, W * 0.06); ctx.fillStyle = shade(c, -0.35); ctx.fill();
      ctx.strokeStyle = "rgba(21,17,15,0.45)"; ctx.lineWidth = lw * 0.5;
      for ( let k = 1; k < 4; k++ ) { const y = y0 + W * 0.14 + (W * 0.72 * k) / 4; ctx.beginPath(); ctx.moveTo(-0.44 * L, y); ctx.lineTo(-0.1 * L, y); ctx.stroke(); }
    }
    if ( type === "taxi" ) {
      rr(ctx, -0.07 * L, -W * 0.13, L * 0.1, W * 0.26, W * 0.05); ctx.fillStyle = "#fbf6e8"; ctx.fill(); ctx.lineWidth = lw * 0.6; ctx.strokeStyle = ink; ctx.stroke();
    }
  }
  // lights
  ctx.fillStyle = "#fff4c6";
  for ( const s of [-1, 1] ) { rr(ctx, L / 2 - L * 0.05, s * W * 0.32 - W * 0.08, L * 0.04, W * 0.16, W * 0.04); ctx.fill(); }
  ctx.fillStyle = "#b8241c";
  for ( const s of [-1, 1] ) { rr(ctx, -L / 2 + L * 0.012, s * W * 0.33 - W * 0.07, L * 0.03, W * 0.14, W * 0.03); ctx.fill(); }
}

/** Cars are drawn at this many texture pixels per unit of body length (ink) or as pixel art (pixel). */
const RES = { ink: 104, pixel: 22 };

function makeTexture(canvas, pixel) {
  const tex = PIXI.Texture.from(canvas, pixel ? { scaleMode: PIXI.SCALE_MODES.NEAREST } : {});
  // cars shrink a long way (down to a few screen pixels): mipmaps keep them smooth instead of sparkling. Pixel cars too: a
  // 26-texel body is drawn at ~18 px at zoom 1 and ~9 px at 0.5, and plain nearest sampling then drops different texels every
  // frame (the cars flicker, worst while zooming). With mipmaps a NEAREST texture is still sampled nearest when enlarged (crisp
  // pixels when zoomed in) and from its box-filtered smaller levels when shrunk (NEAREST_MIPMAP_NEAREST).
  tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
  if ( !pixel ) tex.baseTexture.anisotropicLevel = 4;
  return tex;
}

/** The texture of a car body. The texture's width runs along the car (facing +x). */
export function carTexture(type, colorIndex, style) {
  const key = `${style}|${type}|${colorIndex}`;
  const hit = TEX.get(key);
  if ( isLive(hit) ) return hit;
  const pixel = style === "pixel", B = BODY[type] ?? BODY.sedan;
  const unit = RES[pixel ? "pixel" : "ink"];
  const L = Math.max(8, Math.round(B.len * unit)), W = Math.max(4, Math.round(B.wid * unit));
  const pad = pixel ? 1 : 3;
  const c = document.createElement("canvas"); c.width = L + pad * 2; c.height = W + pad * 2;
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  drawCar(ctx, type, PALETTE[colorIndex % PALETTE_SIZE], L, W, pixel);
  if ( pixel ) {
    // hard edges: no half-transparent pixels, and colours stepped
    const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
    for ( let i = 0; i < d.length; i += 4 ) {
      if ( d[i + 3] < 110 ) { d[i + 3] = 0; continue; }
      d[i] = Math.round(d[i] / 255 * d[i + 3] / 255 * 15) * 17; d[i + 1] = Math.round(d[i + 1] / 255 * d[i + 3] / 255 * 15) * 17; d[i + 2] = Math.round(d[i + 2] / 255 * d[i + 3] / 255 * 15) * 17;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = makeTexture(c, pixel);
  tex.mmLen = L; tex.mmWid = W; tex.mmPad = pad;
  TEX.set(key, tex);
  return tex;
}

/** A soft shadow blob (one texture, scaled per car). */
export function shadowTexture() {
  const hit = TEX.get("shadow"); if ( isLive(hit) ) return hit;
  const c = document.createElement("canvas"); c.width = 128; c.height = 64;
  const ctx = c.getContext("2d");
  try { ctx.filter = "blur(6px)"; } catch {}
  rr(ctx, 14, 12, 100, 40, 16); ctx.fillStyle = "rgba(10,6,3,0.7)"; ctx.fill();
  const tex = makeTexture(c, false); tex.mmInner = { x: 14, y: 12, w: 100, h: 40 };
  TEX.set("shadow", tex);
  return tex;
}

/** A headlight beam (pointing +x from the left middle), drawn additively at night. */
export function beamTexture() {
  const hit = TEX.get("beam"); if ( isLive(hit) ) return hit;
  const c = document.createElement("canvas"); c.width = 160; c.height = 96;
  const ctx = c.getContext("2d");
  const grd = ctx.createRadialGradient(0, 48, 2, 0, 48, 160);
  grd.addColorStop(0, "rgba(255,244,200,0.75)"); grd.addColorStop(0.45, "rgba(255,236,170,0.28)"); grd.addColorStop(1, "rgba(255,230,160,0)");
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.moveTo(0, 40); ctx.lineTo(160, 0); ctx.lineTo(160, 96); ctx.lineTo(0, 56); ctx.closePath(); ctx.fill();
  const tex = makeTexture(c, false);
  TEX.set("beam", tex);
  return tex;
}

/** A small round glow (tail and brake lights). */
export function glowTexture() {
  const hit = TEX.get("glow"); if ( isLive(hit) ) return hit;
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const ctx = c.getContext("2d");
  const grd = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, "rgba(255,90,70,0.95)"); grd.addColorStop(0.4, "rgba(230,40,30,0.45)"); grd.addColorStop(1, "rgba(200,20,10,0)");
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 32, 32);
  const tex = makeTexture(c, false);
  TEX.set("glow", tex);
  return tex;
}

/** A small swatch of a road kind (for the brush buttons): a data URL. */
export function kindSwatch(kind, w = 64, h = 22) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d"), L = KIND_LOOK[kind];
  if ( kind === "guide" ) {
    // the map shows through: a thin dashed trace between two faint edges
    ctx.fillStyle = "rgba(70,208,208,0.12)"; ctx.fillRect(0, h * 0.15, w, h * 0.7);
    strokeLine(ctx, [0, h / 2, w, h / 2], 2, L.line, [5, 3]);
    for ( const y of [h * 0.15, h * 0.85] ) strokeLine(ctx, [0, y, w, y], 1, "rgba(70,208,208,0.6)");
    return c.toDataURL();
  }
  ctx.lineCap = "butt";
  const p = [0, h / 2, w, h / 2];
  const W = h * 0.8, g = h * 1.1;
  if ( kind !== "path" ) strokeLine(ctx, p, W + 3, INK);
  if ( L.kerb ) strokeLine(ctx, p, W, L.kerb);
  strokeLine(ctx, p, W * (1 - L.kerbW * 2), L.surface);
  const it = { e: { k: kind, id: 3 }, p, ss: lengths(p), W };
  texture(ctx, it, L, g, { x0: -999, y0: -999, x1: 999, y1: 999 });
  if ( kind === "asphalt" ) strokeLine(ctx, p, 1.5, L.mark, [5, 4]);
  return c.toDataURL();
}

export function destroyTextures() {
  for ( const t of TEX.values() ) if ( isLive(t) ) t.destroy(true);
  TEX.clear();
}
