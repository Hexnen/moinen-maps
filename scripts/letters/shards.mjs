/* LETR shards: the word's own letters break into fragments that fly, fall, bounce and skid (the "shards" exit; README "Motion").
   Each letter's column of the word is cut by 2-3 straight cracks into convex pieces; every piece shows exactly what was there (the
   finished word is painted once, at rest, and each piece is a clipped copy of it), with the crack inked inside the letter. The
   pieces follow a small ballistic simulation in word units (cap height 1): thrown out from below the word (or away from the side the
   blow came from), gravity, one or two bounces on a floor a little under the word, spin that slows on each bounce. Deterministic for
   the picture's seed; the time `t` (s) of each exit picture is fixed by the timeline, so it is drawn the same on every client. */
import { rng } from "./rng.mjs";

/* cut a convex polygon [x,y,...] by the line through (px,py) with direction angle a: returns [left, right] (either may be null) */
function cut(poly, px, py, a) {
  const nx = -Math.sin(a), ny = Math.cos(a), side = (x, y) => (x - px) * nx + (y - py) * ny;
  const A = [], B = [];
  const m = poly.length / 2;
  for ( let k = 0; k < m; k++ ) {
    const x0 = poly[2 * k], y0 = poly[2 * k + 1], x1 = poly[(2 * k + 2) % poly.length], y1 = poly[(2 * k + 3) % poly.length];
    const s0 = side(x0, y0), s1 = side(x1, y1);
    if ( s0 >= 0 ) A.push(x0, y0); else B.push(x0, y0);
    if ( (s0 >= 0) !== (s1 >= 0) ) { const f = s0 / (s0 - s1), x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f; A.push(x, y); B.push(x, y); }
  }
  return [A.length >= 6 ? A : null, B.length >= 6 ? B : null];
}
const centroid = (p) => { let x = 0, y = 0; const m = p.length / 2; for ( let k = 0; k < m; k++ ) { x += p[2 * k]; y += p[2 * k + 1]; } return [x / m, y / m]; };

/* the pieces of a word: [{ poly, cx, cy, i (letter), vx, vy, w, floor }] in word units around the picture's centre */
export function shardPieces(geo, seed, loud = 0.7, from = null, mode = "break") {
  const R = rng(seed >>> 0);
  const boxes = geo.map((l) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for ( const c of l.cs ) for ( let k = 0; k < c.length; k += 2 ) { x0 = Math.min(x0, c[k]); x1 = Math.max(x1, c[k]); y0 = Math.min(y0, c[k + 1]); y1 = Math.max(y1, c[k + 1]); }
    return { i: l.i, x0, y0, x1, y1 };
  }).filter((b) => Number.isFinite(b.x0)).sort((a, b) => (a.x0 + a.x1) - (b.x0 + b.x1));
  if ( !boxes.length ) return [];
  const Y0 = Math.min(...boxes.map((b) => b.y0)) - 0.45, Y1 = Math.max(...boxes.map((b) => b.y1)) + 0.45;
  const wordBottom = Math.max(...boxes.map((b) => b.y1));
  const cxw = (boxes[0].x0 + boxes.at(-1).x1) / 2;
  /* the blow: from below the word's middle by default; `from` (deg, where the sound came from) throws the pieces away from it */
  const fa = Number.isFinite(from) ? (from * Math.PI) / 180 : null;
  const burst = mode === "burst";
  const ox = fa == null || burst ? cxw : cxw + Math.cos(fa) * 2, oy = burst ? (Math.min(...boxes.map((b) => b.y0)) + wordBottom) / 2 : fa == null ? wordBottom + 0.6 : -0.5 + Math.sin(fa) * 1.2;
  const out = [];
  boxes.forEach((b, j) => {
    /* the letter's column: from half-way to the previous letter to half-way to the next (shadow, 3D and outline go with it) */
    const L = j ? (boxes[j - 1].x1 + b.x0) / 2 : b.x0 - 0.45, Rr = j < boxes.length - 1 ? (b.x1 + boxes[j + 1].x0) / 2 : b.x1 + 0.45;
    let polys = [[L, Y0, Rr, Y0, Rr, Y1, L, Y1]];
    const w = b.x1 - b.x0, h = b.y1 - b.y0, cuts = w > 0.45 && R.chance(0.6) ? 3 : 2;
    for ( let k = 0; k < cuts; k++ ) {
      const px = b.x0 + w * R.f(0.3, 0.7), py = b.y0 + h * R.f(0.3, 0.7), a = k === 0 ? R.f(-0.5, 0.5) + Math.PI / 2 * R.sign() * R.f(0.6, 1) : R.f(0, Math.PI);
      polys = polys.flatMap((p) => cut(p, px, py, a).filter(Boolean));
    }
    for ( const poly of polys ) {
      const [cx, cy] = centroid(poly);
      let dx = cx - ox, dy = cy - oy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const sp = R.f(1.6, 3.0) * (0.75 + 0.5 * loud) * (burst ? 1.7 : 1);
      out.push({ poly, cx, cy, i: b.i, vx: dx * sp + R.f(-0.4, 0.4), vy: burst ? dy * sp - R.f(0.3, 0.9) : dy * sp * 0.7 - R.f(1.6, 3.2) * (0.8 + 0.4 * loud), w: R.f(2.5, 8) * R.sign() * (burst ? 1.5 : 1), floor: wordBottom + R.f(0.25, 0.9) + (burst ? 1.2 : 0), s: R.f(0.82, 1), g: burst ? 5 : 13 });
    }
  });
  return out;
}

/* where a piece is after t seconds: { dx, dy, a, s } (simulated in 1/120 s steps: the same on every client) */
export function pieceAt(q, t) {
  let x = 0, y = 0, vx = q.vx, vy = q.vy, w = q.w, a = 0, bounces = 0;
  const G = q.g ?? 13, dt = 1 / 120, n = Math.round(Math.max(0, t) / dt);
  for ( let k = 0; k < n; k++ ) {
    vy += G * dt; x += vx * dt; y += vy * dt; a += w * dt;
    if ( q.cy + y > q.floor && vy > 0 ) {
      y = q.floor - q.cy; vy = bounces < 2 ? -vy * 0.38 : 0; vx *= 0.62; w *= 0.45; bounces++;
      if ( bounces >= 2 ) { vx *= 0.8; }
    }
    if ( bounces >= 2 && vy === 0 ) { vx *= 0.96; w *= 0.9; }
  }
  return { dx: x, dy: y, a, s: 1 - Math.min(0.3, t * 0.5) * (0.4 + (1 - q.s) * 3) };
}

/* the extents (word units, relative to the letters' box) a shards picture needs */
export const SHARD_MARGIN = { x: 2.4, up: 2.2, down: 1.4 };

/* paint one shards picture. `src` = { canvas, ax, ay } the finished word at rest at the same scale S; (ox, oy) = where the word's
   centre is on the target canvas; `geo` = the rest geometry (letters' outlines, word units, centred). */
export function paintShards(ctx, plan, p, geo, src, S, ox, oy, path) {
  const sh = p.shards;
  if ( !plan._shardCache ) Object.defineProperty(plan, "_shardCache", { value: new Map(), enumerable: false, configurable: true });
  let pieces = plan._shardCache.get(sh.seed);
  if ( !pieces ) { pieces = shardPieces(geo, sh.seed, plan.sound?.loud ?? 0.7, sh.from, sh.mode); plan._shardCache.set(sh.seed, pieces); }
  const byLetter = new Map(geo.map((l) => [l.i, l.cs]));
  const ink = plan.hand.ink, open = sh.t <= 0 ? 0.035 : 0;
  for ( const q of pieces ) {
    const m = sh.t > 0 ? pieceAt(q, sh.t) : { dx: Math.sign(q.vx) * open, dy: Math.sign(q.vy) * open * 0.5, a: q.w * 0.004, s: 1 };
    ctx.save();
    ctx.translate(ox + (q.cx + m.dx) * S, oy + (q.cy + m.dy) * S); ctx.rotate(m.a); ctx.scale(m.s, m.s); ctx.translate(-(ox + q.cx * S), -(oy + q.cy * S));
    ctx.beginPath();
    for ( let k = 0; k < q.poly.length; k += 2 ) (k ? ctx.lineTo : ctx.moveTo).call(ctx, ox + q.poly[k] * S, oy + q.poly[k + 1] * S);
    ctx.closePath(); ctx.save(); ctx.clip();
    ctx.drawImage(src.canvas, ox - src.ax, oy - src.ay);
    /* the crack: ink along the cut, only inside the letter (the outline already inks the outside) */
    const cs = byLetter.get(q.i);
    if ( cs ) {
      ctx.beginPath(); path(ctx, cs, S, ox, oy); ctx.clip();
      ctx.beginPath();
      for ( let k = 0; k < q.poly.length; k += 2 ) (k ? ctx.lineTo : ctx.moveTo).call(ctx, ox + q.poly[k] * S, oy + q.poly[k + 1] * S);
      ctx.closePath(); ctx.strokeStyle = ink; ctx.lineJoin = "miter"; ctx.lineWidth = Math.max(1.2, S * (sh.t > 0 ? 0.07 : 0.05)); ctx.stroke();
    }
    ctx.restore(); ctx.restore();
  }
}
